"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function assertDotenvBeforeDb(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const dotenvConfig = source.indexOf("dotenv.config");
  const dbRequire = source.indexOf('require("./lib/db")');
  assert.ok(dotenvConfig >= 0, `${file} should call dotenv.config`);
  assert.ok(dbRequire >= 0, `${file} should require ./lib/db`);
  assert.ok(
    dotenvConfig < dbRequire,
    `${file} must load .env before requiring lib/db so SQLITE_DB_PATH is honoured`,
  );
}

test("assemble.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("assemble.js");
});

test("run.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("run.js");
});

test("publisher.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("publisher.js");
});

test("upload_tiktok.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("upload_tiktok.js");
});
