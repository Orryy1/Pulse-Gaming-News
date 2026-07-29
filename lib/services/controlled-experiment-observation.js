"use strict";

const crypto = require("node:crypto");

const CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION =
  "pulse-controlled-experiment-observation-v1";
const SCHEMA_VERSION =
  CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION;
const BODY_FIELDS = new Set([
  "identity",
  "experiment",
  "creative_static",
  "bindings",
]);
const OBSERVATION_FIELDS = new Set([
  "schema_version",
  ...BODY_FIELDS,
  "observation_sha256",
]);
const IDENTITY_FIELDS = new Set(["story_id", "channel_id"]);
const EXPERIMENT_FIELDS = new Set([
  "eligible",
  "experiment_id",
  "matrix_version",
  "expected_cell_id",
  "ineligibility_reason",
]);
const CREATIVE_STATIC_FIELDS = new Set([
  "runtime_seconds",
  "hook_type",
  "narrator_version",
  "first_frame_text",
  "motion_ratio",
  "topic",
  "game",
  "subject_platform",
  "source_type",
  "consequence_lane",
  "renderer_version",
  "qa_result",
]);
const BINDING_FIELDS = new Set([
  "story_intake_sha256",
  "narration_manifest_sha256",
  "renderer_manifest_file_sha256",
  "renderer_manifest_canonical_sha256",
  "qa_report_sha256",
  "media_sha256",
  "script_sha256",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

class ControlledExperimentObservationError extends Error {
  constructor(code) {
    super(code);
    this.name = "ControlledExperimentObservationError";
    this.code = code;
  }
}

function fail(code) {
  throw new ControlledExperimentObservationError(code);
}

function plainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, expected, code) {
  if (!plainObject(value)) fail(code);
  const actualFields = Object.keys(value).sort();
  const expectedFields = [...expected].sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some(
      (field, index) => field !== expectedFields[index],
    )
  ) {
    fail(code);
  }
}

function requiredText(value, code) {
  if (typeof value !== "string" || !value.trim()) fail(code);
  return value.trim();
}

function exactSha256(value, code) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(code);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

function canonicalControlledExperimentObservationSha256(value) {
  if (!plainObject(value)) {
    fail("controlled_experiment_observation_required");
  }
  const body = structuredClone(value);
  delete body.observation_sha256;
  return crypto
    .createHash("sha256")
    .update(canonicalJson(body))
    .digest("hex");
}

function normaliseIdentity(value) {
  exactFields(
    value,
    IDENTITY_FIELDS,
    "controlled_experiment_observation_identity_fields_invalid",
  );
  return {
    story_id: requiredText(
      value.story_id,
      "controlled_experiment_observation_story_id_required",
    ),
    channel_id: requiredText(
      value.channel_id,
      "controlled_experiment_observation_channel_id_required",
    ),
  };
}

function normaliseBindings(value) {
  exactFields(
    value,
    BINDING_FIELDS,
    "controlled_experiment_observation_binding_fields_invalid",
  );
  return Object.fromEntries(
    [...BINDING_FIELDS].map((field) => [
      field,
      exactSha256(
        value[field],
        `controlled_experiment_observation_${field}_invalid`,
      ),
    ]),
  );
}

function normaliseExperiment(value) {
  exactFields(
    value,
    EXPERIMENT_FIELDS,
    "controlled_experiment_observation_experiment_fields_invalid",
  );
  if (typeof value.eligible !== "boolean") {
    fail(
      "controlled_experiment_observation_experiment_eligibility_required",
    );
  }
  if (value.eligible === false) {
    if (
      value.experiment_id !== null ||
      value.matrix_version !== null ||
      value.expected_cell_id !== null
    ) {
      fail(
        "controlled_experiment_observation_ineligible_identity_forbidden",
      );
    }
    return {
      eligible: false,
      experiment_id: null,
      matrix_version: null,
      expected_cell_id: null,
      ineligibility_reason: requiredText(
        value.ineligibility_reason,
        "controlled_experiment_observation_ineligibility_reason_required",
      ),
    };
  }
  if (value.ineligibility_reason !== null) {
    fail(
      "controlled_experiment_observation_eligible_reason_forbidden",
    );
  }
  return {
    eligible: true,
    experiment_id: requiredText(
      value.experiment_id,
      "controlled_experiment_observation_experiment_id_required",
    ),
    matrix_version: requiredText(
      value.matrix_version,
      "controlled_experiment_observation_matrix_version_required",
    ),
    expected_cell_id: requiredText(
      value.expected_cell_id,
      "controlled_experiment_observation_expected_cell_id_required",
    ),
    ineligibility_reason: null,
  };
}

