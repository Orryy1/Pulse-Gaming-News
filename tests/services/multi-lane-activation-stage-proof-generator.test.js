"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const {
  INDEX_SCHEMA,
  STAGE_PROOF_SCHEMA,
  STAGE_REQUIREMENTS,
  collectMultiLaneActivationEvidence,
} = require("../../lib/services/multi-lane-activation-evidence-collector");
const {
  ACTIVATION_STAGE_ALLOWLIST,
  HARNESS_FILES,
  buildLocalProofTestEnvironment,
  buildNodeTestInvocation,
  generateMultiLaneActivationStageProofs,
  parseNodeTestTap,
} = require("../../lib/services/multi-lane-activation-stage-proof-generator");

const NOW = "2026-07-28T12:00:00.000Z";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixtureRepository(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-activation-generator-repo-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configuredFiles = new Set(HARNESS_FILES);
  for (const configuration of Object.values(ACTIVATION_STAGE_ALLOWLIST)) {
    for (const file of [
      ...configuration.production_files,
      ...configuration.test_files,
    ]) {
      configuredFiles.add(file);
    }
  }
  for (const relativePath of configuredFiles) {
    const filePath = path.join(root, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `"use strict";\n// ${relativePath}\nmodule.exports = {};\n`,
      "utf8",
    );
  }
  return {
    root,
    output: path.join(root, "proof-output"),
  };
}

function passingRunner() {
  return ({ testFiles }) => ({
    exit_code: 0,
    passed: Math.max(8, testFiles.length),
    failed: 0,
  });
}

function readyRuntime() {
  return {
    schema_version: "pulse-weekly-longform-runtime-capabilities-v1",
    generated_at: NOW,
    ready: true,
    blockers: [],
    dependencies: Object.fromEntries(
      [
        "produceNarration",
        "materializeAlignment",
        "renderLongform",
        "materializeVariants",
        "runDecodedQa",
        "materializeDerivatives",
      ].map((dependency) => [dependency, { available: true }]),
    ),
    safety: {
      implicit_network_enabled: false,
      implicit_process_spawn_enabled: false,
      upload_authority: false,
      oauth_mutation_authority: false,
      database_mutation_authority: false,
    },
  };
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.writeFileSync(filePath, bytes);
  return { path: filePath, sha256: sha256(bytes) };
}

test("allowlist covers exactly every lane-stage contract and binds production plus test sources", () => {
  const expectedKeys = Object.entries(STAGE_REQUIREMENTS).flatMap(
    ([laneId, stages]) =>
      Object.keys(stages).map((stage) => `${laneId}:${stage}`),
  );
  assert.equal(expectedKeys.length, 12);
  assert.deepEqual(
    Object.keys(ACTIVATION_STAGE_ALLOWLIST).sort(),
    expectedKeys.sort(),
  );
  for (const [key, configuration] of Object.entries(
    ACTIVATION_STAGE_ALLOWLIST,
  )) {
    const [laneId, stage] = key.split(":");
    assert.deepEqual(
      [...configuration.checks].sort(),
      [...STAGE_REQUIREMENTS[laneId][stage]].sort(),
    );
    assert.ok(configuration.production_files.length > 0);
    assert.ok(configuration.test_files.length > 0);
    assert.ok(
      configuration.production_files.every((file) =>
        file.startsWith("lib/"),
      ),
    );
    assert.ok(
      configuration.test_files.every((file) =>
        /^(?:tests\/services|tests\/db)\//.test(file),
      ),
    );
    assert.equal(Object.isFrozen(configuration), true);
  }
  const evergreenProduction =
    ACTIVATION_STAGE_ALLOWLIST["evergreen_short:production"];
  assert.deepEqual(evergreenProduction.unsupported_checks, []);
  assert.ok(
    evergreenProduction.production_files.includes(
      "lib/services/evergreen-verdict-production-runner.js",
    ),
  );
  assert.ok(
    evergreenProduction.production_files.includes(
      "lib/services/evergreen-verdict-production-runtime.js",
    ),
  );
  assert.ok(
    evergreenProduction.test_files.includes(
      "tests/services/evergreen-verdict-production-runner.test.js",
    ),
  );
});

