const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEFAULT_CONTENT_KINDS,
  contentWorkerHandlerTimeouts,
  createContentWorkerClaimGuard,
  parseArgs,
  usage,
} = require("../../tools/local-sqlite-content-worker");

const ROOT = path.resolve(__dirname, "..", "..");
const WORKER_PATH = path.join(ROOT, "tools", "local-sqlite-content-worker.js");
const BOOTSTRAP_PATH = require.resolve("../../lib/bootstrap-queue");
const RESOURCE_ENV = Object.freeze({
  PULSE_CONTENT_WORKER_RESOURCE_CLASS: "background",
  PULSE_CONTENT_WORKER_THREAD_BUDGET: "2",
  OMP_NUM_THREADS: "2",
  OPENBLAS_NUM_THREADS: "2",
  MKL_NUM_THREADS: "2",
  NUMEXPR_NUM_THREADS: "2",
  VECLIB_MAXIMUM_THREADS: "2",
  VIPS_CONCURRENCY: "2",
  TOKENIZERS_PARALLELISM: "false",
});
const RESOURCE_ENV_KEYS = Object.freeze(Object.keys(RESOURCE_ENV));

function makeChildEnv(overrides = {}) {
  const env = { ...process.env };
  for (const existingKey of Object.keys(env)) {
    if (RESOURCE_ENV_KEYS.some((key) => key.toLowerCase() === existingKey.toLowerCase())) {
      delete env[existingKey];
    }
  }
  delete env.PULSE_SKIP_DOTENV;
  return { ...env, ...overrides };
}

function writeBootstrapStub(directory) {
  const stubPath = path.join(directory, "stub-bootstrap.js");
  fs.writeFileSync(
    stubPath,
    [
      '"use strict";',
      "const bootstrapPath = process.env.PULSE_TEST_BOOTSTRAP_PATH;",
      "require.cache[bootstrapPath] = {",
      "  id: bootstrapPath,",
      "  filename: bootstrapPath,",
      "  loaded: true,",
      "  exports: {",
      "    start: async (options) => {",
      `      const keys = ${JSON.stringify(RESOURCE_ENV_KEYS)};`,
      "      const resourceEnv = Object.fromEntries(keys.map((key) => [key, process.env[key]]));",
      '      process.stdout.write(`RESOURCE_ENV=${JSON.stringify(resourceEnv)}\\n`);',
      "      const claimGuard = options && options.claimGuard;",
      "      const claimDecision = claimGuard",
      '        ? await claimGuard({ now: new Date("2026-07-17T08:50:00.000Z") })',
      "        : null;",
      '      process.stdout.write(`CLAIM_GUARD=${JSON.stringify(claimDecision)}\\n`);',
      "      return { stubbed: true };",
      "    },",
      "    stop: async () => undefined,",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  return stubPath;
}

function runDirectWorker({ cwd, env, preloadPath, args = [] }) {
  return spawnSync(
    process.execPath,
    ["--require", preloadPath, WORKER_PATH, "--worker-id", "content-isolation-test", ...args],
    {
      cwd,
      env: {
        ...env,
        PULSE_TEST_BOOTSTRAP_PATH: BOOTSTRAP_PATH,
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
}

test("local sqlite content worker defaults to non-publish content job kinds", () => {
  const args = parseArgs([], {});
  assert.ok(args.kinds.includes("fresh_production_refill"));
  assert.ok(args.kinds.includes("fresh_review_script_repair"));
  assert.ok(args.kinds.includes("candidate_supply_monitor"));
  assert.equal(args.kinds.includes("publish"), false);
  assert.equal(args.kinds.includes("publish_window_watchdog"), false);
  assert.deepEqual(args.kinds, DEFAULT_CONTENT_KINDS);
});

test("local sqlite content worker covers scheduled learning and quality loops", () => {
  const args = parseArgs([], {});
  for (const kind of [
    "live_performance_analyst",
    "studio_analytics_loop",
    "commercial_learning_loop",
    "competitor_forensics_lab",
    "competitor_quality_gate",
  ]) {
    assert.ok(args.kinds.includes(kind), `expected default content worker to claim ${kind}`);
  }
});

test("local sqlite content worker covers safe scheduled operations that keep Discord and evidence current", () => {
  const args = parseArgs([], {});
  for (const kind of [
    "scoring_digest",
    "blog_rebuild",
    "db_backup",
    "instagram_pending_verify",
    "overnight_produce_sweep",
    "overnight_analytics_backfill",
    "overnight_claude_analyst",
    "overnight_morning_digest",
  ]) {
    assert.ok(args.kinds.includes(kind), `expected default content worker to claim ${kind}`);
  }
});

test("local sqlite content worker parses explicit kind and worker options", () => {
  const args = parseArgs(
    ["--worker-id", "content-test", "--kinds", "fresh_production_refill,local_tts_doctor", "--gpu"],
    {},
  );
  assert.equal(args.workerId, "content-test");
  assert.deepEqual(args.kinds, ["fresh_production_refill", "local_tts_doctor"]);
  assert.equal(args.gpu, true);
});

test("local sqlite content worker allows isolated immutable runway preparation", () => {
  const args = parseArgs(
    ["--worker-id", "publish-prep", "--kinds", "publish_runway_generate"],
    {},
  );

  assert.deepEqual(args.kinds, ["publish_runway_generate"]);
});

test("local sqlite content worker uses a long lease for synchronous repair tools", () => {
  assert.equal(parseArgs([], {}).leaseMs, 30 * 60 * 1000);
  assert.equal(
    parseArgs([], { PULSE_CONTENT_WORKER_LEASE_MS: "2400000" }).leaseMs,
    2400000,
  );
});

test("candidate supply workers fail closed when a monitor exceeds its bounded runtime", () => {
  assert.deepEqual(
    contentWorkerHandlerTimeouts(["candidate_supply_monitor"], {}),
    { candidate_supply_monitor: 15 * 60 * 1000 },
  );
  assert.deepEqual(
    contentWorkerHandlerTimeouts(
      ["candidate_supply_monitor"],
      { PULSE_CANDIDATE_SUPPLY_HANDLER_TIMEOUT_MS: "420000" },
    ),
    { candidate_supply_monitor: 420000 },
  );
  assert.deepEqual(
    contentWorkerHandlerTimeouts(["fresh_production_refill"], {}),
    {},
  );
});

test("local sqlite content worker rejects live publish and credential explicit kinds", () => {
  assert.throws(
    () => parseArgs(["--kinds", "fresh_production_refill,publish"], {}),
    /forbidden live publish or credential job kind: publish/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "publish_window_watchdog"], {}),
    /forbidden live publish or credential job kind: publish_window_watchdog/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "instagram_token_refresh"], {}),
    /forbidden live publish or credential job kind: instagram_token_refresh/i,
  );
  assert.throws(
    () => parseArgs(["--kinds", "tiktok_auth_check"], {}),
    /forbidden live publish or credential job kind: tiktok_auth_check/i,
  );
});

test("local sqlite content worker usage states it does not run publish lanes", () => {
  const text = usage();
  assert.match(text, /non-publish content jobs/i);
  assert.match(text, /does not start the HTTP server, scheduler, publish watchdog or publish runner/i);
});

test("direct live content worker execution cannot manufacture the Windows wrapper contract through dotenv", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-content-worker-direct-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const preloadPath = writeBootstrapStub(tempDir);
  fs.writeFileSync(
    path.join(tempDir, ".env"),
    Object.entries(RESOURCE_ENV)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );

  const result = runDirectWorker({
    cwd: tempDir,
    env: makeChildEnv(),
    preloadPath,
    args: ["--kinds", "fresh_production_refill"],
  });

  assert.notEqual(result.status, 0, result.stderr);
  assert.match(result.stderr, /approved Windows wrapper/i);
  assert.doesNotMatch(result.stdout, /RESOURCE_ENV=/);
});

