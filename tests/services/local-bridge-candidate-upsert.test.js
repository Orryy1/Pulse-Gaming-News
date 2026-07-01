"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildLocalBridgeCandidate,
  upsertLocalBridgeCandidate,
} = require("../../lib/local-bridge-candidate-upsert");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-local-bridge-upsert-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story_custom_seas",
    selected_title: "Sea of Thieves Custom Seas Could Split Crews",
    public_title: "Sea of Thieves Custom Seas Could Split Crews",
    canonical_subject: "Sea of Thieves",
    canonical_game: "Sea of Thieves",
    primary_source: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/example",
    source_published_at: "Fri, 19 Jun 2026 16:00:00 +0000",
    first_spoken_line: "Sea of Thieves just made its biggest social gamble in years.",
    narration_script:
      "Sea of Thieves just made its biggest social gamble in years. Xbox Wire says Custom Seas lets players set their own rules. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. Source: Xbox Wire.",
    thumbnail_headline: "SEA THIEVES CUSTOM SEAS",
  });
  await fs.writeJson(path.join(artifactDir, "render_manifest.json"), {
    story_id: "story_custom_seas",
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    duration_seconds: 38.5,
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    final_publish_render: true,
    quality_gate_status: "post_render_forensics_passed",
    post_render_forensic_result: "pass",
  });
  await fs.writeFile(path.join(artifactDir, "visual_v4_render.mp4"), Buffer.alloc(600_000));
  await fs.writeFile(path.join(artifactDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nSea\n");
  await fs.ensureDir(path.join(root, "output", "audio"));
  await fs.writeFile(path.join(root, "output", "audio", "story_custom_seas.mp3"), Buffer.alloc(4096));
  await fs.writeJson(path.join(root, "output", "audio", "story_custom_seas_timestamps.json"), {
    words: [{ word: "Sea", start: 0, end: 0.2 }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_manifest.json"), {
    narration_audio_path: "output/audio/story_custom_seas.mp3",
    resolved_narration_audio_path: path.join(root, "output", "audio", "story_custom_seas.mp3"),
    word_timestamps_path: "output/audio/story_custom_seas_timestamps.json",
    resolved_word_timestamps_path: path.join(root, "output", "audio", "story_custom_seas_timestamps.json"),
    voice_status: "materialized",
    word_timestamp_source: "local_whisper_word_alignment",
    word_timestamp_count: 22,
  });
  await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), [
    { asset_id: "clip", asset_type: "motion", path: "clip.mp4" },
    { asset_id: "audio", asset_type: "audio", path: "voice.mp3" },
  ]);
  await fs.writeJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clip_count: 3,
    distinct_motion_family_count: 3,
    clips: [
      { id: "clip_a", path: "clip-a.mp4", source_family: "sea_family_a", media_kind: "direct_video" },
      { id: "clip_b", path: "clip-b.mp4", source_family: "sea_family_b", media_kind: "direct_video" },
      { id: "clip_c", path: "clip-c.mp4", source_family: "sea_family_c", media_kind: "direct_video" },
    ],
    materialized_clips: [
      { id: "clip_a", path: "clip-a.mp4", source_family: "sea_family_a", media_kind: "direct_video" },
    ],
  });
  await fs.writeJson(path.join(artifactDir, "distinct_motion_family_report.json"), {
    status: "ready",
    summary: { distinct_motion_family_count: 3 },
    distinct_motion_families: ["sea_family_a", "sea_family_b", "sea_family_c"],
  });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), {
    result: "pass",
    scores: { media_house_polish_score: 91, mobile_readability_score: 92 },
  });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), {
    result: "pass",
    scores: { media_house_polish_score: 91 },
  });
  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), {
    readiness: { status: "director_ready", blockers: [] },
    shot_plan: [{ kind: "motion", label: "Custom Seas", path: "clip-a.mp4" }],
  });
  await fs.writeJson(path.join(artifactDir, "audio_segment_loudness_report.json"), {
    result: "pass",
    status: "pass",
  });
  await fs.writeJson(path.join(artifactDir, "voice_quality_report.json"), {
    verdict: "PASS",
    blockers: [],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    publish_status: "RED",
    outputs: {
      youtube_shorts: {
        title: "Sea of Thieves Custom Seas Could Split Crews",
        description:
          "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. Source: Xbox Wire.",
        cover_frame: { headline: "SEA THIEVES CUSTOM SEAS" },
      },
    },
  });
  await fs.writeJson(path.join(artifactDir, "instagram_publish_pack.json"), {
    title: "Sea of Thieves Custom Seas Could Split Crews",
    caption:
      "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. Source: Xbox Wire.",
    cover_frame: { headline: "SEA THIEVES CUSTOM SEAS" },
  });
  await fs.writeJson(path.join(artifactDir, "facebook_publish_pack.json"), {
    title: "Sea of Thieves Custom Seas Could Split Crews",
    page_caption:
      "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. Source: Xbox Wire.",
    cover_frame: { headline: "SEA THIEVES CUSTOM SEAS" },
  });
  await fs.writeJson(path.join(artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
    reason_codes: [
      "footage:v4_motion_blocked",
      "media_house:overall_score_below_threshold",
      "media_house:source_lock_not_verified",
    ],
    warnings: ["package_quality_blocks_publish"],
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    verdict: "GREEN",
    status: "pass",
    hard_failures: [],
    scores: { overall_media_house_score: 91 },
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 87,
    blockers: [],
    warnings: [],
  });
  const bridgePath = path.join(root, "scheduler_bridge_candidates.json");
  await fs.writeJson(bridgePath, {
    scheduler_bridge_candidates: [
      { id: "existing", title: "Existing Candidate", scheduler_bridge_source: "test" },
    ],
  });
  return { root, artifactDir, bridgePath };
}