test("generator writes 12 immutable passing stage proofs while marking absent runtime truthfully unavailable", (t) => {
  const fixture = fixtureRepository(t);
  const result = generateMultiLaneActivationStageProofs({
    repository_root: fixture.root,
    output_dir: fixture.output,
    generated_at: NOW,
    run_test_command: passingRunner(),
  });

  assert.equal(result.stage_proofs.length, 12);
  assert.equal(result.all_stage_tests_passed, true);
  assert.equal(result.all_stage_checks_proven, true);
  assert.equal(result.runtime_capabilities.availability, "UNAVAILABLE");
  assert.equal(result.runtime_capabilities.ready, false);
  assert.equal(result.verdict, "BLOCKED");
  assert.equal(result.index.schema_version, INDEX_SCHEMA);
  assert.equal(result.index.artifacts.length, 13);
  assert.ok(fs.existsSync(result.index_path));
  for (const stage of result.stage_proofs) {
    const proof = JSON.parse(fs.readFileSync(stage.path, "utf8"));
    assert.equal(proof.schema_version, STAGE_PROOF_SCHEMA);
    assert.equal(proof.mode, "LOCAL_PROOF");
    assert.equal(proof.test_run.runner, "node:test");
    assert.equal(proof.test_run.exit_code, 0);
    assert.equal(proof.test_run.failed, 0);
    assert.ok(proof.source_bindings.some((item) => item.kind === "production"));
    assert.ok(proof.source_bindings.some((item) => item.kind === "test"));
    assert.ok(
      proof.source_bindings.every(
        (item) =>
          item.read_only === true &&
          /^[a-f0-9]{64}$/.test(item.sha256) &&
          item.bytes > 0,
      ),
    );
  }
  const unavailable = JSON.parse(
    fs.readFileSync(result.runtime_capabilities.path, "utf8"),
  );
  assert.equal(unavailable.ready, false);
  assert.deepEqual(unavailable.blockers, [
    "runtime_capabilities_not_supplied",
  ]);
  assert.equal(unavailable.safety.upload_authority, false);
  assert.equal(unavailable.safety.oauth_mutation_authority, false);
  assert.equal(unavailable.safety.database_mutation_authority, false);

  const evidence = collectMultiLaneActivationEvidence({
    indexPath: result.index_path,
    repositoryRoot: fixture.root,
    now: NOW,
  });
  assert.equal(evidence.collection.verdict, "BLOCKED");
  for (const [laneId, lane] of Object.entries(evidence.lanes)) {
    for (const [stage, proof] of Object.entries(lane)) {
      if (laneId === "weekly_longform" && stage === "production") {
        assert.equal(proof.status, "BLOCKED");
        assert.ok(
          proof.blockers.includes(
            "weekly_longform_runtime_declared_ready_invalid",
          ),
        );
      } else {
        assert.equal(proof.status, "PROVEN");
      }
    }
  }
});

test("an exact supplied runtime-capabilities artifact can complete collector evidence without being rewritten", (t) => {
  const fixture = fixtureRepository(t);
  const runtime = writeJson(
    path.join(fixture.root, "runtime-capabilities.json"),
    readyRuntime(),
  );
  const result = generateMultiLaneActivationStageProofs({
    repository_root: fixture.root,
    output_dir: fixture.output,
    generated_at: NOW,
    runtime_capabilities_path: runtime.path,
    runtime_capabilities_sha256: runtime.sha256,
    run_test_command: passingRunner(),
  });

  assert.equal(result.verdict, "PROVEN");
  assert.equal(result.runtime_capabilities.availability, "SUPPLIED");
  assert.equal(result.runtime_capabilities.ready, true);
  assert.deepEqual(
    fs.readFileSync(result.runtime_capabilities.path),
    fs.readFileSync(runtime.path),
  );
  const evidence = collectMultiLaneActivationEvidence({
    indexPath: result.index_path,
    repositoryRoot: fixture.root,
    now: NOW,
  });
  assert.equal(evidence.collection.verdict, "PROVEN");
  assert.deepEqual(evidence.collection.blockers, []);
});

