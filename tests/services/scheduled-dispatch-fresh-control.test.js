"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  resolveExactScheduledDispatchBindingWithFreshControl,
} = require("../../lib/services/scheduled-dispatch-binding");

const NOW = "2026-07-28T19:00:00.000Z";

function rows() {
  return [
    {
      story_id: "primary-ready",
      platform: "youtube",
      lifecycle_state: "SCHEDULED",
      scheduled_event_id: 901,
      evidence_json: JSON.stringify({
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at:
          "2026-07-28T18:44:00.000Z",
        scheduled_for: NOW,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key:
          `youtube:primary-ready:${NOW}`,
        request_fingerprint: "a".repeat(64),
        runway_lock_sha256: "b".repeat(64),
      }),
      scheduled_event_created_at:
        "2026-07-28T18:44:00.000Z",
    },
  ];
}

test("T0 resolution uses fresh independently evidenced controls without mutating scheduled identity", () => {
  const result =
    resolveExactScheduledDispatchBindingWithFreshControl({
      rows: rows(),
      now: NOW,
      databaseDataVersion: 4,
      fresh_control: {
        verdict: "GREEN",
        checked_at: NOW,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        scheduler_owner_healthy: true,
      },
    });

  assert.equal(result.storyId, "primary-ready");
  assert.equal(result.scheduledEventId, 901);
  assert.equal(result.scheduledFor, NOW);
  assert.equal(result.runwayLockSha256, "b".repeat(64));
  assert.match(
    result.freshControlSha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(result.freshControlEvidence.checked_at, NOW);
});

test("T0 resolution fails closed on stale or incomplete fresh controls", () => {
  for (const fresh_control of [
    null,
    {
      verdict: "GREEN",
      checked_at: "2026-07-28T18:58:59.999Z",
      kill_switch_healthy: true,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
    },
    {
      verdict: "HOLD",
      checked_at: NOW,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
    },
  ]) {
    assert.throws(
      () =>
        resolveExactScheduledDispatchBindingWithFreshControl({
          rows: rows(),
          now: NOW,
          fresh_control,
        }),
      /scheduled_fresh_control_(required|stale|not_green)/,
    );
  }
});
