"use strict";

const WIDTH_SAFETY_FACTOR = 1.12;

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function glyphWidthEm(character) {
  if (/\s/.test(character)) return 0.32;
  if (/[\u200C\u200D\uFE0E\uFE0F]/u.test(character)) return 0;
  if (/\p{Mark}/u.test(character)) return 0;
  if (/[MW]/.test(character)) return 0.94;
  if (/[OQG@%&]/.test(character)) return 0.8;
  if (/[I1|!.,:;'\u2019`]/.test(character)) return 0.3;
  if (/[A-Z]/.test(character)) return 0.72;
  if (/[mw]/.test(character)) return 0.84;
  if (/[iljftr]/.test(character)) return 0.38;
  if (/[a-z]/.test(character)) return 0.57;
  if (/[0-9]/.test(character)) return 0.59;
  if (/[-_()[\]{}]/.test(character)) return 0.42;
  if (/[\u2013\u2014]/.test(character)) return 1;

  const decomposed = character.normalize("NFD");
  if (decomposed !== character) {
    const base = Array.from(decomposed).find(
      (entry) => !/\p{Mark}/u.test(entry),
    );
    if (base && base !== character) return glyphWidthEm(base);
  }
  if (/\p{Script=Latin}/u.test(character)) {
    return /\p{Uppercase_Letter}/u.test(character) ? 0.82 : 0.72;
  }
  if (
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\uFF00-\uFFEF]/u.test(
      character,
    )
  ) {
    return 1;
  }
  if (/\p{Extended_Pictographic}/u.test(character)) return 1.2;
  return 1.2;
}

function estimateTextWidth(value, fontSize, letterSpacing = 0) {
  const characters = Array.from(cleanText(value));
  if (!characters.length) return 0;
  const glyphWidth = characters.reduce(
    (total, character) => total + glyphWidthEm(character),
    0,
  );
  return (
    glyphWidth * Number(fontSize) * WIDTH_SAFETY_FACTOR +
    Math.max(0, characters.length - 1) * Number(letterSpacing || 0)
  );
}

function splitToken(token, options) {
  const pieces = [];
  let piece = "";
  for (const character of Array.from(token)) {
    const candidate = `${piece}${character}`;
    if (
      piece &&
      estimateTextWidth(
        candidate,
        options.fontSize,
        options.letterSpacing,
      ) > options.maxWidth
    ) {
      pieces.push(piece);
      piece = character;
    } else {
      piece = candidate;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

function wrapText(value, options) {
  const words = cleanText(value).split(" ").filter(Boolean);
  const lines = [];
  const lineSuffixes = [];
  let line = "";

  for (const [wordIndex, word] of words.entries()) {
    const pieces =
      estimateTextWidth(
        word,
        options.fontSize,
        options.letterSpacing,
      ) > options.maxWidth
        ? splitToken(word, options)
        : [word];
    for (const [pieceIndex, piece] of pieces.entries()) {
      const separator =
        wordIndex > 0 && pieceIndex === 0 ? " " : "";
      const candidate = line ? `${line}${separator}${piece}` : piece;
      if (
        line &&
        estimateTextWidth(
          candidate,
          options.fontSize,
          options.letterSpacing,
        ) > options.maxWidth
      ) {
        lines.push(line);
        lineSuffixes.push(separator);
        line = piece;
      } else {
        line = candidate;
      }
    }
  }
  if (line) {
    lines.push(line);
    lineSuffixes.push("");
  }
  return { lines, lineSuffixes };
}

function fitTextLines(
  value,
  {
    maxWidth,
    maxFontSize,
    minFontSize,
    multilineMaxFontSize = maxFontSize,
    maxLines,
    letterSpacing = 0,
    lineHeight,
  } = {},
) {
  const content = cleanText(value);
  if (
    !content ||
    !Number.isFinite(maxWidth) ||
    maxWidth <= 0 ||
    !Number.isFinite(maxFontSize) ||
    maxFontSize <= 0 ||
    !Number.isFinite(minFontSize) ||
    minFontSize <= 0 ||
    minFontSize > maxFontSize ||
    !Number.isFinite(multilineMaxFontSize) ||
    multilineMaxFontSize < minFontSize ||
    multilineMaxFontSize > maxFontSize ||
    !Number.isInteger(maxLines) ||
    maxLines <= 0
  ) {
    throw new Error("svg_text_layout_contract_invalid");
  }

  for (
    let fontSize = Math.floor(maxFontSize);
    fontSize >= Math.ceil(minFontSize);
    fontSize -= 1
  ) {
    const { lines, lineSuffixes } = wrapText(content, {
      fontSize,
      letterSpacing,
      maxWidth,
    });
    if (
      lines.length <= maxLines &&
      (lines.length === 1 || fontSize <= multilineMaxFontSize) &&
      lines.every(
        (line, index) =>
          estimateTextWidth(
            `${line}${lineSuffixes[index]}`,
            fontSize,
            letterSpacing,
          ) <= maxWidth,
      ) &&
      lines
        .map((line, index) => `${line}${lineSuffixes[index]}`)
        .join("") === content
    ) {
      const resolvedLineHeight = Math.max(
        fontSize,
        Math.round(
          Number.isFinite(lineHeight)
            ? lineHeight * (fontSize / maxFontSize)
            : fontSize * 1.16,
        ),
      );
      return Object.freeze({
        fontSize,
        lineHeight: resolvedLineHeight,
        lines: Object.freeze(lines),
        lineSuffixes: Object.freeze(lineSuffixes),
      });
    }
  }
  throw new Error("svg_text_layout_cannot_fit");
}

module.exports = {
  fitTextLines,
};
