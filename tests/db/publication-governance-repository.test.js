"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/publication_governance");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");

function fixture() {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-2",
    "Story two",
  );
  return { db, governance: bind(db) };
}

function lifecycleEvidence(state, extra = {}) {
  const now = new Date().toISOString();
  const evidence = {
    DISCOVERED: { source_discovered: true },
    VERIFIED: { source_verified: true },
    EDITORIALLY_APPROVED: { editorial_approved: true },
    SCRIPT_READY: { script_ready: true },
    ASSETS_CLEARED: { rights_cleared: true },
    RENDERED: { rendered_artifact_verified: true },
    QA_PASSED: { qa_passed: true },
    HUMAN_APPROVED: { human_review_complete: true },
    SCHEDULED: {
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: now,
      scheduled_for: now,
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: "fixture-dispatch-operation",
      request_fingerprint: "a".repeat(64),
    },
  }[state];
  return { ...evidence, ...extra };
}

function advanceToScheduled(
  governance,
  storyId,
  prefix,
  dispatchIdempotencyKey = prefix,
) {
  const approvalAudit = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "approve_publication",
    targetType: "platform_publication",
    targetId: `${storyId}:youtube`,
    decision: "APPROVED",
    reason: "Fixture review complete",
    evidence: { fixture_evidence: true },
    idempotencyKey: `${prefix}:approval-audit`,
  });
  const states = [
    "DISCOVERED",
    "VERIFIED",
    "EDITORIALLY_APPROVED",
    "SCRIPT_READY",
    "ASSETS_CLEARED",
    "RENDERED",
    "QA_PASSED",
    "HUMAN_APPROVED",
    "SCHEDULED",
  ];
  for (const state of states) {
    governance.appendLifecycle({
      storyId,
      platform: "youtube",
      toState: state,
      eventReason: `fixture_evidence:${state}`,
      actorType:
        state === "HUMAN_APPROVED" || state === "SCHEDULED"
          ? "operator"
          : "system",
      actorId:
        state === "HUMAN_APPROVED" || state === "SCHEDULED"
          ? "operator-1"
          : null,
      operatorDecisionId:
        state === "HUMAN_APPROVED" ? approvalAudit.id : null,
      evidence: {
        ...lifecycleEvidence(state),
        ...(state === "HUMAN_APPROVED"
          ? { operator_decision_id: approvalAudit.id }
          : {}),
        ...(state === "SCHEDULED"
          ? { dispatch_idempotency_key: dispatchIdempotencyKey }
          : {}),
      },
      idempotencyKey: `${prefix}:evidence:${state}`,
    });
  }
}

function publishVerified(governance, storyId, key) {
  advanceToScheduled(governance, storyId, key);
  governance.prepareDispatch({
    storyId,
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    actorId: "operator-1",
  });
  governance.recordPlatformObjectCreated({
    storyId,
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    externalId: `yt-${storyId}`,
    externalUrl: `https://youtube.example/yt-${storyId}`,
  });
  governance.recordPlatformConfirmed({
    storyId,
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    verifiedAt: "2026-01-01T12:00:00.000Z",
    now: new Date("2026-01-01T12:00:00.000Z"),
    verificationEvidence: {
      uploader_response_verified: true,
      privacy_status: "public",
      external_id: `yt-${storyId}`,
    },
  });
  return governance.recordPublished({
    storyId,
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    verifiedAt: "2026-01-01T12:00:00.000Z",
    now: new Date("2026-01-01T12:00:00.000Z"),
    verificationEvidence: {
      privacy_status: "public",
      external_id: `yt-${storyId}`,
    },
  });
}

test("repository records an immutable verified publication trail", () => {
  const { db, governance } = fixture();
  const state = publishVerified(
    governance,
    "story-1",
    "youtube:story-1:attempt-1",
  );
  assert.equal(state.lifecycle_state, "PUBLISHED");
  assert.equal(state.external_id, "yt-story-1");
  assert.equal(state.verification_status, "confirmed");
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_dispatch_ledger WHERE story_id = ?",
      )
      .get("story-1").count,
    4,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE publication_lifecycle_events SET to_state = 'RETRACTED' WHERE id = 1",
        )
        .run(),
    /immutable_publication_lifecycle_events/,
  );
  db.close();
});

test("dispatch requires fresh GREEN control-tower and schedule evidence", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:stale-control-tower";
  advanceToScheduled(governance, "story-1", key);

  const scheduled = db
    .prepare(
      `SELECT id, evidence_json
       FROM publication_lifecycle_events
       WHERE story_id = ? AND platform = ? AND to_state = 'SCHEDULED'
       ORDER BY id DESC LIMIT 1`,
    )
    .get("story-1", "youtube");
  assert.ok(scheduled);

  assert.throws(
    () =>
      governance.prepareDispatch({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        now: new Date(Date.now() + 20 * 60 * 1000),
      }),
    /scheduled_control_tower_evidence_stale/,
  );
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "SCHEDULED",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_dispatch_ledger WHERE story_id = ?",
      )
      .get("story-1").count,
    0,
  );
  db.close();
});

