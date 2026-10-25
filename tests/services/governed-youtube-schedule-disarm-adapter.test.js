"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assertRemoteDisarmAuthority,
  disarmExactGovernedYoutubeScheduledRelease,
} = require("../../lib/services/governed-youtube-publisher-adapter");

const STORY_ID = "exact-disarm-story";
const CHANNEL_ID = "pulse-gaming";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const NOW = new Date("2026-07-28T18:30:00.000Z");
const REQUEST_FINGERPRINT = "a".repeat(64);
const RUNWAY_LOCK_SHA256 = "b".repeat(64);
const MEDIA_SHA256 = "c".repeat(64);
const SCRIPT_SHA256 = "d".repeat(64);
const DISPATCH_KEY = `youtube:${STORY_ID}:${SCHEDULED_FOR}`;
const EXTERNAL_ID = "youtube-scheduled-object-1";

function exactBinding(overrides = {}) {
  return {
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    platform: "youtube",
    scheduled_event_id: 42,
    scheduled_for: SCHEDULED_FOR,
    dispatch_idempotency_key: DISPATCH_KEY,
    request_fingerprint: REQUEST_FINGERPRINT,
    runway_lock_sha256: RUNWAY_LOCK_SHA256,
    media_sha256: MEDIA_SHA256,
    script_sha256: SCRIPT_SHA256,
    ...overrides,
  };
}

function scheduledEvent() {
  return {
    id: 42,
    story_id: STORY_ID,
    platform: "youtube",
    to_state: "SCHEDULED",
    evidence_json: JSON.stringify({
      channel_id: CHANNEL_ID,
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at:
        "2026-07-28T17:50:00.000Z",
      scheduled_for: SCHEDULED_FOR,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: DISPATCH_KEY,
      request_fingerprint: REQUEST_FINGERPRINT,
      runway_lock_sha256: RUNWAY_LOCK_SHA256,
      publication_evidence: {
        schema_version: "pulse-publication-evidence-v1",
      },
    }),
  };
}

function disarmProof(overrides = {}) {
  return {
    confirmed: true,
    alreadyDisarmed: false,
    externalId: EXTERNAL_ID,
    externalUrl:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    verifiedAt: "2026-07-28T18:30:05.000Z",
    evidence: {
      schema_version: "pulse-youtube-schedule-disarm-proof-v1",
      platform_object_confirmed: true,
      schedule_disarm_confirmed: true,
      external_id: EXTERNAL_ID,
      privacy_status: "private",
      publish_at: null,
      checked_at: "2026-07-28T18:30:05.000Z",
      already_disarmed: false,
      update_attempt_started: true,
    },
    ...overrides,
  };
}

function leaseRunner(calls) {
  return async (input) => {
    calls.operation = input.operation;
    return input.task({
      assertHealthy() {
        calls.leaseAssertions += 1;
        return true;
      },
    });
  };
}

