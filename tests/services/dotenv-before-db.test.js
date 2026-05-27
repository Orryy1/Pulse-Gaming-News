"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function assertDotenvBeforeDb(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const dotenvConfigCandidates = [
    source.indexOf("dotenv.config"),
    source.indexOf('require("dotenv").config'),
    source.indexOf("require('dotenv').config"),
  ].filter((index) => index >= 0);
  const dotenvConfig = dotenvConfigCandidates.length ? Math.min(...dotenvConfigCandidates) : -1;
  const dbRequireCandidates = [
    source.indexOf('require("./lib/db")'),
    source.indexOf('require("../lib/db")'),
  ].filter((index) => index >= 0);
  const dbRequire = dbRequireCandidates.length ? Math.min(...dbRequireCandidates) : -1;
  assert.ok(dotenvConfig >= 0, `${file} should call dotenv.config`);
  assert.ok(dbRequire >= 0, `${file} should require lib/db`);
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

test("affiliates.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("affiliates.js");
});

test("trusted-footage registry loads .env before lib/db", () => {
  assertDotenvBeforeDb("tools/trusted-footage-registry.js");
});
