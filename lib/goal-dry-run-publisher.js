"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const mediaPaths = require("./media-paths");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { evaluateIncidentGuard } = require("./incident-guard");
const { auditNarrationQaArtifacts } = require("./narration-qa-artifact");
const { auditPublicOutputCoherenceArtifact } = require("./public-output-coherence-artifact");
const { visualEvidenceProfile } = require("./visual-evidence-classifier");
const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const { canonicalHash } = require("./services/url-canonical");
const { titleTopicKey, titleTopicOverlap } = require("./services/publish-dedupe");
const {
  SOURCE_CARD_TIMING,
} = require("./studio/v4/premium-card-timing-policy");

const MIN_PREMIUM_HYPERFRAMES_CARDS = 4;
const MIN_HYPERFRAMES_READABLE_CARD_DURATION_S = 12;
const MIN_COMPACT_PROOF_OVERLAY_DURATION_S = 2.6;
const MAX_COMPACT_PROOF_OVERLAY_DURATION_S = 4.2;
const MAX_HYPERFRAMES_READABLE_CARD_DURATION_S = 14;
const MIN_HYPERFRAMES_SOURCE_CARD_DURATION_S = SOURCE_CARD_TIMING.minimum_visible_duration_s;
const MAX_HYPERFRAMES_SOURCE_CARD_DURATION_S = SOURCE_CARD_TIMING.maximum_visible_duration_s;
const MAX_FINAL_RENDER_VISUAL_REUSE_RATIO = 1.5;
const MIN_FINAL_RENDER_REUSE_CLIPS = 12;
const MAX_DIRECT_MOTION_BASE_SOURCE_CLIPS = 2;
const MAX_DIRECT_MOTION_BASE_SOURCE_SHARE = 0.25;

const READY_PACKAGE_VERDICTS = new Set([
  "green",
  "pass",
  "passed",
  "ready",
  "ready_for_dry_run_publish",
  "publish_ready",
]);

const LOCAL_PROOF_PENDING_VERDICTS = new Set([
  "local_proof_pending",
  "needs_media_house_render_proof",
  "fresh_source_draft_validated_reference_only",
]);

const LOCAL_PROOF_TRANSITION_BLOCKERS = new Set([
  "not_scheduler_green",
  "missing_fresh_audio_and_word_timestamps",
  "missing_validated_official_direct_motion",
  "missing_visual_v4_final_render",
  "missing_media_house_quality_gate_pass",
  "missing_scheduler_preflight_pass",
  "missing_strict_dry_run_pass",
  "footage:v4_motion_blocked",
  "director:director_blocked",
  "benchmark:warn",
  "media_house:title_lacks_curiosity_gap",
  "media_house:platform_title_too_plain",
  "media_house:shorts_feed_competition_weak",
  "media_house:overall_score_below_threshold",
  "media_house:competitor_parity_below_threshold",
  "media_house:visuals_look_templated",
  "media_house:source_lock_not_verified",
  "render:final_publish_render_missing",
  "audio:narration_audio_missing",
  "captions:word_timestamps_missing",
]);

const REQUIRED_READY_FILES = [
  "canonical_story_manifest.json",
  "visual_v4_render.mp4",
  "captions.srt",
  "render_manifest.json",
  "visual_quality_report.json",
  "benchmark_report.json",
  "coherence_report.json",
  "sfx_manifest.json",
  "platform_publish_manifest.json",
  "publish_verdict.json",
  "landing_page_manifest.json",
  "platform_policy_report.json",
];

const PLATFORMS = [
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
];

const PLATFORM_OPERATIONAL_KEYS = {
  youtube_shorts: "youtube",
  tiktok: "tiktok",
  instagram_reels: "instagram_reel",
  facebook_reels: "facebook_reel",
  x: "twitter",
  threads: "threads",
  pinterest: "pinterest",
};

const PLATFORM_FIELD_TO_KEY = {
  youtube_post_id: "youtube_shorts",
  youtube_url: "youtube_shorts",
  instagram_media_id: "instagram_reels",
  facebook_post_id: "facebook_reels",
  tiktok_post_id: "tiktok",
  twitter_post_id: "x",
};

const PLATFORM_POST_TO_KEY = {
  youtube: "youtube_shorts",
  youtube_shorts: "youtube_shorts",
  instagram: "instagram_reels",
  instagram_reel: "instagram_reels",
  instagram_reels: "instagram_reels",
  facebook: "facebook_reels",
  facebook_reel: "facebook_reels",
  facebook_reels: "facebook_reels",
  tiktok: "tiktok",
  twitter: "x",
  twitter_video: "x",
  x: "x",
  threads: "threads",
  pinterest: "pinterest",
};

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalisePathKey(value) {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function uniqueCleanStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of asArray(values)) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function storySourceUrls(story = {}) {
  return uniqueCleanStrings([
    story.url,
    story.source_url,
    story.primary_source_url,
    story.canonical?.url,
    story.canonical?.source_url,
    story.canonical?.primary_source_url,
    story.canonical?.primary_source?.url,
    story.canonical?.official_source?.url,
    story.platform_publish_manifest?.primary_source_url,
    story.platform_publish_manifest?.source_url,
    story.platform_publish_manifest?.primary_source?.url,
  ]);
}

function storySourceUrlHashes(story = {}) {
  return uniqueCleanStrings([
    story.source_url_hash,
    story.canonical?.source_url_hash,
    ...storySourceUrls(story).map((url) => canonicalHash(url)),
  ]).filter((hash) => hash && hash !== "invalid-url");
}

function normalizePlatformKey(value = "") {
  const key = cleanText(value).toLowerCase();
  return PLATFORM_POST_TO_KEY[key] || (PLATFORMS.includes(key) ? key : "");
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number != null) return number;
  }
  return null;
}

function firstCleanText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

function audioSegmentFreshnessBlockers({ audioSegmentReport = null, renderManifest = {} } = {}) {
  if (!audioSegmentReport || typeof audioSegmentReport !== "object") return [];
  const renderGeneratedAt = timeMs(renderManifest.generated_at || renderManifest.generatedAt || renderManifest.rendered_at);
  if (!renderGeneratedAt) return [];
  const reportGeneratedAt = timeMs(audioSegmentReport.generated_at || audioSegmentReport.generatedAt || audioSegmentReport.checked_at);
  if (!reportGeneratedAt) return ["audio_segment_loudness_report_missing_generated_at"];
  return reportGeneratedAt < renderGeneratedAt
    ? ["audio_segment_loudness_report_stale_after_render"]
    : [];
}

function isRetentionShortApproved({ canonical = {}, renderManifest = {}, platformManifest = {} } = {}) {
  return (
    canonical.breaking_news_flag === true ||
    canonical.retention_short_approved === true ||
    canonical.human_reviewed_retention_short === true ||
    renderManifest.retention_short_approved === true ||
    renderManifest.human_reviewed_retention_short === true ||
    platformManifest.retention_short_approved === true ||
    platformManifest.human_reviewed_retention_short === true ||
    cleanText(renderManifest.duration_lane) === "pulse_retention_short_approved" ||
    cleanText(platformManifest.duration_lane) === "pulse_retention_short_approved"
  );
}

function isDirectVideoMotionExceptionApproved({ canonical = {}, renderManifest = {}, platformManifest = {} } = {}) {
  return (
    canonical.breaking_news_flag === true ||
    canonical.human_reviewed_direct_video_motion_exception === true ||
    canonical.direct_video_motion_exception_approved === true ||
    renderManifest.human_reviewed_direct_video_motion_exception === true ||
    renderManifest.direct_video_motion_exception_approved === true ||
    platformManifest.human_reviewed_direct_video_motion_exception === true ||
    platformManifest.direct_video_motion_exception_approved === true
  );
}

