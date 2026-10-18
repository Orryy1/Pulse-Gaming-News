// TikTok posting through the owner's own Chrome, on a dedicated profile the
// owner signs in to once (tiktok-login). Used because TikTok only lets audited
// apps post publicly through its API. Deliberately plain: the real installed
// Chrome, normal pacing, one upload at a time, no disguising of the browser.
// If TikTok shows any verification challenge the upload stops untouched and
// TikTok posting pauses, with a screenshot for the owner: challenges are never
// solved or bypassed.

import fs from "node:fs";
import path from "node:path";

const UPLOAD_URL = "https://www.tiktok.com/tiktokstudio/upload?from=webapp";
const CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
].find((p) => p && fs.existsSync(p));

export class TikTokChallenge extends Error {
  constructor(
    message: string,
    public screenshot?: string,
  ) {
    super(message);
  }
}
export class TikTokSignedOut extends Error {}

export function profileDir(dataDir: string): string {
  return path.join(dataDir, "tiktok-browser");
}

/**
 * The signed-in session, saved as a file on this PC: Chrome does not carry
 * its own saved cookies over to an automated launch, so the factory keeps
 * the session itself (never committed; data/ is ignored).
 */
const stateFile = (dataDir: string) => path.join(dataDir, "tiktok-session.json");

/** True once the owner has signed in and the session was saved. */
export function signedIn(dataDir: string): boolean {
  return fs.existsSync(stateFile(dataDir));
}

export function markSignedOut(dataDir: string): void {
  fs.rmSync(stateFile(dataDir), { force: true });
}

async function saveSession(ctx: import("playwright-core").BrowserContext, dataDir: string): Promise<void> {
  const cookies = (await ctx.cookies()).filter((c) => /tiktok/.test(c.domain));
  fs.writeFileSync(stateFile(dataDir), JSON.stringify({ savedAt: new Date().toISOString(), cookies }, null, 1));
}

async function loadSession(ctx: import("playwright-core").BrowserContext, dataDir: string): Promise<void> {
  if (!fs.existsSync(stateFile(dataDir))) return;
  const { cookies } = JSON.parse(fs.readFileSync(stateFile(dataDir), "utf8")) as { cookies: Parameters<typeof ctx.addCookies>[0] };
  if (cookies?.length) await ctx.addCookies(cookies);
}

async function open(dataDir: string, visible: boolean) {
  if (!CHROME)
    throw new Error(
      "Google Chrome is not installed where expected (set CHROME_PATH)",
    );
  const { chromium } = await import("playwright-core");
  return chromium.launchPersistentContext(profileDir(dataDir), {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1366, height: 860 },
    args: visible ? [] : ["--start-minimized"],
    acceptDownloads: false,
  });
}

/** Opens the dedicated profile on TikTok's sign-in page and waits (up to ten minutes) for the owner to sign in. */
export async function tiktokLogin(dataDir: string): Promise<boolean> {
  const ctx = await open(dataDir, true);
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto("https://www.tiktok.com/login", {
      waitUntil: "domcontentloaded",
    });
    for (let i = 0; i < 120; i++) {
      const cookies = await ctx.cookies("https://www.tiktok.com");
      if (cookies.some((c) => c.name === "sessionid" && c.value)) {
        await page.waitForTimeout(4000); // let the remaining session cookies land
        await saveSession(ctx, dataDir);
        return true;
      }
      await page.waitForTimeout(5000);
    }
    return false;
  } finally {
    await ctx.close();
  }
}

const CHALLENGE = [
  "#captcha-verify-container",
  "#captcha_container",
  'iframe[src*="captcha"]',
  'div[class*="captcha"]',
  "text=/verify to continue/i",
  "text=/drag the slider/i",
  "text=/suspicious activity/i",
];

