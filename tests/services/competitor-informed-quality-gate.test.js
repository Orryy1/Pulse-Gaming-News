"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const {
  buildCompetitorInformedQualityGate,
  writeCompetitorInformedQualityGate,
} = require("../../lib/competitor-informed-quality-gate");

function passGate(extra = {}) {
  return { verdict: "pass", failures: [], blockers: [], ...extra };
}

const execFileAsync = promisify(execFile);
let validFinalMediaBytesPromise;
let warningFinalMediaBytesPromise;

async function validFinalMediaBytes() {
  if (!validFinalMediaBytesPromise) {
    validFinalMediaBytesPromise = (async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-competitor-valid-media-"));
      const output = path.join(root, "valid-short.mp4");
      try {
        await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "testsrc2=size=540x960:rate=15",
          "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
          "-t", "10.2",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart",
          output,
        ], { timeout: 60000 });
        return await fs.readFile(output);
      } finally {
        await fs.remove(root);
      }
    })();
  }
  return validFinalMediaBytesPromise;
}

async function warningFinalMediaBytes() {
  if (!warningFinalMediaBytesPromise) {
    warningFinalMediaBytesPromise = (async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-competitor-warning-media-"));
      const output = path.join(root, "warning-short.mp4");
      try {
        await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-f", "lavfi", "-i", "color=c=black:s=360x640:r=1",
          "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
          "-t", "10.2",
          "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart",
          output,
        ], { timeout: 60000 });
        return Buffer.concat([await fs.readFile(output), Buffer.alloc(600000)]);
      } finally {
        await fs.remove(root);
      }
    })();
  }
  return warningFinalMediaBytesPromise;
}

