"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const GOVERNANCE_MIGRATION = path.join(
  MIGRATIONS,
  "020_stabilisation_governance.sql",
);

function migrateThrough(db, lastMigration = null) {
  const files = fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
    .filter((name) => !lastMigration || name <= lastMigration);
  for (const file of files) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, file), "utf8"));
  }
}

function migratedDatabase() {
  const db = new Database(":memory:");
  migrateThrough(db);
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

test("migration creates lifecycle, dispatch, projection, lease and audit controls", () => {
  const db = migratedDatabase();
  for (const table of [
    "publication_lifecycle_events",
    "platform_dispatch_ledger",
    "platform_publication_state",
    "runtime_leases",
    "operator_audit_log",
  ]) {
    assert.ok(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(table),
      table,
    );
  }

  db.prepare(
    `INSERT INTO platform_dispatch_ledger
       (story_id, platform, idempotency_key, event_type)
     VALUES (?, ?, ?, ?)`,
  ).run("story-1", "youtube", "yt:story-1", "DISPATCH_STARTED");
  assert.throws(
    () =>
      db
        .prepare(
          "UPDATE platform_dispatch_ledger SET event_type = ? WHERE id = 1",
        )
        .run("PUBLISHED"),
    /immutable_platform_dispatch_ledger/,
  );
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO platform_dispatch_ledger
             (story_id, platform, idempotency_key, event_type)
           VALUES (?, ?, ?, ?)`,
        )
        .run("story-2", "youtube", "yt:story-1", "DISPATCH_STARTED"),
    /UNIQUE constraint failed/,
  );
  db.prepare(
    `INSERT INTO operator_audit_log
       (actor_id, action, idempotency_key)
     VALUES (?, ?, ?)`,
  ).run("operator-1", "reconcile_publication", "audit:story-1");
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO operator_audit_log
             (actor_id, action, idempotency_key)
           VALUES (?, ?, ?)`,
        )
        .run("operator-1", "reconcile_publication", "audit:story-1"),
    /UNIQUE constraint failed/,
  );
  db.close();
});

test("external IDs are unique per platform and published state requires proof", () => {
  const db = migratedDatabase();
  db.prepare(
    `INSERT INTO platform_dispatch_ledger
       (story_id, platform, external_id, event_type)
     VALUES (?, ?, ?, ?)`,
  ).run("story-1", "youtube", "external-1", "PLATFORM_OBJECT_CREATED");
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO platform_dispatch_ledger
             (story_id, platform, external_id, event_type)
           VALUES (?, ?, ?, ?)`,
        )
        .run("story-2", "youtube", "external-1", "PLATFORM_OBJECT_CREATED"),
    /UNIQUE constraint failed/,
  );

  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO platform_publication_state
             (story_id, platform, lifecycle_state, external_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run("story-1", "youtube", "PUBLISHED", "external-1"),
    /published_state_requires_platform_verification/,
  );
  const insertPublished = db.prepare(
    `INSERT INTO platform_publication_state
       (story_id, platform, lifecycle_state, external_id,
        verification_status, verified_at, last_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const invalid of [
    ["external-1", null, "2026-07-27T00:00:00.000Z", null],
    [" ", "confirmed", "2026-07-27T00:00:00.000Z", null],
    ["external-1", "confirmed", " ", null],
    ["external-1", "confirmed", "not-a-timestamp", null],
    ["external-1", "confirmed", "2026-07-27T00:00:00.000Z", null],
  ]) {
    assert.throws(
      () =>
        insertPublished.run(
          "story-1",
          "youtube",
          "PUBLISHED",
          ...invalid,
        ),
      /published_state_requires_platform_verification/,
    );
  }
  const publishedLedger = db
    .prepare(
      `INSERT INTO platform_dispatch_ledger
         (story_id, platform, event_type, verification_status,
          verification_evidence_json)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      "story-1",
      "youtube",
      "PUBLISHED",
      "confirmed",
      JSON.stringify({ external_id: "external-1", public: true }),
    );
  assert.doesNotThrow(() =>
    insertPublished.run(
      "story-1",
      "youtube",
      "PUBLISHED",
      "external-1",
      "confirmed",
      "2026-07-27T00:00:00.000Z",
      Number(publishedLedger.lastInsertRowid),
    ),
  );
  assert.throws(
    () =>
      db
        .prepare(
          `UPDATE platform_publication_state
           SET verification_status = NULL
           WHERE story_id = ? AND platform = ?`,
        )
        .run("story-1", "youtube"),
    /published_state_requires_platform_verification/,
  );
  db.close();
});

test("legacy platform post writes cannot introduce duplicate external IDs", () => {
  const db = migratedDatabase();
  db.prepare(
    `INSERT INTO platform_posts
       (story_id, platform, status, external_id)
     VALUES (?, ?, ?, ?)`,
  ).run("story-1", "youtube", "failed", "yt-existing");
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO platform_posts
             (story_id, platform, status, external_id)
           VALUES (?, ?, ?, ?)`,
        )
        .run("story-2", "youtube", "failed", "yt-existing"),
    /duplicate_platform_external_id/,
  );
  db.close();
});

test("migration preserves historical duplicate evidence but blocks new conflicts", () => {
  const db = new Database(":memory:");
  migrateThrough(db, "019_media_provenance.sql");
  for (const [id, title] of [
    ["story-1", "Story one"],
    ["story-2", "Story two"],
  ]) {
    db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(id, title);
  }
  const insert = db.prepare(
    `INSERT INTO platform_posts
       (story_id, platform, status, external_id)
     VALUES (?, ?, ?, ?)`,
  );
  insert.run("story-1", "youtube", "failed", "yt-historical");
  insert.run("story-2", "youtube", "failed", "yt-historical");

  assert.doesNotThrow(() =>
    db.exec(fs.readFileSync(GOVERNANCE_MIGRATION, "utf8")),
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_posts WHERE external_id = ?",
      )
      .get("yt-historical").count,
    2,
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-3",
    "Story three",
  );
  assert.throws(
    () => insert.run("story-3", "youtube", "failed", "yt-historical"),
    /duplicate_platform_external_id/,
  );
  db.close();
});

test("migration is re-runnable and rolls back atomically on failure", () => {
  const sql = fs.readFileSync(GOVERNANCE_MIGRATION, "utf8");
  const reapplied = migratedDatabase();
  assert.doesNotThrow(() => reapplied.exec(sql));
  reapplied.close();

  const rollback = new Database(":memory:");
  migrateThrough(rollback, "019_media_provenance.sql");
  const applyThenFail = rollback.transaction(() => {
    rollback.exec(sql);
    throw new Error("simulated_change_window_failure");
  });
  assert.throws(() => applyThenFail(), /simulated_change_window_failure/);
  assert.equal(
    rollback
      .prepare(
        `SELECT COUNT(*) AS count
         FROM sqlite_master
         WHERE type = 'table' AND name = 'runtime_leases'`,
      )
      .get().count,
    0,
  );
  rollback.close();
});