test("a failed allowlisted test run writes HOLD checks and cannot become collected proof", (t) => {
  const fixture = fixtureRepository(t);
  const result = generateMultiLaneActivationStageProofs({
    repository_root: fixture.root,
    output_dir: fixture.output,
    generated_at: NOW,
    run_test_command: ({ laneId, stage, testFiles }) =>
      laneId === "breaking_short" && stage === "production"
        ? {
            exit_code: 1,
            passed: 7,
            failed: 1,
          }
        : passingRunner()({ testFiles }),
  });
  const failed = result.stage_proofs.find(
    (item) =>
      item.lane_id === "breaking_short" &&
      item.stage === "production",
  );
  const proof = JSON.parse(fs.readFileSync(failed.path, "utf8"));
  assert.equal(proof.test_run.exit_code, 1);
  assert.equal(proof.test_run.failed, 1);
  assert.ok(proof.checks.every((check) => check.result === "HOLD"));
  assert.ok(
    result.blockers.includes(
      "breaking_short:production:focused_tests_failed",
    ),
  );
  const evidence = collectMultiLaneActivationEvidence({
    indexPath: result.index_path,
    repositoryRoot: fixture.root,
    now: NOW,
  });
  assert.equal(evidence.lanes.breaking_short.production.status, "BLOCKED");
});

test("source drift during a test run is detected before a PASS proof is emitted", (t) => {
  const fixture = fixtureRepository(t);
  let changed = false;
  const result = generateMultiLaneActivationStageProofs({
    repository_root: fixture.root,
    output_dir: fixture.output,
    generated_at: NOW,
    run_test_command: ({ laneId, stage, testFiles }) => {
      if (!changed) {
        changed = true;
        fs.appendFileSync(testFiles[0], "// changed during test\n", "utf8");
      }
      return passingRunner()({ laneId, stage, testFiles });
    },
  });

  const first = result.stage_proofs[0];
  const proof = JSON.parse(fs.readFileSync(first.path, "utf8"));
  assert.equal(proof.test_run.exit_code, 1);
  assert.ok(
    proof.test_run.blockers.includes("bound_source_changed_during_test"),
  );
  assert.ok(proof.checks.every((check) => check.result === "HOLD"));
});

test("existing stage proof bytes are immutable and conflicting reruns fail closed", (t) => {
  const fixture = fixtureRepository(t);
  const args = {
    repository_root: fixture.root,
    output_dir: fixture.output,
    generated_at: NOW,
    run_test_command: passingRunner(),
  };
  const first = generateMultiLaneActivationStageProofs(args);
  fs.writeFileSync(first.stage_proofs[0].path, "{}\n", "utf8");

  assert.throws(
    () => generateMultiLaneActivationStageProofs(args),
    /activation_stage_proof_immutable_conflict/,
  );
});

test("runtime capability bytes must match the caller-declared SHA-256", (t) => {
  const fixture = fixtureRepository(t);
  const runtime = writeJson(
    path.join(fixture.root, "runtime-capabilities.json"),
    readyRuntime(),
  );
  assert.throws(
    () =>
      generateMultiLaneActivationStageProofs({
        repository_root: fixture.root,
        output_dir: fixture.output,
        generated_at: NOW,
        runtime_capabilities_path: runtime.path,
        runtime_capabilities_sha256: "f".repeat(64),
        run_test_command: passingRunner(),
      }),
    /runtime_capabilities_sha256_mismatch/,
  );
});

test("supplied runtime capabilities reject recursively secret-shaped keys", (t) => {
  const fixture = fixtureRepository(t);
  const unsafe = {
    ...readyRuntime(),
    provider: {
      client_secret: "must-never-enter-proof-output",
    },
  };
  const runtime = writeJson(
    path.join(fixture.root, "runtime-capabilities.json"),
    unsafe,
  );
  assert.throws(
    () =>
      generateMultiLaneActivationStageProofs({
        repository_root: fixture.root,
        output_dir: fixture.output,
        generated_at: NOW,
        runtime_capabilities_path: runtime.path,
        runtime_capabilities_sha256: runtime.sha256,
        run_test_command: passingRunner(),
      }),
    /runtime_capabilities_secret_shaped_key_forbidden:\$\.provider\.client_secret/,
  );
  assert.equal(
    fs.existsSync(
      path.join(
        fixture.output,
        "weekly-longform-production-runtime-capabilities.json",
      ),
    ),
    false,
  );
});

