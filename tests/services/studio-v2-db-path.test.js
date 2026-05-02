"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const { resolveStudioDbPath } = require("../../lib/studio/v2/studio-db-path");

test("resolveStudioDbPath: prefers STUDIO_V2_DB_PATH", () => {
  const p = resolveStudioDbPath({
    root: "C:/repo",
    env: {
      STUDIO_V2_DB_PATH: "D:/pulse-data/pulse.db",
      SQLITE_DB_PATH: "C:/wrong.db",
    },
  });
  assert.equal(p.replace(/\\/g, "/"), "D:/pulse-data/pulse.db");
});

test("resolveStudioDbPath: falls back to SQLITE_DB_PATH for local primary mirror", () => {
  const p = resolveStudioDbPath({
    root: "C:/repo",
    env: { SQLITE_DB_PATH: "D:/pulse-data/pulse.db" },
  });
  assert.equal(p.replace(/\\/g, "/"), "D:/pulse-data/pulse.db");
});

test("resolveStudioDbPath: defaults to repo data/pulse.db", () => {
  const p = resolveStudioDbPath({ root: "C:/repo", env: {} });
  assert.equal(p, path.join("C:/repo", "data", "pulse.db"));
});
