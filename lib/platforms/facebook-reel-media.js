"use strict";

const path = require("node:path");
const { execFile } = require("node:child_process");
const util = require("node:util");
const fsExtra = require("fs-extra");

const execFileAsync = util.promisify(execFile);
const FACEBOOK_DELIVERY_VERSION = "v1";

function firstStream(probe, type) {
  return (Array.isArray(probe?.streams) ? probe.streams : []).find(
    (stream) => stream?.codec_type === type,
  );
}

function frameRate(value) {
  const [numerator, denominator] = String(value || "0/1")
    .split("/")
    .map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || !denominator) {
    return 0;
  }
  return numerator / denominator;
}

function facebookMediaNeedsOptimisation(probe = {}) {
  const reasons = [];
  const video = firstStream(probe, "video") || {};
  const audio = firstStream(probe, "audio") || {};
  const bitRate = Number(video.bit_rate || probe.format?.bit_rate || 0);

  if (String(video.codec_name || "").toLowerCase() !== "h264") {
    reasons.push("video_codec_not_h264");
  }
  if (String(video.pix_fmt || "").toLowerCase() !== "yuv420p") {
    reasons.push("video_pixel_format_not_yuv420p");
  }
  if (frameRate(video.avg_frame_rate || video.r_frame_rate) > 30.01) {
    reasons.push("video_frame_rate_above_30fps");
  }
  if (Number.isFinite(bitRate) && bitRate > 12_000_000) {
    reasons.push("video_bitrate_above_12mbps");
  }
  if (String(audio.codec_name || "").toLowerCase() !== "aac") {
    reasons.push("audio_codec_not_aac");
  }
  if (Number(audio.channels || 0) !== 2) {
    reasons.push("audio_not_stereo");
  }
  if (Number(audio.sample_rate || 0) !== 44_100) {
    reasons.push("audio_sample_rate_not_44100");
  }

  return { required: reasons.length > 0, reasons };
}

function buildFacebookTranscodeArgs(inputPath, outputPath) {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-profile:v",
    "high",
    "-level:v",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-fps_mode",
    "cfr",
    "-g",
    "60",
    "-keyint_min",
    "60",
    "-sc_threshold",
    "0",
    "-crf",
    "18",
    "-maxrate",
    "10M",
    "-bufsize",
    "20M",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-map_metadata",
    "-1",
    outputPath,
  ];
}

async function probeFacebookMedia(mediaPath, { runExecFile = execFileAsync } = {}) {
  const result = await runExecFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      mediaPath,
    ],
    { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 },
  );
  return JSON.parse(result.stdout);
}

function defaultDeliveryPath(inputPath) {
  return path.join(
    path.dirname(inputPath),
    `facebook_reels_delivery_${FACEBOOK_DELIVERY_VERSION}.mp4`,
  );
}

async function prepareFacebookReelMedia(
  inputPath,
  {
    outputPath = defaultDeliveryPath(inputPath),
    fs = fsExtra,
    runExecFile = execFileAsync,
  } = {},
) {
  const inputProbe = await probeFacebookMedia(inputPath, { runExecFile });
  const inputAssessment = facebookMediaNeedsOptimisation(inputProbe);
  if (!inputAssessment.required) {
    return {
      path: inputPath,
      optimised: false,
      reused: false,
      reasons: [],
      probe: inputProbe,
    };
  }

  const inputStat = await fs.stat(inputPath);
  if (await fs.pathExists(outputPath)) {
    const outputStat = await fs.stat(outputPath);
    if (outputStat.mtimeMs >= inputStat.mtimeMs) {
      const outputProbe = await probeFacebookMedia(outputPath, { runExecFile });
      const outputAssessment = facebookMediaNeedsOptimisation(outputProbe);
      if (!outputAssessment.required) {
        return {
          path: outputPath,
          optimised: true,
          reused: true,
          reasons: inputAssessment.reasons,
          probe: outputProbe,
        };
      }
    }
  }

  await fs.ensureDir(path.dirname(outputPath));
  const tempPath = `${outputPath}.tmp-${process.pid}.mp4`;
  try {
    await runExecFile(
      "ffmpeg",
      buildFacebookTranscodeArgs(inputPath, tempPath),
      { timeout: 20 * 60_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const outputProbe = await probeFacebookMedia(tempPath, { runExecFile });
    const outputAssessment = facebookMediaNeedsOptimisation(outputProbe);
    if (outputAssessment.required) {
      throw new Error(
        `Facebook delivery encode failed compliance: ${outputAssessment.reasons.join(",")}`,
      );
    }
    await fs.move(tempPath, outputPath, { overwrite: true });
    return {
      path: outputPath,
      optimised: true,
      reused: false,
      reasons: inputAssessment.reasons,
      probe: outputProbe,
    };
  } finally {
    await fs.remove(tempPath).catch(() => {});
  }
}

module.exports = {
  FACEBOOK_DELIVERY_VERSION,
  buildFacebookTranscodeArgs,
  facebookMediaNeedsOptimisation,
  prepareFacebookReelMedia,
  probeFacebookMedia,
};
