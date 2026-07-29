"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  armExactGovernedYoutubeScheduledRelease,
  assertLiveControlHealthy,
  assertRemoteDisarmAuthority,
  confirmExactGovernedYoutubeScheduledRelease,
  createAuthenticatedYoutubeClient,
  prestageExactGovernedYoutubeRelease,
  verifyExactGovernedYoutubePrivatePrestage,
} = require("../../lib/services/governed-youtube-publisher-adapter");
const {
  buildOfficialSourceReleaseBinding,
} = require("../../lib/services/official-source-revalidation");
const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
  REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
  YOUTUBE_READ_SCOPE_ALTERNATIVES,
  validateYouTubeAccountBindingProof,
  verifyYouTubeAccountBinding,
} = require("../../lib/services/youtube-account-binding-verifier");

const STORY_ID = "exact-prestage-story";
const CHANNEL_ID = "pulse-gaming";
const SCHEDULED_FOR = "2026-07-28T19:00:00.000Z";
const PRESTAGE_AT = new Date("2026-07-28T17:50:00.000Z");
const CONFIRM_AT = new Date("2026-07-28T19:00:05.000Z");
const REQUEST_FINGERPRINT = "a".repeat(64);
const RUNWAY_LOCK_SHA256 = "b".repeat(64);
const MEDIA_SHA256 = "c".repeat(64);
const SCRIPT_SHA256 = "d".repeat(64);
const METADATA_SHA256 = "e".repeat(64);
const SOURCE_EVIDENCE_SHA256 = "f".repeat(64);
const SOURCE_CLAIM = "Microsoft confirmed the exact official gaming update.";
const SOURCE_URL = "https://news.xbox.com/example";
const SOURCE_CLAIM_SHA256 = crypto
  .createHash("sha256")
  .update(SOURCE_CLAIM)
  .digest("hex");
const OFFICIAL_SOURCE_RELEASE_BINDING = buildOfficialSourceReleaseBinding({
  storyId: STORY_ID,
  sourceEvidenceSha256: SOURCE_EVIDENCE_SHA256,
  sourceEvidence: {
    schema_version: "pulse-source-evidence-v1",
    story_id: STORY_ID,
    source_url: SOURCE_URL,
    source_type: "official",
    claims: [
      {
        claim_key: "xbox.official.update",
        text: SOURCE_CLAIM,
        claim_text_sha256: SOURCE_CLAIM_SHA256,
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: SOURCE_URL,
      source_id: "xbox-wire",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: SOURCE_CLAIM_SHA256,
      claims: [
        {
          claim_key: "xbox.official.update",
          text: SOURCE_CLAIM,
          claim_text_sha256: SOURCE_CLAIM_SHA256,
        },
      ],
    },
  },
});
const SOURCE_REVISION_SHA256 =
  OFFICIAL_SOURCE_RELEASE_BINDING.source_revision_sha256;
const DISPATCH_KEY = `youtube:${STORY_ID}:${SCHEDULED_FOR}`;
const YOUTUBE_OAUTH_CLIENT_ID = "pulse-client.apps.googleusercontent.com";
const YOUTUBE_OAUTH_CLIENT_SHA256 = crypto
  .createHash("sha256")
  .update(YOUTUBE_OAUTH_CLIENT_ID, "utf8")
  .digest("hex");

function youtubeAccountBindingProof(checkedAt = "2026-07-28T18:45:00.000Z") {
  return verifyYouTubeAccountBinding({
    expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    configuredOAuthClientSha256: YOUTUBE_OAUTH_CLIENT_SHA256,
    tokenInfoProbeResult: {
      checked_at: checkedAt,
      data: {
        issued_to: YOUTUBE_OAUTH_CLIENT_ID,
        scope: [
          ...REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
          OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
          YOUTUBE_READ_SCOPE_ALTERNATIVES[0],
        ].join(" "),
      },
    },
    channelProbeResult: {
      checked_at: checkedAt,
      data: {
        items: [
          {
            id: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
            status: {
              privacyStatus: "public",
              isLinked: true,
              longUploadsStatus: "allowed",
            },
          },
        ],
      },
    },
    now: () => new Date(checkedAt),
  });
}

function youtubeAccountArmInput(checkedAt = "2026-07-28T18:45:00.000Z") {
  const proof = youtubeAccountBindingProof(checkedAt);
  return {
    expectedYoutubeChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    configuredOAuthClientSha256: YOUTUBE_OAUTH_CLIENT_SHA256,
    youtubeAccountBindingProof: proof,
    async createYoutubeAccountBoundSession({
      createAuthenticatedYoutubeClient,
      now,
    }) {
      const youtubeClient = await createAuthenticatedYoutubeClient();
      return testYoutubeAccountBoundSession({
        proof,
        youtubeClient,
        now,
      });
    },
  };
}

function testYoutubeAccountBoundSession({ proof, youtubeClient, now }) {
  const validate = () =>
    validateYouTubeAccountBindingProof(proof, {
      expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      configuredOAuthClientSha256: YOUTUBE_OAUTH_CLIENT_SHA256,
      now,
    }).value;
  return Object.freeze({
    getYoutubeClient() {
      validate();
      return youtubeClient;
    },
    getBindingProof: validate,
    async revalidate() {
      return validate();
    },
  });
}

function youtubeAccountPrestageInput(checkedAt = "2026-07-28T17:50:00.000Z") {
  const proof = youtubeAccountBindingProof(checkedAt);
  return {
    async createYoutubeAccountBoundSession({
      createAuthenticatedYoutubeClient,
      now,
    }) {
      const youtubeClient = await createAuthenticatedYoutubeClient();
      return testYoutubeAccountBoundSession({
        proof,
        youtubeClient,
        now,
      });
    },
  };
}

function publicationEvidence() {
  return {
    schema_version: "pulse-publication-evidence-v1",
    source_evidence_sha256: SOURCE_EVIDENCE_SHA256,
    official_source_release_binding: OFFICIAL_SOURCE_RELEASE_BINDING,
    publication_metadata_sha256: METADATA_SHA256,
    publication_metadata: {
      path: "C:\\approved\\publication-metadata.json",
      sha256: METADATA_SHA256,
      platform: "youtube_shorts",
      title: "Exact approved title",
      description: "Exact approved description",
    },
    synthetic_media_disclosure: {
      decision: "DISCLOSE",
      youtube_field_value: true,
    },
  };
}

function exactBinding(overrides = {}) {
  return {
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    platform: "youtube",
    scheduled_event_id: 42,
    scheduled_for: SCHEDULED_FOR,
    dispatch_idempotency_key: DISPATCH_KEY,
    request_fingerprint: REQUEST_FINGERPRINT,
    runway_lock_sha256: RUNWAY_LOCK_SHA256,
    media_sha256: MEDIA_SHA256,
    script_sha256: SCRIPT_SHA256,
    ...overrides,
  };
}

function scheduledEvent(overrides = {}) {
  const evidence = {
    schedule_verified: true,
    control_tower_verdict: "GREEN",
    control_tower_checked_at: PRESTAGE_AT.toISOString(),
    scheduled_for: SCHEDULED_FOR,
    kill_switch_healthy: true,
    operating_contract_valid: true,
    dispatch_idempotency_key: DISPATCH_KEY,
    request_fingerprint: REQUEST_FINGERPRINT,
    runway_lock_sha256: RUNWAY_LOCK_SHA256,
    publication_evidence: publicationEvidence(),
    ...(overrides.evidence || {}),
  };
  return {
    id: 42,
    story_id: STORY_ID,
    platform: "youtube",
    to_state: "SCHEDULED",
    evidence_json: JSON.stringify(evidence),
    ...overrides,
    evidence_json: JSON.stringify(evidence),
  };
}

function story(overrides = {}) {
  return {
    id: STORY_ID,
    channel_id: CHANNEL_ID,
    title: "Exact story",
    full_script: "The exact approved narration.",
    exported_path: "C:\\approved\\short.mp4",
    ...overrides,
  };
}

function fingerprint(overrides = {}) {
  return {
    request_fingerprint: REQUEST_FINGERPRINT,
    media_sha256: MEDIA_SHA256,
    script_sha256: SCRIPT_SHA256,
    canonical_json: "{}",
    request: {},
    ...overrides,
  };
}

function leaseRunner(calls) {
  return async (input) => {
    calls.lease += 1;
    calls.operation = input.operation;
    calls.leaseChannel = input.channelId;
    return input.task({
      assertHealthy() {
        calls.leaseAssertions += 1;
        return true;
      },
      lease: {
        lease_name: "publisher:global",
        owner_id: "publisher-adapter-test",
      },
    });
  };
}

function baseFixture({
  lifecycleState = "SCHEDULED",
  eventFactory = () => scheduledEvent(),
  storyFactory = () => story(),
} = {}) {
  const calls = {
    auth: 0,
    commitmentAssertions: 0,
    commitmentRecords: 0,
    createBoundary: 0,
    fingerprint: 0,
    lease: 0,
    leaseAssertions: 0,
    liveControl: [],
    lastCommitmentInput: null,
    metadata: 0,
    privateProofAssertions: 0,
    platformScheduledRecords: 0,
    scheduleArmAttempts: 0,
    scheduleDisarmConfirmations: 0,
    scheduleDisarmRequests: 0,
    scheduledVerifier: 0,
    storyIds: [],
    ticketReads: 0,
    uploadShort: 0,
    transactions: 0,
  };
  const database = {
    inTransaction: false,
    transaction(callback) {
      const execute = () => {
        calls.transactions += 1;
        database.inTransaction = true;
        try {
          return callback();
        } finally {
          database.inTransaction = false;
        }
      };
      execute.immediate = execute;
      return execute;
    },
  };
  let releaseCommitment =
    lifecycleState === "PLATFORM_SCHEDULED"
      ? {
          evidence: {
            release_commitment_confirmed: true,
            committed_at: "2026-07-28T17:51:00.000Z",
          },
        }
      : null;
  let currentLifecycleState = lifecycleState;
  let platformPost = {
    id: 19,
    story_id: STORY_ID,
    platform: "youtube",
    external_id:
      lifecycleState === "PLATFORM_OBJECT_CREATED"
        ? "private-youtube-object"
        : null,
    external_url: null,
    status: "uploading",
  };
  const governance = {
    getLatestLifecycleEvent(storyId, platform, state) {
      calls.ticketReads += 1;
      assert.equal(storyId, STORY_ID);
      assert.equal(platform, "youtube");
      assert.equal(state, "SCHEDULED");
      return eventFactory(calls.ticketReads);
    },
    getState() {
      return {
        lifecycle_state: currentLifecycleState,
        external_id:
          currentLifecycleState === "PLATFORM_OBJECT_CREATED" ||
          currentLifecycleState === "PLATFORM_SCHEDULE_DISARMED"
            ? "private-youtube-object"
            : null,
      };
    },
    preparePrivateScheduledUpload() {},
    recordPrivateScheduledPlatformObjectCreated() {},
    recordPrivateUnscheduledPlatformObjectVerified() {},
    recordPlatformCreatedConfirmationFailed() {},
    assertPlatformScheduledBinding() {
      return {
        scheduledFor: SCHEDULED_FOR,
      };
    },
    recordScheduledPlatformPublished() {},
    recordAmbiguousDispatchFailure() {},
    recordPreCreateFailure() {},
    resolveScheduledPlatformDisarmBinding(input) {
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.externalId, "private-youtube-object");
      assert.equal(input.scheduledFor, SCHEDULED_FOR);
      return {
        storyId: STORY_ID,
        externalId: input.externalId,
        scheduledFor: SCHEDULED_FOR,
      };
    },
    recordScheduledPlatformDisarmRequested(input) {
      calls.scheduleDisarmRequests += 1;
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.externalId, "private-youtube-object");
      assert.equal(input.disarmEvidence.schedule_disarm_requested, true);
      return { id: 92 };
    },
    recordScheduledPlatformDisarmed(input) {
      calls.scheduleDisarmConfirmations += 1;
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.externalId, "private-youtube-object");
      assert.equal(input.verificationEvidence.schedule_disarm_confirmed, true);
      currentLifecycleState = "PLATFORM_SCHEDULE_DISARMED";
      return {
        lifecycle_state: currentLifecycleState,
        external_id: input.externalId,
      };
    },
    assertPrivateUnscheduledPlatformObjectBinding(input) {
      calls.privateProofAssertions += 1;
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.channelId, CHANNEL_ID);
      assert.equal(input.externalId, "private-youtube-object");
      assert.equal(input.scheduledFor, SCHEDULED_FOR);
      return {
        storyId: STORY_ID,
        channelId: CHANNEL_ID,
        externalId: "private-youtube-object",
        scheduledFor: SCHEDULED_FOR,
        privateUnscheduledEventId: 91,
      };
    },
    getScheduledPlatformArmAttempt() {
      return null;
    },
    recordScheduledPlatformArmAttemptStarted(input) {
      calls.scheduleArmAttempts += 1;
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.externalId, "private-youtube-object");
      assert.equal(input.sourceRevalidation.official_source, true);
      return { id: 93 };
    },
    recordScheduledPlatformReleaseCommitment(input) {
      calls.commitmentRecords += 1;
      calls.lastCommitmentInput = structuredClone(input);
      if (calls.operation === "arm_governed_youtube_scheduled_release") {
        assert.equal(database.inTransaction, true);
      }
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.externalId.length > 0, true);
      assert.equal(input.scheduledFor, SCHEDULED_FOR);
      assert.equal(input.verificationEvidence.external_id, input.externalId);
      releaseCommitment = {
        id: 81,
        evidence: {
          release_commitment_confirmed: true,
          committed_at: input.verifiedAt,
        },
      };
      return { id: 81 };
    },
    recordPlatformScheduled(input) {
      calls.platformScheduledRecords += 1;
      assert.equal(database.inTransaction, true);
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.channelId, CHANNEL_ID);
      assert.equal(input.externalId, "private-youtube-object");
      return {
        lifecycle_state: "PLATFORM_SCHEDULED",
        external_id: input.externalId,
      };
    },
    assertScheduledPlatformReleaseCommitment(input) {
      calls.commitmentAssertions += 1;
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.scheduledFor, SCHEDULED_FOR);
      if (!releaseCommitment) {
        throw new Error("release_commitment_confirmed_required");
      }
      return releaseCommitment;
    },
  };
  const repos = {
    db: database,
    stories: {
      get(id) {
        calls.storyIds.push(id);
        return storyFactory(calls.storyIds.length);
      },
    },
    platformPosts: {
      ensurePending() {
        return { ...platformPost };
      },
      getByStoryPlatform(storyId, platform) {
        assert.equal(storyId, STORY_ID);
        assert.equal(platform, "youtube");
        return { ...platformPost };
      },
      anchorExternalObject() {
        return { ...platformPost };
      },
      markFailed() {
        return { ...platformPost, status: "failed" };
      },
      markPublished() {
        return { ...platformPost, status: "published" };
      },
      markBlocked(id, reason) {
        assert.equal(id, platformPost.id);
        platformPost = {
          ...platformPost,
          status: "blocked",
          last_error: reason,
        };
        return { ...platformPost };
      },
    },
    publicationGovernance: governance,
    runtimeLeases: {},
  };
  return { calls, governance, repos };
}

