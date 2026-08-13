"use strict";

const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { fileURLToPath, pathToFileURL } = require("node:url");
const nativeFs = require("node:fs/promises");
const fs = require("fs-extra");

const execFileAsync = promisify(execFile);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithTransientLockRetry({
  source,
  destination,
  fsImpl = fs,
  sleepImpl = delay,
  attempts = 24,
  delayMs = 250,
} = {}) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await fsImpl.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EACCES", "EBUSY"].includes(error?.code) || attempt === attempts) throw error;
      await sleepImpl(delayMs);
    }
  }
  throw lastError;
}

async function promoteRenderedOutputAtomically({
  temporaryPath,
  outputPath,
  fsImpl = fs,
  sleepImpl = delay,
} = {}) {
  const backupPath = `${outputPath}.previous-${crypto.randomUUID()}`;
  const hadPrevious = await fsImpl.pathExists(outputPath);
  if (hadPrevious) {
    await renameWithTransientLockRetry({
      source: outputPath,
      destination: backupPath,
      fsImpl,
      sleepImpl,
    });
  }
  try {
    await renameWithTransientLockRetry({
      source: temporaryPath,
      destination: outputPath,
      fsImpl,
      sleepImpl,
    });
    if (hadPrevious) await fsImpl.remove(backupPath);
  } catch (error) {
    if (hadPrevious && (await fsImpl.pathExists(backupPath))) {
      await renameWithTransientLockRetry({
        source: backupPath,
        destination: outputPath,
        fsImpl,
        sleepImpl,
      }).catch(() => {});
    }
    throw error;
  }
}

const {
  overlayCardWindowsForStory,
  renderProof: defaultRenderProof,
  selectBalancedProfessionalMotionCandidates,
} = require("./studio/v4/proof-render");
const {
  buildTrustedVisualV4DirectorPlan,
} = require("./studio/v4/trusted-director-orchestrator");
const { runMediaHouseBenchmark } = require("./media-house-benchmark");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { buildViralScriptIntelligence } = require("./viral-script-intelligence");
const { buildCaptionSrt } = require("./goal-public-copy-repair");
const { writeFlagshipNarrationQaEvidence } = require("./goal-narration-qa-repair");
const {
  DEFAULT_MINIMUM_GENUINE_BASE_SOURCES,
  evaluateGenuineBaseSourceDiversity,
} = require("./genuine-base-source-diversity");
const mediaPaths = require("./media-paths");
const {
  STUDIO_V4_SFX_MIX_POLICY_VERSION,
  STUDIO_V4_VOICE_MIX_POLICY_VERSION,
  STUDIO_V4_VISUAL_DESIGN_POLICY_VERSION,
  currentRenderPolicyManifest,
  policyVersionBlockers,
} = require("./studio/v4/render-policy");
const {
  loadGovernedCinematicSoundscapeRuntime,
} = require("./studio/v4/cinematic-audio-arc");
const {
  evaluateHyperframesPremiumShellEvidence,
  MIN_PREMIUM_HYPERFRAMES_CARDS,
  readableDurationEvidenceFromShell,
  resolveCardAssetsV2,
} = require("./studio/v2/premium-card-lane-v2");
const { applyGamingPronunciation } = require("./tts-pronunciation");
const { ffprobeDuration: defaultFfprobeDuration } = require("./studio/media-acquisition");
const {
  PREMIUM_CARD_TIMING_V5_VERSION,
  V5_READABLE_CARD_TIMING,
  V5_SOURCE_CARD_TIMING,
  v5CardTimingContract,
} = require("./studio/v4/premium-card-timing-policy");
const {
  PREMIUM_EDIT_RHYTHM_V5,
} = require("./studio/v5/premium-edit-rhythm");
const {
  filterPremiumDirectMotionClips: defaultFilterPremiumDirectMotionClips,
} = require("./studio/v5/direct-motion-visual-selector");
const {
  _private: {
    compoundMotionSourceIdentity,
    materializedSourceIdentityFields,
  },
} = require("./goal-real-motion-materializer");
const {
  defaultProbeMedia: defaultRightsProbeMedia,
  reconcileRightsEvidence: defaultReconcileRightsEvidence,
} = require("./candidate-evidence-reconciliation");
const {
  isPublishableStrictlyVerifiedOwnedMotionClip,
} = require("./governed-owned-motion");
const {
  isBoundedEditorialExceptionEvidenceKind,
} = require("./rights-evidence-policy");
const {
  applyEpidemicSfxRuntimeManifestToStory,
} = require("./studio/v4/epidemic-sfx-runtime");
const {
  finalizeElevenLabsGenerationRightsLineage:
    defaultFinalizeElevenLabsGenerationRightsLineage,
} = require("./elevenlabs-generation-rights-lineage");

const DEFAULT_RENDER_TARGET_PLATFORMS = [
  "youtube_shorts",
  "instagram_reels",
  "facebook_reels",
];

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

function currentCanonicalScriptScorecard({
  canonical = {},
  story = {},
  storyId = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const script = cleanText(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.tts_script,
  );
  const resolvedStoryId = cleanText(storyId || canonical.story_id || canonical.id);
  const provenance = {
    generated_at: generatedAt,
    scorecard_source: "post_render_current_canonical_script",
    canonical_script_sha256: script
      ? crypto.createHash("sha256").update(script, "utf8").digest("hex")
      : null,
  };
  const failClosed = (blocker) => ({
    schema_version: 1,
    execution_mode: "viral_script_intelligence_v1",
    story_id: resolvedStoryId || null,
    verdict: "rewrite_required",
    viral_score: 0,
    scores: {},
    blockers: [blocker],
    warnings: [],
    ...provenance,
    safety: {
      local_only: true,
      analysis_only: true,
      no_publishing_side_effects: true,
      oauth_triggered: false,
      production_db_mutated: false,
    },
  });
  if (!script) return failClosed("canonical_script_missing");

  let scorecard;
  try {
    scorecard = buildViralScriptIntelligence({
      story: {
        ...story,
        id: resolvedStoryId || null,
        title: cleanText(
          canonical.selected_title ||
            canonical.short_title ||
            canonical.canonical_title ||
            story.title,
        ),
        source_name: cleanText(
          canonical.primary_source?.name ||
            canonical.primary_source ||
            canonical.source_card_label ||
            canonical.official_source,
        ) || null,
      },
      script,
    });
  } catch {
    return failClosed("canonical_script_scoring_failed");
  }
  const verdict = statusText(scorecard?.verdict);
  if (
    !scorecard ||
    typeof scorecard !== "object" ||
    !["viral_ready", "tighten_before_tts", "rewrite_required"].includes(verdict) ||
    numberOrNull(scorecard.viral_score) == null ||
    !Array.isArray(scorecard.blockers)
  ) {
    return failClosed("canonical_script_scorecard_unverified");
  }
  return {
    ...scorecard,
    story_id: resolvedStoryId || scorecard.story_id || null,
    ...provenance,
  };
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

function requiredGenuineBaseSourceCount(job = {}) {
  const evidence = objectValue(job.evidence);
  const candidates = [
    job.required_genuine_base_source_count,
    job.minimum_required_genuine_base_sources,
    objectValue(job.requirements).required_genuine_base_source_count,
    evidence.required_genuine_base_source_count,
    evidence.minimum_required_genuine_base_sources,
    objectValue(evidence.professional_source_diversity)
      .minimum_required_genuine_base_source_count,
    objectValue(evidence.real_motion_input_readiness)
      .required_genuine_base_source_count,
  ]
    .map(numberOrNull)
    .filter((value) => value != null && value > 0)
    .map((value) => Math.floor(value));
  return Math.max(
    DEFAULT_MINIMUM_GENUINE_BASE_SOURCES,
    ...(candidates.length ? candidates : [0]),
  );
}

function resolveNarrationDurationS({
  voiceQualityReport = {},
  audioManifest = {},
  jobEvidence = {},
  narrationAudioPath = null,
  ffprobeDurationImpl = defaultFfprobeDuration,
} = {}) {
  const voiceReportedDuration = numberOrNull(
    voiceQualityReport.cadence?.duration_seconds ??
      voiceQualityReport.cadence?.duration_s ??
      voiceQualityReport.duration_seconds ??
      voiceQualityReport.duration_s,
  );
  const manifestReportedDuration = numberOrNull(
    audioManifest.cadence?.duration_seconds ??
      audioManifest.cadence?.duration_s ??
      audioManifest.technical_duration_seconds ??
      audioManifest.duration_seconds ??
      audioManifest.duration_s,
  );
  const jobReportedDuration = numberOrNull(
    jobEvidence.technical_duration_seconds ??
      jobEvidence.duration_seconds ??
      jobEvidence.duration_s,
  );

  const audioPath = pathOrNull(narrationAudioPath);
  const manifestAudioPath = pathOrNull(
    audioManifest.narration_audio_path ||
      audioManifest.audio_path ||
      audioManifest.output_path,
  );
  const manifestAudioSha = cleanText(
    audioManifest.audio_sha256 ||
      audioManifest.narration_audio_sha256 ||
      audioManifest.sha256,
  ).replace(/^sha256:/i, "").toLowerCase();
  const voiceReportAudioSha = cleanText(
    voiceQualityReport.audio_sha256 ||
      voiceQualityReport.narration_audio_sha256 ||
      voiceQualityReport.cadence?.audio_sha256,
  ).replace(/^sha256:/i, "").toLowerCase();
  const manifestIdentifiesCurrentAudio =
    Boolean(audioPath && manifestAudioPath && manifestAudioSha) &&
    normalisePathKey(audioPath) === normalisePathKey(manifestAudioPath);
  const voiceReportMatchesCurrentAudio =
    manifestIdentifiesCurrentAudio &&
    Boolean(voiceReportAudioSha) &&
    voiceReportAudioSha === manifestAudioSha;

  if (manifestIdentifiesCurrentAudio && !voiceReportMatchesCurrentAudio) {
    if (manifestReportedDuration != null && manifestReportedDuration > 0) {
      return manifestReportedDuration;
    }
    if (typeof ffprobeDurationImpl === "function") {
      const probedCurrentDuration = numberOrNull(ffprobeDurationImpl(audioPath));
      if (probedCurrentDuration != null && probedCurrentDuration > 0) {
        return probedCurrentDuration;
      }
    }
  }

  for (const reportedDuration of [
    voiceReportedDuration,
    manifestReportedDuration,
    jobReportedDuration,
  ]) {
    if (reportedDuration != null && reportedDuration > 0) return reportedDuration;
  }

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
  const preferredOpeningClipId = cleanText(
    job.preferred_opening_motion_clip_id || job.preferredOpeningMotionClipId,
  );
  if (preferredOpeningClipId) {
    const preferredIndex = orderedClips.findIndex((clip) =>
      cleanText(clip?.id || clip?.clip_id || clip?.asset_id) === preferredOpeningClipId,
    );
    if (preferredIndex >= 0) {
      return [
        orderedClips[preferredIndex],
        ...orderedClips.slice(0, preferredIndex),
        ...orderedClips.slice(preferredIndex + 1),
      ];
    }
  }
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
  const mediaKind = cleanText(clip.media_kind || clip.mediaKind).toLowerCase();
  if (
    readableOwnedCardKind(clip) ||
    /^(?:generated_card|owned_editorial_motion_graphic|owned_explainer_motion)$/.test(mediaKind)
  ) {
    return false;
  }
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
  const mediaKind = cleanText(clip.media_kind || clip.mediaKind).toLowerCase();
  const sourceType = cleanText(clip.source_type || clip.sourceType).toLowerCase();
  const isOwnedExplainer =
    mediaKind === "owned_explainer_motion" ||
    sourceType === "internally_generated_motion_graphic";
  if (isOwnedExplainer) {
    const designRole = cleanText(
      clip.generator_design_role || clip.generatorDesignRole,
    ).toLowerCase();
    const explicitKind = cleanText(
      clip.readable_card_kind ||
        clip.readableCardKind ||
        clip.card_kind ||
        clip.cardKind,
    ).toLowerCase();
    const matchedExplicitKind = explicitKind.match(
      /^(source|source_lock|context|timeline|quote|takeaway|proof|stat|chart|carousel|screenshot|breaking|title|card)$/,
    );
    if (matchedExplicitKind?.[1]) return matchedExplicitKind[1];
    if (designRole === "primary_procedural_motion") return "";
  }
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

const MAX_LEGACY_READABLE_CARD_DURATION_RATIO = 0.25;

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
    if (nextRatio > MAX_LEGACY_READABLE_CARD_DURATION_RATIO) continue;
    selected.push(entry.clip);
    cardDurationS = nextDurationS;
  }
  return selected;
}

function projectDiverseOwnedMotionCandidates(clips = [], limit = Number.POSITIVE_INFINITY) {
  const groups = new Map();
  asArray(clips).forEach((clip, index) => {
    const key = cleanText(
      clip.generator_project_id ||
        clip.generator_master_sha256 ||
        clip.source_family ||
        clip.motion_family ||
        clip.id ||
        clip.asset_id ||
        `owned-motion-${index + 1}`,
    ).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ clip, index });
  });
  for (const rows of groups.values()) {
    rows.sort((a, b) => {
      const aVariant = numberOrNull(a.clip.generator_variant);
      const bVariant = numberOrNull(b.clip.generator_variant);
      if (aVariant != null && bVariant != null && aVariant !== bVariant) {
        return aVariant - bVariant;
      }
      if (aVariant != null && bVariant == null) return -1;
      if (aVariant == null && bVariant != null) return 1;
      return a.index - b.index;
    });
  }
  const selected = [];
  let round = 0;
  while (selected.length < limit) {
    let added = false;
    for (const rows of groups.values()) {
      const row = rows[round];
      if (!row) continue;
      selected.push(row.clip);
      added = true;
      if (selected.length >= limit) break;
    }
    if (!added) break;
    round += 1;
  }
  return selected;
}

function selectGovernedOwnedMotionOnlyClips(
  materialisedMotion = {},
  {
    targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
    minimumPrimaryClips = 10,
    minimumGeneratorProjects = 3,
  } = {},
) {
  const blockers = [];
  if (!manifestReadyStatus(materialisedMotion)) {
    blockers.push("owned_motion_only_materialised_manifest_not_ready");
  }
  if (materialisedMotion.owned_explainer_visual_plan !== true) {
    blockers.push("owned_motion_only_plan_not_declared");
  }
  const verified = dedupeClipObjects(
    materialisedMotionClips(materialisedMotion).filter((clip) =>
      isPublishableStrictlyVerifiedOwnedMotionClip(clip, { targetPlatforms }),
    ),
  );
  const primary = verified.filter((clip) => !readableOwnedCardKind(clip));
  const readableCards = verified
    .filter((clip) => Boolean(readableOwnedCardKind(clip)))
    .sort((a, b) =>
      readableCardPriority(readableOwnedCardKind(a)) -
        readableCardPriority(readableOwnedCardKind(b)),
    );
  const generatorProjects = uniqueCleanTexts(
    primary.map((clip) => clip.generator_project_id),
  );
  const sourceCards = readableCards.filter(
    (clip) => readableOwnedCardKind(clip) === "source",
  );
  if (primary.length < minimumPrimaryClips) {
    blockers.push(
      `owned_motion_only_primary_clip_minimum_not_met:${primary.length}/${minimumPrimaryClips}`,
    );
  }
  if (generatorProjects.length < minimumGeneratorProjects) {
    blockers.push(
      `owned_motion_only_generator_project_minimum_not_met:${generatorProjects.length}/${minimumGeneratorProjects}`,
    );
  }
  if (!sourceCards.length) blockers.push("owned_motion_only_source_card_missing");
  const uniqueBlockers = uniqueCleanTexts(blockers);
  return {
    clips: uniqueBlockers.length
      ? []
      : [
          ...projectDiverseOwnedMotionCandidates(primary, primary.length),
          ...readableCards,
        ],
    verified_clip_count: verified.length,
    primary_clip_count: primary.length,
    readable_card_count: readableCards.length,
    source_card_count: sourceCards.length,
    generator_project_count: generatorProjects.length,
    generator_project_ids: generatorProjects,
    target_platforms: uniqueCleanTexts(targetPlatforms),
    blockers: uniqueBlockers,
  };
}

function selectNonReadableOwnedExplainerTopUpForMotionBalance(
  ownedClips = [],
  primaryClips = [],
  { desiredTotalClipCount = 9 } = {},
) {
  const primary = asArray(primaryClips);
  if (!primary.length) return [];
  const target = Math.max(9, Number(desiredTotalClipCount) || 0, primary.length);
  const needed = Math.max(0, target - primary.length);
  if (!needed) return [];
  return projectDiverseOwnedMotionCandidates(
    asArray(ownedClips).filter((clip) => !readableOwnedCardKind(clip)),
    needed,
  );
}

