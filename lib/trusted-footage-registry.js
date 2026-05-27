"use strict";

const { mediaSourceUrlKindFields } = require("./media-source-url-kind");
const { canonicalUrl } = require("./services/url-canonical");

const OFFICIAL_OWNER_TYPES = new Set([
  "publisher",
  "developer",
  "platform",
  "storefront",
  "first_party",
  "official_channel",
  "game_studio",
]);

const PUBLISHER_MEDIA_REPOSITORY_OWNER_TYPES = new Set([
  "publisher_media_repository",
  "official_media_repository",
  "platform_media_repository",
]);

const LICENSED_CREATOR_OWNER_TYPES = new Set(["licensed_creator"]);

const TRUSTED_DISCOVERY_OWNER_TYPES = new Set(["trusted_creator", "partner_creator", "creator"]);

const FORBIDDEN_OWNER_TYPES = new Set([
  "fan_reupload",
  "random_youtube_reupload",
  "social_media_repost",
  "youtube_compilation",
  "reaction_video",
  "browser_scrape",
]);

const FORBIDDEN_SOURCE_TYPES = new Set([
  "fan_reupload",
  "random_youtube_reupload",
  "social_media_repost",
  "youtube_compilation",
  "reaction_video",
  "browser_scrape",
]);

const SUPPORTED_PLATFORMS = new Set([
  "youtube",
  "x",
  "twitter",
  "steam",
  "igdb",
  "website",
  "press_kit",
  "local_archive",
  "cloud_storage",
]);

const REUPLOAD_RE =
  /\b(?:reupload|fan upload|compilation|reaction|tiktok|reel|shorts repost|unofficial|mirror)\b/i;

const REASON_PRIORITY = new Map(
  [
    "social_or_repost_source_forbidden",
    "licence_evidence_required_for_creator_clip_use",
    "shorts_clip_scope_required_for_creator_clip_use",
    "autonomous_use_approval_required_for_creator_clip_use",
    "expired_licence",
    "publisher_media_repository_evidence_required",
    "downloads_requested",
    "missing_source_id",
    "missing_display_name",
    "missing_owner_type",
    "missing_platform",
    "missing_channel_url",
    "invalid_channel_url",
    "unsupported_owner_type",
    "unsupported_platform",
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

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const text = String(value || "").trim();
    const key = normaliseLabel(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function asList(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return asList(parsed);
      } catch {
        return [trimmed];
      }
    }
    return uniqueStrings(trimmed.split(",").map((item) => item.trim()));
  }
  return [];
}

function positiveNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normaliseKey(value) {
  return String(value || "").trim().toLowerCase();
}

function parseHttpUrl(value) {
  const text = String(value || "").trim();
  if (!text) return { url: null, reason: "missing_channel_url" };
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { url: null, reason: "invalid_channel_url" };
    }
    return { url: parsed, reason: null };
  } catch {
    return { url: null, reason: "invalid_channel_url" };
  }
}

function referenceUrl(entry) {
  return String(
    entry?.official_source_url ||
      entry?.channel_url ||
      entry?.canonical_url ||
      entry?.source_url ||
      entry?.direct_media_url_if_available ||
      "",
  ).trim();
}

function segmentSourceUrl(entry) {
  return String(
    entry?.direct_media_url_if_available ||
      entry?.source_url ||
      entry?.official_source_url ||
      entry?.channel_url ||
      entry?.canonical_url ||
      "",
  ).trim();
}

function channelUrl(entry) {
  return String(entry?.channel_url || entry?.canonical_url || entry?.source_url || entry?.official_source_url || "").trim();
}

function storyText(story) {
  return [
    story?.title,
    story?.hook,
    story?.body,
    story?.loop,
    story?.full_script,
    story?.suggested_thumbnail_text,
    story?.company_name,
  ]
    .filter(Boolean)
    .join(" ");
}

function storyPrimarySubjectText(story) {
  return [
    story?.title,
    story?.suggested_thumbnail_text,
    story?.canonical_subject,
    story?.canonical_game,
    story?.game,
  ]
    .filter(Boolean)
    .join(" ");
}

