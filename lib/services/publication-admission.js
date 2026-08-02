"use strict";

const {
  fingerprintPublicationRequest,
  sha256Text,
} = require("./publication-request-fingerprint");
const {
  resolveOperatingContract,
} = require("../stabilisation/operating-contract");
const { assessPublicationEvidence } = require("./publication-evidence-gates");
const {
  evaluateRendererManifest,
} = require("../stabilisation/renderer-governance");
const {
  GovernedPublicationMetadataError,
  YOUTUBE_PLATFORM_CONTRACT,
  validateGovernedPublicationMetadata,
} = require("./governed-publication-metadata");
const {
  youtubeReleaseJobIdempotencyKey,
} = require("./governed-publication-job-identity");
const {
  validateOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");
const {
  AUTHORITY_SCOPE: AUTONOMOUS_AUTHORITY_SCOPE,
  AUTHORITY_TYPE: AUTONOMOUS_AUTHORITY_TYPE,
  MAX_CONTROL_AGE_MS: AUTONOMOUS_MAX_CONTROL_AGE_MS,
  MAX_REPORT_AGE_MS: AUTONOMOUS_MAX_REPORT_AGE_MS,
  VERIFIER_ID: AUTONOMOUS_AUTHORITY_VERIFIER_ID,
} = require("./autonomous-official-publication-authority");
const {
  validateControlledExperimentObservation,
} = require("./controlled-experiment-observation");

const ADMISSION_WINDOW_DRIFT_MS = 90 * 60 * 1000;
const ADMISSION_LATE_TOLERANCE_MS = 60 * 1000;
const GUARDED_UTC_HOURS = new Set([9, 19]);
const OUTSIDE_CADENCE_AUTHORISATION_SCHEMA =
  "pulse-outside-cadence-authorisation-v1";

function text(value) {
  return String(value || "").trim();
}

function parseStoryExtra(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return structuredClone(value);
  }
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normaliseDispatchJobSpec(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("publication_dispatch_job_spec_invalid");
  }
  const laneId = text(value.laneId);
  if (!laneId) {
    throw new Error("publication_dispatch_lane_id_required");
  }
  const priority = Number(value.priority);
  if (!Number.isInteger(priority) || priority < 0) {
    throw new Error("publication_dispatch_priority_invalid");
  }
  const maxAttempts =
    value.maxAttempts === undefined ? 3 : Number(value.maxAttempts);
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("publication_dispatch_max_attempts_invalid");
  }
  const promotedReserve = value.promotedReserve === true;
  const promotionSha256 = text(value.promotionSha256).toLowerCase();
  const promotionAuthorityType = promotedReserve
    ? text(
        value.promotionAuthorityType || "ZERO_CONTACT_PRE_CREATE",
      ).toUpperCase()
    : null;
  const prestageRunAt = value.prestageRunAt
    ? new Date(value.prestageRunAt)
    : null;
  if (
    promotedReserve &&
    (!sha256(promotionSha256) ||
      !prestageRunAt ||
      Number.isNaN(prestageRunAt.getTime()) ||
      !["ZERO_CONTACT_PRE_CREATE", "CONFIRMED_DISARM_FAILOVER"].includes(
        promotionAuthorityType,
      ))
  ) {
    throw new Error("publication_promoted_reserve_timing_binding_invalid");
  }
  if (
    !promotedReserve &&
    (promotionSha256 || prestageRunAt || text(value.promotionAuthorityType))
  ) {
    throw new Error("publication_promoted_reserve_authority_required");
  }
  return {
    laneId,
    priority,
    maxAttempts,
    promotedReserve,
    promotionSha256: promotedReserve ? promotionSha256 : null,
    promotionAuthorityType,
    prestageRunAt: promotedReserve ? prestageRunAt.toISOString() : null,
  };
}

function buildImmutablePublicationEvidence({
  evidence = {},
  evidenceAssessment = null,
  rendererEvaluation = null,
  operatingMode = "LOCAL_PROOF",
  controlledExperimentExpectedIdentity = null,
  controlledExperimentExpectedBindings = null,
} = {}) {
  const assessedEvidence =
    evidenceAssessment || assessPublicationEvidence(evidence);
  const assessedRenderer =
    rendererEvaluation ||
    evaluateRendererManifest(evidence?.renderer_manifest, {
      operatingMode,
    });
  const publicationMetadata = evidence?.publication_metadata;
  const officialSourceReleaseBinding = validateOfficialSourceReleaseBinding(
    evidence?.official_source_release_binding,
    {
      sourceEvidenceSha256: evidence?.source_evidence_sha256,
    },
  ).value;
  const controlledExperimentObservation =
    evidence?.controlled_experiment_observation === undefined
      ? null
      : validateControlledExperimentObservation(
          evidence.controlled_experiment_observation,
          {
            expectedIdentity:
              controlledExperimentExpectedIdentity,
            expectedBindings:
              controlledExperimentExpectedBindings,
          },
        ).observation;
  return {
    schema_version: "pulse-publication-evidence-v1",
    source_evidence_sha256: text(evidence?.source_evidence_sha256),
    official_source_release_binding: officialSourceReleaseBinding,
    qa_report_sha256: text(evidence?.qa_report_sha256),
    publication_metadata_sha256: text(
      evidence?.publication_metadata_sha256,
    ).toLowerCase(),
    publication_metadata:
      publicationMetadata &&
      typeof publicationMetadata === "object" &&
      !Array.isArray(publicationMetadata)
        ? {
            path: text(publicationMetadata.path),
            sha256: text(publicationMetadata.sha256).toLowerCase(),
            platform: text(publicationMetadata.platform),
            title: text(publicationMetadata.title),
            description: text(publicationMetadata.description),
          }
        : null,
    originality_transformation:
      assessedEvidence.stateEvidence.ASSETS_CLEARED.originality_transformation,
    rights_ledger_sha256:
      assessedEvidence.stateEvidence.ASSETS_CLEARED.rights_ledger_sha256,
    synthetic_media_disclosure:
      assessedEvidence.stateEvidence.HUMAN_APPROVED.synthetic_media_disclosure,
    renderer_manifest_sha256: assessedRenderer.manifest_sha256,
    renderer: assessedRenderer.renderer,
    ...(controlledExperimentObservation
      ? {
          controlled_experiment_observation:
            controlledExperimentObservation,
        }
      : {}),
  };
}

function controlledExperimentExpectedEvidence({
  story,
  channelId,
  evidence,
  rendererEvaluation,
} = {}) {
  if (
    evidence?.controlled_experiment_observation ===
    undefined
  ) {
    return {};
  }
  return {
    controlledExperimentExpectedIdentity: {
      story_id: text(story?.id),
      channel_id: text(channelId),
    },
    controlledExperimentExpectedBindings: {
      story_intake_sha256: text(
        evidence?.story_intake_sha256,
      ).toLowerCase(),
      narration_manifest_sha256: text(
        evidence?.narration_manifest_sha256,
      ).toLowerCase(),
      renderer_manifest_file_sha256: text(
        evidence?.renderer_manifest_file_sha256,
      ).toLowerCase(),
      renderer_manifest_canonical_sha256: text(
        rendererEvaluation?.manifest_sha256,
      ).toLowerCase(),
      qa_report_sha256: text(
        evidence?.qa_report_sha256,
      ).toLowerCase(),
      media_sha256: text(
        evidence?.renderer_manifest?.output?.sha256,
      ).toLowerCase(),
      script_sha256: sha256Text(
        story?.full_script || "",
      ),
    },
  };
}

