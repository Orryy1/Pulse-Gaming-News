"use strict";

const {
  officialTrailerFrameRejectReason,
} = require("../../controlled-frame-extraction-worker");
const {
  classifyTrailerFrameTaste,
} = require("../../visual-content-prescan");
const {
  applySegmentValidationToClipRefs,
} = require("./official-trailer-segment-validator");
const {
  officialMediaReferenceRejectReason,
} = require("../../official-media-reference-preflight");
const {
  mediaSourceUrlKindFields,
} = require("../../media-source-url-kind");

const DEFAULT_MAX_CLIPS = 3;
const MIN_OFFICIAL_CLIP_START_S = 36;
const SAFE_FRAME_LEAD_OUT_S = 4;
const QUALITY_TIE_EPSILON = 0.001;
const DEFAULT_EXPLORATORY_START_SECONDS = [36, 42, 48, 54, 60, 66];
const DEFAULT_LONG_SOURCE_SCAN_STEP_S = 12;
const TRIMMED_SEGMENT_RENDER_HEAD_INSET_S = 0.25;
const TRIMMED_SEGMENT_RENDER_TAIL_INSET_S = 0.35;
const MAX_VALIDATION_SAMPLE_OFFSET_S = 4.15;
const EARLY_EXPLORATORY_MIN_START_S = 6;
const OFFICIAL_REFERENCE_SOURCE_TYPE_RE =
  /(steam_movie|steam_storefront_video_reference|igdb_video|official_trailer|publisher_video|platform_video|licensed_direct_media_url|official_social_media_video|official_youtube_channel(?:_url)?|official_publisher_or_developer_trailer_page|official_game_website_media_page|official_game_site_news_page|official_platform_news_page|platform_storefront|platform_storefront_video_reference|official_platform_product_page)/;
const ALLOWED_RENDER_MOTION_CLASSES = new Set([
  "gameplay_action",
  "official_product_motion",
  "official_storefront_cinematic_motion",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function bounded(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.max(min, Math.min(max, number));
}

function sourceDurationSeconds(record = {}) {
  const provenance = record.provenance || {};
  for (const value of [
    record.sourceDurationS,
    record.source_duration_s,
    record.durationSeconds,
    record.duration_seconds,
    provenance.sourceDurationS,
    provenance.source_duration_s,
    provenance.durationSeconds,
    provenance.duration_seconds,
  ]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function isSteamMicrotrailerUrl(value) {
  return /steamstatic\.com\/store_trailers\/.+\/microtrailer\.(?:mp4|webm|mov)(?:$|[?#])/i.test(
    String(value || ""),
  );
}

function missingDurationSteamMicrotrailer(record = {}) {
  const sourceUrl = String(record.source_url || record.sourceUrl || record.local_path || "").trim();
  const sourceType = String(record.source_type || record.sourceType || "").toLowerCase();
  if (!isSteamMicrotrailerUrl(sourceUrl)) return false;
  if (!/(steam_storefront_video_reference|steam_movie|platform_storefront_video_reference)/.test(sourceType)) {
    return false;
  }
  return !Number.isFinite(sourceDurationSeconds(record));
}

function minimumClipStartForSource(record = {}) {
  const duration = sourceDurationSeconds(record);
  if (!Number.isFinite(duration)) return MIN_OFFICIAL_CLIP_START_S;
  if (duration > MIN_OFFICIAL_CLIP_START_S + SAFE_FRAME_LEAD_OUT_S) {
    return MIN_OFFICIAL_CLIP_START_S;
  }
  const maximumSampleOffset = MAX_VALIDATION_SAMPLE_OFFSET_S;
  const maximumStartForSampling = Number(
    Math.max(0, duration - maximumSampleOffset - 0.1).toFixed(2),
  );
  const sourceRelativeStart = Number(Math.max(0, duration * 0.28).toFixed(2));
  if (maximumStartForSampling < sourceRelativeStart) {
    return Number(Math.max(0, Math.min(maximumStartForSampling, sourceRelativeStart)).toFixed(2));
  }
  return sourceRelativeStart;
}

function maximumClipStartForSource(record = {}) {
  const duration = sourceDurationSeconds(record);
  if (!Number.isFinite(duration)) return null;
  return Number(Math.max(0, duration - MAX_VALIDATION_SAMPLE_OFFSET_S - 0.1).toFixed(2));
}

function boundClipStartForSource(start, record = {}) {
  const minimum = minimumClipStartForSource(record);
  const maximum = maximumClipStartForSource(record);
  if (!Number.isFinite(maximum)) return Number(Math.max(minimum, start).toFixed(2));
  return Number(Math.max(minimum, Math.min(maximum, start)).toFixed(2));
}

function uniqueNumberList(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const number = Number(value);
    if (!Number.isFinite(number)) continue;
    const rounded = Number(number.toFixed(2));
    const key = rounded.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rounded);
  }
  return out;
}

function durationAwareDefaultStarts(baseStarts, record = {}, opts = {}) {
  if (opts.expandLongSources !== true) return baseStarts;
  const maximum = maximumClipStartForSource(record);
  if (!Number.isFinite(maximum)) return baseStarts;
  const highestBaseStart = Math.max(
    MIN_OFFICIAL_CLIP_START_S,
    ...baseStarts.filter((seconds) => Number.isFinite(seconds)),
  );
  if (maximum <= highestBaseStart + DEFAULT_LONG_SOURCE_SCAN_STEP_S) return baseStarts;

  const starts = [...baseStarts];
  for (
    let start = highestBaseStart + DEFAULT_LONG_SOURCE_SCAN_STEP_S;
    start <= maximum;
    start += DEFAULT_LONG_SOURCE_SCAN_STEP_S
  ) {
    starts.push(start);
  }
  const tailProbe = Math.floor(Math.max(MIN_OFFICIAL_CLIP_START_S, maximum - 8) / 6) * 6;
  if (tailProbe > highestBaseStart && tailProbe <= maximum) starts.push(tailProbe);
  return starts;
}

function exploratoryStartsForSource(baseStarts, record = {}, opts = {}) {
  const duration = sourceDurationSeconds(record);
  if (opts.allowEarlyExploratoryWindows === true) {
    const maximum = maximumClipStartForSource(record);
    return uniqueNumberList(baseStarts).filter(
      (seconds) =>
        seconds >= EARLY_EXPLORATORY_MIN_START_S &&
        (!Number.isFinite(maximum) || seconds <= maximum),
    );
  }
  if (!Number.isFinite(duration) || duration > MIN_OFFICIAL_CLIP_START_S + SAFE_FRAME_LEAD_OUT_S) {
    const starts = durationAwareDefaultStarts(baseStarts, record, {
      expandLongSources: opts.expandLongSources === true,
    });
    return uniqueNumberList(starts.filter((seconds) => seconds >= MIN_OFFICIAL_CLIP_START_S));
  }
  const maximum = maximumClipStartForSource(record);
  const durationMinimum = minimumClipStartForSource(record);
  const minimum = Number.isFinite(maximum) && maximum < 4
    ? Math.max(0, Math.min(maximum, durationMinimum))
    : Math.max(4, durationMinimum);
  if (!Number.isFinite(maximum) || maximum < minimum) return [];

  const relativeStarts = [
    minimum,
    duration * 0.42,
    duration * 0.58,
    maximum,
  ];
  return uniqueNumberList(
    [...relativeStarts, ...baseStarts]
      .map((seconds) => boundClipStartForSource(seconds, record))
      .filter((seconds) => seconds >= minimum && seconds <= maximum),
  );
}

function safeClipStartFromFrame(frame) {
  const targetSeconds = Number(frame?.target_time_seconds);
  if (!Number.isFinite(targetSeconds)) return minimumClipStartForSource(frame);
  return boundClipStartForSource(targetSeconds + SAFE_FRAME_LEAD_OUT_S, frame);
}

function clipStartCandidatesFromFrame(frame, opts = {}) {
  const after = safeClipStartFromFrame(frame);
  const targetSeconds = Number(frame?.target_time_seconds);
  if (opts.includeFrameAnchoredWindows !== true || !Number.isFinite(targetSeconds)) {
    return [
      {
        mediaStartS: after,
        clipStartPolicy: "start_after_accepted_safe_frame",
      },
    ];
  }
  const before = boundClipStartForSource(targetSeconds - 2, frame);
  const candidates = [
    {
      mediaStartS: before,
      clipStartPolicy: "start_before_accepted_safe_frame",
    },
    {
      mediaStartS: after,
      clipStartPolicy: "start_after_accepted_safe_frame",
    },
  ];
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.mediaStartS)) return false;
    seen.add(candidate.mediaStartS);
    return true;
  });
}

