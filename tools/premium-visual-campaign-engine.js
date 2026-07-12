#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("fs-extra");
const {
  materializePremiumVisualCampaign,
} = require("../lib/ops/premium-visual-campaign-engine");

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function storyPromptFor({ headline, suppliedPrompt } = {}) {
  const cover = clean(headline).toUpperCase();
  const supplied = clean(suppliedPrompt);
  if (/FREE\s+OR\s+PAID/.test(cover)) return "FREE TRACK OR PAID UPGRADE?";
  if (/change your watchlist|what do you think|are you excited/i.test(supplied)) {
    return "SMART MOVE OR STEP TOO FAR?";
  }
  return supplied || "WHAT CHANGES FOR PLAYERS?";
}

function buildCampaignInputFromArtefacts({ canonical = {}, instagram = {} } = {}) {
  const cover = instagram.cover_frame || {};
  return {
    story_id: clean(canonical.story_id || canonical.id),
    canonical_subject: clean(cover.subject || canonical.canonical_subject || canonical.canonical_game),
    title: clean(canonical.selected_title || canonical.canonical_title || canonical.title),
    headline: clean(cover.headline || canonical.thumbnail_headline || canonical.thumbnail_text),
    source_label: clean(cover.source_label || canonical.primary_source || canonical.source_card_label),
    classification: clean(canonical.content_pillar || canonical.canonical_angle || "update"),
    story_prompt: storyPromptFor({
      headline: clean(cover.headline || canonical.thumbnail_headline || canonical.thumbnail_text),
      suppliedPrompt: instagram.story_poll_idea,
    }),
  };
}

function selectOfficialHeroClip(materialised = {}) {
  return (materialised.clips || materialised.materialised_clips || []).find((clip) => {
    const sourceType = clean(clip.source_type).toLowerCase();
    const direct = clean(clip.media_kind).toLowerCase() === "direct_video" || /steam_movie|platform_storefront|official/.test(sourceType);
    const editorialCard = /hyperframes|generated|explainer|card/.test(sourceType);
    return direct && !editorialCard && clean(clip.rights_basis) === "official_direct_media" && clean(clip.path);
  }) || null;
}

function officialHeroClips(materialised = {}) {
  return (materialised.clips || materialised.materialised_clips || []).filter((clip) => {
    const sourceType = clean(clip.source_type).toLowerCase();
    const direct = clean(clip.media_kind).toLowerCase() === "direct_video" || /steam_movie|platform_storefront|official/.test(sourceType);
    const editorialCard = /hyperframes|generated|explainer|card/.test(sourceType);
    return direct && !editorialCard && clean(clip.rights_basis) === "official_direct_media" && clean(clip.path);
  });
}

function scoreHeroFrameStats(stats = {}) {
  const channels = (stats.channels || []).slice(0, 3);
  const brightness = channels.length
    ? channels.reduce((sum, channel) => sum + Number(channel.mean || 0), 0) / channels.length
    : 0;
  const sharpness = Number(stats.sharpness || 0);
  const entropy = Number(stats.entropy || 0);
  const reasons = [];
  if (brightness < 20) reasons.push("hero_frame_too_dark");
  if (brightness > 238) reasons.push("hero_frame_overexposed");
  if (sharpness < 0.12) reasons.push("hero_frame_too_soft");
  const exposurePenalty = Math.abs(brightness - 105) * 0.035;
  return {
    eligible: reasons.length === 0,
    score: Number((sharpness * 5 + entropy * 4 - exposurePenalty).toFixed(3)),
    sharpness,
    entropy,
    brightness: Number(brightness.toFixed(3)),
    reasons,
  };
}

async function extractBestOfficialHeroFrame({ materialised, outDir } = {}) {
  const clips = officialHeroClips(materialised).slice(0, 4);
  if (!clips.length) throw new Error("No official direct-motion clip is available for safe hero-frame extraction");
  const candidateDir = path.join(outDir, "hero_candidates");
  await fs.ensureDir(candidateDir);
  const candidates = [];
  const sharp = require("sharp");
  for (let clipIndex = 0; clipIndex < clips.length; clipIndex += 1) {
    const clip = clips[clipIndex];
    const duration = Math.max(1.2, Number(clip.duration_s || clip.durationS || 5));
    for (const sample of [0.18, 0.46, 0.74]) {
      const at = Math.max(0.2, Math.min(duration - 0.2, duration * sample));
      const candidatePath = path.join(candidateDir, `clip_${clipIndex + 1}_${String(sample).replace(".", "_")}.jpg`);
      try {
        run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", at.toFixed(3), "-i", clip.path, "-frames:v", "1", "-vf", "scale=1600:-2", "-q:v", "2", candidatePath]);
        const stats = await sharp(candidatePath).stats();
        candidates.push({
          path: candidatePath,
          clip_path: clip.path,
          source_url: clip.source_url || null,
          source_type: clip.source_type || null,
          rights_basis: clip.rights_basis || null,
          extraction_time_seconds: Number(at.toFixed(3)),
          ...scoreHeroFrameStats(stats),
        });
      } catch (error) {
        candidates.push({ path: candidatePath, clip_path: clip.path, eligible: false, score: -999, reasons: ["hero_frame_extraction_failed"], error: error.message });
      }
    }
  }
  const winner = candidates.filter((item) => item.eligible).sort((left, right) => right.score - left.score)[0];
  if (!winner) throw new Error("All official hero-frame candidates failed sharpness/exposure checks");
  const heroPath = path.join(outDir, "official_hero_frame.jpg");
  await fs.copy(winner.path, heroPath, { overwrite: true });
  return { heroPath, winner, candidates };
}

