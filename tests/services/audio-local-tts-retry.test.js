"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  isRetryableLocalTtsError,
  markAudioGenerationFailure,
  requestTtsWithRetry,
  resolveTtsVoiceIdForProvider,
} = require("../../audio");

test("isRetryableLocalTtsError: recognises transient local socket resets", () => {
  assert.equal(isRetryableLocalTtsError({ code: "ECONNRESET" }), true);
  assert.equal(isRetryableLocalTtsError(new Error("read ECONNRESET")), true);
  assert.equal(isRetryableLocalTtsError({ code: "ETIMEDOUT" }), true);
  assert.equal(isRetryableLocalTtsError(new Error("HTTP 400")), false);
});

test("requestTtsWithRetry: retries local ECONNRESET once and returns the response", async () => {
  let calls = 0;
  const response = await requestTtsWithRetry({
    provider: "local",
    requestConfig: { url: "http://127.0.0.1:8765/v1/text-to-speech/x" },
    retryDelayMs: 1,
    request: async () => {
      calls++;
      if (calls === 1) {
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      }
      return { data: { audio_base64: "abc" } };
    },
  });

  assert.equal(calls, 2);
  assert.equal(response.data.audio_base64, "abc");
});

test("requestTtsWithRetry: does not retry remote provider socket errors", async () => {
  let calls = 0;
  await assert.rejects(
    requestTtsWithRetry({
      provider: "elevenlabs",
      requestConfig: {},
      retryDelayMs: 1,
      request: async () => {
        calls++;
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      },
    }),
    /ECONNRESET/,
  );
  assert.equal(calls, 1);
});

test("requestTtsWithRetry: stops after configured local attempts", async () => {
  let calls = 0;
  await assert.rejects(
    requestTtsWithRetry({
      provider: "local",
      requestConfig: {},
      attempts: 2,
      retryDelayMs: 1,
      request: async () => {
        calls++;
        const err = new Error("read ECONNRESET");
        err.code = "ECONNRESET";
        throw err;
      },
    }),
    /ECONNRESET/,
  );
  assert.equal(calls, 2);
});

test("resolveTtsVoiceIdForProvider: local TTS refuses generic or non-Liam fallback voices", () => {
  assert.throws(
    () => resolveTtsVoiceIdForProvider("local", { LOCAL_TTS_VOICE_ID: "__default__" }, {}),
    /unsafe_local_tts_voice:missing_mapped_liam_voice_id/,
  );
  assert.throws(
    () => resolveTtsVoiceIdForProvider("local", { LOCAL_TTS_VOICE_ID: "G17SuINrv2H9FC6nvetn" }, {}),
    /unsafe_local_tts_voice:G17SuINrv2H9FC6nvetn:expected_TX3LPaxmHKxFdv7VOQHJ/,
  );
  assert.equal(
    resolveTtsVoiceIdForProvider("local", {}, { voiceId: "TX3LPaxmHKxFdv7VOQHJ" }),
    "TX3LPaxmHKxFdv7VOQHJ",
  );
});

test("markAudioGenerationFailure: records local TTS voice failures on the story", () => {
  const story = { id: "rss_bad_voice", title: "Bad local voice" };
  const failure = markAudioGenerationFailure(
    story,
    new Error("unknown voice_id='JBFqnCBsd6RMkjVDRZzb' is not registered; refusing default fallback voice"),
    { provider: "local", now: () => new Date("2026-05-13T00:00:00.000Z") },
  );

  assert.equal(failure.code, "unsafe_voice");
  assert.equal(story.qa_failed, true);
  assert.deepEqual(story.qa_failures, ["audio_generation_failed:unsafe_voice"]);
  assert.equal(story.publish_status, "failed");
  assert.match(story.publish_error, /audio_generation_failed: unsafe_voice/);
  assert.equal(story.local_tts_failure.requires_server_reset, false);
  assert.equal(story.qa_failed_at, "2026-05-13T00:00:00.000Z");
});
