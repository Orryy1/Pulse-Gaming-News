"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  resolveControlledExperimentRuntimeIdentity,
} = require("../../lib/services/controlled-experiment-runtime-identity");

const COMMIT = "a".repeat(40);
const RECEIPT = "b".repeat(64);

test("controlled experiment runtime identity requires one exact live activation receipt and commit", () => {
  const result = resolveControlledExperimentRuntimeIdentity(
    {
      env: {
        RAILWAY_GIT_COMMIT_SHA: COMMIT,
        PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256: RECEIPT,
      },
    },
    {
      resolveRuntimeBuildInfo: () => ({ commit_sha: COMMIT }),
      loadLiveGuardedRuntimeProfile: () => ({
        activation_receipt_path: "D:/pulse/activation-receipt.json",
      }),
      inspectLiveActivationReceipt: ({ expectedCommit }) => {
        assert.equal(expectedCommit, COMMIT);
        return {
          valid: true,
          receipt_sha256: RECEIPT,
          blockers: [],
        };
      },
    },
  );

  assert.deepEqual(result, {
    valid: true,
    commit_sha: COMMIT,
    activation_receipt_sha256: RECEIPT,
    blockers: [],
  });
});

test("controlled experiment runtime identity fails closed on receipt, environment or commit drift", () => {
  const dependencies = {
    resolveRuntimeBuildInfo: () => ({ commit_sha: COMMIT }),
    loadLiveGuardedRuntimeProfile: () => ({
      activation_receipt_path: "D:/pulse/activation-receipt.json",
    }),
    inspectLiveActivationReceipt: () => ({
      valid: true,
      receipt_sha256: RECEIPT,
      blockers: [],
    }),
  };

  assert.deepEqual(
    resolveControlledExperimentRuntimeIdentity(
      {
        env: {
          RAILWAY_GIT_COMMIT_SHA: COMMIT,
          PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256: "c".repeat(64),
        },
      },
      dependencies,
    ),
    {
      valid: false,
      commit_sha: COMMIT,
      activation_receipt_sha256: RECEIPT,
      blockers: [
        "controlled_experiment_activation_receipt_environment_mismatch",
      ],
    },
  );

  assert.deepEqual(
    resolveControlledExperimentRuntimeIdentity(
      {
        env: {
          PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256: RECEIPT,
        },
      },
      {
        ...dependencies,
        resolveRuntimeBuildInfo: () => ({ commit_sha: null }),
      },
    ),
    {
      valid: false,
      commit_sha: null,
      activation_receipt_sha256: null,
      blockers: ["controlled_experiment_runtime_commit_required"],
    },
  );

  assert.deepEqual(
    resolveControlledExperimentRuntimeIdentity(
      {
        env: {
          RAILWAY_GIT_COMMIT_SHA: COMMIT,
          PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256: RECEIPT,
        },
      },
      {
        ...dependencies,
        inspectLiveActivationReceipt: () => ({
          valid: false,
          receipt_sha256: null,
          blockers: ["activation_receipt_commit_mismatch"],
        }),
      },
    ),
    {
      valid: false,
      commit_sha: COMMIT,
      activation_receipt_sha256: null,
      blockers: ["activation_receipt_commit_mismatch"],
    },
  );
});
