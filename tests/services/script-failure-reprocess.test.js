"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  FAILURE_NEEDLE,
  buildScriptFailureReprocessReport,
  classifyReprocessedStory,
  formatScriptFailureReprocessMarkdown,
  selectLocalLlmFetchFailureStories,
  selectReprocessableScriptFailureStories,
} = require("../../lib/ops/script-failure-reprocess");

const ROOT = path.resolve(__dirname, "..", "..");

test("selectLocalLlmFetchFailureStories targets only stale local LLM fetch failures", () => {
  const rows = selectLocalLlmFetchFailureStories({
    stories: [
      {
        id: "retry",
        title: "Retry this",
        script_review_reason: FAILURE_NEEDLE,
      },
      {
        id: "published",
        title: "Do not touch public rows",
        script_review_reason: FAILURE_NEEDLE,
        youtube_post_id: "yt_public",
      },
      {
        id: "manual",
        title: "Different review reason",
        script_review_reason: "Hook too long",
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), ["retry"]);
  assert.equal(rows[0].script_failure_reprocess_reason, FAILURE_NEEDLE);
});

test("selectLocalLlmFetchFailureStories honours story filter and limit", () => {
  const rows = selectLocalLlmFetchFailureStories({
    limit: 1,
    storyIds: ["b", "c"],
    stories: [
      { id: "a", script_review_reason: FAILURE_NEEDLE },
      { id: "b", script_review_reason: FAILURE_NEEDLE },
      { id: "c", script_review_reason: FAILURE_NEEDLE },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), ["b"]);
});

test("selectReprocessableScriptFailureStories also targets fixable validation reviews", () => {
  const rows = selectReprocessableScriptFailureStories({
    stories: [
      {
        id: "hook",
        title: "Retry hook",
        script_review_reason: "Hook too long (35 words) - must be under 25 words for punch",
      },
      {
        id: "safe-wording",
        title: "Retry wording",
        script_review_reason: 'Advertiser-safety warning: contains "killed"',
      },
      {
        id: "short-count",
        title: "Retry short Flash Lane count",
        script_review_reason:
          "Actual spoken word count 70 outside 90-110 Flash Lane range",
      },
      {
        id: "public",
        title: "Already public",
        script_review_reason: "Hook too long",
        youtube_post_id: "yt_public",
      },
      {
        id: "manual",
        title: "Real manual review",
        script_review_reason: "source_conflict_manual_review",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["hook", "safe-wording", "short-count"],
  );
  assert.match(rows[0].script_failure_reprocess_reason, /Hook too long/);
});

test("selectReprocessableScriptFailureStories targets source-backed coherence repairs only", () => {
  const rows = selectReprocessableScriptFailureStories({
    stories: [
      {
        id: "rss-cta",
        source_type: "rss",
        subreddit: "IGN",
        title: "Official update needs CTA repair",
        script_review_reason: "script_coherence:missing_exact_cta_in_script",
      },
      {
        id: "linked-article",
        source_type: "reddit",
        subreddit: "pcgaming",
        title: "Article-backed story needs filler repair",
        article_url: "https://www.eurogamer.net/article-backed-story",
        script_review_reason:
          "script_coherence:vague_filler:community_is_buzzing",
      },
      {
        id: "trusted-leak",
        source_type: "reddit",
        subreddit: "GamingLeaksAndRumours",
        title: "Trusted leak story needs wording repair",
        script_review_reason:
          "script_coherence:unsupported_verified_insider_framing",
      },
      {
        id: "community-thread",
        source_type: "reddit",
        subreddit: "gaming",
        title: "Community discussion should not be recycled",
        script_review_reason: "script_coherence:general_reddit_thread_as_news",
      },
      {
        id: "vague-general-reddit",
        source_type: "reddit",
        subreddit: "pcmasterrace",
        title: "General Reddit source claim should not be recycled",
        script_review_reason: "script_coherence:vague_sources_on_general_reddit",
      },
      {
        id: "comment-as-source",
        source_type: "reddit",
        subreddit: "GamingLeaksAndRumours",
        title: "Comment-only leak should not be recycled",
        script_review_reason: "script_coherence:top_comment_used_as_fact",
      },
      {
        id: "comment-with-article",
        source_type: "reddit",
        subreddit: "pcgaming",
        article_url: "https://videocardz.com/newz/real-source",
        title: "Article-backed comment misuse can be repaired",
        script_review_reason: "script_coherence:top_comment_used_as_fact",
      },
      {
        id: "image-only",
        source_type: "reddit",
        subreddit: "gaming",
        article_url: "https://i.redd.it/image-only.jpeg",
        title: "Image-only Reddit post should not be treated as sourced news",
        script_review_reason: "script_coherence:missing_exact_cta_in_script",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    ["rss-cta", "linked-article", "trusted-leak", "comment-with-article"],
  );
  assert.match(
    rows[1].script_failure_reprocess_reason,
    /script_coherence:vague_filler/,
  );
});

test("classifyReprocessedStory separates script-ready from still-review rows", () => {
  assert.deepEqual(classifyReprocessedStory({ full_script: "A real script", word_count: 3 }), {
    status: "script_ready",
    reason: "3_words",
  });
  assert.deepEqual(
    classifyReprocessedStory({
      script_generation_status: "review_required",
      script_review_reason: "Hook too long",
    }),
    {
      status: "still_review",
      reason: "Hook too long",
    },
  );
});

test("buildScriptFailureReprocessReport is safe by default", () => {
  const report = buildScriptFailureReprocessReport({
    candidates: [{ id: "retry" }],
    results: [{ id: "retry", title: "Retry", full_script: "Script", word_count: 1 }],
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.safety.discord_posting, false);
  assert.equal(report.safety.social_posting, false);
  assert.equal(report.safety.db_mutation, false);
  assert.equal(report.summary.script_ready, 1);
});

test("formatScriptFailureReprocessMarkdown is operator-readable", () => {
  const md = formatScriptFailureReprocessMarkdown(
    buildScriptFailureReprocessReport({
      mode: "apply_local",
      candidates: [{ id: "retry" }],
      results: [{ id: "retry", title: "Retry title", full_script: "Script" }],
    }),
  );

  assert.match(md, /Script Failure Reprocess Report/);
  assert.match(md, /DB mutation: true/);
  assert.match(md, /retry: script_ready/);
});

test("ops:reprocess-script-failures command is registered and dry-run first", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    pkg.scripts["ops:reprocess-script-failures"],
    "node tools/reprocess-script-failures.js",
  );
  const tool = fs.readFileSync(
    path.join(ROOT, "tools", "reprocess-script-failures.js"),
    "utf8",
  );
  assert.match(tool, /Default is dry-run/);
  assert.match(tool, /selectReprocessableScriptFailureStories/);
  assert.match(tool, /--apply-local/);
  assert.match(tool, /postDiscord: false/);
  assert.match(tool, /backupFileName/);
  assert.match(tool, /db\.getDb\(\)\.backup/);
});

test("processor clears stale review metadata after a successful reprocess", () => {
  const source = fs.readFileSync(path.join(ROOT, "processor.js"), "utf8");
  assert.match(source, /script_generation_status:\s*requiresScriptReview/);
  assert.match(source, /:\s*"script_ready"/);
  assert.match(source, /script_validation_errors:\s*requiresScriptReview/);
});
