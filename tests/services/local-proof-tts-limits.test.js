"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS,
  DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS,
  applyLocalProofTtsLimits,
} = require("../../lib/ops/local-proof-tts-limits");

test("local proof TTS limits give long local Liam proofs a ten minute default", () => {
  const env = {};

  const result = applyLocalProofTtsLimits(env);

  assert.equal(DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS, 600000);
  assert.equal(result.local_tts_timeout_ms, DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS);
  assert.equal(result.local_tts_request_attempts, DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS);
  assert.equal(env.LOCAL_TTS_TIMEOUT_MS, String(DEFAULT_LOCAL_PROOF_TTS_TIMEOUT_MS));
  assert.equal(env.LOCAL_TTS_REQUEST_ATTEMPTS, String(DEFAULT_LOCAL_PROOF_TTS_ATTEMPTS));
});

test("local proof TTS limits preserve explicit operator overrides", () => {
  const env = {
    LOCAL_TTS_TIMEOUT_MS: "240000",
    LOCAL_TTS_REQUEST_ATTEMPTS: "2",
  };

  const result = applyLocalProofTtsLimits(env);

  assert.equal(result.local_tts_timeout_ms, 240000);
  assert.equal(result.local_tts_request_attempts, 2);
  assert.equal(env.LOCAL_TTS_TIMEOUT_MS, "240000");
  assert.equal(env.LOCAL_TTS_REQUEST_ATTEMPTS, "2");
});