test("inherited content worker resource limits are reasserted after dotenv override", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-content-worker-env-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const preloadPath = writeBootstrapStub(tempDir);
  fs.writeFileSync(
    path.join(tempDir, ".env"),
    RESOURCE_ENV_KEYS.map((key) => `${key}=dotenv-override`).join("\n"),
  );

  const result = runDirectWorker({
    cwd: tempDir,
    env: makeChildEnv(RESOURCE_ENV),
    preloadPath,
    args: ["--kinds", "fresh_production_refill"],
  });

  assert.equal(result.status, 0, result.stderr);
  const resourceLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("RESOURCE_ENV="));
  assert.ok(resourceLine, result.stdout);
  assert.deepEqual(JSON.parse(resourceLine.slice("RESOURCE_ENV=".length)), RESOURCE_ENV);
});

test("content worker exposes and passes a default-on pre-publish quiet-period claim guard", (t) => {
  const guard = createContentWorkerClaimGuard({
    env: {},
    kinds: ["fresh_production_refill"],
  });
  assert.equal(typeof guard, "function");
  assert.equal(
    guard({ now: new Date("2026-07-17T08:50:00.000Z") }).allow_claim,
    false,
  );
  assert.equal(
    createContentWorkerClaimGuard({
      env: { PULSE_CONTENT_WORKER_QUIET_PERIOD: "false" },
      kinds: ["fresh_production_refill"],
    }),
    null,
  );

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-content-worker-guard-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const preloadPath = writeBootstrapStub(tempDir);
  const result = runDirectWorker({
    cwd: tempDir,
    env: makeChildEnv({
      ...RESOURCE_ENV,
      PULSE_SKIP_DOTENV: "true",
    }),
    preloadPath,
    args: ["--kinds", "fresh_production_refill"],
  });

  assert.equal(result.status, 0, result.stderr);
  const guardLine = result.stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith("CLAIM_GUARD="));
  assert.ok(guardLine, result.stdout);
  const decision = JSON.parse(guardLine.slice("CLAIM_GUARD=".length));
  assert.equal(decision.allow_claim, false);
  assert.equal(decision.reason, "guarded_publish_window_quiet_period");
});

test("candidate monitor worker remains active during the pre-publish quiet period", () => {
  const guard = createContentWorkerClaimGuard({
    env: {},
    kinds: ["candidate_supply_monitor"],
  });

  const decision = guard({ now: new Date("2026-07-17T08:50:00.000Z") });
  assert.equal(decision.allow_claim, true);
  assert.equal(decision.reason, "guarded_publish_window_safe_kinds");
});

test("local sqlite content worker npm command uses the supervised Windows launcher", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const command = packageJson.scripts["ops:local-sqlite-content-worker"];

  assert.match(command, /^powershell\b/i);
  assert.match(command, /tools\/local-live-content-workers\.ps1/i);
  assert.doesNotMatch(command, /\bnode\b[\s\S]*local-sqlite-content-worker\.js/i);
});