function requiresDirectVideoMotion({ canonical = {}, renderManifest = {}, platformManifest = {} } = {}) {
  if (isDirectVideoMotionExceptionApproved({ canonical, renderManifest, platformManifest })) return false;
  const lane = cleanText(renderManifest.render_lane || renderManifest.lane || renderManifest.renderer).toLowerCase();
  const qualityClass = cleanText(renderManifest.render_quality_class || renderManifest.quality_class).toLowerCase();
  const visualTier = cleanText(renderManifest.visual_tier || renderManifest.tier).toLowerCase();
  return (
    renderManifest.final_publish_render === true &&
    (
      lane.includes("visual_v4") ||
      visualTier.includes("production_v4") ||
      qualityClass === "premium"
    )
  );
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function hasObjectKeys(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function renderManifestFrom(value = {}) {
  if (hasObjectKeys(value.render_manifest)) return objectValue(value.render_manifest);
  if (hasObjectKeys(value.renderManifest)) return objectValue(value.renderManifest);
  return {};
}

function looksLikePremiumLane(value = {}) {
  return Boolean(
    hasObjectKeys(value) &&
      (
        cleanText(value.rendererSplit || value.renderer_split).includes("hyperframes") ||
        value.hyperframesPremiumShellGate ||
        value.hyperframes_premium_shell_gate ||
        value.hyperframesCardCount != null ||
        value.hyperframes_card_count != null ||
        value.premiumShellVerdict ||
        value.premium_shell_verdict
      ),
  );
}

function premiumLaneObject(value = {}) {
  const renderManifest = renderManifestFrom(value);
  const candidates = [
    value.premiumLane,
    value.premium_lane,
    value.studio?.premiumLane,
    value.studio?.premium_lane,
    renderManifest.premiumLane,
    renderManifest.premium_lane,
  ];
  return objectValue(candidates.find((candidate) => looksLikePremiumLane(objectValue(candidate))));
}

function premiumShellGateFrom(value = {}) {
  const lane = premiumLaneObject(value);
  const renderManifest = renderManifestFrom(value);
  return objectValue(
    value.hyperframesPremiumShellGate ||
      value.premiumShellGate ||
      value.hyperframes_premium_shell_gate ||
      value.premium_shell_gate ||
      value.studio?.hyperframesPremiumShellGate ||
      value.studio?.premiumShellGate ||
      lane.hyperframesPremiumShellGate ||
      lane.premiumShellGate ||
      lane.hyperframes_premium_shell_gate ||
      lane.premium_shell_gate ||
      renderManifest.hyperframesPremiumShellGate ||
      renderManifest.premiumShellGate ||
      renderManifest.hyperframes_premium_shell_gate ||
      renderManifest.premium_shell_gate,
  );
}

function hyperframesCardCount(value = {}) {
  const lane = premiumLaneObject(value);
  const renderManifest = renderManifestFrom(value);
  return firstNumber(
    value.hyperframesCardCount,
    value.hyperframes_card_count,
    value.studio?.hyperframesCardCount,
    value.studio?.hyperframes_card_count,
    lane.hyperframesCardCount,
    lane.hyperframes_card_count,
    renderManifest.hyperframesCardCount,
    renderManifest.hyperframes_card_count,
  ) || 0;
}

function premiumShellVerdict(value = {}) {
  const lane = premiumLaneObject(value);
  const gate = premiumShellGateFrom(value);
  return cleanText(
    value.premiumShellVerdict ||
      value.premium_shell_verdict ||
      value.studio?.premiumShellVerdict ||
      lane.premiumShellVerdict ||
      lane.premium_shell_verdict ||
      gate.verdict ||
      gate.status,
  ).toLowerCase();
}

function premiumShellPassCount(value = {}) {
  const lane = premiumLaneObject(value);
  const gate = premiumShellGateFrom(value);
  return firstNumber(
    value.premiumShellPassCount,
    value.premium_shell_pass_count,
    value.studio?.premiumShellPassCount,
    lane.premiumShellPassCount,
    lane.premium_shell_pass_count,
    gate.passCount,
    gate.pass_count,
  );
}

function premiumShellRequiredPassCount(value = {}) {
  const lane = premiumLaneObject(value);
  const gate = premiumShellGateFrom(value);
  return firstNumber(
    value.premiumShellRequiredPassCount,
    value.premium_shell_required_pass_count,
    value.hyperframesPremiumShellRequiredPassCount,
    value.hyperframes_premium_shell_required_pass_count,
    value.studio?.premiumShellRequiredPassCount,
    value.studio?.premium_shell_required_pass_count,
    value.studio?.hyperframesPremiumShellRequiredPassCount,
    value.studio?.hyperframes_premium_shell_required_pass_count,
    lane.premiumShellRequiredPassCount,
    lane.premium_shell_required_pass_count,
    lane.hyperframesPremiumShellRequiredPassCount,
    lane.hyperframes_premium_shell_required_pass_count,
    gate.requiredPassCount,
    gate.required_pass_count,
  ) || MIN_PREMIUM_HYPERFRAMES_CARDS;
}

function truthyFlag(value) {
  if (value === true) return true;
  return /^(?:true|1|yes|required)$/i.test(cleanText(value));
}

function requiresHyperframesPremiumShell(value = {}) {
  const lane = premiumLaneObject(value);
  const renderManifest = renderManifestFrom(value);
  return [
    value.hyperframesPremiumShellRequired,
    value.hyperframes_premium_shell_required,
    value.requireHyperframesPremiumShell,
    value.require_hyperframes_premium_shell,
    value.studio?.hyperframesPremiumShellRequired,
    value.studio?.hyperframes_premium_shell_required,
    lane.hyperframesPremiumShellRequired,
    lane.hyperframes_premium_shell_required,
    renderManifest.hyperframesPremiumShellRequired,
    renderManifest.hyperframes_premium_shell_required,
    renderManifest.requireHyperframesPremiumShell,
    renderManifest.require_hyperframes_premium_shell,
  ].some(truthyFlag);
}

function declaresHyperframesPremium(value = {}) {
  const lane = premiumLaneObject(value);
  const renderManifest = renderManifestFrom(value);
  const text = [
    value.render_lane,
    value.lane,
    value.renderer,
    value.render_renderer,
    value.rendererSplit,
    value.renderer_split,
    typeof value.premiumLane === "string" ? value.premiumLane : "",
    typeof value.premium_lane === "string" ? value.premium_lane : "",
    lane.rendererSplit,
    lane.renderer_split,
    renderManifest.render_lane,
    renderManifest.lane,
    renderManifest.renderer,
    renderManifest.rendererSplit,
    renderManifest.renderer_split,
  ].map(cleanText).join(" ").toLowerCase();
  return requiresHyperframesPremiumShell(value) || hyperframesCardCount(value) > 0 || text.includes("hyperframes");
}

function hyperframesPremiumShellBlockers(value = {}) {
  if (!declaresHyperframesPremium(value)) return [];
  const cardCount = hyperframesCardCount(value);
  const requiredPassCount = premiumShellRequiredPassCount(value);
  const verdict = premiumShellVerdict(value);
  const passCount = premiumShellPassCount(value);
  const passCountMissing = passCount == null;
  const passCountTooLow = !passCountMissing && passCount < requiredPassCount;
  const gate = premiumShellGateFrom(value);
  const evidenceBlockers = uniqueCleanStrings([
    ...asArray(value.premiumShellBlockers).map((blocker) => `hyperframes_premium_shell:${blocker}`),
    ...asArray(value.premium_shell_blockers).map((blocker) => `hyperframes_premium_shell:${blocker}`),
    ...asArray(gate.blockers).map((blocker) => `hyperframes_premium_shell:${blocker}`),
  ]);
  if (verdict === "pass" && !passCountMissing && !passCountTooLow && evidenceBlockers.length === 0) return [];

  return uniqueCleanStrings([
    "hyperframes_premium_shell_not_passed",
    requiresHyperframesPremiumShell(value) ? "hyperframes_premium_shell_required" : "",
    verdict ? `hyperframes_premium_shell_verdict:${verdict}` : "hyperframes_premium_shell_missing",
    passCountMissing ? `hyperframes_premium_shell_pass_count_missing:${requiredPassCount}` : "",
    passCountTooLow
      ? `hyperframes_premium_shell_pass_count_below_required:${passCount}/${requiredPassCount}`
      : "",
    ...evidenceBlockers,
  ]);
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

async function fileReady(filePath, basename) {
  if (!(await fs.pathExists(filePath))) return false;
  if (/\.mp4$/i.test(basename)) {
    const stat = await fs.stat(filePath);
    return stat.size > 1000;
  }
  if (/\.srt$/i.test(basename)) {
    const text = await fs.readFile(filePath, "utf8").catch(() => "");
    return /\d\d:\d\d:\d\d,\d{3}\s+-->\s+\d\d:\d\d:\d\d,\d{3}/.test(text);
  }
  return true;
}

function referencePathCandidates(artifactDir, reference) {
  const rawPath = cleanText(reference);
  if (!rawPath) return [];
  if (path.isAbsolute(rawPath)) return [rawPath];
  return [
    path.join(artifactDir, rawPath),
    path.join(process.cwd(), rawPath),
  ];
}

async function resolvedReferencePathCandidates(artifactDir, reference) {
  const rawPath = cleanText(reference);
  const candidates = referencePathCandidates(artifactDir, rawPath);
  if (rawPath && !path.isAbsolute(rawPath)) {
    const mediaRootCandidate = await mediaPaths.resolveExisting(rawPath).catch(() => null);
    if (mediaRootCandidate) candidates.splice(1, 0, mediaRootCandidate);
  }
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = path.resolve(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function referencedFileReady(artifactDir, reference, minBytes = 100) {
  for (const filePath of await resolvedReferencePathCandidates(artifactDir, reference)) {
    try {
      if (!(await fs.pathExists(filePath))) continue;
      const stat = await fs.stat(filePath);
      if (stat.size >= minBytes) return true;
    } catch {}
  }
  return false;
}

async function readJsonReferenceIfPresent(artifactDir, reference, fallback = null) {
  for (const filePath of await resolvedReferencePathCandidates(artifactDir, reference)) {
    try {
      if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
    } catch {}
  }
  return fallback;
}

async function readJsonReferenceCandidates(artifactDir, references = []) {
  const candidates = [];
  const seen = new Set();
  for (const reference of references) {
    for (const filePath of await resolvedReferencePathCandidates(artifactDir, reference)) {
      const key = path.resolve(filePath);
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        if (await fs.pathExists(filePath)) {
          candidates.push({ filePath, payload: await fs.readJson(filePath) });
        }
      } catch {}
    }
  }
  return candidates;
}

function manifestReadyStatus(manifest = {}) {
  const status = cleanText(manifest.status || manifest.state || manifest.verdict || manifest.result).toLowerCase();
  if (!status) return true;
  return ["ready", "pass", "passed", "green", "ok", "complete"].includes(status);
}

function manifestObjectPresent(manifest) {
  return Boolean(manifest && typeof manifest === "object" && Object.keys(manifest).length > 0);
}

function manifestHasNoFailures(manifest = {}) {
  return !uniqueCleanStrings([
    ...asArray(manifest.failures),
    ...asArray(manifest.blockers),
    ...asArray(manifest.hard_failures),
    ...asArray(manifest.errors),
    ...asArray(manifest.reason_codes),
  ]).length;
}

function schedulerPreflightPassed(storyPackage = {}) {
  const qa = storyPackage.scheduler_preflight_qa || {};
  const status = cleanText(qa.status || qa.result || storyPackage.scheduler_preflight_status).toLowerCase();
  return (
    storyPackage.scheduler_preflight_package_source === "candidate_exported_path" &&
    ["pass", "passed", "publish_ready", "ready"].includes(status) &&
    !uniqueCleanStrings([
      ...asArray(qa.blockers),
      ...asArray(qa.failures),
      ...asArray(qa.errors),
    ]).length
  );
}

function mediaHouseScoreGreen(mediaHouseScore = {}) {
  if (!manifestObjectPresent(mediaHouseScore)) return false;
  const verdict = cleanText(mediaHouseScore.verdict || mediaHouseScore.status).toLowerCase();
  return (
    ["green", "pass", "passed"].includes(verdict) &&
    manifestHasNoFailures(mediaHouseScore)
  );
}

function stalePublishVerdictCanUseSchedulerPreflight({
  storyPackage = {},
  publishVerdict = {},
  platformManifest = {},
  renderManifest = {},
  mediaHouseScore = {},
} = {}) {
  if (upperClean(publishVerdict.verdict) === "GREEN" && publishVerdict.can_auto_publish === true) return false;
  return (
    schedulerPreflightPassed(storyPackage) &&
    upperClean(platformManifest.publish_status) === "GREEN" &&
    platformManifest.can_auto_publish === true &&
    renderManifest.final_publish_render === true &&
    mediaHouseScoreGreen(mediaHouseScore) &&
    manifestHasNoFailures(platformManifest) &&
    manifestHasNoFailures(platformManifest.platform_native_evidence || {})
  );
}

function audioManifestNarrationPath(audioManifest = {}) {
  return cleanText(
    audioManifest.audio_path ||
      audioManifest.final_audio_path ||
      audioManifest.narration_audio_path ||
      audioManifest.resolved_narration_audio_path,
  );
}

function audioManifestProvidesNarration(audioManifest = {}) {
  return manifestObjectPresent(audioManifest) &&
    manifestReadyStatus(audioManifest) &&
    Boolean(audioManifestNarrationPath(audioManifest));
}

function steamTrailerAssetKeyFromText(value = "") {
  const text = cleanText(value).toLowerCase().replace(/\\/g, "/");
  if (!text.includes("/store_trailers/")) return "";
  const match = text.match(
    /\/store_trailers\/(\d+)\/(\d+)\/([a-f0-9]{16,})\/(\d+)(?:\/|_|$)/i,
  );
  if (!match) return "";
  return `steam-trailer:${match[1]}/${match[2]}/${match[3]}/${match[4]}`;
}

function sourceUrlFamilyKey(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const steamTrailerAssetKey = steamTrailerAssetKeyFromText(text);
  if (steamTrailerAssetKey) return steamTrailerAssetKey;
  try {
    const url = new URL(text);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "youtube.com" && url.pathname.toLowerCase() === "/watch") {
      const videoId = cleanText(url.searchParams.get("v"));
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
    if (host === "youtu.be") {
      const videoId = cleanText(url.pathname.split("/").filter(Boolean)[0]);
      if (videoId) return `youtube:${videoId.toLowerCase()}`;
    }
    url.search = "";
    url.hash = "";
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

function directMotionReadinessFamily(clip = {}, index = 0) {
  if (typeof clip === "string") return cleanText(path.basename(clip, path.extname(clip)));
  const sourceKey = sourceUrlFamilyKey(
    clip.source_url ||
      clip.url ||
      clip.original_source_url ||
      clip.source ||
      clip.reference_url,
  );
  const mediaKind = cleanText(clip.media_kind || clip.source_url_kind || clip.source_kind || clip.source_type).toLowerCase();
  const directMotion =
    mediaKind.includes("direct_video") ||
    mediaKind.includes("hls_manifest") ||
    mediaKind.includes("dash_manifest") ||
    mediaKind.includes("official_platform_product_page") ||
    mediaKind.includes("licensed_direct_media") ||
    /\.(?:mp4|mov|webm|mkv)(?:$|[?#])/i.test(cleanText(clip.path || clip.media_path || clip.local_path || clip.source_url || clip.url));
  if (directMotion) {
    const windowedOfficialFamily = officialWindowedDirectMotionFamily(clip);
    if (windowedOfficialFamily) return windowedOfficialFamily;
    if (sourceKey) return sourceKey;
  }
  const baseFamily = cleanText(
    clip.base_source_family ||
      clip.original_source_family ||
      clip.provenance?.base_source_family ||
      clip.provenance?.source_family,
  );
  if (baseFamily) return baseFamily;
  if (sourceKey) return sourceKey;
  return cleanText(
    clip.motion_family ||
      clip.source_family ||
      clip.visual_family ||
      clip.family ||
      clip.id ||
      `motion_family_${index + 1}`,
  );
}

function motionReadinessFamilies(clips = []) {
  return new Set(
    asArray(clips)
      .map((clip, index) => directMotionReadinessFamily(clip, index))
      .filter(Boolean),
  );
}

function materialisedMotionEvidenceClips(ownedMotionManifest = {}, materialisedMotionClips = {}) {
  return [
    ...asArray(ownedMotionManifest.materialised_clips),
    ...asArray(ownedMotionManifest.clips),
    ...asArray(ownedMotionManifest.assets),
    ...asArray(
      Array.isArray(materialisedMotionClips)
        ? materialisedMotionClips
        : materialisedMotionClips.clips || materialisedMotionClips.materialised_clips,
    ),
  ];
}

function mergedMotionEvidenceClips(...clipLists) {
  const seen = new Set();
  const merged = [];
  for (const clip of clipLists.flatMap((list) => asArray(list))) {
    const key = visualUnitKey(clip) || cleanText(clip?.id);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(clip);
  }
  return merged;
}

function clipSceneLooksReadableCard(scene = {}) {
  const text = [
    scene.id,
    scene.path,
    scene.media_path,
    scene.media_kind,
    scene.source_kind,
    scene.source_type,
    scene.kind,
    scene.type,
    scene.readable_card_kind,
    scene.readableCardKind,
    scene.card_kind,
    scene.cardKind,
  ].map(cleanText).join(" ").toLowerCase();
  return /hyperframes|proof[_-]?card|source[_-]?card|context[_-]?card|timeline[_-]?card|quote[_-]?card|takeaway[_-]?card|\bcard\b/.test(text);
}

function finalClipScenePlanMotionEvidence(renderManifest = {}, clipScenePlanVisualCadence = {}) {
  const plan = renderManifest?.clip_scene_plan || renderManifest?.clipScenePlan || {};
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return null;
  if (renderManifest.final_publish_render !== true) return null;
  if ((plan.repeat_free ?? plan.repeatFree) !== true) return null;
  if (asArray(clipScenePlanVisualCadence.blockers).length) return null;
  const scenes = asArray(plan.scenes);
  if (scenes.length < 3) return null;
  const clips = scenes.map((scene, index) => {
    const isCard = clipSceneLooksReadableCard(scene);
    const sourceFamily = firstCleanText(
      scene.source_family,
      scene.motion_family,
      scene.visual_family,
      scene.base_source_family,
      scene.base_source_key,
      scene.baseSourceKey,
      scene.source_root_key,
      scene.sourceRootKey,
      scene.id,
      `clip_scene_${index + 1}`,
    );
    const mediaStart = firstNumber(
      scene.mediaStartS,
      scene.media_start_s,
      scene.sourceStartS,
      scene.source_start_s,
      scene.clipStartS,
      scene.clip_start_s,
      scene.provenance?.media_start_s,
      scene.provenance?.segment_original_start_s,
    );
    return {
      id: firstCleanText(scene.id, scene.path, `clip_scene_${index + 1}`),
      path: firstCleanText(scene.path, scene.media_path, scene.local_path, scene.output_path),
      source_url: firstCleanText(
        scene.source_url,
        scene.url,
        scene.original_source_url,
        scene.reference_url,
        scene.source,
        scene.source_root_key,
        scene.sourceRootKey,
      ),
      media_kind: firstCleanText(
        scene.media_kind,
        scene.source_kind,
        scene.source_type,
        isCard ? "source_card" : "direct_video",
      ),
      source_family: sourceFamily,
      base_source_family: firstCleanText(
        scene.base_source_family,
        scene.source_root_key,
        scene.sourceRootKey,
        scene.base_source_key,
        scene.baseSourceKey,
        sourceFamily,
      ),
      duration_s: firstNumber(scene.duration_s, scene.durationS, scene.duration, scene.visible_duration_s),
      ...(mediaStart != null ? { media_start_s: mediaStart } : {}),
    };
  });
  const directMotionClipCount = clips.filter(directMotionClipLike).length;
  if (directMotionClipCount < 3) return null;
  return {
    source: "final_clip_scene_plan",
    clips,
    directMotionClipCount,
  };
}

function directMotionSegmentWindowValue(clip = {}, keys = []) {
  for (const key of keys) {
    const value = key.split(".").reduce((current, part) => current?.[part], clip);
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function directMotionSegmentWindowFromIdentity(clip = {}) {
  const text = [
    clip.source_family,
    clip.motion_family,
    clip.visual_family,
    clip.base_source_family,
    clip.base_source_key,
    clip.baseSourceKey,
    clip.provenance?.source_family,
    clip.provenance?.motion_family,
    clip.provenance?.base_source_family,
  ].map(cleanText).filter(Boolean).join(" ");
  const match = text.match(/(?:^|[_/-])window[_/-](\d+(?:\.\d+)?)(?:[_/-](\d+(?:\.\d+)?))?/i);
  if (!match) return {};
  return {
    start: match[1],
    duration: match[2] || "",
  };
}

function directMotionSegmentFallbackSourceKey(clip = {}) {
  const family = firstCleanText(
    clip.source_family,
    clip.motion_family,
    clip.visual_family,
    clip.base_source_family,
    clip.base_source_key,
    clip.baseSourceKey,
    clip.provenance?.source_family,
    clip.provenance?.motion_family,
    clip.provenance?.base_source_family,
  );
  const strippedFamily = stripWindowSuffix(family);
  if (strippedFamily) return `family:${normalisePathKey(strippedFamily)}`;
  return "";
}

function directMotionSegmentKey(clip = {}) {
  if (!clip || typeof clip !== "object") return "";
  const sourceKey = sourceUrlFamilyKey(
    clip.source_url ||
      clip.url ||
      clip.original_source_url ||
      clip.source ||
      clip.reference_url,
  ) || directMotionSegmentFallbackSourceKey(clip);
  if (!sourceKey) return "";
  const mediaKind = cleanText(clip.media_kind || clip.source_url_kind || clip.source_kind || clip.source_type).toLowerCase();
  const clipPath = cleanText(clip.path || clip.media_path || clip.local_path || clip.source_url || clip.url);
  const directMotion =
    mediaKind.includes("direct_video") ||
    mediaKind.includes("hls_manifest") ||
    mediaKind.includes("dash_manifest") ||
    mediaKind.includes("official_platform_product_page") ||
    mediaKind.includes("licensed_direct_media") ||
    /\.(?:mp4|mov|webm|mkv)(?:$|[?#])/i.test(clipPath);
  if (!directMotion) return "";
  const identityWindow = directMotionSegmentWindowFromIdentity(clip);
  const start = directMotionSegmentWindowValue(clip, [
    "mediaStartS",
    "media_start_s",
    "start_s",
    "start",
    "provenance.media_start_s",
    "provenance.segment_render_start_s",
    "provenance.segment_original_start_s",
  ]) || identityWindow.start;
  const duration = directMotionSegmentWindowValue(clip, [
    "durationS",
    "duration_s",
    "duration",
    "provenance.duration_s",
    "provenance.segment_render_duration_s",
    "provenance.segment_original_duration_s",
  ]) || identityWindow.duration;
  return `${sourceKey}|start:${start || "unknown"}|duration:${duration || "unknown"}`;
}

function directMotionClipLike(clip = {}) {
  if (!clip || typeof clip !== "object") return false;
  const mediaKind = cleanText(
    clip.media_kind ||
      clip.source_url_kind ||
      clip.source_kind ||
      clip.source_type ||
      clip.asset_type,
  ).toLowerCase();
  if (/hyperframes|proof_card|source_card|card|generated_only/i.test(mediaKind)) return false;
  const clipPath = cleanText(
    clip.path ||
      clip.media_path ||
      clip.local_path ||
      clip.local_materialized_path ||
      clip.source_url ||
      clip.url,
  );
  return (
    mediaKind.includes("direct_video") ||
    mediaKind.includes("hls_manifest") ||
    mediaKind.includes("dash_manifest") ||
    mediaKind.includes("official_platform_product_page") ||
    mediaKind.includes("licensed_direct_media") ||
    /\.(?:mp4|mov|webm|mkv)(?:$|[?#])/i.test(clipPath)
  );
}

function repeatedDirectMotionSegmentEvidence(clips = []) {
  const seen = new Map();
  const seenEvidenceRecords = new Set();
  const repeated = [];
  for (const clip of asArray(clips)) {
    const evidenceKey = normalisePathKey(
      cleanText(
        clip?.path ||
          clip?.media_path ||
          clip?.local_path ||
          clip?.local_materialized_path ||
          clip?.id,
      ),
    );
    if (evidenceKey) {
      if (seenEvidenceRecords.has(evidenceKey)) continue;
      seenEvidenceRecords.add(evidenceKey);
    }
    const key = directMotionSegmentKey(clip);
    if (!key) continue;
    if (seen.has(key)) {
      repeated.push({
        key,
        first_id: cleanText(seen.get(key).id || seen.get(key).path),
        repeated_id: cleanText(clip.id || clip.path),
      });
      continue;
    }
    seen.set(key, clip);
  }
  return repeated;
}

function repeatedDirectMotionSegmentBlockers(clips = []) {
  return repeatedDirectMotionSegmentEvidence(clips).length
    ? ["visual_evidence:repeated_direct_motion_segment"]
    : [];
}

function visualUnitKey(clip = {}) {
  if (!clip) return "";
  if (typeof clip === "string") return normalisePathKey(clip);
  const key = cleanText(
    clip.path ||
      clip.media_path ||
      clip.local_path ||
      clip.local_materialized_path ||
      clip.source_url ||
      clip.url ||
      clip.id,
  );
  return normalisePathKey(key);
}

function renderStoryVisualUnits(renderStory = {}) {
  const seen = new Set();
  const units = [];
  for (const clip of [
    ...asArray(renderStory.video_clips),
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.clips),
  ]) {
    const key = visualUnitKey(clip);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    units.push(clip);
  }
  return units;
}

function finalRenderVisualReuseEvidence({ renderManifest = {}, renderStory = {} } = {}) {
  const finalClipCount = firstNumber(
    renderManifest.clips,
    renderManifest.clip_count,
    renderManifest.scene_count,
    renderManifest.final_scene_count,
  );
  const uniqueVisualUnitCount = renderStoryVisualUnits(renderStory).length;
  const ratio = finalClipCount && uniqueVisualUnitCount
    ? Number((finalClipCount / uniqueVisualUnitCount).toFixed(3))
    : null;
  const evidence = {
    final_render_clip_count: finalClipCount,
    final_render_unique_visual_unit_count: uniqueVisualUnitCount || null,
    final_render_visual_reuse_ratio: ratio,
  };
  if (
    renderManifest.final_publish_render === true &&
    finalClipCount != null &&
    uniqueVisualUnitCount > 0 &&
    finalClipCount >= MIN_FINAL_RENDER_REUSE_CLIPS &&
    ratio > MAX_FINAL_RENDER_VISUAL_REUSE_RATIO
  ) {
    return {
      evidence,
      blockers: ["visual_evidence:final_render_reuses_visual_units"],
    };
  }
  return { evidence, blockers: [] };
}

function hyperframesCardClipLike(clip) {
  if (typeof clip === "string") return /hyperframes|proof[_-]?card|source[_-]?card|card/i.test(clip);
  const text = [
    clip.id,
    clip.path,
    clip.media_path,
    clip.source_type,
    clip.media_kind,
    clip.source_kind,
    clip.source_family,
    clip.motion_family,
    clip.visual_family,
    clip.kind,
    clip.type,
  ].map(cleanText).join(" ").toLowerCase();
  return /hyperframes|proof[_-]?card|source[_-]?card|context[_-]?card|timeline[_-]?card|quote[_-]?card|takeaway[_-]?card|generated[_-]?motion/.test(text);
}

function explicitCardDwellClipLike(clip) {
  if (typeof clip === "string") return /hyperframes|proof[_-]?card|source[_-]?card|card/i.test(clip);
  if (/owned[_-]?explainer[_-]?motion/i.test(cleanText(clip.media_kind || clip.source_type || clip.source_kind))) {
    return false;
  }
  const text = [
    clip.id,
    clip.path,
    clip.media_path,
    clip.source_type,
    clip.media_kind,
    clip.kind,
    clip.type,
  ].map(cleanText).join(" ").toLowerCase();
  return /hyperframes|proof[_-]?card|source[_-]?card|context[_-]?card|timeline[_-]?card|quote[_-]?card|takeaway[_-]?card|\bcard\b/.test(text);
}

function hyperframesCardClips(renderStory = {}) {
  return renderStoryVisualUnits(renderStory).filter(hyperframesCardClipLike);
}

function hyperframesCardClipCount(renderStory = {}) {
  return hyperframesCardClips(renderStory).length;
}

function clipDurationSeconds(clip = {}) {
  if (!clip || typeof clip !== "object") return null;
  return firstNumber(
    clip.duration_s,
    clip.durationS,
    clip.duration,
    clip.visible_duration_s,
    clip.visibleDurationS,
    clip.provenance?.duration_s,
    clip.provenance?.segment_render_duration_s,
    clip.provenance?.segment_recommended_duration_s,
    clip.provenance?.segment_original_duration_s,
  );
}

function cardReadableText(value = {}) {
  if (!value || typeof value !== "object") return "";
  return cleanText([
    value.text,
    value.copy,
    value.headline,
    value.title,
    value.primary_text,
    value.secondary_text,
    value.label,
    value.detail,
    value.metric,
    value.source,
    value.id,
  ].filter(Boolean).join(" "));
}

function sourceCardLike(value = {}) {
  if (typeof value === "string") {
    return (
      /(?:^|[_\s-])source$/i.test(value) ||
      /(?:^|[_\s-])source[_\s-](?:lock|card)(?:$|[_\s-])/i.test(value)
    );
  }
  if (!value || typeof value !== "object") return false;
  const fields = [
    value.id,
    value.kind,
    value.type,
    value.media_kind,
    value.source_type,
    value.source_kind,
    value.readable_card_kind,
    value.readableCardKind,
    value.card_kind,
    value.cardKind,
  ].map((item) => cleanText(item).toLowerCase()).filter(Boolean);
  return fields.some((field) => {
    const key = field.replace(/[\s-]+/g, "_");
    return (
      key === "source" ||
      /(?:^|_)source_(?:lock|card)(?:$|_)/.test(key) ||
      /(?:^|_)source$/.test(key) ||
      /(?:^|_)card\.source(?:$|_)/.test(key)
    );
  });
}

function compactProofOverlayLike(value = {}) {
  if (!value || typeof value !== "object") return false;
  const presentation = cleanText(
    value.presentation_mode || value.presentationMode || value.display_mode || value.displayMode,
  ).toLowerCase();
  if (presentation === "compact_proof_overlay") return true;
  const id = cleanText(value.id).toLowerCase();
  const source = cleanText(value.source || value.evidence_source).toLowerCase();
  return source === "studio_v4_overlay_chain" && /^(?:proof_primary|proof_secondary)$/.test(id);
}

function compactHeadlineOverlayLike(value = {}) {
  if (!value || typeof value !== "object") return false;
  const presentation = cleanText(
    value.presentation_mode || value.presentationMode || value.display_mode || value.displayMode,
  ).toLowerCase();
  if (presentation === "compact_headline_overlay") return true;
  const id = cleanText(value.id).toLowerCase();
  const source = cleanText(value.source || value.evidence_source).toLowerCase();
  return source === "studio_v4_overlay_chain" && id === "headline_card";
}

function compactHeadlineOverlayDurationRequiredS(value = {}) {
  const text = cleanText(value.text || value.headline || value.label || value.detail);
  if (!text) return 4;
  const words = text.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(text) ? 0.25 : 0;
  return Number(Math.min(5.8, Math.max(4, Math.ceil((0.34 * words + 2.8 + longTokenPenalty) * 10) / 10)).toFixed(1));
}

function compactProofOverlayDurationRequiredS(value = {}) {
  const text = cleanText(value.text || value.label || value.detail);
  if (!text) return MIN_COMPACT_PROOF_OVERLAY_DURATION_S;
  const words = text.split(/\s+/).filter(Boolean).length;
  const computed = Math.max(MIN_COMPACT_PROOF_OVERLAY_DURATION_S, 0.22 * words + 1.8);
  return Number(
    Math.min(MAX_COMPACT_PROOF_OVERLAY_DURATION_S, Math.ceil(computed * 10) / 10).toFixed(1),
  );
}

function readableCardDurationRequiredS(value = {}) {
  const explicitMinimum = firstNumber(
    value.minimum_required_duration_s,
    value.minimumRequiredDurationS,
    value.minimum_readable_duration_s,
    value.minimumReadableDurationS,
    value.minimum_visible_duration_s,
    value.minimumVisibleDurationS,
  );
  if (explicitMinimum != null && explicitMinimum > 0) return explicitMinimum;
  if (sourceCardLike(value)) return MIN_HYPERFRAMES_SOURCE_CARD_DURATION_S;
  if (compactProofOverlayLike(value)) return compactProofOverlayDurationRequiredS(value);
  if (compactHeadlineOverlayLike(value)) return compactHeadlineOverlayDurationRequiredS(value);
  const text = cardReadableText(value);
  if (!text) return MIN_HYPERFRAMES_READABLE_CARD_DURATION_S;
  const words = text.split(/\s+/).filter(Boolean).length;
  const longTokenPenalty = /\b[A-Z0-9]{6,}\b/.test(text) ? 0.5 : 0;
  const computed = Math.max(
    MIN_HYPERFRAMES_READABLE_CARD_DURATION_S,
    1.05 * words + 1.2 + longTokenPenalty,
  );
  return Number(Math.min(MAX_HYPERFRAMES_READABLE_CARD_DURATION_S, Math.ceil(computed * 10) / 10).toFixed(1));
}

function sourceCardDurationAllowedS(value = {}) {
  if (!sourceCardLike(value)) return null;
  return MAX_HYPERFRAMES_SOURCE_CARD_DURATION_S;
}

function tooFastHyperframesCardClipEvidence(renderStory = {}) {
  return hyperframesCardClips(renderStory)
    .map((clip) => ({
      id: cleanText(clip.id || clip.path || clip.media_path || "hyperframes_card"),
      path: cleanText(clip.path || clip.media_path || clip.local_path),
      source_type: cleanText(clip.source_type || clip.media_kind || clip.source_kind),
      source_family: cleanText(clip.source_family || clip.motion_family || clip.visual_family),
      text: cardReadableText(clip),
      duration_s: clipDurationSeconds(clip),
      minimum_required_duration_s: readableCardDurationRequiredS(clip),
    }))
    .filter((clip) => clip.duration_s != null && clip.duration_s < clip.minimum_required_duration_s);
}

function tooSlowSourceCardClipEvidence(renderStory = {}) {
  return hyperframesCardClips(renderStory)
    .filter(sourceCardLike)
    .map((clip) => ({
      id: cleanText(clip.id || clip.path || clip.media_path || "source_card"),
      path: cleanText(clip.path || clip.media_path || clip.local_path),
      source_type: cleanText(clip.source_type || clip.media_kind || clip.source_kind),
      source_family: cleanText(clip.source_family || clip.motion_family || clip.visual_family),
      text: cardReadableText(clip),
      duration_s: clipDurationSeconds(clip),
      minimum_required_duration_s: readableCardDurationRequiredS(clip),
      maximum_allowed_duration_s: sourceCardDurationAllowedS(clip),
    }))
    .filter((clip) => clip.duration_s != null && clip.maximum_allowed_duration_s != null)
    .filter((clip) => clip.duration_s > clip.maximum_allowed_duration_s);
}

function missingDurationHyperframesCardClipEvidence(renderStory = {}, { includeGeneratedMotion = false } = {}) {
  return hyperframesCardClips(renderStory)
    .filter((clip) => includeGeneratedMotion || explicitCardDwellClipLike(clip))
    .map((clip) => ({
      id: cleanText(clip.id || clip.path || clip.media_path || "hyperframes_card"),
      path: cleanText(clip.path || clip.media_path || clip.local_path),
      source_type: cleanText(clip.source_type || clip.media_kind || clip.source_kind),
      source_family: cleanText(clip.source_family || clip.motion_family || clip.visual_family),
      text: cardReadableText(clip),
      duration_s: clipDurationSeconds(clip),
      minimum_required_duration_s: readableCardDurationRequiredS(clip),
    }))
    .filter((clip) => clip.duration_s == null);
}

function hyperframesRepeatedCardFamilyEvidence(renderStory = {}) {
  const counts = new Map();
  for (const clip of hyperframesCardClips(renderStory)) {
    const family = cleanText(
      clip.source_family ||
        clip.motion_family ||
        clip.visual_family ||
        clip.family ||
        clip.kind ||
        clip.type,
    )
      .toLowerCase()
      .replace(/\\/g, "/")
      .replace(/(?:[_/-](?:card|window|clip|segment)[_/-]?\d+(?:[_/-]\d+)?)$/i, "");
    if (!family) continue;
    counts.set(family, (counts.get(family) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count || a.family.localeCompare(b.family));
}

function cardLikeDirectorShot(shot = {}) {
  const kind = cleanText(shot.kind || shot.type || shot.id).toLowerCase();
  return (
    kind.includes("card") ||
    kind === "source_lock" ||
    kind === "steam_chart" ||
    kind === "price_snap" ||
    kind === "review_score_card"
  );
}

function renderVisibleCardWindowEvidence(renderManifest = {}) {
  const seen = new Set();
  const windows = [
    ...asArray(renderManifest.card_visible_windows),
    ...asArray(renderManifest.rendered_card_windows),
    ...asArray(renderManifest.visible_card_windows),
    ...asArray(renderManifest.clip_scene_plan?.card_visible_windows),
    ...asArray(renderManifest.clip_scene_plan?.cardVisibleWindows),
    ...asArray(renderManifest.clipScenePlan?.card_visible_windows),
    ...asArray(renderManifest.clipScenePlan?.cardVisibleWindows),
    ...asArray(renderManifest.overlay_card_windows),
  ];
  return windows
    .map((window) => {
      const mapped = {
      id: cleanText(window.id || window.kind || window.label),
      kind: cleanText(window.kind || window.type),
      start_s: firstNumber(window.start_s, window.startS, window.start),
      end_s: firstNumber(window.end_s, window.endS, window.end),
      duration_s: firstNumber(window.duration_s, window.durationS, window.duration),
      text: cardReadableText(window),
      minimum_required_duration_s: readableCardDurationRequiredS(window),
      maximum_allowed_duration_s: sourceCardDurationAllowedS(window),
      source: cleanText(window.source || window.evidence_source),
      ...(cleanText(
        window.presentation_mode || window.presentationMode || window.display_mode || window.displayMode,
      )
        ? {
          presentation_mode: cleanText(
            window.presentation_mode || window.presentationMode || window.display_mode || window.displayMode,
          ),
        }
        : {}),
      };
      return mapped;
    })
    .filter((window) => window.duration_s != null)
    .filter((window) => {
      const key = [
        window.id,
        window.kind,
        window.start_s,
        window.end_s,
        window.duration_s,
        window.text,
      ].join("|").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function hyperframesReadableDwellEvidence({ renderManifest = {}, renderStory = {}, directorBeatMap = {} } = {}) {
  const finalClipCount = firstNumber(
    renderManifest.clips,
    renderManifest.clip_count,
    renderManifest.scene_count,
    renderManifest.final_scene_count,
  );
  const renderedDuration = firstNumber(
    renderManifest.rendered_duration_s,
    renderManifest.duration_s,
    renderManifest.video_duration_s,
  );
  const manifestCardCount = hyperframesCardCount({
    ...renderManifest,
    render_manifest: renderManifest,
  });
  const renderStoryCardCount = hyperframesCardClipCount(renderStory);
  const cardCount = Math.max(manifestCardCount, renderStoryCardCount);
  const explicitPremiumHyperframes = declaresHyperframesPremium({
    ...renderManifest,
    render_manifest: renderManifest,
  });
  const declaresHyperframes = explicitPremiumHyperframes || cardCount > 0;
  const estimatedCardDuration = renderedDuration && finalClipCount
    ? Number((renderedDuration / finalClipCount).toFixed(3))
    : null;
  const directorCardShots = asArray(directorBeatMap.shot_plan)
    .filter(cardLikeDirectorShot)
    .map((shot) => ({
      id: cleanText(shot.id || shot.kind || shot.label),
      kind: cleanText(shot.kind || shot.type),
      duration_s: firstNumber(shot.durationS, shot.duration_s, shot.duration),
      text: cardReadableText(shot),
      minimum_required_duration_s: readableCardDurationRequiredS(shot),
      maximum_allowed_duration_s: sourceCardDurationAllowedS(shot),
    }));
  const tooFastCardShots = directorCardShots
    .filter((shot) => shot.duration_s != null && shot.duration_s < shot.minimum_required_duration_s);
  const visibleCardWindows = renderVisibleCardWindowEvidence(renderManifest);
  const tooFastVisibleCardWindows = visibleCardWindows
    .filter((window) => window.duration_s < window.minimum_required_duration_s);
  const tooFastCardClips = tooFastHyperframesCardClipEvidence(renderStory);
  const tooSlowSourceCardClips = tooSlowSourceCardClipEvidence(renderStory);
  const missingDurationCardClips = visibleCardWindows.length
    ? []
    : missingDurationHyperframesCardClipEvidence(renderStory, { includeGeneratedMotion: explicitPremiumHyperframes });
  const repeatedCardFamilies = hyperframesRepeatedCardFamilyEvidence(renderStory);
  const directorTooFastShots = visibleCardWindows.length ? [] : tooFastCardShots;
  const tooSlowSourceCardWindows = visibleCardWindows
    .filter((window) => window.maximum_allowed_duration_s != null)
    .filter((window) => window.duration_s > window.maximum_allowed_duration_s);
  const tooSlowSourceCardShots = visibleCardWindows.length
    ? []
    : directorCardShots
      .filter(sourceCardLike)
      .filter((shot) => shot.duration_s != null && shot.maximum_allowed_duration_s != null)
      .filter((shot) => shot.duration_s > shot.maximum_allowed_duration_s);
  const blockers = [];
  if (
    declaresHyperframes &&
    cardCount > 0 &&
    !visibleCardWindows.length &&
    estimatedCardDuration != null &&
    estimatedCardDuration < MIN_HYPERFRAMES_READABLE_CARD_DURATION_S
  ) {
    blockers.push("hyperframes:card_visible_dwell_too_short");
  }
  if (visibleCardWindows.length && tooFastVisibleCardWindows.length) {
    blockers.push("hyperframes:rendered_card_window_dwell_too_short");
  } else if (!visibleCardWindows.length && declaresHyperframes && tooFastCardShots.length) {
    blockers.push(
      "hyperframes:director_card_dwell_too_short",
    );
  }
  if (tooFastCardClips.length) {
    blockers.push("hyperframes:card_clip_dwell_too_short");
    blockers.push("visual_evidence:card_visible_dwell_too_short");
  }
  if (tooSlowSourceCardWindows.length || tooSlowSourceCardClips.length || tooSlowSourceCardShots.length) {
    blockers.push("hyperframes:source_card_dwell_too_long");
    blockers.push("visual_evidence:source_card_dwell_too_long");
  }
  if (missingDurationCardClips.length) {
    blockers.push("hyperframes:card_clip_dwell_missing");
    blockers.push("visual_evidence:card_visible_dwell_missing");
  }
  if (tooFastVisibleCardWindows.length) {
    blockers.push("visual_evidence:card_visible_dwell_too_short");
  }
  if (directorTooFastShots.length) {
    blockers.push("visual_evidence:director_card_dwell_too_short");
  }
  if (repeatedCardFamilies.length) {
    blockers.push("hyperframes:repeated_card_family");
    blockers.push("visual_evidence:repeated_card_family");
  }
  return {
    evidence: {
      minimum_readable_card_duration_s: MIN_HYPERFRAMES_READABLE_CARD_DURATION_S,
      hyperframes_card_count: cardCount,
      hyperframes_estimated_card_visible_duration_s: estimatedCardDuration,
      hyperframes_too_fast_card_shots: tooFastCardShots,
      hyperframes_effective_too_fast_card_shots: directorTooFastShots,
      hyperframes_too_fast_card_clips: tooFastCardClips,
      hyperframes_too_slow_source_card_clips: tooSlowSourceCardClips,
      hyperframes_too_slow_source_card_windows: tooSlowSourceCardWindows,
      hyperframes_too_slow_source_card_shots: tooSlowSourceCardShots,
      hyperframes_missing_duration_card_clips: missingDurationCardClips,
      hyperframes_repeated_card_families: repeatedCardFamilies,
      rendered_card_window_count: visibleCardWindows.length,
      rendered_card_windows: visibleCardWindows,
      rendered_too_fast_card_windows: tooFastVisibleCardWindows,
    },
    blockers,
  };
}

function clipScenePlanVisualCadenceEvidence(renderManifest = {}) {
  const plan = renderManifest?.clip_scene_plan || renderManifest?.clipScenePlan || {};
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { evidence: { clip_scene_plan_present: false }, blockers: [] };
  }
  const repeatedBaseSources = [
    ...asArray(plan.repeated_base_sources),
    ...asArray(plan.repeatedBaseSources),
  ];
  const repeatedReadableCardKinds = [
    ...asArray(plan.repeated_readable_card_kinds),
    ...asArray(plan.repeatedReadableCardKinds),
  ];
  const concentratedMotionSources = [
    ...asArray(plan.direct_motion_source_concentration_metrics?.concentrated_sources),
    ...asArray(plan.directMotionSourceConcentrationMetrics?.concentrated_sources),
  ];
  const visibleCardWindows = renderVisibleCardWindowEvidence({
    ...renderManifest,
    clip_scene_plan: plan,
  });
  const tooFastVisibleCardWindows = visibleCardWindows
    .filter((window) => window.duration_s != null && window.duration_s < window.minimum_required_duration_s);
  const blockers = uniqueCleanStrings([
    ...asArray(plan.blockers).map((blocker) =>
      /^visual_evidence:/i.test(cleanText(blocker)) ? cleanText(blocker) : `visual_evidence:${cleanText(blocker)}`,
    ),
    (plan.repeat_free === false || plan.repeatFree === false) ? "visual_evidence:clip_scene_plan_not_repeat_free" : "",
    repeatedBaseSources.length ? "visual_evidence:direct_motion_base_source_repeated" : "",
    concentratedMotionSources.length ? "visual_evidence:direct_motion_source_concentration_above_premium_floor" : "",
    repeatedReadableCardKinds.length ? "visual_evidence:readable_card_kind_repeated" : "",
    tooFastVisibleCardWindows.length ? "visual_evidence:card_visible_window_below_readable_floor" : "",
  ]);
  return {
    evidence: {
      clip_scene_plan_present: true,
      clip_scene_plan_repeat_free: plan.repeat_free ?? plan.repeatFree ?? null,
      clip_scene_plan_scene_count: asArray(plan.scenes).length,
      clip_scene_plan_blockers: asArray(plan.blockers).map(cleanText).filter(Boolean),
      clip_scene_plan_repeated_base_sources: repeatedBaseSources,
      clip_scene_plan_concentrated_motion_sources: concentratedMotionSources,
      clip_scene_plan_repeated_readable_card_kinds: repeatedReadableCardKinds,
      clip_scene_plan_too_fast_card_windows: tooFastVisibleCardWindows,
    },
    blockers,
  };
}

function stripWindowSuffix(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "")
    .replace(/(?:[_/-]window[_/-]\d+(?:[_/-]\d+)?)$/i, "")
    .replace(/(?:[_/-]clip[_/-]\d+)$/i, "")
    .replace(/(?:[_/-]segment[_/-]\d+)$/i, "");
}

function officialWindowedDirectMotionFamily(clip = {}) {
  const family = cleanText(
    clip.source_family ||
      clip.motion_family ||
      clip.base_source_family ||
      clip.original_source_family,
  );
  if (!/(?:^|[_/-])window[_/-]?\d+/i.test(family)) return "";
  const text = [
    family,
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
  if (/generated|owned_generated|pulse-generated|rss_story_v4_clip/i.test(text)) return "";
  if (
    /\b(?:official_trailer_segment|official_game_website_media_page|official_social_media_video|licensed_direct_media)\b/i.test(text)
  ) {
    return stripWindowSuffix(family);
  }
  return "";
}

function directMotionBaseSourceKey(clip = {}) {
  if (!directMotionClipLike(clip)) return "";
  const windowedOfficialFamily = officialWindowedDirectMotionFamily(clip);
  if (windowedOfficialFamily) return `family:${windowedOfficialFamily}`;
  const explicitRaw = cleanText(
    clip.base_source_family ||
    clip.original_source_family ||
    clip.provenance?.base_source_family ||
    clip.provenance?.source_family ||
    clip.source_family ||
    clip.motion_family,
  );
  const explicitRawKey = explicitRaw.toLowerCase().replace(/\\/g, "/").replace(/[?#].*$/, "");
  const explicitFamily = stripWindowSuffix(explicitRaw);
  const sourceKey = sourceUrlFamilyKey(
    clip.source_url ||
      clip.url ||
      clip.original_source_url ||
      clip.source ||
      clip.reference_url,
  );
  const explicitSteamTrailerKey = steamTrailerAssetKeyFromText(explicitRaw);
  if (sourceKey.startsWith("steam-trailer:")) return sourceKey;
  if (explicitSteamTrailerKey) return explicitSteamTrailerKey;
  const strippedSourceKey = stripWindowSuffix(sourceKey.replace(/^url:/, ""));
  if (explicitFamily && explicitFamily !== explicitRawKey) {
    if (strippedSourceKey && explicitFamily.includes(strippedSourceKey)) {
      return `url:${strippedSourceKey}`;
    }
    return `family:${explicitFamily}`;
  }
  if (sourceKey) return stripWindowSuffix(sourceKey);
  if (explicitFamily) return `family:${explicitFamily}`;
  const clipPath = stripWindowSuffix(clip.path || clip.media_path || clip.local_path || clip.id);
  return clipPath ? `path:${clipPath}` : "";
}

function directMotionBaseSourceOveruseEvidence(clips = []) {
  const seenClipKeys = new Set();
  const directClips = [];
  for (const clip of asArray(clips)) {
    if (!directMotionClipLike(clip)) continue;
    const clipKey = visualUnitKey(clip) || cleanText(clip.id);
    if (clipKey && seenClipKeys.has(clipKey)) continue;
    if (clipKey) seenClipKeys.add(clipKey);
    directClips.push(clip);
  }
  const total = directClips.length;
  const counts = new Map();
  for (const clip of directClips) {
    const key = directMotionBaseSourceKey(clip);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const overused = [...counts.entries()]
    .map(([key, count]) => ({
      key,
      count,
      total,
      share: total ? Number((count / total).toFixed(3)) : 0,
    }))
    .filter(
      (entry) =>
        entry.count > MAX_DIRECT_MOTION_BASE_SOURCE_CLIPS ||
        (entry.count > 1 && entry.share > MAX_DIRECT_MOTION_BASE_SOURCE_SHARE),
    )
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return {
    evidence: {
      direct_motion_base_source_overuse: overused,
      direct_motion_base_source_overuse_max_clips: MAX_DIRECT_MOTION_BASE_SOURCE_CLIPS,
      direct_motion_base_source_overuse_max_share: MAX_DIRECT_MOTION_BASE_SOURCE_SHARE,
    },
    blockers: overused.length ? ["visual_evidence:direct_motion_base_source_overused"] : [],
  };
}

const DIRECT_MOTION_SUBJECT_ENTITY_PATTERNS = [
  {
    id: "forza_horizon",
    label: "Forza Horizon",
    patterns: [
      /\bforza[\s_-]*horizon\b/i,
      /\bfh\s*6\b/i,
      /\bfh6\b/i,
    ],
  },
  {
    id: "grand_theft_auto",
    label: "GTA VI",
    patterns: [
      /\bgrand[\s_-]*theft[\s_-]*auto\b/i,
      /\bgta\s*(?:6|vi|six)\b/i,
      /\bgta(?:6|vi)\b/i,
    ],
  },
  { id: "halo", label: "Halo", patterns: [/\bhalo\b/i] },
  { id: "doom", label: "DOOM", patterns: [/\bdoom\b/i] },
  { id: "dune_awakening", label: "Dune Awakening", patterns: [/\bdune[\s_-]*awakening\b/i] },
  { id: "fable", label: "Fable", patterns: [/\bfable\b/i] },
  { id: "sea_of_thieves", label: "Sea of Thieves", patterns: [/\bsea[\s_-]*of[\s_-]*thieves\b/i] },
  { id: "marvel_tokon", label: "MARVEL Tokon", patterns: [/\bmarvel[\s_-]*tokon\b/i, /\btokon\b/i] },
  { id: "call_of_duty", label: "Call of Duty", patterns: [/\bcall[\s_-]*of[\s_-]*duty\b/i, /\bblack[\s_-]*ops\b/i] },
  { id: "minecraft", label: "Minecraft", patterns: [/\bminecraft\b/i] },
  { id: "avatar_legends", label: "Avatar Legends", patterns: [/\bavatar[\s_-]*legends\b/i] },
  {
    id: "microsoft_flight_simulator",
    label: "Microsoft Flight Simulator",
    patterns: [/\bmicrosoft[\s_-]*flight[\s_-]*simulator\b/i, /\bflight[\s_-]*simulator\b/i],
  },
  { id: "the_crew_motorfest", label: "The Crew Motorfest", patterns: [/\bcrew[\s_-]*motorfest\b/i] },
];

function directMotionSubjectText({ story = {}, action = {}, renderManifest = {}, renderStory = {} } = {}) {
  return cleanText([
    story.title,
    story.selected_title,
    story.canonical_title,
    story.canonical_subject,
    story.canonical_game,
    story.game_title,
    story.narration_script,
    story.tts_script,
    story.full_script,
    story.primary_source_title,
    story.claim,
    action.title,
    action.story_title,
    action.canonical_subject,
    renderManifest.title,
    renderManifest.selected_title,
    renderManifest.canonical_subject,
    renderManifest.canonical_game,
    renderStory.title,
    renderStory.selected_title,
    renderStory.canonical_subject,
    renderStory.canonical_game,
  ].filter(Boolean).join(" "));
}

function detectDirectMotionSubjectEntities(text = "") {
  const haystack = cleanText(text).replace(/[_-]+/g, " ");
  if (!haystack) return [];
  return DIRECT_MOTION_SUBJECT_ENTITY_PATTERNS
    .filter((entity) => entity.patterns.some((pattern) => pattern.test(haystack)))
    .map((entity) => ({ id: entity.id, label: entity.label }));
}

function directMotionClipSubjectText(clip = {}) {
  return cleanText([
    clip.id,
    clip.title,
    clip.name,
    clip.game_title,
    clip.entity,
    clip.canonical_subject,
    clip.source_family,
    clip.motion_family,
    clip.base_source_family,
    clip.original_source_family,
    clip.source_url,
    clip.original_source_url,
    clip.url,
    clip.source,
    clip.reference_url,
    clip.path,
    clip.media_path,
    clip.local_path,
    clip.provenance?.source_family,
    clip.provenance?.base_source_family,
    clip.provenance?.source_url,
    clip.provenance?.title,
    clip.provenance?.label,
  ].filter(Boolean).join(" "));
}

function directMotionSubjectMismatchEvidence(clips = [], context = {}) {
  const storyText = directMotionSubjectText(context);
  const storyEntityIds = new Set(detectDirectMotionSubjectEntities(storyText).map((entity) => entity.id));
  const seenClipKeys = new Set();
  const mismatches = [];
  for (const clip of asArray(clips)) {
    if (!directMotionClipLike(clip)) continue;
    const clipKey = visualUnitKey(clip) || cleanText(clip.id);
    if (clipKey && seenClipKeys.has(clipKey)) continue;
    if (clipKey) seenClipKeys.add(clipKey);
    const clipText = directMotionClipSubjectText(clip);
    const clipEntities = detectDirectMotionSubjectEntities(clipText);
    const missingEntities = clipEntities.filter((entity) => !storyEntityIds.has(entity.id));
    if (!missingEntities.length) continue;
    mismatches.push({
      clip_id: cleanText(clip.id) || null,
      path: cleanText(clip.path || clip.media_path || clip.local_path) || null,
      source_family: cleanText(clip.source_family || clip.motion_family || clip.base_source_family) || null,
      source_url: cleanText(clip.source_url || clip.original_source_url || clip.url) || null,
      detected_entities: missingEntities.map((entity) => entity.label),
    });
  }
  return {
    evidence: {
      direct_motion_subject_mismatch_count: mismatches.length,
      direct_motion_subject_mismatches: mismatches,
      direct_motion_subject_match_policy: "specific_game_or_franchise_in_motion_must_appear_in_story_subject",
    },
    blockers: mismatches.length ? ["visual_evidence:direct_motion_subject_mismatch"] : [],
  };
}

function narrationManifestBlockers(narrationManifest = null, audioManifest = {}) {
  if (!manifestObjectPresent(narrationManifest)) {
    return audioManifestProvidesNarration(audioManifest) ? [] : ["narration_manifest_missing"];
  }
  const blockers = [];
  if (!manifestReadyStatus(narrationManifest)) blockers.push("narration_manifest_not_ready");
  const transcript = cleanText(
    narrationManifest.transcript ||
      narrationManifest.final_transcript ||
      narrationManifest.tts_script ||
      narrationManifest.spoken_script,
  );
  const audioPath = cleanText(
    narrationManifest.audio_path ||
      narrationManifest.final_audio_path ||
      narrationManifest.narration_audio_path,
  );
  if (transcript.split(/\s+/).filter(Boolean).length < 3) {
    blockers.push("narration_manifest_transcript_missing");
  }
  if (!audioPath) blockers.push("narration_manifest_audio_path_missing");
  const narrationGeneratedAt = timeMs(
    narrationManifest.generated_at ||
      narrationManifest.generatedAt ||
      narrationManifest.materialized_at,
  );
  const audioGeneratedAt = timeMs(
    audioManifest.materialized_at ||
      audioManifest.materializedAt ||
      audioManifest.audio_materialized_at ||
      audioManifest.generated_at,
  );
  if (narrationGeneratedAt && audioGeneratedAt && narrationGeneratedAt < audioGeneratedAt) {
    blockers.push("narration_manifest_stale_after_audio");
  }
  const narrationWordCount = numberOrNull(narrationManifest.word_timestamp_count);
  const audioWordCount = numberOrNull(audioManifest.word_timestamp_count);
  if (narrationWordCount != null && audioWordCount != null && narrationWordCount !== audioWordCount) {
    blockers.push("narration_manifest_word_count_mismatch");
  }
  return blockers;
}

function scriptScorecardBlockers({ canonical = {}, scriptScorecard = null } = {}) {
  const blockers = [];
  if (!manifestObjectPresent(scriptScorecard)) blockers.push("script_scorecard_missing");
  else {
    for (const blocker of asArray(scriptScorecard.blockers)) {
      blockers.push(`script_scorecard:${cleanText(blocker)}`);
    }
    const score = numberOrNull(scriptScorecard.viral_score || scriptScorecard.score);
    if (score != null && score < 75) blockers.push("script_scorecard:script_score_below_threshold");
    const verdict = cleanText(scriptScorecard.verdict || scriptScorecard.status).toLowerCase();
    if (verdict === "rewrite_required") blockers.push("script_scorecard:script_verdict_rewrite_required");
    if (verdict === "tighten_before_tts") blockers.push("script_scorecard:script_verdict_tighten_before_tts");
  }

  const script = cleanText(canonical.narration_script || canonical.full_script || canonical.tts_script);
  if (script) {
    const fresh = buildViralScriptIntelligence({
      story: {
        id: canonical.story_id,
        title: canonical.selected_title || canonical.short_title || canonical.canonical_title,
        source_name: canonical.primary_source?.name || canonical.source_card_label || canonical.official_source,
      },
      script,
    });
    for (const blocker of asArray(fresh.blockers)) {
      blockers.push(`script_scorecard:${cleanText(blocker)}`);
    }
    if (Number(fresh.viral_score) < 75) blockers.push("script_scorecard:script_score_below_threshold");
    if (fresh.verdict === "rewrite_required") blockers.push("script_scorecard:script_verdict_rewrite_required");
  }
  return [...new Set(blockers.filter(Boolean))];
}

async function narrationReady(artifactDir, narrationManifest = {}, audioManifest = {}, fallbackTranscript = "") {
  const hasNarrationManifest = manifestObjectPresent(narrationManifest);
  if (
    !artifactDir ||
    !manifestReadyStatus(audioManifest) ||
    (
      hasNarrationManifest
        ? !manifestReadyStatus(narrationManifest)
        : !audioManifestProvidesNarration(audioManifest)
    )
  ) {
    return false;
  }
  const transcript = cleanText(
    narrationManifest.transcript ||
      narrationManifest.final_transcript ||
      fallbackTranscript,
  );
  const audioPath =
    narrationManifest.audio_path ||
    narrationManifest.final_audio_path ||
    narrationManifest.narration_audio_path ||
    audioManifestNarrationPath(audioManifest);
  if (transcript.split(/\s+/).filter(Boolean).length < 3) return false;
  return referencedFileReady(artifactDir, audioPath, 100);
}

function timestampEntries(timestamps = {}) {
  if (Array.isArray(timestamps)) return timestamps;
  return asArray(
    timestamps.words ||
      timestamps.word_timestamps ||
      timestamps.timestamps ||
      timestamps.alignment?.words,
  );
}

function wordTimestampsReady(timestamps = {}) {
  const entries = Array.isArray(timestamps)
    ? timestamps
    : timestampEntries(timestamps);
  if (!entries.length) return false;
  return entries.some((entry) => {
    const word = cleanText(entry?.word || entry?.text || entry?.token);
    const start = numberOrNull(entry?.start ?? entry?.start_s ?? entry?.start_time);
    const end = numberOrNull(entry?.end ?? entry?.end_s ?? entry?.end_time);
    return word && start != null && end != null && end >= start;
  });
}

function wordTimestampSource(timestamps = {}) {
  return cleanText(
    timestamps?.meta?.wordTimestampSource ||
      timestamps?.meta?.word_timestamp_source ||
      timestamps?.wordTimestampSource ||
      timestamps?.word_timestamp_source,
  ).toLowerCase();
}

function timestampWordTranscript(timestamps = {}) {
  const entries = timestampEntries(timestamps);
  return cleanText(entries.map((entry) => entry?.word || entry?.text || entry?.token).join(" "));
}

function spokenKey(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function localWordTimestampReadiness({
  timestamps = {},
  audioManifest = {},
  narrationManifest = {},
  canonical = {},
} = {}) {
  if (!timestamps || typeof timestamps !== "object") return { blockers: [], evidence: {} };
  const source = wordTimestampSource(timestamps);
  const voiceProvider = cleanText(
    audioManifest.voice_provider ||
      audioManifest.provider ||
      narrationManifest.voice_provider ||
      narrationManifest.provider,
  ).toLowerCase();
  const localProvider = /^local(?:_|$)/.test(voiceProvider) || source.startsWith("local_");
  const whisperReady =
    source === "local_whisper_word_alignment" ||
    timestamps?.meta?.timestampWhisperAlignment?.repaired === true;
  const blockers = [];
  const evidence = source ? { word_timestamp_source: source } : {};
  if (localProvider && !whisperReady) {
    blockers.push("word_timestamps_not_asr_aligned");
    evidence.word_timestamp_alignment_required = "local_whisper_word_alignment";
  }

  const expected = spokenKey(
    timestamps?.meta?.transcript ||
      timestamps?.meta?.spoken_text ||
      canonical.narration_script ||
      canonical.tts_script ||
      canonical.full_script ||
      canonical.first_spoken_line,
  );
  const transcript = spokenKey(timestampWordTranscript(timestamps));
  const semanticIssues = [];
  if (/\bhades tattoo\b/.test(transcript) && /\bhades(?: ii| 2| part two| number two| two| sequel)\b/.test(expected)) {
    semanticIssues.push("hades_two_as_hades_tattoo");
  }
  if (/\bpauls? gaming\b/.test(transcript) && /\bpulse gaming\b/.test(expected)) {
    semanticIssues.push("pulse_gaming_as_pauls_gaming");
  }
  if (semanticIssues.length) {
    blockers.push("word_timestamps_semantic_misrecognition");
    evidence.word_timestamp_semantic_misrecognitions = semanticIssues;
    evidence.word_timestamp_word_transcript = timestampWordTranscript(timestamps);
  }

  return {
    blockers: [...new Set(blockers)],
    evidence,
  };
}

function selectBestWordTimestampCandidate(
  candidates = [],
  { audioManifest = {}, narrationManifest = {}, canonical = {} } = {},
) {
  const scored = candidates
    .map((candidate, index) => {
      const payload = candidate?.payload || {};
      const ready = wordTimestampsReady(payload);
      const readiness = localWordTimestampReadiness({
        timestamps: payload,
        audioManifest,
        narrationManifest,
        canonical,
      });
      const source = wordTimestampSource(payload);
      const asrAligned = source === "local_whisper_word_alignment" && ready;
      const clean = ready && readiness.blockers.length === 0;
      const score =
        (clean ? 1000 : 0) +
        (asrAligned ? 100 : 0) +
        (ready ? 10 : 0) -
        readiness.blockers.length;
      return { ...candidate, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.payload || null;
}

async function readBestWordTimestamps({
  artifactDir,
  directWordTimestamps = null,
  audioManifest = {},
  narrationManifest = {},
  canonical = {},
} = {}) {
  const candidates = [];
  if (directWordTimestamps && typeof directWordTimestamps === "object") {
    candidates.push({ filePath: path.join(artifactDir, "word_timestamps.json"), payload: directWordTimestamps });
  }
  candidates.push(...await readJsonReferenceCandidates(
    artifactDir,
    [
      narrationManifest.word_timestamps_path,
      narrationManifest.timestamps_path,
      narrationManifest.resolved_word_timestamps_path,
      audioManifest.word_timestamps_path,
      audioManifest.timestamps_path,
      audioManifest.resolved_word_timestamps_path,
    ],
  ));
  return selectBestWordTimestampCandidate(candidates, { audioManifest, narrationManifest, canonical });
}

function motionEvidence(ownedMotionManifest = {}, materialisedMotionClips = {}) {
  const clips = materialisedMotionEvidenceClips(ownedMotionManifest, materialisedMotionClips);
  const clipFamilies = motionReadinessFamilies(clips);
  const families = clipFamilies.size
    ? clipFamilies
    : new Set(asArray(ownedMotionManifest.distinct_motion_families).map(cleanText).filter(Boolean));
  return {
    materialised_motion_ready: manifestReadyStatus(ownedMotionManifest) && clips.length >= 3,
    distinct_motion_families_ready: families.size >= 3,
    materialised_motion_clip_count: clips.length,
    distinct_motion_family_count: families.size,
  };
}

function motionEvidenceFromRenderStory(renderStory = {}, directorBeatMap = {}) {
  const renderStoryClips = [
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.video_clips),
  ];
  const directorShotPlan = asArray(directorBeatMap.shot_plan);
  const directorMotionClips = directorShotPlan
    .filter((shot) => cleanText(shot.kind) === "motion_clip" || cleanText(shot.media_path))
    .map((shot) => ({
      path: shot.media_path,
      motion_family: shot.source_family || shot.family || shot.kind,
    }));
  const clips = [...renderStoryClips, ...directorMotionClips].map((clip) => {
    if (typeof clip === "string") {
      return {
        path: clip,
        motion_family: path.basename(clip, path.extname(clip)),
      };
    }
    return clip;
  });
  const families = motionReadinessFamilies(clips);
  const shotBudgetFamilies = Number(directorBeatMap.shot_budget?.available_distinct_motion_families);
  const shotBudgetClips = Number(directorBeatMap.shot_budget?.available_motion_clips);
  return {
    clips,
    families,
    shot_budget_clip_count: Number.isFinite(shotBudgetClips) ? shotBudgetClips : 0,
    shot_budget_family_count: Number.isFinite(shotBudgetFamilies) ? shotBudgetFamilies : 0,
  };
}

function rightsLedgerReady(rightsLedger = null) {
  if (!rightsLedger) return false;
  const records = Array.isArray(rightsLedger)
    ? rightsLedger
    : [
        ...asArray(rightsLedger.assets),
        ...asArray(rightsLedger.records),
        ...asArray(rightsLedger.rights_ledger),
      ];
  return records.length > 0;
}

function rightsLedgerRecords(rightsLedger = null) {
  if (!rightsLedger) return [];
  if (Array.isArray(rightsLedger)) return rightsLedger.filter(Boolean);
  if (typeof rightsLedger !== "object") return [];
  return [
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.rights_ledger),
  ];
}

function clipKeyValues(clip = {}) {
  return [
    clip.asset_id,
    clip.id,
    clip.path,
    clip.local_path,
    clip.local_materialized_path,
    clip.media_path,
    clip.source_url,
  ]
    .map(cleanText)
    .filter(Boolean)
    .map((value) => value.replace(/\\/g, "/").toLowerCase());
}

function recordCoversClip(record = {}, clip = {}) {
  const recordKeys = new Set(clipKeyValues(record));
  return clipKeyValues(clip).some((key) => recordKeys.has(key));
}

function ownedExplainerMotionReady({
  footageInventory = {},
  ownedMotionManifest = {},
  materialisedMotionClips = {},
  renderStory = {},
  rightsLedger = null,
} = {}) {
  const budget = footageInventory.motion_budget || {};
  const inventory = footageInventory.motion_inventory || {};
  const explicitPlan =
    budget.allow_owned_explainer_motion_only === true ||
    budget.owned_explainer_visual_plan === true ||
    inventory.owned_explainer_visual_plan === true ||
    ownedMotionManifest.owned_explainer_visual_plan === true ||
    materialisedMotionClips.owned_explainer_visual_plan === true;
  if (!explicitPlan) return false;
  const clips = [
    ...asArray(inventory.accepted_local_clips),
    ...asArray(inventory.production_motion_clips),
    ...asArray(ownedMotionManifest.materialised_clips),
    ...asArray(ownedMotionManifest.clips),
    ...asArray(materialisedMotionClips.clips),
    ...asArray(materialisedMotionClips.materialised_clips),
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.video_clips),
  ].filter((clip) => clip && typeof clip === "object");
  const ownedClips = clips.filter((clip) => {
    const text = [
      clip.source_type,
      clip.source_kind,
      clip.media_kind,
      clip.rights_risk_class,
      clip.licence_basis,
      clip.rights_basis,
      clip.source_url,
      clip.path,
    ]
      .map(cleanText)
      .join(" ")
      .toLowerCase();
    return (
      clip.owned_explainer_visual_plan === true ||
      text.includes("owned_explainer_motion") ||
      text.includes("owned_source_card_explainer_motion") ||
      text.includes("owned_generated_editorial_motion_graphic")
    );
  });
  const families = new Set(
    ownedClips
      .map((clip) => cleanText(clip.motion_family || clip.source_family || clip.visual_family || clip.family || clip.id))
      .filter(Boolean),
  );
  const records = rightsLedgerRecords(rightsLedger);
  const rightsCovered = ownedClips.every((clip) =>
    records.some((record) => {
      const rightsText = [
        record.licence_basis,
        record.license_basis,
        record.rights_basis,
        record.approval_status,
        record.asset_type,
        record.source_type,
      ]
        .map(cleanText)
        .join(" ")
        .toLowerCase();
      return (
        recordCoversClip(record, clip) &&
        rightsText.includes("owned_generated_editorial_motion_graphic") &&
        record.commercial_use_allowed !== false
      );
    }),
  );
  return ownedClips.length >= 5 && families.size >= 5 && rightsCovered;
}

function ownedExplainerExceptionApproved({
  canonical = {},
  renderManifest = {},
  storyPackage = {},
} = {}) {
  return Boolean(
    canonical.breaking_news_flag === true ||
      renderManifest.breaking_news_flag === true ||
      storyPackage.breaking_news_flag === true ||
      canonical.human_reviewed_owned_explainer_motion_exception === true ||
      canonical.owned_explainer_motion_exception_approved === true ||
      renderManifest.human_reviewed_owned_explainer_motion_exception === true ||
      renderManifest.owned_explainer_motion_exception_approved === true ||
      storyPackage.human_reviewed_owned_explainer_motion_exception === true ||
      storyPackage.owned_explainer_motion_exception_approved === true,
  );
}

function sourceNameValue(value) {
  if (value && typeof value === "object") return cleanText(value.name || value.source_name || value.label);
  return cleanText(value);
}

function sourceUrlValue(value) {
  if (value && typeof value === "object") return cleanText(value.url || value.source_url || value.href);
  return cleanText(value);
}

function sourceLooksEditoriallyVerified(canonical = {}) {
  const sourceName = sourceNameValue(canonical.primary_source || canonical.source_card_label || canonical.official_source);
  const sourceUrl =
    (canonical.primary_source && typeof canonical.primary_source === "object"
      ? sourceUrlValue(canonical.primary_source)
      : "") ||
    sourceUrlValue(canonical.primary_source_url || canonical.source_url || canonical.url);
  if (!sourceName || /reddit|unknown|source needed/i.test(sourceName)) return false;
  try {
    const parsed = new URL(sourceUrl);
    if (!/^https?:$/.test(parsed.protocol)) return false;
    if (/reddit\.com$/i.test(parsed.hostname.replace(/^www\./i, ""))) return false;
  } catch {
    return false;
  }
  return true;
}

function ownedExplainerPolicyApproved({ canonical = {}, footageInventory = {} } = {}) {
  const budget = footageInventory.motion_budget || {};
  const inventory = footageInventory.motion_inventory || {};
  const explicitOwnedExplainerPlan =
    budget.allow_owned_explainer_motion_only === true &&
    (budget.owned_explainer_visual_plan === true || inventory.owned_explainer_visual_plan === true);
  if (!explicitOwnedExplainerPlan) return false;
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.canonical_company);
  if (!subject || /^(?:this story|gaming story|story|news|update)$/i.test(subject)) return false;
  return sourceLooksEditoriallyVerified(canonical);
}

function sfxRenderAssetMismatch({ sfxManifest = {}, renderStory = {} } = {}) {
  const approvedAssets = new Set(
    [
      ...asArray(sfxManifest.selected_assets),
      ...asArray(sfxManifest.source_plan?.selected_assets),
      ...asArray(sfxManifest.sourcePlan?.selectedAssets),
    ]
      .map((asset) => cleanText(asset.asset_id || asset.id))
      .filter(Boolean),
  );
  const renderedAssets = [
    ...asArray(renderStory.sfx_asset_inventory),
    ...asArray(renderStory.sfx_assets),
    ...asArray(renderStory.selected_sfx_assets),
  ]
    .map((asset) => cleanText(asset.asset_id || asset.id))
    .filter(Boolean);

  const hasRenderedSfxEvidence =
    renderedAssets.length > 0 ||
    asArray(renderStory.sound_transition_plan?.sfx?.cues).length > 0 ||
    asArray(renderStory.sfx_plan?.cues).length > 0 ||
    asArray(renderStory.soundTransitionPlan?.sfx?.cues).length > 0;
  if (!approvedAssets.size || !hasRenderedSfxEvidence) return false;
  if (!renderedAssets.length) return true;
  return (
    renderedAssets.some((assetId) => !approvedAssets.has(assetId)) ||
    [...approvedAssets].some((assetId) => !renderedAssets.includes(assetId))
  );
}

const SFX_ROLE_BY_FAMILY = {
  boom: "sub_hit",
  cash_snap: "impact",
  chart_tick: "ui_tick",
  glitch: "glitch",
  impact: "impact",
  reveal: "riser",
  riser: "riser",
  source_tick: "ui_tick",
  sub_hit: "sub_hit",
  tick: "ui_tick",
  transition_hit: "transition",
  whoosh: "transition",
};

function sfxRoleToken(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function sfxRoleForCue(cue = {}) {
  const direct = sfxRoleToken(cue.role || cue.sfx_role || cue.sfxRole);
  if (direct) return SFX_ROLE_BY_FAMILY[direct] || direct;
  const family = sfxRoleToken(cue.family || cue.category || cue.sound_family || cue.soundFamily);
  return SFX_ROLE_BY_FAMILY[family] || family;
}

function sfxRoleForAsset(asset = {}) {
  const role = sfxRoleToken(asset.role || asset.sfx_role || asset.sfxRole);
  if (role) return SFX_ROLE_BY_FAMILY[role] || role;
  const family = sfxRoleToken(asset.family || asset.category || asset.local_asset_family);
  return SFX_ROLE_BY_FAMILY[family] || family;
}

function renderSfxCues(renderStory = {}, directorBeatMap = {}) {
  return [
    ...asArray(renderStory.sound_transition_plan?.sfx?.cues),
    ...asArray(renderStory.sfx_plan?.cues),
    ...asArray(renderStory.soundTransitionPlan?.sfx?.cues),
    ...asArray(directorBeatMap.sound_transition_plan?.sfx?.cues),
    ...asArray(directorBeatMap.sfx_plan?.cues),
    ...asArray(directorBeatMap.soundTransitionPlan?.sfx?.cues),
  ].filter((cue) => cue && typeof cue === "object");
}

function sfxSelectedAssets(sfxManifest = {}) {
  return [
    ...asArray(sfxManifest.source_plan?.selected_assets),
    ...asArray(sfxManifest.sourcePlan?.selectedAssets),
    ...asArray(sfxManifest.selected_assets),
    ...asArray(sfxManifest.selectedAssets),
  ];
}

function sfxSourceCoverageBlockers({ sfxManifest = {}, renderStory = {}, directorBeatMap = {} } = {}) {
  const requiredRoles = new Set(
    renderSfxCues(renderStory, directorBeatMap)
      .map(sfxRoleForCue)
      .filter(Boolean),
  );
  if (!requiredRoles.size) return [];
  const coveredRoles = new Set(
    sfxSelectedAssets(sfxManifest)
      .map(sfxRoleForAsset)
      .filter(Boolean),
  );
  const missing = [...requiredRoles].filter((role) => !coveredRoles.has(role)).sort();
  if (!missing.length) return [];
  return [
    "incident:sfx_source_quality_unresolved",
    ...missing.map((role) => `sfx_source:missing_role:${role}`),
  ];
}

function safeStoryIdForFile(value = "") {
  return cleanText(value).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function landingPageSlug(landingPage = {}) {
  return cleanText(
    landingPage.landing_page_slug ||
      landingPage.slug ||
      String(landingPage.landing_page_route || landingPage.route || "").replace(/^\/p\//i, ""),
  );
}

function hasPlaceholderLandingSlug(landingPage = {}) {
  const slug = landingPageSlug(landingPage)
    .toLowerCase()
    .replace(/^\/?p\//, "");
  return /^this-story(?:-|$)/.test(slug) || /^story(?:-|$)/.test(slug);
}

async function readExternalMotionPack(storyId = "", motionPackRoot = null) {
  const safeStoryId = safeStoryIdForFile(storyId);
  if (!motionPackRoot || !safeStoryId) return null;
  return readJsonIfPresent(path.join(motionPackRoot, `${safeStoryId}_motion_pack_manifest.json`), null);
}

function externalMotionPackBlockers(motionPack = null, renderManifest = {}) {
  if (!motionPack || typeof motionPack !== "object") return [];
  const packGeneratedAt = timeMs(motionPack.generated_at || motionPack.generatedAt);
  const renderGeneratedAt = timeMs(renderManifest.generated_at || renderManifest.generatedAt);
  if (packGeneratedAt != null && renderGeneratedAt != null && packGeneratedAt + 1000 < renderGeneratedAt) {
    return [];
  }
  const readiness = motionPack.readiness || {};
  const status = cleanText(readiness.status || motionPack.status || motionPack.verdict).toLowerCase();
  const ready = ["v4_motion_ready", "ready", "pass", "passed", "green", "ok", "complete"].includes(status);
  if (ready) return [];
  if (!status) return [];
  return [
    `visual_v4_motion_pack_blocked:${status}`,
    ...asArray(readiness.blockers || motionPack.blockers).map((blocker) =>
      `visual_v4_motion_pack:${cleanText(blocker)}`,
    ),
  ];
}

const MOTION_PACK_MINIMUM_BLOCKERS = new Set([
  "actual_motion_clip_minimum_not_met",
  "distinct_motion_families_minimum_not_met",
]);

function finalRenderEvidenceSupersedesMotionPackMinimums({
  motionPack = {},
  renderManifest = {},
  fileEvidence = {},
  visualEvidence = {},
} = {}) {
  if (renderManifest.final_publish_render !== true) return false;
  if (fileEvidence.rights_ledger_ready !== true) return false;
  if (fileEvidence.materialised_motion_ready !== true) return false;
  if (fileEvidence.distinct_motion_families_ready !== true) return false;
  if (asArray(visualEvidence.blockers).length > 0) return false;

  const requiredMotionScenes = Math.max(
    1,
    Number(motionPack.motion_budget?.required_motion_scenes || 5),
  );
  const requiredDistinctFamilies = Math.max(
    1,
    Number(motionPack.motion_budget?.required_distinct_families || 4),
  );
  return (
    Number(visualEvidence.real_motion_asset_count || 0) >= requiredMotionScenes &&
    Number(visualEvidence.real_media_family_count || 0) >= requiredDistinctFamilies &&
    Number(visualEvidence.direct_video_motion_asset_count || 0) >= 1
  );
}

function externalMotionPackBlockerResult(motionPack = null, renderManifest = {}, evidence = {}) {
  const blockers = externalMotionPackBlockers(motionPack, renderManifest);
  if (!blockers.length || !motionPack || typeof motionPack !== "object") {
    return { blockers, warnings: [] };
  }
  const readinessBlockers = asArray(motionPack.readiness?.blockers || motionPack.blockers)
    .map(cleanText)
    .filter(Boolean);
  const minimumOnly =
    readinessBlockers.length > 0 &&
    readinessBlockers.every((blocker) => MOTION_PACK_MINIMUM_BLOCKERS.has(blocker));
  if (
    minimumOnly &&
    finalRenderEvidenceSupersedesMotionPackMinimums({
      motionPack,
      renderManifest,
      fileEvidence: evidence.fileEvidence,
      visualEvidence: evidence.visualEvidence,
    })
  ) {
    return {
      blockers: [],
      warnings: ["external_motion_pack_minimums_superseded_by_final_render_evidence"],
    };
  }
  return { blockers, warnings: [] };
}

function packageEvidencePromotesLocalProof({ publishVerdict = {}, platformManifest = {}, renderManifest = {} } = {}) {
  return (
    publishVerdict.verdict === "GREEN" &&
    publishVerdict.can_auto_publish === true &&
    platformManifest.publish_status === "GREEN" &&
    platformManifest.can_auto_publish === true &&
    renderManifest.final_publish_render === true
  );
}

function storyPackagePolicyBlockers(storyPackage = {}, evidence = {}) {
  const blockers = [];
  const verdict = cleanText(storyPackage.verdict || storyPackage.status).toLowerCase();
  const rawPackageBlockers = asArray(storyPackage.blockers).map(cleanText).filter(Boolean);
  const quarantineStatus = cleanText(
    storyPackage.quarantine_status ||
      storyPackage.quarantineStatus ||
      storyPackage.hold_status ||
      storyPackage.holdStatus,
  );
  const localProofPromoted = packageEvidencePromotesLocalProof(evidence);
  const packageBlockers = localProofPromoted
    ? rawPackageBlockers.filter((blocker) => !LOCAL_PROOF_TRANSITION_BLOCKERS.has(blocker))
    : rawPackageBlockers;
  const hasPackageHoldEvidence = Boolean(quarantineStatus) || packageBlockers.length > 0;
  const onlyPromotedLocalProofState =
    localProofPromoted &&
    LOCAL_PROOF_PENDING_VERDICTS.has(verdict) &&
    !quarantineStatus &&
    rawPackageBlockers.length > 0 &&
    packageBlockers.length === 0;
  if (
    hasPackageHoldEvidence &&
    verdict &&
    !READY_PACKAGE_VERDICTS.has(verdict) &&
    !onlyPromotedLocalProofState
  ) {
    blockers.push(`story_package_verdict:${verdict}`);
  }
  if (quarantineStatus) blockers.push(`story_package_quarantined:${quarantineStatus}`);
  for (const blocker of packageBlockers) {
    blockers.push(`story_package:${blocker}`);
  }
  return uniqueCleanStrings(blockers);
}

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const exportedPath = cleanText(
    storyPackage.exported_path ||
      storyPackage.final_mp4_path ||
      storyPackage.mp4_path ||
      storyPackage.source?.exported_path,
  );
  const artifactDir =
    cleanText(storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir) ||
    (exportedPath ? path.dirname(path.resolve(exportedPath)) : "");
  const blockers = [];
  const warnings = [];
  if (!artifactDir) blockers.push("missing_artifact_dir");
  const readyFiles = {};
  for (const basename of REQUIRED_READY_FILES) {
    const ok = artifactDir ? await fileReady(path.join(artifactDir, basename), basename) : false;
    readyFiles[basename] = ok;
    if (!ok) blockers.push(`missing_artefact:${basename}`);
  }

  const canonical = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"))
    : {};
  const publishVerdict = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "publish_verdict.json"))
    : {};
  const platformManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"))
    : {};
  const renderManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"))
    : {};
  const visualQualityReport = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "visual_quality_report.json"))
    : {};
  const benchmarkReport = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "benchmark_report.json"))
    : {};
  const coherenceReport = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "coherence_report.json"))
    : {};
  const sfxManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"))
    : {};
  const scriptScorecard = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "script_scorecard.json"), null)
    : null;
  const mediaHouseScore = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "pulse_media_house_score.json"), {})
    : {};
  const landingPage = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "landing_page_manifest.json"))
    : {};
  const policy = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "platform_policy_report.json"))
    : {};
  const narrationManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "narration_manifest.json"), null)
    : null;
  const audioManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {})
    : {};
  const captionManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), null)
    : null;
  const voiceQualityReport = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "voice_quality_report.json"), null)
    : null;
  const audioSegmentReport = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), null)
    : null;
  const wordTimestamps = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "word_timestamps.json"), null)
    : null;
  const ownedMotionManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "owned_motion_manifest.json"), null)
    : null;
  const materialisedMotionClips = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {})
    : {};
  const renderStory = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "visual_v4_render_story.json"), {})
    : {};
  const directorBeatMap = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {})
    : {};
  const footageInventory = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {})
    : {};
  const rightsLedger = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), null)
    : null;
  const affiliateManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "affiliate_link_manifest.json"), {})
    : {};
  const staleTemporalReview = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "stale_temporal_review.json"), null)
    : null;
  const visualSourceReview = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "visual_source_review.json"), null)
    : null;
  const storyId = cleanText(storyPackage.story_id || storyPackage.id || canonical.story_id || canonical.id) || "unknown";
  blockers.push(...storyPackagePolicyBlockers(storyPackage, {
    publishVerdict,
    platformManifest,
    renderManifest,
  }));
  const externalMotionPack = await readExternalMotionPack(storyId, options.motionPackRoot);
  const motion = motionEvidence(ownedMotionManifest || {}, materialisedMotionClips || {});
  const renderStoryMotion = motionEvidenceFromRenderStory(renderStory, directorBeatMap);
  const renderStoryMotionPaths = renderStoryMotion.clips
    .map((clip) => cleanText(clip.path || clip.media_path))
    .filter(Boolean);
  let renderStoryMotionReady = renderStoryMotionPaths.length >= 3;
  for (const motionPath of renderStoryMotionPaths.slice(0, 3)) {
    renderStoryMotionReady = renderStoryMotionReady && await referencedFileReady(artifactDir, motionPath, 100);
  }
  const materialisedMotionEvidence = materialisedMotionEvidenceClips(
    ownedMotionManifest || {},
    materialisedMotionClips || {},
  );
  const finalRenderVisualReuse = finalRenderVisualReuseEvidence({ renderManifest, renderStory });
  const hyperframesReadableDwell = hyperframesReadableDwellEvidence({
    renderManifest,
    renderStory,
    directorBeatMap,
  });
  const clipScenePlanVisualCadence = clipScenePlanVisualCadenceEvidence(renderManifest);
  const scenePlanMotionEvidence = finalClipScenePlanMotionEvidence(
    renderManifest,
    clipScenePlanVisualCadence,
  );
  const mergedMotionEvidence = mergedMotionEvidenceClips(
    materialisedMotionEvidence,
    renderStoryMotion.clips,
  );
  const directMotionSegmentEvidenceSource = scenePlanMotionEvidence?.clips?.length
    ? scenePlanMotionEvidence.clips
    : mergedMotionEvidence;
  const repeatedDirectMotionSegments = repeatedDirectMotionSegmentEvidence(directMotionSegmentEvidenceSource);
  const directMotionBaseSourceEvidenceSource = scenePlanMotionEvidence?.clips?.length
    ? scenePlanMotionEvidence.clips
    : renderStoryMotion.clips.length
      ? renderStoryMotion.clips
      : mergedMotionEvidence;
  const directMotionSubjectMismatchEvidenceSource = scenePlanMotionEvidence?.clips?.length
    ? mergedMotionEvidenceClips(scenePlanMotionEvidence.clips, mergedMotionEvidence)
    : mergedMotionEvidence;
  const directMotionBaseSourceOveruse = directMotionBaseSourceOveruseEvidence(directMotionBaseSourceEvidenceSource);
  const directMotionSubjectMismatch = directMotionSubjectMismatchEvidence(directMotionSubjectMismatchEvidenceSource, {
    story: canonical,
    renderManifest,
    renderStory,
  });
  const referencedWordTimestamps = await readBestWordTimestamps({
    artifactDir,
    directWordTimestamps: wordTimestamps,
    audioManifest,
    narrationManifest: narrationManifest || {},
    canonical,
  });
  const fallbackTranscript = cleanText(canonical.narration_script || canonical.tts_script || canonical.full_script);
  const fileEvidence = {
    mp4_ready: readyFiles["visual_v4_render.mp4"] === true,
    captions_ready: readyFiles["captions.srt"] === true,
    narration_ready: await narrationReady(artifactDir, narrationManifest || {}, audioManifest, fallbackTranscript),
    word_timestamps_ready: referencedWordTimestamps
      ? wordTimestampsReady(referencedWordTimestamps)
      : Number(audioManifest.word_timestamp_count) > 0 &&
        await referencedFileReady(artifactDir, audioManifest.word_timestamps_path || audioManifest.timestamps_path, 50),
    materialised_motion_ready:
      motion.materialised_motion_ready ||
      renderStoryMotionReady ||
      (renderStoryMotion.clips.length === 0 && renderStoryMotion.shot_budget_clip_count >= 5),
    distinct_motion_families_ready:
      motion.distinct_motion_families_ready ||
      renderStoryMotion.families.size >= 3 ||
      (renderStoryMotion.clips.length === 0 && renderStoryMotion.shot_budget_family_count >= 3),
    materialised_motion_clip_count: Math.max(
      motion.materialised_motion_clip_count,
      renderStoryMotion.clips.length,
      renderStoryMotion.shot_budget_clip_count,
    ),
    distinct_motion_family_count: Math.max(
      motion.distinct_motion_family_count,
      renderStoryMotion.families.size,
      renderStoryMotion.shot_budget_family_count,
    ),
    repeated_direct_motion_segment_count: repeatedDirectMotionSegments.length,
    repeated_direct_motion_segments: repeatedDirectMotionSegments,
    rights_ledger_ready: rightsLedgerReady(rightsLedger),
    ...finalRenderVisualReuse.evidence,
    ...hyperframesReadableDwell.evidence,
    ...clipScenePlanVisualCadence.evidence,
    direct_motion_loop_evidence_source: scenePlanMotionEvidence?.source ||
      (renderStoryMotion.clips.length ? "final_render_story_clips" : "materialised_motion_fallback"),
    ...directMotionBaseSourceOveruse.evidence,
    ...directMotionSubjectMismatch.evidence,
  };
  const timestampReadiness = localWordTimestampReadiness({
    timestamps: referencedWordTimestamps || {},
    audioManifest,
    narrationManifest: narrationManifest || {},
    canonical,
  });
  Object.assign(fileEvidence, timestampReadiness.evidence);
  if (timestampReadiness.blockers.includes("word_timestamps_not_asr_aligned")) {
    fileEvidence.word_timestamps_asr_aligned = false;
  } else if (fileEvidence.word_timestamps_ready && fileEvidence.word_timestamp_source) {
    fileEvidence.word_timestamps_asr_aligned = true;
  }
  blockers.push(...timestampReadiness.blockers);

  const stalePublishVerdictPromotedByPreflight = stalePublishVerdictCanUseSchedulerPreflight({
    storyPackage,
    publishVerdict,
    platformManifest,
    renderManifest,
    mediaHouseScore,
  });
  const effectivePublishVerdict = stalePublishVerdictPromotedByPreflight
    ? {
        ...publishVerdict,
        verdict: "GREEN",
        status: "GREEN",
        can_auto_publish: true,
        previous_verdict: publishVerdict.verdict || null,
        previous_reason_codes: asArray(publishVerdict.reason_codes),
        stale_publish_verdict_promoted_by_scheduler_preflight: true,
      }
    : publishVerdict;
  const green = effectivePublishVerdict.verdict === "GREEN";
  const visualEvidence = visualEvidenceProfile({
    story: { ...canonical, ...renderStory },
    rightsLedger: rightsLedger || {},
    footageInventory,
    directorPlan: directorBeatMap,
  });
  if (asArray(visualEvidence.blockers).includes("visual_evidence:insufficient_real_visual_source_families")) {
    const visualFamilyCount = Number(
      visualEvidence.real_media_family_count ||
        visualEvidence.direct_video_motion_family_count ||
        0,
    );
    fileEvidence.distinct_motion_families_ready = false;
    fileEvidence.distinct_motion_family_count = Number.isFinite(visualFamilyCount)
      ? visualFamilyCount
      : 0;
  }
  const externalMotionPackResult = externalMotionPackBlockerResult(
    externalMotionPack,
    renderManifest,
    { fileEvidence, visualEvidence },
  );
  blockers.push(...externalMotionPackResult.blockers);
  warnings.push(...externalMotionPackResult.warnings);
  const ownedExplainerReady = ownedExplainerMotionReady({
    footageInventory,
    ownedMotionManifest: ownedMotionManifest || {},
    materialisedMotionClips: materialisedMotionClips || {},
    renderStory,
    rightsLedger,
  });
  const ownedExplainerException = ownedExplainerExceptionApproved({
    canonical,
    renderManifest,
    storyPackage,
  }) || (ownedExplainerReady && ownedExplainerPolicyApproved({ canonical, footageInventory }));
  if (!green) blockers.push("publish_verdict_not_green");
  if (
    requiresDirectVideoMotion({ canonical, renderManifest, platformManifest }) &&
    Number(visualEvidence.direct_video_motion_asset_count) < 1 &&
    !(ownedExplainerReady && ownedExplainerException)
  ) {
    blockers.push("visual_evidence:direct_video_motion_missing");
  }
  if (platformManifest.publish_status && platformManifest.publish_status !== "GREEN") {
    blockers.push("platform_manifest_not_green");
  }
  if (renderManifest.final_publish_render !== true) {
    blockers.push("render_not_final_publish_ready");
  }
  blockers.push(
    ...hyperframesPremiumShellBlockers({
      ...storyPackage,
      ...renderManifest,
      render_manifest: renderManifest,
      premiumLane: renderManifest.premiumLane || storyPackage.premiumLane,
      premium_lane: renderManifest.premium_lane || storyPackage.premium_lane,
    }),
  );
  blockers.push(...finalRenderVisualReuse.blockers);
  blockers.push(...hyperframesReadableDwell.blockers);
  blockers.push(...clipScenePlanVisualCadence.blockers);
  if (renderManifest.final_publish_render === true) {
    blockers.push(...narrationManifestBlockers(narrationManifest, audioManifest));
    blockers.push(...scriptScorecardBlockers({ canonical, scriptScorecard }));
    if (!audioSegmentReport || typeof audioSegmentReport !== "object") {
      blockers.push("audio_segment_loudness_report_missing");
    } else if (audioSegmentReport.verdict !== "pass" && audioSegmentReport.status !== "pass") {
      const audioBlockers = asArray(audioSegmentReport.blockers || audioSegmentReport.failures);
      blockers.push(
        ...(
          audioBlockers.length
            ? audioBlockers.map((blocker) => `audio_segment_loudness:${blocker}`)
            : ["audio_segment_loudness:failed"]
        ),
      );
    }
    blockers.push(...audioSegmentFreshnessBlockers({ audioSegmentReport, renderManifest }));
    blockers.push(...auditNarrationQaArtifacts({ audioManifest, captionManifest, voiceQualityReport }).blockers);
  }
  const publicCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    platform_publish_manifest: platformManifest,
    landing_page_manifest: landingPage,
  });
  blockers.push(...asArray(publicCopyQa.failures));
  const coherenceArtifact = await auditPublicOutputCoherenceArtifact({
    artifactDir,
    canonical,
    coherenceReport,
  });
  blockers.push(...asArray(coherenceArtifact.blockers));
  if (sfxRenderAssetMismatch({ sfxManifest, renderStory })) {
    blockers.push("sfx_render_asset_mismatch");
  }
  blockers.push(...sfxSourceCoverageBlockers({ sfxManifest, renderStory, directorBeatMap }));
  if (hasPlaceholderLandingSlug(landingPage)) blockers.push("landing_page:placeholder_slug");
  const visualEvidenceBlockers = ownedExplainerReady && ownedExplainerException
    ? asArray(visualEvidence.blockers).filter(
        (blocker) =>
          ![
            "visual_evidence:generated_only_motion_deck",
            "visual_evidence:no_real_visual_media_asset",
            "visual_evidence:direct_video_motion_missing",
          ].includes(blocker),
      )
    : asArray(visualEvidence.blockers);
  blockers.push(...visualEvidenceBlockers);
  blockers.push(...repeatedDirectMotionSegmentBlockers(directMotionSegmentEvidenceSource));
  blockers.push(...directMotionBaseSourceOveruse.blockers);
  blockers.push(...directMotionSubjectMismatch.blockers);
  const publicCopyRepairedAt = timeMs(canonical.public_copy_repaired_at);
  const durationVariantRepairedAt = timeMs(canonical.duration_variant_repaired_at);
  const renderGeneratedAt = timeMs(renderManifest.generated_at);
  if (publicCopyRepairedAt != null && renderGeneratedAt != null && publicCopyRepairedAt > renderGeneratedAt) {
    blockers.push("public_copy_newer_than_render");
  }
  if (durationVariantRepairedAt != null && renderGeneratedAt != null && durationVariantRepairedAt > renderGeneratedAt) {
    blockers.push("duration_variant_newer_than_render");
  }
  const renderedDuration = numberOrNull(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s,
  );
  if (
    renderedDuration != null &&
    renderedDuration < 35 &&
    !isRetentionShortApproved({ canonical, renderManifest, platformManifest })
  ) {
    blockers.push(`normal_production_duration_below_quality_floor:${Math.round(renderedDuration)}`);
  }
  const incidentGuard = evaluateIncidentGuard({
    story_id: storyId,
    canonical_story_manifest: canonical,
    render_manifest: renderManifest,
    visual_quality_report: visualQualityReport,
    benchmark_report: benchmarkReport,
    coherence_report: coherenceReport,
    coherence_artifact_freshness: coherenceArtifact,
    sfx_manifest: sfxManifest,
    script_scorecard: scriptScorecard,
    caption_manifest: captionManifest,
    voice_quality_report: voiceQualityReport,
    audio_segment_loudness_report: audioSegmentReport,
    publish_verdict: effectivePublishVerdict,
    platform_publish_manifest: platformManifest,
    platform_policy_report: policy,
    landing_page_manifest: landingPage,
    affiliate_link_manifest: affiliateManifest,
    file_evidence: fileEvidence,
  });
  blockers.push(...asArray(incidentGuard.disaster_upload_blockers));
  const staleTemporalResolution = staleTemporalReviewResolution(
    staleTemporalReview,
    String(storyId || ""),
    incidentGuard,
  );
  const visualSourceResolution = visualSourceReviewResolution(
    visualSourceReview,
    String(storyId || ""),
    {
      render_manifest: renderManifest,
      file_evidence: fileEvidence,
      visual_evidence: visualEvidence,
    },
  );

  const inspected = {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    already_published_platforms: uniqueCleanStrings([
      ...asArray(storyPackage.already_published_platforms),
      ...asArray(storyPackage.published_platforms),
      ...asArray(storyPackage.skip_platforms),
    ]),
    terminal_duplicate_blocked_platforms: uniqueCleanStrings(storyPackage.terminal_duplicate_blocked_platforms),
    missing_enabled_platforms: uniqueCleanStrings(storyPackage.missing_enabled_platforms),
    blockers,
    warnings,
    canonical,
    publish_verdict: effectivePublishVerdict,
    raw_publish_verdict: publishVerdict,
    stale_publish_verdict_promoted_by_scheduler_preflight: stalePublishVerdictPromotedByPreflight,
    render_manifest: renderManifest,
    platform_publish_manifest: platformManifest,
    landing_page_manifest: landingPage,
    platform_policy_report: policy,
    public_copy_qa: publicCopyQa,
    incident_guard: incidentGuard,
    coherence_report: coherenceReport,
    coherence_artifact_freshness: coherenceArtifact,
    visual_quality_report: visualQualityReport,
    benchmark_report: benchmarkReport,
    sfx_manifest: sfxManifest,
    script_scorecard: scriptScorecard,
    pulse_media_house_score: mediaHouseScore,
    caption_manifest: captionManifest,
    voice_quality_report: voiceQualityReport,
    audio_segment_loudness_report: audioSegmentReport,
    file_evidence: fileEvidence,
    source_url_hashes: storySourceUrlHashes({
      ...storyPackage,
      canonical,
      platform_publish_manifest: platformManifest,
    }),
    visual_evidence_profile: {
      ...visualEvidence,
      owned_explainer_motion_ready: ownedExplainerReady,
      owned_explainer_exception_approved: ownedExplainerException,
    },
    owned_explainer_motion_ready: ownedExplainerReady,
    owned_explainer_exception_approved: ownedExplainerException,
    external_motion_pack: externalMotionPack,
  };
  if (staleTemporalResolution) {
    inspected.skip_status = staleTemporalResolution.skip_status;
    inspected.skip_reason = staleTemporalResolution.skip_reason;
    inspected.stale_temporal_review = staleTemporalReview;
  }
  if (visualSourceResolution) {
    inspected.skip_status = visualSourceResolution.skip_status;
    inspected.skip_reason = visualSourceResolution.skip_reason;
    inspected.visual_source_review = visualSourceReview;
  }
  return inspected;
}

