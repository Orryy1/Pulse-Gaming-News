"use strict";

const crypto = require("node:crypto");
const { buildProductionPacket, extractEntities } = require("./creator-studio-os");
const { scoreStoryMediaInventory } = require("./creative/media-inventory-scorer");
const {
  classifyThumbnailImage,
  rankThumbnailCandidates,
} = require("./thumbnail-safety");
const {
  buildExactSubjectReadiness,
  buildSubjectGraph,
  classifySubjectMatch,
  summariseExactSubjectPlans,
  summariseStoreVerificationPlans,
} = require("./exact-subject-matching");
const { buildSteamSearchCandidates } = require("../images_download");
const {
  inferHeadlineGameCandidates,
  isLikelyGameTitleCandidate,
} = require("./game-title-inference");

const MEDIA_SOURCE_REGISTRY = Object.freeze({
  steam_capsule: sourceDef(88, "high", "storefront_promotional", "full_render", true, true),
  steam_header: sourceDef(96, "high", "storefront_promotional", "full_render", true, true),
  steam_library: sourceDef(92, "high", "storefront_promotional", "full_render", true, true),
  steam_hero: sourceDef(95, "high", "storefront_promotional", "full_render", true, true),
  steam_screenshot: sourceDef(84, "high", "storefront_promotional", "full_render", true, true),
  steam_trailer: sourceDef(98, "very_high", "storefront_promotional_video", "motion_render", false, true),
  steam_movie: sourceDef(94, "very_high", "storefront_promotional_video", "motion_render", false, true),
  igdb_cover: sourceDef(82, "high", "igdb_metadata_promotional", "full_render", true, true),
  igdb_screenshot: sourceDef(80, "high", "igdb_metadata_promotional", "full_render", true, true),
  igdb_video: sourceDef(86, "high", "igdb_metadata_reference", "reference_only_by_default", false, true),
  official_publisher_image: sourceDef(76, "medium_high", "official_promotional", "full_render", true, true),
  official_developer_image: sourceDef(74, "medium_high", "official_promotional", "full_render", true, true),
  official_video_reference: sourceDef(88, "high", "official_video_reference", "reference_only_by_default", false, true),
  article_hero: sourceDef(58, "medium", "article_contextual", "context_render", true, false),
  article_inline: sourceDef(50, "medium", "article_contextual", "context_render", true, false),
  platform_ui: sourceDef(62, "medium", "platform_context", "context_render", true, false),
  platform_logo: sourceDef(60, "medium", "platform_context", "context_render", true, false),
  generated_brand_card: sourceDef(42, "story_context", "owned", "fallback_card", true, false),
  stock_filler: sourceDef(12, "low", "stock_or_generic", "last_resort_only", false, false),
  unsafe: sourceDef(0, "none", "reject", "reject", false, false),
});

const SOURCE_PRIORITIES = Object.freeze([
  "official_source_first",
  "steam_store_assets",
  "igdb_assets",
  "publisher_press_assets",
  "article_og_image",
  "generated_brand_card",
  "stock_or_generic_last_resort",
]);

const GAME_ENTITIES = new Set([
  "GTA",
  "Grand Theft Auto",
  "MindsEye",
  "Pokemon",
  "Zelda",
  "Metro",
]);
const FRANCHISE_ENTITIES = new Set(["Red Dead", "BioShock"]);
const PUBLISHER_ENTITIES = new Set(["Take-Two", "Rockstar", "Niantic"]);
const PLATFORM_ENTITIES = new Set([
  "Xbox",
  "PlayStation",
  "Nintendo",
  "Switch",
  "Steam",
  "PC",
  "Game Pass",
]);

function sourceDef(
  priority,
  expectedRelevance,
  rightsRiskClass,
  allowedRenderUse,
  thumbnailEligible,
  supportsPremiumVideo,
) {
  return {
    priority,
    expected_relevance: expectedRelevance,
    rights_risk_class: rightsRiskClass,
    allowed_render_use: allowedRenderUse,
    thumbnail_eligible: thumbnailEligible,
    supports_premium_video: supportsPremiumVideo,
  };
}

function storyText(story) {
  return [
    story?.title,
    story?.hook,
    story?.body,
    story?.loop,
    story?.full_script,
    story?.description,
    story?.source_text,
    story?.top_comment,
    story?.subreddit,
    story?.company_name,
    story?.publisher,
    story?.developer,
  ]
    .filter(Boolean)
    .join(" ");
}

function cleanQuery(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/[^a-zA-Z0-9:'&+.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function unique(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const cleaned = cleanQuery(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
  }
  return out;
}

function sourceUrl(story) {
  return story?.source_url || story?.url || story?.link || null;
}

function entityValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    return value.name || value.title || value.label || value.game || value.franchise || null;
  }
  return null;
}

function storyArray(story, key) {
  const value = story?.[key];
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {}
    }
  }
  return [];
}

function buildEntityMap(story) {
  const detected = extractEntities(story);
  const explicit = [
    ...storyArray(story, "entities").map(entityValue),
    ...storyArray(story, "named_entities").map(entityValue),
    ...storyArray(story, "story_entities").map(entityValue),
    ...storyArray(story, "games").map(entityValue),
    ...storyArray(story, "franchises").map(entityValue),
    ...storyArray(story, "publishers").map(entityValue),
    ...storyArray(story, "platforms").map(entityValue),
    ...storyArray(story, "characters").map(entityValue),
  ];
  const company = story?.company_name || story?.publisher || story?.developer;
  const inferredGames = inferHeadlineGameCandidates(story?.title || "");
  const steamCandidates = buildSteamSearchCandidates(story?.title || "").slice(0, 3);
  const all = unique([...detected, ...explicit, company, ...steamCandidates]);

  const games = unique([
    ...all.filter((entity) => GAME_ENTITIES.has(entity)),
    ...inferredGames,
    ...steamCandidates.filter(isLikelyGameTitleCandidate),
    ...storyArray(story, "games").map(entityValue),
  ]);
  const franchises = unique([
    ...all.filter((entity) => FRANCHISE_ENTITIES.has(entity)),
    ...storyArray(story, "franchises").map(entityValue),
  ]);
  const publishers = unique([
    ...all.filter((entity) => PUBLISHER_ENTITIES.has(entity)),
    company,
    ...storyArray(story, "publishers").map(entityValue),
  ]);
  const platforms = unique([
    ...all.filter((entity) => PLATFORM_ENTITIES.has(entity)),
    ...storyArray(story, "platforms").map(entityValue),
  ]);
  const characters = unique(storyArray(story, "characters").map(entityValue));
  const orderedAll = unique([...games, ...franchises, ...publishers, ...platforms, ...characters, ...all]);

  return {
    all: orderedAll,
    games,
    franchises,
    publishers,
    platforms,
    characters,
    primary: games[0] || franchises[0] || publishers[0] || platforms[0] || all[0] || null,
  };
}