function scoreOfficialTrailerFrameForClip(frame) {
  if (officialTrailerFrameRejectReason(frame, frame?.qa || {})) return Number.NEGATIVE_INFINITY;
  const qa = frame?.qa || {};
  const prescan = qa.prescan || {};
  const taste = qa.visual_taste || prescan.trailer_frame_taste || classifyTrailerFrameTaste(prescan);
  const edgeDensity = bounded(prescan.edge_density, 0, 0.45);
  const saturation = bounded(prescan.saturation_mean, 0, 0.7);
  const textOverlay = bounded(prescan.text_overlay_likelihood, 0, 0.7);
  const targetSeconds = Number(frame?.target_time_seconds);

  let score = 50;
  score += edgeDensity * 140;
  score += saturation * 60;
  score -= textOverlay * 90;
  if (Number.isFinite(Number(taste.score))) {
    score += (Number(taste.score) - 50) * 0.55;
  }
  if (Array.isArray(taste.tags) && taste.tags.includes("gameplay_candidate")) score += 12;
  if (Array.isArray(taste.tags) && taste.tags.includes("text_heavy")) score -= 10;
  if (prescan.likely_is_logo === true) score -= 55;
  if (qa.verdict === "pass") score += 8;
  if (qa.verdict === "warn") score -= 18;
  if (Number.isFinite(targetSeconds)) {
    if (targetSeconds < 24) score -= 18;
    else if (targetSeconds < MIN_OFFICIAL_CLIP_START_S) score -= 6;
    else score += Math.min(10, targetSeconds / 8);
  }
  return Number(score.toFixed(3));
}

function clipRefDedupeKey(ref) {
  return [
    String(ref?.path || "").trim(),
    String(ref?.entity || "").trim().toLowerCase(),
    Number(ref?.mediaStartS || 0).toFixed(2),
  ].join("|");
}

function dedupeClipRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const key = clipRefDedupeKey(ref);
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function renderSafeTrimTiming({ start, duration, trimmed }) {
  const mediaStartS = Number(start);
  const durationS = Number(duration);
  if (!Number.isFinite(mediaStartS) || !Number.isFinite(durationS) || durationS <= 0) {
    return { mediaStartS, durationS };
  }
  if (trimmed !== true) return { mediaStartS, durationS };
  const headInset = Math.min(TRIMMED_SEGMENT_RENDER_HEAD_INSET_S, Math.max(0, durationS - 1));
  const tailInset = Math.min(
    TRIMMED_SEGMENT_RENDER_TAIL_INSET_S,
    Math.max(0, durationS - headInset - 1),
  );
  return {
    mediaStartS: Number((mediaStartS + headInset).toFixed(2)),
    durationS: Number(Math.max(1, durationS - headInset - tailInset).toFixed(2)),
    headInsetS: Number(headInset.toFixed(2)),
    tailInsetS: Number(tailInset.toFixed(2)),
  };
}

