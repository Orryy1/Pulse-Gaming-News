"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertFlashLaneProofReady,
  buildFlashLaneNarrationPlan,
  buildFlashLaneProofPreflight,
  buildFlashLaneProofReadinessSummary,
} = require("../../lib/studio/v2/flash-lane-preflight");

function proofAudioPath(name = "flash-lane-provided.mp3") {
  const dir = path.join(process.cwd(), "test", "output", "tmp-flash-lane-preflight");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, "fake flash lane narration bytes");
  return file;
}

const providedNarration = {
  mode: "real_audio",
  provider: "external",
  source: "provided-real-audio",
  audioPath: proofAudioPath(),
  transcript: "Follow Pulse Gaming so you never miss a beat.",
  acoustic: { medianPitchHz: 118 },
};

function clipScene(i) {
  return { type: "clip", label: `clip_${i}`, source: `clip-${i}.mp4` };
}

function sharedClipScene(i, source = "shared-clip.mp4") {
  return { type: "clip", label: `clip_${i}`, source };
}

function cardScene(i) {
  return { type: "card.stat", label: `card_${i}` };
}

test("Flash Lane preflight blocks still-only enriched proofs", () => {
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes: [cardScene(1), cardScene(2), { type: "still", source: "cover.jpg" }],
    media: { clips: [], trailerFrames: [{ path: "frame.jpg" }], articleHeroes: [{ path: "cover.jpg" }] },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_requires_two_actual_clip_scenes"));
  assert.ok(report.blockers.includes("flash_lane_clip_dominance_below_target"));
});

test("Flash Lane preflight allows footage-led proofs", () => {
  const scenes = [
    clipScene(1),
    clipScene(2),
    clipScene(3),
    clipScene(4),
    clipScene(5),
    clipScene(6),
    clipScene(7),
    cardScene(1),
    cardScene(2),
    { type: "clip.frame", source: "frame-1.jpg" },
    { type: "still", source: "hero-1.jpg" },
    cardScene(3),
  ];
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes,
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
  });

  assert.equal(report.verdict, "allow");
  assert.equal(report.metrics.actualClipScenes, 7);
  assert.equal(report.metrics.actualClipDominance, 0.58);
});

test("Flash Lane preflight allows exhausted clip refs when trailer frames carry the gap", () => {
  const scenes = [
    clipScene(1),
    clipScene(2),
    clipScene(3),
    clipScene(4),
    clipScene(5),
    clipScene(6),
    clipScene(7),
    clipScene(8),
    { type: "clip.frame", source: "frame-1.jpg" },
    { type: "clip.frame", source: "frame-2.jpg" },
    { type: "clip.frame", source: "frame-3.jpg" },
    { type: "clip.frame", source: "frame-4.jpg" },
    { type: "clip.frame", source: "frame-5.jpg" },
    cardScene(1),
    cardScene(2),
    cardScene(3),
  ];
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes,
    media: {
      clips: Array.from({ length: 8 }, (_, index) => ({ path: `clip-${index}.mp4` })),
      trailerFrames: Array.from({ length: 5 }, (_, index) => ({ path: `frame-${index}.jpg` })),
    },
  });

  assert.equal(report.verdict, "allow");
  assert.equal(report.metrics.actualClipDominance, 0.5);
  assert.equal(report.metrics.motionDominance, 0.81);
  assert.ok(report.warnings.includes("flash_lane_clip_dominance_supported_by_trailer_frames"));
  assert.equal(report.blockers.includes("flash_lane_clip_dominance_below_target"), false);
});

test("Flash Lane preflight blocks repeating too few official clips across a 60s proof", () => {
  const scenes = [
    clipScene(1),
    clipScene(2),
    clipScene(3),
    clipScene(4),
    clipScene(5),
    clipScene(6),
    clipScene(7),
    clipScene(8),
    cardScene(1),
    { type: "clip.frame", source: "frame-1.jpg" },
  ];
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes,
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }], trailerFrames: [{ path: "frame-1.jpg" }] },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_clip_reuse_too_high"));
  assert.equal(report.metrics.maxAllowedActualClipScenesFromRefs, 6);
});

test("Flash Lane preflight blocks card-heavy proofs without story beat overlay coverage", () => {
  const scenes = [
    clipScene(1),
    clipScene(2),
    clipScene(3),
    clipScene(4),
    clipScene(5),
    clipScene(6),
    cardScene(1),
    cardScene(2),
    cardScene(3),
    cardScene(4),
  ];
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes,
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan: {
      timeline: [
        { kind: "hook_chip", label: "WAIT... WHAT?" },
        { kind: "source_chip", label: "IGN" },
      ],
    },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.warnings.includes("flash_lane_card_ratio_high"));
  assert.ok(report.blockers.includes("flash_lane_card_ratio_requires_story_beat_coverage"));
  assert.equal(report.metrics.cardRatio, 0.4);
  assert.equal(report.metrics.storyBeatOverlayCount, 0);
});

