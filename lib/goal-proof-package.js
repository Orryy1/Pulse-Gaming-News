"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const fs = require("fs-extra");

const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const {
  buildPlatformPolicyReport,
  buildStudioGovernanceReport,
  runGovernancePublicOutputGate,
} = require("./studio-governance-engine");
const { buildStudioEnterpriseOSPack } = require("./studio-enterprise-os");
const { buildFootageEmpirePlan } = require("./studio/v4/footage-empire");
const { buildVisualV4DirectorPlan } = require("./studio/v4/director-brain");
const { buildPulseMediaHouseScore } = require("./pulse-media-house-score");
const { buildPublishCutoverGate } = require("./goal-contract");
const { PRIMARY_PULSE_CTA } = require("./pulse-cta");
const { mediaSourceUrlKindFields } = require("./media-source-url-kind");
const {
  isGeneratedMotionAsset,
  isRealMediaAsset,
} = require("./visual-evidence-classifier");
const {
  isStrictlyVerifiedOwnedMotionClip,
} = require("./governed-owned-motion");
const { splitMicrosoftGameContentNotice } = require("./required-rights-notice");
const {
  containsPublicUrl,
  stripPublicUrls,
} = require("./goal-public-copy-qa");

const ACCEPTANCE_ARTEFACTS = [
  "canonical_story_manifest.json",
  "script_scorecard.json",
  "footage_inventory.json",
  "rights_ledger.json",
  "director_beat_map.json",
  "render_manifest.json",
  "visual_v4_render.mp4",
  "audio_manifest.json",
  "narration_manifest.json",
  "caption_manifest.json",
  "sfx_manifest.json",
  "sfx_source_plan.json",
  "captions.srt",
  "platform_publish_manifest.json",
  "x_publish_pack.json",
  "instagram_publish_pack.json",
  "affiliate_link_manifest.json",
  "landing_page_manifest.json",
  "platform_policy_report.json",
  "pulse_media_house_score.json",
  "benchmark_report.json",
  "coherence_report.json",
  "publish_verdict.json",
  "analytics_ingest_plan.json",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "")
    .replace(/&#8211;|&#x2013;|&\s*8211\s*;?/gi, "-")
    .replace(/&#8217;|&#x2019;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function affirmativeDisclosureValue(value) {
  if (value === true) return true;
  if (typeof value !== "string") return false;
  return ["yes", "true", "present", "applied"].includes(value.trim().toLowerCase());
}

const MAX_CANONICAL_DESCRIPTION_CHARS = 420;

function boundedEditorialDescription(value, maxChars = MAX_CANONICAL_DESCRIPTION_CHARS) {
  const text = cleanText(stripPublicUrls(value));
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const candidate = text.slice(0, maxChars + 1);
  const boundary = candidate.lastIndexOf(" ");
  return candidate.slice(0, boundary > 0 ? boundary : maxChars).trim();
}

function canonicalEditorialDescription(canonical = {}, story = {}) {
  const candidates = [
    story.public_description,
    canonical.public_description,
    canonical.description,
    story.description,
  ];
  const safe = candidates
    .map(cleanText)
    .find((value) => value && value.length <= MAX_CANONICAL_DESCRIPTION_CHARS && !containsPublicUrl(value));
  if (safe) return safe;
  for (const candidate of candidates) {
    const bounded = boundedEditorialDescription(candidate);
    if (bounded) return bounded;
  }
  return boundedEditorialDescription(
    story.canonical_subject || canonical.canonical_subject || story.title || canonical.title || "Source-backed story.",
  );
}

function youtubeSyntheticDisclosureState(story = {}, canonical = {}) {
  const storyYoutube = story.platform_disclosures?.youtube || {};
  const canonicalYoutube = canonical.platform_disclosures?.youtube || {};
  const storyAiGate = story.ai_disclosure_gate || {};
  const canonicalAiGate = canonical.ai_disclosure_gate || {};
  const requested = [
    story.youtube_altered_or_synthetic_content,
    canonical.youtube_altered_or_synthetic_content,
  ].some((value) => cleanText(value).toUpperCase() === "YES");
  const present = [
    story.youtube_synthetic_media_disclosed,
    canonical.youtube_synthetic_media_disclosed,
    story.ai_disclosure_applied,
    canonical.ai_disclosure_applied,
    storyYoutube.altered_or_synthetic,
    storyYoutube.ai_disclosure,
    storyYoutube.synthetic_media_disclosure,
    storyYoutube.synthetic_media_disclosed,
    storyYoutube.altered_synthetic_disclosure_present,
    storyYoutube.ai_disclosure_applied,
    canonicalYoutube.altered_or_synthetic,
    canonicalYoutube.ai_disclosure,
    canonicalYoutube.synthetic_media_disclosure,
    canonicalYoutube.synthetic_media_disclosed,
    canonicalYoutube.altered_synthetic_disclosure_present,
    canonicalYoutube.ai_disclosure_applied,
    storyAiGate.disclosure_present,
    storyAiGate.present,
    canonicalAiGate.disclosure_present,
    canonicalAiGate.present,
  ].some(affirmativeDisclosureValue);
  const required = Boolean(
    requested ||
      story.ai_usage?.label_required === true ||
      story.ai_usage?.realistic_altered_or_synthetic === true ||
      canonical.ai_usage?.label_required === true ||
      canonical.ai_usage?.realistic_altered_or_synthetic === true ||
      story.ai_disclosure_required === true ||
      canonical.ai_disclosure_required === true ||
      story.realistic_synthetic_media === true ||
      canonical.realistic_synthetic_media === true ||
      story.synthetic_media_realistic === true ||
      canonical.synthetic_media_realistic === true ||
      story.synthetic_media_required === true ||
      story.altered_synthetic_disclosure_required === true ||
      canonical.synthetic_media_required === true ||
      canonical.altered_synthetic_disclosure_required === true ||
      storyAiGate.disclosure_required === true ||
      storyAiGate.required === true ||
      canonicalAiGate.disclosure_required === true ||
      canonicalAiGate.required === true ||
      present,
  );
  return {
    required,
    present,
    setting: required ? "YES" : "NO",
  };
}

function youtubePaidPromotionDisclosureState(story = {}, canonical = {}) {
  const storyYoutube = story.platform_disclosures?.youtube || {};
  const canonicalYoutube = canonical.platform_disclosures?.youtube || {};
  const present = [
    story.youtube_paid_promotion_disclosed,
    story.paid_promotion_disclosure_present,
    canonical.youtube_paid_promotion_disclosed,
    canonical.paid_promotion_disclosure_present,
    storyYoutube.paid_promotion_toggle,
    storyYoutube.paid_promotion_disclosed,
    storyYoutube.paid_promotion_disclosure_present,
    canonicalYoutube.paid_promotion_toggle,
    canonicalYoutube.paid_promotion_disclosed,
    canonicalYoutube.paid_promotion_disclosure_present,
  ].some(affirmativeDisclosureValue);
  const required = present || [
    story.paid_promotion_required,
    story.sponsorship_required,
    story.commercial_relationship_required,
    canonical.paid_promotion_required,
    canonical.sponsorship_required,
    canonical.commercial_relationship_required,
    storyYoutube.paid_promotion,
    storyYoutube.paid_promotion_disclosure_required,
    canonicalYoutube.paid_promotion,
    canonicalYoutube.paid_promotion_disclosure_required,
  ].some(affirmativeDisclosureValue);
  return { required, present };
}

function governanceReportWithFinalCoherence(report = {}, finalCoherence = {}) {
  const previousCoherence = report.public_output_coherence_gate || {};
  const previousFailures = new Set(asArray(previousCoherence.failures));
  const previousWarnings = new Set(asArray(previousCoherence.warnings));
  const controlTower = report.publish_control_tower || {};
  const reasonCodes = [...new Set([
    ...asArray(controlTower.reason_codes).filter((reason) => !previousFailures.has(reason)),
    ...asArray(finalCoherence.failures),
  ])];
  const warnings = [...new Set([
    ...asArray(controlTower.warnings).filter((warning) => !previousWarnings.has(warning)),
    ...asArray(finalCoherence.warnings),
  ])];
  const verdict = reasonCodes.length ? "RED" : warnings.length ? "AMBER" : "GREEN";
  const publishManifest = report.publish_manifest || {};
  const publishGates = publishManifest.gates || {};
  const riskReport = report.risk_report || {};
  const riskGates = asArray(riskReport.gates).map((gate) => gate.gate === "public_output_coherence_gate"
    ? {
        ...gate,
        verdict: finalCoherence.result || finalCoherence.verdict || "unknown",
        severity: asArray(finalCoherence.failures).length
          ? "RED"
          : asArray(finalCoherence.warnings).length
            ? "AMBER"
            : "GREEN",
        failures: asArray(finalCoherence.failures),
        warnings: asArray(finalCoherence.warnings),
      }
    : gate);
  const overallRisk = riskGates.some((gate) => gate.severity === "RED")
    ? "high"
    : riskGates.some((gate) => gate.severity === "AMBER")
      ? "medium"
      : "low";
  return {
    ...report,
    public_output_coherence_gate: finalCoherence,
    publish_control_tower: {
      ...controlTower,
      verdict,
      can_auto_publish: verdict === "GREEN",
      reason_codes: reasonCodes,
      warnings,
    },
    rejection_reasons: {
      ...(report.rejection_reasons || {}),
      reason_codes: reasonCodes,
      warnings,
      hard_fail: verdict === "RED",
    },
    publish_manifest: {
      ...publishManifest,
      publish_status: verdict,
      can_render: verdict !== "RED",
      can_queue: verdict !== "RED",
      can_auto_publish: verdict === "GREEN",
      reason_codes: reasonCodes,
      warnings,
      gates: {
        ...publishGates,
        public_output_coherence_gate: {
          verdict: finalCoherence.result || finalCoherence.verdict || "unknown",
          failures: asArray(finalCoherence.failures),
          warnings: asArray(finalCoherence.warnings),
        },
      },
    },
    risk_report: {
      ...riskReport,
      overall_risk: overallRisk,
      gates: riskGates,
    },
  };
}

function normaliseAcceptanceMotionClip(clip = {}) {
  if (typeof clip === "string") {
    const pathValue = cleanText(clip);
    if (!pathValue) return null;
    return {
      path: pathValue,
      source_type: "youtube_local_video_file",
      source_family: `local_video_clip:${path.basename(pathValue)}`,
      rights_risk_class: "existing_local_clip",
    };
  }
  return clip && typeof clip === "object" ? clip : null;
}

function motionClipIdentity(clip = {}) {
  if (!clip || typeof clip !== "object") return "";
  return cleanText(
    clip.path ||
      clip.file_path ||
      clip.source_url ||
      clip.sourceUrl ||
      clip.direct_media_url ||
      clip.source_family ||
      clip.asset_id ||
      clip.id,
  ).toLowerCase();
}

function normaliseAcceptanceMotionClips(clips = []) {
  const out = [];
  const seen = new Set();
  for (const clip of asArray(clips).map(normaliseAcceptanceMotionClip).filter(Boolean)) {
    const key = motionClipIdentity(clip);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clip);
  }
  return out;
}

function objectHasKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function sourceNameFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  return cleanText(
    primary.name ||
      primary.label ||
      story.primary_source_name ||
      story.source_name ||
      story.source_label ||
      story.source_card_label ||
      story.thumbnail_source_label ||
      story.subreddit ||
      (typeof story.primary_source === "string" ? story.primary_source : ""),
  );
}

function sourceUrlFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  return cleanText(primary.url || story.primary_source_url || story.source_url || story.article_url || story.url);
}

function sourcePublishedAtFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  return cleanText(
    primary.published_at ||
      primary.publishedAt ||
      story.source_published_at ||
      story.published_at ||
      story.timestamp,
  );
}

function normaliseDirectMediaCandidate(candidate = {}, index = 0) {
  const row =
    candidate && typeof candidate === "object"
      ? candidate
      : { direct_media_url: candidate };
  const directMediaUrl = cleanText(
    row.direct_media_url ||
      row.direct_media_url_if_available ||
      row.approved_direct_media_url ||
      row.url ||
      row.href ||
      row.source_url ||
      row.video_url ||
      row.trailer_url,
  );
  const sourceKind = mediaSourceUrlKindFields(directMediaUrl);
  const isOfficialYoutubeReference =
    /^youtube_/.test(sourceKind.source_url_kind) &&
    /^official_youtube_(?:reference|video|watch|channel_url)$/.test(cleanText(row.source_type || row.type).toLowerCase());
  if (sourceKind.segment_validation_eligible !== true && !isOfficialYoutubeReference) return null;
  const directMediaUrlIfAvailable = sourceKind.segment_validation_eligible === true ? directMediaUrl : null;
  return {
    direct_media_url: directMediaUrl,
    direct_media_url_if_available: directMediaUrlIfAvailable,
    label: cleanText(row.label || row.title || row.name || row.source_title) || null,
    source_title: cleanText(row.source_title || row.title || row.label || row.name) || null,
    source_family: cleanText(row.source_family || row.family || row.media_identity) || `direct_media_${index + 1}`,
    source_type: cleanText(row.source_type || row.type || "official_direct_media"),
    source_url_kind: sourceKind.source_url_kind,
    segment_validation_eligible: sourceKind.segment_validation_eligible === true,
    segment_validation_ineligible_reason: sourceKind.segment_validation_ineligible_reason || null,
    duration_s: row.duration_s || row.durationS || row.source_duration_s || null,
  };
}

function sourceDirectMediaCandidatesFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  const rows = [
    ...(Array.isArray(story.direct_media_candidates) ? story.direct_media_candidates : []),
    ...(Array.isArray(story.media_candidates) ? story.media_candidates : []),
    ...(Array.isArray(story.official_media_candidates) ? story.official_media_candidates : []),
    ...(Array.isArray(primary.direct_media_candidates) ? primary.direct_media_candidates : []),
    ...(Array.isArray(primary.media_candidates) ? primary.media_candidates : []),
    ...(Array.isArray(primary.official_media_candidates) ? primary.official_media_candidates : []),
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.video_url,
    story.trailer_url,
    primary.approved_direct_media_url,
    primary.direct_media_url,
    primary.direct_media_url_if_available,
    primary.video_url,
    primary.trailer_url,
  ];
  const seen = new Set();
  return rows
    .map(normaliseDirectMediaCandidate)
    .filter(Boolean)
    .filter((candidate) => {
      const key = candidate.direct_media_url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normaliseOfficialSourcePageCandidate(candidate = {}, index = 0) {
  const row =
    candidate && typeof candidate === "object"
      ? candidate
      : { official_source_url: candidate };
  const url = cleanText(
    row.official_source_url ||
      row.source_url ||
      row.reference_url ||
      row.page_url ||
      row.store_url ||
      row.approved_direct_media_url ||
      row.direct_media_url_if_available ||
      row.direct_media_url ||
      row.url ||
      row.href,
  );
  if (!/^https?:\/\//i.test(url)) return null;
  if (mediaSourceUrlKindFields(url).segment_validation_eligible === true) return null;
  if (
    !/(?:store\.steampowered\.com|news\.xbox\.com|xbox\.com|playstation\.com|nintendo\.com|rockstargames\.com|bethesda\.net|ea\.com|ubisoft\.com|capcom-games\.com|sega\.com|square-enix-games\.com|konami\.com|epicgames\.com)/i.test(
      url,
    )
  ) {
    return null;
  }
  return {
    url,
    source_url: url,
    official_source_url: url,
    label: cleanText(row.label || row.title || row.source_title || row.name || `official source page ${index + 1}`),
    source_title: cleanText(row.source_title || row.title || row.label || row.name || `official source page ${index + 1}`),
    source_owner: cleanText(row.source_owner || row.source_name || row.owner || row.name),
    source_family: cleanText(row.source_family || row.family || row.media_identity || `official_source_page_${index + 1}`),
    source_type: cleanText(row.source_type || row.type || "official_source_page"),
    rights_basis: cleanText(row.rights_basis || "official_source_page_for_motion_discovery"),
  };
}

function officialSourcePagesFromStory(story = {}) {
  const primary = story.primary_source && typeof story.primary_source === "object" ? story.primary_source : {};
  const rows = [
    ...(Array.isArray(story.official_source_pages) ? story.official_source_pages : []),
    ...(Array.isArray(story.storefront_sources) ? story.storefront_sources : []),
    ...(Array.isArray(story.source_pages) ? story.source_pages : []),
    ...(Array.isArray(primary.official_source_pages) ? primary.official_source_pages : []),
    ...(Array.isArray(primary.storefront_sources) ? primary.storefront_sources : []),
    ...(Array.isArray(primary.source_pages) ? primary.source_pages : []),
    story.approved_direct_media_url,
    story.direct_media_url,
    story.direct_media_url_if_available,
    story.store_url,
    story.storefront_url,
    primary.approved_direct_media_url,
    primary.direct_media_url,
    primary.direct_media_url_if_available,
    primary.store_url,
    primary.storefront_url,
  ];
  const seen = new Set();
  return rows
    .map(normaliseOfficialSourcePageCandidate)
    .filter(Boolean)
    .filter((candidate) => {
      const key = candidate.official_source_url.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function sourceDirectMediaFromStory(story = {}) {
  return sourceDirectMediaCandidatesFromStory(story)
    .find((candidate) => candidate.segment_validation_eligible === true && candidate.direct_media_url_if_available)
    ?.direct_media_url_if_available || "";
}

function ageHoursFromIso(value, generatedAt) {
  const publishedMs = Date.parse(value || "");
  const generatedMs = Date.parse(generatedAt || "");
  if (!Number.isFinite(publishedMs) || !Number.isFinite(generatedMs)) return null;
  return Number(Math.max(0, (generatedMs - publishedMs) / 36e5).toFixed(2));
}

function uniqueClaims(values = []) {
  return values.filter((claim, index, arr) => arr.indexOf(claim) === index);
}

function sourceEvidenceFromStory(story = {}, primarySourceUrl = "") {
  const primary = story.primary_source && typeof story.primary_source === "object"
    ? story.primary_source
    : {};
  const evidence = story.source_evidence && typeof story.source_evidence === "object"
    ? story.source_evidence
    : primary.source_evidence && typeof primary.source_evidence === "object"
      ? primary.source_evidence
      : null;
  if (!evidence || Array.isArray(evidence)) return null;
  const sourceUrl = cleanText(evidence.source_url || evidence.url || primarySourceUrl);
  const cloned = {
    ...evidence,
    ...(sourceUrl ? { source_url: sourceUrl } : {}),
    claims: asArray(evidence.claims).map((claim) =>
      claim && typeof claim === "object" ? { ...claim } : claim,
    ),
  };
  if (
    primarySourceUrl &&
    sourceUrl &&
    sourceUrl.replace(/\/$/, "").toLowerCase() !== primarySourceUrl.replace(/\/$/, "").toLowerCase()
  ) {
    return {
      ...cloned,
      status: "blocked",
      reason: "source_evidence_url_mismatch",
    };
  }
  return cloned;
}

function buildFallbackSourceManifest(story = {}, generatedAt) {
  const name = sourceNameFromStory(story);
  const url = sourceUrlFromStory(story);
  const publishedAt = sourcePublishedAtFromStory(story);
  const directMediaUrl = sourceDirectMediaFromStory(story);
  const directMediaCandidates = sourceDirectMediaCandidatesFromStory(story);
  const officialSourcePages = officialSourcePagesFromStory(story);
  const sourceEvidence = sourceEvidenceFromStory(story, url);
  const ageHours = ageHoursFromIso(publishedAt, generatedAt);
  const fresh = ageHours !== null && ageHours <= 168;
  const coherent = Boolean(name && url);
  return {
    schema_version: 1,
    story_id: story.id || story.story_id || null,
    generated_at: generatedAt,
    primary_source: {
      name: name || null,
      url: url || null,
      type: cleanText(story.source_type || "official_or_major_source"),
      published_at: publishedAt || null,
      age_hours: ageHours,
      direct_media_url_if_available: directMediaUrl || null,
      direct_media_candidates: directMediaCandidates,
      official_source_pages: officialSourcePages,
    },
    direct_media_url_if_available: directMediaUrl || null,
    approved_direct_media_url: directMediaUrl || null,
    direct_media_candidates: directMediaCandidates,
    official_source_pages: officialSourcePages,
    ...(sourceEvidence ? { source_evidence: sourceEvidence } : {}),
    source_age_policy_hours: 168,
    freshness_gate: fresh ? "pass" : "blocked",
    coherence_gate: coherent ? "pass" : "blocked",
    fallback_from_story_manifest: true,
    blockers: [
      ...(fresh ? [] : ["source_age_missing_or_over_7_days"]),
      ...(coherent ? [] : ["primary_source_name_or_url_missing"]),
    ],
  };
}

function buildFallbackClaimInventory(story = {}) {
  return {
    schema_version: 1,
    story_id: story.id || story.story_id || null,
    confirmed: uniqueClaims([
      ...asArray(story.claim_inventory?.confirmed),
      ...asArray(story.confirmed_claims),
    ]),
    unconfirmed: uniqueClaims([
      ...asArray(story.claim_inventory?.unconfirmed),
      ...asArray(story.unconfirmed_claims),
    ]),
    prohibited: uniqueClaims([
      ...asArray(story.claim_inventory?.prohibited),
      ...asArray(story.prohibited_claims),
    ]),
    fallback_from_story_manifest: true,
    public_copy_guardrails: [
      "viewer_facing_only",
      "no_internal_qa_language",
      "no_weak_fallback_narration",
      "approved_cta_only",
    ],
  };
}

function normaliseSignatureText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceFamilyFor(asset = {}, index = 0) {
  return (
    cleanText(asset.source_family) ||
    cleanText(asset.trusted_footage_source_id) ||
    cleanText(asset.source_id) ||
    cleanText(asset.id) ||
    `source_family_${index + 1}`
  );
}

function explicitTrustedReferencesFromStory(story = {}) {
  const rows = [
    ...asArray(story.trusted_footage_references),
    ...asArray(story.trusted_source_references),
  ];
  const seen = new Set();
  return rows
    .map((reference, index) => {
      const row = reference && typeof reference === "object"
        ? reference
        : { url: reference };
      const url = cleanText(row.reference_url || row.source_url || row.url || row.href);
      if (!/^https?:\/\//i.test(url)) return null;
      const key = url.replace(/\/$/, "").toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      const entity = cleanText(story.canonical_subject || story.canonical_game || story.title);
      const sourceFamily = cleanText(
        row.source_family || row.id || `official_reference_${index + 1}`,
      );
      return {
        story_id: story.id || story.story_id || null,
        entity: entity || null,
        entities: [story.canonical_subject, story.canonical_game, story.title]
          .map(cleanText)
          .filter(Boolean),
        source_id: cleanText(row.id || sourceFamily),
        display_name: cleanText(row.label || row.title || row.name || "official reference"),
        title: cleanText(row.title || row.label || row.name || "official reference"),
        source_tier: "official",
        source_family: sourceFamily,
        reference_url: url,
        source_url_kind: "web_page",
        source_type: cleanText(row.source_type || row.type || "official_reference_only"),
        segment_validation_eligible: false,
        autonomous_motion_candidate: false,
        allowed_render_use: "reference_only",
        rights_risk_class: "official_reference_only",
        downloads_started: false,
        provenance: {
          official_evidence: "Explicit official reference retained for source provenance only.",
        },
      };
    })
    .filter(Boolean);
}

function buildTrustedFootageReport(story = {}) {
  const clips = asArray(story.video_clips).length
    ? asArray(story.video_clips)
    : asArray(story.motion_clips);
  const directMediaCandidates = sourceDirectMediaCandidatesFromStory(story).map((candidate, index) => ({
    story_id: story.id || story.story_id || null,
    entity: story.canonical_subject || story.canonical_game || story.title || null,
    entities: [
      story.canonical_subject,
      story.canonical_game,
      story.title,
    ].map(cleanText).filter(Boolean),
    source_id: cleanText(candidate.source_family || candidate.label || `direct_media_${index + 1}`),
    display_name: cleanText(candidate.label || candidate.source_title || candidate.source_family || "official direct media"),
    title: cleanText(candidate.source_title || candidate.label || candidate.source_family || "official direct media"),
    source_tier: "official",
    source_family: cleanText(candidate.source_family || `direct_media_${index + 1}`),
    reference_url: cleanText(candidate.direct_media_url),
    approved_media_url: cleanText(candidate.direct_media_url),
    source_url_kind: /\.(?:m3u8)(?:[?#]|$)/i.test(candidate.direct_media_url)
      ? "hls_manifest"
      : /\.(?:mpd)(?:[?#]|$)/i.test(candidate.direct_media_url)
        ? "dash_manifest"
        : "video_file",
    source_type: cleanText(candidate.source_type || "official_direct_media"),
    segment_validation_eligible: true,
    autonomous_motion_candidate: true,
    allowed_render_use: "official_direct_media_segment_candidate",
    rights_risk_class: "official_direct_media",
    provenance: {
      official_evidence: "Official direct media was supplied by the source manifest for this story.",
    },
  }));
  const explicitTrustedReferences = explicitTrustedReferencesFromStory(story);
  return {
    story_candidates: [
      ...clips
        .filter((clip) => !isGeneratedMotionAsset(clip) && isRealMediaAsset(clip))
        .map((clip, index) => ({
          story_id: story.id || null,
          entity: story.canonical_subject || story.canonical_game || story.title || null,
          source_id: cleanText(clip.id || clip.asset_id || `clip_${index + 1}`),
          display_name: cleanText(clip.source_family || clip.source_type || "trusted source"),
          source_tier: /licensed/i.test(clip.rights_risk_class || "") ? "licensed_creator" : "official",
          source_family: sourceFamilyFor(clip, index),
          reference_url: cleanText(clip.source_url || clip.url || clip.path),
          source_url_kind: "web_page",
          segment_validation_eligible: false,
          autonomous_motion_candidate: true,
          allowed_render_use: "reference_only_by_default",
          rights_risk_class: cleanText(clip.rights_risk_class) || "official_reference_only",
        })),
      ...directMediaCandidates,
      ...explicitTrustedReferences,
    ],
  };
}

function buildLocalMotionClips(story = {}) {
  const seen = new Set();
  return [
    ...asArray(story.video_clips),
    ...asArray(story.visual_v4_local_motion_clips),
  ]
    .filter((clip) =>
      (!isGeneratedMotionAsset(clip) && isRealMediaAsset(clip)) ||
        isStrictlyVerifiedOwnedMotionClip(clip))
    .filter((clip) => {
      const key = [
        cleanText(clip.id || clip.asset_id),
        cleanText(clip.path || clip.local_path),
        cleanText(clip.source_url || clip.url),
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((clip, index) => ({
      ...clip,
      id: cleanText(clip.id || clip.asset_id || `local_clip_${index + 1}`),
      source_family: sourceFamilyFor(clip, index),
      path: cleanText(clip.path || clip.local_path || `output/video/${story.id || "story"}_${index + 1}.mp4`),
      durationS: Number(clip.durationS || clip.duration_s || clip.duration || 2.4),
      validated: clip.validated !== false,
      type: "motion_clip",
    }));
}

function buildLocalTimeline(story = {}) {
  const script = cleanText(story.full_script || story.tts_script);
  const sentences = script.split(/(?<=[.!?])\s+/).filter(Boolean);
  return {
    duration_s: Math.max(35, Math.min(60, sentences.length * 6)),
    beats: sentences.slice(0, 8).map((sentence, index) => ({
      id: `beat_${index + 1}`,
      type: index === 0 ? "hook" : /\b\d|steam|score|price|\$/i.test(sentence) ? "metric" : "context",
      start: Number((index * 4.8).toFixed(2)),
      end: Number((index * 4.8 + 3.4).toFixed(2)),
      text: sentence,
    })),
  };
}

function buildAudioManifest({ story, soundPlan }) {
  const existing = objectHasKeys(story.audio_manifest) ? story.audio_manifest : {};
  return {
    ...existing,
    schema_version: 1,
    story_id: story.id || null,
    narration_audio_path: existing.narration_audio_path || story.audio_path || null,
    music_bed: existing.music_bed || "local_editorial_energy_bed",
    sfx_cue_count: existing.sfx_cue_count ?? soundPlan.sfx?.cue_count ?? 0,
    loudness_target: {
      ...(existing.loudness_target || {}),
      platform: "short_form_social",
      peak_db:
        existing.loudness_target?.peak_db ??
        soundPlan.sfx?.mastering?.target_peak_db ??
        -1.5,
      narration_priority: true,
    },
    mix_rules: existing.mix_rules || soundPlan.sfx?.mastering || {},
    safety: {
      ...(soundPlan.safety || {}),
      ...(existing.safety || {}),
    },
  };
}

function lineageIdentityBlockers(name, manifest = {}, expectedStoryId = "") {
  if (!objectHasKeys(manifest)) return [];
  const blockers = [];
  const suppliedStoryId = cleanText(manifest.story_id);
  if (suppliedStoryId && suppliedStoryId !== cleanText(expectedStoryId)) {
    blockers.push(`lineage:${name}_story_id_mismatch`);
  }
  if (manifest.schema_version != null && Number(manifest.schema_version) !== 1) {
    blockers.push(`lineage:${name}_schema_version_mismatch`);
  }
  return blockers;
}

function declaredSha256(value, kind, blockers, values) {
  const hash = cleanText(value).toLowerCase();
  if (!hash) return;
  if (!/^[a-f0-9]{64}$/.test(hash)) {
    blockers.push(`lineage:${kind}_sha256_invalid`);
    return;
  }
  values.add(hash);
}

function lineageConsistencyBlockers({
  expectedStoryId = "",
  audioManifest = {},
  narrationManifest = {},
  captionManifest = {},
  renderManifest = {},
} = {}) {
  const blockers = [
    ...lineageIdentityBlockers("audio_manifest", audioManifest, expectedStoryId),
    ...lineageIdentityBlockers("narration_manifest", narrationManifest, expectedStoryId),
    ...lineageIdentityBlockers("caption_manifest", captionManifest, expectedStoryId),
    ...lineageIdentityBlockers("render_manifest", renderManifest, expectedStoryId),
  ];
  const audioHashes = new Set();
  const timestampHashes = new Set();
  for (const value of [
    audioManifest.narration_audio_sha256,
    audioManifest.audio_sha256,
    narrationManifest.audio_sha256,
    narrationManifest.narration_audio_sha256,
    narrationManifest.lineage?.final_audio_sha256,
    captionManifest.audio_sha256,
    captionManifest.narration_audio_sha256,
    captionManifest.lineage?.final_audio_sha256,
    renderManifest.input_fingerprint?.audio_sha256,
  ]) declaredSha256(value, "audio", blockers, audioHashes);
  for (const value of [
    audioManifest.word_timestamps_sha256,
    narrationManifest.word_timestamps_sha256,
    narrationManifest.lineage?.frozen_word_timestamps_sha256,
    captionManifest.word_timestamps_sha256,
    captionManifest.lineage?.frozen_word_timestamps_sha256,
    renderManifest.input_fingerprint?.word_timestamps_sha256,
  ]) declaredSha256(value, "word_timestamps", blockers, timestampHashes);
  if (audioHashes.size > 1) blockers.push("lineage:audio_sha256_conflict");
  if (timestampHashes.size > 1) blockers.push("lineage:word_timestamps_sha256_conflict");
  const narrationSignals = [narrationManifest.verdict, narrationManifest.status]
    .map((value) => cleanText(value).toLowerCase())
    .filter(Boolean);
  const positiveNarrationSignals = new Set([
    "green",
    "pass",
    "passed",
    "ready",
    "ok",
    "complete",
  ]);
  const narrationHasNonGreenSignal =
    narrationSignals.length === 0 ||
    narrationSignals.some((value) => !positiveNarrationSignals.has(value));
  if (objectHasKeys(narrationManifest) && narrationHasNonGreenSignal) {
    blockers.push("lineage:narration_manifest_not_green");
  }
  if (objectHasKeys(narrationManifest) && asArray(narrationManifest.blockers).length > 0) {
    blockers.push("lineage:narration_manifest_blockers_present");
  }
  const finalGreenNarration =
    objectHasKeys(narrationManifest) &&
    !narrationHasNonGreenSignal &&
    narrationSignals.every((value) => positiveNarrationSignals.has(value)) &&
    renderManifest.final_publish_render === true;
  if (finalGreenNarration) {
    const requiredClaims = [
      ["audio_manifest_audio", audioManifest.narration_audio_sha256 || audioManifest.audio_sha256],
      ["narration_manifest_audio", narrationManifest.audio_sha256 || narrationManifest.narration_audio_sha256 || narrationManifest.lineage?.final_audio_sha256],
      ["caption_manifest_audio", captionManifest.audio_sha256 || captionManifest.narration_audio_sha256 || captionManifest.lineage?.final_audio_sha256],
      ["render_manifest_audio", renderManifest.input_fingerprint?.audio_sha256],
      ["audio_manifest_word_timestamps", audioManifest.word_timestamps_sha256],
      ["narration_manifest_word_timestamps", narrationManifest.word_timestamps_sha256 || narrationManifest.lineage?.frozen_word_timestamps_sha256],
      ["caption_manifest_word_timestamps", captionManifest.word_timestamps_sha256 || captionManifest.lineage?.frozen_word_timestamps_sha256],
      ["render_manifest_word_timestamps", renderManifest.input_fingerprint?.word_timestamps_sha256],
    ];
    for (const [name, value] of requiredClaims) {
      if (!cleanText(value)) blockers.push(`lineage:${name}_sha256_missing`);
    }
  }
  return [...new Set(blockers)];
}

function buildVisualQualityReport({ story, directorPlan, benchmark }) {
  const firstFrameText = cleanText(
    story.first_frame_text ||
      story.thumbnail_headline ||
      story.suggested_thumbnail_text ||
      story.thumbnail_text,
  );
  return {
    schema_version: 1,
    story_id: story.id || story.story_id || null,
    result: benchmark.result || "unknown",
    scores: benchmark.scores || {},
    frame_rules: {
      first_frame_subject: story.canonical_subject || story.canonical_game || null,
      first_frame_text: firstFrameText || null,
      source_locks_readable: directorPlan.visual_obligations?.source_locks_must_be_readable === true,
      no_empty_rectangles: directorPlan.visual_obligations?.forbid_empty_rectangles === true,
      no_text_on_text: directorPlan.visual_obligations?.forbid_text_on_text === true,
    },
    failures: benchmark.failures || [],
  };
}

function buildForensicQaReport({ scriptScorecard, footageInventory, directorPlan, benchmark, governanceReport }) {
  return {
    schema_version: 1,
    story_id: governanceReport.story_id || null,
    verdict:
      governanceReport.publish_control_tower?.verdict === "GREEN" &&
      !asArray(scriptScorecard.blockers).length
        ? "reviewable_proof"
        : "blocked_or_rewrite_required",
    checks: {
      public_output: governanceReport.public_output_coherence_gate?.result || "unknown",
      rights: governanceReport.rights_ledger?.verdict || "unknown",
      script: scriptScorecard.verdict || "unknown",
      footage: footageInventory.readiness?.status || "unknown",
      director: directorPlan.readiness?.status || "unknown",
      benchmark: benchmark.result || "unknown",
    },
    blockers: [
      ...asArray(governanceReport.rejection_reasons?.reason_codes),
      ...asArray(scriptScorecard.blockers),
      ...asArray(footageInventory.readiness?.blockers),
      ...asArray(directorPlan.readiness?.blockers),
      ...asArray(benchmark.failures),
    ],
  };
}

function buildSimpleCaptionSrt(script = "", durationS = 12) {
  const sentences = cleanText(script).split(/(?<=[.!?])\s+/).filter(Boolean);
  const lines = sentences.length ? sentences.slice(0, 10) : ["Pulse Gaming proof render."];
  const segment = Math.max(1.2, durationS / lines.length);
  return `${lines.map((line, index) => {
    const start = index * segment;
    const end = Math.min(durationS, start + segment);
    return [
      String(index + 1),
      `${formatSrtTime(start)} --> ${formatSrtTime(end)}`,
      line,
    ].join("\n");
  }).join("\n\n")}\n`;
}

function formatSrtTime(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function ffmpegDrawtextEscape(value) {
  return cleanText(value)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/%/g, "\\%");
}

function compactRenderText(value = "", fallback = "") {
  const text = cleanText(value || fallback).replace(/[^a-zA-Z0-9 $+&._-]+/g, "");
  return text.split(/\s+/).slice(0, 7).join(" ").toUpperCase();
}

const PLATFORM_NATIVE_ORDER = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

const COMMERCIAL_PLATFORM_KEYS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "threads",
  "pinterest",
];

const PLATFORM_NATIVE_REQUIREMENTS = {
  youtube_shorts: [
    "title",
    "description",
    "hashtags",
    "cover_frame",
    "captions",
    "profile_or_landing_page_cta",
  ],
  tiktok: [
    "conversational_hook",
    "caption",
    "hashtags",
    "disclosure_flag",
    "commercial_content_setting_recommendation",
    "product_link_eligibility",
  ],
  instagram_reels: [
    "cover_frame",
    "caption",
    "carousel_companion.required",
    "story_poll_idea",
    "bio_link_cta",
  ],
  facebook_reels: [
    "page_caption",
    "link_routing_strategy",
    "duration_seconds",
    "explanatory_framing",
  ],
  x: [
    "hot_take_post",
    "source_safe_post",
    "thread_posts",
    "poll_candidate",
    "landing_page_link",
  ],
  threads: [
    "discussion_post",
    "duplicate_x_wording_allowed",
    "landing_page_link",
    "tone",
  ],
  pinterest: [
    "pin_title",
    "pin_description",
    "disclosure",
    "landing_page_link",
    "evergreen_only",
  ],
};

function slugify(value = "") {
  const slug = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "pulse-gaming-story";
}

function weakCanonicalSubject(value = "") {
  const text = cleanText(value);
  if (!text) return true;
  return (
    /^(?:this game|this story|gaming news|source-backed update|if you haven'?t reserved)\b/i.test(text) ||
    /\bdevelopment team included group\b/i.test(text)
  );
}

function knownCanonicalSubject(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  if (/\bdenshattack!?\b/i.test(text)) return "Denshattack";
  if (/^free\s+play\s+days\b/i.test(text)) return "Free Play Days";
  if (/\b(?:gta\s*vi|grand\s+theft\s+auto\s*vi)\b/i.test(text)) return "Grand Theft Auto VI";
  if (/\b(?:gta\s*6|grand\s+theft\s+auto\s*6)\b/i.test(text)) return "GTA 6";
  if (/\bsuper\s+mario\s*64\b/i.test(text) && /\b(?:35mm|film\s+slides?|collectibles?)\b/i.test(text)) return "Super Mario 64";
  if (/\bmario\s+kart\s*64\b/i.test(text)) return "Mario Kart 64";
  return "";
}

function inferSubjectFromHeadline(value = "") {
  const text = cleanText(value).replace(/(?:&#8217;|&rsquo;|’)/g, "'");
  if (!text) return "";
  const known = knownCanonicalSubject(text);
  if (known) return known;
  const reserved = text.match(/^If\s+You\s+Haven'?t\s+Reserved\s+(?:A|An|The)?\s*(.+?)\s+Yet\b/i);
  if (reserved?.[1]) return cleanText(reserved[1]);
  const possessive = text.match(/^(.{2,60}?)['’]s\s+(?:development|developer|team|director|creator|composer|writer|producer)\b/i);
  if (possessive?.[1]) return cleanText(possessive[1]);
  const howMatch = text.match(/^How\s+([A-Z][A-Za-z0-9:+.-]+(?:\s+[A-Z][A-Za-z0-9:+.-]+){0,3})\s+(?:Paved|Made|Changed|Built|Created|Inspired|Turned|Became|Gets|Got|Has|Is|Was|Helped)\b/);
  if (howMatch?.[1]) return cleanText(howMatch[1]);
  return "";
}

function repairCanonicalSubject(rawSubject = "", story = {}, canonical = {}) {
  const subject = cleanText(rawSubject);
  const known = knownCanonicalSubject(subject);
  if (known) return known;
  if (!weakCanonicalSubject(subject)) return subject;
  const inferred = [
    canonical.canonical_title,
    canonical.title,
    canonical.selected_title,
    story.public_title,
    story.suggested_title,
    story.title,
  ]
    .map((candidate) => knownCanonicalSubject(candidate) || inferSubjectFromHeadline(candidate))
    .find((candidate) => candidate && !weakCanonicalSubject(candidate));
  return inferred || subject;
}

function storySubject(story = {}, canonical = {}) {
  const subject = cleanText(
    story.canonical_subject ||
      story.canonical_game ||
      canonical.canonical_subject ||
      canonical.canonical_game ||
      story.public_title ||
      story.title,
  );
  return repairCanonicalSubject(subject, story, canonical);
}

function titleLooksReplaceableFallback(value = "") {
  return /\b(?:could\s+split\s+players|just\s+got\s+a\s+new\s+signal|has\s+one\s+detail\s+players\s+should\s+notice|source[-\s]?backed\s+update)\b/i.test(
    cleanText(value),
  );
}

function candidateTitleMatchesStory(title = "", story = {}, canonical = {}) {
  const candidate = cleanText(title).toLowerCase();
  if (!candidate) return false;
  const evidence = cleanText([
    storySubject(story, canonical),
    story.title,
    story.public_title,
    story.selected_title,
    story.suggested_title,
    story.short_title,
    story.canonical_subject,
    story.canonical_game,
    story.description,
    story.seo_description,
    story.source_title,
    story.article_title,
    canonical.title,
    canonical.public_title,
    canonical.selected_title,
    canonical.short_title,
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.description,
    ...asArray(story.confirmed_claims),
    ...asArray(canonical.confirmed_claims),
    ...asArray(story.claim_inventory?.confirmed),
    ...asArray(canonical.claim_inventory?.confirmed),
  ].filter(Boolean).join(" ")).toLowerCase();
  if (!evidence) return false;
  const tokens = candidate
    .split(/[^a-z0-9]+/i)
    .map((token) => token.trim())
    .filter((token) =>
      token.length >= 3 &&
      !/^(?:the|and|for|has|have|had|with|into|from|this|that|just|gets|got|new|why|could|players|test|finally|real|shows)$/i.test(token)
    );
  return tokens.filter((token) => evidence.includes(token)).length >= 2;
}

function bestStoryTitleCandidate(story = {}, canonical = {}) {
  return [
    ...asArray(story.title_candidates),
    ...asArray(canonical.title_candidates),
    story.short_title,
    canonical.short_title,
  ]
    .map(cleanText)
    .find((title) =>
      title &&
      !titleLooksReplaceableFallback(title) &&
      candidateTitleMatchesStory(title, story, canonical) &&
      title.split(/\s+/).length <= 12
    ) || "";
}

function storyTitle(story = {}, canonical = {}) {
  const title = cleanText(
    story.public_title ||
      story.selected_title ||
      story.suggested_title ||
      story.title ||
      canonical.selected_title ||
      canonical.canonical_title ||
      canonical.title ||
      storySubject(story, canonical),
  );
  if (titleLooksReplaceableFallback(title)) {
    return bestStoryTitleCandidate(story, canonical) || title;
  }
  return title;
}

function storyAngle(story = {}, canonical = {}) {
  return cleanText(canonical.canonical_angle || story.canonical_angle || story.angle || "");
}

const INTERNAL_ANGLE_RE =
  /\b(?:source_locked_update|source locked update|music_licence_preservation|music licence preservation|licence_preservation|rights_preservation)\b/i;
const LABEL_ANGLE_RE = /^(?:confirmed drop|source breakdown|rumou?r watch|news|review|source-backed update)$/i;
const HEADLINE_DANGLE_RE = /\b(?:a|an|the|of|for|to|into|with|without|has|have|had|is|are|was|were|make|makes|made|turns|turned|gets|get|got|feel|why|you|your|their|our)$/i;
const ARTICLE_BOILERPLATE_RE =
  /\b(?:appeared first on|advertisement|read our|read more|see at amazon|see on steam|we had the chance|at a recent press event)\b|https?:\/\/|&#\d+;|&nbsp;|\[&#\d+;\]/i;
const PLATFORM_HARD_DETAIL_RE =
  /\b(?:[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one[- ]hour|grand tour|ferrari\s+250\s+gto|demo|demos|storage|ssd|pc port|pc specs?|free[- ]access|free trial|free weekend|price|subscription|game pass|review score|release date|launch date|delay(?:ed)?|gameplay|early access|wait[- ]?list|pre[- ]?order|reservation|hollywood|movie|film|steam ceiling|spike|demand|momentum|custom seas|private seas|private sessions?|private mode|rule controls?|set (?:their own )?rules|safer seas|jump[- ]?scares?|choices?|empathy|atmosphere|horror|og pass|map changes?|live events?|chapter\s*1|ea\s+play|ps5|jungle|combat|discovery|readability|roster|meta|matchups?|team building|screen control|tag fighters?|diddy\s+kong|mascot\s+kart|handling|wishlist|nostalgia|roguelite|podracing|repeat[- ]run|wipeout|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board)\b/i;
const INTERNAL_REVIEW_PUBLIC_COPY_RE =
  /\b(?:real source detail,\s*but not enough practical consequence for a strong pulse short yet|needs one concrete player-facing detail|more than a feed item|what players,\s*creators or the wider community|footage,\s*release timing,\s*price|if the next proof gives that answer|stays a watch item)\b/i;
const SHORT_FEED_QUALITY_PLATFORMS = new Set([
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
]);

function diddyKartComparisonSignal(evidenceText = "") {
  const text = cleanText(evidenceText);
  if (/\b(?:diddy\s+kong\s+racing|yooka[-\s]?laylee\s+kart|mascot\s+kart)\b/i.test(text)) {
    return true;
  }
  if (/\bhandling\b/i.test(text) && /\b(?:kart|karting|racing|diddy|yooka|mascot)\b/i.test(text)) {
    return true;
  }
  if (/\bnostalgia\b/i.test(text) && /\b(?:diddy\s+kong|yooka[-\s]?laylee|mascot\s+kart|karting|kart racer|kart racing)\b/i.test(text)) {
    return true;
  }
  return false;
}

function roboKyGuiltyGearSignal(value = "") {
  const text = cleanText(value);
  return /\brobo[-\s]?ky\b/i.test(text) && /\bguilty\s+gear\b/i.test(text);
}

function updateDateLabel(evidenceText = "") {
  const text = cleanText(evidenceText);
  const monthDay = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+([0-3]?\d)\b/i,
  );
  if (monthDay) {
    const month = monthDay[1].charAt(0).toUpperCase() + monthDay[1].slice(1).toLowerCase();
    return `${month} ${Number(monthDay[2])}`;
  }
  const isoDate = text.match(/\b20\d{2}[-/](0?[1-9]|1[0-2])[-/]([0-3]?\d)\b/);
  if (isoDate) return `${Number(isoDate[1])}/${Number(isoDate[2])}`;
  return "";
}

function platformTitleSubjectShortName(subject = "", evidenceText = "") {
  const text = cleanText([subject, evidenceText].join(" "));
  if (/\bblack\s+ops\s*7\b/i.test(text)) return "Black Ops 7";
  if (/\bblack\s+ops\s*6\b/i.test(text)) return "Black Ops 6";
  if (/\b(?:gta\s*vi|grand\s+theft\s+auto\s*vi)\b/i.test(text)) return "GTA VI";
  if (/\b(?:gta\s*6|grand\s+theft\s+auto\s*6)\b/i.test(text)) return "GTA 6";
  return cleanText(subject);
}

function concreteUpdateDetailSignal(evidenceText = "") {
  return /\b(?:maps?|modes?|zombies?|endgame|progression|prestige|weapon prestige|battle pass|season|reload(?:ed)?|ranked|operator|weapons?|perk|mission|campaign|boss|raid|chapter|event|limited[- ]time|free access|trial|june\s+\d{1,2}|july\s+\d{1,2}|august\s+\d{1,2}|september\s+\d{1,2}|october\s+\d{1,2}|november\s+\d{1,2}|december\s+\d{1,2})\b/i.test(
    cleanText(evidenceText),
  );
}

function specificUpdatePlatformTitle({ subject = "", evidenceText = "" } = {}) {
  const text = cleanText(evidenceText);
  if (!/\b(?:expansion|dlc|update|season|battle pass|reload(?:ed)?)\b/i.test(text)) return "";
  if (!concreteUpdateDetailSignal(text)) return "";
  if (/\b(?:fortnite\s+og|og pass|map changes?|live events?|chapter\s*1)\b/i.test(`${subject} ${text}`)) return "";
  const shortSubject = platformTitleSubjectShortName(subject, text);
  const date = updateDateLabel(text);
  if (/\b(?:call\s+of\s+duty|black\s+ops)\b/i.test(`${subject} ${text}`)) {
    return `${shortSubject}'s ${date ? `${date} ` : ""}Update Has One Reinstall Catch`;
  }
  if (/\b(?:zombies?|endgame|prestige|progression)\b/i.test(text)) {
    return `${shortSubject}'s ${date ? `${date} ` : ""}Update Has One Reinstall Catch`;
  }
  if (/\b(?:maps?|modes?|battle pass|season|reload(?:ed)?)\b/i.test(text)) {
    return `${shortSubject}'s ${date ? `${date} ` : ""}Update Has A Week-Two Test`;
  }
  return "";
}

function specificUpdateAttentionBody({ subject = "", evidenceText = "" } = {}) {
  const text = cleanText(evidenceText);
  if (/\bassassin'?s\s+creed\s+black\s+flag\s+resynced\b/i.test(`${subject} ${text}`) && /\bps5\s+pro\b/i.test(text)) {
    return `${subject} needs PS5 Pro motion proof now. Players will judge whether sailing, boarding and combat feel sharper, not whether the water looks prettier.`;
  }
  if (/\bthe\s+crew\s+motorfest\b/i.test(`${subject} ${text}`) && /\b(?:grand tour|one[- ]hour|ferrari\s+250\s+gto)\b/i.test(text)) {
    return "The Crew Motorfest is asking players to spend an hour on one Grand Tour. That could finally give Motorfest an identity, or expose Season 10 as filler with a Ferrari prize.";
  }
  if (!/\b(?:expansion|dlc|update|season|battle pass|reload(?:ed)?)\b/i.test(text)) return "";
  if (!concreteUpdateDetailSignal(text)) return "";
  if (/\b(?:fortnite\s+og|og pass|map changes?|live events?|chapter\s*1)\b/i.test(`${subject} ${text}`)) return "";
  const shortSubject = platformTitleSubjectShortName(subject, text);
  const fullSubject = cleanText(subject) || shortSubject;
  const date = updateDateLabel(text);
  if (/\b(?:call\s+of\s+duty|black\s+ops)\b/i.test(`${subject} ${text}`)) {
    return `${fullSubject} adds maps, Endgame and Zombies in its ${date ? `${date} ` : ""}update. The real test is whether progression and weapon prestige give lapsed players a reason to reinstall.`;
  }
  if (/\b(?:zombies?|endgame|prestige|progression)\b/i.test(text)) {
    return `${shortSubject}'s ${date ? `${date} ` : ""}update has more than a content checklist. The useful test is whether the new progression loop gives lapsed players a reason to reinstall.`;
  }
  return `${shortSubject}'s ${date ? `${date} ` : ""}update needs to win more than patch-note attention. The useful test is whether maps, modes or rewards change what players do next.`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSubjectPrefix(value = "", subject = "") {
  let text = cleanText(value).replace(/[.!?]+$/g, "");
  const subjectText = cleanText(subject);
  if (subjectText) {
    text = text.replace(new RegExp(`^${escapeRegExp(subjectText)}(?:['’]s)?\\s*[:,-]?\\s*`, "i"), "");
  }
  return cleanText(text);
}

const LOWERCASE_FRAGMENT_START_RE =
  /^(?:a|an|the|this|that|these|those|while|when|where|why|how|what|who|everything|another|new|fresh|major|huge|big|small|just|only|still|finally|now|is|are|was|were|has|have|had|will|can|could|should|needs?|gets?|got|scores?|lands?|launches?|returns?|adds?|brings?|turns?|moves?|puts?|takes?|goes?|looks?|chasing|testing|trying|aiming|asking|putting|turning|moving|bringing|taking|going|making)\b/i;

function sentenceCaseFragment(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  if (!LOWERCASE_FRAGMENT_START_RE.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function concretePriceOrAccessSignal(value = "") {
  const text = cleanText(value);
  return /\b(?:\$|£|€|\d+\s*%\s*off|\d+\s*percent\s*off|price\s+(?:cut|drop|increase|rise|reduction|hike)|costs?\s+\d|drops?\s+to\s+(?:\$|£|€)?\d|sale|discount|deal|save\s+\d|pre[- ]?order|preorder|reservation|reserved|subscription|game\s+pass|ps\s+plus|ea\s+play|free[- ]access|free\s+weekend|free\s+trial)\b/i.test(
    text,
  );
}

function scheduledBetaAccessSignal(value = "") {
  const text = cleanText(value);
  return (
    /\bbeta\b/i.test(text) &&
    /\bearly[- ]access\b/i.test(text) &&
    /\b(?:open beta|free open beta|open to all|all players|all platforms|two entry points|two access windows|weekend one|weekend two|later one|free test|free window)\b/i.test(text)
  );
}

function freeUpgradeOwnerSignal(value = "") {
  const text = cleanText(value);
  return (
    /\b(?:free|claim|no extra cost|without paying|suddenly free)\b/i.test(text) &&
    /\b(?:upgrade|current[-\s]?gen|ps5|xbox series|series x|series s)\b/i.test(text) &&
    /\b(?:owners?|digital|last[-\s]?gen|ps4|xbox one|eligible|claim)\b/i.test(text)
  );
}

function sourceDeniesGameplayRepresentation(value = "") {
  const text = cleanText(value);
  return /\b(?:screenshots?|stills?|images?)\b[\s\S]{0,120}\b(?:probably|likely|may|might|do(?:es)?\s+not|don'?t|not)\b[\s\S]{0,80}\b(?:represent|show|depict|be|count\s+as)\b[\s\S]{0,40}\bgameplay\b/i.test(text) ||
    /\b(?:probably|likely|may|might|do(?:es)?\s+not|don'?t|not)\b[\s\S]{0,80}\b(?:represent|show|depict|be|count\s+as)\b[\s\S]{0,40}\bgameplay\b/i.test(text) ||
    /\bnot\s+(?:actual\s+)?gameplay\b/i.test(text);
}

function gameplayRevealEvidence(value = "") {
  const text = cleanText(value);
  if (!text || sourceDeniesGameplayRepresentation(text)) return false;
  return /\b(?:gameplay\s+(?:trailer|reveal|footage|showcase|demo|preview)|real\s+gameplay|hands[-\s]?on\s+(?:demo|preview|gameplay)|playable\s+(?:demo|build|preview)|combat\s+(?:preview|gameplay|showcase)|footage\s+(?:shows|reveals|demonstrates)\b[\s\S]{0,60}\b(?:combat|gameplay|play))\b/i.test(text);
}

function usefulPublicAngle(value = "") {
  const text = cleanText(value).replace(/[.!?]+$/g, "");
  if (
    !text ||
    /\b[a-z0-9]+(?:_[a-z0-9]+)+\b/i.test(text) ||
    INTERNAL_ANGLE_RE.test(text) ||
    LABEL_ANGLE_RE.test(text) ||
    ARTICLE_BOILERPLATE_RE.test(text)
  ) return "";
  return text;
}

function publicAngleFor({ story = {}, canonical = {}, subject = "", title = "", firstLine = "" } = {}) {
  const explicitAngle = storyAngle(story, canonical);
  if (usefulPublicAngle(explicitAngle)) return explicitAngle;

  const candidates = [
    canonical.description,
    firstLine,
    title,
    canonical.confirmed_claims?.[0],
    story.claim,
  ];
  for (const candidate of candidates) {
    let fragment = stripSubjectPrefix(candidate, subject)
      .replace(/\bsource:\s*.+$/i, "")
      .replace(/\bsources and related links\b.*$/i, "")
      .trim();
    if (!usefulPublicAngle(fragment)) continue;
    const words = fragment.split(/\s+/).filter(Boolean);
    if (words.length >= 4 && words.length <= 18) return sentenceCaseFragment(fragment);
  }

  return "the update changes what players should check next";
}

function angleStartsWithPredicate(value = "") {
  return /^(?:is|are|has|have|had|will|can|could|should|needs?|gets?|got|scores?|lands?|launches?|returns?|adds?|brings?|turns?|moves?|puts?|takes?|goes?)\b/i.test(
    cleanText(value),
  );
}

function angleStartsWithGerund(value = "") {
  return /^(?:chasing|testing|trying|aiming|asking|putting|turning|moving|bringing|taking|going|making)\b/i.test(
    cleanText(value),
  );
}

function subjectClaimFromAngle(subject = "", angle = "") {
  const cleanSubject = cleanText(subject);
  const fragment = cleanText(angle).replace(/[.!?]+$/g, "");
  if (!cleanSubject) return fragment || "Players have a new detail to check";
  if (!fragment) return `${cleanSubject} has a new player-facing detail to check`;
  const subjectKey = normaliseSignatureText(cleanSubject);
  const fragmentKey = normaliseSignatureText(fragment);
  if (subjectKey && fragmentKey.includes(subjectKey)) {
    return fragment.charAt(0).toUpperCase() + fragment.slice(1);
  }
  if (angleStartsWithPredicate(fragment)) return `${cleanSubject} ${fragment}`;
  if (angleStartsWithGerund(fragment)) return `${cleanSubject} is ${fragment}`;
  return `${cleanSubject} ${fragment}`;
}

function reasonClauseFromAngle(angle = "") {
  const fragment = cleanText(angle).replace(/[.!?]+$/g, "");
  if (!fragment) return "there is a new player-facing detail to check";
  if (angleStartsWithPredicate(fragment)) return `it ${fragment}`;
  if (angleStartsWithGerund(fragment)) return `it is ${fragment}`;
  return fragment;
}

function stripSourceAdmin(value = "") {
  return cleanText(value)
    .replace(/\b(?:confirmed drop|source-backed update)\b\.?/gi, "")
    .replace(/\bsource:\s*[^.]+\.?/gi, "")
    .replace(/\bsources and related links:\s*\S+\.?/gi, "")
    .replace(/\bfull source list is on the story page\.?/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function stripArticleBoilerplate(value = "") {
  let text = cleanText(value)
    .replace(/\[?&#\d+;\]?/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ");
  const postMatch = text.match(/\bthe post\s+(.+?)\s+appeared first on\b/i);
  if (postMatch?.[1]) text = postMatch[1];
  return cleanText(text
    .replace(/\bappeared first on\s+[^.]+\.?/gi, "")
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\badvertisement\b.*$/i, "")
    .replace(/\bread our\b.*$/i, "")
    .replace(/\bread more\b.*$/i, "")
    .replace(/\bsee on steam\b.*$/i, "")
    .replace(/\bsee at amazon\b.*$/i, ""));
}

function sentenceCount(value = "") {
  return cleanText(value).split(/(?<=[.!?])\s+/).filter(Boolean).length;
}

function sourceSafeSocialBodyTooPlain(value = "") {
  const rightsNotice = splitMicrosoftGameContentNotice(value);
  const publicBody = rightsNotice.editorialText;
  const text = stripArticleBoilerplate(stripSourceAdmin(publicBody));
  if (!text) return true;
  if (ARTICLE_BOILERPLATE_RE.test(publicBody)) return true;
  if (wordCount(text) > 45) return true;
  if (wordCount(text) < 18) return true;
  if (
    sentenceCount(text) <= 1 &&
    /\b(?:requirements?|lists?|announces?|reveals?|gets?|got|coming|reports?|reported|confirms?|confirmed|scores?)\b/i.test(text)
  ) {
    return true;
  }
  return false;
}

function socialClaimFromAttentionDescription(attentionDescription = "", fallback = "") {
  const fallbackClaim = cleanText(fallback).replace(/[.!?]+$/g, "");
  const body = stripArticleBoilerplate(attentionDescription)
    .replace(/\bSource:\s*[^.]+\.?$/i, "")
    .split(/(?<=[.!?])\s+/)
    .slice(0, 2)
    .join(" ")
    .replace(/[.!?]+$/g, "");
  if (
    body &&
    wordCount(body) >= 12 &&
    wordCount(body) <= 42 &&
    !INTERNAL_ANGLE_RE.test(body) &&
    !LABEL_ANGLE_RE.test(body) &&
    !sourceSafeSocialBodyTooPlain(body)
  ) {
    return body;
  }
  return fallbackClaim || "Players have a new detail to check";
}

function attentionBodyFromEvidence({ subject = "", angle = "", title = "", description = "", firstLine = "" } = {}) {
  const cleanAngle = stripArticleBoilerplate(angle).replace(/[.!?]+$/g, "");
  const cleanTitle = stripArticleBoilerplate(title).replace(/[.!?]+$/g, "");
  const cleanDescription = stripArticleBoilerplate(description).replace(/[.!?]+$/g, "");
  const evidenceText = cleanText([cleanTitle, cleanAngle, cleanDescription, firstLine].join(" "));
  if (
    /\bdenshattack\b/i.test(`${subject} ${evidenceText}`) &&
    /\b(?:train|carriage)\b/i.test(evidenceText) &&
    /\b(?:kickflips?|flip|trick|grind|stunt)\b/i.test(evidenceText)
  ) {
    return "Denshattack turns a full-size train into a stunt machine on July 15. The trailer sells the joke instantly, but the controls decide whether Game Pass players get a one-more-run obsession or a gimmick that derails after one clip.";
  }
  if (
    /\bblack\s+flag\s+resynced\b/i.test(`${subject} ${evidenceText}`) &&
    /\$84[.]91\b/.test(evidenceText) &&
    /\$59[.]99\b/.test(evidenceText) &&
    /\bnine\s+day[- ]one\s+dlc\s+packs?\b/i.test(evidenceText)
  ) {
    return "Black Flag Resynced puts players in an $84.91 DLC fight. Nine day-one packs cost more than the $59.99 base game, so the launch now depends on whether the standard edition still feels complete.";
  }
  const gb = evidenceText.match(/\b(\d{2,4})\s*GB\b/i);
  if (gb) {
    return `${subject} is asking players for ${gb[1]} GB before the campaign even starts. That turns storage into part of the launch pitch.`;
  }
  if (/\bpalworld\s*1[.]0\b/i.test(`${subject} ${evidenceText}`)) {
    return "Palworld 1.0 turns its early-access success into a finished-game test. Players now get to judge whether its world, progression and endgame can keep the phenomenon growing after the novelty wears off.";
  }
  if (
    /\bdigimon\s+story\s+time\s+stranger\b/i.test(`${subject} ${evidenceText}`) &&
    /\b(?:performance|quality|mode|modes|switch\s*2)\b/i.test(evidenceText)
  ) {
    return "Digimon Story Time Stranger makes Switch 2 players choose between smoother battles and a sharper Digital World. That choice decides whether portable play becomes the best version or exposes the port's compromises.";
  }
  if (
    /\b(?:demo|demos|next fest)\b/i.test(evidenceText) ||
    /\bplayable\s+(?:demo|build|slice|preview)\b/i.test(evidenceText)
  ) {
    return `${subject} has one proof point players can judge immediately: the demo. It can win wishlists fast or expose the problem before launch.`;
  }
  if (diddyKartComparisonSignal(evidenceText)) {
    return `${subject} is chasing one dangerous Diddy Kong Racing comparison, so players need to decide whether to wishlist it now or wait until the handling proves nostalgia is not doing the work.`;
  }
  if (/\b(?:gta\s*(?:vi|6)|grand\s+theft\s+auto\s*(?:vi|6))\b/i.test(`${subject} ${evidenceText}`) && /\bps5\b/i.test(evidenceText) && /\b(?:plays?\s+best|november\s+19|default\s+version|version\s+to\s+watch)\b/i.test(evidenceText)) {
    return `${subject} has a default PS5 version argument now. PlayStation's plays-best pitch gives Xbox and PC players a reason to wait for footage, not just a release date.`;
  }
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(subject) && /\b(?:podracing|roguelite)\b/i.test(evidenceText)) {
    return `${subject} turns Star Wars racing into a roguelite risk: repeat runs, wipeout pressure and handling that has to make failure feel worth another lap. Players can wishlist now or wait for one uncut race before trusting the pitch.`;
  }
  if (/\b(?:fatal\s+fury|city\s+of\s+the\s+wolves)\b/i.test(`${subject} ${evidenceText}`) && /\bkenshiro\b/i.test(evidenceText)) {
    return `${subject} just turned a crossover into a real roster argument. Players will judge whether Kenshiro feels like a proper moveset, not a guest-star poster built only for trailer reactions.`;
  }
  if (/\binvincible\s+vs\b/i.test(`${subject} ${evidenceText}`) && /\b(?:roster|universa|immortal|matchups?|meta|tag fighters?)\b/i.test(evidenceText)) {
    return `${subject} is not just adding names to a roster. Universa and The Immortal have to make tag-fighter matchups feel sharper, so players can wishlist now or wait for readable fights.`;
  }
  if (/\b(?:marvel\s+t[^\s]*kon|fighting\s+souls)\b/i.test(`${subject} ${evidenceText}`) && /\b(?:blade|loki|deadpool|roster|assists?|screen control|matchups?|team[-\s]?building|tag fighters?)\b/i.test(evidenceText)) {
    if (/\b(?:blade|loki|deadpool)\b/i.test(evidenceText)) {
      return `${subject} is turning Blade, Loki and Deadpool into a team-building test. Players need to see assists, screen control and matchups prove this is a real meta fight, not just famous names.`;
    }
    return `${subject} is turning its four-versus-four roster into a readability test. Assists, swaps and screen control need to stay clear enough for players to follow the meta fight.`;
  }
  if (/\bmonopoly\b/i.test(`${subject} ${evidenceText}`) && /\bstar\s+wars\b/i.test(`${subject} ${evidenceText}`) && /\b(?:ability|abilities|force|powers?|heroes|villains|family|game night|replay)\b/i.test(evidenceText)) {
    return `${subject} is not just a reskin. Force powers decide whether game night becomes replayable chaos, or one bored match everyone packs away.`;
  }
  if (scheduledBetaAccessSignal(evidenceText)) {
    if (/\b(?:nintendo\s+)?switch\s*2\b/i.test(evidenceText)) {
      return `${subject} splits its beta into an early-access window and a later free open beta. Switch 2 joins the all-platform window, so players can skip pre-order pressure and still test the game.`;
    }
    return `${subject} splits its beta into an early-access window and a later free open beta, giving players a clear choice between pre-order access and the no-cost test.`;
  }
  if (/\b(?:paid early access|early[- ]access|steam demand|steam peak|steam spike|concurrent steam players?|premium week)\b/i.test(evidenceText)) {
    return `${subject} turned paid early access into a Steam demand test. The spike proves attention, but the real story is whether the cheaper launch wave holds.`;
  }
  if (/\b(?:cyberpunk\s*2077|cd\s*projekt|cdpr)\b/i.test(evidenceText) && /\b(?:faith|trust|burned|disastrous launch|recovery arc)\b/i.test(evidenceText)) {
    return `${subject} turned CDPR's next reveal into a launch trust problem. Players remember the original launch, so the next trailer needs gameplay proof before hype.`;
  }
  if (/\b(?:ea play|game pass|ps plus|subscription)\b/i.test(evidenceText)) {
    return `${subject} just moved into a subscription, which changes the pitch from full-price risk to worth trying tonight.`;
  }
  if (/\b(?:free play days|free access|free weekend|try for free|free trial)\b/i.test(evidenceText)) {
    return `${subject} has a free-access risk tonight. Free only helps if players can tell fast whether one of these games is worth keeping installed.`;
  }
  if (/\bdoom\b/i.test(`${subject} ${evidenceText}`) && /\bchain\s+spear\b/i.test(evidenceText)) {
    return `${subject} is turning Chain Spear movement into the player risk: faster fights, cleaner arenas and no unreadable effects spam.`;
  }
  if (/\brobo[-\s]?ky\b/i.test(`${subject} ${evidenceText}`) && /\bguilty gear\b/i.test(evidenceText)) {
    return `${subject} is now a timing and balance argument for Guilty Gear Strive players. The delay only works if Robo-Ky arrives readable, lab-worthy and weird enough to justify moving out of the crowded release window.`;
  }
  if (
    /\bPSSR\b/i.test(evidenceText) &&
    /\b(?:PS5|PlayStation\s*5)\s+Pro\b/i.test(evidenceText)
  ) {
    return `${subject} just made its PS5 Pro upgrade measurable. Upgraded PSSR targets sharper 4K detail, steadier motion and more consistent frame rates, so players can judge it during combat rather than from paused screenshots.`;
  }
  const updateBody = specificUpdateAttentionBody({ subject, evidenceText });
  if (updateBody) return updateBody;
  if (freeUpgradeOwnerSignal(evidenceText)) {
    return `${subject} just turned a paid current-gen upgrade into a free claim for eligible PS4 and Xbox One owners. That matters because players should check ownership before the next online update lands.`;
  }
  if (/\b(?:custom seas|private sessions?|private seas|set (?:their own )?rules|rule controls?)\b/i.test(evidenceText)) {
    return `${subject} is adding Custom Seas, a private mode where players can set their own rules. That helps events and training, but it could drain the public seas that make the game dangerous.`;
  }
  if (/\bsafer seas\b/i.test(evidenceText)) {
    return `${subject} is testing safer seas as the entry-point tradeoff. It could make the game easier to try, but the risk is splitting what players expect from danger.`;
  }
  if (/\bjump[- ]?scares?\b/i.test(evidenceText)) {
    return `${subject} is selling horror without leaning on jump scares. Players have to judge whether the choices feel personal, because atmosphere matters more than monsters here.`;
  }
  if (/\bage\s+of\s+empires\s+mobile\b/i.test(`${subject} ${evidenceText}`) && /\bpc\s+edition\b/i.test(evidenceText)) {
    return `${subject} turns PC Edition into the real test. Mouse and keyboard players will judge whether it feels like strategy on PC, or a mobile economy stretched onto a bigger screen.`;
  }
  if (/\b(?:pc releases?|pc launch|pc edition|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidenceText)) {
    return `${subject} has a PC port trust problem now. The document does not kill every port, but it changes what players should expect at launch.`;
  }
  const waitYear = evidenceText.match(/\b(20\d{2})\b/);
  if (/\b(?:wait until next year|reservation|reserved|queue|orders?|fulfilled|delivery window)\b/i.test(evidenceText)) {
    return `${subject} has a ${waitYear?.[1] || "new"} wait-list problem. Demand is the headline, but the real question is whether players still care by delivery day.`;
  }
  if (/\b(?:hollywood|movie|film|elden ring|a24)\b/i.test(evidenceText)) {
    return `${subject} has a Hollywood trust problem now. The story only matters if game fans can see why that studio legacy changes what reaches the screen.`;
  }
  if (/\b(?:retro|throwback|old-school)\b/i.test(evidenceText)) {
    return `${subject} has a retro trust problem to solve. The style grabs attention, but players will judge whether combat, exploration and discovery still feel modern.`;
  }
  if (
    /\b(?:diana|hugh)\b/i.test(evidenceText) ||
    (
      /\b(?:android|child-like|companion)\b/i.test(evidenceText) &&
      /\b(?:behind[- ]the[- ]scenes|development team|character design)\b/i.test(evidenceText)
    )
  ) {
    return `${subject} has a character trust problem now. The behind-the-scenes detail only matters if it makes players care about the story on screen.`;
  }
  if (/\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) {
    return `${subject} is getting a real player test on PS5. The risk is whether the loop still works once console players judge it fast.`;
  }
  if (/\b(?:ps\s*plus|playstation\s+plus)\b/i.test(`${subject} ${evidenceText}`) && /\b(?:leaving|library|july|catalog(?:ue)?)\b/i.test(evidenceText)) {
    return `${subject} has a backlog deadline now. The useful part is not another library update; it is which games players should finish, download or drop before access disappears.`;
  }
  if (/\b(?:free\s+)?battle pass\b/i.test(evidenceText)) {
    return `${subject} is using a free battle pass as a comeback test. That matters because lapsed players get a low-friction reason to reinstall, but only if the update adds enough fights to make the return stick.`;
  }
  if (/\b(?:expansion|dlc|update|season|battle pass)\b/i.test(evidenceText)) {
    return `${subject} is asking players to reinstall, not just notice an update. The useful test is whether the new content changes the first hour enough to make coming back feel urgent.`;
  }
  if (/\b(?:delay|delayed|moved|avoids?|crowded)\b/i.test(evidenceText)) {
    return `${subject} just moved because the release calendar is getting crowded. That makes the timing as important as the game itself.`;
  }
  if (/\b(?:score|metacritic|review)\b/i.test(evidenceText)) {
    return `${subject} has a review momentum test now. The score gets attention, but the real question is whether players turn that number into hype.`;
  }
  if (/\b(?:deal|discount|sale|price|subscription|game pass|ps plus)\b/i.test(evidenceText)) {
    return `${subject} is not just another deal post. The price only matters if the timing makes it worth acting on.`;
  }
  const fallback = stripSubjectPrefix(
    cleanAngle || cleanTitle || cleanDescription || "what this changes for players next",
    subject,
  ).replace(/[.!?]+$/g, "");
  if (
    !fallback ||
    INTERNAL_ANGLE_RE.test(fallback) ||
    normaliseSignatureText(fallback) === normaliseSignatureText(subject) ||
    normaliseSignatureText(fallback) === normaliseSignatureText(cleanTitle)
  ) {
    return `${subject} needs one concrete player-facing detail before the hype makes sense. The next proof has to be footage, timing, price, platform access or a feature people can judge.`;
  }
  if (/^(?:is|are|has|have|needs?|gets?|got|just|will|can|could|should|makes?|turns?|moves?|takes?)\b/i.test(fallback)) {
    return `${subject} ${sentenceCaseFragment(fallback)}.`;
  }
  return `${subject}: ${sentenceCaseFragment(fallback)}.`;
}

function platformConsequenceLanguage(value = "") {
  return /\b(?:problem|risk|catch|warning|changed|turns?|makes?|matters?|threat|ends?|ended|best|worst|worse|permanent(?:ly)?|broke|broken|revealed|confirmed|finally|pushback|why|before|after|ceiling|impact|cost|deal|launch|lands?|hits?|date|proof|payoff|trust|pressure|fight|split|splits|splitting|misses|skips|bloat|dangerous|delete|wins?|timing|trial|argument|balance|balanced|polish|half[- ]finished|more than|handmade|leaked?|tactics?|xcom|exposes?|spike|peak|demand|bet|comeback|second wave|custom seas|private seas|private sessions?|private mode|rule controls?|ea\s+play|game pass|ps5|jungle|combat|discovery|readability|readable|lab[- ]worthy|roster|meta|matchups?|team building|screen control|map|choices?|empathy|atmosphere|horror|jump[- ]?scares?|ruins?|replayable|chaos|game night|family night|force powers?)\b/i.test(
    cleanText(value),
  );
}

function platformAudiencePullLanguage(value = "") {
  const text = cleanText(value);
  if (!text) return false;
  const hasConsequenceShift =
    /\bchanges?\s+the\s+(?:story|game|equation|argument|picture|stakes?)\b/i.test(text);
  const hasSpecificity =
    /\b(?:\d+|[0-9]+ ?(?:gb|fps|k|million|billion|hours?)|one|only|first|last|best|worst|your|free|paid|delay(?:ed)?|release calendar|release window|leak(?:ed)?|launch|ending|before|after|price|trial|demo|early[- ]access|steam peak|steam spike|steam demand|comeback|game pass|subscription|custom seas|private seas|private sessions?|private mode|rule controls?|set (?:their own )?rules|ea\s+play|ps5|jungle|combat|discovery|readability|readable|lab[- ]worthy|balanced|polish|roster|meta|matchups?|team building|screen control|map|choices?|empathy|atmosphere|horror|jump[- ]?scares?|roguelite|podracing|repeat[- ]run|wipeout|handling|force powers?|heroes?|villains?|board game|family night|game night|replayable|licensed board)\b/i.test(text) ||
    /\b(?:better|worse|more|less)\s+than\b/i.test(text) ||
    /\bturns?\b.{1,50}\binto\b/i.test(text);
  const hasCuriosity =
    /\b(?:why|how|what|secret|hidden|hides?|real|catch|risk|problem|fight|trial|argument|pressure|warning|trust|threat|ceiling|broke|ends?|ended|best|worst|worse|turns?|makes?|changed|into|test|timing|balance|polish|more than|handmade|xcom|tactics?|exposes?|spike|peak|demand|bet|comeback|second wave)\b/i.test(text);
  return (
    (platformConsequenceLanguage(text) || hasConsequenceShift) &&
    (hasSpecificity || hasCuriosity || hasConsequenceShift)
  );
}

function weakPlatformTitle(value = "", subject = "") {
  const title = cleanText(value);
  if (!title) return true;
  if (/^(?:if you haven'?t|this game|this story|gaming news update|source-backed update)\b/i.test(title)) return true;
  if (/^why\s+.+\s+could\s+split\s+players\b/i.test(title) && !PLATFORM_HARD_DETAIL_RE.test(title)) return true;
  if (/\bjust\s+changed\s+the\s+watchlist\b/i.test(title)) return true;
  if (/\bjust\s+changed\s+(?:its|the|a)?\s*[\w\s-]{0,40}\bsignal\b/i.test(title)) return true;
  if (/\bhas (?:a|an|one|the) [a-z0-9' -]{0,44}(?:player trust test|trust test|risk|problem|test)\b/i.test(title) && !PLATFORM_HARD_DETAIL_RE.test(title)) {
    return true;
  }
  if (/\b(?:scores?\s+\d+\s+on|everything we know|gets?\s+(?:a\s+)?(?:new|huge|big)\s+(?:update|trailer|date|score)|new trailer|review score|announced for)\b/i.test(title)) {
    return true;
  }
  if (cleanText(subject) && normaliseSignatureText(title) === normaliseSignatureText(subject)) return true;
  return !platformAudiencePullLanguage(title);
}

function attentionPlatformTitle({ subject = "", title = "", angle = "", description = "", firstLine = "" } = {}) {
  const evidenceText = cleanText([title, angle, description, firstLine].join(" "));
  const sourceEvidenceText = cleanText([angle, description, firstLine].join(" "));
  const subjectEvidenceText = cleanText([subject, evidenceText].join(" "));
  if (scheduledBetaAccessSignal(evidenceText)) {
    if (/\b(?:nintendo\s+)?switch\s*2\b/i.test(evidenceText)) {
      return `Switch 2 Misses ${subject}'s Early-Access Beta`;
    }
    return `${subject} Splits Its Beta Into Two Access Windows`;
  }
  if (
    /\bdenshattack\b/i.test(subjectEvidenceText) &&
    /\b(?:train|carriage)\b/i.test(evidenceText) &&
    /\b(?:kickflips?|flip|trick|grind|stunt)\b/i.test(evidenceText)
  ) {
    return "Why Denshattack's Train Kickflips Could Actually Work";
  }
  if (/\balbion\s+online\b/i.test(subjectEvidenceText) && /\bkeepers?\b/i.test(evidenceText)) {
    return "Albion Online's Keeper Uprising Hides A Permanent Change";
  }
  if (/\b(?:marvel\s+t[^\s]*kon|fighting\s+souls)\b/i.test(subjectEvidenceText) && /\b(?:blade|loki|deadpool|roster|characters?|assists?|screen control|matchups?|team[-\s]?building|tag fighters?)\b/i.test(evidenceText)) {
    return "MARVEL Tokon Turns Its Roster Into A Meta Fight";
  }
  if (
    /\bhas\s+(?:a|an)\s+(?:stage\s+clarity|studio\s+risk|closure\s+risk|showcase\s+watchlist|extraction\s+map|ghosting|kenshiro\s+roster|cartridge\s+test)\b/i.test(title) ||
    /\b(?:screen\s+rumou?r\s+has\s+a\s+ghosting\s+test|kenshiro\s+roster\s+(?:test|fight)|cartridge\s+test)\b/i.test(title)
  ) {
    return cleanText(title);
  }
  if (roboKyGuiltyGearSignal(subjectEvidenceText)) {
    return "Robo-Ky Delay Puts Guilty Gear On Trial";
  }
  if (/\bnintendo\s+direct\b/i.test(subjectEvidenceText) && /\b(?:watch|broadcast|showcase|switch\s*2|splatoon\s+raiders)\b/i.test(evidenceText)) {
    return `${subject} Has A Showcase Watchlist`;
  }
  if (/\b(?:layoffs?|cuts?|closure|studio\s+risk|risk)\b/i.test(evidenceText) && /\b(?:studio|developer|team|labs|undead)\b/i.test(subjectEvidenceText)) {
    if (/\b(?:state\s+of\s+decay|undead\s+labs)\b/i.test(subjectEvidenceText)) {
      return "State Of Decay Studio Has A Closure Risk";
    }
    return `${subject} Has A Studio Risk`;
  }
  if (/\b(?:switch\s*2|nintendo\s+switch\s*2)\b/i.test(subjectEvidenceText) && /\b(?:screen|ghosting|lcd|oled)\b/i.test(evidenceText)) {
    return "Switch 2 Screen Rumour Has A Ghosting Test";
  }
  if (/\b(?:elder\s+scrolls\s+iv|oblivion)\b/i.test(subjectEvidenceText) && /\b(?:physical|cartridge|pre[-\s]?order|preorders?)\b/i.test(evidenceText)) {
    return "Oblivion Switch 2 Has A Cartridge Test";
  }
  if (/\bthe\s+crew\s+motorfest\b/i.test(subjectEvidenceText) && /\b(?:grand tour|one[- ]hour|ferrari\s+250\s+gto)\b/i.test(evidenceText)) {
    return cleanText(title) && !weakPlatformTitle(title, subject)
      ? cleanText(title)
      : "The Crew Motorfest Grand Tour Has A Filler Problem";
  }
  if (/\bdelta\s+force\b/i.test(subjectEvidenceText) && /\b(?:extraction|map|ambitious)\b/i.test(evidenceText)) {
    return "Delta Force Has An Extraction Map Test";
  }
  if (/\b(?:fatal\s+fury|city\s+of\s+the\s+wolves)\b/i.test(subjectEvidenceText) && /\bkenshiro\b/i.test(evidenceText)) {
    return "Fatal Fury Has A Kenshiro Roster Test";
  }
  if (/\b(?:marvel\s+t[ōo]kon|fighting\s+souls)\b/i.test(subjectEvidenceText) && /\b(?:blade|loki|deadpool|roster|characters?)\b/i.test(evidenceText)) {
    return "MARVEL Tokon Turns Its Roster Into A Meta Fight";
  }
  if (
    /\b(?:assassin'?s\s+creed\s+)?black\s+flag\s+resynced\b/i.test(subjectEvidenceText) &&
    /\b(?:microtransactions?|steam\s+reviews?|full,?\s+complete\s+experience|standard\s+edition)\b/i.test(evidenceText)
  ) {
    return "Why Black Flag Resynced's Microtransactions Are Dividing Players";
  }
  if (/\b(?:assassin'?s\s+creed\s+)?black\s+flag\s+resynced\b/i.test(subjectEvidenceText) && /\bps5\s+pro\b/i.test(evidenceText)) {
    return "Black Flag Resynced Has A PS5 Pro Proof Problem";
  }
  if (/\bmonopoly\b/i.test(subjectEvidenceText) && /\bstar\s+wars\b/i.test(evidenceText) && /\b(?:ability|abilities|heroes|villains|force|powers|family\s+drama)\b/i.test(evidenceText)) {
    return "Star Wars Monopoly Could Ruin Game Night";
  }
  if (/\b(?:stage|spirit\s+wilds|arena|map)\b/i.test(evidenceText) && /\b(?:fighting\s+game|fighter|visual\s+clarity|spacing)\b/i.test(evidenceText)) {
    return `${subject} Has A Stage Clarity Test`;
  }
  if (/\b(?:gta\s*(?:vi|6)|grand\s+theft\s+auto\s*(?:vi|6))\b/i.test(subjectEvidenceText) && sourceDeniesGameplayRepresentation(evidenceText)) {
    return "GTA VI Screenshots Are Not Gameplay Proof";
  }
  if (/\bstar\s+fox\b/i.test(subjectEvidenceText) && /\bswitch\s*2\b/i.test(subjectEvidenceText) && /\b(?:visual showcase|review|arcade|fox\s+mccloud)\b/i.test(subjectEvidenceText) && !concretePriceOrAccessSignal(evidenceText)) {
    return "Star Fox Is Switch 2's Visual Test";
  }
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(subjectEvidenceText) && /\b(?:podracing|roguelite)\b/i.test(subjectEvidenceText)) {
    return "Star Wars Podracing Has A Roguelite Risk";
  }
  if (/\bai\s+stigma\b/i.test(subjectEvidenceText) && /\bsteam\b/i.test(subjectEvidenceText) && /\breviews?\b/i.test(subjectEvidenceText)) {
    return "Steam's AI Label Has A Review Problem";
  }
  if (
    /\bnte\s*:?\s*neverness\s+to\s+everness\b/i.test(subjectEvidenceText) &&
    /\b(?:steam|store|live|launch|available|out\s+now|open[-\s]?world|city)\b/i.test(evidenceText)
  ) {
    return "NTE: Neverness to Everness Has A Live City Test";
  }
  if (/\b(?:gta\s*(?:vi|6)|grand\s+theft\s+auto\s*(?:vi|6))\b/i.test(evidenceText) && /\bdemos?\b/i.test(evidenceText)) {
    return "GTA 6 Demo Is The Real Proof";
  }
  if (/\bxbox\b/i.test(subjectEvidenceText) && /\b(?:exclusive\s+label|exclusivity|console\s+dashboard|dashboard\s+badge)\b/i.test(evidenceText)) {
    return "Xbox's New Exclusive Label Has One Problem";
  }
  if (/\b(?:black\s+ops|call\s+of\s+duty)\b/i.test(subjectEvidenceText) && /\b(?:playstation\s+listings?|ports?|price|nostalgia|classic\s+black\s+ops)\b/i.test(evidenceText)) {
    return "Black Ops Classics Have A Price Problem";
  }
  if (/\bsuper\s+mario\s*64\b/i.test(subjectEvidenceText) && /\b(?:35mm|film\s+slides?|collectibles?)\b/i.test(evidenceText)) {
    return "Super Mario 64 Film Slides Are A Collector Test";
  }
  if (/\bmario\s+kart\s*64\b/i.test(subjectEvidenceText) && /\b(?:transformed|blueprint|series|retrospective)\b/i.test(evidenceText)) {
    return "Mario Kart 64 Made The Blueprint";
  }
  if (/\b(?:custom seas|private sessions?|private seas|set (?:their own )?rules|rule controls?)\b/i.test(evidenceText)) {
    return `${subject} Custom Seas Could Split Crews`;
  }
  if (/\b(?:gameplay\s+reveal|fresh\s+gameplay|combat\s+footage|new\s+gameplay\s+footage)\b/i.test(evidenceText)) {
    return `${subject} Finally Shows Real Gameplay`;
  }
  if (/\b(?:pit\s+of\s+goblin|enter\s+the\s+pit)\b/i.test(subjectEvidenceText)) {
    return "Enter The Pit Lets Xbox Test Pit Of Goblin";
  }
  if (/\bmicrosoft\s+flight\s+simulator\b/i.test(subjectEvidenceText) && /\b(?:world\s+update\s*22|national\s+parks|united\s+states|reinstall)\b/i.test(evidenceText)) {
    return "Flight Simulator Turns Parks Into A Reinstall Test";
  }
  if (/\bea\s+sports\s+college\s+football\s*27\b/i.test(subjectEvidenceText) && /\bea\s+play\b/i.test(evidenceText)) {
    return "College Football 27 Has An EA Play Trial Test";
  }
  if (/\b(?:bethesda\s+game\s+studios|zenimax)\b/i.test(subjectEvidenceText) && /\b(?:layoffs?|union|hit\s+hard|xbox\s+layoffs?|rpg\s+promises|pipeline)\b/i.test(evidenceText)) {
    return "Bethesda Layoffs Put Xbox RPG Trust Under Pressure";
  }
  if (!weakPlatformTitle(title, subject)) return cleanText(title);
  const gb = evidenceText.match(/\b(\d{2,4})\s*GB\b/i);
  if (gb) return `${subject} Has A ${gb[1]}GB Problem`;
  if (/\b(?:ea play|game pass|ps plus|subscription)\b/i.test(evidenceText)) {
    if (/\bea play\b/i.test(evidenceText)) return `${subject} Just Hit EA Play`;
    return `${subject} Has A Low-Risk Trial`;
  }
  if (/\bfree\s+play\s+days\b/i.test(subjectEvidenceText) && /\b(?:weekend\s+trap|house\s+flipper\s*2|blades\s+of\s+fire|assetto\s+corsa\s+competizione)\b/i.test(subjectEvidenceText)) {
    return "Xbox Free Play Days Has A Weekend Trap";
  }
  if (/\b(?:free play days|free access|free weekend|try for free|free trial)\b/i.test(evidenceText)) {
    return `${subject} Has A Free-Access Risk`;
  }
  const updateTitle = specificUpdatePlatformTitle({ subject, evidenceText });
  if (updateTitle) return updateTitle;
  if (freeUpgradeOwnerSignal(evidenceText)) {
    return `${subject} Has A Free Upgrade Catch`;
  }
  if (/\bsafer seas\b/i.test(evidenceText)) {
    return `${subject} Has A Safer Seas Risk`;
  }
  if (/\bjump[- ]?scares?\b/i.test(evidenceText)) {
    return `${subject} Has A Jump-Scare Risk`;
  }
  if (/\bage\s+of\s+empires\s+mobile\b/i.test(subjectEvidenceText) && /\bpc\s+edition\b/i.test(evidenceText)) {
    return "Age of Empires Mobile Has A PC Edition Test";
  }
  if (/\b(?:pc releases?|pc launch|pc edition|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidenceText)) {
    return `${subject} Has A PC Port Trust Problem`;
  }
  const waitYear = evidenceText.match(/\b(20\d{2})\b/);
  if (/\b(?:wait until next year|reservation|reserved|queue|orders?|fulfilled|delivery window)\b/i.test(evidenceText)) {
    return `${subject} Has A ${waitYear?.[1] || "New"} Wait Problem`;
  }
  if (/\b(?:hollywood|movie|film|elden ring|a24)\b/i.test(evidenceText)) {
    return `${subject} Has A Hollywood Trust Problem`;
  }
  if (/\b(?:demo|demos|next fest|playable)\b/i.test(evidenceText)) {
    if (/\bnext fest\b/i.test(evidenceText)) return `${subject} Turns Demos Into A Fight`;
    return `${subject} Demo Is The Real Proof`;
  }
  if (/\b(?:og pass|map changes?|live events?|chapter\s*1|season\s*\d+)\b/i.test(evidenceText)) {
    return `${subject} Has A Map Change Test`;
  }
  if (/\bend\s+of\s+abyss\b/i.test(subject) && /\b(?:combat|readability|enemy|movement|hostile facility|pressure)\b/i.test(evidenceText)) {
    return `${subject} Has A Combat Readability Test`;
  }
  if (/\belliot\b/i.test(subject) && /\b(?:exploration|combat|discovery|retro)\b/i.test(evidenceText)) {
    return `${subject} Has A Combat Discovery Test`;
  }
  if (/\b(?:retro|throwback|old-school|exploration|discovery|square enix)\b/i.test(evidenceText)) {
    return `${subject} Has A Retro Trust Problem`;
  }
  if (/\b(?:more of an mmo|coexist as different experiences|different experiences|mmo than the first game)\b/i.test(evidenceText)) {
    return `${subject} Has An MMO Identity Fight`;
  }
  if (/\b(?:in-game millionaires|exploiting a system|exploiting system|loot hunt|grind for 100 hours|economy)\b/i.test(evidenceText)) {
    return `${subject} Has A Loot Economy Problem`;
  }
  if (/\b(?:genai|ai team\s*mates?|ai teammates?|team mates now|intelligent decision-making|bots for the military)\b/i.test(evidenceText)) {
    return `${subject} Has An AI Teammate Risk`;
  }
  if (/\b(?:diana|android|child-like|companion|hugh|development team)\b/i.test(evidenceText)) {
    return `${subject} Has A Character Trust Problem`;
  }
  if (/\bdune\s*:?\s*awakening\b/i.test(subjectEvidenceText) && /\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) {
    return "Dune Awakening Brings Survival Pressure To PS5";
  }
  if (/\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) {
    return `${subject} Lands On PS5`;
  }
  if (/\bjungle\b/i.test(evidenceText) && /\b(?:dlc|biome|out now|dive|serve|upgrade)\b/i.test(evidenceText)) {
    return `${subject} Just Hit The Jungle`;
  }
  if (
    gameplayRevealEvidence(sourceEvidenceText)
  ) {
    return `${subject} Finally Shows Real Gameplay`;
  }
  if (concretePriceOrAccessSignal(evidenceText) && /\b(?:deal|discount|sale|price|reserved?|reservation|preorder|pre-order)\b/i.test(evidenceText)) {
    return `${subject} Has A Price Timing Risk`;
  }
  if (/\b(?:ps\s*plus|playstation\s+plus)\b/i.test(subjectEvidenceText) && /\b(?:leaving|library|july|catalog(?:ue)?)\b/i.test(evidenceText)) {
    return `${subject} Has A Backlog Deadline`;
  }
  if (/\b(?:free\s+)?battle pass\b/i.test(evidenceText)) {
    return `${subject} Has A Free Battle Pass Test`;
  }
  if (/\b(?:doom|dark ages)\b/i.test(subjectEvidenceText) && /\bchain\s+spear\b/i.test(evidenceText)) {
    return "DOOM The Dark Ages Chain Spear Changes Combat Flow";
  }
  if (/\b(?:expansion|dlc|update|season|battle pass)\b/i.test(evidenceText)) {
    return `${subject} Has A Reinstall Test`;
  }
  if (/\b(?:delay|delayed|moved|avoids?|crowded)\b/i.test(evidenceText)) {
    return `${subject} Just Dodged A Release-Date Fight`;
  }
  if (/\b(?:score|metacritic|review)\b/i.test(evidenceText)) {
    return `${subject} Has A Review Momentum Problem`;
  }
  if (/\b(?:hands[- ]on|preview|played|four\s+hours?|combat|romance|intrigue)\b/i.test(evidenceText)) {
    return `${subject} Has A Hands-On Combat Test`;
  }
  if (/\b(?:trailer|footage|gameplay|demo|reveal)\b/i.test(evidenceText)) {
    return `${subject} Has A Footage Readability Test`;
  }
  if (/\b(?:update|season|dlc|battle pass|out today|live now)\b/i.test(evidenceText)) {
    return `${subject} Has A Return Risk`;
  }
  return `${subject} Has A Source-Proof Risk`;
}

function platformAttentionDescription({ canonical = {}, subject = "", angle = "", sourceLine = "", title = "", firstLine = "" } = {}) {
  const description = stripSourceAdmin(canonical.description || "");
  const narrationEvidence = cleanText(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.display_script ||
      canonical.caption_display_text ||
      "",
  );
  const currentStoryEvidence = cleanText([angle, title, firstLine, narrationEvidence].join(" "));
  const staleDemoTemplate =
    (
      /\bone proof point players can judge immediately\s*:\s*the demo\b/i.test(description) ||
      /\bwin wishlists fast or expose the problem before launch\b/i.test(description)
    ) &&
    !/\b(?:demo|wishlist(?:s|ed|ing)?)\b/i.test(currentStoryEvidence);
  const currentDescription = staleDemoTemplate ? "" : description;
  const evidenceText = cleanText([
    currentDescription,
    angle,
    title,
    firstLine,
    narrationEvidence,
  ].join(" "));
  const forceAttentionBody =
    staleDemoTemplate ||
    (
      /\bdenshattack\b/i.test(`${subject} ${evidenceText}`) &&
      /\b(?:train|carriage)\b/i.test(evidenceText) &&
      /\b(?:kickflips?|flip|trick|grind|stunt)\b/i.test(evidenceText)
    ) ||
    (
      /\bblack\s+flag\s+resynced\b/i.test(`${subject} ${evidenceText}`) &&
      /\$84[.]91\b/.test(evidenceText) &&
      /\$59[.]99\b/.test(evidenceText) &&
      /\bnine\s+day[- ]one\s+dlc\s+packs?\b/i.test(evidenceText)
    ) ||
    (
      /\bPSSR\b/i.test(evidenceText) &&
      /\b(?:PS5|PlayStation\s*5)\s+Pro\b/i.test(evidenceText)
    ) ||
    roboKyGuiltyGearSignal(`${subject} ${evidenceText}`) ||
    (/\b(?:doom|dark ages)\b/i.test(`${subject} ${evidenceText}`) && /\bchain\s+spear\b/i.test(evidenceText)) ||
    (
      /\b(?:fatal\s+fury|city\s+of\s+the\s+wolves)\b/i.test(`${subject} ${evidenceText}`) &&
      /\b(?:kenshiro|fist\s+of\s+the\s+north\s+star)\b/i.test(evidenceText)
    ) ||
      /\b(?:pc releases?|pc launch|multiplatform|business strategy|first-party|fully exclusive|single-player games|custom seas|private seas|private sessions?|private mode|rule controls?|set (?:their own )?rules)\b/i.test(
      evidenceText,
    ) ||
    freeUpgradeOwnerSignal(evidenceText) ||
    (
      /\b(?:cyberpunk\s*2077|cd\s*projekt|cdpr)\b/i.test(evidenceText) &&
      /\b(?:faith|trust|burned|disastrous launch|recovery arc)\b/i.test(evidenceText)
    );
  const body = !forceAttentionBody && usefulPublicAngle(currentDescription) && !sourceSafeSocialBodyTooPlain(currentDescription) && platformAudiencePullLanguage(currentDescription)
    ? currentDescription
    : attentionBodyFromEvidence({
        subject,
        angle,
        title,
        description: cleanText([currentDescription, narrationEvidence].join(" ")),
        firstLine,
      });
  const cleanBody = body.replace(/[.!?]+$/g, "");
  return cleanText(
    /\bsources?\s*:/i.test(cleanBody)
      ? `${cleanBody}.`
      : `${cleanBody}. ${sourceLine}`,
  );
}

function headlineTokens(value = "") {
  return cleanText(value)
    .replace(/[:]/g, " ")
    .replace(/[^a-zA-Z0-9+-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const GENERIC_HEADLINE_SUBJECT_TOKENS = new Set([
  "the",
  "of",
  "a",
  "an",
  "game",
  "games",
  "gaming",
  "steam",
  "xbox",
  "playstation",
  "ps5",
  "nintendo",
  "switch",
  "pc",
]);

function distinctiveHeadlineTokens(value = "") {
  return headlineTokens(value)
    .map((token) => token.toLowerCase())
    .filter((token) => token && !GENERIC_HEADLINE_SUBJECT_TOKENS.has(token));
}

function coverHeadlineMatchesSubject(value = "", subject = "") {
  const text = cleanText(value);
  const subjectText = cleanText(subject);
  if (!text || !subjectText) return false;
  const headlineKey = normaliseSignatureText(text);
  const subjectKey = normaliseSignatureText(compactSubjectHeadline(subjectText) || subjectText);
  if (!headlineKey || !subjectKey) return false;
  if (headlineKey.includes(subjectKey)) return true;
  const subjectTokens = distinctiveHeadlineTokens(subjectKey);
  if (!subjectTokens.length) return false;
  const headlineTokensSet = new Set(distinctiveHeadlineTokens(headlineKey));
  return subjectTokens.some((token) => headlineTokensSet.has(token));
}

const COVER_HEADLINE_STAKE_TOKENS = new Set([
  "pressure",
  "problem",
  "risk",
  "test",
  "trust",
  "fight",
  "catch",
  "warning",
  "danger",
  "dangerous",
  "feels",
  "proof",
  "demo",
  "spike",
  "momentum",
  "return",
  "free",
  "price",
]);

function coverHeadlineMatchesEvidenceEntity(value = "", evidenceText = "") {
  const headlineText = cleanText(value);
  const evidence = cleanText(evidenceText);
  const headlinePrices = headlineText.match(/[$£€]\s?\d+(?:[.,]\d{1,2})?/g) || [];
  if (
    headlinePrices.some((price) =>
      evidence.replace(/\s+/g, "").includes(price.replace(/\s+/g, ""))
    )
  ) {
    return true;
  }
  if (
    /\bday[- ]one\s+dlc\b/i.test(headlineText) &&
    /\bday[- ]one\s+dlc\b/i.test(evidence)
  ) {
    return true;
  }
  const evidenceKey = normaliseSignatureText(evidenceText);
  if (!evidenceKey) return false;
  const entityTokens = distinctiveHeadlineTokens(value)
    .filter((token) => token.length >= 4 && !COVER_HEADLINE_STAKE_TOKENS.has(token));
  return entityTokens.some((token) => evidenceKey.includes(token));
}

function compactSubjectHeadline(subject = "") {
  const tokens = headlineTokens(subject);
  const lower = tokens.map((token) => token.toLowerCase());
  const subjectKey = normaliseSignatureText(subject);
  if (/\byooka\b[\s\S]*\blaylee\b[\s\S]*\bkart\b/i.test(subjectKey)) return "YOOKA-LAYLEE KART";
  if (lower.includes("gears") && lower.some((token) => token === "day" || token === "e-day" || token === "eday")) {
    return "GEARS E-DAY";
  }
  if (lower.includes("sea") && lower.includes("thieves")) return "SEA OF THIEVES";
  if (lower.includes("steam") && lower.includes("next") && lower.includes("fest")) return "STEAM NEXT FEST";
  if (lower.includes("steam") && lower.includes("controller")) return "STEAM CONTROLLER";
  if (lower.includes("steam") && lower.includes("deck")) return "STEAM DECK";
  if (lower.includes("steam")) return "STEAM";
  if (lower.includes("ea") && lower.includes("sports") && lower.includes("fc")) {
    const year = tokens.find((token) => /^\d{2}$/.test(token));
    return year ? `FC ${year}` : "EA FC";
  }
  if (lower.includes("fortnite") && lower.includes("og")) return "FORTNITE OG";
  if (lower.includes("grand") && lower.includes("theft") && lower.includes("auto") && lower.includes("vi")) return "GTA VI";
  if (lower.includes("gta") && lower.includes("vi")) return "GTA VI";
  if (lower.includes("gta") && lower.includes("6")) return "GTA 6";
  if (lower.includes("elliot")) return "ELLIOT";
  if (lower.includes("end") && lower.includes("abyss")) return "ABYSS";
  if (lower.includes("playstation") || lower.includes("ps5")) return "PS5";
  if (lower.includes("xbox")) return "XBOX";
  return tokens
    .filter((token) => !/^(?:of|the|a|an|if|you|haven'?t|havent|reserved?|yet)$/i.test(token))
    .slice(0, 3)
    .join(" ")
    .toUpperCase();
}

function weakCoverHeadline(value = "", subject = "") {
  const text = cleanText(value);
  if (!text) return true;
  const tokens = headlineTokens(text);
  if (tokens.length > 6) return true;
  if (/^(?:why|how|what|when|where)\b/i.test(text) && tokens.length > 4) return true;
  if (/\bcould\s+split\s+players\b/i.test(text)) return true;
  if (/^(?:if you haven'?t|this game|this story)\b/i.test(text)) return true;
  if (/\b(?:story test|just got a new signal|now has a real question|new reason to watch|changed the watchlist)\b/i.test(text)) return true;
  if (
    /\b(?:trust test|demo test|source lock|story guide|gameplay check|review score|update check)\b/i.test(text) &&
    !PLATFORM_HARD_DETAIL_RE.test(text)
  ) return true;
  if (/\b(?:player\s+)?trust\s+(?:test|problem)|player test\b/i.test(text) && !PLATFORM_HARD_DETAIL_RE.test(text)) {
    return true;
  }
  if (cleanText(subject) && normaliseSignatureText(text) === normaliseSignatureText(subject)) return true;
  if (HEADLINE_DANGLE_RE.test(text)) return true;
  return tokens.length <= 3 && !/\b(?:risk|test|fight|trust|bloat|danger|pressure|problem|wins?|guaranteed|demo|spike|demand|momentum|ceiling|ps5|ea\s+play|jungle|combat|discovery|readability|map|train|deck|cards?|carriage|wagons?)\b/i.test(text);
}

function attentionCoverHeadline({ canonical = {}, story = {}, subject = "", title = "", angle = "", firstLine = "" } = {}) {
  const subjectHead = compactSubjectHeadline(subject);
  const evidenceText = cleanText([
    title,
    angle,
    canonical.description,
    firstLine,
  ].join(" "));
  const repairedHeadline = [
    story.first_frame_text,
    canonical.first_frame_text,
    story.suggested_thumbnail_text,
    canonical.suggested_thumbnail_text,
    canonical.thumbnail_headline,
  ]
    .map((candidate) => cleanText(candidate).split(/\s+/).slice(0, 8).join(" ").toUpperCase())
    .find((candidate) =>
      candidate &&
      (coverHeadlineMatchesSubject(candidate, subject) || coverHeadlineMatchesEvidenceEntity(candidate, evidenceText)) &&
      !weakCoverHeadline(candidate, subject)
    );
  if (
    /\bdenshattack\b/i.test(`${subject} ${evidenceText}`) &&
    /\b(?:train|carriage)\b/i.test(evidenceText) &&
    /\b(?:kickflips?|flip|trick|grind|stunt)\b/i.test(evidenceText)
  ) {
    return "DENSHATTACK TRAIN FLIPS";
  }
  const gb = evidenceText.match(/\b(\d{2,4})\s*GB\b/i);
  if (gb) return `${subjectHead} ${gb[1]}GB TEST`;
  if (/\bdoom\b/i.test(`${subject} ${evidenceText}`) && /\bchain\s+spear\b/i.test(evidenceText)) {
    return "CHAIN SPEAR RISK";
  }
  if (diddyKartComparisonSignal(evidenceText)) {
    return `${subjectHead} DIDDY RISK`;
  }
  if (/\bgranblue\s+fantasy\s*:?\s*relink\b/i.test(subject) && /\b(?:playable\s+)?demos?\b/i.test(evidenceText)) {
    return "RELINK PLAYABLE DEMO";
  }
  if (roboKyGuiltyGearSignal(`${subject} ${evidenceText}`)) return "ROBO-KY DELAY TEST";
  if (/\b(?:gta\s*vi|grand\s+theft\s+auto\s*vi)\b/i.test(`${subject} ${evidenceText}`) && /\b(?:cover\s+art|pre[-\s]?order|preorders?)\b/i.test(evidenceText)) {
    return "GTA VI PREORDER TEST";
  }
  if (/\b(?:gta\s*(?:vi|6)|grand\s+theft\s+auto\s*(?:vi|6))\b/i.test(`${subject} ${evidenceText}`) && sourceDeniesGameplayRepresentation(evidenceText)) {
    return "GTA VI NOT GAMEPLAY";
  }
  if (/\b(?:call\s+of\s+duty|black\s+ops)\b/i.test(`${subject} ${evidenceText}`) && /\b(?:june\s+\d{1,2}|maps?|zombies?|endgame|progression|prestige|reload(?:ed)?|season)\b/i.test(evidenceText)) {
    return "BLACK OPS 7 REINSTALL CATCH";
  }
  if (/\bstar\s+fox\b/i.test(`${subject} ${evidenceText}`) && /\bswitch\s*2\b/i.test(evidenceText) && /\b(?:visual showcase|review|arcade|fox\s+mccloud)\b/i.test(evidenceText) && !concretePriceOrAccessSignal(evidenceText)) {
    return "STAR FOX VISUAL TEST";
  }
  if (/\bsuper\s+mario\s*64\b/i.test(`${subject} ${evidenceText}`) && /\b(?:35mm|film\s+slides?|collectibles?)\b/i.test(evidenceText)) {
    return "MARIO 64 COLLECTOR TEST";
  }
  if (/\bmario\s+kart\s*64\b/i.test(`${subject} ${evidenceText}`) && /\b(?:transformed|blueprint|series|retrospective)\b/i.test(evidenceText)) {
    return "MARIO KART 64 BLUEPRINT";
  }
  if (/\bstar\s+wars\s*:?\s*galactic\s+racer\b/i.test(subject) && /\b(?:podracing|roguelite)\b/i.test(evidenceText)) {
    return "STAR WARS ROGUELITE RISK";
  }
  if (subjectHead === "GTA 6" && /\bdemos?\b/i.test(evidenceText)) return "GTA 6 DEMO RISK";
  if (/\bea play\b/i.test(evidenceText)) return `${subjectHead} EA PLAY`;
  if (/palworld/i.test(`${subject} ${evidenceText}`) && /\bcomeback\s+button\b/i.test(evidenceText)) {
    return "PALWORLD COMEBACK BUTTON";
  }
  if (scheduledBetaAccessSignal(evidenceText)) {
    return /\b(?:nintendo\s+)?switch\s*2\b/i.test(evidenceText)
      ? "SWITCH 2 BETA GAP"
      : `${subjectHead} BETA SPLIT`;
  }
  if (repairedHeadline) return repairedHeadline;
  if (/\b(?:game pass|ps plus|subscription)\b/i.test(evidenceText)) return `${subjectHead} TRIAL TEST`;
  if (/\b(?:free play days|free access|free weekend|try for free|free trial)\b/i.test(evidenceText)) return `${subjectHead} FREE RISK`;
  if (freeUpgradeOwnerSignal(evidenceText)) return `${subjectHead} FREE UPGRADE`;
  if (/\b(?:custom seas|private sessions?|private seas|set (?:their own )?rules|rule controls?)\b/i.test(evidenceText)) return `${subjectHead} CUSTOM SEAS`;
  if (/\bsafer seas\b/i.test(evidenceText)) return "SAFER SEAS RISK";
  if (/\bjump[- ]?scares?\b/i.test(evidenceText)) return `${subjectHead} JUMP SCARE RISK`;
  if (/\b(?:pc releases?|pc launch|multiplatform|business strategy|first-party|fully exclusive|single-player games)\b/i.test(evidenceText)) {
    const pcSubjectHead = /\bplaystation\b/i.test(subject) ? "PLAYSTATION PC" : `${subjectHead} PC`;
    return `${pcSubjectHead} TRUST`;
  }
  if (/\b(?:paid early access|early[- ]access|steam demand|steam peak|steam spike|concurrent steam players?|premium week)\b/i.test(evidenceText)) {
    return `${subjectHead} STEAM SPIKE`;
  }
  if (/\b(?:wait until next year|reservation|reserved|queue|orders?|fulfilled|delivery window)\b/i.test(evidenceText)) return `${subjectHead} WAIT PROBLEM`;
  if (/\b(?:hollywood|movie|film|elden ring|a24)\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\b(?:og pass|map changes?|live events?|chapter\s*1|season\s*\d+)\b/i.test(evidenceText)) return `${subjectHead} MAP TEST`;
  if (/\bend\s+of\s+abyss\b/i.test(subject) && /\b(?:combat|readability|enemy|movement|hostile facility|pressure)\b/i.test(evidenceText)) return `${subjectHead} COMBAT TEST`;
  if (/\belliot\b/i.test(subject) && /\b(?:exploration|combat|discovery|retro)\b/i.test(evidenceText)) return `${subjectHead} COMBAT TEST`;
  if (/\b(?:retro|throwback|old-school|exploration|combat|discovery|square enix)\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\b(?:more of an mmo|coexist as different experiences|different experiences|mmo than the first game)\b/i.test(evidenceText)) return `${subjectHead} MMO IDENTITY`;
  if (/\b(?:in-game millionaires|exploiting a system|exploiting system|loot hunt|grind for 100 hours|economy)\b/i.test(evidenceText)) return `${subjectHead} LOOT ECONOMY`;
  if (/\b(?:genai|ai team\s*mates?|ai teammates?|team mates now|intelligent decision-making|bots for the military)\b/i.test(evidenceText)) return `${subjectHead} AI TEAMMATE`;
  if (/\b(?:diana|android|character|child-like|companion|hugh|development team)\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\bdune\s*:?\s*awakening\b/i.test(`${subject} ${evidenceText}`) && /\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) {
    return "DUNE PS5 TEST";
  }
  if (/\bsurvival\b/i.test(evidenceText) && /\b(?:ps5|playstation|console)\b/i.test(evidenceText)) return `${subjectHead} PS5`;
  if (/\bjungle\b/i.test(evidenceText) && /\b(?:dlc|biome|out now|dive|serve|upgrade)\b/i.test(evidenceText)) return `${subjectHead} JUNGLE`;
  if (/\bdemos?\b/i.test(evidenceText) && /\btrust\b/i.test(evidenceText)) {
    return subjectHead === "STEAM NEXT FEST" ? "STEAM DEMO FIGHT" : `${subjectHead} DEMO FIGHT`;
  }
  if (/\bdemos?\b/i.test(evidenceText)) return `${subjectHead} DEMO RISK`;
  if (/\btrust\b/i.test(evidenceText)) return `${subjectHead} TRUST PROBLEM`;
  if (/\b(?:deal|discount|sale|price|reserved?|reservation|preorder|pre-order)\b/i.test(evidenceText)) return `${subjectHead} PRICE RISK`;
  if (/\b(?:expansion|dlc|update|season|battle pass)\b/i.test(evidenceText)) return `${subjectHead} RETURN RISK`;
  if (/\b(?:score|metacritic|review)\b/i.test(evidenceText)) return `${subjectHead} MOMENTUM RISK`;
  if (/\bdangerous?\b/i.test(evidenceText)) return `${subjectHead} FEELS DANGEROUS`;
  if (/\bbloat\b/i.test(evidenceText)) return `${subjectHead} OR BLOAT`;
  for (const candidate of [canonical.thumbnail_headline, story.suggested_thumbnail_text, title]) {
    const text = cleanText(candidate)
      .split(/\s+/)
      .slice(0, 8)
      .join(" ")
      .toUpperCase();
    if (coverHeadlineMatchesSubject(text, subject) && !weakCoverHeadline(text, subject)) return text;
  }
  return `${subjectHead} PLAYER TEST`;
}

function canonicalAttentionCopy(canonical = {}, story = {}) {
  const subject = storySubject(story, canonical);
  const rawTitle = storyTitle(story, canonical);
  const firstLine = storyFirstLine(story, canonical);
  const angle = publicAngleFor({ story, canonical, subject, title: rawTitle, firstLine });
  const title = attentionPlatformTitle({
    subject,
    title: rawTitle,
    angle,
    description: canonical.description,
    firstLine,
  });
  const headline = attentionCoverHeadline({ canonical, story, subject, title, angle, firstLine });
  const existingFirstFrame = cleanText(canonical.first_frame_text || story.first_frame_text);
  const firstFrameMatchesHeadline =
    existingFirstFrame &&
    normaliseSignatureText(existingFirstFrame) === normaliseSignatureText(headline);
  const displayFirstLine = cleanText(
    story.first_spoken_line ||
      story.hook ||
      cleanText(story.full_script || story.narration_script).split(/(?<=[.!?])\s+/)[0] ||
      canonical.first_spoken_line ||
      firstLine,
  );
  const editorialDescription = canonicalEditorialDescription(canonical, story);
  const suppliedYoutubeDescription = String(
    story.youtube_description || canonical.youtube_description || "",
  ).trim();
  const youtubeDescription =
    approvedYoutubeDescriptionWithRightsNotice(
      suppliedYoutubeDescription,
      story,
      canonical,
    ) || requiredYoutubeRightsDescription(story, canonical, editorialDescription);
  const syntheticDisclosure = youtubeSyntheticDisclosureState(story, canonical);
  return {
    ...canonical,
    canonical_subject: subject,
    canonical_game: weakCanonicalSubject(canonical.canonical_game) ? subject : canonical.canonical_game || subject,
    selected_title: title,
    canonical_title: title,
    title,
    public_title: title,
    thumbnail_headline: headline,
    thumbnail_text: headline,
    suggested_thumbnail_text: headline,
    first_frame_text: firstFrameMatchesHeadline ? existingFirstFrame : headline,
    first_spoken_line: displayFirstLine,
    narration_hook: displayFirstLine,
    ...(editorialDescription
      ? {
          description: editorialDescription,
          public_description: editorialDescription,
        }
      : {}),
    ...(youtubeDescription ? { youtube_description: youtubeDescription } : {}),
    ...(syntheticDisclosure.required
      ? {
          synthetic_media_required: true,
          altered_synthetic_disclosure_required: true,
          youtube_altered_or_synthetic_content: "YES",
          youtube_synthetic_media_disclosed: syntheticDisclosure.present,
        }
      : {}),
    tts_script: cleanText(
      story.tts_script || story.spoken_narration_script || canonical.tts_script || canonical.narration_script,
    ),
    spoken_narration_script: cleanText(
      story.spoken_narration_script || story.tts_script || canonical.spoken_narration_script || canonical.narration_script,
    ),
  };
}

function storySourceName(story = {}, canonical = {}) {
  const source = canonical.primary_source || story.primary_source || story.source_name;
  if (source && typeof source === "object") return cleanText(source.name || source.label || source.url);
  return cleanText(source || story.source_card_label || story.thumbnail_source_label || "source");
}

function storyFirstLine(story = {}, canonical = {}) {
  return cleanText(
    canonical.first_spoken_line ||
      story.hook ||
      cleanText(story.full_script || story.tts_script).split(/(?<=[.!?])\s+/)[0] ||
      storyTitle(story, canonical),
  );
}

function storyDisclosure(affiliateManifest = {}) {
  const required = affiliateManifest.disclosure_required === true ||
    Boolean(affiliateManifest.primary_link);
  return {
    required,
    type: required ? "affiliate" : "none",
    caption: required ? "Affiliate links may earn us a commission." : "No commercial link attached.",
  };
}

function landingRouteFor(story = {}, canonical = {}, landingPage = {}) {
  const slug = cleanText(
    landingPage.landing_page_slug ||
      landingPage.slug ||
      story.landing_page_slug ||
      `${storySubject(story, canonical)} ${story.id || ""}`,
  );
  return `/p/${slugify(slug)}`;
}

function commercialSourceLinks(story = {}, affiliateManifest = {}) {
  const candidates = [
    ...asArray(affiliateManifest.source_links),
    ...asArray(story.source_links),
    {
      label: sourceNameFromStory(story) || "Source",
      url: sourceUrlFromStory(story),
    },
  ];
  const seen = new Set();
  const links = [];
  for (const candidate of candidates) {
    const row = candidate && typeof candidate === "object" ? candidate : { url: candidate };
    const url = cleanText(row.url || row.source_url || row.href);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    links.push({
      label: cleanText(row.label || row.name || row.source_name || sourceNameFromStory(story) || "Source"),
      url,
    });
  }
  return links;
}

function attributedStoryPageUrl(route, { storyId, platform, slug, videoId = null } = {}) {
  const query = new URLSearchParams({
    utm_source: platform,
    utm_medium: "social",
    utm_campaign: slug,
    utm_content: `${storyId}_${platform}_story_page`,
    story_id: storyId,
    cta_variant: "story_page",
  });
  if (videoId) query.set("video_id", videoId);
  return `${route}?${query.toString()}`;
}

function attributionRowsByPlatform(attribution = {}) {
  const rows = {};
  for (const [platform, row] of Object.entries(attribution.platforms || {})) {
    if (row && typeof row === "object") rows[platform] = { ...row };
  }
  for (const row of asArray(attribution.link_tracking)) {
    const platform = cleanText(row?.platform);
    if (platform) rows[platform] = { ...(rows[platform] || {}), ...row };
  }
  return rows;
}

function offerTrackingUrlForPlatform(affiliateManifest = {}, primaryLink = {}, platform, existingRow = {}) {
  return cleanText(
    primaryLink.platform_tracking_urls?.[platform] ||
      affiliateManifest.affiliate_tracking_map?.platforms?.[platform] ||
      existingRow.offer_tracking_url,
  ) || null;
}

function usableAttachedOffer(value) {
  if (typeof value === "string") return /^https?:\/\//i.test(cleanText(value));
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rejectionReasons = asArray(value.rejection_reasons || value.blockers)
    .map(cleanText)
    .filter(Boolean);
  const status = cleanText(value.approval_status || value.status || value.verdict).toLowerCase();
  if (rejectionReasons.length || /^(?:reject|rejected|blocked|defer|deferred|fail|failed)$/.test(status)) {
    return false;
  }
  return /^https?:\/\//i.test(cleanText(
    value.url || value.affiliate_url || value.product_url || value.merchant_url || value.href,
  ));
}

function buildCommercialLandingAttribution({
  affiliateManifest = {},
  storyId,
  slug,
  route,
  videoId = null,
  primaryLink = null,
  disclosureRequired = false,
} = {}) {
  const existing = affiliateManifest.landing_page_attribution || {};
  const existingRows = attributionRowsByPlatform(existing);
  const offerId = cleanText(primaryLink?.id) || null;
  const platforms = {};
  const linkTracking = [];
  const rejectionReasons = [];

  for (const platform of COMMERCIAL_PLATFORM_KEYS) {
    const existingRow = existingRows[platform] || {};
    const offerTrackingUrl = primaryLink
      ? offerTrackingUrlForPlatform(affiliateManifest, primaryLink, platform, existingRow)
      : null;
    const row = {
      ...existingRow,
      platform,
      story_id: storyId,
      video_id: videoId,
      cta_variant: "story_page",
      offer_id: offerId,
      tracking_key: `${storyId}:${platform}:story_page`,
      landing_page_url: attributedStoryPageUrl(route, { storyId, platform, slug, videoId }),
      offer_tracking_url: offerTrackingUrl,
      disclosure_required: Boolean(disclosureRequired),
      disclosure_copy: disclosureRequired
        ? cleanText(affiliateManifest.disclosure_copy?.short) || null
        : null,
    };
    platforms[platform] = row;
    linkTracking.push({ ...row });
    if (primaryLink && !offerTrackingUrl) rejectionReasons.push(`missing_offer_tracking:${platform}`);
  }

  if (!route) rejectionReasons.push("missing_story_landing_page");
  if (primaryLink && !offerId) rejectionReasons.push("missing_primary_offer_id");
  if (primaryLink && disclosureRequired !== true) rejectionReasons.push("missing_affiliate_disclosure");

  return {
    ...existing,
    schema_version: existing.schema_version || 1,
    story_id: storyId,
    video_id: videoId,
    landing_page_slug: slug,
    landing_page_route: route,
    verdict: rejectionReasons.length ? "fail" : "pass",
    platforms,
    link_tracking: linkTracking,
    rejection_reasons: [...new Set(rejectionReasons)],
    safety: {
      ...(existing.safety || {}),
      source_first_story_page: true,
      no_direct_social_posting: true,
      no_live_account_changes: true,
    },
  };
}

function materialiseGovernedCommercialEvidence({
  story = {},
  canonical = {},
  affiliateManifest = {},
  landingPage = {},
} = {}) {
  const existing = affiliateManifest && typeof affiliateManifest === "object" && !Array.isArray(affiliateManifest)
    ? affiliateManifest
    : {};
  const storyId = cleanText(story.id || story.story_id || existing.story_id) || slugify(storyTitle(story, canonical));
  const route = cleanText(
    existing.landing_page_route ||
      existing.landing_page_attribution?.landing_page_route ||
      landingPage.landing_page_route ||
      landingPage.route,
  );
  const sourceFirstRoute = /^\/p\//i.test(route)
    ? route.split(/[?#]/)[0]
    : landingRouteFor(story, canonical, landingPage);
  const slug = cleanText(
    existing.landing_page_slug ||
      existing.landing_page_attribution?.landing_page_slug ||
      landingPage.landing_page_slug ||
      sourceFirstRoute.replace(/^\/p\//, ""),
  ) || slugify(storyId);
  const primaryLink = usableAttachedOffer(existing.primary_link) ? existing.primary_link : null;
  const fallbackLinks = asArray(existing.fallback_links).filter(usableAttachedOffer);
  const attachedOffers = asArray(existing.offers).filter(usableAttachedOffer);
  const ungovernedAffiliateUrl = /^https?:\/\//i.test(cleanText(story.affiliate_url))
    ? cleanText(story.affiliate_url)
    : "";
  const videoId = story.youtube_post_id || story.youtube_id || existing.video_id || null;
  const sourceLinks = commercialSourceLinks(story, existing);
  const noDirectOffer =
    !primaryLink &&
    fallbackLinks.length === 0 &&
    attachedOffers.length === 0 &&
    !ungovernedAffiliateUrl;

  if (noDirectOffer) {
    const reason = cleanText(
      existing.no_direct_offer_reason ||
        existing.no_offer_reason ||
        existing.decision_reason ||
        asArray(existing.rejection_reasons)[0],
    ) || "no_governed_direct_offer_supplied";
    const disclosureCopy = existing.disclosure_copy || {
      short: "No affiliate links are attached to this story.",
      landing: "This source-first story page has no affiliate offer attached.",
    };
    const affiliateTrackingMap = {
      story_id: storyId,
      primary_offer_id: null,
      story_page: null,
      platforms: {},
      fallback_offer_ids: [],
    };
    const manifest = {
      ...existing,
      schema_version: existing.schema_version || 1,
      story_id: storyId,
      vertical: cleanText(existing.vertical || "gaming"),
      commercial_intent_type: "no_safe_commercial_intent",
      decision_status: "governed_no_offer",
      no_direct_offer_reason: reason,
      primary_link: null,
      fallback_links: [],
      offers: [],
      candidate_links: Array.isArray(existing.candidate_links) ? existing.candidate_links : [],
      disclosure_required: false,
      disclosure_copy: disclosureCopy,
      platform_disclosure: Object.fromEntries(COMMERCIAL_PLATFORM_KEYS.map((platform) => [
        platform,
        {
          affiliate_disclosure_required: false,
          commercial_relationship_toggle_required: false,
          caption_copy: null,
        },
      ])),
      source_links: sourceLinks,
      landing_page_slug: slug,
      landing_page_route: sourceFirstRoute,
      tracking_utm: existing.tracking_utm || {
        utm_source: "pulse_gaming",
        utm_medium: "shorts",
        utm_campaign: slug,
        story_id: storyId,
        video_id: videoId,
        cta_variants: Object.fromEntries(
          COMMERCIAL_PLATFORM_KEYS.map((platform) => [platform, `${slug}_${platform}`]),
        ),
      },
      affiliate_tracking_map: affiliateTrackingMap,
      revenue_attribution: existing.revenue_attribution || {
        story_id: storyId,
        video_id: videoId,
        primary_offer_id: null,
        platform_clicks: Object.fromEntries(COMMERCIAL_PLATFORM_KEYS.map((platform) => [platform, 0])),
        landing_page_visits: 0,
        conversions: 0,
        revenue: { amount: 0, currency: "GBP", source: "no_direct_offer" },
      },
      rejection_reasons: [...new Set([reason, ...asArray(existing.rejection_reasons).map(cleanText)])],
    };
    manifest.landing_page_attribution = buildCommercialLandingAttribution({
      affiliateManifest: manifest,
      storyId,
      slug,
      route: sourceFirstRoute,
      videoId,
      primaryLink: null,
      disclosureRequired: false,
    });
    return manifest;
  }

  const disclosureRequired = existing.disclosure_required === true;
  const manifest = {
    ...existing,
    schema_version: existing.schema_version || 1,
    story_id: storyId,
    fallback_links: fallbackLinks,
    source_links: sourceLinks,
    landing_page_slug: slug,
    landing_page_route: sourceFirstRoute,
  };
  manifest.landing_page_attribution = buildCommercialLandingAttribution({
    affiliateManifest: manifest,
    storyId,
    slug,
    route: sourceFirstRoute,
    videoId,
    primaryLink,
    disclosureRequired,
  });
  if (!primaryLink) {
    manifest.landing_page_attribution.verdict = "fail";
    manifest.landing_page_attribution.rejection_reasons = [
      ...new Set([
        ...asArray(manifest.landing_page_attribution.rejection_reasons),
        "missing_primary_offer",
      ]),
    ];
  }
  return manifest;
}

function buildHashtags(story = {}, canonical = {}) {
  const subject = storySubject(story, canonical).toLowerCase();
  const tags = ["#GamingNews", "#PulseGaming"];
  if (/\bxbox|forza|game pass\b/i.test(subject)) tags.push("#Xbox");
  if (/\bplaystation|ps5\b/i.test(subject)) tags.push("#PlayStation");
  if (/\bnintendo|switch\b/i.test(subject)) tags.push("#Nintendo");
  if (/\bsteam|pc\b/i.test(subject)) tags.push("#PCGaming");
  return [...new Set(tags)];
}

function mergePlatformOutput(base = {}, additions = {}) {
  return {
    ...base,
    ...additions,
    duration_seconds: additions.duration_seconds || base.duration_seconds,
    strategic_duration_seconds: base.duration_seconds || additions.duration_seconds,
  };
}

function scrubStalePlatformOutput(base = {}, story = {}, canonical = {}) {
  if (!objectHasKeys(base)) return {};
  const title = cleanText(base.title || base.caption || base.conversational_hook);
  if (!title) return base;
  return candidateTitleMatchesStory(title, story, canonical) ? base : {};
}

function requiredYoutubeRightsDescription(story = {}, canonical = {}, attentionDescription = "") {
  const editorialDescription = cleanText(
    canonical.public_description || canonical.description || story.public_description,
  );
  const explicitNotice = String(story.youtube_required_rights_notice || "").trim();
  const description = cleanText(
    explicitNotice ? `${editorialDescription} ${explicitNotice}` : editorialDescription,
  );
  const rightsNotice = splitMicrosoftGameContentNotice(description);
  if (!rightsNotice.required) {
    if (!explicitNotice) return "";
    const generatedDescription = String(attentionDescription || editorialDescription).trim();
    return generatedDescription ? `${generatedDescription}\n\n${explicitNotice}` : explicitNotice;
  }
  const editorialText =
    !sourceSafeSocialBodyTooPlain(rightsNotice.editorialText) &&
    platformAudiencePullLanguage(rightsNotice.editorialText)
      ? rightsNotice.editorialText
      : attentionDescription;
  return cleanText(`${editorialText} ${rightsNotice.noticeText}`);
}

function requiredYoutubeRightsNotice(story = {}, canonical = {}) {
  const explicitNotice = String(story.youtube_required_rights_notice || "").trim();
  if (explicitNotice) return explicitNotice;
  for (const candidate of [
    canonical.public_description,
    canonical.description,
    story.public_description,
    story.description,
  ]) {
    const split = splitMicrosoftGameContentNotice(candidate);
    if (split.required && split.noticeText) return split.noticeText;
  }
  return "";
}

function approvedYoutubeDescriptionWithRightsNotice(
  approvedDescription,
  story = {},
  canonical = {},
) {
  const approved = String(approvedDescription || "").trim();
  if (!approved) return "";
  const requiredNotice = requiredYoutubeRightsNotice(story, canonical);
  const comparable = (value) => cleanText(value).toLowerCase().replace(/\u2019/g, "'");
  if (!requiredNotice || comparable(approved).includes(comparable(requiredNotice))) return approved;
  return `${approved}\n\n${requiredNotice}`;
}

function buildPlatformNativePublishPacks({
  story = {},
  canonical = {},
  platformOutputs = {},
  affiliateManifest = {},
  landingPage = {},
  lockedTitle = "",
} = {}) {
  const subject = storySubject(story, canonical);
  const rawTitle = storyTitle(story, canonical);
  const firstLine = storyFirstLine(story, canonical);
  const angle = publicAngleFor({ story, canonical, subject, title: rawTitle, firstLine });
  const title =
    cleanText(lockedTitle) ||
    attentionPlatformTitle({
      subject,
      title: rawTitle,
      angle,
      description: canonical.description,
      firstLine,
    });
  const sourceName = storySourceName(story, canonical);
  const landingPageLink = landingRouteFor(story, canonical, landingPage);
  const disclosure = storyDisclosure(affiliateManifest);
  const headline = attentionCoverHeadline({ canonical, story, subject, title, angle, firstLine });
  const hashtags = buildHashtags(story, canonical);
  const shortAngle = angle || "the latest story behind the headline";
  const subjectClaim = subjectClaimFromAngle(subject, shortAngle);
  const reasonClause = reasonClauseFromAngle(shortAngle);
  const sourceLine = `Source: ${sourceName}.`;
  const durationSeconds = Number(
    canonical.duration_seconds ||
      canonical.rendered_duration_s ||
      canonical.duration_s ||
      story.duration_seconds ||
      story.rendered_duration_s ||
      story.duration_s ||
      story.render_manifest?.rendered_duration_s ||
      story.render_manifest?.duration_seconds ||
      story.render_manifest?.duration_s,
  );
  const attentionDescription = platformAttentionDescription({
    canonical,
    subject,
    angle: shortAngle,
    sourceLine,
    title,
    firstLine,
  });
  const approvedYoutubeDescription = approvedYoutubeDescriptionWithRightsNotice(String(
    story.youtube_description || canonical.youtube_description || "",
  ).trim(), story, canonical);
  const youtubeDescription = approvedYoutubeDescription ||
    requiredYoutubeRightsDescription(story, canonical, attentionDescription) ||
    attentionDescription;
  const syntheticDisclosure = youtubeSyntheticDisclosureState(story, canonical);
  const paidPromotionDisclosure = youtubePaidPromotionDisclosureState(story, canonical);
  const socialClaim = socialClaimFromAttentionDescription(attentionDescription, subjectClaim);
  const explanatoryFraming =
    INTERNAL_ANGLE_RE.test(shortAngle) || INTERNAL_REVIEW_PUBLIC_COPY_RE.test(shortAngle)
      ? `${subject} matters because ${reasonClause}.`
      : `${socialClaim}.`;
  const formatFamily = platformStoryFormatFamily({ subject, title, angle: shortAngle, affiliateManifest });
  const cleanPlatformOutputs = Object.fromEntries(
    Object.entries(platformOutputs || {}).map(([platform, output]) => [
      platform,
      scrubStalePlatformOutput(output, story, canonical),
    ]),
  );
  const outputs = {
    youtube_shorts: mergePlatformOutput(cleanPlatformOutputs.youtube_shorts, {
      platform: "youtube_shorts",
      native_role: "searchable_short",
      title,
      description: youtubeDescription,
      hashtags,
      cover_frame: {
        headline,
        subject,
        source_label: sourceName,
      },
      captions: {
        file: "captions.srt",
        clean_manual_captions_required: true,
      },
      cta: `${PRIMARY_PULSE_CTA}.`,
      disclosure_status: disclosure,
      synthetic_media_required: syntheticDisclosure.required,
      altered_synthetic_disclosure_required: syntheticDisclosure.required,
      altered_synthetic_disclosure_setting: syntheticDisclosure.setting,
      altered_synthetic_disclosure_present: syntheticDisclosure.present,
      paid_promotion_disclosure_required: paidPromotionDisclosure.required,
      paid_promotion_disclosure_present: paidPromotionDisclosure.present,
      profile_or_landing_page_cta: `Story sources and related links: ${landingPageLink}`,
      link_strategy: "profile_link_or_related_video_for_shorts",
      cta_style: "identity_follow",
    }),
    tiktok: mergePlatformOutput(cleanPlatformOutputs.tiktok, {
      platform: "tiktok",
      native_role: "conversation_first_short",
      conversational_hook: firstLine,
      caption: attentionDescription,
      hashtags: [...hashtags, "#GamingTok"],
      disclosure_flag: disclosure.required ? "commercial_content_disclosure_required" : "not_required",
      commercial_content_setting_recommendation: disclosure.required
        ? "required_for_affiliate_or_brand_promotion"
        : "not_required_unless_brand_or_product_promoted",
      product_link_eligibility: affiliateManifest.primary_link ? "review_required" : "not_used",
      link_strategy: "bio_or_product_link_when_enabled",
      cta_style: "source_context",
    }),
    instagram_reels: mergePlatformOutput(cleanPlatformOutputs.instagram_reels, {
      platform: "instagram_reels",
      native_role: "cover_first_reel_plus_carousel",
      title,
      cover_frame: {
        headline,
        subject,
        text_word_limit: 7,
        source_label: sourceName,
      },
      caption: attentionDescription,
      carousel_companion: {
        required: true,
        cards: ["cover", "source", "player impact", "related links"],
      },
      story_poll_idea: `Does ${subject} change your watchlist?`,
      bio_link_cta: `Story page in bio: ${landingPageLink}`,
      disclosure_status: disclosure,
      cta_style: "bio_link",
    }),
    facebook_reels: mergePlatformOutput(cleanPlatformOutputs.facebook_reels, {
      platform: "facebook_reels",
      native_role: "context_first_reel",
      title,
      cover_frame: {
        headline,
        subject,
        text_word_limit: 7,
        source_label: sourceName,
      },
      explanatory_framing: explanatoryFraming,
      page_caption: `${attentionDescription} More context: ${landingPageLink}`,
      ...(Number.isFinite(durationSeconds) && durationSeconds > 0
        ? { duration_seconds: Number(durationSeconds.toFixed(3)) }
        : {}),
      link_routing_strategy: "page_caption_or_comment_link",
      disclosure_status: disclosure,
      cta_style: "context_link",
    }),
    x: mergePlatformOutput(cleanPlatformOutputs.x, {
      platform: "x",
      native_role: "headline_source_post",
      hot_take_post: `${socialClaim}. That is the part of this story everyone will argue about.`,
      source_safe_post: `${title}\n\n${sourceLine} Full source list: ${landingPageLink}`,
      concise_news_post: `${socialClaim}.`,
      thread_posts: [
        title,
        `${sourceLine} ${socialClaim}.`,
        "Watch whether this changes price, access, trust or timing.",
        `Sources and related links: ${landingPageLink}`,
      ],
      poll_candidate: `Is ${subject} a buy-now story or a wait-for-reviews story?`,
      landing_page_link: landingPageLink,
      cta_style: "source_first_link",
    }),
    threads: {
      platform: "threads",
      native_role: "soft_discussion_post",
      discussion_post: `${subject} is worth watching for the player impact, not just the headline. ${sourceLine}`,
      duplicate_x_wording_allowed: false,
      tone: "discussion-led and source-safe",
      landing_page_link: landingPageLink,
      disclosure_status: disclosure,
      cta_style: "soft_discussion",
    },
    pinterest: {
      platform: "pinterest",
      native_role: "evergreen_pin_only",
      pin_title: `${subject} story guide`,
      pin_description: `${socialClaim}. Sources, related links and safer buying routes are on the story page.`,
      evergreen_only: true,
      disclosure: disclosure.caption,
      affiliate_disclosure_required: disclosure.required,
      landing_page_required: true,
      landing_page_link: landingPageLink,
      cta_style: "evergreen_story_page",
    },
  };
  const platformNativeEvidence = buildPlatformNativeEvidence(outputs, { formatFamily });
  return { outputs, platformNativeEvidence };
}

function valueAtPath(object = {}, pathExpression = "") {
  return pathExpression.split(".").reduce((current, key) => {
    if (current == null) return undefined;
    return current[key];
  }, object);
}

function hasEvidenceValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  if (typeof value === "boolean") return true;
  return cleanText(value).length > 0;
}

function copyFingerprintForPlatform(platform, pack = {}) {
  const copyFields = {
    youtube_shorts: ["title", "description", "profile_or_landing_page_cta"],
    tiktok: ["conversational_hook", "caption"],
    instagram_reels: ["caption", "story_poll_idea"],
    facebook_reels: ["page_caption", "explanatory_framing"],
    x: ["hot_take_post", "source_safe_post"],
    threads: ["discussion_post"],
    pinterest: ["pin_title", "pin_description"],
  };
  return asArray(copyFields[platform])
    .map((field) => cleanText(valueAtPath(pack, field)))
    .join(" ")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\/p\/[a-z0-9-]+/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectBlindDuplicatePairs(outputs = {}) {
  const fingerprints = new Map();
  const duplicates = [];
  for (const platform of PLATFORM_NATIVE_ORDER) {
    const fingerprint = copyFingerprintForPlatform(platform, outputs[platform]);
    if (!fingerprint) continue;
    const previous = fingerprints.get(fingerprint);
    if (previous) {
      duplicates.push({
        platforms: [previous, platform],
        reason: "exact_public_copy_fingerprint_match",
      });
    } else {
      fingerprints.set(fingerprint, platform);
    }
  }
  return duplicates;
}

function platformStoryFormatFamily({ subject = "", title = "", angle = "", affiliateManifest = {} } = {}) {
  const text = cleanText([subject, title, angle].join(" ")).toLowerCase();
  if (/\b(?:controller|headset|keyboard|mouse|monitor|hardware|accessory|steam deck)\b/.test(text)) {
    if (/\b(?:deal|price|sale|discount|drops? to|bundle)\b/.test(text)) return "hardware_deal_watch";
    if (/\b(?:date|release|launch|leak|leaked|reportedly|may have)\b/.test(text)) return "hardware_release_watch";
    return "hardware_accessory_watch";
  }
  if (/\b(?:xcom|tactic|tactical|strategy comparison|more than)\b/.test(text)) {
    return "tactics_comparison";
  }
  if (/\b(?:ai[-\s]?look|handmade|hand made|crafted|art direction|production process)\b/.test(text)) {
    return "creative_process";
  }
  if (/\b(?:devs? are making|developer.*making|studio.*working|next game|new project)\b/.test(text)) {
    return "studio_project_watch";
  }
  if (/\b(?:eras?|timeline|generations?|five eras|history)\b/.test(text)) {
    return "timeline_showcase";
  }
  if (/\b(?:gameplay|hands[-\s]?on|preview|trailer|demo|shown|shows)\b/.test(text)) {
    return "gameplay_showcase";
  }
  if (/\b(?:leak|leaked|reportedly|rumou?r|claimed|may have)\b/.test(text)) {
    return /\b(?:date|release|launch)\b/.test(text) ? "release_date_watch" : "leak_watch";
  }
  if (/\b(?:drops? to|deal|discount|price|sale|bundle|subscription|game pass|free upgrade|free claim)\b/.test(text)) {
    return "game_price_watch";
  }
  if (/\b(?:metacritic|opencritic|review|score|rated)\b/.test(text)) return "review_score";
  if (/\b(?:playstation|ps5|xbox|switch|steam)\b/.test(text)) return "platform_access";
  if (/\b(?:jobs?|layoff|composer|studio|developer|publisher|business)\b/.test(text)) return "industry_business";
  if (affiliateManifest.primary_link || asArray(affiliateManifest.fallback_links).length) return "commercial_context";
  return "source_brief";
}

function buildPlatformFormatSignature(outputs = {}, { formatFamily = "source_brief" } = {}) {
  const instagramCards = asArray(outputs.instagram_reels?.carousel_companion?.cards).join(">");
  const xThreadCount = asArray(outputs.x?.thread_posts).length;
  const roles = PLATFORM_NATIVE_ORDER
    .map((platform) => `${platform}:${cleanText(outputs[platform]?.native_role)}`)
    .join("|");
  return normaliseSignatureText(`${formatFamily}|ig:${instagramCards}|x_thread:${xThreadCount}|${roles}`);
}

function platformNativeQualityFailures(outputs = {}) {
  const failures = [];
  for (const platform of PLATFORM_NATIVE_ORDER) {
    if (!SHORT_FEED_QUALITY_PLATFORMS.has(platform)) continue;
    const pack = outputs[platform] || {};
    const subject = cleanText(pack.cover_frame?.subject || pack.subject || pack.pin_title || "");
    const title = cleanText(pack.title || pack.pin_title || pack.conversational_hook || "");
    const coverHeadline = cleanText(pack.cover_frame?.headline || pack.thumbnail_headline || "");
    const publicCopy = cleanText([
      pack.description,
      pack.caption,
      pack.page_caption,
      pack.explanatory_framing,
      pack.hot_take_post,
      pack.source_safe_post,
      pack.concise_news_post,
      pack.discussion_post,
      pack.pin_description,
    ].filter(Boolean).join(" "));
    const qualityBody = platform === "facebook_reels"
      ? cleanText((pack.page_caption || pack.explanatory_framing || "").replace(/\s*More context:\s*\S+\s*$/i, ""))
      : publicCopy;

    if (title && weakPlatformTitle(title, subject)) {
      failures.push({ platform, reason: "weak_platform_title" });
    }
    if (coverHeadline && weakCoverHeadline(coverHeadline, subject)) {
      failures.push({ platform, reason: "weak_cover_headline" });
    }
    if (INTERNAL_REVIEW_PUBLIC_COPY_RE.test(publicCopy)) {
      failures.push({ platform, reason: "internal_review_language_in_public_copy" });
    }
    if (sourceSafeSocialBodyTooPlain(qualityBody)) {
      failures.push({ platform, reason: "plain_platform_description" });
    }
  }
  return failures;
}

function buildPlatformNativeEvidence(outputs = {}, options = {}) {
  const platforms = PLATFORM_NATIVE_ORDER.map((platform) => {
    const pack = outputs[platform] || {};
    const requiredFields = PLATFORM_NATIVE_REQUIREMENTS[platform] || [];
    const missingFields = requiredFields.filter((field) => !hasEvidenceValue(valueAtPath(pack, field)));
    return {
      platform,
      status: missingFields.length ? "fail" : "pass",
      native_role: pack.native_role || null,
      duration_strategy: pack.duration_strategy || pack.pacing || null,
      cta_style: pack.cta_style || null,
      link_strategy: pack.link_strategy || pack.link_routing_strategy || null,
      required_fields: requiredFields,
      missing_fields: missingFields,
      copy_fingerprint: copyFingerprintForPlatform(platform, pack),
    };
  });
  const blindDuplicatePairs = detectBlindDuplicatePairs(outputs);
  const qualityFailures = platformNativeQualityFailures(outputs);
  const failures = [
    ...platforms
      .filter((item) => item.status !== "pass")
      .map((item) => ({
        platform: item.platform,
        reason: "missing_native_fields",
        missing_fields: item.missing_fields,
      })),
    ...blindDuplicatePairs.map((item) => ({
      platform: item.platforms.join("+"),
      reason: item.reason,
    })),
    ...qualityFailures,
  ];
  return {
    schema_version: 1,
    verdict: failures.length ? "fail" : "pass",
    format_signature: buildPlatformFormatSignature(outputs, options),
    format_family: options.formatFamily || "source_brief",
    platforms,
    blind_duplicate_pairs: blindDuplicatePairs,
    failures,
    rule: "Each platform pack must carry its own role, copy shape, CTA and link strategy.",
  };
}

function buildLandingPageManifest({
  story = {},
  canonical = {},
  enterpriseLandingPage = {},
  affiliateManifest = {},
} = {}) {
  const route =
    affiliateManifest.landing_page_route ||
    enterpriseLandingPage.landing_page_route ||
    enterpriseLandingPage.route ||
    landingRouteFor(story, canonical, enterpriseLandingPage);
  const slug =
    affiliateManifest.landing_page_slug ||
    enterpriseLandingPage.landing_page_slug ||
    enterpriseLandingPage.slug ||
    route.replace(/^\/p\//, "");

  return {
    ...enterpriseLandingPage,
    schema_version: enterpriseLandingPage.schema_version || 1,
    story_id: story.id || story.story_id || affiliateManifest.story_id || null,
    landing_page_slug: slug,
    landing_page_route: route,
    link_pack: {
      primary_link: affiliateManifest.primary_link || null,
      fallback_links: asArray(affiliateManifest.fallback_links),
      source_links: asArray(affiliateManifest.source_links),
      affiliate_tracking_map: affiliateManifest.affiliate_tracking_map || null,
    },
    disclosure_block: {
      required: Boolean(affiliateManifest.disclosure_required),
      copy: affiliateManifest.disclosure_copy || null,
      source_first: true,
    },
    tracking_utm: affiliateManifest.tracking_utm || null,
    attribution_manifest: affiliateManifest.landing_page_attribution || null,
    revenue_tracking: affiliateManifest.revenue_attribution || null,
    safety: {
      ...(enterpriseLandingPage.safety || {}),
      story_page_before_offer: true,
      no_direct_social_posting: true,
    },
  };
}

async function writeLocalProofMp4(filePath, pack = {}) {
  await fs.ensureDir(path.dirname(filePath));
  const subject = compactRenderText(
    pack.canonical_story_manifest?.canonical_subject || pack.story_id,
    "PULSE GAMING",
  );
  const headline = compactRenderText(
    pack.canonical_story_manifest?.thumbnail_headline ||
      pack.canonical_story_manifest?.selected_title ||
      pack.story_id,
    "SOURCE-BACKED STORY",
  );
  const source = compactRenderText(
    pack.canonical_story_manifest?.primary_source?.name ||
      pack.source_manifest?.primary_source?.name ||
      "VERIFIED SOURCE",
    "VERIFIED SOURCE",
  );
  const fontOpt = "fontfile='C\\:/Windows/Fonts/arial.ttf'";
  const filter = [
    "scale=1080:1920",
    "format=yuv420p",
    "noise=alls=5:allf=t",
    "drawbox=x=0:y=0:w=iw:h=260:color=black@0.55:t=fill",
    "drawbox=x=60:y=690:w=960:h=250:color=0xFF6B1A@0.90:t=fill",
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(subject)}':fontcolor=0xFF6B1A:fontsize=52:x=64:y=72`,
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(source)}':fontcolor=white:fontsize=34:x=64:y=148`,
    `drawtext=${fontOpt}:text='${ffmpegDrawtextEscape(headline)}':fontcolor=black:fontsize=64:x=(w-tw)/2:y=770`,
    `drawtext=${fontOpt}:text='PULSE GAMING':fontcolor=white@0.72:fontsize=34:x=w-tw-58:y=h-112`,
  ].join(",");
  execFileSync("ffmpeg", [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=0x101114:size=1080x1920:rate=30:duration=2.4",
    "-vf",
    filter,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "28",
    "-movflags",
    "+faststart",
    filePath,
  ]);
  return filePath;
}

function materialisedEvidenceRows(evidence = {}) {
  return [
    ...asArray(evidence.clips),
    ...asArray(evidence.materialised_clips),
    ...asArray(evidence.materialized_clips),
    ...asArray(evidence.materialised_motion_clips),
    ...asArray(evidence.materialized_motion_clips),
  ].filter((clip) => clip && clip.counts_towards_motion_readiness !== false);
}

function footageInventoryBlockers(footageInventory = {}) {
  return [
    ...new Set([
      ...asArray(footageInventory.blockers),
      ...asArray(footageInventory.hard_failures),
      ...asArray(footageInventory.readiness?.blockers),
    ].map(cleanText).filter(Boolean)),
  ];
}

function footagePublishReasonCodes(footageInventory = {}) {
  const status = cleanText(footageInventory.readiness?.status).toLowerCase();
  const specific = footageInventoryBlockers(footageInventory)
    .map((blocker) => `footage:${blocker}`);
  if (status === "v4_motion_blocked") {
    specific.unshift("footage:v4_motion_blocked");
  }
  return [...new Set(
    specific.length ? specific : [`footage:${status || "unknown"}`],
  )];
}

function materialisedEvidenceClearsStaleFootageBlocker(footageInventory = {}, evidence = {}) {
  const readiness = footageInventory.readiness || {};
  const status = cleanText(readiness.status).toLowerCase();
  const blockers = footageInventoryBlockers(footageInventory);
  const genuineBaseSourceBlockers = new Set([
    "distinct_motion_source_assets_minimum_not_met",
    "genuine_base_source_minimum_not_met",
  ]);
  if (blockers.some((blocker) => genuineBaseSourceBlockers.has(blocker))) {
    return false;
  }
  if (status === "v4_motion_ready") return blockers.length === 0;
  if (status !== "v4_motion_blocked") return false;
  const staleWindowFamilyBlockers = new Set([
    "distinct_motion_families_minimum_not_met",
    "direct_video_motion_families_minimum_not_met",
  ]);
  if (!blockers.length || blockers.some((blocker) => !staleWindowFamilyBlockers.has(blocker))) {
    return false;
  }
  const clips = materialisedEvidenceRows(evidence);
  const families = [
    ...new Set([
      ...asArray(evidence.distinct_motion_families).map(cleanText),
      ...clips.map((clip) => cleanText(clip.source_family || clip.motion_family || clip.family)),
    ].filter(Boolean)),
  ];
  const directFamilies = [
    ...new Set(clips
      .filter((clip) => {
        const mediaKind = cleanText(clip.media_kind || clip.kind || clip.type).toLowerCase();
        const source = cleanText(clip.source_url || clip.source || clip.path);
        return (
          /direct|video|motion|trailer|gameplay/i.test(mediaKind) ||
          /\.(?:mp4|mov|m4v|webm|m3u8)(?:[?#]|$)/i.test(source) ||
          /^https?:/i.test(source)
        );
      })
      .map((clip) => cleanText(clip.source_family || clip.motion_family || clip.family))
      .filter(Boolean)),
  ];
  const requiredClips = Number(footageInventory.motion_budget?.required_motion_scenes || 5);
  const requiredFamilies = Number(footageInventory.motion_budget?.required_distinct_families || 4);
  const clipCount = Number(evidence.clip_count || clips.length || 0);
  const familyCount = Number(evidence.distinct_motion_family_count || families.length || 0);
  const directFamilyCount = Number(evidence.direct_video_motion_family_count || directFamilies.length || familyCount || 0);
  const evidenceStatus = cleanText(evidence.status || evidence.verdict || evidence.result).toLowerCase();
  const statusAllows = !evidenceStatus || ["ready", "pass", "green"].includes(evidenceStatus);
  return statusAllows &&
    clipCount >= requiredClips &&
    familyCount >= requiredFamilies &&
    directFamilyCount >= requiredFamilies;
}

function buildAcceptanceEntry({
  story,
  scriptScorecard,
  footageInventory,
  directorBeatMap,
  benchmarkReport,
  governanceReport,
  platformNativeEvidence,
  mediaHouseScore,
  finalPublishBlockers = [],
  materialisedMotionEvidence = {},
} = {}) {
  const blockers = [];
  if (governanceReport.publish_control_tower?.verdict !== "GREEN") {
    blockers.push(`governance:${governanceReport.publish_control_tower?.verdict || "unknown"}`);
  }
  if (scriptScorecard.verdict === "rewrite_required" || asArray(scriptScorecard.blockers).length) {
    blockers.push(`script:${scriptScorecard.verdict || "blocked"}`);
  }
  if (!materialisedEvidenceClearsStaleFootageBlocker(footageInventory, materialisedMotionEvidence)) {
    blockers.push(...footagePublishReasonCodes(footageInventory));
  }
  if (directorBeatMap.readiness?.status !== "director_ready") {
    blockers.push(`director:${directorBeatMap.readiness?.status || "unknown"}`);
  }
  if (!["pass"].includes(benchmarkReport.result)) {
    blockers.push(`benchmark:${benchmarkReport.result || "unknown"}`);
  }
  blockers.push(...platformNativeBlockers(platformNativeEvidence));
  blockers.push(...mediaHouseBlockers(mediaHouseScore));
  blockers.push(...asArray(finalPublishBlockers));
  return {
    story_id: story.id || null,
    verdict: blockers.length ? "RED" : "GREEN",
    blockers: [...new Set(blockers)],
    artefacts: ACCEPTANCE_ARTEFACTS,
    video_clips: normaliseAcceptanceMotionClips(story.video_clips),
    visual_v4_bridge_video_clips: normaliseAcceptanceMotionClips(story.visual_v4_bridge_video_clips),
    visual_v4_local_motion_clips: normaliseAcceptanceMotionClips(story.visual_v4_local_motion_clips),
  };
}

function blockerToken(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function platformNativeBlockers(platformNativeEvidence = {}) {
  if (!platformNativeEvidence || typeof platformNativeEvidence !== "object") return [];
  const failures = asArray(platformNativeEvidence.failures)
    .map((failure) => {
      const platform = blockerToken(failure.platform || "unknown_platform");
      const reason = blockerToken(failure.reason || "native_pack_failed");
      return platform && reason ? `platform_native:${platform}:${reason}` : "";
    })
    .filter(Boolean);
  if (failures.length) return [...new Set(failures)];
  if (cleanText(platformNativeEvidence.verdict).toLowerCase() === "fail") {
    return ["platform_native:fail"];
  }
  return [];
}

function mediaHouseBlockers(mediaHouseScore = {}) {
  if (!mediaHouseScore || typeof mediaHouseScore !== "object") return [];
  const failures = asArray(mediaHouseScore.hard_failures)
    .map(cleanText)
    .filter(Boolean);
  if (failures.length) return [...new Set(failures)];
  if (cleanText(mediaHouseScore.verdict).toUpperCase() === "RED") return ["media_house:score_red"];
  return [];
}

function audioQualityBlockers(audioManifest = {}) {
  const blockers = [];
  const approvedVoicePath =
    audioManifest.approved_voice_path ||
    audioManifest.approvedVoicePath ||
    audioManifest.voice_path ||
    audioManifest.voicePath ||
    audioManifest.narration?.approved_voice_path ||
    audioManifest.narration?.approvedVoicePath ||
    {};
  const narration = audioManifest.narration || {};
  const generation = audioManifest.generation || narration.generation || {};
  const tempoStretch =
    audioManifest.tempo_stretch ||
    audioManifest.tempoStretch ||
    generation.tempo_stretch ||
    generation.tempoStretch ||
    {};

  blockers.push(
    ...asArray(audioManifest.blockers),
    ...asArray(audioManifest.audio_blockers),
    ...asArray(audioManifest.quality_blockers),
    ...asArray(narration.blockers),
    ...asArray(approvedVoicePath.blockers),
  );

  const voiceVerdict = cleanText(approvedVoicePath.verdict || approvedVoicePath.status).toLowerCase();
  if (
    voiceVerdict &&
    /(?:rejected|red|fail|failed|blocked)/.test(voiceVerdict) &&
    !asArray(approvedVoicePath.blockers).length
  ) {
    blockers.push("approved_voice_path_not_approved");
  }
  if (tempoStretch.applied === true) blockers.push("local_tts_tempo_stretch_applied");

  const rate =
    Number(generation.rate) ||
    Number(generation.speaking_rate) ||
    Number(narration.meta?.voiceSettings?.speaking_rate) ||
    Number(audioManifest.meta?.voiceSettings?.speaking_rate) ||
    Number(narration.meta?.elevenlabs?.speakingRate) ||
    Number(narration.meta?.elevenlabs?.speaking_rate) ||
    Number(audioManifest.meta?.elevenlabs?.speakingRate) ||
    Number(audioManifest.meta?.elevenlabs?.speaking_rate);
  if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 0.001) {
    blockers.push("tts_non_native_rate_applied");
  }

  return [...new Set(blockers.map(cleanText).filter(Boolean))];
}

function finalPublishEvidenceBlockers({ story = {}, audioManifest = {} } = {}) {
  const blockers = [];
  const renderManifest = story.render_manifest || story.renderManifest || {};
  const finalPublishRender =
    renderManifest.final_publish_render === true ||
    renderManifest.finalPublishRender === true ||
    story.final_publish_render === true ||
    story.finalPublishRender === true ||
    story.final_publish_render_ready === true;
  const exportedPath = cleanText(
    story.exported_path ||
      story.exportedPath ||
      renderManifest.output_path ||
      renderManifest.outputPath ||
      renderManifest.video_path ||
      renderManifest.videoPath,
  );
  if (!finalPublishRender || !exportedPath) blockers.push("render:final_publish_render_missing");
  if (
    finalPublishRender &&
    (
      cleanText(renderManifest.quality_gate_status) !== "post_render_forensics_passed" ||
      cleanText(renderManifest.post_render_forensic_result) !== "pass"
    )
  ) {
    blockers.push(
      "render:post_render_forensics_missing",
      ...asArray(renderManifest.post_render_forensic_blockers),
      ...asArray(renderManifest.post_render_forensics?.blockers),
      ...asArray(renderManifest.quality_gate_blockers),
      ...asArray(renderManifest.blockers),
    );
  }
  const renderedDuration = Number(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_seconds ||
      renderManifest.duration_s ||
      renderManifest.duration,
  );
  if (finalPublishRender && Number.isFinite(renderedDuration) && renderedDuration > 0 && renderedDuration < 35) {
    blockers.push(`normal_production_duration_below_quality_floor:${Number(renderedDuration.toFixed(3))}`);
  }

  const narrationAudioPath = cleanText(
    audioManifest.narration_audio_path ||
      audioManifest.audio_path ||
      audioManifest.approved_audio_path ||
      audioManifest.narration?.audio_path ||
      audioManifest.narration?.path ||
      story.narration_audio_path ||
      story.audio_path,
  );
  if (!narrationAudioPath) blockers.push("audio:narration_audio_missing");
  const voiceStatus = cleanText(audioManifest.voice_status || story.voice_status || story.audio_status).toLowerCase();
  if (narrationAudioPath && !["ready", "materialized", "materialized_existing_pair"].includes(voiceStatus)) {
    blockers.push("audio:voice_not_materialized");
  }

  const timestampPath = cleanText(
    audioManifest.word_timestamps_path ||
      audioManifest.timestamps_path ||
      audioManifest.resolved_word_timestamps_path ||
      audioManifest.narration?.word_timestamps_path ||
      story.word_timestamps_path ||
      story.timestamps_path ||
      story.resolved_word_timestamps_path,
  );
  const wordTimestamps = asArray(
    audioManifest.word_timestamps ||
      audioManifest.narration?.word_timestamps ||
      story.word_timestamps,
  );
  if (!timestampPath && wordTimestamps.length < 3) {
    blockers.push("captions:word_timestamps_missing");
  }

  const timestampSource = cleanText(
    audioManifest.word_timestamp_source ||
      audioManifest.timestamp_source ||
      audioManifest.narration?.word_timestamp_source ||
      story.word_timestamp_source ||
      story.timestamp_source,
  ).toLowerCase();
  if ((timestampPath || wordTimestamps.length >= 3) && !/local_whisper|whisper_word|word_alignment/.test(timestampSource)) {
    blockers.push("captions:word_timestamp_source_not_verified");
  }
  const wordTimestampCount = Number(
    audioManifest.word_timestamp_count ||
      audioManifest.narration?.word_timestamp_count ||
      story.word_timestamp_count ||
      wordTimestamps.length,
  );
  if ((timestampPath || wordTimestamps.length >= 3) && (!Number.isFinite(wordTimestampCount) || wordTimestampCount <= 0)) {
    blockers.push("captions:word_timestamp_count_missing");
  }

  return [...new Set(blockers.filter(Boolean))];
}

function buildPackagePublishVerdict({
  publishControlTower = {},
  scriptScorecard = {},
  audioManifest = {},
  footageInventory = {},
  directorBeatMap = {},
  benchmarkReport = {},
  platformNativeEvidence = {},
  mediaHouseScore = {},
  finalPublishBlockers = [],
  materialisedMotionEvidence = {},
} = {}) {
  const base = publishControlTower && typeof publishControlTower === "object"
    ? { ...publishControlTower }
    : {};
  const reasonCodes = asArray(base.reason_codes);
  const warnings = asArray(base.warnings);
  const scriptVerdict = cleanText(scriptScorecard.verdict || scriptScorecard.status).toLowerCase();
  const scriptBlockers = asArray(scriptScorecard.blockers);
  const viralScore = Number(scriptScorecard.viral_score ?? scriptScorecard.score ?? scriptScorecard.total);
  const blockers = [];

  if (scriptVerdict && !["viral_ready", "pass", "green"].includes(scriptVerdict)) {
    blockers.push(`script_scorecard:script_verdict_${scriptVerdict}`);
  }
  for (const blocker of scriptBlockers) {
    blockers.push(`script_scorecard:${cleanText(blocker)}`);
  }
  if (Number.isFinite(viralScore) && viralScore < 75) {
    blockers.push("script_scorecard:script_score_below_threshold");
  }
  for (const blocker of audioQualityBlockers(audioManifest)) {
    blockers.push(`audio:${blocker}`);
  }
  if (!materialisedEvidenceClearsStaleFootageBlocker(footageInventory, materialisedMotionEvidence)) {
    blockers.push(...footagePublishReasonCodes(footageInventory));
  }
  if (directorBeatMap.readiness?.status !== "director_ready") {
    blockers.push(`director:${directorBeatMap.readiness?.status || "unknown"}`);
  }
  if (!["pass"].includes(benchmarkReport.result)) {
    blockers.push(`benchmark:${benchmarkReport.result || "unknown"}`);
  }
  blockers.push(...platformNativeBlockers(platformNativeEvidence));
  blockers.push(...mediaHouseBlockers(mediaHouseScore));
  blockers.push(...asArray(finalPublishBlockers));

  const uniqueBlockers = [...new Set(blockers.filter(Boolean))];
  if (!uniqueBlockers.length) {
    return {
      ...base,
      verdict: base.verdict || "GREEN",
      can_auto_publish: base.can_auto_publish !== false,
      reason_codes: reasonCodes,
      warnings,
    };
  }

  return {
    ...base,
    verdict: "RED",
    can_auto_publish: false,
    blockers: [...new Set([...asArray(base.blockers), ...uniqueBlockers])],
    reason_codes: [...new Set([...reasonCodes, ...uniqueBlockers])],
    warnings: [...new Set([...warnings, "package_quality_blocks_publish"])],
    package_quality_gate: {
      verdict: scriptScorecard.verdict || null,
      viral_score: Number.isFinite(viralScore) ? viralScore : null,
      blockers: uniqueBlockers,
    },
  };
}

function buildGoalProofPackage({
  story = {},
  rightsLedger = [],
  platforms,
  generatedAt = new Date().toISOString(),
} = {}) {
  const scriptScorecard = buildViralScriptIntelligence({
    story,
    script: story.full_script || story.tts_script || "",
  });
  const footageInventory = buildFootageEmpirePlan({
    story,
    trustedFootageReport: buildTrustedFootageReport(story),
    localMotionClips: buildLocalMotionClips(story),
    generatedAt,
  });
  const directorBeatMap = buildVisualV4DirectorPlan({
    story,
    footagePlan: footageInventory,
    localTimeline: buildLocalTimeline(story),
    sfxAssetInventory: story.sfx_asset_inventory || story.sfx_assets || [],
    sfxRightsLedger: story.sfx_rights_ledger || rightsLedger,
    generatedAt,
  });
  const soundPlan = directorBeatMap.sound_transition_plan || {};
  const initialGovernanceReport = buildStudioGovernanceReport({
    story,
    rightsLedger,
    ...(Array.isArray(platforms) && platforms.length ? { platforms } : {}),
    generatedAt,
  });
  const benchmarkReport = directorBeatMap.media_house_benchmark || {};
  const sourceManifest = objectHasKeys(initialGovernanceReport.source_manifest)
    ? initialGovernanceReport.source_manifest
    : buildFallbackSourceManifest(story, generatedAt);
  const claimInventory = objectHasKeys(initialGovernanceReport.claim_inventory)
    ? initialGovernanceReport.claim_inventory
    : buildFallbackClaimInventory(story);
  const canonicalStoryManifest = canonicalAttentionCopy(initialGovernanceReport.canonical_story_manifest, story);
  const finalCoherenceReport = runGovernancePublicOutputGate(
    {
      ...story,
      public_title: canonicalStoryManifest.public_title,
      suggested_title: canonicalStoryManifest.selected_title,
      title: canonicalStoryManifest.title,
      suggested_thumbnail_text: canonicalStoryManifest.thumbnail_headline,
      thumbnail_text: canonicalStoryManifest.thumbnail_headline,
      description: canonicalStoryManifest.description,
      public_description: canonicalStoryManifest.public_description,
      first_spoken_line: canonicalStoryManifest.first_spoken_line,
      full_script: canonicalStoryManifest.narration_script,
      tts_script: canonicalStoryManifest.tts_script,
    },
    canonicalStoryManifest,
  );
  const governanceReport = governanceReportWithFinalCoherence(
    initialGovernanceReport,
    finalCoherenceReport,
  );
  const enterprisePack = buildStudioEnterpriseOSPack({
    generatedAt,
    stories: [story],
    governanceSummary: governanceReport.publish_manifest,
  });
  const platformOutputs = enterprisePack.multi_platform_format_engine.outputs || {};
  const affiliateManifest = materialiseGovernedCommercialEvidence({
    story,
    affiliateManifest: story.affiliate_link_manifest || {},
    landingPage: enterprisePack.landing_page_link_hub || {},
  });
  const landingPageManifest = buildLandingPageManifest({
    story,
    canonical: canonicalStoryManifest,
    enterpriseLandingPage: enterprisePack.landing_page_link_hub || {},
    affiliateManifest,
  });
  const platformNativePacks = buildPlatformNativePublishPacks({
    story,
    canonical: canonicalStoryManifest,
    platformOutputs,
    affiliateManifest,
    landingPage: landingPageManifest,
  });
  const audioManifest = buildAudioManifest({ story, soundPlan });
  const expectedStoryId = story.id || canonicalStoryManifest.story_id || null;
  const narrationManifest = objectHasKeys(story.narration_manifest)
    ? {
        ...story.narration_manifest,
        schema_version: 1,
        story_id: expectedStoryId,
      }
    : {};
  const visualQualityReport = buildVisualQualityReport({
    story: {
      ...story,
      ...canonicalStoryManifest,
      id: story.id || canonicalStoryManifest.story_id,
    },
    directorPlan: directorBeatMap,
    benchmark: benchmarkReport,
  });
  const materialisedMotionEvidence = materialisedMotionEvidenceForPack({
    story_id: story.id || canonicalStoryManifest.story_id,
    footage_inventory: footageInventory,
  });
  const storyRenderManifest = objectHasKeys(story.render_manifest)
    ? story.render_manifest
    : objectHasKeys(story.renderManifest)
      ? story.renderManifest
      : {};
  const suppliedCaptionManifest =
    story.caption_manifest ||
    story.captionManifest ||
    story.caption_qa ||
    story.captionQa ||
    {};
  const captionEvidenceVerified =
    ["pass", "ready", "green"].includes(
      cleanText(suppliedCaptionManifest.status || suppliedCaptionManifest.verdict).toLowerCase(),
    ) &&
    suppliedCaptionManifest.checks?.caption_file_verified === true &&
    suppliedCaptionManifest.checks?.display_script_verified === true &&
    suppliedCaptionManifest.checks?.display_alignment_exact === true;
  const captionManifest = objectHasKeys(suppliedCaptionManifest)
    ? {
        ...suppliedCaptionManifest,
        schema_version: 1,
        story_id: expectedStoryId,
      }
    : {
        schema_version: 1,
        story_id: story.id || canonicalStoryManifest.story_id || null,
        status: "missing",
        verdict: "RED",
        checks: {
          caption_file_verified: false,
          display_script_verified: false,
          display_alignment_exact: false,
        },
      };
  const captionQa = captionEvidenceVerified
    ? {
        ...captionManifest,
        display_text: cleanText(
          captionManifest.display_text ||
            captionManifest.transcript ||
            canonicalStoryManifest.caption_display_text ||
            canonicalStoryManifest.display_script ||
            canonicalStoryManifest.narration_script,
        ),
      }
    : {};
  const pulseMediaHouseScore = buildPulseMediaHouseScore({
    canonical: canonicalStoryManifest,
    scriptScorecard,
    visualQuality: visualQualityReport,
    director: directorBeatMap,
    audio: audioManifest,
    loudness: story.loudness_report || story.loudness || {},
    affiliate: affiliateManifest,
    platformManifest: { outputs: platformNativePacks.outputs },
    uniqueness: governanceReport.anti_spam_uniqueness_gate,
    benchmark: benchmarkReport,
    footageEmpireV2: footageInventory,
    distinctMotionFamily: story.distinct_motion_family_report ||
      story.distinctMotionFamilyReport ||
      story.distinct_motion_family ||
      {},
    materialisedMotionClips: story.materialisedMotionClips ||
      story.materializedMotionClips ||
      story.materialised_motion_clips ||
      story.materialized_motion_clips ||
      materialisedMotionEvidence,
    sourceDiversityTier: story.source_diversity_tier ||
      story.sourceDiversityTier ||
      story.quality_tier ||
      story.qualityTier,
    professionalSourceDiversity: story.professional_source_diversity ||
      story.professionalSourceDiversity ||
      footageInventory.professional_source_diversity ||
      footageInventory.professionalSourceDiversity,
    competitorSimilarity: story.competitor_similarity || story.competitorSimilarity || {},
    renderManifest: storyRenderManifest,
    captionQa,
  });
  const finalPublishBlockers = [
    ...finalPublishEvidenceBlockers({ story, audioManifest }),
    ...asArray(finalCoherenceReport.failures),
    ...lineageConsistencyBlockers({
      expectedStoryId,
      audioManifest: story.audio_manifest || {},
      narrationManifest: story.narration_manifest || {},
      captionManifest: suppliedCaptionManifest,
      renderManifest: storyRenderManifest,
    }),
  ];
  const publishVerdict = buildPackagePublishVerdict({
    publishControlTower: governanceReport.publish_control_tower,
    scriptScorecard,
    audioManifest,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    platformNativeEvidence: platformNativePacks.platformNativeEvidence,
    mediaHouseScore: pulseMediaHouseScore,
    finalPublishBlockers,
    materialisedMotionEvidence,
  });
  const renderManifest = storyRenderManifest.final_publish_render === true
    ? {
        ...storyRenderManifest,
        schema_version: 1,
        story_id: expectedStoryId,
        final_publish_render: true,
      }
    : {
        schema_version: 1,
        story_id: story.id || null,
        renderer: "visual_v4_local_proof",
        output: "visual_v4_render.mp4",
        visual_tier: "local_proof_motion_graphic",
        final_publish_render: false,
        director_beat_map: "director_beat_map.json",
        render_basis: "local proof render generated from governed story manifest",
        no_publish_triggered: true,
      };

  const pack = {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: story.id || null,
    script_scorecard: scriptScorecard,
    footage_inventory: footageInventory,
    director_beat_map: directorBeatMap,
    audio_manifest: audioManifest,
    narration_manifest: narrationManifest,
    caption_manifest: captionManifest,
    sfx_manifest: soundPlan.sfx || {},
    sfx_source_plan: soundPlan.sfx?.source_plan || {},
    visual_quality_report: visualQualityReport,
    forensic_qa_report: buildForensicQaReport({
      scriptScorecard,
      footageInventory,
      directorPlan: directorBeatMap,
      benchmark: benchmarkReport,
      governanceReport,
    }),
    benchmark_report: benchmarkReport,
    pulse_media_house_score: pulseMediaHouseScore,
    professional_source_diversity_report: pulseMediaHouseScore.professional_source_diversity_report,
    canonical_story_manifest: canonicalStoryManifest,
    source_manifest: sourceManifest,
    claim_inventory: claimInventory,
    rights_ledger: governanceReport.rights_ledger,
    coherence_report: finalCoherenceReport,
    platform_policy_report: buildPlatformPolicyReport(governanceReport),
    publish_verdict: publishVerdict,
    render_manifest: renderManifest,
    affiliate_link_manifest: affiliateManifest,
    landing_page_manifest: landingPageManifest,
    analytics_ingest_plan: {
      schema_version: 1,
      story_id: story.id || null,
      required_metrics: [
        "views",
        "average_view_duration",
        "first_3_second_drop_off",
        "stayed_to_watch",
        "swipe_away",
        "follows_or_subscribers_gained",
        "affiliate_clicks",
        "landing_page_visits",
      ],
      dry_run_only: true,
    },
    youtube_publish_pack: platformNativePacks.outputs.youtube_shorts,
    tiktok_publish_pack: platformNativePacks.outputs.tiktok,
    instagram_publish_pack: platformNativePacks.outputs.instagram_reels,
    facebook_publish_pack: platformNativePacks.outputs.facebook_reels,
    x_publish_pack: platformNativePacks.outputs.x,
    threads_publish_pack: platformNativePacks.outputs.threads,
    pinterest_publish_pack: platformNativePacks.outputs.pinterest,
    carousel_manifest: {
      platform: "instagram",
      story_id: story.id || null,
      cards: ["cover", "source", "impact", "related_links"],
    },
    image_card_manifest: {
      story_id: story.id || null,
      platforms: ["x", "instagram", "facebook"],
      headline: story.suggested_thumbnail_text || story.public_title || story.title || null,
    },
    thread_manifest: {
      platform: "x",
      story_id: story.id || null,
      posts: ["hot_take", "source_safe_post", "concise_news_post", "landing_page_post"],
    },
    finance_crypto_risk_report: governanceReport.finance_crypto_firewall,
    uniqueness_report: governanceReport.anti_spam_uniqueness_gate,
    retention_report: {
      schema_version: 1,
      story_id: story.id || null,
      recommendations: scriptScorecard.rewrite_recommendations || [],
      future_render_rules: [
        "keep canonical subject in first frame",
        "keep thumbnail text under mobile limits",
        "route motion deficits to Footage Empire before publish",
      ],
    },
    experiment_manifest: enterprisePack.experimentation_engine,
    platform_publish_manifest: {
      schema_version: 1,
      story_id: story.id || null,
      operating_mode: "LOCAL_PROOF",
      publish_status: publishVerdict.verdict || "RED",
      outputs: platformNativePacks.outputs,
      landing_page_attribution: landingPageManifest.attribution_manifest,
      platform_mirroring_detection:
        enterprisePack.multi_platform_format_engine.platform_mirroring_detection,
      platform_native_evidence: platformNativePacks.platformNativeEvidence,
      no_publish_triggered: true,
    },
    platform_variant_scorecard: {
      ...enterprisePack.multi_platform_format_engine,
      outputs: platformNativePacks.outputs,
      platform_native_evidence: platformNativePacks.platformNativeEvidence,
    },
    safety: {
      local_only: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
      tokens_or_oauth_changed: false,
    },
  };
  pack.acceptance_entry = buildAcceptanceEntry({
    story,
    scriptScorecard,
    footageInventory,
    directorBeatMap,
    benchmarkReport,
    governanceReport,
    platformNativeEvidence: platformNativePacks.platformNativeEvidence,
    mediaHouseScore: pulseMediaHouseScore,
    finalPublishBlockers,
    materialisedMotionEvidence,
  });
  return pack;
}

async function writeJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeJson(filePath, value, { spaces: 2 });
  return filePath;
}

function materialisedMotionClipRowsFromPack(pack = {}) {
  const inventory = pack.footage_inventory || {};
  const motionInventory = inventory.motion_inventory || {};
  return [
    ...asArray(motionInventory.accepted_local_clips),
    ...asArray(motionInventory.production_motion_clips),
    ...asArray(inventory.accepted_local_clips),
    ...asArray(inventory.production_motion_clips),
  ]
    .map((clip) => {
      const localPath = cleanText(clip.local_materialized_path || clip.local_materialised_path || clip.path);
      if (!localPath) return null;
      return {
        ...clip,
        path: localPath,
        local_materialized_path: localPath,
        source_url: cleanText(clip.source_url || clip.source),
        source_family: cleanText(clip.source_family || clip.motion_family || clip.family),
        motion_family: cleanText(clip.motion_family || clip.source_family || clip.family),
        media_kind: cleanText(clip.media_kind || "direct_video"),
        counts_towards_motion_readiness: clip.counts_towards_motion_readiness !== false,
        materialized: true,
      };
    })
    .filter(Boolean);
}

function materialisedMotionEvidenceForPack(pack = {}) {
  const clips = materialisedMotionClipRowsFromPack(pack);
  const readiness = pack.footage_inventory?.readiness || {};
  const distinctFamilies = [
    ...new Set(
      clips
        .map((clip) => cleanText(clip.source_family || clip.motion_family))
        .filter(Boolean),
    ),
  ];
  return {
    schema_version: 1,
    story_id: pack.story_id || null,
    status: clips.length ? "ready" : "missing",
    clip_count: clips.length,
    distinct_motion_family_count: distinctFamilies.length,
    distinct_motion_families: distinctFamilies,
    clips,
    materialised_clips: clips,
    readiness: {
      status: cleanText(readiness.status || (clips.length ? "motion_ready" : "motion_missing")),
      blockers: asArray(readiness.blockers).map(cleanText),
      warnings: asArray(readiness.warnings).map(cleanText),
    },
    source: "goal_proof_package_footage_inventory",
    local_only: true,
  };
}

async function writeGoalProofPackageArtifacts(pack = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalProofPackageArtifacts requires outputDir");
  const outDir = path.resolve(outputDir);
  const canonical = pack.canonical_story_manifest || {};
  const sourceManifest = pack.source_manifest || {};
  const story = {
    ...canonical,
    id: pack.story_id || canonical.story_id || null,
    story_id: pack.story_id || canonical.story_id || null,
    primary_source: canonical.primary_source || sourceManifest.primary_source || null,
    article_url: sourceManifest.primary_source?.url || null,
  };
  const affiliateManifest = materialiseGovernedCommercialEvidence({
    story,
    canonical,
    affiliateManifest: pack.affiliate_link_manifest || {},
    landingPage: pack.landing_page_manifest || {},
  });
  const landingPageManifest = buildLandingPageManifest({
    story,
    canonical,
    enterpriseLandingPage: pack.landing_page_manifest || {},
    affiliateManifest,
  });
  const finalRenderPath = path.join(outDir, "visual_v4_render.mp4");
  const declaredFinalRenderPath = cleanText(
    pack.render_manifest?.output_path ||
      pack.render_manifest?.output ||
      pack.render_manifest?.final_video_path,
  );
  const resolvedDeclaredFinalRenderPath = declaredFinalRenderPath
    ? (path.isAbsolute(declaredFinalRenderPath)
        ? path.resolve(declaredFinalRenderPath)
        : path.resolve(declaredFinalRenderPath))
    : "";
  let materialisedPack = {
    ...pack,
    affiliate_link_manifest: affiliateManifest,
    landing_page_manifest: landingPageManifest,
    platform_publish_manifest: {
      ...(pack.platform_publish_manifest || {}),
      landing_page_attribution: affiliateManifest.landing_page_attribution,
    },
    render_manifest: {
      ...(pack.render_manifest || {}),
      ...(declaredFinalRenderPath && declaredFinalRenderPath !== finalRenderPath
        ? { source_output_path: declaredFinalRenderPath }
        : {}),
      output_path: finalRenderPath,
      output: finalRenderPath,
    },
  };
  const mapping = {
    canonical_story_manifest: "canonical_story_manifest.json",
    source_manifest: "source_manifest.json",
    claim_inventory: "claim_inventory.json",
    script_scorecard: "script_scorecard.json",
    footage_inventory: "footage_inventory.json",
    rights_ledger: "rights_ledger.json",
    director_beat_map: "director_beat_map.json",
    render_manifest: "render_manifest.json",
    audio_manifest: "audio_manifest.json",
    narration_manifest: "narration_manifest.json",
    caption_manifest: "caption_manifest.json",
    sfx_manifest: "sfx_manifest.json",
    sfx_source_plan: "sfx_source_plan.json",
    visual_quality_report: "visual_quality_report.json",
    forensic_qa_report: "forensic_qa_report.json",
    benchmark_report: "benchmark_report.json",
    coherence_report: "coherence_report.json",
    platform_policy_report: "platform_policy_report.json",
    pulse_media_house_score: "pulse_media_house_score.json",
    professional_source_diversity_report: "professional_source_diversity_report.json",
    affiliate_link_manifest: "affiliate_link_manifest.json",
    landing_page_manifest: "landing_page_manifest.json",
    publish_verdict: "publish_verdict.json",
    analytics_ingest_plan: "analytics_ingest_plan.json",
    youtube_publish_pack: "youtube_publish_pack.json",
    tiktok_publish_pack: "tiktok_publish_pack.json",
    instagram_publish_pack: "instagram_publish_pack.json",
    facebook_publish_pack: "facebook_publish_pack.json",
    x_publish_pack: "x_publish_pack.json",
    threads_publish_pack: "threads_publish_pack.json",
    pinterest_publish_pack: "pinterest_publish_pack.json",
    carousel_manifest: "carousel_manifest.json",
    image_card_manifest: "image_card_manifest.json",
    thread_manifest: "thread_manifest.json",
    finance_crypto_risk_report: "finance_crypto_risk_report.json",
    uniqueness_report: "uniqueness_report.json",
    retention_report: "retention_report.json",
    experiment_manifest: "experiment_manifest.json",
    platform_publish_manifest: "platform_publish_manifest.json",
    platform_variant_scorecard: "platform_variant_scorecard.json",
    acceptance_entry: "goal_package_summary.json",
  };
  const written = {};
  for (const [key, basename] of Object.entries(mapping)) {
    written[key] = await writeJson(path.join(outDir, basename), materialisedPack[key] || {});
  }
  written.materialised_motion_clips = await writeJson(
    path.join(outDir, "materialised_motion_clips.json"),
    materialisedMotionEvidenceForPack(materialisedPack),
  );
  written.captions = await fs.writeFile(
    path.join(outDir, "captions.srt"),
    buildSimpleCaptionSrt(
      materialisedPack.canonical_story_manifest?.narration_script ||
        materialisedPack.canonical_story_manifest?.first_spoken_line ||
        "",
    ),
    "utf8",
  ).then(() => path.join(outDir, "captions.srt"));
  if (materialisedPack.render_manifest?.final_publish_render === true && await fs.pathExists(finalRenderPath)) {
    written.visual_v4_render = finalRenderPath;
  } else if (
    materialisedPack.render_manifest?.final_publish_render === true &&
    resolvedDeclaredFinalRenderPath &&
    resolvedDeclaredFinalRenderPath !== finalRenderPath &&
    await fs.pathExists(resolvedDeclaredFinalRenderPath)
  ) {
    await fs.copy(resolvedDeclaredFinalRenderPath, finalRenderPath, { overwrite: false });
    written.visual_v4_render = finalRenderPath;
  } else {
    written.visual_v4_render = await writeLocalProofMp4(finalRenderPath, materialisedPack);
  }
  const cutoverGate = buildPublishCutoverGate([{
    ...(materialisedPack.acceptance_entry || {}),
    story_id: materialisedPack.story_id,
    artifact_dir: outDir,
  }]);
  const cutoverRow = asArray(cutoverGate.story_results)[0] || {};
  written.materialised_cutover_verification = await writeJson(
    path.join(outDir, "materialised_cutover_verification.json"),
    {
      schema_version: 1,
      story_id: materialisedPack.story_id,
      final_publish_render: cutoverRow.final_publish_render === true,
      final_render_path: cutoverRow.final_render_path || finalRenderPath,
      final_render_sha256: cutoverRow.final_render_sha256 || null,
      duration_seconds: cutoverRow.duration_seconds || null,
      video_codec: cutoverRow.video_codec || null,
      blockers: asArray(cutoverRow.blockers).map(cleanText).filter(Boolean),
      verified_by: "goal_contract_publish_cutover_gate",
      no_publish_triggered: true,
    },
  );
  if (cutoverRow.final_publish_render !== true) {
    const materialisationBlockers = [
      ...new Set(
        asArray(cutoverRow.blockers)
          .map(cleanText)
          .filter(Boolean),
      ),
    ];
    const authoritativeBlockers = materialisationBlockers.map((blocker) =>
      blocker.startsWith("final_render") || blocker.startsWith("render_")
        ? `render:${blocker}`
        : `control:${blocker}`,
    );
    materialisedPack = {
      ...materialisedPack,
      render_manifest: {
        ...materialisedPack.render_manifest,
        final_publish_render: false,
        quality_gate_status: "materialised_final_verification_failed",
        materialisation_blockers: materialisationBlockers,
        materialised_cutover_verification: "materialised_cutover_verification.json",
      },
      forensic_qa_report: {
        ...(materialisedPack.forensic_qa_report || {}),
        verdict: "blocked_or_rewrite_required",
        blockers: [
          ...new Set([
            ...asArray(materialisedPack.forensic_qa_report?.blockers),
            ...authoritativeBlockers,
          ]),
        ],
      },
      platform_publish_manifest: {
        ...(materialisedPack.platform_publish_manifest || {}),
        can_auto_publish: false,
        publish_status: "RED",
        blockers: [
          ...new Set([
            ...asArray(materialisedPack.platform_publish_manifest?.blockers),
            ...authoritativeBlockers,
          ]),
        ],
      },
      publish_verdict: {
        ...(materialisedPack.publish_verdict || {}),
        verdict: "RED",
        can_auto_publish: false,
        reason_codes: [
          ...new Set([
            ...asArray(materialisedPack.publish_verdict?.reason_codes),
            ...authoritativeBlockers,
          ]),
        ],
      },
      acceptance_entry: {
        ...(materialisedPack.acceptance_entry || {}),
        verdict: "RED",
        blockers: [
          ...new Set([
            ...asArray(materialisedPack.acceptance_entry?.blockers),
            ...authoritativeBlockers,
          ]),
        ],
      },
    };
    for (const key of [
      "render_manifest",
      "forensic_qa_report",
      "platform_publish_manifest",
      "publish_verdict",
      "acceptance_entry",
    ]) {
      written[key] = await writeJson(path.join(outDir, mapping[key]), materialisedPack[key]);
    }
  }
  return written;
}

module.exports = {
  ACCEPTANCE_ARTEFACTS,
  buildPackagePublishVerdict,
  buildPlatformNativeEvidence,
  buildPlatformNativePublishPacks,
  finalPublishEvidenceBlockers,
  buildGoalProofPackage,
  materialiseGovernedCommercialEvidence,
  writeGoalProofPackageArtifacts,
};
