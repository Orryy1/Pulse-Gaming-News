"use strict";

const {
  runWithPublisherLease: defaultRunWithPublisherLease,
} = require("./publisher-lock");

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  const normalised = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(normalised) ? normalised : null;
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function readClock(value) {
  const resolved =
    typeof value === "function"
      ? value()
      : value === null || value === undefined
        ? new Date()
        : value;
  const date =
    resolved instanceof Date
      ? new Date(resolved.getTime())
      : new Date(resolved);
  if (Number.isNaN(date.getTime())) {
    fail("youtube_publisher_adapter_clock_invalid");
  }
  return date;
}

function trustedClock(value) {
  return function readTrustedPublisherAdapterClock() {
    return readClock(value);
  };
}

function requiredFunction(value, code) {
  if (typeof value !== "function") fail(code);
  return value;
}

function normaliseExactYoutubeStagedBinding(
  value,
  { channelId = null } = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("youtube_exact_staged_binding_invalid");
  }
  const scheduled = new Date(
    value.scheduledFor || value.scheduled_for,
  );
  const eventId = Number(
    value.scheduledEventId || value.scheduled_event_id,
  );
  const binding = {
    storyId: text(value.storyId || value.story_id),
    channelId: text(
      value.channelId || value.channel_id || channelId,
    ),
    platform: text(value.platform).toLowerCase(),
    scheduledEventId: eventId,
    scheduledFor: Number.isNaN(scheduled.getTime())
      ? ""
      : scheduled.toISOString(),
    idempotencyKey: text(
      value.idempotencyKey ||
        value.dispatchIdempotencyKey ||
        value.dispatch_idempotency_key,
    ),
    requestFingerprint: sha256(
      value.requestFingerprint || value.request_fingerprint,
    ),
    runwayLockSha256: sha256(
      value.runwayLockSha256 || value.runway_lock_sha256,
    ),
    mediaSha256: sha256(
      value.mediaSha256 || value.media_sha256,
    ),
    scriptSha256: sha256(
      value.scriptSha256 || value.script_sha256,
    ),
  };
  if (
    !binding.storyId ||
    !binding.channelId ||
    binding.platform !== "youtube" ||
    !Number.isInteger(binding.scheduledEventId) ||
    binding.scheduledEventId <= 0 ||
    !binding.scheduledFor ||
    !binding.idempotencyKey ||
    !binding.requestFingerprint ||
    !binding.runwayLockSha256 ||
    !binding.mediaSha256 ||
    !binding.scriptSha256
  ) {
    fail("youtube_exact_staged_binding_invalid");
  }
  return Object.freeze(binding);
}

function parseScheduledEvidence(event) {
  let evidence;
  try {
    evidence =
      typeof event?.evidence_json === "string"
        ? JSON.parse(event.evidence_json)
        : event?.evidence;
  } catch {
    fail("youtube_exact_scheduled_ticket_evidence_invalid");
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    fail("youtube_exact_scheduled_ticket_evidence_invalid");
  }
  return evidence;
}

function defaultValidatePublicationEvidence(evidence) {
  return require("../../publisher").readScheduledPublicationEvidence(
    evidence,
  );
}

function readExactScheduledYoutubeTicket({
  governance,
  binding,
  validatePublicationEvidence = defaultValidatePublicationEvidence,
} = {}) {
  if (
    !governance ||
    typeof governance.getLatestLifecycleEvent !== "function"
  ) {
    fail("youtube_exact_scheduled_ticket_repository_required");
  }
  const event = governance.getLatestLifecycleEvent(
    binding.storyId,
    "youtube",
    "SCHEDULED",
  );
  if (!event) fail("youtube_exact_scheduled_ticket_required");
  const evidence = parseScheduledEvidence(event);
  let scheduledFor = "";
  try {
    scheduledFor = new Date(evidence.scheduled_for).toISOString();
  } catch {
    fail("youtube_exact_scheduled_ticket_time_invalid");
  }
  const controlTowerCheckedAt = Date.parse(
    text(evidence.control_tower_checked_at),
  );
  if (
    evidence.schedule_verified !== true ||
    text(evidence.control_tower_verdict).toUpperCase() !== "GREEN" ||
    !Number.isFinite(controlTowerCheckedAt) ||
    evidence.kill_switch_healthy !== true ||
    evidence.operating_contract_valid !== true
  ) {
    fail("youtube_exact_scheduled_ticket_controls_invalid");
  }
  const comparisons = [
    [
      text(event.story_id),
      binding.storyId,
      "youtube_exact_scheduled_ticket_story_mismatch",
    ],
    [
      text(event.platform).toLowerCase(),
      "youtube",
      "youtube_exact_scheduled_ticket_platform_mismatch",
    ],
    [
      Number(event.id),
      binding.scheduledEventId,
      "youtube_exact_scheduled_ticket_event_mismatch",
    ],
    [
      scheduledFor,
      binding.scheduledFor,
      "youtube_exact_scheduled_ticket_time_mismatch",
    ],
    [
      text(evidence.dispatch_idempotency_key),
      binding.idempotencyKey,
      "youtube_exact_scheduled_ticket_identity_mismatch",
    ],
    [
      sha256(evidence.request_fingerprint),
      binding.requestFingerprint,
      "youtube_exact_scheduled_ticket_fingerprint_mismatch",
    ],
    [
      sha256(evidence.runway_lock_sha256),
      binding.runwayLockSha256,
      "youtube_exact_scheduled_ticket_runway_lock_mismatch",
    ],
  ];
  if (
    event.to_state !== undefined &&
    text(event.to_state).toUpperCase() !== "SCHEDULED"
  ) {
    fail("youtube_exact_scheduled_ticket_state_mismatch");
  }
  for (const [actual, expected, code] of comparisons) {
    if (actual !== expected) fail(code);
  }
  if (
    evidence.media_sha256 !== undefined &&
    sha256(evidence.media_sha256) !== binding.mediaSha256
  ) {
    fail("youtube_exact_scheduled_ticket_media_mismatch");
  }
  if (
    evidence.script_sha256 !== undefined &&
    sha256(evidence.script_sha256) !== binding.scriptSha256
  ) {
    fail("youtube_exact_scheduled_ticket_script_mismatch");
  }
  const publicationEvidence = requiredFunction(
    validatePublicationEvidence,
    "youtube_publication_evidence_validator_required",
  )(evidence);
  return Object.freeze({
    event,
    evidence,
    rawEvidenceJson:
      typeof event.evidence_json === "string"
        ? event.evidence_json
        : JSON.stringify(evidence),
    scheduledFor,
    idempotencyKey: binding.idempotencyKey,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    publicationEvidence,
  });
}

function assertSameExactScheduledYoutubeTicket(initial, current) {
  const comparisons = [
    [Number(current?.event?.id), Number(initial?.event?.id)],
    [text(current?.scheduledFor), text(initial?.scheduledFor)],
    [text(current?.idempotencyKey), text(initial?.idempotencyKey)],
    [
      text(current?.requestFingerprint).toLowerCase(),
      text(initial?.requestFingerprint).toLowerCase(),
    ],
    [
      text(current?.runwayLockSha256).toLowerCase(),
      text(initial?.runwayLockSha256).toLowerCase(),
    ],
    [text(current?.rawEvidenceJson), text(initial?.rawEvidenceJson)],
  ];
  if (comparisons.some(([actual, expected]) => actual !== expected)) {
    fail("youtube_exact_scheduled_ticket_changed_before_create");
  }
  return true;
}

function exactUploadStory(story, binding, publicationEvidence) {
  return {
    ...story,
    channel_id: text(story?.channel_id) || binding.channelId,
    synthetic_media_disclosure:
      publicationEvidence.synthetic_media_disclosure,
    governed_publication_metadata_sha256:
      publicationEvidence.publication_metadata_sha256,
    governed_publication_metadata:
      publicationEvidence.publication_metadata,
  };
}

