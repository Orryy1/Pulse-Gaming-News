"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  INDEX_SCHEMA,
  RUNTIME_CAPABILITIES_SCHEMA,
  STAGE_PROOF_SCHEMA,
  STAGE_REQUIREMENTS,
  projectRuntimeCapabilitiesDocument,
} = require("./multi-lane-activation-evidence-collector");

const GENERATOR_SCHEMA =
  "pulse-multi-lane-activation-stage-proof-generation-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_TIMEOUT_MS = 120000;
const MAXIMUM_SOURCE_BYTES = 32 * 1024 * 1024;
const MAXIMUM_RUNTIME_BYTES = 5 * 1024 * 1024;
const HARNESS_FILES = Object.freeze([
  "lib/services/multi-lane-activation-stage-proof-generator.js",
  "lib/services/local-proof-action-deny-preload.js",
]);
const WEEKLY_RUNTIME_DEPENDENCIES = Object.freeze([
  "produceNarration",
  "materializeAlignment",
  "renderLongform",
  "materializeVariants",
  "runDecodedQa",
  "materializeDerivatives",
]);
const WEEKLY_RUNTIME_SAFETY_FLAGS = Object.freeze([
  "implicit_network_enabled",
  "implicit_process_spawn_enabled",
  "upload_authority",
  "oauth_mutation_authority",
  "database_mutation_authority",
]);

function freezeConfiguration({
  lane_id,
  stage,
  production_files,
  test_files,
  unsupported_checks = [],
}) {
  return Object.freeze({
    lane_id,
    stage,
    checks: Object.freeze([...STAGE_REQUIREMENTS[lane_id][stage]]),
    production_files: Object.freeze([...production_files]),
    test_files: Object.freeze([...test_files]),
    unsupported_checks: Object.freeze([...unsupported_checks]),
  });
}

const REVIEW_PRODUCTION_FILES = Object.freeze([
  "lib/services/governed-lane-review-packet.js",
  "lib/job-handlers.js",
]);
const REVIEW_TEST_FILES = Object.freeze([
  "tests/services/governed-lane-publication-handlers.test.js",
  "tests/services/governed-lane-review-packet.test.js",
]);
const DISPATCH_PRODUCTION_FILES = Object.freeze([
  "lib/job-handlers.js",
  "lib/services/governed-platform-dispatch.js",
  "lib/services/publication-request-fingerprint.js",
  "lib/repositories/publication_governance.js",
  "lib/stabilisation/publication-lifecycle.js",
]);
const DISPATCH_TEST_FILES = Object.freeze([
  "tests/services/governed-lane-publication-handlers.test.js",
  "tests/services/publication-lifecycle.test.js",
  "tests/services/publication-request-fingerprint.test.js",
  "tests/db/publication-governance-repository.test.js",
]);

