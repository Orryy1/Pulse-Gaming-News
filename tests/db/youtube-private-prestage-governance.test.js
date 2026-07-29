"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  bind,
} = require("../../lib/repositories/publication_governance");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  stableValue,
} = require("../../lib/services/publication-request-fingerprint");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const STORY_ID = "youtube-private-prestage-story";
const CHANNEL_ID = "pulse-gaming";
const PLATFORM = "youtube";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const PRESTAGE_AT = "2026-07-28T18:45:00.000Z";
const REQUEST_FINGERPRINT = "a".repeat(64);
const RUNWAY_LOCK_SHA256 = "b".repeat(64);
const OPERATION_KEY =
  `youtube:${STORY_ID}:${SCHEDULED_FOR}`;
const EXTERNAL_ID = "youtube-private-object-1";
const SOURCE_EVIDENCE_SHA256 = "c".repeat(64);
const CANONICAL_BODY_SHA256 = "d".repeat(64);
const CLAIM_TEXT = "Exact locked official claim";
const CLAIM_TEXT_SHA256 = crypto
  .createHash("sha256")
  .update(CLAIM_TEXT)
  .digest("hex");
const SOURCE_CLAIM = Object.freeze({
  claim_key: "headline",
  text: CLAIM_TEXT,
  claim_text_sha256: CLAIM_TEXT_SHA256,
});
const OFFICIAL_SOURCE_RELEASE_BINDING =
  buildOfficialSourceReleaseBinding({
    storyId: STORY_ID,
    sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
    sourceEvidence: {
      schema_version: "pulse-source-evidence-v1",
      story_id: STORY_ID,
      source_type: "official",
      source_url:
        "https://publisher.example/news/exact-release",
      claims: [SOURCE_CLAIM],
      official_source_snapshot: {
        schema_version:
          "pulse-official-source-snapshot-v1",
        source_url:
          "https://publisher.example/news/exact-release",
        source_id: "publisher-release",
        source_class: "OFFICIAL_FIRST_PARTY",
        canonical_body_algorithm:
          "pulse-readable-body-v1",
        canonical_body_sha256:
          CANONICAL_BODY_SHA256,
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

function officialSourceRevalidation(overrides = {}) {
  const receiptBase = {
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
    source_url:
      OFFICIAL_SOURCE_RELEASE_BINDING.source_url,
    source_id:
      OFFICIAL_SOURCE_RELEASE_BINDING.source_id,
    source_binding_sha256:
      OFFICIAL_SOURCE_RELEASE_BINDING.binding_sha256,
    source_evidence_sha256: SOURCE_EVIDENCE_SHA256,
    expected_source_revision_sha256:
      OFFICIAL_SOURCE_RELEASE_BINDING
        .source_revision_sha256,
    source_revision_sha256:
      OFFICIAL_SOURCE_RELEASE_BINDING
        .source_revision_sha256,
    observed_canonical_body_sha256:
      CANONICAL_BODY_SHA256,
    matched_claim_text_sha256: [
      CLAIM_TEXT_SHA256,
    ],
    fetch_status: 200,
    content_type: "text/html; charset=utf-8",
    bytes_sha256: "e".repeat(64),
    revalidated_at: "2026-07-28T18:45:00.000Z",
    ...overrides,
  };
  return {
    ...receiptBase,
    receipt_sha256: stableSha256(receiptBase),
  };
}

function scheduleArmProof(overrides = {}) {
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
    checked_at: "2026-07-28T18:46:00.000Z",
    update_attempt_started: true,
    before: {
      privacy_status: "private",
      publish_at: null,
      release_armed: false,
    },
    ...overrides,
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
    "Private pre-stage fixture",
  );
  const governance = bind(db);
  const approval = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "approve_publication",
    targetType: "platform_publication",
    targetId: `${STORY_ID}:${PLATFORM}`,
    decision: "APPROVED",
    reason: "Exact reviewed package approved",
    evidence: { exact_review: true },
    idempotencyKey: `${OPERATION_KEY}:approval`,
  });
  const evidenceByState = {
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
      control_tower_checked_at: PRESTAGE_AT,
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
          OFFICIAL_SOURCE_RELEASE_BINDING,
      },
    },
  };
  for (const state of Object.keys(evidenceByState)) {
    governance.appendLifecycle({
      storyId: STORY_ID,
      platform: PLATFORM,
      toState: state,
      actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
      actorId: state === "HUMAN_APPROVED" ? "operator-1" : null,
      operatorDecisionId:
        state === "HUMAN_APPROVED" ? approval.id : null,
      evidence: evidenceByState[state],
      idempotencyKey: `${OPERATION_KEY}:evidence:${state}`,
    });
  }
  return { db, governance };
}