function platformOperationalState(platformOperationalConfig = null, platform = "") {
  if (!platformOperationalConfig) return null;
  const key = PLATFORM_OPERATIONAL_KEYS[platform] || platform;
  const value = platformOperationalConfig[key] || platformOperationalConfig[platform] || null;
  if (!value || typeof value !== "object") return null;
  return {
    state: cleanText(value.state || value.status || "unknown"),
    reason: cleanText(value.reason || value.blocker || value.error || ""),
    enablement_gaps: uniqueCleanStrings(value.enablement_gaps || value.gaps || value.blockers),
    enablement_next_action: cleanText(value.enablement_next_action || value.next_action || value.recommendation),
  };
}

function platformReadyNow(state = null) {
  if (!state) return false;
  return state.state === "enabled" || state.state === "enabled_via_scheduler";
}

function platformAlreadyPublishedForStory(story = {}, platform = "") {
  return uniqueCleanStrings([
    ...asArray(story.already_published_platforms),
    ...asArray(story.published_platforms),
    ...asArray(story.skip_platforms),
  ]).includes(cleanText(platform));
}

function platformTerminalDuplicateBlockedForStory(story = {}, platform = "") {
  return uniqueCleanStrings(story.terminal_duplicate_blocked_platforms)
    .map(normalizePlatformKey)
    .filter(Boolean)
    .includes(normalizePlatformKey(platform));
}

