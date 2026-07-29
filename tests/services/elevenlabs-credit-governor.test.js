"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  createElevenLabsCreditGovernor,
  ElevenLabsCreditGuardError,
} = require("../../lib/services/elevenlabs-credit-governor");

function subscription(overrides = {}) {
  return {
    tier: "pro",
    status: "active",
    character_count: 523775,
    character_limit: 921746,
    next_character_count_reset_unix: 1785799831,
    max_credit_limit_extension: "unlimited",
    current_overage: { amount: "0", currency: "usd" },
    ...overrides,
  };
}

function requestReturning(value, calls = []) {
  return async (input) => {
    calls.push(input);
    return { status: 200, data: value };
  };
}

function stateEnv(t, values = {}) {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-elevenlabs-governor-"),
  );
  t.after(() =>
    fs.rmSync(stateRoot, { recursive: true, force: true }),
  );
  return { PULSE_STATE_ROOT: stateRoot, ...values };
}

test("credit preflight reports the live included allowance, warns below threshold and never exposes the API key", async (t) => {
  const calls = [];
  const governor = createElevenLabsCreditGovernor({
    env: stateEnv(t, {
      ELEVENLABS_API_KEY: "secret-test-key",
      ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
      ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
      ELEVENLABS_CREDIT_WARNING_PERCENT: "50",
    }),
    request: requestReturning(subscription(), calls),
    now: () => Date.parse("2026-07-28T09:00:00.000Z"),
  });

  const lease = await governor.preflight({
    text: "x".repeat(100),
    purpose: "weekly_longform_narration",
    idempotencyKey: "weekly-2026-W31",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(
    calls[0].url,
    "https://api.elevenlabs.io/v1/user/subscription",
  );
  assert.equal(calls[0].headers["xi-api-key"], "secret-test-key");
  assert.equal(lease.report.schema_version, "pulse-elevenlabs-credit-preflight-v1");
  assert.equal(lease.report.tier, "pro");
  assert.equal(lease.report.status, "active");
  assert.equal(lease.report.used_credits, 523775);
  assert.equal(lease.report.included_credit_limit, 921746);
  assert.equal(lease.report.included_credits_remaining, 397971);
  assert.equal(lease.report.remaining_percent, 43.18);
  assert.equal(lease.report.estimated_request_credits, 100);
  assert.equal(lease.report.hard_reserve_credits, 184350);
  assert.equal(lease.report.external_overage_enabled, true);
  assert.equal(lease.report.local_overage_allowed, false);
  assert.deepEqual(lease.report.warnings, [
    "included_credits_below_warning_threshold",
    "external_usage_based_overage_enabled_but_locally_forbidden",
  ]);
  assert.doesNotMatch(JSON.stringify(lease.report), /secret-test-key/);

  await lease.markProviderCallStarted();
  const status = await governor.status();
  assert.equal(status.unobserved_committed_credits, 100);
  assert.equal(status.active_reserved_credits, 0);
});

test("credit preflight blocks a request that would cross the local reserve even when account overage is unlimited", async (t) => {
  const governor = createElevenLabsCreditGovernor({
    env: stateEnv(t, {
      ELEVENLABS_API_KEY: "secret-test-key",
      ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
      ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
      ELEVENLABS_ALLOW_OVERAGE: "true",
    }),
    request: requestReturning(
      subscription({
        character_count: 700,
        character_limit: 1000,
      }),
    ),
  });

  await assert.rejects(
    () =>
      governor.preflight({
        text: "x".repeat(101),
        purpose: "short_narration",
        idempotencyKey: "short-1",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_reserve_would_be_crossed" &&
      error.details.included_credits_remaining === 300 &&
      error.details.hard_reserve_credits === 200 &&
      error.details.estimated_request_credits === 101,
  );
  const status = await governor.status();
  assert.equal(status.local_overage_allowed, false);
  assert.ok(
    status.warnings.includes(
      "local_overage_request_ignored_fail_closed",
    ),
  );
});

test("active reservations and committed requests cannot race past the hard reserve", async (t) => {
  const governor = createElevenLabsCreditGovernor({
    env: stateEnv(t, {
      ELEVENLABS_API_KEY: "secret-test-key",
      ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
      ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
      ELEVENLABS_CREDIT_SNAPSHOT_TTL_MS: "60000",
    }),
    request: requestReturning(
      subscription({
        character_count: 500,
        character_limit: 1000,
      }),
    ),
  });

  const first = await governor.preflight({
    text: "x".repeat(250),
    purpose: "narration",
    idempotencyKey: "first",
  });
  await assert.rejects(
    () =>
      governor.preflight({
        text: "x".repeat(51),
        purpose: "narration",
        idempotencyKey: "second",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_reserve_would_be_crossed",
  );

  await first.release();
  const second = await governor.preflight({
    text: "x".repeat(51),
    purpose: "narration",
    idempotencyKey: "second",
  });
  await second.markProviderCallStarted();

  const third = await governor.preflight({
    text: "x".repeat(249),
    purpose: "narration",
    idempotencyKey: "third",
  });
  await third.markProviderCallStarted();
  await assert.rejects(
    () =>
      governor.preflight({
        text: "x",
        purpose: "narration",
        idempotencyKey: "fourth",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_reserve_would_be_crossed",
  );
});

test("a completed idempotency key replays its durable result without another provider call", async (t) => {
  const governor = createElevenLabsCreditGovernor({
    env: stateEnv(t, {
      ELEVENLABS_API_KEY: "secret-test-key",
      ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
      ELEVENLABS_CREDIT_RESERVE_PERCENT: "10",
    }),
    request: requestReturning(
      subscription({
        character_count: 100,
        character_limit: 1000,
      }),
    ),
  });
  const first = await governor.preflight({
    text: "Pulse",
    purpose: "narration",
    idempotencyKey: "same-render",
  });
  await first.markProviderCallStarted();
  await first.recordProviderSuccess({ audio_base64: "YXVkaW8=" });
  await first.complete();

  const replay = await governor.preflight({
    text: "Pulse",
    purpose: "narration",
    idempotencyKey: "same-render",
  });
  assert.equal(replay.replayAvailable, true);
  assert.equal(replay.requiresProviderCall, false);
  assert.deepEqual(await replay.readRecordedProviderResult(), {
    audio_base64: "YXVkaW8=",
  });
});

test("a refreshed account count reconciles locally committed estimates without double counting", async (t) => {
  let currentTime = 1000;
  const responses = [
    subscription({ character_count: 500, character_limit: 1000 }),
    subscription({ character_count: 750, character_limit: 1000 }),
  ];
  const governor = createElevenLabsCreditGovernor({
    env: stateEnv(t, {
      ELEVENLABS_API_KEY: "secret-test-key",
      ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER: "1",
      ELEVENLABS_CREDIT_RESERVE_PERCENT: "20",
      ELEVENLABS_CREDIT_SNAPSHOT_TTL_MS: "100",
    }),
    request: async () => ({
      status: 200,
      data: responses.shift(),
    }),
    now: () => currentTime,
  });
  const first = await governor.preflight({
    text: "x".repeat(250),
    purpose: "narration",
    idempotencyKey: "first",
  });
  await first.markProviderCallStarted();
  currentTime += 101;

  const second = await governor.preflight({
    text: "x".repeat(40),
    purpose: "narration",
    idempotencyKey: "second",
  });
  assert.equal(second.report.unobserved_committed_credits, 0);
  assert.equal(second.report.available_credits_before_request, 50);
  await second.release();
});

test("credit monitoring fails closed on missing credentials and invalid subscription responses", async (t) => {
  const missingKey = createElevenLabsCreditGovernor({
    env: stateEnv(t),
    request: async () => {
      throw new Error("must_not_call");
    },
  });
  await assert.rejects(
    () =>
      missingKey.preflight({
        text: "Pulse",
        purpose: "narration",
        idempotencyKey: "missing-key",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_guard_api_key_missing",
  );

  const invalidResponse = createElevenLabsCreditGovernor({
    env: stateEnv(t, { ELEVENLABS_API_KEY: "secret-test-key" }),
    request: async () => ({ status: 503, data: { detail: "unavailable" } }),
  });
  await assert.rejects(
    () =>
      invalidResponse.preflight({
        text: "Pulse",
        purpose: "narration",
        idempotencyKey: "invalid-response",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_snapshot_unavailable",
  );
});

test("credit preflight fails closed when the subscription response omits its status", async (t) => {
  const governor = createElevenLabsCreditGovernor({
    env: stateEnv(t, { ELEVENLABS_API_KEY: "secret-test-key" }),
    request: requestReturning(
      subscription({
        status: undefined,
        character_count: 0,
        character_limit: 1000,
      }),
    ),
  });

  await assert.rejects(
    () =>
      governor.preflight({
        text: "Pulse",
        purpose: "narration",
        idempotencyKey: "missing-subscription-status",
      }),
    (error) =>
      error instanceof ElevenLabsCreditGuardError &&
      error.code === "elevenlabs_credit_snapshot_unavailable",
  );
});
