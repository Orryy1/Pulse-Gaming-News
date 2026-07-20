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

test("selectReprocessableScriptFailureStories targets current publish blocker repairs", () => {
  const rows = selectReprocessableScriptFailureStories({
    stories: [
      {
        id: "duration-too-long",
        title: "Runtime needs tightening",
        script_validation_errors: ["qa:duration_too_long"],
      },
      {
        id: "audio-too-long",
        title: "Audio runtime needs tightening",
        publish_error: "content_qa:audio_duration_too_long",
      },
      {
        id: "glued-tts",
        source_type: "rss",
        subreddit: "IGN",
        title: "Source-backed story has glued narration",
        publish_error: "content_qa:glued_sentence_in_tts_script",
      },
      {
        id: "placeholder-public-copy",
        source_type: "reddit",
        subreddit: "pcgaming",
        article_url: "https://www.eurogamer.net/real-source",
        title: "Article-backed story has placeholder copy",
        publish_error: "content_qa:public_output:placeholder_title",
      },
      {
        id: "published-placeholder",
        source_type: "rss",
        subreddit: "GameSpot",
        title: "Already public row stays untouched",
        publish_error: "content_qa:public_output:placeholder_title",
        youtube_post_id: "yt_public",
      },
      {
        id: "community-placeholder",
        source_type: "reddit",
        subreddit: "gaming",
        title: "Unsourced community thread stays out of source-bound repair",
        publish_error: "content_qa:public_output:placeholder_title",
      },
    ],
  });

  assert.deepEqual(
    rows.map((row) => row.id),
    [
      "duration-too-long",
      "audio-too-long",
      "glued-tts",
      "placeholder-public-copy",
    ],
  );
  assert.match(rows[3].script_failure_reprocess_reason, /placeholder_title/);
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

test("selectReprocessableScriptFailureStories excludes advertiser-unsafe repair rows", () => {
  const rows = selectReprocessableScriptFailureStories({
    forceStoryIds: true,
    storyIds: ["unsafe-crude", "safe-story"],
    stories: [
      {
        id: "unsafe-crude",
        title:
          "Dispatch tackles Nintendo Switch censorship requirements where the dong should be",
        source_type: "rss",
        subreddit: "PC Gamer",
        script_review_reason: "Hook too long",
      },
      {
        id: "safe-story",
        title: "Forza Horizon 6 gets a fresh Steam player-count update",
        source_type: "rss",
        subreddit: "GamesRadar",
        script_review_reason: "Hook too long",
      },
    ],
  });

  assert.deepEqual(rows.map((row) => row.id), ["safe-story"]);
});

test("isPersistableScriptReady refuses advertiser-unsafe source titles", () => {
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      title:
        "Dispatch tackles Nintendo Switch censorship requirements where the dong should be",
      source_type: "rss",
      subreddit: "PC Gamer",
      full_script:
        "Dispatch just ran into a platform-censorship problem on Nintendo Switch. " +
        "PC Gamer reports the PC game update changed visual details to meet console requirements. " +
        "That matters because players often treat ports as the same game until one platform starts asking for edits. " +
        "The useful split is clear: this is not a gameplay balance change, it is a platform rules story. " +
        "For players, the question is whether the Switch version still feels like the same release after the edits. " +
        "If the port keeps the joke intact, the censorship argument gets smaller. " +
        "If it feels compromised, the platform becomes part of the review. " +
        "Follow Pulse Gaming so you never miss a beat.",
      cta: "Follow Pulse Gaming so you never miss a beat.",
      word_count: 118,
      script_source: "source_bound_fallback",
      format_route: "flash_short",
    }),
    false,
  );
});