function assertHealthyLiveControl(calls) {
  return ({ phase }) => {
    calls.liveControl.push(phase);
    return {
      verdict: "GREEN",
      kill_switch_healthy: true,
      operating_contract_valid: true,
      scheduler_owner_healthy: true,
    };
  };
}

test("publisher exposes the governed T-15 schedule-arm boundary", () => {
  assert.equal(
    typeof require("../../publisher").armExactGovernedYoutubeScheduledRelease,
    "function",
  );
});

test("private-prestage adapter uploads the exact object once without granting scheduled-release authority", async () => {
  const fixture = baseFixture();
  const publisher = require("../../publisher");
  const youtubeClient = { videos: { list() {} } };
  let createStarted = 0;
  let scheduledVerificationInput = null;

  const result = await publisher.prestageExactGovernedYoutubeRelease({
    exactStagedBinding: exactBinding(),
    ...youtubeAccountPrestageInput(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async fingerprintPublicationRequest(currentStory, options) {
      fixture.calls.fingerprint += 1;
      assert.equal(currentStory.id, STORY_ID);
      assert.equal(options.channelId, CHANNEL_ID);
      assert.equal(options.platform, "youtube");
      assert.deepEqual(options.publicationEvidence, publicationEvidence());
      return fingerprint();
    },
    async validateApprovedMetadata(uploadStory) {
      fixture.calls.metadata += 1;
      assert.equal(uploadStory.id, STORY_ID);
      assert.equal(
        uploadStory.governed_publication_metadata_sha256,
        METADATA_SHA256,
      );
      return {
        sha256: METADATA_SHA256,
        title: "Exact approved title",
        description: "Exact approved description",
      };
    },
    async uploadShort(uploadStory, options) {
      fixture.calls.uploadShort += 1;
      assert.equal(uploadStory.id, STORY_ID);
      assert.equal(options.governedDispatch, true);
      assert.equal(options.privateOnly, true);
      assert.equal(
        options.youtubeAccountBoundSession.getYoutubeClient(),
        youtubeClient,
      );
      assert.equal(
        options.youtubeAccountBoundSession.getBindingProof()
          .expected_channel_id,
        EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      );
      assert.equal(
        Object.hasOwn(options, "scheduledFor"),
        false,
        "T-70 must not pass publish timing to the YouTube create boundary",
      );
      assert.equal(options.expectedMediaSha256, MEDIA_SHA256);
      fixture.calls.createBoundary += 1;
      await publisher.invokeTrustedYoutubeCreateBoundaryGate(
        options.assertYoutubeCreateBoundary,
      );
      options.markCreateAttemptStarted();
      return {
        videoId: "youtube-private-object-1",
        url: "https://youtube.com/watch?v=youtube-private-object-1",
      };
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return youtubeClient;
    },
    createYoutubeScheduledObjectVerifier(input) {
      assert.equal(input.youtubeClient, youtubeClient);
      return async (candidate) => {
        fixture.calls.scheduledVerifier += 1;
        scheduledVerificationInput = candidate;
        return {
          confirmed: true,
          externalId: candidate.externalId,
          externalUrl: `https://youtube.com/watch?v=${candidate.externalId}`,
          scheduledFor: candidate.scheduledFor,
          verifiedAt: "2026-07-28T17:51:00.000Z",
          evidence: {
            platform_object_confirmed: true,
            scheduled_release_confirmed: true,
            privacy_status: "private",
            publish_at: candidate.scheduledFor,
            upload_status: "processed",
            processing_status: "succeeded",
          },
        };
      };
    },
    async prestageGovernedYoutubeRelease(input) {
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.channelId, CHANNEL_ID);
      assert.equal(input.idempotencyKey, DISPATCH_KEY);
      assert.equal(input.scheduledFor, SCHEDULED_FOR);
      assert.equal(input.requestFingerprint, REQUEST_FINGERPRINT);
      assert.equal(input.runwayLockSha256, RUNWAY_LOCK_SHA256);
      assert.equal(
        Object.hasOwn(input, "verifyScheduled"),
        false,
        "T-70 must not receive a scheduled-object verifier",
      );
      const uploaded = await input.uploadScheduled({
        storyId: STORY_ID,
        channelId: CHANNEL_ID,
        platform: "youtube",
        idempotencyKey: DISPATCH_KEY,
        scheduledFor: SCHEDULED_FOR,
        platformPost: { id: 7 },
        markCreateAttemptStarted() {
          createStarted += 1;
        },
      });
      return {
        status: "platform_object_created",
        scheduled: false,
        releaseArmed: false,
        externalId: uploaded.externalId,
      };
    },
    channel: { id: CHANNEL_ID },
    resolveMediaPath: (value) => value,
    reportAuthTelemetry() {},
  });

  assert.equal(result.status, "platform_object_created");
  assert.equal(result.scheduled, false);
  assert.equal(result.releaseArmed, false);
  assert.equal(fixture.calls.lease, 1);
  assert.equal(fixture.calls.operation, "prestage_governed_youtube_release");
  assert.equal(fixture.calls.leaseChannel, CHANNEL_ID);
  assert.equal(fixture.calls.uploadShort, 1);
  assert.equal(createStarted, 1);
  assert.equal(fixture.calls.createBoundary, 1);
  assert.equal(fixture.calls.storyIds.length, 2);
  assert.deepEqual(fixture.calls.storyIds, [STORY_ID, STORY_ID]);
  assert.equal(fixture.calls.ticketReads, 2);
  assert.equal(fixture.calls.fingerprint, 2);
  assert.equal(fixture.calls.metadata, 2);
  assert.equal(
    fixture.calls.auth,
    1,
    "the same authenticated client is probed before the private create",
  );
  assert.equal(fixture.calls.scheduledVerifier, 0);
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.deepEqual(fixture.calls.liveControl, ["entry", "create_boundary"]);
  assert.equal(scheduledVerificationInput, null);
});

