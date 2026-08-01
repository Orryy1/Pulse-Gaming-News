"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const Database = require("better-sqlite3");

const {
  bind: bindRuntimeLeases,
} = require("../../lib/repositories/runtime_leases");
const {
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
  acquireLiveRuntimeTransitionLease,
  borrowLiveRuntimeTransitionLease,
  transitionOwnerId,
} = require("../../lib/stabilisation/live-runtime-transition-lease");

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-transition-lease-"),
  );
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE runtime_leases (
      name TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      metadata TEXT
    );
  `);
  const leases = bindRuntimeLeases(db);
  const runtimeTransitionLeaseFactory = () => ({
    leases,
    close() {},
  });
  t.after(() => {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { databasePath, db, leases, runtimeTransitionLeaseFactory };
}

function participantIdentity(participantId, processId, processStartedAt) {
  return {
    participant_id: participantId,
    process_id: processId,
    process_started_at: processStartedAt,
  };
}

function factoryWithLeaseOverrides(values, overrides) {
  return () => ({
    leases: new Proxy(values.leases, {
      get(target, property) {
        if (Object.hasOwn(overrides, property)) {
          return overrides[property];
        }
        return target[property];
      },
    }),
    close() {},
  });
}

test("live transition owners are unique and mutually exclusive", (t) => {
  const values = fixture(t);
  const firstOwner = transitionOwnerId("live-activation", "fixture");
  const secondOwner = transitionOwnerId("live-activation", "fixture");
  const firstParticipant = participantIdentity(
    "lease-owner-participant",
    4001,
    "2026-08-01T00:00:00.100Z",
  );
  assert.notEqual(firstOwner, secondOwner);

  const first = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: firstOwner,
    action: "live-activation",
    leaseMs: 60_000,
    participantIdentity: firstParticipant,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  assert.equal(first.participant_id, firstParticipant.participant_id);
  assert.equal(Object.isFrozen(first.participant_identity), true);
  assert.deepEqual(first.participant_identity, {
    ...firstParticipant,
    role: "owner",
    process_start_source: "injected",
  });
  assert.throws(() => {
    first.participant_identity.process_id = 4999;
  }, TypeError);
  firstParticipant.process_id = 4999;
  assert.equal(first.participant_identity.process_id, 4001);
  assert.throws(
    () =>
      acquireLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        ownerId: secondOwner,
        action: "live-start",
        leaseMs: 60_000,
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.equal(first.release(), true);
  assert.equal(values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME), null);
});

test("a scheduled supervisor borrows only the exact active start owner", (t) => {
  const values = fixture(t);
  const ownerId = "live-start:11111111-1111-4111-8111-111111111111";
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId,
    action: "live-start",
    leaseMs: 60_000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrowed = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: ownerId,
    leaseMs: 60_000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  assert.equal(borrowed.renew(), true);
  assert.equal(borrowed.release(), true);
  assert.equal(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME)?.owner_id,
    ownerId,
  );
  assert.throws(
    () =>
      borrowLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        expectedOwnerId: "live-start:wrong",
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  owner.release();
});

test("handoff sealing atomically removes the current borrower and rejects a replacement", (t) => {
  const values = fixture(t);
  const ownerId = "live-start:sealed-handoff";
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId,
    action: "live-start",
    leaseMs: 60_000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: ownerId,
    leaseMs: 60_000,
    participantIdentity: participantIdentity(
      "handoff-borrower",
      4002,
      "2026-08-01T00:00:00.200Z",
    ),
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.equal(typeof borrower.sealForHandoff, "function");
  assert.equal(
    borrower.sealForHandoff({
      childParticipantIdentity: participantIdentity(
        "handoff-child",
        4004,
        "2026-08-01T00:00:00.400Z",
      ),
    }),
    true,
  );
  const sealedMetadata = JSON.parse(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
  );
  assert.equal(sealedMetadata.admission_state, "SEALED");
  assert.deepEqual(
    sealedMetadata.participants.map((item) => item.role),
    ["owner", "handoff_supervisor", "handoff_child"],
  );
  assert.throws(
    () =>
      borrowLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        expectedOwnerId: ownerId,
        leaseMs: 60_000,
        participantIdentity: participantIdentity(
          "replacement-borrower",
          4003,
          "2026-08-01T00:00:00.300Z",
        ),
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.equal(owner.release(), true);
});

test("an expired borrowed SEALED transition stays fenced while its handoff supervisor is alive", (t) => {
  const values = fixture(t);
  const leaseMs = 60_000;
  const acquiredAt = new Date();
  const parentIdentity = participantIdentity(
    "sealed-dead-parent",
    4005,
    "2026-08-01T00:00:00.500Z",
  );
  const supervisorIdentity = participantIdentity(
    "sealed-live-supervisor",
    4006,
    "2026-08-01T00:00:00.600Z",
  );
  const childIdentity = participantIdentity(
    "sealed-dead-child",
    4007,
    "2026-08-01T00:00:00.700Z",
  );
  let supervisorAlive = true;
  const inspector = (candidate) => {
    if (candidate.participant_id === supervisorIdentity.participant_id) {
      return supervisorAlive;
    }
    if (
      candidate.participant_id === parentIdentity.participant_id ||
      candidate.participant_id === childIdentity.participant_id
    ) {
      return false;
    }
    return null;
  };
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:borrowed-sealed-crash",
    action: "live-start",
    now: acquiredAt,
    leaseMs,
    participantIdentity: parentIdentity,
    ownerProcessInspector: inspector,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: owner.owner_id,
    now: new Date(acquiredAt.getTime() + 1),
    leaseMs,
    participantIdentity: supervisorIdentity,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.equal(
    borrower.sealForHandoff({ childParticipantIdentity: childIdentity }),
    true,
  );
  assert.deepEqual(
    JSON.parse(
      values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
    ).participants.map((item) => item.role),
    ["owner", "handoff_supervisor", "handoff_child"],
  );
  const sealedExpiresAt = Date.parse(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).expires_at,
  );
  assert.equal(Number.isFinite(sealedExpiresAt), true);
  assert.throws(
    () =>
      acquireLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        ownerId: "live-start:blocked-by-supervisor",
        action: "live-start",
        now: new Date(sealedExpiresAt + 1),
        leaseMs,
        ownerProcessInspector: inspector,
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );

  supervisorAlive = false;
  const recovered = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:recovered-after-supervisor-exit",
    action: "live-start",
    now: new Date(sealedExpiresAt + 2),
    leaseMs,
    ownerProcessInspector: inspector,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  assert.equal(recovered.release(), true);
});

test("an active legacy-v2 transition is borrowed and upgraded to explicit OPEN admission", (t) => {
  const values = fixture(t);
  const ownerId = "live-start:legacy-active";
  values.leases.acquire({
    name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
    ownerId,
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 60_000,
    replaceSameOwner: false,
    metadata: {
      transition_owner_schema_version: "pulse-live-runtime-transition-owner-v2",
      context: {},
      participants: [
        {
          participant_id: "legacy-active-owner",
          role: "owner",
          process_id: 4011,
          process_started_at: "2026-08-01T00:00:00.100Z",
          process_start_source: "injected",
        },
      ],
    },
  });

  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: ownerId,
    now: new Date("2026-08-01T00:00:00.200Z"),
    leaseMs: 60_000,
    participantIdentity: participantIdentity(
      "legacy-upgrade-borrower",
      4012,
      "2026-08-01T00:00:00.200Z",
    ),
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  const upgraded = JSON.parse(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
  );
  assert.equal(upgraded.admission_state, "OPEN");
  assert.deepEqual(
    upgraded.participants.map((item) => item.role),
    ["owner", "borrower"],
  );
  assert.equal(borrower.release(), true);
  assert.equal(
    values.leases.release(LIVE_RUNTIME_TRANSITION_LEASE_NAME, ownerId),
    true,
  );
});

test("an expired legacy-v2 transition remains recoverable when every participant is dead", (t) => {
  const values = fixture(t);
  values.leases.acquire({
    name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
    ownerId: "live-start:legacy-dead",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    replaceSameOwner: false,
    metadata: {
      transition_owner_schema_version: "pulse-live-runtime-transition-owner-v2",
      context: {},
      participants: [
        {
          participant_id: "legacy-dead-owner",
          role: "owner",
          process_id: 4021,
          process_started_at: "2026-08-01T00:00:00.100Z",
          process_start_source: "injected",
        },
      ],
    },
  });

  const recovered = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:legacy-recovered",
    action: "live-start",
    now: new Date("2026-08-01T00:00:02.000Z"),
    leaseMs: 1000,
    ownerProcessInspector: () => false,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.equal(recovered.owner_id, "live-start:legacy-recovered");
  assert.equal(recovered.release(), true);
});

test("an expired SEALED transition stays fenced while its handoff child is alive", (t) => {
  const values = fixture(t);
  const leaseMs = 60_000;
  const acquiredAt = new Date();
  const ownerIdentity = participantIdentity(
    "sealed-crashed-owner",
    4031,
    "2026-08-01T00:00:00.100Z",
  );
  const childIdentity = participantIdentity(
    "sealed-live-child",
    4032,
    "2026-08-01T00:00:00.200Z",
  );
  let childAlive = true;
  const inspector = (candidate) => {
    if (candidate.participant_id === ownerIdentity.participant_id) {
      return false;
    }
    if (candidate.participant_id === childIdentity.participant_id) {
      return childAlive;
    }
    return null;
  };
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-supervise:sealed-crash",
    action: "live-supervise",
    now: acquiredAt,
    leaseMs,
    participantIdentity: ownerIdentity,
    ownerProcessInspector: inspector,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.equal(
    owner.sealForHandoff({ childParticipantIdentity: childIdentity }),
    true,
  );
  const sealed = JSON.parse(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
  );
  assert.equal(sealed.admission_state, "SEALED");
  assert.deepEqual(
    sealed.participants.map((item) => item.role),
    ["owner", "handoff_child"],
  );
  const sealedExpiresAt = Date.parse(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).expires_at,
  );
  assert.equal(Number.isFinite(sealedExpiresAt), true);
  assert.throws(
    () =>
      acquireLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        ownerId: "live-supervise:blocked-by-child",
        action: "live-supervise",
        now: new Date(sealedExpiresAt + 1),
        leaseMs,
        ownerProcessInspector: inspector,
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );

  childAlive = false;
  const recovered = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-supervise:recovered-after-child-exit",
    action: "live-supervise",
    now: new Date(sealedExpiresAt + 2),
    leaseMs,
    ownerProcessInspector: inspector,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  assert.equal(recovered.owner_id, "live-supervise:recovered-after-child-exit");
  assert.equal(recovered.release(), true);
});

test("an expired transition lease remains fenced while its owning process is alive", (t) => {
  const values = fixture(t);
  const first = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "exact-plan-drain:first",
    action: "exact-plan-drain",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  assert.throws(
    () =>
      acquireLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        ownerId: "exact-plan-drain:replay",
        action: "exact-plan-drain",
        now: new Date("2026-08-01T00:00:02.000Z"),
        leaseMs: 1000,
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
        ownerProcessInspector: () => true,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.equal(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME)?.owner_id,
    "exact-plan-drain:first",
  );
  assert.equal(first.renew(new Date("2026-08-01T00:00:02.100Z")), true);
  first.release();
});

test("an expired transition fence is automatically recoverable after its owning process exits", (t) => {
  const values = fixture(t);
  const first = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "exact-plan-drain:crashed",
    action: "exact-plan-drain",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const recovered = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:recovered",
    action: "live-start",
    now: new Date("2026-08-01T00:00:02.000Z"),
    leaseMs: 1000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
    ownerProcessInspector: () => false,
  });

  assert.equal(recovered.owner_id, "live-start:recovered");
  assert.throws(
    () => first.renew(new Date("2026-08-01T00:00:02.100Z")),
    /live_runtime_transition_lease_lost/,
  );
  recovered.release();
});

test("a borrowed lease close failure does not abandon the parent-owned fence", (t) => {
  const values = fixture(t);
  const ownerId = "live-start:22222222-2222-4222-8222-222222222222";
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId,
    action: "live-start",
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrowed = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: ownerId,
    runtimeTransitionLeaseFactory: () => ({
      leases: values.leases,
      close() {
        throw new Error("fixture_close_failed");
      },
    }),
  });

  assert.equal(borrowed.release(), true);
  assert.equal(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME)?.owner_id,
    ownerId,
  );
  owner.release();
});

test("an expired parent cannot be taken over while its registered borrower is alive", (t) => {
  const values = fixture(t);
  const ownerIdentity = participantIdentity(
    "owner-participant",
    4101,
    "2026-08-01T00:00:00.100Z",
  );
  const borrowerIdentity = participantIdentity(
    "borrower-participant",
    4102,
    "2026-08-01T00:00:00.200Z",
  );
  const inspect = (participant) => {
    if (participant.participant_id === ownerIdentity.participant_id) {
      return false;
    }
    if (participant.participant_id === borrowerIdentity.participant_id) {
      return true;
    }
    return null;
  };
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:parent",
    action: "live-start",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    participantIdentity: ownerIdentity,
    ownerProcessInspector: inspect,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: owner.owner_id,
    now: new Date("2026-08-01T00:00:00.100Z"),
    leaseMs: 1000,
    participantIdentity: borrowerIdentity,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  const registered = JSON.parse(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
  );
  assert.deepEqual(
    registered.participants.map((item) => item.participant_id).sort(),
    ["borrower-participant", "owner-participant"],
  );
  assert.throws(
    () =>
      acquireLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        ownerId: "live-start:competitor",
        action: "live-start",
        now: new Date("2026-08-01T00:00:02.000Z"),
        leaseMs: 1000,
        ownerProcessInspector: inspect,
        runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.equal(borrower.renew(new Date("2026-08-01T00:00:02.100Z")), true);
  assert.equal(borrower.release(), true);
  assert.equal(owner.release(), true);
});

test("all dead registered participants permit deterministic expired takeover", (t) => {
  const values = fixture(t);
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:crashed-parent",
    action: "live-start",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    participantIdentity: participantIdentity(
      "dead-owner",
      4201,
      "2026-08-01T00:00:00.100Z",
    ),
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: owner.owner_id,
    now: new Date("2026-08-01T00:00:00.100Z"),
    leaseMs: 1000,
    participantIdentity: participantIdentity(
      "dead-borrower",
      4202,
      "2026-08-01T00:00:00.200Z",
    ),
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const recovered = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:recovered-all-dead",
    action: "live-start",
    now: new Date("2026-08-01T00:00:02.000Z"),
    leaseMs: 1000,
    ownerProcessInspector: () => false,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.equal(recovered.owner_id, "live-start:recovered-all-dead");
  assert.throws(
    () => borrower.renew(new Date("2026-08-01T00:00:02.100Z")),
    /live_runtime_transition_lease_lost/,
  );
  assert.throws(() => owner.release(), /live_runtime_transition_lease_lost/);
  recovered.release();
});

test("a parent release cannot delete a registered live borrower", (t) => {
  const values = fixture(t);
  const borrowerIdentity = participantIdentity(
    "live-borrower",
    4302,
    "2026-08-01T00:00:00.200Z",
  );
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:release-guard",
    action: "live-start",
    participantIdentity: participantIdentity(
      "release-owner",
      4301,
      "2026-08-01T00:00:00.100Z",
    ),
    ownerProcessInspector: (participant) =>
      participant.participant_id === borrowerIdentity.participant_id,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: owner.owner_id,
    participantIdentity: borrowerIdentity,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.throws(() => owner.release(), /live_runtime_transition_lease_lost/);
  assert.equal(
    values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME)?.owner_id,
    owner.owner_id,
  );
  borrower.release();
  assert.equal(owner.release(), true);
});

test("a parent prunes a proven-dead borrower before exact deletion", (t) => {
  const values = fixture(t);
  const borrowerIdentity = participantIdentity(
    "dead-release-borrower",
    4352,
    "2026-08-01T00:00:00.200Z",
  );
  let metadataCasCalls = 0;
  const observingFactory = factoryWithLeaseOverrides(values, {
    compareAndSwapMetadata(options) {
      metadataCasCalls += 1;
      return values.leases.compareAndSwapMetadata(options);
    },
  });
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:dead-borrower-prune",
    action: "live-start",
    ownerProcessInspector: () => false,
    runtimeTransitionLeaseFactory: observingFactory,
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: owner.owner_id,
    participantIdentity: borrowerIdentity,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const callsAfterRegistration = metadataCasCalls;

  assert.equal(owner.release(), true);
  assert.ok(metadataCasCalls > callsAfterRegistration);
  assert.equal(values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME), null);
  assert.throws(() => borrower.renew(), /live_runtime_transition_lease_lost/);
});

test("a borrower registration cannot resurrect a row released during its CAS", (t) => {
  const values = fixture(t);
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:registration-race",
    action: "live-start",
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  let raced = false;
  const racingFactory = factoryWithLeaseOverrides(values, {
    compareAndSwapMetadata(options) {
      if (!raced) {
        raced = true;
        owner.release();
      }
      return values.leases.compareAndSwapMetadata(options);
    },
  });

  assert.throws(
    () =>
      borrowLiveRuntimeTransitionLease({
        databasePath: values.databasePath,
        expectedOwnerId: owner.owner_id,
        participantIdentity: participantIdentity(
          "racing-borrower",
          4402,
          "2026-08-01T00:00:00.200Z",
        ),
        runtimeTransitionLeaseFactory: racingFactory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.equal(raced, true);
  assert.equal(values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME), null);
});

test("an owner delete loses a concurrent borrower-registration race", (t) => {
  const values = fixture(t);
  const ownerId = "live-start:delete-race";
  const borrowerIdentity = participantIdentity(
    "delete-race-borrower",
    4502,
    "2026-08-01T00:00:00.200Z",
  );
  let borrower = null;
  const racingFactory = factoryWithLeaseOverrides(values, {
    releaseExactMetadata(options) {
      if (!borrower) {
        borrower = borrowLiveRuntimeTransitionLease({
          databasePath: values.databasePath,
          expectedOwnerId: ownerId,
          participantIdentity: borrowerIdentity,
          runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
        });
      }
      return values.leases.releaseExactMetadata(options);
    },
  });
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId,
    action: "live-start",
    ownerProcessInspector: (participant) =>
      participant.participant_id === borrowerIdentity.participant_id,
    runtimeTransitionLeaseFactory: racingFactory,
  });

  assert.throws(() => owner.release(), /live_runtime_transition_lease_lost/);
  assert.ok(borrower);
  assert.equal(
    JSON.parse(
      values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
    ).participants.some(
      (item) => item.participant_id === borrowerIdentity.participant_id,
    ),
    true,
  );
  borrower.release();
  assert.equal(owner.release(), true);
});

test("failed borrower unregistration remains fenced from parent deletion", (t) => {
  const values = fixture(t);
  const borrowerIdentity = participantIdentity(
    "unregister-borrower",
    4602,
    "2026-08-01T00:00:00.200Z",
  );
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:unregister-failure",
    action: "live-start",
    ownerProcessInspector: (participant) =>
      participant.participant_id === borrowerIdentity.participant_id,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  let metadataCasCalls = 0;
  const failingFactory = factoryWithLeaseOverrides(values, {
    compareAndSwapMetadata(options) {
      metadataCasCalls += 1;
      if (metadataCasCalls > 1) return false;
      return values.leases.compareAndSwapMetadata(options);
    },
  });
  const borrower = borrowLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    expectedOwnerId: owner.owner_id,
    participantIdentity: borrowerIdentity,
    runtimeTransitionLeaseFactory: failingFactory,
  });

  assert.throws(() => borrower.release(), /live_runtime_transition_lease_lost/);
  assert.throws(() => owner.release(), /live_runtime_transition_lease_lost/);
  assert.equal(
    JSON.parse(
      values.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME).metadata,
    ).participants.some(
      (item) => item.participant_id === borrowerIdentity.participant_id,
    ),
    true,
  );
});

test("unknown participant liveness and inspector errors fail closed", (t) => {
  const values = fixture(t);
  const owner = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:unknown-liveness",
    action: "live-start",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  for (const ownerProcessInspector of [
    () => null,
    () => {
      throw new Error("inspection_failed");
    },
  ]) {
    assert.throws(
      () =>
        acquireLiveRuntimeTransitionLease({
          databasePath: values.databasePath,
          ownerId: transitionOwnerId("live-start", "unknown"),
          action: "live-start",
          now: new Date("2026-08-01T00:00:02.000Z"),
          leaseMs: 1000,
          ownerProcessInspector,
          runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
        }),
      /live_runtime_transition_lease_unavailable/,
    );
  }
  owner.release();
});

test("participant liveness is bound to both PID and process creation time", (t) => {
  const values = fixture(t);
  const reusedPid = 4701;
  const oldCreationTime = "2026-08-01T00:00:00.100Z";
  const newCreationTime = "2026-08-01T00:00:10.100Z";
  acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:old-process",
    action: "live-start",
    now: new Date("2026-08-01T00:00:00.000Z"),
    leaseMs: 1000,
    participantIdentity: participantIdentity(
      "old-process-owner",
      reusedPid,
      oldCreationTime,
    ),
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });
  const recovered = acquireLiveRuntimeTransitionLease({
    databasePath: values.databasePath,
    ownerId: "live-start:pid-reused",
    action: "live-start",
    now: new Date("2026-08-01T00:00:02.000Z"),
    leaseMs: 1000,
    ownerProcessInspector: (participant) =>
      participant.process_id === reusedPid &&
      participant.process_started_at === newCreationTime,
    runtimeTransitionLeaseFactory: values.runtimeTransitionLeaseFactory,
  });

  assert.equal(recovered.owner_id, "live-start:pid-reused");
  recovered.release();
});
