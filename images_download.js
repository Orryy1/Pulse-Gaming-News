/*
  Shared image downloading logic used by both images.js and assemble.js.
  Downloads real game/article images from URLs stored in story objects.
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { classifyOutboundUrl, safeRedirectConfig } = require("./lib/safe-url");
const mediaPaths = require("./lib/media-paths");
const { filterUnsafeImagesForRender } = require("./lib/thumbnail-safety");
const {
  GENERIC_STORE_TITLE_TOKENS: GENERIC_STEAM_TITLE_TOKENS,
  normaliseStoreTitleText: normaliseSteamMatchText,
  titleContainsExactStoreName: titleContainsExactSteamName,
} = require("./lib/exact-store-title-identity");

const CACHE_DIR = path.join("output", "image_cache");
const VIDEO_CACHE_DIR = path.join("output", "video_cache");

// Rotating browser-style User-Agents for download requests (avoids bot detection)
const BROWSER_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
];
function randomUA() {
  return BROWSER_USER_AGENTS[
    Math.floor(Math.random() * BROWSER_USER_AGENTS.length)
  ];
}

function exactNamedTitleCandidates(rawTitle) {
  const title = String(rawTitle || "").trim();
  if (!title) return [];
  const sequences =
    title.match(
      /(?:\b[A-Z][A-Za-z0-9'\u2019.-]*|[A-Z0-9]{2,})(?:(?:\s+|:\s*)(?:[A-Z][A-Za-z0-9'\u2019.-]*|[A-Z0-9]{2,})){1,6}/g,
    ) || [];
  const out = [];
  for (const sequence of sequences) {
    const tokens = sequence
      .replace(/:/g, " : ")
      .split(/\s+/)
      .filter(Boolean);
    const wordTokens = tokens.filter((token) => token !== ":");
    if (wordTokens.length < 2) continue;
    out.push(sequence);

    let firstDistinctive = 0;
    while (
      firstDistinctive < wordTokens.length - 1 &&
      GENERIC_STEAM_TITLE_TOKENS.has(
        normaliseSteamMatchText(wordTokens[firstDistinctive]),
      )
    ) {
      firstDistinctive += 1;
    }
    if (firstDistinctive > 0) {
      out.push(wordTokens.slice(firstDistinctive).join(" "));
    }
  }

  const subtitleLead = title.match(
    /^(.+?:\s*[A-Z][A-Za-z0-9'\u2019.-]*)\s+(?:hands-on|preview|review|report|gets|is|has|will|launches|reveals|returns)\b/i,
  );
  if (subtitleLead?.[1]) out.push(subtitleLead[1]);
  return out.slice(0, 6);
}

/**
 * Select one Steam result only when the complete official app name is
 * visibly present in the story headline. Steam storesearch is relevance
 * ranked, not an identity API, so `items[0]` is never sufficient evidence.
 *
 * Returns null for franchise-only, malformed or multi-game ambiguity.
 */
function selectExactSteamSearchMatch(story, attempts = []) {
  const storyTitle = String(story?.title || "").trim();
  const byAppId = new Map();
  for (const attempt of Array.isArray(attempts) ? attempts : []) {
    const searchTerm = String(
      attempt?.search_term || attempt?.searchTerm || "",
    ).trim();
    for (const item of Array.isArray(attempt?.items)
      ? attempt.items
      : []) {
      const appId = String(item?.id || item?.appid || "").trim();
      const appTitle = String(item?.name || item?.title || "").trim();
      if (
        !/^\d{2,12}$/.test(appId) ||
        !titleContainsExactSteamName(storyTitle, appTitle)
      ) {
        continue;
      }
      const normalisedTitle = normaliseSteamMatchText(appTitle);
      const candidate = {
        app_id: appId,
        app_title: appTitle,
        matched_query: searchTerm || null,
        normalised_title: normalisedTitle,
        score:
          normalisedTitle.split(" ").length * 1000 +
          normalisedTitle.length,
      };
      const prior = byAppId.get(appId);
      if (!prior || candidate.score > prior.score) {
        byAppId.set(appId, candidate);
      }
    }
  }

  const ranked = [...byAppId.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.app_id.localeCompare(right.app_id),
  );
  if (ranked.length === 0) return null;
  if (ranked.length > 1) {
    const first = ranked[0].normalised_title;
    const everyOtherResultIsAProperNestedTitle = ranked
      .slice(1)
      .every(
        (candidate) =>
          candidate.normalised_title !== first &&
          ` ${first} `.includes(
            ` ${candidate.normalised_title} `,
          ),
      );
    if (!everyOtherResultIsAProperNestedTitle) return null;
  }
  const selected = ranked[0];
  return {
    app_id: selected.app_id,
    app_title: selected.app_title,
    matched_query: selected.matched_query,
    match_basis: "complete_steam_app_title_in_story_headline",
    store_match_verified: true,
  };
}

function isSteamMediaAsset(asset) {
  const source = String(asset?.source || "").toLowerCase();
  const sourceType = String(asset?.source_type || "").toLowerCase();
  const url = String(asset?.url || "").toLowerCase();
  return (
    source === "steam" ||
    source.startsWith("steam_") ||
    source.startsWith("steam:") ||
    sourceType.startsWith("steam_") ||
    /(?:store\.steampowered\.com|steamstatic\.com)/.test(url)
  );
}

function steamAppIdFromAsset(asset) {
  return (
    String(
      asset?.store_app_id ||
        asset?.steam_app_id ||
        asset?.appid ||
        "",
    ).trim() ||
    String(asset?.url || "").match(
      /\/steam\/apps\/(\d{2,12})\//i,
    )?.[1] ||
    null
  );
}

/**
 * Revalidate hunter-stamped Steam media before it can suppress the direct
 * exact-app fallback. Old story rows may contain a franchise-neighbour app
 * selected by storesearch relevance (for example SILENT HILL 2 for a
 * Townfall headline). Such rows are untrusted input, not durable identity.
 */
