"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  bind: bindPublicationGovernance,
} = require("../../lib/repositories/publication_governance");
const {
  canTransition,
  knownState,
} = require("../../lib/stabilisation/publication-lifecycle");
const {
  resolveCanonicalPrimaryConfirmedDisarm,
} = require("../../lib/services/governed-youtube-reserve-promotion");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const STORY_ID = "youtube-disarm-governance-story";
const CHANNEL_ID = "pulse-gaming";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const PRESTAGE_AT = new Date("2026-07-28T17:50:00.000Z");
const REQUEST_FINGERPRINT = "a".repeat(64);
const RUNWAY_LOCK_SHA256 = "b".repeat(64);
const EXTERNAL_ID = "youtube-disarm-object-1";
const OPERATION_KEY =
  `youtube:${STORY_ID}:${SCHEDULED_FOR}`;

function fixture({ platformScheduled = true } = {}) {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(
      fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"),
    );
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    CHANNEL_ID,
    "Pulse Gaming",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    STORY_ID,
    "Remote schedule disarm fixture",
  );
  const governance = bindPublicationGovernance(db);
  const approval = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "approve_publication",
    targetType: "platform_publication",
    targetId: `${STORY_ID}:youtube`,
    decision: "APPROVED",
    reason: "Exact package reviewed",
    evidence: { exact_review: true },
    idempotencyKey: `${OPERATION_KEY}:approval`,
  });
  const states = {
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
    },
  };
  for (const [state, evidence] of Object.entries(states)) {
    governance.appendLifecycle({
      storyId: STORY_ID,
      platform: "youtube",
      toState: state,
      actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
      actorId: state === "HUMAN_APPROVED" ? "operator-1" : null,
      operatorDecisionId:
        state === "HUMAN_APPROVED" ? approval.id : null,
      evidence,
      idempotencyKey: `${OPERATION_KEY}:lifecycle:${state}`,
    });
  }
  governance.preparePrivateScheduledUpload({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: "youtube",
    idempotencyKey: OPERATION_KEY,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    now: PRESTAGE_AT,
  });
  governance.recordPrivateScheduledPlatformObjectCreated({
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: "youtube",
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    externalUrl:
      `https://www.youtube.com/watch?v=${EXTERNAL_ID}`,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
    now: PRESTAGE_AT,
  });
  if (platformScheduled) {
    governance.recordPlatformScheduled({
      storyId: STORY_ID,
      channelId: CHANNEL_ID,
      platform: "youtube",
      idempotencyKey: OPERATION_KEY,
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      requestFingerprint: REQUEST_FINGERPRINT,
      runwayLockSha256: RUNWAY_LOCK_SHA256,
      verifiedAt: "2026-07-28T17:51:00.000Z",
      verificationEvidence: {
        platform_object_confirmed: true,
        scheduled_release_confirmed: true,
        external_id: EXTERNAL_ID,
        privacy_status: "private",
        publish_at: SCHEDULED_FOR,
        upload_status: "processed",
        processing_status: "succeeded",
      },
      now: new Date("2026-07-28T17:51:00.000Z"),
    });
  }
  return { db, governance };
}

function binding() {
  return {
    storyId: STORY_ID,
    channelId: CHANNEL_ID,
    platform: "youtube",
    idempotencyKey: OPERATION_KEY,
    externalId: EXTERNAL_ID,
    scheduledFor: SCHEDULED_FOR,
    requestFingerprint: REQUEST_FINGERPRINT,
    runwayLockSha256: RUNWAY_LOCK_SHA256,
  };
}

function requestedEvidence() {
  return {
    schema_version: "pulse-youtube-schedule-disarm-request-v1",
    schedule_disarm_requested: true,
    external_id: EXTERNAL_ID,
    reason: "fresh_control_hold_before_commitment",
    requested_at: "2026-07-28T18:30:00.000Z",
    authority: {
      verdict: "DISARM_AUTHORISED",
      checked_at: "2026-07-28T18:30:00.000Z",
    },
  };
}

function confirmedEvidence() {
  return {
    schema_version: "pulse-youtube-schedule-disarm-proof-v1",
    platform_object_confirmed: true,
    schedule_disarm_confirmed: true,
    external_id: EXTERNAL_ID,
    privacy_status: "private",
    publish_at: null,
    checked_at: "2026-07-28T18:30:05.000Z",
    already_disarmed: false,
    update_attempt_started: true,
  };
}

