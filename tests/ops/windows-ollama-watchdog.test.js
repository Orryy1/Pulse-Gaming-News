"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  WATCHDOG_TASK_INSTALL_CONFIRMATION,
  buildWatchdogScheduledTaskXml,
  buildWatchdogScheduledTaskPlan,
  inspectOllamaListeners,
  inspectWatchdogScheduledTask,
  installWatchdogScheduledTask,
  requestOllamaTags,
  resolveWatchdogTaskBindings,
  resolveInstalledOllamaExecutable,
  runOllamaWatchdog,
  validateWatchdogScheduledTaskXml,
} = require("../../lib/stabilisation/windows-ollama-watchdog");

function createProfile(stateRoot) {
  return {
    state_root: stateRoot,
    environment: {
      PULSE_OLLAMA_BASE_URL: "http://127.0.0.1:11434",
      PULSE_OLLAMA_MODEL: "qwen3.5:27b",
    },
  };
}

test("a healthy exact-loopback Ollama with the required model is left untouched", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-"),
  );
  let spawnCount = 0;
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:00:00.000Z",
      listenerInspector: () => ({
        available: true,
        listeners: [
          {
            local_address: "127.0.0.1",
            local_port: 11434,
            owning_process: 4567,
          },
        ],
      }),
      probeImpl: async () => ({
        reachable: true,
        status_code: 200,
        valid_json: true,
        model_present: true,
        failure_code: null,
      }),
      spawnImpl: () => {
        spawnCount += 1;
        throw new Error("healthy Ollama must not be started again");
      },
    });

    assert.equal(report.ready, true);
    assert.equal(report.outcome, "healthy_no_action");
    assert.equal(report.action.spawn_attempted, false);
    assert.equal(spawnCount, 0);
    assert.equal(
      JSON.parse(
        fs.readFileSync(
          path.join(stateRoot, "ollama-watchdog", "status.json"),
          "utf8",
        ),
      ).outcome,
      "healthy_no_action",
    );
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("an absent listener starts only the resolved installed Ollama executable with hidden detached semantics", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-start-"),
  );
  const expectedExecutable =
    "C:\\Users\\MORR\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
  let spawnRequest = null;
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:01:00.000Z",
      listenerInspector: () => ({
        available: true,
        listeners: [],
      }),
      probeImpl: async () => ({
        reachable: false,
        status_code: null,
        valid_json: false,
        model_present: false,
        failure_code: "connection_failed",
      }),
      executableResolver: () => expectedExecutable,
      spawnImpl: (executable, args, options) => {
        spawnRequest = { executable, args, options };
        return {
          pid: 7654,
          unref() {},
        };
      },
      readinessWaiter: async () => ({
        ready: true,
        probe: {
          reachable: true,
          status_code: 200,
          valid_json: true,
          model_present: true,
          failure_code: null,
        },
        listener: {
          inspection_available: true,
          count: 1,
          exact_loopback_only: true,
        },
      }),
      systemEnvironment: {
        SystemRoot: "C:\\Windows",
        USERPROFILE: "C:\\Users\\MORR",
        LOCALAPPDATA: "C:\\Users\\MORR\\AppData\\Local",
        GOOGLE_API_KEY: "must-not-be-inherited",
      },
    });

    assert.equal(report.ready, true);
    assert.equal(report.outcome, "started_and_ready");
    assert.equal(report.action.spawn_attempted, true);
    assert.equal(report.action.started_pid, 7654);
    assert.equal(spawnRequest.executable, expectedExecutable);
    assert.deepEqual(spawnRequest.args, ["serve"]);
    assert.equal(spawnRequest.options.shell, false);
    assert.equal(spawnRequest.options.detached, true);
    assert.equal(spawnRequest.options.windowsHide, true);
    assert.equal(spawnRequest.options.stdio, "ignore");
    assert.equal(
      spawnRequest.options.env.OLLAMA_HOST,
      "127.0.0.1:11434",
    );
    assert.equal(spawnRequest.options.env.GOOGLE_API_KEY, undefined);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("an existing listener without the required model is never replaced or restarted", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-existing-"),
  );
  let spawnCount = 0;
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:02:00.000Z",
      listenerInspector: () => ({
        available: true,
        listeners: [
          {
            local_address: "127.0.0.1",
            local_port: 11434,
            owning_process: 9999,
          },
        ],
      }),
      probeImpl: async () => ({
        reachable: true,
        status_code: 200,
        valid_json: true,
        model_present: false,
        failure_code: "required_model_missing",
      }),
      spawnImpl: () => {
        spawnCount += 1;
        throw new Error("existing listener must never be replaced");
      },
    });

    assert.equal(report.ready, false);
    assert.equal(report.outcome, "blocked_existing_listener");
    assert.equal(report.action.spawn_attempted, false);
    assert.equal(spawnCount, 0);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("a wildcard or non-loopback listener is blocked even when its API response looks healthy", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-binding-"),
  );
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:03:00.000Z",
      listenerInspector: () => ({
        available: true,
        listeners: [
          {
            local_address: "0.0.0.0",
            local_port: 11434,
            owning_process: 8888,
          },
        ],
      }),
      probeImpl: async () => ({
        reachable: true,
        status_code: 200,
        valid_json: true,
        model_present: true,
        failure_code: null,
      }),
      spawnImpl: () => {
        throw new Error("unsafe listener must not trigger another process");
      },
    });

    assert.equal(report.ready, false);
    assert.equal(report.outcome, "blocked_unsafe_listener_binding");
    assert.equal(report.listener.exact_loopback_only, false);
    assert.equal(report.action.spawn_attempted, false);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("the model probe can contact only the fixed loopback tags endpoint and requires the exact model name", async () => {
  let requestOptions = null;
  const requestImpl = (options, onResponse) => {
    requestOptions = options;
    const request = new EventEmitter();
    request.setTimeout = (_timeout, callback) => {
      request.timeoutCallback = callback;
    };
    request.destroy = () => {};
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = { "content-type": "application/json" };
      response.setEncoding = () => {};
      onResponse(response);
      response.emit(
        "data",
        JSON.stringify({
          models: [
            { name: "qwen3.5:27b", model: "qwen3.5:27b" },
            { name: "gemma3:12b", model: "gemma3:12b" },
          ],
        }),
      );
      response.emit("end");
    };
    return request;
  };

  const result = await requestOllamaTags({ requestImpl });

  assert.deepEqual(requestOptions, {
    protocol: "http:",
    hostname: "127.0.0.1",
    port: 11434,
    method: "GET",
    path: "/api/tags",
    agent: false,
    headers: {
      Accept: "application/json",
      Connection: "close",
    },
  });
  assert.equal(result.reachable, true);
  assert.equal(result.status_code, 200);
  assert.equal(result.valid_json, true);
  assert.equal(result.model_present, true);
  assert.equal(result.failure_code, null);
});

