const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");
const { rankThumbnailCandidates } = require("./lib/thumbnail-safety");
const { applyProduceSelection } = require("./lib/produce-selection");
const {
  buildPremiumVisualCampaignSpec,
  buildPremiumVisualSvg,
  materializePremiumVisualCampaign,
} = require("./lib/ops/premium-visual-campaign-engine");

dotenv.config({ override: false });

const OUTPUT_DIR = path.join("output", "stories");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function safeStem(value) {
  return cleanText(value || "story").replace(/[^a-z0-9_-]+/gi, "_") || "story";
}

async function readJsonIfPresent(filePath, fsImpl = fs) {
  if (!filePath) return {};
  try {
    if (!(await fsImpl.pathExists(filePath))) return {};
    return await fsImpl.readJson(filePath);
  } catch {
    return {};
  }
}

function sourceName(source) {
  if (!source) return "";
  if (typeof source === "string") return cleanText(source);
  return cleanText(source.name || source.label || source.publisher || source.source);
}

async function resolveGovernedStoryCardCopy(story = {}, opts = {}) {
  const fsImpl = opts.fs || fs;
  const storyId = safeStem(story.id || story.story_id);
  const artifactRoot = opts.artifactRoot || path.join("output", "goal-proof", "batch");
  const candidateDirs = [
    story.artifact_dir,
    story.goal_artifact_dir,
    story.goal_proof_dir,
    story.platform_pack_dir,
    story.story_package_dir,
    storyId ? path.join(artifactRoot, storyId) : null,
  ].filter(Boolean);

  let artifactDir = null;
  for (const candidate of candidateDirs) {
    if (await fsImpl.pathExists(candidate)) {
      artifactDir = candidate;
      break;
    }
  }

  const instagramPack = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "instagram_publish_pack.json"), fsImpl)
    : {};
  const platformManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), fsImpl)
    : {};
  const imageCardManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "image_card_manifest.json"), fsImpl)
    : {};
  const canonical = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), fsImpl)
    : {};
  const platformInstagram =
    platformManifest.outputs?.instagram_reels ||
    platformManifest.outputs?.instagram ||
    {};
  const instagram = Object.keys(instagramPack).length ? instagramPack : platformInstagram;
  const cover = instagram.cover_frame || {};

  const headline =
    cleanText(cover.headline) ||
    cleanText(imageCardManifest.headline) ||
    cleanText(canonical.suggested_thumbnail_text || canonical.thumbnail_headline) ||
    cleanText(story.suggested_thumbnail_text) ||
    cleanText(canonical.selected_title || canonical.canonical_title) ||
    cleanText(story.title);
  const sourceLabel =
    cleanText(cover.source_label) ||
    sourceName(canonical.primary_source) ||
    cleanText(canonical.source_card_label) ||
    cleanText(story.source_card_label || story.thumbnail_source_label || story.subreddit);
  const hasInstagramPack = cleanText(cover.headline) || Object.keys(instagram).length > 0;

  return {
    title: headline || cleanText(story.title),
    sourceLabel,
    subject:
      cleanText(cover.subject) ||
      cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.canonical_company),
    artifactDir,
    source: hasInstagramPack
      ? "platform_native_instagram_publish_pack"
      : cleanText(imageCardManifest.headline)
        ? "image_card_manifest"
        : "story_row",
  };
}

function buildStorySvg(title, flair, heroImageBase64, hasHero, classification, options = {}) {
  const campaign = buildPremiumVisualCampaignSpec({
    story_id: options.storyId || "story",
    canonical_subject: options.subject || title,
    title: options.canonicalTitle || title,
    headline: title,
    source_label: options.sourceLabel,
    classification: classification || flair,
    story_prompt: options.storyPrompt,
  });
  const heroDataUri = hasHero && heroImageBase64
    ? `data:image/jpeg;base64,${heroImageBase64}`
    : "";
  return buildPremiumVisualSvg(campaign, "instagram_story", { heroDataUri });
}

async function loadHeroBase64(story = {}, opts = {}) {
  const fsImpl = opts.fs || fs;
  const log = opts.log || console.log;
  const resolveExisting = opts.resolveExisting || ((relPath) => mediaPaths.resolveExisting(relPath));
  const preferredOrder = [
    "article_hero",
    "capsule",
    "hero",
    "key_art",
    "screenshot",
    "reddit_thumb",
  ];

  if (!Array.isArray(story.downloaded_images) || story.downloaded_images.length === 0) {
    log(
      `[stories] ${story.id}: no hero image available (downloaded_images=${story.downloaded_images?.length || 0})`,
    );
    return null;
  }

  const candidates = story.downloaded_images.filter(
    (image) => image.path && image.type !== "company_logo",
  );
  const safeRanked = rankThumbnailCandidates(story, candidates).map((ranked) => ranked.image);
  const orderedCandidates =
    safeRanked.length > 0
      ? safeRanked
      : candidates.sort((a, b) => {
          const ai = preferredOrder.indexOf(a.type);
          const bi = preferredOrder.indexOf(b.type);
          return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
        });

  for (const heroImg of orderedCandidates) {
    const heroAbs = await resolveExisting(heroImg.path);
    if (!heroAbs || !(await fsImpl.pathExists(heroAbs))) continue;
    try {
      const buf = await fsImpl.readFile(heroAbs);
      return buf.toString("base64");
    } catch (err) {
      log(
        `[stories] Could not read ${heroImg.type} (${heroImg.path}): ${err.message}`,
      );
    }
  }

  log(
    `[stories] ${story.id}: no hero image available (downloaded_images=${story.downloaded_images?.length || 0})`,
  );
  return null;
}

