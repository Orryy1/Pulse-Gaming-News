"use strict";

const { buildSubjectGraph } = require("./exact-subject-matching");
const {
  officialMediaReferenceRejectReason,
} = require("./official-media-reference-preflight");
const {
  mediaSourceUrlKindFields,
} = require("./media-source-url-kind");
const { canonicalUrl } = require("./services/url-canonical");
const { normaliseText } = require("./text-hygiene");

const ALLOWED_SOURCE_TYPES = new Set([
  "official_publisher_or_developer_trailer_page",
  "official_game_website_media_page",
  "official_game_site_news_page",
  "platform_storefront",
  "platform_storefront_video_reference",
  "official_platform_product_page",
  "steam_storefront_video_reference",
  "igdb_video_reference",
  "official_youtube_channel_url",
  "official_social_media_video",
  "official_press_kit_stills",
]);

const VIDEO_PLATFORM_SOURCE_TYPES = new Set(["official_youtube_channel_url", "official_social_media_video"]);

const SOCIAL_OR_REPOST_SOURCE_TYPES = new Set([
  "social_media_repost",
  "fan_reupload",
  "random_youtube_reupload",
  "youtube_compilation",
  "reaction_video",
  "browser_scrape",
]);

const SOCIAL_OR_REPOST_HOST_RE =
  /(?:^|\.)((tiktok|instagram|facebook|threads|x|twitter|reddit)\.com|youtu\.be)$/i;

const RAW_IMAGE_HOST_RE = /^(?:i\.redd\.it|preview\.redd\.it|i\.imgur\.com|imgur\.com)$/i;

const OFFICIAL_SOCIAL_REFERENCE_HOST_RE = /(?:^|\.)((x|twitter)\.com)$/i;
const OFFICIAL_SOCIAL_DIRECT_MEDIA_HOST_RE = /^(?:video|video-s)\.twimg\.com$/i;

const REUPLOAD_RE =
  /\b(?:reupload|fan upload|compilation|reaction|tiktok|reel|shorts|unofficial|not official|mirror)\b/i;

const REASON_PRIORITY = new Map(
  [
    "official_evidence_required_for_video_platform",
    "entity_evidence_missing_or_wrong",
    "social_or_repost_source_forbidden",
    "official_social_reference_url_required",
    "official_social_direct_media_required",
    "official_social_direct_media_host_not_allowed",
    "invalid_direct_media_url",
    "direct_media_field_contains_page_url",
    "duplicate_source_url",
  ].map((reason, index) => [reason, index]),
);

function normaliseLabel(value) {
  return normaliseText(String(value || ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compactLabel(value) {
  return normaliseLabel(value).replace(/\s+/g, "");
}

function cleanText(value) {
  return normaliseText(String(value || "")).replace(/\s+/g, " ").trim();
}

function storyId(story) {
  return String(story?.id || story?.story_id || story?.storyId || "").trim();
}

function buildStoryMap(stories) {
  const map = new Map();
  for (const story of Array.isArray(stories) ? stories : []) {
    const id = storyId(story);
    if (id) map.set(id, story);
  }
  return map;
}

function parseHttpUrl(value) {
  const text = String(value || "").trim();
  if (!text) return { url: null, reason: "missing_official_source_url" };
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { url: null, reason: "unsupported_url_protocol" };
    }
    return { url: parsed, reason: null };
  } catch {
    return { url: null, reason: "invalid_official_source_url" };
  }
}

function storyEntities(story) {
  try {
    return buildSubjectGraph(story).required_subject_groups || [];
  } catch {
    return [];
  }
}

function entityAppearsInStory(entity, story) {
  const wanted = normaliseLabel(entity);
  if (!wanted) return false;
  if (storyEntities(story).some((candidate) => normaliseLabel(candidate) === wanted)) return true;
  const storyText = [
    story?.canonical_subject,
    story?.canonical_game,
    story?.canonical_company,
    story?.title,
    story?.selected_title,
    story?.full_script,
    story?.narration_script,
  ]
    .filter(Boolean)
    .join(" ");
  const normalisedStory = normaliseLabel(storyText);
  const compactStory = compactLabel(storyText);
  const compactWanted = compactLabel(entity);
  return (
    normalisedStory.includes(wanted) ||
    (compactWanted.length >= 3 && compactStory.includes(compactWanted))
  );
}

function hasEntityEvidence(entry) {
  const entity = String(entry?.entity || "").trim();
  const combined = [
    entry?.official_source_url,
    entry?.direct_media_url_if_available,
    entry?.source_title,
    entry?.source_owner,
    entry?.source_type,
    entry?.evidence_of_officialness,
    entry?.entity_match_notes,
  ]
    .filter(Boolean)
    .join(" ");
  const normalised = normaliseLabel(combined);
  const compact = compactLabel(combined);
  const entityNormalised = normaliseLabel(entity);
  const entityCompact = compactLabel(entity);
  if (!entityNormalised) return false;
  if (normalised.includes(entityNormalised)) return true;
  if (entityCompact && compact.includes(entityCompact)) return true;

  if (/^gta$/i.test(entity) && normalised.includes("grand theft auto")) return true;
  if (/^red dead$/i.test(entity) && normalised.includes("redemption")) return true;
  return false;
}

function sourceType(entry) {
  return cleanText(entry?.source_type).toLowerCase();
}

function urlHost(parsedUrl) {
  return String(parsedUrl?.hostname || "").toLowerCase().replace(/^www\./, "");
}

function canonicalSourceUrl(entry) {
  return canonicalUrl(sourceUrlForSegmentReference(entry));
}

function referencePageUrl(entry) {
  return cleanText(entry?.official_source_url);
}

function directMediaUrlIfAvailable(entry) {
  return cleanText(entry?.direct_media_url_if_available);
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(2)) : null;
}

