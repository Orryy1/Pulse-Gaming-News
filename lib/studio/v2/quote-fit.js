"use strict";

function normaliseQuoteText(value) {
  return String(value ?? "")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function shortenToken(token, maxTokenChars) {
  const text = String(token || "");
  const max = Number(maxTokenChars);
  if (!Number.isFinite(max) || max < 8 || text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function wrapQuoteLines(text, { maxCharsPerLine = 28, maxLines = 3 } = {}) {
  const words = normaliseQuoteText(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharsPerLine) {
      return { lines: [...lines, current || word].filter(Boolean), overflow: true };
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) {
        return { lines, overflow: true };
      }
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return { lines, overflow: lines.length > maxLines };
}

function appendEllipsis(words) {
  if (!words.length) return words;
  const out = words.slice();
  out[out.length - 1] = `${out[out.length - 1].replace(/[.]+$/g, "")}...`;
  return out;
}

function fitQuoteText(
  value,
  {
    maxWords = 11,
    maxChars = 84,
    maxCharsPerLine = 28,
    maxLines = 3,
    maxTokenChars = 22,
  } = {},
) {
  const inputWords = normaliseQuoteText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => shortenToken(word, maxTokenChars));
  const words = [];
  let truncated = false;

  for (const word of inputWords) {
    if (words.length >= maxWords) {
      truncated = true;
      break;
    }
    const candidateWords = [...words, word];
    const candidateText = candidateWords.join(" ");
    if (candidateText.length > maxChars) {
      truncated = true;
      break;
    }
    const wrapped = wrapQuoteLines(candidateText, { maxCharsPerLine, maxLines });
    if (wrapped.overflow) {
      truncated = true;
      break;
    }
    words.push(word);
  }

  if (!words.length && inputWords.length) {
    words.push(shortenToken(inputWords[0], Math.min(maxTokenChars, maxCharsPerLine)));
    truncated = inputWords.length > 1 || inputWords[0] !== words[0];
  }

  const fittedWords = truncated ? appendEllipsis(words) : words;
  let fitted = fittedWords.join(" ");
  while (fitted.length > maxChars && fittedWords.length > 1) {
    fittedWords.pop();
    fitted = appendEllipsis(fittedWords).join(" ");
  }
  return fitted;
}

function quoteLayoutClass(text) {
  const clean = normaliseQuoteText(text);
  const wrapped = wrapQuoteLines(clean, { maxCharsPerLine: 28, maxLines: 3 });
  const words = clean.split(/\s+/).filter(Boolean).length;
  if (wrapped.overflow || wrapped.lines.length >= 3 || words > 9 || clean.length > 74) {
    return "quote quote--compact";
  }
  if (wrapped.lines.length === 2 || words > 6 || clean.length > 52) {
    return "quote quote--medium";
  }
  return "quote";
}

function pickQuoteFontSize(text) {
  const clean = normaliseQuoteText(text);
  const wrapped = wrapQuoteLines(clean, { maxCharsPerLine: 28, maxLines: 3 });
  const words = clean.split(/\s+/).filter(Boolean).length;
  if (wrapped.lines.length >= 3 || words >= 9 || clean.length > 74) return 50;
  if (wrapped.lines.length === 2 || words >= 6 || clean.length > 52) return 60;
  return 76;
}

module.exports = {
  fitQuoteText,
  normaliseQuoteText,
  pickQuoteFontSize,
  quoteLayoutClass,
  wrapQuoteLines,
};
