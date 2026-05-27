"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const GOAL_ID = "14_social_derivatives_engine";

const REQUIRED_IMAGE_CARD_PLATFORMS = ["x", "instagram", "threads"];
const REQUIRED_CAROUSEL_SOURCE_CARDS = ["cover", "source", "impact"];
const REQUIRED_CAROUSEL_DERIVATIVES = ["quote_card", "stat_card", "story_prompt"];

const ENGAGEMENT_BAIT_RE =
  /\b(?:smash\s+like|retweet\s+if|tag\s+a\s+friend|drop\s+a\s+comment|comment\s+below|like\s+and\s+subscribe|follow\s+for\s+part\s+2|share\s+this\s+if|you\s+won'?t\s+believe)\b/i;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean).map(String))];
}

function resolveWorkspacePath(workspaceRoot, value) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return path.resolve(text);
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function storyIdFromPackage(storyPackage = {}) {
  return cleanText(storyPackage.story_id || storyPackage.id || storyPackage.storyId);
}

function buildPublisherIndex(upstreamPublisherReport = {}) {
  const index = new Map();
  for (const row of asArray(upstreamPublisherReport.stories || upstreamPublisherReport.rows)) {
    const storyId = cleanText(row.story_id || row.id);
    if (storyId) index.set(storyId, row);
  }
  return index;
}

function upstreamBlockers(storyId, publisherIndex = new Map()) {
  const row = publisherIndex.get(cleanText(storyId));
  if (!row) return ["upstream:goal13_multi_platform_publisher_missing"];
  const status = cleanText(row.status || row.verdict).toLowerCase();
  if (["ready", "pass", "passed", "green"].includes(status)) return [];
  return unique([
    "upstream:goal13_multi_platform_publisher_blocked",
    ...asArray(row.blockers),
  ]);
}

function platformOutputs(platformManifest = {}) {
  return platformManifest.outputs || platformManifest.platform_outputs || {};
}

function sourceLabel(canonical = {}) {
  const source = canonical.primary_source || canonical.source || canonical.discovery_source;
  if (source && typeof source === "object") return cleanText(source.name || source.label || source.source_name);
  return cleanText(source);
}

function storyTitle(canonical = {}, storyPackage = {}) {
  return cleanText(
    canonical.selected_title ||
      canonical.short_title ||
      canonical.canonical_title ||
      canonical.title ||
      storyPackage.title ||
      canonical.canonical_subject,
  );
}

function storySubject(canonical = {}, title = "") {
  return cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.subject || title);
}

function normaliseCopy(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/p\/[a-z0-9_-]+(?:\?\S+)?/gi, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
  return out;
}

function containsEngagementBait(...values) {
  return values.some((value) => ENGAGEMENT_BAIT_RE.test(collectStrings(value).join(" ")));
}

function riskyAutomatedReplies(threadsPack = {}, xPack = {}) {
  if (threadsPack.automated_replies_allowed === true) return true;
  if (threadsPack.auto_reply_enabled === true || xPack.auto_reply_enabled === true) return true;
  const text = collectStrings({
    thread_reply_strategy: threadsPack.reply_strategy,
    x_reply_strategy: xPack.reply_strategy,
    automated_reply_template: threadsPack.automated_reply_template || xPack.automated_reply_template,
  }).join(" ");
  return /\b(?:automated_reply|auto reply|reply bot|reply to every|auto-engage)\b/i.test(text) &&
    !/\bmanual review|required review|human review\b/i.test(text);
}

function threadDuplicatesX(threadsPack = {}, xPack = {}) {
  if (threadsPack.duplicate_x_wording_allowed === true) return false;
  const threadsText = normaliseCopy(threadsPack.discussion_post);
  if (!threadsText) return false;
  const xCandidates = [
    xPack.hot_take_post,
    xPack.source_safe_post,
    xPack.concise_news_post,
    ...asArray(xPack.thread_posts),
  ].map(normaliseCopy).filter(Boolean);
  return xCandidates.some((copy) => copy === threadsText);
}