function run(command, args, options = {}) {
  const isLocalHyperframes = command === "npx" && args[0] === "hyperframes";
  const executable = isLocalHyperframes ? process.execPath : command;
  const commandArgs = isLocalHyperframes
    ? [path.resolve(__dirname, "..", "node_modules", "hyperframes", "dist", "cli.js"), ...args.slice(1)]
    : args;
  const result = spawnSync(executable, commandArgs, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    shell: false,
    stdio: options.inherit ? "inherit" : "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${clean(result.error?.message || result.stderr || result.stdout)}`);
  }
  return result;
}

async function readJson(filePath) {
  return fs.pathExists(filePath) ? fs.readJson(filePath) : {};
}

async function materializeFromArtifactDir({ artifactDir, heroImagePath, outputDir, renderMotion = false } = {}) {
  const root = path.resolve(artifactDir || "");
  if (!artifactDir || !(await fs.pathExists(root))) throw new Error("--artifact-dir must point to a governed story package");
  const canonical = await readJson(path.join(root, "canonical_story_manifest.json"));
  const instagram = await readJson(path.join(root, "instagram_publish_pack.json"));
  const materialised = await readJson(path.join(root, "materialised_motion_clips.json"));
  const outDir = path.resolve(outputDir || path.join(root, "premium_visual_campaign"));
  await fs.ensureDir(outDir);
  let hero = heroImagePath ? path.resolve(heroImagePath) : "";
  let heroEvidence = { mode: "operator_supplied_safe_image", source_path: hero || null };
  if (!hero) {
    const selection = await extractBestOfficialHeroFrame({ materialised, outDir });
    hero = selection.heroPath;
    heroEvidence = {
      mode: "scored_official_direct_motion_frame_selection",
      source_path: selection.winner.clip_path,
      source_url: selection.winner.source_url,
      source_type: selection.winner.source_type,
      rights_basis: selection.winner.rights_basis,
      extraction_time_seconds: selection.winner.extraction_time_seconds,
      winning_score: selection.winner.score,
      candidate_count: selection.candidates.length,
      candidates: selection.candidates,
    };
  }
  const result = await materializePremiumVisualCampaign({
    campaignInput: buildCampaignInputFromArtefacts({ canonical, instagram }),
    heroImagePath: hero,
    outputDir: outDir,
  });
  let motion = { requested: renderMotion, status: "not_requested", output_path: null };
  if (renderMotion) {
    const motionDir = path.dirname(result.motionProjectPath);
    run("npx", ["hyperframes", "check", "."], { cwd: motionDir, inherit: true });
    const motionOut = path.join(motionDir, "premium_story_motion.mp4");
    run("npx", ["hyperframes", "render", ".", "--skill=motion-graphics", "-q", "draft", "-o", motionOut], { cwd: motionDir, inherit: true });
    motion = { requested: true, status: "rendered", output_path: motionOut };
  }
  const proof = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: result.campaign.story_id,
    verdict: result.report.verdict,
    hero_evidence: heroEvidence,
    outputs: result.outputs,
    motion,
    manifest_path: result.manifestPath,
    scorecard_path: result.scorecardPath,
    safety: { no_publish_triggered: true, no_db_mutation: true, no_oauth_or_token_change: true },
  };
  const proofPath = path.join(outDir, "premium_visual_campaign_proof.json");
  const markdownPath = path.join(outDir, "premium_visual_campaign_report.md");
  await fs.writeJson(proofPath, proof, { spaces: 2 });
  await fs.writeFile(markdownPath, [
    "# Premium Visual Campaign Proof",
    "",
    `Story: ${proof.story_id}`,
    `Verdict: ${String(proof.verdict).toUpperCase()}`,
    `Outputs: ${Object.keys(proof.outputs || {}).length}`,
    `Hero selection: ${proof.hero_evidence.mode}`,
    `Hero candidates: ${proof.hero_evidence.candidate_count || 1}`,
    `Animated Story: ${proof.motion.status}`,
    "",
    "Safety: local proof only; no upload, database mutation, OAuth or token change.",
    "",
  ].join("\n"), "utf8");
  return { ...result, proof, proofPath, markdownPath };
}

async function main() {
  const args = parseArgs();
  const result = await materializeFromArtifactDir({
    artifactDir: args["artifact-dir"],
    heroImagePath: args.hero,
    outputDir: args["output-dir"],
    renderMotion: args["render-motion"] === true,
  });
  process.stdout.write(`${JSON.stringify({
    verdict: result.report.verdict,
    story_id: result.campaign.story_id,
    output_count: Object.keys(result.outputs).length,
    proof_path: result.proofPath,
    motion: result.proof.motion,
  }, null, 2)}\n`);
}

module.exports = {
  buildCampaignInputFromArtefacts,
  extractBestOfficialHeroFrame,
  materializeFromArtifactDir,
  scoreHeroFrameStats,
  selectOfficialHeroClip,
  storyPromptFor,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`[premium-visual-campaign] ${error.message}`);
    process.exitCode = 1;
  });
}
