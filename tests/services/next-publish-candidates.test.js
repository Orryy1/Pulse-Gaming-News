const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULT_BRIDGE_CANDIDATES_PATH,
  DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH,
  DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH,
  DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH,
  aggregateBenchmarkPreflightForStory,
  buildNextPublishCandidatesReport,
  attachPreflightQa,
  attachStoryPreflight,
  combinePreflightQa,
  formatNextPublishCandidatesMarkdown,
  parseArgs,
  resolveUpstreamBenchmarkReportPath,
  runCli,
  runPreflightQaForStory,
  scoreAnalyticsFit,
  mergeBridgeCandidates,
  selectCandidateSourceStories,
  visualEntityPreflightForStory,
} = require("../../tools/next-publish-candidates");
const {
  TTS_PRONUNCIATION_PROFILE_VERSION,
} = require("../../lib/tts-pronunciation");
const db = require("../../lib/db");

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

function bridgeSfxEvidence() {
  return {
    cue_count: 8,
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: [
        {
          asset_id: "modern-cinematic-impact-slam",
          role: "impact",
          family: "impact",
          provider_id: "boom_library",
          source_url: "file://licensed/boom_library/modern-cinematic-impact-slam.wav",
          rights_basis: "boom_library_media_license",
          commercial_use_allowed: true,
          approval_status: "approved_for_commercial_editorial_use",
        },
        {
          asset_id: "pure-scifi-whoosh-fast-transition",
          role: "transition",
          family: "whoosh",
          provider_id: "soundly",
          source_url: "file://licensed/soundly/pure-scifi-whoosh-fast-transition.wav",
          rights_basis: "soundly_pro_commercial_use",
          commercial_use_allowed: true,
          approval_status: "approved_for_commercial_editorial_use",
        },
        {
          asset_id: "clean-editorial-select-tick",
          role: "ui_tick",
          family: "source_tick",
          provider_id: "sonniss",
          source_url: "file://licensed/sonniss/UIClick_Select_Middle_29.wav",
          rights_basis: "sonniss_game_audio_gdc_bundle_license",
          commercial_use_allowed: true,
          approval_status: "approved_for_commercial_editorial_use",
        },
        {
          asset_id: "clean-editorial-news-riser-trailer",
          role: "riser",
          family: "riser",
          provider_id: "pro_sound_effects",
          source_url: "file://licensed/pro_sound_effects/clean-editorial-news-riser-trailer.wav",
          rights_basis: "pro_sound_effects_subscription_license",
          commercial_use_allowed: true,
          approval_status: "approved_for_commercial_editorial_use",
        },
        {
          asset_id: "mechanical-wave-trailer-sub-cinematic-hit",
          role: "sub_hit",
          family: "sub_hit",
          provider_id: "boom_library",
          source_url: "file://licensed/boom_library/mechanical-wave-trailer-sub-cinematic-hit.wav",
          rights_basis: "boom_library_media_license",
          commercial_use_allowed: true,
          approval_status: "approved_for_commercial_editorial_use",
        },
      ],
    },
  };
}

function ownedExplainerFixture(storyId = "bridge_owned_explainer") {
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `${storyId}-${index + 1}`,
    path: `output/generated-motion/${storyId}/${index + 1}.mp4`,
    source_url: `local://pulse-generated-motion/${storyId}/${index + 1}`,
    source_type: "internally_generated_motion_graphic",
    source_kind: "owned_source_card_explainer_motion",
    media_kind: "owned_explainer_motion",
    rights_risk_class: "owned_generated_motion",
    source_family: `owned_explainer_${index + 1}`,
    motion_family: `owned_explainer_${index + 1}`,
    owned_explainer_visual_plan: true,
    counts_towards_motion_readiness: true,
    materialized: true,
  }));
  const rightsLedger = {
    verdict: "pass",
    assets: [],
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "generated_motion",
      licence_basis: "owned_generated_editorial_motion_graphic",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      commercial_use_allowed: true,
      approval_status: "approved_for_transformative_editorial_use",
      risk_score: 0.03,
    })),
  };
  const footageInventory = {
    motion_budget: {
      allow_owned_explainer_motion_only: true,
      owned_explainer_visual_plan: true,
    },
    motion_inventory: {
      owned_explainer_visual_plan: true,
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
    },
  };
  return { clips, rightsLedger, footageInventory };
}

function directVideoFixture(storyId = "bridge_direct_video_resolved") {
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `${storyId}-direct-${index + 1}`,
    path: `output/video_cache/${storyId}-direct-${index + 1}.mp4`,
    source_url: `https://video.fastly.steamstatic.com/store_trailers/353370/${37301 + index}/hls_264_master.m3u8`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: `steam_353370_${37301 + index}`,
    motion_family: `steam_353370_${37301 + index}`,
    rights_risk_class: "official_reference_transformative_editorial_use",
    rights_basis: "official_reference_transformative_editorial_use",
    licence_basis: "official_reference_transformative_editorial_use",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
    counts_towards_motion_readiness: true,
    materialized: true,
  }));
  const rightsLedger = {
    verdict: "pass",
    assets: [],
    records: clips.map((clip) => ({
      ...clip,
      asset_type: "direct_video_motion_clip",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      allowed_use: "transformative_editorial_reference",
      risk_score: 0.08,
    })),
  };
  const footageInventory = {
    motion_inventory: {
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: clips.map((clip) => clip.source_family),
    },
  };
  return { clips, rightsLedger, footageInventory };
}

function baseStory(overrides = {}) {
  return {
    id: "story_base",
    title: "Nintendo executive says Amazon deal collapsed after pricing dispute",
    approved: true,
    auto_approved: false,
    exported_path: "D:/pulse-data/media/output/final/story_base.mp4",
    duration_seconds: 66,
    audio_segment_loudness_report: {
      verdict: "pass",
      blockers: [],
      warnings: [],
      metrics: {
        valid_segment_count: 6,
        mean_range_db: 1.2,
        max_adjacent_rise_db: 0.6,
        max_peak_db: -2.4,
      },
    },
    breaking_score: 60,
    publish_status: null,
    canonical_subject: "Nintendo",
    first_spoken_line: "Nintendo just confirmed why the Amazon deal collapsed.",
    description: "Nintendo confirmed the Amazon pricing dispute. Source: Nintendo.",
    full_script: "Nintendo executive Reggie Fils-Aime says Amazon's pricing demand collapsed.",
    ...overrides,
  };
}

async function passBridgeArtifactFreshnessQa() {
  return { result: "pass", failures: [], warnings: [] };
}

async function writeCurrentGreenProofPackage(artifactDir, storyId, videoPath) {
  const now = "2026-06-23T22:30:00.000Z";
  const script =
    "Street Fighter 6 just made Yasmine look like a ranked-mode problem. " +
    "GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. " +
    "That matters because zoner mains may have to spend meter just to breathe, while rushdown players may get a new bully when she arrives. " +
    "Follow Pulse Gaming so you never miss a beat.";
  await fs.outputFile(videoPath, "fake mp4 bytes");
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: "Street Fighter 6",
    selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
    narration_script: script,
    tts_script: script,
  });
  await fs.writeJson(path.join(artifactDir, "narration_manifest.json"), {
    status: "ready",
    final_transcript: script,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 94,
    blockers: [],
  });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    story_id: storyId,
    verdict: "GREEN",
    status: "GREEN",
    can_auto_publish: true,
    enabled_platform_outputs: ["youtube_shorts", "instagram_reels", "facebook_reels"],
    reason_codes: [],
    generated_at: now,
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    can_auto_publish: true,
    outputs: {
      youtube_shorts: { duration_seconds: 37.1, captions: { file: "captions.srt" } },
      instagram_reels: { duration_seconds: 37.1, captions: { file: "captions.srt" } },
      facebook_reels: { duration_seconds: 37.1, captions: { file: "captions.srt" } },
    },
  });
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), {
    generated_at: now,
    result: "pass",
    verdict: "pass",
    failures: [],
    warnings: [],
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: storyId,
    final_publish_render: true,
    output_path: videoPath,
    generated_at: now,
    quality_gate_status: "post_render_forensics_passed",
    post_render_forensic_result: "pass",
    post_render_forensic_blockers: [],
    clips: 30,
    repeat_guard: {
      status: "pass",
      min_card_duration_s: 12,
      direct_motion_base_source_policy: {
        max_clips_per_base: 1,
      },
    },
    overlay_card_windows: [
      { id: "opening_source_lock", kind: "source_lock", start_s: 0, end_s: 12, duration_s: 12 },
      { id: "headline_card", kind: "proof_card", start_s: 12.3, end_s: 24.3, duration_s: 12 },
    ],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    story_id: storyId,
    voice_status: "materialized",
    word_timestamp_count: 80,
    word_timestamp_source: "local_whisper_word_alignment",
    timestamp_whisper_alignment: {
      script_coverage_ratio: 1,
      script_inserted_actual_word_count: 0,
      script_trailing_actual_word_count: 0,
    },
  });
  await fs.writeJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    story_id: storyId,
    status: "ready",
    generated_at: now,
    repeat_guard: {
      status: "pass",
      policy: "one_clip_per_direct_motion_base_source",
    },
    clips: Array.from({ length: 5 }, (_, index) => ({
      id: `clip-${index + 1}`,
      source_family: `official_${index + 1}_window_${12 + index * 6}_5`,
      base_source_family: `official_${index + 1}`,
      motion_family: `official_${index + 1}_window_${12 + index * 6}_5`,
      materialized: true,
      counts_towards_motion_readiness: true,
    })),
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    story_id: storyId,
    verdict: "GREEN",
    status: "pass",
    hard_failures: [],
    scores: {
      overall_media_house_score: 95,
      title_strength_score: 100,
      first_frame_score: 100,
      first_3_seconds_score: 100,
      competitor_parity_score: 98,
      competitor_surpass_score: 93,
    },
  });
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

test("next publish report excludes fully published rows and rows with QA failures", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "already_all_enabled",
        youtube_post_id: "yt_live_123",
        youtube_url: "https://youtube.com/shorts/yt_live_123",
        instagram_media_id: "ig_live_123",
        facebook_post_id: "fb_live_123",
      }),
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
    ["already_all_enabled", "qa_failed"],
  );
  assert.deepEqual(report.candidates.map((row) => row.id), ["clean"]);
});

test("next publish report keeps partial platform stories eligible for missing enabled platforms", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "youtube_only_needs_reels",
        title: "Mina The Hollower Has A Sequel Risk",
        youtube_post_id: "yt_live_123",
        youtube_url: "https://youtube.com/shorts/yt_live_123",
      }),
    ],
    { analyticsText, generatedAt: "2026-06-16T10:15:00.000Z" },
  );

  assert.equal(report.excluded.length, 0);
  assert.equal(report.candidates[0].id, "youtube_only_needs_reels");
  assert.deepEqual(report.candidates[0].source.already_published_platforms, ["youtube_shorts"]);
  assert.deepEqual(
    report.candidates[0].source.missing_enabled_platforms,
    ["instagram_reels", "facebook_reels"],
  );
  assert.ok(report.candidates[0].reasons.includes("partial_platform_completion"));
});

test("next publish report excludes stories when the only missing enabled platform is duplicate-blocked", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "cyberpunk-terminal-youtube",
        title: "Cyberpunk 2077's Trust Debt",
        instagram_media_id: "ig_live_123",
        facebook_post_id: "fb_live_123",
        youtube_error: "duplicate_blocked: Similar to existing: \"Cyberpunk 2077's Trust Debt\"",
      }),
    ],
    { analyticsText, generatedAt: "2026-06-23T16:05:00.000Z" },
  );

  assert.equal(report.candidates.length, 0);
  assert.equal(report.excluded.length, 1);
  assert.equal(report.excluded[0].id, "cyberpunk-terminal-youtube");
  assert.match(
    report.excluded[0].reason,
    /^enabled_platforms_already_public_or_terminal_duplicate:/,
  );
  assert.match(report.excluded[0].reason, /youtube_shorts:duplicate_blocked/);
});

test("next publish report keeps non-terminal missing platforms while exposing duplicate-blocked platforms", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "youtube-duplicate-needs-reels",
        title: "Cyberpunk 2077 Trust Still Has A Reels Angle",
        youtube_error: "duplicate_blocked: Similar to existing upload",
      }),
    ],
    { analyticsText, generatedAt: "2026-06-23T16:10:00.000Z" },
  );

  assert.equal(report.excluded.length, 0);
  assert.equal(report.candidates[0].id, "youtube-duplicate-needs-reels");
  assert.deepEqual(
    report.candidates[0].source.terminal_duplicate_blocked_platforms,
    ["youtube_shorts"],
  );
  assert.deepEqual(
    report.candidates[0].source.missing_enabled_platforms,
    ["instagram_reels", "facebook_reels"],
  );
});

test("next publish report excludes upstream anti-spam deferred bridge candidates", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "duplicate_deferred",
        title: "Forza Horizon 6 Reviews Are In",
        auto_approved: true,
        scheduler_bridge_source: "goal_production_cutover",
      }),
      baseStory({
        id: "clean_bridge",
        title: "Xbox Controller Deal Has One Catch",
        auto_approved: true,
        scheduler_bridge_source: "goal_production_cutover",
      }),
    ],
    {
      analyticsText,
      generatedAt: "2026-05-29T00:45:00.000Z",
      upstreamAntiSpamReport: {
        stories: [
          {
            story_id: "duplicate_deferred",
            status: "skipped",
            skipped_status: "anti_spam_duplicate_deferred",
            skipped_reason: "deferred_by_goal20_duplicate_cluster",
            blockers: [],
          },
        ],
      },
    },
  );

  assert.deepEqual(report.candidates.map((row) => row.id), ["clean_bridge"]);
  assert.deepEqual(report.excluded.map((row) => row.id), ["duplicate_deferred"]);
  assert.equal(
    report.excluded[0].reason,
    "upstream_skipped:anti_spam_duplicate_deferred:deferred_by_goal20_duplicate_cluster",
  );
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

  assert.equal(args.limit, null);
  assert.equal(
    args.bridgeCandidatesPath,
    path.join(process.cwd(), "output", "goal-contract", "scheduler_bridge_candidates.json"),
  );
  assert.equal(args.bridgeCandidatesPath, DEFAULT_BRIDGE_CANDIDATES_PATH);
  assert.equal(args.directVideoEnrichmentWorkOrderPath, DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH);
  assert.equal(args.sourceFamilyAcquisitionReportPath, DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH);
  assert.equal(
    args.sourceFamilyAcquisitionReportPath,
    path.join(process.cwd(), "output", "goal-contract", "studio_v4_source_family_acquisition_remaining.json"),
  );
  assert.equal(
    args.upstreamAntiSpamReportPath,
    path.join(process.cwd(), "output", "goal-20", "goal20_readiness_report.json"),
  );
  assert.equal(args.upstreamAntiSpamReportPath, DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH);
});

test("next publish CLI keeps json output off stderr for automation consumers", async (t) => {
  const original = {
    getStories: db.getStories,
    stdoutWrite: process.stdout.write,
    stderrWrite: process.stderr.write,
  };
  t.after(() => {
    db.getStories = original.getStories;
    process.stdout.write = original.stdoutWrite;
    process.stderr.write = original.stderrWrite;
  });

  const analyticsPath = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-candidates-cli-")),
    "analytics.md",
  );
  const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-candidates-cli-out-"));
  await fs.outputFile(analyticsPath, analyticsText);
  const now = new Date().toISOString();
  db.getStories = async () => [
    baseStory({
      id: "json_cli_story",
      title: "Nintendo confirms one Switch 2 gameplay trailer",
      timestamp: now,
      created_at: now,
    }),
  ];

  let stdout = "";
  let stderr = "";
  process.stdout.write = (chunk, ...args) => {
    stdout += String(chunk);
    if (typeof args.at(-1) === "function") args.at(-1)();
    return true;
  };
  process.stderr.write = (chunk, ...args) => {
    stderr += String(chunk);
    if (typeof args.at(-1) === "function") args.at(-1)();
    return true;
  };

  const result = await runCli([
    "node",
    "tools/next-publish-candidates.js",
    "--json",
    "--limit",
    "1",
    "--analytics",
    analyticsPath,
    "--out-dir",
    outDir,
    "--no-bridge",
    "--no-direct-video-work-order",
    "--no-source-family-acquisition",
    "--no-goal10-report",
    "--no-goal20-report",
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(stdout, /"candidates"/);
  assert.equal(stderr, "");
  assert.equal(await fs.pathExists(path.join(outDir, "next_publish_candidates.json")), true);
});

test("next publish CLI resolves sibling Goal 10 evidence for custom bridge paths", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-goal10-"));
  t.after(async () => {
    await fs.remove(tmpDir);
  });
  const bridgePath = path.join(tmpDir, "goal-contract", "scheduler_bridge_candidates.json");
  const siblingGoal10 = path.join(tmpDir, "goal-10", "goal10_readiness_report.json");
  const explicitGoal10 = path.join(tmpDir, "operator-goal10.json");
  await fs.ensureDir(path.dirname(bridgePath));
  await fs.outputJson(siblingGoal10, { stories: [{ story_id: "bridge-one", status: "ready" }] });
  await fs.outputJson(explicitGoal10, { stories: [] });

  const args = parseArgs(["node", "tools/next-publish-candidates.js", "--bridge", bridgePath]);
  const resolved = await resolveUpstreamBenchmarkReportPath(args);
  assert.equal(resolved, siblingGoal10);

  const explicit = parseArgs([
    "node",
    "tools/next-publish-candidates.js",
    "--bridge",
    bridgePath,
    "--goal10-report",
    explicitGoal10,
  ]);
  assert.equal(await resolveUpstreamBenchmarkReportPath(explicit), explicitGoal10);
});

