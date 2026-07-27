"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  OPERATING_MODES,
  PLATFORM_POLICY,
  resolveOperatingContract,
  evaluatePlatformDispatch,
  evaluateStoryHumanReview,
} = require("../../lib/stabilisation/operating-contract");

test("stabilisation contract exposes only the three authoritative operating modes", () => {
  assert.deepEqual(OPERATING_MODES, [
    "LOCAL_PROOF",
    "HUMAN_REVIEW",
    "LIVE_GUARDED",
  ]);
});

test("unset mode fails closed to LOCAL_PROOF", () => {
  const contract = resolveOperatingContract({ env: {} });

  assert.equal(contract.mode, "LOCAL_PROOF");
  assert.equal(contract.live_mutation_allowed, false);
  assert.equal(contract.valid, true);
});

test("unknown modes and contradictory legacy auto-publish flags are refused", () => {
  const unknown = resolveOperatingContract({
    env: { PULSE_OPERATING_MODE: "AUTO_PUBLISH_EVERYWHERE" },
  });
  assert.equal(unknown.valid, false);
  assert.ok(unknown.blockers.includes("unknown_operating_mode"));

  const contradictory = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "HUMAN_REVIEW",
      AUTO_PUBLISH: "true",
    },
  });
  assert.equal(contradictory.valid, false);
  assert.ok(
    contradictory.blockers.includes(
      "legacy_auto_publish_contradicts_operating_mode",
    ),
  );
});

test("LIVE_GUARDED requires the guarded arm, queue, SQLite and explicit primary", () => {
  const blocked = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
    },
  });
  assert.equal(blocked.valid, false);
  assert.ok(blocked.blockers.includes("guarded_live_dispatch_not_armed"));
  assert.ok(blocked.blockers.includes("durable_queue_required"));
  assert.ok(blocked.blockers.includes("sqlite_required"));
  assert.ok(blocked.blockers.includes("explicit_primary_required"));

  const valid = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.live_mutation_allowed, true);
});

test("YouTube is the only automated stabilisation target and still requires all human safety evidence", () => {
  const contract = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
    },
  });

  const blocked = evaluatePlatformDispatch({
    contract,
    platform: "youtube",
    automatic: true,
    humanReviewStatus: "pending",
    controlTowerVerdict: "GREEN",
    killSwitchHealthy: true,
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes("human_review_not_approved"));

  const allowed = evaluatePlatformDispatch({
    contract,
    platform: "youtube",
    automatic: true,
    humanReviewStatus: "approved",
    controlTowerVerdict: "GREEN",
    killSwitchHealthy: true,
  });
  assert.equal(allowed.allowed, true);

  for (const platform of [
    "instagram",
    "facebook",
    "tiktok",
    "x",
    "threads",
    "pinterest",
  ]) {
    const result = evaluatePlatformDispatch({
      contract,
      platform,
      automatic: true,
      humanReviewStatus: "approved",
      controlTowerVerdict: "GREEN",
      killSwitchHealthy: true,
    });
    assert.equal(result.allowed, false, platform);
  }
});

test("platform policy encodes the 30-day freeze rather than hiding disabled adapters", () => {
  assert.equal(PLATFORM_POLICY.youtube.automation, "human_review_only");
  assert.equal(PLATFORM_POLICY.instagram.automation, "disabled");
  assert.equal(PLATFORM_POLICY.facebook.automation, "disabled");
  assert.equal(PLATFORM_POLICY.tiktok.automation, "manual_only");
  assert.equal(PLATFORM_POLICY.x.visible, true);
  assert.equal(PLATFORM_POLICY.threads.visible, true);
  assert.equal(PLATFORM_POLICY.pinterest.visible, true);
});

test("every stabilisation story requires an explicit approved human review stamp", () => {
  assert.equal(evaluateStoryHumanReview({ approved: true }).approved, false);
  assert.equal(
    evaluateStoryHumanReview({ render_review_status: "approved" }).approved,
    true,
  );
  assert.equal(
    evaluateStoryHumanReview({ human_review_status: "rejected" }).approved,
    false,
  );
});
