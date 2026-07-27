"use strict";

const {
  fingerprintPublicationRequest,
} = require("./publication-request-fingerprint");
const {
  resolveOperatingContract,
} = require("../stabilisation/operating-contract");
const {
  assessPublicationEvidence,
} = require("./publication-evidence-gates");
const {
  evaluateRendererManifest,
} = require("../stabilisation/renderer-governance");

const ADMISSION_WINDOW_DRIFT_MS = 15 * 60 * 1000;
const ADMISSION_LATE_TOLERANCE_MS = 60 * 1000;
const GUARDED_UTC_HOURS = new Set([9, 19]);

function text(value) {
  return String(value || "").trim();
}

function buildImmutablePublicationEvidence({
  evidence = {},
  evidenceAssessment = null,
  rendererEvaluation = null,
  operatingMode = "LOCAL_PROOF",
} = {}) {
  const assessedEvidence =
    evidenceAssessment || assessPublicationEvidence(evidence);
  const assessedRenderer =
    rendererEvaluation ||
    evaluateRendererManifest(evidence?.renderer_manifest, {
      operatingMode,
    });
  return {
    schema_version: "pulse-publication-evidence-v1",
    source_evidence_sha256: text(evidence?.source_evidence_sha256),
    qa_report_sha256: text(evidence?.qa_report_sha256),
    originality_transformation:
      assessedEvidence.stateEvidence.ASSETS_CLEARED
        .originality_transformation,
    rights_ledger_sha256:
      assessedEvidence.stateEvidence.ASSETS_CLEARED
        .rights_ledger_sha256,
    synthetic_media_disclosure:
      assessedEvidence.stateEvidence.HUMAN_APPROVED
        .synthetic_media_disclosure,
    renderer_manifest_sha256: assessedRenderer.manifest_sha256,
    renderer: assessedRenderer.renderer,
  };
}

function sha256(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
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
  evidenceAssessment,
  rendererEvaluation,
}) {
  const blockers = [];
  if (!story) return ["publication_story_not_found"];
  if (text(confirmationStoryId) !== text(story.id)) {
    blockers.push("matching_story_confirmation_required");
  }
  if (!text(actorId)) blockers.push("operator_identity_required");
  if (!text(reason)) blockers.push("operator_reason_required");
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
  if (
    text(evidence?.renderer_manifest?.story_id) !== text(story.id)
  ) {
    blockers.push("renderer_story_identity_mismatch");
  }
  if (
    text(evidence?.renderer_manifest?.channel_id) !== text(channelId)
  ) {
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
    if (
      !GUARDED_UTC_HOURS.has(schedule.getUTCHours()) ||
      schedule.getUTCMinutes() !== 0 ||
      schedule.getUTCSeconds() !== 0 ||
      schedule.getUTCMilliseconds() !== 0
    ) {
      blockers.push("schedule_outside_guarded_youtube_windows");
    }
    const untilScheduledMs =
      schedule.getTime() - effectiveNow.getTime();
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
} = {}) {
  if (
    !repos?.db ||
    !repos?.stories ||
    !repos?.publicationGovernance
  ) {
    throw new Error("publication_admission_repositories_required");
  }
  if (platform !== "youtube") {
    return {
      admitted: false,
      blockers: ["platform_outside_stabilisation_scope"],
    };
  }
  const story = repos.stories.get(storyId);
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
    evidenceAssessment,
    rendererEvaluation,
  });
  if (blockers.length) {
    return { admitted: false, blockers };
  }

  const immutablePublicationEvidence = buildImmutablePublicationEvidence({
    evidence,
    evidenceAssessment,
    rendererEvaluation,
    operatingMode: operatingContract.mode,
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
  const operationKey =
    `${platform}:${text(story.id)}:${scheduledAt}`;
  const governance = repos.publicationGovernance;
  const transaction = repos.db.transaction(() => {
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
          evidenceAssessment.stateEvidence.ASSETS_CLEARED
            .rights_ledger_sha256,
        qa_report_sha256: text(evidence.qa_report_sha256),
        media_sha256: fingerprint.media_sha256,
        script_sha256: fingerprint.script_sha256,
        request_fingerprint: fingerprint.request_fingerprint,
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
      ["DISCOVERED", {
        source_discovered: true,
        source_evidence_sha256: text(evidence.source_evidence_sha256),
      }],
      ["VERIFIED", {
        source_verified: true,
        source_evidence_sha256: text(evidence.source_evidence_sha256),
      }],
      ["EDITORIALLY_APPROVED", {
        editorial_approved: true,
      }],
      ["SCRIPT_READY", {
        script_ready: true,
        script_sha256: fingerprint.script_sha256,
      }],
      ["ASSETS_CLEARED", {
        rights_cleared: true,
        ...evidenceAssessment.stateEvidence.ASSETS_CLEARED,
      }],
      ["RENDERED", {
        rendered_artifact_verified: true,
        media_sha256: fingerprint.media_sha256,
        renderer_manifest_sha256: rendererEvaluation.manifest_sha256,
        renderer: rendererEvaluation.renderer,
        renderer_governance: {
          verdict: rendererEvaluation.verdict,
          evidence: rendererEvaluation.evidence,
        },
      }],
      ["QA_PASSED", {
        qa_passed: true,
        qa_report_sha256: text(evidence.qa_report_sha256),
      }],
      ["HUMAN_APPROVED", {
        human_review_complete: true,
        operator_decision_id: decision.id,
        ...evidenceAssessment.stateEvidence.HUMAN_APPROVED,
      }],
      ["SCHEDULED", {
        schedule_verified: true,
        control_tower_verdict: "GREEN",
        control_tower_checked_at: effectiveNow.toISOString(),
        scheduled_for: scheduledAt,
        kill_switch_healthy: true,
        operating_contract_valid: true,
        dispatch_idempotency_key: operationKey,
        request_fingerprint: fingerprint.request_fingerprint,
        publication_evidence: immutablePublicationEvidence,
      }],
    ];
    for (const [state, stateEvidence] of states) {
      governance.appendLifecycle({
        ...common,
        toState: state,
        actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
        actorId: state === "HUMAN_APPROVED" ? text(actorId) : null,
        operatorDecisionId:
          state === "HUMAN_APPROVED" ? decision.id : null,
        evidence: stateEvidence,
        idempotencyKey: `${operationKey}:lifecycle:${state}`,
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
      media_sha256: fingerprint.media_sha256,
      script_sha256: fingerprint.script_sha256,
      renderer_manifest_sha256: rendererEvaluation.manifest_sha256,
      publication_evidence: immutablePublicationEvidence,
      operator_decision_id: decision.id,
      lifecycle_state: governance.getState(story.id, platform)
        ?.lifecycle_state,
      blockers: [],
    };
  });
  return transaction.immediate();
}

module.exports = {
  ADMISSION_WINDOW_DRIFT_MS,
  ADMISSION_LATE_TOLERANCE_MS,
  GUARDED_UTC_HOURS,
  admissionBlockers,
  admitPublication,
  buildImmutablePublicationEvidence,
};
