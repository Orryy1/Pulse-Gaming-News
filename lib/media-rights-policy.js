"use strict";

const POLICY_VERSION = "pulse_media_rights_policy_2026-07-23";
const INTERNAL_EDITORIAL_GUARDRAILS = Object.freeze({
  max_continuous_motion_excerpt_seconds: 6,
  max_total_third_party_media_seconds: 20,
  max_still_display_seconds: 6,
});

const BASIS_ALIASES = Object.freeze({
  owned: "owned",
  owned_media: "owned",
  direct_license: "direct_licence",
  direct_licence: "direct_licence",
  licensed: "direct_licence",
  licensed_media: "direct_licence",
  publisher_policy: "publisher_policy",
  publisher_video_policy: "publisher_policy",
  editorial_excerpt: "bounded_editorial_excerpt",
  bounded_editorial_excerpt: "bounded_editorial_excerpt",
  fair_dealing: "bounded_editorial_excerpt",
});

const EDITORIAL_PURPOSES = new Set(["criticism_review", "quotation"]);
const STILL_TYPES = new Set(["image", "still", "still_image", "photograph", "screenshot"]);
const VIDEO_TYPES = new Set(["video", "motion", "gameplay", "trailer"]);
const AUDIO_TYPES = new Set(["audio", "music", "soundtrack", "sfx"]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : value == null ? [] : [value];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function normalisePlatform(value) {
  const key = clean(
    value && typeof value === "object"
      ? value.platform || value.platform_key || value.key || value.name || value.id
      : value,
  ).toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
    twitter: "x",
    x_twitter: "x",
  };
  return aliases[key] || key;
}

function normalisePlatforms(values = []) {
  return unique(asArray(values).map(normalisePlatform));
}

function normaliseBasis(asset = {}) {
  const value = clean(
    asset.rights_basis ||
      asset.licence_basis ||
      asset.license_basis ||
      asset.basis,
  ).toLowerCase().replace(/[\s-]+/g, "_");
  return BASIS_ALIASES[value] || value;
}

function normaliseAssetType(value) {
  return clean(value || "video").toLowerCase().replace(/[\s-]+/g, "_");
}

