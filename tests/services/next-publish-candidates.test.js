const { test } = require("node:test");
const assert = require("node:assert");

const {
  buildNextPublishCandidatesReport,
  attachPreflightQa,
  attachStoryPreflight,
  combinePreflightQa,
  formatNextPublishCandidatesMarkdown,
  parseArgs,
  scoreAnalyticsFit,
  mergeBridgeCandidates,
} = require("../../tools/next-publish-candidates");

const analyticsText = [
  "## Tomorrow's recommendation",
  "Front corporate drama with named antagonists and concrete outcomes.",
  "Avoid abstract industry commentary. Prioritise specificity over vague insider quotes.",
].join("\n");

function baseStory(overrides = {}) {
  return {
    id: "story_base",
    title: "Nintendo executive says Amazon deal collapsed after pricing dispute",
    approved: true,
    auto_approved: false,
    exported_path: "D:/pulse-data/media/output/final/story_base.mp4",
    duration_seconds: 66,
    breaking_score: 60,
    publish_status: null,
    full_script: "Nintendo executive Reggie Fils-Aime says Amazon's pricing demand collapsed.",
    ...overrides,
  };
}

test("next publish report ranks clean approved candidates by approval, duration and analytics fit", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "generic",
        title: "Industry insider says a game could maybe be changing soon",
        approved: true,
        auto_approved: false,
        duration_seconds: 64,
        breaking_score: 95,
        full_script: "An insider says the industry could change soon.",
      }),
      baseStory({
        id: "specific_auto",
        title: "Reggie says Amazon tried to strong-arm Nintendo on console pricing",
        approved: true,
        auto_approved: true,
        duration_seconds: 68,
        breaking_score: 70,
        full_script:
          "Reggie Fils-Aime says Amazon tried to pressure Nintendo into a pricing deal and Nintendo walked away.",
      }),
      baseStory({
        id: "approved_specific",
        title: "eBay rejects GameStop takeover bid as not credible",
        approved: true,
        auto_approved: false,
        duration_seconds: 72,
        breaking_score: 80,
        full_script: "eBay rejected GameStop's takeover bid after the board called it not credible.",
      }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  assert.equal(report.candidates[0].id, "specific_auto");
  assert.equal(report.candidates[0].status, "publish_ready");
  assert.ok(report.candidates[0].score > report.candidates[1].score);
  assert.ok(report.candidates[0].reasons.includes("auto_approved"));
});

test("next publish report excludes rows with existing public platform ids and QA failures", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({ id: "already_youtube", youtube_post_id: "yt_live_123" }),
      baseStory({
        id: "qa_failed",
        qa_failed: true,
        qa_failures: ["audio_duration_too_long (125.83s, max 74.00s)"],
      }),
      baseStory({ id: "clean", title: "Nintendo confirms Switch 2 bundle outcome" }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  assert.deepEqual(
    report.excluded.map((row) => row.id).sort(),
    ["already_youtube", "qa_failed"],
  );
  assert.deepEqual(report.candidates.map((row) => row.id), ["clean"]);
});

test("next publish report distinguishes pending local audio from generic missing MP4", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "pending_local_audio",
        exported_path: null,
        publish_status: "pending_audio",
        publish_error:
          "audio_generation_pending: gpu_saturated: local TTS GPU is too busy for clean generation",
      }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  assert.equal(report.excluded[0].reason, "pending_audio:gpu_saturated");
  assert.equal(report.totals.pending_audio, 1);
  assert.match(formatNextPublishCandidatesMarkdown(report), /pending audio: 1/);
  assert.match(formatNextPublishCandidatesMarkdown(report), /pending_local_audio: pending_audio:gpu_saturated/);
});

test("next publish report lets recovered pending-audio rows reach preflight QA", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "recovered_pending_audio",
        audio_path: "D:/pulse-data/media/output/audio/recovered_pending_audio.mp3",
        exported_path: "D:/pulse-data/media/output/final/recovered_pending_audio.mp4",
        publish_status: "pending_audio",
        publish_error: "audio_generation_pending: local_tts_ready_for_retry",
      }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  assert.deepEqual(report.excluded, []);
  assert.equal(report.totals.pending_audio, 0);
  assert.deepEqual(report.candidates.map((row) => row.id), [
    "recovered_pending_audio",
  ]);
});

test("next publish report mirrors live skip for failed and stale unpublished backlog rows", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "old_unpublished",
        created_at: "2026-04-23T12:00:00.000Z",
        updated_at: "2026-05-15T08:00:00.000Z",
      }),
      baseStory({
        id: "publish_failed",
        publish_status: "failed",
      }),
      baseStory({
        id: "fresh_clean",
        created_at: "2026-05-15T08:30:00.000Z",
      }),
    ],
    {
      analyticsText,
      generatedAt: "2026-05-15T09:00:00.000Z",
      nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
      env: {},
    },
  );

  assert.deepEqual(report.candidates.map((row) => row.id), ["fresh_clean"]);
  assert.ok(
    report.excluded.some(
      (row) =>
        row.id === "old_unpublished" &&
        row.reason === "stale_unpublished_backlog",
    ),
  );
  assert.ok(
    report.excluded.some(
      (row) =>
        row.id === "publish_failed" &&
        row.reason === "qa_failure:publish_status=failed",
    ),
  );
});