test("Flash Lane preflight blocks unsafe local overlay geometry before proof render", () => {
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes: [
      { type: "card.source", duration: 5 },
      clipScene(1),
      clipScene(2),
      clipScene(3),
      clipScene(4),
      clipScene(5),
      clipScene(6),
    ],
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan: {
      timeline: [
        {
          kind: "source_chip",
          label: "IGN",
          anchor: "upper_left",
          at_s: 3,
          duration_s: 2.6,
        },
      ],
    },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_overlay_geometry_blocked"));
  assert.ok(
    report.overlayGeometry.blockers.includes("flash_lane_upper_left_overlay_intersects_fullscreen_scene"),
  );
});

test("Flash Lane preflight blocks upper-left overlays that would cover caption bands", () => {
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes: [
      clipScene(1),
      clipScene(2),
      clipScene(3),
      clipScene(4),
      clipScene(5),
      clipScene(6),
    ],
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan: {
      timeline: [
        {
          kind: "source_chip",
          label: "IGN",
          anchor: "upper_left",
          at_s: 8,
          duration_s: 2.6,
        },
      ],
      captionBands: [{ x: 0, y: 360, width: 1080, height: 180, start_s: 7.5, end_s: 10.5 }],
    },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_overlay_geometry_blocked"));
  assert.ok(report.overlayGeometry.findings.some((finding) => finding.type === "caption_band_overlap"));
});

test("Flash Lane preflight allows card-heavy proofs when motion and beat coverage are strong", () => {
  const scenes = [
    clipScene(1),
    clipScene(2),
    clipScene(3),
    clipScene(4),
    clipScene(5),
    clipScene(6),
    cardScene(1),
    cardScene(2),
    cardScene(3),
    cardScene(4),
  ];
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes,
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan: {
      timeline: [
        { kind: "beat_chip", label: "SEQUEL VETO" },
        { kind: "beat_chip", label: "NO DATE YET" },
        { kind: "entity_chip", label: "GTA" },
      ],
    },
  });

  assert.equal(report.verdict, "allow");
  assert.ok(report.warnings.includes("flash_lane_card_ratio_high"));
  assert.equal(report.blockers.includes("flash_lane_card_ratio_requires_story_beat_coverage"), false);
  assert.equal(report.metrics.storyBeatOverlayCount, 2);
});

test("Flash Lane proof readiness is render-ready with overlay beats and motion diversity", () => {
  const overlayPlan = {
    timeline: [
      { kind: "beat_chip", label: "SEQUEL VETO" },
      { kind: "beat_chip", label: "NO DATE YET" },
      { kind: "entity_chip", label: "GTA" },
    ],
  };
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes: [
      clipScene(1),
      clipScene(2),
      clipScene(3),
      clipScene(4),
      clipScene(5),
      clipScene(6),
      cardScene(1),
      cardScene(2),
    ],
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan,
  });
  const summary = buildFlashLaneProofReadinessSummary({
    preflight: report,
    overlayPlan,
  });

  assert.equal(report.verdict, "allow");
  assert.equal(summary.verdict, "render_ready");
  assert.equal(summary.statusColour, "green");
  assert.equal(summary.motionDominance, 0.75);
  assert.equal(summary.storyBeatOverlayCount, 2);
  assert.equal(summary.requiredBeatOverlayMinimum, 2);
  assert.equal(summary.uniqueClipSources, 6);
  assert.equal(summary.distinctSceneBeats, 8);
});

test("Flash Lane proof readiness is blocked when preflight has blockers", () => {
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes: [cardScene(1), cardScene(2), { type: "still", source: "cover.jpg" }],
    media: { clips: [], trailerFrames: [{ path: "frame.jpg" }] },
  });
  const summary = buildFlashLaneProofReadinessSummary({ preflight: report });

  assert.equal(summary.verdict, "blocked");
  assert.equal(summary.readinessClass, "red");
  assert.ok(summary.blockers.includes("flash_lane_requires_two_actual_clip_scenes"));
  assert.match(summary.recommendation, /Fix blockers/);
});

test("Flash Lane proof readiness blocks card-heavy proofs without enough beats", () => {
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes: [
      clipScene(1),
      clipScene(2),
      clipScene(3),
      clipScene(4),
      clipScene(5),
      clipScene(6),
      cardScene(1),
      cardScene(2),
      cardScene(3),
      cardScene(4),
    ],
    media: {
      clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan: {
      timeline: [{ kind: "beat_chip", label: "ONLY ONE BEAT" }],
    },
  });
  const summary = buildFlashLaneProofReadinessSummary({ preflight: report });

  assert.equal(summary.verdict, "blocked");
  assert.equal(summary.storyBeatOverlayCount, 1);
  assert.equal(summary.requiredBeatOverlayMinimum, 2);
  assert.ok(summary.blockers.includes("flash_lane_card_ratio_requires_story_beat_coverage"));
});