test("dispatch cannot substitute a different operation identity after scheduling", () => {
  const { db, governance } = fixture();
  advanceToScheduled(
    governance,
    "story-1",
    "youtube:story-1:approved-operation",
  );
  const scheduled = governance.getLatestLifecycleEvent(
    "story-1",
    "youtube",
    "SCHEDULED",
  );
  assert.equal(scheduled.to_state, "SCHEDULED");
  assert.equal(
    JSON.parse(scheduled.evidence_json).dispatch_idempotency_key,
    "youtube:story-1:approved-operation",
  );

  assert.throws(
    () =>
      governance.prepareDispatch({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:substituted-operation",
      }),
    /scheduled_dispatch_identity_mismatch/,
  );
  assert.throws(
    () =>
      governance.prepareDispatch({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:approved-operation",
        requestFingerprint: "b".repeat(64),
      }),
    /scheduled_request_fingerprint_mismatch/,
  );
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "SCHEDULED",
  );
  db.close();
});

test("SCHEDULED rejects incomplete or non-GREEN dispatch evidence", () => {
  const cases = [
    {
      name: "missing control-tower time",
      patch: { control_tower_checked_at: null },
      error: /scheduled_control_tower_time_required/,
    },
    {
      name: "non-GREEN verdict",
      patch: { control_tower_verdict: "AMBER" },
      error: /scheduled_green_control_tower_required/,
    },
    {
      name: "kill switch not healthy",
      patch: { kill_switch_healthy: false },
      error: /scheduled_healthy_kill_switch_required/,
    },
    {
      name: "invalid operating contract",
      patch: { operating_contract_valid: false },
      error: /scheduled_valid_operating_contract_required/,
    },
    {
      name: "missing dispatch identity",
      patch: { dispatch_idempotency_key: " " },
      error: /scheduled_dispatch_identity_required/,
    },
    {
      name: "invalid request fingerprint",
      patch: { request_fingerprint: "not-a-sha256" },
      error: /scheduled_request_fingerprint_required/,
    },
  ];

  for (const [index, item] of cases.entries()) {
    const { db, governance } = fixture();
    const storyId = "story-1";
    const prefix = `scheduled-proof-${index}`;
    const approvalAudit = governance.recordOperatorDecision({
      actorId: "operator-1",
      action: "approve_publication",
      targetType: "platform_publication",
      targetId: `${storyId}:youtube`,
      decision: "APPROVED",
      reason: "Fixture review complete",
      evidence: { fixture_evidence: true },
      idempotencyKey: `${prefix}:approval-audit`,
    });
    for (const state of [
      "DISCOVERED",
      "VERIFIED",
      "EDITORIALLY_APPROVED",
      "SCRIPT_READY",
      "ASSETS_CLEARED",
      "RENDERED",
      "QA_PASSED",
      "HUMAN_APPROVED",
    ]) {
      governance.appendLifecycle({
        storyId,
        platform: "youtube",
        toState: state,
        actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
        actorId: state === "HUMAN_APPROVED" ? "operator-1" : null,
        operatorDecisionId:
          state === "HUMAN_APPROVED" ? approvalAudit.id : null,
        evidence: lifecycleEvidence(state, {
          ...(state === "HUMAN_APPROVED"
            ? { operator_decision_id: approvalAudit.id }
            : {}),
        }),
        idempotencyKey: `${prefix}:${state}`,
      });
    }

    assert.throws(
      () =>
        governance.appendLifecycle({
          storyId,
          platform: "youtube",
          toState: "SCHEDULED",
          actorType: "operator",
          actorId: "operator-1",
          evidence: lifecycleEvidence("SCHEDULED", item.patch),
          idempotencyKey: `${prefix}:SCHEDULED`,
        }),
      item.error,
      item.name,
    );
    db.close();
  }
});

test("an exact retry is idempotent and does not append duplicate evidence", () => {
  const { db, governance } = fixture();
  const input = {
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:attempt-1",
  };
  advanceToScheduled(governance, "story-1", input.idempotencyKey);
  governance.prepareDispatch(input);
  const before = db
    .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
    .get().count;
  governance.prepareDispatch(input);
  const after = db
    .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
    .get().count;
  assert.equal(after, before);
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "DISPATCH_STARTED",
  );
  db.close();
});

test("idempotency keys cannot be reused for another story", () => {
  const { db, governance } = fixture();
  advanceToScheduled(
    governance,
    "story-1",
    "story-1-evidence",
    "youtube:shared-attempt",
  );
  advanceToScheduled(
    governance,
    "story-2",
    "story-2-evidence",
    "youtube:shared-attempt",
  );
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:shared-attempt",
  });
  assert.throws(
    () =>
      governance.prepareDispatch({
        storyId: "story-2",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:shared-attempt",
      }),
    /publication_idempotency_conflict/,
  );
  assert.equal(
    governance.getState("story-2", "youtube").lifecycle_state,
    "SCHEDULED",
  );
  db.close();
});

test("dispatch refuses to fabricate human approval or scheduling evidence", () => {
  const { db, governance } = fixture();
  assert.throws(
    () =>
      governance.prepareDispatch({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:unscheduled",
      }),
    /dispatch_requires_scheduled_evidence:NONE/,
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
      .get().count,
    0,
  );
  db.close();
});

test("an idempotent dispatch retry cannot regress an already published state", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:attempt-1";
  publishVerified(governance, "story-1", key);
  const before = db
    .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
    .get().count;
  const state = governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    actorId: "operator-1",
  });
  assert.equal(state.lifecycle_state, "PUBLISHED");
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM publication_lifecycle_events")
      .get().count,
    before,
  );
  db.close();
});