function premiumShellPrimaryClipsForRender(preferredClips = [], materialisedMotion = {}) {
  const primary = asArray(preferredClips).filter((clip) => !readableOwnedCardKind(clip));
  const primaryPaths = new Set(primary.map((clip) => normalisePathKey(clipPathValue(clip))).filter(Boolean));
  const ownedCandidates = materialisedMotionClips(materialisedMotion)
    .filter(isApprovedOwnedExplainerClip)
    .filter((clip) => !readableOwnedCardKind(clip))
    .filter((clip) => {
      const key = normalisePathKey(clipPathValue(clip));
      return key && !primaryPaths.has(key);
    });
  return [
    ...primary,
    ...selectNonReadableOwnedExplainerTopUpForMotionBalance(ownedCandidates, primary),
  ];
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
  if (clipCoverageDurationS(directClips) + 0.12 < duration) return false;
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

function governedDenseDirectMotionSupportsSourceOnly({
  clips = [],
  audioDurationS = null,
  wordTimestampSource = "",
} = {}) {
  const duration = numberOrNull(audioDurationS);
  if (
    duration == null ||
    duration <= 0 ||
    duration > 60 ||
    !/local_whisper_word_alignment|whisper/i.test(cleanText(wordTimestampSource))
  ) {
    return false;
  }
  const directClips = dedupeClipObjects(clips)
    .filter(isRealMaterialisedClip)
    .filter((clip) => !isReadableApprovedOwnedExplainerClip(clip));
  if (directClips.length < 6) return false;
  const sourceWindowCounts = new Map();
  for (const clip of directClips) {
    const sourceKey = strictDirectMotionBaseSourceKey(clip);
    if (!sourceKey) return false;
    sourceWindowCounts.set(sourceKey, (sourceWindowCounts.get(sourceKey) || 0) + 1);
  }
  const governedOfficialStillMotion = directClips.every((clip) => {
    const sourceType = cleanText(clip.source_type || clip.sourceType).toLowerCase();
    const mediaKind = cleanText(clip.media_kind || clip.mediaKind).toLowerCase();
    return (
      mediaKind === "visual_still" &&
      /official.*(?:still|press|store)|press_kit_stills/.test(sourceType) &&
      /^https:\/\//i.test(cleanText(clip.source_url || clip.url)) &&
      clip.materialized === true &&
      clip.validated === true &&
      clip.source_safety_blocked !== true &&
      Boolean(cleanText(clip.rights_basis)) &&
      Boolean(cleanText(clip.licence_basis))
    );
  });
  if (governedOfficialStillMotion) {
    return (
      directClips.length >= 6 &&
      sourceWindowCounts.size >= 6 &&
      [...sourceWindowCounts.values()].every((count) => count === 1) &&
      directMotionFamilyCount(directClips) >= 6 &&
      clipCoverageDurationS(directClips) + 0.12 >= duration
    );
  }
  if (directClips.length < 10) return false;
  if (sourceWindowCounts.size < 6) return false;
  if ([...sourceWindowCounts.values()].some((count) => count > 2)) return false;
  return clipCoverageDurationS(directClips) + 0.12 >= duration;
}

function selectedMaterialisedMotionClipIds({ materialisedMotion = {}, job = {} } = {}) {
  const selected = firstNonEmptyArray(
    job.evidence?.selected_materialised_motion_clip_ids,
    job.evidence?.local_render_rights?.complete_selected_motion_clip_ids,
    job.evidence?.local_render_rights?.selected_motion_clip_ids,
    materialisedMotion.selected_materialised_motion_clip_ids,
  );
  return new Set(
    selected
      .map((value) => cleanText(value).toLowerCase())
      .filter(Boolean),
  );
}

function governedReadableShellCardClips({
  materialisedMotion = {},
  job = {},
  targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
} = {}) {
  if (!manifestReadyStatus(materialisedMotion)) return [];
  const selectedIds = selectedMaterialisedMotionClipIds({ materialisedMotion, job });
  if (!selectedIds.size) return [];
  return materialisedMotionClips(materialisedMotion)
    .filter((clip) => {
      const id = cleanText(clip.id || clip.asset_id).toLowerCase();
      return id && selectedIds.has(id);
    })
    .filter((clip) => {
      const evidence = [
        clip.source_url,
        clip.source_type,
        clip.source_family,
        clip.media_kind,
        clip.rights_basis,
        clip.licence_basis,
      ].map(cleanText).join(" ").toLowerCase();
      const legacyHyperframesCard =
        /local:\/\/hyperframes|hyperframes[_/-].*[_/-]card/.test(evidence) &&
        /owned_generated_editorial_motion_graphic|owned_transformative_editorial_graphic|hyperframes_premium_shell_card/.test(evidence);
      const strictlyVerifiedOwnedCard =
        clip.hyperframes_card === true &&
        isPublishableStrictlyVerifiedOwnedMotionClip(clip, { targetPlatforms });
      return (
        /\.mp4$/i.test(clipPathValue(clip)) &&
        Boolean(readableOwnedCardKind(clip)) &&
        (legacyHyperframesCard || strictlyVerifiedOwnedCard)
      );
    });
}

function governedReadableShellCardPaths(options = {}) {
  return uniqueCleanTexts(
    governedReadableShellCardClips(options)
      .map(clipPathValue)
      .filter(Boolean),
  );
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
  const sourceUrl = cleanText(clip.source_url || clip.url || clip.original_source_url);
  const steamTrailer = sourceUrl.match(
    /\/store_trailers\/([^/?#]+\/[^/?#]+\/[^/?#]+\/[^/?#]+)/i,
  );
  if (steamTrailer?.[1]) {
    return `steam-trailer:${normaliseMotionSourceKey(steamTrailer[1])}`;
  }
  const youtubeKey = youtubeMotionSourceKey(sourceUrl);
  if (youtubeKey) return youtubeKey;
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

function strictMotionWindowRange(clip = {}) {
  const windowText = [
    clip.source_family,
    clip.motion_family,
    clip.base_source_family,
    clip.original_source_family,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
  const windowMatch = windowText.match(/(?:^|[_-])window[_-](\d+(?:\.\d+)?)[_-](\d+(?:\.\d+)?)(?:$|[\s_-])/i);
  if (!windowMatch) return null;
  const root = strictDirectMotionBaseSourceKey(clip);
  if (!root) return null;
  const startS = Number(windowMatch[1]);
  const durationS = Number(windowMatch[2]);
  if (!Number.isFinite(startS) || !Number.isFinite(durationS) || durationS <= 0) return null;
  return {
    root,
    startS,
    durationS,
    endS: startS + durationS,
    key: `${root}|window:${windowMatch[1]}:${windowMatch[2]}`,
  };
}

function dedupeClipsByStrictMotionWindow(clips = []) {
  const seen = new Set();
  const deduped = [];
  for (const clip of asArray(clips)) {
    const windowKey = strictMotionWindowRange(clip)?.key || "";
    if (windowKey && seen.has(windowKey)) continue;
    if (windowKey) seen.add(windowKey);
    deduped.push(clip);
  }
  return deduped;
}

function filterOverlappingStrictMotionWindows(clips = []) {
  const selected = new Set();
  const byRoot = new Map();
  for (const [index, clip] of asArray(clips).entries()) {
    const range = strictMotionWindowRange(clip);
    if (!range) {
      selected.add(clip);
      continue;
    }
    if (!byRoot.has(range.root)) byRoot.set(range.root, []);
    byRoot.get(range.root).push({ clip, index, range });
  }
  for (const entries of byRoot.values()) {
    let previousEndS = Number.NEGATIVE_INFINITY;
    for (const entry of entries.sort(
      (a, b) => a.range.endS - b.range.endS || a.range.startS - b.range.startS || a.index - b.index,
    )) {
      if (entry.range.startS + 0.05 < previousEndS) continue;
      selected.add(entry.clip);
      previousEndS = entry.range.endS;
    }
  }
  return asArray(clips).filter((clip) => selected.has(clip));
}

function preferStrictDirectMotionBaseUniquenessWhenEnough(
  clips = [],
  { minimumUniqueBases = 6, premiumRunwayClipCount = 10, premiumRunwayMinimumUniqueBases = 7 } = {},
) {
  const selected = filterOverlappingStrictMotionWindows(dedupeClipsByStrictMotionWindow(clips));
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
  if (seen.size >= 4 && selected.length >= 9) {
    const rootCounts = new Map();
    const balanced = [];
    for (const clip of selected) {
      const sourceKey = strictDirectMotionBaseSourceKey(clip);
      const fallbackKey = normalisePathKey(clipPathValue(clip) || cleanText(clip.id || clip.asset_id || clip.source_url));
      const key = sourceKey || fallbackKey;
      const count = rootCounts.get(key) || 0;
      if (count >= 2) continue;
      rootCounts.set(key, count + 1);
      balanced.push(clip);
    }
    if (balanced.length >= 8) return balanced;
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

function clipSidecarMetadata(clip = {}) {
  const clipPath = clipPathValue(clip);
  if (!clipPath || /\.json$/i.test(clipPath)) return {};
  try {
    const sidecar = fs.readJsonSync(`${clipPath}.json`);
    return sidecar && typeof sidecar === "object" && !Array.isArray(sidecar) ? sidecar : {};
  } catch {
    return {};
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
    filterLowPayloadSlateClipsWhenSafe(
      rotateFirstClipForRepair(
        prioritiseOpeningMotionClips(materialisedOnlyClips.filter(isRealMaterialisedClip)),
        job,
      ),
    ),
  );
  const preservedEvidenceRealClips = preferStrictDirectMotionBaseUniquenessWhenEnough(
    filterLowPayloadSlateClipsWhenSafe(
      rotateFirstClipForRepair(
        prioritiseOpeningMotionClips(
          dedupeClipObjects([
            ...rightsLedgerMotionClips(rightsLedger),
            ...footageMotionClips(footageInventory),
          ]).filter(isRealMaterialisedClip),
        ),
        job,
      ),
    ),
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
        {
          desiredTotalClipCount:
            materialisedOnlyRealClips.length >= 8 ? 14 : 9,
        },
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
    filterLowPayloadSlateClipsWhenSafe(prioritisedRealClips),
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
  const text = cleanText(value);
  return (
    !text ||
    /^(?:source locked|one claim,\s*one source|proof beat|why it matters|source proof|claim checked)$/i.test(text) ||
    /\b(?:proof|claim checked)\b/i.test(text)
  );
}

function millionLabel(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return `${Number.isInteger(number) ? number : Number(number.toFixed(1))} MILLION`;
}

function salesMomentumProofCard(text = "") {
  const compact = cleanText(text);
  if (!/\b(?:sold|sales?)\b/i.test(compact)) return null;
  const weeklyMatch =
    compact.match(/\b(?:sold|sales?(?:\s+(?:hit|reached))?)\D{0,48}(\d+(?:\.\d+)?)\s+million\b.{0,70}\b(?:one|1|first)\s+week\b/i) ||
    compact.match(/\b(\d+(?:\.\d+)?)\s+million\b.{0,70}\b(?:one|1|first)\s+week\b/i);
  if (!weeklyMatch) return null;

  const firstWeekMetric = millionLabel(weeklyMatch[1]);
  if (!firstWeekMetric) return null;
  const secondWaveMatch =
    compact.match(/\banother\s+(?:(\d+(?:\.\d+)?)\s+)?million\b.{0,90}\b(?:day one|first day)\b/i) ||
    compact.match(/\b(?:day one|first day)\b.{0,120}\banother\s+(?:(\d+(?:\.\d+)?)\s+)?million\b/i) ||
    compact.match(/\b(\d+(?:\.\d+)?)\s+million\b.{0,60}\bafter\s+(?:day one|the first day)\b/i);
  const secondWaveMetric = secondWaveMatch
    ? `${Number(secondWaveMatch[1] || 1).toLocaleString("en-GB", {
        maximumFractionDigits: 1,
      })}M AFTER DAY ONE`
    : "FIRST-WEEK SALES";
  return {
    proof_card_primary: `${firstWeekMetric} IN ONE WEEK`,
    proof_card_secondary: secondWaveMetric,
  };
}

function semanticProofCardFromCanonical(canonical = {}) {
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game || canonical.selected_title);
  const confirmedClaims = asArray(canonical.confirmed_claims).map(cleanText).filter(Boolean);
  const claim = cleanText(confirmedClaims[0] || canonical.primary_claim || canonical.narration_script);
  const text = lowerText([
    subject,
    canonical.selected_title,
    ...confirmedClaims,
    claim,
    canonical.narration_script,
    canonical.description,
    canonical.first_spoken_line,
  ].join(" "));
  const salesMomentumCard = salesMomentumProofCard(text);
  if (salesMomentumCard) return salesMomentumCard;
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
      proof_card_primary: "WHAT CHANGED",
      proof_card_secondary: cleanText(canonical.primary_source || "OFFICIAL SOURCE").toUpperCase().slice(0, 28),
    };
  }
  return {
    proof_card_primary: "WHAT CHANGED",
    proof_card_secondary: "OFFICIAL UPDATE",
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

function normaliseRightsPlatformKey(value) {
  const key = cleanText(
    value && typeof value === "object"
      ? value.platform || value.platform_key || value.key || value.name || value.id
      : value,
  ).toLowerCase().replace(/[\s-]+/g, "_");
  const aliases = {
    youtube: "youtube_shorts",
    youtube_short: "youtube_shorts",
    youtube_shorts: "youtube_shorts",
    instagram: "instagram_reels",
    instagram_reel: "instagram_reels",
    instagram_reels: "instagram_reels",
    facebook: "facebook_reels",
    facebook_reel: "facebook_reels",
    facebook_reels: "facebook_reels",
    twitter: "x",
    twitter_video: "x",
    twitter_image: "x",
    x_twitter: "x",
    x: "x",
  };
  return aliases[key] || key;
}

function normaliseRightsRecord(record = {}) {
  if (!record || typeof record !== "object") return record;
  const normalised = { ...record };
  if (Array.isArray(record.allowed_platforms)) {
    normalised.allowed_platforms = [
      ...new Set(record.allowed_platforms.map(normaliseRightsPlatformKey).filter(Boolean)),
    ];
  }
  return normalised;
}

function normaliseRightsLedgerForRender(rightsLedger = {}) {
  if (Array.isArray(rightsLedger)) return rightsLedger.map(normaliseRightsRecord);
  if (!rightsLedger || typeof rightsLedger !== "object") return rightsLedger;
  const normalised = { ...rightsLedger };
  for (const key of ["records", "assets", "rights_ledger", "matched_assets"]) {
    if (Array.isArray(normalised[key])) normalised[key] = normalised[key].map(normaliseRightsRecord);
  }
  return normalised;
}

function verifiedSourceIdentityAttribution(clip = {}) {
  const provenance =
    clip.source_identity_provenance ||
    clip.motion_source_identity?.source_identity_provenance;
  if (!provenance || typeof provenance !== "object") return null;
  const sidecarSha256 = cleanText(provenance.sidecar_sha256).toLowerCase();
  const verified = (
    cleanText(provenance.kind) === "pulse_source_identity_sidecar" &&
    cleanText(provenance.status).toLowerCase() === "resolved" &&
    cleanText(provenance.schema) === "pulse_motion_source_identity_sidecar_v1" &&
    cleanText(provenance.producer) === "pulse_source_identity_oembed_verifier_v1" &&
    /^[a-f0-9]{64}$/.test(sidecarSha256)
  );
  if (!verified) return null;
  const channel = provenance.channel_identity || {};
  const authorName = cleanText(channel.author_name);
  const authorUrl = cleanText(channel.author_url);
  if (!authorName || !authorUrl) return null;
  return {
    authorName,
    authorUrl,
    sidecarPath: cleanText(provenance.sidecar_path),
    sidecarSha256,
  };
}

function rightsRecordForSelectedClip(clip = {}) {
  const verifiedSourceIdentity = verifiedSourceIdentityAttribution(clip);
  const selectedRightsBasis = cleanText(clip.rights_basis);
  const selectedOwnsGeneratedAsset =
    clip.rights_grant === true && /^owned[_ -]?generated/i.test(selectedRightsBasis);
  const licenceBasis = cleanText(
    selectedOwnsGeneratedAsset
      ? selectedRightsBasis
      : clip.licence_basis || clip.license_basis || selectedRightsBasis,
  );
  if (!licenceBasis) return null;
  const assetId = cleanText(clip.id || clip.asset_id || clip.path || clip.source_url);
  if (!assetId) return null;
  const rightsStatus = cleanText(clip.rights_status);
  const usageScope = cleanText(clip.usage_scope);
  const explicitlyOwnedGenerated = selectedOwnsGeneratedAsset;
  const ownedEvidenceKind = cleanText(clip.evidence_kind);
  const ownedEvidenceFile = cleanText(clip.evidence_file || clip.evidence_path);
  const ownedEvidenceSha256 = cleanText(clip.evidence_sha256)
    .replace(/^sha256:/i, "")
    .toLowerCase();
  const ownedEvidenceSizeBytes = Number.isFinite(Number(clip.evidence_size_bytes))
    ? Number(clip.evidence_size_bytes)
    : null;
  const hasHashBoundOwnedEvidence =
    explicitlyOwnedGenerated &&
    ownedEvidenceKind === "owned_generated_hyperframes_shell_sidecar" &&
    Boolean(ownedEvidenceFile) &&
    /^[a-f0-9]{64}$/i.test(ownedEvidenceSha256) &&
    Number.isFinite(ownedEvidenceSizeBytes) &&
    ownedEvidenceSizeBytes > 0;
  const localProofOnly =
    !explicitlyOwnedGenerated && (
      clip.rights_grant === false ||
      /local[_ -]?proof|operator[_ -]?legal[_ -]?review|no[_ -]?commercial[_ -]?grant/i.test(
        [licenceBasis, rightsStatus, usageScope].join(" "),
      )
    );
  const commercialUseAllowed = explicitlyOwnedGenerated
    ? true
    : localProofOnly
    ? false
    : typeof clip.commercial_use_allowed === "boolean"
      ? clip.commercial_use_allowed
      : clip.rights_grant === true ||
        /^owned[_ -]?generated/i.test(licenceBasis);
  return normaliseRightsRecord({
    asset_id: assetId,
    asset_type: cleanText(clip.asset_type || clip.media_kind || "motion_clip"),
    path: cleanText(clip.path || clip.local_path || clip.file_path || clip.media_path),
    source_url: cleanText(
      (verifiedSourceIdentity && (
        clip.canonical_source_url ||
        clip.motion_source_identity?.canonical_source_url
      )) ||
      clip.source_url ||
      clip.url,
    ),
    source_type: cleanText(clip.source_type || clip.source_kind || "official_direct_media"),
    source_family: cleanText(clip.source_family || clip.motion_family || clip.base_source_family),
    media_kind: cleanText(clip.media_kind || "direct_video"),
    licence_basis: licenceBasis,
    rights_basis: cleanText(clip.rights_basis) || licenceBasis,
    allowed_use: hasHashBoundOwnedEvidence
      ? "owned_editorial_motion_graphic"
      : cleanText(clip.allowed_use) || "transformative_editorial_short_form",
    allowed_platforms: localProofOnly
      ? []
      : asArray(clip.allowed_platforms).length
        ? clip.allowed_platforms
        : ["youtube", "instagram", "facebook"],
    commercial_use_allowed: commercialUseAllowed,
    credit_required: clip.credit_required === true,
    approval_status: localProofOnly
      ? "operator_legal_review_required"
      : explicitlyOwnedGenerated
        ? hasHashBoundOwnedEvidence
          ? "approved_for_owned_editorial_use"
          : "approved_for_transformative_editorial_use"
        : cleanText(clip.approval_status) || "approved_for_transformative_editorial_use",
    rights_status: explicitlyOwnedGenerated
      ? "approved"
      : localProofOnly
        ? "operator_legal_review_required"
        : rightsStatus || "approved",
    usage_scope: explicitlyOwnedGenerated
      ? hasHashBoundOwnedEvidence
        ? "owned_editorial_commercial_distribution"
        : "declared_licensed_scope"
      : localProofOnly
        ? "local_proof_only"
        : usageScope || "declared_licensed_scope",
    rights_grant: clip.rights_grant === true,
    rights_verdict: explicitlyOwnedGenerated ? "pass" : localProofOnly ? "RED" : "pass",
    rights_decision_basis: localProofOnly
      ? "provisional_renderer_local_proof_pending_policy_reconciliation"
      : explicitlyOwnedGenerated
        ? hasHashBoundOwnedEvidence
          ? cleanText(clip.rights_decision_basis) ||
            "validated_current_owned_hyperframes_shell_sidecar"
          : "explicit_owned_generated_asset"
        : cleanText(clip.rights_decision_basis) || "declared_asset_rights_record",
    sha256: cleanText(
      clip.sha256 || clip.asset_sha256 || clip.content_sha256,
    ).replace(/^sha256:/i, "").toLowerCase(),
    size_bytes: Number.isFinite(Number(clip.size_bytes ?? clip.asset_size_bytes))
      ? Number(clip.size_bytes ?? clip.asset_size_bytes)
      : null,
    source_start_s: Number.isFinite(Number(clip.start_s ?? clip.mediaStartS))
      ? Number(clip.start_s ?? clip.mediaStartS)
      : null,
    source_duration_s: Number.isFinite(Number(clip.duration_s ?? clip.durationS))
      ? Number(clip.duration_s ?? clip.durationS)
      : null,
    source_master_path: cleanText(clip.source_master_path || clip.master_path),
    source_master_sha256: cleanText(clip.source_master_sha256).replace(/^sha256:/i, "").toLowerCase(),
    source_info_path: cleanText(
      clip.source_info_path ||
      clip.info_json_path ||
      verifiedSourceIdentity?.sidecarPath,
    ),
    source_info_sha256: cleanText(
      clip.source_info_sha256 || verifiedSourceIdentity?.sidecarSha256,
    ).replace(/^sha256:/i, "").toLowerCase(),
    creator: cleanText(
      clip.creator ||
      clip.source_channel ||
      verifiedSourceIdentity?.authorName ||
      (explicitlyOwnedGenerated ? "Pulse Gaming" : ""),
    ),
    source_owner: cleanText(
      clip.source_owner ||
      clip.creator ||
      clip.source_channel ||
      verifiedSourceIdentity?.authorName ||
      (explicitlyOwnedGenerated ? "Pulse Gaming" : ""),
    ),
    provider_id: cleanText(
      clip.provider_id ||
      clip.provider ||
      (explicitlyOwnedGenerated ? "pulse_hyperframes" : ""),
    ),
    source_channel: cleanText(
      clip.source_channel ||
      verifiedSourceIdentity?.authorName ||
      (explicitlyOwnedGenerated ? "Pulse Gaming" : ""),
    ),
    source_channel_url: cleanText(
      clip.source_channel_url ||
      verifiedSourceIdentity?.authorUrl ||
      (explicitlyOwnedGenerated ? "local://pulse-gaming" : ""),
    ),
    risk_score: explicitlyOwnedGenerated
      ? hasHashBoundOwnedEvidence
        ? Number.isFinite(Number(clip.risk_score)) ? Number(clip.risk_score) : 0.02
        : 0
      : localProofOnly
      ? 1
      : Number.isFinite(Number(clip.risk_score)) ? Number(clip.risk_score) : 0.28,
    evidence_kind: ownedEvidenceKind,
    evidence_file: cleanText(
      ownedEvidenceFile ||
      (explicitlyOwnedGenerated ? "" : "final_clip_scene_plan"),
    ),
    evidence_sha256: ownedEvidenceSha256,
    evidence_size_bytes: ownedEvidenceSizeBytes,
  });
}

function isOwnedGeneratedCardAsset(value = {}) {
  const text = [
    value.asset_type,
    value.kind,
    value.media_kind,
    value.source_type,
    value.source_kind,
    value.source_family,
    value.licence_basis,
    value.license_basis,
    value.rights_basis,
    value.path,
    value.source_url,
  ].map(cleanText).join(" ").toLowerCase();
  return /(?:owned[_ -]?generated|internally[_ -]?generated|generated[_ -]?card|hyperframes|hf_(?:source|context|takeaway)_card)/.test(text);
}

function exactRightsRecordIndex(records = [], clip = {}) {
  const clipId = cleanText(clip.id || clip.asset_id).toLowerCase();
  const clipPath = normalisePathKey(clipPathValue(clip));
  return asArray(records).findIndex((record) => {
    const recordId = cleanText(record.asset_id || record.id).toLowerCase();
    const recordPath = normalisePathKey(clipPathValue(record));
    if (clipPath && recordPath) {
      if (clipPath !== recordPath) return false;
      return (
        !clipId ||
        !recordId ||
        clipId === recordId ||
        (isOwnedGeneratedCardAsset(clip) && isOwnedGeneratedCardAsset(record))
      );
    }
    return Boolean(clipId && recordId && clipId === recordId);
  });
}

function mergeDefinedRightsRecord(existing = {}, selected = {}) {
  const defined = Object.fromEntries(Object.entries(selected).filter(([, value]) => (
    value !== undefined && value !== null && value !== ""
  )));
  return { ...existing, ...defined };
}

function validEditorialPolicyAcceptanceForRender(value = {}) {
  const acceptedAt = cleanText(value.accepted_at);
  return Boolean(
    cleanText(value.accepted_by) &&
      acceptedAt &&
      !Number.isNaN(Date.parse(acceptedAt)),
  );
}

function currentHashBoundReconciledRightsRecord(record = {}, clip = {}, {
  allowMissingClipFingerprint = false,
  expectedReconciledAt = "",
} = {}) {
  const recordHash = cleanText(record.asset_sha256 || record.sha256).replace(/^sha256:/i, "").toLowerCase();
  const clipHash = cleanText(clip.sha256 || clip.asset_sha256).replace(/^sha256:/i, "").toLowerCase();
  const recordSize = Number(record.asset_size_bytes || record.size_bytes);
  const clipSize = Number(clip.size_bytes || clip.asset_size_bytes);
  const sameRunReconciliation = Boolean(
    allowMissingClipFingerprint === true &&
    cleanText(expectedReconciledAt) &&
    cleanText(record.reconciled_at) === cleanText(expectedReconciledAt)
  );
  const hashMatches = /^[a-f0-9]{64}$/.test(clipHash)
    ? recordHash === clipHash
    : sameRunReconciliation;
  const sizeMatches = Number.isFinite(clipSize) && clipSize > 0
    ? recordSize === clipSize
    : sameRunReconciliation;
  const statuses = [
    record.rights_verdict,
    record.verdict,
    record.status,
    record.approval_status,
    record.rights_status,
    record.usage_status,
  ].map(cleanText).filter(Boolean);
  const rightsDecisionBasis = cleanText(record.rights_decision_basis);
  const reconciliationBasis = cleanText(record.reconciliation_basis);
  const legacyValidatedOfficialRecord = Boolean(
    rightsDecisionBasis === "validated_official_direct_media_editorial_policy" &&
    reconciliationBasis === "current_validated_official_materialised_clip"
  );
  const currentValidatedBoundedEditorialRecord = Boolean(
    record.current_validated_official_materialised_clip === true &&
    rightsDecisionBasis === "validated_bounded_editorial_exception" &&
    reconciliationBasis === "current_validated_official_materialised_clip" &&
    record.transformative_rights_evidence_verified === true &&
    record.legal_exception_reliance === true &&
    record.rights_grant !== true &&
    record.rights_grant !== false &&
    record.live_publish_allowed === true &&
    isBoundedEditorialExceptionEvidenceKind(record.evidence_kind) &&
    /^uk_fair_dealing_(?:criticism_review|quotation|current_events_reporting)_bounded_excerpt$/i.test(
      cleanText(record.licence_basis || record.rights_basis),
    ) &&
    validEditorialPolicyAcceptanceForRender(record.editorial_policy_acceptance)
  );
  const sameRunExactCurrentRecord = Boolean(
    sameRunReconciliation &&
    reconciliationBasis === "exact_current_asset_record" &&
    [
      "declared_asset_rights_record",
      "validated_official_direct_media_editorial_policy",
      "explicit_owned_generated_asset",
    ].includes(rightsDecisionBasis)
  );
  const currentValidatedOwnedProceduralRecord = Boolean(
    record.current_validated_owned_procedural_motion === true &&
    rightsDecisionBasis === "strictly_verified_current_owned_motion_rights_bundle" &&
    reconciliationBasis === "current_validated_owned_procedural_motion" &&
    cleanText(record.source_owner || record.creator).toLowerCase() === "pulse gaming" &&
    cleanText(record.ownership_basis) === "wholly_owned_generated_asset" &&
    record.rights_grant === true
  );
  return Boolean(
    (
      legacyValidatedOfficialRecord ||
      currentValidatedBoundedEditorialRecord ||
      sameRunExactCurrentRecord ||
      currentValidatedOwnedProceduralRecord
    ) &&
    /^[a-f0-9]{64}$/.test(recordHash) &&
    hashMatches &&
    Number.isFinite(recordSize) &&
    recordSize > 0 &&
    sizeMatches &&
    record.commercial_use_allowed === true &&
    asArray(record.allowed_platforms).length > 0 &&
    Number(record.risk_score) <= 0.5 &&
    cleanText(record.evidence_file) &&
    /^[a-f0-9]{64}$/i.test(cleanText(record.evidence_sha256)) &&
    Number(record.evidence_size_bytes) > 0 &&
    statuses.some(flagshipRightsStatusIsPositive) &&
    !statuses.some(flagshipRightsStatusIsNegative)
  );
}

function augmentRightsLedgerForSelectedClips(rightsLedger = {}, clips = [], options = {}) {
  const normalisedRightsLedger = normaliseRightsLedgerForRender(rightsLedger);
  const existing = recordsFromRightsLedger(normalisedRightsLedger);
  const completed = existing.map((record) => ({ ...record }));
  const usedAssetByPath = new Map(
    asArray(normalisedRightsLedger?.used_assets)
      .map((asset) => [normalisePathKey(clipPathValue(asset)), asset])
      .filter(([pathKey]) => Boolean(pathKey)),
  );
  for (const clip of asArray(clips)) {
    const exactUsedAsset = usedAssetByPath.get(normalisePathKey(clipPathValue(clip)));
    const authoritativeClip = exactUsedAsset?.asset_id
      ? {
          ...clip,
          id: exactUsedAsset.asset_id,
          asset_id: exactUsedAsset.asset_id,
          sha256:
            exactUsedAsset.asset_sha256 ||
            exactUsedAsset.sha256 ||
            clip.sha256 ||
            clip.asset_sha256,
          size_bytes:
            exactUsedAsset.asset_size_bytes ??
            exactUsedAsset.size_bytes ??
            clip.size_bytes ??
            clip.asset_size_bytes,
        }
      : clip;
    const record = rightsRecordForSelectedClip(authoritativeClip);
    if (!record) continue;
    const exactIndex = exactRightsRecordIndex(completed, authoritativeClip);
    if (exactIndex >= 0) {
      if (!currentHashBoundReconciledRightsRecord(
        completed[exactIndex],
        authoritativeClip,
        options,
      )) {
        completed[exactIndex] = mergeDefinedRightsRecord(completed[exactIndex], record);
      }
    }
    else completed.push(record);
  }
  if (Array.isArray(normalisedRightsLedger)) return completed;

  const selectedRecords = asArray(clips)
    .map((clip) => {
      const exactUsedAsset = usedAssetByPath.get(normalisePathKey(clipPathValue(clip)));
      const authoritativeClip = exactUsedAsset?.asset_id
        ? { ...clip, id: exactUsedAsset.asset_id, asset_id: exactUsedAsset.asset_id }
        : clip;
      return completed[exactRightsRecordIndex(completed, authoritativeClip)];
    })
    .filter(Boolean);
  const inheritedBlockers = [
    ...asArray(normalisedRightsLedger?.blockers),
    ...asArray(normalisedRightsLedger?.failures),
  ].filter((blocker) => !/^(?:selected_asset_rights_sha256_missing|selected_asset_commercial_rights_unverified)$/i.test(cleanText(blocker)));
  const blockers = uniqueCleanTexts([
    ...inheritedBlockers,
    ...(selectedRecords.some((record) => !/^[a-f0-9]{64}$/i.test(
      cleanText(record.asset_sha256 || record.sha256).replace(/^sha256:/i, ""),
    ))
      ? ["selected_asset_rights_sha256_missing"]
      : []),
    ...(selectedRecords.some((record) => (
      record.commercial_use_allowed !== true ||
      /operator[_ -]?legal[_ -]?review|local[_ -]?proof/i.test(
        [record.approval_status, record.rights_status, record.usage_scope].map(cleanText).join(" "),
      )
    )) ? ["selected_asset_commercial_rights_unverified"] : []),
  ]);
  const inheritedStatus = cleanText(rightsLedger?.verdict || rightsLedger?.result).toUpperCase();
  const red = blockers.length > 0 || failStatus(inheritedStatus);
  const failures = uniqueCleanTexts(asArray(normalisedRightsLedger?.failures));
  const existingBlockers = uniqueCleanTexts(asArray(normalisedRightsLedger?.blockers));
  const existingFailures = uniqueCleanTexts(asArray(normalisedRightsLedger?.failures));
  const decisionUnchanged =
    (red && failStatus(inheritedStatus)) ||
    (!red && passStatus(inheritedStatus));
  const selectedOwnedProceduralRecordsAreCurrent =
    selectedRecords.length > 0 &&
    selectedRecords.every((record) =>
      record.current_validated_owned_procedural_motion === true &&
      cleanText(record.reconciliation_basis) ===
        "current_validated_owned_procedural_motion" &&
      cleanText(record.rights_decision_basis) ===
        "strictly_verified_current_owned_motion_rights_bundle",
    );
  if (
    selectedOwnedProceduralRecordsAreCurrent &&
    decisionUnchanged &&
    JSON.stringify(completed) === JSON.stringify(existing) &&
    JSON.stringify(blockers) === JSON.stringify(existingBlockers) &&
    JSON.stringify(failures) === JSON.stringify(existingFailures)
  ) {
    return normalisedRightsLedger;
  }
  return {
    ...(normalisedRightsLedger || {}),
    records: completed,
    blockers,
    failures,
    verdict: red ? "RED" : inheritedStatus || "AMBER",
    result: red ? "RED" : inheritedStatus || "AMBER",
    can_auto_publish: red ? false : normalisedRightsLedger?.can_auto_publish === true,
  };
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

function matchingGovernedClipEvidence(clip = {}, evidenceClips = []) {
  const clipPathKey = normalisePathKey(clipPathValue(clip));
  const clipId = cleanText(clip.id || clip.asset_id || clip.clip_id).toLowerCase();
  let idMatch = null;
  for (const evidence of asArray(evidenceClips)) {
    const evidencePathKey = normalisePathKey(clipPathValue(evidence));
    if (clipPathKey && evidencePathKey && clipPathKey === evidencePathKey) return evidence;
    const evidenceId = cleanText(evidence.id || evidence.asset_id || evidence.clip_id).toLowerCase();
    if (!idMatch && clipId && evidenceId === clipId) idMatch = evidence;
  }
  return idMatch;
}

function genericFallbackSourceFamily(value, clip = {}) {
  const family = cleanText(value).toLowerCase();
  const clipId = cleanText(clip.id || clip.asset_id || clip.clip_id).toLowerCase();
  if (!family) return true;
  if (clipId && family === clipId) return true;
  return /^(?:production_motion|motion_clip|segment_direct_motion)_\d+$/.test(family);
}

function hydrateClipWithGovernedEvidence(clip = {}, evidenceClips = []) {
  const evidence = matchingGovernedClipEvidence(clip, evidenceClips) || {};
  const sidecar = clipSidecarMetadata(clip);
  const explicitProvenance =
    (evidence.provenance && typeof evidence.provenance === "object" && evidence.provenance) ||
    (sidecar.provenance && typeof sidecar.provenance === "object" && sidecar.provenance) ||
    (clip.provenance && typeof clip.provenance === "object" && clip.provenance) ||
    null;
  const family = genericFallbackSourceFamily(clip.source_family || clip.motion_family, clip)
    ? cleanText(
        evidence.source_family ||
          evidence.motion_family ||
          sidecar.source_family ||
          sidecar.motion_family ||
          clip.source_family ||
          clip.motion_family,
      )
    : cleanText(clip.source_family || clip.motion_family);
  const baseFamily = cleanText(
    evidence.base_source_family ||
      sidecar.base_source_family ||
      clip.base_source_family ||
      explicitProvenance?.base_source_family,
  );
  const mediaStartS = numberOrNull(
    evidence.mediaStartS ??
      evidence.media_start_s ??
      evidence.provenance?.media_start_s ??
      sidecar.media_start_s ??
      clip.mediaStartS ??
      clip.media_start_s,
  );
  const durationS = numberOrNull(
    evidence.durationS ??
      evidence.duration_s ??
      evidence.provenance?.duration_s ??
      sidecar.duration_s ??
      sidecar.durationS ??
      clip.durationS ??
      clip.duration_s ??
      clip.duration,
  );
  return {
    ...clip,
    source_url: cleanText(clip.source_url || evidence.source_url || sidecar.source_url),
    source_type: cleanText(clip.source_type || evidence.source_type || sidecar.source_type),
    source_url_kind: cleanText(
      clip.source_url_kind || evidence.source_url_kind || sidecar.source_url_kind,
    ),
    source_family: family,
    base_source_family: baseFamily,
    motion_family: cleanText(evidence.motion_family || sidecar.motion_family || clip.motion_family || family),
    visual_family: cleanText(evidence.visual_family || clip.visual_family || evidence.motion_family || family),
    ...(mediaStartS !== null
      ? { mediaStartS, media_start_s: mediaStartS, start_s: mediaStartS }
      : {}),
    ...(durationS !== null
      ? { durationS, duration_s: durationS, duration: durationS }
      : {}),
    ...(explicitProvenance ? { provenance: { ...explicitProvenance } } : {}),
    ...(evidence.validated === true || sidecar.validated === true || clip.validated === true
      ? { validated: true }
      : {}),
    ...(evidence.segmentValidationPassed === true ||
    sidecar.segmentValidationPassed === true ||
    clip.segmentValidationPassed === true
      ? { segmentValidationPassed: true }
      : {}),
  };
}

async function hydrateClipWithTrustedSourceIdentity(
  clip = {},
  { workspaceRoot = process.cwd() } = {},
) {
  const sourceIdentityFields = await materializedSourceIdentityFields(clip, {
    root: workspaceRoot,
  });
  const hydrated = {
    ...clip,
    ...sourceIdentityFields,
  };
  const motionSourceIdentity = compoundMotionSourceIdentity(hydrated);
  return {
    ...hydrated,
    motion_source_identity: motionSourceIdentity,
    ...(motionSourceIdentity.strict_pass
      ? {
          base_source_asset_id: motionSourceIdentity.base_source_asset_id,
          base_source_identity_basis: motionSourceIdentity.base_source_identity_basis,
        }
      : {}),
  };
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

function evidenceReferencePath(...values) {
  for (const value of values) {
    if (typeof value === "string") {
      const cleaned = cleanText(value);
      if (cleaned && cleaned !== "[object Object]") return cleaned;
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const cleaned = cleanText(
      value.path ||
        value.file_path ||
        value.evidence_path ||
        value.rights_evidence_path,
    );
    if (cleaned && cleaned !== "[object Object]") return cleaned;
  }
  return "";
}

function renderedScenePlanClipObjects({
  renderReport = {},
  renderManifest = {},
  fallbackClips = [],
  selectedInputAssets = [],
} = {}) {
  const scenes = renderedScenePlanScenes(renderReport, renderManifest)
    .filter((scene) => cleanText(scene.path || scene.local_path || scene.file_path || scene.media_path));
  if (scenes.length < 3) return [];

  const fallbackByPath = new Map();
  const fallbackByFamily = new Map();
  const selectedInputByPath = new Map();
  for (const selectedInput of asArray(selectedInputAssets)) {
    const pathKey = normalisePathKey(clipPathValue(selectedInput));
    if (pathKey && !selectedInputByPath.has(pathKey)) {
      selectedInputByPath.set(pathKey, selectedInput);
    }
  }
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
    const selectedInput = selectedInputByPath.get(pathKey) || {};
    const fallbackRights = objectValue(fallback.owned_rights_record);
    const readableCardKind = cleanText(scene.readableCardKind || scene.readable_card_kind);
    const isReadableCard = Boolean(readableCardKind);
    const selectedAssetId = cleanText(
      selectedInput.asset_id || selectedInput.id,
    );
    const selectedAssetSha256 = cleanText(
      selectedInput.asset_sha256 ||
        selectedInput.sha256 ||
        scene.asset_sha256 ||
        scene.sha256 ||
        fallback.asset_sha256 ||
        fallback.sha256,
    ).replace(/^sha256:/i, "").toLowerCase();
    const selectedAssetSizeBytes = numberOrNull(
      selectedInput.asset_size_bytes ??
        selectedInput.size_bytes ??
        scene.asset_size_bytes ??
        scene.size_bytes ??
        fallback.asset_size_bytes ??
        fallback.size_bytes,
    );
    const assetId = cleanText(
      isReadableCard
        ? selectedAssetId || fallback.asset_id || fallback.id || scene.asset_id || scene.id
        : scene.asset_id || scene.id || fallback.asset_id || fallback.id || selectedAssetId,
    ) || `render_scene_${index + 1}`;
    const sourceFamily = cleanText(
      selectedInput.source_family ||
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
      id: assetId,
      asset_id: assetId,
      path: pathValue,
      local_materialized_path: pathValue,
      asset_sha256: selectedAssetSha256 || undefined,
      sha256: selectedAssetSha256 || undefined,
      asset_size_bytes: selectedAssetSizeBytes,
      size_bytes: selectedAssetSizeBytes,
      source_family: sourceFamily,
      motion_family: cleanText(fallback.motion_family || scene.motion_family || sourceFamily),
      base_source_family: cleanText(fallback.base_source_family || scene.baseSourceKey || scene.base_source_key || sourceFamily),
      source_type: cleanText(
        scene.source_type ||
          selectedInput.source_type ||
          fallbackRights.source_type ||
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
      media_kind: cleanText(
        scene.media_kind ||
          selectedInput.media_kind ||
          fallback.media_kind ||
          fallback.asset_type ||
          "motion_clip",
      ),
      source_url: cleanText(
        scene.source_url ||
          selectedInput.source_url ||
          fallbackRights.source_url ||
          fallback.source_url ||
          fallback.url ||
          (isReadableCard ? `local://pulse-hyperframes/${sourceFamily}` : ""),
      ),
      rights_basis: cleanText(
        scene.rights_basis ||
          selectedInput.rights_basis ||
          fallbackRights.rights_basis ||
          fallbackRights.licence_basis ||
          fallback.rights_basis ||
          fallback.licence_basis ||
          (isReadableCard ? "owned_generated_editorial_motion_graphic" : ""),
      ),
      licence_basis: cleanText(
        scene.licence_basis ||
          selectedInput.licence_basis ||
          fallbackRights.licence_basis ||
          fallbackRights.rights_basis ||
          fallback.licence_basis ||
          fallback.rights_basis ||
          (isReadableCard ? "owned_generated_editorial_motion_graphic" : ""),
      ),
      commercial_use_allowed:
        scene.commercial_use_allowed ??
        selectedInput.commercial_use_allowed ??
        fallbackRights.commercial_use_allowed ??
        fallback.commercial_use_allowed ??
        (isReadableCard ? true : undefined),
      rights_grant:
        scene.rights_grant ??
        selectedInput.rights_grant ??
        fallbackRights.rights_grant ??
        fallback.rights_grant ??
        (isReadableCard ? true : undefined),
      source_owner: cleanText(
        scene.source_owner ||
          selectedInput.source_owner ||
          fallbackRights.source_owner ||
          fallback.source_owner ||
          (isReadableCard ? "Pulse Gaming" : ""),
      ),
      creator: cleanText(
        scene.creator ||
          selectedInput.creator ||
          fallbackRights.creator ||
          fallbackRights.source_owner ||
          fallback.creator ||
          (isReadableCard ? "Pulse Gaming" : ""),
      ),
      allowed_platforms:
        asArray(scene.allowed_platforms).length
          ? scene.allowed_platforms
          : asArray(selectedInput.allowed_platforms).length
            ? selectedInput.allowed_platforms
          : asArray(fallbackRights.allowed_platforms).length
            ? fallbackRights.allowed_platforms
          : asArray(fallback.allowed_platforms).length
            ? fallback.allowed_platforms
            : isReadableCard
              ? ["youtube_shorts", "instagram_reels", "facebook_reels"]
              : [],
      credit_required:
        typeof scene.credit_required === "boolean"
          ? scene.credit_required
          : typeof selectedInput.credit_required === "boolean"
            ? selectedInput.credit_required
          : typeof fallbackRights.credit_required === "boolean"
            ? fallbackRights.credit_required
          : typeof fallback.credit_required === "boolean"
            ? fallback.credit_required
            : isReadableCard
              ? false
              : undefined,
      risk_score: Number.isFinite(Number(scene.risk_score))
        ? Number(scene.risk_score)
        : Number.isFinite(Number(selectedInput.risk_score))
          ? Number(selectedInput.risk_score)
        : Number.isFinite(Number(fallbackRights.risk_score))
          ? Number(fallbackRights.risk_score)
        : Number.isFinite(Number(fallback.risk_score))
          ? Number(fallback.risk_score)
          : isReadableCard
            ? 0.02
            : undefined,
      approval_status: cleanText(
        scene.approval_status ||
          selectedInput.approval_status ||
          fallbackRights.approval_status ||
          fallback.approval_status ||
          (isReadableCard ? "approved_for_owned_editorial_use" : ""),
      ),
      owned_explainer_visual_plan:
        scene.owned_explainer_visual_plan === true ||
        selectedInput.owned_explainer_visual_plan === true ||
        fallback.owned_explainer_visual_plan === true ||
        isReadableCard,
      provider_id: cleanText(
        scene.provider_id ||
          selectedInput.provider_id ||
          fallback.provider_id ||
          (isReadableCard ? "pulse_hyperframes" : ""),
      ),
      allowed_use: cleanText(
        scene.allowed_use ||
          selectedInput.allowed_use ||
          fallbackRights.allowed_use ||
          fallback.allowed_use ||
          (isReadableCard ? "owned_editorial_motion_graphic" : ""),
      ),
      rights_status: cleanText(
        scene.rights_status ||
          selectedInput.rights_status ||
          fallbackRights.rights_status ||
          fallback.rights_status ||
          (isReadableCard ? "approved" : ""),
      ),
      usage_scope: cleanText(
        scene.usage_scope ||
          selectedInput.usage_scope ||
          fallbackRights.usage_scope ||
          fallback.usage_scope ||
          (isReadableCard ? "owned_editorial_commercial_distribution" : ""),
      ),
      evidence_kind: cleanText(
        scene.evidence_kind ||
          selectedInput.evidence_kind ||
          fallbackRights.evidence_kind ||
          fallback.evidence_kind,
      ),
      evidence_file: evidenceReferencePath(
        scene.rights_evidence_file_path,
        scene.evidence_file_path,
        scene.rights_evidence_file,
        scene.evidence_file,
        scene.evidence_path,
        selectedInput.rights_evidence_file_path,
        selectedInput.evidence_file_path,
        selectedInput.rights_evidence_file,
        selectedInput.evidence_file,
        selectedInput.evidence_path,
        fallbackRights.rights_evidence_path,
        fallbackRights.evidence_file,
        fallbackRights.evidence_path,
        fallback.rights_evidence_file_path,
        fallback.evidence_file_path,
        fallback.rights_evidence_file,
        fallback.evidence_file,
        fallback.evidence_path,
      ),
      evidence_sha256: cleanText(
        scene.rights_evidence_file_sha256 ||
          scene.evidence_file_sha256 ||
          scene.rights_evidence_sha256 ||
          scene.evidence_sha256 ||
          selectedInput.rights_evidence_file_sha256 ||
          selectedInput.evidence_file_sha256 ||
          selectedInput.rights_evidence_sha256 ||
          selectedInput.evidence_sha256 ||
          fallbackRights.rights_evidence_sha256 ||
          fallbackRights.evidence_sha256 ||
          fallback.rights_evidence_file_sha256 ||
          fallback.evidence_file_sha256 ||
          fallback.rights_evidence_sha256 ||
          fallback.evidence_sha256,
      ).replace(/^sha256:/i, "").toLowerCase(),
      evidence_size_bytes: numberOrNull(
        scene.rights_evidence_file_size_bytes ??
          scene.evidence_file_size_bytes ??
          scene.rights_evidence_size_bytes ??
          scene.evidence_size_bytes ??
          selectedInput.rights_evidence_file_size_bytes ??
          selectedInput.evidence_file_size_bytes ??
          selectedInput.rights_evidence_size_bytes ??
          selectedInput.evidence_size_bytes ??
          fallbackRights.rights_evidence_size_bytes ??
          fallbackRights.evidence_size_bytes ??
          fallback.rights_evidence_file_size_bytes ??
          fallback.evidence_file_size_bytes ??
          fallback.rights_evidence_size_bytes ??
          fallback.evidence_size_bytes,
      ),
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

function rendererBridgeClipFromProductionClip(clip = {}, index = 0, canonicalSubject = "") {
  const mediaStartS = numberOrNull(
    clip.mediaStartS ?? clip.media_start_s ?? clip.start_s ?? clip.startS,
  );
  const entity = cleanText(clip.entity || canonicalSubject);
  const entities = uniqueCleanTexts([
    ...asArray(clip.entities),
    entity,
  ]);
  return {
    id: clipIdentity(clip, index),
    path: clipPathValue(clip),
    original_path: cleanText(clip.original_path || clip.originalPath),
    asset_sha256: cleanText(
      clip.asset_sha256 ||
        clip.sha256 ||
        clip.materialized_file_evidence?.sha256,
    ).replace(/^sha256:/i, ""),
    asset_size_bytes: numberOrNull(
      clip.asset_size_bytes ??
        clip.size_bytes ??
        clip.materialized_file_evidence?.size_bytes,
    ),
    canonical_source_url: cleanText(clip.canonical_source_url || clip.canonicalSourceUrl),
    youtube_video_id: cleanText(clip.youtube_video_id || clip.youtubeVideoId),
    source_master_sha256: cleanText(clip.source_master_sha256 || clip.sourceMasterSha256),
    sampled_visual_fingerprint: cleanText(
      clip.sampled_visual_fingerprint || clip.sampledVisualFingerprint,
    ),
    visual_content_fingerprint:
      clip.visual_content_fingerprint &&
      typeof clip.visual_content_fingerprint === "object" &&
      !Array.isArray(clip.visual_content_fingerprint)
        ? structuredClone(clip.visual_content_fingerprint)
        : undefined,
    base_source_asset_id: cleanText(clip.base_source_asset_id || clip.baseSourceAssetId),
    base_source_identity_basis: cleanText(
      clip.base_source_identity_basis || clip.baseSourceIdentityBasis,
    ),
    source_url: cleanText(clip.source_url || clip.url),
    source_type: cleanText(clip.source_type || clip.asset_type),
    source_kind: cleanText(clip.source_kind),
    source_family: cleanText(clip.source_family || clip.motion_family),
    base_source_family: cleanText(clip.base_source_family || clip.original_source_family || clip.provenance?.base_source_family),
    motion_family: cleanText(clip.motion_family || clip.source_family),
    visual_family: cleanText(clip.visual_family || clip.motion_family || clip.source_family),
    entity: entity || null,
    entities,
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
    provenance:
      clip.provenance && typeof clip.provenance === "object"
        ? { ...clip.provenance }
        : null,
    transformation_provenance:
      clip.transformation_provenance &&
      typeof clip.transformation_provenance === "object"
        ? structuredClone(clip.transformation_provenance)
        : null,
    validation_provenance:
      clip.validation_provenance &&
      typeof clip.validation_provenance === "object"
        ? structuredClone(clip.validation_provenance)
        : null,
    visual_repair:
      clip.visual_repair && typeof clip.visual_repair === "object"
        ? structuredClone(clip.visual_repair)
        : null,
    materialized_file_evidence:
      clip.materialized_file_evidence &&
      typeof clip.materialized_file_evidence === "object"
        ? structuredClone(clip.materialized_file_evidence)
        : null,
    motion_source_identity:
      clip.motion_source_identity &&
      typeof clip.motion_source_identity === "object"
        ? structuredClone(clip.motion_source_identity)
        : null,
    owned_explainer_visual_plan: clip.owned_explainer_visual_plan === true,
    source_safety_blocked: clip.source_safety_blocked === true,
    counts_towards_motion_readiness:
      clip.counts_towards_motion_readiness === true,
    materialized: clip.materialized === true || clip.materialised === true,
    generator_project_id: cleanText(clip.generator_project_id),
    generator_version: numberOrNull(clip.generator_version),
    generator_variant: numberOrNull(clip.generator_variant),
    generator_design_role: cleanText(clip.generator_design_role),
    generator_design_grammar: cleanText(clip.generator_design_grammar),
    generator_motion_operators: Array.isArray(clip.generator_motion_operators)
      ? structuredClone(clip.generator_motion_operators)
      : [],
    generator_master_sha256: cleanText(clip.generator_master_sha256)
      .replace(/^sha256:/i, "")
      .toLowerCase(),
    materialised_output_sha256: cleanText(clip.materialised_output_sha256)
      .replace(/^sha256:/i, "")
      .toLowerCase(),
    materialised_output_size_bytes: numberOrNull(
      clip.materialised_output_size_bytes,
    ),
    evidence_file_path: cleanText(clip.evidence_file_path),
    evidence_file_sha256: cleanText(clip.evidence_file_sha256)
      .replace(/^sha256:/i, "")
      .toLowerCase(),
    evidence_file_size_bytes: numberOrNull(clip.evidence_file_size_bytes),
    rights_evidence_file_path: cleanText(clip.rights_evidence_file_path),
    rights_evidence_file_sha256: cleanText(clip.rights_evidence_file_sha256)
      .replace(/^sha256:/i, "")
      .toLowerCase(),
    rights_evidence_file_size_bytes: numberOrNull(
      clip.rights_evidence_file_size_bytes,
    ),
    owned_rights_evaluation:
      clip.owned_rights_evaluation &&
      typeof clip.owned_rights_evaluation === "object"
        ? structuredClone(clip.owned_rights_evaluation)
        : null,
    owned_generated_rights_grant:
      clip.owned_generated_rights_grant &&
      typeof clip.owned_generated_rights_grant === "object"
        ? structuredClone(clip.owned_generated_rights_grant)
        : null,
  };
}

function footagePlanForDirector({ footageInventory = {}, clips = [] } = {}) {
  const existingAccepted = asArray(footageInventory.motion_inventory?.accepted_local_clips);
  if (existingAccepted.length && !asArray(clips).length) return footageInventory;

  const accepted = asArray(clips)
    .map(directorClipFromProductionClip)
    .filter((clip) => cleanText(clip.path) && cleanText(clip.source_family));
  const distinctFamilies = [...new Set(accepted.map((clip) => cleanText(clip.source_family)).filter(Boolean))];
  if (!accepted.length) return footageInventory;
  const governedOwnedGeneratorDeck = accepted.every(
    (clip) =>
      Boolean(cleanText(clip.generator_project_id)) &&
      /^[a-f0-9]{64}$/i.test(cleanText(clip.generator_master_sha256)) &&
      /^[a-f0-9]{64}$/i.test(
        cleanText(
          clip.materialised_output_sha256 ||
            clip.materialized_output_sha256,
        ),
      ) &&
      clip.owned_explainer_visual_plan === true &&
      clip.counts_towards_motion_readiness === true &&
      clip.owned_generated_rights_grant?.grant_type === "owned_generated" &&
      clip.owned_generated_rights_grant?.commercial_use_allowed === true,
  );
  const ownedGeneratorProjectCount = new Set(
    accepted.map((clip) => cleanText(clip.generator_project_id)).filter(Boolean),
  ).size;

  const requiredScenes = Math.max(
    5,
    Math.min(
      accepted.length,
      Number(footageInventory.motion_budget?.required_motion_scenes || accepted.length),
    ),
  );
  const requiredFamilies = Math.max(
    4,
    Math.min(
      distinctFamilies.length,
      Number(footageInventory.motion_budget?.required_distinct_families || distinctFamilies.length),
    ),
  );
  const requiredDistinctSourceAssets = governedOwnedGeneratorDeck
    ? requiredFamilies
    : Number(
        footageInventory.motion_budget?.required_distinct_source_assets ||
          footageInventory.motion_budget?.required_distinct_base_sources ||
          requiredFamilies,
      );
  const availableDistinctSourceAssets = governedOwnedGeneratorDeck
    ? ownedGeneratorProjectCount
    : Math.max(
        Number(
          footageInventory.motion_budget?.available_distinct_source_assets ||
            footageInventory.motion_budget?.available_distinct_base_sources ||
            0,
        ),
        distinctFamilies.length,
      );
  const readinessBlockers = [];
  if (accepted.length < requiredScenes) readinessBlockers.push("actual_motion_clip_minimum_not_met");
  if (distinctFamilies.length < requiredFamilies) readinessBlockers.push("distinct_motion_families_minimum_not_met");
  if (availableDistinctSourceAssets < requiredDistinctSourceAssets) {
    readinessBlockers.push("distinct_motion_source_assets_minimum_not_met");
  }

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
      required_distinct_source_assets: requiredDistinctSourceAssets,
      required_distinct_base_sources: requiredDistinctSourceAssets,
      available_distinct_source_assets: availableDistinctSourceAssets,
      available_distinct_base_sources: availableDistinctSourceAssets,
    },
    readiness: {
      ...(footageInventory.readiness || {}),
      status: readinessBlockers.length ? "blocked" : "ready",
      blockers: readinessBlockers,
      warnings: [
        ...uniqueCleanTexts(footageInventory.readiness?.warnings),
        "footage_plan_derived_from_selected_production_clips",
        ...(governedOwnedGeneratorDeck
          ? ["owned_generator_project_source_floor_recomputed"]
          : []),
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
  if (failStatus(rightsLedger.verdict || rightsLedger.result)) return "fail";
  if (recordsFromRightsLedger(rightsLedger).length || asArray(rightsLedger.assets).length) return "pass";
  return "not_checked";
}

const POST_RENDER_REQUIRED_CHECK_BLOCKERS = Object.freeze({
  final_render_mp4: "final_render_mp4_not_passed",
  public_output: "public_output_not_passed",
  rights: "rights_ledger_not_passed",
  script: "script_scorecard_not_passed",
  director: "director_plan_not_passed",
  benchmark: "benchmark_not_passed",
  visual_quality: "visual_quality_not_passed",
  motion_clip_floor: "motion_clip_floor_not_passed",
  distinct_motion_families: "distinct_motion_families_not_passed",
  audio_loudness: "audio_loudness_not_passed",
  voice_quality: "voice_quality_not_passed",
  captions: "caption_manifest_not_passed",
  decoded_visual_output: "decoded_visual_output_not_passed",
});

function authoritativePostRenderNarrationQa({
  report = {},
  storyId = "",
  generationManifest = {},
  generationManifestSha256 = "",
  requireCadence = false,
} = {}) {
  const lineage = report.lineage || {};
  const generationLineage = lineage.generation_manifest || {};
  const expectedArtifacts = generationManifest.artifacts || {};
  const expectedStoryId = cleanText(storyId || generationManifest.story_id);
  const checks = report.checks && typeof report.checks === "object"
    ? Object.values(report.checks)
    : [];
  const hashMatches = [
    [lineage.final_video_sha256, expectedArtifacts.final_video?.sha256],
    [lineage.final_audio_sha256, expectedArtifacts.final_audio?.sha256],
    [lineage.frozen_word_timestamps_sha256, expectedArtifacts.word_timestamps?.sha256],
    [lineage.display_script_sha256, expectedArtifacts.script?.sha256],
    [lineage.spoken_script_sha256, expectedArtifacts.spoken_script?.sha256],
    [lineage.captions_sha256, expectedArtifacts.captions?.sha256],
  ].every(([actual, expected]) => {
    const expectedText = cleanText(expected).toLowerCase();
    return Boolean(expectedText) && cleanText(actual).toLowerCase() === expectedText;
  });
  return Boolean(
    generationManifest.complete === true &&
    cleanText(generationManifest.verdict).toUpperCase() === "GREEN" &&
    cleanText(generationManifest.run_id) &&
    cleanText(generationManifestSha256) &&
    report.authoritative === true &&
    cleanText(report.producer_id) === "pulse-gaming-post-render-narration-qa" &&
    cleanText(report.story_id) === expectedStoryId &&
    cleanText(report.run_id) === cleanText(generationManifest.run_id) &&
    cleanText(generationLineage.sha256).toLowerCase() === cleanText(generationManifestSha256).toLowerCase() &&
    cleanText(generationLineage.verdict).toUpperCase() === "GREEN" &&
    passStatus(report.verdict || report.status) &&
    asArray(report.blockers).length === 0 &&
    checks.length > 0 &&
    checks.every((value) => value === true) &&
    hashMatches &&
    (!requireCadence || report.checks?.cadence_passed === true)
  );
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
  flagshipGenerationManifest = {},
  flagshipGenerationManifestSha256 = "",
} = {}) {
  const decodedVisualGate =
    renderReport.decoded_visual_gate ||
    renderManifest.decoded_visual_gate ||
    visualQuality.decoded_visual_gate ||
    null;
  const requiresDecodedVisualGate =
    cleanText(renderReport.creative_system_version || renderManifest.creative_system_version) ===
    "pulse_visual_identity_v5";
  const decodedVisualGatePassed =
    decodedVisualGate?.decoded_media_evidence === true &&
    passStatus(decodedVisualGate?.status) &&
    asArray(decodedVisualGate?.blockers).length === 0 &&
    Number(decodedVisualGate?.frame_count || 0) >= 3;
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
  const voiceQualityAuthoritative = authoritativePostRenderNarrationQa({
    report: voiceQualityReport,
    storyId: cleanText(storyId || renderManifest.story_id),
    generationManifest: flagshipGenerationManifest,
    generationManifestSha256: flagshipGenerationManifestSha256,
    requireCadence: true,
  });
  const captionsAuthoritative = authoritativePostRenderNarrationQa({
    report: captionManifest,
    storyId: cleanText(storyId || renderManifest.story_id),
    generationManifest: flagshipGenerationManifest,
    generationManifestSha256: flagshipGenerationManifestSha256,
  });
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
    voice_quality: voiceQualityAuthoritative ? "pass" : "fail",
    captions: captionsAuthoritative ? "pass" : "fail",
    decoded_visual_output: requiresDecodedVisualGate
      ? decodedVisualGatePassed
        ? "pass"
        : "fail"
      : "not_required",
  };
  const blockers = [];
  for (const [checkName, blocker] of Object.entries(POST_RENDER_REQUIRED_CHECK_BLOCKERS)) {
    const checkStatus = statusText(checks[checkName]);
    if (checkStatus === "not_required" && checkName === "decoded_visual_output") continue;
    if (!passStatus(checkStatus)) blockers.push(blocker);
  }
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
  if (!voiceQualityAuthoritative) blockers.push("voice_quality_not_authoritative");
  if (!captionsAuthoritative) blockers.push("caption_manifest_not_authoritative");
  if (requiresDecodedVisualGate && !decodedVisualGatePassed) {
    blockers.push("decoded_visual_gate_failed", ...asArray(decodedVisualGate?.blockers));
  }
  blockers.push(
    ...asArray(scriptScorecard.blockers),
    ...asArray(coherenceReport.failures),
    ...asArray(coherenceReport.blockers),
    ...asArray(rightsLedger.failures),
    ...unresolvedDirectorBlockers,
    ...asArray(audioSegmentReport.blockers),
    ...asArray(voiceQualityReport.blockers),
    ...asArray(captionManifest.blockers),
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
      creative_system_version:
        cleanText(renderReport.creative_system_version || renderManifest.creative_system_version) || null,
      decoded_visual_gate: decodedVisualGate,
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
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function evidencePathMatchingOriginalStyle(originalPath, finalPath, workspaceRoot) {
  if (path.isAbsolute(cleanText(originalPath))) return path.resolve(finalPath);
  return path.relative(path.resolve(workspaceRoot || process.cwd()), path.resolve(finalPath)).replace(/\\/g, "/");
}

async function bindDecodedVisualGateToFinalOutput({
  renderReport = {},
  outputPath = "",
  workspaceRoot = process.cwd(),
} = {}) {
  const gate = renderReport?.decoded_visual_gate;
  if (!gate || typeof gate !== "object" || !(await fs.pathExists(outputPath))) return renderReport;
  const stat = await fs.stat(outputPath);
  const boundGate = {
    ...gate,
    mp4_path: evidencePathMatchingOriginalStyle(gate.mp4_path, outputPath, workspaceRoot),
    mp4_sha256: await sha256File(outputPath),
    mp4_size_bytes: stat.size,
    final_output_binding_verified: true,
  };
  renderReport.decoded_visual_gate = boundGate;

  const declaredReportPath = cleanText(gate.report_path);
  if (declaredReportPath) {
    const reportPath = path.isAbsolute(declaredReportPath)
      ? declaredReportPath
      : path.resolve(workspaceRoot || process.cwd(), declaredReportPath);
    if (await fs.pathExists(reportPath)) {
      const persistedGate = await readJsonIfPresent(reportPath, {});
      await fs.writeJson(reportPath, { ...persistedGate, ...boundGate }, { spaces: 2 });
    }
  }
  return renderReport;
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
const MIN_SOURCE_LOCK_CARD_DURATION_S = V5_SOURCE_CARD_TIMING.minimum_visible_duration_s;
const TARGET_SOURCE_LOCK_CARD_DURATION_S = V5_SOURCE_CARD_TIMING.planned_visible_duration_s;
const MAX_SOURCE_LOCK_CARD_DURATION_S = V5_SOURCE_CARD_TIMING.maximum_visible_duration_s;
const MIN_OVERLAY_PROOF_CARD_DURATION_S = 2.6;
const MIN_READABLE_HYPERFRAMES_CARD_DURATION_S = V5_READABLE_CARD_TIMING.minimum_visible_duration_s;
const MAX_READABLE_HYPERFRAMES_CARD_DURATION_S = V5_READABLE_CARD_TIMING.maximum_visible_duration_s;
const SCENE_DURATION_FRAME_TOLERANCE_S = 1 / 30;
const MAX_HYPERFRAMES_CARD_COUNT_RATIO = 0.42;
const MAX_HYPERFRAMES_CARD_DURATION_RATIO = PREMIUM_EDIT_RHYTHM_V5.max_generated_card_duration_ratio;
const HYPERFRAMES_CARD_SELECTION_PRIORITY = ["source", "takeaway", "context", "quote", "timeline"];
const PRODUCTION_RENDER_SCENE_XFADE_S = 0.25;
const MIN_PRODUCTION_RENDER_SCENE_XFADE_S = 0.04;
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

function normaliseSourceCardIdentity(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\b(?:news|official|verified|primary|discovery)?\s*source\b/g, " ")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function sourceCardIdentityContract({
  kind,
  readableText,
  authoritativeLabels = [],
} = {}) {
  if (cleanText(kind).toLowerCase() !== "source") {
    return { verdict: "not_applicable", blockers: [], authoritative_labels: [] };
  }
  const labels = uniqueCleanTexts(authoritativeLabels);
  if (!labels.length) {
    return { verdict: "not_governed", blockers: [], authoritative_labels: [] };
  }
  const actual = normaliseSourceCardIdentity(readableText);
  const allowed = labels
    .map((label) => ({ label, identity: normaliseSourceCardIdentity(label) }))
    .filter((entry) => entry.identity);
  const matches = actual && allowed.some(({ identity }) =>
    actual === identity || actual.includes(identity) || identity.includes(actual),
  );
  const expected = allowed[0]?.identity || "missing";
  const blocker = actual
    ? `source_card_label_mismatch:${actual}:${expected}`
    : `source_card_label_missing:${expected}`;
  return {
    verdict: matches ? "pass" : "fail",
    blockers: matches ? [] : [blocker],
    readable_text: cleanText(readableText),
    actual_identity: actual || null,
    authoritative_labels: labels,
  };
}

function assertSourceCardIdentityReady(story = {}) {
  const blockers = uniqueCleanTexts(story.premium_shell_blockers)
    .filter((blocker) => /^source:source_card_label_(?:mismatch|missing):/i.test(blocker));
  if (blockers.length) {
    throw new Error(`production_render_source_card_identity_blocked:${blockers.join(",")}`);
  }
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
  return Math.max(
    0,
    Math.min(available, byRatio, PREMIUM_EDIT_RHYTHM_V5.max_generated_card_scene_count),
  );
}

function readableHyperframesCardDurationS(card = {}) {
  if (isHyperframesSourceCard(card)) {
    return TARGET_SOURCE_LOCK_CARD_DURATION_S;
  }
  return Math.min(
    MAX_READABLE_HYPERFRAMES_CARD_DURATION_S,
    Math.max(
      MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
      numberOrNull(card.readability?.minimum_visible_duration_s) || 0,
      numberOrNull(card.readability?.planned_visible_duration_s) || 0,
    ),
  );
}

function maxReadableHyperframesCardDurationS(card = {}) {
  if (isHyperframesSourceCard(card)) {
    return MAX_SOURCE_LOCK_CARD_DURATION_S;
  }
  return Math.min(
    MAX_READABLE_HYPERFRAMES_CARD_DURATION_S,
    Math.max(
      readableHyperframesCardDurationS(card),
      numberOrNull(card.readability?.max_readable_card_duration_s) || 0,
      numberOrNull(card.readability?.maximum_visible_duration_s) || 0,
      numberOrNull(card.max_readable_card_duration_s) || 0,
      numberOrNull(card.maximum_visible_duration_s) || 0,
    ),
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
  const candidates = prioritised.map((card, priority) => ({
    card,
    durationS: readableHyperframesCardDurationS(card),
    priority,
  }));
  let best = { cards: [], durationS: 0, priorityScore: Number.POSITIVE_INFINITY };

  function visit(index, selected, durationS, priorityScore) {
    if (durationS > maxCardDurationS + 0.01 || selected.length > maxCards) return;
    if (
      selected.length > best.cards.length ||
      (selected.length === best.cards.length && priorityScore < best.priorityScore) ||
      (selected.length === best.cards.length &&
        priorityScore === best.priorityScore &&
        durationS < best.durationS)
    ) {
      best = { cards: [...selected], durationS, priorityScore };
    }
    if (index >= candidates.length || selected.length >= maxCards) return;
    for (let next = index; next < candidates.length; next += 1) {
      const candidate = candidates[next];
      const candidateIsSource = isHyperframesSourceCard(candidate.card);
      const selectedSourceCount = selected.filter(isHyperframesSourceCard).length;
      const selectedNarrativeCount = selected.length - selectedSourceCount;
      if (candidateIsSource && selectedSourceCount >= 1) continue;
      if (
        !candidateIsSource &&
        selectedNarrativeCount >= PREMIUM_EDIT_RHYTHM_V5.max_narrative_card_scene_count
      ) {
        continue;
      }
      selected.push(candidate.card);
      visit(
        next + 1,
        selected,
        durationS + candidate.durationS,
        priorityScore + candidate.priority,
      );
      selected.pop();
    }
  }

  visit(0, [], 0, 0);
  return best.cards.sort(
    (left, right) => prioritised.indexOf(left) - prioritised.indexOf(right),
  );
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

function cardAssetRootsForArtifact(artifactDir = "", workspaceRoot = process.cwd()) {
  const roots = [];
  let current = path.resolve(artifactDir || workspaceRoot);
  for (let depth = 0; depth < 16; depth += 1) {
    if (!roots.includes(current)) roots.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  const workspace = path.resolve(workspaceRoot);
  if (!roots.includes(workspace)) roots.push(workspace);
  return roots;
}

function governedPackageCardAssets(artifactDir = "", storyId = "", channelId = "pulse-gaming") {
  const cardDir = path.join(path.resolve(artifactDir || ""), "flagship", "cards");
  const isDefaultChannel = !channelId || channelId === "pulse-gaming";
  const descriptorFor = (kind) => {
    const channelPath = !isDefaultChannel
      ? path.join(cardDir, `hf_${kind}_card_${storyId}__${channelId}.mp4`)
      : null;
    const storyPath = path.join(cardDir, `hf_${kind}_card_${storyId}.mp4`);
    if (channelPath && fs.existsSync(channelPath)) {
      return { path: channelPath, source: "governed-package-local-channel", channelId };
    }
    if (fs.existsSync(storyPath)) {
      return { path: storyPath, source: "governed-package-local" };
    }
    return { path: null, source: null };
  };
  return Object.fromEntries(
    HYPERFRAMES_PREMIUM_SHELL_CARD_KINDS.map((kind) => [kind, descriptorFor(kind)]),
  );
}

function resolveCardAssetsForArtifact({
  artifactDir,
  workspaceRoot,
  storyId,
  channelId,
} = {}) {
  const governedPackageAssets = governedPackageCardAssets(artifactDir, storyId, channelId);
  if (Object.values(governedPackageAssets).some((descriptor) => descriptor?.path)) {
    return governedPackageAssets;
  }
  const candidates = cardAssetRootsForArtifact(artifactDir, workspaceRoot)
    .map((root, proximity) => {
      const assets = resolveCardAssetsV2(root, storyId, channelId);
      const availableCount = Object.values(assets).filter((descriptor) => descriptor?.path).length;
      return { assets, availableCount, proximity };
    })
    .filter((candidate) => candidate.availableCount > 0)
    .sort((left, right) =>
      right.availableCount - left.availableCount || left.proximity - right.proximity,
    );
  return candidates[0]?.assets || resolveCardAssetsV2(workspaceRoot, storyId, channelId);
}

function normaliseReadableShellCardKind(value = "") {
  const kind = cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
  return kind === "source_lock" ? "source" : kind;
}

function evaluateSelectedGovernedOwnedReadableCard({
  clip = {},
  kind,
  storyId,
  channelId,
  targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
} = {}) {
  const cardPath = clipPathValue(clip);
  const actualKind = normaliseReadableShellCardKind(readableOwnedCardKind(clip));
  const expectedKind = normaliseReadableShellCardKind(kind);
  const readableText = cleanText(clip.readable_text || clip.readableText || clip.text);
  const timing = v5CardTimingContract(expectedKind, readableText);
  const durationS = clipDurationSeconds(clip, 0);
  const blockers = [];
  if (clip.hyperframes_card !== true) blockers.push("governed_owned_card_marker_missing");
  if (!isPublishableStrictlyVerifiedOwnedMotionClip(clip, { targetPlatforms })) {
    blockers.push("governed_owned_card_hash_rights_not_verified");
  }
  if (!expectedKind || actualKind !== expectedKind) {
    blockers.push("governed_owned_card_kind_mismatch");
  }
  if (!readableText) blockers.push("governed_owned_card_readable_text_missing");
  if (!/^sha256:[a-f0-9]{64}$/i.test(cleanText(clip.sampled_visual_fingerprint))) {
    blockers.push("governed_owned_card_visual_fingerprint_missing");
  }
  if (clip.reproducible !== true || clip.seek_safe !== true) {
    blockers.push("governed_owned_card_animation_contract_not_proven");
  }
  if (timing.content_fits_maximum !== true) {
    blockers.push("governed_owned_card_text_exceeds_readable_window");
  }
  if (durationS + SCENE_DURATION_FRAME_TOLERANCE_S < Number(timing.required_visible_duration_s || 0)) {
    blockers.push("governed_owned_card_duration_below_readable_floor");
  }
  const verdict = blockers.length ? "fail" : "pass";
  return {
    verdict,
    blockers: uniqueCleanTexts(blockers),
    warnings: [],
    evidence: {
      kind: expectedKind,
      storyId,
      channelId,
      cardPath,
      selectedManifestCard: {
        clip_id: cleanText(clip.id || clip.asset_id),
        materialised_output_sha256: cleanText(
          clip.materialised_output_sha256 || clip.asset_sha256,
        ).toLowerCase(),
        materialised_output_size_bytes: Number(
          clip.materialised_output_size_bytes || clip.asset_size_bytes || 0,
        ),
        rights_evidence_sha256: cleanText(
          clip.owned_rights_record?.evidence_sha256 ||
            clip.owned_rights_record?.rights_evidence_sha256,
        ).toLowerCase(),
        sampled_visual_fingerprint: cleanText(clip.sampled_visual_fingerprint),
      },
      checks: {
        selected_manifest_binding: { status: verdict },
        hash_rights_binding: { status: verdict },
        render: { status: verdict },
      },
      visualIdentity: {
        status: verdict,
        evidence: {
          generator_project_id: cleanText(clip.generator_project_id),
          generator_master_sha256: cleanText(clip.generator_master_sha256).toLowerCase(),
          sampled_visual_fingerprint: cleanText(clip.sampled_visual_fingerprint),
        },
      },
      animationContract: {
        status: verdict,
        evidence: {
          reproducible: clip.reproducible === true,
          seek_safe: clip.seek_safe === true,
        },
      },
      readabilityContract: {
        status: verdict,
        contract_version: PREMIUM_CARD_TIMING_V5_VERSION,
        evidence: {
          readable_text: readableText,
          word_count: readableText.split(/\s+/).filter(Boolean).length,
          planned_visible_duration_s: timing.planned_visible_duration_s,
          minimum_visible_duration_s: timing.minimum_visible_duration_s,
          max_readable_card_duration_s: timing.maximum_visible_duration_s,
        },
      },
    },
  };
}

function hyperframesPremiumShellEvidenceForStory({
  job = {},
  storyId,
  artifactDir,
  workspaceRoot = process.cwd(),
  channelId = "pulse-gaming",
  primaryClipCount = 0,
  audioDurationS = null,
  authoritativeSourceCardLabels = [],
  governedSelectedCardPaths = [],
  governedSelectedCardClips = [],
  governedDenseMotionSourceOnlyAllowed = false,
  targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
} = {}) {
  const resolvedAssets = resolveCardAssetsForArtifact({
    artifactDir,
    workspaceRoot,
    storyId,
    channelId,
  });
  const governedOwnedAssets = {};
  for (const clip of asArray(governedSelectedCardClips)) {
    const kind = normaliseReadableShellCardKind(readableOwnedCardKind(clip));
    if (
      !HYPERFRAMES_PREMIUM_SHELL_CARD_KINDS.includes(kind) ||
      !isPublishableStrictlyVerifiedOwnedMotionClip(clip, { targetPlatforms }) ||
      governedOwnedAssets[kind]
    ) {
      continue;
    }
    governedOwnedAssets[kind] = {
      path: clipPathValue(clip),
      source: "governed-selected-owned-motion-card",
      governedSelectedClip: clip,
    };
  }
  const assets = {
    ...resolvedAssets,
    ...governedOwnedAssets,
  };
  const hasStorySpecificAssets = Object.values(assets).some((descriptor) => descriptor?.path);
  if (!targetRequiresHyperframesPremiumShell(job) && !hasStorySpecificAssets) return null;
  const checks = {};
  const passingCards = [];
  for (const kind of HYPERFRAMES_PREMIUM_SHELL_CARD_KINDS) {
    const descriptor = assets[kind] || {};
    const evaluatedResult = descriptor.governedSelectedClip
      ? evaluateSelectedGovernedOwnedReadableCard({
          clip: descriptor.governedSelectedClip,
          kind,
          storyId,
          channelId,
          targetPlatforms,
        })
      : evaluateHyperframesPremiumShellEvidence({
          cardPath: descriptor.path,
          kind,
          storyId,
          channelId,
        });
    const readability = readableDurationEvidenceFromShell(
      evaluatedResult.evidence?.readabilityContract || {},
    );
    const sourceIdentity = sourceCardIdentityContract({
      kind,
      readableText: readability.readable_text,
      authoritativeLabels: authoritativeSourceCardLabels,
    });
    const result = sourceIdentity.blockers.length
      ? {
          ...evaluatedResult,
          verdict: "fail",
          blockers: uniqueCleanTexts([
            ...asArray(evaluatedResult.blockers),
            ...sourceIdentity.blockers,
          ]),
          evidence: {
            ...(evaluatedResult.evidence || {}),
            sourceCardIdentityContract: sourceIdentity,
          },
        }
      : evaluatedResult;
    checks[kind] = result;
    if (result.verdict === "pass" && descriptor.path) {
      passingCards.push({
        kind,
        path: descriptor.path,
        source: descriptor.source || "story-specific",
        readability,
      });
    }
  }
  const rejectedCardIssues = Object.entries(checks).flatMap(([kind, result]) =>
    asArray(result?.blockers).map((blocker) => `${kind}:${blocker}`),
  );
  const rejectedCardWarnings = Object.entries(checks).flatMap(([kind, result]) =>
    asArray(result?.warnings).map((warning) => `${kind}:${warning}`),
  );
  const passCount = passingCards.length;
  const governedPathKeys = new Set(
    uniqueCleanTexts(governedSelectedCardPaths)
      .map(normalisePathKey)
      .filter(Boolean),
  );
  const governedSelectionRequested = governedPathKeys.size > 0;
  const governedSelectedCards = governedSelectionRequested
    ? passingCards.filter((card) => governedPathKeys.has(normalisePathKey(card.path)))
    : [];
  const governedSourceOnlySelection =
    governedDenseMotionSourceOnlyAllowed === true &&
    governedSelectedCards.length === 1 &&
    isHyperframesSourceCard(governedSelectedCards[0]);
  const selectedCards = governedSelectionRequested
    ? governedSelectedCards
    : selectReadableHyperframesCardsForMotionBalance(
        passingCards,
        primaryClipCount,
        audioDurationS,
      );
  const selectedCount = selectedCards.length;
  const selectedCardDurationS = Number(
    selectedCards.reduce((total, card) => total + readableHyperframesCardDurationS(card), 0).toFixed(3),
  );
  const maxCardDurationS = maxReadableHyperframesCardDurationSForAudio(audioDurationS);
  const requiredSelectedCount = governedSourceOnlySelection
    ? 1
    : requiredSelectedHyperframesCardCount({
        passCount,
        primaryClipCount,
        audioDurationS,
      });
  const requiredPassCount = governedSourceOnlySelection
    ? 1
    : MIN_PREMIUM_HYPERFRAMES_CARDS;
  const governedSelectionBlockers =
    governedSelectionRequested && governedSelectedCards.length !== governedPathKeys.size
      ? [
          `governed_hyperframes_card_selection_not_passing:${governedSelectedCards.length}/${governedPathKeys.size}`,
        ]
      : [];
  const selectedCardBlockers =
    selectedCount >= requiredSelectedCount
      ? []
      : [`selected_hyperframes_card_count_below_required:${selectedCount}/${requiredSelectedCount}`];
  const availableCardBlockers =
    passCount >= requiredPassCount
      ? []
      : [`available_hyperframes_card_count_below_required:${passCount}/${requiredPassCount}`];
  const requiredSourceCardBlockers =
    checks.source?.verdict === "pass"
      ? []
      : uniqueCleanTexts(
          asArray(checks.source?.blockers).length
            ? asArray(checks.source.blockers).map((blocker) => `source:${blocker}`)
            : ["source:required_hyperframes_source_card_not_passing"],
        );
  const allBlockers = uniqueCleanTexts([
    ...requiredSourceCardBlockers,
    ...availableCardBlockers,
    ...governedSelectionBlockers,
    ...selectedCardBlockers,
  ]);
  const advisories = uniqueCleanTexts([
    ...rejectedCardIssues,
    ...rejectedCardWarnings,
  ]);
  const selectionMode = governedSourceOnlySelection
    ? "governed_dense_motion_source_only"
    : governedSelectionRequested
      ? "governed_materialised_card_selection"
      : "automatic_motion_balance";
  const gateVerdict =
    passCount >= requiredPassCount &&
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
    premium_shell_required_pass_count: requiredPassCount,
    premium_shell_required_selected_card_count: requiredSelectedCount,
    hyperframes_premium_shell_required_selected_card_count: requiredSelectedCount,
    premium_shell_selection_mode: selectionMode,
    premium_shell_blockers: allBlockers,
    premium_shell_advisories: advisories,
    premium_shell_rejected_card_issues: rejectedCardIssues,
    hyperframes_premium_shell_gate: {
      verdict: gateVerdict,
      requiredPassCount,
      requiredSelectedCardCount: requiredSelectedCount,
      passCount,
      selectedCardCount: selectedCount,
      selectedCardDurationS,
      maxReadableCardDurationS: maxCardDurationS,
      maxReadableCardDurationRatio: MAX_HYPERFRAMES_CARD_DURATION_RATIO,
      selectionMode,
      blockers: allBlockers,
      advisories,
      rejectedCardIssues,
      checks,
    },
    card_clips: selectedCards.map((card, index) => {
      const minimumReadable = numberOrNull(card.readability?.minimum_visible_duration_s);
      const maxReadable = numberOrNull(card.readability?.max_readable_card_duration_s);
      const isSourceCard = isHyperframesSourceCard(card);
      const durationS = readableHyperframesCardDurationS(card);
      const readableMinimumS = isSourceCard
        ? MIN_SOURCE_LOCK_CARD_DURATION_S
        : Math.min(
            durationS,
            Math.max(
              MIN_READABLE_HYPERFRAMES_CARD_DURATION_S,
              minimumReadable || 0,
            ),
          );
      const readableMaxS = isSourceCard
        ? MAX_SOURCE_LOCK_CARD_DURATION_S
        : maxReadableHyperframesCardDurationS(card);
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

function adaptiveClipCoverageDurationS(clips = [], targetDurationS = null) {
  const durations = asArray(clips)
    .map((clip) => clipDurationSeconds(clip, 0))
    .filter((duration) => duration > 0);
  if (!durations.length) return 0;
  const target = numberOrNull(targetDurationS);
  const transitionCount = Math.max(0, durations.length - 1);
  const rawDurationS = Number(durations.reduce((sum, duration) => sum + duration, 0).toFixed(3));
  if (!transitionCount || target == null || target <= 0) return rawDurationS;
  const fixedCoverageS = Number(
    (rawDurationS - PRODUCTION_RENDER_SCENE_XFADE_S * transitionCount).toFixed(3),
  );
  if (fixedCoverageS + 0.12 >= target || rawDurationS + 0.12 < target) return fixedCoverageS;
  const maxTransitionLossS = Math.max(0, rawDurationS - target + 0.08);
  const fittedXfadeS = Number((maxTransitionLossS / transitionCount).toFixed(3));
  if (
    !Number.isFinite(fittedXfadeS) ||
    fittedXfadeS < MIN_PRODUCTION_RENDER_SCENE_XFADE_S ||
    fittedXfadeS >= PRODUCTION_RENDER_SCENE_XFADE_S
  ) {
    return fixedCoverageS;
  }
  return Number((rawDurationS - fittedXfadeS * transitionCount).toFixed(3));
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
  if (adaptiveClipCoverageDurationS([...selected, ...shell], audioDuration) + 0.12 >= audioDuration) {
    return selected;
  }

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
      adaptiveClipCoverageDurationS([...selected, ...shell], audioDuration) + 0.12 >= audioDuration &&
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

function defaultEpidemicSfxRuntimeManifestPath(workspaceRoot = process.cwd()) {
  const relativeManifestPath = path.join(
    "output",
    "epidemic-implementation",
    "epidemic_sfx_runtime_manifest.json",
  );
  let cursor = path.resolve(workspaceRoot || process.cwd());
  while (true) {
    const candidate = path.join(cursor, relativeManifestPath);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path.resolve(workspaceRoot || process.cwd(), relativeManifestPath);
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

async function applyFinalDirectMotionQa({
  clips = [],
  artifactDir,
  directMotionFilter = null,
  requiredBaseSources = undefined,
  targetDurationS = null,
  generatedAt = null,
} = {}) {
  const selectedClips = asArray(clips);
  if (typeof directMotionFilter !== "function") {
    return { clips: selectedClips, report: null };
  }

  const directClips = selectedClips.filter(isRealMaterialisedClip);
  if (!directClips.length) return { clips: selectedClips, report: null };

  const qaDir = path.join(artifactDir, "qa", "direct-motion");
  const reportPath = path.join(qaDir, "final_selection_dense_selector_report.json");
  const report = await directMotionFilter(directClips, {
    outputDir: path.join(qaDir, "final-selection-frames"),
    policyTier: "normal_strict_green",
  });
  const blockers = uniqueCleanTexts(report?.blockers);
  const accepted = asArray(report?.accepted);
  const rejected = asArray(report?.rejected);
  if (accepted.length + rejected.length !== directClips.length) {
    blockers.push("direct_motion_visual_preflight_incomplete");
  }
  if (!accepted.length) blockers.push("premium_direct_motion_missing");

  const visuallyAcceptedPaths = new Set(
    asArray(report?.clips).map(clipPathValue).map(normalisePathKey).filter(Boolean),
  );
  const reportedAcceptedClips = asArray(report?.clips).filter(isRealMaterialisedClip);
  const visuallyAcceptedClips = reportedAcceptedClips.length
    ? reportedAcceptedClips
    : directClips.filter((clip) =>
        visuallyAcceptedPaths.has(normalisePathKey(clipPathValue(clip))),
      );
  const professionalSelection = selectBalancedProfessionalMotionCandidates(
    visuallyAcceptedClips,
    { requiredBaseSources, targetDurationS },
  );
  blockers.push(...uniqueCleanTexts(professionalSelection?.blockers));
  const professionallySelectedPaths = new Set(
    asArray(professionalSelection?.clips)
      .map(clipPathValue)
      .map(normalisePathKey)
      .filter(Boolean),
  );
  const filteredClips = [
    ...asArray(professionalSelection?.clips).filter((clip) =>
      professionallySelectedPaths.has(normalisePathKey(clipPathValue(clip))),
    ),
    ...selectedClips.filter((clip) => !isRealMaterialisedClip(clip)),
  ];
  if (
    filteredClips.filter(isRealMaterialisedClip).length !==
    Number(professionalSelection?.selected_direct_motion_clip_count || 0)
  ) {
    blockers.push("direct_motion_visual_preflight_selection_mismatch");
  }

  const persistedReport = {
    ...(report && typeof report === "object" ? report : {}),
    generated_at: cleanText(generatedAt) || null,
    policy_tier: "ultimate_professional",
    visual_policy_tier: cleanText(report?.policy_tier || "normal_strict_green"),
    clips: filteredClips.filter(isRealMaterialisedClip),
    professional_candidate_selection: professionalSelection,
    professional_source_diversity: professionalSelection?.professional_source_diversity || null,
    input_clip_count: directClips.length,
    visually_accepted_clip_count: visuallyAcceptedClips.length,
    selected_clip_count: filteredClips.filter(isRealMaterialisedClip).length,
    blockers: uniqueCleanTexts(blockers),
  };
  await fs.ensureDir(qaDir);
  await fs.writeJson(reportPath, persistedReport, { spaces: 2 });

  if (persistedReport.blockers.length) {
    throw new Error(
      `direct_motion_visual_preflight_blocked:${persistedReport.blockers.join(",")}`,
    );
  }
  return { clips: filteredClips, report: persistedReport };
}

function sfxAssetKey(asset = {}) {
  return cleanText(
    asset.asset_id ||
      asset.id ||
      asset.path ||
      asset.file_path ||
      asset.source_url,
  );
}

function selectedSfxAssetsForRender({ sfxManifest = {}, canonical = {} } = {}) {
  return firstNonEmptyArray(
    sfxManifest.source_plan?.selected_assets,
    sfxManifest.selected_assets,
    sfxManifest.assets,
    canonical.sfx_asset_inventory,
    canonical.sfx_assets,
  );
}

function mergeSfxRightsRecords(rightsLedger = {}, incomingRecords = [], generatedAt = "") {
  const recordsByKey = new Map();
  for (const record of recordsFromRightsLedger(rightsLedger)) {
    const key = sfxAssetKey(record);
    if (key) recordsByKey.set(key, record);
  }
  for (const record of asArray(incomingRecords)) {
    const key = sfxAssetKey(record);
    if (!key) continue;
    recordsByKey.set(key, {
      ...(recordsByKey.get(key) || {}),
      ...record,
    });
  }
  return {
    ...(Array.isArray(rightsLedger) ? {} : rightsLedger),
    records: [...recordsByKey.values()],
    sfx_runtime_hydrated_at: cleanText(generatedAt) || null,
    sfx_runtime_hydration_strategy:
      "materially_verified_epidemic_runtime_manifest",
  };
}

function mergeCinematicSoundscapeRightsRecords(
  rightsLedger = {},
  incomingRecords = [],
  generatedAt = "",
) {
  const recordsByKey = new Map();
  for (const record of recordsFromRightsLedger(rightsLedger)) {
    const key = sfxAssetKey(record);
    if (key) recordsByKey.set(key, record);
  }
  for (const record of asArray(incomingRecords)) {
    const key = sfxAssetKey(record);
    if (!key) continue;
    recordsByKey.set(key, {
      ...(recordsByKey.get(key) || {}),
      ...record,
    });
  }
  return {
    ...(Array.isArray(rightsLedger) ? {} : rightsLedger),
    records: [...recordsByKey.values()],
    cinematic_soundscape_rights_hydrated_at:
      cleanText(generatedAt) || null,
    cinematic_soundscape_rights_hydration_strategy:
      "hash_verified_elevenlabs_paid_generation_sidecar",
  };
}

function resolveLocalSfxEvidencePath(value, workspaceRoot = process.cwd()) {
  const text = cleanText(value);
  if (!text) return null;
  if (/^file:\/\//i.test(text)) {
    try {
      return fileURLToPath(text);
    } catch {
      return path.resolve(workspaceRoot, text.replace(/^file:\/\//i, ""));
    }
  }
  if (path.isAbsolute(text)) return text;
  const mediaResolved = mediaPaths.resolveExistingSync(text);
  if (mediaResolved && fs.existsSync(mediaResolved)) return mediaResolved;
  let cursor = path.resolve(workspaceRoot || process.cwd());
  while (true) {
    const candidate = path.resolve(cursor, text);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return path.resolve(workspaceRoot, text);
}

async function usableEvidenceFile(filePath, minimumBytes = 1) {
  if (!filePath || !(await fs.pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  return stat.isFile() && stat.size >= minimumBytes ? stat : null;
}

async function hydrateCinematicSoundscapeRightsRuntime({
  artifactDir,
  workspaceRoot = process.cwd(),
  runtime = {},
  targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (runtime.status !== "ready") {
    return {
      status: runtime.status || "unavailable",
      assets: [],
      rightsRecords: [],
      blockers: asArray(runtime.blockers),
      manifestPath: runtime.manifest_path || null,
      manifestSha256: runtime.manifest_sha256 || null,
    };
  }

  const blockers = [];
  const verifiedAssets = [];
  const verifiedRights = [];
  const manifestPath = resolveLocalSfxEvidencePath(
    runtime.manifest_path,
    workspaceRoot,
  );
  const manifestStat = await usableEvidenceFile(manifestPath, 1);
  const manifestSha256 = manifestStat
    ? await sha256File(manifestPath)
    : null;
  if (
    !manifestStat ||
    manifestSha256 !== cleanText(runtime.manifest_sha256).toLowerCase()
  ) {
    blockers.push("cinematic_soundscape_runtime_manifest_hash_mismatch");
  }

  for (const asset of asArray(runtime.assets)) {
    const assetId = sfxAssetKey(asset);
    const audioPath = resolveLocalSfxEvidencePath(
      asset.path || asset.audio_path,
      workspaceRoot,
    );
    const sidecarPath = resolveLocalSfxEvidencePath(
      asset.elevenlabs_governance?.sidecar_path || asset.sidecar_path,
      workspaceRoot,
    );
    const [audioStat, sidecarStat] = await Promise.all([
      usableEvidenceFile(audioPath, 1024),
      usableEvidenceFile(sidecarPath, 1),
    ]);
    if (!assetId || !audioStat || !sidecarStat) {
      blockers.push(
        `cinematic_soundscape_rights_evidence_missing:${assetId || "unknown"}`,
      );
      continue;
    }
    const sidecar = await readJsonIfPresent(sidecarPath, null);
    const [audioSha256, sidecarSha256] = await Promise.all([
      sha256File(audioPath),
      sha256File(sidecarPath),
    ]);
    const expectedSha256 = cleanText(
      asset.elevenlabs_governance?.sha256 ||
        asset.sha256 ||
        asset.asset_sha256,
    ).toLowerCase();
    const sidecarSha256Claim = cleanText(
      sidecar?.sha256 || sidecar?.asset_sha256,
    ).toLowerCase();
    const providerId = cleanText(
      asset.provider_id || sidecar?.provider_id,
    ).toLowerCase();
    const allowedUse = cleanText(
      sidecar?.allowed_use || asset.allowed_use,
    );
    const termsEvidenceUrl = cleanText(
      sidecar?.terms_evidence_url || asset.terms_evidence_url,
    );
    const rightsNote = cleanText(
      sidecar?.rights_note || asset.rights_note,
    );
    const role = cleanText(asset.role || sidecar?.role);
    const evidenceValid = Boolean(
      sidecar &&
        cleanText(sidecar.asset_id) === assetId &&
        providerId === "elevenlabs_sfx" &&
        role &&
        expectedSha256 === audioSha256 &&
        sidecarSha256Claim === audioSha256 &&
        asset.commercial_use_allowed === true &&
        sidecar.commercial_use_allowed === true &&
        sidecar.raw_redistribution_allowed === false &&
        allowedUse === "finished_editorial_video_only" &&
        termsEvidenceUrl &&
        rightsNote,
    );
    if (!evidenceValid) {
      blockers.push(
        `cinematic_soundscape_rights_evidence_invalid:${assetId}`,
      );
      continue;
    }
    const sourceUrl = cleanText(asset.source_url) ||
      pathToFileURL(audioPath).href;
    const allowedPlatforms = uniqueCleanTexts(targetPlatforms);
    const verifiedAsset = {
      ...asset,
      path: audioPath,
      audio_path: audioPath,
      source_url: sourceUrl,
      asset_sha256: audioSha256,
      sha256: audioSha256,
      asset_size_bytes: audioStat.size,
      size_bytes: audioStat.size,
      evidence_file: sidecarPath,
      evidence_sha256: sidecarSha256,
      evidence_size_bytes: sidecarStat.size,
      terms_evidence_url: termsEvidenceUrl,
    };
    verifiedAssets.push(verifiedAsset);
    verifiedRights.push({
      asset_id: assetId,
      id: assetId,
      asset_type: "soundscape",
      kind: "soundscape",
      role,
      family: cleanText(asset.family || sidecar.family || role),
      provider_id: "elevenlabs_sfx",
      provider_name: "ElevenLabs",
      path: audioPath,
      local_path: audioPath,
      source_url: sourceUrl,
      source_type: "elevenlabs_generated_sfx_sidecar",
      source_owner: "Pulse Gaming",
      creator: "Pulse Gaming via ElevenLabs",
      licence_basis:
        "elevenlabs_paid_subscription_generated_sfx_finished_editorial_commercial_use",
      rights_basis:
        "elevenlabs_paid_subscription_generated_sfx_finished_editorial_commercial_use",
      allowed_use: allowedUse,
      allowed_platforms: allowedPlatforms,
      commercial_use_allowed: true,
      credit_required: false,
      approval_status: "approved_generation_bound_commercial_use",
      rights_status: "approved_generation_bound_commercial_use",
      verdict: "GREEN",
      rights_verdict: "GREEN",
      rights_grant: true,
      live_publish_allowed: true,
      requires_human_legal_review_before_publish: false,
      requires_human_review_before_live_publish: false,
      requires_human_publish_review: false,
      raw_redistribution_allowed: false,
      secondary_layer_only: true,
      risk_score: 0.05,
      asset_sha256: audioSha256,
      sha256: audioSha256,
      asset_size_bytes: audioStat.size,
      size_bytes: audioStat.size,
      evidence_file: sidecarPath,
      evidence_path: sidecarPath,
      evidence_sha256: sidecarSha256,
      evidence_size_bytes: sidecarStat.size,
      terms_evidence_url: termsEvidenceUrl,
      rights_note: rightsNote,
      prompt: cleanText(
        sidecar.prompt || asset.elevenlabs_governance?.prompt,
      ),
      model: cleanText(
        sidecar.model || asset.elevenlabs_governance?.model,
      ),
      generation_time: cleanText(
        sidecar.generation_time ||
          asset.elevenlabs_governance?.generation_time,
      ),
      runtime_manifest_path: manifestPath,
      runtime_manifest_sha256: manifestSha256,
      reconciliation_basis:
        "materially_verified_elevenlabs_paid_generation_sidecar",
      reconciled_at: generatedAt,
    });
  }

  if (verifiedAssets.length !== asArray(runtime.assets).length) {
    blockers.push("cinematic_soundscape_rights_coverage_incomplete");
  }
  const uniqueBlockers = uniqueCleanTexts(blockers);
  if (uniqueBlockers.length) {
    return {
      status: "blocked",
      assets: [],
      rightsRecords: [],
      blockers: uniqueBlockers,
      manifestPath,
      manifestSha256,
    };
  }

  const rightsLedgerPath = path.join(artifactDir, "rights_ledger.json");
  const currentRightsLedger = await readJsonIfPresent(
    rightsLedgerPath,
    {},
  );
  const mergedRightsLedger = mergeCinematicSoundscapeRightsRecords(
    currentRightsLedger,
    verifiedRights,
    generatedAt,
  );
  await fs.writeJson(rightsLedgerPath, mergedRightsLedger, { spaces: 2 });
  return {
    status: "ready",
    assets: verifiedAssets,
    rightsRecords: verifiedRights,
    blockers: [],
    manifestPath,
    manifestSha256,
  };
}

async function hydrateCanonicalEpidemicSfxRuntime({
  artifactDir,
  workspaceRoot = process.cwd(),
  job = {},
  canonical = {},
  sfxManifest = {},
  rightsLedger = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const localAssets = selectedSfxAssetsForRender({ sfxManifest, canonical });
  if (localAssets.length) {
    return {
      assets: localAssets,
      rightsRecords: [
        ...asArray(sfxManifest.rights_records),
        ...recordsFromRightsLedger(rightsLedger),
      ],
      sourcePlan: sfxManifest.source_plan || null,
      manifest: sfxManifest,
      runtimeManifestSource: null,
    };
  }

  const explicitRuntimeManifestPath =
    job.epidemic_sfx_runtime_manifest_path ||
    job.evidence?.epidemic_sfx_runtime_manifest_path;
  const runtimeManifestPath = explicitRuntimeManifestPath
    ? resolveWorkspacePath(explicitRuntimeManifestPath, workspaceRoot)
    : defaultEpidemicSfxRuntimeManifestPath(workspaceRoot);
  const runtimeManifest = await readJsonIfPresent(runtimeManifestPath, null);
  const runtimeReadiness = cleanText(runtimeManifest?.readiness?.status).toLowerCase();
  if (
    !runtimeManifest ||
    !["ready", "pass"].includes(runtimeReadiness) ||
    asArray(runtimeManifest.readiness?.blockers).length
  ) {
    return {
      assets: [],
      rightsRecords: recordsFromRightsLedger(rightsLedger),
      sourcePlan: null,
      manifest: sfxManifest,
      runtimeManifestSource: null,
    };
  }

  const hydratedStory = {};
  applyEpidemicSfxRuntimeManifestToStory(hydratedStory, runtimeManifest);
  const runtimeRightsById = new Map(
    asArray(hydratedStory.sfx_rights_ledger).map((record) => [
      sfxAssetKey(record),
      record,
    ]),
  );
  const verifiedAssets = [];
  const verifiedRights = [];
  for (const asset of asArray(hydratedStory.sfx_asset_inventory)) {
    const key = sfxAssetKey(asset);
    const rights = runtimeRightsById.get(key) || {};
    const licenceBasis = cleanText(
      asset.licence_basis ||
        asset.license_basis ||
        asset.rights_basis ||
        rights.licence_basis ||
        rights.license_basis ||
        rights.rights_basis,
    );
    const localPath = resolveLocalSfxEvidencePath(
      asset.path ||
        asset.file_path ||
        rights.path ||
        rights.file_path ||
        asset.source_url ||
        rights.source_url,
      workspaceRoot,
    );
    const evidencePath = resolveLocalSfxEvidencePath(
      asset.evidence_reference ||
        asset.safelist_evidence ||
        rights.evidence_reference ||
        rights.safelist_evidence,
      workspaceRoot,
    );
    const [assetStat, evidenceStat] = await Promise.all([
      usableEvidenceFile(localPath, 1024),
      usableEvidenceFile(evidencePath, 1),
    ]);
    const approvalStatus = cleanText(
      asset.approval_status || rights.approval_status,
    ).toLowerCase();
    if (
      !key ||
      !cleanText(asset.role || rights.role) ||
      cleanText(asset.provider_id || rights.provider_id).toLowerCase() !==
        "epidemic_sound" ||
      !licenceBasis ||
      asset.commercial_use_allowed !== true ||
      /blocked|rejected|failed|unapproved|unknown/.test(approvalStatus) ||
      !assetStat ||
      !evidenceStat
    ) {
      continue;
    }
    const [assetSha256, evidenceSha256] = await Promise.all([
      sha256File(localPath),
      sha256File(evidencePath),
    ]);
    const verifiedAsset = {
      ...asset,
      path: localPath,
      file_path: localPath,
      asset_sha256: assetSha256,
      sha256: assetSha256,
      asset_size_bytes: assetStat.size,
      size_bytes: assetStat.size,
      evidence_file: evidencePath,
      evidence_sha256: evidenceSha256,
      evidence_size_bytes: evidenceStat.size,
    };
    verifiedAssets.push(verifiedAsset);
    verifiedRights.push({
      ...rights,
      asset_id: key,
      asset_type: cleanText(rights.asset_type || "sfx"),
      role: cleanText(asset.role || rights.role),
      family: cleanText(asset.family || rights.family || asset.role),
      provider_id: "epidemic_sound",
      provider_name: cleanText(
        asset.provider_name || rights.provider_name || "Epidemic Sound",
      ),
      path: localPath,
      source_url: cleanText(asset.source_url || rights.source_url || localPath),
      licence_basis: licenceBasis,
      rights_basis: cleanText(
        asset.rights_basis || rights.rights_basis || licenceBasis,
      ),
      commercial_use_allowed: true,
      approval_status: cleanText(
        asset.approval_status ||
          rights.approval_status ||
          "approved_for_commercial_editorial_use",
      ),
      asset_sha256: assetSha256,
      sha256: assetSha256,
      asset_size_bytes: assetStat.size,
      size_bytes: assetStat.size,
      evidence_file: evidencePath,
      evidence_sha256: evidenceSha256,
      evidence_size_bytes: evidenceStat.size,
      reconciliation_basis:
        "materially_verified_epidemic_runtime_asset_and_safelist_evidence",
      reconciled_at: generatedAt,
    });
  }

  const requiredRoles = uniqueCleanTexts([
    ...asArray(runtimeManifest.required_roles),
    ...asArray(runtimeManifest.source_plan?.required_roles),
  ]);
  const coveredRoles = uniqueCleanTexts(
    verifiedAssets.map((asset) => asset.role || asset.sfx_role),
  );
  const coveredRoleSet = new Set(coveredRoles);
  const missingRoles = requiredRoles.filter((role) => !coveredRoleSet.has(role));
  if (!verifiedAssets.length || missingRoles.length) {
    return {
      assets: [],
      rightsRecords: recordsFromRightsLedger(rightsLedger),
      sourcePlan: {
        readiness: {
          status: "blocked",
          blockers: [
            ...(!verifiedAssets.length
              ? ["epidemic_sfx_runtime_no_materially_verified_assets"]
              : []),
            ...missingRoles.map((role) => `epidemic_sfx_runtime_missing_role:${role}`),
          ],
        },
      },
      manifest: sfxManifest,
      runtimeManifestSource: null,
    };
  }

  const runtimeManifestStat = await usableEvidenceFile(runtimeManifestPath, 1);
  const runtimeManifestSha256 = runtimeManifestStat
    ? await sha256File(runtimeManifestPath)
    : null;
  const sourcePlan = {
    ...(hydratedStory.sfx_source_plan || {}),
    generated_at: generatedAt,
    required_roles: requiredRoles,
    covered_roles: coveredRoles,
    selected_assets: verifiedAssets,
    readiness: {
      status: "pass",
      blockers: [],
      warnings: [],
    },
    runtime_manifest_path: runtimeManifestPath,
    runtime_manifest_sha256: runtimeManifestSha256,
    runtime_manifest_size_bytes: runtimeManifestStat?.size || 0,
  };
  const packageManifest = {
    schema_version: 1,
    generated_at: generatedAt,
    provider_id: "epidemic_sound",
    provider_name: "Epidemic Sound",
    readiness: { status: "pass", blockers: [], warnings: [] },
    source_plan: sourcePlan,
    selected_assets: verifiedAssets,
    rights_records: verifiedRights,
    runtime_manifest_path: runtimeManifestPath,
    runtime_manifest_sha256: runtimeManifestSha256,
    runtime_manifest_size_bytes: runtimeManifestStat?.size || 0,
  };
  const mergedRightsLedger = mergeSfxRightsRecords(
    rightsLedger,
    verifiedRights,
    generatedAt,
  );
  await Promise.all([
    fs.writeJson(path.join(artifactDir, "sfx_manifest.json"), packageManifest, {
      spaces: 2,
    }),
    fs.writeJson(path.join(artifactDir, "sfx_source_plan.json"), sourcePlan, {
      spaces: 2,
    }),
    fs.writeJson(path.join(artifactDir, "rights_ledger.json"), mergedRightsLedger, {
      spaces: 2,
    }),
  ]);
  return {
    assets: verifiedAssets,
    rightsRecords: verifiedRights,
    sourcePlan,
    manifest: packageManifest,
    runtimeManifestSource: "epidemic_sfx_runtime_manifest",
    runtimeManifestPath,
  };
}

async function buildRendererStoryJson(
  job = {},
  {
    generatedAt,
    workspaceRoot = process.cwd(),
    directMotionFilter = null,
    ownedMotionOnly = false,
    targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
    editorialAuthorityBundleId = "",
    operatingMode = "LOCAL_PROOF",
  } = {},
) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const [
    canonical,
    director,
    materialisedMotion,
    ownedMotionManifest,
    footageInventory,
    footageInventoryBackup,
    rightsLedger,
    sfxManifest,
    audioManifest,
    voiceQualityReport,
    renderManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "director_beat_map.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "owned_motion_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json.pre_real_motion_materialization.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "voice_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
  ]);
  const sfxEvidence = await hydrateCanonicalEpidemicSfxRuntime({
    artifactDir,
    workspaceRoot,
    job,
    canonical,
    sfxManifest,
    rightsLedger,
    generatedAt,
  });
  const cinematicSoundscapeRuntime =
    await loadGovernedCinematicSoundscapeRuntime({
      workspaceRoot,
      manifestPath: cleanText(
        job.cinematic_soundscape_runtime_manifest_path ||
          job.evidence?.cinematic_soundscape_runtime_manifest_path ||
          process.env.STUDIO_V4_CINEMATIC_SOUNDSCAPE_RUNTIME_MANIFEST,
        ),
    });
  const cinematicSoundscapeEvidence =
    await hydrateCinematicSoundscapeRightsRuntime({
      artifactDir,
      workspaceRoot,
      runtime: cinematicSoundscapeRuntime,
      targetPlatforms,
      generatedAt,
    });
  if (
    job.cinematic_soundscape_required === true &&
    cinematicSoundscapeEvidence.status !== "ready"
  ) {
    throw new Error(
      `cinematic_soundscape_runtime_blocked:${cinematicSoundscapeEvidence.blockers.join(
        ",",
      )}`,
    );
  }
  const storyId = cleanText(job.story_id || canonical.story_id);
  const wordTimestampSource = cleanText(
    job.evidence?.word_timestamp_source ||
      job.evidence?.wordTimestampSource ||
      canonical.word_timestamp_source ||
      canonical.wordTimestampSource,
  );
  const governedClipEvidence = [
    ...footageMotionClips(footageInventory),
    ...footageMotionClips(footageInventoryBackup),
  ];
  const authoritativeOwnedMotionManifest =
    materialisedMotionClips(ownedMotionManifest).length ||
    asArray(ownedMotionManifest.assets).length
      ? ownedMotionManifest
      : materialisedMotion;
  const ownedMotionOnlyPool = {
    ...authoritativeOwnedMotionManifest,
    clips: dedupeClipObjects([
      ...materialisedMotionClips(materialisedMotion),
      ...asArray(ownedMotionManifest.assets),
      ...materialisedMotionClips(ownedMotionManifest),
    ]),
  };
  const ownedMotionOnlySelection = ownedMotionOnly
    ? selectGovernedOwnedMotionOnlyClips(ownedMotionOnlyPool, { targetPlatforms })
    : null;
  if (ownedMotionOnlySelection?.blockers.length) {
    throw new Error(
      `owned_motion_only_preflight_blocked:${ownedMotionOnlySelection.blockers.join(",")}`,
    );
  }
  const inventoryClips = productionClipObjects({ materialisedMotion, footageInventory, rightsLedger, job })
    .map((clip) => hydrateClipWithGovernedEvidence(clip, governedClipEvidence));
  const renderedSceneClips = renderedScenePlanClipObjects({
    renderManifest,
    fallbackClips: inventoryClips,
  });
  const materialisedRealClipCount = materialisedMotionClips(materialisedMotion).filter(isRealMaterialisedClip).length;
  const inventoryRealClipCount = inventoryClips.filter(isRealMaterialisedClip).length;
  const renderedSceneRealClipCount = renderedSceneClips.filter(isRealMaterialisedClip).length;
  const preferredClips = ownedMotionOnly
    ? ownedMotionOnlySelection.clips
    : materialisedRealClipCount === 0 &&
      renderedSceneRealClipCount > inventoryRealClipCount
        ? renderedSceneClips
        : inventoryClips;
  const premiumShellPrimaryClips = premiumShellPrimaryClipsForRender(
    preferredClips,
    materialisedMotion,
  );
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
  if (
    ownedMotionOnly &&
    Number(audioDurationS) > 0 &&
    clipCoverageDurationS(preferredClips) + 0.12 < Number(audioDurationS)
  ) {
    throw new Error(
      `owned_motion_only_duration_coverage_insufficient:${clipCoverageDurationS(preferredClips).toFixed(3)}/${Number(audioDurationS).toFixed(3)}`,
    );
  }
  const governedSelectedCardClips = governedReadableShellCardClips({
    materialisedMotion,
    job,
    targetPlatforms,
  });
  const governedSelectedCardPaths = uniqueCleanTexts(
    governedSelectedCardClips.map(clipPathValue).filter(Boolean),
  );
  const governedDenseMotionSourceOnlyAllowed = governedDenseDirectMotionSupportsSourceOnly({
    clips: materialisedMotionClips(materialisedMotion),
    audioDurationS,
    wordTimestampSource,
  });
  const premiumShell = ownedMotionOnly ? null : hyperframesPremiumShellEvidenceForStory({
    job,
    storyId,
    artifactDir,
    workspaceRoot,
    channelId: cleanText(canonical.channel_id || canonical.channel || "pulse-gaming") || "pulse-gaming",
    primaryClipCount: premiumShellPrimaryClips.length || preferredClips.length,
    audioDurationS,
    authoritativeSourceCardLabels: uniqueCleanTexts([
      canonical.source_card_label,
      ...asArray(canonical.source_card_allowed_labels),
      ...asArray(canonical.allowed_source_card_labels),
    ]),
    governedSelectedCardPaths,
    governedSelectedCardClips,
    governedDenseMotionSourceOnlyAllowed,
    targetPlatforms,
  });
  const rawMaterialisedRealClips = ownedMotionOnly
    ? []
    : filterOverlappingStrictMotionWindows(dedupeClipsByStrictMotionWindow(
        filterLowPayloadSlateClipsWhenSafe(
          prioritiseOpeningMotionClips(
            filterSteamAppOutlierClips(
              dedupeClipObjects(
                materialisedMotionClips(materialisedMotion)
                  .map((clip) => hydrateClipWithGovernedEvidence(clip, governedClipEvidence)),
              ).filter(isRealMaterialisedClip),
            ),
          ),
        ),
      ));
  const coverageFallbackClips = ownedMotionOnly
    ? preferredClips
    : filterSteamAppOutlierClips(dedupeClipObjects([
        ...preferredClips,
        ...rawMaterialisedRealClips,
        ...rightsLedgerMotionClips(rightsLedger),
        ...footageMotionClips(footageInventory),
      ].map((clip) => hydrateClipWithGovernedEvidence(clip, governedClipEvidence))));
  const primaryClipsForRender = asArray(premiumShell?.card_clips).length
    ? (premiumShellPrimaryClips.length ? premiumShellPrimaryClips : preferredClips)
    : preferredClips;
  const initialSkipReadableShellCardsForAudioBudget = shouldSkipReadableShellCardsForAudioBudget({
    audioDurationS,
    primaryClips: primaryClipsForRender,
    fallbackClips: rawMaterialisedRealClips,
    wordTimestampSource,
  });
  const initialShellClipsForRender = initialSkipReadableShellCardsForAudioBudget
    ? []
    : stretchReadableShellClipsForAudioCoverage({
        primaryClips: primaryClipsForRender,
        shellClips: premiumShell?.card_clips || [],
        audioDurationS,
      });
  const coverageReadyPrimaryClips = initialSkipReadableShellCardsForAudioBudget
    ? filterSteamAppOutlierClips(
        rawMaterialisedRealClips.length >= primaryClipsForRender.length
          ? rawMaterialisedRealClips
          : primaryClipsForRender,
      )
    : filterSteamAppOutlierClips(
        topUpPrimaryClipsForAudioCoverage({
          primaryClips: primaryClipsForRender,
          fallbackClips: coverageFallbackClips,
          shellClips: initialShellClipsForRender,
          audioDurationS,
        }),
      );
  const finalDirectMotionQaCandidates = dedupeClipObjects(
    typeof directMotionFilter === "function"
      ? [
          ...coverageReadyPrimaryClips,
          ...rawMaterialisedRealClips,
        ]
      : coverageReadyPrimaryClips,
  );
  const sourceIdentityReadyPrimaryClips = await Promise.all(
    finalDirectMotionQaCandidates.map((clip) =>
      hydrateClipWithTrustedSourceIdentity(clip, { workspaceRoot }),
    ),
  );
  const finalDirectMotionQa = await applyFinalDirectMotionQa({
    clips: sourceIdentityReadyPrimaryClips,
    artifactDir,
    directMotionFilter,
    requiredBaseSources: requiredGenuineBaseSourceCount(job),
    targetDurationS: audioDurationS,
    generatedAt,
  });
  const skipReadableShellCardsForAudioBudget = shouldSkipReadableShellCardsForAudioBudget({
    audioDurationS,
    primaryClips: finalDirectMotionQa.clips,
    fallbackClips: finalDirectMotionQa.clips,
    wordTimestampSource,
  });
  const shellClipsForRender = skipReadableShellCardsForAudioBudget
    ? []
    : stretchReadableShellClipsForAudioCoverage({
        primaryClips: finalDirectMotionQa.clips,
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
  const preBudgetPremiumShellGate = premiumShell?.hyperframes_premium_shell_gate || {};
  const preBudgetPremiumShellBlockers = uniqueCleanTexts([
    ...asArray(premiumShell?.premium_shell_blockers),
    ...asArray(preBudgetPremiumShellGate.blockers),
  ]);
  const cardsOmittedForDirectMotion =
    Boolean(premiumShell) &&
    skipReadableShellCardsForAudioBudget &&
    asArray(premiumShell.card_clips).length > 0 &&
    cleanText(premiumShell.premium_shell_verdict).toLowerCase() === "pass";
  const effectiveRequiredSelectedCardCount = cardsOmittedForDirectMotion
    ? 0
    : Number(
        premiumShell?.premium_shell_required_selected_card_count ??
          preBudgetPremiumShellGate.requiredSelectedCardCount ??
          0,
      );
  const effectiveSelectionBlockers =
    shellClipsForRender.length >= effectiveRequiredSelectedCardCount
      ? []
      : [
          `selected_hyperframes_card_count_below_required:${shellClipsForRender.length}/${effectiveRequiredSelectedCardCount}`,
        ];
  const effectivePremiumShellBlockers = uniqueCleanTexts([
    ...preBudgetPremiumShellBlockers.filter(
      (blocker) => !/^selected_hyperframes_card_count_below_required:/i.test(blocker),
    ),
    ...effectiveSelectionBlockers,
  ]);
  const preBudgetPremiumShellVerdict = cleanText(
    premiumShell?.premium_shell_verdict || preBudgetPremiumShellGate.verdict,
  ).toLowerCase();
  const effectivePremiumShellVerdict = !premiumShell
    ? null
    : preBudgetPremiumShellVerdict === "pass" && effectivePremiumShellBlockers.length === 0
      ? "pass"
      : shellClipsForRender.length >= 2
        ? "partial"
        : "thin";
  const effectivePremiumShellSelectionMode = cardsOmittedForDirectMotion
    ? "direct_motion_substitution"
    : premiumShell?.premium_shell_selection_mode ||
      preBudgetPremiumShellGate.selectionMode ||
      "automatic_motion_balance";
  const premiumShellGate = premiumShell
    ? {
        ...preBudgetPremiumShellGate,
        verdict: effectivePremiumShellVerdict,
        selectedCardCount: shellClipsForRender.length,
        requiredSelectedCardCount: effectiveRequiredSelectedCardCount,
        selectedCardDurationS: selectedShellCardDurationS,
        readableCardDurationExtensionS: selectedShellCardDurationExtensionS,
        selectionMode: effectivePremiumShellSelectionMode,
        blockers: effectivePremiumShellBlockers,
        cardsOmittedForDirectMotion,
      }
    : null;
  const preferredDirectorClips = blendPremiumShellClips(
    finalDirectMotionQa.clips.map(directorClipFromProductionClip),
    shellClipsForRender,
  );
  const preferredClipPaths = preferredDirectorClips.map(clipPathValue).filter(Boolean);
  const sfxAssets = asArray(sfxEvidence.assets);
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
  const selectedDirectorPlan = await buildTrustedVisualV4DirectorPlan({
    story: {
      ...canonical,
      id: storyId,
      story_id: storyId,
      title: cleanText(canonical.selected_title || canonical.short_title || job.title),
      visual_v4_bridge_video_clips: preferredDirectorClips,
      video_clips: preferredDirectorClips,
      sfx_asset_inventory: sfxAssets,
      soundscape_asset_inventory:
        cinematicSoundscapeEvidence.status === "ready"
          ? cinematicSoundscapeEvidence.assets
          : [],
    },
    footagePlan: selectedFootagePlan,
    localTimeline: {
      duration_s: audioDurationS || clipCoverageDurationS(preferredDirectorClips),
    },
    sfxAssetInventory: sfxAssets,
    sfxRightsLedger: sfxEvidence.rightsRecords,
    editorialAuthorityBundleId,
    operatingMode,
    generatedAt,
  });
  const proofCard = productionProofCard({
    director: selectedDirectorPlan,
    canonical,
  });
  const canonicalSubject = cleanText(
    canonical.canonical_subject || canonical.canonical_game || job.title,
  );
  const story = {
    id: storyId,
    story_id: storyId,
    title: cleanText(canonical.selected_title || canonical.short_title || job.title),
    canonical_subject: canonicalSubject,
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
    visual_v4_bridge_video_clips: preferredDirectorClips.map((clip, index) =>
      rendererBridgeClipFromProductionClip(clip, index, canonicalSubject),
    ),
    sfx_asset_inventory: sfxAssets,
    sfx_assets: sfxAssets,
    sfx_rights_ledger: sfxEvidence.rightsRecords,
    sfx_rights: sfxEvidence.rightsRecords,
    sfx_source_plan: sfxEvidence.sourcePlan,
    sfx_manifest: sfxEvidence.manifest,
    sfx_runtime_manifest_source: sfxEvidence.runtimeManifestSource,
    sfx_runtime_manifest_path: sfxEvidence.runtimeManifestPath || null,
    soundscape_asset_inventory:
      cinematicSoundscapeEvidence.status === "ready"
        ? cinematicSoundscapeEvidence.assets
        : [],
    soundscape_assets:
      cinematicSoundscapeEvidence.status === "ready"
        ? cinematicSoundscapeEvidence.assets
        : [],
    soundscape_rights_ledger:
      cinematicSoundscapeEvidence.status === "ready"
        ? cinematicSoundscapeEvidence.rightsRecords
        : [],
    cinematic_soundscape_runtime_status:
      cinematicSoundscapeEvidence.status,
    cinematic_soundscape_runtime_blockers:
      cinematicSoundscapeEvidence.blockers,
    cinematic_soundscape_runtime_manifest_path:
      cinematicSoundscapeEvidence.manifestPath || null,
    cinematic_soundscape_runtime_manifest_sha256:
      cinematicSoundscapeEvidence.manifestSha256 || null,
    cinematic_soundscape_manifest: {
      readiness: {
        status: cinematicSoundscapeEvidence.status,
        blockers: cinematicSoundscapeEvidence.blockers,
      },
      selected_assets:
        cinematicSoundscapeEvidence.status === "ready"
          ? cinematicSoundscapeEvidence.assets
          : [],
      rights_records:
        cinematicSoundscapeEvidence.status === "ready"
          ? cinematicSoundscapeEvidence.rightsRecords
          : [],
    },
    sound_transition_plan: selectedDirectorPlan.sound_transition_plan || null,
    visual_v4_director_plan: selectedDirectorPlan,
    required_genuine_base_source_count: requiredGenuineBaseSourceCount(job),
    generated_at: generatedAt,
    ...(premiumShell
      ? {
          hyperframes_premium_shell_required: premiumShell.hyperframes_premium_shell_required,
          hyperframes_card_count: shellClipsForRender.length,
          hyperframes_available_card_count: premiumShell.hyperframes_available_card_count,
          hyperframes_premium_shell_gate: premiumShellGate,
          premium_shell_verdict: effectivePremiumShellVerdict,
          premium_shell_pass_count: premiumShell.premium_shell_pass_count,
          premium_shell_selected_card_count: shellClipsForRender.length,
          premium_shell_required_pass_count: premiumShell.premium_shell_required_pass_count,
          premium_shell_required_selected_card_count: effectiveRequiredSelectedCardCount,
          hyperframes_premium_shell_required_selected_card_count:
            effectiveRequiredSelectedCardCount,
          premium_shell_selection_mode: effectivePremiumShellSelectionMode,
          premium_shell_blockers: effectivePremiumShellBlockers,
          premium_shell_advisories: premiumShell.premium_shell_advisories || [],
          premium_shell_rejected_card_issues:
            premiumShell.premium_shell_rejected_card_issues || [],
          premiumLane: {
            rendererSplit: "ffmpeg-backbone-story-specific-hyperframes-cards",
            hyperframesCardCount: shellClipsForRender.length,
            hyperframesAvailableCardCount: premiumShell.hyperframes_available_card_count,
            premiumShellPassCount: premiumShell.premium_shell_pass_count,
            premiumShellSelectedCardCount: shellClipsForRender.length,
            premiumShellRequiredSelectedCardCount:
              effectiveRequiredSelectedCardCount,
            premiumShellSelectionMode: effectivePremiumShellSelectionMode,
            hyperframesPremiumShellGate: premiumShellGate,
            verdict: effectivePremiumShellVerdict,
          },
        }
      : {}),
    render_invocation_mode: "final_production_render",
    render_safe_text_margins: jobNeedsSafeTextMargins(job),
    suppress_opening_story_cards: jobNeedsStrongerFirstFrame(job),
    visual_repair_lane: cleanText(job.repair_lane),
    visual_repair_blocker_types: uniqueCleanTexts(job.blocker_types || job.blockers || job.risk_reasons),
    rights_safe_owned_motion_only: ownedMotionOnly === true,
    owned_motion_only_selection: ownedMotionOnlySelection,
    ...proofCard,
  };
  const storyJsonPath = path.join(artifactDir, "visual_v4_render_story.json");
  await fs.writeJson(storyJsonPath, story, { spaces: 2 });
  return {
    storyJsonPath,
    story,
    finalDirectMotionQaReport: finalDirectMotionQa.report,
  };
}

async function refreshPostRenderQualityArtifacts({
  job = {},
  renderReport = {},
  generatedAt = new Date().toISOString(),
  rightsReconciliation = null,
  editorialAuthorityBundleId = "",
  operatingMode = "LOCAL_PROOF",
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const [
    canonical,
    footageInventory,
    rightsLedger,
    materialisedMotion,
    ownedMotionManifest,
    sfxManifest,
    renderManifest,
    platformManifest,
    audioSegmentReport,
    voiceQualityReport,
    captionManifest,
  ] = await Promise.all([
    readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "rights_ledger.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "owned_motion_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "platform_publish_manifest.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "audio_segment_loudness_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "voice_quality_report.json"), {}),
    readJsonIfPresent(path.join(artifactDir, "caption_manifest.json"), {}),
  ]);
  const inventoryClips = productionClipObjects({ footageInventory, rightsLedger, job, materialisedMotion });
  const currentStoryId = cleanText(
    job.story_id ||
      canonical.story_id ||
      canonical.id ||
      renderManifest.story_id,
  );
  const ownedMotionFallbackClips =
    cleanText(ownedMotionManifest.story_id) === currentStoryId
      ? dedupeClipObjects([
          ...asArray(ownedMotionManifest.assets),
          ...asArray(ownedMotionManifest.clips),
        ])
      : [];
  const renderedSceneFallbackClips = dedupeClipObjects([
    ...ownedMotionFallbackClips,
    ...inventoryClips,
  ]);
  const flagshipGenerationManifestPath = path.join(artifactDir, "flagship", "generation_manifest.json");
  const flagshipGenerationManifest = await readJsonIfPresent(flagshipGenerationManifestPath, {});
  const flagshipGenerationManifestSha256 = await fs.pathExists(flagshipGenerationManifestPath)
    ? await sha256File(flagshipGenerationManifestPath)
    : "";
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
    fallbackClips: renderedSceneFallbackClips,
    selectedInputAssets: asArray(
      (
        renderReport.selected_input_assets ||
        renderManifest.selected_input_assets ||
        flagshipGenerationManifest.renderer_selected_inputs ||
        {}
      ).assets,
    ),
  });
  const clips = renderedSceneClips.length >= 3 ? renderedSceneClips : inventoryClips;
  if (clips.length < 3) return null;
  const reconciliationGeneratedAt = cleanText(rightsReconciliation?.generated_at);
  const sameRunRightsReconciliationPassed = Boolean(
    cleanText(rightsReconciliation?.verdict).toUpperCase() === "PASS" &&
    rightsReconciliation?.applied === true &&
    asArray(rightsReconciliation?.blockers).length === 0 &&
    reconciliationGeneratedAt &&
    reconciliationGeneratedAt === cleanText(generatedAt)
  );
  const finalRightsLedger = augmentRightsLedgerForSelectedClips(
    normalisedRightsLedger,
    clips,
    {
      allowMissingClipFingerprint: sameRunRightsReconciliationPassed,
      expectedReconciledAt: sameRunRightsReconciliationPassed
        ? reconciliationGeneratedAt
        : "",
    },
  );
  if (JSON.stringify(finalRightsLedger) !== JSON.stringify(normalisedRightsLedger)) {
    await fs.writeJson(path.join(artifactDir, "rights_ledger.json"), {
      ...(Array.isArray(finalRightsLedger) ? { records: finalRightsLedger } : finalRightsLedger),
      rights_ledger_normalised_at: generatedAt,
      rights_ledger_normalisation_strategy: "selected_final_scene_rights_completion",
    }, { spaces: 2 });
  }
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
    rights_ledger: recordsFromRightsLedger(finalRightsLedger),
    footage_plan: footagePlan,
    sfx_asset_inventory: sfxAssets,
    clean_manual_captions: true,
    manual_caption_generated: true,
    subtitle_timing_source: "timestamps",
  };
  const scriptScorecard = currentCanonicalScriptScorecard({
    canonical,
    story,
    storyId,
    generatedAt,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), scriptScorecard, { spaces: 2 });
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
  const directorPlan = await buildTrustedVisualV4DirectorPlan({
    story,
    footagePlan,
    localTimeline: {
      duration_s: renderReport.rendered_duration_s,
      durationS: renderReport.rendered_duration_s,
    },
    sfxAssetInventory: sfxAssets,
    sfxRightsLedger: recordsFromRightsLedger(normalisedRightsLedger),
    editorialAuthorityBundleId,
    operatingMode,
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
    creative_system_version:
      cleanText(renderReport.creative_system_version || renderManifest.creative_system_version) || null,
    decoded_visual_gate:
      renderReport.decoded_visual_gate || renderManifest.decoded_visual_gate || null,
  };
  const forensicQa = buildPostRenderForensicQaReport({
    storyId,
    generatedAt,
    renderManifest,
    renderReport,
    outputPath: renderManifest.output_path || path.join(artifactDir, renderManifest.output || "visual_v4_render.mp4"),
    scriptScorecard,
    coherenceReport: refreshedCoherenceReport,
    rightsLedger: finalRightsLedger,
    directorPlan,
    benchmark,
    visualQuality,
    clips,
    audioSegmentReport,
    voiceQualityReport,
    captionManifest,
    flagshipGenerationManifest,
    flagshipGenerationManifestSha256,
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
  editorialAuthorityBundleId = "",
  operatingMode = "LOCAL_PROOF",
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
    editorialAuthorityBundleId,
    operatingMode,
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

function artifactRelativePath(artifactDir, filePath) {
  const resolvedRoot = path.resolve(artifactDir || "");
  const resolvedFile = path.resolve(filePath || "");
  const relative = path.relative(resolvedRoot, resolvedFile);
  if (!relative || relative === ".") return null;
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, "/");
}

function flagshipTranscriptWords(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/([a-z])(\d)/gi, "$1 $2")
    .replace(/(\d)([a-z])/gi, "$1 $2")
    .match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
}

function flagshipSpokenTranscriptWords(value) {
  const currencyNames = {
    "$": "dollars",
    "£": "pounds",
    "€": "euros",
  };
  const spoken = String(value || "").replace(
    /([$£€])(\d[\d,]*)(?:\.(\d{1,2}))?/g,
    (_match, symbol, whole, fractional) => [
      String(whole).replace(/,/g, ""),
      currencyNames[symbol],
      fractional || "",
    ].filter(Boolean).join(" "),
  );
  return flagshipTranscriptWords(spoken);
}

function flagshipTimestampSpokenWords(row = {}) {
  const spokenWords = asArray(row?.spoken_words ?? row?.spokenWords)
    .flatMap((value) => flagshipTranscriptWords(value));
  if (spokenWords.length) return spokenWords;
  return flagshipTranscriptWords(row?.word ?? row?.text ?? row);
}

function flagshipTokenSequencesMatch(expectedWords = [], observedWords = []) {
  let expectedIndex = 0;
  let observedIndex = 0;

  while (expectedIndex < expectedWords.length && observedIndex < observedWords.length) {
    if (expectedWords[expectedIndex] === observedWords[observedIndex]) {
      expectedIndex += 1;
      observedIndex += 1;
      continue;
    }
    if (
      expectedIndex + 1 < expectedWords.length &&
      `${expectedWords[expectedIndex]}${expectedWords[expectedIndex + 1]}` === observedWords[observedIndex]
    ) {
      expectedIndex += 2;
      observedIndex += 1;
      continue;
    }
    if (
      observedIndex + 1 < observedWords.length &&
      expectedWords[expectedIndex] === `${observedWords[observedIndex]}${observedWords[observedIndex + 1]}`
    ) {
      expectedIndex += 1;
      observedIndex += 2;
      continue;
    }
    return false;
  }

  return expectedIndex === expectedWords.length && observedIndex === observedWords.length;
}

function flagshipCaptionManifestIsAuthoritative(manifest = {}, explicitPath = "") {
  if (cleanText(explicitPath)) return true;
  const status = cleanText(manifest.verdict || manifest.status).toLowerCase();
  return ["pass", "passed", "green", "approved", "complete"].includes(status);
}

function flagshipCaptionMatchesCurrentNarration(
  captionText,
  scriptText,
  finalTimestampEnd,
) {
  const visibleCaptionText = String(captionText || "")
    .split(/\r?\n/)
    .filter((line) => {
      const value = line.trim();
      return value &&
        !/^WEBVTT(?:\s|$)/i.test(value) &&
        !/^\d+$/.test(value) &&
        !/-->/.test(value) &&
        !/^(NOTE|STYLE|REGION)(?:\s|$)/i.test(value);
    })
    .join(" ")
    .replace(/<[^>]+>/g, " ");
  const transcriptMatches =
    flagshipTranscriptWords(scriptText).join(" ") ===
    flagshipTranscriptWords(visibleCaptionText).join(" ");
  const captionEnd = flagshipSrtEndSeconds(captionText);
  const timelineMatches =
    Number(finalTimestampEnd) <= 0 ||
    captionEnd + 0.35 >= Number(finalTimestampEnd);
  return transcriptMatches && timelineMatches;
}

function flagshipSrtEndSeconds(value) {
  const matches = [...String(value || "").matchAll(/-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/g)];
  if (!matches.length) return 0;
  return Math.max(...matches.map((match) =>
    (Number(match[1]) * 3600) +
    (Number(match[2]) * 60) +
    Number(match[3]) +
    (Number(match[4]) / 1000)));
}

async function flagshipGenerationArtifact({
  artifactDir,
  filePath,
  runId,
  scriptSha256,
  spokenScriptSha256,
} = {}) {
  const relativePath = artifactRelativePath(artifactDir, filePath);
  if (!relativePath || !(await fs.pathExists(filePath))) return null;
  const stat = await fs.stat(filePath);
  if (!stat.isFile() || stat.size <= 0) return null;
  return {
    path: relativePath,
    sha256: await sha256File(filePath),
    bytes: stat.size,
    run_id: runId,
    script_sha256: scriptSha256,
    spoken_script_sha256: spokenScriptSha256,
  };
}

function representativeGenuineBaseSources({
  rendererStory = {},
  professionalSourceDiversity = {},
} = {}) {
  const directMotion = asArray(rendererStory.visual_v4_bridge_video_clips)
    .filter(isRealMaterialisedClip);
  const byBaseSource = new Map();
  for (const clip of directMotion) {
    const key = cleanText(clip.base_source_asset_id).toLowerCase();
    if (key && !byBaseSource.has(key)) byBaseSource.set(key, clip);
  }
  const identityRows = asArray(professionalSourceDiversity.identity_evidence);
  if (!identityRows.length) return directMotion;
  return identityRows
    .map((identity) =>
      byBaseSource.get(cleanText(identity.base_source_asset_id).toLowerCase()),
    )
    .filter(Boolean);
}

async function writeFlagshipGenerationEvidence({
  job = {},
  inputState = {},
  renderReport = {},
  rendererStory = {},
  directMotionQaReport = null,
  generatedAt,
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || inputState.artifactDir || "");
  const storyId = cleanText(job.story_id || inputState.canonical?.story_id);
  const runId = `production-render:${storyId}:${generatedAt}`;
  const evidenceDir = path.join(artifactDir, "flagship");
  await fs.ensureDir(evidenceDir);
  const finalVideoPath = finalRenderOutputPath(job);
  const narrationManifest = await readJsonIfPresent(
    path.join(artifactDir, "narration_manifest.json"),
    {},
  );
  const captionManifest = await readJsonIfPresent(
    path.join(artifactDir, "caption_manifest.json"),
    {},
  );
  const sourceDiversityReportPath = path.join(
    artifactDir,
    "qa",
    "direct-motion",
    "final_selection_dense_selector_report.json",
  );
  const scriptText = cleanText(
    inputState.canonical?.narration_script ||
      inputState.canonical?.full_script ||
      inputState.canonical?.display_script ||
      inputState.canonical?.caption_display_text ||
      narrationManifest.display_text ||
      narrationManifest.final_transcript ||
      narrationManifest.transcript ||
      inputState.canonical?.tts_script,
  );
  const explicitCaptionPath = cleanText(
    job.evidence?.captions_path || job.evidence?.caption_srt_path,
  );
  const captionSourcePath = resolveWorkspacePath(
    explicitCaptionPath ||
      captionManifest.caption_srt_path ||
      captionManifest.captions_path ||
      path.join(artifactDir, "captions.srt"),
    artifactDir,
  );
  const authoritativeCaption = flagshipCaptionManifestIsAuthoritative(
    captionManifest,
    explicitCaptionPath,
  );
  const blockers = [];
  const audioExtension = path.extname(cleanText(inputState.audioPath)) || ".audio";
  const audioPath = path.join(evidenceDir, `final_audio${audioExtension}`);
  if (!storyId) blockers.push("story_id_missing");
  if (!scriptText) blockers.push("final_script_missing");
  if (!artifactRelativePath(artifactDir, finalVideoPath) || !(await fs.pathExists(finalVideoPath))) {
    blockers.push("final_video_missing_or_outside_story_package");
  }
  if (!(await fs.pathExists(inputState.audioPath || ""))) {
    blockers.push("final_audio_missing_or_outside_story_package");
  } else {
    try {
      if (path.resolve(inputState.audioPath) !== path.resolve(audioPath)) {
        await fs.copy(inputState.audioPath, audioPath, { overwrite: true });
      }
    } catch {
      blockers.push("final_audio_missing_or_outside_story_package");
    }
  }
  if (!(await fs.pathExists(inputState.timestampsPath || ""))) {
    blockers.push("word_timestamps_missing_or_outside_story_package");
  }
  if (!artifactRelativePath(artifactDir, audioPath) || !(await fs.pathExists(audioPath))) {
    blockers.push("final_audio_missing_or_outside_story_package");
  }
  if (
    authoritativeCaption &&
    cleanText(explicitCaptionPath) &&
    (!artifactRelativePath(artifactDir, captionSourcePath) || !(await fs.pathExists(captionSourcePath || "")))
  ) {
    blockers.push("captions_missing_or_outside_story_package");
  }

  let sourceTimestamps = null;
  let timestampWords = [];
  let spokenScriptText = "";
  let lastTimestampEnd = 0;
  if (!blockers.includes("word_timestamps_missing_or_outside_story_package")) {
    sourceTimestamps = await readJsonIfPresent(inputState.timestampsPath, null);
    if (!sourceTimestamps || !asArray(sourceTimestamps.words).length) {
      blockers.push("word_timestamps_invalid_or_empty");
    } else {
      timestampWords = asArray(sourceTimestamps.words);
      const explicitSpokenScriptText = cleanText(
        sourceTimestamps.meta?.spoken_text ||
          sourceTimestamps.meta?.transcript ||
          sourceTimestamps.meta?.text ||
          sourceTimestamps.spoken_text ||
          sourceTimestamps.transcript ||
          narrationManifest.spoken_transcript ||
          narrationManifest.spoken_text ||
          inputState.canonical?.spoken_narration_script ||
          inputState.canonical?.tts_script,
      );
      spokenScriptText = explicitSpokenScriptText || timestampWords
        .map((row) => cleanText(row?.word ?? row?.text ?? row))
        .filter(Boolean)
        .join(" ");
      const timestampDisplayText = cleanText(
        sourceTimestamps.meta?.display_text || sourceTimestamps.meta?.displayText,
      );
      if (timestampDisplayText && timestampDisplayText !== scriptText) {
        blockers.push("word_timestamps_display_script_mismatch");
      }
      const scriptWords = explicitSpokenScriptText
        ? flagshipTranscriptWords(explicitSpokenScriptText)
        : flagshipSpokenTranscriptWords(scriptText);
      const alignedTimestampWords = timestampWords
        .flatMap((row) => flagshipTimestampSpokenWords(row));
      if (!scriptWords.length || !flagshipTokenSequencesMatch(scriptWords, alignedTimestampWords)) {
        blockers.push("word_timestamps_do_not_match_final_script");
      }
      lastTimestampEnd = Math.max(
        ...timestampWords.map((row) => Number(row?.end ?? row?.end_s ?? 0)).filter(Number.isFinite),
        0,
      );
    }
  }
  if (!spokenScriptText) spokenScriptText = scriptText;

  let genuineBaseSourceDiversity = null;
  let genuineBaseSourceDiversityEvidence = null;
  if (directMotionQaReport && typeof directMotionQaReport === "object") {
    const professionalSourceDiversity = objectValue(
      directMotionQaReport.professional_source_diversity ||
        directMotionQaReport.professional_candidate_selection
          ?.professional_source_diversity,
    );
    const requiredCount = Math.max(
      DEFAULT_MINIMUM_GENUINE_BASE_SOURCES,
      requiredGenuineBaseSourceCount(job) || 0,
      numberOrNull(
        professionalSourceDiversity.required_genuine_base_source_count,
      ) || 0,
    );
    genuineBaseSourceDiversity = evaluateGenuineBaseSourceDiversity(
      representativeGenuineBaseSources({
        rendererStory,
        professionalSourceDiversity,
      }),
      { minimum: requiredCount },
    );
    const professionalStatus = cleanText(
      professionalSourceDiversity.status,
    ).toLowerCase();
    if (
      professionalStatus !== "pass" ||
      professionalSourceDiversity.strict_pass !== true
    ) {
      blockers.push("professional_source_diversity_not_green");
    }
    if (genuineBaseSourceDiversity.verdict !== "GREEN") {
      blockers.push("genuine_base_source_diversity_not_green");
    }
    if (
      cleanText(directMotionQaReport.generated_at) !== cleanText(generatedAt)
    ) {
      blockers.push("genuine_base_source_diversity_not_same_run");
    }
    if (await fs.pathExists(sourceDiversityReportPath)) {
      const sourceDiversityStat = await fs.stat(sourceDiversityReportPath);
      genuineBaseSourceDiversityEvidence = {
        path: artifactRelativePath(artifactDir, sourceDiversityReportPath),
        sha256: await sha256File(sourceDiversityReportPath),
        bytes: sourceDiversityStat.size,
        run_id: runId,
        generated_at: cleanText(directMotionQaReport.generated_at) || null,
      };
    } else {
      blockers.push("genuine_base_source_diversity_evidence_missing");
    }
  }

  const scriptPath = path.join(evidenceDir, "final_script.txt");
  const spokenScriptPath = path.join(evidenceDir, "final_spoken_script.txt");
  const defaultTimestampPath = path.join(evidenceDir, "word_timestamps.json");
  const timestampPath = inputState.timestampsPath &&
    path.resolve(inputState.timestampsPath) === path.resolve(defaultTimestampPath)
    ? path.join(evidenceDir, "generation_word_timestamps.json")
    : defaultTimestampPath;
  const captionPath = path.join(evidenceDir, "captions.srt");
  if (scriptText) await fs.writeFile(scriptPath, `${scriptText}\n`, "utf8");
  if (spokenScriptText) await fs.writeFile(spokenScriptPath, `${spokenScriptText}\n`, "utf8");
  let preserveAuthoritativeCaption =
    authoritativeCaption &&
    !blockers.includes("captions_missing_or_outside_story_package");
  if (
    preserveAuthoritativeCaption &&
    !cleanText(explicitCaptionPath)
  ) {
    preserveAuthoritativeCaption =
      await fs.pathExists(captionSourcePath || "") &&
      flagshipCaptionMatchesCurrentNarration(
        await fs.readFile(captionSourcePath, "utf8"),
        scriptText,
        lastTimestampEnd,
      );
  }
  if (preserveAuthoritativeCaption) {
    if (path.resolve(captionSourcePath) !== path.resolve(captionPath)) {
      await fs.copy(captionSourcePath, captionPath, { overwrite: true });
    }
  } else if (scriptText && timestampWords.length) {
    const captions = buildCaptionSrt(scriptText, lastTimestampEnd, {
      words: timestampWords,
      maxWordsPerPhrase: 3,
      maxPhraseChars: 24,
      maxPhraseDurationS: 1.6,
    });
    if (cleanText(captions)) await fs.writeFile(captionPath, captions, "utf8");
    else blockers.push("captions_generation_failed");
  } else if (!blockers.includes("captions_missing_or_outside_story_package")) {
    blockers.push("captions_missing_or_outside_story_package");
  }

  if (scriptText && await fs.pathExists(captionPath)) {
    const captionText = await fs.readFile(captionPath, "utf8");
    const visibleCaptionText = captionText
      .split(/\r?\n/)
      .filter((line) => {
        const value = line.trim();
        return value &&
          !/^WEBVTT(?:\s|$)/i.test(value) &&
          !/^\d+$/.test(value) &&
          !/-->/.test(value) &&
          !/^(NOTE|STYLE|REGION)(?:\s|$)/i.test(value);
      })
      .join(" ")
      .replace(/<[^>]+>/g, " ");
    if (
      flagshipTranscriptWords(scriptText).join(" ") !==
      flagshipTranscriptWords(visibleCaptionText).join(" ")
    ) {
      blockers.push("captions_do_not_match_final_script");
    }
    const captionEnd = flagshipSrtEndSeconds(captionText);
    if (lastTimestampEnd > 0 && captionEnd + 0.35 < lastTimestampEnd) {
      blockers.push("captions_timeline_does_not_cover_final_narration");
    }
  }

  const scriptSha256 = scriptText ? await sha256File(scriptPath) : null;
  const spokenScriptSha256 = spokenScriptText ? await sha256File(spokenScriptPath) : null;
  const audioSha256 = !blockers.includes("final_audio_missing_or_outside_story_package")
    ? await sha256File(audioPath)
    : null;
  const captionsSha256 = await fs.pathExists(captionPath) ? await sha256File(captionPath) : null;
  if (sourceTimestamps && scriptSha256 && audioSha256 && captionsSha256) {
    const boundTimestamps = {
      ...sourceTimestamps,
      schema_version: Number(sourceTimestamps.schema_version || 1),
      complete: true,
      audio_sha256: audioSha256,
      script_sha256: scriptSha256,
      spoken_script_sha256: spokenScriptSha256,
      captions_sha256: captionsSha256,
      flagship_generation_run_id: runId,
    };
    await fs.writeFile(timestampPath, `${JSON.stringify(boundTimestamps, null, 2)}\n`, "utf8");
  }

  const artifactInputs = {
    final_video: finalVideoPath,
    final_audio: audioPath,
    word_timestamps: timestampPath,
    captions: captionPath,
    script: scriptPath,
    spoken_script: spokenScriptPath,
  };
  const artifacts = {};
  for (const [key, filePath] of Object.entries(artifactInputs)) {
    artifacts[key] = await flagshipGenerationArtifact({
      artifactDir,
      filePath,
      runId,
      scriptSha256,
      spokenScriptSha256,
    });
    if (!artifacts[key]) blockers.push(`${key}_generation_artifact_missing`);
  }
  if (genuineBaseSourceDiversityEvidence) {
    artifacts.genuine_base_source_diversity =
      genuineBaseSourceDiversityEvidence;
  }
  const uniqueBlockers = uniqueCleanTexts(blockers);
  const generationManifest = {
    schema_version: 1,
    story_id: storyId || null,
    complete: uniqueBlockers.length === 0,
    verdict: uniqueBlockers.length === 0 ? "GREEN" : "RED",
    producer_id: "pulse-gaming-flagship-renderer",
    run_id: runId,
    generated_at: generatedAt,
    script_sha256: scriptSha256,
    spoken_script_sha256: spokenScriptSha256,
    artifacts,
    genuine_base_source_diversity: genuineBaseSourceDiversity,
    genuine_base_source_diversity_evidence:
      genuineBaseSourceDiversityEvidence,
    renderer_selected_inputs: renderReport.selected_input_assets || null,
    renderer_selected_inputs_sha256: renderReport.selected_input_assets
      ? stableObjectSha256(renderReport.selected_input_assets)
      : null,
    blockers: uniqueBlockers,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      human_av_signoff_performed: false,
    },
  };
  const manifestPath = path.join(evidenceDir, "generation_manifest.json");
  await fs.writeJson(manifestPath, generationManifest, { spaces: 2 });
  const manifestStat = await fs.stat(manifestPath);
  return {
    complete: generationManifest.complete,
    verdict: generationManifest.verdict,
    manifest_path: manifestPath,
    manifest_sha256: await sha256File(manifestPath),
    manifest_size_bytes: manifestStat.size,
    run_id: runId,
    blockers: uniqueBlockers,
  };
}

async function finalizeStrictElevenLabsRightsAfterRender({
  job = {},
  flagshipGenerationEvidence = {},
  generatedAt,
  finalizeElevenLabsGenerationRightsLineage =
    defaultFinalizeElevenLabsGenerationRightsLineage,
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const receiptPath = path.join(
    artifactDir,
    "rights",
    "evidence",
    "elevenlabs-generation-receipt.json",
  );
  if (!(await fs.pathExists(receiptPath))) {
    return {
      status: "not_applicable",
      verdict: "NOT_APPLICABLE",
      evidence_path: null,
      blockers: [],
    };
  }

  const blockers = [];
  const addBlocker = (value) => {
    const blocker = cleanText(value);
    if (blocker && !blockers.includes(blocker)) blockers.push(blocker);
  };
  const storyId = cleanText(job.story_id);
  const receipt = await readJsonIfPresent(receiptPath, null);
  if (!receipt) {
    addBlocker("generation_receipt_missing_or_unreadable");
  } else {
    if (cleanText(receipt.story_id) !== storyId) {
      addBlocker("generation_receipt_story_id_mismatch");
    }
    if (cleanText(receipt.asset_id) !== `${storyId}_audio_path`) {
      addBlocker("generation_receipt_asset_id_mismatch");
    }
  }

  const generationManifestPath = path.resolve(
    cleanText(flagshipGenerationEvidence.manifest_path) ||
      path.join(artifactDir, "flagship", "generation_manifest.json"),
  );
  const generationManifest = await readJsonIfPresent(
    generationManifestPath,
    null,
  );
  if (
    !generationManifest ||
    generationManifest.complete !== true ||
    cleanText(generationManifest.verdict).toUpperCase() !== "GREEN"
  ) {
    addBlocker("flagship_generation_manifest_not_green");
  }
  if (
    generationManifest &&
    cleanText(generationManifest.story_id) !== storyId
  ) {
    addBlocker("flagship_generation_manifest_story_id_mismatch");
  }

  const artifactBytes = {};
  for (const key of [
    "spoken_script",
    "final_audio",
    "word_timestamps",
    "captions",
    "final_video",
  ]) {
    const artifact = generationManifest?.artifacts?.[key];
    const artifactPath = artifact?.path
      ? path.resolve(artifactDir, cleanText(artifact.path))
      : "";
    if (
      !artifactPath ||
      !pathIsInsideRoot(artifactDir, artifactPath) ||
      !(await fs.pathExists(artifactPath))
    ) {
      addBlocker(`${key}_generation_artifact_missing_or_outside_package`);
      continue;
    }
    const bytes = await fs.readFile(artifactPath);
    const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (
      sha256 !== cleanText(artifact.sha256).toLowerCase() ||
      bytes.length !== Number(artifact.bytes)
    ) {
      addBlocker(`${key}_generation_artifact_fingerprint_mismatch`);
      continue;
    }
    artifactBytes[key] = bytes;
  }

  const finalAudioSha256 = artifactBytes.final_audio
    ? crypto
        .createHash("sha256")
        .update(artifactBytes.final_audio)
        .digest("hex")
    : "";
  if (receipt) {
    const mastering = receipt.mastering_lineage || {};
    if (
      cleanText(mastering.raw_provider_audio_sha256).toLowerCase() !==
        cleanText(receipt.generation?.raw_provider_audio_sha256).toLowerCase() ||
      Number(mastering.raw_provider_audio_size_bytes) !==
        Number(receipt.generation?.raw_provider_audio_size_bytes)
    ) {
      addBlocker("generation_receipt_raw_mastering_binding_mismatch");
    }
    if (
      finalAudioSha256 !==
        cleanText(mastering.mastered_audio_sha256).toLowerCase() ||
      Number(artifactBytes.final_audio?.length || 0) !==
        Number(mastering.mastered_audio_size_bytes) ||
      cleanText(mastering.transform_status).toUpperCase() !== "COMPLETE"
    ) {
      addBlocker("generation_receipt_mastered_audio_binding_mismatch");
    }
  }

  if (artifactBytes.word_timestamps) {
    let timestamps = null;
    try {
      timestamps = JSON.parse(artifactBytes.word_timestamps.toString("utf8"));
    } catch {
      addBlocker("word_timestamps_generation_artifact_invalid_json");
    }
    const binding = timestamps?.meta?.elevenlabsGenerationRights || {};
    const expectedReceiptPath = path
      .relative(artifactDir, receiptPath)
      .replace(/\\/g, "/");
    if (
      cleanText(binding.receiptPath).replace(/\\/g, "/") !==
        expectedReceiptPath ||
      cleanText(binding.rawProviderAudioSha256).toLowerCase() !==
        cleanText(receipt?.generation?.raw_provider_audio_sha256).toLowerCase() ||
      Number(binding.rawProviderAudioSizeBytes) !==
        Number(receipt?.generation?.raw_provider_audio_size_bytes) ||
      cleanText(binding.masteredAudioSha256).toLowerCase() !==
        finalAudioSha256 ||
      Number(binding.masteredAudioSizeBytes) !==
        Number(artifactBytes.final_audio?.length || 0)
    ) {
      addBlocker("word_timestamps_generation_receipt_binding_mismatch");
    }
  }

  if (typeof finalizeElevenLabsGenerationRightsLineage !== "function") {
    addBlocker("elevenlabs_generation_rights_finalizer_unavailable");
  }
  if (blockers.length > 0) {
    return {
      status: "blocked",
      verdict: "AMBER",
      evidence_path: null,
      blockers,
    };
  }

  try {
    const result = await finalizeElevenLabsGenerationRightsLineage({
      artifactDir,
      receiptPath,
      requestText: artifactBytes.spoken_script.toString("utf8").trim(),
      targetPlatforms: asArray(receipt.allowed_platforms),
      now: () => new Date(generatedAt || Date.now()),
      finalizeLineage: async ({ rawAudioBytes }) => ({
        masteredAudioInputBytes: rawAudioBytes,
        masteredAudioOutputBytes: artifactBytes.final_audio,
        finalAudioBytes: artifactBytes.final_audio,
        wordTimestampsBytes: artifactBytes.word_timestamps,
        captionsBytes: artifactBytes.captions,
        finalVideoBytes: artifactBytes.final_video,
      }),
    });
    return {
      status: result.verdict === "GREEN" ? "finalized" : "blocked",
      verdict: result.verdict,
      evidence_path: result.evidencePath || result.evidence_path || null,
      blockers: uniqueCleanTexts(result.evidence?.blockers),
    };
  } catch (error) {
    return {
      status: "blocked",
      verdict: "AMBER",
      evidence_path: null,
      blockers: [
        `elevenlabs_generation_rights_finalization_failed:${cleanText(
          error?.message || error,
        )}`,
      ],
    };
  }
}

function flagshipRightsStatus(value) {
  return cleanText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function flagshipRightsStatusIsNegative(value) {
  const status = flagshipRightsStatus(value);
  return Boolean(status) && /(?:^|_)(?:red|reject|rejected|deny|denied|block|blocked|fail|failed|restricted|prohibited)(?:_|$)/.test(status);
}

function flagshipRightsStatusIsPositive(value) {
  const status = flagshipRightsStatus(value);
  return Boolean(status) && /(?:^|_)(?:green|pass|passed|approve|approved)(?:_|$)/.test(status);
}

function flagshipRightsRows(rightsLedger = {}) {
  const matchedRightsRecords = asArray(rightsLedger.matched_assets).filter((row) => (
    row &&
    typeof row === "object" &&
    cleanText(row.asset_id || row.id) &&
    cleanText(row.path || row.local_path || row.file_path || row.media_path || row.source_url) &&
    cleanText(row.licence_basis || row.license_basis || row.rights_basis) &&
    (
      typeof row.commercial_use_allowed === "boolean" ||
      cleanText(row.approval_status || row.rights_status || row.verdict || row.status)
    )
  ));
  return [
    ...asArray(rightsLedger.records),
    ...asArray(rightsLedger.assets),
    ...asArray(rightsLedger.rights_ledger),
    ...matchedRightsRecords,
  ].filter((row) => row && typeof row === "object");
}

function flagshipRightsRecordIdentity(row = {}) {
  return cleanText(row.asset_id || row.id || row.asset_identity || row.identity);
}

function flagshipRightsIdentity(row = {}) {
  return flagshipRightsRecordIdentity(row).toLowerCase();
}

function flagshipRightsReferences(row = {}) {
  return new Set([
    cleanText(row.source_url || row.url).toLowerCase(),
    cleanText(row.path || row.local_path || row.file_path || row.media_path)
      .replace(/\\/g, "/")
      .toLowerCase(),
  ].filter(Boolean));
}

function flagshipRightsWindow(row = {}) {
  const start = numberOrNull(row.mediaStartS ?? row.media_start_s ?? row.source_media_start_s);
  const duration = numberOrNull(
    row.durationS ?? row.duration_s ?? row.source_window_duration_s,
  );
  return {
    explicit: start != null || duration != null,
    start,
    duration,
  };
}

function flagshipRightsRowsMatch(left = {}, right = {}) {
  const leftId = flagshipRightsIdentity(left);
  const rightId = flagshipRightsIdentity(right);
  if (leftId && rightId && leftId === rightId) return true;
  const leftReferences = flagshipRightsReferences(left);
  const rightReferences = flagshipRightsReferences(right);
  if (![...leftReferences].some((value) => rightReferences.has(value))) return false;
  const leftWindow = flagshipRightsWindow(left);
  const rightWindow = flagshipRightsWindow(right);
  if (!leftWindow.explicit || !rightWindow.explicit) return true;
  if (
    leftWindow.start != null &&
    rightWindow.start != null &&
    Math.abs(leftWindow.start - rightWindow.start) > 0.01
  ) {
    return false;
  }
  if (
    leftWindow.duration != null &&
    rightWindow.duration != null &&
    Math.abs(leftWindow.duration - rightWindow.duration) > 0.01
  ) {
    return false;
  }
  return true;
}

function stableObjectSha256(value) {
  return sha256Text(stableJson(value));
}

function flagshipRightsCreator(row = {}) {
  return cleanText(
    row.creator || row.source_owner || row.owner ||
    row.source?.creator || row.source?.owner || row.rights?.creator,
  );
}

async function writeFlagshipInventoryEvidence({
  job = {},
  generationEvidence = {},
  renderReport = {},
  generatedAt,
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const storyId = cleanText(job.story_id);
  const flagshipDir = path.join(artifactDir, "flagship");
  const inventoryPath = path.join(flagshipDir, "inventory.json");
  const rightsLedgerPath = path.join(artifactDir, "rights_ledger.json");
  const rightsLedger = await readJsonIfPresent(rightsLedgerPath, null);
  const generationManifest = await readJsonIfPresent(generationEvidence.manifest_path, null);
  const blockers = [];
  if (!generationManifest || generationManifest.complete !== true || generationManifest.verdict !== "GREEN") {
    blockers.push("flagship_generation_manifest_not_green");
  }
  if (!rightsLedger || !passStatus(rightsLedger.verdict || rightsLedger.result)) {
    blockers.push("rights_ledger_not_passed");
  }
  if (asArray(rightsLedger?.blockers).length || asArray(rightsLedger?.failures).length) {
    blockers.push("rights_ledger_has_blockers");
  }

  const renderManifest = await readJsonIfPresent(path.join(artifactDir, "render_manifest.json"), {});
  const rendererSelectedInputs = renderReport.selected_input_assets ||
    renderManifest.selected_input_assets ||
    generationManifest?.renderer_selected_inputs ||
    null;
  const rendererSelectedAssets = asArray(rendererSelectedInputs?.assets)
    .filter((row) => row && typeof row === "object");
  if (rendererSelectedInputs?.authoritative !== true || !rendererSelectedAssets.length) {
    blockers.push("renderer_selected_input_inventory_missing");
  }
  const usedRows = rendererSelectedAssets;
  const evidenceRows = flagshipRightsRows(rightsLedger || {});

  const sourceLedgerSha256 = await fs.pathExists(rightsLedgerPath)
    ? await sha256File(rightsLedgerPath)
    : null;
  const packagedAssets = [];
  const seenIds = new Set();
  await fs.ensureDir(path.join(flagshipDir, "assets"));
  await fs.ensureDir(path.join(flagshipDir, "rights"));
  for (let index = 0; index < usedRows.length; index += 1) {
    const used = usedRows[index];
    const assetId = cleanText(used.asset_id || used.id);
    const identity = assetId.toLowerCase();
    if (!assetId) {
      blockers.push(`used_asset_identity_missing:${index}`);
      continue;
    }
    if (seenIds.has(identity)) {
      blockers.push(`used_asset_identity_duplicate:${assetId}`);
      continue;
    }
    seenIds.add(identity);
    let sourceRecordRows = evidenceRows.filter((row) => (
      flagshipRightsRecordIdentity(row) === assetId
    ));
    if (!sourceRecordRows.length) {
      sourceRecordRows = evidenceRows.filter((row) => flagshipRightsRowsMatch(used, row));
    }
    if (!sourceRecordRows.length) {
      blockers.push(`renderer_selected_asset_rights_record_missing:${assetId}`);
      continue;
    }
    if (sourceRecordRows.length > 1) {
      blockers.push(`used_asset_rights_record_duplicate:${assetId}`);
      continue;
    }
    const sourceRecord = sourceRecordRows[0];
    const matchedRows = evidenceRows.filter((row) => flagshipRightsRowsMatch(used, row));
    if (!matchedRows.length) {
      blockers.push(`used_asset_rights_record_missing:${assetId}`);
      continue;
    }
    const allRows = [used, ...matchedRows];
    const statusValues = allRows.flatMap((row) => [
      row.rights_verdict,
      row.verdict,
      row.status,
      row.approval_status,
      row.rights_status,
      row.usage_status,
    ]).filter((value) => cleanText(value));
    const sourceRecordStatusValues = [
      sourceRecord.rights_verdict,
      sourceRecord.verdict,
      sourceRecord.status,
      sourceRecord.approval_status,
      sourceRecord.rights_status,
      sourceRecord.usage_status,
    ].filter((value) => cleanText(value));
    if (statusValues.some(flagshipRightsStatusIsNegative)) {
      blockers.push(`used_asset_rights_rejected:${assetId}`);
      continue;
    }
    if (!sourceRecordStatusValues.some(flagshipRightsStatusIsPositive)) {
      blockers.push(`used_asset_approval_missing:${assetId}`);
      continue;
    }
    if (allRows.some((row) => row.commercial_use_allowed === false)) {
      blockers.push(`used_asset_commercial_use_rejected:${assetId}`);
      continue;
    }
    const merged = sourceRecord;
    const sourcePath = resolveWorkspacePath(
      merged.path || merged.local_path || merged.file_path || merged.media_path,
      artifactDir,
    );
    const sourceUrl = cleanText(merged.source_url || merged.url);
    const creator = flagshipRightsCreator(merged);
    const licenceBasis = cleanText(
      merged.licence_basis || merged.license_basis || merged.rights_basis,
    );
    const allowedPlatforms = uniqueCleanTexts(merged.allowed_platforms);
    const riskScore = Number(merged.risk_score);
    if (!sourcePath || !(await fs.pathExists(sourcePath))) {
      blockers.push(`used_asset_file_missing:${assetId}`);
      continue;
    }
    if (!sourceUrl) blockers.push(`used_asset_source_url_missing:${assetId}`);
    if (!creator) blockers.push(`used_asset_creator_missing:${assetId}`);
    if (!licenceBasis) blockers.push(`used_asset_licence_basis_missing:${assetId}`);
    if (merged.commercial_use_allowed !== true) {
      blockers.push(`used_asset_commercial_use_not_affirmative:${assetId}`);
    }
    if (!allowedPlatforms.length) blockers.push(`used_asset_platform_scope_missing:${assetId}`);
    if (!Number.isFinite(riskScore) || riskScore > 0.5) {
      blockers.push(`used_asset_risk_not_acceptable:${assetId}`);
    }
    if (typeof merged.credit_required !== "boolean") {
      blockers.push(`used_asset_credit_requirement_missing:${assetId}`);
    }
    const assetBlockerPrefix = `used_asset_`;
    if (blockers.some((blocker) => blocker.startsWith(assetBlockerPrefix) && blocker.endsWith(`:${assetId}`))) {
      continue;
    }

    const safeId = assetId.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
    const extension = path.extname(sourcePath) || ".bin";
    const copiedPath = path.join(flagshipDir, "assets", `${String(index + 1).padStart(3, "0")}_${safeId}${extension}`);
    await fs.copy(sourcePath, copiedPath, { overwrite: true });
    const copiedSha256 = await sha256File(copiedPath);
    const copiedStat = await fs.stat(copiedPath);
    const evidencePath = path.join(flagshipDir, "rights", `${safeId}.json`);
    const evidence = {
      schema_version: 1,
      asset_id: assetId,
      asset_sha256: copiedSha256,
      asset_size_bytes: copiedStat.size,
      source_url: sourceUrl,
      creator,
      licence_basis: licenceBasis,
      commercial_use_allowed: true,
      rights_verdict: "GREEN",
      allowed_platforms: allowedPlatforms,
      credit_required: merged.credit_required,
      risk_score: riskScore,
      approval_status: cleanText(merged.approval_status),
      source_ledger_path: artifactRelativePath(artifactDir, rightsLedgerPath),
      source_ledger_sha256: sourceLedgerSha256,
      source_record_sha256: stableObjectSha256(sourceRecordRows),
      generated_at: generatedAt,
    };
    await fs.writeJson(evidencePath, evidence, { spaces: 2 });
    packagedAssets.push({
      asset_id: assetId,
      kind: cleanText(merged.kind || merged.asset_type || merged.type || "asset"),
      path: artifactRelativePath(artifactDir, copiedPath),
      source_url: sourceUrl,
      creator,
      licence_basis: licenceBasis,
      commercial_use_allowed: true,
      rights_verdict: "GREEN",
      evidence_file: artifactRelativePath(artifactDir, evidencePath),
      allowed_platforms: allowedPlatforms,
      credit_required: merged.credit_required,
      risk_score: riskScore,
    });
  }

  if (packagedAssets.length !== usedRows.length) blockers.push("used_asset_inventory_coverage_incomplete");
  const finalOutputs = generationManifest?.artifacts || {};
  const uniqueBlockers = uniqueCleanTexts(blockers);
  const inventory = {
    schema_version: 1,
    story_id: storyId || null,
    complete: uniqueBlockers.length === 0,
    verdict: uniqueBlockers.length === 0 ? "GREEN" : "RED",
    generated_at: generatedAt,
    episode_contract: {
      final_video: {
        width: 1080,
        height: 1920,
        aspect_ratio: "9:16",
        video_codec: "h264",
        audio_codec: "aac",
        audio_sample_rate_hz: 48000,
        require_audio: true,
      },
    },
    generation_manifest: {
      path: artifactRelativePath(artifactDir, generationEvidence.manifest_path),
    },
    final_outputs: {
      video: finalOutputs.final_video ? { path: finalOutputs.final_video.path } : null,
      audio: finalOutputs.final_audio ? { path: finalOutputs.final_audio.path } : null,
      script: finalOutputs.script ? { path: finalOutputs.script.path } : null,
      timestamps: finalOutputs.word_timestamps ? { path: finalOutputs.word_timestamps.path } : null,
      captions: finalOutputs.captions ? {
        path: finalOutputs.captions.path,
        final_video_sha256: finalOutputs.final_video?.sha256 || null,
        final_audio_sha256: finalOutputs.final_audio?.sha256 || null,
        word_timestamps_sha256: finalOutputs.word_timestamps?.sha256 || null,
        script_sha256: generationManifest?.script_sha256 || null,
      } : null,
    },
    renderer_selected_inputs: {
      authoritative: rendererSelectedInputs?.authoritative === true,
      producer_id: cleanText(rendererSelectedInputs?.producer_id) || null,
      asset_count: rendererSelectedAssets.length,
      sha256: rendererSelectedInputs ? stableObjectSha256(rendererSelectedInputs) : null,
    },
    used_assets: packagedAssets,
    blockers: uniqueBlockers,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      rights_decision_invented: false,
    },
  };
  await fs.writeJson(inventoryPath, inventory, { spaces: 2 });
  const inventoryStat = await fs.stat(inventoryPath);
  return {
    complete: inventory.complete,
    verdict: inventory.verdict,
    inventory_path: inventoryPath,
    inventory_sha256: await sha256File(inventoryPath),
    inventory_size_bytes: inventoryStat.size,
    used_asset_count: packagedAssets.length,
    blockers: uniqueBlockers,
  };
}

async function refreshFlagshipInventoryEvidence({
  artifactDir,
  storyId = "",
  generatedAt = new Date().toISOString(),
} = {}) {
  const resolvedArtifactDir = path.resolve(artifactDir || "");
  const generationManifestPath = path.join(
    resolvedArtifactDir,
    "flagship",
    "generation_manifest.json",
  );
  const renderManifestPath = path.join(resolvedArtifactDir, "render_manifest.json");
  const generationManifest = await readJsonIfPresent(generationManifestPath, null);
  const renderManifest = await readJsonIfPresent(renderManifestPath, {});
  const resolvedStoryId = cleanText(storyId || generationManifest?.story_id);
  const evidence = await writeFlagshipInventoryEvidence({
    job: {
      story_id: resolvedStoryId,
      artifact_dir: resolvedArtifactDir,
    },
    generationEvidence: {
      manifest_path: generationManifestPath,
    },
    renderReport: {
      selected_input_assets:
        renderManifest.selected_input_assets || generationManifest?.renderer_selected_inputs || null,
    },
    generatedAt,
  });
  const renderManifestInventorySynced = await fs.pathExists(renderManifestPath);
  if (renderManifestInventorySynced) {
    await fs.writeJson(renderManifestPath, {
      ...renderManifest,
      flagship_inventory_evidence: evidence,
      flagship_inventory_refreshed_at: generatedAt,
    }, { spaces: 2 });
  }
  return {
    story_id: resolvedStoryId || null,
    artifact_dir: resolvedArtifactDir,
    status: evidence.complete ? "inventory_refreshed" : "blocked",
    ...evidence,
    render_manifest_path: renderManifestInventorySynced ? renderManifestPath : null,
    render_manifest_inventory_synced: renderManifestInventorySynced,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
      renderer_invoked: false,
      authoritative_publish_verdict_unchanged: true,
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
    selected_input_assets: renderReport.selected_input_assets || null,
    creative_system_version: cleanText(renderReport.creative_system_version) || null,
    creative_identity: renderReport.creative_identity || null,
    decoded_visual_gate: renderReport.decoded_visual_gate || null,
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

function pathIsInsideRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

async function resolveRenderReportPath(value, { workspaceRoot = process.cwd() } = {}) {
  const text = cleanText(value);
  if (!text) return "";
  const allowedRoots = [...new Set([
    path.resolve(workspaceRoot || process.cwd()),
    path.resolve(process.cwd()),
  ])];
  const candidates = path.isAbsolute(text)
    ? [path.resolve(text)]
    : allowedRoots.map((root) => path.resolve(root, text));
  for (const candidate of candidates) {
    if (!allowedRoots.some((root) => pathIsInsideRoot(root, candidate))) continue;
    if (await fs.pathExists(candidate)) return candidate;
  }
  return "";
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
    const reportPath = await resolveRenderReportPath(
      renderReport.audio_segment_loudness_report,
      { workspaceRoot },
    );
    if (reportPath) {
      report = await readJsonIfPresent(reportPath, null);
    }
  }
  if (!report || typeof report !== "object") return null;
  const finalOutputPath = finalRenderOutputPath(job);
  const finalOutputStat = await fs.stat(finalOutputPath);
  if (!finalOutputStat.isFile() || finalOutputStat.size < 1024) {
    throw new Error("audio_segment_loudness_final_render_unusable");
  }
  const finalOutputSha256 = await sha256File(finalOutputPath);
  const rendererReportInputPath = cleanText(report.input_path) || null;
  const persisted = {
    ...report,
    input_path: finalOutputPath,
    renderer_report_input_path: rendererReportInputPath,
    generated_at: cleanText(report.generated_at) || generatedAt,
    persisted_for_story_id: cleanText(job.story_id || report.story_id),
    persisted_from_render_report: true,
    final_render_binding: {
      exact: true,
      path: finalOutputPath,
      sha256: finalOutputSha256,
      size_bytes: finalOutputStat.size,
      render_generated_at: generatedAt,
    },
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

async function inspectAppliedPostRenderRightsLedger(artifactDir) {
  const ledgerPath = path.join(artifactDir, "rights_ledger.json");
  const appliedLedger = await readJsonIfPresent(ledgerPath, null);
  const appliedLedgerRecords = flagshipRightsRows(appliedLedger || {});
  const appliedLedgerBlockers = uniqueCleanTexts([
    ...asArray(appliedLedger?.blockers),
    ...asArray(appliedLedger?.failures),
  ]);
  const appliedLedgerGreen = Boolean(
    appliedLedger &&
    passStatus(appliedLedger.verdict || appliedLedger.result) &&
    appliedLedgerRecords.length > 0 &&
    appliedLedgerBlockers.length === 0,
  );
  const ledgerExists = await fs.pathExists(ledgerPath);
  const ledgerStat = ledgerExists ? await fs.stat(ledgerPath) : null;
  return {
    ledger: appliedLedger,
    ledger_path: ledgerPath,
    ledger_sha256: ledgerExists ? await sha256File(ledgerPath) : null,
    ledger_size_bytes: ledgerStat?.isFile() ? ledgerStat.size : 0,
    record_count: appliedLedgerRecords.length,
    blockers: appliedLedgerBlockers,
    green: appliedLedgerGreen,
  };
}

function bindAppliedPostRenderRightsLedger(report = {}, ledgerState = {}, {
  finalStateVerified = false,
} = {}) {
  const reconciliationBlockers = uniqueCleanTexts([
    ...asArray(report?.blockers),
    ...asArray(report?.failures),
  ]);
  const transactionFailed =
    report?.transaction?.committed === false ||
    report?.transaction?.rolled_back === true;
  const reconciliationApplied = Boolean(
    passStatus(report?.verdict || report?.status || report?.result) &&
    report?.applied === true &&
    reconciliationBlockers.length === 0 &&
    !transactionFailed,
  );
  const finalGreen = Boolean(
    finalStateVerified &&
    ledgerState.green &&
    reconciliationApplied,
  );
  const bound = {
    ...(report || {}),
    applied_ledger_verdict:
      cleanText(
        ledgerState.ledger?.verdict ||
          ledgerState.ledger?.result,
      ) || null,
    applied_ledger_record_count: Number(ledgerState.record_count || 0),
    applied_ledger_sha256: cleanText(ledgerState.ledger_sha256) || null,
    applied_ledger_size_bytes: Number(ledgerState.ledger_size_bytes || 0),
    can_auto_publish: finalGreen,
    ...(finalStateVerified
      ? {
          final_state_verified: true,
          final_state_verification_basis:
            "stored_rights_ledger_after_quality_refresh_and_inventory",
        }
      : {}),
  };
  if (finalGreen) {
    return {
      ...bound,
      verdict: "PASS",
      status: "GREEN",
      blockers: [],
    };
  }
  if (ledgerState.green && !finalStateVerified) return bound;
  return {
    ...bound,
    verdict: "FAIL",
    status: "RED",
    can_auto_publish: false,
    blockers: uniqueCleanTexts([
      ...asArray(report?.blockers),
      ...(ledgerState.green && !reconciliationApplied
        ? ["post_render_rights_reconciliation_not_applied"]
        : []),
      ...(ledgerState.green ? [] : ["post_render_rights_ledger_not_green"]),
      ...(ledgerState.record_count
        ? []
        : ["post_render_rights_ledger_records_missing"]),
      ...asArray(ledgerState.blockers),
    ]),
  };
}

async function persistPostRenderRightsReconciliationReport({
  job = {},
  report = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const artifactDir = path.resolve(job.artifact_dir || "");
  const reportPath = path.join(
    artifactDir,
    "flagship",
    "rights_reconciliation_report.json",
  );
  await fs.ensureDir(path.dirname(reportPath));
  await fs.writeJson(reportPath, {
    schema_version: 1,
    story_id: cleanText(job.story_id),
    mode: "POST_RENDER_RIGHTS_RECONCILIATION",
    ...report,
    generated_at: generatedAt,
    safety: {
      ...(report?.safety || {}),
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  }, { spaces: 2 });
  return reportPath;
}

async function reconcilePostRenderRights({
  job = {},
  workspaceRoot = process.cwd(),
  generatedAt = new Date().toISOString(),
  reconcileRightsEvidence = null,
  probeMedia = defaultRightsProbeMedia,
} = {}) {
  if (typeof reconcileRightsEvidence !== "function") return null;
  const artifactDir = path.resolve(job.artifact_dir || "");
  let report;
  try {
    report = await reconcileRightsEvidence({
      artifactDir,
      bridgePath: null,
      storyId: cleanText(job.story_id),
      apply: true,
      generatedAt,
      probeMedia,
      workspaceRoot,
      authorityBlockers: [],
    });
  } catch (error) {
    report = {
      verdict: "FAIL",
      applied: false,
      blockers: ["post_render_rights_reconciliation_failed"],
      error: cleanText(error?.message || error),
    };
  }
  const appliedLedgerState = await inspectAppliedPostRenderRightsLedger(artifactDir);
  report = bindAppliedPostRenderRightsLedger(report, appliedLedgerState);
  const reportPath = await persistPostRenderRightsReconciliationReport({
    job,
    report,
    generatedAt,
  });
  return {
    ...report,
    generated_at: generatedAt,
    report_path: reportPath,
  };
}

async function finalizePostRenderRightsReconciliation({
  job = {},
  rightsReconciliation = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!rightsReconciliation || typeof rightsReconciliation !== "object") return null;
  const artifactDir = path.resolve(job.artifact_dir || "");
  const finalLedgerState = await inspectAppliedPostRenderRightsLedger(artifactDir);
  const finalReport = bindAppliedPostRenderRightsLedger(
    rightsReconciliation,
    finalLedgerState,
    { finalStateVerified: true },
  );
  const reportPath = await persistPostRenderRightsReconciliationReport({
    job,
    report: finalReport,
    generatedAt,
  });
  return {
    ...finalReport,
    generated_at: generatedAt,
    report_path: reportPath,
  };
}

function assertEditorialAuthorityReady(directorPlan = {}) {
  const exceptionPlan = directorPlan.editorial_exception_plan || {};
  if (exceptionPlan.used !== true) return;
  const integration = directorPlan.editorial_authority_materialisation || {};
  if (
    exceptionPlan.planning_valid === true &&
    integration.verdict === "PASS" &&
    asArray(integration.blockers).length === 0
  ) {
    return;
  }
  const blocker = cleanText(
    asArray(integration.blockers)[0] ||
      asArray(exceptionPlan.blockers)[0] ||
      "editorial_authority:unresolved_amber_exception",
  );
  throw new Error(`editorial_authority_unresolved:${blocker}`);
}

async function materializeProductionRenderJob(job = {}, options = {}) {
  const storyId = cleanText(job.story_id);
  const outputPath = finalRenderOutputPath(job);
  const ownedMotionOnly = Boolean(
    options.ownedMotionOnly === true ||
      job.rights_safe_owned_motion_only === true ||
      job.evidence?.rights_safe_owned_motion_only === true,
  );
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
  const {
    storyJsonPath,
    story,
    finalDirectMotionQaReport,
  } = await buildRendererStoryJson(job, {
    generatedAt: options.generatedAt,
    workspaceRoot: options.workspaceRoot,
    directMotionFilter: options.directMotionFilter,
    ownedMotionOnly,
    targetPlatforms: options.targetPlatforms,
    editorialAuthorityBundleId: options.editorialAuthorityBundleId,
    operatingMode: options.operatingMode,
  });
  assertEditorialAuthorityReady(story.visual_v4_director_plan);
  assertSourceCardIdentityReady(story);
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
    await promoteRenderedOutputAtomically({
      temporaryPath: temporaryOutputPath,
      outputPath,
    });
    stat = await fs.stat(outputPath);
    renderReport = await bindDecodedVisualGateToFinalOutput({
      renderReport,
      outputPath,
      workspaceRoot: options.workspaceRoot,
    });
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
  const flagshipGenerationEvidence = await writeFlagshipGenerationEvidence({
    job,
    inputState,
    renderReport,
    rendererStory: story,
    directMotionQaReport: finalDirectMotionQaReport,
    generatedAt: options.generatedAt,
  });
  const elevenlabsGenerationRightsEvidence =
    await finalizeStrictElevenLabsRightsAfterRender({
      job,
      flagshipGenerationEvidence,
      generatedAt: options.generatedAt,
      finalizeElevenLabsGenerationRightsLineage:
        options.finalizeElevenLabsGenerationRightsLineage,
    });
  const renderManifestPath = finalRenderManifestPath(job);
  const renderManifest = await readJsonIfPresent(renderManifestPath, {});
  await fs.writeJson(renderManifestPath, {
    ...renderManifest,
    rights_safe_owned_motion_only: ownedMotionOnly,
    flagship_generation_evidence: flagshipGenerationEvidence,
    elevenlabs_generation_rights_evidence:
      elevenlabsGenerationRightsEvidence,
  }, { spaces: 2 });
  const flagshipNarrationQaEvidence = await writeFlagshipNarrationQaEvidence({
    artifactDir: job.artifact_dir,
    generatedAt: options.generatedAt,
    durationProbe: options.narrationQaDurationProbe,
    silenceProbe: options.narrationQaSilenceProbe,
  });
  const initialRightsReconciliation = await reconcilePostRenderRights({
    job,
    workspaceRoot: options.workspaceRoot,
    generatedAt: options.generatedAt,
    reconcileRightsEvidence: options.reconcileRightsEvidence,
    probeMedia: options.rightsProbeMedia,
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
    rightsReconciliation: initialRightsReconciliation,
    editorialAuthorityBundleId: options.editorialAuthorityBundleId,
    operatingMode: options.operatingMode,
  });
  const postQualityRightsReconciliation = await reconcilePostRenderRights({
    job,
    workspaceRoot: options.workspaceRoot,
    generatedAt: options.generatedAt,
    reconcileRightsEvidence: options.reconcileRightsEvidence,
    probeMedia: options.rightsProbeMedia,
  });
  const flagshipInventoryEvidence = await writeFlagshipInventoryEvidence({
    job,
    generationEvidence: flagshipGenerationEvidence,
    renderReport,
    generatedAt: options.generatedAt,
  });
  const rightsReconciliation = await finalizePostRenderRightsReconciliation({
    job,
    rightsReconciliation:
      postQualityRightsReconciliation || initialRightsReconciliation,
    generatedAt: options.generatedAt,
  });
  const refreshedRenderManifest = await readJsonIfPresent(renderManifestPath, {});
  await fs.writeJson(renderManifestPath, {
    ...refreshedRenderManifest,
    rights_safe_owned_motion_only: ownedMotionOnly,
    flagship_generation_evidence: flagshipGenerationEvidence,
    flagship_narration_qa_evidence: flagshipNarrationQaEvidence,
    elevenlabs_generation_rights_evidence:
      elevenlabsGenerationRightsEvidence,
    rights_reconciliation: rightsReconciliation,
    flagship_inventory_evidence: flagshipInventoryEvidence,
  }, { spaces: 2 });
  return {
    story_id: storyId,
    title: cleanText(job.title),
    status: "rendered",
    output_path: outputPath,
    render_manifest_path: finalRenderManifestPath(job),
    size_bytes: stat.size,
    clips: renderReport.clips ?? null,
    rendered_duration_s: renderReport.rendered_duration_s ?? null,
    flagship_generation_evidence: flagshipGenerationEvidence,
    flagship_narration_qa_evidence: flagshipNarrationQaEvidence,
    elevenlabs_generation_rights_evidence:
      elevenlabsGenerationRightsEvidence,
    rights_reconciliation: rightsReconciliation,
    flagship_inventory_evidence: flagshipInventoryEvidence,
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
  ownedMotionOnly = false,
  editorialAuthorityBundleId = "",
  operatingMode = "LOCAL_PROOF",
  targetPlatforms = DEFAULT_RENDER_TARGET_PLATFORMS,
  renderProof = defaultRenderProof,
  verifyRenderedMedia = renderProof === defaultRenderProof ? verifyProductionRenderMedia : null,
  directMotionFilter = undefined,
  narrationQaDurationProbe = undefined,
  narrationQaSilenceProbe = undefined,
  reconcileRightsEvidence = undefined,
  rightsProbeMedia = defaultRightsProbeMedia,
  finalizeElevenLabsGenerationRightsLineage =
    defaultFinalizeElevenLabsGenerationRightsLineage,
} = {}) {
  const selectedOperatingMode = cleanText(operatingMode).toUpperCase();
  if (!["LOCAL_PROOF", "DRY_RUN_PUBLISH"].includes(selectedOperatingMode)) {
    throw new Error("editorial_authority_operating_mode_forbidden");
  }
  const selectedDirectMotionFilter =
    directMotionFilter === undefined
      ? (renderProof === defaultRenderProof ? defaultFilterPremiumDirectMotionClips : null)
      : directMotionFilter;
  const selectedRightsReconciler =
    reconcileRightsEvidence === undefined
      ? (renderProof === defaultRenderProof ? defaultReconcileRightsEvidence : null)
      : reconcileRightsEvidence;
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
          ownedMotionOnly,
          editorialAuthorityBundleId,
          operatingMode: selectedOperatingMode,
          targetPlatforms,
          renderProof,
          verifyRenderedMedia,
           directMotionFilter: selectedDirectMotionFilter,
           narrationQaDurationProbe,
           narrationQaSilenceProbe,
           reconcileRightsEvidence: selectedRightsReconciler,
           rightsProbeMedia,
           finalizeElevenLabsGenerationRightsLineage,
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
    operating_mode: selectedOperatingMode,
    editorial_authority: {
      bundle_id: cleanText(editorialAuthorityBundleId) || null,
      supplied_by: "operator_option_only",
      opaque_handles_serialized: false,
    },
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
  refreshFlagshipInventoryEvidence,
  refreshFinalRenderQualityOnly,
  renderGoalProductionRenderMaterializationMarkdown,
  writeGoalProductionRenderMaterializationReport,
  buildRendererStoryJson,
  jobsForProductionRender,
  shouldSkipReadableShellCardsForAudioBudget,
  _private: {
    clipBaseSourceKey,
    strictDirectMotionBaseSourceKey,
    selectGovernedOwnedMotionOnlyClips,
    selectNonReadableOwnedExplainerTopUpForMotionBalance,
    premiumShellPrimaryClipsForRender,
    footagePlanForDirector,
    promoteRenderedOutputAtomically,
    augmentRightsLedgerForSelectedClips,
    renderedScenePlanClipObjects,
    preferStrictDirectMotionBaseUniquenessWhenEnough,
    preferredMaterialisedClips,
    rendererBridgeClipFromProductionClip,
    hydrateClipWithGovernedEvidence,
    hydrateClipWithTrustedSourceIdentity,
    resolveNarrationDurationS,
    governedDenseDirectMotionSupportsSourceOnly,
    governedReadableShellCardPaths,
    readableHyperframesCardDurationS,
    selectReadableHyperframesCardsForMotionBalance,
    topUpPrimaryClipsForAudioCoverage,
    buildPostRenderForensicQaReport,
    reconcilePostRenderRights,
    hydrateCinematicSoundscapeRightsRuntime,
  },
};
