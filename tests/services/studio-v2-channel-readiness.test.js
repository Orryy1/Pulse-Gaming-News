"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  hexToAssBgr,
  extractAssEmphasisColour,
  evaluateThemeIntegrity,
  evaluateChannelCandidate,
  buildChannelReadinessReport,
  buildChannelReadinessMarkdown,
} = require("../../lib/studio/v2/channel-readiness-v2");

function writeAss(dir, name, colour) {
  const file = path.join(dir, name);
  fs.writeFileSync(
    file,
    [
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour",
      `Style: PopEmphasis,Impact,100,${colour},${colour}`,
    ].join("\n"),
  );
  return file;
}

function baseSummary(overrides = {}) {
  return {
    key: "1sn9xhe:canonical",
    storyId: "1sn9xhe",
    variant: "canonical",
    kind: "canonical",
    channelId: "pulse-gaming",
    paths: { ass: overrides.assPath || null, mp4: "test/output/studio_v2_1sn9xhe.mp4" },
    studio: {
      lane: "pass",
      redTrips: 0,
      amberMetrics: [],
      durationS: 55,
      sourceDiversity: 0.9,
      clipDominance: 0.75,
      motionDensityPerMin: 19,
      sfxEventCount: 1,
      ...(overrides.studio || {}),
    },
    forensic: {
      verdict: "pass",
      failCount: 0,
      warnCount: 0,
      subtitleVerdict: "pass",
      visualRepeatPairs: 1,
      issues: [],
      ...(overrides.forensic || {}),
    },
    seo: {
      present: true,
      channelId: "pulse-gaming",
      validationCount: 0,
      validationFlags: [],
      ...(overrides.seo || {}),
    },
    loudness: {
      integratedLufs: -18,
      truePeakDb: -1.4,
      ...(overrides.loudness || {}),
    },
    ...overrides.rootFields,
  };
}

test("hexToAssBgr converts channel hex colours to ASS BGR", () => {
  assert.equal(hexToAssBgr("#FF6B1A"), "&H001A6BFF");
  assert.equal(hexToAssBgr("#00C853"), "&H0053C800");
  assert.equal(hexToAssBgr("#A855F7"), "&H00F755A8");
  assert.equal(hexToAssBgr("not-a-colour"), null);
});

test("extractAssEmphasisColour reads the PopEmphasis style", () => {
  const colour = extractAssEmphasisColour(`
Style: Pop,Impact,88,&H00FFFFFF,&H00FFFFFF
Style: PopEmphasis,Impact,100,&H0053C800,&H0053C800
`);
  assert.equal(colour, "&H0053C800");
});

test("evaluateThemeIntegrity validates per-channel subtitle colour", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-theme-"));
  const assPath = writeAss(dir, "stacked.ass", "&H0053C800");
  const theme = evaluateThemeIntegrity({
    root: dir,
    channelId: "stacked",
    assPath,
  });
  assert.equal(theme.expectedHex, "#00C853");
  assert.equal(theme.matches, true);
});

test("evaluateChannelCandidate passes a clean primary candidate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-readiness-"));
  const assPath = writeAss(dir, "pulse.ass", "&H001A6BFF");
  const result = evaluateChannelCandidate(baseSummary({ assPath }), { root: dir });
  assert.equal(result.verdict, "pass");
  assert.equal(result.hardFailures.length, 0);
  assert.equal(result.warnings.length, 0);
});

test("evaluateChannelCandidate warns on soft current-channel risks", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-readiness-"));
  const assPath = writeAss(dir, "signal.ass", "&H00F755A8");
  const result = evaluateChannelCandidate(
    baseSummary({
      assPath,
      rootFields: {
        key: "1sn9xhe:the-signal",
        variant: "the-signal",
        kind: "channel",
        channelId: "the-signal",
      },
      studio: {
        sourceDiversity: 0.82,
        clipDominance: 0.65,
        motionDensityPerMin: 16,
        amberMetrics: ["sourceDiversity", "motionDensityPerMin"],
      },
      forensic: { warnCount: 1, issues: ["scene_source_reuse"] },
      seo: { channelId: "the-signal" },
    }),
    { root: dir },
  );
  assert.equal(result.verdict, "warn");
  assert.ok(
    result.warnings.some((warning) => warning.code === "source_diversity_below_target"),
  );
  assert.equal(result.hardFailures.length, 0);
});

test("evaluateChannelCandidate fails missing SEO or theme mismatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-readiness-"));
  const assPath = writeAss(dir, "pulse-wrong.ass", "&H0053C800");
  const result = evaluateChannelCandidate(
    baseSummary({
      assPath,
      seo: { present: false, validationCount: null },
    }),
    { root: dir },
  );
  assert.equal(result.verdict, "fail");
  assert.ok(result.hardFailures.some((issue) => issue.code === "seo_not_clean"));
  assert.ok(
    result.hardFailures.some((issue) => issue.code === "theme_colour_mismatch"),
  );
});

test("buildChannelReadinessReport aggregates canonical and channel candidates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-readiness-"));
  const pulseAss = writeAss(dir, "pulse.ass", "&H001A6BFF");
  const stackedAss = writeAss(dir, "stacked.ass", "&H0053C800");
  const report = buildChannelReadinessReport({
    root: dir,
    gauntletReport: {
      generatedAt: "then",
      candidates: [
        baseSummary({ assPath: pulseAss }),
        baseSummary({
          assPath: stackedAss,
          rootFields: {
            key: "1sn9xhe:stacked",
            variant: "stacked",
            kind: "channel",
            channelId: "stacked",
          },
          seo: { channelId: "stacked" },
          studio: { durationS: 63 },
        }),
        {
          ...baseSummary({ assPath: pulseAss }),
          key: "1sn9xhe:nofreeze",
          variant: "nofreeze",
          kind: "variant",
        },
      ],
    },
  });
  assert.equal(report.summary.channelCount, 2);
  assert.equal(report.summary.verdict, "warn");
  assert.equal(report.summary.releaseReadyCount, 1);
});

test("buildChannelReadinessMarkdown produces a channel matrix", () => {
  const md = buildChannelReadinessMarkdown({
    generatedAt: "now",
    sourceGauntletGeneratedAt: "then",
    summary: {
      verdict: "warn",
      channelCount: 1,
      releaseReadyCount: 0,
      recurringWarningCodes: [{ code: "motion_density_below_target", count: 1 }],
    },
    channels: [
      {
        channelId: "pulse-gaming",
        verdict: "warn",
        score: 96,
        metrics: { durationS: 55, seoValidationCount: 0 },
        theme: { matches: true },
        hardFailures: [],
        warnings: [{ code: "motion_density_below_target" }],
      },
    ],
  });
  assert.match(md, /Channel Matrix/);
  assert.match(md, /pulse-gaming \| warn \| 96/);
});