function sourceUrlForSegmentReference(entry) {
  return directMediaUrlIfAvailable(entry) || referencePageUrl(entry);
}

function hasOfficialEvidence(entry) {
  const text = [
    entry?.source_owner,
    entry?.source_title,
    entry?.evidence_of_officialness,
    entry?.entity_match_notes,
  ]
    .filter(Boolean)
    .join(" ");
  return /\bofficial\b|verified|publisher|developer|first[- ]?party|storefront|platform|owner/i.test(text);
}

function isOfficialSocialMediaVideo(type) {
  return type === "official_social_media_video";
}

function isOfficialSocialReferenceUrl(parsedUrl) {
  if (!parsedUrl) return false;
  const host = urlHost(parsedUrl);
  const path = String(parsedUrl.pathname || "").toLowerCase();
  return OFFICIAL_SOCIAL_REFERENCE_HOST_RE.test(host) && /\/status(?:es)?\//.test(path);
}

function isOfficialSocialDirectMediaHost(parsedUrl) {
  if (!parsedUrl) return false;
  return OFFICIAL_SOCIAL_DIRECT_MEDIA_HOST_RE.test(urlHost(parsedUrl));
}

function rawImageReferenceNotAllowed(entry, parsedUrl) {
  if (!parsedUrl) return false;
  const kind = mediaSourceUrlKindFields(entry?.official_source_url).source_url_kind;
  if (kind !== "image") return false;
  const host = urlHost(parsedUrl);
  return RAW_IMAGE_HOST_RE.test(host) || sourceType(entry) !== "official_press_kit_stills";
}

function rejectionReasonsForEntry(entry, context) {
  const reasons = [];
  const required = [
    ["story_id", "missing_story_id"],
    ["entity", "missing_entity"],
    ["source_type", "missing_source_type"],
    ["source_owner", "missing_source_owner"],
    ["source_family", "missing_source_family"],
  ];
  for (const [field, reason] of required) {
    if (!String(entry?.[field] || "").trim()) reasons.push(reason);
  }

  const parsed = parseHttpUrl(entry?.official_source_url);
  if (parsed.reason) reasons.push(parsed.reason);

  const type = sourceType(entry);
  const host = urlHost(parsed.url);
  const officialSocial = isOfficialSocialMediaVideo(type);
  const officialSocialReference = officialSocial && isOfficialSocialReferenceUrl(parsed.url);
  const sourceBlob = [
    type,
    host,
    entry?.official_source_url,
    entry?.direct_media_url_if_available,
    entry?.source_title,
    entry?.source_owner,
    entry?.evidence_of_officialness,
  ]
    .filter(Boolean)
    .join(" ");

  if (
    SOCIAL_OR_REPOST_SOURCE_TYPES.has(type) ||
    (SOCIAL_OR_REPOST_HOST_RE.test(host) && !officialSocialReference) ||
    REUPLOAD_RE.test(sourceBlob)
  ) {
    reasons.push("social_or_repost_source_forbidden");
  }

  if (rawImageReferenceNotAllowed(entry, parsed.url)) {
    reasons.push("raw_image_source_not_allowed");
  }

  if (type && !ALLOWED_SOURCE_TYPES.has(type) && !SOCIAL_OR_REPOST_SOURCE_TYPES.has(type)) {
    reasons.push("unsupported_source_type");
  }

  if (entry?.downloads_allowed === true || String(entry?.downloads_allowed || "").toLowerCase() === "true") {
    reasons.push("downloads_requested");
  }

  const directMediaUrl = directMediaUrlIfAvailable(entry);
  if (directMediaUrl) {
    const parsedDirectMedia = parseHttpUrl(directMediaUrl);
    if (parsedDirectMedia.reason) {
      reasons.push("invalid_direct_media_url");
    } else {
      const directMediaKind = mediaSourceUrlKindFields(directMediaUrl);
      if (!directMediaKind.segment_validation_eligible) {
        reasons.push("direct_media_field_contains_page_url");
      }
    }
    if (officialSocial && parsedDirectMedia.url && !isOfficialSocialDirectMediaHost(parsedDirectMedia.url)) {
      reasons.push("official_social_direct_media_host_not_allowed");
    }
  } else if (officialSocial) {
    reasons.push("official_social_direct_media_required");
  }

  if (officialSocial && !officialSocialReference) {
    reasons.push("official_social_reference_url_required");
  }

  const metadataRejectReason = officialMediaReferenceRejectReason(entry);
  if (metadataRejectReason) reasons.push(metadataRejectReason);

  const story = context.storyMap.get(String(entry?.story_id || "").trim());
  if (String(entry?.story_id || "").trim() && !story) {
    reasons.push("unknown_story_id");
  }

  if (story && !entityAppearsInStory(entry.entity, story)) {
    reasons.push("entity_not_in_story_subjects");
  }

  if (story && !hasEntityEvidence(entry)) {
    reasons.push("entity_evidence_missing_or_wrong");
  }

  if (VIDEO_PLATFORM_SOURCE_TYPES.has(type) && !hasOfficialEvidence(entry)) {
    reasons.push("official_evidence_required_for_video_platform");
  }

  const canonical = canonicalSourceUrl(entry);
  if (canonical && context.seenCanonicalUrls.has(canonical)) {
    reasons.push("duplicate_source_url");
  }

  return [...new Set(reasons)].sort(
    (a, b) => (REASON_PRIORITY.get(a) ?? 100) - (REASON_PRIORITY.get(b) ?? 100),
  );
}

