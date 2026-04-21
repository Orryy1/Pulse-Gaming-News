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

function isRealPostId(id) {
  return typeof id === "string" && id.length > 0 && !id.startsWith("DUPE_");
}

function coreDoneCount(s) {
  let n = 0;
  if (isRealPostId(s.youtube_post_id)) n++;
  if (isRealPostId(s.tiktok_post_id)) n++;
  if (isRealPostId(s.instagram_media_id)) n++;
  if (isRealPostId(s.facebook_post_id)) n++;
  return n;
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
function blockingReason(s) {
  if (!s) return "story_missing";
  if (!s.full_script && !s.hook) return "no_script";
  if (s.qa_failed === true && Array.isArray(s.qa_failures)) {
    return `qa:${s.qa_failures[0] || "unknown"}`;
  }
  if (!s.approved) return "awaiting_approval";
  if (!s.exported_path) return "awaiting_produce";
  if (s.publish_status === "partial") {
    const missing = [];
    if (!isRealPostId(s.youtube_post_id)) missing.push("youtube");
    if (!isRealPostId(s.tiktok_post_id)) missing.push("tiktok");
    if (!isRealPostId(s.instagram_media_id)) missing.push("instagram");
    if (!isRealPostId(s.facebook_post_id)) missing.push("facebook");
    return `partial_missing:${missing.join(",") || "none"}`;
  }
  if (s.publish_status === "failed") {
    return `failed:${s.publish_error || "unknown"}`;
  }
  if (s.publish_status === "publishing") return "publish_in_progress";
  return "awaiting_publish";
}

/**
 * Pick the next likely publish candidate. Mirrors publishNextStory's
 * "fewest platforms done first, then score" sort so the backlog
 * surface matches what would actually get picked at the next
 * publish window.
 */
function nextPublishCandidate(stories) {
  const eligible = stories.filter((s) => {
    if (!s || !s.approved || !s.exported_path) return false;
    if (s.qa_failed === true) return false;
    return coreDoneCount(s) < 4; // 4 core platforms
  });
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    const aDone = coreDoneCount(a);
    const bDone = coreDoneCount(b);
    if (aDone !== bDone) return aDone - bDone;
    return (
      (b.breaking_score || b.score || 0) - (a.breaking_score || a.score || 0)
    );
  });
  const pick = eligible[0];
  const doneN = coreDoneCount(pick);
  const eligibleBecause =
    doneN === 0
      ? "awaiting_first_upload"
      : `partial_needs_${4 - doneN}_more_platforms`;
  return {
    id: pick.id,
    title: (pick.title || "").slice(0, 160),
    eligible_because: eligibleBecause,
  };
}

function nextProduceCandidate(stories) {
  const eligible = stories.filter(
    (s) => s && s.approved && !s.exported_path && s.qa_failed !== true,
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
    blocking_reason: blockingReason(s),
  }));

  return {
    generated_at: new Date().toISOString(),
    counts,
    next_produce_candidate: nextProduceCandidate(stories),
    next_publish_candidate: nextPublishCandidate(stories),
    stuck_top10,
  };
}

module.exports = {
  buildPipelineBacklog,
  classifyStage,
  blockingReason,
  nextProduceCandidate,
  nextPublishCandidate,
  isRealPostId,
  coreDoneCount,
  MAX_STUCK,
};
