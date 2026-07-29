"use strict";

const crypto = require("node:crypto");
const {
  validateOfficialSourceReleaseBinding,
} = require("./official-source-revalidation");
const {
  youtubeAdmissionJobIdempotencyKey,
  youtubeReleaseJobIdempotencyKey,
} = require("./governed-publication-job-identity");

const GUARDED_YOUTUBE_HOURS_UTC = new Set([9, 19]);
const ADMISSION_WAKE_OFFSET_MS = 75 * 60 * 1000;
const AUTONOMOUS_APPROVAL_TYPE =
  "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";

const DEFAULT_LANE_REGISTRY = Object.freeze([
  Object.freeze({
    lane_id: "breaking_short",
    priority: 100,
    max_inflight: 2,
    production_pool: "breaking_production",
    plan_kind: "plan_breaking_short",
    produce_kind: "produce_breaking_short",
  }),
  Object.freeze({
    lane_id: "evergreen_short",
    priority: 60,
    max_inflight: 1,
    production_pool: "evergreen_production",
    plan_kind: "plan_evergreen_short",
    produce_kind: "produce_evergreen_short",
  }),
  Object.freeze({
    lane_id: "weekly_longform",
    priority: 40,
    max_inflight: 1,
    production_pool: "longform_production",
    plan_kind: "plan_weekly_longform",
    produce_kind: "produce_weekly_longform",
  }),
]);

const DEFAULT_WORKER_POOLS = Object.freeze({
  breaking_planning: Object.freeze({
    max_inflight: 2,
    accepts: Object.freeze([
      "breaking_story_discovery",
      "plan_breaking_short",
    ]),
  }),
  critical_planning: Object.freeze({
    max_inflight: 1,
    accepts: Object.freeze([
      "plan_evergreen_short",
      "plan_weekly_longform",
    ]),
  }),
  critical_publication: Object.freeze({
    max_inflight: 1,
    accepts: Object.freeze([
      "admit_governed_publication",
      "prestage_governed_youtube_release",
      "verify_governed_youtube_release_tminus15",
      "verify_governed_youtube_release_t0",
    ]),
  }),
  breaking_production: Object.freeze({
    max_inflight: 2,
    accepts: Object.freeze(["produce_breaking_short"]),
  }),
  evergreen_production: Object.freeze({
    max_inflight: 1,
    accepts: Object.freeze(["produce_evergreen_short"]),
  }),
  longform_production: Object.freeze({
    max_inflight: 1,
    accepts: Object.freeze(["produce_weekly_longform"]),
  }),
});

