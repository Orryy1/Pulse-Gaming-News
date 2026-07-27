"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const previousUseSqlite = process.env.USE_SQLITE;
process.env.USE_SQLITE = "false";
const {
  LEGACY_SCHEDULER_PROFILE,
  STABILISATION_SCHEDULER_PROFILE,
  schedulesForProfile,
  seed,
} = require("../../lib/scheduler");

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      channel_id TEXT,
      cron_expr TEXT NOT NULL,
      payload TEXT,
      enabled INTEGER DEFAULT 1,
      last_enqueued_at TEXT,
      next_run_at TEXT,
      requires_gpu INTEGER DEFAULT 0,
      priority INTEGER DEFAULT 50
    );
  `);
  const insert = db.prepare(`
    INSERT INTO schedules
      (name, kind, cron_expr, payload, enabled, requires_gpu, priority)
    VALUES (?, ?, ?, '{}', ?, 0, 50)
  `);
  insert.run("publish_primary", "stale_kind", "0 1 * * *", 0);
  insert.run("publish_afternoon", "publish", "0 14 * * *", 1);
  insert.run("weekly_roundup", "roundup_weekly", "0 14 * * 0", 1);
  insert.run("custom_outside_profile", "custom", "0 0 * * *", 1);
  return db;
}

test("profile-aware seed uses injected repositories, refreshes intended rows and disables the rest", (t) => {
  t.after(() => {
    if (previousUseSqlite === undefined) delete process.env.USE_SQLITE;
    else process.env.USE_SQLITE = previousUseSqlite;
  });
  const db = fixture();
  t.after(() => db.close());

  const result = seed({
    repos: { db },
    profile: STABILISATION_SCHEDULER_PROFILE,
    log() {},
  });

  const rows = db.prepare("SELECT * FROM schedules ORDER BY name").all();
  const active = rows.filter((row) => row.enabled === 1);
  assert.deepEqual(
    active.map((row) => row.name),
    schedulesForProfile(STABILISATION_SCHEDULER_PROFILE)
      .map((schedule) => schedule.name)
      .sort(),
  );

  const primary = rows.find((row) => row.name === "publish_primary");
  assert.equal(primary.kind, "publish");
  assert.equal(primary.cron_expr, "0 19 * * *");
  assert.equal(primary.enabled, 1);
  assert.equal(JSON.parse(primary.payload).target_platform, "youtube");

  for (const name of [
    "publish_afternoon",
    "weekly_roundup",
    "custom_outside_profile",
  ]) {
    assert.equal(
      rows.find((row) => row.name === name).enabled,
      0,
      `${name} should be disabled`,
    );
  }
  assert.equal(result.profile, STABILISATION_SCHEDULER_PROFILE);
  assert.ok(result.updated >= 1);
  assert.ok(result.disabled >= 3);
});

test("profile reconciliation rolls every schedule change back when disabling fails", (t) => {
  const db = fixture();
  t.after(() => db.close());
  db.exec(`
    CREATE TRIGGER fail_profile_disable
    BEFORE UPDATE OF enabled ON schedules
    WHEN OLD.name = 'custom_outside_profile' AND NEW.enabled = 0
    BEGIN
      SELECT RAISE(ABORT, 'profile_disable_failed');
    END;
  `);

  assert.throws(
    () =>
      seed({
        repos: { db },
        profile: STABILISATION_SCHEDULER_PROFILE,
        log() {},
      }),
    /profile_disable_failed/,
  );

  const primary = db
    .prepare("SELECT * FROM schedules WHERE name = 'publish_primary'")
    .get();
  const custom = db
    .prepare("SELECT * FROM schedules WHERE name = 'custom_outside_profile'")
    .get();
  assert.equal(primary.kind, "stale_kind");
  assert.equal(primary.cron_expr, "0 1 * * *");
  assert.equal(primary.enabled, 0);
  assert.equal(custom.enabled, 1);
  assert.equal(
    db
      .prepare("SELECT COUNT(*) AS count FROM schedules")
      .get().count,
    4,
  );
});

test("legacy seed retains insert-only behaviour unless reset is requested", (t) => {
  const db = fixture();
  t.after(() => db.close());

  const result = seed({
    repos: { db },
    profile: LEGACY_SCHEDULER_PROFILE,
    log() {},
  });

  const primary = db
    .prepare("SELECT * FROM schedules WHERE name = 'publish_primary'")
    .get();
  const custom = db
    .prepare("SELECT * FROM schedules WHERE name = 'custom_outside_profile'")
    .get();
  assert.equal(primary.kind, "stale_kind");
  assert.equal(primary.cron_expr, "0 1 * * *");
  assert.equal(primary.enabled, 0);
  assert.equal(custom.enabled, 1);
  assert.equal(result.profile, LEGACY_SCHEDULER_PROFILE);
  assert.equal(result.disabled, 0);
});