function clipEntityKey(ref) {
  return String(ref?.entity || ref?.provenance?.entity || ref?.path || "unknown")
    .trim()
    .toLowerCase();
}

function clipSourceKey(ref) {
  return [
    String(ref?.path || "").trim(),
    clipEntityKey(ref),
  ].join("|");
}

function steamAppIdFromValue(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d{3,}$/.test(text)) return text;
  const storeTrailerMatch = text.match(/store_trailers[\\/](\d{3,})(?:[\\/]|$)/i);
  if (storeTrailerMatch) return storeTrailerMatch[1];
  const steamFamilyMatch = text.match(/\bsteam[_:-](\d{3,})(?:\b|[_:-])/i);
  if (steamFamilyMatch) return steamFamilyMatch[1];
  const storeAppMatch = text.match(/\bstore[_\s-]?app[_\s-]?id[=:_\s-]+(\d{3,})\b/i);
  return storeAppMatch ? storeAppMatch[1] : null;
}

function steamAppIdForClipRef(ref) {
  for (const value of [
    ref?.provenance?.store_app_id,
    ref?.store_app_id,
    ref?.storeAppId,
    ref?.path,
    ref?.sourceUrl,
    ref?.source_url,
    ref?.sourceFamily,
    ref?.source_family,
    ref?.provenance?.source_family,
    ref?.provenance?.source_url,
  ]) {
    const appId = steamAppIdFromValue(value);
    if (appId) return appId;
  }
  return null;
}

function dominantSteamAppIdsByEntity(refs = []) {
  const groups = new Map();
  refs.forEach((ref) => {
    const appId = steamAppIdForClipRef(ref);
    if (!appId) return;
    const entity = clipEntityKey(ref);
    const group = groups.get(entity) || new Map();
    group.set(appId, (group.get(appId) || 0) + 1);
    groups.set(entity, group);
  });

  const dominant = new Map();
  for (const [entity, counts] of groups.entries()) {
    const ordered = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [topAppId, topCount] = ordered[0] || [];
    if (!topAppId || topCount < 2) continue;
    const tied = ordered.filter(([, count]) => count === topCount);
    if (tied.length === 1) dominant.set(entity, topAppId);
  }
  return dominant;
}

function filterSteamAppOutlierClipRefs(refs) {
  if (!Array.isArray(refs) || refs.length <= 1) return refs;
  const dominantByEntity = dominantSteamAppIdsByEntity(refs);
  if (dominantByEntity.size === 0) return refs;
  return refs.filter((ref) => {
    const expected = dominantByEntity.get(clipEntityKey(ref));
    if (!expected) return true;
    const appId = steamAppIdForClipRef(ref);
    return !appId || appId === expected;
  });
}

function selectBalancedClipRefs(refs, maxClips) {
  const limit = Math.max(1, Number(maxClips || DEFAULT_MAX_CLIPS));
  if (!Array.isArray(refs) || refs.length <= limit) return refs;

  const selected = [];
  const selectedIndexes = new Set();

  const entityOrder = [];
  const byEntity = new Map();
  refs.forEach((ref, index) => {
    const entity = clipEntityKey(ref);
    if (!byEntity.has(entity)) {
      byEntity.set(entity, []);
      entityOrder.push(entity);
    }
    byEntity.get(entity).push({ ref, index });
  });

  let madeProgress = true;
  while (selected.length < limit && madeProgress) {
    madeProgress = false;
    for (const entity of entityOrder) {
      if (selected.length >= limit) break;
      const next = (byEntity.get(entity) || []).find((item) => !selectedIndexes.has(item.index));
      if (!next) continue;
      selected.push(next.ref);
      selectedIndexes.add(next.index);
      madeProgress = true;
    }
  }

  for (let i = 0; i < refs.length && selected.length < limit; i++) {
    if (selectedIndexes.has(i)) continue;
    selected.push(refs[i]);
    selectedIndexes.add(i);
  }

  return selected;
}

function uniqueOfficialSourceRecords(frameReport, storyId) {
  const records = [];
  const seen = new Set();
  for (const plan of Array.isArray(frameReport?.plans) ? frameReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const frame of Array.isArray(plan.frames) ? plan.frames : []) {
      const sourceUrl = String(frame?.source_url || "").trim();
      if (!sourceUrl) continue;
      const sourceType = frame?.source_type || "steam_movie";
      const entity = frame?.entity || null;
      const urlKind = mediaSourceUrlKindFields(sourceUrl);
      if (urlKind.segment_validation_eligible !== true) continue;
      if (missingDurationSteamMicrotrailer(frame)) continue;
      const key = [sourceUrl, String(entity || "").trim().toLowerCase()].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        sourceUrl,
        sourceType,
        sourceFamily: frame.source_family || frame.sourceFamily || null,
        entity,
        sourceDurationS: sourceDurationSeconds(frame),
        ...urlKind,
        referenceReportSource: false,
      });
    }
  }
  return records;
}