test("next publish CLI resolves local Goal 10 evidence for cutover bridge paths", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-cutover-goal10-"));
  t.after(async () => {
    await fs.remove(tmpDir);
  });
  const bridgePath = path.join(tmpDir, "worldclass-cutover-20260615", "scheduler_bridge_candidates.json");
  const localGoal10 = path.join(tmpDir, "worldclass-cutover-20260615", "goal10_readiness_report.json");
  await fs.ensureDir(path.dirname(bridgePath));
  await fs.outputJson(localGoal10, { stories: [{ story_id: "cutover-one", status: "ready" }] });

  const args = parseArgs(["node", "tools/next-publish-candidates.js", "--bridge", bridgePath]);
  assert.equal(await resolveUpstreamBenchmarkReportPath(args), localGoal10);
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

test("next publish report preserves already-public bridge exclusions beyond the display cap", () => {
  const excludedNoise = Array.from({ length: 25 }, (_, index) =>
    baseStory({
      id: `already-public-${index}`,
      title: `Already Public Filler ${index}`,
      youtube_post_id: `yt-${index}`,
    }),
  );
  const bridgedAlreadyPublic = baseStory({
    id: "bridge-already-public",
    title: "Forza Horizon 6 Becomes Highest Rated Game of 2026",
    scheduler_bridge_source: "scheduler_bridge_candidates",
    youtube_post_id: "yt-live",
    youtube_url: "https://youtube.com/shorts/live",
    instagram_media_id: "ig-live",
    facebook_post_id: "fb-live",
  });

  const report = buildNextPublishCandidatesReport([...excludedNoise, bridgedAlreadyPublic], {
    analyticsText,
    generatedAt: "2026-05-23T08:25:00.000Z",
    limit: 2,
  });

  assert.ok(
    report.excluded.some(
      (row) =>
        row.id === "bridge-already-public" &&
        /^already_has_public_platform_id:/i.test(row.reason),
    ),
  );
});

test("candidate source selection falls back when authoritative bridge is empty", () => {
  const selected = selectCandidateSourceStories({
    liveStories: [
      baseStory({ id: "live-clean", title: "Nintendo confirms Switch 2 bundle outcome" }),
    ],
    bridgeCandidates: [],
    bridgeManifest: {
      requested: true,
      exists: true,
      candidate_count: 0,
    },
  });

  assert.equal(selected.bridge_manifest.authoritative, false);
  assert.equal(selected.bridge_manifest.live_fallback_used, true);
  assert.equal(selected.bridge_manifest.live_db_rows_ignored, 0);
  assert.deepEqual(selected.stories.map((story) => story.id), ["live-clean"]);
});

test("candidate source selection falls back when every bridge candidate is already public on enabled platforms", () => {
  const selected = selectCandidateSourceStories({
    liveStories: [
      baseStory({
        id: "bridge-already-public",
        title: "Granblue Fantasy Relink Demo Has A Reinstall Catch",
        youtube_post_id: "yt-live",
        youtube_url: "https://youtube.com/shorts/yt-live",
        instagram_media_id: "ig-live",
        facebook_post_id: "fb-live",
      }),
      baseStory({ id: "live-clean", title: "Nintendo confirms Switch 2 bundle outcome" }),
    ],
    bridgeCandidates: [
      baseStory({
        id: "bridge-already-public",
        title: "Granblue Fantasy: Relink Demo Is The Real Proof",
        scheduler_bridge_source: "local_bridge_candidate_upsert",
      }),
    ],
    bridgeManifest: {
      requested: true,
      exists: true,
      candidate_count: 1,
    },
  });

  assert.equal(selected.bridge_manifest.authoritative, false);
  assert.equal(selected.bridge_manifest.live_fallback_used, true);
  assert.equal(selected.bridge_manifest.live_db_rows_ignored, 0);
  assert.ok(selected.stories.some((story) => story.id === "live-clean"));
  assert.ok(
    selected.stories.some(
      (story) =>
        story.id === "bridge-already-public" &&
        story.scheduler_bridge_overlay_live_row === true &&
        story.youtube_post_id === "yt-live",
    ),
  );
});

test("candidate source selection keeps authoritative bridge when a bridge candidate has missing enabled platforms", () => {
  const selected = selectCandidateSourceStories({
    liveStories: [
      baseStory({
        id: "bridge-youtube-only",
        title: "Mina The Hollower Has A Sequel Risk",
        youtube_post_id: "yt-live",
        youtube_url: "https://youtube.com/shorts/yt-live",
      }),
      baseStory({ id: "live-clean", title: "Nintendo confirms Switch 2 bundle outcome" }),
    ],
    bridgeCandidates: [
      baseStory({
        id: "bridge-youtube-only",
        title: "Mina The Hollower Needs Reels Completion",
        scheduler_bridge_source: "local_bridge_candidate_upsert",
      }),
    ],
    bridgeManifest: {
      requested: true,
      exists: true,
      candidate_count: 1,
    },
  });

  assert.equal(selected.bridge_manifest.authoritative, true);
  assert.equal(selected.bridge_manifest.live_fallback_used, false);
  assert.equal(selected.bridge_manifest.live_db_rows_considered, 1);
  assert.equal(selected.stories.length, 1);
  assert.equal(selected.stories[0].id, "bridge-youtube-only");
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

test("next publish report treats clearer 50-60s retention shorts as publish-ready", () => {
  const report = buildNextPublishCandidatesReport(
    [
      baseStory({
        id: "v4_retention_short_clearer_story",
        title: "Gears E-Day Has A 130GB Problem",
        auto_approved: true,
        duration_seconds: 51.7,
        duration_lane: "pulse_retention_short",
        allow_retention_short_video: true,
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
      }),
    ],
    { analyticsText, generatedAt: "2026-06-18T20:00:00.000Z" },
  );

  assert.equal(report.excluded.length, 0);
  assert.equal(report.candidates[0].id, "v4_retention_short_clearer_story");
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

test("next publish report default includes every authoritative bridge candidate", () => {
  const bridged = Array.from({ length: 18 }, (_, index) =>
    baseStory({
      id: `bridge_story_${index + 1}`,
      title: `Xbox bridge story ${index + 1} names a concrete outcome`,
      auto_approved: true,
      duration_seconds: 66,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      scheduler_bridge_source: "goal_production_cutover",
    }),
  );

  const report = buildNextPublishCandidatesReport(bridged, {
    analyticsText,
    generatedAt: "2026-05-26T09:00:00.000Z",
    bridgeManifest: {
      status: "loaded",
      authoritative: true,
      candidate_count: bridged.length,
    },
  });

  assert.equal(report.totals.candidates, 18);
  assert.equal(report.totals.returned, 18);
  assert.equal(report.candidates.length, 18);
});

test("next publish report still honours an explicit bridge candidate limit", () => {
  const bridged = Array.from({ length: 18 }, (_, index) =>
    baseStory({
      id: `bridge_limited_${index + 1}`,
      title: `Nintendo bridge story ${index + 1} names a concrete outcome`,
      auto_approved: true,
      duration_seconds: 50,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      scheduler_bridge_source: "goal_production_cutover",
    }),
  );

  const report = buildNextPublishCandidatesReport(bridged, {
    analyticsText,
    generatedAt: "2026-05-26T09:00:00.000Z",
    limit: 6,
    bridgeManifest: {
      status: "loaded",
      authoritative: true,
      candidate_count: bridged.length,
    },
  });

  assert.equal(report.totals.candidates, 18);
  assert.equal(report.totals.returned, 6);
  assert.equal(report.candidates.length, 6);
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

test("bridge candidate overlay drops stale live SFX inventory when bridge omits it", () => {
  const live = [
    baseStory({
      id: "same_story",
      title: "Old SFX inventory story",
      sfx_asset_inventory: [
        {
          asset_id: "old-impact",
          path: "audio/epidemic/sfx/old-impact.mp3",
          source_url: "file://audio/epidemic/sfx/old-impact.mp3",
          source_type: "licensed_sfx_library_file",
        },
      ],
    }),
  ];
  const bridged = [
    baseStory({
      id: "same_story",
      title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      scheduler_bridge_source: "local_bridge_candidate_upsert",
      video_clips: [
        {
          asset_id: "same_story-motion-1",
          path: "output/video_cache/same_story_clip.mp4",
          source_url: "https://video.akamai.steamstatic.com/example/hls_264_master.m3u8",
          source_type: "official_direct_video",
        },
      ],
      rights_ledger: [
        {
          asset_id: "same_story-motion-1",
          path: "output/video_cache/same_story_clip.mp4",
          source_url: "https://video.akamai.steamstatic.com/example/hls_264_master.m3u8",
          source_type: "official_direct_video",
          licence_basis: "official_publisher_source",
          commercial_use_allowed: true,
          allowed_platforms: ["youtube", "instagram", "facebook"],
          risk_score: 0.08,
        },
      ],
    }),
  ];

  const merged = mergeBridgeCandidates(live, bridged);

  assert.equal(merged[0].id, "same_story");
  assert.equal(merged[0].scheduler_bridge_overlay_live_row, true);
  assert.deepEqual(merged[0].sfx_asset_inventory, []);
  assert.equal(merged[0].video_clips.length, 1);
});

test("bridge candidate overlay preserves live terminal publish state over stale bridge readiness", () => {
  const live = [
    baseStory({
      id: "same_story",
      title: "GTA VI Starts The Preorder Fight",
      publish_status: "failed",
      publish_error: "script_validation_review_required_public_row_repair",
      youtube_post_id: "yt-live",
      youtube_url: "https://youtube.com/shorts/yt-live",
      facebook_post_id: "fb-live",
    }),
  ];
  const bridged = [
    baseStory({
      id: "same_story",
      title: "GTA VI Starts The Preorder Fight",
      scheduler_bridge_source: "local_bridge_candidate_upsert",
      auto_approved: true,
      publish_status: null,
      publish_error: null,
      qa_failed: false,
      qa_failures: [],
    }),
  ];

  const merged = mergeBridgeCandidates(live, bridged);
  const report = buildNextPublishCandidatesReport(merged, {
    analyticsText,
    generatedAt: "2026-06-27T17:10:00.000Z",
  });

  assert.equal(merged[0].publish_status, "failed");
  assert.equal(merged[0].publish_error, "script_validation_review_required_public_row_repair");
  assert.equal(report.candidates.length, 0);
  assert.ok(
    report.excluded.some(
      (row) =>
        row.id === "same_story" &&
        row.reason === "qa_failure:publish_status=failed",
    ),
  );
});

test("current bridge manifest excludes stale live bridge rows that are not present", () => {
  const live = [
    baseStory({
      id: "stale_bridge_story",
      title: "Spellcasters Chronicles Is Shutting Down",
      auto_approved: true,
      exported_path: "output/final/stale_bridge_story.mp4",
      audio_path: "output/audio/stale_bridge_story.mp3",
      duration_seconds: 42,
      scheduler_bridge_source: "old_goal_production_cutover",
    }),
    baseStory({
      id: "fresh_bridge_story",
      title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      auto_approved: true,
      exported_path: "output/final/fresh_bridge_story.mp4",
      audio_path: "output/audio/fresh_bridge_story.mp3",
      duration_seconds: 42,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      max_video_duration_seconds: 60,
    }),
  ];
  const bridged = [
    baseStory({
      id: "fresh_bridge_story",
      title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
      auto_approved: true,
      exported_path: "output/final/fresh_bridge_story.mp4",
      audio_path: "output/audio/fresh_bridge_story.mp3",
      duration_seconds: 42,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      max_video_duration_seconds: 60,
      scheduler_bridge_source: "goal_production_cutover",
    }),
  ];

  const merged = mergeBridgeCandidates(live, bridged);
  const report = buildNextPublishCandidatesReport(merged, {
    analyticsText,
    generatedAt: "2026-05-23T10:45:00.000Z",
  });

  assert.ok(report.candidates.some((candidate) => candidate.id === "fresh_bridge_story"));
  assert.ok(!report.candidates.some((candidate) => candidate.id === "stale_bridge_story"));
  assert.ok(
    report.excluded.some(
      (row) =>
        row.id === "stale_bridge_story" &&
        row.reason === "stale_scheduler_bridge_candidate:not_in_current_bridge",
    ),
  );
});

test("explicit empty scheduler bridge manifest allows live DB fallback", () => {
  const selected = selectCandidateSourceStories({
    liveStories: [
      baseStory({
        id: "live_only_after_policy_bump",
        title: "Nintendo confirms a Switch 2 bundle outcome",
        auto_approved: true,
      }),
    ],
    bridgeCandidates: [],
    bridgeManifest: {
      requested: true,
      exists: true,
      path: "output/goal-contract/scheduler_bridge_candidates.json",
      allowLiveFallback: false,
    },
  });
  const report = buildNextPublishCandidatesReport(selected.stories, {
    analyticsText,
    generatedAt: "2026-05-24T12:00:00.000Z",
    bridgeManifest: selected.bridge_manifest,
  });
  const markdown = formatNextPublishCandidatesMarkdown(report);

  assert.equal(selected.stories.length, 1);
  assert.equal(selected.stories[0].id, "live_only_after_policy_bump");
  assert.equal(report.totals.candidates, 1);
  assert.equal(report.bridge_candidates.count, 0);
  assert.equal(report.bridge_candidates.authoritative, false);
  assert.equal(report.bridge_candidates.live_fallback_used, true);
  assert.equal(report.bridge_candidates.live_db_rows_ignored, 0);
  assert.match(markdown, /live fallback: used/);
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

test("attachPreflightQa blocks public metadata QA failures before scheduler promotion", async () => {
  const stories = [
    baseStory({
      id: "unsafe_halo_metadata",
      title: "Halo: Campaign Evolved Shows The Real Remake Test",
      selected_title: "Halo: Campaign Evolved Shows The Real Remake Test",
      suggested_title: "Halo: Campaign Evolved Shows The Real Remake Test",
      canonical_subject: "Halo: Campaign Evolved",
      canonical_game: "Halo: Campaign Evolved",
      first_spoken_line: "Halo Campaign Evolved's remake debate finally has a real stress test.",
      description: "Xbox Wire showed Halo Campaign Evolved hands-on. Source: Xbox Wire.",
      primary_source: "Xbox Wire",
      source_card_label: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
      duration_seconds: 44,
      duration_lane: "pulse_retention_short",
      allow_retention_short_video: true,
      full_script:
        "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Halo Campaign Evolved's remake debate finally has a real stress test. Xbox Wire says Halo Studios showed Assault on the Control Room hands-on. The remake launches July 28, with early access July 23 for Premium Edition owners. Follow Pulse Gaming so you never miss a beat.",
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-14T14:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => null,
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "public_metadata:public_copy:unanchored_premium_edition_claim",
    ),
    JSON.stringify(report.candidates[0].preflight_qa.blockers),
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
      sfx_manifest: bridgeSfxEvidence(),
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
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [
        {
          asset_id: "bridge-official-a",
          path: "clip-a.mp4",
          source_url: "https://cdn.example.com/boltgun/a.mp4",
          source_type: "official_trailer_segment",
          rights_risk_class: "official_reference_only",
          source_family: "official_trailer_a",
        },
        {
          asset_id: "bridge-official-b",
          path: "clip-b.mp4",
          source_url: "https://cdn.example.com/boltgun/b.mp4",
          source_type: "official_trailer_segment",
          rights_risk_class: "official_reference_only",
          source_family: "official_trailer_b",
        },
        {
          asset_id: "bridge-official-c",
          path: "clip-c.mp4",
          source_url: "https://cdn.example.com/boltgun/c.mp4",
          source_type: "official_trailer_segment",
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
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "pass");
  assert.deepEqual(preflight.blockers, []);
});

test("preflight governance uses enabled scheduler platforms instead of deferred TikTok by default", async () => {
  let governanceOptions = null;
  const pass = async () => ({ result: "pass", failures: [], warnings: [] });
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "enabled_platform_scope",
      title: "Mina The Hollower Ending Points At The Sequel Risk",
      first_spoken_line: "Mina the Hollower may have hidden its sequel problem inside the ending.",
      description: "GameSpot published a spoiler interview with Yacht Club. Source: GameSpot.",
      full_script:
        "Mina the Hollower may have hidden its sequel problem inside the ending. GameSpot published a spoiler interview with Yacht Club that changes how players read the sequel hook.",
    }),
    {
      runSourceAgeQa: pass,
      runContentQa: pass,
      runVideoQa: pass,
      buildVideoQaOptionsForStory: () => ({}),
      runPlatformVideoQa: pass,
      runStudioGovernancePreflight: async (_story, options) => {
        governanceOptions = options;
        return { result: "pass", failures: [], warnings: [] };
      },
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: pass,
      runIncidentGuard: pass,
      runVoiceQualityQa: pass,
      runAudioSegmentQa: pass,
      runTimestampAlignmentQa: pass,
      runScriptScorecardQa: pass,
      env: {
        TIKTOK_ENABLED: "false",
        TIKTOK_AUTO_UPLOAD_ENABLED: "false",
      },
    },
  );

  assert.equal(preflight.status, "pass");
  assert.deepEqual(governanceOptions.platforms, ["youtube", "instagram", "facebook"]);
});

test("bridge preflight blocks source evidence older than seven days without approval", async () => {
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "stale_source_bridge",
      title: "Hot Wheels Infinite Rush Could Be Toy-Car Forza",
      selected_title: "Hot Wheels Infinite Rush Could Be Toy-Car Forza",
      canonical_subject: "Hot Wheels Infinite Rush",
      first_spoken_line: "Hot Wheels Infinite Rush sounds like a toy advert until the details kick in.",
      description: "Xbox Wire revealed Hot Wheels Infinite Rush. Source: Xbox Wire.",
      full_script:
        "Hot Wheels Infinite Rush sounds like a toy advert until the details kick in. Xbox Wire says the racer is built around four open islands.",
      source_published_at: "2026-06-05T00:00:00.000Z",
      scheduler_bridge_source: "goal_production_cutover",
    }),
    {
      nowMs: Date.parse("2026-06-12T10:30:00.000Z"),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockers.includes("source_age:source_age_exceeds_policy"));
  assert.equal(preflight.checks.source_age.evidence.policy_hours, 168);
});

test("attachPreflightQa quarantines stale bridge backlog rows from normal review", async () => {
  const story = baseStory({
    id: "stale_source_bridge_queue",
    title: "Hot Wheels Infinite Rush Could Be Toy-Car Forza",
    selected_title: "Hot Wheels Infinite Rush Could Be Toy-Car Forza",
    canonical_subject: "Hot Wheels Infinite Rush",
    first_spoken_line: "Hot Wheels Infinite Rush sounds like a toy advert until the details kick in.",
    description: "Xbox Wire revealed Hot Wheels Infinite Rush. Source: Xbox Wire.",
    full_script:
      "Hot Wheels Infinite Rush sounds like a toy advert until the details kick in. Xbox Wire says the racer is built around four open islands.",
    source_published_at: "2026-06-05T00:00:00.000Z",
    scheduler_bridge_source: "goal_production_cutover",
  });
  const report = buildNextPublishCandidatesReport([story], {
    generatedAt: "2026-06-12T10:30:00.000Z",
  });

  await attachPreflightQa(report, [story], {
    nowMs: Date.parse("2026-06-12T10:30:00.000Z"),
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].status, "review");
  assert.deepEqual(report.candidates[0].scheduler_quarantine, {
    status: "held",
    reason: "source_age_exceeds_policy",
    lane: "stale_source_backlog",
    safe_next_action: "replace_with_fresh_source_or_operator_approve_evergreen",
  });
  assert.ok(report.candidates[0].reasons.includes("scheduler_quarantine_stale_source"));
  assert.equal(report.preflight_qa.scheduler_quarantined, 1);
  assert.deepEqual(report.preflight_qa.scheduler_quarantine_reasons, {
    source_age_exceeds_policy: 1,
  });
});

test("bridge preflight keeps operator-approved evergreen stale sources as warnings", async () => {
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "evergreen_stale_source_bridge",
      title: "Hot Wheels Infinite Rush Could Be Toy-Car Forza",
      selected_title: "Hot Wheels Infinite Rush Could Be Toy-Car Forza",
      canonical_subject: "Hot Wheels Infinite Rush",
      first_spoken_line: "Hot Wheels Infinite Rush sounds like a toy advert until the details kick in.",
      description: "Xbox Wire revealed Hot Wheels Infinite Rush. Source: Xbox Wire.",
      full_script:
        "Hot Wheels Infinite Rush sounds like a toy advert until the details kick in. Xbox Wire says the racer is built around four open islands.",
      source_published_at: "2026-06-05T00:00:00.000Z",
      scheduler_bridge_source: "goal_production_cutover",
      stale_temporal_review: {
        decision: "approve_stale_with_current_relevance",
        operator_approved: true,
      },
    }),
    {
      nowMs: Date.parse("2026-06-12T10:30:00.000Z"),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "warn");
  assert.deepEqual(preflight.blockers, []);
  assert.ok(preflight.warnings.includes("source_age:source_age_exceeds_policy_operator_approved"));
});

test("preflight public copy preserves confirmed claims for specific detail checks", async () => {
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "source_backed_specific_detail",
      title: "Halo: Campaign Evolved Shows The Real Remake Test",
      selected_title: "Halo: Campaign Evolved Shows The Real Remake Test",
      canonical_subject: "Halo: Campaign Evolved",
      canonical_game: "Halo: Campaign Evolved",
      first_spoken_line: "Halo's remake debate finally has a real stress test.",
      description: "Xbox Wire showed a Halo: Campaign Evolved demo. Source: Xbox Wire.",
      full_script:
        "Halo's remake debate finally has a real stress test. Xbox Wire says Halo: Campaign Evolved supports cross-progression across Xbox, Windows PC, Steam and PlayStation 5.",
      primary_source: "Xbox Wire",
      discovery_source: "Xbox Wire",
      confirmed_claims: [
        "Xbox Wire says Halo: Campaign Evolved supports cross-play and cross-progression across Xbox Series X|S, Windows PC, Steam and PlayStation 5.",
      ],
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.checks.public_copy.result, "pass");
  assert.equal(preflight.status, "pass");
});

test("preflight blocks media-house attention failures", async () => {
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "plain_attention_pack",
      title: "Steam Next Fest Turns Demos Into A Trust Fight",
      selected_title: "Steam Next Fest Turns Demos Into A Trust Fight",
      canonical_subject: "Steam Next Fest",
      first_spoken_line: "Steam Next Fest is the moment a PC game stops hiding behind trailers.",
      first_frame_text: "STEAM NEXT FEST",
      thumbnail_headline: "STEAM NEXT FEST",
      full_script:
        "Steam Next Fest is the moment a PC game stops hiding behind trailers. The catch is that a demo exposes controls, performance and whether the first mechanic feels good. Follow Pulse Gaming so you never miss a beat.",
      platform_publish_manifest: {
        outputs: {
          youtube_shorts: {
            title: "Steam Next Fest Turns Demos Into A Trust Fight",
            description: "Steam Next Fest: Confirmed Drop. Source: Steam. Sources and related links: /p/steam",
            cover_frame: { headline: "STEAM NEXT FEST" },
          },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores: {
          motion_density_score: 92,
          first_3_seconds_hook_score: 90,
          source_lock_quality_score: 88,
          caption_legibility_score: 92,
          card_hierarchy_score: 86,
          transition_energy_score: 88,
          sfx_impact_score: 84,
          rights_risk_score: 96,
          media_house_polish_score: 90,
        },
        visual_evidence_profile: {
          generated_only_motion_deck: false,
          motion_asset_count: 8,
          real_media_family_count: 4,
          blockers: [],
        },
        failures: [],
      },
      director_beat_map: {
        shot_plan: [{ id: "hook", kind: "hook_slam", startS: 0, durationS: 1.2 }],
        transition_plan: { planned: [{ family: "impact_cut" }], max_same_family_run: 1 },
        sound_transition_plan: {
          sfx: {
            cue_count: 6,
            max_same_family_run: 1,
            cues: [{ family: "impact", atS: 0 }],
            mastering: { duck_under_narration: true, narration_priority: true },
          },
        },
        caption_policy: { avoid_lower_third_collisions: true },
      },
      audio_manifest: {
        voice_status: "materialized",
        word_timestamp_count: 60,
        mix_rules: { narration_priority: true },
      },
    }),
    {
      mediaHouseQaEnabled: true,
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("media_house:platform_copy_too_plain"),
    JSON.stringify(preflight, null, 2),
  );
  assert.ok(
    preflight.blockers.includes("media_house:first_frame_or_thumbnail_not_attention_led"),
    JSON.stringify(preflight, null, 2),
  );
});

test("bridge preflight blocks stale bridge duration metadata against current render manifest", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-stale-"));
  t.after(() => fs.remove(tmpDir));
  const renderManifestPath = path.join(tmpDir, "render_manifest.json");
  await fs.writeJson(renderManifestPath, {
    rendered_duration_s: 44.333,
    output_path: "D:/pulse-data/media/output/final/bridge_stale_duration.mp4",
  });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_stale_duration",
      title: "Hades II Just Broke PlayStation's Silence",
      scheduler_bridge_source: "goal_production_cutover",
      render_manifest_path: renderManifestPath,
      scheduler_bridge_artifact_dir: tmpDir,
      exported_path: "D:/pulse-data/media/output/final/bridge_stale_duration.mp4",
      duration_seconds: 42.733,
      runtime_seconds: 42.733,
      audio_duration: 42.733,
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes(
      "bridge_artifact_freshness:bridge_metadata_stale:duration_seconds",
    ),
  );
});

test("bridge preflight blocks stale embedded SFX evidence against current package manifest", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-bridge-stale-sfx-"));
  t.after(() => fs.remove(tmpDir));
  const renderManifestPath = path.join(tmpDir, "render_manifest.json");
  await fs.writeJson(renderManifestPath, {
    rendered_duration_s: 44.333,
    output_path: "D:/pulse-data/media/output/final/bridge_stale_sfx.mp4",
  });
  await fs.writeJson(path.join(tmpDir, "sfx_manifest.json"), {
    source_plan: {
      readiness: { status: "pass", blockers: [] },
      selected_assets: [
        {
          asset_id: "clean-editorial-select-tick",
          role: "ui_tick",
          provider_id: "sonniss",
          source_url: "file://licensed/sonniss/UIClick_Select_Middle_29.wav",
        },
      ],
    },
  });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_stale_sfx",
      title: "Hades II Just Broke PlayStation's Silence",
      scheduler_bridge_source: "goal_production_cutover",
      render_manifest_path: renderManifestPath,
      scheduler_bridge_artifact_dir: tmpDir,
      exported_path: "D:/pulse-data/media/output/final/bridge_stale_sfx.mp4",
      duration_seconds: 44.333,
      runtime_seconds: 44.333,
      audio_duration: 44.333,
      sfx_manifest: {
        source_plan: {
          readiness: { status: "pass", blockers: [] },
          selected_assets: [
            {
              asset_id: "stale-activation-pack-click",
              role: "ui_tick",
              provider_id: "sonniss",
              source_url: "file://licensed/sonniss/CB Sounddesign - Activation 2/UIClick_UI Click 33.wav",
            },
          ],
        },
      },
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes(
      "bridge_artifact_freshness:bridge_metadata_stale:sfx_manifest_selected_assets",
    ),
  );
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
      sfx_manifest: bridgeSfxEvidence(),
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
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockers.includes("incident_guard:visual_evidence:generated_only_motion_deck"));
});

