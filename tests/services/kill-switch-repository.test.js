"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const { runMigrations } = require("../../lib/migrate");
const killSwitch = require("../../lib/repositories/kill_switch");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  return { db, repo: killSwitch.bind(db) };
}

test("missing state is treated as engaged", () => {
  const { db, repo } = fixture();
  assert.deepEqual(repo.assertClear({ name: "missing" }), {
    clear: false,
    state: "ENGAGED",
    version: 0,
    reason: "missing_control_switch",
  });
  db.close();
});

test("migration seed starts external mutations engaged", () => {
  const { db, repo } = fixture();
  const state = repo.assertClear();
  assert.equal(state.clear, false);
  assert.equal(state.state, "ENGAGED");
  assert.equal(state.version, 1);
  db.close();
});

test("clear requires authority and records an immutable versioned event", () => {
  const { db, repo } = fixture();
  assert.throws(
    () => repo.clear({
      name: "external_mutations",
      actorId: "martin",
      reason: "reviewed",
      expectedVersion: 1,
    }),
    /authority_decision_required/,
  );
  const result = repo.clear({
    name: "external_mutations",
    actorId: "martin",
    reason: "reviewed",
    expectedVersion: 1,
    authorityDecisionId: "decision-1",
    now: "2026-08-15T08:00:00.000Z",
  });
  assert.equal(result.changed, true);
  assert.equal(result.row.state, "CLEAR");
  assert.equal(result.row.version, 2);
  const events = db.prepare(
    "SELECT from_state,to_state,version,authority_decision_id FROM control_switch_events ORDER BY version",
  ).all();
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], {
    from_state: "ENGAGED",
    to_state: "CLEAR",
    version: 2,
    authority_decision_id: "decision-1",
  });
  db.close();
});

test("stale writers cannot overwrite a newer switch version", () => {
  const { db, repo } = fixture();
  repo.clear({
    name: "external_mutations",
    actorId: "martin",
    reason: "reviewed",
    expectedVersion: 1,
    authorityDecisionId: "decision-1",
  });
  assert.throws(
    () => repo.engage({
      name: "external_mutations",
      actorId: "monitor",
      reason: "incident",
      expectedVersion: 1,
    }),
    /stale_control_version/,
  );
  const current = repo.get("external_mutations");
  assert.equal(current.state, "CLEAR");
  assert.equal(current.version, 2);
  db.close();
});

test("engage is idempotent when the switch is already engaged", () => {
  const { db, repo } = fixture();
  const result = repo.engage({
    name: "external_mutations",
    actorId: "monitor",
    reason: "still unsafe",
    expectedVersion: 1,
  });
  assert.equal(result.changed, false);
  assert.equal(result.row.version, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM control_switch_events").get().count,
    1,
  );
  db.close();
});
