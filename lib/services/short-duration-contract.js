"use strict";

const DEFAULT_MIN_SHORT_VIDEO_SECONDS = 61;
const DEFAULT_MAX_SHORT_VIDEO_SECONDS = 75;
const DEFAULT_RENDER_BREATHING_ROOM_SECONDS = 1;

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

function classifyShortDuration({
  audioDurationSeconds,
  videoDurationSeconds,
  minVideoSeconds = DEFAULT_MIN_SHORT_VIDEO_SECONDS,
  maxVideoSeconds = DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  breathingRoomSeconds = DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
} = {}) {
  const failures = [];
  const warnings = [];
  const audio = asFiniteNumber(audioDurationSeconds);
  const explicitVideo = asFiniteNumber(videoDurationSeconds);
  const estimatedVideo =
    explicitVideo === null
      ? estimateVideoDurationFromAudio(audio, breathingRoomSeconds)
      : roundSeconds(explicitVideo);

  if (audio !== null) {
    const maxAudio = maxVideoSeconds - breathingRoomSeconds;
    if (audio > maxAudio) {
      failures.push(
        `audio_duration_too_long (${audio.toFixed(2)}s, max ${maxAudio.toFixed(2)}s)`,
      );
    }
  }

  if (estimatedVideo !== null) {
    if (estimatedVideo < minVideoSeconds) {
      warnings.push(
        `video_duration_below_tiktok_target (${estimatedVideo.toFixed(2)}s, min ${minVideoSeconds.toFixed(2)}s)`,
      );
    } else if (estimatedVideo > maxVideoSeconds) {
      failures.push(
        `video_duration_too_long (${estimatedVideo.toFixed(2)}s, max ${maxVideoSeconds.toFixed(2)}s)`,
      );
    }
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings,
    audioDurationSeconds: audio,
    estimatedVideoDurationSeconds: estimatedVideo,
    minVideoSeconds,
    maxVideoSeconds,
    breathingRoomSeconds,
  };
}

module.exports = {
  classifyShortDuration,
  estimateVideoDurationFromAudio,
  DEFAULT_MIN_SHORT_VIDEO_SECONDS,
  DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
};
