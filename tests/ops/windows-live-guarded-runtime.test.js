"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { inspect } = require("node:util");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "windows-live-guarded-runtime.js");
const START_OPERATION_NONCE = "11111111-1111-4111-8111-111111111111";
const TEST_PROCESS_STARTED_AT = "2026-07-29T21:59:00.000Z";
const TEST_REUSED_PROCESS_STARTED_AT = "2026-07-30T08:15:00.000Z";

function processIdentityInspector(identities = {}) {
  return ({ pid }) => {
    const identity = identities[Number(pid)];
    if (identity === "UNAVAILABLE") {
      return {
        available: false,
        exists: null,
        process_id: Number(pid),
        process_started_at: null,
      };
    }
    if (!identity) {
      return {
        available: true,
        exists: false,
        process_id: Number(pid),
        process_started_at: null,
      };
    }
    return {
      available: true,
      exists: true,
      process_id: Number(pid),
      process_started_at: identity,
    };
  };
}

function inMemoryTransitionLease({ preheldOwner = null, events = [] } = {}) {
  let current = preheldOwner
    ? {
        owner_id: preheldOwner,
        expires_at: "2099-01-01T00:00:00.000Z",
        metadata: JSON.stringify({
          transition_owner_schema_version:
            "pulse-live-runtime-transition-owner-v2",
          admission_state: "OPEN",
          context: {},
          participants: [
            {
              participant_id: "22222222-2222-4222-8222-222222222222",
              role: "owner",
              process_id: process.pid,
              process_started_at: TEST_PROCESS_STARTED_AT,
              process_start_source: "injected",
            },
          ],
        }),
      }
    : null;
  const leases = {
    acquire({ ownerId, leaseMs, metadata = null, now = new Date() }) {
      if (current && current.owner_id !== ownerId) {
        return { acquired: false, lease: current };
      }
      current = {
        owner_id: ownerId,
        expires_at: new Date(
          new Date(now).getTime() + Number(leaseMs),
        ).toISOString(),
        metadata:
          metadata === null || metadata === undefined
            ? null
            : JSON.stringify(metadata),
      };
      events.push(["transition_acquire", ownerId]);
      return { acquired: true, lease: current };
    },
    get() {
      return current;
    },
    heartbeat({ ownerId, leaseMs, now = new Date() }) {
      if (!current || current.owner_id !== ownerId) return false;
      current = {
        owner_id: ownerId,
        expires_at: new Date(
          new Date(now).getTime() + Number(leaseMs),
        ).toISOString(),
      };
      events.push(["transition_renew", ownerId]);
      return true;
    },
    compareAndSwapMetadata({
      ownerId,
      expectedMetadata,
      metadata,
      leaseMs,
      now = new Date(),
      allowExpired = false,
    }) {
      const expected =
        expectedMetadata === null || expectedMetadata === undefined
          ? null
          : String(expectedMetadata);
      const nowIso = new Date(now).toISOString();
      if (
        !current ||
        current.owner_id !== ownerId ||
        current.metadata !== expected ||
        (allowExpired !== true && current.expires_at <= nowIso)
      ) {
        return false;
      }
      current = {
        owner_id: ownerId,
        expires_at: new Date(
          new Date(now).getTime() + Number(leaseMs),
        ).toISOString(),
        metadata:
          metadata === null || metadata === undefined
            ? null
            : JSON.stringify(metadata),
      };
      events.push(["transition_renew", ownerId]);
      return true;
    },
    releaseExactMetadata({ ownerId, expectedMetadata }) {
      const expected =
        expectedMetadata === null || expectedMetadata === undefined
          ? null
          : String(expectedMetadata);
      if (
        !current ||
        current.owner_id !== ownerId ||
        current.metadata !== expected
      ) {
        return false;
      }
      events.push(["transition_release", ownerId]);
      current = null;
      return true;
    },
    release(_name, ownerId) {
      if (!current || current.owner_id !== ownerId) return false;
      events.push(["transition_release", ownerId]);
      current = null;
      return true;
    },
  };
  return {
    factory() {
      return {
        leases,
        close() {
          events.push(["transition_close", current?.owner_id || null]);
        },
      };
    },
    current() {
      return current;
    },
  };
}

function inMemoryStartLock({
  operationNonce = START_OPERATION_NONCE,
  events = [],
} = {}) {
  const transition = inMemoryTransitionLease();
  return {
    runtimeTransitionLeaseFactory: transition.factory,
    operationNonceFactory: () => operationNonce,
    startLockAcquirer(options) {
      events.push(["lock_acquire", options]);
      return {
        lock_path: "D:/pulse/start-operation.lock.json",
        operation_nonce: operationNonce,
        record: {
          operation_nonce: operationNonce,
        },
      };
    },
    startLockReleaser(options) {
      events.push(["lock_release", options]);
      return {
        outcome: "start_operation_lock_released",
        operation_nonce: operationNonce,
      };
    },
    startLockInspector() {
      return {
        present: true,
        valid: true,
        clear: false,
        state: "active",
        operation_nonce: operationNonce,
        blockers: [],
      };
    },
    staleOwnerArchiver(options) {
      events.push(["stale_owner_archive", options]);
      return {
        outcome: "exact_stale_owner_archived",
        operation_nonce: operationNonce,
      };
    },
    processIdentityInspector: processIdentityInspector({
      4111: TEST_PROCESS_STARTED_AT,
      4123: TEST_PROCESS_STARTED_AT,
    }),
  };
}

const {
  LIVE_LIFECYCLE_CONFIRMATION,
  acquireLiveStartOperationLock,
  archiveExactStaleLiveOwner,
  buildLiveActivationReceipt,
  buildLiveChildEnvironment,
  buildLiveLifecycleDecision,
  buildLiveRuntimeDoctorReport,
  buildLiveTaskAuthorityBinding,
  createDefaultLiveLifecycleHandlers,
  buildLiveScheduledTaskXml,
  buildLiveProcessCommandAuthority,
  prepareLiveSupervision,
  inspectLiveActivationReceipt,
  inspectLiveDatabaseIdentity,
  inspectWindowsProcessIdentity,
  inspectLiveStartOperationLock,
  inspectLiveTaskConflicts,
  inspectLiveTaskBoundHandoff,
  inspectStoppedLiveRuntime,
  inspectBoundedWindowsAuthority,
  issueLiveActivationReceipt,
  loadLiveGuardedRuntimeProfile,
  executeLiveLifecycleAction,
  validateLiveScheduledTaskXml,
  validateLiveGuardedRuntimeProfile,
  safeLiveHealthIdentity,
  releaseLiveStartOperationLock,
  revokeLiveActivationReceipt,
  setLiveScheduledTaskEnabled,
  startLiveScheduledTask,
  startLiveSupervisionGeneration,
  superviseLiveChildSession,
  waitForLiveHealth,
  runLiveSupervisionLifecycle,
} = require("../../lib/stabilisation/windows-live-guarded-runtime");
const {
  borrowLiveRuntimeTransitionLease,
} = require("../../lib/stabilisation/live-runtime-transition-lease");

const BOUNDED_INSTANCE_GUID = "11111111-2222-4333-8444-555555555555";
const BOUNDED_RUNTIME_ID = "ri-11111111-2222-4333-8444-555555555555";
const BOUNDED_RELEASE_SHA = "d".repeat(40);
const BOUNDED_PROFILE_SHA = "a".repeat(64);
const BOUNDED_DATABASE_SHA = "b".repeat(64);
const BOUNDED_SUPERVISOR_COMMAND_SHA = "c".repeat(64);
const BOUNDED_CHILD_COMMAND_SHA = "e".repeat(64);
const BOUNDED_DATABASE_SNAPSHOT_SHA = "9".repeat(64);
const BOUNDED_WORKER_TOPOLOGY = [
  {
    pool_id: "critical_publication",
    instances: 1,
    kinds: ["publish"],
  },
];

function boundedExpectedRuntime() {
  return {
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    worker_topology: BOUNDED_WORKER_TOPOLOGY,
  };
}

function boundedRunningWorkerSetSha256() {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify([`server-${BOUNDED_RUNTIME_ID}-critical_publication-1`]),
    )
    .digest("hex");
}

function boundedMultiLaneHealth() {
  return {
    isolated_worker_pools: {
      default_enabled: true,
      active_runner_count: 1,
      active_pool_count: 1,
      compatibility_runner_count: 0,
      pools: [
        {
          pool_id: "critical_publication",
          active_instances: 1,
          heartbeat_ms: 30000,
          kinds: ["publish"],
        },
      ],
      running_worker_set_sha256: boundedRunningWorkerSetSha256(),
      active_claim_count: 0,
      running_claim_set_sha256: crypto
        .createHash("sha256")
        .update("[]")
        .digest("hex"),
    },
  };
}

function activeBoundedAuthorityFixture({ ownerInstanceGuid } = {}) {
  const expected = {
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    nodePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkoutRealPath: "D:/pulse/releases/pulse-v1",
    releaseSha: BOUNDED_RELEASE_SHA,
    profileSha256: BOUNDED_PROFILE_SHA,
    databaseIdentitySha256: BOUNDED_DATABASE_SHA,
    conflictingTaskNames: ["PulseGaming-Stabilisation-Runtime"],
    runtimeInstanceId: BOUNDED_RUNTIME_ID,
    taskInstanceGuid: BOUNDED_INSTANCE_GUID,
    supervisorPid: 4100,
    supervisorCreationTimeUtc: "2026-08-02T10:00:00.000Z",
    supervisorExecutablePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    supervisorCommandSha256: BOUNDED_SUPERVISOR_COMMAND_SHA,
    childPid: 4200,
    childCreationTimeUtc: "2026-08-02T10:00:01.000Z",
    childExecutablePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    childCommandSha256: BOUNDED_CHILD_COMMAND_SHA,
    workerTopology: BOUNDED_WORKER_TOPOLOGY,
  };
  const binding = {
    task_name: expected.taskName,
    node_path: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkout_real_path: "D:/pulse/releases/pulse-v1",
    release_sha: expected.releaseSha,
    profile_sha256: expected.profileSha256,
    database_identity_sha256: expected.databaseIdentitySha256,
  };
  const authorityFingerprint = require("node:crypto")
    .createHash("sha256")
    .update(
      '{"checkout_real_path":"D:/pulse/releases/pulse-v1","database_identity_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","node_path":"D:/pulse-tools/node-v22.17.1/node.exe","profile_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","release_sha":"dddddddddddddddddddddddddddddddddddddddd","task_name":"PulseGaming-LiveGuarded-YouTube-Runtime"}',
    )
    .digest("hex");
  const activation = {
    valid: true,
    schema_version: "pulse-windows-live-guarded-activation-receipt-v2",
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    authority_binding: binding,
    authority_fingerprint: authorityFingerprint,
    blockers: [],
  };
  const owner = {
    valid: true,
    schema_version: "pulse-windows-live-guarded-owner-v2",
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    authority_binding: binding,
    authority_fingerprint: authorityFingerprint,
    task_name: expected.taskName,
    task_instance_guid: ownerInstanceGuid || BOUNDED_INSTANCE_GUID,
    engine_pid: 4100,
    supervisor_pid: 4100,
    supervisor_creation_time_utc: expected.supervisorCreationTimeUtc,
    supervisor_executable_path: expected.supervisorExecutablePath,
    supervisor_command_sha256: expected.supervisorCommandSha256,
    child_pid: 4200,
    child_creation_time_utc: expected.childCreationTimeUtc,
    child_parent_pid: 4100,
    child_executable_path: expected.childExecutablePath,
    child_command_sha256: expected.childCommandSha256,
    child_in_job: true,
    listener_port: 3001,
    listener_pid: 4200,
    release_sha: expected.releaseSha,
    profile_sha256: expected.profileSha256,
    database_identity_sha256: expected.databaseIdentitySha256,
    blockers: [],
  };
  const observation = {
    ok: true,
    task_name: expected.taskName,
    task_instance: {
      instance_guid: BOUNDED_INSTANCE_GUID,
      engine_pid: 4100,
      state: 4,
    },
    supervisor: {
      ok: true,
      pid: 4100,
      creation_time_utc: expected.supervisorCreationTimeUtc,
      parent_pid: 900,
      executable_path: expected.supervisorExecutablePath,
      command_sha256: expected.supervisorCommandSha256,
      blockers: [],
    },
    child: {
      ok: true,
      pid: 4200,
      creation_time_utc: expected.childCreationTimeUtc,
      parent_pid: 4100,
      executable_path: expected.childExecutablePath,
      command_sha256: expected.childCommandSha256,
      blockers: [],
    },
    job_membership: {
      process_ids: [4100, 4200],
      child_present: true,
      blockers: [],
    },
    blockers: [],
  };
  return {
    mode: "LIVE",
    expected,
    probes: {
      taskDefinitionInspector: async () => ({
        task_name: expected.taskName,
        state: "managed_current",
        blockers: [],
      }),
      conflictInspector: async () => ({
        clear: true,
        tasks: [
          { task_name: "PulseGaming-Stabilisation-Runtime", state: "disabled" },
        ],
        blockers: [],
      }),
      activationReceiptInspector: async () => activation,
      ownerReceiptInspector: async () => owner,
      authorityObserver: async () => observation,
      listenerInspector: async () => ({
        available: true,
        listeningPids: [4200],
        blockers: [],
      }),
      healthRequester: async () => ({
        status: "ok",
        schedulerActive: true,
        build: { commit_sha: expected.releaseSha },
        deployment: { mode: "local", primary: true },
        runtime: {
          operating_mode: "LIVE_GUARDED",
          auto_publish: true,
          legacy_auto_publish_armed: true,
          use_sqlite: true,
          use_job_queue_explicit: "true",
        },
        multiLaneRuntime: boundedMultiLaneHealth(),
        blockers: [],
      }),
      databaseAuthorityInspector: async () => ({
        ok: true,
        database_identity_sha256: expected.databaseIdentitySha256,
        snapshot_sha256: BOUNDED_DATABASE_SNAPSHOT_SHA,
        scheduler: { owner_sha256: "f".repeat(64) },
        blockers: [],
      }),
    },
  };
}

function activationAuthorityOptions() {
  return {
    runtimeInstanceId: BOUNDED_RUNTIME_ID,
    nodePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkoutRealPath: "D:/pulse/releases/pulse-v1",
    databaseIdentitySha256: BOUNDED_DATABASE_SHA,
  };
}

function taskBoundActivation({
  profile,
  repoRoot,
  expectedCommit,
  receiptSha,
}) {
  const authorityBinding = buildLiveTaskAuthorityBinding({
    taskName: profile.task_name,
    nodePath: process.execPath,
    checkoutRealPath: repoRoot,
    releaseSha: expectedCommit,
    profileSha256: require("node:crypto")
      .createHash("sha256")
      .update(JSON.stringify(profile))
      .digest("hex"),
    databaseIdentitySha256: BOUNDED_DATABASE_SHA,
  });
  return {
    valid: true,
    schema_version: "pulse-windows-live-guarded-activation-receipt-v2",
    receipt_sha256: receiptSha,
    task_definition_sha256: buildLiveProcessCommandAuthority({
      profile,
      repoRoot,
      expectedCommit,
      nodeExecutable: process.execPath,
    }).supervisor_command_sha256,
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    authority_binding: authorityBinding,
    authority_fingerprint: require("node:crypto")
      .createHash("sha256")
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.entries(authorityBinding).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          ),
        ),
      )
      .digest("hex"),
    blockers: [],
  };
}

function taskBoundHandoffObservation(child, expected = {}) {
  return {
    ok: true,
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    task_instance: {
      instance_guid: BOUNDED_INSTANCE_GUID,
      engine_pid: process.pid,
      state: 4,
    },
    supervisor: {
      ok: true,
      pid: process.pid,
      creation_time_utc: TEST_PROCESS_STARTED_AT,
      executable_path:
        expected.expectedSupervisorExecutablePath ||
        process.execPath.replace(/\\/g, "/"),
      command_sha256:
        expected.expectedSupervisorCommandSha256 ||
        BOUNDED_SUPERVISOR_COMMAND_SHA,
      blockers: [],
    },
    child: {
      ok: true,
      pid: child.pid,
      parent_pid: process.pid,
      creation_time_utc: TEST_REUSED_PROCESS_STARTED_AT,
      executable_path:
        expected.expectedChildExecutablePath ||
        process.execPath.replace(/\\/g, "/"),
      command_sha256:
        expected.expectedChildCommandSha256 || BOUNDED_CHILD_COMMAND_SHA,
      blockers: [],
    },
    job_membership: {
      process_ids: [process.pid, child.pid],
      supervisor_present: true,
      child_present: true,
      blockers: [],
    },
    blockers: [],
  };
}

test("builds one deterministic non-secret live task authority binding", () => {
  const fixture = activeBoundedAuthorityFixture();
  assert.deepEqual(buildLiveTaskAuthorityBinding(fixture.expected), {
    task_name: "PulseGaming-LiveGuarded-YouTube-Runtime",
    node_path: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkout_real_path: "D:/pulse/releases/pulse-v1",
    release_sha: BOUNDED_RELEASE_SHA,
    profile_sha256: BOUNDED_PROFILE_SHA,
    database_identity_sha256: BOUNDED_DATABASE_SHA,
  });
});

test("ACTIVE_BOUND requires one continuous task-to-lease identity", async () => {
  const result = await inspectBoundedWindowsAuthority(
    activeBoundedAuthorityFixture(),
  );
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.state, "ACTIVE_BOUND");
  assert.match(result.authority_fingerprint, /^[a-f0-9]{64}$/);
});

test("ACTIVE_BOUND supplies the exact runtime generation and worker topology to database authority", async () => {
  const fixture = activeBoundedAuthorityFixture();
  const observed = [];
  fixture.probes.databaseAuthorityInspector = async (options) => {
    observed.push(options);
    return {
      ok: true,
      database_identity_sha256: BOUNDED_DATABASE_SHA,
      snapshot_sha256: BOUNDED_DATABASE_SNAPSHOT_SHA,
      blockers: [],
    };
  };

  const result = await inspectBoundedWindowsAuthority(fixture);

  assert.equal(result.state, "ACTIVE_BOUND");
  assert.equal(observed.length, 2);
  for (const observation of observed) {
    assert.equal(observation.mode, "LIVE");
    assert.equal(observation.expected.runtime_instance_id, BOUNDED_RUNTIME_ID);
    assert.equal(observation.expected.child_pid, 4200);
    assert.equal(
      observation.expected.child_started_at,
      "2026-08-02T10:00:01.000Z",
    );
    assert.deepEqual(
      observation.expected.worker_topology,
      BOUNDED_WORKER_TOPOLOGY,
    );
  }
});

test("ACTIVE_BOUND binds database claims to the digest derived from live runner health", async () => {
  const fixture = activeBoundedAuthorityFixture();
  const healthClaimSha256 = "7".repeat(64);
  fixture.probes.healthRequester = async () => {
    const health = {
      status: "ok",
      schedulerActive: true,
      build: { commit_sha: BOUNDED_RELEASE_SHA },
      deployment: { mode: "local", primary: true },
      runtime: {
        operating_mode: "LIVE_GUARDED",
        auto_publish: true,
        legacy_auto_publish_armed: true,
        use_sqlite: true,
        use_job_queue_explicit: "true",
      },
      multiLaneRuntime: boundedMultiLaneHealth(),
      blockers: [],
    };
    health.multiLaneRuntime.isolated_worker_pools.active_claim_count = 1;
    health.multiLaneRuntime.isolated_worker_pools.running_claim_set_sha256 =
      healthClaimSha256;
    return health;
  };
  fixture.probes.databaseAuthorityInspector = async ({ expected }) => ({
    ok:
      expected.runtime_claim_set_count === 1 &&
      expected.runtime_claim_set_sha256 === healthClaimSha256,
    database_identity_sha256: BOUNDED_DATABASE_SHA,
    snapshot_sha256: BOUNDED_DATABASE_SNAPSHOT_SHA,
    blockers:
      expected.runtime_claim_set_sha256 === healthClaimSha256
        ? []
        : ["runtime_db_runtime_claim_set_mismatch"],
  });

  const green = await inspectBoundedWindowsAuthority(fixture);
  assert.equal(green.state, "ACTIVE_BOUND");

  fixture.probes.databaseAuthorityInspector = async ({ expected }) => ({
    ok: expected.runtime_claim_set_sha256 === "8".repeat(64),
    database_identity_sha256: BOUNDED_DATABASE_SHA,
    snapshot_sha256: BOUNDED_DATABASE_SNAPSHOT_SHA,
    blockers: ["runtime_db_runtime_claim_set_mismatch"],
  });
  const held = await inspectBoundedWindowsAuthority(fixture);
  assert.equal(held.state, "HOLD");
  assert.ok(held.blockers.includes("live_database_authority_mismatch"));
});

test("a mismatched task InstanceGuid is HOLD", async () => {
  const result = await inspectBoundedWindowsAuthority(
    activeBoundedAuthorityFixture({
      ownerInstanceGuid: "99999999-2222-4333-8444-555555555555",
    }),
  );
  assert.equal(result.state, "HOLD");
  assert.deepEqual(result.blockers, ["live_task_instance_receipt_mismatch"]);
});