test("next publish report can opt into stale backlog visibility when explicitly allowed", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "old_allowed",
        created_at: "2026-04-23T12:00:00.000Z",
      }),
    ],
    {
      analyticsText,
      generatedAt: "2026-05-15T09:00:00.000Z",
      nowMs: Date.parse("2026-05-15T09:00:00.000Z"),
      env: { ALLOW_STALE_BACKLOG_PUBLISH: "true" },
    },
  );

  assert.deepEqual(report.candidates.map((row) => row.id), ["old_allowed"]);
});

test("next publish CLI parses story-specific preflight flags", () => {
  const args = parseArgs([
    "node",
    "tools/next-publish-candidates.js",
    "--story-id",
    "1td4x0w",
    "--preflight-qa",
    "--json",
  ]);
  const inline = parseArgs([
    "node",
    "tools/next-publish-candidates.js",
    "--story=1thsxw7",
  ]);

  assert.equal(args.storyId, "1td4x0w");
  assert.equal(args.preflightQa, true);
  assert.equal(args.json, true);
  assert.equal(inline.storyId, "1thsxw7");
});

test("next publish report can focus candidate ranking on one story id", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({ id: "target_story", title: "Nintendo confirms Switch 2 bundle outcome" }),
      baseStory({ id: "other_story", title: "Xbox confirms a Game Pass pricing outcome" }),
    ],
    {
      analyticsText,
      generatedAt: "2026-05-15T09:00:00.000Z",
      storyId: "target_story",
    },
  );

  assert.equal(report.story_filter.story_id, "target_story");
  assert.equal(report.totals.stories_seen, 1);
  assert.deepEqual(report.candidates.map((row) => row.id), ["target_story"]);
});

test("story-specific preflight checks requested story even when it is excluded from candidates", async () => {
  const stories = [
    baseStory({
      id: "stale_script_story",
      publish_status: "failed",
      title: "Mixtape Just Avoided Gaming's Delisting Trap",
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-15T09:00:00.000Z",
    storyId: "stale_script_story",
  });

  assert.deepEqual(report.candidates, []);

  await attachStoryPreflight(report, stories, "stale_script_story", {
    runPreflightQaForStory: async (story) => ({
      story_id: story.id,
      status: "pass",
      blockers: [],
      warnings: ["stale persisted QA label cleared by current script"],
      checks: {},
    }),
  });

  assert.equal(report.story_preflight.story_id, "stale_script_story");
  assert.equal(report.story_preflight.status, "pass");
  assert.deepEqual(report.story_preflight.blockers, []);
  assert.match(formatNextPublishCandidatesMarkdown(report), /Story Preflight/);
});

test("next publish report keeps 76-90s extended Shorts in review instead of excluding them", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "extended_short",
        title: "Xbox boss names Discord partnership after Game Pass price cut",
        duration_seconds: 84,
        breaking_score: 75,
      }),
      baseStory({
        id: "runaway_short",
        title: "Long script should not be treated as a normal Short",
        duration_seconds: 112,
        breaking_score: 99,
      }),
    ],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );

  const extended = report.candidates.find((row) => row.id === "extended_short");
  assert.ok(extended, "extended Short should remain visible for operator review");
  assert.equal(extended.status, "review");
  assert.ok(extended.reasons.includes("extended_short_review"));
  assert.ok(report.excluded.some((row) => row.id === "runaway_short"));
});

test("next publish report treats governed retention-short V4 rows as publish-ready", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "v4_retention_short",
        title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
        auto_approved: true,
        duration_seconds: 24.4,
        duration_lane: "pulse_retention_short",
        allow_retention_short_video: true,
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
      }),
    ],
    { analyticsText, generatedAt: "2026-05-22T06:00:00.000Z" },
  );

  assert.equal(report.excluded.length, 0);
  assert.equal(report.candidates[0].id, "v4_retention_short");
  assert.equal(report.candidates[0].status, "publish_ready");
  assert.ok(report.candidates[0].reasons.includes("retention_short_target_window"));
});

test("next publish report keeps sub-target V4 retention shorts visible for review", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "v4_subtarget_short",
        title: "Star Fox Just Got A Switch 2 Route",
        auto_approved: true,
        duration_seconds: 18.2,
        duration_lane: "pulse_retention_short",
        allow_retention_short_video: true,
      }),
    ],
    { analyticsText, generatedAt: "2026-05-22T06:00:00.000Z" },
  );

  assert.equal(report.excluded.length, 0);
  assert.equal(report.candidates[0].status, "review");
  assert.ok(report.candidates[0].reasons.includes("retention_short_below_target_review"));
});

