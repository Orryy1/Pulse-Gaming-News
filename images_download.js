/*
  Shared image downloading logic used by both images.js and assemble.js.
  Downloads real game/article images from URLs stored in story objects.
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");

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

// --- Download and cache a video clip from URL ---
async function downloadVideoClip(url, filename) {
  const cachePath = path.join(VIDEO_CACHE_DIR, filename);
  if (await fs.pathExists(cachePath)) return cachePath;

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      headers: { "User-Agent": randomUA() },
      maxRedirects: 5,
      maxContentLength: 50 * 1024 * 1024, // 50MB max
    });

    await fs.ensureDir(VIDEO_CACHE_DIR);
    await fs.writeFile(cachePath, Buffer.from(response.data));

    const stat = await fs.stat(cachePath);
    if (stat.size < 10000) {
      await fs.remove(cachePath);
      return null;
    }

    console.log(
      `[images] Cached video: ${filename} (${Math.round(stat.size / 1024)}KB)`,
    );
    return cachePath;
  } catch (err) {
    return null;
  }
}

// --- Download and cache an image from URL ---
async function downloadImage(url, filename) {
  const cachePath = path.join(CACHE_DIR, filename);
  if (await fs.pathExists(cachePath)) return cachePath;

  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": randomUA() },
      maxRedirects: 5,
    });

    await fs.ensureDir(CACHE_DIR);
    await fs.writeFile(cachePath, Buffer.from(response.data));

    const stat = await fs.stat(cachePath);
    if (stat.size < 1000) {
      await fs.remove(cachePath);
      return null;
    }

    // Verify minimum dimensions - skip low-res images that look bad at 1080x1920
    try {
      const sharp = require("sharp");
      const meta = await sharp(cachePath).metadata();
      if (meta.width < 400 || meta.height < 400) {
        console.log(
          `[images] Skipping low-res image: ${meta.width}x${meta.height}`,
        );
        await fs.remove(cachePath);
        return null;
      }
    } catch (e) {
      // If sharp can't read it, the image is probably corrupt
      await fs.remove(cachePath);
      return null;
    }

    console.log(
      `[images] Cached: ${filename} (${Math.round(stat.size / 1024)}KB)`,
    );
    return cachePath;
  } catch (err) {
    return null;
  }
}

// --- Download the best available images for a story ---
async function getBestImage(story) {
  const images = [];

  // Priority 1: Article hero image (og:image from the news source)
  if (story.article_image) {
    const ext =
      story.article_image.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
    const cached = await downloadImage(
      story.article_image,
      `${story.id}_article.${ext}`,
    );
    if (cached)
      images.push({ path: cached, type: "article_hero", priority: 100 });
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
        images.push({ path: cached, type: img.type, priority });
      }
      if (images.length >= 10) break;
    }
  }

  // Priority 2b: Direct Steam search fallback - if hunter didn't save game_images,
  // extract game title from story title and search Steam directly
  if (
    images.filter((i) => i.type !== "article_hero").length === 0 &&
    story.title
  ) {
    try {
      // Extract likely game title from story title
      const gameTitle = story.title
        .replace(/^[^:]+:\s*/i, "")
        .replace(
          /reportedly|rumour|confirmed|leaked|says|claims|according to|has been|what are|your thoughts|out for|a week now/gi,
          "",
        )
        .replace(
          /\b(is|are|was|were|will|be|to|the|a|an|in|on|at|for|of|and|or|not|has|have|had|just|now|how|why|what|do|does)\b/gi,
          "",
        )
        .replace(/[^a-zA-Z0-9\s:'-]/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const searchTerm = gameTitle.substring(0, 60).trim();

      if (searchTerm.length > 3) {
        console.log(
          `[images] No pre-saved game images, searching Steam directly for: "${searchTerm}"`,
        );
        const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(searchTerm)}&cc=gb&l=english`;
        const searchResp = await axios.get(searchUrl, {
          timeout: 8000,
          headers: { "User-Agent": randomUA() },
        });
        const items = searchResp.data?.items || [];
        if (items.length > 0) {
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
                    });
                    ssCount++;
                  }
                }
              }
              console.log(
                `[images] Steam fallback: downloaded ${images.length} images for ${story.id}`,
              );
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

  // Priority 3: Reddit thumbnail
  if (story.thumbnail_url) {
    const cached = await downloadImage(
      story.thumbnail_url,
      `${story.id}_reddit_thumb.jpg`,
    );
    if (cached)
      images.push({ path: cached, type: "reddit_thumb", priority: 40 });
  }

  // Priority 4: Company logo
  if (story.company_logo_url) {
    const cached = await downloadImage(
      story.company_logo_url,
      `${story.id}_logo.png`,
    );
    if (cached)
      images.push({ path: cached, type: "company_logo", priority: 30 });
  }

  // Priority 5: Google image search - supplement with more variety (especially for stories with few images)
  if (images.length < 8 && story.title) {
    try {
      const searchQuery = encodeURIComponent(
        story.title.replace(/[^a-zA-Z0-9\s]/g, "").trim() + " game",
      );
      const searchUrl = `https://www.google.com/search?q=${searchQuery}&tbm=isch&safe=active`;
      const searchResp = await axios.get(searchUrl, {
        timeout: 10000,
        headers: { "User-Agent": randomUA() },
        maxRedirects: 3,
      });
      // Extract image URLs from Google Images HTML response
      const html = typeof searchResp.data === "string" ? searchResp.data : "";
      const imgMatches =
        html.match(
          /\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)",\d+,\d+\]/gi,
        ) || [];
      let googleFound = 0;
      for (const match of imgMatches.slice(0, 8)) {
        const urlMatch = match.match(/"(https?:\/\/[^"]+)"/);
        if (!urlMatch) continue;
        const imgUrl = urlMatch[1];
        // Skip tiny thumbnails and Google's own assets
        if (imgUrl.includes("gstatic.com") || imgUrl.includes("google.com"))
          continue;
        const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || "jpg";
        const cached = await downloadImage(
          imgUrl,
          `${story.id}_google_${googleFound}.${ext}`,
        );
        if (cached) {
          images.push({
            path: cached,
            type: "screenshot",
            priority: 20 - googleFound,
          });
          googleFound++;
          console.log(
            `[images] Google image ${googleFound}/3 found for "${story.title.substring(0, 40)}..."`,
          );
          if (googleFound >= 3) break;
        }
      }
    } catch (err) {
      // Google search failed silently - not critical
    }
  }

  // Download video clips from Steam trailers
  const videoClips = [];
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

  // Sort by priority (highest first)
  images.sort((a, b) => b.priority - a.priority);
  return { images, videoClips };
}

module.exports = getBestImage;
module.exports.downloadVideoClip = downloadVideoClip;
