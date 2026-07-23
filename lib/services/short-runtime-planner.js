"use strict";

const {
  classifyVerifiedFirstPartyAnnouncement,
} = require("../first-party-breaking-news");
const {
  BREAKING_NEWS_DURATION_LANE,
  DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_RENDER_BREATHING_ROOM_SECONDS,
} = require("./short-duration-contract");

const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;
const REVIEW_MAX_SECONDS = 90;
const BREAKING_NEWS_MIN_SECONDS = DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS;
const BREAKING_NEWS_MAX_SECONDS =
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS - DEFAULT_RENDER_BREATHING_ROOM_SECONDS;
const BREAKING_NEWS_MIN_WORDS = 80;
const BREAKING_NEWS_MAX_WORDS = 180;

// Calibrated from live Pulse Gaming ElevenLabs output on 2026-05-02:
// 159-178 spoken words produced 109-123s audio. That is roughly
// 0.68s per cleaned TTS word, including punctuation pauses.
const DEFAULT_SECONDS_PER_WORD = 0.68;
// Recalibrated from accepted Sleepy Liam / Pulse local proofs on
// 2026-05-30 after the local clone was re-prewarmed. The latest
// source-bound repairs produced roughly 200-204 WPM, so 180-200 words
// can still land below the 61s floor. Keep this conservative until the
// local voice pace is intentionally slowed at the generator.
const DEFAULT_LOCAL_SECONDS_PER_WORD = 0.3;
const DEFAULT_LOCAL_PUNCTUATION_PAUSE_SECONDS = 0.025;
const MAX_LOCAL_PUNCTUATION_PAUSE_SECONDS = 6;
const DEFAULT_MIN_WORDS = Math.ceil(FLASH_MIN_SECONDS / DEFAULT_SECONDS_PER_WORD);
const DEFAULT_MAX_WORDS = Math.floor(FLASH_MAX_SECONDS / DEFAULT_SECONDS_PER_WORD);

const LONGFORM_FORMATS = new Set([
  "daily_briefing_item",
  "weekly_roundup_item",
  "monthly_release_radar_item",
  "before_you_download_candidate",
  "trailer_breakdown_candidate",
  "longform",
  "pulse_briefing_longform",
]);
const EXTENDED_SHORT_FORMATS = new Set([
  "pulse_extended_short",
  "extended_short",
  "extended_or_briefing",
  "pulse_extended",
]);

function countSpokenWords(text) {
  if (typeof text !== "string") return 0;
  return text
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean).length;
}

function estimateSpeechSecondsFromWords(
  wordCount,
  secondsPerWord = DEFAULT_SECONDS_PER_WORD,
  punctuationPauseSeconds = 0,
) {
  const words = Number(wordCount);
  const spw = Number(secondsPerWord);
  const pause = Number(punctuationPauseSeconds);
  if (!Number.isFinite(words) || words <= 0) return null;
  if (!Number.isFinite(spw) || spw <= 0) return null;
  return Number((words * spw + (Number.isFinite(pause) ? pause : 0)).toFixed(2));
}

function estimateLocalPunctuationPauseSeconds(text, secondsPerWord = DEFAULT_SECONDS_PER_WORD) {
  const spw = Number(secondsPerWord);
  if (!Number.isFinite(spw) || spw > 0.5 || typeof text !== "string") return 0;
  const normalised = text.replace(/\.{2,}/g, ".");
  const pauseMarks = (normalised.match(/[.!?;:](?=\s|$)/g) || []).length;
  return Number(
    Math.min(
      MAX_LOCAL_PUNCTUATION_PAUSE_SECONDS,
      pauseMarks * DEFAULT_LOCAL_PUNCTUATION_PAUSE_SECONDS,
    ).toFixed(2),
  );
}

function secondsPerWordForTtsProvider(provider, env = process.env) {
  const name = String(provider || "").toLowerCase();
  const isLocal =
    name === "local" ||
    name === "voxcpm" ||
    name === "chatterbox" ||
    name.includes("local");
  const raw = isLocal
    ? env.LOCAL_TTS_SECONDS_PER_WORD || env.STUDIO_V2_LOCAL_TTS_SECONDS_PER_WORD
    : env.ELEVENLABS_SECONDS_PER_WORD;
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed >= 0.2 && parsed <= 1.2) {
    return Number(parsed.toFixed(3));
  }
  return isLocal ? DEFAULT_LOCAL_SECONDS_PER_WORD : DEFAULT_SECONDS_PER_WORD;
}

