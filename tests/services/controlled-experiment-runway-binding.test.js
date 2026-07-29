"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  buildControlledExperimentObservation,
} = require("../../lib/services/controlled-experiment-observation");
const {
  assignControlledExperimentAtT60,
  verifyControlledExperimentAtT15,
} = require("../../lib/services/controlled-experiment-runway-binding");
const {
  bind: bindControlledExperiments,
  MATRIX_VERSION,
} = require("../../lib/repositories/controlled_video_experiments");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const EXPERIMENT_ID = "pulse-v1-controlled-12";
const STORY_ID = "story-experiment-runway";
const CHANNEL_ID = "pulse-gaming";
const VIDEO_ID = "youtube-experiment-object";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const RUNTIME_COMMIT = "a".repeat(40);
const ACTIVATION_RECEIPT = "b".repeat(64);

const BINDINGS = Object.freeze({
  story_intake_sha256: "1".repeat(64),
  narration_manifest_sha256: "2".repeat(64),
  renderer_manifest_file_sha256: "3".repeat(64),
  renderer_manifest_canonical_sha256: "4".repeat(64),
  qa_report_sha256: "5".repeat(64),
  media_sha256: "6".repeat(64),
  script_sha256: "7".repeat(64),
});

function fixture(t, { provisionExperiment = true } = {}) {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    CHANNEL_ID,
    "Pulse Gaming",
  );
  db.prepare(
    "INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)",
  ).run(STORY_ID, "Exact experiment story", CHANNEL_ID);
  const controlledExperiments = bindControlledExperiments(db);
  if (provisionExperiment) {
    controlledExperiments.ensureExperiment({
      experimentId: EXPERIMENT_ID,
      channelId: CHANNEL_ID,
    });
  }
  t.after(() => db.close());
  return { db, controlledExperiments };
}

function observation(overrides = {}) {
  const body = {
    identity: {
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
    },
    experiment: {
      eligible: true,
      experiment_id: EXPERIMENT_ID,
      matrix_version: MATRIX_VERSION,
      expected_cell_id: "what_changes_for_players:direct:short",
      ineligibility_reason: null,
    },
    creative_static: {
      runtime_seconds: 31.25,
      hook_type: "direct",
      narrator_version: "elevenlabs:voice:model:1",
      first_frame_text: "GAME PASS JUST CHANGED",
      motion_ratio: 0.625,
      topic: "Game Pass catalogue update",
      game: "Fable",
      subject_platform: "Xbox",
      source_type: "official",
      consequence_lane: "what_changes_for_players",
      renderer_version: "studio-v21.4.0",
      qa_result: "pass",
    },
    bindings: { ...BINDINGS },
    ...overrides,
  };
  return buildControlledExperimentObservation(body, {
    expectedIdentity: body.identity,
    expectedBindings: body.bindings,
  });
}

function runtimeIdentity(overrides = {}) {
  return {
    valid: true,
    commit_sha: RUNTIME_COMMIT,
    activation_receipt_sha256: ACTIVATION_RECEIPT,
    blockers: [],
    ...overrides,
  };
}

function assignmentInput(controlledExperiments, overrides = {}) {
  return {
    controlledExperiments,
    observation: observation(),
    expectedIdentity: {
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
    },
    expectedBindings: { ...BINDINGS },
    videoId: VIDEO_ID,
    scheduledFor: SCHEDULED_FOR,
    runtimeIdentity: runtimeIdentity(),
    ...overrides,
  };
}

