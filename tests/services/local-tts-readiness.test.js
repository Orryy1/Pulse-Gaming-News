"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  summariseLocalTtsHealth,
} = require("../../lib/studio/local-tts-readiness");

test("summariseLocalTtsHealth fails closed when unknown voice fallback is enabled", () => {
  const report = summariseLocalTtsHealth(
    {
      status: "ok",
      phase: "ready",
      ready: true,
      engine_count: 1,
      unknown_voice_fallback_allowed: true,
      voices: [
        {
          voice_id: "TX3LPaxmHKxFdv7VOQHJ",
          alias: "liam",
          loaded: true,
          ref_resolved: true,
          reference_present: true,
          accepted_reference_id: "pulse-sleepy-liam-20260502",
          accepted_reference_file: "pulse_liam_sleepy.wav",
          reference_sha1: "a".repeat(40),
        },
      ],
    },
    "TX3LPaxmHKxFdv7VOQHJ",
    {
      env: {
        STUDIO_V2_LOCAL_VOICE_REFERENCE_HASH: "a".repeat(40),
      },
    },
  );

  assert.equal(report.ok, false);
  assert.ok(report.reasons.includes("unknown local voice fallback is enabled"));
});
