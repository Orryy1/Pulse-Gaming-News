"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/flagship-script-repair");

test("flagship script repair has a canonical operator command", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "..", "..", "package.json"), "utf8"),
  );
  assert.equal(
    packageJson.scripts["ops:flagship-script-repair"],
    "node tools/flagship-script-repair.js",
  );
});

test("flagship script repair parses plan and explicit apply modes", () => {
  const plan = parseArgs([
    "--artifact-dir", "story",
    "--work-order", "work-order.json",
    "--patch", "patch.json",
    "--json",
  ]);
  assert.equal(plan.apply, false);
  assert.equal(plan.operatorConfirmed, false);
  assert.equal(plan.json, true);

  const apply = parseArgs([
    "--artifact-dir", "story",
    "--work-order", "work-order.json",
    "--patch", "patch.json",
    "--apply",
    "--operator-confirmed",
  ]);
  assert.equal(apply.apply, true);
  assert.equal(apply.operatorConfirmed, true);
});

test("flagship script repair refuses one-sided mutation authority", async () => {
  await assert.rejects(
    () => main([
      "--artifact-dir", "story",
      "--work-order", "work-order.json",
      "--patch", "patch.json",
      "--apply",
    ], { stdout: { write() {} } }),
    /requires --apply and --operator-confirmed together/,
  );
});
