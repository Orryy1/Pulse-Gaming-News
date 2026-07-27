"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { test } = require("node:test");
const path = require("node:path");
const Database = require("better-sqlite3");
const {
  parseArgs: parseSupervisorArgs,
} = require("../../tools/windows-local-runtime-supervisor");

const ROOT = path.resolve(__dirname, "..", "..");
const TOOL = path.join(ROOT, "tools", "windows-local-runtime-supervisor.js");
const {
  buildChildEnvironment,
  buildLifecycleDecision,
  buildScheduledTaskCommand,
  classifyPortOwnership,
  executeLifecycleAction,
  inspectCheckout,
  inspectDatabase,
  loadSafeRuntimeProfile,
  profileFingerprint,
  validateSafeRuntimeProfile,
} = require("../../lib/stabilisation/windows-local-runtime-supervisor");

function createReadyFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-runtime-source-"));
  const databaseRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-runtime-db-"),
  );
  const migrationsDir = path.join(root, "db", "migrations");
  const toolsDir = path.join(root, "tools");
  fs.mkdirSync(migrationsDir, { recursive: true });
  fs.mkdirSync(toolsDir, { recursive: true });
  fs.writeFileSync(path.join(root, "server.js"), '"use strict";\n', "utf8");
  fs.writeFileSync(
    path.join(toolsDir, "windows-local-runtime-supervisor.js"),
    '"use strict";\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "package.json"),
    '{"name":"pulse-runtime-fixture","private":true}\n',
    "utf8",
  );
  const migrationName = "001_fixture.sql";
  const migrationBody = "CREATE TABLE fixture (id INTEGER PRIMARY KEY);\n";
  fs.writeFileSync(
    path.join(migrationsDir, migrationName),
    migrationBody,
    "utf8",
  );

  execFileSync("git", ["init", "-b", "release/pulse-v1"], {
    cwd: root,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.email", "pulse-tests@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Pulse Tests"], { cwd: root });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: root,
    stdio: "ignore",
  });
  const commit = String(
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }),
  ).trim();

  const databasePath = path.join(databaseRoot, "pulse.db");
  const db = new Database(databasePath);
  db.exec(`
    CREATE TABLE schema_migrations (
      version TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE fixture (id INTEGER PRIMARY KEY);
  `);
  db.prepare(
    `INSERT INTO schema_migrations
       (version, filename, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  ).run(
    "001",
    migrationName,
    crypto.createHash("sha256").update(migrationBody).digest("hex"),
    "2026-07-27T00:00:00.000Z",
  );
  db.close();

  return {
    root,
    databaseRoot,
    databasePath,
    migrationsDir,
    commit,
  };
}

function removeReadyFixture(fixture) {
  fs.rmSync(fixture.root, { recursive: true, force: true });
  fs.rmSync(fixture.databaseRoot, { recursive: true, force: true });
}

test("the committed Windows runtime profile is human-review-only and cannot arm publication", () => {
  const profile = loadSafeRuntimeProfile({
    profilePath: path.join(
      ROOT,
      "config",
      "windows-local-runtime.stabilisation.json",
    ),
  });
  const validation = validateSafeRuntimeProfile(profile);

  assert.deepEqual(validation, { valid: true, blockers: [] });
  assert.equal(profile.port, 3001);
  assert.equal(profile.database_path, "D:/pulse-data/pulse.db");
  assert.equal(profile.environment.PULSE_OPERATING_MODE, "HUMAN_REVIEW");
  assert.equal(profile.environment.PULSE_SCHEDULER_PROFILE, "stabilisation_30d");
  assert.equal(profile.environment.PULSE_PRIMARY_INSTANCE, "true");
  assert.equal(profile.environment.USE_SQLITE, "true");
  assert.equal(profile.environment.USE_JOB_QUEUE, "true");
  assert.equal(profile.environment.AUTO_PUBLISH, "false");
  assert.equal(
    profile.environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    "false",
  );
  assert.equal(profile.environment.PULSE_EMERGENCY_KILL_SWITCH, "true");
  assert.equal(profile.environment.PULSE_KILL_SWITCH, "true");

  for (const key of [
    "TIKTOK_ENABLED",
    "TIKTOK_AUTO_PUBLISH",
    "INSTAGRAM_AUTO_PUBLISH",
    "FACEBOOK_AUTO_PUBLISH",
    "TWITTER_ENABLED",
    "X_AUTO_PUBLISH",
    "THREADS_AUTO_PUBLISH",
    "PINTEREST_AUTO_PUBLISH",
  ]) {
    assert.equal(profile.environment[key], "false", key);
  }
});

test("the runtime profile rejects every unreviewed environment key", () => {
  const profile = loadSafeRuntimeProfile();
  profile.environment.UNREVIEWED_RUNTIME_FLAG = "value";
  const validation = validateSafeRuntimeProfile(profile);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.blockers.includes(
      "unreviewed_environment:UNREVIEWED_RUNTIME_FLAG",
    ),
  );
});

test("a clean exact release checkout and fully migrated SQLite file pass read-only inspection", () => {
  const fixture = createReadyFixture();
  try {
    const before = fs.statSync(fixture.databasePath);
    const checkout = inspectCheckout({
      repoRoot: fixture.root,
      expectedCommit: fixture.commit,
      expectedBranch: "release/pulse-v1",
      allowDetachedHead: true,
    });
    const database = inspectDatabase({
      dbPath: fixture.databasePath,
      migrationsDir: fixture.migrationsDir,
    });
    const after = fs.statSync(fixture.databasePath);

    assert.equal(checkout.ready, true);
    assert.equal(checkout.commit_sha, fixture.commit);
    assert.equal(checkout.branch, "release/pulse-v1");
    assert.equal(checkout.clean, true);
    assert.equal(database.ready, true);
    assert.equal(database.read_only, true);
    assert.equal(database.quick_check, "ok");
    assert.equal(database.foreign_key_check, "ok");
    assert.deepEqual(database.pending, []);
    assert.deepEqual(database.checksum_mismatches, []);
    assert.deepEqual(database.unexpected_applied, []);
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeMs, before.mtimeMs);
  } finally {
    removeReadyFixture(fixture);
  }
});

test("start is a dry-run plan by default even when every readiness gate passes", () => {
  const decision = buildLifecycleDecision({
    action: "start",
    applyRequested: false,
    confirmation: null,
    profileValidation: { valid: true, blockers: [] },
    checkout: { ready: true, blockers: [] },
    database: { ready: true, blockers: [] },
    port: { state: "free", blockers: [] },
  });

  assert.equal(decision.ready, true);
  assert.equal(decision.dry_run, true);
  assert.equal(decision.mutation_authorised, false);
  assert.equal(decision.production_green, false);
  assert.equal(decision.external_publish_possible, false);
  assert.equal(decision.oauth_mutation_possible, false);
  assert.deepEqual(decision.blockers, []);
});

test("port 3001 is managed only when the owner receipt, process and safe health identity agree", () => {
  const profile = loadSafeRuntimeProfile();
  const expectedCommit = "a".repeat(40);
  const repoRoot = "C:/Pulse/runtime";
  const port = classifyPortOwnership({
    listeningPids: [4123],
    ownerState: {
      schema_version: "pulse-windows-local-runtime-owner-v1",
      runtime_owner_id: profile.runtime_owner_id,
      pid: 4123,
      port: 3001,
      repo_root: repoRoot,
      commit_sha: expectedCommit,
      profile_fingerprint: profileFingerprint(profile),
    },
    processObservations: [
      {
        pid: 4123,
        running: true,
        command_identity: "node_server_js",
      },
    ],
    health: {
      build: { commit_sha: expectedCommit },
      deployment: { mode: "local", primary: true },
      runtime: {
        operating_mode: "HUMAN_REVIEW",
        auto_publish: false,
        legacy_auto_publish_armed: false,
        use_sqlite: true,
        use_job_queue_explicit: "true",
      },
    },
    expectedCommit,
    repoRoot,
    profile,
  });

  assert.equal(port.state, "managed_current");
  assert.deepEqual(port.listener_pids, [4123]);
  assert.equal(port.owner_pid, 4123);
  assert.equal(port.health_safe, true);
  assert.deepEqual(port.blockers, []);
});

test("the Windows supervisor CLI defaults to a machine-readable non-mutating plan", () => {
  const fixture = createReadyFixture();
  try {
    const output = execFileSync(
      process.execPath,
      [
        TOOL,
        "--repo-root",
        fixture.root,
        "--expected-commit",
        fixture.commit,
        "--db-path",
        fixture.databasePath,
      ],
      { cwd: ROOT, encoding: "utf8" },
    );
    const report = JSON.parse(output);

    assert.equal(report.schema_version, "pulse-windows-local-runtime-plan-v1");
    assert.equal(report.action, "plan");
    assert.equal(report.decision.dry_run, true);
    assert.equal(report.decision.mutation_authorised, false);
    assert.equal(report.decision.production_green, false);
    assert.equal(report.profile.environment.AUTO_PUBLISH, "false");
    assert.equal(
      report.profile.environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
      "false",
    );
    assert.equal(
      report.profile.environment.PULSE_EMERGENCY_KILL_SWITCH,
      "true",
    );
  } finally {
    removeReadyFixture(fixture);
  }
});

test("a lifecycle action cannot execute unless the evaluated decision explicitly authorises mutation", async () => {
  let calls = 0;
  const lifecycle = Object.fromEntries(
    ["install", "start", "restart", "stop", "uninstall"].map((action) => [
      action,
      async () => {
        calls += 1;
      },
    ]),
  );
  const execution = await executeLifecycleAction({
    report: {
      action: "start",
      decision: {
        mutation_authorised: false,
        dry_run: true,
        planned_effect: "start",
      },
    },
    profile: loadSafeRuntimeProfile(),
    options: {
      repoRoot: ROOT,
      expectedCommit: "a".repeat(40),
    },
    lifecycle,
  });

  assert.equal(calls, 0);
  assert.deepEqual(execution, {
    executed: false,
    effect: "start",
    reason: "dry_run_or_blocked",
  });
});

test("the child runtime environment strips inherited credentials and remains publication-incapable", () => {
  const secret = "never-inherit-this-secret";
  const environment = buildChildEnvironment({
    profile: loadSafeRuntimeProfile(),
    expectedCommit: "b".repeat(40),
    systemEnvironment: {
      SystemRoot: "C:\\Windows",
      PATH: "C:\\Windows\\System32",
      ELEVENLABS_API_KEY: secret,
      YOUTUBE_REFRESH_TOKEN: secret,
      AUTO_PUBLISH: "true",
      PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
      PULSE_EMERGENCY_KILL_SWITCH: "false",
    },
  });
  const serialised = JSON.stringify(environment);

  assert.doesNotMatch(serialised, new RegExp(secret));
  assert.equal(environment.ELEVENLABS_API_KEY, undefined);
  assert.equal(environment.YOUTUBE_REFRESH_TOKEN, undefined);
  assert.equal(environment.AUTO_PUBLISH, "false");
  assert.equal(environment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED, "false");
  assert.equal(environment.PULSE_EMERGENCY_KILL_SWITCH, "true");
  assert.equal(environment.PULSE_KILL_SWITCH, "true");
  assert.equal(environment.PULSE_OPERATING_MODE, "HUMAN_REVIEW");
  assert.equal(environment.RAILWAY_GIT_COMMIT_SHA, "b".repeat(40));
});

test("an authorised start receives only the governed child environment", async () => {
  const profile = loadSafeRuntimeProfile();
  let received = null;
  const execution = await executeLifecycleAction({
    report: {
      action: "start",
      decision: {
        mutation_authorised: true,
        dry_run: false,
        planned_effect: "start",
      },
    },
    profile,
    options: {
      repoRoot: ROOT,
      expectedCommit: "c".repeat(40),
      systemEnvironment: {
        SystemRoot: "C:\\Windows",
        PATH: "C:\\Windows\\System32",
        YOUTUBE_REFRESH_TOKEN: "must-not-reach-runtime",
      },
    },
    lifecycle: {
      async start(request) {
        received = request;
        return { pid: 7001 };
      },
    },
  });

  assert.equal(execution.executed, true);
  assert.equal(execution.result.pid, 7001);
  assert.equal(received.runtimeEnvironment.AUTO_PUBLISH, "false");
  assert.equal(
    received.runtimeEnvironment.PULSE_GUARDED_LIVE_DISPATCH_ENABLED,
    "false",
  );
  assert.equal(received.runtimeEnvironment.PULSE_EMERGENCY_KILL_SWITCH, "true");
  assert.equal(received.runtimeEnvironment.YOUTUBE_REFRESH_TOKEN, undefined);
});

test("Windows lifecycle source cannot arm platforms, mutate OAuth or adopt a SYSTEM task", () => {
  const moduleSource = fs.readFileSync(
    path.join(
      ROOT,
      "lib",
      "stabilisation",
      "windows-local-runtime-supervisor.js",
    ),
    "utf8",
  );
  const toolSource = fs.readFileSync(TOOL, "utf8");
  const profile = loadSafeRuntimeProfile();
  const source = `${moduleSource}\n${toolSource}`;
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
  );

  assert.match(source, /readonly:\s*true/);
  assert.match(source, /fileMustExist:\s*true/);
  assert.doesNotMatch(source, /\brunMigrations\b/);
  assert.doesNotMatch(
    source,
    /(?:upload_(?:youtube|tiktok|instagram|facebook)|run\.js["']?,?\s*["'](?:publish|full)|oauth.{0,40}refresh)/i,
  );
  assert.doesNotMatch(source, /AUTO_PUBLISH:\s*["']true["']/);
  assert.doesNotMatch(
    source,
    /PULSE_GUARDED_LIVE_DISPATCH_ENABLED:\s*["']true["']/,
  );
  assert.doesNotMatch(
    source,
    /PULSE_(?:EMERGENCY_)?KILL_SWITCH:\s*["'](?:false|clear)["']/,
  );
  assert.match(source, /["']ONLOGON["']/);
  assert.match(source, /["']LIMITED["']/);
  assert.doesNotMatch(source, /(?:\/RU|UserId).{0,20}(?:SYSTEM|S-1-5-18)/i);
  assert.doesNotMatch(source, /NT AUTHORITY/i);
  assert.equal(
    packageJson.scripts["ops:windows-local-runtime"],
    "node tools/windows-local-runtime-supervisor.js",
  );

  for (const key of [
    "AUTO_PUBLISH",
    "PULSE_GUARDED_LIVE_DISPATCH_ENABLED",
    "YOUTUBE_AUTO_PUBLISH",
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
    assert.equal(profile.environment[key], "false", key);
  }
});

test("a foreign listener is never adopted, restarted or stopped", () => {
  const profile = loadSafeRuntimeProfile();
  const port = classifyPortOwnership({
    listeningPids: [9999],
    ownerState: null,
    processObservations: [
      { pid: 9999, running: true, command_identity: "node_server_js" },
    ],
    health: null,
    expectedCommit: "d".repeat(40),
    repoRoot: "C:/Pulse/runtime",
    profile,
  });

  assert.equal(port.state, "foreign");
  assert.ok(port.blockers.includes("runtime_owner_receipt_missing"));
  for (const action of ["start", "restart", "stop"]) {
    const decision = buildLifecycleDecision({
      action,
      applyRequested: true,
      confirmation: "SAFE_HUMAN_REVIEW_RUNTIME",
      profileValidation: { valid: true, blockers: [] },
      checkout: { ready: true, blockers: [] },
      database: { ready: true, blockers: [] },
      port,
    });
    assert.equal(decision.ready, false, action);
    assert.equal(decision.mutation_authorised, false, action);
  }
});

test("source drift and a migration checksum mismatch both block runtime start", () => {
  const fixture = createReadyFixture();
  try {
    fs.appendFileSync(
      path.join(fixture.migrationsDir, "001_fixture.sql"),
      "-- drift\n",
      "utf8",
    );
    const checkout = inspectCheckout({
      repoRoot: fixture.root,
      expectedCommit: fixture.commit,
      expectedBranch: "release/pulse-v1",
      allowDetachedHead: true,
    });
    const database = inspectDatabase({
      dbPath: fixture.databasePath,
      migrationsDir: fixture.migrationsDir,
    });
    const decision = buildLifecycleDecision({
      action: "start",
      applyRequested: true,
      confirmation: "SAFE_HUMAN_REVIEW_RUNTIME",
      profileValidation: { valid: true, blockers: [] },
      checkout,
      database,
      port: { state: "free", blockers: [] },
    });

    assert.equal(checkout.clean, false);
    assert.ok(checkout.blockers.includes("source_checkout_dirty"));
    assert.equal(database.ready, false);
    assert.ok(
      database.blockers.includes("database_migration_checksum_mismatch"),
    );
    assert.equal(decision.ready, false);
    assert.equal(decision.mutation_authorised, false);
  } finally {
    removeReadyFixture(fixture);
  }
});

test("the pinned Scheduled Task command fits the Windows task action limit", () => {
  const command = buildScheduledTaskCommand({
    repoRoot: "C:/Pulse/runtime/pulse-v1",
    expectedCommit: "e".repeat(40),
    nodeExecutable: "C:/Program Files/nodejs/node.exe",
  });

  assert.ok(command.length <= 262, `task command is ${command.length} chars`);
  assert.match(command, /\bstart\b/);
  assert.match(command, /SAFE_HUMAN_REVIEW_RUNTIME/);
  assert.match(command, new RegExp("e".repeat(40)));
  assert.doesNotMatch(command, /AUTO_PUBLISH|GUARDED_LIVE|KILL_SWITCH/);

  const parsed = parseSupervisorArgs([
    "start",
    "-a",
    "-c",
    "SAFE_HUMAN_REVIEW_RUNTIME",
    "-r",
    "C:/Pulse/runtime/pulse-v1",
    "-e",
    "e".repeat(40),
  ]);
  assert.equal(parsed.action, "start");
  assert.equal(parsed.applyRequested, true);
  assert.equal(parsed.confirmation, "SAFE_HUMAN_REVIEW_RUNTIME");
  assert.equal(parsed.expectedCommit, "e".repeat(40));
});
