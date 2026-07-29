"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");
const {
  canonicalSha256,
  createAutonomousWindowEligibilityAttestation,
} = require("../../lib/services/governed-youtube-release-runway");
const {
  STATIC_ARTIFACT_FIELDS,
  createAutonomousOfficialJitPreparationManifest,
} = require("../../lib/services/autonomous-official-jit-admission-packet");
const {
  youtubeAdmissionJobIdempotencyKey,
} = require("../../lib/services/governed-publication-job-identity");

const NOW = "2026-07-29T17:45:00.000Z";
const T90 = "2026-07-29T17:30:00.000Z";
const SCHEDULED_FOR = "2026-07-29T19:00:00.000Z";
const STORY_ID = "handler-jit-primary";
const REVISION = "1".repeat(64);
const REQUEST_FINGERPRINT = "2".repeat(64);
const LOCK_SHA256 = "3".repeat(64);
const HASHES = Object.freeze({
  media_sha256: "4".repeat(64),
  script_sha256: "5".repeat(64),
  qa_report_sha256: "6".repeat(64),
  rights_ledger_sha256: "7".repeat(64),
  source_evidence_sha256: "8".repeat(64),
});

function fixture() {
  const preparation =
    createAutonomousOfficialJitPreparationManifest({
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      candidate_revision_sha256: REVISION,
      request_fingerprint: REQUEST_FINGERPRINT,
      artifacts: Object.fromEntries(
        STATIC_ARTIFACT_FIELDS.map((field, index) => [
          field,
          {
            path: `output/${STORY_ID}/${field}`,
            sha256: (index + 20)
              .toString(16)
              .padStart(2, "0")
              .repeat(32),
          },
        ]),
      ),
      owned_visual_assets: [],
      publication_evidence_gate_input: {
        originality_transformation: {},
        rights_ledger: {
          ledger_version: 1,
          decision: "CLEARED",
          items: [],
        },
        rights_ledger_sha256: HASHES.rights_ledger_sha256,
        synthetic_media_disclosure: {
          decision_authority: "SYSTEM_POLICY",
          decision_provenance: {
            policy_id: "pulse-synthetic-media-policy",
            policy_version: "v1",
            evaluated_at: T90,
            evidence_sha256: "9".repeat(64),
          },
          altered_content: true,
          policy_basis: "DISCLOSE",
          youtube_field_value: true,
        },
      },
    });
  const greenBody = {
    result_schema_version:
      "pulse-autonomous-green-admission-result-v2",
    evaluator_schema_version:
      "pulse-autonomous-green-admission-evaluator-v2",
    policy_version: "pulse-autonomous-green-policy-v2",
    decision_scope: "EDITORIAL_ELIGIBILITY_ONLY",
    operational_publish_authority: false,
    trust_semantics: "AUTHORITATIVE_MATERIALISER_REQUIRED",
    dispatch_revalidation_required: true,
    evaluated_at: T90,
    valid_until: "2026-07-29T18:00:00.000Z",
    story_id: STORY_ID,
    final_mp4_sha256: HASHES.media_sha256,
    verdict: "GREEN",
    eligible: true,
    blockers: [],
    evidence_sha256: "a".repeat(64),
  };
  const attestation =
    createAutonomousWindowEligibilityAttestation({
      now: new Date(T90),
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
      lane_id: "breaking_short",
      platform: "youtube",
      scheduled_for: SCHEDULED_FOR,
      role: "PRIMARY",
      evidence_hashes: HASHES,
      source_report: {
        path: `output/${STORY_ID}/t90-report.json`,
        file_sha256: "b".repeat(64),
        report_sha256: "c".repeat(64),
        request_sha256: "d".repeat(64),
        generated_at: "2026-07-29T17:29:30.000Z",
        valid_until: "2026-07-29T18:00:00.000Z",
      },
      green_admission: {
        ...greenBody,
        decision_sha256: canonicalSha256(greenBody),
      },
      jit_preparation: preparation,
    });
  const admission = {
    approval_type: "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
    human_admission_required: false,
    confirmation_story_id: STORY_ID,
    scheduled_for: SCHEDULED_FOR,
    autonomous_eligibility_attestation_sha256:
      attestation.attestation_sha256,
    jit_preparation_sha256: preparation.preparation_sha256,
    autonomous_window_eligibility_attestation: attestation,
    jit_preparation: preparation,
  };
  const idempotencyKey = youtubeAdmissionJobIdempotencyKey({
    laneId: "breaking_short",
    storyId: STORY_ID,
    candidateRevisionSha256: REVISION,
    scheduledFor: SCHEDULED_FOR,
  });
  const job = {
    id: 401,
    kind: "admit_governed_publication",
    channel_id: "pulse-gaming",
    run_at: NOW,
    idempotency_key: idempotencyKey,
    payload: {
      lane_id: "breaking_short",
      story_id: STORY_ID,
      platform: "youtube",
      guarded_admission_authority: true,
      human_admission_required: false,
      autonomous_jit_materialisation_required: true,
      candidate_revision_sha256: REVISION,
      admission,
    },
  };
  const lock = {
    lock_sha256: LOCK_SHA256,
    scheduled_for: SCHEDULED_FOR,
    primary: {
      story_id: STORY_ID,
      candidate_revision_sha256: REVISION,
    },
    primary_admission_job: {
      job_id: job.id,
      idempotency_key: idempotencyKey,
      candidate_revision_sha256: REVISION,
      scheduled_for: SCHEDULED_FOR,
    },
  };
  return { preparation, attestation, admission, job, lock };
}