function deriveEntities(story) {
  return buildEntityMap(story).all.slice(0, 8);
}

function task(type, priority, target, reason, extra = {}) {
  return {
    type,
    priority,
    target: target || null,
    reason,
    will_download: false,
    mutates: false,
    ...extra,
  };
}

function buildSearchQueries(story, entities) {
  const base = entities.length ? entities : buildSteamSearchCandidates(story?.title || "");
  const queries = [];
  for (const entity of base.slice(0, 5)) {
    queries.push(entity);
    queries.push(`${entity} Steam`);
    queries.push(`${entity} official trailer`);
    queries.push(`${entity} gameplay`);
    queries.push(`${entity} press kit`);
    queries.push(`${entity} key art`);
  }
  if (story?.title) queries.push(story.title);
  return unique(queries).slice(0, 24);
}

function buildThumbnailPlan(story) {
  const images = normaliseAssetArray(story?.downloaded_images);
  const ranked = rankThumbnailCandidates(story, images, { includeRejected: true });
  const safe = ranked.filter((candidate) => candidate.safeForThumbnail);
  const rejected = ranked.filter((candidate) => !candidate.safeForThumbnail);
  const existingPath =
    story?.thumbnail_candidate_path ||
    story?.hf_thumbnail_path ||
    story?.thumbnail_path ||
    story?.story_card_path ||
    null;

  return {
    existing_thumbnail_candidate_present: Boolean(existingPath),
    existing_thumbnail_candidate_path: existingPath,
    safe_candidate_count: safe.length,
    rejected_candidate_count: rejected.length,
    allowed_from_existing: Boolean(existingPath) || safe.length > 0,
    best_safe_asset: safe[0]?.image?.path || safe[0]?.image?.url || null,
    rejected_reasons: Array.from(
      new Set(rejected.flatMap((candidate) => candidate.reasons || [])),
    ),
    build_required: !existingPath,
  };
}

function normaliseAssetArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [parsed];
      } catch {}
    }
    return [{ url: trimmed }];
  }
  if (typeof value === "object") return [value];
  return [];
}

