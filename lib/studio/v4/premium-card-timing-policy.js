"use strict";

const PREMIUM_CARD_TIMING_POLICY_VERSION = "pulse_card_timing_v1";

const SOURCE_CARD_TIMING = Object.freeze({
  minimum_visible_duration_s: 1.4,
  planned_visible_duration_s: 1.6,
  maximum_visible_duration_s: 2.2,
});

const READABLE_CARD_TIMING = Object.freeze({
  minimum_visible_duration_s: 4.2,
  maximum_visible_duration_s: 5.8,
});

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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
  const words = clean.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(clean) ? 0.25 : 0;
  const computed = Math.max(
    READABLE_CARD_TIMING.minimum_visible_duration_s,
    0.34 * words + 2.8 + longTokenPenalty,
  );
  return Number(
    Math.min(
      READABLE_CARD_TIMING.maximum_visible_duration_s,
      Math.ceil(computed * 10) / 10,
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

module.exports = {
  PREMIUM_CARD_TIMING_POLICY_VERSION,
  READABLE_CARD_TIMING,
  SOURCE_CARD_TIMING,
  cardTimingContract,
  normaliseCardKind,
  readableCardPlannedDurationS,
};
