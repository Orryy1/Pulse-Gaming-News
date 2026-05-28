/**
 * lib/services/pipeline-backlog.js — operator backlog summary.
 *
 * Returns counts + "why is the top-N stuck" analysis for the
 * stories table. Consumed by GET /api/pipeline/backlog (Task 12).
 *
 * Pure / sync — caller hands in the raw stories[] array, we
 * compute everything. No DB, no filesystem, no tokens.
 *
 * Shape:
 *   {
 *     generated_at,
 *     counts: {
 *       review,              // approval pending
 *       approved_not_produced,
 *       produced_not_published,
 *       partial,             // 1-3/4 core platforms live
 *       failed,              // all 4 core attempted + failed
 *       qa_failed,           // content-qa or video-qa blocked
 *       published            // success
 *     },
 *     next_produce_candidate: { id, title, reason } | null,
 *     next_publish_candidate: { id, title, eligible_because } | null,
 *     stuck_top10: [
 *       { id, title, stage, blocking_reason }
 *     ]
 *   }
 *
 * No raw editorial fields (full_script, pinned_comment, hook,
 * body, loop) are emitted. Only id + title + high-level stage
 * metadata — same privacy bar as /api/analytics/digest.
 */

const MAX_STUCK = 10;
const DEFAULT_CORE_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook"];
const DEFAULT_STALE_BACKLOG_MAX_DAYS = 7;

const {
  classifyArticleContextRisk,
  MIN_DISTINCT_VISUAL_COUNT,
} = require("./content-qa");
const { runPublicOutputCoherenceGate } = require("../public-output-manifest");

function isRealPostId(id) {
  return typeof id === "string" && id.length > 0 && !id.startsWith("DUPE_");
}

function envExplicitFalse(env, name) {
  return /^(false|0|no|off)$/i.test(String(env?.[name] || "").trim());
}

function requiredCorePlatformsFromEnv(env = process.env) {
  return DEFAULT_CORE_PLATFORMS.filter((platform) => {
    if (platform !== "tiktok") return true;
    return !(
      envExplicitFalse(env, "TIKTOK_ENABLED") ||
      envExplicitFalse(env, "TIKTOK_AUTO_UPLOAD_ENABLED")
    );
  });
}

function normaliseCorePlatforms(input) {
  const platforms = Array.isArray(input) && input.length > 0
    ? input
    : DEFAULT_CORE_PLATFORMS;
  const filtered = platforms
    .map((platform) => String(platform || "").trim().toLowerCase())
    .filter((platform) => DEFAULT_CORE_PLATFORMS.includes(platform));
  return filtered.length > 0 ? filtered : DEFAULT_CORE_PLATFORMS;
}

function postIdForPlatform(s, platform) {
  if (!s) return null;
  if (platform === "youtube") return s.youtube_post_id;
  if (platform === "tiktok") return s.tiktok_post_id;
  if (platform === "instagram") return s.instagram_media_id;
  if (platform === "facebook") return s.facebook_post_id;
  return null;
}