function sha256(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function isGuardedUtcSchedule(schedule) {
  return (
    !Number.isNaN(schedule.getTime()) &&
    GUARDED_UTC_HOURS.has(schedule.getUTCHours()) &&
    schedule.getUTCMinutes() === 0 &&
    schedule.getUTCSeconds() === 0 &&
    schedule.getUTCMilliseconds() === 0
  );
}

function normaliseOutsideCadenceAuthorisation(value) {
  return {
    authorisation_id: text(value?.authorisationId),
    confirmed_authorisation_id: text(value?.confirmAuthorisationId),
    one_shot: value?.oneShotConfirmed === true,
  };
}

function outsideCadenceAuthorisationPayload(value = {}) {
  return {
    schema_version: text(value.schema_version),
    authorisation_id: text(value.authorisation_id),
    confirmed_authorisation_id: text(value.confirmed_authorisation_id),
    one_shot: value.one_shot === true,
    basis: text(value.basis),
    story_id: text(value.story_id),
    channel_id: text(value.channel_id),
    platform: text(value.platform),
    scheduled_for: text(value.scheduled_for),
    authorised_at: text(value.authorised_at),
    dispatch_idempotency_key: text(value.dispatch_idempotency_key),
    request_fingerprint: text(value.request_fingerprint).toLowerCase(),
  };
}

function fingerprintOutsideCadenceAuthorisation(value) {
  return sha256Text(JSON.stringify(outsideCadenceAuthorisationPayload(value)));
}

function persistedOutsideCadenceAuthorisation(value, binding = {}) {
  const normalised = normaliseOutsideCadenceAuthorisation(value);
  if (
    !normalised.authorisation_id ||
    normalised.confirmed_authorisation_id !== normalised.authorisation_id ||
    normalised.one_shot !== true
  ) {
    return null;
  }
  const persisted = {
    schema_version: OUTSIDE_CADENCE_AUTHORISATION_SCHEMA,
    authorisation_id: normalised.authorisation_id,
    confirmed_authorisation_id: normalised.confirmed_authorisation_id,
    one_shot: true,
    basis: "explicit_operator_goal_authorisation",
    story_id: text(binding.storyId),
    channel_id: text(binding.channelId),
    platform: text(binding.platform),
    scheduled_for: text(binding.scheduledFor),
    authorised_at: text(binding.authorisedAt),
    dispatch_idempotency_key: text(binding.dispatchIdempotencyKey),
    request_fingerprint: text(binding.requestFingerprint).toLowerCase(),
  };
  return {
    ...persisted,
    binding_sha256: fingerprintOutsideCadenceAuthorisation(persisted),
  };
}

function validatePersistedOutsideCadenceAuthorisation(
  value,
  {
    storyId,
    channelId,
    platform,
    scheduledFor,
    authorisedNoEarlierThan,
    authorisedNoLaterThan,
    now,
    dispatchIdempotencyKey,
    requestFingerprint,
  } = {},
) {
  const blockers = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["scheduled_outside_cadence_authorisation_required"];
  }
  const payload = outsideCadenceAuthorisationPayload(value);
  const expectedPairs = [
    [
      payload.schema_version,
      OUTSIDE_CADENCE_AUTHORISATION_SCHEMA,
      "scheduled_outside_cadence_authorisation_schema_invalid",
    ],
    [
      payload.story_id,
      text(storyId),
      "scheduled_outside_cadence_story_mismatch",
    ],
    [
      payload.channel_id,
      text(channelId),
      "scheduled_outside_cadence_channel_mismatch",
    ],
    [
      payload.platform,
      text(platform),
      "scheduled_outside_cadence_platform_mismatch",
    ],
    [
      payload.scheduled_for,
      text(scheduledFor),
      "scheduled_outside_cadence_time_mismatch",
    ],
    [
      payload.dispatch_idempotency_key,
      text(dispatchIdempotencyKey),
      "scheduled_outside_cadence_dispatch_key_mismatch",
    ],
    [
      payload.request_fingerprint,
      text(requestFingerprint).toLowerCase(),
      "scheduled_outside_cadence_request_fingerprint_mismatch",
    ],
  ];
  for (const [actual, expected, code] of expectedPairs) {
    if (!actual || actual !== expected) blockers.push(code);
  }
  if (!payload.authorisation_id) {
    blockers.push("scheduled_outside_cadence_authorisation_id_required");
  }
  if (payload.confirmed_authorisation_id !== payload.authorisation_id) {
    blockers.push(
      "scheduled_outside_cadence_authorisation_confirmation_mismatch",
    );
  }
  if (
    payload.one_shot !== true ||
    payload.basis !== "explicit_operator_goal_authorisation"
  ) {
    blockers.push("scheduled_outside_cadence_one_shot_invalid");
  }
  const authorisedAtMs = Date.parse(payload.authorised_at);
  const noEarlierThanMs = Date.parse(authorisedNoEarlierThan);
  const noLaterThanMs = Date.parse(authorisedNoLaterThan);
  const nowMs = Date.parse(now);
  if (
    !Number.isFinite(authorisedAtMs) ||
    !Number.isFinite(noEarlierThanMs) ||
    !Number.isFinite(noLaterThanMs) ||
    !Number.isFinite(nowMs)
  ) {
    blockers.push("scheduled_outside_cadence_authorised_at_invalid");
  } else {
    if (authorisedAtMs < noEarlierThanMs || authorisedAtMs > noLaterThanMs) {
      blockers.push("scheduled_outside_cadence_authorisation_stale");
    }
    if (authorisedAtMs > nowMs) {
      blockers.push("scheduled_outside_cadence_authorisation_in_future");
    }
  }
  if (
    !sha256(value.binding_sha256) ||
    text(value.binding_sha256).toLowerCase() !==
      fingerprintOutsideCadenceAuthorisation(payload)
  ) {
    blockers.push("scheduled_outside_cadence_binding_sha256_invalid");
  }
  return [...new Set(blockers)];
}

function admissionBlockers({
  story,
  actorId,
  reason,
  confirmationStoryId,
  scheduledFor,
  now,
  evidence,
  operatingContract,
  channelId,
  platform,
  evidenceAssessment,
  rendererEvaluation,
  outsideCadenceAuthorisation,
  runwayLockSha256,
}) {
  const blockers = [];
  if (!story) return ["publication_story_not_found"];
  if (text(confirmationStoryId) !== text(story.id)) {
    blockers.push("matching_story_confirmation_required");
  }
  if (!text(actorId)) blockers.push("operator_identity_required");
  if (!text(reason)) blockers.push("operator_reason_required");
  if (text(runwayLockSha256) && !sha256(text(runwayLockSha256).toLowerCase())) {
    blockers.push("runway_lock_sha256_invalid");
  }
  if ((story.channel_id || "pulse-gaming") !== channelId) {
    blockers.push("publication_story_channel_mismatch");
  }
  if (story.approved !== true && story.approved !== 1) {
    blockers.push("editorial_approval_required");
  }
  if (!text(story.full_script)) blockers.push("final_script_required");
  if (!text(story.exported_path)) blockers.push("final_render_required");
  if (story.qa_failed === true || story.publish_status === "failed") {
    blockers.push("story_has_unresolved_qa_failure");
  }
  if (text(story.youtube_post_id)) blockers.push("youtube_already_projected");
  for (const [field, code] of [
    ["source_evidence_sha256", "source_evidence_hash_required"],
    ["rights_ledger_sha256", "rights_ledger_hash_required"],
    ["qa_report_sha256", "qa_report_hash_required"],
  ]) {
    if (!sha256(evidence?.[field])) blockers.push(code);
  }
  try {
    validateOfficialSourceReleaseBinding(
      evidence?.official_source_release_binding,
      {
        storyId: story.id,
        sourceEvidenceSha256: evidence?.source_evidence_sha256,
      },
    );
  } catch (error) {
    blockers.push(
      text(error?.code || error?.message) ||
        "official_source_release_binding_required",
    );
  }
  const publicationMetadata = evidence?.publication_metadata;
  const publicationMetadataSha = text(
    evidence?.publication_metadata_sha256,
  ).toLowerCase();
  if (!sha256(publicationMetadataSha)) {
    blockers.push("publication_metadata_hash_required");
  }
  if (
    !publicationMetadata ||
    typeof publicationMetadata !== "object" ||
    Array.isArray(publicationMetadata)
  ) {
    blockers.push("publication_metadata_binding_required");
  } else {
    if (!text(publicationMetadata.path)) {
      blockers.push("publication_metadata_path_required");
    }
    if (!sha256(publicationMetadata.sha256)) {
      blockers.push("publication_metadata_binding_hash_required");
    } else if (
      sha256(publicationMetadataSha) &&
      text(publicationMetadata.sha256).toLowerCase() !== publicationMetadataSha
    ) {
      blockers.push("publication_metadata_hash_mismatch");
    }
    if (
      platform !== YOUTUBE_PLATFORM_CONTRACT.lifecyclePlatform ||
      text(publicationMetadata.platform) !==
        YOUTUBE_PLATFORM_CONTRACT.reviewedMetadataPlatform
    ) {
      blockers.push("publication_metadata_platform_mismatch");
    }
    if (!text(publicationMetadata.title)) {
      blockers.push("publication_metadata_title_required");
    }
    if (!text(publicationMetadata.description)) {
      blockers.push("publication_metadata_description_required");
    }
    if (
      sha256(publicationMetadataSha) &&
      sha256(publicationMetadata.sha256) &&
      text(publicationMetadata.path) &&
      text(publicationMetadata.title) &&
      text(publicationMetadata.description)
    ) {
      try {
        const validatedMetadata = validateGovernedPublicationMetadata({
          metadataPath: publicationMetadata.path,
          expectedMetadataSha256: publicationMetadataSha,
          expectedStoryId: story.id,
          expectedChannelId: channelId,
          expectedPlatform: YOUTUBE_PLATFORM_CONTRACT.reviewedMetadataPlatform,
          requireCanonicalAbsolutePath: true,
        });
        if (
          validatedMetadata.path !== text(publicationMetadata.path) ||
          validatedMetadata.sha256 !==
            text(publicationMetadata.sha256).toLowerCase() ||
          validatedMetadata.platform !== text(publicationMetadata.platform) ||
          validatedMetadata.title !== text(publicationMetadata.title) ||
          validatedMetadata.description !==
            text(publicationMetadata.description)
        ) {
          blockers.push("publication_metadata_binding_mismatch");
        }
      } catch (error) {
        if (error instanceof GovernedPublicationMetadataError) {
          blockers.push(...error.codes);
        } else {
          throw error;
        }
      }
    }
  }
  const assessedEvidence =
    evidenceAssessment || assessPublicationEvidence(evidence);
  blockers.push(...assessedEvidence.blockers);
  const assessedRenderer =
    rendererEvaluation ||
    evaluateRendererManifest(evidence?.renderer_manifest, {
      operatingMode: operatingContract?.mode,
    });
  if (!sha256(evidence?.renderer_manifest_sha256)) {
    blockers.push("renderer_manifest_hash_required");
  } else if (
    text(evidence.renderer_manifest_sha256).toLowerCase() !==
    assessedRenderer.manifest_sha256
  ) {
    blockers.push("renderer_manifest_hash_mismatch");
  }
  blockers.push(...assessedRenderer.blockers);
  if (
    assessedRenderer.verdict !== "PASS" ||
    assessedRenderer.publishable !== true
  ) {
    blockers.push("governed_standard_renderer_required");
  }
  if (text(evidence?.renderer_manifest?.story_id) !== text(story.id)) {
    blockers.push("renderer_story_identity_mismatch");
  }
  if (text(evidence?.renderer_manifest?.channel_id) !== text(channelId)) {
    blockers.push("renderer_channel_identity_mismatch");
  }
  if (!operatingContract?.live_mutation_allowed) {
    blockers.push(
      ...(operatingContract?.blockers?.length
        ? operatingContract.blockers
        : ["live_guarded_operating_contract_required"]),
    );
  }
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const schedule = new Date(scheduledFor);
  if (
    Number.isNaN(effectiveNow.getTime()) ||
    Number.isNaN(schedule.getTime())
  ) {
    blockers.push("valid_guarded_schedule_required");
  } else {
    if (!isGuardedUtcSchedule(schedule)) {
      const authorisation = normaliseOutsideCadenceAuthorisation(
        outsideCadenceAuthorisation,
      );
      if (!authorisation.authorisation_id) {
        blockers.push("schedule_outside_guarded_youtube_windows");
        blockers.push("outside_cadence_authorisation_required");
      } else if (
        authorisation.confirmed_authorisation_id !==
        authorisation.authorisation_id
      ) {
        blockers.push("exact_outside_cadence_authorisation_required");
      }
      if (authorisation.one_shot !== true) {
        blockers.push("outside_cadence_one_shot_confirmation_required");
      }
      if (
        schedule.getUTCSeconds() !== 0 ||
        schedule.getUTCMilliseconds() !== 0
      ) {
        blockers.push("outside_cadence_schedule_must_be_exact_minute");
      }
    }
    const untilScheduledMs = schedule.getTime() - effectiveNow.getTime();
    if (untilScheduledMs > ADMISSION_WINDOW_DRIFT_MS) {
      blockers.push("operator_admission_outside_dispatch_window");
    }
    if (untilScheduledMs < -ADMISSION_LATE_TOLERANCE_MS) {
      blockers.push("operator_admission_after_dispatch_window");
    }
  }
  return [...new Set(blockers)];
}

