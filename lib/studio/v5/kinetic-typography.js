"use strict";

const {
  buildKineticAss,
} = require("../v2/subtitle-layer-v2");

const KINETIC_TYPOGRAPHY_V5 = Object.freeze({
  version: "pulse_kinetic_typography_v5",
  max_words_per_phrase: 5,
  max_chars_per_phrase: 32,
  max_phrase_duration_s: 1.8,
  min_phrase_duration_s: 0.45,
  dangling_merge_max_words: 6,
  max_single_word_caption_ratio: 0.12,
  reveal_mode: "phrase",
  motion_style: "editorial",
});

function assTimeToSeconds(value) {
  const parts = String(value || "").split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function captionRows(ass = "") {
  return String(ass)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("Dialogue:"))
    .map((line) => {
      const fields = line.split(",");
      const startS = assTimeToSeconds(fields[1]);
      const endS = assTimeToSeconds(fields[2]);
      const text = fields
        .slice(9)
        .join(",")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\h/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return {
        start_s: startS,
        end_s: endS,
        duration_s: Number(Math.max(0, endS - startS).toFixed(3)),
        text,
        word_count: text ? text.split(/\s+/).length : 0,
      };
    });
}

function inspectPremiumCaptionCadence(ass = "") {
  const captions = captionRows(ass);
  const singleWordCount = captions.filter((caption) => caption.word_count === 1).length;
  const singleWordRatio = captions.length
    ? Number((singleWordCount / captions.length).toFixed(3))
    : 0;
  const minimumDwellS = captions.length
    ? Math.min(...captions.map((caption) => caption.duration_s))
    : 0;
  const maximumWords = captions.length
    ? Math.max(...captions.map((caption) => caption.word_count))
    : 0;
  const blockers = [];
  if (!captions.length) blockers.push("captions_missing");
  if (singleWordRatio > KINETIC_TYPOGRAPHY_V5.max_single_word_caption_ratio) {
    blockers.push("caption_single_word_ratio_above_premium_ceiling");
  }
  if (captions.length && minimumDwellS + 0.001 < KINETIC_TYPOGRAPHY_V5.min_phrase_duration_s) {
    blockers.push("caption_dwell_below_premium_floor");
  }
  if (maximumWords > KINETIC_TYPOGRAPHY_V5.max_words_per_phrase) {
    blockers.push("caption_words_above_premium_ceiling");
  }
  return {
    version: KINETIC_TYPOGRAPHY_V5.version,
    status: blockers.length ? "fail" : "pass",
    blockers,
    metrics: {
      caption_count: captions.length,
      single_word_caption_count: singleWordCount,
      single_word_caption_ratio: singleWordRatio,
      minimum_caption_dwell_s: minimumDwellS,
      maximum_words_per_caption: maximumWords,
    },
    captions,
  };
}

function buildPremiumKineticAss({ story, words, duration, scriptText } = {}) {
  return buildKineticAss({
    story,
    words,
    duration,
    scriptText,
    maxWordsPerPhrase: KINETIC_TYPOGRAPHY_V5.max_words_per_phrase,
    maxPhraseChars: KINETIC_TYPOGRAPHY_V5.max_chars_per_phrase,
    captionCase: "upper",
    revealMode: KINETIC_TYPOGRAPHY_V5.reveal_mode,
    motionStyle: KINETIC_TYPOGRAPHY_V5.motion_style,
    avoidDanglingWords: true,
    danglingMergeMaxWords: KINETIC_TYPOGRAPHY_V5.dangling_merge_max_words,
    maxPhraseDurationS: KINETIC_TYPOGRAPHY_V5.max_phrase_duration_s,
    minPhraseDurationS: KINETIC_TYPOGRAPHY_V5.min_phrase_duration_s,
  });
}

module.exports = {
  KINETIC_TYPOGRAPHY_V5,
  buildPremiumKineticAss,
  inspectPremiumCaptionCadence,
};
