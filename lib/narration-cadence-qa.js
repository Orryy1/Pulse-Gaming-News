"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const MIN_PUBLISHABLE_WPM = 110;
const MIN_TARGET_WPM = 130;
const MAX_TARGET_WPM = 162;
const MAX_PUBLISHABLE_WPM = 175;

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function round(value, digits = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function firstPositive(values = []) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function wordsFromText(text = "") {
  return clean(text).match(/[A-Za-z0-9]+(?:['\u2019][A-Za-z0-9]+)?/g) || [];
}

function sentenceWordCounts(transcript = "") {
  return clean(transcript)
    .split(/[.!?]+/)
    .map((sentence) => wordsFromText(sentence).length)
    .filter((count) => count > 0);
}

function timestampWords(timestampPayload = {}) {
  const words = asArray(timestampPayload.words || timestampPayload.word_timestamps);
  return words
    .map((word) => ({
      word: clean(word.word || word.text),
      start: Number(word.start ?? word.start_s ?? word.startS),
      end: Number(word.end ?? word.end_s ?? word.endS),
    }))
    .filter((word) => word.word && Number.isFinite(word.start) && Number.isFinite(word.end) && word.end >= word.start);
}

function durationFromTimestampPayload(timestampPayload = {}) {
  const words = timestampWords(timestampPayload);
  const declaredDuration = firstPositive([
    timestampPayload.duration_seconds,
    timestampPayload.durationSeconds,
    timestampPayload.duration_s,
    timestampPayload.durationS,
    timestampPayload.meta?.duration_seconds,
    timestampPayload.meta?.durationSeconds,
    timestampPayload.meta?.duration_s,
    timestampPayload.meta?.durationS,
    timestampPayload.meta?.acoustic?.durationSeconds,
    timestampPayload.meta?.acoustic?.duration_seconds,
  ]);
  const timelineDuration = words.length ? Math.max(...words.map((word) => word.end)) : null;
  if (declaredDuration !== null && timelineDuration !== null) {
    return Math.max(declaredDuration, timelineDuration);
  }
  return declaredDuration || timelineDuration;
}

function durationFromManifests(audioManifest = {}, narrationManifest = {}, timestampPayload = {}) {
  return firstPositive([
    audioManifest.audio_duration_seconds,
    audioManifest.duration_seconds,
    audioManifest.durationSeconds,
    audioManifest.duration_s,
    audioManifest.durationS,
    audioManifest.narration_audio_duration_seconds,
    audioManifest.timestamp_whisper_alignment?.duration_seconds,
    audioManifest.timestamp_whisper_alignment?.durationSeconds,
    audioManifest.timestamp_whisper_alignment?.meta?.duration_seconds,
    audioManifest.timestamp_whisper_alignment?.meta?.durationSeconds,
    narrationManifest.audio_duration_seconds,
    narrationManifest.duration_seconds,
    narrationManifest.durationSeconds,
    narrationManifest.duration_s,
    narrationManifest.durationS,
  ]);
}

async function probeAudioDurationSeconds(audioPath = "", { ffprobePath = process.env.FFPROBE_PATH || "ffprobe" } = {}) {
  if (!clean(audioPath)) return null;
  try {
    const { stdout } = await execFileAsync(
      ffprobePath,
      ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", audioPath],
      { timeout: 10000 },
    );
    return numberOrNull(stdout.trim());
  } catch {
    return null;
  }
}

function pauseProfileFromTimestamps(timestampPayload = {}) {
  const words = timestampWords(timestampPayload);
  if (words.length < 2) {
    return {
      word_timestamp_count: words.length,
      long_pause_count: 0,
      longest_pause_seconds: null,
      median_gap_seconds: null,
    };
  }
  const gaps = [];
  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i].start - words[i - 1].end;
    if (Number.isFinite(gap) && gap >= 0) gaps.push(gap);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  return {
    word_timestamp_count: words.length,
    long_pause_count: gaps.filter((gap) => gap >= 0.45).length,
    longest_pause_seconds: sorted.length ? round(sorted[sorted.length - 1], 2) : null,
    median_gap_seconds: median === null ? null : round(median, 2),
  };
}

async function analyseNarrationCadence({
  audioManifest = {},
  narrationManifest = {},
  timestampPayload = {},
  transcript = "",
  audioPath = "",
  durationProbe = probeAudioDurationSeconds,
  generatedAt = new Date().toISOString(),
} = {}) {
  const manifestDuration = durationFromManifests(audioManifest, narrationManifest, timestampPayload);
  const timestampDuration = durationFromTimestampPayload(timestampPayload);
  const probedDuration = manifestDuration === null
    ? await durationProbe(audioPath)
    : null;
  const durationSeconds = manifestDuration || probedDuration || timestampDuration;
  const transcriptWordCount = wordsFromText(transcript).length;
  const wordCount = firstPositive([
    audioManifest.word_timestamp_count,
    narrationManifest.word_timestamp_count,
    timestampWords(timestampPayload).length,
    transcriptWordCount,
  ]);
  const sentenceCounts = sentenceWordCounts(transcript);
  const spokenWpm = wordCount && durationSeconds
    ? round((wordCount / durationSeconds) * 60, 1)
    : null;
  const blockers = [];
  const warnings = [];

  if (spokenWpm === null) {
    warnings.push("voice_cadence:duration_or_word_count_unverified");
  } else if (spokenWpm < MIN_PUBLISHABLE_WPM) {
    blockers.push("voice_cadence:wpm_too_slow");
  } else if (spokenWpm > MAX_PUBLISHABLE_WPM) {
    blockers.push("voice_cadence:wpm_too_fast");
  } else if (spokenWpm < MIN_TARGET_WPM || spokenWpm > MAX_TARGET_WPM) {
    warnings.push("voice_cadence:wpm_outside_target_range");
  }

  const averageSentenceWords = sentenceCounts.length
    ? round(sentenceCounts.reduce((sum, count) => sum + count, 0) / sentenceCounts.length, 1)
    : null;
  const maxSentenceWords = sentenceCounts.length ? Math.max(...sentenceCounts) : null;
  if (averageSentenceWords !== null && averageSentenceWords > 18 && spokenWpm !== null && spokenWpm > MAX_TARGET_WPM) {
    warnings.push("voice_cadence:dense_sentences_at_fast_pace");
  }
  if (maxSentenceWords !== null && maxSentenceWords > 28) {
    warnings.push("voice_cadence:long_sentence_may_sound_breathless");
  }

  return {
    generated_at: generatedAt,
    status: blockers.length ? "fail" : warnings.length ? "warn" : "pass",
    spoken_wpm: spokenWpm,
    duration_seconds: durationSeconds === null ? null : round(durationSeconds, 3),
    duration_source: manifestDuration !== null
      ? "manifest"
      : probedDuration !== null
        ? "ffprobe"
        : timestampDuration !== null
          ? "timestamps"
          : "missing",
    word_count: wordCount,
    transcript_word_count: transcriptWordCount || null,
    sentence_count: sentenceCounts.length,
    average_sentence_words: averageSentenceWords,
    max_sentence_words: maxSentenceWords,
    pause_profile: pauseProfileFromTimestamps(timestampPayload),
    thresholds: {
      min_target_wpm: MIN_TARGET_WPM,
      max_target_wpm: MAX_TARGET_WPM,
      min_publishable_wpm: MIN_PUBLISHABLE_WPM,
      max_publishable_wpm: MAX_PUBLISHABLE_WPM,
    },
    blockers,
    warnings,
  };
}

module.exports = {
  analyseNarrationCadence,
  durationFromManifests,
  probeAudioDurationSeconds,
};