function normaliseCreativeStatic(value) {
  exactFields(
    value,
    CREATIVE_STATIC_FIELDS,
    "controlled_experiment_observation_creative_static_fields_invalid",
  );
  if (
    typeof value.runtime_seconds !== "number" ||
    !Number.isFinite(value.runtime_seconds) ||
    value.runtime_seconds <= 0
  ) {
    fail(
      "controlled_experiment_observation_runtime_seconds_invalid",
    );
  }
  if (
    typeof value.motion_ratio !== "number" ||
    !Number.isFinite(value.motion_ratio) ||
    value.motion_ratio < 0 ||
    value.motion_ratio > 1
  ) {
    fail("controlled_experiment_observation_motion_ratio_invalid");
  }
  const hookType = requiredText(
    value.hook_type,
    "controlled_experiment_observation_hook_type_required",
  );
  if (!["direct", "open_loop"].includes(hookType)) {
    fail("controlled_experiment_observation_hook_type_invalid");
  }
  const qaResult = requiredText(
    value.qa_result,
    "controlled_experiment_observation_qa_result_required",
  );
  if (qaResult !== "pass") {
    fail("controlled_experiment_observation_qa_result_invalid");
  }
  return {
    runtime_seconds: value.runtime_seconds,
    hook_type: hookType,
    narrator_version: requiredText(
      value.narrator_version,
      "controlled_experiment_observation_narrator_version_required",
    ),
    first_frame_text: requiredText(
      value.first_frame_text,
      "controlled_experiment_observation_first_frame_text_required",
    ),
    motion_ratio: value.motion_ratio,
    topic: requiredText(
      value.topic,
      "controlled_experiment_observation_topic_required",
    ),
    game: requiredText(
      value.game,
      "controlled_experiment_observation_game_required",
    ),
    subject_platform: requiredText(
      value.subject_platform,
      "controlled_experiment_observation_subject_platform_required",
    ),
    source_type: requiredText(
      value.source_type,
      "controlled_experiment_observation_source_type_required",
    ),
    consequence_lane: requiredText(
      value.consequence_lane,
      "controlled_experiment_observation_consequence_lane_required",
    ),
    renderer_version: requiredText(
      value.renderer_version,
      "controlled_experiment_observation_renderer_version_required",
    ),
    qa_result: qaResult,
  };
}

function normaliseBody(value) {
  exactFields(
    value,
    BODY_FIELDS,
    "controlled_experiment_observation_body_fields_invalid",
  );
  const experiment = normaliseExperiment(value.experiment);
  let creativeStatic;
  if (experiment.eligible) {
    creativeStatic = normaliseCreativeStatic(value.creative_static);
  } else if (value.creative_static === null) {
    creativeStatic = null;
  } else if (
    plainObject(value.creative_static) &&
    Object.keys(value.creative_static).length === 0
  ) {
    creativeStatic = {};
  } else {
    fail(
      "controlled_experiment_observation_ineligible_creative_static_forbidden",
    );
  }
  return {
    identity: normaliseIdentity(value.identity),
    experiment,
    creative_static: creativeStatic,
    bindings: normaliseBindings(value.bindings),
  };
}

function expectedEvidence(options) {
  if (!plainObject(options)) {
    fail(
      "controlled_experiment_observation_expected_evidence_required",
    );
  }
  exactFields(
    options,
    new Set(["expectedIdentity", "expectedBindings"]),
    "controlled_experiment_observation_expected_evidence_fields_invalid",
  );
  return {
    identity: normaliseIdentity(options.expectedIdentity),
    bindings: normaliseBindings(options.expectedBindings),
  };
}

function assertExpectedEvidence(body, expected) {
  if (canonicalJson(body.identity) !== canonicalJson(expected.identity)) {
    fail("controlled_experiment_observation_identity_mismatch");
  }
  if (canonicalJson(body.bindings) !== canonicalJson(expected.bindings)) {
    fail("controlled_experiment_observation_bindings_mismatch");
  }
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

function validateControlledExperimentObservation(value, options) {
  exactFields(
    value,
    OBSERVATION_FIELDS,
    "controlled_experiment_observation_fields_invalid",
  );
  if (
    value.schema_version !==
    CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION
  ) {
    fail("controlled_experiment_observation_schema_invalid");
  }
  const body = normaliseBody({
    identity: value.identity,
    experiment: value.experiment,
    creative_static: value.creative_static,
    bindings: value.bindings,
  });
  const canonicalObservation = {
    schema_version:
      CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION,
    ...body,
  };
  if (
    canonicalJson(canonicalObservation) !==
    canonicalJson(
      Object.fromEntries(
        Object.entries(value).filter(
          ([field]) => field !== "observation_sha256",
        ),
      ),
    )
  ) {
    fail("controlled_experiment_observation_not_canonical");
  }
  const sha256 = exactSha256(
    value.observation_sha256,
    "controlled_experiment_observation_sha256_invalid",
  );
  if (
    canonicalControlledExperimentObservationSha256(
      canonicalObservation,
    ) !== sha256
  ) {
    fail("controlled_experiment_observation_sha256_mismatch");
  }
  assertExpectedEvidence(body, expectedEvidence(options));
  const observation = deepFreeze({
    ...canonicalObservation,
    observation_sha256: sha256,
  });
  return deepFreeze({
    observation,
    value: observation,
    sha256,
  });
}

function buildControlledExperimentObservation(value, options) {
  const body = normaliseBody(value);
  assertExpectedEvidence(body, expectedEvidence(options));
  const observation = {
    schema_version:
      CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION,
    ...body,
  };
  observation.observation_sha256 =
    canonicalControlledExperimentObservationSha256(observation);
  return validateControlledExperimentObservation(
    observation,
    options,
  ).observation;
}

module.exports = {
  CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION,
  SCHEMA_VERSION,
  ControlledExperimentObservationError,
  buildControlledExperimentObservation,
  canonicalControlledExperimentObservationSha256,
  validateControlledExperimentObservation,
};
