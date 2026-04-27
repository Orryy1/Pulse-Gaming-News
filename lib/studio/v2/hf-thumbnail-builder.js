/**
 * lib/studio/v2/hf-thumbnail-builder.js — per-story YouTube thumbnail.
 *
 * Renders a 1280×720 thumbnail JPEG for a given story by:
 *   1. Copying the hf-thumbnail composition into experiments/hf-thumbnail-<id>/
 *   2. Swapping in story-specific subject art (best available image),
 *      headline (curiosity-gap formatted), flair badge (with colour
 *      keyed off the channel's classificationColour map), sub-line
 *   3. Applying the channel theme (re-uses applyThemeToHtml from
 *      channel-themes.js)
 *   4. Letting HyperFrames render a single frame, then ffprobe the
 *      MP4 → extract frame 0 to a JPEG at test/output/thumb_<id>.jpg
 *
 * Output: a 1280×720 PNG-quality JPEG suitable for direct upload to
 * YouTube via the videos.thumbnails.set Data API endpoint or for
 * batch download from the operator dashboard.
 *
 * Subject art priority:
 *   1. story.article_image_path   — the publisher's hero (sharpest)
 *   2. trailerframe_1_smartcrop_v2.jpg — first trailer frame, smart-cropped
 *   3. trailerframe_2_smartcrop_v2.jpg
 *   4. fallback to the channel backdrop in the template
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execSync } = require("node:child_process");
const { applyThemeToHtml, getChannelTheme } = require("./channel-themes");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const TEMPLATE_DIR = path.join(ROOT, "experiments", "hf-thumbnail");
const TEST_OUT = path.join(ROOT, "test", "output");
const IMAGE_CACHE = path.join(ROOT, "output", "image_cache");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function pickFlairBadge(flair, classificationColour) {
  const f = String(flair || "").toLowerCase();
  let label = "BREAKING";
  let cssClass = ""; // amber default
  if (/leak/.test(f)) {
    label = "LEAK";
    cssClass = "alert"; // red
  } else if (/rumour|rumor/.test(f)) {
    label = "RUMOUR";
    cssClass = ""; // amber
  } else if (/confirmed|verified/.test(f)) {
    label = "CONFIRMED";
    cssClass = "confirm"; // green
  } else if (/news/.test(f)) {
    label = "NEWS";
    cssClass = "";
  } else if (/breaking/.test(f)) {
    label = "BREAKING";
    cssClass = "alert";
  }
  // If the channel exposes a classificationColour resolver, prefer it
  // (more accurate per channel than my generic regex).
  if (typeof classificationColour === "function") {
    try {
      const c = classificationColour(flair || "");
      if (c?.label) label = String(c.label).toUpperCase();
      // colour: red-ish goes to alert, green-ish goes to confirm
      const hex = String(c?.hex || "").toLowerCase();
      if (/^#?(?:ff|f[02-9])/i.test(hex.replace(/^#/, ""))) {
        // dominantly red — alert
        cssClass = "alert";
      } else if (/^#?00/i.test(hex.replace(/^#/, ""))) {
        cssClass = "confirm";
      }
    } catch {}
  }
  return { label, cssClass };
}

function pickSubjectImage(story) {
  // Priority chain: prefer raw cached source media over derived
  // outputs. story.image_path can point at a pre-generated v1
  // thumbnail (which would create a recursive thumb-inside-thumb)
  // so it goes LAST in the chain after raw frames + article hero.
  const candidates = [
    // Best: raw article hero (publisher's own choice of imagery)
    path.join(IMAGE_CACHE, `${story.id}_article.jpg`),
    // Smart-cropped trailer frames (mid-action, framed for portrait but
    // still readable in landscape after the centre crop)
    path.join(IMAGE_CACHE, `${story.id}_trailerframe_2_smartcrop_v2.jpg`),
    path.join(IMAGE_CACHE, `${story.id}_trailerframe_3_smartcrop_v2.jpg`),
    path.join(IMAGE_CACHE, `${story.id}_trailerframe_1_smartcrop_v2.jpg`),
    // Raw trailer frames if smart-crop variants are missing
    path.join(IMAGE_CACHE, `${story.id}_trailerframe_2.jpg`),
    path.join(IMAGE_CACHE, `${story.id}_trailerframe_1.jpg`),
    // Last resort: the legacy v1 image. May be a generated thumbnail
    // (recursive risk) but better than no subject art at all.
    story?.image_path,
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Pick a punchy 2-line headline from the story title.
 * Strategy: split title at the first dash/colon/pipe, take the first
 * meaningful chunk. Hard-cap each line to ~14 chars.
 */
function pickHeadline(story) {
  const t = String(story?.title || "").trim();
  // Strip trailing dash-fragments first
  const head = t.split(/\s+[-–—:|]\s+/)[0];
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length <= 3) {
    // Single-line punchy
    return { line1: head.toUpperCase(), line2: "" };
  }
  // Split at the midpoint of the word list, biased toward shorter line 1
  let split = Math.ceil(words.length / 2);
  // If line1 ends up too long, walk it back
  while (split > 1 && words.slice(0, split).join(" ").length > 18) split--;
  const line1 = words.slice(0, split).join(" ").toUpperCase();
  const line2 = words.slice(split).join(" ").toUpperCase();
  return { line1, line2 };
}

/**
 * Pick a sub-line. Use a flair-aware verb + the publisher when known.
 */
