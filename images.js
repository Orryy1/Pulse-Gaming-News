const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const dotenv = require('dotenv');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

const brand = require('./brand');

const OUTPUT_DIR = path.join('output', 'images');
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

// --- Download the best available image for a story ---
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

// --- Build professional SVG composite with real images embedded ---
function buildProSvg(title, thumbnailText, flair, heroImageBase64, logoImageBase64, hasHero, classification) {
  const classInfo = brand.classificationColour(classification || flair);
  const flairColour = classInfo.hex;
  const flairLabel = classInfo.label;

  const escapedTitle = title
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escapedThumb = (thumbnailText || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Word wrap for title
  const words = escapedTitle.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).length > 24 && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);

  const titleLines = lines.slice(0, 3).map((line, i) =>
    `<tspan x="540" dy="${i === 0 ? 0 : 72}">${line}</tspan>`
  ).join('');

  // Hero image section (if we have a real image)
  const heroSection = hasHero ? `
    <!-- Hero game image (blurred background fill) -->
    <image href="data:image/jpeg;base64,${heroImageBase64}" x="-100" y="0" width="1280" height="1920"
           preserveAspectRatio="xMidYMid slice" opacity="0.3" filter="url(#blur)"/>

    <!-- Hero image (centred, crisp) -->
    <image href="data:image/jpeg;base64,${heroImageBase64}" x="40" y="180" width="1000" height="563"
           preserveAspectRatio="xMidYMid meet" clip-path="url(#heroClip)"/>

    <!-- Hero image border glow -->
    <rect x="40" y="180" width="1000" height="563" rx="16" fill="none"
          stroke="${brand.PRIMARY}" stroke-width="2" opacity="0.4"/>
  ` : `
    <!-- No hero image — use enhanced gradient background -->
    <rect x="40" y="180" width="1000" height="563" rx="16" fill="#0d1a2e" opacity="0.6"/>
    <rect x="40" y="180" width="1000" height="563" rx="16" fill="none"
          stroke="${brand.PRIMARY}" stroke-width="1" opacity="0.2"/>
  `;

  // Company logo section
  const logoSection = logoImageBase64 ? `
    <image href="data:image/png;base64,${logoImageBase64}" x="440" y="780" width="200" height="80"
           preserveAspectRatio="xMidYMid meet" opacity="0.8"/>
  ` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
       width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${brand.SECONDARY}"/>
      <stop offset="40%" stop-color="#131315"/>
      <stop offset="100%" stop-color="${brand.SECONDARY}"/>
    </linearGradient>
    <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="100%" stop-color="${brand.SECONDARY}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="blur">
      <feGaussianBlur stdDeviation="20"/>
    </filter>
    <filter id="shadow">
      <feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="#000" flood-opacity="0.7"/>
    </filter>
    <clipPath id="heroClip">
      <rect x="40" y="180" width="1000" height="563" rx="16"/>
    </clipPath>
  </defs>

  <!-- Base background -->
  <rect width="1080" height="1920" fill="url(#bg)"/>

  ${heroSection}

  <!-- Gradient fade over hero bottom -->
  <rect x="0" y="500" width="1080" height="300" fill="url(#bottomFade)"/>

  <!-- Scanlines (brand signature) -->
  <pattern id="scanlines" patternUnits="userSpaceOnUse" width="1080" height="4">
    <rect width="1080" height="3" fill="transparent"/>
    <rect width="1080" height="1" y="3" fill="rgba(0,0,0,0.15)"/>
  </pattern>
  <rect width="1080" height="1920" fill="url(#scanlines)"/>

  <!-- Breaking news banner -->
  <rect x="0" y="100" width="1080" height="60" fill="${brand.PRIMARY}" opacity="0.12"/>
  <rect x="0" y="100" width="1080" height="2" fill="${brand.PRIMARY}" opacity="0.6"/>
  <rect x="0" y="158" width="1080" height="2" fill="${brand.PRIMARY}" opacity="0.3"/>
  <text x="540" y="140" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="20" font-weight="800" letter-spacing="8" fill="${brand.PRIMARY}" opacity="0.9">${flairLabel}</text>

  ${logoSection}

  <!-- Flair badge -->
  <rect x="340" y="880" width="400" height="52" rx="26" fill="${flairColour}" opacity="0.15"/>
  <rect x="340" y="880" width="400" height="52" rx="26" fill="none"
        stroke="${flairColour}" stroke-width="1.5" opacity="0.5"/>
  <circle cx="375" cy="906" r="7" fill="${flairColour}"/>
  <text x="540" y="914" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="20" font-weight="700" letter-spacing="3" fill="${flairColour}">${flairLabel}</text>

  <!-- Main headline text (large, attention-grabbing) -->
  <text x="540" y="1020" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="82" font-weight="900" fill="${brand.PRIMARY}" filter="url(#glow)"
        letter-spacing="-2">${escapedThumb}</text>

  <!-- Story title -->
  <text x="540" y="1160" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="52" font-weight="700" fill="rgba(255,255,255,0.9)" filter="url(#shadow)">
    ${titleLines}
  </text>

  <!-- Accent design elements -->
  <rect x="60" y="1400" width="960" height="1" fill="${brand.PRIMARY}" opacity="0.15"/>
  <rect x="60" y="300" width="3" height="200" fill="${brand.PRIMARY}" opacity="0.2"/>
  <rect x="1017" y="1400" width="3" height="200" fill="${brand.PRIMARY}" opacity="0.2"/>

  <!-- Bottom bar (branded) -->
  <rect x="0" y="1750" width="1080" height="170" fill="rgba(0,0,0,0.75)"/>
  <rect x="0" y="1750" width="1080" height="3" fill="${brand.PRIMARY}" opacity="0.5"/>

  <!-- Pulse Gaming branding -->
  <circle cx="440" cy="1835" r="4" fill="${brand.PRIMARY}"/>
  <text x="540" y="1845" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="32" font-weight="800" letter-spacing="8" fill="${brand.PRIMARY}" opacity="0.85">PULSE GAMING</text>
  <text x="540" y="1885" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="15" font-weight="500" letter-spacing="4" fill="${brand.MUTED}">VERIFIED LEAKS &amp; BREAKING NEWS // DAILY</text>

  <!-- Live indicator dot -->
  <circle cx="70" cy="120" r="6" fill="#ff0033">
    <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite"/>
  </circle>
  <text x="90" y="126" font-family="Inter,system-ui,sans-serif" font-size="14"
        font-weight="700" letter-spacing="2" fill="#ff0033" opacity="0.8">LIVE</text>
