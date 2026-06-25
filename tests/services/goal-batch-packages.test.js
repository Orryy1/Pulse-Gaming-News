"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  augmentStoriesWithRevenuePaths,
  buildGoalBatchPackages,
  clipsFromVisualV4MotionPack,
  prepareStoryForGoalProof,
  writeGoalBatchPackages,
} = require("../../lib/goal-batch-packages");
const { buildGoalProofPackage, buildPlatformNativePublishPacks } = require("../../lib/goal-proof-package");
const {
  parseArgs: parseGoalBatchArgs,
  filterLiveRssStoriesForMotion,
  liveRssMotionGate,
  selectStoriesForGoalBatch,
  shouldFillRevenuePathsForGoalBatch,
} = require("../../tools/goal-batch-packages");
const { evaluateGoalPublicCopy } = require("../../lib/goal-public-copy-qa");
const { buildViralScriptIntelligence } = require("../../lib/viral-script-intelligence");

function licensedSfxAssets() {
  return [
    {
      asset_id: "boom-impact-01",
      role: "impact",
      family: "impact",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/impact-01.wav",
      licence_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "soundly-transition-01",
      role: "transition",
      family: "whoosh",
      provider_id: "soundly",
      source_url: "file://audio/licensed-sfx/soundly/transition-01.wav",
      licence_basis: "soundly_pro_commercial_use",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-ui-01",
      role: "ui_tick",
      family: "source_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/ui-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "sonniss-chart-01",
      role: "ui_tick",
      family: "chart_tick",
      provider_id: "sonniss",
      source_url: "file://audio/licensed-sfx/sonniss/chart-01.wav",
      licence_basis: "sonniss_game_audio_gdc_bundle_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "pse-riser-01",
      role: "riser",
      family: "riser",
      provider_id: "pro_sound_effects",
      source_url: "file://audio/licensed-sfx/pse/riser-01.wav",
      licence_basis: "pro_sound_effects_subscription_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
    {
      asset_id: "boom-sub-01",
      role: "sub_hit",
      family: "sub_hit",
      provider_id: "boom_library",
      source_url: "file://audio/licensed-sfx/boom/sub-01.wav",
      licence_basis: "boom_library_media_license",
      commercial_use_allowed: true,
      approval_status: "approved_for_commercial_editorial_use",
    },
  ];
}

function greenStory(id = "green-one") {
  const clips = Array.from({ length: 7 }, (_, index) => ({
    id: `${id}-clip-${index + 1}`,
    path: `output/video/${id}-clip-${index + 1}.mp4`,
    source_url: `https://cdn.example.com/${id}-clip-${index + 1}.mp4`,
    source_family: `${id}_family_${index + 1}`,
    source_type: "official_trailer",
    rights_risk_class: "official_reference_only",
    durationS: 2.8,
    validated: true,
  }));
  return {
    id,
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_angle: "paid early access created a major Steam demand signal",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_thumbnail_text: "FORZA STEAM SPIKE",
    thumbnail_source_label: "GamesRadar+",
    source_card_label: "GamesRadar+",
    source_name: "GamesRadar+",
    primary_source: "GamesRadar+",
    article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
    manual_caption_generated: true,
    transformative_edit_evidence: true,
    exported_path: `output/final/${id}.mp4`,
    render_manifest: {
      final_publish_render: true,
      output_path: `output/final/${id}.mp4`,
      duration_seconds: 48.2,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
    },
    audio_path: `output/audio/${id}.mp3`,
    narration_audio_path: `output/audio/${id}.mp3`,
    timestamps_path: `output/audio/${id}_timestamps.json`,
    word_timestamps_path: `output/audio/${id}_timestamps.json`,
    word_timestamp_source: "local_whisper_word_alignment",
    word_timestamps: [
      { word: "Forza", start: 0, end: 0.28 },
      { word: "Horizon", start: 0.29, end: 0.68 },
      { word: "6", start: 0.69, end: 0.82 },
    ],
    audio_manifest: {
      voice_status: "materialized",
      narration_audio_path: `output/audio/${id}.mp3`,
      word_timestamps_path: `output/audio/${id}_timestamps.json`,
      word_timestamp_source: "local_whisper_word_alignment",
      word_timestamp_count: 3,
    },
    full_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. GamesRadar+ reports 178,009 concurrent Steam players and a 92 Metacritic aggregate. The catch is that this happened before the standard launch, with some players paying $120. That split matters because paid early demand proves attention, but it does not prove the wider audience is already locked in. If the cheaper wave holds, this becomes a real momentum story instead of a premium-week screenshot. Follow Pulse Gaming so you never miss a beat.",
    video_clips: clips,
    sfx_asset_inventory: licensedSfxAssets(),
    affiliate_link_manifest: { story_id: id, vertical: "gaming", disclosure_required: false },
  };
}

function rightsFor(story) {
  return [
    ...story.video_clips.map((clip) => ({
      asset_id: clip.id,
      path: clip.path,
      source_url: clip.source_url,
      source_type: clip.source_type,
      licence_basis: "official_reference_transformative_short",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.18,
      evidence_file: `rights/${clip.id}.json`,
    })),
    {
      asset_id: `${story.id}_audio_path`,
      path: story.audio_path,
      source_type: "local_tts_voice",
      licence_basis: "owned_local_voice_model",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook"],
      commercial_use_allowed: true,
      risk_score: 0.05,
      evidence_file: "rights/local-tts.json",
    },
    ...(story.sfx_asset_inventory || []).map((asset) => ({
      ...asset,
      asset_type: "sfx",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      risk_score: 0.08,
      evidence_file: `rights/${asset.asset_id}.json`,
    })),
  ];
}

test("goal batch packages summarise GREEN and blocked story packages honestly", () => {
  const ready = greenStory("green-one");
  const weak = { id: "weak-one", title: "This gaming story", full_script: "This gaming story has a source-backed update." };
  const batch = buildGoalBatchPackages({
    stories: [ready, weak],
    rightsLedgerByStory: { [ready.id]: rightsFor(ready) },
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(batch.summary.story_count, 2);
  assert.equal(batch.summary.green_count, 1);
  assert.equal(batch.story_packages[0].verdict, "GREEN");
  assert.equal(batch.story_packages[1].verdict, "RED");
});

test("goal batch packages hydrate existing final render and audio evidence before rebuilding", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-batch-existing-evidence-"));
  try {
    const story = greenStory("existing-evidence-story");
    delete story.render_manifest;
    delete story.exported_path;
    delete story.audio_manifest;
    delete story.audio_path;
    delete story.narration_audio_path;
    delete story.word_timestamps_path;
    delete story.timestamps_path;
    const storyDir = path.join(tempDir, story.id);
    const renderPath = path.join(storyDir, "visual_v4_render.mp4");
    const audioPath = path.join(storyDir, "narration.mp3");
    const timestampsPath = path.join(storyDir, "timestamps.json");
    fs.ensureDirSync(storyDir);
    fs.writeFileSync(renderPath, Buffer.alloc(4096, 7));
    fs.writeFileSync(audioPath, Buffer.alloc(2048, 8));
    fs.writeJsonSync(timestampsPath, { words: story.word_timestamps });
    fs.writeJsonSync(path.join(storyDir, "render_manifest.json"), {
      final_publish_render: true,
      output_path: renderPath,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
      rendered_duration_s: 48.2,
    });
    fs.writeJsonSync(path.join(storyDir, "audio_manifest.json"), {
      voice_status: "materialized",
      narration_audio_path: audioPath,
      word_timestamps_path: timestampsPath,
      word_timestamp_source: "local_whisper_word_alignment",
      word_timestamp_count: story.word_timestamps.length,
    });

    const batch = buildGoalBatchPackages({
      stories: [story],
      rightsLedgerByStory: { [story.id]: rightsFor(story) },
      existingArtifactRoot: tempDir,
      generatedAt: "2026-06-23T21:00:00.000Z",
    });

    const pack = batch.packages[0];
    assert.equal(pack.render_manifest.final_publish_render, true);
    assert.equal(pack.audio_manifest.narration_audio_path, audioPath);
    assert.equal(pack.audio_manifest.word_timestamps_path, timestampsPath);
    assert.ok(!pack.publish_verdict.reason_codes.includes("render:final_publish_render_missing"));
    assert.ok(!pack.publish_verdict.reason_codes.includes("audio:narration_audio_missing"));
    assert.ok(!pack.publish_verdict.reason_codes.includes("captions:word_timestamps_missing"));
  } finally {
    fs.removeSync(tempDir);
  }
});

test("goal batch packages recover repaired audio evidence when audio manifest was downgraded", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-batch-recovered-audio-"));
  try {
    const story = greenStory("recovered-audio-story");
    delete story.render_manifest;
    delete story.exported_path;
    delete story.audio_manifest;
    delete story.audio_path;
    delete story.narration_audio_path;
    delete story.word_timestamps_path;
    delete story.timestamps_path;
    const storyDir = path.join(tempDir, story.id);
    const renderPath = path.join(storyDir, "visual_v4_render.mp4");
    const audioPath = path.join(storyDir, "narration.mp3");
    const timestampsPath = path.join(storyDir, "timestamps.json");
    fs.ensureDirSync(storyDir);
    fs.writeFileSync(renderPath, Buffer.alloc(4096, 7));
    fs.writeFileSync(audioPath, Buffer.alloc(2048, 8));
    fs.writeJsonSync(timestampsPath, { words: story.word_timestamps });
    fs.writeJsonSync(path.join(storyDir, "audio_manifest.json"), {
      narration_audio_path: null,
      word_timestamps_path: null,
    });
    fs.writeJsonSync(path.join(storyDir, "narration_manifest.json"), {
      status: "ready",
      resolved_narration_audio_path: audioPath,
      resolved_word_timestamps_path: timestampsPath,
      word_timestamp_source: "local_whisper_word_alignment",
      word_timestamp_count: story.word_timestamps.length,
    });
    fs.writeJsonSync(path.join(storyDir, "render_manifest.json"), {
      final_publish_render: true,
      output_path: renderPath,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
      rendered_duration_s: 48.2,
      input_evidence: {
        resolved_narration_audio_path: audioPath,
        resolved_word_timestamps_path: timestampsPath,
        word_timestamp_source: "local_whisper_word_alignment",
      },
    });

    const batch = buildGoalBatchPackages({
      stories: [story],
      rightsLedgerByStory: { [story.id]: rightsFor(story) },
      existingArtifactRoot: tempDir,
      generatedAt: "2026-06-23T21:05:00.000Z",
    });

    const pack = batch.packages[0];
    assert.equal(pack.audio_manifest.narration_audio_path, audioPath);
    assert.equal(pack.audio_manifest.word_timestamps_path, timestampsPath);
    assert.equal(pack.audio_manifest.word_timestamp_source, "local_whisper_word_alignment");
    assert.ok(!pack.publish_verdict.reason_codes.includes("audio:narration_audio_missing"));
    assert.ok(!pack.publish_verdict.reason_codes.includes("captions:word_timestamps_missing"));
  } finally {
    fs.removeSync(tempDir);
  }
});

test("goal batch packages hydrate cached HLS motion clips from visual V4 motion packs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-batch-cache-"));
  try {
    const storyId = "steam-hls-story";
    const sourceUrl =
      "https://video.akamai.steamstatic.com/store_trailers/1145350/695850/hash/hls_264_master.m3u8?t=1715021703";
    const localMp4 = path.join(tempDir, `${storyId}_v4_clip_1_hls.mp4`);
    fs.writeFileSync(localMp4, "not-a-real-video-for-hydration-test");
    fs.writeJsonSync(`${localMp4}.json`, {
      source_url: sourceUrl,
      media_start_s: 36,
      duration_s: 5,
    });

    const clips = clipsFromVisualV4MotionPack(
      {
        readiness: { status: "v4_motion_ready" },
        clips: [
          {
            id: "steam-hls-window",
            type: "motion_clip",
            source_family: "steam_1145350_hls_window",
            path: sourceUrl,
            source_url: sourceUrl,
            source_kind: "hls_manifest",
            source_url_kind: "hls_manifest",
            source_type: "official_platform_product_page",
            mediaStartS: 36,
            durationS: 5,
            validated: true,
            segmentValidationPassed: true,
          },
          {
            id: "uncached-hls-window",
            type: "motion_clip",
            source_family: "steam_1145350_uncached_hls_window",
            path: sourceUrl,
            source_url: sourceUrl,
            source_kind: "hls_manifest",
            source_url_kind: "hls_manifest",
            source_type: "official_platform_product_page",
            mediaStartS: 54,
            durationS: 5,
            validated: true,
            segmentValidationPassed: true,
          },
        ],
      },
      { storyId, videoCacheDir: tempDir },
    );

    assert.equal(clips.length, 1);
    assert.equal(clips[0].id, "steam-hls-window");
    assert.equal(clips[0].path, localMp4);
    assert.equal(clips[0].source_url, sourceUrl);
    assert.equal(clips[0].local_materialized_path, localMp4);
    assert.equal(clips[0].source_restore.local_cache_hit, true);
  } finally {
    fs.removeSync(tempDir);
  }
});