function acceptedReferenceFromEntry(entry, index) {
  const canonical = canonicalSourceUrl(entry);
  const sourceUrl = sourceUrlForSegmentReference(entry);
  const referenceUrl = referencePageUrl(entry);
  const directMediaUrl = directMediaUrlIfAvailable(entry);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const sourceDurationS = positiveNumberOrNull(entry.source_duration_s || entry.sourceDurationS || entry.duration_seconds);
  return {
    source_type: sourceType(entry),
    provider: "official_intake",
    story_id: cleanText(entry.story_id),
    source_url: sourceUrl,
    reference_page_url: directMediaUrl ? referenceUrl : null,
    direct_media_url_if_available: directMediaUrl || null,
    canonical_source_url: canonical,
    ...urlKind,
    thumbnail_url: cleanText(entry.thumbnail_url) || null,
    movie_id: entry.movie_id || entry.video_id || `official_intake_${index + 1}`,
    movie_name: cleanText(entry.source_title) || `${cleanText(entry.entity)} official reference`,
    entity: cleanText(entry.entity),
    source_owner: cleanText(entry.source_owner) || null,
    source_family: cleanText(entry.source_family) || null,
    source_duration_s: sourceDurationS,
    source_verified: true,
    downloads_allowed: false,
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "official_reference_only",
    provenance: {
      source: "operator_official_source_intake",
      story_id: cleanText(entry.story_id),
      entity: cleanText(entry.entity),
      source_owner: cleanText(entry.source_owner) || null,
      source_family: cleanText(entry.source_family) || null,
      source_duration_s: sourceDurationS,
      reference_page_url: directMediaUrl ? referenceUrl : null,
      direct_media_url_if_available: directMediaUrl || null,
      source_url_kind: urlKind.source_url_kind,
      segment_validation_eligible: urlKind.segment_validation_eligible,
      segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
      evidence_of_officialness: cleanText(entry.evidence_of_officialness) || null,
      entity_match_notes: cleanText(entry.entity_match_notes) || null,
      acquired_at: new Date().toISOString(),
    },
  };
}