test("buildLocalBridgeCandidate creates scheduler-ready metadata from a local artefact package", async () => {
  const files = await fixture();
  const candidate = await buildLocalBridgeCandidate({
    artifactDir: files.artifactDir,
    generatedAt: "2026-06-21T18:40:00.000Z",
  });

  assert.equal(candidate.id, "story_custom_seas");
  assert.equal(candidate.title, "Sea of Thieves Custom Seas Could Split Crews");
  assert.equal(candidate.auto_approved, true);
  assert.equal(candidate.governance_publish_status, "GREEN");
  assert.equal(candidate.scheduler_bridge_source, "local_bridge_candidate_upsert");
  assert.equal(candidate.artifact_dir, files.artifactDir);
  assert.equal(candidate.scheduler_bridge_artifact_dir, files.artifactDir);
  assert.equal(candidate.duration_seconds, 38.5);
  assert.equal(candidate.runtime_seconds, 38.5);
  assert.equal(candidate.audio_duration, 38.5);
  assert.equal(candidate.audio_duration_seconds, 38.5);
  assert.equal(candidate.duration_lane, "normal_production");
  assert.equal(candidate.min_video_duration_seconds, 35);
  assert.equal(candidate.target_video_duration_seconds_min, 35);
  assert.equal(candidate.target_video_duration_seconds_max, 60);
  assert.equal(candidate.max_video_duration_seconds, 60);
  assert.match(candidate.exported_path, /visual_v4_render\.mp4$/);
  assert.equal(candidate.audio_path, path.join(files.root, "output", "audio", "story_custom_seas.mp3"));
  assert.equal(candidate.relative_narration_audio_path, "output/audio/story_custom_seas.mp3");
  assert.equal(candidate.word_timestamps_path, path.join(files.root, "output", "audio", "story_custom_seas_timestamps.json"));
  assert.equal(candidate.relative_word_timestamps_path, "output/audio/story_custom_seas_timestamps.json");
  assert.match(candidate.manual_caption_path, /captions\.srt$/);
  assert.equal(candidate.platform_publish_manifest.outputs.youtube_shorts.title, "Sea of Thieves Custom Seas Could Split Crews");
  assert.equal(candidate.platform_publish_manifest.outputs.instagram_reels.title, "Sea of Thieves Custom Seas Could Split Crews");
  assert.equal(candidate.platform_publish_manifest.outputs.facebook_reels.description, "Sea of Thieves is adding Custom Seas, a private mode where players can set their own rules. Source: Xbox Wire.");
  assert.equal(candidate.rights_ledger.length, 2);
  assert.equal(candidate.rights_records.length, 2);
  assert.equal(candidate.provenance_ledger.length, 2);
  assert.equal(candidate.visual_v4_render_bridge_clip_count, 3);
  assert.equal(candidate.distinct_motion_family_count, 3);
  assert.equal(candidate.video_clips.length, 3);
  assert.equal(candidate.suggested_thumbnail_text, "SEA THIEVES CUSTOM SEAS");
  assert.equal(candidate.video_clips[0].entity, "Sea of Thieves");
  assert.equal(candidate.video_clips[0].source_title, "Sea of Thieves");
  assert.equal(candidate.visual_quality_report.result, "pass");
  assert.equal(candidate.benchmark_report.result, "pass");
  assert.equal(candidate.director_beat_map.shot_plan.length, 1);
  assert.equal(candidate.audio_segment_loudness_report.result, "pass");
  assert.equal(candidate.voice_quality_report.verdict, "PASS");
  assert.equal(candidate.publish_verdict.verdict, "GREEN");
  assert.equal(candidate.publish_verdict.can_auto_publish, true);
  assert.equal(candidate.publish_verdict.local_bridge_repaired_from_stale_verdict, true);
  assert.equal(candidate.publish_verdict.original_publish_verdict.verdict, "RED");
  assert.ok(candidate.local_bridge_validation.warnings.includes("stale_publish_verdict_ignored_after_current_package_repair"));
  assert.equal(candidate.local_bridge_validation.verdict, "pass");
  assert.equal(candidate.local_bridge_validation.evidence.render_bytes, 600_000);
});

