"use strict";

function characterAlignmentToSubtitleWords(alignment) {
  const chars = Array.isArray(alignment?.characters) ? alignment.characters : [];
  const starts = Array.isArray(alignment?.character_start_times_seconds)
    ? alignment.character_start_times_seconds
    : Array.isArray(alignment?.characterStartTimesSeconds)
      ? alignment.characterStartTimesSeconds
      : [];
  const ends = Array.isArray(alignment?.character_end_times_seconds)
    ? alignment.character_end_times_seconds
    : Array.isArray(alignment?.characterEndTimesSeconds)
      ? alignment.characterEndTimesSeconds
      : [];

  if (!chars.length || starts.length < chars.length || ends.length < chars.length) {
    return [];
  }

  const words = [];
  let wordStart = null;
  let wordEnd = null;
  let wordChars = "";

  for (let i = 0; i < chars.length; i++) {
    if (/\s/.test(chars[i])) {
      if (wordChars.length > 0) {
        words.push({ text: wordChars, start: wordStart, end: wordEnd });
        wordChars = "";
        wordStart = null;
        wordEnd = null;
      }
      continue;
    }

    const start = Number(starts[i]);
    const end = Number(ends[i]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }
    if (wordStart === null) wordStart = start;
    wordEnd = end;
    wordChars += chars[i];
  }

  if (wordChars.length > 0) {
    words.push({ text: wordChars, start: wordStart, end: wordEnd });
  }

  return words;
}

function inspectSubtitleTimingWords(words, duration, options = {}) {
  const safeWords = Array.isArray(words) ? words : [];
  const durationS = Number(duration);
  const wordCount = safeWords.length;
  const maxGapLimitSeconds = options.maxGapLimitSeconds ?? 3.0;
  const maxZeroDurationWordRatio = options.maxZeroDurationWordRatio ?? 0.18;
  const maxNonMonotonicWords = options.maxNonMonotonicWords ?? 0;
  const maxTrailingGapSeconds = Number(options.maxTrailingGapSeconds);

  if (!Number.isFinite(durationS) || durationS <= 0) {
    return {
      usable: false,
      reason: "invalid_duration",
      wordCount,
      maxGapSeconds: 0,
      zeroDurationWordRatio: 0,
      nonMonotonicCount: 0,
    };
  }

  if (wordCount < 3) {
    return {
      usable: false,
      reason: "too_few_words",
      wordCount,
      maxGapSeconds: 0,
      zeroDurationWordRatio: 0,
      nonMonotonicCount: 0,
    };
  }

  let previousEnd = 0;
  let previousStart = -Infinity;
  let maxGapSeconds = 0;
  let zeroDurationCount = 0;
  let nonMonotonicCount = 0;
  let invalidWordCount = 0;
  let firstStart = null;
  let lastEnd = 0;
  let maxEnd = 0;

  for (const word of safeWords) {
    const start = Number(word.start);
    const end = Number(word.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      invalidWordCount++;
      continue;
    }
    if (firstStart === null) firstStart = start;
    if (start < previousStart - 0.025 || end < start - 0.025) {
      nonMonotonicCount++;
    }
    if (start > previousEnd) {
      maxGapSeconds = Math.max(maxGapSeconds, start - previousEnd);
    }
    if (end - start <= 0.03) {
      zeroDurationCount++;
    }
    previousStart = Math.max(previousStart, start);
    previousEnd = Math.max(previousEnd, end);
    lastEnd = end;
    maxEnd = Math.max(maxEnd, end);
  }

  const zeroDurationWordRatio = wordCount ? zeroDurationCount / wordCount : 0;
  const coverageRatio = maxEnd / durationS;
  const trailingGapSeconds = Math.max(0, durationS - maxEnd);
  let reason = "usable";

  if (invalidWordCount > 0) {
    reason = "invalid_word_timing";
  } else if ((firstStart ?? 0) > 2.5) {
    reason = "first_caption_too_late";
  } else if (maxGapSeconds > maxGapLimitSeconds) {
    reason = "max_gap_too_large";
  } else if (nonMonotonicCount > maxNonMonotonicWords) {
    reason = "non_monotonic_timing";
  } else if (zeroDurationWordRatio > maxZeroDurationWordRatio) {
    reason = "zero_duration_words";
  } else if (coverageRatio < 0.75) {
    reason = "timeline_ends_too_early";
  } else if (
    Number.isFinite(maxTrailingGapSeconds) &&
    maxTrailingGapSeconds >= 0 &&
    trailingGapSeconds > maxTrailingGapSeconds
  ) {
    reason = "trailing_caption_gap_too_large";
  } else if (maxEnd > durationS + 0.75) {
    reason = "timeline_runs_past_audio";
  } else if (lastEnd < durationS * 0.7) {
    reason = "last_word_ends_too_early";
  }

  return {
    usable: reason === "usable",
    reason,
    wordCount,
    maxGapSeconds: Number(maxGapSeconds.toFixed(3)),
    zeroDurationWordRatio: Number(zeroDurationWordRatio.toFixed(3)),
    nonMonotonicCount,
    invalidWordCount,
    firstStart: firstStart === null ? null : Number(firstStart.toFixed(3)),
    lastEnd: Number(lastEnd.toFixed(3)),
    maxEnd: Number(maxEnd.toFixed(3)),
    coverageRatio: Number(coverageRatio.toFixed(3)),
    trailingGapSeconds: Number(trailingGapSeconds.toFixed(3)),
  };
}