function verifyPresavedSteamAsset(story, asset) {
  if (!isSteamMediaAsset(asset)) return null;
  const appId = String(steamAppIdFromAsset(asset) || "").trim();
  const appTitle = String(
    asset?.store_app_title ||
      asset?.steam_app_title ||
      asset?.game_name ||
      "",
  ).trim();
  const matchedQuery = String(
    asset?.store_matched_query ||
      asset?.steam_matched_query ||
      "",
  ).trim();
  const urlAppId = String(asset?.url || "").match(
    /\/steam\/apps\/(\d{2,12})\//i,
  )?.[1];
  if (
    !/^\d{2,12}$/.test(appId) ||
    !appTitle ||
    (urlAppId && urlAppId !== appId)
  ) {
    return null;
  }

  const verified = selectExactSteamSearchMatch(story, [
    {
      search_term: matchedQuery,
      items: [{ id: appId, name: appTitle }],
    },
  ]);
  if (!verified || verified.app_id !== appId) return null;

  return {
    entity: verified.app_title,
    game_name: verified.app_title,
    steam_app_id: verified.app_id,
    steam_app_title: verified.app_title,
    steam_matched_query: verified.matched_query,
    store_app_id: verified.app_id,
    store_app_title: verified.app_title,
    store_matched_query: verified.matched_query,
    store_match_status: "verified",
    store_match_verified: true,
    match_basis: verified.match_basis,
    rights_status: asset?.rights_status || "UNREVIEWED",
    rights_risk_class:
      asset?.rights_risk_class ||
      "official_steam_storefront_editorial_use_review_required",
  };
}

function verifyPresavedSteamAssetWithSiblings(story, asset) {
  const direct = verifyPresavedSteamAsset(story, asset);
  if (direct) return direct;

  const appId = steamAppIdFromAsset(asset);
  if (!appId) return null;
  for (const sibling of Array.isArray(story?.game_images)
    ? story.game_images
    : []) {
    if (sibling === asset || steamAppIdFromAsset(sibling) !== appId) {
      continue;
    }
    const siblingIdentity = verifyPresavedSteamAsset(story, sibling);
    if (!siblingIdentity) continue;
    return verifyPresavedSteamAsset(story, {
      ...asset,
      steam_app_id: siblingIdentity.steam_app_id,
      steam_app_title: siblingIdentity.steam_app_title,
      steam_matched_query:
        siblingIdentity.steam_matched_query,
      store_app_id: siblingIdentity.store_app_id,
      store_app_title: siblingIdentity.store_app_title,
      store_matched_query:
        siblingIdentity.store_matched_query,
    });
  }
  return null;
}

function filterMixedSteamAssetsForExactApp(story, assets = []) {
  const annotated = (Array.isArray(assets) ? assets : []).map(
    (asset) => {
      if (!isSteamMediaAsset(asset)) return asset;
      const identity = verifyPresavedSteamAssetWithSiblings(
        story,
        asset,
      );
      return identity ? { ...asset, ...identity } : asset;
    },
  );
  if (
    !annotated.some(
      (asset) =>
        isSteamMediaAsset(asset) &&
        asset.store_match_verified === true,
    )
  ) {
    return annotated;
  }
  return annotated.filter(
    (asset) =>
      !isSteamMediaAsset(asset) ||
      asset.store_match_verified === true,
  );
}

function inferDownloadedVideoSourceType(asset) {
  if (isSteamMediaAsset(asset)) return "steam_trailer";
  const source = String(asset?.source || "").toLowerCase();
  if (source === "igdb" || source.startsWith("igdb")) {
    return "igdb_video";
  }
  if (source.startsWith("youtube")) {
    return "youtube_video_reference";
  }
  const declared = String(asset?.source_type || "")
    .trim()
    .toLowerCase();
  if (
    declared &&
    !declared.startsWith("steam_") &&
    declared !== "steam_trailer"
  ) {
    return declared;
  }
  return "external_video_reference";
}

