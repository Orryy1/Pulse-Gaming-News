"use strict";

const FAILURE_NEEDLE =
  "script_generation_error:Local LLM request failed: fetch failed";
const REPROCESSABLE_FAILURE_PATTERNS = [
  FAILURE_NEEDLE,
  "Hook too long",
  "Advertiser-safety warning",
  "Actual spoken word count",
  "script_runtime_extended_review_required",
  "script_runtime_unknown",
];

function storyHasPlatformPost(story = {}) {
  return Boolean(
    story.youtube_post_id ||
      story.tiktok_post_id ||
      story.instagram_media_id ||
      story.facebook_post_id ||
      story.twitter_post_id ||
      story.published_at,
  );
}

function getScriptFailureReasons(story = {}) {
  const reasons = [];
  if (story.script_review_reason) reasons.push(story.script_review_reason);
  if (Array.isArray(story.script_validation_errors)) {
    reasons.push(...story.script_validation_errors);
  }
  if (story.publish_error) reasons.push(story.publish_error);
  return reasons.filter(Boolean).map(String);
}

function isLocalLlmFetchFailureStory(story = {}) {
  const reasons = getScriptFailureReasons(story);
  return reasons.some((reason) => reason.includes(FAILURE_NEEDLE));
}

function isReprocessableScriptFailureStory(story = {}) {
  const reasons = getScriptFailureReasons(story);
  return reasons.some((reason) =>
    REPROCESSABLE_FAILURE_PATTERNS.some((pattern) => reason.includes(pattern)),
  );
}

function selectLocalLlmFetchFailureStories({
  stories = [],
  limit = 25,
  storyIds = [],
} = {}) {
  const wanted = new Set((storyIds || []).filter(Boolean));
  return (stories || [])
    .filter((story) => story && story.id)
    .filter((story) => wanted.size === 0 || wanted.has(story.id))
    .filter(isLocalLlmFetchFailureStory)
    .filter((story) => !storyHasPlatformPost(story))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((story) => ({
      ...story,
      script_failure_reprocess_reason: FAILURE_NEEDLE,
    }));
}

function selectReprocessableScriptFailureStories({
  stories = [],
  limit = 25,
  storyIds = [],
} = {}) {
  const wanted = new Set((storyIds || []).filter(Boolean));
  return (stories || [])
    .filter((story) => story && story.id)
    .filter((story) => wanted.size === 0 || wanted.has(story.id))
    .filter(isReprocessableScriptFailureStory)
    .filter((story) => !storyHasPlatformPost(story))
    .slice(0, Math.max(0, Number(limit) || 0))
    .map((story) => {
      const reasons = getScriptFailureReasons(story);
      const reason =
        reasons.find((item) =>
          REPROCESSABLE_FAILURE_PATTERNS.some((pattern) => item.includes(pattern)),
        ) || FAILURE_NEEDLE;
      return {
        ...story,
        script_failure_reprocess_reason: reason,
      };
    });
}

function classifyReprocessedStory(story = {}) {
  const fullScript = String(story.full_script || "").trim();
  if (story.script_generation_status === "review_required") {
    return {
      status: "still_review",
      reason:
        story.script_review_reason ||
        story.script_validation_errors?.[0] ||
        "review_required",
    };
  }
  if (!fullScript) {
    return { status: "failed", reason: "missing_full_script" };
  }
  return {
    status: "script_ready",
    reason: `${story.word_count || 0}_words`,
  };
}

function buildScriptFailureReprocessReport({
  mode = "dry_run",
  candidates = [],
  results = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = (results || []).map((story) => {
    const verdict = classifyReprocessedStory(story);
    return {
      story_id: story.id,
      title: story.title,
      status: verdict.status,
      reason: verdict.reason,
      word_count: story.word_count || 0,
      approved: story.approved === true,
      auto_approved: story.auto_approved === true,
      format_route: story.format_route || story.runtime_route || null,
    };
  });
  return {
    generated_at: generatedAt,
    mode,
    safety: {
      discord_posting: false,
      social_posting: false,
      db_mutation: mode === "apply_local",
      targeted_failure: FAILURE_NEEDLE,
    },
    summary: {
      candidates: candidates.length,
      processed: rows.length,
      script_ready: rows.filter((row) => row.status === "script_ready").length,
      still_review: rows.filter((row) => row.status === "still_review").length,
      failed: rows.filter((row) => row.status === "failed").length,
    },
    rows,
  };
}

function formatScriptFailureReprocessMarkdown(report = {}) {
  const lines = [
    "# Script Failure Reprocess Report",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Mode: ${report.mode || "unknown"}`,
    "",
    "## Safety",
    `- DB mutation: ${report.safety?.db_mutation === true}`,
    report.backup_path ? `- Backup: ${report.backup_path}` : "- Backup: not required",
    "- Discord posting: false",
    "- Social posting: false",
    `- Targeted failure: ${report.safety?.targeted_failure || FAILURE_NEEDLE}`,
    "",
    "## Summary",
    `- Candidates: ${report.summary?.candidates || 0}`,
    `- Processed: ${report.summary?.processed || 0}`,
    `- Script-ready: ${report.summary?.script_ready || 0}`,
    `- Still review: ${report.summary?.still_review || 0}`,
    `- Failed: ${report.summary?.failed || 0}`,
    "",
    "## Rows",
  ];

  if (!report.rows || report.rows.length === 0) {
    lines.push("- none");
  } else {
    for (const row of report.rows) {
      lines.push(
        `- ${row.story_id}: ${row.status} (${row.reason}) - ${row.title}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

module.exports = {
  FAILURE_NEEDLE,
  REPROCESSABLE_FAILURE_PATTERNS,
  buildScriptFailureReprocessReport,
  classifyReprocessedStory,
  formatScriptFailureReprocessMarkdown,
  getScriptFailureReasons,
  isLocalLlmFetchFailureStory,
  isReprocessableScriptFailureStory,
  selectLocalLlmFetchFailureStories,
  selectReprocessableScriptFailureStories,
  storyHasPlatformPost,
};