test("bridge preflight accepts human-reviewed source-locked owned explainer bridge evidence", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture();
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_owned_explainer",
      title: "Xbox Fans Used Feedback To Demand Exclusives",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      canonical_subject: "Xbox",
      first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
      description: "IGN reported Xbox Player Voice feedback turned into an exclusives argument. Source: IGN.",
      full_script:
        "Xbox asked for feedback and immediately got the exclusives argument. IGN reported the Player Voice update and the fan response around exclusives.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      human_reviewed_owned_explainer_motion_exception: true,
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_owned_explainer.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_owned_explainer.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_owned_explainer_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_owned_explainer.srt",
      primary_source: "IGN",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Xbox Fans Used Feedback To Demand Exclusives" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Xbox",
          first_frame_text: "XBOX FEEDBACK FIGHT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "pass");
});

test("bridge preflight blocks direct-video enrichment work-order gaps before scheduler promotion", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture("bridge_direct_video_gap");
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_direct_video_gap",
      title: "Kadokawa Stake Just Passed Sony",
      selected_title: "Kadokawa Stake Just Passed Sony",
      canonical_subject: "Kadokawa",
      first_spoken_line: "Kadokawa's shareholder fight just got more awkward for Sony.",
      description: "IGN reported Kadokawa's latest shareholder filing. Source: IGN.",
      full_script:
        "Kadokawa's shareholder fight just got more awkward for Sony. IGN reported the latest filing and the ownership balance now matters.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_direct_video_gap.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_direct_video_gap.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_direct_video_gap_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_direct_video_gap.srt",
      primary_source: "IGN",
      primary_source_url: "https://www.ign.com/articles/kadokawa-sony-shareholder-example",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Kadokawa Stake Just Passed Sony" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Kadokawa",
          first_frame_text: "KADOKAWA STAKE FIGHT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      bridgeMotionGovernanceEvidence: {
        direct_video_enrichment_story_ids: ["bridge_direct_video_gap"],
      },
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("bridge_motion_governance:direct_video_enrichment_required"),
  );
});

test("bridge preflight does not hard-block non-blocking direct-video quality-gap work orders", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture(
    "bridge_direct_video_quality_gap",
  );
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_direct_video_quality_gap",
      title: "Beastro Has A Cozy Deckbuilding Test",
      selected_title: "Beastro Has A Cozy Deckbuilding Test",
      canonical_subject: "Beastro",
      first_spoken_line: "Beastro just got a small test that says a lot about Xbox's indie strategy.",
      description: "Xbox Wire confirmed Beastro's latest demo details. Source: Xbox Wire.",
      full_script:
        "Beastro just got a small test that says a lot about Xbox's indie strategy. Xbox Wire confirmed the demo details and the useful player question is whether the cosy deckbuilding loop has enough bite.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_direct_video_quality_gap.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_direct_video_quality_gap.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_direct_video_quality_gap_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_direct_video_quality_gap.srt",
      primary_source: "Xbox Wire",
      primary_source_url: "https://news.xbox.com/en-us/2026/06/11/beastro-demo-example",
      discovery_source: "Xbox Wire",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Beastro Has A Cozy Deckbuilding Test" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Beastro",
          first_frame_text: "BEASTRO DEMO TEST",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      bridgeMotionGovernanceEvidence: {
        direct_video_enrichment_work_order: {
          jobs: [
            {
              story_id: "bridge_direct_video_quality_gap",
              blocker_type: "visual_evidence:direct_video_motion_missing",
              quality_gap: true,
              blocking_current_dry_run: false,
            },
          ],
        },
      },
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.notEqual(preflight.status, "blocked");
  assert.ok(
    !preflight.blockers.includes("bridge_motion_governance:direct_video_enrichment_required"),
  );
});

test("bridge preflight ignores stale source-family motion blockers when current bridge clips prove direct video", async () => {
  const scores = {
    motion_density_score: 96,
    first_3_seconds_hook_score: 91,
    source_lock_quality_score: 90,
    caption_legibility_score: 95,
    card_hierarchy_score: 88,
    media_house_polish_score: 93,
  };
  const { clips, rightsLedger, footageInventory } = directVideoFixture("bridge_direct_video_resolved");
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_direct_video_resolved",
      title: "Steam Controller Date May Have Leaked",
      selected_title: "Steam Controller Date May Have Leaked",
      canonical_subject: "Steam Controller",
      first_spoken_line: "Steam Controller may have just picked up a real launch window.",
      description: "Valve's Steam listing surfaced a possible Steam Controller date. Source: Steam.",
      full_script:
        "Steam Controller may have just picked up a real launch window. Valve's Steam listing is the source, and the key player question is whether to wait before buying a controller.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 8,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_direct_video_resolved.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_direct_video_resolved.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_direct_video_resolved_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_direct_video_resolved.srt",
      primary_source: "Steam",
      primary_source_url: "https://store.steampowered.com/app/353370/Steam_Controller/",
      discovery_source: "Steam",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Steam Controller Date May Have Leaked" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Steam Controller",
          first_frame_text: "STEAM CONTROLLER DATE",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      bridgeMotionGovernanceEvidence: {
        source_family_acquisition_report: {
          rows: [
            {
              story_id: "bridge_direct_video_resolved",
              direct_video_enrichment_requested: true,
              missing_direct_video_motion: 1,
              blocking_current_motion_readiness: true,
              blockers: ["v4_motion_blocked"],
            },
          ],
        },
      },
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "warn");
  assert.ok(preflight.warnings.includes("bridge_motion_governance:stale_source_family_evidence_ignored"));
  assert.ok(
    !preflight.blockers.includes("bridge_motion_governance:direct_video_enrichment_required"),
  );
  assert.ok(!preflight.blockers.includes("bridge_motion_governance:v4_motion_pack_blocked"));
});

test("bridge preflight allows human-reviewed source-locked owned explainer exceptions through enrichment work orders", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture("bridge_reviewed_gap");
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_reviewed_gap",
      title: "Xbox Fans Used Feedback To Demand Exclusives",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      canonical_subject: "Xbox",
      first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
      description: "IGN reported Xbox Player Voice feedback turned into an exclusives argument. Source: IGN.",
      full_script:
        "Xbox asked for feedback and immediately got the exclusives argument. IGN reported the Player Voice update and the fan response around exclusives.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      human_reviewed_owned_explainer_motion_exception: true,
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_reviewed_gap.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_reviewed_gap.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_reviewed_gap_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_reviewed_gap.srt",
      primary_source: "IGN",
      primary_source_url: "https://www.ign.com/articles/xbox-player-voice-feedback-example",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Xbox Fans Used Feedback To Demand Exclusives" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Xbox",
          first_frame_text: "XBOX FEEDBACK FIGHT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      bridgeMotionGovernanceEvidence: {
        direct_video_enrichment_story_ids: ["bridge_reviewed_gap"],
      },
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "pass");
});

test("bridge preflight blocks automatic owned explainer exceptions without source-family approval", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture("bridge_auto_owned_gap");
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_auto_owned_gap",
      title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
      selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
      canonical_subject: "Pokémon Go",
      first_spoken_line: "Mega Mewtwo is finally coming to Pokémon Go.",
      description: "Niantic confirmed Mega Mewtwo is coming to Pokémon Go. Source: Niantic.",
      full_script:
        "Mega Mewtwo is finally coming to Pokémon Go. Niantic confirmed the raid detail and the useful player decision is when to save passes.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      owned_explainer_motion_exception_approved: true,
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_auto_owned_gap.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_auto_owned_gap.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_auto_owned_gap_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_auto_owned_gap.srt",
      primary_source: "Niantic",
      primary_source_url: "https://pokemongolive.com/post/mega-mewtwo-example",
      discovery_source: "Niantic",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Mega Mewtwo Is Finally Coming To Pokémon Go" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Pokémon Go",
          first_frame_text: "MEGA MEWTWO IS COMING",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      bridgeMotionGovernanceEvidence: {
        source_family_acquisition_report: {
          rows: [
            {
              story_id: "bridge_auto_owned_gap",
              direct_video_enrichment_requested: true,
              missing_direct_video_motion: 1,
              source_search_blockers: [],
              official_search_actions: [{ query: "Pokémon Go official trailer" }],
            },
          ],
        },
      },
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("bridge_motion_governance:direct_video_enrichment_required"),
  );
});

test("bridge preflight accepts automatic owned explainer exceptions for source-family owned-plan rows", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture("bridge_auto_broad_owned_gap");
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_auto_broad_owned_gap",
      title: "Xbox Fans Used Feedback To Demand Exclusives",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      canonical_subject: "Xbox",
      first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
      description: "IGN reported Xbox Player Voice feedback turned into an exclusives argument. Source: IGN.",
      full_script:
        "Xbox asked for feedback and immediately got the exclusives argument. IGN reported the Player Voice update and the fan response around exclusives.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      owned_explainer_motion_exception_approved: true,
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_auto_broad_owned_gap.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_auto_broad_owned_gap.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_auto_broad_owned_gap_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_auto_broad_owned_gap.srt",
      primary_source: "IGN",
      primary_source_url: "https://www.ign.com/articles/xbox-player-voice-feedback-example",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Xbox Fans Used Feedback To Demand Exclusives" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Xbox",
          first_frame_text: "XBOX FEEDBACK FIGHT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      bridgeMotionGovernanceEvidence: {
        source_family_acquisition_report: {
          rows: [
            {
              story_id: "bridge_auto_broad_owned_gap",
              direct_video_enrichment_requested: true,
              missing_direct_video_motion: 1,
              source_search_blockers: ["broad_platform_story_requires_specific_visual_plan"],
            },
          ],
        },
      },
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "pass");
});

test("bridge preflight blocks owned explainer decks without a human review or verified source exception", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const { clips, rightsLedger, footageInventory } = ownedExplainerFixture("bridge_owned_explainer_unreviewed");
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_owned_explainer_unreviewed",
      title: "Xbox Fans Used Feedback To Demand Exclusives",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      canonical_subject: "Xbox",
      first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
      description: "IGN reported Xbox Player Voice feedback turned into an exclusives argument. Source: IGN.",
      full_script:
        "Xbox asked for feedback and immediately got the exclusives argument. IGN reported the Player Voice update and the fan response around exclusives.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_owned_explainer_unreviewed.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_owned_explainer_unreviewed.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_owned_explainer_unreviewed_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_owned_explainer_unreviewed.srt",
      primary_source: "IGN",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Xbox Fans Used Feedback To Demand Exclusives" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Xbox",
          first_frame_text: "XBOX FEEDBACK FIGHT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockers.includes("incident_guard:visual_evidence:generated_only_motion_deck"));

  const sourceLockedPreflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_owned_explainer_unreviewed",
      title: "Xbox Fans Used Feedback To Demand Exclusives",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      canonical_subject: "Xbox",
      first_spoken_line: "Xbox asked for feedback and immediately got the exclusives argument.",
      description: "IGN reported Xbox Player Voice feedback turned into an exclusives argument. Source: IGN.",
      full_script:
        "Xbox asked for feedback and immediately got the exclusives argument. IGN reported the Player Voice update and the fan response around exclusives.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_owned_explainer_unreviewed.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_owned_explainer_unreviewed.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_owned_explainer_unreviewed_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_owned_explainer_unreviewed.srt",
      primary_source: "IGN",
      primary_source_url: "https://www.ign.com/articles/xbox-player-voice-feedback-example",
      discovery_source: "IGN",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Xbox Fans Used Feedback To Demand Exclusives" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Xbox",
          first_frame_text: "XBOX FEEDBACK FIGHT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: JSON.stringify(rightsLedger),
      footage_inventory: JSON.stringify(footageInventory),
      visual_v4_bridge_video_clips: JSON.stringify(clips),
      video_clips: JSON.stringify(clips),
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    },
  );

  assert.equal(sourceLockedPreflight.status, "pass");
});

test("bridge preflight blocks screenshot-derived-only motion decks", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const screenshotClips = Array.from({ length: 8 }, (_, index) => ({
    id: `bridge-screenshot-${index + 1}`,
    path: `output/video_cache/bridge-screenshot-${index + 1}.mp4`,
    source_url: `https://shared.akamai.steamstatic.com/store_item_assets/app/shot-${index + 1}.jpg`,
    source_type: "screenshot",
    media_kind: "visual_still",
    source_family: `steam_screenshot_${index + 1}`,
  }));
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_screenshot_only",
      title: "The Expanse Shows A Risky First Look",
      selected_title: "The Expanse Shows A Risky First Look",
      canonical_subject: "The Expanse: Osiris Reborn",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed its first risky look.",
      description: "Xbox showed the first look at The Expanse: Osiris Reborn. Source: Xbox.",
      full_script:
        "The Expanse: Osiris Reborn finally showed its first risky look. Xbox showed the footage, but this package only has screenshot-derived motion.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 8,
      exported_path: "D:/pulse-data/media/output/final/bridge_screenshot_only.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_screenshot_only.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_screenshot_only_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_screenshot_only.srt",
      primary_source: "Xbox",
      discovery_source: "Xbox",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "The Expanse Shows A Risky First Look" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "The Expanse: Osiris Reborn",
          first_frame_text: "EXPANSE FIRST LOOK",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: screenshotClips.map((clip) => ({
        ...clip,
        asset_type: "screenshot_derived_motion_clip",
        kind: "video",
        licence_basis: "source_documented_transformative_editorial_use",
        allowed_use: "screenshot_derived_editorial_motion",
        approval_status: "approved_for_transformative_editorial_use",
      })),
      video_clips: screenshotClips,
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockers.includes("incident_guard:visual_evidence:direct_video_motion_missing"));
});

