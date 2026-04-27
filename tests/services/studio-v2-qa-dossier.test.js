"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  recommendationForWarning,
  buildQaDossier,
  buildQaDossierMarkdown,
} = require("../../lib/studio/v2/qa-dossier-v2");

test("recommendationForWarning maps known warning codes to actions", () => {
  assert.match(
    recommendationForWarning("motion_density_below_target"),
    /motion grammar beat/,
  );
  assert.match(recommendationForWarning("unknown_code"), /Inspect this warning code/);
});

test("buildQaDossier separates current channels from historical failures", () => {
  const report = buildQaDossier({
    outputDir: process.cwd(),
    gauntletReport: {
      summary: { verdict: "fail", bestCandidate: "1sn9xhe:canonical" },
      candidates: [
        {
          key: "1sn9xhe:canonical",
          kind: "canonical",
          studio: { lane: "pass", redTrips: 0 },
          forensic: { verdict: "pass" },
          paths: { mp4: "test/output/studio_v2_1sn9xhe.mp4" },
        },
        {
          key: "1sn9xhe:snapshot-old",
          kind: "snapshot",
          studio: { lane: "pass", redTrips: 0, redMetrics: [] },
          forensic: { verdict: "fail", issues: ["subtitle_timeline"] },
          paths: { mp4: "test/output/old.mp4" },
        },
      ],
    },
    readinessReport: {
      summary: {
        verdict: "warn",
        bestChannel: "pulse-gaming",
        channelCount: 1,
        releaseReadyCount: 0,
        recurringWarningCodes: [
          { code: "motion_density_below_target", count: 1 },
        ],
      },
      channels: [
        {
          channelId: "pulse-gaming",
          verdict: "warn",
          score: 92,
          hardFailures: [],
          warnings: [{ code: "motion_density_below_target" }],
          theme: { matches: true },
          metrics: { durationS: 55 },
          paths: { mp4: "test/output/studio_v2_1sn9xhe.mp4" },
        },
      ],
    },
  });
  assert.equal(report.summary.currentChannelVerdict, "warn");
  assert.equal(report.summary.historicalFailureCount, 1);
  assert.equal(report.recommendations.length, 1);
});

test("buildQaDossierMarkdown includes matrix, fix queue and history", () => {
  const md = buildQaDossierMarkdown({
    generatedAt: "now",
    summary: {
      gauntletVerdict: "fail",
      currentChannelVerdict: "warn",
      bestCurrentChannel: "pulse-gaming",
      currentReleaseReadyCount: 0,
      currentChannelCount: 1,
      historicalFailureCount: 1,
    },
    channelRows: [
      {
        channelId: "pulse-gaming",
        verdict: "warn",
        score: 92,
        blockerCodes: [],
        warningCodes: ["motion_density_below_target"],
        themeMatches: true,
        metrics: { durationS: 55 },
      },
    ],
    recommendations: [
      {
        code: "motion_density_below_target",
        count: 1,
        recommendation: "Add one more meaningful motion grammar beat.",
      },
    ],
    historicalFailures: [
      {
        key: "old",
        kind: "snapshot",
        studioLane: "pass",
        forensicVerdict: "fail",
        redMetrics: [],
        issues: ["subtitle_timeline"],
      },
    ],
    artefacts: { gauntletHtml: "studio_v2_gauntlet.html" },
  });
  assert.match(md, /Current Channels/);
  assert.match(md, /Fix Queue/);
  assert.match(md, /Historical Regression Evidence/);
});