function privateScheduleEvidence(overrides = {}) {
  return {
    platform: "youtube",
    platform_object_confirmed: true,
    scheduled_release_confirmed: true,
    privacy_status: "private",
    publish_at: SCHEDULED_FOR,
    upload_status: "processed",
    processing_status: "succeeded",
    checked_at: "2026-07-28T18:46:00.000Z",
    reason: "youtube_private_schedule_processed",
    source_revalidation:
      officialSourceRevalidation(),
    schedule_arm_proof: scheduleArmProof(),
    ...overrides,
  };
}

function privateUnscheduledEvidence(overrides = {}) {
  return {
    platform: "youtube",
    platform_object_confirmed: true,
    scheduled_release_confirmed: false,
    privacy_status: "private",
    publish_at: null,
    upload_status: "processed",
    processing_status: "succeeded",
    checked_at: "2026-07-28T18:00:00.000Z",
    reason: "youtube_private_unscheduled_processed",
    external_id: EXTERNAL_ID,
    ...overrides,
  };
}

function publicEvidence(overrides = {}) {
  return {
    platform: "youtube",
    platform_object_confirmed: true,
    public: true,
    privacy_status: "public",
    upload_status: "processed",
    checked_at: "2026-07-28T19:00:05.000Z",
    reason: "youtube_public_processed",
    external_id: EXTERNAL_ID,
    ...overrides,
  };
}

function greenReleaseControl(overrides = {}) {
  return {
    verdict: "GREEN",
    phase: "create_boundary",
    checked_at: "2026-07-28T18:46:00.000Z",
    kill_switch_healthy: true,
    operating_contract_valid: true,
    scheduler_owner_healthy: true,
    live_publish_enabled: true,
    source_revalidation:
      officialSourceRevalidation(),
    schedule_arm_proof: scheduleArmProof(),
    ...overrides,
  };
}

function recordReleaseCommitment(governance, overrides = {}) {
  return governance.recordScheduledPlatformReleaseCommitment({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T18:46:00.000Z",
    verificationEvidence: privateScheduleEvidence({
      external_id: EXTERNAL_ID,
    }),
    controlEvidence: greenReleaseControl(),
    now: new Date("2026-07-28T18:46:00.000Z"),
    ...overrides,
  });
}

function advanceToPlatformObject(governance) {
  governance.preparePrivateScheduledUpload({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    now: new Date(PRESTAGE_AT),
  });
  return governance.recordPrivateScheduledPlatformObjectCreated({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    externalUrl: `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    now: new Date(PRESTAGE_AT),
  });
}

function advanceToPlatformScheduled(governance) {
  advanceToPlatformObject(governance);
  return governance.recordPlatformScheduled({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T18:46:00.000Z",
    now: new Date("2026-07-28T18:46:00.000Z"),
    verificationEvidence: privateScheduleEvidence({
      external_id: EXTERNAL_ID,
    }),
  });
}

test("private pre-stage atomically binds the reviewed ticket, object, exact window and proof", () => {
  const { db, governance } = fixture();

  const state = advanceToPlatformScheduled(governance);

  assert.equal(state.lifecycle_state, "PLATFORM_SCHEDULED");
  assert.equal(state.external_id, EXTERNAL_ID);
  assert.equal(state.verification_status, "scheduled_private");
  const event = governance.getLatestLifecycleEvent(
    STORY_ID,
    PLATFORM,
    "PLATFORM_SCHEDULED",
  );
  const evidence = JSON.parse(event.evidence_json);
  assert.equal(evidence.story_id, STORY_ID);
  assert.equal(evidence.external_id, EXTERNAL_ID);
  assert.equal(evidence.scheduled_for, SCHEDULED_FOR);
  assert.equal(evidence.request_fingerprint, REQUEST_FINGERPRINT);
  assert.equal(evidence.runway_lock_sha256, RUNWAY_LOCK_SHA256);
  assert.equal(evidence.privacy_status, "private");
  assert.equal(evidence.upload_status, "processed");
  assert.equal(evidence.processing_status, "succeeded");
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM platform_dispatch_ledger
         WHERE story_id = ? AND event_type = 'PLATFORM_SCHEDULED'`,
      )
      .get(STORY_ID).count,
    1,
  );
  db.close();
});