async function validateExactApprovedYoutubeStory({
  story,
  binding,
  ticket,
  fingerprintPublicationRequest,
  resolveMediaPath,
  channel,
  validateApprovedMetadata,
} = {}) {
  if (
    !story ||
    typeof story !== "object" ||
    text(story.id) !== binding.storyId
  ) {
    fail("youtube_exact_binding_story_not_found");
  }
  if (
    text(story.channel_id) &&
    text(story.channel_id) !== binding.channelId
  ) {
    fail("youtube_exact_binding_channel_mismatch");
  }
  const fingerprint = await requiredFunction(
    fingerprintPublicationRequest,
    "youtube_publication_fingerprint_service_required",
  )(story, {
    channelId: binding.channelId,
    platform: "youtube",
    resolveMediaPath,
    channel,
    publicationEvidence: ticket.publicationEvidence,
  });
  for (const [actual, expected, code] of [
    [
      sha256(fingerprint?.request_fingerprint),
      binding.requestFingerprint,
      "youtube_exact_binding_request_fingerprint_mismatch",
    ],
    [
      sha256(fingerprint?.media_sha256),
      binding.mediaSha256,
      "youtube_exact_binding_media_sha256_mismatch",
    ],
    [
      sha256(fingerprint?.script_sha256),
      binding.scriptSha256,
      "youtube_exact_binding_script_sha256_mismatch",
    ],
  ]) {
    if (actual !== expected) fail(code);
  }
  const uploadStory = exactUploadStory(
    story,
    binding,
    ticket.publicationEvidence,
  );
  const approvedMetadata = await requiredFunction(
    validateApprovedMetadata,
    "youtube_approved_metadata_validator_required",
  )(uploadStory);
  const expectedMetadata =
    ticket.publicationEvidence.publication_metadata;
  const expectedMetadataSha = sha256(
    ticket.publicationEvidence.publication_metadata_sha256,
  );
  if (
    !expectedMetadata ||
    typeof expectedMetadata !== "object" ||
    !expectedMetadataSha ||
    sha256(approvedMetadata?.sha256) !== expectedMetadataSha
  ) {
    fail("youtube_exact_binding_metadata_sha256_mismatch");
  }
  for (const field of ["title", "description"]) {
    if (
      approvedMetadata?.[field] !== undefined &&
      text(approvedMetadata[field]) !== text(expectedMetadata[field])
    ) {
      fail(`youtube_exact_binding_metadata_${field}_mismatch`);
    }
  }
  return Object.freeze({
    story,
    uploadStory,
    fingerprint,
    approvedMetadata,
  });
}

async function createAuthenticatedYoutubeClient({
  getAuthClient = null,
  googleYoutube = null,
  reportAuthTelemetry = null,
} = {}) {
  const authFactory =
    getAuthClient || require("../../upload_youtube").getAuthClient;
  const auth = await requiredFunction(
    authFactory,
    "youtube_auth_client_factory_required",
  )({ reportAuthTelemetry });
  const youtubeFactory =
    googleYoutube ||
    ((options) =>
      require("googleapis").google.youtube(options));
  return requiredFunction(
    youtubeFactory,
    "youtube_authenticated_client_factory_required",
  )({
    version: "v3",
    auth,
  });
}

function createLazyAuthenticatedVerifier({
  createAuthenticatedClient,
  createVerifier,
  verifierOptions = {},
} = {}) {
  requiredFunction(
    createAuthenticatedClient,
    "youtube_authenticated_client_factory_required",
  );
  requiredFunction(
    createVerifier,
    "youtube_object_verifier_factory_required",
  );
  let verifierPromise = null;
  return async function verifyExactYoutubeObject(candidate) {
    if (!verifierPromise) {
      verifierPromise = Promise.resolve()
        .then(() => createAuthenticatedClient())
        .then((youtubeClient) =>
          createVerifier({
            ...verifierOptions,
            youtubeClient,
          }),
        );
    }
    const verifier = await verifierPromise;
    return requiredFunction(
      verifier,
      "youtube_object_verifier_required",
    )(candidate);
  };
}

function resolveRepos(value) {
  return value || require("../repositories").getRepos();
}

function assertAdapterRepos(repos) {
  if (
    !repos?.db ||
    !repos?.stories ||
    typeof repos.stories.get !== "function" ||
    !repos.platformPosts ||
    !repos.publicationGovernance
  ) {
    fail("youtube_publisher_adapter_repositories_required");
  }
}

async function loadExactStory(repos, binding) {
  const story = await Promise.resolve(
    repos.stories.get(binding.storyId),
  );
  if (!story || text(story.id) !== binding.storyId) {
    fail("youtube_exact_binding_story_not_found");
  }
  return story;
}

function defaultReportAuthTelemetry() {}

function authenticatedClientFactory(input, reportAuthTelemetry) {
  if (typeof input.createAuthenticatedYoutubeClient === "function") {
    return () =>
      input.createAuthenticatedYoutubeClient({
        reportAuthTelemetry,
      });
  }
  return () =>
    createAuthenticatedYoutubeClient({
      getAuthClient: input.getAuthClient,
      googleYoutube: input.googleYoutube,
      reportAuthTelemetry,
    });
}

function validateYoutubeAccountBoundSession(session) {
  if (
    !session ||
    typeof session !== "object" ||
    typeof session.getYoutubeClient !== "function" ||
    typeof session.getBindingProof !== "function" ||
    typeof session.revalidate !== "function"
  ) {
    fail("youtube_account_bound_session_required");
  }
  return session;
}

async function createYoutubeAccountBoundSessionInsideLease(
  input,
  {
    now,
    reportAuthTelemetry,
    assertLeaseHealthy,
  },
) {
  assertLeaseHealthy();
  const createAuthenticatedYoutubeClient =
    authenticatedClientFactory(
      input,
      reportAuthTelemetry,
    );
  const factory =
    input.createYoutubeAccountBoundSession ||
    require("../../upload_youtube")
      .createFreshYoutubeAccountBoundSession;
  const session = validateYoutubeAccountBoundSession(
    await requiredFunction(
      factory,
      "youtube_account_bound_session_factory_required",
    )({
      env: input.env || process.env,
      now,
      reportAuthTelemetry,
      createAuthenticatedYoutubeClient,
    }),
  );
  assertLeaseHealthy();
  session.getBindingProof();
  session.getYoutubeClient();
  return session;
}

function assertLiveControlHealthy({
  repos,
  env = process.env,
  now = new Date(),
  phase = "entry",
} = {}) {
  const {
    resolveOperatingContract,
  } = require("../stabilisation/operating-contract");
  const {
    deriveMultiLaneRuntimeControl,
  } = require("./multi-lane-runtime-control");
  const operatingContract = resolveOperatingContract({ env });
  const control = deriveMultiLaneRuntimeControl({
    payload: {
      scheduler_profile:
        env.PULSE_SCHEDULER_PROFILE || "governed_multi_lane",
      live_publish_enabled: true,
    },
    repos,
    env,
    now,
    operatingContract,
  });
  const blockers = [];
  if (
    operatingContract.mode !== "LIVE_GUARDED" ||
    operatingContract.valid !== true ||
    operatingContract.live_mutation_allowed !== true
  ) {
    blockers.push("live_guarded_operating_contract_required");
    blockers.push(...(operatingContract.blockers || []));
  }
  if (control.kill_switch_healthy !== true) {
    blockers.push("kill_switch_not_healthy");
  }
  if (control.operating_contract_valid !== true) {
    blockers.push("operating_contract_not_healthy");
  }
  if (control.scheduler_owner_healthy !== true) {
    blockers.push("scheduler_owner_not_healthy");
  }
  if (control.live_publish_enabled !== true) {
    blockers.push("live_publish_control_not_enabled");
  }
  if (blockers.length) {
    const error = new Error("youtube_live_control_not_green");
    error.code = "youtube_live_control_not_green";
    error.phase = phase;
    error.blockers = [...new Set(blockers)];
    error.control = {
      verdict: "HOLD",
      kill_switch_healthy:
        control.kill_switch_healthy === true,
      operating_contract_valid:
        control.operating_contract_valid === true,
      scheduler_owner_healthy:
        control.scheduler_owner_healthy === true,
      live_publish_enabled:
        control.live_publish_enabled === true,
      evidence: control.evidence,
    };
    throw error;
  }
  return {
    verdict: "GREEN",
    phase,
    checked_at: readClock(now).toISOString(),
    kill_switch_healthy: true,
    operating_contract_valid: true,
    scheduler_owner_healthy: true,
    live_publish_enabled: true,
    evidence: control.evidence,
  };
}

