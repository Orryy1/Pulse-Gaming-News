"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  runDecodedVisualGate,
} = require("../../lib/studio/v2/forensic-qa-v2");

function renderFixture(outputPath, source) {
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    source,
    "-t",
    "4",
    "-r",
    "30",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
}

test("decoded visual gate rejects arbitrary bytes posing as an MP4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decoded-gate-invalid-"));
  const mp4Path = path.join(root, "fake.mp4");
  await fs.writeFile(mp4Path, Buffer.alloc(8192, 7));

  const report = await runDecodedVisualGate({
    storyId: "fake-mp4",
    mp4Path,
    outputDir: path.join(root, "qa"),
  });

  assert.equal(report.status, "fail");
  assert.equal(report.decoded_media_evidence, false);
  assert.ok(report.blockers.includes("decoded_visual_media_unreadable"));
});

test("decoded visual gate passes a genuinely moving decoded video", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decoded-gate-motion-"));
  const mp4Path = path.join(root, "moving.mp4");
  renderFixture(mp4Path, "testsrc2=size=540x960:rate=30");

  const report = await runDecodedVisualGate({
    storyId: "moving-video",
    mp4Path,
    outputDir: path.join(root, "qa"),
    frameIntervalS: 0.5,
  });

  assert.equal(report.status, "pass");
  assert.equal(report.decoded_media_evidence, true);
  assert.equal(report.frame_count >= 6, true);
  assert.equal(report.visual_repetition.repeatPairCount <= 4, true);
  assert.equal(report.rendered_frame_taste.blackFrameCount, 0);
});

test("decoded visual gate keeps extracted frame paths below the Windows media-tool limit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decoded-gate-long-path-"));
  const mp4Path = path.join(root, "moving.mp4");
  const storyId = `official_${"black_flag_".repeat(9)}`;
  const outputDir = path.join(root, `qa-${"proof_".repeat(14)}`);
  renderFixture(mp4Path, "testsrc2=size=540x960:rate=30");

  const report = await runDecodedVisualGate({
    storyId,
    mp4Path,
    outputDir,
    frameIntervalS: 0.5,
  });

  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  const resolvedFrameDir = path.resolve(process.cwd(), report.frame_dir);
  assert.equal(path.join(resolvedFrameDir, "frame_001.jpg").length < 248, true);
});

test("decoded visual gate blocks black and frozen output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-decoded-gate-black-"));
  const mp4Path = path.join(root, "black.mp4");
  renderFixture(mp4Path, "color=c=black:size=540x960:rate=30");

  const report = await runDecodedVisualGate({
    storyId: "black-video",
    mp4Path,
    outputDir: path.join(root, "qa"),
    frameIntervalS: 0.5,
  });

  assert.equal(report.status, "fail");
  assert.equal(report.decoded_media_evidence, true);
  assert.ok(report.blockers.includes("decoded_visual_black_frames_present"));
  assert.equal(report.visual_repetition.blackFrames.length > 0, true);
});
