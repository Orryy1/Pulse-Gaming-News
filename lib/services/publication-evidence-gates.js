"use strict";

/**
 * Publication evidence gates.
 *
 * This module is deliberately persistence-agnostic. Admission can evaluate
 * one submitted evidence package, fail closed on the returned blockers and
 * then copy `stateEvidence` into the immutable lifecycle/audit records.
 */

const crypto = require("node:crypto");

const ACCEPTED_TRANSFORMATION_VERDICTS = new Set(["STRONG", "ADEQUATE"]);
const ACCEPTED_RIGHTS_BASES = new Set([
  "OWNED",
  "LICENSED",
  "PERMISSION_GRANTED",
  "PUBLIC_DOMAIN",
  "PLATFORM_AUTHORISED",
  "TRANSFORMATIVE_EDITORIAL_USE",
]);
const ATTRIBUTION_DECISIONS = new Set([
  "NOT_REQUIRED",
  "REQUIRED_AND_SUPPLIED",
]);
const RIGHTS_DECISIONS = new Set(["CLEARED", "EXCLUDED", "BLOCKED"]);

function text(value) {
  return String(value || "").trim();
}

function sha256(value) {
  return /^[a-f0-9]{64}$/i.test(text(value));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function assessOriginalityTransformation(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const verdict = text(input.verdict).toUpperCase();
  const decision = {
    verdict,
    rationale: text(input.rationale),
    evidence_ref: text(input.evidence_ref),
    evidence_sha256: text(input.evidence_sha256).toLowerCase(),
  };
  const blockers = [];

  if (verdict === "WEAK") {
    blockers.push("originality_transformation_weak");
  } else if (!ACCEPTED_TRANSFORMATION_VERDICTS.has(verdict)) {
    blockers.push("originality_transformation_verdict_required");
  }
  if (
    !decision.rationale ||
    !decision.evidence_ref ||
    !sha256(decision.evidence_sha256)
  ) {
    blockers.push("originality_transformation_evidence_required");
  }

  return {
    blockers: [...new Set(blockers)],
    decision,
  };
}

function normaliseRightsItem(value) {
  const item =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rightsEvidence =
    item.rights_evidence &&
    typeof item.rights_evidence === "object" &&
    !Array.isArray(item.rights_evidence)
      ? item.rights_evidence
      : {};
  return {
    item_id: text(item.item_id),
    source_url: text(item.source_url),
    asset_sha256: text(item.asset_sha256).toLowerCase(),
    included_in_final: item.included_in_final === true,
    rights_decision: text(item.rights_decision).toUpperCase(),
    rights_basis: text(item.rights_basis).toUpperCase(),
    rights_evidence: {
      reference: text(rightsEvidence.reference),
      sha256: text(rightsEvidence.sha256).toLowerCase(),
    },
    attribution_decision: text(item.attribution_decision).toUpperCase(),
    attribution_text: text(item.attribution_text) || null,
  };
}

function canonicalRightsLedger(value) {
  const ledger =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const items = Array.isArray(ledger.items)
    ? ledger.items.map(normaliseRightsItem)
    : [];
  items.sort((left, right) => left.item_id.localeCompare(right.item_id));
  return stableValue({
    ledger_version: Number(ledger.ledger_version) || 0,
    decision: text(ledger.decision).toUpperCase(),
    items,
  });
}

function hashRightsLedger(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalRightsLedger(value)))
    .digest("hex");
}

function assessRightsLedger(value, expectedSha256) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rawItems = Array.isArray(input.items) ? input.items : [];
  const decision = canonicalRightsLedger(input);
  const blockers = [];

  if (decision.ledger_version < 1) {
    blockers.push("rights_ledger_version_required");
  }
  if (decision.decision !== "CLEARED") {
    blockers.push("rights_ledger_not_cleared");
  }
  if (!rawItems.length) {
    blockers.push("rights_ledger_items_required");
  }
  if (!sha256(expectedSha256)) {
    blockers.push("rights_ledger_hash_required");
  } else if (
    hashRightsLedger(decision) !== text(expectedSha256).toLowerCase()
  ) {
    blockers.push("rights_ledger_hash_mismatch");
  }

  const seenItemIds = new Set();
  let includedItemCount = 0;
  for (let index = 0; index < rawItems.length; index += 1) {
    const raw =
      rawItems[index] &&
      typeof rawItems[index] === "object" &&
      !Array.isArray(rawItems[index])
        ? rawItems[index]
        : {};
    const item = normaliseRightsItem(raw);
    if (!item.item_id) {
      blockers.push("rights_ledger_item_identity_required");
    } else if (seenItemIds.has(item.item_id)) {
      blockers.push("rights_ledger_item_identity_duplicate");
    } else {
      seenItemIds.add(item.item_id);
    }
    if (!item.source_url) blockers.push("rights_ledger_item_source_required");
    if (!sha256(item.asset_sha256)) {
      blockers.push("rights_ledger_item_hash_required");
    }
    if (typeof raw.included_in_final !== "boolean") {
      blockers.push("rights_ledger_item_inclusion_decision_required");
    }
    if (!RIGHTS_DECISIONS.has(item.rights_decision)) {
      blockers.push("rights_ledger_item_decision_required");
    }
    if (!ATTRIBUTION_DECISIONS.has(item.attribution_decision)) {
      blockers.push("rights_ledger_attribution_decision_required");
    }
    if (
      item.attribution_decision === "REQUIRED_AND_SUPPLIED" &&
      !item.attribution_text
    ) {
      blockers.push("rights_ledger_attribution_text_required");
    }

    const attributionOnly =
      ["ATTRIBUTION", "ATTRIBUTION_ONLY", "CREDIT", "CREDIT_ONLY"].includes(
        item.rights_basis,
      ) ||
      (!item.rights_basis &&
        item.attribution_decision === "REQUIRED_AND_SUPPLIED");
    if (attributionOnly) blockers.push("attribution_is_not_permission");

    if (item.included_in_final) {
      includedItemCount += 1;
      if (item.rights_decision !== "CLEARED") {
        blockers.push("rights_ledger_included_item_not_cleared");
      }
      if (!ACCEPTED_RIGHTS_BASES.has(item.rights_basis)) {
        blockers.push("rights_ledger_item_basis_required");
      }
      if (
        !item.rights_evidence.reference ||
        !sha256(item.rights_evidence.sha256)
      ) {
        blockers.push("rights_ledger_permission_evidence_required");
      }
    } else if (
      item.rights_decision !== "EXCLUDED" &&
      item.rights_decision !== "BLOCKED"
    ) {
      blockers.push("rights_ledger_excluded_item_decision_required");
    }
  }
  if (rawItems.length && includedItemCount === 0) {
    blockers.push("rights_ledger_included_item_required");
  }

  return {
    blockers: [...new Set(blockers)],
    decision,
    sha256: hashRightsLedger(decision),
  };
}

