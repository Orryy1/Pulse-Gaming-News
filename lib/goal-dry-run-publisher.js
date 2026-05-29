"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const mediaPaths = require("./media-paths");
const { evaluateGoalPublicCopy } = require("./goal-public-copy-qa");
const { evaluateIncidentGuard } = require("./incident-guard");
const { visualEvidenceProfile } = require("./visual-evidence-classifier");

const REQUIRED_READY_FILES = [
  "canonical_story_manifest.json",
  "visual_v4_render.mp4",
  "captions.srt",
  "render_manifest.json",
  "visual_quality_report.json",
  "benchmark_report.json",
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

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
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

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
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

function manifestReadyStatus(manifest = {}) {
  const status = cleanText(manifest.status || manifest.state || manifest.verdict || manifest.result).toLowerCase();
  if (!status) return true;
  return ["ready", "pass", "passed", "green", "ok", "complete"].includes(status);
}

async function narrationReady(artifactDir, narrationManifest = {}, audioManifest = {}, fallbackTranscript = "") {
  if (!artifactDir || !manifestReadyStatus(narrationManifest) || !manifestReadyStatus(audioManifest)) return false;
  const transcript = cleanText(
    narrationManifest.transcript ||
      narrationManifest.final_transcript ||
      audioManifest.transcript ||
      audioManifest.final_transcript ||
      fallbackTranscript,
  );
  const audioPath =
    narrationManifest.audio_path ||
    narrationManifest.final_audio_path ||
    narrationManifest.narration_audio_path ||
    audioManifest.audio_path ||
    audioManifest.final_audio_path ||
    audioManifest.narration_audio_path;
  if (transcript.split(/\s+/).filter(Boolean).length < 3) return false;
  return referencedFileReady(artifactDir, audioPath, 100);
}

function wordTimestampsReady(timestamps = {}) {
  const entries = Array.isArray(timestamps)
    ? timestamps
    : asArray(timestamps.words || timestamps.word_timestamps || timestamps.timestamps);
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
  const entries = Array.isArray(timestamps)
    ? timestamps
    : asArray(timestamps.words || timestamps.word_timestamps || timestamps.timestamps);
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

function motionEvidence(ownedMotionManifest = {}, materialisedMotionClips = {}) {
  const clips = [
    ...asArray(ownedMotionManifest.materialised_clips),
    ...asArray(ownedMotionManifest.clips),
    ...asArray(ownedMotionManifest.assets),
    ...asArray(
      Array.isArray(materialisedMotionClips)
        ? materialisedMotionClips
        : materialisedMotionClips.clips || materialisedMotionClips.materialised_clips,
    ),
  ];
  const families = new Set(
    [
      ...asArray(ownedMotionManifest.distinct_motion_families),
      ...clips.map((clip) => cleanText(clip.motion_family || clip.family || clip.visual_family)),
    ].filter(Boolean),
  );
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
  const familyValues = clips.map((clip) =>
    cleanText(clip.motion_family || clip.source_family || clip.family || path.basename(cleanText(clip.path), path.extname(cleanText(clip.path)))),
  );
  const shotBudgetFamilies = Number(directorBeatMap.shot_budget?.available_distinct_motion_families);
  const shotBudgetClips = Number(directorBeatMap.shot_budget?.available_motion_clips);
  return {
    clips,
    families: new Set(familyValues.filter(Boolean)),
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

async function inspectStoryPackage(storyPackage = {}, options = {}) {
  const artifactDir = storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir || "";
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
  const sfxManifest = artifactDir
    ? await readJsonIfPresent(path.join(artifactDir, "sfx_manifest.json"))
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
  const storyId = storyPackage.story_id || canonical.story_id || "unknown";
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
  const referencedWordTimestamps = wordTimestamps || await readJsonReferenceIfPresent(
    artifactDir,
    audioManifest.word_timestamps_path || audioManifest.timestamps_path,
    null,
  );
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
      renderStoryMotion.shot_budget_clip_count >= 5,
    distinct_motion_families_ready:
      motion.distinct_motion_families_ready ||
      renderStoryMotion.families.size >= 3 ||
      renderStoryMotion.shot_budget_family_count >= 3,
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
    rights_ledger_ready: rightsLedgerReady(rightsLedger),
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

  const green = publishVerdict.verdict === "GREEN";
  const visualEvidence = visualEvidenceProfile({
    story: { ...canonical, ...renderStory },
    rightsLedger: rightsLedger || {},
    footageInventory,
    directorPlan: directorBeatMap,
  });
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
  if (renderManifest.final_publish_render === true) {
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
  }
  const publicCopyQa = evaluateGoalPublicCopy({
    ...canonical,
    platform_publish_manifest: platformManifest,
    landing_page_manifest: landingPage,
  });
  blockers.push(...asArray(publicCopyQa.failures));
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
    story_id: storyPackage.story_id || canonical.story_id || "unknown",
    canonical_story_manifest: canonical,
    render_manifest: renderManifest,
    visual_quality_report: visualQualityReport,
    benchmark_report: benchmarkReport,
    sfx_manifest: sfxManifest,
    audio_segment_loudness_report: audioSegmentReport,
    publish_verdict: publishVerdict,
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
  );

  const inspected = {
    story_id: storyId,
    artifact_dir: artifactDir || null,
    blockers,
    warnings,
    canonical,
    publish_verdict: publishVerdict,
    render_manifest: renderManifest,
    platform_publish_manifest: platformManifest,
    landing_page_manifest: landingPage,
    platform_policy_report: policy,
    public_copy_qa: publicCopyQa,
    incident_guard: incidentGuard,
    visual_quality_report: visualQualityReport,
    benchmark_report: benchmarkReport,
    sfx_manifest: sfxManifest,
    audio_segment_loudness_report: audioSegmentReport,
    file_evidence: fileEvidence,
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

function resolveArtifactReference(artifactDir, reference) {
  const raw = cleanText(reference);
  if (!raw) return "";
  return path.resolve(path.isAbsolute(raw) ? raw : path.join(artifactDir, raw));
}

function buildPlatformAction(story, platform, platformOperationalConfig = null) {
  const outputs = story.platform_publish_manifest.outputs || {};
  const platformConfig = outputs[platform] || {};
  const artifactDir = story.artifact_dir;
  const title = cleanText(
    story.canonical.selected_title ||
      story.canonical.short_title ||
      story.canonical.canonical_title ||
      story.canonical.title ||
      story.canonical.canonical_subject,
  );
  const durationWindow =
    platformConfig.publish_duration_seconds ||
    platformConfig.technical_duration_seconds ||
    platformConfig.duration_seconds ||
    null;
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
  if (durationWindow && videoDurationS != null) {
    const min = numberOrNull(durationWindow.min);
    const max = numberOrNull(durationWindow.max);
    if (min != null && videoDurationS < min) blockers.push(`platform_duration_below_min:${platform}:${min}`);
    if (max != null && videoDurationS > max) blockers.push(`platform_duration_above_max:${platform}:${max}`);
  }
  const operationalState = platformOperationalState(platformOperationalConfig, platform);
  const platformEnabled = platformReadyNow(operationalState);
  return {
    story_id: story.story_id,
    platform,
    action: blockers.length ? "blocked" : platformEnabled ? "would_publish" : "would_queue_when_enabled",
    mode: "DRY_RUN_PUBLISH",
    title,
    video_path: videoPath,
    captions_path: captionsPath,
    cover_frame_source: videoPath,
    description: cleanText(story.canonical.description),
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
  const readyForUnattended = readiness.ready_for_unattended_publish === true;
  const readinessReasons = uniqueCleanStrings(asArray(readiness.readiness_reasons));
  const requiresHumanReview = publishCandidate && !readyForUnattended;
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
  } else if (requiresHumanReview) {
    liveExecutionGate = "operator_human_review_required";
    liveExecutionGateReasons = readinessReasons;
  }
  return {
    ...action,
    live_publish_allowed_from_dry_run: false,
    requires_human_review_before_live_publish: requiresHumanReview,
    live_execution_gate: liveExecutionGate,
    live_execution_gate_reasons: liveExecutionGateReasons,
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
  const deferredActions = asArray(actions).filter((action) => action.action === "would_queue_when_enabled");
  let requiredNextStep = "switch_to_guarded_live_mode_after_final_operator_check";
  if (asArray(blockedActions).length > 0) {
    requiredNextStep = "repair_blocked_platform_actions";
  } else if (asArray(heldStories).length > 0) {
    requiredNextStep = "repair_or_reject_held_stories_before_unattended_publish";
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
  warningActions = [],
} = {}) {
  const reasons = [];
  if (asArray(disasterUploadBlockers).length > 0) reasons.push("incident_guard_failed");
  if (asArray(blockedStories).length > 0) reasons.push("stories_blocked");
  if (asArray(blockedActions).length > 0) reasons.push("platform_actions_blocked");
  if (asArray(deferredActions).length > 0) reasons.push("platform_actions_deferred_until_enabled");
  if (asArray(heldStories).length > 0) reasons.push("stories_quarantined_or_operator_held");
  if (asArray(warningActions).length > 0) reasons.push("platform_or_preflight_warnings");
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
  const stories = asArray(plan.incident_guard_report?.stories).map((story) => ({
    story_id: story.story_id,
    artifact_dir: story.artifact_dir,
    verdict: story.public_output_coherence_report?.verdict || "missing",
    blockers: asArray(story.public_output_coherence_report?.blockers),
  }));
  const failed = stories.filter((story) => story.verdict !== "pass" || story.blockers.length > 0);
  return {
    schema_version: 1,
    generated_at: plan.generated_at || new Date().toISOString(),
    verdict: failed.length ? "fail" : "pass",
    story_count: stories.length,
    failed_story_count: failed.length,
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

function visualSourceReviewResolution(review = null, storyId = "") {
  if (!review || typeof review !== "object") return null;
  const reviewStoryId = cleanText(review.story_id || review.id);
  if (reviewStoryId && storyId && reviewStoryId !== storyId) return null;
  const decision = cleanText(review.decision || review.verdict || review.status);
  if (!VISUAL_SOURCE_SKIP_DECISIONS.has(decision)) return null;
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
    if (story.blockers.length === 0) {
      seen.set(fingerprint, { title, story_id: story.story_id });
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
  for (const story of stories) {
    const blockersBeforePreflight = asArray(story.blockers);
    const candidate = candidatesById.get(String(story.story_id || ""));
    if (!candidate) {
      const excluded = excludedById.get(String(story.story_id || ""));
      const reason = cleanText(excluded?.reason);
      if (/^already_has_public_platform_id:/i.test(reason)) {
        story.skip_reason = reason;
        story.skip_status = "already_public";
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
    const hasEmbeddedPreflightQa = Boolean(candidate.preflight_qa);
    const preflightStatus = candidate.preflight_qa?.status || (
      candidate.status === "publish_ready" ? "pass" : "missing"
    );
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
    if (candidate.status !== "publish_ready") {
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

function schedulerPreflightEvidenceForStory(story = {}) {
  const candidate = story.scheduler_preflight_candidate;
  if (!candidate || typeof candidate !== "object") return null;
  const preflightQa = candidate.preflight_qa || {};
  const status = preflightQa.status || (candidate.status === "publish_ready" ? "pass" : "missing");
  return {
    candidate_status: cleanText(candidate.status) || null,
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

async function buildGoalDryRunPublishPlan({
  storyPackages = [],
  generatedAt = new Date().toISOString(),
  candidatePreflightReport = null,
  requireSchedulerPreflight = false,
  platformOperationalConfig = null,
  motionPackRoot = null,
  repairWorkOrder = null,
  upstreamAntiSpamReport = null,
} = {}) {
  const inspected = [];
  for (const storyPackage of asArray(storyPackages)) {
    inspected.push(await inspectStoryPackage(storyPackage, { motionPackRoot }));
  }
  applyTitlePatternGate(inspected);
  applyTitleUniquenessGate(inspected);
  applyUpstreamAntiSpamSkips(inspected, upstreamAntiSpamReport);
  applySchedulerPreflightGate(inspected, candidatePreflightReport, {
    required: requireSchedulerPreflight,
  });
  applyRepairWorkOrderContext(inspected, repairWorkOrder);
  applyRepairWorkOrderQuarantine(inspected, repairWorkOrder);
  for (const story of inspected) {
    story.blockers = uniqueCleanStrings(story.blockers);
    story.warnings = uniqueCleanStrings(story.warnings);
    story.hold_reasons = uniqueCleanStrings(story.hold_reasons);
  }
  const skippedStories = inspected.filter((story) => story.skip_status);
  const heldStories = inspected.filter((story) => !story.skip_status && story.hold_status);
  const readyStories = inspected.filter((story) => !story.skip_status && !story.hold_status && story.blockers.length === 0);
  const blockedStories = inspected
    .filter((story) => !story.skip_status && !story.hold_status && story.blockers.length > 0)
    .map((story) => ({
      story_id: story.story_id,
      artifact_dir: story.artifact_dir,
      blockers: story.blockers,
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
    incident_guard: story.incident_guard || null,
  }));
  const skippedStoryReports = skippedStories.map((story) => ({
    story_id: story.story_id,
    artifact_dir: story.artifact_dir,
    status: story.skip_status,
    reason: story.skip_reason,
  }));
  const platformActions = readyStories.flatMap((story) =>
    PLATFORMS.map((platform) => buildPlatformAction(story, platform, platformOperationalConfig)),
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
    public_output_coherence_report: story.incident_guard?.public_output_coherence_report || null,
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
      preflight_checked_story_count: candidatePreflightReport
        ? inspected.filter((story) => story.scheduler_preflight_candidate).length
        : 0,
    },
    actions: gatedActions,
    blocked_actions: gatedBlockedActions,
    ready_stories: readyStories.map((story) => ({
      story_id: story.story_id,
      artifact_dir: story.artifact_dir,
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
  await fs.writeJson(publicOutputCoherencePath, buildPublicOutputCoherenceReport(plan), { spaces: 2 });
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
  buildPublicOutputCoherenceReport,
  buildPublishVerdictSummary,
  renderGoalDryRunPublishPlanMarkdown,
  writeGoalDryRunPublishPlan,
};
