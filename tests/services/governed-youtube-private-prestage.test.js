"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  armGovernedYoutubeScheduledRelease,
  confirmGovernedYoutubeScheduledRelease,
  prestageGovernedYoutubeRelease,
  resolveGovernedYoutubePlatformScheduledBinding,
  verifyGovernedYoutubePrivatePrestage,
} = require("../../lib/services/governed-youtube-private-prestage");
const {
  dispatchGovernedPlatform,
} = require("../../lib/services/governed-platform-dispatch");
const {
  bind: bindPlatformPosts,
} = require("../../lib/repositories/platform_posts");
const {
  bind: bindPublicationGovernance,
} = require("../../lib/repositories/publication_governance");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  stableValue,
} = require("../../lib/services/publication-request-fingerprint");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const STORY_ID = "youtube-prestage-service-story";
const CHANNEL_ID = "pulse-gaming";
const PLATFORM = "youtube";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const PRESTAGE_AT = new Date("2026-07-28T18:00:00.000Z");
const REQUEST_FINGERPRINT = "c".repeat(64);
const RUNWAY_LOCK_SHA256 = "d".repeat(64);
const OPERATION_KEY =
  `youtube:${STORY_ID}:${SCHEDULED_FOR}`;
const EXTERNAL_ID = "yt-private-prestage-1";
const SOURCE_EVIDENCE_SHA256 = "a".repeat(64);
const SOURCE_BODY_SHA256 = "b".repeat(64);
const SOURCE_CLAIM_TEXT =
  "The exact official release claim is unchanged.";
const SOURCE_CLAIM_SHA256 = crypto
  .createHash("sha256")
  .update(SOURCE_CLAIM_TEXT)
  .digest("hex");
const SOURCE_CLAIM = Object.freeze({
  claim_key: "release_claim",
  text: SOURCE_CLAIM_TEXT,
  claim_text_sha256: SOURCE_CLAIM_SHA256,
});
const OFFICIAL_SOURCE_BINDING =
  buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: {
      schema_version: "pulse-source-evidence-v1",
      story_id: STORY_ID,
      source_type: "official",
      source_url:
        "https://news.xbox.com/example",
      claims: [SOURCE_CLAIM],
      official_source_snapshot: {
        schema_version:
          "pulse-official-source-snapshot-v1",
        source_url:
          "https://news.xbox.com/example",
        source_id: "xbox-release",
        source_class: "OFFICIAL_FIRST_PARTY",
        canonical_body_algorithm:
          "pulse-readable-body-v1",
        canonical_body_sha256: SOURCE_BODY_SHA256,
        claims: [SOURCE_CLAIM],
      },
    },
  });

function stableSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function exactSourceReceipt() {
  const receipt = {
    schema_version:
      "pulse-official-source-revalidation-v1",
    official_source: true,
    unchanged: true,
    claims_match: true,
    story_id: STORY_ID,
    platform: PLATFORM,
    external_id: EXTERNAL_ID,
    scheduled_for: SCHEDULED_FOR,
    request_fingerprint: REQUEST_FINGERPRINT,
    runway_lock_sha256: RUNWAY_LOCK_SHA256,
    source_url: OFFICIAL_SOURCE_BINDING.source_url,
    source_id: OFFICIAL_SOURCE_BINDING.source_id,
    source_binding_sha256:
      OFFICIAL_SOURCE_BINDING.binding_sha256,
    source_evidence_sha256: SOURCE_EVIDENCE_SHA256,
    expected_source_revision_sha256:
      OFFICIAL_SOURCE_BINDING.source_revision_sha256,
    source_revision_sha256:
      OFFICIAL_SOURCE_BINDING.source_revision_sha256,
    observed_canonical_body_sha256:
      SOURCE_BODY_SHA256,
    matched_claim_text_sha256: [
      SOURCE_CLAIM_SHA256,
    ],
    fetch_status: 200,
    content_type: "text/html",
    bytes_sha256: "e".repeat(64),
    revalidated_at: "2026-07-28T18:45:00.000Z",
  };
  return {
    ...receipt,
    receipt_sha256: stableSha256(receipt),
  };
}

function exactScheduleArmProof() {
  return {
    schema_version:
      "pulse-youtube-schedule-arm-proof-v1",
    platform: PLATFORM,
    platform_object_confirmed: true,
    schedule_arm_confirmed: true,
    scheduled_release_confirmed: true,
    external_id: EXTERNAL_ID,
    privacy_status: "private",
    publish_at: SCHEDULED_FOR,
    release_armed: true,
    checked_at: "2026-07-28T18:45:02.000Z",
    update_attempt_started: true,
    before: {
      privacy_status: "private",
      publish_at: null,
      release_armed: false,
    },
  };
}

