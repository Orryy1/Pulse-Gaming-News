"use strict";

const crypto = require("node:crypto");

const {
  assessEvergreenVerdictCandidate,
} = require("../formats/evergreen-verdict-short");

const SCHEMA_VERSION =
  "pulse-governed-multi-lane-candidate-eligibility-v1";
const BREAKING_CURRENT_WINDOW_HOURS = 72;
const BREAKING_SCORE_FLOOR = 80;
const BREAKING_POST_PRODUCTION_STAGES = new Set([
  "QA_PASSED",
  "HUMAN_APPROVED",
  "SCHEDULED",
]);

function text(value) {
  return String(value ?? "").trim();
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function normaliseSha256(value) {
  const hash = text(value).toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : null;
}

function normaliseDigest(value) {
  return normaliseSha256(text(value).replace(/^sha256:/i, ""));
}

function isHttps(value) {
  try {
    return new URL(text(value)).protocol === "https:";
  } catch {
    return false;
  }
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function sourceEvidenceBlockers(evidence) {
  if (!object(evidence)) {
    return ["governed_source_evidence_required"];
  }
  const blockers = [];
  if (text(evidence.verification_status).toUpperCase() !== "CONFIRMED") {
    blockers.push("source_evidence_confirmation_required");
  }
  if (evidence.verified_for_planning !== true) {
    blockers.push("source_evidence_verified_for_planning_required");
  }
  if (!isHttps(evidence.primary_source_url)) {
    blockers.push("source_evidence_primary_https_url_required");
  }
  if (!normaliseSha256(evidence.source_evidence_sha256)) {
    blockers.push("source_evidence_sha256_required");
  }
  if (!text(evidence.path)) {
    blockers.push("source_evidence_path_required");
  }
  if (!normaliseSha256(evidence.file_sha256)) {
    blockers.push("source_evidence_file_sha256_required");
  }
  return blockers;
}

function sourceEvidenceFromCandidate(candidate) {
  const nested = object(candidate?.governed_source_evidence);
  if (nested) return nested;
  const hasFlatBinding = [
    candidate?.source_evidence_sha256,
    candidate?.source_evidence_path,
    candidate?.source_evidence_file_sha256,
  ].some((value) => text(value));
  if (!hasFlatBinding) return null;
  return {
    verification_status: text(candidate?.verification_status),
    verified_for_planning:
      candidate?.verified_for_planning === true,
    primary_source_url: text(candidate?.primary_source_url),
    source_evidence_sha256: text(
      candidate?.source_evidence_sha256,
    ).toLowerCase(),
    path: text(candidate?.source_evidence_path),
    file_sha256: text(
      candidate?.source_evidence_file_sha256,
    ).toLowerCase(),
  };
}

function urgentTargetFrom(plannerPayload) {
  const nested = object(plannerPayload?.exact_urgent_target);
  if (
    nested &&
    text(nested.lane_id) === "breaking_short" &&
    text(nested.story_id)
  ) {
    return nested;
  }
  const storyId = text(plannerPayload?.breaking_story_id);
  if (!storyId) return null;
  const verificationStatus = text(
    plannerPayload?.verification_status,
  ).toUpperCase();
  return {
    lane_id: "breaking_short",
    story_id: storyId,
    source_evidence: {
      verification_status: verificationStatus,
      verified_for_planning: verificationStatus === "CONFIRMED",
      primary_source_url: text(
        plannerPayload?.primary_source_url,
      ),
      source_evidence_sha256: text(
        plannerPayload?.source_evidence_sha256,
      ).toLowerCase(),
      path: text(plannerPayload?.source_evidence_path),
      file_sha256: text(
        plannerPayload?.source_evidence_file_sha256,
      ).toLowerCase(),
    },
  };
}

function evergreenPitchAssessment(candidate, now) {
  const manifest = object(candidate?.evergreen_pitch_manifest);
  const directPitch = object(candidate?.evergreen_pitch);
  const directProvenance = object(
    candidate?.evidence_provenance ||
      candidate?.evergreen_evidence_provenance,
  );
  if (!manifest && (!directPitch || !directProvenance)) {
    return {
      blockers: ["governed_evergreen_pitch_manifest_required"],
      pitch: null,
      pitchSha256: null,
      sourcePacketSha256: null,
      rightsLedgerSha256: null,
    };
  }
  const blockers = [];
  if (
    manifest &&
    manifest.schema_version !== "pulse-evergreen-pitch-v1"
  ) {
    blockers.push("governed_evergreen_pitch_manifest_schema_invalid");
  }
  const storyId = text(candidate?.story_id);
  if (
    manifest &&
    text(manifest.origin_story_id) !== storyId
  ) {
    blockers.push("governed_evergreen_pitch_story_id_mismatch");
  }
  const pitch =
    object(manifest?.evergreen_pitch) || directPitch;
  if (!pitch) {
    blockers.push("governed_evergreen_pitch_required");
  } else {
    const pitchStoryId = text(
      pitch.story_id || pitch.origin_story_id,
    );
    if (pitchStoryId && pitchStoryId !== storyId) {
      blockers.push("governed_evergreen_pitch_story_id_mismatch");
    }
    const assessment = assessEvergreenVerdictCandidate(pitch, {
      now,
      history: [],
    });
    blockers.push(
      ...assessment.blockers.map(
        (blocker) => `evergreen_pitch:${blocker}`,
      ),
    );
  }
  const expectedPitchSha256 = canonicalSha256(
    manifest || pitch,
  );
  const declaredPitchSha256 = normaliseSha256(
    candidate?.pitch_sha256,
  );
  if (!declaredPitchSha256) {
    blockers.push("evergreen_pitch_sha256_required");
  } else if (declaredPitchSha256 !== expectedPitchSha256) {
    blockers.push("evergreen_pitch_sha256_mismatch");
  }
  const provenance =
    object(manifest?.evidence_provenance) ||
    directProvenance;
  if (!provenance) {
    blockers.push("evergreen_evidence_provenance_required");
  }
  const sourceEvidenceSha256 = normaliseDigest(
    provenance?.source_evidence_sha256,
  );
  const sourcePacketSha256 = normaliseSha256(
    provenance?.source_packet_sha256,
  );
  const rightsEvidenceSha256 = normaliseDigest(
    provenance?.rights_evidence_sha256,
  );
  const rightsLedgerSha256 = normaliseSha256(
    provenance?.rights_ledger_sha256,
  );
  if (!sourceEvidenceSha256) {
    blockers.push("evergreen_source_evidence_sha256_required");
  }
  if (!sourcePacketSha256) {
    blockers.push("evergreen_source_packet_sha256_required");
  }
  if (!rightsEvidenceSha256) {
    blockers.push("evergreen_rights_evidence_sha256_required");
  }
  if (!rightsLedgerSha256) {
    blockers.push("evergreen_rights_ledger_sha256_required");
  }
  if (provenance?.evidence_fields_mutated !== false) {
    blockers.push("evergreen_evidence_fields_immutable_required");
  }
  const candidateSourceSha256 = normaliseSha256(
    candidate?.source_evidence_sha256,
  );
  if (
    candidateSourceSha256 &&
    sourcePacketSha256 &&
    candidateSourceSha256 !== sourcePacketSha256
  ) {
    blockers.push("evergreen_source_packet_sha256_mismatch");
  }
  const candidateRightsSha256 = normaliseSha256(
    candidate?.rights_ledger_sha256,
  );
  if (
    candidateRightsSha256 &&
    rightsLedgerSha256 &&
    candidateRightsSha256 !== rightsLedgerSha256
  ) {
    blockers.push("evergreen_rights_ledger_sha256_mismatch");
  }
  return {
    blockers: unique(blockers),
    pitch,
    pitchSha256: declaredPitchSha256,
    sourcePacketSha256,
    rightsLedgerSha256,
  };
}

function workOrderFingerprint(workOrder) {
  const value = structuredClone(workOrder);
  delete value.work_order_sha256;
  return canonicalSha256(value);
}

function weeklyLongformWorkOrderAssessment(candidate) {
  const workOrder =
    object(candidate?.weekly_longform_work_order) ||
    object(candidate?.work_order);
  if (!workOrder) {
    return {
      blockers: [
        "governed_weekly_longform_work_order_required",
      ],
      workOrder: null,
      fileSha256: null,
    };
  }
  const blockers = [];
  if (
    workOrder.schema_version !==
    "pulse-weekly-longform-work-order-v1"
  ) {
    blockers.push(
      "governed_weekly_longform_work_order_schema_invalid",
    );
  }
  if (text(workOrder.run_id) !== text(candidate?.story_id)) {
    blockers.push(
      "governed_weekly_longform_work_order_run_id_mismatch",
    );
  }
  const declaredCanonicalSha256 = normaliseSha256(
    workOrder.work_order_sha256,
  );
  if (!declaredCanonicalSha256) {
    blockers.push(
      "governed_weekly_longform_canonical_sha256_required",
    );
  } else if (
    declaredCanonicalSha256 !== workOrderFingerprint(workOrder)
  ) {
    blockers.push(
      "governed_weekly_longform_canonical_sha256_mismatch",
    );
  }
  const reference =
    object(candidate?.weekly_longform_work_order_ref) ||
    object(candidate?.work_order_ref) ||
    (text(candidate?.work_order_path)
      ? {
          path: text(candidate.work_order_path),
          file_sha256: candidate?.work_order_sha256,
        }
      : null);
  if (!reference) {
    blockers.push(
      "governed_weekly_longform_work_order_ref_required",
    );
  }
  if (!text(reference?.path)) {
    blockers.push(
      "governed_weekly_longform_work_order_path_required",
    );
  }
  const fileSha256 = normaliseSha256(reference?.file_sha256);
  if (!fileSha256) {
    blockers.push(
      "governed_weekly_longform_work_order_file_sha256_required",
    );
  }
  const routedWorkOrderSha256 = normaliseSha256(
    candidate?.work_order_sha256,
  );
  if (!routedWorkOrderSha256) {
    blockers.push("weekly_longform_work_order_sha256_required");
  } else if (
    fileSha256 &&
    routedWorkOrderSha256 !== fileSha256
  ) {
    blockers.push("weekly_longform_work_order_sha256_mismatch");
  }
  const selected = Array.isArray(workOrder.selection?.selected)
    ? workOrder.selection.selected
    : [];
  if (selected.length < 4) {
    blockers.push(
      "weekly_longform_minimum_governed_story_set_required",
    );
  }
  for (const story of selected) {
    if (!text(story?.story_id)) {
      blockers.push("weekly_longform_story_id_required");
    }
    if (!text(story?.source_evidence?.path)) {
      blockers.push(
        "weekly_longform_source_evidence_path_required",
      );
    }
    if (!normaliseSha256(story?.source_evidence?.sha256)) {
      blockers.push(
        "weekly_longform_source_evidence_sha256_required",
      );
    }
    if (!text(story?.rights_ledger?.path)) {
      blockers.push("weekly_longform_rights_ledger_path_required");
    }
    if (!normaliseSha256(story?.rights_ledger?.sha256)) {
      blockers.push(
        "weekly_longform_rights_ledger_file_sha256_required",
      );
    }
    if (
      !normaliseSha256(story?.rights_ledger?.canonical_sha256)
    ) {
      blockers.push(
        "weekly_longform_rights_ledger_canonical_sha256_required",
      );
    }
  }
  for (const [field, blocker] of [
    [
      "external_publish_authorised",
      "weekly_longform_external_publish_authority_forbidden",
    ],
    [
      "database_mutation_authorised",
      "weekly_longform_database_mutation_authority_forbidden",
    ],
    [
      "oauth_mutation_authorised",
      "weekly_longform_oauth_mutation_authority_forbidden",
    ],
  ]) {
    if (workOrder.safety?.[field] !== false) {
      blockers.push(blocker);
    }
  }
  return {
    blockers: unique(blockers),
    workOrder,
    fileSha256,
  };
}

function candidateSummary(candidate, exactUrgentTarget, blockers) {
  return {
    lane_id: text(candidate?.lane_id),
    story_id: text(candidate?.story_id),
    stage: text(candidate?.stage).toUpperCase() || "PLANNING",
    score: finiteNumber(candidate?.score),
    exact_urgent_target: exactUrgentTarget,
    blockers: unique(blockers),
  };
}

function governMultiLaneCandidates({
  candidates = [],
  now = new Date().toISOString(),
  planner_payload: plannerPayload = {},
} = {}) {
  const generatedAt = new Date(now);
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("multi_lane_candidate_eligibility_time_invalid");
  }
  const eligibleCandidates = [];
  const rejectedCandidates = [];
  const urgentTarget = urgentTargetFrom(plannerPayload);

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const stage =
      text(candidate?.stage).toUpperCase() || "PLANNING";
    const exactUrgentTarget = Boolean(
      urgentTarget &&
        text(candidate?.lane_id) === urgentTarget.lane_id &&
        text(candidate?.story_id) === urgentTarget.story_id,
    );
    const blockers = [];
    if (
      candidate?.lane_id === "breaking_short" &&
      !BREAKING_POST_PRODUCTION_STAGES.has(stage) &&
      finiteNumber(candidate?.score) < BREAKING_SCORE_FLOOR
    ) {
      blockers.push("breaking_score_below_80");
    }
    if (
      candidate?.lane_id === "breaking_short" &&
      ["PLANNING", "SCRIPT_READY"].includes(stage)
    ) {
      const publishedAt = Date.parse(
        text(
          candidate?.published_at ||
            candidate?.timestamp ||
            candidate?.created_at,
        ),
      );
      const minimumPublishedAt =
        generatedAt.getTime() -
        BREAKING_CURRENT_WINDOW_HOURS * 60 * 60 * 1000;
      if (
        !exactUrgentTarget &&
        (!Number.isFinite(publishedAt) ||
          publishedAt < minimumPublishedAt ||
          publishedAt > generatedAt.getTime())
      ) {
        blockers.push("breaking_story_outside_current_window");
      }
    }
    let sourceEvidence = sourceEvidenceFromCandidate(candidate);
    let evergreenAssessment = null;
    let longformAssessment = null;
    if (exactUrgentTarget) {
      const boundEvidence = object(urgentTarget.source_evidence);
      const candidateHash = normaliseSha256(
        sourceEvidence?.source_evidence_sha256,
      );
      const urgentHash = normaliseSha256(
        boundEvidence?.source_evidence_sha256,
      );
      if (candidateHash && urgentHash && candidateHash !== urgentHash) {
        blockers.push(
          "exact_urgent_source_evidence_sha256_mismatch",
        );
      } else {
        sourceEvidence = boundEvidence || sourceEvidence;
      }
    }
    if (candidate?.lane_id === "breaking_short") {
      blockers.push(...sourceEvidenceBlockers(sourceEvidence));
    }
    if (candidate?.lane_id === "evergreen_short") {
      evergreenAssessment = evergreenPitchAssessment(
        candidate,
        generatedAt.toISOString(),
      );
      blockers.push(...evergreenAssessment.blockers);
    }
    if (candidate?.lane_id === "weekly_longform") {
      longformAssessment =
        weeklyLongformWorkOrderAssessment(candidate);
      blockers.push(...longformAssessment.blockers);
    }

    if (blockers.length) {
      rejectedCandidates.push(
        candidateSummary(candidate, exactUrgentTarget, blockers),
      );
    } else {
      const eligibleCandidate = {
        ...structuredClone(candidate),
        ...(sourceEvidence
          ? {
              governed_source_evidence:
                structuredClone(sourceEvidence),
            }
          : {}),
        ...(evergreenAssessment
          ? {
              evergreen_pitch: structuredClone(
                evergreenAssessment.pitch,
              ),
              pitch_sha256: evergreenAssessment.pitchSha256,
              source_evidence_sha256:
                evergreenAssessment.sourcePacketSha256,
              rights_ledger_sha256:
                evergreenAssessment.rightsLedgerSha256,
            }
          : {}),
        ...(longformAssessment
          ? {
              work_order: structuredClone(
                longformAssessment.workOrder,
              ),
              work_order_sha256:
                longformAssessment.fileSha256,
            }
          : {}),
        eligibility: {
          basis: exactUrgentTarget
            ? "EXACT_URGENT_TARGET"
            : "PERSISTED_GOVERNED_ARTIFACTS",
          exact_urgent_target: exactUrgentTarget,
          planning_window_checked: [
            "PLANNING",
            "SCRIPT_READY",
          ].includes(stage),
          ...(exactUrgentTarget &&
          ["PLANNING", "SCRIPT_READY"].includes(stage)
            ? {
                planning_window_exception:
                  "EXACT_URGENT_TARGET",
              }
            : {}),
          source_evidence_sha256:
            normaliseSha256(
              sourceEvidence?.source_evidence_sha256,
            ) || null,
          source_evidence_file_sha256:
            normaliseSha256(sourceEvidence?.file_sha256) || null,
          ...(evergreenAssessment
            ? {
                pitch_sha256:
                  evergreenAssessment.pitchSha256,
              }
            : {}),
          ...(longformAssessment
            ? {
                work_order_sha256:
                  longformAssessment.fileSha256,
              }
            : {}),
        },
      };
      eligibleCandidates.push(eligibleCandidate);
    }
  }
  eligibleCandidates.sort(
    (left, right) =>
      Number(right.eligibility.exact_urgent_target) -
        Number(left.eligibility.exact_urgent_target) ||
      finiteNumber(right.score) - finiteNumber(left.score) ||
      text(left.story_id).localeCompare(text(right.story_id)),
  );

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: generatedAt.toISOString(),
    verdict: eligibleCandidates.length ? "READY" : "HOLD",
    eligible_candidates: eligibleCandidates,
    rejected_candidates: rejectedCandidates,
  };
}

module.exports = {
  BREAKING_CURRENT_WINDOW_HOURS,
  BREAKING_SCORE_FLOOR,
  SCHEMA_VERSION,
  canonicalSha256,
  governMultiLaneCandidates,
};
