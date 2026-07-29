"use strict";

const crypto = require("node:crypto");

const {
  ASSIGNMENT_POLICY,
  EXPERIMENT_MATRIX,
  MATRIX_VERSION,
} = require("../repositories/controlled_video_experiments");

const PROVISIONING_SCHEMA_VERSION =
  "pulse-controlled-experiment-provisioning-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function requireRepository(controlledExperiments) {
  for (const method of [
    "ensureExperiment",
    "getExperiment",
    "listCells",
  ]) {
    if (typeof controlledExperiments?.[method] !== "function") {
      throw new Error(
        "controlled_experiment_provisioning_repository_required",
      );
    }
  }
  return controlledExperiments;
}

function expectedCells(experimentId, channelId) {
  return EXPERIMENT_MATRIX.map((cell) => ({
    experiment_id: experimentId,
    channel_id: channelId,
    ordinal: cell.ordinal,
    cell_key: cell.cellKey,
    editorial_lane: cell.editorialLane,
    hook_type: cell.hookType,
    duration_band: cell.durationBand,
    runtime_min_seconds: cell.runtimeMinSeconds,
    runtime_max_seconds: cell.runtimeMaxSeconds,
  }));
}

function observedCellDesign(cell) {
  return {
    experiment_id: String(cell?.experiment_id || ""),
    channel_id: String(cell?.channel_id || ""),
    ordinal: Number(cell?.ordinal),
    cell_key: String(cell?.cell_key || ""),
    editorial_lane: String(cell?.editorial_lane || ""),
    hook_type: String(cell?.hook_type || ""),
    duration_band: String(cell?.duration_band || ""),
    runtime_min_seconds: Number(cell?.runtime_min_seconds),
    runtime_max_seconds: Number(cell?.runtime_max_seconds),
  };
}

function planCore({
  experimentId,
  channelId,
  matrixSha256,
  action,
  blockers,
}) {
  return {
    schema_version: PROVISIONING_SCHEMA_VERSION,
    experiment_id: experimentId,
    channel_id: channelId,
    matrix_version: MATRIX_VERSION,
    assignment_policy: ASSIGNMENT_POLICY,
    matrix_sha256: matrixSha256,
    action,
    blockers,
  };
}

function inspectControlledExperimentProvisioning({
  controlledExperiments,
  experimentId,
  channelId,
} = {}) {
  const repository = requireRepository(controlledExperiments);
  const exactExperimentId = text(
    experimentId,
    "controlled_experiment_provisioning_experiment_id_required",
  );
  const exactChannelId = text(
    channelId,
    "controlled_experiment_provisioning_channel_id_required",
  );
  const expected = expectedCells(
    exactExperimentId,
    exactChannelId,
  );
  const matrixSha256 = canonicalSha256(expected);
  const experiment =
    repository.getExperiment(exactExperimentId);
  const currentCells = experiment
    ? repository.listCells(exactExperimentId)
    : [];
  const blockers = [];

  if (experiment) {
    if (
      experiment.channel_id !== exactChannelId ||
      experiment.matrix_version !== MATRIX_VERSION ||
      experiment.assignment_policy !== ASSIGNMENT_POLICY
    ) {
      blockers.push(
        "controlled_experiment_identity_conflict",
      );
    }
    const observed = currentCells.map(observedCellDesign);
    if (
      observed.length !== expected.length ||
      canonicalSha256(observed) !== matrixSha256
    ) {
      blockers.push(
        "controlled_experiment_matrix_design_mismatch",
      );
    }
  }

  const action = blockers.length
    ? "REPAIR_REQUIRED"
    : experiment
      ? "NOOP"
      : "PROVISION";
  const core = planCore({
    experimentId: exactExperimentId,
    channelId: exactChannelId,
    matrixSha256,
    action,
    blockers: [...new Set(blockers)].sort(),
  });
  return Object.freeze({
    ...core,
    verdict: blockers.length
      ? "HOLD"
      : experiment
        ? "GREEN"
        : "READY",
    expected_cell_count: expected.length,
    current_cell_count: currentCells.length,
    database_mutated: false,
    external_posting: false,
    oauth_or_tokens_mutated: false,
    plan_sha256: canonicalSha256(core),
  });
}

function provisionControlledExperiment({
  controlledExperiments,
  experimentId,
  channelId,
  confirmProvision = false,
  confirmPlanSha256,
} = {}) {
  const repository = requireRepository(controlledExperiments);
  const inspection =
    inspectControlledExperimentProvisioning({
      controlledExperiments: repository,
      experimentId,
      channelId,
    });
  if (inspection.verdict === "HOLD") {
    throw new Error(
      "controlled_experiment_provisioning_not_ready",
    );
  }
  if (confirmProvision !== true) {
    throw new Error(
      "controlled_experiment_provision_confirmation_required",
    );
  }
  const confirmation = String(
    confirmPlanSha256 || "",
  )
    .trim()
    .toLowerCase();
  if (
    !SHA256_PATTERN.test(confirmation) ||
    confirmation !== inspection.plan_sha256
  ) {
    throw new Error(
      "controlled_experiment_provision_plan_confirmation_mismatch",
    );
  }

  const mutated = inspection.action === "PROVISION";
  if (mutated) {
    repository.ensureExperiment({
      experimentId: inspection.experiment_id,
      channelId: inspection.channel_id,
    });
  }
  const verified = inspectControlledExperimentProvisioning({
    controlledExperiments: repository,
    experimentId: inspection.experiment_id,
    channelId: inspection.channel_id,
  });
  if (
    verified.verdict !== "GREEN" ||
    verified.action !== "NOOP"
  ) {
    throw new Error(
      "controlled_experiment_provisioning_verification_failed",
    );
  }
  const proof = {
    schema_version: PROVISIONING_SCHEMA_VERSION,
    verdict: "GREEN",
    action: mutated
      ? "PROVISIONED"
      : "ALREADY_PROVISIONED",
    experiment_id: verified.experiment_id,
    channel_id: verified.channel_id,
    matrix_version: verified.matrix_version,
    assignment_policy: verified.assignment_policy,
    matrix_sha256: verified.matrix_sha256,
    expected_cell_count: verified.expected_cell_count,
    current_cell_count: verified.current_cell_count,
    confirmed_plan_sha256: inspection.plan_sha256,
    database_mutated: mutated,
    external_posting: false,
    oauth_or_tokens_mutated: false,
  };
  return Object.freeze({
    ...proof,
    proof_sha256: canonicalSha256(proof),
  });
}

module.exports = {
  PROVISIONING_SCHEMA_VERSION,
  canonicalControlledExperimentProvisioningSha256:
    canonicalSha256,
  inspectControlledExperimentProvisioning,
  provisionControlledExperiment,
};