test("T-70 uses an advancing irreversible-boundary clock while retaining the queued timestamp as prestage evidence", async () => {
  const fixture = baseFixture();
  const observedControls = [];
  const liveTimes = ["2026-07-28T17:50:05.000Z", "2026-07-28T17:50:11.000Z"];
  let liveClockCall = 0;
  let evidenceTimestamp = null;

  await assert.rejects(
    prestageExactGovernedYoutubeRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountPrestageInput(),
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {} } };
      },
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      irreversibleBoundaryNow: () =>
        new Date(liveTimes[Math.min(liveClockCall++, liveTimes.length - 1)]),
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy({ phase, now }) {
        observedControls.push({
          phase,
          now: now.toISOString(),
        });
        if (phase === "create_boundary") {
          const error = new Error("stop_after_t70_live_boundary_assertion");
          error.code = "stop_after_t70_live_boundary_assertion";
          throw error;
        }
        return {
          verdict: "GREEN",
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
        };
      },
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async fingerprintPublicationRequest() {
        return fingerprint();
      },
      async validateApprovedMetadata() {
        return { sha256: METADATA_SHA256 };
      },
      issueTrustedYoutubeCreateBoundaryGate: (gate) => gate,
      async uploadShort(_story, options) {
        await options.assertYoutubeCreateBoundary();
        throw new Error("upload_must_not_cross_failed_live_boundary");
      },
      async prestageGovernedYoutubeRelease(input) {
        evidenceTimestamp = input.now.toISOString();
        return input.uploadScheduled({
          scheduledFor: SCHEDULED_FOR,
          markCreateAttemptStarted() {},
        });
      },
      channel: { id: CHANNEL_ID },
      resolveMediaPath: (value) => value,
      reportAuthTelemetry() {},
    }),
    /stop_after_t70_live_boundary_assertion/,
  );

  assert.deepEqual(observedControls, [
    {
      phase: "entry",
      now: "2026-07-28T17:50:05.000Z",
    },
    {
      phase: "create_boundary",
      now: "2026-07-28T17:50:11.000Z",
    },
  ]);
  assert.equal(evidenceTimestamp, "2026-07-28T17:50:00.000Z");
});

test("trusted create-boundary drift aborts before the uploader can cross its external-create boundary", async () => {
  const fixture = baseFixture();
  let externalCreates = 0;

  await assert.rejects(
    prestageExactGovernedYoutubeRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountPrestageInput(),
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {} } };
      },
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async fingerprintPublicationRequest() {
        fixture.calls.fingerprint += 1;
        return fixture.calls.fingerprint === 1
          ? fingerprint()
          : fingerprint({ request_fingerprint: "f".repeat(64) });
      },
      async validateApprovedMetadata() {
        return { sha256: METADATA_SHA256 };
      },
      issueTrustedYoutubeCreateBoundaryGate: (revalidate) => revalidate,
      async uploadShort(_story, options) {
        fixture.calls.uploadShort += 1;
        await options.assertYoutubeCreateBoundary();
        externalCreates += 1;
        options.markCreateAttemptStarted();
        return { videoId: "must-not-exist" };
      },
      async createAuthenticatedYoutubeClient() {
        return {};
      },
      createYoutubeScheduledObjectVerifier() {
        throw new Error("verifier_must_not_be_built_after_create_hold");
      },
      async prestageGovernedYoutubeRelease(input) {
        return input.uploadScheduled({
          scheduledFor: SCHEDULED_FOR,
          markCreateAttemptStarted() {},
        });
      },
      channel: { id: CHANNEL_ID },
      resolveMediaPath: (value) => value,
      reportAuthTelemetry() {},
    }),
    (error) =>
      error?.code === "youtube_exact_binding_request_fingerprint_mismatch",
  );

  assert.equal(fixture.calls.uploadShort, 1);
  assert.equal(externalCreates, 0);
});

test("prestage exposes conservative machine-safe reserve evidence and only proves zero contact before entering the uploader", async () => {
  const fixture = baseFixture();
  let uploaderCalls = 0;

  await assert.rejects(
    prestageExactGovernedYoutubeRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountPrestageInput(),
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {} } };
      },
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async fingerprintPublicationRequest() {
        return fingerprint();
      },
      async validateApprovedMetadata() {
        return { sha256: METADATA_SHA256 };
      },
      async uploadShort() {
        uploaderCalls += 1;
        throw new Error("must_not_enter_uploader");
      },
      async prestageGovernedYoutubeRelease(input) {
        return input.uploadScheduled({
          scheduledFor: SCHEDULED_FOR,
          markCreateAttemptStarted() {},
        });
      },
      channel: { id: CHANNEL_ID },
      resolveMediaPath: (value) => value,
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_trusted_create_boundary_factory_required",
      );
      assert.equal(error.platformContacted, false);
      assert.equal(error.createAttemptStarted, false);
      assert.equal(error.externalId, null);
      return true;
    },
  );
  assert.equal(uploaderCalls, 0);

  await assert.rejects(
    prestageExactGovernedYoutubeRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountPrestageInput(),
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {} } };
      },
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async fingerprintPublicationRequest() {
        return fingerprint();
      },
      async validateApprovedMetadata() {
        return { sha256: METADATA_SHA256 };
      },
      issueTrustedYoutubeCreateBoundaryGate: (gate) => gate,
      async uploadShort() {
        uploaderCalls += 1;
        throw new Error("uploader_transport_failed");
      },
      async prestageGovernedYoutubeRelease(input) {
        return input.uploadScheduled({
          scheduledFor: SCHEDULED_FOR,
          markCreateAttemptStarted() {},
        });
      },
      channel: { id: CHANNEL_ID },
      resolveMediaPath: (value) => value,
    }),
    (error) => {
      assert.equal(error.message, "uploader_transport_failed");
      assert.equal(error.platformContacted, true);
      assert.equal(error.createAttemptStarted, false);
      assert.equal(error.externalId, null);
      return true;
    },
  );
  assert.equal(uploaderCalls, 1);
});

