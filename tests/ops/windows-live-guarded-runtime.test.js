"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(
  ROOT,
  "tools",
  "windows-live-guarded-runtime.js",
);
const START_OPERATION_NONCE =
  "11111111-1111-4111-8111-111111111111";

function inMemoryStartLock({
  operationNonce = START_OPERATION_NONCE,
  events = [],
} = {}) {
  return {
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
  createDefaultLiveLifecycleHandlers,
  buildLiveScheduledTaskXml,
  prepareLiveSupervision,
  inspectLiveActivationReceipt,
  inspectLiveStartOperationLock,
  inspectLiveTaskConflicts,
  inspectStoppedLiveRuntime,
  loadLiveGuardedRuntimeProfile,
  executeLiveLifecycleAction,
  validateLiveScheduledTaskXml,
  validateLiveGuardedRuntimeProfile,
  safeLiveHealthIdentity,
  releaseLiveStartOperationLock,
  setLiveScheduledTaskEnabled,
  startLiveScheduledTask,
} = require(
  "../../lib/stabilisation/windows-live-guarded-runtime",
);
const {
  loadSafeRuntimeProfile,
  validateSafeRuntimeProfile,
} = require(
  "../../lib/stabilisation/windows-local-runtime-supervisor",
);
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
  assert.equal(
    admitted.checks.start_operation_lock.state,
    "absent",
  );
  assert.equal(admitted.decision.mutation_authorised, true);
  assert.equal(
    admitted.decision.planned_effect,
    "start_verified_runtime",
  );

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
    blocked.decision.blockers.includes(
      "live_supervisor_port_not_free",
    ),
  );
  assert.ok(
    blocked.decision.blockers.includes(
      "live_supervisor_owner_receipt_present",
    ),
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
  assert.equal(
    locked.checks.start_operation_lock.state,
    "active",
  );
  assert.ok(
    locked.decision.blockers.includes(
      "live_start_operation_lock_active",
    ),
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
        blockers: [
          "live_start_operation_stale_recovery_unsafe",
        ],
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
    child_pid: 4200,
    port: profile.port,
    repo_root: ROOT.replace(/\\/g, "/"),
    commit_sha: expectedCommit,
    profile_sha256:
      "508c2b2a5284af6d5784ff245e3e4dca2dd6159bd470fdc11d2737bc76495aaa",
    activation_receipt_sha256: activation.receipt_sha256,
    start_operation_nonce: START_OPERATION_NONCE,
    platform: "youtube",
  };
  const inspect = (owner) =>
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
      processAliveInspector: () => false,
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
    mismatched.blockers.includes(
      "live_supervisor_owner_receipt_mismatch",
    ),
  );
});