test("T-15 authority requires the exact append-only T-60 private-unscheduled proof rather than a mutable projection flag", () => {
  const { db, governance } = fixture();
  advanceToPlatformObject(governance);
  governance.recordPrivateUnscheduledPlatformObjectVerified({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T18:00:00.000Z",
    verificationEvidence: privateUnscheduledEvidence(),
    now: new Date("2026-07-28T18:00:00.000Z"),
  });
  db.prepare(
    `UPDATE platform_publication_state
     SET verification_status = 'mutable_projection_drift'
     WHERE story_id = ? AND platform = ?`,
  ).run(STORY_ID, PLATFORM);

  const asserted =
    governance.assertPrivateUnscheduledPlatformObjectBinding({
      storyId: STORY_ID,
      channelId: CHANNEL_ID,
      platform: PLATFORM,
      idempotencyKey: OPERATION_KEY,
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      requestFingerprint: REQUEST_FINGERPRINT,
      runwayLockSha256: RUNWAY_LOCK_SHA256,
      now: new Date("2026-07-28T18:45:00.000Z"),
    });

  assert.equal(asserted.externalId, EXTERNAL_ID);
  assert.equal(asserted.channelId, CHANNEL_ID);
  assert.equal(asserted.scheduledFor, SCHEDULED_FOR);
  assert.equal(asserted.evidence.release_armed, false);
  assert.equal(asserted.evidence.publish_at, null);
  assert.equal(
    asserted.evidence.processing_status,
    "succeeded",
  );
  db.close();
});

test("T-15 persists an exact arm-update intent before remote mutation and can recover it after process loss", () => {
  const { db, governance } = fixture();
  advanceToPlatformObject(governance);
  governance.recordPrivateUnscheduledPlatformObjectVerified({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T18:00:00.000Z",
    verificationEvidence: privateUnscheduledEvidence(),
    now: new Date("2026-07-28T18:00:00.000Z"),
  });

  const first = governance.recordScheduledPlatformArmAttemptStarted({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    sourceRevalidation: officialSourceRevalidation(),
    now: new Date("2026-07-28T18:45:00.000Z"),
  });
  const recovered = governance.getScheduledPlatformArmAttempt({
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
  const replay = governance.recordScheduledPlatformArmAttemptStarted({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    sourceRevalidation: officialSourceRevalidation(),
    now: new Date("2026-07-28T18:45:30.000Z"),
  });

  assert.equal(first.event_type, "SCHEDULE_ARM_UPDATE_STARTED");
  assert.equal(recovered.externalId, EXTERNAL_ID);
  assert.equal(recovered.remoteScheduleMayExist, true);
  assert.equal(
    recovered.evidence.source_revalidation.receipt_sha256,
    officialSourceRevalidation().receipt_sha256,
  );
  assert.equal(replay.id, first.id);
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM platform_dispatch_ledger
         WHERE story_id = ?
           AND event_type = 'SCHEDULE_ARM_UPDATE_STARTED'`,
      )
      .get(STORY_ID).count,
    1,
  );
  db.close();
});

test("private schedule binding drift rolls back without a partial lifecycle or ledger projection", () => {
  const { db, governance } = fixture();
  advanceToPlatformObject(governance);
  const lifecycleBefore = db
    .prepare(
      "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
    )
    .get().count;
  const ledgerBefore = db
    .prepare(
      "SELECT COUNT(*) AS count FROM platform_dispatch_ledger",
    )
    .get().count;

  assert.throws(
    () =>
      governance.recordPlatformScheduled({
        storyId: STORY_ID,
        channelId: CHANNEL_ID,
        platform: PLATFORM,
        idempotencyKey: OPERATION_KEY,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        requestFingerprint: "c".repeat(64),
        runwayLockSha256: RUNWAY_LOCK_SHA256,
        verifiedAt: "2026-07-28T18:46:00.000Z",
        now: new Date("2026-07-28T18:46:00.000Z"),
        verificationEvidence: privateScheduleEvidence({
          external_id: EXTERNAL_ID,
        }),
      }),
    /private_prestage_request_fingerprint_mismatch/,
  );
  assert.equal(
    governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "PLATFORM_OBJECT_CREATED",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
      )
      .get().count,
    lifecycleBefore,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_dispatch_ledger",
      )
      .get().count,
    ledgerBefore,
  );
  db.close();
});

test("the exact remote publishAt commitment is durable, idempotent and leaves the lifecycle PLATFORM_SCHEDULED", () => {
  const { db, governance } = fixture();
  advanceToPlatformScheduled(governance);
  const lifecycleBefore = db
    .prepare(
      "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
    )
    .get().count;

  const first = recordReleaseCommitment(governance);
  const replay = recordReleaseCommitment(governance, {
    controlEvidence: greenReleaseControl({
      checked_at: "2026-07-28T18:47:00.000Z",
    }),
    verifiedAt: "2026-07-28T18:47:00.000Z",
    verificationEvidence: privateScheduleEvidence({
      external_id: EXTERNAL_ID,
      checked_at: "2026-07-28T18:47:00.000Z",
    }),
    now: new Date("2026-07-28T18:47:00.000Z"),
  });

  assert.equal(first.id, replay.id);
  assert.equal(first.event_type, "RELEASE_COMMITMENT_CONFIRMED");
  assert.equal(
    governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "PLATFORM_SCHEDULED",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
      )
      .get().count,
    lifecycleBefore,
  );
  const asserted =
    governance.assertScheduledPlatformReleaseCommitment({
      storyId: STORY_ID,
      channelId: CHANNEL_ID,
      platform: PLATFORM,
      idempotencyKey: OPERATION_KEY,
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      requestFingerprint: REQUEST_FINGERPRINT,
      runwayLockSha256: RUNWAY_LOCK_SHA256,
      now: new Date("2026-07-28T18:59:59.000Z"),
    });
  assert.equal(asserted.externalId, EXTERNAL_ID);
  assert.equal(asserted.channelId, CHANNEL_ID);
  assert.equal(asserted.evidence.channel_id, CHANNEL_ID);
  assert.equal(asserted.scheduledEventId > 0, true);
  assert.equal(asserted.evidence.release_commitment_confirmed, true);
  assert.equal(
    asserted.evidence.commitment_boundary,
    "remote_private_publish_at_verified",
  );
  assert.throws(
    () =>
      governance.assertScheduledPlatformReleaseCommitment({
        storyId: STORY_ID,
        channelId: "another-channel",
        platform: PLATFORM,
        idempotencyKey: OPERATION_KEY,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        requestFingerprint: REQUEST_FINGERPRINT,
        runwayLockSha256: RUNWAY_LOCK_SHA256,
        now: new Date("2026-07-28T18:59:59.000Z"),
      }),
    /release_commitment_channel_mismatch/,
  );
  db.close();
});

test("release commitment rejects a forged official-source receipt and a mismatched schedule-arm proof", () => {
  const { db, governance } = fixture();
  advanceToPlatformScheduled(governance);

  assert.throws(
    () =>
      recordReleaseCommitment(governance, {
        controlEvidence: greenReleaseControl({
          source_revalidation:
            officialSourceRevalidation({
              external_id: "different-youtube-object",
            }),
        }),
      }),
    /official_source_revalidation_external_id_mismatch/,
  );
  assert.throws(
    () =>
      recordReleaseCommitment(governance, {
        controlEvidence: greenReleaseControl({
          schedule_arm_proof: scheduleArmProof({
            publish_at:
              "2026-07-28T20:00:00.000Z",
          }),
        }),
      }),
    /release_commitment_schedule_arm_proof_invalid/,
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM platform_dispatch_ledger
         WHERE story_id = ?
           AND event_type = 'RELEASE_COMMITMENT_CONFIRMED'`,
      )
      .get(STORY_ID).count,
    0,
  );
  db.close();
});

