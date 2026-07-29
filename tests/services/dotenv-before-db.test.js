"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

function assertDotenvBeforeDb(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  const dotenvLoadCandidates = [
    source.indexOf("loadDotenvOnce({ dotenv, env: process.env })"),
    source.indexOf("dotenv.config"),
    source.indexOf('require("dotenv").config'),
    source.indexOf("require('dotenv').config"),
  ].filter((index) => index >= 0);
  const dotenvLoad = dotenvLoadCandidates.length ? Math.min(...dotenvLoadCandidates) : -1;
  const dbRequireCandidates = [
    source.indexOf('require("./lib/db")'),
    source.indexOf('require("../lib/db")'),
  ].filter((index) => index >= 0);
  const dbRequire = dbRequireCandidates.length ? Math.min(...dbRequireCandidates) : -1;
  assert.ok(dotenvLoad >= 0, `${file} should load dotenv`);
  assert.ok(dbRequire >= 0, `${file} should require lib/db`);
  assert.ok(
    dotenvLoad < dbRequire,
    `${file} must load .env before requiring lib/db so SQLITE_DB_PATH is honoured`,
  );
}

function assertOneShotDotenvBeforeDb(file) {
  const source = fs.readFileSync(path.join(ROOT, file), "utf8");
  assert.match(
    source,
    /require\("\.\/lib\/stabilisation\/runtime-config"\)/,
    `${file} should use the governed runtime-config loader`,
  );
  assert.match(
    source,
    /loadDotenvOnce\(\{\s*dotenv,\s*env:\s*process\.env\s*\}\)/,
    `${file} should use the one-shot no-override dotenv loader`,
  );
  assert.doesNotMatch(
    source,
    /dotenv\.config\s*\(/,
    `${file} must not bypass the one-shot no-override loader`,
  );
  assertDotenvBeforeDb(file);
}

test("assemble.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("assemble.js");
});

test("run.js loads .env before lib/db", () => {
  assertOneShotDotenvBeforeDb("run.js");
});

test("publisher.js loads .env before lib/db", () => {
  assertOneShotDotenvBeforeDb("publisher.js");
});

test("processor.js loads governed .env before lib/db", () => {
  assertOneShotDotenvBeforeDb("processor.js");
});

test("audio.js loads governed .env before lib/db", () => {
  assertOneShotDotenvBeforeDb("audio.js");
});

test("upload_tiktok.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("upload_tiktok.js");
});

test("affiliates.js loads .env before lib/db", () => {
  assertDotenvBeforeDb("affiliates.js");
});