function coreDoneCount(s, corePlatforms = DEFAULT_CORE_PLATFORMS) {
  return normaliseCorePlatforms(corePlatforms).filter((platform) =>
    isRealPostId(postIdForPlatform(s, platform)),
  ).length;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function storyDurationSeconds(story = {}) {
  return (
    numberOrNull(story.duration_seconds) ??
    numberOrNull(story.audio_duration) ??
    numberOrNull(story.video_duration_seconds) ??
    numberOrNull(story.runtime_seconds) ??
    numberOrNull(story.final_duration_seconds)
  );
}

function subtitleTimingBlocker(story = {}) {
  const inspection = story.subtitle_timing_inspection;
  if (!inspection || typeof inspection !== "object") return null;
  if (inspection.usable === false) {
    const reason = String(
      inspection.reason || story.subtitle_timing_warning || "unusable",
    ).trim();
    return `subtitle_timing_unusable:${reason || "unusable"}`;
  }
  return null;
}

function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function storyAgeMs(story = {}, nowMs = Date.now()) {
  const raw =
    story.approved_at ||
    story.produced_at ||
    story.created_at ||
    story.timestamp ||
    story.updated_at;
  const parsed = raw ? Date.parse(raw) : NaN;
  if (!Number.isFinite(parsed)) return null;
  return nowMs - parsed;
}

function staleBacklogMaxAgeMs(env = process.env) {
  const days = Number(env?.PUBLISH_STALE_BACKLOG_MAX_DAYS);
  const safeDays =
    Number.isFinite(days) && days >= 1 ? days : DEFAULT_STALE_BACKLOG_MAX_DAYS;
  return safeDays * 24 * 60 * 60 * 1000;
}

function staleBacklogBlocker(story = {}, options = {}) {
  const env = options.env || process.env;
  if (env?.ALLOW_STALE_BACKLOG_PUBLISH === "true") return null;
  const age = storyAgeMs(story, options.nowMs || Date.now());
  if (age === null) return null;
  if (age > staleBacklogMaxAgeMs(env)) return "stale_unpublished_backlog";
  return null;
}

function instagramTerminalProcessingBlocker(story = {}) {
  const message = String(
    story.instagram_error ||
      story.instagram_reel_error ||
      story.publish_error ||
      "",
  );
  if (!message) return null;
  if (/2207076/i.test(message)) {
    return "instagram_reel_processing_rejected_2207076_requires_rerender";
  }
  if (
    /Instagram (?:URL )?processing failed/i.test(message) &&
    /2207052|Media upload has failed|unsupported|codec|pix_fmt|profile|aspect/i.test(
      message,
    )
  ) {
    return "instagram_reel_processing_rejected_requires_rerender";
  }
  return null;
}

function publicOutputBlocker(story = {}, options = {}) {
  if (options.strictContentQa !== true) return null;
  const publicTitle =
    story.public_title ||
    story.upload_title ||
    story.suggested_title ||
    story.title ||
    "";
  const script = story.full_script || story.tts_script || story.body || story.hook || "";
  const hasPublicMetadataSurface = Boolean(
    publicTitle ||
      story.suggested_thumbnail_text ||
      story.thumbnail_source_label ||
      story.source_card_label ||
      story.source_type ||
      story.article_url,
  );
  if (!hasPublicMetadataSurface || String(script).trim().length < 10) return null;

  const gate = runPublicOutputCoherenceGate({
    story,
    publicTitle,
    script,
    thumbnailText: story.suggested_thumbnail_text,
    thumbnailSourceLabel: story.thumbnail_source_label,
    sourceCardLabel: story.source_card_label,
    requireCaptionEvidence: false,
  });
  return gate.failures[0] || null;
}

function strictContentBlocker(story = {}, options = {}) {
  const instagramProcessing = instagramTerminalProcessingBlocker(story);
  if (instagramProcessing) return instagramProcessing;

  if (story.script_generation_status === "review_required") {
    return `script_generation_review:${story.script_review_reason || "validation_failed"}`;
  }
  const script = story.full_script || story.tts_script || story.body || story.hook;
  if (!script) return "script_missing";

  const publicOutput = publicOutputBlocker(story, options);
  if (publicOutput) return publicOutput;

  const articleContextRisk = classifyArticleContextRisk(
    parseArrayField(story.downloaded_images),
  );
  if (articleContextRisk.blocked) {
    return `risky_article_context_dominated_deck (${articleContextRisk.risky_count} risky article images, ${articleContextRisk.safe_non_article_count} safe non-article images)`;
  }

  const env = options.env || process.env;
  const blockThinVisuals =
    options.blockThinVisuals === true ||
    options.strictContentQa === true ||
    env?.BLOCK_THIN_VISUALS === "true";
  if (
    blockThinVisuals &&
    typeof story.qa_visual_count === "number" &&
    story.qa_visual_count < MIN_DISTINCT_VISUAL_COUNT &&
    story.allow_thin_visuals !== true
  ) {
    return `thin_visuals_blocked:${story.qa_visual_warning || "thin_visuals_below_three"}`;
  }

  return null;
}

function premiumRenderContractBlocker(story = {}, options = {}) {
  const env = options.env || process.env;
  const premiumRequired =
    story.require_studio_v4_premium_publish === true ||
    env?.STUDIO_V4_PREMIUM_PUBLISH_GATE === "true";
  if (!premiumRequired) return null;
  if (
    story.allow_legacy_render_emergency === true ||
    env?.STUDIO_V4_ALLOW_LEGACY_FALLBACK === "true" ||
    env?.ALLOW_EMERGENCY_RENDER_FALLBACK === "true"
  ) {
    return null;
  }

  const missing = [];
  const lane = String(story.render_lane || "");
  if (!["studio_v4", "studio_v4_canonical"].includes(lane)) {
    missing.push("studio_v4_render_lane_required");
  }
  if (story.render_quality_class !== "premium") {
    missing.push("render_quality_class_premium_required");
  }
  const benchmark =
    story.media_house_benchmark && typeof story.media_house_benchmark === "object"
      ? story.media_house_benchmark
      : {};
  if (benchmark.result !== "pass") {
    missing.push("media_house_benchmark_pass_required");
  }
  const motionDensity = Number(benchmark.scores?.motion_density_score);
  if (!Number.isFinite(motionDensity) || motionDensity < 75) {
    missing.push("motion_density_below_v4_floor");
  }
  const polish = Number(benchmark.scores?.media_house_polish_score);
  if (!Number.isFinite(polish) || polish < 75) {
    missing.push("media_house_polish_below_v4_floor");
  }
  return missing.length
    ? `premium_contract_required: got=${story.render_quality_class || "unknown"}, missing=${missing.join("+")}`
    : null;
}

function publishCandidateBlocker(story = {}, options = {}) {
  const stale = staleBacklogBlocker(story, options);
  if (stale) return stale;
  const premium = premiumRenderContractBlocker(story, options);
  if (premium) return premium;
  const content = strictContentBlocker(story, options);
  if (content) return content;
  const duration = storyDurationSeconds(story);
  if (duration != null && duration < 60) {
    return `duration_too_short_${duration.toFixed(2)}s`;
  }
  if (duration != null && duration > 95) {
    return `duration_too_long_${duration.toFixed(2)}s`;
  }
  return subtitleTimingBlocker(story);
}

/**
 * Classify a story into one bucket so the operator can read the
 * counts at a glance. Priority order matters — a QA-failed story
 * that also lacks a script is still surfaced as qa_failed because
 * that's the recent actionable state.
 */
function classifyStage(s) {
  if (!s || typeof s !== "object") return "other";
  if (s.qa_failed === true) return "qa_failed";
  if (s.publish_status === "published") return "published";
  if (s.publish_status === "partial") return "partial";
  if (s.publish_status === "failed") return "failed";
  if (s.exported_path) return "produced_not_published";
  if (s.approved === true) return "approved_not_produced";
  if (s.classification === "[REVIEW]") return "review";
  if (!s.approved) return "review";
  return "other";
}

/**
 * Assign a human-readable reason for why a story is stuck.
 * Used for the top-10 stuck list.
 */
function blockingReason(s, options = {}) {
  if (!s) return "story_missing";
  const corePlatforms = normaliseCorePlatforms(options.corePlatforms);
  if (s.qa_failed === true && Array.isArray(s.qa_failures)) {
    return `qa:${s.qa_failures[0] || "unknown"}`;
  }
  if (s.script_generation_status === "review_required") {
    return `script_generation_review:${s.script_review_reason || "validation_failed"}`;
  }
  if (!s.full_script && !s.hook) return "no_script";
  if (!s.approved) return "awaiting_approval";
  if (!s.exported_path) return "awaiting_produce";
  if (s.publish_status === "partial") {
    const missing = corePlatforms.filter(
      (platform) => !isRealPostId(postIdForPlatform(s, platform)),
    );
    return `partial_missing:${missing.join(",") || "none"}`;
  }
  if (s.publish_status === "failed") {
    return `failed:${s.publish_error || "unknown"}`;
  }
  if (s.publish_status === "publishing") return "publish_in_progress";
  if (s.approved && s.exported_path) {
    const publishBlocker = publishCandidateBlocker(s, options);
    if (publishBlocker) return `publish_blocked:${publishBlocker}`;
  }
  return "awaiting_publish";
}

/**
 * Pick the next likely publish candidate. Mirrors publishNextStory's
 * "fewest platforms done first, then selection score" sort so the
 * backlog surface matches what would actually get picked at the next
 * publish window.
 */
function nextPublishCandidate(stories, options = {}) {
  const corePlatforms = normaliseCorePlatforms(options.corePlatforms);
  const requiredCount = corePlatforms.length;
  const selectionScore =
    typeof options.selectionScore === "function"
      ? options.selectionScore
      : (story) => Number(story.breaking_score || story.score || 0);
  const eligible = stories.filter((s) => {
    if (!s || !s.approved || !s.exported_path) return false;
    if (s.qa_failed === true) return false;
    if (publishCandidateBlocker(s, options)) return false;
    return coreDoneCount(s, corePlatforms) < requiredCount;
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const aDone = coreDoneCount(a, corePlatforms);
    const bDone = coreDoneCount(b, corePlatforms);
    if (aDone !== bDone) return aDone - bDone;
    const aSelectionScore = Number(selectionScore(a));
    const bSelectionScore = Number(selectionScore(b));
    const aScore = Number.isFinite(aSelectionScore)
      ? aSelectionScore
      : Number(a.breaking_score || a.score || 0);
    const bScore = Number.isFinite(bSelectionScore)
      ? bSelectionScore
      : Number(b.breaking_score || b.score || 0);
    return bScore - aScore;
  });
  const pick = eligible[0];
  const doneN = coreDoneCount(pick, corePlatforms);
  const eligibleBecause =
    doneN === 0
      ? "awaiting_first_upload"
      : `partial_needs_${requiredCount - doneN}_more_platforms`;
  return {
    id: pick.id,
    title: (pick.title || "").slice(0, 160),
    eligible_because: eligibleBecause,
  };
}

function bridgePublishReadiness(candidateReport = {}) {
  if (!candidateReport || typeof candidateReport !== "object") return null;
  const bridge = candidateReport.bridge_candidates || {};
  const preflight = candidateReport.preflight_qa || {};
  const candidateCount = Number(bridge.count ?? candidateReport.candidates?.length ?? 0);
  const checked = Number(preflight.candidates_checked ?? 0);
  const pass = Number(preflight.pass ?? 0);
  const blocked = Number(preflight.blocked ?? 0);
  const warning = Number(preflight.warning ?? 0);
  if (![candidateCount, checked, pass, blocked, warning].some((value) => Number.isFinite(value) && value > 0)) {
    return null;
  }
  return {
    source: "scheduler_bridge_preflight",
    candidate_count: Number.isFinite(candidateCount) ? candidateCount : 0,
    preflight_checked_count: Number.isFinite(checked) ? checked : 0,
    preflight_pass_count: Number.isFinite(pass) ? pass : 0,
    preflight_blocked_count: Number.isFinite(blocked) ? blocked : 0,
    preflight_warning_count: Number.isFinite(warning) ? warning : 0,
    live_fallback_used: bridge.live_fallback_used === true,
    mode: bridge.mode || null,
  };
}

function bridgeCandidateRepairLanes(candidate = {}) {
  const blockers = [
    ...(Array.isArray(candidate.preflight_qa?.blockers) ? candidate.preflight_qa.blockers : []),
    ...Object.values(candidate.preflight_qa?.checks || {}).flatMap((check) =>
      Array.isArray(check?.failures) ? check.failures : [],
    ),
  ].map((blocker) => String(blocker || "").toLowerCase());
  const lanes = [];
  if (blockers.some((blocker) => blocker.includes("script_scorecard") || blocker.includes("script_score"))) {
    lanes.push("script_rewrite_and_audio_rerender");
  }
  if (blockers.some((blocker) => blocker.includes("aggregate_benchmark") || blocker.includes("goal09") || blocker.includes("goal08") || blocker.includes("goal07"))) {
    lanes.push("sound_visual_benchmark_repair");
  }
  if (blockers.some((blocker) => blocker.includes("motion_density") || blocker.includes("direct_video") || blocker.includes("visual_evidence"))) {
    lanes.push("real_motion_or_source_family_repair");
  }
  if (!lanes.length) lanes.push("scheduler_preflight_blocker_triage");
  return [...new Set(lanes)];
}

function bridgeCandidateRepairCommands(candidate = {}) {
  const storyId = String(candidate.id || candidate.story_id || "").trim();
  if (!storyId) return [];
  const lanes = bridgeCandidateRepairLanes(candidate);
  const commands = [];
  if (lanes.includes("script_rewrite_and_audio_rerender")) {
    commands.push(`npm run ops:goal-public-copy-repair -- --story-id ${storyId} --out-dir output/goal-contract --json`);
    commands.push(`npm run ops:goal-audio-materialize -- --story-id ${storyId} --out-dir output/goal-contract --json`);
    commands.push(`npm run ops:goal-production-render -- --story-id ${storyId} --out-dir output/goal-contract --json`);
  }
  if (lanes.includes("sound_visual_benchmark_repair")) {
    commands.push("npm run ops:goal09-sound-design-engine -- --out-dir output/goal-09 --json");
    commands.push("npm run ops:goal10-gold-standard-forensics -- --out-dir output/goal-10 --json");
  }
  if (lanes.includes("real_motion_or_source_family_repair")) {
    commands.push(`npm run ops:v4-source-family-acquisition -- --story-id ${storyId} --out-dir output/goal-contract --json`);
    commands.push(`npm run ops:goal-real-motion -- --story-id ${storyId} --out-dir output/goal-contract --json`);
  }
  commands.push(`npm run ops:next-publish-candidates -- --story-id ${storyId} --json`);
  return [...new Set(commands)];
}

function schedulerBridgeBlockedCandidates(candidateReport = {}) {
  const candidates = Array.isArray(candidateReport?.candidates)
    ? candidateReport.candidates
    : [];
  return candidates
    .filter((candidate) => {
      if (!candidate || typeof candidate !== "object") return false;
      return String(candidate.preflight_qa?.status || "").toLowerCase() === "blocked";
    })
    .map((candidate) => ({
      id: candidate.id || candidate.story_id || "unknown",
      title: String(candidate.title || "").slice(0, 160),
      status: candidate.status || null,
      preflight_status: candidate.preflight_qa?.status || "blocked",
      preflight_blockers: Array.isArray(candidate.preflight_qa?.blockers)
        ? candidate.preflight_qa.blockers
        : [],
      repair_lanes: bridgeCandidateRepairLanes(candidate),
      recommended_commands: bridgeCandidateRepairCommands(candidate),
      duration_seconds: storyDurationSeconds(candidate),
    }));
}

function nextBridgePublishCandidate(candidateReport = {}) {
  const candidates = Array.isArray(candidateReport?.candidates)
    ? candidateReport.candidates
    : [];
  const pick = candidates.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    if (!["publish_ready", "ready"].includes(String(candidate.status || "").toLowerCase())) return false;
    const preflightStatus = String(candidate.preflight_qa?.status || "").toLowerCase();
    return preflightStatus === "pass";
  });
  if (!pick) return null;
  const duration = storyDurationSeconds(pick);
  return {
    id: pick.id,
    title: (pick.title || "").slice(0, 160),
    eligible_because: "scheduler_bridge_preflight_pass",
    source: "scheduler_bridge_preflight",
    preflight_status: "pass",
    duration_seconds: duration,
  };
}