function selectSubtitleScriptText(story, wordTimestamps) {
  const transcriptFromChars = Array.isArray(wordTimestamps?.characters)
    ? wordTimestamps.characters.join("")
    : null;
  const metaText = String(wordTimestamps?.meta?.text || "").trim();
  const metaTranscript = String(wordTimestamps?.meta?.transcript || "").trim();
  const bestMetaTranscript =
    metaTranscript && (!metaText || metaTranscript.length >= metaText.length * 0.65)
      ? metaTranscript
      : null;
  const candidates = [
    metaText,
    bestMetaTranscript,
    wordTimestamps?.transcript,
    wordTimestamps?.text,
    transcriptFromChars,
    story?.tts_script,
    story?.full_script,
    story?.hook,
  ];

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (text) return text;
  }
  return "";
}

function buildSyntheticCharacterAlignment(text, duration) {
  const cleanText = String(text || "").replace(/\s+/g, " ").trim();
  const durationS = Number(duration);
  if (!cleanText || !Number.isFinite(durationS) || durationS <= 0) {
    return {
      characters: [],
      character_start_times_seconds: [],
      character_end_times_seconds: [],
    };
  }

  const characters = Array.from(cleanText);
  const spokenChars = characters.filter((ch) => !/\s/.test(ch)).length || 1;
  const secondsPerCharacter = durationS / spokenChars;
  const starts = [];
  const ends = [];
  let cursor = 0;

  for (const ch of characters) {
    const start = cursor;
    if (!/\s/.test(ch)) {
      cursor = Math.min(durationS, cursor + secondsPerCharacter);
    }
    starts.push(Number(start.toFixed(3)));
    ends.push(Number(cursor.toFixed(3)));
  }

  const lastSpokenIndex = characters.map((ch, idx) => (/\s/.test(ch) ? -1 : idx)).filter((idx) => idx >= 0).at(-1);
  if (lastSpokenIndex !== undefined) {
    ends[lastSpokenIndex] = Number(durationS.toFixed(3));
  }

  return {
    characters,
    character_start_times_seconds: starts,
    character_end_times_seconds: ends,
  };
}

function cleanWordText(value) {
  return String(value || "").trim();
}

function tokeniseSubtitleText(text) {
  return String(text || "")
    .replace(/\[(?:pause|beat|breath)\]/gi, " ")
    .match(/\S+/g) || [];
}

function splitTextIntoTimingSegments(text) {
  const tokens = tokeniseSubtitleText(text);
  const segments = [];
  let buffer = [];
  for (const token of tokens) {
    buffer.push(token);
    if (/[.!?:]$/.test(token)) {
      segments.push(buffer);
      buffer = [];
    }
  }
  if (buffer.length) segments.push(buffer);
  return segments;
}

function normaliseSilences(silences = [], duration) {
  const durationS = Number(duration);
  return (Array.isArray(silences) ? silences : [])
    .map((silence) => {
      const start = Math.max(0, Number(silence.start));
      const end = Math.max(start, Number(silence.end));
      return {
        start,
        end: Number.isFinite(durationS) && durationS > 0 ? Math.min(durationS, end) : end,
        duration: Number.isFinite(Number(silence.duration))
          ? Number(silence.duration)
          : Math.max(0, end - start),
      };
    })
    .filter((silence) =>
      Number.isFinite(silence.start) &&
      Number.isFinite(silence.end) &&
      silence.end >= silence.start,
    )
    .sort((a, b) => a.start - b.start);
}

function speechIntervalsFromSilences(silences = [], duration, options = {}) {
  const durationS = Number(duration);
  if (!Number.isFinite(durationS) || durationS <= 0) return [];
  const minPauseS = Number.isFinite(Number(options.minPauseS))
    ? Number(options.minPauseS)
    : 0.22;
  const minBoundarySilenceS = Number.isFinite(Number(options.minBoundarySilenceS))
    ? Number(options.minBoundarySilenceS)
    : 0.05;
  const minSpeechS = Number.isFinite(Number(options.minSpeechS))
    ? Number(options.minSpeechS)
    : 0.12;
  const longSilences = normaliseSilences(silences, durationS)
    .filter((silence) => {
      if (silence.duration >= minPauseS) return true;
      if (silence.duration < minBoundarySilenceS) return false;
      const startsAtBoundary = silence.start <= minBoundarySilenceS;
      const endsAtBoundary = silence.end >= durationS - minBoundarySilenceS;
      return startsAtBoundary || endsAtBoundary;
    });
  let cursor = 0;
  const intervals = [];
  for (const silence of longSilences) {
    if (silence.start > cursor + minSpeechS) {
      intervals.push({ start: cursor, end: silence.start });
    }
    cursor = Math.max(cursor, silence.end);
  }
  if (durationS > cursor + minSpeechS) {
    intervals.push({ start: cursor, end: durationS });
  }
  return intervals.filter((interval) => interval.end > interval.start);
}