function fixture({
  lifecycleState = "PLATFORM_SCHEDULED",
} = {}) {
  const calls = {
    auth: 0,
    authority: [],
    blocked: 0,
    confirmed: 0,
    disarmer: 0,
    failed: 0,
    leaseAssertions: 0,
    reconciliation: 0,
    requested: 0,
    storyIds: [],
    updatesMarked: 0,
  };
  let state = {
    lifecycle_state: lifecycleState,
    external_id: EXTERNAL_ID,
    external_url:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
  };
  const governance = {
    getLatestLifecycleEvent(_storyId, _platform, targetState) {
      if (targetState === "SCHEDULED") return scheduledEvent();
      if (
        targetState === "PLATFORM_SCHEDULE_DISARMED" &&
        state.lifecycle_state === "PLATFORM_SCHEDULE_DISARMED"
      ) {
        return {
          id: 99,
          story_id: STORY_ID,
          platform: "youtube",
          to_state: "PLATFORM_SCHEDULE_DISARMED",
          evidence_json: JSON.stringify(disarmProof().evidence),
        };
      }
      return null;
    },
    getState() {
      return state;
    },
    assertPlatformScheduledBinding(input) {
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.externalId, EXTERNAL_ID);
      assert.equal(input.requestFingerprint, REQUEST_FINGERPRINT);
      return {
        storyId: STORY_ID,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        requestFingerprint: REQUEST_FINGERPRINT,
        runwayLockSha256: RUNWAY_LOCK_SHA256,
        scheduledEventId: 42,
        platformScheduledEventId: 77,
      };
    },
    recordScheduledPlatformDisarmRequested(input) {
      calls.requested += 1;
      assert.equal(
        input.disarmEvidence.schedule_disarm_requested,
        true,
      );
      assert.equal(
        input.disarmEvidence.authority.verdict,
        "DISARM_AUTHORISED",
      );
      return { id: 80 };
    },
    recordScheduledPlatformDisarmed(input) {
      calls.confirmed += 1;
      assert.equal(
        input.verificationEvidence.schedule_disarm_confirmed,
        true,
      );
      state = {
        ...state,
        lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
        verification_status: "confirmed_private_unscheduled",
      };
      return state;
    },
    recordScheduledPlatformDisarmReconciliationRequired(input) {
      calls.reconciliation += 1;
      assert.equal(input.externalId, EXTERNAL_ID);
      state = {
        ...state,
        lifecycle_state: "RECONCILIATION_REQUIRED",
      };
      return state;
    },
  };
  const platformPost = {
    id: 7,
    story_id: STORY_ID,
    platform: "youtube",
    external_id: EXTERNAL_ID,
    external_url:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    status: "uploading",
  };
  const transaction = (callback) => {
    const wrapped = () => callback();
    wrapped.immediate = wrapped;
    return wrapped;
  };
  const repos = {
    db: { transaction },
    stories: {
      get(id) {
        calls.storyIds.push(id);
        return {
          id: STORY_ID,
          channel_id: CHANNEL_ID,
        };
      },
    },
    platformPosts: {
      getByStoryPlatform() {
        return platformPost;
      },
      markBlocked(id, reason) {
        calls.blocked += 1;
        assert.equal(id, platformPost.id);
        assert.equal(
          reason,
          "youtube_remote_schedule_disarmed",
        );
        return {
          ...platformPost,
          status: "blocked",
          block_reason: reason,
        };
      },
      markFailed(id, error, identity) {
        calls.failed += 1;
        assert.equal(id, platformPost.id);
        assert.equal(identity.externalId, EXTERNAL_ID);
        return {
          ...platformPost,
          status: "failed",
          error_message: error.message,
        };
      },
    },
    publicationGovernance: governance,
    runtimeLeases: {},
  };
  return { calls, governance, repos };
}

function healthyDisarmAuthority(calls) {
  return ({ phase }) => {
    calls.authority.push(phase);
    return {
      verdict: "DISARM_AUTHORISED",
      checked_at: NOW.toISOString(),
      kill_switch_healthy: false,
      scheduler_owner_healthy: true,
    };
  };
}

