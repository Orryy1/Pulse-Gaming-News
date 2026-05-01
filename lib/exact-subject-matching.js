"use strict";

const EXACT_MATCH_QUALITIES = Object.freeze({
  EXACT_GAME: "exact_game_match",
  EXACT_FRANCHISE: "exact_franchise_match",
  EXACT_PLATFORM: "exact_platform_match",
  PUBLISHER_CONTEXT: "publisher_context_only",
  ARTICLE_CONTEXT: "article_context_only",
  GENERIC_STORE: "generic_store_asset",
  GENERIC_STOCK: "generic_stock_or_filler",
  UNSAFE: "unsafe_or_rejected",
});

const GAME_DEFS = Object.freeze([
  entityDef("GTA", ["gta", "gta 6", "grand theft auto"]),
  entityDef("BioShock", ["bioshock", "bio shock"]),
  entityDef("MindsEye", ["mindseye", "minds eye"]),
  entityDef("Pokemon", ["pokemon", "pokémon"]),
  entityDef("Zelda", ["zelda", "legend of zelda"]),
  entityDef("Metro", ["metro 2033", "metro exodus", "metro"]),
]);

const FRANCHISE_DEFS = Object.freeze([
  entityDef("Red Dead", ["red dead", "red dead redemption"]),
  entityDef("BioShock", ["bioshock", "bio shock"]),
  entityDef("Grand Theft Auto", ["grand theft auto", "gta"]),
  entityDef("Pokemon", ["pokemon", "pokémon"]),
  entityDef("Metro", ["metro"]),
]);

const PLATFORM_DEFS = Object.freeze([
  entityDef("Xbox", ["xbox", "game pass", "xbox game pass"]),
  entityDef("PlayStation", ["playstation", "ps5", "ps4", "ps plus"]),
  entityDef("Nintendo Switch", ["nintendo switch", "switch"]),
  entityDef("Nintendo", ["nintendo"]),
  entityDef("Steam", ["steam"]),
  entityDef("PC", ["pc"]),
  entityDef("Game Pass", ["game pass"]),
]);

const PUBLISHER_DEFS = Object.freeze([
  entityDef("Take-Two", ["take two", "take-two", "take2"]),
  entityDef("Rockstar", ["rockstar", "rockstar games"]),
  entityDef("Niantic", ["niantic"]),
  entityDef("Nintendo", ["nintendo"]),
  entityDef("Microsoft", ["microsoft"]),
  entityDef("Sony", ["sony"]),
]);

function entityDef(name, variants) {
  return { name, variants };
}

function normalise(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&amp;/gi, "and")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function safeArray(value) {
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
    return [value];
  }
  if (typeof value === "object") return [value];
  return [];
}

function entityValue(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return value.name || value.title || value.label || value.game || value.franchise || value.platform || null;
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
    story?.company_name,
    story?.publisher,
    story?.developer,
    story?.subreddit,
  ]
    .filter(Boolean)
    .join(" ");
}

function addUnique(out, value) {
  const label = String(value || "").trim();
  if (!label) return;
  const key = normalise(label);
  if (!key) return;
  if (!out.some((item) => normalise(item) === key)) out.push(label);
}

function detectByDefs(text, defs) {
  const nText = normalise(text);
  const out = [];
  for (const def of defs) {
    if (def.variants.some((variant) => containsTerm(nText, normalise(variant)))) {
      addUnique(out, def.name);
    }
  }
  return out;
}

function containsTerm(haystack, needle) {
  if (!needle) return false;
  const padded = ` ${haystack} `;
  return padded.includes(` ${needle} `);
}

function arrayEntities(story, key) {
  return safeArray(story?.[key]).map(entityValue).filter(Boolean);
}

