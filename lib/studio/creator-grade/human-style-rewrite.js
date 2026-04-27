"use strict";

const AI_TELL_PATTERNS = [
  /\byou won'?t believe\b/gi,
  /\bthis changes everything\b/gi,
  /\bbut here'?s where it gets interesting\b/gi,
  /\blet that sink in\b/gi,
  /\band that'?s not all\b/gi,
  /\bin today'?s video\b/gi,
  /\bwelcome back\b/gi,
  /\bmake sure to\b/gi,
  /\bdon'?t forget to\b/gi,
];

const FILLER_PATTERNS = [
  /\bbasically,?\s*/gi,
  /\bessentially,?\s*/gi,
  /\bobviously,?\s*/gi,
  /\bjust,?\s*/gi,
  /\bkind of\b/gi,
  /\bsort of\b/gi,
  /\bto be honest,?\s*/gi,
  /\bhere'?s the thing,?\s*/gi,
];

function cleanWhitespace(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/([.!?])([A-Z])/g, "$1 $2")
    .trim();
}

function splitSentences(text) {
  return cleanWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function countWords(text) {
  return cleanWhitespace(text).split(/\s+/).filter(Boolean).length;
}

function removeAiTells(text) {
  let out = String(text || "");
  const removed = [];
  for (const pattern of AI_TELL_PATTERNS) {
    out = out.replace(pattern, (match) => {
      removed.push(match);
      return "";
    });
  }
  return { text: cleanWhitespace(out), removed };
}

function removeFiller(text) {
  let out = String(text || "");
  const removed = [];
  for (const pattern of FILLER_PATTERNS) {
    out = out.replace(pattern, (match) => {
      removed.push(match);
      return "";
    });
  }
  return { text: cleanWhitespace(out), removed };
}

function tightenSentence(sentence, maxWords = 18) {
  const words = cleanWhitespace(sentence).split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return cleanWhitespace(sentence);
  const trimmed = words.slice(0, maxWords).join(" ");
  return trimmed.replace(/[,:;]$/, "") + ".";
}

function rewriteHook(title = "", script = "") {
  const source = `${title} ${script}`;
  const titleGame =
    String(title).match(/\b([A-Z][A-Za-z]+(?:\s+\d{1,4})?)\b/)?.[1] ||
    String(title).split(/\s+/).slice(0, 2).join(" ") ||
    "This story";
  if (/\bis real\b/i.test(source)) {
    return `${titleGame} is real, and the proof is unusually specific.`;
  }
  if (/trailer|revealed|reveal/i.test(source)) {
    return `${titleGame} has a trailer, and one detail matters.`;
  }
  if (/release|date|launch/i.test(source)) {
    return `${titleGame} finally has a release window worth checking.`;
  }
  return `${titleGame} has a new detail worth watching closely.`;
}

function runHumanStyleRewrite({
  title = "",
  script = "",
  targetWords = { min: 125, max: 155 },
} = {}) {
  const ai = removeAiTells(script);
  const filler = removeFiller(ai.text);
  const sentences = splitSentences(filler.text).map((s) => tightenSentence(s));
  let tightened = cleanWhitespace(sentences.join(" "));

  const warnings = [];
  const wordCount = countWords(tightened);
  if (wordCount < targetWords.min) {
    warnings.push({
      code: "script_short",
      message: `Tightened script is ${wordCount} words; target is ${targetWords.min}-${targetWords.max}.`,
    });
  }
  if (wordCount > targetWords.max) {
    warnings.push({
      code: "script_long",
      message: `Tightened script is ${wordCount} words; target is ${targetWords.min}-${targetWords.max}.`,
    });
  }

  const overlong = splitSentences(tightened).filter((s) => countWords(s) > 22);
  if (overlong.length) {
    warnings.push({
      code: "overlong_sentences",
      message: `${overlong.length} sentence(s) still exceed 22 words.`,
    });
  }

  const hook = rewriteHook(title, tightened);
  if (countWords(hook) < 8 || countWords(hook) > 12) {
    warnings.push({
      code: "hook_length",
      message: `Hook is ${countWords(hook)} words; target is 8-12.`,
    });
  }

  return {
    hook,
    tightenedScript: tightened,
    wordCount,
    removedAiTells: ai.removed,
    removedFiller: filler.removed,
    sentenceCount: splitSentences(tightened).length,
    warnings,
  };
}

module.exports = {
  AI_TELL_PATTERNS,
  FILLER_PATTERNS,
  cleanWhitespace,
  countWords,
  removeAiTells,
  removeFiller,
  rewriteHook,
  runHumanStyleRewrite,
  splitSentences,
};