test("publisher disarm adapter fences the exact scheduled object, rechecks authority at update and persists requested plus confirmed proof atomically", async () => {
  const context = fixture();
  const youtubeClient = { videos: { list() {}, update() {} } };
  let candidate = null;
  const result =
    await disarmExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      reason: "fresh_control_hold_before_commitment",
      repos: context.repos,
      now: () => NOW,
      runWithPublisherLease: leaseRunner(context.calls),
      assertRemoteDisarmAuthority:
        healthyDisarmAuthority(context.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        context.calls.auth += 1;
        return youtubeClient;
      },
      createYoutubeScheduledObjectDisarmer(input) {
        assert.equal(input.youtubeClient, youtubeClient);
        return async (value) => {
          context.calls.disarmer += 1;
          candidate = value;
          await value.assertUpdateBoundary();
          value.markUpdateAttemptStarted();
          context.calls.updatesMarked += 1;
          return disarmProof();
        };
      },
      uploadShort() {
        throw new Error("remote_disarm_must_never_upload");
      },
    });

  assert.equal(result.status, "platform_schedule_disarmed");
  assert.equal(result.disarmed, true);
  assert.equal(result.externalId, EXTERNAL_ID);
  assert.equal(
    context.calls.operation,
    "disarm_governed_youtube_scheduled_release",
  );
  assert.deepEqual(context.calls.authority, [
    "entry",
    "update_boundary",
  ]);
  assert.deepEqual(context.calls.storyIds, [
    STORY_ID,
    STORY_ID,
  ]);
  assert.equal(context.calls.requested, 1);
  assert.equal(context.calls.confirmed, 1);
  assert.equal(context.calls.reconciliation, 0);
  assert.equal(context.calls.blocked, 1);
  assert.equal(context.calls.failed, 0);
  assert.equal(context.calls.auth, 1);
  assert.equal(context.calls.disarmer, 1);
  assert.equal(context.calls.updatesMarked, 1);
  assert.equal(candidate.externalId, EXTERNAL_ID);
  assert.equal(candidate.scheduledFor, SCHEDULED_FOR);
});

test("uncertain update is durably reconciliation-required and exposes safe exact failure fields without replacement upload", async () => {
  const context = fixture();
  const uncertain = Object.assign(
    new Error("youtube_schedule_disarm_update_uncertain"),
    {
      code: "youtube_schedule_disarm_update_uncertain",
      externalId: EXTERNAL_ID,
      platformContacted: true,
      updateAttemptStarted: true,
      reconciliationRequired: true,
    },
  );

  await assert.rejects(
    disarmExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      reason: "fresh_control_hold_before_commitment",
      repos: context.repos,
      now: () => NOW,
      runWithPublisherLease: leaseRunner(context.calls),
      assertRemoteDisarmAuthority:
        healthyDisarmAuthority(context.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {}, update() {} } };
      },
      createYoutubeScheduledObjectDisarmer() {
        return async (value) => {
          await value.assertUpdateBoundary();
          value.markUpdateAttemptStarted();
          throw uncertain;
        };
      },
      uploadShort() {
        throw new Error("remote_disarm_must_never_upload");
      },
    }),
    (error) => {
      assert.equal(error, uncertain);
      assert.equal(error.platformContacted, true);
      assert.equal(error.createAttemptStarted, false);
      assert.equal(error.updateAttemptStarted, true);
      assert.equal(error.externalId, EXTERNAL_ID);
      return true;
    },
  );

  assert.equal(context.calls.requested, 1);
  assert.equal(context.calls.confirmed, 0);
  assert.equal(context.calls.reconciliation, 1);
  assert.equal(context.calls.failed, 1);
  assert.equal(context.calls.blocked, 0);
});

test("durably confirmed PLATFORM_SCHEDULE_DISARMED replay is a no-auth no-update no-op", async () => {
  const context = fixture({
    lifecycleState: "PLATFORM_SCHEDULE_DISARMED",
  });

  const result =
    await disarmExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      reason: "fresh_control_hold_before_commitment",
      repos: context.repos,
      now: () => NOW,
      runWithPublisherLease: leaseRunner(context.calls),
      assertRemoteDisarmAuthority:
        healthyDisarmAuthority(context.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        throw new Error("confirmed_disarm_replay_must_not_auth");
      },
      createYoutubeScheduledObjectDisarmer() {
        throw new Error(
          "confirmed_disarm_replay_must_not_build_remote_mutator",
        );
      },
    });

  assert.equal(result.status, "platform_schedule_disarmed");
  assert.equal(result.reused, true);
  assert.equal(result.externalId, EXTERNAL_ID);
  assert.equal(context.calls.requested, 0);
  assert.equal(context.calls.auth, 0);
  assert.deepEqual(context.calls.authority, ["entry"]);
});