</svg>`;
}

// --- Fallback SVG (no downloaded images available) ---
function buildFallbackSvg(title, thumbnailText, flair) {
  return buildProSvg(title, thumbnailText, flair, null, null, false);
}

async function generateImages() {
  console.log('[images] === Professional Image Pipeline v2 ===');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[images] ERROR: daily_news.json not found. Run processor first.');
    return;
  }

  await fs.ensureDir(OUTPUT_DIR);
  await fs.ensureDir(CACHE_DIR);

  const stories = await fs.readJson('daily_news.json');
  const toProcess = stories.filter(s => s.approved === true && !s.image_path);

  console.log(`[images] ${toProcess.length} stories need image generation`);

  for (const story of toProcess) {
    console.log(`[images] Processing: ${story.title}`);

    // Download best available images
    const availableImages = await getBestImage(story);
    console.log(`[images] Found ${availableImages.length} images for ${story.id}`);

    // Read hero image as base64 for SVG embedding
    let heroBase64 = null;
    let logoBase64 = null;

    const heroImg = availableImages.find(i => ['article_hero', 'capsule', 'hero', 'key_art', 'screenshot'].includes(i.type));
    if (heroImg) {
      try {
        const buf = await fs.readFile(heroImg.path);
        heroBase64 = buf.toString('base64');
      } catch (err) {
        console.log(`[images] Could not read hero image: ${err.message}`);
      }
    }

    const logoImg = availableImages.find(i => i.type === 'company_logo');
    if (logoImg) {
      try {
        const buf = await fs.readFile(logoImg.path);
        logoBase64 = buf.toString('base64');
      } catch (err) {
        // Skip logo
      }
    }

    // Build SVG with real images
    const svg = buildProSvg(
      story.title,
      story.suggested_thumbnail_text,
      story.flair,
      heroBase64,
      logoBase64,
      !!heroBase64,
      story.classification
    );

    const svgPath = path.join(OUTPUT_DIR, `${story.id}.svg`);
    const pngPath = path.join(OUTPUT_DIR, `${story.id}.png`);
    await fs.writeFile(svgPath, svg, 'utf-8');

    // Convert SVG to PNG via Sharp
    try {
      const sharp = require('sharp');
      await sharp(Buffer.from(svg))
        .resize(1080, 1920)
        .png({ quality: 95 })
        .toFile(pngPath);
      story.image_path = pngPath;
      const stat = await fs.stat(pngPath);
      console.log(`[images] Saved: ${pngPath} (${Math.round(stat.size / 1024)}KB)`);
    } catch (err) {
      console.log(`[images] PNG conversion failed, using SVG: ${err.message}`);
      story.image_path = svgPath;
    }

    // Store all image paths for the video assembly to use
    story.downloaded_images = availableImages.map(i => ({ path: i.path, type: i.type }));
  }

  await fs.writeJson('daily_news.json', stories, { spaces: 2 });
  console.log('[images] daily_news.json updated');
}

module.exports = generateImages;

if (require.main === module) {
  generateImages().catch(err => {
    console.log(`[images] ERROR: ${err.message}`);
    process.exit(1);
  });
}