test("goal batch packages hydrate cached Steam CDN aliases from visual V4 motion packs", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "goal-batch-steam-cdn-cache-"));
  try {
    const storyId = "steam-cdn-alias-story";
    const cachedSourceUrl =
      "https://video.akamai.steamstatic.com/store_trailers/1172620/204445374/hash/1773669773/hls_264_master.m3u8?t=old";
    const motionPackSourceUrl =
      "https://video.fastly.steamstatic.com/store_trailers/1172620/204445374/hash/1773669773/hls_264_master.m3u8?t=new";
    const localMp4 = path.join(tempDir, `${storyId}_v4_clip_1_hls.mp4`);
    fs.writeFileSync(localMp4, "not-a-real-video-for-steam-cdn-alias-test");
    fs.writeJsonSync(`${localMp4}.json`, {
      source_url: cachedSourceUrl,
      media_start_s: 8.96,
      duration_s: 5,
    });

    const clips = clipsFromVisualV4MotionPack(
      {
        readiness: { status: "v4_motion_ready" },
        clips: [
          {
            id: "steam-fastly-window",
            type: "motion_clip",
            source_family: "steam_1172620_204445374",
            path: motionPackSourceUrl,
            source_url: motionPackSourceUrl,
            source_kind: "hls_manifest",
            source_url_kind: "hls_manifest",
            source_type: "licensed_direct_media_url",
            mediaStartS: 8.96,
            durationS: 5,
            validated: true,
            segmentValidationPassed: true,
          },
        ],
      },
      { storyId, videoCacheDir: tempDir },
    );

    assert.equal(clips.length, 1);
    assert.equal(clips[0].id, "steam-fastly-window");
    assert.equal(clips[0].path, localMp4);
    assert.equal(clips[0].source_url, motionPackSourceUrl);
    assert.equal(clips[0].local_materialized_path, localMp4);
  } finally {
    fs.removeSync(tempDir);
  }
});

test("goal batch packages collapse duplicate direct MP4 motion windows before director scoring", () => {
  const storyId = "direct-mp4-duplicate-story";
  const sourceUrl = "https://assets.example.com/gameplay/direct-gameplay.mp4";
  const clips = clipsFromVisualV4MotionPack(
    {
      readiness: { status: "v4_motion_ready" },
      handoff: {
        visual_v4_local_motion_clips: [
          {
            id: "direct-window-one",
            type: "motion_clip",
            source_family: "official_gameplay_asset",
            path: sourceUrl,
            source_url: sourceUrl,
            source_type: "official_game_site_news_page",
            mediaStartS: 72,
            durationS: 5,
            validated: true,
            segmentValidationPassed: true,
          },
          {
            id: "direct-window-one-repeat",
            type: "motion_clip",
            source_family: "official_gameplay_asset",
            path: sourceUrl,
            source_url: sourceUrl,
            source_type: "official_game_site_news_page",
            mediaStartS: 72,
            durationS: 5,
            validated: true,
            segmentValidationPassed: true,
          },
          {
            id: "direct-window-two",
            type: "motion_clip",
            source_family: "official_gameplay_asset",
            path: sourceUrl,
            source_url: sourceUrl,
            source_type: "official_game_site_news_page",
            mediaStartS: 96,
            durationS: 5,
            validated: true,
            segmentValidationPassed: true,
          },
        ],
      },
    },
    { storyId },
  );

  assert.deepEqual(
    clips.map((clip) => clip.id),
    ["direct-window-one", "direct-window-two"],
  );
});

test("goal batch packages carry SFX inventory rights into governance", () => {
  const ready = greenStory("sfx-ledger-one");
  ready.sfx_assets = undefined;
  ready.sfx_asset_inventory = licensedSfxAssets();
  ready.sfx_rights_ledger = ready.sfx_asset_inventory.map((asset) => ({
    ...asset,
    asset_type: "sfx",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    risk_score: 0.08,
    evidence_file: `rights/${asset.asset_id}.json`,
  }));

  const motionAndNarrationRights = rightsFor({ ...ready, sfx_asset_inventory: [] });
  const batch = buildGoalBatchPackages({
    stories: [ready],
    rightsLedgerByStory: { [ready.id]: motionAndNarrationRights },
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(batch.packages[0].rights_ledger.metrics.asset_count, 14);
  assert.ok(
    batch.packages[0].rights_ledger.matched_assets.some((asset) => asset.asset_id === "boom-impact-01"),
  );
  assert.equal(batch.story_packages[0].verdict, "GREEN");
  assert.equal(batch.packages[0].publish_verdict.verdict, "GREEN");
  assert.doesNotMatch(
    batch.packages[0].publish_verdict.reason_codes.join("\n"),
    /rights:no_rights_record/,
  );
});

test("goal batch packages hydrate shared licensed SFX evidence before director scoring", () => {
  const ready = greenStory("shared-sfx-one");
  delete ready.sfx_asset_inventory;
  delete ready.sfx_assets;
  delete ready.sfx_rights_ledger;

  const sharedSfxAssets = licensedSfxAssets();
  const sharedSfxRights = sharedSfxAssets.map((asset) => ({
    ...asset,
    asset_type: "sfx",
    allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
    risk_score: 0.08,
    evidence_file: `rights/${asset.asset_id}.json`,
  }));
  const batch = buildGoalBatchPackages({
    stories: [ready],
    rightsLedgerByStory: { [ready.id]: rightsFor({ ...ready, sfx_asset_inventory: [] }) },
    sfxAssetInventory: sharedSfxAssets,
    sfxRightsLedger: sharedSfxRights,
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(batch.story_packages[0].verdict, "GREEN");
  assert.equal(batch.packages[0].director_beat_map.readiness.status, "director_ready");
  assert.equal(batch.packages[0].sfx_source_plan.readiness.status, "pass");
  assert.deepEqual(batch.packages[0].sfx_source_plan.covered_roles, ["impact", "sub_hit", "transition", "ui_tick"]);
  assert.equal(batch.packages[0].publish_verdict.verdict, "GREEN");
});

test("goal proof package publish verdict turns RED when transcript scorecard blocks", () => {
  const story = {
    ...greenStory("weak-transcript"),
    full_script:
      "This story should stay in review until it has a named game, studio or platform subject. The source may be real, but Pulse needs the actual subject before this becomes a video. Follow Pulse Gaming so you never miss a beat.",
  };

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsFor(story),
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(pack.script_scorecard.verdict, "rewrite_required");
  assert.equal(pack.publish_verdict.verdict, "RED");
  assert.equal(pack.publish_verdict.can_auto_publish, false);
  assert.ok(pack.publish_verdict.reason_codes.some((code) => code.startsWith("script_scorecard:")));
  assert.equal(pack.platform_publish_manifest.publish_status, "RED");
});

test("goal proof package publish verdict turns RED when motion quality blocks", () => {
  const story = {
    ...greenStory("weak-motion"),
    video_clips: [],
    visual_v4_local_motion_clips: [],
    motion_clips: [],
  };

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsFor(story),
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(pack.script_scorecard.verdict, "viral_ready");
  assert.equal(pack.publish_verdict.verdict, "RED");
  assert.equal(pack.publish_verdict.can_auto_publish, false);
  assert.ok(pack.publish_verdict.reason_codes.includes("footage:v4_motion_blocked"));
  assert.equal(pack.platform_publish_manifest.publish_status, "RED");
});

test("goal proof package publish verdict turns RED when local TTS was tempo-stretched", () => {
  const story = {
    ...greenStory("stretched-voice"),
    audio_manifest: {
      approved_voice_path: {
        verdict: "rejected",
        blockers: ["local_tts_tempo_stretch_applied"],
      },
      narration: {
        provider: "local",
        generation: {
          tempo_stretch: {
            applied: true,
            input_duration_s: 42.4,
            output_duration_s: 50.8,
          },
        },
      },
    },
  };

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsFor(story),
    generatedAt: "2026-05-21T20:05:00.000Z",
  });

  assert.equal(pack.publish_verdict.verdict, "RED");
  assert.equal(pack.publish_verdict.can_auto_publish, false);
  assert.ok(pack.publish_verdict.reason_codes.includes("audio:local_tts_tempo_stretch_applied"));
  assert.equal(pack.platform_publish_manifest.publish_status, "RED");
});

test("goal proof package publish verdict turns RED for local proof without final audio and timestamps", () => {
  const story = greenStory("local-proof-only");
  delete story.exported_path;
  delete story.render_manifest;
  delete story.audio_path;
  delete story.narration_audio_path;
  delete story.timestamps_path;
  delete story.word_timestamps_path;
  delete story.word_timestamp_source;
  delete story.word_timestamps;
  delete story.audio_manifest;

  const pack = buildGoalProofPackage({
    story,
    rightsLedger: rightsFor({ ...story, audio_path: "output/audio/local-proof-only.mp3" }),
  });

  assert.equal(pack.publish_verdict.verdict, "RED");
  assert.equal(pack.publish_verdict.can_auto_publish, false);
  assert.ok(pack.publish_verdict.reason_codes.includes("render:final_publish_render_missing"));
  assert.ok(pack.publish_verdict.reason_codes.includes("audio:narration_audio_missing"));
  assert.ok(pack.publish_verdict.reason_codes.includes("captions:word_timestamps_missing"));
  assert.equal(pack.acceptance_entry.verdict, "RED");
});

test("goal batch CLI can select repaired live DB stories for governed packaging", () => {
  const args = parseGoalBatchArgs([
    "--db-stories",
    "--story-id",
    "1tkik53,rss_story",
    "--limit",
    "2",
  ]);
  assert.equal(args.dbStories, true);
  assert.deepEqual(args.storyIds, ["1tkik53", "rss_story"]);

  const selected = selectStoriesForGoalBatch({
    dbStories: [
      { id: "1tkik53", title: "Valorant Vanguard Trust Problem" },
      { id: "other", title: "Other Story" },
    ],
    baseStories: [{ id: "daily", title: "Daily Story" }],
    liveRssStories: [{ id: "rss_story", title: "RSS Proof Story" }],
    useDbStories: true,
    storyIds: args.storyIds,
  });

  assert.deepEqual(selected.map((story) => story.id), ["rss_story", "1tkik53"]);
});

test("goal batch live RSS selection filters weak motion stories before packaging", () => {
  const selected = selectStoriesForGoalBatch({
    liveRssStories: [
      {
        id: "deal-card",
        title: "Today’s Top Deals: Switch 2 Memory Cards And Controller Discounts",
        source_name: "IGN Deals",
      },
      {
        id: "review-abstract",
        title: "Star Fox Review Has A Review Momentum Problem",
        source_name: "PC Gamer",
      },
      {
        id: "generic-platform",
        title: "Xbox Has A Player-Return Problem",
        source_name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/24/xbox-player-return-problem/",
      },
      {
        id: "template-title",
        title: "Why This Game Could Split Players",
        source_name: "Eurogamer",
      },
      {
        id: "official-gameplay",
        title: "Halo Campaign Evolved Shows New Gameplay In Official Xbox Deep Dive",
        source_name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/24/halo-campaign-evolved-gameplay/",
      },
      {
        id: "trailer-reveal",
        title: "Resident Evil Requiem Gets A New Gameplay Trailer",
        source_name: "GameSpot",
      },
      {
        id: "demo-playable",
        title: "Hell Is Us Steam Demo Lets Players Try New Gameplay Today",
        canonical_subject: "Hell Is Us",
        source_name: "Steam",
      },
    ],
    baseStories: [{ id: "daily", title: "Daily Story" }],
  });

  assert.deepEqual(
    selected.map((story) => story.id),
    ["official-gameplay", "demo-playable", "trailer-reveal", "daily"],
  );
});

test("goal batch live RSS selection keeps official-source stories for motion repair intake when direct motion is absent", () => {
  const selected = selectStoriesForGoalBatch({
    liveRssStories: [
      {
        id: "deal-card",
        title: "Today's Top Deals: Switch 2 Memory Cards And Controller Discounts",
        source_name: "IGN Deals",
      },
      {
        id: "generic-platform",
        title: "Xbox Has A Player-Return Problem",
        source_name: "Xbox Wire",
        url: "https://news.xbox.com/en-us/2026/06/24/xbox-player-return-problem/",
      },
      {
        id: "official-gta",
        title: "Grand Theft Auto VI plays best on PS5 November 19",
        canonical_subject: "Grand Theft Auto VI",
        source_name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/24/grand-theft-auto-vi-plays-best-on-ps5-november-19/",
      },
      {
        id: "official-doom",
        title: "Upgraded PSSR comes to Doom: The Dark Ages on PS5 Pro",
        canonical_subject: "Doom: The Dark Ages",
        source_name: "PlayStation Blog",
        url: "https://blog.playstation.com/2026/06/24/upgraded-pssr-comes-to-doom-the-dark-ages-on-ps5-pro/",
      },
    ],
    baseStories: [],
  });

  assert.deepEqual(
    selected.map((story) => story.id),
    ["official-gta", "official-doom"],
  );
});

test("goal batch live RSS motion gate preserves official direct-media stories", () => {
  const story = {
    id: "rockstar-gta-vi-cover",
    title: "GTA VI Cover Art Reveal Sets Up The Pre-Order Fight",
    source_name: "Rockstar Newswire",
    source_type: "official",
    url: "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
    approved_direct_media_url:
      "https://media.rockstargames.com/VI/downloads/videos/GTAVI_Official_Cover_Art_Landscape/GTAVI_Official_Cover_Art_Landscape.mp4",
  };

  assert.equal(liveRssMotionGate(story).pass, true);
  assert.deepEqual(filterLiveRssStoriesForMotion([story]).map((row) => row.id), [story.id]);
});

test("goal batch CLI parses shared SFX evidence paths", () => {
  const args = parseGoalBatchArgs([
    "--sfx-assets",
    "output/goal-contract/sfx_asset_inventory.json",
    "--sfx-rights-ledger",
    "output/goal-contract/sfx_rights_ledger.json",
  ]);

  assert.equal(args.sfxAssetsPath, "output/goal-contract/sfx_asset_inventory.json");
  assert.equal(args.sfxRightsLedgerPath, "output/goal-contract/sfx_rights_ledger.json");
});

test("goal batch live RSS only mode blocks stale backlog revenue fallback", () => {
  const args = parseGoalBatchArgs(["--live-rss-only", "--limit", "12"]);

  assert.equal(args.liveRss, true);
  assert.equal(args.liveRssOnly, true);
  assert.equal(shouldFillRevenuePathsForGoalBatch(args), false);
  assert.equal(shouldFillRevenuePathsForGoalBatch(parseGoalBatchArgs(["--live-rss"])), true);
});

test("goal batch CLI defaults to retained licensed SFX evidence", () => {
  const args = parseGoalBatchArgs([]);
  const root = path.resolve(__dirname, "..", "..");

  assert.equal(
    args.sfxAssetsPath,
    path.join(root, "output", "goal-contract", "sfx_asset_inventory.json"),
  );
  assert.equal(
    args.sfxRightsLedgerPath,
    path.join(root, "output", "goal-contract", "sfx_rights_ledger.json"),
  );
});

test("goal batch package proof preparation rewrites source-backed fallback narration before QA", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "hades-fallback",
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      title: "Hades II Finally Shows Console Gameplay",
      primary_source: "IGN",
      article_url: "https://www.ign.com/articles/hades-ii-console-gameplay",
      full_script: "source-backed update clean read",
    },
    { allowOwnedMotionFallback: true },
  );

  const manifest = {
    ...prepared,
    selected_title: prepared.public_title,
    thumbnail_headline: prepared.suggested_thumbnail_text,
    narration_script: prepared.full_script,
    first_spoken_line: prepared.full_script.split(/(?<=[.!?])\s+/)[0],
  };

  assert.equal(prepared.public_title, "Hades II Finally Shows Console Gameplay");
  assert.doesNotMatch(prepared.full_script, /source-backed update|this gaming story|the useful question/i);
  assert.equal(evaluateGoalPublicCopy(manifest).verdict, "pass");
});