test("release commitment assertion revalidates the persisted source receipt and arm proof", () => {
  const { db, governance } = fixture();
  advanceToPlatformScheduled(governance);
  recordReleaseCommitment(governance);
  const row = db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE story_id = ?
         AND event_type = 'RELEASE_COMMITMENT_CONFIRMED'`,
    )
    .get(STORY_ID);
  const evidence = JSON.parse(
    row.verification_evidence_json,
  );
  const forgedReceipt = officialSourceRevalidation({
    external_id: "different-youtube-object",
  });
  evidence.source_revalidation = forgedReceipt;
  evidence.control.source_revalidation = forgedReceipt;
  db.exec(
    "DROP TRIGGER trg_platform_dispatch_ledger_immutable_update",
  );
  db.prepare(
    `UPDATE platform_dispatch_ledger
     SET verification_evidence_json = ?
     WHERE id = ?`,
  ).run(JSON.stringify(evidence), row.id);

  assert.throws(
    () =>
      governance.assertScheduledPlatformReleaseCommitment({
        storyId: STORY_ID,
        channelId: CHANNEL_ID,
        platform: PLATFORM,
        idempotencyKey: OPERATION_KEY,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        requestFingerprint: REQUEST_FINGERPRINT,
        runwayLockSha256: RUNWAY_LOCK_SHA256,
        now: new Date("2026-07-28T18:59:59.000Z"),
      }),
    /official_source_revalidation_external_id_mismatch/,
  );
  db.close();
});

test("release commitment rejects stale or non-GREEN control and T0 cannot project publication without the exact durable commitment", () => {
  const { db, governance } = fixture();
  advanceToPlatformScheduled(governance);

  assert.throws(
    () =>
      recordReleaseCommitment(governance, {
        controlEvidence: greenReleaseControl({
          verdict: "HOLD",
        }),
      }),
    /release_commitment_fresh_green_control_required/,
  );
  assert.throws(
    () =>
      recordReleaseCommitment(governance, {
        controlEvidence: greenReleaseControl({
          checked_at: "2026-07-28T18:20:00.000Z",
        }),
      }),
    /release_commitment_control_evidence_stale/,
  );
  assert.throws(
    () =>
      recordReleaseCommitment(governance, {
        controlEvidence: greenReleaseControl({
          checked_at: "2026-07-28T19:00:05.000Z",
        }),
        verifiedAt: "2026-07-28T19:00:05.000Z",
        verificationEvidence: privateScheduleEvidence({
          external_id: EXTERNAL_ID,
          checked_at: "2026-07-28T19:00:05.000Z",
        }),
        now: new Date("2026-07-28T19:00:05.000Z"),
      }),
    /release_commitment_must_precede_scheduled_release/,
  );
  assert.throws(
    () =>
      governance.recordScheduledPlatformPublished({
        storyId: STORY_ID,
        channelId: CHANNEL_ID,
        platform: PLATFORM,
        idempotencyKey: OPERATION_KEY,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        requestFingerprint: REQUEST_FINGERPRINT,
        runwayLockSha256: RUNWAY_LOCK_SHA256,
        verifiedAt: "2026-07-28T19:00:05.000Z",
        now: new Date("2026-07-28T19:00:05.000Z"),
        verificationEvidence: publicEvidence(),
      }),
    /release_commitment_confirmed_required/,
  );
  db.close();
});

test("scheduled release stays private before T0 then T0 observation confirms and projects it exactly once", () => {
  const { db, governance } = fixture();
  advanceToPlatformScheduled(governance);
  recordReleaseCommitment(governance);
  const lifecycleBefore = db
    .prepare(
      "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
    )
    .get().count;

  assert.throws(
    () =>
      governance.recordScheduledPlatformPublished({
        storyId: STORY_ID,
        channelId: CHANNEL_ID,
        platform: PLATFORM,
        idempotencyKey: OPERATION_KEY,
        externalId: EXTERNAL_ID,
        scheduledFor: SCHEDULED_FOR,
        requestFingerprint: REQUEST_FINGERPRINT,
        runwayLockSha256: RUNWAY_LOCK_SHA256,
        verifiedAt: "2026-07-28T18:59:59.000Z",
        now: new Date("2026-07-28T18:59:59.000Z"),
        verificationEvidence: publicEvidence({
          checked_at: "2026-07-28T18:59:59.000Z",
        }),
      }),
    /youtube_scheduled_release_not_due/,
  );
  assert.equal(
    governance.getState(STORY_ID, PLATFORM).lifecycle_state,
    "PLATFORM_SCHEDULED",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
      )
      .get().count,
    lifecycleBefore,
  );

  const first = governance.recordScheduledPlatformPublished({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T19:00:05.000Z",
    now: new Date("2026-07-28T19:00:05.000Z"),
    verificationEvidence: publicEvidence(),
  });
  const lifecycleAfterFirst = db
    .prepare(
      "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
    )
    .get().count;
  const ledgerAfterFirst = db
    .prepare(
      "SELECT COUNT(*) AS count FROM platform_dispatch_ledger",
    )
    .get().count;
  const replay = governance.recordScheduledPlatformPublished({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: PLATFORM,
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    verifiedAt: "2026-07-28T19:01:00.000Z",
    now: new Date("2026-07-28T19:01:00.000Z"),
    verificationEvidence: publicEvidence({
      checked_at: "2026-07-28T19:01:00.000Z",
    }),
  });

  assert.equal(first.lifecycle_state, "PUBLISHED");
  assert.equal(replay.lifecycle_state, "PUBLISHED");
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
      )
      .get().count,
    lifecycleAfterFirst,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_dispatch_ledger",
      )
      .get().count,
    ledgerAfterFirst,
  );
  assert.deepEqual(
    db
      .prepare(
        `SELECT to_state
         FROM publication_lifecycle_events
         WHERE story_id = ?
           AND to_state IN ('PLATFORM_CONFIRMED', 'PUBLISHED')
         ORDER BY id`,
      )
      .all(STORY_ID)
      .map((row) => row.to_state),
    ["PLATFORM_CONFIRMED", "PUBLISHED"],
  );
  db.close();
});
