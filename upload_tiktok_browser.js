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

// Persistent browser profile path - keeps login state between runs
const BROWSER_PROFILE = path.join(
  __dirname,
  "tokens",
  "tiktok_browser_profile",
);

// Anti-detection args to avoid TikTok bot detection
const STEALTH_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-infobars",
  "--window-size=1280,800",
  "--start-maximized",
];

// Chrome user data directory (where the user is already logged into TikTok)
const CHROME_USER_DATA =
  process.env.CHROME_USER_DATA ||
  path.join(
    process.env.LOCALAPPDATA || "C:/Users/MORR/AppData/Local",
    "Google/Chrome/User Data",
  );

// --- Grab cookies from existing Chrome session (no login needed) ---
async function grabCookiesFromChrome() {
  const { chromium } = require("playwright");

  console.log(
    "[tiktok-browser] Grabbing TikTok session from your existing Chrome profile...",
  );
  console.log(
    "[tiktok-browser] IMPORTANT: Close Chrome completely before running this!\n",
  );

  // Copy essential Chrome profile files to a separate directory
  // (Chrome blocks remote debugging on its default data dir)
  const chromeDefault = path.join(CHROME_USER_DATA, "Default");
  const tempProfileDir = path.join(__dirname, "tokens", "chrome_tiktok_data");
  const tempDefault = path.join(tempProfileDir, "Default");

  console.log("[tiktok-browser] Copying Chrome session files...");
  await fs.ensureDir(tempDefault);
  for (const item of ["Network", "Local Storage", "Session Storage"]) {
    const src = path.join(chromeDefault, item);
    if (await fs.pathExists(src)) {
      await fs.copy(src, path.join(tempDefault, item), { overwrite: true });
    }
  }
  for (const [src, dest] of [
    [
      path.join(chromeDefault, "Preferences"),
      path.join(tempDefault, "Preferences"),
    ],
    [
      path.join(CHROME_USER_DATA, "Local State"),
      path.join(tempProfileDir, "Local State"),
    ],
  ]) {
    if (await fs.pathExists(src)) await fs.copy(src, dest, { overwrite: true });
  }
  console.log("[tiktok-browser] Profile files copied.");

  // Launch Playwright with the copied profile (avoids default-dir restriction)
  const context = await chromium.launchPersistentContext(tempProfileDir, {
    headless: false,
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: [...STEALTH_ARGS, "--profile-directory=Default"],
    viewport: { width: 1280, height: 800 },
    ignoreDefaultArgs: ["--enable-automation"],
  });

  const page = context.pages()[0] || (await context.newPage());

  // Navigate to TikTok to verify we're logged in
  await page.goto("https://www.tiktok.com/@pulsegmg", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const url = page.url();
  if (url.includes("/login")) {
    await context.close();
    throw new Error(
      "Not logged into TikTok in Chrome. Log in first, then retry.",
    );
  }

  console.log("[tiktok-browser] TikTok session found! Saving cookies...");

  // Navigate to creator page to pick up all upload-related cookies
  try {
    await page.goto("https://www.tiktok.com/creator#/upload", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(3000);
  } catch (e) {
    // Non-fatal
  }

  // Save cookies
  const cookies = await context.cookies();
  await fs.ensureDir(path.dirname(COOKIES_PATH));
  await fs.writeJson(COOKIES_PATH, cookies, { spaces: 2 });
  console.log(
    `[tiktok-browser] Saved ${cookies.length} cookies to ${COOKIES_PATH}`,
  );

  // Also copy the session into our persistent Playwright profile for future uploads
  await fs.ensureDir(BROWSER_PROFILE);
  await context.close();

  console.log(
    "[tiktok-browser] Done! You can reopen Chrome now. Automated uploads are ready.",
  );
}

// --- Save browser session (run once manually) ---
async function loginAndSaveCookies() {
  const { chromium } = require("playwright");

  console.log("[tiktok-browser] Opening TikTok login page...");
  console.log(
    "[tiktok-browser] Use QR CODE login (scan with TikTok app) - most reliable.",
  );
  console.log(
    "[tiktok-browser] Cookies will be saved automatically once login is detected.\n",
  );

  // Use persistent context so the browser profile is saved for future runs
  await fs.ensureDir(BROWSER_PROFILE);
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE, {
    headless: false,
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: STEALTH_ARGS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ignoreDefaultArgs: ["--enable-automation"],
  });

  // Remove the automation indicator from navigator
  const page = context.pages()[0] || (await context.newPage());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    window.chrome = { runtime: {} };
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-GB", "en"],
    });
  });

  await page.goto("https://www.tiktok.com/login", {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });

  // Auto-detect login: poll for indicators that the user is logged in
  console.log(
    "[tiktok-browser] Waiting for login (checking every 3s for up to 10 minutes)...",
  );
  console.log(
    "[tiktok-browser] TIP: Click 'Use QR code' then scan with TikTok app on your phone.\n",
  );
  let loggedIn = false;
  for (let attempt = 0; attempt < 200; attempt++) {
    await page.waitForTimeout(3000);
    try {
      const url = page.url();
      const notOnLogin = !url.includes("/login");
      // After login TikTok redirects to the For You page
      if (
        notOnLogin &&
        (url.includes("tiktok.com/foryou") ||
          url === "https://www.tiktok.com/" ||
          url.includes("tiktok.com/@"))
      ) {
        loggedIn = true;
        console.log(
          "[tiktok-browser] Login detected! (redirect from login page)",
        );
        break;
      }
      // Also check for sidebar elements
      const hasUpload = await page
        .locator('a[href*="/upload"], [data-e2e="upload-icon"]')
        .first()
        .isVisible({ timeout: 300 })
        .catch(() => false);
      if (hasUpload && notOnLogin) {
        loggedIn = true;
        console.log("[tiktok-browser] Login detected! (upload link visible)");
        break;
      }
      if (attempt % 10 === 0 && attempt > 0) {
        console.log(
          `[tiktok-browser] Still waiting... (${attempt * 3}s elapsed)`,
        );
      }
    } catch (e) {
      // Page might be navigating
    }
  }

  if (!loggedIn) {
    console.log("[tiktok-browser] Timed out. Saving cookies anyway...");
  }

  // Navigate to creator page to ensure all creator-related cookies are set
  try {
    await page.goto("https://www.tiktok.com/creator#/upload", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });
    await page.waitForTimeout(3000);
  } catch (e) {
    // Non-fatal
  }

  // Save cookies from persistent context
  const cookies = await context.cookies();
  await fs.ensureDir(path.dirname(COOKIES_PATH));
  await fs.writeJson(COOKIES_PATH, cookies, { spaces: 2 });
  console.log(
    `[tiktok-browser] Saved ${cookies.length} cookies to ${COOKIES_PATH}`,
  );

  await context.close();
  console.log(
    "[tiktok-browser] Done! Browser profile saved for future automated uploads.",
  );
}

