"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  verifyExactGovernedYoutubeScheduledReplay,
} = require("../../lib/services/governed-youtube-scheduled-replay-verifier");

const NOW = "2026-07-28T18:45:00.000Z";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const EXTERNAL_ID = "pulse-scheduled-object";
const BINDING = Object.freeze({
  story_id: "scheduled-replay-story",
  channel_id: "pulse-gaming",
  platform: "youtube",
  scheduled_event_id: 801,
  scheduled_for: SCHEDULED_FOR,
  dispatch_idempotency_key:
    `youtube:scheduled-replay-story:${SCHEDULED_FOR}`,
  request_fingerprint: "1".repeat(64),
  runway_lock_sha256: "2".repeat(64),
  media_sha256: "3".repeat(64),
  script_sha256: "4".repeat(64),
});

function fixture() {
  const calls = {
    lease: 0,
    session: 0,
    proof: 0,
    client: 0,
    revalidate: 0,
    verifier: 0,
    commitment: 0,
    mutation: 0,
  };
  const scheduledEvidence = {
    channel_id: BINDING.channel_id,
    schedule_verified: true,
    control_tower_verdict: "GREEN",
    control_tower_checked_at: NOW,
    kill_switch_healthy: true,
    operating_contract_valid: true,
    scheduled_for: SCHEDULED_FOR,
    dispatch_idempotency_key:
      BINDING.dispatch_idempotency_key,
    request_fingerprint:
      BINDING.request_fingerprint,
    runway_lock_sha256:
      BINDING.runway_lock_sha256,
    media_sha256: BINDING.media_sha256,
    script_sha256: BINDING.script_sha256,
    publication_evidence: {
      source_evidence_sha256: "5".repeat(64),
    },
  };
  const event = {
    id: BINDING.scheduled_event_id,
    story_id: BINDING.story_id,
    platform: "youtube",
    to_state: "SCHEDULED",
    evidence_json: JSON.stringify(scheduledEvidence),
  };
  const proof = {
    verdict: "GREEN",
    expected_channel_id: "UCpulse",
    configured_oauth_client_sha256: "6".repeat(64),
    proof_sha256: "7".repeat(64),
  };
  const youtubeClient = {
    videos: {
      async list() {
        throw new Error(
          "injected verifier owns the read-only observation",
        );
      },
    },
  };
  const repos = {
    runtimeLeases: {},
    publicationGovernance: {
      getLatestLifecycleEvent() {
        return structuredClone(event);
      },
      assertScheduledPlatformReleaseCommitment() {
        calls.commitment += 1;
        return {
          externalId: EXTERNAL_ID,
        };
      },
      recordPlatformScheduled() {
        calls.mutation += 1;
        throw new Error("replay_must_not_mutate");
      },
    },
  };
  return {
    calls,
    proof,
    youtubeClient,
    repos,
    input: {
      exactStagedBinding: BINDING,
      externalId: EXTERNAL_ID,
      repos,
      env: {
        PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
          "6".repeat(64),
      },
      now: () => new Date(NOW),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      validateYouTubeAccountBindingProof(value) {
        calls.proof += 1;
        assert.equal(value, proof);
        return { value };
      },
      async runWithPublisherLease(options) {
        calls.lease += 1;
        assert.equal(
          options.operation,
          "verify_governed_youtube_scheduled_replay",
        );
        return options.task({
          assertHealthy() {},
        });
      },
      async createFreshYoutubeAccountBoundSession(
        options,
      ) {
        calls.session += 1;
        assert.equal(
          Object.hasOwn(
            options,
            "createAuthenticatedClient",
          ),
          false,
        );
        return {
          getBindingProof() {
            return proof;
          },
          getYoutubeClient() {
            calls.client += 1;
            return youtubeClient;
          },
          async revalidate() {
            calls.revalidate += 1;
            return proof;
          },
        };
      },
      createYoutubeScheduledObjectVerifier(options) {
        assert.equal(
          options.youtubeClient,
          youtubeClient,
        );
        return async (candidate) => {
          calls.verifier += 1;
          assert.equal(
            candidate.externalId,
            EXTERNAL_ID,
          );
          return {
            confirmed: true,
            externalId: EXTERNAL_ID,
            scheduledFor: SCHEDULED_FOR,
            verifiedAt: NOW,
            reason:
              "youtube_private_schedule_processed",
            evidence: {
              scheduled_release_confirmed: true,
              privacy_status: "private",
              publish_at: SCHEDULED_FOR,
              upload_status: "processed",
              processing_status: "succeeded",
              checked_at: NOW,
            },
          };
        };
      },
    },
  };
}

