const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const {
  DEFAULT_BRIDGE_CANDIDATES_PATH,
  buildNextPublishCandidatesReport,
  attachPreflightQa,
  attachStoryPreflight,
  combinePreflightQa,
  formatNextPublishCandidatesMarkdown,
  parseArgs,
  runPreflightQaForStory,
  scoreAnalyticsFit,
  mergeBridgeCandidates,
} = require("../../tools/next-publish-candidates");

const analyticsText = [
  "## Tomorrow's recommendation",
  "Front corporate drama with named antagonists and concrete outcomes.",
  "Avoid abstract industry commentary. Prioritise specificity over vague insider quotes.",
].join("\n");

function bridgeVisualEvidence(subject = "GameSir G7 Pro") {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  return {
    visual_quality_report: {
      result: "pass",
      scores,
      frame_rules: {
        first_frame_subject: subject,
        first_frame_text: String(subject).split(/\s+/).slice(0, 4).join(" ").toUpperCase(),
        source_locks_readable: true,
      },
      failures: [],
    },
    media_house_benchmark: {
      result: "pass",
      scores,
      failures: [],
    },
  };
}

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
    canonical_subject: "Nintendo",
    first_spoken_line: "Nintendo just confirmed why the Amazon deal collapsed.",
    description: "Nintendo confirmed the Amazon pricing dispute. Source: Nintendo.",
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

test("next publish CLI defaults to the scheduler bridge candidate overlay", () => {
  const args = parseArgs(["node", "tools/next-publish-candidates.js"]);

  assert.equal(
    args.bridgeCandidatesPath,
    path.join(process.cwd(), "output", "goal-contract", "scheduler_bridge_candidates.json"),
  );
  assert.equal(args.bridgeCandidatesPath, DEFAULT_BRIDGE_CANDIDATES_PATH);
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

test("next publish report treats normal production V4 bridge rows as publish-ready from 35 to 60 seconds", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "v4_normal_production",
        title: "Boltgun 2 Leaves The Corridors",
        auto_approved: true,
        duration_seconds: 42.88,
        duration_lane: "normal_production",
        allow_retention_short_video: false,
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
        min_video_duration_seconds: 35,
        target_video_duration_seconds_min: 35,
        target_video_duration_seconds_max: 60,
        max_video_duration_seconds: 60,
      }),
    ],
    { analyticsText, generatedAt: "2026-05-22T22:00:00.000Z" },
  );

  assert.equal(report.excluded.length, 0);
  assert.equal(report.candidates[0].id, "v4_normal_production");
  assert.equal(report.candidates[0].status, "publish_ready");
  assert.ok(report.candidates[0].reasons.includes("normal_production_duration_window"));
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

