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
  analyseSubtitleDensity,
  FLASH_LANE_SUBTITLE_DENSITY_OPTIONS,
  analyseAudioPresence,
  analyseAudioRecurrence,
  findRecurringScheduledAudioClusters,
  hammingDistance,
  filterRepeatPairsByIgnoreRanges,
  buildVisualRepeatIgnoreRanges,
  analyseRenderedFrameTaste,
  analyseRenderConsistency,
  analyseReportTextHygiene,
  sceneBreakdown,
  buildIssues,
  compareForensicReports,
  buildComparisonMarkdown,
  transcriptTextFromReport,
  buildFrameExtractionFilter,
} = require("../../lib/studio/v2/forensic-qa-v2");

function tempFile(contents, fileName = "captions.ass") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-v2-qa-"));
  const file = path.join(dir, fileName);
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

test("forensic frame extraction samples exact decoded frame indexes", () => {
  const filter = buildFrameExtractionFilter({ fps: 30, intervalS: 0.5 });

  assert.match(filter, /select='not\(mod\(n\\,15\)\)'/);
  assert.doesNotMatch(filter, /^fps=/);
  assert.match(filter, /scale=270:480/);
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

test("analyseSubtitleTimeline accepts short natural narration pauses", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:19.80,0:00:21.26,Caption,,0,0,0,,before launch",
      "Dialogue: 0,0:00:23.92,0:00:24.60,Caption,,0,0,0,,it is still",
    ].join("\n"),
  );
  const result = analyseSubtitleTimeline({ assPath, durationS: 25 });

  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.gapsOver2s, []);
});

test("analyseSubtitleTimeline warns when video keeps rolling after the final caption", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:57.80,0:01:00.96,Caption,,0,0,0,,Follow Pulse Gaming",
    ].join("\n"),
  );
  const result = analyseSubtitleTimeline({
    assPath,
    durationS: 69.62,
    maxTailAfterLastCueS: 3,
  });

  assert.equal(result.verdict, "warn");
  assert.equal(result.tailAfterLastCueS, 8.66);
});

test("forensic transcript lookup reads still-deck voice transcript metadata", () => {
  const transcript = transcriptTextFromReport({
    voice: {
      transcript:
        "Forza Horizon 6 hit 130,000 concurrent players on Steam. Follow Pulse Gaming so you never miss a beat.",
    },
  });

  assert.match(transcript, /130,000 concurrent players/);
});

test("analyseSubtitleTimeline fails near-zero, overlapping and non-monotonic ASS cues", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,first beat",
      "Dialogue: 0,0:00:01.20,0:00:01.23,Caption,,0,0,0,,blink caption",
      "Dialogue: 0,0:00:01.10,0:00:02.00,Caption,,0,0,0,,late source order",
    ].join("\n"),
  );

  const result = analyseSubtitleTimeline({ assPath, durationS: 3 });

  assert.equal(result.verdict, "fail");
  assert.equal(result.nearZeroDurationCues.length, 1);
  assert.equal(result.overlappingCues.length, 1);
  assert.equal(result.nonMonotonicCues.length, 1);
});

test("analyseSubtitleTimeline catches SRT overlaps and repeated consecutive text", () => {
  const srtPath = tempFile(
    [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "Hello there",
      "",
      "2",
      "00:00:00,900 --> 00:00:02,000",
      "Hello there",
      "",
      "3",
      "00:00:02,000 --> 00:00:02,020",
      "Tiny",
      "",
    ].join("\n"),
    "captions.srt",
  );

  const result = analyseSubtitleTimeline({ srtPath, durationS: 3 });

  assert.equal(result.verdict, "fail");
  assert.equal(result.cueCount, 3);
  assert.equal(result.overlappingCues.length, 1);
  assert.equal(result.repeatedTextCues.length, 1);
  assert.equal(result.nearZeroDurationCues.length, 1);
});

test("analyseSubtitleTimeline fails low transcript coverage when transcript is available", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,GTA delay",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Caption,,0,0,0,,watch now",
    ].join("\n"),
  );
  const transcriptText =
    "Nintendo Direct announced the Metroid Prime release date today, with a follow-up showcase expected later.";

  const result = analyseSubtitleTimeline({
    assPath,
    durationS: 3,
    transcriptText,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.transcriptCoverage.verdict, "fail");
  assert.ok(result.transcriptCoverage.ratio < 0.35);
});