test("goal batch package proof preparation writes concrete GTA VI preorder scripts", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "gta-vi-cover-art-proof",
      canonical_subject: "Grand Theft Auto VI",
      canonical_game: "Grand Theft Auto VI",
      title: "GTA VI Cover Art Reveal Sets Up The Pre-Order Fight",
      primary_source: "Rockstar Newswire",
      source_type: "official",
      article_url:
        "https://www.rockstargames.com/newswire/article/5171972o3ak5oa/pre-order-grand-theft-auto-vi-on-june-25",
      full_script: "source-backed update clean read",
    },
    { allowOwnedMotionFallback: true },
  );

  assert.equal(prepared.canonical_subject, "Grand Theft Auto VI");
  assert.match(prepared.full_script, /^Rockstar just put Jason and Lucia back at the centre of Grand Theft Auto VI/i);
  assert.match(prepared.full_script, /pre-orders open on June 25/i);
  assert.match(prepared.full_script, /price, editions, bonuses/i);
  assert.match(prepared.full_script, /what the money actually buys/i);
  assert.equal(prepared.suggested_thumbnail_text, "GTA VI PREORDER TEST");
  assert.doesNotMatch(prepared.full_script, /source-backed update|this story finally has something specific/i);
});

test("goal batch package proof preparation writes specific GTA VI PS5 scripts", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "rss_gta_vi_ps5_blog",
      canonical_subject: "Grand Theft Auto VI",
      canonical_game: "Grand Theft Auto VI",
      title: "Grand Theft Auto VI plays best on PS5 November 19",
      primary_source: "PlayStation Blog",
      source_name: "PlayStation Blog",
      source_type: "official_platform",
      article_url:
        "https://blog.playstation.com/2026/06/24/grand-theft-auto-vi-plays-best-on-ps5-november-19/",
      full_script:
        "Grand Theft Auto VI plays has one clear detail players can check before the hype gets ahead of it. PlayStation Blog says Grand Theft Auto VI plays best on PS5 November 19. The player test is simple: does this change what people install, wishlist, finish or ignore? If it changes that decision, the story earns attention. Follow Pulse Gaming so you never miss a beat.",
    },
    { allowOwnedMotionFallback: true },
  );

  assert.equal(prepared.public_title, "GTA VI Just Made PS5 The Version To Watch");
  assert.equal(prepared.canonical_subject, "Grand Theft Auto VI");
  assert.equal(prepared.canonical_game, "Grand Theft Auto VI");
  assert.equal(prepared.suggested_thumbnail_text, "GTA VI PS5 TEST");
  assert.match(prepared.full_script, /^Sony just made GTA VI's console pitch very direct\./i);
  assert.match(prepared.full_script, /PlayStation Blog says Grand Theft Auto VI plays best on PS5 on November 19\./i);
  assert.match(prepared.full_script, /whether PS5 becomes the default version people expect to play/i);
  assert.doesNotMatch(
    prepared.full_script,
    /one clear detail|player test|install, wishlist|background noise|Grand Theft Auto VI plays has/i,
  );
  assert.equal(
    buildViralScriptIntelligence({
      story: { ...prepared, title: prepared.public_title },
      script: prepared.full_script,
    }).verdict,
    "viral_ready",
  );
});

test("goal batch package proof preparation writes specific PS5 Pro tech scripts", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "rss_doom_pssr_blog",
      canonical_subject: "Doom: The Dark Ages",
      canonical_game: "Doom: The Dark Ages",
      title: "Upgraded PSSR comes to Doom: The Dark Ages on PS5 Pro",
      primary_source: "PlayStation Blog",
      source_name: "PlayStation Blog",
      source_type: "official_platform",
      article_url:
        "https://blog.playstation.com/2026/06/24/upgraded-pssr-comes-to-doom-the-dark-ages-on-ps5-pro/",
      full_script:
        "Doom: The Dark Ages has one clear detail players can check before the hype gets ahead of it. PlayStation Blog says Upgraded PSSR comes to Doom: The Dark Ages on PS5 Pro. The player test is simple: does this change what people install, wishlist, finish or ignore? Follow Pulse Gaming so you never miss a beat.",
    },
    { allowOwnedMotionFallback: true },
  );

  assert.equal(prepared.public_title, "Doom The Dark Ages Becomes A PS5 Pro Test");
  assert.equal(prepared.canonical_subject, "Doom: The Dark Ages");
  assert.equal(prepared.canonical_game, "Doom: The Dark Ages");
  assert.equal(prepared.suggested_thumbnail_text, "DOOM PS5 PRO");
  assert.match(prepared.full_script, /^Doom: The Dark Ages just became a PS5 Pro tech test\./i);
  assert.match(prepared.full_script, /upgraded PSSR is coming to Doom: The Dark Ages on PS5 Pro/i);
  assert.match(prepared.full_script, /If the upgrade keeps Doom sharp in motion/i);
  assert.doesNotMatch(prepared.full_script, /one clear detail|player test|background noise/i);
  assert.equal(
    buildViralScriptIntelligence({
      story: { ...prepared, title: prepared.public_title },
      script: prepared.full_script,
    }).verdict,
    "viral_ready",
  );
});

test("goal batch package proof preparation maps Yoshie boss fragments to Denshattack", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "rss_denshattack_yoshie",
      canonical_subject: "Meet Yoshie",
      canonical_game: "Meet Yoshie",
      title: "Meet Yoshie, Denshattack's first major boss battle",
      primary_source: "Xbox Wire",
      source_name: "Xbox Wire",
      source_type: "official_platform",
      article_url: "https://news.xbox.com/en-us/2026/06/24/denshattack-yoshie-boss-battle/",
      full_script:
        "Meet Yoshie has one clear detail players can check before the hype gets ahead of it. Xbox Wire says Meet Yoshie, Denshattack's first major boss battle. The player test is simple: does this change what people install, wishlist, finish or ignore? Follow Pulse Gaming so you never miss a beat.",
    },
    { allowOwnedMotionFallback: true },
  );

  assert.equal(prepared.canonical_subject, "Denshattack");
  assert.equal(prepared.canonical_game, "Denshattack");
  assert.equal(prepared.public_title, "Denshattack Has A Boss Fight Test");
  assert.equal(prepared.suggested_thumbnail_text, "BOSS FIGHT TEST");
  assert.match(prepared.full_script, /^Denshattack just showed the boss fight/i);
  assert.doesNotMatch(prepared.full_script, /one clear detail|player test|Meet Yoshie has/i);
});

test("goal batch owned fallback motion clips use readable card dwell", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "owned-card-dwell",
      canonical_subject: "Invincible VS",
      canonical_game: "Invincible VS",
      title: "Invincible VS Shows Its First Real Roster Problem",
      primary_source: "IGN",
      article_url: "https://www.ign.com/articles/invincible-vs-roster-trailer",
      full_script:
        "Invincible VS has a roster problem fighting games cannot hide. IGN says the new trailer focuses on character matchups, tag timing and how quickly assists can flip a round. That matters because a famous licence only helps if the fights stay readable once three characters start filling the screen. If the roster has depth without becoming visual noise, this becomes a real contender. If it does not, the licence will carry the trailer and lose the match. Follow Pulse Gaming so you never miss a beat.",
    },
    { allowOwnedMotionFallback: true },
  );

  assert.ok(prepared.video_clips.length >= 6);
  assert.equal(
    prepared.video_clips.every((clip) => Number(clip.durationS) >= 8.5),
    true,
    JSON.stringify(prepared.video_clips.map((clip) => ({ id: clip.id, durationS: clip.durationS }))),
  );
});

test("goal batch package proof preparation avoids source-backed fallback claim when title is missing", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "hades-missing-title",
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      primary_source: "PlayStation Blog",
      article_url: "https://blog.playstation.com/hades-ii-console-details",
      full_script: "clean read",
    },
    { allowOwnedMotionFallback: true },
  );

  const combined = [
    prepared.public_title,
    prepared.suggested_title,
    prepared.full_script,
    prepared.description,
  ].join("\n");

  assert.doesNotMatch(combined, /source-backed update|this gaming story/i);
  assert.match(prepared.full_script, /Hades II/i);
});

test("goal batch package proof preparation avoids internal review fallback copy for thin fresh RSS stories", () => {
  const story = {
    ...greenStory("vesper-thin-rss"),
    id: "vesper-thin-rss",
    canonical_subject: "Vesper Underground",
    canonical_game: "Vesper Underground",
    canonical_angle: "source_locked_update",
    title: "Vesper Underground",
    suggested_title: "Vesper Underground",
    public_title: "Vesper Underground Has A Player Trust Test",
    primary_source: "PlayStation Blog",
    source_name: "PlayStation Blog",
    article_url: "https://blog.playstation.com/2026/06/19/vesper-underground/",
    full_script: "clean read",
    description: "A short source-backed update for Vesper Underground.",
  };

  const prepared = prepareStoryForGoalProof(story, { allowOwnedMotionFallback: true });
  const pack = buildGoalProofPackage({
    story: prepared,
    rightsLedger: rightsFor(prepared),
    generatedAt: "2026-06-20T01:10:00.000Z",
  });
  const youtube = pack.platform_publish_manifest.outputs.youtube_shorts;

  assert.doesNotMatch(prepared.full_script, /real source detail|not enough practical consequence|strong Pulse short/i);
  assert.doesNotMatch(youtube.title, /player trust test/i);
  assert.doesNotMatch(youtube.description, /real source detail|not enough practical consequence|strong Pulse short/i);
  assert.match(youtube.title, /Vesper Underground/i);
  assert.match(youtube.description, /Vesper Underground/i);
});

test("goal batch package proof keeps evidence-backed named-character cover headlines", () => {
  const native = buildPlatformNativePublishPacks({
    story: {
      id: "rss_sf6_yasmine_pressure",
      suggested_thumbnail_text: "YASMINE PRESSURE",
      full_script:
        "Street Fighter 6 just made Yasmine look dangerous for one simple reason: this trailer is about pressure, not patience. GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. Follow Pulse Gaming so you never miss a beat.",
    },
    canonical: {
      canonical_subject: "Street Fighter 6",
      canonical_game: "Street Fighter 6",
      title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
      thumbnail_headline: "YASMINE PRESSURE",
      primary_source: "GameSpot",
      first_spoken_line:
        "Street Fighter 6 just made Yasmine look dangerous for one simple reason: this trailer is about pressure, not patience.",
      description:
        "GameSpot's footage shows Yasmine using fast pressure, knife feints and step-ins that punish anyone who backs up.",
    },
  });
  const youtube = native.outputs.youtube_shorts;

  assert.equal(youtube.cover_frame.headline, "YASMINE PRESSURE");
  assert.ok(!native.platformNativeEvidence.failures.some(
    (failure) => failure.reason === "weak_cover_headline",
  ));
});