function buildSubjectGraph(story) {
  const text = storyText(story);
  const games = [];
  const franchises = [];
  const platforms = [];
  const publishers = [];

  for (const value of [...detectByDefs(text, GAME_DEFS), ...arrayEntities(story, "games")]) {
    addUnique(games, value);
  }
  for (const value of [
    ...detectByDefs(text, FRANCHISE_DEFS),
    ...arrayEntities(story, "franchises"),
  ]) {
    addUnique(franchises, value);
  }
  for (const value of [
    ...detectByDefs(text, PLATFORM_DEFS),
    ...arrayEntities(story, "platforms"),
  ]) {
    addUnique(platforms, value);
  }
  for (const value of [
    ...detectByDefs(text, PUBLISHER_DEFS),
    ...arrayEntities(story, "publishers"),
    story?.company_name,
    story?.publisher,
    story?.developer,
  ]) {
    addUnique(publishers, value);
  }

  const storyType = String(story?.story_type || story?.classification || "").toLowerCase();
  const platformStory =
    /platform|policy|pricing|subscription/.test(storyType) ||
    /\b(game pass|ps plus|playstation plus|nintendo switch online|xbox pricing|subscription)\b/i.test(text);

  const all = [];
  for (const group of [games, franchises, platforms, publishers]) {
    for (const value of group) addUnique(all, value);
  }

  return {
    games,
    franchises,
    platforms,
    publishers,
    all,
    platform_story: platformStory,
    required_subject_groups: requiredSubjectGroups({ games, franchises }),
  };
}

function requiredSubjectGroups({ games, franchises }) {
  const out = [];
  for (const value of [...games, ...franchises]) addUnique(out, canonicalGroup(value));
  return out;
}

function assetSubjectText(asset) {
  return [
    asset?.entity,
    asset?.game,
    asset?.game_title,
    asset?.app_title,
    asset?.store_app_title,
    asset?.steam_app_title,
    asset?.igdb_title,
    asset?.igdb_slug,
    asset?.store_matched_query,
    asset?.steam_matched_query,
    asset?.matched_query,
    asset?.franchise,
    asset?.publisher,
    asset?.platform,
    asset?.title,
    asset?.label,
    asset?.name,
    asset?.source_url,
    asset?.url,
    asset?.local_path,
    asset?.path,
    asset?.raw?.title,
  ]
    .filter(Boolean)
    .join(" ");
}

function inferSourceType(asset) {
  const sourceType = String(asset?.source_type || "").toLowerCase();
  if (sourceType) return sourceType;
  const type = String(asset?.type || asset?.kind || "").toLowerCase();
  const source = String(asset?.source || "").toLowerCase();
  const text = normalise(assetSubjectText(asset));

  if (asset?.unsafe === true) return "unsafe";
  if (asset?.stock === true || ["pexels", "unsplash", "stock"].includes(source)) return "stock_filler";
  if (/trailer frame|trailer_frame|frame/.test(type)) return "trailer_frame";
  if (/clip|trailer|gameplay|movie|video/.test(type) || /\.(mp4|webm|mov)(?:$|\?)/i.test(String(asset?.path || asset?.url || ""))) {
    return source === "igdb" ? "igdb_video" : "official_video_reference";
  }
  if (source === "steam" || containsTerm(text, "steam")) {
    if (/header/.test(type)) return "steam_header";
    if (/library/.test(type)) return "steam_library";
    if (/hero|key/.test(type)) return "steam_hero";
    if (/capsule|cover/.test(type)) return "steam_capsule";
    return "steam_screenshot";
  }
  if (source === "igdb" || containsTerm(text, "igdb")) {
    if (/screenshot|screen/.test(type)) return "igdb_screenshot";
    return "igdb_cover";
  }
  if (source === "article" || /article/.test(type)) return /inline/.test(type) ? "article_inline" : "article_hero";
  if (/platform.*ui|dashboard|store ui/.test(type)) return "platform_ui";
  if (/platform.*logo|company_logo|logo/.test(type) || source === "logo") return "platform_logo";
  if (source === "generated" || /generated|brand.*card|card/.test(type)) return "generated_brand_card";
  if (source === "publisher" || source === "official") return "official_publisher_image";
  if (source === "developer") return "official_developer_image";
  return "article_hero";
}

function sourceBucket(sourceType) {
  if (/^steam_|^igdb_/.test(sourceType)) return "storefront";
  if (/^article_/.test(sourceType)) return "article";
  if (/platform_/.test(sourceType)) return "platform";
  if (/official_|publisher|developer/.test(sourceType)) return "official";
  if (/generated|stock/.test(sourceType)) return "fallback";
  return "other";
}

