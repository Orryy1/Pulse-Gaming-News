"use strict";

const DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS = 600000;
const DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS = 1;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function applyLocalProofTtsLimits(env = process.env) {
  if (!env.LOCAL_TTS_TIMEOUT_MS) {
    env.LOCAL_TTS_TIMEOUT_MS = String(DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS);
  }
  if (!env.LOCAL_TTS_REQUEST_ATTEMPTS) {
    env.LOCAL_TTS_REQUEST_ATTEMPTS = String(DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS);
  }

  return {
    local_tts_timeout_ms: positiveInteger(
      env.LOCAL_TTS_TIMEOUT_MS,
      DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS,
    ),
    local_tts_request_attempts: positiveInteger(
      env.LOCAL_TTS_REQUEST_ATTEMPTS,
      DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS,
    ),
  };
}

module.exports = {
  DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS,
  DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS,
  applyLocalProofTtsLimits,
};