test("an anchored-object replay skips local assets, uploader and OAuth because T-60 owns verification", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  const youtubeClient = { videos: { list() {} } };

  const result = await prestageExactGovernedYoutubeRelease({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async fingerprintPublicationRequest() {
      throw new Error("anchored_reverification_must_not_need_local_media");
    },
    async validateApprovedMetadata() {
      throw new Error("anchored_reverification_must_not_need_local_metadata");
    },
    async uploadShort() {
      throw new Error("anchored_object_must_never_upload_again");
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return youtubeClient;
    },
    async prestageGovernedYoutubeRelease() {
      return {
        status: "platform_object_created",
        scheduled: false,
        releaseArmed: false,
        reused: true,
        externalId: "anchored-youtube-object",
      };
    },
  });

  assert.equal(result.status, "platform_object_created");
  assert.equal(result.reused, true);
  assert.equal(result.releaseArmed, false);
  assert.equal(fixture.calls.storyIds.length, 1);
  assert.equal(fixture.calls.fingerprint, 0);
  assert.equal(fixture.calls.metadata, 0);
  assert.equal(fixture.calls.uploadShort, 0);
  assert.equal(fixture.calls.auth, 0);
  assert.equal(fixture.calls.scheduledVerifier, 0);
});

test("a PLATFORM_SCHEDULED replay performs no upload and no needless OAuth call", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });

  const result = await prestageExactGovernedYoutubeRelease({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async fingerprintPublicationRequest() {
      throw new Error("scheduled_replay_must_not_need_local_media");
    },
    async uploadShort() {
      throw new Error("scheduled_replay_must_not_upload");
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      throw new Error("scheduled_replay_must_not_authenticate");
    },
    createYoutubeScheduledObjectVerifier() {
      throw new Error("scheduled_replay_must_not_build_verifier");
    },
    async prestageGovernedYoutubeRelease() {
      return {
        status: "platform_scheduled",
        scheduled: true,
        reused: true,
        externalId: "already-scheduled-object",
      };
    },
  });

  assert.equal(result.status, "platform_scheduled");
  assert.equal(result.reused, true);
  assert.equal(fixture.calls.uploadShort, 0);
  assert.equal(fixture.calls.auth, 0);
  assert.equal(fixture.calls.commitmentAssertions, 0);
});

test("T0 exact-public-confirmation adapter retains the publisher lease, builds an authenticated public verifier and has no upload surface", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });
  const youtubeClient = { videos: { list() {} } };
  let publicCandidate = null;

  const result = await confirmExactGovernedYoutubeScheduledRelease({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => CONFIRM_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return youtubeClient;
    },
    createYoutubePublicObjectVerifier(input) {
      assert.equal(input.youtubeClient, youtubeClient);
      return async (candidate) => {
        publicCandidate = candidate;
        return {
          confirmed: true,
          externalId: candidate.externalId,
          verifiedAt: CONFIRM_AT.toISOString(),
          evidence: {
            public: true,
            privacy_status: "public",
            upload_status: "processed",
          },
        };
      };
    },
    async confirmGovernedYoutubeScheduledRelease(input) {
      assert.equal(input.storyId, STORY_ID);
      assert.equal(input.channelId, CHANNEL_ID);
      assert.equal(input.scheduledFor, SCHEDULED_FOR);
      const verification = await input.verifyPublic({
        platform: "youtube",
        storyId: STORY_ID,
        externalId: "scheduled-youtube-object",
        scheduledFor: SCHEDULED_FOR,
      });
      return {
        status: "published",
        published: true,
        externalId: verification.externalId,
      };
    },
    uploadShort() {
      throw new Error("T0_confirmation_must_have_no_uploader");
    },
    reportAuthTelemetry() {},
  });

  assert.equal(result.status, "published");
  assert.equal(
    fixture.calls.operation,
    "confirm_governed_youtube_scheduled_release",
  );
  assert.equal(fixture.calls.auth, 1);
  assert.deepEqual(fixture.calls.liveControl, []);
  assert.deepEqual(publicCandidate, {
    platform: "youtube",
    storyId: STORY_ID,
    externalId: "scheduled-youtube-object",
    scheduledFor: SCHEDULED_FOR,
  });
});

test("T0 exact-public-confirmation consumes a hash-bound convergence observation without a second remote GET", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });
  let suppliedVerifierCalls = 0;

  const result = await confirmExactGovernedYoutubeScheduledRelease({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => CONFIRM_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async verifyPublic(candidate) {
      suppliedVerifierCalls += 1;
      return {
        confirmed: true,
        externalId: candidate.externalId,
        externalUrl: "https://www.youtube.com/watch?v=scheduled-youtube-object",
        verifiedAt: CONFIRM_AT.toISOString(),
        evidence: {
          public: true,
          privacy_status: "public",
          upload_status: "processed",
        },
      };
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      throw new Error("convergence_replay_must_not_authenticate_or_read_again");
    },
    createYoutubePublicObjectVerifier() {
      throw new Error("convergence_replay_must_not_build_remote_verifier");
    },
    async confirmGovernedYoutubeScheduledRelease(input) {
      const verification = await input.verifyPublic({
        platform: "youtube",
        storyId: STORY_ID,
        externalId: "scheduled-youtube-object",
        scheduledFor: SCHEDULED_FOR,
      });
      return {
        status: "published",
        published: true,
        externalId: verification.externalId,
        externalUrl: verification.externalUrl,
      };
    },
  });

  assert.equal(result.status, "published");
  assert.equal(result.published, true);
  assert.equal(suppliedVerifierCalls, 1);
  assert.equal(fixture.calls.auth, 0);
});

test("T0 not-due replay does not authenticate because the public verifier is lazy", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });

  const result = await confirmExactGovernedYoutubeScheduledRelease({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      throw new Error("not_due_must_not_authenticate");
    },
    createYoutubePublicObjectVerifier() {
      throw new Error("not_due_must_not_build_verifier");
    },
    async confirmGovernedYoutubeScheduledRelease() {
      return {
        status: "not_due",
        published: false,
        scheduledFor: SCHEDULED_FOR,
      };
    },
  });

  assert.equal(result.status, "not_due");
  assert.equal(fixture.calls.auth, 0);
});

test("T-60 verifier uses owner-authenticated private-unscheduled proof and exposes no uploader or release commitment", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  const youtubeClient = { videos: { list() {} } };
  let verifierCandidate = null;

  const result = await verifyExactGovernedYoutubePrivatePrestage({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => new Date("2026-07-28T18:00:00.000Z"),
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return youtubeClient;
    },
    createYoutubePrivateObjectVerifier(input) {
      assert.equal(input.youtubeClient, youtubeClient);
      return async (candidate) => {
        verifierCandidate = candidate;
        return {
          confirmed: true,
          externalId: candidate.externalId,
          externalUrl: `https://youtube.com/watch?v=${candidate.externalId}`,
          verifiedAt: "2026-07-28T18:00:01.000Z",
          evidence: {
            platform_object_confirmed: true,
            scheduled_release_confirmed: false,
            privacy_status: "private",
            publish_at: null,
            upload_status: "processed",
            processing_status: "succeeded",
          },
        };
      };
    },
    async verifyGovernedYoutubePrivatePrestage(input) {
      assert.equal(input.uploadScheduled, undefined);
      assert.equal(input.uploadShort, undefined);
      const verification = await input.verifyPrivate({
        platform: "youtube",
        storyId: STORY_ID,
        externalId: "private-youtube-object",
      });
      return {
        status: "private_object_verified",
        scheduled: false,
        releaseArmed: false,
        externalId: verification.externalId,
        verification,
      };
    },
    uploadShort() {
      throw new Error("private_verifier_must_never_upload");
    },
  });

  assert.equal(
    fixture.calls.operation,
    "verify_governed_youtube_private_prestage",
  );
  assert.deepEqual(fixture.calls.liveControl, ["entry"]);
  assert.equal(fixture.calls.auth, 1);
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.equal(result.releaseArmed, false);
  assert.equal(result.releaseCommitmentConfirmed, undefined);
  assert.deepEqual(verifierCandidate, {
    platform: "youtube",
    storyId: STORY_ID,
    externalId: "private-youtube-object",
  });
});

