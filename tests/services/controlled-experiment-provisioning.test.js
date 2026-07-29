"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  bind: bindControlledExperiments,
  EXPERIMENT_MATRIX,
} = require("../../lib/repositories/controlled_video_experiments");
const {
  inspectControlledExperimentProvisioning,
  provisionControlledExperiment,
} = require("../../lib/services/controlled-experiment-provisioning");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const EXPERIMENT_ID = "pulse-v1-controlled-12";
const CHANNEL_ID = "pulse-gaming";

function fixture(t) {
  const db = new Database(":memory:");
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
  t.after(() => db.close());
  return {
    db,
    controlledExperiments: bindControlledExperiments(db),
  };
}

function request(controlledExperiments, overrides = {}) {
  return {
    controlledExperiments,
    experimentId: EXPERIMENT_ID,
    channelId: CHANNEL_ID,
    ...overrides,
  };
}

test("controlled experiment provisioning is inspect-first, exact, explicit and replay-safe", (t) => {
  const { controlledExperiments } = fixture(t);
  const plan = inspectControlledExperimentProvisioning(
    request(controlledExperiments),
  );

  assert.equal(plan.verdict, "READY");
  assert.equal(plan.action, "PROVISION");
  assert.equal(plan.database_mutated, false);
  assert.equal(plan.expected_cell_count, EXPERIMENT_MATRIX.length);
  assert.equal(plan.current_cell_count, 0);
  assert.match(plan.matrix_sha256, /^[a-f0-9]{64}$/);
  assert.match(plan.plan_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    controlledExperiments.getExperiment(EXPERIMENT_ID),
    null,
  );

  assert.throws(
    () =>
      provisionControlledExperiment({
        ...request(controlledExperiments),
        confirmProvision: true,
        confirmPlanSha256: "0".repeat(64),
      }),
    /controlled_experiment_provision_plan_confirmation_mismatch/,
  );

  const provisioned = provisionControlledExperiment({
    ...request(controlledExperiments),
    confirmProvision: true,
    confirmPlanSha256: plan.plan_sha256,
  });
  assert.equal(provisioned.verdict, "GREEN");
  assert.equal(provisioned.action, "PROVISIONED");
  assert.equal(provisioned.database_mutated, true);
  assert.equal(provisioned.current_cell_count, EXPERIMENT_MATRIX.length);
  assert.match(provisioned.proof_sha256, /^[a-f0-9]{64}$/);

  const replayPlan = inspectControlledExperimentProvisioning(
    request(controlledExperiments),
  );
  assert.equal(replayPlan.verdict, "GREEN");
  assert.equal(replayPlan.action, "NOOP");
  const replay = provisionControlledExperiment({
    ...request(controlledExperiments),
    confirmProvision: true,
    confirmPlanSha256: replayPlan.plan_sha256,
  });
  assert.equal(replay.verdict, "GREEN");
  assert.equal(replay.action, "ALREADY_PROVISIONED");
  assert.equal(replay.database_mutated, false);
  assert.equal(
    controlledExperiments.listCells(EXPERIMENT_ID).length,
    EXPERIMENT_MATRIX.length,
  );
});

test("controlled experiment provisioning fails closed on an exact matrix design drift", (t) => {
  const { db, controlledExperiments } = fixture(t);
  controlledExperiments.ensureExperiment({
    experimentId: EXPERIMENT_ID,
    channelId: CHANNEL_ID,
  });
  db.exec(
    "DROP TRIGGER trg_controlled_experiment_cell_design_immutable",
  );
  db.prepare(
    `UPDATE controlled_video_experiment_cells
     SET runtime_max_seconds = runtime_max_seconds + 1
     WHERE experiment_id = ? AND ordinal = 1`,
  ).run(EXPERIMENT_ID);

  const inspection = inspectControlledExperimentProvisioning(
    request(controlledExperiments),
  );
  assert.equal(inspection.verdict, "HOLD");
  assert.equal(inspection.action, "REPAIR_REQUIRED");
  assert.ok(
    inspection.blockers.includes(
      "controlled_experiment_matrix_design_mismatch",
    ),
  );
  assert.throws(
    () =>
      provisionControlledExperiment({
        ...request(controlledExperiments),
        confirmProvision: true,
        confirmPlanSha256: inspection.plan_sha256,
      }),
    /controlled_experiment_provisioning_not_ready/,
  );
});
