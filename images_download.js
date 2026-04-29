/*
  Shared image downloading logic used by both images.js and assemble.js.
  Downloads real game/article images from URLs stored in story objects.
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { classifyOutboundUrl } = require("./lib/safe-url");
const mediaPaths = require("./lib/media-paths");
const { filterUnsafeImagesForRender } = require("./lib/thumbnail-safety");

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
  const rawCandidates = [];
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
  return out;
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
      maxRedirects: 5,
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
      maxRedirects: 3,
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
async function getBestImage(story) {
  let images = [];
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
    const cached = await downloadImage(
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
      const safeName = `${story.id}_${img.type}_${img.source}.jpg`;
      const cached = await downloadImage(img.url, safeName);
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
          source: "steam",
          url: img.url,
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
  // (before-colon + after-colon + whole-title), try each in order, accept
  // the first that returns a Steam hit.
  if (
    images.filter((i) => i.type !== "article_hero").length === 0 &&
    story.title
  ) {
    try {
      const candidates = buildSteamSearchCandidates(story.title);
      let matched = null;
      for (const searchTerm of candidates) {
        if (searchTerm.length <= 3) continue;
        console.log(
          `[images] No pre-saved game images, searching Steam for: "${searchTerm}"`,
        );
        const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(searchTerm)}&cc=gb&l=english`;
        const searchResp = await axios.get(searchUrl, {
          timeout: 8000,
          headers: { "User-Agent": randomUA() },
        });
        const items = searchResp.data?.items || [];
        if (items.length > 0) {
          matched = { items, searchTerm };
          break;
        }
      }

      if (matched) {
        const { items } = matched;
        {
          const appId = items[0].id;
          const steamName = items[0].name;
          console.log(`[images] Steam match: "${steamName}" (app ${appId})`);

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
            const cached = await downloadImage(
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
                url: s.url,
              });
            }
          }

          // Fetch screenshots via app details
          try {
            const detailsRes = await axios.get(
              `https://store.steampowered.com/api/appdetails?appids=${appId}`,
              { timeout: 8000, headers: { "User-Agent": randomUA() } },
            );
            const appData = detailsRes.data?.[appId]?.data;
            if (appData?.screenshots) {
              let ssCount = 0;
              for (const ss of appData.screenshots.slice(0, 4)) {
                if (ss.path_full) {
                  const cached = await downloadImage(
                    ss.path_full,
                    `${story.id}_screenshot_steam_${ssCount}.jpg`,
                  );
                  if (cached) {
                    images.push({
                      path: cached,
                      type: "screenshot",
                      priority: 70 - ssCount,
                      source: "steam",
                      url: ss.path_full,
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
              const cached = await downloadVideoClip(t.url, safeName);
              if (cached) {
                videoClips.push({
                  path: cached,
                  type: "trailer",
                  source: `steam_fallback:${items[0].name || appId}`,
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
        const cached = await downloadImage(img.url, safeName);
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
        maxRedirects: 3,
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
        const cached = await downloadImage(
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
    const cached = await downloadImage(
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
    const cached = await downloadImage(
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
  if (images.length < 6 && story.title && process.env.PEXELS_API_KEY) {
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
        const cached = await downloadImage(
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
  if (images.length < 6 && story.title) {
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
        const cached = await downloadImage(
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
  if (images.length < 6 && story.title) {
    try {
      const bingQuery = encodeURIComponent(
        story.title.replace(/[^a-zA-Z0-9\s]/g, "").trim() + " game screenshot",
      );
      const bingUrl = `https://www.bing.com/images/search?q=${bingQuery}&qft=+filterui:imagesize-large&form=IRFLTR&first=1`;
      const bingResp = await axios.get(bingUrl, {
        timeout: 10000,
        headers: { "User-Agent": randomUA() },
        maxRedirects: 3,
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
        const cached = await downloadImage(
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
      const ext = img.url.includes(".webm") ? "webm" : "mp4";
      const safeName = `${story.id}_${img.type}_${img.source}.${ext}`;
      const cached = await downloadVideoClip(img.url, safeName);
      if (cached) {
        videoClips.push({ path: cached, type: img.type, source: img.source });
        console.log(
          `[images] Steam ${img.type} clip downloaded for "${(story.title || "").substring(0, 40)}..."`,
        );
      }
      if (videoClips.length >= 2) break;
    }
  }

  // Fallback B-roll: IGDB / YouTube search for console exclusives + stories
  // Steam couldn't match. Only fires when Steam returned no video clips.
  if (videoClips.length === 0) {
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
  // one game/article. Steam is capped at 2 per video when any other
  // source is available.
  images.sort((a, b) => b.priority - a.priority);

  const bySource = {};
  for (const img of images) {
    const src = img.source || "other";
    (bySource[src] = bySource[src] || []).push(img);
  }
  const nonSteamSourceCount = Object.keys(bySource).filter(
    (s) => s !== "steam",
  ).length;
  const steamCap = nonSteamSourceCount > 0 ? 2 : Infinity;
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

  return { images: ordered, videoClips };
}

module.exports = getBestImage;
module.exports.downloadVideoClip = downloadVideoClip;
module.exports.downloadImage = downloadImage;
module.exports.buildSteamSearchCandidates = buildSteamSearchCandidates;
module.exports.extractSteamTrailerUrls = extractSteamTrailerUrls;
