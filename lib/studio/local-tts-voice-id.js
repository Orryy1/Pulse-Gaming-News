"use strict";

const ACCEPTED_LOCAL_LIAM_VOICE_ID = "TX3LPaxmHKxFdv7VOQHJ";

const LOCAL_LIAM_ALIASES = new Set([
  "liam",
  "sleepy-liam",
  "sleepy_liam",
  "pulse-liam",
  "pulse_liam",
  "pulse-sleepy-liam",
  "pulse_sleepy_liam",
]);

function canonicalLocalTtsVoiceId(value) {
  if (value === undefined || value === null) return value;
  const trimmed = String(value).trim();
  if (!trimmed) return trimmed;
  return LOCAL_LIAM_ALIASES.has(trimmed.toLowerCase())
    ? ACCEPTED_LOCAL_LIAM_VOICE_ID
    : trimmed;
}

module.exports = {
  ACCEPTED_LOCAL_LIAM_VOICE_ID,
  LOCAL_LIAM_ALIASES,
  canonicalLocalTtsVoiceId,
};