function assertRemoteDisarmAuthority({
  repos,
  env = process.env,
  now = new Date(),
  phase = "entry",
  reason,
} = {}) {
  const {
    resolveOperatingContract,
  } = require("../stabilisation/operating-contract");
  const {
    deriveMultiLaneRuntimeControl,
  } = require("./multi-lane-runtime-control");
  const operatingContract = resolveOperatingContract({ env });
  const control = deriveMultiLaneRuntimeControl({
    payload: {
      scheduler_profile:
        env.PULSE_SCHEDULER_PROFILE || "governed_multi_lane",
      live_publish_enabled: false,
    },
    repos,
    env,
    now,
    operatingContract,
  });
  const governedReason = text(reason);
  const blockers = [];
  if (!governedReason) {
    blockers.push("governed_disarm_reason_required");
  }
  if (blockers.length) {
    const error = new Error(
      "youtube_remote_disarm_authority_not_healthy",
    );
    error.code =
      "youtube_remote_disarm_authority_not_healthy";
    error.phase = phase;
    error.blockers = [...new Set(blockers)];
    error.control = {
      verdict: "HOLD",
      kill_switch_healthy:
        control.kill_switch_healthy === true,
      scheduler_owner_healthy:
        control.scheduler_owner_healthy === true,
      autonomous_production_enabled:
        control.autonomous_production_enabled === true,
      evidence: control.evidence,
    };
    throw error;
  }
  return {
    verdict: "DISARM_AUTHORISED",
    phase,
    reason: governedReason,
    checked_at: readClock(now).toISOString(),
    kill_switch_healthy:
      control.kill_switch_healthy === true,
    scheduler_owner_healthy:
      control.scheduler_owner_healthy === true,
    autonomous_production_enabled:
      control.autonomous_production_enabled === true,
    publish_health_required: false,
    scheduler_health_required: false,
    kill_switch_health_required: false,
    operating_contract_mode: operatingContract.mode,
    operating_contract_valid:
      operatingContract.valid === true,
    evidence: control.evidence,
  };
}

function runImmediateTransaction(db, callback) {
  if (!db || typeof db.transaction !== "function") {
    fail("youtube_publisher_adapter_transaction_required");
  }
  const transaction = db.transaction(callback);
  if (typeof transaction?.immediate === "function") {
    return transaction.immediate();
  }
  return requiredFunction(
    transaction,
    "youtube_publisher_adapter_transaction_required",
  )();
}

function resolveExactScheduledDisarmBinding({
  governance,
  binding,
  externalId,
  now,
} = {}) {
  const resolver =
    governance?.resolveScheduledPlatformDisarmBinding ||
    governance?.assertPlatformScheduledBinding;
  return requiredFunction(
    resolver,
    "youtube_schedule_disarm_binding_resolver_required",
  ).call(governance, {
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    externalId,
    idempotencyKey: binding.idempotencyKey,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    now,
  });
}

function exactDisarmPlatformPost({
  platformPosts,
  binding,
  state,
} = {}) {
  const platformPost = requiredFunction(
    platformPosts?.getByStoryPlatform,
    "youtube_schedule_disarm_platform_post_repository_required",
  ).call(platformPosts, binding.storyId, "youtube");
  const externalId = text(
    state?.external_id || platformPost?.external_id,
  );
  if (!platformPost || !externalId) {
    fail("youtube_schedule_disarm_anchored_platform_post_required");
  }
  if (
    text(platformPost.story_id) &&
    text(platformPost.story_id) !== binding.storyId
  ) {
    fail("youtube_schedule_disarm_platform_post_story_mismatch");
  }
  if (
    text(platformPost.platform).toLowerCase() &&
    text(platformPost.platform).toLowerCase() !== "youtube"
  ) {
    fail("youtube_schedule_disarm_platform_post_platform_mismatch");
  }
  if (
    text(platformPost.external_id) &&
    text(platformPost.external_id) !== externalId
  ) {
    fail("youtube_schedule_disarm_platform_post_identity_mismatch");
  }
  return { platformPost, externalId };
}

function disarmResult({
  state,
  platformPost,
  externalId,
  verification = null,
  reused = false,
} = {}) {
  return {
    status: "platform_schedule_disarmed",
    disarmed: true,
    reused: reused === true,
    alreadyDisarmed:
      reused === true ||
      verification?.alreadyDisarmed === true,
    externalId,
    externalUrl:
      text(
        verification?.externalUrl ||
          state?.external_url ||
          platformPost?.external_url,
      ) || null,
    verification,
    governanceState: state,
    platformPost,
  };
}

function exactReleaseCommitmentInput({
  binding,
  externalId,
  verification,
  controlEvidence,
  now,
} = {}) {
  const exactExternalId = text(externalId);
  if (
    !exactExternalId ||
    verification?.confirmed !== true ||
    text(verification.externalId) !== exactExternalId ||
    text(verification.scheduledFor) !== binding.scheduledFor ||
    !verification?.evidence ||
    typeof verification.evidence !== "object"
  ) {
    fail("youtube_release_commitment_exact_verification_required");
  }
  return {
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    idempotencyKey: binding.idempotencyKey,
    externalId: exactExternalId,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    verifiedAt: verification.verifiedAt,
    verificationEvidence: {
      ...verification.evidence,
      external_id: exactExternalId,
    },
    controlEvidence,
    now,
  };
}

function assertExactScheduledReleaseCommitment({
  governance,
  binding,
  externalId,
  now,
  allowPublishedReplay = false,
} = {}) {
  return requiredFunction(
    governance?.assertScheduledPlatformReleaseCommitment,
    "youtube_release_commitment_assertion_required",
  ).call(governance, {
    storyId: binding.storyId,
    channelId: binding.channelId,
    platform: "youtube",
    idempotencyKey: binding.idempotencyKey,
    externalId,
    scheduledFor: binding.scheduledFor,
    requestFingerprint: binding.requestFingerprint,
    runwayLockSha256: binding.runwayLockSha256,
    now,
    allowPublishedReplay,
  });
}

function recordExactScheduledReleaseCommitment({
  governance,
  binding,
  externalId,
  verification,
  controlEvidence,
  now,
} = {}) {
  requiredFunction(
    governance?.recordScheduledPlatformReleaseCommitment,
    "youtube_release_commitment_recorder_required",
  ).call(
    governance,
    exactReleaseCommitmentInput({
      binding,
      externalId,
      verification,
      controlEvidence,
      now,
    }),
  );
  return assertExactScheduledReleaseCommitment({
    governance,
    binding,
    externalId,
    now,
  });
}

function withReleaseCommitment(result, commitment) {
  return {
    ...result,
    releaseCommitmentConfirmed: true,
    commitmentFrozenAt:
      commitment?.evidence?.committed_at || null,
    releaseCommitment: commitment,
  };
}