async function makeGateStory(root, storyId, overrides = {}) {
  const artifactDir = path.join(root, storyId);
  await fs.ensureDir(artifactDir);
  let finalMediaBytes = null;
  if (overrides.finalMedia !== false) {
    finalMediaBytes = await validFinalMediaBytes();
    await fs.writeFile(path.join(artifactDir, "visual_v4_render.mp4"), finalMediaBytes);
  }
  const canonical = {
    story_id: storyId,
    selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    canonical_subject: "Forza Horizon 6",
    first_spoken_line: "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam.",
    narration_script:
      "Forza Horizon 6 just broke the one Xbox ceiling that matters on Steam. Steam interest gives Xbox a cleaner PC story before launch. The payoff is simple: Game Pass messaging now has to compete with where PC players are already paying attention. Follow Pulse Gaming so you never miss a beat.",
    primary_source: "Steam",
    final_duration_seconds: 10.2,
    ...(overrides.canonical || {}),
  };
  const director = overrides.director || {
    shot_plan: [
      { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.4 },
      { id: "proof", kind: "motion_clip", startS: 0.3, durationS: 2.7, source_family: "official_a" },
      { id: "source", kind: "source_lock", startS: 2.6, durationS: 1.6 },
      { id: "payoff", kind: "proof_card", startS: 6, durationS: 2.2 },
    ],
    transition_plan: { planned: [{ family: "impact_cut" }, { family: "source_wipe" }], max_same_family_run: 1 },
    sound_transition_plan: {
      sfx: {
        cue_count: 7,
        max_same_family_run: 1,
        cues: [{ family: "impact", atS: 0 }, { family: "whoosh", atS: 0.4 }],
        mastering: { duck_under_narration: true, narration_priority: true },
      },
    },
    caption_policy: { clean_manual_captions: true, avoid_lower_third_collisions: true },
  };
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), canonical);
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), overrides.scriptScorecard || {
    verdict: "viral_ready",
    viral_score: 88,
    blockers: [],
    scores: { hook_strength: 90, insight_density: 85, retention_pacing: 86 },
  });
  await fs.outputJson(path.join(artifactDir, "visual_quality_report.json"), overrides.visualQuality || {
    result: "pass",
    scores: {
      motion_density_score: 91,
      first_3_seconds_hook_score: 89,
      source_lock_quality_score: 86,
      caption_legibility_score: 90,
      card_hierarchy_score: 82,
      transition_energy_score: 87,
      sfx_impact_score: 84,
      rights_risk_score: 95,
      media_house_polish_score: 90,
    },
    visual_evidence_profile: {
      generated_only_motion_deck: false,
      motion_asset_count: 9,
      real_media_family_count: 5,
      blockers: [],
    },
    failures: [],
  });
  await fs.outputJson(path.join(artifactDir, "director_beat_map.json"), director);
  await fs.outputJson(path.join(artifactDir, "audio_manifest.json"), overrides.audio || {
    voice_status: "materialized",
    word_timestamp_count: 120,
    narration_audio_path: "output/audio/story.mp3",
    word_timestamps_path: "output/audio/story.words.json",
    mix_rules: { narration_priority: true, duck_under_narration: true, limiter: true },
  });
  await fs.outputJson(path.join(artifactDir, "audio_segment_loudness_report.json"), overrides.loudness || {
    verdict: "pass",
    metrics: { valid_segment_count: 4, max_peak_db: -1.2, mean_range_db: 2 },
    blockers: [],
  });
  await fs.outputJson(path.join(artifactDir, "affiliate_link_manifest.json"), overrides.affiliate || {
    commercial_intent_type: "story_relevant_game_page",
    disclosure_required: true,
    disclosure_copy: { short: "Affiliate links may earn us a commission." },
    primary_link: { story_relevance: 88, merchant: "Steam", url: "https://store.steampowered.com/app/example" },
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), overrides.platformManifest || {
    publish_status: "GREEN",
    outputs: {
      youtube_shorts: {
        title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
        description:
          "Forza Horizon 6 just turned Xbox's PC pitch into a Steam audience test before launch. Players now get to judge whether the next racer can grow beyond Game Pass. Source: Steam.",
        cover_frame: { headline: "STEAM CEILING BROKEN" },
      },
      tiktok: {
        caption:
          "Forza Horizon 6 just turned Xbox's PC pitch into a Steam audience test before launch. Players now get to judge whether the next racer can grow beyond Game Pass. Source: Steam.",
      },
    },
  });
  await fs.outputJson(path.join(artifactDir, "render_manifest.json"), overrides.renderManifest || {
    final_publish_render: true,
    output_path: path.join(artifactDir, "visual_v4_render.mp4"),
    file_size_bytes: finalMediaBytes?.length || 0,
  });
  await fs.outputJson(path.join(artifactDir, "caption_manifest.json"), overrides.captionManifest || {
    verdict: "PASS",
    status: "ready",
    display_text: canonical.narration_script,
    checks: {
      caption_file_verified: true,
      display_script_verified: true,
      display_alignment_exact: true,
    },
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), overrides.materialisedMotionClips || {
    status: "ready",
    clips: Array.from({ length: 5 }, (_, index) => ({
      id: `${storyId}-motion-${index + 1}`,
      path: path.join(artifactDir, `motion-${index + 1}.mp4`),
      source_family: `official_${storyId}_${index + 1}`,
      media_kind: "direct_video",
      counts_towards_motion_readiness: true,
    })),
    distinct_motion_families: Array.from(
      { length: 5 },
      (_, index) => `official_${storyId}_${index + 1}`,
    ),
  });
  await fs.outputJson(path.join(artifactDir, "benchmark_report.json"), overrides.benchmark || passGate({ result: "pass" }));
  await fs.outputJson(path.join(artifactDir, "uniqueness_report.json"), overrides.uniqueness || passGate());
  await fs.outputJson(path.join(artifactDir, "rights_ledger.json"), passGate());

  return { story_id: storyId, title: canonical.selected_title, artifact_dir: artifactDir };
}