function firstMatchedEntity(entities, story) {
  const primaryText = normaliseLabel(storyPrimarySubjectText(story));
  const fallbackText = normaliseLabel(storyText(story));
  if (!primaryText && !fallbackText) return null;
  for (const entity of asList(entities)) {
    const key = normaliseLabel(entity);
    if (key && primaryText.includes(key)) return entity;
  }
  if (primaryText) return null;
  for (const entity of asList(entities)) {
    const key = normaliseLabel(entity);
    if (key && fallbackText.includes(key)) return entity;
  }
  return null;
}

function sourceTierForOwner(ownerType) {
  if (OFFICIAL_OWNER_TYPES.has(ownerType)) return "official";
  if (PUBLISHER_MEDIA_REPOSITORY_OWNER_TYPES.has(ownerType)) return "official";
  if (LICENSED_CREATOR_OWNER_TYPES.has(ownerType)) return "licensed_creator";
  if (TRUSTED_DISCOVERY_OWNER_TYPES.has(ownerType)) return "trusted_creator_reference";
  return null;
}

function hasShortsClipScope(entry) {
  const allowedUses = asList(entry?.allowed_uses).map(normaliseKey);
  const scope = normaliseLabel(entry?.licence_scope);
  return (
    allowedUses.includes("shorts_clips") ||
    allowedUses.includes("shorts_clip") ||
    allowedUses.includes("vertical_social_clips") ||
    allowedUses.includes("transformative_edit") ||
    /\b(shorts|reels|tiktok|vertical social|social clips?)\b/.test(scope)
  );
}

function hasLicenceEvidence(entry) {
  return Boolean(
    String(entry?.licence_evidence || "").trim() ||
      String(entry?.licence_document || "").trim() ||
      String(entry?.permission_evidence || "").trim(),
  );
}

function isExpired(dateValue, generatedAt) {
  const text = String(dateValue || "").trim();
  if (!text) return false;
  const expiry = Date.parse(text);
  const now = Date.parse(generatedAt);
  if (!Number.isFinite(expiry) || !Number.isFinite(now)) return false;
  return expiry < now;
}

function validationReasons(entry, generatedAt) {
  const reasons = [];
  const ownerType = normaliseKey(entry?.owner_type);
  const sourceType = normaliseKey(entry?.source_type);
  const platform = normaliseKey(entry?.platform);
  const sourceBlob = [
    entry?.source_type,
    entry?.owner_type,
    entry?.display_name,
    entry?.channel_url,
    entry?.canonical_url,
    entry?.source_url,
  ]
    .filter(Boolean)
    .join(" ");

  if (!String(entry?.source_id || "").trim()) reasons.push("missing_source_id");
  if (!String(entry?.display_name || "").trim()) reasons.push("missing_display_name");
  if (!ownerType) reasons.push("missing_owner_type");
  if (!platform) reasons.push("missing_platform");

  const parsed = parseHttpUrl(channelUrl(entry));
  if (parsed.reason) reasons.push(parsed.reason);

  if (FORBIDDEN_OWNER_TYPES.has(ownerType) || FORBIDDEN_SOURCE_TYPES.has(sourceType) || REUPLOAD_RE.test(sourceBlob)) {
    reasons.push("social_or_repost_source_forbidden");
  }

  if (platform && !SUPPORTED_PLATFORMS.has(platform)) reasons.push("unsupported_platform");

  const tier = sourceTierForOwner(ownerType);
  if (ownerType && !tier && !FORBIDDEN_OWNER_TYPES.has(ownerType)) reasons.push("unsupported_owner_type");

  if (entry?.downloads_allowed === true || String(entry?.downloads_allowed || "").toLowerCase() === "true") {
    reasons.push("downloads_requested");
  }

  if (tier === "licensed_creator") {
    if (!hasLicenceEvidence(entry)) reasons.push("licence_evidence_required_for_creator_clip_use");
    if (!hasShortsClipScope(entry)) reasons.push("shorts_clip_scope_required_for_creator_clip_use");
    if (entry?.autonomous_use_approved !== true) {
      reasons.push("autonomous_use_approval_required_for_creator_clip_use");
    }
    if (isExpired(entry?.licence_expires_at, generatedAt)) reasons.push("expired_licence");
  }

  if (
    PUBLISHER_MEDIA_REPOSITORY_OWNER_TYPES.has(ownerType) &&
    !String(entry?.official_evidence || "").trim()
  ) {
    reasons.push("publisher_media_repository_evidence_required");
  }

  return [...new Set(reasons)].sort(
    (a, b) => (REASON_PRIORITY.get(a) ?? 100) - (REASON_PRIORITY.get(b) ?? 100),
  );
}

