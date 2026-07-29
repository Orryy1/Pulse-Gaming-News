"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION,
  buildControlledExperimentObservation,
  canonicalControlledExperimentObservationSha256,
  validateControlledExperimentObservation,
} = require("../../lib/services/controlled-experiment-observation");

function eligibleInput() {
  return {
    identity: {
      story_id: "official_xbox_classics",
      channel_id: "pulse-gaming",
    },
    experiment: {
      eligible: true,
      experiment_id: "pulse-v1-controlled-12",
      matrix_version: "pulse-controlled-12-v1",
      expected_cell_id: "platform_pulse:open_loop:short",
      ineligibility_reason: null,
    },
    creative_static: {
      runtime_seconds: 32,
      hook_type: "open_loop",
      narrator_version: "pulse-liam-v3",
      first_frame_text: "FOUR XBOX CLASSICS. ONE BIG CHANGE.",
      motion_ratio: 0.72,
      topic: "backwards-compatibility",
      game: "Xbox Classics",
      subject_platform: "xbox-pc",
      source_type: "official_publisher",
      consequence_lane: "platform_pulse",
      renderer_version: "pulse-v2-game-native-1",
      qa_result: "pass",
    },
    bindings: {
      story_intake_sha256: "1".repeat(64),
      narration_manifest_sha256: "2".repeat(64),
      renderer_manifest_file_sha256: "3".repeat(64),
      renderer_manifest_canonical_sha256: "4".repeat(64),
      qa_report_sha256: "5".repeat(64),
      media_sha256: "6".repeat(64),
      script_sha256: "7".repeat(64),
    },
  };
}

function expectedFor(input) {
  return {
    expectedIdentity: structuredClone(input.identity),
    expectedBindings: structuredClone(input.bindings),
  };
}

test("builds a canonical eligible observation from explicit immutable evidence", () => {
  const input = eligibleInput();
  const observation = buildControlledExperimentObservation(
    input,
    expectedFor(input),
  );

  assert.equal(
    observation.schema_version,
    CONTROLLED_EXPERIMENT_OBSERVATION_SCHEMA_VERSION,
  );
  assert.deepEqual(observation.identity, input.identity);
  assert.deepEqual(observation.experiment, input.experiment);
  assert.deepEqual(observation.creative_static, input.creative_static);
  assert.deepEqual(observation.bindings, input.bindings);
  assert.match(observation.observation_sha256, /^[a-f0-9]{64}$/);
});

test("records an explicit ineligible decision without fabricating creative evidence", () => {
  const input = eligibleInput();
  input.experiment = {
    eligible: false,
    experiment_id: null,
    matrix_version: null,
    expected_cell_id: null,
    ineligibility_reason: "lane_policy_experiment_ineligible",
  };
  input.creative_static = null;

  const observation = buildControlledExperimentObservation(
    input,
    expectedFor(input),
  );

  assert.deepEqual(observation.experiment, input.experiment);
  assert.equal(observation.creative_static, null);
  assert.match(observation.observation_sha256, /^[a-f0-9]{64}$/);

  const emptyCreativeInput = structuredClone(input);
  emptyCreativeInput.creative_static = {};
  const emptyCreativeObservation =
    buildControlledExperimentObservation(
      emptyCreativeInput,
      expectedFor(emptyCreativeInput),
    );
  assert.deepEqual(emptyCreativeObservation.creative_static, {});
});

test("eligible observation hashing is deterministic and excludes only the self hash", () => {
  const input = eligibleInput();
  const reordered = {
    bindings: Object.fromEntries(
      Object.entries(input.bindings).reverse(),
    ),
    creative_static: Object.fromEntries(
      Object.entries(input.creative_static).reverse(),
    ),
    experiment: Object.fromEntries(
      Object.entries(input.experiment).reverse(),
    ),
    identity: Object.fromEntries(
      Object.entries(input.identity).reverse(),
    ),
  };

  const first = buildControlledExperimentObservation(
    input,
    expectedFor(input),
  );
  const second = buildControlledExperimentObservation(
    reordered,
    expectedFor(input),
  );

  assert.equal(
    first.observation_sha256,
    "849d9b34cca81e55362448690d0cde9a2fcb9ef1985483e481ed888c3797965c",
  );
  assert.equal(second.observation_sha256, first.observation_sha256);
  assert.equal(
    canonicalControlledExperimentObservationSha256({
      ...structuredClone(first),
      observation_sha256: "f".repeat(64),
    }),
    first.observation_sha256,
  );
});

test("validation exposes the immutable canonical observation and digest", () => {
  const input = eligibleInput();
  const observation = buildControlledExperimentObservation(
    input,
    expectedFor(input),
  );

  const result = validateControlledExperimentObservation(
    structuredClone(observation),
    expectedFor(input),
  );

  assert.equal(result.sha256, observation.observation_sha256);
  assert.strictEqual(result.value, result.observation);
  assert.deepEqual(result.observation, observation);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.observation));
  assert.ok(Object.isFrozen(result.observation.creative_static));
});

test("missing eligibility cannot be interpreted as an ineligible observation", () => {
  const input = eligibleInput();
  delete input.experiment.eligible;

  assert.throws(
    () =>
      buildControlledExperimentObservation(
        input,
        expectedFor(eligibleInput()),
      ),
    {
      code: "controlled_experiment_observation_experiment_fields_invalid",
    },
  );
});

