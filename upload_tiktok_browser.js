/*
  TikTok Upload via Playwright Browser Automation

  Bypasses the Content Posting API (which requires app review approval)
  by automating the TikTok web creator studio upload flow.

  Setup:
  1. Run: node upload_tiktok_browser.js login
     → Opens browser, you log in manually, cookies are saved
  2. Uploads run automatically via: node upload_tiktok_browser.js
     → Uses saved cookies, no manual intervention needed

  The publisher.js module will try the official API first,
  then fall back to this browser method if the API isn't authorised.
*/

const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const db = require("./lib/db");

dotenv.config({ override: true });

const COOKIES_PATH = path.join(__dirname, "tokens", "tiktok_cookies.json");
const UPLOAD_TIMEOUT = 120000; // 2 min max per upload

// --- Save browser session (run once manually) ---
async function loginAndSaveCookies() {
  const { chromium } = require("playwright");

  console.log("[tiktok-browser] Opening TikTok login page...");
  console.log(
    "[tiktok-browser] Log in manually, then press Enter in this terminal.",
  );

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();
  await page.goto("https://www.tiktok.com/login", { waitUntil: "networkidle" });

  // Wait for user to log in
  console.log("\n=== LOG IN TO TIKTOK IN THE BROWSER WINDOW ===");
  console.log("Once logged in, press Enter here to save cookies...\n");

  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
  });

  // Save cookies
  const cookies = await context.cookies();
  await fs.ensureDir(path.dirname(COOKIES_PATH));
  await fs.writeJson(COOKIES_PATH, cookies, { spaces: 2 });
  console.log(
    `[tiktok-browser] Saved ${cookies.length} cookies to ${COOKIES_PATH}`,
  );

  await browser.close();
  console.log(
    "[tiktok-browser] Done! Automated uploads will now use these cookies.",
  );
}

