"use strict";

const DEFAULT_MIN_SHORT_VIDEO_SECONDS = 61;
const DEFAULT_MAX_SHORT_VIDEO_SECONDS = 75;
const DEFAULT_MAX_EXTENDED_SHORT_VIDEO_SECONDS = 90;
const DEFAULT_RENDER_BREATHING_ROOM_SECONDS = 1;
const FLASH_DURATION_LANE = "pulse_flash_short";
const EXTENDED_DURATION_LANE = "pulse_extended_short";

const EXTENDED_DURATION_LANE_ALIASES = new Set([
  EXTENDED_DURATION_LANE,
  "extended_short",
  "extended_or_briefing",
  "pulse_extended",
]);

function roundSeconds(value) {
  return Number(value.toFixed(3));
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normaliseDurationLane(value) {
  if (!value || typeof value !== "string") return null;
  const lane = value.trim().toLowerCase();
  if (EXTENDED_DURATION_LANE_ALIASES.has(lane)) return EXTENDED_DURATION_LANE;
  if (lane === FLASH_DURATION_LANE || lane === "flash_short") return FLASH_DURATION_LANE;
  return null;
}

function resolveDurationLane({ lane, story } = {}) {
  const direct = normaliseDurationLane(lane);
  if (direct) return direct;

  const candidates = [
    story?.duration_lane,
    story?.runtime_lane,
    story?.runtime_route,
    story?.format_lane,
    story?.lane_id,
    story?.short_runtime_plan?.route,
    story?.format_route,
    story?.format_verdict,
    story?.suggested_format,
    story?.recommended_format,
  ];
  for (const candidate of candidates) {
    const normalised = normaliseDurationLane(candidate);
    if (normalised) return normalised;
  }
  return FLASH_DURATION_LANE;
}

function durationBoundsForLane(lane) {
  const durationLane = normaliseDurationLane(lane) || FLASH_DURATION_LANE;
  if (durationLane === EXTENDED_DURATION_LANE) {
    return {
      durationLane,
      minVideoSeconds: DEFAULT_MIN_SHORT_VIDEO_SECONDS,
      maxVideoSeconds: DEFAULT_MAX_EXTENDED_SHORT_VIDEO_SECONDS,
    };
  }
  return {
    durationLane: FLASH_DURATION_LANE,
    minVideoSeconds: DEFAULT_MIN_SHORT_VIDEO_SECONDS,
    maxVideoSeconds: DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  };
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
  minVideoSeconds,
  maxVideoSeconds,
  breathingRoomSeconds = DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
  lane,
  story,
} = {}) {
  const failures = [];
  const warnings = [];
  const laneBounds = durationBoundsForLane(resolveDurationLane({ lane, story }));
  const minSeconds = asFiniteNumber(minVideoSeconds) ?? laneBounds.minVideoSeconds;
  const maxSeconds = asFiniteNumber(maxVideoSeconds) ?? laneBounds.maxVideoSeconds;
  const audio = asFiniteNumber(audioDurationSeconds);
  const explicitVideo = asFiniteNumber(videoDurationSeconds);
  const estimatedVideo =
    explicitVideo === null
      ? estimateVideoDurationFromAudio(audio, breathingRoomSeconds)
      : roundSeconds(explicitVideo);

  if (audio !== null) {
    const maxAudio = maxSeconds - breathingRoomSeconds;
    if (audio > maxAudio) {
      failures.push(
        `audio_duration_too_long (${audio.toFixed(2)}s, max ${maxAudio.toFixed(2)}s)`,
      );
    }
  }

  if (estimatedVideo !== null) {
    if (estimatedVideo < minSeconds) {
      warnings.push(
        `video_duration_below_tiktok_target (${estimatedVideo.toFixed(2)}s, min ${minSeconds.toFixed(2)}s)`,
      );
    } else if (estimatedVideo > maxSeconds) {
      failures.push(
        `video_duration_too_long (${estimatedVideo.toFixed(2)}s, max ${maxSeconds.toFixed(2)}s)`,
      );
    }
  }

  return {
    result: failures.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    failures,
    warnings,
    audioDurationSeconds: audio,
    estimatedVideoDurationSeconds: estimatedVideo,
    minVideoSeconds: minSeconds,
    maxVideoSeconds: maxSeconds,
    breathingRoomSeconds,
    durationLane: laneBounds.durationLane,
  };
}

module.exports = {
  classifyShortDuration,
  durationBoundsForLane,
  estimateVideoDurationFromAudio,
  resolveDurationLane,
  DEFAULT_MIN_SHORT_VIDEO_SECONDS,
  DEFAULT_MAX_SHORT_VIDEO_SECONDS,
  DEFAULT_MAX_EXTENDED_SHORT_VIDEO_SECONDS,
  DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
  FLASH_DURATION_LANE,
  EXTENDED_DURATION_LANE,
};