async function disarmExactGovernedYoutubeScheduledRelease(
  input = {},
) {
  const binding = normaliseExactYoutubeStagedBinding(
    input.exactStagedBinding || input.binding,
    { channelId: input.channelId },
  );
  const repos = resolveRepos(input.repos);
  const clock = trustedClock(input.now);
  const governedReason = text(input.reason);
  const emergencyContainment =
    input.emergencyContainment === true;
  const containmentReason = text(
    input.containmentReason ||
      input.containment_reason ||
      (emergencyContainment ? governedReason : ""),
  );
  if (!governedReason) {
    fail("youtube_schedule_disarm_reason_required");
  }
  if (emergencyContainment && !containmentReason) {
    fail("youtube_schedule_containment_reason_required");
  }
  const runWithPublisherLease =
    input.runWithPublisherLease || defaultRunWithPublisherLease;
  return requiredFunction(
    runWithPublisherLease,
    "publisher_lease_runner_required",
  )({
    leases: input.leases || repos.runtimeLeases,
    channelId: binding.channelId,
    operation: "disarm_governed_youtube_scheduled_release",
    ownerId: input.ownerId,
    leaseMs: input.leaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    metadata: {
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      request_fingerprint: binding.requestFingerprint,
      runway_lock_sha256: binding.runwayLockSha256,
      external_create_authority: "none",
      remote_mutation: "remove_publish_at_only",
      emergency_containment: emergencyContainment,
      containment_reason:
        emergencyContainment
          ? containmentReason
          : null,
    },
    log: input.log || (() => {}),
    task: async ({ assertHealthy }) => {
      const assertLeaseHealthy = requiredFunction(
        assertHealthy,
        "youtube_schedule_disarm_lease_assertion_required",
      );
      assertLeaseHealthy();
      assertAdapterRepos(repos);
      const assertCurrentDisarmAuthority =
        input.assertRemoteDisarmAuthority ||
        assertRemoteDisarmAuthority;
      const entryAuthority = await requiredFunction(
        assertCurrentDisarmAuthority,
        "youtube_remote_disarm_authority_required",
      )({
        repos,
        env: input.env || process.env,
        now: clock(),
        phase: "entry",
        binding,
        reason: governedReason,
      });
      assertLeaseHealthy();
      await loadExactStory(repos, binding);
      const validatePublicationEvidence =
        input.validatePublicationEvidence ||
        defaultValidatePublicationEvidence;
      const ticket = readExactScheduledYoutubeTicket({
        governance: repos.publicationGovernance,
        binding,
        validatePublicationEvidence,
      });
      const state = repos.publicationGovernance.getState(
        binding.storyId,
        "youtube",
      );
      const { platformPost, externalId } =
        exactDisarmPlatformPost({
          platformPosts: repos.platformPosts,
          binding,
          state,
        });
      resolveExactScheduledDisarmBinding({
        governance: repos.publicationGovernance,
        binding,
        externalId,
        now: clock(),
      });
      if (
        state?.lifecycle_state ===
        "PLATFORM_SCHEDULE_DISARMED"
      ) {
        return disarmResult({
          state,
          platformPost,
          externalId,
          reused: true,
        });
      }
      const supportedStates = new Set([
        "PLATFORM_OBJECT_CREATED",
        "PLATFORM_SCHEDULED",
        "RECONCILIATION_REQUIRED",
      ]);
      if (!supportedStates.has(state?.lifecycle_state)) {
        fail(
          `youtube_schedule_disarm_lifecycle_invalid:${
            state?.lifecycle_state || "NONE"
          }`,
        );
      }
      const requestedAt = clock().toISOString();
      repos.publicationGovernance
        .recordScheduledPlatformDisarmRequested({
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          disarmEvidence: {
            schema_version:
              "pulse-youtube-schedule-disarm-request-v1",
            schedule_disarm_requested: true,
            external_id: externalId,
            requested_at: requestedAt,
            authority: entryAuthority,
            reason: governedReason,
            emergency_containment:
              emergencyContainment,
            containment_reason:
              emergencyContainment
                ? containmentReason
                : null,
          },
          now: clock(),
        });
      assertLeaseHealthy();

      let updateAttemptStarted = false;
      let platformContacted = false;
      let disarm;
      try {
        const reportAuthTelemetry =
          input.reportAuthTelemetry ||
          defaultReportAuthTelemetry;
        const youtubeClient =
          await authenticatedClientFactory(
            input,
            reportAuthTelemetry,
          )();
        const disarmerFactory =
          input.createYoutubeScheduledObjectDisarmer ||
          require("./youtube-scheduled-object-disarmer")
            .createYoutubeScheduledObjectDisarmer;
        disarm = requiredFunction(
          disarmerFactory,
          "youtube_schedule_disarmer_factory_required",
        )({
          youtubeClient,
          now: clock,
          ...(input.disarmerOptions || {}),
        });
        const verification = await requiredFunction(
          disarm,
          "youtube_schedule_disarmer_required",
        )({
          platform: "youtube",
          storyId: binding.storyId,
          externalId,
          scheduledFor: binding.scheduledFor,
          emergencyContainment,
          containmentReason:
            emergencyContainment
              ? containmentReason
              : null,
          markUpdateAttemptStarted() {
            updateAttemptStarted = true;
          },
          assertUpdateBoundary: async () => {
            platformContacted = true;
            assertLeaseHealthy();
            await loadExactStory(repos, binding);
            const currentTicket =
              readExactScheduledYoutubeTicket({
                governance:
                  repos.publicationGovernance,
                binding,
                validatePublicationEvidence,
              });
            assertSameExactScheduledYoutubeTicket(
              ticket,
              currentTicket,
            );
            resolveExactScheduledDisarmBinding({
              governance: repos.publicationGovernance,
              binding,
              externalId,
              now: clock(),
            });
            await assertCurrentDisarmAuthority({
              repos,
              env: input.env || process.env,
              now: clock(),
              phase: "update_boundary",
              binding,
              externalId,
              reason: governedReason,
            });
            assertLeaseHealthy();
          },
        });
        platformContacted = true;
        if (
          verification?.confirmed !== true ||
          text(verification.externalId) !== externalId ||
          verification?.evidence
            ?.schedule_disarm_confirmed !== true
        ) {
          const error = new Error(
            "youtube_schedule_disarm_exact_verification_required",
          );
          error.code =
            "youtube_schedule_disarm_exact_verification_required";
          throw error;
        }
        const finalised = runImmediateTransaction(
          repos.db,
          () => {
            const confirmed =
              repos.publicationGovernance
                .recordScheduledPlatformDisarmed({
                  storyId: binding.storyId,
                  channelId: binding.channelId,
                  platform: "youtube",
                  idempotencyKey:
                    binding.idempotencyKey,
                  externalId,
                  scheduledFor: binding.scheduledFor,
                  requestFingerprint:
                    binding.requestFingerprint,
                  runwayLockSha256:
                    binding.runwayLockSha256,
                  verifiedAt:
                    verification.verifiedAt ||
                    verification.evidence.checked_at,
                  verificationEvidence:
                    verification.evidence,
                  now: clock(),
                });
            const blocked = requiredFunction(
              repos.platformPosts.markBlocked,
              "youtube_schedule_disarm_platform_post_blocker_required",
            ).call(
              repos.platformPosts,
              platformPost.id,
              "youtube_remote_schedule_disarmed",
            );
            if (!blocked) {
              fail(
                "youtube_schedule_disarm_platform_projection_failed",
              );
            }
            return { confirmed, blocked };
          },
        );
        assertLeaseHealthy();
        return disarmResult({
          state: finalised.confirmed,
          platformPost: finalised.blocked,
          externalId,
          verification,
        });
      } catch (error) {
        error.createAttemptStarted = false;
        error.externalId =
          text(error.externalId) || externalId;
        error.platformContacted =
          error.platformContacted === true ||
          platformContacted;
        error.updateAttemptStarted =
          error.updateAttemptStarted === true ||
          updateAttemptStarted;
        error.reconciliationRequired = true;
        try {
          runImmediateTransaction(repos.db, () => {
            repos.publicationGovernance
              .recordScheduledPlatformDisarmReconciliationRequired(
                {
                  storyId: binding.storyId,
                  channelId: binding.channelId,
                  platform: "youtube",
                  idempotencyKey:
                    binding.idempotencyKey,
                  externalId,
                  scheduledFor: binding.scheduledFor,
                  requestFingerprint:
                    binding.requestFingerprint,
                  runwayLockSha256:
                    binding.runwayLockSha256,
                  error,
                  disarmEvidence: {
                    schema_version:
                      "pulse-youtube-schedule-disarm-uncertain-v1",
                    platform_contacted:
                      error.platformContacted === true,
                    update_attempt_started:
                      error.updateAttemptStarted === true,
                    external_id: externalId,
                    observed_at: clock().toISOString(),
                  },
                  now: clock(),
                },
              );
            const failed = requiredFunction(
              repos.platformPosts.markFailed,
              "youtube_schedule_disarm_platform_post_failure_required",
            ).call(
              repos.platformPosts,
              platformPost.id,
              error,
              {
                externalId,
                externalUrl:
                  platformPost.external_url,
              },
            );
            if (!failed) {
              fail(
                "youtube_schedule_disarm_platform_projection_failed",
              );
            }
          });
        } catch (persistenceError) {
          persistenceError.cause = error;
          persistenceError.code =
            persistenceError.code ||
            "youtube_schedule_disarm_reconciliation_persistence_failed";
          throw persistenceError;
        }
        throw error;
      }
    },
  });
}

