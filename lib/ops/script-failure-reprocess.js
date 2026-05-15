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
const REPROCESSABLE_COHERENCE_FAILURE_PATTERNS = [
  "script_coherence:missing_exact_cta_in_script",
  "script_coherence:cta_not_exact",
  "script_coherence:vague_filler:",
  "script_coherence:abstract_signal_language",
  "script_coherence:repeated_sentence:",
  "script_coherence:unsupported_verified_insider_framing",
  "script_coherence:verified_reddit_post_as_source",
  "script_coherence:redditor_as_source_fact",
  "script_coherence:hedged_story_overclaimed",
  "script_coherence:misexpanded_ea_as_electronic_arts",
  "script_coherence:orphan_entity_contamination:",
  "script_coherence:generic_uncertainty_boilerplate",
  "script_coherence:internal_pulse_framing",
  "script_coherence:mangled_stop_killing_games_campaign",
  "script_coherence:false_bill_ownership",
];
const NON_REPROCESSABLE_COHERENCE_FAILURE_PATTERNS = [
  "script_coherence:general_reddit_thread_as_news",
  "script_coherence:vague_sources_on_general_reddit",
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

function hasNonRedditArticleSource(story = {}) {
  const url = String(story.article_url || story.source_url || "").trim();
  if (!/^https?:\/\//i.test(url) || /reddit\.com/i.test(url)) return false;
  if (/\b(?:i|preview)\.redd\.it\b/i.test(url)) return false;
  if (/\bv\.redd\.it\b/i.test(url)) return false;
  if (/\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return false;
  return true;
}

function isTrustedLeakSource(story = {}) {
  const subreddit = String(story.subreddit || story.source_name || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
  return subreddit === "gamingleaksandrumours";
}

function isSourceBackedRepairCandidate(story = {}) {
  const sourceType = String(story.source_type || "").toLowerCase();
  return (
    sourceType === "rss" ||
    hasNonRedditArticleSource(story) ||
    isTrustedLeakSource(story)
  );
}

function isReprocessableCoherenceReason(reason = "", story = {}) {
  const text = String(reason || "");
  if (!text.startsWith("script_coherence:")) return false;
  if (
    NON_REPROCESSABLE_COHERENCE_FAILURE_PATTERNS.some((pattern) =>
      text.includes(pattern),
    )
  ) {
    return false;
  }
  if (text.includes("script_coherence:top_comment_used_as_fact")) {
    return hasNonRedditArticleSource(story) || String(story.source_type || "").toLowerCase() === "rss";
  }
  if (!isSourceBackedRepairCandidate(story)) return false;
  return REPROCESSABLE_COHERENCE_FAILURE_PATTERNS.some((pattern) =>
    text.includes(pattern),
  );
}

function isReprocessableFailureReason(reason = "", story = {}) {
  const text = String(reason || "");
  if (isReprocessableCoherenceReason(text, story)) return true;
  return REPROCESSABLE_FAILURE_PATTERNS.some((pattern) => text.includes(pattern));
}

function isLocalLlmFetchFailureStory(story = {}) {
  const reasons = getScriptFailureReasons(story);
  return reasons.some((reason) => reason.includes(FAILURE_NEEDLE));
}

function isReprocessableScriptFailureStory(story = {}) {
  const reasons = getScriptFailureReasons(story);
  return reasons.some((reason) => isReprocessableFailureReason(reason, story));
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
        reasons.find((item) => isReprocessableFailureReason(item, story)) ||
        FAILURE_NEEDLE;
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
  REPROCESSABLE_COHERENCE_FAILURE_PATTERNS,
  REPROCESSABLE_FAILURE_PATTERNS,
  buildScriptFailureReprocessReport,
  classifyReprocessedStory,
  formatScriptFailureReprocessMarkdown,
  getScriptFailureReasons,
  isReprocessableCoherenceReason,
  isReprocessableFailureReason,
  isLocalLlmFetchFailureStory,
  isReprocessableScriptFailureStory,
  isSourceBackedRepairCandidate,
  selectLocalLlmFetchFailureStories,
  selectReprocessableScriptFailureStories,
  storyHasPlatformPost,
};