function buildOfficialSourceIntakeReport({ stories = [], entries = [], generatedAt = new Date().toISOString() } = {}) {
  const storyMap = buildStoryMap(stories);
  const seenCanonicalUrls = new Set();
  const acceptedReferences = [];
  const acceptedEntries = [];
  const rejectedEntries = [];

  for (const [index, rawEntry] of (Array.isArray(entries) ? entries : []).entries()) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    const reasons = rejectionReasonsForEntry(entry, { storyMap, seenCanonicalUrls });
    const canonical = canonicalSourceUrl(entry);

    if (reasons.length > 0) {
      rejectedEntries.push({
        input_index: index,
        story_id: entry.story_id || null,
        entity: entry.entity || null,
        official_source_url: entry.official_source_url || null,
        direct_media_url_if_available: entry.direct_media_url_if_available || null,
        canonical_source_url: canonical,
        source_type: entry.source_type || null,
        reasons,
      });
      if (canonical && !reasons.includes("duplicate_source_url")) seenCanonicalUrls.add(canonical);
      continue;
    }

    const reference = acceptedReferenceFromEntry(entry, index);
    acceptedEntries.push({
      input_index: index,
      story_id: reference.story_id,
      entity: reference.entity,
      official_source_url: reference.reference_page_url || reference.source_url,
      direct_media_url_if_available: reference.direct_media_url_if_available,
      canonical_source_url: reference.canonical_source_url,
      source_type: reference.source_type,
      source_url_kind: reference.source_url_kind,
      source_duration_s: reference.source_duration_s,
      segment_validation_eligible: reference.segment_validation_eligible,
      segment_validation_ineligible_reason: reference.segment_validation_ineligible_reason,
      accepted_for: "reference_validation_only",
      downloads_allowed: false,
    });
    acceptedReferences.push(reference);
    if (canonical) seenCanonicalUrls.add(canonical);
  }

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "report_only",
    will_download: false,
    will_mutate_story: false,
    summary: {
      entries: Array.isArray(entries) ? entries.length : 0,
      stories: storyMap.size,
      accepted: acceptedEntries.length,
      rejected: rejectedEntries.length,
    },
    accepted_entries: acceptedEntries,
    rejected_entries: rejectedEntries,
    accepted_references: acceptedReferences,
    provenance_ledger: acceptedReferences.map((reference) => ({
      source_url: reference.source_url,
      reference_page_url: reference.reference_page_url,
      direct_media_url_if_available: reference.direct_media_url_if_available,
      source_type: reference.source_type,
      provider: reference.provider,
      entity: reference.entity,
      rights_risk_class: reference.rights_risk_class,
      allowed_render_use: reference.allowed_render_use,
      source_url_kind: reference.source_url_kind,
      source_duration_s: reference.source_duration_s,
      segment_validation_eligible: reference.segment_validation_eligible,
      segment_validation_ineligible_reason: reference.segment_validation_ineligible_reason,
      downloads_allowed: false,
      provenance: reference.provenance,
    })),
    safety: {
      report_only: true,
      local_only: true,
      video_downloads: false,
      frame_extraction: false,
      clip_slicing: false,
      yt_dlp: false,
      browser_scraping: false,
      railway_mutated: false,
      production_db_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      production_render_default_changed: false,
    },
  };
}

function renderOfficialSourceIntakeMarkdown(report) {
  const lines = [];
  lines.push("# Official Source Intake");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Execution mode: ${report.execution_mode}`);
  lines.push(`Will download: ${report.will_download}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- entries: ${report.summary.entries}`);
  lines.push(`- accepted: ${report.summary.accepted}`);
  lines.push(`- rejected: ${report.summary.rejected}`);
  lines.push("");
  lines.push("## Accepted References");
  lines.push("");
  lines.push("| story | entity | source type | reference page | direct media | URL kind | segment validation | use |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const entry of report.accepted_entries || []) {
    lines.push(
      `| ${entry.story_id} | ${entry.entity} | ${entry.source_type} | ${entry.official_source_url} | ${
        entry.direct_media_url_if_available || "none"
      } | ${entry.source_url_kind || "unknown"} | ${
        entry.segment_validation_eligible ? "eligible" : "reference-only"
      } | reference-only |`,
    );
  }
  if (!report.accepted_entries?.length) lines.push("| none | none | none | none | none | none | none | none |");
  lines.push("");
  lines.push("## Rejected Entries");
  lines.push("");
  lines.push("| story | entity | source | reasons |");
  lines.push("| --- | --- | --- | --- |");
  for (const entry of report.rejected_entries || []) {
    lines.push(
      `| ${entry.story_id || "unknown"} | ${entry.entity || "unknown"} | ${
        entry.official_source_url || "missing"
      } | ${entry.reasons.join(", ")} |`,
    );
  }
  if (!report.rejected_entries?.length) lines.push("| none | none | none | none |");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Report-only.");
  lines.push("- Accepted sources are reference-only; they do not imply download, render or Flash Lane readiness.");
  lines.push("- No video downloads, frame extraction, clip slicing, yt-dlp, browser scraping, Railway changes, OAuth, production DB mutation or posting.");
  return lines.join("\n") + "\n";
}

module.exports = {
  ALLOWED_SOURCE_TYPES,
  buildOfficialSourceIntakeReport,
  renderOfficialSourceIntakeMarkdown,
};
