"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  assertFlashLaneProofReady: assertFlashLaneProofReadyRaw,
  buildFlashLaneNarrationPlan,
  buildFlashLaneProofPreflight: buildFlashLaneProofPreflightRaw,
} = require("../../lib/studio/v2/flash-lane-preflight");
const {
  CTA_POLICY,
} = require("../../lib/services/pulse-editorial-contract");

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
  transcript: "Xbox players gained a verified compatibility feature.",
  acoustic: { medianPitchHz: 118 },
};

const pulseStory = {
  id: "preflight-contract-story",
  title: "Xbox changes backwards compatibility for players",
  hook: "Xbox players just gained a feature the old catalogue was missing.",
  hook_type: "direct",
  editorial_lane_id: "what_changes_for_players",
  duration_band_id: "what_changes_standard_35_42",
  cta: "",
  cta_policy: {
    policy_version: CTA_POLICY.version,
    scope: "shorts",
    include_cta: false,
    copy_strategy: "none",
    cohort_bucket: 1,
    cohort_numerator: 1,
    cohort_denominator: 3,
    audit_hash: `sha256:${"b".repeat(64)}`,
  },
};

const selectedBandWordCount = 56;

function buildFlashLaneProofPreflight(args = {}) {
  return buildFlashLaneProofPreflightRaw({
    story: pulseStory,
    scriptWordCount: selectedBandWordCount,
    ...args,
  });
}

function assertFlashLaneProofReady(args = {}, options = {}) {
  return assertFlashLaneProofReadyRaw(
    {
      story: pulseStory,
      scriptWordCount: selectedBandWordCount,
      ...args,
    },
    options,
  );
}

function clipScene(i) {
  return { type: "clip", label: `clip_${i}`, source: `clip-${i}.mp4` };
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

  assert.equal(report.verdict, "allow", report.blockers.join(", "));
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

test("Flash Lane preflight blocks repeating too few official clips", () => {
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

test("Flash Lane preflight blocks narration above the selected duration band", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 42.1,
    },
    scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }] },
  });

  assert.equal(report.verdict, "block");
  assert.ok(
    report.blockers.includes("audio_duration_above_selected_band"),
  );
  assert.equal(report.metrics.narrationDurationS, 42.1);
  assert.equal(
    report.thresholds.durationBandId,
    "what_changes_standard_35_42",
  );
});

test("Flash Lane preflight blocks narration below the selected duration band", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 34.9,
    },
    scenes: [clipScene(1), clipScene(2), clipScene(3), clipScene(4), clipScene(5), clipScene(6)],
    media: { clips: [{ path: "a.mp4" }, { path: "b.mp4" }] },
  });

  assert.equal(report.verdict, "block");
  assert.ok(
    report.blockers.includes("audio_duration_below_selected_band"),
  );
  assert.equal(
    report.narrationPlan.recommendation,
    "regenerate_narration_within_selected_band",
  );
});

test("Flash Lane preflight accepts narration inside the selected duration band", () => {
  const report = buildFlashLaneProofPreflight({
    narration: {
      ...providedNarration,
      durationS: 40,
    },
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

  assert.equal(report.verdict, "allow", report.blockers.join(", "));
  assert.equal(report.metrics.spokenWpm, 84);
  assert.deepEqual(report.narrationPlan.targetRuntimeS, [35, 42]);
});

test("Flash Lane narration plan uses the selected band's exact word range", () => {
  const plan = buildFlashLaneNarrationPlan({
    story: pulseStory,
    scriptWordCount: 51,
  });

  assert.equal(plan.durationBandId, "what_changes_standard_35_42");
  assert.deepEqual(plan.targetRuntimeS, [35, 42]);
  assert.deepEqual(plan.targetWordRange, [52, 61]);
  assert.ok(plan.issues.includes("script_runtime_below_selected_band"));
  assert.equal(
    plan.recommendation,
    "expand_script_to_selected_band_before_voice",
  );
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
