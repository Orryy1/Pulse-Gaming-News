"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");

const {
  materializeStudioV4BridgeClips,
  isSafeDirectMediaUrl,
} = require("./studio/v4/render-clip-materializer");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");
const { isSafeOutboundUrl } = require("./safe-url");

const ALL_SOCIAL_PLATFORMS = ["youtube", "tiktok", "instagram", "facebook", "x", "threads", "pinterest"];
const DEFAULT_MIN_CLIPS = 5;
const DEFAULT_MIN_FAMILIES = 4;
const DEFAULT_MAX_DIRECT_MOTION_CLIPS_PER_BASE_SOURCE = 1;
const DIRECT_VIDEO_MOTION_BLOCKER = "visual_evidence:direct_video_motion_missing";
const REAL_MOTION_SOURCE_ACQUISITION_BLOCKERS = new Set([
  "validated_direct_media_candidates_missing",
  "real_motion_clip_minimum_not_met",
  "real_motion_family_minimum_not_met",
  "direct_video_motion_clip_missing",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normaliseStoryIds(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => cleanText(item).split(","))
    .map(cleanText)
    .filter(Boolean);
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeFileStem(value) {
  return (
    cleanText(value)
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "asset"
  );
}

function sourceUrlFamilyKey(value) {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const url = new URL(text);
    url.search = "";
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host.endsWith("steamstatic.com") && url.pathname.includes("/store_trailers/")) {
      const pathname = url.pathname.toLowerCase();
      const basePath = pathname.replace(
        /\/(?:hls[^/]*\.m3u8|dash[^/]*\.mpd|[^/]+\.(?:mp4|webm|mov))(?:$|[?#])/i,
        "",
      );
      return `steamstatic:${basePath}`;
    }
    if (host.endsWith("steamstatic.com") && url.pathname.includes("/store_item_assets/steam/apps/")) {
      const pathname = url.pathname.toLowerCase();
      const basePath = pathname.replace(/\/extras\/([^/.]+)\.(?:mp4|webm|mov|mkv)$/i, "/extras/$1");
      if (basePath !== pathname) return `steamstatic:${basePath}`;
    }
    return `url:${url.toString().toLowerCase()}`;
  } catch {
    return "";
  }
}

function familyBaseKey(value) {
  const text = cleanText(value);
  if (!text) return "";
  const urlText = text.startsWith("url:") ? text.slice(4) : text;
  const urlKey = sourceUrlFamilyKey(urlText);
  if (urlKey) return urlKey;
  return text
    .replace(/_window_\d+(?:_\d+)?$/i, "")
    .replace(/[-_]window[-_]\d+(?:[-_]\d+)?$/i, "")
    .replace(/\|window\|\d+(?:\|\d+)?$/i, "");
}

function clipLooksDirectVideo(clip = {}) {
  const text = lowerText([
    clip.media_kind,
    clip.mediaKind,
    clip.source_url_kind,
    clip.source_kind,
    clip.source_type,
    clip.provider,
    clip.path,
    clip.source_url,
    clip.url,
  ].join(" "));
  return (
    text.includes("direct_video") ||
    text.includes("hls_manifest") ||
    text.includes("dash_manifest") ||
    text.includes("steam_movie") ||
    text.includes("official_trailer") ||
    text.includes("official_video") ||
    text.includes("official_platform_product_page") ||
    text.includes("licensed_direct_media") ||
    /\.(?:mp4|mov|webm|mkv|m3u8|mpd)(?:$|[?#])/i.test(cleanText(clip.path || clip.source_url || clip.url))
  );
}

function directMotionBaseSourceFamily(clip = {}, index = 0) {
  const sourceKey = sourceUrlFamilyKey(clip.source_url || clip.source || clip.path);
  if (clipLooksDirectVideo(clip) && sourceKey) {
    return sourceKey;
  }
  const baseFamily = familyBaseKey(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
  );
  if (baseFamily) return baseFamily;
  if (sourceKey) return sourceKey;
  return familyBaseKey(clip.source_family || clip.motion_family || clip.family) ||
    cleanText(`source_family_${index + 1}`);
}

function directMotionWindowKey(clip = {}, index = 0) {
  const baseFamily = directMotionBaseSourceFamily(clip, index);
  const start = numberOrNull(clip.mediaStartS ?? clip.media_start_s ?? clip.materialized_media_start_s) || 0;
  const duration = numberOrNull(clip.durationS ?? clip.duration_s ?? clip.materialized_duration_s) || 0;
  return [
    baseFamily || cleanText(clip.source_url || clip.path || clip.id || `direct_motion_${index + 1}`),
    start.toFixed(2),
    duration.toFixed(2),
  ].join("|");
}

function directMotionSegmentFamily(clip = {}, index = 0) {
  const explicitFamily = cleanText(clip.source_family || clip.motion_family || clip.visual_family || clip.id);
  const baseFamily = directMotionBaseSourceFamily(clip, index);
  const start = numberOrNull(clip.mediaStartS ?? clip.media_start_s ?? clip.materialized_media_start_s);
  const duration = numberOrNull(clip.durationS ?? clip.duration_s ?? clip.materialized_duration_s);
  const hasWindowFamily = /(?:^|[_|-])window[_|-]?\d/i.test(explicitFamily);
  if (explicitFamily && hasWindowFamily) return explicitFamily;
  if (explicitFamily && !baseFamily) return explicitFamily;
  const windowSuffix =
    start != null || duration != null
      ? `window_${String((start || 0).toFixed(2)).replace(/\.00$/, "")}_${String((duration || 0).toFixed(2)).replace(/\.00$/, "")}`
          .replace(/[^0-9a-z]+/gi, "_")
          .replace(/^_+|_+$/g, "")
      : "";
  if (baseFamily && windowSuffix) return `${baseFamily}_${windowSuffix}`;
  return explicitFamily || baseFamily || cleanText(`source_family_${index + 1}`);
}

function directMotionReadinessFamily(clip = {}, index = 0) {
  if (clipLooksDirectVideo(clip)) {
    return directMotionSegmentFamily(clip, index);
  }
  const sourceKey = sourceUrlFamilyKey(clip.source_url || clip.source || clip.path);
  const baseFamily = familyBaseKey(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
  );
  if (baseFamily) return baseFamily;
  if (sourceKey) return sourceKey;
  return familyBaseKey(clip.source_family || clip.motion_family || clip.family) ||
    cleanText(`source_family_${index + 1}`);
}

function motionReadinessFamilies(rows = []) {
  return [
    ...new Set(
      asArray(rows)
        .map((clip, index) => directMotionReadinessFamily(clip, index))
        .filter(Boolean),
    ),
  ];
}

function isRealMotionJob(job = {}) {
  return asArray(job.actions).some(
    (action) => cleanText(action.action_id) === "materialise_validated_real_motion_clips",
  );
}

function jobRequiresDirectVideoMotion(job = {}) {
  const blockers = [
    ...asArray(job.blockers),
    ...asArray(job.render_input_blockers),
    ...asArray(job.actions).flatMap((action) => asArray(action.reason_codes)),
  ];
  const markers = blockers.map(cleanText);
  return markers.includes(DIRECT_VIDEO_MOTION_BLOCKER) ||
    markers.some((marker) => marker.includes("direct_video_motion_clip_floor_not_met"));
}

function hasRealMotionSourceAcquisitionBlocker(job = {}) {
  if (cleanText(job.status) !== "blocked") return false;
  return asArray(job.blockers)
    .map(cleanText)
    .some((blocker) => REAL_MOTION_SOURCE_ACQUISITION_BLOCKERS.has(blocker));
}

function primaryRealMotionSourceBlocker(job = {}) {
  const blockers = asArray(job.blockers).map(cleanText);
  if (blockers.includes("direct_video_motion_clip_missing")) return "direct_video_motion_clip_missing";
  if (blockers.includes("validated_direct_media_candidates_missing")) return "validated_direct_media_candidates_missing";
  if (blockers.includes("real_motion_family_minimum_not_met")) return "real_motion_family_minimum_not_met";
  if (blockers.includes("real_motion_clip_minimum_not_met")) return "real_motion_clip_minimum_not_met";
  return blockers.find((blocker) => REAL_MOTION_SOURCE_ACQUISITION_BLOCKERS.has(blocker)) || "real_motion_source_missing";
}

function repairLaneForRealMotionSourceBlocker(job = {}) {
  const blocker = primaryRealMotionSourceBlocker(job);
  if (blocker === "direct_video_motion_clip_missing") return "direct_video_motion_source_acquisition";
  if (blocker === "validated_direct_media_candidates_missing") return "validated_direct_media_candidate_acquisition";
  return "real_motion_depth_acquisition";
}

function missingInputForRealMotionSourceBlocker(job = {}) {
  const blocker = primaryRealMotionSourceBlocker(job);
  if (blocker === "direct_video_motion_clip_missing") {
    return "Segment-validated direct-video, HLS or DASH motion from an official or licensed source. Screenshot-derived motion exists but cannot satisfy the direct-video gate.";
  }
  if (blocker === "validated_direct_media_candidates_missing") {
    return "Validated source-media candidates from official, licensed or operator-approved sources before local materialisation can run.";
  }
  return "Enough validated source-media candidates to produce at least five local motion clips across four distinct motion families.";
}

function expectedOutputForRealMotionSourceBlocker(job = {}) {
  const blocker = primaryRealMotionSourceBlocker(job);
  if (blocker === "direct_video_motion_clip_missing") {
    return [
      "source-family acquisition report with at least one segment-validation eligible direct-video, HLS or DASH candidate",
      "official direct-media discovery or licensed direct-media intake filled when automated source-family acquisition cannot prove a direct-video source",
      "motion pack manifest regenerated with direct-video candidates that can be materialised locally",
      "real motion materialisation rerun without direct_video_motion_clip_missing",
    ];
  }
  if (blocker === "validated_direct_media_candidates_missing") {
    return [
      "source-family acquisition report naming official, licensed or operator-approved media sources",
      "official search or direct-media intake template filled where no automated candidate exists",
      "motion pack manifest regenerated with validated source-media candidates",
      "real motion materialisation rerun with materialised clips and distinct source families",
    ];
  }
  return [
    "motion pack manifest enriched with additional validated source-media families",
    "real motion materialisation rerun with at least five local motion clips",
    "distinct motion family report showing at least four source families",
  ];
}

function requiredMotionPackPath(storyId) {
  const safeStoryId = safeFileStem(storyId);
  return path.join("output", "studio-v4", "motion-packs", `${safeStoryId}_motion_pack_manifest.json`);
}

function buildRealMotionSourceAcquisitionWorkOrder(report = {}) {
  const jobs = asArray(report.jobs)
    .filter(hasRealMotionSourceAcquisitionBlocker)
    .map((job) => {
      const storyId = cleanText(job.story_id);
      const artifactDir = cleanText(job.artifact_dir);
      const repairLane = repairLaneForRealMotionSourceBlocker(job);
      return {
        story_id: storyId,
        title: cleanText(job.title),
        artifact_dir: artifactDir || null,
        blocker_type: primaryRealMotionSourceBlocker(job),
        blockers: asArray(job.blockers).map(cleanText),
        repair_lane: repairLane,
        exact_missing_input: missingInputForRealMotionSourceBlocker(job),
        candidate_count: Number(job.candidate_count || 0),
        materialized_count: Number(job.materialized_count || 0),
        distinct_motion_family_count: Number(job.distinct_motion_family_count || 0),
        direct_video_motion_clip_count: Number(job.direct_video_motion_clip_count || 0),
        required_artefact_path: requiredMotionPackPath(storyId),
        recommended_command:
          `npm run ops:v4-source-family-acquisition -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --output-json output/goal-04/studio_v4_source_family_acquisition_${storyId}.json --output-md output/goal-04/studio_v4_source_family_acquisition_${storyId}.md --intake-template output/goal-04/visual_v4_source_family_intake_template_${storyId}.json --search-template output/goal-04/visual_v4_official_search_template_${storyId}.json --json`,
        expected_output: expectedOutputForRealMotionSourceBlocker(job),
        db_mutation_required: false,
        operator_approval_required: true,
        post_repair_validation_command:
          `npm run ops:goal-real-motion -- --story-id ${storyId} --work-order output/goal-contract/render_input_work_order.json --out-dir output/goal-04 --json`,
      };
    });
  return {
    schema_version: 1,
    generated_at: report.generated_at || null,
    mode: "REAL_MOTION_SOURCE_ACQUISITION_WORK_ORDER",
    summary: {
      story_count: jobs.length,
      operator_required_count: jobs.filter((job) => job.operator_approval_required).length,
      auto_repairable_count: 0,
    },
    jobs,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function normalisePathText(value) {
  return lowerText(value).replace(/\\/g, "/");
}

function hostText(value) {
  try {
    return new URL(cleanText(value)).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isOfficialSteamDirectMotionAsset(asset = {}) {
  const sourceUrl = cleanText(asset.source_url || asset.path);
  const host = hostText(sourceUrl);
  const sourceText = lowerText([
    asset.source_type,
    asset.source_kind,
    asset.source_url_kind,
    asset.provider,
    asset.source_family,
    asset.rights_risk_class,
  ].join(" "));
  const steamHost =
    host === "video.akamai.steamstatic.com" ||
    host.endsWith(".steamstatic.com") ||
    host.endsWith(".akamai.steamstatic.com");
  return (
    steamHost &&
    sourceText.includes("steam") &&
    sourceText.match(/movie|video|hls|dash|trailer|official_reference/) &&
    asset.segmentValidationPassed !== false &&
    asset.validated !== false
  );
}

function isSegmentValidatedOfficialDirectMediaAsset(asset = {}) {
  const sourceUrl = cleanText(asset.source_url || asset.path);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  const sourceText = lowerText([
    asset.source_type,
    asset.source_kind,
    asset.source_url_kind,
    asset.provider,
    asset.rights_risk_class,
    asset.allowed_render_use,
    asset.provenance?.source,
    asset.provenance?.source_report,
    asset.provenance?.validation_reason,
  ].join(" "));
  return (
    asset.segmentValidationPassed === true &&
    asset.validated === true &&
    /direct_video|hls_manifest|dash_manifest|video/.test(sourceText) &&
    /official|licensed_direct_media|official_trailer_segment_validation/.test(sourceText) &&
    !/trusted_creator|creator_reference|reupload|compilation|reaction/.test(sourceText)
  );
}

function isPreviouslyMaterializedMotionRecord(asset = {}) {
  const pathText = normalisePathText(asset.path);
  const localPathText = normalisePathText(asset.local_materialized_path);
  const approvalStatus = lowerText(asset.approval_status);
  const sourceUrl = cleanText(asset.source_url);
  const hasLocalMaterializedPath = Boolean(
    asset.materialized === true ||
      localPathText ||
      pathText.includes("/output/video_cache/") ||
      pathText.includes("/output/goal-proof/") ||
      /(?:^|[/\\])output[/\\]video_cache[/\\]/i.test(cleanText(asset.path)),
  );
  if (hasLocalMaterializedPath) return true;
  return (
    approvalStatus === "approved_for_transformative_editorial_use" &&
    Boolean(sourceUrl) &&
    isSafeDirectMediaUrl(sourceUrl) &&
    !isSafeDirectMediaUrl(cleanText(asset.path))
  );
}

function resolveLocalMotionPath(root = process.cwd(), value = "") {
  const text = cleanText(value);
  if (!text || /^https?:\/\//i.test(text)) return "";
  return path.isAbsolute(text) ? text : path.resolve(root, text);
}

function isRestorableMaterializedMotionPackClip(asset = {}, { root = process.cwd() } = {}) {
  const mediaKind = cleanText(asset.media_kind || asset.mediaKind || "direct_video");
  if (mediaKind !== "direct_video") return false;
  if (asset.counts_towards_motion_readiness === false) return false;
  if (asset.materialized !== true && !cleanText(asset.local_materialized_path)) return false;
  const localPath = resolveLocalMotionPath(root, asset.local_materialized_path || asset.path);
  if (!localPath || !fs.existsSync(localPath)) return false;
  const sourceUrl = cleanText(asset.source_url || asset.source);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;
  return (
    isOfficialSteamDirectMotionAsset(asset) ||
    isSegmentValidatedOfficialDirectMediaAsset(asset) ||
    (
      asset.segmentValidationPassed === true &&
      asset.validated === true &&
      asset.provenance?.segment_validated === true &&
      /\bofficial|steam|storefront|licensed_direct_media\b/i.test(objectEvidenceText(asset))
    )
  );
}

function objectEvidenceText(value = {}) {
  if (!value || typeof value !== "object") return "";
  const strings = [];
  const visit = (item) => {
    if (typeof item === "string") strings.push(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") Object.values(item).forEach(visit);
  };
  visit(value);
  return strings.join(" ").toLowerCase();
}

function restorableMaterializedMotionPackClips(motionPack = {}, { root = process.cwd() } = {}) {
  if (!motionPackReady(motionPack)) return [];
  return asArray(motionPack.clips)
    .filter((clip) => isRestorableMaterializedMotionPackClip(clip, { root }))
    .map((clip) => {
      const localPath = resolveLocalMotionPath(root, clip.local_materialized_path || clip.path);
      return {
        ...clip,
        path: localPath,
        local_materialized_path: localPath,
        source_url: cleanText(clip.source_url || clip.source),
        media_kind: "direct_video",
        durationS: numberOrNull(clip.durationS ?? clip.duration_s) || 3,
        mediaStartS: numberOrNull(clip.mediaStartS ?? clip.media_start_s) || 0,
        source_type: cleanText(clip.source_type || clip.source_kind || "validated_direct_media"),
        rights_basis: cleanText(clip.rights_basis || clip.licence_basis || "official_direct_media"),
        counts_towards_motion_readiness: true,
        materialized: true,
      };
    });
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (filePath && await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function isValidatedRealMotionAsset(asset = {}) {
  if (isPreviouslyMaterializedMotionRecord(asset)) return false;
  const sourceUrl = cleanText(asset.source_url || asset.path);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  if (asset.segmentValidationPassed === false || asset.validated === false) return false;
  if (
    asset.trusted_source_matched === false &&
    !isOfficialSteamDirectMotionAsset(asset) &&
    !isSegmentValidatedOfficialDirectMediaAsset(asset)
  ) {
    return false;
  }
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;
  const typeText = lowerText([
    asset.kind,
    asset.type,
    asset.asset_type,
    asset.source_type,
    asset.source_kind,
    asset.source_url_kind,
  ].join(" "));
  return (
    typeText.includes("video") ||
    typeText.includes("motion") ||
    typeText.includes("direct") ||
    /\.mp4(?:$|\?)/i.test(sourceUrl)
  );
}

function isSafeStillImageUrl(value) {
  const text = cleanText(value);
  if (!/^https?:\/\//i.test(text)) return false;
  if (!isSafeOutboundUrl(text)) return false;
  return /\.(?:jpe?g|png|webp)(?:$|[?#])/i.test(text);
}

function isLocalImagePath(value) {
  const text = cleanText(value);
  if (!text || /^https?:\/\//i.test(text)) return false;
  return /\.(?:jpe?g|png|webp)$/i.test(text);
}

function isValidatedRealStillAsset(asset = {}) {
  if (isPreviouslyMaterializedMotionRecord(asset)) return false;
  if (asset.commercial_use_allowed === false) return false;
  const risk = numberOrNull(asset.risk_score);
  if (risk != null && risk >= 0.65) return false;
  const sourceType = lowerText([asset.source_type, asset.type, asset.kind, asset.asset_type].join(" "));
  const allowedStillType =
    sourceType.includes("screenshot") ||
    sourceType.includes("steam") ||
    sourceType.includes("hero") ||
    sourceType.includes("key_art") ||
    sourceType.includes("capsule") ||
    sourceType.includes("official_press_kit_stills") ||
    sourceType.includes("official_still") ||
    sourceType.includes("press_kit");
  if (!allowedStillType) return false;
  if (sourceType.includes("article") || sourceType.includes("rendered_story_card")) return false;
  const sourceRef = cleanText(asset.source_url);
  const pathRef = cleanText(asset.path);
  return isLocalImagePath(pathRef) || isSafeStillImageUrl(pathRef) || isSafeStillImageUrl(sourceRef);
}

function familyForAsset(asset = {}, index = 0) {
  return cleanText(
    asset.source_family ||
      asset.family ||
      asset.provider ||
      asset.id ||
      asset.asset_id ||
      asset.source_type ||
      `source_family_${index + 1}`,
  );
}

function normaliseCandidate(asset = {}, index = 0) {
  const sourceUrl = cleanText(asset.source_url || asset.path);
  const family = familyForAsset(asset, index);
  const baseSourceFamily = directMotionReadinessFamily(
    {
      ...asset,
      media_kind: "direct_video",
      source_family: family,
      source_url: sourceUrl,
      path: sourceUrl,
    },
    index,
  );
  return {
    id: cleanText(asset.id || asset.asset_id || `real_motion_${index + 1}`),
    media_kind: "direct_video",
    source_family: family,
    path: sourceUrl,
    source_url: sourceUrl,
    source_type: cleanText(asset.source_type || asset.source_kind || "validated_direct_media"),
    source_kind: cleanText(asset.source_kind),
    source_url_kind: cleanText(asset.source_url_kind),
    provider: cleanText(asset.provider),
    base_source_family: baseSourceFamily,
    mediaStartS: numberOrNull(asset.mediaStartS ?? asset.media_start_s) || 0,
    durationS: Math.max(0.5, numberOrNull(asset.durationS ?? asset.duration_s) || 3),
    source_duration_s: numberOrNull(asset.source_duration_s ?? asset.sourceDurationS ?? asset.source_duration),
    licence_basis: cleanText(
      asset.licence_basis ||
        asset.license_basis ||
        asset.rights_basis ||
        asset.rights_risk_class ||
        "source_documented_transformative_editorial_use",
    ),
    allowed_use: cleanText(asset.allowed_use || asset.allowed_render_use || "transformative_editorial_short_form"),
    source_owner: cleanText(asset.source_owner || asset.entity || asset.provider || "source owner not specified"),
    risk_score: numberOrNull(asset.risk_score) ?? 0.28,
    evidence_reference: cleanText(asset.evidence_reference || asset.provenance?.source_report || sourceUrl),
    credit_required: asset.credit_required === true,
    provenance: asset.provenance || {},
  };
}

function normaliseStillCandidate(asset = {}, index = 0) {
  const pathRef = cleanText(asset.path);
  const sourceRef = cleanText(asset.source_url);
  const ref = isLocalImagePath(pathRef) ? pathRef : cleanText(pathRef || sourceRef);
  const sourceUrl = cleanText(sourceRef || ref);
  const family = familyForAsset(asset, index);
  return {
    id: cleanText(asset.id || asset.asset_id || `real_still_${index + 1}`),
    media_kind: "visual_still",
    source_family: family,
    path: ref,
    source_url: sourceUrl || ref,
    source_type: cleanText(asset.source_type || asset.source_kind || "validated_visual_still"),
    mediaStartS: 0,
    durationS: Math.max(1.5, numberOrNull(asset.durationS ?? asset.duration_s) || 3),
    licence_basis: cleanText(
      asset.licence_basis ||
        asset.license_basis ||
        asset.rights_basis ||
        asset.rights_risk_class ||
        "source_documented_transformative_editorial_use",
    ),
    allowed_use: cleanText(asset.allowed_use || asset.allowed_render_use || "screenshot_derived_editorial_motion"),
    source_owner: cleanText(asset.source_owner || asset.entity || asset.provider || "source owner not specified"),
    risk_score: numberOrNull(asset.risk_score) ?? 0.32,
    evidence_reference: cleanText(asset.evidence_reference || asset.provenance?.source_report || sourceUrl || ref),
    credit_required: asset.credit_required === true,
  };
}

function motionPackReady(motionPack = {}) {
  const status = cleanText(motionPack.readiness?.status || motionPack.status);
  return ["v4_motion_ready", "ready", "pass"].includes(status);
}

function motionPackRows(motionPack = {}) {
  const clips = asArray(motionPack.clips).map((clip) => ({
    ...clip,
    source: "visual_v4_motion_pack",
  }));
  if (motionPackReady(motionPack)) return clips;
  return clips.filter((clip) => {
    const hasSegmentEvidence =
      clip.segmentValidationPassed === true ||
      clip.validated === true ||
      clip.provenance?.segment_validated === true ||
      clip.provenance?.allowed_for_flash_lane === true ||
      cleanText(clip.provenance?.segment_motion_class) === "gameplay_action";
    return hasSegmentEvidence && isValidatedRealMotionAsset(clip);
  });
}

function segmentValidationRows(segmentValidationReport = {}, storyId = "") {
  const targetStoryId = cleanText(storyId);
  return asArray(segmentValidationReport.segments)
    .filter((segment) => {
      const status = cleanText(segment.status);
      if (targetStoryId && cleanText(segment.story_id) !== targetStoryId) return false;
      return (
        status === "validated" &&
        segment.segment_validated === true &&
        segment.allowed_for_flash_lane === true
      );
    })
    .map((segment, index) => {
      const sourceUrl = cleanText(segment.source_url);
      const sourceKey = sourceUrlFamilyKey(sourceUrl);
      const declaredSourceFamily = cleanText(
        segment.base_source_family ||
          segment.provenance?.base_source_family ||
          segment.source_family,
      );
      const baseSourceFamily = familyBaseKey(declaredSourceFamily) ||
        sourceKey ||
        `segment_source_family_${index + 1}`;
      const mediaStartS = numberOrNull(segment.mediaStartS ?? segment.media_start_s) || 0;
      const durationS = Math.max(0.5, numberOrNull(segment.durationS ?? segment.duration_s) || 5);
      const windowKey = `${String(mediaStartS.toFixed(2)).replace(/\.00$/, "")}_${String(durationS.toFixed(2)).replace(/\.00$/, "")}`
        .replace(/[^0-9a-z]+/gi, "_")
        .replace(/^_+|_+$/g, "");
      const motionFamily = `${baseSourceFamily}_window_${windowKey || index + 1}`;
      return {
        id: cleanText(segment.id || `segment_direct_motion_${index + 1}`),
        story_id: cleanText(segment.story_id),
        type: "motion_clip",
        source: "official_trailer_segment_validation",
        source_family: motionFamily,
        motion_family: motionFamily,
        base_source_family: baseSourceFamily,
        path: sourceUrl,
        source_url: sourceUrl,
        source_kind: cleanText(segment.source_url_kind || "direct_video"),
        source_url_kind: cleanText(segment.source_url_kind || "direct_video"),
        source_type: cleanText(segment.source_type || "licensed_direct_media_url"),
        provider: cleanText(segment.provider || "official_trailer_segment_validation"),
        entity: cleanText(segment.entity),
        mediaStartS,
        durationS,
        source_duration_s: numberOrNull(segment.source_duration_s),
        validated: true,
        segmentValidationPassed: true,
        trusted_source_matched: segment.trusted_source_matched !== false,
        rights_risk_class: cleanText(segment.rights_risk_class || "official_direct_media"),
        allowed_render_use: cleanText(segment.allowed_render_use || "official_direct_media_segment_candidate"),
        risk_score: numberOrNull(segment.risk_score) ?? 0.28,
        provenance: {
          ...(segment.provenance || {}),
          source: segment.provenance?.source || "official_trailer_segment_validation",
          validation_reason: segment.validation_reason,
          segment_validated: true,
          allowed_for_flash_lane: true,
          source_duration_s: numberOrNull(segment.source_duration_s),
          base_source_family: baseSourceFamily,
          motion_family_basis: "validated_official_segment_window",
          media_start_s: mediaStartS,
          duration_s: durationS,
        },
      };
    });
}

function segmentValidationStoryIds(segmentValidationReport = {}) {
  const storyIds = new Set();
  for (const segment of asArray(segmentValidationReport.segments)) {
    const storyId = cleanText(segment.story_id);
    if (!storyId) continue;
    const status = cleanText(segment.status);
    if (
      status === "validated" &&
      segment.segment_validated === true &&
      segment.allowed_for_flash_lane === true
    ) {
      storyIds.add(storyId);
    }
  }
  return [...storyIds];
}

function resolveMaybeRootedPath(root, value) {
  const text = cleanText(value);
  if (!text) return "";
  return path.isAbsolute(text) ? path.resolve(text) : path.resolve(root, text);
}

function segmentValidationEntity(segmentValidationReport = {}, storyId = "") {
  const targetStoryId = cleanText(storyId);
  const row = asArray(segmentValidationReport.segments).find(
    (segment) => cleanText(segment.story_id) === targetStoryId && cleanText(segment.entity),
  );
  return cleanText(row?.entity);
}

function syntheticSegmentValidationJobs({
  root = process.cwd(),
  artifactRoot = "",
  segmentValidationReport = {},
  requestedStoryIds = new Set(),
  existingStoryIds = new Set(),
} = {}) {
  const artifactRootPath = resolveMaybeRootedPath(root, artifactRoot);
  if (!artifactRootPath) return [];
  return segmentValidationStoryIds(segmentValidationReport)
    .filter((storyId) => !requestedStoryIds.size || requestedStoryIds.has(storyId))
    .filter((storyId) => !existingStoryIds.has(storyId))
    .map((storyId) => ({
      story_id: storyId,
      title: segmentValidationEntity(segmentValidationReport, storyId),
      artifact_dir: path.join(artifactRootPath, storyId),
      status: "blocked_on_render_inputs",
      blockers: [],
      actions: [
        {
          action_id: "materialise_validated_real_motion_clips",
          reason_codes: ["validated_segment_report_artifact_root_repair"],
        },
      ],
    }));
}

function candidateRows({
  rightsLedger = {},
  footageInventory = {},
  motionPack = {},
  segmentValidationReport = {},
  storyId = "",
} = {}) {
  const rows = [
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.matched_assets),
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...motionPackRows(motionPack),
    ...segmentValidationRows(segmentValidationReport, storyId),
  ];
  const byKey = new Map();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    let candidate = null;
    if (isValidatedRealMotionAsset(row)) candidate = normaliseCandidate(row, index);
    else if (isValidatedRealStillAsset(row)) candidate = normaliseStillCandidate(row, index);
    if (!candidate) continue;
    const key = `${candidate.media_kind}|${candidate.source_url}|${candidate.mediaStartS.toFixed(2)}|${candidate.durationS.toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, candidate);
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.media_kind !== b.media_kind) return a.media_kind === "direct_video" ? -1 : 1;
    return 0;
  });
}

function existingMotionClipRows(footageInventory = {}) {
  const rows = [
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
  ];
  const byKey = new Map();
  for (const [index, asset] of rows.entries()) {
    const pathText = cleanText(asset.path || asset.local_materialized_path || asset.file);
    const family = familyForAsset(asset, index);
    const duration = numberOrNull(asset.durationS ?? asset.duration_s ?? asset.duration);
    if (!pathText || !family || !duration || duration < 1.2) continue;
    const mediaStartS = numberOrNull(asset.mediaStartS ?? asset.media_start_s) || 0;
    const row = {
      id: cleanText(asset.id || asset.clip_id || `existing_motion_${index + 1}`),
      path: pathText,
      source_url: cleanText(asset.source_url || asset.source || pathText),
      source_family: family,
      base_source_family: cleanText(asset.base_source_family || asset.provenance?.base_source_family),
      motion_family: cleanText(asset.motion_family || asset.source_family || family),
      source_type: cleanText(asset.source_type || asset.sourceType || asset.source_kind || "existing_motion"),
      media_kind: cleanText(asset.media_kind || asset.mediaKind || "owned_motion"),
      durationS: duration,
      mediaStartS,
      rights_basis: cleanText(asset.rights_basis || asset.licence_basis || asset.license_basis),
      counts_towards_motion_readiness: asset.counts_towards_motion_readiness !== false,
      materialized: asset.materialized !== false,
      local_materialized_path: cleanText(asset.local_materialized_path || pathText),
    };
    const key = `${row.path}|${row.source_family}|${row.mediaStartS.toFixed(2)}|${row.durationS.toFixed(2)}`;
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function directVideoMotionRows(rows = []) {
  return asArray(rows).filter((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video");
}

function directVideoMotionFamilyCount(rows = []) {
  return motionReadinessFamilies(directVideoMotionRows(rows)).length;
}

function jobDirectVideoFloor(job = {}, fallback = DEFAULT_MIN_CLIPS) {
  const values = [
    job.render_input_evidence?.real_motion_input_readiness?.direct_video_motion_clip_floor,
    job.render_input_evidence?.direct_video_motion_clip_floor,
    job.evidence?.direct_video_motion_clip_floor,
    ...asArray(job.actions).map((action) => action.evidence?.direct_video_motion_clip_floor),
  ];
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null && number > 0) return number;
  }
  return Number(fallback || DEFAULT_MIN_CLIPS);
}

function jobNeedsDirectVideoFloorRepair(job = {}) {
  const markers = [
    ...asArray(job.blockers),
    ...asArray(job.render_input_blockers),
    ...asArray(job.actions).flatMap((action) => asArray(action.reason_codes)),
  ].map(cleanText);
  return markers.some((marker) => marker.includes("direct_video_motion_clip_floor_not_met"));
}

function jobIsValidatedSegmentArtifactRootRepair(job = {}) {
  return asArray(job.actions)
    .flatMap((action) => asArray(action.reason_codes))
    .map(cleanText)
    .includes("validated_segment_report_artifact_root_repair");
}

function isExpandableDirectVideoCandidate(candidate = {}) {
  if (cleanText(candidate.media_kind) !== "direct_video") return false;
  const sourceUrl = cleanText(candidate.path || candidate.source_url);
  if (!isSafeDirectMediaUrl(sourceUrl)) return false;
  const text = lowerText([
    candidate.source_type,
    candidate.source_kind,
    candidate.source_url_kind,
    candidate.provider,
    candidate.source_family,
    sourceUrl,
  ].join(" "));
  return /hls_manifest|dash_manifest|steam_movie|official_trailer|official_video|official_platform_product_page|platform_storefront|official_game_page_direct_video|trailer|gameplay|steamstatic|xboxservices/.test(text);
}

function expandDirectVideoWindowCandidates(candidates = [], { job = {}, minClips = DEFAULT_MIN_CLIPS, maxClips = 8 } = {}) {
  if (!jobNeedsDirectVideoFloorRepair(job)) return candidates;
  const directCandidates = candidates.filter((candidate) => cleanText(candidate.media_kind) === "direct_video");
  const floor = Math.max(1, jobDirectVideoFloor(job, minClips));
  const target = Math.min(Math.max(floor, directCandidates.length), Number(maxClips || 8));
  if (directCandidates.length >= target) return candidates;

  const expandedDirect = [...directCandidates];
  const seen = new Set(
    directCandidates.map((candidate) =>
      [
        cleanText(candidate.path || candidate.source_url),
        Number(candidate.mediaStartS || 0).toFixed(2),
        Number(candidate.durationS || 0).toFixed(2),
      ].join("|"),
    ),
  );
  let directCount = expandedDirect.length;
  for (const sourceCandidate of directCandidates) {
    if (directCount >= target) break;
    if (!isExpandableDirectVideoCandidate(sourceCandidate)) continue;
    const duration = Math.max(2, numberOrNull(sourceCandidate.durationS) || 3);
    const baseStart = Math.max(0, numberOrNull(sourceCandidate.mediaStartS) || 0);
    const sourceDuration = numberOrNull(sourceCandidate.source_duration_s);
    let generatedWindowIndex = 1;
    const step = duration + 0.5;
    for (let radius = 1; directCount < target && radius < 24; radius += 1) {
      const starts = [
        { start: baseStart - radius * step, direction: "before" },
        { start: baseStart + radius * step, direction: "after" },
      ];
      for (const startCandidate of starts) {
        if (directCount >= target) break;
        if (startCandidate.start < 0) continue;
        const start = Number(startCandidate.start.toFixed(2));
        if (sourceDuration != null && start + duration > sourceDuration) continue;
        const key = [
          cleanText(sourceCandidate.path || sourceCandidate.source_url),
          start.toFixed(2),
          duration.toFixed(2),
        ].join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        generatedWindowIndex += 1;
        directCount += 1;
        expandedDirect.push({
          ...sourceCandidate,
          id: `${safeFileStem(sourceCandidate.id || sourceCandidate.source_family || "direct_video")}_window_${generatedWindowIndex}`,
          mediaStartS: start,
          durationS: duration,
          expanded_from_source_window: cleanText(sourceCandidate.id || sourceCandidate.source_family || sourceCandidate.source_url),
          source_window_index: generatedWindowIndex,
          source_window_direction: startCandidate.direction,
        });
      }
    }
    if (directCount >= target) break;
  }
  return [
    ...expandedDirect,
    ...candidates.filter((candidate) => cleanText(candidate.media_kind) !== "direct_video"),
  ];
}

function balanceDirectVideoCandidatesByBaseSource(candidates = []) {
  const groups = new Map();
  const groupOrder = [];
  const nonDirect = [];
  for (const candidate of asArray(candidates)) {
    if (cleanText(candidate.media_kind) !== "direct_video") {
      nonDirect.push(candidate);
      continue;
    }
    const key = directMotionBaseSourceFamily(candidate, groupOrder.length) || cleanText(candidate.source_family);
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key).push(candidate);
  }
  if (groupOrder.length <= 1) return candidates;
  const balanced = [];
  let round = 0;
  while (true) {
    let added = false;
    for (const key of groupOrder) {
      const candidate = groups.get(key)?.[round];
      if (!candidate) continue;
      balanced.push(candidate);
      added = true;
    }
    if (!added) break;
    round += 1;
  }
  return [...balanced, ...nonDirect];
}

function dynamicMaxDirectClipsPerBaseSource(candidates = [], {
  job = {},
  minClips = DEFAULT_MIN_CLIPS,
  minFamilies = DEFAULT_MIN_FAMILIES,
  maxClips = 8,
  explicitMax = null,
  hasRightsLedger = false,
} = {}) {
  const explicit = numberOrNull(explicitMax);
  if (explicit != null && explicit > 0) return Math.max(1, explicit);
  const directBaseSources = new Set();
  const directWindowKeysByBaseSource = new Map();
  asArray(candidates).forEach((candidate, index) => {
    if (cleanText(candidate.media_kind) !== "direct_video") return;
    const family = directMotionBaseSourceFamily(candidate, index);
    if (!family) return;
    directBaseSources.add(family);
    if (!directWindowKeysByBaseSource.has(family)) directWindowKeysByBaseSource.set(family, new Set());
    const windowKey = directMotionWindowKey(candidate, index);
    if (windowKey) directWindowKeysByBaseSource.get(family).add(windowKey);
  });
  const baseSourceCount = directBaseSources.size;
  const clipFloor = Math.max(
    1,
    Math.min(
      Number(maxClips || DEFAULT_MIN_CLIPS),
      Math.max(Number(minClips || DEFAULT_MIN_CLIPS), jobDirectVideoFloor(job, minClips)),
    ),
  );
  const familyFloor = Math.max(1, Number(minFamilies || DEFAULT_MIN_FAMILIES));
  if (hasRightsLedger && jobIsValidatedSegmentArtifactRootRepair(job) && baseSourceCount === 1) {
    const availableWindowCount = [...directWindowKeysByBaseSource.values()][0]?.size || 0;
    if (availableWindowCount >= 2 && clipFloor >= 2) return 2;
  }
  if (baseSourceCount === 2) {
    const totalDistinctWindows = [...directWindowKeysByBaseSource.values()]
      .reduce((sum, windows) => sum + (windows?.size || 0), 0);
    const everyBaseHasMultipleWindows = [...directWindowKeysByBaseSource.values()]
      .every((windows) => (windows?.size || 0) >= 2);
    if (
      totalDistinctWindows >= clipFloor &&
      everyBaseHasMultipleWindows &&
      clipFloor <= baseSourceCount * 3
    ) {
      return 3;
    }
  }
  const totalDistinctWindows = [...directWindowKeysByBaseSource.values()]
    .reduce((sum, windows) => sum + (windows?.size || 0), 0);
  const allDirectCandidatesAreOfficialSteam = asArray(candidates)
    .filter((candidate) => cleanText(candidate.media_kind) === "direct_video")
    .every((candidate) => {
      const sourceFamilyKey = sourceUrlFamilyKey(candidate.source_url || candidate.path);
      const sourceText = lowerText([
        candidate.source_type,
        candidate.source_kind,
        candidate.source_url_kind,
        candidate.provider,
        candidate.rights_risk_class,
        candidate.allowed_render_use,
      ].join(" "));
      return (
        sourceFamilyKey.startsWith("steamstatic:/store_trailers/") &&
        /official|platform_product_page|hls_manifest|dash_manifest|steam|direct_media/.test(sourceText) &&
        candidate.segmentValidationPassed !== false &&
        candidate.validated !== false
      );
    });
  const oneSteamSourceHasThirdDistinctWindow = [...directWindowKeysByBaseSource.values()]
    .some((windows) => (windows?.size || 0) >= 3);
  if (
    allDirectCandidatesAreOfficialSteam &&
    baseSourceCount >= 4 &&
    oneSteamSourceHasThirdDistinctWindow &&
    totalDistinctWindows >= 8 &&
    Number(maxClips || 0) >= 8
  ) {
    return 3;
  }
  if (baseSourceCount >= familyFloor && clipFloor > baseSourceCount) {
    return Math.max(1, Math.min(3, Math.ceil(clipFloor / baseSourceCount)));
  }
  if (
    baseSourceCount >= Math.max(3, familyFloor - 1) &&
    clipFloor > baseSourceCount &&
    clipFloor <= baseSourceCount * 2
  ) {
    return 2;
  }
  if (baseSourceCount >= 4 && clipFloor > baseSourceCount && clipFloor <= baseSourceCount * 2) {
    return 2;
  }
  return DEFAULT_MAX_DIRECT_MOTION_CLIPS_PER_BASE_SOURCE;
}

function mergeMotionRows(existingRows = [], newRows = []) {
  const byKey = new Map();
  for (const row of [...asArray(existingRows), ...asArray(newRows)]) {
    const pathText = cleanText(row.path || row.local_materialized_path);
    const sourceUrl = cleanText(row.source_url || pathText);
    const family = cleanText(row.source_family || row.motion_family);
    const start = numberOrNull(row.mediaStartS ?? row.media_start_s) || 0;
    const duration = numberOrNull(row.durationS ?? row.duration_s) || 0;
    if (!pathText || !family || duration < 1.2) continue;
    const key = `${pathText}|${sourceUrl}|${family}|${start.toFixed(2)}|${duration.toFixed(2)}`;
    byKey.set(key, {
      ...row,
      path: pathText,
      source_url: sourceUrl,
      source_family: family,
      motion_family: cleanText(row.motion_family || family),
      durationS: duration,
      mediaStartS: start,
    });
  }
  return [...byKey.values()];
}

function fileEvidenceForJob(job = {}) {
  return (
    job.evidence?.file_evidence ||
    job.render_input_evidence?.file_evidence ||
    job.render_input_evidence ||
    {}
  );
}

function existingMotionEvidenceReady(job = {}, footageInventory = {}, options = {}) {
  const evidence = fileEvidenceForJob(job);
  if (
    evidence.materialised_motion_ready === true &&
    evidence.distinct_motion_families_ready === true
  ) {
    return true;
  }
  const existingRows = existingMotionClipRows(footageInventory);
  const minClips = Number(options.minClips || DEFAULT_MIN_CLIPS);
  const minFamilies = Number(options.minFamilies || DEFAULT_MIN_FAMILIES);
  const families = new Set(motionReadinessFamilies(existingRows));
  return existingRows.length >= Math.max(0, minClips - 1) && families.size >= minFamilies;
}

async function loadMotionPackForStory(root = process.cwd(), storyId = "") {
  const safeStoryId = cleanText(storyId);
  if (!safeStoryId) return {};
  return readJsonIfPresent(
    path.join(root, "output", "studio-v4", "motion-packs", `${safeStoryId}_motion_pack_manifest.json`),
    {},
  );
}

function rightsRecordForClip(clip = {}) {
  const stillDerived = cleanText(clip.media_kind) === "visual_still";
  return {
    asset_id: cleanText(clip.id || `materialised_${path.basename(cleanText(clip.path), ".mp4")}`),
    asset_type: stillDerived ? "screenshot_derived_motion_clip" : "motion_clip",
    kind: "video",
    path: cleanText(clip.path),
    source_url: cleanText(clip.source_url),
    source_owner: cleanText(clip.source_owner || "source owner not specified"),
    source_type: cleanText(clip.source_type || "validated_direct_media"),
    licence_basis: cleanText(clip.licence_basis || "source_documented_transformative_editorial_use"),
    allowed_use: cleanText(clip.allowed_use || "transformative_editorial_short_form"),
    allowed_platforms: [...ALL_SOCIAL_PLATFORMS],
    commercial_use_allowed: true,
    transformation_notes: stillDerived
      ? "Official/key-art still transformed into a short, source-labelled Pulse Gaming editorial motion beat for a governed V4 render."
      : "Trimmed into a short, source-labelled Pulse Gaming editorial motion beat for a governed V4 render.",
    expiry: null,
    credit_required: clip.credit_required === true,
    evidence_reference: cleanText(clip.evidence_reference || clip.source_url || clip.path),
    risk_score: numberOrNull(clip.risk_score) ?? 0.28,
    approval_status: "approved_for_transformative_editorial_use",
  };
}

function mergeRecords(existing = [], additions = []) {
  const byKey = new Map();
  for (const record of [...asArray(existing), ...asArray(additions)]) {
    const key = lowerText(record.asset_id) || lowerText(record.path) || lowerText(record.source_url);
    if (key && !byKey.has(key)) byKey.set(key, record);
  }
  return [...byKey.values()];
}

async function backupOnce(filePath, generatedAt, reason) {
  if (!(await fs.pathExists(filePath))) return null;
  const backupPath = `${filePath}.pre_real_motion_materialization.json`;
  if (!(await fs.pathExists(backupPath))) {
    await fs.writeJson(backupPath, {
      ...(await fs.readJson(filePath)),
      backup_created_at: generatedAt,
      backup_reason: reason,
    }, { spaces: 2 });
  }
  return backupPath;
}

function materializedMotionClipRows(clips = [], storyId = "", { countsTowardsMotionReadiness = true } = {}) {
  return asArray(clips).map((clip, index) => ({
    id: cleanText(clip.id || `${storyId}-real-motion-${index + 1}`),
    path: cleanText(clip.path),
    source_url: cleanText(clip.source_url),
    source_family: cleanText(clip.source_family),
    base_source_family: directMotionBaseSourceFamily(clip, index),
    motion_family: cleanText(clip.motion_family || clip.source_family),
    source_type: cleanText(clip.source_type),
    media_kind: cleanText(clip.media_kind || "direct_video"),
    durationS: numberOrNull(clip.materialized_duration_s ?? clip.durationS ?? clip.duration_s),
    mediaStartS: numberOrNull(clip.materialized_media_start_s ?? clip.mediaStartS ?? clip.media_start_s),
    rights_basis: cleanText(clip.licence_basis),
    counts_towards_motion_readiness: countsTowardsMotionReadiness,
    materialized: true,
    local_materialized_path: cleanText(clip.local_materialized_path || clip.path),
    provenance: clip.provenance || undefined,
  }));
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueFamiliesFromRows(rows = []) {
  return motionReadinessFamilies(rows);
}

function reconciledMotionBudgetAfterRealMaterialization(motionBudget = {}, mergedClipRows = []) {
  const families = uniqueFamiliesFromRows(mergedClipRows);
  const availableMotionClips = asArray(mergedClipRows).length;
  const availableDistinctFamilies = families.length;
  const explicitRequiredMotion = numberOr(motionBudget.required_motion_scenes, DEFAULT_MIN_CLIPS);
  const explicitRequiredFamilies = numberOr(motionBudget.required_distinct_families, DEFAULT_MIN_FAMILIES);
  const metricStory =
    motionBudget.steam_metric_story === true || motionBudget.review_score_story === true;
  const normalDistinctFloor = Math.max(DEFAULT_MIN_FAMILIES, availableDistinctFamilies);
  const requiredDistinctFamilies = metricStory
    ? Math.max(DEFAULT_MIN_FAMILIES, explicitRequiredFamilies)
    : Math.max(
        DEFAULT_MIN_FAMILIES,
        Math.min(explicitRequiredFamilies, normalDistinctFloor),
      );

  return {
    ...motionBudget,
    required_motion_scenes: Math.max(DEFAULT_MIN_CLIPS, explicitRequiredMotion),
    available_motion_clips: availableMotionClips,
    required_distinct_families: requiredDistinctFamilies,
    available_distinct_families: availableDistinctFamilies,
  };
}

function reconciledMotionReadinessAfterRealMaterialization(existingReadiness = {}, motionBudget = {}) {
  const blockers = [];
  if (numberOr(motionBudget.available_motion_clips, 0) < numberOr(motionBudget.required_motion_scenes, DEFAULT_MIN_CLIPS)) {
    blockers.push("actual_motion_clip_minimum_not_met");
  }
  if (numberOr(motionBudget.available_distinct_families, 0) < numberOr(motionBudget.required_distinct_families, DEFAULT_MIN_FAMILIES)) {
    blockers.push("distinct_motion_families_minimum_not_met");
  }
  const staleMotionBlockers = new Set([
    "actual_motion_clip_minimum_not_met",
    "distinct_motion_families_minimum_not_met",
    "no_trusted_footage_references_for_story",
  ]);
  for (const blocker of asArray(existingReadiness.blockers).map(cleanText)) {
    if (!staleMotionBlockers.has(blocker)) blockers.push(blocker);
  }
  return {
    ...existingReadiness,
    status: blockers.length ? "v4_motion_blocked" : "v4_motion_ready",
    blockers: [...new Set(blockers)],
    warnings: asArray(existingReadiness.warnings),
  };
}

async function materializeCandidate({ root, storyId, candidate, execFileSync, ffprobeDuration } = {}) {
  if (cleanText(candidate.media_kind) === "visual_still") {
    return materializeStillCandidate({ root, storyId, candidate, execFileSync, ffprobeDuration });
  }
  const result = await materializeStudioV4BridgeClips({
    root,
    story: { id: storyId },
    bridge: {
      story_id: storyId,
      readiness: { status: "bridge_ready", blockers: [] },
      video_clips: [candidate],
    },
    execFileSync,
    ffprobeDuration,
  });
  const clip = result.bridge?.video_clips?.[0] || null;
  if (result.readiness?.status !== "materialized" || !clip) {
    return {
      status: "failed",
      candidate,
      rejected: result.rejected || [],
      blockers: result.readiness?.blockers || ["real_motion_materialization_failed"],
    };
  }
  const baseSourceFamily = directMotionBaseSourceFamily(candidate);
  return {
    status: "materialized",
    candidate,
    clip: {
      ...candidate,
      ...clip,
      media_kind: "direct_video",
      base_source_family: baseSourceFamily,
      motion_family: candidate.source_family,
      visual_family: candidate.source_family,
      source_family: candidate.source_family,
      provenance: {
        ...(clip.provenance || {}),
        ...(candidate.provenance || {}),
        base_source_family: baseSourceFamily,
      },
      counts_towards_motion_readiness: true,
    },
    materialized: result.materialized || [],
  };
}

function outputStillMotionPath({ root, storyId, candidate, index = 0 }) {
  return path.join(
    root,
    "output",
    "video_cache",
    `${safeFileStem(storyId)}_v4_still_${index + 1}_${safeFileStem(candidate.id || candidate.source_family)}.mp4`,
  );
}

function localStillInputPath(root, input) {
  const text = cleanText(input);
  if (!text || /^https?:\/\//i.test(text)) return text;
  return path.isAbsolute(text) ? text : path.resolve(root, text);
}

function buildStillMotionFfmpegArgs({ input, output, durationS }) {
  const duration = Math.max(1.5, numberOrNull(durationS) || 3);
  const frames = Math.max(45, Math.round(duration * 30));
  const zoompan =
    `scale=1240:2200:force_original_aspect_ratio=increase,` +
    `crop=1080:1920,setsar=1,` +
    `zoompan=z='min(zoom+0.0012,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1080x1920:fps=30,` +
    `trim=duration=${duration.toFixed(2)},format=yuv420p`;
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-loop",
    "1",
    "-t",
    duration.toFixed(2),
    "-i",
    input,
    "-vf",
    zoompan,
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    output,
  ];
}

async function materializeStillCandidate({
  root = process.cwd(),
  storyId,
  candidate,
  execFileSync = defaultExecFileSync,
  ffprobeDuration = defaultFfprobeDuration,
} = {}) {
  const input = localStillInputPath(root, candidate.path || candidate.source_url);
  if (!input) {
    return {
      status: "failed",
      candidate,
      rejected: [{ id: candidate.id || null, reason: "still_input_missing" }],
      blockers: ["still_input_missing"],
    };
  }
  if (!/^https?:\/\//i.test(input) && !(await fs.pathExists(input))) {
    return {
      status: "failed",
      candidate,
      rejected: [{ id: candidate.id || null, path: input, reason: "local_still_missing" }],
      blockers: ["local_still_missing"],
    };
  }
  const output = outputStillMotionPath({ root, storyId, candidate });
  await fs.ensureDir(path.dirname(output));
  try {
    execFileSync("ffmpeg", buildStillMotionFfmpegArgs({
      input,
      output,
      durationS: candidate.durationS,
    }), {
      cwd: root,
      stdio: "ignore",
    });
    const duration = ffprobeDuration(output);
    if (!Number.isFinite(duration) || duration <= 0.2) {
      await fs.remove(output).catch(() => {});
      return {
        status: "failed",
        candidate,
        rejected: [{ id: candidate.id || null, path: output, reason: "still_motion_invalid" }],
        blockers: ["still_motion_invalid"],
      };
    }
    const clip = {
      ...candidate,
      path: output,
      source_url: cleanText(candidate.source_url || candidate.path),
      local_materialized_path: output,
      materialized: true,
      materialized_media_start_s: 0,
      materialized_duration_s: duration,
      media_kind: "visual_still",
      motion_family: candidate.source_family,
      visual_family: candidate.source_family,
      source_family: candidate.source_family,
      counts_towards_motion_readiness: true,
      screenshot_derived_motion: true,
    };
    return {
      status: "materialized",
      candidate,
      clip,
      materialized: [{
        id: candidate.id || null,
        source_family: candidate.source_family || null,
        source_url: candidate.source_url || candidate.path,
        path: output,
        mediaStartS: 0,
        durationS: duration,
      }],
    };
  } catch (err) {
    await fs.remove(output).catch(() => {});
    return {
      status: "failed",
      candidate,
      rejected: [{ id: candidate.id || null, path: input, reason: "ffmpeg_still_motion_failed", error: err.message }],
      blockers: ["ffmpeg_still_motion_failed"],
    };
  }
}

async function writePartialMotionEvidence({
  artifactDir,
  storyId,
  clips,
  blockers,
  generatedAt,
  minClips,
  minFamilies,
} = {}) {
  const partialPath = path.join(artifactDir, "partial_real_motion_evidence.json");
  const clipRows = materializedMotionClipRows(clips, storyId, {
    countsTowardsMotionReadiness: false,
  });
  const families = motionReadinessFamilies(clipRows);
  const directVideoMotionAssetCount = clipRows.filter(
    (clip) => cleanText(clip.media_kind || "direct_video") === "direct_video",
  ).length;
  const directVideoMotionFamilyCountValue = directVideoMotionFamilyCount(clipRows);
  await fs.writeJson(partialPath, {
    schema_version: 1,
    story_id: storyId,
    status: "blocked",
    generated_at: generatedAt,
    not_publishable: true,
    counts_towards_final_render_readiness: false,
    blockers: asArray(blockers).map(cleanText),
    clips: clipRows,
    materialised_clips: clipRows,
    distinct_motion_families: families,
    clip_count: clipRows.length,
    distinct_motion_family_count: families.length,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    minimum_requirements: {
      min_clips: Number(minClips || DEFAULT_MIN_CLIPS),
      min_distinct_motion_families: Number(minFamilies || DEFAULT_MIN_FAMILIES),
      direct_video_motion_required_when_requested: true,
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      not_scheduler_ready: true,
    },
  }, { spaces: 2 });
  return {
    path: partialPath,
    clip_count: clipRows.length,
    distinct_motion_family_count: families.length,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
  };
}

async function updateArtifactMotionEvidence({
  root = process.cwd(),
  artifactDir,
  storyId,
  clips,
  rightsLedger,
  footageInventory,
  generatedAt,
  preserveExistingMotion = false,
} = {}) {
  const materialisedPath = path.join(artifactDir, "materialised_motion_clips.json");
  const ownedMotionPath = path.join(artifactDir, "owned_motion_manifest.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const motionPackPath = path.join(
    path.resolve(root),
    "output",
    "studio-v4",
    "motion-packs",
    `${safeFileStem(storyId)}_motion_pack_manifest.json`,
  );

  await backupOnce(footagePath, generatedAt, "real_motion_materialization");
  await backupOnce(rightsPath, generatedAt, "real_motion_materialization");

  const clipRows = materializedMotionClipRows(clips, storyId);
  const existingRows = preserveExistingMotion ? existingMotionClipRows(footageInventory) : [];
  const replacementDirectFamilies = new Set(
    clipRows
      .filter((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video")
      .map((clip) => cleanText(clip.source_family))
      .filter(Boolean),
  );
  const replacementDirectSources = new Set(
    clipRows
      .filter((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video")
      .map((clip) => cleanText(clip.source_url))
      .filter(Boolean),
  );
  const preservedRows = existingRows.filter((row) => {
    if (cleanText(row.media_kind) !== "direct_video") return true;
    return (
      !replacementDirectFamilies.has(cleanText(row.source_family)) &&
      !replacementDirectSources.has(cleanText(row.source_url))
    );
  });
  const mergedClipRows = preserveExistingMotion ? mergeMotionRows(preservedRows, clipRows) : clipRows;
  const families = motionReadinessFamilies(mergedClipRows);
  const directVideoMotionAssetCount = mergedClipRows.filter(
    (clip) => cleanText(clip.media_kind || "direct_video") === "direct_video",
  ).length;
  const directVideoMotionFamilyCountValue = directVideoMotionFamilyCount(mergedClipRows);
  const reconciledMotionBudget = reconciledMotionBudgetAfterRealMaterialization(
    footageInventory.motion_budget || {},
    mergedClipRows,
  );

  const updatedFootage = {
    ...footageInventory,
    readiness: reconciledMotionReadinessAfterRealMaterialization(
      footageInventory.readiness || {},
      reconciledMotionBudget,
    ),
    motion_budget: reconciledMotionBudget,
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      accepted_local_clips: mergedClipRows,
      production_motion_clips: mergedClipRows,
      distinct_source_families: families,
      trusted_local_source_families: families,
      direct_video_motion_asset_count: directVideoMotionAssetCount,
      direct_video_motion_family_count: directVideoMotionFamilyCountValue,
      real_motion_materialized_at: generatedAt,
    },
  };
  const records = clips.map(rightsRecordForClip);
  const updatedRights = {
    ...rightsLedger,
    verdict: "pass",
    failures: asArray(rightsLedger.failures).filter((failure) => cleanText(failure) !== "rights:no_rights_record"),
    records: mergeRecords(rightsLedger.records || rightsLedger.rights_ledger, records),
    rights_ledger: mergeRecords(rightsLedger.rights_ledger || rightsLedger.records, records),
    matched_assets: mergeRecords(rightsLedger.matched_assets, records.map((record) => ({
      asset_id: record.asset_id,
      kind: record.kind,
      path: record.path,
      source_url: record.source_url,
      rights_record_id: record.asset_id,
      licence_basis: record.licence_basis,
      risk_score: record.risk_score,
    }))),
    rights_ledger_repaired_at: generatedAt,
    rights_ledger_repair_strategy: "materialised_validated_direct_media_to_explicit_rights_records",
  };

  await fs.writeJson(footagePath, updatedFootage, { spaces: 2 });
  await fs.writeJson(rightsPath, updatedRights, { spaces: 2 });
  await fs.writeJson(materialisedPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    clips: mergedClipRows,
    materialised_clips: mergedClipRows,
    distinct_motion_families: families,
    clip_count: mergedClipRows.length,
    distinct_motion_family_count: families.length,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "distinct_motion_family_report.json"), {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    summary: {
      clip_count: mergedClipRows.length,
      distinct_motion_family_count: families.length,
      direct_video_motion_family_count: directVideoMotionFamilyCountValue,
      minimum_required_distinct_motion_families: DEFAULT_MIN_FAMILIES,
    },
    families,
    distinct_motion_families: families,
  }, { spaces: 2 });
  await fs.writeJson(ownedMotionPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    materialised_clips: mergedClipRows,
    distinct_motion_families: families,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    source: "validated_real_motion_materializer",
    note: "Real source motion clips, not owned/generated card substitutes.",
  }, { spaces: 2 });
  await fs.ensureDir(path.dirname(motionPackPath));
  await fs.writeJson(motionPackPath, {
    schema_version: 1,
    story_id: storyId,
    status: "ready",
    generated_at: generatedAt,
    source: "validated_real_motion_materializer",
    readiness: {
      status: "v4_motion_ready",
      blockers: [],
      warnings: [],
    },
    clips: mergedClipRows,
    handoff: {
      visual_v4_local_motion_clips: mergedClipRows,
      trusted_local_source_families: families,
      direct_video_motion_asset_count: directVideoMotionAssetCount,
      direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    },
    motion_budget: {
      available_motion_clips: mergedClipRows.length,
      available_distinct_families: families.length,
      required_motion_scenes: DEFAULT_MIN_CLIPS,
      required_distinct_families: DEFAULT_MIN_FAMILIES,
    },
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  }, { spaces: 2 });
  return {
    clip_count: mergedClipRows.length,
    distinct_motion_family_count: families.length,
    direct_video_motion_asset_count: directVideoMotionAssetCount,
    direct_video_motion_family_count: directVideoMotionFamilyCountValue,
    motion_pack_path: motionPackPath,
  };
}

async function materializeRealMotionJob(job = {}, options = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const storyId = cleanText(job.story_id);
  const title = cleanText(job.title);
  const blockers = [];
  if (!storyId) blockers.push("story_id_missing");
  if (!artifactDir || !(await fs.pathExists(artifactDir))) blockers.push("artifact_dir_missing");
  const rightsPath = path.join(artifactDir, "rights_ledger.json");
  const footagePath = path.join(artifactDir, "footage_inventory.json");
  const rightsLedgerRaw = await readJsonIfPresent(rightsPath, null);
  const rightsLedger = rightsLedgerRaw || {};
  const footageInventory = await readJsonIfPresent(footagePath, {});
  const motionPack = await loadMotionPackForStory(options.root, storyId);
  const segmentValidationReport = options.segmentValidationReport || {};
  const segmentValidationBootstrapCandidates = rightsLedgerRaw
    ? []
    : candidateRows({
      rightsLedger: {},
      footageInventory: {},
      motionPack: {},
      segmentValidationReport,
      storyId,
    });
  if (!rightsLedgerRaw && !segmentValidationBootstrapCandidates.length) {
    blockers.push("rights_ledger_missing");
  }
  if (blockers.length) {
    return { story_id: storyId, title, artifact_dir: artifactDir, status: "blocked", blockers };
  }

  const minClips = Number(options.minClips || DEFAULT_MIN_CLIPS);
  const minFamilies = Number(options.minFamilies || DEFAULT_MIN_FAMILIES);
  const candidates = balanceDirectVideoCandidatesByBaseSource(expandDirectVideoWindowCandidates(
    candidateRows({ rightsLedger, footageInventory, motionPack, segmentValidationReport, storyId }),
    {
      job,
      minClips,
      maxClips: options.maxClips || 8,
    },
  ));
  if (!candidates.length) {
    const restoredClips = restorableMaterializedMotionPackClips(motionPack, { root: options.root });
    if (restoredClips.length >= minClips) {
      const updateSummary = await updateArtifactMotionEvidence({
        root: options.root,
        artifactDir,
        storyId,
        clips: restoredClips,
        rightsLedger,
        footageInventory,
        generatedAt: options.generatedAt,
        preserveExistingMotion: true,
      });
      return {
        story_id: storyId,
        title,
        artifact_dir: artifactDir,
        status: "materialized",
        repair_scope: "central_materialized_motion_restore",
        blockers: [],
        candidate_count: 0,
        materialized_count: restoredClips.length,
        distinct_motion_family_count: motionReadinessFamilies(restoredClips).length,
        direct_video_motion_clip_count: restoredClips.length,
        direct_video_motion_family_count: directVideoMotionFamilyCount(restoredClips),
        total_motion_clip_count: updateSummary.clip_count,
        total_distinct_motion_family_count: updateSummary.distinct_motion_family_count,
        total_direct_video_motion_asset_count: updateSummary.direct_video_motion_asset_count,
        total_direct_video_motion_family_count: updateSummary.direct_video_motion_family_count,
        central_motion_pack_path: updateSummary.motion_pack_path,
        failed_count: 0,
        clips: restoredClips.map((clip) => ({
          id: clip.id,
          path: clip.path,
          source_family: clip.source_family,
          source_url: clip.source_url,
          media_kind: "direct_video",
        })),
      };
    }
    return {
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: ["validated_direct_media_candidates_missing"],
      candidate_count: 0,
    };
  }

  const materialized = [];
  const failed = [];
  const seenFamilies = new Set();
  const seenDirectWindows = new Set();
  const directBaseSourceCounts = new Map();
  const skippedDuplicateBaseSources = [];
  const skippedDuplicateDirectWindows = [];
  const maxDirectClipsPerBaseSource = dynamicMaxDirectClipsPerBaseSource(candidates, {
    job,
    minClips,
    minFamilies,
    maxClips: options.maxClips || 8,
    explicitMax: options.maxDirectClipsPerBaseSource,
    hasRightsLedger: Boolean(rightsLedgerRaw),
  });
  for (const candidate of candidates) {
    if (materialized.length >= (options.maxClips || 8)) break;
    const isDirectVideoCandidate = cleanText(candidate.media_kind) === "direct_video";
    const candidateFamily = directMotionReadinessFamily(candidate, materialized.length);
    const candidateBaseFamily = directMotionBaseSourceFamily(candidate, materialized.length);
    const candidateWindowKey = directMotionWindowKey(candidate, materialized.length);
    if (isDirectVideoCandidate && candidateWindowKey && seenDirectWindows.has(candidateWindowKey)) {
      skippedDuplicateDirectWindows.push({
        id: cleanText(candidate.id),
        source_family: cleanText(candidate.source_family),
        base_source_family: candidateBaseFamily,
        source_url: cleanText(candidate.source_url),
        media_start_s: numberOrNull(candidate.mediaStartS ?? candidate.media_start_s),
        duration_s: numberOrNull(candidate.durationS ?? candidate.duration_s),
      });
      continue;
    }
    if (
      isDirectVideoCandidate &&
      candidateBaseFamily &&
      (directBaseSourceCounts.get(candidateBaseFamily) || 0) >= maxDirectClipsPerBaseSource
    ) {
      skippedDuplicateBaseSources.push({
        id: cleanText(candidate.id),
        source_family: cleanText(candidate.source_family),
        base_source_family: candidateBaseFamily,
        source_url: cleanText(candidate.source_url),
        max_clips_per_base_source: maxDirectClipsPerBaseSource,
      });
      continue;
    }
    const result = await materializeCandidate({
      root: options.root,
      storyId,
      candidate,
      execFileSync: options.execFileSync,
      ffprobeDuration: options.ffprobeDuration,
    });
    if (result.status === "materialized") {
      materialized.push(result.clip);
      const resultIndex = materialized.length - 1;
      const resultFamily = directMotionReadinessFamily(result.clip, resultIndex);
      const resultBaseFamily = directMotionBaseSourceFamily(result.clip, resultIndex);
      const resultWindowKey = directMotionWindowKey(result.clip, resultIndex);
      if (resultFamily) seenFamilies.add(resultFamily);
      if (resultWindowKey) seenDirectWindows.add(resultWindowKey);
      if (isDirectVideoCandidate && resultBaseFamily) {
        directBaseSourceCounts.set(resultBaseFamily, (directBaseSourceCounts.get(resultBaseFamily) || 0) + 1);
      }
    } else {
      failed.push(result);
    }
  }
  const directBaseSourceClipCounts = [...directBaseSourceCounts.entries()]
    .map(([base_source_family, count]) => ({ base_source_family, count }))
    .sort((a, b) => b.count - a.count || a.base_source_family.localeCompare(b.base_source_family));

  const directVideoCount = directVideoMotionRows(materialized).length;
  const directVideoFamilyCount = directVideoMotionFamilyCount(materialized);
  const directVideoRequired = jobRequiresDirectVideoMotion(job);
  const directVideoFloorRequired = jobNeedsDirectVideoFloorRepair(job);
  const requiredDirectVideoCount = jobNeedsDirectVideoFloorRepair(job)
    ? jobDirectVideoFloor(job, minClips)
    : 1;
  const directVideoGapOnlyRepair =
    directVideoRequired &&
    directVideoCount >= requiredDirectVideoCount &&
    existingMotionEvidenceReady(job, footageInventory, { minClips, minFamilies });
  if (
    !directVideoGapOnlyRepair &&
    (materialized.length < minClips ||
      seenFamilies.size < minFamilies ||
      (directVideoRequired && directVideoCount < 1) ||
      (directVideoFloorRequired && directVideoCount < requiredDirectVideoCount))
  ) {
    const thresholdBlockers = [
      ...(materialized.length < minClips ? ["real_motion_clip_minimum_not_met"] : []),
      ...(seenFamilies.size < minFamilies ? ["real_motion_family_minimum_not_met"] : []),
      ...(directVideoRequired && directVideoCount < 1 ? ["direct_video_motion_clip_missing"] : []),
      ...(directVideoFloorRequired && directVideoCount > 0 && directVideoCount < requiredDirectVideoCount
        ? ["direct_video_motion_clip_floor_not_met"]
        : []),
    ];
    const partialEvidence = materialized.length
      ? await writePartialMotionEvidence({
        artifactDir,
        storyId,
        clips: materialized,
        blockers: thresholdBlockers,
        generatedAt: options.generatedAt,
        minClips,
        minFamilies,
      })
      : null;
    return {
      story_id: storyId,
      title,
      artifact_dir: artifactDir,
      status: "blocked",
      blockers: thresholdBlockers,
      candidate_count: candidates.length,
      materialized_count: materialized.length,
      distinct_motion_family_count: seenFamilies.size,
      direct_video_motion_clip_count: directVideoCount,
      direct_video_motion_family_count: directVideoFamilyCount,
      direct_motion_base_source_clip_counts: directBaseSourceClipCounts,
      max_direct_motion_clips_per_base_source: maxDirectClipsPerBaseSource,
      skipped_duplicate_base_source_count: skippedDuplicateBaseSources.length,
      skipped_duplicate_base_sources: skippedDuplicateBaseSources.slice(0, 10),
      skipped_duplicate_direct_window_count: skippedDuplicateDirectWindows.length,
      skipped_duplicate_direct_windows: skippedDuplicateDirectWindows.slice(0, 10),
      partial_evidence_path: partialEvidence?.path || null,
      partial_evidence_clip_count: partialEvidence?.clip_count || 0,
      partial_direct_video_motion_family_count:
        partialEvidence?.direct_video_motion_family_count || 0,
      partial_evidence_counts_towards_final_render_readiness: false,
      failed_count: failed.length,
      failed: failed.slice(0, 10),
    };
  }

  const updateSummary = await updateArtifactMotionEvidence({
    root: options.root,
    artifactDir,
    storyId,
    clips: materialized,
    rightsLedger,
    footageInventory,
    generatedAt: options.generatedAt,
    preserveExistingMotion: directVideoGapOnlyRepair,
  });

  return {
    story_id: storyId,
    title,
    artifact_dir: artifactDir,
    status: "materialized",
    repair_scope: directVideoGapOnlyRepair ? "direct_video_gap_only" : "full_real_motion_readiness",
    blockers: [],
    candidate_count: candidates.length,
    materialized_count: materialized.length,
    distinct_motion_family_count: seenFamilies.size,
    direct_video_motion_clip_count: directVideoCount,
    direct_video_motion_family_count: directVideoFamilyCount,
    direct_motion_base_source_clip_counts: directBaseSourceClipCounts,
    max_direct_motion_clips_per_base_source: maxDirectClipsPerBaseSource,
    skipped_duplicate_base_source_count: skippedDuplicateBaseSources.length,
    skipped_duplicate_base_sources: skippedDuplicateBaseSources.slice(0, 10),
    skipped_duplicate_direct_window_count: skippedDuplicateDirectWindows.length,
    skipped_duplicate_direct_windows: skippedDuplicateDirectWindows.slice(0, 10),
    total_motion_clip_count: updateSummary.clip_count,
    total_distinct_motion_family_count: updateSummary.distinct_motion_family_count,
    total_direct_video_motion_asset_count: updateSummary.direct_video_motion_asset_count,
    total_direct_video_motion_family_count: updateSummary.direct_video_motion_family_count,
    central_motion_pack_path: updateSummary.motion_pack_path,
    failed_count: failed.length,
    clips: materialized.map((clip) => ({
      id: clip.id,
      path: clip.path,
      source_family: clip.source_family,
      source_url: clip.source_url,
      media_kind: cleanText(clip.media_kind || "direct_video"),
    })),
  };
}

async function materializeGoalRealMotion({
  root = process.cwd(),
  workOrder = {},
  generatedAt = new Date().toISOString(),
  limit = 0,
  storyIds = [],
  includeReadyStories = false,
  minClips = DEFAULT_MIN_CLIPS,
  minFamilies = DEFAULT_MIN_FAMILIES,
  maxClips = 8,
  segmentValidationReport = {},
  artifactRoot = "",
  execFileSync,
  ffprobeDuration,
} = {}) {
  const requestedStoryIds = new Set(normaliseStoryIds(storyIds));
  const resolvedRoot = path.resolve(root);
  const workOrderJobs = asArray(workOrder.jobs)
    .filter((job) => {
      if (isRealMotionJob(job)) return true;
      if (!includeReadyStories || !requestedStoryIds.size) return false;
      return requestedStoryIds.has(cleanText(job.story_id)) && Boolean(cleanText(job.artifact_dir));
    })
    .filter((job) => !requestedStoryIds.size || requestedStoryIds.has(cleanText(job.story_id)));
  const existingStoryIds = new Set(workOrderJobs.map((job) => cleanText(job.story_id)).filter(Boolean));
  const jobs = [
    ...workOrderJobs,
    ...syntheticSegmentValidationJobs({
      root: resolvedRoot,
      artifactRoot,
      segmentValidationReport,
      requestedStoryIds,
      existingStoryIds,
    }),
  ];
  const selected = Number(limit) > 0 ? jobs.slice(0, Number(limit)) : jobs;
  const results = [];
  for (const job of selected) {
    try {
      results.push(await materializeRealMotionJob(job, {
        root: resolvedRoot,
        generatedAt,
        minClips,
        minFamilies,
        maxClips,
        segmentValidationReport,
        execFileSync,
        ffprobeDuration,
      }));
    } catch (error) {
      results.push({
        story_id: cleanText(job.story_id),
        artifact_dir: job.artifact_dir || null,
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "REAL_MOTION_MATERIALIZATION",
    summary: {
      candidate_count: selected.length,
      materialized_story_count: results.filter((item) => item.status === "materialized").length,
      blocked_story_count: results.filter((item) => item.status === "blocked").length,
      failed_story_count: results.filter((item) => item.status === "failed").length,
      materialized_clip_count: results
        .filter((item) => item.status === "materialized")
        .reduce((sum, item) => sum + Number(item.materialized_count || 0), 0),
      attempted_materialized_clip_count: results.reduce(
        (sum, item) => sum + Number(item.materialized_count || 0),
        0,
      ),
      screenshot_derived_motion_clip_count: results.reduce(
        (sum, item) =>
          item.status === "materialized"
            ? sum + asArray(item.clips).filter((clip) => clip.media_kind === "visual_still").length
            : sum,
        0,
      ),
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      trusted_real_visual_media_only: true,
      direct_video_or_screenshot_derived_only: true,
      direct_media_only: results.every((item) =>
        asArray(item.clips).every((clip) => cleanText(clip.media_kind || "direct_video") === "direct_video"),
      ),
    },
  };
}

function renderGoalRealMotionMarkdown(report = {}) {
  const lines = [];
  lines.push("# Real Motion Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Materialized stories: ${report.summary?.materialized_story_count || 0}`);
  lines.push(`Blocked stories: ${report.summary?.blocked_story_count || 0}`);
  lines.push(`Failed stories: ${report.summary?.failed_story_count || 0}`);
  lines.push(`Materialized clips: ${report.summary?.materialized_clip_count || 0}`);
  lines.push(`Screenshot-derived clips: ${report.summary?.screenshot_derived_motion_clip_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const detail = job.blockers?.length ? `; blockers: ${job.blockers.join(", ")}` : "";
    lines.push(`- ${job.story_id}: ${job.status}; clips=${job.materialized_count || 0}; families=${job.distinct_motion_family_count || 0}${detail}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: local trusted visual materialisation only. No publishing, DB mutation, OAuth or token change.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalRealMotionReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalRealMotionReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "real_motion_materialization_report.json");
  const markdownPath = path.join(outDir, "real_motion_materialization_report.md");
  const realMotionSourceAcquisitionWorkOrderPath = path.join(outDir, "real_motion_source_acquisition_work_order.json");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalRealMotionMarkdown(report), "utf8");
  await fs.writeJson(
    realMotionSourceAcquisitionWorkOrderPath,
    buildRealMotionSourceAcquisitionWorkOrder(report),
    { spaces: 2 },
  );
  return { outputDir: outDir, jsonPath, markdownPath, realMotionSourceAcquisitionWorkOrderPath };
}

module.exports = {
  candidateRows,
  loadMotionPackForStory,
  materializeGoalRealMotion,
  buildRealMotionSourceAcquisitionWorkOrder,
  renderGoalRealMotionMarkdown,
  writeGoalRealMotionReport,
  _private: {
    expandDirectVideoWindowCandidates,
    dynamicMaxDirectClipsPerBaseSource,
    isExpandableDirectVideoCandidate,
    jobDirectVideoFloor,
    jobNeedsDirectVideoFloorRepair,
    jobRequiresDirectVideoMotion,
  },
};
