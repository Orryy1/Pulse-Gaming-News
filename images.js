const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');
const util = require('util');

const execAsync = util.promisify(exec);

dotenv.config({ override: true });

function buildSvg(title, thumbnailText, flair) {
  const flairColour = flair === 'Verified' ? '#10B981' : flair === 'Highly Likely' ? '#F59E0B' : '#F97316';
  const escapedTitle = title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const escapedThumb = (thumbnailText || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Wrap title text manually (rough 30-char line breaks)
  const words = escapedTitle.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).length > 28 && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + ' ' + word : word;
    }
  }
  if (current) lines.push(current);

  const titleLines = lines.slice(0, 4).map((line, i) =>
    `<tspan x="540" dy="${i === 0 ? 0 : 62}">${line}</tspan>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0a1628"/>
      <stop offset="50%" stop-color="#1E2330"/>
      <stop offset="100%" stop-color="#0a1628"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1080" height="1920" fill="url(#bg)"/>

  <!-- Scanlines -->
  <pattern id="scanlines" patternUnits="userSpaceOnUse" width="1080" height="4">
    <rect width="1080" height="3" fill="transparent"/>
    <rect width="1080" height="1" y="3" fill="rgba(0,0,0,0.15)"/>
  </pattern>
  <rect width="1080" height="1920" fill="url(#scanlines)"/>

  <!-- Accent lines -->
  <rect x="80" y="300" width="4" height="200" fill="#39FF14" opacity="0.3"/>
  <rect x="996" y="1400" width="4" height="200" fill="#39FF14" opacity="0.3"/>

  <!-- Glow circle -->
  <circle cx="540" cy="700" r="300" fill="#39FF14" opacity="0.03" filter="id(glow)"/>

  <!-- Flair badge -->
  <rect x="390" y="500" width="300" height="44" rx="22" fill="${flairColour}" opacity="0.15"/>
  <rect x="390" y="500" width="300" height="44" rx="22" fill="none" stroke="${flairColour}" stroke-width="1.5" opacity="0.4"/>
  <circle cx="420" cy="522" r="6" fill="${flairColour}"/>
  <text x="540" y="530" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="18" font-weight="700" letter-spacing="2" fill="${flairColour}">${flair.toUpperCase()}</text>

  <!-- Main thumbnail text -->
  <text x="540" y="720" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="88" font-weight="900" fill="#39FF14" filter="url(#glow)" letter-spacing="-1">${escapedThumb}</text>

  <!-- Title -->
  <text x="540" y="920" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="48" font-weight="700" fill="rgba(255,255,255,0.85)">
    ${titleLines}
  </text>

  <!-- Bottom bar -->
  <rect x="0" y="1760" width="1080" height="160" fill="rgba(0,0,0,0.6)"/>
  <rect x="0" y="1760" width="1080" height="2" fill="#39FF14" opacity="0.4"/>
  <text x="540" y="1840" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="700" letter-spacing="6" fill="#39FF14" opacity="0.7">PULSE GAMING</text>
  <text x="540" y="1880" text-anchor="middle" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="500" letter-spacing="3" fill="rgba(255,255,255,0.3)">VERIFIED GAMING LEAKS DAILY</text>
</svg>`;
}

async function generateImages() {
  console.log('[images] Loading daily_news.json...');

  if (!await fs.pathExists('daily_news.json')) {
    console.log('[images] ERROR: daily_news.json not found. Run processor first.');
    return;
  }

  const stories = await fs.readJson('daily_news.json');
  const toProcess = stories.filter(s => s.approved === true && !s.image_path);

  console.log(`[images] ${toProcess.length} stories need image generation`);

  for (const story of toProcess) {
    console.log(`[images] Generating thumbnail for: ${story.title}`);

    const svg = buildSvg(story.title, story.suggested_thumbnail_text, story.flair);
    const svgPath = path.join('output', 'images', `${story.id}.svg`);
    const pngPath = path.join('output', 'images', `${story.id}.png`);
    await fs.ensureDir(path.dirname(svgPath));

    // Save SVG and convert to PNG via sharp
    await fs.writeFile(svgPath, svg, 'utf-8');

    try {
      const sharp = require('sharp');
      await sharp(Buffer.from(svg))
        .resize(1080, 1920)
        .png()
        .toFile(pngPath);
      story.image_path = pngPath;
      const stat = await fs.stat(pngPath);
      console.log(`[images] Saved: ${pngPath} (${Math.round(stat.size / 1024)}KB)`);
    } catch (err) {
      console.log(`[images] PNG conversion failed, using SVG: ${err.message}`);
      story.image_path = svgPath;
    }
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
