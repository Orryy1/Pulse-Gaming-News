"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildFacebookTranscodeArgs,
  facebookMediaNeedsOptimisation,
} = require("../../lib/platforms/facebook-reel-media");

function probe({
  bitRate = 30_000_000,
  fps = "30/1",
  audioRate = "48000",
  channels = 1,
  videoCodec = "h264",
  audioCodec = "aac",
} = {}) {
  return {
    format: { bit_rate: String(bitRate), size: "200000000" },
    streams: [
      {
        codec_type: "video",
        codec_name: videoCodec,
        profile: "High",
        pix_fmt: "yuv420p",
        width: 1080,
        height: 1920,
        avg_frame_rate: fps,
      },
      {
        codec_type: "audio",
        codec_name: audioCodec,
        sample_rate: audioRate,
        channels,
      },
    ],
  };
}

test("facebookMediaNeedsOptimisation catches oversized master encodes and mono 48 kHz audio", () => {
  const result = facebookMediaNeedsOptimisation(probe());

  assert.equal(result.required, true);
  assert.ok(result.reasons.includes("video_bitrate_above_12mbps"));
  assert.ok(result.reasons.includes("audio_not_stereo"));
  assert.ok(result.reasons.includes("audio_sample_rate_not_44100"));
});

test("facebookMediaNeedsOptimisation accepts a Meta-native delivery encode", () => {
  const result = facebookMediaNeedsOptimisation(
    probe({ bitRate: 8_000_000, audioRate: "44100", channels: 2 }),
  );

  assert.deepEqual(result, { required: false, reasons: [] });
});

test("buildFacebookTranscodeArgs creates a premium, bounded, fast-start Reel", () => {
  const args = buildFacebookTranscodeArgs("master.mp4", "facebook.mp4");
  const joined = args.join(" ");

  assert.match(joined, /-c:v libx264/);
  assert.match(joined, /-profile:v high/);
  assert.match(joined, /-level:v 4\.1/);
  assert.match(joined, /-pix_fmt yuv420p/);
  assert.match(joined, /-r 30/);
  assert.match(joined, /-maxrate 10M/);
  assert.match(joined, /-crf 18/);
  assert.match(joined, /-movflags \+faststart/);
  assert.match(joined, /-c:a aac/);
  assert.match(joined, /-b:a 128k/);
  assert.match(joined, /-ar 44100/);
  assert.match(joined, /-ac 2/);
  assert.equal(args.at(-1), "facebook.mp4");
});

test("Facebook uploader sends the prepared delivery encode, not the oversized master", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "..", "upload_facebook.js"),
    "utf8",
  );

  assert.match(source, /prepareFacebookReelMedia\(exportedAbs\)/);
  assert.match(source, /fs\.createReadStream\(delivery\.path\)/);
  assert.match(source, /fs\.stat\(delivery\.path\)/);
});
