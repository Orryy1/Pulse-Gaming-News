"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  buildLocalTtsStartSpec,
  classifyLocalTtsDoctorAction,
  renderLocalTtsDoctorMarkdown,
  resolveLocalTtsRuntimePaths,
  startLocalTtsServer,
} = require("../../lib/studio/local-tts-supervisor");

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-local-tts-"));
  fs.mkdirSync(path.join(root, "tts_server", "venv", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "tts_server", "venv", "Scripts", "python.exe"), "");
  return root;
}

test("resolveLocalTtsRuntimePaths uses the repo venv python when present", () => {
  const root = tempRoot();
  const paths = resolveLocalTtsRuntimePaths({ root, platform: "win32", env: {} });

  assert.equal(paths.serverDir, path.join(root, "tts_server"));
  assert.equal(
    paths.pythonPath,
    path.join(root, "tts_server", "venv", "Scripts", "python.exe"),
  );
  assert.match(paths.stdoutPath, /server_stdout\.log$/);
  assert.match(paths.stderrPath, /server_stderr\.log$/);
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
  assert.equal(captured.cmd.endsWith("python.exe"), true);
  assert.equal(captured.opts.detached, true);
  assert.equal(captured.opts.windowsHide, true);
  assert.equal(captured.opts.cwd, path.join(root, "tts_server"));
  assert.match(result.spec.stdoutPath, /server_stdout\.log$/);
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
