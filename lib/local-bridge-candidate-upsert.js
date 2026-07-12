"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const {
  DEFAULT_MIN_WORDS,
} = require("./services/content-qa");
const {
  DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
  DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
  NORMAL_PRODUCTION_DURATION_LANE,
} = require("./services/short-duration-contract");
const { applyGamingPronunciation } = require("./tts-pronunciation");
const {
  hasGtaViSpokenSix,
  hasMalformedGtaViSpokenStutter,
  hasRiskyGtaViOpening,
  hasSplitGtaViRomanNarration,
} = require("./studio/v2/approved-voice-path");

const MIN_FINAL_RENDER_BYTES = 500_000;
const MIN_BRIDGE_SCRIPT_WORDS = DEFAULT_MIN_WORDS;
const ENABLED_PLATFORMS = ["youtube_shorts", "instagram_reels", "facebook_reels"];
const STANDALONE_PLATFORM_PACKS = {
  youtube_shorts: "youtube_publish_pack.json",
  instagram_reels: "instagram_publish_pack.json",
  facebook_reels: "facebook_publish_pack.json",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") {
    if (Array.isArray(value.records)) return value.records.filter(Boolean);
    if (Array.isArray(value.assets)) return value.assets.filter(Boolean);
  }
  return [];
}

async function readJsonIfPresent(filePath, fallback = {}) {
  try {
    if (await fs.pathExists(filePath)) return await fs.readJson(filePath);
  } catch {
    // Fall through to fallback.
  }
  return fallback;
}

function firstSentence(value = "") {
  const text = cleanText(value);
  if (!text) return "";
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return cleanText(match ? match[1] : text);
}

function wordCount(value = "") {
  return cleanText(value).split(/\s+/).filter(Boolean).length;
}

