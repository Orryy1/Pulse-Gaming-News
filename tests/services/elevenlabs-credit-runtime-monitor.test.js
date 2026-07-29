"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createElevenLabsCreditRuntimeMonitor,
} = require("../../lib/services/elevenlabs-credit-runtime-monitor");

function activeSubscription(overrides = {}) {
  return {
    status: 200,
    data: {
      tier: "pro",
      status: "active",
      character_count: 523775,
      character_limit: 921746,
      next_character_count_reset_unix: 1785799831,
      max_credit_limit_extension: "unlimited",
      current_overage: { amount: "0", currency: "usd" },
      ...overrides,
    },
  };
}

test("the runtime monitor performs one read-only startup refresh, persists safe evidence and schedules four-hour checks", async () => {
  const outputRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-runtime-monitor-"),
  );
  const requests = [];
  const timers = [];
  const monitor = createElevenLabsCreditRuntimeMonitor({
    env: {
      ELEVENLABS_API_KEY: "must-not-leak",
      PULSE_STATE_ROOT: path.join(outputRoot, "state"),
    },
    outputRoot,
    request: async (input) => {
      requests.push(input);
      return activeSubscription();
    },
    setIntervalFn(callback, intervalMs) {
      const handle = {
        callback,
        intervalMs,
        unrefCalled: false,
        unref() {
          this.unrefCalled = true;
        },
      };
      timers.push(handle);
      return handle;
    },
    clearIntervalFn() {},
    now: () => Date.parse("2026-07-28T09:00:00.000Z"),
    log() {},
  });

  try {
    const health = await monitor.start();
    const jsonPath = path.join(
      outputRoot,
      "elevenlabs-credit-status.json",
    );
    const markdownPath = path.join(
      outputRoot,
      "elevenlabs-credit-status.md",
    );
    const artifact = JSON.parse(await fs.readFile(jsonPath, "utf8"));
    const markdown = await fs.readFile(markdownPath, "utf8");

    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(
      requests[0].url,
      "https://api.elevenlabs.io/v1/user/subscription",
    );
    assert.equal(requests[0].data, undefined);
    assert.equal(timers.length, 1);
    assert.equal(timers[0].intervalMs, 4 * 60 * 60 * 1000);
    assert.equal(timers[0].unrefCalled, true);
    assert.equal(artifact.verdict, "WARN");
    assert.equal(artifact.allow_paid_synthesis, true);
    assert.equal(artifact.monitoring.trigger, "startup");
    assert.equal(artifact.monitoring.state_changed, false);
    assert.equal(health.active, true);
    assert.equal(health.verdict, "WARN");
    assert.equal(health.included_credits_remaining, 397971);
    assert.equal(health.safe_spendable_credits, 213621);
    assert.match(markdown, /# ElevenLabs credit status/);
    assert.doesNotMatch(
      JSON.stringify({ artifact, health, markdown }),
      /must-not-leak|xi-api-key/i,
    );
  } finally {
    await monitor.stop();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});

test("the runtime monitor fails closed and still schedules recovery after a subscription refresh failure", async () => {
  const outputRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-runtime-failure-"),
  );
  let requestCount = 0;
  let scheduledCallback = null;
  const monitor = createElevenLabsCreditRuntimeMonitor({
    env: {
      PULSE_STATE_ROOT: path.join(outputRoot, "state"),
    },
    outputRoot,
    request: async () => {
      requestCount += 1;
      return activeSubscription();
    },
    setIntervalFn(callback) {
      scheduledCallback = callback;
      return { unref() {} };
    },
    clearIntervalFn() {},
    now: () => Date.parse("2026-07-28T10:00:00.000Z"),
    log() {},
  });

  try {
    const health = await monitor.start();
    const artifact = JSON.parse(
      await fs.readFile(
        path.join(outputRoot, "elevenlabs-credit-status.json"),
        "utf8",
      ),
    );
    const files = await fs.readdir(outputRoot);

    assert.equal(requestCount, 0);
    assert.equal(typeof scheduledCallback, "function");
    assert.equal(artifact.verdict, "BLOCKED");
    assert.equal(artifact.allow_paid_synthesis, false);
    assert.equal(
      artifact.monitoring.last_error_code,
      "elevenlabs_credit_guard_api_key_missing",
    );
    assert.equal(health.verdict, "BLOCKED");
    assert.equal(health.allow_paid_synthesis, false);
    assert.equal(
      health.last_error_code,
      "elevenlabs_credit_guard_api_key_missing",
    );
    assert.deepEqual(
      files.sort(),
      [
        "elevenlabs-credit-status.json",
        "elevenlabs-credit-status.md",
      ],
    );
    assert.doesNotMatch(JSON.stringify({ artifact, health }), /stack|path/i);
  } finally {
    await monitor.stop();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});

test("optional alerts are deduplicated by threshold state and fire only on a transition", async () => {
  const outputRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-elevenlabs-runtime-transition-"),
  );
  const responses = [
    activeSubscription(),
    activeSubscription({ character_count: 524000 }),
    activeSubscription({ character_count: 800000 }),
    activeSubscription({ character_count: 800100 }),
  ];
  const alerts = [];
  const monitor = createElevenLabsCreditRuntimeMonitor({
    env: {
      ELEVENLABS_API_KEY: "must-not-leak",
      PULSE_STATE_ROOT: path.join(outputRoot, "state"),
      ELEVENLABS_CREDIT_MONITOR_DISCORD_ALERTS: "true",
    },
    outputRoot,
    request: async () => responses.shift(),
    notify: async (message) => alerts.push(message),
    setIntervalFn() {
      return { unref() {} };
    },
    clearIntervalFn() {},
    now: () => Date.parse("2026-07-28T11:00:00.000Z"),
    log() {},
  });

  try {
    await monitor.start();
    await monitor.refreshNow("test_same_threshold");
    assert.equal(alerts.length, 0);

    await monitor.refreshNow("test_crossed_reserve");
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /ElevenLabs credit state changed/i);
    assert.match(alerts[0], /WARN.*BLOCKED/i);
    assert.doesNotMatch(alerts[0], /must-not-leak|api.?key|xi-api-key/i);

    await monitor.refreshNow("test_same_blocked_threshold");
    assert.equal(alerts.length, 1);
  } finally {
    await monitor.stop();
    await fs.rm(outputRoot, { recursive: true, force: true });
  }
});