/**
 * Assess the complete rights/originality/disclosure package.
 *
 * `stateEvidence` intentionally contains the reviewed decisions but does not
 * set `rights_cleared` or `human_review_complete`; the admission transaction
 * owns those state assertions and must only make them when `eligible` is true.
 */
function assessPublicationEvidence(evidence = {}) {
  const input =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? evidence
      : {};
  const originality = assessOriginalityTransformation(
    input.originality_transformation,
  );
  const rights = assessRightsLedger(
    input.rights_ledger,
    input.rights_ledger_sha256,
  );
  const synthetic = assessSyntheticMediaDisclosure(
    input.synthetic_media_disclosure,
  );
  const blockers = [
    ...new Set([
      ...originality.blockers,
      ...rights.blockers,
      ...synthetic.blockers,
    ]),
  ];
  const stateEvidence = {
    ASSETS_CLEARED: {
      originality_transformation: originality.decision,
      rights_ledger_sha256: rights.sha256,
      rights_ledger: rights.decision,
    },
    HUMAN_APPROVED: {
      synthetic_media_disclosure: synthetic.decision,
    },
  };

  return {
    blockers,
    eligible: blockers.length === 0,
    normalized: {
      ...stateEvidence.ASSETS_CLEARED,
      ...stateEvidence.HUMAN_APPROVED,
    },
    stateEvidence,
  };
}

function assessSyntheticMediaDisclosure(value) {
  const input =
    value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const operatorDecision = text(input.decision).toUpperCase();
  const rationale = text(input.rationale || input.reason);
  const reviewedAt = new Date(input.reviewed_at);
  const reviewedAtIso =
    input.reviewed_at && !Number.isNaN(reviewedAt.getTime())
      ? reviewedAt.toISOString()
      : null;
  const decision = {
    contains_synthetic_media:
      typeof input.contains_synthetic_media === "boolean"
        ? input.contains_synthetic_media
        : null,
    synthetic_disclosure_required:
      operatorDecision === "DISCLOSE"
        ? true
        : operatorDecision === "NO_DISCLOSURE_REQUIRED"
          ? false
          : null,
    decision: operatorDecision,
    operator_decision: operatorDecision,
    rationale,
    reason: rationale,
    disclosure_text: text(input.disclosure_text) || null,
    policy_basis: text(input.policy_basis) || null,
    youtube_field_value:
      typeof input.youtube_field_value === "boolean"
        ? input.youtube_field_value
        : null,
    reviewed_at: reviewedAtIso,
  };
  const blockers = [];

  if (decision.contains_synthetic_media === null) {
    blockers.push("synthetic_media_presence_decision_required");
  }
  if (
    decision.decision !== "DISCLOSE" &&
    decision.decision !== "NO_DISCLOSURE_REQUIRED"
  ) {
    blockers.push("synthetic_media_disclosure_decision_required");
  }
  if (!decision.rationale) {
    blockers.push("synthetic_media_disclosure_rationale_required");
  }
  if (decision.youtube_field_value === null) {
    blockers.push("synthetic_media_youtube_field_value_required");
  } else if (
    decision.synthetic_disclosure_required !== null &&
    decision.youtube_field_value !==
      decision.synthetic_disclosure_required
  ) {
    blockers.push("synthetic_media_youtube_field_mismatch");
  }
  if (!decision.reviewed_at) {
    blockers.push("synthetic_media_disclosure_review_time_required");
  }
  if (decision.decision === "DISCLOSE" && !decision.disclosure_text) {
    blockers.push("synthetic_media_disclosure_text_required");
  }
  if (
    decision.contains_synthetic_media === true &&
    decision.decision === "NO_DISCLOSURE_REQUIRED" &&
    !decision.policy_basis
  ) {
    blockers.push("synthetic_media_non_disclosure_policy_basis_required");
  }

  return {
    blockers: [...new Set(blockers)],
    decision,
  };
}

module.exports = {
  ACCEPTED_RIGHTS_BASES,
  ACCEPTED_TRANSFORMATION_VERDICTS,
  assessRightsLedger,
  assessOriginalityTransformation,
  assessPublicationEvidence,
  assessSyntheticMediaDisclosure,
  canonicalRightsLedger,
  hashRightsLedger,
};