const ACTIVATION_STAGE_ALLOWLIST = Object.freeze({
  "breaking_short:planning": freezeConfiguration({
    lane_id: "breaking_short",
    stage: "planning",
    production_files: [
      "lib/services/breaking-source-adapters.js",
      "lib/services/breaking-source-evidence.js",
      "lib/services/breaking-event-ingress.js",
      "lib/job-handlers.js",
    ],
    test_files: [
      "tests/services/breaking-source-hardening.test.js",
      "tests/services/breaking-event-ingress.test.js",
      "tests/services/exact-short-planning-handler.test.js",
    ],
  }),
  "breaking_short:production": freezeConfiguration({
    lane_id: "breaking_short",
    stage: "production",
    production_files: [
      "lib/services/exact-story-production-scope.js",
      "lib/services/governed-lane-review-packet.js",
      "lib/job-handlers.js",
    ],
    test_files: [
      "tests/services/exact-story-production-scope.test.js",
      "tests/services/lane-production-handler.test.js",
      "tests/services/governed-lane-review-handler.test.js",
    ],
  }),
  "breaking_short:human_review": freezeConfiguration({
    lane_id: "breaking_short",
    stage: "human_review",
    production_files: REVIEW_PRODUCTION_FILES,
    test_files: REVIEW_TEST_FILES,
  }),
  "breaking_short:live_dispatch": freezeConfiguration({
    lane_id: "breaking_short",
    stage: "live_dispatch",
    production_files: DISPATCH_PRODUCTION_FILES,
    test_files: DISPATCH_TEST_FILES,
  }),
  "evergreen_short:planning": freezeConfiguration({
    lane_id: "evergreen_short",
    stage: "planning",
    production_files: [
      "lib/services/governed-editorial-inventory-registry.js",
      "lib/services/evergreen-autonomous-discovery.js",
      "lib/services/evergreen-verdict-candidate-builder.js",
      "lib/job-handlers.js",
    ],
    test_files: [
      "tests/services/governed-editorial-inventory-registry.test.js",
      "tests/services/governed-editorial-inventory-handlers.test.js",
      "tests/services/evergreen-autonomous-discovery.test.js",
      "tests/services/evergreen-verdict-candidate-builder.test.js",
    ],
  }),
  "evergreen_short:production": freezeConfiguration({
    lane_id: "evergreen_short",
    stage: "production",
    production_files: [
      "lib/services/evergreen-verdict-pitch-enrichment.js",
      "lib/services/evergreen-verdict-production-work-order.js",
      "lib/services/evergreen-verdict-production-runner.js",
      "lib/services/evergreen-verdict-production-runtime.js",
      "lib/job-handlers.js",
    ],
    test_files: [
      "tests/services/evergreen-verdict-pitch-enrichment.test.js",
      "tests/services/evergreen-short-enrichment-handler.test.js",
      "tests/services/evergreen-verdict-production-work-order.test.js",
      "tests/services/evergreen-verdict-production-runner.test.js",
      "tests/services/lane-production-handler.test.js",
    ],
  }),
  "evergreen_short:human_review": freezeConfiguration({
    lane_id: "evergreen_short",
    stage: "human_review",
    production_files: REVIEW_PRODUCTION_FILES,
    test_files: REVIEW_TEST_FILES,
  }),
  "evergreen_short:live_dispatch": freezeConfiguration({
    lane_id: "evergreen_short",
    stage: "live_dispatch",
    production_files: DISPATCH_PRODUCTION_FILES,
    test_files: DISPATCH_TEST_FILES,
  }),
  "weekly_longform:planning": freezeConfiguration({
    lane_id: "weekly_longform",
    stage: "planning",
    production_files: [
      "lib/services/governed-editorial-inventory-registry.js",
      "lib/services/weekly-longform-work-order.js",
      "lib/job-handlers.js",
      "lib/scheduler.js",
    ],
    test_files: [
      "tests/services/governed-editorial-inventory-registry.test.js",
      "tests/services/governed-editorial-inventory-handlers.test.js",
      "tests/services/weekly-longform-work-order.test.js",
      "tests/services/weekly-longform-handler.test.js",
    ],
  }),
  "weekly_longform:production": freezeConfiguration({
    lane_id: "weekly_longform",
    stage: "production",
    production_files: [
      "lib/services/weekly-longform-editorial-enrichment.js",
      "lib/services/weekly-longform-production-runner.js",
      "lib/services/longform-same-run-evidence.js",
      "lib/services/weekly-longform-derivative-materializer.js",
      "lib/job-handlers.js",
    ],
    test_files: [
      "tests/services/weekly-longform-editorial-enrichment.test.js",
      "tests/services/weekly-longform-production-runner.test.js",
      "tests/services/longform-same-run-evidence.test.js",
      "tests/services/weekly-longform-derivative-materializer.test.js",
      "tests/services/weekly-longform-handler.test.js",
    ],
  }),
  "weekly_longform:human_review": freezeConfiguration({
    lane_id: "weekly_longform",
    stage: "human_review",
    production_files: REVIEW_PRODUCTION_FILES,
    test_files: REVIEW_TEST_FILES,
  }),
  "weekly_longform:live_dispatch": freezeConfiguration({
    lane_id: "weekly_longform",
    stage: "live_dispatch",
    production_files: DISPATCH_PRODUCTION_FILES,
    test_files: DISPATCH_TEST_FILES,
  }),
});

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function validSha256(value) {
  return SHA256_PATTERN.test(text(value).toLowerCase());
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function relativeContained(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function isSecretPath(filePath) {
  const parts = path
    .resolve(filePath)
    .toLowerCase()
    .split(/[\\/]+/)
    .filter(Boolean);
  const basename = path.basename(filePath).toLowerCase();
  return (
    parts.includes("tokens") ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /(?:credential|oauth|access[_-]?token|client[_-]?secret)/i.test(
      basename,
    )
  );
}

function generatorError(code, blockers = [code]) {
  const error = new Error(
    `activation_stage_proof_${code}:${unique(blockers).join(",")}`,
  );
  error.code = `ACTIVATION_STAGE_PROOF_${String(code).toUpperCase()}`;
  error.blockers = unique(blockers);
  return error;
}

function lstatOrNull(filePath) {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertNoSymlinkComponents(filePath, prefix) {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  const parts = resolved
    .slice(parsed.root.length)
    .split(path.sep)
    .filter(Boolean);
  let cursor = parsed.root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const stat = lstatOrNull(cursor);
    if (stat?.isSymbolicLink()) {
      throw generatorError("unsafe_path", [`${prefix}_symlink_forbidden`]);
    }
  }
  if (isSecretPath(resolved)) {
    throw generatorError("unsafe_path", [`${prefix}_secret_path_forbidden`]);
  }
  return resolved;
}

function observeRepositoryFile(repositoryRoot, relativePath, kind) {
  if (
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).includes("..")
  ) {
    throw generatorError("allowlist_invalid", [
      `allowlisted_${kind}_path_invalid:${relativePath}`,
    ]);
  }
  const absolutePath = assertNoSymlinkComponents(
    path.join(repositoryRoot, ...relativePath.split("/")),
    `allowlisted_${kind}`,
  );
  if (!relativeContained(repositoryRoot, absolutePath)) {
    throw generatorError("allowlist_invalid", [
      `allowlisted_${kind}_outside_repository:${relativePath}`,
    ]);
  }
  const stat = lstatOrNull(absolutePath);
  if (!stat?.isFile() || stat.size <= 0 || stat.size > MAXIMUM_SOURCE_BYTES) {
    throw generatorError("allowlist_invalid", [
      `allowlisted_${kind}_file_invalid:${relativePath}`,
    ]);
  }
  const realPath = fs.realpathSync(absolutePath);
  if (!relativeContained(repositoryRoot, realPath)) {
    throw generatorError("allowlist_invalid", [
      `allowlisted_${kind}_realpath_outside_repository:${relativePath}`,
    ]);
  }
  const bytes = fs.readFileSync(absolutePath);
  return {
    component: `${kind}:${relativePath}`,
    kind,
    path: absolutePath,
    sha256: sha256(bytes),
    bytes: bytes.length,
    read_only: true,
  };
}

function validateAllowlist() {
  const expected = Object.entries(STAGE_REQUIREMENTS).flatMap(
    ([laneId, stages]) =>
      Object.keys(stages).map((stage) => `${laneId}:${stage}`),
  );
  const observed = Object.keys(ACTIVATION_STAGE_ALLOWLIST);
  if (
    expected.length !== 12 ||
    JSON.stringify([...expected].sort()) !==
      JSON.stringify([...observed].sort())
  ) {
    throw generatorError("allowlist_invalid", [
      "allowlist_must_cover_exactly_twelve_lane_stages",
    ]);
  }
  for (const [key, configuration] of Object.entries(
    ACTIVATION_STAGE_ALLOWLIST,
  )) {
    const required = STAGE_REQUIREMENTS[configuration.lane_id]?.[
      configuration.stage
    ];
    if (
      key !== `${configuration.lane_id}:${configuration.stage}` ||
      !required ||
      JSON.stringify([...required].sort()) !==
        JSON.stringify([...configuration.checks].sort()) ||
      configuration.production_files.length === 0 ||
      configuration.test_files.length === 0 ||
      configuration.unsupported_checks.some(
        (check) => !configuration.checks.includes(check),
      )
    ) {
      throw generatorError("allowlist_invalid", [
        `allowlist_contract_invalid:${key}`,
      ]);
    }
  }
}

function buildLocalProofTestEnvironment(source = process.env) {
  const environment = {};
  for (const key of [
    "PATH",
    "Path",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "PATHEXT",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMDATA",
    "CI",
  ]) {
    if (source[key] !== undefined) environment[key] = String(source[key]);
  }
  return {
    ...environment,
    NODE_ENV: "test",
    TZ: "UTC",
    NO_COLOR: "1",
    DEPLOYMENT_MODE: "local",
    PULSE_OPERATING_MODE: "LOCAL_PROOF",
    OPERATING_MODE: "LOCAL_PROOF",
    AUTO_PUBLISH: "false",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_KILL_SWITCH: "true",
    USE_SQLITE: "false",
    PULSE_PRIMARY_INSTANCE: "false",
    PULSE_TELEMETRY_ENABLED: "false",
    HYPERFRAMES_TELEMETRY_DISABLED: "true",
  };
}

function quoteCommandPart(value) {
  const part = String(value);
  return /[\s"]/u.test(part)
    ? `"${part.replace(/"/g, '\\"')}"`
    : part;
}

function buildNodeTestInvocation({ repositoryRoot, testFiles } = {}) {
  const guardPath = path.resolve(
    repositoryRoot,
    ...HARNESS_FILES[1].split("/"),
  );
  const absoluteTests = testFiles.map((file) => path.resolve(file));
  const displayParts = [
    "node",
    "--test",
    "--require",
    path.relative(repositoryRoot, guardPath).replace(/\\/g, "/"),
    "--test-reporter=tap",
    ...absoluteTests.map((file) =>
      path.relative(repositoryRoot, file).replace(/\\/g, "/"),
    ),
  ];
  return {
    executable: process.execPath,
    args: [
      "--test",
      "--require",
      guardPath,
      "--test-reporter=tap",
      ...absoluteTests,
    ],
    command: displayParts.map(quoteCommandPart).join(" "),
  };
}

function parseNodeTestTap(stdout) {
  const output = String(stdout || "");
  const pass = [...output.matchAll(/^# pass\s+(\d+)\s*$/gim)].at(-1);
  const fail = [...output.matchAll(/^# fail\s+(\d+)\s*$/gim)].at(-1);
  return {
    passed: pass ? Number(pass[1]) : null,
    failed: fail ? Number(fail[1]) : null,
  };
}

function executeNodeTestCommand({
  repositoryRoot,
  testFiles,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const invocation = buildNodeTestInvocation({
    repositoryRoot,
    testFiles,
  });
  const result = spawnSync(invocation.executable, invocation.args, {
    cwd: repositoryRoot,
    shell: false,
    windowsHide: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: buildLocalProofTestEnvironment(process.env),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const counts = parseNodeTestTap(result.stdout);
  return {
    exit_code: Number.isInteger(result.status) ? result.status : 1,
    passed: counts.passed,
    failed: counts.failed,
    signal: result.signal || null,
    error_code: result.error?.code || null,
  };
}

function writeImmutable(filePath, bytes) {
  const resolvedPath = assertNoSymlinkComponents(filePath, "proof_output");
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  assertNoSymlinkComponents(path.dirname(resolvedPath), "proof_output");
  const existing = lstatOrNull(resolvedPath);
  if (existing) {
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw generatorError("immutable_conflict", [
        `output_not_regular_file:${resolvedPath}`,
      ]);
    }
    const observed = fs.readFileSync(resolvedPath);
    if (
      observed.length !== bytes.length ||
      !crypto.timingSafeEqual(observed, bytes)
    ) {
      throw generatorError("immutable_conflict", [
        `output_bytes_mismatch:${resolvedPath}`,
      ]);
    }
    return { path: resolvedPath, sha256: sha256(observed), reused: true };
  }
  const temporaryPath = `${resolvedPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporaryPath, bytes, { flag: "wx" });
  try {
    try {
      fs.renameSync(temporaryPath, resolvedPath);
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error?.code)) throw error;
      const observed = fs.readFileSync(resolvedPath);
      if (
        observed.length !== bytes.length ||
        !crypto.timingSafeEqual(observed, bytes)
      ) {
        throw generatorError("immutable_conflict", [
          `concurrent_output_mismatch:${resolvedPath}`,
        ]);
      }
    }
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return { path: resolvedPath, sha256: sha256(bytes), reused: false };
}

function runtimeReady(runtime) {
  return (
    runtime?.schema_version === RUNTIME_CAPABILITIES_SCHEMA &&
    runtime?.ready === true &&
    Array.isArray(runtime?.blockers) &&
    runtime.blockers.length === 0 &&
    WEEKLY_RUNTIME_DEPENDENCIES.every(
      (dependency) =>
        runtime?.dependencies?.[dependency]?.available === true,
    ) &&
    WEEKLY_RUNTIME_SAFETY_FLAGS.every(
      (flag) => runtime?.safety?.[flag] === false,
    )
  );
}

const SECRET_KEY_PATTERN =
  /(?:^|_)(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential|private[_-]?key|authorization|bearer)(?:_|$)/i;

function findSecretShapedKeys(value, prefix = "$", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      findSecretShapedKeys(item, `${prefix}[${index}]`, found),
    );
    return found;
  }
  if (!value || typeof value !== "object") return found;
  for (const [key, child] of Object.entries(value)) {
    const next = `${prefix}.${key}`;
    if (SECRET_KEY_PATTERN.test(key)) found.push(next);
    findSecretShapedKeys(child, next, found);
  }
  return found;
}

function unavailableRuntime(generatedAt) {
  return {
    schema_version: RUNTIME_CAPABILITIES_SCHEMA,
    generated_at: generatedAt,
    ready: false,
    blockers: ["runtime_capabilities_not_supplied"],
    dependencies: Object.fromEntries(
      WEEKLY_RUNTIME_DEPENDENCIES.map((dependency) => [
        dependency,
        { available: false },
      ]),
    ),
    safety: Object.fromEntries(
      WEEKLY_RUNTIME_SAFETY_FLAGS.map((flag) => [flag, false]),
    ),
  };
}

function loadRuntimeCapabilities({
  runtimePath,
  expectedSha256,
  generatedAt,
}) {
  if (!text(runtimePath)) {
    const value = unavailableRuntime(generatedAt);
    return {
      availability: "UNAVAILABLE",
      value,
      bytes: jsonBytes(value),
      ready: false,
    };
  }
  if (!validSha256(expectedSha256)) {
    throw generatorError("runtime_capabilities_invalid", [
      "runtime_capabilities_sha256_required",
    ]);
  }
  const resolvedPath = assertNoSymlinkComponents(
    runtimePath,
    "runtime_capabilities",
  );
  const stat = lstatOrNull(resolvedPath);
  if (
    !stat?.isFile() ||
    stat.size <= 0 ||
    stat.size > MAXIMUM_RUNTIME_BYTES
  ) {
    throw generatorError("runtime_capabilities_invalid", [
      "runtime_capabilities_file_invalid",
    ]);
  }
  const bytes = fs.readFileSync(resolvedPath);
  const observedSha256 = sha256(bytes);
  if (observedSha256 !== text(expectedSha256).toLowerCase()) {
    throw generatorError("runtime_capabilities_invalid", [
      "runtime_capabilities_sha256_mismatch",
    ]);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw generatorError("runtime_capabilities_invalid", [
      "runtime_capabilities_json_invalid",
    ]);
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schema_version !== RUNTIME_CAPABILITIES_SCHEMA
  ) {
    throw generatorError("runtime_capabilities_invalid", [
      "runtime_capabilities_schema_invalid",
    ]);
  }
  const secretKeys = findSecretShapedKeys(value);
  if (secretKeys.length) {
    throw generatorError("runtime_capabilities_invalid", [
      ...secretKeys.map(
        (key) => `runtime_capabilities_secret_shaped_key_forbidden:${key}`,
      ),
    ]);
  }
  const projected = projectRuntimeCapabilitiesDocument(value);
  if (projected.blockers.length > 0) {
    throw generatorError("runtime_capabilities_invalid", [
      "runtime_capabilities_closed_schema_invalid",
    ]);
  }
  return {
    availability: "SUPPLIED",
    value,
    bytes,
    ready: runtimeReady(projected.capabilities),
    source_path: resolvedPath,
    source_sha256: observedSha256,
  };
}

function stageFileName(laneId, stage) {
  return `${laneId}-${stage}-stage-proof.json`;
}

function outputArtifactReference({
  id,
  laneId,
  stage,
  role,
  outputDirectory,
  written,
}) {
  return {
    id,
    lane_id: laneId,
    stage,
    role,
    path: path
      .relative(outputDirectory, written.path)
      .replace(/\\/g, "/"),
    sha256: written.sha256,
  };
}

function validateBoundSourcesAfterRun(bindings) {
  const blockers = [];
  for (const binding of bindings) {
    const stat = lstatOrNull(binding.path);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      blockers.push(`bound_source_missing_after_test:${binding.component}`);
      continue;
    }
    const bytes = fs.readFileSync(binding.path);
    if (
      bytes.length !== binding.bytes ||
      sha256(bytes) !== binding.sha256
    ) {
      blockers.push("bound_source_changed_during_test");
    }
  }
  return unique(blockers);
}

function normaliseTestResult(result, minimumPasses) {
  const exitCode = Number(result?.exit_code);
  const passed = Number(result?.passed);
  const failed = Number(result?.failed);
  const blockers = [];
  if (!Number.isInteger(exitCode) || exitCode !== 0) {
    blockers.push("focused_test_exit_code_not_zero");
  }
  if (!Number.isInteger(passed) || passed < minimumPasses) {
    blockers.push("focused_test_pass_count_insufficient");
  }
  if (!Number.isInteger(failed) || failed !== 0) {
    blockers.push("focused_test_failures_reported");
  }
  return {
    exit_code: Number.isInteger(exitCode) ? exitCode : 1,
    passed: Number.isInteger(passed) ? passed : 0,
    failed: Number.isInteger(failed) ? failed : 1,
    blockers,
  };
}

function generateMultiLaneActivationStageProofs({
  repository_root: repositoryRoot = path.resolve(__dirname, "..", ".."),
  output_dir: outputDirectory,
  generated_at: generatedAt = new Date().toISOString(),
  runtime_capabilities_path: runtimeCapabilitiesPath = null,
  runtime_capabilities_sha256: runtimeCapabilitiesSha256 = null,
  run_test_command: runTestCommand = executeNodeTestCommand,
  timeout_ms: timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  validateAllowlist();
  const generatedDate = new Date(generatedAt);
  if (Number.isNaN(generatedDate.getTime())) {
    throw generatorError("invalid", ["generated_at_invalid"]);
  }
  const generatedAtIso = generatedDate.toISOString();
  if (!text(outputDirectory)) {
    throw generatorError("invalid", ["output_directory_required"]);
  }
  if (
    !Number.isInteger(Number(timeoutMs)) ||
    Number(timeoutMs) < 1000 ||
    Number(timeoutMs) > 15 * 60 * 1000
  ) {
    throw generatorError("invalid", ["timeout_ms_invalid"]);
  }
  if (typeof runTestCommand !== "function") {
    throw generatorError("invalid", ["test_runner_required"]);
  }
  const resolvedRepositoryRoot = assertNoSymlinkComponents(
    repositoryRoot,
    "repository_root",
  );
  const repositoryStat = lstatOrNull(resolvedRepositoryRoot);
  if (!repositoryStat?.isDirectory()) {
    throw generatorError("invalid", ["repository_root_invalid"]);
  }
  const resolvedOutputDirectory = assertNoSymlinkComponents(
    outputDirectory,
    "output_directory",
  );
  if (resolvedOutputDirectory === resolvedRepositoryRoot) {
    throw generatorError("unsafe_path", [
      "output_directory_cannot_be_repository_root",
    ]);
  }
  fs.mkdirSync(resolvedOutputDirectory, { recursive: true });
  assertNoSymlinkComponents(resolvedOutputDirectory, "output_directory");

  const harnessBindings = HARNESS_FILES.map((file) =>
    observeRepositoryFile(resolvedRepositoryRoot, file, "harness"),
  );
  const artifacts = [];
  const stageProofs = [];
  const blockers = [];
  for (const configuration of Object.values(
    ACTIVATION_STAGE_ALLOWLIST,
  )) {
    const productionBindings = configuration.production_files.map((file) =>
      observeRepositoryFile(resolvedRepositoryRoot, file, "production"),
    );
    const testBindings = configuration.test_files.map((file) =>
      observeRepositoryFile(resolvedRepositoryRoot, file, "test"),
    );
    const sourceBindings = [
      ...productionBindings,
      ...testBindings,
      ...harnessBindings,
    ];
    const ephemeralTestDatabaseUsed =
      configuration.test_files.some(
        (file) =>
          file.startsWith("tests/db/") ||
          file.endsWith(
            "governed-lane-publication-handlers.test.js",
          ),
      );
    const invocation = buildNodeTestInvocation({
      repositoryRoot: resolvedRepositoryRoot,
      testFiles: testBindings.map((binding) => binding.path),
    });
    let rawTestResult;
    try {
      rawTestResult = runTestCommand({
        laneId: configuration.lane_id,
        stage: configuration.stage,
        testFiles: testBindings.map((binding) => binding.path),
        command: invocation.command,
        invocation,
        repositoryRoot: resolvedRepositoryRoot,
        timeoutMs: Number(timeoutMs),
        environment: buildLocalProofTestEnvironment(process.env),
      });
    } catch (error) {
      rawTestResult = {
        exit_code: 1,
        passed: 0,
        failed: 1,
        runner_error_code: error?.code || "runner_threw",
      };
    }
    const result = normaliseTestResult(
      rawTestResult,
      configuration.checks.length,
    );
    const driftBlockers = validateBoundSourcesAfterRun(sourceBindings);
    const testBlockers = unique([...result.blockers, ...driftBlockers]);
    const stageTestsPassed = testBlockers.length === 0;
    const unsupportedChecks = new Set(
      configuration.unsupported_checks,
    );
    const checkBlockers = configuration.unsupported_checks.map(
      (check) => `exact_positive_test_evidence_unavailable:${check}`,
    );
    const stagePassed =
      stageTestsPassed && configuration.unsupported_checks.length === 0;
    const proof = {
      schema_version: STAGE_PROOF_SCHEMA,
      generated_at: generatedAtIso,
      mode: "LOCAL_PROOF",
      lane_id: configuration.lane_id,
      stage: configuration.stage,
      test_run: {
        runner: "node:test",
        command: invocation.command,
        exit_code: stageTestsPassed ? result.exit_code : 1,
        passed: result.passed,
        failed: stageTestsPassed
          ? result.failed
          : Math.max(1, result.failed),
        blockers: testBlockers,
        exact_allowlist: true,
      },
      checks: configuration.checks.map((id) => ({
        id,
        result:
          stageTestsPassed && !unsupportedChecks.has(id)
            ? "PASS"
            : "HOLD",
      })),
      blockers: checkBlockers,
      source_bindings: sourceBindings,
      safety: {
        network_used: false,
        production_database_accessed: false,
        ephemeral_in_memory_test_database_used:
          ephemeralTestDatabaseUsed,
        oauth_accessed: false,
        publish_action_invoked: false,
        token_material_accessed: false,
        test_process_guard_preloaded: true,
        external_publication_authorised: false,
      },
    };
    const proofPath = path.join(
      resolvedOutputDirectory,
      stageFileName(configuration.lane_id, configuration.stage),
    );
    const written = writeImmutable(proofPath, jsonBytes(proof));
    const id = `${configuration.lane_id}-${configuration.stage}-proof`;
    artifacts.push(
      outputArtifactReference({
        id,
        laneId: configuration.lane_id,
        stage: configuration.stage,
        role: "stage_proof",
        outputDirectory: resolvedOutputDirectory,
        written,
      }),
    );
    stageProofs.push({
      id,
      lane_id: configuration.lane_id,
      stage: configuration.stage,
      status: stagePassed ? "PASS" : "HOLD",
      tests_status: stageTestsPassed ? "PASS" : "HOLD",
      path: written.path,
      sha256: written.sha256,
      reused: written.reused,
    });
    if (!stageTestsPassed) {
      blockers.push(
        `${configuration.lane_id}:${configuration.stage}:focused_tests_failed`,
      );
    }
    blockers.push(
      ...checkBlockers.map(
        (blocker) =>
          `${configuration.lane_id}:${configuration.stage}:${blocker}`,
      ),
    );
  }

  const runtime = loadRuntimeCapabilities({
    runtimePath: runtimeCapabilitiesPath,
    expectedSha256: runtimeCapabilitiesSha256,
    generatedAt: generatedAtIso,
  });
  const runtimePath = path.join(
    resolvedOutputDirectory,
    "weekly-longform-production-runtime-capabilities.json",
  );
  const runtimeWritten = writeImmutable(runtimePath, runtime.bytes);
  artifacts.push(
    outputArtifactReference({
      id: "weekly-longform-production-runtime-capabilities",
      laneId: "weekly_longform",
      stage: "production",
      role: "runtime_capabilities",
      outputDirectory: resolvedOutputDirectory,
      written: runtimeWritten,
    }),
  );
  if (!runtime.ready) {
    blockers.push(
      runtime.availability === "UNAVAILABLE"
        ? "weekly_longform_runtime_capabilities_not_supplied"
        : "weekly_longform_runtime_capabilities_not_ready",
    );
  }

  const index = {
    schema_version: INDEX_SCHEMA,
    generated_at: generatedAtIso,
    generator: {
      schema_version: GENERATOR_SCHEMA,
      mode: "LOCAL_PROOF",
      exact_allowlist: true,
      stage_count: 12,
    },
    artifacts,
    safety: {
      network_used: false,
      production_database_accessed: false,
      ephemeral_in_memory_test_database_used:
        Object.values(ACTIVATION_STAGE_ALLOWLIST).some(
          (configuration) =>
            configuration.test_files.some(
              (file) =>
                file.startsWith("tests/db/") ||
                file.endsWith(
                  "governed-lane-publication-handlers.test.js",
                ),
            ),
        ),
      oauth_accessed: false,
      publish_action_invoked: false,
      token_material_accessed: false,
      runtime_readiness_fabricated: false,
      external_publication_authorised: false,
    },
  };
  const indexPath = path.join(
    resolvedOutputDirectory,
    "multi-lane-activation-artifact-index.json",
  );
  const indexWritten = writeImmutable(indexPath, jsonBytes(index));
  const allStageTestsPassed = stageProofs.every(
    (proof) => proof.tests_status === "PASS",
  );
  const allChecksProven = stageProofs.every(
    (proof) => proof.status === "PASS",
  );
  return {
    schema_version: GENERATOR_SCHEMA,
    generated_at: generatedAtIso,
    verdict:
      allChecksProven && runtime.ready ? "PROVEN" : "BLOCKED",
    blockers: unique(blockers),
    all_stage_tests_passed: allStageTestsPassed,
    all_stage_checks_proven: allChecksProven,
    stage_proofs: stageProofs,
    runtime_capabilities: {
      availability: runtime.availability,
      ready: runtime.ready,
      path: runtimeWritten.path,
      sha256: runtimeWritten.sha256,
      source_path: runtime.source_path || null,
      source_sha256: runtime.source_sha256 || null,
    },
    index,
    index_path: indexWritten.path,
    index_sha256: indexWritten.sha256,
    safety: index.safety,
  };
}

module.exports = {
  ACTIVATION_STAGE_ALLOWLIST,
  DEFAULT_TIMEOUT_MS,
  GENERATOR_SCHEMA,
  HARNESS_FILES,
  buildLocalProofTestEnvironment,
  buildNodeTestInvocation,
  executeNodeTestCommand,
  generateMultiLaneActivationStageProofs,
  parseNodeTestTap,
};
