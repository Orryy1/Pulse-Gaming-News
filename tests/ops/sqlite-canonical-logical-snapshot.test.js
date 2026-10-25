"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const Database = require("better-sqlite3");

const {
  canonicalSqliteSnapshotDigest,
} = require("../../lib/ops/sqlite-canonical-logical-snapshot");
const {
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
} = require("../../lib/stabilisation/live-runtime-transition-lease");

test("canonical SQLite digest binds schema objects, rows, sequence and stable pragmas", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE rows (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT); INSERT INTO rows(value) VALUES ('one')",
  );
  const original = canonicalSqliteSnapshotDigest(db);
  db.exec("CREATE INDEX rows_value ON rows(value)");
  assert.notEqual(canonicalSqliteSnapshotDigest(db), original);
  const indexed = canonicalSqliteSnapshotDigest(db);
  db.exec("CREATE VIEW rows_view AS SELECT id FROM rows");
  assert.notEqual(canonicalSqliteSnapshotDigest(db), indexed);
  const viewed = canonicalSqliteSnapshotDigest(db);
  db.exec(
    "CREATE TRIGGER rows_trigger AFTER UPDATE ON rows BEGIN SELECT 1; END",
  );
  assert.notEqual(canonicalSqliteSnapshotDigest(db), viewed);
  const triggered = canonicalSqliteSnapshotDigest(db);
  db.pragma("user_version = 9");
  assert.notEqual(canonicalSqliteSnapshotDigest(db), triggered);
  db.close();
});