function nextProduceCandidate(stories) {
  const eligible = stories.filter(
    (s) =>
      s &&
      s.approved &&
      !s.exported_path &&
      s.qa_failed !== true &&
      s.script_generation_status !== "review_required",
  );
  if (eligible.length === 0) return null;
  // Sort by breaking_score desc — same rough order that the
  // scoring engine would auto-approve in.
  eligible.sort(
    (a, b) =>
      (b.breaking_score || b.score || 0) - (a.breaking_score || a.score || 0),
  );
  const pick = eligible[0];
  return {
    id: pick.id,
    title: (pick.title || "").slice(0, 160),
    reason: pick.full_script ? "script_ready" : "script_pending",
  };
}

/**
 * Build the full backlog payload.
 * @param {any[]} stories
 * @param {{ corePlatforms?: string[], selectionScore?: (story: any) => number }} [options]
 */
function buildPipelineBacklog(stories, options = {}) {
  if (!Array.isArray(stories)) stories = [];
  if (!options || typeof options !== "object") options = {};
  const corePlatforms = normaliseCorePlatforms(options.corePlatforms);
  const candidateOptions = {
    ...options,
    corePlatforms,
  };
  const counts = {
    review: 0,
    approved_not_produced: 0,
    produced_not_published: 0,
    partial: 0,
    failed: 0,
    qa_failed: 0,
    published: 0,
    other: 0,
  };
  for (const s of stories) {
    const stage = classifyStage(s);
    counts[stage] = (counts[stage] || 0) + 1;
  }

  // Top-10 stuck: anything that's not published and not freshly
  // awaiting_approval. Sort by age (created_at desc → surface
  // recent drafts first; operators usually care about today's
  // backlog more than last month's).
  const stuckAll = stories
    .filter((s) => {
      if (!s) return false;
      const stage = classifyStage(s);
      return stage !== "published" && stage !== "other";
    })
    .slice()
    .sort((a, b) => {
      const ac = a.created_at || a.timestamp || "";
      const bc = b.created_at || b.timestamp || "";
      return bc.localeCompare(ac);
    });
  const stuck_top10 = stuckAll.slice(0, MAX_STUCK).map((s) => ({
    id: s.id,
    title: (s.title || "").slice(0, 160),
    stage: classifyStage(s),
    blocking_reason: blockingReason(s, candidateOptions),
  }));
  const liveNextPublishCandidate = nextPublishCandidate(stories, {
    ...candidateOptions,
    selectionScore: options.selectionScore,
  });
  const schedulerBridgeReport = options.schedulerBridgeCandidateReport || options.bridgeCandidateReport || {};
  const schedulerBridgeNextPublishCandidate = nextBridgePublishCandidate(schedulerBridgeReport);
  const schedulerBridgePublishReadiness = bridgePublishReadiness(schedulerBridgeReport);
  const schedulerBridgeBlocked = schedulerBridgeBlockedCandidates(schedulerBridgeReport);

  return {
    generated_at: new Date().toISOString(),
    counts,
    next_produce_candidate: nextProduceCandidate(stories),
    next_publish_candidate: liveNextPublishCandidate
      ? { ...liveNextPublishCandidate, source: "live_db" }
      : schedulerBridgeNextPublishCandidate,
    live_next_publish_candidate: liveNextPublishCandidate
      ? { ...liveNextPublishCandidate, source: "live_db" }
      : null,
    scheduler_bridge_next_publish_candidate: schedulerBridgeNextPublishCandidate,
    scheduler_bridge_publish_readiness: schedulerBridgePublishReadiness,
    scheduler_bridge_blocked_candidates: schedulerBridgeBlocked,
    stuck_top10,
  };
}