async function admitPublication({
  repos,
  storyId,
  channelId = "pulse-gaming",
  platform = "youtube",
  actorId,
  reason,
  confirmationStoryId,
  scheduledFor,
  evidence = {},
  env = process.env,
  now = new Date(),
  resolveMediaPath,
  channel = null,
  outsideCadenceAuthorisation = null,
  runwayLockSha256 = null,
  dispatchJob = null,
  transactionBoundaryCheck = null,
  transactionCompletionCheck = null,
} = {}) {
  if (!repos?.db || !repos?.stories || !repos?.publicationGovernance) {
    throw new Error("publication_admission_repositories_required");
  }
  if (platform !== YOUTUBE_PLATFORM_CONTRACT.lifecyclePlatform) {
    return {
      admitted: false,
      blockers: ["platform_outside_stabilisation_scope"],
    };
  }
  const story = repos.stories.get(storyId);
  const dispatchJobSpec = normaliseDispatchJobSpec(dispatchJob);
  if (
    dispatchJobSpec &&
    typeof repos.jobs?.enqueueInTransaction !== "function"
  ) {
    throw new Error("atomic_publication_dispatch_job_repository_required");
  }
  const operatingContract = resolveOperatingContract({ env });
  const evidenceAssessment = assessPublicationEvidence(evidence);
  const rendererEvaluation = evaluateRendererManifest(
    evidence?.renderer_manifest,
    {
      operatingMode: operatingContract.mode,
    },
  );
  const effectiveNow = now instanceof Date ? now : new Date(now);
  const blockers = admissionBlockers({
    story,
    actorId,
    reason,
    confirmationStoryId,
    scheduledFor,
    now: effectiveNow,
    evidence,
    operatingContract,
    channelId,
    platform,
    evidenceAssessment,
    rendererEvaluation,
    outsideCadenceAuthorisation,
    runwayLockSha256,
  });
  if (blockers.length) {
    return { admitted: false, blockers };
  }

  const immutablePublicationEvidence = buildImmutablePublicationEvidence({
    evidence,
    evidenceAssessment,
    rendererEvaluation,
    operatingMode: operatingContract.mode,
    ...controlledExperimentExpectedEvidence({
      story,
      channelId,
      evidence,
      rendererEvaluation,
    }),
  });
  const fingerprint = await fingerprintPublicationRequest(story, {
    channelId,
    platform,
    resolveMediaPath,
    channel,
    publicationEvidence: immutablePublicationEvidence,
  });
  const fingerprintBlockers = [];
  if (
    text(evidence?.renderer_manifest?.output?.sha256).toLowerCase() !==
    fingerprint.media_sha256
  ) {
    fingerprintBlockers.push("renderer_media_hash_mismatch");
  }
  if (fingerprintBlockers.length) {
    return { admitted: false, blockers: fingerprintBlockers };
  }
  const scheduledAt = new Date(scheduledFor).toISOString();
  const operationKey = `${platform}:${text(story.id)}:${scheduledAt}`;
  const outsideCadenceEvidence = isGuardedUtcSchedule(new Date(scheduledAt))
    ? null
    : persistedOutsideCadenceAuthorisation(outsideCadenceAuthorisation, {
        storyId: story.id,
        channelId,
        platform,
        scheduledFor: scheduledAt,
        authorisedAt: effectiveNow.toISOString(),
        dispatchIdempotencyKey: operationKey,
        requestFingerprint: fingerprint.request_fingerprint,
      });
  const governance = repos.publicationGovernance;
  const transaction = repos.db.transaction(() => {
    if (transactionBoundaryCheck !== null) {
      if (typeof transactionBoundaryCheck !== "function") {
        throw new Error("publication_transaction_boundary_check_invalid");
      }
      transactionBoundaryCheck();
    }
    const decision = governance.recordOperatorDecision({
      actorId: text(actorId),
      action: "approve_publication",
      targetType: "platform_publication",
      targetId: `${story.id}:${platform}`,
      decision: "APPROVED",
      reason: text(reason),
      evidence: {
        human_review_complete: true,
        source_evidence_sha256: text(evidence.source_evidence_sha256),
        rights_ledger_sha256:
          evidenceAssessment.stateEvidence.ASSETS_CLEARED.rights_ledger_sha256,
        qa_report_sha256: text(evidence.qa_report_sha256),
        media_sha256: fingerprint.media_sha256,
        script_sha256: fingerprint.script_sha256,
        request_fingerprint: fingerprint.request_fingerprint,
        ...(sha256(text(runwayLockSha256).toLowerCase())
          ? {
              runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
            }
          : {}),
        ...(outsideCadenceEvidence
          ? {
              outside_cadence_authorisation: outsideCadenceEvidence,
            }
          : {}),
        ...immutablePublicationEvidence,
      },
      idempotencyKey: `${operationKey}:operator-approval`,
    });
    const common = {
      storyId: story.id,
      platform,
      eventReason: "guarded_operator_admission",
    };
    const states = [
      [
        "DISCOVERED",
        {
          source_discovered: true,
          source_evidence_sha256: text(evidence.source_evidence_sha256),
        },
      ],
      [
        "VERIFIED",
        {
          source_verified: true,
          source_evidence_sha256: text(evidence.source_evidence_sha256),
        },
      ],
      [
        "EDITORIALLY_APPROVED",
        {
          editorial_approved: true,
        },
      ],
      [
        "SCRIPT_READY",
        {
          script_ready: true,
          script_sha256: fingerprint.script_sha256,
        },
      ],
      [
        "ASSETS_CLEARED",
        {
          rights_cleared: true,
          ...evidenceAssessment.stateEvidence.ASSETS_CLEARED,
        },
      ],
      [
        "RENDERED",
        {
          rendered_artifact_verified: true,
          media_sha256: fingerprint.media_sha256,
          renderer_manifest_sha256: rendererEvaluation.manifest_sha256,
          renderer: rendererEvaluation.renderer,
          renderer_governance: {
            verdict: rendererEvaluation.verdict,
            evidence: rendererEvaluation.evidence,
          },
        },
      ],
      [
        "QA_PASSED",
        {
          qa_passed: true,
          qa_report_sha256: text(evidence.qa_report_sha256),
        },
      ],
      [
        "HUMAN_APPROVED",
        {
          human_review_complete: true,
          operator_decision_id: decision.id,
          ...evidenceAssessment.stateEvidence.HUMAN_APPROVED,
        },
      ],
      [
        "SCHEDULED",
        {
          schedule_verified: true,
          control_tower_verdict: "GREEN",
          control_tower_checked_at: effectiveNow.toISOString(),
          scheduled_for: scheduledAt,
          channel_id: channelId,
          kill_switch_healthy: true,
          operating_contract_valid: true,
          dispatch_idempotency_key: operationKey,
          request_fingerprint: fingerprint.request_fingerprint,
          ...(sha256(text(runwayLockSha256).toLowerCase())
            ? {
                runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
              }
            : {}),
          publication_evidence: immutablePublicationEvidence,
          ...(outsideCadenceEvidence
            ? {
                outside_cadence_authorisation: outsideCadenceEvidence,
              }
            : {}),
        },
      ],
    ];
    const currentLifecycle = governance.getState(story.id, platform);
    let statesToAppend = states;
    if (
      currentLifecycle?.lifecycle_state ===
      "ADMISSION_CANCELLED_BEFORE_DISPATCH"
    ) {
      statesToAppend = states.slice(-1);
    } else if (currentLifecycle?.lifecycle_state === "SCHEDULED") {
      const currentSchedule = governance.getLatestLifecycleEvent(
        story.id,
        platform,
        "SCHEDULED",
      );
      if (
        currentSchedule?.idempotency_key !==
        `${operationKey}:lifecycle:SCHEDULED`
      ) {
        throw new Error("publication_already_scheduled");
      }
      statesToAppend = states.slice(-1);
    }
    let scheduledEvent = null;
    for (const [state, stateEvidence] of statesToAppend) {
      const lifecycleEvent = governance.appendLifecycle({
        ...common,
        toState: state,
        actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
        actorId: state === "HUMAN_APPROVED" ? text(actorId) : null,
        operatorDecisionId: state === "HUMAN_APPROVED" ? decision.id : null,
        evidence: stateEvidence,
        idempotencyKey: `${operationKey}:lifecycle:${state}`,
      });
      if (state === "SCHEDULED") {
        scheduledEvent = lifecycleEvent;
      }
    }
    if (!scheduledEvent) {
      scheduledEvent = governance.getLatestLifecycleEvent(
        story.id,
        platform,
        "SCHEDULED",
      );
    }
    if (
      !Number.isInteger(Number(scheduledEvent?.id)) ||
      Number(scheduledEvent.id) <= 0
    ) {
      throw new Error("scheduled_lifecycle_event_identity_required");
    }
    let queuedDispatchJob = null;
    const queuedReleaseJobs = [];
    if (dispatchJobSpec) {
      const scheduledTime = Date.parse(scheduledAt);
      if (dispatchJobSpec.promotedReserve) {
        const promotedRunAt = Date.parse(dispatchJobSpec.prestageRunAt);
        const confirmedDisarm =
          dispatchJobSpec.promotionAuthorityType ===
          "CONFIRMED_DISARM_FAILOVER";
        const earliest =
          scheduledTime - (confirmedDisarm ? 60 : 70) * 60 * 1000;
        const latest = scheduledTime - (confirmedDisarm ? 15 : 60) * 60 * 1000;
        if (promotedRunAt < earliest || promotedRunAt >= latest) {
          throw new Error(
            "publication_promoted_reserve_outside_failover_window",
          );
        }
      }
      const commonPayload = {
        lane_id: dispatchJobSpec.laneId,
        story_id: story.id,
        platform,
        scheduled_event_id: Number(scheduledEvent.id),
        scheduled_for: scheduledAt,
        dispatch_idempotency_key: operationKey,
        request_fingerprint: fingerprint.request_fingerprint,
        media_sha256: fingerprint.media_sha256,
        script_sha256: fingerprint.script_sha256,
        ...(sha256(text(runwayLockSha256).toLowerCase())
          ? {
              runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
            }
          : {}),
        catch_up_allowed: false,
        external_posting: false,
      };
      const releaseJobSpecs = [
        {
          kind: "prestage_governed_youtube_release",
          prefix: "prestage",
          priority: 1,
          runAt: new Date(
            dispatchJobSpec.promotedReserve
              ? Date.parse(dispatchJobSpec.prestageRunAt)
              : scheduledTime - 70 * 60 * 1000,
          ).toISOString(),
          payload: {
            ...commonPayload,
            phase: dispatchJobSpec.promotedReserve
              ? dispatchJobSpec.promotionAuthorityType ===
                "CONFIRMED_DISARM_FAILOVER"
                ? "CONFIRMED_DISARM_FAILOVER_PRESTAGE"
                : "FAILOVER_PRESTAGE"
              : "T-70",
            private_only: true,
            private_prestage_authority: true,
            scheduled_release_authority: false,
            publish_authority: false,
            promoted_reserve: dispatchJobSpec.promotedReserve,
            reserve_promotion_sha256: dispatchJobSpec.promotionSha256,
            reserve_promotion_authority_type:
              dispatchJobSpec.promotionAuthorityType,
          },
        },
        {
          kind: "verify_governed_youtube_release_tminus15",
          prefix: "verify-scheduled",
          priority: 1,
          runAt: new Date(scheduledTime - 15 * 60 * 1000).toISOString(),
          payload: {
            ...commonPayload,
            phase: "T-15",
            arm_private_schedule_once: true,
            scheduled_release_authority: true,
            official_source_revalidation_required: true,
            scheduled_release_verification_authority: true,
            publish_authority: false,
          },
        },
        {
          kind: "verify_governed_youtube_release_t0",
          prefix: "verify-public",
          priority: 0,
          runAt: scheduledAt,
          payload: {
            ...commonPayload,
            phase: "T0",
            public_verification_only: true,
            public_release_verification_authority: true,
            guarded_dispatch_authority: true,
            publish_authority: false,
          },
        },
      ];
      for (const releaseSpec of releaseJobSpecs) {
        const exactJob = {
          kind: releaseSpec.kind,
          channel_id: channelId,
          story_id: story.id,
          payload: releaseSpec.payload,
          priority: releaseSpec.priority,
          requires_gpu: false,
          max_attempts:
            releaseSpec.kind === "verify_governed_youtube_release_t0"
              ? 16
              : dispatchJobSpec.maxAttempts,
          idempotency_key: youtubeReleaseJobIdempotencyKey({
            phase:
              releaseSpec.kind === "prestage_governed_youtube_release"
                ? "T-70"
                : releaseSpec.kind ===
                    "verify_governed_youtube_release_tminus15"
                  ? "T-15"
                  : "T0",
            scheduledEventId: Number(scheduledEvent.id),
            requestFingerprint: fingerprint.request_fingerprint,
          }),
          run_at: releaseSpec.runAt,
        };
        const queued = repos.jobs.enqueueInTransaction(exactJob);
        const releaseJob = {
          id: Number(queued.id),
          kind: exactJob.kind,
          status: text(queued.status) || "pending",
          idempotency_key: exactJob.idempotency_key,
          run_at: releaseSpec.runAt,
          payload: exactJob.payload,
        };
        queuedReleaseJobs.push(releaseJob);
      }
      queuedDispatchJob =
        queuedReleaseJobs.find(
          (job) => job.kind === "verify_governed_youtube_release_t0",
        ) || null;
    }
    if (transactionCompletionCheck !== null) {
      if (typeof transactionCompletionCheck !== "function") {
        throw new Error("publication_transaction_completion_check_invalid");
      }
      transactionCompletionCheck({
        scheduledEvent,
        releaseJobs: queuedReleaseJobs,
        dispatchJob: queuedDispatchJob,
      });
    }
    return {
      admitted: true,
      story_id: story.id,
      channel_id: channelId,
      platform,
      scheduled_for: scheduledAt,
      dispatch_idempotency_key: operationKey,
      request_fingerprint: fingerprint.request_fingerprint,
      scheduled_event_id: Number(scheduledEvent.id),
      dispatch_job: queuedDispatchJob,
      release_jobs: queuedReleaseJobs,
      runway_lock_sha256: sha256(text(runwayLockSha256).toLowerCase())
        ? text(runwayLockSha256).toLowerCase()
        : null,
      media_sha256: fingerprint.media_sha256,
      script_sha256: fingerprint.script_sha256,
      renderer_manifest_sha256: rendererEvaluation.manifest_sha256,
      publication_evidence: immutablePublicationEvidence,
      operator_decision_id: decision.id,
      lifecycle_state: governance.getState(story.id, platform)?.lifecycle_state,
      outside_cadence_authorisation: outsideCadenceEvidence,
      blockers: [],
    };
  });
  return transaction.immediate();
}