function publishedPlatformEvidenceEntriesForStory(publishedPlatformEvidence = null, storyId = "") {
  const id = cleanText(storyId);
  if (!id || !publishedPlatformEvidence) return [];
  if (publishedPlatformEvidence instanceof Map) {
    return asArray(publishedPlatformEvidence.get(id)?.already_published_platforms);
  }
  if (Array.isArray(publishedPlatformEvidence)) {
    return publishedPlatformEvidence
      .filter((row) => cleanText(row?.story_id || row?.id) === id)
      .flatMap((row) => [
        row.platform,
        ...asArray(row.already_published_platforms),
        ...asArray(row.published_platforms),
      ]);
  }
  if (typeof publishedPlatformEvidence !== "object") return [];
  const direct =
    publishedPlatformEvidence[id] ||
    publishedPlatformEvidence.by_story_id?.[id] ||
    publishedPlatformEvidence.byStoryId?.[id] ||
    publishedPlatformEvidence.stories?.[id];
  if (!direct) return [];
  if (Array.isArray(direct)) return direct;
  return [
    direct.platform,
    ...asArray(direct.already_published_platforms),
    ...asArray(direct.published_platforms),
    ...asArray(direct.platforms),
  ];
}

function publishedPlatformEvidenceEntriesForSourceHash(publishedPlatformEvidence = null, hash = "") {
  const key = cleanText(hash);
  if (!key || !publishedPlatformEvidence || typeof publishedPlatformEvidence !== "object") return [];
  const direct =
    publishedPlatformEvidence.by_source_url_hash?.[key] ||
    publishedPlatformEvidence.bySourceUrlHash?.[key] ||
    publishedPlatformEvidence.source_url_hashes?.[key];
  if (!direct) return [];
  if (Array.isArray(direct)) {
    return direct.flatMap((row) => [
      row.platform,
      ...asArray(row.already_published_platforms),
      ...asArray(row.published_platforms),
      ...asArray(row.platforms),
    ]);
  }
  return [
    direct.platform,
    ...asArray(direct.already_published_platforms),
    ...asArray(direct.published_platforms),
    ...asArray(direct.platforms),
  ];
}

