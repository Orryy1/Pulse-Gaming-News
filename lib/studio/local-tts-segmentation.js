"use strict";

const DEFAULT_MAX_WORDS = 32;
const DEFAULT_MAX_CHARS = 260;

const TITLE_CONNECTORS = new Set([
  "a",
  "and",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "versus",
  "with",
]);

function boundedPositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}

function cleanWord(word) {
  return String(word || "").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
}

function normaliseWord(word) {
  return cleanWord(word).toLowerCase();
}

function isTitleWord(word) {
  const clean = cleanWord(word);
  if (!clean) return false;
  if (/^\d/.test(clean)) return true;
  if (/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)$/i.test(clean)) return true;
  if (/^[A-Z0-9]{2,}$/.test(clean)) return true;
  return /^[A-Z][A-Za-z0-9]*(?:[-'][A-Z0-9][A-Za-z0-9]*)*$/.test(clean);
}

function protectedTitleSpans(words) {
  const spans = [];
  for (let start = 0; start < words.length; start += 1) {
    if (!isTitleWord(words[start])) continue;
    let end = start + 1;
    let titleWords = 1;
    while (end < words.length) {
      if (isTitleWord(words[end])) {
        titleWords += 1;
        end += 1;
        continue;
      }
      if (
        TITLE_CONNECTORS.has(normaliseWord(words[end])) &&
        end + 1 < words.length &&
        isTitleWord(words[end + 1])
      ) {
        end += 1;
        continue;
      }
      break;
    }
    if (titleWords >= 2) spans.push({ start, end });
    start = Math.max(start, end - 1);
  }
  return spans;
}

function moveBoundaryOutsideProtectedSpan(boundary, start, spans, maxWords) {
  const crossing = spans.find(
    (span) => span.start < boundary && boundary < span.end && span.end > start,
  );
  if (!crossing) return boundary;
  if (crossing.start > start) return crossing.start;
  if (crossing.end - start <= maxWords) return crossing.end;
  return boundary;
}

function splitSentenceLikeText(text) {
  const input = String(text || "").replace(/\s+/g, " ").trim();
  if (!input) return [];
  const matches = input.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  return (matches || [input]).map((part) => part.trim()).filter(Boolean);
}

function splitOversizedUnit(text, { maxWords, maxChars }) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const spans = protectedTitleSpans(words);
  const chunks = [];

  for (let start = 0; start < words.length;) {
    let boundary = start;
    let chars = 0;
    while (boundary < words.length && boundary - start < maxWords) {
      const nextChars = chars + (boundary > start ? 1 : 0) + words[boundary].length;
      if (boundary > start && nextChars > maxChars) break;
      if (boundary === start && nextChars > maxChars) {
        throw new Error(
          `local_tts_unsegmentable_token:${words[boundary].length}:max_${maxChars}`,
        );
      }
      chars = nextChars;
      boundary += 1;
    }

    const protectedBoundary = moveBoundaryOutsideProtectedSpan(
      boundary,
      start,
      spans,
      maxWords,
    );
    if (protectedBoundary !== boundary) {
      const candidate = words.slice(start, protectedBoundary).join(" ");
      if (candidate.length <= maxChars) boundary = protectedBoundary;
    }
    if (boundary <= start) boundary = Math.min(start + 1, words.length);
    chunks.push(words.slice(start, boundary).join(" "));
    start = boundary;
  }

  return chunks;
}

function splitLocalTtsRequestSegments(text, env = process.env, options = {}) {
  const maxWords = boundedPositiveInteger(
    options.maxWords ||
      env.LOCAL_TTS_MAX_SEGMENT_WORDS ||
      env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_WORDS,
    DEFAULT_MAX_WORDS,
    8,
    DEFAULT_MAX_WORDS,
  );
  const maxChars = boundedPositiveInteger(
    options.maxChars ||
      env.LOCAL_TTS_MAX_SEGMENT_CHARS ||
      env.STUDIO_V2_LOCAL_TTS_MAX_SEGMENT_CHARS,
    DEFAULT_MAX_CHARS,
    80,
    DEFAULT_MAX_CHARS,
  );
  const units = splitSentenceLikeText(text).flatMap((sentence) =>
    splitOversizedUnit(sentence, { maxWords, maxChars }),
  );
  const chunks = [];
  let current = "";
  let currentWords = 0;

  for (const unit of units) {
    const unitWords = unit.split(/\s+/).filter(Boolean).length;
    const candidate = current ? `${current} ${unit}` : unit;
    if (
      current &&
      (currentWords + unitWords > maxWords || candidate.length > maxChars)
    ) {
      chunks.push(current);
      current = unit;
      currentWords = unitWords;
    } else {
      current = candidate;
      currentWords += unitWords;
    }
  }
  if (current) chunks.push(current);

  return chunks.map((segmentText, index) => ({
    index,
    label: `tts_part_${String(index + 1).padStart(2, "0")}`,
    text: segmentText,
    wordCount: segmentText.split(/\s+/).filter(Boolean).length,
    charCount: segmentText.length,
    maxWords,
    maxChars,
  }));
}

module.exports = {
  DEFAULT_MAX_CHARS,
  DEFAULT_MAX_WORDS,
  splitLocalTtsRequestSegments,
};