test("bridge preflight blocks repeated direct-video windows from one source URL", async () => {
  const scores = {
    motion_density_score: 92,
    first_3_seconds_hook_score: 88,
    source_lock_quality_score: 86,
    caption_legibility_score: 94,
    card_hierarchy_score: 84,
    media_house_polish_score: 90,
  };
  const sourceUrl =
    "https://video.fastly.steamstatic.com/store_trailers/1172620/418022350/hash/hls_264_master.m3u8?t=1720000000";
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `bridge-sea-window-${index + 1}`,
    path: `output/video_cache/bridge-sea-window-${index + 1}.mp4`,
    source_url: sourceUrl,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: `steam_1172620_sea_of_thieves_window_${index + 1}`,
    motion_family: `steam_1172620_sea_of_thieves_window_${index + 1}`,
    rights_risk_class: "official_reference_transformative_editorial_use",
    licence_basis: "official_reference_transformative_editorial_use",
    commercial_use_allowed: true,
    approval_status: "approved_for_transformative_editorial_use",
  }));
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "bridge_repeated_direct_windows",
      title: "Sea Of Thieves Custom Seas Could Split Crews",
      selected_title: "Sea Of Thieves Custom Seas Could Split Crews",
      canonical_subject: "Sea of Thieves",
      first_spoken_line: "Sea of Thieves just made private crews a bigger argument.",
      description: "Rare showed the Custom Seas update for Sea of Thieves. Source: Xbox Wire.",
      full_script:
        "Sea of Thieves just made private crews a bigger argument. Xbox Wire showed the Custom Seas update, but this package repeats one source video too often.",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 5,
      visual_v4_render_bridge_clip_count: 5,
      exported_path: "D:/pulse-data/media/output/final/bridge_repeated_direct_windows.mp4",
      audio_path: "D:/pulse-data/media/output/audio/bridge_repeated_direct_windows.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/bridge_repeated_direct_windows_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/bridge_repeated_direct_windows.srt",
      primary_source: "Xbox Wire",
      primary_source_url: "https://news.xbox.com/en-us/2026/06/22/sea-of-thieves-custom-seas/",
      discovery_source: "Xbox Wire",
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Sea Of Thieves Custom Seas Could Split Crews" },
        },
      },
      visual_quality_report: {
        result: "pass",
        scores,
        frame_rules: {
          first_frame_subject: "Sea of Thieves",
          first_frame_text: "CUSTOM SEAS SPLIT",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores,
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: clips.map((clip) => ({
        ...clip,
        asset_type: "direct_video_motion_clip",
        allowed_use: "transformative_editorial_reference",
      })),
      visual_v4_bridge_video_clips: clips,
      video_clips: clips,
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(preflight.blockers.includes("incident_guard:incident:distinct_motion_families_missing"));
  assert.ok(
    preflight.blockers.includes(
      "incident_guard:visual_evidence:insufficient_real_visual_source_families",
    ),
  );
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

test("attachPreflightQa blocks candidates without rendered-audio segment loudness proof", async () => {
  const stories = [
    baseStory({
      id: "audio_jump",
      title: "Forza Horizon 6 Just Changed Xbox's Steam Plan",
      audio_segment_loudness_report: {
        verdict: "fail",
        blockers: ["voice_segment_loudness_jump"],
        warnings: [],
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-24T20:40:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "audio_segment_loudness:voice_segment_loudness_jump",
    ),
  );
});

test("attachPreflightQa blocks candidates with failed voice quality evidence", async () => {
  const stories = [
    baseStory({
      id: "voice_too_fast",
      title: "GTA 5 Became The GTA 6 Waiting Room",
      voice_quality_report: {
        verdict: "FAIL",
        blockers: ["voice_cadence:wpm_too_fast"],
        warnings: ["voice_cadence:dense_sentences_at_fast_pace"],
        cadence: {
          spoken_wpm: 209.7,
          blockers: ["voice_cadence:wpm_too_fast"],
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-12T20:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.equal(report.candidates[0].status, "review");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "voice_quality:voice_cadence:wpm_too_fast",
    ),
  );
});

test("attachPreflightQa blocks stale voice reports when current timestamps prove narration is too fast", async () => {
  const words = Array.from({ length: 101 }, (_, index) => ({
    word: `w${index + 1}`,
    start: Number((index * 0.31).toFixed(2)),
    end: Number((index * 0.31 + 0.18).toFixed(2)),
  }));
  words[words.length - 1].end = 31.44;
  const stories = [
    baseStory({
      id: "stale_voice_report_fast_current_timestamps",
      title: "Minecraft Dungeons II Has A Co-Op Risk",
      canonical_subject: "Minecraft Dungeons II",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 150.9,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "local_tts",
      },
      word_timestamps_payload: {
        words,
        meta: {
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-15T13:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "voice_quality:voice_cadence:wpm_too_fast",
    ),
  );
  assert.equal(
    report.candidates[0].preflight_qa.checks.voice_quality.evidence.current_spoken_wpm,
    192.7,
  );
  assert.ok(
    report.candidates[0].preflight_qa.checks.voice_quality.warnings.includes(
      "voice_quality_report_cadence_stale",
    ),
  );
});

test("attachPreflightQa blocks stale GTA roman-numeral voice pronunciation metadata", async () => {
  const words = [
    { word: "Grand", start: 0, end: 0.3 },
    { word: "Theft", start: 0.31, end: 0.6 },
    { word: "Auto", start: 0.61, end: 0.9 },
    { word: "VI", start: 0.91, end: 1.1 },
    { word: "now", start: 1.11, end: 1.3 },
    { word: "has", start: 1.31, end: 1.5 },
    { word: "one", start: 1.51, end: 1.7 },
    { word: "catch", start: 1.71, end: 1.96 },
  ];
  const stories = [
    baseStory({
      id: "stale_gta_roman_voice_profile",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script: "Grand Theft Auto VI now has one catch.",
      tts_script: "Grand Theft Auto VI now has one catch.",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 137.6,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "local_tts",
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: "Grand Theft Auto VI now has one catch.",
          spoken_text: "Grand Theft Auto VI now has one catch.",
          ttsPronunciationProfileVersion: "title-colon-pause-v2",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-26T23:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_profile_stale",
    ),
  );
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_text_stale",
    ),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.expected_tts_pronunciation_profile_version,
    TTS_PRONUNCIATION_PROFILE_VERSION,
  );
});

test("attachPreflightQa blocks GTA VI pronunciation-sensitive packages without recorded spoken proof", async () => {
  const rawScript =
    "GTA 6 just made preorders a trust test. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = [
    { word: "Rockstar's", start: 0, end: 0.3 },
    { word: "next", start: 0.31, end: 0.5 },
    { word: "Grand", start: 0.51, end: 0.8 },
    { word: "Theft", start: 0.81, end: 1.0 },
    { word: "Auto", start: 1.01, end: 1.2 },
    { word: "just", start: 1.21, end: 1.4 },
    { word: "made", start: 1.41, end: 1.6 },
  ];
  const stories = [
    baseStory({
      id: "gta_vi_current_profile_missing_recorded_spoken",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script: rawScript,
      tts_script: rawScript,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 149.2,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "local_tts",
      },
      word_timestamps_payload: {
        words,
        meta: {
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-26T23:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_recorded_text_missing",
    ),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_pronunciation_sensitive,
    true,
  );
});

test("attachPreflightQa blocks GTA VI pronunciation-sensitive packages without word timestamp proof", async () => {
  const rawScript =
    "GTA 6 just made preorders a trust test. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const expectedSpoken =
    "Rockstar's next Grand Theft Auto just made preorders a trust test. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const stories = [
    baseStory({
      id: "gta_vi_current_profile_missing_word_proof",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script: rawScript,
      tts_script: rawScript,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 149.2,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "local_tts",
      },
      word_timestamps_payload: {
        words: [],
        meta: {
          transcript: expectedSpoken,
          spoken_text: expectedSpoken,
          text: expectedSpoken,
          ttsPronunciationProfileVersion: TTS_PRONUNCIATION_PROFILE_VERSION,
          wordTimestampSource: "synthetic_character_alignment",
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-30T08:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_word_timestamps_missing",
    ),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_pronunciation_sensitive,
    true,
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.recorded_word_timestamps_present,
    false,
  );
});

test("attachPreflightQa blocks GTA VI timestamp evidence without the current pronunciation profile", async () => {
  const safeSpoken =
    "Rockstar's next Grand Theft Auto just made pre orders a trust test. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = safeSpoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.45).toFixed(2)),
      end: Number((index * 0.45 + 0.2).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.45).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_missing_pronunciation_profile",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script: safeSpoken,
      tts_script: safeSpoken,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 146.5,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: safeSpoken,
          spoken_text: safeSpoken,
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-28T19:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_profile_stale",
    ),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_pronunciation_sensitive,
    true,
  );
});

test("attachPreflightQa blocks compact GTAVI timestamp evidence without the current pronunciation profile", async () => {
  const safeSpoken =
    "Cover art just made pre orders a trust test. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = safeSpoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.45).toFixed(2)),
      end: Number((index * 0.45 + 0.2).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.45).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gtavi_missing_pronunciation_profile",
      title: "GTAVI Starts The Preorder Fight",
      canonical_subject: "GTAVI",
      narration_script: safeSpoken,
      tts_script: safeSpoken,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 146.5,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: safeSpoken,
          spoken_text: safeSpoken,
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-28T19:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_profile_stale",
    ),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_pronunciation_sensitive,
    true,
  );
});

test("attachPreflightQa does not block non-GTA pronunciation aliases when recorded speech matches current text", async () => {
  const rawScript =
    "MARVEL Tokon finally showed real gameplay. GameSpot's footage shows Magneto and Black Panther in two-on-two combat. Follow Pulse Gaming so you never miss a beat.";
  const recorded =
    "MARVEL Tokon finally showed real gameplay. Game Spot's footage shows Magneto and Black Panther in two on two combat. Follow Pulse Gaming so you never miss a beat.";
  const words = recorded
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.4).toFixed(2)),
      end: Number((index * 0.4 + 0.2).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.4).toFixed(2));
  const stories = [
    baseStory({
      id: "non_gta_source_alias_old_profile",
      title: "MARVEL Tokon Finally Shows Real Gameplay",
      canonical_subject: "MARVEL Tokon",
      narration_script: rawScript,
      tts_script: rawScript,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 156.7,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "elevenlabs",
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: recorded,
          spoken_text: recorded,
          ttsPronunciationProfileVersion: "gta-clean-six-title-v5",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-26T23:05:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.ok(candidate);
  assert.notEqual(candidate.preflight_qa.status, "blocked");
  assert.ok(
    !candidate.preflight_qa.blockers.includes(
      "voice_quality:voice_pronunciation_profile_stale",
    ),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.profile_sensitive,
    true,
  );
});

test("attachPreflightQa blocks risky GTA VI spoken-six phrases in the opener even with current voice metadata", async () => {
  const spoken =
    "Rockstar just turned GTA six pre orders into a buy, wait or skip argument. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.5).toFixed(2)),
      end: Number((index * 0.5 + 0.22).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.5).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_spoken_six_opener",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 167.3,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-27T07:25:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:gta_vi_opening_spoken_six_risk",
    ),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_opening_spoken_six_risk,
    true,
  );
});

test("attachPreflightQa blocks malformed GTA VI see-six stutters in recorded opening speech", async () => {
  const spoken =
    "GTA see-six just turned pre orders into a buy, wait or skip argument. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.5).toFixed(2)),
      end: Number((index * 0.5 + 0.22).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.5).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_malformed_stutter_opener",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 167.3,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-27T07:25:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:gta_vi_spoken_stutter"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_stutter,
    true,
  );
  assert.deepEqual(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_stutter_sources,
    ["recorded_spoken_text"],
  );
});

test("attachPreflightQa blocks exact GTA VI si-six stutters in recorded opening speech", async () => {
  const spoken =
    "GTA si-six just turned pre orders into a buy, wait or skip argument. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.5).toFixed(2)),
      end: Number((index * 0.5 + 0.22).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.5).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_si_six_stutter_opener",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 167.3,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-27T07:25:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:gta_vi_spoken_stutter"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_stutter,
    true,
  );
  assert.deepEqual(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_stutter_sources,
    ["recorded_spoken_text"],
  );
});

test("attachPreflightQa blocks GTA VI word-level stutters even when timestamp metadata is clean", async () => {
  const cleanSpoken =
    "Rockstar's next Grand Theft Auto just turned pre orders into a buy, wait or skip argument. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const actualWords =
    "GTA s i six just turned pre orders into a buy wait or skip argument Follow Pulse Gaming so you never miss a beat"
      .split(/\s+/)
      .map((word, index) => ({
        word,
        start: Number((index * 0.45).toFixed(2)),
        end: Number((index * 0.45 + 0.22).toFixed(2)),
      }));
  actualWords[actualWords.length - 1].end = Number((actualWords.length * 0.45).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_word_level_si_six_stutter",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script:
        "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. " +
        "Follow Pulse Gaming so you never miss a beat.",
      tts_script: cleanSpoken,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 151.2,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words: actualWords,
        meta: {
          transcript: cleanSpoken,
          spoken_text: cleanSpoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-28T16:55:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:gta_vi_spoken_stutter"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.deepEqual(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_stutter_sources,
    ["recorded_word_text"],
  );
});

test("attachPreflightQa blocks stale spaced GTA six timestamp speech even without a voice report", async () => {
  const spoken =
    "G T A six now has a date players can plan around. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.44).toFixed(2)),
      end: Number((index * 0.44 + 0.2).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.44).toFixed(2));
  const safeScript =
    "Rockstar's next Grand Theft Auto now has a date players can plan around. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const stories = [
    baseStory({
      id: "current_gta_vi_spaced_six_no_voice_report",
      title: "GTA VI Release Date Reconfirmed",
      canonical_subject: "Grand Theft Auto VI",
      narration_script: safeScript,
      tts_script: safeScript,
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-28T13:55:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:gta_vi_opening_spoken_six_risk",
    ),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:gta_vi_spoken_six"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.deepEqual(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_six_sources,
    ["recorded_spoken_text"],
  );
});

test("attachPreflightQa blocks split GTA VI roman narration even when script text is safe", async () => {
  const spoken =
    "Grand Theft Auto V I now has one real preorder catch. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.45).toFixed(2)),
      end: Number((index * 0.45 + 0.2).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.45).toFixed(2));
  const safeScript =
    "Rockstar's next Grand Theft Auto now has one real preorder catch. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const stories = [
    baseStory({
      id: "current_gta_vi_roman_split_recording",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script: safeScript,
      tts_script: safeScript,
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 148.4,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-28T01:20:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:gta_vi_spoken_roman_split"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_roman_split,
    true,
  );
  assert.deepEqual(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_roman_split_sources,
    ["recorded_spoken_text"],
  );
});

test("attachPreflightQa blocks recorded GTA VI spoken-six phrases outside the opener", async () => {
  const spoken =
    "Rockstar made the store page the real test. " +
    "Players are not just buying hype now; they are choosing editions, bonuses and platforms. " +
    "That is why Grand Theft Auto six pre orders need cleaner proof than another big image. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.45).toFixed(2)),
      end: Number((index * 0.45 + 0.2).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.45).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_late_spoken_six",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script:
        "Rockstar made the store page the real test. " +
        "Players are not just buying hype now; they are choosing editions, bonuses and platforms. " +
        "That is why GTA VI pre-orders need cleaner proof than another big image. " +
        "Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Rockstar made the store page the real test. " +
        "Players are not just buying hype now; they are choosing editions, bonuses and platforms. " +
        "That is why GTA VI pre-orders need cleaner proof than another big image. " +
        "Follow Pulse Gaming so you never miss a beat.",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 153.8,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-28T00:35:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:gta_vi_spoken_six"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_six,
    true,
  );
  assert.deepEqual(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_spoken_six_sources,
    ["recorded_spoken_text"],
  );
});

test("attachPreflightQa blocks early GTA VI spoken-six after a safe preface", async () => {
  const spoken =
    "Rockstar's next Grand Theft Auto just made pre orders a trust test. " +
    "Xbox Wire says GTA six pre orders open on June 25. " +
    "Follow Pulse Gaming so you never miss a beat.";
  const words = spoken
    .replace(/[,.]/g, "")
    .split(/\s+/)
    .map((word, index) => ({
      word,
      start: Number((index * 0.5).toFixed(2)),
      end: Number((index * 0.5 + 0.22).toFixed(2)),
    }));
  words[words.length - 1].end = Number((words.length * 0.5).toFixed(2));
  const stories = [
    baseStory({
      id: "current_gta_vi_late_opening_spoken_six",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      narration_script:
        "Rockstar's next Grand Theft Auto just made pre-orders a trust test. " +
        "Xbox Wire says GTA VI pre-orders open on June 25. " +
        "Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Rockstar's next Grand Theft Auto just made pre-orders a trust test. " +
        "Xbox Wire says GTA VI pre-orders open on June 25. " +
        "Follow Pulse Gaming so you never miss a beat.",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 151.2,
          blockers: [],
          warnings: [],
        },
      },
      word_timestamps_payload: {
        words,
        meta: {
          transcript: spoken,
          spoken_text: spoken,
          ttsPronunciationProfileVersion: "gta-safe-next-title-v9",
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            script_inserted_actual_word_count: 0,
            script_trailing_actual_word_count: 0,
          },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-27T07:25:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "voice_quality:gta_vi_opening_spoken_six_risk",
    ),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
  assert.equal(
    candidate.preflight_qa.checks.voice_quality.evidence.gta_vi_opening_spoken_six_risk,
    true,
  );
});

test("attachPreflightQa blocks segmented local TTS that can drift between sentences despite normal WPM", async () => {
  const stories = [
    baseStory({
      id: "segmented_local_tts",
      title: "Fable Has A 1,000 NPC Risk",
      canonical_subject: "Fable",
      scheduler_bridge_source: "goal_production_cutover",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 152.5,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "local_tts",
      },
      word_timestamps_payload: {
        words: [
          { word: "Fable", start: 0, end: 0.28 },
          { word: "has", start: 0.3, end: 0.44 },
          { word: "risk", start: 0.46, end: 0.7 },
        ],
        meta: {
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: { repaired: true },
          localTts: { speakingRate: 1 },
          segmentedLocalTtsMaterialized: true,
          segment_count: 6,
          segment_word_counts: [15, 21, 10, 20, 24, 14],
          segment_gap_s: 0.08,
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-15T13:20:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "voice_quality:local_tts_segmented_voice_continuity_unverified",
    ),
  );
  assert.equal(
    report.candidates[0].preflight_qa.checks.voice_quality.evidence.local_tts_segment_count,
    6,
  );
});

test("attachPreflightQa does not treat Whisper alignment segments as stitched local TTS chunks", async () => {
  const stories = [
    baseStory({
      id: "single_take_local_tts",
      title: "Beastro Has A Cozy Deckbuilding Test",
      canonical_subject: "Beastro",
      scheduler_bridge_source: "goal_production_cutover",
      voice_quality_report: {
        verdict: "PASS",
        blockers: [],
        warnings: [],
        cadence: {
          spoken_wpm: 157,
          blockers: [],
          warnings: [],
        },
      },
      audio_manifest: {
        voice_provider: "local_tts",
      },
      word_timestamps_payload: {
        words: [
          { word: "Beastro", start: 0, end: 0.32 },
          { word: "wins", start: 0.34, end: 0.54 },
          { word: "cleanly", start: 0.56, end: 0.9 },
        ],
        meta: {
          wordTimestampSource: "local_whisper_word_alignment",
          timestampWhisperAlignment: {
            repaired: true,
            segment_count: 4,
          },
          localTts: { speakingRate: 1 },
          segment_count: 4,
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-16T12:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  assert.equal(
    report.candidates[0].preflight_qa.blockers.includes(
      "voice_quality:local_tts_segmented_voice_continuity_unverified",
    ),
    false,
  );
  assert.equal(
    report.candidates[0].preflight_qa.checks.voice_quality.evidence.local_tts_segment_count,
    undefined,
  );
});

test("attachPreflightQa blocks local TTS candidates rendered below native rate", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-tts-rate-preflight-"));
  const timestampsPath = path.join(tmp, "slow_local_tts_timestamps.json");
  await fs.writeJson(timestampsPath, {
    words: [
      { word: "GTA", start: 0, end: 0.32 },
      { word: "5", start: 0.34, end: 0.48 },
      { word: "became", start: 0.5, end: 0.82 },
      { word: "news", start: 0.84, end: 1.12 },
    ],
    meta: {
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true },
      localTts: { speakingRate: 0.82 },
      voiceDiagnostics: { effective_rate: 0.82 },
    },
  });
  const stories = [
    baseStory({
      id: "slow_local_tts",
      title: "GTA 5 Became The GTA 6 Waiting Room",
      selected_title: "GTA 5 Became The GTA 6 Waiting Room",
      canonical_subject: "GTA 5",
      first_spoken_line: "GTA 5 became news.",
      full_script: "GTA 5 became news.",
      duration_seconds: 66,
      auto_approved: true,
      require_incident_guard: true,
      scheduler_bridge_artifact_dir: tmp,
      timestamps_path: timestampsPath,
      audio_manifest: { voice_provider: "local_tts" },
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "GTA 5 Became The GTA 6 Waiting Room" },
        },
      },
      ...bridgeVisualEvidence("GTA 5"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "slow-local-tts-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-14T16:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  const check = report.candidates[0].preflight_qa.checks.timestamp_alignment;
  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.equal(check.result, "fail");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "timestamp_alignment:local_tts_speaking_rate_below_native:0.82",
    ),
  );
  assert.equal(check.evidence.local_tts_speaking_rate, 0.82);
});

test("attachPreflightQa blocks cross-story direct motion when visual provenance does not match the subject", async () => {
  const clipPath = "output/video_cache/fresh_xbox_fable_living_population_20260610_v4_clip_1.mp4";
  const stories = [
    baseStory({
      id: "fable_wrong_motion",
      title: "Fable Has A 1,000 NPC Risk",
      selected_title: "Fable Has A 1,000 NPC Risk",
      canonical_subject: "Fable",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      visual_v4_bridge_video_clips: [
        {
          id: "fable_direct_motion_1",
          path: clipPath,
          source_url:
            "local://existing-official-direct-motion/fresh_xbox_fable_living_population_20260610/fable_clip.mp4",
          source_type: "licensed_direct_media_url",
          source_family: "direct_motion_1",
          media_kind: "direct_video",
        },
      ],
      video_clips: [clipPath],
      footage_inventory: {
        motion_inventory: {
          accepted_local_clips: [
            {
              id: "segment_direct_motion_1",
              path: clipPath,
              source_url:
                "https://cms-assets.xboxservices.com/assets/6a/5c/6a5c6baf-4d18-4639-b58e-e04d1d027d5e.mp4",
              source_family: "xbox_product_minecraft_dungeons_ii_media_02_6a5c6baf",
              source_type: "licensed_direct_media_url",
              media_kind: "direct_video",
              rights_basis: "official_direct_media",
            },
          ],
        },
      },
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_1",
            path: clipPath,
            source_url:
              "https://cms-assets.xboxservices.com/assets/6a/5c/6a5c6baf-4d18-4639-b58e-e04d1d027d5e.mp4",
            source_family: "xbox_product_minecraft_dungeons_ii_media_02_6a5c6baf",
            source_type: "licensed_direct_media_url",
            media_kind: "direct_video",
            rights_basis: "official_direct_media",
          },
        ],
      },
      ...bridgeVisualEvidence("Fable"),
      sfx_manifest: bridgeSfxEvidence(),
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-15T13:25:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "visual_entity_match:direct_motion_subject_mismatch",
    ),
  );
  assert.equal(
    report.candidates[0].preflight_qa.checks.visual_entity_match.evidence.mismatched_motion_assets[0]
      .source_family,
    "xbox_product_minecraft_dungeons_ii_media_02_6a5c6baf",
  );
});

test("attachPreflightQa accepts local official direct motion when trusted intake entity matches the subject", async () => {
  const clipPath =
    "output/video_cache/fresh_xbox_beastro_20260611_v4_clip_1_segment_direct_motion_1_9ed48b982ca0.mp4";
  const localReference =
    "local://existing-official-direct-motion/fresh_xbox_beastro_20260611/fresh_xbox_beastro_20260611_v4_clip_1_segment_direct_motion_1_9ed48b982ca0.mp4";
  const stories = [
    baseStory({
      id: "fresh_xbox_beastro_20260611",
      title: "Beastro Has A Cozy Deckbuilding Test",
      selected_title: "Beastro Has A Cozy Deckbuilding Test",
      canonical_subject: "Beastro",
      canonical_game: "Beastro",
      scheduler_bridge_source: "goal_production_cutover",
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      auto_approved: true,
      visual_v4_bridge_video_clips: [
        {
          id: "fresh_xbox_beastro_20260611_direct_motion_1",
          path: clipPath,
          source_url: localReference,
          source_type: "licensed_direct_media_url",
          source_family: "",
          media_kind: "direct_video",
        },
      ],
      video_clips: [clipPath],
      footage_inventory: {
        trusted_source_pipeline: {
          intake_queue: [
            {
              source_id: "segment_direct_motion_1",
              display_name: "direct_motion_1",
              entity: "Beastro",
              entities: ["Beastro"],
              source_family: "direct_motion_1",
              source_tier: "official",
              reference_url: localReference,
              intake_mode: "local_reference_to_motion_pack",
              rights_risk_class: "official_reference_transformative_editorial_use",
            },
          ],
        },
      },
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_1",
            path: clipPath,
            source_url: localReference,
            source_family: "direct_motion_1",
            source_type: "licensed_direct_media_url",
            media_kind: "direct_video",
            rights_basis: "official_reference_transformative_editorial_use",
          },
        ],
      },
      ...bridgeVisualEvidence("Beastro"),
      sfx_manifest: bridgeSfxEvidence(),
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-16T09:55:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  const visualEntity = report.candidates[0].preflight_qa.checks.visual_entity_match;
  assert.equal(visualEntity.result, "pass");
  assert.ok(
    !report.candidates[0].preflight_qa.blockers.includes(
      "visual_entity_match:direct_motion_subject_mismatch",
    ),
  );
  assert.match(visualEntity.evidence.direct_motion_assets[0].provenance_text, /beastro/);
});

test("visual entity preflight accepts compact GTA 6 source-family aliases", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-gta6-compact-sidecar",
    "fresh_gta6_release_reconfirm_20260616_v4_clip_1_segment_official_motion_1.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, "placeholder");
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    source_url: "https://www.youtube.com/watch?v=VQRLujxTm3c",
    source_type: "official_youtube_trailer_local_editorial_clip",
    source_family: "fresh_gta6_release_reconfirm_20260616_official_motion_1",
    rights_basis: "official_reference_transformative_editorial_use",
  });

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "fresh_gta6_release_reconfirm_20260616",
      title: "GTA 6 Delay Becomes The First Argument",
      canonical_subject: "GTA 6",
      canonical_game: "GTA 6",
      primary_source_url:
        "https://www.gamespot.com/articles/gta-6-release-date-confirmed-again-by-ceo-who-also-explains-why-its-taking-so-long/",
      scheduler_bridge_source: "goal_production_cutover",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_official_motion_1",
          path: clipPath,
          source_url: "https://www.youtube.com/watch?v=VQRLujxTm3c",
          source_type: "licensed_direct_media_url",
          media_kind: "direct_video",
          rights_basis: "official_reference_transformative_editorial_use",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.match(result.evidence.direct_motion_assets[0].provenance_text, /gta6/);
});

test("visual entity preflight treats generic segment sidecar families as opaque when bridge provenance names the subject", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-generic-segment-sidecar",
    "sea_of_thieves_v4_clip_1_segment_direct_motion_1.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, "placeholder");
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    source_url: "https://video.akamai.steamstatic.com/store_trailers/1172620/204445374/8f7db9a51493a2e0111ef3e17cd81141ee101d1c/1773669773/hls_264_master.m3u8?t=1775747049",
    source_family: "segment_source_family_1_window_8_96_5",
    rights_basis: "official_direct_media",
  });

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "sea_of_thieves_custom_seas",
      title: "Sea of Thieves Custom Seas Could Split Crews",
      canonical_subject: "Sea of Thieves",
      canonical_game: "Sea of Thieves",
      scheduler_bridge_source: "local_bridge_candidate_upsert",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url: "https://video.akamai.steamstatic.com/store_trailers/1172620/204445374/8f7db9a51493a2e0111ef3e17cd81141ee101d1c/1773669773/hls_264_master.m3u8?t=1775747049",
          source_family: "Sea of Thieves official Steam trailer segment",
          source_title: "Sea of Thieves",
          entity: "Sea of Thieves",
          entities: ["Sea of Thieves"],
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.match(result.evidence.direct_motion_assets[0].provenance_text, /sea of thieves/);
});