function videoUseStylePlanFor(entry, acceptedSource) {
  const clipCandidate = acceptedSource.source_tier === "licensed_creator";
  return {
    mode: "autonomous_local_motion_intake",
    local_transcript_provider: "local_asr_or_existing_alignment",
    cloud_transcript_provider_required: false,
    requires_human_confirmation: false,
    audio_primary_cutting: true,
    subtitles_last: true,
    required_artifacts: [
      "local_transcript_pack",
      "timeline_contact_sheet",
      "motion_edl",
      "cut_boundary_self_eval",
    ],
    local_asr: {
      preferred_endpoint: process.env.INFER_BASE_URL || process.env.LOCAL_TTS_URL || "http://127.0.0.1:8765",
      task: "transcribe",
      fallback: "existing_tts_alignment_or_even_timing",
    },
    timeline_checks: {
      contact_sheet_required: true,
      waveform_required: true,
      cut_boundary_windows_seconds: 1.5,
      max_self_eval_passes: 3,
    },
    acquisition_policy: {
      will_download_in_this_step: false,
      approved_registry_source_required: true,
      creator_clip_candidate: clipCandidate,
      downloader_worker_required: clipCandidate,
    },
  };
}

function acceptedSourceFromEntry(entry, index, generatedAt) {
  const ownerType = normaliseKey(entry?.owner_type);
  const platform = normaliseKey(entry?.platform);
  const tier = sourceTierForOwner(ownerType);
  const sourceUrl = referenceUrl(entry);
  const segmentUrl = segmentSourceUrl(entry);
  const urlKind = mediaSourceUrlKindFields(segmentUrl);
  const sourceDurationS = positiveNumberOrNull(
    entry?.source_duration_s || entry?.sourceDurationS || entry?.duration_seconds,
  );
  const source = {
    input_index: index,
    source_id: String(entry.source_id || "").trim(),
    display_name: String(entry.display_name || "").trim(),
    owner_type: ownerType,
    platform,
    source_type: normaliseKey(entry?.source_type),
    source_tier: tier,
    channel_url: channelUrl(entry),
    canonical_source_url: canonicalUrl(channelUrl(entry)),
    reference_url: sourceUrl,
    segment_source_url: segmentUrl,
    official_source_url: sourceUrl,
    direct_media_url_if_available: entry?.direct_media_url_if_available || null,
    source_url_kind: urlKind.source_url_kind,
    segment_validation_eligible: urlKind.segment_validation_eligible,
    segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
    source_family: entry?.source_family || entry?.source_id || null,
    source_duration_s: sourceDurationS,
    entities: asList(entry?.entities),
    allowed_uses: asList(entry?.allowed_uses),
    licence_scope: entry?.licence_scope || null,
    licence_evidence: entry?.licence_evidence || entry?.permission_evidence || null,
    licence_expires_at: entry?.licence_expires_at || null,
    generated_at: generatedAt,
    downloads_allowed: false,
    download_policy: tier === "licensed_creator" ? "approved_registry_source_only" : "reference_only_no_download",
    allowed_render_use:
      tier === "licensed_creator" ? "licensed_short_clip_candidate" : "reference_only_by_default",
    rights_risk_class:
      tier === "licensed_creator"
        ? "licensed_creator_clip"
        : tier === "official"
          ? "official_reference_only"
          : "trusted_creator_reference_only",
    source_verified: tier === "official" || tier === "licensed_creator",
    autonomous_motion_candidate: tier === "official" || (tier === "licensed_creator" && entry.autonomous_use_approved === true),
    provenance: {
      source: "trusted_footage_registry",
      source_id: entry?.source_id || null,
      display_name: entry?.display_name || null,
      owner_type: ownerType,
      platform,
      source_family: entry?.source_family || entry?.source_id || null,
      source_duration_s: sourceDurationS,
      official_evidence: entry?.official_evidence || null,
      licence_evidence: entry?.licence_evidence || entry?.permission_evidence || null,
      licence_scope: entry?.licence_scope || null,
      acquired_at: generatedAt,
    },
  };
  source.video_use_style_plan = videoUseStylePlanFor(entry, source);
  return source;
}