function text(value) {
  return String(value || "").trim();
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function candidateOrder(a, b) {
  const scoreDelta =
    finiteNumber(b?.score) - finiteNumber(a?.score);
  if (scoreDelta) return scoreDelta;
  return text(a?.story_id).localeCompare(text(b?.story_id));
}

function runtimeBlockers(runtimeControl) {
  const blockers = [];
  if (runtimeControl.operating_contract_valid !== true) {
    blockers.push("operating_contract_not_valid");
  }
  if (runtimeControl.scheduler_owner_healthy !== true) {
    blockers.push("scheduler_owner_not_healthy");
  }
  if (runtimeControl.autonomous_production_enabled !== true) {
    blockers.push("autonomous_production_not_enabled");
  }
  return blockers;
}

function scheduledBindingBlockers(candidate) {
  if (text(candidate?.stage).toUpperCase() !== "SCHEDULED") {
    return [];
  }
  const publication = candidate.publication || {};
  const blockers = [];
  if (
    publication.platform !== "youtube" ||
    text(publication.lifecycle_state).toUpperCase() !== "SCHEDULED"
  ) {
    blockers.push("scheduled_youtube_lifecycle_invalid");
  }
  const eventId = Number(publication.scheduled_event_id);
  if (!Number.isInteger(eventId) || eventId <= 0) {
    blockers.push("scheduled_event_id_required");
  }
  if (!Number.isFinite(Date.parse(text(publication.scheduled_for)))) {
    blockers.push("scheduled_for_required");
  }
  if (!text(publication.dispatch_idempotency_key)) {
    blockers.push("scheduled_dispatch_idempotency_key_required");
  }
  if (
    !/^[a-f0-9]{64}$/.test(
      text(publication.request_fingerprint).toLowerCase(),
    )
  ) {
    blockers.push("scheduled_request_fingerprint_invalid");
  }
  if (
    text(publication.control_tower_verdict).toUpperCase() !== "GREEN"
  ) {
    blockers.push("scheduled_control_tower_not_green");
  }
  return blockers;
}

function humanAdmissionBlockers(candidate) {
  const stage = text(candidate?.stage).toUpperCase();
  if (stage === "QA_PASSED") {
    return ["human_review_required_before_admission"];
  }
  if (stage !== "HUMAN_APPROVED") return [];
  if (candidate?.standby_authorised === true) {
    return [
      "standby_candidate_locked_pending_authorised_promotion",
    ];
  }
  const admission = candidate?.admission;
  if (
    !admission ||
    typeof admission !== "object" ||
    Array.isArray(admission)
  ) {
    return ["exact_human_admission_packet_required"];
  }
  const blockers = [];
  if (
    admission.approval_type === AUTONOMOUS_APPROVAL_TYPE ||
    Object.hasOwn(
      admission,
      "autonomous_publication_authority",
    )
  ) {
    blockers.push(
      "human_autonomous_approval_cross_conflation",
    );
  }
  if (text(admission.human_review_status).toLowerCase() !== "approved") {
    blockers.push("exact_human_review_status_required");
  }
  if (!text(admission.actor_id)) {
    blockers.push("exact_human_review_actor_required");
  }
  if (!text(admission.reason)) {
    blockers.push("exact_human_review_reason_required");
  }
  if (
    text(admission.confirmation_story_id) !==
    text(candidate.story_id)
  ) {
    blockers.push("exact_human_story_confirmation_required");
  }
  if (!Number.isFinite(Date.parse(text(admission.scheduled_for)))) {
    blockers.push("exact_human_schedule_required");
  }
  if (
    !admission.evidence ||
    typeof admission.evidence !== "object" ||
    Array.isArray(admission.evidence)
  ) {
    blockers.push("exact_human_publication_evidence_required");
  } else {
    const evidence = admission.evidence;
    const preflight =
      evidence.preflight_evidence &&
      typeof evidence.preflight_evidence === "object"
        ? evidence.preflight_evidence
        : {};
    const bindings =
      evidence.bindings &&
      typeof evidence.bindings === "object"
        ? evidence.bindings
        : {};
    for (const [field, currentValue, blocker] of [
      [
        "source_evidence_sha256",
        candidate.source_evidence_sha256,
        "exact_human_source_evidence_sha256_mismatch",
      ],
      [
        "script_sha256",
        candidate.script_sha256,
        "exact_human_script_sha256_mismatch",
      ],
      [
        "media_sha256",
        candidate.media_sha256,
        "exact_human_media_sha256_mismatch",
      ],
      [
        "rights_ledger_sha256",
        candidate.rights_ledger_sha256 ||
          candidate.rights_ledger_canonical_sha256,
        "exact_human_rights_ledger_sha256_mismatch",
      ],
    ]) {
      const current = exactHash(currentValue);
      if (
        current &&
        exactHash(
          evidence[field],
          preflight[field],
          bindings[field],
        ) !== current
      ) {
        blockers.push(blocker);
      }
    }
  }
  return blockers;
}

function autonomousAdmissionBlockers(candidate, now) {
  const stage = text(candidate?.stage).toUpperCase();
  if (stage !== "AUTONOMOUS_ELIGIBLE") return [];
  if (candidate?.standby_authorised === true) {
    return [
      "standby_candidate_locked_pending_authorised_promotion",
    ];
  }
  const admission = candidate?.admission;
  if (
    !admission ||
    typeof admission !== "object" ||
    Array.isArray(admission)
  ) {
    return ["exact_autonomous_admission_packet_required"];
  }
  const blockers = [];
  if (
    admission.approval_type !== AUTONOMOUS_APPROVAL_TYPE
  ) {
    blockers.push("exact_autonomous_approval_type_required");
  }
  if (admission.human_admission_required !== false) {
    blockers.push(
      "exact_autonomous_human_admission_false_required",
    );
  }
  if (
    [
      "human_review_status",
      "actor_id",
      "reason",
      "human_review_audit_id",
      "humanReviewAuditId",
    ].some((field) => Object.hasOwn(admission, field)) ||
    [
      "human_review_audit_id",
      "humanReviewAuditId",
      "human_review_status",
    ].some((field) => Object.hasOwn(candidate, field))
  ) {
    blockers.push(
      "autonomous_human_approval_cross_conflation",
    );
  }
  if (
    text(admission.confirmation_story_id) !==
    text(candidate.story_id)
  ) {
    blockers.push(
      "exact_autonomous_story_confirmation_required",
    );
  }
  if (!Number.isFinite(Date.parse(text(admission.scheduled_for)))) {
    blockers.push("exact_autonomous_schedule_required");
  }
  if (
    Object.hasOwn(admission, "autonomous_publication_authority") ||
    Object.hasOwn(candidate, "autonomous_publication_authority")
  ) {
    blockers.push(
      "preissued_autonomous_publication_authority_forbidden",
    );
  }
  const attestation =
    admission.autonomous_window_eligibility_attestation;
  const preparation = admission.jit_preparation;
  if (
    !attestation ||
    typeof attestation !== "object" ||
    Array.isArray(attestation) ||
    !preparation ||
    typeof preparation !== "object" ||
    Array.isArray(preparation)
  ) {
    blockers.push(
      "exact_autonomous_eligibility_and_jit_preparation_required",
    );
    return blockers;
  }
  let validatedPreparation = null;
  try {
    const {
      validateAutonomousOfficialJitPreparationManifest,
    } = require("./autonomous-official-jit-admission-packet");
    validatedPreparation =
      validateAutonomousOfficialJitPreparationManifest(
        preparation,
      );
  } catch (error) {
    blockers.push(
      error?.code ||
        "exact_autonomous_jit_preparation_invalid",
    );
  }
  const candidateRevisionSha256 = exactHash(
    candidate.candidate_revision_sha256,
  );
  const evidenceHashes = {
    media_sha256: exactHash(candidate.media_sha256),
    script_sha256: exactHash(candidate.script_sha256),
    qa_report_sha256: exactHash(candidate.qa_report_sha256),
    rights_ledger_sha256: exactHash(
      candidate.rights_ledger_sha256,
      candidate.rights_ledger_canonical_sha256,
    ),
    source_evidence_sha256: exactHash(
      candidate.source_evidence_sha256,
    ),
  };
  if (
    !candidateRevisionSha256 ||
    Object.values(evidenceHashes).some((value) => !value)
  ) {
    blockers.push(
      "exact_autonomous_candidate_hashes_required",
    );
  }
  if (validatedPreparation) {
    if (
      validatedPreparation.story_id !==
        text(candidate.story_id) ||
      validatedPreparation.channel_id !== "pulse-gaming" ||
      validatedPreparation.lane_id !==
        text(candidate.lane_id) ||
      validatedPreparation.platform !== "youtube" ||
      validatedPreparation.scheduled_for !==
        text(admission.scheduled_for) ||
      validatedPreparation.role !== "PRIMARY" ||
      validatedPreparation.candidate_revision_sha256 !==
        candidateRevisionSha256 ||
      exactHash(candidate.request_fingerprint) !==
        validatedPreparation.request_fingerprint ||
      exactHash(admission.jit_preparation_sha256) !==
        validatedPreparation.preparation_sha256
    ) {
      blockers.push(
        "exact_autonomous_jit_preparation_binding_mismatch",
      );
    }
    try {
      const {
        validateAutonomousWindowEligibilityAttestation,
      } = require("./governed-youtube-release-runway");
      const validatedAttestation =
        validateAutonomousWindowEligibilityAttestation(
          attestation,
          {
            now,
            expected: {
              story_id: text(candidate.story_id),
              channel_id: "pulse-gaming",
              lane_id: text(candidate.lane_id),
              platform: "youtube",
              scheduled_for: text(admission.scheduled_for),
              role: "PRIMARY",
              candidate_binding_sha256:
                exactHash(
                  candidate.candidate_binding_sha256,
                  attestation.candidate_binding_sha256,
                ),
              evidence_hashes: evidenceHashes,
              jit_preparation: validatedPreparation,
            },
          },
        );
      if (
        exactHash(
          admission.autonomous_eligibility_attestation_sha256,
        ) !==
          exactHash(
            validatedAttestation.attestation_sha256,
          ) ||
        exactHash(
          candidate.autonomous_eligibility_attestation_sha256,
          admission.autonomous_eligibility_attestation_sha256,
        ) !==
          exactHash(
            validatedAttestation.attestation_sha256,
          )
      ) {
        blockers.push(
          "exact_autonomous_eligibility_summary_mismatch",
        );
      }
    } catch (error) {
      blockers.push(
        error?.code ||
          "exact_autonomous_eligibility_attestation_invalid",
      );
    }
  }
  return [...new Set(blockers)];
}

function isExactGuardedYoutubeWindow(value) {
  const scheduledAt = new Date(value);
  return (
    !Number.isNaN(scheduledAt.getTime()) &&
    GUARDED_YOUTUBE_HOURS_UTC.has(
      scheduledAt.getUTCHours(),
    ) &&
    scheduledAt.getUTCMinutes() === 0 &&
    scheduledAt.getUTCSeconds() === 0 &&
    scheduledAt.getUTCMilliseconds() === 0
  );
}

function publicationTimingBlockers(candidate, now) {
  const stage = text(candidate?.stage).toUpperCase();
  if (
    ![
      "HUMAN_APPROVED",
      "AUTONOMOUS_ELIGIBLE",
      "SCHEDULED",
    ].includes(stage)
  ) {
    return [];
  }
  const scheduledFor =
    stage !== "SCHEDULED"
      ? candidate?.admission?.scheduled_for
      : candidate?.publication?.scheduled_for;
  const scheduledAt = new Date(scheduledFor);
  if (Number.isNaN(scheduledAt.getTime())) return [];
  const blockers = [];
  if (!isExactGuardedYoutubeWindow(scheduledAt)) {
    blockers.push(
      stage !== "SCHEDULED"
        ? "admission_time_outside_guarded_youtube_windows"
        : "scheduled_time_outside_guarded_youtube_windows",
    );
  }
  const evaluatedAt =
    now instanceof Date ? now : new Date(now);
  if (Number.isNaN(evaluatedAt.getTime())) return blockers;
  const wakeAt =
    stage !== "SCHEDULED"
      ? scheduledAt.getTime() - ADMISSION_WAKE_OFFSET_MS
      : scheduledAt.getTime();
  if (wakeAt < evaluatedAt.getTime()) {
    blockers.push(
      stage !== "SCHEDULED"
        ? "admission_wakeup_expired_no_catch_up"
        : "scheduled_window_expired_no_catch_up",
    );
  }
  return blockers;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(stableValue(value)),
    )
    .digest("hex");
}

