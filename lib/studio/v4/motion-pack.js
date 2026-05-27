"use strict";

const { mediaSourceUrlKindFields } = require("../../media-source-url-kind");
const {
  officialMediaReferenceRejectReason,
} = require("../../official-media-reference-preflight");
const { buildFootageEmpirePlan } = require("./footage-empire");

const MIN_SEGMENT_ACTION_SCORE = 70;
const MIN_CLIP_DURATION_S = 1.2;
const PROMO_CARD_SOURCE_RE =
  /\b(?:pre[-_\s]?order|bonus|welcome[-_\s]?pack|car[-_\s]?pass|voucher|edition[-_\s]?(?:card|pack)|promo[-_\s]?card|static[-_\s]?card|storefront[-_\s]?card|legend[-_\s]?video)\b/i;
const SPECIALISED_VISUAL_SOURCE_RE =
  /\b(?:accessibility|colourblind|colorblind|high[-_\s]?contrast|visual[-_\s]?aid)\b/i;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [];
      }
    }
  }
  return typeof value === "object" ? [value] : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseFamily(value) {
  return (
    cleanText(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || null
  );
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function storyId(story = {}) {
  return cleanText(story.id || story.story_id);
}

function storyProductMotionText(story = {}) {
  return [
    story.canonical_subject,
    story.canonical_game,
    story.canonical_company,
    story.title,
    story.suggested_title,
    story.short_title,
    story.suggested_thumbnail_text,
    story.full_script,
    story.tts_script,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function storyAllowsOfficialProductMotion(story = {}) {
  const text = storyProductMotionText(story);
  return /\b(?:ps5|playstation\s*5|xbox\s*(?:wireless\s*)?controller|controller|console|hardware|steam\s*deck|switch\s*2|dualsense|accessor(?:y|ies)|peripheral)\b/i.test(
    text,
  );
}

function segmentStoryId(segment = {}) {
  return cleanText(
    segment.story_id ||
      segment.storyId ||
      segment.provenance?.story_id ||
      segment.provenance?.storyId,
  );
}

function segmentSourceUrl(segment = {}) {
  return cleanText(segment.source_url || segment.sourceUrl || segment.path || segment.source);
}

function sourceFamilyFromUrl(value) {
  const text = cleanText(value);
  if (!text) return null;
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.replace(/^www\./i, "");
    const steam = text.match(/store_trailers\/(\d+)\/(\d+)/i);
    if (steam) return normaliseFamily(`steam_${steam[1]}_${steam[2]}`);
    return normaliseFamily(host.split(".").slice(0, -1).join("_") || host);
  } catch {
    const withoutExt = text.replace(/\.[a-z0-9]+(?:[?#].*)?$/i, "");
    return normaliseFamily(withoutExt.split(/[\\/]/).pop());
  }
}

function sourceAssetKeyFromUrl(value) {
  const text = cleanText(value);
  if (!text) return null;
  const steam = text.match(/store_trailers\/(\d+)\/(\d+)/i);
  if (steam) return `steam:${steam[1]}:${steam[2]}`;
  try {
    const parsed = new URL(text);
    parsed.search = "";
    parsed.hash = "";
    return parsed.href.toLowerCase();
  } catch {
    return text.replace(/[?#].*$/, "").toLowerCase();
  }
}

function segmentSourceFamily(segment = {}) {
  const explicitFamily =
    normaliseFamily(segment.source_family) ||
    normaliseFamily(segment.sourceFamily) ||
    normaliseFamily(segment.provenance?.source_family) ||
    normaliseFamily(segment.provenance?.sourceFamily);
  const provider = normaliseFamily(segment.provider);
  const urlFamily = sourceFamilyFromUrl(segmentSourceUrl(segment));
  const steamUrlFamily = urlFamily && urlFamily.startsWith("steam_") ? urlFamily : null;
  if (steamUrlFamily && explicitFamily && explicitFamily.startsWith("steam_")) {
    return steamUrlFamily;
  }
  if (explicitFamily && explicitFamily !== "steam") return explicitFamily;
  const storeAppId = cleanText(segment.store_app_id || segment.storeAppId || segment.provenance?.store_app_id);
  const movieId = cleanText(segment.movie_id || segment.movieId || segment.provenance?.movie_id);
  if (
    (explicitFamily === "steam" || provider === "steam") &&
    /^\d+$/.test(storeAppId) &&
    /^\d+$/.test(movieId)
  ) {
    return `steam_${storeAppId}_${movieId}`;
  }
  if (!explicitFamily && steamUrlFamily && (!provider || provider === "steam")) {
    return steamUrlFamily;
  }
  return (
    explicitFamily ||
    normaliseFamily(segment.trusted_footage_source_id) ||
    provider ||
    normaliseFamily(segment.source) ||
    urlFamily ||
    "unknown"
  );
}

function segmentSourceAssetKey(segment = {}) {
  return sourceAssetKeyFromUrl(segmentSourceUrl(segment));
}

function clipWindow(asset = {}) {
  const timing = selectedTiming(asset);
  if (timing.mediaStartS === null || timing.durationS === null) return null;
  const start = Number(timing.mediaStartS);
  const end = Number((start + Number(timing.durationS)).toFixed(2));
  return { start, end };
}

function hasWindowConflict(segment = {}, accepted = [], gapSeconds = 1) {
  const assetKey = segmentSourceAssetKey(segment);
  const candidateWindow = clipWindow(segment);
  if (!assetKey || !candidateWindow) return false;
  for (const clip of accepted) {
    if (segmentSourceAssetKey(clip) !== assetKey) continue;
    const existingWindow = clipWindow(clip);
    if (!existingWindow) continue;
    const tooClose =
      candidateWindow.start < existingWindow.end + gapSeconds &&
      existingWindow.start < candidateWindow.end + gapSeconds;
    if (tooClose) return true;
  }
  return false;
}

function trustedSourceFamilies(report = {}, story = {}) {
  const wantedStoryId = storyId(story);
  const families = new Set();
  for (const candidate of asArray(report.story_candidates)) {
    const candidateStoryId = cleanText(candidate.story_id);
    if (wantedStoryId && candidateStoryId && candidateStoryId !== wantedStoryId) continue;
    const family = segmentSourceFamily(candidate);
    if (family && family !== "unknown") families.add(family);
  }
  for (const source of asArray(report.accepted_sources)) {
    const family = segmentSourceFamily(source);
    if (family && family !== "unknown") families.add(family);
  }
  return families;
}

function selectedTiming(segment = {}) {
  const trim = segment.trim_recommended === true;
  const recommendedStart = numberOrNull(
    segment.recommended_media_start_s ?? segment.recommendedMediaStartS,
  );
  const recommendedDuration = numberOrNull(
    segment.recommended_duration_s ?? segment.recommendedDurationS,
  );
  const rawStart = numberOrNull(segment.media_start_s ?? segment.mediaStartS);
  const rawDuration = numberOrNull(segment.duration_s ?? segment.durationS);
  return {
    mediaStartS: trim && recommendedStart !== null ? recommendedStart : rawStart,
    durationS: trim && recommendedDuration !== null ? recommendedDuration : rawDuration,
    trimRecommended: trim && recommendedStart !== null && recommendedDuration !== null,
  };
}

function promoCardSourceFamilyRisk(segment = {}) {
  const haystack = [
    segmentSourceFamily(segment),
    segment.clip_key,
    segment.reference_title,
    segment.referenceTitle,
    segment.movie_name,
    segment.movieName,
    segment.title,
    segment.source_title,
    segment.sourceTitle,
    segment.provenance?.reference_title,
    segment.provenance?.clip_key,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]+/g, " ");
  return PROMO_CARD_SOURCE_RE.test(haystack);
}

function specialisedVisualSourceFamilyRisk(segment = {}) {
  const haystack = [
    segmentSourceFamily(segment),
    segment.clip_key,
    segment.reference_title,
    segment.referenceTitle,
    segment.movie_name,
    segment.movieName,
    segment.title,
    segment.source_title,
    segment.sourceTitle,
    segment.provenance?.reference_title,
    segment.provenance?.clip_key,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ")
    .replace(/[_-]+/g, " ");
  return SPECIALISED_VISUAL_SOURCE_RE.test(haystack);
}

function candidateRejectionReason(segment = {}, options = {}) {
  const sourceUrl = segmentSourceUrl(segment);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const metadataReject = officialMediaReferenceRejectReason(segment);
  const storyFilter = cleanText(options.storyId);
  const segmentId = segmentStoryId(segment);
  const actionScore = numberOrNull(segment.action_score ?? segment.actionScore);
  const timing = selectedTiming(segment);
  const validationReason = cleanText(segment.validation_reason || segment.reason);
  const motionClass = cleanText(segment.segment_motion_class);
  const sourceType = cleanText(segment.source_type || segment.sourceType).toLowerCase();
  const officialProductMotionAllowed =
    motionClass === "official_product_motion" &&
    sourceType.includes("official_platform_product_page") &&
    storyAllowsOfficialProductMotion(options.story || {});
  const officialStorefrontCinematicMotionAllowed =
    motionClass === "official_storefront_cinematic_motion" &&
    validationReason === "official_storefront_cinematic_motion_samples_passed" &&
    (
      sourceType.includes("steam_movie") ||
      sourceType.includes("steam_storefront_video_reference") ||
      sourceType.includes("platform_storefront_video_reference")
    );
  const minActionScore =
    validationReason === "official_product_motion_samples_passed"
      ? Math.min(64, options.minActionScore || MIN_SEGMENT_ACTION_SCORE)
      : validationReason === "short_direct_media_detail_motion_samples_passed"
      ? Math.min(68, options.minActionScore || MIN_SEGMENT_ACTION_SCORE)
      : validationReason === "official_storefront_cinematic_motion_samples_passed"
      ? Math.min(62, options.minActionScore || MIN_SEGMENT_ACTION_SCORE)
      : options.minActionScore || MIN_SEGMENT_ACTION_SCORE;

  if (storyFilter && segmentId && segmentId !== storyFilter) return "story_id_mismatch";
  if (!sourceUrl) return "segment_source_missing";
  if (urlKind.segment_validation_eligible !== true) {
    return urlKind.segment_validation_ineligible_reason || "segment_source_url_not_direct_media";
  }
  if (metadataReject) return `metadata_guard_${metadataReject}`;
  if (promoCardSourceFamilyRisk(segment)) return "promo_card_source_family";
  if (specialisedVisualSourceFamilyRisk(segment)) return "specialised_visual_source_family";
  if (segment.segment_validated !== true) return "segment_not_validated";
  if (segment.allowed_for_flash_lane !== true) return "segment_not_allowed_for_flash_lane";
  if (
    motionClass !== "gameplay_action" &&
    !officialProductMotionAllowed &&
    !officialStorefrontCinematicMotionAllowed
  ) {
    return "segment_not_gameplay_action";
  }
  if (actionScore === null || actionScore < minActionScore) {
    return "segment_action_score_too_low";
  }
  if (timing.mediaStartS === null) return "segment_start_missing";
  if (timing.durationS === null || timing.durationS < MIN_CLIP_DURATION_S) {
    return "segment_duration_too_short";
  }
  return null;
}

function clipFromSegment(segment = {}, index = 0, trustedFamilies = new Set()) {
  const sourceUrl = segmentSourceUrl(segment);
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const family = segmentSourceFamily(segment);
  const timing = selectedTiming(segment);
  const actionScore = numberOrNull(segment.action_score ?? segment.actionScore);
  const samples = asArray(segment.samples);
  const allowedRenderUse = cleanText(
    segment.allowed_render_use ||
      segment.allowedRenderUse ||
      segment.provenance?.allowed_render_use,
  );
  const rightsRiskClass = cleanText(
    segment.rights_risk_class ||
      segment.rightsRiskClass ||
      segment.provenance?.rights_risk_class,
  );

  return {
    id: cleanText(segment.clip_id || segment.id || `v4_motion_${index + 1}_${family}`),
    type: "motion_clip",
    source_family: family,
    path: sourceUrl,
    source_url: sourceUrl,
    source_kind: urlKind.source_url_kind,
    source_url_kind: urlKind.source_url_kind,
    source_type: segment.source_type || segment.sourceType || null,
    provider: segment.provider || null,
    entity: segment.entity || segment.provenance?.entity || null,
    mediaStartS: Number(timing.mediaStartS.toFixed(2)),
    durationS: Number(timing.durationS.toFixed(2)),
    validated: true,
    segmentValidationPassed: true,
    allowed_render_use: allowedRenderUse || "reference_only_by_default",
    rights_risk_class: rightsRiskClass || "official_reference_only",
    trusted_source_matched:
      trustedFamilies.size === 0 || trustedFamilies.has(family) || family === "unknown"
        ? trustedFamilies.has(family)
        : false,
    provenance: {
      source: "visual_v4_motion_pack",
      source_report:
        segment.source_report ||
        segment.provenance?.source_report ||
        "official_trailer_segment_validation",
      story_id: segmentStoryId(segment) || null,
      clip_key: segment.clip_key || null,
      reference_title:
        segment.reference_title ||
        segment.movie_name ||
        segment.movieName ||
        segment.title ||
        null,
      movie_id: segment.movie_id || segment.movieId || null,
      store_app_id: segment.store_app_id || segment.storeAppId || null,
      store_app_title: segment.store_app_title || segment.storeAppTitle || null,
      validation_reason: segment.validation_reason || null,
      segment_motion_class: segment.segment_motion_class || null,
      segment_action_score: actionScore,
      segment_action_sample_count: numberOrNull(segment.action_sample_count),
      segment_validation_samples: samples.length,
      segment_validation_reported_at: null,
      segment_trim_recommended: timing.trimRecommended,
      segment_original_start_s: numberOrNull(segment.media_start_s ?? segment.mediaStartS),
      segment_original_duration_s: numberOrNull(segment.duration_s ?? segment.durationS),
      segment_render_start_s: Number(timing.mediaStartS.toFixed(2)),
      segment_render_duration_s: Number(timing.durationS.toFixed(2)),
      sample_paths: samples.map((sample) => sample.local_path || sample.planned_local_path).filter(Boolean),
    },
  };
}

function segmentFromPreviousClip(clip = {}) {
  const sourceUrl = segmentSourceUrl(clip);
  const timing = selectedTiming({
    media_start_s: clip.mediaStartS ?? clip.media_start_s,
    duration_s: clip.durationS ?? clip.duration_s,
  });
  const family = segmentSourceFamily(clip);
  const provenance = clip.provenance || {};
  const actionScore = numberOrNull(
    clip.action_score ??
      clip.actionScore ??
      provenance.segment_action_score ??
      provenance.action_score,
  );
  if (!sourceUrl || !family || family === "unknown") return null;
  if (clip.validated !== true || clip.segmentValidationPassed !== true) return null;
  if (timing.mediaStartS === null || timing.durationS === null) return null;
  return {
    story_id: provenance.story_id || null,
    clip_id: clip.id || null,
    clip_key:
      provenance.clip_key ||
      [sourceUrl, clip.entity || provenance.entity || "", timing.mediaStartS].join("|"),
    source_url: sourceUrl,
    source_family: family,
    source_type: clip.source_type || clip.sourceType || null,
    provider: clip.provider || null,
    entity: clip.entity || provenance.entity || null,
    media_start_s: timing.mediaStartS,
    duration_s: timing.durationS,
    segment_validated: true,
    allowed_for_flash_lane: true,
    segment_motion_class: provenance.segment_motion_class || "gameplay_action",
    action_score: actionScore === null ? MIN_SEGMENT_ACTION_SCORE : actionScore,
    action_sample_count: numberOrNull(provenance.segment_action_sample_count) || 1,
    validation_reason: provenance.validation_reason || "previous_motion_pack_clip_preserved",
    allowed_render_use: clip.allowed_render_use || clip.allowedRenderUse || null,
    rights_risk_class: clip.rights_risk_class || clip.rightsRiskClass || null,
    source_report: "previous_visual_v4_motion_pack",
    samples: asArray(provenance.sample_paths).map((samplePath) => ({ local_path: samplePath })),
  };
}

function previousMotionPackSegments(previousMotionPack = {}) {
  return asArray(previousMotionPack.clips)
    .map(segmentFromPreviousClip)
    .filter(Boolean);
}

function segmentSelectionScore(segment = {}) {
  let score = Number(segment.action_score || segment.actionScore || 0);
  const timing = selectedTiming(segment);
  const reason = cleanText(segment.validation_reason || segment.reason);
  const shortTrimmedMontage = isShortTrimmedMontage(segment);
  if (
    cleanText(segment.source_report || segment.provenance?.source_report) ===
      "previous_visual_v4_motion_pack" &&
    !shortTrimmedMontage
  ) {
    score += 20;
  }
  if (shortTrimmedMontage) score -= 26;
  if (reason === "segment_samples_passed") score += 8;
  if (Number(timing.durationS || 0) >= 4.5) score += 4;
  return score;
}

function isShortTrimmedMontage(segment = {}) {
  const timing = selectedTiming(segment);
  const reason = cleanText(segment.validation_reason || segment.reason);
  return (
    (timing.trimRecommended || /^trimmed_/i.test(reason)) &&
    Number(timing.durationS || segment.duration_s || segment.durationS || 0) <= 3.2
  );
}

function segmentSort(a, b) {
  const scoreDelta = segmentSelectionScore(b) - segmentSelectionScore(a);
  if (scoreDelta) return scoreDelta;
  const startDelta =
    Number(a.media_start_s ?? a.mediaStartS ?? 0) - Number(b.media_start_s ?? b.mediaStartS ?? 0);
  return startDelta || 0;
}

function segmentStartSort(a, b) {
  const aStart = Number(selectedTiming(a.segment || a).mediaStartS ?? 0);
  const bStart = Number(selectedTiming(b.segment || b).mediaStartS ?? 0);
  return aStart - bStart || segmentSelectionScore(b.segment || b) - segmentSelectionScore(a.segment || a);
}

function buildVisualV4MotionPack({
  story = {},
  trustedFootageReport = {},
  segmentValidationReport = {},
  previousMotionPack = {},
  maxClips = 12,
  minActionScore = MIN_SEGMENT_ACTION_SCORE,
  generatedAt = new Date().toISOString(),
} = {}) {
  const wantedStoryId = storyId(story);
  const trustedFamilies = trustedSourceFamilies(trustedFootageReport, story);
  const accepted = [];
  const rejected = [];
  const usedFamilies = new Set();
  const usedSourceAssets = new Set();
  const sourceAssetFamilies = new Map();
  const duplicateFamilyCandidates = [];
  const duplicateAssetCandidates = [];
  const requirementsProbe = buildFootageEmpirePlan({
    story,
    trustedFootageReport,
    localMotionClips: [],
    generatedAt,
  });
  const requiredMotionScenes = Number(
    requirementsProbe.motion_budget?.required_motion_scenes || 0,
  );
  const requiredDistinctFamilies = Number(
    requirementsProbe.motion_budget?.required_distinct_families || 0,
  );

  function acceptSegment(segment, options = {}) {
    const family = options.sourceFamilyOverride || segmentSourceFamily(segment);
    const sourceAssetKey = segmentSourceAssetKey(segment);
    const clip = clipFromSegment(segment, accepted.length, trustedFamilies);
    if (options.sourceFamilyOverride) {
      clip.source_family = family;
      clip.id = cleanText(segment.clip_id || segment.id || `v4_motion_${accepted.length + 1}_${family}`);
      clip.trusted_source_matched =
        trustedFamilies.size === 0 || family === "unknown" ? trustedFamilies.has(family) : trustedFamilies.has(family);
    }
    clip.provenance.segment_validation_reported_at =
      segmentValidationReport.generated_at || null;
    accepted.push(clip);
    usedFamilies.add(family);
    if (sourceAssetKey) {
      usedSourceAssets.add(sourceAssetKey);
      if (!sourceAssetFamilies.has(sourceAssetKey)) sourceAssetFamilies.set(sourceAssetKey, family);
    }
  }

  const candidateSegments = [
    ...previousMotionPackSegments(previousMotionPack),
    ...asArray(segmentValidationReport.segments),
  ].sort(segmentSort);

  for (const segment of candidateSegments) {
    const base = {
      story_id: segmentStoryId(segment) || null,
      source_family: segmentSourceFamily(segment),
      source_url: segmentSourceUrl(segment) || null,
      media_start_s: numberOrNull(segment.media_start_s ?? segment.mediaStartS),
      duration_s: numberOrNull(segment.duration_s ?? segment.durationS),
      action_score: numberOrNull(segment.action_score ?? segment.actionScore),
    };
    const reason = candidateRejectionReason(segment, {
      storyId: wantedStoryId,
      minActionScore,
      story,
    });
    if (reason) {
      rejected.push({ ...base, reason });
      continue;
    }

    const family = segmentSourceFamily(segment);
    if (usedFamilies.has(family)) {
      duplicateFamilyCandidates.push({ segment, base });
      continue;
    }
    const sourceAssetKey = segmentSourceAssetKey(segment);
    if (sourceAssetKey && usedSourceAssets.has(sourceAssetKey)) {
      duplicateAssetCandidates.push({ segment, base });
      continue;
    }
    acceptSegment(segment);
    if (accepted.length >= Math.max(1, Number(maxClips) || 12)) break;
  }

  const maxClipCount = Math.max(1, Number(maxClips) || 12);
  const repeatFamilyAccepted = new Set();
  const repeatFamilyCounts = new Map();
  const consumedRepeatCandidates = new Set();
  const targetClipCount = Math.min(maxClipCount, requiredMotionScenes || maxClipCount);
  if (accepted.length < targetClipCount) {
    const repeatCandidatesByTimeline = duplicateFamilyCandidates
      .map((item, index) => ({ ...item, duplicateIndex: index }))
      .sort(segmentStartSort);
    for (const item of repeatCandidatesByTimeline) {
      if (accepted.length >= maxClipCount) break;
      if (requiredMotionScenes && accepted.length >= requiredMotionScenes) break;
      const family = segmentSourceFamily(item.segment);
      const distinctFamilyFloorMet = usedFamilies.size >= requiredDistinctFamilies;
      if (isShortTrimmedMontage(item.segment)) {
        rejected.push({ ...item.base, reason: "repeat_short_trimmed_montage_not_allowed" });
        consumedRepeatCandidates.add(item.duplicateIndex);
        continue;
      }
      const familyRepeatCount = repeatFamilyCounts.get(family) || 0;
      if (distinctFamilyFloorMet && repeatFamilyAccepted.has(family)) {
        rejected.push({ ...item.base, reason: "source_family_repeat_limit_reached" });
        consumedRepeatCandidates.add(item.duplicateIndex);
        continue;
      }
      if (hasWindowConflict(item.segment, accepted)) {
        rejected.push({ ...item.base, reason: "source_asset_window_too_close" });
        consumedRepeatCandidates.add(item.duplicateIndex);
        continue;
      }
      acceptSegment(item.segment);
      repeatFamilyAccepted.add(family);
      repeatFamilyCounts.set(family, familyRepeatCount + 1);
      consumedRepeatCandidates.add(item.duplicateIndex);
    }
  }

  const consumedAssetCandidates = new Set();
  if (accepted.length < targetClipCount) {
    const assetCandidatesByTimeline = duplicateAssetCandidates
      .map((item, index) => ({ ...item, duplicateIndex: index }))
      .sort(segmentStartSort);
    for (const item of assetCandidatesByTimeline) {
      if (accepted.length >= maxClipCount) break;
      if (requiredMotionScenes && accepted.length >= requiredMotionScenes) break;
      const sourceAssetKey = segmentSourceAssetKey(item.segment);
      const canonicalFamily =
        (sourceAssetKey && sourceAssetFamilies.get(sourceAssetKey)) || segmentSourceFamily(item.segment);
      if (isShortTrimmedMontage(item.segment)) {
        rejected.push({ ...item.base, reason: "repeat_short_trimmed_montage_not_allowed" });
        consumedAssetCandidates.add(item.duplicateIndex);
        continue;
      }
      if (hasWindowConflict(item.segment, accepted)) {
        rejected.push({ ...item.base, reason: "source_asset_window_too_close" });
        consumedAssetCandidates.add(item.duplicateIndex);
        continue;
      }
      acceptSegment(item.segment, { sourceFamilyOverride: canonicalFamily });
      consumedAssetCandidates.add(item.duplicateIndex);
    }
  }

  duplicateFamilyCandidates.forEach((item, index) => {
    if (consumedRepeatCandidates.has(index)) return;
    rejected.push({ ...item.base, reason: "source_family_already_used" });
  });
  duplicateAssetCandidates.forEach((item, index) => {
    if (consumedAssetCandidates.has(index)) return;
    rejected.push({ ...item.base, reason: "source_asset_already_used" });
  });

  const footagePlan = buildFootageEmpirePlan({
    story,
    trustedFootageReport,
    localMotionClips: accepted,
    generatedAt,
  });

  return {
    schema_version: 1,
    generated_at: generatedAt,
    execution_mode: "visual_v4_motion_pack_builder",
    local_only: true,
    story_id: wantedStoryId || null,
    title: story.title || null,
    readiness: footagePlan.readiness,
    clips: accepted,
    rejected_candidates: rejected,
    motion_budget: footagePlan.motion_budget,
    trusted_source_pipeline: footagePlan.trusted_source_pipeline,
    handoff: {
      visual_v4_local_motion_clips: accepted,
    },
    safety: {
      local_only: true,
      planner_only: true,
      video_downloads_started: false,
      retained_video_files: false,
      browser_scraping_started: false,
      yt_dlp_started: false,
      oauth_triggered: false,
      production_db_mutated: false,
      railway_mutated: false,
      social_posting_triggered: false,
      elevenlabs_required: false,
    },
  };
}

function renderVisualV4MotionPackMarkdown(pack = {}) {
  const lines = [];
  lines.push("# Visual V4 Motion Pack");
  lines.push("");
  lines.push(`Generated: ${pack.generated_at || "unknown"}`);
  lines.push(`Story: ${pack.story_id || "unknown"}`);
  lines.push(`Readiness: ${pack.readiness?.status || "unknown"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- clips: ${asArray(pack.clips).length}`);
  lines.push(`- rejected candidates: ${asArray(pack.rejected_candidates).length}`);
  lines.push(
    `- distinct source families: ${pack.motion_budget?.available_distinct_families ?? 0}/${pack.motion_budget?.required_distinct_families ?? "unknown"}`,
  );
  lines.push(
    `- motion scenes: ${pack.motion_budget?.available_motion_clips ?? 0}/${pack.motion_budget?.required_motion_scenes ?? "unknown"}`,
  );
  lines.push("");
  lines.push("## Clips");
  lines.push("");
  lines.push("| family | start | duration | score | source kind | rights |");
  lines.push("| --- | ---: | ---: | ---: | --- | --- |");
  for (const clip of asArray(pack.clips)) {
    lines.push(
      [
        clip.source_family || "unknown",
        clip.mediaStartS ?? "unknown",
        clip.durationS ?? "unknown",
        clip.provenance?.segment_action_score ?? "unknown",
        clip.source_url_kind || clip.source_kind || "unknown",
        clip.rights_risk_class || "unknown",
      ]
        .map((value) => String(value).replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  if (!asArray(pack.clips).length) {
    lines.push("| none | 0 | 0 | 0 | none | none |");
  }
  lines.push("");
  lines.push("## Rejected");
  lines.push("");
  lines.push("| family | reason | source |");
  lines.push("| --- | --- | --- |");
  for (const rejected of asArray(pack.rejected_candidates).slice(0, 20)) {
    lines.push(
      `| ${rejected.source_family || "unknown"} | ${rejected.reason || "unknown"} | ${rejected.source_url || "none"} |`,
    );
  }
  if (!asArray(pack.rejected_candidates).length) {
    lines.push("| none | none | none |");
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local manifest only.");
  lines.push("- No downloads, retained video files, browser scraping, yt-dlp, DB mutation, OAuth or posting.");
  return lines.join("\n") + "\n";
}

function applyVisualV4MotionPackToStory(story = {}, pack = {}) {
  const clips = asArray(pack.handoff?.visual_v4_local_motion_clips || pack.clips);
  story.visual_v4_motion_pack = pack;
  story.visual_v4_local_motion_clips = clips;
  story.visual_v4_motion_pack_status = pack.readiness?.status || "unknown";
  story.visual_v4_motion_pack_clip_count = clips.length;
  return story;
}

module.exports = {
  buildVisualV4MotionPack,
  renderVisualV4MotionPackMarkdown,
  applyVisualV4MotionPackToStory,
};