function liveEnv() {
  return {
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "7".repeat(64),
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_KILL_SWITCH: "false",
  };
}

test("T-75 acquires the publisher lease, materialises fresh authority and immediately admits it without human fields", async () => {
  const value = fixture();
  const calls = [];
  const authority = {
    authority_id: "autonomous-official-publication:fresh",
    authority_sha256: "e".repeat(64),
    issued_at: NOW,
    valid_until: "2026-07-29T17:46:00.000Z",
  };
  const publicationEvidence = {
    schema_version: "pulse-publication-evidence-v1",
  };
  const result = await handlers.admit_governed_publication(
    value.job,
    {
      repos: { marker: true, runtimeLeases: {} },
      env: liveEnv(),
      now: () => new Date(NOW),
      autonomousWorkspaceRoot: process.cwd(),
      channel: { id: "pulse-gaming" },
      assertLeaseHealthy() {},
      async loadGovernedRunwayEnvelope() {
        return {
          lock: value.lock,
          blockers: [],
        };
      },
      async runWithPublisherLease(options) {
        calls.push("lease");
        assert.equal(
          options.operation,
          "autonomous_t75_jit_admission",
        );
        return options.task({
          assertHealthy() {},
          lease: {
            acquired: true,
            lease_name: "publisher:global",
            owner_id: "publisher:test",
            expires_at: "2026-07-29T17:47:00.000Z",
          },
        });
      },
      async materialiseAutonomousOfficialJitAdmissionPacket(
        request,
        options,
      ) {
        calls.push("jit");
        assert.equal(request.runway_lock, value.lock);
        assert.equal(request.runway_binding, value.lock.primary);
        assert.equal(
          request.eligibility_attestation,
          value.attestation,
        );
        assert.equal(
          request.preparation_manifest,
          value.preparation,
        );
        assert.equal(
          Object.hasOwn(request, "authority"),
          false,
        );
        assert.equal(options.clock().toISOString(), NOW);
        return {
          verdict: "GREEN",
          role: "PRIMARY",
          runway_lock_sha256: LOCK_SHA256,
          admission_packet: {
            authority,
            storyId: STORY_ID,
            channelId: "pulse-gaming",
            laneId: "breaking_short",
            platform: "youtube",
            scheduledFor: SCHEDULED_FOR,
            runwayLockSha256: LOCK_SHA256,
            requestFingerprint: REQUEST_FINGERPRINT,
            publicationEvidence,
          },
        };
      },
      async admitAutonomousOfficialPublication(options) {
        calls.push("admit");
        assert.equal(options.authority, authority);
        assert.equal(
          options.requestFingerprint,
          REQUEST_FINGERPRINT,
        );
        assert.equal(
          options.publicationEvidence,
          publicationEvidence,
        );
        assert.equal(Object.hasOwn(options, "actorId"), false);
        assert.equal(Object.hasOwn(options, "reason"), false);
        return {
          admitted: true,
          story_id: STORY_ID,
          lifecycle_state: "SCHEDULED",
          scheduled_for: SCHEDULED_FOR,
          dispatch_idempotency_key:
            `youtube:${STORY_ID}:${SCHEDULED_FOR}`,
          request_fingerprint: REQUEST_FINGERPRINT,
          dispatch_job: {
            id: 402,
            kind: "verify_governed_youtube_release_t0",
            payload: {
              story_id: STORY_ID,
              platform: "youtube",
              scheduled_event_id: 403,
              scheduled_for: SCHEDULED_FOR,
              dispatch_idempotency_key:
                `youtube:${STORY_ID}:${SCHEDULED_FOR}`,
              request_fingerprint: REQUEST_FINGERPRINT,
            },
          },
        };
      },
    },
  );

  assert.equal(result.status, "scheduled", JSON.stringify(result));
  assert.deepEqual(calls, ["lease", "jit", "admit"]);
  assert.equal(result.no_external_posting, true);
});

test("T-75 rejects a preissued authority in the eligibility job before lease or lifecycle mutation", async () => {
  const value = fixture();
  value.job.payload.admission.autonomous_publication_authority = {
    authority_sha256: "f".repeat(64),
  };
  let called = false;
  const result = await handlers.admit_governed_publication(
    value.job,
    {
      repos: {},
      env: liveEnv(),
      now: () => new Date(NOW),
      async runWithPublisherLease() {
        called = true;
      },
    },
  );
  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.ok(
    result.blockers.includes(
      "autonomous_jit_human_or_preissued_authority_forbidden",
    ),
    JSON.stringify(result),
  );
  assert.equal(result.lifecycle_mutation_attempted, false);
});