function rawCarouselCards(carousel = {}, instagramPack = {}) {
  return [
    ...asArray(carousel.cards),
    ...asArray(instagramPack.carousel_companion?.cards),
  ].map((card) => cleanText(typeof card === "string" ? card : card.type || card.id || card.name).toLowerCase());
}

function carouselSourceReady(carousel = {}, instagramPack = {}) {
  const cards = new Set(rawCarouselCards(carousel, instagramPack));
  return REQUIRED_CAROUSEL_SOURCE_CARDS.every((card) => cards.has(card));
}

function imageSourceReady(imageCardManifest = {}) {
  const headline = cleanText(imageCardManifest.headline || imageCardManifest.title);
  const platforms = new Set(asArray(imageCardManifest.platforms).map((platform) => cleanText(platform).toLowerCase()));
  return headline && (platforms.has("x") || platforms.has("twitter")) && platforms.has("instagram");
}

function buildXDerivative({ storyId, title, subject, source, xPack = {}, route }) {
  return {
    story_id: storyId,
    platform: "x",
    hot_take_post: cleanText(xPack.hot_take_post) || `${title}. The useful next beat is evidence players can check.`,
    source_safe_post: cleanText(xPack.source_safe_post) || `${title}\n\nSource: ${source || "source manifest"}.`,
    concise_news_post: cleanText(xPack.concise_news_post) || `${subject || title}: source-backed update.`,
    thread_posts: asArray(xPack.thread_posts).length >= 3
      ? asArray(xPack.thread_posts).map(cleanText)
      : [
          title,
          `${subject || title} now has a source-backed update.`,
          `Source: ${source || "source manifest"}.`,
        ],
    poll_candidate: cleanText(xPack.poll_candidate) || `Is ${subject || "this"} a buy-now story or a wait-for-reviews story?`,
    landing_page_link: cleanText(xPack.landing_page_link || route),
    image_cards: [
      {
        type: "headline_card",
        headline: title,
        source_label: source || null,
        aspect_ratio: "1.91:1",
        asset_status: "planned_local_proof",
      },
      {
        type: "poll_card",
        prompt: cleanText(xPack.poll_candidate) || `Is ${subject || "this"} a buy-now story or a wait-for-reviews story?`,
        aspect_ratio: "1.91:1",
        asset_status: "planned_local_proof",
      },
    ],
    no_auto_replies: true,
  };
}

function buildInstagramDerivative({ storyId, title, subject, source, instagramPack = {}, route }) {
  return {
    story_id: storyId,
    platform: "instagram",
    cover_frame: instagramPack.cover_frame || {
      headline: title.toUpperCase().slice(0, 48),
      subject,
      source_label: source || null,
    },
    caption: cleanText(instagramPack.caption) || `${subject || title}. Source: ${source || "source manifest"}.`,
    carousel_companion: instagramPack.carousel_companion || { required: true, cards: ["cover", "source", "impact"] },
    story_poll_idea: cleanText(instagramPack.story_poll_idea) || `Does ${subject || "this"} change your watchlist?`,
    quote_card: {
      type: "quote_card",
      quote: cleanText(instagramPack.caption || `${subject || title}.`).slice(0, 140),
      source_label: source || null,
    },
    stat_card: {
      type: "stat_card",
      stat: "source-backed update",
      context: title,
    },
    story_prompt_card: {
      type: "story_prompt",
      prompt: cleanText(instagramPack.story_poll_idea) || `Does ${subject || "this"} change your watchlist?`,
    },
    bio_link_cta: cleanText(instagramPack.bio_link_cta || route),
  };
}

function buildThreadsDerivative({ storyId, title, subject, source, threadsPack = {}, route }) {
  return {
    story_id: storyId,
    platform: "threads",
    discussion_post: cleanText(threadsPack.discussion_post) ||
      `${subject || title} has a source-backed update. ${source || "The source"} has the report.`,
    tone: cleanText(threadsPack.tone) || "discussion-led and source-safe",
    duplicate_x_wording_allowed: threadsPack.duplicate_x_wording_allowed === true,
    landing_page_link: cleanText(threadsPack.landing_page_link || route),
    automated_replies_allowed: false,
    reply_policy: "manual_review_required_for_replies",
  };
}

