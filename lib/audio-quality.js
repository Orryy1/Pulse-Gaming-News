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
  truePeak = -2.5,
  loudnessRange = 8,
  limiter = 0.74,
} = {}) {
  const target = finiteNumber(targetLufs, -15);
  const peak = finiteNumber(truePeak, -2);
  const lra = finiteNumber(loudnessRange, 8);
  const limit = finiteNumber(limiter, 0.8);
  return `[${voiceLabel}][${musicLabel}]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,loudnorm=I=${target}:TP=${peak}:LRA=${lra},alimiter=limit=${limit}:level=disabled[${outputLabel}]`;
}

function buildNarrationOnlyMixFilter({
  voiceLabel = "voice",
  outputLabel = "outa",
  targetLufs = -15,
  truePeak = -2.5,
  loudnessRange = 8,
  limiter = 0.74,
  denoise = false,
} = {}) {
  const filter = buildVoiceMasteringFilter({
    targetLufs,
    truePeak,
    loudnessRange,
    limiter,
    denoise,
  });
  return `[${voiceLabel}]${filter}[${outputLabel}]`;
}

function buildVoiceMasteringFilter({
  targetLufs = -16,
  truePeak = -2.2,
  loudnessRange = 8,
  limiter = 0.78,
  denoise = false,
  denoiseNoiseFloor = -30,
} = {}) {
  const target = finiteNumber(targetLufs, -16);
  const peak = finiteNumber(truePeak, -2.2);
  const lra = finiteNumber(loudnessRange, 8);
  const limit = finiteNumber(limiter, 0.78);
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
    `alimiter=limit=${limit}:level=disabled`,
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

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseJsonLoudnormStats(text) {
  const blocks = String(text || "").match(/\{[\s\S]*?\}/g) || [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(blocks[index]);
      if (
        Object.prototype.hasOwnProperty.call(parsed, "input_i") ||
        Object.prototype.hasOwnProperty.call(parsed, "output_i")
      ) {
        return parsed;
      }
    } catch {
      // Keep looking: FFmpeg logs often contain non-JSON braces before loudnorm.
    }
  }
  return null;
}

function firstRegexNumber(text, patterns) {
  const source = String(text || "");
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      const number = Number(match[1]);
      if (Number.isFinite(number)) return number;
    }
  }
  return null;
}

function parseFfmpegLoudnessStats(text) {
  const source = String(text || "");
  const loudnorm = parseJsonLoudnormStats(source);
  const integratedLufs = firstFiniteNumber(
    loudnorm?.input_i,
    loudnorm?.output_i,
    firstRegexNumber(source, [
      /Input Integrated:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i,
      /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/i,
    ]),
  );
  const truePeakDb = firstFiniteNumber(
    loudnorm?.input_tp,
    loudnorm?.output_tp,
    firstRegexNumber(source, [
      /Input True Peak:\s*(-?\d+(?:\.\d+)?)\s*dBTP/i,
      /\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/i,
    ]),
  );
  const loudnessRange = firstFiniteNumber(
    loudnorm?.input_lra,
    loudnorm?.output_lra,
    firstRegexNumber(source, [
      /Input LRA:\s*(-?\d+(?:\.\d+)?)\s*LU/i,
      /\bLRA:\s*(-?\d+(?:\.\d+)?)\s*LU/i,
    ]),
  );

  return {
    integratedLufs,
    truePeakDb,
    loudnessRange,
  };
}

