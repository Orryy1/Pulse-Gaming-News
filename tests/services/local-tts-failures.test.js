"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyLocalTtsFailure,
  classifyLocalTtsHealthFailure,
  classifyLocalTtsProofFailure,
} = require("../../lib/studio/local-tts-failures");

test("classifyLocalTtsHealthFailure separates server down, timeout and unloaded voice", () => {
  assert.equal(
    classifyLocalTtsHealthFailure({
      status: "unreachable",
      reasons: ["health endpoint unreachable: fetch failed ECONNREFUSED"],
    }).code,
    "server_down",
  );
  assert.equal(
    classifyLocalTtsHealthFailure({
      status: "unreachable",
      reasons: ["health endpoint unreachable: This operation was aborted"],
    }).code,
    "health_timeout",
  );
  assert.equal(
    classifyLocalTtsHealthFailure({
      status: "ok",
      ready: true,
      voice: { present: true, refResolved: true, loaded: false },
    }).code,
    "voice_not_loaded",
  );
  assert.equal(
    classifyLocalTtsHealthFailure({
      status: "ok",
      ready: true,
      reasons: ["accepted Sleepy Liam reference fingerprint is missing"],
      voice: {
        present: true,
        refResolved: true,
        loaded: true,
        reference: { referencePresent: true },
      },
    }).code,
    "unsafe_voice",
  );
});

test("classifyLocalTtsFailure recognises transient socket resets and TTS timeouts", () => {
  const reset = new Error("read ECONNRESET");
  reset.code = "ECONNRESET";
  assert.equal(classifyLocalTtsFailure(reset).code, "connection_reset");
  assert.equal(classifyLocalTtsFailure(new Error("local TTS timeout after 600000ms")).code, "tts_timeout");
});

test("classifyLocalTtsProofFailure classifies duration, timestamps and unsafe voice issues", () => {
  assert.equal(classifyLocalTtsProofFailure({ durationSeconds: 58.9 }).code, "duration_too_short");
  assert.equal(classifyLocalTtsProofFailure({ durationSeconds: 77.2 }).code, "duration_too_long");
  assert.equal(classifyLocalTtsProofFailure({ durationSeconds: null }).code, "duration_unknown");
  assert.equal(
    classifyLocalTtsProofFailure({ durationSeconds: 66.2, timestampsStamped: false }).code,
    "missing_timestamps",
  );
  assert.equal(
    classifyLocalTtsProofFailure({
      durationSeconds: 66.2,
      timestampsStamped: true,
      localVoiceReference: { referencePresent: false },
    }).code,
    "unsafe_voice",
  );
  assert.equal(
    classifyLocalTtsProofFailure({
      durationSeconds: 66.2,
      timestampsStamped: true,
      localVoiceReference: { referencePresent: true },
      acoustic: { medianPitchHz: 118 },
      transcript: "Follow Pulse Gaming so you never miss a beat.",
      wordCount: 190,
    }).code,
    null,
  );
});

test("classifyLocalTtsProofFailure rejects proof-ready audio without acoustic, outro and pace evidence", () => {
  const base = {
    durationSeconds: 66.2,
    timestampsStamped: true,
    localVoiceReference: { referencePresent: true },
    wordCount: 190,
  };

  assert.equal(classifyLocalTtsProofFailure(base).code, "pitch_profile_unverified");
  assert.equal(
    classifyLocalTtsProofFailure({
      ...base,
      acoustic: { medianPitchHz: 62 },
      transcript: "Follow Pulse Gaming so you never miss a beat.",
    }).code,
    "demonic_low_voice_risk",
  );
  assert.equal(
    classifyLocalTtsProofFailure({
      ...base,
      acoustic: { medianPitchHz: 118 },
      transcript: "The story ends without the channel outro.",
    }).code,
    "missing_spoken_outro",
  );
  assert.equal(
    classifyLocalTtsProofFailure({
      ...base,
      acoustic: { medianPitchHz: 118 },
      transcript: "Follow Pulse Gaming so you never miss a beat.",
      wordCount: 95,
    }).code,
    "spoken_pace_too_slow",
  );
});
