"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const { runMigrations } = require("../../lib/migrate");
const killSwitchRepo = require("../../lib/repositories/kill_switch");
const { buildKillSwitchService } = require("../../lib/services/kill-switch");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  return { db, repo: killSwitchRepo.bind(db) };
}

function clear(repo) {
  return repo.clear({
    name: "external_mutations",
    actorId: "operator",
    reason: "reviewed shadow activation",
    expectedVersion: 1,
    authorityDecisionId: "decision-clear-1",
    now: "2026-08-15T10:00:00.000Z",
  });
}

test("missing durable state blocks external mutation", () => {
  const { db, repo } = fixture();
  const service = buildKillSwitchService({ repo });
  assert.throws(
    () => service.assertExternalMutationAllowed(),
    /kill_switch_engaged/,
  );
  assert.equal(service.status().state, "ENGAGED");
  db.close();
});

test("restart and environment clear cannot clear an engaged durable switch", () => {
  const { db, repo } = fixture();
  clear(repo);
  const first = buildKillSwitchService({ repo });
  assert.equal(first.assertExternalMutationAllowed().version, 2);
  repo.engage({
    name: "external_mutations",
    actorId: "monitor",
    reason: "incident",
    expectedVersion: 2,
    now: "2026-08-15T10:01:00.000Z",
  });
  const reopened = buildKillSwitchService({
    repo: killSwitchRepo.bind(db),
    forcedEngaged: false,
  });
  assert.throws(
    () => reopened.assertExternalMutationAllowed(),
    /kill_switch_engaged/,
  );
  db.close();
});

test("a forced safety override blocks a durably clear switch", () => {
  const { db, repo } = fixture();
  clear(repo);
  const service = buildKillSwitchService({ repo, forcedEngaged: true });
  assert.equal(service.status().forced_engaged, true);
  assert.throws(
    () => service.assertExternalMutationAllowed(),
    /kill_switch_engaged/,
  );
  assert.throws(
    () => service.clear({
      actorId: "operator",
      reason: "cannot override",
      expectedVersion: 2,
      authorityDecisionId: "decision-2",
    }),
    /kill_switch_forced_engaged/,
  );
  db.close();
});

test("mutation boundary rejects a stale expected version", () => {
  const { db, repo } = fixture();
  clear(repo);
  const service = buildKillSwitchService({ repo });
  assert.throws(
    () => service.assertExternalMutationAllowed({ expectedVersion: 1 }),
    /kill_switch_version_changed/,
  );
  assert.equal(
    service.assertExternalMutationAllowed({ expectedVersion: 2 }).clear,
    true,
  );
  db.close();
});
