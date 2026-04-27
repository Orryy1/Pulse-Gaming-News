"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normaliseGateCandidate,
  evaluateStudioRejectionGate,
  buildGateMarkdown,
} = require("../../lib/studio/v2/studio-rejection-gate-v21");

function canonical(overrides = {}) {
  return {
    key: "1sn9xhe:canonical",
    score: 100,
    studioLane: "pass",
    forensicVerdict: "pass",
    forensicFailCount: 0,
    forensicWarnCount: 0,
    forensicIssues: [],
    audioRecurrence: "pass",
    subtitleVerdict: "pass",
    visualVerdict: "pass",
    redTrips: 0,
    sourceDiversity: 0.88,
    beatAwarenessRatio: 0.87,
    clipDominance: 0.69,
    motionDensityPerMin: 16.9,
    maxStillRepeat: 1,
    stockFillerCount: 0,
    adjacentSameTypeCards: 0,
    captionGapsOver2s: 0,
    durationIntegrity: "green",
    hyperframesCardCount: 5,
    premiumLaneVerdict: "pass",
    heroMomentCount: 0,
    heroMoments: [],
    heroOverlayApplied: false,
    ...overrides,
  };
}

test("normaliseGateCandidate extracts summary and report signals", () => {
  const result = normaliseGateCandidate({
    key: "x",
    summary: {
      key: "x",
      score: 91,
      studio: {
        lane: "pass",
        sourceDiversity: 0.9,
        beatAwarenessRatio: 0.8,
        hyperframesCardCount: 4,
      },
      forensic: {
        verdict: "pass",
        audioRecurrence: "pass",
        subtitleVerdict: "pass",
        visualVerdict: "pass",
      },
    },
    report: {
      auto: {
        maxStillRepeat: { value: 1 },
        stockFillerCount: { value: 0 },
        adjacentSameTypeCards: { value: 0 },
        captionGapsOver2s: { value: 0 },
      },
      heroMoments: { momentCount: 2, overlayApplied: true, moments: [] },
      premiumLane: { verdict: "pass", hyperframesCardCount: 4 },
    },
  });
  assert.equal(result.score, 91);
  assert.equal(result.sourceDiversity, 0.9);
  assert.equal(result.heroMomentCount, 2);
  assert.equal(result.heroOverlayApplied, true);
});

test("gate passes the current canonical when hero moments are not required", () => {
  const c = canonical();
  const report = evaluateStudioRejectionGate({
    candidate: c,
    canonical: c,
    requireHeroMoments: false,
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.hardFailReasons.length, 0);
});

test("gate rejects V2.1 candidates without meaningful hero moments", () => {
  const c = canonical();
  const candidate = canonical({ key: "1sn9xhe:v21", score: 100 });
  const report = evaluateStudioRejectionGate({
    candidate,
    canonical: c,
    requireHeroMoments: true,
  });
  assert.equal(report.verdict, "reject");
  assert.ok(
    report.hardFailReasons.some((reason) => reason.code === "missing_hero_moments"),
  );
});

test("gate rejects the known authored-style regression", () => {
  const c = canonical();
  const authored = canonical({
    key: "1sn9xhe:authored",
    score: 77,
    forensicVerdict: "warn",
    forensicWarnCount: 1,
    forensicIssues: ["audio_recurrence"],
    audioRecurrence: "warn",
    sourceDiversity: 0.81,
    beatAwarenessRatio: 0.73,
  });
  const report = evaluateStudioRejectionGate({
    candidate: authored,
    canonical: c,
    requireHeroMoments: false,
  });
  assert.equal(report.verdict, "reject");
  assert.ok(report.hardFailReasons.some((reason) => reason.code === "audio_recurrence"));
  assert.ok(report.hardFailReasons.some((reason) => reason.code === "major_gauntlet_drop"));
});

test("gate rejects synthetic black-screen and caption-corruption cases", () => {
  const c = canonical();
  const synthetic = canonical({
    key: "synthetic:black-screen",
    forensicVerdict: "fail",
    forensicFailCount: 1,
    forensicIssues: ["black_frame_segment"],
    subtitleVerdict: "warn",
    captionGapsOver2s: 2,
  });
  const report = evaluateStudioRejectionGate({
    candidate: synthetic,
    canonical: c,
    requireHeroMoments: false,
  });
  assert.equal(report.verdict, "reject");
  assert.ok(report.hardFailReasons.some((reason) => reason.code === "forensic_fail"));
  assert.ok(report.hardFailReasons.some((reason) => reason.code === "caption_blackout"));
});

test("gate passes a V2.1 candidate that preserves canonical metrics", () => {
  const c = canonical();
  const v21 = canonical({
    key: "1sn9xhe:v21",
    score: 100,
    heroMomentCount: 3,
    heroOverlayApplied: true,
    heroMoments: [{ type: "source_slam" }],
  });
  const report = evaluateStudioRejectionGate({
    candidate: v21,
    canonical: c,
    requireHeroMoments: true,
  });
  assert.equal(report.verdict, "pass");
  assert.ok(report.greenSignals.includes("hero_moments_present"));
});

test("buildGateMarkdown includes verdict, reasons, metrics and hero moments", () => {
  const md = buildGateMarkdown({
    generatedAt: "now",
    candidateKey: "x",
    verdict: "review",
    recommendedNextAction: "Review it.",
    hardFailReasons: [],
    amberWarnings: [{ code: "gauntlet_drop", message: "Dropped." }],
    greenSignals: ["subtitle_pass"],
    metrics: { gauntletScore: 91 },
    comparisonAgainstCanonical: { scoreDrop: 9 },
    heroMoments: [{ type: "source_slam", targetTimestampS: 2, editorialReason: "source" }],
  });
  assert.match(md, /Final verdict: review/);
  assert.match(md, /gauntlet_drop/);
  assert.match(md, /source_slam/);
});