test("reconciliation replay that observes the exact object already private and unscheduled confirms without another update", async () => {
  const context = fixture({
    lifecycleState: "RECONCILIATION_REQUIRED",
  });

  const result =
    await disarmExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      reason: "fresh_control_hold_before_commitment",
      repos: context.repos,
      now: () => NOW,
      runWithPublisherLease: leaseRunner(context.calls),
      assertRemoteDisarmAuthority:
        healthyDisarmAuthority(context.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {}, update() {} } };
      },
      createYoutubeScheduledObjectDisarmer() {
        return async () =>
          disarmProof({
            alreadyDisarmed: true,
            evidence: {
              ...disarmProof().evidence,
              already_disarmed: true,
              update_attempt_started: false,
            },
          });
      },
    });

  assert.equal(result.disarmed, true);
  assert.equal(result.alreadyDisarmed, true);
  assert.equal(context.calls.requested, 1);
  assert.equal(context.calls.confirmed, 1);
  assert.deepEqual(context.calls.authority, ["entry"]);
});

test("platform scheduled identity mismatch fails before OAuth, request evidence or remote mutation", async () => {
  const context = fixture();
  context.governance.assertPlatformScheduledBinding = () => {
    throw new Error(
      "platform_scheduled_request_fingerprint_mismatch",
    );
  };
  let auth = 0;

  await assert.rejects(
    disarmExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      reason: "fresh_control_hold_before_commitment",
      repos: context.repos,
      now: () => NOW,
      runWithPublisherLease: leaseRunner(context.calls),
      assertRemoteDisarmAuthority:
        healthyDisarmAuthority(context.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        auth += 1;
      },
    }),
    /platform_scheduled_request_fingerprint_mismatch/,
  );

  assert.equal(auth, 0);
  assert.equal(context.calls.requested, 0);
  assert.equal(context.calls.confirmed, 0);
});

test("emergency disarm remains authorised and succeeds when publish, scheduler, kill-switch and operating-mode health are all unavailable", async () => {
  const context = fixture();
  const env = {
    AUTO_PUBLISH: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_MULTI_LANE_WORKERS: "false",
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    PULSE_PRIMARY_INSTANCE: "false",
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
  };
  const observed = assertRemoteDisarmAuthority({
    repos: context.repos,
    env,
    now: NOW,
    reason: "emergency_control_hold",
  });
  assert.equal(observed.verdict, "DISARM_AUTHORISED");
  assert.equal(observed.kill_switch_healthy, false);
  assert.equal(observed.scheduler_owner_healthy, false);
  assert.equal(observed.autonomous_production_enabled, false);
  assert.equal(observed.publish_health_required, false);
  for (const brokenModeEnv of [
    {
      PULSE_EMERGENCY_KILL_SWITCH: "true",
      PULSE_MULTI_LANE_WORKERS: "false",
    },
    {
      PULSE_OPERATING_MODE: "corrupt-mode-value",
      PULSE_EMERGENCY_KILL_SWITCH: "true",
      PULSE_MULTI_LANE_WORKERS: "false",
    },
  ]) {
    const failSafe = assertRemoteDisarmAuthority({
      repos: context.repos,
      env: brokenModeEnv,
      now: NOW,
      reason: "emergency_control_hold",
    });
    assert.equal(failSafe.verdict, "DISARM_AUTHORISED");
    assert.equal(failSafe.scheduler_owner_healthy, false);
    assert.equal(
      failSafe.scheduler_health_required,
      false,
    );
    assert.equal(
      failSafe.kill_switch_health_required,
      false,
    );
  }

  const result =
    await disarmExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      reason: "emergency_control_hold",
      repos: context.repos,
      env,
      now: () => NOW,
      runWithPublisherLease: leaseRunner(context.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {}, update() {} } };
      },
      createYoutubeScheduledObjectDisarmer() {
        return async (candidate) => {
          await candidate.assertUpdateBoundary();
          candidate.markUpdateAttemptStarted();
          return disarmProof();
        };
      },
    });

  assert.equal(result.disarmed, true);
  assert.equal(context.calls.requested, 1);
  assert.equal(context.calls.confirmed, 1);
  assert.equal(context.calls.blocked, 1);
});