function exactHash(...values) {
  for (const value of values) {
    const normalised = text(value).toLowerCase();
    if (/^[a-f0-9]{64}$/.test(normalised)) {
      return normalised;
    }
  }
  return null;
}

function objectHash(explicitHash, value) {
  return (
    exactHash(explicitHash) ||
    (value && typeof value === "object"
      ? sha256(value)
      : null)
  );
}

function validatedInventoryBindings(candidate = {}) {
  const bindings =
    candidate.governed_editorial_inventory_bindings;
  if (
    !bindings ||
    typeof bindings !== "object" ||
    Array.isArray(bindings) ||
    bindings.schema_version !==
      "pulse-governed-editorial-inventory-planner-bindings-v1" ||
    text(bindings.story_id) !== text(candidate.story_id)
  ) {
    return null;
  }
  const references = {};
  for (const name of [
    "inventory",
    "source_evidence",
    "rights_ledger",
  ]) {
    const reference = bindings[name];
    if (
      !reference ||
      typeof reference !== "object" ||
      Array.isArray(reference) ||
      !text(reference.path)
    ) {
      return null;
    }
    const fileSha256 = exactHash(reference.file_sha256);
    const canonicalSha256 = exactHash(
      reference.canonical_sha256,
    );
    if (!fileSha256 || !canonicalSha256) return null;
    references[name] = {
      path: text(reference.path),
      file_sha256: fileSha256,
      canonical_sha256: canonicalSha256,
    };
  }
  for (const [field, expected] of [
    [
      "source_evidence_path",
      references.source_evidence.path,
    ],
    [
      "source_evidence_file_sha256",
      references.source_evidence.file_sha256,
    ],
    [
      "source_evidence_sha256",
      references.source_evidence.canonical_sha256,
    ],
    ["rights_ledger_path", references.rights_ledger.path],
    [
      "rights_ledger_file_sha256",
      references.rights_ledger.file_sha256,
    ],
    [
      "rights_ledger_canonical_sha256",
      references.rights_ledger.canonical_sha256,
    ],
  ]) {
    const actual = field.endsWith("_path")
      ? text(candidate[field])
      : exactHash(candidate[field]);
    if (actual !== expected) return null;
  }
  if (
    exactHash(
      candidate.rights_ledger_sha256,
      candidate.rights_ledger_canonical_sha256,
    ) !== references.rights_ledger.canonical_sha256
  ) {
    return null;
  }
  const publicationSource =
    bindings.publication_source_evidence;
  if (
    !publicationSource ||
    typeof publicationSource !== "object" ||
    Array.isArray(publicationSource) ||
    !text(publicationSource.path)
  ) {
    return null;
  }
  const publicationSourceFileSha256 = exactHash(
    publicationSource.file_sha256,
  );
  const publicationSourceEvidenceSha256 = exactHash(
    publicationSource.source_evidence_sha256,
  );
  if (
    !publicationSourceFileSha256 ||
    publicationSourceFileSha256 !==
      publicationSourceEvidenceSha256 ||
    text(candidate.publication_source_evidence_path) !==
      text(publicationSource.path) ||
    exactHash(
      candidate.publication_source_evidence_file_sha256,
    ) !== publicationSourceFileSha256 ||
    exactHash(
      candidate.publication_source_evidence_sha256,
    ) !== publicationSourceEvidenceSha256
  ) {
    return null;
  }
  let officialSourceReleaseBinding;
  try {
    officialSourceReleaseBinding =
      validateOfficialSourceReleaseBinding(
        candidate.official_source_release_binding,
        {
          storyId: candidate.story_id,
          sourceEvidenceSha256:
            publicationSourceEvidenceSha256,
        },
      ).value;
    const boundBinding =
      validateOfficialSourceReleaseBinding(
        publicationSource.official_source_release_binding,
        {
          storyId: candidate.story_id,
          sourceEvidenceSha256:
            publicationSourceEvidenceSha256,
        },
      ).value;
    if (
      sha256(officialSourceReleaseBinding) !==
      sha256(boundBinding)
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    schema_version: bindings.schema_version,
    story_id: text(candidate.story_id),
    ...references,
    publication_source_evidence: {
      path: text(publicationSource.path),
      file_sha256: publicationSourceFileSha256,
      source_evidence_sha256:
        publicationSourceEvidenceSha256,
      official_source_release_binding:
        officialSourceReleaseBinding,
    },
  };
}

function validatedInventorySourceEvidence(candidate, bindings) {
  const evidence = candidate.governed_source_evidence;
  if (
    !bindings ||
    !evidence ||
    typeof evidence !== "object" ||
    Array.isArray(evidence)
  ) {
    return null;
  }
  const verificationStatus = text(
    evidence.verification_status,
  ).toUpperCase();
  const primarySourceUrl = text(evidence.primary_source_url);
  let primarySourceIsHttps = false;
  try {
    primarySourceIsHttps =
      new URL(primarySourceUrl).protocol === "https:";
  } catch {
    primarySourceIsHttps = false;
  }
  if (
    verificationStatus !== "CONFIRMED" ||
    evidence.verified_for_planning !== true ||
    !primarySourceIsHttps ||
    exactHash(evidence.source_evidence_sha256) !==
      bindings.source_evidence.canonical_sha256 ||
    text(evidence.path) !== bindings.source_evidence.path ||
    exactHash(evidence.file_sha256) !==
      bindings.source_evidence.file_sha256
  ) {
    return null;
  }
  if (
    text(candidate.verification_status).toUpperCase() !==
      verificationStatus ||
    candidate.verified_for_planning !== true ||
    text(candidate.primary_source_url) !== primarySourceUrl
  ) {
    return null;
  }
  return {
    verification_status: verificationStatus,
    verified_for_planning: true,
    primary_source_url: primarySourceUrl,
    source_evidence_sha256:
      bindings.source_evidence.canonical_sha256,
    path: bindings.source_evidence.path,
    file_sha256: bindings.source_evidence.file_sha256,
  };
}

function inventoryPlanningPayload(candidate, laneId) {
  const bindings = validatedInventoryBindings(candidate);
  if (!bindings) return {};
  const sourceEvidence = validatedInventorySourceEvidence(
    candidate,
    bindings,
  );
  const storyId = text(candidate.story_id);
  const reference = (value) => ({
    path: value.path,
    sha256: value.file_sha256,
    canonical_sha256: value.canonical_sha256,
    story_id: storyId,
    lane_id: laneId,
  });
  return {
    governed_editorial_inventory_ref: reference(
      bindings.inventory,
    ),
    source_evidence_ref: reference(
      bindings.source_evidence,
    ),
    publication_source_evidence_ref: {
      path: bindings.publication_source_evidence.path,
      sha256:
        bindings.publication_source_evidence.file_sha256,
      source_evidence_sha256:
        bindings.publication_source_evidence
          .source_evidence_sha256,
      story_id: storyId,
      lane_id: laneId,
    },
    official_source_release_binding:
      structuredClone(
        bindings.publication_source_evidence
          .official_source_release_binding,
      ),
    rights_ledger_ref: reference(bindings.rights_ledger),
    source_evidence_path: bindings.source_evidence.path,
    source_evidence_file_sha256:
      bindings.source_evidence.file_sha256,
    source_evidence_sha256:
      bindings.source_evidence.canonical_sha256,
    publication_source_evidence_path:
      bindings.publication_source_evidence.path,
    publication_source_evidence_file_sha256:
      bindings.publication_source_evidence.file_sha256,
    publication_source_evidence_sha256:
      bindings.publication_source_evidence
        .source_evidence_sha256,
    rights_ledger_path: bindings.rights_ledger.path,
    rights_ledger_file_sha256:
      bindings.rights_ledger.file_sha256,
    rights_ledger_canonical_sha256:
      bindings.rights_ledger.canonical_sha256,
    rights_ledger_sha256:
      bindings.rights_ledger.canonical_sha256,
    ...(sourceEvidence
      ? {
          verification_status:
            sourceEvidence.verification_status,
          verified_for_planning: true,
          primary_source_url:
            sourceEvidence.primary_source_url,
          governed_source_evidence:
            structuredClone(sourceEvidence),
        }
      : {}),
  };
}

function candidateRevision(candidate = {}) {
  const admissionEvidence = candidate.admission?.evidence || {};
  const workOrder =
    candidate.work_order &&
    typeof candidate.work_order === "object"
      ? candidate.work_order
      : null;
  const pitch =
    candidate.evergreen_pitch &&
    typeof candidate.evergreen_pitch === "object"
      ? candidate.evergreen_pitch
      : candidate.pitch &&
          typeof candidate.pitch === "object"
        ? candidate.pitch
        : null;
  const bindings = {
    schema_version: "pulse-multi-lane-candidate-revision-v1",
    stage: text(candidate.stage).toUpperCase() || "PLANNING",
    source_evidence_sha256: exactHash(
      candidate.source_evidence_sha256,
      candidate.evidence_provenance?.source_evidence_sha256,
      admissionEvidence.source_evidence_sha256,
    ),
    publication_source_evidence_sha256: exactHash(
      candidate.publication_source_evidence_sha256,
      admissionEvidence.source_evidence_sha256,
    ),
    script_sha256: exactHash(
      candidate.script_sha256,
      workOrder?.script_sha256,
      admissionEvidence.script_sha256,
    ),
    media_sha256: exactHash(
      candidate.media_sha256,
      admissionEvidence.media_sha256,
    ),
    rights_ledger_sha256: exactHash(
      candidate.rights_ledger_sha256,
      candidate.rights_ledger_canonical_sha256,
      admissionEvidence.rights_ledger_sha256,
    ),
    pitch_sha256: objectHash(
      candidate.pitch_sha256,
      pitch,
    ),
    work_order_sha256: objectHash(
      candidate.work_order_sha256,
      workOrder,
    ),
    ...(candidate.admission &&
    typeof candidate.admission === "object" &&
    !Array.isArray(candidate.admission)
      ? {
          admission_sha256: sha256(candidate.admission),
        }
      : {}),
    ...(validatedInventoryBindings(candidate)
      ? {
          editorial_inventory_sha256:
            validatedInventoryBindings(candidate).inventory
              .canonical_sha256,
        }
      : {}),
  };
  return {
    bindings,
    sha256: sha256(bindings),
  };
}

function routeCandidate(lane, candidate) {
  const stage = text(candidate.stage).toUpperCase();
  const revision = candidateRevision(candidate);
  const planningEvidence = inventoryPlanningPayload(
    candidate,
    lane.lane_id,
  );
  if (!stage || stage === "PLANNING") {
    return {
      kind: lane.plan_kind,
      worker_pool:
        lane.lane_id === "breaking_short"
          ? "breaking_planning"
          : "critical_planning",
      idempotency_key:
        `plan:${lane.lane_id}:${text(candidate.story_id)}:` +
        revision.sha256,
      payload: {
        lane_id: lane.lane_id,
        story_id: text(candidate.story_id),
        candidate_revision_sha256: revision.sha256,
        candidate_revision: revision.bindings,
        ...planningEvidence,
        publish_authority: false,
        human_review_required: true,
      },
    };
  }
  if (stage === "SCHEDULED") {
    const publication = candidate.publication || {};
    const fingerprint = text(publication.request_fingerprint).toLowerCase();
    return {
      kind: "verify_governed_youtube_release_t0",
      worker_pool: "critical_publication",
      idempotency_key:
        youtubeReleaseJobIdempotencyKey({
          phase: "T0",
          scheduledEventId:
            Number(publication.scheduled_event_id),
          requestFingerprint: fingerprint,
        }),
      run_at: new Date(publication.scheduled_for).toISOString(),
      payload: {
        lane_id: lane.lane_id,
        story_id: text(candidate.story_id),
        platform: "youtube",
        scheduled_event_id: Number(publication.scheduled_event_id),
        scheduled_for: text(publication.scheduled_for),
        dispatch_idempotency_key: text(
          publication.dispatch_idempotency_key,
        ),
        request_fingerprint: fingerprint,
        public_verification_only: true,
        catch_up_allowed: false,
        publish_authority: false,
        guarded_dispatch_authority: true,
      },
    };
  }
  if (
    ["HUMAN_APPROVED", "AUTONOMOUS_ELIGIBLE"].includes(
      stage,
    )
  ) {
    if (candidate.standby_authorised === true) {
      return null;
    }
    const autonomous = stage === "AUTONOMOUS_ELIGIBLE";
    const revisionSha256 = autonomous
      ? exactHash(candidate.candidate_revision_sha256)
      : revision.sha256;
    const scheduledAt = new Date(candidate.admission.scheduled_for);
    return {
      kind: "admit_governed_publication",
      worker_pool: "critical_publication",
      idempotency_key: youtubeAdmissionJobIdempotencyKey({
        laneId: lane.lane_id,
        storyId: text(candidate.story_id),
        candidateRevisionSha256: revisionSha256,
        scheduledFor: scheduledAt,
      }),
      run_at: new Date(
        scheduledAt.getTime() - ADMISSION_WAKE_OFFSET_MS,
      ).toISOString(),
      payload: {
        lane_id: lane.lane_id,
        story_id: text(candidate.story_id),
        platform: "youtube",
        human_admission_required: !autonomous,
        guarded_admission_authority: true,
        candidate_revision_sha256: revisionSha256,
        candidate_revision: revision.bindings,
        admission: structuredClone(candidate.admission),
        ...(autonomous
          ? {
              autonomous_jit_materialisation_required: true,
              publish_authority: false,
              external_posting: false,
            }
          : {}),
      },
    };
  }
  return {
    kind: lane.produce_kind,
    worker_pool: lane.production_pool,
    idempotency_key:
      `produce:${lane.lane_id}:${text(candidate.story_id)}:` +
      revision.sha256,
    payload: {
      lane_id: lane.lane_id,
      story_id: text(candidate.story_id),
      candidate_revision_sha256: revision.sha256,
      candidate_revision: revision.bindings,
      ...planningEvidence,
      publish_authority: false,
      human_review_required: true,
    },
  };
}

function evaluateCandidateRoute({
  lane,
  candidate,
  workerPools,
  inflightByPool,
  runtimeControl,
  activeIdempotencyKeys,
  now,
}) {
  const blockers = [
    ...scheduledBindingBlockers(candidate),
    ...humanAdmissionBlockers(candidate),
    ...autonomousAdmissionBlockers(candidate, now),
    ...publicationTimingBlockers(candidate, now),
  ];
  const publicationStage = [
    "HUMAN_APPROVED",
    "AUTONOMOUS_ELIGIBLE",
    "SCHEDULED",
  ].includes(text(candidate?.stage).toUpperCase());
  if (
    publicationStage &&
    runtimeControl.kill_switch_healthy !== true
  ) {
    blockers.push("global_kill_switch_not_healthy");
  }
  if (
    publicationStage &&
    runtimeControl.live_publish_enabled !== true
  ) {
    blockers.push("live_publish_not_enabled");
  }
  const nextJob = blockers.length
    ? null
    : routeCandidate(lane, candidate);
  const targetPool = nextJob?.worker_pool;
  if (
    targetPool &&
    finiteNumber(inflightByPool[targetPool]) >=
      finiteNumber(workerPools[targetPool]?.max_inflight)
  ) {
    blockers.push("worker_pool_saturated");
  }
  const existingJobKey =
    nextJob &&
    activeIdempotencyKeys.has(nextJob.idempotency_key)
      ? nextJob.idempotency_key
      : null;
  if (existingJobKey) {
    blockers.push("idempotent_job_already_active");
  }
  return {
    blockers: [...new Set(blockers)],
    next_job: blockers.length ? null : nextJob,
    existing_job_key: existingJobKey,
  };
}

function buildGovernedLaneRoutingPlan({
  now = new Date().toISOString(),
  laneRegistry = DEFAULT_LANE_REGISTRY,
  workerPools = DEFAULT_WORKER_POOLS,
  candidates = [],
  runtimeControl = {},
  queueState = {},
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("multi_lane_routing_time_invalid");
  }
  const inflightByPool = queueState.inflight_by_pool || {};
  const inflightByLane = queueState.inflight_by_lane || {};
  const globalBlockers = runtimeBlockers(runtimeControl);
  const activeIdempotencyKeys = new Set(
    (queueState.active_idempotency_keys || []).map(text).filter(Boolean),
  );
  const lanes = [...laneRegistry]
    .sort((a, b) => b.priority - a.priority)
    .map((lane) => {
      const laneCandidates = candidates
        .filter((item) => item?.lane_id === lane.lane_id)
        .sort(candidateOrder);
      const laneBlockers = [...globalBlockers];
      if (!laneCandidates.length) {
        laneBlockers.push("lane_candidate_required");
      }
      if (
        finiteNumber(inflightByLane[lane.lane_id]) >=
        finiteNumber(lane.max_inflight)
      ) {
        laneBlockers.push("lane_max_inflight_reached");
      }

      let selectedCandidate = null;
      let selectedRoute = null;
      const heldCandidates = [];
      if (laneBlockers.length === 0) {
        for (const candidate of laneCandidates) {
          const route = evaluateCandidateRoute({
            lane,
            candidate,
            workerPools,
            inflightByPool,
            runtimeControl,
            activeIdempotencyKeys,
            now: generatedAt,
          });
          if (route.blockers.length === 0) {
            selectedCandidate = candidate;
            selectedRoute = route;
            break;
          }
          heldCandidates.push({
            story_id: text(candidate.story_id),
            stage:
              text(candidate.stage).toUpperCase() || "PLANNING",
            score: finiteNumber(candidate.score),
            blockers: route.blockers,
          });
        }
      } else if (laneCandidates.length) {
        const candidate = laneCandidates[0];
        const route = evaluateCandidateRoute({
          lane,
          candidate,
          workerPools,
          inflightByPool,
          runtimeControl,
          activeIdempotencyKeys,
          now: generatedAt,
        });
        heldCandidates.push({
          story_id: text(candidate.story_id),
          stage:
            text(candidate.stage).toUpperCase() || "PLANNING",
          score: finiteNumber(candidate.score),
          blockers: route.blockers,
        });
      }

      const fallbackCandidate =
        selectedCandidate || laneCandidates[0] || null;
      const firstHeld = heldCandidates[0] || null;
      const blockers = selectedCandidate
        ? [...new Set(laneBlockers)]
        : [
            ...new Set([
              ...laneBlockers,
              ...(firstHeld?.blockers || []),
            ]),
          ];
      const existingJobKey =
        selectedRoute?.existing_job_key ||
        (!selectedCandidate && firstHeld
          ? evaluateCandidateRoute({
              lane,
              candidate: laneCandidates[0],
              workerPools,
              inflightByPool,
              runtimeControl,
              activeIdempotencyKeys,
            }).existing_job_key
          : null);
      return {
        lane_id: lane.lane_id,
        priority: lane.priority,
        max_inflight: lane.max_inflight,
        production_pool: lane.production_pool,
        verdict:
          selectedCandidate && blockers.length === 0
            ? "GREEN"
            : "HOLD",
        blockers,
        candidate: fallbackCandidate
          ? { story_id: text(fallbackCandidate.story_id) }
          : null,
        held_candidates: heldCandidates,
        next_job:
          selectedCandidate && blockers.length === 0
            ? selectedRoute.next_job
            : null,
        existing_job_key: existingJobKey,
      };
    });

  return {
    schema_version: "pulse-multi-lane-job-routing-v1",
    generated_at: generatedAt.toISOString(),
    verdict:
      globalBlockers.length === 0 &&
      lanes.some((lane) => lane.verdict === "GREEN")
        ? "GREEN"
        : "HOLD",
    global_blockers: globalBlockers,
    lanes,
    worker_pools: Object.fromEntries(
      Object.entries(workerPools).map(([poolId, pool]) => [
        poolId,
        {
          max_inflight: pool.max_inflight,
          accepts: [...(pool.accepts || [])],
        },
      ]),
    ),
    safety: {
      production_continues_when_publish_held: true,
      exact_publication_binding_required: true,
      generic_publish_jobs_allowed: false,
    },
  };
}

module.exports = {
  DEFAULT_LANE_REGISTRY,
  DEFAULT_WORKER_POOLS,
  buildCandidateRevision: candidateRevision,
  buildGovernedLaneRoutingPlan,
};