test("classifyReprocessedStory separates script-ready from still-review rows", () => {
  assert.deepEqual(classifyReprocessedStory({ full_script: "A real script", word_count: 3 }), {
    status: "script_ready",
    reason: "3_words",
  });
  assert.deepEqual(
    classifyReprocessedStory({
      full_script: "A generated source-bound briefing script.",
      word_count: 186,
      format_route: "review_or_briefing",
    }),
    {
      status: "still_review",
      reason: "format_route_not_short:review_or_briefing",
    },
  );
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
  const readyScript =
    "Forza Horizon 6 hit 130,000 Steam players before its standard launch. " +
    "GamesRadar reports that this paid early crowd arrived before the standard audience fully opened. " +
    "The uncomfortable detail is not just the number. " +
    "It is who counted: people willing to move early, pay attention and in some cases spend $120 before the cheap wave lands. " +
    "That makes the launch harder to dismiss as trailer hype, because paid early demand carries more weight than wishlist noise. " +
    "The catch is that early-access peaks can cool down quickly once the first weekend ends. " +
    "For players, retention is the proof point before anyone calls it a long-term win. " +
    "The split matters: reviews point to quality, while early Steam numbers show who paid attention before the cheaper route opened. " +
    "The next pressure point is the normal launch: it either builds on the premium crowd or exposes a short-lived spike. " +
    "The stronger read separates the proof point from launch-week theatre. " +
    "That gives players a clearer way to judge the next marketing wave. " +
    "If the next wave holds, this becomes a momentum story, not just a leaderboard screenshot. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const tightenOnlyScript =
    "GTA 5 just became the GTA 6 waiting room. " +
    "GameSpot reports GTA 5 has joined a subscription service ahead of GTA 6. " +
    "That is the useful bit: Rockstar can keep old players close without asking everyone to buy the same game again. " +
    "The catch is that subscription libraries move, so this is access, not ownership. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const fullLengthTightenOnlyScript =
    "Nintendo just made one Switch 2 setting harder to ignore. " +
    "IGN reports Nintendo has updated its Switch 2 support notes with a new controller setting for players. " +
    "The useful part is simple: this is not a new game announcement, but it does change how people set up the console before a busy release month. " +
    "The catch is that settings stories only matter when they remove friction players actually feel. " +
    "A quiet menu change can still save time if it stops people digging through options before a download, update or local multiplayer session. " +
    "For players, the question is whether Nintendo explains the setting clearly enough that normal users find it without a forum thread. " +
    "That is the small but real payoff here: console launches do not only live on giant trailers. " +
    "They also live on boring settings that either disappear into the background or annoy people every time they pick up a controller. " +
    "If this update makes setup cleaner, it earns its place. " +
    "If it stays buried, most players will never know it exists. " +
    "Follow Pulse Gaming so you never miss a beat.";

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
      word_count: 196,
      source_name: "GamesRadar",
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players",
      script_source: "source_bound_fallback",
    }),
    true,
  );
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      full_script: tightenOnlyScript,
      cta: "Follow Pulse Gaming so you never miss a beat.",
      word_count: 53,
      source_name: "GameSpot",
      title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
    }),
    false,
  );
  assert.equal(
    isPersistableScriptReady({
      script_generation_status: "script_ready",
      full_script: fullLengthTightenOnlyScript,
      cta: "Follow Pulse Gaming so you never miss a beat.",
      word_count: 182,
      source_name: "IGN",
      title: "Nintendo Updates A Switch 2 Controller Setting",
      script_source: "source_bound_fallback",
    }),
    false,
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
      word_count: 219,
    }),
    false,
  );
});

test("buildScriptFailureReprocessReport is safe by default", () => {
  const report = buildScriptFailureReprocessReport({
    candidates: [{ id: "retry" }],
    results: [
      { id: "retry", title: "Retry", full_script: "Script", word_count: 1 },
      {
        id: "briefing",
        title: "Briefing",
        full_script: "Longer source-bound script",
        word_count: 186,
        format_route: "review_or_briefing",
      },
    ],
  });

  assert.equal(report.mode, "dry_run");
  assert.equal(report.safety.discord_posting, false);
  assert.equal(report.safety.social_posting, false);
  assert.equal(report.safety.db_mutation, false);
  assert.equal(report.summary.script_ready, 1);
  assert.equal(report.summary.still_review, 1);
  assert.equal(report.rows[1].status, "still_review");
  assert.equal(report.rows[1].reason, "format_route_not_short:review_or_briefing");
});

