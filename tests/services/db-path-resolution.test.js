/**
 * tests/services/db-path-resolution.test.js
 *
 * Pins the SQLITE_DB_PATH env-var contract added after the 2026-04-19
 * "DB wipe on deploy" incident. Railway's container filesystem is
 * ephemeral; without SQLITE_DB_PATH pointing at a persistent volume,
 * every redeploy wipes stories / approvals / scores / jobs.
 *
 * Run: node --test tests/services/db-path-resolution.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveDbPath } = require("../../lib/db");

// Save/restore env around each test so we don't leak SQLITE_DB_PATH
// into the rest of the test pack.
function withEnv(patch, fn) {
  const keys = [
    "SQLITE_DB_PATH",
    "NODE_ENV",
    "RAILWAY_ENVIRONMENT",
    "RAILWAY_PUBLIC_URL",
  ];
  const before = {};
  for (const k of keys) before[k] = process.env[k];
  try {
    for (const k of keys) delete process.env[k];
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

test("resolveDbPath: defaults to <repo>/data/pulse.db when env unset", () => {
  const p = withEnv({}, () => resolveDbPath());
  assert.ok(p.endsWith(path.join("data", "pulse.db")));
  assert.ok(path.isAbsolute(p));
});

test("resolveDbPath: SQLITE_DB_PATH (absolute) is used verbatim", () => {
  const target =
    process.platform === "win32" ? "C:\\data\\pulse.db" : "/data/pulse.db";
  const p = withEnv({ SQLITE_DB_PATH: target }, () => resolveDbPath());
  assert.equal(p, target);
});

test("resolveDbPath: SQLITE_DB_PATH (relative) is resolved against cwd", () => {
  const p = withEnv({ SQLITE_DB_PATH: "var/pulse.db" }, () => resolveDbPath());
  assert.ok(path.isAbsolute(p));
  assert.ok(p.endsWith(path.join("var", "pulse.db")));
});

test("resolveDbPath: whitespace-only SQLITE_DB_PATH falls back to default", () => {
  const p = withEnv({ SQLITE_DB_PATH: "   " }, () => resolveDbPath());
  assert.ok(p.endsWith(path.join("data", "pulse.db")));
});

test("resolveDbPath: prod + ephemeral path -> returns path but logs a warning", () => {
  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(String(msg));
  try {
    const p = withEnv(
      { NODE_ENV: "production", SQLITE_DB_PATH: "/app/data/pulse.db" },
      () => resolveDbPath(),
    );
    assert.equal(p, "/app/data/pulse.db");
    // Warning should mention the ephemeral concern + suggest the fix.
    const warned = logs.some(
      (l) =>
        l.includes("[db] WARNING") &&
        l.includes("ephemeral") &&
        l.includes("SQLITE_DB_PATH"),
    );
    assert.ok(
      warned,
      `expected prod-ephemeral warning; got logs: ${logs.join(" | ")}`,
    );
  } finally {
    console.log = origLog;
  }
});

test("resolveDbPath: prod + explicit volume path -> no ephemeral warning", () => {
  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(String(msg));
  try {
    const target =
      process.platform === "win32" ? "C:\\data\\pulse.db" : "/data/pulse.db";
    withEnv({ NODE_ENV: "production", SQLITE_DB_PATH: target }, () =>
      resolveDbPath(),
    );
    const warned = logs.some((l) => l.includes("[db] WARNING"));
    assert.equal(
      warned,
      false,
      `no warning expected for non-ephemeral path; got: ${logs.join(" | ")}`,
    );
  } finally {
    console.log = origLog;
  }
});

test("resolveDbPath: dev + default repo path -> no warning (dev parity)", () => {
  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(String(msg));
  try {
    withEnv({}, () => resolveDbPath()); // no NODE_ENV, no SQLITE_DB_PATH
    const warned = logs.some((l) => l.includes("[db] WARNING"));
    assert.equal(
      warned,
      false,
      `no warning expected in dev; got: ${logs.join(" | ")}`,
    );
  } finally {
    console.log = origLog;
  }
});

test("resolveDbPath: RAILWAY_ENVIRONMENT is also treated as production for warning", () => {
  const logs = [];
  const origLog = console.log;
  console.log = (msg) => logs.push(String(msg));
  try {
    withEnv(
      {
        RAILWAY_ENVIRONMENT: "production",
        SQLITE_DB_PATH: "/app/data/pulse.db",
      },
      () => resolveDbPath(),
    );
    const warned = logs.some(
      (l) => l.includes("[db] WARNING") && l.includes("ephemeral"),
    );
    assert.ok(warned, "RAILWAY_ENVIRONMENT should trigger prod warning");
  } finally {
    console.log = origLog;
  }
});