test("analyseSubtitleDensity warns on dense multi-line captions", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:01.00,Caption,,0,0,0,,Take-Two boss Strauss Zelnick has shared a story\\Nabout passing on a legacy sequel",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Caption,,0,0,0,,wait what",
    ].join("\n"),
  );
  const result = analyseSubtitleDensity({ assPath });

  assert.equal(result.verdict, "warn");
  assert.equal(result.cueCount, 2);
  assert.equal(result.maxWordsPerCue, 14);
  assert.equal(result.multiLineCueCount, 1);
  assert.equal(result.worstCues[0].wordCount, 14);
});

test("analyseSubtitleDensity passes punchy single-line captions", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:00.80,Caption,,0,0,0,,wait what",
      "Dialogue: 0,0:00:00.80,0:00:01.60,Caption,,0,0,0,,GTA moved",
      "Dialogue: 0,0:00:01.60,0:00:02.40,Caption,,0,0,0,,no date yet",
    ].join("\n"),
  );
  const result = analyseSubtitleDensity({ assPath });

  assert.equal(result.verdict, "pass");
  assert.equal(result.maxWordsPerCue, 3);
  assert.equal(result.multiLineCueCount, 0);
});

test("analyseSubtitleDensity fails multi-line captions in strict Flash Lane mode", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:01.20,Caption,,0,0,0,,Take-Two killed\\Na legacy sequel",
      "Dialogue: 0,0:00:01.20,0:00:02.00,Caption,,0,0,0,,wait what",
    ].join("\n"),
  );
  const result = analyseSubtitleDensity({
    assPath,
    ...FLASH_LANE_SUBTITLE_DENSITY_OPTIONS,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.multiLineCueCount, 1);
  assert.equal(result.maxVisualLineCount, 2);
  assert.ok(result.reasons.some((r) => /visual lines/.test(r)));
});

test("analyseSubtitleDensity fails long one-line captions in strict Flash Lane mode", () => {
  const assPath = tempFile(
    [
      "Dialogue: 0,0:00:00.00,0:00:01.40,Caption,,0,0,0,,Developer passion has become a hard veto",
      "Dialogue: 0,0:00:01.40,0:00:02.00,Caption,,0,0,0,,no date yet",
    ].join("\n"),
  );
  const result = analyseSubtitleDensity({
    assPath,
    ...FLASH_LANE_SUBTITLE_DENSITY_OPTIONS,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.longCueCount, 1);
  assert.equal(result.maxCharsPerCue, 40);
  assert.ok(result.reasons.some((r) => /characters/.test(r)));
});

test("analyseAudioPresence fails silent narration tracks", () => {
  const result = analyseAudioPresence({
    samples: new Float32Array(16000),
    sampleRate: 16000,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.reason, "audio_missing_or_silent");
  assert.equal(result.nonSilentRatio, 0);
});

test("analyseAudioPresence passes audible narration tracks", () => {
  const samples = new Float32Array(16000);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = 0.1 * Math.sin((i / 16000) * Math.PI * 240);
  }
  const result = analyseAudioPresence({ samples, sampleRate: 16000 });

  assert.equal(result.verdict, "pass");
  assert.ok(result.rms > 0.05);
  assert.ok(result.nonSilentRatio > 0.9);
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

test("analyseAudioRecurrence ignores smooth repeated bed/voice shapes without transient hits", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(sampleRate * 10);
  const scheduledTimesS = [0, 1, 2, 3, 4, 5, 6];
  for (const timeS of scheduledTimesS) {
    const start = Math.round(timeS * sampleRate);
    for (let i = 0; i < 450; i++) {
      samples[start + i] = 0.2 * Math.sin((i / 450) * Math.PI * 8);
    }
  }
  const result = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: 1,
    scheduledTimesS,
  });
  assert.equal(result.transientCandidateCount, 0);
  assert.equal(result.worstScheduledCluster.count, 7);
  assert.equal(result.verdict, "pass");
});

test("analyseAudioRecurrence allows four declared studio cues without transient evidence", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(sampleRate * 10);
  const scheduledTimesS = [0, 1, 2, 3, 4, 5, 6];
  for (const timeS of scheduledTimesS) {
    const start = Math.round(timeS * sampleRate);
    for (let i = 0; i < 450; i++) {
      samples[start + i] = 0.2 * Math.sin((i / 450) * Math.PI * 8);
    }
  }
  const result = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: 4,
    scheduledTimesS,
  });

  assert.equal(result.transientCandidateCount, 0);
  assert.equal(result.worstScheduledCluster.count, 7);
  assert.equal(result.verdict, "pass");
  assert.deepEqual(result.reasons, []);
});