test("ACTIVE_BOUND independently checks every expected task and process identity", async () => {
  for (const [field, value, blocker] of [
    [
      "taskInstanceGuid",
      "99999999-2222-4333-8444-555555555555",
      "live_task_instance_receipt_mismatch",
    ],
    ["supervisorPid", 4999, "live_task_process_identity_mismatch"],
    [
      "supervisorCreationTimeUtc",
      "2026-08-02T10:00:09.000Z",
      "live_task_process_identity_mismatch",
    ],
    [
      "supervisorCommandSha256",
      "1".repeat(64),
      "live_task_process_identity_mismatch",
    ],
    ["childPid", 4998, "live_task_process_identity_mismatch"],
    [
      "childCreationTimeUtc",
      "2026-08-02T10:00:19.000Z",
      "live_task_process_identity_mismatch",
    ],
    [
      "childCommandSha256",
      "2".repeat(64),
      "live_task_process_identity_mismatch",
    ],
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    fixture.expected[field] = value;
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", field);
    assert.ok(result.blockers.includes(blocker), field);
  }
});

test("ACTIVE_BOUND rejects omitted or malformed expected live identity fields", async () => {
  for (const [field, value] of [
    ["taskInstanceGuid", undefined],
    ["taskInstanceGuid", "not-a-guid"],
    ["taskInstanceGuid", `{${BOUNDED_INSTANCE_GUID}`],
    ["supervisorPid", undefined],
    ["supervisorPid", 0],
    ["supervisorPid", "4100"],
    ["supervisorCreationTimeUtc", undefined],
    ["supervisorCreationTimeUtc", "yesterday"],
    ["supervisorExecutablePath", undefined],
    ["supervisorExecutablePath", "node.exe"],
    ["supervisorCommandSha256", undefined],
    ["supervisorCommandSha256", "not-a-sha"],
    ["childPid", undefined],
    ["childPid", -1],
    ["childPid", "4200"],
    ["childCreationTimeUtc", undefined],
    ["childCreationTimeUtc", "not-a-time"],
    ["childExecutablePath", undefined],
    ["childExecutablePath", "server.js"],
    ["childCommandSha256", undefined],
    ["childCommandSha256", "short"],
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    if (value === undefined) delete fixture.expected[field];
    else fixture.expected[field] = value;
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", `${field}:${value}`);
    assert.deepEqual(
      result.blockers,
      ["live_task_authority_expected_identity_invalid"],
      `${field}:${value}`,
    );
  }
});

test("ACTIVE_BOUND rejects malformed owner-v2 and observed task/process structures", async () => {
  const cases = [
    ["owner", "task_instance_guid", undefined],
    ["owner", "engine_pid", "4100"],
    ["owner", "supervisor_creation_time_utc", "invalid"],
    ["owner", "supervisor_executable_path", "node.exe"],
    ["owner", "supervisor_command_sha256", "invalid"],
    ["owner", "child_pid", 0],
    ["owner", "child_creation_time_utc", "invalid"],
    ["owner", "child_parent_pid", "4100"],
    ["owner", "child_executable_path", "node.exe"],
    ["owner", "child_command_sha256", "invalid"],
    ["authority.task_instance", "engine_pid", "4100"],
    ["authority.task_instance", "state", undefined],
    ["authority.supervisor", "pid", "4100"],
    ["authority.supervisor", "creation_time_utc", "invalid"],
    ["authority.supervisor", "executable_path", "node.exe"],
    ["authority.supervisor", "command_sha256", "invalid"],
    ["authority.child", "pid", "4200"],
    ["authority.child", "creation_time_utc", "invalid"],
    ["authority.child", "parent_pid", "4100"],
    ["authority.child", "executable_path", "node.exe"],
    ["authority.child", "command_sha256", "invalid"],
    ["authority.job_membership", "process_ids", ["4100", 4200]],
  ];
  for (const [target, field, value] of cases) {
    const fixture = activeBoundedAuthorityFixture();
    if (target === "owner") {
      const original = fixture.probes.ownerReceiptInspector;
      fixture.probes.ownerReceiptInspector = async () => {
        const record = { ...(await original()) };
        if (value === undefined) delete record[field];
        else record[field] = value;
        return record;
      };
    } else {
      const section = target.split(".")[1];
      const original = fixture.probes.authorityObserver;
      fixture.probes.authorityObserver = async () => {
        const record = await original();
        return {
          ...record,
          [section]: { ...record[section], [field]: value },
        };
      };
    }
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", `${target}.${field}`);
    assert.ok(
      result.blockers.includes("live_task_authority_evidence_malformed"),
      `${target}.${field}:${inspect(result.blockers)}`,
    );
  }
});

test("ACTIVE_BOUND joins owner-v2 executable and command authority to the observation", async () => {
  for (const [field, value] of [
    ["supervisor_executable_path", "D:/other/node.exe"],
    ["supervisor_command_sha256", "1".repeat(64)],
    ["child_executable_path", "D:/other/node.exe"],
    ["child_command_sha256", "2".repeat(64)],
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    const original = fixture.probes.ownerReceiptInspector;
    fixture.probes.ownerReceiptInspector = async () => ({
      ...(await original()),
      [field]: value,
    });
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", field);
    assert.ok(result.blockers.includes("live_task_instance_receipt_mismatch"));
  }

  const taskName = activeBoundedAuthorityFixture();
  const original = taskName.probes.authorityObserver;
  taskName.probes.authorityObserver = async () => ({
    ...(await original()),
    task_name: "Different-Task",
  });
  assert.equal((await inspectBoundedWindowsAuthority(taskName)).state, "HOLD");
});

function stoppedBoundedAuthorityFixture() {
  const expected = {
    taskName: "PulseGaming-LiveGuarded-YouTube-Runtime",
    nodePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkoutRealPath: "D:/pulse/releases/pulse-v1",
    releaseSha: BOUNDED_RELEASE_SHA,
    profileSha256: BOUNDED_PROFILE_SHA,
    databaseIdentitySha256: BOUNDED_DATABASE_SHA,
    conflictingTaskNames: ["PulseGaming-Stabilisation-Runtime"],
    supervisorExecutablePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    supervisorCommandSha256: BOUNDED_SUPERVISOR_COMMAND_SHA,
    childExecutablePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    childCommandSha256: BOUNDED_CHILD_COMMAND_SHA,
  };
  return {
    mode: "QUIESCENT",
    expected,
    probes: {
      taskDefinitionInspector: async () => ({
        task_name: expected.taskName,
        state: "managed_disabled",
        blockers: [],
      }),
      taskInstancesInspector: async () => ({
        ok: true,
        instances: [],
        blockers: [],
      }),
      conflictInspector: async () => ({
        clear: true,
        tasks: [
          { task_name: "PulseGaming-Stabilisation-Runtime", state: "disabled" },
        ],
        blockers: [],
      }),
      activationReceiptInspector: async () => ({
        present: false,
        blockers: [],
      }),
      ownerReceiptInspector: async () => ({
        state: "absent",
        blockers: [],
      }),
      listenerInspector: async () => ({
        available: true,
        listeningPids: [],
        blockers: [],
      }),
      databaseAuthorityInspector: async () => ({
        ok: true,
        database_identity_sha256: BOUNDED_DATABASE_SHA,
        snapshot_sha256: BOUNDED_DATABASE_SNAPSHOT_SHA,
        scheduler: { owner: "scheduler:raw-private-owner" },
        blockers: [],
      }),
    },
  };
}

test("STOPPED_BOUND requires two stable quiescent observations", async () => {
  const result = await inspectBoundedWindowsAuthority(
    stoppedBoundedAuthorityFixture(),
  );
  assert.equal(result.verdict, "GREEN");
  assert.equal(result.state, "STOPPED_BOUND");
  assert.match(result.authority_fingerprint, /^[a-f0-9]{64}$/);
});

test("STOPPED_BOUND rejects unarchived exact-stale owners and validates governed owner-v2 archives", async () => {
  const unarchived = stoppedBoundedAuthorityFixture();
  unarchived.probes.ownerReceiptInspector = async () => ({
    state: "exact_stale",
    blockers: [],
  });
  const unarchivedResult = await inspectBoundedWindowsAuthority(unarchived);
  assert.equal(unarchivedResult.state, "HOLD");
  assert.ok(
    unarchivedResult.blockers.includes(
      "quiescent_owner_receipt_not_governed_stale",
    ),
  );

  const active = activeBoundedAuthorityFixture();
  const ownerV2 = await active.probes.ownerReceiptInspector();
  for (const mutation of [
    { authority_fingerprint: "0".repeat(64) },
    { supervisor_command_sha256: "invalid" },
    { supervisor_command_sha256: "7".repeat(64) },
    { child_executable_path: "node.exe" },
    { child_executable_path: "D:/other/node.exe" },
    { archive_receipt_sha256: "invalid" },
    { archive_policy_applied: false },
  ]) {
    const fixture = stoppedBoundedAuthorityFixture();
    fixture.probes.ownerReceiptInspector = async () => ({
      ...ownerV2,
      state: "governed_stale",
      archived: true,
      archive_policy_applied: true,
      archive_receipt_sha256: "f".repeat(64),
      blockers: [],
      ...mutation,
    });
    assert.equal(
      (await inspectBoundedWindowsAuthority(fixture)).state,
      "HOLD",
      inspect(mutation),
    );
  }

  const governed = stoppedBoundedAuthorityFixture();
  governed.probes.ownerReceiptInspector = async () => ({
    ...ownerV2,
    state: "governed_stale",
    archived: true,
    archive_policy_applied: true,
    archive_receipt_sha256: "f".repeat(64),
    blockers: [],
  });
  assert.equal(
    (await inspectBoundedWindowsAuthority(governed)).state,
    "STOPPED_BOUND",
  );
});

test("changing bounded observations are HOLD", async () => {
  const fixture = stoppedBoundedAuthorityFixture();
  let reads = 0;
  fixture.probes.taskDefinitionInspector = async () => ({
    state: reads++ === 0 ? "managed_disabled" : "managed_current",
    blockers: [],
  });
  const result = await inspectBoundedWindowsAuthority(fixture);
  assert.equal(result.state, "HOLD");
  assert.deepEqual(result.blockers, ["bounded_authority_observation_unstable"]);
});

test("ACTIVE_BOUND requires a stable canonical database snapshot digest", async () => {
  for (const snapshotSha256 of [undefined, "not-a-sha"]) {
    const fixture = activeBoundedAuthorityFixture();
    fixture.probes.databaseAuthorityInspector = async () => ({
      ok: true,
      database_identity_sha256: BOUNDED_DATABASE_SHA,
      snapshot_sha256: snapshotSha256,
      blockers: [],
    });
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", String(snapshotSha256));
    assert.ok(
      result.blockers.includes("live_database_authority_mismatch"),
      String(snapshotSha256),
    );
  }

  const changing = activeBoundedAuthorityFixture();
  let reads = 0;
  changing.probes.databaseAuthorityInspector = async () => ({
    ok: true,
    database_identity_sha256: BOUNDED_DATABASE_SHA,
    snapshot_sha256: reads++ === 0 ? "1".repeat(64) : "2".repeat(64),
    blockers: [],
  });
  const changed = await inspectBoundedWindowsAuthority(changing);
  assert.equal(changed.state, "HOLD");
  assert.deepEqual(changed.blockers, [
    "bounded_authority_observation_unstable",
  ]);
});

test("STOPPED_BOUND requires a stable canonical database snapshot digest", async () => {
  for (const snapshotSha256 of [undefined, "not-a-sha"]) {
    const fixture = stoppedBoundedAuthorityFixture();
    fixture.probes.databaseAuthorityInspector = async () => ({
      ok: true,
      database_identity_sha256: BOUNDED_DATABASE_SHA,
      snapshot_sha256: snapshotSha256,
      blockers: [],
    });
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", String(snapshotSha256));
    assert.ok(
      result.blockers.includes("quiescent_database_authority_mismatch"),
      String(snapshotSha256),
    );
  }

  const changing = stoppedBoundedAuthorityFixture();
  let reads = 0;
  changing.probes.databaseAuthorityInspector = async () => ({
    ok: true,
    database_identity_sha256: BOUNDED_DATABASE_SHA,
    snapshot_sha256: reads++ === 0 ? "1".repeat(64) : "2".repeat(64),
    blockers: [],
  });
  const changed = await inspectBoundedWindowsAuthority(changing);
  assert.equal(changed.state, "HOLD");
  assert.deepEqual(changed.blockers, [
    "bounded_authority_observation_unstable",
  ]);
});

test("ACTIVE_BOUND requires health to report the exact running worker set", async () => {
  for (const isolatedWorkerPools of [
    {
      ...boundedMultiLaneHealth().isolated_worker_pools,
      running_worker_set_sha256: "0".repeat(64),
    },
    {
      ...boundedMultiLaneHealth().isolated_worker_pools,
      active_runner_count: 0,
    },
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    const original = fixture.probes.healthRequester;
    fixture.probes.healthRequester = async () => ({
      ...(await original()),
      multiLaneRuntime: { isolated_worker_pools: isolatedWorkerPools },
    });
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD");
    assert.ok(result.blockers.includes("live_task_health_mismatch"));
  }
});

test("bounded verdicts never expose raw command text or database lease owners", async () => {
  const result = await inspectBoundedWindowsAuthority(
    stoppedBoundedAuthorityFixture(),
  );
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes("sk-live-secret"), false);
  assert.equal(serialised.includes("scheduler:raw-private-owner"), false);
});

test("HOLD exposes a runtime instance ID only after strict validation", async () => {
  for (const unsafeRuntimeInstanceId of [
    "ri-sk-live-secret",
    `ri-${"a".repeat(4096)}-sk-live-secret`,
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    fixture.expected.runtimeInstanceId = unsafeRuntimeInstanceId;
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD");
    assert.equal(result.runtime_instance_id, null);
    assert.equal(JSON.stringify(result).includes("sk-live-secret"), false);
  }
});

test("bounded verdicts reject contradictory probe states without copying raw blockers", async () => {
  const taskFixture = stoppedBoundedAuthorityFixture();
  taskFixture.probes.taskDefinitionInspector = async () => ({
    state: "managed_disabled",
    blockers: ["raw task error with sk-live-private"],
  });
  const taskResult = await inspectBoundedWindowsAuthority(taskFixture);
  assert.equal(taskResult.state, "HOLD");
  assert.ok(
    taskResult.blockers.includes("quiescent_task_definition_untrusted"),
  );
  assert.equal(JSON.stringify(taskResult).includes("sk-live-private"), false);

  const databaseFixture = activeBoundedAuthorityFixture();
  databaseFixture.probes.databaseAuthorityInspector = async () => ({
    ok: false,
    database_identity_sha256: BOUNDED_DATABASE_SHA,
    blockers: ["lease owner scheduler:raw-private-owner"],
  });
  const databaseResult = await inspectBoundedWindowsAuthority(databaseFixture);
  assert.equal(databaseResult.state, "HOLD");
  assert.deepEqual(databaseResult.blockers, [
    "live_database_authority_mismatch",
  ]);
  assert.equal(
    JSON.stringify(databaseResult).includes("scheduler:raw-private-owner"),
    false,
  );
});

test("ACTIVE_BOUND requires blocker-free evidence from every live authority probe", async () => {
  for (const probe of [
    "taskDefinitionInspector",
    "conflictInspector",
    "activationReceiptInspector",
    "ownerReceiptInspector",
    "authorityObserver",
    "listenerInspector",
    "healthRequester",
    "databaseAuthorityInspector",
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    const original = fixture.probes[probe];
    fixture.probes[probe] = async (...args) => ({
      ...(await original(...args)),
      blockers: [`raw-${probe}-sk-live-secret`],
    });
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", probe);
    assert.equal(
      JSON.stringify(result).includes("sk-live-secret"),
      false,
      probe,
    );
  }
});

test("bounded authority requires explicit blocker arrays and exact RUNNING task evidence", async () => {
  for (const probe of [
    "taskDefinitionInspector",
    "conflictInspector",
    "activationReceiptInspector",
    "ownerReceiptInspector",
    "authorityObserver",
    "listenerInspector",
    "healthRequester",
    "databaseAuthorityInspector",
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    const original = fixture.probes[probe];
    fixture.probes[probe] = async (...args) => {
      const result = { ...(await original(...args)) };
      delete result.blockers;
      return result;
    };
    assert.equal(
      (await inspectBoundedWindowsAuthority(fixture)).state,
      "HOLD",
      probe,
    );
  }

  for (const mutation of [
    { task_name: "Different-Task" },
    { state: 3 },
    { instance_guid: "99999999-2222-4333-8444-555555555555" },
    { engine_pid: 4999 },
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    const original = fixture.probes.authorityObserver;
    fixture.probes.authorityObserver = async () => {
      const result = await original();
      return Object.prototype.hasOwnProperty.call(mutation, "task_name")
        ? { ...result, task_name: mutation.task_name }
        : {
            ...result,
            task_instance: { ...result.task_instance, ...mutation },
          };
    };
    assert.equal(
      (await inspectBoundedWindowsAuthority(fixture)).state,
      "HOLD",
      inspect(mutation),
    );
  }
});

test("STOPPED_BOUND requires explicit blocker arrays from every quiescent result", async () => {
  for (const probe of [
    "taskDefinitionInspector",
    "taskInstancesInspector",
    "conflictInspector",
    "activationReceiptInspector",
    "ownerReceiptInspector",
    "listenerInspector",
    "databaseAuthorityInspector",
  ]) {
    const fixture = stoppedBoundedAuthorityFixture();
    const original = fixture.probes[probe];
    fixture.probes[probe] = async (...args) => {
      const result = { ...(await original(...args)) };
      delete result.blockers;
      return result;
    };
    assert.equal(
      (await inspectBoundedWindowsAuthority(fixture)).state,
      "HOLD",
      probe,
    );
  }
});

test("STOPPED_BOUND requires blocker-free evidence from every quiescent authority probe", async () => {
  for (const probe of [
    "taskDefinitionInspector",
    "taskInstancesInspector",
    "conflictInspector",
    "activationReceiptInspector",
    "ownerReceiptInspector",
    "listenerInspector",
    "databaseAuthorityInspector",
  ]) {
    const fixture = stoppedBoundedAuthorityFixture();
    const original = fixture.probes[probe];
    fixture.probes[probe] = async (...args) => ({
      ...(await original(...args)),
      blockers: [`raw-${probe}-sk-live-secret`],
    });
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", probe);
    assert.equal(
      JSON.stringify(result).includes("sk-live-secret"),
      false,
      probe,
    );
  }
});

test("ACTIVE_BOUND requires complete clear evidence for bounded legacy-task conflicts", async () => {
  for (const conflictResult of [
    {
      clear: false,
      tasks: [
        { task_name: "PulseGaming-Stabilisation-Runtime", state: "enabled" },
      ],
      blockers: ["conflicting_runtime_task_enabled"],
    },
    { clear: true, blockers: [] },
    { clear: "yes", tasks: [], blockers: [] },
  ]) {
    const fixture = activeBoundedAuthorityFixture();
    fixture.probes.conflictInspector = async () => conflictResult;
    const result = await inspectBoundedWindowsAuthority(fixture);
    assert.equal(result.state, "HOLD", inspect(conflictResult));
    assert.ok(
      result.blockers.includes("live_conflicting_task_authority_untrusted"),
    );
  }
});

test("bounded verdicts reconcile the exact configured conflict-task roster", async () => {
  for (const tasks of [
    [],
    [
      { task_name: "PulseGaming-Stabilisation-Runtime", state: "disabled" },
      { task_name: "PulseGaming-Stabilisation-Runtime", state: "disabled" },
    ],
    [{ task_name: "Unrelated-Backup-Task", state: "disabled" }],
    [{ task_name: "PulseGaming-Stabilisation-Runtime", state: "enabled" }],
    [
      {
        task_name: "PulseGaming-Stabilisation-Runtime",
        state: "inspection_error",
      },
    ],
    [{ task_name: "PulseGaming-Stabilisation-Runtime", state: "unknown" }],
  ]) {
    for (const fixture of [
      activeBoundedAuthorityFixture(),
      stoppedBoundedAuthorityFixture(),
    ]) {
      fixture.probes.conflictInspector = async () => ({
        clear: true,
        tasks,
        blockers: [],
      });
      assert.equal(
        (await inspectBoundedWindowsAuthority(fixture)).state,
        "HOLD",
        `${fixture.mode}:${inspect(tasks)}`,
      );
    }
  }

  for (const state of ["absent", "disabled"]) {
    const fixture = activeBoundedAuthorityFixture();
    fixture.probes.conflictInspector = async () => ({
      clear: true,
      tasks: [{ task_name: "PulseGaming-Stabilisation-Runtime", state }],
      blockers: [],
    });
    assert.equal(
      (await inspectBoundedWindowsAuthority(fixture)).state,
      "ACTIVE_BOUND",
      state,
    );
  }
});

test("the default Windows process identity probe returns only PID and creation time", () => {
  assert.equal(typeof inspectWindowsProcessIdentity, "function");
  const calls = [];
  const identity = inspectWindowsProcessIdentity({
    pid: 4123,
    platform: "win32",
    execFileSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return JSON.stringify({
        probe: "process_identity",
        attested: true,
        process_id: 4123,
        process_started_at: TEST_PROCESS_STARTED_AT,
      });
    },
  });

  assert.deepEqual(identity, {
    available: true,
    exists: true,
    process_id: 4123,
    process_started_at: TEST_PROCESS_STARTED_AT,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.toLowerCase(), "powershell.exe");
  assert.equal(JSON.stringify(calls[0]).includes("4123"), true);
  assert.equal(JSON.stringify(calls[0]).includes("command_line"), false);

  assert.deepEqual(
    inspectWindowsProcessIdentity({
      pid: 4999,
      platform: "win32",
      execFileSyncImpl() {
        return JSON.stringify({
          probe: "process_identity",
          attested: true,
          process_id: 4999,
          process_started_at: null,
        });
      },
    }),
    {
      available: true,
      exists: false,
      process_id: 4999,
      process_started_at: null,
    },
  );
});
const {
  loadSafeRuntimeProfile,
  validateSafeRuntimeProfile,
} = require("../../lib/stabilisation/windows-local-runtime-supervisor");
const {
  parseArgs: parseLiveRuntimeArgs,
} = require("../../tools/windows-live-guarded-runtime");

test("activation CLI accepts one explicit non-secret OAuth client hash", () => {
  const expectedHash = "6".repeat(64);
  const options = parseLiveRuntimeArgs([
    "issue-activation",
    "--youtube-oauth-client-sha256",
    expectedHash,
  ]);

  assert.equal(options.youtubeOAuthClientSha256, expectedHash);
});

test("the guarded start action is a separately confirmed mutation and is admitted only for an exact stopped live runway", () => {
  const common = {
    action: "start",
    profileValidation: { valid: true, blockers: [] },
    checkout: { ready: true, blockers: [] },
    database: { ready: true, blockers: [] },
    activation: {
      valid: true,
      receipt_sha256: "a".repeat(64),
      blockers: [],
    },
    conflicts: { clear: true, blockers: [] },
    task: { state: "managed_current", blockers: [] },
    runtime: {
      stopped: true,
      blockers: [],
    },
    startOperationLock: {
      clear: true,
      state: "absent",
      blockers: [],
    },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  };

  assert.equal(parseLiveRuntimeArgs(["start"]).action, "start");

  const admitted = buildLiveLifecycleDecision(common);
  assert.equal(admitted.ready, true);
  assert.equal(admitted.mutation_authorised, true);
  assert.equal(admitted.planned_effect, "start_verified_runtime");
  assert.equal(admitted.production_green, false);
  assert.equal(admitted.external_publish_possible, false);

  for (const [override, blocker] of [
    [
      {
        activation: {
          valid: false,
          blockers: ["activation_receipt_commit_mismatch"],
        },
      },
      "activation_receipt_commit_mismatch",
    ],
    [
      { task: { state: "managed_disabled", blockers: [] } },
      "enabled_managed_task_required",
    ],
    [
      {
        conflicts: {
          clear: false,
          blockers: ["conflicting_runtime_task_enabled"],
        },
      },
      "conflicting_runtime_task_enabled",
    ],
    [
      {
        runtime: {
          stopped: false,
          blockers: ["live_supervisor_port_not_free"],
        },
      },
      "live_supervisor_port_not_free",
    ],
    [{ confirmation: "yes" }, "live_lifecycle_confirmation_required"],
  ]) {
    const rejected = buildLiveLifecycleDecision({
      ...common,
      ...override,
    });
    assert.equal(rejected.mutation_authorised, false);
    assert.ok(rejected.blockers.includes(blocker), blocker);
  }
});

test("start doctor carries the stopped-runtime inspection into its mutation decision", () => {
  const expectedCommit = "e".repeat(40);
  let runtimeInspections = 0;
  let startLockInspections = 0;
  const dependencies = {
    inspectCheckout: () => ({ ready: true, blockers: [] }),
    inspectDatabase: () => ({ ready: true, blockers: [] }),
    inspectActivation: () => ({
      valid: true,
      receipt_sha256: "f".repeat(64),
      blockers: [],
    }),
    inspectTask: () => ({
      state: "managed_current",
      blockers: [],
    }),
    inspectConflicts: () => ({ clear: true, blockers: [] }),
    inspectRuntime: () => {
      runtimeInspections += 1;
      return {
        stopped: true,
        owner_receipt_present: false,
        listening_pids: [],
        blockers: [],
      };
    },
    inspectStartLock: () => {
      startLockInspections += 1;
      return {
        present: false,
        valid: true,
        clear: true,
        state: "absent",
        blockers: [],
      };
    },
  };
  const admitted = buildLiveRuntimeDoctorReport({
    action: "start",
    expectedCommit,
    repoRoot: ROOT,
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
    dependencies,
  });
  assert.equal(runtimeInspections, 1);
  assert.equal(startLockInspections, 1);
  assert.equal(admitted.checks.runtime.stopped, true);
  assert.equal(admitted.checks.start_operation_lock.state, "absent");
  assert.equal(admitted.decision.mutation_authorised, true);
  assert.equal(admitted.decision.planned_effect, "start_verified_runtime");

  const blocked = buildLiveRuntimeDoctorReport({
    action: "start",
    expectedCommit,
    repoRoot: ROOT,
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
    dependencies: {
      ...dependencies,
      inspectRuntime: () => ({
        stopped: false,
        owner_receipt_present: true,
        listening_pids: [4321],
        blockers: [
          "live_supervisor_port_not_free",
          "live_supervisor_owner_receipt_present",
        ],
      }),
    },
  });
  assert.equal(blocked.decision.mutation_authorised, false);
  assert.ok(
    blocked.decision.blockers.includes("live_supervisor_port_not_free"),
  );
  assert.ok(
    blocked.decision.blockers.includes("live_supervisor_owner_receipt_present"),
  );
  assert.equal(blocked.verdict, "HOLD");

  const locked = buildLiveRuntimeDoctorReport({
    action: "start",
    expectedCommit,
    repoRoot: ROOT,
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
    dependencies: {
      ...dependencies,
      inspectStartLock: () => ({
        present: true,
        valid: true,
        clear: false,
        state: "active",
        operation_nonce: START_OPERATION_NONCE,
        blockers: ["live_start_operation_lock_active"],
      }),
    },
  });
  assert.equal(locked.verdict, "HOLD");
  assert.equal(locked.decision.mutation_authorised, false);
  assert.equal(locked.checks.start_operation_lock.state, "active");
  assert.ok(
    locked.decision.blockers.includes("live_start_operation_lock_active"),
  );

  const staleUnsafe = buildLiveRuntimeDoctorReport({
    action: "start",
    expectedCommit,
    repoRoot: ROOT,
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
    dependencies: {
      ...dependencies,
      inspectStartLock: () => ({
        present: true,
        valid: true,
        clear: false,
        state: "stale_recovery_blocked",
        operation_nonce: START_OPERATION_NONCE,
        blockers: ["live_start_operation_stale_recovery_unsafe"],
      }),
    },
  });
  assert.equal(staleUnsafe.verdict, "HOLD");
  assert.equal(staleUnsafe.decision.mutation_authorised, false);
  assert.ok(
    staleUnsafe.decision.blockers.includes(
      "live_start_operation_stale_recovery_unsafe",
    ),
  );
});

test("conflicting task query failures are blockers rather than false absence", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const result = inspectLiveTaskConflicts({
    profile,
    platform: "win32",
    execFileSyncImpl() {
      const error = new Error("Access is denied");
      error.code = 5;
      throw error;
    },
  });

  assert.equal(result.clear, false);
  assert.deepEqual(result.tasks, [
    {
      task_name: "PulseGaming-Stabilisation-Runtime",
      state: "inspection_error",
    },
  ]);
  assert.deepEqual(result.blockers, [
    "conflicting_runtime_task_inspection_failed:" +
      "PulseGaming-Stabilisation-Runtime",
  ]);
});

test("configured conflict inspection distinguishes exact COM absence without enumerating tasks", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const calls = [];
  const absent = inspectLiveTaskConflicts({
    profile,
    platform: "win32",
    execFileSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return JSON.stringify({
        Found: false,
        Enabled: null,
        HResult: -2147024894,
      });
    },
  });
  assert.deepEqual(absent, {
    clear: true,
    tasks: [
      {
        task_name: "PulseGaming-Stabilisation-Runtime",
        state: "absent",
      },
    ],
    blockers: [],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command.toLowerCase(), "powershell.exe");
  assert.equal(calls[0].args.join(" ").includes("GetTask("), true);
  assert.equal(calls[0].args.join(" ").includes("GetTasks("), false);
  assert.equal(
    calls[0].args.join(" ").includes("PulseGaming-Stabilisation-Runtime"),
    true,
  );

  const unavailable = inspectLiveTaskConflicts({
    profile,
    platform: "win32",
    execFileSyncImpl() {
      return JSON.stringify({
        Found: false,
        Enabled: null,
        HResult: -2147024891,
      });
    },
  });
  assert.equal(unavailable.clear, false);
  assert.equal(unavailable.tasks[0].state, "inspection_error");
  assert.deepEqual(unavailable.blockers, [
    "conflicting_runtime_task_inspection_failed:" +
      "PulseGaming-Stabilisation-Runtime",
  ]);
});

test("stopped-runtime inspection accepts only an exact dead stale owner that the supervisor can archive", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
  };
  const exactOwner = {
    schema_version: "pulse-windows-live-guarded-owner-v1",
    supervisor_pid: 4100,
    supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
    child_pid: 4200,
    child_process_started_at: TEST_PROCESS_STARTED_AT,
    port: profile.port,
    repo_root: ROOT.replace(/\\/g, "/"),
    commit_sha: expectedCommit,
    profile_sha256:
      "508c2b2a5284af6d5784ff245e3e4dca2dd6159bd470fdc11d2737bc76495aaa",
    activation_receipt_sha256: activation.receipt_sha256,
    start_operation_nonce: START_OPERATION_NONCE,
    platform: "youtube",
  };
  const inspect = (owner, identityInspector = processIdentityInspector({})) =>
    inspectStoppedLiveRuntime({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      listenerInspector: () => ({
        available: true,
        listeningPids: [],
      }),
      existsSync: () => true,
      readFileSync: () => JSON.stringify(owner),
      processIdentityInspector: identityInspector,
    });

  const exactStale = inspect(exactOwner);
  assert.equal(exactStale.stopped, true);
  assert.equal(exactStale.owner_state, "exact_stale");
  assert.deepEqual(exactStale.blockers, []);

  const mismatched = inspect({
    ...exactOwner,
    commit_sha: "e".repeat(40),
  });
  assert.equal(mismatched.stopped, false);
  assert.equal(mismatched.owner_state, "mismatch");
  assert.ok(
    mismatched.blockers.includes("live_supervisor_owner_receipt_mismatch"),
  );

  const active = inspect(
    exactOwner,
    processIdentityInspector({
      4100: TEST_PROCESS_STARTED_AT,
    }),
  );
  assert.equal(active.stopped, false);
  assert.equal(active.owner_state, "active");
  assert.ok(active.blockers.includes("live_supervisor_owner_process_alive"));

  const reusedPid = inspect(
    exactOwner,
    processIdentityInspector({
      4100: TEST_REUSED_PROCESS_STARTED_AT,
      4200: TEST_REUSED_PROCESS_STARTED_AT,
    }),
  );
  assert.equal(reusedPid.stopped, true);
  assert.equal(reusedPid.owner_state, "exact_stale");

  const unavailable = inspect(
    exactOwner,
    processIdentityInspector({ 4100: "UNAVAILABLE" }),
  );
  assert.equal(unavailable.stopped, false);
  assert.equal(unavailable.owner_state, "identity_unavailable");
  assert.ok(
    unavailable.blockers.includes(
      "live_supervisor_owner_process_identity_unavailable",
    ),
  );
});

test("stopped-runtime inspection validates owner-v2 task authority before declaring exact stale", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = taskBoundActivation({
    profile,
    repoRoot: ROOT,
    expectedCommit,
    receiptSha: "c".repeat(64),
  });
  const binding = activation.authority_binding;
  const exactOwnerV2 = {
    schema_version: "pulse-windows-live-guarded-owner-v2",
    runtime_instance_id: activation.runtime_instance_id,
    task_name: profile.task_name,
    task_instance_guid: BOUNDED_INSTANCE_GUID,
    engine_pid: 4100,
    supervisor_pid: 4100,
    supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
    supervisor_creation_time_utc: TEST_PROCESS_STARTED_AT,
    supervisor_executable_path: binding.node_path,
    supervisor_command_sha256: BOUNDED_SUPERVISOR_COMMAND_SHA,
    child_pid: 4200,
    child_process_started_at: TEST_PROCESS_STARTED_AT,
    child_creation_time_utc: TEST_PROCESS_STARTED_AT,
    child_parent_pid: 4100,
    child_executable_path: binding.node_path,
    child_command_sha256: BOUNDED_CHILD_COMMAND_SHA,
    child_in_job: true,
    listener_port: profile.port,
    listener_pid: 4200,
    port: profile.port,
    repo_root: ROOT.replace(/\\/g, "/"),
    commit_sha: expectedCommit,
    release_sha: expectedCommit,
    profile_sha256: binding.profile_sha256,
    database_identity_sha256: binding.database_identity_sha256,
    authority_binding: binding,
    authority_fingerprint: activation.authority_fingerprint,
    activation_receipt_sha256: activation.receipt_sha256,
    platform: "youtube",
    blockers: [],
  };
  const inspectOwner = (owner) =>
    inspectStoppedLiveRuntime({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      listenerInspector: () => ({ available: true, listeningPids: [] }),
      existsSync: () => true,
      readFileSync: () => JSON.stringify(owner),
      processIdentityInspector: processIdentityInspector({}),
      expectedSupervisorExecutablePath: binding.node_path,
      expectedSupervisorCommandSha256: BOUNDED_SUPERVISOR_COMMAND_SHA,
      expectedChildExecutablePath: binding.node_path,
      expectedChildCommandSha256: BOUNDED_CHILD_COMMAND_SHA,
    });

  assert.equal(inspectOwner(exactOwnerV2).owner_state, "exact_stale");
  for (const mutation of [
    { runtime_instance_id: undefined },
    { task_instance_guid: "invalid" },
    { supervisor_executable_path: "node.exe" },
    { supervisor_executable_path: "D:/other/node.exe" },
    { supervisor_command_sha256: "invalid" },
    { supervisor_command_sha256: "f".repeat(64) },
    { child_parent_pid: 4999 },
    { child_executable_path: "D:/other/node.exe" },
    { child_command_sha256: "invalid" },
    { child_command_sha256: "f".repeat(64) },
    { child_in_job: false },
    { authority_fingerprint: "0".repeat(64) },
  ]) {
    const result = inspectOwner({ ...exactOwnerV2, ...mutation });
    assert.equal(result.owner_state, "mismatch", inspect(mutation));
    assert.ok(
      result.blockers.includes("live_supervisor_owner_receipt_mismatch"),
      inspect(mutation),
    );
  }
});

test("start operation lock is durable, cross-process exclusive and nonce-owned", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-live-start-lock-"));
  try {
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      state_root: temp,
    };
    const common = {
      profile,
      expectedCommit: "d".repeat(40),
      activationReceiptSha256: "c".repeat(64),
      processId: 4100,
      processIdentityInspector: processIdentityInspector({
        4100: TEST_PROCESS_STARTED_AT,
      }),
    };
    const first = acquireLiveStartOperationLock({
      ...common,
      operationNonce: "11111111-1111-4111-8111-111111111111",
      generatedAt: "2026-07-29T22:00:00.000Z",
    });
    const persisted = JSON.parse(fs.readFileSync(first.lock_path, "utf8"));
    assert.equal(
      persisted.operation_nonce,
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(persisted.process_id, 4100);
    assert.equal(persisted.process_started_at, TEST_PROCESS_STARTED_AT);
    const inspected = inspectLiveStartOperationLock({
      profile,
      expectedCommit: common.expectedCommit,
      activationReceiptSha256: common.activationReceiptSha256,
      runtime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processIdentityInspector: processIdentityInspector({
        4100: TEST_PROCESS_STARTED_AT,
      }),
    });
    assert.equal(inspected.valid, true);
    assert.equal(inspected.clear, false);
    assert.equal(inspected.state, "active");
    assert.equal(inspected.operation_nonce, first.operation_nonce);
    const unsafeStale = inspectLiveStartOperationLock({
      profile,
      expectedCommit: common.expectedCommit,
      activationReceiptSha256: common.activationReceiptSha256,
      runtime: {
        stopped: false,
        listening_pids: [4999],
        owner_state: "active",
      },
      processIdentityInspector: processIdentityInspector({
        4100: TEST_REUSED_PROCESS_STARTED_AT,
      }),
    });
    assert.equal(unsafeStale.clear, false);
    assert.equal(unsafeStale.state, "stale_recovery_blocked");
    assert.ok(
      unsafeStale.blockers.includes(
        "live_start_operation_stale_recovery_unsafe",
      ),
    );
    const identityUnavailable = inspectLiveStartOperationLock({
      profile,
      expectedCommit: common.expectedCommit,
      activationReceiptSha256: common.activationReceiptSha256,
      runtime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processIdentityInspector: processIdentityInspector({
        4100: "UNAVAILABLE",
      }),
    });
    assert.equal(identityUnavailable.valid, false);
    assert.equal(identityUnavailable.clear, false);
    assert.equal(identityUnavailable.state, "identity_unavailable");
    assert.ok(
      identityUnavailable.blockers.includes(
        "live_start_operation_lock_process_identity_unavailable",
      ),
    );
    const mismatched = inspectLiveStartOperationLock({
      profile,
      expectedCommit: "e".repeat(40),
      activationReceiptSha256: common.activationReceiptSha256,
      runtime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processIdentityInspector: processIdentityInspector({}),
    });
    assert.equal(mismatched.clear, false);
    assert.equal(mismatched.state, "mismatch");
    assert.ok(
      mismatched.blockers.includes("live_start_operation_lock_commit_mismatch"),
    );

    assert.throws(
      () =>
        acquireLiveStartOperationLock({
          ...common,
          operationNonce: "22222222-2222-4222-8222-222222222222",
          staleRuntime: {
            stopped: true,
            listening_pids: [],
            owner_state: "absent",
          },
          processIdentityInspector: processIdentityInspector({
            4100: TEST_PROCESS_STARTED_AT,
          }),
        }),
      /live_start_operation_locked/,
    );

    const recovered = acquireLiveStartOperationLock({
      ...common,
      operationNonce: "22222222-2222-4222-8222-222222222222",
      staleRuntime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processIdentityInspector: processIdentityInspector({
        4100: TEST_REUSED_PROCESS_STARTED_AT,
      }),
      generatedAt: "2026-07-29T22:00:30.000Z",
    });
    assert.equal(
      recovered.operation_nonce,
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal(
      recovered.record.process_started_at,
      TEST_REUSED_PROCESS_STARTED_AT,
    );
    assert.equal(fs.existsSync(recovered.recovered_lock_evidence_path), true);
    assert.throws(
      () =>
        releaseLiveStartOperationLock({
          lock: {
            ...first,
            operation_nonce: "33333333-3333-4333-8333-333333333333",
          },
        }),
      /live_start_operation_lock_ownership_lost/,
    );
    assert.equal(fs.existsSync(first.lock_path), true);

    const released = releaseLiveStartOperationLock({
      lock: recovered,
      generatedAt: "2026-07-29T22:01:00.000Z",
    });
    assert.equal(released.outcome, "start_operation_lock_released");
    assert.equal(fs.existsSync(first.lock_path), false);
    assert.equal(fs.existsSync(released.evidence_path), true);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("an interrupted start-lock write never publishes partial authority and is recovered deterministically", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-start-lock-interrupted-"),
  );
  try {
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      state_root: temp,
    };
    const lockPath = path.join(temp, "start-operation.lock.json");
    let interrupted = false;
    const interruptedFileSystem = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "writeFileSync") {
          return Reflect.get(target, property, receiver);
        }
        return (destination, bytes, encoding) => {
          if (!interrupted && Number.isInteger(destination)) {
            interrupted = true;
            fs.writeSync(destination, Buffer.from("{", "utf8"));
            throw new Error("fixture_interrupted_before_lock_publication");
          }
          return fs.writeFileSync(destination, bytes, encoding);
        };
      },
    });

    assert.throws(
      () =>
        acquireLiveStartOperationLock({
          profile,
          expectedCommit: "d".repeat(40),
          activationReceiptSha256: "c".repeat(64),
          operationNonce: "11111111-1111-4111-8111-111111111111",
          processId: 4100,
          processIdentityInspector: processIdentityInspector({
            4100: TEST_PROCESS_STARTED_AT,
          }),
          generatedAt: "2026-07-29T22:00:00.000Z",
          fileSystemSync: interruptedFileSystem,
        }),
      /fixture_interrupted_before_lock_publication/,
    );
    assert.equal(fs.existsSync(lockPath), false);
    assert.equal(
      fs.readdirSync(temp).filter((name) => name.endsWith(".pending")).length,
      1,
    );

    assert.throws(
      () =>
        acquireLiveStartOperationLock({
          profile,
          expectedCommit: "d".repeat(40),
          activationReceiptSha256: "c".repeat(64),
          operationNonce: "22222222-2222-4222-8222-222222222222",
          processId: 4200,
          processIdentityInspector: processIdentityInspector({
            4100: TEST_PROCESS_STARTED_AT,
            4200: TEST_REUSED_PROCESS_STARTED_AT,
          }),
          staleRuntime: {
            stopped: true,
            listening_pids: [],
            owner_state: "absent",
          },
          generatedAt: "2026-07-29T22:00:30.000Z",
        }),
      /live_start_operation_locked/,
    );
    assert.equal(fs.existsSync(lockPath), false);

    const recovered = acquireLiveStartOperationLock({
      profile,
      expectedCommit: "d".repeat(40),
      activationReceiptSha256: "c".repeat(64),
      operationNonce: "22222222-2222-4222-8222-222222222222",
      processId: 4200,
      processIdentityInspector: processIdentityInspector({
        4100: TEST_REUSED_PROCESS_STARTED_AT,
        4200: TEST_REUSED_PROCESS_STARTED_AT,
      }),
      staleRuntime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      generatedAt: "2026-07-29T22:00:30.000Z",
    });

    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(
      fs.readdirSync(temp).some((name) => name.endsWith(".pending")),
      false,
    );
    assert.equal(recovered.recovered_incomplete_evidence_paths.length, 1);
    assert.equal(
      fs.existsSync(recovered.recovered_incomplete_evidence_paths[0]),
      true,
    );
    releaseLiveStartOperationLock({
      lock: recovered,
      generatedAt: "2026-07-29T22:01:00.000Z",
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("start-lock publication never replaces a competing final authority", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-start-lock-no-clobber-"),
  );
  try {
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      state_root: temp,
    };
    const lockPath = path.join(temp, "start-operation.lock.json");
    const competingBytes = '{"competing_authority":true}\n';
    let injected = false;
    const racingFileSystem = new Proxy(fs, {
      get(target, property, receiver) {
        if (property !== "linkSync") {
          return Reflect.get(target, property, receiver);
        }
        return (source, destination) => {
          if (!injected && destination === lockPath) {
            injected = true;
            fs.writeFileSync(destination, competingBytes, {
              encoding: "utf8",
              flag: "wx",
            });
          }
          return fs.linkSync(source, destination);
        };
      },
    });

    assert.throws(
      () =>
        acquireLiveStartOperationLock({
          profile,
          expectedCommit: "d".repeat(40),
          activationReceiptSha256: "c".repeat(64),
          operationNonce: "11111111-1111-4111-8111-111111111111",
          processId: 4100,
          processIdentityInspector: processIdentityInspector({
            4100: TEST_PROCESS_STARTED_AT,
          }),
          generatedAt: "2026-07-29T22:00:00.000Z",
          fileSystemSync: racingFileSystem,
        }),
      /live_start_operation_locked/,
    );
    assert.equal(fs.readFileSync(lockPath, "utf8"), competingBytes);
    assert.equal(
      fs.readdirSync(temp).some((name) => name.endsWith(".pending")),
      false,
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a legacy truncated final start lock is quarantined only on an exact stopped runway", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-start-lock-truncated-"),
  );
  try {
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      state_root: temp,
    };
    const lockPath = path.join(temp, "start-operation.lock.json");
    fs.writeFileSync(lockPath, "{", "utf8");

    const recovered = acquireLiveStartOperationLock({
      profile,
      expectedCommit: "d".repeat(40),
      activationReceiptSha256: "c".repeat(64),
      operationNonce: "22222222-2222-4222-8222-222222222222",
      processId: 4200,
      processIdentityInspector: processIdentityInspector({
        4200: TEST_REUSED_PROCESS_STARTED_AT,
      }),
      staleRuntime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      generatedAt: "2026-07-29T22:00:30.000Z",
    });

    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(recovered.recovered_incomplete_evidence_paths.length, 1);
    const quarantined = recovered.recovered_incomplete_evidence_paths[0];
    assert.equal(fs.existsSync(quarantined), true);
    assert.equal(fs.readFileSync(quarantined, "utf8"), "{");
    releaseLiveStartOperationLock({
      lock: recovered,
      generatedAt: "2026-07-29T22:01:00.000Z",
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("an exact dead stale owner is archived under the held start nonce before launch", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-stale-owner-"),
  );
  try {
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      state_root: temp,
    };
    const expectedCommit = "d".repeat(40);
    const activation = {
      valid: true,
      receipt_sha256: "c".repeat(64),
      blockers: [],
    };
    const lock = acquireLiveStartOperationLock({
      profile,
      expectedCommit,
      activationReceiptSha256: activation.receipt_sha256,
      operationNonce: START_OPERATION_NONCE,
      processId: process.pid,
      processIdentityInspector: processIdentityInspector({
        [process.pid]: TEST_PROCESS_STARTED_AT,
      }),
      generatedAt: "2026-07-29T22:00:00.000Z",
    });
    const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
    fs.writeFileSync(
      ownerPath,
      `${JSON.stringify(
        {
          schema_version: "pulse-windows-live-guarded-owner-v1",
          supervisor_pid: 991001,
          supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
          child_pid: 991002,
          child_process_started_at: TEST_PROCESS_STARTED_AT,
          port: profile.port,
          repo_root: ROOT.replace(/\\/g, "/"),
          commit_sha: expectedCommit,
          profile_sha256: lock.record.profile_sha256,
          activation_receipt_sha256: activation.receipt_sha256,
          platform: "youtube",
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    const archived = archiveExactStaleLiveOwner({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      operationNonce: lock.operation_nonce,
      listenerInspector: () => ({
        available: true,
        listeningPids: [],
      }),
      processIdentityInspector: processIdentityInspector({}),
      startLockInspector(options) {
        return inspectLiveStartOperationLock({
          ...options,
          processIdentityInspector: processIdentityInspector({
            [process.pid]: TEST_PROCESS_STARTED_AT,
          }),
        });
      },
      generatedAt: "2026-07-29T22:00:30.000Z",
    });

    assert.equal(archived.outcome, "exact_stale_owner_archived");
    assert.equal(fs.existsSync(ownerPath), false);
    assert.equal(fs.existsSync(archived.archived_path), true);
    releaseLiveStartOperationLock({
      lock,
      generatedAt: "2026-07-29T22:01:00.000Z",
    });
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("scheduled-task start supplies reviewed argv authority before locking and archives only the exact dead owner-v2", async (t) => {
  const expectedCommit = "d".repeat(40);
  const run = async (mutateOwner = (owner) => owner) => {
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-live-start-prelock-owner-v2-"),
    );
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      state_root: temp,
      activation_receipt_path: path.join(temp, "activation.json"),
    };
    const activation = taskBoundActivation({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      receiptSha: "c".repeat(64),
    });
    const commandAuthority = buildLiveProcessCommandAuthority({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      nodeExecutable: activation.authority_binding.node_path,
    });
    const owner = mutateOwner({
      schema_version: "pulse-windows-live-guarded-owner-v2",
      runtime_instance_id: activation.runtime_instance_id,
      task_name: profile.task_name,
      task_instance_guid: BOUNDED_INSTANCE_GUID,
      engine_pid: 991001,
      supervisor_pid: 991001,
      supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
      supervisor_creation_time_utc: TEST_PROCESS_STARTED_AT,
      supervisor_executable_path: activation.authority_binding.node_path,
      supervisor_command_sha256: commandAuthority.supervisor_command_sha256,
      child_pid: 991002,
      child_process_started_at: TEST_REUSED_PROCESS_STARTED_AT,
      child_creation_time_utc: TEST_REUSED_PROCESS_STARTED_AT,
      child_parent_pid: 991001,
      child_executable_path: activation.authority_binding.node_path,
      child_command_sha256: commandAuthority.child_command_sha256,
      child_in_job: true,
      listener_port: profile.port,
      listener_pid: 991002,
      port: profile.port,
      repo_root: ROOT.replace(/\\/g, "/"),
      commit_sha: expectedCommit,
      release_sha: expectedCommit,
      profile_sha256: activation.authority_binding.profile_sha256,
      database_identity_sha256:
        activation.authority_binding.database_identity_sha256,
      authority_binding: activation.authority_binding,
      authority_fingerprint: activation.authority_fingerprint,
      activation_receipt_sha256: activation.receipt_sha256,
      platform: "youtube",
      blockers: [],
    });
    fs.writeFileSync(
      path.join(temp, "supervisor-owner.json"),
      `${JSON.stringify(owner, null, 2)}\n`,
    );
    let archiveCalls = 0;
    const startLock = inMemoryStartLock();
    const promise = startLiveScheduledTask({
      ...startLock,
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      sourceDatabaseInspector: () => ({ ready: true }),
      activationInspector: () => activation,
      conflictInspector: () => ({ clear: true, blockers: [] }),
      taskInspector: () => ({ state: "managed_current", blockers: [] }),
      runtimeInspector: (options) => inspectStoppedLiveRuntime(options),
      listenerInspector: () => ({
        available: true,
        listeningPids: [],
        blockers: [],
      }),
      processIdentityInspector: processIdentityInspector({}),
      staleOwnerArchiver() {
        archiveCalls += 1;
        throw new Error("test_exact_owner_archive_reached");
      },
    });
    return { promise, archiveCalls: () => archiveCalls };
  };

  const exact = await run();
  await assert.rejects(exact.promise, /test_exact_owner_archive_reached/);
  assert.equal(exact.archiveCalls(), 1);

  for (const mutateOwner of [
    (owner) => ({
      ...owner,
      supervisor_executable_path: "D:/alternate/node.exe",
    }),
    (owner) => ({
      ...owner,
      supervisor_command_sha256: "f".repeat(64),
    }),
    (owner) => ({
      ...owner,
      child_executable_path: "D:/alternate/node.exe",
    }),
    (owner) => ({ ...owner, child_command_sha256: "f".repeat(64) }),
  ]) {
    const alternate = await run(mutateOwner);
    await assert.rejects(alternate.promise, /live_runtime_not_stopped/);
    assert.equal(alternate.archiveCalls(), 0);
  }
});

test("the separate reviewed LIVE_GUARDED profile is exact YouTube-only while the safe profile remains publication-incapable", () => {
  const live = loadLiveGuardedRuntimeProfile();
  assert.deepEqual(validateLiveGuardedRuntimeProfile(live), {
    valid: true,
    blockers: [],
  });
  assert.equal(
    live.profile_id,
    "pulse-v1-governed-multi-lane-live-guarded-youtube",
  );
  assert.equal(live.environment.PULSE_SCHEDULER_PROFILE, "governed_multi_lane");
  assert.equal(live.environment.PULSE_OPERATING_MODE, "LIVE_GUARDED");
  assert.equal(live.environment.OPERATING_MODE, "LIVE_GUARDED");
  assert.equal(live.environment.AUTO_PUBLISH, "true");
  assert.equal(live.environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED, "true");
  assert.equal(live.environment.PULSE_EMERGENCY_KILL_SWITCH, "false");
  assert.equal(live.environment.PULSE_KILL_SWITCH, "false");
  assert.equal(live.environment.YOUTUBE_AUTO_PUBLISH, "true");
  assert.equal(live.platform_policy.primary, "youtube");
  assert.equal(live.platform_policy.control_tower_required, true);
  assert.equal(live.platform_policy.fresh_control_required_per_release, true);
  assert.equal(
    live.platform_policy.oauth_client_sha256_bound_to_activation,
    true,
  );
  assert.equal(live.environment.PULSE_YOUTUBE_OAUTH_CLIENT_SHA256, undefined);

  for (const key of [
    "TIKTOK_ENABLED",
    "TIKTOK_AUTO_PUBLISH",
    "TIKTOK_AUTH_CHECK_ENABLED",
    "TIKTOK_BROWSER_FALLBACK",
    "USE_BUFFER_TIKTOK",
    "INSTAGRAM_AUTO_PUBLISH",
    "INSTAGRAM_PENDING_VERIFIER_ENABLED",
    "FACEBOOK_AUTO_PUBLISH",
    "FACEBOOK_REELS_ENABLED",
    "TWITTER_ENABLED",
    "X_AUTO_PUBLISH",
    "THREADS_AUTO_PUBLISH",
    "PINTEREST_AUTO_PUBLISH",
  ]) {
    assert.equal(live.environment[key], "false", key);
  }

  const safeProfilePath = path.join(
    ROOT,
    "config",
    "windows-local-runtime.governed-multi-lane.json",
  );
  const safeBytesBefore = fs.readFileSync(safeProfilePath, "utf8");
  const safe = loadSafeRuntimeProfile({ profilePath: safeProfilePath });
  assert.deepEqual(validateSafeRuntimeProfile(safe), {
    valid: true,
    blockers: [],
  });
  assert.equal(safe.environment.PULSE_OPERATING_MODE, "HUMAN_REVIEW");
  assert.equal(safe.environment.AUTO_PUBLISH, "false");
  assert.equal(safe.environment.PULSE_EMERGENCY_KILL_SWITCH, "true");
  assert.equal(fs.readFileSync(safeProfilePath, "utf8"), safeBytesBefore);
});

test("supervision preparation and health identity fail closed unless the receipt-bound doctor and live governed runtime both agree", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "9".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "8".repeat(64),
    youtube_oauth_client_sha256: "7".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    authority_fingerprint: "6".repeat(64),
    blockers: [],
  };
  assert.throws(
    () =>
      prepareLiveSupervision({
        report: {
          boot_profile_ready: false,
          checks: {
            activation: {
              valid: false,
              blockers: ["activation_receipt_missing"],
            },
          },
        },
        profile,
        expectedCommit,
      }),
    /live_boot_profile_not_ready/,
  );

  const prepared = prepareLiveSupervision({
    report: {
      boot_profile_ready: true,
      checks: { activation },
    },
    profile,
    expectedCommit,
    systemEnvironment: {
      PATH: "C:\\Windows\\System32",
      YOUTUBE_REFRESH_TOKEN: "must-not-pass-through",
    },
  });
  assert.equal(prepared.runtime_environment.AUTO_PUBLISH, "true");
  assert.equal(
    prepared.runtime_environment.PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256,
    activation.receipt_sha256,
  );
  assert.equal(prepared.runtime_environment.YOUTUBE_REFRESH_TOKEN, undefined);

  const liveHealth = {
    status: "ok",
    schedulerActive: true,
    build: { commit_sha: expectedCommit },
    deployment: { mode: "local", primary: true },
    runtime: {
      operating_mode: "LIVE_GUARDED",
      auto_publish: true,
      legacy_auto_publish_armed: true,
      use_sqlite: true,
      use_job_queue_explicit: "true",
    },
    multiLaneRuntime: boundedMultiLaneHealth(),
  };
  const expectedRuntime = {
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    worker_topology: BOUNDED_WORKER_TOPOLOGY,
  };
  assert.equal(
    safeLiveHealthIdentity(liveHealth, expectedCommit, expectedRuntime),
    true,
  );
  assert.equal(
    safeLiveHealthIdentity(
      {
        ...liveHealth,
        runtime: {
          ...liveHealth.runtime,
          auto_publish: false,
        },
      },
      expectedCommit,
      expectedRuntime,
    ),
    false,
  );
  assert.equal(
    safeLiveHealthIdentity(
      { ...liveHealth, schedulerActive: false },
      expectedCommit,
      expectedRuntime,
    ),
    false,
  );
  assert.equal(
    safeLiveHealthIdentity(
      {
        ...liveHealth,
        multiLaneRuntime: {
          isolated_worker_pools: {
            ...liveHealth.multiLaneRuntime.isolated_worker_pools,
            running_worker_set_sha256: "0".repeat(64),
          },
        },
      },
      expectedCommit,
      expectedRuntime,
    ),
    false,
  );
  assert.equal(safeLiveHealthIdentity(liveHealth, expectedCommit), false);

  for (const [name, mutate] of [
    [
      "default disabled",
      (pools) => ({ ...pools, default_enabled: false }),
    ],
    [
      "wrong active pool count",
      (pools) => ({ ...pools, active_pool_count: 2 }),
    ],
    [
      "attacker pool",
      (pools) => ({
        ...pools,
        active_runner_count: 2,
        active_pool_count: 2,
        pools: [
          ...pools.pools,
          {
            pool_id: "attacker_pool",
            active_instances: 1,
            heartbeat_ms: 30000,
            kinds: ["publish"],
          },
        ],
      }),
    ],
    [
      "duplicate pool ID",
      (pools) => ({ ...pools, pools: [...pools.pools, pools.pools[0]] }),
    ],
    [
      "unbounded instances",
      (pools) => ({
        ...pools,
        pools: [{ ...pools.pools[0], active_instances: 101 }],
      }),
    ],
    [
      "wrong kinds",
      (pools) => ({
        ...pools,
        pools: [{ ...pools.pools[0], kinds: ["attacker_kind"] }],
      }),
    ],
    [
      "wrong heartbeat",
      (pools) => ({
        ...pools,
        pools: [{ ...pools.pools[0], heartbeat_ms: 29999 }],
      }),
    ],
  ]) {
    const observed = liveHealth.multiLaneRuntime.isolated_worker_pools;
    assert.equal(
      safeLiveHealthIdentity(
        {
          ...liveHealth,
          multiLaneRuntime: {
            isolated_worker_pools: mutate(observed),
          },
        },
        expectedCommit,
        expectedRuntime,
      ),
      false,
      name,
    );
  }
});

test("handoff command fingerprints use semantic argv independently of valid Windows quoting", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const nodePath = "D:/pulse-tools/node-v22.17.1/node.exe";
  const repoRoot = "D:/pulse/releases/pulse-v1";
  const expectedSupervisorArguments = [
    "D:\\pulse\\releases\\pulse-v1\\tools\\windows-live-guarded-runtime.js",
    "supervise",
    "--noninteractive",
    "--repo-root",
    "D:\\pulse\\releases\\pulse-v1",
    "--expected-commit",
    expectedCommit,
    "--activation-receipt",
    "D:/pulse-data/runtime/pulse-live-guarded-youtube/activation-receipt.json",
  ];
  const expectedChildArguments = ["server.js"];
  const independentlyAuthoredSupervisorCommandLine =
    "D:\\pulse-tools\\node-v22.17.1\\node.exe " +
    '"D:\\pulse\\releases\\pulse-v1\\tools\\windows-live-guarded-runtime.js" ' +
    '"supervise" --noninteractive --repo-root ' +
    "D:\\pulse\\releases\\pulse-v1 --expected-commit " +
    `${expectedCommit} --activation-receipt ` +
    '"D:/pulse-data/runtime/pulse-live-guarded-youtube/activation-receipt.json"';
  const independentlyAuthoredChildCommandLine =
    '"D:/pulse-tools/node-v22.17.1/node.exe" "server.js"';
  const authority = buildLiveProcessCommandAuthority({
    profile,
    repoRoot,
    expectedCommit,
    nodeExecutable: nodePath,
  });
  const expectedSupervisorHash = require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify(expectedSupervisorArguments))
    .digest("hex");
  const expectedChildHash = require("node:crypto")
    .createHash("sha256")
    .update(JSON.stringify(expectedChildArguments))
    .digest("hex");
  assert.equal(authority.supervisor_command_sha256, expectedSupervisorHash);
  assert.equal(authority.child_command_sha256, expectedChildHash);

  const handoff = await inspectLiveTaskBoundHandoff({
    profile,
    supervisorPid: 4100,
    childPid: 4200,
    expectedSupervisorCreationTimeUtc: "2026-08-02T10:00:00.000Z",
    expectedSupervisorExecutablePath: nodePath,
    expectedSupervisorCommandSha256: expectedSupervisorHash,
    expectedChildCreationTimeUtc: "2026-08-02T10:00:01.000Z",
    expectedChildExecutablePath: nodePath,
    expectedChildCommandSha256: expectedChildHash,
    execFileSyncImpl(executable, arguments_) {
      assert.equal(executable, "powershell.exe");
      const script = arguments_.at(-1);
      if (script.includes("GetInstances(0)")) {
        return JSON.stringify({
          InstanceGuid: BOUNDED_INSTANCE_GUID,
          EnginePID: 4100,
          State: 4,
        });
      }
      if (script.includes("ProcessId = 4100")) {
        return JSON.stringify({
          ProcessId: 4100,
          ParentProcessId: 900,
          CreationDate: "2026-08-02T10:00:00.000Z",
          ExecutablePath: nodePath,
          CommandParsed: true,
          CommandSha256: expectedSupervisorHash,
          _test_only_command_line: independentlyAuthoredSupervisorCommandLine,
        });
      }
      if (script.includes("ProcessId = 4200")) {
        return JSON.stringify({
          ProcessId: 4200,
          ParentProcessId: 4100,
          CreationDate: "2026-08-02T10:00:01.000Z",
          ExecutablePath: nodePath,
          CommandParsed: true,
          CommandSha256: expectedChildHash,
          _test_only_command_line: independentlyAuthoredChildCommandLine,
        });
      }
      return JSON.stringify({ ProcessIds: [4100, 4200] });
    },
  });
  assert.equal(handoff.ok, true);
  assert.equal(handoff.supervisor.command_sha256, expectedSupervisorHash);
  assert.equal(handoff.child.command_sha256, expectedChildHash);
  assert.equal(
    JSON.stringify(handoff).includes(
      independentlyAuthoredSupervisorCommandLine,
    ),
    false,
  );
  assert.equal(
    JSON.stringify(handoff).includes(independentlyAuthoredChildCommandLine),
    false,
  );
});

test("the real supervision-generation path borrows the exact parent transition lease through owner and lifecycle attestation", async (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-generation-transition-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const expectedCommit = "9".repeat(40);
  const activationReceiptSha256 = "8".repeat(64);
  const transitionEvents = [];
  const transition = inMemoryTransitionLease({
    preheldOwner: `live-start:${START_OPERATION_NONCE}`,
    events: transitionEvents,
  });
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: path.join(
      temp,
      "state",
      "activation-receipt.json",
    ),
  };
  fs.writeFileSync(profile.database_path, "bounded database identity\n");
  const child = new EventEmitter();
  child.pid = 7412;
  const kills = [];
  child.kill = (signal) => {
    kills.push(signal);
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  const liveHealth = {
    status: "ok",
    schedulerActive: true,
    build: { commit_sha: expectedCommit },
    deployment: { mode: "local", primary: true },
    runtime: {
      operating_mode: "LIVE_GUARDED",
      auto_publish: true,
      legacy_auto_publish_armed: true,
      use_sqlite: true,
      use_job_queue_explicit: "true",
    },
    multiLaneRuntime: boundedMultiLaneHealth(),
  };
  let lifecycleWrites = 0;
  const boundedActivation = taskBoundActivation({
    profile,
    repoRoot: ROOT,
    expectedCommit,
    receiptSha: activationReceiptSha256,
  });
  let boundedListenerReads = 0;
  const activationInspections = [];

  const generation = await startLiveSupervisionGeneration({
    repoRoot: ROOT,
    expectedCommit,
    workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
    profilePath: path.join(temp, "profile.json"),
    platform: "win32",
    runtimeTransitionLeaseFactory: transition.factory,
    transitionLeaseBorrower(options) {
      return borrowLiveRuntimeTransitionLease({
        ...options,
        participantIdentity: {
          participant_id: "33333333-3333-4333-8333-333333333333",
          process_id: process.pid,
          process_started_at: TEST_PROCESS_STARTED_AT,
          process_start_source: "injected",
        },
      });
    },
    profileLoader: () => profile,
    doctorBuilder: () => ({
      checks: {
        activation: {
          valid: true,
          receipt_sha256: activationReceiptSha256,
        },
      },
    }),
    supervisionPreparer: () => ({
      activation_receipt_sha256: activationReceiptSha256,
      runtime_environment: {},
    }),
    activationInspector: (options) => {
      activationInspections.push(options);
      return boundedActivation;
    },
    taskAuthorityObserver: async (options) => {
      assert.equal(
        options.expectedSupervisorExecutablePath,
        boundedActivation.authority_binding.node_path,
      );
      assert.equal(
        options.expectedSupervisorCommandSha256,
        boundedActivation.task_definition_sha256,
      );
      assert.equal(
        options.expectedChildExecutablePath,
        boundedActivation.authority_binding.node_path,
      );
      assert.match(options.expectedChildCommandSha256, /^[a-f0-9]{64}$/);
      return taskBoundHandoffObservation(child, options);
    },
    startOperationInspector: () => ({
      present: true,
      valid: true,
      operation_nonce: START_OPERATION_NONCE,
      blockers: [],
    }),
    listenerInspector: () => ({
      available: true,
      listeningPids: boundedListenerReads++ === 0 ? [] : [child.pid],
      blockers: [],
    }),
    processIdentityInspector: processIdentityInspector({
      [process.pid]: TEST_PROCESS_STARTED_AT,
      [child.pid]: TEST_REUSED_PROCESS_STARTED_AT,
    }),
    healthRequester: async () => liveHealth,
    spawnImpl: () => child,
    lifecycleReceiptWriter(options) {
      lifecycleWrites += 1;
      assert.equal(options.action, "supervise-start");
      assert.equal(
        transition.current()?.owner_id,
        `live-start:${START_OPERATION_NONCE}`,
      );
      return { receipt_path: path.join(temp, "start.json") };
    },
    ownerWriter(ownerPath, value) {
      assert.equal(
        lifecycleWrites,
        1,
        "the owner receipt must be the final handoff publication",
      );
      const transitionMetadata = JSON.parse(
        transition.current()?.metadata || "null",
      );
      assert.equal(
        transitionMetadata?.admission_state,
        "SEALED",
        "handoff must atomically close transition borrowing before publication",
      );
      assert.deepEqual(
        transitionMetadata?.participants?.map(
          (participant) => participant.role,
        ),
        ["owner", "handoff_supervisor", "handoff_child"],
        "the transition borrower must become an exact child-bound seal before owner publication",
      );
      const handoffSupervisor = transitionMetadata.participants[1];
      assert.equal(handoffSupervisor.process_id, process.pid);
      assert.equal(
        handoffSupervisor.process_started_at,
        TEST_PROCESS_STARTED_AT,
      );
      const handoffChild = transitionMetadata.participants[2];
      assert.equal(handoffChild.process_id, child.pid);
      assert.equal(
        handoffChild.process_started_at,
        TEST_REUSED_PROCESS_STARTED_AT,
      );
      assert.throws(
        () =>
          borrowLiveRuntimeTransitionLease({
            databasePath: profile.database_path,
            expectedOwnerId: `live-start:${START_OPERATION_NONCE}`,
            runtimeTransitionLeaseFactory: transition.factory,
          }),
        /live_runtime_transition_lease_unavailable/,
        "a replacement supervisor must not borrow during owner publication",
      );
      fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
      fs.writeFileSync(ownerPath, `${JSON.stringify(value, null, 2)}\n`);
    },
  });

  assert.equal(generation.child, child);
  assert.deepEqual(kills, []);
  assert.equal(lifecycleWrites, 1);
  assert.equal(
    transition.current()?.owner_id,
    `live-start:${START_OPERATION_NONCE}`,
  );
  assert.equal(
    transitionEvents.some(([name]) => name === "transition_release"),
    false,
  );
  assert.equal(
    transitionEvents.some(([name]) => name === "transition_close"),
    true,
  );
  const owner = JSON.parse(fs.readFileSync(generation.ownerPath, "utf8"));
  assert.equal(owner.child_pid, child.pid);
  assert.equal(owner.schema_version, "pulse-windows-live-guarded-owner-v2");
  assert.equal(owner.runtime_instance_id, BOUNDED_RUNTIME_ID);
  assert.equal(owner.task_instance_guid, BOUNDED_INSTANCE_GUID);
  assert.equal(owner.engine_pid, process.pid);
  assert.equal(owner.child_parent_pid, process.pid);
  assert.equal(owner.child_in_job, true);
  assert.equal(owner.listener_port, 3001);
  assert.equal(owner.listener_pid, child.pid);
  assert.equal(
    owner.authority_fingerprint,
    boundedActivation.authority_fingerprint,
  );
  assert.equal(owner.supervisor_process_started_at, TEST_PROCESS_STARTED_AT);
  assert.equal(owner.child_process_started_at, TEST_REUSED_PROCESS_STARTED_AT);
  assert.equal(owner.start_operation_nonce, START_OPERATION_NONCE);
  assert.ok(activationInspections.length >= 3);
  for (const options of activationInspections) {
    assert.equal(
      options.nodePath,
      fs.realpathSync.native(process.execPath).replace(/\\/g, "/"),
    );
    assert.equal(
      options.checkoutRealPath,
      fs.realpathSync.native(ROOT).replace(/\\/g, "/"),
    );
    assert.equal(
      options.databaseIdentitySha256,
      inspectLiveDatabaseIdentity({ databasePath: profile.database_path })
        .database_identity_sha256,
    );
  }
});

test("owner-v2 publication rejects incomplete or contradictory task, process, Job and listener evidence", async (t) => {
  let childPid = 7800;
  const run = async (
    mutateObservation,
    omitHandoffListenerBlockers = false,
  ) => {
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-live-handoff-authority-"),
    );
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const expectedCommit = "9".repeat(40);
    const receiptSha = "8".repeat(64);
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      database_path: path.join(temp, "pulse.db"),
      state_root: path.join(temp, "state"),
      activation_receipt_path: path.join(temp, "activation.json"),
    };
    const activation = taskBoundActivation({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      receiptSha,
    });
    const child = new EventEmitter();
    child.pid = ++childPid;
    child.kill = (signal) => {
      queueMicrotask(() => child.emit("exit", 0, signal));
      return true;
    };
    let listenerReads = 0;
    let ownerWrites = 0;
    await assert.rejects(
      startLiveSupervisionGeneration({
        repoRoot: ROOT,
        expectedCommit,
        workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
        platform: "win32",
        profileLoader: () => profile,
        doctorBuilder: () => ({
          checks: { activation: { valid: true, receipt_sha256: receiptSha } },
        }),
        supervisionPreparer: () => ({
          activation_receipt_sha256: receiptSha,
          runtime_environment: {},
        }),
        activationInspector: () => activation,
        startOperationInspector: () => ({
          present: false,
          valid: true,
          operation_nonce: null,
          blockers: [],
        }),
        transitionLeaseAcquirer: () => ({
          renew: () => true,
          sealForHandoff: () => true,
          release: () => true,
        }),
        listenerInspector: () => ({
          available: true,
          listeningPids: listenerReads++ === 0 ? [] : [child.pid],
          ...(listenerReads > 1 && omitHandoffListenerBlockers
            ? {}
            : { blockers: [] }),
        }),
        processIdentityInspector: processIdentityInspector({
          [process.pid]: TEST_PROCESS_STARTED_AT,
          [child.pid]: TEST_REUSED_PROCESS_STARTED_AT,
        }),
        healthRequester: async () => ({
          status: "ok",
          schedulerActive: true,
          build: { commit_sha: expectedCommit },
          deployment: { mode: "local", primary: true },
          runtime: {
            operating_mode: "LIVE_GUARDED",
            auto_publish: true,
            legacy_auto_publish_armed: true,
            use_sqlite: true,
            use_job_queue_explicit: "true",
          },
          multiLaneRuntime: boundedMultiLaneHealth(),
        }),
        spawnImpl: () => child,
        taskAuthorityObserver: async (options) =>
          mutateObservation(taskBoundHandoffObservation(child, options)),
        lifecycleReceiptWriter: () => ({ receipt_path: "unused" }),
        ownerWriter: () => {
          ownerWrites += 1;
        },
      }),
      /live_task_handoff_authority_mismatch/,
    );
    assert.equal(ownerWrites, 0);
  };

  for (const mutate of [
    (value) => {
      const result = { ...value };
      delete result.blockers;
      return result;
    },
    (value) => ({ ...value, task_name: "Different-Task" }),
    (value) => ({
      ...value,
      task_instance: { ...value.task_instance, instance_guid: "invalid" },
    }),
    (value) => ({
      ...value,
      task_instance: { ...value.task_instance, state: 3 },
    }),
    (value) => ({
      ...value,
      supervisor: { ...value.supervisor, executable_path: "D:/wrong/node.exe" },
    }),
    (value) => ({
      ...value,
      supervisor: { ...value.supervisor, command_sha256: "0".repeat(64) },
    }),
    (value) => ({
      ...value,
      child: { ...value.child, executable_path: "D:/wrong/node.exe" },
    }),
    (value) => ({
      ...value,
      child: { ...value.child, command_sha256: "0".repeat(64) },
    }),
    (value) => ({
      ...value,
      supervisor: {
        ...value.supervisor,
        blockers: ["windows_authority_process_probe_failed"],
      },
    }),
    (value) => ({
      ...value,
      job_membership: {
        process_ids: [value.child.pid],
        supervisor_present: false,
        child_present: true,
        blockers: [],
      },
    }),
    (value) => ({
      ...value,
      job_membership: {
        ...value.job_membership,
        blockers: ["windows_job_membership_probe_failed"],
      },
    }),
  ]) {
    await run(mutate);
  }
  await run((value) => value, true);
});

test("supervisor boot cleanup refuses every malformed dead owner-v2 before archival", async (t) => {
  let ownerPid = 994000;
  const run = async (mutateOwner = (owner) => owner) => {
    const temp = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-live-boot-stale-owner-v2-"),
    );
    t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
    const expectedCommit = "9".repeat(40);
    const profile = {
      ...loadLiveGuardedRuntimeProfile(),
      database_path: path.join(temp, "pulse.db"),
      state_root: path.join(temp, "state"),
      activation_receipt_path: path.join(temp, "activation.json"),
    };
    fs.writeFileSync(profile.database_path, "identity\n");
    const activation = taskBoundActivation({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      receiptSha: "8".repeat(64),
    });
    const commands = buildLiveProcessCommandAuthority({
      profile,
      repoRoot: ROOT,
      expectedCommit,
      nodeExecutable: activation.authority_binding.node_path,
    });
    const supervisorPid = ++ownerPid;
    const childPid = ++ownerPid;
    const owner = mutateOwner({
      schema_version: "pulse-windows-live-guarded-owner-v2",
      runtime_instance_id: activation.runtime_instance_id,
      task_name: profile.task_name,
      task_instance_guid: BOUNDED_INSTANCE_GUID,
      engine_pid: supervisorPid,
      supervisor_pid: supervisorPid,
      supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
      supervisor_creation_time_utc: TEST_PROCESS_STARTED_AT,
      supervisor_executable_path: activation.authority_binding.node_path,
      supervisor_command_sha256: commands.supervisor_command_sha256,
      child_pid: childPid,
      child_process_started_at: TEST_REUSED_PROCESS_STARTED_AT,
      child_creation_time_utc: TEST_REUSED_PROCESS_STARTED_AT,
      child_parent_pid: supervisorPid,
      child_executable_path: activation.authority_binding.node_path,
      child_command_sha256: commands.child_command_sha256,
      child_in_job: true,
      listener_port: profile.port,
      listener_pid: childPid,
      port: profile.port,
      repo_root: ROOT.replace(/\\/g, "/"),
      commit_sha: expectedCommit,
      release_sha: expectedCommit,
      profile_sha256: activation.authority_binding.profile_sha256,
      database_identity_sha256:
        activation.authority_binding.database_identity_sha256,
      authority_binding: activation.authority_binding,
      authority_fingerprint: activation.authority_fingerprint,
      activation_receipt_sha256: activation.receipt_sha256,
      platform: "youtube",
      blockers: [],
    });
    const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
    fs.mkdirSync(profile.state_root, { recursive: true });
    fs.writeFileSync(ownerPath, `${JSON.stringify(owner, null, 2)}\n`);
    let spawnCalls = 0;
    const promise = startLiveSupervisionGeneration({
      repoRoot: ROOT,
      expectedCommit,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      profileLoader: () => profile,
      doctorBuilder: () => ({
        checks: {
          activation: {
            valid: true,
            receipt_sha256: activation.receipt_sha256,
          },
        },
      }),
      supervisionPreparer: () => ({
        activation_receipt_sha256: activation.receipt_sha256,
        runtime_environment: {},
      }),
      activationInspector: () => activation,
      startOperationInspector: () => ({
        present: false,
        valid: true,
        operation_nonce: null,
        blockers: [],
      }),
      transitionLeaseAcquirer: () => ({
        renew: () => true,
        release: () => true,
      }),
      listenerInspector: () => ({
        available: true,
        listeningPids: [],
        blockers: [],
      }),
      processIdentityInspector: processIdentityInspector({
        [process.pid]: TEST_PROCESS_STARTED_AT,
      }),
      spawnImpl: () => {
        spawnCalls += 1;
        throw new Error("test_spawn_reached_after_exact_stale_archive");
      },
    });
    return { promise, ownerPath, spawnCalls: () => spawnCalls };
  };

  const exact = await run();
  await assert.rejects(
    exact.promise,
    /test_spawn_reached_after_exact_stale_archive/,
  );
  assert.equal(exact.spawnCalls(), 1);
  assert.equal(fs.existsSync(exact.ownerPath), false);

  const malformedCases = [
    ["runtime ID", (owner) => ({ ...owner, runtime_instance_id: "invalid" })],
    ["task name", (owner) => ({ ...owner, task_name: "Different-Task" })],
    ["task GUID", (owner) => ({ ...owner, task_instance_guid: "invalid" })],
    ["EnginePID", (owner) => ({ ...owner, engine_pid: owner.engine_pid + 1 })],
    [
      "parentage",
      (owner) => ({ ...owner, child_parent_pid: owner.supervisor_pid + 1 }),
    ],
    ["listener", (owner) => ({ ...owner, listener_pid: owner.child_pid + 1 })],
    ["owner blockers", (owner) => ({ ...owner, blockers: ["stale"] })],
    ["release", (owner) => ({ ...owner, release_sha: "7".repeat(40) })],
    [
      "database identity",
      (owner) => ({ ...owner, database_identity_sha256: "7".repeat(64) }),
    ],
    [
      "authority binding",
      (owner) => ({
        ...owner,
        authority_binding: {
          ...owner.authority_binding,
          database_identity_sha256: "7".repeat(64),
        },
      }),
    ],
    [
      "authority fingerprint",
      (owner) => ({ ...owner, authority_fingerprint: "7".repeat(64) }),
    ],
  ];
  for (const [label, mutateOwner] of malformedCases) {
    const malformed = await run(mutateOwner);
    await assert.rejects(
      malformed.promise,
      /live_supervisor_owner_receipt_mismatch/,
      label,
    );
    assert.equal(malformed.spawnCalls(), 0, label);
    assert.equal(fs.existsSync(malformed.ownerPath), true, label);
  }
});

test("an owned generation keeps a sealed transition durable until the owner receipt is published", async (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-owned-handoff-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const expectedCommit = "a".repeat(40);
  const activationReceiptSha256 = "b".repeat(64);
  const transition = inMemoryTransitionLease();
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: path.join(
      temp,
      "state",
      "activation-receipt.json",
    ),
  };
  const child = new EventEmitter();
  child.pid = 7462;
  child.kill = (signal) => {
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  let observedOwnerId = null;
  const boundedActivation = taskBoundActivation({
    profile,
    repoRoot: ROOT,
    expectedCommit,
    receiptSha: activationReceiptSha256,
  });
  let boundedListenerReads = 0;

  const generation = await startLiveSupervisionGeneration({
    repoRoot: ROOT,
    expectedCommit,
    workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
    profilePath: path.join(temp, "profile.json"),
    platform: "win32",
    runtimeTransitionLeaseFactory: transition.factory,
    profileLoader: () => profile,
    doctorBuilder: () => ({
      checks: {
        activation: {
          valid: true,
          receipt_sha256: activationReceiptSha256,
        },
      },
    }),
    supervisionPreparer: () => ({
      activation_receipt_sha256: activationReceiptSha256,
      runtime_environment: {},
    }),
    activationInspector: () => boundedActivation,
    taskAuthorityObserver: async (options) =>
      taskBoundHandoffObservation(child, options),
    startOperationInspector: () => ({
      present: false,
      valid: true,
      operation_nonce: null,
      blockers: [],
    }),
    listenerInspector: () => ({
      available: true,
      listeningPids: boundedListenerReads++ === 0 ? [] : [child.pid],
      blockers: [],
    }),
    processIdentityInspector: processIdentityInspector({
      [process.pid]: TEST_PROCESS_STARTED_AT,
      [child.pid]: TEST_REUSED_PROCESS_STARTED_AT,
    }),
    healthRequester: async () => ({
      status: "ok",
      schedulerActive: true,
      build: { commit_sha: expectedCommit },
      deployment: { mode: "local", primary: true },
      runtime: {
        operating_mode: "LIVE_GUARDED",
        auto_publish: true,
        legacy_auto_publish_armed: true,
        use_sqlite: true,
        use_job_queue_explicit: "true",
      },
      multiLaneRuntime: boundedMultiLaneHealth(),
    }),
    spawnImpl: () => child,
    lifecycleReceiptWriter: () => ({
      receipt_path: path.join(temp, "start.json"),
    }),
    ownerWriter(ownerPath, value) {
      const held = transition.current();
      assert.ok(
        held,
        "the durable transition must still exist at owner publication",
      );
      observedOwnerId = held.owner_id;
      const metadata = JSON.parse(held.metadata);
      assert.equal(metadata.admission_state, "SEALED");
      assert.deepEqual(
        metadata.participants.map((participant) => participant.role),
        ["owner", "handoff_child"],
      );
      assert.equal(metadata.participants[1].process_id, child.pid);
      assert.equal(
        metadata.participants[1].process_started_at,
        TEST_REUSED_PROCESS_STARTED_AT,
      );
      assert.throws(
        () =>
          borrowLiveRuntimeTransitionLease({
            databasePath: profile.database_path,
            expectedOwnerId: held.owner_id,
            runtimeTransitionLeaseFactory: transition.factory,
          }),
        /live_runtime_transition_lease_unavailable/,
      );
      fs.mkdirSync(path.dirname(ownerPath), { recursive: true });
      fs.writeFileSync(ownerPath, `${JSON.stringify(value, null, 2)}\n`);
    },
  });

  assert.ok(observedOwnerId?.startsWith("live-supervise:"));
  assert.equal(transition.current(), null);
  assert.equal(fs.existsSync(generation.ownerPath), true);
});

test("an owned transition release failure terminates the child and removes its owner receipt before rejecting", async (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-generation-release-failure-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const expectedCommit = "7".repeat(40);
  const activationReceiptSha256 = "6".repeat(64);
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: path.join(
      temp,
      "state",
      "activation-receipt.json",
    ),
  };
  const child = new EventEmitter();
  child.pid = 7512;
  const kills = [];
  child.kill = (signal) => {
    kills.push(signal);
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");
  const boundedActivation = taskBoundActivation({
    profile,
    repoRoot: ROOT,
    expectedCommit,
    receiptSha: activationReceiptSha256,
  });
  let boundedListenerReads = 0;

  await assert.rejects(
    startLiveSupervisionGeneration({
      repoRoot: ROOT,
      expectedCommit,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      profilePath: path.join(temp, "profile.json"),
      platform: "win32",
      profileLoader: () => profile,
      doctorBuilder: () => ({
        checks: {
          activation: {
            valid: true,
            receipt_sha256: activationReceiptSha256,
          },
        },
      }),
      supervisionPreparer: () => ({
        activation_receipt_sha256: activationReceiptSha256,
        runtime_environment: {},
      }),
      activationInspector: () => boundedActivation,
      taskAuthorityObserver: async (options) =>
        taskBoundHandoffObservation(child, options),
      startOperationInspector: () => ({
        present: false,
        valid: true,
        operation_nonce: null,
        blockers: [],
      }),
      transitionLeaseAcquirer: () => ({
        renew() {
          return true;
        },
        sealForHandoff() {
          return true;
        },
        release() {
          throw new Error("fixture_release_failed");
        },
      }),
      listenerInspector: () => ({
        available: true,
        listeningPids: boundedListenerReads++ === 0 ? [] : [child.pid],
        blockers: [],
      }),
      processIdentityInspector: processIdentityInspector({
        [process.pid]: TEST_PROCESS_STARTED_AT,
        [child.pid]: TEST_REUSED_PROCESS_STARTED_AT,
      }),
      healthRequester: async () => ({
        status: "ok",
        schedulerActive: true,
        build: { commit_sha: expectedCommit },
        deployment: { mode: "local", primary: true },
        runtime: {
          operating_mode: "LIVE_GUARDED",
          auto_publish: true,
          legacy_auto_publish_armed: true,
          use_sqlite: true,
          use_job_queue_explicit: "true",
        },
        multiLaneRuntime: boundedMultiLaneHealth(),
      }),
      spawnImpl: () => child,
      lifecycleReceiptWriter: () => ({
        receipt_path: path.join(temp, "start.json"),
      }),
    }),
    /live_runtime_transition_lease_release_failed/,
  );

  assert.deepEqual(kills, ["SIGTERM"]);
  assert.equal(fs.existsSync(ownerPath), false);
});

test("a generation revalidates activation under the transition lease before spawning", async (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-generation-leased-authority-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const expectedCommit = "5".repeat(40);
  const receiptSha = "4".repeat(64);
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: path.join(temp, "activation.json"),
  };
  let activationCalls = 0;
  let spawnCalls = 0;

  await assert.rejects(
    startLiveSupervisionGeneration({
      repoRoot: ROOT,
      expectedCommit,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      profileLoader: () => profile,
      doctorBuilder: () => ({
        checks: {
          activation: { valid: true, receipt_sha256: receiptSha },
        },
      }),
      supervisionPreparer: () => ({
        activation_receipt_sha256: receiptSha,
        runtime_environment: {},
      }),
      activationInspector: () => {
        activationCalls += 1;
        return activationCalls === 1
          ? {
              valid: true,
              receipt_sha256: receiptSha,
              runtime_instance_id: BOUNDED_RUNTIME_ID,
            }
          : {
              valid: false,
              receipt_sha256: null,
              blockers: ["activation_receipt_missing"],
            };
      },
      startOperationInspector: () => ({
        present: false,
        valid: true,
        operation_nonce: null,
        blockers: [],
      }),
      transitionLeaseAcquirer: () => ({
        renew: () => true,
        release: () => true,
      }),
      spawnImpl() {
        spawnCalls += 1;
        throw new Error("must_not_spawn");
      },
    }),
    /exact_live_activation_receipt_required/,
  );

  assert.equal(activationCalls, 2);
  assert.equal(spawnCalls, 0);
});

test("activation revoked during health verification terminates the child before handoff", async (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-generation-post-health-authority-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const expectedCommit = "3".repeat(40);
  const receiptSha = "2".repeat(64);
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: path.join(temp, "activation.json"),
  };
  const child = new EventEmitter();
  child.pid = 7612;
  const kills = [];
  child.kill = (signal) => {
    kills.push(signal);
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  let activationCalls = 0;
  let lifecycleWrites = 0;
  const ownerPath = path.join(profile.state_root, "supervisor-owner.json");

  await assert.rejects(
    startLiveSupervisionGeneration({
      repoRoot: ROOT,
      expectedCommit,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      profileLoader: () => profile,
      doctorBuilder: () => ({
        checks: {
          activation: { valid: true, receipt_sha256: receiptSha },
        },
      }),
      supervisionPreparer: () => ({
        activation_receipt_sha256: receiptSha,
        runtime_environment: {},
      }),
      activationInspector: () => {
        activationCalls += 1;
        return activationCalls < 3
          ? {
              valid: true,
              receipt_sha256: receiptSha,
              runtime_instance_id: BOUNDED_RUNTIME_ID,
            }
          : {
              valid: false,
              receipt_sha256: null,
              blockers: ["activation_receipt_missing"],
            };
      },
      startOperationInspector: () => ({
        present: false,
        valid: true,
        operation_nonce: null,
        blockers: [],
      }),
      transitionLeaseAcquirer: () => ({
        renew: () => true,
        release: () => true,
      }),
      listenerInspector: () => ({
        available: true,
        listeningPids: [],
      }),
      processIdentityInspector: processIdentityInspector({
        [process.pid]: TEST_PROCESS_STARTED_AT,
        [child.pid]: TEST_REUSED_PROCESS_STARTED_AT,
      }),
      spawnImpl: () => child,
      healthRequester: async () => ({
        status: "ok",
        schedulerActive: true,
        build: { commit_sha: expectedCommit },
        deployment: { mode: "local", primary: true },
        runtime: {
          operating_mode: "LIVE_GUARDED",
          auto_publish: true,
          legacy_auto_publish_armed: true,
          use_sqlite: true,
          use_job_queue_explicit: "true",
        },
        multiLaneRuntime: boundedMultiLaneHealth(),
      }),
      lifecycleReceiptWriter() {
        lifecycleWrites += 1;
      },
    }),
    /exact_live_activation_receipt_required/,
  );

  assert.equal(activationCalls, 3);
  assert.deepEqual(kills, ["SIGTERM"]);
  assert.equal(lifecycleWrites, 0);
  assert.equal(fs.existsSync(ownerPath), false);
});

test("the live child monitor rejects an attacker pool and confirms exit before restart", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-child-monitor-"),
  );
  let keepAlive;
  try {
    keepAlive = setInterval(() => {}, 1000);
    const ownerPath = path.join(temp, "supervisor-owner.json");
    fs.writeFileSync(ownerPath, '{"child_pid":7084}\n');
    const child = new EventEmitter();
    child.pid = 7084;
    const events = [];
    let activeChildren = 1;
    let healthChecks = 0;
    child.kill = (signal) => {
      events.push(["kill", signal]);
      setImmediate(() => {
        activeChildren = 0;
        child.emit("exit", null, signal);
      });
      return true;
    };
    const supervise =
      typeof superviseLiveChildSession === "function"
        ? superviseLiveChildSession
        : async () => ({ outcome: "monitor_restart_not_implemented" });

    const result = await supervise({
      child,
      ownerPath,
      profile: {
        port: 3001,
        state_root: temp,
      },
      repoRoot: temp,
      expectedCommit: "c".repeat(40),
      expectedRuntime: boundedExpectedRuntime(),
      activationReceiptPath: path.join(temp, "activation-receipt.json"),
      activationInspector: () => ({
        valid: true,
        blockers: [],
      }),
      healthRequester: async () => {
        healthChecks += 1;
        return {
          status: "ok",
          schedulerActive: true,
          build: { commit_sha: "c".repeat(40) },
          deployment: { mode: "local", primary: true },
          runtime: {
            operating_mode: "LIVE_GUARDED",
            auto_publish: true,
            legacy_auto_publish_armed: true,
            use_sqlite: true,
            use_job_queue_explicit: "true",
          },
          multiLaneRuntime: {
            isolated_worker_pools: {
              ...boundedMultiLaneHealth().isolated_worker_pools,
              pools: [
                {
                  pool_id: "attacker_pool",
                  active_instances: 1,
                  heartbeat_ms: 5_000,
                  kinds: ["publish"],
                },
              ],
            },
          },
        };
      },
      monitorIntervalMs: 2,
      signalEmitter: new EventEmitter(),
      writeExitReceiptImpl(details) {
        events.push(["exit_receipt", details]);
      },
    });

    assert.ok(healthChecks >= 3);
    assert.deepEqual(events, [
      ["kill", "SIGTERM"],
      [
        "exit_receipt",
        {
          child_pid: 7084,
          exit_code: null,
          signal: "SIGTERM",
          reason: "live_runtime_health_lost",
        },
      ],
    ]);
    assert.deepEqual(result, {
      outcome: "restart_required",
      reason: "live_runtime_health_lost",
      child_pid: 7084,
      exit_code: null,
      signal: "SIGTERM",
    });
    assert.equal(activeChildren, 0);
    assert.equal(fs.existsSync(ownerPath), false);
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("the live child monitor never restarts after activation is revoked", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-child-revoked-"),
  );
  const secretSentinel = "SENTINEL_REVOCATION_BLOCKER_MUST_NOT_PERSIST_3b5c";
  let keepAlive;
  try {
    keepAlive = setInterval(() => {}, 1000);
    const ownerPath = path.join(temp, "supervisor-owner.json");
    fs.writeFileSync(ownerPath, '{"child_pid":7084}\n');
    const child = new EventEmitter();
    child.pid = 7084;
    let exitDetails = null;
    child.kill = (signal) => {
      setImmediate(() => child.emit("exit", null, signal));
      return true;
    };

    await assert.rejects(
      superviseLiveChildSession({
        child,
        ownerPath,
        profile: {
          port: 3001,
          state_root: temp,
        },
        repoRoot: temp,
        expectedCommit: "c".repeat(40),
        expectedRuntime: boundedExpectedRuntime(),
        activationReceiptPath: path.join(temp, "activation-receipt.json"),
        activationInspector: () => ({
          valid: false,
          blockers: [secretSentinel],
        }),
        healthRequester: async () => {
          throw new Error("health_must_not_run_after_revocation");
        },
        monitorIntervalMs: 2,
        signalEmitter: new EventEmitter(),
        writeExitReceiptImpl(details) {
          exitDetails = details;
        },
      }),
      (error) => {
        const message = String(error?.message || error);
        assert.match(message, /^activation_revoked:[a-f0-9]{64}$/);
        assert.equal(message.includes(secretSentinel), false);
        return true;
      },
    );

    assert.equal(fs.existsSync(ownerPath), false);
    assert.equal(exitDetails.child_pid, 7084);
    assert.equal(exitDetails.exit_code, null);
    assert.equal(exitDetails.signal, "SIGTERM");
    assert.match(exitDetails.reason, /^activation_revoked:[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(exitDetails).includes(secretSentinel), false);
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("activation monitor exceptions are redacted from supervise-exit evidence and the final error", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-child-monitor-error-"),
  );
  const secretSentinel = "SENTINEL_MONITOR_ERROR_MUST_NOT_PERSIST_2a4b";
  let keepAlive;
  try {
    keepAlive = setInterval(() => {}, 1000);
    const ownerPath = path.join(temp, "supervisor-owner.json");
    fs.writeFileSync(ownerPath, '{"child_pid":7084}\n');
    const child = new EventEmitter();
    child.pid = 7084;
    let exitDetails = null;
    child.kill = (signal) => {
      setImmediate(() => child.emit("exit", null, signal));
      return true;
    };

    await assert.rejects(
      superviseLiveChildSession({
        child,
        ownerPath,
        profile: {
          port: 3001,
          state_root: temp,
        },
        repoRoot: temp,
        expectedCommit: "c".repeat(40),
        expectedRuntime: boundedExpectedRuntime(),
        activationReceiptPath: path.join(temp, "activation-receipt.json"),
        activationInspector() {
          throw new Error(`activation inspection failed ${secretSentinel}`);
        },
        healthRequester: async () => {
          throw new Error("health_must_not_run_after_monitor_error");
        },
        monitorIntervalMs: 2,
        signalEmitter: new EventEmitter(),
        writeExitReceiptImpl(details) {
          exitDetails = details;
        },
      }),
      (error) => {
        const message = String(error?.message || error);
        assert.match(message, /^live_runtime_monitor_error:[a-f0-9]{64}$/);
        assert.equal(message.includes(secretSentinel), false);
        return true;
      },
    );

    assert.equal(fs.existsSync(ownerPath), false);
    assert.match(
      exitDetails.reason,
      /^live_runtime_monitor_error:[a-f0-9]{64}$/,
    );
    assert.equal(JSON.stringify(exitDetails).includes(secretSentinel), false);
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a finishing child cannot delete a replacement supervisor-owner receipt", async (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-child-owner-replaced-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const ownerPath = path.join(temp, "supervisor-owner.json");
  fs.writeFileSync(
    ownerPath,
    `${JSON.stringify({
      child_pid: 7084,
      child_process_started_at: TEST_PROCESS_STARTED_AT,
    })}\n`,
  );
  const replacement = {
    child_pid: 8084,
    child_process_started_at: TEST_REUSED_PROCESS_STARTED_AT,
  };
  const child = new EventEmitter();
  child.pid = 7084;
  child.kill = (signal) => {
    fs.writeFileSync(ownerPath, `${JSON.stringify(replacement)}\n`);
    queueMicrotask(() => child.emit("exit", 0, signal));
    return true;
  };
  const signalEmitter = new EventEmitter();
  const supervision = superviseLiveChildSession({
    child,
    ownerPath,
    profile: {
      port: 3001,
      state_root: temp,
    },
    repoRoot: temp,
    expectedCommit: "c".repeat(40),
    expectedRuntime: boundedExpectedRuntime(),
    signalEmitter,
    monitorIntervalMs: 60_000,
    writeExitReceiptImpl() {
      throw new Error("exit receipt must follow exact owner cleanup");
    },
  });

  signalEmitter.emit("SIGTERM");
  await assert.rejects(supervision, /live_supervisor_owner_cleanup_mismatch/);
  assert.deepEqual(JSON.parse(fs.readFileSync(ownerPath, "utf8")), replacement);
});

test("activation revocation terminates the iterative lifecycle without admitting another generation", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-revoked-lifecycle-"),
  );
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const ownerPath = path.join(temp, "supervisor-owner.json");
    let startCalls = 0;
    await assert.rejects(
      runLiveSupervisionLifecycle({
        signalEmitter: new EventEmitter(),
        restartDelayMs: 0,
        delayImpl: () => Promise.resolve(),
        maxRestartGenerations: 3,
        async startGenerationImpl() {
          startCalls += 1;
          fs.writeFileSync(ownerPath, '{"child_pid":7084}\n');
          const child = new EventEmitter();
          child.pid = 7084;
          child.kill = (signal) => {
            setImmediate(() => child.emit("exit", null, signal));
            return true;
          };
          return {
            child,
            ownerPath,
            profile: { port: 3001, state_root: temp },
            repoRoot: temp,
            expectedCommit: "c".repeat(40),
            expectedRuntime: boundedExpectedRuntime(),
            activationInspector: () => ({
              valid: false,
              blockers: ["activation_receipt_commit_mismatch"],
            }),
            healthRequester: async () => {
              throw new Error("health_must_not_run_after_revocation");
            },
            monitorIntervalMs: 2,
            writeExitReceiptImpl() {},
          };
        },
      }),
      /activation_revoked:activation_receipt_commit_mismatch/,
    );

    assert.equal(startCalls, 1);
    assert.equal(fs.existsSync(ownerPath), false);
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("explicit supervisor shutdown treats signal and nonzero child exits as terminal success", async (t) => {
  for (const scenario of [
    { name: "signal exit", code: null, signal: "SIGTERM" },
    { name: "forced nonzero exit", code: 9, signal: null },
    {
      name: "forced signal exit",
      code: null,
      signal: "SIGKILL",
      forceRequired: true,
    },
  ]) {
    await t.test(scenario.name, async () => {
      const temp = fs.mkdtempSync(
        path.join(os.tmpdir(), "pulse-live-child-shutdown-"),
      );
      const keepAlive = setInterval(() => {}, 1000);
      try {
        const ownerPath = path.join(temp, "supervisor-owner.json");
        fs.writeFileSync(ownerPath, '{"child_pid":7084}\n');
        const child = new EventEmitter();
        child.pid = 7084;
        child.kill = (requestedSignal) => {
          if (scenario.forceRequired && requestedSignal === "SIGTERM") {
            return true;
          }
          setImmediate(() =>
            child.emit("exit", scenario.code, scenario.signal),
          );
          return true;
        };
        const signalEmitter = new EventEmitter();
        let exitDetails = null;
        const supervision = superviseLiveChildSession({
          child,
          ownerPath,
          profile: {
            port: 3001,
            state_root: temp,
          },
          repoRoot: temp,
          expectedCommit: "c".repeat(40),
          expectedRuntime: boundedExpectedRuntime(),
          activationInspector: () => ({
            valid: true,
            blockers: [],
          }),
          healthRequester: async () => {
            throw new Error("health_must_not_run_during_shutdown");
          },
          monitorIntervalMs: 1000,
          signalEmitter,
          terminationGraceMs: 2,
          writeExitReceiptImpl(details) {
            exitDetails = details;
          },
        });

        signalEmitter.emit("SIGTERM");
        const result = await supervision;

        assert.deepEqual(result, {
          outcome: "stopped",
          reason: "supervisor_shutdown",
          child_pid: 7084,
          exit_code: scenario.code,
          signal: scenario.signal,
        });
        assert.equal(fs.existsSync(ownerPath), false);
        assert.deepEqual(exitDetails, {
          child_pid: 7084,
          exit_code: scenario.code,
          signal: scenario.signal,
          reason: "supervisor_shutdown",
        });
      } finally {
        clearInterval(keepAlive);
        fs.rmSync(temp, { recursive: true, force: true });
      }
    });
  }
});

test("child errors and failed kills retain ownership until an exit is confirmed", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-child-kill-error-"),
  );
  try {
    const ownerPath = path.join(temp, "supervisor-owner.json");
    fs.writeFileSync(ownerPath, '{"child_pid":7084}\n');
    const child = new EventEmitter();
    child.pid = 7084;
    let killCalls = 0;
    child.kill = () => {
      killCalls += 1;
      throw new Error("kill_access_denied");
    };
    const supervision = superviseLiveChildSession({
      child,
      ownerPath,
      profile: {
        port: 3001,
        state_root: temp,
      },
      repoRoot: temp,
      expectedCommit: "c".repeat(40),
      expectedRuntime: boundedExpectedRuntime(),
      activationInspector: () => ({
        valid: true,
        blockers: [],
      }),
      healthRequester: async () => {
        throw new Error("health_must_not_run_after_child_error");
      },
      monitorIntervalMs: 1000,
      signalEmitter: new EventEmitter(),
      writeExitReceiptImpl() {},
      terminationGraceMs: 2,
    });
    const observed = supervision.then(
      (value) => ({ status: "resolved", value }),
      (error) => ({ status: "rejected", error }),
    );

    const secretSentinel = "SENTINEL_CHILD_CAUSE_MUST_NOT_ESCAPE";
    child.emit("error", new Error(secretSentinel));
    const premature = await Promise.race([
      observed,
      new Promise((resolve) =>
        setTimeout(() => resolve({ status: "pending" }), 20),
      ),
    ]);

    assert.deepEqual(premature, { status: "pending" });
    assert.equal(fs.existsSync(ownerPath), true);
    assert.ok(killCalls >= 2);

    child.emit("exit", 1, null);
    const final = await observed;
    assert.equal(final.status, "rejected");
    assert.match(
      final.error.message,
      /^live_runtime_child_error:[a-f0-9]{64}$/,
    );
    assert.equal(final.error.message.includes(secretSentinel), false);
    assert.equal(
      inspect(final.error, { depth: 5 }).includes(secretSentinel),
      false,
    );
    assert.equal(fs.existsSync(ownerPath), false);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("shutdown during health-loss recovery cancels the restart generation", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-recovery-shutdown-"),
  );
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const signalEmitter = new EventEmitter();
    let startCalls = 0;
    let releaseDelayStarted;
    const delayStarted = new Promise((resolve) => {
      releaseDelayStarted = resolve;
    });
    const lifecycle = runLiveSupervisionLifecycle({
      signalEmitter,
      restartDelayMs: 60_000,
      maxRestartGenerations: 3,
      delayImpl() {
        releaseDelayStarted();
        return new Promise(() => {});
      },
      async startGenerationImpl() {
        startCalls += 1;
        const ownerPath = path.join(temp, "supervisor-owner.json");
        fs.writeFileSync(
          ownerPath,
          JSON.stringify({ child_pid: 7000 + startCalls }),
        );
        const child = new EventEmitter();
        child.pid = 7000 + startCalls;
        child.kill = (signal) => {
          setImmediate(() => child.emit("exit", null, signal));
          return true;
        };
        return {
          child,
          ownerPath,
          profile: { port: 3001, state_root: temp },
          repoRoot: temp,
          expectedCommit: "c".repeat(40),
          activationInspector: () => ({
            valid: true,
            blockers: [],
          }),
          healthRequester: async () => null,
          monitorIntervalMs: 2,
          writeExitReceiptImpl() {},
        };
      },
    });

    await delayStarted;
    signalEmitter.emit("SIGTERM");
    const result = await lifecycle;

    assert.equal(startCalls, 1);
    assert.deepEqual(result, {
      outcome: "stopped",
      reason: "supervisor_shutdown_during_recovery",
      generation: 1,
    });
    assert.equal(
      fs.existsSync(path.join(temp, "supervisor-owner.json")),
      false,
    );
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("shutdown while a replacement generation is starting overrides its later start failure", async () => {
  const signalEmitter = new EventEmitter();
  let startCalls = 0;
  let rejectReplacementStart = null;
  let replacementShutdownSignal = null;
  let markReplacementStartReached;
  const replacementStartReached = new Promise((resolve) => {
    markReplacementStartReached = resolve;
  });
  const replacementPending = new Promise((resolve, reject) => {
    rejectReplacementStart = reject;
  });

  const lifecycle = runLiveSupervisionLifecycle({
    signalEmitter,
    restartDelayMs: 0,
    delayImpl: () => Promise.resolve(),
    maxRestartGenerations: 3,
    async startGenerationImpl({ generation, shutdownSignal }) {
      startCalls += 1;
      if (generation === 1) return { generation };
      replacementShutdownSignal = shutdownSignal;
      markReplacementStartReached();
      return replacementPending;
    },
    async superviseGenerationImpl() {
      return {
        outcome: "restart_required",
        reason: "live_runtime_health_lost",
      };
    },
  });

  await replacementStartReached;
  signalEmitter.emit("SIGTERM");
  rejectReplacementStart(new Error("replacement_start_failed"));
  const result = await lifecycle;

  assert.equal(startCalls, 2);
  assert.equal(replacementShutdownSignal.aborted, true);
  assert.deepEqual(result, {
    outcome: "stopped",
    reason: "supervisor_shutdown_during_start",
    generation: 2,
  });
  assert.equal(signalEmitter.listenerCount("SIGTERM"), 0);
  assert.equal(signalEmitter.listenerCount("SIGINT"), 0);
});

test("recovery backoff remains referenced while pending and clears promptly on shutdown", async () => {
  const signalEmitter = new EventEmitter();
  const timerHandle = {
    unref_calls: 0,
    unref() {
      this.unref_calls += 1;
    },
  };
  let timerCallback = null;
  let timerDelay = null;
  let clearCalls = 0;
  let startCalls = 0;

  const lifecycle = runLiveSupervisionLifecycle({
    signalEmitter,
    restartDelayMs: 50,
    maxRestartGenerations: 3,
    setTimeoutImpl(callback, milliseconds) {
      timerCallback = callback;
      timerDelay = milliseconds;
      return timerHandle;
    },
    clearTimeoutImpl(handle) {
      assert.equal(handle, timerHandle);
      clearCalls += 1;
    },
    async startGenerationImpl() {
      startCalls += 1;
      return {};
    },
    async superviseGenerationImpl() {
      return {
        outcome: "restart_required",
        reason: "live_runtime_health_lost",
      };
    },
  });

  for (let attempt = 0; attempt < 20 && !timerCallback; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  signalEmitter.emit("SIGTERM");
  const result = await lifecycle;

  assert.equal(timerDelay, 50);
  assert.equal(timerHandle.unref_calls, 0);
  assert.equal(clearCalls, 1);
  assert.equal(startCalls, 1);
  assert.deepEqual(result, {
    outcome: "stopped",
    reason: "supervisor_shutdown_during_recovery",
    generation: 1,
  });
});

test("live health polling remains referenced and cancels its pending poll timer", async () => {
  const shutdownController = new AbortController();
  const timerHandle = {
    unref_calls: 0,
    unref() {
      this.unref_calls += 1;
    },
  };
  let timerStarted;
  const started = new Promise((resolve) => {
    timerStarted = resolve;
  });
  let clearCalls = 0;
  let healthCalls = 0;
  const health = waitForLiveHealth({
    port: 3001,
    expectedCommit: "c".repeat(40),
    healthRequester: async () => {
      healthCalls += 1;
      return null;
    },
    timeoutMs: 60_000,
    intervalMs: 60_000,
    shutdownSignal: shutdownController.signal,
    setTimeoutImpl(callback, milliseconds) {
      assert.equal(milliseconds, 60_000);
      timerStarted();
      return timerHandle;
    },
    clearTimeoutImpl(handle) {
      assert.equal(handle, timerHandle);
      clearCalls += 1;
    },
  });

  await started;
  shutdownController.abort("supervisor_shutdown");
  assert.equal(await health, null);
  assert.equal(healthCalls, 1);
  assert.equal(timerHandle.unref_calls, 0);
  assert.equal(clearCalls, 1);
});

test("live health polling rejects attacker pools before accepting the exact topology", async () => {
  const expectedCommit = "c".repeat(40);
  const exactHealth = {
    status: "ok",
    schedulerActive: true,
    build: { commit_sha: expectedCommit },
    deployment: { mode: "local", primary: true },
    runtime: {
      operating_mode: "LIVE_GUARDED",
      auto_publish: true,
      legacy_auto_publish_armed: true,
      use_sqlite: true,
      use_job_queue_explicit: "true",
    },
    multiLaneRuntime: boundedMultiLaneHealth(),
  };
  let calls = 0;
  const result = await waitForLiveHealth({
    port: 3001,
    expectedCommit,
    expectedRuntime: {
      runtime_instance_id: BOUNDED_RUNTIME_ID,
      worker_topology: BOUNDED_WORKER_TOPOLOGY,
    },
    healthRequester: async () => {
      calls += 1;
      if (calls > 1) return exactHealth;
      const isolated = exactHealth.multiLaneRuntime.isolated_worker_pools;
      return {
        ...exactHealth,
        multiLaneRuntime: {
          isolated_worker_pools: {
            ...isolated,
            active_runner_count: 2,
            active_pool_count: 2,
            pools: [
              ...isolated.pools,
              {
                pool_id: "attacker_pool",
                active_instances: 1,
                heartbeat_ms: 30000,
                kinds: ["publish"],
              },
            ],
          },
        },
      };
    },
    timeoutMs: 1000,
    intervalMs: 1,
    setTimeoutImpl(callback) {
      queueMicrotask(callback);
      return { unref() {} };
    },
    clearTimeoutImpl() {},
  });

  assert.equal(result, exactHealth);
  assert.equal(calls, 2);
});

test("a real Node process stays alive through recovery backoff and starts the replacement generation", () => {
  const modulePath = path.join(
    ROOT,
    "lib",
    "stabilisation",
    "windows-live-guarded-runtime.js",
  );
  const script = `
    const { runLiveSupervisionLifecycle } = require(${JSON.stringify(modulePath)});
    let starts = 0;
    runLiveSupervisionLifecycle({
      restartDelayMs: 75,
      maxRestartGenerations: 1,
      async startGenerationImpl() {
        starts += 1;
        return {};
      },
      async superviseGenerationImpl() {
        if (starts === 1) {
          return {
            outcome: "restart_required",
            reason: "live_runtime_health_lost",
          };
        }
        return {
          outcome: "stopped",
          reason: "replacement_generation_observed",
        };
      },
    }).then((result) => {
      process.stdout.write(JSON.stringify({ starts, result }));
    }).catch((error) => {
      process.stderr.write(error.stack || String(error));
      process.exitCode = 1;
    });
  `;
  const startedAt = Date.now();
  const subprocess = spawnSync(process.execPath, ["-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 2_000,
  });
  const elapsedMs = Date.now() - startedAt;

  assert.equal(subprocess.status, 0, subprocess.stderr);
  assert.equal(subprocess.signal, null, subprocess.stderr);
  assert.ok(
    elapsedMs >= 50,
    `expected referenced recovery wait, process exited in ${elapsedMs}ms`,
  );
  assert.deepEqual(JSON.parse(subprocess.stdout), {
    starts: 2,
    result: {
      outcome: "stopped",
      reason: "replacement_generation_observed",
    },
  });
});

test("the iterative lifecycle recreates one real owner receipt per generation and stays bounded", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-bounded-generations-"),
  );
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const ownerPath = path.join(temp, "supervisor-owner.json");
    const ownerPids = [];
    let startCalls = 0;
    const maxRestartGenerations = 2;
    const signalEmitter = new EventEmitter();

    await assert.rejects(
      runLiveSupervisionLifecycle({
        signalEmitter,
        restartDelayMs: 0,
        delayImpl: () => Promise.resolve(),
        maxRestartGenerations,
        async startGenerationImpl({ generation }) {
          assert.equal(signalEmitter.listenerCount("SIGTERM"), 1);
          assert.equal(signalEmitter.listenerCount("SIGINT"), 1);
          assert.equal(generation, startCalls + 1);
          assert.equal(fs.existsSync(ownerPath), false);
          startCalls += 1;
          const child = new EventEmitter();
          child.pid = 8000 + startCalls;
          fs.writeFileSync(
            ownerPath,
            `${JSON.stringify({ child_pid: child.pid })}\n`,
          );
          ownerPids.push(
            JSON.parse(fs.readFileSync(ownerPath, "utf8")).child_pid,
          );
          child.kill = (signal) => {
            setImmediate(() => child.emit("exit", null, signal));
            return true;
          };
          return {
            child,
            ownerPath,
            profile: { port: 3001, state_root: temp },
            repoRoot: temp,
            expectedCommit: "c".repeat(40),
            activationInspector: () => ({
              valid: true,
              blockers: [],
            }),
            healthRequester: async () => null,
            monitorIntervalMs: 2,
            writeExitReceiptImpl() {},
          };
        },
      }),
      /live_runtime_health_restart_budget_exhausted:3/,
    );

    assert.equal(startCalls, maxRestartGenerations + 1);
    assert.deepEqual(ownerPids, [8001, 8002, 8003]);
    assert.equal(fs.existsSync(ownerPath), false);
    assert.equal(signalEmitter.listenerCount("SIGTERM"), 0);
    assert.equal(signalEmitter.listenerCount("SIGINT"), 0);
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("a failed restart generation propagates without leaving or overlapping an owner receipt", async () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-restart-failure-"),
  );
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const ownerPath = path.join(temp, "supervisor-owner.json");
    let startCalls = 0;
    await assert.rejects(
      runLiveSupervisionLifecycle({
        signalEmitter: new EventEmitter(),
        restartDelayMs: 0,
        delayImpl: () => Promise.resolve(),
        maxRestartGenerations: 3,
        async startGenerationImpl() {
          startCalls += 1;
          assert.equal(fs.existsSync(ownerPath), false);
          if (startCalls === 2) {
            throw new Error("restart_gate_failed");
          }
          const child = new EventEmitter();
          child.pid = 9001;
          fs.writeFileSync(
            ownerPath,
            `${JSON.stringify({ child_pid: child.pid })}\n`,
          );
          child.kill = (signal) => {
            setImmediate(() => child.emit("exit", null, signal));
            return true;
          };
          return {
            child,
            ownerPath,
            profile: { port: 3001, state_root: temp },
            repoRoot: temp,
            expectedCommit: "c".repeat(40),
            activationInspector: () => ({
              valid: true,
              blockers: [],
            }),
            healthRequester: async () => null,
            monitorIntervalMs: 2,
            writeExitReceiptImpl() {},
          };
        },
      }),
      /restart_gate_failed/,
    );

    assert.equal(startCalls, 2);
    assert.equal(fs.existsSync(ownerPath), false);
  } finally {
    clearInterval(keepAlive);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("default lifecycle handlers install disabled and enable only the exact managed task without starting it immediately", async () => {
  const calls = [];
  const handlers = createDefaultLiveLifecycleHandlers({
    issueActivationImpl(options) {
      calls.push(["issue_activation", options]);
      return { outcome: "activation_receipt_issued" };
    },
    installImpl(options) {
      calls.push(["install", options]);
      return { outcome: "installed_disabled" };
    },
    setEnabledImpl(options) {
      calls.push(["set_enabled", options]);
      return { outcome: "enabled_for_next_boot" };
    },
    revokeActivationImpl(options) {
      calls.push(["revoke_activation", options]);
      return { outcome: "activation_receipt_revoked" };
    },
  });
  const profile = loadLiveGuardedRuntimeProfile();
  const options = {
    repoRoot: ROOT,
    expectedCommit: "f".repeat(40),
    operatorId: "operator-42",
    reason: "Bind the reviewed YouTube OAuth client",
    youtubeOAuthClientSha256: "6".repeat(64),
  };

  const installed = await handlers.install({
    profile,
    options,
    report: { checks: {} },
  });
  assert.equal(installed.outcome, "installed_disabled");
  assert.equal(calls[0][1].enabled, false);

  const enabled = await handlers.enable({
    profile,
    options,
    report: {
      checks: {
        activation: {
          valid: true,
          receipt_sha256: "a".repeat(64),
        },
      },
    },
  });
  assert.equal(enabled.outcome, "enabled_for_next_boot");
  assert.equal(calls[1][1].enabled, true);
  assert.equal(calls[1][1].startImmediately, false);
  assert.equal(calls[1][1].activation.valid, true);

  const revoked = await handlers["revoke-activation"]({
    profile,
    options,
    report: {
      checks: {
        task: {
          state: "absent",
        },
      },
    },
  });
  assert.equal(revoked.outcome, "activation_receipt_revoked");
  assert.equal(calls[2][1].taskDisabledConfirmed, true);

  const issued = await handlers["issue-activation"]({
    profile,
    options,
    report: { checks: {} },
  });
  assert.equal(issued.outcome, "activation_receipt_issued");
  assert.equal(calls[3][1].youtubeOAuthClientSha256, "6".repeat(64));
});

test("default lifecycle dispatch forwards only the doctor-bound activation into guarded start", async () => {
  const calls = [];
  const handlers = createDefaultLiveLifecycleHandlers({
    startImpl(options) {
      calls.push(options);
      return { outcome: "started_verified" };
    },
  });
  const profile = loadLiveGuardedRuntimeProfile();
  const activation = {
    valid: true,
    receipt_sha256: "a".repeat(64),
    blockers: [],
  };
  const result = await handlers.start({
    profile,
    options: {
      repoRoot: ROOT,
      expectedCommit: "f".repeat(40),
    },
    report: {
      checks: { activation },
    },
  });

  assert.equal(result.outcome, "started_verified");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].profile, profile);
  assert.equal(calls[0].repoRoot, ROOT);
  assert.equal(calls[0].expectedCommit, "f".repeat(40));
  assert.equal(calls[0].activation, activation);
});

test("an exact-plan transition lease blocks activation, enable and start before any live mutation", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const transition = inMemoryTransitionLease({
    preheldOwner: "exact-plan-drain:other",
  });
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  let sourceInspections = 0;
  let runtimeInspections = 0;
  let taskMutations = 0;

  assert.throws(
    () =>
      issueLiveActivationReceipt({
        profile,
        repoRoot: ROOT,
        expectedCommit: "d".repeat(40),
        operatorId: "pulse-autonomous-release",
        reason: "governed cutover",
        youtubeOAuthClientSha256: "6".repeat(64),
        runtimeTransitionLeaseFactory: transition.factory,
        sourceDatabaseInspector() {
          sourceInspections += 1;
        },
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.throws(
    () =>
      setLiveScheduledTaskEnabled({
        profile,
        repoRoot: ROOT,
        expectedCommit: "d".repeat(40),
        enabled: true,
        activation,
        platform: "win32",
        runtimeTransitionLeaseFactory: transition.factory,
        sourceDatabaseInspector() {
          sourceInspections += 1;
        },
        execFileSyncImpl() {
          taskMutations += 1;
        },
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  await assert.rejects(
    startLiveScheduledTask({
      profile,
      repoRoot: ROOT,
      expectedCommit: "d".repeat(40),
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      operationNonceFactory: () => START_OPERATION_NONCE,
      runtimeTransitionLeaseFactory: transition.factory,
      runtimeInspector() {
        runtimeInspections += 1;
        return { stopped: true, blockers: [] };
      },
      execFileSyncImpl() {
        taskMutations += 1;
      },
    }),
    /live_runtime_transition_lease_unavailable/,
  );

  assert.equal(sourceInspections, 0);
  assert.equal(runtimeInspections, 0);
  assert.equal(taskMutations, 0);
  assert.equal(transition.current()?.owner_id, "exact-plan-drain:other");
});

test("scheduled-task enablement rejects non-boolean values before acquiring authority or mutating schtasks", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  for (const value of ["false", "true", 0, 1, null, undefined]) {
    let leaseAcquisitions = 0;
    let taskMutations = 0;
    assert.throws(
      () =>
        setLiveScheduledTaskEnabled({
          profile,
          repoRoot: ROOT,
          expectedCommit: "d".repeat(40),
          enabled: value,
          platform: "win32",
          transitionLeaseAcquirer() {
            leaseAcquisitions += 1;
            throw new Error("must_not_acquire");
          },
          taskInspector: () => ({ state: "managed_disabled" }),
          execFileSyncImpl() {
            taskMutations += 1;
          },
        }),
      /live_task_enabled_boolean_required/,
      String(value),
    );
    assert.equal(leaseAcquisitions, 0, String(value));
    assert.equal(taskMutations, 0, String(value));
  }
});

test("activation receipt issue and exact no-op both hold and release the transition lease", (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-activation-transition-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const transition = inMemoryTransitionLease();
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: path.join(
      temp,
      "state",
      "activation-receipt.json",
    ),
  };
  const receipt = {
    schema_version: "fixture-live-activation-v1",
    receipt_sha256: "a".repeat(64),
  };
  let receiptPresent = false;
  let builtAuthority = null;
  const common = {
    profile,
    repoRoot: ROOT,
    expectedCommit: "d".repeat(40),
    operatorId: "pulse-autonomous-release",
    reason: "governed cutover",
    youtubeOAuthClientSha256: "6".repeat(64),
    generatedAt: "2026-08-01T08:00:00.000Z",
    runtimeInstanceIdFactory: () => BOUNDED_RUNTIME_ID,
    nodeExecutable: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkoutRealPath: "D:/pulse/releases/pulse-v1",
    databaseIdentitySha256: BOUNDED_DATABASE_SHA,
    runtimeTransitionLeaseFactory: transition.factory,
    activationReceiptBuilder: (options) => {
      builtAuthority = {
        runtimeInstanceId: options.runtimeInstanceId,
        nodePath: options.nodePath,
        checkoutRealPath: options.checkoutRealPath,
        databaseIdentitySha256: options.databaseIdentitySha256,
      };
      return receipt;
    },
    activationReceiptInspector: () => ({
      valid: true,
      receipt_sha256: receipt.receipt_sha256,
    }),
    receiptExists: () => receiptPresent,
    receiptWriter(filePath, value) {
      assert.ok(transition.current());
      assert.equal(filePath, path.resolve(profile.activation_receipt_path));
      assert.equal(value, receipt);
      receiptPresent = true;
    },
    sourceDatabaseInspector() {
      assert.ok(transition.current());
      return { checkout: { ready: true }, database: { ready: true } };
    },
  };

  const issued = issueLiveActivationReceipt(common);
  assert.equal(issued.outcome, "activation_receipt_issued");
  assert.deepEqual(builtAuthority, {
    runtimeInstanceId: BOUNDED_RUNTIME_ID,
    nodePath: "D:/pulse-tools/node-v22.17.1/node.exe",
    checkoutRealPath: "D:/pulse/releases/pulse-v1",
    databaseIdentitySha256: BOUNDED_DATABASE_SHA,
  });
  assert.equal(transition.current(), null);
  const replayed = issueLiveActivationReceipt(common);
  assert.equal(replayed.outcome, "no_op_exact_activation_receipt_exists");
  assert.equal(transition.current(), null);
});

test("activation revocation is excluded by an active exact-plan transition fence", (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-revoke-transition-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const receiptPath = path.join(temp, "state", "activation-receipt.json");
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, '{"valid":true}\n');
  const transition = inMemoryTransitionLease({
    preheldOwner: "exact-plan-drain:other",
  });
  const profile = {
    ...loadLiveGuardedRuntimeProfile(),
    database_path: path.join(temp, "pulse.db"),
    state_root: path.join(temp, "state"),
    activation_receipt_path: receiptPath,
  };

  assert.throws(
    () =>
      revokeLiveActivationReceipt({
        profile,
        expectedCommit: "e".repeat(40),
        taskDisabledConfirmed: true,
        runtimeTransitionLeaseFactory: transition.factory,
      }),
    /live_runtime_transition_lease_unavailable/,
  );
  assert.equal(fs.existsSync(receiptPath), true);
});

test("enable revalidates source, receipt and competing-task state at the mutation boundary and never runs the task", () => {
  const calls = [];
  const transition = inMemoryTransitionLease();
  const taskStates = [
    { state: "managed_disabled", blockers: [] },
    { state: "managed_current", blockers: [] },
  ];
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const result = setLiveScheduledTaskEnabled({
    runtimeTransitionLeaseFactory: transition.factory,
    profile: loadLiveGuardedRuntimeProfile(),
    repoRoot: ROOT,
    expectedCommit: "d".repeat(40),
    enabled: true,
    startImmediately: false,
    activation,
    platform: "win32",
    sourceDatabaseInspector(options) {
      calls.push(["source_database", options]);
      return { checkout: { ready: true }, database: { ready: true } };
    },
    activationInspector(options) {
      calls.push(["activation", options]);
      return activation;
    },
    conflictInspector(options) {
      calls.push(["conflicts", options]);
      return { clear: true, blockers: [] };
    },
    taskInspector(options) {
      calls.push(["task", options]);
      return taskStates.shift();
    },
    execFileSyncImpl(command, args) {
      calls.push(["exec", { command, args }]);
      return "";
    },
    lifecycleReceiptWriter(options) {
      assert.ok(transition.current());
      calls.push(["receipt", options]);
      return { outcome: options.details.outcome };
    },
  });

  assert.equal(result.outcome, "enabled_for_next_boot");
  assert.equal(transition.current(), null);
  const exec = calls.find(([name]) => name === "exec")[1];
  assert.equal(exec.command, "schtasks.exe");
  assert.deepEqual(exec.args, [
    "/Change",
    "/TN",
    "PulseGaming-LiveGuarded-YouTube-Runtime",
    "/ENABLE",
  ]);
  assert.ok(!exec.args.includes("/Run"));
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "source_database",
      "activation",
      "conflicts",
      "task",
      "exec",
      "task",
      "receipt",
    ],
  );
});

test("guarded start revalidates the exact runway, launches only the managed SYSTEM task and attests exact live ownership", async () => {
  const calls = [];
  const transition = inMemoryTransitionLease();
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const owner = {
    schema_version: "pulse-windows-live-guarded-owner-v2",
    supervisor_pid: 4111,
    supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
    child_pid: 4123,
    child_process_started_at: TEST_PROCESS_STARTED_AT,
    port: profile.port,
    repo_root: ROOT.replace(/\\/g, "/"),
    commit_sha: expectedCommit,
    profile_sha256:
      "508c2b2a5284af6d5784ff245e3e4dca2dd6159bd470fdc11d2737bc76495aaa",
    activation_receipt_sha256: activation.receipt_sha256,
    start_operation_nonce: START_OPERATION_NONCE,
    platform: "youtube",
  };
  let listenerInspection = 0;
  let healthInspection = 0;
  const liveHealth = {
    status: "ok",
    schedulerActive: true,
    build: { commit_sha: expectedCommit },
    deployment: { mode: "local", primary: true },
    runtime: {
      operating_mode: "LIVE_GUARDED",
      auto_publish: true,
      legacy_auto_publish_armed: true,
      use_sqlite: true,
      use_job_queue_explicit: "true",
    },
    multiLaneRuntime: boundedMultiLaneHealth(),
  };

  const result = await startLiveScheduledTask({
    ...inMemoryStartLock({ events: calls }),
    runtimeTransitionLeaseFactory: transition.factory,
    profile,
    repoRoot: ROOT,
    expectedCommit,
    activation,
    workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
    platform: "win32",
    sourceDatabaseInspector(options) {
      calls.push(["source_database", options]);
      return { checkout: { ready: true }, database: { ready: true } };
    },
    activationInspector(options) {
      calls.push(["activation", options]);
      return activation;
    },
    conflictInspector(options) {
      calls.push(["conflicts", options]);
      return { clear: true, blockers: [] };
    },
    taskInspector(options) {
      calls.push(["task", options]);
      return { state: "managed_current", blockers: [] };
    },
    runtimeInspector(options) {
      const listeners = options.listenerInspector({
        profile: options.profile,
      });
      return {
        stopped:
          listeners.available === true && listeners.listeningPids.length === 0,
        blockers: [],
      };
    },
    listenerInspector(options) {
      calls.push(["listeners", options]);
      listenerInspection += 1;
      return listenerInspection <= 2
        ? { available: true, listeningPids: [] }
        : { available: true, listeningPids: [owner.child_pid] };
    },
    healthRequester(options) {
      calls.push(["health", options]);
      healthInspection += 1;
      if (healthInspection === 1) {
        const isolated = liveHealth.multiLaneRuntime.isolated_worker_pools;
        return {
          ...liveHealth,
          multiLaneRuntime: {
            isolated_worker_pools: {
              ...isolated,
              active_runner_count: 2,
              active_pool_count: 2,
              pools: [
                ...isolated.pools,
                {
                  pool_id: "attacker_pool",
                  active_instances: 1,
                  heartbeat_ms: 30000,
                  kinds: ["publish"],
                },
              ],
            },
          },
        };
      }
      return liveHealth;
    },
    ownerReader(options) {
      calls.push(["owner", options]);
      return owner;
    },
    execFileSyncImpl(command, args) {
      calls.push(["exec", { command, args }]);
      return "";
    },
    delayImpl() {},
    lifecycleReceiptWriter(options) {
      assert.equal(
        transition.current()?.owner_id,
        `live-start:${START_OPERATION_NONCE}`,
      );
      calls.push(["receipt", options]);
      return { receipt_path: "D:/pulse/evidence/start.json" };
    },
  });

  assert.deepEqual(calls.find(([name]) => name === "exec")[1], {
    command: "schtasks.exe",
    args: ["/Run", "/TN", profile.task_name],
  });
  assert.equal(result.receipt_path, "D:/pulse/evidence/start.json");
  assert.equal(healthInspection, 3);
  assert.equal(transition.current(), null);
  const receiptCall = calls.find(([name]) => name === "receipt")[1];
  assert.equal(receiptCall.action, "start");
  assert.equal(receiptCall.details.outcome, "started_verified");
  assert.equal(
    receiptCall.details.activation_receipt_sha256,
    activation.receipt_sha256,
  );
  assert.equal(receiptCall.details.supervisor_pid, owner.supervisor_pid);
  assert.equal(receiptCall.details.child_pid, owner.child_pid);
  assert.equal(receiptCall.details.listener_pid, owner.child_pid);
  assert.equal(receiptCall.details.operation_nonce, START_OPERATION_NONCE);
  for (const check of ["source_database", "activation", "conflicts", "task"]) {
    assert.equal(
      calls.filter(([name]) => name === check).length,
      2,
      `${check} must be revalidated after launch`,
    );
  }
});

test("guarded start redacts finalizer failures from thrown errors", async (t) => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const scenarios = [
    {
      name: "start-operation lock release",
      stage: "start_operation_lock_release_failed",
      sentinel: "SENTINEL_START_LOCK_RELEASE_MUST_NOT_ESCAPE",
      failLockRelease: true,
    },
    {
      name: "transition lease release",
      stage: "start_transition_lease_release_failed",
      sentinel: "SENTINEL_TRANSITION_RELEASE_MUST_NOT_ESCAPE",
      failTransitionRelease: true,
    },
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      let transitionReleaseCalls = 0;
      let lockReleaseCalls = 0;
      let thrown = null;

      try {
        await startLiveScheduledTask({
          profile,
          repoRoot: ROOT,
          expectedCommit,
          activation,
          workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
          platform: "win32",
          transitionLeaseAcquirer() {
            return {
              renew() {},
              release() {
                transitionReleaseCalls += 1;
                if (scenario.failTransitionRelease) {
                  throw new Error(scenario.sentinel);
                }
              },
            };
          },
          runtimeInspector() {
            return { stopped: true, blockers: [] };
          },
          startLockAcquirer() {
            return { operation_nonce: START_OPERATION_NONCE };
          },
          startLockReleaser() {
            lockReleaseCalls += 1;
            if (scenario.failLockRelease) {
              throw new Error(scenario.sentinel);
            }
          },
          sourceDatabaseInspector() {
            return { checkout: { ready: true }, database: { ready: true } };
          },
          activationInspector() {
            return { valid: false, receipt_sha256: null, blockers: [] };
          },
        });
      } catch (error) {
        thrown = error;
      }

      assert.ok(thrown);
      assert.match(
        thrown.message,
        new RegExp(
          `^live_task_start_finalization_failed:${scenario.stage}:[a-f0-9]{64}$`,
        ),
      );
      assert.equal(
        inspect(thrown, { depth: 5 }).includes(scenario.sentinel),
        false,
      );
      assert.equal(lockReleaseCalls, 1);
      assert.equal(transitionReleaseCalls, 1);
    });
  }
});

test("mid-flight authority drift prevents started_verified, cleans up its own nonce and emits durable failure evidence", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const driftedActivation = {
    valid: true,
    receipt_sha256: "b".repeat(64),
    blockers: [],
  };
  const owner = {
    schema_version: "pulse-windows-live-guarded-owner-v2",
    supervisor_pid: 4111,
    supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
    child_pid: 4123,
    child_process_started_at: TEST_PROCESS_STARTED_AT,
    port: profile.port,
    repo_root: ROOT.replace(/\\/g, "/"),
    commit_sha: expectedCommit,
    profile_sha256:
      "508c2b2a5284af6d5784ff245e3e4dca2dd6159bd470fdc11d2737bc76495aaa",
    activation_receipt_sha256: activation.receipt_sha256,
    start_operation_nonce: START_OPERATION_NONCE,
    platform: "youtube",
    platform: "youtube",
  };
  const taskStates = [
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_disabled", blockers: [] },
  ];
  const activationStates = [activation, driftedActivation];
  let sourceChecks = 0;
  let conflictChecks = 0;
  let ownerReads = 0;
  let listenerReads = 0;
  const mutations = [];
  const evidence = [];

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      sourceDatabaseInspector() {
        sourceChecks += 1;
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activationStates.shift();
      },
      conflictInspector() {
        conflictChecks += 1;
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return taskStates.shift();
      },
      runtimeInspector() {
        return { stopped: true, blockers: [] };
      },
      listenerInspector() {
        listenerReads += 1;
        return listenerReads === 1
          ? { available: true, listeningPids: [owner.child_pid] }
          : { available: true, listeningPids: [] };
      },
      healthRequester() {
        return {
          status: "ok",
          schedulerActive: true,
          build: { commit_sha: expectedCommit },
          deployment: { mode: "local", primary: true },
          runtime: {
            operating_mode: "LIVE_GUARDED",
            auto_publish: true,
            legacy_auto_publish_armed: true,
            use_sqlite: true,
            use_job_queue_explicit: "true",
          },
          multiLaneRuntime: boundedMultiLaneHealth(),
        };
      },
      ownerReader() {
        ownerReads += 1;
        return ownerReads <= 2 ? owner : null;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        return "";
      },
      delayImpl() {},
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    /post_launch_activation_receipt_drift/,
  );

  assert.equal(sourceChecks, 2);
  assert.equal(conflictChecks, 1);
  assert.equal(activationStates.length, 0);
  assert.equal(taskStates.length, 0);
  assert.deepEqual(
    mutations.map(({ args }) => args[0]),
    ["/Run", "/End", "/Change"],
  );
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.outcome, "start_failed");
  assert.equal(evidence[0].details.stopped_verified, true);
  assert.equal(evidence[0].details.operation_nonce, START_OPERATION_NONCE);
  assert.match(
    evidence[0].details.primary_error,
    /post_launch_activation_receipt_drift/,
  );
});

test("an ambiguous schtasks Run error is redacted from durable evidence and the final error", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const secretSentinel = "SENTINEL_RUN_ERROR_MUST_NOT_PERSIST_7f9a";
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const taskStates = [
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_disabled", blockers: [] },
  ];
  const mutations = [];
  const evidence = [];
  const operationEvents = [];

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock({ events: operationEvents }),
      profile,
      repoRoot: ROOT,
      expectedCommit: "d".repeat(40),
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return taskStates.shift();
      },
      runtimeInspector() {
        return {
          stopped: true,
          owner_state: "exact_stale",
          listening_pids: [],
          blockers: [],
        };
      },
      listenerInspector() {
        return { available: true, listeningPids: [] };
      },
      healthRequester() {
        throw new Error("health must not run after ambiguous /Run");
      },
      ownerReader() {
        return null;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        if (args[0] === "/Run") {
          const error = new Error(
            `scheduled task request timed out ${secretSentinel}`,
          );
          error.code = "ETIMEDOUT";
          throw error;
        }
        return "";
      },
      delayImpl() {},
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    (error) => {
      const message = String(error?.message || error);
      assert.match(
        message,
        /^live_task_start_failed:start_task_run_failed:[a-f0-9]{64}$/,
      );
      assert.equal(message.includes(secretSentinel), false);
      return true;
    },
  );

  assert.deepEqual(
    mutations.map(({ args }) => args[0]),
    ["/Run", "/End", "/Change"],
  );
  assert.deepEqual(
    operationEvents.map(([event]) => event),
    ["lock_acquire", "stale_owner_archive", "lock_release"],
  );
  assert.equal(taskStates.length, 0);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.stopped_verified, true);
  assert.match(
    evidence[0].details.primary_error,
    /^start_task_run_failed:[a-f0-9]{64}$/,
  );
  assert.equal(JSON.stringify(evidence).includes(secretSentinel), false);
});

test("runtime identity is re-read after authority revalidation before started_verified", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const owner = {
    schema_version: "pulse-windows-live-guarded-owner-v2",
    supervisor_pid: 4111,
    supervisor_process_started_at: TEST_PROCESS_STARTED_AT,
    child_pid: 4123,
    child_process_started_at: TEST_PROCESS_STARTED_AT,
    port: profile.port,
    repo_root: ROOT.replace(/\\/g, "/"),
    commit_sha: expectedCommit,
    profile_sha256:
      "508c2b2a5284af6d5784ff245e3e4dca2dd6159bd470fdc11d2737bc76495aaa",
    activation_receipt_sha256: activation.receipt_sha256,
    start_operation_nonce: START_OPERATION_NONCE,
    platform: "youtube",
  };
  const taskStates = [
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_disabled", blockers: [] },
  ];
  let healthReads = 0;
  let ownerReads = 0;
  let listenerReads = 0;
  const mutations = [];
  const evidence = [];

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return taskStates.shift();
      },
      runtimeInspector() {
        return { stopped: true, blockers: [] };
      },
      listenerInspector() {
        listenerReads += 1;
        return listenerReads === 1
          ? { available: true, listeningPids: [owner.child_pid] }
          : { available: true, listeningPids: [] };
      },
      healthRequester() {
        healthReads += 1;
        return healthReads === 1
          ? {
              status: "ok",
              schedulerActive: true,
              build: { commit_sha: expectedCommit },
              deployment: { mode: "local", primary: true },
              runtime: {
                operating_mode: "LIVE_GUARDED",
                auto_publish: true,
                legacy_auto_publish_armed: true,
                use_sqlite: true,
                use_job_queue_explicit: "true",
              },
              multiLaneRuntime: boundedMultiLaneHealth(),
            }
          : null;
      },
      ownerReader() {
        ownerReads += 1;
        return ownerReads === 1 ? owner : null;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        return "";
      },
      delayImpl() {},
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    /post_launch_runtime_identity_drift/,
  );

  assert.equal(healthReads, 2);
  assert.deepEqual(
    mutations.map(({ args }) => args[0]),
    ["/Run", "/End", "/Change"],
  );
  assert.equal(taskStates.length, 0);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.stopped_verified, true);
});

test("guarded start ends and disables only the re-inspected managed task when exact live verification fails", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const taskStates = [
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_disabled", blockers: [] },
  ];
  const mutations = [];
  const evidence = [];
  const listenerStates = [[], [], [], [4999], []];
  let delayCalls = 0;

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return taskStates.shift();
      },
      runtimeInspector(options) {
        const listeners = options.listenerInspector({
          profile: options.profile,
        });
        return {
          stopped:
            listeners.available === true &&
            listeners.listeningPids.length === 0,
          blockers: [],
        };
      },
      listenerInspector() {
        return {
          available: true,
          listeningPids: listenerStates.shift() || [],
        };
      },
      healthRequester() {
        return {
          status: "ok",
          schedulerActive: true,
          build: { commit_sha: "e".repeat(40) },
          deployment: { mode: "local", primary: true },
          runtime: {
            operating_mode: "LIVE_GUARDED",
            auto_publish: true,
            legacy_auto_publish_armed: true,
            use_sqlite: true,
            use_job_queue_explicit: "true",
          },
          multiLaneRuntime: boundedMultiLaneHealth(),
        };
      },
      ownerReader() {
        return null;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        return "";
      },
      delayImpl() {
        delayCalls += 1;
      },
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    /live_task_start_verification_failed/,
  );

  assert.deepEqual(mutations, [
    {
      command: "schtasks.exe",
      args: ["/Run", "/TN", profile.task_name],
    },
    {
      command: "schtasks.exe",
      args: ["/End", "/TN", profile.task_name],
    },
    {
      command: "schtasks.exe",
      args: ["/Change", "/TN", profile.task_name, "/DISABLE"],
    },
  ]);
  assert.equal(taskStates.length, 0);
  assert.equal(listenerStates.length, 0);
  assert.ok(delayCalls >= 2);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.stopped_verified, true);
});

test("cleanup command failures and an orphan listener are durably reported without claiming stopped", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const endSecretSentinel = "SENTINEL_END_ERROR_MUST_NOT_PERSIST_6e8b";
  const disableSecretSentinel = "SENTINEL_DISABLE_ERROR_MUST_NOT_PERSIST_5d7c";
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const owner = {
    start_operation_nonce: START_OPERATION_NONCE,
    child_pid: 4123,
  };
  const taskStates = [
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
    { state: "managed_current", blockers: [] },
  ];
  const mutations = [];
  const evidence = [];

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      shutdownTimeoutMs: 0,
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return taskStates.shift();
      },
      runtimeInspector() {
        return { stopped: true, blockers: [] };
      },
      listenerInspector() {
        return {
          available: true,
          listeningPids: [owner.child_pid],
        };
      },
      healthRequester() {
        return null;
      },
      ownerReader() {
        return owner;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        if (args[0] === "/End") {
          throw new Error(`${args[0]} failed ${endSecretSentinel}`);
        }
        if (args[0] === "/Change") {
          throw new Error(`${args[0]} failed ${disableSecretSentinel}`);
        }
        return "";
      },
      delayImpl() {},
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    (error) => {
      const message = String(error?.message || error);
      assert.match(message, /^live_task_start_fail_closed_incomplete:/);
      assert.equal(message.includes(endSecretSentinel), false);
      assert.equal(message.includes(disableSecretSentinel), false);
      return true;
    },
  );

  assert.deepEqual(
    mutations.map(({ args }) => args[0]),
    ["/Run", "/End", "/Change"],
  );
  assert.equal(evidence.length, 1);
  const failure = evidence[0];
  assert.equal(failure.action, "start-failed");
  assert.equal(failure.details.stopped_verified, false);
  assert.equal(failure.details.cleanup.end_succeeded, false);
  assert.equal(failure.details.cleanup.disable_succeeded, false);
  assert.deepEqual(failure.details.cleanup.orphan_listener_pids, [
    owner.child_pid,
  ]);
  assert.ok(
    failure.details.cleanup.blockers.some((blocker) =>
      /^start_cleanup_end_failed:[a-f0-9]{64}$/.test(blocker),
    ),
  );
  assert.ok(
    failure.details.cleanup.blockers.some((blocker) =>
      /^start_cleanup_disable_failed:[a-f0-9]{64}$/.test(blocker),
    ),
  );
  assert.ok(
    failure.details.cleanup.blockers.includes("start_cleanup_orphan_listener"),
  );
  assert.equal(JSON.stringify(failure).includes(endSecretSentinel), false);
  assert.equal(JSON.stringify(failure).includes(disableSecretSentinel), false);
});

test("an unexpected cleanup inspection error still produces failure evidence", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const cleanupSecretSentinel = "SENTINEL_CLEANUP_ERROR_MUST_NOT_PERSIST_4c6d";
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const evidence = [];
  let taskInspections = 0;

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit: "d".repeat(40),
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        taskInspections += 1;
        if (taskInspections > 1) {
          throw new Error(
            `task inspection unavailable ${cleanupSecretSentinel}`,
          );
        }
        return { state: "managed_current", blockers: [] };
      },
      runtimeInspector() {
        return { stopped: true, blockers: [] };
      },
      listenerInspector() {
        return { available: true, listeningPids: [] };
      },
      healthRequester() {
        return null;
      },
      ownerReader() {
        return null;
      },
      execFileSyncImpl() {
        return "";
      },
      delayImpl() {},
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    (error) => {
      const message = String(error?.message || error);
      assert.match(message, /^live_task_start_fail_closed_incomplete:/);
      assert.equal(message.includes(cleanupSecretSentinel), false);
      return true;
    },
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.stopped_verified, false);
  assert.ok(
    evidence[0].details.cleanup.blockers.some((blocker) =>
      /^start_cleanup_unhandled_error:[a-f0-9]{64}$/.test(blocker),
    ),
  );
  assert.equal(JSON.stringify(evidence).includes(cleanupSecretSentinel), false);
});

test("a failed nonce cannot terminate or disable a different successful start owner", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const otherOwner = {
    child_pid: 5123,
    start_operation_nonce: "22222222-2222-4222-8222-222222222222",
  };
  const mutations = [];
  const evidence = [];

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit,
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return { state: "managed_current", blockers: [] };
      },
      runtimeInspector() {
        return { stopped: true, blockers: [] };
      },
      listenerInspector() {
        return {
          available: true,
          listeningPids: [otherOwner.child_pid],
        };
      },
      healthRequester() {
        return null;
      },
      ownerReader() {
        return otherOwner;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        return "";
      },
      delayImpl() {},
      lifecycleReceiptWriter(options) {
        evidence.push(options);
        return { receipt_path: "D:/pulse/evidence/start-failed.json" };
      },
    }),
    /live_task_start_fail_closed_incomplete/,
  );

  assert.deepEqual(
    mutations.map(({ args }) => args[0]),
    ["/Run"],
  );
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].details.stopped_verified, false);
  assert.ok(
    evidence[0].details.cleanup.blockers.includes(
      "start_cleanup_owner_operation_nonce_mismatch",
    ),
  );
});

test("guarded start rechecks stopped runtime ownership at the mutation boundary before task launch", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    runtime_instance_id: BOUNDED_RUNTIME_ID,
    blockers: [],
  };
  const mutations = [];

  await assert.rejects(
    startLiveScheduledTask({
      ...inMemoryStartLock(),
      profile,
      repoRoot: ROOT,
      expectedCommit: "d".repeat(40),
      activation,
      workerTopologyProvider: () => BOUNDED_WORKER_TOPOLOGY,
      platform: "win32",
      timeoutMs: 0,
      sourceDatabaseInspector() {
        return { checkout: { ready: true }, database: { ready: true } };
      },
      activationInspector() {
        return activation;
      },
      conflictInspector() {
        return { clear: true, blockers: [] };
      },
      taskInspector() {
        return { state: "managed_current", blockers: [] };
      },
      runtimeInspector() {
        return {
          stopped: false,
          owner_receipt_present: true,
          listening_pids: [],
          blockers: ["live_supervisor_owner_receipt_present"],
        };
      },
      listenerInspector() {
        return { available: true, listeningPids: [] };
      },
      healthRequester() {
        return null;
      },
      ownerReader() {
        return null;
      },
      execFileSyncImpl(command, args) {
        mutations.push({ command, args });
        return "";
      },
      delayImpl() {},
    }),
    /live_supervisor_owner_receipt_present/,
  );

  assert.deepEqual(mutations, []);
});

test("lifecycle execution never reaches Windows mutation handlers without the already-evaluated exact authority", async () => {
  let calls = 0;
  const handlers = {
    install: async () => {
      calls += 1;
      return { outcome: "installed_disabled" };
    },
  };
  const blocked = await executeLiveLifecycleAction({
    report: {
      action: "install",
      decision: {
        mutation_authorised: false,
        planned_effect: "install_disabled",
      },
    },
    handlers,
  });
  assert.equal(calls, 0);
  assert.deepEqual(blocked, {
    executed: false,
    effect: "install_disabled",
    reason: "dry_run_or_blocked",
  });

  const executed = await executeLiveLifecycleAction({
    report: {
      action: "install",
      decision: {
        mutation_authorised: true,
        planned_effect: "install_disabled",
      },
    },
    profile: loadLiveGuardedRuntimeProfile(),
    options: {
      repoRoot: ROOT,
      expectedCommit: "a".repeat(40),
    },
    handlers,
  });
  assert.equal(calls, 1);
  assert.deepEqual(executed, {
    executed: true,
    effect: "install_disabled",
    result: { outcome: "installed_disabled" },
  });
});

test("doctor proof reports READY only for exact clean source, migrated DB, activation, SYSTEM task and no competing owner without claiming production GREEN", () => {
  const expectedCommit = "e".repeat(40);
  const seen = [];
  const report = buildLiveRuntimeDoctorReport({
    expectedCommit,
    repoRoot: ROOT,
    generatedAt: "2026-07-28T13:00:00.000Z",
    dependencies: {
      inspectCheckout(input) {
        seen.push(["checkout", input]);
        return {
          ready: true,
          commit_sha: expectedCommit,
          clean: true,
          blockers: [],
        };
      },
      inspectDatabase(input) {
        seen.push(["database", input]);
        return {
          ready: true,
          read_only: true,
          pending: [],
          checksum_mismatches: [],
          unexpected_applied: [],
          blockers: [],
        };
      },
      inspectActivation(input) {
        seen.push(["activation", input]);
        return {
          valid: true,
          receipt_sha256: "f".repeat(64),
          blockers: [],
        };
      },
      inspectTask(input) {
        seen.push(["task", input]);
        return {
          state: "managed_current",
          task_name: input.profile.task_name,
          blockers: [],
        };
      },
      inspectConflicts(input) {
        seen.push(["conflicts", input]);
        return { clear: true, tasks: [], blockers: [] };
      },
    },
  });

  assert.equal(report.verdict, "READY");
  assert.equal(report.boot_profile_ready, true);
  assert.equal(report.production_green, false);
  assert.equal(report.target.task_principal, "SYSTEM");
  assert.equal(report.target.task_trigger, "AtStartup");
  assert.equal(report.profile.operating_mode, "LIVE_GUARDED");
  assert.equal(report.profile.scheduler_profile, "governed_multi_lane");
  assert.equal(report.profile.platform, "youtube");
  assert.equal(report.profile.secondary_automation_frozen, true);
  assert.equal(
    report.checks.control_policy.fresh_green_control_tower_required_per_release,
    true,
  );
  assert.equal(seen.length, 5);
  assert.match(
    seen.find(([name]) => name === "database")[1].migrationsDir,
    /db[\\/]migrations$/,
  );
  assert.doesNotMatch(JSON.stringify(report), /must-not-leak-this-value/i);

  const blocked = buildLiveRuntimeDoctorReport({
    expectedCommit,
    repoRoot: ROOT,
    dependencies: {
      inspectCheckout: () => ({
        ready: true,
        clean: true,
        blockers: [],
      }),
      inspectDatabase: () => ({
        ready: true,
        read_only: true,
        blockers: [],
      }),
      inspectActivation: () => ({
        valid: false,
        blockers: ["activation_receipt_missing"],
      }),
      inspectTask: () => ({
        state: "managed_current",
        blockers: [],
      }),
      inspectConflicts: () => ({
        clear: false,
        blockers: ["conflicting_runtime_task_enabled"],
      }),
    },
  });
  assert.equal(blocked.verdict, "HOLD");
  assert.equal(blocked.boot_profile_ready, false);
  assert.equal(blocked.production_green, false);
});

test("activation preflight refuses to authorise issuance without an exact OAuth client hash", () => {
  const dependencies = {
    inspectCheckout: () => ({ ready: true, blockers: [] }),
    inspectDatabase: () => ({ ready: true, blockers: [] }),
    inspectActivation: () => ({
      valid: false,
      blockers: ["activation_receipt_missing"],
    }),
    inspectTask: () => ({ state: "absent", blockers: [] }),
    inspectConflicts: () => ({ clear: true, blockers: [] }),
  };
  const base = {
    action: "issue-activation",
    expectedCommit: "e".repeat(40),
    repoRoot: ROOT,
    operatorId: "operator-42",
    reason: "Bind the reviewed YouTube OAuth client",
    dependencies,
  };

  const missing = buildLiveRuntimeDoctorReport(base);
  assert.ok(
    missing.decision.blockers.includes("youtube_oauth_client_sha256_required"),
  );

  const malformed = buildLiveRuntimeDoctorReport({
    ...base,
    youtubeOAuthClientSha256: "not-a-sha256",
  });
  assert.ok(
    malformed.decision.blockers.includes("youtube_oauth_client_sha256_invalid"),
  );

  const exact = buildLiveRuntimeDoctorReport({
    ...base,
    youtubeOAuthClientSha256: "6".repeat(64),
  });
  assert.equal(
    exact.decision.blockers.some((blocker) =>
      blocker.startsWith("youtube_oauth_client_sha256_"),
    ),
    false,
  );
});

test("install stays disabled and enable is separately gated by exact apply confirmation plus the valid activation receipt", () => {
  const common = {
    profileValidation: { valid: true, blockers: [] },
    checkout: { ready: true, blockers: [] },
    database: { ready: true, blockers: [] },
  };
  const dryInstall = buildLiveLifecycleDecision({
    ...common,
    action: "install",
    task: { state: "absent", blockers: [] },
  });
  assert.equal(dryInstall.ready, true);
  assert.equal(dryInstall.dry_run, true);
  assert.equal(dryInstall.mutation_authorised, false);
  assert.equal(dryInstall.planned_effect, "install_disabled");
  assert.equal(dryInstall.production_green, false);
  assert.equal(dryInstall.external_publish_possible, false);

  const wrongConfirmation = buildLiveLifecycleDecision({
    ...common,
    action: "install",
    task: { state: "absent", blockers: [] },
    applyRequested: true,
    confirmation: "yes",
  });
  assert.equal(wrongConfirmation.mutation_authorised, false);
  assert.ok(
    wrongConfirmation.blockers.includes("live_lifecycle_confirmation_required"),
  );

  const authorisedInstall = buildLiveLifecycleDecision({
    ...common,
    action: "install",
    task: { state: "absent", blockers: [] },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  });
  assert.equal(authorisedInstall.mutation_authorised, true);
  assert.equal(authorisedInstall.planned_effect, "install_disabled");
  assert.equal(authorisedInstall.external_publish_possible, false);

  const noReceipt = buildLiveLifecycleDecision({
    ...common,
    action: "enable",
    task: { state: "managed_disabled", blockers: [] },
    activation: {
      valid: false,
      blockers: ["activation_receipt_missing"],
    },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  });
  assert.equal(noReceipt.mutation_authorised, false);
  assert.ok(noReceipt.blockers.includes("activation_receipt_missing"));

  const authorisedEnable = buildLiveLifecycleDecision({
    ...common,
    action: "enable",
    task: { state: "managed_disabled", blockers: [] },
    activation: { valid: true, blockers: [] },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  });
  assert.equal(authorisedEnable.ready, true);
  assert.equal(authorisedEnable.mutation_authorised, true);
  assert.equal(authorisedEnable.planned_effect, "enable_at_next_boot");
  assert.equal(authorisedEnable.production_green, false);
  assert.equal(authorisedEnable.external_publish_possible, false);

  const unsafeRevoke = buildLiveLifecycleDecision({
    ...common,
    action: "revoke-activation",
    task: { state: "managed_current", blockers: [] },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  });
  assert.equal(unsafeRevoke.mutation_authorised, false);
  assert.ok(unsafeRevoke.blockers.includes("task_absent_or_disabled_required"));

  const revoke = buildLiveLifecycleDecision({
    ...common,
    action: "revoke-activation",
    task: { state: "managed_disabled", blockers: [] },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  });
  assert.equal(revoke.mutation_authorised, true);
  assert.equal(revoke.planned_effect, "revoke-activation");

  const absentRevoke = buildLiveLifecycleDecision({
    ...common,
    action: "revoke-activation",
    task: { state: "absent", blockers: [] },
    applyRequested: true,
    confirmation: LIVE_LIFECYCLE_CONFIRMATION,
  });
  assert.equal(absentRevoke.mutation_authorised, true);
});

test("the live task is a disabled-by-default SYSTEM AtStartup service-account host with no interactive dependency or secret material", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const xml = buildLiveScheduledTaskXml({
    profile,
    repoRoot: "C:/Pulse/runtime/pulse-v1",
    expectedCommit,
    nodeExecutable: "C:/Program Files/nodejs/node.exe",
  });

  assert.match(xml, /<BootTrigger>/);
  assert.doesNotMatch(xml, /<LogonTrigger>/);
  assert.match(xml, /<UserId>S-1-5-18<\/UserId>/);
  assert.doesNotMatch(xml, /<LogonType>/);
  assert.match(xml, /<RunLevel>HighestAvailable<\/RunLevel>/);
  assert.match(xml, /<StartWhenAvailable>true<\/StartWhenAvailable>/);
  assert.match(
    xml,
    /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/,
  );
  assert.match(xml, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(xml, /<RestartOnFailure>/);
  assert.match(xml, /<Interval>PT1M<\/Interval>/);
  assert.match(xml, /<Count>999<\/Count>/);
  assert.match(xml, /<Enabled>false<\/Enabled>/);
  assert.match(xml, /\bsupervise\b/);
  assert.match(xml, /--noninteractive/);
  assert.match(xml, new RegExp(expectedCommit));
  assert.doesNotMatch(
    xml,
    /(?:TOKEN|SECRET|PASSWORD|PASSCODE|API_KEY|WEBHOOK|CREDENTIAL)/i,
  );

  const valid = validateLiveScheduledTaskXml({
    xml,
    profile,
    repoRoot: "C:/Pulse/runtime/pulse-v1",
    expectedCommit,
    nodeExecutable: "C:/Program Files/nodejs/node.exe",
    expectedEnabled: false,
  });
  assert.deepEqual(valid, {
    valid: true,
    enabled: false,
    blockers: [],
  });

  const unsafeVariants = [
    xml
      .replace("<BootTrigger>", "<LogonTrigger>")
      .replace("</BootTrigger>", "</LogonTrigger>"),
    xml.replace("S-1-5-18", "S-1-5-21-1000"),
    xml.replace(
      "</UserId>",
      "</UserId><LogonType>InteractiveToken</LogonType>",
    ),
    xml.replace("HighestAvailable", "LeastPrivilege"),
    xml.replace("<Enabled>false</Enabled>", "<Enabled>true</Enabled>"),
    xml.replace("</Arguments>", " --unexpected-extra-action</Arguments>"),
  ];
  for (const unsafeXml of unsafeVariants) {
    assert.equal(
      validateLiveScheduledTaskXml({
        xml: unsafeXml,
        profile,
        repoRoot: "C:/Pulse/runtime/pulse-v1",
        expectedCommit,
        nodeExecutable: "C:/Program Files/nodejs/node.exe",
        expectedEnabled: false,
      }).valid,
      false,
    );
  }
});

test("the live task validator accepts Task Scheduler's normalised restart-policy child order without accepting incorrect values", () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const xml = buildLiveScheduledTaskXml({
    profile,
    repoRoot: "C:/Pulse/runtime/pulse-v1",
    expectedCommit,
    nodeExecutable: "C:/Program Files/nodejs/node.exe",
  });
  const taskSchedulerNormalisedXml = xml.replace(
    "<RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>",
    "<RestartOnFailure><Count>999</Count><Interval>PT1M</Interval></RestartOnFailure>",
  );

  assert.deepEqual(
    validateLiveScheduledTaskXml({
      xml: taskSchedulerNormalisedXml,
      profile,
      repoRoot: "C:/Pulse/runtime/pulse-v1",
      expectedCommit,
      nodeExecutable: "C:/Program Files/nodejs/node.exe",
      expectedEnabled: false,
    }),
    {
      valid: true,
      enabled: false,
      blockers: [],
    },
  );

  for (const unsafeXml of [
    taskSchedulerNormalisedXml.replace(
      "<Count>999</Count>",
      "<Count>998</Count>",
    ),
    taskSchedulerNormalisedXml.replace(
      "<Interval>PT1M</Interval>",
      "<Interval>PT2M</Interval>",
    ),
  ]) {
    const result = validateLiveScheduledTaskXml({
      xml: unsafeXml,
      profile,
      repoRoot: "C:/Pulse/runtime/pulse-v1",
      expectedCommit,
      nodeExecutable: "C:/Program Files/nodejs/node.exe",
      expectedEnabled: false,
    });
    assert.equal(result.valid, false);
    assert.ok(result.blockers.includes("task_restart_policy_invalid"));
  }
});

test("activation v2 binds the planned runtime authority without claiming future process identity", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-live-v2-receipt-"));
  try {
    const migrationsDir = path.join(temp, "migrations");
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(
      path.join(migrationsDir, "001_fixture.sql"),
      "SELECT 1;\n",
    );
    const profile = loadLiveGuardedRuntimeProfile();
    const expectedCommit = BOUNDED_RELEASE_SHA;
    const receipt = buildLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      operatorId: "operator-42",
      reason: "Reviewed exact YouTube runway activation",
      youtubeOAuthClientSha256: "6".repeat(64),
      generatedAt: "2026-08-02T09:00:00.000Z",
      ...activationAuthorityOptions(),
    });

    assert.equal(
      receipt.schema_version,
      "pulse-windows-live-guarded-activation-receipt-v2",
    );
    assert.equal(receipt.runtime_instance_id, BOUNDED_RUNTIME_ID);
    assert.equal(receipt.task_name, "PulseGaming-LiveGuarded-YouTube-Runtime");
    assert.equal(
      receipt.task_path,
      "\\PulseGaming-LiveGuarded-YouTube-Runtime",
    );
    assert.match(receipt.task_definition_sha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.authority_fingerprint, /^[a-f0-9]{64}$/);
    assert.equal(receipt.authority_binding.release_sha, expectedCommit);
    assert.equal(
      receipt.authority_binding.database_identity_sha256,
      BOUNDED_DATABASE_SHA,
    );
    assert.equal("task_instance_guid" in receipt, false);
    assert.equal("supervisor_pid" in receipt, false);
    assert.equal("child_pid" in receipt, false);

    const receiptPath = path.join(temp, "activation.json");
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`);
    const exact = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      receiptPath,
      ...activationAuthorityOptions(),
    });
    assert.equal(exact.valid, true);
    assert.equal(exact.runtime_instance_id, BOUNDED_RUNTIME_ID);
    assert.equal(exact.authority_fingerprint, receipt.authority_fingerprint);

    const selfTrusted = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      receiptPath,
    });
    assert.equal(selfTrusted.valid, false);
    assert.ok(
      selfTrusted.blockers.includes(
        "activation_receipt_independent_authority_required",
      ),
    );

    const databaseDrift = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      receiptPath,
      ...activationAuthorityOptions(),
      databaseIdentitySha256: "9".repeat(64),
    });
    assert.equal(databaseDrift.valid, false);
    assert.ok(
      databaseDrift.blockers.includes(
        "activation_receipt_task_authority_invalid",
      ),
    );

    const legacy = {
      ...receipt,
      schema_version: "pulse-windows-live-guarded-activation-receipt-v1",
    };
    legacy.receipt_sha256 = require("node:crypto")
      .createHash("sha256")
      .update("")
      .digest("hex");
    fs.writeFileSync(receiptPath, `${JSON.stringify(legacy)}\n`);
    const rejectedLegacy = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      receiptPath,
      ...activationAuthorityOptions(),
    });
    assert.equal(rejectedLegacy.valid, false);
    assert.ok(
      rejectedLegacy.blockers.includes("activation_receipt_schema_invalid"),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("live database identity survives content writes but rejects replacement and linked files", (t) => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-db-identity-"),
  );
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const databasePath = path.join(temp, "pulse.db");
  fs.writeFileSync(databasePath, "first sqlite bytes\n");

  const original = inspectLiveDatabaseIdentity({ databasePath });
  assert.match(original.database_identity_sha256, /^[a-f0-9]{64}$/);
  assert.equal(original.canonical_real_path.endsWith("/pulse.db"), true);

  fs.appendFileSync(databasePath, "wal checkpoint content change\n");
  const afterWrite = inspectLiveDatabaseIdentity({ databasePath });
  assert.equal(
    afterWrite.database_identity_sha256,
    original.database_identity_sha256,
  );

  const displaced = path.join(temp, "original.db");
  fs.renameSync(databasePath, displaced);
  fs.writeFileSync(databasePath, "replacement sqlite bytes\n");
  const replacement = inspectLiveDatabaseIdentity({ databasePath });
  assert.notEqual(
    replacement.database_identity_sha256,
    original.database_identity_sha256,
  );

  const linked = path.join(temp, "linked.db");
  fs.linkSync(databasePath, linked);
  assert.throws(
    () => inspectLiveDatabaseIdentity({ databasePath }),
    /live_database_identity_link_forbidden/,
  );
});