function isOfficialReference(record) {
  const sourceType = String(record?.source_type || record?.sourceType || "").toLowerCase();
  const sourceUrl = String(record?.source_url || record?.sourceUrl || record?.local_path || "").trim();
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const provenance = record?.provenance || {};
  const localOfficialYouTubeMaster =
    urlKind.source_url_kind === "local_video_file" &&
    record?.source_verified === true &&
    /^official_youtube_channel(?:_url)?$/.test(sourceType) &&
    provenance.source === "official_youtube_channel_download" &&
    /^https:\/\/(?:www\.)?youtube\.com\/@[^/]+\/?$/i.test(String(provenance.official_channel || "")) &&
    /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[A-Za-z0-9_-]{6,}/i.test(
      String(provenance.reference_url || record?.reference_url || ""),
    ) &&
    /^[a-f0-9]{64}$/i.test(String(provenance.source_sha256 || record?.source_sha256 || ""));
  return (
    Boolean(sourceUrl) &&
    (record?.downloads_allowed !== true || localOfficialYouTubeMaster) &&
    record.segment_validation_eligible !== false &&
    !missingDurationSteamMicrotrailer(record) &&
    urlKind.segment_validation_eligible === true &&
    OFFICIAL_REFERENCE_SOURCE_TYPE_RE.test(sourceType) &&
    !officialMediaReferenceRejectReason(record)
  );
}

function uniqueOfficialReferenceRecords(referenceReport, storyId) {
  const records = [];
  const seen = new Set();
  for (const plan of Array.isArray(referenceReport?.plans) ? referenceReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const reference of Array.isArray(plan.references) ? plan.references : []) {
      if (!isOfficialReference(reference)) continue;
      const sourceUrl = String(reference.source_url || reference.sourceUrl || reference.local_path || "").trim();
      const sourceType = reference.source_type || reference.sourceType || "official_trailer";
      const urlKind = mediaSourceUrlKindFields(sourceUrl);
      const entity = reference.entity || null;
      const key = [sourceUrl, String(entity || "").trim().toLowerCase()].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      records.push({
        sourceUrl,
        sourceType,
        sourceFamily: reference.source_family || reference.sourceFamily || null,
        entity,
        provider: reference.provider || null,
        movieName: reference.movie_name || reference.name || null,
        movieId: reference.movie_id || reference.video_id || null,
        storeAppId: reference.store_app_id || null,
        storeAppTitle: reference.store_app_title || null,
        sourceOwner: reference.source_owner || reference.provenance?.source_owner || null,
        licenceBasis:
          reference.licence_basis ||
          reference.license_basis ||
          reference.provenance?.licence_basis ||
          reference.provenance?.license_basis ||
          null,
        allowedUse: reference.allowed_use || reference.provenance?.allowed_use || null,
        allowedRenderUse: reference.allowed_render_use || null,
        allowedPlatforms: Array.isArray(reference.allowed_platforms)
          ? [...reference.allowed_platforms]
          : Array.isArray(reference.provenance?.allowed_platforms)
            ? [...reference.provenance.allowed_platforms]
            : undefined,
        restrictedPlatforms: Array.isArray(reference.restricted_platforms)
          ? [...reference.restricted_platforms]
          : Array.isArray(reference.provenance?.restricted_platforms)
            ? [...reference.provenance.restricted_platforms]
            : undefined,
        platformRestrictions:
          reference.platform_restrictions && typeof reference.platform_restrictions === "object"
            ? structuredClone(reference.platform_restrictions)
            : reference.provenance?.platform_restrictions &&
                typeof reference.provenance.platform_restrictions === "object"
              ? structuredClone(reference.provenance.platform_restrictions)
              : undefined,
        commercialUseAllowed:
          reference.commercial_use_allowed ?? reference.provenance?.commercial_use_allowed,
        creditRequired: reference.credit_required ?? reference.provenance?.credit_required,
        evidenceReference:
          reference.evidence_reference || reference.provenance?.evidence_reference || null,
        approvalStatus:
          reference.approval_status || reference.provenance?.approval_status || null,
        rightsStatus: reference.rights_status || reference.provenance?.rights_status || null,
        riskScore: reference.risk_score ?? reference.provenance?.risk_score,
        rightsRiskClass: reference.rights_risk_class || null,
        sourceDurationS: sourceDurationSeconds(reference),
        sourceUrlKind: reference.source_url_kind || urlKind.source_url_kind,
        sourceVerified: reference.source_verified === true,
        sourceSha256: reference.source_sha256 || reference.provenance?.source_sha256 || null,
        referenceUrl: reference.reference_url || reference.provenance?.reference_url || null,
        referenceTitle: reference.reference_title || reference.provenance?.reference_title || null,
        sourceOwner: reference.source_owner || reference.provenance?.source_owner || null,
        youtubeVideoId: reference.youtube_video_id || reference.provenance?.youtube_video_id || null,
        originalProvenance: reference.provenance || null,
        segmentValidationEligible: true,
        segmentValidationIneligibleReason: null,
        referenceReportSource: true,
      });
    }
  }
  return records;
}

function rightsProvenanceFields(record = {}) {
  return {
    source_owner: record.sourceOwner || null,
    licence_basis: record.licenceBasis || null,
    allowed_use: record.allowedUse || null,
    allowed_render_use: record.allowedRenderUse || null,
    allowed_platforms: Array.isArray(record.allowedPlatforms)
      ? [...record.allowedPlatforms]
      : undefined,
    restricted_platforms: Array.isArray(record.restrictedPlatforms)
      ? [...record.restrictedPlatforms]
      : undefined,
    platform_restrictions:
      record.platformRestrictions && typeof record.platformRestrictions === "object"
        ? structuredClone(record.platformRestrictions)
        : undefined,
    commercial_use_allowed: record.commercialUseAllowed,
    credit_required: record.creditRequired,
    evidence_reference: record.evidenceReference || null,
    approval_status: record.approvalStatus || null,
    rights_status: record.rightsStatus || null,
    risk_score: record.riskScore,
    rights_risk_class: record.rightsRiskClass || null,
  };
}