function fixture() {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    CHANNEL_ID,
    "Pulse Gaming",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    STORY_ID,
    "Private pre-stage service fixture",
  );
  const governance = bindPublicationGovernance(db);
  const platformPosts = bindPlatformPosts(db);
  const approval = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "approve_publication",
    targetType: "platform_publication",
    targetId: `${STORY_ID}:${PLATFORM}`,
    decision: "APPROVED",
    reason: "Reviewed package approved",
    evidence: { exact_review: true },
    idempotencyKey: `${OPERATION_KEY}:approval`,
  });
  const stateEvidence = {
    DISCOVERED: { source_discovered: true },
    VERIFIED: { source_verified: true },
    EDITORIALLY_APPROVED: { editorial_approved: true },
    SCRIPT_READY: { script_ready: true },
    ASSETS_CLEARED: { rights_cleared: true },
    RENDERED: { rendered_artifact_verified: true },
    QA_PASSED: { qa_passed: true },
    HUMAN_APPROVED: {
      human_review_complete: true,
      operator_decision_id: approval.id,
    },
    SCHEDULED: {
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: PRESTAGE_AT.toISOString(),
      scheduled_for: SCHEDULED_FOR,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: OPERATION_KEY,
      request_fingerprint: REQUEST_FINGERPRINT,
      runway_lock_sha256: RUNWAY_LOCK_SHA256,
      publication_evidence: {
        schema_version:
          "pulse-publication-evidence-v1",
        source_evidence_sha256:
          SOURCE_EVIDENCE_SHA256,
        official_source_release_binding:
          OFFICIAL_SOURCE_BINDING,
      },
    },
  };
  for (const state of Object.keys(stateEvidence)) {
    governance.appendLifecycle({
      storyId: STORY_ID,
      platform: PLATFORM,
      toState: state,
      actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
      actorId: state === "HUMAN_APPROVED" ? "operator-1" : null,
      operatorDecisionId:
        state === "HUMAN_APPROVED" ? approval.id : null,
      evidence: stateEvidence[state],
      idempotencyKey: `${OPERATION_KEY}:evidence:${state}`,
    });
  }
  return {
    db,
    governance,
    platformPosts,
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    scheduledFor: SCHEDULED_FOR,
  };
}

function scheduledVerification() {
  return {
    confirmed: true,
    externalId: EXTERNAL_ID,
    externalUrl:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    scheduledFor: SCHEDULED_FOR,
    verifiedAt: "2026-07-28T18:01:00.000Z",
    reason: "youtube_private_schedule_processed",
    incident_required: false,
    evidence: {
      platform: "youtube",
      platform_object_confirmed: true,
      scheduled_release_confirmed: true,
      privacy_status: "private",
      publish_at: SCHEDULED_FOR,
      upload_status: "processed",
      processing_status: "succeeded",
      checked_at: "2026-07-28T18:01:00.000Z",
      reason: "youtube_private_schedule_processed",
    },
  };
}

function privateUnscheduledVerification() {
  return {
    confirmed: true,
    externalId: EXTERNAL_ID,
    externalUrl:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    verifiedAt: "2026-07-28T18:01:00.000Z",
    reason: "youtube_private_unscheduled_processed",
    incident_required: false,
    evidence: {
      platform: "youtube",
      platform_object_confirmed: true,
      scheduled_release_confirmed: false,
      privacy_status: "private",
      publish_at: null,
      upload_status: "processed",
      processing_status: "succeeded",
      checked_at: "2026-07-28T18:01:00.000Z",
      reason: "youtube_private_unscheduled_processed",
    },
  };
}

function publicVerification() {
  return {
    confirmed: true,
    externalId: EXTERNAL_ID,
    externalUrl:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    verifiedAt: "2026-07-28T19:00:05.000Z",
    reason: "youtube_public_processed",
    evidence: {
      platform: "youtube",
      platform_object_confirmed: true,
      public: true,
      privacy_status: "public",
      upload_status: "processed",
      checked_at: "2026-07-28T19:00:05.000Z",
      reason: "youtube_public_processed",
    },
  };
}