test("competitor-informed quality gate passes strong Pulse-original packages and writes per-story score", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-"));
  const story = await makeGateStory(root, "strong-story");
  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.green_story_count, 1);
  assert.equal(report.stories[0].pulse_media_house_score.verdict, "GREEN");
  assert.equal(report.stories[0].pulse_media_house_score.premium_output_contract.status, "pass");
  assert.equal(
    report.stories[0].pulse_media_house_score.premium_output_contract.checks.final_render.evidence.final_publish_render,
    true,
  );
  assert.equal(
    report.stories[0].pulse_media_house_score.premium_output_contract.checks.caption_display.evidence.checked,
    true,
  );
  assert.equal(
    report.stories[0].pulse_media_house_score.premium_output_contract.checks.direct_motion_repeats.evidence.clip_count,
    5,
  );
  assert.equal(await fs.pathExists(path.join(story.artifact_dir, "pulse_media_house_score.json")), true);
});

test("competitor-informed quality gate blocks a missing final video", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-missing-video-"));
  const story = await makeGateStory(root, "missing-video", { finalMedia: false });

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-07-14T21:01:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.ok(report.stories[0].blockers.includes("media_house:final_video_missing_or_unreadable"));
  assert.equal(report.stories[0].pulse_media_house_score.final_video_report.status, "blocked");
});

test("competitor-informed quality gate blocks a large corrupt MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-corrupt-video-"));
  const story = await makeGateStory(root, "corrupt-video");
  await fs.writeFile(path.join(story.artifact_dir, "visual_v4_render.mp4"), Buffer.alloc(600000, 0x61));

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-07-14T21:02:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.stories[0].final_verdict, "RED");
  assert.ok(report.stories[0].blockers.includes("media_house:final_video_unreadable"));
  assert.equal(report.stories[0].pulse_media_house_score.final_video_report.decodable, false);
});

test("competitor-informed quality gate preserves independent media warnings as AMBER", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-media-warning-"));
  const story = await makeGateStory(root, "media-warning", { finalMedia: false });
  const finalVideoPath = path.join(story.artifact_dir, "visual_v4_render.mp4");
  const finalVideoBytes = await warningFinalMediaBytes();
  await fs.writeFile(finalVideoPath, finalVideoBytes);
  await fs.writeJson(path.join(story.artifact_dir, "render_manifest.json"), {
    final_publish_render: true,
    output_path: finalVideoPath,
    file_size_bytes: finalVideoBytes.length,
  });

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-07-14T21:06:00.000Z",
  });

  const score = report.stories[0].pulse_media_house_score;
  assert.equal(report.verdict, "PARTIAL");
  assert.equal(report.stories[0].final_verdict, "AMBER");
  assert.equal(score.verdict, "AMBER");
  assert.equal(score.final_video_report.status, "amber");
  assert.ok(score.warnings.some((warning) => warning.includes("video_resolution_low")));
});

test("competitor-informed quality gate blocks weak competitor parity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-weak-"));
  const story = await makeGateStory(root, "weak-story", {
    canonical: {
      selected_title: "Gaming news update",
      canonical_subject: "Forza Horizon 6",
      first_spoken_line: "Here is what happened in gaming news today.",
      narration_script: "Here is what happened in gaming news today. This gaming story has context.",
    },
    visualQuality: {
      result: "fail",
      scores: {
        motion_density_score: 30,
        first_3_seconds_hook_score: 25,
        source_lock_quality_score: 40,
        caption_legibility_score: 45,
        card_hierarchy_score: 35,
        transition_energy_score: 20,
        sfx_impact_score: 10,
        rights_risk_score: 85,
        media_house_polish_score: 30,
      },
      visual_evidence_profile: { generated_only_motion_deck: true, motion_asset_count: 1, real_media_family_count: 0, blockers: [] },
      failures: ["gold_standard:motion_density_below_reference"],
    },
  });

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.equal(report.summary.red_story_count, 1);
  assert.ok(report.stories[0].blockers.includes("media_house:generic_title"));
  assert.ok(report.competitor_parity_report.stories[0].status === "blocked");
});

