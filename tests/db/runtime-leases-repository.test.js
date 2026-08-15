"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/runtime_leases");

function fixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT,
    fencing_token INTEGER NOT NULL DEFAULT 0
    )
  `);
  return { db, leases: bind(db) };
}

test("lease acquisition is exclusive and expired ownership is reclaimable", () => {
  const { db, leases } = fixture();
  const first = leases.acquire({
    name: "scheduler:primary",
    ownerId: "worker-a",
    now: new Date("2026-07-27T10:00:00.000Z"),
    leaseMs: 60_000,
    metadata: { role: "scheduler" },
  });
  assert.equal(first.acquired, true);
  assert.equal(first.fencing_token, 1);
  assert.deepEqual(JSON.parse(first.metadata), { role: "scheduler" });

  const blocked = leases.acquire({
    name: "scheduler:primary",
    ownerId: "worker-b",
    now: new Date("2026-07-27T10:00:30.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.current_owner_id, "worker-a");

  const reclaimed = leases.acquire({
    name: "scheduler:primary",
    ownerId: "worker-b",
    now: new Date("2026-07-27T10:01:00.001Z"),
    leaseMs: 60_000,
  });
  assert.equal(reclaimed.acquired, true);
  assert.equal(reclaimed.owner_id, "worker-b");
  assert.equal(reclaimed.fencing_token, 2);
  db.close();
});

test("heartbeat and release require the current live owner", () => {
  const { db, leases } = fixture();
  const acquired = leases.acquire({
    name: "publisher:pulse-gaming",
    ownerId: "worker-a",
    now: new Date("2026-07-27T10:00:00.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(
    leases.heartbeat({
      name: "publisher:pulse-gaming",
      ownerId: "worker-b",
      fencingToken: acquired.fencing_token,
      now: new Date("2026-07-27T10:00:30.000Z"),
      leaseMs: 60_000,
    }),
    false,
  );
  assert.equal(
    leases.release("publisher:pulse-gaming", "worker-b", acquired.fencing_token),
    false,
  );
  assert.equal(
    leases.release("publisher:pulse-gaming", "worker-a", acquired.fencing_token),
    true,
  );
  assert.equal(leases.get("publisher:pulse-gaming"), null);
  db.close();
});

test("invalid lease identity, time and duration fail closed", () => {
  const { db, leases } = fixture();
  assert.throws(
    () => leases.acquire({ name: " ", ownerId: "worker-a" }),
    /lease_name_and_owner_required/,
  );
  assert.throws(
    () =>
      leases.acquire({
        name: "scheduler:primary",
        ownerId: "worker-a",
        now: "not-a-date",
      }),
    /invalid_lease_time/,
  );
  assert.throws(
    () =>
      leases.acquire({
        name: "scheduler:primary",
        ownerId: "worker-a",
        leaseMs: 0,
      }),
    /positive_lease_duration_required/,
  );
  db.close();
});

test("lease exclusion is durable across independent database connections", () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-runtime-lease-"),
  );
  const filename = path.join(directory, "lease.db");
  const firstDb = new Database(filename);
  const secondDb = new Database(filename);
  firstDb.pragma("journal_mode = WAL");
  firstDb.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT,
    fencing_token INTEGER NOT NULL DEFAULT 0
    )
  `);
  const first = bind(firstDb);
  const second = bind(secondDb);
  assert.equal(
    first.acquire({
      name: "scheduler:primary",
      ownerId: "connection-a",
      now: new Date("2026-07-27T10:00:00.000Z"),
      leaseMs: 60_000,
    }).acquired,
    true,
  );
  const blocked = second.acquire({
    name: "scheduler:primary",
    ownerId: "connection-b",
    now: new Date("2026-07-27T10:00:01.000Z"),
    leaseMs: 60_000,
  });
  assert.equal(blocked.acquired, false);
  assert.equal(blocked.current_owner_id, "connection-a");
  firstDb.close();
  secondDb.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test("stale fencing tokens cannot heartbeat or release after takeover", () => {
  const { db, leases } = fixture();
  const first = leases.acquire({
    name: "publisher:global",
    ownerId: "owner-a",
    now: "2026-08-15T08:00:00.000Z",
    leaseMs: 1000,
  });
  const second = leases.acquire({
    name: "publisher:global",
    ownerId: "owner-b",
    now: "2026-08-15T08:00:02.000Z",
    leaseMs: 60000,
  });
  assert.equal(first.fencing_token, 1);
  assert.equal(second.fencing_token, 2);
  assert.equal(
    leases.heartbeat({
      name: "publisher:global",
      ownerId: "owner-a",
      fencingToken: first.fencing_token,
      now: "2026-08-15T08:00:03.000Z",
      leaseMs: 60000,
    }),
    false,
  );
  assert.equal(
    leases.release("publisher:global", "owner-a", first.fencing_token),
    false,
  );
  assert.equal(
    leases.release("publisher:global", "owner-b", first.fencing_token),
    false,
  );
  assert.equal(
    leases.release("publisher:global", "owner-b", second.fencing_token),
    true,
  );
  db.close();
});

test("the same owner receives a new token after its lease expires", () => {
  const { db, leases } = fixture();
  const first = leases.acquire({
    name: "scheduler:primary",
    ownerId: "same-owner",
    now: "2026-08-15T08:00:00.000Z",
    leaseMs: 1000,
  });
  const activeRenewal = leases.acquire({
    name: "scheduler:primary",
    ownerId: "same-owner",
    now: "2026-08-15T08:00:00.500Z",
    leaseMs: 1000,
  });
  assert.equal(activeRenewal.fencing_token, first.fencing_token);
  const reclaimed = leases.acquire({
    name: "scheduler:primary",
    ownerId: "same-owner",
    now: "2026-08-15T08:00:02.000Z",
    leaseMs: 60000,
  });
  assert.equal(reclaimed.fencing_token, first.fencing_token + 1);
  assert.equal(
    leases.heartbeat({
      name: "scheduler:primary",
      ownerId: "same-owner",
      fencingToken: first.fencing_token,
      now: "2026-08-15T08:00:03.000Z",
      leaseMs: 60000,
    }),
    false,
  );
  db.close();
});