test("idempotent object and confirmation retries cannot regress PUBLISHED", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:attempt-1";
  publishVerified(governance, "story-1", key);
  const before = db
    .prepare("SELECT COUNT(*) AS count FROM platform_dispatch_ledger")
    .get().count;

  governance.recordPlatformObjectCreated({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    externalId: "yt-story-1",
    externalUrl: "https://youtube.example/yt-story-1",
  });
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "PUBLISHED",
  );
  governance.recordPlatformConfirmed({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    verifiedAt: "2026-01-01T12:00:00.000Z",
    now: new Date("2026-01-01T12:00:00.000Z"),
    verificationEvidence: {
      uploader_response_verified: true,
      privacy_status: "public",
      external_id: "yt-story-1",
    },
  });
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "PUBLISHED",
  );
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM platform_dispatch_ledger")
      .get().count,
    before,
  );
  db.close();
});

test("an idempotency key cannot be replayed with changed dispatch payload", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:attempt-1";
  advanceToScheduled(governance, "story-1", key);
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    requestFingerprint: "a".repeat(64),
  });
  assert.throws(
    () =>
      governance.prepareDispatch({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        requestFingerprint: "b".repeat(64),
      }),
    /publication_idempotency_conflict/,
  );

  governance.recordPlatformObjectCreated({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    externalId: "yt-story-1",
    externalUrl: "https://youtube.example/yt-story-1",
  });
  assert.throws(
    () =>
      governance.recordPlatformObjectCreated({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        externalId: "yt-different",
        externalUrl: "https://youtube.example/yt-different",
      }),
    /publication_idempotency_conflict/,
  );
  const state = governance.getState("story-1", "youtube");
  assert.equal(state.external_id, "yt-story-1");
  assert.equal(state.lifecycle_state, "PLATFORM_OBJECT_CREATED");
  db.close();
});

test("published verification time is immutable for an operation key", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:attempt-1";
  publishVerified(governance, "story-1", key);
  assert.throws(
    () =>
      governance.recordPublished({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        verifiedAt: "2026-01-01T13:00:00.000Z",
        now: new Date("2026-01-01T13:00:00.000Z"),
        verificationEvidence: {
          privacy_status: "public",
          external_id: "yt-story-1",
        },
      }),
    /publication_idempotency_conflict/,
  );
  assert.equal(
    governance.getState("story-1", "youtube").verified_at,
    "2026-01-01T12:00:00.000Z",
  );
  db.close();
});

test("public mutation boundaries require operation and channel identity", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:attempt-1";
  advanceToScheduled(governance, "story-1", key);
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
  });
  assert.throws(
    () =>
      governance.recordPlatformObjectCreated({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        externalId: "yt-story-1",
      }),
    /publication_operation_idempotency_key_required/,
  );
  assert.throws(
    () =>
      governance.recordPlatformObjectCreated({
        storyId: "story-1",
        platform: "youtube",
        channelId: " ",
        idempotencyKey: key,
        externalId: "yt-story-1",
      }),
    /publication_channel_id_required/,
  );
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "DISPATCH_STARTED",
  );
  db.close();
});

test("ambiguous upload errors remain reconciliation-required", () => {
  const { db, governance } = fixture();
  advanceToScheduled(
    governance,
    "story-1",
    "youtube:story-1:attempt-2",
  );
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:attempt-2",
  });
  const state = governance.recordAmbiguousDispatchFailure({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:attempt-2",
    error: new Error("connection closed after request"),
  });
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  const ledger = db
    .prepare(
      "SELECT retryability_class, event_type FROM platform_dispatch_ledger ORDER BY id DESC LIMIT 1",
    )
    .get();
  assert.deepEqual(ledger, {
    retryability_class: "verify_before_retry",
    event_type: "RECONCILIATION_REQUIRED",
  });
  db.close();
});

