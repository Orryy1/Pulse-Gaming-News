"use strict";

const crypto = require("node:crypto");
const fs = require("fs-extra");
const path = require("node:path");
const axios = require("axios");

const {
  buildAssetAcquisitionPlan,
  MEDIA_SOURCE_REGISTRY,
} = require("./asset-acquisition-pro");
const { buildProductionPacket } = require("./creator-studio-os");
const { scoreStoryMediaInventory } = require("./creative/media-inventory-scorer");
const { classifyThumbnailImage } = require("./thumbnail-safety");
const { classifyOutboundUrl, safeRedirectConfig } = require("./safe-url");

const ALLOWED_STILL_SOURCE_TYPES = new Set([
  "steam_capsule",
  "steam_header",
  "steam_library",
  "steam_hero",
  "steam_screenshot",
  "igdb_cover",
  "igdb_screenshot",
  "official_publisher_image",
  "official_developer_image",
  "platform_ui",
  "platform_logo",
  "article_hero",
  "article_inline",
]);

const GAMEPLAY_STILL_SOURCE_TYPES = new Set(["steam_screenshot", "igdb_screenshot"]);
const COVER_LIKE_SOURCE_TYPES = new Set([
  "steam_capsule",
  "steam_header",
  "steam_library",
  "steam_hero",
  "igdb_cover",
]);

const DEFAULT_MAX_DOWNLOADS_PER_STORY = 6;

function normaliseUrl(value) {
  return String(value || "").trim();
}

function assetKey(candidate) {
  return normaliseUrl(candidate.source_url || candidate.local_path || candidate.duplicate_hash);
}