function buildImageCardPlan({ storyId, title, source, imageCardManifest = {} }) {
  const headline = cleanText(imageCardManifest.headline || imageCardManifest.title || title);
  return {
    story_id: storyId,
    source_manifest_platforms: asArray(imageCardManifest.platforms),
    headline,
    cards: REQUIRED_IMAGE_CARD_PLATFORMS.map((platform) => ({
      platform,
      type: "image_card",
      headline,
      source_label: source || null,
      asset_status: "planned_local_proof",
      no_external_generation: true,
    })),
  };
}

function buildCarouselPlan({ storyId, title, source, instagramDerivative }) {
  return {
    story_id: storyId,
    platform: "instagram",
    cards: [
      {
        type: "cover",
        headline: title,
        source_label: source || null,
      },
      {
        type: "source",
        source_label: source || null,
      },
      instagramDerivative.quote_card,
      instagramDerivative.stat_card,
      instagramDerivative.story_prompt_card,
      {
        type: "related_links",
        cta: "story page",
      },
    ],
  };
}

function pushRisk(risks, storyId, category, detail) {
  risks.push({
    story_id: storyId,
    category,
    severity: "hard_fail",
    detail: detail || category,
  });
}

async function inspectStoryPackage(storyPackage = {}, context = {}) {
  const storyId = storyIdFromPackage(storyPackage);
  const artifactDir = resolveWorkspacePath(context.workspaceRoot, storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
  const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
  const platformManifest = await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {});
  const outputs = platformOutputs(platformManifest);
  const xPack = await readJsonIfPresent(path.join(artifactDir, "x_publish_pack.json"), outputs.x || {});
  const instagramPack = await readJsonIfPresent(path.join(artifactDir, "instagram_publish_pack.json"), outputs.instagram_reels || {});
  const threadsPack = await readJsonIfPresent(path.join(artifactDir, "threads_publish_pack.json"), outputs.threads || {});
  const imageCardManifest = await readJsonIfPresent(path.join(artifactDir, "image_card_manifest.json"), {});
  const carouselManifest = await readJsonIfPresent(path.join(artifactDir, "carousel_manifest.json"), {});
  const upstream = upstreamBlockers(storyId, context.publisherIndex);
  const directBlockers = [];
  const risks = [];
  const title = storyTitle(canonical, storyPackage);
  const subject = storySubject(canonical, title);
  const source = sourceLabel(canonical);
  const route = cleanText(xPack.landing_page_link || threadsPack.landing_page_link || instagramPack.bio_link_cta);

  function addBlocker(blocker, detail) {
    if (!directBlockers.includes(blocker)) directBlockers.push(blocker);
    pushRisk(risks, storyId, blocker, detail);
  }

  if (!cleanText(xPack.hot_take_post) || !cleanText(xPack.source_safe_post)) {
    addBlocker("social:missing_x_post", "X hot-take and source-safe posts are required.");
  }
  if (asArray(xPack.thread_posts).length < 3) {
    addBlocker("social:missing_x_thread", "X thread must include at least three planned posts.");
  }
  if (!cleanText(xPack.poll_candidate)) {
    addBlocker("social:missing_x_poll", "X poll candidate is required.");
  }
  if (!cleanText(instagramPack.caption) || !instagramPack.cover_frame || !cleanText(instagramPack.story_poll_idea)) {
    addBlocker("social:missing_instagram_derivative", "Instagram caption, cover and story prompt are required.");
  }
  if (!cleanText(threadsPack.discussion_post) || !cleanText(threadsPack.tone)) {
    addBlocker("social:missing_threads_post", "Threads discussion post and tone are required.");
  }
  if (containsEngagementBait(xPack, instagramPack, threadsPack)) {
    addBlocker("social:engagement_bait", "Crude engagement bait appears in social derivative copy.");
  }
  if (riskyAutomatedReplies(threadsPack, xPack)) {
    addBlocker("social:risky_automated_reply", "Automated reply behaviour is enabled or implied.");
  }
  if (threadDuplicatesX(threadsPack, xPack)) {
    addBlocker("social:threads_duplicates_x", "Threads copy duplicates X wording.");
  }
  if (!imageSourceReady(imageCardManifest)) {
    addBlocker("social:missing_image_card_asset", "Image-card source manifest must include a headline plus X and Instagram targets.");
  }
  if (!carouselSourceReady(carouselManifest, instagramPack)) {
    addBlocker("social:missing_carousel_derivative", "Carousel source cards must include cover, source and impact.");
  }

  const xDerivative = buildXDerivative({ storyId, title, subject, source, xPack, route });
  const instagramDerivative = buildInstagramDerivative({ storyId, title, subject, source, instagramPack, route });
  const threadsDerivative = buildThreadsDerivative({ storyId, title, subject, source, threadsPack, route });
  const imageCardPlan = buildImageCardPlan({ storyId, title, source, imageCardManifest });
  const carouselPlan = buildCarouselPlan({ storyId, title, source, instagramDerivative });
  const derivativeTypes = new Set(carouselPlan.cards.map((card) => card.type));
  if (!REQUIRED_CAROUSEL_DERIVATIVES.every((type) => derivativeTypes.has(type))) {
    addBlocker("social:missing_carousel_derivative", "Carousel plan must include quote, stat and story prompt cards.");
  }

  const blockers = unique([...upstream, ...directBlockers]);
  return {
    story_id: storyId,
    title,
    subject,
    artifact_dir: artifactDir,
    status: blockers.length ? "blocked" : "ready",
    direct_derivative_status: directBlockers.length ? "blocked" : "pass",
    upstream_status: upstream.length ? "blocked" : "ready",
    blockers,
    upstream_blockers: upstream,
    direct_derivative_blockers: directBlockers,
    risks,
    x_derivative: xDerivative,
    instagram_derivative: instagramDerivative,
    threads_derivative: threadsDerivative,
    image_card_plan: imageCardPlan,
    carousel_plan: carouselPlan,
    source_material: {
      x_pack_present: Object.keys(xPack || {}).length > 0,
      instagram_pack_present: Object.keys(instagramPack || {}).length > 0,
      threads_pack_present: Object.keys(threadsPack || {}).length > 0,
      image_card_source_ready: Boolean(imageSourceReady(imageCardManifest)),
      carousel_source_ready: Boolean(carouselSourceReady(carouselManifest, instagramPack)),
    },
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_automated_replies: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
    },
  };
}

function blockerCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function directRiskCounts(stories = []) {
  const counts = {};
  for (const story of asArray(stories)) {
    for (const blocker of asArray(story.direct_derivative_blockers)) counts[blocker] = (counts[blocker] || 0) + 1;
  }
  return counts;
}

function buildXPublishPack(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => story.x_derivative),
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_automated_replies: true,
    },
  };
}

function buildInstagramPublishPack(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => story.instagram_derivative),
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
    },
  };
}

function buildThreadsPublishPack(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    stories: asArray(report.stories).map((story) => story.threads_derivative),
    safety: {
      no_publish_triggered: true,
      no_external_posting: true,
      no_automated_replies: true,
      manual_reply_review_required: true,
    },
  };
}

function buildImageCardManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    required_platforms: REQUIRED_IMAGE_CARD_PLATFORMS,
    stories: asArray(report.stories).map((story) => story.image_card_plan),
    safety: {
      no_external_generation: true,
      no_external_posting: true,
      no_publish_triggered: true,
    },
  };
}

function buildCarouselManifest(report = {}) {
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    mode: "LOCAL_PROOF",
    required_derivatives: REQUIRED_CAROUSEL_DERIVATIVES,
    stories: asArray(report.stories).map((story) => story.carousel_plan),
    safety: {
      no_external_generation: true,
      no_external_posting: true,
      no_publish_triggered: true,
    },
  };
}