async function prestageExactGovernedYoutubeRelease(input = {}) {
  const binding = normaliseExactYoutubeStagedBinding(
    input.exactStagedBinding || input.binding,
    { channelId: input.channelId },
  );
  const repos = resolveRepos(input.repos);
  const evidenceClock = trustedClock(input.now);
  const irreversibleBoundaryClock = trustedClock(
    input.irreversibleBoundaryNow || input.now,
  );
  const runWithPublisherLease =
    input.runWithPublisherLease || defaultRunWithPublisherLease;
  return requiredFunction(
    runWithPublisherLease,
    "publisher_lease_runner_required",
  )({
    leases: input.leases || repos.runtimeLeases,
    channelId: binding.channelId,
    operation: "prestage_governed_youtube_release",
    ownerId: input.ownerId,
    leaseMs: input.leaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    metadata: {
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      request_fingerprint: binding.requestFingerprint,
      runway_lock_sha256: binding.runwayLockSha256,
      external_create_authority: "private_unscheduled_only",
    },
    log: input.log || (() => {}),
    task: async ({ assertHealthy }) => {
      const assertLeaseHealthy = requiredFunction(
        assertHealthy,
        "youtube_private_prestage_lease_assertion_required",
      );
      assertLeaseHealthy();
      assertAdapterRepos(repos);
      const assertCurrentLiveControl =
        input.assertLiveControlHealthy ||
        assertLiveControlHealthy;
      await requiredFunction(
        assertCurrentLiveControl,
        "youtube_live_control_assertion_required",
      )({
        repos,
        env: input.env || process.env,
        now: irreversibleBoundaryClock(),
        phase: "entry",
        binding,
      });
      const story = await loadExactStory(repos, binding);
      const validatePublicationEvidence =
        input.validatePublicationEvidence ||
        defaultValidatePublicationEvidence;
      const ticket = readExactScheduledYoutubeTicket({
        governance: repos.publicationGovernance,
        binding,
        validatePublicationEvidence,
      });
      const fingerprintPublicationRequest =
        input.fingerprintPublicationRequest ||
        require("./publication-request-fingerprint")
          .fingerprintPublicationRequest;
      const resolveMediaPath =
        input.resolveMediaPath ||
        require("../media-paths").resolveExisting;
      const channel =
        input.channel ||
        require("../../channels").getChannel(binding.channelId);
      const validateApprovedMetadata =
        input.validateApprovedMetadata ||
        require("../../upload_youtube").resolveGovernedYoutubeMetadata;
      const issueTrustedYoutubeCreateBoundaryGate =
        input.issueTrustedYoutubeCreateBoundaryGate;
      const uploadShort =
        input.uploadShort ||
        require("../../upload_youtube").uploadShort;
      const reportAuthTelemetry =
        input.reportAuthTelemetry || defaultReportAuthTelemetry;
      const state = repos.publicationGovernance.getState(
        binding.storyId,
        "youtube",
      );
      let approved =
        state?.lifecycle_state === "SCHEDULED"
          ? await validateExactApprovedYoutubeStory({
              story,
              binding,
              ticket,
              fingerprintPublicationRequest,
              resolveMediaPath,
              channel,
              validateApprovedMetadata,
            })
          : null;
      const prestageGovernedYoutubeRelease =
        input.prestageGovernedYoutubeRelease ||
        require("./governed-youtube-private-prestage")
          .prestageGovernedYoutubeRelease;
      let createAttemptStarted = false;
      let platformContacted = false;
      let observedExternalId = null;
      let result;
      try {
        result = await requiredFunction(
          prestageGovernedYoutubeRelease,
          "youtube_private_prestage_service_required",
        )({
          db: repos.db,
          platformPosts: repos.platformPosts,
          governance: repos.publicationGovernance,
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          now: evidenceClock(),
          assertLeaseHealthy,
          uploadScheduled: async ({
            markCreateAttemptStarted,
            scheduledFor,
          }) => {
          assertLeaseHealthy();
          if (scheduledFor !== binding.scheduledFor) {
            fail("youtube_exact_binding_scheduled_for_mismatch");
          }
          if (!approved) {
            approved = await validateExactApprovedYoutubeStory({
              story: await loadExactStory(repos, binding),
              binding,
              ticket,
              fingerprintPublicationRequest,
              resolveMediaPath,
              channel,
              validateApprovedMetadata,
            });
          }
          const assertYoutubeCreateBoundary =
            requiredFunction(
              issueTrustedYoutubeCreateBoundaryGate,
              "youtube_trusted_create_boundary_factory_required",
            )(async () => {
              assertLeaseHealthy();
              const currentStory = await loadExactStory(
                repos,
                binding,
              );
              const currentTicket =
                readExactScheduledYoutubeTicket({
                  governance: repos.publicationGovernance,
                  binding,
                  validatePublicationEvidence,
                });
              assertSameExactScheduledYoutubeTicket(
                ticket,
                currentTicket,
              );
              await validateExactApprovedYoutubeStory({
                story: currentStory,
                binding,
                ticket: currentTicket,
                fingerprintPublicationRequest,
                resolveMediaPath,
                channel,
                validateApprovedMetadata,
              });
              await assertCurrentLiveControl({
                repos,
                env: input.env || process.env,
                now: irreversibleBoundaryClock(),
                phase: "create_boundary",
                binding,
              });
              assertLeaseHealthy();
            });
          platformContacted = true;
          const youtubeAccountBoundSession =
            await createYoutubeAccountBoundSessionInsideLease(
              input,
              {
                now: irreversibleBoundaryClock,
                reportAuthTelemetry,
                assertLeaseHealthy,
              },
            );
          const uploaded = await requiredFunction(
            uploadShort,
            "youtube_short_uploader_required",
          )(approved.uploadStory, {
            governedDispatch: true,
            privateOnly: true,
            markCreateAttemptStarted() {
              createAttemptStarted = true;
              return markCreateAttemptStarted();
            },
            assertYoutubeCreateBoundary,
            youtubeAccountBoundSession,
            reportAuthTelemetry,
            expectedMediaSha256: binding.mediaSha256,
          });
          if (uploaded?.blocked) {
            const error = new Error(
              `youtube_private_prestage_upload_blocked:${
                text(uploaded.reason) || "blocked"
              }`,
            );
            error.code = "youtube_private_prestage_upload_blocked";
            throw error;
          }
          observedExternalId = text(
            uploaded?.externalId || uploaded?.videoId,
          );
          return {
            externalId: observedExternalId,
            externalUrl:
              text(uploaded?.externalUrl || uploaded?.url) || null,
          };
          },
        });
      } catch (error) {
        error.createAttemptStarted =
          error.createAttemptStarted === true ||
          createAttemptStarted;
        error.platformContacted =
          error.platformContacted === true ||
          platformContacted;
        error.externalId =
          text(error.externalId || observedExternalId) ||
          null;
        throw error;
      }
      assertLeaseHealthy();
      return result;
    },
  });
}