function hashValue(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function storyExistingKeys(story) {
  const out = new Set();
  for (const item of Array.isArray(story?.downloaded_images) ? story.downloaded_images : []) {
    for (const value of [item?.url, item?.source_url, item?.path, item?.content_hash]) {
      const key = normaliseUrl(value);
      if (key) out.add(key);
      if (key) out.add(hashValue(key));
    }
  }
  return out;
}

function existingDeckEntities(story) {
  return new Set(
    (Array.isArray(story?.downloaded_images) ? story.downloaded_images : [])
      .map(
        (item) =>
          item?.entity ||
          item?.game ||
          item?.game_title ||
          item?.franchise ||
          item?.publisher ||
          item?.platform,
      )
      .filter(Boolean)
      .map((entity) => String(entity).toLowerCase()),
  );
}

function existingDeckSourceTypesByEntity(story) {
  const out = new Map();
  for (const item of Array.isArray(story?.downloaded_images) ? story.downloaded_images : []) {
    const entity = String(
      item?.entity ||
        item?.game ||
        item?.game_title ||
        item?.franchise ||
        item?.publisher ||
        item?.platform ||
        "",
    ).toLowerCase();
    if (!entity) continue;
    if (!out.has(entity)) out.set(entity, new Set());
    out.get(entity).add(item?.source_type || item?.type || item?.kind || "unknown");
  }
  return out;
}

function isKnownEntity(candidate, assetPlan) {
  if (!candidate.entity) return true;
  const known = new Set((assetPlan.entity_map?.all || []).map((entity) => String(entity).toLowerCase()));
  return known.has(String(candidate.entity).toLowerCase());
}

function isStoreAsset(candidate) {
  return (
    candidate.store_asset_source ||
    /^steam_|^igdb_/.test(String(candidate.source_type || ""))
  );
}

function candidateSafeForStill(candidate, options = {}) {
  if (!ALLOWED_STILL_SOURCE_TYPES.has(candidate.source_type)) {
    return { ok: false, reason: "source_type_not_allowed_for_v11" };
  }
  if (!candidate.source_url) {
    return { ok: false, reason: "missing_source_url" };
  }
  if (
    candidate.thumbnail_safety_verdict?.safeForThumbnail === false ||
    candidate.thumbnail_safety_verdict?.isLikelyHuman
  ) {
    return { ok: false, reason: "unsafe_thumbnail_or_person" };
  }
  if (!candidate.accepted) {
    return { ok: false, reason: "candidate_rejected_by_v1" };
  }
  if (
    options.requireVerifiedStore &&
    isStoreAsset(candidate) &&
    candidate.store_match_status !== "verified"
  ) {
    return { ok: false, reason: "store_match_not_verified" };
  }
  return { ok: true };
}

function visualEvidenceRole(sourceType) {
  if (GAMEPLAY_STILL_SOURCE_TYPES.has(sourceType)) return "gameplay_still";
  if (COVER_LIKE_SOURCE_TYPES.has(sourceType)) return "cover_or_key_art";
  return "context_still";
}

function gameplayStillCountForEntity(entity, accepted, deckSourceTypesByEntity) {
  const key = String(entity || "").toLowerCase();
  if (!key) return 0;
  let count = 0;
  const existingTypes = deckSourceTypesByEntity.get(key) || new Set();
  for (const sourceType of existingTypes) {
    if (GAMEPLAY_STILL_SOURCE_TYPES.has(sourceType)) count += 1;
  }
  count += accepted.filter(
    (item) =>
      String(item.entity || "").toLowerCase() === key &&
      GAMEPLAY_STILL_SOURCE_TYPES.has(item.source_type),
  ).length;
  return count;
}

function improvesVisualDiversity(candidate, accepted, deckEntities, deckSourceTypesByEntity = new Map(), options = {}) {
  const entity = String(candidate.entity || "").toLowerCase();
  if (!entity) return accepted.length === 0;
  const gameplayStillCap = Math.max(1, Number(options.maxGameplayStillsPerEntity || 2));
  if (
    options.preferGameplayStills &&
    GAMEPLAY_STILL_SOURCE_TYPES.has(candidate.source_type) &&
    gameplayStillCountForEntity(entity, accepted, deckSourceTypesByEntity) < gameplayStillCap
  ) {
    return true;
  }
  if (deckEntities.has(entity)) return false;
  const sameEntityAccepted = accepted.filter(
    (item) => String(item.entity || "").toLowerCase() === entity,
  );
  if (sameEntityAccepted.length === 0) return true;
  return !sameEntityAccepted.some((item) => item.source_type === candidate.source_type);
}

function projectedStory(story, accepted) {
  const images = Array.isArray(story?.downloaded_images) ? [...story.downloaded_images] : [];
  for (const item of accepted) {
    images.push({
      type: item.source_type,
      source: item.source_type.startsWith("steam")
        ? "steam"
        : item.source_type.startsWith("igdb")
          ? "igdb"
          : item.source_type.startsWith("article")
            ? "article"
            : "official",
      url: item.source_url,
      path: item.local_path || item.source_url,
      entity: item.entity,
      width: item.width,
      height: item.height,
      steam_app_id: item.steam_app_id || item.store_app_id || null,
      steam_app_title: item.steam_app_title || item.store_app_title || null,
      steam_matched_query:
        item.steam_matched_query || item.store_matched_query || null,
      igdb_id: item.igdb_id || null,
      igdb_title: item.igdb_title || item.store_app_title || null,
      igdb_slug: item.igdb_slug || item.store_app_slug || null,
      igdb_matched_query:
        item.igdb_matched_query || item.store_matched_query || null,
      store_app_id: item.store_app_id || item.steam_app_id || item.igdb_id || null,
      store_app_title:
        item.store_app_title || item.steam_app_title || item.igdb_title || null,
      store_app_slug: item.store_app_slug || item.igdb_slug || null,
      store_matched_query:
        item.store_matched_query ||
        item.steam_matched_query ||
        item.igdb_matched_query ||
        null,
      visual_evidence_role: visualEvidenceRole(item.source_type),
    });
  }
  return { ...story, downloaded_images: images };
}

function readinessSummary(story) {
  const packet = buildProductionPacket(story);
  const media = scoreStoryMediaInventory(story);
  return {
    media_inventory_class: media.classification,
    creator_studio_media_verdict: packet.media_inventory.verdict,
    format: packet.format_route.verdict,
    readiness_colour: packet.publish_readiness.colour,
    publish_verdict: packet.publish_readiness.verdict,
  };
}

function provenanceFor(candidate, action, extra = {}) {
  return {
    source_url: candidate.source_url,
    source_type: candidate.source_type,
    entity: candidate.entity || null,
    subject_match_quality: candidate.subject_match_quality || null,
    subject_match_reason: candidate.subject_match_reason || null,
    counted_for_premium: candidate.counted_for_premium === true,
    counted_for_standard: candidate.counted_for_standard === true,
    exact_subject_group: candidate.exact_subject_group || null,
    rejection_or_downgrade_reason: candidate.rejection_or_downgrade_reason || null,
    store_asset_source: candidate.store_asset_source || null,
    store_app_id: candidate.store_app_id || null,
    store_app_title: candidate.store_app_title || null,
    store_app_slug: candidate.store_app_slug || null,
    store_matched_query: candidate.store_matched_query || null,
    store_match_status: candidate.store_match_status || null,
    store_match_verified: candidate.store_match_verified === true,
    store_match_reason: candidate.store_match_reason || null,
    visual_evidence_role: visualEvidenceRole(candidate.source_type),
    action,
    rights_risk_class: candidate.rights_risk_class,
    relevance_score: candidate.relevance_score,
    duplicate_hash: candidate.duplicate_hash || hashValue(candidate.source_url),
    thumbnail_safety_verdict: candidate.thumbnail_safety_verdict,
    reason: extra.reason || null,
    local_path: extra.local_path || null,
    file_size: extra.file_size || null,
    content_type: extra.content_type || candidate.content_type || null,
    acquired_at: extra.acquired_at || new Date().toISOString(),
  };
}

function extractSteamAppId(value) {
  const match =
    String(value || "").match(/\/apps\/(\d+)\//i) ||
    String(value || "").match(/\/app\/(\d+)(?:\/|$)/i);
  return match ? match[1] : null;
}

function cloneAssetWithStoreMetadata(asset, metadata) {
  if (!metadata?.title) return asset;
  const appId =
    metadata.appId ||
    extractSteamAppId(asset?.source_url || asset?.url || asset?.path);
  const matchedQuery =
    asset?.store_matched_query ||
    asset?.steam_matched_query ||
    asset?.entity ||
    asset?.game ||
    asset?.game_title ||
    metadata.title;
  return {
    ...asset,
    game_name: asset?.game_name || metadata.title,
    steam_app_id: asset?.steam_app_id || appId || null,
    steam_app_title: asset?.steam_app_title || metadata.title,
    steam_matched_query: matchedQuery,
    store_app_id: asset?.store_app_id || appId || null,
    store_app_title: asset?.store_app_title || metadata.title,
    store_matched_query: matchedQuery,
    store_metadata_verified_at: metadata.verifiedAt,
  };
}

async function resolveSteamAppMetadata(appId, options = {}) {
  if (!appId) return null;
  const cache = options.storeMetadataCache || new Map();
  if (cache.has(appId)) return cache.get(appId);
  const http = options.storeMetadataHttp || axios;
  try {
    const response = await http.get(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&filters=basic`,
      {
        timeout: 8000,
        headers: { "User-Agent": "PulseGamingAssetEnrichment/1.4" },
      },
    );
    const row = response?.data?.[appId];
    const title = row?.data?.name || null;
    const result = title
      ? {
          source: "steam",
          appId: String(appId),
          title,
          verifiedAt: new Date().toISOString(),
        }
      : null;
    cache.set(appId, result);
    return result;
  } catch {
    cache.set(appId, null);
    return null;
  }
}

function shouldResolveSteamAsset(asset) {
  const source = String(asset?.source || "").toLowerCase();
  const text = [asset?.source_url, asset?.url, asset?.path].filter(Boolean).join(" ");
  const appId =
    asset?.store_app_id ||
    asset?.steam_app_id ||
    asset?.app_id ||
    extractSteamAppId(text);
  if (!appId) return null;
  const title =
    asset?.store_app_title ||
    asset?.steam_app_title ||
    asset?.app_title ||
    asset?.game_title;
  const looksSteam =
    source === "steam" || /steamstatic\.com|steampowered\.com/i.test(text);
  return looksSteam && !title ? String(appId) : null;
}

async function storyWithVerifiedStoreMetadata(story, options = {}) {
  if (!options.verifyStoreMetadata) return { story, lookups: [] };
  const fields = [
    "downloaded_images",
    "game_images",
    "media_candidates",
    "article_inline_images",
    "igdb_assets",
  ];
  const next = { ...story };
  const lookups = [];
  const cache = options.storeMetadataCache || new Map();
  for (const field of fields) {
    const value = story?.[field];
    if (!Array.isArray(value)) continue;
    const updated = [];
    for (const asset of value) {
      const appId = shouldResolveSteamAsset(asset);
      if (!appId) {
        updated.push(asset);
        continue;
      }
      const metadata = await resolveSteamAppMetadata(appId, {
        ...options,
        storeMetadataCache: cache,
      });
      lookups.push({
        field,
        app_id: appId,
        status: metadata?.title ? "resolved" : "unresolved",
        app_title: metadata?.title || null,
      });
      updated.push(cloneAssetWithStoreMetadata(asset, metadata));
    }
    next[field] = updated;
  }
  return { story: next, lookups };
}

function uniqueValues(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const label = String(value || "").trim();
    const key = label.toLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function steamStillAssetsForApp(entity, app, options = {}) {
  const appId = String(app.id || "").trim();
  const appTitle = String(app.name || entity || "").trim();
  if (!appId || !appTitle) return [];
  const meta = {
    source: "steam",
    entity,
    game_name: appTitle,
    steam_app_id: appId,
    steam_app_title: appTitle,
    steam_matched_query: entity,
    store_app_id: appId,
    store_app_title: appTitle,
    store_matched_query: entity,
  };
  const coverLike = [
    {
      ...meta,
      type: "steam_header",
      url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
    },
    {
      ...meta,
      type: "steam_library",
      url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
    },
    {
      ...meta,
      type: "steam_capsule",
      url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
    },
  ];
  const screenshots = (Array.isArray(app.screenshots) ? app.screenshots : [])
    .map((shot, index) => {
      const url = shot?.path_full || shot?.path_thumbnail || shot?.url || null;
      if (!url) return null;
      return {
        ...meta,
        type: "steam_screenshot",
        url,
        width: shot?.width || shot?.w || 1920,
        height: shot?.height || shot?.h || 1080,
        screenshot_index: index + 1,
      };
    })
    .filter(Boolean);
  return options.preferGameplayStills ? [...screenshots, ...coverLike] : [...coverLike, ...screenshots];
}

async function resolveSteamAppDetails(appId, options = {}) {
  if (!appId || !options.preferGameplayStills) return null;
  const cache = options.storeDetailsCache || new Map();
  const key = String(appId);
  if (cache.has(key)) return cache.get(key);
  const http = options.storeDetailsHttp || options.storeSearchHttp || axios;
  try {
    const response = await http.get(
      `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(key)}&filters=basic,screenshots`,
      {
        timeout: 8000,
        headers: { "User-Agent": "PulseGamingAssetEnrichment/1.6" },
      },
    );
    const row = response?.data?.[key];
    const data = row?.data || null;
    const result = data
      ? {
          id: key,
          name: data.name || null,
          screenshots: Array.isArray(data.screenshots) ? data.screenshots : [],
        }
      : null;
    cache.set(key, result);
    return result;
  } catch {
    cache.set(key, null);
    return null;
  }
}

async function searchSteamStoreForEntity(entity, options = {}) {
  const http = options.storeSearchHttp || axios;
  try {
    const response = await http.get(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(entity)}&cc=gb&l=english`,
      {
        timeout: 8000,
        headers: { "User-Agent": "PulseGamingAssetEnrichment/1.5" },
      },
    );
    const app = (response?.data?.items || []).find((item) => item?.id && item?.name);
    if (!app) return null;
    const details = await resolveSteamAppDetails(app.id, options);
    return details
      ? {
          ...app,
          name: details.name || app.name,
          screenshots: details.screenshots || [],
        }
      : app;
  } catch {
    return null;
  }
}

async function storyWithMultiEntityStoreAssets(story, options = {}) {
  if (!options.multiEntityStoreSearch) return { story, coverage: [] };
  const assetPlan = buildAssetAcquisitionPlan(story);
  const targets = uniqueValues([
    ...(assetPlan.entity_map?.games || []),
    ...(assetPlan.entity_map?.franchises || []),
  ]).slice(0, Math.max(1, Number(options.maxStoreSearchEntities || 5)));
  const coverage = [];
  const generated = [];
  const maxAssetsPerEntity = Math.max(1, Number(options.maxStoreAssetsPerEntity || 3));
  for (const target of targets) {
    const app = await searchSteamStoreForEntity(target, options);
    const allAssets = app ? steamStillAssetsForApp(target, app, options) : [];
    const assets = allAssets.slice(0, maxAssetsPerEntity);
    coverage.push({
      entity: target,
      source: "steam",
      status: app ? "resolved" : "unresolved",
      app_id: app?.id ? String(app.id) : null,
      app_title: app?.name || null,
      asset_count: assets.length,
      gameplay_still_count: assets.filter((asset) => asset.type === "steam_screenshot").length,
      cover_like_count: assets.filter((asset) => asset.type !== "steam_screenshot").length,
    });
    generated.push(...assets);
  }
  if (generated.length === 0) return { story, coverage };
  return {
    story: {
      ...story,
      game_images: [...(Array.isArray(story?.game_images) ? story.game_images : []), ...generated],
    },
    coverage,
  };
}

function buildStillImageEnrichmentPlan(story, options = {}) {
  const maxDownloads = Math.max(1, Number(options.maxDownloadsPerStory || DEFAULT_MAX_DOWNLOADS_PER_STORY));
  const assetPlan = buildAssetAcquisitionPlan(story);
  const existingKeys = storyExistingKeys(story);
  const deckEntities = existingDeckEntities(story);
  const deckSourceTypesByEntity = existingDeckSourceTypesByEntity(story);
  const accepted = [];
  const rejected = [];
  const seen = new Set(existingKeys);

  const candidates = [...(assetPlan.candidates || [])]
    .filter((candidate) => candidate.source_url)
    .sort((a, b) => visualSortScore(b, options) - visualSortScore(a, options));

  for (const candidate of candidates) {
    const safety = candidateSafeForStill(candidate, options);
    const key = assetKey(candidate);
    const hash = candidate.duplicate_hash || hashValue(key);
    if (!safety.ok) {
      rejected.push({ ...candidate, reason: safety.reason });
      continue;
    }
    if (seen.has(key) || seen.has(hash)) {
      rejected.push({ ...candidate, reason: "duplicate_url_or_hash" });
      continue;
    }
    if (!isKnownEntity(candidate, assetPlan)) {
      rejected.push({ ...candidate, reason: "low_story_relevance" });
      continue;
    }
    if (!improvesVisualDiversity(candidate, accepted, deckEntities, deckSourceTypesByEntity, options)) {
      rejected.push({ ...candidate, reason: "does_not_improve_visual_diversity" });
      continue;
    }
    if (accepted.length >= maxDownloads) {
      rejected.push({ ...candidate, reason: "story_download_cap_reached" });
      continue;
    }
    accepted.push(candidate);
    seen.add(key);
    seen.add(hash);
  }

  const before = readinessSummary(story);
  const afterStory = projectedStory(story, accepted);
  const after = readinessSummary(afterStory);
  const addedEntities = Array.from(
    new Set(
      accepted
        .map((candidate) => candidate.entity)
        .filter(Boolean)
        .filter((entity) => !deckEntities.has(String(entity).toLowerCase())),
    ),
  );
  const evidenceMix = buildEvidenceMix(accepted);

  return {
    schema_version: 1,
    story_id: story?.id || null,
    title: story?.title || "",
    mode: options.dryRun === false ? "apply_local" : "dry_run",
    dry_run: options.dryRun !== false,
    apply_local: options.applyLocal === true,
    max_downloads_per_story: maxDownloads,
    allowed_source_types: Array.from(ALLOWED_STILL_SOURCE_TYPES).sort(),
    before,
    after_projected: after,
    would_improve_readiness:
      before.creator_studio_media_verdict !== after.creator_studio_media_verdict ||
      before.format !== after.format ||
      before.readiness_colour !== after.readiness_colour,
    would_change_visual_deck: accepted.length > 0,
    diversity_delta: {
      added_entities: addedEntities,
      accepted_count: accepted.length,
      rejected_count: rejected.length,
    },
    visual_evidence_repair: {
      prefer_gameplay_stills: options.preferGameplayStills === true,
      accepted_gameplay_stills: evidenceMix.gameplay_still,
      accepted_cover_like_stills: evidenceMix.cover_or_key_art,
      accepted_context_stills: evidenceMix.context_still,
      cover_like_share:
        accepted.length > 0 ? Number((evidenceMix.cover_or_key_art / accepted.length).toFixed(3)) : 0,
    },
    would_fetch: accepted.map((candidate) => ({
      id: candidate.id,
      source_url: candidate.source_url,
      source_type: candidate.source_type,
      entity: candidate.entity,
      subject_match_quality: candidate.subject_match_quality,
      counted_for_premium: candidate.counted_for_premium === true,
      counted_for_standard: candidate.counted_for_standard === true,
      exact_subject_group: candidate.exact_subject_group || null,
      store_asset_source: candidate.store_asset_source || null,
      store_app_id: candidate.store_app_id || null,
      store_app_title: candidate.store_app_title || null,
      store_app_slug: candidate.store_app_slug || null,
      store_matched_query: candidate.store_matched_query || null,
      store_match_status: candidate.store_match_status || null,
      store_match_verified: candidate.store_match_verified === true,
      score: candidate.score?.total || 0,
      rights_risk_class: candidate.rights_risk_class,
      duplicate_hash: candidate.duplicate_hash,
      visual_evidence_role: visualEvidenceRole(candidate.source_type),
    })),
    would_reject: rejected.map((candidate) => ({
      id: candidate.id,
      source_url: candidate.source_url,
      source_type: candidate.source_type,
      entity: candidate.entity,
      subject_match_quality: candidate.subject_match_quality,
      counted_for_premium: candidate.counted_for_premium === true,
      counted_for_standard: candidate.counted_for_standard === true,
      exact_subject_group: candidate.exact_subject_group || null,
      rejection_or_downgrade_reason: candidate.rejection_or_downgrade_reason || candidate.reason || null,
      store_asset_source: candidate.store_asset_source || null,
      store_app_id: candidate.store_app_id || null,
      store_app_title: candidate.store_app_title || null,
      store_app_slug: candidate.store_app_slug || null,
      store_matched_query: candidate.store_matched_query || null,
      store_match_status: candidate.store_match_status || null,
      store_match_verified: candidate.store_match_verified === true,
      reason: candidate.reason,
      score: candidate.score?.total || 0,
      visual_evidence_role: visualEvidenceRole(candidate.source_type),
    })),
    provenance: [
      ...accepted.map((candidate) => provenanceFor(candidate, "would_fetch")),
      ...rejected.map((candidate) => provenanceFor(candidate, "would_reject", { reason: candidate.reason })),
    ],
    _accepted_candidates: accepted,
  };
}

function visualSortScore(candidate, options = {}) {
  let score = Number(candidate?.score?.total || 0);
  if (options.preferGameplayStills) {
    if (GAMEPLAY_STILL_SOURCE_TYPES.has(candidate.source_type)) score += 35;
    if (COVER_LIKE_SOURCE_TYPES.has(candidate.source_type)) score -= 18;
  }
  return score;
}

function buildEvidenceMix(candidates) {
  const mix = {
    gameplay_still: 0,
    cover_or_key_art: 0,
    context_still: 0,
  };
  for (const candidate of candidates || []) {
    const role = visualEvidenceRole(candidate.source_type);
    mix[role] = (mix[role] || 0) + 1;
  }
  return mix;
}

function extensionFor(contentType, url) {
  const fromType = String(contentType || "").toLowerCase();
  if (fromType.includes("png")) return ".png";
  if (fromType.includes("webp")) return ".webp";
  if (fromType.includes("gif")) return ".gif";
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(fromUrl)) return fromUrl;
  return ".jpg";
}

