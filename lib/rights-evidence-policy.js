"use strict";

const OFFICIAL_YOUTUBE_MOTION_SOURCE_TYPE =
  /official_(?:youtube_channel|publisher_(?:trailer|gameplay)(?:_segment|_clip)?|platform_channel)/i;

const TRANSFORMATIVE_RIGHTS_EVIDENCE_KINDS = new Set([
  "publisher_video_policy",
  "editorial_use_policy",
  "licence_grant",
  "license_grant",
  "permission_grant",
  "bounded_editorial_excerpt_policy",
  "media_rights_assessment",
]);

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseEvidenceKind(value) {
  return cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function youtubeVideoIdFromUrl(value) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (/youtu\.be$/i.test(parsed.hostname)) {
      return parsed.pathname.split("/").filter(Boolean)[0] || "";
    }
    if (/youtube\.com$/i.test(parsed.hostname) || /(^|\.)youtube\.com$/i.test(parsed.hostname)) {
      return (
        parsed.searchParams.get("v") ||
        parsed.pathname.match(/\/(?:embed|shorts|live)\/([^/?#]+)/i)?.[1] ||
        ""
      );
    }
  } catch {
    return "";
  }
  return "";
}

function isTransformativeRightsEvidenceKind(value) {
  return TRANSFORMATIVE_RIGHTS_EVIDENCE_KINDS.has(normaliseEvidenceKind(value));
}

function isBoundedEditorialExceptionEvidenceKind(value) {
  return [
    "bounded_editorial_excerpt_policy",
    "media_rights_assessment",
  ].includes(normaliseEvidenceKind(value));
}

function isOfficialYoutubeMotionRightsRecord(record = {}, asset = {}) {
  const kind = cleanText(
    record.kind ||
      record.asset_type ||
      record.media_kind ||
      asset.kind ||
      asset.asset_type ||
      asset.media_kind,
  ).toLowerCase();
  const motionKind = ["video", "motion", "direct_video", "motion_clip"].includes(kind);
  const sourceType = cleanText(
    record.source_type || asset.source_type,
  );
  const sourceUrl = cleanText(record.source_url || asset.source_url);
  const youtubeVideoId = cleanText(
    record.youtube_video_id ||
      asset.youtube_video_id ||
      youtubeVideoIdFromUrl(sourceUrl),
  );
  return Boolean(
    motionKind &&
      OFFICIAL_YOUTUBE_MOTION_SOURCE_TYPE.test(sourceType) &&
      youtubeVideoId,
  );
}

function officialYoutubeTransformativeRightsBlockers(record = {}, asset = {}) {
  if (!isOfficialYoutubeMotionRightsRecord(record, asset)) return [];
  const explicitPolicyGrant =
    record.transformative_rights_evidence_verified === true &&
    record.rights_grant === true &&
    isTransformativeRightsEvidenceKind(record.evidence_kind);
  const acceptance = record.editorial_policy_acceptance || {};
  const acceptedAt = cleanText(acceptance.accepted_at);
  const boundedEditorialException =
    record.transformative_rights_evidence_verified === true &&
    record.legal_exception_reliance === true &&
    record.rights_grant !== true &&
    record.rights_grant !== false &&
    record.live_publish_allowed === true &&
    isBoundedEditorialExceptionEvidenceKind(record.evidence_kind) &&
    cleanText(acceptance.accepted_by) &&
    acceptedAt &&
    !Number.isNaN(Date.parse(acceptedAt));
  if (explicitPolicyGrant || boundedEditorialException) {
    return [];
  }
  return ["transformative_rights_policy_evidence_missing_or_unbound"];
}

module.exports = {
  OFFICIAL_YOUTUBE_MOTION_SOURCE_TYPE,
  TRANSFORMATIVE_RIGHTS_EVIDENCE_KINDS,
  isBoundedEditorialExceptionEvidenceKind,
  isOfficialYoutubeMotionRightsRecord,
  isTransformativeRightsEvidenceKind,
  officialYoutubeTransformativeRightsBlockers,
  youtubeVideoIdFromUrl,
};
