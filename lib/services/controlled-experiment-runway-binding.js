"use strict";

const crypto = require("node:crypto");

const {
  ASSIGNMENT_POLICY,
  EXPERIMENT_MATRIX,
  MATRIX_VERSION,
  normaliseCreativeManifest,
} = require("../repositories/controlled_video_experiments");
const {
  validateControlledExperimentObservation,
} = require("./controlled-experiment-observation");

const ASSIGNMENT_BINDING_SCHEMA_VERSION =
  "pulse-controlled-experiment-assignment-binding-v1";
const ASSIGNMENT_VERIFICATION_SCHEMA_VERSION =
  "pulse-controlled-experiment-assignment-verification-v1";
const COMMIT_PATTERN = /^[a-f0-9]{40,64}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function text(value) {
  return String(value || "").trim();
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

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    throw new Error(code);
  }
  return raw;
}

function requireRuntimeIdentity(value) {
  if (value?.valid !== true) {
    throw new Error(
      Array.isArray(value?.blockers) && value.blockers.length
        ? value.blockers.join(",")
        : "controlled_experiment_runtime_identity_invalid",
    );
  }
  const commitSha = text(value.commit_sha).toLowerCase();
  const receiptSha256 = text(
    value.activation_receipt_sha256,
  ).toLowerCase();
  if (!COMMIT_PATTERN.test(commitSha)) {
    throw new Error(
      "controlled_experiment_assignment_runtime_commit_invalid",
    );
  }
  if (!SHA256_PATTERN.test(receiptSha256)) {
    throw new Error(
      "controlled_experiment_assignment_activation_receipt_invalid",
    );
  }
  return {
    commitSha,
    receiptSha256,
  };
}

function validateObservation({
  observation,
  expectedIdentity,
  expectedBindings,
}) {
  return validateControlledExperimentObservation(observation, {
    expectedIdentity,
    expectedBindings,
  }).observation;
}

function creativeManifestFrom({
  observation,
  runtimeCommitSha,
  scheduledFor,
}) {
  const creative = observation.creative_static;
  return {
    runtime_seconds: creative.runtime_seconds,
    hook_type: creative.hook_type,
    narrator_version: creative.narrator_version,
    first_frame_text: creative.first_frame_text,
    motion_ratio: creative.motion_ratio,
    topic: creative.topic,
    game: creative.game,
    platform: creative.subject_platform,
    source_type: creative.source_type,
    consequence_lane: creative.consequence_lane,
    runtime_commit_sha: runtimeCommitSha,
    renderer_version: creative.renderer_version,
    qa_result: creative.qa_result,
    published_at: scheduledFor,
  };
}

function ineligibleResult(observation) {
  return Object.freeze({
    schema_version: ASSIGNMENT_BINDING_SCHEMA_VERSION,
    status: "NOT_ELIGIBLE",
    experiment_eligible: false,
    ineligibility_reason:
      observation.experiment.ineligibility_reason,
    observation_sha256: observation.observation_sha256,
  });
}

function requireProvisionedExperiment(
  controlledExperiments,
  observation,
) {
  if (
    !controlledExperiments ||
    typeof controlledExperiments.getExperiment !== "function" ||
    typeof controlledExperiments.listCells !== "function"
  ) {
    throw new Error(
      "controlled_experiment_repository_required",
    );
  }
  const experimentId =
    observation.experiment.experiment_id;
  const experiment =
    controlledExperiments.getExperiment(experimentId);
  const cells = experiment
    ? controlledExperiments.listCells(experimentId)
    : [];
  const exactMatrix =
    cells.length === EXPERIMENT_MATRIX.length &&
    EXPERIMENT_MATRIX.every((expected, index) => {
      const actual = cells[index];
      return (
        Number(actual?.ordinal) === expected.ordinal &&
        actual?.experiment_id === experimentId &&
        actual?.channel_id ===
          observation.identity.channel_id &&
        actual?.cell_key === expected.cellKey &&
        actual?.editorial_lane ===
          expected.editorialLane &&
        actual?.hook_type === expected.hookType &&
        actual?.duration_band === expected.durationBand &&
        Number(actual?.runtime_min_seconds) ===
          expected.runtimeMinSeconds &&
        Number(actual?.runtime_max_seconds) ===
          expected.runtimeMaxSeconds
      );
    });
  if (
    !experiment ||
    experiment.channel_id !==
      observation.identity.channel_id ||
    experiment.matrix_version !==
      observation.experiment.matrix_version ||
    experiment.matrix_version !== MATRIX_VERSION ||
    experiment.assignment_policy !== ASSIGNMENT_POLICY ||
    !exactMatrix
  ) {
    throw new Error(
      "controlled_experiment_identity_not_provisioned",
    );
  }
  return experiment;
}

function assignmentBindingBase({
  observation,
  assignment,
  creativeManifestSha256,
  runtime,
  scheduledFor,
}) {
  return {
    schema_version: ASSIGNMENT_BINDING_SCHEMA_VERSION,
    status: "ASSIGNED",
    experiment_eligible: true,
    experiment_id: observation.experiment.experiment_id,
    matrix_version: observation.experiment.matrix_version,
    cell_id: assignment.cell_key,
    cell_ordinal: Number(assignment.ordinal),
    story_id: assignment.story_id,
    channel_id: assignment.channel_id,
    video_id: assignment.video_id,
    assigned_at: assignment.assigned_at,
    published_at: scheduledFor,
    observation_sha256: observation.observation_sha256,
    creative_manifest_sha256: creativeManifestSha256,
    runtime_commit_sha: runtime.commitSha,
    activation_receipt_sha256: runtime.receiptSha256,
  };
}

