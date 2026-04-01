/*
  Shared image downloading logic used by both images.js and assemble.js.
  Downloads real game/article images from URLs stored in story objects.
*/

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');

const CACHE_DIR = path.join('output', 'image_cache');

// --- Download and cache an image from URL ---
async function downloadImage(url, filename) {
  const cachePath = path.join(CACHE_DIR, filename);
  if (await fs.pathExists(cachePath)) return cachePath;

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PulseGaming/2.0)' },
      maxRedirects: 5,
    });

    await fs.ensureDir(CACHE_DIR);
    await fs.writeFile(cachePath, Buffer.from(response.data));

    const stat = await fs.stat(cachePath);
    if (stat.size < 1000) {
      await fs.remove(cachePath);
      return null;
    }

    console.log(`[images] Cached: ${filename} (${Math.round(stat.size / 1024)}KB)`);
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
    const ext = story.article_image.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
    const cached = await downloadImage(story.article_image, `${story.id}_article.${ext}`);
    if (cached) images.push({ path: cached, type: 'article_hero', priority: 100 });
  }

  // Priority 2: Steam key art / hero images
  if (story.game_images && story.game_images.length > 0) {
    for (const img of story.game_images) {
      const safeName = `${story.id}_${img.type}_${img.source}.jpg`;
      const cached = await downloadImage(img.url, safeName);
      if (cached) {
        const priority = img.type === 'capsule' ? 95 : img.type === 'hero' ? 90 : img.type === 'key_art' ? 85 : 70;
        images.push({ path: cached, type: img.type, priority });
      }
      if (images.length >= 3) break;
    }
  }

  // Priority 3: Reddit thumbnail
  if (story.thumbnail_url) {
    const cached = await downloadImage(story.thumbnail_url, `${story.id}_reddit_thumb.jpg`);
    if (cached) images.push({ path: cached, type: 'reddit_thumb', priority: 40 });
  }

  // Priority 4: Company logo
  if (story.company_logo_url) {
    const cached = await downloadImage(story.company_logo_url, `${story.id}_logo.png`);
    if (cached) images.push({ path: cached, type: 'company_logo', priority: 30 });
  }

  // Sort by priority (highest first)
  images.sort((a, b) => b.priority - a.priority);
  return images;
}

module.exports = getBestImage;
