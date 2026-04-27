"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  assTimeToSeconds,
  parseAssDialogues,
  analyseSubtitleTimeline,
  analyseAudioRecurrence,
  findRecurringScheduledAudioClusters,
  hammingDistance,
  sceneBreakdown,
  buildIssues,
  compareForensicReports,
  buildComparisonMarkdown,
} = require("../../lib/studio/v2/forensic-qa-v2");

function tempFile(contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-qa-"));
  const file = path.join(dir, "captions.ass");
  fs.writeFileSync(file, contents);
  return file;
}

function makeTransientSamples({ sampleRate = 1000, durationS = 10, timesS = [] }) {
  const samples = new Float32Array(sampleRate * durationS);
  for (const t of timesS) {
    const start = Math.round(t * sampleRate);
    for (let i = 0; i < 10 && start + i < samples.length; i++) {
      samples[start + i] = i % 2 === 0 ? 0.9 : -0.9;
    }
  }
  return { samples, sampleRate };
}

test("assTimeToSeconds parses ASS clock values", () => {
  assert.equal(assTimeToSeconds("0:00:55.36"), 55.36);
  assert.equal(assTimeToSeconds("1:02:03.50"), 3723.5);
});

test("parseAssDialogues extracts cue timing and text", () => {
  const assPath = tempFile(
    [
      "[Events]",
      "Dialogue: 0,0:00:00.00,0:00:01.20,Caption,,0,0,0,,Metro 2039",
      "Dialogue: 0,0:00:02.00,0:00:03.00,Caption,,0,0,0,,grim\\Nreveal",
    ].join("\n"),
  );
  const cues = parseAssDialogues(assPath);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].endS, 1.2);
  assert.equal(cues[1].text, "grim reveal");
});

test("analyseSubtitleTimeline warns on long caption blackout and overrun", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,one",
      "Dialogue: 0,0:00:04.25,0:00:06.00,Caption,,0,0,0,,two",
    ].join("\n"),
  );
  const result = analyseSubtitleTimeline({ assPath, durationS: 5.5 });
  assert.equal(result.verdict, "warn");
  assert.equal(result.gapsOver2s.length, 1);
  assert.equal(result.overrunS, 0.5);
});

test("analyseAudioRecurrence passes an opener-only SFX path", () => {
  const { samples, sampleRate } = makeTransientSamples({ timesS: [0] });
  const result = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: 1,
  });
  assert.equal(result.verdict, "pass");
});

test("analyseAudioRecurrence fails repeated matching transient hits", () => {
  const { samples, sampleRate } = makeTransientSamples({
    timesS: [0, 1.5, 3, 4.5, 6, 7.5],
  });
  const result = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: 6,
  });
  assert.equal(result.verdict, "fail");
  assert.ok(result.repeatedTransientClusterCount >= 1);
});

test("findRecurringScheduledAudioClusters detects cut-synchronous repeated shapes", () => {
  const timesS = [0, 1.5, 3, 4.5, 6, 7.5];
  const { samples, sampleRate } = makeTransientSamples({ timesS });
  const clusters = findRecurringScheduledAudioClusters({
    samples,
    sampleRate,
    timesS,
  });
  assert.equal(clusters[0].count, 6);
});

test("hammingDistance handles different length hashes", () => {
  assert.equal(hammingDistance("1010", "1010"), 0);
  assert.equal(hammingDistance("1010", "0011"), 2);
  assert.equal(hammingDistance("1010", "10"), 2);
});

test("sceneBreakdown reports type counts and repeated sources", () => {
  const result = sceneBreakdown({
    sceneList: [
      { type: "clip", source: "a.mp4" },
      { type: "clip", source: "b.mp4" },
      { type: "card.source", source: "source-card" },
      { type: "clip.frame", source: "a.mp4" },
    ],
    auto: {
      sourceDiversity: { value: 0.75, grade: "amber" },
      maxStillRepeat: { value: 1, grade: "green" },
      stockFillerCount: { value: 0, grade: "green" },
    },
  });
  assert.equal(result.sceneCount, 4);
  assert.equal(result.typeCounts.clip, 2);
  assert.deepEqual(result.repeatedSources, [{ source: "a.mp4", count: 2 }]);
});

test("buildIssues flags duration and audio defects", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 1 },
    subtitles: { verdict: "pass" },
    audio: { verdict: "fail", reasons: ["declared SFX cue count is 8"] },
    visual: { verdict: "pass" },
    scene: { repeatedSources: [] },
  });
  assert.equal(issues.length, 2);
  assert.equal(issues[0].code, "duration_mismatch");
  assert.equal(issues[1].code, "audio_recurrence");
});

test("buildIssues does not flag benign planned source reuse when diversity is green", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 0 },
    subtitles: { verdict: "pass" },
    audio: { verdict: "pass" },
    visual: { verdict: "pass" },
    scene: {
      declaredSourceDiversity: { value: 0.88, grade: "green" },
      repeatedSources: [
        { source: "clip-a.mp4", count: 2 },
        { source: "clip-b.mp4", count: 2 },
        { source: "frame-a.jpg", count: 2 },
        { source: "frame-b.jpg", count: 2 },
      ],
    },
  });
  assert.equal(issues.length, 0);
});

test("buildIssues flags heavy source reuse", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 0 },
    subtitles: { verdict: "pass" },
    audio: { verdict: "pass" },
    visual: { verdict: "pass" },
    scene: {
      declaredSourceDiversity: { value: 0.7, grade: "amber" },
      repeatedSources: [{ source: "same.jpg", count: 3 }],
    },
  });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "scene_source_reuse");
});

test("compareForensicReports reports material audio/subtitle improvement", () => {
  const before = {
    storyId: "before",
    summary: { verdict: "fail", issueCount: 2, failCount: 2, warnCount: 0 },
    runtime: { mp4DurationS: 51.2 },
    audio: {
      verdict: "fail",
      declaredSfxCueCount: 16,
      repeatedTransientClusterCount: 1,
    },
    subtitles: { verdict: "warn", overrunS: 4.1 },
    visual: { verdict: "pass", repeatPairCount: 1 },
  };
  const after = {
    storyId: "after",
    summary: { verdict: "pass", issueCount: 0, failCount: 0, warnCount: 0 },
    runtime: { mp4DurationS: 55.432 },
    audio: {
      verdict: "pass",
      declaredSfxCueCount: 1,
      repeatedTransientClusterCount: 0,
    },
    subtitles: { verdict: "pass", overrunS: 0 },
    visual: { verdict: "pass", repeatPairCount: 2 },
  };
  const comparison = compareForensicReports(before, after);
  assert.equal(comparison.verdict, "improved");
  assert.equal(comparison.deltas.issueCount, -2);
  assert.equal(comparison.deltas.declaredSfxCueCount, -15);
  const markdown = buildComparisonMarkdown(comparison);
  assert.match(markdown, /SFX cues/);
  assert.match(markdown, /Audio recurrence/);
});