function findMatch(text, values) {
  const nText = normalise(text);
  for (const value of values || []) {
    const nValue = normalise(value);
    if (!nValue) continue;
    if (containsTerm(nText, nValue)) return value;
    const compact = nValue.replace(/\s+/g, "");
    if (compact.length >= 4 && nText.replace(/\s+/g, "").includes(compact)) return value;
  }
  return null;
}

function canonicalGroup(value) {
  const n = normalise(value);
  if (!n) return null;
  if (containsTerm(n, "grand theft auto") || containsTerm(n, "gta")) return "GTA";
  if (containsTerm(n, "red dead")) return "Red Dead";
  if (containsTerm(n, "bioshock") || containsTerm(n, "bio shock")) return "BioShock";
  if (containsTerm(n, "pokemon")) return "Pokemon";
  if (containsTerm(n, "xbox") || containsTerm(n, "game pass")) return "Xbox";
  if (containsTerm(n, "playstation") || containsTerm(n, "ps5") || containsTerm(n, "ps4")) return "PlayStation";
  if (containsTerm(n, "nintendo switch") || n === "switch") return "Nintendo Switch";
  if (containsTerm(n, "steam")) return "Steam";
  return String(value || "").trim();
}

function isVideoOrFrame(sourceType) {
  return /trailer|movie|video|clip|frame/.test(String(sourceType || ""));
}

function isStill(sourceType) {
  return !isVideoOrFrame(sourceType);
}

function isUnsafeAsset(asset, sourceType) {
  const verdict = asset?.thumbnail_safety_verdict || {};
  return (
    asset?.unsafe === true ||
    sourceType === "unsafe" ||
    verdict.safeForThumbnail === false && verdict.isLikelyHuman === true ||
    asset?.human === true && (asset?.stock === true || sourceType === "stock_filler")
  );
}

function classifySubjectMatch(story, asset, subjectGraph = buildSubjectGraph(story)) {
  const sourceType = inferSourceType(asset);
  const storeVerification = verifyStoreAsset(asset, subjectGraph, sourceType);
  const text = [assetSubjectText(asset), storeVerification.store_app_title, storeVerification.store_matched_query]
    .filter(Boolean)
    .join(" ");
  const bucket = sourceBucket(sourceType);

  if (isUnsafeAsset(asset, sourceType)) {
    return subjectResult(
      EXACT_MATCH_QUALITIES.UNSAFE,
      "Rejected because the asset is unsafe, human/profile-like or already failed safety checks.",
      null,
      false,
      false,
      storeVerification,
    );
  }

  if (sourceType === "stock_filler") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.GENERIC_STOCK,
      "Stock/filler media can only be used as a last-resort context visual.",
      null,
      false,
      false,
      storeVerification,
    );
  }

  if (sourceType === "generated_brand_card") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.GENERIC_STOCK,
      "Generated fallback cards do not count as subject media.",
      null,
      false,
      true,
      storeVerification,
    );
  }

  if (bucket === "article") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.ARTICLE_CONTEXT,
      "Article imagery supports source context but is not exact-subject premium inventory.",
      null,
      false,
      true,
      storeVerification,
    );
  }

  if (storeVerification.store_asset && storeVerification.store_match_status !== "verified") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.GENERIC_STORE,
      storeVerification.store_match_reason,
      null,
      false,
      false,
      storeVerification,
      storeVerification.store_match_status === "missing_title"
        ? "store_app_title_missing"
        : "store_app_title_mismatch",
    );
  }

  const gameMatch = findMatch(text, subjectGraph.games);
  if (gameMatch) {
    return subjectResult(
      EXACT_MATCH_QUALITIES.EXACT_GAME,
      `Asset text/entity matches game subject "${gameMatch}".`,
      canonicalGroup(gameMatch),
      true,
      true,
      storeVerification,
    );
  }

  const franchiseMatch = findMatch(text, subjectGraph.franchises);
  if (franchiseMatch) {
    return subjectResult(
      EXACT_MATCH_QUALITIES.EXACT_FRANCHISE,
      `Asset text/entity matches franchise subject "${franchiseMatch}".`,
      canonicalGroup(franchiseMatch),
      true,
      true,
      storeVerification,
    );
  }

  const platformMatch = findMatch(text, subjectGraph.platforms);
  if (platformMatch && subjectGraph.platform_story && bucket === "platform") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.EXACT_PLATFORM,
      `Platform asset matches platform story subject "${platformMatch}".`,
      canonicalGroup(platformMatch),
      true,
      true,
      storeVerification,
    );
  }

  const publisherMatch = findMatch(text, subjectGraph.publishers);
  if (publisherMatch || bucket === "official") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.PUBLISHER_CONTEXT,
      publisherMatch
        ? `Asset only matches publisher/context entity "${publisherMatch}".`
        : "Official/publisher image does not match a specific game or franchise subject.",
      publisherMatch ? canonicalGroup(publisherMatch) : null,
      false,
      true,
      storeVerification,
    );
  }

  if (bucket === "storefront" || bucket === "platform") {
    return subjectResult(
      EXACT_MATCH_QUALITIES.GENERIC_STORE,
      "Storefront/platform media does not match a story game, franchise or valid platform subject.",
      null,
      false,
      false,
      storeVerification,
    );
  }

  return subjectResult(
    EXACT_MATCH_QUALITIES.ARTICLE_CONTEXT,
    "Asset is contextual only and does not match a specific subject.",
    null,
    false,
    true,
    storeVerification,
  );
}