test("visual entity preflight accepts game-level motion when source URL mentions characters but title stays game-level", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-game-level-character-url",
    "marvel_tokon_v4_clip_1_segment_direct_motion_1.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, "placeholder");
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    source_url:
      "https://video.akamai.steamstatic.com/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008/hls_264_master.m3u8?t=1780942450",
    source_family:
      "steamstatic:/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008_window_36_5",
    rights_basis: "official_direct_media",
  });

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "rss_893a55fd9e664d31",
      title: "MARVEL Tokon Finally Shows Real Gameplay",
      selected_title: "MARVEL Tokon Finally Shows Real Gameplay",
      canonical_subject: "MARVEL Tokon",
      canonical_game: "MARVEL Tokon",
      primary_source_url:
        "https://www.gamespot.com/videos/marvel-tokon-fighting-souls-magneto-and-black-panther-gameplay/",
      full_script:
        "MARVEL Tokon could win the trailer war and still lose players fast. GameSpot's gameplay shows Magneto and Black Panther in two-on-two combat, with assists and screen-filling supers.",
      scheduler_bridge_source: "local_bridge_candidate_upsert",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url:
            "https://video.akamai.steamstatic.com/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008/hls_264_master.m3u8?t=1780942450",
          source_family:
            "steamstatic:/store_trailers/3787240/1293753200/38427149fdf9b062556b9fbcb472f93178694068/1780544008_window_36_5",
          source_title: "MARVEL Tokon",
          entity: "MARVEL Tokon",
          entities: ["MARVEL Tokon"],
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.deepEqual(result.evidence.required_specific_source_lock_tokens, []);
  assert.match(result.evidence.direct_motion_assets[0].provenance_text, /marvel tokon/);
});

test("visual entity preflight accepts trusted game-level roster motion without treating editorial title words as source locks", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-trusted-roster-game-level",
    "invincible_vs_v4_clip_1_segment_direct_motion_1.mp4",
  );
  const steamUrl =
    "https://video.akamai.steamstatic.com/store_trailers/2353060/1367633524/c24c1d0fb5dd20215e88147944ccadd70326b8ef/1782152721/hls_264_master.m3u8?t=1782230244";
  const sourceFamily =
    "steamstatic:/store_trailers/2353060/1367633524/c24c1d0fb5dd20215e88147944ccadd70326b8ef/1782152721_window_36_5";
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, "placeholder");
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    source_url: steamUrl,
    source_family: sourceFamily,
    source_type: "steam_movie",
    rights_basis: "official_reference_only",
  });

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "rss_336678f89aaf64b2",
      title: "Invincible VS Turns Its Roster Into A Meta Fight",
      selected_title: "Invincible VS Turns Its Roster Into A Meta Fight",
      canonical_subject: "Invincible VS",
      canonical_game: "Invincible VS",
      primary_source_url: "https://news.xbox.com/en-us/2026/06/23/invincible-vs-universa-the-immortal/",
      full_script:
        "Invincible VS just made the roster question sharper. Xbox Wire says Universa and The Immortal are joining the roster. Tag fighters live or die on matchups, not names on a reveal card.",
      scheduler_bridge_source: "local_bridge_candidate_upsert",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url: steamUrl,
          source_family: sourceFamily,
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_reference_only",
        },
      ],
      video_clips: [clipPath],
      footage_inventory: {
        trusted_source_pipeline: {
          intake_queue: [
            {
              source_id: "segment_direct_motion_1",
              display_name: sourceFamily,
              entity: "Invincible VS",
              entities: ["Invincible VS"],
              source_family: sourceFamily,
              source_tier: "official",
              reference_url: steamUrl,
              source_url_kind: "web_page",
              intake_mode: "local_reference_to_motion_pack",
              rights_risk_class: "official_reference_only",
            },
          ],
        },
      },
      rights_ledger: {
        verdict: "pass",
        assets: [],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.deepEqual(result.evidence.required_specific_source_lock_tokens, []);
  assert.equal(result.evidence.direct_motion_assets[0].entity, "Invincible VS");
});

test("visual entity preflight accepts Steam direct motion when rights ledger owner names the subject", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-steam-rights-owner",
    "cyberpunk_2077_v4_clip_1_segment_direct_motion_1.mp4",
  );
  const steamUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1091500/204040882/8a8e80c2c7/hls_264_master.m3u8?t=1770408778";

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "rss_4921d15c5d54b86d",
      title: "Cyberpunk 2077's Trust Debt",
      canonical_subject: "Cyberpunk 2077",
      canonical_game: "Cyberpunk 2077",
      primary_source_url:
        "https://www.pcgamer.com/games/rpg/cyberpunk-2077s-boss-says-cdpr-may-have-lost-some-players-forever/",
      scheduler_bridge_source: "goal_production_cutover",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url: steamUrl,
          source_family: "segment_source_family_1_window_0_6",
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_1",
            path: clipPath,
            source_url: steamUrl,
            source_owner: "Cyberpunk 2077",
            source_title: "Cyberpunk 2077 Official Trailer",
            source_type: "steam_movie",
            media_kind: "direct_video",
            licence_basis: "official_direct_media",
            approval_status: "approved_for_transformative_editorial_use",
          },
        ],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.match(result.evidence.direct_motion_assets[0].provenance_text, /cyberpunk 2077/);
});

test("visual entity preflight accepts GTA VI aliases for Grand Theft Auto VI official motion", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-gta-vi-alias-official-motion",
    "gta_vi_v4_clip_1_segment_direct_motion_1.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, "placeholder");
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    source_url: "https://video.rockstargames.com/gta-vi/official-trailer-2/master.m3u8",
    source_type: "official_trailer_segment",
    source_family: "rockstar_gta_vi_official_trailer_segment_window_36_5",
    rights_basis: "official_reference_transformative_editorial_use",
  });

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "fresh_gta_vi_cover_art",
      title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      canonical_game: "Grand Theft Auto VI",
      primary_source_url: "https://www.rockstargames.com/VI",
      scheduler_bridge_source: "local_bridge_candidate_upsert",
      visual_v4_bridge_video_clips: [
        {
          id: "gta-vi-official-window",
          path: clipPath,
          source_url: "https://video.rockstargames.com/gta-vi/official-trailer-2/master.m3u8",
          source_family: "rockstar_gta_vi_official_trailer_segment_window_36_5",
          source_title: "GTA VI Official Trailer",
          entity: "GTA VI",
          entities: ["GTA VI", "Grand Theft Auto VI"],
          source_type: "official_trailer_segment",
          media_kind: "direct_video",
          rights_basis: "official_reference_transformative_editorial_use",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.match(result.evidence.canonical_subject_tokens.join(" "), /gta vi/);
});

test("visual entity preflight accepts URL-prefixed opaque sidecars when rights owner names the subject", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-url-prefixed-sidecar-owner",
    "halo_campaign_evolved_v4_clip_1_segment_direct_motion_1.mp4",
  );
  const steamUrl =
    "https://video.akamai.steamstatic.com/store_trailers/2806050/1673450740/ed598dc7526249e6bd74f53732f9a6ecf71f8063/1780963408/hls_264_master.m3u8?t=1781050956";
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeFile(clipPath, "placeholder");
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    source_url: steamUrl,
    source_family: `url:${steamUrl}_window_42_40_5`,
    rights_basis: "official_direct_media",
  });

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "rss_692aa314ed95e930",
      title: "Halo's PS5 Account Catch",
      canonical_subject: "Halo: Campaign Evolved",
      canonical_game: "Halo: Campaign Evolved",
      primary_source_url:
        "https://www.eurogamer.net/halo-campaign-evolved-ps5-xbox-account-gamertag-requirement",
      scheduler_bridge_source: "goal_production_cutover",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url: steamUrl,
          source_family: `halo_campaign_evolved_url:${steamUrl}_window_42_40_5`,
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_1",
            path: clipPath,
            source_url: steamUrl,
            source_owner: "Halo: Campaign Evolved",
            source_title: "Halo: Campaign Evolved Official Trailer",
            source_type: "steam_movie",
            media_kind: "direct_video",
            licence_basis: "official_direct_media",
            approval_status: "approved_for_transformative_editorial_use",
          },
        ],
      },
    }),
  );

  assert.equal(result.result, "pass");
  assert.ok(!result.failures.includes("direct_motion_subject_mismatch"));
  assert.match(result.evidence.direct_motion_assets[0].provenance_text, /halo/);
});

test("visual entity preflight blocks Steam direct motion when rights ledger owner names another subject", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-steam-rights-owner-mismatch",
    "cyberpunk_2077_v4_clip_1_segment_direct_motion_1.mp4",
  );
  const steamUrl =
    "https://video.akamai.steamstatic.com/store_trailers/1091500/204040882/8a8e80c2c7/hls_264_master.m3u8?t=1770408778";

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "rss_4921d15c5d54b86d",
      title: "Cyberpunk 2077's Trust Debt",
      canonical_subject: "Cyberpunk 2077",
      canonical_game: "Cyberpunk 2077",
      primary_source_url:
        "https://www.pcgamer.com/games/rpg/cyberpunk-2077s-boss-says-cdpr-may-have-lost-some-players-forever/",
      scheduler_bridge_source: "goal_production_cutover",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url: steamUrl,
          source_family: "segment_source_family_1_window_0_6",
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_1",
            path: clipPath,
            source_url: steamUrl,
            source_owner: "The Witcher 4",
            source_title: "The Witcher 4 Official Trailer",
            source_type: "steam_movie",
            media_kind: "direct_video",
            licence_basis: "official_direct_media",
            approval_status: "approved_for_transformative_editorial_use",
          },
        ],
      },
    }),
  );

  assert.equal(result.result, "fail");
  assert.ok(result.failures.includes("direct_motion_subject_mismatch"));
  assert.match(result.evidence.mismatched_motion_assets[0].provenance_text, /witcher 4/);
});

test("visual entity preflight blocks same-game wrong-character direct motion", async () => {
  const alexTrailer =
    "https://video.akamai.steamstatic.com/store_trailers/1364780/1659974978/e2cc6b24bc61a2692becfadca7a5687f36d6324b/1769127372/hls_264_master.m3u8?t=1769142439";
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-sf6-wrong-character",
    "sf6_yasmine_v4_clip_1_alex_motion.mp4",
  );

  const result = await visualEntityPreflightForStory(
    baseStory({
      id: "sf6_yasmine_wrong_character",
      title: "Street Fighter 6 Yasmine Gameplay Reveal",
      selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      canonical_subject: "Street Fighter 6",
      canonical_game: "Street Fighter 6",
      primary_source_url:
        "https://www.gamespot.com/videos/street-fighter-6-yasmine-character-gameplay-reveal-trailer/",
      scheduler_bridge_source: "goal_production_cutover",
      visual_v4_bridge_video_clips: [
        {
          id: "segment_direct_motion_1",
          path: clipPath,
          source_url: alexTrailer,
          source_family: "SF6_ALEX_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
          source_title: "SF6_ALEX_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
          entity: "Street Fighter 6",
          source_type: "steam_movie",
          media_kind: "direct_video",
          rights_basis: "official_direct_media",
        },
      ],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_1",
            path: clipPath,
            source_url: alexTrailer,
            source_family: "SF6_ALEX_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
            source_owner: "Street Fighter 6",
            source_title: "SF6_ALEX_Gameplaytrailer_Multi_EN_ESRB_HD_Steam",
            source_type: "steam_movie",
            media_kind: "direct_video",
            licence_basis: "official_direct_media",
            approval_status: "approved_for_transformative_editorial_use",
          },
        ],
      },
    }),
  );

  assert.equal(result.result, "fail");
  assert.ok(result.failures.includes("direct_motion_subject_mismatch"));
  assert.deepEqual(result.evidence.required_specific_source_lock_tokens, ["yasmine"]);
  assert.match(result.evidence.mismatched_motion_assets[0].provenance_text, /alex/i);
});