async function generateStoryImagesForStories(stories = [], opts = {}) {
  const fsImpl = opts.fs || fs;
  const log = opts.log || console.log;
  const outputDir = opts.outputDir || OUTPUT_DIR;
  const writePath = opts.writePath || ((relPath) => mediaPaths.writePath(relPath));
  const outputDirAbs = writePath(outputDir);
  await fsImpl.ensureDir(outputDirAbs);

  const toProcess = stories.filter(
    (story) => story && story.approved === true && story.exported_path && !story.story_image_path,
  );
  let generated = 0;
  let blocked = 0;

  for (const story of toProcess) {
    log(
      `[stories] Generating Story image: ${cleanText(story.title).substring(0, 50)}...`,
    );
    const storyCardCopy = await resolveGovernedStoryCardCopy(story, {
      ...opts,
      fs: fsImpl,
    });
    const heroBase64 = await loadHeroBase64(story, {
      ...opts,
      fs: fsImpl,
      log,
    });
    if (!heroBase64) {
      story.premium_visual_campaign_status = "red";
      story.premium_visual_campaign_blockers = ["premium_visual_safe_hero_missing"];
      blocked += 1;
      log(`[stories] ${story.id}: premium Story card blocked (safe hero missing)`);
      continue;
    }

    const stem = safeStem(story.id);
    const campaignRel = path.join(outputDir, stem);
    const campaignAbs = writePath(campaignRel);
    let campaignResult;
    try {
      campaignResult = await materializePremiumVisualCampaign({
        campaignInput: {
          story_id: story.id,
          canonical_subject: storyCardCopy.subject || story.canonical_subject || story.canonical_game || story.title,
          title: story.title,
          headline: storyCardCopy.title || story.title,
          source_label: storyCardCopy.sourceLabel,
          classification: story.classification || story.flair,
          story_prompt: story.story_poll_idea,
        },
        heroImageBuffer: Buffer.from(heroBase64, "base64"),
        heroImageExtension: ".jpg",
        outputDir: campaignAbs,
        recentCampaigns: opts.recentCampaigns || [],
      });
    } catch (err) {
      const campaignBlockers = err.report?.blockers || ["premium_visual_campaign_materialization_failed"];
      story.premium_visual_campaign_status = "red";
      story.premium_visual_campaign_blockers = campaignBlockers;
      blocked += 1;
      log(`[stories] ${story.id}: premium Story card blocked (${campaignBlockers.join(", ")})`);
      continue;
    }

    const svgPath = path.join(outputDir, `${stem}_story.svg`);
    const pngPath = path.join(outputDir, `${stem}_story.png`);
    const svgWriteAbs = writePath(svgPath);
    const pngWriteAbs = writePath(pngPath);
    await fsImpl.ensureDir(path.dirname(svgWriteAbs));
    await fsImpl.copy(campaignResult.outputs.instagram_story.svg_path, svgWriteAbs, { overwrite: true });
    await fsImpl.copy(campaignResult.outputs.instagram_story.static_path, pngWriteAbs, { overwrite: true });
    story.story_image_path = pngPath;
    story.story_image_source = `${storyCardCopy.source}:premium_visual_campaign`;
    story.premium_visual_campaign_status = campaignResult.report.verdict;
    story.premium_visual_campaign_blockers = campaignResult.report.blockers;
    story.premium_visual_campaign_manifest_path = path.join(campaignRel, "premium_visual_campaign_manifest.json");
    story.premium_visual_campaign_scorecard_path = path.join(campaignRel, "premium_visual_campaign_scorecard.json");
    story.premium_youtube_thumbnail_path = path.join(campaignRel, `${stem}_youtube_thumbnail.png`);
    story.premium_youtube_shorts_cover_path = path.join(campaignRel, `${stem}_youtube_shorts_cover.png`);
    story.premium_instagram_reels_cover_path = path.join(campaignRel, `${stem}_instagram_reels_cover.png`);
    story.premium_facebook_reels_cover_path = path.join(campaignRel, `${stem}_facebook_reels_cover.png`);
    story.premium_story_motion_project_path = path.join(campaignRel, "instagram_story_motion", "index.html");
    // The upload path already prioritises hf_thumbnail_path. Point it at the
    // governed premium 16:9 campaign output so the legacy thumbnail batch
    // safely skips this story instead of replacing it with an older design.
    story.hf_thumbnail_path = story.premium_youtube_thumbnail_path;
    log(`[stories] Saved premium campaign: ${campaignRel}`);
    generated += 1;
  }

  return { generated, blocked, considered: toProcess.length };
}

async function generateStoryImages() {
  console.log("[stories] === Instagram Story Image Generator ===");

  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log("[stories] No stories in canonical store");
    return;
  }

  const toProcess = applyProduceSelection(
    stories.filter(
      (story) => story.approved === true && story.exported_path && !story.story_image_path,
    ),
    { stage: "stories", log: console.log },
  );

  console.log(`[stories] ${toProcess.length} stories need Story images`);
  const result = await generateStoryImagesForStories(toProcess);

  await db.saveStories(stories);
  console.log(`[stories] Generated ${result.generated} Story images`);

  if (result.generated > 0) {
    console.log(
      `[stories] ${result.generated} Story images ready (auto-approved)`,
    );
  }
}

module.exports = {
  generateStoryImages,
  generateStoryImagesForStories,
  buildStorySvg,
  resolveGovernedStoryCardCopy,
};

if (require.main === module) {
  generateStoryImages().catch((err) => {
    console.log(`[stories] ERROR: ${err.message}`);
    process.exit(1);
  });
}
