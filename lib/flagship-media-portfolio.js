"use strict";

const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const {
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
} = require("./services/short-duration-contract");
const {
  validateFinalAvReview,
  validateFinalAvReviewFile,
} = require("./goal-final-av-review");
const { compareVideoFingerprints } = require("./video-visual-fingerprint");

const CONTRACT_ID = "flagship_media_portfolio_v1";
const FLAGSHIP_MEDIA_PORTFOLIO_SLOTS = Object.freeze([
  "short_1",
  "short_2",
  "short_3",
  "longform_1",
]);
const SHORT_SLOTS = Object.freeze(FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.slice(0, 3));
const LONGFORM_MIN_DURATION_SECONDS = 600;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MIN_TIMELINE_WORDS_PER_SECOND = 0.9;
const MAX_WORD_TIMESTAMP_GAP_SECONDS = 3;
const MAX_CAPTION_GAP_SECONDS = 4;
const MAX_CAPTION_CUE_SECONDS = 8;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function lexicalTokens(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, " ")
    .split(/\s+/)
    .filter((token) => /[a-z0-9]/.test(token));
}

function minimumTimelineWordCount(durationSeconds) {
  const duration = numberOrNull(durationSeconds);
  return duration > 0
    ? Math.max(12, Math.floor(duration * MIN_TIMELINE_WORDS_PER_SECOND))
    : 12;
}

function timelineEndTolerance(durationSeconds) {
  const duration = numberOrNull(durationSeconds);
  return duration > 0 ? Math.max(1.5, duration * 0.02) : 1.5;
}

function standardDeviation(values, mean) {
  if (!values.length) return 0;
  const average = Number.isFinite(mean)
    ? mean
    : values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function normaliseSha256(value) {
  const hash = clean(value).replace(/^sha256:/i, "").toLowerCase();
  return SHA256_RE.test(hash) ? hash : "";
}

function resolveEvidencePath(value, workspaceRoot) {
  const target = clean(value);
  if (!target) return "";
  return path.isAbsolute(target)
    ? path.resolve(target)
    : path.resolve(workspaceRoot || process.cwd(), target);
}

function hashFileSync(filePath) {
  const hash = crypto.createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  const descriptor = fs.openSync(filePath, "r");
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function normaliseSlotMap(portfolio = {}) {
  const source = portfolio?.slots;
  if (Array.isArray(source)) {
    const slots = {};
    const duplicateSlotIds = [];
    for (const row of source) {
      const slotId = clean(row?.slot_id || row?.slot || row?.id);
      if (!slotId) continue;
      if (Object.prototype.hasOwnProperty.call(slots, slotId)) duplicateSlotIds.push(slotId);
      else slots[slotId] = row;
    }
    return { slots, duplicateSlotIds };
  }
  return { slots: asObject(source), duplicateSlotIds: [] };
}

function descriptorFrom(slot, key) {
  const evidence = asObject(slot?.evidence);
  const aliases = {
    media: ["media", "final_media", "final_render"],
    narration: ["narration", "narration_audio", "audio"],
    word_timestamps: ["word_timestamps", "timestamps"],
    captions: ["captions", "caption_file", "subtitles"],
    rights_lineage: ["rights_lineage", "rights_ledger", "rights"],
  }[key] || [key];
  let raw = {};
  for (const alias of aliases) {
    const candidate = slot?.[alias] ?? evidence[alias];
    if (typeof candidate === "string") {
      raw = { path: candidate };
      break;
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      raw = candidate;
      break;
    }
  }

  const pathAliases = {
    media: ["media_path", "final_media_path", "final_render_path", "mp4_path", "exported_path"],
    narration: ["narration_path", "narration_audio_path", "audio_path"],
    word_timestamps: ["word_timestamps_path", "timestamps_path"],
    captions: ["captions_path", "caption_path", "srt_path", "subtitles_path"],
    rights_lineage: ["rights_lineage_path", "rights_ledger_path", "rights_path"],
  }[key] || [`${key}_path`];
  const hashAliases = {
    media: ["media_sha256", "final_media_sha256", "final_render_sha256", "mp4_sha256"],
    narration: ["narration_sha256", "narration_audio_sha256", "audio_sha256"],
    word_timestamps: ["word_timestamps_sha256", "timestamps_sha256"],
    captions: ["captions_sha256", "caption_sha256", "subtitles_sha256"],
    rights_lineage: ["rights_lineage_sha256", "rights_ledger_sha256", "rights_sha256"],
  }[key] || [`${key}_sha256`];

  const firstSlotValue = (names) => names.map((name) => slot?.[name]).find((value) => value !== undefined);
  return {
    ...raw,
    path: raw.path || raw.file_path || raw.output_path || raw.file || firstSlotValue(pathAliases),
    sha256: raw.sha256 || raw.hash || raw.fingerprint || firstSlotValue(hashAliases),
    complete: raw.complete ?? raw.is_complete ?? slot?.[`${key}_complete`],
  };
}

function inspectFileDescriptor(label, descriptor, { workspaceRoot, requireComplete = true } = {}) {
  const blockers = [];
  const resolvedPath = resolveEvidencePath(descriptor?.path, workspaceRoot);
  const declaredSha256Text = clean(descriptor?.sha256).replace(/^sha256:/i, "").toLowerCase();
  const declaredSha256 = normaliseSha256(descriptor?.sha256);
  const result = {
    path: resolvedPath || null,
    exists: false,
    size_bytes: 0,
    sha256: null,
    declared_sha256: declaredSha256 || declaredSha256Text || null,
    hash_matches: false,
  };

  if (requireComplete && descriptor?.complete !== true) blockers.push(`${label}_not_complete`);
  if (!resolvedPath) blockers.push(`${label}_path_missing`);
  if (!declaredSha256Text) blockers.push(`${label}_sha256_missing`);
  else if (!declaredSha256) blockers.push(`${label}_sha256_invalid`);
  if (!resolvedPath) return { result, blockers };

  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size <= 0) {
      blockers.push(`${label}_file_missing_or_empty`);
      return { result, blockers };
    }
    result.exists = true;
    result.size_bytes = stat.size;
    result.sha256 = hashFileSync(resolvedPath);
    result.hash_matches = Boolean(declaredSha256 && declaredSha256 === result.sha256);
    if (declaredSha256 && !result.hash_matches) blockers.push(`${label}_sha256_mismatch`);
  } catch {
    blockers.push(`${label}_file_missing_or_empty`);
  }
  return { result, blockers };
}

function defaultProbeFile(filePath, {
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  timeoutMs = 30_000,
} = {}) {
  const probe = spawnSync(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=format_name,duration:stream=index,codec_type,codec_name,width,height,duration",
    "-of", "json",
    filePath,
  ], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (probe.error) {
    return {
      available: probe.error.code !== "ENOENT",
      decodable: false,
      error: clean(probe.error.message),
    };
  }
  if (probe.status !== 0) {
    return { available: true, decodable: false, error: clean(probe.stderr) };
  }

  let metadata;
  try {
    metadata = JSON.parse(probe.stdout || "{}");
  } catch {
    return { available: true, decodable: false, error: "ffprobe_json_invalid" };
  }
  const streams = asArray(metadata.streams);
  const video = streams.find((stream) => stream.codec_type === "video") || null;
  const audio = streams.find((stream) => stream.codec_type === "audio") || null;
  const streamDurations = streams.map((stream) => numberOrNull(stream.duration)).filter((value) => value > 0);
  const durationSeconds = numberOrNull(metadata.format?.duration) || Math.max(0, ...streamDurations);
  return {
    available: true,
    decodable: Boolean(streams.length && durationSeconds > 0),
    format_name: clean(metadata.format?.format_name).toLowerCase(),
    duration_seconds: durationSeconds > 0 ? durationSeconds : null,
    video: video ? {
      codec: clean(video.codec_name).toLowerCase(),
      width: numberOrNull(video.width),
      height: numberOrNull(video.height),
    } : null,
    audio: audio ? { codec: clean(audio.codec_name).toLowerCase() } : null,
  };
}

