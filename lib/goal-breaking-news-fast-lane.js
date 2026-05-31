"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const SOURCE_CONFIDENCE_THRESHOLD = 85;
const DISCUSSION_SOURCE_RE = /\b(reddit|discord|forum|resetera|neogaf|comment|thread)\b/i;
const RELIABLE_PUBLICATION_RE = /\b(ign|gamespot|eurogamer|vgc|gematsu|pc gamer|rock paper shotgun|gamesradar|the verge|polygon|kotaku)\b/i;
const OFFICIAL_RE = /\b(official|publisher|studio|platform|playstation|playstation blog|xbox|xbox wire|microsoft|nintendo|steam|epic games|ea|ubisoft|capcom|sega|square enix|bethesda)\b/i;
const SOURCE_FAMILY_PATTERNS = [
  ["eurogamer", /\beurogamer\b|eurogamer\.net/i],
  ["pc gamer", /\bpc gamer\b|pcgamer\.com/i],
  ["rock paper shotgun", /\brock paper shotgun\b|rockpapershotgun\.com/i],
  ["gamespot", /\bgamespot\b|gamespot\.com/i],
  ["ign", /\bign\b|ign\.com/i],
  ["vgc", /\bvgc\b|videogameschronicle\.com/i],
  ["gematsu", /\bgematsu\b|gematsu\.com/i],
  ["polygon", /\bpolygon\b|polygon\.com/i],
  ["kotaku", /\bkotaku\b|kotaku\.com/i],
  ["the verge", /\bthe verge\b|theverge\.com/i],
  ["xbox", /\bxbox\b|xbox\.com|xboxwire\.com/i],
  ["playstation", /\bplaystation\b|playstation\.com/i],
  ["nintendo", /\bnintendo\b|nintendo\.com/i],
  ["steam", /\bsteam\b|steampowered\.com|steamcommunity\.com/i],
];
const GENERIC_TITLE_RE = /\b(this gaming story|gaming story|big gaming news|breaking gaming news|you need to know)\b/i;
const INTERNAL_LANGUAGE = [
  "source-backed update",
  "not a blank check",
  "invent extra details",
  "named source confirms",
  "wait-and-see column",
  "Reddit reaction into evidence",
  "the safest public version is",
  "the concrete claim",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function lower(value) {
  return clean(value).toLowerCase();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normaliseSourceConfidence(value) {
  const number = numberOrNull(value);
  if (number === null) return 0;
  if (number > 0 && number <= 1) return Math.round(number * 100);
  return Math.round(number);
}

function sourceName(source = {}) {
  if (typeof source === "string") return clean(source);
  return clean(source.name || source.source_name || source.label || source.title || source.host || source.url);
}

function sourceUrl(source = {}) {
  if (typeof source === "string") return "";
  return clean(source.url || source.source_url || source.href || source.link);
}

function sourceWithFallback(source = {}, urlFallback = "") {
  const fallback = clean(urlFallback);
  if (!source) return null;
  if (typeof source === "string") {
    return { name: clean(source), url: fallback };
  }
  return {
    ...source,
    url: sourceUrl(source) || fallback,
  };
}

function hostFromUrl(value) {
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function sourceKey(source = {}) {
  const host = hostFromUrl(sourceUrl(source));
  const name = lower(sourceName(source));
  const reliability = sourceReliability(source);
  const familyText = `${name} ${host}`;
  for (const [family, pattern] of SOURCE_FAMILY_PATTERNS) {
    if (pattern.test(familyText)) return family;
  }
  if (
    reliability === "official" &&
    name &&
    (!host || /\b(?:youtube\.com|youtu\.be|twitter\.com|x\.com|instagram\.com|facebook\.com|tiktok\.com)\b/i.test(host))
  ) {
    return name;
  }
  return host || name;
}

function sourceReliability(source = {}) {
  const host = hostFromUrl(sourceUrl(source));
  const officialJoined = [
    sourceName(source),
    host,
    typeof source === "object" ? source.type : "",
    typeof source === "object" ? source.source_type : "",
    typeof source === "object" ? source.reliability : "",
  ].join(" ");
  const publicationJoined = [
    sourceName(source),
    host,
    typeof source === "object" ? source.type : "",
    typeof source === "object" ? source.source_type : "",
    typeof source === "object" ? source.reliability : "",
  ].join(" ");
  if (OFFICIAL_RE.test(officialJoined)) return "official";
  if (RELIABLE_PUBLICATION_RE.test(publicationJoined)) return "reliable_publication";
  if (DISCUSSION_SOURCE_RE.test(publicationJoined)) return "discussion";
  return "unknown";
}

function isDiscussionSource(source = {}) {
  return sourceReliability(source) === "discussion";
}

function containsInternalLanguage(text) {
  const haystack = lower(text);
  return INTERNAL_LANGUAGE.filter((phrase) => haystack.includes(phrase.toLowerCase()));
}

function includesSubject(text, subject) {
  const haystack = lower(text);
  const needle = lower(subject);
  if (!needle) return false;
  return haystack.includes(needle) || needle.split(/\s+/).some((part) => part.length >= 4 && haystack.includes(part));
}

function collectSources(story = {}) {
  const candidates = [
    sourceWithFallback(story.primary_source, story.primary_source_url),
    sourceWithFallback(story.official_source, story.official_source_url || story.official_source_url_override),
    ...asArray(story.secondary_sources),
  ].filter(Boolean);
  const byKey = new Map();
  for (const source of candidates) {
    const key = sourceKey(source);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || (!sourceUrl(existing) && sourceUrl(source))) {
      byKey.set(key, source);
    }
  }
  return [...byKey.values()];
}

function assessSourceStrength(story = {}) {
  const sources = collectSources(story);
  const primary = story.primary_source || null;
  const officialSources = sources.filter((source) => sourceReliability(source) === "official");
  const reliableKeys = new Set();
  for (const source of sources) {
    const reliability = sourceReliability(source);
    if (reliability === "official" || reliability === "reliable_publication") {
      const key = sourceKey(source);
      if (key) reliableKeys.add(key);
    }
  }
  const primaryReliability = primary ? sourceReliability(primary) : "unknown";
  return {
    source_count: sources.length,
    official_source_count: officialSources.length,
    reliable_independent_source_count: reliableKeys.size,
    primary_source_reliability: primaryReliability,
    source_confidence_score: normaliseSourceConfidence(story.source_confidence_score),
    has_official_source: officialSources.length > 0,
    has_two_independent_reliable_sources: reliableKeys.size >= 2,
    has_publication_plus_attribution:
      primaryReliability === "reliable_publication" && reliableKeys.size >= 1,
    primary_is_discussion: primary ? isDiscussionSource(primary) : false,
  };
}

function platformOperationalState(platformState = {}, platform) {
  const platforms = platformState.platforms || platformState || {};
  const record = platforms[platform] || {};
  return lower(record.operational_state || record.status || record.verdict || "unknown");
}

function isReadyPlatform(platformState = {}, platform) {
  const platforms = platformState.platforms || platformState || {};
  const record = platforms[platform] || {};
  const state = platformOperationalState(platformState, platform);
  const status = lower(record.status);
  if (["disabled", "blocked", "deferred_until_platform_enabled"].includes(state)) return false;
  return ["ready", "ready_now", "green", "enabled", "active", "assumed_enabled"].includes(state) ||
    ["ready", "ready_now", "green", "enabled", "active"].includes(status);
}

function storyTitle(story = {}) {
  return clean(story.selected_title || story.title || story.canonical_title || story.canonical_subject);
}

function sourceLabel(source = {}) {
  const name = sourceName(source);
  const host = hostFromUrl(sourceUrl(source));
  return name || host || "Source";
}

function buildPostCopy(story = {}) {
  const title = storyTitle(story);
  const subject = clean(story.canonical_subject || story.canonical_game || story.canonical_company || title);
  const primary = sourceLabel(story.primary_source || story.official_source);
  const confirmed = asArray(story.confirmed_claims)[0] || clean(story.description) || title;
  const boundary = asArray(story.unconfirmed_claims).length
    ? "Confirmed so far: "
    : "";
  const conciseClaim = clean(confirmed).replace(/\.$/, "");
  return {
    x:
      `${subject}: ${conciseClaim}.\n\nSource: ${primary}.\n\nFull edit follows when the footage is ready.`,
    threads:
      `${subject}: ${boundary}${conciseClaim}. Source: ${primary}. If anything changes, the update goes here first.`,
    instagram_story_card: {
      headline: clean(story.thumbnail_headline || title).toUpperCase(),
      subhead: `Source: ${primary}`,
      claim_boundary: "confirmed_only",
    },
    facebook_card:
      `${subject}: ${conciseClaim}. Source: ${primary}. More context follows in the full edit.`,
  };
}

function evaluateBreakingStory(story = {}) {
  const title = storyTitle(story);
  const subject = clean(story.canonical_subject || story.canonical_game || story.canonical_company);
  const script = clean(story.narration_script || story.full_script || story.script || story.first_spoken_line);
  const sourceStrength = assessSourceStrength(story);
  const rejectionReasons = [];
  const warnings = [];

  if (!story.breaking_news_flag && lower(story.urgency_level) !== "high") {
    warnings.push("story_not_explicitly_marked_breaking");
  }
  if (sourceStrength.source_confidence_score < SOURCE_CONFIDENCE_THRESHOLD) {
    rejectionReasons.push("breaking_source_confidence_below_threshold");
  }
  if (
    !sourceStrength.has_official_source &&
    !sourceStrength.has_two_independent_reliable_sources &&
    !sourceStrength.has_publication_plus_attribution
  ) {
    rejectionReasons.push("insufficient_breaking_source_pattern");
  }
  if (sourceStrength.primary_is_discussion) {
    rejectionReasons.push("reddit_or_discussion_source_not_confirmation");
  }
  if (!subject) rejectionReasons.push("missing_canonical_subject");
  if (title.length < 12 || GENERIC_TITLE_RE.test(title)) rejectionReasons.push("generic_or_placeholder_title");
  if (subject && !includesSubject(`${title} ${story.first_spoken_line || ""}`, subject)) {
    rejectionReasons.push("canonical_subject_missing_from_title_or_opening");
  }
  const internalLeaks = containsInternalLanguage(`${title} ${script} ${story.description || ""}`);
  if (internalLeaks.length) rejectionReasons.push("internal_qa_language_in_public_copy");
  if (asArray(story.prohibited_claims).length) rejectionReasons.push("prohibited_claims_present");
  if (["finance", "crypto"].includes(lower(story.vertical))) {
    rejectionReasons.push("finance_crypto_requires_compliance_firewall");
  }
  if (story.affiliate_pack_id || lower(story.commercial_intent) === "affiliate") {
    rejectionReasons.push("affiliate_cta_not_allowed_in_breaking_fast_post");
  }

  return { title, subject, sourceStrength, rejectionReasons, warnings };
}

function buildFastPublishPack({ story = {}, platformState = {}, evaluation = {} } = {}) {
  const copy = buildPostCopy(story);
  const platformMap = [
    { platform: "x", output: "x", post: copy.x },
    { platform: "threads", output: "threads", post: copy.threads },
    { platform: "instagram_reels", output: "instagram_story_card", post: copy.instagram_story_card },
    { platform: "facebook_reels", output: "facebook_card", post: copy.facebook_card },
  ];
  const publishNow = [];
  const deferred = [];
  const platformPosts = {};

  if (!evaluation.rejectionReasons.length) {
    for (const item of platformMap) {
      const ready = isReadyPlatform(platformState, item.platform);
      if (ready) publishNow.push(item.output);
      else deferred.push(item.output === "instagram_story_card" ? "instagram" : item.output);
      platformPosts[item.output] = {
        mode: "BREAKING_NEWS_FAST_CARD",
        platform: item.output,
        status: ready ? "ready_for_operator_review" : "deferred_until_platform_enabled",
        claim_boundary: "confirmed_only",
        text: item.post,
        source_label: sourceLabel(story.primary_source || story.official_source),
        disclosure: "No affiliate CTA in breaking fast post.",
        operator_approval_required: true,
      };
    }
  }

  return {
    schema_version: 1,
    story_id: clean(story.story_id || story.id),
    mode: "BREAKING_NEWS_FAST_LANE",
    publish_now_platforms: publishNow,
    deferred_platforms: Array.from(new Set(deferred)),
    blocked_platforms: evaluation.rejectionReasons.length ? platformMap.map((item) => item.output) : [],
    platform_posts: platformPosts,
    safety: {
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      operator_approval_required: true,
    },
  };
}

function buildFollowUpV4Plan(story = {}) {
  return {
    schema_version: 1,
    story_id: clean(story.story_id || story.id),
    mode: "FOLLOW_UP_V4",
    target_duration_seconds: { min: 40, max: 70 },
    required_before_video_publish: [
      "canonical_story_manifest",
      "rights_ledger",
      "materialised_motion_clips",
      "distinct_motion_families",
      "final_narration_audio",
      "word_timestamps",
      "visual_v4_final_mp4",
      "benchmark_report",
      "platform_upload_preflight",
      "control_tower_green_or_human_review",
    ],
    source_lock: sourceRecordForOutput(
      sourceWithFallback(story.primary_source, story.primary_source_url) ||
        sourceWithFallback(story.official_source, story.official_source_url),
    ),
    story_angle: clean(story.canonical_angle || story.selected_title || story.title),
  };
}

function sourceRecordForOutput(source = {}) {
  return {
    name: sourceLabel(source),
    url: sourceUrl(source) || null,
    reliability: sourceReliability(source),
  };
}

function buildCorrectionWatch(story = {}) {
  return {
    schema_version: 1,
    story_id: clean(story.story_id || story.id),
    enabled: true,
    watch_sources: collectSources(story).map(sourceRecordForOutput),
    watched_claims: asArray(story.confirmed_claims).map(clean).filter(Boolean),
    correction_actions: [
      "update_fast_post_reply_or_comment",
      "update_landing_page",
      "queue_follow_up_correction_if_claim_changes",
      "disable_affiliate_links_if_later_added_and_claim_changes",
    ],
  };
}

function storyId(story = {}) {
  return clean(story.story_id || story.id);
}

function candidateScore({ story = {}, evaluation = {}, fastPublishPack = {}, reviewItem = {} } = {}) {
  const sourceStrength = evaluation.sourceStrength || {};
  const explicitBreaking = story.breaking_news_flag === true || lower(story.urgency_level) === "high";
  const officialSource = sourceStrength.has_official_source === true;
  const independentSources = Number(sourceStrength.reliable_independent_source_count || 0);
  const readyPlatformCount = asArray(fastPublishPack.publish_now_platforms).length;
  const confidence = Number(sourceStrength.source_confidence_score || 0);
  const reviewQuality = Number(
    reviewItem.quality_score ||
      reviewItem.scores?.quality_score ||
      reviewItem.scores?.script_score ||
      0,
  );
  return (
    (explicitBreaking ? 1000 : 0) +
    (officialSource ? 300 : 0) +
    Math.min(independentSources, 3) * 80 +
    readyPlatformCount * 25 +
    confidence +
    Math.min(reviewQuality, 100) / 10
  );
}

function buildBreakingNewsCandidateQueue({
  reviewQueue = {},
  storiesById = {},
  platformState = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const reviewItems = asArray(reviewQueue.review_items || reviewQueue.items || reviewQueue.stories);
  const candidates = reviewItems.map((item) => {
    const id = clean(item.story_id || item.id);
    const story = storiesById[id] || item.story || {};
    const evaluation = evaluateBreakingStory(story);
    const fastPublishPack = buildFastPublishPack({ story, platformState, evaluation });
    const rejectionReasons = asArray(evaluation.rejectionReasons);
    const eligible = rejectionReasons.length === 0 && asArray(fastPublishPack.publish_now_platforms).length > 0;
    return {
      story_id: id || storyId(story),
      title: evaluation.title,
      canonical_subject: evaluation.subject,
      eligible_for_fast_lane: eligible,
      ranking_score: Math.round(candidateScore({ story, evaluation, fastPublishPack, reviewItem: item })),
      source_strength: evaluation.sourceStrength,
      publish_now_platforms: asArray(fastPublishPack.publish_now_platforms),
      deferred_platforms: asArray(fastPublishPack.deferred_platforms),
      rejection_reasons: rejectionReasons,
      warnings: asArray(evaluation.warnings),
      evidence: {
        canonical_manifest_path: clean(item.evidence?.canonical_manifest_path),
        artifact_dir: clean(item.artifact_dir),
      },
    };
  });
  candidates.sort((a, b) => {
    if (a.eligible_for_fast_lane !== b.eligible_for_fast_lane) return a.eligible_for_fast_lane ? -1 : 1;
    if (b.ranking_score !== a.ranking_score) return b.ranking_score - a.ranking_score;
    return clean(a.story_id).localeCompare(clean(b.story_id));
  });
  const selected = candidates.find((candidate) => candidate.eligible_for_fast_lane) || null;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "BREAKING_NEWS_CANDIDATE_QUEUE",
    verdict: selected ? "AMBER" : "RED",
    selected_story_id: selected ? selected.story_id : null,
    selection_reason: selected
      ? "source_safe_candidate_ready_for_operator_review_fast_post"
      : "no_source_safe_fast_lane_candidate_ready_for_review",
    candidate_count: candidates.length,
    eligible_candidate_count: candidates.filter((candidate) => candidate.eligible_for_fast_lane).length,
    candidates,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      operator_approval_required: true,
    },
  };
}

async function buildGoalBreakingNewsFastLanePlan({
  story = {},
  platformState = {},
  candidateQueue = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const evaluation = evaluateBreakingStory(story);
  const fastPublishPack = buildFastPublishPack({ story, platformState, evaluation });
  const hasDeferred = fastPublishPack.deferred_platforms.length > 0;
  const verdict = evaluation.rejectionReasons.length ? "RED" : hasDeferred ? "AMBER" : "AMBER";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    breaking_news_manifest: {
      schema_version: 1,
      generated_at: generatedAt,
      story_id: clean(story.story_id || story.id),
      canonical_subject: evaluation.subject,
      title: evaluation.title,
      verdict,
      safe_to_fast_publish_now: false,
      operator_approval_required: true,
      source_strength: evaluation.sourceStrength,
      fast_lane_allowed: evaluation.rejectionReasons.length === 0,
      reason: evaluation.rejectionReasons.length
        ? "breaking_fast_lane_blocked"
        : "operator_review_required_before_any_fast_post",
    },
    fast_publish_pack: fastPublishPack,
    follow_up_v4_plan: buildFollowUpV4Plan(story),
    correction_watch: buildCorrectionWatch(story),
    ...(candidateQueue ? { breaking_news_candidate_queue: candidateQueue } : {}),
    rejection_reasons: evaluation.rejectionReasons,
    warnings: evaluation.warnings,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      operator_approval_required: true,
      affiliate_links_suppressed: true,
    },
  };
}

