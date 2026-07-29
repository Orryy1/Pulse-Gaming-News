"use strict";

const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  validateYouTubeAccountBindingProof,
} = require("./youtube-account-binding-verifier");
const {
  assertSameExactScheduledYoutubeTicket,
  normaliseExactYoutubeStagedBinding,
  readExactScheduledYoutubeTicket,
} = require("./governed-youtube-publisher-adapter");
const {
  runWithPublisherLease: defaultRunWithPublisherLease,
} = require("./publisher-lock");

function text(value) {
  return String(value ?? "").trim();
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactClock(value) {
  const resolved =
    typeof value === "function" ? value() : value;
  const parsed =
    resolved instanceof Date
      ? new Date(resolved.getTime())
      : new Date(resolved);
  if (Number.isNaN(parsed.getTime())) {
    fail("youtube_scheduled_replay_clock_invalid");
  }
  return parsed;
}

function requiredFunction(value, code) {
  if (typeof value !== "function") fail(code);
  return value;
}

function validateSession(value) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.getYoutubeClient !== "function" ||
    typeof value.getBindingProof !== "function" ||
    typeof value.revalidate !== "function"
  ) {
    fail("youtube_scheduled_replay_account_bound_session_required");
  }
  return value;
}

function validateRemoteScheduledObservation(
  value,
  binding,
  externalId,
) {
  if (
    value?.confirmed !== true ||
    text(value.externalId) !== externalId ||
    text(value.scheduledFor) !== binding.scheduledFor ||
    value?.evidence?.scheduled_release_confirmed !== true ||
    text(value.evidence.privacy_status).toLowerCase() !==
      "private" ||
    text(value.evidence.publish_at) !==
      binding.scheduledFor ||
    text(value.evidence.upload_status).toLowerCase() !==
      "processed" ||
    text(
      value.evidence.processing_status,
    ).toLowerCase() !== "succeeded"
  ) {
    fail(
      value?.reason ||
        "youtube_scheduled_replay_remote_readback_not_confirmed",
    );
  }
  return value;
}