test("requested and confirmed disarm evidence is durable, idempotent and terminal while retaining the exact external identity", () => {
  const { db, governance } = fixture();
  const requested =
    governance.recordScheduledPlatformDisarmRequested({
      ...binding(),
      disarmEvidence: requestedEvidence(),
      now: new Date("2026-07-28T18:30:00.000Z"),
    });
  const requestedReplay =
    governance.recordScheduledPlatformDisarmRequested({
      ...binding(),
      disarmEvidence: {
        ...requestedEvidence(),
        requested_at: "2026-07-28T18:31:00.000Z",
      },
      now: new Date("2026-07-28T18:31:00.000Z"),
    });
  assert.equal(requested.id, requestedReplay.id);
  assert.equal(
    governance.getState(STORY_ID, "youtube").lifecycle_state,
    "PLATFORM_SCHEDULED",
  );

  const first = governance.recordScheduledPlatformDisarmed({
    ...binding(),
    verificationEvidence: confirmedEvidence(),
    verifiedAt: "2026-07-28T18:30:05.000Z",
    now: new Date("2026-07-28T18:30:05.000Z"),
  });
  const replay = governance.recordScheduledPlatformDisarmed({
    ...binding(),
    verificationEvidence: confirmedEvidence(),
    verifiedAt: "2026-07-28T18:30:05.000Z",
    now: new Date("2026-07-28T18:30:05.000Z"),
  });

  assert.equal(first.lifecycle_state, "PLATFORM_SCHEDULE_DISARMED");
  assert.equal(replay.lifecycle_state, "PLATFORM_SCHEDULE_DISARMED");
  assert.equal(first.external_id, EXTERNAL_ID);
  assert.equal(
    first.verification_status,
    "confirmed_private_unscheduled",
  );
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM platform_dispatch_ledger
       WHERE event_type = 'SCHEDULE_DISARM_REQUESTED'`,
    ).get().count,
    1,
  );
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM platform_dispatch_ledger
       WHERE event_type = 'SCHEDULE_DISARM_CONFIRMED'`,
    ).get().count,
    1,
  );
  const event = governance.getLatestLifecycleEvent(
    STORY_ID,
    "youtube",
    "PLATFORM_SCHEDULE_DISARMED",
  );
  const evidence = JSON.parse(event.evidence_json);
  assert.equal(evidence.external_id, EXTERNAL_ID);
  assert.equal(evidence.privacy_status, "private");
  assert.equal(evidence.publish_at, null);
  assert.equal(knownState("PLATFORM_SCHEDULE_DISARMED"), true);
  assert.equal(
    canTransition("PLATFORM_SCHEDULE_DISARMED", "SCHEDULED"),
    false,
  );
  const canonical =
    resolveCanonicalPrimaryConfirmedDisarm(
      {
        db,
        publicationGovernance: governance,
      },
      {
        primary: { story_id: STORY_ID },
        scheduled_for: SCHEDULED_FOR,
        lock_sha256: RUNWAY_LOCK_SHA256,
      },
    );
  assert.equal(canonical.eligible, true);
  assert.equal(canonical.ledger.external_id, null);
  assert.equal(
    canonical.primary_disarm.external_id,
    EXTERNAL_ID,
  );
  assert.equal(
    canonical.primary_disarm.lifecycle_state,
    "PLATFORM_SCHEDULE_DISARMED",
  );
  assert.match(
    canonical.primary_disarm
      .disarm_ledger_event_sha256,
    /^[a-f0-9]{64}$/,
  );
});

test("an uncertain update is durably reconciliation-required and exact remote proof can later close it as disarmed without any re-arm", () => {
  const { db, governance } = fixture();
  governance.recordScheduledPlatformDisarmRequested({
    ...binding(),
    disarmEvidence: requestedEvidence(),
    now: new Date("2026-07-28T18:30:00.000Z"),
  });
  const uncertain =
    governance.recordScheduledPlatformDisarmReconciliationRequired({
      ...binding(),
      error: Object.assign(new Error("update timeout"), {
        code: "youtube_schedule_disarm_update_uncertain",
      }),
      disarmEvidence: {
        external_id: EXTERNAL_ID,
        update_attempt_started: true,
        platform_contacted: true,
      },
      now: new Date("2026-07-28T18:30:01.000Z"),
    });

  assert.equal(
    uncertain.lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  assert.equal(uncertain.external_id, EXTERNAL_ID);
  assert.equal(
    db.prepare(
      `SELECT COUNT(*) AS count
       FROM platform_dispatch_ledger
       WHERE event_type = 'SCHEDULE_DISARM_UNCERTAIN'`,
    ).get().count,
    1,
  );

  const confirmed = governance.recordScheduledPlatformDisarmed({
    ...binding(),
    verificationEvidence: {
      ...confirmedEvidence(),
      already_disarmed: true,
      update_attempt_started: false,
    },
    verifiedAt: "2026-07-28T18:31:00.000Z",
    now: new Date("2026-07-28T18:31:00.000Z"),
  });
  assert.equal(
    confirmed.lifecycle_state,
    "PLATFORM_SCHEDULE_DISARMED",
  );
  assert.equal(
    canTransition(
      "PLATFORM_SCHEDULE_DISARMED",
      "PLATFORM_SCHEDULED",
    ),
    false,
  );
});

test("an exact anchored PLATFORM_OBJECT_CREATED object can be terminally disarmed before processing reaches PLATFORM_SCHEDULED", () => {
  const { governance } = fixture({
    platformScheduled: false,
  });
  assert.equal(
    governance.getState(STORY_ID, "youtube").lifecycle_state,
    "PLATFORM_OBJECT_CREATED",
  );

  governance.recordScheduledPlatformDisarmRequested({
    ...binding(),
    disarmEvidence: requestedEvidence(),
    now: new Date("2026-07-28T18:30:00.000Z"),
  });
  const confirmed = governance.recordScheduledPlatformDisarmed({
    ...binding(),
    verificationEvidence: confirmedEvidence(),
    verifiedAt: "2026-07-28T18:30:05.000Z",
    now: new Date("2026-07-28T18:30:05.000Z"),
  });

  assert.equal(
    confirmed.lifecycle_state,
    "PLATFORM_SCHEDULE_DISARMED",
  );
  assert.equal(confirmed.external_id, EXTERNAL_ID);
  assert.equal(
    canTransition(
      "PLATFORM_OBJECT_CREATED",
      "PLATFORM_SCHEDULE_DISARMED",
    ),
    true,
  );
});