test("T-60 adapter exposes the raw emergency disarmer as the exact anchored-object containment callback", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  const candidates = [];

  const result = await verifyExactGovernedYoutubePrivatePrestage({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    assertRemoteDisarmAuthority({ reason }) {
      return {
        verdict: "DISARM_AUTHORISED",
        reason,
        checked_at: "2026-07-28T18:00:00.000Z",
      };
    },
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return {
        videos: { list() {}, update() {} },
      };
    },
    createYoutubePrivateObjectVerifier() {
      return async () => {
        throw new Error("injected_service_owns_verification");
      };
    },
    createYoutubeScheduledObjectDisarmer() {
      return async (candidate) => {
        candidates.push(candidate);
        await candidate.assertUpdateBoundary();
        candidate.markUpdateAttemptStarted();
        return {
          confirmed: true,
          emergencyContainment: true,
          compensationRequired: true,
          compensationAttempted: true,
          compensationConfirmed: true,
          externalId: candidate.externalId,
          verifiedAt: "2026-07-28T18:00:01.000Z",
          evidence: {
            schema_version: "pulse-youtube-schedule-disarm-proof-v1",
            platform: "youtube",
            platform_object_confirmed: true,
            schedule_disarm_confirmed: true,
            external_id: candidate.externalId,
            privacy_status: "private",
            publish_at: null,
            publish_at_present: false,
            publish_at_invalid: false,
            emergency_containment: true,
            containment_reason: candidate.containmentReason,
            checked_at: "2026-07-28T18:00:01.000Z",
          },
        };
      };
    },
    async verifyGovernedYoutubePrivatePrestage(input) {
      return input.containUnexpectedObject({
        platform: "youtube",
        storyId: STORY_ID,
        externalId: "private-youtube-object",
        scheduledFor: SCHEDULED_FOR,
        emergencyContainment: true,
        containmentReason: "youtube_private_object_published_early",
        assertUpdateBoundary() {},
        markUpdateAttemptStarted() {},
      });
    },
  });

  assert.equal(result.confirmed, true);
  assert.equal(result.emergencyContainment, true);
  assert.equal(result.compensationConfirmed, true);
  assert.equal(fixture.calls.auth, 1);
  assert.equal(candidates.length, 1);
  assert.equal(
    candidates[0].containmentReason,
    "youtube_private_object_published_early",
  );
  assert.equal(candidates[0].emergencyContainment, true);
});

test("T-15 rejects a caller boolean in place of the canonical account-binding proof before OAuth, arm or commitment", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      expectedYoutubeChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      configuredOAuthClientSha256: YOUTUBE_OAUTH_CLIENT_SHA256,
      youtubeAccountBindingVerified: true,
      repos: fixture.repos,
      now: () => new Date("2026-07-28T18:45:00.000Z"),
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        throw new Error("missing_proof_must_not_authenticate");
      },
      async revalidateOfficialSource() {
        throw new Error("missing_proof_must_not_fetch");
      },
      async armGovernedYoutubeScheduledRelease() {
        throw new Error("missing_proof_must_not_arm");
      },
    }),
    {
      code: "youtube_account_binding_proof_required",
    },
  );

  assert.equal(fixture.calls.auth, 0);
  assert.equal(fixture.calls.scheduleArmAttempts, 0);
  assert.equal(fixture.calls.platformScheduledRecords, 0);
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.equal(fixture.calls.transactions, 0);
});

test("T-15 rejects tampered, stale or trusted-client-mismatched account proofs before acquiring the publisher lease", async () => {
  const tamperedProof = structuredClone(youtubeAccountBindingProof());
  tamperedProof.channel.linked = false;
  const cases = [
    {
      account: {
        ...youtubeAccountArmInput(),
        youtubeAccountBindingProof: tamperedProof,
      },
      now: "2026-07-28T18:45:00.000Z",
      code: "youtube_account_binding_proof_sha256_mismatch",
    },
    {
      account: youtubeAccountArmInput(),
      now: "2026-07-28T18:46:00.001Z",
      code: "youtube_account_binding_proof_observation_stale",
    },
    {
      account: {
        ...youtubeAccountArmInput(),
        configuredOAuthClientSha256: "f".repeat(64),
      },
      now: "2026-07-28T18:45:00.000Z",
      code: "youtube_account_binding_proof_client_mismatch",
    },
  ];

  for (const scenario of cases) {
    const fixture = baseFixture({
      lifecycleState: "PLATFORM_OBJECT_CREATED",
    });
    await assert.rejects(
      armExactGovernedYoutubeScheduledRelease({
        exactStagedBinding: exactBinding(),
        ...scenario.account,
        repos: fixture.repos,
        irreversibleBoundaryNow: () => new Date(scenario.now),
        runWithPublisherLease: leaseRunner(fixture.calls),
        async createAuthenticatedYoutubeClient() {
          fixture.calls.auth += 1;
          throw new Error("invalid_account_proof_must_not_authenticate");
        },
        async armGovernedYoutubeScheduledRelease() {
          throw new Error("invalid_account_proof_must_not_arm");
        },
      }),
      { code: scenario.code },
    );
    assert.equal(fixture.calls.lease, 0);
    assert.equal(fixture.calls.auth, 0);
    assert.equal(fixture.calls.scheduleArmAttempts, 0);
    assert.equal(fixture.calls.platformScheduledRecords, 0);
    assert.equal(fixture.calls.commitmentRecords, 0);
    assert.equal(fixture.calls.transactions, 0);
  }
});

