"use strict";

const { buildSubjectGraph } = require("./exact-subject-matching");
const { canonicalUrl } = require("./services/url-canonical");

const ALLOWED_SOURCE_TYPES = new Set([
  "official_publisher_or_developer_trailer_page",
  "official_game_website_media_page",
  "platform_storefront_video_reference",
  "steam_storefront_video_reference",
  "igdb_video_reference",
  "official_youtube_channel_url",
  "official_press_kit_stills",
]);

const VIDEO_PLATFORM_SOURCE_TYPES = new Set(["official_youtube_channel_url"]);

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

const REUPLOAD_RE =
  /\b(?:reupload|fan upload|compilation|reaction|tiktok|reel|shorts|unofficial|not official|mirror)\b/i;

const REASON_PRIORITY = new Map(
  [
    "official_evidence_required_for_video_platform",
    "entity_evidence_missing_or_wrong",
    "social_or_repost_source_forbidden",
    "duplicate_source_url",
  ].map((reason, index) => [reason, index]),
);

function normaliseLabel(value) {
  return String(value || "")
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

function storyId(story) {
  return String(story?.id || "").trim();
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
  return storyEntities(story).some((candidate) => normaliseLabel(candidate) === wanted);
}

function hasEntityEvidence(entry) {
  const entity = String(entry?.entity || "").trim();
  const combined = [
    entry?.official_source_url,
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
  return String(entry?.source_type || "").trim().toLowerCase();
}

function urlHost(parsedUrl) {
  return String(parsedUrl?.hostname || "").toLowerCase().replace(/^www\./, "");
}

function canonicalSourceUrl(entry) {
  return canonicalUrl(String(entry?.official_source_url || ""));
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
  const sourceBlob = [
    type,
    host,
    entry?.official_source_url,
    entry?.source_title,
    entry?.source_owner,
    entry?.evidence_of_officialness,
  ]
    .filter(Boolean)
    .join(" ");

  if (SOCIAL_OR_REPOST_SOURCE_TYPES.has(type) || SOCIAL_OR_REPOST_HOST_RE.test(host) || REUPLOAD_RE.test(sourceBlob)) {
    reasons.push("social_or_repost_source_forbidden");
  }

  if (type && !ALLOWED_SOURCE_TYPES.has(type) && !SOCIAL_OR_REPOST_SOURCE_TYPES.has(type)) {
    reasons.push("unsupported_source_type");
  }

  if (entry?.downloads_allowed === true || String(entry?.downloads_allowed || "").toLowerCase() === "true") {
    reasons.push("downloads_requested");
  }

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
  return {
    source_type: sourceType(entry),
    provider: "official_intake",
    story_id: String(entry.story_id || "").trim(),
    source_url: String(entry.official_source_url || "").trim(),
    canonical_source_url: canonical,
    thumbnail_url: entry.thumbnail_url || null,
    movie_id: entry.movie_id || entry.video_id || `official_intake_${index + 1}`,
    movie_name: entry.source_title || `${entry.entity} official reference`,
    entity: String(entry.entity || "").trim(),
    source_owner: entry.source_owner || null,
    source_family: entry.source_family || null,
    source_verified: true,
    downloads_allowed: false,
    allowed_render_use: "reference_only_by_default",
    rights_risk_class: "official_reference_only",
    provenance: {
      source: "operator_official_source_intake",
      story_id: String(entry.story_id || "").trim(),
      entity: String(entry.entity || "").trim(),
      source_owner: entry.source_owner || null,
      source_family: entry.source_family || null,
      evidence_of_officialness: entry.evidence_of_officialness || null,
      entity_match_notes: entry.entity_match_notes || null,
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
      official_source_url: reference.source_url,
      canonical_source_url: reference.canonical_source_url,
      source_type: reference.source_type,
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
      source_type: reference.source_type,
      provider: reference.provider,
      entity: reference.entity,
      rights_risk_class: reference.rights_risk_class,
      allowed_render_use: reference.allowed_render_use,
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
  lines.push("| story | entity | source type | source | use |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const entry of report.accepted_entries || []) {
    lines.push(
      `| ${entry.story_id} | ${entry.entity} | ${entry.source_type} | ${entry.official_source_url} | reference-only |`,
    );
  }
  if (!report.accepted_entries?.length) lines.push("| none | none | none | none | none |");
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
