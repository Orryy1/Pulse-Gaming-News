const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");

dotenv.config({ override: true });

const brand = require("./brand");

const OUTPUT_DIR = path.join("output", "stories");
const CACHE_DIR = path.join("output", "image_cache");

// --- Build Instagram Story SVG ---
function buildStorySvg(title, flair, heroImageBase64, hasHero, classification) {
  const classInfo = brand.classificationColour(classification || flair);
  const flairColour = classInfo.hex;
  const flairLabel = classInfo.label;

  const escapedTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Word-wrap title - wider layout for stories (max ~22 chars per line)
  const words = escapedTitle.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).length > 22 && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);

  const titleTspans = lines
    .slice(0, 4)
    .map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : 68}">${line}</tspan>`)
    .join("");

  const heroSection = hasHero
    ? `
    <!-- Full bleed hero image (background) -->
    <image href="data:image/jpeg;base64,${heroImageBase64}" x="-200" y="0" width="1480" height="1920"
           preserveAspectRatio="xMidYMid slice" opacity="0.4" filter="url(#blur)"/>

    <!-- Hero image (main, upper portion) -->
    <image href="data:image/jpeg;base64,${heroImageBase64}" x="60" y="200" width="960" height="540"
           preserveAspectRatio="xMidYMid slice" clip-path="url(#heroClip)"/>
    <rect x="60" y="200" width="960" height="540" rx="20" fill="none"
          stroke="${brand.PRIMARY}" stroke-width="2" opacity="0.5"/>
  `
    : `
    <!-- No hero - gradient placeholder -->
    <rect x="60" y="200" width="960" height="540" rx="20" fill="#0d1a2e" opacity="0.5"/>
    <rect x="60" y="200" width="960" height="540" rx="20" fill="none"
          stroke="${brand.PRIMARY}" stroke-width="1" opacity="0.3"/>
  `;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
       width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${brand.SECONDARY}"/>
      <stop offset="50%" stop-color="#0a0a0c"/>
      <stop offset="100%" stop-color="${brand.SECONDARY}"/>
    </linearGradient>
    <linearGradient id="heroFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="transparent"/>
      <stop offset="60%" stop-color="transparent"/>
      <stop offset="100%" stop-color="${brand.SECONDARY}"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="blur">
      <feGaussianBlur stdDeviation="25"/>
    </filter>
    <filter id="shadow">
      <feDropShadow dx="0" dy="3" stdDeviation="6" flood-color="#000" flood-opacity="0.8"/>
    </filter>
    <clipPath id="heroClip">
      <rect x="60" y="200" width="960" height="540" rx="20"/>
    </clipPath>
  </defs>

  <!-- Base background -->
  <rect width="1080" height="1920" fill="url(#bg)"/>

  ${heroSection}

  <!-- Gradient fade over hero -->
  <rect x="0" y="400" width="1080" height="400" fill="url(#heroFade)"/>

  <!-- Flair badge - top of content area -->
  <rect x="60" y="140" width="180" height="42" rx="21" fill="${flairColour}" opacity="0.9"/>
  <circle cx="85" cy="161" r="5" fill="white" opacity="0.9">
    <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="indefinite"/>
  </circle>
  <text x="150" y="168" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="17" font-weight="800" letter-spacing="2" fill="white">${flairLabel}</text>

  <!-- Headline -->
  <text x="540" y="880" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="56" font-weight="900" fill="${brand.TEXT}" filter="url(#shadow)"
        letter-spacing="-1">${titleTspans}</text>

  <!-- Amber accent divider -->
  <rect x="390" y="1140" width="300" height="3" rx="1.5" fill="${brand.PRIMARY}" opacity="0.7"/>

  <!-- NEW VIDEO prompt -->
  <text x="540" y="1220" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="24" font-weight="700" letter-spacing="6" fill="${brand.PRIMARY}" opacity="0.9">NEW VIDEO</text>

  <!-- Watch now CTA -->
  <rect x="340" y="1280" width="400" height="70" rx="35" fill="${brand.PRIMARY}" opacity="0.9"/>
  <text x="540" y="1325" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="24" font-weight="800" letter-spacing="2" fill="white">WATCH NOW</text>

  <!-- Swipe up indicator -->
  <polygon points="530,1420 540,1400 550,1420" fill="${brand.TEXT}" opacity="0.4"/>
  <polygon points="530,1440 540,1420 550,1440" fill="${brand.TEXT}" opacity="0.25"/>

  <!-- Bottom brand bar -->
  <rect x="0" y="1750" width="1080" height="170" fill="rgba(0,0,0,0.7)"/>
  <rect x="0" y="1750" width="1080" height="2" fill="${brand.PRIMARY}" opacity="0.4"/>

  <!-- Pulse Gaming logo area -->
  <text x="540" y="1830" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="28" font-weight="800" letter-spacing="6" fill="${brand.PRIMARY}" opacity="0.85">PULSE GAMING</text>
  <text x="540" y="1870" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="14" font-weight="500" letter-spacing="4" fill="${brand.MUTED}">VERIFIED LEAKS. EVERY DAY.</text>

  <!-- Scanlines -->
  <pattern id="scanlines" patternUnits="userSpaceOnUse" width="1080" height="4">
    <rect width="1080" height="3" fill="transparent"/>
    <rect width="1080" height="1" y="3" fill="rgba(0,0,0,0.12)"/>
  </pattern>
  <rect width="1080" height="1920" fill="url(#scanlines)"/>