test("goal batch package proof preparation rewrites thin fresh RSS scripts into specific viewer copy", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "rss_ai_stigma_reviews",
      canonical_subject: "AI stigma on Steam",
      canonical_game: "AI stigma on Steam",
      title:
        "Data analyst finds 'AI stigma' on Steam can reduce the number of reviews a game gets by around 53%",
      source_type: "rss",
      source_name: "PC Gamer",
      primary_source: "PC Gamer",
      article_url: "https://www.pcgamer.com/games/ai-stigma-steam-review-count-analysis",
      confirmed_claims: [
        "PC Gamer says a data analyst found games disclosing AI content on Steam can receive around 53% fewer reviews.",
      ],
      description:
        "A data analyst found an AI stigma on Steam can reduce review volume by around 53%, with the reviews those games do receive skewing more negative.",
      full_script: "clean read",
    },
    { allowOwnedMotionFallback: true },
  );

  const publicCopy = [
    prepared.public_title,
    prepared.full_script,
    prepared.description,
  ].join("\n");

  assert.match(publicCopy, /AI stigma|Steam|53%|reviews/i);
  assert.doesNotMatch(
    publicCopy,
    /needs one concrete player-facing detail|more than a feed item|the useful question|footage, release timing, price|next proof|stays a watch item|Price Timing Risk/i,
  );
});

test("goal batch package proof preparation extracts AI stigma subject from article attribution headlines", () => {
  const prepared = prepareStoryForGoalProof(
    {
      id: "rss_ai_stigma_attribution_title",
      canonical_subject: "Data analyst finds 'AI stigma'",
      canonical_game: "Data analyst finds 'AI stigma'",
      selected_title: "AI stigma on Steam Has A Review Momentum Problem",
      title:
        "Data analyst finds 'AI stigma' on Steam can reduce the number of reviews a game gets by around 53%",
      source_type: "rss",
      source_name: "PC Gamer",
      primary_source: "PC Gamer",
      article_url: "https://www.pcgamer.com/games/ai-stigma-steam-review-count-analysis",
      confirmed_claims: [
        "PC Gamer says a data analyst found games disclosing AI content on Steam can receive around 53% fewer reviews.",
      ],
      description:
        "A data analyst found an AI stigma on Steam can reduce review volume by around 53%, with the reviews those games do receive skewing more negative.",
      full_script: "clean read",
    },
    { allowOwnedMotionFallback: true },
  );

  assert.equal(prepared.canonical_subject, "AI stigma on Steam");
  assert.equal(prepared.public_title, "Steam's AI Label Has A Review Problem");
  assert.doesNotMatch(prepared.public_title, /Data analyst finds/i);
  assert.match(prepared.full_script, /AI labels on Steam|53% fewer reviews/i);

  const pack = buildGoalProofPackage({ story: prepared });
  assert.equal(pack.youtube_publish_pack.title, "Steam's AI Label Has A Review Problem");
  assert.equal(pack.canonical_story_manifest.public_title, "Steam's AI Label Has A Review Problem");
});