async function prestage(context, overrides = {}) {
  return prestageGovernedYoutubeRelease({
    ...context,
    now: PRESTAGE_AT,
    assertLeaseHealthy: () => true,
    uploadScheduled: async ({ markCreateAttemptStarted }) => {
      markCreateAttemptStarted();
      return {
        externalId: EXTERNAL_ID,
        externalUrl:
        `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
      };
    },
    ...overrides,
  });
}

function recordPlatformScheduleForTest(context) {
  return context.governance.recordPlatformScheduled({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T18:45:05.000Z",
    verificationEvidence: {
      ...scheduledVerification().evidence,
      external_id: EXTERNAL_ID,
      checked_at: "2026-07-28T18:45:05.000Z",
      source_revalidation: exactSourceReceipt(),
      schedule_arm_proof: exactScheduleArmProof(),
    },
    now: new Date("2026-07-28T18:45:05.000Z"),
  });
}

function recordReleaseCommitment(context) {
  return context.governance
    .recordScheduledPlatformReleaseCommitment({
      storyId: STORY_ID,
      channelId: CHANNEL_ID,
      platform: PLATFORM,
      idempotencyKey: OPERATION_KEY,
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      requestFingerprint: REQUEST_FINGERPRINT,
      runwayLockSha256: RUNWAY_LOCK_SHA256,
      verifiedAt: "2026-07-28T18:45:05.000Z",
      verificationEvidence: {
        ...scheduledVerification().evidence,
        external_id: EXTERNAL_ID,
        checked_at: "2026-07-28T18:45:05.000Z",
        source_revalidation: exactSourceReceipt(),
        schedule_arm_proof: exactScheduleArmProof(),
      },
      controlEvidence: {
        verdict: "GREEN",
        phase: "create_boundary",
        checked_at: "2026-07-28T18:45:05.000Z",
        kill_switch_healthy: true,
        operating_contract_valid: true,
        scheduler_owner_healthy: true,
        live_publish_enabled: true,
        source_revalidation: exactSourceReceipt(),
        schedule_arm_proof: exactScheduleArmProof(),
      },
      now: new Date("2026-07-28T18:45:05.000Z"),
  });
}

test("T-70 private pre-stage anchors the object without verifying or arming a release", async () => {
  const context = fixture();
  let uploads = 0;
  let scheduledChecks = 0;

  const result = await prestage(context, {
    uploadScheduled: async ({ markCreateAttemptStarted }) => {
      uploads += 1;
      markCreateAttemptStarted();
      return {
        externalId: EXTERNAL_ID,
        externalUrl:
          `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
      };
    },
    verifyScheduled: async () => {
      scheduledChecks += 1;
      throw new Error("T-70 must not verify a schedule");
    },
  });

  assert.equal(result.status, "platform_object_created");
  assert.equal(result.lifecycleState, "PLATFORM_OBJECT_CREATED");
  assert.equal(result.releaseState, "private_unscheduled");
  assert.equal(result.scheduled, false);
  assert.equal(result.releaseArmed, false);
  assert.equal(result.verificationPending, true);
  assert.equal(result.externalId, EXTERNAL_ID);
  assert.equal(uploads, 1);
  assert.equal(scheduledChecks, 0);
  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "PLATFORM_OBJECT_CREATED",
  );
  assert.equal(
    context.governance.getLatestLifecycleEvent(
      STORY_ID,
      PLATFORM,
      "PLATFORM_SCHEDULED",
    ),
    null,
  );
  const objectEvent = context.governance.getLatestLifecycleEvent(
    STORY_ID,
    PLATFORM,
    "PLATFORM_OBJECT_CREATED",
  );
  const objectEvidence = JSON.parse(objectEvent.evidence_json);
  assert.equal(objectEvidence.requested_privacy_status, "private");
  assert.equal(objectEvidence.requested_publish_at, null);
  assert.equal(objectEvidence.release_armed, false);
  context.db.close();
});

test("T-60 verifies the exact private processed object with no publishAt and keeps release authority unarmed", async () => {
  const context = fixture();
  await prestage(context);
  let checks = 0;

  const result = await verifyGovernedYoutubePrivatePrestage({
    ...context,
    now: new Date("2026-07-28T18:00:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPrivate: async (candidate) => {
      checks += 1;
      assert.equal(candidate.externalId, EXTERNAL_ID);
      assert.equal(
        Object.hasOwn(candidate, "scheduledFor"),
        false,
      );
      return privateUnscheduledVerification();
    },
  });

  assert.equal(result.status, "private_object_verified");
  assert.equal(result.scheduled, false);
  assert.equal(result.releaseArmed, false);
  assert.equal(checks, 1);
  const state = context.governance.getState(STORY_ID, PLATFORM);
  assert.equal(state.lifecycle_state, "PLATFORM_OBJECT_CREATED");
  assert.equal(
    state.verification_status,
    "private_unscheduled_processed",
  );
  assert.equal(
    context.governance.getLatestLifecycleEvent(
      STORY_ID,
      PLATFORM,
      "PLATFORM_SCHEDULED",
    ),
    null,
  );
  context.db.close();
});

