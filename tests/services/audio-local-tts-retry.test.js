"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  isRetryableLocalTtsError,
  requestTtsWithRetry,
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