test("legacy reconciliation import records uncertainty without fake approvals", () => {
  const { db, governance } = fixture();
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    "pulse-gaming",
    "Pulse Gaming",
  );
  const inserted = db
    .prepare(
      `INSERT INTO platform_posts
         (story_id, channel_id, platform, status, external_id, external_url)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "story-1",
      "pulse-gaming",
      "youtube",
      "failed",
      "yt-existing",
      "https://youtube.example/yt-existing",
    );
  const operatorDecision = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "reconcile_publication_state",
    targetType: "platform_post",
    targetId: String(inserted.lastInsertRowid),
    decision: "VERIFY_FIRST",
    reason: "Legacy state needs verification",
    evidence: { verified_backup_id: "backup-1" },
    idempotencyKey: "legacy-reconcile:story-1:audit",
  });
  const input = {
    storyId: "story-1",
    channelId: "pulse-gaming",
    platform: "youtube",
    platformPostId: Number(inserted.lastInsertRowid),
    externalId: "yt-existing",
    externalUrl: "https://youtube.example/yt-existing",
    idempotencyKey: "legacy-reconcile:story-1",
    actorId: "operator-1",
    operatorDecisionId: String(operatorDecision.id),
    evidence: { verified_backup_id: "backup-1" },
  };
  const state = governance.importLegacyReconciliationCandidate(input);
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.equal(state.external_id, "yt-existing");
  assert.deepEqual(
    db
      .prepare(
        `SELECT to_state
         FROM publication_lifecycle_events
         WHERE story_id = ?
         ORDER BY id`,
      )
      .all("story-1")
      .map((row) => row.to_state),
    ["RECONCILIATION_REQUIRED"],
  );
  assert.equal(
    db
      .prepare(
        "SELECT event_type FROM platform_dispatch_ledger WHERE story_id = ?",
      )
      .get("story-1").event_type,
    "LEGACY_RECONCILIATION_IMPORTED",
  );
  assert.equal(
    governance.importLegacyReconciliationCandidate(input).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events WHERE story_id = ?",
      )
      .get("story-1").count,
    1,
  );
  assert.throws(
    () =>
      governance.importLegacyReconciliationCandidate({
        ...input,
        externalId: "yt-different",
      }),
    /publication_idempotency_conflict/,
  );
  db.close();
});

test("operator evidence is append-only and repair candidates are read-only", () => {
  const { db, governance } = fixture();
  db.prepare(
    `INSERT INTO platform_posts
       (story_id, platform, status, external_id)
     VALUES (?, ?, ?, ?)`,
  ).run("story-1", "youtube", "failed", "yt-existing");
  governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "reconcile_platform_state",
    targetType: "story",
    targetId: "story-1",
    decision: "VERIFY_FIRST",
    reason: "External ID is present",
  });
  const candidates = governance.listReconciliationCandidates();
  assert.equal(candidates.length, 1);
  assert.deepEqual(
    {
      platform_post_id: candidates[0].platform_post_id,
      story_id: candidates[0].story_id,
      platform: candidates[0].platform,
      external_id: candidates[0].external_id,
    },
    {
      platform_post_id: 1,
      story_id: "story-1",
      platform: "youtube",
      external_id: "yt-existing",
    },
  );
  assert.throws(
    () => db.prepare("DELETE FROM operator_audit_log").run(),
    /immutable_operator_audit_log/,
  );
  db.close();
});

test("reconciliation inventory exposes governed and stale identity-less ambiguity", () => {
  const { db, governance } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-3",
    "Story three",
  );
  const insertPost = db.prepare(
    `INSERT INTO platform_posts
       (story_id, platform, status, created_at, updated_at)
     VALUES (?, 'youtube', ?, ?, ?)`,
  );
  const governedPost = insertPost.run(
    "story-1",
    "failed",
    "2026-07-27 12:54:00",
    "2026-07-27 12:55:00",
  );
  const staleDispatchPost = insertPost.run(
    "story-2",
    "pending",
    "2026-07-27 12:29:00",
    "2026-07-27 12:30:00",
  );
  insertPost.run(
    "story-3",
    "pending",
    "2026-07-27 12:58:00",
    "2026-07-27 12:59:00",
  );
  const insertState = db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state, verification_status, updated_at)
     VALUES (?, 'youtube', ?, ?, ?)`,
  );
  insertState.run(
    "story-1",
    "RECONCILIATION_REQUIRED",
    "requires_reconciliation",
    "2026-07-27 12:55:00",
  );
  insertState.run(
    "story-2",
    "DISPATCH_STARTED",
    "pending",
    "2026-07-27 12:30:00",
  );
  insertState.run(
    "story-3",
    "DISPATCH_STARTED",
    "pending",
    "2026-07-27 12:59:00",
  );

  const candidates = governance.listReconciliationCandidates({
    now: new Date("2026-07-27T13:00:00.000Z"),
    staleDispatchAfterMs: 15 * 60 * 1000,
  });

  assert.deepEqual(
    candidates.map((candidate) => ({
      id: candidate.platform_post_id,
      state: candidate.state,
      reason: candidate.reason,
      age_seconds: candidate.age_seconds,
      action: candidate.action,
      identity_present: candidate.identity_present,
    })),
    [
      {
        id: Number(staleDispatchPost.lastInsertRowid),
        state: "DISPATCH_STARTED",
        reason: "stale_dispatch_started",
        age_seconds: 1800,
        action: "discover_platform_identity",
        identity_present: false,
      },
      {
        id: Number(governedPost.lastInsertRowid),
        state: "RECONCILIATION_REQUIRED",
        reason: "governed_reconciliation_identity_missing",
        age_seconds: 300,
        action: "discover_platform_identity",
        identity_present: false,
      },
    ],
  );
  assert.equal(
    candidates.some(
      (candidate) =>
        candidate.story_id === "story-3" &&
        candidate.state === "DISPATCH_STARTED",
    ),
    false,
  );
  db.close();
});

test("appendLifecycle rejects caller-supplied history and direct PUBLISHED", () => {
  const { db, governance } = fixture();
  governance.appendLifecycle({
    storyId: "story-1",
    platform: "youtube",
    toState: "DISCOVERED",
    evidence: { source: "fixture" },
    idempotencyKey: "story-1:discovered",
  });
  assert.throws(
    () =>
      governance.appendLifecycle({
        storyId: "story-1",
        platform: "youtube",
        fromState: "SCHEDULED",
        toState: "VERIFIED",
        evidence: lifecycleEvidence("VERIFIED", { fabricated: true }),
        idempotencyKey: "story-1:fabricated-dispatch",
      }),
    /lifecycle_from_state_conflict/,
  );
  assert.throws(
    () =>
      governance.appendLifecycle({
        storyId: "story-1",
        platform: "youtube",
        toState: "PUBLISHED",
        evidence: { fabricated: true },
        idempotencyKey: "story-1:direct-published",
      }),
    /published_state_requires_specialised_operation/,
  );
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "DISCOVERED",
  );
  db.close();
});