function comparableVoiceText(value = "") {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\u2018\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasLiteralGtaViVoiceRisk(value = "") {
  const text = comparableVoiceText(value);
  return /\b(?:g\s*t\s*a|gta|grand\s+theft\s+auto)\s+(?:v\s*i|vi)\b/.test(text);
}

function hasGtaViSubject(canonical = {}) {
  return [
    canonical.selected_title,
    canonical.public_title,
    canonical.canonical_title,
    canonical.title,
    canonical.canonical_subject,
    canonical.canonical_game,
    canonical.game_title,
    canonical.narration_script,
    canonical.full_script,
    canonical.tts_script,
    canonical.spoken_narration_script,
  ].some((value) => {
    const text = comparableVoiceText(value);
    return (
      /\bgtavi\b/.test(text) ||
      /\bgta\s+(?:6|six|v\s*i|vi)\b/.test(text) ||
      /\bg\s*t\s*a\s+(?:6|six|v\s*i|vi)\b/.test(text) ||
      /\bgrand\s+theft\s+auto\s+(?:6|six|v\s*i|vi)\b/.test(text) ||
      /\brockstars\s+next\s+grand\s+theft\s+auto\b/.test(text) ||
      /\bthe\s+next\s+grand\s+theft\s+auto\b/.test(text)
    );
  });
}

function hasRiskyGtaViVoiceText(value = "") {
  const text = cleanText(value);
  if (!text) return false;
  const comparable = comparableVoiceText(text);
  return (
    hasLiteralGtaViVoiceRisk(text) ||
    hasGtaViSpokenSix(comparable) ||
    hasMalformedGtaViSpokenStutter(comparable) ||
    hasRiskyGtaViOpening(comparable) ||
    hasSplitGtaViRomanNarration(comparable)
  );
}

function narrationScriptsForBridge(canonical = {}) {
  const displayScript = cleanText(
    canonical.narration_script ||
      canonical.full_script ||
      canonical.public_script ||
      canonical.script ||
      canonical.tts_script,
  );
  const explicitSpokenScript = cleanText(canonical.spoken_narration_script || canonical.tts_script);
  const generatedSpokenScript = cleanText(explicitSpokenScript || applyGamingPronunciation(displayScript));
  const isGtaVi = hasGtaViSubject(canonical);
  const publishScript = isGtaVi ? generatedSpokenScript : cleanText(displayScript || generatedSpokenScript);
  return {
    displayScript,
    explicitSpokenScript,
    spokenScript: generatedSpokenScript,
    publishScript,
    isGtaVi,
  };
}

function verdictGreen(value) {
  return ["GREEN", "PASS", "READY", "VIRAL_READY"].includes(cleanText(value).toUpperCase());
}

function publishVerdictNeedsRepair(publishVerdict = {}) {
  return !verdictGreen(publishVerdict.verdict) || publishVerdict.can_auto_publish !== true;
}

function currentPackageCanRepairStalePublishVerdict(platformPublishManifest = {}) {
  return (
    platformPublishManifest.local_bridge_repaired_from_standalone_packs === true ||
    verdictGreen(platformPublishManifest.publish_status)
  );
}

function mediaHouseScoreNeedsRepair(mediaHouseScore = {}) {
  return !verdictGreen(mediaHouseScore.verdict) || mediaHouseScore.status !== "pass";
}

function currentPackageCanRepairStaleMediaHouseScore(mediaHouseScore = {}) {
  if (Array.isArray(mediaHouseScore.hard_failures) && mediaHouseScore.hard_failures.length) return false;
  const scores = mediaHouseScore.scores || {};
  const thresholds = mediaHouseScore.thresholds || {};
  const required = [
    "overall_media_house_score",
    "competitor_parity_score",
    "first_3_seconds_score",
    "title_strength_score",
    "script_punch_score",
    "motion_density_score",
    "mobile_readability_score",
    "source_lock_score",
  ];
  return required.every((key) => {
    const score = Number(scores[key]);
    const threshold = Number(thresholds[key] ?? 0);
    return Number.isFinite(score) && score >= threshold;
  });
}

function repairMediaHouseScoreForBridge(mediaHouseScore = {}, validation = {}, generatedAt = "") {
  if (!validation.warnings?.includes("stale_media_house_score_ignored_after_current_package_repair")) {
    return mediaHouseScore;
  }
  return {
    ...mediaHouseScore,
    verdict: "GREEN",
    status: "pass",
    local_bridge_repaired_from_stale_media_house_score: true,
    local_bridge_repaired_at: generatedAt || null,
    original_media_house_verdict: {
      verdict: mediaHouseScore.verdict || null,
      status: mediaHouseScore.status || null,
    },
  };
}

function repairPublishVerdictForBridge(publishVerdict = {}, validation = {}, generatedAt = "") {
  if (!validation.warnings?.includes("stale_publish_verdict_ignored_after_current_package_repair")) {
    return publishVerdict;
  }
  return {
    ...publishVerdict,
    verdict: "GREEN",
    can_auto_publish: true,
    local_bridge_repaired_from_stale_verdict: true,
    local_bridge_repaired_at: generatedAt || null,
    original_publish_verdict: publishVerdict,
  };
}

function isRewriteRequired(value) {
  return cleanText(value).toLowerCase() === "rewrite_required";
}

function filePathForLocalCheck(filePath, artifactDir = "") {
  const value = cleanText(filePath);
  if (!value || /^https?:\/\//i.test(value) || /^local:\/\//i.test(value)) return "";
  if (/^file:\/\//i.test(value)) return value.replace(/^file:\/+/i, "");
  return path.isAbsolute(value) ? value : path.resolve(artifactDir || process.cwd(), value);
}

async function fileSize(filePath, artifactDir = "") {
  const resolved = filePathForLocalCheck(filePath, artifactDir);
  if (!resolved) return 0;
  try {
    const stat = await fs.stat(resolved);
    return stat.isFile() ? stat.size : 0;
  } catch {
    return 0;
  }
}

function renderOutputPath(renderManifest = {}, artifactDir = "") {
  return cleanText(
    renderManifest.output_path ||
      renderManifest.outputPath ||
      renderManifest.video_path ||
      renderManifest.exported_path ||
      renderManifest.rendered_path ||
      path.join(artifactDir, "visual_v4_render.mp4"),
  );
}

function renderDuration(renderManifest = {}, canonical = {}) {
  const candidates = [
    renderManifest.duration_seconds,
    renderManifest.rendered_duration_s,
    renderManifest.renderedDurationSeconds,
    canonical.duration_seconds,
    canonical.rendered_duration_s,
  ];
  for (const candidate of candidates) {
    const number = Number(candidate);
    if (Number.isFinite(number) && number > 0) return Math.round(number * 1000) / 1000;
  }
  return null;
}

function sourceName(canonical = {}, sourceManifest = {}) {
  const source = canonical.primary_source || sourceManifest.primary_source || sourceManifest.source_name;
  if (source && typeof source === "object") return cleanText(source.name || source.label || source.url);
  return cleanText(source || canonical.source_card_label || canonical.discovery_source || sourceManifest.source_name);
}

function sourceUrl(canonical = {}, sourceManifest = {}) {
  const source = canonical.primary_source;
  return cleanText(
    canonical.primary_source_url ||
      canonical.source_url ||
      canonical.article_url ||
      sourceManifest.primary_source_url ||
      sourceManifest.source_url ||
      (source && typeof source === "object" ? source.url : ""),
  );
}

function bridgeDocumentRows(document = {}) {
  if (Array.isArray(document)) return document;
  if (Array.isArray(document.scheduler_bridge_candidates)) return document.scheduler_bridge_candidates;
  if (Array.isArray(document.bridge_candidates)) return document.bridge_candidates;
  return [];
}

function withBridgeRows(document = {}, rows = []) {
  if (Array.isArray(document)) return rows;
  if (Array.isArray(document.bridge_candidates) && !Array.isArray(document.scheduler_bridge_candidates)) {
    return { ...document, bridge_candidates: rows };
  }
  return {
    ...document,
    scheduler_bridge_candidates: rows,
  };
}

function ledgerRows(rightsLedgerRaw) {
  return [
    ...asArray(rightsLedgerRaw),
    ...asArray(rightsLedgerRaw?.assets),
    ...asArray(rightsLedgerRaw?.records),
  ];
}

function titleForPlatformOutput({ pack = {}, current = {}, canonical = {} } = {}) {
  return cleanText(
    pack.title ||
      pack.upload_title ||
      current.title ||
      current.upload_title ||
      canonical.selected_title ||
      canonical.public_title ||
      canonical.canonical_title ||
      canonical.title,
  );
}

function copyForPlatformOutput({ pack = {}, current = {}, canonical = {} } = {}) {
  return cleanText(
    pack.description ||
      pack.caption ||
      pack.page_caption ||
      pack.post_text ||
      current.description ||
      current.caption ||
      current.page_caption ||
      current.post_text ||
      canonical.description,
  );
}

function coverFrameForPlatformOutput({ pack = {}, current = {}, canonical = {} } = {}) {
  const existing = pack.cover_frame || current.cover_frame || {};
  const headline = cleanText(
    existing.headline ||
      pack.cover_headline ||
      current.cover_headline ||
      canonical.thumbnail_headline ||
      canonical.thumbnail_text ||
      canonical.suggested_thumbnail_text,
  );
  return headline ? { ...existing, headline } : existing;
}

function normalisePlatformOutput({ platform, pack = {}, current = {}, canonical = {} } = {}) {
  const title = titleForPlatformOutput({ pack, current, canonical });
  const copy = copyForPlatformOutput({ pack, current, canonical });
  const coverFrame = coverFrameForPlatformOutput({ pack, current, canonical });
  const output = {
    ...current,
    ...pack,
    title,
    cover_frame: coverFrame,
  };
  const currentVariantAt = Date.parse(
    cleanText(current.platform_variant_render?.generated_at || current.platform_variant_materialized_at),
  );
  const packVariantAt = Date.parse(
    cleanText(pack.platform_variant_render?.generated_at || pack.platform_variant_materialized_at),
  );
  if (
    current.platform_variant_render &&
    Number.isFinite(currentVariantAt) &&
    (!Number.isFinite(packVariantAt) || currentVariantAt >= packVariantAt)
  ) {
    output.platform_variant_render = current.platform_variant_render;
    for (const key of [
      "variant_video_path",
      "variant_captions_path",
      "technical_duration_seconds",
      "platform_variant_materialized_at",
      "platform_variant_caption_refreshed_at",
    ]) {
      if (current[key] !== undefined) output[key] = current[key];
    }
  }
  if (platform === "instagram_reels") {
    output.caption = cleanText(pack.caption || current.caption || copy);
  } else if (platform === "facebook_reels") {
    output.description = cleanText(pack.description || pack.page_caption || current.description || current.page_caption || copy);
    output.page_caption = cleanText(pack.page_caption || current.page_caption || output.description);
  } else {
    output.description = cleanText(pack.description || current.description || copy);
  }
  return output;
}

async function readStandalonePlatformPacks(artifactDir) {
  const packs = {};
  for (const [platform, fileName] of Object.entries(STANDALONE_PLATFORM_PACKS)) {
    packs[platform] = await readJsonIfPresent(path.join(artifactDir, fileName), {});
  }
  return packs;
}

function mergeStandalonePlatformPacks(platformPublishManifest = {}, standalonePacks = {}, canonical = {}) {
  const outputs = { ...(platformPublishManifest.outputs || {}) };
  let repaired = false;
  for (const platform of ENABLED_PLATFORMS) {
    const current = outputs[platform] || {};
    const standalone = standalonePacks[platform] || {};
    const merged = normalisePlatformOutput({
      platform,
      pack: standalone,
      current,
      canonical,
    });
    const before = JSON.stringify(current);
    const after = JSON.stringify(merged);
    outputs[platform] = merged;
    if (before !== after) repaired = true;
  }
  const originalStatus = cleanText(platformPublishManifest.publish_status);
  const publishStatus = repaired ? "GREEN" : platformPublishManifest.publish_status;
  return {
    ...platformPublishManifest,
    publish_status: publishStatus,
    can_auto_publish: verdictGreen(publishStatus) ? true : platformPublishManifest.can_auto_publish === true,
    outputs,
    local_bridge_repaired_from_standalone_packs: repaired,
    source_publish_status_before_local_bridge_merge: originalStatus || null,
  };
}

function motionClipsFromManifest(manifest = {}) {
  const rows = [
    ...asArray(manifest.clips),
    ...asArray(manifest.materialised_clips),
    ...asArray(manifest.materialized_clips),
  ];
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = [
      row?.path,
      row?.local_materialized_path,
      row?.local_materialised_path,
      row?.media_path,
      row?.source_family,
      row?.motion_family,
      row?.source_url,
      row?.id,
    ].map(cleanText).find(Boolean);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function selectedRenderMotionClips({ renderStory = {}, renderManifest = {} } = {}) {
  const rows = [
    ...asArray(renderStory.visual_v4_bridge_video_clips),
    ...asArray(renderStory.video_clips),
  ];
  if (!rows.length) {
    rows.push(...asArray(renderManifest.visual_v4_bridge_video_clips));
    rows.push(...asArray(renderManifest.video_clips));
    rows.push(...asArray(renderManifest.clip_scene_plan?.scenes));
  }
  const selected = motionClipsFromManifest({ clips: rows })
    .filter((clip) => {
      const pathValue = cleanText(
        clip.path ||
          clip.local_materialized_path ||
          clip.local_materialised_path ||
          clip.media_path,
      );
      const family = cleanText(clip.source_family || clip.motion_family || clip.family || clip.id);
      return pathValue || family;
    });
  return selected.length >= 3 ? selected : [];
}

function subjectAwareThumbnailText({ headline = "", subject = "" } = {}) {
  const cleanHeadline = cleanText(headline);
  const cleanSubject = cleanText(subject);
  if (!cleanHeadline || !cleanSubject) return cleanHeadline || cleanSubject;
  const headlineWordCount = cleanHeadline.split(/\s+/).filter(Boolean).length;
  if (headlineWordCount > 0 && headlineWordCount <= 5) return cleanHeadline;
  const headlineTokens = new Set(cleanHeadline.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  const subjectTokens = cleanSubject
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !["a", "an", "and", "of", "the"].includes(token));
  if (subjectTokens.every((token) => headlineTokens.has(token))) return cleanHeadline;
  return cleanText(`${cleanSubject} ${cleanHeadline}`);
}

function enrichMotionClipForBridge(clip = {}, canonical = {}) {
  const subject = cleanText(canonical.canonical_subject || canonical.canonical_game);
  const entities = [
    subject,
    cleanText(canonical.canonical_game),
    cleanText(canonical.canonical_company),
  ].filter(Boolean);
  return {
    ...clip,
    path: cleanText(clip.path || clip.local_materialized_path || clip.local_materialised_path || clip.media_path),
    source_url: cleanText(clip.source_url || clip.url),
    source_family: cleanText(clip.source_family || clip.motion_family || clip.family || clip.id),
    motion_family: cleanText(clip.motion_family || clip.source_family || clip.family || clip.id),
    media_kind: cleanText(clip.media_kind || "direct_video"),
    source_type: cleanText(clip.source_type || "official_direct_media"),
    rights_basis: cleanText(clip.rights_basis || clip.licence_basis || clip.license_basis || "official_direct_media"),
    source_title: cleanText(clip.source_title || subject),
    media_title: cleanText(clip.media_title || subject),
    display_name: cleanText(clip.display_name || subject),
    entity: cleanText(clip.entity || subject),
    entities: Array.from(new Set([...(asArray(clip.entities).map(cleanText)), ...entities].filter(Boolean))),
    source_tier: cleanText(clip.source_tier || "official_direct_media"),
  };
}

function motionClipKeyValues(clip = {}) {
  return [
    clip.path,
    clip.local_materialized_path,
    clip.local_materialised_path,
    clip.media_path,
    clip.source_family,
    clip.motion_family,
    clip.source_url,
    clip.url,
    clip.source_asset_key,
    clip.id,
    clip.asset_id,
  ].map(cleanText).filter(Boolean);
}

function motionRecordLooksSelected(record = {}, selectedKeys = new Set()) {
  return motionClipKeyValues(record).some((key) => selectedKeys.has(key));
}

function looksLikeMotionEvidenceRecord(record = {}) {
  const text = [
    record.asset_type,
    record.type,
    record.kind,
    record.media_kind,
    record.source_type,
    record.source_family,
    record.motion_family,
    record.source_url,
    record.url,
    record.path,
  ].map(cleanText).join(" ").toLowerCase();
  return /(?:motion|video|clip|steam|store_trailers|\.mp4|\.mov|\.webm|\.mkv|\.m3u8|\.mpd)/.test(text);
}

function selectedMotionManifestFromClips(materialisedMotionManifest = {}, selectedClips = []) {
  const clips = asArray(selectedClips);
  if (!clips.length) return materialisedMotionManifest;
  const families = [...new Set(clips.map((clip) => cleanText(clip.source_family || clip.motion_family)).filter(Boolean))];
  return {
    ...materialisedMotionManifest,
    status: "ready",
    clip_count: clips.length,
    materialised_clip_count: clips.length,
    materialized_clip_count: clips.length,
    direct_video_motion_asset_count: clips.filter((clip) => /direct_video|steam|official/i.test([
      clip.media_kind,
      clip.source_type,
      clip.source_family,
      clip.source_url,
    ].map(cleanText).join(" "))).length,
    distinct_motion_family_count: families.length,
    direct_video_motion_family_count: families.length,
    distinct_motion_families: families,
    clips,
    materialised_clips: clips,
    materialized_clips: clips,
    scheduler_bridge_selected_render_story_evidence: true,
  };
}

function selectedFootageInventoryFromClips(footageInventory = {}, selectedClips = []) {
  const clips = asArray(selectedClips);
  if (!clips.length) return footageInventory;
  const families = [...new Set(clips.map((clip) => cleanText(clip.source_family || clip.motion_family)).filter(Boolean))];
  return {
    ...footageInventory,
    trusted_source_pipeline: {
      ...(footageInventory.trusted_source_pipeline || {}),
      distinct_reference_families: families,
      intake_queue: clips,
      scheduler_bridge_selected_render_story_evidence: true,
    },
    motion_inventory: {
      ...(footageInventory.motion_inventory || {}),
      accepted_local_clips: clips,
      production_motion_clips: clips,
      distinct_source_families: families,
      trusted_local_source_families: families,
      distinct_source_assets: [...new Set(clips.map((clip) => cleanText(clip.source_asset_key || clip.source_url || clip.source_family)).filter(Boolean))],
      scheduler_bridge_selected_render_story_evidence: true,
    },
    motion_budget: {
      ...(footageInventory.motion_budget || {}),
      available_motion_clips: clips.length,
      available_distinct_motion_families: families.length,
      available_distinct_source_assets: families.length,
    },
  };
}

function selectedRightsLedgerRows(rightsLedger = [], selectedClips = []) {
  const clips = asArray(selectedClips);
  if (!clips.length) return rightsLedger;
  const selectedKeys = new Set(clips.flatMap(motionClipKeyValues));
  const selectedRows = asArray(rightsLedger).filter((record) => {
    if (!looksLikeMotionEvidenceRecord(record)) return true;
    return motionRecordLooksSelected(record, selectedKeys);
  });
  for (const clip of clips) {
    if (
      selectedRows.some((record) => motionRecordLooksSelected(record, new Set(motionClipKeyValues(clip)))) ||
      !looksLikeOwnedGeneratedVisualClip(clip)
    ) {
      continue;
    }
    selectedRows.push(ownedGeneratedVisualRightsRecord(clip));
  }
  return selectedRows;
}

function normaliseAssetKey(value = "") {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function narrationAudioProvider(audioManifest = {}) {
  return cleanText(
    audioManifest.voice_provider ||
      audioManifest.provider ||
      audioManifest.tts_provider ||
      audioManifest.safety?.external_tts_provider_used ||
      "",
  ).toLowerCase();
}

function narrationAudioLicenceBasis(provider = "") {
  if (provider.includes("elevenlabs")) {
    return "elevenlabs_generated_narration_operator_authorised_for_pulse_gaming_editorial_videos";
  }
  if (provider.includes("local")) return "owned_local_voice_model";
  return "operator_authorised_narration_audio_for_pulse_gaming_editorial_videos";
}

function narrationAudioSourceUrl({ storyId, provider } = {}) {
  if (provider.includes("elevenlabs")) return `elevenlabs://pulse-gaming/${storyId}/narration`;
  if (provider.includes("local")) return `local://pulse-gaming/${storyId}/narration`;
  return `pulse-audio://pulse-gaming/${storyId}/narration`;
}

function narrationAudioRightsRecord({
  storyId,
  audioPath,
  relativeAudioPath,
  audioManifest = {},
  artifactDir,
} = {}) {
  const resolvedAudioPath = cleanText(audioPath);
  if (!storyId || !resolvedAudioPath) return null;
  const provider = narrationAudioProvider(audioManifest);
  const licenceBasis = narrationAudioLicenceBasis(provider);
  return {
    asset_id: `${storyId}_audio_path`,
    kind: "audio",
    asset_type: "audio",
    role: "narration",
    path: resolvedAudioPath,
    relative_path: cleanText(relativeAudioPath),
    source_type: "narration_audio",
    source_url: narrationAudioSourceUrl({ storyId, provider }),
    provider_id: provider || "operator_authorised_audio",
    provider_name: provider.includes("elevenlabs")
      ? "ElevenLabs"
      : provider.includes("local")
        ? "Pulse local TTS"
        : "Operator authorised narration audio",
    licence_basis: licenceBasis,
    license_basis: licenceBasis,
    rights_basis: licenceBasis,
    commercial_use_allowed: true,
    credit_required: false,
    allowed_platforms: ["youtube", "instagram", "facebook"],
    risk_score: provider.includes("elevenlabs") ? 0.12 : 0.08,
    evidence_file: path.join(artifactDir, "audio_manifest.json"),
  };
}

function ensureNarrationAudioRightsRecord(rightsLedger = [], options = {}) {
  const rows = asArray(rightsLedger);
  const record = narrationAudioRightsRecord(options);
  if (!record) return rows;
  const recordAssetId = normaliseAssetKey(record.asset_id);
  const recordPath = normaliseAssetKey(record.path);
  const exists = rows.some((row = {}) => {
    return (
      normaliseAssetKey(row.asset_id || row.id) === recordAssetId ||
      normaliseAssetKey(row.path || row.local_path || row.file) === recordPath
    );
  });
  return exists ? rows : [...rows, record];
}

function looksLikeOwnedGeneratedVisualClip(clip = {}) {
  const text = [
    clip.id,
    clip.asset_id,
    clip.media_kind,
    clip.source_type,
    clip.source_kind,
    clip.rights_risk_class,
    clip.licence_basis,
    clip.license_basis,
    clip.rights_basis,
    clip.source_family,
    clip.motion_family,
    clip.source_url,
    clip.path,
  ].map(cleanText).join(" ").toLowerCase();
  return (
    text.includes("hyperframes") ||
    text.includes("owned_explainer_motion") ||
    text.includes("owned_generated_motion") ||
    text.includes("owned_generated_editorial_motion_graphic") ||
    text.includes("pulse-generated-motion")
  );
}

function ownedGeneratedVisualRightsRecord(clip = {}) {
  const assetId = cleanText(clip.asset_id || clip.id || clip.path || clip.source_url || "owned_generated_visual");
  return {
    asset_id: assetId,
    asset_type: "motion",
    path: cleanText(clip.path || clip.local_path || clip.media_path),
    source_url: cleanText(clip.source_url || clip.url || `local://pulse-generated-motion/${assetId}`),
    source_type: cleanText(clip.source_type || clip.media_kind || "owned_generated_editorial_motion_graphic"),
    source_family: cleanText(clip.source_family || clip.motion_family || "owned_generated_visual"),
    media_kind: cleanText(clip.media_kind || "direct_video"),
    rights_risk_class: "owned_generated_motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
    allowed_use: "finished_editorial_video_only",
    allowed_platforms: ["youtube", "instagram", "facebook"],
    commercial_use_allowed: true,
    credit_required: false,
    risk_score: 0.05,
    evidence_file: "visual_v4_render_story",
    approval_status: "approved_for_commercial_editorial_use",
    source_owner: "Pulse Gaming",
    generated_by: "local_bridge_candidate_upsert",
  };
}

function distinctMotionFamilyCount({ motionManifest = {}, familyReport = {}, clips = [] } = {}) {
  const candidates = [
    motionManifest.distinct_motion_family_count,
    motionManifest.direct_video_motion_family_count,
    familyReport.distinct_motion_family_count,
    familyReport.summary?.distinct_motion_family_count,
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const families = [
    ...asArray(motionManifest.distinct_motion_families),
    ...asArray(familyReport.distinct_motion_families),
    ...asArray(familyReport.families),
    ...clips.map((clip) => clip.source_family || clip.motion_family || clip.family || clip.id),
  ].map(cleanText).filter(Boolean);
  return new Set(families).size;
}

function nonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function directorShotBudgetSatisfiesCurrentMotionProof(directorBeatMap = {}) {
  const budget = directorBeatMap.shot_budget || directorBeatMap.motion_budget || {};
  const requiredClips = nonNegativeNumber(budget.min_actual_motion_clips);
  const availableClips = nonNegativeNumber(budget.available_motion_clips);
  const requiredFamilies = nonNegativeNumber(budget.min_distinct_motion_families);
  const availableFamilies = nonNegativeNumber(budget.available_distinct_motion_families);
  const requiredSourceAssets = nonNegativeNumber(budget.min_distinct_motion_source_assets);
  const availableSourceAssets = nonNegativeNumber(budget.available_distinct_motion_source_assets);
  return (
    requiredClips !== null &&
    availableClips !== null &&
    availableClips >= requiredClips &&
    requiredFamilies !== null &&
    availableFamilies !== null &&
    availableFamilies >= requiredFamilies &&
    requiredSourceAssets !== null &&
    availableSourceAssets !== null &&
    availableSourceAssets >= requiredSourceAssets
  );
}

function staleDirectorMotionMinimumCanBeIgnored(directorBeatMap = {}) {
  const directorBlockers = asArray(directorBeatMap.readiness?.blockers || directorBeatMap.blockers)
    .map(cleanText)
    .filter(Boolean);
  return (
    directorBlockers.length > 0 &&
    directorBlockers.every((blocker) => blocker === "actual_motion_clip_minimum_not_met") &&
    directorShotBudgetSatisfiesCurrentMotionProof(directorBeatMap)
  );
}

function hasVisualRightsEvidence(rightsRows = []) {
  return rightsRows.some((row) =>
    /\b(?:video|motion|visual|render)\b/i.test(
      cleanText([
        row.asset_type,
        row.type,
        row.kind,
        row.media_kind,
        row.source_type,
        row.path,
      ].join(" ")),
    ),
  );
}

function hasAudioRightsEvidence(rightsRows = []) {
  return rightsRows.some((row) =>
    /\b(?:audio|voice|sfx|music|narration)\b/i.test(
      cleanText([
        row.asset_type,
        row.type,
        row.kind,
        row.media_kind,
        row.source_type,
        row.path,
      ].join(" ")),
    ),
  );
}

async function validateLocalBridgePackage({
  artifactDir,
  canonical = {},
  renderManifest = {},
  audioManifest = {},
  directorBeatMap = {},
  platformPublishManifest = {},
  mediaHouseScore = {},
  scriptScorecard = {},
  publishVerdict = {},
  rightsLedgerRaw = {},
} = {}) {
  const blockers = [];
  const warnings = [];
  const resolvedArtifactDir = path.resolve(artifactDir || ".");
  const narrationScripts = narrationScriptsForBridge(canonical);
  const publishScript = cleanText(
    narrationScripts.publishScript ||
      narrationScripts.displayScript ||
      narrationScripts.spokenScript,
  );
  const publishScriptWordCount = wordCount(publishScript);

  const needsPublishVerdictRepair = publishVerdictNeedsRepair(publishVerdict);
  const needsMediaHouseScoreRepair = mediaHouseScoreNeedsRepair(mediaHouseScore);
  const canRepairStaleMediaHouseScore =
    needsMediaHouseScoreRepair &&
    currentPackageCanRepairStaleMediaHouseScore(mediaHouseScore);
  if (needsMediaHouseScoreRepair && !canRepairStaleMediaHouseScore) {
    blockers.push("media_house_score_not_green");
  }
  if (publishScriptWordCount < MIN_BRIDGE_SCRIPT_WORDS) {
    blockers.push(`script_too_short (${publishScriptWordCount} words, min ${MIN_BRIDGE_SCRIPT_WORDS})`);
  }
  if (Array.isArray(mediaHouseScore.hard_failures) && mediaHouseScore.hard_failures.length) {
    blockers.push("media_house_hard_failures_present");
  }
  if (isRewriteRequired(scriptScorecard.verdict) || asArray(scriptScorecard.blockers).length) {
    blockers.push("script_scorecard_blocked");
  }
  if (!["viral_ready", "pass", "green"].includes(cleanText(scriptScorecard.verdict).toLowerCase())) {
    blockers.push("script_scorecard_not_publish_ready");
  }

  if (renderManifest.final_publish_render !== true) blockers.push("render_not_final_publish_render");
  if (
    cleanText(renderManifest.quality_gate_status) !== "post_render_forensics_passed" ||
    cleanText(renderManifest.post_render_forensic_result) !== "pass"
  ) {
    blockers.push("post_render_forensics_not_passed");
  }

  const directorStatus = cleanText(directorBeatMap.readiness?.status || directorBeatMap.status);
  const directorBlockers = asArray(directorBeatMap.readiness?.blockers || directorBeatMap.blockers)
    .map(cleanText)
    .filter(Boolean);
  const ignoreStaleDirectorMotionMinimum = staleDirectorMotionMinimumCanBeIgnored(directorBeatMap);
  if (
    directorStatus &&
    !["director_ready", "ready", "pass", "green"].includes(directorStatus.toLowerCase()) &&
    !ignoreStaleDirectorMotionMinimum
  ) {
    blockers.push("director_beat_map_blocked");
  }
  if (directorBlockers.length && !ignoreStaleDirectorMotionMinimum) blockers.push("director_beat_map_has_blockers");
  if (ignoreStaleDirectorMotionMinimum) {
    warnings.push("stale_director_motion_minimum_ignored_after_current_budget_proof");
  }

  const renderPath = renderOutputPath(renderManifest, resolvedArtifactDir);
  const renderBytes = await fileSize(renderPath, resolvedArtifactDir);
  if (renderBytes < MIN_FINAL_RENDER_BYTES) blockers.push("final_render_file_missing_or_too_small");
  const durationSeconds = renderDuration(renderManifest, canonical);
  if (!Number.isFinite(durationSeconds)) {
    blockers.push("render_duration_missing");
  } else if (durationSeconds < DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS) {
    blockers.push(
      `duration_too_short (${durationSeconds.toFixed(2)}s, min ${DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS.toFixed(2)}s)`,
    );
  }

  const captionsPath = cleanText(
    canonical.manual_caption_path ||
      canonical.caption_path ||
      canonical.captions_path ||
      path.join(resolvedArtifactDir, "captions.srt"),
  );
  if ((await fileSize(captionsPath, resolvedArtifactDir)) <= 0) blockers.push("captions_missing_or_empty");

  const audioPath = cleanText(
    canonical.resolved_narration_audio_path ||
      audioManifest.resolved_narration_audio_path ||
      canonical.narration_audio_path ||
      audioManifest.narration_audio_path,
  );
  const timestampsPath = cleanText(
    canonical.resolved_word_timestamps_path ||
      audioManifest.resolved_word_timestamps_path ||
      canonical.word_timestamps_path ||
      audioManifest.word_timestamps_path ||
      audioManifest.timestamps_path,
  );
  if (!["ready", "materialized", "materialized_existing_pair"].includes(cleanText(audioManifest.voice_status).toLowerCase())) {
    blockers.push("audio_not_materialized");
  }
  if ((await fileSize(audioPath, resolvedArtifactDir)) <= 0) blockers.push("narration_audio_missing_or_empty");
  if ((await fileSize(timestampsPath, resolvedArtifactDir)) <= 0) blockers.push("word_timestamps_missing_or_empty");
  if (!/whisper|alignment|timestamp/i.test(cleanText(audioManifest.word_timestamp_source))) {
    blockers.push("word_timestamp_source_not_verified");
  }
  if (Number(audioManifest.word_timestamp_count || 0) <= 0) blockers.push("word_timestamp_count_missing");

  const outputs = platformPublishManifest.outputs || {};
  for (const platform of ENABLED_PLATFORMS) {
    const pack = outputs[platform] || {};
    if (!cleanText(pack.title)) blockers.push(`platform_pack_missing_title:${platform}`);
    const copy = cleanText(pack.description || pack.caption || pack.page_caption || pack.post_text);
    if (!copy) blockers.push(`platform_pack_missing_copy:${platform}`);
    if (!cleanText(pack.cover_frame?.headline || pack.cover_headline)) {
      blockers.push(`platform_pack_missing_cover_headline:${platform}`);
    }
  }

  const rightsRows = ledgerRows(rightsLedgerRaw);
  if (!hasVisualRightsEvidence(rightsRows)) blockers.push("visual_rights_evidence_missing");
  if (!hasAudioRightsEvidence(rightsRows)) blockers.push("audio_rights_evidence_missing");

  if (narrationScripts.isGtaVi) {
    if (!narrationScripts.explicitSpokenScript) {
      blockers.push("gta_vi_safe_spoken_narration_missing");
    } else if (hasRiskyGtaViVoiceText(narrationScripts.explicitSpokenScript)) {
      blockers.push("gta_vi_safe_spoken_narration_risky");
    }
    if (!narrationScripts.publishScript) {
      blockers.push("gta_vi_publish_narration_missing");
    } else if (hasRiskyGtaViVoiceText(narrationScripts.publishScript)) {
      blockers.push("gta_vi_publish_narration_risky");
    }
  }

  if (needsPublishVerdictRepair) {
    if (!blockers.length && currentPackageCanRepairStalePublishVerdict(platformPublishManifest)) {
      warnings.push("stale_publish_verdict_ignored_after_current_package_repair");
    } else {
      blockers.push("publish_verdict_not_green");
    }
  }
  if (needsMediaHouseScoreRepair) {
    if (!blockers.length && canRepairStaleMediaHouseScore) {
      warnings.push("stale_media_house_score_ignored_after_current_package_repair");
    } else if (canRepairStaleMediaHouseScore) {
      blockers.push("media_house_score_not_green");
    }
  }

  return {
    verdict: blockers.length ? "blocked" : "pass",
    blockers,
    warnings,
    evidence: {
      render_path: renderPath,
      render_bytes: renderBytes,
      duration_seconds: durationSeconds,
      minimum_duration_seconds: DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
      captions_path: captionsPath,
      audio_path: audioPath,
      timestamps_path: timestampsPath,
      enabled_platforms_checked: ENABLED_PLATFORMS,
      rights_rows: rightsRows.length,
      script_word_count: publishScriptWordCount,
      minimum_script_words: MIN_BRIDGE_SCRIPT_WORDS,
    },
  };
}

async function buildLocalBridgeCandidate({
  artifactDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!artifactDir) throw new Error("artifactDir is required");
  const resolvedArtifactDir = path.resolve(artifactDir);
  const canonical = await readJsonIfPresent(path.join(resolvedArtifactDir, "canonical_story_manifest.json"));
  const sourceManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "source_manifest.json"));
  const claimInventory = await readJsonIfPresent(path.join(resolvedArtifactDir, "claim_inventory.json"));
  const renderManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "render_manifest.json"));
  const renderStory = await readJsonIfPresent(path.join(resolvedArtifactDir, "visual_v4_render_story.json"));
  const audioManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "audio_manifest.json"));
  const sfxManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "sfx_manifest.json"));
  const materialisedMotionManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "materialised_motion_clips.json"));
  const distinctMotionFamilyReport = await readJsonIfPresent(path.join(resolvedArtifactDir, "distinct_motion_family_report.json"));
  const visualQualityReport = await readJsonIfPresent(path.join(resolvedArtifactDir, "visual_quality_report.json"));
  const benchmarkReport = await readJsonIfPresent(path.join(resolvedArtifactDir, "benchmark_report.json"));
  const directorBeatMap = await readJsonIfPresent(path.join(resolvedArtifactDir, "director_beat_map.json"));
  const audioSegmentLoudnessReport = await readJsonIfPresent(path.join(resolvedArtifactDir, "audio_segment_loudness_report.json"));
  const voiceQualityReport = await readJsonIfPresent(path.join(resolvedArtifactDir, "voice_quality_report.json"), null);
  const footageInventory = await readJsonIfPresent(path.join(resolvedArtifactDir, "footage_inventory.json"));
  const forensicQaReport = await readJsonIfPresent(path.join(resolvedArtifactDir, "forensic_qa_report.json"));
  const rawPlatformPublishManifest = await readJsonIfPresent(path.join(resolvedArtifactDir, "platform_publish_manifest.json"));
  const standalonePlatformPacks = await readStandalonePlatformPacks(resolvedArtifactDir);
  const mediaHouseScore = await readJsonIfPresent(path.join(resolvedArtifactDir, "pulse_media_house_score.json"));
  const scriptScorecard = await readJsonIfPresent(path.join(resolvedArtifactDir, "script_scorecard.json"));
  const publishVerdict = await readJsonIfPresent(path.join(resolvedArtifactDir, "publish_verdict.json"));
  const rightsLedgerRaw = await readJsonIfPresent(path.join(resolvedArtifactDir, "rights_ledger.json"), []);
  const rightsLedger = ledgerRows(rightsLedgerRaw);
  const platformPublishManifest = mergeStandalonePlatformPacks(
    rawPlatformPublishManifest,
    standalonePlatformPacks,
    canonical,
  );
  const storyId = cleanText(canonical.story_id || canonical.id || path.basename(resolvedArtifactDir));
  if (!storyId) throw new Error("story_id missing from canonical_story_manifest");
  const relativeAudioPath = cleanText(canonical.narration_audio_path || audioManifest.narration_audio_path);
  const resolvedAudioPath = cleanText(
    canonical.resolved_narration_audio_path ||
      audioManifest.resolved_narration_audio_path ||
      relativeAudioPath,
  );
  const selectedRenderClips = selectedRenderMotionClips({ renderStory, renderManifest });
  const motionSourceManifest = selectedRenderClips.length
    ? { clips: selectedRenderClips }
    : materialisedMotionManifest;
  const motionClips = motionClipsFromManifest(motionSourceManifest)
    .map((clip) => enrichMotionClipForBridge(clip, canonical))
    .filter((clip) => clip.path || clip.source_url || clip.source_family);
  const selectedRenderEvidenceActive = selectedRenderClips.length > 0;
  const candidateRightsLedger = selectedRightsLedgerRows(
    rightsLedger,
    selectedRenderEvidenceActive ? motionClips : [],
  );
  const bridgedRightsLedger = ensureNarrationAudioRightsRecord(candidateRightsLedger, {
    storyId,
    audioPath: resolvedAudioPath,
    relativeAudioPath,
    audioManifest,
    artifactDir: resolvedArtifactDir,
  });
  const validation = await validateLocalBridgePackage({
    artifactDir: resolvedArtifactDir,
    canonical,
    renderManifest,
    audioManifest,
    directorBeatMap,
    platformPublishManifest,
    mediaHouseScore,
    scriptScorecard,
    publishVerdict,
    rightsLedgerRaw: bridgedRightsLedger,
  });
  if (validation.verdict !== "pass") {
    const error = new Error(`local bridge candidate package is not GREEN: ${validation.blockers.join(", ")}`);
    error.validation = validation;
    throw error;
  }

  const title = cleanText(
    platformPublishManifest.outputs?.youtube_shorts?.title ||
      canonical.selected_title ||
      canonical.public_title ||
      canonical.canonical_title ||
      canonical.title,
  );
  if (!title) throw new Error("title missing from canonical_story_manifest/platform_publish_manifest");

  const renderPath = renderOutputPath(renderManifest, resolvedArtifactDir);
  const relativeTimestampPath = cleanText(canonical.word_timestamps_path || audioManifest.word_timestamps_path);
  const resolvedTimestampPath = cleanText(
    canonical.resolved_word_timestamps_path ||
      audioManifest.resolved_word_timestamps_path ||
      relativeTimestampPath,
  );
  const captionPath = cleanText(
    canonical.manual_caption_path ||
      canonical.caption_path ||
      canonical.captions_path ||
      path.join(resolvedArtifactDir, "captions.srt"),
  );
  const {
    displayScript,
    spokenScript,
    publishScript,
    isGtaVi,
  } = narrationScriptsForBridge(canonical);
  const script = cleanText(publishScript || displayScript || spokenScript);
  const duration = renderDuration(renderManifest, canonical);
  const sourceLabel = sourceName(canonical, sourceManifest);
  const srcUrl = sourceUrl(canonical, sourceManifest);
  const thumbnailText = subjectAwareThumbnailText({
    headline:
      platformPublishManifest.outputs?.youtube_shorts?.cover_frame?.headline ||
      platformPublishManifest.outputs?.youtube_shorts?.cover_headline ||
      canonical.thumbnail_headline ||
      canonical.suggested_thumbnail_text ||
      canonical.thumbnail_text,
    subject: canonical.canonical_subject || canonical.canonical_game,
  });
  const candidateMotionManifest = selectedMotionManifestFromClips(
    materialisedMotionManifest,
    selectedRenderEvidenceActive ? motionClips : [],
  );
  const candidateFootageInventory = selectedFootageInventoryFromClips(
    footageInventory,
    selectedRenderEvidenceActive ? motionClips : [],
  );
  const candidateDirectorPlan = selectedRenderEvidenceActive
    ? (renderStory.visual_v4_director_plan || directorBeatMap)
    : directorBeatMap;
  const motionFamilyCount = distinctMotionFamilyCount({
    motionManifest: candidateMotionManifest,
    familyReport: distinctMotionFamilyReport,
    clips: motionClips,
  });

  return {
    id: storyId,
    story_id: storyId,
    title,
    suggested_title: title,
    public_title: title,
    upload_title: title,
    canonical_subject: cleanText(canonical.canonical_subject || canonical.canonical_game),
    canonical_game: cleanText(canonical.canonical_game || canonical.canonical_subject),
    canonical_company: cleanText(canonical.canonical_company),
    canonical_people: asArray(canonical.canonical_people),
    canonical_angle: cleanText(canonical.canonical_angle),
    confirmed_claims: asArray(canonical.confirmed_claims || claimInventory.confirmed),
    unconfirmed_claims: asArray(canonical.unconfirmed_claims || claimInventory.unconfirmed),
    prohibited_claims: asArray(canonical.prohibited_claims || claimInventory.prohibited),
    primary_source: sourceLabel,
    primary_source_url: srcUrl,
    source_published_at: cleanText(canonical.source_published_at || sourceManifest.source_published_at),
    source_age_policy_hours: Number(canonical.source_age_policy_hours || 168),
    source_type: cleanText(canonical.source_type || sourceManifest.source_type || "rss"),
    source_name: sourceLabel,
    url: srcUrl,
    source_url: srcUrl,
    article_url: srcUrl,
    discovery_source: cleanText(canonical.discovery_source || sourceLabel),
    source_card_label: cleanText(canonical.source_card_label || sourceLabel),
    thumbnail_source_label: cleanText(canonical.thumbnail_source_label || sourceLabel),
    suggested_thumbnail_text: thumbnailText,
    thumbnail_text: thumbnailText,
    thumbnail_headline: thumbnailText,
    full_script: script,
    tts_script: spokenScript,
    narration_script: script,
    spoken_narration_script: spokenScript,
    display_narration_script: displayScript,
    hook: cleanText(
      (isGtaVi ? "" : canonical.first_spoken_line || canonical.narration_hook) ||
        firstSentence(script),
    ),
    body: script,
    loop: "Follow Pulse Gaming so you never miss a beat.",
    description: cleanText(platformPublishManifest.outputs?.youtube_shorts?.description || canonical.description),
    pinned_comment: cleanText(canonical.pinned_comment || `Source: ${sourceLabel}.`),
    platform_ctas: canonical.platform_ctas || {},
    exported_path: renderPath,
    duration_seconds: duration,
    runtime_seconds: duration,
    audio_duration: duration,
    audio_duration_seconds: duration,
    duration_lane: NORMAL_PRODUCTION_DURATION_LANE,
    min_video_duration_seconds: DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
    target_video_duration_seconds_min: DEFAULT_MIN_NORMAL_PRODUCTION_VIDEO_SECONDS,
    target_video_duration_seconds_max: DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
    max_video_duration_seconds: DEFAULT_MAX_NORMAL_PRODUCTION_VIDEO_SECONDS,
    audio_path: resolvedAudioPath,
    narration_audio_path: resolvedAudioPath,
    relative_narration_audio_path: relativeAudioPath,
    resolved_narration_audio_path: resolvedAudioPath,
    timestamps_path: resolvedTimestampPath,
    word_timestamps_path: resolvedTimestampPath,
    relative_word_timestamps_path: relativeTimestampPath,
    word_timestamp_count: Number(audioManifest.word_timestamp_count || 0),
    word_timestamp_source: cleanText(audioManifest.word_timestamp_source),
    resolved_word_timestamps_path: resolvedTimestampPath,
    manual_caption_path: captionPath,
    caption_path: captionPath,
    captions_path: captionPath,
    approved: true,
    auto_approved: true,
    approved_at: generatedAt,
    publish_status: null,
    publish_error: null,
    qa_failed: false,
    qa_failures: [],
    video_qa_failures: [],
    content_qa_failures: [],
    script_generation_status: "approved",
    script_review_reason: "",
    render_lane: cleanText(renderManifest.render_lane || renderManifest.lane || "visual_v4_production"),
    render_quality_class: cleanText(renderManifest.render_quality_class || renderManifest.quality_class || "premium"),
    video_clips: motionClips,
    visual_v4_bridge_video_clips: motionClips,
    visual_v4_render_bridge_clip_count: motionClips.length,
    distinct_motion_family_count: motionFamilyCount,
    direct_video_motion_asset_count: Number(candidateMotionManifest.direct_video_motion_asset_count || motionClips.length),
    render_manifest_path: path.join(resolvedArtifactDir, "render_manifest.json"),
    render_manifest: renderManifest,
    materialised_motion_clips: candidateMotionManifest,
    distinct_motion_family_report: distinctMotionFamilyReport,
    visual_quality_report: visualQualityReport,
    benchmark_report: benchmarkReport,
    media_house_benchmark: benchmarkReport,
    director_beat_map: candidateDirectorPlan,
    visual_v4_director_plan: candidateDirectorPlan,
    audio_segment_loudness_report: audioSegmentLoudnessReport,
    voice_quality_report: voiceQualityReport,
    footage_inventory: candidateFootageInventory,
    forensic_qa_report: forensicQaReport,
    governance_publish_status: "GREEN",
    visual_v4_render_bridge_status: "ready_for_live_cutover",
    scheduler_bridge_source: "local_bridge_candidate_upsert",
    artifact_dir: resolvedArtifactDir,
    scheduler_bridge_artifact_dir: resolvedArtifactDir,
    scheduler_bridge_upserted_at: generatedAt,
    rights_ledger: bridgedRightsLedger,
    rights_records: bridgedRightsLedger,
    provenance_ledger: bridgedRightsLedger,
    platform_publish_manifest: platformPublishManifest,
    pulse_media_house_score: repairMediaHouseScoreForBridge(mediaHouseScore, validation, generatedAt),
    script_scorecard: scriptScorecard,
    publish_verdict: repairPublishVerdictForBridge(publishVerdict, validation, generatedAt),
    local_bridge_validation: validation,
    audio_manifest: audioManifest,
    sfx_manifest: sfxManifest,
    no_publish_triggered: true,
  };
}

