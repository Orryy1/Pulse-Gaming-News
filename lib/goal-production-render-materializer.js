"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const nativeFs = require("node:fs/promises");
const fs = require("fs-extra");

const execFileAsync = promisify(execFile);

const {
  overlayCardWindowsForStory,
  renderProof: defaultRenderProof,
} = require("./studio/v4/proof-render");
const { buildVisualV4DirectorPlan } = require("./studio/v4/director-brain");
const { runMediaHouseBenchmark } = require("./media-house-benchmark");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const mediaPaths = require("./media-paths");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
  currentRenderPolicyManifest,
  policyVersionBlockers,
} = require("./studio/v4/render-policy");
const {
  evaluateHyperframesPremiumShellEvidence,
  MIN_PREMIUM_HYPERFRAMES_CARDS,
  readableDurationEvidenceFromShell,
  resolveCardAssetsV2,
} = require("./studio/v2/premium-card-lane-v2");
const { applyGamingPronunciation } = require("./tts-pronunciation");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");
const {
  SOURCE_CARD_TIMING,
} = require("./studio/v4/premium-card-timing-policy");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function firstNonEmptyArray(...values) {
  for (const value of values) {
    const array = asArray(value);
    if (array.length) return array;
  }
  return [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function productionCoverText(canonical = {}) {
  return cleanText(
    canonical.first_frame_text ||
      canonical.suggested_thumbnail_text ||
      canonical.thumbnail_headline ||
      canonical.thumbnail_text,
  );
}

function safeTtsScriptForCanonical(canonical = {}) {
  const explicit = cleanText(canonical.spoken_narration_script || canonical.tts_script);
  if (explicit) return cleanText(applyGamingPronunciation(explicit));
  return cleanText(applyGamingPronunciation(canonical.narration_script || canonical.full_script || ""));
}

function uniqueCleanTexts(value) {
  return [...new Set(asArray(value).map(cleanText).filter(Boolean))];
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function resolveNarrationDurationS({
  voiceQualityReport = {},
  audioManifest = {},
  jobEvidence = {},
  narrationAudioPath = null,
  ffprobeDurationImpl = defaultFfprobeDuration,
} = {}) {
  const reportedDuration = numberOrNull(
    voiceQualityReport.cadence?.duration_seconds ??
      voiceQualityReport.cadence?.duration_s ??
      voiceQualityReport.duration_seconds ??
      voiceQualityReport.duration_s ??
      audioManifest.cadence?.duration_seconds ??
      audioManifest.cadence?.duration_s ??
      audioManifest.technical_duration_seconds ??
      audioManifest.duration_seconds ??
      audioManifest.duration_s ??
      jobEvidence.technical_duration_seconds ??
      jobEvidence.duration_seconds ??
      jobEvidence.duration_s,
  );
  if (reportedDuration != null && reportedDuration > 0) return reportedDuration;

  const audioPath = pathOrNull(narrationAudioPath);
  if (!audioPath || typeof ffprobeDurationImpl !== "function") return null;
  const probedDuration = numberOrNull(ffprobeDurationImpl(audioPath));
  return probedDuration != null && probedDuration > 0 ? probedDuration : null;
}

function manifestReadyStatus(manifest = {}) {
  const status = cleanText(manifest.status || manifest.state || manifest.verdict || manifest.result).toLowerCase();
  if (!status) return true;
  return ["ready", "pass", "passed", "green", "ok", "complete"].includes(status);
}

function actionNeedsProductionRender(action = {}) {
  return cleanText(action.action_id) === "run_visual_v4_production_render";
}

function targetRenderManifestFor(job = {}) {
  return asArray(job.actions).find(actionNeedsProductionRender)?.target_render_manifest || {};
}

function targetRequiresHyperframesPremiumShell(job = {}) {
  const target = targetRenderManifestFor(job);
  return (
    target.hyperframes_premium_shell_required === true ||
    target.require_hyperframes_premium_shell === true
  );
}

function jobForcesFinalRender(job = {}) {
  return (
    job.force_final_render === true ||
    asArray(job.actions).some((action) => actionNeedsProductionRender(action) && action.force === true)
  );
}

function jobNeedsSafeTextMargins(job = {}) {
  const repairLane = cleanText(job.repair_lane);
  const blockers = asArray(job.blocker_types || job.blockers || job.risk_reasons)
    .map(cleanText)
    .filter(Boolean);
  return (
    repairLane === "visual_safe_text_margin_rerender" ||
    blockers.includes("possible_edge_text_cutoff")
  );
}

function jobNeedsStrongerFirstFrame(job = {}) {
  const repairLane = cleanText(job.repair_lane);
  const blockers = asArray(job.blocker_types || job.blockers || job.risk_reasons)
    .map(cleanText)
    .filter(Boolean);
  return (
    repairLane === "visual_first_frame_rerender" ||
    blockers.some((blocker) =>
      blocker === "weak_first_frame_low_detail_or_too_dark" ||
      blocker.startsWith("weak_first_frame_visual_taste"),
    )
  );
}

function jobNeedsOpeningClipRotation(job = {}) {
  const blockers = asArray(job.blocker_types || job.blockers || job.risk_reasons)
    .map(cleanText)
    .filter(Boolean);
  return (
    cleanText(job.repair_lane) === "visual_safe_text_margin_rerender" ||
    blockers.includes("possible_edge_text_cutoff") ||
    jobNeedsStrongerFirstFrame(job)
  );
}

function rotateFirstClipForRepair(clips = [], job = {}) {
  const orderedClips = asArray(clips);
  if (!jobNeedsOpeningClipRotation(job) || orderedClips.length < 4) return orderedClips;
  return [...orderedClips.slice(1), orderedClips[0]];
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch {
    return fallback;
  }
}

function pathOrNull(value) {
  const text = cleanText(value);
  return text || null;
}

function normalisePathKey(value) {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function normaliseMotionSourceKey(value) {
  const withoutQuery = cleanText(value)
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "");
  return withoutQuery
    .replace(/\.(?:mp4|mov|webm|mkv|m3u8|mpd)$/i, "")
    .replace(
      /([_/-]v4[_/-]clip[_/-]?\d+)[_/-]segment[_/-]direct[_/-]motion[_/-]?\d+(?:[_/-][a-f0-9]{6,})?$/i,
      "$1",
    )
    .replace(
      /[_/-]segment[_/-]direct[_/-]motion[_/-]?\d+(?:[_/-][a-f0-9]{6,})?$/i,
      "",
    )
    .replace(
      /\/(?:hls(?:_[a-z0-9]+)*_master|hls(?:_[a-z0-9]+)*|dash(?:_[a-z0-9]+)*|movie(?:_max|\d+)?(?:_[a-z0-9]+)*)$/i,
      "",
    );
}

function clipPathValue(clip = {}) {
  if (typeof clip === "string") return pathOrNull(clip);
  return pathOrNull(
    clip.local_materialized_path ||
      clip.path ||
      clip.local_path ||
      clip.file_path ||
      clip.media_path,
  );
}

function clipIdentity(clip = {}, index = 0) {
  if (typeof clip === "string") return `production_motion_${index + 1}`;
  return cleanText(clip.id || clip.asset_id || clip.motion_family || clip.source_family || `production_motion_${index + 1}`);
}

function isRealMaterialisedClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const clipPath = clipPathValue(clip);
  if (!/\.mp4$/i.test(clipPath)) return false;
  if (clip.counts_towards_motion_readiness === false) return false;
  const text = [
    clip.source_url,
    clip.source_type,
    clip.media_kind,
    clip.rights_basis,
    clip.licence_basis,
    clip.allowed_use,
    clip.source_family,
  ].map(cleanText).join(" ").toLowerCase();
  if (/local:\/\/pulse-generated|output\/generated-motion/i.test(text)) return false;
  return /(?:https?:\/\/|steam|storefront|screenshot|official|publisher|press_kit|igdb)/i.test(text);
}

function isApprovedOwnedExplainerClip(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const clipPath = clipPathValue(clip);
  if (!/\.mp4$/i.test(clipPath)) return false;
  if (clip.counts_towards_motion_readiness === false) return false;
  const text = [
    clip.source_url,
    clip.source_type,
    clip.media_kind,
    clip.rights_basis,
    clip.licence_basis,
    clip.allowed_use,
    clip.source_family,
    clip.path,
  ].map(cleanText).join(" ").toLowerCase();
  if (!/local:\/\/pulse-generated|output[\\/]generated-motion|internally_generated_motion_graphic/.test(text)) {
    return false;
  }
  return (
    clip.owned_explainer_visual_plan === true ||
    /owned_explainer_motion|owned_generated_editorial_motion_graphic/.test(text)
  );
}

function isReadableApprovedOwnedExplainerClip(clip = {}) {
  return isApprovedOwnedExplainerClip(clip) && Boolean(readableOwnedCardKind(clip));
}

const READABLE_CARD_KIND_PRIORITY = [
  "source",
  "quote",
  "takeaway",
  "context",
  "timeline",
  "proof",
  "stat",
  "chart",
  "breaking",
  "title",
  "carousel",
  "screenshot",
  "card",
];

function readableOwnedCardKind(clip = {}) {
  const text = [
    clip.asset_class,
    clip.visual_asset_class,
    clip.id,
    clip.asset_id,
    clip.source_type,
    clip.media_kind,
    clip.source_family,
    clip.motion_family,
    clip.path,
    clip.source_kind,
  ].map(cleanText).join(" ").toLowerCase();
  if (!/card|slide|transform|hyperframes|generated-motion|owned_explainer_motion|internally_generated_motion_graphic/.test(text)) {
    return "";
  }
  if (/branded[_-]?wipe|motion[_-]?background|lower[_-]?third/.test(text)) return "";
  const matched = text.match(
    /(source|context|timeline|quote|takeaway|proof|stat|chart|carousel|screenshot|breaking|title)[_-]?(?:card|slide|transform)?/,
  );
  if (matched?.[1]) return matched[1];
  if (/\bcard\b/.test(text)) return "card";
  return "";
}

function clipDurationSeconds(clip = {}, fallback = 0) {
  const duration = numberOrNull(clip.durationS ?? clip.duration_s ?? clip.duration ?? clip.source_duration_s);
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function readableCardDurationSeconds(clip = {}) {
  return Math.max(
    MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
    clipDurationSeconds(clip, MIN_READABLE_HYPERFRAMES_CARD_DURATION_S),
    numberOrNull(
      clip.minimum_readable_duration_s ??
        clip.minimum_visible_duration_s ??
        clip.min_readable_duration_s,
    ) || 0,
  );
}

function readableCardPriority(kind = "") {
  const index = READABLE_CARD_KIND_PRIORITY.indexOf(cleanText(kind).toLowerCase());
  return index >= 0 ? index : READABLE_CARD_KIND_PRIORITY.length;
}

function selectReadableOwnedExplainerTopUpForMotionBalance(cards = [], primaryClips = []) {
  const primary = asArray(primaryClips);
  const cardCandidates = asArray(cards)
    .map((clip, index) => ({
      clip,
      index,
      kind: readableOwnedCardKind(clip),
      durationS: readableCardDurationSeconds(clip),
    }))
    .filter((entry) => entry.kind);
  if (!primary.length || !cardCandidates.length) return [];
  const directDurationS = primary.reduce(
    (sum, clip) => sum + clipDurationSeconds(clip, 6.5),
    0,
  );
  if (directDurationS <= 0) return [];
  const maxByCount = maxReadableHyperframesCardsForMotion(primary.length, cardCandidates.length);
  if (!maxByCount) return [];
  const byKind = new Map();
  for (const entry of cardCandidates) {
    const current = byKind.get(entry.kind);
    if (
      !current ||
      entry.durationS > current.durationS ||
      (entry.durationS === current.durationS && entry.index < current.index)
    ) {
      byKind.set(entry.kind, entry);
    }
  }
  const ordered = [...byKind.values()].sort(
    (a, b) =>
      readableCardPriority(a.kind) - readableCardPriority(b.kind) ||
      b.durationS - a.durationS ||
      a.index - b.index,
  );
  const selected = [];
  let cardDurationS = 0;
  for (const entry of ordered) {
    if (selected.length >= maxByCount) break;
    const nextDurationS = cardDurationS + entry.durationS;
    const nextRatio = nextDurationS / (directDurationS + nextDurationS);
    if (nextRatio > MAX_HYPERFRAMES_CARD_DURATION_RATIO) continue;
    selected.push(entry.clip);
    cardDurationS = nextDurationS;
  }
  return selected;
}

function selectNonReadableOwnedExplainerTopUpForMotionBalance(ownedClips = [], primaryClips = []) {
  const primary = asArray(primaryClips);
  if (!primary.length) return [];
  const desiredTotalClipCount = Math.max(6, primary.length);
  const needed = Math.max(0, desiredTotalClipCount - primary.length);
  if (!needed) return [];
  return asArray(ownedClips)
    .filter((clip) => !readableOwnedCardKind(clip))
    .sort((a, b) => {
      const aDuration = numberOrNull(a.durationS ?? a.duration_s ?? a.duration) || 0;
      const bDuration = numberOrNull(b.durationS ?? b.duration_s ?? b.duration) || 0;
      return bDuration - aDuration || cleanText(a.id || a.asset_id).localeCompare(cleanText(b.id || b.asset_id));
    })
    .slice(0, needed);
}

function directClipRootKey(clip = {}) {
  return normaliseMotionSourceKey(
    cleanText(
      clip.base_source_family ||
        clip.original_source_family ||
        clip.provenance?.base_source_family ||
        clip.source_url ||
        clip.url ||
        clip.source_family ||
        clip.motion_family,
    ),
  );
}

function hasBalancedTwoRootWindowPool(clips = []) {
  const counts = new Map();
  for (const clip of asArray(clips).filter(isRealMaterialisedClip)) {
    const root = directClipRootKey(clip);
    if (!root) continue;
    counts.set(root, (counts.get(root) || 0) + 1);
  }
  return counts.size === 2 && [...counts.values()].every((count) => count >= 3);
}

function directMotionFamilyCount(clips = []) {
  const families = new Set();
  for (const clip of asArray(clips).filter(isRealMaterialisedClip)) {
    const clipPath = normalisePathKey(clipPathValue(clip));
    if (clipPath) {
      families.add(clipPath);
      continue;
    }
    const family = normaliseMotionSourceKey(
      cleanText(
        clip.source_family ||
          clip.motion_family ||
          clip.clip_family ||
          clip.id ||
          clip.path ||
          clip.url ||
          clip.source_url,
      ),
    );
    if (family) families.add(family);
  }
  return families.size;
}

function directMotionCoversCompactAudio({ clips = [], audioDurationS = null } = {}) {
  const duration = numberOrNull(audioDurationS);
  if (duration == null || duration <= 0 || duration >= 42) return false;
  const directClips = asArray(clips)
    .filter(isRealMaterialisedClip)
    .filter((clip) => !isReadableApprovedOwnedExplainerClip(clip));
  if (directClips.length < 5) return false;
  const familyCount = directMotionFamilyCount(directClips);
  const directCoverageS = directClips.reduce(
    (sum, clip) => sum + clipDurationSeconds(clip, 0),
    0,
  );
  const allSteamOfficialWindows = directClips.every((clip) =>
    /steam_movie|steamstatic|store_trailers/i.test(
      [
        clip.source_type,
        clip.source_kind,
        clip.media_kind,
        clip.source_family,
        clip.motion_family,
        clip.source_url,
        clip.url,
      ].map(cleanText).join(" "),
    ),
  );
  if (duration >= 30 && (directClips.length < 7 || familyCount < 7 || !allSteamOfficialWindows)) {
    return false;
  }
  const nearCoverageAllowed =
    duration >= 30 &&
    directClips.length >= 7 &&
    familyCount >= 7 &&
    allSteamOfficialWindows;
  const minimumCoverageRatio = nearCoverageAllowed ? 0.82 : 1;
  if (directCoverageS < duration * minimumCoverageRatio) return false;
  return familyCount >= Math.min(5, directClips.length);
}

function directMotionCoversFullShortAudio({ clips = [], audioDurationS = null } = {}) {
  const duration = numberOrNull(audioDurationS);
  if (duration == null || duration <= 0 || duration > 60) return false;
  const directClips = asArray(clips)
    .filter(isRealMaterialisedClip)
    .filter((clip) => !isReadableApprovedOwnedExplainerClip(clip));
  if (directClips.length < 8) return false;
  const sourceRoots = new Set(
    directClips
      .map((clip) => strictDirectMotionBaseSourceKey(clip))
      .filter(Boolean),
  );
  if (sourceRoots.size < 8) return false;
  return clipCoverageDurationS(directClips) + 0.12 >= duration;
}

function shouldSkipReadableShellCardsForAudioBudget({
  audioDurationS = null,
  primaryClips = [],
  fallbackClips = [],
  wordTimestampSource = "",
} = {}) {
  const duration = numberOrNull(audioDurationS);
  if (duration == null) return false;
  if (!/local_whisper_word_alignment|whisper/i.test(cleanText(wordTimestampSource))) return false;
  const primary = asArray(primaryClips).filter((clip) => !isReadableApprovedOwnedExplainerClip(clip));
  const fallback = asArray(fallbackClips).filter((clip) => !isReadableApprovedOwnedExplainerClip(clip));
  if (!primary.length && !fallback.length) return false;
  const windowPool = fallback.length > primary.length ? fallback : primary;
  if (directMotionCoversFullShortAudio({ clips: windowPool, audioDurationS: duration })) {
    return true;
  }
  if (directMotionCoversCompactAudio({ clips: windowPool, audioDurationS: duration })) {
    return true;
  }
  if (!hasBalancedTwoRootWindowPool(windowPool)) return false;
  const directCoverageS = primary.reduce(
    (sum, clip) => sum + clipDurationSeconds(clip, 0),
    0,
  );
  return (
    duration < 24 &&
    primary.length >= 4 &&
    primary.length <= 6 &&
    primary.length !== 5 &&
    directCoverageS >= duration
  );
}

function ownedExplainerMotionAllowed(materialisedMotion = {}, footageInventory = {}) {
  return (
    cleanText(materialisedMotion.status) === "ready" &&
    (
      materialisedMotion.owned_explainer_visual_plan === true ||
      footageInventory.motion_budget?.allow_owned_explainer_motion_only === true ||
      footageInventory.motion_budget?.owned_explainer_visual_plan === true ||
      footageInventory.motion_inventory?.owned_explainer_visual_plan === true
    )
  );
}

function materialisedMotionClips(materialisedMotion = {}) {
  if (Array.isArray(materialisedMotion)) return materialisedMotion.filter(Boolean);
  return [
    ...asArray(materialisedMotion.clips),
    ...asArray(materialisedMotion.materialised_clips),
    ...asArray(materialisedMotion.materialized_clips),
    ...asArray(materialisedMotion.production_motion_clips),
  ].filter(Boolean);
}

function dedupeClipObjects(clips = []) {
  const seen = new Set();
  const deduped = [];
  for (const clip of asArray(clips)) {
    const clipPath = clipPathValue(clip);
    const key = normalisePathKey(clipPath || cleanText(clip.id || clip.asset_id || clip.source_url));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push({ ...clip, path: clipPath || clip.path });
  }
  return deduped;
}

function steamAppIdsForClip(clip = {}) {
  const values = [
    clip.steam_app_id,
    clip.store_app_id,
    clip.source_asset_key,
    clip.source_family,
    clip.motion_family,
    clip.visual_family,
    clip.source_url,
    clip.url,
    clip.reference_url,
  ].map(cleanText);
  const ids = [];
  for (const value of values) {
    for (const pattern of [
      /\bsteam:(\d{3,})\b/gi,
      /\bsteam[_:-](\d{3,})\b/gi,
      /store_trailers\/(\d{3,})\//gi,
    ]) {
      for (const match of value.matchAll(pattern)) ids.push(match[1]);
    }
  }
  return [...new Set(ids)];
}

function filterSteamAppOutlierClips(clips = []) {
  const rows = asArray(clips).map((clip) => ({ clip, ids: steamAppIdsForClip(clip) }));
  const rowsWithSteamId = rows.filter((row) => row.ids.length === 1);
  if (rowsWithSteamId.length < 4) return clips;
  const counts = new Map();
  for (const row of rowsWithSteamId) counts.set(row.ids[0], (counts.get(row.ids[0]) || 0) + 1);
  if (counts.size < 2) return clips;
  const [dominantId, dominantCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (!dominantId || dominantCount < 3 || dominantCount / rowsWithSteamId.length < 0.65) return clips;
  const kept = rows.filter((row) => row.ids.length !== 1 || row.ids[0] === dominantId).map((row) => row.clip);
  return kept.filter(isRealMaterialisedClip).length >= 3 ? kept : clips;
}

function youtubeMotionSourceKey(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    const host = parsed.hostname.toLowerCase().replace(/^(?:www\.|m\.)/, "");
    if (host === "youtube.com") {
      const pathVideoId = parsed.pathname.match(/^\/(?:shorts|embed|live)\/([^/?#]+)/i)?.[1];
      const videoId = cleanText(parsed.searchParams.get("v") || pathVideoId);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
    if (host === "youtu.be") {
      const videoId = cleanText(parsed.pathname.split("/").filter(Boolean)[0]);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
  } catch {}
  return "";
}

function clipBaseSourceKey(clip = {}) {
  if (!clip || typeof clip !== "object") return "";
  const windowedFamily = cleanText(clip.source_family || clip.motion_family);
  const url = cleanText(clip.source_url || clip.url || clip.original_source_url || clip.reference_url);
  const clipText = [
    windowedFamily,
    clip.source_type,
    clip.source_kind,
    clip.media_kind,
    clip.source_url_kind,
    clip.source_url,
    clip.url,
    clip.licence_basis,
    clip.license_basis,
    clip.rights_basis,
    clip.allowed_use,
    clip.approval_status,
  ].map(cleanText).join(" ").toLowerCase();
  const generatedOrOwned = /generated|owned_generated|pulse-generated|rss_story_v4_clip|local:\/\/pulse-generated/i.test(clipText);
  const directMedia = /\b(?:direct_video|video_file|official_trailer_segment|official_game_website_media_page|official_social_media_video|licensed_direct_media|steam_movie|publisher_trailer)\b/i.test(clipText);
  if (
    /(?:^|[_/-])window[_/-]?\d+/i.test(windowedFamily) &&
    !generatedOrOwned &&
    /\b(?:official_trailer_segment|official_game_website_media_page|official_game_site_news_page|official_social_media_video|licensed_direct_media|steam_movie|hls_manifest|dash_manifest|publisher_trailer)\b/i.test(clipText)
  ) {
    return normaliseMotionSourceKey(windowedFamily);
  }
  if (url && directMedia && !generatedOrOwned) {
    const youtubeKey = youtubeMotionSourceKey(url);
    if (youtubeKey) {
      const mediaStartS = numberOrNull(
        clip.mediaStartS ?? clip.media_start_s ?? clip.start_s ?? clip.startS,
      );
      const durationS = numberOrNull(clip.durationS ?? clip.duration_s ?? clip.duration);
      if (mediaStartS != null && mediaStartS >= 0) {
        const startKey = Number(mediaStartS.toFixed(3));
        const durationKey = durationS != null && durationS > 0
          ? `_${Number(durationS.toFixed(3))}`
          : "";
        return `${youtubeKey}_window_${startKey}${durationKey}`;
      }
      return youtubeKey;
    }
    try {
      const parsed = new URL(url);
      return normaliseMotionSourceKey(`${parsed.hostname}${parsed.pathname}`);
    } catch {
      return normaliseMotionSourceKey(url);
    }
  }
  const explicit = cleanText(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family ||
      clip.source_family ||
      clip.motion_family,
  );
  if (explicit) return normaliseMotionSourceKey(explicit);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return normaliseMotionSourceKey(`${parsed.hostname}${parsed.pathname}`);
  } catch {
    return normaliseMotionSourceKey(url);
  }
}

function stripMotionWindowSuffix(value = "") {
  return normaliseMotionSourceKey(value)
    .replace(/(?:[_/-]window[_/-]\d+(?:[_/-]\d+)?)$/i, "")
    .replace(/(?:[_/-]clip[_/-]\d+)$/i, "")
    .replace(/(?:[_/-]segment[_/-]\d+)$/i, "");
}

function strictDirectMotionBaseSourceKey(clip = {}) {
  const base = clipBaseSourceKey(clip);
  if (!base) return "";
  return stripMotionWindowSuffix(base.replace(/^(?:family|url|path):/i, ""));
}

function dedupeClipsByBaseSource(clips = []) {
  const seen = new Set();
  const deduped = [];
  for (const clip of asArray(clips)) {
    const sourceKey = clipBaseSourceKey(clip);
    const pathKey = normalisePathKey(clipPathValue(clip) || cleanText(clip.id || clip.asset_id || clip.source_url));
    const key = sourceKey || pathKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(clip);
  }
  return deduped;
}

function preferStrictDirectMotionBaseUniquenessWhenEnough(
  clips = [],
  { minimumUniqueBases = 6, premiumRunwayClipCount = 10, premiumRunwayMinimumUniqueBases = 7 } = {},
) {
  const selected = asArray(clips);
  const seen = new Set();
  const uniqueBaseClips = [];
  for (const clip of selected) {
    const sourceKey = strictDirectMotionBaseSourceKey(clip);
    const fallbackKey = normalisePathKey(clipPathValue(clip) || cleanText(clip.id || clip.asset_id || clip.source_url));
    const key = sourceKey || fallbackKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueBaseClips.push(clip);
  }
  if (
    selected.length >= premiumRunwayClipCount &&
    uniqueBaseClips.length >= premiumRunwayMinimumUniqueBases
  ) {
    return selected;
  }
  return uniqueBaseClips.length >= minimumUniqueBases && uniqueBaseClips.length < selected.length
    ? uniqueBaseClips
    : selected;
}

function clipFileSizeBytes(clip = {}) {
  const clipPath = clipPathValue(clip);
  if (!clipPath) return null;
  try {
    const stat = fs.statSync(path.resolve(clipPath));
    return stat.isFile() ? stat.size : null;
  } catch {
    return null;
  }
}

function clipSidecarDurationS(clip = {}) {
  const clipPath = clipPathValue(clip);
  if (!clipPath || /\.json$/i.test(clipPath)) return null;
  try {
    const sidecar = fs.readJsonSync(`${clipPath}.json`);
    const duration = numberOrNull(sidecar.durationS ?? sidecar.duration_s ?? sidecar.duration);
    return Number.isFinite(duration) && duration > 0 ? Number(duration.toFixed(2)) : null;
  } catch {
    return null;
  }
}

function isLikelyLowPayloadSlateClip(clip = {}) {
  const clipPath = clipPathValue(clip);
  if (!/\.mp4$/i.test(clipPath)) return false;
  const text = [
    clip.source_type,
    clip.media_kind,
    clip.source_url,
    clip.rights_basis,
    clip.licence_basis,
  ].map(cleanText).join(" ").toLowerCase();
  if (!/(?:youtube|youtu\.be|official_youtube|publisher_youtube)/.test(text)) return false;
  const sizeBytes = clipFileSizeBytes(clip);
  return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes < 160_000;
}

function filterLowPayloadSlateClipsWhenSafe(clips = []) {
  const kept = asArray(clips).filter((clip) => !isLikelyLowPayloadSlateClip(clip));
  return kept.length >= 3 ? kept : clips;
}

function preferredMaterialisedClips({ materialisedMotion = {}, footageInventory = {}, rightsLedger = {}, job = {} } = {}) {
  const fallbackClips = asArray(job.evidence?.materialised_motion_clip_paths)
    .map((clipPath, index) => ({
      id: `production_motion_${index + 1}`,
      path: pathOrNull(clipPath),
      source_family: `production_motion_${index + 1}`,
    }))
    .filter((clip) => /\.(?:mp4|mov|webm|mkv)$/i.test(clip.path || ""));
  const materialisedOnlyClips = filterSteamAppOutlierClips(
    dedupeClipObjects(materialisedMotionClips(materialisedMotion)),
  );
  const materialisedOnlyRealClips = preferStrictDirectMotionBaseUniquenessWhenEnough(
    dedupeClipsByBaseSource(filterLowPayloadSlateClipsWhenSafe(
      rotateFirstClipForRepair(
        prioritiseOpeningMotionClips(materialisedOnlyClips.filter(isRealMaterialisedClip)),
        job,
      ),
    )),
  );
  const preservedEvidenceRealClips = preferStrictDirectMotionBaseUniquenessWhenEnough(
    dedupeClipsByBaseSource(filterLowPayloadSlateClipsWhenSafe(
      rotateFirstClipForRepair(
        prioritiseOpeningMotionClips(
          dedupeClipObjects([
            ...rightsLedgerMotionClips(rightsLedger),
            ...footageMotionClips(footageInventory),
          ]).filter(isRealMaterialisedClip),
        ),
        job,
      ),
    )),
  );
  const materialisedOnlyOwnedExplainerClips = materialisedOnlyClips
    .filter(isApprovedOwnedExplainerClip)
    .sort((a, b) =>
      (numberOrNull(b.durationS ?? b.duration_s ?? b.duration) || 0) -
      (numberOrNull(a.durationS ?? a.duration_s ?? a.duration) || 0),
    );
  const materialisedOwnedExplainerReady =
    materialisedOnlyOwnedExplainerClips.length > 0 &&
    ownedExplainerMotionAllowed(materialisedMotion, footageInventory);
  if (manifestReadyStatus(materialisedMotion) && (materialisedOnlyRealClips.length || materialisedOwnedExplainerReady)) {
    const hasDirectVideoMotion = materialisedOnlyRealClips.some((clip) => openingMotionPriority(clip) < 2);
    if (hasDirectVideoMotion) {
      const realKeys = new Set(
        materialisedOnlyRealClips.map((clip) => normalisePathKey(clipPathValue(clip))).filter(Boolean),
      );
      const ownedTopUpCandidates = materialisedOnlyOwnedExplainerClips.filter((clip) => {
        const key = normalisePathKey(clipPathValue(clip));
        return key && !realKeys.has(key);
      });
      const nonReadableOwnedTopUp = selectNonReadableOwnedExplainerTopUpForMotionBalance(
        ownedTopUpCandidates,
        materialisedOnlyRealClips,
      );
      const ownedTopUp = selectReadableOwnedExplainerTopUpForMotionBalance(
        ownedTopUpCandidates.filter((clip) => {
          const key = normalisePathKey(clipPathValue(clip));
          return key && !nonReadableOwnedTopUp.some((selected) => normalisePathKey(clipPathValue(selected)) === key);
        }),
        materialisedOnlyRealClips,
      );
      if (!nonReadableOwnedTopUp.length && !ownedTopUp.length) return materialisedOnlyRealClips;
      const directLeadCount = Math.min(4, materialisedOnlyRealClips.length);
      return [
        ...materialisedOnlyRealClips.slice(0, directLeadCount),
        ...nonReadableOwnedTopUp,
        ownedTopUp[0],
        ...materialisedOnlyRealClips.slice(directLeadCount),
        ...ownedTopUp.slice(1),
      ].filter(Boolean);
    }
    if (!materialisedOnlyRealClips.length && materialisedOwnedExplainerReady) {
      if (preservedEvidenceRealClips.length >= 3) {
        return preservedEvidenceRealClips.slice(0, Math.max(8, preservedEvidenceRealClips.length));
      }
      return materialisedOnlyOwnedExplainerClips.slice(0, Math.max(8, materialisedOnlyOwnedExplainerClips.length));
    }
    const realKeys = new Set(materialisedOnlyRealClips.map((clip) => normalisePathKey(clipPathValue(clip))).filter(Boolean));
    const ownedTopUp = fallbackClips.filter((clip) => {
      const key = normalisePathKey(clipPathValue(clip));
      return key && !realKeys.has(key);
    });
    return [...materialisedOnlyRealClips, ...ownedTopUp].slice(0, Math.max(8, materialisedOnlyRealClips.length));
  }
  const allClips = filterSteamAppOutlierClips(dedupeClipObjects([
    ...rightsLedgerMotionClips(rightsLedger),
    ...materialisedMotionClips(materialisedMotion),
    ...footageMotionClips(footageInventory),
  ]));
  const prioritisedRealClips = rotateFirstClipForRepair(
    prioritiseOpeningMotionClips(allClips.filter(isRealMaterialisedClip)),
    job,
  );
  const realClips = preferStrictDirectMotionBaseUniquenessWhenEnough(
    dedupeClipsByBaseSource(filterLowPayloadSlateClipsWhenSafe(prioritisedRealClips)),
  );
  const rejectedRealClipKeys = new Set(
    prioritisedRealClips
      .filter((clip) => !realClips.some((kept) => normalisePathKey(clipPathValue(kept)) === normalisePathKey(clipPathValue(clip))))
      .map((clip) => normalisePathKey(clipPathValue(clip)))
      .filter(Boolean),
  );
  const ownedExplainerClips = allClips.filter(isApprovedOwnedExplainerClip);
  if (realClips.length >= 3) {
    const realKeys = new Set(realClips.map((clip) => normalisePathKey(clipPathValue(clip))).filter(Boolean));
    const ownedTopUp = fallbackClips.filter((clip) => {
      const key = normalisePathKey(clipPathValue(clip));
      return key && !realKeys.has(key) && !rejectedRealClipKeys.has(key);
    });
    return [...realClips, ...ownedTopUp].slice(0, Math.max(8, realClips.length));
  }
  if (
    ownedExplainerClips.length >= 5 &&
    ownedExplainerMotionAllowed(materialisedMotion, footageInventory)
  ) {
    return ownedExplainerClips.slice(0, Math.max(8, ownedExplainerClips.length));
  }
  return fallbackClips;
}

function openingMotionPriority(clip = {}) {
  const text = [
    clip.media_kind,
    clip.source_type,
    clip.asset_type,
    clip.source_url,
    clip.path,
  ].map(cleanText).join(" ").toLowerCase();
  if (/(?:direct_video|steam_movie|official_trailer|publisher_trailer|licensed_direct_media_url)/.test(text)) return 0;
  if (/(?:motion_clip|gameplay_clip|video_clip)/.test(text) && !/(?:screenshot|visual_still|still)/.test(text)) return 1;
  if (/(?:visual_still|screenshot|storefront_image|image-hero|character-rotator)/.test(text)) return 2;
  return 3;
}

function prioritiseOpeningMotionClips(clips = []) {
  return asArray(clips)
    .map((clip, index) => ({ clip, index, priority: openingMotionPriority(clip) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map((row) => row.clip);
}

function proofCardFromDirector(director = {}) {
  const proof = asArray(director.shot_plan).find((shot) => cleanText(shot.kind) === "proof_card");
  return {
    proof_card_primary: cleanText(proof?.label),
    proof_card_secondary: cleanText(proof?.detail),
  };
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function genericProofCardText(value = "") {
  return /^(?:source locked|one claim,\s*one source|proof beat|why it matters)?$/i.test(cleanText(value));
}

function semanticProofCardFromCanonical(canonical = {}) {
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.selected_title);
  const claim = cleanText(asArray(canonical.confirmed_claims)[0] || canonical.primary_claim || canonical.narration_script);
  const text = lowerText([
    subject,
    canonical.selected_title,
    claim,
    canonical.description,
    canonical.first_spoken_line,
  ].join(" "));
  if (/\bhades ii\b/.test(text) && /\bxbox\b/.test(text) && /\bplaystation\b/.test(text) && /\bapril\s*14\b/.test(text)) {
    return {
      proof_card_primary: "APRIL 14 CONSOLE DATE",
      proof_card_secondary: "XBOX + PLAYSTATION LISTED",
    };
  }
  if (/\bmetacritic\b/.test(text) && /highest[-\s]rated|score|rated/.test(text)) {
    return {
      proof_card_primary: "METACRITIC SIGNAL",
      proof_card_secondary: "SCORE LEADS THE STORY",
    };
  }
  if (/steam/.test(text) && /xbox|forza/.test(text)) {
    return {
      proof_card_primary: "STEAM BREAKOUT",
      proof_card_secondary: "XBOX STRATEGY SIGNAL",
    };
  }
  if (/gameplay|trailer|showcase/.test(text)) {
    return {
      proof_card_primary: "OFFICIAL FOOTAGE",
      proof_card_secondary: `${subject.toUpperCase().slice(0, 28) || "GAME"} ON SCREEN`,
    };
  }
  if (claim) {
    return {
      proof_card_primary: subject ? `${subject.toUpperCase().slice(0, 28)} PROOF` : "SOURCE PROOF",
      proof_card_secondary: cleanText(canonical.primary_source || "SOURCE") .toUpperCase().slice(0, 28),
    };
  }
  return {
    proof_card_primary: "SOURCE PROOF",
    proof_card_secondary: "CLAIM CHECKED",
  };
}

function productionProofCard({ director = {}, canonical = {} } = {}) {
  const directorProof = proofCardFromDirector(director);
  if (
    !genericProofCardText(directorProof.proof_card_primary) &&
    !genericProofCardText(directorProof.proof_card_secondary)
  ) {
    return directorProof;
  }
  return semanticProofCardFromCanonical(canonical);
}

function footageMotionClips(footageInventory = {}) {
  return [
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
    ...asArray(footageInventory.accepted_local_clips),
    ...asArray(footageInventory.production_motion_clips),
    ...asArray(footageInventory.clips),
  ].filter(Boolean);
}

function recordsFromRightsLedger(rightsLedger = {}) {
  if (Array.isArray(rightsLedger)) return rightsLedger.filter(Boolean);
  return [
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.rights_ledger),
  ].filter(Boolean);
}

function inferredStorefrontLicenceBasis(record = {}) {
  const text = [
    record.source_type,
    record.source_kind,
    record.source_url,
    record.url,
    record.path,
    record.source_family,
    record.rights_risk_class,
  ]
    .map(cleanText)
    .join(" ")
    .toLowerCase();
  if (!text) return "";
  if (/steam|storefront|store_item_assets|steamstatic|akamai\.steamstatic|fastly\.steamstatic/.test(text)) {
    return "steam_storefront_promotional_editorial_use";
  }
  if (/xboxservices\.com|xbox\.com|playstation\.com|nintendo\.com|official_platform_product_page/.test(text)) {
    return "source_documented_transformative_editorial_use";
  }
  return "";
}

function normaliseRightsRecord(record = {}) {
  if (!record || typeof record !== "object") return record;
  const licenceBasis = cleanText(record.licence_basis || record.license_basis || record.rights_basis);
  if (licenceBasis) return record;
  const inferred = inferredStorefrontLicenceBasis(record);
  if (!inferred) return record;
  return {
    ...record,
    licence_basis: inferred,
    rights_basis: cleanText(record.rights_basis) || inferred,
    allowed_use: cleanText(record.allowed_use) || "transformative_editorial_short_form",
    allowed_platforms: asArray(record.allowed_platforms).length
      ? record.allowed_platforms
      : ["youtube", "tiktok", "instagram", "facebook"],
    commercial_use_allowed: record.commercial_use_allowed ?? true,
    approval_status: cleanText(record.approval_status) || "approved_for_transformative_editorial_use",
    risk_score: Number.isFinite(Number(record.risk_score)) ? Number(record.risk_score) : 0.28,
  };
}

function normaliseRightsLedgerForRender(rightsLedger = {}) {
  if (Array.isArray(rightsLedger)) return rightsLedger.map(normaliseRightsRecord);
  if (!rightsLedger || typeof rightsLedger !== "object") return rightsLedger;
  const normalised = { ...rightsLedger };
  for (const key of ["records", "assets", "rights_ledger", "matched_assets"]) {
    if (Array.isArray(normalised[key])) normalised[key] = normalised[key].map(normaliseRightsRecord);
  }
  const unresolved = [
    ...asArray(normalised.records),
    ...asArray(normalised.assets),
    ...asArray(normalised.rights_ledger),
    ...asArray(normalised.matched_assets),
  ].filter((record) => !cleanText(record.licence_basis || record.license_basis || record.rights_basis));
  if (!unresolved.length && failStatus(normalised.verdict || normalised.result)) {
    normalised.verdict = "pass";
    normalised.result = "pass";
    normalised.failures = asArray(normalised.failures).filter((failure) => !/licen[cs]e_basis_missing/i.test(cleanText(failure)));
  }
  return normalised;
}

function rightsLedgerMotionClips(rightsLedger = {}) {
  return recordsFromRightsLedger(rightsLedger).filter((record) => {
    const text = [
      record.asset_type,
      record.kind,
      record.type,
      record.source_type,
      record.media_kind,
      record.path,
      record.source_url,
    ].map(cleanText).join(" ").toLowerCase();
    if (/\.(?:wav|mp3|aac|m4a|flac|ogg)(?:$|[\s?#])/i.test(text)) return false;
    if (!clipPathValue(record)) return false;
    return /motion_clip|video|direct_media|trailer|gameplay|\.mp4|\.mov|\.webm/.test(text);
  });
}

function keySuffixes(value) {
  const key = normalisePathKey(value);
  if (!key) return [];
  const outputIndex = key.lastIndexOf("/output/");
  const suffixes = [key];
  if (outputIndex >= 0) suffixes.push(key.slice(outputIndex + 1));
  const filename = key.split("/").pop();
  if (filename) suffixes.push(filename);
  return [...new Set(suffixes.filter(Boolean))];
}

function indexedRightsRecords(rightsLedger = {}) {
  const byKey = new Map();
  for (const record of recordsFromRightsLedger(rightsLedger)) {
    const keys = [
      ...keySuffixes(record.path || record.local_path || record.file_path || record.media_path),
      ...keySuffixes(record.source_url || record.url),
      cleanText(record.asset_id).toLowerCase(),
      cleanText(record.id).toLowerCase(),
      cleanText(record.source_family).toLowerCase(),
      cleanText(record.motion_family).toLowerCase(),
    ].filter(Boolean);
    for (const key of keys) if (!byKey.has(key)) byKey.set(key, record);
  }
  return byKey;
}

function matchingRightsRecord(clip = {}, rightsByKey = new Map()) {
  const keys = [
    ...keySuffixes(clipPathValue(clip)),
    ...keySuffixes(clip.source_url || clip.url),
    cleanText(clip.asset_id).toLowerCase(),
    cleanText(clip.id).toLowerCase(),
    cleanText(clip.source_family).toLowerCase(),
    cleanText(clip.motion_family).toLowerCase(),
  ].filter(Boolean);
  for (const key of keys) {
    if (rightsByKey.has(key)) return rightsByKey.get(key);
  }
  return null;
}

function productionClipObjects({ footageInventory = {}, rightsLedger = {}, job = {}, materialisedMotion = {} } = {}) {
  const byPath = new Map();
  for (const clip of footageMotionClips(footageInventory)) {
    const key = normalisePathKey(clip.path || clip.local_path || clip.file_path || clip.media_path);
    if (key && !byPath.has(key)) byPath.set(key, clip);
  }
  const rightsByKey = indexedRightsRecords(rightsLedger);
  const preferred = preferredMaterialisedClips({ materialisedMotion, footageInventory, rightsLedger, job });
  const selected = preferred.length
      ? preferred.map((clip, index) => {
        const clipPath = clipPathValue(clip);
        const key = normalisePathKey(clipPath);
        const source = byPath.get(key) || matchingRightsRecord(clip, rightsByKey) || clip || {};
        const rights = matchingRightsRecord(source, rightsByKey) || matchingRightsRecord(clip, rightsByKey) || {};
        const merged = { ...rights, ...source, ...clip };
        const clipPathForDuration = clipPath || clipPathValue(merged);
        const duration = numberOrNull(
          merged.durationS ??
            merged.duration_s ??
            merged.duration ??
            merged.source_duration_s ??
            clipSidecarDurationS(merged) ??
            clipSidecarDurationS({ path: clipPathForDuration }),
        );
        return {
          ...merged,
          id: clipIdentity(merged, index),
          path: clipPath,
          source_url: cleanText(clip.source_url || source.source_url || source.url || rights.source_url || rights.url),
          source_type: cleanText(clip.source_type || source.source_type || source.asset_type || rights.source_type || rights.asset_type || "materialised_motion_clip"),
          source_kind: cleanText(clip.source_kind || source.source_kind || rights.source_kind),
          source_family: cleanText(clip.source_family || clip.motion_family || source.source_family || source.motion_family || rights.source_family || rights.motion_family || source.id || source.asset_id || `production_motion_${index + 1}`),
          base_source_family: cleanText(clip.base_source_family || source.base_source_family || rights.base_source_family || clip.original_source_family || source.original_source_family),
          motion_family: cleanText(clip.motion_family || source.motion_family || rights.motion_family || clip.source_family || source.source_family),
          visual_family: cleanText(clip.visual_family || source.visual_family || rights.visual_family || clip.motion_family || source.motion_family || clip.source_family || source.source_family),
          asset_class: cleanText(clip.asset_class || clip.visual_asset_class || source.asset_class || source.visual_asset_class || rights.asset_class || rights.visual_asset_class),
          media_kind: cleanText(clip.media_kind || source.media_kind || rights.media_kind),
          durationS: duration,
          duration: duration,
          owned_explainer_visual_plan:
            clip.owned_explainer_visual_plan === true ||
            source.owned_explainer_visual_plan === true ||
            rights.owned_explainer_visual_plan === true,
        };
      })
    : footageMotionClips(footageInventory);
  const seen = new Set();
  const clips = [];
  for (const clip of selected) {
    const key = normalisePathKey(clip.path || clip.local_path || clip.file_path || clip.media_path || clip.source_url || clip.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    clips.push(clip);
  }
  return clips;
}

function renderedScenePlanScenes(renderReport = {}, renderManifest = {}) {
  const plan = objectValue(
    renderReport.clip_scene_plan ||
      renderReport.clipScenePlan ||
      renderManifest.clip_scene_plan ||
      renderManifest.clipScenePlan,
  );
  return asArray(plan.scenes);
}

function renderedScenePlanClipObjects({ renderReport = {}, renderManifest = {}, fallbackClips = [] } = {}) {
  const scenes = renderedScenePlanScenes(renderReport, renderManifest)
    .filter((scene) => cleanText(scene.path || scene.local_path || scene.file_path || scene.media_path));
  if (scenes.length < 3) return [];

  const fallbackByPath = new Map();
  const fallbackByFamily = new Map();
  for (const [index, clip] of asArray(fallbackClips).entries()) {
    const pathKey = normalisePathKey(clipPathValue(clip));
    if (pathKey && !fallbackByPath.has(pathKey)) fallbackByPath.set(pathKey, clip);
    for (const family of [
      clip.base_source_family,
      clip.source_family,
      clip.motion_family,
      clip.visual_family,
      clip.asset_id,
      clip.id,
      `render_scene_${index + 1}`,
    ]) {
      const key = normalisePathKey(family);
      if (key && !fallbackByFamily.has(key)) fallbackByFamily.set(key, clip);
    }
  }

  return scenes.map((scene, index) => {
    const pathValue = cleanText(scene.path || scene.local_path || scene.file_path || scene.media_path);
    const pathKey = normalisePathKey(pathValue);
    const familyKey = normalisePathKey(
      scene.baseSourceKey ||
        scene.base_source_key ||
        scene.source_family ||
        scene.motion_family ||
        scene.id,
    );
    const fallback = fallbackByPath.get(pathKey) || fallbackByFamily.get(familyKey) || {};
    const readableCardKind = cleanText(scene.readableCardKind || scene.readable_card_kind);
    const isReadableCard = Boolean(readableCardKind);
    const sourceFamily = cleanText(
      fallback.source_family ||
        fallback.motion_family ||
        scene.source_family ||
        scene.motion_family ||
        scene.baseSourceKey ||
        scene.base_source_key ||
        (isReadableCard ? `hyperframes_${readableCardKind}_card` : `render_scene_${index + 1}`),
    );
    const duration = numberOrNull(
      fallback.durationS ??
        fallback.duration_s ??
        fallback.duration ??
        clipSidecarDurationS(fallback) ??
        clipSidecarDurationS({ path: pathValue }) ??
        scene.durationS ??
        scene.duration_s ??
        scene.duration,
    );
    return {
      ...fallback,
      ...scene,
      id: cleanText(scene.id || fallback.id || fallback.asset_id || `render_scene_${index + 1}`),
      asset_id: cleanText(scene.asset_id || fallback.asset_id || fallback.id || `render_scene_${index + 1}`),
      path: pathValue,
      local_materialized_path: pathValue,
      source_family: sourceFamily,
      motion_family: cleanText(fallback.motion_family || scene.motion_family || sourceFamily),
      base_source_family: cleanText(fallback.base_source_family || scene.baseSourceKey || scene.base_source_key || sourceFamily),
      source_type: cleanText(
        scene.source_type ||
          fallback.source_type ||
          fallback.asset_type ||
          (isReadableCard ? "internally_generated_motion_graphic" : "rendered_scene_motion_clip"),
      ),
      source_kind: cleanText(
        scene.source_kind ||
          fallback.source_kind ||
          (isReadableCard ? "hyperframes_readable_card" : "rendered_final_scene"),
      ),
      asset_class: cleanText(
        scene.asset_class ||
          fallback.asset_class ||
          fallback.visual_asset_class ||
          (isReadableCard ? `${readableCardKind}_card` : ""),
      ),
      media_kind: cleanText(scene.media_kind || fallback.media_kind || fallback.asset_type || "motion_clip"),
      source_url: cleanText(
        scene.source_url ||
          fallback.source_url ||
          fallback.url ||
          (isReadableCard ? `local://pulse-hyperframes/${sourceFamily}` : ""),
      ),
      rights_basis: cleanText(
        scene.rights_basis ||
          fallback.rights_basis ||
          fallback.licence_basis ||
          (isReadableCard ? "owned_generated_editorial_motion_graphic" : ""),
      ),
      licence_basis: cleanText(
        scene.licence_basis ||
          fallback.licence_basis ||
          fallback.rights_basis ||
          (isReadableCard ? "owned_generated_editorial_motion_graphic" : ""),
      ),
      commercial_use_allowed:
        scene.commercial_use_allowed ??
        fallback.commercial_use_allowed ??
        (isReadableCard ? true : undefined),
      approval_status: cleanText(
        scene.approval_status ||
          fallback.approval_status ||
          (isReadableCard ? "approved_for_owned_editorial_use" : ""),
      ),
      owned_explainer_visual_plan:
        scene.owned_explainer_visual_plan === true ||
        fallback.owned_explainer_visual_plan === true ||
        isReadableCard,
      durationS: Number.isFinite(duration) && duration > 0 ? duration : 2.4,
      duration_s: Number.isFinite(duration) && duration > 0 ? duration : 2.4,
      duration: Number.isFinite(duration) && duration > 0 ? duration : 2.4,
    };
  });
}

function sourceUrlKindForClip(clip = {}) {
  const explicit = cleanText(clip.source_url_kind || clip.sourceUrlKind);
  if (explicit) return explicit;
  const clipPath = clipPathValue(clip);
  if (/\.m3u8(?:$|[?#])/i.test(clipPath)) return "hls_manifest";
  if (/\.(?:mp4|mov|m4v|webm|mkv)(?:$|[?#])/i.test(clipPath)) return "direct_video";
  return "unknown";
}

function directorClipFromProductionClip(clip = {}, index = 0) {
  const clipPath = clipPathValue(clip);
  const sourceFamily = cleanText(
    clip.source_family ||
      clip.motion_family ||
      clip.asset_id ||
      clip.id ||
      `production_motion_${index + 1}`,
  );
  return {
    ...clip,
    id: clipIdentity(clip, index),
    path: clipPath,
    source_family: sourceFamily,
    source_type: cleanText(clip.source_type || clip.asset_type || "materialised_motion_clip"),
    source_url: cleanText(clip.source_url || clip.url),
    source_url_kind: sourceUrlKindForClip(clip),
    media_kind: cleanText(clip.media_kind || clip.asset_type || "motion_clip"),
    durationS: Number(clip.durationS ?? clip.duration_s ?? clip.duration) || 2.4,
    duration_s: Number(clip.durationS ?? clip.duration_s ?? clip.duration) || 2.4,
    duration: Number(clip.durationS ?? clip.duration_s ?? clip.duration) || 2.4,
    validated: clip.validated !== false,
  };
}

function rendererBridgeClipFromProductionClip(clip = {}, index = 0) {
  const mediaStartS = numberOrNull(
    clip.mediaStartS ?? clip.media_start_s ?? clip.start_s ?? clip.startS,
  );
  return {
    id: clipIdentity(clip, index),
    path: clipPathValue(clip),
    source_url: cleanText(clip.source_url || clip.url),
    source_type: cleanText(clip.source_type || clip.asset_type),
    source_kind: cleanText(clip.source_kind),
    source_family: cleanText(clip.source_family || clip.motion_family),
    base_source_family: cleanText(clip.base_source_family || clip.original_source_family || clip.provenance?.base_source_family),
    motion_family: cleanText(clip.motion_family || clip.source_family),
    visual_family: cleanText(clip.visual_family || clip.motion_family || clip.source_family),
    asset_class: cleanText(clip.asset_class || clip.visual_asset_class) || null,
    media_kind: cleanText(clip.media_kind),
    source_url_kind: cleanText(clip.source_url_kind),
    text: cleanText(clip.text || clip.readable_text),
    readable_text: cleanText(clip.readable_text || clip.text),
    minimum_readable_duration_s: numberOrNull(
      clip.minimum_readable_duration_s ??
        clip.minimum_visible_duration_s ??
        clip.min_readable_duration_s,
    ),
    max_readable_card_duration_s: numberOrNull(
      clip.max_readable_card_duration_s ??
        clip.maximum_visible_duration_s ??
        clip.maximum_readable_duration_s,
    ),
    maximum_visible_duration_s: numberOrNull(
      clip.maximum_visible_duration_s ??
        clip.max_readable_card_duration_s ??
        clip.maximum_readable_duration_s,
    ),
    readable_card_duration_extension_s: numberOrNull(clip.readable_card_duration_extension_s),
    mediaStartS,
    media_start_s: mediaStartS,
    start_s: mediaStartS,
    durationS: numberOrNull(clip.durationS ?? clip.duration_s ?? clip.duration),
    duration_s: numberOrNull(clip.duration_s ?? clip.durationS ?? clip.duration),
    duration: numberOrNull(clip.duration ?? clip.durationS ?? clip.duration_s),
    owned_explainer_visual_plan: clip.owned_explainer_visual_plan === true,
  };
}

function footagePlanForDirector({ footageInventory = {}, clips = [] } = {}) {
  const existingAccepted = asArray(footageInventory.motion_inventory?.accepted_local_clips);
  if (existingAccepted.length) return footageInventory;

  const accepted = asArray(clips)
    .map(directorClipFromProductionClip)
    .filter((clip) => cleanText(clip.path) && cleanText(clip.source_family));
  const distinctFamilies = [...new Set(accepted.map((clip) => cleanText(clip.source_family)).filter(Boolean))];
  if (!accepted.length) return footageInventory;

  const requiredScenes = Math.max(
    5,
    Number(footageInventory.motion_budget?.required_motion_scenes || 0),
  );
  const requiredFamilies = Math.max(
    4,
    Number(footageInventory.motion_budget?.required_distinct_families || 0),
  );
  const readinessBlockers = [];
  if (accepted.length < requiredScenes) readinessBlockers.push("actual_motion_clip_minimum_not_met");
  if (distinctFamilies.length < requiredFamilies) readinessBlockers.push("distinct_motion_families_minimum_not_met");

  return {
    ...footageInventory,
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      accepted_local_clips: accepted,
      production_motion_clips: asArray(footageInventory.motion_inventory?.production_motion_clips).length
        ? asArray(footageInventory.motion_inventory.production_motion_clips)
        : accepted,
      distinct_source_families: distinctFamilies,
      trusted_local_source_families: asArray(footageInventory.motion_inventory?.trusted_local_source_families).length
        ? asArray(footageInventory.motion_inventory.trusted_local_source_families)
        : distinctFamilies,
    },
    motion_budget: {
      ...(footageInventory.motion_budget || {}),
      required_motion_scenes: requiredScenes,
      available_motion_clips: Math.max(
        Number(footageInventory.motion_budget?.available_motion_clips || 0),
        accepted.length,
      ),
      required_distinct_families: requiredFamilies,
      available_distinct_motion_families: Math.max(
        Number(footageInventory.motion_budget?.available_distinct_motion_families || 0),
        distinctFamilies.length,
      ),
    },
    readiness: {
      ...(footageInventory.readiness || {}),
      status: readinessBlockers.length ? "blocked" : "ready",
      blockers: readinessBlockers,
      warnings: [
        ...uniqueCleanTexts(footageInventory.readiness?.warnings),
        "footage_plan_derived_from_selected_production_clips",
      ],
    },
  };
}

function clipFamily(clip = {}, index = 0) {
  return (
    cleanText(clip.source_family) ||
    cleanText(clip.motion_family) ||
    cleanText(clip.asset_id) ||
    cleanText(clip.id) ||
    `production_motion_${index + 1}`
  ).toLowerCase();
}

function statusText(value) {
  return cleanText(value).toLowerCase();
}

function passStatus(value) {
  return ["pass", "green", "viral_ready", "director_ready", "ready"].includes(statusText(value));
}

function failStatus(value) {
  return ["fail", "failed", "red", "blocked", "blocked_or_rewrite_required"].includes(statusText(value));
}

function rightsCheckStatus(rightsLedger = {}) {
  if (passStatus(rightsLedger.verdict || rightsLedger.result)) return "pass";
  if (failStatus(rightsLedger.verdict || rightsLedger.result)) return "fail";
  if (recordsFromRightsLedger(rightsLedger).length || asArray(rightsLedger.assets).length) return "pass";
  return "not_checked";
}

function buildPostRenderForensicQaReport({
  storyId = "",
  generatedAt = new Date().toISOString(),
  renderManifest = {},
  renderReport = {},
  outputPath = "",
  scriptScorecard = {},
  coherenceReport = {},
  rightsLedger = {},
  directorPlan = {},
  benchmark = {},
  visualQuality = {},
  clips = [],
  audioSegmentReport = {},
  voiceQualityReport = {},
  captionManifest = {},
} = {}) {
  const distinctFamilies = new Set(asArray(clips).map(clipFamily).filter(Boolean));
  const visualProfile =
    visualQuality.visual_evidence_profile ||
    benchmark.visual_evidence_profile ||
    {};
  const visualProfileFamilyCount =
    Number(visualProfile.real_media_family_count || 0) +
    Number(visualProfile.generated_motion_family_count || 0);
  const motionEvidenceCount = Math.max(
    clips.length,
    Number(visualProfile.motion_asset_count || 0),
  );
  const familyEvidenceCount = Math.max(
    distinctFamilies.size,
    visualProfileFamilyCount,
    Number(visualProfile.direct_video_motion_family_count || 0),
  );
  const minMotionClips = Math.max(3, Number(directorPlan.shot_budget?.min_actual_motion_clips || 0) || 0);
  const minFamilies = Math.max(3, Number(directorPlan.shot_budget?.min_distinct_motion_families || 0) || 0);
  const outputReady = renderManifest.final_publish_render === true && cleanText(outputPath || renderManifest.output_path || renderManifest.output);
  const motionFloorPass = motionEvidenceCount >= minMotionClips && !asArray(visualProfile.blockers).length;
  const familyFloorPass = familyEvidenceCount >= minFamilies && !asArray(visualProfile.blockers).length;
  const directorRawStatus =
    directorPlan.readiness?.status ||
    (asArray(directorPlan.shot_plan).length ? "director_ready" : "not_checked");
  const directorRawBlockers = asArray(directorPlan.readiness?.blockers).map(cleanText).filter(Boolean);
  const unresolvedDirectorBlockers = directorRawBlockers.filter((blocker) => {
    if (/actual_motion_clip_minimum_not_met/.test(blocker) && motionFloorPass) return false;
    if (/distinct_motion_families_minimum_not_met/.test(blocker) && familyFloorPass) return false;
    return true;
  });
  const checks = {
    final_render_mp4: outputReady ? "pass" : "fail",
    public_output: coherenceReport.result || coherenceReport.verdict || "not_checked",
    rights: rightsCheckStatus(rightsLedger),
    script: scriptScorecard.verdict || "not_checked",
    director: unresolvedDirectorBlockers.length ? directorRawStatus : "director_ready",
    benchmark: benchmark.result || "not_checked",
    visual_quality: visualQuality.result || benchmark.result || "not_checked",
    motion_clip_floor: motionFloorPass ? "pass" : "fail",
    distinct_motion_families: familyFloorPass ? "pass" : "fail",
    audio_loudness: audioSegmentReport.verdict || "not_checked",
    voice_quality: voiceQualityReport.verdict || voiceQualityReport.status || "not_checked",
    captions: captionManifest.verdict || captionManifest.status || "not_checked",
  };
  const blockers = [];
  if (checks.final_render_mp4 !== "pass") blockers.push("final_render_mp4_missing_or_not_final");
  if (failStatus(checks.public_output)) blockers.push("public_output_coherence_failed");
  if (checks.rights === "fail") blockers.push("rights_ledger_failed");
  if (failStatus(checks.script)) blockers.push("script_scorecard_failed");
  if (failStatus(checks.director)) blockers.push("director_plan_failed");
  if (failStatus(checks.benchmark)) blockers.push(...asArray(benchmark.failures), "benchmark_failed");
  if (failStatus(checks.visual_quality)) blockers.push(...asArray(visualQuality.failures), "visual_quality_failed");
  if (checks.motion_clip_floor !== "pass") blockers.push("actual_motion_clip_minimum_not_met");
  if (checks.distinct_motion_families !== "pass") blockers.push("distinct_motion_families_minimum_not_met");
  if (failStatus(checks.audio_loudness)) blockers.push("audio_loudness_failed");
  if (failStatus(checks.voice_quality)) blockers.push("voice_quality_failed");
  if (failStatus(checks.captions)) blockers.push("caption_manifest_failed");
  blockers.push(
    ...asArray(scriptScorecard.blockers),
    ...asArray(coherenceReport.failures),
    ...asArray(coherenceReport.blockers),
    ...asArray(rightsLedger.failures),
    ...unresolvedDirectorBlockers,
    ...asArray(audioSegmentReport.blockers),
    ...asArray(voiceQualityReport.blockers),
  );
  const uniqueBlockers = [...new Set(blockers.map(cleanText).filter(Boolean))];
  const result = uniqueBlockers.length ? "fail" : "pass";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: cleanText(storyId || renderManifest.story_id),
    verdict: result === "pass" ? "post_render_forensics_passed" : "blocked_or_rewrite_required",
    result,
    checks,
    blockers: uniqueBlockers,
    warnings: [
      ...asArray(benchmark.warnings),
      ...asArray(visualQuality.warnings),
      ...asArray(audioSegmentReport.warnings),
      ...asArray(voiceQualityReport.warnings),
    ].map(cleanText).filter(Boolean),
    evidence: {
      final_render_path: pathOrNull(outputPath || renderManifest.output_path || renderManifest.output),
      final_publish_render: renderManifest.final_publish_render === true,
      render_generated_at: cleanText(renderManifest.generated_at),
      rendered_duration_s: renderReport.rendered_duration_s ?? renderManifest.rendered_duration_s ?? null,
      selected_motion_clip_count: clips.length,
      selected_distinct_motion_family_count: distinctFamilies.size,
      motion_clip_count: motionEvidenceCount,
      distinct_motion_family_count: familyEvidenceCount,
      visual_evidence_profile: visualProfile,
      benchmark_scores: benchmark.scores || {},
      visual_quality_scores: visualQuality.scores || benchmark.scores || {},
    },
    repair_source: "post_render_quality_refresh",
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      renderer_invoked: false,
    },
  };
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

async function sha256File(filePath) {
  return crypto.createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalInputSnapshot(canonical = {}) {
  return {
    story_id: cleanText(canonical.story_id),
    selected_title: cleanText(canonical.selected_title || canonical.short_title),
    thumbnail_headline: cleanText(canonical.thumbnail_headline || canonical.thumbnail_text),
    first_spoken_line: cleanText(canonical.first_spoken_line || canonical.narration_hook),
    narration_script: cleanText(canonical.narration_script),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    canonical_angle: cleanText(canonical.canonical_angle),
    primary_source: cleanText(canonical.primary_source || canonical.source_card_label),
    public_copy_repaired_at: cleanText(canonical.public_copy_repaired_at),
    duration_variant_repaired_at: cleanText(canonical.duration_variant_repaired_at),
  };
}

async function buildRenderInputFingerprint({
  canonical = {},
  audioPath,
  timestampsPath,
  audioStat,
  timestampsStat,
} = {}) {
  const canonical_snapshot = canonicalInputSnapshot(canonical);
  const audio_sha256 = await sha256File(audioPath);
  const word_timestamps_sha256 = await sha256File(timestampsPath);
  const fingerprintSource = {
    canonical_snapshot,
    audio_sha256,
    word_timestamps_sha256,
    audio_size_bytes: Number(audioStat?.size || 0),
    word_timestamps_size_bytes: Number(timestampsStat?.size || 0),
  };
  return {
    algorithm: "sha256",
    signature: sha256Text(stableJson(fingerprintSource)),
    canonical_public_copy_hash: sha256Text(stableJson(canonical_snapshot)),
    audio_sha256,
    word_timestamps_sha256,
    audio_size_bytes: fingerprintSource.audio_size_bytes,
    word_timestamps_size_bytes: fingerprintSource.word_timestamps_size_bytes,
    canonical_snapshot,
  };
}

function finalRenderOutputPath(job = {}) {
  const target = targetRenderManifestFor(job);
  const artifactDir = path.resolve(job.artifact_dir || "");
  return path.resolve(target.output_path || path.join(artifactDir, "visual_v4_render.mp4"));
}

function finalRenderManifestPath(job = {}) {
  const target = targetRenderManifestFor(job);
  const artifactDir = path.resolve(job.artifact_dir || "");
  return path.resolve(target.manifest_path || path.join(artifactDir, "render_manifest.json"));
}

function premiumShellManifestFields({ job = {}, renderReport = {} } = {}) {
  const target = targetRenderManifestFor(job);
  const reportGate = objectValue(
    renderReport.hyperframes_premium_shell_gate ||
      renderReport.premium_shell_gate,
  );
  const targetGate = objectValue(
    target.hyperframes_premium_shell_gate ||
      target.premium_shell_gate,
  );
  const gate = Object.keys(reportGate).length ? reportGate : targetGate;
  const required =
    target.hyperframes_premium_shell_required === true ||
    target.require_hyperframes_premium_shell === true ||
    renderReport.hyperframes_premium_shell_required === true ||
    renderReport.require_hyperframes_premium_shell === true;
  const requiredPassCount = numberOrNull(
    target.hyperframes_premium_shell_required_pass_count ??
      target.premium_shell_required_pass_count ??
      renderReport.hyperframes_premium_shell_required_pass_count ??
      renderReport.premium_shell_required_pass_count ??
      gate.requiredPassCount ??
      gate.required_pass_count,
  );
  const passCount = numberOrNull(
    renderReport.premium_shell_pass_count ??
      renderReport.hyperframes_premium_shell_pass_count ??
      target.premium_shell_pass_count ??
      target.hyperframes_premium_shell_pass_count ??
      gate.passCount ??
      gate.pass_count,
  );
  const cardCount = numberOrNull(
    renderReport.hyperframes_card_count ??
      target.hyperframes_card_count ??
      gate.hyperframesCardCount ??
      gate.hyperframes_card_count ??
      gate.cardCount ??
      gate.card_count,
  );
  const availableCardCount = numberOrNull(
    renderReport.hyperframes_available_card_count ??
      target.hyperframes_available_card_count ??
      gate.hyperframesAvailableCardCount ??
      gate.hyperframes_available_card_count ??
      gate.passCount ??
      gate.pass_count,
  );
  const selectedCardCount = numberOrNull(
    renderReport.premium_shell_selected_card_count ??
      renderReport.hyperframes_selected_card_count ??
      target.premium_shell_selected_card_count ??
      target.hyperframes_selected_card_count ??
      gate.selectedCardCount ??
      gate.selected_card_count,
  );
  const requiredSelectedCardCount = numberOrNull(
    renderReport.premium_shell_required_selected_card_count ??
      renderReport.hyperframes_premium_shell_required_selected_card_count ??
      target.premium_shell_required_selected_card_count ??
      target.hyperframes_premium_shell_required_selected_card_count ??
      gate.requiredSelectedCardCount ??
      gate.required_selected_card_count,
  );
  const verdict = cleanText(
    renderReport.premium_shell_verdict ||
      target.premium_shell_verdict ||
      gate.verdict ||
      gate.status,
  ).toLowerCase();
  const blockers = uniqueCleanTexts([
    ...asArray(renderReport.premium_shell_blockers),
    ...asArray(target.premium_shell_blockers),
    ...asArray(gate.blockers),
  ]);
  const hasGate = Object.keys(gate).length > 0;
  if (
    !required &&
    requiredPassCount == null &&
    passCount == null &&
    cardCount == null &&
    !verdict &&
    !blockers.length &&
    !hasGate
  ) {
    return {};
  }
  return {
    hyperframes_premium_shell_required: required,
    hyperframes_premium_shell_required_pass_count: requiredPassCount,
    premium_shell_required_pass_count: requiredPassCount,
    hyperframes_card_count: cardCount,
    hyperframes_available_card_count: availableCardCount,
    premium_shell_selected_card_count: selectedCardCount,
    premium_shell_required_selected_card_count: requiredSelectedCardCount,
    hyperframes_premium_shell_required_selected_card_count: requiredSelectedCardCount,
    hyperframes_premium_shell_gate: hasGate ? gate : {},
    premium_shell_verdict: verdict || null,
    premium_shell_pass_count: passCount,
    premium_shell_blockers: blockers,
  };
}

const HYPERFRAMES_PREMIUM_SHELL_CARD_KINDS = ["source", "context", "timeline", "quote", "takeaway"];
const MIN_SOURCE_LOCK_CARD_DURATION_S = SOURCE_CARD_TIMING.minimum_visible_duration_s;
const TARGET_SOURCE_LOCK_CARD_DURATION_S = SOURCE_CARD_TIMING.planned_visible_duration_s;
const MAX_SOURCE_LOCK_CARD_DURATION_S = SOURCE_CARD_TIMING.maximum_visible_duration_s;
const MIN_OVERLAY_PROOF_CARD_DURATION_S = 2.6;
const MIN_READABLE_HYPERFRAMES_CARD_DURATION_S = 7;
const SCENE_DURATION_FRAME_TOLERANCE_S = 1 / 30;
const MAX_HYPERFRAMES_CARD_COUNT_RATIO = 0.42;
const MAX_HYPERFRAMES_CARD_DURATION_RATIO = 0.25;
const HYPERFRAMES_CARD_SELECTION_PRIORITY = ["source", "context", "timeline", "quote", "takeaway"];
const PRODUCTION_RENDER_SCENE_XFADE_S = 0.25;
const BALANCED_WINDOW_REPEAT_MAX_SHARE = 0.25;

function normaliseRenderReportPlan(renderReport = {}) {
  return objectValue(renderReport.clip_scene_plan || renderReport.clipScenePlan);
}

function renderReportRepeatedReadableCardKinds(plan = {}) {
  return [
    ...asArray(plan.repeated_readable_card_kinds),
    ...asArray(plan.repeatedReadableCardKinds),
  ];
}

function renderReportRepeatedBaseSources(plan = {}) {
  return [
    ...asArray(plan.repeated_base_sources),
    ...asArray(plan.repeatedBaseSources),
  ];
}

function renderReportConcentratedMotionSources(plan = {}) {
  return [
    ...asArray(plan.direct_motion_source_concentration_metrics?.concentrated_sources),
    ...asArray(plan.directMotionSourceConcentrationMetrics?.concentrated_sources),
  ];
}

function readableCardWindowMinimumS(window = {}) {
  const kind = cleanText(window.kind || window.card_kind || window.id).toLowerCase();
  if (/\b(?:source_lock|source)\b/.test(kind)) {
    return MIN_SOURCE_LOCK_CARD_DURATION_S;
  }
  if (/\b(?:headline|proof_primary|proof_secondary|proof_card|overlay)\b/.test(kind)) {
    return MIN_OVERLAY_PROOF_CARD_DURATION_S;
  }
  return (
    numberOrNull(
      window.minimum_readable_duration_s ??
        window.minimum_required_duration_s ??
        window.min_readable_duration_s,
    ) || MIN_READABLE_HYPERFRAMES_CARD_DURATION_S
  );
}

function hyperframesCardKind(card = {}) {
  const explicitKind = cleanText(card.kind || card.card_kind || card.readableCardKind || card.readable_card_kind)
    .toLowerCase();
  if (explicitKind) return explicitKind;
  const family = cleanText(card.source_family || card.motion_family || card.source_url || card.id).toLowerCase();
  const match = family.match(/hyperframes[_/-]([a-z0-9_-]+)[_/-]card/i);
  if (match?.[1]) return match[1].replace(/[_-]+card$/i, "");
  if (/\bsource(?:_lock)?\b/i.test(family)) return "source";
  return "";
}

function isHyperframesSourceCard(card = {}) {
  return hyperframesCardKind(card) === "source";
}

function tooFastCardWindows(windows = []) {
  return asArray(windows)
    .map((window) => ({
      ...window,
      duration_s: numberOrNull(window.duration_s ?? window.durationS ?? window.duration),
      minimum_readable_duration_s: readableCardWindowMinimumS(window),
    }))
    .filter(
      (window) =>
        window.duration_s != null &&
        window.duration_s + SCENE_DURATION_FRAME_TOLERANCE_S < window.minimum_readable_duration_s,
    );
}

function renderReportVisualCadenceBlockers({ renderReport = {}, renderStory = {} } = {}) {
  const plan = normaliseRenderReportPlan(renderReport);
  const blockers = [];
  blockers.push(...asArray(plan.blockers).map(cleanText).filter(Boolean));
  if (renderReportRepeatedBaseSources(plan).length) {
    blockers.push("direct_motion_base_source_repeated");
  }
  if (renderReportConcentratedMotionSources(plan).length) {
    blockers.push("direct_motion_source_concentration_above_premium_floor");
  }
  if (renderReportRepeatedReadableCardKinds(plan).length) {
    blockers.push("readable_card_kind_repeated");
  }
  const actualCardWindows = firstNonEmptyArray(
    renderReport.card_visible_windows,
    renderReport.rendered_card_windows,
    plan.card_visible_windows,
    plan.cardVisibleWindows,
  );
  if (tooFastCardWindows(actualCardWindows).length) {
    blockers.push("card_visible_window_below_readable_floor");
  }
  const overlayWindows = firstNonEmptyArray(
    renderReport.overlay_card_windows,
    overlayCardWindowsForStory(renderStory),
  );
  if (tooFastCardWindows(overlayWindows).length) {
    blockers.push("overlay_card_window_below_readable_floor");
  }
  return uniqueCleanTexts(blockers);
}

function existingFinalRenderReuseBlockers(renderManifest = {}) {
  const plan = normaliseRenderReportPlan(renderManifest);
  const blockers = [];
  if (!Object.keys(plan).length) {
    blockers.push("clip_scene_plan_missing");
  } else {
    if (plan.repeatFree !== true && plan.repeat_free !== true) {
      blockers.push("clip_scene_plan_not_repeat_free");
    }
    if (!asArray(plan.scenes).length) {
      blockers.push("clip_scene_plan_scenes_missing");
    }
  }
  blockers.push(...renderReportVisualCadenceBlockers({ renderReport: renderManifest }));
  return uniqueCleanTexts(blockers);
}

function assertRenderReportVisualCadenceReady({ renderReport = {}, renderStory = {} } = {}) {
  const blockers = renderReportVisualCadenceBlockers({ renderReport, renderStory });
  if (blockers.length) {
    throw new Error(`production_render_visual_cadence_blocked:${blockers.join(",")}`);
  }
}

function maxReadableHyperframesCardsForMotion(primaryClipCount = 0, shellClipCount = 0) {
  const motionCount = Math.max(0, Math.floor(Number(primaryClipCount || 0)));
  const available = Math.max(0, Math.floor(Number(shellClipCount || 0)));
  if (!motionCount || !available) return 0;
  const byRatio = Math.floor(
    (motionCount * MAX_HYPERFRAMES_CARD_COUNT_RATIO) /
      (1 - MAX_HYPERFRAMES_CARD_COUNT_RATIO),
  );
  return Math.max(0, Math.min(available, byRatio));
}

function readableHyperframesCardDurationS(card = {}) {
  if (isHyperframesSourceCard(card)) {
    return TARGET_SOURCE_LOCK_CARD_DURATION_S;
  }
  return Math.max(
    MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
    numberOrNull(card.readability?.minimum_visible_duration_s) || 0,
    numberOrNull(card.readability?.planned_visible_duration_s) || 0,
  );
}

function maxReadableHyperframesCardDurationS(card = {}) {
  if (isHyperframesSourceCard(card)) {
    return MAX_SOURCE_LOCK_CARD_DURATION_S;
  }
  return Math.max(
    readableHyperframesCardDurationS(card),
    numberOrNull(card.readability?.max_readable_card_duration_s) || 0,
    numberOrNull(card.readability?.maximum_visible_duration_s) || 0,
    numberOrNull(card.max_readable_card_duration_s) || 0,
    numberOrNull(card.maximum_visible_duration_s) || 0,
  );
}

function maxReadableHyperframesCardDurationSForAudio(audioDurationS = null) {
  const duration = numberOrNull(audioDurationS);
  if (duration == null || duration <= 0) return null;
  return Number((duration * MAX_HYPERFRAMES_CARD_DURATION_RATIO).toFixed(3));
}

function selectReadableHyperframesCardsForMotionBalance(cards = [], primaryClipCount = 0, audioDurationS = null) {
  const cleanCards = asArray(cards);
  const maxCards = maxReadableHyperframesCardsForMotion(primaryClipCount, cleanCards.length);
  if (!maxCards) return [];
  const byKind = new Map();
  for (const card of cleanCards) {
    const kind = cleanText(card.kind).toLowerCase();
    if (!kind || byKind.has(kind)) continue;
    byKind.set(kind, card);
  }
  const prioritised = [
    ...HYPERFRAMES_CARD_SELECTION_PRIORITY.map((kind) => byKind.get(kind)).filter(Boolean),
    ...cleanCards.filter((card) => !HYPERFRAMES_CARD_SELECTION_PRIORITY.includes(cleanText(card.kind).toLowerCase())),
  ];
  const maxCardDurationS = maxReadableHyperframesCardDurationSForAudio(audioDurationS);
  if (maxCardDurationS == null) return prioritised.slice(0, maxCards);
  const selected = [];
  let selectedDurationS = 0;
  for (const card of prioritised) {
    if (selected.length >= maxCards) break;
    const cardDurationS = readableHyperframesCardDurationS(card);
    if (selectedDurationS + cardDurationS > maxCardDurationS + 0.01) continue;
    selected.push(card);
    selectedDurationS += cardDurationS;
  }
  return selected;
}

function requiredSelectedHyperframesCardCount({
  passCount = 0,
  primaryClipCount = 0,
  audioDurationS = null,
} = {}) {
  const available = Math.max(0, Math.floor(Number(passCount || 0)));
  if (available < MIN_PREMIUM_HYPERFRAMES_CARDS) return MIN_PREMIUM_HYPERFRAMES_CARDS;
  const maxByMotion = maxReadableHyperframesCardsForMotion(primaryClipCount, available);
  const maxByDurationS = maxReadableHyperframesCardDurationSForAudio(audioDurationS);
  const maxByDuration =
    maxByDurationS == null
      ? MIN_PREMIUM_HYPERFRAMES_CARDS
      : Math.floor(maxByDurationS / MIN_READABLE_HYPERFRAMES_CARD_DURATION_S);
  const feasible = Math.min(
    MIN_PREMIUM_HYPERFRAMES_CARDS,
    available,
    maxByMotion || 0,
    Math.max(0, maxByDuration),
  );
  return Math.max(1, feasible);
}

function hyperframesPremiumShellEvidenceForStory({
  job = {},
  storyId,
  workspaceRoot = process.cwd(),
  channelId = "pulse-gaming",
  primaryClipCount = 0,
  audioDurationS = null,
} = {}) {
  const assets = resolveCardAssetsV2(workspaceRoot, storyId, channelId);
  const hasStorySpecificAssets = Object.values(assets).some((descriptor) => descriptor?.path);
  if (!targetRequiresHyperframesPremiumShell(job) && !hasStorySpecificAssets) return null;
  const checks = {};
  const passingCards = [];
  for (const kind of HYPERFRAMES_PREMIUM_SHELL_CARD_KINDS) {
    const descriptor = assets[kind] || {};
    const result = evaluateHyperframesPremiumShellEvidence({
      cardPath: descriptor.path,
      kind,
      storyId,
      channelId,
    });
    checks[kind] = result;
    if (result.verdict === "pass" && descriptor.path) {
      const readability = readableDurationEvidenceFromShell(
        result.evidence?.readabilityContract || {},
      );
      passingCards.push({
        kind,
        path: descriptor.path,
        source: descriptor.source || "story-specific",
        readability,
      });
    }
  }
  const blockers = Object.entries(checks).flatMap(([kind, result]) =>
    asArray(result?.blockers).map((blocker) => `${kind}:${blocker}`),
  );
  const passCount = passingCards.length;
  const selectedCards = selectReadableHyperframesCardsForMotionBalance(passingCards, primaryClipCount, audioDurationS);
  const selectedCount = selectedCards.length;
  const selectedCardDurationS = Number(
    selectedCards.reduce((total, card) => total + readableHyperframesCardDurationS(card), 0).toFixed(3),
  );
  const maxCardDurationS = maxReadableHyperframesCardDurationSForAudio(audioDurationS);
  const requiredSelectedCount = requiredSelectedHyperframesCardCount({
    passCount,
    primaryClipCount,
    audioDurationS,
  });
  const selectedCardBlockers =
    selectedCount >= requiredSelectedCount
      ? []
      : [`selected_hyperframes_card_count_below_required:${selectedCount}/${requiredSelectedCount}`];
  const availableCardBlockers =
    passCount >= MIN_PREMIUM_HYPERFRAMES_CARDS
      ? []
      : [`available_hyperframes_card_count_below_required:${passCount}/${MIN_PREMIUM_HYPERFRAMES_CARDS}`];
  const allBlockers = uniqueCleanTexts([...blockers, ...availableCardBlockers, ...selectedCardBlockers]);
  const gateVerdict =
    passCount >= MIN_PREMIUM_HYPERFRAMES_CARDS &&
    selectedCount >= requiredSelectedCount &&
    allBlockers.length === 0
      ? "pass"
      : passCount >= 2
        ? "partial"
        : "thin";
  return {
    hyperframes_premium_shell_required: true,
    hyperframes_available_card_count: passCount,
    hyperframes_card_count: selectedCount,
    premium_shell_verdict: gateVerdict,
    premium_shell_pass_count: passCount,
    premium_shell_selected_card_count: selectedCount,
    premium_shell_required_pass_count: MIN_PREMIUM_HYPERFRAMES_CARDS,
    premium_shell_required_selected_card_count: requiredSelectedCount,
    hyperframes_premium_shell_required_selected_card_count: requiredSelectedCount,
    premium_shell_blockers: allBlockers,
    hyperframes_premium_shell_gate: {
      verdict: gateVerdict,
      requiredPassCount: MIN_PREMIUM_HYPERFRAMES_CARDS,
      requiredSelectedCardCount: requiredSelectedCount,
      passCount,
      selectedCardCount: selectedCount,
      selectedCardDurationS,
      maxReadableCardDurationS: maxCardDurationS,
      maxReadableCardDurationRatio: MAX_HYPERFRAMES_CARD_DURATION_RATIO,
      blockers: allBlockers,
      checks,
    },
    card_clips: selectedCards.map((card, index) => {
      const minimumReadable = numberOrNull(card.readability?.minimum_visible_duration_s);
      const plannedReadable = numberOrNull(card.readability?.planned_visible_duration_s);
      const maxReadable = numberOrNull(card.readability?.max_readable_card_duration_s);
      const isSourceCard = isHyperframesSourceCard(card);
      const durationS = isSourceCard
        ? TARGET_SOURCE_LOCK_CARD_DURATION_S
        : Math.max(
            MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
            minimumReadable || 0,
            plannedReadable || 0,
          );
      const readableMinimumS = isSourceCard
        ? MIN_SOURCE_LOCK_CARD_DURATION_S
        : minimumReadable || MIN_READABLE_HYPERFRAMES_CARD_DURATION_S;
      const readableMaxS = isSourceCard
        ? MAX_SOURCE_LOCK_CARD_DURATION_S
        : maxReadable || durationS;
      return {
        id: `hyperframes_premium_shell_${card.kind}_${index + 1}`,
        path: card.path,
        source_url: `local://hyperframes/${storyId}/${card.kind}`,
        source_type: "hyperframes_premium_shell_card",
        source_family: `hyperframes_${card.kind}_card`,
        media_kind: "owned_editorial_motion_graphic",
        text: card.readability?.readable_text || "",
        readable_text: card.readability?.readable_text || "",
        minimum_readable_duration_s: readableMinimumS,
        max_readable_card_duration_s: readableMaxS,
        maximum_visible_duration_s: readableMaxS,
        durationS,
        duration_s: durationS,
        duration: durationS,
        source_url_kind: "owned_generated_motion",
        rights_basis: "owned_transformative_editorial_graphic",
        licence_basis: "owned_transformative_editorial_graphic",
        counts_towards_motion_readiness: true,
        validated: true,
      };
    }),
  };
}

function blendPremiumShellClips(primaryClips = [], shellClips = []) {
  if (!shellClips.length) return primaryClips;
  const out = [];
  const directLeadCount = Math.min(4, primaryClips.length);
  out.push(...primaryClips.slice(0, directLeadCount));
  const max = Math.max(primaryClips.length - directLeadCount, shellClips.length);
  for (let i = 0; i < max; i += 1) {
    if (shellClips[i]) out.push(shellClips[i]);
    if (primaryClips[directLeadCount + i]) out.push(primaryClips[directLeadCount + i]);
  }
  return out;
}

function clipCoverageDurationS(clips = []) {
  const durations = asArray(clips).map((clip) => clipDurationSeconds(clip, 0)).filter((duration) => duration > 0);
  if (!durations.length) return 0;
  const total = durations.reduce((sum, duration) => sum + duration, 0);
  return Number((total - PRODUCTION_RENDER_SCENE_XFADE_S * Math.max(0, durations.length - 1)).toFixed(3));
}

function stretchReadableShellClipsForAudioCoverage({
  primaryClips = [],
  shellClips = [],
  audioDurationS = null,
} = {}) {
  const audioDuration = numberOrNull(audioDurationS);
  const shell = asArray(shellClips).map((clip) => ({ ...clip }));
  if (audioDuration == null || audioDuration <= 0 || !shell.length) return shell;
  const targetCoverageS = Number((audioDuration - 0.12).toFixed(3));
  let currentCoverageS = clipCoverageDurationS([...asArray(primaryClips), ...shell]);
  if (currentCoverageS >= targetCoverageS) return shell;

  const maxShellBudgetS = maxReadableHyperframesCardDurationSForAudio(audioDuration);
  let usedShellDurationS = shell.reduce((sum, clip) => sum + clipDurationSeconds(clip, 0), 0);
  for (const clip of shell) {
    const currentDurationS = clipDurationSeconds(clip, MIN_READABLE_HYPERFRAMES_CARD_DURATION_S);
    const maxDurationS = Math.min(
      maxReadableHyperframesCardDurationS(clip),
      maxShellBudgetS == null
        ? maxReadableHyperframesCardDurationS(clip)
        : currentDurationS + Math.max(0, maxShellBudgetS - usedShellDurationS),
    );
    const availableExtensionS = Number((maxDurationS - currentDurationS).toFixed(3));
    if (availableExtensionS <= 0) continue;
    const neededS = Number((targetCoverageS - currentCoverageS).toFixed(3));
    if (neededS <= 0) break;
    const extensionS = Number(Math.min(availableExtensionS, neededS + 0.02).toFixed(3));
    const nextDurationS = Number((currentDurationS + extensionS).toFixed(3));
    clip.durationS = nextDurationS;
    clip.duration_s = nextDurationS;
    clip.duration = nextDurationS;
    clip.readable_card_duration_extension_s = extensionS;
    usedShellDurationS = Number((usedShellDurationS + extensionS).toFixed(3));
    currentCoverageS = clipCoverageDurationS([...asArray(primaryClips), ...shell]);
    if (currentCoverageS >= targetCoverageS) break;
  }
  return shell;
}

function hasWindowedDirectMotionFamily(clip = {}) {
  if (!isRealMaterialisedClip(clip)) return false;
  const value = cleanText(clip.source_family || clip.motion_family || clip.base_source_family || clip.source_url);
  return /(?:^|[_/-])window[_/-]?\d+/i.test(value);
}

function balancedWindowRepeatShareReady(clips = []) {
  const directClips = asArray(clips).filter(isRealMaterialisedClip);
  if (!directClips.length) return true;
  const counts = new Map();
  for (const clip of directClips) {
    if (!hasWindowedDirectMotionFamily(clip)) continue;
    const key = strictDirectMotionBaseSourceKey(clip);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const repeatedCounts = [...counts.values()].filter((count) => count > 1);
  if (!repeatedCounts.length) return true;
  return repeatedCounts.every((count) => count / directClips.length <= BALANCED_WINDOW_REPEAT_MAX_SHARE + 0.001);
}

function topUpPrimaryClipsForAudioCoverage({
  primaryClips = [],
  fallbackClips = [],
  shellClips = [],
  audioDurationS = null,
} = {}) {
  const audioDuration = numberOrNull(audioDurationS);
  if (audioDuration == null || audioDuration <= 0) return primaryClips;
  const selected = [...asArray(primaryClips)];
  const shell = asArray(shellClips);
  if (clipCoverageDurationS([...selected, ...shell]) + 0.12 >= audioDuration) return selected;

  const seen = new Set(selected.map((clip) => normalisePathKey(clipPathValue(clip))).filter(Boolean));
  const candidates = asArray(fallbackClips)
    .filter(isRealMaterialisedClip)
    .filter((clip) => {
      const key = normalisePathKey(clipPathValue(clip));
      return key && !seen.has(key);
    });

  for (const clip of candidates) {
    const key = normalisePathKey(clipPathValue(clip));
    if (!key || seen.has(key)) continue;
    selected.push(clip);
    seen.add(key);
    if (
      clipCoverageDurationS([...selected, ...shell]) + 0.12 >= audioDuration &&
      balancedWindowRepeatShareReady(selected)
    ) {
      break;
    }
  }
  return selected;
}

async function hasExistingFinalRender(job = {}, inputState = {}) {
  const outputPath = finalRenderOutputPath(job);
  const manifestPath = finalRenderManifestPath(job);
  if (!(await fs.pathExists(outputPath)) || !(await fs.pathExists(manifestPath))) return false;
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size < 1024) return false;
  const manifest = await readJsonIfPresent(manifestPath, {});
  const isFinalRender =
    manifest.final_publish_render === true &&
    cleanText(manifest.renderer) === "visual_v4_production" &&
    cleanText(manifest.visual_tier) === "production_v4_motion";
  if (!isFinalRender) return false;
  if (!manifest.input_fingerprint?.signature) return false;
  if (manifest.input_fingerprint.signature !== inputState.inputFingerprint?.signature) return false;
  if (policyVersionBlockers(manifest).length) return false;
  if (existingFinalRenderReuseBlockers(manifest).length) return false;

  const freshnessFloorMs = Math.max(
    Number.isFinite(inputState.repairedAtMs) ? inputState.repairedAtMs : 0,
    Number(inputState.audioStat?.mtimeMs || 0),
    Number(inputState.timestampsStat?.mtimeMs || 0),
  );
  if (freshnessFloorMs > 0 && stat.mtimeMs + 1000 < freshnessFloorMs) return false;
  return true;
}

function resolveWorkspacePath(filePath, workspaceRoot = process.cwd()) {
  const text = cleanText(filePath);
  if (!text) return null;
  if (path.isAbsolute(text)) return text;
  const mediaResolved = mediaPaths.resolveExistingSync(text);
  if (mediaResolved && fs.existsSync(mediaResolved)) return mediaResolved;
  return path.resolve(workspaceRoot, text);
}

async function statUsableFile(filePath, minBytes = 1) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size < minBytes) return null;
  return stat;
}

async function validateRenderInputs(job = {}, { workspaceRoot = process.cwd() } = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath, {});
  const audioPath = resolveWorkspacePath(job.evidence?.narration_audio_path, workspaceRoot);
  const timestampsPath = resolveWorkspacePath(job.evidence?.word_timestamps_path, workspaceRoot);
  const audioStat = await statUsableFile(audioPath, 1024);
  const timestampsStat = await statUsableFile(timestampsPath, 16);
  const missing = [];
  if (!audioStat) missing.push("narration_audio_path");
  if (!timestampsStat) missing.push("word_timestamps_path");
  if (missing.length) throw new Error(`render_input_missing:${missing.join(",")}`);

  const publicCopyQa = evaluateGoalPublicCopy(canonical);
  if (publicCopyQa.verdict !== "pass") {
    throw new Error(`render_input_public_copy_failed:${asArray(publicCopyQa.failures).join(",")}`);
  }

  const repairEvents = [
    {
      at: Date.parse(canonical.public_copy_repaired_at || ""),
      reason: "render_input_stale_after_public_copy_repair",
    },
    {
      at: Date.parse(canonical.duration_variant_repaired_at || ""),
      reason: "render_input_stale_after_duration_variant_repair",
    },
  ].filter((event) => Number.isFinite(event.at)).sort((a, b) => b.at - a.at);
  const latestRepairEvent = repairEvents[0] || null;
  if (latestRepairEvent) {
    const stale = [];
    if (audioStat.mtimeMs + 1000 < latestRepairEvent.at) stale.push("narration_audio_path");
    if (timestampsStat.mtimeMs + 1000 < latestRepairEvent.at) stale.push("word_timestamps_path");
    if (stale.length) {
      throw new Error(`${latestRepairEvent.reason}:${stale.join(",")}`);
    }
  }

  return {
    artifactDir,
    canonicalPath,
    canonical,
    audioPath,
    timestampsPath,
    audioStat,
    timestampsStat,
    repairedAtMs: latestRepairEvent?.at ?? null,
    inputFingerprint: await buildRenderInputFingerprint({
      canonical,
      audioPath,
      timestampsPath,
      audioStat,
      timestampsStat,
    }),
  };
}

async function stampPublicCopyRenderRegenerated({
  job = {},
  inputState = {},
  completedAt,
  status = "rendered",
} = {}) {
  const repairedAt = cleanText(inputState.canonical?.public_copy_repaired_at);
  const canonicalPath = inputState.canonicalPath ||
    path.join(path.resolve(job.artifact_dir || ""), "canonical_story_manifest.json");
  if (!(await fs.pathExists(canonicalPath))) return null;
  const current = await readJsonIfPresent(canonicalPath, null);
  if (!current || typeof current !== "object") return null;
  const completed = cleanText(completedAt) || new Date().toISOString();
  const completedMs = Date.parse(completed);
  const durationVariantRepairedAt = cleanText(current.duration_variant_repaired_at);
  const durationVariantRepairMs = Date.parse(durationVariantRepairedAt || "");
  const shouldStampPublicCopy = Boolean(repairedAt);
  const shouldStampDurationVariant =
    Number.isFinite(completedMs) &&
    Number.isFinite(durationVariantRepairMs) &&
    completedMs + 1000 >= durationVariantRepairMs;
  if (!shouldStampPublicCopy && !shouldStampDurationVariant) return null;
  const updated = {
    ...current,
    ...(shouldStampPublicCopy
      ? {
          public_copy_final_render_regenerated_at: completed,
          public_copy_regeneration_completed_at: completed,
          public_copy_regeneration_status: status,
          public_copy_regenerated_render_path: finalRenderOutputPath(job),
          public_copy_regenerated_render_manifest_path: finalRenderManifestPath(job),
        }
      : {}),
    ...(shouldStampDurationVariant
      ? {
          duration_variant_status: "repaired_rendered",
          duration_variant_final_render_regenerated_at: completed,
          duration_variant_regeneration_completed_at: completed,
          duration_variant_regeneration_status: status,
          duration_variant_regenerated_render_path: finalRenderOutputPath(job),
          duration_variant_regenerated_render_manifest_path: finalRenderManifestPath(job),
        }
      : {}),
  };
  await fs.writeJson(canonicalPath, updated, { spaces: 2 });
  return {
    canonicalPath,
    ...(shouldStampPublicCopy
      ? { public_copy_regeneration_completed_at: completed }
      : {}),
    ...(shouldStampDurationVariant
      ? { duration_variant_regeneration_completed_at: completed }
      : {}),
  };
}

async function buildRendererStoryJson(job = {}, { generatedAt, workspaceRoot = process.cwd() } = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const [
    canonical,
    director,
    materialisedMotion,
    footageInventory,
    rightsLedger,
    sfxManifest,
    audioManifest,
    voiceQualityReport,
    renderManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "voice_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
  ]);
  const proofCard = productionProofCard({ director, canonical });
  const storyId = cleanText(job.story_id || canonical.story_id);
  const wordTimestampSource = cleanText(
    job.evidence?.word_timestamp_source ||
      job.evidence?.wordTimestampSource ||
      canonical.word_timestamp_source ||
      canonical.wordTimestampSource,
  );
  const inventoryClips = productionClipObjects({ materialisedMotion, footageInventory, rightsLedger, job });
  const renderedSceneClips = renderedScenePlanClipObjects({
    renderManifest,
    fallbackClips: inventoryClips,
  });
  const materialisedRealClipCount = materialisedMotionClips(materialisedMotion).filter(isRealMaterialisedClip).length;
  const inventoryRealClipCount = inventoryClips.filter(isRealMaterialisedClip).length;
  const renderedSceneRealClipCount = renderedSceneClips.filter(isRealMaterialisedClip).length;
  const preferredClips =
    materialisedRealClipCount === 0 &&
    renderedSceneRealClipCount > inventoryRealClipCount
      ? renderedSceneClips
      : inventoryClips;
  const premiumShellPrimaryClips = preferredClips.filter((clip) => !isReadableApprovedOwnedExplainerClip(clip));
  const narrationAudioPath = pathOrNull(
    job.evidence?.narration_audio_path ||
      audioManifest.narration_audio_path ||
      audioManifest.audio_path,
  );
  const audioDurationS = resolveNarrationDurationS({
    voiceQualityReport,
    audioManifest,
    jobEvidence: job.evidence,
    narrationAudioPath,
  });
  const premiumShell = hyperframesPremiumShellEvidenceForStory({
    job,
    storyId,
    workspaceRoot,
    channelId: cleanText(canonical.channel_id || canonical.channel || "pulse-gaming") || "pulse-gaming",
    primaryClipCount: premiumShellPrimaryClips.length || preferredClips.length,
    audioDurationS,
  });
  const rawMaterialisedRealClips = materialisedMotionClips(materialisedMotion).filter(isRealMaterialisedClip);
  const coverageFallbackClips = filterSteamAppOutlierClips(dedupeClipObjects([
    ...preferredClips,
    ...rawMaterialisedRealClips,
    ...rightsLedgerMotionClips(rightsLedger),
    ...footageMotionClips(footageInventory),
  ]));
  const primaryClipsForRender = asArray(premiumShell?.card_clips).length
    ? (premiumShellPrimaryClips.length ? premiumShellPrimaryClips : preferredClips)
    : preferredClips;
  const skipReadableShellCardsForAudioBudget = shouldSkipReadableShellCardsForAudioBudget({
    audioDurationS,
    primaryClips: primaryClipsForRender,
    fallbackClips: rawMaterialisedRealClips,
    wordTimestampSource,
  });
  const shellClipsForRender = skipReadableShellCardsForAudioBudget
    ? []
    : stretchReadableShellClipsForAudioCoverage({
        primaryClips: primaryClipsForRender,
        shellClips: premiumShell?.card_clips || [],
        audioDurationS,
      });
  const selectedShellCardDurationS = Number(
    shellClipsForRender.reduce((sum, clip) => sum + clipDurationSeconds(clip, 0), 0).toFixed(3),
  );
  const selectedShellCardDurationExtensionS = Number(
    shellClipsForRender
      .reduce((sum, clip) => sum + Number(clip.readable_card_duration_extension_s || 0), 0)
      .toFixed(3),
  );
  const premiumShellGate = premiumShell
    ? {
        ...(premiumShell.hyperframes_premium_shell_gate || {}),
        selectedCardDurationS: selectedShellCardDurationS,
        readableCardDurationExtensionS: selectedShellCardDurationExtensionS,
      }
    : null;
  const coverageReadyPrimaryClips = skipReadableShellCardsForAudioBudget
    ? filterSteamAppOutlierClips(
        rawMaterialisedRealClips.length >= primaryClipsForRender.length
          ? rawMaterialisedRealClips
          : primaryClipsForRender,
      )
    : filterSteamAppOutlierClips(
        topUpPrimaryClipsForAudioCoverage({
          primaryClips: primaryClipsForRender,
          fallbackClips: coverageFallbackClips,
          shellClips: shellClipsForRender,
          audioDurationS,
        }),
      );
  const preferredDirectorClips = blendPremiumShellClips(
    coverageReadyPrimaryClips.map(directorClipFromProductionClip),
    shellClipsForRender,
  );
  const preferredClipPaths = preferredDirectorClips.map(clipPathValue).filter(Boolean);
  const sfxAssets = asArray(
    sfxManifest.source_plan?.selected_assets ||
      sfxManifest.selected_assets ||
      sfxManifest.assets ||
      canonical.sfx_asset_inventory,
  );
  const selectedFootagePlan = footagePlanForDirector({
    footageInventory: {
      ...footageInventory,
      motion_inventory: {
        ...(footageInventory.motion_inventory || {}),
        accepted_local_clips: [],
        production_motion_clips: [],
        distinct_source_families: [],
        trusted_local_source_families: [],
      },
    },
    clips: preferredDirectorClips,
  });
  const selectedDirectorPlan = buildVisualV4DirectorPlan({
    story: {
      ...canonical,
      id: storyId,
      story_id: storyId,
      title: cleanText(canonical.selected_title || canonical.short_title || job.title),
      visual_v4_bridge_video_clips: preferredDirectorClips,
      video_clips: preferredDirectorClips,
      sfx_asset_inventory: sfxAssets,
    },
    footagePlan: selectedFootagePlan,
    localTimeline: {
      duration_s: audioDurationS || clipCoverageDurationS(preferredDirectorClips),
    },
    sfxAssetInventory: sfxAssets,
    generatedAt,
  });
  const story = {
    id: storyId,
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game || job.title),
    canonical_angle: cleanText(canonical.canonical_angle || ""),
    primary_source: cleanText(canonical.primary_source || canonical.source_card_label || ""),
    first_frame_text: productionCoverText(canonical),
    mobile_hook_text: cleanText(canonical.first_spoken_line || canonical.narration_hook || ""),
    thumbnail_headline: productionCoverText(canonical),
    primary_claim: cleanText(asArray(canonical.confirmed_claims)[0] || canonical.narration_hook || ""),
    player_impact: cleanText(canonical.first_spoken_line || ""),
    commercial_safe_cta: cleanText(canonical.platform_ctas?.youtube || ""),
    narration_script: cleanText(canonical.narration_script || ""),
    full_script: cleanText(canonical.narration_script || ""),
    tts_script: safeTtsScriptForCanonical(canonical),
    audio_path: narrationAudioPath,
    timestamps_path: pathOrNull(job.evidence?.word_timestamps_path),
    word_timestamp_source: wordTimestampSource || null,
    word_timestamp_alignment_required:
      wordTimestampSource === "local_whisper_word_alignment"
        ? "local_whisper_word_alignment"
        : null,
    video_clips: preferredClipPaths,
    visual_v4_bridge_video_clips: preferredDirectorClips.map(rendererBridgeClipFromProductionClip),
    sfx_asset_inventory: sfxAssets,
    sound_transition_plan: selectedDirectorPlan.sound_transition_plan || null,
    visual_v4_director_plan: selectedDirectorPlan,
    generated_at: generatedAt,
    ...(premiumShell
      ? {
          hyperframes_premium_shell_required: premiumShell.hyperframes_premium_shell_required,
          hyperframes_card_count: premiumShell.hyperframes_card_count,
          hyperframes_available_card_count: premiumShell.hyperframes_available_card_count,
          hyperframes_premium_shell_gate: premiumShellGate,
          premium_shell_verdict: premiumShell.premium_shell_verdict,
          premium_shell_pass_count: premiumShell.premium_shell_pass_count,
          premium_shell_selected_card_count: premiumShell.premium_shell_selected_card_count,
          premium_shell_required_pass_count: premiumShell.premium_shell_required_pass_count,
          premium_shell_required_selected_card_count: premiumShell.premium_shell_required_selected_card_count,
          hyperframes_premium_shell_required_selected_card_count:
            premiumShell.hyperframes_premium_shell_required_selected_card_count,
          premium_shell_blockers: premiumShell.premium_shell_blockers,
          premiumLane: {
            rendererSplit: "ffmpeg-backbone-story-specific-hyperframes-cards",
            hyperframesCardCount: premiumShell.hyperframes_card_count,
            hyperframesAvailableCardCount: premiumShell.hyperframes_available_card_count,
            premiumShellPassCount: premiumShell.premium_shell_pass_count,
            premiumShellSelectedCardCount: premiumShell.premium_shell_selected_card_count,
            premiumShellRequiredSelectedCardCount:
              premiumShell.premium_shell_required_selected_card_count,
            hyperframesPremiumShellGate: premiumShell.hyperframes_premium_shell_gate,
            verdict: premiumShell.premium_shell_verdict,
          },
        }
      : {}),
    render_invocation_mode: "final_production_render",
    render_safe_text_margins: jobNeedsSafeTextMargins(job),
    suppress_opening_story_cards: jobNeedsStrongerFirstFrame(job),
    visual_repair_lane: cleanText(job.repair_lane),
    visual_repair_blocker_types: uniqueCleanTexts(job.blocker_types || job.blockers || job.risk_reasons),
    ...proofCard,
  };
  const storyJsonPath = path.join(artifactDir, "visual_v4_render_story.json");
  await fs.writeJson(storyJsonPath, story, { spaces: 2 });
  return { storyJsonPath, story };
}

async function refreshPostRenderQualityArtifacts({
  job = {},
  renderReport = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const [
    canonical,
    footageInventory,
    rightsLedger,
    materialisedMotion,
    sfxManifest,
    renderManifest,
    scriptScorecard,
    platformManifest,
    audioSegmentReport,
    voiceQualityReport,
    captionManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "voice_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), {}),
  ]);
  const inventoryClips = productionClipObjects({ footageInventory, rightsLedger, job, materialisedMotion });
  const normalisedRightsLedger = normaliseRightsLedgerForRender(rightsLedger);
  if (JSON.stringify(normalisedRightsLedger) !== JSON.stringify(rightsLedger)) {
    await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), {
      ...(normalisedRightsLedger || {}),
      rights_ledger_normalised_at: generatedAt,
      rights_ledger_normalisation_strategy: "fill_source_documented_storefront_visual_licence_basis",
    }, { spaces: 2 });
  }
  const renderedSceneClips = renderedScenePlanClipObjects({
    renderReport,
    renderManifest,
    fallbackClips: inventoryClips,
  });
  const clips = renderedSceneClips.length >= 3 ? renderedSceneClips : inventoryClips;
  if (clips.length < 3) return null;
  const directorClips = clips.map(directorClipFromProductionClip);
  const footagePlan = footagePlanForDirector({ footageInventory, clips: directorClips });

  const storyId = cleanText(job.story_id || canonical.story_id);
  const sfxAssets = asArray(
    sfxManifest.source_plan?.selected_assets ||
      sfxManifest.selected_assets ||
      sfxManifest.assets ||
      canonical.sfx_asset_inventory,
  );
  const story = {
    ...canonical,
    id: storyId,
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    suggested_title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    public_title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game || job.title),
    hook: cleanText(canonical.first_spoken_line || canonical.narration_hook || canonical.narration_script),
    full_script: cleanText(canonical.narration_script || canonical.full_script),
    tts_script: safeTtsScriptForCanonical(canonical),
    suggested_thumbnail_text: productionCoverText(canonical),
    thumbnail_text: productionCoverText(canonical),
    thumbnail_headline: productionCoverText(canonical),
    first_frame_text: productionCoverText(canonical),
    source_card_label: cleanText(canonical.source_card_label || canonical.primary_source),
    video_clips: directorClips,
    visual_v4_bridge_video_clips: directorClips,
    rights_ledger: recordsFromRightsLedger(normalisedRightsLedger),
    footage_plan: footagePlan,
    sfx_asset_inventory: sfxAssets,
    clean_manual_captions: true,
    manual_caption_generated: true,
    subtitle_timing_source: "timestamps",
  };
  const publicCopyQa = evaluateGoalPublicCopy({
    ...story,
    platform_publish_manifest: platformManifest,
  });
  const refreshedCoherenceReport = {
    ...publicCopyQa,
    result: publicCopyQa.verdict,
    generated_at: generatedAt,
    story_id: storyId,
    manifest: story,
    repair_source: "post_render_quality_refresh",
  };
  const directorPlan = buildVisualV4DirectorPlan({
    story,
    footagePlan,
    localTimeline: {
      duration_s: renderReport.rendered_duration_s,
      durationS: renderReport.rendered_duration_s,
    },
    sfxAssetInventory: sfxAssets,
    sfxRightsLedger: recordsFromRightsLedger(normalisedRightsLedger),
    generatedAt,
  });
  const benchmark = runMediaHouseBenchmark({
    story,
    directorPlan,
    rightsLedger: normalisedRightsLedger,
    footageInventory: footagePlan,
    requireGate: true,
  });
  const visualQuality = {
    ...benchmark,
    report_type: "post_render_visual_quality_report",
    benchmark_source: "actual_materialised_motion_clips",
  };
  const forensicQa = buildPostRenderForensicQaReport({
    storyId,
    generatedAt,
    renderManifest,
    renderReport,
    outputPath: renderManifest.output_path || path.join(artifactDir, renderManifest.output || "visual_v4_render.mp4"),
    scriptScorecard,
    coherenceReport: refreshedCoherenceReport,
    rightsLedger,
    directorPlan,
    benchmark,
    visualQuality,
    clips,
    audioSegmentReport,
    voiceQualityReport,
    captionManifest,
  });

  await fs.writeJson(path.join(artifactDir, "director_beat_map.json"), directorPlan, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "benchmark_report.json"), benchmark, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "visual_quality_report.json"), visualQuality, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), refreshedCoherenceReport, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "forensic_qa_report.json"), forensicQa, { spaces: 2 });
  const renderStory = await readJsonIfPresent(path.join(artifactDir, "visual_v4_render_story.json"), {});
  const overlayCardWindows = firstNonEmptyArray(
    renderReport.overlay_card_windows,
    renderManifest.overlay_card_windows,
    overlayCardWindowsForStory(renderStory),
  );
  const cardVisibleWindows = firstNonEmptyArray(
    renderReport.card_visible_windows,
    renderReport.rendered_card_windows,
    renderReport.clip_scene_plan?.card_visible_windows,
    renderReport.clip_scene_plan?.cardVisibleWindows,
    renderManifest.card_visible_windows,
    overlayCardWindows,
  );
  await fs.writeJson(
    path.join(artifactDir, "render_manifest.json"),
    {
      ...renderManifest,
      quality_gate_status:
        forensicQa.result === "pass"
          ? "post_render_forensics_passed"
          : "post_render_forensics_failed",
      post_render_quality_refreshed_at: generatedAt,
      post_render_forensic_result: forensicQa.result,
      post_render_forensic_blockers: forensicQa.blockers,
      clip_scene_plan: renderReport.clip_scene_plan || renderManifest.clip_scene_plan || null,
      overlay_card_windows: overlayCardWindows,
      card_visible_windows: cardVisibleWindows,
    },
    { spaces: 2 },
  );
  return {
    benchmark_result: benchmark.result,
    benchmark_scores: benchmark.scores,
    forensic_result: forensicQa.result,
    forensic_blockers: forensicQa.blockers,
    clip_count: clips.length,
    director_motion_shot_count: asArray(directorPlan.shot_plan).filter((shot) => cleanText(shot.kind) === "motion_clip").length,
  };
}

async function refreshFinalRenderQualityOnly({
  artifactDir,
  storyId = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedArtifactDir = path.resolve(artifactDir || "");
  const renderManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "render_manifest.json"), {});
  const renderStory = await readJsonIfPresent(path.join(resolvedArtifactDir, "visual_v4_render_story.json"), {});
  const overlayCardWindows = asArray(renderManifest.overlay_card_windows).length
    ? asArray(renderManifest.overlay_card_windows)
    : overlayCardWindowsForStory(renderStory);
  const cardVisibleWindows = firstNonEmptyArray(renderManifest.card_visible_windows, overlayCardWindows);
  const outputPath = resolveWorkspacePath(
    renderManifest.output_path || path.join(resolvedArtifactDir, renderManifest.output || "visual_v4_render.mp4"),
  );
  if (renderManifest.final_publish_render !== true) {
    return {
      story_id: cleanText(storyId || renderManifest.story_id),
      status: "blocked",
      blocker: "render_not_final_publish_ready",
      artifact_dir: resolvedArtifactDir,
    };
  }
  const outputStat = await statUsableFile(outputPath, 1024);
  if (!outputStat) {
    return {
      story_id: cleanText(storyId || renderManifest.story_id),
      status: "blocked",
      blocker: "final_render_mp4_missing",
      artifact_dir: resolvedArtifactDir,
      output_path: outputPath,
    };
  }
  const refresh = await refreshPostRenderQualityArtifacts({
    job: {
      story_id: cleanText(storyId || renderManifest.story_id),
      artifact_dir: resolvedArtifactDir,
    },
    renderReport: {
      rendered_duration_s: renderManifest.rendered_duration_s,
      duration_s: renderManifest.rendered_duration_s,
      clips: renderManifest.clips,
      clip_scene_plan: renderManifest.clip_scene_plan || renderManifest.clipScenePlan || null,
      overlay_card_windows: overlayCardWindows,
      card_visible_windows: cardVisibleWindows,
    },
    generatedAt,
  });
  const canonicalPath = path.join(resolvedArtifactDir, "canonical_story_manifest.json");
  const canonical = await readJsonIfPresent(canonicalPath, {});
  const completedAt =
    cleanText(renderManifest.generated_at) ||
    (Number.isFinite(Number(outputStat.mtimeMs))
      ? new Date(Number(outputStat.mtimeMs)).toISOString()
      : generatedAt);
  const lineageStamp = await stampPublicCopyRenderRegenerated({
    job: {
      story_id: cleanText(storyId || renderManifest.story_id),
      artifact_dir: resolvedArtifactDir,
    },
    inputState: {
      canonicalPath,
      canonical,
    },
    completedAt,
    status: "quality_refreshed",
  });
  return {
    story_id: cleanText(storyId || renderManifest.story_id),
    status: "quality_refreshed",
    artifact_dir: resolvedArtifactDir,
    output_path: outputPath,
    benchmark_result: refresh.benchmark_result,
    benchmark_scores: refresh.benchmark_scores,
    forensic_result: refresh.forensic_result,
    forensic_blockers: refresh.forensic_blockers,
    clip_count: refresh.clip_count,
    director_motion_shot_count: refresh.director_motion_shot_count,
    canonical_lineage_stamp: lineageStamp,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      renderer_invoked: false,
    },
  };
}

async function writeFinalRenderManifest({
  job = {},
  renderReport = {},
  inputState = {},
  generatedAt,
} = {}) {
  const manifestPath = finalRenderManifestPath(job);
  const outputPath = finalRenderOutputPath(job);
  const stat = await fs.stat(outputPath);
  const renderStory = await readJsonIfPresent(path.join(path.resolve(job.artifact_dir || ""), "visual_v4_render_story.json"), {});
  const overlayCardWindows = firstNonEmptyArray(
    renderReport.overlay_card_windows,
    overlayCardWindowsForStory(renderStory),
  );
  const cardVisibleWindows = firstNonEmptyArray(
    renderReport.card_visible_windows,
    renderReport.rendered_card_windows,
    renderReport.clip_scene_plan?.card_visible_windows,
    renderReport.clip_scene_plan?.cardVisibleWindows,
    overlayCardWindows,
  );
  const manifest = {
    schema_version: 1,
    story_id: cleanText(job.story_id),
    renderer: "visual_v4_production",
    visual_tier: "production_v4_motion",
    final_publish_render: true,
    output: "visual_v4_render.mp4",
    output_path: outputPath,
    generated_at: generatedAt,
    render_basis: "fresh visual v4 production render generated from final render inputs",
    render_invocation_mode: "final_production_render",
    engine: "studio_v4_creator_studio_renderer",
    source_renderer_engine: "studio_v4_render_engine",
    file_size_bytes: stat.size,
    rendered_duration_s: renderReport.rendered_duration_s ?? null,
    clips: renderReport.clips ?? null,
    clip_scene_plan: renderReport.clip_scene_plan || null,
    overlay_card_windows: overlayCardWindows,
    card_visible_windows: cardVisibleWindows,
    ...currentRenderPolicyManifest(),
    ...premiumShellManifestFields({ job, renderReport }),
    input_fingerprint: inputState.inputFingerprint || null,
    input_evidence: {
      narration_audio_path: pathOrNull(job.evidence?.narration_audio_path),
      resolved_narration_audio_path: pathOrNull(inputState.audioPath),
      word_timestamps_path: pathOrNull(job.evidence?.word_timestamps_path),
      resolved_word_timestamps_path: pathOrNull(inputState.timestampsPath),
      word_timestamp_source: pathOrNull(job.evidence?.word_timestamp_source || job.evidence?.wordTimestampSource),
      word_timestamp_alignment_required:
        cleanText(job.evidence?.word_timestamp_source || job.evidence?.wordTimestampSource) ===
        "local_whisper_word_alignment"
          ? "local_whisper_word_alignment"
          : null,
      public_copy_repaired_at: cleanText(inputState.canonical?.public_copy_repaired_at),
    },
    quality_gate_status: "pending_post_render_forensics",
    no_publish_triggered: true,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_local_proof_promoted_to_final: true,
    },
  };
  await fs.writeJson(manifestPath, manifest, { spaces: 2 });
  return { manifestPath, manifest };
}

function resolveRenderReportPath(value, { workspaceRoot = process.cwd() } = {}) {
  const text = cleanText(value);
  if (!text) return "";
  if (path.isAbsolute(text)) return text;
  return path.resolve(workspaceRoot || process.cwd(), text);
}

async function persistAudioSegmentLoudnessReport({
  job = {},
  renderReport = {},
  generatedAt,
  workspaceRoot = process.cwd(),
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  if (!artifactDir) return null;
  let report = null;
  if (renderReport.audio_segment_loudness_report && typeof renderReport.audio_segment_loudness_report === "object") {
    report = renderReport.audio_segment_loudness_report;
  } else {
    const reportPath = resolveRenderReportPath(renderReport.audio_segment_loudness_report, { workspaceRoot });
    if (reportPath && await fs.pathExists(reportPath)) {
      report = await readJsonIfPresent(reportPath, null);
    }
  }
  if (!report || typeof report !== "object") return null;
  const persisted = {
    ...report,
    generated_at: cleanText(report.generated_at) || generatedAt,
    persisted_for_story_id: cleanText(job.story_id || report.story_id),
    persisted_from_render_report: true,
  };
  const outputPath = path.join(artifactDir, "audio_segment_loudness_report.json");
  await fs.writeJson(outputPath, persisted, { spaces: 2 });
  return outputPath;
}

async function verifyProductionRenderMedia(filePath, { runExecFile = execFileAsync } = {}) {
  const duration = defaultFfprobeDuration(filePath, { timeoutMs: 30000 });
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("production_render_media_integrity_failed:ffprobe_duration_invalid");
  }
  try {
    await runExecFile(
      "ffmpeg",
      [
        "-v", "error",
        "-xerror",
        "-i", filePath,
        "-map", "0:v:0",
        "-map", "0:a:0",
        "-f", "null",
        "-",
      ],
      {
        timeout: 180000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch (error) {
    const detail = cleanText(error?.stderr || error?.message || "decode_error").slice(0, 240);
    throw new Error(`production_render_media_integrity_failed:${detail || "decode_error"}`);
  }
  return { duration_s: duration, full_decode_passed: true };
}

async function materializeProductionRenderJob(job = {}, options = {}) {
  const storyId = cleanText(job.story_id);
  const outputPath = finalRenderOutputPath(job);
  if (options.inspectOnly) {
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "inspect_only_pending_render",
      output_path: outputPath,
    };
  }
  const inputState = await validateRenderInputs(job, {
    workspaceRoot: options.workspaceRoot,
  });
  if (!options.force && !jobForcesFinalRender(job) && (await hasExistingFinalRender(job, inputState))) {
    const existingManifest = await readJsonIfPresent(finalRenderManifestPath(job), {});
    const completion = await stampPublicCopyRenderRegenerated({
      job,
      inputState,
      completedAt: existingManifest.generated_at || options.generatedAt,
      status: "skipped_existing_final_render",
    });
    return {
      story_id: storyId,
      title: cleanText(job.title),
      status: "skipped_existing_final_render",
      output_path: outputPath,
      public_copy_regeneration: completion,
    };
  }
  const { storyJsonPath, story } = await buildRendererStoryJson(job, {
    generatedAt: options.generatedAt,
    workspaceRoot: options.workspaceRoot,
  });
  await fs.ensureDir(path.dirname(outputPath));
  const lockPath = `${outputPath}.render.lock`;
  const temporaryOutputPath = path.join(
    path.dirname(outputPath),
    `${path.basename(outputPath, path.extname(outputPath))}.partial-${crypto.randomUUID()}${path.extname(outputPath) || ".mp4"}`,
  );
  let lockHandle;
  try {
    lockHandle = await nativeFs.open(lockPath, "wx");
    await lockHandle.writeFile(JSON.stringify({
      story_id: storyId,
      pid: process.pid,
      started_at: options.generatedAt || new Date().toISOString(),
      output_path: outputPath,
      temporary_output_path: temporaryOutputPath,
    }, null, 2));
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error(`production_render_already_in_progress:${storyId}`);
    throw error;
  }

  let renderReport;
  let stat;
  try {
    renderReport = await options.renderProof({
      storyJson: storyJsonPath,
      output: temporaryOutputPath,
    });
    assertRenderReportVisualCadenceReady({ renderReport, renderStory: story });
    if (!(await fs.pathExists(temporaryOutputPath))) throw new Error("production_render_output_missing");
    const temporaryStat = await fs.stat(temporaryOutputPath);
    if (!temporaryStat.isFile() || temporaryStat.size < 1024) throw new Error("production_render_output_too_small");
    if (typeof options.verifyRenderedMedia === "function") {
      await options.verifyRenderedMedia(temporaryOutputPath);
    }
    await fs.rename(temporaryOutputPath, outputPath);
    stat = await fs.stat(outputPath);
  } finally {
    await fs.remove(temporaryOutputPath).catch(() => {});
    if (lockHandle) await lockHandle.close().catch(() => {});
    await fs.remove(lockPath).catch(() => {});
  }
  await writeFinalRenderManifest({
    job,
    renderReport,
    inputState,
    generatedAt: options.generatedAt,
  });
  const audioSegmentLoudnessReportPath = await persistAudioSegmentLoudnessReport({
    job,
    renderReport,
    generatedAt: options.generatedAt,
    workspaceRoot: options.workspaceRoot,
  });
  const publicCopyRegeneration = await stampPublicCopyRenderRegenerated({
    job,
    inputState,
    completedAt: options.generatedAt,
    status: "rendered",
  });
  const qualityRefresh = await refreshPostRenderQualityArtifacts({
    job,
    renderReport,
    generatedAt: options.generatedAt,
  });
  return {
    story_id: storyId,
    title: cleanText(job.title),
    status: "rendered",
    output_path: outputPath,
    render_manifest_path: finalRenderManifestPath(job),
    size_bytes: stat.size,
    clips: renderReport.clips ?? null,
    rendered_duration_s: renderReport.rendered_duration_s ?? null,
    audio_segment_loudness_report_path: audioSegmentLoudnessReportPath,
    post_render_quality_refresh: qualityRefresh,
    public_copy_regeneration: publicCopyRegeneration,
  };
}

function normaliseStoryIdFilter(storyIds = []) {
  const ids = Array.isArray(storyIds) ? storyIds : [storyIds];
  return new Set(ids.map(cleanText).filter(Boolean));
}

function jobsForProductionRender(workOrder = {}, { limit = 0, storyIds = [] } = {}) {
  const storyIdFilter = normaliseStoryIdFilter(storyIds);
  let jobs = asArray(workOrder.jobs).filter(
    (job) =>
      cleanText(job.status) === "ready_for_final_render_job" &&
      asArray(job.actions).some(actionNeedsProductionRender),
  );
  if (storyIdFilter.size) {
    jobs = jobs.filter((job) => storyIdFilter.has(cleanText(job.story_id)));
  }
  if (Number(limit) > 0) jobs = jobs.slice(0, Number(limit));
  return jobs;
}

async function materializeGoalProductionRenders({
  workOrder = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  limit = 0,
  storyIds = [],
  force = false,
  inspectOnly = false,
  renderProof = defaultRenderProof,
  verifyRenderedMedia = renderProof === defaultRenderProof ? verifyProductionRenderMedia : null,
} = {}) {
  const jobs = jobsForProductionRender(workOrder, { limit, storyIds });
  const results = [];
  for (const job of jobs) {
    try {
      results.push(
        await materializeProductionRenderJob(job, {
          workspaceRoot,
          generatedAt,
          force,
          inspectOnly,
          renderProof,
          verifyRenderedMedia,
        }),
      );
    } catch (error) {
      results.push({
        story_id: cleanText(job.story_id),
        title: cleanText(job.title),
        status: "failed",
        error: error.message,
      });
    }
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PRODUCTION_RENDER_MATERIALIZER",
    source_work_order_generated_at: workOrder.generated_at || null,
    summary: {
      candidate_count: jobs.length,
      rendered_count: results.filter((job) => job.status === "rendered").length,
      failed_count: results.filter((job) => job.status === "failed").length,
      skipped_existing_count: results.filter((job) => job.status === "skipped_existing_final_render").length,
      inspect_only_count: results.filter((job) => job.status === "inspect_only_pending_render").length,
    },
    jobs: results,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      no_local_proof_promoted_to_final: true,
      renderer_invoked: inspectOnly !== true,
    },
  };
}

function renderGoalProductionRenderMaterializationMarkdown(report = {}) {
  const lines = [];
  lines.push("# Production Render Materialization");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || ""}`);
  lines.push(`Candidates: ${report.summary?.candidate_count || 0}`);
  lines.push(`Rendered: ${report.summary?.rendered_count || 0}`);
  lines.push(`Existing final renders: ${report.summary?.skipped_existing_count || 0}`);
  lines.push(`Inspect-only: ${report.summary?.inspect_only_count || 0}`);
  lines.push(`Failed: ${report.summary?.failed_count || 0}`);
  lines.push("");
  lines.push("## Jobs");
  for (const job of asArray(report.jobs).slice(0, 40)) {
    const suffix = job.error ? `; error: ${job.error}` : "";
    lines.push(`- ${job.story_id}: ${job.status}${suffix}`);
  }
  if (!asArray(report.jobs).length) lines.push("- none");
  lines.push("");
  lines.push("Safety: final render materialisation only. No publish, database, token or OAuth change was triggered.");
  return `${lines.join("\n")}\n`;
}

async function writeGoalProductionRenderMaterializationReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalProductionRenderMaterializationReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "production_render_materialization_report.json");
  const markdownPath = path.join(outDir, "production_render_materialization_report.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalProductionRenderMaterializationMarkdown(report), "utf8");
  return { outputDir: outDir, jsonPath, markdownPath };
}

module.exports = {
  materializeGoalProductionRenders,
  refreshFinalRenderQualityOnly,
  renderGoalProductionRenderMaterializationMarkdown,
  writeGoalProductionRenderMaterializationReport,
  buildRendererStoryJson,
  jobsForProductionRender,
  shouldSkipReadableShellCardsForAudioBudget,
  _private: {
    clipBaseSourceKey,
    rendererBridgeClipFromProductionClip,
    resolveNarrationDurationS,
  },
};
