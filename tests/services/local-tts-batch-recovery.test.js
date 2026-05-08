"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  createLocalTtsBatchRecovery,
} = require("../../lib/ops/local-tts-batch-recovery");

const SAFE_HEALTH = {
  ok: true,
  status: "ok",
  phase: "ready",
  ready: true,
  voice: {
    alias: "liam",
    loaded: true,
    refResolved: true,
    reference: {
      id: "pulse-sleepy-liam-20260502",
      fileName: "sleepy_liam_reference.wav",
      referenceHash: "accepted",
      referencePresent: true,
    },
  },
};

function safety(summary) {
  return summary === SAFE_HEALTH
    ? { safe: true, code: null, message: "ready" }
    : { safe: false, code: "server_down", message: "not ready" };
}

test("local TTS batch recovery starts the local server when health is unreachable", async () => {
  const calls = [];
  const recover = createLocalTtsBatchRecovery({
    root: "C:/repo",
    voiceId: "voice",
    fetchHealth: async () => {
      calls.push("fetch");
      return { status: "unreachable", ready: false, voice: {} };
    },
    startServer: async () => {
      calls.push("start");
      return { pid: 1234, spec: { stdoutPath: "stdout.log", stderrPath: "stderr.log" } };
    },
    waitForHealth: async () => {
      calls.push("wait");
      return SAFE_HEALTH;
    },
    classifySafety: safety,
  });

  const result = await recover({
    storyId: "rss_retry",
    failure: { code: "server_down" },
  });

  assert.deepEqual(calls, ["fetch", "start", "wait"]);
  assert.equal(result.ok, true);
  assert.equal(result.action, "start");
  assert.equal(result.started.pid, 1234);
  assert.equal(result.after.status, "ok");
});

test("local TTS batch recovery prewarms the accepted voice when server is live but unloaded", async () => {
  const calls = [];
  const unloaded = {
    ok: false,
    status: "ok",
    phase: "ready",
    ready: true,
    voice: {
      alias: "liam",
      loaded: false,
      refResolved: true,
      reference: { id: "pulse-sleepy-liam-20260502", referencePresent: true },
    },
  };
  const recover = createLocalTtsBatchRecovery({
    voiceId: "voice",
    fetchHealth: async () => {
      calls.push("fetch");
      return calls.length === 1 ? unloaded : SAFE_HEALTH;
    },
    prewarmVoice: async () => {
      calls.push("prewarm");
      return { ok: true, reused: false, loadedMs: 50 };
    },
    classifySafety: safety,
  });

  const result = await recover({
    storyId: "rss_retry",
    failure: { code: "voice_not_loaded" },
  });

  assert.deepEqual(calls, ["fetch", "prewarm", "fetch"]);
  assert.equal(result.ok, true);
  assert.equal(result.action, "prewarm");
  assert.equal(result.prewarm.loadedMs, 50);
});

test("local TTS batch recovery reports unsafe final state without hiding the failure", async () => {
  const recover = createLocalTtsBatchRecovery({
    voiceId: "voice",
    fetchHealth: async () => ({ status: "ok", ready: false, voice: {} }),
    classifySafety: () => ({ safe: false, code: "unsafe_voice", message: "wrong voice" }),
  });

  const result = await recover({
    storyId: "rss_retry",
    failure: { code: "connection_reset" },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failure_code, "unsafe_voice");
  assert.match(result.failure_message, /wrong voice/);
});
