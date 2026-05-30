"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const test = require("node:test");

const {
  auditRenderedAudioSegments,
  buildSegmentWindows,
  evaluateAudioSegmentLoudness,
  parseVolumedetectStats,
} = require("../../lib/render-audio-segment-qa");
const {
  normaliseCandidates,
  parseArgs,
} = require("../../tools/render-audio-segment-audit");

const ROOT = path.resolve(__dirname, "..", "..");

test("render audio segment QA parses ffmpeg volumedetect output", () => {
  const stats = parseVolumedetectStats(`
    [Parsed_volumedetect_0 @ 000001] mean_volume: -17.8 dB
    [Parsed_volumedetect_0 @ 000001] max_volume: -2.4 dB
  `);

  assert.equal(stats.mean_volume_db, -17.8);
  assert.equal(stats.max_volume_db, -2.4);
});

test("render audio segment QA builds stable windows across a short", () => {
  const windows = buildSegmentWindows({ durationS: 39.3, segmentCount: 6, sampleDurationS: 4 });

  assert.equal(windows.length, 6);
  assert.equal(windows[0].start_s, 1);
  assert.ok(windows.at(-1).start_s <= 34.3);
  assert.ok(windows.every((window) => window.duration_s === 4));
});

test("render audio segment QA blocks a late local-TTS volume jump", () => {
  const report = evaluateAudioSegmentLoudness({
    segments: [
      { start_s: 1, mean_volume_db: -19.5, max_volume_db: -3.3 },
      { start_s: 7, mean_volume_db: -19.1, max_volume_db: -3.1 },
      { start_s: 13, mean_volume_db: -18.8, max_volume_db: -3.0 },
      { start_s: 19, mean_volume_db: -11.5, max_volume_db: -1.8 },
      { start_s: 25, mean_volume_db: -11.2, max_volume_db: -1.6 },
      { start_s: 31, mean_volume_db: -11.0, max_volume_db: -1.5 },
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.blockers.includes("voice_segment_loudness_jump"));
  assert.ok(report.blockers.includes("voice_segment_loudness_late_jump"));
});

test("render audio segment QA passes controlled narration levels", () => {
  const report = evaluateAudioSegmentLoudness({
    segments: [
      { start_s: 1, mean_volume_db: -16.6, max_volume_db: -2.9 },
      { start_s: 7, mean_volume_db: -15.9, max_volume_db: -2.5 },
      { start_s: 13, mean_volume_db: -16.3, max_volume_db: -2.7 },
      { start_s: 19, mean_volume_db: -15.4, max_volume_db: -2.2 },
      { start_s: 25, mean_volume_db: -16.1, max_volume_db: -2.8 },
      { start_s: 31, mean_volume_db: -15.8, max_volume_db: -2.6 },
    ],
  });

  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.blockers, []);
});

test("render audio segment QA measures via injected ffmpeg command", async () => {
  const calls = [];
  const execFileImpl = async (_bin, args) => {
    calls.push(args);
    return {
      stderr: "[Parsed_volumedetect_0] mean_volume: -16.0 dB\n[Parsed_volumedetect_0] max_volume: -2.0 dB",
    };
  };

  const report = await auditRenderedAudioSegments({
    storyId: "story-audio",
    inputPath: "render.mp4",
    durationS: 40,
    execFileImpl,
    generatedAt: "2026-05-24T20:30:00.000Z",
  });

  assert.equal(report.verdict, "pass");
  assert.equal(report.story_id, "story-audio");
  assert.equal(report.segments.length, 6);
  assert.ok(calls.every((args) => args.includes("volumedetect")));
  assert.equal(report.safety.mutates_media, false);
});

test("render audio segment audit CLI accepts story package manifests", () => {
  const args = parseArgs([
    "node",
    "tools/render-audio-segment-audit.js",
    "--story-packages",
    "output/goal-contract/story-packages.json",
    "--limit",
    "30",
    "--json",
  ]);

  assert.equal(args.storyPackages, "output/goal-contract/story-packages.json");
  assert.equal(args.limit, 30);
  assert.equal(args.json, true);
  assert.deepEqual(normaliseCandidates({ story_packages: [{ story_id: "one" }] }), [
    { story_id: "one" },
  ]);
});

test("render audio segment audit command is registered for operator repair runs", async () => {
  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:render-audio-segment-audit"],
    "node tools/render-audio-segment-audit.js",
  );
});