test("T-15 revalidates the locked official source before one schedule arm and persists exact read-back", async () => {
  const context = fixture();
  await prestage(context);
  await verifyGovernedYoutubePrivatePrestage({
    ...context,
    now: new Date("2026-07-28T18:00:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPrivate: async () => privateUnscheduledVerification(),
  });
  context.db.prepare(
    `UPDATE platform_publication_state
     SET verification_status = 'mutable_projection_drift'
     WHERE story_id = ? AND platform = ?`,
  ).run(STORY_ID, PLATFORM);
  let revalidations = 0;
  let armAttempts = 0;
  let scheduleChecks = 0;
  let persistCalls = 0;

  const result = await armGovernedYoutubeScheduledRelease({
    ...context,
    now: new Date("2026-07-28T18:45:00.000Z"),
    expectedSourceRevisionSha256:
      OFFICIAL_SOURCE_BINDING.source_revision_sha256,
    assertLeaseHealthy: () => true,
    revalidateOfficialSource: async () => {
      revalidations += 1;
      return exactSourceReceipt();
    },
    armScheduled: async (candidate) => {
      assert.equal(candidate.externalId, EXTERNAL_ID);
      assert.equal(candidate.scheduledFor, SCHEDULED_FOR);
      await candidate.assertUpdateBoundary();
      await candidate.markUpdateAttemptStarted();
      const durableAttempt =
        context.governance.getScheduledPlatformArmAttempt({
          storyId: STORY_ID,
          channelId: CHANNEL_ID,
          platform: PLATFORM,
          idempotencyKey: OPERATION_KEY,
          externalId: EXTERNAL_ID,
          scheduledFor: SCHEDULED_FOR,
          requestFingerprint: REQUEST_FINGERPRINT,
          runwayLockSha256: RUNWAY_LOCK_SHA256,
          now: new Date("2026-07-28T18:45:01.000Z"),
        });
      assert.equal(durableAttempt.remoteScheduleMayExist, true);
      armAttempts += 1;
      return {
        confirmed: true,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        verifiedAt: "2026-07-28T18:45:02.000Z",
        updateAttemptStarted: true,
        evidence: {
          schema_version: "pulse-youtube-schedule-arm-proof-v1",
          schedule_arm_confirmed: true,
          release_armed: true,
          external_id: EXTERNAL_ID,
          publish_at: SCHEDULED_FOR,
          checked_at: "2026-07-28T18:45:02.000Z",
        },
      };
    },
    verifyScheduled: async (candidate) => {
      scheduleChecks += 1;
      assert.equal(candidate.externalId, EXTERNAL_ID);
      assert.equal(candidate.scheduledFor, SCHEDULED_FOR);
      return {
        ...scheduledVerification(),
        verifiedAt: "2026-07-28T18:45:05.000Z",
        evidence: {
          ...scheduledVerification().evidence,
          checked_at: "2026-07-28T18:45:05.000Z",
        },
      };
    },
    persistScheduledRelease(input) {
      persistCalls += 1;
      return {
        governanceState:
          context.governance.recordPlatformScheduled(
            input.recordPlatformScheduledInput,
          ),
        releaseCommitment: {
          id: 777,
          evidence: {
            release_commitment_confirmed: true,
          },
        },
      };
    },
  });

  assert.equal(result.status, "platform_scheduled");
  assert.equal(result.scheduled, true);
  assert.equal(result.releaseArmed, true);
  assert.equal(revalidations, 1);
  assert.equal(armAttempts, 1);
  assert.equal(scheduleChecks, 1);
  assert.equal(persistCalls, 1);
  assert.equal(result.releaseCommitment.id, 777);
  const state = context.governance.getState(STORY_ID, PLATFORM);
  assert.equal(state.lifecycle_state, "PLATFORM_SCHEDULED");
  const scheduledEvent = context.governance.getLatestLifecycleEvent(
    STORY_ID,
    PLATFORM,
    "PLATFORM_SCHEDULED",
  );
  const evidence = JSON.parse(scheduledEvent.evidence_json);
  assert.equal(
    evidence.source_revalidation.source_revision_sha256,
    OFFICIAL_SOURCE_BINDING.source_revision_sha256,
  );
  assert.equal(evidence.schedule_arm_proof.release_armed, true);
  context.db.close();
});

test("an orphaned durable T-15 arm intent blocks every re-arm and requires remote disarm", async () => {
  const context = fixture();
  await prestage(context);
  await verifyGovernedYoutubePrivatePrestage({
    ...context,
    now: new Date("2026-07-28T18:00:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPrivate: async () => privateUnscheduledVerification(),
  });
  context.governance.recordScheduledPlatformArmAttemptStarted({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    sourceRevalidation: exactSourceReceipt(),
    now: new Date("2026-07-28T18:45:00.000Z"),
  });
  let armCalls = 0;

  await assert.rejects(
    armGovernedYoutubeScheduledRelease({
      ...context,
      now: new Date("2026-07-28T18:45:30.000Z"),
      expectedSourceRevisionSha256:
        OFFICIAL_SOURCE_BINDING.source_revision_sha256,
      assertLeaseHealthy: () => true,
      revalidateOfficialSource: async () => exactSourceReceipt(),
      armScheduled: async () => {
        armCalls += 1;
        throw new Error("orphan_intent_must_block_rearm");
      },
      verifyScheduled: async () => scheduledVerification(),
    }),
    (error) => {
      assert.equal(error.updateAttemptStarted, true);
      assert.equal(error.remoteDisarmRequired, true);
      return /youtube_private_prestage_reconciliation_required/.test(
        error.message,
      );
    },
  );
  assert.equal(armCalls, 0);
  context.db.close();
});

test("a post-update verifier failure carries compensation authority and leaves the durable arm intent discoverable", async () => {
  const context = fixture();
  await prestage(context);
  await verifyGovernedYoutubePrivatePrestage({
    ...context,
    now: new Date("2026-07-28T18:00:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPrivate: async () => privateUnscheduledVerification(),
  });

  await assert.rejects(
    armGovernedYoutubeScheduledRelease({
      ...context,
      now: new Date("2026-07-28T18:45:00.000Z"),
      expectedSourceRevisionSha256:
        OFFICIAL_SOURCE_BINDING.source_revision_sha256,
      assertLeaseHealthy: () => true,
      revalidateOfficialSource: async () => exactSourceReceipt(),
      armScheduled: async (candidate) => {
        await candidate.assertUpdateBoundary();
        await candidate.markUpdateAttemptStarted();
        return {
          confirmed: true,
          externalId: EXTERNAL_ID,
          scheduledFor: SCHEDULED_FOR,
          evidence: exactScheduleArmProof(),
        };
      },
      verifyScheduled: async () => {
        throw new Error("simulated_second_verifier_failure");
      },
    }),
    (error) => {
      assert.equal(error.updateAttemptStarted, true);
      assert.equal(error.remoteDisarmRequired, true);
      assert.match(error.message, /simulated_second_verifier_failure/);
      return true;
    },
  );
  const attempt =
    context.governance.getScheduledPlatformArmAttempt({
      storyId: STORY_ID,
      channelId: CHANNEL_ID,
      platform: PLATFORM,
      idempotencyKey: OPERATION_KEY,
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      requestFingerprint: REQUEST_FINGERPRINT,
      runwayLockSha256: RUNWAY_LOCK_SHA256,
      now: new Date("2026-07-28T18:45:30.000Z"),
    });
  assert.equal(attempt.remoteScheduleMayExist, true);
  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  context.db.close();
});

test("pre-stage replay reuses the anchored private object without verifying or uploading twice", async () => {
  const context = fixture();
  let uploads = 0;

  const first = await prestage(context, {
    uploadScheduled: async ({ markCreateAttemptStarted }) => {
      uploads += 1;
      markCreateAttemptStarted();
      return {
        externalId: EXTERNAL_ID,
        externalUrl:
          `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
      };
    },
  });
  const replay = await prestage(context, {
    now: new Date("2026-07-28T18:45:00.000Z"),
    uploadScheduled: async () => {
      uploads += 1;
      throw new Error("duplicate upload forbidden");
    },
  });

  assert.equal(first.status, "platform_object_created");
  assert.equal(replay.status, "platform_object_created");
  assert.equal(replay.reused, true);
  assert.equal(uploads, 1);
  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "PLATFORM_OBJECT_CREATED",
  );
  assert.equal(
    context.platformPosts.getByStoryPlatform(STORY_ID, PLATFORM).status,
    "uploading",
  );
  assert.deepEqual(
    context.db
      .prepare(
        `SELECT youtube_post_id, youtube_url, publish_status
         FROM stories WHERE id = ?`,
      )
      .get(STORY_ID),
    {
      youtube_post_id: null,
      youtube_url: null,
      publish_status: null,
    },
  );
  context.db.close();
});

test("T-60 retries a still-processing anchored object without a duplicate upload", async () => {
  const context = fixture();
  let uploads = 0;
  let checks = 0;
  await prestage(context, {
    uploadScheduled: async ({ markCreateAttemptStarted }) => {
      uploads += 1;
      markCreateAttemptStarted();
      return { externalId: EXTERNAL_ID };
    },
  });
  const first = await verifyGovernedYoutubePrivatePrestage({
    ...context,
    now: new Date("2026-07-28T18:00:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPrivate: async () => {
      checks += 1;
      return {
        ...privateUnscheduledVerification(),
        confirmed: false,
        reason: "youtube_private_object_upload_not_processed",
        evidence: {
          ...privateUnscheduledVerification().evidence,
          scheduled_release_confirmed: false,
          upload_status: "uploaded",
          processing_status: "processing",
          reason: "youtube_private_object_upload_not_processed",
        },
      };
    },
  });
  const second = await verifyGovernedYoutubePrivatePrestage({
    ...context,
    now: new Date("2026-07-28T18:01:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPrivate: async () => {
      checks += 1;
      return privateUnscheduledVerification();
    },
  });

  assert.equal(first.status, "verification_pending");
  assert.equal(second.status, "private_object_verified");
  assert.equal(second.releaseArmed, false);
  assert.equal(uploads, 1);
  assert.equal(checks, 2);
  context.db.close();
});

test("the immediate-public dispatcher treats PLATFORM_OBJECT_CREATED as anchored truth and cannot upload again", async () => {
  const context = fixture();
  await prestage(context);
  let uploads = 0;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: new Date("2026-07-28T19:00:00.000Z"),
      assertLeaseHealthy: () => true,
      upload: async () => {
        uploads += 1;
        return { externalId: "unsafe-second-object" };
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run");
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        "platform_dispatch_reconciliation_required",
      );
      return true;
    },
  );
  assert.equal(uploads, 0);
  context.db.close();
});

test("T0 public observation does not run early and atomically projects confirmed publication truth exactly once", async () => {
  const context = fixture();
  await prestage(context);
  recordPlatformScheduleForTest(context);
  recordReleaseCommitment(context);
  let publicChecks = 0;

  const early = await confirmGovernedYoutubeScheduledRelease({
    ...context,
    now: new Date("2026-07-28T18:59:59.000Z"),
    assertLeaseHealthy: () => true,
    verifyPublic: async () => {
      publicChecks += 1;
      throw new Error("public verifier must not run before T0");
    },
  });
  const first = await confirmGovernedYoutubeScheduledRelease({
    ...context,
    now: new Date("2026-07-28T19:00:05.000Z"),
    assertLeaseHealthy: () => true,
    verifyPublic: async ({ externalId }) => {
      publicChecks += 1;
      assert.equal(externalId, EXTERNAL_ID);
      return publicVerification();
    },
  });
  const replay = await confirmGovernedYoutubeScheduledRelease({
    ...context,
    now: new Date("2026-07-28T19:01:00.000Z"),
    assertLeaseHealthy: () => true,
    verifyPublic: async () => {
      publicChecks += 1;
      throw new Error("published object must be reused");
    },
  });

  assert.equal(early.status, "not_due");
  assert.equal(first.status, "published");
  assert.equal(replay.status, "published");
  assert.equal(replay.reused, true);
  assert.equal(publicChecks, 1);
  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "PUBLISHED",
  );
  assert.equal(
    context.platformPosts.getByStoryPlatform(STORY_ID, PLATFORM).status,
    "published",
  );
  assert.deepEqual(
    context.db
      .prepare(
        `SELECT youtube_post_id, youtube_url, publish_status
         FROM stories WHERE id = ?`,
      )
      .get(STORY_ID),
    {
      youtube_post_id: EXTERNAL_ID,
      youtube_url:
        `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
      publish_status: "published",
    },
  );
  context.db.close();
});

test("T0 PUBLISHED replay still requires the exact immutable release commitment", async () => {
  const context = fixture();
  await prestage(context);
  recordPlatformScheduleForTest(context);
  recordReleaseCommitment(context);
  await confirmGovernedYoutubeScheduledRelease({
    ...context,
    now: new Date("2026-07-28T19:00:05.000Z"),
    assertLeaseHealthy: () => true,
    verifyPublic: async () => publicVerification(),
  });

  context.db.exec(
    "DROP TRIGGER trg_platform_dispatch_ledger_immutable_delete",
  );
  context.db
    .prepare(
      `DELETE FROM platform_dispatch_ledger
       WHERE story_id = ?
         AND platform = ?
         AND event_type = 'RELEASE_COMMITMENT_CONFIRMED'`,
    )
    .run(STORY_ID, PLATFORM);

  await assert.rejects(
    confirmGovernedYoutubeScheduledRelease({
      ...context,
      now: new Date("2026-07-28T19:01:00.000Z"),
      assertLeaseHealthy: () => true,
      verifyPublic: async () => {
        throw new Error(
          "published replay must not re-verify remotely",
        );
      },
    }),
    /release_commitment_confirmed_required/,
  );
  context.db.close();
});

test("an uncertain create boundary blocks every duplicate upload attempt", async () => {
  const context = fixture();
  let uploads = 0;
  await assert.rejects(
    prestage(context, {
      uploadScheduled: async ({ markCreateAttemptStarted }) => {
        uploads += 1;
        markCreateAttemptStarted();
        throw new Error("connection lost after create");
      },
    }),
    /connection lost after create/,
  );

  await assert.rejects(
    prestage(context, {
      uploadScheduled: async () => {
        uploads += 1;
        return { externalId: "unsafe-duplicate" };
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_private_prestage_reconciliation_required",
      );
      return true;
    },
  );
  assert.equal(uploads, 1);
  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  context.db.close();
});

test("T-60 treats an unexpected publishAt as reconciliation-only and never uploads a replacement", async () => {
  const context = fixture();
  let uploads = 0;
  await prestage(context, {
    uploadScheduled: async ({ markCreateAttemptStarted }) => {
      uploads += 1;
      markCreateAttemptStarted();
      return { externalId: EXTERNAL_ID };
    },
  });
  await assert.rejects(
    verifyGovernedYoutubePrivatePrestage({
      ...context,
      now: new Date("2026-07-28T18:00:00.000Z"),
      assertLeaseHealthy: () => true,
      verifyPrivate: async () => ({
        ...privateUnscheduledVerification(),
        confirmed: false,
        reason: "youtube_private_object_unexpected_publish_at",
        incident_required: true,
        evidence: {
          ...privateUnscheduledVerification().evidence,
          scheduled_release_confirmed: false,
          publish_at: "2026-07-29T09:00:00.000Z",
          release_armed: true,
          reason: "youtube_private_object_unexpected_publish_at",
        },
      }),
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_private_prestage_reconciliation_required",
      );
      return true;
    },
  );
  await assert.rejects(
    prestage(context, {
      uploadScheduled: async () => {
        uploads += 1;
        return { externalId: "unsafe-replacement" };
      },
    }),
    (error) =>
      error.code ===
      "youtube_private_prestage_reconciliation_required",
  );
  assert.equal(uploads, 1);
  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  assert.equal(
    context.platformPosts.getByStoryPlatform(STORY_ID, PLATFORM)
      .external_id,
    EXTERNAL_ID,
  );
  context.db.close();
});

test("T-60 contains every unauthorised release state on the exact anchored object before raising reconciliation", async (t) => {
  for (const scenario of [
    {
      name: "unauthorised expected publishAt",
      reason: "youtube_private_object_unexpected_publish_at",
      privacyStatus: "private",
      publishAt: SCHEDULED_FOR,
      publishAtPresent: true,
      publishAtInvalid: false,
    },
    {
      name: "early public object",
      reason: "youtube_private_object_published_early",
      privacyStatus: "public",
      publishAt: null,
      publishAtPresent: false,
      publishAtInvalid: false,
    },
    {
      name: "unlisted link-accessible object",
      reason:
        "youtube_private_object_privacy_not_private",
      privacyStatus: "unlisted",
      publishAt: null,
      publishAtPresent: false,
      publishAtInvalid: false,
    },
    {
      name: "different publishAt",
      reason: "youtube_private_object_unexpected_publish_at",
      privacyStatus: "private",
      publishAt: "2026-07-29T09:00:00.000Z",
      publishAtPresent: true,
      publishAtInvalid: false,
    },
    {
      name: "malformed publishAt",
      reason: "youtube_private_object_publish_at_invalid",
      privacyStatus: "private",
      publishAt: null,
      publishAtPresent: true,
      publishAtInvalid: true,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const context = fixture();
      try {
        await prestage(context);
        const containments = [];
        await assert.rejects(
          verifyGovernedYoutubePrivatePrestage({
            ...context,
            now: new Date("2026-07-28T18:00:00.000Z"),
            assertLeaseHealthy: () => true,
            verifyPrivate: async () => ({
              ...privateUnscheduledVerification(),
              confirmed: false,
              reason: scenario.reason,
              incident_required: true,
              evidence: {
                ...privateUnscheduledVerification().evidence,
                privacy_status: scenario.privacyStatus,
                publish_at: scenario.publishAt,
                publish_at_present:
                  scenario.publishAtPresent,
                publish_at_invalid:
                  scenario.publishAtInvalid,
                release_armed:
                  scenario.publishAtPresent,
                reason: scenario.reason,
              },
            }),
            containUnexpectedObject: async (candidate) => {
              containments.push(candidate);
              return {
                confirmed: true,
                externalId: EXTERNAL_ID,
                emergencyContainment: true,
                compensationRequired: true,
                compensationAttempted: true,
                compensationConfirmed: true,
                evidence: {
                  schema_version:
                    "pulse-youtube-schedule-disarm-proof-v1",
                  platform: "youtube",
                  platform_object_confirmed: true,
                  schedule_disarm_confirmed: true,
                  external_id: EXTERNAL_ID,
                  privacy_status: "private",
                  publish_at: null,
                  publish_at_present: false,
                  publish_at_invalid: false,
                  emergency_containment: true,
                  containment_reason: scenario.reason,
                },
              };
            },
          }),
          (error) => {
            assert.equal(
              error.code,
              "youtube_pre_t15_emergency_containment_confirmed",
            );
            assert.equal(error.compensationRequired, true);
            assert.equal(error.compensationAttempted, true);
            assert.equal(error.compensationConfirmed, true);
            assert.equal(
              error.remoteContainmentRequired,
              false,
            );
            assert.equal(
              error.compensation.evidence.privacy_status,
              "private",
            );
            assert.equal(
              error.compensation.evidence.publish_at,
              null,
            );
            assert.equal(
              error.compensation.evidence
                .publish_at_present,
              false,
            );
            return true;
          },
        );

        assert.equal(containments.length, 1);
        assert.equal(
          containments[0].externalId,
          EXTERNAL_ID,
        );
        assert.equal(
          containments[0].scheduledFor,
          SCHEDULED_FOR,
        );
        assert.equal(
          containments[0].emergencyContainment,
          true,
        );
        assert.equal(
          containments[0].containmentReason,
          scenario.reason,
        );
      } finally {
        context.db.close();
      }
    });
  }
});

test("a decisive pre-create failure records no remote identity and never becomes post-create uncertainty", async () => {
  const context = fixture();

  await assert.rejects(
    prestage(context, {
      uploadScheduled: async () => {
        throw new Error("credentials rejected before create");
      },
    }),
    /credentials rejected before create/,
  );

  const state = context.governance.getState(STORY_ID, PLATFORM);
  const post = context.platformPosts.getByStoryPlatform(
    STORY_ID,
    PLATFORM,
  );
  assert.equal(state.lifecycle_state, "DISPATCH_FAILED_BEFORE_CREATE");
  assert.equal(state.external_id, null);
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, null);
  context.db.close();
});

test("T0 lifecycle, platform-post and story projections roll back together on a projection conflict", async () => {
  const context = fixture();
  await prestage(context);
  recordPlatformScheduleForTest(context);
  recordReleaseCommitment(context);
  context.db
    .prepare("UPDATE stories SET youtube_url = ? WHERE id = ?")
    .run(
      "https://www.youtube.com/watch?v=another-object",
      STORY_ID,
    );

  await assert.rejects(
    confirmGovernedYoutubeScheduledRelease({
      ...context,
      now: new Date("2026-07-28T19:00:05.000Z"),
      assertLeaseHealthy: () => true,
      verifyPublic: async () => publicVerification(),
    }),
    /story_youtube_url_identity_conflict/,
  );

  assert.equal(
    context.governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  assert.equal(
    context.platformPosts.getByStoryPlatform(STORY_ID, PLATFORM).status,
    "failed",
  );
  assert.equal(
    context.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM publication_lifecycle_events
         WHERE story_id = ?
           AND to_state IN ('PLATFORM_CONFIRMED', 'PUBLISHED')`,
      )
      .get(STORY_ID).count,
    0,
  );
  assert.equal(
    context.db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM platform_dispatch_ledger
         WHERE story_id = ? AND event_type = 'PUBLISHED'`,
      )
      .get(STORY_ID).count,
    0,
  );
  assert.deepEqual(
    context.db
      .prepare(
        `SELECT youtube_post_id, youtube_url, publish_status
         FROM stories WHERE id = ?`,
      )
      .get(STORY_ID),
    {
      youtube_post_id: null,
      youtube_url:
        "https://www.youtube.com/watch?v=another-object",
      publish_status: null,
    },
  );
  context.db.close();
});