test("proof-bearing lifecycle states require state-specific evidence", () => {
  const { db, governance } = fixture();
  governance.appendLifecycle({
    storyId: "story-1",
    platform: "youtube",
    toState: "DISCOVERED",
    evidence: lifecycleEvidence("DISCOVERED"),
    idempotencyKey: "story-1:evidence-schema:DISCOVERED",
  });
  assert.throws(
    () =>
      governance.appendLifecycle({
        storyId: "story-1",
        platform: "youtube",
        toState: "VERIFIED",
        evidence: { generic_claim: true },
        idempotencyKey: "story-1:evidence-schema:forged",
      }),
    /lifecycle_evidence_required:VERIFIED/,
  );
  governance.appendLifecycle({
    storyId: "story-1",
    platform: "youtube",
    toState: "VERIFIED",
    evidence: lifecycleEvidence("VERIFIED"),
    idempotencyKey: "story-1:evidence-schema:VERIFIED",
  });
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "VERIFIED",
  );
  db.close();
});

test("human approval requires a matching immutable operator decision", () => {
  const { db, governance } = fixture();
  for (const state of [
    "DISCOVERED",
    "VERIFIED",
    "EDITORIALLY_APPROVED",
    "SCRIPT_READY",
    "ASSETS_CLEARED",
    "RENDERED",
    "QA_PASSED",
  ]) {
    governance.appendLifecycle({
      storyId: "story-1",
      platform: "youtube",
      toState: state,
      evidence: lifecycleEvidence(state),
      idempotencyKey: `story-1:approval-gate:${state}`,
    });
  }
  assert.throws(
    () =>
      governance.appendLifecycle({
        storyId: "story-1",
        platform: "youtube",
        toState: "HUMAN_APPROVED",
        evidence: lifecycleEvidence("HUMAN_APPROVED", { claimed: true }),
        idempotencyKey: "story-1:approval-gate:forged",
      }),
    /human_approval_operator_decision_required/,
  );

  const audit = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "approve_publication",
    targetType: "platform_publication",
    targetId: "story-1:youtube",
    decision: "APPROVED",
    reason: "Reviewed the final candidate",
    evidence: { review_complete: true },
    idempotencyKey: "story-1:approval-gate:audit",
  });
  const event = governance.appendLifecycle({
    storyId: "story-1",
    platform: "youtube",
    toState: "HUMAN_APPROVED",
    actorType: "operator",
    actorId: "operator-1",
    operatorDecisionId: audit.id,
    evidence: lifecycleEvidence("HUMAN_APPROVED", {
      operator_decision_id: audit.id,
      review_complete: true,
    }),
    idempotencyKey: "story-1:approval-gate:approved",
  });
  assert.equal(event.actor_type, "operator");
  assert.equal(event.actor_id, "operator-1");
  db.close();
});

test("lifecycle idempotency keys reject changed audit evidence", () => {
  const { db, governance } = fixture();
  governance.appendLifecycle({
    storyId: "story-1",
    platform: "youtube",
    toState: "DISCOVERED",
    eventReason: "first_source",
    actorType: "system",
    evidence: { source: "rss" },
    idempotencyKey: "story-1:discovered",
  });
  assert.throws(
    () =>
      governance.appendLifecycle({
        storyId: "story-1",
        platform: "youtube",
        toState: "DISCOVERED",
        eventReason: "different_source",
        actorType: "operator",
        actorId: "operator-1",
        evidence: { source: "manual" },
        idempotencyKey: "story-1:discovered",
      }),
    /publication_idempotency_conflict/,
  );
  db.close();
});

test("lifecycle event and current-state projection commit atomically", () => {
  const { db, governance } = fixture();
  db.exec(`
    CREATE TRIGGER fail_publication_projection
    BEFORE INSERT ON platform_publication_state
    BEGIN
      SELECT RAISE(ABORT, 'projection_write_failed');
    END;
  `);
  assert.throws(
    () =>
      governance.appendLifecycle({
        storyId: "story-1",
        platform: "youtube",
        toState: "DISCOVERED",
        evidence: { source: "rss" },
        idempotencyKey: "story-1:atomic-discovered",
      }),
    /projection_write_failed/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events",
      )
      .get().count,
    0,
  );
  assert.equal(governance.getState("story-1", "youtube"), null);
  db.close();
});

test("confirmation and publication require meaningful current evidence", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:evidence-gate";
  advanceToScheduled(governance, "story-1", key);
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
  });
  governance.recordPlatformObjectCreated({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    externalId: "yt-evidence",
  });
  assert.throws(
    () =>
      governance.recordPlatformConfirmed({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        verificationEvidence: {},
      }),
    /meaningful_platform_verification_evidence_required/,
  );
  governance.recordPlatformConfirmed({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
    verificationEvidence: {
      uploader_response_verified: true,
      external_id: "yt-evidence",
    },
  });
  assert.throws(
    () =>
      governance.recordPublished({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        verifiedAt: "2099-01-01T00:00:00.000Z",
        now: new Date("2026-01-01T00:00:00.000Z"),
        verificationEvidence: {
          privacy_status: "public",
          external_id: "yt-evidence",
        },
      }),
    /platform_verification_time_in_future/,
  );
  assert.throws(
    () =>
      governance.recordPublished({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        verifiedAt: "2026-01-01T00:00:00.000Z",
        now: new Date("2026-01-01T00:00:00.000Z"),
        verificationEvidence: {
          platform_object_confirmed: true,
          external_id: "yt-evidence",
        },
      }),
    /public_platform_evidence_required/,
  );
  const state = governance.recordPublished({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    verifiedAt: "2026-01-01T00:00:00.000Z",
    now: new Date("2026-01-01T00:00:00.000Z"),
    verificationEvidence: {
      privacy_status: "public",
      external_id: "yt-evidence",
    },
  });
  assert.equal(state.lifecycle_state, "PUBLISHED");
  db.close();
});

