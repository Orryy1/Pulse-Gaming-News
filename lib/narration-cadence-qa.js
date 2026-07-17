"use strict";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

const MIN_PUBLISHABLE_WPM = 110;
const MIN_TARGET_WPM = 130;
const MAX_TARGET_WPM = 162;
const MAX_PUBLISHABLE_WPM = 175;
const MAX_ACOUSTIC_WORD_GAP_S = 0.9;
const MAX_PULSE_GAMING_CTA_GAP_S = 0.3;
const MIN_REPETITIVE_LONG_PAUSE_S = 0.45;
const MAX_REPETITIVE_LONG_PAUSE_COUNT = 4;
const MIN_MEANINGFUL_ACOUSTIC_SILENCE_S = 0.45;
const MIN_TIMESTAMP_MASKED_OVERLAP_S = 0.35;
const MIN_TIMESTAMP_MASKED_SILENCE_RATIO = 0.75;

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

function parseSilencedetectOutput(output = "") {
  const intervals = [];
  let pendingStart = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/);
    if (startMatch) {
      pendingStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*(-?(?:\d+(?:\.\d*)?|\.\d+))/);
    if (endMatch && Number.isFinite(pendingStart)) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(end) && end > pendingStart) {
        intervals.push({ start: pendingStart, end });
      }
      pendingStart = null;
    }
  }
  return intervals;
}

async function probeAudioSilences(
  audioPath = "",
  {
    ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
    noise = "-38dB",
    minDurationSeconds = MIN_MEANINGFUL_ACOUSTIC_SILENCE_S,
  } = {},
) {
  if (!clean(audioPath)) return [];
  const { stdout, stderr } = await execFileAsync(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostdin",
      "-i",
      audioPath,
      "-af",
      `silencedetect=noise=${noise}:d=${Number(minDurationSeconds).toFixed(3)}`,
      "-f",
      "null",
      "-",
    ],
    { timeout: 120000, maxBuffer: 1024 * 1024 * 4 },
  );
  return parseSilencedetectOutput(`${stdout || ""}\n${stderr || ""}`);
}

function normaliseSilenceProbeResult(result) {
  const rows = Array.isArray(result)
    ? result
    : Array.isArray(result?.silences)
      ? result.silences
      : Array.isArray(result?.intervals)
        ? result.intervals
        : null;
  if (!rows) {
    const error = new Error("acoustic_silence_probe_invalid_result");
    error.code = "acoustic_silence_probe_invalid_result";
    throw error;
  }
  const intervals = rows.map((interval) => ({
    start: Number(
      interval?.start ?? interval?.start_s ?? interval?.start_seconds ?? interval?.silence_start,
    ),
    end: Number(
      interval?.end ?? interval?.end_s ?? interval?.end_seconds ?? interval?.silence_end,
    ),
  }));
  if (intervals.some((interval) =>
    !Number.isFinite(interval.start) || !Number.isFinite(interval.end) || interval.end <= interval.start
  )) {
    const error = new Error("acoustic_silence_probe_invalid_interval");
    error.code = "acoustic_silence_probe_invalid_interval";
    throw error;
  }
  return intervals;
}

function acousticSilenceProfile(intervals = [], timestampPayload = {}) {
  const words = timestampWords(timestampPayload);
  const meaningful = intervals.filter(
    (interval) => interval.end - interval.start >= MIN_MEANINGFUL_ACOUSTIC_SILENCE_S,
  );
  const timestampMaskedSilences = [];

  for (const silence of meaningful) {
    const silenceDuration = silence.end - silence.start;
    let strongestOverlap = null;
    for (const word of words) {
      const overlap = Math.max(
        0,
        Math.min(silence.end, word.end) - Math.max(silence.start, word.start),
      );
      if (!strongestOverlap || overlap > strongestOverlap.overlap) {
        strongestOverlap = { word, overlap };
      }
    }
    const silenceOverlapRatio = strongestOverlap
      ? strongestOverlap.overlap / silenceDuration
      : 0;
    if (
      strongestOverlap &&
      strongestOverlap.overlap >= MIN_TIMESTAMP_MASKED_OVERLAP_S &&
      silenceOverlapRatio >= MIN_TIMESTAMP_MASKED_SILENCE_RATIO
    ) {
      timestampMaskedSilences.push({
        word: strongestOverlap.word.word,
        word_start_seconds: round(strongestOverlap.word.start, 3),
        word_end_seconds: round(strongestOverlap.word.end, 3),
        silence_start_seconds: round(silence.start, 3),
        silence_end_seconds: round(silence.end, 3),
        silence_duration_seconds: round(silenceDuration, 3),
        overlap_seconds: round(strongestOverlap.overlap, 3),
        silence_overlap_ratio: round(silenceOverlapRatio, 3),
      });
    }
  }

  const durations = intervals.map((interval) => interval.end - interval.start);
  return {
    probe_status: "ok",
    probe_error_code: null,
    detected_silence_count: intervals.length,
    meaningful_silence_count: meaningful.length,
    timestamp_masked_silence_count: timestampMaskedSilences.length,
    longest_silence_seconds: durations.length ? round(Math.max(...durations), 3) : null,
    longest_timestamp_masked_silence_seconds: timestampMaskedSilences.length
      ? round(Math.max(...timestampMaskedSilences.map((silence) => silence.silence_duration_seconds)), 3)
      : null,
    timestamp_masked_silences: timestampMaskedSilences,
  };
}

function emptyAcousticSilenceProfile(probeStatus = "not_requested", probeErrorCode = null) {
  return {
    probe_status: probeStatus,
    probe_error_code: probeErrorCode,
    detected_silence_count: 0,
    meaningful_silence_count: 0,
    timestamp_masked_silence_count: 0,
    longest_silence_seconds: null,
    longest_timestamp_masked_silence_seconds: null,
    timestamp_masked_silences: [],
  };
}