test("buildScriptFailureReprocessReport includes excluded forced work orders", () => {
  const report = buildScriptFailureReprocessReport({
    candidates: [],
    results: [],
    excluded: [
      {
        story_id: "already_public",
        title: "Already public story",
        reason: "already_public_platform_post",
      },
    ],
  });

  assert.equal(report.summary.excluded, 1);
  assert.deepEqual(report.excluded[0], {
    story_id: "already_public",
    title: "Already public story",
    reason: "already_public_platform_post",
  });
  assert.match(formatScriptFailureReprocessMarkdown(report), /already_public_platform_post/);
});

test("forced reprocess reports already-public rows instead of silently no-oping", () => {
  const {
    buildReprocessExclusions,
    parseArgs,
  } = require("../../tools/reprocess-script-failures");
  const args = parseArgs([
    "--story-id",
    "public_story",
    "--force-story",
    "--source-bound-only",
    "--dry-run",
  ]);
  const excluded = buildReprocessExclusions({
    args,
    stories: [
      {
        id: "public_story",
        title: "Public row should not be reprocessed",
        youtube_post_id: "yt_123",
      },
    ],
    candidates: [],
  });

  assert.deepEqual(excluded, [
    {
      story_id: "public_story",
      title: "Public row should not be reprocessed",
      reason: "already_public_platform_post",
      db_story_present: true,
      package_manifest_hydrated: false,
    },
  ]);
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
  assert.equal(parseArgs(["--apply-local", "--dry-run"]).applyLocal, false);
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

test("source-bound local scripts below old 200 WPM floor are still persistable when Liam pacing passes", () => {
  const { isPersistableScriptReady } = require("../../tools/reprocess-script-failures");
  const { buildSourceBoundFallbackScript } = require("../../lib/source-bound-script-writer");
  const story = {
    id: "valorant_vanguard",
    title:
      "Valorant's new Vanguard update seems to be bricking cheaters' PCs. Riot's response? \"Congrats on your $6k paperweights\"",
    source_type: "reddit",
    subreddit: "pcgaming",
    article_url:
      "https://www.pcgamesn.com/valorant/vanguard-update-bricking-cheaters-pcs",
  };
  const script = buildSourceBoundFallbackScript(story, {
    env: { TTS_PROVIDER: "local" },
    sourceMaterial:
      "PCGamesN reports Riot says Vanguard cannot brick a PC, but the anti-cheat update can block DMA cheat hardware.",
  });

  assert.ok(script.word_count < 204, `expected conservative local script, got ${script.word_count}`);
  assert.equal(
    isPersistableScriptReady(
      { ...story, ...script, tts_script: script.full_script },
      { TTS_PROVIDER: "local" },
    ),
    true,
  );
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

test("source-bound-only reprocess replaces stale briefing route with short route", async () => {
  const { parseArgs, reprocessCandidate } = require("../../tools/reprocess-script-failures");
  const rows = await reprocessCandidate(
    {
      id: "stale_briefing_route",
      title:
        "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players",
      source_type: "reddit",
      subreddit: "pcgaming",
      article_url: "https://www.gamesradar.com/example",
      format_route: "review_or_briefing",
      runtime_route: "review_or_briefing",
    },
    parseArgs(["--source-bound-only"]),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].script_generation_status, "script_ready");
  assert.equal(rows[0].format_route, "flash_short");
  assert.equal(rows[0].runtime_route, "flash_short");
  assert.equal(classifyReprocessedStory(rows[0]).status, "script_ready");
});

test("source-bound-only reprocess repairs Bungie active-development narration without review-score drift", async () => {
  const { parseArgs, reprocessCandidate } = require("../../tools/reprocess-script-failures");
  const rows = await reprocessCandidate(
    {
      id: "bungie_active_development",
      title:
        "\"Almost All\" Of Bungie Reportedly Didn't Know Destiny 2 Was Ending Active Development Until It Was Announced",
      source_type: "reddit",
      subreddit: "GamingLeaksAndRumours",
      article_url:
        "https://thegamepost.com/bungie-destiny-2-active-development-ending/",
      description:
        "The Game Post reports that almost all Bungie staff did not know Destiny 2 was ending active development until the announcement went public.",
      audio_path: "output/audio/bungie_active_development.mp3",
      exported_path: "output/final/bungie_active_development.mp4",
    },
    parseArgs(["--source-bound-only"]),
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].script_generation_status, "script_ready");
  assert.equal(rows[0].audio_path, null);
  assert.equal(rows[0].exported_path, null);
  assert.match(rows[0].full_script, /Destiny 2/i);
  assert.match(rows[0].full_script, /The Game Post reports/i);
  assert.doesNotMatch(rows[0].full_script, /review score|critic badge|Metacritic|store-banner/i);
});

test("forced story reprocess hydrates queue-only package manifests", async () => {
  const {
    buildStoryPoolForReprocess,
    parseArgs,
  } = require("../../tools/reprocess-script-failures");
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "pulse-reprocess-package-"));
  const packageDir = path.join(tmp, "package", "queue_only_story");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, "visual_v4_render.mp4"), "fake mp4");
  fs.writeFileSync(
    path.join(packageDir, "canonical_story_manifest.json"),
    JSON.stringify(
      {
        story_id: "queue_only_story",
        title: "Robo-Ky Delay Puts Guilty Gear On Trial",
        source_type: "rss",
        primary_source: "GameSpot",
        primary_source_url: "https://www.gamespot.com/videos/guilty-gear-strive-robo-ky-official-trailer/",
        source_published_at: "Sat, 27 Jun 2026 21:36:49 +0000",
        full_script:
          "Robo-Ky just made Guilty Gear players wait longer. GameSpot reports the trailer now points to a later arrival window for the character. Follow Pulse Gaming so you never miss a beat.",
      },
      null,
      2,
    ),
  );
  const queuePath = path.join(tmp, "local_media_repair_queue.json");
  fs.writeFileSync(
    queuePath,
    JSON.stringify(
      {
        items: [
          {
            story_id: "queue_only_story",
            title: "Robo-Ky Delay Puts Guilty Gear On Trial",
            action: "extend_script_before_local_repair",
            media: {
              finalPath: path.join(packageDir, "visual_v4_render.mp4"),
            },
          },
        ],
      },
      null,
      2,
    ),
  );

  try {
    const args = parseArgs([
      "--story-id",
      "queue_only_story",
      "--force-story",
      "--source-bound-only",
      "--dry-run",
      "--queue",
      queuePath,
      "--out-dir",
      tmp,
    ]);
    const pool = await buildStoryPoolForReprocess({ stories: [], args });

    assert.equal(pool.length, 1);
    assert.equal(pool[0].id, "queue_only_story");
    assert.equal(pool[0].source_type, "rss");
    assert.equal(pool[0].subreddit, "GameSpot");
    assert.equal(pool[0].article_url, "https://www.gamespot.com/videos/guilty-gear-strive-robo-ky-official-trailer/");
    assert.match(pool[0].full_script, /Robo-Ky just made Guilty Gear players wait longer/);
    assert.equal(pool[0].db_story_present, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("processor clears stale review metadata after a successful reprocess", () => {
  const source = fs.readFileSync(path.join(ROOT, "processor.js"), "utf8");
  assert.match(source, /script_generation_status:\s*requiresScriptReview/);
  assert.match(source, /:\s*"script_ready"/);
  assert.match(source, /script_validation_errors:\s*requiresScriptReview/);
});