function storyFormatCandidate(story = {}) {
  return (
    story.duration_lane ||
    story.runtime_lane ||
    story.runtime_route ||
    story.format_route ||
    story.format_verdict ||
    story.suggested_format ||
    story.recommended_format ||
    story.format_lane ||
    story.lane_id ||
    null
  );
}

function isLongformFormat(format) {
  if (!format || typeof format !== "string") return false;
  return LONGFORM_FORMATS.has(format);
}

function isExtendedShortFormat(format) {
  if (!format || typeof format !== "string") return false;
  return EXTENDED_SHORT_FORMATS.has(format.trim().toLowerCase());
}

function classifyShortScriptRuntime({
  text,
  wordCount,
  story,
  format,
  minSeconds = FLASH_MIN_SECONDS,
  maxSeconds = FLASH_MAX_SECONDS,
  reviewMaxSeconds = REVIEW_MAX_SECONDS,
  secondsPerWord = DEFAULT_SECONDS_PER_WORD,
  measuredAudioSeconds,
} = {}) {
  const fmt = format || storyFormatCandidate(story);
  const extendedShort = isExtendedShortFormat(fmt);
  const firstPartyAnnouncement = classifyVerifiedFirstPartyAnnouncement(story || {});
  const words =
    Number.isFinite(Number(wordCount)) && Number(wordCount) > 0
      ? Number(wordCount)
      : countSpokenWords(text);
  const punctuationPauseSeconds = estimateLocalPunctuationPauseSeconds(text, secondsPerWord);
  const estimatedSeconds = estimateSpeechSecondsFromWords(
    words,
    secondsPerWord,
    punctuationPauseSeconds,
  );
  const effectiveMaxSeconds = extendedShort ? reviewMaxSeconds : maxSeconds;
  const minWords = Math.ceil(minSeconds / secondsPerWord);
  const maxWords = Math.floor(effectiveMaxSeconds / secondsPerWord);
  const reviewMaxWords = Math.floor(reviewMaxSeconds / secondsPerWord);
  const failures = [];
  const warnings = [];

  if (isLongformFormat(fmt)) {
    return {
      result: "route_longform",
      route: "briefing_or_longform",
      shouldGenerateShortAudio: false,
      failures: [],
      warnings: ["short_runtime_routed_to_longform"],
      wordCount: words,
      estimatedSeconds,
      punctuationPauseSeconds,
      minSeconds,
      maxSeconds: effectiveMaxSeconds,
      reviewMaxSeconds,
      minWords,
      maxWords,
      reviewMaxWords,
      format: fmt,
    };
  }

  if (!estimatedSeconds) {
    failures.push("script_runtime_unknown");
  } else if (estimatedSeconds < minSeconds) {
    warnings.push(
      `script_runtime_below_flash_target (${estimatedSeconds.toFixed(2)}s, min ${minSeconds.toFixed(2)}s)`,
    );
  } else if (estimatedSeconds > reviewMaxSeconds) {
    failures.push(
      `script_runtime_too_long (${estimatedSeconds.toFixed(2)}s, max ${effectiveMaxSeconds.toFixed(2)}s)`,
    );
  } else if (estimatedSeconds > maxSeconds && !extendedShort) {
    warnings.push(
      `script_runtime_extended_review_required (${estimatedSeconds.toFixed(2)}s, flash max ${maxSeconds.toFixed(2)}s, review max ${reviewMaxSeconds.toFixed(2)}s)`,
    );
  }

  if (firstPartyAnnouncement.qualifies) {
    const measured =
      measuredAudioSeconds === null ||
      measuredAudioSeconds === undefined ||
      measuredAudioSeconds === ""
        ? null
        : Number(measuredAudioSeconds);
    const measuredIsFinite = Number.isFinite(measured);
    if (words < BREAKING_NEWS_MIN_WORDS || words > BREAKING_NEWS_MAX_WORDS) {
      failures.push(
        `breaking_news_script_word_count_out_of_bounds (${words}, expected ${BREAKING_NEWS_MIN_WORDS}-${BREAKING_NEWS_MAX_WORDS})`,
      );
    }
    if (measuredIsFinite && measured < BREAKING_NEWS_MIN_SECONDS) {
      failures.push(
        `breaking_news_audio_duration_too_short (${measured.toFixed(2)}s, min ${BREAKING_NEWS_MIN_SECONDS.toFixed(2)}s)`,
      );
    }
    if (measuredIsFinite && measured > BREAKING_NEWS_MAX_SECONDS) {
      failures.push(
        `breaking_news_audio_duration_too_long (${measured.toFixed(2)}s, max ${BREAKING_NEWS_MAX_SECONDS.toFixed(2)}s)`,
      );
    }

    const hasFailure = failures.length > 0;
    const measurementRequired = !hasFailure && !measuredIsFinite;
    if (measurementRequired) {
      warnings.push("breaking_news_audio_duration_measurement_required");
    }
    return {
      result: hasFailure
        ? "fail"
        : measurementRequired
          ? "measurement_required"
          : "pass",
      route: hasFailure
        ? "blocked"
        : measurementRequired
          ? "breaking_news_measurement_required"
          : "breaking_news_short",
      durationLane: BREAKING_NEWS_DURATION_LANE,
      shouldGenerateShortAudio: !hasFailure,
      finalAudioAuthority: !hasFailure && measuredIsFinite,
      audioDurationVerificationRequired: !measuredIsFinite,
      measuredAudioSeconds: measuredIsFinite ? measured : null,
      failures,
      warnings,
      wordCount: words,
      estimatedSeconds,
      punctuationPauseSeconds,
      minSeconds: BREAKING_NEWS_MIN_SECONDS,
      maxSeconds: BREAKING_NEWS_MAX_SECONDS,
      reviewMaxSeconds: BREAKING_NEWS_MAX_SECONDS,
      minWords: BREAKING_NEWS_MIN_WORDS,
      maxWords: BREAKING_NEWS_MAX_WORDS,
      reviewMaxWords: BREAKING_NEWS_MAX_WORDS,
      format: fmt,
      firstPartyAnnouncement: {
        source_key: firstPartyAnnouncement.source?.key || null,
        source_host: firstPartyAnnouncement.source?.host || null,
        signals: firstPartyAnnouncement.signals,
      },
    };
  }

  let result = "pass";
  let route = extendedShort ? "extended_short" : "flash_short";
  let shouldGenerateShortAudio = true;
  if (failures.length > 0) {
    result = "fail";
    route = "blocked";
    shouldGenerateShortAudio = false;
  } else if (warnings.some((w) => w.startsWith("script_runtime_extended_review_required"))) {
    result = "review";
    route = "extended_or_briefing";
    shouldGenerateShortAudio = false;
  } else if (warnings.length > 0) {
    result = "warn";
  }

  return {
    result,
    route,
    shouldGenerateShortAudio,
    failures,
    warnings,
    wordCount: words,
    estimatedSeconds,
    punctuationPauseSeconds,
    minSeconds,
    maxSeconds: effectiveMaxSeconds,
    reviewMaxSeconds,
    minWords,
    maxWords,
    reviewMaxWords,
    format: fmt,
  };
}

module.exports = {
  classifyShortScriptRuntime,
  countSpokenWords,
  estimateSpeechSecondsFromWords,
  estimateLocalPunctuationPauseSeconds,
  secondsPerWordForTtsProvider,
  storyFormatCandidate,
  isLongformFormat,
  isExtendedShortFormat,
  FLASH_MIN_SECONDS,
  FLASH_MAX_SECONDS,
  REVIEW_MAX_SECONDS,
  DEFAULT_SECONDS_PER_WORD,
  DEFAULT_LOCAL_SECONDS_PER_WORD,
  DEFAULT_LOCAL_PUNCTUATION_PAUSE_SECONDS,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
  BREAKING_NEWS_MIN_SECONDS,
  BREAKING_NEWS_MAX_SECONDS,
  BREAKING_NEWS_MIN_WORDS,
  BREAKING_NEWS_MAX_WORDS,
};