test("attachPreflightQa blocks direct motion when cache sidecar source does not match the subject", async () => {
  const clipPath = path.join(
    "test",
    "output",
    "next-publish-candidates-sidecar-mismatch",
    "fresh_xbox_minecraft_dungeons_ii_20260610_v4_clip_1_segment_direct_motion_3.mp4",
  );
  await fs.ensureDir(path.dirname(clipPath));
  await fs.writeJson(`${clipPath}.json`, {
    schema_version: 1,
    render_signature: "studio_v4_clip_materializer_accurate_seek_v2",
    source_url: "https://blog.playstation.com/uploads/2026/06/f60a5d20687eba81e1dfcf15db93bd7dba411b24.mp4",
    source_family: "playstation_blog_wuchang_fallen_feathers_media",
    media_start_s: 8,
    duration_s: 5,
  });

  const stories = [
    baseStory({
      id: "minecraft_sidecar_wrong_motion",
      title: "Minecraft Dungeons II Has A Co-Op Risk",
      selected_title: "Minecraft Dungeons II Has A Co-Op Risk",
      canonical_subject: "Minecraft Dungeons II",
      canonical_game: "Minecraft Dungeons II",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/06/10/minecraft-dungeons-2-arpg-details-demo-xbox-games-showcase-2026/",
      scheduler_bridge_source: "goal_production_cutover",
      visual_v4_bridge_video_clips: [clipPath],
      video_clips: [clipPath],
      rights_ledger: {
        verdict: "pass",
        assets: [
          {
            id: "segment_direct_motion_3",
            path: clipPath,
            source_url:
              "local://existing-official-direct-motion/fresh_xbox_minecraft_dungeons_ii_20260610/fresh_xbox_minecraft_dungeons_ii_20260610_v4_clip_1_segment_direct_motion_3.mp4",
            source_family: "xbox_product_minecraft_dungeons_ii_media_02_6a5c6baf",
            source_type: "licensed_direct_media_url",
            media_kind: "direct_video",
            rights_basis: "official_direct_media",
          },
        ],
      },
      ...bridgeVisualEvidence("Minecraft Dungeons II"),
      sfx_manifest: bridgeSfxEvidence(),
    }),
  ];

  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-15T19:25:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runAggregateBenchmarkQa: async () => null,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "visual_entity_match:direct_motion_subject_mismatch",
    ),
  );
  assert.match(
    report.candidates[0].preflight_qa.checks.visual_entity_match.evidence
      .mismatched_motion_assets[0].provenance_text,
    /playstation|wuchang/i,
  );
});

test("attachPreflightQa blocks scheduler candidates rejected by aggregate Goal 10 readiness", async () => {
  const stories = [
    baseStory({
      id: "benchmark_blocked",
      title: "Star Wars Zero Company Is More Than XCOM",
      scheduler_bridge_source: "goal_production_cutover",
      ...bridgeVisualEvidence("Star Wars Zero Company"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "star-wars-zero-company-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-28T11:00:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    upstreamBenchmarkReport: {
      stories: [
        {
          story_id: "benchmark_blocked",
          status: "blocked",
          blockers: [
            "upstream:goal09_sound_design_engine_blocked",
            "benchmark:motion_density_below_reference",
          ],
        },
      ],
    },
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "aggregate_benchmark:upstream:goal09_sound_design_engine_blocked",
    ),
  );
  assert.equal(report.candidates[0].preflight_qa.checks.aggregate_benchmark.result, "fail");
});

test("aggregate benchmark preflight accepts current local benchmark when aggregate index is stale", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-benchmark-preflight-"));
  await fs.writeJson(path.join(tmp, "benchmark_report.json"), {
    result: "pass",
    failures: [],
    scores: {
      media_house_polish_score: 96,
      motion_density_score: 91,
    },
  });

  const result = await aggregateBenchmarkPreflightForStory(
    {
      id: "local_benchmark_ready",
      title: "Alien Isolation 2 Has One Horror Risk",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
    },
    {
      upstreamBenchmarkReport: {
        goal: "goal10_gold_standard_forensics_engine",
        stories: [],
      },
    },
  );

  assert.equal(result.result, "pass");
  assert.deepEqual(result.failures, []);
  assert.ok(result.warnings.includes("goal10_aggregate_index_stale_local_benchmark_used"));
});

test("attachPreflightQa blocks bridge candidates with rewrite-required script scorecards", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-script-scorecard-preflight-"));
  await fs.writeJson(path.join(tmp, "script_scorecard.json"), {
    verdict: "rewrite_required",
    viral_score: 55,
    blockers: ["duplicated_cta"],
    scores: {
      hook_strength: 82,
      curiosity_gap: 35,
      insight_density: 30,
      source_safety: 68,
      retention_pacing: 59,
    },
  });
  const stories = [
    baseStory({
      id: "weak_script_bridge",
      title: "Forza Horizon 6 Reviews Are In",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      ...bridgeVisualEvidence("Forza Horizon 6"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "forza-review-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-28T11:15:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    upstreamBenchmarkReport: {
      stories: [{ story_id: "weak_script_bridge", status: "ready", blockers: [] }],
    },
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "script_scorecard:script_score_below_threshold",
    ),
  );
  assert.equal(report.candidates[0].preflight_qa.checks.script_scorecard.result, "fail");
});

test("attachPreflightQa blocks bridge candidates when script scorecard still needs tightening", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-script-tighten-preflight-"));
  await fs.writeJson(path.join(tmp, "script_scorecard.json"), {
    verdict: "tighten_before_tts",
    viral_score: 84,
    blockers: [],
    warnings: [],
    scores: {
      hook_strength: 78,
      curiosity_gap: 72,
      insight_density: 76,
      source_safety: 92,
      retention_pacing: 80,
    },
  });
  const stories = [
    baseStory({
      id: "tighten_script_bridge",
      title: "Hades II Just Broke PlayStation's Silence",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      ...bridgeVisualEvidence("Hades II"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "hades-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-31T04:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    upstreamBenchmarkReport: {
      stories: [{ story_id: "tighten_script_bridge", status: "ready", blockers: [] }],
    },
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "script_scorecard:script_verdict_tighten_before_tts",
    ),
  );
  assert.equal(report.candidates[0].preflight_qa.checks.script_scorecard.result, "fail");
});

test("attachPreflightQa blocks final bridge candidates with no curiosity marker", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-script-curiosity-preflight-"));
  await fs.writeJson(path.join(tmp, "script_scorecard.json"), {
    verdict: "approved",
    viral_score: 84,
    blockers: [],
    warnings: ["no_curiosity_marker"],
    scores: {
      hook_strength: 82,
      curiosity_gap: 48,
      insight_density: 76,
      source_safety: 92,
      retention_pacing: 81,
    },
  });
  const stories = [
    baseStory({
      id: "flat_script_bridge",
      title: "Forza Horizon 6 Reviews Are In",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      ...bridgeVisualEvidence("Forza Horizon 6"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "forza-review-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-28T11:15:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    upstreamBenchmarkReport: {
      stories: [{ story_id: "flat_script_bridge", status: "ready", blockers: [] }],
    },
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "script_scorecard:no_curiosity_marker",
    ),
  );
  assert.equal(report.candidates[0].preflight_qa.checks.script_scorecard.result, "fail");
});

test("attachPreflightQa does not block viral-ready scripts with a stale no curiosity marker warning", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-script-curiosity-strong-preflight-"));
  await fs.writeJson(path.join(tmp, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 94,
    blockers: [],
    warnings: ["no_curiosity_marker"],
    scores: {
      hook_strength: 100,
      curiosity_gap: 100,
      insight_density: 100,
      source_safety: 86,
      retention_pacing: 82,
    },
  });
  const stories = [
    baseStory({
      id: "strong_script_bridge",
      title: "Black Ops 7's June 25 Update Has One Reinstall Catch",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      ...bridgeVisualEvidence("Call of Duty: Black Ops 7"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "black-ops-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-27T11:15:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    upstreamBenchmarkReport: {
      stories: [{ story_id: "strong_script_bridge", status: "ready", blockers: [] }],
    },
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  assert.ok(
    !report.candidates[0].preflight_qa.blockers.includes(
      "script_scorecard:no_curiosity_marker",
    ),
  );
  assert.equal(report.candidates[0].preflight_qa.checks.script_scorecard.result, "pass");
});

test("media-house preflight scores current artifact platform manifest over stale bridge copy", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-current-platform-manifest-preflight-"));
  await fs.writeJson(path.join(tmp, "platform_publish_manifest.json"), {
    publish_status: "GREEN",
    platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
    outputs: {
      youtube_shorts: {
        title: "Gears E-Day Has A 130GB Problem",
        description:
          "Gears of War: E-Day is asking players for 130 GB before the campaign even starts. That turns storage into part of the launch pitch. Source: PC Gamer.",
        cover_frame: { headline: "GEARS E-DAY 130GB TEST" },
      },
      instagram_reels: {
        caption:
          "Gears of War: E-Day is asking players for 130 GB before the campaign even starts. That turns storage into part of the launch pitch. Source: PC Gamer.",
        cover_frame: { headline: "GEARS E-DAY 130GB TEST" },
      },
    },
  });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "fresh_gears_eday_pc_specs_20260616",
      title: "Gears E-Day Has A 130GB Problem",
      selected_title: "Gears E-Day Has A 130GB Problem",
      canonical_subject: "Gears of War: E-Day",
      first_spoken_line: "Gears of War E-Day just turned PC specs into the story.",
      description: "Gears of War E-Day PC requirements list a 130 GB SSD install. Source: PC Gamer.",
      full_script:
        "Gears of War E-Day just turned PC specs into the story. PC Gamer says the requirements list a 130 GB SSD install. The catch is what players have to delete before launch night. Follow Pulse Gaming so you never miss a beat.",
      thumbnail_headline: "GEARS E-DAY 130GB TEST",
      suggested_thumbnail_text: "GEARS E-DAY 130GB TEST",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: {
            title: "Gears E-Day Has A 130GB Problem",
            description: "Gears of War E-Day PC requirements list a 130 GB SSD install. Source: PC Gamer.",
            cover_frame: { headline: "GEARS E-DAY 130GB TEST" },
          },
        },
      },
      script_scorecard: { verdict: "viral_ready", viral_score: 91, blockers: [] },
      audio_manifest: {
        voice_status: "materialized",
        word_timestamp_count: 120,
        mix_rules: { narration_priority: true },
      },
      visual_v4_director_plan: {
        shot_plan: [
          { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.2 },
          { id: "proof", kind: "motion_clip", startS: 0.25, durationS: 2.8 },
          { id: "source", kind: "source_lock", startS: 2.7, durationS: 1.4 },
        ],
        transition_plan: { planned: [{ family: "impact_cut" }, { family: "source_wipe" }], max_same_family_run: 1 },
        sound_transition_plan: {
          sfx: {
            cue_count: 7,
            max_same_family_run: 1,
            cues: [{ family: "impact", atS: 0 }, { family: "whoosh", atS: 0.35 }],
            mastering: { duck_under_narration: true, narration_priority: true },
          },
        },
      },
      sfx_manifest: bridgeSfxEvidence(),
      ...bridgeVisualEvidence("Gears of War: E-Day"),
      rights_ledger: [{ asset_id: "gears-current-platform-manifest" }],
    }),
    {
      mediaHouseQaEnabled: true,
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.checks.media_house.result, "pass");
  assert.equal(preflight.status, "pass");
});

test("runPreflightQaForStory blocks final renders with repeated visual-unit expansion", async () => {
  const clips = Array.from({ length: 6 }, (_, index) => ({
    id: `halo-motion-${index + 1}`,
    path: `motion/halo-motion-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/halo-campaign-evolved/source-${index + 1}.mp4`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: `halo_campaign_evolved_official_${index + 1}`,
    motion_family: `halo_campaign_evolved_official_${index + 1}`,
    materialized: true,
    counts_towards_motion_readiness: true,
  }));
  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "halo_looping_render",
      title: "Halo Campaign Evolved Shows A Trailer Problem",
      canonical_subject: "Halo: Campaign Evolved",
      selected_title: "Halo Campaign Evolved Shows A Trailer Problem",
      first_spoken_line: "Halo Campaign Evolved just made its trailer footage the story.",
      description: "Halo Campaign Evolved has a trailer-footage problem players can judge clearly. Source: Xbox.",
      full_script:
        "Halo Campaign Evolved just made its trailer footage the story. Xbox footage gives players a clear look at the remake pitch, but repeated clips can make the package feel thinner than the news deserves. Follow Pulse Gaming so you never miss a beat.",
      scheduler_bridge_source: "goal_production_cutover",
      exported_path: "D:/pulse-data/media/output/final/halo_looping_render.mp4",
      audio_path: "D:/pulse-data/media/output/audio/halo_looping_render.mp3",
      timestamps_path: "D:/pulse-data/media/output/timestamps/halo_looping_render.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/halo_looping_render.srt",
      render_manifest: {
        final_publish_render: true,
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
        rendered_duration_s: 42,
        clips: 30,
        visual_count: 6,
      },
      visual_v4_bridge_video_clips: clips,
      video_clips: clips,
      visual_v4_render_bridge_clip_count: clips.length,
      rights_ledger: clips.map((clip) => ({
        ...clip,
        asset_type: "direct_video_motion_clip",
        commercial_use_allowed: true,
        approval_status: "approved_for_transformative_editorial_use",
      })),
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      },
      platform_policy_report: {
        status: "pass",
        disclosure_requirements: { affiliate: false, commercial: false },
      },
      sfx_manifest: bridgeSfxEvidence(),
      ...bridgeVisualEvidence("Halo: Campaign Evolved"),
    }),
    {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("incident_guard:visual_evidence:final_render_reuses_visual_units"),
    JSON.stringify(preflight.blockers),
  );
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.final_render_clip_count,
    30,
  );
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.final_render_unique_visual_unit_count,
    6,
  );
});

test("runPreflightQaForStory prefers current package render manifest over stale embedded clip counts", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-current-render-manifest-"));
  t.after(() => fs.remove(tmpDir));
  const clips = Array.from({ length: 6 }, (_, index) => ({
    id: `street-fighter-motion-${index + 1}`,
    path: `motion/street-fighter-motion-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/street-fighter-6/yasmine-${index + 1}.mp4`,
    source_type: "official_platform_product_page",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: `street_fighter_6_yasmine_official_${index + 1}`,
    motion_family: `street_fighter_6_yasmine_official_${index + 1}`,
    materialized: true,
    counts_towards_motion_readiness: true,
  }));
  const renderManifestPath = path.join(tmpDir, "render_manifest.json");
  await fs.writeJson(renderManifestPath, {
    final_publish_render: true,
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    rendered_duration_s: 42,
    output_path: "D:/pulse-data/media/output/final/street_fighter_fixed.mp4",
    clips: 6,
    visual_count: 6,
  });
  await fs.writeJson(path.join(tmpDir, "visual_v4_render_story.json"), {
    video_clips: clips,
    visual_v4_bridge_video_clips: clips,
  });
  await fs.writeJson(path.join(tmpDir, "director_beat_map.json"), {
    shot_plan: [
      { id: "source_lock", kind: "source_lock", startS: 2.75, durationS: 12 },
      { id: "proof_card", kind: "proof_card", startS: 15, durationS: 12 },
    ],
  });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "street_fighter_current_manifest",
      title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      canonical_subject: "Street Fighter 6",
      selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      first_spoken_line: "Street Fighter 6 just made Yasmine look like a ranked-mode problem.",
      description: "Street Fighter 6 shows Yasmine pressure players can judge clearly. Source: Capcom.",
      full_script:
        "Street Fighter 6 just made Yasmine look like a ranked-mode problem. Capcom footage shows her pressure, spacing and player-impact clearly. Follow Pulse Gaming so you never miss a beat.",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmpDir,
      render_manifest_path: renderManifestPath,
      exported_path: "D:/pulse-data/media/output/final/street_fighter_fixed.mp4",
      duration_seconds: 42,
      audio_path: "D:/pulse-data/media/output/audio/street_fighter_fixed.mp3",
      timestamps_path: "D:/pulse-data/media/output/timestamps/street_fighter_fixed.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/street_fighter_fixed.srt",
      render_manifest: {
        final_publish_render: true,
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
        rendered_duration_s: 42,
        clips: 30,
        visual_count: 6,
      },
      director_beat_map: {
        shot_plan: [
          { id: "stale_source_lock", kind: "source_lock", startS: 2.75, durationS: 2.2 },
          { id: "stale_proof_card", kind: "proof_card", startS: 4.45, durationS: 2.35 },
        ],
      },
      visual_v4_bridge_video_clips: clips,
      video_clips: clips,
      visual_v4_render_bridge_clip_count: clips.length,
      rights_ledger: clips.map((clip) => ({
        ...clip,
        asset_type: "direct_video_motion_clip",
        commercial_use_allowed: true,
        approval_status: "approved_for_transformative_editorial_use",
      })),
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      },
      platform_policy_report: {
        status: "pass",
        disclosure_requirements: { affiliate: false, commercial: false },
      },
      sfx_manifest: bridgeSfxEvidence(),
      ...bridgeVisualEvidence("Street Fighter 6"),
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "pass", JSON.stringify(preflight.blockers));
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.final_render_clip_count,
    6,
  );
  assert.ok(
    !preflight.blockers.includes("incident_guard:visual_evidence:final_render_reuses_visual_units"),
    JSON.stringify(preflight.blockers),
  );
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.hyperframes_too_fast_card_shots.length,
    0,
  );
});

test("runPreflightQaForStory scores direct-motion overuse from final render clips before stale raw inventory", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-final-render-motion-overuse-"));
  t.after(() => fs.remove(tmpDir));
  const cleanRenderClips = [
    ["a", "steamstatic:/store_trailers/1/a/hash/video_window_36_5"],
    ["b", "steamstatic:/store_trailers/1/b/hash/video_window_36_5"],
    ["c", "steamstatic:/store_trailers/1/c/hash/video_window_36_5"],
    ["d", "steamstatic:/store_trailers/1/d/hash/video_window_36_5"],
    ["e", "steamstatic:/store_trailers/1/e/hash/video_window_36_5"],
    ["f", "steamstatic:/store_trailers/1/f/hash/video_window_36_5"],
  ].map(([key, family]) => ({
    id: `tokon-${key}`,
    path: path.join(tmpDir, `tokon-${key}.mp4`),
    source_url: `https://video.akamai.steamstatic.com/store_trailers/1/${key}/hash/video/hls_264_master.m3u8?t=1`,
    source_type: "steam_movie",
    source_kind: "video_file",
    media_kind: "direct_video",
    source_url_kind: "hls_manifest",
    source_family: family,
    motion_family: family,
    durationS: 5,
  }));
  const staleRawClips = [
    ...cleanRenderClips,
    {
      ...cleanRenderClips[1],
      id: "tokon-b-repeat",
      path: path.join(tmpDir, "tokon-b-repeat.mp4"),
      source_family: "steamstatic:/store_trailers/1/b/hash/video_window_42_5",
      motion_family: "steamstatic:/store_trailers/1/b/hash/video_window_42_5",
    },
    {
      ...cleanRenderClips[2],
      id: "tokon-c-repeat",
      path: path.join(tmpDir, "tokon-c-repeat.mp4"),
      source_family: "steamstatic:/store_trailers/1/c/hash/video_window_42_5",
      motion_family: "steamstatic:/store_trailers/1/c/hash/video_window_42_5",
    },
  ];
  await Promise.all(staleRawClips.map((clip, index) => fs.outputFile(clip.path, Buffer.alloc(2048, 40 + index))));
  await fs.writeJson(path.join(tmpDir, "visual_v4_render_story.json"), {
    video_clips: cleanRenderClips,
    visual_v4_bridge_video_clips: cleanRenderClips,
  });
  await fs.writeJson(path.join(tmpDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: staleRawClips,
  });
  await fs.writeJson(path.join(tmpDir, "director_beat_map.json"), {
    shot_plan: [
      { id: "source_lock", kind: "source_lock", startS: 2.75, durationS: 12 },
      { id: "proof_card", kind: "proof_card", startS: 15, durationS: 12 },
    ],
  });
  await fs.writeJson(path.join(tmpDir, "render_manifest.json"), {
    final_publish_render: true,
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    rendered_duration_s: 35,
    output_path: "D:/pulse-data/media/output/final/tokon_unique.mp4",
    clip_scene_plan: {
      repeat_free: true,
      repeated_base_sources: [],
      scenes: cleanRenderClips.map((clip, index) => ({
        id: `scene_${index + 1}`,
        path: clip.path,
        source_family: clip.source_family,
        durationS: 5,
      })),
    },
  });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "tokon_final_render_motion",
      title: "MARVEL Tokon Finally Shows Real Gameplay",
      canonical_subject: "MARVEL Tokon",
      selected_title: "MARVEL Tokon Finally Shows Real Gameplay",
      primary_source: "GameSpot",
      primary_source_url: "https://www.gamespot.com/videos/marvel-tokon-fighting-souls-magneto-and-black-panther-gameplay/",
      first_spoken_line: "MARVEL Tokon finally shows real gameplay.",
      description: "MARVEL Tokon finally shows real gameplay. Source: GameSpot.",
      full_script:
        "MARVEL Tokon finally shows real gameplay. GameSpot shows Magneto and Black Panther in readable two on two fights. Follow Pulse Gaming so you never miss a beat.",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmpDir,
      render_manifest_path: path.join(tmpDir, "render_manifest.json"),
      exported_path: "D:/pulse-data/media/output/final/tokon_unique.mp4",
      duration_seconds: 35,
      audio_path: "D:/pulse-data/media/output/audio/tokon_unique.mp3",
      timestamps_path: "D:/pulse-data/media/output/timestamps/tokon_unique.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/tokon_unique.srt",
      render_manifest: {
        final_publish_render: true,
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
        rendered_duration_s: 35,
      },
      visual_v4_bridge_video_clips: cleanRenderClips,
      video_clips: cleanRenderClips,
      visual_v4_render_bridge_clip_count: cleanRenderClips.length,
      rights_ledger: cleanRenderClips.map((clip) => ({
        ...clip,
        asset_type: "direct_video_motion_clip",
        commercial_use_allowed: true,
        approval_status: "approved_for_transformative_editorial_use",
      })),
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
      },
      platform_policy_report: {
        status: "pass",
        disclosure_requirements: { affiliate: false, commercial: false },
      },
      sfx_manifest: bridgeSfxEvidence(),
      ...bridgeVisualEvidence("MARVEL Tokon"),
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "pass", JSON.stringify(preflight.blockers));
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.direct_motion_base_source_overuse.length,
    0,
  );
  assert.ok(
    !preflight.blockers.includes("incident_guard:visual_evidence:direct_motion_base_source_overused"),
    JSON.stringify(preflight.blockers),
  );
});

