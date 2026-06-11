"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const HANDLERS_PATH = require.resolve("../../lib/job-handlers");

function loadHandlersWithSpawn(fakeSpawn) {
  const cp = require("node:child_process");
  const originalSpawn = cp.spawn;
  delete require.cache[HANDLERS_PATH];
  cp.spawn = fakeSpawn;
  const loaded = require("../../lib/job-handlers");
  cp.spawn = originalSpawn;
  return loaded;
}

function fakeChild({ code = 0, stdout = "", stderr = "" } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code, null);
  });
  return child;
}

test("produce job handler runs the produce CLI in a child process", async () => {
  let captured = null;
  const logs = [];
  const { handlers } = loadHandlersWithSpawn((command, args, options) => {
    captured = { command, args, options };
    return fakeChild({ stdout: "[run] Produce complete\n" });
  });

  const result = await handlers.produce(
    { id: 42, kind: "produce" },
    { log: (line) => logs.push(line) },
  );

  assert.equal(captured.command, process.execPath);
  assert.deepEqual(captured.args, ["run.js", "produce"]);
  assert.equal(captured.options.cwd, path.resolve(__dirname, "..", ".."));
  assert.equal(captured.options.windowsHide, true);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "child_process");
  assert.equal(result.exit_code, 0);
  assert.match(result.stdout_tail, /Produce complete/);
  assert.ok(logs.some((line) => line.includes("[produce-child] [run] Produce complete")));
});

test("produce job handler fails the job when the child process exits non-zero", async () => {
  const { handlers } = loadHandlersWithSpawn(() =>
    fakeChild({ code: 7, stderr: "fatal produce failure\n" }),
  );

  await assert.rejects(
    handlers.produce({ id: 43, kind: "produce" }, { log: () => {} }),
    /produce child process failed with code 7: fatal produce failure/,
  );
});