test("T-15 adapter revalidates source at the update boundary, arms once and records the release commitment", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  const youtubeClient = {
    videos: { list() {}, update() {} },
  };
  let armCandidate = null;
  let scheduledCandidate = null;
  let sourceRevalidations = 0;

  const result = await armExactGovernedYoutubeScheduledRelease({
    exactStagedBinding: exactBinding(),
    ...youtubeAccountArmInput(),
    expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
    repos: fixture.repos,
    now: () => new Date("2026-07-28T18:45:00.000Z"),
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return youtubeClient;
    },
    createYoutubeScheduledObjectArmer(input) {
      assert.equal(input.youtubeClient, youtubeClient);
      return async (candidate) => {
        armCandidate = candidate;
        await candidate.assertUpdateBoundary();
        candidate.markUpdateAttemptStarted();
        return {
          confirmed: true,
          externalId: candidate.externalId,
          scheduledFor: candidate.scheduledFor,
          verifiedAt: "2026-07-28T18:45:02.000Z",
          updateAttemptStarted: true,
          evidence: {
            schedule_arm_confirmed: true,
            release_armed: true,
            external_id: candidate.externalId,
            publish_at: candidate.scheduledFor,
          },
        };
      };
    },
    createYoutubeScheduledObjectVerifier(input) {
      assert.equal(input.youtubeClient, youtubeClient);
      return async (candidate) => {
        scheduledCandidate = candidate;
        return {
          confirmed: true,
          externalId: candidate.externalId,
          scheduledFor: candidate.scheduledFor,
          verifiedAt: "2026-07-28T18:45:05.000Z",
          evidence: {
            platform_object_confirmed: true,
            scheduled_release_confirmed: true,
            privacy_status: "private",
            publish_at: candidate.scheduledFor,
            upload_status: "processed",
            processing_status: "succeeded",
          },
        };
      };
    },
    async revalidateOfficialSource() {
      sourceRevalidations += 1;
      return {
        schema_version: "pulse-official-source-revalidation-v1",
        official_source: true,
        unchanged: true,
        claims_match: true,
        source_url: "https://news.xbox.com/example",
        source_revision_sha256: SOURCE_REVISION_SHA256,
        revalidated_at: "2026-07-28T18:45:00.000Z",
      };
    },
    validateOfficialSourceRevalidationReceipt(receipt, expected) {
      assert.equal(
        expected.binding.binding_sha256,
        OFFICIAL_SOURCE_RELEASE_BINDING.binding_sha256,
      );
      assert.equal(expected.storyId, STORY_ID);
      assert.equal(expected.requestFingerprint, REQUEST_FINGERPRINT);
      return { valid: true, value: receipt };
    },
    async armGovernedYoutubeScheduledRelease(input) {
      assert.equal(input.expectedSourceRevisionSha256, SOURCE_REVISION_SHA256);
      const armResult = await input.armScheduled({
        platform: "youtube",
        storyId: STORY_ID,
        externalId: "private-youtube-object",
        scheduledFor: SCHEDULED_FOR,
        assertUpdateBoundary: async () => {
          await input.revalidateOfficialSource();
        },
        markUpdateAttemptStarted() {},
      });
      const verification = await input.verifyScheduled({
        platform: "youtube",
        storyId: STORY_ID,
        externalId: armResult.externalId,
        scheduledFor: SCHEDULED_FOR,
      });
      const persisted = input.persistScheduledRelease({
        recordPlatformScheduledInput: {
          storyId: STORY_ID,
          channelId: CHANNEL_ID,
          platform: "youtube",
          idempotencyKey: DISPATCH_KEY,
          externalId: armResult.externalId,
          scheduledFor: SCHEDULED_FOR,
          requestFingerprint: REQUEST_FINGERPRINT,
          runwayLockSha256: RUNWAY_LOCK_SHA256,
          verifiedAt: verification.verifiedAt,
          verificationEvidence: {
            ...verification.evidence,
            external_id: armResult.externalId,
          },
          now: new Date("2026-07-28T18:45:05.000Z"),
        },
        externalId: armResult.externalId,
        verification,
        sourceRevalidation: {
          source_revision_sha256: SOURCE_REVISION_SHA256,
        },
        armResult,
      });
      return {
        status: "platform_scheduled",
        scheduled: true,
        releaseArmed: true,
        externalId: armResult.externalId,
        sourceRevalidation: {
          source_revision_sha256: SOURCE_REVISION_SHA256,
        },
        armResult,
        verification,
        governanceState: persisted.governanceState,
        releaseCommitment: persisted.releaseCommitment,
      };
    },
  });

  assert.equal(result.status, "platform_scheduled");
  assert.equal(result.releaseArmed, true);
  assert.equal(result.releaseCommitmentConfirmed, true);
  assert.equal(fixture.calls.auth, 1);
  assert.equal(fixture.calls.commitmentRecords, 1);
  assert.equal(fixture.calls.platformScheduledRecords, 1);
  assert.equal(fixture.calls.transactions, 1);
  assert.equal(fixture.calls.privateProofAssertions, 2);
  assert.equal(
    fixture.calls.lastCommitmentInput.verificationEvidence.source_revalidation
      .source_revision_sha256,
    SOURCE_REVISION_SHA256,
  );
  assert.equal(
    fixture.calls.lastCommitmentInput.verificationEvidence.schedule_arm_proof
      .release_armed,
    true,
  );
  assert.equal(
    fixture.calls.lastCommitmentInput.verificationEvidence
      .youtube_account_binding_proof.proof_sha256,
    youtubeAccountBindingProof().proof_sha256,
  );
  assert.equal(
    fixture.calls.lastCommitmentInput.verificationEvidence
      .youtube_account_binding_proof.publication_authority_granted,
    false,
  );
  assert.equal(
    fixture.calls.lastCommitmentInput.controlEvidence
      .youtube_account_binding_proof.configured_oauth_client_sha256,
    YOUTUBE_OAUTH_CLIENT_SHA256,
  );
  assert.equal(sourceRevalidations, 1);
  assert.deepEqual(fixture.calls.liveControl, [
    "entry",
    "schedule_arm_boundary",
    "schedule_arm_post_source_boundary",
  ]);
  assert.equal(armCandidate.externalId, "private-youtube-object");
  assert.equal(armCandidate.scheduledFor, SCHEDULED_FOR);
  assert.deepEqual(scheduledCandidate, {
    platform: "youtube",
    storyId: STORY_ID,
    externalId: "private-youtube-object",
    scheduledFor: SCHEDULED_FOR,
  });
});

test("T-15 rejects a newly armed result unless PLATFORM_SCHEDULED and the release commitment were persisted atomically", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
      repos: fixture.repos,
      now: () => new Date("2026-07-28T18:45:00.000Z"),
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        return {
          videos: { list() {}, update() {} },
        };
      },
      createYoutubeScheduledObjectArmer() {
        return async () => {
          throw new Error("injected_service_must_own_arm");
        };
      },
      createYoutubeScheduledObjectVerifier() {
        return async () => {
          throw new Error("injected_service_must_own_verify");
        };
      },
      async revalidateOfficialSource() {
        return {
          schema_version: "pulse-official-source-revalidation-v1",
          official_source: true,
          unchanged: true,
          claims_match: true,
          source_url: "https://news.xbox.com/example",
          source_revision_sha256: SOURCE_REVISION_SHA256,
          revalidated_at: "2026-07-28T18:45:00.000Z",
        };
      },
      async armGovernedYoutubeScheduledRelease() {
        return {
          status: "platform_scheduled",
          scheduled: true,
          releaseArmed: true,
          reused: false,
          externalId: "private-youtube-object",
          verification: {
            confirmed: true,
            evidence: {
              privacy_status: "private",
              publish_at: SCHEDULED_FOR,
              upload_status: "processed",
              processing_status: "succeeded",
            },
          },
        };
      },
    }),
    /youtube_schedule_arm_atomic_persistence_required/,
  );
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.equal(fixture.calls.platformScheduledRecords, 0);
});

test("T-15 rechecks live control after the awaited official-source fetch and before the remote update marker", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  const phases = [];
  let updateMarkerCalls = 0;

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
      repos: fixture.repos,
      now: () => new Date("2026-07-28T18:45:00.000Z"),
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy({ phase }) {
        phases.push(phase);
        if (phase === "schedule_arm_post_source_boundary") {
          const error = new Error(
            "youtube_live_control_changed_during_source_fetch",
          );
          error.code = "youtube_live_control_changed_during_source_fetch";
          throw error;
        }
        return {
          verdict: "GREEN",
          kill_switch_healthy: true,
          operating_contract_valid: true,
          scheduler_owner_healthy: true,
          live_publish_enabled: true,
        };
      },
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        return {
          videos: { list() {}, update() {} },
        };
      },
      createYoutubeScheduledObjectArmer() {
        return async (candidate) => {
          await candidate.assertUpdateBoundary();
          candidate.markUpdateAttemptStarted();
          updateMarkerCalls += 1;
          throw new Error("remote_update_must_not_be_reached");
        };
      },
      createYoutubeScheduledObjectVerifier() {
        return async () => {
          throw new Error("scheduled_verifier_must_not_run");
        };
      },
      async revalidateOfficialSource() {
        return {
          schema_version: "pulse-official-source-revalidation-v1",
          official_source: true,
          unchanged: true,
          claims_match: true,
          source_url: SOURCE_URL,
          source_revision_sha256: SOURCE_REVISION_SHA256,
          revalidated_at: "2026-07-28T18:45:02.000Z",
        };
      },
      validateOfficialSourceRevalidationReceipt(receipt) {
        return { valid: true, value: receipt };
      },
      async armGovernedYoutubeScheduledRelease(input) {
        return input.armScheduled({
          platform: "youtube",
          storyId: STORY_ID,
          externalId: "private-youtube-object",
          scheduledFor: SCHEDULED_FOR,
          async assertUpdateBoundary() {
            await input.revalidateOfficialSource();
          },
          markUpdateAttemptStarted() {},
        });
      },
    }),
    /youtube_live_control_changed_during_source_fetch/,
  );

  assert.deepEqual(phases, [
    "entry",
    "schedule_arm_boundary",
    "schedule_arm_post_source_boundary",
  ]);
  assert.equal(updateMarkerCalls, 0);
  assert.equal(fixture.calls.commitmentRecords, 0);
});

test("T-15 rechecks account-binding observation freshness after the awaited source fetch and before the remote update marker", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  let boundaryNow = new Date("2026-07-28T18:45:00.000Z");
  let updateMarkerCalls = 0;

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
      repos: fixture.repos,
      irreversibleBoundaryNow: () => boundaryNow,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        return {
          videos: { list() {}, update() {} },
        };
      },
      createYoutubeScheduledObjectArmer() {
        return async (candidate) => {
          await candidate.assertUpdateBoundary();
          updateMarkerCalls += 1;
          throw new Error("stale_account_binding_must_not_reach_update");
        };
      },
      createYoutubeScheduledObjectVerifier() {
        return async () => {
          throw new Error("stale_account_binding_must_not_verify");
        };
      },
      async revalidateOfficialSource() {
        boundaryNow = new Date("2026-07-28T18:46:01.000Z");
        return {
          schema_version: "pulse-official-source-revalidation-v1",
          official_source: true,
          unchanged: true,
          claims_match: true,
          source_url: SOURCE_URL,
          source_revision_sha256: SOURCE_REVISION_SHA256,
          revalidated_at: boundaryNow.toISOString(),
        };
      },
      validateOfficialSourceRevalidationReceipt(receipt) {
        return { valid: true, value: receipt };
      },
      async armGovernedYoutubeScheduledRelease(input) {
        return input.armScheduled({
          platform: "youtube",
          storyId: STORY_ID,
          externalId: "private-youtube-object",
          scheduledFor: SCHEDULED_FOR,
          async assertUpdateBoundary() {
            await input.revalidateOfficialSource();
          },
          markUpdateAttemptStarted() {},
        });
      },
    }),
    {
      code: "youtube_account_binding_proof_observation_stale",
    },
  );

  assert.equal(fixture.calls.auth, 1);
  assert.equal(updateMarkerCalls, 0);
  assert.equal(fixture.calls.scheduleArmAttempts, 0);
  assert.equal(fixture.calls.platformScheduledRecords, 0);
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.equal(fixture.calls.transactions, 0);
});