test("next publish report can merge scheduler bridge candidates without mutating DB rows", () => {
  const live = [baseStory({ id: "live_story", title: "Nintendo confirms a Switch 2 bundle outcome" })];
  const bridged = [
    baseStory({
      id: "bridge_story",
      title: "Destiny 2 Is Getting Its Final Update",
      auto_approved: true,
      duration_seconds: 25,
      duration_lane: "pulse_retention_short",
      allow_retention_short_video: true,
      scheduler_bridge_source: "goal_production_cutover",
    }),
  ];

  const merged = mergeBridgeCandidates(live, bridged);
  const report = buildNextPublishCandidatesReport(merged, {
    analyticsText,
    generatedAt: "2026-05-22T06:00:00.000Z",
  });

  assert.equal(merged.length, 2);
  assert.ok(report.bridge_candidates);
  assert.equal(report.bridge_candidates.count, 1);
  assert.ok(report.candidates.some((candidate) => candidate.id === "bridge_story"));
  assert.ok(report.candidates.find((candidate) => candidate.id === "bridge_story").reasons.includes("scheduler_bridge_candidate"));
});

test("analytics specificity scoring rewards named corporate outcomes and penalises vague speculation", () => {
  const specific = scoreAnalyticsFit(baseStory({
    title: "GameStop takeover bid rejected by eBay board as not credible",
    full_script: "GameStop made a takeover bid and eBay's board rejected it as not credible.",
  }), analyticsText);
  const vague = scoreAnalyticsFit(baseStory({
    title: "A gaming insider says things could maybe shift soon",
    full_script: "An insider says the industry could maybe shift soon if rumours are true.",
  }), analyticsText);

  assert.ok(specific.score > vague.score);
  assert.ok(specific.reasons.includes("corporate_drama"));
  assert.ok(specific.reasons.includes("concrete_outcome"));
  assert.ok(vague.penalties.includes("speculative_language"));
});

test("next publish report JSON and Markdown are valid operator artefacts", () => {
  const report = buildNextPublishCandidatesReport(
    [baseStory({ id: "json_candidate" })],
    { analyticsText, generatedAt: "2026-05-15T09:00:00.000Z" },
  );
  const parsed = JSON.parse(JSON.stringify(report));
  const markdown = formatNextPublishCandidatesMarkdown(report);

  assert.equal(parsed.candidates[0].id, "json_candidate");
  assert.match(parsed.analytics_summary.latest_recommendation, /corporate drama/);
  assert.match(markdown, /# Next Publish Candidates/);
  assert.match(markdown, /json_candidate/);
  assert.match(markdown, /read-only/);
});

test("preflight QA summary blocks failed checks and keeps warnings visible", () => {
  const combined = combinePreflightQa({
    content: { result: "warn", failures: [], warnings: ["caption_timing_repaired"] },
    video: { result: "pass", failures: [], warnings: [] },
    platform: { result: "fail", failures: ["video_codec_not_h264"], warnings: [] },
    governance: { result: "pass", failures: [], warnings: [] },
  });

  assert.equal(combined.status, "blocked");
  assert.deepEqual(combined.blockers, ["platform:video_codec_not_h264"]);
  assert.deepEqual(combined.warnings, ["content:caption_timing_repaired"]);
});

test("preflight QA summary includes studio governance blockers", () => {
  const combined = combinePreflightQa({
    content: { result: "pass", failures: [], warnings: [] },
    video: { result: "pass", failures: [], warnings: [] },
    platform: { result: "pass", failures: [], warnings: [] },
    governance: {
      result: "fail",
      failures: ["publish_verdict_not_green"],
      warnings: [],
    },
  });

  assert.equal(combined.status, "blocked");
  assert.deepEqual(combined.blockers, ["governance:publish_verdict_not_green"]);
  assert.equal(combined.checks.governance.result, "fail");
});

test("attachPreflightQa marks candidates with read-only QA evidence", async () => {
  const stories = [
    baseStory({ id: "qa_pass", title: "Nintendo confirms a Switch 2 price outcome" }),
    baseStory({ id: "qa_blocked", title: "Xbox boss confirms a pricing problem" }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-15T09:00:00.000Z",
  });
  const contentQaOptions = [];

  await attachPreflightQa(report, stories, {
    runContentQa: async (story, opts) => {
      contentQaOptions.push(opts);
      return (
      story.id === "qa_blocked"
        ? { result: "fail", failures: ["script_validation_review_required"], warnings: [] }
        : { result: "pass", failures: [], warnings: [] }
      );
    },
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  const pass = report.candidates.find((candidate) => candidate.id === "qa_pass");
  const blocked = report.candidates.find((candidate) => candidate.id === "qa_blocked");
  assert.equal(pass.preflight_qa.status, "pass");
  assert.equal(blocked.preflight_qa.status, "blocked");
  assert.equal(blocked.status, "review");
  assert.ok(report.preflight_qa.enabled);
  assert.ok(contentQaOptions.every((opts) => opts.blockThinVisuals === true));
  assert.match(formatNextPublishCandidatesMarkdown(report), /preflight=blocked/);
});
