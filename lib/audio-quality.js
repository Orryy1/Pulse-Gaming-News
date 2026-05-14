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

function resolveAudioBitrate(value, fallback = "256k") {
  const candidate = String(value || "").trim().toLowerCase();
  if (/^(?:128|160|192|224|256|320)k$/.test(candidate)) {
    return candidate;
  }
  return fallback;
}

function buildNarrationMusicMixFilter({
  voiceLabel = "voice",
  musicLabel = "bgm",
  outputLabel = "outa",
  targetLufs = -15,
  truePeak = -2,
  loudnessRange = 8,
  limiter = 0.8,
} = {}) {
  const target = finiteNumber(targetLufs, -15);
  const peak = finiteNumber(truePeak, -2);
  const lra = finiteNumber(loudnessRange, 8);
  const limit = finiteNumber(limiter, 0.8);
  return `[${voiceLabel}][${musicLabel}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=${target}:TP=${peak}:LRA=${lra},alimiter=limit=${limit}[${outputLabel}]`;
}

function buildVoiceMasteringFilter({
  targetLufs = -15,
  truePeak = -1.7,
  loudnessRange = 8,
  limiter = 0.88,
  denoise = false,
  denoiseNoiseFloor = -30,
} = {}) {
  const target = finiteNumber(targetLufs, -15);
  const peak = finiteNumber(truePeak, -1.7);
  const lra = finiteNumber(loudnessRange, 8);
  const limit = finiteNumber(limiter, 0.88);
  const noiseFloor = finiteNumber(denoiseNoiseFloor, -30);

  const filters = [
    "highpass=f=90",
    "lowpass=f=15500",
    "equalizer=f=240:t=q:w=1.0:g=-2",
    "equalizer=f=3200:t=q:w=1.1:g=1.8",
    "equalizer=f=6500:t=q:w=1.0:g=1.0",
    "equalizer=f=9500:t=q:w=0.9:g=0.4",
    "acompressor=threshold=-22dB:ratio=2.0:attack=5:release=100:makeup=1.2",
    `loudnorm=I=${target}:TP=${peak}:LRA=${lra}`,
    `alimiter=limit=${limit}`,
  ];
  if (isTruthy(denoise)) {
    filters.splice(1, 0, `afftdn=nf=${noiseFloor}`);
  }
  return filters.join(",");
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

  const targetLufs = finiteNumber(env.TTS_VOICE_TARGET_LUFS, -15);
  const truePeak = finiteNumber(env.TTS_VOICE_TRUE_PEAK, -1.7);
  const loudnessRange = finiteNumber(env.TTS_VOICE_LRA, 8);
  const outputBitrate = resolveAudioBitrate(env.TTS_VOICE_MASTER_BITRATE, "256k");
  const denoise = isTruthy(env.TTS_VOICE_DENOISE || env.LOCAL_TTS_DENOISE);
  const filter = buildVoiceMasteringFilter({
    targetLufs,
    truePeak,
    loudnessRange,
    denoise,
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
        outputBitrate,
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
      outputBitrate,
      denoise,
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
      denoise,
    };
  }
}

module.exports = {
  buildNarrationMusicMixFilter,
  buildVoiceMasteringFilter,
  masterTtsAudioFile,
  resolveAudioBitrate,
  shouldMasterTtsAudio,
};