// --- Build candidate Steam search terms from a story title ---
//
// Gaming headlines come in predictable shapes:
//   "Tom Henderson on Black Flag remake: reveal set for April 23rd..."
//   "THQ Nordic has 7 unannounced Switch 2 games on their site"
//   "Horizon Zero Dawn Remastered leaked into April's PS Plus"
//
// The game name might be BEFORE the colon, AFTER the colon, or buried in
// the middle of a longer sentence. Rather than guess one location and
// throw away the rest, we build an ordered list of candidate search
// strings and try each in turn against Steam's storesearch endpoint.
// The first that returns a hit wins.
//
// Exported for unit testing in tests/services/steam-search-candidates.test.js.
function buildSteamSearchCandidates(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") return [];

  // Common leaker-attribution prefixes that bury the game name behind noise.
  // "Tom Henderson on Black Flag" → start at "Black Flag".
  const leakerPrefixRe =
    /^(tom\s+henderson|billbil-kun|billbilkun|billbil\s+kun|jason\s+schreier|jeff\s+grubb|nate\s+the\s+hate|nibellion)\s+(?:on|says|reports|claims|leaks|hints)\s+/i;

  const stopTokens = new RegExp(
    "\\b(reportedly|rumour|rumor|confirmed|leaked|leak|says|claims|according|to|has|been|what|are|your|thoughts|out|for|a|week|now|insider|source|sources|reveal|reveals|revealed|release|date|embargo|lifts|embargoed|the|game|current-gen|current|gen|only|next|big|delayed|coming|soon|may|have|might|possibly|allegedly|locked|in|of|and|or|is|are|was|were|will|be|set|an|at|on|from|this|that|you|how|why|what|do|does|with|about|by)\\b",
    "gi",
  );

  // Start from title minus leaker prefix.
  const base = rawTitle.replace(leakerPrefixRe, "").trim();

  // Candidate A: content BEFORE the first colon (e.g. "Black Flag remake").
  // Candidate B: content AFTER the first colon (old behaviour, kept for
  //   headlines like "Rumour: New Elder Scrolls leak").
  // Candidate C: whole title (last resort).
  const colonIdx = base.indexOf(":");
  const rawCandidates = exactNamedTitleCandidates(base);
  if (colonIdx !== -1) {
    rawCandidates.push(base.slice(0, colonIdx));
    rawCandidates.push(base.slice(colonIdx + 1));
  }
  rawCandidates.push(base);

  const clean = (s) =>
    s
      .replace(stopTokens, " ")
      .replace(/[^a-zA-Z0-9\s:'-]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 60)
      .trim();

  const seen = new Set();
  const out = [];
  for (const c of rawCandidates) {
    const cleaned = clean(c);
    if (cleaned.length > 3 && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out.slice(0, 6);
}

/**
 * Pull up to N trailer URLs out of a Steam appdetails response payload.
 *
 * Steam serves each movie at multiple bitrates / containers:
 *   { id, name, thumbnail,
 *     webm: { "480": <url>, "max": <url> },
 *     mp4:  { "480": <url>, "max": <url> },
 *     highlight: bool }
 *
 * Preference order:
 *   1. webm.max    (best quality, most efficient)
 *   2. webm.480
 *   3. mp4.max
 *   4. mp4.480
 *
 * Returns [] when appData is null/undefined or has no movies.
 *
 * Pure / synchronous so it's easy to unit-test against canned Steam
 * payloads without touching the network. Exported below.
 */
function extractSteamTrailerUrls(appData, max = 2) {
  const out = [];
  const movies = appData && Array.isArray(appData.movies) ? appData.movies : [];
  for (const m of movies) {
    if (out.length >= max) break;
    if (!m || typeof m !== "object") continue;
    const url =
      (m.webm && (m.webm.max || m.webm["480"])) ||
      (m.mp4 && (m.mp4.max || m.mp4["480"])) ||
      null;
    if (!url) continue;
    out.push({ url, name: m.name || null });
  }
  return out;
}

// --- Download and cache a video clip from URL ---
async function downloadVideoClip(url, filename) {
  // DB rows get the repo-relative path (unchanged contract).
  // Physical writes go through media-paths so the cache lives on
  // /data/media in production and under the repo in dev. Existence
  // check looks in BOTH roots so we don't redownload a file that
  // already exists on the old (legacy) repo-root location.
  const cachePath = path.join(VIDEO_CACHE_DIR, filename);
  if (await mediaPaths.pathExists(cachePath)) {
    return (await mediaPaths.resolveExisting(cachePath)) || cachePath;
  }

  // SSRF guard — reject non-http(s), localhost, RFC1918, cloud
  // metadata IPs before we let axios touch them. A malicious RSS
  // feed or poisoned article page could otherwise point us at
  // 169.254.169.254. See lib/safe-url.js + docs/url-fetch-safety-audit.md.
  const safe = classifyOutboundUrl(url);
  if (!safe.ok) {
    console.log(
      `[images] skipping unsafe video URL: ${safe.reason} (${filename})`,
    );
    return null;
  }

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: { "User-Agent": randomUA() },
      ...safeRedirectConfig(5),
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });

    const videoCacheDirAbs = mediaPaths.writePath(VIDEO_CACHE_DIR);
    await fs.ensureDir(videoCacheDirAbs);
    const cacheWriteAbs = mediaPaths.writePath(cachePath);
    await fs.writeFile(cacheWriteAbs, Buffer.from(response.data));

    const stat = await fs.stat(cacheWriteAbs);
    if (stat.size < 10000) {
      await fs.remove(cacheWriteAbs);
      return null;
    }

    console.log(
      `[images] Cached video: ${filename} (${Math.round(stat.size / 1024)}KB)`,
    );
    // Return the repo-relative path so the DB and downstream
    // consumers stay location-independent.
    return cachePath;
  } catch (err) {
    return null;
  }
}

// --- Download and cache an image from URL ---
async function downloadImage(url, filename) {
  // Same pattern as downloadVideoClip above — DB-relative paths,
  // physical writes under MEDIA_ROOT when set.
  const cachePath = path.join(CACHE_DIR, filename);
  if (await mediaPaths.pathExists(cachePath)) {
    return (await mediaPaths.resolveExisting(cachePath)) || cachePath;
  }

  // SSRF guard (same reasoning as downloadVideoClip). The article-
  // inline scraper in getBestImage() iterates every <img> tag on a
  // third-party article page — any one of those could be
  // attacker-controlled.
  const safe = classifyOutboundUrl(url);
  if (!safe.ok) {
    console.log(
      `[images] skipping unsafe image URL: ${safe.reason} (${filename})`,
    );
    return null;
  }

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": randomUA() },
      ...safeRedirectConfig(3),
      maxContentLength: 20 * 1024 * 1024, // 20MB cap — images shouldn't be bigger
    });

    const cacheDirAbs = mediaPaths.writePath(CACHE_DIR);
    await fs.ensureDir(cacheDirAbs);
    const cacheWriteAbs = mediaPaths.writePath(cachePath);
    await fs.writeFile(cacheWriteAbs, Buffer.from(response.data));

    const stat = await fs.stat(cacheWriteAbs);
    if (stat.size < 1000) {
      await fs.remove(cacheWriteAbs);
      return null;
    }

    // Verify minimum dimensions - skip low-res images that look bad at 1080x1920
    try {
      const sharp = require("sharp");
      const meta = await sharp(cacheWriteAbs).metadata();
      if (meta.width < 400 || meta.height < 400) {
        console.log(
          `[images] Skipping low-res image: ${meta.width}x${meta.height}`,
        );
        await fs.remove(cacheWriteAbs);
        return null;
      }
    } catch (e) {
      // If sharp can't read it, the image is probably corrupt
      await fs.remove(cacheWriteAbs);
      return null;
    }

    console.log(
      `[images] Cached: ${filename} (${Math.round(stat.size / 1024)}KB)`,
    );
    // Return repo-relative path — DB portability across envs.
    return cachePath;
  } catch (err) {
    return null;
  }
}