// --- Upload a single video via browser automation ---
async function uploadVideo(story) {
  addBreadcrumb(`TikTok browser upload: ${story.title}`, "upload");

  if (!(await fs.pathExists(COOKIES_PATH))) {
    throw new Error(
      "TikTok cookies not found. Run: node upload_tiktok_browser.js login",
    );
  }

  if (!story.exported_path || !(await fs.pathExists(story.exported_path))) {
    throw new Error(`Video file not found: ${story.exported_path}`);
  }

  const { chromium } = require("playwright");
  const cookies = await fs.readJson(COOKIES_PATH);

  // Build caption
  const { getChannel } = require("./channels");
  const channel = getChannel();
  let caption =
    story.suggested_title || story.suggested_thumbnail_text || story.title;
  if (caption.length > 100) caption = caption.substring(0, 97) + "...";
  const tags = (channel.hashtags || []).join(" ") + " #viral #fyp";
  caption += " " + tags;

  console.log(`[tiktok-browser] Uploading: "${caption.substring(0, 60)}..."`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
    });

    // Restore cookies
    await context.addCookies(cookies);

    const page = await context.newPage();

    // Navigate to TikTok creator upload page
    await page.goto(
      "https://www.tiktok.com/creator#/upload?scene=creator_center",
      {
        waitUntil: "networkidle",
        timeout: 30000,
      },
    );

    // Check if we're logged in (redirect to login means cookies expired)
    if (page.url().includes("/login")) {
      throw new Error(
        "TikTok cookies expired. Run: node upload_tiktok_browser.js login",
      );
    }

    // Wait for the upload page to load
    await page.waitForTimeout(3000);

    // Find the file input and upload the video
    // TikTok's upload page has a hidden file input
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.resolve(story.exported_path));

    console.log(
      "[tiktok-browser] Video file attached, waiting for processing...",
    );

    // Wait for video to finish processing (the upload progress)
    // TikTok shows a progress bar, then enables the post button
    await page.waitForTimeout(5000);

    // Wait for the video to be processed (look for the editor/preview to appear)
    try {
      await page.waitForSelector(
        '[class*="editor"], [class*="preview"], [data-e2e="upload-preview"]',
        {
          timeout: 60000,
        },
      );
    } catch (e) {
      console.log(
        "[tiktok-browser] Preview didn't appear, continuing anyway...",
      );
    }

    // Clear any existing caption and type our own
    // TikTok uses a contenteditable div for the caption
    const captionEditor = page
      .locator(
        '[contenteditable="true"], [data-e2e="caption-editor"], [class*="caption"] [contenteditable]',
      )
      .first();
    try {
      await captionEditor.waitFor({ timeout: 15000 });
      await captionEditor.click();
      // Select all and replace
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(500);
      // Type caption in chunks to avoid TikTok's anti-bot detection
      for (const char of caption) {
        await page.keyboard.type(char, { delay: 20 + Math.random() * 30 });
      }
      console.log("[tiktok-browser] Caption entered");
    } catch (e) {
      console.log(
        "[tiktok-browser] Could not find caption editor, posting without caption edit",
      );
    }

    // Wait for the Post button to become enabled
    // TikTok's post button is disabled while video is still processing
    await page.waitForTimeout(5000);

    // Try multiple selectors for the Post button
    const postSelectors = [
      'button[data-e2e="post-button"]',
      'button:has-text("Post")',
      'button:has-text("Publish")',
      '[class*="post-button"]',
      'button[class*="submit"]',
    ];

    let posted = false;
    for (const sel of postSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          // Wait for button to be enabled (not disabled)
          await page.waitForTimeout(2000);
          const isDisabled = await btn.isDisabled();
          if (isDisabled) {
            console.log(
              "[tiktok-browser] Post button still disabled, waiting for video processing...",
            );
            // Wait up to 60 more seconds for processing
            for (let i = 0; i < 12; i++) {
              await page.waitForTimeout(5000);
              if (!(await btn.isDisabled())) break;
            }
          }
          await btn.click();
          posted = true;
          console.log("[tiktok-browser] Post button clicked");
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!posted) {
      // Take a screenshot for debugging
      const ssPath = path.join("output", `tiktok_debug_${story.id}.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      throw new Error(
        `Could not find Post button. Debug screenshot: ${ssPath}`,
      );
    }

    // Wait for upload to complete (success page or redirect)
    await page.waitForTimeout(10000);

    // Check for success indicators
    const pageContent = await page.content();
    const success =
      pageContent.includes("uploaded") ||
      pageContent.includes("Your video is being") ||
      pageContent.includes("Processing") ||
      page.url().includes("manage") ||
      page.url().includes("creator");

    // Save updated cookies (session may have been refreshed)
    const freshCookies = await context.cookies();
    await fs.writeJson(COOKIES_PATH, freshCookies, { spaces: 2 });

    console.log(
      `[tiktok-browser] Upload ${success ? "succeeded" : "status unknown"} for ${story.id}`,
    );

    return {
      platform: "tiktok",
      publishId: `browser_${Date.now()}`,
      status: success ? "SUCCESS" : "SUBMITTED",
    };
  } finally {
    await browser.close();
  }
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[tiktok-browser] No stories found");
    return [];
  }

  const ready = stories.filter(
    (s) => s.approved && s.exported_path && !s.tiktok_post_id,
  );

  console.log(`[tiktok-browser] ${ready.length} videos ready for upload`);

  const results = [];

  for (const story of ready) {
    try {
      const result = await uploadVideo(story);
      story.tiktok_post_id = result.publishId;
      story.tiktok_status = result.status;
      results.push(result);

      // Rate limit between uploads to avoid detection
      await new Promise((r) => setTimeout(r, 10000));
    } catch (err) {
      captureException(err, { platform: "tiktok", storyId: story.id });
      console.log(
        `[tiktok-browser] Upload failed for ${story.id}: ${err.message}`,
      );
      story.tiktok_error = err.message;
    }
  }

  await db.saveStories(stories);
  console.log(`[tiktok-browser] ${results.length} videos uploaded`);
  return results;
}

// Alias for publisher.js compatibility
async function uploadShort(story) {
  return uploadVideo(story);
}

module.exports = { uploadVideo, uploadShort, uploadAll, loginAndSaveCookies };

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === "login") {
    loginAndSaveCookies().catch((err) => {
      console.log(`[tiktok-browser] ERROR: ${err.message}`);
      process.exit(1);
    });
  } else {
    uploadAll().catch((err) => {
      console.log(`[tiktok-browser] ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}
