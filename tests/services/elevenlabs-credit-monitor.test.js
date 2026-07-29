"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildElevenLabsCreditMonitorArtifact,
} = require("../../lib/services/elevenlabs-credit-monitor");

test("credit monitoring converts a guarded subscription snapshot into safe capacity evidence", () => {
  const artifact = buildElevenLabsCreditMonitorArtifact({
    schema_version: "pulse-elevenlabs-credit-preflight-v1",
    generated_at: "2026-07-28T09:00:00.000Z",
    provider: "elevenlabs",
    tier: "pro",
    status: "active",
    used_credits: 523775,
    included_credit_limit: 921746,
    included_credits_remaining: 397971,
    remaining_percent: 43.18,
    next_reset_unix: 1785799831,
    hard_reserve_credits: 184350,
    warning_threshold_percent: 50,
    estimate_multiplier: 1.25,
    unobserved_committed_credits: 0,
    active_reserved_credits: 0,
    available_credits_before_request: 213621,
    external_overage_enabled: true,
    local_overage_allowed: false,
    current_overage_amount: "0",
    currency: "usd",
    warnings: [
      "included_credits_below_warning_threshold",
      "external_usage_based_overage_enabled_but_locally_forbidden",
    ],
    verdict: "MONITOR",
  });

  assert.equal(
    artifact.schema_version,
    "pulse-elevenlabs-credit-monitor-v1",
  );
  assert.equal(artifact.verdict, "WARN");
  assert.equal(artifact.allow_paid_synthesis, true);
  assert.equal(artifact.included_credits.remaining, 397971);
  assert.equal(artifact.included_credits.safe_spendable, 213621);
  assert.equal(artifact.included_credits.hard_reserve, 184350);
  assert.equal(artifact.capacity.short_750_characters.estimated_credits, 938);
  assert.equal(artifact.capacity.short_750_characters.safe_renders, 227);
  assert.equal(
    artifact.capacity.longform_10000_characters.estimated_credits,
    12500,
  );
  assert.equal(
    artifact.capacity.longform_10000_characters.safe_renders,
    17,
  );
  assert.equal(
    artifact.next_reset_at,
    "2026-08-03T23:30:31.000Z",
  );
  assert.ok(
    artifact.actions.includes(
      "prefer_qualified_local_tts_while_below_warning_threshold",
    ),
  );
  assert.ok(
    artifact.actions.includes(
      "keep_local_overage_hard_stop_enabled",
    ),
  );
  assert.doesNotMatch(JSON.stringify(artifact), /api.?key/i);
});

test("credit monitoring blocks paid synthesis at the hard reserve", () => {
  const artifact = buildElevenLabsCreditMonitorArtifact({
    provider: "elevenlabs",
    tier: "pro",
    status: "active",
    used_credits: 900,
    included_credit_limit: 1000,
    included_credits_remaining: 100,
    remaining_percent: 10,
    next_reset_unix: null,
    hard_reserve_credits: 100,
    warning_threshold_percent: 50,
    estimate_multiplier: 1.25,
    unobserved_committed_credits: 0,
    active_reserved_credits: 0,
    available_credits_before_request: 0,
    external_overage_enabled: false,
    local_overage_allowed: false,
    current_overage_amount: "0",
    currency: "usd",
    warnings: ["included_credits_below_warning_threshold"],
  });

  assert.equal(artifact.verdict, "BLOCKED");
  assert.equal(artifact.allow_paid_synthesis, false);
  assert.deepEqual(artifact.capacity, {
    short_750_characters: {
      estimated_credits: 938,
      safe_renders: 0,
    },
    longform_10000_characters: {
      estimated_credits: 12500,
      safe_renders: 0,
    },
  });
  assert.ok(
    artifact.actions.includes(
      "paid_tts_blocked_use_qualified_local_tts_or_wait_for_reset",
    ),
  );
});