async function verifyExactGovernedYoutubePrivatePrestage(
  input = {},
) {
  const binding = normaliseExactYoutubeStagedBinding(
    input.exactStagedBinding || input.binding,
    { channelId: input.channelId },
  );
  const repos = resolveRepos(input.repos);
  const clock = trustedClock(
    input.irreversibleBoundaryNow || input.now,
  );
  const runWithPublisherLease =
    input.runWithPublisherLease || defaultRunWithPublisherLease;
  return requiredFunction(
    runWithPublisherLease,
    "publisher_lease_runner_required",
  )({
    leases: input.leases || repos.runtimeLeases,
    channelId: binding.channelId,
    operation:
      "verify_governed_youtube_private_prestage",
    ownerId: input.ownerId,
    leaseMs: input.leaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    metadata: {
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      request_fingerprint: binding.requestFingerprint,
      runway_lock_sha256: binding.runwayLockSha256,
      external_create_authority: "none",
      verification_only: true,
    },
    log: input.log || (() => {}),
    task: async ({ assertHealthy }) => {
      const assertLeaseHealthy = requiredFunction(
        assertHealthy,
        "youtube_private_prestage_lease_assertion_required",
      );
      assertLeaseHealthy();
      assertAdapterRepos(repos);
      await requiredFunction(
        input.assertLiveControlHealthy ||
          assertLiveControlHealthy,
        "youtube_live_control_assertion_required",
      )({
        repos,
        env: input.env || process.env,
        now: clock(),
        phase: "entry",
        binding,
      });
      assertLeaseHealthy();
      await loadExactStory(repos, binding);
      const ticket = readExactScheduledYoutubeTicket({
        governance: repos.publicationGovernance,
        binding,
        validatePublicationEvidence:
          input.validatePublicationEvidence ||
          defaultValidatePublicationEvidence,
      });
      const reportAuthTelemetry =
        input.reportAuthTelemetry ||
        defaultReportAuthTelemetry;
      const createAuthenticatedClient =
        authenticatedClientFactory(
          input,
          reportAuthTelemetry,
        );
      let youtubeClientPromise = null;
      const getYoutubeClient = () => {
        if (!youtubeClientPromise) {
          youtubeClientPromise = Promise.resolve().then(
            () => createAuthenticatedClient(),
          );
        }
        return youtubeClientPromise;
      };
      let privateVerifierPromise = null;
      const verifyPrivate = async (candidate) => {
        if (!privateVerifierPromise) {
          privateVerifierPromise =
            getYoutubeClient().then((youtubeClient) =>
              requiredFunction(
                input.createYoutubePrivateObjectVerifier ||
                  require("./youtube-private-object-verifier")
                    .createYoutubePrivateObjectVerifier,
                "youtube_private_object_verifier_factory_required",
              )({
                youtubeClient,
                now: clock,
                ...(input.privateVerifierOptions || {}),
              }),
            );
        }
        const verifier = await privateVerifierPromise;
        return requiredFunction(
          verifier,
          "youtube_private_object_verifier_required",
        )(candidate);
      };
      let containmentDisarmerPromise = null;
      const containUnexpectedObject =
        input.containUnexpectedObject ||
        (async (candidate) => {
          const externalId = text(
            candidate.externalId ||
              candidate.external_id,
          );
          const containmentReason = text(
            candidate.containmentReason ||
              candidate.containment_reason,
          );
          if (!externalId) {
            fail(
              "youtube_pre_t15_containment_external_id_required",
            );
          }
          if (!containmentReason) {
            fail(
              "youtube_pre_t15_containment_reason_required",
            );
          }
          if (!containmentDisarmerPromise) {
            containmentDisarmerPromise =
              getYoutubeClient().then((youtubeClient) =>
                requiredFunction(
                  input.createYoutubeScheduledObjectDisarmer ||
                    require("./youtube-scheduled-object-disarmer")
                      .createYoutubeScheduledObjectDisarmer,
                  "youtube_schedule_disarmer_factory_required",
                )({
                  youtubeClient,
                  now: clock,
                  ...(input.disarmerOptions || {}),
                }),
              );
          }
          const disarmer =
            await containmentDisarmerPromise;
          let updateAttemptStarted = false;
          const verification = await requiredFunction(
            disarmer,
            "youtube_schedule_disarmer_required",
          )({
            ...candidate,
            emergencyContainment: true,
            containmentReason,
            async assertUpdateBoundary() {
              assertLeaseHealthy();
              await requiredFunction(
                candidate.assertUpdateBoundary,
                "youtube_pre_t15_containment_boundary_required",
              )();
              assertLeaseHealthy();
              await loadExactStory(repos, binding);
              const currentTicket =
                readExactScheduledYoutubeTicket({
                  governance:
                    repos.publicationGovernance,
                  binding,
                  validatePublicationEvidence:
                    input.validatePublicationEvidence ||
                    defaultValidatePublicationEvidence,
                });
              assertSameExactScheduledYoutubeTicket(
                ticket,
                currentTicket,
              );
              const currentState =
                repos.publicationGovernance.getState(
                  binding.storyId,
                  "youtube",
                );
              const exactPost = exactDisarmPlatformPost({
                platformPosts: repos.platformPosts,
                binding,
                state: currentState,
              });
              if (exactPost.externalId !== externalId) {
                fail(
                  "youtube_pre_t15_containment_identity_mismatch",
                );
              }
              resolveExactScheduledDisarmBinding({
                governance:
                  repos.publicationGovernance,
                binding,
                externalId,
                now: clock(),
              });
              const authority = await requiredFunction(
                input.assertRemoteDisarmAuthority ||
                  assertRemoteDisarmAuthority,
                "youtube_remote_disarm_authority_required",
              )({
                repos,
                env: input.env || process.env,
                now: clock(),
                phase:
                  "pre_t15_emergency_containment_boundary",
                binding,
                reason: containmentReason,
              });
              requiredFunction(
                repos.publicationGovernance
                  .recordScheduledPlatformDisarmRequested,
                "youtube_schedule_disarm_request_recorder_required",
              ).call(
                repos.publicationGovernance,
                {
                  storyId: binding.storyId,
                  channelId: binding.channelId,
                  platform: "youtube",
                  idempotencyKey:
                    binding.idempotencyKey,
                  externalId,
                  scheduledFor:
                    binding.scheduledFor,
                  requestFingerprint:
                    binding.requestFingerprint,
                  runwayLockSha256:
                    binding.runwayLockSha256,
                  disarmEvidence: {
                    schema_version:
                      "pulse-youtube-schedule-disarm-request-v1",
                    schedule_disarm_requested: true,
                    emergency_containment: true,
                    external_id: externalId,
                    requested_at:
                      clock().toISOString(),
                    authority,
                    reason: containmentReason,
                  },
                  now: clock(),
                },
              );
              assertLeaseHealthy();
            },
            markUpdateAttemptStarted() {
              updateAttemptStarted = true;
              if (
                typeof candidate.markUpdateAttemptStarted ===
                "function"
              ) {
                candidate.markUpdateAttemptStarted();
              }
            },
          });
          assertLeaseHealthy();
          if (
            verification?.confirmed !== true ||
            verification?.emergencyContainment !== true ||
            verification?.compensationConfirmed !== true ||
            text(verification.externalId) !== externalId ||
            verification?.evidence
              ?.schedule_disarm_confirmed !== true
          ) {
            fail(
              "youtube_pre_t15_containment_exact_verification_required",
            );
          }
          const finalised = runImmediateTransaction(
            repos.db,
            () => {
              const confirmed =
                requiredFunction(
                  repos.publicationGovernance
                    .recordScheduledPlatformDisarmed,
                  "youtube_schedule_disarm_confirmation_recorder_required",
                ).call(
                  repos.publicationGovernance,
                  {
                    storyId: binding.storyId,
                    channelId: binding.channelId,
                    platform: "youtube",
                    idempotencyKey:
                      binding.idempotencyKey,
                    externalId,
                    scheduledFor:
                      binding.scheduledFor,
                    requestFingerprint:
                      binding.requestFingerprint,
                    runwayLockSha256:
                      binding.runwayLockSha256,
                    verifiedAt:
                      verification.verifiedAt ||
                      verification.evidence
                        .checked_at,
                    verificationEvidence:
                      verification.evidence,
                    now: clock(),
                  },
                );
              const platformPost =
                exactDisarmPlatformPost({
                  platformPosts:
                    repos.platformPosts,
                  binding,
                  state: confirmed,
                }).platformPost;
              const blocked = requiredFunction(
                repos.platformPosts.markBlocked,
                "youtube_schedule_disarm_platform_post_blocker_required",
              ).call(
                repos.platformPosts,
                platformPost.id,
                "youtube_pre_t15_emergency_containment",
              );
              if (!blocked) {
                fail(
                  "youtube_schedule_disarm_platform_projection_failed",
                );
              }
              return { confirmed, blocked };
            },
          );
          assertLeaseHealthy();
          return {
            ...verification,
            updateAttemptStarted:
              verification.updateAttemptStarted === true ||
              updateAttemptStarted,
            governanceState: finalised.confirmed,
            platformPost: finalised.blocked,
          };
        });
      const verifyGovernedYoutubePrivatePrestage =
        input.verifyGovernedYoutubePrivatePrestage ||
        require("./governed-youtube-private-prestage")
          .verifyGovernedYoutubePrivatePrestage;
      const result = await requiredFunction(
        verifyGovernedYoutubePrivatePrestage,
        "youtube_private_prestage_verification_service_required",
      )({
        db: repos.db,
        platformPosts: repos.platformPosts,
        governance: repos.publicationGovernance,
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        scheduledFor: binding.scheduledFor,
        requestFingerprint: binding.requestFingerprint,
        runwayLockSha256: binding.runwayLockSha256,
        now: clock(),
        assertLeaseHealthy,
        verifyPrivate,
        containUnexpectedObject,
      });
      assertLeaseHealthy();
      return result;
    },
  });
}