function safeName(value) {
  return String(value || "asset")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
}

async function defaultFetchImage(url) {
  const safe = classifyOutboundUrl(url);
  if (!safe.ok) throw new Error(`unsafe_url:${safe.reason}`);
  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": "PulseGamingAssetEnrichment/1.1" },
    ...safeRedirectConfig(3),
    maxContentLength: 20 * 1024 * 1024,
  });
  const contentType = String(response.headers?.["content-type"] || "");
  if (!/^image\//i.test(contentType)) {
    throw new Error(`non_image_content_type:${contentType || "unknown"}`);
  }
  return {
    buffer: Buffer.from(response.data),
    contentType,
  };
}

async function applyLocalPlan(story, plan, options = {}) {
  const outputRoot = path.resolve(
    options.outputRoot || path.join(process.cwd(), "test", "output", "asset-acquisition-v11", "assets"),
  );
  const storyDir = path.join(outputRoot, safeName(story?.id || "story"));
  const fetchImage = options.fetchImage || defaultFetchImage;
  const applied = [];
  const provenance = plan.provenance.filter((entry) => entry.action === "would_reject");

  await fs.ensureDir(storyDir);
  for (const candidate of plan._accepted_candidates || []) {
    let fetched;
    try {
      fetched = await fetchImage(candidate.source_url, candidate);
    } catch (err) {
      provenance.push(
        provenanceFor(candidate, "fetch_failed", {
          reason: err?.message || "fetch_failed",
        }),
      );
      continue;
    }
    const buffer = Buffer.isBuffer(fetched) ? fetched : fetched.buffer;
    const contentType = fetched.contentType || candidate.content_type || "image/jpeg";
    if (!Buffer.isBuffer(buffer)) throw new Error("fetchImage must return a Buffer or { buffer }");
    const ext = extensionFor(contentType, candidate.source_url);
    const localPath = path.join(
      storyDir,
      `${safeName(candidate.entity || "asset")}_${safeName(candidate.source_type)}_${candidate.duplicate_hash}${ext}`,
    );
    const resolvedPath = path.resolve(localPath);
    if (!resolvedPath.startsWith(outputRoot)) {
      throw new Error("local output path escaped output root");
    }
    await fs.writeFile(resolvedPath, buffer);
    const record = {
      ...candidate,
      local_path: resolvedPath,
      file_size: buffer.length,
      content_type: contentType,
    };
    applied.push(record);
    provenance.push(
      provenanceFor(candidate, "applied_local", {
        local_path: resolvedPath,
        file_size: buffer.length,
        content_type: contentType,
      }),
    );
  }

  return { applied, provenance };
}

