/**
 * tests/services/inference-readiness.test.js — Phase F readiness gating.
 *
 * Validates lib/inference-client::waitForReady against a tiny in-process
 * fake of tts_server/server.py's /health contract. Tests cover:
 *   - returns immediately when /health reports phase='ready'
 *   - polls through phase='warming' to phase='ready'
 *   - acceptSkipped flag honours phase='ready-skipped'
 *   - throws InferTimeoutError when deadline expires
 *
 * Avoids touching real uvicorn by standing up a bare http.Server that
 * returns canned /health payloads.
 *
 * Run: node --test tests/services/inference-readiness.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const {
  waitForReady,
  InferTimeoutError,
} = require("../../lib/inference-client");

/** Spin up a fake /health server that returns the payloads from the
 * supplied iterator in sequence. Resolves to { baseUrl, close } once
 * listening. */
function fakeHealthServer(payloads) {
  let i = 0;
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url !== "/health") {
        res.writeHead(404);
        res.end();
        return;
      }
      const payload = payloads[Math.min(i, payloads.length - 1)];
      i += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => srv.close(() => r())),
      });
    });
  });
}

test("waitForReady: returns immediately when /health already reports ready", async () => {
  const { baseUrl, close } = await fakeHealthServer([
    {
      phase: "ready",
      ready: true,
      warming: false,
      engine_count: 1,
      last_load_ms: 210_000,
    },
  ]);
  try {
    const t0 = Date.now();
    const h = await waitForReady({ baseUrl, deadlineMs: 5_000 });
    assert.equal(h.phase, "ready");
    assert.ok(
      Date.now() - t0 < 500,
      `expected <500ms, took ${Date.now() - t0}ms`,
    );
  } finally {
    await close();
  }
});

test("waitForReady: polls through warming -> ready", async () => {
  const { baseUrl, close } = await fakeHealthServer([
    { phase: "warming", ready: false, warming: true, engine_count: 0 },
    { phase: "warming", ready: false, warming: true, engine_count: 0 },
    {
      phase: "ready",
      ready: true,
      warming: false,
      engine_count: 1,
      last_load_ms: 180_000,
    },
  ]);
  try {
    const h = await waitForReady({
      baseUrl,
      deadlineMs: 15_000,
      pollIntervalMs: 200,
    });
    assert.equal(h.phase, "ready");
  } finally {
    await close();
  }
});

test("waitForReady: acceptSkipped=true returns on ready-skipped", async () => {
  const { baseUrl, close } = await fakeHealthServer([
    { phase: "ready-skipped", ready: true, warming: false, engine_count: 0 },
  ]);
  try {
    const h = await waitForReady({
      baseUrl,
      deadlineMs: 3_000,
      acceptSkipped: true,
    });
    assert.equal(h.phase, "ready-skipped");
  } finally {
    await close();
  }
});

test("waitForReady: acceptSkipped=false does NOT return on ready-skipped", async () => {
  // Server always reports ready-skipped — waitForReady should time out.
  const { baseUrl, close } = await fakeHealthServer([
    { phase: "ready-skipped", ready: true, warming: false, engine_count: 0 },
  ]);
  try {
    await assert.rejects(
      () =>
        waitForReady({
          baseUrl,
          deadlineMs: 1_200,
          pollIntervalMs: 200,
          acceptSkipped: false,
        }),
      (err) => err instanceof InferTimeoutError,
    );
  } finally {
    await close();
  }
});

test("waitForReady: throws InferTimeoutError when deadline expires on warming", async () => {
  // Server stays in warming forever
  const { baseUrl, close } = await fakeHealthServer([
    { phase: "warming", ready: false, warming: true, engine_count: 0 },
  ]);
  try {
    await assert.rejects(
      () =>
        waitForReady({
          baseUrl,
          deadlineMs: 1_200,
          pollIntervalMs: 200,
        }),
      (err) => {
        assert.ok(err instanceof InferTimeoutError);
        assert.equal(err.kind, "waitForReady");
        return true;
      },
    );
  } finally {
    await close();
  }
});