function storyCandidatesForSource(source, stories) {
  const candidates = [];
  for (const story of Array.isArray(stories) ? stories : []) {
    const storyId = String(story?.id || "").trim();
    if (!storyId) continue;
    const entity = firstMatchedEntity(source.entities, story);
    if (!entity) continue;
    candidates.push({
      story_id: storyId,
      title: story?.title || null,
      entity,
      source_id: source.source_id,
      display_name: source.display_name,
      source_tier: source.source_tier,
      source_type: source.source_type,
      source_family: source.source_family,
      source_duration_s: source.source_duration_s,
      reference_url: source.reference_url,
      source_url: source.segment_source_url || source.reference_url,
      canonical_source_url: source.canonical_source_url,
      source_url_kind: source.source_url_kind,
      segment_validation_eligible: source.segment_validation_eligible,
      segment_validation_ineligible_reason: source.segment_validation_ineligible_reason,
      allowed_render_use: source.allowed_render_use,
      rights_risk_class: source.rights_risk_class,
      downloads_allowed: false,
      autonomous_motion_candidate: source.autonomous_motion_candidate,
      video_use_style_plan: source.video_use_style_plan,
    });
  }
  return candidates;
}

function buildTrustedFootageRegistryReport({
  stories = [],
  entries = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const acceptedSources = [];
  const rejectedSources = [];

  for (const [index, rawEntry] of (Array.isArray(entries) ? entries : []).entries()) {
    const entry = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
    const reasons = validationReasons(entry, generatedAt);
    if (reasons.length > 0) {
      rejectedSources.push({
        input_index: index,
        source_id: entry?.source_id || null,
        display_name: entry?.display_name || null,
        owner_type: entry?.owner_type || null,
        platform: entry?.platform || null,
        channel_url: channelUrl(entry) || null,
        canonical_source_url: channelUrl(entry) ? canonicalUrl(channelUrl(entry)) : null,
        reasons,
      });
      continue;
    }
    acceptedSources.push(acceptedSourceFromEntry(entry, index, generatedAt));
  }

  const storyCandidates = acceptedSources.flatMap((source) => storyCandidatesForSource(source, stories));
  const byTier = acceptedSources.reduce((acc, source) => {
    acc[source.source_tier] = (acc[source.source_tier] || 0) + 1;
    return acc;
  }, {});

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "autonomous_report_only",
    will_download: false,
    will_mutate_story: false,
    summary: {
      entries: Array.isArray(entries) ? entries.length : 0,
      stories: Array.isArray(stories) ? stories.length : 0,
      accepted: acceptedSources.length,
      rejected: rejectedSources.length,
      official_sources: byTier.official || 0,
      licensed_creator_sources: byTier.licensed_creator || 0,
      trusted_creator_reference_sources: byTier.trusted_creator_reference || 0,
      story_candidates: storyCandidates.length,
      autonomous_motion_candidates: storyCandidates.filter((candidate) => candidate.autonomous_motion_candidate).length,
    },
    autonomy: {
      enabled: true,
      requires_human_confirmation: false,
      scheduler_safe: true,
      can_queue_reference_plans: true,
      can_queue_local_timeline_jobs: true,
      can_publish: false,
    },
    accepted_sources: acceptedSources,
    rejected_sources: rejectedSources,
    story_candidates: storyCandidates,
    provenance_ledger: acceptedSources.map((source) => ({
      source_id: source.source_id,
      display_name: source.display_name,
      source_tier: source.source_tier,
      platform: source.platform,
      reference_url: source.reference_url,
      canonical_source_url: source.canonical_source_url,
      rights_risk_class: source.rights_risk_class,
      allowed_render_use: source.allowed_render_use,
      downloads_allowed: false,
      provenance: source.provenance,
    })),
    safety: {
      report_only: true,
      local_only: true,
      elevenlabs_required: false,
      cloud_transcription_required: false,
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

function sourceTypeForIntake(source) {
  if (source.source_type === "official_social_media_video") return "official_social_media_video";
  if (/media_repository/.test(source.source_type || "")) return source.source_type;
  if (source.source_tier === "licensed_creator") return "licensed_creator_channel_reference";
  if (source.source_tier === "trusted_creator_reference") return "trusted_creator_channel_reference";
  if (source.platform === "youtube") return "official_youtube_channel_url";
  if (source.platform === "steam") return "steam_storefront_video_reference";
  if (source.platform === "igdb") return "igdb_video_reference";
  if (source.source_url_kind === "direct_video" || source.source_url_kind === "hls_manifest") {
    return "platform_storefront_video_reference";
  }
  return "official_publisher_or_developer_trailer_page";
}

function buildTrustedFootageOfficialIntakeEntries({ report, storyId = null } = {}) {
  const sourcesById = new Map(
    (Array.isArray(report?.accepted_sources) ? report.accepted_sources : []).map((source) => [source.source_id, source]),
  );
  return (Array.isArray(report?.story_candidates) ? report.story_candidates : [])
    .filter((candidate) => !storyId || candidate.story_id === storyId)
    .map((candidate) => {
      const source = sourcesById.get(candidate.source_id) || {};
      return {
        story_id: candidate.story_id,
        entity: candidate.entity,
        official_source_url: source.reference_url || source.channel_url || candidate.reference_url,
        direct_media_url_if_available:
          source.direct_media_url_if_available ||
          (source.segment_validation_eligible &&
          source.segment_source_url &&
          source.segment_source_url !== source.reference_url
            ? source.segment_source_url
            : null),
        source_title: `${source.display_name || candidate.display_name} trusted footage registry reference`,
        source_owner: source.display_name || candidate.display_name,
        source_type: sourceTypeForIntake(source),
        source_family: source.source_family || candidate.source_family,
        evidence_of_officialness: [
          "Trusted footage registry accepted this source.",
          source.provenance?.official_evidence,
          source.provenance?.licence_evidence,
          source.provenance?.licence_scope,
        ]
          .filter(Boolean)
          .join(" "),
        entity_match_notes: `${candidate.entity} appears in story text and registry entities.`,
        downloads_allowed: false,
        trusted_footage_source_id: source.source_id || candidate.source_id,
        allowed_render_use: source.allowed_render_use || candidate.allowed_render_use,
        rights_risk_class: source.rights_risk_class || candidate.rights_risk_class,
        source_duration_s: source.source_duration_s || candidate.source_duration_s || null,
      };
    });
}

function trustedFootageReferencesForStory(report, story) {
  const storyId = String(story?.id || "").trim();
  if (!storyId || !report || typeof report !== "object") return [];
  const sourcesById = new Map(
    (Array.isArray(report.accepted_sources) ? report.accepted_sources : []).map((source) => [source.source_id, source]),
  );

  return (Array.isArray(report.story_candidates) ? report.story_candidates : [])
    .filter((candidate) => candidate.story_id === storyId)
    .map((candidate, index) => {
      const source = sourcesById.get(candidate.source_id) || {};
      const sourceUrl =
        source.segment_source_url ||
        source.reference_url ||
        source.channel_url ||
        candidate.source_url ||
        candidate.reference_url;
      const urlKind = mediaSourceUrlKindFields(sourceUrl);
      return {
        provider: "trusted_footage_registry",
        source_type: sourceTypeForIntake(source),
        story_id: storyId,
        source_url: sourceUrl,
        ...urlKind,
        reference_url: source.reference_url || candidate.reference_url || null,
        official_source_url: source.reference_url || source.channel_url || null,
        thumbnail_url: source.thumbnail_url || null,
        movie_id: source.source_id || `trusted_footage_${index + 1}`,
        movie_name: `${source.display_name || candidate.display_name || "Trusted footage"} reference`,
        entity: candidate.entity,
        source_duration_s: source.source_duration_s || candidate.source_duration_s || null,
        source_owner: source.display_name || candidate.display_name || null,
        source_family: source.source_family || candidate.source_family || source.source_id || null,
        source_verified: source.source_verified !== false,
        source_tier: source.source_tier || candidate.source_tier || null,
        trusted_footage_source_id: source.source_id || candidate.source_id,
        trusted_footage_registry_status: "accepted",
        video_use_style_plan: source.video_use_style_plan || candidate.video_use_style_plan || null,
        downloads_allowed: false,
        allowed_render_use: source.allowed_render_use || candidate.allowed_render_use || "reference_only_by_default",
        rights_risk_class: source.rights_risk_class || candidate.rights_risk_class || "official_reference_only",
        provenance: {
          ...(source.provenance || {}),
          source: "trusted_footage_registry",
          story_id: storyId,
          entity: candidate.entity,
          source_id: source.source_id || candidate.source_id,
          source_family: source.source_family || candidate.source_family || source.source_id || null,
          source_duration_s: source.source_duration_s || candidate.source_duration_s || null,
          source_url_kind: urlKind.source_url_kind,
          segment_validation_eligible: urlKind.segment_validation_eligible,
          segment_validation_ineligible_reason: urlKind.segment_validation_ineligible_reason,
        },
      };
    });
}

function renderTrustedFootageRegistryMarkdown(report) {
  const lines = [];
  lines.push("# Trusted Footage Registry");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Execution mode: ${report.execution_mode}`);
  lines.push(`Autonomous mode: ${report.autonomy?.enabled ? "enabled" : "disabled"}`);
  lines.push(`Will download: ${report.will_download}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- entries: ${report.summary.entries}`);
  lines.push(`- accepted: ${report.summary.accepted}`);
  lines.push(`- rejected: ${report.summary.rejected}`);
  lines.push(`- official sources: ${report.summary.official_sources}`);
  lines.push(`- licensed creator sources: ${report.summary.licensed_creator_sources}`);
  lines.push(`- story candidates: ${report.summary.story_candidates}`);
  lines.push(`- autonomous motion candidates: ${report.summary.autonomous_motion_candidates}`);
  lines.push("");
  lines.push("## Accepted Sources");
  lines.push("");
  lines.push("| source | tier | platform | entities | use | transcript plan | downloads |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const source of report.accepted_sources || []) {
    lines.push(
      `| ${source.display_name} | ${source.source_tier} | ${source.platform} | ${
        source.entities.join(", ") || "none"
      } | ${source.allowed_render_use} | local transcript pack + timeline contact sheet + cut-boundary self-eval | no |`,
    );
  }
  if (!report.accepted_sources?.length) lines.push("| none | none | none | none | none | none | no |");
  lines.push("");
  lines.push("## Story Candidates");
  lines.push("");
  lines.push("| story | entity | source | use | URL kind | segment validation |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const candidate of report.story_candidates || []) {
    lines.push(
      `| ${candidate.story_id} | ${candidate.entity} | ${candidate.source_id} | ${
        candidate.allowed_render_use
      } | ${candidate.source_url_kind} | ${candidate.segment_validation_eligible ? "eligible" : "reference-only"} |`,
    );
  }
  if (!report.story_candidates?.length) lines.push("| none | none | none | none | none | none |");
  lines.push("");
  lines.push("## Rejected Sources");
  lines.push("");
  lines.push("| source | reasons |");
  lines.push("| --- | --- |");
  for (const source of report.rejected_sources || []) {
    lines.push(`| ${source.source_id || source.display_name || "unknown"} | ${source.reasons.join(", ")} |`);
  }
  if (!report.rejected_sources?.length) lines.push("| none | none |");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Autonomous report-only planner.");
  lines.push("- Uses local transcript pack, local ASR or existing local alignment.");
  lines.push("- No video downloads, frame extraction, clip slicing, yt-dlp, browser scraping, OAuth, production DB mutation or posting.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildTrustedFootageOfficialIntakeEntries,
  buildTrustedFootageRegistryReport,
  renderTrustedFootageRegistryMarkdown,
  trustedFootageReferencesForStory,
};
