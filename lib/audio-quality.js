"use strict";

const path = require("path");
const fs = require("fs-extra");

function isTruthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || ""));
}

function isExplicitlyFalse(value) {
  return /^(false|0|no|off)$/i.test(String(value || ""));
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildNarrationMusicMixFilter({
  voiceLabel = "voice",
  musicLabel = "bgm",
  outputLabel = "outa",
  limiter = 0.92,
} = {}) {
  return `[${voiceLabel}][${musicLabel}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=${limiter}[${outputLabel}]`;
}

function buildVoiceMasteringFilter({
  targetLufs = -16,
  truePeak = -1.5,
  loudnessRange = 8,
  limiter = 0.92,
} = {}) {
  const target = finiteNumber(targetLufs, -16);
  const peak = finiteNumber(truePeak, -1.5);
  const lra = finiteNumber(loudnessRange, 8);
  const limit = finiteNumber(limiter, 0.92);

  return [
    "highpass=f=80",
    "lowpass=f=14500",
    "equalizer=f=180:t=q:w=1.0:g=-1.5",
    "equalizer=f=3500:t=q:w=1.2:g=2.0",
    "acompressor=threshold=-20dB:ratio=2.2:attack=5:release=90:makeup=2",
    `loudnorm=I=${target}:TP=${peak}:LRA=${lra}`,
    `alimiter=limit=${limit}`,
  ].join(",");
}

function shouldMasterTtsAudio({ provider, env = process.env } = {}) {
  if (Object.prototype.hasOwnProperty.call(env, "TTS_VOICE_MASTERING")) {
    return isTruthy(env.TTS_VOICE_MASTERING);
  }

  const normalisedProvider = String(provider || "").toLowerCase();
  if (normalisedProvider !== "local") return false;
  if (Object.prototype.hasOwnProperty.call(env, "LOCAL_TTS_VOICE_MASTERING")) {
    return !isExplicitlyFalse(env.LOCAL_TTS_VOICE_MASTERING);
  }
  return true;
}

async function masterTtsAudioFile({
  inputPath,
  outputPath = inputPath,
  execFileAsync,
  ffmpegPath = "ffmpeg",
  env = process.env,
  log = null,
} = {}) {
  if (!inputPath) {
    return { ok: false, code: "missing_input_path" };
  }
  if (typeof execFileAsync !== "function") {
    return { ok: false, code: "missing_exec_file" };
  }

  const targetLufs = finiteNumber(env.TTS_VOICE_TARGET_LUFS, -16);
  const truePeak = finiteNumber(env.TTS_VOICE_TRUE_PEAK, -1.5);
  const loudnessRange = finiteNumber(env.TTS_VOICE_LRA, 8);
  const filter = buildVoiceMasteringFilter({
    targetLufs,
    truePeak,
    loudnessRange,
  });
  const sameOutput = path.resolve(inputPath) === path.resolve(outputPath);
  const tempPath = sameOutput
    ? path.join(
        path.dirname(inputPath),
        `.${path.basename(inputPath)}.${process.pid}.${Date.now()}.mastered.mp3`,
      )
    : outputPath;

  try {
    await fs.ensureDir(path.dirname(tempPath));
    await execFileAsync(
      ffmpegPath,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-af",
        filter,
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        tempPath,
      ],
      { timeout: finiteNumber(env.TTS_VOICE_MASTERING_TIMEOUT_MS, 60000) },
    );
    if (sameOutput) {
      await fs.move(tempPath, outputPath, { overwrite: true });
    }
    return {
      ok: true,
      code: "voice_mastered",
      targetLufs,
      truePeak,
      loudnessRange,
      outputBitrate: "192k",
    };
  } catch (err) {
    await fs.remove(tempPath).catch(() => {});
    if (log && typeof log === "function") {
      log(`[audio] Voice mastering skipped: ${err.message}`);
    }
    return {
      ok: false,
      code: "voice_mastering_failed",
      message: err.message,
      targetLufs,
      truePeak,
      loudnessRange,
    };
  }
}

module.exports = {
  buildNarrationMusicMixFilter,
  buildVoiceMasteringFilter,
  masterTtsAudioFile,
  shouldMasterTtsAudio,
};
