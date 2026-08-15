"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const { runMigrations } = require("../../lib/migrate");
const circuitBreakers = require("../../lib/repositories/circuit_breakers");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  let token = 0;
  return {
    db,
    repo: circuitBreakers.bind(db, {
      tokenFactory: () => `probe-${++token}`,
    }),
  };
}

test("a missing circuit is permissive and does not mutate the database", () => {
  const { db, repo } = fixture();
  assert.deepEqual(repo.beforeAttempt({ scope: "youtube" }), {
    allowed: true,
    state: "CLOSED",
    version: 0,
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM circuit_breakers").get().count, 0);
  db.close();
});

test("failure threshold opens the circuit durably", () => {
  const { db, repo } = fixture();
  const first = repo.recordFailure({
    scope: "youtube",
    actorId: "publisher",
    errorClass: "transport",
    threshold: 2,
    cooldownMs: 60000,
    now: "2026-08-15T08:00:00.000Z",
  });
  assert.equal(first.state, "CLOSED");
  assert.equal(first.failure_count, 1);
  const second = repo.recordFailure({
    scope: "youtube",
    actorId: "publisher",
    errorClass: "transport",
    threshold: 2,
    cooldownMs: 60000,
    now: "2026-08-15T08:00:10.000Z",
  });
  assert.equal(second.state, "OPEN");
  assert.equal(second.failure_count, 2);
  const restarted = circuitBreakers.bind(db, { tokenFactory: () => "restart-probe" });
  const blocked = restarted.beforeAttempt({
    scope: "youtube",
    now: "2026-08-15T08:00:30.000Z",
  });
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "circuit_open");
  db.close();
});

test("only one half-open probe is issued after cooldown", () => {
  const { db, repo } = fixture();
  repo.recordFailure({
    scope: "youtube",
    actorId: "publisher",
    errorClass: "transport",
    threshold: 1,
    cooldownMs: 60000,
    now: "2026-08-15T08:00:00.000Z",
  });
  const first = repo.beforeAttempt({
    scope: "youtube",
    actorId: "worker-a",
    now: "2026-08-15T08:01:01.000Z",
  });
  assert.equal(first.allowed, true);
  assert.equal(first.state, "HALF_OPEN");
  assert.equal(first.probeToken, "probe-1");
  const second = repo.beforeAttempt({
    scope: "youtube",
    actorId: "worker-b",
    now: "2026-08-15T08:01:02.000Z",
  });
  assert.equal(second.allowed, false);
  assert.equal(second.reason, "half_open_probe_in_progress");
  assert.throws(
    () => repo.recordSuccess({ scope: "youtube", probeToken: "wrong" }),
    /circuit_probe_token_mismatch/,
  );
  const closed = repo.recordSuccess({
    scope: "youtube",
    actorId: "worker-a",
    probeToken: "probe-1",
    now: "2026-08-15T08:01:03.000Z",
  });
  assert.equal(closed.state, "CLOSED");
  assert.equal(closed.failure_count, 0);
  db.close();
});

test("a failed half-open probe reopens the circuit", () => {
  const { db, repo } = fixture();
  repo.recordFailure({
    scope: "discord",
    actorId: "runtime",
    errorClass: "http_500",
    threshold: 1,
    cooldownMs: 1000,
    now: "2026-08-15T08:00:00.000Z",
  });
  const probe = repo.beforeAttempt({
    scope: "discord",
    actorId: "probe-worker",
    now: "2026-08-15T08:00:02.000Z",
  });
  const reopened = repo.recordFailure({
    scope: "discord",
    actorId: "probe-worker",
    errorClass: "http_500",
    threshold: 1,
    cooldownMs: 5000,
    probeToken: probe.probeToken,
    now: "2026-08-15T08:00:03.000Z",
  });
  assert.equal(reopened.state, "OPEN");
  assert.equal(reopened.probe_token, null);
  assert.equal(reopened.probe_owner_id, null);
  db.close();
});

test("force operations require the exact current version", () => {
  const { db, repo } = fixture();
  const opened = repo.open({
    scope: "youtube",
    actorId: "monitor",
    reason: "incident",
    expectedVersion: 0,
    cooldownMs: 60000,
  });
  assert.equal(opened.state, "OPEN");
  assert.throws(
    () => repo.reset({
      scope: "youtube",
      actorId: "martin",
      reason: "reviewed",
      expectedVersion: 0,
    }),
    /stale_control_version/,
  );
  const closed = repo.reset({
    scope: "youtube",
    actorId: "martin",
    reason: "reviewed",
    expectedVersion: opened.version,
  });
  assert.equal(closed.state, "CLOSED");
  db.close();
});

test("recordFailure cannot bypass an already-open circuit", () => {
  const { db, repo } = fixture();
  repo.recordFailure({
    scope: "youtube",
    actorId: "publisher",
    errorClass: "transport",
    threshold: 1,
    cooldownMs: 60000,
  });
  assert.throws(
    () => repo.recordFailure({
      scope: "youtube",
      actorId: "publisher",
      errorClass: "second_transport",
      cooldownMs: 60000,
    }),
    /circuit_attempt_not_allowed/,
  );
  db.close();
});
