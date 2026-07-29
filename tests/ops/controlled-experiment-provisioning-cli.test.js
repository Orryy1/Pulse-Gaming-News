"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const ROOT = path.resolve(__dirname, "..", "..");
const CLI = path.join(
  ROOT,
  "tools",
  "controlled-experiment-provisioning.js",
);
const MIGRATIONS = path.join(ROOT, "db", "migrations");
const EXPERIMENT_ID = "pulse-v1-controlled-12";
const CHANNEL_ID = "pulse-gaming";

function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-experiment-provision-"),
  );
  t.after(() =>
    fs.rmSync(root, { recursive: true, force: true }),
  );
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  db.pragma("foreign_keys = ON");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run(CHANNEL_ID, "Pulse Gaming");
  db.close();
  return {
    root,
    databasePath,
    reportPath: path.join(root, "provisioning-proof.json"),
  };
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function baseArgs(fx) {
  return [
    "--database",
    fx.databasePath,
    "--experiment-id",
    EXPERIMENT_ID,
    "--channel-id",
    CHANNEL_ID,
  ];
}

test("controlled experiment CLI inspects read-only and provisions only with an exact explicit confirmation", (t) => {
  const fx = fixture(t);
  const inspected = run(baseArgs(fx));
  assert.equal(inspected.status, 0, inspected.stderr);
  const plan = JSON.parse(inspected.stdout);
  assert.equal(plan.verdict, "READY");
  assert.equal(plan.database_mutated, false);

  let db = new Database(fx.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM controlled_video_experiments",
      )
      .get().count,
    0,
  );
  db.close();

  const refused = run([
    ...baseArgs(fx),
    "--apply",
    "--confirm-provision-controlled-experiment",
    "--confirm-plan-sha256",
    "0".repeat(64),
  ]);
  assert.notEqual(refused.status, 0);
  assert.match(
    refused.stderr,
    /controlled_experiment_provision_plan_confirmation_mismatch/,
  );

  const applied = run([
    ...baseArgs(fx),
    "--apply",
    "--confirm-provision-controlled-experiment",
    "--confirm-plan-sha256",
    plan.plan_sha256,
    "--output",
    fx.reportPath,
  ]);
  assert.equal(applied.status, 0, applied.stderr);
  const proof = JSON.parse(applied.stdout);
  assert.equal(proof.verdict, "GREEN");
  assert.equal(proof.database_mutated, true);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(fx.reportPath, "utf8")),
    proof,
  );

  db = new Database(fx.databasePath, {
    readonly: true,
    fileMustExist: true,
  });
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM controlled_video_experiment_cells",
      )
      .get().count,
    12,
  );
  db.close();
});