test("analyseAudioRecurrence warns on strict repeated cut-synchronous SFX signatures", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(sampleRate * 10);
  const scheduledTimesS = [0, 1, 2, 3, 4, 5, 6];
  for (const timeS of scheduledTimesS) {
    const start = Math.round(timeS * sampleRate);
    for (let i = 0; i < 450; i++) {
      samples[start + i] = 0.2 * Math.sin((i / 450) * Math.PI * 8);
    }
  }

  const result = analyseAudioRecurrence({
    samples,
    sampleRate,
    declaredSfxCueCount: 3,
    scheduledTimesS,
    strictScheduledRecurrence: true,
  });

  assert.equal(result.transientCandidateCount, 0);
  assert.equal(result.worstScheduledCluster.count, 7);
  assert.equal(result.verdict, "warn");
  assert.match(result.reasons.join(" "), /cut-synchronous/);
});

test("hammingDistance handles different length hashes", () => {
  assert.equal(hammingDistance("1010", "1010"), 0);
  assert.equal(hammingDistance("1010", "0011"), 2);
  assert.equal(hammingDistance("1010", "10"), 2);
});

test("visual repeat filtering ignores deliberate card holds", () => {
  const pairs = [
    { aTimeS: 16.5, bTimeS: 39, hamming: 6 },
    { aTimeS: 52.5, bTimeS: 55.5, hamming: 4 },
    { aTimeS: 60, bTimeS: 66, hamming: 4 },
  ];
  const filtered = filterRepeatPairsByIgnoreRanges(pairs, [
    { startS: 52, endS: 57, reason: "quote_card_hold" },
    { startS: 58, endS: 70, reason: "takeaway_hold" },
  ]);

  assert.deepEqual(filtered, [{ aTimeS: 16.5, bTimeS: 39, hamming: 6 }]);
});

test("visual repeat ignore ranges are derived from quote and takeaway scenes", () => {
  const ranges = buildVisualRepeatIgnoreRanges({
    sceneList: [
      { type: "clip", duration: 4 },
      { type: "clip.frame", duration: 4 },
      { type: "card.quote", duration: 3 },
      { type: "card.takeaway", duration: 5 },
    ],
  });

  assert.deepEqual(ranges, [
    { startS: 8, endS: 11, reason: "quote_card_hold" },
    { startS: 11, endS: 16, reason: "takeaway_hold" },
  ]);
});