function withAssignmentBindingSha256(value) {
  const base = { ...value };
  delete base.assignment_binding_sha256;
  return Object.freeze({
    ...base,
    assignment_binding_sha256: canonicalSha256(base),
  });
}

function assignControlledExperimentAtT60({
  controlledExperiments,
  observation,
  expectedIdentity,
  expectedBindings,
  videoId,
  scheduledFor,
  runtimeIdentity,
} = {}) {
  const validatedObservation = validateObservation({
    observation,
    expectedIdentity,
    expectedBindings,
  });
  if (!validatedObservation.experiment.eligible) {
    return ineligibleResult(validatedObservation);
  }
  requireProvisionedExperiment(
    controlledExperiments,
    validatedObservation,
  );
  const runtime = requireRuntimeIdentity(runtimeIdentity);
  const exactScheduledFor = exactTimestamp(
    scheduledFor,
    "controlled_experiment_assignment_schedule_invalid",
  );
  const exactVideoId = text(videoId);
  if (!exactVideoId) {
    throw new Error(
      "controlled_experiment_assignment_video_id_required",
    );
  }
  const creativeManifest = creativeManifestFrom({
    observation: validatedObservation,
    runtimeCommitSha: runtime.commitSha,
    scheduledFor: exactScheduledFor,
  });
  const creativeEvidence =
    normaliseCreativeManifest(creativeManifest);
  const assignment = controlledExperiments.assignNextVideo({
    experimentId:
      validatedObservation.experiment.experiment_id,
    channelId: validatedObservation.identity.channel_id,
    storyId: validatedObservation.identity.story_id,
    videoId: exactVideoId,
    assignedAt: exactScheduledFor,
    creativeManifest,
  });
  if (
    assignment.cell_key !==
    validatedObservation.experiment.expected_cell_id
  ) {
    throw new Error(
      "controlled_experiment_assignment_cell_mismatch",
    );
  }
  return withAssignmentBindingSha256(
    assignmentBindingBase({
      observation: validatedObservation,
      assignment,
      creativeManifestSha256: creativeEvidence.sha256,
      runtime,
      scheduledFor: exactScheduledFor,
    }),
  );
}

function verifyBindingIntegrity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "controlled_experiment_assignment_binding_required",
    );
  }
  const declared = text(
    value.assignment_binding_sha256,
  ).toLowerCase();
  const base = { ...value };
  delete base.assignment_binding_sha256;
  if (
    !SHA256_PATTERN.test(declared) ||
    canonicalSha256(base) !== declared
  ) {
    throw new Error(
      "controlled_experiment_assignment_binding_sha256_mismatch",
    );
  }
  return value;
}

function verifyControlledExperimentAtT15({
  controlledExperiments,
  observation,
  expectedIdentity,
  expectedBindings,
  videoId,
  scheduledFor,
  runtimeIdentity,
  assignmentBinding,
} = {}) {
  const validatedObservation = validateObservation({
    observation,
    expectedIdentity,
    expectedBindings,
  });
  if (!validatedObservation.experiment.eligible) {
    return ineligibleResult(validatedObservation);
  }
  requireProvisionedExperiment(
    controlledExperiments,
    validatedObservation,
  );
  const runtime = requireRuntimeIdentity(runtimeIdentity);
  const exactScheduledFor = exactTimestamp(
    scheduledFor,
    "controlled_experiment_assignment_schedule_invalid",
  );
  const exactVideoId = text(videoId);
  const provided = verifyBindingIntegrity(
    assignmentBinding,
  );
  if (
    provided.runtime_commit_sha !== runtime.commitSha
  ) {
    throw new Error(
      "controlled_experiment_assignment_runtime_commit_mismatch",
    );
  }
  if (
    provided.activation_receipt_sha256 !==
    runtime.receiptSha256
  ) {
    throw new Error(
      "controlled_experiment_assignment_activation_receipt_mismatch",
    );
  }
  const assignment = controlledExperiments.getAssignment({
    experimentId:
      validatedObservation.experiment.experiment_id,
    channelId: validatedObservation.identity.channel_id,
    videoId: exactVideoId,
  });
  if (!assignment) {
    throw new Error(
      "controlled_experiment_assignment_required",
    );
  }
  const creativeManifest = creativeManifestFrom({
    observation: validatedObservation,
    runtimeCommitSha: runtime.commitSha,
    scheduledFor: exactScheduledFor,
  });
  const creativeEvidence =
    normaliseCreativeManifest(creativeManifest);
  if (
    assignment.creative_manifest_sha256 !==
    creativeEvidence.sha256
  ) {
    throw new Error(
      "controlled_experiment_assignment_creative_manifest_mismatch",
    );
  }
  const expected = withAssignmentBindingSha256(
    assignmentBindingBase({
      observation: validatedObservation,
      assignment,
      creativeManifestSha256: creativeEvidence.sha256,
      runtime,
      scheduledFor: exactScheduledFor,
    }),
  );
  if (
    JSON.stringify(stableValue(provided)) !==
    JSON.stringify(stableValue(expected))
  ) {
    throw new Error(
      "controlled_experiment_assignment_binding_mismatch",
    );
  }
  const verification = {
    schema_version:
      ASSIGNMENT_VERIFICATION_SCHEMA_VERSION,
    status: "VERIFIED",
    assignment_binding: expected,
  };
  return Object.freeze({
    ...verification,
    verification_sha256:
      canonicalSha256(verification),
  });
}

module.exports = {
  ASSIGNMENT_BINDING_SCHEMA_VERSION,
  ASSIGNMENT_VERIFICATION_SCHEMA_VERSION,
  assignControlledExperimentAtT60,
  canonicalControlledExperimentAssignmentBindingSha256:
    canonicalSha256,
  verifyControlledExperimentAtT15,
};