function assetId(asset = {}, index = 0) {
  return clean(asset.asset_id || asset.id) || `asset_${index + 1}`;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validIsoDate(value) {
  const text = clean(value);
  return Boolean(text && !Number.isNaN(Date.parse(text)));
}

function policyAccepted(value = {}) {
  return Boolean(
    value.editorial_exception_policy_accepted === true &&
      clean(value.accepted_by) &&
      validIsoDate(value.accepted_at),
  );
}

function missingPlatformScope(asset = {}, targetPlatforms = []) {
  const allowed = normalisePlatforms(asset.allowed_platforms || asset.platforms);
  return targetPlatforms.filter((platform) => !allowed.includes(platform));
}

function attributionLabel(asset = {}) {
  const type = normaliseAssetType(asset.asset_type || asset.kind);
  if (STILL_TYPES.has(type)) return "Image";
  if (AUDIO_TYPES.has(type)) return "Audio";
  return "Footage";
}

function compactCredit(asset = {}) {
  const explicit = clean(asset.on_screen_credit || asset.display_credit);
  if (explicit) return explicit.slice(0, 72);
  const owner = clean(asset.source_owner || asset.creator);
  return owner ? `${attributionLabel(asset)}: ${owner}`.slice(0, 72) : "";
}

function descriptionCredits(asset = {}) {
  const rows = [];
  const requiredNotice = clean(asset.required_public_notice);
  if (requiredNotice) rows.push(requiredNotice);
  const explicit = clean(asset.description_credit);
  if (explicit) rows.push(explicit);
  const owner = clean(asset.source_owner || asset.creator);
  const title = clean(asset.source_title);
  const sourceUrl = clean(asset.source_url);
  if (owner || title || sourceUrl) {
    const subject = [owner, title].filter(Boolean).join(" — ");
    rows.push(`Source: ${subject || "Original source"}${sourceUrl ? ` (${sourceUrl})` : ""}`);
  }
  const policyUrl = clean(asset.policy_url || asset.required_rules_link);
  if (policyUrl && policyUrl !== sourceUrl) rows.push(`Usage policy: ${policyUrl}`);
  return unique(rows);
}

function timelineFor(asset = {}) {
  const start = finiteNumber(
    asset.timeline_start_seconds ??
      asset.timeline?.start_seconds ??
      asset.timeline?.start_s,
  );
  const end = finiteNumber(
    asset.timeline_end_seconds ??
      asset.timeline?.end_seconds ??
      asset.timeline?.end_s,
  );
  if (start == null || end == null || start < 0 || end <= start) return null;
  return {
    start_seconds: Number(start.toFixed(3)),
    end_seconds: Number(end.toFixed(3)),
  };
}

function buildAttributionEntry(asset = {}, decision = {}) {
  if (!["GREEN", "AMBER"].includes(clean(decision.verdict).toUpperCase())) return null;
  if (decision.credit_required !== true) return null;
  const timeline = timelineFor(asset);
  const displayText = compactCredit(asset);
  if (!timeline || !displayText) return null;
  return {
    asset_id: decision.asset_id,
    display_text: displayText,
    description_lines: descriptionCredits(asset),
    source_url: clean(asset.source_url) || null,
    source_owner: clean(asset.source_owner || asset.creator) || null,
    timeline,
    layout: {
      placement: "lower_left_safe",
      font_size_px: 18,
      max_characters: 72,
      backdrop: "compact_translucent_plate",
    },
    decision_verdict: decision.verdict,
  };
}

function baseBlockers(asset = {}, id) {
  const blockers = [];
  if (!clean(asset.asset_id || asset.id)) blockers.push(`${id}:asset_id_missing`);
  if (!clean(asset.path || asset.local_path || asset.local_materialized_path)) {
    blockers.push(`${id}:local_media_path_missing`);
  }
  return blockers;
}

function platformBlockers(asset = {}, id, targetPlatforms = []) {
  return missingPlatformScope(asset, targetPlatforms)
    .map((platform) => `${id}:platform_scope_missing:${platform}`);
}

function positiveRecord({
  asset,
  id,
  basis,
  targetPlatforms,
  verdict,
  livePublishAllowed,
  licenceBasis,
  allowedUse,
  evidenceKind,
  riskScore,
  creditRequired,
  legalExceptionReliance = false,
  policyAcceptance = null,
}) {
  const record = {
    asset_id: id,
    asset_type: normaliseAssetType(asset.asset_type || asset.kind),
    kind: normaliseAssetType(asset.asset_type || asset.kind),
    path: clean(asset.path || asset.local_path || asset.local_materialized_path),
    source_url: clean(asset.source_url) || null,
    source_type: clean(asset.source_type) || basis,
    source_owner: clean(asset.source_owner || asset.creator),
    creator: clean(asset.creator || asset.source_owner),
    licence_basis: licenceBasis,
    allowed_use: allowedUse,
    allowed_platforms: [...targetPlatforms],
    commercial_use_allowed: true,
    evidence_reference: clean(
      asset.evidence_reference ||
        asset.evidence_file ||
        asset.policy_snapshot_path ||
        asset.policy_url ||
        asset.source_url,
    ),
    evidence_kind: evidenceKind,
    transformation_notes: clean(asset.transformation_notes) || null,
    credit_required: creditRequired,
    on_screen_credit: creditRequired ? compactCredit(asset) : null,
    description_credits: creditRequired ? descriptionCredits(asset) : [],
    risk_score: riskScore,
    approval_status:
      verdict === "GREEN" ? "approved" : "approved_pending_owner_policy_acceptance",
    verdict,
    live_publish_allowed: livePublishAllowed,
    requires_human_review_before_live_publish: !livePublishAllowed,
    rights_policy_version: POLICY_VERSION,
    rights_basis_category: basis,
  };
  if (legalExceptionReliance) {
    record.legal_exception_reliance = true;
    record.rights_grant = undefined;
    record.transformative_rights_evidence_verified = true;
    record.editorial_policy_acceptance = policyAcceptance;
  } else {
    record.rights_grant = true;
  }
  if (
    Object.hasOwn(asset, "subject_match") ||
    clean(asset.subject_match_quality) ||
    clean(asset.matched_subject) ||
    clean(asset.subject_match_evidence)
  ) {
    record.subject_match = asset.subject_match === true;
    record.subject_match_quality =
      clean(asset.subject_match_quality) || null;
    record.matched_subject = clean(asset.matched_subject) || null;
    record.subject_match_evidence =
      clean(asset.subject_match_evidence) || null;
  }
  return record;
}

function assessOwnedOrLicensed({
  asset,
  id,
  basis,
  targetPlatforms,
}) {
  const blockers = baseBlockers(asset, id);
  if (!clean(asset.source_owner || asset.creator)) blockers.push(`${id}:source_owner_missing`);
  if (!clean(asset.evidence_reference || asset.evidence_file)) {
    blockers.push(`${id}:rights_evidence_reference_missing`);
  }
  if (asset.commercial_use_allowed !== true) {
    blockers.push(`${id}:commercial_use_not_confirmed`);
  }
  blockers.push(...platformBlockers(asset, id, targetPlatforms));
  const creditRequired = asset.credit_required === true;
  if (creditRequired && !timelineFor(asset)) blockers.push(`${id}:credit_timeline_missing`);
  const verdict = blockers.length ? "RED" : "GREEN";
  return {
    asset_id: id,
    basis,
    verdict,
    blockers,
    warnings: [],
    credit_required: creditRequired,
    live_publish_allowed: verdict === "GREEN",
    rights_record: verdict === "GREEN"
      ? positiveRecord({
          asset,
          id,
          basis,
          targetPlatforms,
          verdict,
          livePublishAllowed: true,
          licenceBasis:
            basis === "owned" ? "owned_by_pulse_gaming" : "direct_commercial_licence",
          allowedUse:
            basis === "owned"
              ? "owned_commercial_editorial_media"
              : "commercial_editorial_media_under_direct_licence",
          evidenceKind: basis === "owned" ? "ownership_evidence" : "direct_licence_evidence",
          riskScore: basis === "owned" ? 0.03 : 0.08,
          creditRequired,
        })
      : null,
  };
}

function assessPublisherPolicy({
  asset,
  id,
  targetPlatforms,
}) {
  const blockers = baseBlockers(asset, id);
  if (!clean(asset.source_owner || asset.creator)) blockers.push(`${id}:source_owner_missing`);
  if (!clean(asset.source_url)) blockers.push(`${id}:official_source_url_missing`);
  if (asset.official_source !== true) blockers.push(`${id}:official_source_not_confirmed`);
  if (asset.publisher_owns_material !== true) {
    blockers.push(`${id}:publisher_ownership_not_confirmed`);
  }
  if (asset.policy_terms_verified !== true) {
    blockers.push(`${id}:publisher_policy_terms_not_verified`);
  }
  if (!clean(asset.policy_name)) blockers.push(`${id}:publisher_policy_name_missing`);
  if (!clean(asset.evidence_reference || asset.evidence_file || asset.policy_snapshot_path)) {
    blockers.push(`${id}:publisher_policy_evidence_missing`);
  }
  if (asset.entity_eligible_under_policy === false) {
    blockers.push(`${id}:publisher_policy_entity_ineligible`);
  }
  if (asset.commercial_use_allowed !== true) {
    blockers.push(`${id}:commercial_use_not_permitted_by_policy`);
  }
  blockers.push(...platformBlockers(asset, id, targetPlatforms));
  if (!clean(asset.transformation_notes)) blockers.push(`${id}:transformation_notes_missing`);
  const type = normaliseAssetType(asset.asset_type || asset.kind);
  if (VIDEO_TYPES.has(type) && asset.source_audio_removed !== true && asset.source_audio_allowed !== true) {
    blockers.push(`${id}:source_audio_not_removed_or_permitted`);
  }
  if (asset.contains_third_party_music === true) blockers.push(`${id}:third_party_music_present`);
  const creditRequired =
    asset.credit_required === true ||
    Boolean(clean(asset.required_public_notice || asset.required_rules_link));
  if (creditRequired && !timelineFor(asset)) blockers.push(`${id}:credit_timeline_missing`);
  const verdict = blockers.length ? "RED" : "GREEN";
  return {
    asset_id: id,
    basis: "publisher_policy",
    verdict,
    blockers,
    warnings: [],
    credit_required: creditRequired,
    live_publish_allowed: verdict === "GREEN",
    rights_record: verdict === "GREEN"
      ? positiveRecord({
          asset,
          id,
          basis: "publisher_policy",
          targetPlatforms,
          verdict,
          livePublishAllowed: true,
          licenceBasis: "verified_publisher_video_policy",
          allowedUse: "transformative_editorial_media_under_publisher_policy",
          evidenceKind: "publisher_policy",
          riskScore: 0.15,
          creditRequired,
        })
      : null,
  };
}

function editorialDurationBlockers(asset = {}, id, type) {
  const blockers = [];
  const totalUse = finiteNumber(asset.total_use_seconds);
  if (totalUse == null || totalUse <= 0) blockers.push(`${id}:total_use_seconds_missing`);
  if (
    totalUse != null &&
    totalUse > INTERNAL_EDITORIAL_GUARDRAILS.max_total_third_party_media_seconds
  ) {
    blockers.push(`${id}:total_excerpt_over_internal_guardrail`);
  }
  if (VIDEO_TYPES.has(type)) {
    const start = finiteNumber(asset.source_start_seconds);
    const end = finiteNumber(asset.source_end_seconds);
    if (start == null || end == null || start < 0 || end <= start) {
      blockers.push(`${id}:exact_source_time_range_missing`);
    } else if (
      end - start >
      INTERNAL_EDITORIAL_GUARDRAILS.max_continuous_motion_excerpt_seconds
    ) {
      blockers.push(`${id}:continuous_excerpt_over_internal_guardrail`);
    }
  } else if (STILL_TYPES.has(type)) {
    const displaySeconds = finiteNumber(asset.display_seconds ?? asset.total_use_seconds);
    if (displaySeconds == null || displaySeconds <= 0) {
      blockers.push(`${id}:still_display_seconds_missing`);
    } else if (displaySeconds > INTERNAL_EDITORIAL_GUARDRAILS.max_still_display_seconds) {
      blockers.push(`${id}:still_display_over_internal_guardrail`);
    }
  }
  return blockers;
}

function assessEditorialExcerpt({
  asset,
  id,
  targetPlatforms,
  acceptance,
}) {
  const blockers = baseBlockers(asset, id);
  const reviewBlockers = [];
  const warnings = [
    `${id}:copyright_exception_is_fact_specific_and_not_a_licence`,
  ];
  const type = normaliseAssetType(asset.asset_type || asset.kind);
  if (AUDIO_TYPES.has(type)) blockers.push(`${id}:editorial_audio_exception_not_auto_approved`);
  if (!VIDEO_TYPES.has(type) && !STILL_TYPES.has(type) && !AUDIO_TYPES.has(type)) {
    blockers.push(`${id}:unsupported_editorial_asset_type`);
  }
  if (!clean(asset.source_url)) blockers.push(`${id}:source_url_missing`);
  if (!clean(asset.source_owner || asset.creator)) blockers.push(`${id}:source_owner_missing`);
  if (asset.official_source !== true) blockers.push(`${id}:official_source_not_confirmed`);
  if (asset.third_party_reupload === true) {
    blockers.push(`${id}:third_party_reupload_not_permitted`);
  }
  if (asset.publicly_released !== true || asset.leaked_or_unreleased === true) {
    blockers.push(`${id}:leaked_or_unreleased_media`);
  }
  if (asset.lawfully_accessed !== true) blockers.push(`${id}:lawful_access_not_confirmed`);
  if (asset.contains_third_party_music === true) blockers.push(`${id}:third_party_music_present`);
  if (VIDEO_TYPES.has(type) && asset.source_audio_removed !== true) {
    blockers.push(`${id}:source_audio_not_removed`);
  }
  const purpose = clean(asset.editorial_purpose).toLowerCase().replace(/[\s-]+/g, "_");
  if (type === "photograph" && purpose === "current_events_reporting") {
    blockers.push(`${id}:current_events_photograph_requires_separate_basis`);
  } else if (!EDITORIAL_PURPOSES.has(purpose)) {
    blockers.push(`${id}:editorial_purpose_not_criticism_review_or_quotation`);
  }
  if (asset.commentary_present !== true) blockers.push(`${id}:original_commentary_missing`);
  if (!clean(asset.transformation_notes)) blockers.push(`${id}:transformation_notes_missing`);
  if (asset.necessary_for_editorial_point !== true) blockers.push(`${id}:necessity_not_confirmed`);
  if (asset.non_substitutive !== true) blockers.push(`${id}:non_substitutive_use_not_confirmed`);
  blockers.push(...editorialDurationBlockers(asset, id, type));
  if (!timelineFor(asset)) blockers.push(`${id}:credit_timeline_missing`);
  if (!policyAccepted(acceptance)) {
    reviewBlockers.push(`${id}:editorial_exception_policy_acceptance_missing`);
  }

  const verdict = blockers.length ? "RED" : reviewBlockers.length ? "AMBER" : "GREEN";
  const livePublishAllowed = verdict === "GREEN";
  const licenceBasis =
    purpose === "quotation"
      ? "uk_fair_dealing_quotation_bounded_excerpt"
      : "uk_fair_dealing_criticism_review_bounded_excerpt";
  const rightsRecord = verdict === "RED"
    ? null
    : positiveRecord({
        asset,
        id,
        basis: "bounded_editorial_excerpt",
        targetPlatforms,
        verdict,
        livePublishAllowed,
        licenceBasis,
        allowedUse: "bounded_transformative_editorial_excerpt",
        evidenceKind: "bounded_editorial_excerpt_policy",
        riskScore: 0.35,
        creditRequired: true,
        legalExceptionReliance: true,
        policyAcceptance: policyAccepted(acceptance)
          ? {
              accepted_by: clean(acceptance.accepted_by),
              accepted_at: new Date(acceptance.accepted_at).toISOString(),
            }
          : null,
      });
  return {
    asset_id: id,
    basis: "bounded_editorial_excerpt",
    verdict,
    blockers: [...blockers, ...reviewBlockers],
    warnings,
    credit_required: true,
    live_publish_allowed: livePublishAllowed,
    rights_record: rightsRecord,
    guardrails: INTERNAL_EDITORIAL_GUARDRAILS,
  };
}

function assessMediaAsset(asset = {}, {
  index = 0,
  targetPlatforms = [],
  policyAcceptance = {},
} = {}) {
  const id = assetId(asset, index);
  const basis = normaliseBasis(asset);
  if (!basis) {
    return {
      asset_id: id,
      basis: null,
      verdict: "RED",
      blockers: [`${id}:rights_basis_missing`],
      warnings: [],
      credit_required: false,
      live_publish_allowed: false,
      rights_record: null,
    };
  }
  if (basis === "owned" || basis === "direct_licence") {
    return assessOwnedOrLicensed({ asset, id, basis, targetPlatforms });
  }
  if (basis === "publisher_policy") {
    return assessPublisherPolicy({ asset, id, targetPlatforms });
  }
  if (basis === "bounded_editorial_excerpt") {
    return assessEditorialExcerpt({
      asset,
      id,
      targetPlatforms,
      acceptance: policyAcceptance,
    });
  }
  return {
    asset_id: id,
    basis,
    verdict: "RED",
    blockers: [`${id}:unsupported_rights_basis:${basis}`],
    warnings: [],
    credit_required: false,
    live_publish_allowed: false,
    rights_record: null,
  };
}

function aggregateVerdict(decisions = [], packageBlockers = []) {
  if (packageBlockers.length || decisions.some((row) => row.verdict === "RED")) return "RED";
  if (decisions.some((row) => row.verdict === "AMBER")) return "AMBER";
  return decisions.length ? "GREEN" : "RED";
}

function assessMediaRightsPackage({
  story_id: storyId,
  target_platforms: targetPlatformsInput = [],
  policy_acceptance: policyAcceptance = {},
  assets = [],
  generated_at: generatedAt = new Date().toISOString(),
} = {}) {
  const targetPlatforms = normalisePlatforms(targetPlatformsInput);
  const packageBlockers = [];
  if (!clean(storyId)) packageBlockers.push("story_id_missing");
  if (!targetPlatforms.length) packageBlockers.push("target_platforms_missing");
  if (!Array.isArray(assets) || !assets.length) packageBlockers.push("media_assets_missing");
  const decisions = asArray(assets).map((asset, index) =>
    assessMediaAsset(asset, {
      index,
      targetPlatforms,
      policyAcceptance,
    }),
  );
  const verdict = aggregateVerdict(decisions, packageBlockers);
  const rightsRecords = decisions
    .map((decision) => decision.rights_record)
    .filter(Boolean);
  const entries = decisions
    .map((decision, index) => buildAttributionEntry(asArray(assets)[index], decision))
    .filter(Boolean);
  const descriptionLines = unique(
    entries.flatMap((entry) => entry.description_lines || []),
  );
  const blockers = unique([
    ...packageBlockers,
    ...decisions.flatMap((decision) => decision.blockers || []),
  ]);
  const warnings = unique(decisions.flatMap((decision) => decision.warnings || []));
  return {
    schema: "pulse_media_rights_assessment_v1",
    policy_version: POLICY_VERSION,
    generated_at: new Date(generatedAt).toISOString(),
    story_id: clean(storyId) || null,
    target_platforms: targetPlatforms,
    verdict,
    live_publish_allowed:
      verdict === "GREEN" &&
      decisions.length > 0 &&
      decisions.every((decision) => decision.live_publish_allowed === true),
    summary: {
      asset_count: decisions.length,
      green_count: decisions.filter((row) => row.verdict === "GREEN").length,
      amber_count: decisions.filter((row) => row.verdict === "AMBER").length,
      red_count: decisions.filter((row) => row.verdict === "RED").length,
      rights_record_count: rightsRecords.length,
      attribution_entry_count: entries.length,
    },
    decisions,
    rights_records: rightsRecords,
    attribution_manifest: {
      schema: "pulse_media_attribution_manifest_v1",
      policy_version: POLICY_VERSION,
      story_id: clean(storyId) || null,
      verdict,
      entries,
      description_lines: descriptionLines,
      render_contract: {
        burn_in_required_for_credited_media: true,
        time_bound_to_media_use: true,
        small_annotation_not_a_rights_basis: true,
      },
    },
    blockers,
    warnings,
    legal_basis: {
      owned_or_licensed: "documented ownership, direct licence or exact publisher policy",
      editorial_exception:
        "UK fair dealing for criticism, review or quotation assessed case by case",
      attribution:
        "sufficient acknowledgement where required; attribution alone is not permission",
    },
    internal_guardrails: INTERNAL_EDITORIAL_GUARDRAILS,
    safety: {
      no_publish_triggered: true,
      no_database_mutation: true,
      no_oauth_or_token_change: true,
      red_or_amber_records_cannot_auto_publish: true,
    },
    not_legal_advice: true,
  };
}

module.exports = {
  INTERNAL_EDITORIAL_GUARDRAILS,
  POLICY_VERSION,
  assessMediaAsset,
  assessMediaRightsPackage,
  buildAttributionEntry,
  normalisePlatform,
  normalisePlatforms,
};
