"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");

test("OAuth initiator routes require operator auth", () => {
  assert.match(
    src,
    /app\.get\(\s*["']\/auth\/tiktok["']\s*,\s*requireAuthHeaderOrQuery\s*,/,
  );
  assert.match(
    src,
    /app\.get\(\s*["']\/auth\/facebook["']\s*,\s*requireAuthHeaderOrQuery\s*,/,
  );
});

test("OAuth callback routes remain public but state-checked", () => {
  assert.match(src, /app\.get\(\s*["']\/auth\/tiktok\/callback["']\s*,\s*async/);
  assert.match(
    src,
    /app\.get\(\s*["']\/auth\/facebook\/callback["']\s*,\s*async/,
  );
  assert.match(src, /consumeState\(state,\s*["']tiktok["']\)/);
  assert.match(src, /consumeState\(state,\s*["']facebook["']\)/);
});