async function runStillImageEnrichment(stories = [], options = {}) {
  const dryRun = options.applyLocal === true ? false : options.dryRun !== false;
  const mode = dryRun ? "dry_run" : "apply_local";
  if (!dryRun && options.applyLocal !== true) {
    throw new Error("apply-local mode requires applyLocal=true");
  }

  const plans = [];
  let filesWritten = 0;
  for (const story of Array.isArray(stories) ? stories : []) {
    const prepared = await storyWithVerifiedStoreMetadata(story, options);
    const searched = await storyWithMultiEntityStoreAssets(prepared.story, options);
    const plan = buildStillImageEnrichmentPlan(searched.story, {
      ...options,
      dryRun,
      applyLocal: options.applyLocal === true,
    });
    plan.store_metadata_lookup = {
      enabled: options.verifyStoreMetadata === true,
      require_verified_store: options.requireVerifiedStore === true,
      lookups: prepared.lookups,
    };
    plan.multi_entity_store_search = {
      enabled: options.multiEntityStoreSearch === true,
      coverage: searched.coverage,
    };
    if (!dryRun) {
      const applied = await applyLocalPlan(searched.story, plan, options);
      plan.applied_assets = applied.applied.map((asset) => ({
        source_url: asset.source_url,
        source_type: asset.source_type,
        entity: asset.entity,
        local_path: asset.local_path,
        file_size: asset.file_size,
        content_type: asset.content_type,
        store_app_id: asset.store_app_id || null,
        store_app_title: asset.store_app_title || null,
        store_app_slug: asset.store_app_slug || null,
        store_matched_query: asset.store_matched_query || null,
        store_match_status: asset.store_match_status || null,
        store_match_verified: asset.store_match_verified === true,
        visual_evidence_role: visualEvidenceRole(asset.source_type),
      }));
      plan.provenance = applied.provenance;
      filesWritten += applied.applied.length;
    } else {
      plan.applied_assets = [];
    }
    delete plan._accepted_candidates;
    plans.push(plan);
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    mode,
    dry_run: dryRun,
    apply_local: !dryRun,
    summary: {
      stories: plans.length,
      would_fetch: plans.reduce((sum, plan) => sum + plan.would_fetch.length, 0),
      would_reject: plans.reduce((sum, plan) => sum + plan.would_reject.length, 0),
      would_improve_readiness: plans.filter((plan) => plan.would_improve_readiness).length,
      would_change_visual_deck: plans.filter((plan) => plan.would_change_visual_deck).length,
      files_written: filesWritten,
      store_metadata_lookups: plans.reduce(
        (sum, plan) => sum + (plan.store_metadata_lookup?.lookups?.length || 0),
        0,
      ),
      verified_store_only: options.requireVerifiedStore === true,
      gameplay_still_preference: options.preferGameplayStills === true,
      multi_entity_store_searches: plans.reduce(
        (sum, plan) => sum + (plan.multi_entity_store_search?.coverage?.length || 0),
        0,
      ),
    },
    plans,
  };
}

