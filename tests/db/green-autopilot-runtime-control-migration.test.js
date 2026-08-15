"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const { runMigrations } = require("../../lib/migrate");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  return db;
}

function tableNames(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      .map((row) => row.name),
  );
}

function columns(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

test("migration 025 creates durable runtime control tables and fencing columns", () => {
  const db = fixture();
  const names = tableNames(db);
  for (const name of [
    "control_switches",
    "control_switch_events",
    "circuit_breakers",
    "circuit_breaker_events",
    "runtime_components",
    "runtime_component_events",
  ]) assert.equal(names.has(name), true, name);
  assert.ok(columns(db, "runtime_leases").includes("fencing_token"));
  assert.ok(columns(db, "jobs").includes("claim_token"));
  assert.ok(columns(db, "jobs").includes("claim_generation"));
  db.close();
});

test("migration 025 seeds exactly one fail-closed external-mutation switch", () => {
  const db = fixture();
  const row = db.prepare(
    "SELECT * FROM control_switches WHERE name='external_mutations'",
  ).get();
  const events = db.prepare(
    "SELECT * FROM control_switch_events WHERE name='external_mutations' ORDER BY version",
  ).all();
  assert.deepEqual(
    {
      state: row.state,
      version: row.version,
      actor_id: row.actor_id,
      reason: row.reason,
      authority_decision_id: row.authority_decision_id,
    },
    {
      state: "ENGAGED",
      version: 1,
      actor_id: "MIGRATION_025",
      reason: "FAIL_CLOSED_INITIAL_STATE",
      authority_decision_id: null,
    },
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].from_state, null);
  assert.equal(events[0].to_state, "ENGAGED");
  assert.equal(events[0].version, 1);
  db.close();
});

test("switch and runtime event histories are immutable", () => {
  const db = fixture();
  assert.throws(
    () => db.prepare("UPDATE control_switch_events SET reason='x' WHERE id=1").run(),
    /immutable_control_switch_events/,
  );
  db.prepare(`
    INSERT INTO circuit_breakers
      (scope,state,version,failure_count,failure_threshold,updated_at)
    VALUES ('youtube','CLOSED',1,0,3,datetime('now'))
  `).run();
  db.prepare(`
    INSERT INTO circuit_breaker_events
      (scope,version,from_state,to_state,event_type,actor_id,created_at)
    VALUES ('youtube',1,NULL,'CLOSED','INITIAL','test',datetime('now'))
  `).run();
  assert.throws(
    () => db.prepare("DELETE FROM circuit_breaker_events WHERE id=1").run(),
    /immutable_circuit_breaker_events/,
  );
  db.prepare(`
    INSERT INTO runtime_components
      (component_id,instance_key,component_type,role,commit_sha,
       configuration_sha256,process_id,process_started_at,state,
       registered_at,heartbeat_at,expires_at,version)
    VALUES ('worker-1','worker-1','worker','qa',?, ?, 10, ?, 'READY', ?, ?, ?, 1)
  `).run(
    "a".repeat(40),
    "b".repeat(64),
    "2026-08-15T07:00:00.000Z",
    "2026-08-15T07:00:00.000Z",
    "2026-08-15T07:00:00.000Z",
    "2026-08-15T07:01:00.000Z",
  );
  db.prepare(`
    INSERT INTO runtime_component_events
      (component_id,version,from_state,to_state,event_type,created_at)
    VALUES ('worker-1',1,NULL,'READY','REGISTERED',datetime('now'))
  `).run();
  assert.throws(
    () => db.prepare("UPDATE runtime_component_events SET event_type='x' WHERE id=1").run(),
    /immutable_runtime_component_events/,
  );
  db.close();
});

test("database triggers enforce clear authority and monotonic versions", () => {
  const db = fixture();
  assert.throws(
    () => db.prepare(`
      UPDATE control_switches
      SET state='CLEAR', version=2, updated_at=datetime('now'),
          actor_id='operator', reason='clear', authority_decision_id=NULL
      WHERE name='external_mutations'
    `).run(),
    /control_switch_clear_authority_required/,
  );
  assert.throws(
    () => db.prepare(`
      UPDATE control_switches
      SET state='ENGAGED', version=3, updated_at=datetime('now'),
          actor_id='monitor', reason='incident'
      WHERE name='external_mutations'
    `).run(),
    /control_switch_version_transition_invalid/,
  );
  db.prepare(`
    UPDATE control_switches
    SET state='CLEAR', version=2, updated_at=datetime('now'),
        actor_id='operator', reason='reviewed_clear',
        authority_decision_id='decision-1'
    WHERE name='external_mutations'
  `).run();
  const row = db.prepare(
    "SELECT state,version,authority_decision_id FROM control_switches WHERE name='external_mutations'",
  ).get();
  assert.deepEqual(row, {
    state: "CLEAR",
    version: 2,
    authority_decision_id: "decision-1",
  });
  db.close();
});