// --- Upload a single video via browser automation ---
async function uploadVideo(story) {
  addBreadcrumb(`TikTok browser upload: ${story.title}`, "upload");

  // Check for persistent browser profile OR cookie file
  const hasProfile = await fs.pathExists(BROWSER_PROFILE);
  const hasCookies = await fs.pathExists(COOKIES_PATH);
  if (!hasProfile && !hasCookies) {
    throw new Error(
      "TikTok not authenticated. Run: node upload_tiktok_browser.js login",
    );
  }

  if (!story.exported_path || !(await fs.pathExists(story.exported_path))) {
    throw new Error(`Video file not found: ${story.exported_path}`);
  }

  const { chromium } = require("playwright");

  // Build caption
  const { getChannel } = require("./channels");
  const channel = getChannel();
  let caption =
    story.suggested_title || story.suggested_thumbnail_text || story.title;
  if (caption.length > 100) caption = caption.substring(0, 97) + "...";
  const tags = (channel.hashtags || []).join(" ") + " #viral #fyp";
  caption += " " + tags;

  console.log(`[tiktok-browser] Uploading: "${caption.substring(0, 60)}..."`);

  // Use persistent context (same profile as login) for session continuity
  const context = await chromium.launchPersistentContext(BROWSER_PROFILE, {
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: STEALTH_ARGS,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    ignoreDefaultArgs: ["--enable-automation"],
  });

  try {
    const page = context.pages()[0] || (await context.newPage());

    // Anti-detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Also restore cookie file if it exists (belt and suspenders)
    if (hasCookies) {
      try {
        const cookies = await fs.readJson(COOKIES_PATH);
        await context.addCookies(cookies);
      } catch (e) {
        // Non-fatal - persistent profile may already have cookies
      }
    }

    // Navigate to TikTok creator upload page
    await page.goto(
      "https://www.tiktok.com/creator#/upload?scene=creator_center",
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    await page.waitForTimeout(3000);

    // Check if we're logged in
    if (page.url().includes("/login")) {
      throw new Error(
        "TikTok session expired. Run: node upload_tiktok_browser.js login",
      );
    }

    // Find the file input and upload the video
    const fileInput = await page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.resolve(story.exported_path));

    console.log(
      "[tiktok-browser] Video file attached, waiting for processing...",
    );

    // Wait for video to be processed
    await page.waitForTimeout(5000);
    try {
      await page.waitForSelector(
        '[class*="editor"], [class*="preview"], [data-e2e="upload-preview"]',
        { timeout: 60000 },
      );
    } catch (e) {
      console.log("[tiktok-browser] Preview didn't appear, continuing...");
    }

    // Enter caption
    const captionEditor = page
      .locator('[contenteditable="true"], [data-e2e="caption-editor"]')
      .first();
    try {
      await captionEditor.waitFor({ timeout: 15000 });
      await captionEditor.click();
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Backspace");
      await page.waitForTimeout(500);
      // Type with human-like delays
      for (const char of caption) {
        await page.keyboard.type(char, { delay: 15 + Math.random() * 25 });
      }
      console.log("[tiktok-browser] Caption entered");
    } catch (e) {
      console.log("[tiktok-browser] Caption editor not found, using default");
    }

    // Click Post button
    await page.waitForTimeout(5000);
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
          // Wait for processing to finish (button enabled)
          for (let i = 0; i < 12; i++) {
            if (!(await btn.isDisabled())) break;
            console.log("[tiktok-browser] Waiting for processing...");
            await page.waitForTimeout(5000);
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
      const ssPath = path.join("output", `tiktok_debug_${story.id}.png`);
      await page.screenshot({ path: ssPath, fullPage: true });
      throw new Error(
        `Could not find Post button. Debug screenshot: ${ssPath}`,
      );
    }

    await page.waitForTimeout(10000);

    // Check success
    const pageContent = await page.content();
    const success =
      pageContent.includes("uploaded") ||
      pageContent.includes("Your video is being") ||
      pageContent.includes("Processing") ||
      page.url().includes("manage") ||
      page.url().includes("creator");

    // Update saved cookies
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
    await context.close();
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

module.exports = {
  uploadVideo,
  uploadShort,
  uploadAll,
  loginAndSaveCookies,
  grabCookiesFromChrome,
};

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === "grab") {
    grabCookiesFromChrome().catch((err) => {
      console.log(`[tiktok-browser] ERROR: ${err.message}`);
      process.exit(1);
    });
  } else if (cmd === "login") {
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