/** Posts one video with its caption. Returns an id for the ledger, or throws (TikTokChallenge, TikTokSignedOut, Error). */
export async function postTikTokBrowser(opts: {
  dataDir: string;
  file: string;
  caption: string;
  shotsDir: string;
}): Promise<string> {
  const ctx = await open(opts.dataDir, false);
  const shot = async (page: import("playwright-core").Page, name: string) => {
    const p = path.join(opts.shotsDir, `tiktok_${name}_${Date.now()}.png`);
    await fs.promises.mkdir(opts.shotsDir, { recursive: true });
    await page.screenshot({ path: p }).catch(() => undefined);
    return p;
  };
  try {
    await loadSession(ctx, opts.dataDir);
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    const challenged = async () => {
      for (const sel of CHALLENGE)
        if (
          await page
            .locator(sel)
            .first()
            .isVisible({ timeout: 300 })
            .catch(() => false)
        )
          return true;
      return false;
    };
    await page.goto(UPLOAD_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(4000);
    if (/\/login/.test(page.url()))
      throw new TikTokSignedOut("TikTok profile is signed out");
    if (await challenged())
      throw new TikTokChallenge(
        "TikTok asked for verification before the upload",
        await shot(page, "challenge"),
      );

    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles(path.resolve(opts.file));
    // The caption editor and an enabled Post button mean the upload is in and processed.
    const editor = page.locator('div[contenteditable="true"]').first();
    await editor.waitFor({ timeout: 120_000 });
    const post = page
      .locator('button[data-e2e="post_video_button"], button:has-text("Post")')
      .last();
    for (let i = 0; i < 60; i++) {
      if (await challenged())
        throw new TikTokChallenge(
          "TikTok asked for verification during the upload",
          await shot(page, "challenge"),
        );
      if (
        (await post.isVisible().catch(() => false)) &&
        !(await post.isDisabled().catch(() => true))
      )
        break;
      await page.waitForTimeout(5000);
    }

    // The caption replaces the file name TikTok pre-fills.
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(opts.caption.slice(0, 2000));
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape").catch(() => undefined); // closes a hashtag suggestion list if one opened

    // Label the video as AI-generated where TikTok offers the switch (under "Show more").
    const more = page.locator("text=/^show more$/i").first();
    if (await more.isVisible({ timeout: 2000 }).catch(() => false))
      await more.click().catch(() => undefined);
    const aigc = page
      .locator(
        '[data-e2e="aigc_container"] input[type="checkbox"], div:has-text("AI-generated content") >> input[type="checkbox"]',
      )
      .first();
    if (await aigc.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (!(await aigc.isChecked().catch(() => true)))
        await aigc.check({ force: true }).catch(() => undefined);
      const turnOn = page.locator('button:has-text("Turn on")').first();
      if (await turnOn.isVisible({ timeout: 1500 }).catch(() => false))
        await turnOn.click().catch(() => undefined);
    }

    if (await post.isDisabled().catch(() => true))
      throw new Error(
        `TikTok's Post button stayed disabled (screenshot ${await shot(page, "disabled")})`,
      );
    await post.click();
    // Some accounts get a "post now?" confirmation for content checks still running.
    const now = page.locator('button:has-text("Post now")').first();
    if (await now.isVisible({ timeout: 4000 }).catch(() => false))
      await now.click();

    for (let i = 0; i < 24; i++) {
      await page.waitForTimeout(5000);
      if (await challenged())
        throw new TikTokChallenge(
          "TikTok asked for verification after Post",
          await shot(page, "challenge"),
        );
      const url = page.url();
      const done =
        /tiktokstudio\/content|\/manage/.test(url) ||
        (await page
          .locator(
            "text=/your video (has been|is being) (uploaded|published|posted)|video published|uploaded successfully/i",
          )
          .first()
          .isVisible({ timeout: 500 })
          .catch(() => false));
      if (done) {
        await saveSession(ctx, opts.dataDir).catch(() => undefined); // keep the refreshed session
        return `browser:${Date.now()}`;
      }
    }
    throw new Error(
      `TikTok did not confirm the post (screenshot ${await shot(page, "unconfirmed")})`,
    );
  } finally {
    await ctx.close().catch(() => undefined);
  }
}