test("analyseRenderedFrameTaste fails rendered rating and title slates", async () => {
  const result = await analyseRenderedFrameTaste({
    frames: [
      {
        path: "rating-slate.jpg",
        timeS: 0,
        prescan: {
          text_overlay_likelihood: 0.36,
          white_text_on_dark_likelihood: 0.82,
          edge_density: 0.08,
          saturation_mean: 0.08,
          bright_pixel_ratio: 0.08,
          dark_pixel_ratio: 0.81,
        },
      },
      {
        path: "gameplay.jpg",
        timeS: 3,
        prescan: {
          text_overlay_likelihood: 0.04,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.28,
          saturation_mean: 0.48,
          bright_pixel_ratio: 0.08,
          dark_pixel_ratio: 0.18,
        },
      },
    ],
    prescanFrame: async (frame) => frame.prescan,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.badFrameCount, 1);
  assert.equal(result.ratingOrTitleFrameCount, 1);
  assert.equal(result.badFrames[0].reason, "white_text_on_dark_card");
});

test("analyseRenderedFrameTaste ignores colourful subtitle overlay false positives", async () => {
  const result = await analyseRenderedFrameTaste({
    frames: [
      {
        path: "captioned-gameplay.jpg",
        timeS: 18.5,
        prescan: {
          text_overlay_likelihood: 0.05,
          white_text_on_dark_likelihood: 0.58,
          edge_density: 0.12,
          saturation_mean: 0.52,
          bright_pixel_ratio: 0.027,
          dark_pixel_ratio: 0.62,
        },
      },
    ],
    prescanFrame: async (frame) => frame.prescan,
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.badFrameCount, 0);
  assert.equal(result.samples[0].reason, "subtitle_overlay_taste_ignored");
});

test("analyseRenderedFrameTaste fails low-information rendered frames", async () => {
  const result = await analyseRenderedFrameTaste({
    frames: [
      {
        path: "blurry-corner.jpg",
        timeS: 38,
        prescan: {
          text_overlay_likelihood: 0.02,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.02,
          saturation_mean: 0.11,
          bright_pixel_ratio: 0.06,
          dark_pixel_ratio: 0.46,
        },
      },
      {
        path: "good-gameplay.jpg",
        timeS: 40,
        prescan: {
          text_overlay_likelihood: 0.04,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.24,
          saturation_mean: 0.5,
          bright_pixel_ratio: 0.08,
          dark_pixel_ratio: 0.2,
        },
      },
    ],
    prescanFrame: async (frame) => frame.prescan,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.lowInformationFrameCount, 1);
  assert.equal(result.badFrames[0].reason, "low_visual_information_frame");
});

test("analyseRenderedFrameTaste fails black, blurred and low-detail rendered frames", async () => {
  const result = await analyseRenderedFrameTaste({
    frames: [
      {
        path: "black.jpg",
        timeS: 9,
        black_frame: true,
        prescan: {
          edge_density: 0,
          saturation_mean: 0,
          dark_pixel_ratio: 0.96,
          bright_pixel_ratio: 0,
        },
      },
      {
        path: "blurred.jpg",
        timeS: 12,
        blur_verdict: "fail",
        prescan: {
          edge_density: 0.035,
          saturation_mean: 0.2,
          dark_pixel_ratio: 0.34,
          bright_pixel_ratio: 0.08,
        },
      },
    ],
    prescanFrame: async (frame) => frame.prescan,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.blackFrameCount, 1);
  assert.equal(result.blurredFrameCount, 1);
  assert.equal(result.lowInformationFrameCount, 2);
  assert.deepEqual(
    result.badFrames.map((frame) => frame.reason),
    ["black_frame", "blurred_frame"],
  );
});

test("analyseRenderedFrameTaste groups repeated title and rating slate frames", async () => {
  const ratingPrescan = {
    text_overlay_likelihood: 0.36,
    white_text_on_dark_likelihood: 0.82,
    edge_density: 0.08,
    saturation_mean: 0.08,
    bright_pixel_ratio: 0.08,
    dark_pixel_ratio: 0.81,
  };
  const result = await analyseRenderedFrameTaste({
    frames: [
      { path: "rating-a.jpg", timeS: 0, content_hash: "same-rating", prescan: ratingPrescan },
      { path: "rating-b.jpg", timeS: 1.5, content_hash: "same-rating", prescan: ratingPrescan },
      { path: "rating-c.jpg", timeS: 3, content_hash: "same-rating", prescan: ratingPrescan },
    ],
    prescanFrame: async (frame) => frame.prescan,
  });

  assert.equal(result.verdict, "fail");
  assert.equal(result.badFrameCount, 3);
  assert.equal(result.uniqueBadFrameCount, 1);
  assert.equal(result.duplicateBadFrameCount, 2);
  assert.equal(result.badFrames.length, 1);
  assert.equal(result.badFrames[0].duplicateCount, 3);
  assert.deepEqual(result.badFrames[0].duplicateTimesS, [0, 1.5, 3]);
});

test("analyseRenderedFrameTaste passes detailed gameplay-like samples", async () => {
  const result = await analyseRenderedFrameTaste({
    frames: [
      {
        path: "gameplay-a.jpg",
        timeS: 12,
        prescan: {
          text_overlay_likelihood: 0.03,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.31,
          saturation_mean: 0.55,
          bright_pixel_ratio: 0.1,
          dark_pixel_ratio: 0.16,
        },
      },
      {
        path: "gameplay-b.jpg",
        timeS: 14,
        prescan: {
          text_overlay_likelihood: 0.08,
          white_text_on_dark_likelihood: 0,
          edge_density: 0.2,
          saturation_mean: 0.42,
          bright_pixel_ratio: 0.12,
          dark_pixel_ratio: 0.26,
        },
      },
    ],
    prescanFrame: async (frame) => frame.prescan,
  });

  assert.equal(result.verdict, "pass");
  assert.equal(result.badFrameCount, 0);
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

test("sceneBreakdown treats distinct official clip offsets as different visual beats", () => {
  const result = sceneBreakdown({
    sceneList: [
      { type: "clip", source: "trailer.m3u8", mediaStartS: 36 },
      { type: "clip", source: "trailer.m3u8", mediaStartS: 42.4 },
      { type: "clip", source: "trailer.m3u8", mediaStartS: 48.4 },
      { type: "clip.frame", source: "same-frame.jpg" },
      { type: "clip.frame", source: "same-frame.jpg" },
    ],
    auto: {
      sourceDiversity: { value: 0.9, grade: "green" },
      maxStillRepeat: { value: 1, grade: "green" },
      stockFillerCount: { value: 0, grade: "green" },
    },
  });

  assert.deepEqual(result.repeatedSources, [{ source: "same-frame.jpg", count: 2 }]);
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

test("buildIssues flags silent audio and dense subtitles", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 0 },
    subtitles: {
      verdict: "pass",
      density: {
        verdict: "warn",
        maxWordsPerCue: 14,
        multiLineCueCount: 1,
        denseCueCount: 1,
      },
    },
    audio: {
      verdict: "pass",
      presence: {
        verdict: "fail",
        reason: "audio_missing_or_silent",
        rms: 0,
        peak: 0,
      },
    },
    visual: { verdict: "pass" },
    scene: { repeatedSources: [] },
  });

  assert.equal(issues.length, 2);
  assert.equal(issues[0].code, "subtitle_density");
  assert.equal(issues[0].severity, "warn");
  assert.equal(issues[1].code, "audio_presence");
  assert.equal(issues[1].severity, "fail");
});

test("buildIssues treats corrupt subtitle timelines as hard forensic failures", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 0 },
    subtitles: {
      verdict: "fail",
      nearZeroDurationCues: [{ startS: 1, endS: 1.02, text: "blink" }],
      overlappingCues: [],
      nonMonotonicCues: [],
      repeatedTextCues: [],
    },
    audio: { verdict: "pass" },
    visual: { verdict: "pass" },
    scene: { repeatedSources: [] },
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "subtitle_timeline");
  assert.equal(issues[0].severity, "fail");
});

test("buildIssues flags rendered frame taste failures", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 0 },
    subtitles: { verdict: "pass" },
    audio: { verdict: "pass" },
    visual: {
      verdict: "pass",
      taste: {
        verdict: "fail",
        badFrameCount: 1,
        ratingOrTitleFrameCount: 1,
        badFrames: [
          {
            frame: "rating-slate.jpg",
            timeS: 0,
            reason: "white_text_on_dark_card",
          },
        ],
      },
    },
    scene: { repeatedSources: [] },
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, "rendered_frame_taste");
  assert.equal(issues[0].severity, "fail");
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

