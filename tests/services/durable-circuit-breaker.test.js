"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const { runMigrations } = require("../../lib/migrate");
const circuitRepo = require("../../lib/repositories/circuit_breakers");
const {
  buildDurableCircuitBreaker,
} = require("../../lib/services/durable-circuit-breaker");

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  return { db, repo: circuitRepo.bind(db, { tokenFactory: () => "probe-token" }) };
}

function service(repo, now = "2026-08-15T10:00:00.000Z") {
  return buildDurableCircuitBreaker({
    repo,
    scope: "youtube:pulse-gaming",
    actorId: "publisher",
    threshold: 1,
    cooldownMs: 60000,
    now: () => new Date(now),
  });
}

test("open durable breaker survives a new service instance", () => {
  const { db, repo } = fixture();
  const first = service(repo);
  const attempt = first.beforeAttempt();
  first.recordFailure(Object.assign(new Error("transport"), { code: "ETIMEDOUT" }), attempt);
  const second = service(circuitRepo.bind(db), "2026-08-15T10:00:30.000Z");
  assert.throws(() => second.beforeAttempt(), /durable_circuit_open/);
  assert.equal(second.status().state, "OPEN");
  db.close();
});

test("exactly one half-open probe is admitted after cooldown", () => {
  const { db, repo } = fixture();
  const first = service(repo);
  const attempt = first.beforeAttempt();
  first.recordFailure(new Error("failed"), attempt);
  const afterCooldown = service(repo, "2026-08-15T10:01:01.000Z");
  const probe = afterCooldown.beforeAttempt();
  assert.equal(probe.state, "HALF_OPEN");
  assert.equal(probe.probeToken, "probe-token");
  assert.throws(() => afterCooldown.beforeAttempt(), /durable_circuit_open/);
  db.close();
});

test("successful half-open probe closes the durable breaker", () => {
  const { db, repo } = fixture();
  const first = service(repo);
  const attempt = first.beforeAttempt();
  first.recordFailure(new Error("failed"), attempt);
  const second = service(repo, "2026-08-15T10:01:01.000Z");
  const probe = second.beforeAttempt();
  const row = second.recordSuccess(probe);
  assert.equal(row.state, "CLOSED");
  assert.equal(row.failure_count, 0);
  assert.equal(service(circuitRepo.bind(db)).beforeAttempt().allowed, true);
  db.close();
});

test("HTTP client failures are recorded without leaking messages", () => {
  const { db, repo } = fixture();
  const breaker = service(repo);
  const attempt = breaker.beforeAttempt();
  const error = new Error("secret body");
  error.response = { status: 403 };
  const row = breaker.recordFailure(error, attempt);
  assert.equal(row.last_error_class, "http_403");
  assert.equal(JSON.stringify(row).includes("secret body"), false);
  db.close();
});