test("T-15 rechecks account-binding freshness after scheduled-object verification and before atomic release commitment", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  let boundaryNow = new Date("2026-07-28T18:45:00.000Z");

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
      repos: fixture.repos,
      irreversibleBoundaryNow: () => boundaryNow,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        return {
          videos: { list() {}, update() {} },
        };
      },
      createYoutubeScheduledObjectArmer() {
        return async (candidate) => {
          await candidate.assertUpdateBoundary();
          return {
            confirmed: true,
            externalId: candidate.externalId,
            scheduledFor: candidate.scheduledFor,
            verifiedAt: "2026-07-28T18:45:02.000Z",
            updateAttemptStarted: true,
            evidence: {
              schedule_arm_confirmed: true,
              release_armed: true,
              external_id: candidate.externalId,
              publish_at: candidate.scheduledFor,
            },
          };
        };
      },
      createYoutubeScheduledObjectVerifier() {
        return async (candidate) => {
          boundaryNow = new Date("2026-07-28T18:46:01.000Z");
          return {
            confirmed: true,
            externalId: candidate.externalId,
            scheduledFor: candidate.scheduledFor,
            verifiedAt: boundaryNow.toISOString(),
            evidence: {
              platform_object_confirmed: true,
              scheduled_release_confirmed: true,
              privacy_status: "private",
              publish_at: candidate.scheduledFor,
              upload_status: "processed",
              processing_status: "succeeded",
            },
          };
        };
      },
      async revalidateOfficialSource() {
        return {
          schema_version: "pulse-official-source-revalidation-v1",
          official_source: true,
          unchanged: true,
          claims_match: true,
          source_url: SOURCE_URL,
          source_revision_sha256: SOURCE_REVISION_SHA256,
          revalidated_at: "2026-07-28T18:45:00.000Z",
        };
      },
      validateOfficialSourceRevalidationReceipt(receipt) {
        return { valid: true, value: receipt };
      },
      async armGovernedYoutubeScheduledRelease(input) {
        const armResult = await input.armScheduled({
          platform: "youtube",
          storyId: STORY_ID,
          externalId: "private-youtube-object",
          scheduledFor: SCHEDULED_FOR,
          async assertUpdateBoundary() {
            await input.revalidateOfficialSource();
          },
          markUpdateAttemptStarted() {},
        });
        const verification = await input.verifyScheduled({
          platform: "youtube",
          storyId: STORY_ID,
          externalId: armResult.externalId,
          scheduledFor: SCHEDULED_FOR,
        });
        return input.persistScheduledRelease({
          recordPlatformScheduledInput: {
            storyId: STORY_ID,
            channelId: CHANNEL_ID,
            platform: "youtube",
            idempotencyKey: DISPATCH_KEY,
            externalId: armResult.externalId,
            scheduledFor: SCHEDULED_FOR,
            requestFingerprint: REQUEST_FINGERPRINT,
            runwayLockSha256: RUNWAY_LOCK_SHA256,
            verifiedAt: verification.verifiedAt,
            verificationEvidence: verification.evidence,
            now: boundaryNow,
          },
          externalId: armResult.externalId,
          verification,
          sourceRevalidation: {
            source_revision_sha256: SOURCE_REVISION_SHA256,
          },
          armResult,
        });
      },
    }),
    {
      code: "youtube_account_binding_proof_observation_stale",
    },
  );

  assert.equal(fixture.calls.platformScheduledRecords, 0);
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.equal(fixture.calls.transactions, 0);
});

test("T-15 replay rechecks account-binding freshness before accepting an existing release commitment", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });
  fixture.repos.publicationGovernance.getState = () => ({
    lifecycle_state: "PLATFORM_SCHEDULED",
    external_id: "private-youtube-object",
  });
  let boundaryNow = new Date("2026-07-28T18:45:00.000Z");

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
      repos: fixture.repos,
      irreversibleBoundaryNow: () => boundaryNow,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        return { videos: { list() {}, update() {} } };
      },
      async armGovernedYoutubeScheduledRelease() {
        boundaryNow = new Date("2026-07-28T18:46:01.000Z");
        return {
          status: "platform_scheduled",
          scheduled: true,
          releaseArmed: true,
          reused: true,
          externalId: "private-youtube-object",
        };
      },
    }),
    {
      code: "youtube_account_binding_proof_observation_stale",
    },
  );

  assert.equal(
    fixture.calls.auth,
    1,
    "a replay still proves the current account through a fresh in-memory session",
  );
  assert.equal(fixture.calls.commitmentAssertions, 0);
  assert.equal(fixture.calls.commitmentRecords, 0);
  assert.equal(fixture.calls.transactions, 0);
});

test("T-15 default composition keeps an advancing live clock through source fetch, marker, verification and commitment", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  let tick = 0;
  const liveClock = () =>
    new Date(Date.parse("2026-07-28T18:45:00.000Z") + tick++ * 1000);
  let receiptTime = null;

  const result = await armExactGovernedYoutubeScheduledRelease({
    exactStagedBinding: exactBinding(),
    ...youtubeAccountArmInput(),
    expectedSourceRevisionSha256: SOURCE_REVISION_SHA256,
    repos: fixture.repos,
    now: () => new Date("2026-07-28T18:45:00.000Z"),
    irreversibleBoundaryNow: liveClock,
    runWithPublisherLease: leaseRunner(fixture.calls),
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence(evidence) {
      return evidence.publication_evidence;
    },
    async createAuthenticatedYoutubeClient() {
      fixture.calls.auth += 1;
      return {
        videos: { list() {}, update() {} },
      };
    },
    createYoutubeScheduledObjectArmer() {
      return async (candidate) => {
        await candidate.assertUpdateBoundary();
        await candidate.markUpdateAttemptStarted();
        const verifiedAt = liveClock().toISOString();
        return {
          confirmed: true,
          externalId: candidate.externalId,
          scheduledFor: candidate.scheduledFor,
          verifiedAt,
          updateAttemptStarted: true,
          evidence: {
            schema_version: "pulse-youtube-schedule-arm-proof-v1",
            platform: "youtube",
            platform_object_confirmed: true,
            schedule_arm_confirmed: true,
            scheduled_release_confirmed: true,
            release_armed: true,
            external_id: candidate.externalId,
            privacy_status: "private",
            publish_at: candidate.scheduledFor,
            checked_at: verifiedAt,
            update_attempt_started: true,
            before: {
              privacy_status: "private",
              publish_at: null,
              release_armed: false,
            },
          },
        };
      };
    },
    createYoutubeScheduledObjectVerifier() {
      return async (candidate) => {
        const verifiedAt = liveClock().toISOString();
        return {
          confirmed: true,
          externalId: candidate.externalId,
          scheduledFor: candidate.scheduledFor,
          verifiedAt,
          evidence: {
            platform_object_confirmed: true,
            scheduled_release_confirmed: true,
            privacy_status: "private",
            publish_at: candidate.scheduledFor,
            upload_status: "processed",
            processing_status: "succeeded",
            checked_at: verifiedAt,
          },
        };
      };
    },
    async revalidateOfficialSource() {
      receiptTime = liveClock().toISOString();
      return {
        schema_version: "pulse-official-source-revalidation-v1",
        official_source: true,
        unchanged: true,
        claims_match: true,
        source_url: SOURCE_URL,
        source_revision_sha256: SOURCE_REVISION_SHA256,
        revalidated_at: receiptTime,
      };
    },
    validateOfficialSourceRevalidationReceipt(receipt) {
      return { valid: true, value: receipt };
    },
  });

  assert.equal(result.status, "platform_scheduled");
  assert.equal(result.releaseArmed, true);
  assert.equal(result.releaseCommitmentConfirmed, true);
  assert.equal(fixture.calls.scheduleArmAttempts, 1);
  assert.equal(fixture.calls.platformScheduledRecords, 1);
  assert.equal(fixture.calls.commitmentRecords, 1);
  assert.ok(Date.parse(result.commitmentFrozenAt) > Date.parse(receiptTime));
});

