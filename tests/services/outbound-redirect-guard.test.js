"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ALLOWED = new Set([
  path.join(ROOT, "lib", "safe-url.js"),
  __filename,
  path.join(ROOT, "tests", "services", "safe-url.test.js"),
]);

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ent.name === "node_modules" ||
      ent.name === ".git" ||
      ent.name === "dist" ||
      ent.name === "output" ||
      ent.name === "tokens" ||
      ent.name === "venv"
    ) {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(js|mjs|ts|tsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

test("production fetch code does not use bare axios maxRedirects without safe-url guard", () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    if (ALLOWED.has(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (/maxRedirects\s*:/.test(src) && !/safeRedirectConfig\s*\(/.test(src)) {
      offenders.push(path.relative(ROOT, file));
    }
  }
  assert.deepEqual(offenders.sort(), []);
});
