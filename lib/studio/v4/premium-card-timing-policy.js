"use strict";

const PREMIUM_CARD_TIMING_POLICY_VERSION = "pulse_card_timing_v2";
const PREMIUM_CARD_TIMING_V5_VERSION = "pulse_card_timing_v5";

const SOURCE_CARD_TIMING = Object.freeze({
  minimum_visible_duration_s: 1.6,
  planned_visible_duration_s: 2.2,
  maximum_visible_duration_s: 2.8,
});

const READABLE_CARD_TIMING = Object.freeze({
  minimum_visible_duration_s: 3.6,
  maximum_visible_duration_s: 6.4,
});

const V5_SOURCE_CARD_TIMING = Object.freeze({
  minimum_visible_duration_s: 1.9,
  planned_visible_duration_s: 2.4,
  maximum_visible_duration_s: 2.8,
});

const V5_READABLE_CARD_TIMING = Object.freeze({
  minimum_visible_duration_s: 2.2,
  maximum_visible_duration_s: 2.8,
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readableWordCount(value) {
  return cleanText(value)
    .split(/\s+/)
    .filter((token) => /[\p{L}\p{N}]/u.test(token))
    .length;
}

function normaliseCardKind(value) {
  const kind = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (/(?:^|_)source(?:_lock|_card)?(?:_|$)/.test(kind)) return "source";
  if (kind.includes("timeline")) return "timeline";
  if (kind.includes("quote")) return "quote";
  if (kind.includes("takeaway") || kind.includes("outro")) return "takeaway";
  if (kind.includes("headline") || kind.includes("proof")) return "proof";
  return kind || "context";
}

function readableCardPlannedDurationS(text) {
  const clean = cleanText(text);
  if (!clean) return READABLE_CARD_TIMING.minimum_visible_duration_s;
  const words = readableWordCount(clean);
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(clean) ? 0.2 : 0;
  const computed = Math.max(
    READABLE_CARD_TIMING.minimum_visible_duration_s,
    0.22 * words + 2.5 + longTokenPenalty,
  );
  return Number(
    Math.min(
      READABLE_CARD_TIMING.maximum_visible_duration_s,
      Math.ceil(computed * 10) / 10,
    ).toFixed(1),
  );
}

function v5ReadableCardRequiredDurationS(text) {
  const clean = cleanText(text);
  if (!clean) return V5_READABLE_CARD_TIMING.minimum_visible_duration_s;
  const words = readableWordCount(clean);
  const longTokenPenalty = /\b[A-Z0-9]{15,}\b/.test(clean) ? 0.2 : 0;
  const computed = Math.max(
    V5_READABLE_CARD_TIMING.minimum_visible_duration_s,
    0.18 * words + 1 + longTokenPenalty,
  );
  return Number((Math.ceil(computed * 10 - 1e-9) / 10).toFixed(1));
}

function v5SourceCardRequiredDurationS(text) {
  const clean = cleanText(text);
  if (!clean) return V5_SOURCE_CARD_TIMING.minimum_visible_duration_s;
  const words = readableWordCount(clean);
  const computed = Math.max(
    V5_SOURCE_CARD_TIMING.minimum_visible_duration_s,
    0.22 * words + 1.4,
  );
  return Number((Math.ceil(computed * 10 - 1e-9) / 10).toFixed(1));
}

function v5ReadableCardPlannedDurationS(text) {
  return Number(
    Math.min(
      V5_READABLE_CARD_TIMING.maximum_visible_duration_s,
      v5ReadableCardRequiredDurationS(text),
    ).toFixed(1),
  );
}

function cardTimingContract(kind, readableText = "") {
  const normalisedKind = normaliseCardKind(kind);
  if (normalisedKind === "source") {
    return {
      kind: "source",
      ...SOURCE_CARD_TIMING,
    };
  }
  return {
    kind: normalisedKind,
    minimum_visible_duration_s: READABLE_CARD_TIMING.minimum_visible_duration_s,
    planned_visible_duration_s: readableCardPlannedDurationS(readableText),
    maximum_visible_duration_s: READABLE_CARD_TIMING.maximum_visible_duration_s,
  };
}


function v5CardTimingContract(kind, readableText = "") {
  const normalisedKind = normaliseCardKind(kind);
  if (normalisedKind === "source") {
    const requiredVisibleDurationS = v5SourceCardRequiredDurationS(readableText);
    return {
      kind: "source",
      minimum_visible_duration_s: V5_SOURCE_CARD_TIMING.minimum_visible_duration_s,
      planned_visible_duration_s: Number(
        Math.max(
          V5_SOURCE_CARD_TIMING.planned_visible_duration_s,
          Math.min(V5_SOURCE_CARD_TIMING.maximum_visible_duration_s, requiredVisibleDurationS),
        ).toFixed(1),
      ),
      required_visible_duration_s: requiredVisibleDurationS,
      maximum_visible_duration_s: V5_SOURCE_CARD_TIMING.maximum_visible_duration_s,
      content_fits_maximum:
        requiredVisibleDurationS <= V5_SOURCE_CARD_TIMING.maximum_visible_duration_s,
    };
  }
  const requiredVisibleDurationS = v5ReadableCardRequiredDurationS(readableText);
  return {
    kind: normalisedKind,
    minimum_visible_duration_s: V5_READABLE_CARD_TIMING.minimum_visible_duration_s,
    planned_visible_duration_s: v5ReadableCardPlannedDurationS(readableText),
    required_visible_duration_s: requiredVisibleDurationS,
    maximum_visible_duration_s: V5_READABLE_CARD_TIMING.maximum_visible_duration_s,
    content_fits_maximum:
      requiredVisibleDurationS <= V5_READABLE_CARD_TIMING.maximum_visible_duration_s,
  };
}

module.exports = {
  PREMIUM_CARD_TIMING_POLICY_VERSION,
  PREMIUM_CARD_TIMING_V5_VERSION,
  READABLE_CARD_TIMING,
  SOURCE_CARD_TIMING,
  V5_READABLE_CARD_TIMING,
  V5_SOURCE_CARD_TIMING,
  cardTimingContract,
  v5CardTimingContract,
  normaliseCardKind,
  readableWordCount,
  readableCardPlannedDurationS,
  v5ReadableCardPlannedDurationS,
  v5ReadableCardRequiredDurationS,
  v5SourceCardRequiredDurationS,
};