test("AUTO_PUBLISH cannot enter a child environment without one exact activation receipt bound to commit, profile and migration set", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-live-receipt-"));
  try {
    const migrationsDir = path.join(temp, "migrations");
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(
      path.join(migrationsDir, "001_fixture.sql"),
      "CREATE TABLE fixture (id INTEGER PRIMARY KEY);\n",
      "utf8",
    );
    const profile = loadLiveGuardedRuntimeProfile();
    const expectedCommit = "a".repeat(40);
    const receiptPath = path.join(temp, "activation.json");

    const missing = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      receiptPath,
    });
    assert.equal(missing.valid, false);
    assert.ok(missing.blockers.includes("activation_receipt_missing"));
    assert.throws(
      () =>
        buildLiveChildEnvironment({
          profile,
          expectedCommit,
          activation: missing,
          systemEnvironment: {
            AUTO_PUBLISH: "true",
            YOUTUBE_REFRESH_TOKEN: "must-not-pass-through",
          },
        }),
      /exact_live_activation_receipt_required/,
    );

    assert.throws(
      () =>
        buildLiveActivationReceipt({
          profile,
          expectedCommit,
          migrationsDir,
          operatorId: "operator-42",
          reason: "Reviewed exact YouTube runway activation",
          generatedAt: "2026-07-28T12:00:00.000Z",
          ...activationAuthorityOptions(),
        }),
      /youtube_oauth_client_sha256_required/,
    );
    const expectedOAuthClientSha256 = "6".repeat(64);
    const receipt = buildLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      operatorId: "operator-42",
      reason: "Reviewed exact YouTube runway activation",
      generatedAt: "2026-07-28T12:00:00.000Z",
      youtubeOAuthClientSha256: expectedOAuthClientSha256,
      ...activationAuthorityOptions(),
    });
    assert.deepEqual(receipt.youtube_account_binding, {
      env_key: "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256",
      expected_oauth_client_sha256: expectedOAuthClientSha256,
    });
    fs.writeFileSync(
      receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
      "utf8",
    );
    const activation = inspectLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      receiptPath,
      ...activationAuthorityOptions(),
    });
    assert.equal(activation.valid, true);
    assert.deepEqual(activation.blockers, []);
    assert.equal(
      activation.youtube_oauth_client_sha256,
      expectedOAuthClientSha256,
    );

    const environment = buildLiveChildEnvironment({
      profile,
      expectedCommit,
      activation,
      systemEnvironment: {
        SystemRoot: "C:\\Windows",
        PATH: "C:\\Windows\\System32",
        AUTO_PUBLISH: "false",
        YOUTUBE_REFRESH_TOKEN: "must-not-pass-through",
        PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
      },
    });
    assert.equal(environment.AUTO_PUBLISH, "true");
    assert.equal(environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED, "true");
    assert.equal(environment.PULSE_EMERGENCY_KILL_SWITCH, "false");
    assert.equal(environment.PULSE_KILL_SWITCH, "false");
    assert.equal(environment.PULSE_OPERATING_MODE, "LIVE_GUARDED");
    assert.equal(environment.PULSE_SCHEDULER_PROFILE, "governed_multi_lane");
    assert.equal(environment.YOUTUBE_AUTO_PUBLISH, "true");
    assert.equal(environment.TIKTOK_ENABLED, "false");
    assert.equal(environment.INSTAGRAM_AUTO_PUBLISH, "false");
    assert.equal(environment.YOUTUBE_REFRESH_TOKEN, undefined);
    assert.equal(
      environment.PULSE_YOUTUBE_OAUTH_CLIENT_SHA256,
      expectedOAuthClientSha256,
    );
    assert.equal(
      environment.PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256,
      activation.receipt_sha256,
    );
    assert.equal(
      environment.PULSE_LIVE_RUNTIME_INSTANCE_ID,
      activation.runtime_instance_id,
    );
    assert.equal(
      environment.PULSE_LIVE_AUTHORITY_FINGERPRINT,
      activation.authority_fingerprint,
    );
    for (const malformedActivation of [
      { ...activation, runtime_instance_id: "ri-token-shaped-secret" },
      { ...activation, authority_fingerprint: "not-a-sha256" },
    ]) {
      assert.throws(
        () =>
          buildLiveChildEnvironment({
            profile,
            expectedCommit,
            activation: malformedActivation,
            systemEnvironment: {},
          }),
        /live_activation_runtime_authority_invalid/,
      );
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("activation authority has no silent calendar expiry but every commit, profile, migration or control-policy drift invalidates it", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-receipt-drift-"),
  );
  try {
    const migrationsDir = path.join(temp, "migrations");
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(
      path.join(migrationsDir, "001_fixture.sql"),
      "SELECT 1;\n",
      "utf8",
    );
    const profile = loadLiveGuardedRuntimeProfile();
    const expectedCommit = "b".repeat(40);
    const receiptPath = path.join(temp, "activation.json");
    const original = buildLiveActivationReceipt({
      profile,
      expectedCommit,
      migrationsDir,
      operatorId: "operator-42",
      reason: "Reviewed exact YouTube runway activation",
      generatedAt: "2020-01-01T00:00:00.000Z",
      youtubeOAuthClientSha256: "6".repeat(64),
      ...activationAuthorityOptions(),
    });
    assert.equal(original.expiry.expires_at, null);

    const inspect = (receipt, overrides = {}) => {
      fs.writeFileSync(
        receiptPath,
        `${JSON.stringify(receipt, null, 2)}\n`,
        "utf8",
      );
      return inspectLiveActivationReceipt({
        profile,
        expectedCommit,
        migrationsDir,
        receiptPath,
        ...activationAuthorityOptions(),
        ...overrides,
      });
    };

    assert.equal(inspect(original).valid, true);

    const commitDrift = inspect(original, {
      expectedCommit: "c".repeat(40),
    });
    assert.ok(
      commitDrift.blockers.includes("activation_receipt_commit_mismatch"),
    );

    fs.appendFileSync(
      path.join(migrationsDir, "001_fixture.sql"),
      "-- drift\n",
      "utf8",
    );
    const migrationDrift = inspect(original);
    assert.ok(
      migrationDrift.blockers.includes(
        "activation_receipt_migration_manifest_mismatch",
      ),
    );

    fs.writeFileSync(
      path.join(migrationsDir, "001_fixture.sql"),
      "SELECT 1;\n",
      "utf8",
    );
    const unsafeControl = structuredClone(original);
    unsafeControl.control.fresh_green_required_per_release = false;
    const controlDrift = inspect(unsafeControl);
    assert.ok(
      controlDrift.blockers.includes(
        "activation_receipt_control_policy_invalid",
      ),
    );
    assert.ok(
      controlDrift.blockers.includes("activation_receipt_fingerprint_mismatch"),
    );

    const oauthClientDrift = structuredClone(original);
    oauthClientDrift.youtube_account_binding.expected_oauth_client_sha256 =
      "not-a-sha256";
    const oauthBindingDrift = inspect(oauthClientDrift);
    assert.ok(
      oauthBindingDrift.blockers.includes(
        "activation_receipt_youtube_oauth_client_binding_invalid",
      ),
    );
    assert.ok(
      oauthBindingDrift.blockers.includes(
        "activation_receipt_fingerprint_mismatch",
      ),
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("the live CLI defaults to a machine-readable, non-mutating doctor and rejects accidental lifecycle mutation", () => {
  const commit = String(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
    }),
  ).trim();
  const output = execFileSync(
    process.execPath,
    [TOOL, "--repo-root", ROOT, "--expected-commit", commit],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        YOUTUBE_REFRESH_TOKEN: "must-not-leak-this-value",
      },
    },
  );
  const result = JSON.parse(output);

  assert.equal(
    result.schema_version,
    "pulse-windows-live-guarded-runtime-doctor-v1",
  );
  assert.equal(result.action, "doctor");
  assert.equal(result.production_green, false);
  assert.equal(result.decision.mutation_authorised, false);
  assert.equal(result.execution.executed, false);
  assert.equal(result.target.task_principal, "SYSTEM");
  assert.equal(result.target.task_trigger, "AtStartup");
  assert.doesNotMatch(output, /must-not-leak-this-value/);
});
