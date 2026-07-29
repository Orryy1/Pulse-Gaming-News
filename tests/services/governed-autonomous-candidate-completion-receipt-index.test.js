"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const {
  RECEIPT_SCHEMA_VERSION,
  canonicalSha256,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt");
const {
  indexGovernedAutonomousCandidateCompletionReceipt,
  loadGovernedAutonomousWindowCompletionReceipts,
} = require("../../lib/services/governed-autonomous-candidate-completion-receipt-index");

const SCHEDULED_FOR = "2026-07-30T09:00:00.000Z";
const GENERATED_AT = "2026-07-30T07:25:00.000Z";
const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const SHA_C = "c".repeat(64);
const SHA_D = "d".repeat(64);
const SHA_E = "e".repeat(64);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function receipt({
  storyId = "official-xbox-primary",
  role = "PRIMARY",
  scheduledFor = SCHEDULED_FOR,
  revision = SHA_A,
  fingerprint = SHA_B,
} = {}) {
  const body = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    mode: "LOCAL_PROOF",
    verdict: "GREEN",
    blockers: [],
    generated_at: GENERATED_AT,
    story_id: storyId,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: scheduledFor,
    role,
    candidate_revision_sha256: revision,
    request_fingerprint: fingerprint,
    coordinator_result: {
      path: `output/${storyId}/coordinator.json`,
      file_sha256: SHA_C,
      canonical_sha256: SHA_D,
    },
    staging_result: {
      path: `output/${storyId}/staging.json`,
      file_sha256: SHA_D,
      canonical_sha256: SHA_E,
    },
    preparation_manifest: {
      path: `output/${storyId}/preparation.json`,
      file_sha256: SHA_E,
      canonical_sha256: SHA_C,
    },
    final_mp4: {
      path: `output/${storyId}/final.mp4`,
      file_sha256: SHA_A,
    },
    safety: {
      local_proof_only: true,
      database_mutated: false,
      network_used: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  return {
    ...body,
    receipt_sha256: canonicalSha256(body),
  };
}

function createAuditDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      decision TEXT,
      reason TEXT,
      evidence_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      idempotency_key TEXT
    );
    CREATE UNIQUE INDEX ux_operator_audit_idempotency
      ON operator_audit_log(idempotency_key)
      WHERE idempotency_key IS NOT NULL;
    CREATE TRIGGER trg_operator_audit_log_immutable_update
    BEFORE UPDATE ON operator_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'immutable_operator_audit_log');
    END;
    CREATE TRIGGER trg_operator_audit_log_immutable_delete
    BEFORE DELETE ON operator_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'immutable_operator_audit_log');
    END;
  `);
  return db;
}

async function fixture(t, options = {}) {
  const workspaceRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-completion-index-"),
  );
  const db = createAuditDb();
  t.after(async () => {
    db.close();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });
  const value = receipt(options);
  const relativePath =
    `output/${value.story_id}/${value.role.toLowerCase()}-receipt.json`;
  const absolutePath = path.join(
    workspaceRoot,
    ...relativePath.split("/"),
  );
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(absolutePath, bytes);
  return {
    db,
    workspaceRoot,
    receipt: value,
    receiptRef: {
      path: relativePath,
      file_sha256: sha256(bytes),
    },
  };
}

async function writeAndIndexReceipt(input, value) {
  const relativePath =
    `output/${value.story_id}/${value.role.toLowerCase()}-receipt.json`;
  const absolutePath = path.join(
    input.workspaceRoot,
    ...relativePath.split("/"),
  );
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  const bytes = Buffer.from(
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(absolutePath, bytes);
  return indexGovernedAutonomousCandidateCompletionReceipt({
    db: input.db,
    workspaceRoot: input.workspaceRoot,
    receiptRef: {
      path: relativePath,
      file_sha256: sha256(bytes),
    },
  });
}

function insertIndexedEvidence(db, evidence) {
  const idempotencyKey =
    "governed-autonomous-candidate-materialised:v1:" +
    canonicalSha256({
      channel_id: evidence.channel_id,
      lane_id: evidence.lane_id,
      platform: evidence.platform,
      scheduled_for: evidence.scheduled_for,
      role: evidence.role,
    });
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "system:governed-autonomous-production",
    "governed_autonomous_candidate_materialised",
    "governed_autonomous_candidate",
    evidence.story_id,
    "RECORDED_GREEN",
    "Immutable GREEN production completion receipt recorded without approval, scheduler or publish authority.",
    JSON.stringify(evidence),
    idempotencyKey,
  );
}

test("indexes one immutable non-authority GREEN completion receipt and replays idempotently", async (t) => {
  const input = await fixture(t);

  const first =
    await indexGovernedAutonomousCandidateCompletionReceipt(input);
  const replay =
    await indexGovernedAutonomousCandidateCompletionReceipt(input);
  const rows = input.db
    .prepare("SELECT * FROM operator_audit_log ORDER BY id")
    .all();

  assert.equal(first.status, "INDEXED");
  assert.equal(replay.status, "REPLAYED");
  assert.equal(first.audit_id, replay.audit_id);
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].actor_id,
    "system:governed-autonomous-production",
  );
  assert.equal(
    rows[0].action,
    "governed_autonomous_candidate_materialised",
  );
  assert.equal(rows[0].target_type, "governed_autonomous_candidate");
  assert.equal(rows[0].target_id, input.receipt.story_id);
  assert.equal(rows[0].decision, "RECORDED_GREEN");
  assert.notEqual(rows[0].decision, "APPROVED");
  assert.match(
    rows[0].idempotency_key,
    /^governed-autonomous-candidate-materialised:v1:[a-f0-9]{64}$/,
  );
  const evidence = JSON.parse(rows[0].evidence_json);
  assert.deepEqual(evidence, {
    schema_version:
      "pulse-governed-autonomous-candidate-completion-index-v1",
    receipt_ref: {
      path: input.receiptRef.path,
      file_sha256: input.receiptRef.file_sha256,
      receipt_sha256: input.receipt.receipt_sha256,
    },
    story_id: input.receipt.story_id,
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    scheduled_for: SCHEDULED_FOR,
    role: "PRIMARY",
    candidate_revision_sha256:
      input.receipt.candidate_revision_sha256,
    request_fingerprint: input.receipt.request_fingerprint,
  });
  assert.throws(
    () =>
      input.db
        .prepare("UPDATE operator_audit_log SET decision = 'APPROVED'")
        .run(),
    /immutable_operator_audit_log/,
  );
  assert.deepEqual(first.receipt, input.receipt);
});

test("rejects a conflicting replay for the same guarded window role", async (t) => {
  const input = await fixture(t);
  await indexGovernedAutonomousCandidateCompletionReceipt(input);

  const changedBody = {
    ...input.receipt,
    request_fingerprint: SHA_E,
  };
  delete changedBody.receipt_sha256;
  const changed = {
    ...changedBody,
    receipt_sha256: canonicalSha256(changedBody),
  };
  const absolutePath = path.join(
    input.workspaceRoot,
    ...input.receiptRef.path.split("/"),
  );
  const bytes = Buffer.from(
    `${JSON.stringify(changed, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(absolutePath, bytes);
  input.receiptRef.file_sha256 = sha256(bytes);

  await assert.rejects(
    () =>
      indexGovernedAutonomousCandidateCompletionReceipt(input),
    (error) =>
      error?.code ===
      "candidate_completion_index_conflicting_replay",
  );
  assert.equal(
    input.db
      .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
      .get().count,
    1,
  );
});

