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
const {
  isPersistableScriptReady,
  prepareScriptRepairRow,
} = require("../../tools/reprocess-script-failures");

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
        id: "rss-false-bill-owner",
        source_type: "rss",
        subreddit: "Rock Paper Shotgun",
        title: "California game preservation bill needs repair",
        script_review_reason: "script_coherence:false_bill_ownership",
      },
      {
        id: "rss-mangled-campaign",
        source_type: "rss",
        subreddit: "Rock Paper Shotgun",
        title: "Stop Killing Games campaign name needs repair",
        script_review_reason:
          "script_coherence:mangled_stop_killing_games_campaign",
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
      {
        id: "video-only",
        source_type: "reddit",
        subreddit: "pcmasterrace",
        article_url: "https://v.redd.it/direct-video",
        title: "Video-only Reddit post should not be treated as sourced news",
        script_review_reason: "script_coherence:missing_exact_cta_in_script",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "rss-cta",
      "linked-article",
      "trusted-leak",
      "rss-false-bill-owner",
      "rss-mangled-campaign",
      "comment-with-article",
    ],
  );
  assert.match(
    rows[1].script_failure_reprocess_reason,
    /script_coherence:vague_filler/,
  );
});

test("selectReprocessableScriptFailureStories can force explicit unpublished story repair", () => {
  const rows = selectReprocessableScriptFailureStories({
    forceStoryIds: true,
    storyIds: ["short-audio", "public"],
    stories: [
      {
        id: "short-audio",
        title: "Approved story has short local audio and needs a clean rewrite",
        source_type: "reddit",
        subreddit: "pcgaming",
      },
      {
        id: "public",
        title: "Do not force already-public rows",
        youtube_post_id: "yt_public",
      },
      {
        id: "other",
        title: "Do not bulk force rows",
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), ["short-audio"]);
  assert.equal(rows[0].script_failure_reprocess_reason, "explicit_story_reprocess");
});

test("classifyReprocessedStory separates script-ready from still-review rows", () => {
  assert.deepEqual(classifyReprocessedStory({ full_script: "A real script", word_count: 3 }), {
    status: "script_ready",
    reason: "3_words",
  });
  assert.deepEqual(
    classifyReprocessedStory({
      full_script: "A generated script that still failed persistence.",
      word_count: 8,
      reprocess_persisted: false,
      reprocess_persist_skip_reason: "not_script_ready",
    }),
    {
      status: "still_review",
      reason: "not_script_ready",
    },
  );
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

test("isPersistableScriptReady prevents apply-local from writing review placeholders", () => {
  const readyScript = `${Array.from(
    { length: 175 },
    (_, i) => `subnautica_fact_${i + 1}`,
  ).join(" ")} Follow Pulse Gaming so you never miss a beat.`;

  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "review_required",
      full_script: "",
      word_count: 0,
    }),
    false,
  );
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      full_script: readyScript,
      cta: "Follow Pulse Gaming so you never miss a beat.",
      word_count: 184,
    }),
    true,
  );
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      full_script: "   ",
      word_count: 0,
    }),
    false,
  );
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      full_script: "Nintendo confirmed a useful update today.",
      cta: "Follow Pulse Gaming so you never miss a beat.",
      word_count: 6,
    }),
    false,
  );
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      full_script: `${"The community is buzzing about this update. ".repeat(25)}Follow Pulse Gaming so you never miss a beat.`,
      cta: "Follow Pulse Gaming so you never miss a beat.",
      word_count: 184,
    }),
    false,
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
  assert.match(tool, /--llm-timeout-ms/);
  assert.match(tool, /--llm-provider/);
  assert.match(tool, /--max-attempts/);
  assert.match(tool, /--force-story/);
  assert.match(tool, /--source-bound-only/);
  assert.match(tool, /--skip-editor/);
  assert.match(tool, /LLM_REQUEST_TIMEOUT_MS/);
  assert.match(tool, /process\.env\.LLM_PROVIDER/);
  assert.match(tool, /maxScriptAttempts/);
  assert.match(tool, /skipEditorPass/);
  assert.match(tool, /for \(const candidate of candidates\)/);
  assert.match(tool, /postDiscord: false/);
  assert.match(tool, /persist: false/);
  assert.match(tool, /isPersistableScriptReady/);
  assert.match(tool, /prepareScriptRepairRow/);
  assert.match(tool, /db\.upsertStory\(prepared\)/);
  assert.match(tool, /reprocess_persist_skip_reason = "not_script_ready"/);
  assert.match(tool, /backupFileName/);
  assert.match(tool, /db\.getDb\(\)\.backup/);
});