const AUTONOMOUS_AUTHORITY_TTL_MS = 60 * 1000;
const AUTONOMOUS_AUTHORITY_FIELDS = new Set([
  "admission_controls",
  "authority_id",
  "authority_scope",
  "authority_sha256",
  "authority_type",
  "autonomous_visual_gate",
  "channel_id",
  "decision",
  "dispatch_authorised",
  "dispatch_idempotency_key",
  "external_publish_authorised",
  "human_approval",
  "issued_at",
  "lane_id",
  "lineage",
  "may_impersonate_human",
  "operational_publish_authority",
  "platform",
  "publication_evidence",
  "request_fingerprint",
  "required_release_boundary",
  "runway_lock_sha256",
  "scheduled_for",
  "single_use",
  "source_report",
  "story_id",
  "valid_until",
  "verifier_id",
]);
const AUTONOMOUS_LINEAGE_FIELDS = new Set([
  "final_composite_manifest_sha256",
  "media_sha256",
  "multimodal_visual_qa_sha256",
  "narration_audio_sha256",
  "narration_manifest_sha256",
  "owned_motion_manifest_sha256",
  "publication_metadata_sha256",
  "autonomous_visual_gate_decision_sha256",
  "autonomous_green_supplement_sha256",
  "qa_report_sha256",
  "renderer_manifest_canonical_sha256",
  "renderer_manifest_file_sha256",
  "rights_ledger_sha256",
  "script_sha256",
  "source_evidence_sha256",
  "story_intake_sha256",
]);
const AUTONOMOUS_SOURCE_REPORT_FIELDS = new Set([
  "file_sha256",
  "generated_at",
  "path",
  "report_sha256",
  "request_sha256",
  "valid_until",
]);
const AUTONOMOUS_ADMISSION_CONTROL_FIELDS = new Set([
  "kill_switch_checked_at",
  "kill_switch_proof_sha256",
  "single_owner_checked_at",
  "single_owner_proof_sha256",
]);
const AUTONOMOUS_RELEASE_BOUNDARY_FIELDS = new Set([
  "boundary",
  "disarm_on_failure",
  "exact_binding_revalidation_required",
  "kill_switch_revalidation_required",
  "max_control_age_ms",
  "official_source_revalidation_required",
  "single_owner_revalidation_required",
]);
const AUTONOMOUS_VISUAL_GATE_FIELDS = new Set([
  "decision_file_sha256",
  "decision_self_sha256",
  "decision_authority",
  "authority_scope",
  "policy_id",
  "policy_version",
  "gate",
  "required_report_schema",
  "required_aggregation",
  "minimum_distinct_vision_models",
  "distinct_model_count",
  "human_approval",
  "models_treated_as_humans",
  "publish_authority",
  "scheduler_authority",
  "database_authority",
  "oauth_or_token_authority",
  "platform_contacted",
  "network_used",
]);

function stableCanonicalValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableCanonicalValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableCanonicalValue(value[field])]),
    );
  }
  return value;
}

function canonicalObjectSha256(value) {
  return sha256Text(JSON.stringify(stableCanonicalValue(value)));
}

function exactObjectFields(value, expected, code) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(code);
  }
  const fields = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    fields.length !== wanted.length ||
    fields.some((field, index) => field !== wanted[index])
  ) {
    throw new Error(code);
  }
}

function exactIsoTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    throw new Error(code);
  }
  return timestamp;
}

function trustedAutonomousAdmissionNow(clock) {
  if (typeof clock !== "function") {
    throw new Error("autonomous_publication_admission_trusted_clock_required");
  }
  const value = clock();
  const now =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(now.getTime())) {
    throw new Error("autonomous_publication_admission_trusted_clock_invalid");
  }
  return now;
}

function validateAutonomousAuthorityEnvelope(
  authority,
  {
    storyId,
    channelId,
    laneId,
    platform,
    scheduledFor,
    runwayLockSha256,
    requestFingerprint,
    publicationEvidence,
    now,
  },
) {
  exactObjectFields(
    authority,
    AUTONOMOUS_AUTHORITY_FIELDS,
    "autonomous_publication_admission_authority_fields_invalid",
  );
  exactObjectFields(
    authority.lineage,
    AUTONOMOUS_LINEAGE_FIELDS,
    "autonomous_publication_admission_lineage_fields_invalid",
  );
  exactObjectFields(
    authority.source_report,
    AUTONOMOUS_SOURCE_REPORT_FIELDS,
    "autonomous_publication_admission_source_report_fields_invalid",
  );
  exactObjectFields(
    authority.admission_controls,
    AUTONOMOUS_ADMISSION_CONTROL_FIELDS,
    "autonomous_publication_admission_control_fields_invalid",
  );
  exactObjectFields(
    authority.required_release_boundary,
    AUTONOMOUS_RELEASE_BOUNDARY_FIELDS,
    "autonomous_publication_admission_release_boundary_fields_invalid",
  );
  exactObjectFields(
    authority.autonomous_visual_gate,
    AUTONOMOUS_VISUAL_GATE_FIELDS,
    "autonomous_publication_admission_visual_gate_fields_invalid",
  );

  const authorityBindingSha256 = text(authority.authority_sha256).toLowerCase();
  const authorityBody = { ...authority };
  delete authorityBody.authority_sha256;
  if (
    !sha256(authorityBindingSha256) ||
    canonicalObjectSha256(authorityBody) !== authorityBindingSha256
  ) {
    throw new Error(
      "autonomous_publication_admission_authority_sha256_invalid",
    );
  }
  const authorityClaims = { ...authorityBody };
  delete authorityClaims.authority_id;
  if (
    authority.authority_id !==
    `autonomous-official-publication:${canonicalObjectSha256(authorityClaims)}`
  ) {
    throw new Error("autonomous_publication_admission_authority_id_invalid");
  }
  if (
    authority.verifier_id !== AUTONOMOUS_AUTHORITY_VERIFIER_ID ||
    authority.authority_type !== AUTONOMOUS_AUTHORITY_TYPE ||
    authority.authority_scope !== AUTONOMOUS_AUTHORITY_SCOPE ||
    authority.decision !== "APPROVED" ||
    authority.human_approval !== false ||
    authority.may_impersonate_human !== false ||
    authority.operational_publish_authority !== false ||
    authority.dispatch_authorised !== false ||
    authority.external_publish_authorised !== false ||
    authority.single_use !== true
  ) {
    throw new Error("autonomous_publication_admission_authority_scope_invalid");
  }
  const visualGate = authority.autonomous_visual_gate;
  if (
    !sha256(visualGate.decision_file_sha256) ||
    !sha256(visualGate.decision_self_sha256) ||
    visualGate.decision_file_sha256 !==
      authority.lineage.autonomous_visual_gate_decision_sha256 ||
    visualGate.decision_authority !== "SYSTEM_POLICY" ||
    visualGate.authority_scope !== AUTONOMOUS_AUTHORITY_TYPE ||
    visualGate.policy_id !== "pulse-visual-review-policy" ||
    visualGate.policy_version !== "2" ||
    visualGate.gate !== "AUTONOMOUS_OFFICIAL_UNANIMOUS" ||
    visualGate.required_report_schema !==
      "pulse-local-multimodal-visual-review-v1" ||
    visualGate.required_aggregation !== "UNANIMOUS_PASS" ||
    visualGate.minimum_distinct_vision_models !== 2 ||
    !Number.isInteger(visualGate.distinct_model_count) ||
    visualGate.distinct_model_count < 2 ||
    visualGate.human_approval !== false ||
    visualGate.models_treated_as_humans !== false ||
    visualGate.publish_authority !== false ||
    visualGate.scheduler_authority !== false ||
    visualGate.database_authority !== false ||
    visualGate.oauth_or_token_authority !== false ||
    visualGate.platform_contacted !== false ||
    visualGate.network_used !== false
  ) {
    throw new Error(
      "autonomous_publication_admission_visual_gate_invalid",
    );
  }
  const boundary = authority.required_release_boundary;
  if (
    boundary.boundary !== "T_MINUS_15" ||
    boundary.official_source_revalidation_required !== true ||
    boundary.kill_switch_revalidation_required !== true ||
    boundary.single_owner_revalidation_required !== true ||
    boundary.exact_binding_revalidation_required !== true ||
    boundary.max_control_age_ms !== AUTONOMOUS_MAX_CONTROL_AGE_MS ||
    boundary.disarm_on_failure !== true
  ) {
    throw new Error(
      "autonomous_publication_admission_release_boundary_invalid",
    );
  }

  const nowMs = now.getTime();
  const issuedAtMs = exactIsoTimestamp(
    authority.issued_at,
    "autonomous_publication_admission_issued_at_invalid",
  );
  const validUntilMs = exactIsoTimestamp(
    authority.valid_until,
    "autonomous_publication_admission_valid_until_invalid",
  );
  if (issuedAtMs > nowMs) {
    throw new Error("autonomous_publication_admission_authority_from_future");
  }
  if (
    validUntilMs <= nowMs ||
    validUntilMs - issuedAtMs > AUTONOMOUS_AUTHORITY_TTL_MS
  ) {
    throw new Error("autonomous_publication_admission_authority_stale");
  }
  const sourceGeneratedAtMs = exactIsoTimestamp(
    authority.source_report.generated_at,
    "autonomous_publication_admission_source_report_generated_at_invalid",
  );
  const sourceValidUntilMs = exactIsoTimestamp(
    authority.source_report.valid_until,
    "autonomous_publication_admission_source_report_valid_until_invalid",
  );
  if (
    !text(authority.source_report.path) ||
    sourceGeneratedAtMs > nowMs ||
    nowMs - sourceGeneratedAtMs >= AUTONOMOUS_MAX_REPORT_AGE_MS ||
    sourceValidUntilMs <= nowMs ||
    sourceValidUntilMs < validUntilMs
  ) {
    throw new Error("autonomous_publication_admission_source_report_stale");
  }
  for (const field of ["kill_switch_checked_at", "single_owner_checked_at"]) {
    const checkedAtMs = exactIsoTimestamp(
      authority.admission_controls[field],
      `autonomous_publication_admission_${field}_invalid`,
    );
    if (
      checkedAtMs > nowMs ||
      nowMs - checkedAtMs >= AUTONOMOUS_MAX_CONTROL_AGE_MS
    ) {
      throw new Error("autonomous_publication_admission_controls_stale");
    }
  }
  for (const field of [
    "kill_switch_proof_sha256",
    "single_owner_proof_sha256",
  ]) {
    if (!sha256(authority.admission_controls[field])) {
      throw new Error(`autonomous_publication_admission_${field}_invalid`);
    }
  }
  for (const value of Object.values(authority.lineage)) {
    if (!sha256(value)) {
      throw new Error("autonomous_publication_admission_lineage_hash_invalid");
    }
  }
  for (const field of ["file_sha256", "report_sha256", "request_sha256"]) {
    if (!sha256(authority.source_report[field])) {
      throw new Error(
        "autonomous_publication_admission_source_report_hash_invalid",
      );
    }
  }

  const scheduleMs = exactIsoTimestamp(
    scheduledFor,
    "autonomous_publication_admission_schedule_invalid",
  );
  const schedule = new Date(scheduleMs);
  if (
    !isGuardedUtcSchedule(schedule) ||
    scheduleMs <= nowMs ||
    scheduleMs - nowMs > ADMISSION_WINDOW_DRIFT_MS
  ) {
    throw new Error("autonomous_publication_admission_schedule_invalid");
  }
  if (validUntilMs > scheduleMs) {
    throw new Error(
      "autonomous_publication_admission_authority_window_invalid",
    );
  }
  const exactBindings = [
    [authority.story_id, text(storyId), "story"],
    [authority.channel_id, text(channelId), "channel"],
    [authority.lane_id, text(laneId), "lane"],
    [authority.platform, text(platform), "platform"],
    [authority.scheduled_for, schedule.toISOString(), "schedule"],
    [
      authority.runway_lock_sha256,
      text(runwayLockSha256).toLowerCase(),
      "runway",
    ],
    [
      authority.request_fingerprint,
      text(requestFingerprint).toLowerCase(),
      "request_fingerprint",
    ],
  ];
  for (const [actual, expected, field] of exactBindings) {
    if (!expected || actual !== expected) {
      throw new Error(`autonomous_publication_admission_${field}_mismatch`);
    }
  }
  if (!sha256(runwayLockSha256) || !sha256(requestFingerprint)) {
    throw new Error("autonomous_publication_admission_binding_hash_invalid");
  }
  const operationKey = `${platform}:${storyId}:${schedule.toISOString()}`;
  if (authority.dispatch_idempotency_key !== operationKey) {
    throw new Error(
      "autonomous_publication_admission_dispatch_identity_mismatch",
    );
  }
  if (
    JSON.stringify(stableCanonicalValue(authority.publication_evidence)) !==
    JSON.stringify(stableCanonicalValue(publicationEvidence))
  ) {
    throw new Error(
      "autonomous_publication_admission_publication_evidence_mismatch",
    );
  }
  const evidence = authority.publication_evidence;
  for (const [actual, expected, field] of [
    [
      evidence.source_evidence_sha256,
      authority.lineage.source_evidence_sha256,
      "source",
    ],
    [evidence.qa_report_sha256, authority.lineage.qa_report_sha256, "qa"],
    [
      evidence.publication_metadata_sha256,
      authority.lineage.publication_metadata_sha256,
      "metadata",
    ],
    [
      evidence.renderer_manifest_sha256,
      authority.lineage.renderer_manifest_canonical_sha256,
      "renderer",
    ],
    [
      evidence.rights_ledger_sha256,
      authority.lineage.rights_ledger_sha256,
      "rights",
    ],
  ]) {
    if (!sha256(actual) || actual !== expected) {
      throw new Error(
        `autonomous_publication_admission_${field}_lineage_mismatch`,
      );
    }
  }
  validateOfficialSourceReleaseBinding(
    evidence.official_source_release_binding,
    {
      storyId,
      sourceEvidenceSha256: evidence.source_evidence_sha256,
    },
  );
  return {
    authorityBindingSha256,
    operationKey,
    scheduledAt: schedule.toISOString(),
  };
}

