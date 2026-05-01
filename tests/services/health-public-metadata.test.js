"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");
const start = src.indexOf('app.get("/api/health"');
const end = src.indexOf("// Public, unauthenticated news feed");
const healthBlock = src.slice(start, end);

test("/api/health public metadata does not expose raw commit messages", () => {
  assert.notEqual(start, -1, "health route not found");
  assert.notEqual(end, -1, "health block end marker not found");
  assert.doesNotMatch(healthBlock, /commit_message\s*:/);
});

test("/api/health public metadata redacts raw SQLite filesystem paths", () => {
  assert.notEqual(start, -1, "health route not found");
  assert.doesNotMatch(healthBlock, /sqlite_db_path\s*:\s*sqliteDbPath\s*[,}]/);
});