function publishedPlatformEvidenceEntriesForTopicKey(publishedPlatformEvidence = null, topicKey = "") {
  const key = cleanText(topicKey);
  if (!key || !publishedPlatformEvidence || typeof publishedPlatformEvidence !== "object") return [];
  const direct =
    publishedPlatformEvidence.by_topic_key?.[key] ||
    publishedPlatformEvidence.byTopicKey?.[key] ||
    publishedPlatformEvidence.topic_keys?.[key];
  if (!direct) return [];
  if (Array.isArray(direct)) {
    return direct.flatMap((row) => [
      row.platform,
      ...asArray(row.already_published_platforms),
      ...asArray(row.published_platforms),
      ...asArray(row.platforms),
    ]);
  }
  return [
    direct.platform,
    ...asArray(direct.already_published_platforms),
    ...asArray(direct.published_platforms),
    ...asArray(direct.platforms),
  ];
}

function publishedPlatformEvidenceEntriesForNearTopic(publishedPlatformEvidence = null, title = "") {
  const candidateTitle = cleanText(title);
  if (!candidateTitle || !publishedPlatformEvidence || typeof publishedPlatformEvidence !== "object") return [];
  const sources = [
    publishedPlatformEvidence.by_topic_key,
    publishedPlatformEvidence.byTopicKey,
    publishedPlatformEvidence.topic_keys,
  ].filter((value) => value && typeof value === "object");
  const matches = [];
  for (const source of sources) {
    for (const direct of Object.values(source)) {
      const rows = Array.isArray(direct) ? direct : [direct, ...asArray(direct?.rows)];
      const topicTitles = uniqueCleanStrings(rows.flatMap((row) => [
        row?.title,
        row?.story_title,
        row?.public_title,
      ]));
      if (!topicTitles.some((publishedTitle) => titleTopicOverlap(publishedTitle, candidateTitle).match)) {
        continue;
      }
      for (const row of rows) {
        matches.push(
          row?.platform,
          ...asArray(row?.already_published_platforms),
          ...asArray(row?.published_platforms),
          ...asArray(row?.platforms),
        );
      }
      if (!Array.isArray(direct)) {
        matches.push(
          direct.platform,
          ...asArray(direct.already_published_platforms),
          ...asArray(direct.published_platforms),
          ...asArray(direct.platforms),
        );
      }
    }
  }
  return matches;
}

function storyTopicEvidenceTitle(story = {}) {
  return firstCleanText(
    story.title,
    story.public_title,
    story.selected_title,
    story.suggested_title,
    story.canonical?.selected_title,
    story.canonical?.short_title,
    story.canonical?.canonical_title,
    story.canonical?.title,
    story.canonical?.suggested_title,
    story.platform_publish_manifest?.public_title,
    story.platform_publish_manifest?.title,
  );
}

function applyPublishedPlatformEvidence(stories = [], publishedPlatformEvidence = null) {
  if (!publishedPlatformEvidence) return stories;
  for (const story of stories) {
    const fromEvidence = publishedPlatformEvidenceEntriesForStory(
      publishedPlatformEvidence,
      story.story_id,
    )
      .map(normalizePlatformKey)
      .filter(Boolean);
    const fromSourceHash = storySourceUrlHashes(story)
      .flatMap((hash) => publishedPlatformEvidenceEntriesForSourceHash(publishedPlatformEvidence, hash))
      .map(normalizePlatformKey)
      .filter(Boolean);
    const topicKey = titleTopicKey(storyTopicEvidenceTitle(story));
    const fromTopicKey = publishedPlatformEvidenceEntriesForTopicKey(publishedPlatformEvidence, topicKey)
      .map(normalizePlatformKey)
      .filter(Boolean);
    const fromNearTopic = publishedPlatformEvidenceEntriesForNearTopic(
      publishedPlatformEvidence,
      storyTopicEvidenceTitle(story),
    )
      .map(normalizePlatformKey)
      .filter(Boolean);
    const combinedEvidence = uniqueCleanStrings([...fromEvidence, ...fromSourceHash, ...fromTopicKey, ...fromNearTopic]);
    if (!combinedEvidence.length) continue;
    story.already_published_platforms = uniqueCleanStrings([
      ...asArray(story.already_published_platforms),
      ...combinedEvidence,
    ]);
    story.missing_enabled_platforms = uniqueCleanStrings(
      asArray(story.missing_enabled_platforms),
    ).filter((platform) => !story.already_published_platforms.includes(platform));
  }
  return stories;
}

function terminalDuplicateEvidenceIsTerminal(row = {}) {
  const blockers = uniqueCleanStrings(row.blockers);
  return (
    cleanText(row.outcome).toLowerCase() === "duplicate_blocked" ||
    blockers.includes("duplicate_blocked") ||
    /^duplicate_blocked:/i.test(cleanText(row.error))
  );
}

function terminalDuplicateEvidenceEntriesForStory(report = null, storyId = "") {
  const id = cleanText(storyId);
  if (!id || !report || typeof report !== "object") return [];
  return asArray(report.blocked_actions)
    .filter((row) => cleanText(row.story_id || row.id) === id)
    .filter(terminalDuplicateEvidenceIsTerminal)
    .map((row) => normalizePlatformKey(row.platform))
    .filter(Boolean);
}

function applyTerminalDuplicatePlatformEvidence(stories = [], guardedLiveDispatchExecutorReport = null) {
  if (!guardedLiveDispatchExecutorReport) return stories;
  for (const story of stories) {
    const fromEvidence = terminalDuplicateEvidenceEntriesForStory(
      guardedLiveDispatchExecutorReport,
      story.story_id,
    );
    if (!fromEvidence.length) continue;
    story.terminal_duplicate_blocked_platforms = uniqueCleanStrings([
      ...asArray(story.terminal_duplicate_blocked_platforms),
      ...fromEvidence,
    ]);
    story.missing_enabled_platforms = uniqueCleanStrings(
      asArray(story.missing_enabled_platforms),
    ).filter((platform) => !story.terminal_duplicate_blocked_platforms.includes(platform));
  }
  return stories;
}

function enabledPublishPlatforms(platformOperationalConfig = null) {
  if (!platformOperationalConfig) return [];
  return PLATFORMS.filter((platform) =>
    platformReadyNow(platformOperationalState(platformOperationalConfig, platform)),
  );
}

function applyEnabledPlatformAlreadyPublishedSkips(stories = [], platformOperationalConfig = null) {
  const enabledPlatforms = enabledPublishPlatforms(platformOperationalConfig);
  if (!enabledPlatforms.length) return stories;
  for (const story of stories) {
    if (story.skip_status) continue;
    const already = new Set(
      uniqueCleanStrings(asArray(story.already_published_platforms))
        .map(normalizePlatformKey)
        .filter(Boolean),
    );
    if (!enabledPlatforms.every((platform) => already.has(platform))) continue;
    story.skip_status = "enabled_platforms_already_public";
    story.skip_reason = `enabled_platforms_already_published:${enabledPlatforms.join(",")}`;
  }
  return stories;
}

function applyEnabledPlatformUnavailableSkips(stories = [], platformOperationalConfig = null) {
  const enabledPlatforms = enabledPublishPlatforms(platformOperationalConfig);
  if (!enabledPlatforms.length) return stories;
  for (const story of stories) {
    if (story.skip_status) continue;
    const already = new Set(
      uniqueCleanStrings(asArray(story.already_published_platforms))
        .map(normalizePlatformKey)
        .filter(Boolean),
    );
    const terminalDuplicates = new Set(
      uniqueCleanStrings(asArray(story.terminal_duplicate_blocked_platforms))
        .map(normalizePlatformKey)
        .filter(Boolean),
    );
    if (!terminalDuplicates.size) continue;
    if (!enabledPlatforms.every((platform) => already.has(platform) || terminalDuplicates.has(platform))) {
      continue;
    }
    story.skip_status = "enabled_platforms_already_public_or_terminal_duplicate";
    story.skip_reason = [
      `published=${enabledPlatforms.filter((platform) => already.has(platform)).join(",") || "none"}`,
      `terminal_duplicate=${enabledPlatforms.filter((platform) => terminalDuplicates.has(platform)).join(",") || "none"}`,
    ].join(";");
  }
  return stories;
}

function resolveArtifactReference(artifactDir, reference) {
  const raw = cleanText(reference);
  if (!raw) return "";
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(artifactDir, raw));
}

function platformVariantFreshnessBlockers({ platform = "", platformConfig = {}, renderManifest = {} } = {}) {
  const variantVideoReference = cleanText(
    platformConfig.variant_video_path ||
      platformConfig.platform_video_path ||
      platformConfig.video_path ||
      platformConfig.platform_variant_render?.output_path ||
      platformConfig.platform_variant_render?.video_path,
  );
  if (!variantVideoReference) return [];

  const blockers = [];
  const variantRender = platformConfig.platform_variant_render || {};
  const renderGeneratedAt = timeMs(
    renderManifest.generated_at ||
      renderManifest.generatedAt ||
      renderManifest.rendered_at,
  );
  const variantGeneratedAt = timeMs(
    variantRender.generated_at ||
      variantRender.generatedAt ||
      variantRender.rendered_at ||
      platformConfig.platform_variant_materialized_at,
  );
  if (renderGeneratedAt) {
    if (!variantGeneratedAt) {
      blockers.push(`platform_variant_missing_generated_at:${platform}`);
    } else if (variantGeneratedAt < renderGeneratedAt) {
      blockers.push(`platform_variant_stale_after_render:${platform}`);
    }
  }

  const currentSourceDuration = numberOrNull(
    renderManifest.rendered_duration_s ||
      renderManifest.duration_s ||
      renderManifest.video_duration_s,
  );
  const variantSourceDuration = numberOrNull(
    variantRender.source_duration_s ||
      variantRender.source_render_duration_s ||
      variantRender.base_duration_s,
  );
  if (
    currentSourceDuration != null &&
    variantSourceDuration != null &&
    Math.abs(currentSourceDuration - variantSourceDuration) > 0.25
  ) {
    blockers.push(`platform_variant_source_duration_mismatch:${platform}`);
  }

  return blockers;
}

function platformTitleFromConfig(platformConfig = {}, canonical = {}) {
  return cleanText(
    platformConfig.title ||
      platformConfig.public_title ||
      platformConfig.short_title ||
      canonical.selected_title ||
      canonical.short_title ||
      canonical.canonical_title ||
      canonical.title ||
      canonical.canonical_subject,
  );
}

function weakPlatformActionCopy(value = "", canonical = {}) {
  const text = cleanText(value);
  if (!text) return true;
  const canonicalDescription = cleanText(canonical.public_description || canonical.description);
  if (canonicalDescription && text === canonicalDescription) return true;
  return /(?:source-safe gaming angle|requirements list|sources,\s*related links|appeared first|see on steam|read more)/i.test(text);
}

function siblingPlatformDescription(outputs = {}, canonical = {}) {
  const candidates = [
    outputs.youtube_shorts?.description,
    outputs.instagram_reels?.caption,
    outputs.facebook_reels?.page_caption,
    outputs.tiktok?.caption,
    outputs.youtube_shorts?.caption,
  ].map(cleanText).filter(Boolean);
  return candidates.find((candidate) => !weakPlatformActionCopy(candidate, canonical)) || "";
}

function siblingPlatformCoverHeadline(outputs = {}) {
  return cleanText(
    outputs.youtube_shorts?.cover_frame?.headline ||
      outputs.instagram_reels?.cover_frame?.headline ||
      outputs.tiktok?.cover_frame?.headline ||
      outputs.facebook_reels?.cover_frame?.headline,
  );
}