test("listener inspection uses a bounded no-shell Windows query for only port 11434", () => {
  let invocation = null;
  const report = inspectOllamaListeners({
    platform: "win32",
    execFileSyncImpl: (executable, args, options) => {
      invocation = { executable, args, options };
      return JSON.stringify([
        {
          LocalAddress: "127.0.0.1",
          LocalPort: 11434,
          OwningProcess: 4321,
        },
      ]);
    },
  });

  assert.equal(invocation.executable, "powershell.exe");
  assert.ok(invocation.args.includes("-NonInteractive"));
  assert.ok(invocation.args.includes("-Command"));
  assert.match(invocation.args.at(-1), /LocalPort 11434\b/);
  assert.equal(invocation.options.shell, false);
  assert.ok(invocation.options.timeout <= 5000);
  assert.deepEqual(report, {
    available: true,
    listeners: [
      {
        local_address: "127.0.0.1",
        local_port: 11434,
        owning_process: 4321,
      },
    ],
  });
});

test("executable resolution accepts only the canonical per-user Ollama installation", () => {
  const expected =
    "C:\\Users\\MORR\\AppData\\Local\\Programs\\Ollama\\ollama.exe";
  const fsImpl = {
    existsSync: (candidate) => candidate === expected,
    statSync: () => ({ isFile: () => true }),
  };

  assert.equal(
    resolveInstalledOllamaExecutable({
      platform: "win32",
      systemEnvironment: {
        LOCALAPPDATA: "C:\\Users\\MORR\\AppData\\Local",
      },
      fsImpl,
      realpathImpl: () => expected,
    }),
    expected,
  );

  assert.throws(
    () =>
      resolveInstalledOllamaExecutable({
        platform: "win32",
        systemEnvironment: {
          LOCALAPPDATA: "C:\\Users\\MORR\\AppData\\Local",
        },
        fsImpl,
        realpathImpl: () => "C:\\Temp\\replacement.exe",
      }),
    /ollama_executable_not_canonical/,
  );
  assert.throws(
    () =>
      resolveInstalledOllamaExecutable({
        platform: "linux",
        systemEnvironment: {
          LOCALAPPDATA: "C:\\Users\\MORR\\AppData\\Local",
        },
        fsImpl,
        realpathImpl: () => expected,
      }),
    /windows_host_required/,
  );
});

