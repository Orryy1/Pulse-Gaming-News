"use strict";

function asArray(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function assetText(asset = {}) {
  if (typeof asset === "string") return cleanText(asset);
  return [
    asset.id,
    asset.asset_id,
    asset.path,
    asset.local_path,
    asset.file_path,
    asset.media_path,
    asset.source_url,
    asset.url,
    asset.source_type,
    asset.source_kind,
    asset.media_kind,
    asset.source_url_kind,
    asset.rights_risk_class,
    asset.licence_basis,
    asset.license_basis,
    asset.transformation_notes,
    asset.source_family,
    asset.kind,
    asset.type,
  ]
    .map(cleanText)
    .filter(Boolean)
    .join(" ");
}

function isMotionAsset(asset = {}) {
  const text = assetText(asset).toLowerCase();
  return (
    /\.(?:mp4|mov|webm|mkv)(?:$|[\s?#])/i.test(text) ||
    /\b(?:video|motion|clip|trailer|gameplay|b-roll|broll)\b|(?:^|_)motion(?:_|$)|(?:^|_)clip(?:_|$)/i.test(text)
  );
}

function isAudioOnlyAsset(asset = {}) {
  const text = assetText(asset).toLowerCase();
  if (!text) return false;
  if (/\.(?:wav|mp3|aac|m4a|flac|ogg)(?:$|[\s?#])/i.test(text)) return true;
  return /\b(?:sfx|sound_effect|sound effect|voice|voiceover|narration|tts|music|audio)\b/i.test(text) &&
    !/\.(?:mp4|mov|webm|mkv)(?:$|[\s?#])/i.test(text);
}

function isGeneratedMotionAsset(asset = {}) {
  const text = assetText(asset).toLowerCase();
  return (
    text.includes("owned_generated_motion") ||
    text.includes("pulse-generated-motion") ||
    text.includes("internally_generated_motion_graphic") ||
    text.includes("owned_generated_editorial_motion_graphic") ||
    text.includes("output/generated-motion") ||
    /\\generated-motion\\/i.test(text) ||
    /\bowned-motion-\d+\b/i.test(text)
  );
}

function isRealMediaAsset(asset = {}) {
  const text = assetText(asset).toLowerCase();
  if (!text || isGeneratedMotionAsset(asset)) return false;
  if (
    asset &&
    typeof asset === "object" &&
    !cleanText(asset.path || asset.local_path || asset.file_path || asset.media_path || asset.source_url || asset.url) &&
    !cleanText(asset.source_type || asset.rights_risk_class || asset.licence_basis || asset.license_basis)
  ) {
    return false;
  }
  const realTerms = [
    "official",
    "publisher",
    "studio",
    "press_kit",
    "press-kit",
    "press kit",
    "storefront",
    "steam",
    "igdb",
    "licensed",
    "gameplay",
    "trailer",
    "screenshot",
    "article_image",
    "article image",
    "b-roll",
    "broll",
    "youtube",
  ];
  return (
    realTerms.some((term) => text.includes(term)) ||
    /(?:store\.steampowered\.com|cdn\.akamai|images\.igdb|youtube\.com|youtu\.be|ign\.com|gamespot\.com|eurogamer\.net)/i.test(text)
  );
}

function isDirectVideoMotionAsset(asset = {}) {
  const text = assetText(asset).toLowerCase();
  if (!text || isGeneratedMotionAsset(asset) || !isMotionAsset(asset)) return false;
  if (/\b(?:screenshot|visual_still|still|image|jpg|jpeg|png|gif)\b/.test(text)) return false;
  return (
    /\.(?:mp4|mov|webm|mkv)(?:$|[\s?#])/i.test(text) &&
      /\b(?:direct_video|hls_manifest|dash_manifest|local_video_file|official_trailer_segment|official_video|official_social_media_video|official_game_page_direct_video|licensed_direct_media|licensed_direct_media_url|steam_movie|gameplay|trailer|b-roll|broll)\b/i.test(text)
  );
}

function sourceFamily(asset = {}, index = 0) {
  if (typeof asset === "string") return cleanText(asset).replace(/\\/g, "/").toLowerCase();
  return cleanText(
    asset.source_family ||
      asset.trusted_footage_source_id ||
      asset.source_id ||
      asset.source_url ||
      asset.url ||
      asset.path ||
      asset.id ||
      asset.asset_id ||
      `asset_${index + 1}`,
  )
    .replace(/\\/g, "/")
    .toLowerCase();
}

function normaliseIdentityText(value = "") {
  return cleanText(value).replace(/\\/g, "/").toLowerCase();
}

function assetIdentityKey(asset = {}, index = 0) {
  if (typeof asset === "string") return `string:${normaliseIdentityText(asset)}`;
  const fileKey = normaliseIdentityText(
    asset.path || asset.local_path || asset.file_path || asset.media_path || asset.local_materialized_path,
  );
  const family = sourceFamily(asset, index);
  if (fileKey) return `path:${fileKey}|family:${family}`;
  const sourceUrl = normaliseIdentityText(asset.source_url || asset.url);
  const id = normaliseIdentityText(asset.id || asset.asset_id || asset.motion_pack_clip_id);
  if (sourceUrl) return `source:${sourceUrl}|family:${family}|id:${id}`;
  if (id) return `id:${id}|family:${family}`;
  return `index:${index}`;
}

function dedupeAssets(assets = []) {
  const byKey = new Map();
  for (const [index, asset] of assets.entries()) {
    const key = assetIdentityKey(asset, index);
    if (!byKey.has(key)) {
      byKey.set(key, asset);
      continue;
    }
    const existing = byKey.get(key);
    if (typeof existing === "object" && existing && typeof asset === "object" && asset) {
      byKey.set(key, { ...existing, ...asset });
    }
  }
  return Array.from(byKey.values());
}

function rightsAssetsFromLedger(ledger = {}) {
  if (Array.isArray(ledger)) return ledger.filter(Boolean);
  if (!ledger || typeof ledger !== "object") return [];
  return [
    ...asArray(ledger.assets),
    ...asArray(ledger.records),
    ...asArray(ledger.rights_ledger),
    ...asArray(ledger.matched_assets),
  ];
}

function footageAssetsFromInventory(footage = {}) {
  if (!footage || typeof footage !== "object") return [];
  return [
    ...asArray(footage.motion_inventory?.accepted_local_clips),
    ...asArray(footage.motion_inventory?.production_motion_clips),
    ...asArray(footage.accepted_local_clips),
    ...asArray(footage.production_motion_clips),
    ...asArray(footage.clip_inventory),
    ...asArray(footage.clips),
    ...asArray(footage.assets),
  ];
}

function storyAssets(story = {}) {
  if (!story || typeof story !== "object") return [];
  return [
    ...asArray(story.video_clips),
    ...asArray(story.visual_v4_bridge_video_clips),
    ...asArray(story.motion_clips),
    ...asArray(story.downloaded_images),
    ...asArray(story.game_images),
    ...asArray(story.media_provenance),
  ];
}

function shotAssets(directorPlan = {}) {
  const shots = asArray(directorPlan.shot_plan || directorPlan.shots);
  return shots
    .filter((shot) => cleanText(shot.kind || shot.type).match(/motion|clip|gameplay|trailer|screenshot/i))
    .map((shot) => ({
      ...shot,
      path: shot.path || shot.media_path || shot.file_path,
      source_url: shot.source_url || shot.url,
    }));
}

function visualEvidenceProfile({
  story = {},
  rightsLedger = {},
  footageInventory = {},
  directorPlan = {},
} = {}) {
  const assets = dedupeAssets([
    ...storyAssets(story),
    ...rightsAssetsFromLedger(rightsLedger),
    ...footageAssetsFromInventory(footageInventory),
    ...shotAssets(directorPlan),
  ]).filter((asset) => !isAudioOnlyAsset(asset));
  const motionAssets = assets.filter(isMotionAsset);
  const generatedMotionAssets = motionAssets.filter(isGeneratedMotionAsset);
  const realMediaAssets = assets.filter(isRealMediaAsset);
  const realMotionAssets = motionAssets.filter(isRealMediaAsset);
  const directVideoMotionAssets = motionAssets.filter(isDirectVideoMotionAsset);
  const realFamilies = new Set(realMediaAssets.map(sourceFamily).filter(Boolean));
  const generatedFamilies = new Set(generatedMotionAssets.map(sourceFamily).filter(Boolean));
  const directVideoFamilies = new Set(directVideoMotionAssets.map(sourceFamily).filter(Boolean));
  const generatedOnlyMotionDeck =
    motionAssets.length >= 3 &&
    generatedMotionAssets.length >= 3 &&
    realMediaAssets.length === 0;
  const blockers = [];
  if (generatedOnlyMotionDeck) blockers.push("visual_evidence:generated_only_motion_deck");
  if (motionAssets.length >= 3 && realMediaAssets.length === 0) {
    blockers.push("visual_evidence:no_real_visual_media_asset");
  }
  if (motionAssets.length >= 5 && realFamilies.size > 0 && realFamilies.size < 2) {
    blockers.push("visual_evidence:insufficient_real_visual_source_families");
  }
  return {
    asset_count: assets.length,
    motion_asset_count: motionAssets.length,
    generated_motion_asset_count: generatedMotionAssets.length,
    real_media_asset_count: realMediaAssets.length,
    real_motion_asset_count: realMotionAssets.length,
    direct_video_motion_asset_count: directVideoMotionAssets.length,
    generated_motion_family_count: generatedFamilies.size,
    real_media_family_count: realFamilies.size,
    direct_video_motion_family_count: directVideoFamilies.size,
    generated_only_motion_deck: generatedOnlyMotionDeck,
    blockers,
  };
}

module.exports = {
  isDirectVideoMotionAsset,
  isGeneratedMotionAsset,
  isRealMediaAsset,
  visualEvidenceProfile,
  _private: {
    assetText,
    isAudioOnlyAsset,
    isMotionAsset,
    rightsAssetsFromLedger,
    footageAssetsFromInventory,
    storyAssets,
    shotAssets,
  },
};