function mergeSourceRecords(primary = [], secondary = []) {
  const seen = new Set();
  const out = [];
  const byKey = new Map();
  for (const record of primary.concat(secondary)) {
    const key = [record.sourceUrl, String(record.entity || "").trim().toLowerCase()].join("|");
    if (!key.trim()) continue;
    if (seen.has(key)) {
      const existing = byKey.get(key) || {};
      const merged = { ...existing };
      for (const [field, value] of Object.entries(record || {})) {
        const existingValue = merged[field];
        const hasExisting = existingValue !== null && existingValue !== undefined && existingValue !== "";
        const hasIncoming = value !== null && value !== undefined && value !== "";
        if (!hasExisting && hasIncoming) merged[field] = value;
        if (field === "referenceReportSource" && value === true) merged[field] = true;
      }
      byKey.set(key, merged);
      const index = out.findIndex((item) => {
        const itemKey = [item.sourceUrl, String(item.entity || "").trim().toLowerCase()].join("|");
        return itemKey === key;
      });
      if (index >= 0) out[index] = merged;
      continue;
    }
    seen.add(key);
    byKey.set(key, record);
    out.push(record);
  }
  return out;
}

function buildExploratoryClipRefs(frameReport, storyId, opts = {}) {
  const exploratoryDurationS = Number(
    bounded(opts.exploratoryDurationS ?? opts.exploratory_duration_s ?? 5, 1, 5).toFixed(2),
  );
  const hasExplicitExploratoryStarts =
    Array.isArray(opts.exploratoryStartSeconds) && opts.exploratoryStartSeconds.length > 0;
  const starts = (
    hasExplicitExploratoryStarts
      ? opts.exploratoryStartSeconds
      : DEFAULT_EXPLORATORY_START_SECONDS
  )
    .map((seconds) => Number(seconds))
    .filter((seconds) => Number.isFinite(seconds) && seconds >= 0)
    .map((seconds) => Number(seconds.toFixed(2)));
  const refs = [];
  const records = mergeSourceRecords(
    uniqueOfficialSourceRecords(frameReport, storyId),
    uniqueOfficialReferenceRecords(opts.referenceReport, storyId),
  );
  const pairs = records
    .flatMap((record, recordIndex) =>
      exploratoryStartsForSource(starts, record, {
        expandLongSources: !hasExplicitExploratoryStarts,
        allowEarlyExploratoryWindows: opts.allowEarlyExploratoryWindows === true,
      }).map((start) => ({
        record,
        recordIndex,
        start,
      })),
    )
    .sort((a, b) => {
      const startDelta = a.start - b.start;
      if (Math.abs(startDelta) > QUALITY_TIE_EPSILON) return startDelta;
      return a.recordIndex - b.recordIndex;
    });
  for (const { record, start } of pairs) {
      const maximumStart = maximumClipStartForSource(record);
      if (Number.isFinite(maximumStart) && start > maximumStart) continue;
      refs.push({
        path: record.sourceUrl,
        source: "official-trailer-reference",
        sourceFamily: record.sourceFamily || null,
        sourceType: record.sourceType,
        entity: record.entity,
        durationS: exploratoryDurationS,
        mediaStartS: start,
        sourceDurationS: sourceDurationSeconds(record),
        provenance: {
          target_time_seconds: null,
          frame_local_path: null,
          content_hash: null,
          clip_start_policy: "exploratory_uniform_window",
          min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
          safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
          segment_selection_policy: "deep_scan_uniform_window",
          segment_quality_score: null,
          requires_segment_validation: true,
          segment_validated: false,
          allowed_for_flash_lane: false,
          segment_validation_reason: "exploratory_window_not_sampled",
          exploratory_scan: true,
          exploratory_duration_s: exploratoryDurationS,
          allow_early_exploratory_window: opts.allowEarlyExploratoryWindows === true,
          reference_report_source: record.referenceReportSource === true,
          provider: record.provider || null,
          source_family: record.sourceFamily || null,
          movie_name: record.movieName || null,
          movie_id: record.movieId || null,
          store_app_id: record.storeAppId || null,
          store_app_title: record.storeAppTitle || null,
          ...rightsProvenanceFields(record),
          source_duration_s: sourceDurationSeconds(record),
          source_url_kind: record.sourceUrlKind || record.source_url_kind || null,
          source_verified: record.sourceVerified === true,
          source_sha256: record.sourceSha256 || null,
          reference_url: record.referenceUrl || null,
          reference_title: record.referenceTitle || null,
          source_owner: record.sourceOwner || null,
          youtube_video_id: record.youtubeVideoId || null,
          original_provenance: record.originalProvenance || null,
          segment_validation_eligible: true,
          segment_validation_ineligible_reason: null,
        },
      });
  }
  return filterSteamAppOutlierClipRefs(dedupeClipRefs(refs));
}

function normaliseEntityLabel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseSourceFamilyKey(value) {
  return String(value || "").trim().toLowerCase();
}

function acquisitionPlansForStory(acquisitionPlan, storyId) {
  const plans = Array.isArray(acquisitionPlan?.stories)
    ? acquisitionPlan.stories
    : acquisitionPlan?.story_id
      ? [acquisitionPlan]
      : [];
  return plans.filter((plan) => !storyId || plan?.story_id === storyId || plan?.storyId === storyId);
}

