"use strict";

const { mediaSourceUrlKindFields } = require("./media-source-url-kind");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isHashBoundOfficialYoutubeLocalMaster(reference, suppliedUrlKind = null) {
  const provenance = reference?.provenance || {};
  const source = reference?.source_url || reference?.local_path || "";
  const urlKind = suppliedUrlKind || mediaSourceUrlKindFields(source);
  return (
    String(reference?.source_type || "").toLowerCase() ===
      "official_youtube_channel_url" &&
    urlKind.source_url_kind === "local_video_file" &&
    reference?.source_verified === true &&
    reference?.downloads_allowed === true &&
    reference?.autonomous_use_approved === false &&
    reference?.rights_grant === false &&
    reference?.commercial_use_allowed === false &&
    asArray(reference?.allowed_platforms).length === 0 &&
    reference?.allowed_render_use === "local_proof_only" &&
    reference?.rights_status === "local_proof_only" &&
    String(reference?.rights_verdict || "").toUpperCase() === "RED" &&
    provenance.source === "official_youtube_channel_download" &&
    /^https:\/\/(?:www\.)?youtube\.com\/@[^/]+\/?$/i.test(
      String(provenance.official_channel || ""),
    ) &&
    /^https:\/\/(?:www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{6,}/i.test(
      String(provenance.reference_url || ""),
    ) &&
    /^[a-f0-9]{64}$/i.test(String(provenance.source_sha256 || "")) &&
    Boolean(String(provenance.source_identity_path || "").trim()) &&
    /^[a-f0-9]{64}$/i.test(String(provenance.source_identity_sha256 || "")) &&
    provenance.source_identity_scope === "identity_only_not_rights_grant"
  );
}

module.exports = {
  isHashBoundOfficialYoutubeLocalMaster,
};
