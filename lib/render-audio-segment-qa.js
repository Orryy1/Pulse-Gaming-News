"use strict";

const { promisify } = require("node:util");
const { execFile } = require("node:child_process");

const execFileAsync = promisify(execFile);

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseVolumedetectStats(text = "") {
  const source = String(text || "");
  const mean = source.match(/mean_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  const max = source.match(/max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/i);
  return {
    mean_volume_db: mean ? numberOrNull(mean[1]) : null,
    max_volume_db: max ? numberOrNull(max[1]) : null,
  };
}

function buildSegmentWindows({
  durationS,
  segmentCount = 6,
  sampleDurationS = 4,
  startOffsetS = 1,
  endOffsetS = 1,
} = {}) {
  const duration = Math.max(0, numberOrNull(durationS) ?? 0);
  const count = Math.max(1, Math.floor(numberOrNull(segmentCount) ?? 6));
  const sampleDuration = Math.max(0.5, numberOrNull(sampleDurationS) ?? 4);
  const startOffset = Math.max(0, numberOrNull(startOffsetS) ?? 1);
  const endOffset = Math.max(0, numberOrNull(endOffsetS) ?? 1);
  const usableDuration = Math.max(0, duration - startOffset - endOffset);
  if (duration <= 0) return [];
  if (usableDuration <= sampleDuration || count === 1) {
    return [
      {
        start_s: Number(Math.min(startOffset, Math.max(0, duration - sampleDuration)).toFixed(3)),
        duration_s: Number(Math.min(sampleDuration, duration).toFixed(3)),
      },
    ];
  }

  const maxStart = duration - endOffset - sampleDuration;
  const step = count > 1 ? (maxStart - startOffset) / (count - 1) : 0;
  return Array.from({ length: count }, (_, index) => ({
    start_s: Number((startOffset + step * index).toFixed(3)),
    duration_s: Number(sampleDuration.toFixed(3)),
  }));
}

function evaluateAudioSegmentLoudness({
  segments = [],
  maxMeanRangeDb = 5,
  maxAdjacentRiseDb = 4,
  maxPeakDb = -0.8,
  minValidSegments = 3,
} = {}) {
  const valid = (Array.isArray(segments) ? segments : []).filter(
    (segment) => numberOrNull(segment.mean_volume_db) !== null,
  );
  const blockers = [];
  const warnings = [];
  if (valid.length < minValidSegments) blockers.push("audio_segment_loudness_unverified");

  const means = valid.map((segment) => numberOrNull(segment.mean_volume_db));
  const peaks = valid
    .map((segment) => numberOrNull(segment.max_volume_db))
    .filter((value) => value !== null);
  const meanRangeDb = means.length ? Math.max(...means) - Math.min(...means) : null;
  const peakMaxDb = peaks.length ? Math.max(...peaks) : null;
  let maxAdjacentRise = 0;
  for (let index = 1; index < means.length; index += 1) {
    maxAdjacentRise = Math.max(maxAdjacentRise, means[index] - means[index - 1]);
  }

  if (meanRangeDb !== null && meanRangeDb > maxMeanRangeDb) {
    blockers.push("voice_segment_loudness_jump");
  }
  if (maxAdjacentRise > maxAdjacentRiseDb) {
    blockers.push("voice_segment_loudness_late_jump");
  }
  if (peakMaxDb !== null && peakMaxDb > maxPeakDb) {
    blockers.push("voice_peak_too_hot");
  }

  return {
    verdict: blockers.length ? "fail" : "pass",
    blockers,
    warnings,
    metrics: {
      valid_segment_count: valid.length,
      mean_range_db: meanRangeDb === null ? null : Number(meanRangeDb.toFixed(2)),
      max_adjacent_rise_db: Number(maxAdjacentRise.toFixed(2)),
      max_peak_db: peakMaxDb === null ? null : Number(peakMaxDb.toFixed(2)),
    },
    segments,
  };
}

async function measureAudioSegment({
  inputPath,
  startS,
  durationS,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  execFileImpl = execFileAsync,
  timeoutMs = 30000,
} = {}) {
  const result = await execFileImpl(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostats",
      "-ss",
      String(Math.max(0, numberOrNull(startS) ?? 0)),
      "-t",
      String(Math.max(0.5, numberOrNull(durationS) ?? 4)),
      "-i",
      inputPath,
      "-vn",
      "-af",
      "volumedetect",
      "-f",
      "null",
      "-",
    ],
    { timeout: timeoutMs },
  );
  return parseVolumedetectStats([result?.stderr, result?.stdout].filter(Boolean).join("\n"));
}

async function auditRenderedAudioSegments({
  storyId = "",
  inputPath,
  durationS,
  ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
  execFileImpl = execFileAsync,
  generatedAt = new Date().toISOString(),
  thresholds = {},
} = {}) {
  if (!inputPath) {
    return {
      schema_version: 1,
      generated_at: generatedAt,
      story_id: storyId || null,
      input_path: null,
      verdict: "fail",
      blockers: ["audio_segment_input_missing"],
      warnings: [],
      metrics: { valid_segment_count: 0 },
      segments: [],
    };
  }

  const windows = buildSegmentWindows({ durationS });
  const segments = [];
  for (const window of windows) {
    try {
      const stats = await measureAudioSegment({
        inputPath,
        startS: window.start_s,
        durationS: window.duration_s,
        ffmpegPath,
        execFileImpl,
      });
      segments.push({ ...window, ...stats, ok: stats.mean_volume_db !== null });
    } catch (err) {
      segments.push({
        ...window,
        mean_volume_db: null,
        max_volume_db: null,
        ok: false,
        error: err.message,
      });
    }
  }
  const evaluated = evaluateAudioSegmentLoudness({ segments, ...thresholds });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: storyId || null,
    input_path: inputPath,
    ...evaluated,
    safety: {
      read_only: true,
      mutates_media: false,
      mutates_production_db: false,
      mutates_tokens: false,
      posts_to_platforms: false,
    },
  };
}

module.exports = {
  auditRenderedAudioSegments,
  buildSegmentWindows,
  evaluateAudioSegmentLoudness,
  measureAudioSegment,
  parseVolumedetectStats,
};