function distributeWordsAcrossInterval(segmentWords = [], interval = {}) {
  const words = segmentWords.filter((word) => cleanWordText(word.word));
  const start = Number(interval.start);
  const end = Number(interval.end);
  if (!words.length || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const duration = end - start;
  const gap = words.length > 1
    ? Math.min(0.035, Math.max(0.008, duration * 0.025 / Math.max(1, words.length - 1)))
    : 0;
  const totalGap = gap * Math.max(0, words.length - 1);
  const spokenDuration = Math.max(0.08 * words.length, duration - totalGap);
  const weights = words.map((word) => {
    const letters = cleanWordText(word.word).replace(/[^\p{L}\p{N}]/gu, "").length;
    return Math.max(1.4, Math.min(12, letters || 1));
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || words.length;
  let cursor = start;
  return words.map((word, index) => {
    const wordDuration = Math.max(
      0.08,
      spokenDuration * (weights[index] / totalWeight),
    );
    const wordStart = cursor;
    const wordEnd = index === words.length - 1 ? end : Math.min(end, wordStart + wordDuration);
    cursor = wordEnd + gap;
    return {
      ...word,
      start: Number(wordStart.toFixed(3)),
      end: Number(Math.max(wordEnd, wordStart + 0.05).toFixed(3)),
    };
  });
}

function anchorSubtitleWordsToAudioSilences({
  text,
  words,
  duration,
  silences,
  minPauseS = 0.22,
} = {}) {
  const cleanWords = (Array.isArray(words) ? words : [])
    .map((word) => ({
      ...word,
      word: cleanWordText(word.word || word.text),
      start: Number(word.start),
      end: Number(word.end),
    }))
    .filter((word) => word.word);
  const segments = splitTextIntoTimingSegments(text);
  const intervals = speechIntervalsFromSilences(silences, duration, { minPauseS });
  const durationS = Number(duration);
  const usableAnchorSilenceCount = normaliseSilences(silences, durationS)
    .filter((silence) => {
      if (silence.duration >= minPauseS) return true;
      if (silence.duration < 0.05) return false;
      return silence.start <= 0.05 || silence.end >= durationS - 0.05;
    }).length;
  const totalSegmentWords = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (
    !cleanWords.length ||
    !segments.length ||
    usableAnchorSilenceCount < 1 ||
    intervals.length < segments.length ||
    Math.abs(totalSegmentWords - cleanWords.length) > Math.max(2, cleanWords.length * 0.08)
  ) {
    return {
      repaired: false,
      strategy: null,
      words: cleanWords,
      segment_count: segments.length,
      speech_interval_count: intervals.length,
    };
  }

  const anchored = [];
  let wordIndex = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segmentWords = cleanWords.slice(wordIndex, wordIndex + segments[index].length);
    anchored.push(...distributeWordsAcrossInterval(segmentWords, intervals[index]));
    wordIndex += segments[index].length;
  }
  if (wordIndex < cleanWords.length) {
    const tail = cleanWords.slice(wordIndex);
    const lastEnd = anchored.at(-1)?.end || cleanWords[wordIndex]?.start || 0;
    const tailInterval = {
      start: lastEnd,
      end: Number(duration) || cleanWords.at(-1)?.end || lastEnd + 1,
    };
    anchored.push(...distributeWordsAcrossInterval(tail, tailInterval));
  }

  return {
    repaired: anchored.length === cleanWords.length,
    strategy: anchored.length === cleanWords.length ? "audio_silence_sentence_anchored" : null,
    words: anchored.length === cleanWords.length ? anchored : cleanWords,
    segment_count: segments.length,
    speech_interval_count: intervals.length,
  };
}

function repairTimestampAlignment({ alignment, text, duration } = {}) {
  const words = characterAlignmentToSubtitleWords(alignment);
  const inspection = inspectSubtitleTimingWords(words, duration, {
    maxTrailingGapSeconds: 2,
  });
  if (inspection.usable) {
    return {
      alignment,
      repaired: false,
      repairReason: null,
      repairStrategy: null,
      inspection,
      originalInspection: inspection,
    };
  }

  const synthetic = buildSyntheticCharacterAlignment(text, duration);
  const repairedWords = characterAlignmentToSubtitleWords(synthetic);
  const repairedInspection = inspectSubtitleTimingWords(repairedWords, duration, {
    maxTrailingGapSeconds: 2,
  });
  return {
    alignment: synthetic,
    repaired: true,
    repairReason: inspection.reason,
    repairStrategy: "synthetic_full_duration",
    inspection: repairedInspection,
    originalInspection: inspection,
  };
}

module.exports = {
  anchorSubtitleWordsToAudioSilences,
  buildSyntheticCharacterAlignment,
  characterAlignmentToSubtitleWords,
  inspectSubtitleTimingWords,
  repairTimestampAlignment,
  selectSubtitleScriptText,
  speechIntervalsFromSilences,
};