test("confirmation and publication evidence must match the current object and be fresh", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:bound-evidence";
  advanceToScheduled(governance, "story-1", key);
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
  });
  governance.recordPlatformObjectCreated({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    externalId: "yt-A",
  });
  assert.throws(
    () =>
      governance.recordPlatformConfirmed({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        verifiedAt: "2026-07-27T11:59:00.000Z",
        now: new Date("2026-07-27T12:00:00.000Z"),
        verificationEvidence: {
          platform_object_confirmed: true,
          external_id: "yt-B",
        },
      }),
    /platform_verification_external_id_mismatch/,
  );
  assert.throws(
    () =>
      governance.recordPlatformConfirmed({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: key,
        verifiedAt: "2000-01-01T00:00:00.000Z",
        now: new Date("2026-07-27T12:00:00.000Z"),
        verificationEvidence: {
          platform_object_confirmed: true,
          external_id: "yt-A",
        },
      }),
    /platform_verification_stale/,
  );
  db.close();
});

test("confirmation failure records verifier evidence without losing the created object identity", () => {
  const { db, governance } = fixture();
  const key = "youtube:story-1:confirmation-failed";
  advanceToScheduled(governance, "story-1", key);
  governance.prepareDispatch({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
  });
  governance.recordPlatformObjectCreated({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    externalId: "yt-confirmation-failed",
    externalUrl: "https://youtube.example/yt-confirmation-failed",
  });

  const state = governance.recordPlatformCreatedConfirmationFailed({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: key,
    error: new Error("platform returned private visibility"),
    verificationEvidence: {
      verification_attempted: true,
      privacy_status: "private",
    },
  });

  assert.equal(state.lifecycle_state, "PLATFORM_CREATED_CONFIRMATION_FAILED");
  assert.equal(state.external_id, "yt-confirmation-failed");
  assert.equal(
    state.external_url,
    "https://youtube.example/yt-confirmation-failed",
  );
  assert.equal(state.verification_status, "requires_reconciliation");
  const event = governance.getLatestLifecycleEvent(
    "story-1",
    "youtube",
    "PLATFORM_CREATED_CONFIRMATION_FAILED",
  );
  assert.deepEqual(JSON.parse(event.evidence_json), {
    error: "platform returned private visibility",
    external_id: "yt-confirmation-failed",
    privacy_status: "private",
    verification_attempted: true,
  });
  const ledger = db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE story_id = ? AND event_type = ?`,
    )
    .get("story-1", "PLATFORM_CREATED_CONFIRMATION_FAILED");
  assert.equal(ledger.retryability_class, "verify_before_retry");
  assert.deepEqual(JSON.parse(ledger.verification_evidence_json), {
    error: "platform returned private visibility",
    external_id: "yt-confirmation-failed",
    privacy_status: "private",
    verification_attempted: true,
  });
  db.close();
});

test("analytics pending is an evidence-bearing publication transition", () => {
  const { db, governance } = fixture();
  publishVerified(
    governance,
    "story-1",
    "youtube:story-1:analytics-pending-published",
  );

  const state = governance.recordAnalyticsPending({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:analytics-pending",
    analyticsEvidence: {
      analytics_collection_requested: true,
      collector: "youtube-analytics",
      requested_at: "2026-01-01T12:05:00.000Z",
    },
  });

  assert.equal(state.lifecycle_state, "ANALYTICS_PENDING");
  assert.equal(state.external_id, "yt-story-1");
  assert.equal(state.verification_status, "confirmed");
  const event = governance.getLatestLifecycleEvent(
    "story-1",
    "youtube",
    "ANALYTICS_PENDING",
  );
  assert.deepEqual(JSON.parse(event.evidence_json), {
    analytics_collection_requested: true,
    collector: "youtube-analytics",
    external_id: "yt-story-1",
    requested_at: "2026-01-01T12:05:00.000Z",
  });
  const ledger = db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE story_id = ? AND event_type = ?`,
    )
    .get("story-1", "ANALYTICS_PENDING");
  assert.equal(ledger.verification_status, "confirmed");
  assert.equal(ledger.retryability_class, "retryable");
  db.close();
});