test("reprocess tool args include bounded local LLM timeout", () => {
  const {
    DEFAULT_REPROCESS_LLM_TIMEOUT_MS,
    DEFAULT_REPROCESS_MAX_ATTEMPTS,
    parseArgs,
  } = require("../../tools/reprocess-script-failures");

  assert.equal(parseArgs([]).llmTimeoutMs, DEFAULT_REPROCESS_LLM_TIMEOUT_MS);
  assert.equal(parseArgs([]).maxAttempts, DEFAULT_REPROCESS_MAX_ATTEMPTS);
  assert.equal(parseArgs([]).skipEditor, true);
  assert.equal(
    parseArgs(["--llm-timeout-ms", "9000", "--limit", "1"]).llmTimeoutMs,
    9000,
  );
  assert.equal(parseArgs(["--llm-timeout-ms=12000"]).llmTimeoutMs, 12000);
  assert.equal(parseArgs(["--llm-provider", "anthropic"]).llmProvider, "anthropic");
  assert.equal(parseArgs(["--llm-provider=local"]).llmProvider, "local");
  assert.equal(parseArgs(["--max-attempts", "2"]).maxAttempts, 2);
  assert.equal(parseArgs(["--max-attempts=3"]).maxAttempts, 3);
  assert.equal(parseArgs(["--editor"]).skipEditor, false);
  assert.equal(parseArgs(["--force-story"]).forceStory, true);
  assert.equal(parseArgs(["--source-bound-only"]).sourceBoundOnly, true);
});

test("prepareScriptRepairRow clears stale audio and render outputs", () => {
  const row = prepareScriptRepairRow({
    id: "story",
    title: "Forza Horizon 6 immediately beats its predecessor's all-time Steam record",
    suggested_title: "Forza Horizon 6",
    full_script:
      "Forza Horizon 6 just put up a wild Steam number. ".repeat(35) +
      "Follow Pulse Gaming so you never miss a beat.",
    audio_path: "output/audio/story.mp3",
    exported_path: "output/final/story.mp4",
    publish_status: "failed",
    publish_error: "old_failure",
    script_review_reason: "old_review",
    script_validation_errors: ["old_review"],
  });

  assert.equal(row.audio_path, null);
  assert.equal(row.exported_path, null);
  assert.equal(row.publish_status, null);
  assert.equal(row.publish_error, null);
  assert.equal(row.tts_script, row.full_script.trim());
  assert.equal(row.script_review_reason, "");
  assert.deepEqual(row.script_validation_errors, []);
  assert.ok(row.title_variants.includes("Forza 6 Just Beat Horizon 5"));
});

test("source-bound-only reprocess builds a clean local repair row", async () => {
  const { parseArgs, reprocessCandidate } = require("../../tools/reprocess-script-failures");
  const rows = await reprocessCandidate(
    {
      id: "forza",
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players – and that's only counting people willing to pay $120 for early access",
      source_type: "reddit",
      subreddit: "pcgaming",
      article_url: "https://www.gamesradar.com/example",
      audio_path: "output/audio/forza.mp3",
      exported_path: "output/final/forza.mp4",
    },
    parseArgs(["--source-bound-only"]),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].script_generation_status, "script_ready");
  assert.equal(rows[0].audio_path, null);
  assert.equal(rows[0].exported_path, null);
  assert.doesNotMatch(rows[0].full_script, /,\./);
  assert.match(rows[0].full_script, /GamesRadar reports/);
});

test("processor clears stale review metadata after a successful reprocess", () => {
  const source = fs.readFileSync(path.join(ROOT, "processor.js"), "utf8");
  assert.match(source, /script_generation_status:\s*requiresScriptReview/);
  assert.match(source, /:\s*"script_ready"/);
  assert.match(source, /script_validation_errors:\s*requiresScriptReview/);
});
