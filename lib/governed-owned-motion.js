"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstExistingPath(paths = []) {
  for (const candidate of asArray(paths).map(cleanText)) {
    if (!candidate || /^https?:\/\//i.test(candidate)) continue;
    const resolved = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return "";
}

function fingerprintFileSyncIfPresent(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const bytes = fs.readFileSync(filePath);
    return {
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      size_bytes: bytes.length,
    };
  } catch {
    return null;
  }
}

function normaliseLocalBindingPath(value = "") {
  const raw = cleanText(value);
  return raw ? path.resolve(raw).replace(/\\/g, "/").toLowerCase() : "";
}

function normalisePlatform(value) {
  const key = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  return {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
  }[key] || key;
}

function isStrictlyVerifiedOwnedMotionClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const clipPath = firstExistingPath([
    clip.path,
    clip.local_materialized_path,
    clip.file_path,
    clip.local_path,
  ]);
  const ownedRights = clip.owned_rights_record && typeof clip.owned_rights_record === "object"
    ? clip.owned_rights_record
    : {};
  const rightsEvaluation = clip.owned_rights_evaluation && typeof clip.owned_rights_evaluation === "object"
    ? clip.owned_rights_evaluation
    : {};
  const ownedMarker = [
    clip.source_type,
    clip.source_kind,
    clip.media_kind,
    clip.rights_basis,
    clip.licence_basis,
  ].map(cleanText).join(" ").toLowerCase();
  if (
    !clipPath ||
    !/\.(?:mp4|mov|m4v|webm|mkv)$/i.test(clipPath) ||
    clip.owned_explainer_visual_plan !== true ||
    clip.source_safety_blocked === true ||
    clip.counts_towards_motion_readiness === false ||
    clip.materialized !== true ||
    !/owned|internally_generated/.test(ownedMarker) ||
    !cleanText(clip.generator_project_id) ||
    !/^[a-f0-9]{64}$/i.test(cleanText(clip.generator_master_sha256)) ||
    rightsEvaluation.verified !== true ||
    cleanText(rightsEvaluation.status).toLowerCase() !== "pass" ||
    asArray(rightsEvaluation.blockers).length > 0 ||
    ownedRights.rights_grant !== true ||
    ownedRights.commercial_use_allowed !== true ||
    !asArray(ownedRights.allowed_platforms).length
  ) {
    return false;
  }

  const assetEvidence = fingerprintFileSyncIfPresent(clipPath);
  const clipSha256 = cleanText(
    clip.materialised_output_sha256 || clip.asset_sha256,
  ).toLowerCase();
  const recordSha256 = cleanText(
    ownedRights.asset_sha256 || ownedRights.materialised_output_sha256,
  ).toLowerCase();
  const clipSize = Number(clip.materialised_output_size_bytes || clip.asset_size_bytes || 0);
  const recordSize = Number(ownedRights.asset_size_bytes || ownedRights.materialised_output_size_bytes || 0);
  if (
    !assetEvidence ||
    !/^[a-f0-9]{64}$/.test(clipSha256) ||
    clipSha256 !== recordSha256 ||
    clipSha256 !== assetEvidence.sha256 ||
    !clipSize ||
    clipSize !== recordSize ||
    clipSize !== assetEvidence.size_bytes ||
    normaliseLocalBindingPath(ownedRights.path || ownedRights.local_materialized_path) !==
      normaliseLocalBindingPath(clipPath)
  ) {
    return false;
  }

  const rightsEvidencePath = firstExistingPath([
    ownedRights.evidence_file,
    ownedRights.rights_evidence_file,
    clip.rights_evidence_file_path,
  ]);
  const rightsEvidence = fingerprintFileSyncIfPresent(rightsEvidencePath);
  const expectedRightsSha256 = cleanText(
    ownedRights.evidence_sha256 || ownedRights.rights_evidence_sha256,
  ).toLowerCase();
  const expectedRightsSize = Number(
    ownedRights.evidence_size_bytes || ownedRights.rights_evidence_size_bytes || 0,
  );
  return Boolean(
    rightsEvidence &&
      /^[a-f0-9]{64}$/.test(expectedRightsSha256) &&
      expectedRightsSha256 === rightsEvidence.sha256 &&
      expectedRightsSize > 0 &&
      expectedRightsSize === rightsEvidence.size_bytes,
  );
}

function isPublishableStrictlyVerifiedOwnedMotionClip(
  clip = {},
  { targetPlatforms = [] } = {},
) {
  if (!isStrictlyVerifiedOwnedMotionClip(clip)) return false;
  const ownedRights = clip.owned_rights_record &&
    typeof clip.owned_rights_record === "object"
    ? clip.owned_rights_record
    : {};
  const evaluation = clip.owned_rights_evaluation &&
    typeof clip.owned_rights_evaluation === "object"
    ? clip.owned_rights_evaluation
    : {};
  const evidence = evaluation.evidence && typeof evaluation.evidence === "object"
    ? evaluation.evidence
    : {};
  const provenance = ownedRights.provenance && typeof ownedRights.provenance === "object"
    ? ownedRights.provenance
    : {};
  const allowedPlatforms = new Set(
    asArray(ownedRights.allowed_platforms).map(normalisePlatform).filter(Boolean),
  );
  const evaluatedPlatforms = new Set(
    asArray(evidence.exact_allowed_platforms).map(normalisePlatform).filter(Boolean),
  );
  const targets = [...new Set(
    asArray(targetPlatforms).map(normalisePlatform).filter(Boolean),
  )];
  const approval = cleanText(ownedRights.approval_status).toLowerCase();
  const status = [
    ownedRights.status,
    ownedRights.verdict,
    ownedRights.rights_status,
    ownedRights.usage_status,
  ].map(cleanText).join(" ").toLowerCase();
  const explicitLivePublishHold = Boolean(
    ownedRights.live_publish_allowed === false ||
      ownedRights.requires_human_legal_review_before_publish === true ||
      ownedRights.requires_human_review_before_live_publish === true ||
      ownedRights.requires_human_publish_review === true,
  );
  return Boolean(
    cleanText(ownedRights.source_owner || clip.source_owner).toLowerCase() === "pulse gaming" &&
      cleanText(ownedRights.ownership_basis) === "wholly_owned_generated_asset" &&
      /^approved(?:_|$)/.test(approval) &&
      !/(?:^|[\s_-])(?:blocked|denied|prohibited|rejected|revoked|expired|red|fail(?:ed)?)(?:$|[\s_-])/.test(status) &&
      !explicitLivePublishHold &&
      Number(ownedRights.risk_score || 0) < 0.65 &&
      evidence.provenance_verified === true &&
      provenance.third_party_inputs === false &&
      asArray(provenance.third_party_sources).length === 0 &&
      targets.length > 0 &&
      targets.every((platform) =>
        allowedPlatforms.has(platform) && evaluatedPlatforms.has(platform),
      )
  );
}

module.exports = {
  isPublishableStrictlyVerifiedOwnedMotionClip,
  isStrictlyVerifiedOwnedMotionClip,
};
