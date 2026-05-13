"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  generateTtsForStory,
  isLocalTtsProvider,
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

test("isLocalTtsProvider: only true for explicit local provider", () => {
  assert.equal(isLocalTtsProvider("local"), true);
  assert.equal(isLocalTtsProvider("LOCAL"), true);
  assert.equal(isLocalTtsProvider("elevenlabs"), false);
});

test("generateTtsForStory: server_down triggers one recovery then keeps the successful MP3", async () => {
  const story = { id: "rss_recover_tts" };
  let calls = 0;
  let recoveries = 0;

  const attempt = await generateTtsForStory({
    story,
    text: "Pulse Gaming local TTS recovery test.",
    outputPath: "output/audio/rss_recover_tts.mp3",
    provider: "local",
    generateTts: async () => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("connect ECONNREFUSED 127.0.0.1:8765");
        err.code = "ECONNREFUSED";
        throw err;
      }
    },
    recoverLocalTts: async (context) => {
      recoveries += 1;
      assert.equal(context.storyId, "rss_recover_tts");
      assert.equal(context.failure.code, "server_down");
      return { ok: true, action: "start+prewarm" };
    },
  });

  assert.equal(calls, 2);
  assert.equal(recoveries, 1);
  assert.equal(attempt.ok, true);
  assert.equal(attempt.attempts, 2);
  assert.equal(story.local_tts_attempts.length, 1);
  assert.equal(story.local_tts_attempts[0].ok, true);
  assert.equal(story.local_tts_attempts[0].recovery.action, "start+prewarm");
});

test("generateTtsForStory: unsafe voice does not attempt server recovery", async () => {
  const story = { id: "rss_bad_voice" };
  let recoveries = 0;

  await assert.rejects(
    generateTtsForStory({
      story,
      text: "Bad voice must fail closed.",
      outputPath: "output/audio/rss_bad_voice.mp3",
      provider: "local",
      generateTts: async () => {
        throw new Error("unknown voice_id='bad' is not registered; refusing default fallback voice");
      },
      recoverLocalTts: async () => {
        recoveries += 1;
        return { ok: true };
      },
    }),
    /local_tts_generation_failed:unsafe_voice/,
  );

  assert.equal(recoveries, 0);
  assert.equal(story.local_tts_attempts.length, 1);
  assert.equal(story.local_tts_attempts[0].failure_code, "unsafe_voice");
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