async function armExactGovernedYoutubeScheduledRelease(
  input = {},
) {
  const binding = normaliseExactYoutubeStagedBinding(
    input.exactStagedBinding || input.binding,
    { channelId: input.channelId },
  );
  const repos = resolveRepos(input.repos);
  const clock = trustedClock(
    input.irreversibleBoundaryNow || input.now,
  );
  const {
    validateYouTubeAccountBindingProof,
  } = require("./youtube-account-binding-verifier");
  const expectedYoutubeChannelId = text(
    input.expectedYoutubeChannelId ||
      input.expected_youtube_channel_id,
  );
  const configuredOAuthClientSha256 = sha256(
    input.configuredOAuthClientSha256 ||
      input.configured_oauth_client_sha256,
  );
  const suppliedAccountBindingProof =
    input.youtubeAccountBindingProof ||
    input.youtube_account_binding_proof;
  if (
    (input.youtubeAccountBindingVerified === true ||
      input.youtube_account_binding_verified === true) &&
    !suppliedAccountBindingProof
  ) {
    fail("youtube_account_binding_proof_required");
  }
  let youtubeAccountBoundSession = null;
  let accountBindingProof = null;
  const assertFreshAccountBindingProof = () => {
    if (youtubeAccountBoundSession) {
      accountBindingProof =
        youtubeAccountBoundSession.getBindingProof();
      return accountBindingProof;
    }
    accountBindingProof = validateYouTubeAccountBindingProof(
      suppliedAccountBindingProof,
      {
        expectedChannelId: expectedYoutubeChannelId,
        configuredOAuthClientSha256,
        now: clock,
      },
    ).value;
    return accountBindingProof;
  };
  if (suppliedAccountBindingProof) {
    assertFreshAccountBindingProof();
  }
  const runWithPublisherLease =
    input.runWithPublisherLease || defaultRunWithPublisherLease;
  return requiredFunction(
    runWithPublisherLease,
    "publisher_lease_runner_required",
  )({
    leases: input.leases || repos.runtimeLeases,
    channelId: binding.channelId,
    operation: "arm_governed_youtube_scheduled_release",
    ownerId: input.ownerId,
    leaseMs: input.leaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    metadata: {
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      request_fingerprint: binding.requestFingerprint,
      runway_lock_sha256: binding.runwayLockSha256,
      external_create_authority: "none",
      remote_mutation: "set_publish_at_once",
    },
    log: input.log || (() => {}),
    task: async ({ assertHealthy }) => {
      const assertLeaseHealthy = requiredFunction(
        assertHealthy,
        "youtube_schedule_arm_lease_assertion_required",
      );
      assertLeaseHealthy();
      assertAdapterRepos(repos);
      const assertCurrentLiveControl =
        input.assertLiveControlHealthy ||
        assertLiveControlHealthy;
      const entryControl = await requiredFunction(
        assertCurrentLiveControl,
        "youtube_live_control_assertion_required",
      )({
        repos,
        env: input.env || process.env,
        now: clock(),
        phase: "entry",
        binding,
      });
      assertLeaseHealthy();
      await loadExactStory(repos, binding);
      const validatePublicationEvidence =
        input.validatePublicationEvidence ||
        defaultValidatePublicationEvidence;
      const initialTicket = readExactScheduledYoutubeTicket({
        governance: repos.publicationGovernance,
        binding,
        validatePublicationEvidence,
      });
      const {
        createOfficialSourceRevalidator,
        validateOfficialSourceRevalidationReceipt:
          defaultValidateOfficialSourceRevalidationReceipt,
        validateOfficialSourceReleaseBinding,
      } = require("./official-source-revalidation");
      const sourceReleaseBinding =
        validateOfficialSourceReleaseBinding(
          initialTicket.publicationEvidence
            .official_source_release_binding,
          {
            storyId: binding.storyId,
            sourceEvidenceSha256:
              initialTicket.publicationEvidence
                .source_evidence_sha256,
          },
        ).value;
      const expectedSourceRevisionSha256 =
        sourceReleaseBinding.source_revision_sha256;
      const suppliedSourceRevision = text(
        input.expectedSourceRevisionSha256 ||
          input.expected_source_revision_sha256,
      );
      if (
        suppliedSourceRevision &&
        sha256(suppliedSourceRevision) !==
          expectedSourceRevisionSha256
      ) {
        fail(
          "youtube_tminus15_payload_source_revision_mismatch",
        );
      }
      const rawOfficialSourceRevalidator =
        input.revalidateOfficialSource ||
        createOfficialSourceRevalidator({
          fetchCapture: input.fetchOfficialSource,
          now: clock,
          ...(input.officialSourceRevalidatorOptions || {}),
        });
      const validateOfficialSourceRevalidationReceipt =
        input.validateOfficialSourceRevalidationReceipt ||
        defaultValidateOfficialSourceRevalidationReceipt;
      const revalidateOfficialSource =
        async (candidate = {}) => {
          const receipt = await requiredFunction(
            rawOfficialSourceRevalidator,
            "youtube_official_source_revalidator_required",
          )({
            ...candidate,
            binding: sourceReleaseBinding,
            storyId: binding.storyId,
            platform: "youtube",
            externalId: candidate.externalId,
            scheduledFor: binding.scheduledFor,
            requestFingerprint:
              binding.requestFingerprint,
            runwayLockSha256:
              binding.runwayLockSha256,
          });
          return requiredFunction(
            validateOfficialSourceRevalidationReceipt,
            "youtube_official_source_receipt_validator_required",
          )(receipt, {
            binding: sourceReleaseBinding,
            storyId: binding.storyId,
            platform: "youtube",
            externalId: candidate.externalId,
            scheduledFor: binding.scheduledFor,
            requestFingerprint:
              binding.requestFingerprint,
            runwayLockSha256:
              binding.runwayLockSha256,
          }).value;
        };
      const assertExactPrivateProof = () => {
        const state = repos.publicationGovernance.getState(
          binding.storyId,
          "youtube",
        );
        const externalId = text(state?.external_id);
        if (!externalId) {
          fail(
            "youtube_private_unscheduled_external_id_required",
          );
        }
        return requiredFunction(
          repos.publicationGovernance
            .assertPrivateUnscheduledPlatformObjectBinding,
          "youtube_private_unscheduled_proof_assertion_required",
        ).call(repos.publicationGovernance, {
          storyId: binding.storyId,
          channelId: binding.channelId,
          platform: "youtube",
          idempotencyKey: binding.idempotencyKey,
          externalId,
          scheduledFor: binding.scheduledFor,
          requestFingerprint: binding.requestFingerprint,
          runwayLockSha256: binding.runwayLockSha256,
          now: clock(),
        });
      };
      const initialPrivateProof = assertExactPrivateProof();
      const reportAuthTelemetry =
        input.reportAuthTelemetry ||
        defaultReportAuthTelemetry;
      youtubeAccountBoundSession =
        await createYoutubeAccountBoundSessionInsideLease(
          input,
          {
            now: clock,
            reportAuthTelemetry,
            assertLeaseHealthy,
          },
        );
      const sessionAccountBindingProof =
        assertFreshAccountBindingProof();
      if (
        suppliedAccountBindingProof &&
        sessionAccountBindingProof.proof_sha256 !==
          suppliedAccountBindingProof.proof_sha256
      ) {
        fail(
          "youtube_account_bound_session_proof_mismatch",
        );
      }
      const youtubeClient =
        youtubeAccountBoundSession.getYoutubeClient();
      const getYoutubeClient = async () => youtubeClient;
      let armerPromise = null;
      const getArmer = () => {
        if (!armerPromise) {
          armerPromise = getYoutubeClient().then((youtubeClient) =>
            requiredFunction(
              input.createYoutubeScheduledObjectArmer ||
                require("./youtube-scheduled-object-armer")
                  .createYoutubeScheduledObjectArmer,
              "youtube_schedule_armer_factory_required",
            )({
              youtubeClient,
              now: clock,
              ...(input.scheduleArmerOptions || {}),
            }),
          );
        }
        return armerPromise;
      };
      let verifierPromise = null;
      const getVerifier = () => {
        if (!verifierPromise) {
          verifierPromise = getYoutubeClient().then(
            (youtubeClient) =>
              requiredFunction(
                input.createYoutubeScheduledObjectVerifier ||
                  require("./youtube-scheduled-object-verifier")
                    .createYoutubeScheduledObjectVerifier,
                "youtube_scheduled_object_verifier_factory_required",
              )({
                youtubeClient,
                now: clock,
                ...(input.scheduledVerifierOptions || {}),
              }),
          );
        }
        return verifierPromise;
      };
      let boundaryControl = null;
      const armScheduled = async (candidate = {}) => {
        const armer = await getArmer();
        const assertSourceBoundary = requiredFunction(
          candidate.assertUpdateBoundary,
          "youtube_schedule_arm_source_boundary_required",
        );
        return requiredFunction(
          armer,
          "youtube_schedule_armer_required",
        )({
          ...candidate,
          async assertUpdateBoundary() {
            assertLeaseHealthy();
            await loadExactStory(repos, binding);
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
            const currentPrivateProof =
              assertExactPrivateProof();
            if (
              text(currentPrivateProof.externalId) !==
                text(initialPrivateProof.externalId) ||
              Number(
                currentPrivateProof.privateUnscheduledEventId,
              ) !==
                Number(
                  initialPrivateProof.privateUnscheduledEventId,
                )
            ) {
              fail(
                "youtube_private_unscheduled_proof_changed_before_arm",
              );
            }
            boundaryControl = await assertCurrentLiveControl({
              repos,
              env: input.env || process.env,
              now: clock(),
              phase: "schedule_arm_boundary",
              binding,
            });
            assertLeaseHealthy();
            await assertSourceBoundary();
            assertLeaseHealthy();
            await youtubeAccountBoundSession.revalidate();
            assertLeaseHealthy();
            boundaryControl =
              await assertCurrentLiveControl({
                repos,
                env: input.env || process.env,
                now: clock(),
                phase:
                  "schedule_arm_post_source_boundary",
                binding,
              });
            assertLeaseHealthy();
            assertFreshAccountBindingProof();
          },
        });
      };
      const verifyScheduled = async (candidate) => {
        const verifier = await getVerifier();
        return requiredFunction(
          verifier,
          "youtube_scheduled_object_verifier_required",
        )(candidate);
      };
      const persistScheduledRelease = ({
        recordPlatformScheduledInput,
        externalId,
        verification,
        sourceRevalidation,
        armResult,
      } = {}) => {
        assertLeaseHealthy();
        const commitmentAccountBindingProof =
          assertFreshAccountBindingProof();
        return runImmediateTransaction(repos.db, () => {
          const governanceState = requiredFunction(
            repos.publicationGovernance
              .recordPlatformScheduled,
            "youtube_platform_scheduled_recorder_required",
          ).call(
            repos.publicationGovernance,
            recordPlatformScheduledInput,
          );
          const releaseCommitment =
            recordExactScheduledReleaseCommitment({
              governance: repos.publicationGovernance,
              binding,
              externalId,
              verification: {
                ...verification,
                evidence: {
                  ...(verification?.evidence || {}),
                  source_revalidation:
                    sourceRevalidation || null,
                  schedule_arm_proof:
                    armResult?.evidence || null,
                  youtube_account_binding_proof:
                    commitmentAccountBindingProof,
                },
              },
              controlEvidence: {
                ...boundaryControl,
                entry_control: entryControl,
                source_revalidation:
                  sourceRevalidation || null,
                schedule_arm_proof:
                  armResult?.evidence || null,
                youtube_account_binding_proof:
                  commitmentAccountBindingProof,
              },
              now: clock(),
            });
          return {
            governanceState,
            releaseCommitment,
          };
        });
      };
      const armGovernedYoutubeScheduledRelease =
        input.armGovernedYoutubeScheduledRelease ||
        require("./governed-youtube-private-prestage")
          .armGovernedYoutubeScheduledRelease;
      const result = await requiredFunction(
        armGovernedYoutubeScheduledRelease,
        "youtube_schedule_arm_service_required",
      )({
        db: repos.db,
        platformPosts: repos.platformPosts,
        governance: repos.publicationGovernance,
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        scheduledFor: binding.scheduledFor,
        requestFingerprint: binding.requestFingerprint,
        runwayLockSha256: binding.runwayLockSha256,
        expectedSourceRevisionSha256,
        now: clock,
        assertLeaseHealthy,
        armScheduled,
        verifyScheduled,
        revalidateOfficialSource,
        persistScheduledRelease,
      });
      assertLeaseHealthy();
      if (
        result?.scheduled !== true ||
        result?.releaseArmed !== true
      ) {
        return result;
      }
      assertFreshAccountBindingProof();
      const externalId = text(result.externalId);
      const commitment = result.releaseCommitment ||
        (result.reused === true
          ? assertExactScheduledReleaseCommitment({
              governance:
                repos.publicationGovernance,
              binding,
              externalId,
              now: clock(),
            })
          : null);
      if (!commitment) {
        fail(
          "youtube_schedule_arm_atomic_persistence_required",
        );
      }
      assertLeaseHealthy();
      return withReleaseCommitment(result, commitment);
    },
  });
}

