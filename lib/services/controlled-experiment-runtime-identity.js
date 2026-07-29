"use strict";

const path = require("node:path");

const {
  resolveRuntimeBuildInfo: defaultResolveRuntimeBuildInfo,
} = require("../runtime-build-info");
const {
  inspectLiveActivationReceipt:
    defaultInspectLiveActivationReceipt,
  loadLiveGuardedRuntimeProfile:
    defaultLoadLiveGuardedRuntimeProfile,
} = require("../stabilisation/windows-live-guarded-runtime");

const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value) {
  return String(value || "").trim().toLowerCase();
}

function resolveControlledExperimentRuntimeIdentity(
  {
    env = process.env,
    cwd = process.cwd(),
    migrationsDir = path.resolve(
      __dirname,
      "..",
      "..",
      "db",
      "migrations",
    ),
    profilePath,
  } = {},
  dependencies = {},
) {
  const resolveRuntimeBuildInfo =
    dependencies.resolveRuntimeBuildInfo ||
    defaultResolveRuntimeBuildInfo;
  const loadLiveGuardedRuntimeProfile =
    dependencies.loadLiveGuardedRuntimeProfile ||
    defaultLoadLiveGuardedRuntimeProfile;
  const inspectLiveActivationReceipt =
    dependencies.inspectLiveActivationReceipt ||
    defaultInspectLiveActivationReceipt;
  const build = resolveRuntimeBuildInfo({ cwd, env });
  const commit = text(build?.commit_sha);
  if (!COMMIT_PATTERN.test(commit)) {
    return {
      valid: false,
      commit_sha: null,
      activation_receipt_sha256: null,
      blockers: ["controlled_experiment_runtime_commit_required"],
    };
  }
  const blockers = [];
  const environmentCommit = text(env.RAILWAY_GIT_COMMIT_SHA);
  if (
    !COMMIT_PATTERN.test(environmentCommit) ||
    environmentCommit !== commit
  ) {
    blockers.push(
      "controlled_experiment_runtime_commit_environment_mismatch",
    );
  }
  let profile;
  let activation;
  try {
    profile = loadLiveGuardedRuntimeProfile(
      profilePath ? { profilePath } : {},
    );
    activation = inspectLiveActivationReceipt({
      profile,
      expectedCommit: commit,
      migrationsDir,
      receiptPath: profile?.activation_receipt_path,
    });
  } catch (error) {
    blockers.push(
      String(
        error?.code ||
          error?.message ||
          "controlled_experiment_activation_receipt_inspection_failed",
      ),
    );
    activation = null;
  }
  if (activation?.valid !== true) {
    blockers.push(
      ...(Array.isArray(activation?.blockers)
        ? activation.blockers
        : ["controlled_experiment_activation_receipt_invalid"]),
    );
  }
  const receiptSha256 = text(activation?.receipt_sha256);
  if (
    activation?.valid === true &&
    !SHA256_PATTERN.test(receiptSha256)
  ) {
    blockers.push(
      "controlled_experiment_activation_receipt_sha256_required",
    );
  }
  const environmentReceiptSha256 = text(
    env.PULSE_LIVE_GUARDED_ACTIVATION_RECEIPT_SHA256,
  );
  if (
    activation?.valid === true &&
    (!SHA256_PATTERN.test(environmentReceiptSha256) ||
      environmentReceiptSha256 !== receiptSha256)
  ) {
    blockers.push(
      "controlled_experiment_activation_receipt_environment_mismatch",
    );
  }
  return {
    valid: blockers.length === 0,
    commit_sha: commit,
    activation_receipt_sha256:
      SHA256_PATTERN.test(receiptSha256) ? receiptSha256 : null,
    blockers: [...new Set(blockers)],
  };
}

module.exports = {
  resolveControlledExperimentRuntimeIdentity,
};
