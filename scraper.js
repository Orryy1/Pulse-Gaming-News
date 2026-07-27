"use strict";

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const sharp = require("sharp");
const dotenv = require("dotenv");
const { classifyOutboundUrl, safeRedirectConfig } = require("./lib/safe-url");

dotenv.config();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function downloadImage(url, outputPath) {
  const safe = classifyOutboundUrl(url);
  if (!safe.ok) return null;

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": USER_AGENT },
    ...safeRedirectConfig(3),
  });

  await sharp(Buffer.from(response.data))
    .resize(1080, 1920, { fit: "cover", position: "centre" })
    .jpeg({ quality: 90 })
    .toFile(outputPath);

  return outputPath;
}

async function scrapeOgImage(articleUrl) {
  try {
    const safe = classifyOutboundUrl(articleUrl);
    if (!safe.ok) return null;

    const response = await axios.get(articleUrl, {
      timeout: 10000,
      headers: { "User-Agent": USER_AGENT },
      ...safeRedirectConfig(3),
      maxContentLength: 50000,
    });

    const html = typeof response.data === "string" ? response.data : "";
    const match =
      html.match(
        /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      ) ||
      html.match(
        /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
      );

    if (!match?.[1]) return null;
    return match[1].startsWith("//") ? `https:${match[1]}` : match[1];
  } catch {
    return null;
  }
}

async function collectImage({
  url,
  outputDir,
  collected,
  seenUrls,
  label,
}) {
  if (!url || seenUrls.has(url) || collected.length >= 5) return;
  seenUrls.add(url);

  try {
    const outputPath = path.join(outputDir, `bg_${collected.length}.jpg`);
    const saved = await downloadImage(url, outputPath);
    if (!saved) return;
    collected.push(saved);
    console.log(`[scraper] ${label} saved: ${saved}`);
  } catch {
    // A single inaccessible image must not abort the story.
  }
}

async function scrapeImagesForStory(story = {}) {
  const outputDir = path.join("output", "images", String(story.id || "unknown"));
  await fs.ensureDir(outputDir);

  const collected = [];
  const seenUrls = new Set();

  for (const url of story.reddit_images || []) {
    await collectImage({
      url,
      outputDir,
      collected,
      seenUrls,
      label: "Reddit image",
    });
  }

  if (collected.length < 4 && story.linked_url) {
    await collectImage({
      url: await scrapeOgImage(story.linked_url),
      outputDir,
      collected,
      seenUrls,
      label: "og:image",
    });
  }

  if (
    collected.length < 4 &&
    story.url &&
    story.url !== story.linked_url
  ) {
    await collectImage({
      url: await scrapeOgImage(story.url),
      outputDir,
      collected,
      seenUrls,
      label: "Article og:image",
    });
  }

  console.log(
    `[scraper] ${story.id || "unknown"}: collected ${collected.length} background images`,
  );
  return collected;
}

async function scrapeAllImages() {
  if (!(await fs.pathExists("daily_news.json"))) {
    console.log("[scraper] ERROR: daily_news.json not found.");
    return;
  }

  const stories = await fs.readJson("daily_news.json");
  const toProcess = stories.filter(
    (story) => story.approved === true && !story.background_images?.length,
  );

  for (const story of toProcess) {
    story.background_images = await scrapeImagesForStory(story);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await fs.writeJson("daily_news.json", stories, { spaces: 2 });
}

module.exports = scrapeAllImages;
module.exports.scrapeImagesForStory = scrapeImagesForStory;
module.exports.downloadImage = downloadImage;
module.exports.scrapeOgImage = scrapeOgImage;

if (require.main === module) {
  scrapeAllImages().catch((error) => {
    console.log(`[scraper] ERROR: ${error.message}`);
    process.exitCode = 1;
  });
}