test("analyseRenderConsistency fails blocked V4 renders and planned SFX mismatches", () => {
  const consistency = analyseRenderConsistency({
    visualV4: {
      verdict: "director_blocked",
      blockers: ["actual_motion_clip_minimum_not_met"],
      sfxPlan: { cue_count: 8 },
      soundTransitionPlan: { sfx: { cue_count: 8 } },
    },
    auto: {
      sfxEventCount: { value: 4 },
    },
  });

  assert.equal(consistency.verdict, "fail");
  assert.deepEqual(
    consistency.issues.map((issue) => issue.code),
    ["visual_v4_blocked_render", "sfx_plan_render_mismatch"],
  );
});

test("analyseReportTextHygiene finds mojibake in nested public report text", () => {
  const hygiene = analyseReportTextHygiene({
    story: {
      title: "Pok\u00c3\u00a9mon Games\u00e2\u20ac\u2122 biggest issue",
    },
    visualV4: {
      beats: [{ text: "Metacritic\u00e2\u20ac\u2122s score card" }],
    },
  });

  assert.equal(hygiene.verdict, "warn");
  assert.ok(hygiene.samples.length >= 2);
  assert.ok(hygiene.samples.some((sample) => sample.path === "story.title"));
});

test("buildIssues includes V4 consistency and text hygiene gates", () => {
  const issues = buildIssues({
    runtime: { durationDeltaS: 0 },
    subtitles: { verdict: "pass" },
    audio: { verdict: "pass" },
    visual: { verdict: "pass" },
    scene: { repeatedSources: [] },
    renderReport: {
      story: { title: "Pok\u00c3\u00a9mon Games\u00e2\u20ac\u2122 biggest issue" },
      visualV4: {
        verdict: "director_blocked",
        blockers: ["actual_motion_clip_minimum_not_met"],
        sfxPlan: { cue_count: 8 },
      },
      auto: { sfxEventCount: { value: 4 } },
    },
  });

  assert.deepEqual(
    issues.map((issue) => issue.code),
    [
      "visual_v4_blocked_render",
      "sfx_plan_render_mismatch",
      "report_text_hygiene",
    ],
  );
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