test("canonical SQLite digest excludes only the exact live transition lease row", () => {
  const db = new Database(":memory:");
  db.exec(
    "CREATE TABLE runtime_leases (name TEXT PRIMARY KEY, owner_id TEXT, acquired_at TEXT, heartbeat_at TEXT, expires_at TEXT, metadata TEXT)",
  );
  const baseline = canonicalSqliteSnapshotDigest(db);
  db.prepare(
    "INSERT INTO runtime_leases VALUES (?, 'owner', 'a', 'b', 'c', '{}')",
  ).run(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  assert.equal(canonicalSqliteSnapshotDigest(db), baseline);
  db.prepare(
    "INSERT INTO runtime_leases VALUES ('another', 'owner', 'a', 'b', 'c', '{}')",
  ).run();
  assert.notEqual(canonicalSqliteSnapshotDigest(db), baseline);
  db.close();
});

test("canonical operation exclusions retain unrelated NULL authority rows", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE operator_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_id TEXT NOT NULL,
      idempotency_key TEXT
    );
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT
    );
  `);
  const options = {
    excludeOperationRows: {
      audit_idempotency_key: "repair-key",
      operator_audit_sequence: true,
    },
  };
  const baseline = canonicalSqliteSnapshotDigest(db, options);
  db.prepare(
    "INSERT INTO operator_audit_log(actor_id, idempotency_key) VALUES ('repair', 'repair-key')",
  ).run();
  assert.equal(canonicalSqliteSnapshotDigest(db, options), baseline);

  db.prepare(
    "INSERT INTO operator_audit_log(actor_id, idempotency_key) VALUES ('unrelated', NULL)",
  ).run();
  assert.notEqual(canonicalSqliteSnapshotDigest(db, options), baseline);

  const beforeNullLease = canonicalSqliteSnapshotDigest(db, options);
  db.prepare("INSERT INTO runtime_leases(name, owner_id) VALUES (NULL, 'other')").run();
  assert.notEqual(canonicalSqliteSnapshotDigest(db, options), beforeNullLease);

  const beforeNullSequence = canonicalSqliteSnapshotDigest(db, options);
  db.prepare("INSERT INTO sqlite_sequence(name, seq) VALUES (NULL, 99)").run();
  assert.notEqual(canonicalSqliteSnapshotDigest(db, options), beforeNullSequence);
  db.close();
});

test("streaming digest is insertion-order independent and type sensitive", () => {
  const left = new Database(":memory:");
  const right = new Database(":memory:");
  for (const db of [left, right]) db.exec("CREATE TABLE values_table (value)");
  left.exec("INSERT INTO values_table VALUES ('two'), (1), ('one')");
  right.exec("INSERT INTO values_table VALUES ('one'), ('two'), (1)");
  assert.equal(
    canonicalSqliteSnapshotDigest(left),
    canonicalSqliteSnapshotDigest(right),
  );
  right
    .prepare("UPDATE values_table SET value='1' WHERE typeof(value)='integer'")
    .run();
  assert.notEqual(
    canonicalSqliteSnapshotDigest(left),
    canonicalSqliteSnapshotDigest(right),
  );
  left.close();
  right.close();
});

test("canonical SQLite digest preserves distinct full-range INTEGER values", () => {
  const left = new Database(":memory:");
  const right = new Database(":memory:");
  for (const db of [left, right]) {
    db.exec("CREATE TABLE values_table (value INTEGER NOT NULL)");
  }
  left
    .prepare("INSERT INTO values_table(value) VALUES (?)")
    .run(9_007_199_254_740_992n);
  right
    .prepare("INSERT INTO values_table(value) VALUES (?)")
    .run(9_007_199_254_740_993n);

  assert.notEqual(
    canonicalSqliteSnapshotDigest(left),
    canonicalSqliteSnapshotDigest(right),
  );
  left.close();
  right.close();
});

test("canonical SQLite digest distinguishes positive and negative infinity", () => {
  const positive = new Database(":memory:");
  const negative = new Database(":memory:");
  for (const db of [positive, negative]) {
    db.exec("CREATE TABLE values_table (value REAL NOT NULL)");
  }
  positive.exec("INSERT INTO values_table(value) VALUES (1e999)");
  negative.exec("INSERT INTO values_table(value) VALUES (-1e999)");

  assert.notEqual(
    canonicalSqliteSnapshotDigest(positive),
    canonicalSqliteSnapshotDigest(negative),
  );
  positive.close();
  negative.close();
});

test("canonical SQLite digest distinguishes positive and negative zero", () => {
  const positive = new Database(":memory:");
  const negative = new Database(":memory:");
  for (const db of [positive, negative]) {
    db.exec("CREATE TABLE values_table (value)");
  }
  positive.exec("INSERT INTO values_table(value) VALUES (0.0)");
  negative.exec("INSERT INTO values_table(value) VALUES (-0.0)");

  assert.notEqual(
    canonicalSqliteSnapshotDigest(positive),
    canonicalSqliteSnapshotDigest(negative),
  );
  positive.close();
  negative.close();
});

test("canonical SQLite digest orders signed-zero REAL rows independently of insertion order", () => {
  const left = new Database(":memory:");
  const right = new Database(":memory:");
  for (const db of [left, right]) {
    db.exec("CREATE TABLE values_table (value)");
  }
  left.exec("INSERT INTO values_table(value) VALUES (0.0), (-0.0)");
  right.exec("INSERT INTO values_table(value) VALUES (-0.0), (0.0)");

  assert.equal(
    canonicalSqliteSnapshotDigest(left),
    canonicalSqliteSnapshotDigest(right),
  );
  left.close();
  right.close();
});

test("canonical SQLite digest preserves distinct raw TEXT byte sequences", () => {
  const left = new Database(":memory:");
  const right = new Database(":memory:");
  for (const db of [left, right]) {
    db.exec("CREATE TABLE values_table (value TEXT NOT NULL)");
  }
  left.exec("INSERT INTO values_table(value) VALUES (CAST(X'80' AS TEXT))");
  right.exec("INSERT INTO values_table(value) VALUES (CAST(X'81' AS TEXT))");

  assert.notEqual(
    canonicalSqliteSnapshotDigest(left),
    canonicalSqliteSnapshotDigest(right),
  );
  left.close();
  right.close();
});