test("bridge candidate overlay drops stale live article media arrays", () => {
  const live = [
    baseStory({
      id: "same_story",
      title: "Old article-deck story",
      downloaded_images: [
        {
          path: "output/image_cache/article-context.jpg",
          source_type: "article_context_image",
          rights_risk_class: "article_context",
        },
      ],
      game_images: ["https://example.invalid/old-card.jpg"],
    }),
  ];
  const bridged = [
    baseStory({
      id: "same_story",
      title: "Spellcasters Chronicles Is Shutting Down",
      scheduler_bridge_source: "goal_production_cutover",
      video_clips: [
        {
          asset_id: "same_story-owned-motion-1",
          path: "output/generated-motion/same_story/hook_slam.mp4",
          source_url: "local://pulse-generated-motion/same_story/hook_slam",
          source_type: "internally_generated_motion_graphic",
          rights_risk_class: "owned_generated_motion",
        },
      ],
      rights_ledger: [
        {
          asset_id: "same_story-owned-motion-1",
          path: "output/generated-motion/same_story/hook_slam.mp4",
          source_url: "local://pulse-generated-motion/same_story/hook_slam",
          source_type: "internally_generated_motion_graphic",
          licence_basis: "owned_generated_editorial_motion_graphic",
          commercial_use_allowed: true,
          allowed_platforms: ["youtube", "instagram", "facebook", "tiktok"],
          risk_score: 0.03,
        },
      ],
    }),
  ];

  const merged = mergeBridgeCandidates(live, bridged);

  assert.equal(merged[0].id, "same_story");
  assert.equal(merged[0].scheduler_bridge_overlay_live_row, true);
  assert.deepEqual(merged[0].downloaded_images, []);
  assert.deepEqual(merged[0].game_images, []);
  assert.equal(merged[0].video_clips.length, 1);
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

test("attachPreflightQa blocks malformed public copy before scheduler promotion", async () => {
  const stories = [
    baseStory({
      id: "bad_public_copy",
      title: "Kickstarter Just Walked Back Its Rules",
      selected_title: "Kickstarter Just Walked Back Its Rules",
      canonical_subject: "Kickstarter",
      first_spoken_line: "Kickstarter just walked back one of its most controversial rule changes.",
      description: '"Honestly?. Source: Eurogamer.',
      duration_seconds: 24,
      duration_lane: "pulse_retention_short",
      allow_retention_short_video: true,
      full_script:
        "Kickstarter just walked back one of its most controversial rule changes. Eurogamer reports the company apologised after backlash from game creators.",
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-22T09:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes("public_copy:malformed_quote_description"),
  );
  assert.equal(report.candidates[0].status, "review");
});

test("attachPreflightQa blocks V4 bridge deal candidates without commercial disclosure evidence", async () => {
  const stories = [
    baseStory({
      id: "bridge_deal_without_disclosure",
      title: "GameSir G7 Pro Deal Has One Catch",
      selected_title: "GameSir G7 Pro Deal Has One Catch",
      canonical_subject: "GameSir G7 Pro",
      first_spoken_line: "GameSir G7 Pro just became a better controller deal for PC players.",
      description: "The GameSir G7 Pro is on sale for Memorial Day. Source: IGN.",
      full_script:
        "GameSir G7 Pro just became a better controller deal for PC players. IGN says the controller is on sale for Memorial Day, but the catch is whether it fits your setup.",
      duration_seconds: 42,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 8,
      primary_source: "IGN",
      discovery_source: "IGN",
      audio_path: "D:/pulse-data/media/output/audio/bridge_deal_without_disclosure.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_deal_without_disclosure_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_deal_without_disclosure.srt",
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "GameSir G7 Pro Deal Has One Catch" },
        },
      },
      publish_verdict: { verdict: "GREEN" },
      platform_policy_report: {
        disclosure_requirements: { affiliate: false },
      },
      affiliate_link_manifest: {
        disclosure_required: false,
      },
      landing_page_manifest: {},
      ...bridgeVisualEvidence("GameSir G7 Pro"),
      rights_ledger: [{ asset_id: "bridge-deal-final-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "kinetic_title" },
        { path: "clip-b.mp4", source_family: "source_card" },
        { path: "clip-c.mp4", source_family: "stat_card" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-22T23:59:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "incident_guard:incident:commercial_deal_disclosure_missing",
    ),
  );
  assert.equal(report.candidates[0].status, "review");
});

test("bridge preflight accepts visual QA and benchmark evidence from scheduler candidates", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_visual_clean",
      title: "Boltgun 2 Leaves The Corridors",
      selected_title: "Boltgun 2 Leaves The Corridors",
      canonical_subject: "Warhammer 40,000: Boltgun 2",
      first_spoken_line:
        "Warhammer 40,000: Boltgun 2 is moving its retro FPS chaos into bigger outdoor spaces.",
      description: "IGN previewed Warhammer 40,000: Boltgun 2 moving into bigger outdoor spaces. Source: IGN.",
      full_script:
        "Warhammer 40,000: Boltgun 2 is moving its retro FPS chaos into bigger outdoor spaces. IGN previewed the sequel and showed how the arenas change the pace.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 8,
      exported_path: "D:/pulse-data/media/output/final/bridge_visual_clean.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_visual_clean.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_visual_clean_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_visual_clean.srt",
      primary_source: "IGN",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Boltgun 2 Leaves The Corridors" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Warhammer 40,000: Boltgun 2",
          first_frame_text: "BOLTGUN 2 OUTDOORS",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      rights_ledger: [
        {
          asset_id: "bridge-official-a",
          path: "clip-a.mp4",
          source_url: "https://cdn.example.com/boltgun/a.mp4",
          source_type: "official_reference_clip",
          rights_risk_class: "official_reference_only",
          source_family: "official_trailer_a",
        },
        {
          asset_id: "bridge-official-b",
          path: "clip-b.mp4",
          source_url: "https://cdn.example.com/boltgun/b.mp4",
          source_type: "official_reference_clip",
          rights_risk_class: "official_reference_only",
          source_family: "official_trailer_b",
        },
        {
          asset_id: "bridge-official-c",
          path: "clip-c.mp4",
          source_url: "https://cdn.example.com/boltgun/c.mp4",
          source_type: "official_reference_clip",
          rights_risk_class: "official_reference_only",
          source_family: "official_trailer_c",
        },
      ],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "pass");
  assert.deepEqual(preflight.blockers, []);
});

test("bridge preflight blocks generated-only orange-card motion decks", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const generatedClips = Array.from({ length: 8 }, (_, index) => ({
    id: `generated-card-${index + 1}`,
    path: `output/generated-motion/bridge-generated/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/bridge-generated/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    rights_risk_class: "owned_generated_motion",
    source_family: `orange_card_${index + 1}`,
  }));
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_generated_cards",
      title: "PlayStation's Pricing Test Has A Legal Problem",
      selected_title: "PlayStation's Pricing Test Has A Legal Problem",
      canonical_subject: "PlayStation Store",
      first_spoken_line: "PlayStation Store dynamic pricing may have a legal problem in Europe.",
      description: "Eurogamer reported the PlayStation Store dynamic pricing legal issue. Source: Eurogamer.",
      full_script:
        "PlayStation Store dynamic pricing may have a legal problem in Europe. Eurogamer reported the legal concern around the store experiment.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 8,
      exported_path: "D:/pulse-data/media/output/final/bridge_generated_cards.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_generated_cards.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_generated_cards_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_generated_cards.srt",
      primary_source: "Eurogamer",
      discovery_source: "Eurogamer",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "PlayStation's Pricing Test Has A Legal Problem" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "PlayStation Store",
          first_frame_text: "PS STORE LEGAL RISK",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      rights_ledger: generatedClips.map((clip) => ({
        ...clip,
        licence_basis: "owned_generated_editorial_motion_graphic",
      })),
      video_clips: generatedClips,
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockers.includes("incident_guard:visual_evidence:generated_only_motion_deck"));
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

test("attachPreflightQa keeps read-only preflight mutations off source stories", async () => {
  const stories = [
    baseStory({
      id: "bridge_clean",
      title: "Forza Horizon 6 Just Changed Xbox's Steam Plan",
      duration_seconds: 24,
      duration_lane: "pulse_retention_short",
      allow_retention_short_video: true,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-22T09:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async (story) => {
      story.qa_failed = true;
      story.qa_failures = ["script_too_short (24 words, min 80)"];
      story.publish_status = "failed";
      story.publish_error = "qa_blocked: script_too_short (24 words, min 80)";
      return { result: "pass", failures: [], warnings: [] };
    },
    runVideoQa: async (_path, _opts) => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async (story) => {
      story.content_qa_failures = ["mutated_inside_governance"];
      return { result: "pass", failures: [], warnings: [] };
    },
  });

  assert.equal(report.candidates[0].preflight_qa.status, "pass");
  assert.equal(stories[0].qa_failed, undefined);
  assert.equal(stories[0].qa_failures, undefined);
  assert.equal(stories[0].publish_status, null);
  assert.equal(stories[0].publish_error, undefined);
  assert.equal(stories[0].content_qa_failures, undefined);
});
