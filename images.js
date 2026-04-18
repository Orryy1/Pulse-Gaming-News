const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const db = require("./lib/db");

dotenv.config({ override: true });

const brand = require("./brand");
const getBestImage = require("./images_download");

const OUTPUT_DIR = path.join("output", "images");
const CACHE_DIR = path.join("output", "image_cache");

// --- Platform safe zone presets ---
// Each platform overlays UI elements that obscure content in certain regions.
// These offsets shift the flair badge and headline into the visible safe zone.
const PLATFORM_SAFE_ZONES = {
  // Default (YouTube Shorts) - no adjustment needed
  default: {
    flairY: 620, // flair badge top Y
    headlineY: 770, // headline text baseline Y
    heroY: 180, // hero image top Y
    heroHeight: 563, // hero image height
    logoY: 780, // company logo Y
    gradientY: 500, // bottom fade gradient Y
  },
  // TikTok: 150px top safe zone (status bar, username), 200px bottom (action buttons, caption)
  // Main content area: y=200 to y=1720
  tiktok: {
    flairY: 720, // shifted down ~100px to clear TikTok username overlay
    headlineY: 870, // shifted down to match
    heroY: 280, // shifted down to clear top safe zone
    heroHeight: 480, // slightly shorter to fit within safe zone
    logoY: 800, // shifted down
    gradientY: 540, // adjusted for hero position
  },
  // Instagram Reels: 120px top safe zone (status bar), 300px bottom (caption area, action buttons)
  // Main content area: y=170 to y=1620
  instagram: {
    flairY: 580, // shifted up slightly - IG bottom zone is larger, so centre content higher
    headlineY: 730, // shifted up to keep headline well above the 300px bottom zone
    heroY: 200, // similar to default, IG top zone is smaller
    heroHeight: 440, // shorter to keep content out of the large bottom safe zone
    logoY: 680, // shifted up
    gradientY: 440, // adjusted for hero position
  },
};

