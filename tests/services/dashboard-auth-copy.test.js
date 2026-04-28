"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const AUTH = path.join(ROOT, "src", "api", "auth.ts");

test("dashboard auth prompt failure has an operator-friendly fallback", () => {
  const source = fs.readFileSync(AUTH, "utf8");
  assert.match(source, /try\s*{\s*raw = window\.prompt/s);
  assert.match(source, /Open the dashboard with \?token=\.\.\./);
  assert.doesNotMatch(source, /prompt\(\) is not supported/);
});