function assetText(asset) {
  return [
    asset?.path,
    asset?.url,
    asset?.source,
    asset?.type,
    asset?.kind,
    asset?.title,
    asset?.label,
    asset?.entity,
    asset?.game,
    asset?.game_title,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function mapSourceType(asset) {
  const type = String(asset?.type || asset?.kind || "").toLowerCase();
  const source = String(asset?.source || "").toLowerCase();
  const text = assetText(asset);

  if (asset?.unsafe === true) return "unsafe";
  if (asset?.stock === true || ["pexels", "unsplash", "bing", "stock"].includes(source)) {
    return "stock_filler";
  }
  if (source === "steam" || /steam/.test(text)) {
    if (/trailer|movie|video/.test(type) || /\.(mp4|webm|mov)(?:$|\?)/i.test(text)) {
      return /movie/.test(type) ? "steam_movie" : "steam_trailer";
    }
    if (/header/.test(type)) return "steam_header";
    if (/library/.test(type)) return "steam_library";
    if (/hero|key[_-]?art/.test(type)) return "steam_hero";
    if (/capsule|cover/.test(type)) return "steam_capsule";
    if (/screenshot|screen/.test(type)) return "steam_screenshot";
    return "steam_screenshot";
  }
  if (source === "igdb" || /igdb/.test(text)) {
    if (/video|trailer|movie/.test(type)) return "igdb_video";
    if (/screenshot|screen/.test(type)) return "igdb_screenshot";
    return "igdb_cover";
  }
  if (/trailer|gameplay|video|movie/.test(type) || /\.(mp4|webm|mov)(?:$|\?)/i.test(text)) {
    return "official_video_reference";
  }
  if (source === "article" || /article/.test(type)) {
    return /inline/.test(type) ? "article_inline" : "article_hero";
  }
  if (/platform[_-]?ui|store[_-]?ui/.test(type)) return "platform_ui";
  if (/platform[_-]?logo|logo/.test(type) || source === "logo") return "platform_logo";
  if (source === "generated" || /generated|brand[_-]?card|card/.test(type)) {
    return "generated_brand_card";
  }
  if (source === "publisher" || source === "official") return "official_publisher_image";
  if (source === "developer") return "official_developer_image";
  return "article_hero";
}

function inferEntityForAsset(asset, entityMap) {
  const explicit =
    asset?.entity ||
    asset?.game ||
    asset?.game_title ||
    asset?.franchise ||
    asset?.publisher ||
    asset?.platform ||
    null;
  if (explicit) return cleanQuery(explicit);
  const text = assetText(asset);
  for (const entity of entityMap.all) {
    if (text.includes(entity.toLowerCase().replace(/\s+/g, "-"))) return entity;
    if (text.includes(entity.toLowerCase())) return entity;
  }
  return entityMap.primary || null;
}

function isVideoSource(sourceType) {
  return /trailer|movie|video/.test(sourceType);
}

function hashValue(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex").slice(0, 16);
}

function duplicateKey(asset, sourceType) {
  return (
    asset?.content_hash ||
    asset?.hash ||
    asset?.url ||
    asset?.source_url ||
    asset?.path ||
    `${sourceType}:${asset?.title || asset?.label || ""}`
  );
}

function normaliseCandidate(story, rawAsset, origin, entityMap, index, seen) {
  const sourceType = mapSourceType(rawAsset);
  const registry = MEDIA_SOURCE_REGISTRY[sourceType] || MEDIA_SOURCE_REGISTRY.unsafe;
  const source_url =
    rawAsset?.source_url ||
    rawAsset?.url ||
    (/^https?:\/\//i.test(String(rawAsset?.path || "")) ? rawAsset.path : null);
  const local_path = rawAsset?.path && !/^https?:\/\//i.test(String(rawAsset.path))
    ? rawAsset.path
    : rawAsset?.local_path || null;
  const key = duplicateKey(rawAsset, sourceType);
  const duplicateHash = hashValue(key);
  const seenCount = seen.get(duplicateHash) || 0;
  seen.set(duplicateHash, seenCount + 1);
  const entity = inferEntityForAsset(rawAsset, entityMap);
  const thumbnailVerdict = thumbnailVerdictForCandidate(story, rawAsset, sourceType);
  const subjectMatch = classifySubjectMatch(
    story,
    {
      ...rawAsset,
      source_type: sourceType,
      source_url,
      local_path,
      entity,
      thumbnail_safety_verdict: compactThumbnailVerdict(thumbnailVerdict),
    },
    buildSubjectGraph(story),
  );
  const score = applySubjectMatchScore(
    scoreCandidate({
      sourceType,
      registry,
      rawAsset,
      entity,
      entityMap,
      thumbnailVerdict,
      duplicate: seenCount > 0,
    }),
    subjectMatch,
  );
  const subjectUnsafe = subjectMatch.subject_match_quality === "unsafe_or_rejected";
  const accepted =
    !subjectUnsafe &&
    sourceType !== "unsafe" &&
    registry.allowed_render_use !== "reject" &&
    (isVideoSource(sourceType) || thumbnailVerdict.safeForThumbnail) &&
    !score.reasons.includes("unknown_person_penalty");

  return {
    id: `${story?.id || "story"}_${origin}_${index}`,
    source_url,
    source_type: sourceType,
    origin,
    entity,
    acquired_at: rawAsset?.acquired_at || story?.timestamp || new Date().toISOString(),
    local_path,
    width: Number(rawAsset?.width || rawAsset?.w || rawAsset?.metadata?.width || 0) || null,
    height: Number(rawAsset?.height || rawAsset?.h || rawAsset?.metadata?.height || 0) || null,
    file_size:
      Number(rawAsset?.file_size || rawAsset?.fileSize || rawAsset?.size || rawAsset?.metadata?.size || 0) ||
      null,
    content_type:
      rawAsset?.content_type ||
      rawAsset?.mime ||
      rawAsset?.mime_type ||
      (isVideoSource(sourceType) ? "video/reference" : "image/reference"),
    thumbnail_safety_verdict: compactThumbnailVerdict(thumbnailVerdict),
    rights_risk_class: registry.rights_risk_class,
    allowed_render_use: registry.allowed_render_use,
    thumbnail_eligible: registry.thumbnail_eligible,
    supports_premium_video: registry.supports_premium_video,
    relevance_score: score.relevance,
    duplicate_hash: duplicateHash,
    duplicate_count_before: seenCount,
    reason_accepted: accepted ? "passes_source_relevance_safety_threshold" : null,
    reason_rejected: accepted ? null : score.reasons.join(",") || "source_not_safe_for_render",
    accepted,
    ...subjectMatch,
    score,
    raw: {
      type: rawAsset?.type || rawAsset?.kind || null,
      source: rawAsset?.source || null,
      title: rawAsset?.title || rawAsset?.label || rawAsset?.app_title || null,
    },
  };
}

function applySubjectMatchScore(score, subjectMatch) {
  const adjusted = { ...score, reasons: [...(score.reasons || [])] };
  const quality = subjectMatch.subject_match_quality;
  let delta = 0;
  if (quality === "exact_game_match") delta += 8;
  else if (quality === "exact_franchise_match") delta += 6;
  else if (quality === "exact_platform_match") delta += 4;
  else if (quality === "publisher_context_only") delta -= 12;
  else if (quality === "article_context_only") delta -= 18;
  else if (quality === "generic_store_asset") delta -= 35;
  else if (quality === "generic_stock_or_filler") delta -= 45;
  else if (quality === "unsafe_or_rejected") delta -= 100;
  if (delta < 0) adjusted.reasons.push(subjectMatch.rejection_or_downgrade_reason || "subject_match_penalty");
  adjusted.subjectMatchDelta = delta;
  adjusted.total = Math.max(0, Math.min(100, adjusted.total + delta));
  adjusted.relevance = Math.max(0, Math.min(100, adjusted.relevance + delta));
  return adjusted;
}

function thumbnailVerdictForCandidate(story, rawAsset, sourceType) {
  if (isVideoSource(sourceType)) {
    return {
      safeForThumbnail: false,
      decision: "not_thumbnail_asset",
      reasons: [],
      warnings: ["video_reference_not_direct_thumbnail"],
      score: 50,
      isLikelyHuman: false,
      isGameAsset: true,
      isPlatformAsset: false,
      isStock: false,
      namedPersonAllowed: false,
    };
  }
  if (sourceType === "generated_brand_card") {
    return {
      safeForThumbnail: true,
      decision: "allow",
      reasons: [],
      warnings: ["generated_brand_card"],
      score: 68,
      isLikelyHuman: false,
      isGameAsset: false,
      isPlatformAsset: true,
      isStock: false,
      namedPersonAllowed: false,
    };
  }
  return classifyThumbnailImage(story, rawAsset);
}

function compactThumbnailVerdict(verdict) {
  return {
    decision: verdict.decision,
    safeForThumbnail: verdict.safeForThumbnail,
    reasons: verdict.reasons || [],
    warnings: verdict.warnings || [],
    score: verdict.score,
    isLikelyHuman: Boolean(verdict.isLikelyHuman),
    isStock: Boolean(verdict.isStock),
  };
}

function scoreCandidate({
  sourceType,
  registry,
  rawAsset,
  entity,
  entityMap,
  thumbnailVerdict,
  duplicate,
}) {
  const reasons = [];
  const sourcePriority = registry.priority;
  const knownEntity = entity && entityMap.all.some((known) => known.toLowerCase() === entity.toLowerCase());
  const premiumSuitability = registry.supports_premium_video ? 18 : 0;
  const entityMatch = knownEntity ? 20 : entity ? 10 : 0;
  let relevance = Math.min(100, sourcePriority + entityMatch + premiumSuitability);
  let visualQuality = 8;
  const width = Number(rawAsset?.width || rawAsset?.w || 0);
  const height = Number(rawAsset?.height || rawAsset?.h || 0);
  if (width >= 1280 && height >= 720) visualQuality += 12;
  if (width && height) {
    const ratio = width / height;
    if ((ratio >= 1.55 && ratio <= 1.9) || (ratio >= 0.52 && ratio <= 0.68)) {
      visualQuality += 8;
    }
  } else if (/steam|igdb|official/.test(sourceType)) {
    visualQuality += 8;
  }

  let penalty = 0;
  if (duplicate) {
    penalty += 35;
    reasons.push("duplicate_penalty");
  }
  if (sourceType === "stock_filler") {
    penalty += 35;
    reasons.push("stock_filler_penalty");
  }
  if (thumbnailVerdict.isLikelyHuman && !thumbnailVerdict.namedPersonAllowed) {
    penalty += 50;
    reasons.push("unknown_person_penalty");
  }
  if (!thumbnailVerdict.safeForThumbnail && !isVideoSource(sourceType)) {
    penalty += 35;
    reasons.push("thumbnail_safety_penalty");
  }
  if (sourceType === "unsafe") {
    penalty += 100;
    reasons.push("unsafe_source");
  }

  const thumbnailSafety = isVideoSource(sourceType) ? 45 : thumbnailVerdict.score || 0;
  const total = Math.max(
    0,
    Math.min(
      100,
      Math.round(sourcePriority * 0.45 + relevance * 0.22 + visualQuality + thumbnailSafety * 0.2 - penalty),
    ),
  );

  return {
    total,
    sourcePriority,
    relevance,
    entityMatch,
    visualQuality,
    thumbnailSafety,
    premiumSuitability,
    penalty,
    reasons,
  };
}

function collectAssetInputs(story) {
  const assets = [];
  const push = (origin, value) => {
    for (const asset of normaliseAssetArray(value)) assets.push({ origin, asset });
  };

  push("downloaded_images", story?.downloaded_images);
  push("game_images", story?.game_images);
  push("media_candidates", story?.media_candidates);
  push("article_inline_images", story?.article_inline_images);
  push("video_clips", story?.video_clips);
  push("trailer_references", story?.trailer_references || story?.trailer_urls || story?.steam_trailer_urls);
  push("igdb_assets", story?.igdb_assets);

  if (story?.article_image) {
    assets.push({
      origin: "article_image",
      asset: { url: story.article_image, type: "article_hero", source: "article" },
    });
  }
  if (story?.company_logo_url) {
    assets.push({
      origin: "company_logo",
      asset: {
        url: story.company_logo_url,
        type: "company_logo",
        source: story?.company_name ? "publisher" : "logo",
        entity: story?.company_name || null,
      },
    });
  }
  return assets;
}

function buildCandidateLedger(story, entityMap) {
  const seen = new Map();
  const raw = collectAssetInputs(story);
  const candidates = raw.map(({ origin, asset }, index) =>
    normaliseCandidate(story, asset, origin, entityMap, index, seen),
  );
  if (
    candidates.length === 0 ||
    candidates.filter(
      (candidate) =>
        candidate.accepted &&
        !isVideoSource(candidate.source_type) &&
        candidate.source_type !== "stock_filler",
    ).length < 2
  ) {
    candidates.push(
      normaliseCandidate(
        story,
        {
          type: "generated_brand_card",
          source: "generated",
          path: `planned://brand-card/${story?.id || "story"}.png`,
          entity: entityMap.primary || "Pulse Gaming",
        },
        "generated_brand_card",
        entityMap,
        candidates.length,
        seen,
      ),
    );
  }
  return candidates;
}

function deckKey(candidate) {
  return candidate.local_path || candidate.source_url || candidate.id;
}

function buildVisualDeck(story, candidates, tasks = []) {
  const allAcceptedImages = candidates
    .filter((candidate) => candidate.accepted && !isVideoSource(candidate.source_type))
    .sort((a, b) => b.score.total - a.score.total);
  const nonStockImages = allAcceptedImages.filter(
    (candidate) => candidate.source_type !== "stock_filler",
  );
  const stockImages = allAcceptedImages.filter(
    (candidate) => candidate.source_type === "stock_filler",
  );
  const acceptedImages =
    nonStockImages.length >= 2
      ? nonStockImages
      : nonStockImages.length === 1 && stockImages.length > 0
        ? [...nonStockImages, ...stockImages]
        : allAcceptedImages;
  const byEntity = new Map();
  for (const candidate of acceptedImages) {
    const entity = candidate.entity || "story";
    if (!byEntity.has(entity)) byEntity.set(entity, []);
    byEntity.get(entity).push(candidate);
  }

  const selected = [];
  const used = new Set();
  const addCandidate = (candidate) => {
    if (!candidate) return;
    const key = deckKey(candidate);
    if (!key || used.has(key) || selected.length >= 12) return;
    used.add(key);
    selected.push(candidate);
  };

  for (const group of Array.from(byEntity.values()).sort((a, b) => b[0].score.total - a[0].score.total)) {
    addCandidate(group[0]);
  }
  for (const candidate of acceptedImages) addCandidate(candidate);

  if (selected.length < 3) {
    const card = candidates.find((candidate) => candidate.source_type === "generated_brand_card");
    addCandidate(card);
  }

  const items = selected.slice(0, 12).map((candidate, index) => ({
    order: index + 1,
    source_type: candidate.source_type,
    entity: candidate.entity,
    local_path: candidate.local_path,
    source_url: candidate.source_url,
    score: candidate.score.total,
    rights_risk_class: candidate.rights_risk_class,
    thumbnail_safe: candidate.thumbnail_safety_verdict.safeForThumbnail,
    subject_match_quality: candidate.subject_match_quality,
    subject_match_reason: candidate.subject_match_reason,
    counted_for_premium: candidate.counted_for_premium,
    counted_for_standard: candidate.counted_for_standard,
    exact_subject_group: candidate.exact_subject_group,
    rejection_or_downgrade_reason: candidate.rejection_or_downgrade_reason,
    reason: index === 0 ? "opening_safe_subject" : "balanced_entity_deck",
  }));
  const thumbnailCandidate = items.find((item) => item.thumbnail_safe) || null;

  return {
    max_items: 12,
    items,
    first_frame_safe: items[0] ? Boolean(items[0].thumbnail_safe) : false,
    thumbnail_candidate_safe: Boolean(thumbnailCandidate),
    thumbnail_candidate: thumbnailCandidate,
    repeated_image_count: items.length - new Set(items.map((item) => item.local_path || item.source_url)).size,
    fallback_cards_used: items.filter((item) => item.source_type === "generated_brand_card").length,
    trailer_plan_required: tasks.some((item) =>
      ["trailer_frame_extract", "clip_slice_extract", "official_trailer_search"].includes(item.type),
    ),
  };
}

function buildTrailerFramePlan(story, candidates, tasks) {
  const references = candidates
    .filter((candidate) => isVideoSource(candidate.source_type))
    .map((candidate) => ({
      source_type: candidate.source_type,
      source_url: candidate.source_url,
      local_path: candidate.local_path,
      entity: candidate.entity,
      rights_risk_class: candidate.rights_risk_class,
      allowed_render_use: candidate.allowed_render_use,
    }));

  return {
    mode: "report_only",
    downloads_allowed: false,
    frame_extraction_allowed: false,
    references,
    planned_actions: tasks.filter((item) =>
      ["official_trailer_search", "trailer_frame_extract", "clip_slice_extract"].includes(item.type),
    ),
    dedupe_required: true,
    frame_quality_scoring_required: true,
    note: "Trailer references are recorded for a later approved local worker. This command does not download or extract frames.",
  };
}

function classifyBudget({ packet, media, tasks }) {
  if (packet.story_dossier.topicality_verdict === "reject") return "none";
  if (tasks.length === 0) return "none";
  if (media.counts.total_images === 0 && media.counts.total_clips === 0) {
    return "standard_rescue";
  }
  if (
    media.classification === "blog_only" ||
    media.classification === "briefing_item" ||
    media.classification === "reject_visuals"
  ) {
    return "card_rescue";
  }
  if (packet.media_inventory.verdict === "standard_ready") return "premium_upgrade";
  return "standard_rescue";
}

function estimateReadiness({ packet, media, tasks }) {
  if (packet.story_dossier.topicality_verdict === "reject") return "reject";
  if (tasks.length === 0 && packet.media_inventory.verdict === "premium_ready") {
    return "premium_ready_current";
  }
  const types = new Set(tasks.map((item) => item.type));
  const canGetTrailer =
    media.counts.official_trailer_clips > 0 || types.has("official_trailer_search");
  const canGetStore = media.counts.store_assets >= 2 || types.has("steam_store_search");
  if (canGetTrailer && canGetStore) return "premium_ready_possible";
  if (canGetStore || media.counts.article_images > 0) return "standard_ready_possible";
  return "review_after_acquisition";
}

function buildTasks(story, packet, media, thumbnailPlan, entities, searchQueries, candidates) {
  if (packet.story_dossier.topicality_verdict === "reject") return [];
  const unsafeCandidateCount = candidates.filter((candidate) => !candidate.accepted).length;
  if (
    packet.media_inventory.verdict === "premium_ready" &&
    thumbnailPlan.existing_thumbnail_candidate_present &&
    thumbnailPlan.rejected_candidate_count === 0 &&
    unsafeCandidateCount === 0
  ) {
    return [];
  }

  const tasks = [];
  const primaryTarget = entities[0] || cleanQuery(story?.title) || "story subject";
  const counts = media.counts;
  const hasTrailer = counts.official_trailer_clips > 0;
  const hasUsableEntity = entities.length > 0 || cleanQuery(story?.title).length > 0;
  const entityCount = Math.max(1, entities.length);

  if (
    counts.unknown_human_portrait_risk > 0 ||
    thumbnailPlan.rejected_reasons.length > 0 ||
    unsafeCandidateCount > 0
  ) {
    tasks.push(
      task(
        "replace_unsafe_visuals",
        "high",
        primaryTarget,
        "Existing visual set has unsafe human, stock-person or profile-image risk.",
        {
          rejected_reasons: thumbnailPlan.rejected_reasons,
          unsafe_candidate_count: unsafeCandidateCount,
        },
      ),
    );
  }

  if (hasUsableEntity && counts.store_assets < Math.min(6, entityCount * 2)) {
    tasks.push(
      task(
        "steam_store_search",
        counts.store_assets === 0 ? "high" : "medium",
        primaryTarget,
        "Store art is below the minimum for a modern Short.",
        {
          queries: searchQueries.filter((query) => !/official trailer|press kit/i.test(query)).slice(0, 8),
          desired_assets: ["header", "library_hero", "capsule", "screenshots"],
        },
      ),
    );
  }

  if (hasUsableEntity && counts.store_assets < Math.min(4, entityCount)) {
    tasks.push(
      task(
        "igdb_lookup",
        "medium",
        primaryTarget,
        "IGDB can rescue missing cover art and screenshots when Steam is thin.",
        {
          queries: searchQueries.slice(0, 6),
        },
      ),
    );
  }

  if (hasUsableEntity && !hasTrailer) {
    tasks.push(
      task(
        "official_trailer_search",
        "high",
        primaryTarget,
        "No official trailer or gameplay clip is available for motion-led editing.",
        {
          queries: searchQueries.filter((query) => /official trailer|gameplay/i.test(query)).slice(0, 8),
          accepted_sources: ["official publisher channel", "Steam trailer", "platform storefront"],
        },
      ),
    );
  }

  if (hasTrailer && counts.trailer_extracted_frames < 3) {
    tasks.push(
      task(
        "trailer_frame_extract",
        "high",
        primaryTarget,
        "Trailer exists but still frames are below the render-planning minimum.",
        {
          minimum_frames: 3,
          current_frames: counts.trailer_extracted_frames,
        },
      ),
    );
  }

  if (hasTrailer && counts.total_clips < 3) {
    tasks.push(
      task(
        "clip_slice_extract",
        "high",
        primaryTarget,
        "One trailer source should become multiple clean scene-level clips.",
        {
          desired_clip_slices: 3,
          current_clips: counts.total_clips,
        },
      ),
    );
  }

  if (sourceUrl(story) && counts.article_images === 0) {
    tasks.push(
      task(
        "article_og_image_fetch",
        "medium",
        sourceUrl(story),
        "Source article may provide a relevant hero image for context cards.",
      ),
    );
  }

  if (entityCount >= 3) {
    tasks.push(
      task(
        "franchise_key_art_search",
        "medium",
        entities.slice(0, 5).join(", "),
        "Publisher/franchise stories need one relevant visual per named game or franchise.",
        {
          entities: entities.slice(0, 8),
        },
      ),
    );
  }

  if (
    /publisher_business|platform_policy|sales_milestone/i.test(
      packet.story_dossier.story_type || "",
    )
  ) {
    tasks.push(
      task(
        "publisher_press_kit_search",
        "medium",
        story?.company_name || packet.story_dossier.publisher || primaryTarget,
        "Business or platform stories need official logos and press imagery.",
        {
          queries: searchQueries.filter((query) => /press kit/i.test(query)).slice(0, 6),
        },
      ),
    );
  }

  if (thumbnailPlan.build_required) {
    tasks.push(
      task(
        "thumbnail_candidate_build",
        thumbnailPlan.safe_candidate_count > 0 ? "medium" : "high",
        thumbnailPlan.best_safe_asset || primaryTarget,
        thumbnailPlan.safe_candidate_count > 0
          ? "A thumbnail candidate is missing despite usable subject art."
          : "A thumbnail candidate is missing and must wait for safe subject art.",
        {
          safe_candidate_count: thumbnailPlan.safe_candidate_count,
          allowed_from_existing: thumbnailPlan.allowed_from_existing,
        },
      ),
    );
  }

  return tasks;
}

function candidateStorySource(candidate) {
  if (candidate.source_type.startsWith("steam_")) return "steam";
  if (candidate.source_type.startsWith("igdb_")) return "igdb";
  if (candidate.source_type.startsWith("article_")) return "article";
  if (candidate.source_type.startsWith("platform_")) return "official";
  if (candidate.source_type.startsWith("official_")) return "official";
  if (candidate.source_type === "generated_brand_card") return "generated";
  if (candidate.source_type === "stock_filler") return "unsplash";
  return "other";
}

function candidateStoryType(candidate) {
  const type = candidate.source_type;
  if (type === "steam_screenshot" || type === "igdb_screenshot") return "screenshot";
  if (type === "steam_capsule") return "steam_capsule";
  if (type === "steam_header") return "steam_header";
  if (type === "steam_library" || type === "steam_hero" || type === "igdb_cover") return "key_art";
  if (type === "article_hero") return "article_hero";
  if (type === "article_inline") return "article_inline";
  if (type === "platform_logo") return "platform_logo";
  if (type === "platform_ui") return "platform_ui";
  if (type === "generated_brand_card") return "company_logo";
  return type;
}

function simulateStoryAfterAcquisition(story, visualDeck, tasks) {
  const existingImages = normaliseAssetArray(story?.downloaded_images);
  const deckImages = visualDeck.items
    .filter((item) => item.source_type !== "generated_brand_card")
    .map((item) => ({
      type: candidateStoryType(item),
      source: candidateStorySource(item),
      path: item.local_path || item.source_url || `planned://${story?.id}/${item.source_type}_${item.order}`,
      url: item.source_url,
      entity: item.entity,
    }));
  const images = [...existingImages, ...deckImages];
  const clips = normaliseAssetArray(story?.video_clips);
  const taskTypes = new Set(tasks.map((item) => item.type));

  if (taskTypes.has("steam_store_search") && images.filter((img) => candidateStorySource({ source_type: mapSourceType(img) }) === "steam").length < 3) {
    for (let i = 1; i <= 3; i++) {
      images.push({
        type: i === 1 ? "steam_header" : "screenshot",
        source: "steam",
        path: `planned://${story?.id}/steam_asset_${i}.jpg`,
      });
    }
  }
  if (taskTypes.has("trailer_frame_extract")) {
    for (let i = 1; i <= 3; i++) {
      images.push({
        type: "trailer_frame",
        source: "trailer",
        path: `planned://${story?.id}/trailerframe_${i}.jpg`,
      });
    }
  }
  if (taskTypes.has("clip_slice_extract")) {
    for (const tag of ["A", "B", "C"]) {
      clips.push({
        type: "official_trailer",
        source: "trailer",
        path: `planned://${story?.id}/clip_${tag}.mp4`,
      });
    }
  } else if (taskTypes.has("official_trailer_search") && clips.length === 0) {
    clips.push({
      type: "official_trailer",
      source: "trailer",
      path: `planned://${story?.id}/official_trailer_reference.mp4`,
    });
  }

  return {
    ...story,
    downloaded_images: images,
    video_clips: clips,
    thumbnail_candidate_path:
      story?.thumbnail_candidate_path ||
      visualDeck.thumbnail_candidate?.local_path ||
      visualDeck.thumbnail_candidate?.source_url ||
      story?.thumbnail_path ||
      null,
  };
}

function packetSummary(packet) {
  return {
    media_verdict: packet.media_inventory.verdict,
    publish_verdict: packet.publish_readiness.verdict,
    colour: packet.publish_readiness.colour,
    format: packet.format_route.verdict,
    render_lane: packet.render_contract.render_lane,
  };
}

function buildCreatorStudioIntegration(story, visualDeck, tasks) {
  const beforePacket = buildProductionPacket(story);
  if (tasks.length === 0) {
    return {
      before: packetSummary(beforePacket),
      after: packetSummary(beforePacket),
      improved: false,
      simulated_media_counts: scoreStoryMediaInventory(story).counts,
      note: "No acquisition tasks were planned, so the Creator Studio estimate is unchanged.",
    };
  }
  const simulated = simulateStoryAfterAcquisition(story, visualDeck, tasks);
  const afterPacket = buildProductionPacket(simulated);
  const before = packetSummary(beforePacket);
  const after = packetSummary(afterPacket);
  const rank = { RED: 0, AMBER: 1, GREEN: 2 };
  const improved =
    rank[after.colour] > rank[before.colour] ||
    before.media_verdict !== after.media_verdict ||
    before.format !== after.format;
  return {
    before,
    after,
    improved,
    simulated_media_counts: scoreStoryMediaInventory(simulated).counts,
    note: "After state is an estimate from the visual deck and planned safe local acquisition work. No story rows are mutated.",
  };
}

function buildAssetAcquisitionPlan(story, options = {}) {
  const packet = buildProductionPacket(story);
  const media = scoreStoryMediaInventory(story);
  const thumbnailPlan = buildThumbnailPlan(story);
  const entityMap = buildEntityMap(story);
  const entities = entityMap.all.slice(0, 8);
  const searchQueries = buildSearchQueries(story, entities);
  const candidates = buildCandidateLedger(story, entityMap);
  const tasks = buildTasks(story, packet, media, thumbnailPlan, entities, searchQueries, candidates);
  const visualDeck = buildVisualDeck(story, candidates, tasks);
  const exactSubjectReadiness = buildExactSubjectReadiness(story, candidates, {
    fallbackCardsUsed: visualDeck.fallback_cards_used,
  });
  const trailerFramePlan = buildTrailerFramePlan(story, candidates, tasks);
  const creatorStudioIntegration = buildCreatorStudioIntegration(story, visualDeck, tasks);
  const highPriorityCount = tasks.filter((item) => item.priority === "high").length;
  const acquisitionVerdict =
    packet.story_dossier.topicality_verdict === "reject"
      ? "reject"
      : tasks.length === 0
        ? "maintain"
        : "acquire";
  const reasons = [];
  if (packet.story_dossier.topicality_verdict === "reject") reasons.push("off_brand_story");
  if (media.classification === "blog_only") reasons.push("no_visual_inventory");
  if (media.classification === "briefing_item") reasons.push("thin_visual_inventory");
  if (media.classification === "reject_visuals") reasons.push("visual_safety_failure");
  if (thumbnailPlan.rejected_candidate_count > 0) reasons.push("thumbnail_safety_replacements_needed");
  if (highPriorityCount > 0) reasons.push(`${highPriorityCount}_high_priority_asset_task(s)`);

  return {
    schema_version: 3,
    execution_mode: options.executionMode || "plan_only",
    will_download: false,
    will_mutate_story: false,
    story_id: story?.id || null,
    title: story?.title || "",
    topicality_verdict: packet.story_dossier.topicality_verdict,
    story_type: packet.story_dossier.story_type,
    entities,
    entity_map: entityMap,
    source_url: sourceUrl(story),
    acquisition_verdict: acquisitionVerdict,
    asset_budget_class: classifyBudget({ packet, media, tasks }),
    readiness_after_acquisition: estimateReadiness({ packet, media, tasks }),
    source_priorities: SOURCE_PRIORITIES,
    media_source_registry: MEDIA_SOURCE_REGISTRY,
    media_inventory: {
      classification: media.classification,
      creator_studio_verdict: packet.media_inventory.verdict,
      counts: media.counts,
      scores: media.scores,
      reasons: media.classificationReasons,
      exact_subject: exactSubjectReadiness,
    },
    candidates,
    media_provenance: candidates,
    exact_subject_readiness: exactSubjectReadiness,
    thumbnail_plan: thumbnailPlan,
    trailer_frame_plan: trailerFramePlan,
    visual_deck: visualDeck,
    creator_studio_before: creatorStudioIntegration.before,
    creator_studio_after: creatorStudioIntegration.after,
    creator_studio_integration: creatorStudioIntegration,
    search_queries: searchQueries,
    tasks,
    reasons,
    safety: {
      no_browser_cookie_automation: true,
      no_oauth: true,
      no_env_mutation: true,
      no_downloads_in_this_command: true,
      no_production_db_mutation: true,
      no_production_render_switch: true,
      no_hard_gate_enabled: true,
    },
    notes: [
      "This is a reporting layer only. It does not download, render, publish, mutate OAuth, touch Railway or change scheduler behaviour.",
      "Prefer official trailers, storefront media and publisher assets before article imagery or generic fallback visuals.",
    ],
  };
}

function buildAssetAcquisitionControlRoom(stories = [], options = {}) {
  const plans = (Array.isArray(stories) ? stories : []).map((story) =>
    buildAssetAcquisitionPlan(story, options),
  );
  const summary = {
    total_stories: plans.length,
    acquire: plans.filter((plan) => plan.acquisition_verdict === "acquire").length,
    maintain: plans.filter((plan) => plan.acquisition_verdict === "maintain").length,
    reject: plans.filter((plan) => plan.acquisition_verdict === "reject").length,
    high_priority_tasks: plans.reduce(
      (sum, plan) => sum + plan.tasks.filter((taskItem) => taskItem.priority === "high").length,
      0,
    ),
    improved_after_estimate: plans.filter((plan) => plan.creator_studio_integration.improved).length,
    total_candidates: plans.reduce((sum, plan) => sum + plan.candidates.length, 0),
    deck_items: plans.reduce((sum, plan) => sum + plan.visual_deck.items.length, 0),
  };

  const overall_status =
    summary.reject > 0 ? "RED" : summary.acquire > 0 ? "AMBER" : "GREEN";
  const exactSubjectSummary = summariseExactSubjectPlans(plans);
  const storeVerificationSummary = summariseStoreVerificationPlans(plans);

  return {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    execution_mode: "plan_only",
    will_download: false,
    overall_status,
    summary,
    exact_subject_summary: exactSubjectSummary,
    store_verification_summary: storeVerificationSummary,
    media_source_registry: MEDIA_SOURCE_REGISTRY,
    plans,
    notes: [
      "Plan-only control report. No asset acquisition has been executed.",
      "Use this to decide which stories deserve a premium asset pass before rendering.",
    ],
  };
}

function renderAssetAcquisitionMarkdown(report) {
  const lines = [];
  lines.push("# Asset Acquisition Pro v1 Control Room");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Execution mode: ${report.execution_mode}`);
  lines.push(`Will download: ${report.will_download}`);
  lines.push(`Overall: ${report.overall_status}`);
  if (report.exact_subject_summary) {
    lines.push(`Studio V2 60s eligible: ${report.exact_subject_summary.studio_v2_60s_eligible}`);
    lines.push(`Premium candidates: ${report.exact_subject_summary.premium_candidates}`);
  }
  lines.push("");
  lines.push("| story | verdict | budget | exact | runtime | v2 60s | before | after | deck | high tasks | key tasks |");
  lines.push("| --- | --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- |");
  for (const plan of report.plans) {
    const high = plan.tasks.filter((item) => item.priority === "high").length;
    const keyTasks = plan.tasks
      .slice(0, 5)
      .map((item) => item.type)
      .join(", ") || "none";
    const exact = plan.exact_subject_readiness || {};
    lines.push(
      [
        plan.story_id,
        plan.acquisition_verdict,
        plan.asset_budget_class,
        exact.exact_subject_asset_count || 0,
        exact.recommended_runtime_class || "unknown",
        exact.studio_v2_60s_eligible === true,
        `${plan.creator_studio_before.colour}/${plan.creator_studio_before.media_verdict}`,
        `${plan.creator_studio_after.colour}/${plan.creator_studio_after.media_verdict}`,
        plan.visual_deck.items.length,
        high,
        keyTasks,
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- No downloads, OAuth actions, Railway changes, database writes or publishing are performed.");
  lines.push("- Every task in this report is a proposed acquisition step for a later approved local worker.");
  lines.push("- Before/after readiness is simulated from the visual deck and planned safe acquisition tasks.");
  return lines.join("\n") + "\n";
}

function renderExactSubjectMarkdown(report) {
  const lines = [];
  lines.push("# Asset Acquisition Pro v1.2 - Exact-Subject Still Matching");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "pending"}`);
  lines.push(`Execution mode: ${report.execution_mode || "plan_only"}`);
  lines.push(`Overall: ${report.overall_status || "unknown"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  const summary = report.exact_subject_summary || {};
  lines.push(`- stories: ${summary.stories || 0}`);
  lines.push(`- Studio V2 60s eligible: ${summary.studio_v2_60s_eligible || 0}`);
  lines.push(`- premium candidates: ${summary.premium_candidates || 0}`);
  lines.push(`- exact-subject assets: ${summary.exact_subject_assets || 0}`);
  lines.push(`- generic/context assets: ${summary.generic_context_assets || 0}`);
  lines.push(`- downgraded stories: ${summary.downgraded || 0}`);
  lines.push("");
  lines.push("## Story Verdicts");
  lines.push("");
  lines.push("| story | exact | groups | context | repeated | runtime | v2 60s | counted | disqualified | reasons |");
  lines.push("| --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- |");
  for (const plan of report.plans || []) {
    const exact = plan.exact_subject_readiness || {};
    const counted = (plan.candidates || [])
      .filter((candidate) => candidate.counted_for_premium)
      .map((candidate) => `${candidate.exact_subject_group || candidate.entity}:${candidate.source_type}`)
      .slice(0, 4)
      .join(", ") || "none";
    const disqualified = (plan.candidates || [])
      .filter((candidate) => !candidate.counted_for_premium)
      .map((candidate) => `${candidate.subject_match_quality || "unknown"}:${candidate.source_type}`)
      .slice(0, 4)
      .join(", ") || "none";
    lines.push(
      [
        plan.story_id,
        exact.exact_subject_asset_count || 0,
        exact.unique_exact_subject_groups || 0,
        exact.generic_context_asset_count || 0,
        exact.repeated_asset_pairs || 0,
        exact.recommended_runtime_class || "unknown",
        exact.studio_v2_60s_eligible === true,
        counted,
        disqualified,
        (exact.downgrade_reasons || []).join(", ") || "clear",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  lines.push("");
  lines.push("## Why v1 Still-Deck Ingestion Failed");
  lines.push("");
  lines.push("- Generic Steam, platform and article-context assets could inflate apparent media readiness.");
  lines.push("- A still-only deck can repeat the same subject too often unless exact subject groups and repeated pairs are measured.");
  lines.push("- Publisher logos and article heroes can support context cards, but they are not premium subject visuals.");
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local/reporting only.");
  lines.push("- No trailer/video downloads, yt-dlp, browser scraping, Railway changes, OAuth, DB mutation, hard gates or posting.");
  return lines.join("\n") + "\n";
}

function renderStoreVerificationMarkdown(report) {
  const lines = [];
  lines.push("# Asset Acquisition Pro v1.3 - Exact Store App Verification");
  lines.push("");
  lines.push(`Generated: ${report.generated_at || "pending"}`);
  lines.push(`Execution mode: ${report.execution_mode || "plan_only"}`);
  lines.push("");
  const summary = report.store_verification_summary || {};
  lines.push("## Summary");
  lines.push("");
  lines.push(`- store assets: ${summary.store_assets || 0}`);
  lines.push(`- verified: ${summary.verified || 0}`);
  lines.push(`- mismatch: ${summary.mismatch || 0}`);
  lines.push(`- missing title/slug provenance: ${summary.missing_title || 0}`);
  lines.push(`- Steam assets: ${summary.steam_assets || 0}`);
  lines.push(`- IGDB assets: ${summary.igdb_assets || 0}`);
  lines.push("");
  lines.push("| story | source | app id | app title/slug | query | status | counted | reason |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const plan of report.plans || []) {
    for (const candidate of plan.candidates || []) {
      if (!candidate.store_asset_source) continue;
      lines.push(
        [
          plan.story_id,
          candidate.store_asset_source,
          candidate.store_app_id || "",
          candidate.store_app_title || candidate.store_app_slug || "",
          candidate.store_matched_query || "",
          candidate.store_match_status,
          candidate.counted_for_premium === true,
          candidate.store_match_reason || candidate.rejection_or_downgrade_reason || "",
        ]
          .map((value) => String(value ?? "").replace(/\|/g, "/"))
          .join(" | ")
          .replace(/^/, "| ")
          .replace(/$/, " |"),
      );
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Local/reporting only.");
  lines.push("- No network lookup, downloads, Railway changes, OAuth, DB mutation, hard gates or posting.");
  lines.push("- Assets without verified app title/slug provenance are not counted as premium subject media.");
  return lines.join("\n") + "\n";
}

function buildVisualDeckMarkdown(plan) {
  const lines = [];
  lines.push(`# Visual Deck - ${plan.story_id}`);
  lines.push("");
  lines.push(`- verdict: ${plan.acquisition_verdict}`);
  lines.push(`- before: ${plan.creator_studio_before.colour} / ${plan.creator_studio_before.media_verdict}`);
  lines.push(`- after estimate: ${plan.creator_studio_after.colour} / ${plan.creator_studio_after.media_verdict}`);
  lines.push(`- first frame safe: ${plan.visual_deck.first_frame_safe}`);
  lines.push(`- thumbnail safe: ${plan.visual_deck.thumbnail_candidate_safe}`);
  lines.push("");
  lines.push("| order | entity | source | match | premium | standard | score | risk | path/url |");
  lines.push("| ---: | --- | --- | --- | --- | --- | ---: | --- | --- |");
  for (const item of plan.visual_deck.items) {
    lines.push(
      [
        item.order,
        item.entity || "story",
        item.source_type,
        item.subject_match_quality || "unknown",
        item.counted_for_premium === true,
        item.counted_for_standard === true,
        item.score,
        item.rights_risk_class,
        item.local_path || item.source_url || "planned",
      ]
        .map((value) => String(value ?? "").replace(/\|/g, "/"))
        .join(" | ")
        .replace(/^/, "| ")
        .replace(/$/, " |"),
    );
  }
  return lines.join("\n") + "\n";
}

module.exports = {
  buildAssetAcquisitionControlRoom,
  buildAssetAcquisitionPlan,
  buildVisualDeckMarkdown,
  MEDIA_SOURCE_REGISTRY,
  renderExactSubjectMarkdown,
  renderStoreVerificationMarkdown,
  renderAssetAcquisitionMarkdown,
};