test("Flash Lane preflight blocks card-heavy proofs without enough motion diversity", () => {
  const scenes = [
    sharedClipScene(1),
    sharedClipScene(2),
    sharedClipScene(3),
    sharedClipScene(4),
    sharedClipScene(5),
    sharedClipScene(6),
    cardScene(1),
    cardScene(2),
    cardScene(3),
    cardScene(4),
  ];
  const report = buildFlashLaneProofPreflight({
    narration: providedNarration,
    scenes,
    media: {
      clips: [{ path: "shared-clip.mp4" }, { path: "unused-a.mp4" }, { path: "unused-b.mp4" }],
      trailerFrames: [{ path: "frame-1.jpg" }],
    },
    overlayPlan: {
      timeline: [
        { kind: "beat_chip", label: "SEQUEL VETO" },
        { kind: "beat_chip", label: "NO DATE YET" },
        { kind: "entity_chip", label: "GTA" },
      ],
    },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_card_ratio_requires_motion_diversity"));
  assert.equal(report.metrics.storyBeatOverlayCount, 2);
  assert.equal(report.visualDirector.metrics.uniqueClipSources, 1);
});

test("Flash Lane preflight blocks unapproved local narration", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      mode: "real_audio",
      provider: "local",
      source: "local-production-voxcpm-path",
    },
    scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }] },
    env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("unapproved_local_tts_voice_path"));
  assert.throws(
    () =>
      assertFlashLaneProofReady({
        narration: {
          mode: "real_audio",
          provider: "local",
          source: "local-production-voxcpm-path",
        },
        scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
        media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }] },
        env: { STUDIO_V2_LOCAL_VOICE_APPROVED: "false" },
      }),
    /unapproved_local_tts_voice_path/,
  );
});

test("Flash Lane preflight blocks overlong narration before rendering", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 118.025,
    },
    scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }] },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_runtime_outside_50_to_75_seconds"));
  assert.equal(report.metrics.narrationDurationS, 118.025);
});

test("Flash Lane preflight blocks very slow narration pace before rendering", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 118.025,
    },
    scriptWordCount: 148,
    scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }] },
  });

  assert.equal(report.verdict, "block");
  assert.ok(report.blockers.includes("flash_lane_spoken_wpm_outside_publishable_range"));
  assert.equal(report.metrics.spokenWpm, 75.2);
  assert.equal(report.narrationPlan.recommendation, "regenerate_narration_at_normal_creator_pace");
  assert.ok(report.narrationPlan.issues.includes("spoken_pace_too_slow"));
});

test("Flash Lane preflight accepts narration inside the 61-75 second window", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 68.2,
    },
    scriptWordCount: 160,
    scenes: [
      clipScene(1),
      clipScene(2),
      clipScene(3),
      clipScene(4),
      clipScene(5),
      clipScene(6),
      { type: "clip.frame", source: "frame-1.jpg" },
      { type: "clip.frame", source: "frame-2.jpg" },
      cardScene(1),
    ],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }], trailerFrames: [{ path: "frame-1.jpg" }, { path: "frame-2.jpg" }] },
  });

  assert.equal(report.verdict, "allow");
  assert.equal(report.metrics.spokenWpm, 140.8);
});

test("Flash Lane preflight allows sharp sub-60s shorts but warns on creator rewards runtime", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 55.5,
    },
    scriptWordCount: 150,
    scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }, { path: "c.mp4" }] },
  });

  assert.equal(report.verdict, "allow");
  assert.ok(report.warnings.includes("flash_lane_below_creator_rewards_runtime_target"));
  assert.ok(report.narrationPlan.warnings.includes("narration_below_creator_rewards_runtime_target"));
  assert.equal(report.metrics.spokenWpm, 162.2);
});

test("Flash Lane narration plan flags scripts too short for 50-75s creator pace", () => {
  const plan = buildFlashLaneNarrationPlan({
    scriptWordCount: 100,
  });

  assert.deepEqual(plan.targetRuntimeS, [50, 75]);
  assert.deepEqual(plan.creatorRewardsTargetRuntimeS, [61, 75]);
  assert.deepEqual(plan.idealWpmRange, [140, 155]);
  assert.ok(plan.issues.includes("script_too_short_for_flash_lane_target"));
  assert.equal(plan.recommendation, "expand_script_before_flash_lane_voice");
});

test("Flash Lane preflight can be bypassed only for explicit diagnostics", () => {
  assert.doesNotThrow(() =>
    assertFlashLaneProofReady(
      {
        narration: providedNarration,
        scenes: [cardScene(1), { type: "still", source: "cover.jpg" }],
        media: { clips: [], articleHeroes: [{ path: "cover.jpg" }] },
      },
      { allowDiagnosticRender: true },
    ),
  );
});