test("analytics collected stores a timestamped metrics snapshot", () => {
  const { db, governance } = fixture();
  publishVerified(
    governance,
    "story-1",
    "youtube:story-1:analytics-collected-published",
  );
  governance.recordAnalyticsPending({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:analytics-collected-pending",
    analyticsEvidence: {
      analytics_collection_requested: true,
      collector: "youtube-analytics",
      requested_at: "2026-01-01T12:05:00.000Z",
    },
  });

  const state = governance.recordAnalyticsCollected({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:analytics-collected",
    analyticsEvidence: {
      analytics_collected: true,
      collected_at: "2026-01-01T12:10:00.000Z",
      metrics: { likes: 80, views: 1200 },
      source_snapshot_id: "youtube:yt-story-1:2026-01-01T12:10:00.000Z",
    },
  });

  assert.equal(state.lifecycle_state, "ANALYTICS_COLLECTED");
  assert.equal(state.external_id, "yt-story-1");
  assert.equal(state.verification_status, "confirmed");
  const event = governance.getLatestLifecycleEvent(
    "story-1",
    "youtube",
    "ANALYTICS_COLLECTED",
  );
  assert.deepEqual(JSON.parse(event.evidence_json), {
    analytics_collected: true,
    collected_at: "2026-01-01T12:10:00.000Z",
    external_id: "yt-story-1",
    metrics: { likes: 80, views: 1200 },
    source_snapshot_id: "youtube:yt-story-1:2026-01-01T12:10:00.000Z",
  });
  const ledger = db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE story_id = ? AND event_type = ?`,
    )
    .get("story-1", "ANALYTICS_COLLECTED");
  assert.equal(ledger.verification_status, "confirmed");
  assert.equal(ledger.retryability_class, "not_retryable");
  db.close();
});

test("published QA incident preserves publication truth and records incident evidence", () => {
  const { db, governance } = fixture();
  publishVerified(
    governance,
    "story-1",
    "youtube:story-1:qa-incident-published",
  );

  const state = governance.recordPublishedQaIncident({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:qa-incident",
    incidentEvidence: {
      detected_at: "2026-01-01T12:15:00.000Z",
      finding: "public narration does not match the approved script",
      incident_id: "qa-incident-001",
      qa_incident_detected: true,
      severity: "high",
    },
  });

  assert.equal(state.lifecycle_state, "PUBLISHED_QA_INCIDENT");
  assert.equal(state.external_id, "yt-story-1");
  assert.equal(state.verification_status, "confirmed");
  const event = governance.getLatestLifecycleEvent(
    "story-1",
    "youtube",
    "PUBLISHED_QA_INCIDENT",
  );
  assert.deepEqual(JSON.parse(event.evidence_json), {
    detected_at: "2026-01-01T12:15:00.000Z",
    external_id: "yt-story-1",
    finding: "public narration does not match the approved script",
    incident_id: "qa-incident-001",
    qa_incident_detected: true,
    severity: "high",
  });
  const ledger = db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE story_id = ? AND event_type = ?`,
    )
    .get("story-1", "PUBLISHED_QA_INCIDENT");
  assert.equal(ledger.verification_status, "confirmed");
  assert.equal(ledger.retryability_class, "operator_review_required");
  db.close();
});

test("retraction requires an operator decision and fresh platform-side proof", () => {
  const { db, governance } = fixture();
  publishVerified(
    governance,
    "story-1",
    "youtube:story-1:retraction-published",
  );
  governance.recordPublishedQaIncident({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:retraction-incident",
    incidentEvidence: {
      detected_at: "2026-01-01T12:15:00.000Z",
      finding: "public narration does not match the approved script",
      incident_id: "qa-incident-retract-001",
      qa_incident_detected: true,
      severity: "critical",
    },
  });
  const decision = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "retract_publication",
    targetType: "platform_publication",
    targetId: "story-1:youtube",
    decision: "APPROVED",
    reason: "Critical published QA incident verified",
    evidence: { incident_id: "qa-incident-retract-001" },
    idempotencyKey: "youtube:story-1:retraction-decision",
  });

  const state = governance.recordRetracted({
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:retracted",
    actorId: "operator-1",
    operatorDecisionId: decision.id,
    verifiedAt: "2026-01-01T12:20:00.000Z",
    now: new Date("2026-01-01T12:20:00.000Z"),
    retractionEvidence: {
      external_id: "yt-story-1",
      platform_retraction_verified: true,
      reason: "Critical published QA incident",
    },
  });

  assert.equal(state.lifecycle_state, "RETRACTED");
  assert.equal(state.external_id, "yt-story-1");
  assert.equal(state.verification_status, "retracted");
  const event = governance.getLatestLifecycleEvent(
    "story-1",
    "youtube",
    "RETRACTED",
  );
  assert.equal(event.actor_type, "operator");
  assert.equal(event.actor_id, "operator-1");
  assert.deepEqual(JSON.parse(event.evidence_json), {
    external_id: "yt-story-1",
    operator_decision_id: decision.id,
    platform_retraction_verified: true,
    reason: "Critical published QA incident",
    verified_at: "2026-01-01T12:20:00.000Z",
  });
  const ledger = db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE story_id = ? AND event_type = ?`,
    )
    .get("story-1", "RETRACTED");
  assert.equal(ledger.verification_status, "retracted");
  assert.equal(ledger.operator_decision_id, String(decision.id));
  assert.equal(ledger.retryability_class, "not_retryable");
  db.close();
});

test("specialised lifecycle writers fail closed on missing evidence and invalid order", () => {
  const { db, governance } = fixture();
  publishVerified(
    governance,
    "story-1",
    "youtube:story-1:specialised-fail-closed-published",
  );

  assert.throws(
    () =>
      governance.recordAnalyticsPending({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:missing-analytics-evidence",
        analyticsEvidence: {},
      }),
    /analytics_pending_evidence_required/,
  );
  assert.throws(
    () =>
      governance.recordAnalyticsCollected({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:analytics-out-of-order",
        analyticsEvidence: {
          analytics_collected: true,
          collected_at: "2026-01-01T12:10:00.000Z",
          metrics: { views: 1 },
          source_snapshot_id: "snapshot-out-of-order",
        },
      }),
    /invalid_publication_lifecycle_transition:PUBLISHED->ANALYTICS_COLLECTED/,
  );
  assert.throws(
    () =>
      governance.recordPublishedQaIncident({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:missing-incident-evidence",
        incidentEvidence: {},
      }),
    /published_qa_incident_evidence_required/,
  );
  assert.throws(
    () =>
      governance.recordRetracted({
        storyId: "story-1",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: "youtube:story-1:missing-retraction-decision",
        retractionEvidence: {
          external_id: "yt-story-1",
          platform_retraction_verified: true,
          reason: "No operator decision",
        },
      }),
    /retraction_operator_decision_required/,
  );
  assert.equal(
    governance.getState("story-1", "youtube").lifecycle_state,
    "PUBLISHED",
  );

  const confirmationKey = "youtube:story-2:missing-confirmation-evidence";
  advanceToScheduled(governance, "story-2", confirmationKey);
  governance.prepareDispatch({
    storyId: "story-2",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: confirmationKey,
  });
  governance.recordPlatformObjectCreated({
    storyId: "story-2",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: confirmationKey,
    externalId: "yt-story-2",
  });
  assert.throws(
    () =>
      governance.recordPlatformCreatedConfirmationFailed({
        storyId: "story-2",
        platform: "youtube",
        channelId: "pulse-gaming",
        idempotencyKey: confirmationKey,
        error: new Error("verifier unavailable"),
        verificationEvidence: {},
      }),
    /confirmation_failure_verification_evidence_required/,
  );
  assert.equal(
    governance.getState("story-2", "youtube").lifecycle_state,
    "PLATFORM_OBJECT_CREATED",
  );
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM platform_dispatch_ledger
         WHERE event_type IN (
           'PLATFORM_CREATED_CONFIRMATION_FAILED',
           'ANALYTICS_PENDING',
           'ANALYTICS_COLLECTED',
           'PUBLISHED_QA_INCIDENT',
           'RETRACTED'
         )`,
      )
      .get().count,
    0,
  );
  db.close();
});

