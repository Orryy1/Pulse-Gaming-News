"use strict";

const DEFAULT_MIN_SHORT_VIDEO_SECONDS = 61;
const DEFAULT_MAX_SHORT_VIDEO_SECONDS = 75;
const DEFAULT_RENDER_BREATHING_ROOM_SECONDS = 1;
const EXTENDED_MIN_SHORT_VIDEO_SECONDS = 61;
const EXTENDED_MAX_SHORT_VIDEO_SECONDS = 90;
const EXTENDED_SHORT_FORMATS = new Set([
  "evergreen_verdict_short",
  "pulse_extended_short",
  "extended_short",
]);

function roundSeconds(value) {
  return Number(value.toFixed(3));
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function estimateVideoDurationFromAudio(
  audioDurationSeconds,
  breathingRoomSeconds = DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
) {
  const audio = asFiniteNumber(audioDurationSeconds);
  const breathing = asFiniteNumber(breathingRoomSeconds);
  if (audio === null) return null;
  return roundSeconds(audio + (breathing === null ? 0 : breathing));
}

function resolveShortDurationBounds({
  editorialFormat,
  durationLane,
  story = null,
} = {}) {
  const format = String(
    editorialFormat ||
      durationLane ||
      story?.editorial_format ||
      story?.format_intent ||
      story?.format_id ||
      story?.duration_lane ||
      "",
  )
    .trim()
    .toLowerCase();
  if (EXTENDED_SHORT_FORMATS.has(format)) {
    return {
      laneId: "pulse_extended_short",
      minVideoSeconds: EXTENDED_MIN_SHORT_VIDEO_SECONDS,
      maxVideoSeconds: EXTENDED_MAX_SHORT_VIDEO_SECONDS,
    };
  }
  return {
    laneId: "pulse_standard_short",
    minVideoSeconds: DEFAULT_MIN_SHORT_VIDEO_SECONDS,
    maxVideoSeconds: DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  };
}

function classifyShortDuration({
  audioDurationSeconds,
  videoDurationSeconds,
  minVideoSeconds = null,
  maxVideoSeconds = null,
  breathingRoomSeconds = DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
  editorialFormat,
  durationLane,
  story = null,
} = {}) {
  const failures = [];
  const warnings = [];
  const bounds = resolveShortDurationBounds({
    editorialFormat,
    durationLane,
    story,
  });
  const effectiveMin =
    asFiniteNumber(minVideoSeconds) ?? bounds.minVideoSeconds;
  const effectiveMax =
    asFiniteNumber(maxVideoSeconds) ?? bounds.maxVideoSeconds;
  const audio = asFiniteNumber(audioDurationSeconds);
  const explicitVideo = asFiniteNumber(videoDurationSeconds);
  const estimatedVideo =
    explicitVideo === null
      ? estimateVideoDurationFromAudio(audio, breathingRoomSeconds)
      : roundSeconds(explicitVideo);

  if (audio !== null) {
    const maxAudio = effectiveMax - breathingRoomSeconds;
    if (audio > maxAudio) {
      failures.push(
        `audio_duration_too_long (${audio.toFixed(2)}s, max ${maxAudio.toFixed(2)}s)`,
      );
    }
  }

  if (estimatedVideo !== null) {
    if (estimatedVideo < effectiveMin) {
      warnings.push(
        `video_duration_below_tiktok_target (${estimatedVideo.toFixed(2)}s, min ${effectiveMin.toFixed(2)}s)`,
      );
    } else if (estimatedVideo > effectiveMax) {
      failures.push(
        `video_duration_too_long (${estimatedVideo.toFixed(2)}s, max ${effectiveMax.toFixed(2)}s)`,
      );
    }
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings,
    audioDurationSeconds: audio,
    estimatedVideoDurationSeconds: estimatedVideo,
    laneId: bounds.laneId,
    minVideoSeconds: effectiveMin,
    maxVideoSeconds: effectiveMax,
    breathingRoomSeconds,
  };
}

module.exports = {
  classifyShortDuration,
  estimateVideoDurationFromAudio,
  resolveShortDurationBounds,
  DEFAULT_MIN_SHORT_VIDEO_SECONDS,
  DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
  EXTENDED_MIN_SHORT_VIDEO_SECONDS,
  EXTENDED_MAX_SHORT_VIDEO_SECONDS,
};