test("a stale lock owned by a dead process is quarantined so watchdog recovery can continue after a crash or reboot", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-stale-lock-"),
  );
  const watchdogRoot = path.join(stateRoot, "ollama-watchdog");
  fs.mkdirSync(watchdogRoot, { recursive: true });
  fs.writeFileSync(
    path.join(watchdogRoot, "watchdog.lock"),
    `${JSON.stringify({
      schema_version: "pulse-windows-ollama-watchdog-lock-v1",
      pid: 2222,
      acquired_at: "2026-07-28T08:00:00.000Z",
      nonce: "stale-public-nonce",
    })}\n`,
    "utf8",
  );
  let boundaryCalls = 0;
  try {
    const report = await runOllamaWatchdog({
      mode: "status",
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:04:00.000Z",
      processAlive: (pid) => {
        assert.equal(pid, 2222);
        return false;
      },
      listenerInspector: () => {
        boundaryCalls += 1;
        return { available: true, listeners: [] };
      },
      probeImpl: async () => {
        boundaryCalls += 1;
        return {
          reachable: false,
          status_code: null,
          valid_json: false,
          model_present: false,
          failure_code: "connection_failed",
        };
      },
    });

    assert.equal(report.outcome, "status_unavailable");
    assert.equal(boundaryCalls, 2);
    assert.equal(
      fs.existsSync(path.join(watchdogRoot, "watchdog.lock")),
      false,
    );
    const recoveredLocks = fs.readdirSync(
      path.join(watchdogRoot, "stale-locks"),
    );
    assert.equal(recoveredLocks.length, 1);
    const recovery = JSON.parse(
      fs.readFileSync(
        path.join(watchdogRoot, "stale-locks", recoveredLocks[0]),
        "utf8",
      ),
    );
    assert.deepEqual(recovery, {
      schema_version: "pulse-windows-ollama-watchdog-stale-lock-v1",
      recovered_at: "2026-07-28T09:04:00.000Z",
      prior_pid: 2222,
      prior_acquired_at: "2026-07-28T08:00:00.000Z",
      reason: "owner_not_running_after_stale_threshold",
    });
    assert.doesNotMatch(
      JSON.stringify(recovery),
      /stale-public-nonce|API_KEY/,
    );
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("an old lock is never recovered while its exact owner process is still running", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-live-lock-"),
  );
  const watchdogRoot = path.join(stateRoot, "ollama-watchdog");
  const lockPath = path.join(watchdogRoot, "watchdog.lock");
  fs.mkdirSync(watchdogRoot, { recursive: true });
  fs.writeFileSync(
    lockPath,
    `${JSON.stringify({
      schema_version: "pulse-windows-ollama-watchdog-lock-v1",
      pid: 3333,
      acquired_at: "2026-07-28T08:00:00.000Z",
      nonce: "live-public-nonce",
    })}\n`,
    "utf8",
  );
  let processChecks = 0;
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:04:00.000Z",
      processAlive: (pid) => {
        processChecks += 1;
        assert.equal(pid, 3333);
        return true;
      },
      listenerInspector: () => {
        throw new Error("a live lock must prevent boundary calls");
      },
    });

    assert.equal(report.outcome, "lock_busy");
    assert.equal(processChecks, 1);
    assert.equal(fs.existsSync(lockPath), true);
    assert.equal(
      fs.existsSync(path.join(watchdogRoot, "stale-locks")),
      false,
    );
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("a concurrent watchdog lock makes the run a secret-free no-op", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-lock-"),
  );
  const watchdogRoot = path.join(stateRoot, "ollama-watchdog");
  fs.mkdirSync(watchdogRoot, { recursive: true });
  fs.writeFileSync(
    path.join(watchdogRoot, "watchdog.lock"),
    `${JSON.stringify({
      schema_version: "pulse-windows-ollama-watchdog-lock-v1",
      pid: 2222,
      acquired_at: "2026-07-28T09:03:30.000Z",
      nonce: "public-nonce",
    })}\n`,
    "utf8",
  );
  let boundaryCalls = 0;
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:04:00.000Z",
      listenerInspector: () => {
        boundaryCalls += 1;
        throw new Error("lock must prevent inspection");
      },
      probeImpl: async () => {
        boundaryCalls += 1;
        throw new Error("lock must prevent probing");
      },
      spawnImpl: () => {
        boundaryCalls += 1;
        throw new Error("lock must prevent spawning");
      },
    });

    assert.equal(report.ready, false);
    assert.equal(report.outcome, "lock_busy");
    assert.equal(report.action.spawn_attempted, false);
    assert.equal(boundaryCalls, 0);
    assert.doesNotMatch(JSON.stringify(report), /public-nonce|GOOGLE_API_KEY/);
    const contentionFiles = fs.readdirSync(
      path.join(watchdogRoot, "contention"),
    );
    assert.equal(contentionFiles.length, 1);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("status mode never starts Ollama when the listener is absent", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-status-"),
  );
  let spawnCount = 0;
  try {
    const report = await runOllamaWatchdog({
      mode: "status",
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:05:00.000Z",
      listenerInspector: () => ({
        available: true,
        listeners: [],
      }),
      probeImpl: async () => ({
        reachable: false,
        status_code: null,
        valid_json: false,
        model_present: false,
        failure_code: "connection_failed",
      }),
      spawnImpl: () => {
        spawnCount += 1;
        throw new Error("status mode must not start a process");
      },
    });

    assert.equal(report.ready, false);
    assert.equal(report.outcome, "status_unavailable");
    assert.equal(report.action.spawn_attempted, false);
    assert.equal(spawnCount, 0);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("a missing exact executable fails closed and still emits a sanitised status artefact", async () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-watchdog-missing-"),
  );
  try {
    const report = await runOllamaWatchdog({
      profile: createProfile(stateRoot),
      generatedAt: "2026-07-28T09:06:00.000Z",
      listenerInspector: () => ({
        available: true,
        listeners: [],
      }),
      probeImpl: async () => ({
        reachable: false,
        status_code: null,
        valid_json: false,
        model_present: false,
        failure_code: "connection_failed",
      }),
      executableResolver: () => {
        throw new Error("ollama_executable_missing");
      },
      spawnImpl: () => {
        throw new Error("must not spawn without exact executable");
      },
    });

    assert.equal(report.ready, false);
    assert.equal(report.outcome, "blocked_start_preflight");
    assert.equal(
      report.probe.failure_code,
      "ollama_executable_missing",
    );
    assert.equal(report.action.spawn_attempted, false);
    const status = fs.readFileSync(
      path.join(stateRoot, "ollama-watchdog", "status.json"),
      "utf8",
    );
    assert.doesNotMatch(status, /Users|LOCALAPPDATA|API_KEY|TOKEN/i);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("the non-mutating plan provides an exact one-minute least-privilege task action", () => {
  const plan = buildWatchdogScheduledTaskPlan({
    repoRoot: "C:\\Pulse\\runtime\\pulse-v1",
    nodeExecutable: "C:\\Program Files\\nodejs\\node.exe",
  });

  assert.equal(plan.install_performed, false);
  assert.equal(plan.mutation_authorised, false);
  assert.equal(plan.task_name, "PulseGaming-Ollama-Watchdog");
  assert.equal(plan.cadence, "PT1M");
  assert.equal(plan.multiple_instances, "IgnoreNew");
  assert.equal(plan.run_level, "LeastPrivilege");
  assert.equal(plan.network_scope, "127.0.0.1:11434");
  assert.match(
    plan.command,
    /^"C:\\Program Files\\nodejs\\node\.exe" /,
  );
  assert.match(plan.command, /windows-ollama-watchdog\.js" ensure\b/);
  assert.match(plan.command, /--profile governed_multi_lane\b/);
  assert.doesNotMatch(plan.command, /powershell|cmd\.exe|API_KEY|TOKEN/i);
});

test("scheduled-task bindings accept only canonical node.exe and the exact repo-root watchdog tool", () => {
  const repoRoot = "C:\\Pulse\\runtime\\pulse-v1";
  const nodeExecutable = "C:\\Program Files\\nodejs\\node.exe";
  const toolPath =
    "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js";
  const fsImpl = {
    existsSync: (candidate) =>
      [repoRoot, nodeExecutable, toolPath].includes(candidate),
    statSync: (candidate) => ({
      isDirectory: () => candidate === repoRoot,
      isFile: () => candidate !== repoRoot,
    }),
  };
  const bindings = resolveWatchdogTaskBindings({
    repoRoot,
    nodeExecutable,
    platform: "win32",
    fsImpl,
    realpathImpl: (candidate) => candidate,
  });

  assert.deepEqual(bindings, {
    repo_root: repoRoot,
    node_executable: nodeExecutable,
    tool_path: toolPath,
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  });
  assert.throws(
    () =>
      resolveWatchdogTaskBindings({
        repoRoot,
        nodeExecutable: "C:\\Program Files\\nodejs\\node-copy.exe",
        platform: "win32",
        fsImpl,
        realpathImpl: (candidate) => candidate,
      }),
    /canonical_node_executable_required/,
  );
  assert.throws(
    () =>
      resolveWatchdogTaskBindings({
        repoRoot,
        nodeExecutable,
        platform: "win32",
        fsImpl,
        realpathImpl: (candidate) =>
          candidate === toolPath
            ? "C:\\Temp\\windows-ollama-watchdog.js"
            : candidate,
      }),
    /watchdog_tool_not_canonical/,
  );
});

test("the watchdog task XML is hidden, non-overlapping, least-privilege and triggered every minute plus user logon", () => {
  const xml = buildWatchdogScheduledTaskXml({
    bindings: {
      repo_root: "C:\\Pulse\\runtime\\pulse-v1",
      node_executable: "C:\\Program Files\\nodejs\\node.exe",
      tool_path:
        "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
      arguments:
        '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
    },
    currentUserSid: "S-1-5-21-111-222-333-1001",
    generatedAt: "2026-07-28T10:00:00.000Z",
  });

  assert.equal((xml.match(/<LogonTrigger>/g) || []).length, 1);
  assert.equal((xml.match(/<TimeTrigger>/g) || []).length, 1);
  assert.match(xml, /<Interval>PT1M<\/Interval>/);
  assert.match(xml, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<Hidden>true<\/Hidden>/);
  assert.match(xml, /<ExecutionTimeLimit>PT1M<\/ExecutionTimeLimit>/);
  assert.match(
    xml,
    /<Command>C:\\Program Files\\nodejs\\node\.exe<\/Command>/,
  );
  assert.match(
    xml,
    /<Arguments>&quot;C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog\.js&quot; ensure --profile governed_multi_lane<\/Arguments>/,
  );
  assert.match(
    xml,
    /<WorkingDirectory>C:\\Pulse\\runtime\\pulse-v1<\/WorkingDirectory>/,
  );
  assert.doesNotMatch(
    xml,
    /SYSTEM|HighestAvailable|powershell|cmd\.exe|OAuth|AUTO_PUBLISH|ACCESS_TOKEN|API_TOKEN|API_KEY/i,
  );
});

test("the scheduled-task inspector contract accepts only the exact generated task identity", () => {
  const bindings = {
    repo_root: "C:\\Pulse\\runtime\\pulse-v1",
    node_executable: "C:\\Program Files\\nodejs\\node.exe",
    tool_path:
      "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  };
  const currentUserSid = "S-1-5-21-111-222-333-1001";
  const xml = buildWatchdogScheduledTaskXml({
    bindings,
    currentUserSid,
    generatedAt: "2026-07-28T10:00:00.000Z",
  });

  assert.deepEqual(
    validateWatchdogScheduledTaskXml({
      xml,
      bindings,
      currentUserSid,
      currentUserAccountName: "PULSE\\operator",
    }),
    {
      valid: true,
      enabled: true,
      blockers: [],
    },
  );
});

test("the inspector accepts Windows-omitted safe defaults without accepting explicit disabled or elevated values", () => {
  const bindings = {
    repo_root: "C:\\Pulse\\runtime\\pulse-v1",
    node_executable: "C:\\Program Files\\nodejs\\node.exe",
    tool_path:
      "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  };
  const currentUserSid = "S-1-5-21-111-222-333-1001";
  const xml = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "fixtures",
      "windows-ollama-watchdog-normalised.xml",
    ),
    "utf8",
  );
  const inspect = (taskXml) =>
    inspectWatchdogScheduledTask({
      bindings,
      currentUserSid,
      currentUserAccountName: "PULSE\\operator",
      platform: "win32",
      execFileSyncImpl: () => taskXml,
    });

  const normalised = inspect(xml);
  assert.equal(normalised.state, "managed_current");
  assert.equal(normalised.enabled, true);
  assert.deepEqual(normalised.blockers, []);

  const explicitlyDisabled = inspect(
    xml.replace("<Settings>", "<Settings><Enabled>false</Enabled>"),
  );
  assert.equal(explicitlyDisabled.state, "managed_disabled");
  assert.equal(explicitlyDisabled.enabled, false);

  const explicitlyElevated = inspect(
    xml.replace(
      "<LogonType>InteractiveToken</LogonType>",
      "<LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel>",
    ),
  );
  assert.equal(explicitlyElevated.state, "foreign");
  assert.ok(
    explicitlyElevated.blockers.includes("task_run_level_invalid"),
    explicitlyElevated.blockers.join(","),
  );
});

test("task validation rejects privilege, identity, overlap, visibility or action authority expansion", () => {
  const bindings = {
    repo_root: "C:\\Pulse\\runtime\\pulse-v1",
    node_executable: "C:\\Program Files\\nodejs\\node.exe",
    tool_path:
      "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  };
  const currentUserSid = "S-1-5-21-111-222-333-1001";
  const xml = buildWatchdogScheduledTaskXml({
    bindings,
    currentUserSid,
    generatedAt: "2026-07-28T10:00:00.000Z",
  });
  const mutations = [
    [
      xml.replace("LeastPrivilege", "HighestAvailable"),
      "task_run_level_invalid",
    ],
    [
      xml.replaceAll(currentUserSid, "S-1-5-18"),
      "task_principal_user_invalid",
    ],
    [
      xml.replace("IgnoreNew", "Parallel"),
      "task_overlap_policy_invalid",
    ],
    [
      xml.replace("<Hidden>true</Hidden>", "<Hidden>false</Hidden>"),
      "task_hidden_policy_invalid",
    ],
    [
      xml.replace(
        " ensure --profile governed_multi_lane",
        " ensure --profile governed_multi_lane --publish",
      ),
      "task_arguments_identity_invalid",
    ],
  ];

  for (const [unsafeXml, expectedBlocker] of mutations) {
    const validation = validateWatchdogScheduledTaskXml({
      xml: unsafeXml,
      bindings,
      currentUserSid,
      currentUserAccountName: "PULSE\\operator",
    });
    assert.equal(validation.valid, false);
    assert.ok(
      validation.blockers.includes(expectedBlocker),
      `${expectedBlocker} should block: ${validation.blockers.join(",")}`,
    );
  }
});

test("scheduled-task inspection uses a bounded hidden no-shell query and returns only sanitised identity evidence", () => {
  const bindings = {
    repo_root: "C:\\Pulse\\runtime\\pulse-v1",
    node_executable: "C:\\Program Files\\nodejs\\node.exe",
    tool_path:
      "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  };
  const currentUserSid = "S-1-5-21-111-222-333-1001";
  const xml = buildWatchdogScheduledTaskXml({
    bindings,
    currentUserSid,
    generatedAt: "2026-07-28T10:00:00.000Z",
  });
  let invocation = null;

  const report = inspectWatchdogScheduledTask({
    bindings,
    currentUserSid,
    currentUserAccountName: "PULSE\\operator",
    platform: "win32",
    execFileSyncImpl: (executable, args, options) => {
      invocation = { executable, args, options };
      return xml;
    },
  });

  assert.deepEqual(invocation.args, [
    "/Query",
    "/TN",
    "PulseGaming-Ollama-Watchdog",
    "/XML",
  ]);
  assert.equal(invocation.executable, "schtasks.exe");
  assert.equal(invocation.options.shell, false);
  assert.equal(invocation.options.windowsHide, true);
  assert.ok(invocation.options.timeout <= 5000);
  assert.equal(report.state, "managed_current");
  assert.equal(report.enabled, true);
  assert.match(report.action_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.blockers, []);
  assert.doesNotMatch(
    JSON.stringify(report),
    /S-1-5|PULSE\\operator|Program Files|runtime\\pulse-v1|<Task|API_KEY|TOKEN/i,
  );
});

test("watchdog task installation is a persisted sanitised dry-run by default", () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-task-install-dry-run-"),
  );
  const bindings = {
    repo_root: "C:\\Pulse\\runtime\\pulse-v1",
    node_executable: "C:\\Program Files\\nodejs\\node.exe",
    tool_path:
      "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  };
  let createCalls = 0;
  try {
    const report = installWatchdogScheduledTask({
      repoRoot: bindings.repo_root,
      nodeExecutable: bindings.node_executable,
      stateRoot,
      generatedAt: "2026-07-28T10:10:00.000Z",
      platform: "win32",
      currentUserSid: "S-1-5-21-111-222-333-1001",
      currentUserAccountName: "PULSE\\operator",
      bindingResolver: () => bindings,
      inspectionImpl: () => ({
        state: "absent",
        task_name: "PulseGaming-Ollama-Watchdog",
        enabled: null,
        action_sha256: "a".repeat(64),
        blockers: [],
      }),
      execFileSyncImpl: () => {
        createCalls += 1;
        throw new Error("dry-run must not call schtasks create");
      },
    });

    assert.equal(report.dry_run, true);
    assert.equal(report.apply_requested, false);
    assert.equal(report.mutation_authorised, false);
    assert.equal(report.install_performed, false);
    assert.equal(report.state_before, "absent");
    assert.equal(report.planned_effect, "create_exact_managed_task");
    assert.deepEqual(report.authority, {
      scheduled_task_install: false,
      oauth_mutation: false,
      external_publishing: false,
      database_mutation: false,
    });
    assert.equal(createCalls, 0);
    assert.equal(report.evidence_file.endsWith(".json"), true);
    const evidencePath = path.join(
      stateRoot,
      "ollama-watchdog",
      "task-evidence",
      report.evidence_file,
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(evidencePath, "utf8")),
      report,
    );
    assert.doesNotMatch(
      JSON.stringify(report),
      /S-1-5|PULSE\\operator|Program Files|runtime\\pulse-v1|API_KEY|ACCESS_TOKEN/i,
    );
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});

test("explicitly confirmed installation creates without force and verifies the exact managed task", () => {
  const stateRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-ollama-task-install-apply-"),
  );
  const bindings = {
    repo_root: "C:\\Pulse\\runtime\\pulse-v1",
    node_executable: "C:\\Program Files\\nodejs\\node.exe",
    tool_path:
      "C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js",
    arguments:
      '"C:\\Pulse\\runtime\\pulse-v1\\tools\\windows-ollama-watchdog.js" ensure --profile governed_multi_lane',
  };
  let inspections = 0;
  let createInvocation = null;
  let temporaryXmlPath = null;
  try {
    const report = installWatchdogScheduledTask({
      repoRoot: bindings.repo_root,
      nodeExecutable: bindings.node_executable,
      stateRoot,
      apply: true,
      confirmation: WATCHDOG_TASK_INSTALL_CONFIRMATION,
      generatedAt: "2026-07-28T10:11:00.000Z",
      platform: "win32",
      currentUserSid: "S-1-5-21-111-222-333-1001",
      currentUserAccountName: "PULSE\\operator",
      bindingResolver: () => bindings,
      inspectionImpl: () => {
        inspections += 1;
        return {
          state: inspections === 1 ? "absent" : "managed_current",
          task_name: "PulseGaming-Ollama-Watchdog",
          enabled: inspections === 1 ? null : true,
          action_sha256: "a".repeat(64),
          blockers: [],
        };
      },
      execFileSyncImpl: (executable, args, options) => {
        createInvocation = { executable, args, options };
        temporaryXmlPath = args.at(-1);
        const bytes = fs.readFileSync(temporaryXmlPath);
        assert.deepEqual([...bytes.subarray(0, 2)], [0xff, 0xfe]);
        assert.match(bytes.subarray(2).toString("utf16le"), /<Hidden>true<\/Hidden>/);
        return "SUCCESS";
      },
    });

    assert.equal(createInvocation.executable, "schtasks.exe");
    assert.deepEqual(createInvocation.args.slice(0, 4), [
      "/Create",
      "/TN",
      "PulseGaming-Ollama-Watchdog",
      "/XML",
    ]);
    assert.equal(createInvocation.args.includes("/F"), false);
    assert.equal(createInvocation.options.shell, false);
    assert.equal(createInvocation.options.windowsHide, true);
    assert.ok(createInvocation.options.timeout <= 15000);
    assert.equal(fs.existsSync(temporaryXmlPath), false);
    assert.equal(inspections, 2);
    assert.equal(report.install_performed, true);
    assert.equal(report.mutation_authorised, true);
    assert.equal(report.state_after, "managed_current");
    assert.equal(report.authority.scheduled_task_install, true);
  } finally {
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
});
