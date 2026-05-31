"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildLocalTtsStartSpec,
  classifyLocalTtsDoctorAction,
  hasRecentLocalTtsBootAttempt,
  renderLocalTtsDoctorMarkdown,
  resolveLocalTtsRuntimePaths,
  resolveWindowlessPythonPath,
  startLocalTtsServer,
} = require("../../lib/studio/local-tts-supervisor");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-local-tts-"));
  fs.mkdirSync(path.join(root, "tts_server", "venv", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "tts_server", "venv", "Scripts", "python.exe"), "");
  fs.writeFileSync(path.join(root, "tts_server", "venv", "Scripts", "pythonw.exe"), "");
  return root;
}

test("resolveLocalTtsRuntimePaths uses the windowless repo venv python on Windows when present", () => {
  const root = tempRoot();
  const paths = resolveLocalTtsRuntimePaths({ root, platform: "win32", env: {} });

  assert.equal(paths.serverDir, path.join(root, "tts_server"));
  assert.equal(
    paths.pythonPath,
    path.join(root, "tts_server", "venv", "Scripts", "pythonw.exe"),
  );
  assert.match(paths.stdoutPath, /server_stdout\.log$/);
  assert.match(paths.stderrPath, /server_stderr\.log$/);
});

test("resolveLocalTtsRuntimePaths falls back to console python when pythonw is unavailable", () => {
  const root = tempRoot();
  fs.rmSync(path.join(root, "tts_server", "venv", "Scripts", "pythonw.exe"));
  const paths = resolveLocalTtsRuntimePaths({ root, platform: "win32", env: {} });

  assert.equal(
    paths.pythonPath,
    path.join(root, "tts_server", "venv", "Scripts", "python.exe"),
  );
});

test("resolveLocalTtsRuntimePaths upgrades env console python override to pythonw on Windows", () => {
  const root = tempRoot();
  const python = path.join(root, "tts_server", "venv", "Scripts", "python.exe");
  const paths = resolveLocalTtsRuntimePaths({
    root,
    platform: "win32",
    env: { LOCAL_TTS_PYTHON: python },
  });

  assert.equal(
    paths.pythonPath,
    path.join(root, "tts_server", "venv", "Scripts", "pythonw.exe"),
  );
});

test("resolveWindowlessPythonPath honours explicit console debugging opt-in", () => {
  const root = tempRoot();
  const python = path.join(root, "tts_server", "venv", "Scripts", "python.exe");
  const selected = resolveWindowlessPythonPath(python, {
    platform: "win32",
    env: { LOCAL_TTS_ALLOW_CONSOLE: "1" },
  });

  assert.equal(selected, python);
});

test("buildLocalTtsStartSpec starts uvicorn on localhost without shell quoting", () => {
  const root = tempRoot();
  const spec = buildLocalTtsStartSpec({
    root,
    platform: "win32",
    env: { LOCAL_TTS_PORT: "9999" },
  });

  assert.equal(spec.args[0], "-m");
  assert.ok(spec.args.includes("uvicorn"));
  assert.ok(spec.args.includes("127.0.0.1"));
  assert.ok(spec.args.includes("9999"));
  assert.equal(JSON.stringify(spec).includes("API_KEY"), false);
});

test("classifyLocalTtsDoctorAction chooses safe local recovery actions", () => {
  assert.equal(
    classifyLocalTtsDoctorAction({ status: "unreachable" }, { allowRestart: false }).action,
    "manual_start_required",
  );
  assert.equal(
    classifyLocalTtsDoctorAction({ status: "unreachable" }, { allowRestart: true }).action,
    "start",
  );
  assert.equal(
    classifyLocalTtsDoctorAction(
      {
        status: "ok",
        ready: true,
        phase: "ready-skipped",
        voice: { present: true, refResolved: true, loaded: false },
      },
      { allowPrewarm: true },
    ).action,
    "prewarm",
  );
  assert.equal(
    classifyLocalTtsDoctorAction({ ok: true }).verdict,
    "green",
  );
});