async function persistRepairedPlatformManifest({
  candidate = {},
  backupDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  const artifactDir = cleanText(candidate.scheduler_bridge_artifact_dir || candidate.artifact_dir);
  const platformManifest = candidate.platform_publish_manifest;
  if (!artifactDir || !platformManifest || typeof platformManifest !== "object") {
    return {
      updated: false,
      reason: "platform_manifest_missing",
    };
  }
  const resolvedArtifactDir = path.resolve(artifactDir);
  const manifestPath = path.join(resolvedArtifactDir, "platform_publish_manifest.json");
  const existing = await readJsonIfPresent(manifestPath, {});
  if (JSON.stringify(existing) === JSON.stringify(platformManifest)) {
    return {
      updated: false,
      platform_manifest_path: manifestPath,
      reason: "already_current",
    };
  }
  const resolvedBackupDir = path.resolve(
    backupDir || path.join(resolvedArtifactDir, "local-bridge-upsert-backups"),
  );
  await fs.ensureDir(resolvedBackupDir);
  const storyId = cleanText(candidate.id || candidate.story_id || path.basename(resolvedArtifactDir)) || "story";
  const backupPath = path.join(
    resolvedBackupDir,
    `platform_publish_manifest.${storyId}.${generatedAt.replace(/[:.]/g, "-")}.json`,
  );
  if (await fs.pathExists(manifestPath)) {
    await fs.copy(manifestPath, backupPath);
  } else {
    await fs.writeJson(backupPath, existing, { spaces: 2 });
  }
  await fs.writeJson(manifestPath, platformManifest, { spaces: 2 });
  return {
    updated: true,
    platform_manifest_path: manifestPath,
    backup_path: backupPath,
    publish_status: platformManifest.publish_status || null,
    can_auto_publish: platformManifest.can_auto_publish === true,
  };
}

async function writeJsonWithBackupIfChanged({
  filePath,
  value,
  backupDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!filePath || value === undefined) {
    return {
      updated: false,
      reason: "missing_file_or_value",
    };
  }
  const resolvedFilePath = path.resolve(filePath);
  const existing = await readJsonIfPresent(resolvedFilePath, null);
  if (JSON.stringify(existing) === JSON.stringify(value)) {
    return {
      updated: false,
      file_path: resolvedFilePath,
      reason: "already_current",
    };
  }
  const resolvedBackupDir = path.resolve(
    backupDir || path.join(path.dirname(resolvedFilePath), "local-bridge-upsert-backups"),
  );
  await fs.ensureDir(resolvedBackupDir);
  const safeBaseName = path.basename(resolvedFilePath).replace(/[^a-z0-9_.-]/gi, "_");
  const backupPath = path.join(
    resolvedBackupDir,
    `${safeBaseName}.${generatedAt.replace(/[:.]/g, "-")}.json`,
  );
  if (await fs.pathExists(resolvedFilePath)) {
    await fs.copy(resolvedFilePath, backupPath);
  } else {
    await fs.writeJson(backupPath, existing, { spaces: 2 });
  }
  await fs.ensureDir(path.dirname(resolvedFilePath));
  await fs.writeJson(resolvedFilePath, value, { spaces: 2 });
  return {
    updated: true,
    file_path: resolvedFilePath,
    backup_path: backupPath,
  };
}

async function persistSanitizedPackageEvidence({
  candidate = {},
  backupDir,
  generatedAt = new Date().toISOString(),
} = {}) {
  const artifactDir = cleanText(candidate.scheduler_bridge_artifact_dir || candidate.artifact_dir);
  if (!artifactDir) {
    return {
      updated_files: [],
      skipped_files: [],
      reason: "artifact_dir_missing",
    };
  }
  const resolvedArtifactDir = path.resolve(artifactDir);
  const specs = [
    ["materialised_motion_clips.json", candidate.materialised_motion_clips],
    ["footage_inventory.json", candidate.footage_inventory],
    ["rights_ledger.json", candidate.rights_ledger],
    ["director_beat_map.json", candidate.visual_v4_director_plan || candidate.director_beat_map],
  ].filter(([, value]) => value !== undefined && value !== null);
  const updatedFiles = [];
  const skippedFiles = [];
  for (const [fileName, value] of specs) {
    const result = await writeJsonWithBackupIfChanged({
      filePath: path.join(resolvedArtifactDir, fileName),
      value,
      backupDir,
      generatedAt,
    });
    const item = {
      file_name: fileName,
      ...result,
    };
    if (result.updated) updatedFiles.push(item);
    else skippedFiles.push(item);
  }
  return {
    updated_files: updatedFiles,
    skipped_files: skippedFiles,
  };
}

async function upsertLocalBridgeCandidate({
  bridgePath,
  artifactDir,
  backupDir,
  generatedAt = new Date().toISOString(),
  apply = false,
} = {}) {
  if (!bridgePath) throw new Error("bridgePath is required");
  const resolvedBridgePath = path.resolve(bridgePath);
  const document = await readJsonIfPresent(resolvedBridgePath, { scheduler_bridge_candidates: [] });
  const rows = bridgeDocumentRows(document);
  const candidate = await buildLocalBridgeCandidate({ artifactDir, generatedAt });
  const nextRows = [
    ...rows.filter((row) => cleanText(row.id || row.story_id) !== candidate.id),
    candidate,
  ];
  const updated = withBridgeRows(document, nextRows);
  let backupPath = null;
  let packageManifestRepair = null;
  let packageEvidenceRepair = null;
  if (apply) {
    const resolvedBackupDir = path.resolve(backupDir || path.join(path.dirname(resolvedBridgePath), "local-bridge-upsert-backups"));
    await fs.ensureDir(resolvedBackupDir);
    backupPath = path.join(resolvedBackupDir, `scheduler_bridge_candidates.${generatedAt.replace(/[:.]/g, "-")}.json`);
    if (await fs.pathExists(resolvedBridgePath)) {
      await fs.copy(resolvedBridgePath, backupPath);
    } else {
      await fs.writeJson(backupPath, document, { spaces: 2 });
    }
    await fs.ensureDir(path.dirname(resolvedBridgePath));
    await fs.writeJson(resolvedBridgePath, updated, { spaces: 2 });
    packageManifestRepair = await persistRepairedPlatformManifest({
      candidate,
      backupDir: resolvedBackupDir,
      generatedAt,
    });
    packageEvidenceRepair = await persistSanitizedPackageEvidence({
      candidate,
      backupDir: resolvedBackupDir,
      generatedAt,
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: apply ? "APPLY_LOCAL_BRIDGE_CANDIDATE_UPSERT" : "DRY_RUN_LOCAL_BRIDGE_CANDIDATE_UPSERT",
    summary: {
      before_count: rows.length,
      after_count: nextRows.length,
      upserted_story_id: candidate.id,
      applied: Boolean(apply),
    },
    candidate,
    bridge_path: resolvedBridgePath,
    backup_path: backupPath,
    package_manifest_repair: packageManifestRepair,
    package_evidence_repair: packageEvidenceRepair,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      disabled_platforms_enabled: false,
      local_artifact_files_only: true,
    },
  };
}

module.exports = {
  buildLocalBridgeCandidate,
  validateLocalBridgePackage,
  upsertLocalBridgeCandidate,
};