async function confirmExactGovernedYoutubeScheduledRelease(
  input = {},
) {
  const binding = normaliseExactYoutubeStagedBinding(
    input.exactStagedBinding || input.binding,
    { channelId: input.channelId },
  );
  const repos = resolveRepos(input.repos);
  const clock = trustedClock(input.now);
  const runWithPublisherLease =
    input.runWithPublisherLease || defaultRunWithPublisherLease;
  return requiredFunction(
    runWithPublisherLease,
    "publisher_lease_runner_required",
  )({
    leases: input.leases || repos.runtimeLeases,
    channelId: binding.channelId,
    operation: "confirm_governed_youtube_scheduled_release",
    ownerId: input.ownerId,
    leaseMs: input.leaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
    metadata: {
      story_id: binding.storyId,
      scheduled_event_id: binding.scheduledEventId,
      scheduled_for: binding.scheduledFor,
      request_fingerprint: binding.requestFingerprint,
      runway_lock_sha256: binding.runwayLockSha256,
      external_create_authority: "none",
      verification_only: true,
    },
    log: input.log || (() => {}),
    task: async ({ assertHealthy }) => {
      const assertLeaseHealthy = requiredFunction(
        assertHealthy,
        "youtube_private_prestage_lease_assertion_required",
      );
      assertLeaseHealthy();
      assertAdapterRepos(repos);
      await loadExactStory(repos, binding);
      readExactScheduledYoutubeTicket({
        governance: repos.publicationGovernance,
        binding,
        validatePublicationEvidence:
          input.validatePublicationEvidence ||
          defaultValidatePublicationEvidence,
      });
      const reportAuthTelemetry =
        input.reportAuthTelemetry || defaultReportAuthTelemetry;
      const lazyVerifyPublic =
        typeof input.verifyPublic === "function"
          ? input.verifyPublic
          : createLazyAuthenticatedVerifier({
              createAuthenticatedClient:
                authenticatedClientFactory(
                  input,
                  reportAuthTelemetry,
                ),
              createVerifier:
                input.createYoutubePublicObjectVerifier ||
                require("./youtube-public-object-verifier")
                  .createYoutubePublicObjectVerifier,
              verifierOptions: {
                now: clock,
                ...(input.publicVerifierOptions || {}),
              },
            });
      const verifyPublic = async (candidate) => {
        const externalId = text(candidate?.externalId);
        if (!externalId) {
          fail(
            "youtube_release_commitment_external_id_required",
          );
        }
        assertExactScheduledReleaseCommitment({
          governance: repos.publicationGovernance,
          binding,
          externalId,
          now: clock(),
        });
        assertLeaseHealthy();
        return lazyVerifyPublic(candidate);
      };
      const confirmGovernedYoutubeScheduledRelease =
        input.confirmGovernedYoutubeScheduledRelease ||
        require("./governed-youtube-private-prestage")
          .confirmGovernedYoutubeScheduledRelease;
      const result = await requiredFunction(
        confirmGovernedYoutubeScheduledRelease,
        "youtube_scheduled_release_confirmation_service_required",
      )({
        db: repos.db,
        platformPosts: repos.platformPosts,
        governance: repos.publicationGovernance,
        storyId: binding.storyId,
        channelId: binding.channelId,
        platform: "youtube",
        idempotencyKey: binding.idempotencyKey,
        scheduledFor: binding.scheduledFor,
        requestFingerprint: binding.requestFingerprint,
        runwayLockSha256: binding.runwayLockSha256,
        now: clock(),
        assertLeaseHealthy,
        verifyPublic,
      });
      assertLeaseHealthy();
      return result;
    },
  });
}

module.exports = {
  armExactGovernedYoutubeScheduledRelease,
  assertLiveControlHealthy,
  assertRemoteDisarmAuthority,
  assertSameExactScheduledYoutubeTicket,
  confirmExactGovernedYoutubeScheduledRelease,
  createAuthenticatedYoutubeClient,
  createLazyAuthenticatedVerifier,
  disarmExactGovernedYoutubeScheduledRelease,
  normaliseExactYoutubeStagedBinding,
  prestageExactGovernedYoutubeRelease,
  readExactScheduledYoutubeTicket,
  validateExactApprovedYoutubeStory,
  verifyExactGovernedYoutubePrivatePrestage,
};
