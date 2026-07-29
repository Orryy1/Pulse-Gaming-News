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
  assert.ok(
    blocked.blockers.includes("youtube_oauth_client_sha256_required"),
  );

  const valid = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "a".repeat(64),
    },
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.live_mutation_allowed, true);
  assert.deepEqual(valid.youtube_account_binding, {
    required: true,
    expected_oauth_client_sha256: "a".repeat(64),
  });
});

test("OAuth client binding is exact for LIVE_GUARDED and inert in LOCAL_PROOF", () => {
  const malformedLive = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "not-a-sha256",
    },
  });
  assert.equal(malformedLive.valid, false);
  assert.ok(
    malformedLive.blockers.includes(
      "youtube_oauth_client_sha256_invalid",
    ),
  );
  assert.equal(
    malformedLive.youtube_account_binding
      .expected_oauth_client_sha256,
    null,
  );

  const localProof = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "not-a-sha256",
    },
  });
  assert.equal(localProof.valid, true);
  assert.deepEqual(localProof.youtube_account_binding, {
    required: false,
    expected_oauth_client_sha256: null,
  });
});

test("YouTube is the only automated target and requires an exact governed approval basis", () => {
  const contract = resolveOperatingContract({
    env: {
      PULSE_OPERATING_MODE: "LIVE_GUARDED",
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
      PULSE_PRIMARY_INSTANCE: "true",
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "b".repeat(64),
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

  const autonomous = evaluatePlatformDispatch({
    contract,
    platform: "youtube",
    automatic: true,
    approvalType: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    autonomousLifecycleVerified: true,
    controlTowerVerdict: "GREEN",
    killSwitchHealthy: true,
  });
  assert.equal(autonomous.allowed, true);
  assert.equal(
    autonomous.approval_type,
    "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
  );

  for (const invalid of [
    {
      approvalType: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      autonomousLifecycleVerified: false,
    },
    {
      approvalType: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      autonomousLifecycleVerified: true,
      humanReviewStatus: "approved",
    },
    {
      approvalType: "SOME_OTHER_AUTOMATION",
      autonomousLifecycleVerified: true,
    },
  ]) {
    const result = evaluatePlatformDispatch({
      contract,
      platform: "youtube",
      automatic: true,
      ...invalid,
      controlTowerVerdict: "GREEN",
      killSwitchHealthy: true,
    });
    assert.equal(result.allowed, false);
  }

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
  assert.equal(
    PLATFORM_POLICY.youtube.automation,
    "governed_approval_union",
  );
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