// --- Shared SVG building helpers ---
function escapeXml(text) {
  return (text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapText(text, maxCharsPerLine) {
  const words = text.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    if ((current + " " + word).length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? current + " " + word : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// --- Build professional SVG composite with real images embedded ---
// platform: 'default' | 'tiktok' | 'instagram' - adjusts safe zones
function buildProSvg(
  title,
  thumbnailText,
  flair,
  heroImageBase64,
  logoImageBase64,
  hasHero,
  classification,
  bgImageBase64,
  platform,
) {
  const safeZone = PLATFORM_SAFE_ZONES[platform] || PLATFORM_SAFE_ZONES.default;
  const classInfo = brand.classificationColour(classification || flair);
  const flairColour = classInfo.hex;
  const flairLabel = classInfo.label;

  const escapedTitle = escapeXml(title);
  const escapedThumb = escapeXml(thumbnailText);

  // Word-wrap headline text for the large orange title (max ~14 chars per line at font-size 82)
  const thumbLines = wrapText(escapedThumb, 14);
  const thumbTspans = thumbLines
    .slice(0, 3)
    .map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : 88}">${line}</tspan>`)
    .join("");

  // Word wrap for title
  const titleLines = wrapText(escapedTitle, 24)
    .slice(0, 3)
    .map((line, i) => `<tspan x="540" dy="${i === 0 ? 0 : 72}">${line}</tspan>`)
    .join("");

  // Hero image section (if we have a real image)
  const heroSection = hasHero
    ? `
    <!-- Hero game image (blurred background fill) -->
    <image href="data:image/jpeg;base64,${heroImageBase64}" x="-100" y="0" width="1280" height="1920"
           preserveAspectRatio="xMidYMid slice" opacity="0.3" filter="url(#blur)"/>

    <!-- Hero image (centred, crisp) -->
    <image href="data:image/jpeg;base64,${heroImageBase64}" x="40" y="${safeZone.heroY}" width="1000" height="${safeZone.heroHeight}"
           preserveAspectRatio="xMidYMid meet" clip-path="url(#heroClip)"/>

    <!-- Hero image border glow -->
    <rect x="40" y="${safeZone.heroY}" width="1000" height="${safeZone.heroHeight}" rx="16" fill="none"
          stroke="${brand.PRIMARY}" stroke-width="2" opacity="0.4"/>
  `
    : `
    <!-- No hero image - use enhanced gradient background -->
    <rect x="40" y="${safeZone.heroY}" width="1000" height="${safeZone.heroHeight}" rx="16" fill="#0d1a2e" opacity="0.6"/>
    <rect x="40" y="${safeZone.heroY}" width="1000" height="${safeZone.heroHeight}" rx="16" fill="none"
          stroke="${brand.PRIMARY}" stroke-width="1" opacity="0.2"/>
  `;

  // Company logo section
  const logoSection = logoImageBase64
    ? `
    <image href="data:image/png;base64,${logoImageBase64}" x="440" y="${safeZone.logoY}" width="200" height="80"
           preserveAspectRatio="xMidYMid meet" opacity="0.8"/>
  `
    : "";

  // Flair badge SVG fragment - reused in both layouts
  const flairBadge = `
  <rect x="340" y="${safeZone.flairY}" width="400" height="52" rx="26" fill="${flairColour}" opacity="0.15"/>
  <rect x="340" y="${safeZone.flairY}" width="400" height="52" rx="26" fill="none"
        stroke="${flairColour}" stroke-width="1.5" opacity="0.5"/>
  <circle cx="375" cy="${safeZone.flairY + 26}" r="7" fill="${flairColour}"/>
  <text x="540" y="${safeZone.flairY + 34}" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="20" font-weight="700" letter-spacing="3" fill="${flairColour}">${flairLabel}</text>`;

  // Headline SVG fragment - reused in both layouts
  const headline = `
  <text x="540" y="${safeZone.headlineY}" text-anchor="middle" font-family="Inter,system-ui,sans-serif"
        font-size="82" font-weight="900" fill="${brand.PRIMARY}" filter="url(#glow)"
        letter-spacing="-2">${thumbTspans}</text>`;

  // When branded background is available, use a clean minimal layout
  // When not, fall back to the full layout with gradient + hero sections
  if (bgImageBase64) {
    return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
       width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <filter id="glow">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Branded background template -->
  <image href="data:image/png;base64,${bgImageBase64}" x="0" y="0" width="1080" height="1920" preserveAspectRatio="xMidYMid slice"/>

  <!-- Flair badge - centred in the glow -->${flairBadge}

  <!-- Main headline text - centred below badge, inside the glow -->${headline}
</svg>`;
  }

  // --- Full layout (no branded background) ---
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
      <rect x="40" y="${safeZone.heroY}" width="1000" height="${safeZone.heroHeight}" rx="16"/>
    </clipPath>
  </defs>

  <!-- Base background -->
  <rect width="1080" height="1920" fill="url(#bg)"/>

  ${heroSection}

  <!-- Gradient fade over hero bottom -->
  <rect x="0" y="${safeZone.gradientY}" width="1080" height="300" fill="url(#bottomFade)"/>

  <!-- Scanlines (brand signature) -->
  <pattern id="scanlines" patternUnits="userSpaceOnUse" width="1080" height="4">
    <rect width="1080" height="3" fill="transparent"/>
    <rect width="1080" height="1" y="3" fill="rgba(0,0,0,0.15)"/>
  </pattern>
  <rect width="1080" height="1920" fill="url(#scanlines)"/>

  ${logoSection}

  <!-- Flair badge -->${flairBadge}

  <!-- Main headline text -->${headline}
</svg>`;
}

// --- Platform-specific SVG builders (delegate to buildProSvg with safe zone parameter) ---
function buildTikTokSvg(
  title,
  thumbnailText,
  flair,
  heroImageBase64,
  logoImageBase64,
  hasHero,
  classification,
  bgImageBase64,
) {
  return buildProSvg(
    title,
    thumbnailText,
    flair,
    heroImageBase64,
    logoImageBase64,
    hasHero,
    classification,
    bgImageBase64,
    "tiktok",
  );
}

function buildInstagramSvg(
  title,
  thumbnailText,
  flair,
  heroImageBase64,
  logoImageBase64,
  hasHero,
  classification,
  bgImageBase64,
) {
  return buildProSvg(
    title,
    thumbnailText,
    flair,
    heroImageBase64,
    logoImageBase64,
    hasHero,
    classification,
    bgImageBase64,
    "instagram",
  );
}

// --- Fallback SVG (no downloaded images available) ---
function buildFallbackSvg(title, thumbnailText, flair, platform) {
  return buildProSvg(
    title,
    thumbnailText,
    flair,
    null,
    null,
    false,
    null,
    null,
    platform,
  );
}

async function generateImages() {
  console.log("[images] === Professional Image Pipeline v2 ===");

  // Phase 3C JSON-shrink: replace the old daily_news.json pathExists
  // check with a canonical-store emptiness check. SQLite-on prod may
  // not have the JSON file at all, but does have stories.
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log(
      "[images] ERROR: no stories in canonical store. Run processor first.",
    );
    return;
  }

  await fs.ensureDir(OUTPUT_DIR);
  await fs.ensureDir(CACHE_DIR);

  const toProcess = stories.filter((s) => s.approved === true && !s.image_path);

  // Load branded thumbnail background once
  const bgPath = path.join(__dirname, "branding", "shorts_thumbnail_bg.png");
  let bgBase64 = null;
  if (await fs.pathExists(bgPath)) {
    try {
      bgBase64 = (await fs.readFile(bgPath)).toString("base64");
      console.log("[images] Using branded thumbnail background");
    } catch (err) {
      /* fall back to gradient */
    }
  }

  console.log(`[images] ${toProcess.length} stories need image generation`);

  for (const story of toProcess) {
    console.log(`[images] Processing: ${story.title}`);

    // Download best available images
    const result = await getBestImage(story);
    const availableImages = result.images || result;
    const videoClips = result.videoClips || [];
    console.log(
      `[images] Found ${availableImages.length} images + ${videoClips.length} video clips for ${story.id}`,
    );

    // Read hero image as base64 for SVG embedding
    let heroBase64 = null;
    let logoBase64 = null;

    const heroImg = availableImages.find((i) =>
      ["article_hero", "capsule", "hero", "key_art", "screenshot"].includes(
        i.type,
      ),
    );
    if (heroImg) {
      try {
        const buf = await fs.readFile(heroImg.path);
        heroBase64 = buf.toString("base64");
      } catch (err) {
        console.log(`[images] Could not read hero image: ${err.message}`);
      }
    }

    const logoImg = availableImages.find((i) => i.type === "company_logo");
    if (logoImg) {
      try {
        const buf = await fs.readFile(logoImg.path);
        logoBase64 = buf.toString("base64");
      } catch (err) {
        // Skip logo
      }
    }

    // Build SVG with real images + branded background
    const svg = buildProSvg(
      story.title,
      story.suggested_thumbnail_text,
      story.flair,
      heroBase64,
      logoBase64,
      !!heroBase64,
      story.classification,
      bgBase64,
    );

    const svgPath = path.join(OUTPUT_DIR, `${story.id}.svg`);
    const pngPath = path.join(OUTPUT_DIR, `${story.id}.png`);
    await fs.writeFile(svgPath, svg, "utf-8");

    // Convert SVG to PNG via Sharp
    try {
      const sharp = require("sharp");
      // Subtle random variance to ensure unique file hashes (anti-fingerprinting)
      const hueShift = Math.floor(Math.random() * 6); // 0-5 degrees
      const brightnessMod = 0.98 + Math.random() * 0.04; // 0.98-1.02
      await sharp(Buffer.from(svg))
        .resize(1080, 1920)
        .modulate({ hue: hueShift, brightness: brightnessMod })
        .png({ quality: 95 })
        .toFile(pngPath);
      story.image_path = pngPath;
      const stat = await fs.stat(pngPath);
      console.log(
        `[images] Saved: ${pngPath} (${Math.round(stat.size / 1024)}KB)`,
      );
    } catch (err) {
      console.log(`[images] PNG conversion failed, using SVG: ${err.message}`);
      story.image_path = svgPath;
    }

    // --- Generate platform-specific thumbnail variants ---
    const platformVariants = [
      {
        platform: "tiktok",
        suffix: "_tiktok",
        storyKey: "tiktok_thumbnail_path",
      },
      {
        platform: "instagram",
        suffix: "_instagram",
        storyKey: "instagram_thumbnail_path",
      },
    ];

    for (const variant of platformVariants) {
      const variantSvg = buildProSvg(
        story.title,
        story.suggested_thumbnail_text,
        story.flair,
        heroBase64,
        logoBase64,
        !!heroBase64,
        story.classification,
        bgBase64,
        variant.platform,
      );

      const variantPngPath = path.join(
        OUTPUT_DIR,
        `${story.id}${variant.suffix}.png`,
      );

      try {
        const sharp = require("sharp");
        // Subtle random variance to ensure unique file hashes (anti-fingerprinting)
        const variantHueShift = Math.floor(Math.random() * 6); // 0-5 degrees
        const variantBrightnessMod = 0.98 + Math.random() * 0.04; // 0.98-1.02
        await sharp(Buffer.from(variantSvg))
          .resize(1080, 1920)
          .modulate({ hue: variantHueShift, brightness: variantBrightnessMod })
          .png({ quality: 95 })
          .toFile(variantPngPath);
        story[variant.storyKey] = variantPngPath;
        const stat = await fs.stat(variantPngPath);
        console.log(
          `[images] Saved ${variant.platform} variant: ${variantPngPath} (${Math.round(stat.size / 1024)}KB)`,
        );
      } catch (err) {
        console.log(
          `[images] ${variant.platform} variant failed (non-fatal): ${err.message}`,
        );
      }
    }

    // Store all image paths for the video assembly to use
    story.downloaded_images = availableImages.map((i) => ({
      path: i.path,
      type: i.type,
    }));
    // Store video clips for assembly (Steam trailers, gameplay footage)
    if (videoClips.length > 0) {
      story.video_clips = videoClips.map((c) => c.path);
    }
  }

  await db.saveStories(stories);
  console.log("[images] Stories updated");
}

module.exports = generateImages;

if (require.main === module) {
  generateImages().catch((err) => {
    console.log(`[images] ERROR: ${err.message}`);
    process.exit(1);
  });
}