// --- Download the best available images for a story ---
async function getBestImage(story, options = {}) {
  let images = [];
  const downloadImageAsset =
    options.downloadImage || downloadImage;
  const downloadVideoAsset =
    options.downloadVideoClip || downloadVideoClip;
  const allowNonSteamFallbacks =
    options.disableNonSteamFallbacks !== true &&
    options.disableFallbackBroll !== true;
  // Hoisted so the Steam search fallback (RSS-source path) can also
  // contribute trailer clips, not just images. The legacy block at
  // the bottom of this function still handles hunter-stamped
  // `story.game_images` entries (Reddit path) and the IGDB/YouTube
  // fetchFallbackBroll path.
  const videoClips = [];

  // Priority 1: Article hero image (og:image from the news source)
  if (story.article_image) {
    const ext =
      story.article_image.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
    const cached = await downloadImageAsset(
      story.article_image,
      `${story.id}_article.${ext}`,
    );
    if (cached)
      images.push({
        path: cached,
        type: "article_hero",
        priority: 100,
        source: "article",
        url: story.article_image,
      });
  }

  // Priority 2: Steam key art / hero images (from hunter-saved URLs)
  if (story.game_images && story.game_images.length > 0) {
    for (const img of story.game_images) {
      if (img.is_video) continue; // video clips handled separately below
      const presavedSteamIdentity = isSteamMediaAsset(img)
        ? verifyPresavedSteamAssetWithSiblings(story, img)
        : null;
      if (isSteamMediaAsset(img) && !presavedSteamIdentity) {
        console.log(
          `[images] Skipping unverified pre-saved Steam image for ${story.id}`,
        );
        continue;
      }
      const safeName = `${story.id}_${img.type}_${img.source}.jpg`;
      const cached = await downloadImageAsset(img.url, safeName);
      if (cached) {
        const priority =
          img.type === "capsule"
            ? 95
            : img.type === "hero"
              ? 90
              : img.type === "key_art"
                ? 85
                : 70;
        images.push({
          path: cached,
          type: img.type,
          priority,
          source: img.source || "steam",
          url: img.url,
          game_name: img.game_name || null,
          steam_app_id: img.steam_app_id || img.store_app_id || null,
          steam_app_title:
            img.steam_app_title || img.store_app_title || img.game_name || null,
          steam_matched_query:
            img.steam_matched_query || img.store_matched_query || null,
          igdb_id: img.igdb_id || null,
          igdb_title: img.igdb_title || null,
          igdb_slug: img.igdb_slug || null,
          igdb_matched_query: img.igdb_matched_query || null,
          store_app_id:
            img.store_app_id || img.steam_app_id || img.igdb_id || null,
          store_app_title:
            img.store_app_title ||
            img.steam_app_title ||
            img.igdb_title ||
            img.game_name ||
            null,
          store_app_slug: img.store_app_slug || img.igdb_slug || null,
          store_matched_query:
            img.store_matched_query ||
            img.steam_matched_query ||
            img.igdb_matched_query ||
            null,
          ...(presavedSteamIdentity || {}),
        });
      }
      if (images.length >= 10) break;
    }
  }

  // Priority 2b: Direct Steam search fallback - if hunter didn't save game_images,
  // extract game title from story title and search Steam directly.
  //
  // 2026-04-19 fix: the old extractor stripped EVERYTHING before the first
  // colon via /^[^:]+:\s*/. That's wrong for titles like
  //   "Tom Henderson on Black Flag remake: reveal set for April 23rd..."
  // where the game name lives BEFORE the colon. It threw away "Black Flag"
  // and sent Steam the post-colon noise "reveal set for April 23rd..."
  // which matches nothing. Fix: build multiple candidate search terms
  // (named-title + before-colon + after-colon + whole-title), then require
  // a complete official app title in the headline. Storesearch relevance
  // order is not identity evidence and must never be trusted directly.
  if (
    images.filter((i) => i.type !== "article_hero").length === 0 &&
    story.title
  ) {
    try {
      const candidates = buildSteamSearchCandidates(story.title);
      const searchAttempts = [];
      const steamSearch =
        options.steamSearch ||
        (async (searchTerm) => {
          const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(searchTerm)}&cc=gb&l=english`;
          const searchResp = await axios.get(searchUrl, {
            timeout: 8000,
            headers: { "User-Agent": randomUA() },
          });
          return searchResp.data?.items || [];
        });
      const boundedCandidates = candidates
        .filter((searchTerm) => searchTerm.length > 3)
        .slice(0, 3);
      const boundedAttempts = await Promise.all(
        boundedCandidates.map(async (searchTerm) => {
          console.log(
            `[images] No pre-saved game images, searching Steam for: "${searchTerm}"`,
          );
          try {
            const rawItems = await steamSearch(
              searchTerm,
              story,
            );
            const items = Array.isArray(rawItems)
              ? rawItems
              : Array.isArray(rawItems?.items)
                ? rawItems.items
                : [];
            return {
              search_term: searchTerm,
              items,
            };
          } catch (error) {
            console.log(
              `[images] Steam search failed for "${searchTerm}": ${error.message}`,
            );
            return {
              search_term: searchTerm,
              items: [],
            };
          }
        }),
      );
      searchAttempts.push(...boundedAttempts);
      const matched = selectExactSteamSearchMatch(
        story,
        searchAttempts,
      );

      if (matched) {
        const appId = matched.app_id;
        const steamName = matched.app_title;
        const matchedQuery = matched.matched_query;
        const steamLookup =
          options.steamLookup ||
          (async (lookupAppId) => {
            const detailsRes = await axios.get(
              `https://store.steampowered.com/api/appdetails?appids=${lookupAppId}`,
              {
                timeout: 8000,
                headers: { "User-Agent": randomUA() },
              },
            );
            return detailsRes.data?.[lookupAppId]?.data || null;
          });
        const rawAppData = await steamLookup(
          String(appId),
          matched,
          story,
        );
        const appData =
          rawAppData?.[appId]?.data ||
          rawAppData?.data ||
          rawAppData;
        const verifiedLookup = selectExactSteamSearchMatch(story, [
          {
            search_term: matchedQuery,
            items: appData?.name
              ? [{ id: appId, name: appData.name }]
              : [{ id: appId, name: steamName }],
          },
        ]);
        if (
          verifiedLookup &&
          verifiedLookup.app_id === String(appId)
        ) {
          console.log(`[images] Steam match: "${steamName}" (app ${appId})`);
          const identity = {
            entity: steamName,
            game_name: steamName,
            steam_app_id: String(appId),
            steam_app_title: steamName,
            steam_matched_query: matchedQuery,
            store_app_id: String(appId),
            store_app_title: steamName,
            store_matched_query: matchedQuery,
            store_match_status: "verified",
            store_match_verified: true,
            match_basis: matched.match_basis,
            rights_status: "UNREVIEWED",
            rights_risk_class:
              "official_steam_storefront_editorial_use_review_required",
          };

          // Key art, hero, capsule
          const steamUrls = [
            {
              url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
              type: "key_art",
            },
            {
              url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
              type: "hero",
            },
            {
              url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
              type: "capsule",
            },
          ];
          for (const s of steamUrls) {
            const cached = await downloadImageAsset(
              s.url,
              `${story.id}_${s.type}_steam_fallback.jpg`,
            );
            if (cached) {
              images.push({
                path: cached,
                type: s.type,
                priority:
                  s.type === "capsule" ? 95 : s.type === "hero" ? 90 : 85,
                source: "steam",
                source_type:
                  s.type === "key_art"
                    ? "steam_header"
                    : s.type === "hero"
                      ? "steam_hero"
                      : "steam_capsule",
                url: s.url,
                ...identity,
              });
            }
          }

          // Screenshots and official trailer motion share the same exact
          // app identity that was verified before any media download.
          try {
            if (appData?.screenshots) {
              let ssCount = 0;
              for (const ss of appData.screenshots.slice(0, 4)) {
                if (ss.path_full) {
                  const cached = await downloadImageAsset(
                    ss.path_full,
                    `${story.id}_screenshot_steam_${ssCount}.jpg`,
                  );
                  if (cached) {
                    images.push({
                      path: cached,
                      type: "screenshot",
                      priority: 70 - ssCount,
                      source: "steam",
                      source_type: "steam_screenshot",
                      url: ss.path_full,
                      ...identity,
                    });
                    ssCount++;
                  }
                }
              }
              console.log(
                `[images] Steam fallback: downloaded ${images.length} images for ${story.id}`,
              );
            }

            // 2026-04-29: Steam appdetails also returns a `movies`
            // array. The original fallback only consumed screenshots
            // here, leaving RSS-sourced Steam-matched stories to fall
            // through to the IGDB/YouTube b-roll path even though the
            // exact official trailer was already at our fingertips.
            // Pull up to 2 trailer URLs (webm preferred, mp4 fallback)
            // so the renderer has real motion footage, not just stills.
            const trailerUrls = extractSteamTrailerUrls(
              appData,
              2 - videoClips.length,
            );
            for (const t of trailerUrls) {
              const ext = t.url.includes(".webm") ? "webm" : "mp4";
              const safeName = `${story.id}_steam_trailer_${videoClips.length}.${ext}`;
              const cached = await downloadVideoAsset(
                t.url,
                safeName,
              );
              if (cached) {
                videoClips.push({
                  path: cached,
                  type: "trailer",
                  source: "steam",
                  source_type: "steam_trailer",
                  url: t.url,
                  movie_name: t.name || null,
                  is_video: true,
                  ...identity,
                });
                console.log(
                  `[images] Steam fallback trailer downloaded for ${story.id}`,
                );
              }
              if (videoClips.length >= 2) break;
            }
          } catch (detailErr) {
            /* Steam details failed, non-fatal */
          }
        }
      } else {
        console.log(
          `[images] Steam direct search held: no exact app title matched "${story.title}"`,
        );
      }
    } catch (err) {
      console.log(`[images] Steam direct search failed: ${err.message}`);
    }
  }

  // Priority 2c: IGDB cover + screenshots fallback. Catches console
  // exclusives, mobile, indie, and retro games Steam doesn't index. Only
  // fires when Steam returned no gaming-source images yet (article_hero
  // alone isn't enough — that's the thin-visual symptom we're fixing).
  // Graceful no-op when TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET aren't
  // provisioned — fetchIgdbImages returns [].
  if (
    allowNonSteamFallbacks &&
    images.filter((i) => i.source === "steam").length === 0 &&
    images.filter((i) => i.type !== "article_hero").length === 0 &&
    story.title &&
    process.env.TWITCH_CLIENT_ID
  ) {
    try {
      const { fetchIgdbImages } = require("./lib/igdb-images");
      // Re-use the Steam search candidate builder — same problem
      // (extract a real game name from a noisy news headline).
      const candidates = buildSteamSearchCandidates(story.title);
      let igdbImages = [];
      for (const term of candidates) {
        if (term.length <= 3) continue;
        igdbImages = await fetchIgdbImages(term, { max: 5 });
        if (igdbImages.length > 0) {
          console.log(
            `[images] IGDB match for "${term}": ${igdbImages.length} image(s) from "${igdbImages[0].game_name || "?"}"`,
          );
          break;
        }
      }
      let igdbCount = 0;
      for (const img of igdbImages) {
        const ext = "jpg";
        const safeName = `${story.id}_${img.type}_igdb_${igdbCount}.${ext}`;
        const cached = await downloadImageAsset(img.url, safeName);
        if (cached) {
          // Cover should outrank screenshots in the final ordering so
          // it lands in the thumbnail-eligible hero slot.
          const priority = img.type === "key_art" ? 88 : 70 - igdbCount;
          images.push({
            path: cached,
            type: img.type,
            priority,
            source: "igdb",
            url: img.url,
            game_name: img.game_name || img.igdb_title || null,
            igdb_id: img.igdb_id || null,
            igdb_title: img.igdb_title || img.game_name || null,
            igdb_slug: img.igdb_slug || null,
            igdb_matched_query: img.igdb_matched_query || null,
            store_app_id: img.igdb_id || null,
            store_app_title: img.igdb_title || img.game_name || null,
            store_app_slug: img.igdb_slug || null,
            store_matched_query: img.igdb_matched_query || null,
          });
          igdbCount++;
        }
      }
      if (igdbCount > 0) {
        console.log(
          `[images] IGDB fallback: downloaded ${igdbCount} image(s) for ${story.id}`,
        );
      }
    } catch (err) {
      console.log(`[images] IGDB fallback failed: ${err.message}`);
    }
  }

  // Priority 2d: Script-mentioned game enrichment.
  //
  // 2026-04-30 reported issue: a Take-Two story narration mentioned
  // GTA, Red Dead, BioShock, Civilization, Borderlands, Mafia, NBA
  // 2K, Max Payne — all with rich Steam + IGDB key art available —
  // but the image pipeline only searched Steam ONCE against the
  // article title (which doesn't match a single game) and fell
  // through to repeat-image composites. This block extracts game
  // titles directly from the script and fetches Steam/IGDB images
  // for each. Capped at MAX_TITLES × MAX_PER_TITLE (5×3=15) extra
  // image candidates, deduped by URL.
  if (story.full_script || story.tts_script) {
    try {
      const {
        enrichImagesFromScript,
      } = require("./lib/script-game-enrichment");
      const enrichment = await enrichImagesFromScript(story);
      if (enrichment.titles.length > 0) {
        console.log(
          `[images] Script enrichment: detected ${enrichment.titles.length} game(s) (${enrichment.titles
            .map((t) => t.name)
            .join(", ")
            .slice(0, 200)})`,
        );
      }
      const seenUrls = new Set(images.map((i) => i.url).filter(Boolean));
      let enrichCount = 0;
      // Each game contributes up to MAX_PER_TITLE (3) images. To
      // diversify the deck we round-robin through games rather than
      // download all of game-1's images before starting game-2.
      // image_urls is already in (game-1 capsule, hero, key_art,
      // game-2 capsule, hero, key_art, ...) order from the
      // enrichment helper; this loop preserves that ordering.
      for (const img of enrichment.image_urls) {
        if (images.length >= 12) break; // leave headroom for article scrape
        if (img.url && seenUrls.has(img.url)) continue;
        const ext = "jpg";
        const safeName = `${story.id}_${img.type}_${img.source}_${img._entity?.replace(/\W+/g, "_") || "x"}.${ext}`;
        const cached = await downloadImageAsset(img.url, safeName);
        if (cached) {
          // Priority 80 — sits BELOW dedicated Steam fallback hits
          // (capsule=95, hero=90) but ABOVE article inline (75) and
          // generic screenshot (70-N). Decreases per-image so the
          // first game's hero outranks the second game's screenshot.
          const basePriority =
            img.type === "key_art"
              ? 88
              : img.type === "hero"
                ? 85
                : img.type === "capsule"
                  ? 92
                  : 70;
          images.push({
            path: cached,
            type: img.type,
            priority: basePriority - Math.min(enrichCount, 10),
            source: img.source,
            url: img.url,
            game_name: img.game_name || null,
            entity: img._entity || null,
            steam_app_id: img.steam_app_id || null,
            steam_app_title: img.steam_app_title || null,
            steam_matched_query: img.steam_matched_query || null,
            igdb_id: img.igdb_id || null,
            igdb_title: img.igdb_title || null,
            igdb_slug: img.igdb_slug || null,
            igdb_matched_query: img.igdb_matched_query || null,
            store_app_id:
              img.store_app_id || img.steam_app_id || img.igdb_id || null,
            store_app_title:
              img.store_app_title ||
              img.steam_app_title ||
              img.igdb_title ||
              img.game_name ||
              null,
            store_app_slug: img.store_app_slug || img.igdb_slug || null,
            store_matched_query:
              img.store_matched_query ||
              img.steam_matched_query ||
              img.igdb_matched_query ||
              img._entity ||
              null,
          });
          if (img.url) seenUrls.add(img.url);
          enrichCount++;
        }
      }
      if (enrichCount > 0) {
        console.log(
          `[images] Script enrichment: downloaded ${enrichCount} image(s) across ${enrichment.titles.length} game(s)`,
        );
      }
    } catch (err) {
      console.log(
        `[images] Script enrichment failed (non-fatal): ${err.message}`,
      );
    }
  }

  // Priority 3: Scrape ALL images from article page (not just og:image)
  // Gaming news articles are packed with inline screenshots
  if (
    images.length < 8 &&
    (story.article_url || (story.url && !story.url.includes("reddit.com")))
  ) {
    const articleUrl = story.article_url || story.url;
    try {
      const articleResp = await axios.get(articleUrl, {
        timeout: 10000,
        headers: { "User-Agent": randomUA() },
        responseType: "text",
        ...safeRedirectConfig(3),
      });
      const html = typeof articleResp.data === "string" ? articleResp.data : "";

      // Extract all large image URLs from the article HTML
      const allImgUrls = new Set();

      // og:image and twitter:image (may differ from article_image if that failed)
      const metaImgs = html.matchAll(
        /<meta[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["']/gi,
      );
      for (const m of metaImgs) {
        if (m[1]) allImgUrls.add(m[1]);
      }

      // <img> tags with src — skip icons, avatars, logos, ads
      const imgTags = html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*/gi);
      for (const m of imgTags) {
        const src = m[1];
        if (!src || src.length < 20) continue;
        // Skip tiny UI elements, social avatars and author/profile portraits.
        // These can pass dimension checks but make YouTube Shorts thumbnails
        // look like random people instead of gaming stories.
        if (
          /avatar|author|byline|contributor|staff|headshot|portrait|profile|userpic|user[_-]?photo|gravatar|icon|logo|badge|sprite|tracking|pixel|ad[_-]|doubleclick|googlesyndication/i.test(
            src,
          )
        )
          continue;
        // Must look like an image
        if (src.match(/\.(jpg|jpeg|png|webp)/i) || src.includes("/image")) {
          // Resolve relative URLs
          try {
            const resolved = new URL(src, articleUrl).href;
            allImgUrls.add(resolved);
          } catch (e) {
            if (src.startsWith("http")) allImgUrls.add(src);
          }
        }
      }

      // Also check srcset for high-res versions
      const srcsets = html.matchAll(/srcset=["']([^"']+)["']/gi);
      for (const m of srcsets) {
        const entries = m[1].split(",").map((e) => e.trim());
        // Pick the largest (last) entry
        const last = entries[entries.length - 1];
        const srcMatch = last?.match(/(https?:\/\/[^\s]+)/);
        if (srcMatch) allImgUrls.add(srcMatch[1]);
      }

      // Deduplicate against already-downloaded article hero
      const existingUrls = new Set();
      if (story.article_image) existingUrls.add(story.article_image);

      let articleImgCount = 0;
      for (const imgUrl of allImgUrls) {
        if (images.length >= 8) break;
        if (existingUrls.has(imgUrl)) continue;
        existingUrls.add(imgUrl);

        const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
        const cached = await downloadImageAsset(
          imgUrl,
          `${story.id}_article_inline_${articleImgCount}.${ext}`,
        );
        if (cached) {
          images.push({
            path: cached,
            type: "article_inline",
            priority: 75 - articleImgCount,
            source: "article",
            url: imgUrl,
          });
          articleImgCount++;
        }
      }
      if (articleImgCount > 0) {
        console.log(
          `[images] Scraped ${articleImgCount} inline images from article for ${story.id}`,
        );
      }
    } catch (err) {
      // Article scrape failed, non-fatal
    }
  }

  // Priority 4: Reddit thumbnail
  if (story.thumbnail_url) {
    const cached = await downloadImageAsset(
      story.thumbnail_url,
      `${story.id}_reddit_thumb.jpg`,
    );
    if (cached)
      images.push({
        path: cached,
        type: "reddit_thumb",
        priority: 40,
        source: "reddit",
        url: story.thumbnail_url,
      });
  }

  // Priority 5: Company logo
  if (story.company_logo_url) {
    const cached = await downloadImageAsset(
      story.company_logo_url,
      `${story.id}_logo.png`,
    );
    if (cached)
      images.push({
        path: cached,
        type: "company_logo",
        priority: 30,
        source: "logo",
        url: story.company_logo_url,
      });
  }

  // Priority 6: Pexels free stock photos — reliable API, great for industry/generic stories
  if (
    allowNonSteamFallbacks &&
    images.length < 6 &&
    story.title &&
    process.env.PEXELS_API_KEY
  ) {
    try {
      // Build a smart search query from the story title
      const pexelsQuery = story.title
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .replace(
          /\b(is|are|was|were|will|be|to|the|a|an|in|on|at|for|of|and|or|not|has|have|had|just|now)\b/gi,
          "",
        )
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 4)
        .join(" ");

      const pexelsResp = await axios.get(
        `https://api.pexels.com/v1/search?query=${encodeURIComponent(pexelsQuery + " gaming")}&per_page=6&orientation=portrait`,
        {
          timeout: 8000,
          headers: { Authorization: process.env.PEXELS_API_KEY },
        },
      );
      const photos = pexelsResp.data?.photos || [];
      let pexelsCount = 0;
      for (const photo of photos) {
        if (images.length >= 8) break;
        // Use the large2x size — high quality, good for 1080p
        const imgUrl =
          photo.src?.large2x || photo.src?.large || photo.src?.original;
        if (!imgUrl) continue;
        const cached = await downloadImageAsset(
          imgUrl,
          `${story.id}_pexels_${pexelsCount}.jpg`,
        );
        if (cached) {
          images.push({
            path: cached,
            type: "screenshot",
            priority: 25 - pexelsCount,
            source: "pexels",
            url: imgUrl,
          });
          pexelsCount++;
        }
      }
      if (pexelsCount > 0) {
        console.log(
          `[images] Pexels: ${pexelsCount} stock photos for ${story.id}`,
        );
      }
    } catch (err) {
      // Pexels failed, non-fatal
    }
  }

  // Priority 7: Unsplash free photos — no API key needed for small volumes (50/hr)
  if (
    allowNonSteamFallbacks &&
    images.length < 6 &&
    story.title
  ) {
    try {
      const unsplashQuery = story.title
        .replace(/[^a-zA-Z0-9\s]/g, "")
        .trim()
        .split(" ")
        .slice(0, 3)
        .join(" ");

      const unsplashResp = await axios.get(
        `https://unsplash.com/napi/search/photos?query=${encodeURIComponent(unsplashQuery + " gaming")}&per_page=5&orientation=portrait`,
        {
          timeout: 8000,
          headers: { "User-Agent": randomUA() },
        },
      );
      const results = unsplashResp.data?.results || [];
      let unsplashCount = 0;
      for (const photo of results) {
        if (images.length >= 8) break;
        const imgUrl = photo.urls?.regular || photo.urls?.full;
        if (!imgUrl) continue;
        const cached = await downloadImageAsset(
          imgUrl,
          `${story.id}_unsplash_${unsplashCount}.jpg`,
        );
        if (cached) {
          images.push({
            path: cached,
            type: "screenshot",
            priority: 15 - unsplashCount,
            source: "unsplash",
            url: imgUrl,
          });
          unsplashCount++;
        }
      }
      if (unsplashCount > 0) {
        console.log(
          `[images] Unsplash: ${unsplashCount} photos for ${story.id}`,
        );
      }
    } catch (err) {
      // Unsplash failed, non-fatal
    }
  }

  // Priority 8: Bing Image Search scraping — more reliable from servers than Google
  if (
    allowNonSteamFallbacks &&
    images.length < 6 &&
    story.title
  ) {
    try {
      const bingQuery = encodeURIComponent(
        story.title.replace(/[^a-zA-Z0-9\s]/g, "").trim() + " game screenshot",
      );
      const bingUrl = `https://www.bing.com/images/search?q=${bingQuery}&qft=+filterui:imagesize-large&form=IRFLTR&first=1`;
      const bingResp = await axios.get(bingUrl, {
        timeout: 10000,
        headers: { "User-Agent": randomUA() },
        ...safeRedirectConfig(3),
      });
      const html = typeof bingResp.data === "string" ? bingResp.data : "";
      // Bing embeds image URLs in murl attributes
      const bingMatches = html.matchAll(
        /murl&quot;:&quot;(https?:\/\/[^&]+)&quot;/gi,
      );
      let bingFound = 0;
      const seenUrls = new Set(images.map((i) => i.path));
      for (const match of bingMatches) {
        if (images.length >= 8) break;
        let imgUrl = match[1];
        // Decode HTML entities
        imgUrl = imgUrl.replace(/&amp;/g, "&");
        if (seenUrls.has(imgUrl)) continue;
        seenUrls.add(imgUrl);
        // Skip low-quality sources and profile imagery before download.
        if (
          /avatar|author|byline|contributor|staff|headshot|portrait|profile|userpic|user[_-]?photo|gravatar|icon|logo|badge|pixel/i.test(
            imgUrl,
          )
        )
          continue;
        const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
        const cached = await downloadImageAsset(
          imgUrl,
          `${story.id}_bing_${bingFound}.${ext}`,
        );
        if (cached) {
          images.push({
            path: cached,
            type: "screenshot",
            priority: 10 - bingFound,
            source: "bing",
            url: imgUrl,
          });
          bingFound++;
        }
      }
      if (bingFound > 0) {
        console.log(`[images] Bing: ${bingFound} images for ${story.id}`);
      }
    } catch (err) {
      // Bing search failed, non-fatal
    }
  }

  // Download video clips from Steam trailers (hunter-stamped path:
  // Reddit posts that hunter resolved against the Steam Store API).
  // The Steam search fallback above (RSS path) already contributed
  // up to 2 trailer clips when it matched, so this block only fires
  // when the hunter pre-stamped game_images entries.
  if (story.game_images && story.game_images.length > 0) {
    for (const img of story.game_images) {
      if (!img.is_video) continue;
      const presavedSteamIdentity = isSteamMediaAsset(img)
        ? verifyPresavedSteamAssetWithSiblings(story, img)
        : null;
      if (isSteamMediaAsset(img) && !presavedSteamIdentity) {
        console.log(
          `[images] Skipping unverified pre-saved Steam video for ${story.id}`,
        );
        continue;
      }
      const ext = img.url.includes(".webm") ? "webm" : "mp4";
      const safeName = `${story.id}_${img.type}_${img.source}.${ext}`;
      const cached = await downloadVideoAsset(img.url, safeName);
      if (cached) {
        videoClips.push({
          path: cached,
          type: img.type,
          source: img.source,
          source_type: inferDownloadedVideoSourceType(img),
          url: img.url,
          is_video: true,
          ...(presavedSteamIdentity || {}),
        });
        console.log(
          `[images] Steam ${img.type} clip downloaded for "${(story.title || "").substring(0, 40)}..."`,
        );
      }
      if (videoClips.length >= 2) break;
    }
  }

  // Fallback B-roll: IGDB / YouTube search for console exclusives + stories
  // Steam couldn't match. Only fires when Steam returned no video clips.
  if (allowNonSteamFallbacks && videoClips.length === 0) {
    try {
      const { fetchFallbackBroll } = require("./fetch_broll");
      const fallback = await fetchFallbackBroll(story);
      for (const clip of fallback) {
        videoClips.push({
          path: clip.path,
          type: "trailer",
          source: clip.source,
        });
        if (videoClips.length >= 2) break;
      }
    } catch (err) {
      console.log(
        `[images] B-roll fallback failed (non-fatal): ${err.message}`,
      );
    }
  }

  images = filterMixedSteamAssetsForExactApp(story, images);
  const safety = filterUnsafeImagesForRender(story, images);
  images = safety.images;
  if (safety.rejected.length > 0) {
    console.log(
      `[images] Thumbnail safety rejected ${safety.rejected.length} image(s) for ${story.id}: ` +
        safety.rejected
          .map((r) => `${r.image?.path || "unknown"}=${r.reasons.join("+")}`)
          .join(", "),
    );
  }

  // Previously: pure priority sort. That stacked every Steam asset
  // together (header → library_hero → capsule → 4 screenshots), and
  // since they're all the same game the back half of the video looked
  // like the same image on loop. We still want the highest-priority
  // hero image FIRST (so the thumbnail reads well), but after that
  // we interleave by source so consecutive visual slots don't share
  // one game/article. Unverified Steam material remains capped at 2
  // when another source exists. An exact, title-bound app may retain
  // six distinct assets so a real game-native deck is not collapsed
  // back into the thin-card failure mode.
  images.sort((a, b) => b.priority - a.priority);

  const bySource = {};
  for (const img of images) {
    const src = img.source || "other";
    (bySource[src] = bySource[src] || []).push(img);
  }
  const nonSteamSourceCount = Object.keys(bySource).filter(
    (s) => s !== "steam",
  ).length;
  const hasVerifiedExactSteam = (bySource.steam || []).some(
    (asset) => asset.store_match_verified === true,
  );
  const steamCap =
    nonSteamSourceCount > 0
      ? hasVerifiedExactSteam
        ? 6
        : 2
      : Infinity;
  if (bySource.steam && bySource.steam.length > steamCap) {
    bySource.steam = bySource.steam.slice(0, steamCap);
  }

  // Interleave: first the top-priority hero, then round-robin sources
  // until every source bucket is empty.
  const allRanked = Object.values(bySource)
    .flat()
    .sort((a, b) => b.priority - a.priority);
  const ordered = [];
  if (allRanked.length > 0) {
    const first = allRanked[0];
    ordered.push(first);
    for (const k of Object.keys(bySource)) {
      bySource[k] = bySource[k].filter((i) => i !== first);
    }
  }
  while (Object.values(bySource).some((b) => b.length > 0)) {
    for (const k of Object.keys(bySource)) {
      const bucket = bySource[k];
      if (bucket.length === 0) continue;
      ordered.push(bucket.shift());
    }
  }

  // 2026-04-30 audit P1 #2: asset provenance ledger.
  // Persist a media_provenance row for every accepted asset, plus
  // pixel-level signals (deduped via content_hash). Best-effort —
  // recordDownload swallows its own errors and returns ok=false on
  // transient failures so the produce loop keeps going.
  try {
    const recordProvenance =
      options.recordProvenance ||
      require("./lib/media-provenance").recordDownload;
    for (const img of ordered) {
      try {
        await recordProvenance({
          story_id: story.id,
          channel_id: story.channel_id || null,
          source_url: img.url || null,
          source_type: classifyProvenanceSourceType(img),
          file_path: img.path,
          story_relevance_score:
            typeof img.priority === "number"
              ? Math.max(0, Math.min(1, img.priority / 100))
              : null,
          accepted: true,
          raw_meta: {
            type: img.type,
            source: img.source,
            priority: img.priority,
            source_type: img.source_type || null,
            store_app_id: img.store_app_id || null,
            store_app_title: img.store_app_title || null,
            store_matched_query:
              img.store_matched_query || null,
            store_match_verified:
              img.store_match_verified === true,
            rights_status: img.rights_status || null,
            rights_risk_class:
              img.rights_risk_class || null,
          },
        });
      } catch (provErr) {
        console.log(
          `[images] provenance record failed (non-fatal): ${provErr.message}`,
        );
      }
    }
    for (const clip of videoClips) {
      if (!clip?.url) continue;
      try {
        await recordProvenance({
          story_id: story.id,
          channel_id: story.channel_id || null,
          source_url: clip.url,
          source_type: classifyProvenanceSourceType(clip),
          file_path: clip.path || null,
          accepted: true,
          skipPrescan: true,
          raw_meta: {
            type: clip.type,
            source: clip.source,
            source_type: clip.source_type || null,
            movie_name: clip.movie_name || null,
            store_app_id: clip.store_app_id || null,
            store_app_title: clip.store_app_title || null,
            store_matched_query:
              clip.store_matched_query || null,
            store_match_verified:
              clip.store_match_verified === true,
            rights_status: clip.rights_status || null,
            rights_risk_class:
              clip.rights_risk_class || null,
          },
        });
      } catch (provErr) {
        console.log(
          `[images] video provenance record failed (non-fatal): ${provErr.message}`,
        );
      }
    }
  } catch (err) {
    // Module not loadable (USE_SQLITE off / migration not applied) —
    // the produce loop is unaffected.
    console.log(`[images] provenance module unavailable: ${err.message}`);
  }

  return { images: ordered, videoClips };
}