test("scheduled replay threads trusted runtime, claimed job and canonical admission authority into its one lease", async () => {
  const runtimeAuthority = Object.freeze({
    runtime_instance_id: "ri-11111111-2222-4333-8444-555555555555",
    child_pid: process.pid,
    child_started_at: "2026-08-02T10:00:00.000Z",
    authority_fingerprint: "a".repeat(64),
  });
  const claimedJobAuthority = Object.freeze({
    schema_version: "pulse-claimed-job-authority-v1",
    job_id: 73,
    claimed_job_authority_sha256: "9".repeat(64),
  });
  const db = { authority: true };
  let leaseInput = null;
  const result = await verifyExactGovernedYoutubeScheduledReplay({
    exactStagedBinding: BINDING,
    externalId: EXTERNAL_ID,
    repos: {
      db,
      runtimeLeases: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {},
        assertScheduledPlatformReleaseCommitment() {},
      },
    },
    runtimeAuthority,
    claimedJobAuthority,
    admissionContext: { channel_id: "stacked", story_id: "forged" },
    runWithPublisherLease(input) {
      leaseInput = input;
      return { captured: true };
    },
  });
  assert.deepEqual(result, { captured: true });
  assert.equal(leaseInput.db, db);
  assert.equal(leaseInput.runtimeAuthority, runtimeAuthority);
  assert.equal(leaseInput.claimedJobAuthority, claimedJobAuthority);
  assert.deepEqual(leaseInput.admissionContext, {
    schema_version: "pulse-admitted-publication-operation-v2",
    channel_id: BINDING.channel_id,
    story_id: BINDING.story_id,
    platform: "youtube",
    scheduled_event_id: BINDING.scheduled_event_id,
    scheduled_for: BINDING.scheduled_for,
    dispatch_idempotency_key: BINDING.dispatch_idempotency_key,
    request_fingerprint: BINDING.request_fingerprint,
    runway_lock_sha256: BINDING.runway_lock_sha256,
  });
});

test("PLATFORM_SCHEDULED replay uses one fresh account-bound session for a read-only remote verification inside the publisher lease", async () => {
  const exact = fixture();
  const result =
    await verifyExactGovernedYoutubeScheduledReplay(
      exact.input,
    );

  assert.equal(result.confirmed, true);
  assert.equal(result.reused, true);
  assert.equal(result.externalId, EXTERNAL_ID);
  assert.equal(
    result.youtubeAccountBindingProof,
    exact.proof,
  );
  assert.deepEqual(result.side_effects, {
    read_only_network_contacted: true,
    database_mutated: false,
    external_mutation_attempted: false,
    upload_attempted: false,
  });
  assert.deepEqual(exact.calls, {
    lease: 1,
    session: 1,
    proof: 2,
    client: 2,
    revalidate: 1,
    verifier: 1,
    commitment: 2,
    mutation: 0,
  });
});

test("PLATFORM_SCHEDULED replay fails closed when the same-session remote read does not confirm the exact schedule", async () => {
  const exact = fixture();
  exact.input.createYoutubeScheduledObjectVerifier =
    () => async () => ({
      confirmed: false,
      externalId: EXTERNAL_ID,
      scheduledFor: SCHEDULED_FOR,
      reason: "youtube_publish_at_mismatch",
      evidence: {
        scheduled_release_confirmed: false,
      },
    });

  await assert.rejects(
    () =>
      verifyExactGovernedYoutubeScheduledReplay(
        exact.input,
      ),
    {
      code: "youtube_publish_at_mismatch",
    },
  );
  assert.equal(exact.calls.mutation, 0);
  assert.equal(exact.calls.revalidate, 0);
});