test("T-15 rejects a caller-supplied source revision that differs from the immutable scheduled ticket before OAuth", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      expectedSourceRevisionSha256: "0".repeat(64),
      repos: fixture.repos,
      now: () => new Date("2026-07-28T18:45:00.000Z"),
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        fixture.calls.auth += 1;
        throw new Error("forged_revision_must_not_authenticate");
      },
      async armGovernedYoutubeScheduledRelease() {
        throw new Error("forged_revision_must_not_reach_armer");
      },
      async revalidateOfficialSource() {
        throw new Error("forged_revision_must_not_fetch");
      },
    }),
    /youtube_tminus15_payload_source_revision_mismatch/,
  );
  assert.equal(fixture.calls.auth, 0);
});

test("T-15 uses the live irreversible-boundary clock instead of a frozen queued timestamp", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_OBJECT_CREATED",
  });
  const observed = [];

  await assert.rejects(
    armExactGovernedYoutubeScheduledRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountArmInput(),
      repos: fixture.repos,
      now: () => new Date("2026-07-28T18:45:00.000Z"),
      irreversibleBoundaryNow: () => new Date("2026-07-28T18:45:07.000Z"),
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy(input) {
        observed.push(input.now.toISOString());
        const error = new Error("stop_after_live_clock_assertion");
        error.code = "stop_after_live_clock_assertion";
        throw error;
      },
    }),
    /stop_after_live_clock_assertion/,
  );

  assert.deepEqual(observed, ["2026-07-28T18:45:07.000Z"]);
});

test("private prestage verifier holds on lease or live control before OAuth and has no fallback create path", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });
  let auth = 0;

  const leaseBlocked = await verifyExactGovernedYoutubePrivatePrestage({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    async runWithPublisherLease() {
      return { status: "blocked", blocked: true };
    },
    async createAuthenticatedYoutubeClient() {
      auth += 1;
    },
  });
  assert.equal(leaseBlocked.blocked, true);

  await assert.rejects(
    verifyExactGovernedYoutubePrivatePrestage({
      exactStagedBinding: exactBinding(),
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy() {
        const error = new Error("youtube_live_control_not_green");
        error.code = "youtube_live_control_not_green";
        throw error;
      },
      async createAuthenticatedYoutubeClient() {
        auth += 1;
      },
      uploadShort() {
        throw new Error("private_verifier_must_never_upload");
      },
    }),
    (error) => error.code === "youtube_live_control_not_green",
  );
  assert.equal(auth, 0);
});

test("private prestage verifier propagates exact platform-binding failure before lazy OAuth", async () => {
  const fixture = baseFixture({
    lifecycleState: "PLATFORM_SCHEDULED",
  });
  let auth = 0;

  await assert.rejects(
    verifyExactGovernedYoutubePrivatePrestage({
      exactStagedBinding: exactBinding(),
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async createAuthenticatedYoutubeClient() {
        auth += 1;
      },
      async verifyGovernedYoutubePrivatePrestage() {
        throw new Error("platform_scheduled_request_fingerprint_mismatch");
      },
    }),
    /platform_scheduled_request_fingerprint_mismatch/,
  );
  assert.equal(auth, 0);
});

test("publisher lease refusal prevents exact-story reads and all platform work", async () => {
  const fixture = baseFixture();
  const blocked = {
    publish_dispatch_blocked: true,
    status: "blocked",
    top_reason: "durable_publish_lock_unavailable",
  };

  const result = await prestageExactGovernedYoutubeRelease({
    exactStagedBinding: exactBinding(),
    repos: fixture.repos,
    now: () => PRESTAGE_AT,
    async runWithPublisherLease() {
      return blocked;
    },
    assertLiveControlHealthy: assertHealthyLiveControl(fixture.calls),
    validatePublicationEvidence() {
      throw new Error("must_not_read_ticket");
    },
    async uploadShort() {
      throw new Error("must_not_upload");
    },
  });

  assert.deepEqual(result, blocked);
  assert.equal(fixture.calls.storyIds.length, 0);
  assert.equal(fixture.calls.ticketReads, 0);
  assert.deepEqual(fixture.calls.liveControl, []);
});

test("an unhealthy entry control holds before exact-story, ticket, OAuth or upload work", async () => {
  const fixture = baseFixture();
  let authCalls = 0;
  let uploadCalls = 0;

  await assert.rejects(
    prestageExactGovernedYoutubeRelease({
      exactStagedBinding: exactBinding(),
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy({ phase }) {
        assert.equal(phase, "entry");
        const error = new Error("youtube_live_control_not_green");
        error.code = "youtube_live_control_not_green";
        throw error;
      },
      async createAuthenticatedYoutubeClient() {
        authCalls += 1;
      },
      async uploadShort() {
        uploadCalls += 1;
      },
    }),
    (error) => error?.code === "youtube_live_control_not_green",
  );

  assert.equal(fixture.calls.storyIds.length, 0);
  assert.equal(fixture.calls.ticketReads, 0);
  assert.equal(authCalls, 0);
  assert.equal(uploadCalls, 0);
});

test("a kill-switch or scheduler-control flip inside the trusted gate aborts before external create", async () => {
  const fixture = baseFixture();
  let controlChecks = 0;
  let externalCreates = 0;

  await assert.rejects(
    prestageExactGovernedYoutubeRelease({
      exactStagedBinding: exactBinding(),
      ...youtubeAccountPrestageInput(),
      async createAuthenticatedYoutubeClient() {
        return { videos: { list() {} } };
      },
      repos: fixture.repos,
      now: () => PRESTAGE_AT,
      runWithPublisherLease: leaseRunner(fixture.calls),
      assertLiveControlHealthy({ phase }) {
        controlChecks += 1;
        if (phase === "create_boundary") {
          const error = new Error("youtube_live_control_not_green");
          error.code = "youtube_live_control_not_green";
          throw error;
        }
        return { verdict: "GREEN" };
      },
      validatePublicationEvidence(evidence) {
        return evidence.publication_evidence;
      },
      async fingerprintPublicationRequest() {
        return fingerprint();
      },
      async validateApprovedMetadata() {
        return { sha256: METADATA_SHA256 };
      },
      issueTrustedYoutubeCreateBoundaryGate: (revalidate) => revalidate,
      async uploadShort(_story, options) {
        await options.assertYoutubeCreateBoundary();
        externalCreates += 1;
        options.markCreateAttemptStarted();
        return { videoId: "must-not-exist" };
      },
      async prestageGovernedYoutubeRelease(input) {
        return input.uploadScheduled({
          scheduledFor: SCHEDULED_FOR,
          markCreateAttemptStarted() {},
        });
      },
      channel: { id: CHANNEL_ID },
      resolveMediaPath: (value) => value,
      reportAuthTelemetry() {},
    }),
    (error) => error?.code === "youtube_live_control_not_green",
  );

  assert.equal(controlChecks, 2);
  assert.equal(externalCreates, 0);
});

test("production live control derives LIVE_GUARDED, kill-switch and durable scheduler-owner truth itself", () => {
  const env = {
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    PULSE_KILL_SWITCH: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
    PULSE_MULTI_LANE_WORKERS: "true",
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_SCHEDULER_PROFILE: "governed_multi_lane",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: "f".repeat(64),
  };
  const repos = {
    runtimeLeases: {
      get(name) {
        assert.equal(name, "scheduler:primary");
        return {
          owner_id: "scheduler-production",
          heartbeat_at: "2026-07-28T17:49:30.000Z",
          expires_at: "2026-07-28T17:51:00.000Z",
        };
      },
    },
  };

  const green = assertLiveControlHealthy({
    repos,
    env,
    now: PRESTAGE_AT,
  });
  assert.equal(green.verdict, "GREEN");
  assert.equal(green.kill_switch_healthy, true);
  assert.equal(green.scheduler_owner_healthy, true);

  assert.throws(
    () =>
      assertLiveControlHealthy({
        repos,
        env: { ...env, PULSE_KILL_SWITCH: "true" },
        now: PRESTAGE_AT,
        phase: "create_boundary",
      }),
    (error) => {
      assert.equal(error.code, "youtube_live_control_not_green");
      assert.equal(error.phase, "create_boundary");
      assert.ok(error.blockers.includes("kill_switch_not_healthy"));
      return true;
    },
  );
});

test("authenticated YouTube verifier client creation is an internal production default with injectable non-live boundaries", async () => {
  const auth = { credentials: { refresh_token: "not-a-real-token" } };
  let telemetryReporter = null;
  let youtubeOptions = null;
  const reportAuthTelemetry = () => {};

  const client = await createAuthenticatedYoutubeClient({
    async getAuthClient(options) {
      telemetryReporter = options.reportAuthTelemetry;
      return auth;
    },
    googleYoutube(options) {
      youtubeOptions = options;
      return { videos: { list() {} } };
    },
    reportAuthTelemetry,
  });

  assert.equal(telemetryReporter, reportAuthTelemetry);
  assert.deepEqual(youtubeOptions, {
    version: "v3",
    auth,
  });
  assert.equal(typeof client.videos.list, "function");
});
