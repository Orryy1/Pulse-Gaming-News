"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");
const { runMigrations } = require("../../lib/migrate");
const runtimeComponents = require("../../lib/repositories/runtime_components");

const COMMIT = "a".repeat(40);
const CONFIG = "b".repeat(64);

function fixture() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db, { log: () => {} });
  return { db, repo: runtimeComponents.bind(db) };
}

function registration(overrides = {}) {
  return {
    componentId: "worker-production-1",
    instanceKey: "worker:production:1",
    componentType: "worker",
    role: "production",
    commitSha: COMMIT,
    configurationSha256: CONFIG,
    processId: 100,
    processStartedAt: "2026-08-15T08:00:00.000Z",
    state: "STARTING",
    leaseMs: 60000,
    now: "2026-08-15T08:00:01.000Z",
    metadata: { gpu: true },
    ...overrides,
  };
}

test("register and heartbeat preserve exact runtime identity", () => {
  const { db, repo } = fixture();
  const registered = repo.register(registration());
  assert.equal(registered.version, 1);
  assert.equal(registered.state, "STARTING");
  const ready = repo.heartbeat({
    ...registration({
      state: "READY",
      now: "2026-08-15T08:00:20.000Z",
    }),
    expectedVersion: registered.version,
  });
  assert.equal(ready.version, 2);
  assert.equal(ready.state, "READY");
  assert.equal(ready.process_id, 100);
  assert.equal(ready.commit_sha, COMMIT);
  assert.equal(ready.configuration_sha256, CONFIG);
  const fresh = repo.listFresh({ now: "2026-08-15T08:00:30.000Z" });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].component_id, registered.component_id);
  db.close();
});

test("heartbeat rejects stale versions and changed process identity", () => {
  const { db, repo } = fixture();
  const registered = repo.register(registration());
  assert.throws(
    () => repo.heartbeat({ ...registration(), expectedVersion: 99 }),
    /stale_control_version/,
  );
  assert.throws(
    () => repo.heartbeat({
      ...registration({ processId: 101 }),
      expectedVersion: registered.version,
    }),
    /runtime_component_identity_mismatch/,
  );
  db.close();
});

test("an active instance cannot be replaced by another process", () => {
  const { db, repo } = fixture();
  repo.register(registration());
  assert.throws(
    () => repo.register(registration({
      processId: 200,
      processStartedAt: "2026-08-15T08:00:05.000Z",
      now: "2026-08-15T08:00:10.000Z",
    })),
    /runtime_component_active_identity_conflict/,
  );
  assert.throws(
    () => repo.register(registration({
      componentId: "different-component",
      processId: 201,
    })),
    /runtime_component_instance_key_conflict/,
  );
  db.close();
});

test("stopped or expired components can be re-registered safely", () => {
  const { db, repo } = fixture();
  const first = repo.register(registration());
  const stopped = repo.markStopped({
    componentId: first.component_id,
    expectedVersion: first.version,
    now: "2026-08-15T08:00:10.000Z",
  });
  assert.equal(stopped.state, "STOPPED");
  assert.equal(repo.listFresh({ now: "2026-08-15T08:00:11.000Z" }).length, 0);
  const restarted = repo.register(registration({
    processId: 300,
    processStartedAt: "2026-08-15T08:01:00.000Z",
    now: "2026-08-15T08:01:01.000Z",
  }));
  assert.equal(restarted.version, 3);
  assert.equal(restarted.process_id, 300);
  assert.equal(restarted.state, "STARTING");
  db.close();
});

test("heartbeat preserves metadata when no replacement metadata is supplied", () => {
  const { db, repo } = fixture();
  const registered = repo.register(registration());
  const input = registration({ now: "2026-08-15T08:00:20.000Z" });
  delete input.metadata;
  const ready = repo.heartbeat({ ...input, expectedVersion: registered.version });
  assert.deepEqual(JSON.parse(ready.metadata_json), { gpu: true });
  db.close();
});

test("an active process cannot silently change its declared role", () => {
  const { db, repo } = fixture();
  repo.register(registration());
  assert.throws(
    () => repo.register(registration({ role: "publisher" })),
    /runtime_component_active_identity_conflict/,
  );
  db.close();
});