test("an ineligible observation requires an exact reason and no experiment identity", () => {
  const missingReason = eligibleInput();
  missingReason.experiment = {
    eligible: false,
    experiment_id: null,
    matrix_version: null,
    expected_cell_id: null,
    ineligibility_reason: "",
  };
  missingReason.creative_static = {};

  assert.throws(
    () =>
      buildControlledExperimentObservation(
        missingReason,
        expectedFor(missingReason),
      ),
    {
      code:
        "controlled_experiment_observation_ineligibility_reason_required",
    },
  );

  const ambiguousIdentity = structuredClone(missingReason);
  ambiguousIdentity.experiment.ineligibility_reason =
    "lane_policy_experiment_ineligible";
  ambiguousIdentity.experiment.experiment_id =
    "pulse-v1-controlled-12";
  assert.throws(
    () =>
      buildControlledExperimentObservation(
        ambiguousIdentity,
        expectedFor(ambiguousIdentity),
      ),
    {
      code:
        "controlled_experiment_observation_ineligible_identity_forbidden",
    },
  );
});

test("eligible creative evidence is exact-field and fail-closed", () => {
  const missing = eligibleInput();
  delete missing.creative_static.first_frame_text;
  assert.throws(
    () =>
      buildControlledExperimentObservation(
        missing,
        expectedFor(missing),
      ),
    {
      code:
        "controlled_experiment_observation_creative_static_fields_invalid",
    },
  );

  const derived = eligibleInput();
  derived.creative_static.story_title =
    "mutable title must not become creative evidence";
  assert.throws(
    () =>
      buildControlledExperimentObservation(
        derived,
        expectedFor(derived),
      ),
    {
      code:
        "controlled_experiment_observation_creative_static_fields_invalid",
    },
  );

  const unsafeQa = eligibleInput();
  unsafeQa.creative_static.qa_result = "warning";
  assert.throws(
    () =>
      buildControlledExperimentObservation(
        unsafeQa,
        expectedFor(unsafeQa),
      ),
    {
      code: "controlled_experiment_observation_qa_result_invalid",
    },
  );
});

test("caller-provided identity and binding expectations are mandatory and exact", () => {
  const input = eligibleInput();
  assert.throws(
    () => buildControlledExperimentObservation(input),
    {
      code:
        "controlled_experiment_observation_expected_evidence_required",
    },
  );

  const wrongIdentity = expectedFor(input);
  wrongIdentity.expectedIdentity.story_id = "different-story";
  assert.throws(
    () =>
      buildControlledExperimentObservation(input, wrongIdentity),
    {
      code: "controlled_experiment_observation_identity_mismatch",
    },
  );

  const wrongBindings = expectedFor(input);
  wrongBindings.expectedBindings.media_sha256 = "a".repeat(64);
  assert.throws(
    () =>
      buildControlledExperimentObservation(input, wrongBindings),
    {
      code: "controlled_experiment_observation_bindings_mismatch",
    },
  );
});

test("validation rejects content, hash and unexpected-field tampering", () => {
  const input = eligibleInput();
  const observation = buildControlledExperimentObservation(
    input,
    expectedFor(input),
  );

  const contentTamper = structuredClone(observation);
  contentTamper.creative_static.topic = "mutable-story-title";
  assert.throws(
    () =>
      validateControlledExperimentObservation(
        contentTamper,
        expectedFor(input),
      ),
    {
      code: "controlled_experiment_observation_sha256_mismatch",
    },
  );

  const digestTamper = structuredClone(observation);
  digestTamper.observation_sha256 = "f".repeat(64);
  assert.throws(
    () =>
      validateControlledExperimentObservation(
        digestTamper,
        expectedFor(input),
      ),
    {
      code: "controlled_experiment_observation_sha256_mismatch",
    },
  );

  const unexpectedField = structuredClone(observation);
  unexpectedField.story_title = "mutable source";
  assert.throws(
    () =>
      validateControlledExperimentObservation(
        unexpectedField,
        expectedFor(input),
      ),
    {
      code: "controlled_experiment_observation_fields_invalid",
    },
  );
});

test("a rehashed identity or binding drift still fails caller evidence checks", () => {
  const input = eligibleInput();
  const observation = buildControlledExperimentObservation(
    input,
    expectedFor(input),
  );

  const identityDrift = structuredClone(observation);
  identityDrift.identity.story_id = "different-story";
  identityDrift.observation_sha256 =
    canonicalControlledExperimentObservationSha256(identityDrift);
  assert.throws(
    () =>
      validateControlledExperimentObservation(
        identityDrift,
        expectedFor(input),
      ),
    {
      code: "controlled_experiment_observation_identity_mismatch",
    },
  );

  const bindingDrift = structuredClone(observation);
  bindingDrift.bindings.media_sha256 = "a".repeat(64);
  bindingDrift.observation_sha256 =
    canonicalControlledExperimentObservationSha256(bindingDrift);
  assert.throws(
    () =>
      validateControlledExperimentObservation(
        bindingDrift,
        expectedFor(input),
      ),
    {
      code: "controlled_experiment_observation_bindings_mismatch",
    },
  );
});
