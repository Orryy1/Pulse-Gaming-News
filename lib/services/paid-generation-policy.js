"use strict";

function enabled(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function paidElevenLabsMusicEnabled(env = process.env) {
  return (
    enabled(env.PULSE_PAID_MEDIA_GENERATION_ENABLED) &&
    enabled(env.ELEVENLABS_MUSIC_GENERATION_ENABLED)
  );
}

function legacyCompilationSchedulerEnabled(env = process.env) {
  return (
    enabled(env.PULSE_LEGACY_COMPILATION_ENABLED) &&
    String(env.PULSE_OPERATING_MODE || "")
      .trim()
      .toUpperCase() === "LOCAL_PROOF"
  );
}

module.exports = {
  legacyCompilationSchedulerEnabled,
  paidElevenLabsMusicEnabled,
};