test("supplied runtime capabilities reject keys outside the probe's closed schema", (t) => {
  const fixture = fixtureRepository(t);
  const unsupported = {
    ...readyRuntime(),
    diagnostics: {
      healthy: true,
    },
  };
  const runtime = writeJson(
    path.join(fixture.root, "runtime-capabilities.json"),
    unsupported,
  );

  assert.throws(
    () =>
      generateMultiLaneActivationStageProofs({
        repository_root: fixture.root,
        output_dir: fixture.output,
        generated_at: NOW,
        runtime_capabilities_path: runtime.path,
        runtime_capabilities_sha256: runtime.sha256,
        run_test_command: passingRunner(),
      }),
    /runtime_capabilities_closed_schema_invalid/,
  );
});

test("node:test invocation is exact and child environment strips secrets while forcing LOCAL_PROOF", () => {
  const environment = buildLocalProofTestEnvironment({
    PATH: "C:/safe-bin",
    SYSTEMROOT: "C:/Windows",
    YOUTUBE_CLIENT_SECRET: "must-not-pass",
    ELEVENLABS_API_KEY: "must-not-pass",
    AUTO_PUBLISH: "true",
  });
  assert.equal(environment.PATH, "C:/safe-bin");
  assert.equal(environment.SYSTEMROOT, "C:/Windows");
  assert.equal(environment.YOUTUBE_CLIENT_SECRET, undefined);
  assert.equal(environment.ELEVENLABS_API_KEY, undefined);
  assert.equal(environment.PULSE_OPERATING_MODE, "LOCAL_PROOF");
  assert.equal(environment.AUTO_PUBLISH, "false");
  assert.equal(environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED, "false");
  assert.equal(environment.PULSE_EMERGENCY_KILL_SWITCH, "true");
  assert.equal(environment.USE_SQLITE, "false");

  const invocation = buildNodeTestInvocation({
    repositoryRoot: "C:/repo",
    testFiles: [
      "C:/repo/tests/services/example.test.js",
    ],
  });
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(invocation.args.slice(0, 4), [
    "--test",
    "--require",
    path.resolve(
      "C:/repo/lib/services/local-proof-action-deny-preload.js",
    ),
    "--test-reporter=tap",
  ]);
  assert.deepEqual(invocation.args.slice(4), [
    path.resolve("C:/repo/tests/services/example.test.js"),
  ]);
  assert.match(invocation.command, /^node --test /);
  assert.doesNotMatch(invocation.command, /must-not-pass/);
});

test("TAP parser requires concrete pass/fail counts", () => {
  assert.deepEqual(
    parseNodeTestTap("# tests 12\n# pass 12\n# fail 0\n"),
    { passed: 12, failed: 0 },
  );
  assert.deepEqual(parseNodeTestTap("not TAP"), {
    passed: null,
    failed: null,
  });
});

test("preloaded guard permits only ephemeral in-memory SQLite and blocks persistent DB or sockets", () => {
  const guard = path.join(
    path.resolve(__dirname, "..", ".."),
    ...HARNESS_FILES[1].split("/"),
  );
  const database = spawnSync(
    process.execPath,
    [
      "--require",
      guard,
      "-e",
      'new (require("better-sqlite3"))("production.sqlite")',
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.notEqual(database.status, 0);
  assert.match(
    `${database.stdout}\n${database.stderr}`,
    /LOCAL_PROOF_ACTION_FORBIDDEN:database:persistent_sqlite/,
  );

  const memory = spawnSync(
    process.execPath,
    [
      "--require",
      guard,
      "-e",
      'const D=require("better-sqlite3");const d=new D(":memory:");d.exec("SELECT 1");d.close()',
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(memory.status, 0, memory.stderr);

  const network = spawnSync(
    process.execPath,
    [
      "--require",
      guard,
      "-e",
      'require("node:net").connect({host:"127.0.0.1",port:9})',
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.notEqual(network.status, 0);
  assert.match(
    `${network.stdout}\n${network.stderr}`,
    /LOCAL_PROOF_ACTION_FORBIDDEN:network:net:connect/,
  );
});