function subjectResult(quality, reason, group, premium, standard, storeVerification = null, overrideDowngradeReason = null) {
  return {
    subject_match_quality: quality,
    subject_match_reason: reason,
    exact_subject_group: group,
    counted_for_premium: Boolean(premium),
    counted_for_standard: Boolean(standard || premium),
    ...(storeVerification ? compactStoreVerification(storeVerification) : {}),
    rejection_or_downgrade_reason:
      premium ? null : overrideDowngradeReason || downgradeReasonForQuality(quality),
  };
}

function compactStoreVerification(verification) {
  return {
    store_asset_source: verification.store_asset_source,
    store_app_id: verification.store_app_id,
    store_app_title: verification.store_app_title,
    store_app_slug: verification.store_app_slug,
    store_matched_query: verification.store_matched_query,
    store_match_status: verification.store_match_status,
    store_match_verified: verification.store_match_verified,
    store_match_reason: verification.store_match_reason,
  };
}

function verifyStoreAsset(asset, subjectGraph, sourceType = inferSourceType(asset)) {
  const storeAssetSource = sourceType.startsWith("steam_")
    ? "steam"
    : sourceType.startsWith("igdb_")
      ? "igdb"
      : null;
  if (!storeAssetSource) {
    return {
      store_asset: false,
      store_asset_source: null,
      store_app_id: null,
      store_app_title: null,
      store_app_slug: null,
      store_matched_query: null,
      store_match_status: "not_store_asset",
      store_match_verified: false,
      store_match_reason: "Not a Steam or IGDB storefront asset.",
    };
  }

  const appId = String(
    asset?.store_app_id ||
      asset?.steam_app_id ||
      asset?.steam_appid ||
      asset?.app_id ||
      asset?.appid ||
      asset?.igdb_id ||
      extractSteamAppId(asset?.source_url || asset?.url || asset?.local_path || asset?.path) ||
      "",
  ).trim() || null;
  const appTitle = String(
    asset?.store_app_title ||
      asset?.steam_app_title ||
      asset?.igdb_title ||
      asset?.app_title ||
      asset?.game_title ||
      "",
  ).trim() || null;
  const slug = String(asset?.store_app_slug || asset?.igdb_slug || asset?.slug || "").trim() || null;
  const matchedQuery = String(
    asset?.store_matched_query ||
      asset?.steam_matched_query ||
      asset?.igdb_matched_query ||
      asset?.matched_query ||
      asset?.search_query ||
      asset?.query ||
      "",
  ).trim() || null;

  if (!appTitle && !slug) {
    return {
      store_asset: true,
      store_asset_source: storeAssetSource,
      store_app_id: appId,
      store_app_title: appTitle,
      store_app_slug: slug,
      store_matched_query: matchedQuery,
      store_match_status: "missing_title",
      store_match_verified: false,
      store_match_reason: `${storeAssetSource.toUpperCase()} asset is missing verified app title/slug provenance.`,
    };
  }

  const haystack = [appTitle, slug].filter(Boolean).join(" ");
  const subjectValues = [
    ...subjectGraph.games,
    ...subjectGraph.franchises,
    ...(subjectGraph.platform_story ? subjectGraph.platforms : []),
  ];
  const subjectMatch = findMatch(haystack, subjectValues);
  if (subjectMatch) {
    return {
      store_asset: true,
      store_asset_source: storeAssetSource,
      store_app_id: appId,
      store_app_title: appTitle,
      store_app_slug: slug,
      store_matched_query: matchedQuery,
      store_match_status: "verified",
      store_match_verified: true,
      store_match_reason: `${storeAssetSource.toUpperCase()} app title/slug matches story subject "${subjectMatch}".`,
    };
  }

  return {
    store_asset: true,
    store_asset_source: storeAssetSource,
    store_app_id: appId,
    store_app_title: appTitle,
    store_app_slug: slug,
    store_matched_query: matchedQuery,
    store_match_status: "mismatch",
    store_match_verified: false,
    store_match_reason: `${storeAssetSource.toUpperCase()} app title/slug "${appTitle || slug}" does not match a story subject.`,
  };
}