function pickSubLine(story) {
  const f = String(story?.flair || story?.classification || "").toLowerCase();
  const subreddit = story?.subreddit
    ? `r/${story.subreddit}`.toUpperCase()
    : "";
  const source =
    subreddit || (story?.source_type || "GAMING NEWS").toUpperCase();
  if (/leak/.test(f)) return `LEAKED · ${source}`;
  if (/rumour|rumor/.test(f)) return `REPORTEDLY · ${source}`;
  if (/confirmed|verified/.test(f)) return `CONFIRMED · ${source}`;
  return source;
}

/**
 * Auto-scale headline font size by total character count so long
 * titles don't overflow the right column.
 */
function pickHeadlineFontSize(line1, line2) {
  const longest = Math.max(line1.length, line2.length);
  if (longest <= 9) return 96;
  if (longest <= 12) return 84;
  if (longest <= 16) return 70;
  if (longest <= 20) return 58;
  return 48;
}

async function buildStoryThumbnail({
  story,
  channelId = "pulse-gaming",
  outPath,
}) {
  const storyId = story?.id;
  if (!storyId) throw new Error("buildStoryThumbnail: story.id required");

  const isDefault = channelId === "pulse-gaming";
  const projectDir = path.join(
    ROOT,
    "experiments",
    `hf-thumbnail-${storyId}${isDefault ? "" : `__${channelId}`}`,
  );
  await fs.ensureDir(projectDir);
  await fs.ensureDir(path.join(projectDir, "assets"));

  // Copy hyperframes config
  await fs.copy(
    path.join(TEMPLATE_DIR, "hyperframes.json"),
    path.join(projectDir, "hyperframes.json"),
  );

  // Subject image: prefer story-specific, fall back to template backdrop
  const subjectImg = pickSubjectImage(story);
  const backdropDest = path.join(projectDir, "assets", "backdrop.jpg");
  if (subjectImg) {
    await fs.copy(subjectImg, backdropDest);
  } else {
    await fs.copy(
      path.join(TEMPLATE_DIR, "assets", "backdrop.jpg"),
      backdropDest,
    );
  }

  // Meta
  await fs.writeJson(
    path.join(projectDir, "meta.json"),
    {
      id: path.basename(projectDir),
      name: path.basename(projectDir),
      createdAt: new Date().toISOString(),
    },
    { spaces: 2 },
  );

  // Render content into the template
  const tpl = await fs.readFile(path.join(TEMPLATE_DIR, "index.html"), "utf8");

  // Channel-aware classification colour
  let classificationColour = null;
  try {
    const channels = require(path.join(ROOT, "channels"));
    const ch = channels.getChannel(channelId);
    classificationColour = ch.classificationColour?.bind(ch);
  } catch {}

  const { label: flairLabel, cssClass: flairClass } = pickFlairBadge(
    story?.flair || story?.classification,
    classificationColour,
  );
  const { line1, line2 } = pickHeadline(story);
  const subLine = pickSubLine(story);
  const headlineFontSize = pickHeadlineFontSize(line1, line2);

  let html = tpl;

  // Headline font-size
  html = html.replace(
    /(\.headline\s*\{[^}]*?font-size:\s*)\d+(px;)/,
    `$1${headlineFontSize}$2`,
  );

  // Flair badge text + class
  html = html.replace(
    /(<div id="flair-badge" class="flair-badge)([^"]*)("[^>]*>)\s*[^<]+(<\/div>)/,
    `$1${flairClass ? " " + flairClass : ""}$3${escapeHtml(flairLabel)}$4`,
  );

  // Headline content
  const headlineHtml = line2
    ? `${escapeHtml(line1)}<br>${escapeHtml(line2)}`
    : escapeHtml(line1);
  html = html.replace(
    /(<div id="headline" class="headline">)[\s\S]*?(<\/div>)/,
    `$1\n              ${headlineHtml}\n            $2`,
  );

  // Sub-line
  html = html.replace(
    /(<div id="sub-line" class="sub-line">)[\s\S]*?(<\/div>)/,
    `$1\n              ${escapeHtml(subLine)}\n            $2`,
  );

  // Channel theme injection (replaces brand colour throughout)
  html = applyThemeToHtml(html, getChannelTheme(channelId));

  await fs.writeFile(path.join(projectDir, "index.html"), html);

  // Lint
  console.log(`  [thumb] linting ${path.basename(projectDir)}...`);
  execSync("npx hyperframes lint", { cwd: projectDir, stdio: "inherit" });

  // Render
  const mp4Out =
    outPath ||
    path.join(
      TEST_OUT,
      `thumb_${storyId}${isDefault ? "" : `__${channelId}`}.mp4`,
    );
  console.log(
    `  [thumb] rendering ${path.basename(projectDir)} -> ${path.relative(ROOT, mp4Out)}`,
  );
  execSync(
    `npx hyperframes render . -o "${mp4Out.replace(/\\/g, "/")}" -f 30 -q standard`,
    { cwd: projectDir, stdio: "inherit" },
  );

  // Extract first frame as JPEG (the actual thumbnail file YT wants)
  const jpgOut = mp4Out.replace(/\.mp4$/i, ".jpg");
  execSync(
    `ffmpeg -y -hide_banner -loglevel error -i "${mp4Out.replace(/\\/g, "/")}" -frames:v 1 -q:v 2 "${jpgOut.replace(/\\/g, "/")}"`,
    { cwd: ROOT, stdio: "inherit" },
  );

  return {
    mp4Path: mp4Out,
    jpgPath: jpgOut,
    projectDir,
    flair: flairLabel,
    line1,
    line2,
    headlineFontSize,
    subjectImagePath: subjectImg || null,
    channelId,
  };
}

module.exports = {
  buildStoryThumbnail,
  pickFlairBadge,
  pickSubjectImage,
  pickHeadline,
  pickSubLine,
  pickHeadlineFontSize,
};