function decodeFile(filePath, maps, {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  timeoutMs = 300_000,
} = {}) {
  const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";
  const decoded = spawnSync(ffmpegPath, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-i", filePath,
    ...maps.flatMap((map) => ["-map", map]),
    "-f", "null",
    nullSink,
  ], {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (decoded.error) {
    return {
      available: decoded.error.code !== "ENOENT",
      decodable: false,
      error: clean(decoded.error.message),
    };
  }
  return {
    available: true,
    decodable: decoded.status === 0,
    error: decoded.status === 0 ? "" : clean(decoded.stderr),
  };
}

function defaultDecodeMedia(filePath, options) {
  return decodeFile(filePath, ["0:v:0", "0:a:0"], options);
}

function defaultDecodeAudio(filePath, {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  timeoutMs = 300_000,
} = {}) {
  const decoded = spawnSync(ffmpegPath, [
    "-nostdin",
    "-v", "error",
    "-xerror",
    "-i", filePath,
    "-vn",
    "-ac", "1",
    "-ar", "8000",
    "-f", "s16le",
    "pipe:1",
  ], {
    encoding: null,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (decoded.error) {
    return {
      available: decoded.error.code !== "ENOENT",
      decodable: false,
      speech_like: false,
      error: clean(decoded.error.message),
    };
  }
  if (decoded.status !== 0 || !Buffer.isBuffer(decoded.stdout) || decoded.stdout.length < 3200) {
    return {
      available: true,
      decodable: false,
      speech_like: false,
      error: clean(decoded.stderr && decoded.stderr.toString("utf8")),
    };
  }

  const sampleCount = Math.floor(decoded.stdout.length / 2);
  const frameSamples = 160;
  const frameRms = [];
  const frameZeroCrossing = [];
  let peak = 0;
  let clippedSamples = 0;
  for (let offset = 0; offset + frameSamples <= sampleCount; offset += frameSamples) {
    let energy = 0;
    let crossings = 0;
    let previous = decoded.stdout.readInt16LE(offset * 2);
    for (let index = 0; index < frameSamples; index += 1) {
      const sample = decoded.stdout.readInt16LE((offset + index) * 2);
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      if (absolute >= 32760) clippedSamples += 1;
      energy += sample * sample;
      if (index > 0 && ((sample < 0 && previous >= 0) || (sample >= 0 && previous < 0))) crossings += 1;
      previous = sample;
    }
    frameRms.push(Math.sqrt(energy / frameSamples));
    frameZeroCrossing.push(crossings / (frameSamples - 1));
  }
  const maximumRms = Math.max(0, ...frameRms);
  const activeThreshold = Math.max(80, maximumRms * 0.04);
  const activeIndexes = frameRms
    .map((rms, index) => ({ rms, index }))
    .filter((row) => row.rms >= activeThreshold);
  const activeRms = activeIndexes.map((row) => row.rms);
  const activeZeroCrossing = activeIndexes.map((row) => frameZeroCrossing[row.index]);
  const meanActiveRms = activeRms.length
    ? activeRms.reduce((sum, value) => sum + value, 0) / activeRms.length
    : 0;
  const meanZeroCrossing = activeZeroCrossing.length
    ? activeZeroCrossing.reduce((sum, value) => sum + value, 0) / activeZeroCrossing.length
    : 0;
  const activeRatio = frameRms.length ? activeRms.length / frameRms.length : 0;
  const envelopeVariation = meanActiveRms > 0
    ? standardDeviation(activeRms, meanActiveRms) / meanActiveRms
    : 0;
  const zeroCrossingVariation = standardDeviation(activeZeroCrossing, meanZeroCrossing);
  const clippingRatio = sampleCount ? clippedSamples / sampleCount : 0;
  const speechLike = (
    peak >= 300 &&
    activeRatio >= 0.2 &&
    envelopeVariation >= 0.12 &&
    zeroCrossingVariation >= 0.005 &&
    clippingRatio < 0.02
  );
  return {
    available: true,
    decodable: true,
    speech_like: speechLike,
    sample_rate_hz: 8000,
    duration_seconds: sampleCount / 8000,
    active_frame_ratio: Number(activeRatio.toFixed(6)),
    envelope_variation: Number(envelopeVariation.toFixed(6)),
    zero_crossing_variation: Number(zeroCrossingVariation.toFixed(6)),
    peak_amplitude: peak,
    clipping_ratio: Number(clippingRatio.toFixed(8)),
  };
}

function valuesApproximatelyEqual(declared, measured) {
  const left = numberOrNull(declared);
  const right = numberOrNull(measured);
  if (left === null || right === null) return false;
  return Math.abs(left - right) <= Math.max(0.25, right * 0.002);
}

function frameDhash(frame, width = 32, height = 32) {
  if (!Buffer.isBuffer(frame) || frame.length < width * height * 3) return "";
  const columns = 9;
  const rows = 8;
  const luminance = [];
  for (let row = 0; row < rows; row += 1) {
    const sourceY = Math.min(height - 1, Math.floor(((row + 0.5) * height) / rows));
    for (let column = 0; column < columns; column += 1) {
      const sourceX = Math.min(width - 1, Math.floor(((column + 0.5) * width) / columns));
      const offset = ((sourceY * width) + sourceX) * 3;
      luminance.push(
        (frame[offset] * 0.2126) +
        (frame[offset + 1] * 0.7152) +
        (frame[offset + 2] * 0.0722),
      );
    }
  }
  let bits = "";
  for (let row = 0; row < rows; row += 1) {
    const offset = row * columns;
    for (let column = 0; column < columns - 1; column += 1) {
      bits += luminance[offset + column] > luminance[offset + column + 1] ? "1" : "0";
    }
  }
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

function frameSpatialDeviation(frame) {
  if (!Buffer.isBuffer(frame) || !frame.length) return 0;
  const luminance = [];
  for (let offset = 0; offset + 2 < frame.length; offset += 3) {
    luminance.push(
      (frame[offset] * 0.2126) +
      (frame[offset + 1] * 0.7152) +
      (frame[offset + 2] * 0.0722),
    );
  }
  const mean = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
  return standardDeviation(luminance, mean);
}

function frameMeanAbsoluteDifference(left, right) {
  if (!Buffer.isBuffer(left) || !Buffer.isBuffer(right) || left.length !== right.length) return 0;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference += Math.abs(left[index] - right[index]);
  }
  return difference / left.length;
}

function inspectVisualDiversity(filePath, durationSeconds, {
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  timeoutMs = 300_000,
} = {}) {
  const duration = numberOrNull(durationSeconds);
  const targetSamples = duration >= LONGFORM_MIN_DURATION_SECONDS ? 24 : 12;
  const interval = duration > 0 ? Math.max(0.25, duration / Math.max(1, targetSamples - 1)) : 1;
  const width = 32;
  const height = 32;
  const frameBytes = width * height * 3;
  const sampled = spawnSync(ffmpegPath, [
    "-nostdin",
    "-v", "error",
    "-i", filePath,
    "-vf", `fps=1/${interval.toFixed(6)},scale=${width}:${height}:flags=area,format=rgb24`,
    "-frames:v", String(targetSamples),
    "-f", "rawvideo",
    "pipe:1",
  ], {
    encoding: null,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (sampled.error || sampled.status !== 0 || !Buffer.isBuffer(sampled.stdout)) {
    return {
      inspected: false,
      material: false,
      sample_count: 0,
      unique_frame_count: 0,
      detailed_frame_count: 0,
      changed_pair_count: 0,
      fingerprint: null,
      error: clean(sampled.error?.message || (sampled.stderr && sampled.stderr.toString("utf8"))),
    };
  }
  const frameCount = Math.min(targetSamples, Math.floor(sampled.stdout.length / frameBytes));
  const frames = [];
  for (let index = 0; index < frameCount; index += 1) {
    const offset = index * frameBytes;
    frames.push(sampled.stdout.subarray(offset, offset + frameBytes));
  }
  const contentHashes = frames.map((frame) => crypto.createHash("sha256").update(frame).digest("hex"));
  const perceptualHashes = frames.map((frame) => frameDhash(frame, width, height)).filter(Boolean);
  const spatialDeviations = frames.map(frameSpatialDeviation);
  const temporalDifferences = frames.slice(1).map((frame, index) => (
    frameMeanAbsoluteDifference(frames[index], frame)
  ));
  const detailedFrameCount = spatialDeviations.filter((value) => value >= 8).length;
  const changedPairCount = temporalDifferences.filter((value) => value >= 2).length;
  const uniqueFrameCount = new Set(contentHashes).size;
  const minimumSamples = duration >= LONGFORM_MIN_DURATION_SECONDS ? 16 : 8;
  const material = (
    frameCount >= minimumSamples &&
    detailedFrameCount >= Math.ceil(frameCount * 0.6) &&
    uniqueFrameCount >= Math.max(4, Math.ceil(frameCount * 0.4)) &&
    changedPairCount >= Math.ceil(Math.max(1, frameCount - 1) * 0.4)
  );
  return {
    inspected: true,
    material,
    sample_count: frameCount,
    unique_frame_count: uniqueFrameCount,
    detailed_frame_count: detailedFrameCount,
    changed_pair_count: changedPairCount,
    mean_spatial_deviation: spatialDeviations.length
      ? Number((spatialDeviations.reduce((sum, value) => sum + value, 0) / spatialDeviations.length).toFixed(6))
      : 0,
    mean_temporal_difference: temporalDifferences.length
      ? Number((temporalDifferences.reduce((sum, value) => sum + value, 0) / temporalDifferences.length).toFixed(6))
      : 0,
    fingerprint: perceptualHashes.length >= 2 ? {
      algorithm: "temporal-dhash-9x8-v1",
      hashes: perceptualHashes,
      signature: perceptualHashes.join(":"),
      sample_count: perceptualHashes.length,
    } : null,
    error: null,
  };
}

function inspectMedia(slotId, slot, options) {
  const blockers = [];
  const descriptor = descriptorFrom(slot, "media");
  const file = inspectFileDescriptor("media", descriptor, {
    workspaceRoot: options.workspaceRoot,
    requireComplete: false,
  });
  blockers.push(...file.blockers);
  const expectedType = SHORT_SLOTS.includes(slotId) ? "short" : "longform";
  const declaredType = clean(slot?.media_type || descriptor.media_type || slot?.type).toLowerCase();
  const declaredContainer = clean(descriptor.container || descriptor.format).toLowerCase();
  const declaredDuration = numberOrNull(descriptor.duration_seconds ?? descriptor.duration_s);
  const declaredWidth = numberOrNull(descriptor.width);
  const declaredHeight = numberOrNull(descriptor.height);
  const declaredVideoCodec = clean(descriptor.video_codec || descriptor.video_codec_name).toLowerCase();
  const declaredAudioCodec = clean(descriptor.audio_codec || descriptor.audio_codec_name).toLowerCase();

  if (!declaredType) blockers.push("media_type_missing");
  else if (declaredType !== expectedType) blockers.push("media_type_mismatch");
  if (!declaredContainer) blockers.push("declared_container_missing");
  else if (declaredContainer !== "mp4" && !declaredContainer.includes("mp4")) blockers.push("declared_container_not_mp4");
  if (!(declaredDuration > 0)) blockers.push("declared_duration_missing_or_invalid");
  if (!(declaredWidth > 0 && declaredHeight > 0)) blockers.push("declared_dimensions_missing_or_invalid");
  if (!declaredVideoCodec) blockers.push("declared_video_codec_missing");
  if (!declaredAudioCodec) blockers.push("declared_audio_codec_missing");
  if (descriptor.decodable !== true) blockers.push("declared_decodable_evidence_missing");
  if (file.result.path && path.extname(file.result.path).toLowerCase() !== ".mp4") blockers.push("media_file_not_mp4");

  let probe = { available: true, decodable: false };
  let decode = { available: true, decodable: false };
  let visualDiversity = {
    inspected: false,
    material: false,
    sample_count: 0,
    unique_frame_count: 0,
    detailed_frame_count: 0,
    changed_pair_count: 0,
    fingerprint: null,
  };
  if (file.result.exists) {
    try {
      probe = options.probeFile(file.result.path, options);
    } catch (error) {
      probe = { available: true, decodable: false, error: clean(error?.message) };
    }
    if (probe?.available === false) blockers.push("media_probe_unavailable");
    else if (probe?.decodable !== true) blockers.push("media_not_decodable");

    if (probe?.decodable === true) {
      if (!clean(probe.format_name).split(",").some((name) => name === "mp4" || name === "mov")) {
        blockers.push("media_container_not_mp4");
      }
      if (!probe.video) blockers.push("media_video_stream_missing");
      if (!probe.audio) blockers.push("media_audio_stream_missing");
      if (!(numberOrNull(probe.duration_seconds) > 0)) blockers.push("media_duration_evidence_missing");
      if (!(numberOrNull(probe.video?.width) > 0 && numberOrNull(probe.video?.height) > 0)) {
        blockers.push("media_dimensions_evidence_missing");
      }
      if (!clean(probe.video?.codec)) blockers.push("media_video_codec_evidence_missing");
      if (!clean(probe.audio?.codec)) blockers.push("media_audio_codec_evidence_missing");
      if (clean(probe.video?.codec) && clean(probe.video.codec) !== "h264") blockers.push("media_video_codec_not_h264");
      if (clean(probe.audio?.codec) && clean(probe.audio.codec) !== "aac") blockers.push("media_audio_codec_not_aac");

      if (declaredDuration > 0 && !valuesApproximatelyEqual(declaredDuration, probe.duration_seconds)) {
        blockers.push("declared_duration_mismatch");
      }
      if (declaredWidth > 0 && declaredWidth !== numberOrNull(probe.video?.width)) {
        blockers.push("declared_width_mismatch");
      }
      if (declaredHeight > 0 && declaredHeight !== numberOrNull(probe.video?.height)) {
        blockers.push("declared_height_mismatch");
      }
      if (declaredVideoCodec && declaredVideoCodec !== clean(probe.video?.codec)) {
        blockers.push("declared_video_codec_mismatch");
      }
      if (declaredAudioCodec && declaredAudioCodec !== clean(probe.audio?.codec)) {
        blockers.push("declared_audio_codec_mismatch");
      }

      const width = numberOrNull(probe.video?.width);
      const height = numberOrNull(probe.video?.height);
      if (expectedType === "short" && width > 0 && height > 0 && width >= height) {
        blockers.push("short_media_not_portrait");
      }
      if (
        expectedType === "short" &&
        numberOrNull(probe.duration_seconds) < DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS
      ) {
        blockers.push("short_duration_below_production_minimum");
      }
      if (
        expectedType === "short" &&
        numberOrNull(probe.duration_seconds) > DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS
      ) {
        blockers.push("short_duration_above_production_maximum");
      }
      if (expectedType === "longform" && width > 0 && height > 0 && width <= height) {
        blockers.push("longform_media_not_landscape");
      }
      if (expectedType === "longform" && numberOrNull(probe.duration_seconds) < LONGFORM_MIN_DURATION_SECONDS) {
        blockers.push("longform_duration_below_600_seconds");
      }

      if (probe.video && probe.audio) {
        try {
          decode = options.decodeMedia(file.result.path, options);
        } catch (error) {
          decode = { available: true, decodable: false, error: clean(error?.message) };
        }
        if (decode?.available === false) blockers.push("media_decoder_unavailable");
        else if (decode?.decodable !== true) blockers.push("media_not_decodable");
      }
      if (probe.video) {
        visualDiversity = inspectVisualDiversity(file.result.path, probe.duration_seconds, {
          ffmpegPath: options.ffmpegPath,
          timeoutMs: options.decodeTimeoutMs,
        });
        if (!visualDiversity.inspected) blockers.push("media_visual_inspection_failed");
        if (!visualDiversity.material) blockers.push("media_visual_diversity_insufficient");
      }
    }

    if (file.result.sha256) {
      try {
        const afterDecodeHash = hashFileSync(file.result.path);
        if (afterDecodeHash !== file.result.sha256) blockers.push("media_changed_during_evaluation");
      } catch {
        blockers.push("media_changed_during_evaluation");
      }
    }
  }

  const width = numberOrNull(probe?.video?.width);
  const height = numberOrNull(probe?.video?.height);
  const orientation = width > 0 && height > 0
    ? width < height ? "portrait" : width > height ? "landscape" : "square"
    : null;
  return {
    blockers: unique(blockers),
    evidence: {
      ...file.result,
      media_type: declaredType || null,
      expected_media_type: expectedType,
      container: clean(probe?.format_name) || null,
      duration_seconds: numberOrNull(probe?.duration_seconds),
      width,
      height,
      orientation,
      aspect_ratio: width > 0 && height > 0 ? Number((width / height).toFixed(6)) : null,
      video_codec: clean(probe?.video?.codec) || null,
      audio_codec: clean(probe?.audio?.codec) || null,
      probed: probe?.decodable === true,
      decoded: decode?.decodable === true,
      decodable: probe?.decodable === true && decode?.decodable === true,
      visual_diversity: visualDiversity,
      visual_fingerprint: visualDiversity.fingerprint,
    },
  };
}

function inspectNarration(slot, mediaDuration, options) {
  const blockers = [];
  const descriptor = descriptorFrom(slot, "narration");
  const file = inspectFileDescriptor("narration", descriptor, { workspaceRoot: options.workspaceRoot });
  blockers.push(...file.blockers);
  const declaredDuration = numberOrNull(descriptor.duration_seconds ?? descriptor.duration_s);
  if (!(declaredDuration > 0)) blockers.push("narration_declared_duration_missing_or_invalid");
  let probe = { available: true, decodable: false };
  let decode = { available: true, decodable: false };
  if (file.result.exists) {
    try {
      probe = options.probeFile(file.result.path, options);
    } catch (error) {
      probe = { available: true, decodable: false, error: clean(error?.message) };
    }
    if (probe?.available === false) blockers.push("narration_probe_unavailable");
    else if (probe?.decodable !== true || !probe.audio) blockers.push("narration_audio_not_decodable");
    if (probe?.audio) {
      try {
        decode = options.decodeAudio(file.result.path, options);
      } catch (error) {
        decode = { available: true, decodable: false, error: clean(error?.message) };
      }
      if (decode?.available === false) blockers.push("narration_decoder_unavailable");
      else if (decode?.decodable !== true) blockers.push("narration_audio_not_decodable");
      if (decode?.speech_like !== true) blockers.push("narration_speech_evidence_missing");
    }
    if (declaredDuration > 0 && probe?.duration_seconds && !valuesApproximatelyEqual(declaredDuration, probe.duration_seconds)) {
      blockers.push("narration_declared_duration_mismatch");
    }
    if (mediaDuration > 0 && probe?.duration_seconds > 0) {
      const allowedGap = Math.max(1, mediaDuration * 0.02);
      if (probe.duration_seconds < mediaDuration - allowedGap) blockers.push("narration_duration_incomplete");
      if (probe.duration_seconds > mediaDuration + allowedGap) blockers.push("narration_duration_exceeds_media");
    }
    if (file.result.sha256) {
      try {
        if (hashFileSync(file.result.path) !== file.result.sha256) blockers.push("narration_changed_during_evaluation");
      } catch {
        blockers.push("narration_changed_during_evaluation");
      }
    }
  }
  return {
    blockers: unique(blockers),
    evidence: {
      ...file.result,
      duration_seconds: numberOrNull(probe?.duration_seconds),
      audio_codec: clean(probe?.audio?.codec) || null,
      decoded: decode?.decodable === true,
      decodable: probe?.decodable === true && Boolean(probe?.audio) && decode?.decodable === true,
      speech_like: decode?.speech_like === true,
      speech_evidence: {
        sample_rate_hz: numberOrNull(decode?.sample_rate_hz),
        active_frame_ratio: numberOrNull(decode?.active_frame_ratio),
        envelope_variation: numberOrNull(decode?.envelope_variation),
        zero_crossing_variation: numberOrNull(decode?.zero_crossing_variation),
        peak_amplitude: numberOrNull(decode?.peak_amplitude),
        clipping_ratio: numberOrNull(decode?.clipping_ratio),
      },
      complete: blockers.length === 0,
    },
  };
}

function timelineRows(payload) {
  if (Array.isArray(payload)) return payload;
  const object = asObject(payload);
  for (const key of ["words", "word_timestamps", "timestamps", "segments"]) {
    if (Array.isArray(object[key])) return object[key];
  }
  return [];
}

function timelineValue(row, keys) {
  for (const key of keys) {
    const value = numberOrNull(row?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function timestampAudioHash(payload) {
  const object = asObject(payload);
  const meta = asObject(object.meta);
  const fingerprint = asObject(object.input_fingerprint || meta.input_fingerprint);
  return normaliseSha256(
    object.audio_sha256 ||
    object.narration_sha256 ||
    object.source_audio_sha256 ||
    meta.audio_sha256 ||
    meta.narration_sha256 ||
    meta.source_audio_sha256 ||
    fingerprint.audio_sha256 ||
    fingerprint.narration_sha256,
  );
}

function minimumUniqueWordCount(minimumWords) {
  return Math.min(40, Math.max(8, Math.floor(minimumWords * 0.08)));
}

function inspectWordTimestamps(slot, expectedDuration, narrationSha256, options) {
  const descriptor = descriptorFrom(slot, "word_timestamps");
  const file = inspectFileDescriptor("word_timestamps", descriptor, { workspaceRoot: options.workspaceRoot });
  const blockers = [...file.blockers];
  let rowCount = 0;
  let coverageStart = null;
  let coverageEnd = null;
  let maxGap = null;
  let lexicalWordCount = 0;
  let uniqueWordCount = 0;
  let boundAudioSha256 = null;
  let audioHashMatches = false;
  let tokens = [];
  let timedRows = [];
  if (file.result.exists) {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(file.result.path, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      payload = null;
    }
    const rows = timelineRows(payload);
    rowCount = rows.length;
    let valid = Boolean(payload && asObject(payload).complete === true && rows.length);
    let nontrivial = valid;
    let previousStart = -1;
    let previousEnd = null;
    let firstStart = null;
    for (const row of rows) {
      const text = clean(row?.word || row?.text || row?.token || row?.caption);
      const rowTokens = lexicalTokens(text);
      const start = timelineValue(row, ["start", "start_s", "start_seconds", "start_time", "begin"]);
      const end = timelineValue(row, ["end", "end_s", "end_seconds", "end_time", "stop"]);
      if (!rowTokens.length || start === null || end === null || start < 0 || end <= start || start < previousStart) {
        valid = false;
      }
      if (firstStart === null && start !== null) firstStart = start;
      if (start !== null && end !== null && end > start) {
        if (previousEnd !== null) {
          const gap = start - previousEnd;
          if (gap < -0.05) valid = false;
          if (gap >= 0) maxGap = Math.max(maxGap || 0, gap);
        }
        if (end - start > Math.max(2.5, rowTokens.length * 1.2)) nontrivial = false;
        previousStart = start;
        previousEnd = end;
        coverageEnd = Math.max(coverageEnd || 0, end);
        timedRows.push({ start, end, tokens: rowTokens });
      }
      tokens.push(...rowTokens);
    }
    coverageStart = firstStart;
    lexicalWordCount = tokens.length;
    uniqueWordCount = new Set(tokens).size;
    const minimumWords = minimumTimelineWordCount(expectedDuration);
    if (rowCount < minimumWords || lexicalWordCount < minimumWords) nontrivial = false;
    if (uniqueWordCount < minimumUniqueWordCount(minimumWords)) nontrivial = false;
    if (maxGap !== null && maxGap > MAX_WORD_TIMESTAMP_GAP_SECONDS) nontrivial = false;
    if (firstStart === null || firstStart > 1) valid = false;
    if (expectedDuration > 0 && !(coverageEnd >= expectedDuration - timelineEndTolerance(expectedDuration))) valid = false;
    if (!valid) blockers.push("word_timestamps_content_incomplete");
    boundAudioSha256 = timestampAudioHash(payload) || null;
    audioHashMatches = Boolean(
      boundAudioSha256 && narrationSha256 && boundAudioSha256 === narrationSha256,
    );
    if (!boundAudioSha256) blockers.push("word_timestamps_audio_hash_missing");
    else if (!audioHashMatches) blockers.push("word_timestamps_audio_hash_mismatch");
    if (!nontrivial || !valid) blockers.push("word_timestamps_nontrivial_coverage_missing");
  }
  return {
    blockers: unique(blockers),
    tokens,
    timedRows,
    evidence: {
      ...file.result,
      row_count: rowCount,
      lexical_word_count: lexicalWordCount,
      unique_word_count: uniqueWordCount,
      coverage_start_seconds: coverageStart,
      coverage_end_seconds: coverageEnd,
      max_gap_seconds: maxGap,
      bound_audio_sha256: boundAudioSha256,
      audio_hash_matches: audioHashMatches,
      complete: blockers.length === 0,
    },
  };
}

function captionTimestampSeconds(value) {
  const parts = clean(value).replace(",", ".").split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return null;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function inspectCaptions(slot, expectedDuration, options) {
  const descriptor = descriptorFrom(slot, "captions");
  const file = inspectFileDescriptor("captions", descriptor, { workspaceRoot: options.workspaceRoot });
  const blockers = [...file.blockers];
  let cueCount = 0;
  let coverageStart = null;
  let coverageEnd = null;
  let maxGap = null;
  let lexicalWordCount = 0;
  let uniqueWordCount = 0;
  let tokens = [];
  let cues = [];
  if (file.result.exists) {
    let contents = "";
    try {
      contents = fs.readFileSync(file.result.path, "utf8").replace(/^\uFEFF/, "");
    } catch {
      contents = "";
    }
    const cuePattern = /(\d{1,3}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{3})[^\r\n]*/g;
    const matches = [...contents.matchAll(cuePattern)];
    let firstStart = null;
    let valid = Boolean(contents.trim());
    let nontrivial = valid;
    let previousEnd = null;
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const start = captionTimestampSeconds(match[1]);
      const end = captionTimestampSeconds(match[2]);
      if (start === null || end === null || end <= start) valid = false;
      if (firstStart === null) firstStart = start;
      const bodyStart = match.index + match[0].length;
      const bodyEnd = matches[index + 1]?.index ?? contents.length;
      const cueText = contents
        .slice(bodyStart, bodyEnd)
        .replace(/^\s*\d+\s*$/gm, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const cueTokens = lexicalTokens(cueText);
      if (!cueTokens.length) valid = false;
      if (start !== null && end !== null && end > start) {
        if (previousEnd !== null) {
          const gap = start - previousEnd;
          if (gap < -0.1) valid = false;
          if (gap >= 0) maxGap = Math.max(maxGap || 0, gap);
        }
        if (end - start > MAX_CAPTION_CUE_SECONDS || cueTokens.length > 24) nontrivial = false;
        previousEnd = end;
        coverageEnd = Math.max(coverageEnd || 0, end);
        cues.push({ start, end, tokens: cueTokens });
      }
      tokens.push(...cueTokens);
      cueCount += 1;
    }
    coverageStart = firstStart;
    lexicalWordCount = tokens.length;
    uniqueWordCount = new Set(tokens).size;
    const minimumWords = minimumTimelineWordCount(expectedDuration);
    const minimumCues = expectedDuration > 0 ? Math.max(4, Math.ceil(expectedDuration / 6)) : 4;
    if (cueCount < minimumCues || lexicalWordCount < Math.floor(minimumWords * 0.85)) nontrivial = false;
    if (uniqueWordCount < minimumUniqueWordCount(minimumWords)) nontrivial = false;
    if (maxGap !== null && maxGap > MAX_CAPTION_GAP_SECONDS) nontrivial = false;
    if (!cueCount || !tokens.length || firstStart === null || firstStart > 1) valid = false;
    if (expectedDuration > 0 && !(coverageEnd >= expectedDuration - timelineEndTolerance(expectedDuration))) valid = false;
    if (!valid) blockers.push("captions_content_incomplete");
    if (!nontrivial || !valid) blockers.push("captions_nontrivial_coverage_missing");
  }
  return {
    blockers: unique(blockers),
    tokens,
    cues,
    evidence: {
      ...file.result,
      cue_count: cueCount,
      lexical_word_count: lexicalWordCount,
      unique_word_count: uniqueWordCount,
      coverage_start_seconds: coverageStart,
      coverage_end_seconds: coverageEnd,
      max_gap_seconds: maxGap,
      complete: blockers.length === 0,
    },
  };
}

function timelineCoherence(wordTimestamps, captions) {
  const wordTokens = asArray(wordTimestamps?.tokens);
  const captionTokens = asArray(captions?.tokens);
  const availableCaptionTokens = new Map();
  for (const token of captionTokens) {
    availableCaptionTokens.set(token, (availableCaptionTokens.get(token) || 0) + 1);
  }
  let matchedTokens = 0;
  for (const token of wordTokens) {
    const available = availableCaptionTokens.get(token) || 0;
    if (available <= 0) continue;
    matchedTokens += 1;
    availableCaptionTokens.set(token, available - 1);
  }
  const textCoverageRatio = Math.max(wordTokens.length, captionTokens.length) > 0
    ? matchedTokens / Math.max(wordTokens.length, captionTokens.length)
    : 0;

  const timedRows = asArray(wordTimestamps?.timedRows);
  const cues = asArray(captions?.cues);
  let cueIndex = 0;
  let coveredRows = 0;
  for (const row of timedRows) {
    const midpoint = (row.start + row.end) / 2;
    while (cues[cueIndex] && cues[cueIndex].end < midpoint - 0.1) cueIndex += 1;
    const cue = cues[cueIndex];
    if (cue && cue.start <= midpoint + 0.1 && cue.end >= midpoint - 0.1) coveredRows += 1;
  }
  const timingCoverageRatio = timedRows.length ? coveredRows / timedRows.length : 0;
  return {
    text_coverage_ratio: Number(textCoverageRatio.toFixed(6)),
    timing_coverage_ratio: Number(timingCoverageRatio.toFixed(6)),
    coherent: textCoverageRatio >= 0.85 && timingCoverageRatio >= 0.9,
  };
}

function rightsAssetId(value) {
  return clean(value?.asset_id || value?.id || value?.source_id);
}

function localEvidenceValue(...values) {
  return values
    .map(clean)
    .find((value) => value && !/^https?:\/\//i.test(value)) || "";
}

function recomputeReferencedFile(filePath, declaredSha256, workspaceRoot) {
  const resolvedPath = resolveEvidencePath(filePath, workspaceRoot);
  const declaredHash = normaliseSha256(declaredSha256);
  const result = {
    path: resolvedPath || null,
    exists: false,
    size_bytes: 0,
    sha256: null,
    declared_sha256: declaredHash || null,
    hash_matches: false,
  };
  if (!resolvedPath || !declaredHash) return result;
  try {
    const stat = fs.statSync(resolvedPath);
    if (!stat.isFile() || stat.size <= 0) return result;
    result.exists = true;
    result.size_bytes = stat.size;
    result.sha256 = hashFileSync(resolvedPath);
    result.hash_matches = result.sha256 === declaredHash;
  } catch {
    // The fail-closed result above is consumed by the rights blockers.
  }
  return result;
}

function hasCanonicalV2RightsCompleteness(object, assets, records) {
  const schemaVersion = Number(object.schema_version);
  const metrics = asObject(object.metrics);
  const reconciliation = asObject(object.reconciliation);
  const verdict = clean(object.verdict).toLowerCase();
  return Number.isInteger(schemaVersion) &&
    schemaVersion >= 2 &&
    ["green", "pass", "approved", "clear"].includes(verdict) &&
    assets.length > 0 &&
    records.length === assets.length &&
    Number(metrics.used_asset_count) === assets.length &&
    Number(metrics.rights_record_count) === records.length &&
    Number(metrics.missing_asset_count) === 0 &&
    Number(metrics.duplicate_record_count) === 0 &&
    asArray(object.blockers).length === 0 &&
    reconciliation.current_files_hashed === true &&
    clean(reconciliation.used_asset_record_coverage) === `${assets.length}/${records.length}`;
}

function inspectRightsLineage(slot, mediaEvidence, options) {
  const descriptor = descriptorFrom(slot, "rights_lineage");
  const file = inspectFileDescriptor("rights_lineage", descriptor, { workspaceRoot: options.workspaceRoot });
  const blockers = [...file.blockers];
  let assetCount = 0;
  let recordCount = 0;
  let contentCompletenessBasis = null;
  const verifiedAssets = [];
  const verifiedEvidence = [];
  if (file.result.exists) {
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(file.result.path, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      payload = null;
    }
    const object = asObject(payload);
    const assets = asArray(object.used_assets).length ? asArray(object.used_assets) : asArray(object.assets);
    const records = [
      ...asArray(object.records),
      ...asArray(object.rights_records),
      ...asArray(object.rights_ledger),
    ];
    assetCount = assets.length;
    recordCount = records.length;
    const canonicalV2Complete = hasCanonicalV2RightsCompleteness(object, assets, records);
    contentCompletenessBasis = object.complete === true
      ? "explicit_complete"
      : canonicalV2Complete
        ? "canonical_v2_reconciled"
        : null;
    let valid = Boolean(payload && contentCompletenessBasis && assets.length && records.length);
    if (asArray(object.missing_assets).length || asArray(object.blockers).length) valid = false;
    if (object.verdict && !["green", "pass", "approved", "clear"].includes(clean(object.verdict).toLowerCase())) valid = false;

    const recordsById = new Map();
    for (const record of records) {
      const recordId = rightsAssetId(record);
      if (!recordId || recordsById.has(recordId)) {
        valid = false;
        blockers.push("rights_record_id_missing_or_duplicate");
        continue;
      }
      recordsById.set(recordId, record);
    }
    const observedAssetIds = new Set();
    for (const asset of assets) {
      const assetId = rightsAssetId(asset);
      const assetHash = normaliseSha256(asset?.asset_sha256 || asset?.sha256 || asset?.content_hash);
      const record = recordsById.get(assetId);
      const recordHash = normaliseSha256(record?.asset_sha256 || record?.sha256 || record?.content_hash);
      const sourceLocator = clean(
        record?.source_url || asset?.source_url || record?.source_reference || asset?.source_reference,
      );
      const rightsBasis = clean(record?.licence_basis || record?.license_basis || record?.rights_basis || record?.allowed_use);
      const assetPath = localEvidenceValue(
        asset?.local_path,
        asset?.asset_path,
        asset?.file_path,
        asset?.path,
        record?.asset_path,
        record?.local_asset_path,
      );
      const evidencePath = localEvidenceValue(
        record?.rights_evidence_path,
        record?.licence_evidence_path,
        record?.license_evidence_path,
        record?.evidence_path,
        record?.evidence_file,
        record?.evidence_reference,
      );
      const evidenceHash = normaliseSha256(
        record?.rights_evidence_sha256 ||
        record?.licence_evidence_sha256 ||
        record?.license_evidence_sha256 ||
        record?.evidence_sha256 ||
        record?.evidence_hash,
      );
      const inspectedAsset = recomputeReferencedFile(assetPath, assetHash, options.workspaceRoot);
      const inspectedEvidence = recomputeReferencedFile(evidencePath, evidenceHash, options.workspaceRoot);

      if (!assetPath || !inspectedAsset.exists) blockers.push("rights_asset_file_missing");
      if (!assetHash || !recordHash) blockers.push("rights_asset_sha256_missing_or_invalid");
      if (assetHash && recordHash && assetHash !== recordHash) blockers.push("rights_asset_record_sha256_mismatch");
      if (inspectedAsset.exists && !inspectedAsset.hash_matches) blockers.push("rights_asset_sha256_mismatch");
      if (inspectedAsset.hash_matches && inspectedAsset.sha256 === normaliseSha256(mediaEvidence?.sha256)) {
        blockers.push("rights_asset_is_final_output_media");
      }
      if (!evidencePath || !inspectedEvidence.exists) blockers.push("rights_evidence_file_missing");
      if (!evidenceHash) blockers.push("rights_evidence_sha256_missing_or_invalid");
      if (inspectedEvidence.exists && !inspectedEvidence.hash_matches) blockers.push("rights_evidence_sha256_mismatch");
      if (
        inspectedAsset.hash_matches &&
        inspectedEvidence.hash_matches &&
        inspectedAsset.sha256 === inspectedEvidence.sha256
      ) {
        blockers.push("rights_evidence_not_independent");
      }
      if (
        !assetId || observedAssetIds.has(assetId) || !sourceLocator || !assetHash || !record || !rightsBasis ||
        record?.commercial_use_allowed !== true || !recordHash || recordHash !== assetHash
      ) {
        valid = false;
      }
      observedAssetIds.add(assetId);
      if (inspectedAsset.hash_matches) {
        verifiedAssets.push({
          asset_id: assetId,
          source_locator: sourceLocator || null,
          ...inspectedAsset,
        });
      } else {
        valid = false;
      }
      if (inspectedEvidence.hash_matches) {
        verifiedEvidence.push({
          asset_id: assetId,
          ...inspectedEvidence,
        });
      } else {
        valid = false;
      }
    }
    if (records.length !== assets.length) valid = false;
    if (!valid) blockers.push("rights_lineage_content_incomplete");
  }
  return {
    blockers: unique(blockers),
    verifiedAssets,
    verifiedEvidence,
    evidence: {
      ...file.result,
      used_asset_count: assetCount,
      rights_record_count: recordCount,
      recomputed_asset_hash_count: verifiedAssets.length,
      recomputed_evidence_hash_count: verifiedEvidence.length,
      verified_assets: verifiedAssets,
      verified_evidence: verifiedEvidence,
      content_completeness_basis: contentCompletenessBasis,
      complete: blockers.length === 0,
    },
  };
}

function identityText(value, kind) {
  if (typeof value === "string") return clean(value);
  const object = asObject(value);
  return clean(
    object.family ||
    object[`${kind}_family`] ||
    object.identity ||
    object.identity_id ||
    object.id ||
    object.name,
  );
}

function materialIdentity(value, kind) {
  let text = identityText(value, kind);
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      text = `${url.hostname}${url.pathname}`;
    } catch {
      // The normal text path below remains fail-closed for malformed URLs.
    }
  }
  return text
    .toLowerCase()
    .replace(/\b(?:variant|version|crop|cropped|cut|edit|slot|short|copy|duplicate)\s*(?:no\.?\s*)?\d*\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceMaterialKey(verifiedAssets, verifiedEvidence) {
  const evidenceByAssetId = new Map(
    asArray(verifiedEvidence).map((row) => [clean(row.asset_id), normaliseSha256(row.sha256)]),
  );
  const rows = asArray(verifiedAssets)
    .map((row) => ({
      asset_id: clean(row.asset_id),
      asset_sha256: normaliseSha256(row.sha256),
      evidence_sha256: evidenceByAssetId.get(clean(row.asset_id)) || "",
      source_locator: materialIdentity(row.source_locator, "source"),
    }))
    .filter((row) => row.asset_id && row.asset_sha256 && row.evidence_sha256 && row.source_locator)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  if (!rows.length) return "";
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function evaluateSlot(slotId, slot, options) {
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    return {
      slot_id: slotId,
      story_id: null,
      expected_media_type: SHORT_SLOTS.includes(slotId) ? "short" : "longform",
      verdict: "RED",
      pass: false,
      blockers: ["slot_missing"],
      media: { sha256: null, decodable: false },
      narration: { sha256: null, complete: false },
      word_timestamps: { sha256: null, complete: false },
      captions: { sha256: null, complete: false },
      rights_lineage: { sha256: null, complete: false },
      final_av_review: { verdict: null, hashes_bound: false },
      source_identity: null,
      motion_identity: null,
    };
  }

  const blockers = [];
  const storyId = clean(slot.story_id || slot.storyId || slot.id);
  if (!storyId) blockers.push("story_id_missing");
  const media = inspectMedia(slotId, slot, options);
  blockers.push(...media.blockers);
  const narration = inspectNarration(slot, media.evidence.duration_seconds, options);
  blockers.push(...narration.blockers);
  const wordTimestamps = inspectWordTimestamps(
    slot,
    narration.evidence.duration_seconds || media.evidence.duration_seconds,
    narration.evidence.sha256,
    options,
  );
  blockers.push(...wordTimestamps.blockers);
  const captions = inspectCaptions(slot, media.evidence.duration_seconds, options);
  blockers.push(...captions.blockers);
  const captionTimestampCoherence = timelineCoherence(wordTimestamps, captions);
  if (!captionTimestampCoherence.coherent) blockers.push("caption_timestamp_timeline_incoherent");
  const rightsLineage = inspectRightsLineage(slot, media.evidence, options);
  blockers.push(...rightsLineage.blockers);
  const finalAvReviewValue = slot.final_av_review ?? slot.finalAvReview;
  const finalAvReviewPath = typeof finalAvReviewValue === "string"
    ? finalAvReviewValue
    : clean(finalAvReviewValue?.path || slot.final_av_review_path);
  const resolvedFinalAvReviewPath = finalAvReviewPath
    ? resolveEvidencePath(finalAvReviewPath, options.workspaceRoot)
    : "";
  const finalAvArtifactDir = resolveEvidencePath(
    slot.artifact_dir || slot.artefact_dir,
    options.workspaceRoot,
  ) || (resolvedFinalAvReviewPath ? path.dirname(resolvedFinalAvReviewPath) : options.workspaceRoot);
  const finalAvOptions = {
    storyId,
    artifactDir: finalAvArtifactDir,
    finalMp4Path: media.evidence.path || "",
    ffprobePath: options.ffprobePath,
    ffmpegPath: options.ffmpegPath,
    probeTimeoutMs: options.probeTimeoutMs,
    decodeTimeoutMs: options.decodeTimeoutMs,
    ...(typeof options.finalAvProbeMedia === "function"
      ? { probeMedia: options.finalAvProbeMedia }
      : {}),
    ...(typeof options.finalAvDecodeMedia === "function"
      ? { decodeMedia: options.finalAvDecodeMedia }
      : {}),
  };
  const strictFinalAvReview = resolvedFinalAvReviewPath
    ? await validateFinalAvReviewFile(resolvedFinalAvReviewPath, finalAvOptions)
    : await validateFinalAvReview(asObject(finalAvReviewValue), finalAvOptions);
  const strictForensicBlockers = asArray(
    strictFinalAvReview.evidence?.decoded_forensic_report?.blockers,
  );
  blockers.push(...asArray(strictFinalAvReview.blockers), ...strictForensicBlockers);

  const sourceIdentity = identityText(slot.source_identity || slot.source_family, "source");
  const motionIdentity = identityText(slot.motion_identity || slot.motion_family, "motion");
  const verifiedSourceMaterialKey = sourceMaterialKey(
    rightsLineage.verifiedAssets,
    rightsLineage.verifiedEvidence,
  );
  if (SHORT_SLOTS.includes(slotId)) {
    if (!materialIdentity(sourceIdentity, "source")) blockers.push("source_identity_missing");
    if (!materialIdentity(motionIdentity, "motion")) blockers.push("motion_identity_missing");
  }
  const uniqueBlockers = unique(blockers);
  return {
    slot_id: slotId,
    story_id: storyId || null,
    expected_media_type: SHORT_SLOTS.includes(slotId) ? "short" : "longform",
    verdict: uniqueBlockers.length ? "RED" : "GREEN",
    pass: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    media: media.evidence,
    narration: narration.evidence,
    word_timestamps: {
      ...wordTimestamps.evidence,
      caption_text_coverage_ratio: captionTimestampCoherence.text_coverage_ratio,
      caption_timing_coverage_ratio: captionTimestampCoherence.timing_coverage_ratio,
    },
    captions: {
      ...captions.evidence,
      timestamp_text_coverage_ratio: captionTimestampCoherence.text_coverage_ratio,
      timestamp_timing_coverage_ratio: captionTimestampCoherence.timing_coverage_ratio,
    },
    rights_lineage: rightsLineage.evidence,
    final_av_review: {
      ...asObject(strictFinalAvReview.evidence),
      strict_valid: strictFinalAvReview.valid === true,
      verdict: clean(strictFinalAvReview.verdict) || "RED",
      blockers: asArray(strictFinalAvReview.blockers),
      decoded_forensic_blockers: strictForensicBlockers,
    },
    source_identity: sourceIdentity || null,
    source_identity_material_key: materialIdentity(sourceIdentity, "source") || null,
    source_material_key: verifiedSourceMaterialKey || null,
    motion_identity: motionIdentity || null,
    motion_identity_material_key: materialIdentity(motionIdentity, "motion") || null,
  };
}

async function evaluateFlagshipMediaPortfolio(portfolio = {}, options = {}) {
  const resolvedOptions = {
    workspaceRoot: options.workspaceRoot || process.cwd(),
    generatedAt: clean(options.generatedAt || options.generated_at) || new Date().toISOString(),
    ffprobePath: options.ffprobePath || process.env.FFPROBE_PATH || "ffprobe",
    ffmpegPath: options.ffmpegPath || process.env.FFMPEG_PATH || "ffmpeg",
    probeFile: options.probeFile || defaultProbeFile,
    decodeMedia: options.decodeMedia || defaultDecodeMedia,
    decodeAudio: options.decodeAudio || defaultDecodeAudio,
    finalAvProbeMedia: options.finalAvProbeMedia || options.probeMedia,
    finalAvDecodeMedia: options.finalAvDecodeMedia || options.strictDecodeMedia,
    probeTimeoutMs: options.probeTimeoutMs || 30_000,
    decodeTimeoutMs: options.decodeTimeoutMs || 300_000,
  };
  // Keep the default helpers' option names stable while permitting explicit test doubles.
  resolvedOptions.timeoutMs = undefined;
  const originalProbe = resolvedOptions.probeFile;
  const originalDecodeMedia = resolvedOptions.decodeMedia;
  const originalDecodeAudio = resolvedOptions.decodeAudio;
  resolvedOptions.probeFile = (filePath) => originalProbe(filePath, {
    ...resolvedOptions,
    timeoutMs: resolvedOptions.probeTimeoutMs,
  });
  resolvedOptions.decodeMedia = (filePath) => originalDecodeMedia(filePath, {
    ...resolvedOptions,
    timeoutMs: resolvedOptions.decodeTimeoutMs,
  });
  resolvedOptions.decodeAudio = (filePath) => originalDecodeAudio(filePath, {
    ...resolvedOptions,
    timeoutMs: resolvedOptions.decodeTimeoutMs,
  });

  const { slots: suppliedSlots, duplicateSlotIds } = normaliseSlotMap(portfolio);
  const globalBlockers = [];
  const blockerCodes = new Set();
  const addGlobal = (code, detail = "") => {
    blockerCodes.add(code);
    globalBlockers.push(detail ? `${code}:${detail}` : code);
  };

  if (!portfolio || typeof portfolio !== "object" || Array.isArray(portfolio)) addGlobal("portfolio_manifest_invalid");
  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    if (!Object.prototype.hasOwnProperty.call(suppliedSlots, slotId)) addGlobal("required_slot_missing", slotId);
  }
  for (const slotId of Object.keys(suppliedSlots)) {
    if (!FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.includes(slotId)) addGlobal("unexpected_slot", slotId);
  }
  for (const slotId of duplicateSlotIds) addGlobal("duplicate_slot", slotId);

  const slots = {};
  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    slots[slotId] = await evaluateSlot(slotId, suppliedSlots[slotId], resolvedOptions);
  }

  const storyGroups = new Map();
  for (const row of Object.values(slots)) {
    if (!row.story_id) continue;
    const key = row.story_id.toLowerCase();
    if (!storyGroups.has(key)) storyGroups.set(key, []);
    storyGroups.get(key).push(row);
  }
  for (const rows of storyGroups.values()) {
    if (rows.length < 2) continue;
    addGlobal("story_id_not_unique", rows[0].story_id);
    for (const row of rows) row.blockers.push("story_id_not_unique");
  }
  if (storyGroups.size !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length) addGlobal("four_unique_story_ids_required");

  const mediaHashGroups = new Map();
  for (const row of Object.values(slots)) {
    const hash = normaliseSha256(row.media?.sha256);
    if (!hash) continue;
    if (!mediaHashGroups.has(hash)) mediaHashGroups.set(hash, []);
    mediaHashGroups.get(hash).push(row);
  }
  for (const [hash, rows] of mediaHashGroups) {
    if (rows.length < 2) continue;
    addGlobal("media_sha256_not_unique", hash);
    for (const row of rows) row.blockers.push("media_sha256_not_unique");
  }
  if (mediaHashGroups.size !== FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length) addGlobal("four_unique_media_sha256_hashes_required");

  const shortRows = SHORT_SLOTS.map((slotId) => slots[slotId]);
  const claimedSourceGroups = new Map();
  const sourceMaterialGroups = new Map();
  const motionGroups = new Map();
  for (const row of shortRows) {
    if (row.source_identity_material_key) {
      if (!claimedSourceGroups.has(row.source_identity_material_key)) claimedSourceGroups.set(row.source_identity_material_key, []);
      claimedSourceGroups.get(row.source_identity_material_key).push(row);
    }
    if (row.source_material_key) {
      if (!sourceMaterialGroups.has(row.source_material_key)) sourceMaterialGroups.set(row.source_material_key, []);
      sourceMaterialGroups.get(row.source_material_key).push(row);
    }
    if (row.motion_identity_material_key) {
      if (!motionGroups.has(row.motion_identity_material_key)) motionGroups.set(row.motion_identity_material_key, []);
      motionGroups.get(row.motion_identity_material_key).push(row);
    }
  }
  if (claimedSourceGroups.size !== SHORT_SLOTS.length) {
    addGlobal("short_source_identities_not_materially_different");
    for (const rows of claimedSourceGroups.values()) {
      if (rows.length > 1) for (const row of rows) row.blockers.push("source_identity_not_materially_different");
    }
  }
  let shortSourcesMateriallyDifferent = sourceMaterialGroups.size === SHORT_SLOTS.length;
  for (let leftIndex = 0; leftIndex < shortRows.length; leftIndex += 1) {
    const leftHashes = new Set(
      asArray(shortRows[leftIndex].rights_lineage?.verified_assets)
        .map((asset) => normaliseSha256(asset.sha256))
        .filter(Boolean),
    );
    for (let rightIndex = leftIndex + 1; rightIndex < shortRows.length; rightIndex += 1) {
      const rightHashes = new Set(
        asArray(shortRows[rightIndex].rights_lineage?.verified_assets)
          .map((asset) => normaliseSha256(asset.sha256))
          .filter(Boolean),
      );
      const sharedHashCount = [...leftHashes].filter((hash) => rightHashes.has(hash)).length;
      const smallerSetSize = Math.min(leftHashes.size, rightHashes.size);
      if (smallerSetSize > 0 && sharedHashCount / smallerSetSize >= 0.5) {
        shortSourcesMateriallyDifferent = false;
        shortRows[leftIndex].blockers.push("source_asset_bytes_reused");
        shortRows[rightIndex].blockers.push("source_asset_bytes_reused");
      }
    }
  }
  if (!shortSourcesMateriallyDifferent) {
    addGlobal("short_sources_not_materially_different");
    for (const row of shortRows) {
      if (!row.source_material_key) row.blockers.push("source_material_not_verified_or_distinct");
    }
  }
  if (motionGroups.size !== SHORT_SLOTS.length) {
    addGlobal("short_motion_identities_not_materially_different");
    for (const rows of motionGroups.values()) {
      if (rows.length > 1) for (const row of rows) row.blockers.push("motion_identity_not_materially_different");
    }
  }
  let shortVisualsMateriallyDifferent = shortRows.every((row) => (
    row.media?.visual_diversity?.material === true && row.media?.visual_fingerprint
  ));
  for (let leftIndex = 0; leftIndex < shortRows.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < shortRows.length; rightIndex += 1) {
      const comparison = compareVideoFingerprints(
        shortRows[leftIndex].media?.visual_fingerprint,
        shortRows[rightIndex].media?.visual_fingerprint,
      );
      if (comparison.near_duplicate) {
        shortVisualsMateriallyDifferent = false;
        shortRows[leftIndex].blockers.push("short_visual_near_duplicate");
        shortRows[rightIndex].blockers.push("short_visual_near_duplicate");
      }
    }
  }
  if (!shortVisualsMateriallyDifferent) {
    addGlobal("short_visuals_not_materially_different");
    for (const row of shortRows) row.blockers.push("short_visual_not_materially_different");
  }

  for (const row of Object.values(slots)) {
    row.blockers = unique(row.blockers);
    row.pass = row.blockers.length === 0;
    row.verdict = row.pass ? "GREEN" : "RED";
    for (const code of row.blockers) {
      blockerCodes.add(code);
      globalBlockers.push(`${row.slot_id}:${code}`);
    }
  }
  const blockers = unique(globalBlockers);
  const contractSatisfied = blockers.length === 0 && Object.values(slots).every((row) => row.pass);
  const slotResults = FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.map((slotId) => slots[slotId]);
  return {
    contract_id: CONTRACT_ID,
    schema_version: 1,
    report_type: "flagship_media_portfolio_contract_evaluation",
    evaluation_complete: true,
    generated_at: resolvedOptions.generatedAt,
    operating_mode: "LOCAL_PROOF",
    verdict: contractSatisfied ? "GREEN" : "RED",
    status: contractSatisfied ? "GREEN" : "RED",
    contract_satisfied: contractSatisfied,
    portfolio_ready: contractSatisfied,
    required_slots: [...FLAGSHIP_MEDIA_PORTFOLIO_SLOTS],
    slots,
    slot_results: slotResults,
    blockers,
    blocker_codes: [...blockerCodes],
    summary: {
      required_slot_count: FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.length,
      supplied_required_slot_count: FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.filter((slotId) => suppliedSlots[slotId]).length,
      verified_slot_count: slotResults.filter((row) => row.pass).length,
      blocked_slot_count: slotResults.filter((row) => !row.pass).length,
      unique_story_count: storyGroups.size,
      unique_media_hash_count: mediaHashGroups.size,
      blocker_count: blockers.length,
    },
    short_identity_diversity: {
      required_count: SHORT_SLOTS.length,
      unique_source_identity_count: claimedSourceGroups.size,
      unique_verified_source_material_count: sourceMaterialGroups.size,
      verified_sources_materially_different: shortSourcesMateriallyDifferent,
      unique_motion_identity_count: motionGroups.size,
      visual_materially_different: shortVisualsMateriallyDifferent,
      materially_different:
        claimedSourceGroups.size === SHORT_SLOTS.length &&
        shortSourcesMateriallyDifferent &&
        motionGroups.size === SHORT_SLOTS.length &&
        shortVisualsMateriallyDifferent,
    },
    safety: {
      no_live_actions: true,
      publish_authorised: false,
      external_posting_performed: false,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      goal_contract_integrated: false,
    },
  };
}

function renderFlagshipMediaPortfolioMarkdown(report = {}) {
  const lines = [
    "# Flagship Media Portfolio Contract",
    "",
    `- Verdict: ${clean(report.verdict) || "RED"}`,
    `- Contract satisfied: ${report.contract_satisfied === true ? "yes" : "no"}`,
    `- Publish authorised: ${report.safety?.publish_authorised === true ? "yes" : "no"}`,
    `- Goal-contract integrated: ${report.safety?.goal_contract_integrated === true ? "yes" : "no"}`,
    `- Generated at: ${clean(report.generated_at) || "unknown"}`,
    "",
    "## Slots",
    "",
    "| Slot | Story | Type | Duration | Geometry | Codecs | SHA-256 | Verdict |",
    "| --- | --- | --- | ---: | --- | --- | --- | --- |",
  ];
  for (const slotId of FLAGSHIP_MEDIA_PORTFOLIO_SLOTS) {
    const row = report.slots?.[slotId] || {};
    const media = row.media || {};
    const duration = Number.isFinite(Number(media.duration_seconds)) ? `${Number(media.duration_seconds).toFixed(3)}s` : "missing";
    const geometry = media.width && media.height ? `${media.width}x${media.height} ${media.orientation || ""}`.trim() : "missing";
    const codecs = media.video_codec && media.audio_codec ? `${media.video_codec}/${media.audio_codec}` : "missing";
    lines.push(
      `| ${slotId} | ${clean(row.story_id) || "missing"} | ${clean(row.expected_media_type) || "missing"} | ${duration} | ${geometry} | ${codecs} | ${clean(media.sha256) || "missing"} | ${clean(row.verdict) || "RED"} |`,
    );
  }
  lines.push("", "## Safety", "", "This report is local proof only. It cannot authorise publishing or integrate itself into the goal contract.");
  if (asArray(report.blockers).length) {
    lines.push("", "## Blockers", "");
    for (const blocker of report.blockers) lines.push(`- ${clean(blocker)}`);
  }
  return `${lines.join("\n")}\n`;
}

function isEvaluatedReport(report) {
  return Boolean(
    report &&
    report.contract_id === CONTRACT_ID &&
    report.report_type === "flagship_media_portfolio_contract_evaluation" &&
    report.evaluation_complete === true &&
    report.slots &&
    FLAGSHIP_MEDIA_PORTFOLIO_SLOTS.every((slotId) => report.slots[slotId]),
  );
}

async function atomicWrite(filePath, contents) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.outputFile(temporaryPath, contents);
  try {
    await fs.move(temporaryPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(temporaryPath);
  }
}

async function writeFlagshipMediaPortfolioReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeFlagshipMediaPortfolioReport requires outputDir");
  if (!isEvaluatedReport(report)) {
    throw new Error("writeFlagshipMediaPortfolioReport requires an evaluated flagship media portfolio report");
  }
  const safeReport = {
    ...report,
    operating_mode: "LOCAL_PROOF",
    safety: {
      ...asObject(report.safety),
      no_live_actions: true,
      publish_authorised: false,
      external_posting_performed: false,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      goal_contract_integrated: false,
    },
  };
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "flagship_media_portfolio_report.json");
  const markdownPath = path.join(outDir, "flagship_media_portfolio_report.md");
  await atomicWrite(jsonPath, `${JSON.stringify(safeReport, null, 2)}\n`);
  await atomicWrite(markdownPath, renderFlagshipMediaPortfolioMarkdown(safeReport));
  return { jsonPath, markdownPath, report: safeReport };
}

async function evaluateAndWriteFlagshipMediaPortfolio(portfolio = {}, options = {}) {
  const { outputDir, ...evaluationOptions } = options;
  if (!outputDir) throw new Error("evaluateAndWriteFlagshipMediaPortfolio requires outputDir");
  const report = await evaluateFlagshipMediaPortfolio(portfolio, evaluationOptions);
  return writeFlagshipMediaPortfolioReport(report, { outputDir });
}

module.exports = {
  CONTRACT_ID,
  FLAGSHIP_MEDIA_PORTFOLIO_SLOTS,
  LONGFORM_MIN_DURATION_SECONDS,
  REQUIRED_SLOTS: FLAGSHIP_MEDIA_PORTFOLIO_SLOTS,
  defaultDecodeAudio,
  defaultDecodeMedia,
  defaultProbeFile,
  evaluateAndWriteFlagshipMediaPortfolio,
  evaluateFlagshipMediaPortfolio,
  evaluateFlagshipMediaPortfolioContract: evaluateFlagshipMediaPortfolio,
  renderFlagshipMediaPortfolioMarkdown,
  writeFlagshipMediaPortfolio: evaluateAndWriteFlagshipMediaPortfolio,
  writeFlagshipMediaPortfolioReport,
};