function platformDescriptionFromConfig(platform = "", platformConfig = {}, canonical = {}, outputs = {}) {
  const fallback = cleanText(canonical.public_description || canonical.description);
  const siblingDescription = siblingPlatformDescription(outputs, canonical);
  let direct = "";
  if (platform === "youtube_shorts") {
    direct = cleanText(
      platformConfig.description ||
        platformConfig.youtube_description ||
        platformConfig.caption ||
        platformConfig.page_caption ||
        fallback,
    );
  }
  if (platform === "instagram_reels" || platform === "tiktok") {
    direct = cleanText(
      platformConfig.caption ||
        platformConfig.description ||
        platformConfig.youtube_description ||
        platformConfig.page_caption ||
        fallback,
    );
  }
  if (platform === "facebook_reels") {
    direct = cleanText(
      platformConfig.page_caption ||
        platformConfig.description ||
        platformConfig.caption ||
        platformConfig.youtube_description ||
        fallback,
    );
  }
  if (!direct) {
    direct = cleanText(
      platformConfig.post_text ||
        platformConfig.thread_text ||
        platformConfig.pin_description ||
        platformConfig.description ||
        platformConfig.caption ||
        fallback,
    );
  }
  return weakPlatformActionCopy(direct, canonical) && siblingDescription
    ? siblingDescription
    : direct;
}

function platformCoverHeadlineFromConfig(platformConfig = {}, canonical = {}, outputs = {}) {
  const direct = cleanText(
    platformConfig.cover_frame?.headline ||
      platformConfig.cover_headline ||
      platformConfig.thumbnail_headline ||
      platformConfig.first_frame_text ||
      "",
  );
  if (direct) return direct;
  return cleanText(
    siblingPlatformCoverHeadline(outputs) ||
      canonical.thumbnail_headline ||
      canonical.first_frame_text ||
      canonical.suggested_thumbnail_text,
  );
}

function platformActionPublicCopy({ platform = "", platformConfig = {}, canonical = {}, outputs = {} } = {}) {
  const description = platformDescriptionFromConfig(platform, platformConfig, canonical, outputs);
  const caption = cleanText(
    platformConfig.caption ||
      platformConfig.page_caption ||
      platformConfig.post_text ||
      description,
  );
  const pageCaption = cleanText(platformConfig.page_caption || caption || description);
  return {
    title: platformTitleFromConfig(platformConfig, canonical),
    description,
    caption,
    page_caption: pageCaption,
    cover_headline: platformCoverHeadlineFromConfig(platformConfig, canonical, outputs),
  };
}

function instagramReelsNativeVariantBlockers({ platform = "", platformConfig = {}, platformEnabled = false } = {}) {
  if (cleanText(platform) !== "instagram_reels" || platformEnabled !== true) return [];
  const variantVideoReference = cleanText(
    platformConfig.variant_video_path ||
      platformConfig.platform_video_path ||
      platformConfig.video_path ||
      platformConfig.platform_variant_render?.output_path ||
      platformConfig.platform_variant_render?.video_path,
  );
  const variantCaptionsReference = cleanText(
    platformConfig.variant_captions_path ||
      platformConfig.platform_captions_path ||
      platformConfig.captions_path ||
      platformConfig.platform_variant_render?.captions_path,
  );
  const encoderProfile = cleanText(platformConfig.platform_variant_render?.encoder_profile);
  const blockers = [];
  if (!variantVideoReference) blockers.push("instagram_reels_native_variant_missing");
  if (variantVideoReference && !variantCaptionsReference) {
    blockers.push("instagram_reels_native_variant_captions_missing");
  }
  if (
    variantVideoReference &&
    encoderProfile !== "instagram_reels_meta_safe_h264_aac_v3"
  ) {
    blockers.push("instagram_reels_native_variant_not_meta_safe");
  }
  return blockers;
}

function buildPlatformAction(story, platform, platformOperationalConfig = null) {
  const outputs = story.platform_publish_manifest.outputs || {};
  const platformConfig = outputs[platform] || {};
  const artifactDir = story.artifact_dir;
  const publicCopy = platformActionPublicCopy({
    platform,
    platformConfig,
    canonical: story.canonical,
    outputs,
  });
  const title = publicCopy.title;
  const durationWindowCandidate =
    platformConfig.publish_duration_seconds ||
    platformConfig.duration_seconds ||
    null;
  const durationWindow =
    durationWindowCandidate && typeof durationWindowCandidate === "object" && !Array.isArray(durationWindowCandidate)
      ? durationWindowCandidate
      : null;
  const videoDurationS = numberOrNull(
    platformConfig.technical_duration_seconds ||
      platformConfig.variant_duration_seconds ||
      platformConfig.platform_variant_render?.duration_s ||
      platformConfig.platform_variant_render?.rendered_duration_s ||
      story.render_manifest.rendered_duration_s ||
      story.render_manifest.duration_s ||
      story.render_manifest.video_duration_s,
  );
  const variantVideoReference = cleanText(
    platformConfig.variant_video_path ||
      platformConfig.platform_video_path ||
      platformConfig.video_path ||
      platformConfig.platform_variant_render?.output_path ||
      platformConfig.platform_variant_render?.video_path,
  );
  const variantCaptionsReference = cleanText(
    platformConfig.variant_captions_path ||
      platformConfig.platform_captions_path ||
      platformConfig.captions_path ||
      platformConfig.platform_variant_render?.captions_path,
  );
  const videoPath = variantVideoReference
    ? resolveArtifactReference(artifactDir, variantVideoReference)
    : path.join(artifactDir, "visual_v4_render.mp4");
  const captionsPath = variantVideoReference && variantCaptionsReference
    ? resolveArtifactReference(artifactDir, variantCaptionsReference)
    : path.join(artifactDir, "captions.srt");
  const operationalState = platformOperationalState(platformOperationalConfig, platform);
  const platformEnabled = platformReadyNow(operationalState);
  const blockers = [];
  const creatorRewardsWindow = platformConfig.creator_rewards_duration_seconds ||
    platformConfig.platform_variant_render?.creator_rewards_duration_seconds ||
    { min: 61, max: 90 };
  const creatorRewardsMin = numberOrNull(creatorRewardsWindow.min);
  const creatorRewardsMax = numberOrNull(creatorRewardsWindow.max);
  const creatorRewardsVariantReady =
    platform === "tiktok" &&
    cleanText(platformConfig.platform_variant_render?.variant_type) === "tiktok_creator_rewards" &&
    variantVideoReference &&
    variantCaptionsReference &&
    videoDurationS != null &&
    creatorRewardsMin != null &&
    creatorRewardsMax != null &&
    videoDurationS >= creatorRewardsMin &&
    videoDurationS <= creatorRewardsMax &&
    fs.existsSync(videoPath) &&
    fs.existsSync(captionsPath);
  const warnings = Array.from(new Set([
    ...asArray(platformConfig.duration_warnings || platformConfig.warnings),
    ...asArray(story.warnings),
  ])).filter((warning) => !(creatorRewardsVariantReady && warning === "below_creator_rewards_duration"));
  if (variantVideoReference && !fs.existsSync(videoPath)) {
    blockers.push(`platform_variant_missing:${platform}`);
  }
  if (variantVideoReference && !variantCaptionsReference) {
    blockers.push(`platform_variant_captions_missing:${platform}`);
  } else if (variantVideoReference && !fs.existsSync(captionsPath)) {
    blockers.push(`platform_variant_captions_missing:${platform}`);
  }
  blockers.push(
    ...platformVariantFreshnessBlockers({
      platform,
      platformConfig,
      renderManifest: story.render_manifest,
    }),
  );
  blockers.push(
    ...instagramReelsNativeVariantBlockers({
      platform,
      platformConfig,
      platformEnabled,
    }),
  );
  if (durationWindow && videoDurationS != null) {
    const min = numberOrNull(durationWindow.min);
    const max = numberOrNull(durationWindow.max);
    if (platformEnabled && min != null && videoDurationS < min) {
      blockers.push(`platform_duration_below_min:${platform}:${min}`);
    } else if (!platformEnabled && min != null && videoDurationS < min) {
      warnings.push(`platform_duration_deferred_until_enabled:${platform}:${min}`);
    }
    if (platformEnabled && max != null && videoDurationS > max) {
      blockers.push(`platform_duration_above_max:${platform}:${max}`);
    } else if (!platformEnabled && max != null && videoDurationS > max) {
      warnings.push(`platform_duration_deferred_until_enabled:${platform}:${max}`);
    }
  }
  return {
    story_id: story.story_id,
    platform,
    action: blockers.length ? "blocked" : platformEnabled ? "would_publish" : "would_queue_when_enabled",
    mode: "DRY_RUN_PUBLISH",
    title,
    video_path: videoPath,
    captions_path: captionsPath,
    cover_frame_source: videoPath,
    canonical_manifest_path: artifactDir ? path.join(artifactDir, "canonical_story_manifest.json") : "",
    platform_publish_manifest_path: artifactDir ? path.join(artifactDir, "platform_publish_manifest.json") : "",
    cover_headline: publicCopy.cover_headline || null,
    description: publicCopy.description,
    caption: publicCopy.caption,
    page_caption: publicCopy.page_caption,
    landing_page_slug:
      story.landing_page_manifest.landing_page_slug ||
      story.landing_page_manifest.slug ||
      null,
    disclosure_requirements:
      story.platform_policy_report.disclosure_requirements ||
      story.platform_policy_report.disclosures ||
      {},
    duration_window: durationWindow,
    strategic_duration_window: platformConfig.duration_seconds || null,
    video_duration_s: videoDurationS,
    platform_variant_render_generated_at:
      platformConfig.platform_variant_render?.generated_at ||
      platformConfig.platform_variant_render?.generatedAt ||
      platformConfig.platform_variant_materialized_at ||
      null,
    platform_variant_source_duration_s:
      platformConfig.platform_variant_render?.source_duration_s ||
      platformConfig.platform_variant_render?.source_render_duration_s ||
      platformConfig.platform_variant_render?.base_duration_s ||
      null,
    duration_strategy: platformConfig.duration_strategy || null,
    creator_rewards_eligible: platformConfig.creator_rewards_eligible === true || creatorRewardsVariantReady,
    platform_enabled: platformEnabled,
    platform_operational_state: operationalState?.state || null,
    platform_operational_reason: operationalState?.reason || null,
    platform_enablement_gaps: uniqueCleanStrings(operationalState?.enablement_gaps),
    platform_enablement_next_action: operationalState?.enablement_next_action || null,
    warnings,
    blockers,
    no_network_upload: true,
  };
}

function cleanEnabledActionReadyForGuardedDispatch(action = {}) {
  return Boolean(
    cleanText(action.action) === "would_publish" &&
    action.platform_enabled === true &&
    asArray(action.blockers).length === 0 &&
    asArray(action.warnings).length === 0 &&
    cleanText(action.video_path) &&
    cleanText(action.captions_path) &&
    cleanText(action.canonical_manifest_path) &&
    cleanText(action.platform_publish_manifest_path)
  );
}

function platformActionStatus({ publishNowCount = 0, deferredCount = 0, blockedCount = 0 } = {}) {
  if (blockedCount > 0) return "blocked";
  if (deferredCount > 0) return "deferred_until_platform_enabled";
  if (publishNowCount > 0) return "ready_now";
  return "no_ready_actions";
}

function withDryRunLiveGate(action = {}, readiness = {}) {
  const actionType = cleanText(action.action);
  const publishCandidate = actionType === "would_publish";
  const deferredCandidate = actionType === "would_queue_when_enabled";
  const blockedCandidate = actionType === "blocked";
  const readyForGuardedDispatch = cleanEnabledActionReadyForGuardedDispatch(action);
  const readinessReasons = uniqueCleanStrings(asArray(readiness.readiness_reasons));
  const requiresHumanReview = publishCandidate && !readyForGuardedDispatch;
  let liveExecutionGate = "dry_run_only_guarded_live_mode_required";
  let liveExecutionGateReasons = [];
  if (blockedCandidate) {
    liveExecutionGate = "blocked";
    liveExecutionGateReasons = uniqueCleanStrings(asArray(action.blockers));
  } else if (deferredCandidate) {
    liveExecutionGate = "platform_enablement_required";
    liveExecutionGateReasons = uniqueCleanStrings([
      action.platform_operational_reason,
      ...asArray(action.platform_enablement_gaps),
    ]);
  } else if (readyForGuardedDispatch) {
    liveExecutionGate = "guarded_dispatch_ready";
    liveExecutionGateReasons = [];
  } else if (requiresHumanReview) {
    liveExecutionGate = "operator_human_review_required";
    liveExecutionGateReasons = uniqueCleanStrings([
      ...asArray(action.warnings),
      ...readinessReasons,
    ]);
  }
  return {
    ...action,
    live_publish_allowed_from_dry_run: false,
    requires_human_review_before_live_publish: requiresHumanReview,
    live_execution_gate: liveExecutionGate,
    live_execution_gate_reasons: liveExecutionGateReasons,
    autonomous_green_lit_by_dry_run: readyForGuardedDispatch,
    requires_guarded_dispatch_command: publishCandidate,
    requires_enabled_platform_recheck: publishCandidate,
  };
}