test("goal batch package proof preparation repairs generic DB subjects before script QA", () => {
  const prepared = prepareStoryForGoalProof({
    id: "1tkik53",
    title:
      "Valorant's new Vanguard update seems to be bricking cheaters' PCs. Riot's response? \"Congrats on your $6k paperweights\"",
    canonical_subject: "This story",
    canonical_game: "This story",
    source_type: "rss",
    source_name: "PCGamesN",
    article_url: "https://www.pcgamesn.com/valorant/vanguard-update-bricking-pcs-riot-response",
    pinned_comment: "Source: r/pcgaming | Verified gaming news daily",
    suggested_title: "Valorant's Vanguard Fight",
    suggested_thumbnail_text: "VANGUARD PANIC",
    full_script:
      "This story finally has something specific to judge. PCGamesN says Valorant's new Vanguard update seems to be bricking cheaters' PCs. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(prepared.canonical_subject, "Valorant");
  assert.equal(prepared.canonical_game, "Valorant");
  assert.equal(prepared.public_title, "Valorant's Vanguard Trust Problem");
  assert.equal(prepared.suggested_thumbnail_text, "VALORANT VANGUARD PANIC");
  assert.equal(prepared.pinned_comment, "Source: PCGamesN.");
  assert.match(prepared.full_script, /^Valorant's Vanguard update has a nasty trust problem\./);
  assert.doesNotMatch(prepared.full_script, /\bThis story\b|something specific to judge|floating headline/i);
  assert.doesNotMatch(prepared.description, /^This story:/i);
});

test("goal batch package proof preparation does not revive weak scaffold narration", () => {
  const prepared = prepareStoryForGoalProof({
    id: "rss_valor_mortis_delay",
    title: "Valor Mortis Gets Short Delay to Avoid September's Onslaught of Game Releases",
    canonical_subject: "Valor Mortis",
    canonical_game: "Valor Mortis",
    source_type: "rss",
    source_name: "IGN",
    article_url: "https://www.ign.com/articles/valor-mortis-gets-short-delay-to-avoid-septembers-onslaught-of-game-releases",
    suggested_title: "Valor Mortis Just Got A Date",
    suggested_thumbnail_text: "VALOR MORTIS",
    full_script:
      "Valor Mortis finally has something specific to judge. IGN says Valor Mortis gets a short delay. Valor Mortis now has a concrete detail players can argue with, instead of another floating headline. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(prepared.canonical_subject, "Valor Mortis");
  assert.match(prepared.full_script, /^Valor Mortis just admitted the release calendar/i);
  assert.doesNotMatch(
    prepared.full_script,
    /finally has something (?:concrete|specific) to judge|concrete detail players can argue|floating headline|platform, price or gameplay detail/i,
  );
  assert.match(prepared.full_script, /Follow Pulse Gaming so you never miss a beat\./);
});

test("goal batch package proof preparation writes concrete scripts for fresh refill categories", () => {
  const cases = [
    {
      story: {
        id: "rss_sea_of_thieves_custom_seas",
        title: "Sea of Thieves is Handing Players the Keys to the Seas",
        canonical_subject: "Sea of Thieves",
        canonical_game: "Sea of Thieves",
        source_type: "rss",
        source_name: "Xbox Wire",
        article_url: "https://news.xbox.com/en-us/2026/06/19/sea-of-thieves-custom-seas-update-details/",
        full_script:
          "Sea of Thieves needs one cleaner proof point before the hype is worth trusting. Xbox Wire says Sea of Thieves is Handing Players the Keys to the Seas.",
      },
      required: [/Custom Seas|keys to the seas/i, /private|rules|server/i, /sandbox|crew/i],
    },
    {
      story: {
        id: "rss_ps_plus_leaving_july",
        title: "Here's What's Leaving the PS Plus Library in July 2026",
        canonical_subject: "PlayStation Plus",
        canonical_game: "PlayStation Plus",
        source_type: "rss",
        source_name: "IGN",
        article_url: "https://www.ign.com/articles/heres-whats-leaving-the-ps-plus-library-in-july-2026",
        full_script:
          "PlayStation Plus needs one cleaner proof point before the hype is worth trusting. IGN says Here's What's Leaving the PS Plus Library in July 2026.",
      },
      required: [/PlayStation Plus/i, /leaving|library/i, /finish|download|save file|backlog/i],
    },
    {
      story: {
        id: "rss_xbox_exclusive_label",
        title: "Xbox's Confusing Exclusivity Criteria Now Aided by 'EXCLUSIVE' Label on Console Dashboard",
        canonical_subject: "Xbox",
        canonical_game: "Xbox",
        source_type: "rss",
        source_name: "IGN",
        article_url:
          "https://www.ign.com/articles/xboxs-confusing-exclusivity-criteria-now-aided-by-exclusive-label-on-console-dashboard",
        full_script:
          "Xbox needs one cleaner proof point before the hype is worth trusting. IGN says Xbox's confusing exclusivity criteria now has an EXCLUSIVE label.",
      },
      required: [/exclusive label|dashboard/i, /confusing|clarity|promise/i, /PlayStation|PC|console/i],
    },
  ];

  for (const item of cases) {
    const prepared = prepareStoryForGoalProof(item.story, { allowOwnedMotionFallback: true });
    assert.doesNotMatch(
      prepared.full_script,
      /needs one cleaner proof point|source is real|missing detail|treat it as early movement|wait for the proof/i,
    );
    for (const required of item.required) assert.match(prepared.full_script, required);
    assert.match(prepared.full_script, /Follow Pulse Gaming so you never miss a beat\./);
    assert.equal(evaluateGoalPublicCopy({
      ...prepared,
      selected_title: prepared.public_title,
      thumbnail_headline: prepared.thumbnail_headline,
      narration_script: prepared.full_script,
      first_spoken_line: prepared.first_spoken_line,
    }).verdict, "pass");
    assert.equal(
      buildViralScriptIntelligence({
        story: { ...prepared, title: prepared.public_title },
        script: prepared.full_script,
      }).verdict,
      "viral_ready",
    );
  }
});

test("goal batch package proof preparation quarantines malformed generated refill titles", () => {
  const prepared = prepareStoryForGoalProof({
    id: "rss_bad_refill_title",
    title: 'Brendan "PlayerUnknown" Greene "moves forward Has A Price Timing Risk',
    source_type: "rss",
    source_name: "Major Gaming Outlet",
    article_url: "https://example.com/gaming/bad-refill-title",
    freshness_gate: "pass",
    full_script:
      'Brendan "PlayerUnknown" Greene "moves forward Has A Price Timing Risk. Major Gaming Outlet says this is a developing story. Follow Pulse Gaming so you never miss a beat.',
  });

  assert.equal(prepared.canonical_subject, "This Game");
  assert.doesNotMatch(prepared.public_title, /moves forward|Price Timing Risk|PlayerUnknown/i);
  assert.match(prepared.full_script, /needs a clearer name before the take is worth trusting/i);
  assert.doesNotMatch(prepared.full_script, /just changed the value question/i);

  const pack = buildGoalProofPackage({ story: prepared });
  assert.equal(pack.script_scorecard.verdict, "rewrite_required");
  assert.ok(pack.acceptance_entry.blockers.includes("script:rewrite_required"));
});

test("goal batch package proof preparation rejects cross-story contaminated scripts", () => {
  const prepared = prepareStoryForGoalProof({
    id: "rss_dragons_dogma_contaminated",
    title: "Dragon's Dogma 2 gets first of 2 major updates ahead of Dark Arisen DLC",
    source_type: "rss",
    source_name: "Polygon",
    article_url: "https://www.polygon.com/dragons-dogma-2-june-2026-update-fast-travel-fix/",
    suggested_title: "Forza's Xbox Moment",
    suggested_thumbnail_text: "XBOX NEEDED THIS",
    full_script:
      "Forza just gave Xbox the headline it badly needed. Polygon says Forza Horizon 6 has moved to the top of Metacritic's 2026 list. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(prepared.canonical_subject, "Dragon's Dogma 2");
  assert.equal(prepared.canonical_game, "Dragon's Dogma 2");
  assert.doesNotMatch(prepared.public_title, /forza/i);
  assert.doesNotMatch(prepared.public_title, /expensive|subscription|metacritic/i);
  assert.equal(prepared.public_title, "Dragon's Dogma 2 Has One Dark Arisen Test");
  assert.doesNotMatch(prepared.full_script, /Forza Horizon 6|Metacritic's 2026 list/i);
  assert.match(prepared.full_script, /Dragon's Dogma 2/i);
  assert.match(prepared.full_script, /Polygon says the first of two major updates is arriving/i);
});

test("goal batch package proof titles ignore stale script cues from other stories", () => {
  const prepared = prepareStoryForGoalProof({
    id: "rss_elder_scrolls_contaminated",
    title: "The Elder Scrolls 6 gets a disappointing update from Xbox chief",
    source_type: "rss",
    source_name: "PC Gamer",
    article_url: "https://www.pcgamer.com/games/rpg/the-elder-scrolls-6-xbox-chief-update/",
    suggested_title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
    full_script:
      "GTA 5 just entered the subscription waiting room. PC Gamer says GTA 5 joins a subscription ahead of GTA 6 launch. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(prepared.canonical_subject, "The Elder Scrolls 6");
  assert.equal(prepared.public_title, "The Elder Scrolls 6 Just Dropped A New Clue");
  assert.doesNotMatch(prepared.public_title, /GTA|subscription|expensive/i);
  assert.doesNotMatch(prepared.full_script, /GTA 5|GTA 6|subscription waiting room/i);
});

test("goal batch package proof preparation writes story-specific current scored scripts", () => {
  const cases = [
    {
      name: "Dragon's Dogma 2",
      story: {
        id: "rss_dragons_dogma_update",
        title: "Dragon's Dogma 2 gets first of 2 major updates ahead of Dark Arisen DLC",
        source_type: "rss",
        source_name: "Polygon",
        article_url: "https://www.polygon.com/dragons-dogma-2-june-2026-update-fast-travel-fix/",
        full_script:
          "Forza just gave Xbox the headline it badly needed. Metacritic says Forza Horizon 6 moved up.",
      },
      required: [/Dragon's Dogma 2/i, /major updates/i, /fast travel|pain point|Dark Arisen/i],
    },
    {
      name: "The Elder Scrolls 6",
      story: {
        id: "rss_elder_scrolls_update",
        title: "The Elder Scrolls 6 gets a disappointing update from Xbox chief",
        source_type: "rss",
        source_name: "PC Gamer",
        article_url: "https://www.pcgamer.com/games/rpg/the-elder-scrolls-6-xbox-chief-update/",
        full_script:
          "GTA 5 just entered the subscription waiting room. PC Gamer says GTA 5 joins a subscription ahead of GTA 6 launch.",
      },
      required: [/The Elder Scrolls 6/i, /Xbox chief|reveal|silence|fans/i],
    },
    {
      name: "Gears Of War: E-Day",
      story: {
        id: "rss_gears_current",
        title: "Everything We Know About Gears Of War: E-Day, Xbox's Big Exclusive For 2026",
        source_type: "rss",
        source_name: "Kotaku",
        article_url:
          "https://kotaku.com/everything-we-know-about-gears-of-war-e-day-xboxs-big-exclusive-for-2026-2000705633",
        full_script:
          "Everything We Know About Gears Of War: E-Day, Xbox's Big Exclusive For 2026's paid crowd just sent a loud warning.",
      },
      required: [/Gears Of War: E-Day/i, /Xbox exclusive|2026|prequel|why/i],
    },
    {
      name: "Fable",
      story: {
        id: "rss_fable_delay",
        title: "Fable Reboot Delay Was Disappointing To The Devs, But Avoiding GTA 6 Makes Sense",
        source_type: "rss",
        source_name: "GameSpot",
        article_url: "https://www.gamespot.com/articles/fable-reboot-delay-was-disappointing-to-the-devs-but-avoiding-gta-6-makes-sense/",
        full_script: "Fable has a date update. Follow Pulse Gaming so you never miss a beat.",
      },
      required: [/Fable/i, /GTA 6/i, /debate|argument|judged on its own terms/i],
    },
    {
      name: "Nintendo",
      story: {
        id: "rss_nintendo_scalpers",
        title: "Nintendo fights scalpers with new Nintendo Switch 2 buying restrictions",
        source_type: "rss",
        source_name: "Polygon",
        article_url: "https://www.polygon.com/nintendo-switch-2-scalper-buying-restrictions/",
        full_script: "Nintendo now has footage to judge: pace, readability and whether the moment-to-moment play has weight.",
      },
      required: [/Nintendo/i, /scalpers|restrictions|playtime|real fans/i],
    },
    {
      name: "Forza Horizon 6 save warning",
      story: {
        id: "rss_forza_save_warning",
        title: "Forza Horizon 6 players advised to apply new patch to avoid losing save data and progress",
        source_type: "rss",
        source_name: "Eurogamer",
        article_url: "https://www.eurogamer.net/forza-horizon-6-lost-save-issues",
        full_script:
          "Forza Horizon 6 is getting a content push that has to prove it is more than maintenance.",
      },
      title: "Forza Horizon 6 Has A Save-Wipe Warning",
      required: [/save data and progress/i, /progress loss/i, /garage|tune|rare unlock/i],
    },
  ];

  for (const item of cases) {
    const prepared = prepareStoryForGoalProof(item.story);
    if (item.title) assert.equal(prepared.public_title, item.title, item.name);
    for (const required of item.required) {
      assert.match(prepared.full_script, required, item.name);
    }
    assert.match(prepared.full_script, /Follow Pulse Gaming so you never miss a beat\./, item.name);
    assert.doesNotMatch(
      prepared.full_script,
      /strangest pitch|sharper entry point|change a real player choice|buy, wait, reinstall or skip|repackages something familiar|moment-to-moment play has weight/i,
      item.name,
    );
  }
});

test("goal batch package proof preparation resolves current franchise subjects from titles", () => {
  const halo = prepareStoryForGoalProof({
    id: "rss_halo_remake",
    title: "I watched the new Halo remake gameplay, then replayed the original to nitpick the differences",
    source_type: "rss",
    source_name: "PC Gamer",
    article_url:
      "https://www.pcgamer.com/games/fps/i-watched-the-new-halo-remake-gameplay-then-replayed-the-original-to-nitpick-the-differences/",
    full_script:
      "This Game is the name to watch here. Follow Pulse Gaming so you never miss a beat.",
  });
  const gears = prepareStoryForGoalProof({
    id: "rss_gears_e_day",
    title: "Everything We Know About Gears Of War: E-Day, Xbox's Big Exclusive For 2026",
    source_type: "rss",
    source_name: "Kotaku",
    article_url:
      "https://kotaku.com/everything-we-know-about-gears-of-war-e-day-xboxs-big-exclusive-for-2026-2000705633",
    full_script:
      "Everything We Know About Gears Of War: E-Day, Xbox's Big Exclusive For 2026's paid crowd just sent a loud warning. Follow Pulse Gaming so you never miss a beat.",
  });
  const enginefall = prepareStoryForGoalProof({
    id: "rss_enginefall_preview",
    title: "Enginefall preview: Snowpiercer meets Rust is the most innovative survival game in years",
    source_type: "rss",
    source_name: "Polygon",
    article_url: "https://www.polygon.com/enginefall-preview",
    canonical_subject: "Enginefall preview",
    full_script:
      "Enginefall preview has the one kind of reveal fans cannot hand-wave: actual play. Follow Pulse Gaming so you never miss a beat.",
  });
  const penguin = prepareStoryForGoalProof({
    id: "rss_penguin_colony_demo",
    title: "Penguin Colony's demo shows life as a flightless bird is lonely, scary, awkward, and cosmically intriguing",
    source_type: "rss",
    source_name: "Rock Paper Shotgun",
    article_url: "https://www.rockpapershotgun.com/penguin-colony-demo",
    canonical_subject: "Penguin Colony's demo",
    full_script:
      "Penguin Colony's demo has the one kind of reveal fans cannot hand-wave: actual play. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(halo.canonical_subject, "Halo: Campaign Evolved");
  assert.doesNotMatch(halo.full_script, /^This Game is the name to watch here/i);
  assert.equal(gears.canonical_subject, "Gears Of War: E-Day");
  assert.match(gears.full_script, /Gears Of War: E-Day/i);
  assert.doesNotMatch(gears.full_script, /paid crowd|Steam player spike/i);
  assert.equal(enginefall.canonical_subject, "Enginefall");
  assert.equal(penguin.canonical_subject, "Penguin Colony");
});

test("goal batch package proof preparation repairs current scored story subjects, titles and scripts", () => {
  const cases = [
    {
      story: {
        id: "rss_resident_evil_code_veronica",
        title:
          "Despite its trailer, Capcom says its Resident Evil - Code: Veronica remake is third-person and taking its cue from Resident Evil 2",
        source_type: "rss",
        source_name: "Eurogamer",
        article_url: "https://www.eurogamer.net/resident-evil-veronica-first-person",
        full_script:
          "Forza just gave Xbox the headline it badly needed. Polygon says Forza Horizon 6 has moved to the top of Metacritic's 2026 list.",
      },
      subject: "Resident Evil Code: Veronica",
      title: "Code Veronica Just Answered The Camera Question",
      required: [/third-person/i, /Resident Evil 2/i, /first-person trailer/i],
      forbidden: /Forza Horizon 6|Metacritic/i,
    },
    {
      story: {
        id: "rss_valor_mortis_delay",
        title:
          "September Is So Busy For Games That One Of Them Just Got Delayed To Avoid The Others (And GTA 6)",
        source_type: "rss",
        source_name: "GameSpot",
        article_url:
          "https://www.gamespot.com/articles/september-is-so-busy-for-games-that-one-of-them-just-got-delayed-to-avoid-the-others-and-gta-6/",
        description:
          "Developer One More Level delayed Valor Mortis from September 24 to October 13 after the release calendar became crowded.",
        full_script:
          "GTA 6 just blinked in one of the year's most crowded release windows. Follow Pulse Gaming so you never miss a beat.",
      },
      subject: "Valor Mortis",
      title: "Valor Mortis Just Dodged September",
      required: [/September 24/i, /October 13/i, /crowded/i],
      forbidden: /^GTA 6 just blinked/i,
    },
    {
      story: {
        id: "rss_quake_champions_update",
        title:
          "Quake Champions gets a huge update and free battle pass to celebrate the 30th anniversary of Quake",
        source_type: "rss",
        source_name: "PC Gamer",
        article_url:
          "https://www.pcgamer.com/games/fps/quake-champions-gets-a-huge-update-and-free-battle-pass-to-celebrate-the-30th-anniversary-of-quake/",
        full_script:
          "Quake Champions finally has something specific to judge. PC Gamer says Quake Champions gets a huge update. Follow Pulse Gaming so you never miss a beat.",
      },
      subject: "Quake Champions",
      title: "Quake Champions Is Testing A Comeback",
      required: [/free battle pass/i, /30th birthday|30th anniversary/i, /arena/i],
      forbidden: /matchmaking|hit queue|something specific to judge/i,
    },
    {
      story: {
        id: "rss_gta5_subscription",
        title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
        source_type: "rss",
        source_name: "GameSpot",
        article_url:
          "https://www.gamespot.com/articles/gta-5-joins-a-subscription-ahead-of-gta-6-launch/",
        full_script:
          "GTA 5 just became the GTA 6 waiting room. GameSpot reports GTA 5 has joined a subscription service ahead of GTA 6. Follow Pulse Gaming so you never miss a beat.",
      },
      subject: "GTA 5",
      title: "GTA 5 Became The GTA 6 Waiting Room",
      required: [/subscription/i, /GTA 6/i],
      forbidden: /More Expensive/i,
    },
    {
      story: {
        id: "rss_elder_scrolls_current",
        title: "The Elder Scrolls 6 gets disappointing update from Xbox chief",
        source_type: "rss",
        source_name: "Polygon",
        article_url: "https://www.polygon.com/the-elder-scrolls-6-release-xbox-matt-booty/",
        full_script:
          "Forza just gave Xbox the headline it badly needed. Polygon says Forza Horizon 6 has moved to the top of Metacritic's 2026 list.",
      },
      subject: "The Elder Scrolls 6",
      title: "The Elder Scrolls 6 Just Dropped A New Clue",
      required: [/words without proof/i, /re-reveal/i, /silence is ending/i],
      forbidden: /The debate is whether|Forza Horizon 6|Metacritic/i,
    },
    {
      story: {
        id: "rss_runescape_dragonwilds",
        title:
          "Ahead of its 1.0 launch, RuneScape: Dragonwilds fits in one more, scorching hot update later this month",
        source_type: "rss",
        source_name: "Rock Paper Shotgun",
        article_url:
          "https://www.rockpapershotgun.com/ahead-of-its-10-launch-runescape-dragonwilds-fits-in-one-more-scorching-hot-update-later-this-month",
        full_script:
          "Subnautica 2 just got a score its publisher can market hard. Follow Pulse Gaming so you never miss a beat.",
      },
      subject: "RuneScape: Dragonwilds",
      title: "Dragonwilds Has One Last Early Access Test",
      required: [/1\.0 launch/i, /update/i, /Early Access/i],
      forbidden: /Subnautica 2|review score/i,
    },
  ];

  for (const item of cases) {
    const prepared = prepareStoryForGoalProof(item.story);
    assert.equal(prepared.canonical_subject, item.subject);
    assert.equal(prepared.canonical_game, item.subject);
    assert.equal(prepared.public_title, item.title);
    for (const pattern of item.required) assert.match(prepared.full_script, pattern);
    assert.doesNotMatch(prepared.full_script, item.forbidden);
    assert.match(prepared.full_script, /Follow Pulse Gaming so you never miss a beat\./);
    assert.equal(evaluateGoalPublicCopy({
      ...prepared,
      selected_title: prepared.public_title,
      thumbnail_headline: prepared.thumbnail_headline,
      narration_script: prepared.full_script,
      first_spoken_line: prepared.first_spoken_line,
    }).verdict, "pass");
  }
});

test("goal batch package platform packs do not revive stale identity CTAs", () => {
  const batch = buildGoalBatchPackages({
    stories: [
      {
        id: "1tkik53",
        title:
          "Valorant's new Vanguard update seems to be bricking cheaters' PCs. Riot's response? \"Congrats on your $6k paperweights\"",
        canonical_subject: "This story",
        source_type: "rss",
        source_name: "PCGamesN",
        article_url: "https://www.pcgamesn.com/valorant/vanguard-update-bricking-pcs-riot-response",
        suggested_thumbnail_text: "VANGUARD PANIC",
        full_script:
          "This story finally has something specific to judge. PCGamesN says Valorant's new Vanguard update seems to be bricking cheaters' PCs. Follow Pulse Gaming so you never miss a beat.",
      },
    ],
    generatedAt: "2026-05-31T01:05:00.000Z",
  });

  const youtubePack = batch.packages[0].platform_publish_manifest.outputs.youtube_shorts;
  assert.equal(youtubePack.cta, "Follow Pulse Gaming so you never miss a beat.");
  assert.doesNotMatch(JSON.stringify(youtubePack), /gaming stories behind the headline/i);
});

test("goal batch packages preserve fresh intake source objects and selected titles", () => {
  const story = {
    id: "fresh_xbox_halo_campaign_evolved_demo_20260610",
    title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    freshness_gate: "pass",
    primary_source: {
      name: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
      type: "official_platform_news",
    },
    source_type: "official_platform_news",
    full_script:
      "Halo: Campaign Evolved finally has a real remake test. Xbox Wire says the hands-on demo shows how the campaign is being rebuilt rather than simply repackaged. The pressure point is simple: fans can forgive nostalgia, but only if the new combat rhythm still feels like Halo. Follow Pulse Gaming so you never miss a beat.",
  };

  const prepared = prepareStoryForGoalProof(story, { allowOwnedMotionFallback: true });
  const batch = buildGoalBatchPackages({
    stories: [story],
    generatedAt: "2026-06-12T00:10:00.000Z",
    allowOwnedMotionFallback: true,
  });
  const serialised = JSON.stringify(batch.packages[0]);

  assert.equal(prepared.primary_source, "Xbox Wire");
  assert.equal(prepared.article_url, "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/");
  assert.equal(prepared.public_title, "Halo: Campaign Evolved Shows The Real Remake Test");
  assert.equal(batch.packages[0].canonical_story_manifest.primary_source, "Xbox Wire");
  assert.equal(batch.packages[0].canonical_story_manifest.short_title, "Halo: Campaign Evolved Shows The Real Remake Test");
  assert.doesNotMatch(serialised, /\[object Object\]/);
});

test("goal batch packages keep fresh cover headlines subject-safe and avoid weak title fallbacks", () => {
  const batch = buildGoalBatchPackages({
    stories: [
      {
        id: "fresh_xbox_minecraft_dungeons_ii_20260610",
        title: "Minecraft Dungeons II Is Xbox's Quiet Co-Op Power Play",
        canonical_subject: "Minecraft Dungeons II",
        canonical_game: "Minecraft Dungeons II",
        freshness_gate: "pass",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/10/minecraft-dungeons-2-arpg-details-demo-xbox-games-showcase-2026/",
        },
        thumbnail_headline: "XBOX'S CO-OP BET",
        full_script:
          "Minecraft Dungeons II just made Xbox's co-op pitch more interesting. Xbox Wire says the sequel supports local multiplayer, online friends and matchmaking across major platforms. That matters because Game Pass only helps if the game also works where families and friend groups already play. Follow Pulse Gaming so you never miss a beat.",
      },
      {
        id: "fresh_xbox_alien_isolation_2_20260610",
        title: "Alien: Isolation 2 Is Being Judged On The One Thing It Cannot Fake",
        canonical_subject: "Alien: Isolation 2",
        canonical_game: "Alien: Isolation 2",
        freshness_gate: "pass",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/10/alien-isolation-2-poised-to-deliver-another-bold-chapter/",
        },
        thumbnail_headline: "CAN IT STILL SCARE?",
        full_script:
          "Alien: Isolation 2 has one test it cannot fake. Xbox Wire says Creative Assembly showed the prologue and talked through the sequel's design at Summer Game Fest. The player impact is obvious: if the creature is predictable, the whole promise collapses. Follow Pulse Gaming so you never miss a beat.",
      },
    ],
    generatedAt: "2026-06-12T00:20:00.000Z",
  });

  const minecraft = batch.packages[0].canonical_story_manifest;
  const alien = batch.packages[1].canonical_story_manifest;

  assert.match(minecraft.thumbnail_headline, /Minecraft Dungeons II/i);
  assert.equal(alien.short_title, "Alien: Isolation 2 Has One Fear Test");
  assert.doesNotMatch(alien.short_title, /Just Got A New Signal/i);
});

test("goal batch packages repair fragment subjects before public packaging", () => {
  const rows = [
    {
      id: "steam-controller-fragment",
      title: "Steam Controller demand just got a reservation update after high demand",
      canonical_subject: "Steam Controller demand",
      canonical_game: "Steam Controller demand",
      source_type: "rss",
      source_name: "Eurogamer",
      article_url: "https://www.eurogamer.net/steam-controller-reservation-update-high-demand",
      full_script:
        "Steam Controller demand just turned into a waiting list problem. Eurogamer reports high reservation demand after the update. Follow Pulse Gaming so you never miss a beat.",
    },
    {
      id: "pubg-now-fragment",
      title: "PUBG now has GenAI team mates capable of intelligent decision-making",
      canonical_subject: "PUBG now",
      canonical_game: "PUBG now",
      source_type: "rss",
      source_name: "RockPaperShotgun",
      article_url: "https://www.rockpapershotgun.com/pubg-genai-team-mates",
      full_script:
        "PUBG now has GenAI team mates that change the squad fantasy. Rock Paper Shotgun reports the new AI teammate detail. Follow Pulse Gaming so you never miss a beat.",
    },
  ];

  const batch = buildGoalBatchPackages({
    stories: rows,
    generatedAt: "2026-06-20T03:00:00.000Z",
  });

  const subjects = batch.packages.map((pack) => pack.canonical_story_manifest.canonical_subject);
  const titles = batch.packages.map((pack) => pack.youtube_publish_pack.title);
  assert.deepEqual(subjects, ["Steam Controller", "PUBG"]);
  assert.match(titles[0], /Steam Controller/i);
  assert.doesNotMatch(titles[0], /Steam Controller demand/i);
  assert.match(titles[1], /PUBG Has An AI Teammate Risk/i);
  assert.doesNotMatch(titles[1], /PUBG now/i);
});

test("goal batch packages make generic gameplay reveal scripts source-specific enough for transcript gates", () => {
  const batch = buildGoalBatchPackages({
    stories: [
      {
        id: "rss_resonance_gameplay",
        title: "Resonance: A Plague Tale Legacy Combat and Exploration Gameplay",
        source_type: "rss",
        freshness_gate: "pass",
        primary_source: {
          name: "GameSpot",
          url: "https://www.gamespot.com/articles/resonance-a-plague-tale-legacy-combat-and-exploration-gameplay/1100-6532891/",
          type: "gaming_press",
        },
        source_published_at: "2026-06-24T09:00:00.000Z",
      },
    ],
    generatedAt: "2026-06-24T10:00:00.000Z",
  });

  const pack = batch.packages[0];
  const manifest = pack.canonical_story_manifest;
  const script = manifest.narration_script || manifest.full_script || "";

  assert.equal(pack.script_scorecard.verdict, "viral_ready", pack.script_scorecard.blockers.join(", "));
  assert.match(script, /Resonance/i);
  assert.match(script, /camera|hit timing|enemy pressure|readable/i);
  assert.match(script, /If\b.*\b(?:busy|launch|warning|argument)/i);
  assert.doesNotMatch(script, /actual play|Players can finally judge|specifics on screen|promising trailer|trust at launch/i);
  assert.ok(!pack.script_scorecard.blockers.includes("missing_story_specific_payoff"), JSON.stringify(pack.script_scorecard));
  assert.ok(!pack.script_scorecard.blockers.includes("generic_player_test_template"), JSON.stringify(pack.script_scorecard));
});

test("goal batch packages generate viewer-facing scripts for current official RSS proof stories", () => {
  const batch = buildGoalBatchPackages({
    stories: [
      {
        id: "rss_granblue_demo",
        title: "Granblue Fantasy: Relink - Endless Ragnarok hands-on report, demo available today",
        source_type: "rss",
        freshness_gate: "pass",
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
          type: "official_platform",
        },
        source_published_at: "2026-06-18T12:00:08.000Z",
      },
      {
        id: "rss_super_yooka_kart_preview",
        title: "Super Yooka-Laylee Kart Preview: Ex-Rare Devs Take Aim at Reviving the Spirit of Diddy Kong Racing",
        source_type: "rss",
        freshness_gate: "pass",
        primary_source: {
          name: "IGN",
          url: "https://www.ign.com/articles/super-yooka-laylee-kart-preview-ex-rare-devs-take-aim-at-reviving-the-spirit-of-diddy-kong-racing",
          type: "gaming_press",
        },
        source_published_at: "2026-06-21T19:00:00.000Z",
      },
      {
        id: "rss_ea_fc_26_ea_play",
        title: "EA SPORTS FC 26 Is Now on EA Play",
        source_type: "rss",
        freshness_gate: "pass",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/18/ea-play-fc-26/",
          type: "official_platform",
        },
        source_published_at: "2026-06-18T17:00:00.000Z",
      },
      {
        id: "rss_dave_diver_jungle",
        title: "Why You Should Follow Dave the Diver to the Jungle in New DLC Today",
        source_type: "rss",
        freshness_gate: "pass",
        primary_source: {
          name: "Xbox Wire",
          url: "https://news.xbox.com/en-us/2026/06/18/dave-the-diver-in-the-jungle-out-now/",
          type: "official_platform",
        },
        source_published_at: "2026-06-18T14:00:00.000Z",
      },
      {
        id: "rss_planet_crafter_ps5",
        title: "The Planet Crafter launches on PS5 July 21",
        source_type: "rss",
        freshness_gate: "pass",
        primary_source: {
          name: "PlayStation Blog",
          url: "https://blog.playstation.com/2026/06/16/the-planet-crafter-launches-on-ps5-july-21/",
          type: "official_platform",
        },
        source_published_at: "2026-06-16T13:00:13.000Z",
      },
    ],
    generatedAt: "2026-06-19T01:20:00.000Z",
  });

  for (const pack of batch.packages) {
    const manifest = pack.canonical_story_manifest;
    const script = manifest.narration_script || manifest.full_script || "";
    assert.equal(pack.script_scorecard.verdict, "viral_ready", `${manifest.story_id}: ${pack.script_scorecard.blockers}`);
    assert.doesNotMatch(manifest.short_title, /Just Got A New Signal|New Reason To Watch|Real Question/i);
    assert.doesNotMatch(script, /should stay in review|source says|the hook is|the signal is|for fans to argue about|PlayStation Blog says .*hands-on report|Xbox Wire says .*Is Now on EA Play/i);
    assert.match(script, /Follow Pulse Gaming so you never miss a beat\.$/);
  }

  const granblue = batch.packages.find((pack) => pack.canonical_story_manifest.story_id === "rss_granblue_demo");
  assert.equal(granblue.youtube_publish_pack.cover_frame.headline, "RELINK PLAYABLE DEMO");
  assert.ok(!granblue.platform_publish_manifest.platform_native_evidence.failures.some(
    (failure) => failure.reason === "weak_cover_headline",
  ));

  const yooka = batch.packages.find((pack) => pack.canonical_story_manifest.story_id === "rss_super_yooka_kart_preview");
  assert.equal(yooka.youtube_publish_pack.title, "Yooka-Laylee Kart Has A Diddy Kong Risk");
  assert.match(yooka.canonical_story_manifest.narration_script, /Diddy Kong Racing worked because it felt like an adventure/i);
  assert.match(yooka.canonical_story_manifest.narration_script, /The catch is handling/i);
  assert.match(yooka.canonical_story_manifest.narration_script, /If the handling has bite/i);
  assert.match(yooka.canonical_story_manifest.description, /handling proves nostalgia/i);
  assert.ok(
    yooka.claim_inventory.confirmed.some((claim) => /handling[\s\S]*proves[\s\S]*nostalgia/i.test(claim)),
    JSON.stringify(yooka.claim_inventory),
  );
  assert.doesNotMatch(yooka.canonical_story_manifest.narration_script, /finally judge|specifics on screen|trust at launch/i);
  assert.ok(!yooka.script_scorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(yooka.script_scorecard));
  assert.ok(!yooka.platform_publish_manifest.platform_native_evidence.failures.some(
    (failure) => failure.reason === "plain_platform_description",
  ));
  assert.ok(!yooka.pulse_media_house_score.hard_failures.includes("media_house:platform_copy_too_plain"));
  assert.ok(!yooka.pulse_media_house_score.hard_failures.includes("media_house:shorts_feed_competition_weak"));
});

test("goal batch package proof preparation replaces article excerpt descriptions with Shorts payoff copy", () => {
  const prepared = prepareStoryForGoalProof({
    id: "rss_granblue_demo_excerpt",
    title: "Granblue Fantasy: Relink - Endless Ragnarok hands-on report, demo available today",
    source_type: "rss",
    freshness_gate: "pass",
    canonical_subject: "Granblue Fantasy: Relink",
    canonical_game: "Granblue Fantasy: Relink",
    primary_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
      type: "official_platform",
    },
    source_published_at: "2026-06-18T12:00:08.000Z",
    confirmed_claims: [
      "PlayStation Blog says Granblue Fantasy: Relink - Endless Ragnarok has a playable demo available ahead of launch.",
    ],
    description:
      "Set to touch down on PlayStation 5 and PlayStation 4 on Thursday, July 9, Granblue Fantasy: Relink - Endless Ragnarok is a massive new expansion built to significantly evolve the high-flying action RPG that first captivated players in 2024.",
    full_script:
      "Granblue Fantasy: Relink just made its next update much harder to ignore. PlayStation Blog says Endless Ragnarok now has a playable demo after a new hands-on preview. Players can try the combat rhythm, party builds and boss pressure, then decide whether the grind is worth coming back for. If the demo makes the endgame loop feel sharper, Relink gets a second wind. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.doesNotMatch(prepared.description, /Set to touch down|massive new expansion|captivated players in 2024/i);
  assert.match(prepared.description, /^Granblue Fantasy: Relink just made its next update much harder to ignore\./);
  assert.match(prepared.description, /Players can try the combat rhythm/i);
  assert.match(prepared.description, /second wind/i);
  assert.match(prepared.description, /Source: PlayStation Blog\.$/);
});

test("goal batch packages avoid double-prefixing distinctive thumbnail subject tokens", () => {
  const prepared = prepareStoryForGoalProof({
    id: "fresh_ps_resident_evil_veronica_20260608",
    title: "Resident Evil Veronica Just Got The Camera Detail That Matters",
    canonical_subject: "Resident Evil Veronica",
    canonical_game: "Resident Evil Veronica",
    freshness_gate: "pass",
    primary_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/2026/06/08/summer-game-fest-2026-hands-on-and-more-details-on-11-upcoming-ps5-games/",
    },
    thumbnail_headline: "VERONICA'S REAL CLUE",
    full_script:
      "Resident Evil Veronica just got the detail that matters more than the announcement trailer. PlayStation Blog says Capcom confirmed the remake is third-person. That tells players what kind of fear Capcom is chasing. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(prepared.thumbnail_headline, "VERONICA'S REAL CLUE");
  assert.doesNotMatch(prepared.thumbnail_headline, /VERONICA\s+VERONICA/i);
});

test("goal batch packages write per-story artefacts and goal-contract story packages", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-goal-batch-"));
  const ready = greenStory("green-one");
  const batch = buildGoalBatchPackages({
    stories: [ready],
    rightsLedgerByStory: { [ready.id]: rightsFor(ready) },
    generatedAt: "2026-05-21T20:10:00.000Z",
  });

  const written = await writeGoalBatchPackages(batch, {
    outputDir: path.join(tmp, "packages"),
    contractOutDir: path.join(tmp, "goal-contract"),
  });

  assert.equal(await fs.pathExists(path.join(tmp, "packages", "green-one", "script_scorecard.json")), true);
  assert.equal(await fs.pathExists(path.join(tmp, "goal-contract", "story-packages.json")), true);
  assert.equal((await fs.readJson(written.storyPackagesPath))[0].verdict, "GREEN");
});

test("goal batch packages can fill audit candidates from revenue paths without marking them ready", () => {
  const stories = augmentStoriesWithRevenuePaths(
    [{ id: "existing", title: "Existing Story" }],
    {
      top_paths: [
        { story_id: "existing", title: "Existing Story" },
        { story_id: "revenue-one", title: "Forza Horizon 6" },
        { story_id: "revenue-two", title: "Steam Deck OLED" },
      ],
    },
    3,
  );

  assert.deepEqual(stories.map((story) => story.id), ["existing", "revenue-one", "revenue-two"]);
  assert.equal(stories[1].source_type, "revenue_path_candidate");
  assert.equal(stories[1].full_script, "");
});

test("goal batch package revenue fallback can be disabled for targeted repair runs", () => {
  const stories = augmentStoriesWithRevenuePaths(
    [{ id: "target", title: "Target Story" }],
    {
      top_paths: [
        { story_id: "target", title: "Target Story" },
        { story_id: "unrelated", title: "Unrelated Story" },
      ],
    },
    3,
    { fillRevenuePaths: false },
  );

  assert.deepEqual(stories.map((story) => story.id), ["target"]);
});

test("goal batch packages hydrate revenue stubs from per-story commercial manifests", () => {
  const stories = augmentStoriesWithRevenuePaths(
    [],
    {
      top_paths: [
        {
          story_id: "1thsxw7",
          title: "Forza Horizon 6",
          commercial_intent_type: "racing_game_setup",
          route: "/p/forza-horizon-6-just-broke-xbox-s-steam-ceiling",
          revenue_manifest: {
            title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
            landing_page: {
              source_links: [
                {
                  label: "Source",
                  url: "https://thephrasemaker.com/2026/05/19/forza-horizon-6-is-already-a-massive-success/",
                },
                {
                  label: "Reddit discussion",
                  url: "https://reddit.com/r/pcmasterrace/comments/1thsxw7/forza_horizon_6_achieved_a_peak_of_over_273k/",
                },
              ],
            },
            disclosure: {
              required: true,
              copy: { short: "Affiliate links may earn us a commission." },
            },
            offer_stack: {
              primary_offer: {
                label: "Racing wheel",
                product_category: "racing wheel",
                tracking_url: "/go/1thsxw7/racing-wheel-racing-wheel-ps5-xbox-pc?platform=story_page&cta=racing%20wheel",
              },
            },
          },
        },
      ],
    },
    1,
  );

  const prepared = prepareStoryForGoalProof(stories[0]);

  assert.equal(stories[0].title, "Forza Horizon 6 Just Broke Xbox's Steam Ceiling");
  assert.equal(stories[0].source_type, "rss");
  assert.equal(stories[0].article_url, "https://thephrasemaker.com/2026/05/19/forza-horizon-6-is-already-a-massive-success/");
  assert.notEqual(prepared.primary_source, "Source");
  assert.match(prepared.full_script, /Forza Horizon 6/i);
  assert.match(prepared.full_script, /The Phrasemaker/i);
  assert.notEqual(prepared.public_title, "Forza Horizon 6");
  assert.equal(prepared.affiliate_disclosure, "Affiliate links may earn us a commission.");
});

test("goal batch packages do not turn source-only stories into GREEN generated-card videos", () => {
  const raw = {
    id: "expanse-proof-motion",
    title: "The Expanse: Osiris Reborn official gameplay trailer",
    suggested_title: "The Expanse Game Finally Looks Real",
    canonical_subject: "The Expanse",
    source_name: "Xbox",
    primary_source: "Xbox",
    source_type: "official",
    article_url: "https://www.youtube.com/watch?v=official-expanse",
    suggested_thumbnail_text: "EXPANSE GAMEPLAY",
    affiliate_url: "https://www.amazon.co.uk/s?k=xbox&tag=orryy-21",
    full_script:
      "The Expanse: Osiris Reborn finally has the thing licensed games usually hide: real gameplay. Xbox showed a narrative sci-fi action game built around The Expanse universe, not just a logo and a promise. That matters because players can now judge the combat, world and Mass Effect-style pitch. But the catch is brutal: a famous licence only helps if the game actually feels worth playing. Follow Pulse Gaming so you never miss a beat.",
  };

  const prepared = prepareStoryForGoalProof(raw);
  const batch = buildGoalBatchPackages({
    stories: [raw],
    generatedAt: "2026-05-21T21:30:00.000Z",
  });

  assert.equal(prepared.video_clips.length, 0);
  assert.equal(prepared.affiliate_disclosure, "Affiliate links may earn us a commission.");
  assert.equal(batch.summary.green_count, 0);
  assert.equal(batch.summary.red_count, 1);
  assert.equal(batch.story_packages[0].verdict, "RED");
  assert.ok(batch.story_packages[0].blockers.includes("footage:v4_motion_blocked"));
});

test("goal batch packages hydrate existing Visual V4 motion packs instead of using generated cards", () => {
  const story = {
    id: "forza-rich-restore",
    title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    suggested_title: "Forza Horizon 6 Steam Peak Exposes Xbox's Early-Access Bet",
    canonical_subject: "Forza Horizon 6",
    source_name: "GamesRadar+",
    source_type: "rss",
    article_url: "https://www.gamesradar.com/forza-horizon-6-steam",
    exported_path: "output/final/forza-rich-restore.mp4",
    render_manifest: {
      final_publish_render: true,
      output_path: "output/final/forza-rich-restore.mp4",
      duration_seconds: 48.2,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
    },
    audio_path: "output/audio/forza-rich-restore.mp3",
    narration_audio_path: "output/audio/forza-rich-restore.mp3",
    timestamps_path: "output/audio/forza-rich-restore_timestamps.json",
    word_timestamps_path: "output/audio/forza-rich-restore_timestamps.json",
    word_timestamp_source: "local_whisper_word_alignment",
    word_timestamps: [
      { word: "Forza", start: 0, end: 0.28 },
      { word: "Horizon", start: 0.29, end: 0.68 },
      { word: "6", start: 0.69, end: 0.82 },
    ],
    audio_manifest: {
      voice_status: "materialized",
      narration_audio_path: "output/audio/forza-rich-restore.mp3",
      word_timestamps_path: "output/audio/forza-rich-restore_timestamps.json",
      word_timestamp_source: "local_whisper_word_alignment",
      word_timestamp_count: 3,
    },
    sfx_asset_inventory: licensedSfxAssets(),
    full_script:
      "Forza Horizon 6 just gave Xbox the paid access warning it needed. GamesRadar+ reports a major Steam peak during Premium Edition early access. The catch is whether that paid-access crowd turns into wider demand once the cheaper route opens. That split matters because a premium spike proves attention, but not long-term retention. If the standard launch holds, this becomes a real Xbox momentum story instead of a one-week Steam screenshot. Follow Pulse Gaming so you never miss a beat.",
  };
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `v4-motion-${index + 1}`,
    type: "motion_clip",
    source_family: `forza_official_gameplay_${index + 1}`,
    path: `C:\\media\\forza-rich-restore-${index + 1}.mp4`,
    source_url: `https://video.example.test/forza-rich-restore-${index + 1}.mp4`,
    source_type: "official_trailer_segment",
    rights_risk_class: "official_reference_only",
    allowed_render_use: "reference_only_by_default",
    durationS: 4.8,
    validated: true,
  }));
  const motionPack = {
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
    handoff: { visual_v4_local_motion_clips: clips },
  };

  const batch = buildGoalBatchPackages({
    stories: [story],
    motionPackByStory: { [story.id]: motionPack },
    rightsLedgerByStory: { [story.id]: rightsFor({ ...story, video_clips: clips }) },
    generatedAt: "2026-05-23T14:20:00.000Z",
  });

  const pack = batch.packages[0];
  assert.equal(pack.footage_inventory.readiness.status, "v4_motion_ready");
  assert.equal(pack.footage_inventory.motion_inventory.accepted_local_clips.length, 5);
  assert.equal(pack.footage_inventory.motion_inventory.accepted_local_clips[0].source_type, "official_trailer_segment");
  assert.equal(pack.acceptance_entry.verdict, "GREEN");
  assert.equal(batch.summary.green_count, 1);
});

test("goal batch packages create rights records for restored official V4 motion clips", () => {
  const story = {
    id: "granblue-official-restore",
    title: "Granblue Fantasy: Relink Demo Is The Real Proof",
    suggested_title: "Granblue Fantasy: Relink Demo Is The Real Proof",
    canonical_subject: "Granblue Fantasy: Relink",
    source_name: "PlayStation Blog",
    source_type: "rss",
    article_url: "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
    exported_path: "output/final/granblue-official-restore.mp4",
    render_manifest: {
      final_publish_render: true,
      output_path: "output/final/granblue-official-restore.mp4",
      duration_seconds: 45.7,
      quality_gate_status: "post_render_forensics_passed",
      post_render_forensic_result: "pass",
    },
    audio_path: "output/audio/granblue-official-restore.mp3",
    narration_audio_path: "output/audio/granblue-official-restore.mp3",
    timestamps_path: "output/audio/granblue-official-restore_timestamps.json",
    word_timestamps_path: "output/audio/granblue-official-restore_timestamps.json",
    word_timestamp_source: "local_whisper_word_alignment",
    word_timestamps: [
      { word: "Granblue", start: 0, end: 0.42 },
      { word: "Fantasy", start: 0.43, end: 0.81 },
      { word: "Relink", start: 0.82, end: 1.16 },
    ],
    audio_manifest: {
      voice_status: "materialized",
      narration_audio_path: "output/audio/granblue-official-restore.mp3",
      word_timestamps_path: "output/audio/granblue-official-restore_timestamps.json",
      word_timestamp_source: "local_whisper_word_alignment",
      word_timestamp_count: 3,
    },
    sfx_asset_inventory: licensedSfxAssets(),
    sfx_rights_ledger: licensedSfxAssets().map((asset) => ({
      ...asset,
      asset_type: "sfx",
      allowed_platforms: ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"],
      risk_score: 0.08,
      evidence_file: `rights/${asset.asset_id}.json`,
    })),
    full_script:
      "Granblue Fantasy Relink has one proof point players can judge immediately: the demo. PlayStation Blog says Endless Ragnarok adds a new story arc, playable characters and a solo endgame mode. The useful question is whether that demo makes lapsed players reinstall before launch. If it feels generous, this becomes a smart comeback. If it feels thin, the expansion has a trust problem before day one. Follow Pulse Gaming so you never miss a beat.",
  };
  const clips = Array.from({ length: 5 }, (_, index) => ({
    id: `granblue-official-window-${index + 1}`,
    type: "motion_clip",
    source_family: `playstation_blog_granblue_window_${index + 1}`,
    base_source_family: "playstation_blog_granblue",
    path: `C:\\media\\granblue-window-${index + 1}.mp4`,
    local_materialized_path: `C:\\media\\granblue-window-${index + 1}.mp4`,
    source_url: `https://vulcan.dl.playstation.net/img/rnd/202606/1802/granblue-${index + 1}.mp4`,
    source_type: "official_game_site_news_page",
    source_url_kind: "direct_video",
    rights_risk_class: "official_direct_media",
    allowed_render_use: "official_direct_media_segment_candidate",
    durationS: 3.1,
    validated: true,
    segmentValidationPassed: true,
  }));
  const motionPack = {
    readiness: { status: "v4_motion_ready", blockers: [] },
    clips,
    handoff: { visual_v4_local_motion_clips: clips },
  };

  const batch = buildGoalBatchPackages({
    stories: [story],
    motionPackByStory: { [story.id]: motionPack },
    generatedAt: "2026-06-20T10:10:00.000Z",
  });

  const pack = batch.packages[0];
  assert.equal(pack.rights_ledger.verdict, "pass");
  const restoredRights = pack.rights_ledger.records.filter(
    (record) => record.source_type === "official_game_site_news_page",
  );
  assert.equal(new Set(restoredRights.map((record) => record.asset_id)).size, 5);
  assert.equal(pack.acceptance_entry.verdict, "GREEN");
});

test("goal batch packages rewrite generic one-detail proof titles before publishing packs", () => {
  const raw = {
    id: "price-hike-proof",
    title: "PlayStation Plus Premium and Extra tiers are now more expensive too",
    suggested_title: "PlayStation Plus Has One Detail Players Should Notice",
    canonical_subject: "PlayStation Plus",
    source_name: "Eurogamer",
    primary_source: "Eurogamer",
    source_type: "rss",
    article_url: "https://www.eurogamer.net/playstation-plus-price-increase",
    suggested_thumbnail_text: "PLAYSTATION PLUS",
    full_script:
      "PlayStation Plus just gave subscribers the price warning they needed. Eurogamer says Premium and Extra tiers are now more expensive too. That matters because subscription value changes when the yearly bill moves. Follow Pulse Gaming so you never miss a beat.",
  };

  const prepared = prepareStoryForGoalProof(raw);

  assert.equal(prepared.public_title, "PlayStation Plus Just Got More Expensive");
  assert.doesNotMatch(prepared.public_title, /Has One Detail Players Should Notice/i);
});

test("goal batch packages give deal and general RSS stories non-generic tension titles", () => {
  const deal = prepareStoryForGoalProof({
    id: "star-fox-deal",
    title: "Stream as Fox McCloud in Star Fox With the Nintendo Switch 2 Camera, Now 45% Off",
    suggested_title: "Star Fox Has One Detail Players Should Notice",
    canonical_subject: "Star Fox",
    source_name: "IGN",
    source_type: "rss",
    article_url: "https://www.ign.com/articles/star-fox-camera-deal",
    full_script:
      "Star Fox just gave players the update they needed. IGN says the Nintendo Switch 2 camera is now 45% off. Follow Pulse Gaming so you never miss a beat.",
  });
  const update = prepareStoryForGoalProof({
    id: "helldivers-update",
    title: "Helldivers 2 legendary warbond arrives next week",
    suggested_title: "Helldivers 2 Has One Detail Players Should Notice",
    canonical_subject: "Helldivers 2",
    source_name: "IGN",
    source_type: "rss",
    article_url: "https://www.ign.com/articles/helldivers-2-warbond",
    full_script:
      "Helldivers 2 just gave players the update they needed. IGN says a legendary warbond arrives next week. Follow Pulse Gaming so you never miss a beat.",
  });

  assert.equal(deal.public_title, "Star Fox Deal Has One Catch");
  assert.equal(update.public_title, "Helldivers 2 Just Got A Crossover Push");
});

test("goal batch packages map common RSS angles to varied title structures", () => {
  const cases = [
    [
      "Warhammer 40,000: Chaos Gate Deathwatch Announced at Warhammer Skulls",
      "Warhammer 40,000",
      "Warhammer 40,000 Just Became Official",
    ],
    [
      "Helldivers 2 Is Getting a Warhammer 40,000 Legendary Warbond",
      "Helldivers 2",
      "Helldivers 2 Just Got A Crossover Push",
    ],
    [
      "PlayStation dynamic pricing might violate European law",
      "PlayStation",
      "PlayStation May Have A Legal Problem",
    ],
    [
      "Modern Warfare 4 Reveal Looks Imminent",
      "Modern Warfare 4",
      "Modern Warfare 4 Just Got A Reveal Tease",
    ],
  ];

  for (const [title, subject, expected] of cases) {
    const prepared = prepareStoryForGoalProof({
      id: expected.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      title,
      suggested_title: `${subject} Has One Detail Players Should Notice`,
      canonical_subject: subject,
      source_name: "GameSpot",
      source_type: "rss",
      article_url: "https://www.gamespot.com/articles/example/1100-0000/",
      full_script: `${subject} just gave players the update they needed. GameSpot says ${title}. Follow Pulse Gaming so you never miss a beat.`,
    });
    assert.equal(prepared.public_title, expected);
  }
});

test("goal batch proof scripts paraphrase advertiser-unfriendly source titles", () => {
  const prepared = prepareStoryForGoalProof({
    id: "xbox-leadership-risk",
    title:
      "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer",
    article_url: "https://www.eurogamer.net/xbox-hires-analyst",
    source_type: "rss",
    source_name: "Eurogamer",
    canonical_subject: "Xbox",
    full_script: "",
  });

  assert.doesNotMatch(prepared.full_script, /\b(?:gambling|porn|casino|betting)\b/i);
  assert.match(prepared.full_script, /Eurogamer says Xbox has made another leadership move/i);
});

test("goal batch packages diversify repeated fallback title patterns across a batch", () => {
  const stories = Array.from({ length: 9 }, (_, index) => ({
    id: `content-update-${index + 1}`,
    title: `Game ${index + 1} gets a content update with a new mode`,
    suggested_title: `Game ${index + 1} Has One Detail Players Should Notice`,
    canonical_subject: `Game ${index + 1}`,
    source_name: "GameSpot",
    source_type: "rss",
    article_url: `https://www.gamespot.com/articles/game-${index + 1}/1100-0000/`,
    full_script: `Game ${index + 1} just gave players the update they needed. GameSpot says a content update adds a new mode. Follow Pulse Gaming so you never miss a beat.`,
  }));

  const batch = buildGoalBatchPackages({
    stories,
    generatedAt: "2026-05-22T01:25:00.000Z",
  });
  const titles = batch.packages.map((pack) => pack.canonical_story_manifest.short_title);
  const suffixCounts = titles.reduce((counts, title) => {
    const suffix = title.replace(/^Game \d+\s+/, "");
    counts[suffix] = (counts[suffix] || 0) + 1;
    return counts;
  }, {});

  assert.equal(Math.max(...Object.values(suffixCounts)), 3);
  assert.ok(new Set(titles).size > 3);
});

test("goal batch package fallback scripts avoid generic watchlist sludge", () => {
  const prepared = prepareStoryForGoalProof({
    id: "over-hill-next-fest",
    title: "Over the Hill's Next Fest demo promises stylized off-roading",
    canonical_subject: "Over the Hill",
    source_name: "PC Gamer",
    source_type: "rss",
    article_url: "https://www.pcgamer.com/games/racing/over-the-hills-next-fest-demo/",
    full_script: "",
  });

  assert.doesNotMatch(
    prepared.full_script,
    /picked up a player-facing detail|important bit is whether|gap to watch|new signal|new reason to watch/i,
  );
  assert.match(prepared.full_script, /Over the Hill/i);
  assert.match(prepared.full_script, /PC Gamer/i);
});

test("goal batch package generic RSS fallback stays review-held instead of pretending to be must-watch", () => {
  const prepared = prepareStoryForGoalProof({
    id: "rpg-maker-forums-closing",
    title: "RPG Maker forums are closing, nearly 15 years of resources at risk",
    canonical_subject: "RPG Maker forums",
    source_name: "Eurogamer",
    source_type: "rss",
    article_url: "https://www.eurogamer.net/rpg-maker-forums-archive",
    full_script: "",
  });

  assert.doesNotMatch(
    prepared.full_script,
    /picked up a player-facing detail|important bit is whether|gap to watch|new signal|new reason to watch/i,
  );
  assert.match(prepared.full_script, /Eurogamer/i);
  assert.doesNotMatch(prepared.full_script, /review-held|should stay in review|sharper player consequence/i);
  assert.match(prepared.full_script, /RPG Maker forums/i);
  assert.match(prepared.full_script, /players|creators|community/i);
});

test("goal batch package does not turn article-description fragments into narration subjects", () => {
  const prepared = prepareStoryForGoalProof({
    id: "bodypaint-hide-seek",
    title: "Hide-and-seek game where you paint your body to blend in sells a million copies in four days",
    canonical_subject: "Hide-and-seek game where you paint",
    source_name: "PCGamer",
    source_type: "rss",
    article_url: "https://www.pcgamer.com/games/action/hide-and-seek-paint-game-million-copies/",
    full_script: "",
  });

  assert.equal(prepared.canonical_subject, "This Game");
  assert.doesNotMatch(
    prepared.full_script,
    /Hide-and-seek game where you paint just blinked|Hide-and-seek game where you paint should stay/i,
  );
  assert.doesNotMatch(prepared.full_script, /should stay in review|sharper player consequence|review-held/i);
  assert.match(prepared.full_script, /This Game/i);
});

test("goal batch package extracts named subjects from awkward feed headlines", () => {
  const expanse = prepareStoryForGoalProof({
    id: "expanse-osiris",
    title: "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026",
    source_name: "Xbox",
    source_type: "rss",
    article_url: "https://news.xbox.com/en-us/example-expanse",
    full_script: "",
  });
  const composer = prepareStoryForGoalProof({
    id: "deus-ex-composer",
    title:
      "It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year",
    source_name: "PC Gamer",
    source_type: "rss",
    article_url: "https://www.pcgamer.com/games/example-deus-ex-composer",
    full_script: "",
  });
  const nintendo = prepareStoryForGoalProof({
    id: "nintendo-style",
    title: "Nintendo, You Better Not Be Giving Up On Style",
    source_name: "Kotaku",
    source_type: "rss",
    article_url: "https://kotaku.com/example-nintendo-style",
    full_script: "",
  });
  const starWarsRacer = prepareStoryForGoalProof({
    id: "star-wars-racer",
    title: "How Star Wars: Galactic Racer Turns Podracing into a Challenging Roguelite",
    source_name: "Xbox Wire",
    source_type: "rss",
    article_url: "https://news.xbox.com/en-us/2026/06/23/star-wars-galactic-racer-turns-podracing-into-roguelite/",
    full_script: "",
  });

  assert.equal(expanse.canonical_subject, "The Expanse: Osiris Reborn");
  assert.equal(composer.canonical_subject, "Deus Ex Composer");
  assert.equal(nintendo.canonical_subject, "Nintendo");
  assert.equal(starWarsRacer.canonical_subject, "Star Wars: Galactic Racer");
  assert.equal(starWarsRacer.public_title, "Star Wars Podracing Has A Roguelite Risk");
  assert.equal(starWarsRacer.suggested_thumbnail_text, "STAR WARS ROGUELITE RISK");
  assert.doesNotMatch(starWarsRacer.public_title, /This Game/i);
  assert.doesNotMatch(
    starWarsRacer.full_script,
    /This game story needs a clearer name|This Game|one clear detail|player test|background noise|Xbox Wire says How/i,
  );
  assert.match(starWarsRacer.full_script, /Star Wars: Galactic Racer/i);
  assert.match(starWarsRacer.full_script, /roguelite racer/i);
  assert.match(starWarsRacer.full_script, /Players have to decide whether to wishlist/i);
  assert.doesNotMatch(`${expanse.full_script}\n${composer.full_script}\n${nintendo.full_script}`, /\bIt should stay|^Nintendo, You Better Not Be|^Xbox has/m);
});

test("goal batch preparation preserves a viral-ready non-subject hook instead of forcing a weaker opener", () => {
  const script = [
    "One bad ten-minute demo can bury a good game.",
    "That is the real pressure behind Steam Next Fest this week.",
    "Valve's event is live, but the fight starts after players hit install.",
    "A great demo gives you one mechanic you want to talk about.",
    "A weak one exposes every rough edge before the game has a second chance.",
    "For indies, this is the trade-off: wishlists can appear in minutes, but doubt moves just as fast.",
    "If a hidden gem is going to break out on PC, this is where players judge whether the promise is real.",
    "That turns every demo into a trust fight players will decide in minutes.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");

  const prepared = prepareStoryForGoalProof({
    id: "steam-next-fest-trust-fight",
    title: "Steam Next Fest Turns Demos Into A Trust Fight",
    canonical_subject: "Steam Next Fest",
    source_name: "Steam",
    source_type: "official_platform_event",
    article_url: "https://store.steampowered.com/sale/nextfest",
    source_published_at: "2026-06-15T17:00:00.000Z",
    full_script: script,
    tts_script: script,
  });

  assert.equal(prepared.full_script, script);
  assert.equal(prepared.hook, "One bad ten-minute demo can bury a good game.");
  assert.doesNotMatch(prepared.first_spoken_line, /^Steam Next Fest has the one kind/i);
});
