"use strict";

const MONTHS = Object.freeze(
  new Map(
    [
      ["jan", "01"],
      ["january", "01"],
      ["feb", "02"],
      ["february", "02"],
      ["mar", "03"],
      ["march", "03"],
      ["apr", "04"],
      ["april", "04"],
      ["may", "05"],
      ["jun", "06"],
      ["june", "06"],
      ["jul", "07"],
      ["july", "07"],
      ["aug", "08"],
      ["august", "08"],
      ["sep", "09"],
      ["sept", "09"],
      ["september", "09"],
      ["oct", "10"],
      ["october", "10"],
      ["nov", "11"],
      ["november", "11"],
      ["dec", "12"],
      ["december", "12"],
    ],
  ),
);

function text(value) {
  return String(value ?? "").trim();
}

function titleTokens(value) {
  return text(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function titleSimilarity(left, right) {
  const leftTokens = new Set(titleTokens(left));
  const rightTokens = new Set(titleTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const intersection = [...leftTokens].filter((token) =>
    rightTokens.has(token),
  );
  const union = new Set([...leftTokens, ...rightTokens]);
  return intersection.length / union.size;
}

function temporalMarkers(value) {
  const normalised = text(value).toLowerCase();
  const words = normalised.match(/[a-z]+/g) || [];
  const months = new Set(
    words.map((word) => MONTHS.get(word)).filter(Boolean),
  );
  const years = new Set(
    normalised.match(/\b20\d{2}\b/g) || [],
  );
  const waves = new Set(
    [...normalised.matchAll(/\bwave\s*(\d+)\b/g)].map(
      (match) => match[1],
    ),
  );
  return { months, years, waves };
}

function disjointWhenBothPresent(left, right) {
  if (left.size === 0 || right.size === 0) return false;
  return ![...left].some((value) => right.has(value));
}

function hasConflictingTemporalEdition(left, right) {
  const leftMarkers = temporalMarkers(left);
  const rightMarkers = temporalMarkers(right);
  return (
    disjointWhenBothPresent(leftMarkers.months, rightMarkers.months) ||
    disjointWhenBothPresent(leftMarkers.years, rightMarkers.years) ||
    disjointWhenBothPresent(leftMarkers.waves, rightMarkers.waves)
  );
}

function isStoryTitleDuplicate(left, right, threshold = 0.5) {
  if (!text(left) || !text(right)) return false;
  if (hasConflictingTemporalEdition(left, right)) return false;
  return titleSimilarity(left, right) > threshold;
}

module.exports = {
  hasConflictingTemporalEdition,
  isStoryTitleDuplicate,
  temporalMarkers,
  titleSimilarity,
};