function renderPipelineBacklogMarkdown(report = {}) {
  const counts = report.counts || {};
  const lines = [];
  lines.push("# Pipeline Backlog");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "unknown"}`);
  lines.push("");
  lines.push("## Counts");
  for (const key of [
    "review",
    "approved_not_produced",
    "produced_not_published",
    "partial",
    "failed",
    "qa_failed",
    "published",
    "other",
  ]) {
    lines.push(`- ${key}: ${Number(counts[key] || 0)}`);
  }
  lines.push("");
  lines.push("## Next Produce Candidate");
  if (report.next_produce_candidate) {
    const c = report.next_produce_candidate;
    lines.push(`- ${c.id}: ${c.title || ""} (${c.reason || "unknown"})`);
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Next Publish Candidate");
  if (report.next_publish_candidate) {
    const c = report.next_publish_candidate;
    const source = c.source ? `, source=${c.source}` : "";
    lines.push(`- ${c.id}: ${c.title || ""} (${c.eligible_because || "unknown"}${source})`);
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Scheduler Bridge");
  const bridge = report.scheduler_bridge_publish_readiness;
  if (bridge) {
    lines.push(`- mode: ${bridge.mode || "unknown"}`);
    lines.push(`- candidates: ${Number(bridge.candidate_count || 0)}`);
    lines.push(`- preflight pass: ${Number(bridge.preflight_pass_count || 0)}`);
    lines.push(`- preflight blocked: ${Number(bridge.preflight_blocked_count || 0)}`);
    lines.push(`- live fallback used: ${bridge.live_fallback_used ? "yes" : "no"}`);
    if (report.scheduler_bridge_next_publish_candidate) {
      const c = report.scheduler_bridge_next_publish_candidate;
      lines.push(`- next bridge candidate: ${c.id}: ${c.title || ""}`);
    }
  } else {
    lines.push("- no scheduler bridge candidate report loaded");
  }
  lines.push("");
  lines.push("## Scheduler Bridge Blockers");
  const blockedBridge = Array.isArray(report.scheduler_bridge_blocked_candidates)
    ? report.scheduler_bridge_blocked_candidates
    : [];
  if (!blockedBridge.length) {
    lines.push("- none");
  } else {
    for (const item of blockedBridge) {
      const blockers = (item.preflight_blockers || []).slice(0, 3).join(", ") || "unknown";
      const lanes = (item.repair_lanes || []).join(", ") || "scheduler_preflight_blocker_triage";
      lines.push(`- ${item.id}: ${lanes} - ${blockers} - ${item.title || ""}`);
    }
  }
  lines.push("");
  lines.push("## Stuck Top 10");
  const stuck = Array.isArray(report.stuck_top10) ? report.stuck_top10 : [];
  if (!stuck.length) {
    lines.push("- none");
  } else {
    for (const item of stuck) {
      lines.push(
        `- ${item.id}: ${item.stage} - ${item.blocking_reason || "unknown"} - ${item.title || ""}`,
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- read-only summary");
  lines.push("- no production DB, token, OAuth, Railway or platform posting changes");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildPipelineBacklog,
  classifyStage,
  blockingReason,
  renderPipelineBacklogMarkdown,
  nextProduceCandidate,
  nextPublishCandidate,
  nextBridgePublishCandidate,
  isRealPostId,
  instagramTerminalProcessingBlocker,
  coreDoneCount,
  bridgePublishReadiness,
  schedulerBridgeBlockedCandidates,
  publicOutputBlocker,
  premiumRenderContractBlocker,
  publishCandidateBlocker,
  staleBacklogBlocker,
  strictContentBlocker,
  storyDurationSeconds,
  requiredCorePlatformsFromEnv,
  DEFAULT_CORE_PLATFORMS,
  MAX_STUCK,
};
