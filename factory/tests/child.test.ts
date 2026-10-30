import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOAD_TIMEOUT_SECONDS,
  cappedTimeout,
  runCapped,
  timedOut,
} from "../src/lib/child.ts";

test("a child's timeout never exceeds the download cap, and the cap applies when none was asked for", () => {
  assert.equal(DOWNLOAD_TIMEOUT_SECONDS, 300);
  assert.equal(cappedTimeout(undefined), 300_000);
  assert.equal(cappedTimeout(0), 300_000);
  assert.equal(cappedTimeout(90_000), 90_000);
  assert.equal(cappedTimeout(900_000), 300_000);
  assert.equal(cappedTimeout(900_000, 120), 120_000);
  assert.equal(timedOut({ killed: true, signal: "SIGKILL" }), true);
  assert.equal(timedOut(new Error("exit 1")), false);
});

test("a child that overruns is killed and the error says so; a quick one returns its output", async () => {
  const started = Date.now();
  await assert.rejects(
    runCapped(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], {
      timeout: 500,
    }),
    (err: Error & { killed?: boolean }) => {
      assert.match(err.message, /killed after 1s/);
      assert.equal(err.killed, true);
      return true;
    },
  );
  assert.ok(
    Date.now() - started < 10_000,
    "killed well inside the child's own 30 s",
  );
  const r = await runCapped(process.execPath, [
    "-e",
    "process.stdout.write('ok')",
  ]);
  assert.equal(r.stdout, "ok");
});