test("loads exactly one revalidated PRIMARY and one revalidated STANDBY from the audit index", async (t) => {
  const input = await fixture(t);
  await indexGovernedAutonomousCandidateCompletionReceipt(input);
  const standby = receipt({
    storyId: "official-xbox-standby",
    role: "STANDBY",
    revision: SHA_D,
    fingerprint: SHA_E,
  });
  const standbyPath =
    "output/official-xbox-standby/standby-receipt.json";
  const standbyAbsolutePath = path.join(
    input.workspaceRoot,
    ...standbyPath.split("/"),
  );
  await fs.mkdir(path.dirname(standbyAbsolutePath), {
    recursive: true,
  });
  const standbyBytes = Buffer.from(
    `${JSON.stringify(standby, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(standbyAbsolutePath, standbyBytes);
  await indexGovernedAutonomousCandidateCompletionReceipt({
    db: input.db,
    workspaceRoot: input.workspaceRoot,
    receiptRef: {
      path: standbyPath,
      file_sha256: sha256(standbyBytes),
    },
  });

  const loaded =
    await loadGovernedAutonomousWindowCompletionReceipts({
      db: input.db,
      workspaceRoot: input.workspaceRoot,
      channelId: "pulse-gaming",
      laneId: "breaking_short",
      platform: "youtube",
      scheduledFor: SCHEDULED_FOR,
    });

  assert.equal(loaded.primary.receipt.story_id, input.receipt.story_id);
  assert.equal(loaded.primary.receipt.role, "PRIMARY");
  assert.equal(loaded.standby.receipt.story_id, standby.story_id);
  assert.equal(loaded.standby.receipt.role, "STANDBY");
  assert.equal(loaded.scheduled_for, SCHEDULED_FOR);
  assert.equal(loaded.audit_row_count, 2);
  assert.equal(loaded.source, "operator_audit_log");
});

test("fails closed when either guarded-window role is missing", async (t) => {
  const input = await fixture(t);
  await indexGovernedAutonomousCandidateCompletionReceipt(input);

  await assert.rejects(
    () =>
      loadGovernedAutonomousWindowCompletionReceipts({
        db: input.db,
        workspaceRoot: input.workspaceRoot,
        channelId: "pulse-gaming",
        laneId: "breaking_short",
        platform: "youtube",
        scheduledFor: SCHEDULED_FOR,
      }),
    (error) =>
      error?.code === "candidate_completion_index_standby_missing",
  );
});

test("revalidates indexed files and rejects post-index receipt drift", async (t) => {
  const input = await fixture(t);
  await indexGovernedAutonomousCandidateCompletionReceipt(input);
  const standby = receipt({
    storyId: "official-xbox-standby",
    role: "STANDBY",
    revision: SHA_D,
    fingerprint: SHA_E,
  });
  const standbyPath =
    "output/official-xbox-standby/standby-receipt.json";
  const standbyAbsolutePath = path.join(
    input.workspaceRoot,
    ...standbyPath.split("/"),
  );
  await fs.mkdir(path.dirname(standbyAbsolutePath), {
    recursive: true,
  });
  const standbyBytes = Buffer.from(
    `${JSON.stringify(standby, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(standbyAbsolutePath, standbyBytes);
  await indexGovernedAutonomousCandidateCompletionReceipt({
    db: input.db,
    workspaceRoot: input.workspaceRoot,
    receiptRef: {
      path: standbyPath,
      file_sha256: sha256(standbyBytes),
    },
  });
  const primaryAbsolutePath = path.join(
    input.workspaceRoot,
    ...input.receiptRef.path.split("/"),
  );
  await fs.writeFile(primaryAbsolutePath, "{}\n", "utf8");

  await assert.rejects(
    () =>
      loadGovernedAutonomousWindowCompletionReceipts({
        db: input.db,
        workspaceRoot: input.workspaceRoot,
        channelId: "pulse-gaming",
        laneId: "breaking_short",
        platform: "youtube",
        scheduledFor: SCHEDULED_FOR,
      }),
    (error) =>
      error?.code ===
      "candidate_completion_index_receipt_file_sha256_mismatch",
  );
});

test("rejects duplicate PRIMARY or STANDBY audit-index rows", async (t) => {
  const input = await fixture(t);
  await indexGovernedAutonomousCandidateCompletionReceipt(input);
  await writeAndIndexReceipt(
    input,
    receipt({
      storyId: "official-xbox-standby",
      role: "STANDBY",
      revision: SHA_D,
      fingerprint: SHA_E,
    }),
  );
  input.db.exec("DROP INDEX ux_operator_audit_idempotency");
  const primary = input.db
    .prepare(
      `SELECT *
       FROM operator_audit_log
       WHERE json_extract(evidence_json, '$.role') = 'PRIMARY'`,
    )
    .get();
  input.db
    .prepare(
      `INSERT INTO operator_audit_log
         (actor_id, action, target_type, target_id, decision, reason,
          evidence_json, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      primary.actor_id,
      primary.action,
      primary.target_type,
      primary.target_id,
      primary.decision,
      primary.reason,
      primary.evidence_json,
      primary.idempotency_key,
    );

  await assert.rejects(
    () =>
      loadGovernedAutonomousWindowCompletionReceipts({
        db: input.db,
        workspaceRoot: input.workspaceRoot,
        channelId: "pulse-gaming",
        laneId: "breaking_short",
        platform: "youtube",
        scheduledFor: SCHEDULED_FOR,
      }),
    (error) =>
      error?.code ===
      "candidate_completion_index_primary_duplicate",
  );
});

test("rejects an audit row that points across guarded windows", async (t) => {
  const input = await fixture(t, {
    scheduledFor: "2026-07-30T19:00:00.000Z",
  });
  insertIndexedEvidence(input.db, {
    schema_version:
      "pulse-governed-autonomous-candidate-completion-index-v1",
    receipt_ref: {
      ...input.receiptRef,
      receipt_sha256: input.receipt.receipt_sha256,
    },
    story_id: input.receipt.story_id,
    channel_id: input.receipt.channel_id,
    lane_id: input.receipt.lane_id,
    platform: input.receipt.platform,
    scheduled_for: SCHEDULED_FOR,
    role: input.receipt.role,
    candidate_revision_sha256:
      input.receipt.candidate_revision_sha256,
    request_fingerprint: input.receipt.request_fingerprint,
  });

  await assert.rejects(
    () =>
      loadGovernedAutonomousWindowCompletionReceipts({
        db: input.db,
        workspaceRoot: input.workspaceRoot,
        channelId: "pulse-gaming",
        laneId: "breaking_short",
        platform: "youtube",
        scheduledFor: SCHEDULED_FOR,
      }),
    (error) =>
      error?.code ===
      "candidate_completion_index_cross_window_receipt",
  );
});

test("rejects an audit row that points across PRIMARY and STANDBY roles", async (t) => {
  const input = await fixture(t, {
    storyId: "official-xbox-standby",
    role: "STANDBY",
  });
  insertIndexedEvidence(input.db, {
    schema_version:
      "pulse-governed-autonomous-candidate-completion-index-v1",
    receipt_ref: {
      ...input.receiptRef,
      receipt_sha256: input.receipt.receipt_sha256,
    },
    story_id: input.receipt.story_id,
    channel_id: input.receipt.channel_id,
    lane_id: input.receipt.lane_id,
    platform: input.receipt.platform,
    scheduled_for: input.receipt.scheduled_for,
    role: "PRIMARY",
    candidate_revision_sha256:
      input.receipt.candidate_revision_sha256,
    request_fingerprint: input.receipt.request_fingerprint,
  });

  await assert.rejects(
    () =>
      loadGovernedAutonomousWindowCompletionReceipts({
        db: input.db,
        workspaceRoot: input.workspaceRoot,
        channelId: "pulse-gaming",
        laneId: "breaking_short",
        platform: "youtube",
        scheduledFor: SCHEDULED_FOR,
      }),
    (error) =>
      error?.code ===
      "candidate_completion_index_cross_role_receipt",
  );
});

test("refuses receipt paths that escape or traverse a linked workspace component", async (t) => {
  const traversal = await fixture(t);
  traversal.receiptRef.path = "../outside-receipt.json";
  await assert.rejects(
    () =>
      indexGovernedAutonomousCandidateCompletionReceipt(traversal),
    (error) =>
      error?.code ===
      "candidate_completion_index_receipt_ref_invalid",
  );

  const linked = await fixture(t);
  const outsideRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-completion-outside-"),
  );
  t.after(() =>
    fs.rm(outsideRoot, { recursive: true, force: true }),
  );
  const linkedReceiptPath = path.join(outsideRoot, "receipt.json");
  const linkedBytes = Buffer.from(
    `${JSON.stringify(linked.receipt, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(linkedReceiptPath, linkedBytes);
  const linkPath = path.join(linked.workspaceRoot, "linked");
  await fs.symlink(
    outsideRoot,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
  linked.receiptRef = {
    path: "linked/receipt.json",
    file_sha256: sha256(linkedBytes),
  };
  await assert.rejects(
    () => indexGovernedAutonomousCandidateCompletionReceipt(linked),
    (error) =>
      error?.code ===
      "candidate_completion_index_receipt_link_forbidden",
  );
});

test("revalidates the strict receipt contract before recording GREEN", async (t) => {
  const input = await fixture(t);
  const unsafeBody = structuredClone(input.receipt);
  delete unsafeBody.receipt_sha256;
  unsafeBody.safety.publish_authority = true;
  const unsafe = {
    ...unsafeBody,
    receipt_sha256: canonicalSha256(unsafeBody),
  };
  const absolutePath = path.join(
    input.workspaceRoot,
    ...input.receiptRef.path.split("/"),
  );
  const bytes = Buffer.from(
    `${JSON.stringify(unsafe, null, 2)}\n`,
    "utf8",
  );
  await fs.writeFile(absolutePath, bytes);
  input.receiptRef.file_sha256 = sha256(bytes);

  await assert.rejects(
    () =>
      indexGovernedAutonomousCandidateCompletionReceipt(input),
    (error) =>
      error?.code ===
      "candidate_completion_publish_authority_forbidden",
  );
  assert.equal(
    input.db
      .prepare("SELECT COUNT(*) AS count FROM operator_audit_log")
      .get().count,
    0,
  );
});

test("requires immutable audit triggers and unique idempotency before indexing", async (t) => {
  const mutable = await fixture(t);
  mutable.db.exec(
    "DROP TRIGGER trg_operator_audit_log_immutable_update",
  );
  await assert.rejects(
    () =>
      indexGovernedAutonomousCandidateCompletionReceipt(mutable),
    (error) =>
      error?.code ===
      "candidate_completion_index_audit_immutability_required",
  );

  const nonIdempotent = await fixture(t);
  nonIdempotent.db.exec(
    "DROP INDEX ux_operator_audit_idempotency",
  );
  await assert.rejects(
    () =>
      indexGovernedAutonomousCandidateCompletionReceipt(
        nonIdempotent,
      ),
    (error) =>
      error?.code ===
      "candidate_completion_index_audit_idempotency_unique_required",
  );
});