test("exact retries of completed specialised operations cannot regress a later retraction", () => {
  const { db, governance } = fixture();
  publishVerified(
    governance,
    "story-1",
    "youtube:story-1:specialised-idempotency-published",
  );
  const analyticsPending = {
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:specialised-idempotency-pending",
    analyticsEvidence: {
      analytics_collection_requested: true,
      collector: "youtube-analytics",
      requested_at: "2026-01-01T12:05:00.000Z",
    },
  };
  const analyticsCollected = {
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:specialised-idempotency-collected",
    analyticsEvidence: {
      analytics_collected: true,
      collected_at: "2026-01-01T12:10:00.000Z",
      metrics: { views: 12 },
      source_snapshot_id: "specialised-idempotency-snapshot",
    },
  };
  const incident = {
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:specialised-idempotency-incident",
    incidentEvidence: {
      detected_at: "2026-01-01T12:15:00.000Z",
      finding: "Critical post-publication QA finding",
      incident_id: "specialised-idempotency-incident",
      qa_incident_detected: true,
      severity: "critical",
    },
  };
  governance.recordAnalyticsPending(analyticsPending);
  governance.recordAnalyticsCollected(analyticsCollected);
  governance.recordPublishedQaIncident(incident);
  const decision = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "retract_publication",
    targetType: "platform_publication",
    targetId: "story-1:youtube",
    decision: "APPROVED",
    reason: "Critical incident",
    evidence: { incident_id: "specialised-idempotency-incident" },
    idempotencyKey: "youtube:story-1:specialised-idempotency-decision",
  });
  const retracted = {
    storyId: "story-1",
    platform: "youtube",
    channelId: "pulse-gaming",
    idempotencyKey: "youtube:story-1:specialised-idempotency-retracted",
    actorId: "operator-1",
    operatorDecisionId: decision.id,
    verifiedAt: "2026-01-01T12:20:00.000Z",
    now: new Date("2026-01-01T12:20:00.000Z"),
    retractionEvidence: {
      external_id: "yt-story-1",
      platform_retraction_verified: true,
      reason: "Critical incident",
    },
  };
  governance.recordRetracted(retracted);
  const eventCountBefore = db
    .prepare(
      "SELECT COUNT(*) AS count FROM publication_lifecycle_events WHERE story_id = ?",
    )
    .get("story-1").count;
  const ledgerCountBefore = db
    .prepare(
      "SELECT COUNT(*) AS count FROM platform_dispatch_ledger WHERE story_id = ?",
    )
    .get("story-1").count;

  assert.equal(
    governance.recordAnalyticsPending(analyticsPending).lifecycle_state,
    "RETRACTED",
  );
  assert.equal(
    governance.recordAnalyticsCollected(analyticsCollected).lifecycle_state,
    "RETRACTED",
  );
  assert.equal(
    governance.recordPublishedQaIncident(incident).lifecycle_state,
    "RETRACTED",
  );
  assert.equal(
    governance.recordRetracted(retracted).lifecycle_state,
    "RETRACTED",
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM publication_lifecycle_events WHERE story_id = ?",
      )
      .get("story-1").count,
    eventCountBefore,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_dispatch_ledger WHERE story_id = ?",
      )
      .get("story-1").count,
    ledgerCountBefore,
  );
  db.close();
});