function buildOfficialTrailerClipsFromAcquisitionPlan(acquisitionPlan, referenceReport, storyId = null) {
  const refs = [];
  for (const plan of acquisitionPlansForStory(acquisitionPlan, storyId)) {
    const id = plan?.story_id || plan?.storyId || storyId;
    if (!id) continue;
    const records = uniqueOfficialReferenceRecords(referenceReport, id);
    for (const item of asArray(plan.shopping_list)) {
      const entity = String(item?.entity || "").trim();
      const entityKey = normaliseEntityLabel(entity);
      if (!entityKey) continue;
      const exhaustedSourceFamilies = new Set(
        asArray(item.exhausted_source_families)
          .map((family) => normaliseSourceFamilyKey(family?.key || family?.source_url || family?.sourceUrl))
          .filter(Boolean),
      );
      const matchingRecords = records.filter((record) => {
        if (normaliseEntityLabel(record.entity) !== entityKey) return false;
        const sourceKey = normaliseSourceFamilyKey(record.sourceUrl);
        return !sourceKey || !exhaustedSourceFamilies.has(sourceKey);
      });
      for (const record of matchingRecords) {
        for (const window of asArray(item.suggested_windows)) {
          const start = Number(window?.start_s ?? window?.startS);
          const duration = Number(window?.duration_s ?? window?.durationS);
          if (!Number.isFinite(start)) continue;
          refs.push({
            path: record.sourceUrl,
            source: "official-trailer-reference",
            sourceFamily: record.sourceFamily || null,
            sourceType: record.sourceType,
            entity,
            storyId: id,
            story_id: id,
            durationS: Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(2)) : 4,
            mediaStartS: boundClipStartForSource(start, record),
            sourceDurationS: sourceDurationSeconds(record),
            provenance: {
              target_time_seconds: null,
              frame_local_path: null,
              content_hash: null,
              clip_start_policy: "acquisition_plan_suggested_window",
              min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
              safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
              segment_selection_policy: "flash_lane_acquisition_queue",
              segment_quality_score: null,
              requires_segment_validation: true,
              segment_validated: false,
              allowed_for_flash_lane: false,
              segment_validation_reason: "acquisition_plan_window_not_sampled",
              acquisition_plan_source: true,
              acquisition_plan_story_id: id,
              acquisition_plan_reasons: asArray(item.reasons),
              acquisition_plan_acceptance_criteria: asArray(item.acceptance_criteria),
              reference_report_source: record.referenceReportSource === true,
              provider: record.provider || null,
              source_family: record.sourceFamily || null,
              movie_name: record.movieName || null,
              movie_id: record.movieId || null,
              store_app_id: record.storeAppId || null,
              store_app_title: record.storeAppTitle || null,
              ...rightsProvenanceFields(record),
              source_duration_s: sourceDurationSeconds(record),
              source_url_kind: record.sourceUrlKind || record.source_url_kind || null,
              segment_validation_eligible: true,
              segment_validation_ineligible_reason: null,
              story_id: id,
            },
          });
        }
      }
    }
  }
  return filterSteamAppOutlierClipRefs(dedupeClipRefs(refs));
}

function segmentStoryId(segment) {
  const sample = asArray(segment?.samples)[0];
  const localPath = String(sample?.local_path || sample?.planned_local_path || "");
  const match = localPath.match(/[\\/]assets[\\/]([^\\/]+)[\\/]/i);
  return match ? match[1] : null;
}

function segmentBelongsToStory(segment, storyId) {
  if (!storyId) return true;
  return segment?.story_id === storyId || segmentStoryId(segment) === storyId;
}

function segmentActionScore(segment) {
  const score = Number(segment?.action_score);
  return Number.isFinite(score) ? score : null;
}

function isAllowedGameplaySegment(segment, storyId) {
  const sourceUrl = String(segment?.source_url || segment?.sourceUrl || "").trim();
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const start = Number(segment?.media_start_s ?? segment?.mediaStartS);
  const actionScore = segmentActionScore(segment);
  return (
    Boolean(sourceUrl) &&
    segment?.segment_validation_eligible !== false &&
    urlKind.segment_validation_eligible === true &&
    segmentBelongsToStory(segment, storyId) &&
    Number.isFinite(start) &&
    start >= minimumClipStartForSource(segment) &&
    segment?.segment_validated === true &&
    segment?.allowed_for_flash_lane === true &&
    ALLOWED_RENDER_MOTION_CLASSES.has(String(segment?.segment_motion_class || "")) &&
    Number.isFinite(actionScore)
  );
}

