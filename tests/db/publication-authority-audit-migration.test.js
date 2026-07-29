"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-2",
    "Story two",
  );
  return db;
}

function insertAuthority(
  db,
  {
    storyId = "story-1",
    platform = "youtube",
    authorityType = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    bindingSha256 = "a".repeat(64),
    lifecycleIdempotencyKey = "story-1:youtube:autonomous-approval",
    idempotencyKey = "authority:story-1:youtube:approval",
  } = {},
) {
  return db
    .prepare(
      `INSERT INTO publication_authority_audit_log
         (story_id, platform, authority_type, decision, reason,
          evidence_json, authority_binding_sha256,
          lifecycle_idempotency_key, idempotency_key)
       VALUES (?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?)`,
    )
    .run(
      storyId,
      platform,
      authorityType,
      "All autonomous authority gates passed",
      JSON.stringify({
        exact_candidate_bound: true,
        authority_binding_sha256: bindingSha256,
      }),
      bindingSha256,
      lifecycleIdempotencyKey,
      idempotencyKey,
    );
}

test("migration 024 creates an operator-free immutable publication authority audit", () => {
  const db = fixture();
  const columns = db
    .prepare("PRAGMA table_info(publication_authority_audit_log)")
    .all()
    .map((column) => column.name);

  assert.deepEqual(columns, [
    "id",
    "story_id",
    "platform",
    "authority_type",
    "decision",
    "reason",
    "evidence_json",
    "authority_binding_sha256",
    "lifecycle_idempotency_key",
    "idempotency_key",
    "created_at",
  ]);
  assert.equal(
    columns.some((column) => /actor|operator/i.test(column)),
    false,
  );

  const authorityId = Number(insertAuthority(db).lastInsertRowid);
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE publication_authority_audit_log SET reason = 'changed' WHERE id = ?",
        )
        .run(authorityId),
    /immutable_publication_authority_audit_log/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          "DELETE FROM publication_authority_audit_log WHERE id = ?",
        )
        .run(authorityId),
    /immutable_publication_authority_audit_log/,
  );
  db.close();
});

test("publication authority identities, candidate bindings and lifecycle uses are single-use", () => {
  const db = fixture();
  const authorityId = Number(insertAuthority(db).lastInsertRowid);

  assert.throws(
    () =>
      insertAuthority(db, {
        bindingSha256: "b".repeat(64),
        lifecycleIdempotencyKey:
          "story-1:youtube:autonomous-approval:retry",
      }),
    /UNIQUE constraint failed: publication_authority_audit_log.idempotency_key/,
  );
  assert.throws(
    () =>
      insertAuthority(db, {
        idempotencyKey: "authority:story-1:youtube:different-key",
        lifecycleIdempotencyKey:
          "story-1:youtube:autonomous-approval:different",
      }),
    /UNIQUE constraint failed: publication_authority_audit_log.authority_binding_sha256/,
  );

  db.prepare(
    `INSERT INTO publication_lifecycle_events
       (story_id, platform, from_state, to_state, actor_type,
        evidence_json, idempotency_key, publication_authority_audit_id)
     VALUES (?, 'youtube', 'QA_PASSED', 'AUTONOMOUSLY_APPROVED', 'system',
             '{}', ?, ?)`,
  ).run(
    "story-1",
    "story-1:youtube:autonomous-approval",
    authorityId,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO publication_lifecycle_events
             (story_id, platform, from_state, to_state, actor_type,
              evidence_json, idempotency_key,
              publication_authority_audit_id)
           VALUES (?, 'youtube', 'QA_PASSED', 'AUTONOMOUSLY_APPROVED',
                   'system', '{}', ?, ?)`,
        )
        .run(
          "story-2",
          "story-2:youtube:autonomous-approval",
          authorityId,
        ),
    /publication_authority_lifecycle_binding_mismatch|UNIQUE constraint failed: publication_lifecycle_events.publication_authority_audit_id/,
  );
  db.close();
});

test("database lifecycle writes cannot bypass the autonomous authority binding", () => {
  const db = fixture();
  const authorityId = Number(insertAuthority(db).lastInsertRowid);
  const insertLifecycle = db.prepare(
    `INSERT INTO publication_lifecycle_events
       (story_id, platform, from_state, to_state, actor_type,
        evidence_json, idempotency_key, publication_authority_audit_id)
     VALUES (?, ?, 'QA_PASSED', ?, 'system', '{}', ?, ?)`,
  );

  assert.throws(
    () =>
      insertLifecycle.run(
        "story-1",
        "youtube",
        "AUTONOMOUSLY_APPROVED",
        "story-1:youtube:unbacked-approval",
        null,
      ),
    /publication_authority_lifecycle_binding_required/,
  );
  assert.throws(
    () =>
      insertLifecycle.run(
        "story-2",
        "youtube",
        "AUTONOMOUSLY_APPROVED",
        "story-1:youtube:autonomous-approval",
        authorityId,
      ),
    /publication_authority_lifecycle_binding_mismatch/,
  );
  assert.throws(
    () =>
      insertLifecycle.run(
        "story-1",
        "youtube",
        "AUTONOMOUSLY_APPROVED",
        "story-1:youtube:different-lifecycle",
        authorityId,
      ),
    /publication_authority_lifecycle_binding_mismatch/,
  );
  assert.throws(
    () =>
      insertLifecycle.run(
        "story-1",
        "youtube",
        "HUMAN_APPROVED",
        "story-1:youtube:human-approval",
        authorityId,
      ),
    /publication_authority_only_for_autonomous_approval/,
  );
  db.close();
});