/**
 * Map an internal image entry (source + type) onto the enum used by
 * media_provenance.source_type. Unknown combinations fall back to
 * the catch-all "other" so the column is never null.
 */
function classifyProvenanceSourceType(img) {
  if (!img) return "other";
  const src = (img.source || "").toLowerCase();
  const type = (img.type || "").toLowerCase();
  const sourceType = String(img.source_type || "").toLowerCase();
  const isVideo =
    /video|trailer|clip|movie/.test(type) ||
    /video|trailer|clip|movie/.test(sourceType) ||
    /\.(mp4|webm|mov)(?:$|\?)/i.test(
      String(img.url || img.path || ""),
    );
  if (isVideo) {
    if (src === "steam" || src.startsWith("steam")) {
      return "steam_trailer";
    }
    if (src.startsWith("youtube")) return "youtube_broll";
    return "other";
  }
  if (src === "article" && type.includes("hero")) return "article_hero";
  if (src === "article" && type.includes("inline")) return "article_inline";
  if (src === "article") return "article_inline";
  if (src === "steam") {
    if (type === "capsule") return "steam_capsule";
    if (type === "hero") return "steam_hero";
    if (type === "key_art") return "steam_key_art";
    if (type === "screenshot") return "steam_screenshot";
    if (type === "trailer") return "steam_trailer";
    return "steam_screenshot";
  }
  if (src === "igdb") {
    if (type === "key_art") return "igdb_cover";
    return "igdb_screenshot";
  }
  if (src === "logo" || type === "company_logo") return "company_logo";
  if (src === "reddit" || type === "reddit_thumb") return "reddit_thumb";
  if (src === "pexels") return "pexels";
  if (src === "unsplash") return "unsplash";
  if (src === "bing") return "bing";
  if (src.startsWith("youtube")) return "youtube_broll";
  if (src.startsWith("steam_fallback")) return "steam_trailer";
  return "other";
}

module.exports = getBestImage;
module.exports.downloadVideoClip = downloadVideoClip;
module.exports.downloadImage = downloadImage;
module.exports.buildSteamSearchCandidates = buildSteamSearchCandidates;
module.exports.selectExactSteamSearchMatch =
  selectExactSteamSearchMatch;
module.exports.filterMixedSteamAssetsForExactApp =
  filterMixedSteamAssetsForExactApp;
module.exports.extractSteamTrailerUrls = extractSteamTrailerUrls;
module.exports.classifyProvenanceSourceType = classifyProvenanceSourceType;
