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

    // Verify minimum dimensions - skip low-res images that look bad at 1080x1920
    try {
      const sharp = require('sharp');
      const meta = await sharp(cachePath).metadata();
      if (meta.width < 400 || meta.height < 400) {
        console.log(`[images] Skipping low-res image: ${meta.width}x${meta.height}`);
        await fs.remove(cachePath);
        return null;
      }
    } catch (e) {
      // If sharp can't read it, the image is probably corrupt
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
      if (images.length >= 10) break;
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

  // Priority 5: Google image search - supplement with more variety (especially for stories with few images)
  if (images.length < 8 && story.title) {
    try {
      const searchQuery = encodeURIComponent(story.title.replace(/[^a-zA-Z0-9\s]/g, '').trim() + ' game');
      const searchUrl = `https://www.google.com/search?q=${searchQuery}&tbm=isch&safe=active`;
      const searchResp = await axios.get(searchUrl, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
        maxRedirects: 3,
      });
      // Extract image URLs from Google Images HTML response
      const html = typeof searchResp.data === 'string' ? searchResp.data : '';
      const imgMatches = html.match(/\["(https?:\/\/[^"]+\.(?:jpg|jpeg|png|webp)(?:\?[^"]*)?)",\d+,\d+\]/gi) || [];
      let googleFound = 0;
      for (const match of imgMatches.slice(0, 8)) {
        const urlMatch = match.match(/"(https?:\/\/[^"]+)"/);
        if (!urlMatch) continue;
        const imgUrl = urlMatch[1];
        // Skip tiny thumbnails and Google's own assets
        if (imgUrl.includes('gstatic.com') || imgUrl.includes('google.com')) continue;
        const ext = imgUrl.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
        const cached = await downloadImage(imgUrl, `${story.id}_google_${googleFound}.${ext}`);
        if (cached) {
          images.push({ path: cached, type: 'screenshot', priority: 20 - googleFound });
          googleFound++;
          console.log(`[images] Google image ${googleFound}/3 found for "${story.title.substring(0, 40)}..."`);
          if (googleFound >= 3) break;
        }
      }
    } catch (err) {
      // Google search failed silently - not critical
    }
  }

  // Sort by priority (highest first)
  images.sort((a, b) => b.priority - a.priority);
  return images;
}

module.exports = getBestImage;