function renderStillImageEnrichmentMarkdown(report) {
  const lines = [];
  lines.push(
    report.summary?.gameplay_still_preference
      ? "# Asset Acquisition Pro v1.6 - Gameplay Still Preference"
      : report.summary?.multi_entity_store_searches > 0
      ? "# Asset Acquisition Pro v1.5 - Multi-Entity Verified Store Search"
      : report.summary?.verified_store_only
      ? "# Asset Acquisition Pro v1.4 - Verified Store Still Acquisition"
      : "# Asset Acquisition Pro v1.1 - Controlled Still-Image Enrichment",
  );
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "pending"}`);
  lines.push(`Mode: ${report.mode}`);
  lines.push(`Dry run: ${report.dry_run}`);
  lines.push(`Files written: ${report.summary?.files_written || 0}`);
  lines.push(`Store metadata lookups: ${report.summary?.store_metadata_lookups || 0}`);
  lines.push(`Verified store only: ${report.summary?.verified_store_only === true}`);
  lines.push(`Gameplay still preference: ${report.summary?.gameplay_still_preference === true}`);
  lines.push(`Multi-entity store searches: ${report.summary?.multi_entity_store_searches || 0}`);
  lines.push("");
  lines.push("| story | fetch | gameplay | cover-like | reject | before | after | improves | deck change |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |");
  for (const plan of report.plans || []) {
    lines.push(
      [
        plan.story_id,
        plan.would_fetch.length,
        plan.visual_evidence_repair?.accepted_gameplay_stills || 0,
        plan.visual_evidence_repair?.accepted_cover_like_stills || 0,
        plan.would_reject.length,
        `${plan.before.readiness_colour}/${plan.before.creator_studio_media_verdict}`,
        `${plan.after_projected.readiness_colour}/${plan.after_projected.creator_studio_media_verdict}`,
        plan.would_improve_readiness,
        plan.would_change_visual_deck,
      ]
        .map((value) => String(value).replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Still images only.");
  lines.push("- Dry-run is the default.");
  lines.push("- Apply-local writes only under the configured local output root.");
  lines.push("- No story rows, Railway variables, OAuth state, uploads, hard gates or video assets are touched.");
  return lines.join("\n") + "\n";
}

module.exports = {
  ALLOWED_STILL_SOURCE_TYPES,
  COVER_LIKE_SOURCE_TYPES,
  GAMEPLAY_STILL_SOURCE_TYPES,
  buildStillImageEnrichmentPlan,
  renderStillImageEnrichmentMarkdown,
  runStillImageEnrichment,
  visualEvidenceRole,
};