function validatedSegmentClipRefs(segmentValidationReport, storyId) {
  return dedupeClipRefs(
    asArray(segmentValidationReport?.segments)
      .filter((segment) => isAllowedGameplaySegment(segment, storyId))
      .sort((a, b) => {
        const actionDelta = Number(b.action_score || 0) - Number(a.action_score || 0);
        if (Math.abs(actionDelta) > QUALITY_TIE_EPSILON) return actionDelta;
        return Number(a.media_start_s || 0) - Number(b.media_start_s || 0);
      })
      .map((segment) => {
        const sourceUrl = String(segment.source_url || segment.sourceUrl || "").trim();
        const urlKind = mediaSourceUrlKindFields(sourceUrl);
        const start = Number(segment.media_start_s ?? segment.mediaStartS);
        const duration = Number(segment.duration_s ?? segment.durationS);
        const recommendedStart = Number(segment.recommended_media_start_s ?? segment.recommendedMediaStartS);
        const recommendedDuration = Number(segment.recommended_duration_s ?? segment.recommendedDurationS);
        const hasTrimTiming =
          segment.trim_recommended === true &&
          Number.isFinite(recommendedStart) &&
          Number.isFinite(recommendedDuration) &&
          recommendedDuration > 0;
        const selectedStart = hasTrimTiming ? recommendedStart : start;
        const selectedDuration = hasTrimTiming ? recommendedDuration : duration;
        const renderTiming = renderSafeTrimTiming({
          start: selectedStart,
          duration: selectedDuration,
          trimmed: hasTrimTiming,
        });
        return {
          path: sourceUrl,
          source: "official-trailer-reference",
          sourceFamily: segment.source_family || segment.sourceFamily || segment.provenance?.source_family || null,
          sourceType: segment.source_type || segment.sourceType || "steam_movie",
          entity: segment.entity || null,
          durationS:
            Number.isFinite(renderTiming.durationS) && renderTiming.durationS > 0
              ? Number(renderTiming.durationS.toFixed(2))
              : 5,
          mediaStartS: Number(renderTiming.mediaStartS.toFixed(2)),
          sourceDurationS: sourceDurationSeconds(segment),
          provenance: {
            target_time_seconds: null,
            frame_local_path: null,
            content_hash: null,
            clip_start_policy: hasTrimTiming ? "validated_trimmed_segment_window" : "validated_segment_window",
            min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
            safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
            segment_selection_policy: "validated_deep_scan_segment",
            segment_quality_score: Number.isFinite(Number(segment.segment_quality_score))
              ? Number(segment.segment_quality_score)
              : undefined,
            candidate_windows_per_source: null,
            requires_segment_validation: true,
            segment_validated: true,
            allowed_for_flash_lane: true,
            segment_validation_reason: segment.validation_reason || "segment_samples_passed",
            segment_validation_samples: asArray(segment.samples).length,
            segment_motion_class: segment.segment_motion_class || null,
            segment_action_score: segmentActionScore(segment),
            segment_action_sample_count: Number.isFinite(Number(segment.action_sample_count))
              ? Number(segment.action_sample_count)
              : null,
            segment_validation_reported_at: segmentValidationReport?.generated_at || null,
            source_url_kind: segment.source_url_kind || urlKind.source_url_kind,
            source_family: segment.source_family || segment.sourceFamily || segment.provenance?.source_family || null,
            source_duration_s: sourceDurationSeconds(segment),
            segment_validation_eligible: true,
            segment_validation_ineligible_reason: null,
            segment_clip_key: segment.clip_key || null,
            validated_deep_scan_segment: true,
            segment_trim_recommended: hasTrimTiming,
            segment_original_start_s: Number.isFinite(start) ? Number(start.toFixed(2)) : null,
            segment_original_duration_s: Number.isFinite(duration) ? Number(duration.toFixed(2)) : null,
            segment_recommended_start_s: hasTrimTiming ? Number(recommendedStart.toFixed(2)) : null,
            segment_recommended_duration_s: hasTrimTiming ? Number(recommendedDuration.toFixed(2)) : null,
            segment_render_start_s: Number.isFinite(renderTiming.mediaStartS)
              ? Number(renderTiming.mediaStartS.toFixed(2))
              : null,
            segment_render_duration_s: Number.isFinite(renderTiming.durationS)
              ? Number(renderTiming.durationS.toFixed(2))
              : null,
            segment_render_head_inset_s: renderTiming.headInsetS ?? null,
            segment_render_tail_inset_s: renderTiming.tailInsetS ?? null,
            segment_trim_sample_orders: Array.isArray(segment.trim_sample_orders)
              ? [...segment.trim_sample_orders]
              : [],
          },
        };
      }),
  );
}

function applyFrameQualityToDirectSegmentRefs(refs, candidateFrames) {
  const frameQualityBySource = new Map();
  for (const frame of candidateFrames) {
    const sourceUrl = String(frame?.source_url || "").trim();
    if (!sourceUrl) continue;
    const key = clipSourceKey({ path: sourceUrl, entity: frame.entity || null });
    const score = Number(frame.__segment_quality_score);
    if (!Number.isFinite(score)) continue;
    const existing = frameQualityBySource.get(key);
    if (!Number.isFinite(existing) || score > existing) {
      frameQualityBySource.set(key, score);
    }
  }
  if (frameQualityBySource.size === 0) return refs;
  return refs.map((ref) => {
    if (Number.isFinite(Number(ref?.provenance?.segment_quality_score))) return ref;
    const score = frameQualityBySource.get(clipSourceKey(ref));
    if (!Number.isFinite(score)) return ref;
    return {
      ...ref,
      provenance: {
        ...ref.provenance,
        segment_quality_score: Number(score.toFixed(3)),
        segment_frame_quality_score: Number(score.toFixed(3)),
      },
    };
  });
}

