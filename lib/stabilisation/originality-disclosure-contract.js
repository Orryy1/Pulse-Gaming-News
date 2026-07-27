"use strict";

const ORIGINALITY_VERDICTS = Object.freeze([
  "STRONG",
  "ADEQUATE",
  "WEAK",
  "REUSED_CONTENT_RISK",
]);

const PASSING_ORIGINALITY_VERDICTS = new Set(["STRONG", "ADEQUATE"]);
const OPERATOR_DECISIONS = Object.freeze([
  "DISCLOSE",
  "DO_NOT_DISCLOSE",
  "ESCALATE",
]);

function textPresent(value) {
  return String(value || "").trim().length > 0;
}

function isIsoDate(value) {
  if (!textPresent(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function validateTransformation(manifest, blockers) {
  const verdict = String(
    manifest.originality_and_transformation_verdict || "",
  ).trim();
  const evidence = manifest.transformation_evidence || {};

  if (!ORIGINALITY_VERDICTS.includes(verdict)) {
    blockers.push("originality:verdict_missing_or_invalid");
  } else if (!PASSING_ORIGINALITY_VERDICTS.has(verdict)) {
    blockers.push("originality:verdict_not_publishable");
  }

  for (const field of [
    "distinct_editorial_claim",
    "player_facing_conclusion",
    "original_analysis_or_comparison",
  ]) {
    if (!textPresent(evidence[field])) {
      blockers.push(`originality:${field}_missing`);
    }
  }

  for (const field of [
    "source_footage_meaningfully_restructured",
    "pulse_context_visible",
    "visibly_different_from_source",
  ]) {
    if (evidence[field] !== true) {
      blockers.push(`originality:${field}_not_proven`);
    }
  }

  if (evidence.narrated_source_reading_only !== false) {
    blockers.push("originality:narrated_source_reading_only");
  }
}

function validateSyntheticDisclosure(manifest, blockers) {
  const required = manifest.synthetic_disclosure_required;
  const decision = String(manifest.operator_decision || "").trim();

  if (typeof required !== "boolean") {
    blockers.push("synthetic_disclosure:required_flag_missing");
  }
  if (!textPresent(manifest.reason)) {
    blockers.push("synthetic_disclosure:reason_missing");
  }
  if (!OPERATOR_DECISIONS.includes(decision)) {
    blockers.push("synthetic_disclosure:operator_decision_missing_or_invalid");
  } else if (decision === "ESCALATE") {
    blockers.push("synthetic_disclosure:operator_escalation_open");
  }
  if (typeof manifest.youtube_field_value !== "boolean") {
    blockers.push("synthetic_disclosure:youtube_field_value_missing");
  }
  if (!isIsoDate(manifest.reviewed_at)) {
    blockers.push("synthetic_disclosure:reviewed_at_missing_or_invalid");
  }

  if (
    required === true &&
    (decision !== "DISCLOSE" || manifest.youtube_field_value !== true)
  ) {
    blockers.push("synthetic_disclosure:required_disclosure_not_enabled");
  }
  if (
    required === false &&
    decision === "DO_NOT_DISCLOSE" &&
    manifest.youtube_field_value !== false
  ) {
    blockers.push("synthetic_disclosure:operator_decision_field_mismatch");
  }
  if (decision === "DISCLOSE" && manifest.youtube_field_value !== true) {
    blockers.push("synthetic_disclosure:operator_decision_field_mismatch");
  }
}

function validateOriginalityAndDisclosure(manifest = {}) {
  const blockers = [];
  validateTransformation(manifest, blockers);
  validateSyntheticDisclosure(manifest, blockers);

  return {
    status: blockers.length ? "blocked" : "pass",
    blockers: [...new Set(blockers)],
  };
}

module.exports = {
  OPERATOR_DECISIONS,
  ORIGINALITY_VERDICTS,
  validateOriginalityAndDisclosure,
};