function extractSteamAppId(value) {
  const match = String(value || "").match(/\/apps\/(\d+)\//i) || String(value || "").match(/\/app\/(\d+)(?:\/|$)/i);
  return match ? match[1] : null;
}

function downgradeReasonForQuality(quality) {
  return {
    [EXACT_MATCH_QUALITIES.PUBLISHER_CONTEXT]: "publisher_only_not_premium_subject",
    [EXACT_MATCH_QUALITIES.ARTICLE_CONTEXT]: "article_only_not_premium_subject",
    [EXACT_MATCH_QUALITIES.GENERIC_STORE]: "generic_store_not_subject_matched",
    [EXACT_MATCH_QUALITIES.GENERIC_STOCK]: "fallback_or_stock_not_premium_subject",
    [EXACT_MATCH_QUALITIES.UNSAFE]: "unsafe_or_rejected_asset",
  }[quality] || null;
}

function annotateCandidate(story, candidate, subjectGraph = buildSubjectGraph(story)) {
  const subject = classifySubjectMatch(story, candidate, subjectGraph);
  return {
    ...candidate,
    ...subject,
  };
}

function assetIdentity(candidate) {
  return (
    candidate.duplicate_hash ||
    candidate.content_hash ||
    candidate.hash ||
    candidate.source_url ||
    candidate.url ||
    candidate.local_path ||
    candidate.path ||
    candidate.id ||
    null
  );
}

function repeatedPairs(candidates) {
  const counts = new Map();
  for (const candidate of candidates) {
    const key = assetIdentity(candidate);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  let pairs = 0;
  for (const count of counts.values()) {
    if (count > 1) pairs += (count * (count - 1)) / 2;
  }
  return pairs;
}

function collectStoryAssets(story) {
  const assets = [];
  const push = (value) => {
    for (const item of safeArray(value)) assets.push(item);
  };
  push(story?.downloaded_images);
  push(story?.game_images);
  push(story?.media_candidates);
  push(story?.article_inline_images);
  push(story?.video_clips);
  push(story?.igdb_assets);
  if (story?.article_image) {
    assets.push({ source: "article", type: "article_hero", url: story.article_image });
  }
  if (story?.company_logo_url) {
    assets.push({ source: "official", type: "company_logo", url: story.company_logo_url, entity: story?.company_name });
  }
  return assets.map((asset, index) => ({
    id: asset.id || `story_asset_${index}`,
    source_type: inferSourceType(asset),
    source_url: asset.source_url || asset.url || null,
    local_path: asset.local_path || asset.path || null,
    entity: asset.entity || asset.game || asset.game_title || asset.franchise || asset.platform || asset.publisher || null,
    accepted: asset.accepted !== false,
    thumbnail_safety_verdict: asset.thumbnail_safety_verdict || { safeForThumbnail: true },
    ...asset,
  }));
}

function buildExactSubjectReadiness(story, candidates = null, options = {}) {
  const subjectGraph = options.subjectGraph || buildSubjectGraph(story);
  const annotated = (Array.isArray(candidates) && candidates.length > 0 ? candidates : collectStoryAssets(story))
    .map((candidate) => annotateCandidate(story, candidate, subjectGraph));
  const usable = annotated.filter((candidate) => candidate.accepted !== false);
  const premium = usable.filter((candidate) => candidate.counted_for_premium);
  const exactStills = premium.filter((candidate) => isStill(candidate.source_type));
  const exactClipsOrFrames = premium.filter((candidate) => isVideoOrFrame(candidate.source_type));
  const genericContext = usable.filter((candidate) => !candidate.counted_for_premium);
  const exactGroups = Array.from(
    new Set(premium.map((candidate) => candidate.exact_subject_group).filter(Boolean)),
  );
  const missingGroups = subjectGraph.required_subject_groups.filter(
    (group) => !exactGroups.some((exact) => normalise(exact) === normalise(group)),
  );
  const repeated = repeatedPairs(premium);
  const fallbackCardsUsed = Number(
    options.fallbackCardsUsed ?? annotated.filter((candidate) => candidate.source_type === "generated_brand_card").length,
  );
  const unsafeThumbnailCritical = annotated.some(
    (candidate) =>
      candidate.subject_match_quality === EXACT_MATCH_QUALITIES.UNSAFE &&
      candidate.thumbnail_eligible !== false,
  );
  const contextCount = genericContext.filter((candidate) => candidate.counted_for_standard).length;
  const sceneBeatCapacity = exactStills.length * 2 + exactClipsOrFrames.length * 2 + Math.min(contextCount, 2);
  const hasFourExactStills = exactStills.length >= 4;
  const hasTwoExactAndTwoMotion = exactStills.length >= 2 && exactClipsOrFrames.length >= 2;
  const hasEnoughGroups = exactGroups.length >= 3 || subjectGraph.required_subject_groups.length <= 1 && exactGroups.length >= 1;
  const repeatedThreshold = Number(options.repeatedPairThreshold ?? 2);
  const downgradeReasons = [];

  if (!hasFourExactStills && !hasTwoExactAndTwoMotion) {
    downgradeReasons.push("needs_4_exact_stills_or_2_with_2_clips_frames");
  }
  if (!hasEnoughGroups) downgradeReasons.push("needs_3_unique_exact_subject_groups");
  if (repeated > repeatedThreshold) downgradeReasons.push("repeated_asset_pairs_above_threshold");
  if (unsafeThumbnailCritical) downgradeReasons.push("unsafe_thumbnail_critical_frame");
  if (fallbackCardsUsed > 1) downgradeReasons.push("generic_fallback_cards_exceed_limit");
  if (sceneBeatCapacity < 8) downgradeReasons.push("cannot_cover_8_distinct_scene_beats");
  if (subjectGraph.required_subject_groups.length >= 2 && missingGroups.length > 0) {
    downgradeReasons.push(`missing_exact_subject_groups:${missingGroups.join(",")}`);
  }

  const recommended = recommendRuntime({
    exactSubjectAssets: exactStills.length,
    exactMotionAssets: exactClipsOrFrames.length,
    unsafeThumbnailCritical,
  });
  const studioEligible = downgradeReasons.length === 0;

  return {
    schema_version: 1,
    exact_subject_asset_count: exactStills.length,
    approved_clip_frame_count: exactClipsOrFrames.length,
    generic_context_asset_count: genericContext.length,
    premium_countable_asset_count: premium.length,
    standard_countable_asset_count: usable.filter((candidate) => candidate.counted_for_standard).length,
    unique_exact_subject_groups: exactGroups.length,
    exact_subject_groups: exactGroups,
    required_subject_groups: subjectGraph.required_subject_groups,
    missing_exact_subject_groups: missingGroups,
    repeated_asset_pairs: repeated,
    repeated_asset_pair_threshold: repeatedThreshold,
    fallback_cards_used: fallbackCardsUsed,
    scene_beat_capacity: sceneBeatCapacity,
    can_cover_8_distinct_scene_beats: sceneBeatCapacity >= 8,
    unsafe_thumbnail_critical_frame: unsafeThumbnailCritical,
    studio_v2_60s_eligible: studioEligible,
    studio_v2_premium_candidate: studioEligible && recommended.recommended_format === "premium_short",
    recommended_runtime_class: recommended.recommended_runtime_class,
    recommended_runtime_seconds: recommended.recommended_runtime_seconds,
    recommended_format: recommended.recommended_format,
    downgrade_reasons: downgradeReasons,
    annotated_candidates: annotated,
  };
}

function recommendRuntime({ exactSubjectAssets, exactMotionAssets, unsafeThumbnailCritical }) {
  if (unsafeThumbnailCritical || exactSubjectAssets <= 0) {
    return {
      recommended_format: unsafeThumbnailCritical ? "reject_visuals" : "blog_only",
      recommended_runtime_class: unsafeThumbnailCritical ? "reject_visuals" : "blog_only",
      recommended_runtime_seconds: [0, 0],
    };
  }
  if (exactSubjectAssets <= 1) {
    return {
      recommended_format: "blog_only",
      recommended_runtime_class: "blog_only",
      recommended_runtime_seconds: [0, 0],
    };
  }
  if (exactSubjectAssets <= 3 && exactMotionAssets < 2) {
    return {
      recommended_format: "short_only",
      recommended_runtime_class: "short_only_30_45",
      recommended_runtime_seconds: [30, 45],
    };
  }
  if (exactSubjectAssets <= 5 && exactMotionAssets < 2) {
    return {
      recommended_format: "standard_short",
      recommended_runtime_class: "standard_short_45_60",
      recommended_runtime_seconds: [45, 60],
    };
  }
  return {
    recommended_format: "premium_short",
    recommended_runtime_class: "premium_short_60_75",
    recommended_runtime_seconds: [60, 75],
  };
}

function summariseExactSubjectPlans(plans) {
  const safePlans = Array.isArray(plans) ? plans : [];
  return {
    stories: safePlans.length,
    studio_v2_60s_eligible: safePlans.filter((plan) => plan.exact_subject_readiness?.studio_v2_60s_eligible).length,
    premium_candidates: safePlans.filter((plan) => plan.exact_subject_readiness?.studio_v2_premium_candidate).length,
    exact_subject_assets: safePlans.reduce(
      (sum, plan) => sum + Number(plan.exact_subject_readiness?.exact_subject_asset_count || 0),
      0,
    ),
    generic_context_assets: safePlans.reduce(
      (sum, plan) => sum + Number(plan.exact_subject_readiness?.generic_context_asset_count || 0),
      0,
    ),
    downgraded: safePlans.filter((plan) => (plan.exact_subject_readiness?.downgrade_reasons || []).length > 0).length,
  };
}

function summariseStoreVerificationPlans(plans) {
  const summary = {
    store_assets: 0,
    verified: 0,
    mismatch: 0,
    missing_title: 0,
    steam_assets: 0,
    igdb_assets: 0,
  };
  for (const plan of Array.isArray(plans) ? plans : []) {
    for (const candidate of plan.candidates || plan.media_provenance || []) {
      if (!candidate.store_asset_source) continue;
      summary.store_assets += 1;
      if (candidate.store_asset_source === "steam") summary.steam_assets += 1;
      if (candidate.store_asset_source === "igdb") summary.igdb_assets += 1;
      if (candidate.store_match_status === "verified") summary.verified += 1;
      else if (candidate.store_match_status === "mismatch") summary.mismatch += 1;
      else if (candidate.store_match_status === "missing_title") summary.missing_title += 1;
    }
  }
  return summary;
}

module.exports = {
  EXACT_MATCH_QUALITIES,
  annotateCandidate,
  buildExactSubjectReadiness,
  buildSubjectGraph,
  classifySubjectMatch,
  inferSourceType,
  isVideoOrFrame,
  summariseExactSubjectPlans,
  summariseStoreVerificationPlans,
  verifyStoreAsset,
};
