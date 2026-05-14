"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("tiktok-inbox-upload loads dotenv before opening the DB", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "tiktok-inbox-upload.js"),
    "utf8",
  );
  const dotenvConfig = src.indexOf('dotenv.config({ override: true })');
  const dbRequire = src.indexOf('require("../lib/db")');

  assert.ok(dotenvConfig >= 0, "dotenv config call must exist");
  assert.ok(dbRequire >= 0, "db require must exist");
  assert.ok(
    dotenvConfig < dbRequire,
    "dotenv must load before lib/db so DATABASE_PATH / USE_SQLITE are honoured",
  );
});

test("tiktok-inbox-upload requires an operator confirmation flag before live inbox send", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "tools", "tiktok-inbox-upload.js"),
    "utf8",
  );

  assert.match(src, /--operator-confirmed/);
  assert.match(src, /tiktok_inbox_upload_requires_operator_confirmed_flag/);
  assert.match(src, /process\.env\.TIKTOK_ENABLED = "true"/);
  assert.match(src, /process\.env\.TIKTOK_AUTO_UPLOAD_ENABLED = "true"/);
});
