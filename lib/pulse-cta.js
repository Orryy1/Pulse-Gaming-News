"use strict";

const PRIMARY_PULSE_CTA = "Follow Pulse Gaming so you never miss a beat";
const IDENTITY_PULSE_CTA =
  "Follow Pulse Gaming for the gaming stories behind the headline";
const SHORT_IDENTITY_PULSE_CTA =
  "Follow for the gaming stories behind the headline";

const APPROVED_PULSE_CTAS = [
  PRIMARY_PULSE_CTA,
  IDENTITY_PULSE_CTA,
  SHORT_IDENTITY_PULSE_CTA,
];

function normalisePulseCtaText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function approvedPulseCtaKeys() {
  return APPROVED_PULSE_CTAS.map(normalisePulseCtaText);
}

function hasApprovedPulseCta(value) {
  const text = normalisePulseCtaText(value);
  if (!text) return false;
  return approvedPulseCtaKeys().some((cta) => text.includes(cta));
}

function isApprovedPulseCta(value) {
  const text = normalisePulseCtaText(value);
  if (!text) return false;
  return approvedPulseCtaKeys().includes(text);
}

module.exports = {
  APPROVED_PULSE_CTAS,
  PRIMARY_PULSE_CTA,
  IDENTITY_PULSE_CTA,
  SHORT_IDENTITY_PULSE_CTA,
  normalisePulseCtaText,
  hasApprovedPulseCta,
  isApprovedPulseCta,
};