function buildEngagementRiskReport(report = {}) {
  const risks = asArray(report.stories).flatMap((story) => asArray(story.risks));
  return {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: report.generated_at || null,
    verdict: risks.length ? "fail" : "pass",
    hard_fail_categories: [
      "social:engagement_bait",
      "social:risky_automated_reply",
      "social:threads_duplicates_x",
      "social:missing_x_thread",
      "social:missing_x_poll",
      "social:missing_image_card_asset",
      "social:missing_carousel_derivative",
    ],
    risk_counts: directRiskCounts(report.stories),
    risks,
    safety: {
      no_auto_replies: true,
      manual_reply_review_required: true,
      no_external_posting: true,
    },
  };
}

async function buildGoal14SocialDerivativesEngine({
  storyPackages = [],
  upstreamPublisherReport = {},
  workspaceRoot = process.cwd(),
  outputDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!outputDir) throw new Error("buildGoal14SocialDerivativesEngine requires outputDir");
  await fs.ensureDir(path.resolve(outputDir));
  const publisherIndex = buildPublisherIndex(upstreamPublisherReport);
  const stories = [];
  for (const storyPackage of asArray(storyPackages)) {
    stories.push(await inspectStoryPackage(storyPackage, { workspaceRoot, publisherIndex }));
  }
  const readyStories = stories.filter((story) => story.status === "ready");
  const blockedStories = stories.filter((story) => story.status === "blocked");
  const directPassStories = stories.filter((story) => story.direct_derivative_status === "pass");
  const directBlockedStories = stories.filter((story) => story.direct_derivative_status !== "pass");
  const verdict = !stories.length
    ? "FAIL"
    : blockedStories.length && readyStories.length
      ? "PARTIAL"
      : blockedStories.length
        ? "BLOCKED"
        : "PASS";
  const directDerivativeVerdict = !stories.length
    ? "FAIL"
    : directBlockedStories.length && directPassStories.length
      ? "PARTIAL"
      : directBlockedStories.length
        ? "BLOCKED"
        : "PASS";
  const report = {
    schema_version: 1,
    goal: GOAL_ID,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict,
    direct_derivative_verdict: directDerivativeVerdict,
    summary: {
      story_count: stories.length,
      social_derivative_ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      direct_derivative_pass_story_count: directPassStories.length,
      direct_derivative_blocked_story_count: directBlockedStories.length,
      x_pack_story_count: stories.filter((story) => story.source_material.x_pack_present).length,
      instagram_pack_story_count: stories.filter((story) => story.source_material.instagram_pack_present).length,
      threads_pack_story_count: stories.filter((story) => story.source_material.threads_pack_present).length,
      image_card_story_count: stories.length,
      carousel_story_count: stories.length,
    },
    blocker_counts: blockerCounts(stories),
    upstream_blockers: {
      goal13_multi_platform_publisher_engine:
        "Goal 14 can prepare social derivative manifests, but readiness requires Goal 13 and its upstream gates to be ready first.",
      note:
        "This gate prepares local derivative artefacts only. It does not post, create replies, mutate DB rows, inspect secrets or touch OAuth/token state.",
    },
    stories,
    safety: {
      local_proof_only: true,
      no_publish_triggered: true,
      no_external_posting: true,
      no_platform_uploads: true,
      no_automated_replies: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_secret_values_exposed: true,
      no_gate_weakened: true,
    },
  };
  report.x_publish_pack = buildXPublishPack(report);
  report.instagram_publish_pack = buildInstagramPublishPack(report);
  report.threads_publish_pack = buildThreadsPublishPack(report);
  report.image_card_manifest = buildImageCardManifest(report);
  report.carousel_manifest = buildCarouselManifest(report);
  report.engagement_risk_report = buildEngagementRiskReport(report);
  return report;
}