test("buildLocalBridgeCandidate keeps concise platform cover headlines instead of prepending full subject", async () => {
  const files = await fixture();
  const canonicalPath = path.join(files.artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    story_id: "story_black_ops_update",
    selected_title: "Black Ops 7's June 25 Update Has One Reinstall Catch",
    public_title: "Black Ops 7's June 25 Update Has One Reinstall Catch",
    canonical_subject: "Call of Duty: Black Ops 7",
    canonical_game: "Call of Duty: Black Ops 7",
    thumbnail_headline: "BLACK OPS 7 REINSTALL CATCH",
  });
  const packPath = path.join(files.artifactDir, "platform_publish_manifest.json");
  const pack = await fs.readJson(packPath);
  await fs.writeJson(packPath, {
    ...pack,
    outputs: {
      ...pack.outputs,
      youtube_shorts: {
        ...pack.outputs.youtube_shorts,
        title: "Black Ops 7's June 25 Update Has One Reinstall Catch",
        cover_frame: { headline: "BLACK OPS 7 REINSTALL CATCH" },
      },
    },
  });

  const candidate = await buildLocalBridgeCandidate({
    artifactDir: files.artifactDir,
    generatedAt: "2026-06-27T11:40:00.000Z",
  });

  assert.equal(candidate.suggested_thumbnail_text, "BLACK OPS 7 REINSTALL CATCH");
  assert.equal(candidate.thumbnail_headline, "BLACK OPS 7 REINSTALL CATCH");
  assert.doesNotMatch(candidate.suggested_thumbnail_text, /Call of Duty/i);
});