</svg>`;
}

async function generateStoryImages() {
  console.log("[stories] === Instagram Story Image Generator ===");

  // Phase 3C JSON-shrink: read through canonical store rather than
  // checking daily_news.json directly.
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log("[stories] No stories in canonical store");
    return;
  }

  // OUTPUT_DIR is the repo-relative base ("output/stories") that
  // lands in DB rows. The physical target dir may live under
  // MEDIA_ROOT on Railway — resolve it before ensuring.
  const outputDirAbs = mediaPaths.writePath(OUTPUT_DIR);
  await fs.ensureDir(outputDirAbs);

  const toProcess = stories.filter(
    (s) => s.approved === true && s.exported_path && !s.story_image_path,
  );

  console.log(`[stories] ${toProcess.length} stories need Story images`);

  for (const story of toProcess) {
    console.log(
      `[stories] Generating Story image: ${story.title.substring(0, 50)}...`,
    );

    // Try to load hero image from cache.
    // Preferred types first (article_hero → capsule → hero → key_art →
    // screenshot → reddit_thumb) then fall through to ANY non-logo
    // downloaded image. The previous strict whitelist silently fell
    // through to a black placeholder whenever the available types
    // didn't match, which is how movie/industry stories with only
    // inline screenshots or reddit thumbnails ended up with no hero.
    let heroBase64 = null;
    const preferredOrder = [
      "article_hero",
      "capsule",
      "hero",
      "key_art",
      "screenshot",
      "reddit_thumb",
    ];
    if (story.downloaded_images && story.downloaded_images.length > 0) {
      const candidates = story.downloaded_images.filter(
        (i) => i.path && i.type !== "company_logo",
      );
      candidates.sort((a, b) => {
        const ai = preferredOrder.indexOf(a.type);
        const bi = preferredOrder.indexOf(b.type);
        const av = ai === -1 ? 999 : ai;
        const bv = bi === -1 ? 999 : bi;
        return av - bv;
      });
      for (const heroImg of candidates) {
        // Downloaded cache paths go through media-paths too —
        // MEDIA_ROOT when set, repo-root fallback for legacy rows.
        const heroAbs = await mediaPaths.resolveExisting(heroImg.path);
        if (!heroAbs || !(await fs.pathExists(heroAbs))) continue;
        try {
          const buf = await fs.readFile(heroAbs);
          heroBase64 = buf.toString("base64");
          break;
        } catch (err) {
          console.log(
            `[stories] Could not read ${heroImg.type} (${heroImg.path}): ${err.message}`,
          );
        }
      }
    }
    if (!heroBase64) {
      console.log(
        `[stories] ${story.id}: no hero image available (downloaded_images=${story.downloaded_images?.length || 0})`,
      );
    }

    const svg = buildStorySvg(
      story.title,
      story.flair,
      heroBase64,
      !!heroBase64,
      story.classification,
    );

    // DB stores the repo-relative path (unchanged contract). The
    // physical write target resolves through media-paths so it
    // lands under MEDIA_ROOT (e.g. /data/media) when set.
    const svgPath = path.join(OUTPUT_DIR, `${story.id}_story.svg`);
    const pngPath = path.join(OUTPUT_DIR, `${story.id}_story.png`);
    const svgWriteAbs = mediaPaths.writePath(svgPath);
    const pngWriteAbs = mediaPaths.writePath(pngPath);
    await fs.writeFile(svgWriteAbs, svg, "utf-8");

    try {
      const sharp = require("sharp");
      await sharp(Buffer.from(svg)).png({ quality: 95 }).toFile(pngWriteAbs);

      story.story_image_path = pngPath;
      console.log(`[stories] Saved: ${pngPath}`);
    } catch (err) {
      console.log(`[stories] Sharp conversion failed: ${err.message}`);
      story.story_image_path = svgPath;
    }
  }

  await db.saveStories(stories);
  console.log(`[stories] Generated ${toProcess.length} Story images`);

  // Story images are auto-approved - no Discord gate needed.
  // Images are generated, saved, and ready for use immediately.
  if (toProcess.length > 0) {
    console.log(
      `[stories] ${toProcess.length} Story images ready (auto-approved)`,
    );
  }
}

module.exports = { generateStoryImages, buildStorySvg };

if (require.main === module) {
  generateStoryImages().catch((err) => {
    console.log(`[stories] ERROR: ${err.message}`);
    process.exit(1);
  });
}