function renderGoal14SocialDerivativesEngineMarkdown(report = {}) {
  const lines = [];
  lines.push("# Goal 14 Social Derivatives Engine");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Verdict: ${report.verdict || "UNKNOWN"}`);
  lines.push(`Direct derivative verdict: ${report.direct_derivative_verdict || "UNKNOWN"}`);
  lines.push(`Stories checked: ${report.summary?.story_count || 0}`);
  lines.push(`Full social-derivative ready stories: ${report.summary?.social_derivative_ready_story_count || 0}`);
  lines.push(`Direct derivative-pass stories: ${report.summary?.direct_derivative_pass_story_count || 0}`);
  lines.push(`X derivative stories: ${report.summary?.x_pack_story_count || 0}`);
  lines.push(`Instagram derivative stories: ${report.summary?.instagram_pack_story_count || 0}`);
  lines.push(`Threads derivative stories: ${report.summary?.threads_pack_story_count || 0}`);
  lines.push("");
  lines.push("## Blockers");
  const blockers = Object.keys(report.blocker_counts || {}).sort();
  if (!blockers.length) lines.push("- none");
  for (const blocker of blockers) lines.push(`- ${blocker}: ${report.blocker_counts[blocker]}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("LOCAL_PROOF only. This run did not publish, post externally, create automated replies, mutate the database, touch OAuth or token files, inspect secrets or weaken gates.");
  return `${lines.join("\n")}\n`;
}

async function writeGoal14SocialDerivativesEngine(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoal14SocialDerivativesEngine requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const readinessJson = path.join(outDir, "goal14_readiness_report.json");
  const readinessMarkdown = path.join(outDir, "goal14_readiness_report.md");
  const xPublishPack = path.join(outDir, "x_publish_pack.json");
  const instagramPublishPack = path.join(outDir, "instagram_publish_pack.json");
  const threadsPublishPack = path.join(outDir, "threads_publish_pack.json");
  const imageCardManifest = path.join(outDir, "image_card_manifest.json");
  const carouselManifest = path.join(outDir, "carousel_manifest.json");
  const engagementRiskReport = path.join(outDir, "engagement_risk_report.json");
  await fs.writeJson(readinessJson, report, { spaces: 2 });
  await fs.writeFile(readinessMarkdown, renderGoal14SocialDerivativesEngineMarkdown(report), "utf8");
  await fs.writeJson(xPublishPack, report.x_publish_pack || buildXPublishPack(report), { spaces: 2 });
  await fs.writeJson(instagramPublishPack, report.instagram_publish_pack || buildInstagramPublishPack(report), { spaces: 2 });
  await fs.writeJson(threadsPublishPack, report.threads_publish_pack || buildThreadsPublishPack(report), { spaces: 2 });
  await fs.writeJson(imageCardManifest, report.image_card_manifest || buildImageCardManifest(report), { spaces: 2 });
  await fs.writeJson(carouselManifest, report.carousel_manifest || buildCarouselManifest(report), { spaces: 2 });
  await fs.writeJson(engagementRiskReport, report.engagement_risk_report || buildEngagementRiskReport(report), { spaces: 2 });
  return {
    readinessJson,
    readinessMarkdown,
    xPublishPack,
    instagramPublishPack,
    threadsPublishPack,
    imageCardManifest,
    carouselManifest,
    engagementRiskReport,
  };
}

module.exports = {
  GOAL_ID,
  REQUIRED_CAROUSEL_DERIVATIVES,
  REQUIRED_IMAGE_CARD_PLATFORMS,
  buildCarouselManifest,
  buildEngagementRiskReport,
  buildGoal14SocialDerivativesEngine,
  buildImageCardManifest,
  buildInstagramPublishPack,
  buildThreadsPublishPack,
  buildXPublishPack,
  inspectStoryPackage,
  renderGoal14SocialDerivativesEngineMarkdown,
  writeGoal14SocialDerivativesEngine,
};
