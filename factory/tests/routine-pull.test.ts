// The PC's routine-file puller (windows/pull-routine-files.mjs): a factory restart must not end a run with an
// error code (the PC watchdog flagged 0x1 for every deploy, 27 Nov); a long outage still must.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve("windows/pull-routine-files.mjs");

function run(base: string, dir: string): Promise<{ code: number | null; out: string }> {
  // Async, not spawnSync: a sync child would block the in-process test server.
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, base], {
      env: { ...process.env, ROUTINE_PC_DIR: dir, ROUTINE_RETRY_WAITS_MS: "20,20" },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

// A port that refuses connections: bind, note it, close.
async function closedBase(): Promise<string> {
  const s = http.createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise((r) => s.close(r));
  return `http://127.0.0.1:${port}`;
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "routinepull-"));

test("a 503 blip is retried inside the run and the file arrives", async () => {
  const dir = tmp();
  const body = Buffer.from("picture");
  let listCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/routine/pc-files")) {
      if (listCalls++ === 0) return void res.writeHead(503).end();
      res.setHeader("content-type", "application/json");
      return void res.end(
        JSON.stringify({
          dir,
          files: [{ rel: "ab/one.png", id: "0123456789abcdef", size: body.length, mtimeMs: Date.now(), fetched: false }],
        }),
      );
    }
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const { code, out } = await run(`http://127.0.0.1:${port}`, dir);
  server.close();
  assert.equal(code, 0, out);
  assert.equal(fs.readFileSync(path.join(dir, "ab", "one.png"), "utf8"), "picture");
  assert.ok(fs.existsSync(path.join(dir, "last-ok.txt")));
});

test("unreachable but answered within the hour: logged, exit 0", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "last-ok.txt"), new Date().toISOString());
  const { code } = await run(await closedBase(), dir);
  assert.equal(code, 0);
  const log = fs.readFileSync(path.join(dir, "pull.log"), "utf8");
  assert.match(log, /failed: fetch failed \(ECONNREFUSED/);
  assert.match(log, /next run catches up/);
});

test("unreachable for over an hour (or never reached): exit 1", async () => {
  const dir = tmp();
  assert.equal((await run(await closedBase(), dir)).code, 1);
  fs.writeFileSync(path.join(dir, "last-ok.txt"), new Date(Date.now() - 2 * 3600_000).toISOString());
  assert.equal((await run(await closedBase(), dir)).code, 1);
});

test("a 404 is a real fault: exit 1 even within the hour, no retries", async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "last-ok.txt"), new Date().toISOString());
  let calls = 0;
  const server = http.createServer((_req, res) => {
    calls++;
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const { code } = await run(`http://127.0.0.1:${port}`, dir);
  server.close();
  assert.equal(code, 1);
  assert.equal(calls, 1);
});

test("a 503 on the file download is retried; a size mismatch is not an alarm", async () => {
  const dir = tmp();
  let fileCalls = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/routine/pc-files")) {
      res.setHeader("content-type", "application/json");
      return void res.end(
        JSON.stringify({
          dir,
          files: [
            { rel: "ab/one.png", id: "0123456789abcdef", size: 3, mtimeMs: Date.now(), fetched: false },
            { rel: "ab/two.png", id: "fedcba9876543210", size: 99, mtimeMs: Date.now(), fetched: false },
          ],
        }),
      );
    }
    if (req.url?.includes("0123456789abcdef") && fileCalls++ === 0) return void res.writeHead(503).end();
    res.end("abc");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const { code, out } = await run(`http://127.0.0.1:${port}`, dir);
  server.close();
  assert.equal(code, 0, out);
  assert.equal(fs.readFileSync(path.join(dir, "ab", "one.png"), "utf8"), "abc");
  assert.ok(!fs.existsSync(path.join(dir, "ab", "two.png")));
  assert.match(out, /two.png: got 3 bytes, expected 99; trying again next run/);
});