test("T-60 assigns one exact immutable experiment cell and exact replay consumes no second cell", (t) => {
  const { controlledExperiments } = fixture(t);
  const input = assignmentInput(controlledExperiments);

  const first = assignControlledExperimentAtT60(input);
  const replay = assignControlledExperimentAtT60(input);

  assert.equal(first.status, "ASSIGNED");
  assert.equal(first.experiment_id, EXPERIMENT_ID);
  assert.equal(first.cell_id, "what_changes_for_players:direct:short");
  assert.equal(first.story_id, STORY_ID);
  assert.equal(first.video_id, VIDEO_ID);
  assert.equal(first.assigned_at, SCHEDULED_FOR);
  assert.equal(first.published_at, SCHEDULED_FOR);
  assert.equal(first.runtime_commit_sha, RUNTIME_COMMIT);
  assert.equal(first.activation_receipt_sha256, ACTIVATION_RECEIPT);
  assert.match(first.creative_manifest_sha256, /^[a-f0-9]{64}$/);
  assert.match(first.assignment_binding_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(replay, first);
  assert.equal(
    controlledExperiments
      .listCells(EXPERIMENT_ID)
      .filter((cell) => cell.video_id).length,
    1,
  );
});

test("T-15 verifies the exact T-60 assignment and rejects creative, receipt and checkpoint drift", (t) => {
  const { controlledExperiments } = fixture(t);
  const input = assignmentInput(controlledExperiments);
  const assigned = assignControlledExperimentAtT60(input);

  const verified = verifyControlledExperimentAtT15({
    ...input,
    assignmentBinding: assigned,
  });
  assert.equal(verified.status, "VERIFIED");
  assert.equal(
    verified.schema_version,
    "pulse-controlled-experiment-assignment-verification-v1",
  );
  assert.deepEqual(
    verified.assignment_binding,
    assigned,
  );
  assert.equal(
    verified.assignment_binding.status,
    "ASSIGNED",
  );
  assert.equal(
    verified.assignment_binding.assignment_binding_sha256,
    assigned.assignment_binding_sha256,
  );
  assert.match(
    verified.verification_sha256,
    /^[a-f0-9]{64}$/,
  );

  assert.throws(
    () =>
      verifyControlledExperimentAtT15({
        ...input,
        runtimeIdentity: runtimeIdentity({
          commit_sha: "c".repeat(40),
        }),
        assignmentBinding: assigned,
      }),
    /controlled_experiment_assignment_runtime_commit_mismatch/,
  );
  assert.throws(
    () =>
      verifyControlledExperimentAtT15({
        ...input,
        runtimeIdentity: runtimeIdentity({
          activation_receipt_sha256: "d".repeat(64),
        }),
        assignmentBinding: assigned,
      }),
    /controlled_experiment_assignment_activation_receipt_mismatch/,
  );
  assert.throws(
    () =>
      verifyControlledExperimentAtT15({
        ...input,
        assignmentBinding: {
          ...assigned,
          observation_sha256: "e".repeat(64),
        },
      }),
    /controlled_experiment_assignment_binding_sha256_mismatch/,
  );
  const changed = observation({
    creative_static: {
      ...observation().creative_static,
      first_frame_text: "A DIFFERENT OPENING",
    },
  });
  assert.throws(
    () =>
      verifyControlledExperimentAtT15({
        ...input,
        observation: changed,
        assignmentBinding: assigned,
      }),
    /controlled_experiment_assignment_creative_manifest_mismatch/,
  );
});

test("T-60 requires a pre-provisioned exact matrix and explicit runtime identity", (t) => {
  const { controlledExperiments } = fixture(t, {
    provisionExperiment: false,
  });

  assert.throws(
    () =>
      assignControlledExperimentAtT60(
        assignmentInput(controlledExperiments),
      ),
    /controlled_experiment_identity_not_provisioned/,
  );
  controlledExperiments.ensureExperiment({
    experimentId: EXPERIMENT_ID,
    channelId: CHANNEL_ID,
  });
  assert.throws(
    () =>
      assignControlledExperimentAtT60(
        assignmentInput(controlledExperiments, {
          runtimeIdentity: runtimeIdentity({
            valid: false,
            blockers: ["activation_receipt_commit_mismatch"],
          }),
        }),
      ),
    /activation_receipt_commit_mismatch/,
  );

  const exactListCells =
    controlledExperiments.listCells.bind(
      controlledExperiments,
    );
  const driftedRepository = {
    ...controlledExperiments,
    listCells(experimentId) {
      return exactListCells(experimentId).map(
        (cell, index) =>
          index === 0
            ? {
                ...cell,
                runtime_max_seconds:
                  Number(cell.runtime_max_seconds) + 1,
              }
            : cell,
      );
    },
  };
  assert.throws(
    () =>
      assignControlledExperimentAtT60(
        assignmentInput(driftedRepository),
      ),
    /controlled_experiment_identity_not_provisioned/,
  );
});

test("explicit ineligible observations consume no experiment cell", (t) => {
  const { controlledExperiments } = fixture(t);
  const body = {
    identity: {
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
    },
    experiment: {
      eligible: false,
      experiment_id: null,
      matrix_version: null,
      expected_cell_id: null,
      ineligibility_reason:
        "breaking_short_contract_is_not_in_controlled_matrix",
    },
    creative_static: null,
    bindings: { ...BINDINGS },
  };
  const ineligible = buildControlledExperimentObservation(body, {
    expectedIdentity: body.identity,
    expectedBindings: body.bindings,
  });

  const result = assignControlledExperimentAtT60(
    assignmentInput(controlledExperiments, {
      observation: ineligible,
    }),
  );
  assert.equal(result.status, "NOT_ELIGIBLE");
  assert.equal(result.experiment_eligible, false);
  assert.equal(
    controlledExperiments
      .listCells(EXPERIMENT_ID)
      .filter((cell) => cell.video_id).length,
    0,
  );
});
