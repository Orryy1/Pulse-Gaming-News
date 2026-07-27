"use strict";

const ASSET_HIERARCHY = Object.freeze([
  "first_party_gameplay",
  "official_trailer",
  "official_press_kit",
  "official_platform_store_media",
  "owned_gameplay_capture",
  "licensed_third_party",
  "exact_subject_still_motion",
  "generic_minor_bridge",
]);

const RIGHTS_PASS = new Set(["APPROVED", "PASS", "CLEARED", "LICENSED"]);
const MAX_GENERIC_BRIDGE_FRACTION = 0.15;

function text(value) {
  return String(value || "").trim();
}

function validateTechnicalQa(qa = {}, blockers = []) {
  if (Number(qa.width) !== 1080 || Number(qa.height) !== 1920) {
    blockers.push("technical_qa:resolution_must_be_1080x1920");
  }
  if (text(qa.display_aspect_ratio) !== "9:16") {
    blockers.push("technical_qa:display_aspect_ratio_must_be_9_16");
  }
  if (text(qa.video_codec).toLowerCase() !== "h264") {
    blockers.push("technical_qa:h264_required");
  }
  if (text(qa.audio_codec).toLowerCase() !== "aac") {
    blockers.push("technical_qa:aac_required");
  }
  if (Number(qa.audio_sample_rate_hz) !== 48000) {
    blockers.push("technical_qa:48khz_audio_required");
  }
  if (qa.audio_stream_present !== true) {
    blockers.push("technical_qa:audio_stream_required");
  }
  if (!/^[a-f0-9]{64}$/i.test(text(qa.sha256))) {
    blockers.push("technical_qa:sha256_evidence_required");
  }
  if (text(qa.verdict).toUpperCase() !== "PASS") {
    blockers.push("technical_qa:pass_verdict_required");
  }
}

function validateCreativeQa(qa = {}, blockers = []) {
  const flags = {
    exact_subject_visible_by_0_5s: "exact_subject_not_approved_by_0_5s",
    consequence_clear_by_1_5s: "consequence_not_approved_by_1_5s",
    proof_visible_by_3s: "proof_not_approved_by_3s",
    pacing_approved: "pacing_not_approved",
    visual_relevance_approved: "visual_relevance_not_approved",
    repetition_approved: "repetition_not_approved",
    subscription_worthiness_approved: "subscription_worthiness_not_approved",
  };
  for (const [field, blocker] of Object.entries(flags)) {
    if (qa[field] !== true) blockers.push(`creative_qa:${blocker}`);
  }
  if (!text(qa.human_reviewer_id)) {
    blockers.push("creative_qa:human_reviewer_missing");
  }
  if (!Number.isFinite(Date.parse(text(qa.reviewed_at)))) {
    blockers.push("creative_qa:reviewed_at_missing_or_invalid");
  }
  if (text(qa.verdict).toUpperCase() !== "APPROVED") {
    blockers.push("creative_qa:approved_verdict_required");
  }
}

function validateMediaProductionManifest(manifest = {}) {
  const blockers = [];
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const subjects = Array.isArray(manifest.named_subjects)
    ? manifest.named_subjects.map(text).filter(Boolean)
    : [];
  if (!assets.length) blockers.push("media:assets_missing");
  if (!subjects.length) blockers.push("media:named_subjects_missing");

  let totalDuration = 0;
  let genericDuration = 0;
  for (const asset of assets) {
    const sourceClass = text(asset?.source_class);
    const duration = Math.max(0, Number(asset?.duration_seconds) || 0);
    totalDuration += duration;
    if (!ASSET_HIERARCHY.includes(sourceClass)) {
      blockers.push(`media:unknown_source_class:${sourceClass || "missing"}`);
    }
    if (text(asset?.subject_match).toLowerCase() === "unrelated") {
      blockers.push("media:unrelated_gameplay_forbidden");
    }
    if (!RIGHTS_PASS.has(text(asset?.rights_verdict).toUpperCase())) {
      blockers.push(`media:rights_not_cleared:${text(asset?.id) || "unknown"}`);
    }
    if (
      sourceClass === "generic_minor_bridge" ||
      text(asset?.subject_match).toLowerCase() === "generic"
    ) {
      genericDuration += duration;
    }
  }

  for (const subject of subjects) {
    const exact = assets.some(
      (asset) =>
        text(asset.subject).toLowerCase() === subject.toLowerCase() &&
        text(asset.subject_match).toLowerCase() === "exact" &&
        RIGHTS_PASS.has(text(asset.rights_verdict).toUpperCase()),
    );
    if (!exact) {
      blockers.push(`media:named_subject_without_exact_media:${subject}`);
    }
  }
  const genericFraction = totalDuration ? genericDuration / totalDuration : 0;
  if (genericFraction > MAX_GENERIC_BRIDGE_FRACTION) {
    blockers.push("media:generic_bridge_exceeds_minor_share");
  }

  validateTechnicalQa(manifest.technical_qa, blockers);
  validateCreativeQa(manifest.creative_qa, blockers);
  return {
    status: blockers.length ? "blocked" : "pass",
    blockers: [...new Set(blockers)],
    evidence: {
      asset_count: assets.length,
      named_subject_count: subjects.length,
      generic_bridge_fraction: Number(genericFraction.toFixed(4)),
      hierarchy: ASSET_HIERARCHY,
    },
  };
}

module.exports = {
  ASSET_HIERARCHY,
  MAX_GENERIC_BRIDGE_FRACTION,
  validateMediaProductionManifest,
};