async function verifyExactGovernedYoutubeScheduledReplay(
  input = {},
) {
  const binding = normaliseExactYoutubeStagedBinding(
    input.exactStagedBinding || input.binding,
    { channelId: input.channelId },
  );
  const externalId = text(
    input.externalId || input.external_id,
  );
  if (!externalId) {
    fail("youtube_scheduled_replay_external_id_required");
  }
  const repos = input.repos;
  if (
    !repos?.publicationGovernance ||
    typeof repos.publicationGovernance
      .getLatestLifecycleEvent !== "function" ||
    typeof repos.publicationGovernance
      .assertScheduledPlatformReleaseCommitment !==
      "function"
  ) {
    fail(
      "youtube_scheduled_replay_governance_repository_required",
    );
  }
  const clock = () => exactClock(input.now || new Date());
  const runWithPublisherLease =
    input.runWithPublisherLease ||
    defaultRunWithPublisherLease;
  const result = await requiredFunction(
    runWithPublisherLease,
    "publisher_lease_runner_required",
  )({
    leases: input.leases || repos.runtimeLeases,
    channelId: binding.channelId,
    operation:
      "verify_governed_youtube_scheduled_replay",
    ownerId: input.ownerId,
    leaseMs: input.leaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    metadata: {
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      request_fingerprint: binding.requestFingerprint,
      runway_lock_sha256: binding.runwayLockSha256,
      external_id: externalId,
      external_create_authority: "none",
      verification_only: true,
      read_only: true,
    },
    log: input.log || (() => {}),
    task: async ({ assertHealthy }) => {
      const assertLeaseHealthy = requiredFunction(
        assertHealthy,
        "youtube_scheduled_replay_lease_assertion_required",
      );
      assertLeaseHealthy();
      const validatePublicationEvidence =
        input.validatePublicationEvidence ||
        require("../../publisher")
          .readScheduledPublicationEvidence;
      const initialTicket =
        readExactScheduledYoutubeTicket({
          governance: repos.publicationGovernance,
          binding,
          validatePublicationEvidence,
        });
      repos.publicationGovernance
        .assertScheduledPlatformReleaseCommitment({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint:
            binding.requestFingerprint,
          runwayLockSha256:
            binding.runwayLockSha256,
          now: clock(),
        });
      assertLeaseHealthy();

      const createSession =
        input.createFreshYoutubeAccountBoundSession ||
        require("../../upload_youtube")
          .createFreshYoutubeAccountBoundSession;
      const session = validateSession(
        await requiredFunction(
          createSession,
          "youtube_scheduled_replay_account_bound_session_factory_required",
        )({
          env: input.env || process.env,
          now: clock,
          reportAuthTelemetry:
            input.reportAuthTelemetry,
        }),
      );
      const proofValidator =
        input.validateYouTubeAccountBindingProof ||
        validateYouTubeAccountBindingProof;
      const expectedClientSha256 = text(
        (input.env || process.env)
          .PULSE_YOUTUBE_OAUTH_CLIENT_SHA256,
      ).toLowerCase();
      const validateProof = (proof) =>
        requiredFunction(
          proofValidator,
          "youtube_scheduled_replay_account_proof_validator_required",
        )(proof, {
          expectedChannelId:
            EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
          configuredOAuthClientSha256:
            expectedClientSha256,
          now: clock,
        }).value;
      const initialProof = validateProof(
        session.getBindingProof(),
      );
      const youtubeClient = session.getYoutubeClient();
      const createVerifier =
        input.createYoutubeScheduledObjectVerifier ||
        require("./youtube-scheduled-object-verifier")
          .createYoutubeScheduledObjectVerifier;
      const verifyScheduled = requiredFunction(
        createVerifier,
        "youtube_scheduled_replay_verifier_factory_required",
      )({
        youtubeClient,
        now: clock,
        maxAttempts: 1,
        pollIntervalMs: 0,
        ...(input.scheduledVerifierOptions || {}),
      });
      assertLeaseHealthy();
      const verification =
        validateRemoteScheduledObservation(
          await requiredFunction(
            verifyScheduled,
            "youtube_scheduled_replay_verifier_required",
          )({
            platform: "youtube",
            storyId: binding.storyId,
            externalId,
            scheduledFor: binding.scheduledFor,
          }),
          binding,
          externalId,
        );
      assertLeaseHealthy();
      const finalProof = validateProof(
        await session.revalidate(),
      );
      if (session.getYoutubeClient() !== youtubeClient) {
        fail(
          "youtube_scheduled_replay_account_bound_client_changed",
        );
      }
      if (
        text(finalProof.expected_channel_id) !==
          text(initialProof.expected_channel_id) ||
        text(
          finalProof.configured_oauth_client_sha256,
        ).toLowerCase() !==
          text(
            initialProof.configured_oauth_client_sha256,
          ).toLowerCase()
      ) {
        fail(
          "youtube_scheduled_replay_account_binding_changed",
        );
      }
      const currentTicket =
        readExactScheduledYoutubeTicket({
          governance: repos.publicationGovernance,
          binding,
          validatePublicationEvidence,
        });
      assertSameExactScheduledYoutubeTicket(
        initialTicket,
        currentTicket,
      );
      repos.publicationGovernance
        .assertScheduledPlatformReleaseCommitment({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint:
            binding.requestFingerprint,
          runwayLockSha256:
            binding.runwayLockSha256,
          now: clock(),
        });
      assertLeaseHealthy();
      return {
        status: "platform_scheduled_verified",
        confirmed: true,
        scheduled: true,
        releaseArmed: true,
        reused: true,
        externalId,
        scheduledFor: binding.scheduledFor,
        verification,
        youtubeAccountBindingProof: finalProof,
        side_effects: {
          read_only_network_contacted: true,
          database_mutated: false,
          external_mutation_attempted: false,
          upload_attempted: false,
        },
      };
    },
  });
  if (result?.publish_dispatch_blocked === true) {
    fail(
      result.top_reason ||
        "youtube_scheduled_replay_publisher_lease_unavailable",
    );
  }
  return result;
}

module.exports = {
  verifyExactGovernedYoutubeScheduledReplay,
};