test("start operation lock is durable, cross-process exclusive and nonce-owned", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-start-lock-"),
  );
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
    };
    const first = acquireLiveStartOperationLock({
      ...common,
      operationNonce: "11111111-1111-4111-8111-111111111111",
      generatedAt: "2026-07-29T22:00:00.000Z",
    });
    const persisted = JSON.parse(
      fs.readFileSync(first.lock_path, "utf8"),
    );
    assert.equal(
      persisted.operation_nonce,
      "11111111-1111-4111-8111-111111111111",
    );
    assert.equal(persisted.process_id, 4100);
    const inspected = inspectLiveStartOperationLock({
      profile,
      expectedCommit: common.expectedCommit,
      activationReceiptSha256:
        common.activationReceiptSha256,
      runtime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processAliveInspector: () => true,
    });
    assert.equal(inspected.valid, true);
    assert.equal(inspected.clear, false);
    assert.equal(inspected.state, "active");
    assert.equal(
      inspected.operation_nonce,
      first.operation_nonce,
    );
    const unsafeStale = inspectLiveStartOperationLock({
      profile,
      expectedCommit: common.expectedCommit,
      activationReceiptSha256:
        common.activationReceiptSha256,
      runtime: {
        stopped: false,
        listening_pids: [4999],
        owner_state: "active",
      },
      processAliveInspector: () => false,
    });
    assert.equal(unsafeStale.clear, false);
    assert.equal(unsafeStale.state, "stale_recovery_blocked");
    assert.ok(
      unsafeStale.blockers.includes(
        "live_start_operation_stale_recovery_unsafe",
      ),
    );
    const mismatched = inspectLiveStartOperationLock({
      profile,
      expectedCommit: "e".repeat(40),
      activationReceiptSha256:
        common.activationReceiptSha256,
      runtime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processAliveInspector: () => false,
    });
    assert.equal(mismatched.clear, false);
    assert.equal(mismatched.state, "mismatch");
    assert.ok(
      mismatched.blockers.includes(
        "live_start_operation_lock_commit_mismatch",
      ),
    );

    assert.throws(
      () =>
        acquireLiveStartOperationLock({
          ...common,
          operationNonce:
            "22222222-2222-4222-8222-222222222222",
          staleRuntime: {
            stopped: true,
            listening_pids: [],
            owner_state: "absent",
          },
          processAliveInspector: () => true,
        }),
      /live_start_operation_locked/,
    );

    const recovered = acquireLiveStartOperationLock({
      ...common,
      operationNonce:
        "22222222-2222-4222-8222-222222222222",
      staleRuntime: {
        stopped: true,
        listening_pids: [],
        owner_state: "absent",
      },
      processAliveInspector: () => false,
      generatedAt: "2026-07-29T22:00:30.000Z",
    });
    assert.equal(
      recovered.operation_nonce,
      "22222222-2222-4222-8222-222222222222",
    );
    assert.equal(
      fs.existsSync(recovered.recovered_lock_evidence_path),
      true,
    );
    assert.throws(
      () =>
        releaseLiveStartOperationLock({
          lock: {
            ...first,
            operation_nonce:
              "33333333-3333-4333-8333-333333333333",
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
      generatedAt: "2026-07-29T22:00:00.000Z",
    });
    const ownerPath = path.join(
      profile.state_root,
      "supervisor-owner.json",
    );
    fs.writeFileSync(
      ownerPath,
      `${JSON.stringify(
        {
          schema_version: "pulse-windows-live-guarded-owner-v1",
          supervisor_pid: 991001,
          child_pid: 991002,
          port: profile.port,
          repo_root: ROOT.replace(/\\/g, "/"),
          commit_sha: expectedCommit,
          profile_sha256: lock.record.profile_sha256,
          activation_receipt_sha256:
            activation.receipt_sha256,
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
      processAliveInspector: () => false,
      startLockInspector(options) {
        return inspectLiveStartOperationLock({
          ...options,
          processAliveInspector: (pid) =>
            Number(pid) === process.pid,
        });
      },
      generatedAt: "2026-07-29T22:00:30.000Z",
    });

    assert.equal(
      archived.outcome,
      "exact_stale_owner_archived",
    );
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
  assert.equal(
    live.environment.PULSE_SCHEDULER_PROFILE,
    "governed_multi_lane",
  );
  assert.equal(live.environment.PULSE_OPERATING_MODE, "LIVE_GUARDED");
  assert.equal(live.environment.OPERATING_MODE, "LIVE_GUARDED");
  assert.equal(live.environment.AUTO_PUBLISH, "true");
  assert.equal(
    live.environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    "true",
  );
  assert.equal(live.environment.PULSE_EMERGENCY_KILL_SWITCH, "false");
  assert.equal(live.environment.PULSE_KILL_SWITCH, "false");
  assert.equal(live.environment.YOUTUBE_AUTO_PUBLISH, "true");
  assert.equal(live.platform_policy.primary, "youtube");
  assert.equal(live.platform_policy.control_tower_required, true);
  assert.equal(
    live.platform_policy.fresh_control_required_per_release,
    true,
  );
  assert.equal(
    live.platform_policy.oauth_client_sha256_bound_to_activation,
    true,
  );
  assert.equal(
    live.environment.PULSE_YOUTUBE_OAUTH_CLIENT_SHA256,
    undefined,
  );

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
    prepared.runtime_environment
      .PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256,
    activation.receipt_sha256,
  );
  assert.equal(
    prepared.runtime_environment.YOUTUBE_REFRESH_TOKEN,
    undefined,
  );

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
  };
  assert.equal(
    safeLiveHealthIdentity(liveHealth, expectedCommit),
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
    ),
    false,
  );
  assert.equal(
    safeLiveHealthIdentity(
      { ...liveHealth, schedulerActive: false },
      expectedCommit,
    ),
    false,
  );
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
  assert.equal(
    calls[3][1].youtubeOAuthClientSha256,
    "6".repeat(64),
  );
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

test("enable revalidates source, receipt and competing-task state at the mutation boundary and never runs the task", () => {
  const calls = [];
  const taskStates = [
    { state: "managed_disabled", blockers: [] },
    { state: "managed_current", blockers: [] },
  ];
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    blockers: [],
  };
  const result = setLiveScheduledTaskEnabled({
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
      calls.push(["receipt", options]);
      return { outcome: options.details.outcome };
    },
  });

  assert.equal(result.outcome, "enabled_for_next_boot");
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
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    blockers: [],
  };
  const owner = {
    schema_version: "pulse-windows-live-guarded-owner-v1",
    supervisor_pid: 4111,
    child_pid: 4123,
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
  };

  const result = await startLiveScheduledTask({
    ...inMemoryStartLock({ events: calls }),
    profile,
    repoRoot: ROOT,
    expectedCommit,
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
      return { state: "managed_current", blockers: [] };
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
    listenerInspector(options) {
      calls.push(["listeners", options]);
      listenerInspection += 1;
      return listenerInspection <= 2
        ? { available: true, listeningPids: [] }
        : { available: true, listeningPids: [owner.child_pid] };
    },
    healthRequester(options) {
      calls.push(["health", options]);
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
    delayImpl() {
      throw new Error("start verification should not need to wait");
    },
    lifecycleReceiptWriter(options) {
      calls.push(["receipt", options]);
      return { receipt_path: "D:/pulse/evidence/start.json" };
    },
  });

  assert.deepEqual(
    calls.find(([name]) => name === "exec")[1],
    {
      command: "schtasks.exe",
      args: ["/Run", "/TN", profile.task_name],
    },
  );
  assert.equal(result.receipt_path, "D:/pulse/evidence/start.json");
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
  assert.equal(
    receiptCall.details.operation_nonce,
    START_OPERATION_NONCE,
  );
  for (const check of [
    "source_database",
    "activation",
    "conflicts",
    "task",
  ]) {
    assert.equal(
      calls.filter(([name]) => name === check).length,
      2,
      `${check} must be revalidated after launch`,
    );
  }
});

test("mid-flight authority drift prevents started_verified, cleans up its own nonce and emits durable failure evidence", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    blockers: [],
  };
  const driftedActivation = {
    valid: true,
    receipt_sha256: "b".repeat(64),
    blockers: [],
  };
  const owner = {
    schema_version: "pulse-windows-live-guarded-owner-v1",
    supervisor_pid: 4111,
    child_pid: 4123,
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
  assert.equal(
    evidence[0].details.operation_nonce,
    START_OPERATION_NONCE,
  );
  assert.match(
    evidence[0].details.primary_error,
    /post_launch_activation_receipt_drift/,
  );
});

test("an ambiguous schtasks Run error is treated as a launch attempt and cleaned up with durable evidence", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
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
          const error = new Error("scheduled task request timed out");
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
    /scheduled task request timed out/,
  );

  assert.deepEqual(
    mutations.map(({ args }) => args[0]),
    ["/Run", "/End", "/Change"],
  );
  assert.deepEqual(
    operationEvents.map(([event]) => event),
    [
      "lock_acquire",
      "stale_owner_archive",
      "lock_release",
    ],
  );
  assert.equal(taskStates.length, 0);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.stopped_verified, true);
  assert.match(
    evidence[0].details.primary_error,
    /scheduled task request timed out/,
  );
});

test("runtime identity is re-read after authority revalidation before started_verified", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    blockers: [],
  };
  const owner = {
    schema_version: "pulse-windows-live-guarded-owner-v1",
    supervisor_pid: 4111,
    child_pid: 4123,
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
      args: [
        "/Change",
        "/TN",
        profile.task_name,
        "/DISABLE",
      ],
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
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
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
        if (args[0] === "/End" || args[0] === "/Change") {
          throw new Error(`${args[0]} failed`);
        }
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
    ["/Run", "/End", "/Change"],
  );
  assert.equal(evidence.length, 1);
  const failure = evidence[0];
  assert.equal(failure.action, "start-failed");
  assert.equal(failure.details.stopped_verified, false);
  assert.equal(failure.details.cleanup.end_succeeded, false);
  assert.equal(failure.details.cleanup.disable_succeeded, false);
  assert.deepEqual(
    failure.details.cleanup.orphan_listener_pids,
    [owner.child_pid],
  );
  assert.ok(
    failure.details.cleanup.blockers.some((blocker) =>
      blocker.startsWith("start_cleanup_end_failed:"),
    ),
  );
  assert.ok(
    failure.details.cleanup.blockers.some((blocker) =>
      blocker.startsWith("start_cleanup_disable_failed:"),
    ),
  );
  assert.ok(
    failure.details.cleanup.blockers.includes(
      "start_cleanup_orphan_listener",
    ),
  );
});

test("an unexpected cleanup inspection error still produces failure evidence", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
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
          throw new Error("task inspection unavailable");
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
    /live_task_start_fail_closed_incomplete/,
  );

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].action, "start-failed");
  assert.equal(evidence[0].details.stopped_verified, false);
  assert.ok(
    evidence[0].details.cleanup.blockers.some((blocker) =>
      blocker.startsWith("start_cleanup_unhandled_error:"),
    ),
  );
});

test("a failed nonce cannot terminate or disable a different successful start owner", async () => {
  const profile = loadLiveGuardedRuntimeProfile();
  const expectedCommit = "d".repeat(40);
  const activation = {
    valid: true,
    receipt_sha256: "c".repeat(64),
    blockers: [],
  };
  const otherOwner = {
    child_pid: 5123,
    start_operation_nonce:
      "22222222-2222-4222-8222-222222222222",
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
    report.checks.control_policy
      .fresh_green_control_tower_required_per_release,
    true,
  );
  assert.equal(seen.length, 5);
  assert.match(
    seen.find(([name]) => name === "database")[1].migrationsDir,
    /db[\\/]migrations$/,
  );
  assert.doesNotMatch(
    JSON.stringify(report),
    /must-not-leak-this-value/i,
  );

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
    missing.decision.blockers.includes(
      "youtube_oauth_client_sha256_required",
    ),
  );

  const malformed = buildLiveRuntimeDoctorReport({
    ...base,
    youtubeOAuthClientSha256: "not-a-sha256",
  });
  assert.ok(
    malformed.decision.blockers.includes(
      "youtube_oauth_client_sha256_invalid",
    ),
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
    wrongConfirmation.blockers.includes(
      "live_lifecycle_confirmation_required",
    ),
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
  assert.ok(
    unsafeRevoke.blockers.includes(
      "task_absent_or_disabled_required",
    ),
  );

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
    xml.replace("<BootTrigger>", "<LogonTrigger>").replace(
      "</BootTrigger>",
      "</LogonTrigger>",
    ),
    xml.replace("S-1-5-18", "S-1-5-21-1000"),
    xml.replace(
      "</UserId>",
      "</UserId><LogonType>InteractiveToken</LogonType>",
    ),
    xml.replace("HighestAvailable", "LeastPrivilege"),
    xml.replace("<Enabled>false</Enabled>", "<Enabled>true</Enabled>"),
    xml.replace(
      "</Arguments>",
      " --unexpected-extra-action</Arguments>",
    ),
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

test("AUTO_PUBLISH cannot enter a child environment without one exact activation receipt bound to commit, profile and migration set", () => {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-live-receipt-"),
  );
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
    assert.equal(
      environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
      "true",
    );
    assert.equal(environment.PULSE_EMERGENCY_KILL_SWITCH, "false");
    assert.equal(environment.PULSE_KILL_SWITCH, "false");
    assert.equal(environment.PULSE_OPERATING_MODE, "LIVE_GUARDED");
    assert.equal(
      environment.PULSE_SCHEDULER_PROFILE,
      "governed_multi_lane",
    );
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
      controlDrift.blockers.includes(
        "activation_receipt_fingerprint_mismatch",
      ),
    );

    const oauthClientDrift = structuredClone(original);
    oauthClientDrift.youtube_account_binding
      .expected_oauth_client_sha256 = "not-a-sha256";
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
    [
      TOOL,
      "--repo-root",
      ROOT,
      "--expected-commit",
      commit,
    ],
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