async function measureAudioLoudness({
  inputPath,
  execFileAsync,
  ffmpegPath = "ffmpeg",
  env = process.env,
} = {}) {
  if (!inputPath || typeof execFileAsync !== "function") {
    return {
      ok: false,
      code: !inputPath ? "missing_input_path" : "missing_exec_file",
      integratedLufs: null,
      truePeakDb: null,
      loudnessRange: null,
    };
  }
  try {
    const result = await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-nostats",
        "-i",
        inputPath,
        "-af",
        "loudnorm=I=-16:TP=-2:LRA=8:print_format=json",
        "-f",
        "null",
        "-",
      ],
      { timeout: finiteNumber(env.TTS_VOICE_MEASURE_TIMEOUT_MS, 45000) },
    );
    const parsed = parseFfmpegLoudnessStats(
      [result?.stderr, result?.stdout].filter(Boolean).join("\n"),
    );
    return {
      ok: parsed.integratedLufs !== null || parsed.truePeakDb !== null,
      code:
        parsed.integratedLufs !== null || parsed.truePeakDb !== null
          ? "audio_loudness_measured"
          : "audio_loudness_unparsed",
      ...parsed,
    };
  } catch (err) {
    return {
      ok: false,
      code: "audio_loudness_measure_failed",
      message: err.message,
      integratedLufs: null,
      truePeakDb: null,
      loudnessRange: null,
    };
  }
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
  const truePeak = finiteNumber(env.TTS_VOICE_TRUE_PEAK, -2.2);
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
    const acoustic = await measureAudioLoudness({
      inputPath: outputPath,
      execFileAsync,
      ffmpegPath,
      env,
    });
    return {
      ok: true,
      code: "voice_mastered",
      targetLufs,
      truePeak,
      loudnessRange,
      outputBitrate,
      denoise,
      acoustic,
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

function timestampForFileName(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const iso = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildFinalVideoAudioRepairArgs({
  inputPath,
  outputPath,
  targetLufs = -15,
  truePeak = -2.5,
  loudnessRange = 8,
  limiter = 0.74,
  audioBitrate = "192k",
} = {}) {
  const target = finiteNumber(targetLufs, -15);
  const peak = finiteNumber(truePeak, -2.5);
  const lra = finiteNumber(loudnessRange, 8);
  const limit = finiteNumber(limiter, 0.74);
  const bitrate = resolveAudioBitrate(audioBitrate, "192k");
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0",
    "-map_metadata",
    "0",
    "-c:v",
    "copy",
    "-af",
    `loudnorm=I=${target}:TP=${peak}:LRA=${lra},alimiter=limit=${limit}:level=disabled`,
    "-c:a",
    "aac",
    "-b:a",
    bitrate,
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

async function repairFinalVideoAudioLoudness({
  inputPath,
  outputPath = inputPath,
  execFileAsync,
  ffmpegPath = "ffmpeg",
  env = process.env,
  now = new Date(),
  targetLufs = -15,
  truePeak = -2.5,
  loudnessRange = 8,
  limiter = 0.74,
  audioBitrate = "192k",
} = {}) {
  if (!inputPath) return { ok: false, code: "missing_input_path" };
  if (typeof execFileAsync !== "function") return { ok: false, code: "missing_exec_file" };

  const resolvedInput = path.resolve(inputPath);
  const resolvedOutput = path.resolve(outputPath || inputPath);
  const sameOutput = resolvedInput === resolvedOutput;
  const tempPath = sameOutput
    ? path.join(
        path.dirname(resolvedInput),
        `.${path.basename(resolvedInput)}.${process.pid}.${Date.now()}.audio-repair.mp4`,
      )
    : resolvedOutput;
  const backupPath = sameOutput
    ? path.join(
        path.dirname(resolvedInput),
        `${path.basename(resolvedInput)}.pre-audio-repair-${timestampForFileName(now)}`,
      )
    : null;

  try {
    const before = await measureAudioLoudness({
      inputPath: resolvedInput,
      execFileAsync,
      ffmpegPath,
      env,
    });
    await fs.ensureDir(path.dirname(tempPath));
    const args = buildFinalVideoAudioRepairArgs({
      inputPath: resolvedInput,
      outputPath: tempPath,
      targetLufs,
      truePeak,
      loudnessRange,
      limiter,
      audioBitrate,
    });
    await execFileAsync(ffmpegPath, args, {
      timeout: finiteNumber(env.FINAL_AUDIO_REPAIR_TIMEOUT_MS, 120000),
    });
    if (sameOutput) {
      await fs.copy(resolvedInput, backupPath, { overwrite: false });
      await fs.move(tempPath, resolvedOutput, { overwrite: true });
    }
    const after = await measureAudioLoudness({
      inputPath: resolvedOutput,
      execFileAsync,
      ffmpegPath,
      env,
    });
    return {
      ok: true,
      code: "final_audio_repaired",
      inputPath: resolvedInput,
      outputPath: resolvedOutput,
      backupPath,
      before: { acoustic: before },
      after: { acoustic: after },
      targetLufs: finiteNumber(targetLufs, -15),
      truePeak: finiteNumber(truePeak, -2.5),
    };
  } catch (err) {
    if (sameOutput) await fs.remove(tempPath).catch(() => {});
    return {
      ok: false,
      code: "final_audio_repair_failed",
      message: err.message,
      inputPath: resolvedInput,
      outputPath: resolvedOutput,
      backupPath,
    };
  }
}

async function repairTtsAudioFileLoudness({
  inputPath,
  execFileAsync,
  ffmpegPath = "ffmpeg",
  env = process.env,
  now = new Date(),
  targetLufs = -16,
  truePeak = -2.2,
  loudnessRange = 8,
} = {}) {
  if (!inputPath) return { ok: false, code: "missing_input_path" };
  if (typeof execFileAsync !== "function") return { ok: false, code: "missing_exec_file" };

  const resolvedInput = path.resolve(inputPath);
  const backupPath = path.join(
    path.dirname(resolvedInput),
    `${path.basename(resolvedInput)}.pre-tts-repair-${timestampForFileName(now)}`,
  );
  try {
    const before = await measureAudioLoudness({
      inputPath: resolvedInput,
      execFileAsync,
      ffmpegPath,
      env,
    });
    await fs.copy(resolvedInput, backupPath, { overwrite: false });
    const result = await masterTtsAudioFile({
      inputPath: resolvedInput,
      outputPath: resolvedInput,
      execFileAsync,
      ffmpegPath,
      env: {
        ...env,
        TTS_VOICE_TARGET_LUFS: String(targetLufs),
        TTS_VOICE_TRUE_PEAK: String(truePeak),
        TTS_VOICE_LRA: String(loudnessRange),
      },
    });
    if (!result.ok) {
      await fs.copy(backupPath, resolvedInput, { overwrite: true }).catch(() => {});
      return {
        ok: false,
        code: result.code || "tts_audio_repair_failed",
        message: result.message || null,
        inputPath: resolvedInput,
        backupPath,
        before: { acoustic: before },
      };
    }
    return {
      ok: true,
      code: "tts_audio_repaired",
      inputPath: resolvedInput,
      backupPath,
      before: { acoustic: before },
      acoustic: result.acoustic || null,
      targetLufs,
      truePeak,
    };
  } catch (err) {
    await fs.copy(backupPath, resolvedInput, { overwrite: true }).catch(() => {});
    return {
      ok: false,
      code: "tts_audio_repair_failed",
      message: err.message,
      inputPath: resolvedInput,
      backupPath,
    };
  }
}

module.exports = {
  buildFinalVideoAudioRepairArgs,
  buildNarrationMusicMixFilter,
  buildNarrationOnlyMixFilter,
  buildVoiceMasteringFilter,
  measureAudioLoudness,
  masterTtsAudioFile,
  parseFfmpegLoudnessStats,
  repairFinalVideoAudioLoudness,
  repairTtsAudioFileLoudness,
  resolveAudioBitrate,
  shouldMasterTtsAudio,
};
