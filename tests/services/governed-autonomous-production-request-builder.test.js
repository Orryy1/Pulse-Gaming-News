"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const test = require("node:test");

const {
  ARTIFACT_SCHEMA_VERSION: RESERVATION_SCHEMA_VERSION,
  MODE,
  canonicalSha256,
} = require("../../lib/services/governed-autonomous-window-reservation-set");
const {
  BUILDER_RESULT_SCHEMA_VERSION,
  BUILDER_SCHEMA_VERSION,
  RUNTIME_POLICY_SCHEMA_VERSION,
  buildGovernedAutonomousProductionRequest,
  validateGovernedAutonomousProductionRequestBuild,
} = require("../../lib/services/governed-autonomous-production-request-builder");
const {
  REQUEST_SCHEMA_VERSION: PRODUCTION_REQUEST_SCHEMA_VERSION,
} = require("../../lib/services/governed-autonomous-production-coordinator");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function reservationSet() {
  const body = {
    schema_version: RESERVATION_SCHEMA_VERSION,
    mode: MODE,
    state: "RESERVED_LOCAL_PROOF",
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: "2026-07-30T07:20:00.000Z",
    scheduled_for: "2026-07-30T09:00:00.000Z",
    channel_id: "pulse-gaming",
    lane_id: "breaking_short",
    platform: "youtube",
    reservations: [
      { role: "PRIMARY", story_id: "story-primary" },
      { role: "STANDBY", story_id: "story-standby" },
    ],
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  return {
    ...body,
    reservation_set_sha256: canonicalSha256(body),
  };
}

function lockedIntake(storyId = "story-primary") {
  const script =
    "Xbox just confirmed four classics are coming back with modern achievement support.";
  return {
    story_id: storyId,
    locked_intake: {
      inventory_path: "C:\\pulse\\inventory\\locked.json",
      inventory_file_sha256: sha256("locked-inventory"),
      inventory_root: "C:\\pulse\\inventory",
      allowed_roots: [
        "C:\\pulse\\inventory",
        "C:\\pulse\\candidate-source",
      ],
      canonical_identity_url:
        "https://news.xbox.com/en-us/2026/07/30/classics-return/",
      final_script: script,
      final_script_sha256: sha256(script),
      script_claim_bindings: [
        { claim_key: "games-return", source_index: 0 },
      ],
      presentation_claim_bindings: [
        { claim_key: "achievement-support", scene_index: 0 },
      ],
      supplemental_official_sources: [],
      contract: {
        editorial_lane_id: "breaking_short",
      },
      freshness: {
        publish_by: "2026-07-30T09:00:00.000Z",
      },
      visual_brief: {
        format: "game_native_news",
      },
      experiment_dimensions: {
        eligible: false,
      },
    },
  };
}

function creativePackage() {
  return {
    scenes: [
      {
        asset_id: "official-xbox-classics",
        role: "hook_slam",
      },
    ],
    title: "Four Xbox Classics Are Coming Back",
    description:
      "Four original Xbox games are returning with achievement support.",
    official_source_url:
      "https://news.xbox.com/en-us/2026/07/30/classics-return/",
    required_attributions: ["Official source: Xbox Wire"],
    subject_terms: ["Xbox classics", "achievement support"],
  };
}

function runtimePolicy() {
  return {
    schema_version: RUNTIME_POLICY_SCHEMA_VERSION,
    mode: MODE,
    generated_at: "2026-07-30T07:25:00.000Z",
    workspace_root: "C:\\pulse\\trusted-workspace",
    candidate_source_root: "C:\\pulse\\candidate-source",
    narration: {
      provider: "elevenlabs",
      voice_id: "pulse-liam-approved",
      model_id: "eleven_multilingual_v2",
      speed: 1,
    },
    visual_qa: {
      reviewers: [
        {
          provider: "ollama",
          model: "gemma3:12b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
        {
          provider: "ollama",
          model: "qwen2.5vl:7b",
          endpoint_origin: "http://127.0.0.1:11434",
        },
      ],
    },
    disclosure_policy: {
      policy_id: "pulse-youtube-synthetic-media",
      policy_version: "1",
    },
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
}

function input(overrides = {}) {
  return {
    schema_version: BUILDER_SCHEMA_VERSION,
    mode: MODE,
    reservation_set: reservationSet(),
    selected_role: "PRIMARY",
    story_id: "story-primary",
    locked_intake_binding: lockedIntake(),
    creative_package: creativePackage(),
    runtime_policy: runtimePolicy(),
    candidate_revision_sha256: sha256("candidate-revision"),
    request_fingerprint: sha256("candidate-request"),
    ...overrides,
  };
}

test("builds the exact coordinator request from one immutable role reservation", () => {
  const result = buildGovernedAutonomousProductionRequest(input());

  assert.equal(
    result.schema_version,
    BUILDER_RESULT_SCHEMA_VERSION,
  );
  assert.equal(result.story_id, "story-primary");
  assert.equal(result.role, "PRIMARY");
  assert.equal(
    result.scheduled_for,
    "2026-07-30T09:00:00.000Z",
  );
  assert.equal(
    result.reservation_set_sha256,
    reservationSet().reservation_set_sha256,
  );
  assert.deepEqual(result.production_request, {
    schema_version: PRODUCTION_REQUEST_SCHEMA_VERSION,
    mode: MODE,
    generated_at: "2026-07-30T07:25:00.000Z",
    scheduled_for: "2026-07-30T09:00:00.000Z",
    role: "PRIMARY",
    candidate_revision_sha256: sha256("candidate-revision"),
    request_fingerprint: sha256("candidate-request"),
    workspace_root: "C:\\pulse\\trusted-workspace",
    candidate_source_root: "C:\\pulse\\candidate-source",
    candidate_workspace_relative_root:
      "output/canary/story-primary",
    locked_intake: lockedIntake().locked_intake,
    creative: creativePackage(),
    narration: runtimePolicy().narration,
    visual_qa: runtimePolicy().visual_qa,
    disclosure_policy: runtimePolicy().disclosure_policy,
  });
  assert.deepEqual(result.safety, runtimePolicy().safety);
  const body = { ...result };
  delete body.builder_sha256;
  assert.equal(result.builder_sha256, canonicalSha256(body));
  assert.deepEqual(
    validateGovernedAutonomousProductionRequestBuild(result),
    result,
  );
});

test("selects the standby story only from the reservation set", () => {
  const standby = buildGovernedAutonomousProductionRequest(
    input({
      selected_role: "STANDBY",
      story_id: "story-standby",
      locked_intake_binding: lockedIntake("story-standby"),
    }),
  );

  assert.equal(standby.role, "STANDBY");
  assert.equal(standby.story_id, "story-standby");
  assert.equal(standby.production_request.role, "STANDBY");
  assert.equal(
    standby.production_request.candidate_workspace_relative_root,
    "output/canary/story-standby",
  );
});

test("rejects story and role drift across the reservation and locked intake", () => {
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({
          selected_role: "STANDBY",
          story_id: "story-primary",
        }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_reservation_mismatch",
  );
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({
          locked_intake_binding: lockedIntake("story-standby"),
        }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_locked_story_mismatch",
  );
});

test("closed inputs reject payload attempts to override role, story or schedule", () => {
  for (const override of [
    { role: "STANDBY" },
    { scheduled_for: "2026-07-30T19:00:00.000Z" },
    { reserved_story_id: "story-standby" },
  ]) {
    assert.throws(
      () =>
        buildGovernedAutonomousProductionRequest(
          input(override),
        ),
      (error) =>
        error?.code ===
        "production_request_builder_input_fields_invalid",
    );
  }

  const creativeOverride = creativePackage();
  creativeOverride.scheduled_for =
    "2026-07-30T19:00:00.000Z";
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({ creative_package: creativeOverride }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_creative_fields_invalid",
  );
});

test("rejects operational authority smuggled through flexible creative payloads", () => {
  const creative = creativePackage();
  creative.scenes[0].publish_authority = true;

  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({ creative_package: creative }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_publish_authority_forbidden",
  );
});

test("rejects reservation tampering and invalid explicit candidate hashes", () => {
  const tampered = reservationSet();
  tampered.reservations[0].story_id = "story-other";
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({ reservation_set: tampered }),
      ),
    (error) =>
      error?.code === "window_reservation_sha256_mismatch",
  );
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({ request_fingerprint: "not-a-hash" }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_request_fingerprint_invalid",
  );
});

test("rejects an internally inconsistent locked script binding and late runtime policy", () => {
  const locked = lockedIntake();
  locked.locked_intake.final_script_sha256 = sha256(
    "different script",
  );
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({ locked_intake_binding: locked }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_script_binding_invalid",
  );

  const late = runtimePolicy();
  late.generated_at = "2026-07-30T09:00:00.000Z";
  assert.throws(
    () =>
      buildGovernedAutonomousProductionRequest(
        input({ runtime_policy: late }),
      ),
    (error) =>
      error?.code ===
      "production_request_builder_generated_at_outside_window",
  );
});

test("result validation rejects rehashed identity and authority tampering", () => {
  const result = buildGovernedAutonomousProductionRequest(input());
  const roleDrift = structuredClone(result);
  roleDrift.production_request.role = "STANDBY";
  const roleDriftBody = { ...roleDrift };
  delete roleDriftBody.builder_sha256;
  roleDrift.builder_sha256 = canonicalSha256(roleDriftBody);
  assert.throws(
    () =>
      validateGovernedAutonomousProductionRequestBuild(roleDrift),
    (error) =>
      error?.code ===
      "production_request_builder_production_identity_mismatch",
  );

  const authority = structuredClone(result);
  authority.production_request.creative.scenes[0].scheduler_authority =
    true;
  const authorityBody = { ...authority };
  delete authorityBody.builder_sha256;
  authority.builder_sha256 = canonicalSha256(authorityBody);
  assert.throws(
    () =>
      validateGovernedAutonomousProductionRequestBuild(authority),
    (error) =>
      error?.code ===
      "production_request_builder_scheduler_authority_forbidden",
  );

  const runtimeDrift = structuredClone(result);
  runtimeDrift.production_request.narration.provider = "unknown";
  const runtimeDriftBody = { ...runtimeDrift };
  delete runtimeDriftBody.builder_sha256;
  runtimeDrift.builder_sha256 = canonicalSha256(runtimeDriftBody);
  assert.throws(
    () =>
      validateGovernedAutonomousProductionRequestBuild(
        runtimeDrift,
      ),
    (error) =>
      error?.code ===
      "production_request_builder_narration_invalid",
  );

  const scheduleDrift = structuredClone(result);
  scheduleDrift.scheduled_for = "2026-07-30T14:00:00.000Z";
  scheduleDrift.production_request.scheduled_for =
    scheduleDrift.scheduled_for;
  scheduleDrift.production_request.generated_at =
    "2026-07-30T13:00:00.000Z";
  const scheduleDriftBody = { ...scheduleDrift };
  delete scheduleDriftBody.builder_sha256;
  scheduleDrift.builder_sha256 = canonicalSha256(scheduleDriftBody);
  assert.throws(
    () =>
      validateGovernedAutonomousProductionRequestBuild(
        scheduleDrift,
      ),
    (error) =>
      error?.code ===
      "production_request_builder_guarded_window_required",
  );
});