function buildPlatformStatusEvidence({
  generatedAt,
  actions = [],
  blockedActions = [],
  platformOperationalConfig = null,
} = {}) {
  const platformEntries = {};
  for (const platform of PLATFORMS) {
    const platformActions = asArray(actions).filter((action) => action.platform === platform);
    const platformBlockedActions = asArray(blockedActions).filter((action) => action.platform === platform);
    const publishNow = platformActions.filter((action) => action.action === "would_publish");
    const deferred = platformActions.filter((action) => action.action === "would_queue_when_enabled");
    const humanReviewRequired = platformActions.filter((action) => action.requires_human_review_before_live_publish === true);
    const livePublishAllowed = platformActions.filter((action) => action.live_publish_allowed_from_dry_run === true);
    const operationalState =
      platformActions[0]?.platform_operational_state ||
      platformBlockedActions[0]?.platform_operational_state ||
      platformOperationalState(platformOperationalConfig, platform)?.state ||
      "unknown_missing_platform_operational_report";
    const operationalDetails = platformOperationalState(platformOperationalConfig, platform);
    const operationalReason =
      platformActions[0]?.platform_operational_reason ||
      platformBlockedActions[0]?.platform_operational_reason ||
      operationalDetails?.reason ||
      (!operationalDetails
        ? "platform_operational_state_missing"
        : null);
    const enablementGaps = uniqueCleanStrings([
      ...platformActions.flatMap((action) => asArray(action.platform_enablement_gaps)),
      ...platformBlockedActions.flatMap((action) => asArray(action.platform_enablement_gaps)),
      ...asArray(operationalDetails?.enablement_gaps),
    ]);
    const enablementNextAction =
      platformActions.find((action) => cleanText(action.platform_enablement_next_action))?.platform_enablement_next_action ||
      platformBlockedActions.find((action) => cleanText(action.platform_enablement_next_action))?.platform_enablement_next_action ||
      operationalDetails?.enablement_next_action ||
      null;
    platformEntries[platform] = {
      platform,
      status: platformActionStatus({
        publishNowCount: publishNow.length,
        deferredCount: deferred.length,
        blockedCount: platformBlockedActions.length,
      }),
      operational_state: operationalState,
      operational_reason: operationalReason,
      publishable_now_count: publishNow.length,
      publish_now_action_count: publishNow.length,
      enabled_dry_run_action_count: publishNow.length,
      human_review_required_action_count: humanReviewRequired.length,
      live_publish_allowed_action_count: livePublishAllowed.length,
      queued_when_enabled_count: deferred.length,
      deferred_action_count: deferred.length,
      blocked_action_count: platformBlockedActions.length,
      planned_story_ids: platformActions.map((action) => action.story_id),
      blocked_story_ids: platformBlockedActions.map((action) => action.story_id),
      blockers: Array.from(new Set(platformBlockedActions.flatMap((action) => asArray(action.blockers)))),
      warnings: Array.from(new Set(platformActions.flatMap((action) => asArray(action.warnings)))),
      live_execution_gate_reasons: uniqueCleanStrings(platformActions.flatMap((action) =>
        asArray(action.live_execution_gate_reasons),
      )),
      enablement_gaps: enablementGaps,
      enablement_next_action: enablementNextAction,
    };
  }
  const blockedActionCount = Object.values(platformEntries).reduce(
    (total, platform) => total + platform.blocked_action_count,
    0,
  );
  const deferredActionCount = Object.values(platformEntries).reduce(
    (total, platform) => total + platform.deferred_action_count,
    0,
  );
  const publishNowActionCount = Object.values(platformEntries).reduce(
    (total, platform) => total + platform.publish_now_action_count,
    0,
  );
  const humanReviewRequiredActionCount = Object.values(platformEntries).reduce(
    (total, platform) => total + platform.human_review_required_action_count,
    0,
  );
  const livePublishAllowedActionCount = Object.values(platformEntries).reduce(
    (total, platform) => total + platform.live_publish_allowed_action_count,
    0,
  );
  const disabledPlatformCount = Object.values(platformEntries).filter((platform) =>
    ["blocked", "blocked_external", "disabled", "needs_credentials"].includes(platform.operational_state),
  ).length;
  const unknownPlatformCount = Object.values(platformEntries).filter((platform) =>
    ["assumed_enabled", "unknown", "unknown_missing_platform_operational_report"].includes(platform.operational_state),
  ).length;
  const overallVerdict = blockedActionCount > 0
    ? "RED"
    : deferredActionCount > 0 || disabledPlatformCount > 0 || unknownPlatformCount > 0
      ? "AMBER"
      : "GREEN";
  return {
    schema_version: 1,
    generated_at: generatedAt,
    overall_verdict: overallVerdict,
    summary: {
      platform_count: PLATFORMS.length,
      publish_now_action_count: publishNowActionCount,
      platform_enabled_dry_run_action_count: publishNowActionCount,
      human_review_required_action_count: humanReviewRequiredActionCount,
      live_publish_allowed_action_count: livePublishAllowedActionCount,
      deferred_action_count: deferredActionCount,
      blocked_action_count: blockedActionCount,
      disabled_platform_count: disabledPlatformCount,
      unknown_platform_count: unknownPlatformCount,
    },
    platforms: platformEntries,
    safety: {
      dry_run_only: true,
      no_network_uploads: true,
      no_public_posts: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

function buildSafePublishPlan({ readiness = {}, actions = [], blockedActions = [], heldStories = [] } = {}) {
  const publishReadyActions = asArray(actions).filter((action) => action.action === "would_publish");
  const humanReviewRequiredActions = publishReadyActions.filter(
    (action) => action.requires_human_review_before_live_publish === true,
  );
  const guardedDispatchReadyActions = publishReadyActions.filter(
    (action) => action.live_execution_gate === "guarded_dispatch_ready",
  );
  const deferredActions = asArray(actions).filter((action) => action.action === "would_queue_when_enabled");
  let requiredNextStep = "switch_to_guarded_live_mode_after_final_operator_check";
  if (asArray(blockedActions).length > 0) {
    requiredNextStep = "repair_blocked_platform_actions";
  } else if (guardedDispatchReadyActions.length > 0) {
    requiredNextStep = "run_guarded_dispatch_preflight_for_enabled_actions";
  } else if (asArray(heldStories).length > 0) {
    requiredNextStep = "repair_or_reject_held_stories_before_unattended_publish";
  } else if (publishReadyActions.length === 0 && deferredActions.length === 0) {
    requiredNextStep = "rebuild_fresh_green_candidate_buffer";
  } else if (humanReviewRequiredActions.length > 0) {
    requiredNextStep = "operator_human_review_for_enabled_actions";
  } else if (deferredActions.length > 0) {
    requiredNextStep = "enable_deferred_platforms_or_publish_enabled_platforms_with_approval";
  }
  return {
    schema_version: 1,
    mode: "DRY_RUN_PUBLISH",
    live_publish_allowed_from_this_plan: false,
    ready_for_unattended_publish: readiness.ready_for_unattended_publish === true,
    required_next_step: requiredNextStep,
    publish_ready_action_count: publishReadyActions.length,
    human_review_required_action_count: humanReviewRequiredActions.length,
    guarded_dispatch_ready_action_count: guardedDispatchReadyActions.length,
    deferred_action_count: deferredActions.length,
    blocked_action_count: asArray(blockedActions).length,
    live_publish_allowed_action_count: 0,
    readiness_reasons: uniqueCleanStrings(asArray(readiness.readiness_reasons)),
  };
}

function buildDryRunReadiness({
  blockedStories = [],
  blockedActions = [],
  deferredActions = [],
  disasterUploadBlockers = [],
  heldStories = [],
  publishNowActions = [],
  warningActions = [],
} = {}) {
  const reasons = [];
  if (asArray(disasterUploadBlockers).length > 0) reasons.push("incident_guard_failed");
  if (asArray(blockedStories).length > 0) reasons.push("stories_blocked");
  if (asArray(blockedActions).length > 0) reasons.push("platform_actions_blocked");
  if (asArray(deferredActions).length > 0) reasons.push("platform_actions_deferred_until_enabled");
  if (asArray(heldStories).length > 0) reasons.push("stories_quarantined_or_operator_held");
  if (asArray(warningActions).length > 0) reasons.push("platform_or_preflight_warnings");
  if (
    asArray(publishNowActions).length === 0 &&
    asArray(deferredActions).length === 0 &&
    asArray(blockedActions).length === 0 &&
    asArray(heldStories).length === 0 &&
    asArray(disasterUploadBlockers).length === 0
  ) {
    reasons.push("no_enabled_platform_publish_actions");
  }
  const hasRed = reasons.some((reason) =>
    ["incident_guard_failed", "stories_blocked", "platform_actions_blocked"].includes(reason),
  );
  const verdict = hasRed ? "RED" : reasons.length > 0 ? "AMBER" : "GREEN";
  return {
    overall_verdict: verdict,
    readiness_reasons: reasons,
    ready_for_unattended_publish: verdict === "GREEN",
  };
}

function buildPublicOutputCoherenceReport(plan = {}) {
  const heldStoryIds = new Set(asArray(plan.held_story_ids).map((storyId) => String(storyId)));
  const skippedStoryIds = new Set(asArray(plan.skipped_story_ids).map((storyId) => String(storyId)));
  const stories = asArray(plan.incident_guard_report?.stories).map((story) => ({
    story_id: story.story_id,
    artifact_dir: story.artifact_dir,
    verdict: story.public_output_coherence_report?.verdict || "missing",
    blockers: asArray(story.public_output_coherence_report?.blockers),
  })).map((story) => {
    const storyId = String(story.story_id);
    const quarantineStatus = heldStoryIds.has(storyId)
      ? "held"
      : skippedStoryIds.has(storyId)
        ? "skipped"
        : null;
    return {
      ...story,
      readiness_scope: quarantineStatus ? "quarantined" : "active",
      quarantine_status: quarantineStatus,
    };
  });
  const failed = stories.filter((story) => story.verdict !== "pass" || story.blockers.length > 0);
  const activeStories = stories.filter((story) => story.readiness_scope === "active");
  const activeFailed = activeStories.filter((story) => story.verdict !== "pass" || story.blockers.length > 0);
  const quarantinedStories = stories.filter((story) => story.readiness_scope === "quarantined");
  const quarantinedFailed = quarantinedStories.filter(
    (story) => story.verdict !== "pass" || story.blockers.length > 0,
  );
  return {
    schema_version: 1,
    generated_at: plan.generated_at || new Date().toISOString(),
    verdict: failed.length ? "fail" : "pass",
    active_verdict: activeFailed.length ? "fail" : "pass",
    story_count: stories.length,
    active_story_count: activeStories.length,
    quarantined_story_count: quarantinedStories.length,
    failed_story_count: failed.length,
    active_failed_story_count: activeFailed.length,
    quarantined_failed_story_count: quarantinedFailed.length,
    stories,
  };
}

function buildPublishVerdictSummary(plan = {}) {
  const incidentFailed = Number(plan.summary?.incident_guard_failed_story_count || 0);
  const blockedStories = Number(plan.summary?.blocked_story_count || 0);
  const heldStories = Number(plan.summary?.held_story_count || 0);
  const blockedActions = Number(plan.summary?.blocked_action_count || 0);
  const deferredActions = Number(plan.summary?.platform_deferred_action_count || 0);
  const safe = plan.ready_for_unattended_publish === true;
  const blockers = [];
  if (incidentFailed > 0) blockers.push("incident_guard_failed");
  if (blockedStories > 0) blockers.push("stories_blocked");
  if (heldStories > 0) blockers.push("stories_quarantined_or_operator_held");
  if (blockedActions > 0) blockers.push("platform_actions_blocked");
  if (deferredActions > 0) blockers.push("platform_actions_deferred_until_enabled");
  return {
    schema_version: 1,
    generated_at: plan.generated_at || new Date().toISOString(),
    verdict: safe ? "GREEN" : plan.overall_verdict || "RED",
    safe_to_publish_boolean: safe,
    mode: plan.mode || "DRY_RUN_PUBLISH",
    blockers,
    summary: plan.summary || {},
    safety: plan.safety || {},
  };
}

function titlePattern(title = "") {
  const match = cleanText(title).match(/\b(Deal .+|Just .+|Finally .+|May .+|Now .+|Is .+)$/);
  return match ? match[1] : "";
}

function titleFingerprint(title = "") {
  return cleanText(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TITLE_SIMILARITY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "already",
  "got",
  "has",
  "have",
  "is",
  "its",
  "just",
  "new",
  "now",
  "of",
  "one",
  "real",
  "the",
  "to",
]);

const STALE_TEMPORAL_SKIP_DECISIONS = new Set([
  "reject_stale_current_news_candidate",
  "defer_until_new_source_updates_story",
]);

const VISUAL_SOURCE_SKIP_DECISIONS = new Set([
  "reject_visually_unsupported_candidate",
  "defer_until_rights_backed_media_available",
]);

function titleTokens(title = "") {
  return titleFingerprint(title)
    .split(/\s+/)
    .filter((token) => token && !TITLE_SIMILARITY_STOP_WORDS.has(token));
}

function titleSubjectKey(value = "") {
  return titleTokens(value)
    .filter((token) => token.length > 1)
    .slice(0, 6)
    .join(" ");
}

function titleBeatKey(title = "") {
  const tokens = new Set(titleTokens(title));
  const hasAny = (words) => words.some((word) => tokens.has(word));
  if (hasAny(["score", "scores", "review", "reviews", "rated", "metacritic"])) return "review_score";
  if (hasAny(["delay", "delayed", "date", "launch", "release", "window"])) return "release_timing";
  if (hasAny(["roadmap", "season", "battle", "pass", "update", "patch"])) return "roadmap_update";
  if (hasAny(["layoff", "layoffs", "jobs", "vanished", "cuts", "closure", "closed"])) return "business_jobs";
  if (hasAny(["remake", "remaster", "remastered", "restoration", "revival"])) return "remake_remaster";
  if (hasAny(["trailer", "reveal", "reveals", "revealed", "demo", "gameplay", "fight", "combat", "loop", "mechanic", "weapon"])) {
    return "gameplay_reveal";
  }
  return "";
}

function storyFamilySignature(story = {}, title = "") {
  const subject = titleSubjectKey(
    story.canonical?.canonical_subject ||
      story.canonical?.subject ||
      story.canonical?.game_title ||
      story.canonical?.title ||
      title,
  );
  const beat = titleBeatKey(title);
  if (!subject || !beat) return "";
  return `${subject}:${beat}`;
}

function staleTemporalReviewResolution(review = null, storyId = "", incidentGuard = {}) {
  if (!review || typeof review !== "object") return null;
  const reviewStoryId = cleanText(review.story_id || review.id);
  if (reviewStoryId && storyId && reviewStoryId !== storyId) return null;
  const decision = cleanText(review.decision || review.verdict || review.status);
  if (!STALE_TEMPORAL_SKIP_DECISIONS.has(decision)) return null;
  const blockers = asArray(incidentGuard.disaster_upload_blockers).map(cleanText);
  const staleIncident = blockers.some((blocker) =>
    blocker === "incident:stale_temporal_claim" || blocker === "incident:current_wording_on_old_event",
  );
  if (!staleIncident) return null;
  return {
    skip_status: decision.startsWith("reject_")
      ? "stale_temporal_rejected"
      : "stale_temporal_deferred",
    skip_reason: decision,
  };
}

function staleVisualSourceDeferSuperseded(review = null, evidence = {}) {
  const decision = cleanText(review?.decision || review?.verdict || review?.status);
  if (decision !== "defer_until_rights_backed_media_available") return false;
  const reviewGeneratedAt = timeMs(review?.generated_at || review?.generatedAt || review?.checked_at);
  const renderGeneratedAt = timeMs(evidence.render_manifest?.generated_at || evidence.render_manifest?.rendered_at);
  if (!reviewGeneratedAt || !renderGeneratedAt || reviewGeneratedAt >= renderGeneratedAt) return false;

  const fileEvidence = evidence.file_evidence || {};
  const visualEvidence = evidence.visual_evidence || {};
  const directVideoCount = Number(visualEvidence.direct_video_motion_asset_count);
  const realMotionCount = Number(visualEvidence.real_motion_asset_count);
  const realFamilyCount = Number(visualEvidence.real_media_family_count);
  return (
    fileEvidence.mp4_ready === true &&
    fileEvidence.materialised_motion_ready === true &&
    fileEvidence.distinct_motion_families_ready === true &&
    fileEvidence.rights_ledger_ready === true &&
    visualEvidence.generated_only_motion_deck !== true &&
    Number.isFinite(directVideoCount) &&
    directVideoCount >= 1 &&
    Number.isFinite(realMotionCount) &&
    realMotionCount >= 3 &&
    Number.isFinite(realFamilyCount) &&
    realFamilyCount >= 3
  );
}

function visualSourceReviewResolution(review = null, storyId = "", evidence = {}) {
  if (!review || typeof review !== "object") return null;
  const reviewStoryId = cleanText(review.story_id || review.id);
  if (reviewStoryId && storyId && reviewStoryId !== storyId) return null;
  const decision = cleanText(review.decision || review.verdict || review.status);
  if (!VISUAL_SOURCE_SKIP_DECISIONS.has(decision)) return null;
  if (staleVisualSourceDeferSuperseded(review, evidence)) return null;
  return {
    skip_status: decision.startsWith("reject_")
      ? "visual_source_rejected"
      : "visual_source_deferred",
    skip_reason: decision,
  };
}

function titleSimilarityScore(a = "", b = "") {
  const left = new Set(titleTokens(a));
  const right = new Set(titleTokens(b));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) intersection += 1;
  }
  return intersection / Math.max(left.size, right.size);
}

function applyTitlePatternGate(stories = [], maxPerPattern = 3) {
  const counts = new Map();
  for (const story of stories) {
    if (story.blockers.length) continue;
    const title = cleanText(
      story.canonical.selected_title ||
        story.canonical.short_title ||
        story.canonical.canonical_title ||
        story.canonical.title ||
        story.canonical.canonical_subject,
    );
    const pattern = titlePattern(title);
    if (!pattern) continue;
    const count = counts.get(pattern) || 0;
    counts.set(pattern, count + 1);
    if (count >= maxPerPattern) {
      story.blockers.push(`title_pattern_repeated:${pattern}`);
    }
  }
  return stories;
}

function applyTitleUniquenessGate(stories = []) {
  const seen = new Map();
  const seenFamilies = new Map();
  for (const story of stories) {
    if (story.blockers.length) continue;
    const title = cleanText(
      story.canonical.selected_title ||
        story.canonical.short_title ||
        story.canonical.canonical_title ||
        story.canonical.title ||
        story.canonical.canonical_subject,
    );
    const fingerprint = titleFingerprint(title);
    if (!fingerprint) continue;
    const familySignature = storyFamilySignature(story, title);
    const exact = seen.get(fingerprint);
    if (exact) {
      story.blockers.push(`title_duplicate:${exact.title}`);
      continue;
    }
    for (const previous of seen.values()) {
      const similarity = titleSimilarityScore(title, previous.title);
      if (similarity >= 0.86) {
        story.blockers.push(`title_too_similar:${previous.title}`);
        break;
      }
    }
    const family = familySignature ? seenFamilies.get(familySignature) : null;
    if (!story.blockers.length && family) {
      story.blockers.push(`story_family_too_similar:${family.title}`);
    }
    if (story.blockers.length === 0) {
      seen.set(fingerprint, { title, story_id: story.story_id });
      if (familySignature) {
        seenFamilies.set(familySignature, { title, story_id: story.story_id });
      }
    }
  }
  return stories;
}

function preflightCandidateMap(report = {}) {
  const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
  return new Map(
    candidates
      .filter((candidate) => candidate && candidate.id)
      .map((candidate) => [String(candidate.id), candidate]),
  );
}

function preflightExcludedMap(report = {}) {
  const excluded = Array.isArray(report?.excluded) ? report.excluded : [];
  return new Map(
    excluded
      .filter((item) => item && item.id)
      .map((item) => [String(item.id), item]),
  );
}

function normalizedCandidateIdentity(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateIdentityKeys(candidate = {}) {
  return uniqueCleanStrings([
    candidate.title,
    candidate.selected_title,
    candidate.short_title,
    candidate.canonical_subject,
    candidate.canonical_game,
    candidate.source?.title,
    candidate.source?.selected_title,
    candidate.source?.short_title,
    candidate.source?.canonical_subject,
    candidate.source?.canonical_game,
  ].map(normalizedCandidateIdentity)).filter((value) => value.length >= 8);
}

function inspectedStoryIdentityKeys(story = {}) {
  const canonical = story.canonical || {};
  return uniqueCleanStrings([
    canonical.selected_title,
    canonical.short_title,
    canonical.title,
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.primary_entity,
  ].map(normalizedCandidateIdentity)).filter((value) => value.length >= 8);
}

function upperClean(value) {
  return cleanText(value).toUpperCase();
}

function schedulerBridgeCandidateHasPublishReadyEvidence(candidate = {}) {
  const explicitStatus = cleanText(candidate.status).toLowerCase();
  if (explicitStatus && explicitStatus !== "publish_ready") return false;
  if (cleanText(candidate.publish_status)) return false;
  if (candidate.approved !== true || candidate.auto_approved !== true) return false;
  if (candidate.qa_failed === true) return false;
  if (
    asArray(candidate.qa_failures).length ||
    asArray(candidate.video_qa_failures).length ||
    asArray(candidate.content_qa_failures).length
  ) {
    return false;
  }
  if (upperClean(candidate.governance_publish_status) !== "GREEN") return false;
  if (upperClean(candidate.platform_publish_manifest?.publish_status) !== "GREEN") return false;
  if (candidate.platform_publish_manifest?.can_auto_publish !== true) return false;
  if (upperClean(candidate.publish_verdict?.verdict) !== "GREEN") return false;
  if (candidate.publish_verdict?.can_auto_publish !== true) return false;
  if (upperClean(candidate.publish_manifest?.publish_status) !== "GREEN") return false;
  if (candidate.publish_manifest?.can_auto_publish !== true) return false;
  if (cleanText(candidate.visual_v4_render_bridge_status) !== "ready_for_live_cutover") return false;
  if (cleanText(candidate.render_lane) !== "visual_v4_production") return false;
  if (cleanText(candidate.render_quality_class) !== "premium") return false;
  if (!cleanText(candidate.exported_path) || !cleanText(candidate.caption_path)) return false;
  if (candidate.manual_caption_generated !== true || candidate.clean_manual_captions !== true) return false;
  if (cleanText(candidate.subtitle_timing_source) !== "timestamps") return false;
  if (Number(candidate.visual_v4_render_bridge_clip_count || 0) <= 0) return false;
  if (cleanText(candidate.benchmark_report?.result) !== "pass") return false;
  if (cleanText(candidate.visual_quality_report?.result) !== "pass") return false;
  if (asArray(candidate.benchmark_report?.failures).length) return false;
  if (asArray(candidate.visual_quality_report?.failures).length) return false;
  return true;
}

function preflightCandidateIsPublishReady(candidate = {}) {
  if (!candidate || typeof candidate !== "object") return false;
  const preflightQa = candidate.preflight_qa || {};
  const status = cleanText(preflightQa.status || preflightQa.result || "").toLowerCase();
  const blockers = uniqueCleanStrings([
    ...asArray(preflightQa.blockers),
    ...asArray(preflightQa.failures),
    ...asArray(preflightQa.errors),
  ]);
  return (
    (candidate.status === "publish_ready" || schedulerBridgeCandidateHasPublishReadyEvidence(candidate)) &&
    (!status || status === "pass") &&
    blockers.length === 0
  );
}

function publishReadyReplacementCandidateMap(report = {}) {
  const map = new Map();
  const candidates = Array.isArray(report?.candidates) ? report.candidates : [];
  for (const candidate of candidates) {
    if (!preflightCandidateIsPublishReady(candidate)) continue;
    const id = cleanText(candidate.id || candidate.story_id);
    if (!id) continue;
    for (const key of candidateIdentityKeys(candidate)) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(candidate);
    }
  }
  return map;
}

function publishReadyReplacementForStory(story = {}, candidate = {}, replacementsByIdentity = new Map()) {
  const storyId = cleanText(story.story_id || story.id);
  const candidateId = cleanText(candidate?.id || candidate?.story_id);
  const keys = uniqueCleanStrings([
    ...inspectedStoryIdentityKeys(story),
    ...candidateIdentityKeys(candidate),
  ]);
  for (const key of keys) {
    const replacements = replacementsByIdentity.get(key) || [];
    const replacement = replacements.find((item) => {
      const replacementId = cleanText(item?.id || item?.story_id);
      return replacementId && replacementId !== storyId && replacementId !== candidateId;
    });
    if (replacement) return replacement;
  }
  return null;
}

function upstreamSkippedPreflightExclusion(reason = "") {
  const text = cleanText(reason);
  if (!text.toLowerCase().startsWith("upstream_skipped:")) return null;
  const rest = text.slice("upstream_skipped:".length);
  const separator = rest.indexOf(":");
  const status = separator >= 0 ? rest.slice(0, separator) : rest;
  const skippedReason = separator >= 0 ? rest.slice(separator + 1) : "upstream_skipped";
  return {
    skip_status: cleanText(status) || "upstream_skipped",
    skip_reason: cleanText(skippedReason) || "upstream_skipped",
  };
}

function repairWorkOrderDeadEndMap(repairWorkOrder = null) {
  const jobs = Array.isArray(repairWorkOrder?.jobs) ? repairWorkOrder.jobs : [];
  return new Map(
    jobs
      .filter((job) => job && cleanText(job.story_id))
      .map((job) => {
        const actions = asArray(job.actions);
        const deadEndActions = actions.filter((action) => action.dead_end_blocker === true);
        const operatorRequired = actions.some((action) => action.operator_approval_required === true);
        if (!deadEndActions.length) return null;
        return [
          String(job.story_id),
          {
            status: cleanText(job.status || "blocked_on_render_inputs"),
            action_ids: deadEndActions.map((action) => cleanText(action.action_id)).filter(Boolean),
            repair_lanes: Array.from(new Set(deadEndActions.map((action) => cleanText(action.repair_lane)).filter(Boolean))),
            operator_approval_required: operatorRequired || deadEndActions.some((action) => action.operator_approval_required === true),
          },
        ];
      })
      .filter(Boolean),
  );
}

function repairLaneRequiresOperatorSourceReview(action = {}) {
  const lane = cleanText(action.repair_lane).toLowerCase();
  const missingInput = cleanText(action.exact_missing_input).toLowerCase();
  return (
    lane === "real_visual_media_required_after_owned_explainer_deck_failed_benchmark" ||
    lane === "additional_direct_video_motion_required" ||
    lane === "replace_repeated_or_overused_motion_source_family" ||
    lane.includes("human_review") ||
    missingInput.includes("human-review rejection") ||
    missingInput.includes("human review rejection")
  );
}

function repairWorkOrderOperatorHoldMap(repairWorkOrder = null) {
  const jobs = Array.isArray(repairWorkOrder?.jobs) ? repairWorkOrder.jobs : [];
  return new Map(
    jobs
      .filter((job) => job && cleanText(job.story_id))
      .map((job) => {
        const actions = asArray(job.actions).filter((action) =>
          action &&
          action.operator_approval_required === true &&
          action.auto_repairable !== true &&
          action.dead_end_blocker !== true &&
          repairLaneRequiresOperatorSourceReview(action),
        );
        if (!actions.length) return null;
        return [
          String(job.story_id),
          {
            status: cleanText(job.status || "blocked_on_render_inputs"),
            action_ids: actions.map((action) => cleanText(action.action_id)).filter(Boolean),
            repair_lanes: Array.from(new Set(actions.map((action) => cleanText(action.repair_lane)).filter(Boolean))),
            operator_approval_required: true,
          },
        ];
      })
      .filter(Boolean),
  );
}

function repairWorkOrderRequirementMap(repairWorkOrder = null) {
  const jobs = Array.isArray(repairWorkOrder?.jobs) ? repairWorkOrder.jobs : [];
  return new Map(
    jobs
      .filter((job) => job && cleanText(job.story_id))
      .map((job) => {
        const actions = asArray(job.actions);
        return [
          String(job.story_id),
          {
            status: cleanText(job.status || "blocked_on_render_inputs"),
            blockers: asArray(job.blockers).map(cleanText).filter(Boolean),
            requirements: actions.map((action) => ({
              action_id: cleanText(action.action_id),
              status: cleanText(action.status || "required"),
              repair_lane: cleanText(action.repair_lane),
              exact_missing_input: cleanText(action.exact_missing_input),
              recommended_command: cleanText(action.recommended_command),
              post_repair_validation_command: cleanText(action.post_repair_validation_command),
              auto_repairable: action.auto_repairable === true,
              operator_approval_required: action.operator_approval_required === true,
              dead_end_blocker: action.dead_end_blocker === true,
            })).filter((action) => action.action_id || action.repair_lane),
          },
        ];
      }),
  );
}

function upstreamAntiSpamSkipMap(report = null) {
  const stories = Array.isArray(report?.stories) ? report.stories : [];
  return new Map(
    stories
      .filter((story) => story && cleanText(story.story_id || story.id) && cleanText(story.status) === "skipped")
      .map((story) => [
        String(story.story_id || story.id),
        {
          status: cleanText(story.skipped_status || story.skip_status || "upstream_skipped"),
          reason: cleanText(story.skipped_reason || story.skip_reason || "upstream_skipped"),
        },
      ]),
  );
}

function applyUpstreamAntiSpamSkips(stories = [], upstreamAntiSpamReport = null) {
  const skippedById = upstreamAntiSpamSkipMap(upstreamAntiSpamReport);
  if (!skippedById.size) return stories;
  for (const story of stories) {
    if (story.skip_status) continue;
    const skip = skippedById.get(String(story.story_id || ""));
    if (!skip) continue;
    story.skip_status = skip.status || "upstream_skipped";
    story.skip_reason = skip.reason || "upstream_skipped";
  }
  return stories;
}

function applyRepairWorkOrderContext(stories = [], repairWorkOrder = null) {
  const requirementsById = repairWorkOrderRequirementMap(repairWorkOrder);
  if (!requirementsById.size) return stories;
  for (const story of stories) {
    if (story.skip_status) continue;
    const requirement = requirementsById.get(String(story.story_id || ""));
    if (!requirement) continue;
    story.render_input_requirements = requirement.requirements;
    if (!asArray(story.blockers).includes("preflight_candidate_missing")) continue;
    story.blockers = Array.from(new Set([
      ...asArray(story.blockers),
      ...asArray(requirement.blockers).map((blocker) => `render_input_blocked:${blocker}`),
    ]));
  }
  return stories;
}

function applyRepairWorkOrderQuarantine(stories = [], repairWorkOrder = null) {
  const deadEndJobsById = repairWorkOrderDeadEndMap(repairWorkOrder);
  const operatorHoldJobsById = repairWorkOrderOperatorHoldMap(repairWorkOrder);
  if (!deadEndJobsById.size && !operatorHoldJobsById.size) return stories;
  for (const story of stories) {
    if (story.skip_status || !asArray(story.blockers).length) continue;
    const deadEnd = deadEndJobsById.get(String(story.story_id || ""));
    if (deadEnd) {
      if (!story.hold_status) story.hold_status = "quarantined_by_repair_work_order";
      story.hold_reasons = Array.from(new Set([
        ...asArray(story.hold_reasons),
        "dead_end_repair_work_order",
        ...(deadEnd.operator_approval_required ? ["operator_required"] : []),
      ]));
      story.repair_work_order_dead_end = deadEnd;
      continue;
    }
    const operatorHold = operatorHoldJobsById.get(String(story.story_id || ""));
    if (!operatorHold) continue;
    if (!story.hold_status) story.hold_status = "held_for_operator_source_review";
    story.hold_reasons = Array.from(new Set([
      ...asArray(story.hold_reasons),
      ...(asArray(story.blockers).includes("preflight_candidate_missing") ? ["preflight_candidate_missing"] : []),
      "operator_source_review_required",
      "operator_required",
    ]));
    story.repair_work_order_operator_hold = operatorHold;
  }
  return stories;
}

function terminalSchedulerPreflightExclusion(reason = "") {
  const value = cleanText(reason);
  if (/^near_repeat_story_cluster:/i.test(value)) {
    return {
      skip_status: "scheduler_excluded_near_repeat",
      skip_reason: value,
    };
  }
  if (/^qa_failure:/i.test(value)) {
    return {
      skip_status: "scheduler_excluded_qa_failure",
      skip_reason: value,
    };
  }
  return null;
}

function applySchedulerPreflightGate(stories = [], candidatePreflightReport = null, { required = false } = {}) {
  if (!candidatePreflightReport) {
    if (!required) return stories;
    for (const story of stories) {
      if (story.skip_status || story.hold_status) continue;
      story.blockers.push("scheduler_preflight_report_missing");
    }
    return stories;
  }
  const candidatesById = preflightCandidateMap(candidatePreflightReport);
  const excludedById = preflightExcludedMap(candidatePreflightReport);
  const replacementsByIdentity = publishReadyReplacementCandidateMap(candidatePreflightReport);
  for (const story of stories) {
    const blockersBeforePreflight = asArray(story.blockers);
    const candidate = candidatesById.get(String(story.story_id || ""));
    if (!candidate) {
      const excluded = excludedById.get(String(story.story_id || ""));
      const reason = cleanText(excluded?.reason);
      if (/^enabled_platforms_already_public_or_terminal_duplicate:/i.test(reason)) {
        story.skip_reason = reason;
        story.skip_status = "enabled_platforms_already_public_or_terminal_duplicate";
        continue;
      }
      if (/^already_has_public_platform_id:/i.test(reason)) {
        story.skip_reason = reason;
        story.skip_status = "already_public";
        continue;
      }
      const terminalExclusion = terminalSchedulerPreflightExclusion(reason);
      if (terminalExclusion) {
        story.skip_reason = terminalExclusion.skip_reason;
        story.skip_status = terminalExclusion.skip_status;
        continue;
      }
      const upstreamSkipped = upstreamSkippedPreflightExclusion(reason);
      if (upstreamSkipped) {
        story.skip_reason = upstreamSkipped.skip_reason;
        story.skip_status = upstreamSkipped.skip_status;
        continue;
      }
      if (blockersBeforePreflight.length > 0) {
        story.hold_status = "quarantined_before_scheduler_preflight";
        story.hold_reasons = [
          ...asArray(story.hold_reasons),
          "preflight_candidate_missing",
        ];
        continue;
      }
      story.blockers.push("preflight_candidate_missing");
      continue;
    }
    story.scheduler_preflight_candidate = candidate;
    if (candidate.scheduler_quarantine?.status === "held") {
      story.hold_status = story.hold_status || "held_for_scheduler_preflight_repair";
      story.hold_reasons = [
        ...asArray(story.hold_reasons),
        cleanText(candidate.scheduler_quarantine.reason || "scheduler_preflight_repair_required"),
      ].filter(Boolean);
      story.scheduler_quarantine = candidate.scheduler_quarantine;
      continue;
    }
    story.already_published_platforms = uniqueCleanStrings([
      ...asArray(story.already_published_platforms),
      ...asArray(candidate.already_published_platforms),
      ...asArray(candidate.published_platforms),
      ...asArray(candidate.source?.already_published_platforms),
      ...asArray(candidate.source?.published_platforms),
      ...asArray(candidate.source?.public_platform_fields)
        .map((field) => PLATFORM_FIELD_TO_KEY[cleanText(field)])
        .filter(Boolean),
    ]);
    story.terminal_duplicate_blocked_platforms = uniqueCleanStrings([
      ...asArray(story.terminal_duplicate_blocked_platforms),
      ...asArray(candidate.terminal_duplicate_blocked_platforms),
      ...asArray(candidate.source?.terminal_duplicate_blocked_platforms),
      ...asArray(candidate.scheduler_preflight_candidate?.terminal_duplicate_blocked_platforms),
      ...asArray(candidate.scheduler_preflight_candidate?.source?.terminal_duplicate_blocked_platforms),
    ]).map(normalizePlatformKey).filter(Boolean);
    story.missing_enabled_platforms = uniqueCleanStrings([
      ...asArray(story.missing_enabled_platforms),
      ...asArray(candidate.missing_enabled_platforms),
      ...asArray(candidate.source?.missing_enabled_platforms),
    ])
      .map(normalizePlatformKey)
      .filter(Boolean)
      .filter((platform) =>
        !story.already_published_platforms.includes(platform) &&
        !story.terminal_duplicate_blocked_platforms.includes(platform),
      );
    const hasEmbeddedPreflightQa = Boolean(candidate.preflight_qa);
    const candidatePublishReady =
      candidate.status === "publish_ready" ||
      schedulerBridgeCandidateHasPublishReadyEvidence(candidate);
    const preflightStatus = candidate.preflight_qa?.status || (
      candidatePublishReady ? "pass" : "missing"
    );
    if (!candidatePublishReady && (blockersBeforePreflight.length > 0 || preflightStatus !== "pass")) {
      const replacement = publishReadyReplacementForStory(story, candidate, replacementsByIdentity);
      if (replacement) {
        const replacementId = cleanText(replacement.id || replacement.story_id);
        story.hold_status = story.hold_status || "quarantined_by_publish_ready_replacement";
        story.hold_reasons = [
          ...asArray(story.hold_reasons),
          "publish_ready_replacement_exists",
          replacementId ? `replacement_story:${replacementId}` : "",
        ].filter(Boolean);
        story.scheduler_quarantine = {
          status: "held",
          reason: "publish_ready_replacement_exists",
          replacement_story_id: replacementId || null,
        };
        continue;
      }
    }
    const preflightWarnings = asArray(candidate.preflight_qa?.warnings);
    if (preflightWarnings.length) {
      story.warnings = Array.from(new Set([
        ...asArray(story.warnings),
        ...preflightWarnings.map((warning) => `preflight_qa_${preflightStatus}:${cleanText(warning)}`),
      ]));
      const operatorReviewWarnings = preflightWarnings.filter(schedulerWarningRequiresOperatorReview);
      if (operatorReviewWarnings.length) {
        story.hold_status = story.hold_status || "held_for_scheduler_warning";
        story.hold_reasons = [
          ...asArray(story.hold_reasons),
          "preflight_warning_requires_operator_review",
        ];
        story.blockers.push(
          ...operatorReviewWarnings.map((warning) => `preflight_qa_${preflightStatus}:${cleanText(warning)}`),
        );
      }
    }
    if (!candidatePublishReady) {
      story.blockers.push(`preflight_candidate_not_publish_ready:${candidate.status || "unknown"}`);
    }
    if (hasEmbeddedPreflightQa && preflightStatus !== "pass") {
      const blockers = Array.isArray(candidate.preflight_qa?.blockers)
        ? candidate.preflight_qa.blockers
        : [];
      if (blockers.length) {
        for (const blocker of blockers) {
          story.blockers.push(`preflight_qa_${preflightStatus}:${blocker}`);
        }
      } else if (preflightStatus !== "warn") {
        story.blockers.push(`preflight_qa_${preflightStatus}`);
      }
    } else if (!hasEmbeddedPreflightQa && preflightStatus !== "pass") {
      story.blockers.push(`preflight_qa_${preflightStatus}`);
    }
  }
  return stories;
}

function schedulerPreflightCheckedStoryCount(inspected = [], candidatePreflightReport = null) {
  if (!candidatePreflightReport) return 0;
  const inspectedIds = new Set(inspected.map((story) => String(story.story_id || "")).filter(Boolean));
  const checkedIds = new Set(
    inspected
      .filter((story) => story.scheduler_preflight_candidate)
      .map((story) => String(story.story_id || ""))
      .filter(Boolean),
  );
  const storyPreflight = candidatePreflightReport.story_preflight || {};
  const storyPreflightId = cleanText(storyPreflight.story_id || storyPreflight.id);
  if (
    storyPreflightId &&
    inspectedIds.has(storyPreflightId) &&
    storyPreflight.enabled !== false
  ) {
    checkedIds.add(storyPreflightId);
  }
  return checkedIds.size;
}

function schedulerPreflightEvidenceForStory(story = {}) {
  const candidate = story.scheduler_preflight_candidate;
  if (!candidate || typeof candidate !== "object") return null;
  const preflightQa = candidate.preflight_qa || {};
  const bridgeEvidenceReady = schedulerBridgeCandidateHasPublishReadyEvidence(candidate);
  const status = preflightQa.status || (candidate.status === "publish_ready" || bridgeEvidenceReady ? "pass" : "missing");
  return {
    candidate_status: cleanText(candidate.status) || (bridgeEvidenceReady ? "bridge_cutover_ready" : null),
    status: cleanText(status) || null,
    blockers: asArray(preflightQa.blockers).map(cleanText).filter(Boolean),
    warnings: asArray(preflightQa.warnings).map(cleanText).filter(Boolean),
    checks: preflightQa.checks || null,
  };
}

function schedulerWarningRequiresOperatorReview(warning = "") {
  const code = cleanText(warning).toLowerCase();
  return (
    code.startsWith("bridge_motion_governance:") ||
    code.includes("stale_source_family_evidence") ||
    code.includes("source_family_evidence_ignored")
  );
}

function annotatePackagesWithCandidatePreflight(storyPackages = [], candidatePreflightReport = null) {
  if (!candidatePreflightReport) return storyPackages;
  const candidatesById = preflightCandidateMap(candidatePreflightReport);
  if (!candidatesById.size) return storyPackages;
  return storyPackages.map((storyPackage) => {
    if (!storyPackage || typeof storyPackage !== "object") return storyPackage;
    const storyId = cleanText(storyPackage.story_id || storyPackage.id);
    const candidate = candidatesById.get(storyId);
    if (!candidate) return storyPackage;
    const candidatePublishReady =
      candidate.status === "publish_ready" ||
      schedulerBridgeCandidateHasPublishReadyEvidence(candidate);
    const candidatePreflightQa = candidate.preflight_qa || {};
    const preflightStatus = cleanText(
      candidatePreflightQa.status ||
        candidatePreflightQa.result ||
        (candidatePublishReady ? "pass" : "missing"),
    ).toLowerCase();
    const preflightBlockers = uniqueCleanStrings([
      ...asArray(candidatePreflightQa.blockers),
      ...asArray(candidatePreflightQa.failures),
      ...asArray(candidatePreflightQa.errors),
    ]);
    if (!candidatePublishReady || preflightStatus !== "pass" || preflightBlockers.length) {
      return storyPackage;
    }
    return {
      ...storyPackage,
      scheduler_preflight_package_source:
        storyPackage.scheduler_preflight_package_source || "candidate_exported_path",
      scheduler_preflight_status: storyPackage.scheduler_preflight_status || "pass",
      scheduler_preflight_qa: {
        status: "pass",
        blockers: [],
        warnings: asArray(candidatePreflightQa.warnings).map(cleanText).filter(Boolean),
        checks: candidatePreflightQa.checks || null,
      },
    };
  });
}

async function buildGoalDryRunPublishPlan({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  candidatePreflightReport = null,
  requireSchedulerPreflight = false,
  platformOperationalConfig = null,
  motionPackRoot = null,
  repairWorkOrder = null,
  upstreamAntiSpamReport = null,
  publishedPlatformEvidence = null,
  guardedLiveDispatchExecutorReport = null,
} = {}) {
  const inspected = [];
  const packagesWithPreflight = annotatePackagesWithCandidatePreflight(
    asArray(storyPackages),
    candidatePreflightReport,
  );
  for (const storyPackage of packagesWithPreflight) {
    inspected.push(await inspectStoryPackage(storyPackage, { motionPackRoot }));
  }
  applyTitlePatternGate(inspected);
  applyTitleUniquenessGate(inspected);
  applyUpstreamAntiSpamSkips(inspected, upstreamAntiSpamReport);
  applyPublishedPlatformEvidence(inspected, publishedPlatformEvidence);
  applyTerminalDuplicatePlatformEvidence(inspected, guardedLiveDispatchExecutorReport);
  applyEnabledPlatformAlreadyPublishedSkips(inspected, platformOperationalConfig);
  applyEnabledPlatformUnavailableSkips(inspected, platformOperationalConfig);
  applySchedulerPreflightGate(inspected, candidatePreflightReport, {
    required: requireSchedulerPreflight,
  });
  applyPublishedPlatformEvidence(inspected, publishedPlatformEvidence);
  applyTerminalDuplicatePlatformEvidence(inspected, guardedLiveDispatchExecutorReport);
  applyEnabledPlatformAlreadyPublishedSkips(inspected, platformOperationalConfig);
  applyEnabledPlatformUnavailableSkips(inspected, platformOperationalConfig);
  applyRepairWorkOrderContext(inspected, repairWorkOrder);
  applyRepairWorkOrderQuarantine(inspected, repairWorkOrder);
  for (const story of inspected) {
    story.blockers = uniqueCleanStrings(story.blockers);
    story.warnings = uniqueCleanStrings(story.warnings);
    story.hold_reasons = uniqueCleanStrings(story.hold_reasons);
  }
  applyEnabledPlatformAlreadyPublishedSkips(inspected, platformOperationalConfig);
  applyEnabledPlatformUnavailableSkips(inspected, platformOperationalConfig);
  const skippedStories = inspected.filter((story) => story.skip_status);
  const heldStories = inspected.filter((story) => !story.skip_status && story.hold_status);
  const readyStories = inspected.filter((story) => !story.skip_status && !story.hold_status && story.blockers.length === 0);
  const blockedStories = inspected
    .filter((story) => !story.skip_status && !story.hold_status && story.blockers.length > 0)
    .map((story) => ({
      story_id: story.story_id,
      artifact_dir: story.artifact_dir,
      blockers: story.blockers,
      already_published_platforms: asArray(story.already_published_platforms),
      terminal_duplicate_blocked_platforms: asArray(story.terminal_duplicate_blocked_platforms),
      missing_enabled_platforms: asArray(story.missing_enabled_platforms),
      render_input_requirements: asArray(story.render_input_requirements),
      scheduler_preflight: schedulerPreflightEvidenceForStory(story),
      incident_guard: story.incident_guard || null,
    }));
  const heldStoryReports = heldStories.map((story) => ({
    story_id: story.story_id,
    artifact_dir: story.artifact_dir,
    status: story.hold_status,
    hold_reasons: asArray(story.hold_reasons),
    blockers: asArray(story.blockers),
    render_input_requirements: asArray(story.render_input_requirements),
    repair_lanes: uniqueCleanStrings([
      ...asArray(story.repair_work_order_dead_end?.repair_lanes),
      ...asArray(story.repair_work_order_operator_hold?.repair_lanes),
    ]),
    repair_action_ids: uniqueCleanStrings([
      ...asArray(story.repair_work_order_dead_end?.action_ids),
      ...asArray(story.repair_work_order_operator_hold?.action_ids),
    ]),
    operator_approval_required:
      story.repair_work_order_dead_end?.operator_approval_required === true ||
      story.repair_work_order_operator_hold?.operator_approval_required === true,
    scheduler_quarantine: story.scheduler_quarantine || null,
    incident_guard: story.incident_guard || null,
  }));
  const skippedStoryReports = skippedStories.map((story) => ({
    story_id: story.story_id,
    artifact_dir: story.artifact_dir,
    status: story.skip_status,
    reason: story.skip_reason,
    readiness_scope: "skipped",
    safe_to_publish_boolean: false,
    publishable_platforms: [],
    already_published_platforms: asArray(story.already_published_platforms),
    terminal_duplicate_blocked_platforms: asArray(story.terminal_duplicate_blocked_platforms),
    missing_enabled_platforms: asArray(story.missing_enabled_platforms),
  }));
  const platformActions = readyStories.flatMap((story) =>
    PLATFORMS
      .filter((platform) => !platformAlreadyPublishedForStory(story, platform))
      .filter((platform) => !platformTerminalDuplicateBlockedForStory(story, platform))
      .map((platform) => buildPlatformAction(story, platform, platformOperationalConfig)),
  );
  const actions = platformActions.filter((action) => action.blockers.length === 0);
  const blockedActions = platformActions.filter((action) => action.blockers.length > 0);
  const warningActions = actions.filter((action) => asArray(action.warnings).length > 0);
  const publishNowWarningActions = warningActions.filter((action) => action.action === "would_publish");
  const deferredWarningActions = warningActions.filter((action) => action.action !== "would_publish");
  const deferredActions = actions.filter((action) => action.action === "would_queue_when_enabled");
  const incidentReports = inspected.map((story) => ({
    story_id: story.story_id,
    artifact_dir: story.artifact_dir,
    verdict: story.incident_guard?.verdict || "missing",
    safe_to_publish_boolean: story.incident_guard?.safe_to_publish_boolean === true,
    disaster_upload_blockers: asArray(story.incident_guard?.disaster_upload_blockers),
    warnings: asArray(story.incident_guard?.warnings),
    public_output_coherence_report: {
      ...(story.incident_guard?.public_output_coherence_report || {}),
      verdict:
        asArray(story.coherence_artifact_freshness?.blockers).length > 0
          ? "fail"
          : story.incident_guard?.public_output_coherence_report?.verdict || "missing",
      blockers: uniqueCleanStrings([
        ...asArray(story.incident_guard?.public_output_coherence_report?.blockers),
        ...asArray(story.coherence_artifact_freshness?.blockers),
      ]),
      artifact_freshness: story.coherence_artifact_freshness || null,
    },
    file_evidence: story.file_evidence || null,
  }));
  const disasterUploadBlockers = incidentReports
    .filter((report) => report.disaster_upload_blockers.length > 0)
    .map((report) => ({
      story_id: report.story_id,
      artifact_dir: report.artifact_dir,
      blockers: report.disaster_upload_blockers,
    }));
  const heldStoryIds = new Set(heldStoryReports.map((story) => String(story.story_id)));
  const skippedStoryIds = new Set(skippedStoryReports.map((story) => String(story.story_id)));
  const activeDisasterUploadBlockers = disasterUploadBlockers.filter((story) =>
    !heldStoryIds.has(String(story.story_id)) && !skippedStoryIds.has(String(story.story_id)),
  );
  const readiness = buildDryRunReadiness({
    blockedStories,
    blockedActions,
    deferredActions,
    disasterUploadBlockers: activeDisasterUploadBlockers,
    heldStories: heldStoryReports,
    publishNowActions: actions.filter((action) => action.action === "would_publish"),
    warningActions: publishNowWarningActions,
  });
  const gatedActions = actions.map((action) => withDryRunLiveGate(action, readiness));
  const gatedBlockedActions = blockedActions.map((action) => withDryRunLiveGate(action, readiness));
  const gatedPublishNowActions = gatedActions.filter((action) => action.action === "would_publish");
  const gatedDeferredActions = gatedActions.filter((action) => action.action === "would_queue_when_enabled");
  const humanReviewRequiredActions = gatedActions.filter(
    (action) => action.requires_human_review_before_live_publish === true,
  );
  const livePublishAllowedActions = gatedActions.filter((action) => action.live_publish_allowed_from_dry_run === true);
  const platformStatusEvidence = buildPlatformStatusEvidence({
    generatedAt,
    actions: gatedActions,
    blockedActions: gatedBlockedActions,
    platformOperationalConfig,
  });
  const safePublishPlan = buildSafePublishPlan({
    readiness,
    actions: gatedActions,
    blockedActions: gatedBlockedActions,
    heldStories: heldStoryReports,
  });
  const publicOutputCoherenceReport = buildPublicOutputCoherenceReport({
    generated_at: generatedAt,
    held_story_ids: Array.from(heldStoryIds),
    skipped_story_ids: Array.from(skippedStoryIds),
    incident_guard_report: {
      stories: incidentReports,
    },
  });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "DRY_RUN_PUBLISH",
    overall_verdict: readiness.overall_verdict,
    ready_for_unattended_publish: readiness.ready_for_unattended_publish,
    readiness_reasons: readiness.readiness_reasons,
    summary: {
      story_count: inspected.length,
      ready_story_count: readyStories.length,
      blocked_story_count: blockedStories.length,
      held_story_count: heldStoryReports.length,
      skipped_story_count: skippedStoryReports.length,
      planned_action_count: gatedActions.length,
      candidate_platform_action_count: gatedActions.length,
      platform_publish_now_action_count: gatedPublishNowActions.length,
      platform_enabled_dry_run_action_count: gatedPublishNowActions.length,
      platform_deferred_action_count: gatedDeferredActions.length,
      deferred_platform_enablement_action_count: gatedDeferredActions.length,
      human_review_required_action_count: humanReviewRequiredActions.length,
      enabled_human_review_action_count: humanReviewRequiredActions.length,
      live_publish_allowed_action_count: livePublishAllowedActions.length,
      blocked_action_count: gatedBlockedActions.length,
      warning_action_count: warningActions.length,
      publish_now_warning_action_count: publishNowWarningActions.length,
      deferred_warning_action_count: deferredWarningActions.length,
      incident_guard_failed_story_count: activeDisasterUploadBlockers.length,
      quarantined_incident_guard_failed_story_count: disasterUploadBlockers.length - activeDisasterUploadBlockers.length,
      total_incident_guard_failed_story_count: disasterUploadBlockers.length,
      incident_guard_passed_story_count: incidentReports.filter((report) => report.verdict === "pass").length,
      scheduler_preflight_required: requireSchedulerPreflight === true,
      scheduler_preflight_report_loaded: Boolean(candidatePreflightReport),
      preflight_checked_story_count: schedulerPreflightCheckedStoryCount(inspected, candidatePreflightReport),
      published_platform_evidence_loaded: Boolean(publishedPlatformEvidence),
      terminal_duplicate_evidence_loaded: Boolean(guardedLiveDispatchExecutorReport),
    },
    actions: gatedActions,
    blocked_actions: gatedBlockedActions,
    ready_stories: readyStories.map((story) => ({
      story_id: story.story_id,
      artifact_dir: story.artifact_dir,
      already_published_platforms: asArray(story.already_published_platforms),
      terminal_duplicate_blocked_platforms: asArray(story.terminal_duplicate_blocked_platforms),
      missing_enabled_platforms: asArray(story.missing_enabled_platforms),
      warnings: asArray(story.warnings),
      visual_evidence_profile: story.visual_evidence_profile,
      file_evidence: story.file_evidence,
    })),
    blocked_stories: blockedStories,
    held_stories: heldStoryReports,
    skipped_stories: skippedStoryReports,
    incident_guard_report: {
      schema_version: 1,
      generated_at: generatedAt,
      story_count: incidentReports.length,
      passed_story_count: incidentReports.filter((report) => report.verdict === "pass").length,
      failed_story_count: disasterUploadBlockers.length,
      stories: incidentReports,
    },
    disaster_upload_blockers: {
      schema_version: 1,
      generated_at: generatedAt,
      blocked_story_count: disasterUploadBlockers.length,
      stories: disasterUploadBlockers,
    },
    platform_upload_preflight_report: platformStatusEvidence,
    platform_status_matrix: platformStatusEvidence,
    public_output_coherence_report: publicOutputCoherenceReport,
    safe_publish_plan: safePublishPlan,
    platform_operational_config: platformOperationalConfig || null,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      dry_run_only: true,
    },
  };
}