test("competitor-informed quality gate blocks poor SFX/audio", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-sfx-"));
  const story = await makeGateStory(root, "poor-sfx", {
    director: {
      shot_plan: [
        { id: "hook", kind: "hook_slam", startS: 0, durationS: 1.4 },
        { id: "proof", kind: "motion_clip", startS: 0.3, durationS: 2.7 },
      ],
      transition_plan: { planned: [{ family: "hard_cut" }], max_same_family_run: 1 },
      sound_transition_plan: {
        sfx: {
          cue_count: 1,
          max_same_family_run: 4,
          cues: [{ family: "tick", atS: 0 }, { family: "tick", atS: 1 }, { family: "tick", atS: 2 }],
          mastering: { duck_under_narration: false, narration_priority: false },
        },
      },
      caption_policy: { clean_manual_captions: true, avoid_lower_third_collisions: true },
    },
    loudness: { verdict: "fail", blockers: ["voice_buried"], metrics: { valid_segment_count: 1, max_peak_db: 0.2 } },
  });

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("media_house:poor_sfx_audio"));
});

test("competitor-informed quality gate blocks tiny placeholder final videos", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-tiny-video-"));
  const story = await makeGateStory(root, "tiny-video", {
    canonical: {
      final_duration_seconds: 2.4,
      video_duration_seconds: 2.4,
    },
  });
  await fs.writeFile(path.join(story.artifact_dir, "visual_v4_render.mp4"), Buffer.alloc(22000));

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("media_house:final_video_placeholder_or_too_short"));
  assert.equal(report.stories[0].pulse_media_house_score.final_video_report.status, "blocked");
});

test("competitor-informed quality gate applies Footage Empire v2 source-lock evidence by story", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-footage-"));
  const story = await makeGateStory(root, "footage-red-story");
  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-06-07T12:00:00.000Z",
    footageEmpireReport: {
      verdict: "red",
      rows: [
        {
          story_id: "footage-red-story",
          verdict: "red",
          blockers: ["trusted_footage_story_mismatch_or_missing"],
          motion: { available_motion_clips: 0, available_distinct_families: 0 },
          trusted_sources: { references_found: 0 },
          rights_coverage: { verdict: "pass", approved_family_count: 0 },
        },
      ],
    },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("media_house:source_lock_not_verified"));
  assert.equal(report.stories[0].pulse_media_house_score.source_lock_report.status, "blocked");
  assert.equal(report.stories[0].source_material.footage_empire_v2_present, true);
});

test("competitor-informed quality gate cannot let aggregate GREEN mask package-local footage RED", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-local-footage-red-"));
  const story = await makeGateStory(root, "local-footage-red-story");
  await fs.outputJson(path.join(story.artifact_dir, "footage_inventory.json"), {
    verdict: "RED",
    blockers: ["trusted_footage_story_mismatch_or_missing"],
    readiness: {
      status: "v4_motion_blocked",
      blockers: ["trusted_footage_story_mismatch_or_missing"],
    },
  });

  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-07-18T23:00:00.000Z",
    footageEmpireReport: {
      verdict: "GREEN",
      rows: [{
        story_id: "local-footage-red-story",
        verdict: "GREEN",
        readiness: { status: "v4_motion_ready", blockers: [] },
        blockers: [],
      }],
    },
  });

  assert.equal(report.verdict, "BLOCKED");
  assert.ok(report.stories[0].blockers.includes("media_house:source_lock_not_verified"));
  assert.ok(
    report.stories[0].pulse_media_house_score.source_lock_report.blockers.includes(
      "trusted_footage_story_mismatch_or_missing",
    ),
  );
  assert.equal(report.stories[0].source_material.footage_empire_v2_present, true);
});

test("competitor-informed quality gate writes required integration artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-quality-gate-write-"));
  const story = await makeGateStory(root, "write-story");
  const report = await buildCompetitorInformedQualityGate({
    storyPackages: [story],
    outputDir: path.join(root, "out"),
    workspaceRoot: root,
    generatedAt: "2026-06-07T12:00:00.000Z",
  });
  const written = await writeCompetitorInformedQualityGate(report, { outputDir: path.join(root, "out") });

  for (const file of Object.values(written)) {
    assert.equal(await fs.pathExists(file), true, file);
  }
});