function buildOfficialTrailerClipsFromFrameReport(frameReport, storyId, opts = {}) {
  const maxClips = Math.max(1, Number(opts.maxClips || DEFAULT_MAX_CLIPS));
  const maxCandidateWindowsPerSource = Math.max(
    1,
    Number(opts.maxCandidateWindowsPerSource || 1),
  );
  const candidatesBySource = new Map();
  for (const plan of Array.isArray(frameReport?.plans) ? frameReport.plans : []) {
    if (plan?.story_id !== storyId) continue;
    for (const frame of Array.isArray(plan.frames) ? plan.frames : []) {
      if (frame?.status !== "accepted") continue;
      if (officialTrailerFrameRejectReason(frame, frame.qa || {})) continue;
      const sourceUrl = String(frame.source_url || "").trim();
      if (!sourceUrl) continue;
      const urlKind = mediaSourceUrlKindFields(sourceUrl);
      if (frame.segment_validation_eligible === false || urlKind.segment_validation_eligible !== true) {
        continue;
      }
      const targetSeconds = Number(frame.target_time_seconds);
      const qualityScore = scoreOfficialTrailerFrameForClip(frame);
      if (!Number.isFinite(qualityScore)) continue;
      const list = candidatesBySource.get(sourceUrl) || [];
      list.push({
        ...frame,
        source_url_kind: frame.source_url_kind || urlKind.source_url_kind,
        segment_validation_eligible: true,
        segment_validation_ineligible_reason: null,
        __segment_quality_score: qualityScore,
        __target_seconds_for_tie_break: Number.isFinite(targetSeconds) ? targetSeconds : 0,
      });
      candidatesBySource.set(sourceUrl, list);
    }
  }
  const multiWindowMode = maxCandidateWindowsPerSource > 1;
  const candidateFrames = [...candidatesBySource.values()]
    .flatMap((frames) =>
      frames
        .sort((a, b) => {
          const scoreDelta = b.__segment_quality_score - a.__segment_quality_score;
          if (Math.abs(scoreDelta) > QUALITY_TIE_EPSILON) return scoreDelta;
          return b.__target_seconds_for_tie_break - a.__target_seconds_for_tie_break;
        })
        .slice(0, maxCandidateWindowsPerSource),
    )
    .sort((a, b) => {
      if (multiWindowMode && a.source_url === b.source_url) {
        return a.__target_seconds_for_tie_break - b.__target_seconds_for_tie_break;
      }
      const scoreDelta = b.__segment_quality_score - a.__segment_quality_score;
      if (Math.abs(scoreDelta) > QUALITY_TIE_EPSILON) return scoreDelta;
      return b.__target_seconds_for_tie_break - a.__target_seconds_for_tie_break;
    });
  const allRefs = candidateFrames
    .flatMap((frame) =>
      clipStartCandidatesFromFrame(frame, {
        includeFrameAnchoredWindows: opts.includeFrameAnchoredWindows,
      }).map((startCandidate) => ({
        frame,
        startCandidate,
      })),
    )
    .map(({ frame, startCandidate }) => {
      const targetSeconds = Number(frame.target_time_seconds);
      return {
        path: String(frame.source_url || "").trim(),
        source: "official-trailer-reference",
        sourceFamily: frame.source_family || frame.sourceFamily || null,
        sourceType: frame.source_type || "steam_movie",
        entity: frame.entity || null,
        durationS: 5,
        mediaStartS: startCandidate.mediaStartS,
        sourceDurationS: sourceDurationSeconds(frame),
        provenance: {
          target_time_seconds: Number.isFinite(targetSeconds) ? targetSeconds : null,
          frame_local_path: frame.local_path || null,
          content_hash: frame.qa?.content_hash || null,
          clip_start_policy: startCandidate.clipStartPolicy,
          min_start_seconds: MIN_OFFICIAL_CLIP_START_S,
          safe_frame_lead_out_seconds: SAFE_FRAME_LEAD_OUT_S,
          segment_selection_policy: multiWindowMode
            ? "ranked_quality_candidate_window"
            : "highest_quality_safe_frame",
          segment_quality_score: frame.__segment_quality_score ?? null,
          source_family: frame.source_family || frame.sourceFamily || null,
          source_url_kind: frame.source_url_kind || null,
          source_duration_s: sourceDurationSeconds(frame),
          segment_validation_eligible: true,
          segment_validation_ineligible_reason: null,
          candidate_windows_per_source: maxCandidateWindowsPerSource,
          requires_segment_validation: true,
          segment_validated: false,
          allowed_for_flash_lane: false,
          segment_validation_reason: "segment_window_not_sampled_by_frame_qa",
        },
      };
    });
  const exploratoryRefs =
    opts.includeExploratoryWindows === true
      ? buildExploratoryClipRefs(frameReport, storyId, opts)
      : [];
  const uniqueRefs = filterSteamAppOutlierClipRefs(dedupeClipRefs([...allRefs, ...exploratoryRefs]));
  const refs =
    opts.requireValidatedSegments === true
      ? uniqueRefs
      : selectBalancedClipRefs(uniqueRefs, maxClips);
  const segmentAwareRefs = opts.segmentValidationReport
    ? applySegmentValidationToClipRefs(refs, opts.segmentValidationReport)
    : refs;
  const directSegmentRefs =
    opts.requireValidatedSegments === true && opts.segmentValidationReport
      ? applyFrameQualityToDirectSegmentRefs(
          validatedSegmentClipRefs(opts.segmentValidationReport, storyId),
          candidateFrames,
        )
      : [];
  return opts.requireValidatedSegments
    ? filterSteamAppOutlierClipRefs(dedupeClipRefs([
        ...directSegmentRefs,
        ...segmentAwareRefs.filter((ref) => ref?.provenance?.allowed_for_flash_lane === true),
      ]))
        .slice(0, maxClips)
    : filterSteamAppOutlierClipRefs(segmentAwareRefs);
}

module.exports = {
  buildOfficialTrailerClipsFromFrameReport,
  buildOfficialTrailerClipsFromAcquisitionPlan,
  buildExploratoryClipRefs,
  selectBalancedClipRefs,
  DEFAULT_EXPLORATORY_START_SECONDS,
  safeClipStartFromFrame,
  scoreOfficialTrailerFrameForClip,
  MIN_OFFICIAL_CLIP_START_S,
  SAFE_FRAME_LEAD_OUT_S,
  clipStartCandidatesFromFrame,
};