function renderGoalDryRunPublishPlanMarkdown(plan = {}) {
  const lines = [];
  lines.push("# Goal Dry-Run Publish Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || ""}`);
  lines.push(`Mode: ${plan.mode || "DRY_RUN_PUBLISH"}`);
  lines.push(`Overall verdict: ${plan.overall_verdict || "unknown"}`);
  lines.push(`Ready for unattended publish: ${plan.ready_for_unattended_publish === true}`);
  if (asArray(plan.readiness_reasons).length) {
    lines.push(`Readiness reasons: ${plan.readiness_reasons.join(", ")}`);
  }
  lines.push(`Ready stories: ${plan.summary?.ready_story_count || 0}`);
  lines.push(`Blocked stories: ${plan.summary?.blocked_story_count || 0}`);
  if (plan.summary?.held_story_count) {
    lines.push(`Held stories: ${plan.summary.held_story_count}`);
  }
  if (plan.summary?.skipped_story_count) {
    lines.push(`Skipped stories: ${plan.summary.skipped_story_count}`);
  }
  const candidateActionCount =
    plan.summary?.candidate_platform_action_count ?? plan.summary?.planned_action_count ?? 0;
  const enabledActionCount =
    plan.summary?.platform_enabled_dry_run_action_count ?? plan.summary?.platform_publish_now_action_count ?? 0;
  const enabledReviewActionCount =
    plan.summary?.enabled_human_review_action_count ?? plan.summary?.human_review_required_action_count ?? 0;
  const deferredEnablementActionCount =
    plan.summary?.deferred_platform_enablement_action_count ?? plan.summary?.platform_deferred_action_count ?? 0;
  lines.push(`Candidate platform actions (enabled + deferred): ${candidateActionCount}`);
  lines.push(`Enabled dry-run actions: ${enabledActionCount}`);
  lines.push(`Enabled actions requiring human review: ${enabledReviewActionCount}`);
  if (plan.summary?.live_publish_allowed_action_count != null) {
    lines.push(`Live publish actions allowed by this dry run: ${plan.summary.live_publish_allowed_action_count}`);
  }
  if (deferredEnablementActionCount) {
    lines.push(`Deferred until platform enablement: ${deferredEnablementActionCount}`);
  }
  lines.push(`Blocked platform actions: ${plan.summary?.blocked_action_count || 0}`);
  lines.push("");
  lines.push("## Safety");
  lines.push("- No publish API calls are made.");
  lines.push("- No database rows are mutated.");
  lines.push("- No OAuth or token settings are changed.");
  if (plan.safe_publish_plan) {
    lines.push(`- Live publish allowed from this dry run: ${plan.safe_publish_plan.live_publish_allowed_from_this_plan === true}`);
    lines.push(`- Required next step: ${plan.safe_publish_plan.required_next_step || "unknown"}`);
  }
  lines.push("");
  if (asArray(plan.blocked_stories).length) {
    lines.push("## Blocked Stories");
    for (const story of asArray(plan.blocked_stories).slice(0, 20)) {
      lines.push(`- ${story.story_id}: ${story.blockers.join(", ")}`);
    }
  }
  if (asArray(plan.held_stories).length) {
    lines.push("");
    lines.push("## Held Stories");
    for (const story of asArray(plan.held_stories).slice(0, 20)) {
      const reasons = asArray(story.hold_reasons).join(", ") || story.status || "held";
      lines.push(`- ${story.story_id}: ${reasons}; blockers: ${asArray(story.blockers).join(", ") || "none"}`);
    }
  }
  if (asArray(plan.skipped_stories).length) {
    lines.push("");
    lines.push("## Skipped Stories");
    for (const story of asArray(plan.skipped_stories).slice(0, 20)) {
      lines.push(`- ${story.story_id}: ${story.reason || story.status}`);
    }
  }
  if (asArray(plan.blocked_actions).length) {
    lines.push("");
    lines.push("## Blocked Platform Actions");
    for (const action of asArray(plan.blocked_actions).slice(0, 20)) {
      lines.push(`- ${action.story_id} / ${action.platform}: ${action.blockers.join(", ")}`);
    }
  }
  const deferred = asArray(plan.actions).filter((action) => action.action === "would_queue_when_enabled");
  if (deferred.length) {
    lines.push("");
    lines.push("## Deferred Platform Actions");
    for (const action of deferred.slice(0, 20)) {
      const gaps = asArray(action.platform_enablement_gaps).join(", ");
      const nextAction = cleanText(action.platform_enablement_next_action);
      const enablementDetail = [
        gaps ? `gaps: ${gaps}` : "",
        nextAction ? `next: ${nextAction}` : "",
      ].filter(Boolean).join("; ");
      lines.push(
        `- ${action.story_id} / ${action.platform}: ${action.platform_operational_state || "not_enabled"}${
          action.platform_operational_reason ? ` (${action.platform_operational_reason})` : ""
        }${enablementDetail ? `; ${enablementDetail}` : ""}`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function writeGoalDryRunPublishPlan(plan = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeGoalDryRunPublishPlan requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const jsonPath = path.join(outDir, "dry_run_publish_plan.json");
  const markdownPath = path.join(outDir, "dry_run_publish_plan.md");
  const incidentGuardPath = path.join(outDir, "incident_guard_report.json");
  const disasterBlockersPath = path.join(outDir, "disaster_upload_blockers.json");
  const publicOutputCoherencePath = path.join(outDir, "public_output_coherence_report.json");
  const publishVerdictPath = path.join(outDir, "publish_verdict.json");
  const safeToPublishPath = path.join(outDir, "safe_to_publish_boolean.json");
  const platformUploadPreflightPath = path.join(outDir, "platform_upload_preflight_report.json");
  const platformStatusMatrixPath = path.join(outDir, "platform_status_matrix.json");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeJson(incidentGuardPath, plan.incident_guard_report || {}, { spaces: 2 });
  await fs.writeJson(disasterBlockersPath, plan.disaster_upload_blockers || {}, { spaces: 2 });
  const publishVerdict = buildPublishVerdictSummary(plan);
  await fs.writeJson(
    publicOutputCoherencePath,
    plan.public_output_coherence_report || buildPublicOutputCoherenceReport(plan),
    { spaces: 2 },
  );
  await fs.writeJson(publishVerdictPath, publishVerdict, { spaces: 2 });
  await fs.writeJson(
    safeToPublishPath,
    {
      schema_version: 1,
      generated_at: plan.generated_at || new Date().toISOString(),
      safe_to_publish_boolean: publishVerdict.safe_to_publish_boolean === true,
    },
    { spaces: 2 },
  );
  await fs.writeJson(platformUploadPreflightPath, plan.platform_upload_preflight_report || {}, { spaces: 2 });
  await fs.writeJson(platformStatusMatrixPath, plan.platform_status_matrix || {}, { spaces: 2 });
  await fs.writeFile(markdownPath, renderGoalDryRunPublishPlanMarkdown(plan), "utf8");
  return {
    outputDir: outDir,
    jsonPath,
    markdownPath,
    incidentGuardPath,
    disasterBlockersPath,
    publicOutputCoherencePath,
    publishVerdictPath,
    safeToPublishPath,
    platformUploadPreflightPath,
    platformStatusMatrixPath,
  };
}

module.exports = {
  REQUIRED_READY_FILES,
  PLATFORMS,
  buildGoalDryRunPublishPlan,
  applySchedulerPreflightGate,
  applyPublishedPlatformEvidence,
  applyEnabledPlatformAlreadyPublishedSkips,
  normalizePlatformKey,
  buildPublicOutputCoherenceReport,
  buildPublishVerdictSummary,
  clipScenePlanVisualCadenceEvidence,
  directMotionBaseSourceOveruseEvidence,
  directMotionSubjectMismatchEvidence,
  finalRenderVisualReuseEvidence,
  hyperframesReadableDwellEvidence,
  repeatedDirectMotionSegmentEvidence,
  repeatedDirectMotionSegmentBlockers,
  renderGoalDryRunPublishPlanMarkdown,
  writeGoalDryRunPublishPlan,
};
