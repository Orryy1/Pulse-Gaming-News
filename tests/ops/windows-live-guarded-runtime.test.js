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

const {
  LIVE_LIFECYCLE_CONFIRMATION,
  buildLiveActivationReceipt,
  buildLiveChildEnvironment,
  buildLiveLifecycleDecision,
  buildLiveRuntimeDoctorReport,
  createDefaultLiveLifecycleHandlers,
  buildLiveScheduledTaskXml,
  prepareLiveSupervision,
  inspectLiveActivationReceipt,
  loadLiveGuardedRuntimeProfile,
  executeLiveLifecycleAction,
  validateLiveScheduledTaskXml,
  validateLiveGuardedRuntimeProfile,
  safeLiveHealthIdentity,
  setLiveScheduledTaskEnabled,
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