async function admitAutonomousOfficialPublication({
  repos,
  authority,
  storyId,
  channelId = "pulse-gaming",
  laneId = "breaking_short",
  platform = "youtube",
  scheduledFor,
  runwayLockSha256,
  requestFingerprint,
  publicationEvidence,
  env = process.env,
  clock,
  resolveMediaPath,
  channel = null,
  dispatchJob,
  transactionBoundaryCheck = null,
  transactionCompletionCheck = null,
} = {}) {
  if (!repos?.db || !repos?.stories || !repos?.publicationGovernance) {
    throw new Error("publication_admission_repositories_required");
  }
  if (
    typeof repos.publicationGovernance.recordAutonomousPublicationAuthority !==
    "function"
  ) {
    throw new Error("autonomous_publication_authority_repository_required");
  }
  if (
    platform !== "youtube" ||
    channelId !== "pulse-gaming" ||
    laneId !== "breaking_short"
  ) {
    throw new Error("autonomous_publication_admission_scope_invalid");
  }
  const story = repos.stories.get(storyId);
  if (!story) {
    throw new Error("publication_story_not_found");
  }
  if (
    (story.channel_id || "pulse-gaming") !== channelId ||
    !text(story.full_script) ||
    !text(story.exported_path) ||
    story.qa_failed === true ||
    story.publish_status === "failed" ||
    text(story.youtube_post_id)
  ) {
    throw new Error("autonomous_publication_admission_story_invalid");
  }
  const operatingContract = resolveOperatingContract({ env });
  if (!operatingContract.live_mutation_allowed) {
    throw new Error(
      operatingContract.blockers?.[0] ||
        "live_guarded_operating_contract_required",
    );
  }
  const dispatchJobSpec = normaliseDispatchJobSpec(dispatchJob);
  if (
    !dispatchJobSpec ||
    dispatchJobSpec.laneId !== laneId ||
    dispatchJobSpec.promotedReserve
  ) {
    throw new Error("autonomous_publication_dispatch_job_spec_invalid");
  }
  if (typeof repos.jobs?.enqueueInTransaction !== "function") {
    throw new Error("atomic_publication_dispatch_job_repository_required");
  }
  const metadata = publicationEvidence?.publication_metadata;
  let validatedMetadata;
  try {
    validatedMetadata = validateGovernedPublicationMetadata({
      metadataPath: metadata?.path,
      expectedMetadataSha256: publicationEvidence?.publication_metadata_sha256,
      expectedStoryId: story.id,
      expectedChannelId: channelId,
      expectedPlatform: YOUTUBE_PLATFORM_CONTRACT.reviewedMetadataPlatform,
      requireCanonicalAbsolutePath: true,
    });
  } catch (error) {
    if (error instanceof GovernedPublicationMetadataError) {
      throw new Error(error.codes.join(","));
    }
    throw error;
  }
  if (
    validatedMetadata.path !== metadata.path ||
    validatedMetadata.sha256 !== metadata.sha256 ||
    validatedMetadata.platform !== metadata.platform ||
    validatedMetadata.title !== metadata.title ||
    validatedMetadata.description !== metadata.description
  ) {
    throw new Error(
      "autonomous_publication_admission_metadata_binding_mismatch",
    );
  }

  const fingerprint = await fingerprintPublicationRequest(story, {
    channelId,
    platform,
    resolveMediaPath,
    channel,
    publicationEvidence,
  });
  const now = trustedAutonomousAdmissionNow(clock);
  const validatedAuthority = validateAutonomousAuthorityEnvelope(authority, {
    storyId,
    channelId,
    laneId,
    platform,
    scheduledFor,
    runwayLockSha256,
    requestFingerprint,
    publicationEvidence,
    now,
  });
  for (const [actual, expected, field] of [
    [
      fingerprint.request_fingerprint,
      requestFingerprint,
      "request_fingerprint",
    ],
    [fingerprint.media_sha256, authority.lineage.media_sha256, "media"],
    [fingerprint.script_sha256, authority.lineage.script_sha256, "script"],
  ]) {
    if (actual !== expected) {
      throw new Error(`autonomous_publication_admission_${field}_mismatch`);
    }
  }

  const operationKey = validatedAuthority.operationKey;
  const scheduledAt = validatedAuthority.scheduledAt;
  const authorityLifecycleKey = `${operationKey}:lifecycle:AUTONOMOUSLY_APPROVED`;
  const governance = repos.publicationGovernance;
  const transaction = repos.db.transaction(() => {
    if (transactionBoundaryCheck !== null) {
      if (typeof transactionBoundaryCheck !== "function") {
        throw new Error("publication_transaction_boundary_check_invalid");
      }
      transactionBoundaryCheck();
    }
    const authorityAudit = governance.recordAutonomousPublicationAuthority({
      storyId: story.id,
      platform,
      authorityType: authority.authority_type,
      authorityBindingSha256: validatedAuthority.authorityBindingSha256,
      lifecycleIdempotencyKey: authorityLifecycleKey,
      reason:
        "Exact low-risk official-source candidate passed autonomous publication admission",
      evidence: {
        exact_candidate_bound: true,
        authority_id: authority.authority_id,
        authority_type: authority.authority_type,
        authority_scope: authority.authority_scope,
        verifier_id: authority.verifier_id,
        authority_binding_sha256: validatedAuthority.authorityBindingSha256,
        issued_at: authority.issued_at,
        valid_until: authority.valid_until,
        story_id: story.id,
        channel_id: channelId,
        lane_id: laneId,
        platform,
        scheduled_for: scheduledAt,
        runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
        dispatch_idempotency_key: operationKey,
        request_fingerprint: fingerprint.request_fingerprint,
        publication_evidence_sha256: canonicalObjectSha256(publicationEvidence),
        source_evidence_sha256: publicationEvidence.source_evidence_sha256,
        rights_ledger_sha256: publicationEvidence.rights_ledger_sha256,
        qa_report_sha256: publicationEvidence.qa_report_sha256,
        publication_metadata_sha256:
          publicationEvidence.publication_metadata_sha256,
        autonomous_green_supplement_sha256:
          authority.lineage.autonomous_green_supplement_sha256,
        autonomous_visual_gate_decision_sha256:
          authority.lineage.autonomous_visual_gate_decision_sha256,
        autonomous_visual_gate: authority.autonomous_visual_gate,
        renderer_manifest_sha256: publicationEvidence.renderer_manifest_sha256,
        media_sha256: fingerprint.media_sha256,
        script_sha256: fingerprint.script_sha256,
        source_report_sha256: authority.source_report.report_sha256,
        kill_switch_proof_sha256:
          authority.admission_controls.kill_switch_proof_sha256,
        single_owner_proof_sha256:
          authority.admission_controls.single_owner_proof_sha256,
        required_release_boundary: authority.required_release_boundary,
        operational_publish_authority: false,
        dispatch_authorised: false,
        external_publish_authorised: false,
      },
      idempotencyKey: `${operationKey}:autonomous-authority`,
    });
    const currentStory = repos.stories.get(story.id);
    if (!currentStory) {
      throw new Error("publication_story_not_found");
    }
    const currentExtra = parseStoryExtra(currentStory._extra);
    const existingAutonomousProjection =
      currentExtra.autonomous_publication_approval;
    if (
      existingAutonomousProjection &&
      (typeof existingAutonomousProjection !== "object" ||
        Array.isArray(existingAutonomousProjection) ||
        text(existingAutonomousProjection.authority_sha256).toLowerCase() !==
          validatedAuthority.authorityBindingSha256)
    ) {
      throw new Error("autonomous_publication_approval_projection_conflict");
    }
    const autonomousProjection = {
      approval_type: AUTONOMOUS_AUTHORITY_TYPE,
      authority_id: authority.authority_id,
      authority_sha256: validatedAuthority.authorityBindingSha256,
      approved_at: authority.issued_at,
      autonomous_visual_gate: authority.autonomous_visual_gate,
      autonomous_visual_gate_decision_sha256:
        authority.lineage.autonomous_visual_gate_decision_sha256,
      media_sha256: fingerprint.media_sha256,
      qa_report_sha256: publicationEvidence.qa_report_sha256,
    };
    const projectionAlreadyExact =
      (currentStory.approved === true || currentStory.approved === 1) &&
      (currentStory.auto_approved === true ||
        currentStory.auto_approved === 1) &&
      JSON.stringify(stableCanonicalValue(existingAutonomousProjection)) ===
        JSON.stringify(stableCanonicalValue(autonomousProjection));
    if (!projectionAlreadyExact) {
      repos.db
        .prepare(
          `UPDATE stories
           SET approved = 1,
               auto_approved = 1,
               approved_at = CASE
                 WHEN approved = 1 AND approved_at IS NOT NULL
                   THEN approved_at
                 ELSE ?
               END,
               updated_at = ?,
               _extra = ?
           WHERE id = ?`,
        )
        .run(
          authority.issued_at,
          now.toISOString(),
          JSON.stringify({
            ...currentExtra,
            autonomous_publication_approval: autonomousProjection,
          }),
          story.id,
        );
    }
    const common = {
      storyId: story.id,
      platform,
      eventReason: "guarded_autonomous_official_admission",
    };
    const states = [
      [
        "DISCOVERED",
        {
          source_discovered: true,
          source_evidence_sha256: publicationEvidence.source_evidence_sha256,
        },
      ],
      [
        "VERIFIED",
        {
          source_verified: true,
          source_evidence_sha256: publicationEvidence.source_evidence_sha256,
        },
      ],
      ["EDITORIALLY_APPROVED", { editorial_approved: true }],
      [
        "SCRIPT_READY",
        {
          script_ready: true,
          script_sha256: fingerprint.script_sha256,
        },
      ],
      [
        "ASSETS_CLEARED",
        {
          rights_cleared: true,
          rights_ledger_sha256: publicationEvidence.rights_ledger_sha256,
          originality_transformation:
            publicationEvidence.originality_transformation,
        },
      ],
      [
        "RENDERED",
        {
          rendered_artifact_verified: true,
          media_sha256: fingerprint.media_sha256,
          renderer_manifest_sha256:
            publicationEvidence.renderer_manifest_sha256,
          renderer: publicationEvidence.renderer,
        },
      ],
      [
        "QA_PASSED",
        {
          qa_passed: true,
          qa_report_sha256: publicationEvidence.qa_report_sha256,
        },
      ],
      [
        "AUTONOMOUSLY_APPROVED",
        {
          autonomous_authority_complete: true,
          publication_authority_audit_id: Number(authorityAudit.id),
          authority_id: authority.authority_id,
          authority_type: authority.authority_type,
          authority_scope: authority.authority_scope,
          authority_binding_sha256: validatedAuthority.authorityBindingSha256,
          authority_valid_until: authority.valid_until,
          exact_candidate_bound: true,
        },
      ],
      [
        "SCHEDULED",
        {
          schedule_verified: true,
          control_tower_verdict: "GREEN",
          control_tower_checked_at: now.toISOString(),
          story_id: story.id,
          platform,
          scheduled_for: scheduledAt,
          channel_id: channelId,
          lane_id: laneId,
          kill_switch_healthy: true,
          operating_contract_valid: true,
          dispatch_idempotency_key: operationKey,
          request_fingerprint: fingerprint.request_fingerprint,
          runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
          publication_evidence: publicationEvidence,
          publication_authority_audit_id: Number(authorityAudit.id),
          autonomous_authority_type: authority.authority_type,
          autonomous_authority_binding_sha256:
            validatedAuthority.authorityBindingSha256,
          autonomous_visual_gate_decision_sha256:
            authority.lineage.autonomous_visual_gate_decision_sha256,
          autonomous_visual_gate: authority.autonomous_visual_gate,
          media_sha256: fingerprint.media_sha256,
          qa_report_sha256: publicationEvidence.qa_report_sha256,
          required_release_boundary: authority.required_release_boundary,
        },
      ],
    ];
    const currentLifecycle = governance.getState(story.id, platform);
    let statesToAppend = states;
    if (currentLifecycle?.lifecycle_state === "SCHEDULED") {
      const currentSchedule = governance.getLatestLifecycleEvent(
        story.id,
        platform,
        "SCHEDULED",
      );
      if (
        currentSchedule?.idempotency_key !==
        `${operationKey}:lifecycle:SCHEDULED`
      ) {
        throw new Error("publication_already_scheduled");
      }
      statesToAppend = states.slice(-1);
    }
    let scheduledEvent = null;
    for (const [state, stateEvidence] of statesToAppend) {
      const autonomousApproval = state === "AUTONOMOUSLY_APPROVED";
      const lifecycleEvent = governance.appendLifecycle({
        ...common,
        toState: state,
        publicationAuthorityAuditId: autonomousApproval
          ? Number(authorityAudit.id)
          : null,
        evidence: stateEvidence,
        idempotencyKey: autonomousApproval
          ? authorityLifecycleKey
          : `${operationKey}:lifecycle:${state}`,
      });
      if (state === "SCHEDULED") {
        scheduledEvent = lifecycleEvent;
      }
    }
    if (!scheduledEvent) {
      scheduledEvent = governance.getLatestLifecycleEvent(
        story.id,
        platform,
        "SCHEDULED",
      );
    }
    if (
      !Number.isInteger(Number(scheduledEvent?.id)) ||
      Number(scheduledEvent.id) <= 0
    ) {
      throw new Error("scheduled_lifecycle_event_identity_required");
    }

    const scheduledTime = Date.parse(scheduledAt);
    const commonPayload = {
      lane_id: laneId,
      story_id: story.id,
      platform,
      scheduled_event_id: Number(scheduledEvent.id),
      scheduled_for: scheduledAt,
      dispatch_idempotency_key: operationKey,
      request_fingerprint: fingerprint.request_fingerprint,
      media_sha256: fingerprint.media_sha256,
      script_sha256: fingerprint.script_sha256,
      runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
      publication_authority_audit_id: Number(authorityAudit.id),
      autonomous_authority_type: authority.authority_type,
      autonomous_authority_binding_sha256:
        validatedAuthority.authorityBindingSha256,
      catch_up_allowed: false,
      external_posting: false,
    };
    const releaseJobSpecs = [
      {
        kind: "prestage_governed_youtube_release",
        phase: "T-70",
        priority: 1,
        runAt: new Date(scheduledTime - 70 * 60 * 1000).toISOString(),
        payload: {
          ...commonPayload,
          phase: "T-70",
          private_only: true,
          private_prestage_authority: true,
          scheduled_release_authority: false,
          publish_authority: false,
          promoted_reserve: false,
          reserve_promotion_sha256: null,
          reserve_promotion_authority_type: null,
        },
      },
      {
        kind: "verify_governed_youtube_release_tminus15",
        phase: "T-15",
        priority: 1,
        runAt: new Date(scheduledTime - 15 * 60 * 1000).toISOString(),
        payload: {
          ...commonPayload,
          phase: "T-15",
          arm_private_schedule_once: true,
          scheduled_release_authority: true,
          official_source_revalidation_required: true,
          scheduled_release_verification_authority: true,
          publish_authority: false,
        },
      },
      {
        kind: "verify_governed_youtube_release_t0",
        phase: "T0",
        priority: 0,
        runAt: scheduledAt,
        payload: {
          ...commonPayload,
          phase: "T0",
          public_verification_only: true,
          public_release_verification_authority: true,
          guarded_dispatch_authority: true,
          publish_authority: false,
        },
      },
    ];
    const queuedReleaseJobs = [];
    for (const releaseSpec of releaseJobSpecs) {
      const exactJob = {
        kind: releaseSpec.kind,
        channel_id: channelId,
        story_id: story.id,
        payload: releaseSpec.payload,
        priority: releaseSpec.priority,
        requires_gpu: false,
        max_attempts:
          releaseSpec.phase === "T0" ? 16 : dispatchJobSpec.maxAttempts,
        idempotency_key: youtubeReleaseJobIdempotencyKey({
          phase: releaseSpec.phase,
          scheduledEventId: Number(scheduledEvent.id),
          requestFingerprint: fingerprint.request_fingerprint,
        }),
        run_at: releaseSpec.runAt,
      };
      const queued = repos.jobs.enqueueInTransaction(exactJob);
      queuedReleaseJobs.push({
        id: Number(queued.id),
        kind: exactJob.kind,
        status: text(queued.status) || "pending",
        idempotency_key: exactJob.idempotency_key,
        run_at: releaseSpec.runAt,
        payload: exactJob.payload,
      });
    }
    const queuedDispatchJob =
      queuedReleaseJobs.find(
        (job) => job.kind === "verify_governed_youtube_release_t0",
      ) || null;
    if (transactionCompletionCheck !== null) {
      if (typeof transactionCompletionCheck !== "function") {
        throw new Error("publication_transaction_completion_check_invalid");
      }
      transactionCompletionCheck({
        scheduledEvent,
        authorityAudit,
        releaseJobs: queuedReleaseJobs,
        dispatchJob: queuedDispatchJob,
      });
    }
    return {
      admitted: true,
      story_id: story.id,
      channel_id: channelId,
      lane_id: laneId,
      platform,
      scheduled_for: scheduledAt,
      dispatch_idempotency_key: operationKey,
      request_fingerprint: fingerprint.request_fingerprint,
      scheduled_event_id: Number(scheduledEvent.id),
      dispatch_job: queuedDispatchJob,
      release_jobs: queuedReleaseJobs,
      runway_lock_sha256: text(runwayLockSha256).toLowerCase(),
      media_sha256: fingerprint.media_sha256,
      script_sha256: fingerprint.script_sha256,
      renderer_manifest_sha256: publicationEvidence.renderer_manifest_sha256,
      publication_evidence: publicationEvidence,
      publication_authority_audit_id: Number(authorityAudit.id),
      autonomous_authority_binding_sha256:
        validatedAuthority.authorityBindingSha256,
      lifecycle_state: governance.getState(story.id, platform)?.lifecycle_state,
      blockers: [],
    };
  });
  return transaction.immediate();
}

module.exports = {
  ADMISSION_WINDOW_DRIFT_MS,
  ADMISSION_LATE_TOLERANCE_MS,
  GUARDED_UTC_HOURS,
  OUTSIDE_CADENCE_AUTHORISATION_SCHEMA,
  admissionBlockers,
  admitAutonomousOfficialPublication,
  admitPublication,
  buildImmutablePublicationEvidence,
  fingerprintOutsideCadenceAuthorisation,
  isGuardedUtcSchedule,
  validatePersistedOutsideCadenceAuthorisation,
};
