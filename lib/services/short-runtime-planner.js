"use strict";

const FLASH_MIN_SECONDS = 61;
const FLASH_MAX_SECONDS = 75;
const REVIEW_MAX_SECONDS = 90;

// Calibrated from live Pulse Gaming ElevenLabs output on 2026-05-02:
// 159-178 spoken words produced 109-123s audio. That is roughly
// 0.68s per cleaned TTS word, including punctuation pauses.
const DEFAULT_SECONDS_PER_WORD = 0.68;
// Calibrated from the accepted Sleepy Liam local TTS reference on
// 2026-05-05. Real local proof audio landed around 0.31-0.33s per cleaned
// spoken word, so the pre-TTS planner budgets conservatively and still
// requires post-generation duration QA before render.
const DEFAULT_LOCAL_SECONDS_PER_WORD = 0.33;
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
) {
  const words = Number(wordCount);
  const spw = Number(secondsPerWord);
  if (!Number.isFinite(words) || words <= 0) return null;
  if (!Number.isFinite(spw) || spw <= 0) return null;
  return Number((words * spw).toFixed(2));
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

function classifyShortScriptRuntime({
  text,
  wordCount,
  story,
  format,
  minSeconds = FLASH_MIN_SECONDS,
  maxSeconds = FLASH_MAX_SECONDS,
  reviewMaxSeconds = REVIEW_MAX_SECONDS,
  secondsPerWord = DEFAULT_SECONDS_PER_WORD,
} = {}) {
  const fmt = format || storyFormatCandidate(story);
  const words =
    Number.isFinite(Number(wordCount)) && Number(wordCount) > 0
      ? Number(wordCount)
      : countSpokenWords(text);
  const estimatedSeconds = estimateSpeechSecondsFromWords(
    words,
    secondsPerWord,
  );
  const minWords = Math.ceil(minSeconds / secondsPerWord);
  const maxWords = Math.floor(maxSeconds / secondsPerWord);
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
      minSeconds,
      maxSeconds,
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
      `script_runtime_too_long (${estimatedSeconds.toFixed(2)}s, max ${maxSeconds.toFixed(2)}s)`,
    );
  } else if (estimatedSeconds > maxSeconds) {
    warnings.push(
      `script_runtime_review_required (${estimatedSeconds.toFixed(2)}s, max ${maxSeconds.toFixed(2)}s)`,
    );
  }

  let result = "pass";
  let route = "flash_short";
  let shouldGenerateShortAudio = true;
  if (failures.length > 0) {
    result = "fail";
    route = "blocked";
    shouldGenerateShortAudio = false;
  } else if (warnings.some((w) => w.startsWith("script_runtime_review_required"))) {
    result = "review";
    route = "review_or_briefing";
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
    minSeconds,
    maxSeconds,
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
  secondsPerWordForTtsProvider,
  storyFormatCandidate,
  isLongformFormat,
  FLASH_MIN_SECONDS,
  FLASH_MAX_SECONDS,
  REVIEW_MAX_SECONDS,
  DEFAULT_SECONDS_PER_WORD,
  DEFAULT_LOCAL_SECONDS_PER_WORD,
  DEFAULT_MIN_WORDS,
  DEFAULT_MAX_WORDS,
};