function pauseProfileFromTimestamps(timestampPayload = {}) {
  const words = timestampWords(timestampPayload);
  if (words.length < 2) {
    return {
      word_timestamp_count: words.length,
      long_pause_count: 0,
      longest_pause_seconds: null,
      median_gap_seconds: null,
      cta_pulse_gaming_gap_seconds: null,
      dominant_long_pause_seconds: null,
      dominant_long_pause_count: 0,
    };
  }
  const gaps = [];
  let ctaPulseGamingGap = null;
  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i].start - words[i - 1].end;
    if (Number.isFinite(gap) && gap >= 0) {
      gaps.push(gap);
      const previous = words[i - 1].word.toLowerCase().replace(/[^a-z0-9]/g, "");
      const current = words[i].word.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (previous === "pulse" && current === "gaming") {
        ctaPulseGamingGap = Math.max(ctaPulseGamingGap || 0, gap);
      }
    }
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const longPauseBuckets = new Map();
  for (const gap of gaps.filter((value) => value >= MIN_REPETITIVE_LONG_PAUSE_S)) {
    const bucket = Math.round(gap / 0.05) * 0.05;
    longPauseBuckets.set(bucket, (longPauseBuckets.get(bucket) || 0) + 1);
  }
  const dominantLongPause = [...longPauseBuckets.entries()]
    .sort((left, right) => right[1] - left[1] || right[0] - left[0])[0] || null;
  return {
    word_timestamp_count: words.length,
    long_pause_count: gaps.filter((gap) => gap >= 0.45).length,
    longest_pause_seconds: sorted.length ? round(sorted[sorted.length - 1], 2) : null,
    median_gap_seconds: median === null ? null : round(median, 2),
    cta_pulse_gaming_gap_seconds:
      ctaPulseGamingGap === null ? null : round(ctaPulseGamingGap, 2),
    dominant_long_pause_seconds:
      dominantLongPause === null ? null : round(dominantLongPause[0], 2),
    dominant_long_pause_count:
      dominantLongPause === null ? 0 : dominantLongPause[1],
  };
}

async function analyseNarrationCadence({
  audioManifest = {},
  narrationManifest = {},
  timestampPayload = {},
  transcript = "",
  audioPath = "",
  durationProbe = probeAudioDurationSeconds,
  silenceProbe = probeAudioSilences,
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

  let acousticProfile = emptyAcousticSilenceProfile();
  if (clean(audioPath)) {
    try {
      const intervals = normaliseSilenceProbeResult(await silenceProbe(audioPath));
      acousticProfile = acousticSilenceProfile(intervals, timestampPayload);
      if (acousticProfile.timestamp_masked_silence_count > 0) {
        blockers.push("voice_cadence:timestamp_masks_acoustic_silence");
      }
    } catch (error) {
      acousticProfile = emptyAcousticSilenceProfile(
        "failed",
        clean(error?.code) || "acoustic_silence_probe_failed",
      );
      warnings.push("voice_cadence:acoustic_silence_probe_failed");
    }
  }

  const pauseProfile = pauseProfileFromTimestamps(timestampPayload);
  const timestampCoverageVerified = Boolean(
    wordCount &&
    pauseProfile.word_timestamp_count >= 6 &&
    pauseProfile.word_timestamp_count >= Math.ceil(wordCount * 0.8),
  );
  if (
    timestampCoverageVerified &&
    pauseProfile.longest_pause_seconds !== null &&
    pauseProfile.longest_pause_seconds > MAX_ACOUSTIC_WORD_GAP_S
  ) {
    blockers.push("voice_cadence:acoustic_pause_too_long");
  }
  if (
    timestampCoverageVerified &&
    pauseProfile.cta_pulse_gaming_gap_seconds !== null &&
    pauseProfile.cta_pulse_gaming_gap_seconds > MAX_PULSE_GAMING_CTA_GAP_S
  ) {
    blockers.push("voice_cadence:pulse_gaming_cta_gap");
  }
  if (
    timestampCoverageVerified &&
    pauseProfile.dominant_long_pause_count > MAX_REPETITIVE_LONG_PAUSE_COUNT
  ) {
    blockers.push("voice_cadence:repetitive_long_pauses");
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
    pause_profile: {
      ...pauseProfile,
      timestamp_coverage_verified: timestampCoverageVerified,
    },
    acoustic_silence_profile: acousticProfile,
    thresholds: {
      min_target_wpm: MIN_TARGET_WPM,
      max_target_wpm: MAX_TARGET_WPM,
      min_publishable_wpm: MIN_PUBLISHABLE_WPM,
      max_publishable_wpm: MAX_PUBLISHABLE_WPM,
      max_acoustic_word_gap_s: MAX_ACOUSTIC_WORD_GAP_S,
      max_pulse_gaming_cta_gap_s: MAX_PULSE_GAMING_CTA_GAP_S,
      min_repetitive_long_pause_s: MIN_REPETITIVE_LONG_PAUSE_S,
      max_repetitive_long_pause_count: MAX_REPETITIVE_LONG_PAUSE_COUNT,
      min_meaningful_acoustic_silence_s: MIN_MEANINGFUL_ACOUSTIC_SILENCE_S,
      min_timestamp_masked_overlap_s: MIN_TIMESTAMP_MASKED_OVERLAP_S,
      min_timestamp_masked_silence_ratio: MIN_TIMESTAMP_MASKED_SILENCE_RATIO,
    },
    blockers,
    warnings,
  };
}

module.exports = {
  analyseNarrationCadence,
  durationFromManifests,
  probeAudioDurationSeconds,
  probeAudioSilences,
};