test("startLocalTtsServer spawns detached hidden local process and returns logs", async () => {
  const root = tempRoot();
  let captured = null;
  const result = await startLocalTtsServer({
    root,
    platform: "win32",
    env: {},
    spawnImpl: (cmd, args, opts) => {
      captured = { cmd, args, opts };
      return { pid: 12345, unref() {} };
    },
  });

  assert.equal(result.pid, 12345);
  assert.equal(captured.cmd.endsWith("pythonw.exe"), true);
  assert.equal(captured.opts.detached, true);
  assert.equal(captured.opts.windowsHide, true);
  assert.equal(captured.opts.cwd, path.join(root, "tts_server"));
  assert.match(result.spec.stdoutPath, /server_stdout\.log$/);
});

test("startLocalTtsServer skips duplicate starts while a fresh start lock exists", async () => {
  const root = tempRoot();
  const logsDir = path.join(root, "tts_server", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, "server_start.lock"),
    JSON.stringify({ started_at: new Date().toISOString(), pid: 1111 }),
  );

  let spawned = false;
  const result = await startLocalTtsServer({
    root,
    platform: "win32",
    env: {},
    spawnImpl: () => {
      spawned = true;
      return { pid: 12345, unref() {} };
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "start_lock_active");
  assert.equal(result.pid, null);
});

test("startLocalTtsServer skips restart loops after a recent boot log entry", async () => {
  const root = tempRoot();
  const logsDir = path.join(root, "tts_server", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(
    path.join(logsDir, "server_stderr.log"),
    [
      "2026-05-31 16:24:20,014 [tts_server] INFO: [boot] pulse-gaming tts_server starting ts=2026-05-31T15:24:20Z device=cuda",
      "2026-05-31 16:24:21,100 [voxcpm] INFO: Loading VoxCPM 2 from openbmb/VoxCPM2 on cuda...",
    ].join("\n"),
  );

  let spawned = false;
  const result = await startLocalTtsServer({
    root,
    platform: "win32",
    env: {},
    now: Date.parse("2026-05-31T15:39:19Z"),
    spawnImpl: () => {
      spawned = true;
      return { pid: 12345, unref() {} };
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "recent_boot_cooldown");
  assert.equal(result.pid, null);
  assert.equal(result.recent_boot.lastBootAt, "2026-05-31T15:24:20.000Z");
});

test("hasRecentLocalTtsBootAttempt ignores old boot log entries", () => {
  const root = tempRoot();
  const logsDir = path.join(root, "tts_server", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  const stderrPath = path.join(logsDir, "server_stderr.log");
  fs.writeFileSync(
    stderrPath,
    "2026-05-31 09:30:20,704 [tts_server] INFO: [boot] pulse-gaming tts_server starting ts=2026-05-31T08:30:20Z device=cuda\n",
  );

  const recent = hasRecentLocalTtsBootAttempt(stderrPath, {
    now: Date.parse("2026-05-31T10:30:21Z"),
    cooldownMs: 30 * 60 * 1000,
  });

  assert.equal(recent.recent, false);
  assert.equal(recent.lastBootAt, "2026-05-31T08:30:20.000Z");
});

test("startLocalTtsServer honours a fresh non-json lock from the batch launcher", async () => {
  const root = tempRoot();
  const logsDir = path.join(root, "tts_server", "logs");
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(path.join(logsDir, "server_start.lock"), "Sun 31/05/2026 12:00:00");

  let spawned = false;
  const result = await startLocalTtsServer({
    root,
    platform: "win32",
    env: {},
    spawnImpl: () => {
      spawned = true;
      return { pid: 12345, unref() {} };
    },
  });

  assert.equal(spawned, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "start_lock_active");
});

test("renderLocalTtsDoctorMarkdown is operator-readable and local-only", () => {
  const md = renderLocalTtsDoctorMarkdown({
    verdict: "amber",
    action: "prewarm",
    reason: "voice not loaded",
    failure_code: "voice_not_loaded",
    before: {
      status: "ok",
      phase: "ready-skipped",
      ready: true,
      voice: { alias: "liam", loaded: false, refResolved: true },
    },
    after: {
      status: "ok",
      phase: "ready",
      ready: true,
      voice: { alias: "liam", loaded: true, refResolved: true },
    },
  });

  assert.match(md, /Local TTS Doctor/);
  assert.match(md, /failure code: voice_not_loaded/);
  assert.match(md, /Local-only/);
  assert.doesNotMatch(md, /access_token|secret|API_KEY/i);
});