test("attachPreflightQa blocks local-clone narration when word timestamps are not ASR aligned", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-timestamp-preflight-"));
  const timestampsPath = path.join(tmp, "local_silence_timestamps.json");
  await fs.writeJson(timestampsPath, {
    words: [
      { word: "Hades", start: 0, end: 0.28 },
      { word: "two", start: 0.28, end: 0.52 },
      { word: "changed", start: 0.52, end: 0.88 },
    ],
    meta: {
      transcript: "Hades two changed its launch plan.",
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });

  const stories = [
    baseStory({
      id: "local_timestamp_drift",
      title: "Hades II Changed Its Launch Plan",
      selected_title: "Hades II Changed Its Launch Plan",
      canonical_subject: "Hades II",
      first_spoken_line: "Hades II changed its launch plan for players.",
      full_script: "Hades II changed its launch plan for players. The important part is what changes at launch.",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      exported_path: "D:/pulse-data/media/output/final/local_timestamp_drift.mp4",
      audio_path: "D:/pulse-data/media/output/audio/local_timestamp_drift.mp3",
      timestamps_path: timestampsPath,
      manual_caption_path: "D:/pulse-data/media/output/captions/local_timestamp_drift.srt",
      audio_manifest: {
        voice_provider: "local_tts",
      },
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Hades II Changed Its Launch Plan" },
        },
      },
      ...bridgeVisualEvidence("Hades II"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "local-timestamp-drift-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-26T10:10:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "timestamp_alignment:word_timestamps_not_asr_aligned",
    ),
  );
  assert.equal(report.candidates[0].preflight_qa.checks.timestamp_alignment.result, "fail");
});

test("attachPreflightQa blocks ASR-labelled local timestamps with unusable word timing", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-timestamp-gap-preflight-"));
  const timestampsPath = path.join(tmp, "local_whisper_gap_timestamps.json");
  await fs.writeJson(timestampsPath, {
    words: [
      { word: "Hades", start: 0, end: 0.26 },
      { word: "number", start: 0.27, end: 0.52 },
      { word: "two", start: 0.53, end: 0.72 },
      { word: "changed", start: 14.4, end: 14.78 },
      { word: "launch", start: 14.8, end: 15.12 },
    ],
    meta: {
      transcript: "Hades number two changed launch.",
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true },
    },
  });

  const stories = [
    baseStory({
      id: "local_timestamp_gap",
      title: "Forza Horizon 6 Reviews Are In",
      selected_title: "Forza Horizon 6 Reviews Are In",
      canonical_subject: "Forza Horizon 6",
      first_spoken_line: "Forza Horizon 6 reviews are finally in.",
      full_script: "Forza Horizon 6 reviews are finally in. The player-facing question is whether the PC score changes what Xbox players expect next.",
      duration_seconds: 46,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      exported_path: "D:/pulse-data/media/output/final/local_timestamp_gap.mp4",
      audio_path: "D:/pulse-data/media/output/audio/local_timestamp_gap.mp3",
      timestamps_path: timestampsPath,
      manual_caption_path: "D:/pulse-data/media/output/captions/local_timestamp_gap.srt",
      audio_manifest: {
        voice_provider: "local_tts",
      },
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Forza Horizon 6 Reviews Are In" },
        },
      },
      ...bridgeVisualEvidence("Forza Horizon 6"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "local-timestamp-gap-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-28T23:30:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  const check = report.candidates[0].preflight_qa.checks.timestamp_alignment;
  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.equal(check.result, "fail");
  assert.ok(
    report.candidates[0].preflight_qa.blockers.includes(
      "timestamp_alignment:word_timestamps_timing_unusable:max_gap_too_large",
    ),
  );
  assert.equal(check.evidence.word_timestamp_source, "local_whisper_word_alignment");
  assert.equal(check.evidence.word_timestamp_timing_reason, "max_gap_too_large");
});

test("attachPreflightQa ignores stale segment acoustic duration when timestamp materializer marked it ignored", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-timestamp-stale-duration-"));
  const timestampsPath = path.join(tmp, "local_whisper_stale_duration_timestamps.json");
  const words = Array.from({ length: 42 }, (_, index) => ({
    word: `word${index + 1}`,
    start: Number((index * 1.02).toFixed(2)),
    end: Number((index * 1.02 + 0.34).toFixed(2)),
  }));
  words[words.length - 1].end = 43.14;
  await fs.writeJson(timestampsPath, {
    words,
    meta: {
      transcript: words.map((word) => word.word).join(" "),
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true },
      acoustic: { durationSeconds: 14.08 },
      timestampDurationMetadataIgnored: {
        reason: "metadata_duration_shorter_than_word_timeline",
        metadata_duration_s: 14.08,
        last_word_end_s: 43.14,
      },
    },
  });

  const stories = [
    baseStory({
      id: "local_stale_segment_duration",
      title: "Hades II Changed Its Launch Plan",
      selected_title: "Hades II Changed Its Launch Plan",
      canonical_subject: "Hades II",
      full_script: words.map((word) => word.word).join(" "),
      duration_seconds: 43.21,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      timestamps_path: timestampsPath,
      audio_manifest: {
        voice_provider: "local_tts",
      },
      publish_verdict: { verdict: "GREEN" },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        outputs: {
          youtube_shorts: { title: "Hades II Changed Its Launch Plan" },
        },
      },
      ...bridgeVisualEvidence("Hades II"),
      sfx_manifest: bridgeSfxEvidence(),
      rights_ledger: [{ asset_id: "local-stale-duration-render" }],
      video_clips: [
        { path: "clip-a.mp4", source_family: "official_trailer_a" },
        { path: "clip-b.mp4", source_family: "official_trailer_b" },
        { path: "clip-c.mp4", source_family: "official_trailer_c" },
      ],
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-05-29T00:10:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
  });

  const check = report.candidates[0].preflight_qa.checks.timestamp_alignment;
  assert.equal(report.candidates[0].preflight_qa.status, "pass");
  assert.equal(check.result, "pass");
  assert.equal(check.evidence.word_timestamp_timing_reason, "usable");
  assert.equal(check.evidence.word_timestamp_source, "local_whisper_word_alignment");
});

test("attachPreflightQa prefers MEDIA_ROOT ASR timestamps over stale repo fallback timestamps", async () => {
  const previousMediaRoot = process.env.MEDIA_ROOT;
  const mediaRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-root-timestamps-"));
  process.env.MEDIA_ROOT = mediaRoot;

  const relativeTimestampsPath = path.join(
    "test",
    "output",
    "timestamp-preflight",
    "media-root-precedence_timestamps.json",
  );
  const repoFallbackPath = path.resolve(relativeTimestampsPath);
  const mediaRootPath = path.join(mediaRoot, relativeTimestampsPath);

  await fs.ensureDir(path.dirname(repoFallbackPath));
  await fs.writeJson(repoFallbackPath, {
    words: [{ word: "Xbox", start: 0, end: 0.3 }],
    meta: {
      transcript: "Xbox opened a public feedback channel.",
      wordTimestampSource: "local_audio_silence_anchored",
    },
  });

  await fs.ensureDir(path.dirname(mediaRootPath));
  await fs.writeJson(mediaRootPath, {
    words: [
      { word: "Xbox", start: 0, end: 0.28 },
      { word: "opened", start: 0.28, end: 0.6 },
      { word: "feedback", start: 0.6, end: 1.0 },
    ],
    meta: {
      transcript: "Xbox opened a public feedback channel.",
      wordTimestampSource: "local_whisper_word_alignment",
      timestampWhisperAlignment: { repaired: true },
      acoustic: { durationSeconds: 1.1 },
    },
  });

  try {
    const stories = [
      baseStory({
        id: "media_root_precedence",
        title: "Xbox Feedback Just Became A Promise Test",
        selected_title: "Xbox Feedback Just Became A Promise Test",
        canonical_subject: "Xbox",
        first_spoken_line: "Xbox opened a public feedback channel.",
        full_script: "Xbox opened a public feedback channel. Players are treating it like a promise test.",
        scheduler_bridge_source: "goal_production_cutover",
        render_lane: "visual_v4_production",
        render_quality_class: "premium",
        exported_path: "D:/pulse-data/media/output/final/media_root_precedence.mp4",
        audio_path: "output/audio/media_root_precedence.mp3",
        timestamps_path: relativeTimestampsPath,
        manual_caption_path: "output/captions/media_root_precedence.srt",
        audio_manifest: {
          voice_provider: "local_tts",
          word_timestamps_path: relativeTimestampsPath,
        },
        publish_verdict: { verdict: "GREEN" },
        platform_publish_manifest: {
          publish_status: "GREEN",
          platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
          outputs: {
            youtube_shorts: { title: "Xbox Feedback Just Became A Promise Test" },
          },
        },
        ...bridgeVisualEvidence("Xbox"),
        sfx_manifest: bridgeSfxEvidence(),
        rights_ledger: [{ asset_id: "media-root-precedence-render" }],
        video_clips: [
          { path: "clip-a.mp4", source_family: "official_trailer_a" },
          { path: "clip-b.mp4", source_family: "official_trailer_b" },
          { path: "clip-c.mp4", source_family: "official_trailer_c" },
        ],
      }),
    ];

    const report = buildNextPublishCandidatesReport(stories, {
      analyticsText,
      generatedAt: "2026-05-27T10:35:00.000Z",
    });

    await attachPreflightQa(report, stories, {
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    });

    assert.equal(report.candidates[0].preflight_qa.status, "pass");
    assert.equal(report.candidates[0].preflight_qa.checks.timestamp_alignment.result, "pass");
    assert.equal(
      report.candidates[0].preflight_qa.checks.timestamp_alignment.evidence.word_timestamp_source,
      "local_whisper_word_alignment",
    );
  } finally {
    if (previousMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = previousMediaRoot;
    await fs.remove(repoFallbackPath);
    await fs.remove(mediaRoot);
  }
});

test("attachPreflightQa trusts a current full GREEN proof package over stale preflight blockers", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-proof-"));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "current-green-package", videoPath);

  const stories = [
    baseStory({
      id: "current-green-package",
      title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      canonical_subject: "Street Fighter 6",
      source_type: "rss",
      timestamp: "2026-06-23T09:30:00.000Z",
      source_manifest: {
        primary_source: {
          name: "GameSpot",
          url: "https://www.gamespot.com/videos/street-fighter-6-yasmine-character-gameplay-reveal-trailer/",
          published_at: "2026-06-23T09:30:00.000Z",
        },
        source_age_policy_hours: 168,
      },
      duration_seconds: 37.1,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      visual_v4_bridge_video_clips: [
        {
          id: "halo-direct-1",
          path: "output/video_cache/halo-direct-1.mp4",
          source_url: "https://video.example.test/halo/campaign-evolved-trailer.mp4",
          media_kind: "direct_video",
          mediaStartS: 12,
          durationS: 5,
        },
        {
          id: "halo-direct-2",
          path: "output/video_cache/halo-direct-2.mp4",
          source_url: "https://video.example.test/halo/campaign-evolved-trailer.mp4",
          media_kind: "direct_video",
          mediaStartS: 24,
          durationS: 5,
        },
      ],
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "Street Fighter 6 Just Revealed A Rushdown Problem" },
          instagram_reels: { caption: "Street Fighter 6 just made Yasmine look like a ranked-mode problem." },
          facebook_reels: { page_caption: "Street Fighter 6 just made Yasmine look like a ranked-mode problem." },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-23T22:30:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    env: {
      TIKTOK_ENABLED: "false",
      TIKTOK_AUTO_UPLOAD_ENABLED: "false",
    },
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({
      result: "fail",
      failures: ["subtitle_timing_unusable:too_few_words", "public_output:manual_captions_missing"],
      warnings: [],
    }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({
      result: "fail",
      failures: ["captions:missing_or_messy"],
      warnings: [],
    }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({
      result: "fail",
      failures: ["incident:distinct_motion_families_missing"],
      warnings: [],
    }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVisualEntityQa: async () => ({
      result: "fail",
      failures: ["direct_motion_subject_mismatch"],
      warnings: [],
    }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "publish_ready");
  assert.equal(candidate.preflight_qa.status, "pass");
  assert.equal(candidate.current_proof_package.status, "green");
  assert.ok(candidate.reasons.includes("current_green_proof_package"));
  assert.ok(!candidate.reasons.includes("preflight_qa_blocked"));
  assert.deepEqual(candidate.current_proof_package.superseded_preflight_blockers, [
    "content:subtitle_timing_unusable:too_few_words",
    "content:public_output:manual_captions_missing",
    "governance:captions:missing_or_messy",
    "incident_guard:incident:distinct_motion_families_missing",
    "visual_entity_match:direct_motion_subject_mismatch",
  ]);
  assert.equal(report.preflight_qa.blocked, 0);
  assert.equal(report.preflight_qa.pass, 1);
});

test("attachPreflightQa does not supersede voice cadence blockers with current proof packages", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-proof-voice-"));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "current-green-voice-fail", videoPath);

  const stories = [
    baseStory({
      id: "current-green-voice-fail",
      title: "GTA VI Starts The Preorder Fight",
      selected_title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      source_type: "rss",
      timestamp: "2026-06-26T09:30:00.000Z",
      source_manifest: {
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/25/grand-theft-auto-vi-preorder/",
          published_at: "2026-06-26T09:30:00.000Z",
        },
        source_age_policy_hours: 168,
      },
      duration_seconds: 44.1,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "GTA VI Starts The Preorder Fight" },
          instagram_reels: { caption: "GTA VI now has one real preorder catch." },
          facebook_reels: { page_caption: "GTA VI now has one real preorder catch." },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-26T22:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    env: {
      TIKTOK_ENABLED: "false",
      TIKTOK_AUTO_UPLOAD_ENABLED: "false",
    },
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVoiceQualityQa: async () => ({
      result: "fail",
      failures: ["voice_cadence:wpm_too_fast"],
      warnings: [],
    }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(candidate.reasons.includes("preflight_qa_blocked"));
  assert.ok(!candidate.reasons.includes("current_green_proof_package"));
  assert.ok(
    candidate.preflight_qa.blockers.includes("voice_quality:voice_cadence:wpm_too_fast"),
  );
  assert.equal(report.preflight_qa.blocked, 1);
  assert.equal(report.preflight_qa.pass, 0);
});

test("attachPreflightQa does not supersede risky GTA VI TTS script blockers with current proof packages", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-proof-gta-tts-"));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "current-green-gta-tts-fail", videoPath);

  const stories = [
    baseStory({
      id: "current-green-gta-tts-fail",
      title: "GTA VI Starts The Preorder Fight",
      selected_title: "GTA VI Starts The Preorder Fight",
      canonical_subject: "Grand Theft Auto VI",
      source_type: "rss",
      timestamp: "2026-06-26T09:30:00.000Z",
      source_manifest: {
        primary_source: {
          name: "Rockstar Games",
          url: "https://www.rockstargames.com/VI",
          published_at: "2026-06-26T09:30:00.000Z",
        },
        source_age_policy_hours: 168,
      },
      full_script:
        "Grand Theft Auto VI now has one real preorder catch. Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Grand Theft Auto V I now has one real preorder catch. Follow Pulse Gaming so you never miss a beat.",
      duration_seconds: 44.1,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "GTA VI Starts The Preorder Fight" },
          instagram_reels: { caption: "GTA VI now has one real preorder catch." },
          facebook_reels: { page_caption: "GTA VI now has one real preorder catch." },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-26T22:45:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    env: {
      TIKTOK_ENABLED: "false",
      TIKTOK_AUTO_UPLOAD_ENABLED: "false",
    },
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({
      result: "fail",
      failures: ["risky_gta_vi_tts_script:tts_script"],
      warnings: [],
    }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(candidate.reasons.includes("preflight_qa_blocked"));
  assert.ok(!candidate.reasons.includes("current_green_proof_package"));
  assert.ok(
    candidate.preflight_qa.blockers.includes("content:risky_gta_vi_tts_script:tts_script"),
  );
  assert.equal(report.preflight_qa.blocked, 1);
  assert.equal(report.preflight_qa.pass, 0);
});

test("attachPreflightQa does not supersede missing HyperFrames dwell evidence", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-hf-missing-dwell-"));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "hf-missing-dwell-package", videoPath);
  const renderManifestPath = path.join(tmp, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  await fs.writeJson(renderManifestPath, {
    ...renderManifest,
    rendered_duration_s: 52,
    clips: 8,
    hyperframes_premium_shell_required: true,
    hyperframes_card_count: 2,
    overlay_card_windows: [],
  }, { spaces: 2 });
  const directClips = Array.from({ length: 6 }, (_, index) => ({
    id: `gta-direct-${index + 1}`,
    path: `motion/gta-direct-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/gta-vi/direct-${index + 1}.mp4`,
    source_family: `gta_vi_official_source_${index + 1}`,
    motion_family: `gta_vi_official_source_${index + 1}`,
    media_kind: "direct_video",
  }));
  const cardClips = [
    {
      id: "gta-proof-card",
      path: "hyperframes/gta-proof-card.mp4",
      source_type: "hyperframes_card",
      media_kind: "hyperframes_card",
      source_family: "gta_vi_proof_card",
      text: "PRICE STILL UNCONFIRMED",
    },
    {
      id: "gta-context-card",
      path: "hyperframes/gta-context-card.mp4",
      source_type: "hyperframes_card",
      media_kind: "hyperframes_card",
      source_family: "gta_vi_context_card",
      text: "PREORDERS NEED PLATFORM DETAIL",
    },
  ];
  await fs.writeJson(path.join(tmp, "visual_v4_render_story.json"), {
    id: "hf-missing-dwell-package",
    video_clips: [...directClips, ...cardClips],
    visual_v4_bridge_video_clips: directClips,
  }, { spaces: 2 });

  const stories = [
    baseStory({
      id: "hf-missing-dwell-package",
      title: "GTA VI Cover Art Made The Price Debate Louder",
      selected_title: "GTA VI Cover Art Made The Price Debate Louder",
      canonical_subject: "GTA VI",
      source_type: "rss",
      timestamp: "2026-06-24T19:30:00.000Z",
      source_manifest: {
        primary_source: {
          name: "Rockstar Games",
          url: "https://www.rockstargames.com/VI",
          published_at: "2026-06-24T19:30:00.000Z",
        },
        source_age_policy_hours: 168,
      },
      duration_seconds: 52,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "GTA VI Cover Art Made The Price Debate Louder" },
          instagram_reels: { caption: "GTA VI cover art just made the preorder debate louder." },
          facebook_reels: { page_caption: "GTA VI cover art just made the preorder debate louder." },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-24T21:55:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    env: {
      TIKTOK_ENABLED: "false",
      TIKTOK_AUTO_UPLOAD_ENABLED: "false",
    },
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({
      result: "fail",
      failures: ["visual_evidence:card_visible_dwell_missing"],
      warnings: [],
    }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(candidate.reasons.includes("preflight_qa_blocked"));
  assert.ok(!candidate.reasons.includes("current_green_proof_package"));
  assert.ok(
    candidate.preflight_qa.blockers.includes(
      "incident_guard:visual_evidence:card_visible_dwell_missing",
    ),
  );
  assert.equal(report.preflight_qa.blocked, 1);
});

test("attachPreflightQa does not supersede repeated HyperFrames card families", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-hf-repeat-family-"));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "hf-repeated-family-package", videoPath);

  const stories = [
    baseStory({
      id: "hf-repeated-family-package",
      title: "GTA VI Cover Art Made The Price Debate Louder",
      selected_title: "GTA VI Cover Art Made The Price Debate Louder",
      canonical_subject: "GTA VI",
      source_type: "rss",
      timestamp: "2026-06-24T19:30:00.000Z",
      source_manifest: {
        primary_source: {
          name: "Rockstar Games",
          url: "https://www.rockstargames.com/VI",
          published_at: "2026-06-24T19:30:00.000Z",
        },
        source_age_policy_hours: 168,
      },
      duration_seconds: 48,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      auto_approved: true,
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "GTA VI Cover Art Made The Price Debate Louder" },
          instagram_reels: { caption: "GTA VI cover art just made the preorder debate louder." },
          facebook_reels: { page_caption: "GTA VI cover art just made the preorder debate louder." },
        },
      },
    }),
  ];
  const report = buildNextPublishCandidatesReport(stories, {
    analyticsText,
    generatedAt: "2026-06-24T21:58:00.000Z",
  });

  await attachPreflightQa(report, stories, {
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({
      result: "fail",
      failures: ["hyperframes:repeated_card_family"],
      warnings: [],
    }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  const candidate = report.candidates[0];
  assert.equal(candidate.status, "review");
  assert.equal(candidate.preflight_qa.status, "blocked");
  assert.ok(candidate.reasons.includes("preflight_qa_blocked"));
  assert.ok(!candidate.reasons.includes("current_green_proof_package"));
  assert.ok(
    candidate.preflight_qa.blockers.includes("incident_guard:hyperframes:repeated_card_family"),
    JSON.stringify(candidate.preflight_qa.blockers),
  );
});

test("runPreflightQaForStory blocks current packages with non-repeat-free clip scene plans", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-scene-plan-repeat-"));
  t.after(() => fs.remove(tmp));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "clip-scene-repeat-package", videoPath);
  const renderManifestPath = path.join(tmp, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  await fs.writeJson(renderManifestPath, {
    ...renderManifest,
    final_publish_render: true,
    rendered_duration_s: 44,
    clips: 12,
    clip_scene_plan: {
      repeat_free: false,
      blockers: ["direct_motion_base_source_repeated"],
      repeated_base_sources: [{ key: "steamstatic:/halo/trailer", count: 4 }],
      scenes: Array.from({ length: 12 }, (_, index) => ({
        path: `clip-${(index % 3) + 1}.mp4`,
        duration_s: 3.6,
      })),
    },
  }, { spaces: 2 });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "clip-scene-repeat-package",
      title: "Halo Campaign Evolved Keeps Reusing The Same Footage",
      selected_title: "Halo Campaign Evolved Keeps Reusing The Same Footage",
      canonical_subject: "Halo: Campaign Evolved",
      source_type: "rss",
      timestamp: "2026-06-24T18:00:00.000Z",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "Halo Campaign Evolved Keeps Reusing The Same Footage" },
        },
      },
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("incident_guard:visual_evidence:clip_scene_plan_not_repeat_free"),
    JSON.stringify(preflight.blockers),
  );
  assert.ok(
    preflight.blockers.includes("incident_guard:visual_evidence:direct_motion_base_source_repeated"),
    JSON.stringify(preflight.blockers),
  );
});

test("runPreflightQaForStory blocks source-concentrated direct-motion plans", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-source-concentration-"));
  t.after(() => fs.remove(tmp));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "source-concentrated-package", videoPath);
  const renderManifestPath = path.join(tmp, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  await fs.writeJson(renderManifestPath, {
    ...renderManifest,
    final_publish_render: true,
    rendered_duration_s: 44,
    clips: 8,
    clip_scene_plan: {
      repeat_free: true,
      blockers: [],
      repeated_base_sources: [],
      direct_motion_source_concentration_metrics: {
        direct_motion_scene_count: 7,
        max_scenes_per_source_root: 4,
        max_source_concentration_ratio: 0.55,
        concentrated_sources: [
          {
            key: "video.example.test/halo/campaign-evolved-trailer",
            count: 6,
            ratio: 0.857,
          },
        ],
      },
      scenes: Array.from({ length: 7 }, (_, index) => ({
        path: `halo-window-${index + 1}.mp4`,
        duration_s: 5,
        base_source_key: `halo_campaign_evolved_trailer_window_${index + 1}_5`,
        source_root_key: "video.example.test/halo/campaign-evolved-trailer",
      })),
    },
  }, { spaces: 2 });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "source-concentrated-package",
      title: "Halo Campaign Evolved Needs More Than One Trailer Loop",
      selected_title: "Halo Campaign Evolved Needs More Than One Trailer Loop",
      canonical_subject: "Halo: Campaign Evolved",
      source_type: "rss",
      timestamp: "2026-06-24T18:00:00.000Z",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "Halo Campaign Evolved Needs More Than One Trailer Loop" },
        },
      },
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("incident_guard:visual_evidence:direct_motion_source_concentration_above_premium_floor"),
    JSON.stringify(preflight.blockers),
  );
});

