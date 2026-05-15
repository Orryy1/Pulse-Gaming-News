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

function publishCandidateBlocker(story = {}) {
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
    const publishBlocker = publishCandidateBlocker(s);
    if (publishBlocker) return `publish_blocked:${publishBlocker}`;
  }
  return "awaiting_publish";
}

/**
 * Pick the next likely publish candidate. Mirrors publishNextStory's
 * "fewest platforms done first, then score" sort so the backlog
 * surface matches what would actually get picked at the next
 * publish window.
 */
function nextPublishCandidate(stories, options = {}) {
  const corePlatforms = normaliseCorePlatforms(options.corePlatforms);
  const requiredCount = corePlatforms.length;
  const eligible = stories.filter((s) => {
    if (!s || !s.approved || !s.exported_path) return false;
    if (s.qa_failed === true) return false;
    if (publishCandidateBlocker(s)) return false;
    return coreDoneCount(s, corePlatforms) < requiredCount;
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const aDone = coreDoneCount(a, corePlatforms);
    const bDone = coreDoneCount(b, corePlatforms);
    if (aDone !== bDone) return aDone - bDone;
    return (
      (b.breaking_score || b.score || 0) - (a.breaking_score || a.score || 0)
    );
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
 */
function buildPipelineBacklog(stories) {
  if (!Array.isArray(stories)) stories = [];
  const options =
    arguments.length > 1 && arguments[1] && typeof arguments[1] === "object"
      ? arguments[1]
      : {};
  const corePlatforms = normaliseCorePlatforms(options.corePlatforms);
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
    blocking_reason: blockingReason(s, { corePlatforms }),
  }));

  return {
    generated_at: new Date().toISOString(),
    counts,
    next_produce_candidate: nextProduceCandidate(stories),
    next_publish_candidate: nextPublishCandidate(stories, { corePlatforms }),
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
    lines.push(`- ${c.id}: ${c.title || ""} (${c.eligible_because || "unknown"})`);
  } else {
    lines.push("- none");
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
  isRealPostId,
  coreDoneCount,
  publishCandidateBlocker,
  storyDurationSeconds,
  requiredCorePlatformsFromEnv,
  DEFAULT_CORE_PLATFORMS,
  MAX_STUCK,
};