test("buildLocalBridgeCandidate preserves safe spoken TTS script separately from display narration", async () => {
  const files = await fixture();
  const canonicalPath = path.join(files.artifactDir, "canonical_story_manifest.json");
  const canonical = await fs.readJson(canonicalPath);
  await fs.writeJson(canonicalPath, {
    ...canonical,
    story_id: "story_gta_vi",
    selected_title: "GTA VI Just Made PS5 The Version To Watch",
    public_title: "GTA VI Just Made PS5 The Version To Watch",
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    narration_script:
      "Sony just made GTA VI's console pitch unusually direct. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Sony just made Rockstar's next Grand Theft Auto console pitch unusually direct. Follow Pulse Gaming so you never miss a beat.",
    spoken_narration_script:
      "Sony just made Rockstar's next Grand Theft Auto console pitch unusually direct. Follow Pulse Gaming so you never miss a beat.",
    thumbnail_headline: "GTA VI PS5 TEST",
  });

  const candidate = await buildLocalBridgeCandidate({
    artifactDir: files.artifactDir,
    generatedAt: "2026-06-29T10:05:00.000Z",
  });

  assert.match(candidate.narration_script, /\bGTA VI\b/);
  assert.equal(
    candidate.tts_script,
    "Sony just made Rockstar's next Grand Theft Auto console pitch unusually direct. Follow Pulse Gaming so you never miss a beat.",
  );
  assert.equal(candidate.spoken_narration_script, candidate.tts_script);
  assert.doesNotMatch(candidate.tts_script, /\bGTA\b|\bVI\b|\bsix\b/i);
});

test("upsertLocalBridgeCandidate rewrites only bridge JSON with backup and no side effects", async () => {
  const files = await fixture();
  const report = await upsertLocalBridgeCandidate({
    bridgePath: files.bridgePath,
    artifactDir: files.artifactDir,
    backupDir: path.join(files.root, "backups"),
    generatedAt: "2026-06-21T18:40:00.000Z",
    apply: true,
  });

  assert.equal(report.summary.before_count, 1);
  assert.equal(report.summary.after_count, 2);
  assert.equal(report.summary.upserted_story_id, "story_custom_seas");
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);
  assert.equal(await fs.pathExists(report.backup_path), true);

  const updated = await fs.readJson(files.bridgePath);
  assert.equal(updated.scheduler_bridge_candidates.length, 2);
  assert.ok(updated.scheduler_bridge_candidates.some((item) => item.id === "story_custom_seas"));
});

test("upsertLocalBridgeCandidate blocks non-GREEN packages before rewriting the bridge", async () => {
  const files = await fixture();
  await fs.writeJson(path.join(files.artifactDir, "publish_verdict.json"), {
    verdict: "RED",
    can_auto_publish: false,
  });
  await fs.writeFile(path.join(files.artifactDir, "visual_v4_render.mp4"), Buffer.alloc(128));

  await assert.rejects(
    () =>
      upsertLocalBridgeCandidate({
        bridgePath: files.bridgePath,
        artifactDir: files.artifactDir,
        backupDir: path.join(files.root, "backups"),
        generatedAt: "2026-06-21T18:40:00.000Z",
        apply: true,
      }),
    /final_render_file_missing_or_too_small/,
  );

  const updated = await fs.readJson(files.bridgePath);
  assert.equal(updated.scheduler_bridge_candidates.length, 1);
  assert.equal(updated.scheduler_bridge_candidates[0].id, "existing");
});

test("upsertLocalBridgeCandidate blocks packages with stale blocked director evidence", async () => {
  const files = await fixture();
  await fs.writeJson(path.join(files.artifactDir, "director_beat_map.json"), {
    readiness: {
      status: "director_blocked",
      blockers: ["actual_motion_clip_minimum_not_met"],
    },
    shot_budget: {
      min_actual_motion_clips: 5,
      available_motion_clips: 8,
    },
    shot_plan: [{ kind: "motion", label: "Custom Seas", path: "clip-a.mp4" }],
  });

  await assert.rejects(
    () =>
      upsertLocalBridgeCandidate({
        bridgePath: files.bridgePath,
        artifactDir: files.artifactDir,
        backupDir: path.join(files.root, "backups"),
        generatedAt: "2026-06-21T18:40:00.000Z",
        apply: true,
      }),
    /director_beat_map_blocked/,
  );

  const updated = await fs.readJson(files.bridgePath);
  assert.equal(updated.scheduler_bridge_candidates.length, 1);
  assert.equal(updated.scheduler_bridge_candidates[0].id, "existing");
});

test("local bridge candidate upsert command is registered for operator runs", async () => {
  const pkg = await fs.readJson(path.join(__dirname, "..", "..", "package.json"));
  assert.equal(
    pkg.scripts["ops:local-bridge-candidate-upsert"],
    "node tools/local-bridge-candidate-upsert.js",
  );
});