function buildBreakingNewsFastLaneOverview({
  platformState = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const fastPlatforms = ["x", "threads", "instagram_reels", "facebook_reels"];
  const readyForReview = [];
  const deferred = [];
  const platformReadiness = {};
  for (const platform of fastPlatforms) {
    const ready = isReadyPlatform(platformState, platform);
    const state = platformOperationalState(platformState, platform);
    if (ready) readyForReview.push(platform);
    else deferred.push(platform);
    platformReadiness[platform] = {
      status: ready ? "ready_for_operator_review" : "deferred_until_platform_enabled",
      operational_state: state,
    };
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "BREAKING_NEWS_FAST_LANE_OVERVIEW",
    verdict: "AMBER",
    required_input: "story_manifest",
    reason: "select_a_source_verified_breaking_story_before_generating_fast_posts",
    ready_for_review_platforms: readyForReview,
    deferred_platforms: deferred,
    platform_readiness: platformReadiness,
    required_source_pattern: [
      "official_source",
      "two_reliable_independent_sources",
      "one_reliable_publication_with_clear_attribution",
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_fast_post_without_story_manifest: true,
      operator_approval_required: true,
    },
  };
}

function renderBreakingNewsMarkdown(plan = {}) {
  const manifest = plan.breaking_news_manifest || {};
  const pack = plan.fast_publish_pack || {};
  const lines = [
    "# Breaking News Fast Lane",
    "",
    `Generated: ${plan.generated_at || "unknown"}`,
    `Verdict: ${manifest.verdict || "unknown"}`,
    `Story: ${manifest.title || manifest.story_id || "unknown"}`,
    "No uploads are triggered. Operator review is required before any fast post.",
    "",
    "## Ready For Review",
  ];
  for (const platform of asArray(pack.publish_now_platforms)) lines.push(`- ${platform}`);
  if (!asArray(pack.publish_now_platforms).length) lines.push("- none");
  if (asArray(pack.deferred_platforms).length) {
    lines.push("", "## Deferred Platforms");
    for (const platform of asArray(pack.deferred_platforms)) lines.push(`- ${platform}`);
  }
  if (asArray(plan.rejection_reasons).length) {
    lines.push("", "## Blockers");
    for (const reason of asArray(plan.rejection_reasons)) lines.push(`- ${reason}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderBreakingNewsOverviewMarkdown(overview = {}) {
  const lines = [
    "# Breaking News Fast Lane Overview",
    "",
    `Generated: ${overview.generated_at || "unknown"}`,
    `Verdict: ${overview.verdict || "unknown"}`,
    `Required input: ${overview.required_input || "story_manifest"}`,
    "No uploads are triggered. A source-verified story manifest is required before any fast post pack is generated.",
    "",
    "## Ready Platforms",
  ];
  for (const platform of asArray(overview.ready_for_review_platforms)) lines.push(`- ${platform}`);
  if (!asArray(overview.ready_for_review_platforms).length) lines.push("- none");
  if (asArray(overview.deferred_platforms).length) {
    lines.push("", "## Deferred Platforms");
    for (const platform of asArray(overview.deferred_platforms)) lines.push(`- ${platform}`);
  }
  lines.push("", "## Required Source Pattern");
  for (const pattern of asArray(overview.required_source_pattern)) lines.push(`- ${pattern}`);
  return `${lines.join("\n")}\n`;
}

async function writeBreakingNewsFastLaneOverview(overview = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeBreakingNewsFastLaneOverview requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const overviewPath = path.join(outDir, "breaking_news_fast_lane_overview.json");
  const markdownPath = path.join(outDir, "breaking_news_fast_lane_overview.md");
  await fs.writeJson(overviewPath, overview, { spaces: 2 });
  await fs.writeFile(markdownPath, renderBreakingNewsOverviewMarkdown(overview), "utf8");
  return { outputDir: outDir, overviewPath, markdownPath };
}

async function writeGoalBreakingNewsFastLanePlan(plan = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalBreakingNewsFastLanePlan requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const breakingNewsManifestPath = path.join(outDir, "breaking_news_manifest.json");
  const fastPublishPackPath = path.join(outDir, "fast_publish_pack.json");
  const followUpV4PlanPath = path.join(outDir, "follow_up_v4_plan.json");
  const correctionWatchPath = path.join(outDir, "correction_watch.json");
  const markdownPath = path.join(outDir, "breaking_news_fast_lane.md");
  const candidateQueuePath = path.join(outDir, "breaking_news_candidate_queue.json");
  await fs.writeJson(breakingNewsManifestPath, plan.breaking_news_manifest || {}, { spaces: 2 });
  await fs.writeJson(fastPublishPackPath, plan.fast_publish_pack || {}, { spaces: 2 });
  await fs.writeJson(followUpV4PlanPath, plan.follow_up_v4_plan || {}, { spaces: 2 });
  await fs.writeJson(correctionWatchPath, plan.correction_watch || {}, { spaces: 2 });
  if (plan.breaking_news_candidate_queue) {
    await fs.writeJson(candidateQueuePath, plan.breaking_news_candidate_queue, { spaces: 2 });
  }
  await fs.writeFile(markdownPath, renderBreakingNewsMarkdown(plan), "utf8");
  return {
    outputDir: outDir,
    breakingNewsManifestPath,
    fastPublishPackPath,
    followUpV4PlanPath,
    correctionWatchPath,
    candidateQueuePath: plan.breaking_news_candidate_queue ? candidateQueuePath : null,
    markdownPath,
  };
}

module.exports = {
  SOURCE_CONFIDENCE_THRESHOLD,
  buildBreakingNewsCandidateQueue,
  buildBreakingNewsFastLaneOverview,
  buildGoalBreakingNewsFastLanePlan,
  renderBreakingNewsOverviewMarkdown,
  renderBreakingNewsMarkdown,
  writeBreakingNewsFastLaneOverview,
  writeGoalBreakingNewsFastLanePlan,
};