test("runPreflightQaForStory blocks stale bridge proof when the current V4 motion pack is blocked", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-current-motion-pack-blocked-"));
  t.after(() => fs.remove(tmp));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "current-motion-pack-blocked", videoPath);
  const motionPackPath = path.join(tmp, "current_motion_pack_manifest.json");
  await fs.writeJson(motionPackPath, {
    schema_version: 1,
    generated_at: "2026-06-28T12:45:00.000Z",
    story_id: "current-motion-pack-blocked",
    readiness: {
      status: "v4_motion_blocked",
      blockers: [
        "actual_motion_clip_minimum_not_met",
        "distinct_motion_source_assets_minimum_not_met",
      ],
    },
    clips: [],
    motion_budget: {
      required_motion_scenes: 5,
      required_distinct_families: 4,
    },
  }, { spaces: 2 });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "current-motion-pack-blocked",
      title: "Marvel Tokon Needs Real Gameplay Motion",
      selected_title: "Marvel Tokon Needs Real Gameplay Motion",
      canonical_subject: "MARVEL Tokon",
      source_type: "rss",
      timestamp: "2026-06-24T18:00:00.000Z",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      visual_v4_motion_pack_manifest_path: motionPackPath,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "Marvel Tokon Needs Real Gameplay Motion" },
        },
      },
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("current_motion_pack:v4_motion_pack_blocked"),
    JSON.stringify(preflight.blockers),
  );
  assert.ok(
    preflight.blockers.includes("current_motion_pack:motion_pack_actual_motion_clip_minimum_not_met"),
    JSON.stringify(preflight.blockers),
  );
  assert.equal(preflight.checks.current_motion_pack.evidence.clip_count, 0);
}
);

test("attachPreflightQa holds current motion-pack failures for repair instead of normal review", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-motion-pack-quarantine-"));
  t.after(() => fs.remove(tmp));
  const motionPackPath = path.join(tmp, "current_motion_pack_manifest.json");
  await fs.writeJson(motionPackPath, {
    readiness: {
      status: "v4_motion_blocked",
      blockers: ["actual_motion_clip_minimum_not_met"],
    },
    clips: [],
    motion_budget: {
      required_motion_scenes: 5,
      required_distinct_families: 4,
    },
  });
  const story = baseStory({
    id: "motion-pack-quarantine",
    title: "Marvel Tokon Needs Better Clips",
    selected_title: "Marvel Tokon Needs Better Clips",
    canonical_subject: "MARVEL Tokon",
    scheduler_bridge_source: "goal_production_cutover",
    visual_v4_motion_pack_manifest_path: motionPackPath,
  });
  const report = buildNextPublishCandidatesReport([story], {
    generatedAt: "2026-06-28T13:05:00.000Z",
  });

  await attachPreflightQa(report, [story], {
    runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runIncidentGuard: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
    runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
  });

  assert.equal(report.candidates[0].preflight_qa.status, "blocked");
  assert.equal(report.candidates[0].scheduler_quarantine.status, "held");
  assert.equal(report.candidates[0].scheduler_quarantine.reason, "current_motion_pack_blocked");
  assert.equal(report.preflight_qa.scheduler_quarantined, 1);
});

test("runPreflightQaForStory blocks repeated direct clips from final render story even when materialised clips are refreshed", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-final-render-repeat-"));
  t.after(() => fs.remove(tmp));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "final-render-repeat-package", videoPath);
  await fs.writeJson(path.join(tmp, "visual_v4_render_story.json"), {
    video_clips: [
      {
        id: "halo-direct-1",
        path: "output/video_cache/halo-direct-1.mp4",
        source_url: "https://video.example.test/halo/campaign-evolved-trailer.mp4",
        media_kind: "direct_video",
        source_family: "halo_campaign_evolved_trailer_window_unknown_a",
        duration_s: 5,
      },
      {
        id: "halo-direct-2",
        path: "output/video_cache/halo-direct-2.mp4",
        source_url: "https://video.example.test/halo/campaign-evolved-trailer.mp4",
        media_kind: "direct_video",
        source_family: "halo_campaign_evolved_trailer_window_unknown_b",
        duration_s: 5,
      },
      {
        id: "halo-direct-3",
        path: "output/video_cache/halo-direct-3.mp4",
        source_url: "https://video.example.test/halo/campaign-evolved-gameplay.mp4",
        media_kind: "direct_video",
        source_family: "halo_campaign_evolved_gameplay_window_unique",
        duration_s: 5,
      },
    ],
  });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "final-render-repeat-package",
      title: "Halo Campaign Evolved Keeps Reusing The Same Trailer",
      selected_title: "Halo Campaign Evolved Keeps Reusing The Same Trailer",
      canonical_subject: "Halo: Campaign Evolved",
      source_type: "rss",
      timestamp: "2026-06-24T18:00:00.000Z",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "Halo Campaign Evolved Keeps Reusing The Same Trailer" },
        },
      },
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "blocked");
  assert.ok(
    preflight.blockers.includes("incident_guard:visual_evidence:repeated_direct_motion_segment"),
    JSON.stringify(preflight.blockers),
  );
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.repeated_direct_motion_segment_count,
    1,
  );
});

test("runPreflightQaForStory trusts clean final scene-plan motion over stale embedded clip arrays", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-next-preflight-scene-plan-authority-"));
  t.after(() => fs.remove(tmp));
  const videoPath = path.join(tmp, "visual_v4_render.mp4");
  await writeCurrentGreenProofPackage(tmp, "scene-plan-authority-package", videoPath);
  const renderManifestPath = path.join(tmp, "render_manifest.json");
  const renderManifest = await fs.readJson(renderManifestPath);
  await fs.writeJson(path.join(tmp, "visual_v4_render_story.json"), {
    video_clips: [
      {
        id: "stale-tokon-direct-1",
        path: "output/video_cache/tokon-stale-1.mp4",
        source_url: "https://video.example.test/marvel-tokon/repeated-trailer.mp4",
        media_kind: "direct_video",
        source_family: "tokon_repeated_trailer_window_unknown_a",
        duration_s: 5,
      },
      {
        id: "stale-tokon-direct-2",
        path: "output/video_cache/tokon-stale-2.mp4",
        source_url: "https://video.example.test/marvel-tokon/repeated-trailer.mp4",
        media_kind: "direct_video",
        source_family: "tokon_repeated_trailer_window_unknown_b",
        duration_s: 5,
      },
      {
        id: "stale-tokon-direct-3",
        path: "output/video_cache/tokon-stale-3.mp4",
        source_url: "https://video.example.test/marvel-tokon/repeated-trailer.mp4",
        media_kind: "direct_video",
        source_family: "tokon_repeated_trailer_window_unknown_c",
        duration_s: 5,
      },
    ],
  }, { spaces: 2 });
  await fs.writeJson(renderManifestPath, {
    ...renderManifest,
    final_publish_render: true,
    rendered_duration_s: 39,
    clips: 6,
    clip_scene_plan: {
      repeat_free: true,
      blockers: [],
      repeated_base_sources: [],
      repeated_readable_card_kinds: [],
      direct_motion_source_concentration_metrics: {
        direct_motion_scene_count: 5,
        max_scenes_per_source_root: 1,
        max_source_concentration_ratio: 0.2,
        concentrated_sources: [],
      },
      scenes: Array.from({ length: 5 }, (_, index) => ({
        id: `current-tokon-direct-${index + 1}`,
        path: `output/video_cache/tokon-current-${index + 1}.mp4`,
        source_url: `https://video.example.test/marvel-tokon/current-official-${index + 1}.mp4`,
        media_kind: "direct_video",
        duration_s: 5,
        base_source_key: `tokon_current_official_${index + 1}_window_${10 + index * 6}_5`,
        source_root_key: `video.example.test/marvel-tokon/current-official-${index + 1}`,
      })),
    },
  }, { spaces: 2 });

  const preflight = await runPreflightQaForStory(
    baseStory({
      id: "scene-plan-authority-package",
      title: "MARVEL Tokon Finally Shows Real Gameplay",
      selected_title: "MARVEL Tokon Finally Shows Real Gameplay",
      canonical_subject: "MARVEL Tokon",
      first_spoken_line: "MARVEL Tokon finally looks less like a pitch and more like a real fighting game.",
      description: "IGN showed MARVEL Tokon's latest gameplay systems. Source: IGN.",
      full_script:
        "MARVEL Tokon finally looks less like a pitch and more like a real fighting game. IGN showed the tag systems, team pressure and screen control that could make this the Marvel fighter people actually argue about.",
      source_type: "rss",
      timestamp: "2026-06-24T18:00:00.000Z",
      duration_seconds: 39,
      duration_lane: "normal_production",
      min_video_duration_seconds: 35,
      target_video_duration_seconds_min: 35,
      target_video_duration_seconds_max: 60,
      max_video_duration_seconds: 60,
      render_lane: "visual_v4_production",
      render_quality_class: "premium",
      qa_visual_count: 8,
      primary_source: "IGN",
      discovery_source: "IGN",
      audio_path: "D:/pulse-data/media/output/audio/scene-plan-authority-package.mp3",
      timestamps_path: "D:/pulse-data/media/output/audio/scene-plan-authority-package_timestamps.json",
      manual_caption_path: "D:/pulse-data/media/output/captions/scene-plan-authority-package.srt",
      scheduler_bridge_source: "goal_production_cutover",
      scheduler_bridge_artifact_dir: tmp,
      exported_path: videoPath,
      visual_quality_report: {
        result: "pass",
        scores: {
          motion_density_score: 92,
          first_3_seconds_hook_score: 90,
          source_lock_quality_score: 88,
          caption_legibility_score: 94,
          card_hierarchy_score: 86,
          media_house_polish_score: 91,
        },
        frame_rules: {
          first_frame_subject: "MARVEL Tokon",
          first_frame_text: "MARVEL TOKON GAMEPLAY",
          source_locks_readable: true,
        },
        failures: [],
      },
      media_house_benchmark: {
        result: "pass",
        scores: {
          motion_density_score: 92,
          first_3_seconds_hook_score: 90,
          source_lock_quality_score: 88,
          caption_legibility_score: 94,
          card_hierarchy_score: 86,
          media_house_polish_score: 91,
        },
        failures: [],
      },
      sfx_manifest: bridgeSfxEvidence(),
      platform_policy_report: {
        disclosure_requirements: { affiliate: false, commercial: false },
        platform_disclosure_status: "resolved",
      },
      affiliate_link_manifest: {
        disclosure_required: false,
      },
      landing_page_manifest: {},
      rights_ledger: Array.from({ length: 5 }, (_, index) => ({
        asset_id: `tokon-current-official-${index + 1}`,
        path: `output/video_cache/tokon-current-${index + 1}.mp4`,
        source_url: `https://video.example.test/marvel-tokon/current-official-${index + 1}.mp4`,
        source_type: "official_trailer_segment",
        rights_risk_class: "official_reference_only",
        source_family: `tokon_current_official_${index + 1}`,
      })),
      visual_v4_bridge_video_clips: Array.from({ length: 5 }, (_, index) => ({
        id: `current-tokon-direct-${index + 1}`,
        path: `output/video_cache/tokon-current-${index + 1}.mp4`,
        source_url: `https://video.example.test/marvel-tokon/current-official-${index + 1}.mp4`,
        media_kind: "direct_video",
        source_family: `tokon_current_official_${index + 1}_window_${10 + index * 6}_5`,
        mediaStartS: 10 + index * 6,
        durationS: 5,
      })),
      publish_verdict: { verdict: "GREEN", can_auto_publish: true },
      platform_publish_manifest: {
        publish_status: "GREEN",
        platform_native_evidence: { verdict: "pass", checked_platforms: ["youtube_shorts"] },
        can_auto_publish: true,
        outputs: {
          youtube_shorts: { title: "MARVEL Tokon Finally Shows Real Gameplay" },
          instagram_reels: { caption: "MARVEL Tokon finally looks like a real fighting game." },
          facebook_reels: { page_caption: "MARVEL Tokon finally looks like a real fighting game." },
        },
      },
    }),
    {
      runSourceAgeQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
      runPublicCopyQa: async () => ({ verdict: "pass", failures: [], warnings: [] }),
      runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVoiceQualityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAudioSegmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runTimestampAlignmentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runVisualEntityQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runBridgeArtifactFreshnessQa: passBridgeArtifactFreshnessQa,
      runBridgeMotionGovernanceQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runAggregateBenchmarkQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runScriptScorecardQa: async () => ({ result: "pass", failures: [], warnings: [] }),
      runMediaHouseQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    },
  );

  assert.equal(preflight.status, "pass", JSON.stringify(preflight.blockers));
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.direct_motion_loop_evidence_source,
    "final_clip_scene_plan",
  );
  assert.equal(
    preflight.checks.incident_guard.evidence.file_evidence.repeated_direct_motion_segment_count,
    0,
  );
  assert.deepEqual(
    preflight.checks.incident_guard.evidence.file_evidence.direct_motion_base_source_overuse,
    [],
  );
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
    runPublicMetadataQa: async () => ({ result: "pass", failures: [], warnings: [] }),
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
