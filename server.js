require("./lib/sentry").initSentry();
const { sentryExpressMiddleware, setupErrorHandler } = require("./lib/sentry");

const express = require("express");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const { spawn } = require("child_process");
const cron = require("node-cron");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, "daily_news.json");

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(",")
      : [
          "http://localhost:3001",
          "http://localhost:5173",
          process.env.RAILWAY_PUBLIC_URL,
        ].filter(Boolean),
    methods: ["GET", "POST"],
  }),
);
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

// --- API authentication middleware ---
// Fail closed in production. If API_TOKEN isn't set on a Railway/Render deploy,
// every "protected" mutation route (publish, approve, autonomous/run, etc.)
// would otherwise be wide open to the internet. Local dev keeps the no-op
// shortcut so nobody has to juggle a token when hacking on localhost.
const IS_PRODUCTION =
  process.env.NODE_ENV === "production" ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.RAILWAY_PUBLIC_URL;
if (IS_PRODUCTION && !process.env.API_TOKEN) {
  console.error(
    "[server] FATAL: API_TOKEN is required in production (NODE_ENV=production or RAILWAY_* set). Refusing to start.",
  );
  process.exit(1);
}

function requireAuth(req, res, next) {
  const secret = process.env.API_TOKEN;
  // Dev-only bypass: when API_TOKEN is unset AND we're not in production.
  // In production the startup guard above already exited, so this branch
  // never fires with a missing token.
  if (!secret) return next();

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// SSE variant: the browser EventSource API can't attach custom
// headers, so for the one SSE endpoint we gate (/api/progress) we
// also accept `?token=<API_TOKEN>` as a query param. Header is
// preferred — the query path is a deliberate carve-out. Do NOT
// reuse this for non-SSE routes; the Bearer header is the contract
// everywhere else.
function requireAuthHeaderOrQuery(req, res, next) {
  const secret = process.env.API_TOKEN;
  if (!secret) return next();
  const headerToken = (req.headers.authorization || "").replace(
    /^Bearer\s+/,
    "",
  );
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";
  if (headerToken === secret || queryToken === secret) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

// --- Rate limiting middleware ---
const rateLimitMap = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const entry = rateLimitMap.get(key) || {
      count: 0,
      resetAt: now + windowMs,
    };
    if (now > entry.resetAt) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count++;
    rateLimitMap.set(key, entry);
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: "Too many requests" });
    }
    next();
  };
}

// HTML escaping for safe inline rendering
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sentry request handler (must be before routes)
const sentryMw = sentryExpressMiddleware();
app.use(sentryMw.requestHandler);

// Request logger
app.use((req, res, next) => {
  console.log(`[server] ${req.method} ${req.path}`);
  next();
});

// --- TikTok URL verification file (must be before static middleware) ---
app.get("/tiktokDw54Pk1WSkoF9szIQ4gVvLPUr0EmoATB.txt", (req, res) => {
  res
    .type("text/plain")
    .send(
      "tiktok-developers-site-verification=Dw54Pk1WSkoF9szIQ4gVvLPUr0EmoATB",
    );
});

// Serve Vite build from dist/
app.use(express.static(path.join(__dirname, "dist")));
// NOTE: /generated (public/generated) static mount removed 2026-04-21
// after the Task 6 audit. The directory was empty in production and
// nothing in the codebase ever wrote to it or fetched from it. Kept
// off by default — if you need a public served dir for a future
// asset, prefer a dedicated mount with a documented consumer and a
// story-visibility gate where drafts are involved.
app.use("/branding", express.static(path.join(__dirname, "branding")));

// Ported from the retired cloud.js (Phase B entrypoint unification).
// discord_approve.js embeds `${base}/approve/${story.id}?token=...` in
// Discord approval messages so mobile click-throughs land on the
// approval dashboard. Preserve the redirect here so those links stay
// live after cloud.js deletion. The token is forwarded unchanged; the
// dashboard SPA reads it off the URL into sessionStorage.
app.get("/approve/:id", (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : null;
  const q = token
    ? `?highlight=${encodeURIComponent(req.params.id)}&token=${encodeURIComponent(token)}`
    : `?highlight=${encodeURIComponent(req.params.id)}`;
  res.redirect("/" + q);
});

// --- Remote workers API (Phase 4: outbound-only polling from local box) ---
// Mounted only when SQLite + the jobs queue are active. Safe no-op
// otherwise so legacy deployments don't need to know the endpoints exist.
if (process.env.USE_SQLITE === "true") {
  try {
    const jobsApi = require("./lib/api/jobs-router");
    app.use("/api", jobsApi.build());
    console.log(
      "[server] Remote workers API mounted under /api (jobs/*, workers/*)",
    );
  } catch (err) {
    console.error(`[server] Failed to mount jobs API: ${err.message}`);
  }
}

// --- Legal pages (required for TikTok/Instagram app review) ---
app.get("/terms", (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Terms of Service - Pulse Gaming</title></head><body style="max-width:800px;margin:40px auto;font-family:sans-serif;padding:0 20px">
<h1>Terms of Service</h1><p>Last updated: 2 April 2026</p>
<p>By using Pulse Gaming's services you agree to these terms.</p>
<h2>Use of Service</h2><p>Pulse Gaming provides automated gaming news content across YouTube, TikTok and Instagram. Content is generated from verified public sources and is intended for entertainment and informational purposes.</p>
<h2>Content</h2><p>All content is sourced from publicly available news outlets, Reddit and RSS feeds. We do not claim ownership of third-party trademarks or intellectual property referenced in our coverage.</p>
<h2>Disclaimer</h2><p>Content is provided as-is. We make reasonable efforts to verify information but cannot guarantee accuracy of all reporting. Rumour-tagged content is clearly labelled as unverified.</p>
<h2>Contact</h2><p>For enquiries, reach us via our YouTube channel.</p>
</body></html>`);
});

app.get("/privacy", (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Privacy Policy - Pulse Gaming</title></head><body style="max-width:800px;margin:40px auto;font-family:sans-serif;padding:0 20px">
<h1>Privacy Policy</h1><p>Last updated: 2 April 2026</p>
<p>Pulse Gaming respects your privacy.</p>
<h2>Data Collection</h2><p>We do not collect personal data from viewers. Our application accesses public APIs (Reddit, RSS feeds, YouTube, TikTok, Instagram) to publish gaming news content. No user data is stored or processed.</p>
<h2>Third-Party Services</h2><p>We use YouTube Data API, TikTok Content Posting API and Instagram Graph API solely for publishing our own content. We do not access or store any third-party user data through these APIs.</p>
<h2>Cookies</h2><p>Our dashboard may use essential cookies for session management. No tracking or advertising cookies are used.</p>
<h2>Contact</h2><p>For privacy enquiries, reach us via our YouTube channel.</p>
</body></html>`);
});

// --- TikTok OAuth callback ---
// --- TikTok OAuth initiator ---
// Gives the operator a one-click way to re-auth TikTok from the browser
// after a deploy wipes /app/tokens/. Must be paired with a persistent
// TIKTOK_TOKEN_PATH (e.g. /data/tokens/tiktok_token.json) otherwise the
// next redeploy will wipe the token written by the callback handler.
app.get("/auth/tiktok", (req, res) => {
  try {
    const { buildAuthorizeUrl } = require("./upload_tiktok");
    const { createState } = require("./lib/oauth-state");
    // CSRF protection: mint a fresh state, bind it to this provider,
    // and include it in the authorise URL. TikTok echoes it back on
    // the callback where consumeState() validates single-use.
    const state = createState("tiktok");
    const url = buildAuthorizeUrl({ state });
    // Deliberately log only the redirect_uri (public), not the client key
    // (also public but noisy), never the state, and never the full URL.
    const redirectUri =
      process.env.TIKTOK_REDIRECT_URI ||
      "https://marvelous-curiosity-production.up.railway.app/auth/tiktok/callback";
    console.log(`[tiktok] OAuth initiator: redirect=${redirectUri}`);
    res.redirect(url);
  } catch (err) {
    console.log(`[tiktok] OAuth initiator error: ${err.message}`);
    res
      .status(500)
      .send(
        `<h1>TikTok auth not configured</h1><p>${escapeHtml(err.message)}</p>`,
      );
  }
});

app.get("/auth/tiktok/callback", async (req, res) => {
  const { code, error, error_description, state } = req.query;

  if (error) {
    console.log(`[tiktok] OAuth error: ${error} - ${error_description}`);
    return res
      .status(400)
      .send(
        `<h1>TikTok Auth Error</h1><p>${escapeHtml(error)}: ${escapeHtml(error_description)}</p>`,
      );
  }

  // CSRF guard: reject the callback before we even look at `code` if
  // state is missing, expired, single-use-already-consumed, or bound
  // to a different provider. We deliberately surface only a coarse
  // reason — the operator can retry via /auth/tiktok; an attacker
  // gets no useful signal about why their forged callback failed.
  const { consumeState } = require("./lib/oauth-state");
  const stateCheck = consumeState(state, "tiktok");
  if (!stateCheck.ok) {
    console.log(`[tiktok] OAuth state rejected: ${stateCheck.reason}`);
    return res
      .status(400)
      .send(
        `<h1>TikTok Auth Failed</h1>` +
          `<p>State check failed (${escapeHtml(stateCheck.reason)}). Please restart from /auth/tiktok.</p>`,
      );
  }

  if (!code) {
    return res.status(400).send("<h1>Missing auth code</h1>");
  }

  try {
    const { exchangeCode } = require("./upload_tiktok");
    await exchangeCode(code);
    console.log("[tiktok] OAuth callback: token saved successfully");
    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h1 style="color:#00C853">TikTok Connected!</h1>
      <p>Access token saved. Pulse Gaming can now publish to TikTok.</p>
      <p>You can close this tab.</p>
    </body></html>`);
  } catch (err) {
    console.log(`[tiktok] OAuth token exchange failed: ${err.message}`);
    res
      .status(500)
      .send(`<h1>Token Exchange Failed</h1><p>${escapeHtml(err.message)}</p>`);
  }
});

// --- Facebook + Instagram OAuth flow ---
// Start: redirects to Facebook login with required permissions
app.get("/auth/facebook", (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) {
    return res.status(500).send("<h1>FACEBOOK_APP_ID not set in env</h1>");
  }
  const baseUrl = process.env.RAILWAY_PUBLIC_URL || `http://localhost:${PORT}`;
  const redirectUri = `${baseUrl}/auth/facebook/callback`;
  const scopes =
    "pages_manage_posts,pages_read_engagement,pages_show_list,instagram_basic,instagram_content_publish,publish_video";
  // CSRF protection: mint a state bound to the "facebook" provider
  // tag. Same single-use / TTL contract as the TikTok flow — see
  // lib/oauth-state.js. URL-encode defensively even though hex tokens
  // are URL-safe, to match the treatment of redirect_uri above.
  const { createState } = require("./lib/oauth-state");
  const state = createState("facebook");
  const authUrl =
    `https://www.facebook.com/v21.0/dialog/oauth?client_id=${appId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${scopes}` +
    `&response_type=code` +
    `&state=${encodeURIComponent(state)}`;
  res.redirect(authUrl);
});

// Callback: exchanges code for long-lived token, saves FB + IG tokens
app.get("/auth/facebook/callback", async (req, res) => {
  const { code, error, error_description, state } = req.query;

  if (error) {
    console.log(`[facebook] OAuth error: ${error} - ${error_description}`);
    return res
      .status(400)
      .send(
        `<h1>Facebook Auth Error</h1><p>${escapeHtml(error)}: ${escapeHtml(error_description || "")}</p>`,
      );
  }

  // CSRF guard (mirrors TikTok callback). Runs before we burn a code
  // exchange against Facebook Graph so a forged callback can't waste
  // an app request either.
  const { consumeState } = require("./lib/oauth-state");
  const stateCheck = consumeState(state, "facebook");
  if (!stateCheck.ok) {
    console.log(`[facebook] OAuth state rejected: ${stateCheck.reason}`);
    return res
      .status(400)
      .send(
        `<h1>Facebook Auth Failed</h1>` +
          `<p>State check failed (${escapeHtml(stateCheck.reason)}). Please restart from /auth/facebook.</p>`,
      );
  }

  if (!code) {
    return res.status(400).send("<h1>Missing auth code</h1>");
  }

  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  if (!appId || !appSecret) {
    return res
      .status(500)
      .send("<h1>FACEBOOK_APP_ID and FACEBOOK_APP_SECRET must be set</h1>");
  }

  try {
    const axios = require("axios");
    const baseUrl =
      process.env.RAILWAY_PUBLIC_URL || `http://localhost:${PORT}`;
    const redirectUri = `${baseUrl}/auth/facebook/callback`;

    // Step 1: Exchange code for short-lived user token
    const tokenRes = await axios.get(
      "https://graph.facebook.com/v21.0/oauth/access_token",
      {
        params: {
          client_id: appId,
          client_secret: appSecret,
          redirect_uri: redirectUri,
          code,
        },
      },
    );
    const shortToken = tokenRes.data.access_token;

    // Step 2: Exchange for long-lived user token
    const longRes = await axios.get(
      "https://graph.facebook.com/v21.0/oauth/access_token",
      {
        params: {
          grant_type: "fb_exchange_token",
          client_id: appId,
          client_secret: appSecret,
          fb_exchange_token: shortToken,
        },
      },
    );
    const longLivedToken = longRes.data.access_token;

    // Step 3: Get page token
    const targetPageId = process.env.FACEBOOK_PAGE_ID;
    let page = null;

    // Try /me/accounts first
    const pagesRes = await axios.get(
      "https://graph.facebook.com/v21.0/me/accounts",
      {
        params: { access_token: longLivedToken },
      },
    );
    const pages = pagesRes.data.data || [];

    if (targetPageId) {
      page = pages.find((p) => p.id === targetPageId);
      // If not found in list, query directly
      if (!page) {
        try {
          const directRes = await axios.get(
            `https://graph.facebook.com/v21.0/${targetPageId}`,
            {
              params: {
                fields: "id,name,access_token",
                access_token: longLivedToken,
              },
            },
          );
          page = directRes.data;
        } catch (err) {
          console.log(
            `[facebook] Direct page query failed: ${err.response?.data?.error?.message || err.message}`,
          );
        }
      }
    }

    if (!page && pages.length > 0) {
      page = pages[0];
    }

    if (!page || !page.access_token) {
      const pageList =
        pages.map((p) => `${p.name} (${p.id})`).join(", ") || "none found";
      return res
        .status(400)
        .send(
          `<h1>No Page Token</h1><p>Pages found: ${escapeHtml(pageList)}</p><p>Set FACEBOOK_PAGE_ID in env to your page ID.</p>`,
        );
    }

    const pageToken = page.access_token;
    console.log(
      `[facebook] OAuth: got page token for ${page.name} (${page.id})`,
    );

    // Save Facebook token
    const tokensDir = path.join(__dirname, "tokens");
    await fs.ensureDir(tokensDir);
    await fs.writeJson(
      path.join(tokensDir, "facebook_token.json"),
      {
        access_token: pageToken,
        page_id: page.id,
        page_name: page.name,
        expires_at: 0,
        created_at: new Date().toISOString(),
        note: "Page token from OAuth flow. Does not expire unless revoked.",
      },
      { spaces: 2 },
    );

    // Step 4: Get Instagram Business Account
    let igAccountId = null;
    try {
      const igRes = await axios.get(
        `https://graph.facebook.com/v21.0/${page.id}`,
        {
          params: {
            fields: "instagram_business_account",
            access_token: pageToken,
          },
        },
      );
      igAccountId = igRes.data?.instagram_business_account?.id;
      if (igAccountId) {
        await fs.writeJson(
          path.join(tokensDir, "instagram_token.json"),
          {
            access_token: pageToken,
            instagram_business_account_id: igAccountId,
            expires_at: 0,
            created_at: new Date().toISOString(),
          },
          { spaces: 2 },
        );
      }
    } catch (err) {
      console.log(`[facebook] IG account lookup failed: ${err.message}`);
    }

    // Log env-var updates to server stdout ONLY — never echo tokens back to
    // the browser. Any proxy, screen share, browser-history flush, or
    // shoulder-surf would otherwise capture a non-expiring Page token with
    // publish rights to both Facebook and Instagram. The token is already
    // persisted to tokens/*.json above; the operator can pull it from there
    // or from the server log when syncing Railway env.
    const envUpdates = [
      `FACEBOOK_PAGE_TOKEN=${pageToken}`,
      `FACEBOOK_PAGE_ID=${page.id}`,
    ];
    if (igAccountId) {
      envUpdates.push(
        `INSTAGRAM_ACCESS_TOKEN=${pageToken}`,
        `INSTAGRAM_BUSINESS_ACCOUNT_ID=${igAccountId}`,
      );
    }
    console.log(
      `[facebook] OAuth complete. Update Railway env (server-side log only):\n  ${envUpdates.join("\n  ")}`,
    );

    const sendDiscord = require("./notify");
    await sendDiscord(
      `**Facebook + Instagram Re-authenticated**\nPage: ${page.name}\nIG: ${igAccountId || "not linked"}\n\nNew tokens written to tokens/. Pull from server logs to sync Railway env.`,
    ).catch(() => {});

    res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding:60px">
      <h1 style="color:#00C853">Facebook + Instagram Connected</h1>
      <p>Page: <strong>${escapeHtml(page.name)}</strong></p>
      <p>Instagram: <strong>${escapeHtml(igAccountId || "Not linked")}</strong></p>
      <hr style="margin:30px 0">
      <p>Tokens saved server-side. Check the server log or Discord for the env-var sync instructions.</p>
      <p style="margin-top:20px">You can close this tab.</p>
    </body></html>`);
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.log(`[facebook] OAuth failed: ${detail}`);
    res
      .status(500)
      .send(`<h1>Facebook Auth Failed</h1><p>${escapeHtml(detail)}</p>`);
  }
});

// --- SSE for real-time progress ---
const sseClients = new Map();
const SSE_MAX_CLIENTS = 50;
const SSE_IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

function broadcastProgress(storyId, type, progress, stage) {
  const data = JSON.stringify({ storyId, type, progress, stage });
  for (const [clientId, client] of sseClients) {
    try {
      client.res.write(`data: ${data}\n\n`);
    } catch (err) {
      console.log(`[server] SSE write error for client ${clientId}, removing`);
      sseClients.delete(clientId);
    }
  }
}

// --- Database layer (feature-flagged via USE_SQLITE env var) ---
const db = require("./lib/db");

// --- Data helpers ---
//
// Phase 3A persistence cutover: readNews now prefers SQLite when the
// USE_SQLITE flag is on. Prior behaviour (always read from
// daily_news.json) was the root cause of the divergent-reads bug
// called out in docs/phase-a-inventory.md §3 — /api/approve mutations
// written through writeNews kept the SQLite side in sync (see below),
// but /api/news reads never looked at SQLite, so any story ingested
// directly via the hunter's db.saveStories path was invisible to the
// dashboard until the next writeNews() roll-up. With USE_SQLITE=true
// the dashboard now sees the authoritative state.
//
// USE_SQLITE unset (or false) preserves the exact legacy behaviour:
// read JSON file, return [] if missing.
function readNews() {
  try {
    return db.getStoriesSync();
  } catch (err) {
    // Never let a dashboard read fail hard — if SQLite throws for any
    // reason (db not open, migration half-applied), fall back to the
    // legacy file path. The original version silently returned [] on
    // JSON read errors; we preserve that forgiving contract.
    console.log(
      `[server] readNews: SQLite read failed (${err.message}); falling back to JSON`,
    );
    try {
      if (!fs.existsSync(DATA_FILE)) return [];
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
}

function writeNews(data) {
  // Phase 3C hardening. Decision logic lives in
  // lib/services/news-mirror so the branching has a unit-testable
  // surface. Under USE_SQLITE=true (production), skip the JSON mirror
  // entirely — it was the sole source of the recurring "Invalid
  // string length" RangeError (17 Apr 22:38, 18 Apr 04:47).
  const {
    decideMirrorStrategy,
    tryStringify,
  } = require("./lib/services/news-mirror");
  const { strategy } = decideMirrorStrategy(data, {
    useSqlite: db.useSqlite(),
  });
  const rowCount = Array.isArray(data) ? data.length : "n/a";

  if (strategy === "sqlite-only") {
    console.log(
      `[server] writeNews: SQLite canonical — skipping JSON mirror (rows=${rowCount})`,
    );
    try {
      db.saveStories(data);
    } catch (err) {
      console.log(`[server] writeNews: SQLite save error: ${err.message}`);
    }
    return;
  }

  // Dev / legacy JSON path. Best-effort stringify; never throw.
  const result = tryStringify(data);
  if (!result.ok) {
    console.log(
      `[server] writeNews: JSON serialisation failed (rows=${result.rowCount}, error=${result.reason}). ` +
        "Dev JSON mirror skipped for this write; stories are not persisted this cycle.",
    );
    return;
  }
  try {
    fs.writeFileSync(DATA_FILE, result.serialised, "utf-8");
  } catch (err) {
    console.log(
      `[server] writeNews: JSON writeFileSync failed (rows=${result.rowCount}, error=${err.message}).`,
    );
  }
}

function findStory(id) {
  const stories = readNews();
  const story = stories.find((s) => s.id === id);
  return { stories, story };
}

function updateStory(id, updates) {
  const stories = readNews();
  const idx = stories.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  Object.assign(stories[idx], updates);
  writeNews(stories);
  return stories[idx];
}

// --- API Routes ---

app.get("/api/health", (req, res) => {
  let circuitBreakers = {};
  try {
    const { getCircuitStatus } = require("./lib/retry");
    circuitBreakers = getCircuitStatus();
  } catch (e) {
    /* retry module not loaded yet */
  }

  // Build-time metadata. All read from Railway-injected env vars that
  // are public by design (commit SHA, deployment id, environment name,
  // project/service ids). No secrets are exposed — explicitly NOT
  // including API_TOKEN, ANTHROPIC_API_KEY, DB paths, or any other
  // credential-shaped var. The point of this block is post-deploy
  // verification: `curl https://<host>/api/health | jq .build` lets
  // an operator prove which commit is actually running without
  // trawling Discord deploy banners.
  const commitSha = process.env.RAILWAY_GIT_COMMIT_SHA || null;
  const build = {
    commit_sha: commitSha,
    commit_short: commitSha ? commitSha.slice(0, 7) : null,
    commit_message: process.env.RAILWAY_GIT_COMMIT_MESSAGE || null,
    branch: process.env.RAILWAY_GIT_BRANCH || null,
    deployment_id: process.env.RAILWAY_DEPLOYMENT_ID || null,
    environment:
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_ENVIRONMENT ||
      null,
    project_id: process.env.RAILWAY_PROJECT_ID || null,
    service_id: process.env.RAILWAY_SERVICE_ID || null,
    node_env: process.env.NODE_ENV || null,
  };

  // Runtime feature flags that drive dispatch/persistence behaviour.
  // Safely resolve dispatch mode without running the bootstrap path —
  // resolveDispatchMode is pure (reads env only).
  let dispatchMode = null;
  try {
    const { resolveDispatchMode } = require("./lib/dispatch-mode");
    const d = resolveDispatchMode();
    dispatchMode = { mode: d.mode, strict: d.strict, reason: d.reason };
  } catch {
    /* lib/dispatch-mode absent (pre-Phase-D code) — leave null */
  }
  // Resolved SQLite path + persistence-worry flag. After the
  // 2026-04-19 "DB wipe on deploy" incident we expose the live path
  // so the operator can verify post-deploy that it's on a persistent
  // volume, not ephemeral container FS. `persistent_hint` is a best-
  // guess based on whether the path falls outside /app/<repo>/ — it's
  // a heuristic, not a guarantee.
  let sqliteDbPath = null;
  try {
    sqliteDbPath = require("./lib/db").DB_PATH || null;
  } catch {
    /* lib/db absent in some contexts */
  }
  const sqliteDbPathLooksEphemeral =
    !!sqliteDbPath &&
    (sqliteDbPath.startsWith("/app/") ||
      sqliteDbPath.includes(path.join(__dirname, "data") + path.sep) ||
      sqliteDbPath === path.join(__dirname, "data", "pulse.db"));

  const runtime = {
    use_sqlite: process.env.USE_SQLITE === "true",
    use_job_queue_explicit: process.env.USE_JOB_QUEUE || null,
    auto_publish: process.env.AUTO_PUBLISH === "true",
    dispatch: dispatchMode,
    sqlite_db_path: sqliteDbPath,
    sqlite_db_path_looks_ephemeral: sqliteDbPathLooksEphemeral,
  };

  res.json({
    status: "ok",
    version: "v2.2.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    hunterActive: !!hunterInterval,
    autonomousMode: process.env.AUTO_PUBLISH === "true",
    schedulerActive: schedulerRunning,
    circuitBreakers,
    build,
    runtime,
  });
});

// Public, unauthenticated news feed. Returns ONLY:
//   - stories that have actually gone live (YouTube URL exists)
//   - a tiny whitelist of safe fields (title, source URL, timestamps,
//     og:image, published YT URL) via lib/public-story.js
//
// The full editorial payload — scripts, hooks, pinned comments,
// scoring internals, candidate image prompts, internal file paths,
// Reddit comment authors, platform post IDs, view counters — is
// served from /api/news/full which requires the Bearer API_TOKEN.
// Dashboard should call /api/news/full. If you're adding a new
// public widget that needs a field not in PUBLIC_FIELDS, add it
// there — do NOT bypass the sanitizer.
app.get("/api/news", (req, res) => {
  try {
    const stories = readNews();
    const { sanitizeStoriesForPublic } = require("./lib/public-story");
    res.json(sanitizeStoriesForPublic(stories));
  } catch (err) {
    console.log(`[server] ERROR reading news: ${err.message}`);
    res.json([]);
  }
});

// Authenticated full payload for the operator dashboard. Same shape
// the unauthenticated endpoint used to return before the 2026-04-20
// exposure audit. Gated on requireAuth so the raw editorial record
// (scripts, scoring, internal paths, PII) stays behind the same
// Bearer contract as the mutating routes.
app.get("/api/news/full", requireAuth, (req, res) => {
  try {
    const stories = readNews();
    // 2026-04-23 dashboard truthfulness: cache-bust so the
    // operator can't see a stale snapshot after a publish
    // window fires. Without these headers, browser / CDN /
    // service-worker caches were pinning /api/news/full for
    // minutes at a time — which is how "Elden Ring still in
    // review queue" looked stuck during today's audit.
    res.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, max-age=0",
    );
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.json(Array.isArray(stories) ? stories : []);
  } catch (err) {
    console.log(`[server] ERROR reading full news: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/progress", requireAuthHeaderOrQuery, (req, res) => {
  if (sseClients.size >= SSE_MAX_CLIENTS) {
    return res.status(503).json({ error: "Too many SSE connections" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write('data: {"type":"connected"}\n\n');

  const clientId =
    Date.now().toString(36) + Math.random().toString(36).slice(2);

  // Auto-close idle connections after 5 minutes
  const idleTimeout = setTimeout(() => {
    try {
      res.write('data: {"type":"timeout"}\n\n');
      res.end();
    } catch (e) {
      /* already closed */
    }
    sseClients.delete(clientId);
  }, SSE_IDLE_TIMEOUT_MS);

  sseClients.set(clientId, { res, idleTimeout });

  req.on("close", () => {
    clearTimeout(idleTimeout);
    sseClients.delete(clientId);
  });
});

app.post("/api/approve", requireAuth, rateLimit(30, 60000), (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: "id required" });

    const { story } = findStory(id);
    if (!story) return res.status(404).json({ error: "story not found" });

    updateStory(id, { approved: true });
    console.log(`[server] Approved: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.log(`[server] ERROR approving: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Publish pipeline ---
let publishState = { status: "idle", message: "" };

app.post("/api/publish", requireAuth, rateLimit(5, 60000), (req, res) => {
  if (publishState.status === "running") {
    return res.json({ status: "already running" });
  }

  publishState = { status: "running", message: "Starting publish pipeline..." };
  console.log("[server] Starting publish pipeline...");

  const child = spawn("node", ["run.js", "produce"], {
    cwd: __dirname,
    stdio: "inherit",
  });

  child.on("close", (code) => {
    publishState = {
      status: code === 0 ? "complete" : "error",
      message:
        code === 0
          ? "Pipeline finished successfully"
          : "Pipeline exited with errors",
    };
    console.log(`[server] Publish pipeline finished: ${publishState.status}`);
  });

  child.on("error", (err) => {
    publishState = { status: "error", message: err.message };
    console.log(`[server] Publish pipeline error: ${err.message}`);
  });

  res.json({ status: "running" });
});

app.get("/api/publish-status", requireAuth, (req, res) => {
  res.json(publishState);
});

// --- Full autonomous cycle endpoint ---
app.post(
  "/api/autonomous/run",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    res.json({ status: "started", message: "Full autonomous cycle initiated" });

    try {
      const { fullAutonomousCycle } = require("./publisher");
      await fullAutonomousCycle();
    } catch (err) {
      console.log(`[server] Autonomous cycle error: ${err.message}`);
    }
  },
);

// --- Auto-approve endpoint ---
app.post(
  "/api/autonomous/approve",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    try {
      const { autoApprove } = require("./publisher");
      const summary = await autoApprove();
      res.json({
        status: "ok",
        approved: summary.approved,
        scoring: summary,
      });
    } catch (err) {
      console.error(`[server] Internal error: ${err.message}`);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- Multi-platform publish endpoint ---
app.post(
  "/api/autonomous/publish",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    res.json({
      status: "started",
      message: "Multi-platform publish initiated",
    });

    try {
      const { publishToAllPlatforms } = require("./publisher");
      await publishToAllPlatforms();
    } catch (err) {
      console.log(`[server] Multi-platform publish error: ${err.message}`);
    }
  },
);

// --- Autonomous status ---
app.get("/api/autonomous/status", requireAuth, (req, res) => {
  res.json({
    autoPublish: process.env.AUTO_PUBLISH === "true",
    schedulerActive: schedulerRunning,
    hunterActive: !!hunterInterval,
    lastHuntRun: lastHunterRun.toISOString(),
    nextHuntRun: hunterInterval
      ? new Date(lastHunterRun.getTime() + HUNTER_INTERVAL_MS).toISOString()
      : null,
    schedule: {
      hunts: "Every 3 hours (auto-produces videos after each hunt)",
      publish: [
        "12:00 UTC / 1:00 PM BST - lunch break + US morning",
        "17:00 UTC / 6:00 PM BST - post-work peak + US noon",
        "21:00 UTC / 10:00 PM BST - evening session + US afternoon",
      ],
      strategy: "1 Short per window = 3 Shorts/day across all platforms",
    },
    platforms: {
      youtube: { configured: !!process.env.YOUTUBE_API_KEY },
      tiktok: { configured: !!process.env.TIKTOK_CLIENT_KEY },
      instagram: {
        configured:
          !!process.env.INSTAGRAM_ACCESS_TOKEN ||
          !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
      },
      facebook: { configured: !!process.env.FACEBOOK_PAGE_TOKEN },
      twitter: { configured: !!process.env.TWITTER_API_KEY },
    },
  });
});

// --- Platform auth status ---
app.get("/api/platforms/status", requireAuth, async (req, res) => {
  const status = {
    youtube: { authenticated: false, configured: false },
    tiktok: { authenticated: false, configured: false },
    instagram: { authenticated: false, configured: false },
  };

  // YouTube - check both file-based and env var auth
  try {
    const ytTokenPath = path.join(__dirname, "tokens", "youtube_token.json");
    const hasCredFile = await fs.pathExists(
      path.join(__dirname, "tokens", "youtube_credentials.json"),
    );
    const hasEnvCreds = !!(
      process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET
    );
    status.youtube.configured = hasCredFile || hasEnvCreds;
    const hasTokenFile = await fs.pathExists(ytTokenPath);
    const hasEnvToken = !!process.env.YOUTUBE_REFRESH_TOKEN;
    status.youtube.authenticated = hasTokenFile || hasEnvToken;
  } catch (err) {
    /* skip */
  }

  // TikTok status report — read-only structural check by default;
  // `?heal=true` additionally invokes getAccessToken() which either
  // refreshes (writing a new token file) or throws a clear reason.
  //
  // Honesty contract (upgraded 2026-04-20): getAccessToken no longer
  // silently swallows refresh failures or returns a stale token on a
  // dead refresh_token. If heal ran, `heal_attempted: true` with no
  // `heal_error` means a successful refresh OR a still-valid token.
  // If heal ran and failed, `heal_error` carries the actual reason
  // (e.g. "TikTok token cannot self-heal — no refresh_token on disk"
  // or a TikTok Graph error message). `authenticated: true` means
  // "file present + access_token field populated" — for
  // operationally-valid use the structured inspect fields below.
  try {
    status.tiktok.configured = !!process.env.TIKTOK_CLIENT_KEY;
    const {
      resolveTokenPath,
      getAccessToken,
      inspectTokenStatus,
    } = require("./upload_tiktok");
    const tokenPath = resolveTokenPath();
    status.tiktok.token_path = tokenPath;

    if (String(req.query.heal).toLowerCase() === "true") {
      try {
        await getAccessToken();
        status.tiktok.heal_attempted = true;
      } catch (healErr) {
        // Surface the real reason — no more silent "heal_attempted: true"
        // lies. Dashboards and the scheduled auth-check job can now
        // distinguish "token refreshed" from "token is broken and needs
        // /auth/tiktok".
        status.tiktok.heal_error = healErr.message;
      }
    }

    const inspect = await inspectTokenStatus();
    status.tiktok.token_file_exists = inspect.reason !== "token_file_missing";
    // `authenticated` retained for backward compat with callers who
    // only look at that boolean (frontend Navbar dots, older tests).
    // "authenticated" here means "the file exists and has an
    // access_token field" — the richer `ok`/`needs_reauth` fields
    // below are the operational truth.
    status.tiktok.authenticated =
      status.tiktok.token_file_exists &&
      inspect.reason !== "access_token_missing";
    status.tiktok.token_ok = inspect.ok;
    status.tiktok.needs_reauth = inspect.needs_reauth;
    if (inspect.reason && inspect.reason !== "ok") {
      status.tiktok.reason = inspect.reason;
    }
    if (typeof inspect.expires_at === "number") {
      status.tiktok.expires_at = new Date(inspect.expires_at).toISOString();
    }
    if (typeof inspect.expires_in_seconds === "number") {
      status.tiktok.expires_in_seconds = inspect.expires_in_seconds;
    }
  } catch (err) {
    /* skip */
  }

  // Instagram
  try {
    status.instagram.configured = !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    status.instagram.authenticated =
      !!process.env.INSTAGRAM_ACCESS_TOKEN ||
      (await fs.pathExists(
        path.join(__dirname, "tokens", "instagram_token.json"),
      ));
  } catch (err) {
    /* skip */
  }

  res.json(status);
});

// --- Image/Video generation queues ---
app.post(
  "/api/generate-image",
  requireAuth,
  rateLimit(30, 60000),
  async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "id required" });

      const { story } = findStory(id);
      if (!story) return res.status(404).json({ error: "story not found" });

      const queuePath = "image_queue.json";
      const queue = (await fs.pathExists(queuePath))
        ? await fs.readJson(queuePath)
        : [];
      queue.push({ id, queued_at: new Date().toISOString() });
      await fs.writeJson(queuePath, queue, { spaces: 2 });

      console.log(`[server] Image queued: ${id}`);
      res.json({ status: "generating", id });

      broadcastProgress(id, "image", 10, "Queued for generation");
    } catch (err) {
      console.error(`[server] Internal error: ${err.message}`);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.post(
  "/api/generate-video",
  requireAuth,
  rateLimit(30, 60000),
  async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "id required" });

      const { story } = findStory(id);
      if (!story) return res.status(404).json({ error: "story not found" });

      const queuePath = "video_queue.json";
      const queue = (await fs.pathExists(queuePath))
        ? await fs.readJson(queuePath)
        : [];
      queue.push({ id, queued_at: new Date().toISOString() });
      await fs.writeJson(queuePath, queue, { spaces: 2 });

      console.log(`[server] Video queued: ${id}`);
      res.json({ status: "generating", id });

      broadcastProgress(id, "video", 10, "Queued for generation");
    } catch (err) {
      console.error(`[server] Internal error: ${err.message}`);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

// --- Schedule ---
app.post("/api/schedule", requireAuth, rateLimit(30, 60000), (req, res) => {
  const { id, scheduleTime } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });

  const updated = updateStory(id, { schedule_time: scheduleTime || null });
  if (!updated) return res.status(404).json({ error: "story not found" });

  res.json({ status: "scheduled", id, scheduleTime });
});

// --- Retry publish ---
app.post("/api/retry-publish", requireAuth, rateLimit(5, 60000), (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });

  const updated = updateStory(id, {
    publish_status: "publishing",
    publish_error: undefined,
  });
  if (!updated) return res.status(404).json({ error: "story not found" });

  res.json({ status: "retrying", id });
});

// --- Shared: has the operator supplied a valid Bearer API_TOKEN? ---
// Non-throwing version of the requireAuth middleware, for routes that
// want to gate access on WHETHER the caller is authenticated rather
// than reject outright. Used by the draft-artefact routes below to
// serve public artefacts unauthenticated but require Bearer for
// drafts. Returns true for any authenticated request, or true in
// dev when API_TOKEN is unset (same dev-bypass as requireAuth).
function isAuthenticatedRequest(req) {
  const secret = process.env.API_TOKEN;
  if (!secret) return true; // dev bypass — mirrors requireAuth
  const header = req.headers && req.headers.authorization;
  if (typeof header !== "string") return false;
  const token = header.replace(/^Bearer\s+/, "");
  return token === secret;
}

// --- Story image download (for Instagram Stories) ---
// Meta's servers fetch this during the Instagram/Facebook Story
// upload (see upload_instagram.js::uploadStoryImage and
// upload_facebook.js::uploadStoryImage). By the time either runs,
// YouTube has already uploaded and `isPubliclyVisible` returns
// true — so the unauthenticated fetch works for the legitimate
// publish flow. Draft/queued/failed stories fall through to a 404
// for unauthenticated callers so an attacker scraping story IDs
// can't tell which drafts exist vs. which don't.
app.get("/api/story-image/:id", async (req, res) => {
  try {
    const { isPubliclyVisible } = require("./lib/public-story");
    const mediaPaths = require("./lib/media-paths");
    const stories = readNews();
    const story = stories.find((s) => s.id === req.params.id);
    // "Story exists but not live AND caller not authed" looks the
    // same to the client as "story does not exist" — no enumeration.
    if (!story || (!isPubliclyVisible(story) && !isAuthenticatedRequest(req))) {
      return res.status(404).json({ error: "story image not found" });
    }
    if (!story.story_image_path) {
      return res.status(404).json({ error: "story image not found" });
    }
    // Resolve through media-paths: tries MEDIA_ROOT first, falls
    // back to repo-root. Containment check below must accept BOTH
    // bases as legitimate so a MEDIA_ROOT=/data/media config still
    // passes the `output/` gate.
    const filePath = await mediaPaths.resolveExisting(story.story_image_path);
    const allowedBases = [
      path.resolve(__dirname, "output"),
      mediaPaths.getMediaRoot()
        ? path.resolve(mediaPaths.getMediaRoot(), "output")
        : null,
    ].filter(Boolean);
    const inAllowedBase = allowedBases.some(
      (base) => filePath === base || filePath.startsWith(base + path.sep),
    );
    if (!inAllowedBase) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file not found on disk" });
    }
    res.setHeader("Content-Type", "image/png");
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error(`[server] ERROR serving story image: ${err.message}`);
    res.status(500).json({ error: "Failed to serve image" });
  }
});

// NOTE: The former `app.use("/stories", express.static(output/stories))`
// mount was removed on 2026-04-20 after the artefact-route audit —
// it duplicated every file `/api/story-image/:id` now serves but
// bypassed the draft-vs-published gate, so `/stories/<id>_story.png`
// let anyone with a guessable story id pull the IG Story card for
// an unpublished story. The only consumer was an internal "for easy
// browsing" convenience; IG/FB uploaders, the dashboard, and every
// grepable URL reference already go through /api/story-image/:id.
// Do NOT re-add a public static mount over output/stories without
// wiring it through the same `isPubliclyVisible + Bearer` gate.

// --- Download ---
// Same public-vs-draft gate as /api/story-image. IG/FB URL-fallback
// uploaders (upload_instagram.js::uploadReelViaUrl,
// upload_facebook.js::uploadReelViaUrl) fetch this during publish —
// by that point YouTube has uploaded and isPubliclyVisible is true.
// Draft MP4s are private to the operator (Bearer token) and look
// like 404s to any unauthenticated scraper probing story IDs.
app.get("/api/download/:id", async (req, res) => {
  try {
    const { isPubliclyVisible } = require("./lib/public-story");
    const mediaPaths = require("./lib/media-paths");
    const stories = readNews();
    const story = stories.find((s) => s.id === req.params.id);

    if (!story || (!isPubliclyVisible(story) && !isAuthenticatedRequest(req))) {
      return res.status(404).json({ error: "video not found" });
    }
    if (!story.exported_path) {
      return res.status(404).json({ error: "video not found" });
    }

    // Resolve through media-paths — same rationale as
    // /api/story-image above. Containment check accepts BOTH the
    // repo-root `output/` base and (if set) the MEDIA_ROOT `output/`
    // base so a Railway config with a persistent volume still
    // clears the sandbox gate.
    const filePath = await mediaPaths.resolveExisting(story.exported_path);
    const allowedBases = [
      path.resolve(__dirname, "output"),
      mediaPaths.getMediaRoot()
        ? path.resolve(mediaPaths.getMediaRoot(), "output")
        : null,
    ].filter(Boolean);
    const inAllowedBase = allowedBases.some(
      (base) => filePath === base || filePath.startsWith(base + path.sep),
    );
    if (!inAllowedBase) {
      return res.status(403).json({ error: "Access denied" });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "file not found on disk" });
    }

    const stat = fs.statSync(filePath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Length", stat.size);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=pulse-gaming-${req.params.id}.mp4`,
    );
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.log(`[server] ERROR downloading: ${err.message}`);
    res.status(500).json({ error: "Download failed" });
  }
});

// --- Stats ---
app.get("/api/stats/:postId", async (req, res) => {
  try {
    const { platform } = req.query;
    const postId = req.params.postId;

    // Guard against sentinel values ("DUPE_BLOCKED" / "DUPE_SKIPPED") that the
    // publisher writes into post-id fields when an upload was refused.
    // Sending those to the real YouTube/TikTok APIs burns quota on a
    // guaranteed 404 and surfaces "0 views" as if the video existed.
    if (!postId || postId.startsWith("DUPE_")) {
      return res.json({ views: 0, blocked: true });
    }

    if (platform === "youtube") {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey || apiKey === "placeholder") {
        return res.json({ views: 0, note: "YouTube API key not configured" });
      }
      try {
        const ytRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(postId)}&key=${encodeURIComponent(apiKey)}`,
        );
        if (ytRes.ok) {
          const ytData = await ytRes.json();
          const item = ytData.items?.[0];
          return res.json({
            views: item ? parseInt(item.statistics.viewCount, 10) || 0 : 0,
          });
        }
      } catch (e) {
        // fall through
      }
      return res.json({ views: 0 });
    }

    if (platform === "tiktok") {
      return res.json({ views: 0 });
    }

    res.json({ views: 0, likes: 0, note: "YouTube API integration pending" });
  } catch (err) {
    console.log(`[server] ERROR stats: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/stats/update", requireAuth, rateLimit(30, 60000), (req, res) => {
  const { id, youtube_views, tiktok_views } = req.body;
  if (!id) return res.status(400).json({ error: "id required" });

  const updates = {};
  if (youtube_views !== undefined) updates.youtube_views = youtube_views;
  if (tiktok_views !== undefined) updates.tiktok_views = tiktok_views;

  const updated = updateStory(id, updates);
  if (!updated) return res.status(404).json({ error: "story not found" });

  res.json({ status: "updated", id });
});

// --- Hunter endpoints ---
const HUNTER_INTERVAL_MS = 3 * 60 * 60 * 1000; // every 3 hours
// Random jitter (0-15 min) to avoid predictable bot-like timing patterns
const JITTER_MAX_MS = 15 * 60 * 1000;
let hunterInterval = null;
let lastHunterRun = new Date(0);
let schedulerRunning = false;

async function runHunter() {
  console.log("[server] Running hunter cycle...");
  lastHunterRun = new Date();

  try {
    const hunt = require("./hunter");
    const process_stories = require("./processor");
    const sendDiscord = require("./notify");

    const posts = await hunt();
    const existingStories = readNews();
    const existingIds = new Set(existingStories.map((s) => s.id));

    // Only process new stories
    const newPosts = posts.filter((p) => !existingIds.has(p.id));

    if (newPosts.length > 0) {
      // Write new posts to pending_news.json for processor. Guarded so
      // a writeJson failure (disk, permissions, size) does not poison
      // Discord with a raw RangeError.
      try {
        await fs.writeJson(
          "pending_news.json",
          { timestamp: new Date().toISOString(), stories: newPosts },
          { spaces: 2 },
        );
      } catch (err) {
        console.log(
          `[server] runHunter: pending_news.json write failed (${err.message}). Skipping processor + merge this cycle.`,
        );
        return;
      }
      await process_stories();

      // Under USE_SQLITE=true (production) the processor has already
      // upserted each story row directly into SQLite. The merge +
      // writeNews round-trip is vestigial JSON-era dual-write
      // behaviour: it re-serialises the entire stories set purely to
      // refresh the JSON mirror. Skip it under SQLite — the mirror has
      // no reader in prod and the big stringify was the sole source of
      // the "Invalid string length" hunt failures (17 Apr 22:38,
      // 18 Apr 04:47).
      //
      // Dev JSON mode (USE_SQLITE=false) still runs the merge because
      // the JSON file is the canonical store there.
      if (!db.useSqlite()) {
        try {
          const processed = readNews();
          if (existingStories.length > 0 && processed.length > 0) {
            const processedIds = new Set(processed.map((s) => s.id));
            const toMerge = existingStories.filter(
              (s) => !processedIds.has(s.id),
            );
            const merged = [...processed, ...toMerge];
            writeNews(merged);
          }
        } catch (err) {
          // Never fail a hunt over a JSON mirror problem.
          console.log(
            `[server] runHunter: legacy JSON merge failed (${err.message}). Continuing — canonical store is unaffected.`,
          );
        }
      }
    }

    // Auto-approve all stories
    try {
      const { autoApprove } = require("./publisher");
      await autoApprove();
    } catch (err) {
      console.log(`[server] Auto-approve error: ${err.message}`);
    }

    // Immediately produce assets for newly approved stories (audio + images + video)
    const allStories = readNews();
    const needProduce = allStories.filter(
      (s) => s.approved && (!s.audio_path || !s.image_path || !s.exported_path),
    );
    if (needProduce.length > 0) {
      console.log(
        `[server] ${needProduce.length} stories need production - starting pipeline...`,
      );
      try {
        const { produce } = require("./publisher");
        await produce();
        await sendDiscord(
          `**Pulse Gaming Pipeline**\n` +
            `Hunted ${newPosts.length} new stories, ${needProduce.length} produced into videos`,
        );
      } catch (err) {
        console.log(`[server] Produce error: ${err.message}`);
        await sendDiscord(`**Produce Error**: ${err.message}`);
      }
    } else if (newPosts.length > 0) {
      await sendDiscord(
        `**Hunt Complete** - ${newPosts.length} new stories (all already produced)`,
      );
    }

    console.log(
      `[server] Hunter cycle complete: ${newPosts.length} new, ${needProduce.length} produced`,
    );
  } catch (err) {
    console.log(`[server] Hunter error: ${err.message}`);
    try {
      const sendDiscord = require("./notify");
      await sendDiscord(`**Hunt Error**: ${err.message}`);
    } catch (e) {
      /* silent */
    }
  }
}

app.get("/api/hunter/status", requireAuth, (req, res) => {
  res.json({
    active: !!hunterInterval,
    lastRun: lastHunterRun.toISOString(),
    nextRun: hunterInterval
      ? new Date(lastHunterRun.getTime() + HUNTER_INTERVAL_MS).toISOString()
      : null,
  });
});

app.post(
  "/api/hunter/run",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    res.json({ status: "started" });
    await runHunter();
  },
);

// --- Autonomous scheduler (built into server) ---
async function startAutonomousScheduler() {
  const hasKey =
    process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_API_KEY !== "placeholder";
  if (!hasKey) {
    console.log(
      "[server] Autonomous scheduler disabled. Set ANTHROPIC_API_KEY to enable.",
    );
    return;
  }

  // Phase D: unified jobs queue is now the canonical dispatcher. The
  // lib/dispatch-mode helper picks between `queue` (default, and the
  // only mode reachable in production) and `legacy_dev` (explicit dev
  // opt-out via USE_JOB_QUEUE=false). Bootstrap failure in production
  // throws and refuses to start — no silent fall-through to the
  // legacy cron registry, which was the 17-April duplicate-dispatch
  // foot-gun.
  const { resolveDispatchMode } = require("./lib/dispatch-mode");
  const dispatch = resolveDispatchMode();
  console.log(
    `[server] dispatch mode=${dispatch.mode} strict=${dispatch.strict} reason=${dispatch.reason}`,
  );

  if (dispatch.mode === "queue") {
    try {
      const bootstrap = require("./lib/bootstrap-queue");
      await bootstrap.start({
        workerId: `server-${require("os").hostname()}-${process.pid}`,
        runScheduler: true,
        runRunner: true,
        autoSeed: true,
      });
      schedulerRunning = true;
      console.log(
        "[server] canonical scheduler up via bootstrap-queue (lib/scheduler.js + jobs-runner)",
      );
      return;
    } catch (err) {
      if (dispatch.strict) {
        // Production safety: legacy cron is NOT reachable from here.
        // Refusing to start is preferable to silently arming a parallel
        // dispatcher in-process.
        console.error(
          `[server] FATAL: bootstrap-queue failed in production — refusing to start legacy cron fallback. ` +
            `Original error: ${err.message}`,
        );
        throw err;
      }
      console.error(
        `[server] bootstrap-queue failed in dev (${err.message}) — no scheduler will run this process. ` +
          `Set USE_JOB_QUEUE=false to intentionally use the legacy cron block for local dev.`,
      );
      return;
    }
  }

  // dispatch.mode === 'legacy_dev' — explicit dev opt-in only. Never
  // reached in production.
  console.log(
    "[server] WARNING: legacy in-process cron registry active (USE_JOB_QUEUE=false, dev only). " +
      "This path is DEPRECATED — queue mode is canonical in production.",
  );
  await _registerLegacyDevCronRegistry();
}

// Quarantined pre-Phase-D cron registry. Do not call this from production
// paths. Kept only as an escape hatch for local dev against the legacy
// JSON pipeline (USE_SQLITE!=true). The contents below are unchanged
// from the pre-Phase-D layout so diffs stay reviewable; future cleanup
// can delete this block once nobody runs the JSON pipeline locally.
async function _registerLegacyDevCronRegistry() {
  schedulerRunning = true;
  const sendDiscord = require("./notify");

  // Hunt every 3 hours + random jitter (0-15 min) to avoid bot-like timing patterns
  console.log(
    "[server] Auto-hunter enabled. Running every ~3 hours (with jitter).",
  );
  console.log(
    "[server] Each hunt: fetch -> scripts -> approve -> audio -> images -> video",
  );
  // Schedule hunts with jitter to look human
  function scheduleNextHunt() {
    const jitter = Math.floor(Math.random() * JITTER_MAX_MS);
    const nextIn = HUNTER_INTERVAL_MS + jitter;
    console.log(
      `[server] Next hunt in ${Math.round(nextIn / 60000)} minutes (includes ${Math.round(jitter / 60000)}min jitter)`,
    );
    hunterInterval = setTimeout(async () => {
      await runHunter();
      scheduleNextHunt();
    }, nextIn);
  }
  // Delay first hunt by 30s to let server fully stabilise after deploy
  setTimeout(() => {
    runHunter();
    scheduleNextHunt();
  }, 30000);

  // Data-driven publish windows - uses analytics history to find optimal hours.
  // Falls back to 07:00/13:00/19:00 UTC when insufficient data.
  if (process.env.AUTO_PUBLISH === "true") {
    const {
      getRecommendedSchedule,
      DEFAULT_SCHEDULE,
    } = require("./optimal_timing");
    let schedule;
    try {
      schedule = await getRecommendedSchedule();
    } catch (err) {
      console.log(
        `[server] Optimal timing analysis failed, using defaults: ${err.message}`,
      );
      schedule = DEFAULT_SCHEDULE;
    }
    console.log(
      `[server] Publish schedule confidence: ${schedule.confidence} (${schedule.dataPoints} data points)`,
    );

    const publishWindows = schedule.crons;
    const windowLabels = schedule.labels;

    publishWindows.forEach((cronExpr, i) => {
      cron.schedule(
        cronExpr,
        async () => {
          console.log(`[server-cron] ${windowLabels[i]} - PUBLISH WINDOW`);
          try {
            // Final produce pass to catch any stragglers
            const { produce } = require("./publisher");
            await produce();

            // Publish ONE story per window (spread across the day for algorithm)
            const { publishNextStory } = require("./publisher");
            const result = await publishNextStory();
            if (result) {
              const errorDetails =
                result.errors && Object.keys(result.errors).length > 0
                  ? "\n" +
                    Object.entries(result.errors)
                      .map(([p, msg]) => `${p}: ${msg}`)
                      .join("\n")
                  : "";
              await sendDiscord(
                `**Pulse Gaming Published** (${windowLabels[i]})\n` +
                  `"${result.title}"\n` +
                  `YT: ${result.youtube ? "yes" : "FAIL"} | TT: ${result.tiktok ? "yes" : "FAIL"} | IG: ${result.instagram ? "yes" : "FAIL"} | FB: ${result.facebook ? "yes" : "FAIL"} | X: ${result.twitter ? "yes" : "FAIL"}` +
                  errorDetails,
              );
            } else {
              console.log(
                `[server-cron] No unpublished stories ready for ${windowLabels[i]}`,
              );
            }
          } catch (err) {
            console.log(`[server-cron] Publish error: ${err.message}`);
            await sendDiscord(
              `**Publish Error** (${windowLabels[i]}): ${err.message}`,
            );
          }
        },
        { timezone: "UTC" },
      );
    });

    console.log(
      `[server] Auto-publish enabled: ${publishWindows.length}x daily - ${windowLabels.join(" | ")}`,
    );

    // Engagement passes - 30 minutes after each publish window
    const engagementWindows = ["30 7 * * *", "30 13 * * *", "30 19 * * *"];
    engagementWindows.forEach((cronExpr, i) => {
      cron.schedule(
        cronExpr,
        async () => {
          console.log(
            `[server-cron] ${windowLabels[i]} +30min - ENGAGEMENT PASS`,
          );
          try {
            const { engageRecent } = require("./engagement");
            await engageRecent();
          } catch (err) {
            console.log(`[server-cron] Engagement error: ${err.message}`);
          }
        },
        { timezone: "UTC" },
      );
    });
    console.log(
      "[server] Auto-engagement enabled: 30 min after each publish window",
    );

    // First-hour engagement - every 15 minutes, catches videos published < 60 min ago
    cron.schedule(
      "*/15 * * * *",
      async () => {
        try {
          const fhNews = await fs.readJson(DATA_FILE).catch(() => []);
          const now = Date.now();
          const cutoff1h = now - 60 * 60 * 1000;

          const firstHourVideos = fhNews.filter((s) => {
            if (!s.youtube_post_id || s.publish_status !== "published")
              return false;
            const publishTime = s.published_at || s.timestamp;
            return publishTime && new Date(publishTime).getTime() >= cutoff1h;
          });

          if (firstHourVideos.length > 0) {
            console.log(
              `[server-cron] First-hour engagement: ${firstHourVideos.length} video(s) in window`,
            );
            const { engageFirstHour } = require("./engagement");
            for (const story of firstHourVideos) {
              await engageFirstHour(story.youtube_post_id, story);
            }
          }
        } catch (err) {
          console.log(
            `[server-cron] First-hour engagement error: ${err.message}`,
          );
        }
      },
      { timezone: "UTC" },
    );
    console.log(
      "[server] First-hour engagement: every 15 min for videos < 60 min old",
    );

    // Analytics pass - twice daily, pulls YouTube stats and updates scoring history
    const analyticsWindows = ["0 8 * * *", "0 20 * * *"];
    analyticsWindows.forEach((cronExpr) => {
      cron.schedule(
        cronExpr,
        async () => {
          console.log("[server-cron] ANALYTICS PASS - pulling YouTube stats");
          try {
            const { runAnalytics } = require("./analytics");
            await runAnalytics();
          } catch (err) {
            console.log(`[server-cron] Analytics error: ${err.message}`);
          }
        },
        { timezone: "UTC" },
      );
    });
    console.log("[server] Analytics enabled: 2x daily at 08:00/20:00 UTC");
  } else {
    console.log(
      "[server] AUTO_PUBLISH is off. Videos will be produced but not uploaded.",
    );
    console.log(
      "[server] Set AUTO_PUBLISH=true in Railway env vars to enable.",
    );
  }

  // Weekly longform compilation - every Sunday at 14:00 UTC
  cron.schedule(
    "0 14 * * 0",
    async () => {
      console.log("[server-cron] Sunday 14:00 UTC - WEEKLY COMPILATION");
      try {
        const { compileWeekly } = require("./weekly_compile");
        const result = await compileWeekly();
        if (result) {
          weeklyCompilationState = {
            status: "complete",
            last_compiled: new Date().toISOString(),
            result,
            error: null,
          };
          await sendDiscord(
            `**Weekly Roundup Published**\n` +
              `${result.story_count} stories, ${Math.round(result.duration_seconds / 60)} min\n` +
              `${result.youtube_url || "Upload pending"}`,
          );
        } else {
          weeklyCompilationState = {
            status: "skipped",
            last_compiled: new Date().toISOString(),
            error: null,
          };
        }
      } catch (err) {
        console.log(`[server-cron] Weekly compilation error: ${err.message}`);
        weeklyCompilationState = {
          status: "error",
          last_compiled: null,
          error: err.message,
        };
        await sendDiscord(`**Weekly Roundup Error**: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );
  console.log("[server] Weekly compilation: Sunday 14:00 UTC");

  // Monthly topic compilations - 1st of each month at 10:00 UTC
  cron.schedule(
    "0 10 1 * *",
    async () => {
      console.log(
        "[server-cron] 1st of month 10:00 UTC - MONTHLY TOPIC COMPILATIONS",
      );
      try {
        const {
          identifyCompilableTopics,
          compileByTopic,
        } = require("./weekly_compile");
        const topics = await identifyCompilableTopics(30);
        const top3 = topics.slice(0, 3);

        if (top3.length === 0) {
          console.log("[server-cron] No compilable topics found this month");
          await sendDiscord(
            "**Monthly Topic Compilations** - No topics with 4+ stories found. Skipping.",
          );
          return;
        }

        console.log(
          `[server-cron] Compiling top ${top3.length} topics: ${top3.map((t) => t.keyword).join(", ")}`,
        );
        await sendDiscord(
          `**Monthly Topic Compilations** - Starting ${top3.length} compilations: ${top3.map((t) => `"${t.keyword}" (${t.count} stories)`).join(", ")}`,
        );

        for (const topic of top3) {
          try {
            await compileByTopic(topic.keyword);
          } catch (err) {
            console.log(
              `[server-cron] Topic compilation failed for "${topic.keyword}": ${err.message}`,
            );
            await sendDiscord(
              `**Topic Compilation Error** ("${topic.keyword}"): ${err.message}`,
            );
          }
        }
      } catch (err) {
        console.log(
          `[server-cron] Monthly topic compilations error: ${err.message}`,
        );
        await sendDiscord(
          `**Monthly Topic Compilations Error**: ${err.message}`,
        );
      }
    },
    { timezone: "UTC" },
  );
  console.log("[server] Monthly topic compilations: 1st of month at 10:00 UTC");

  // Instagram token auto-refresh - every Monday at 03:00 UTC
  cron.schedule(
    "0 3 * * 1",
    async () => {
      console.log("[server-cron] Instagram token refresh check...");
      try {
        const {
          seedTokenFromEnv,
          refreshToken,
        } = require("./upload_instagram");
        const fs2 = require("fs-extra");
        const tokenPath = path.join(
          __dirname,
          "tokens",
          "instagram_token.json",
        );
        await seedTokenFromEnv();
        if (await fs2.pathExists(tokenPath)) {
          const tokenData = await fs2.readJson(tokenPath);
          const daysLeft = Math.round(
            (tokenData.expires_at - Date.now()) / (24 * 60 * 60 * 1000),
          );
          console.log(`[instagram] Token expires in ${daysLeft} days`);
          if (daysLeft < 30) {
            await refreshToken(tokenData.access_token);
            console.log("[instagram] Token refreshed successfully");
          } else {
            console.log("[instagram] Token still fresh, no refresh needed");
          }
        }
      } catch (err) {
        console.log(`[instagram] Token refresh failed: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );
  console.log("[server] Instagram token auto-refresh: every Monday 03:00 UTC");

  // Blog rebuild - daily at 22:00 UTC (after last publish window)
  cron.schedule(
    "0 22 * * *",
    async () => {
      console.log("[server-cron] 22:00 UTC - BLOG REBUILD");
      try {
        const { build } = require("./blog/build");
        await build();
        console.log("[server-cron] Blog rebuild complete");
      } catch (err) {
        console.log(`[server-cron] Blog rebuild error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );
  console.log("[server] Blog rebuild: daily at 22:00 UTC");

  // Weekly timing re-analysis - Sunday midnight UTC
  cron.schedule(
    "0 0 * * 0",
    async () => {
      console.log("[server-cron] Sunday 00:00 UTC - WEEKLY TIMING RE-ANALYSIS");
      try {
        const { getTimingReport } = require("./optimal_timing");
        const report = await getTimingReport();
        console.log("[server-cron] Timing report generated");
        await sendDiscord("**Weekly Timing Report**\n" + report);
      } catch (err) {
        console.log(`[server-cron] Timing analysis error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );
  console.log("[server] Weekly timing re-analysis: Sunday 00:00 UTC");

  // Daily database backup - 04:00 UTC
  cron.schedule(
    "0 4 * * *",
    async () => {
      console.log("[server-cron] 04:00 UTC - DATABASE BACKUP");
      try {
        const { backupDatabase } = require("./lib/db_backup");
        await backupDatabase();
      } catch (err) {
        console.log(`[server-cron] DB backup error: ${err.message}`);
      }
    },
    { timezone: "UTC" },
  );
  console.log("[server] Database backup: daily at 04:00 UTC");

  // --- Breaking news watcher (continuous Reddit + RSS monitoring) ---
  try {
    const { startWatching } = require("./watcher");
    const { queueBreaking } = require("./breaking_queue");

    const emitter = startWatching();
    emitter.on("breaking", (story) => {
      console.log(`[server] Watcher detected breaking story: ${story.title}`);
      queueBreaking(story);
    });
    console.log(
      "[server] Breaking news watcher started (90s Reddit / 5min RSS polls)",
    );
  } catch (err) {
    console.log(`[server] Watcher failed to start: ${err.message}`);
  }
}

// --- Watcher endpoints (breaking news speed pipeline) ---
app.get("/api/watcher/status", requireAuth, (req, res) => {
  const { getStatus } = require("./watcher");
  const { getQueueStatus } = require("./breaking_queue");
  res.json({
    watcher: getStatus(),
    queue: getQueueStatus(),
  });
});

app.post("/api/watcher/start", requireAuth, rateLimit(5, 60000), (req, res) => {
  const { startWatching } = require("./watcher");
  const { queueBreaking } = require("./breaking_queue");

  const emitter = startWatching();
  emitter.removeAllListeners("breaking"); // prevent duplicate listeners on restart
  emitter.on("breaking", (story) => {
    console.log(`[server] Watcher detected breaking story: ${story.title}`);
    queueBreaking(story);
  });

  res.json({ status: "started" });
});

app.post("/api/watcher/stop", requireAuth, rateLimit(5, 60000), (req, res) => {
  const { stopWatching } = require("./watcher");
  stopWatching();
  res.json({ status: "stopped" });
});

// --- Analytics dashboard endpoints ---

app.get("/api/analytics/overview", requireAuth, async (req, res) => {
  try {
    const { loadHistory } = require("./analytics");
    const history = await loadHistory();
    const entries = history.entries || [];

    if (entries.length === 0) {
      return res.json({
        totalVideos: 0,
        totalViews: { youtube: 0, tiktok: 0, instagram: 0, combined: 0 },
        bestPerformer: null,
        avgVirality: 0,
      });
    }

    let ytViews = 0,
      ttViews = 0,
      igViews = 0;
    let bestEntry = null;
    let viralitySum = 0;

    for (const entry of entries) {
      ytViews += entry.youtube_views || 0;
      ttViews += entry.tiktok_views || 0;
      igViews += entry.instagram_views || 0;
      viralitySum += entry.virality_score || 0;

      if (
        !bestEntry ||
        (entry.virality_score || 0) > (bestEntry.virality_score || 0)
      ) {
        bestEntry = entry;
      }
    }

    res.json({
      totalVideos: entries.length,
      totalViews: {
        youtube: ytViews,
        tiktok: ttViews,
        instagram: igViews,
        combined: ytViews + ttViews + igViews,
      },
      bestPerformer: bestEntry
        ? {
            id: bestEntry.id,
            title: bestEntry.title,
            virality_score: bestEntry.virality_score,
            total_views:
              (bestEntry.youtube_views || 0) +
              (bestEntry.tiktok_views || 0) +
              (bestEntry.instagram_views || 0),
          }
        : null,
      avgVirality: Math.round((viralitySum / entries.length) * 10) / 10,
    });
  } catch (err) {
    console.log(`[server] Analytics overview error: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/analytics/topics", requireAuth, async (req, res) => {
  try {
    const { getTopPerformingTopics } = require("./analytics");
    const topics = getTopPerformingTopics();
    res.json(topics);
  } catch (err) {
    console.log(`[server] Analytics topics error: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/analytics/history", requireAuth, async (req, res) => {
  try {
    const { loadHistory } = require("./analytics");
    const history = await loadHistory();
    const entries = history.entries || [];

    // Return most recent first, with optional limit via query param
    const limit = parseInt(req.query.limit, 10) || 50;
    const sorted = [...entries]
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.published_at || 0) -
          new Date(a.updated_at || a.published_at || 0),
      )
      .slice(0, limit);

    res.json({
      total: entries.length,
      entries: sorted,
    });
  } catch (err) {
    console.log(`[server] Analytics history error: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Optimal timing endpoint ---
app.get("/api/analytics/optimal-timing", requireAuth, async (req, res) => {
  try {
    const {
      analyzeOptimalWindows,
      analyzeDayOfWeek,
      getRecommendedSchedule,
      getTimingReport,
    } = require("./optimal_timing");
    const [hours, days, schedule, report] = await Promise.all([
      analyzeOptimalWindows(),
      analyzeDayOfWeek(),
      getRecommendedSchedule(),
      getTimingReport(),
    ]);
    res.json({ hours, days, schedule, report });
  } catch (err) {
    console.log(`[server] Optimal timing error: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Analytics digest (Task 8, 2026-04-21) -----------------------
// Operator-only. Returns the N most recent published stories plus
// the latest per-platform metric snapshot and (when available) a
// delta from the previous snapshot. Reads from:
//   - stories table for the shortlist
//   - platform_metric_snapshots for the per-platform rows
// No secret-bearing fields are emitted — raw_json is stripped by
// the digest builder.
app.get("/api/analytics/digest", requireAuth, async (req, res) => {
  try {
    const dbMod = require("./lib/db");
    const { buildAnalyticsDigest } = require("./lib/services/analytics-digest");
    const pmsRepo = require("./lib/repositories/platform_metric_snapshots");

    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
        ? Math.min(50, parseInt(limitRaw, 10))
        : undefined;

    const stories = readNews();
    const dbHandle =
      dbMod.useSqlite && dbMod.useSqlite() ? dbMod.getDb() : null;

    const digest = buildAnalyticsDigest({
      stories,
      pmsRepo,
      dbHandle,
      limit,
    });
    res.json(digest);
  } catch (err) {
    console.log(`[server] /api/analytics/digest error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Blog static site ---
app.use("/blog", express.static(path.join(__dirname, "blog", "dist")));

// --- Engagement stats endpoint ---
app.get("/api/engagement/stats", requireAuth, async (req, res) => {
  try {
    const statsPath = path.join(__dirname, "engagement_stats.json");
    if (await fs.pathExists(statsPath)) {
      const stats = await fs.readJson(statsPath);
      res.json(stats);
    } else {
      res.json({});
    }
  } catch (err) {
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Manual engagement pass endpoint ---
app.post(
  "/api/engagement/run",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    res.json({ status: "started", message: "Engagement pass initiated" });

    try {
      const { engageRecent } = require("./engagement");
      await engageRecent();
    } catch (err) {
      console.log(`[server] Engagement pass error: ${err.message}`);
    }
  },
);

// --- Observability: queue stats, scoring digest, pack inventory ---
// Gated behind USE_SQLITE so they don't crash on legacy deploys that
// haven't run migrations. Each route hydrates repos lazily so we don't
// pay the SQLite cost until an operator actually pulls the stats.
app.get("/api/queue/stats", requireAuth, (req, res) => {
  if (process.env.USE_SQLITE !== "true") {
    return res.status(503).json({
      error: "sqlite_disabled",
      hint: "Set USE_SQLITE=true to enable queue observability",
    });
  }
  try {
    const { getQueueStats } = require("./lib/observability");
    const repos = require("./lib/repositories").getRepos();
    res.json(getQueueStats({ repos }));
  } catch (err) {
    console.error(`[server] /api/queue/stats error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Pipeline backlog (Task 12, 2026-04-21) ----------------------
// Operator-only. Returns counts + next-candidate + top-10 stuck
// stories with blocking reasons. Used by the dashboard to answer
// "why isn't my approved story publishing?" without shelling into
// SQLite.
app.get("/api/pipeline/backlog", requireAuth, (req, res) => {
  try {
    const stories = readNews();
    const { buildPipelineBacklog } = require("./lib/services/pipeline-backlog");
    res.json(buildPipelineBacklog(stories));
  } catch (err) {
    console.error(`[server] /api/pipeline/backlog error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Scheduler plan (Task 9, 2026-04-21) -------------------------
// Operator-facing list of every registered schedule with cron +
// human-time + lane classification. Reads DEFAULT_SCHEDULES from
// lib/scheduler (the source of truth the seeder applies to the
// SQLite `schedules` table on deploy), so the endpoint stays
// in-sync with what's actually registered on process start. No
// secrets — just names, cron strings, lanes, priorities.
app.get("/api/scheduler/plan", requireAuth, (req, res) => {
  try {
    const { DEFAULT_SCHEDULES } = require("./lib/scheduler");
    const { buildSchedulerPlan } = require("./lib/services/scheduler-plan");
    res.json(buildSchedulerPlan(DEFAULT_SCHEDULES));
  } catch (err) {
    console.error(`[server] /api/scheduler/plan error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/scoring/digest", requireAuth, (req, res) => {
  if (process.env.USE_SQLITE !== "true") {
    return res.status(503).json({ error: "sqlite_disabled" });
  }
  try {
    const { getScoringDigest } = require("./lib/observability");
    const repos = require("./lib/repositories").getRepos();
    const hours = Math.max(1, Math.min(Number(req.query.hours) || 24, 7 * 24));
    const channelId = req.query.channel || null;
    res.json(getScoringDigest({ repos, sinceHours: hours, channelId }));
  } catch (err) {
    console.error(`[server] /api/scoring/digest error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post(
  "/api/scoring/digest/post",
  requireAuth,
  rateLimit(5, 60 * 60 * 1000),
  async (req, res) => {
    if (process.env.USE_SQLITE !== "true") {
      return res.status(503).json({ error: "sqlite_disabled" });
    }
    try {
      const {
        getScoringDigest,
        buildScoringDigestMessage,
      } = require("./lib/observability");
      const repos = require("./lib/repositories").getRepos();
      const hours = Math.max(
        1,
        Math.min(Number(req.query.hours) || 24, 7 * 24),
      );
      const summary = getScoringDigest({ repos, sinceHours: hours });
      const message = buildScoringDigestMessage(summary);
      const sendDiscord = require("./notify");
      await sendDiscord(message);
      res.json({ ok: true, scored: summary.scored });
    } catch (err) {
      console.error(`[server] scoring/digest/post error: ${err.message}`);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

app.get("/api/audio-packs", requireAuth, (req, res) => {
  if (process.env.USE_SQLITE !== "true") {
    return res.status(503).json({ error: "sqlite_disabled" });
  }
  try {
    const audioIdentity = require("./lib/audio-identity");
    const repos = require("./lib/repositories").getRepos();
    const channelRegistry = require("./channels");
    const channels = channelRegistry.listChannels().map((c) => c.id);
    const packs = channels.map((channelId) => {
      const pack = audioIdentity.describeChannelPack({ repos, channelId });
      if (!pack) return { channel_id: channelId, pack: null };
      return {
        channel_id: channelId,
        pack_id: pack.id,
        pack_name: pack.name,
        is_fallback: pack.id === audioIdentity.FALLBACK_PACK.id,
        asset_count: pack.assets.length,
        missing_on_disk: pack.assets.filter((a) => !a.exists).length,
        assets: pack.assets.map((a) => ({
          role: a.role,
          filename: a.filename,
          duration_ms: a.duration_ms,
          exists: a.exists,
        })),
      };
    });
    res.json({ packs, generated_at: new Date().toISOString() });
  } catch (err) {
    console.error(`[server] /api/audio-packs error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Blog rebuild endpoint ---
app.post(
  "/api/blog/rebuild",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    res.json({ status: "started", message: "Blog rebuild initiated" });

    try {
      const { build } = require("./blog/build");
      await build();
      console.log("[server] Blog rebuild complete");
    } catch (err) {
      console.log(`[server] Blog rebuild error: ${err.message}`);
    }
  },
);

// --- Weekly compilation endpoints ---
let weeklyCompilationState = {
  status: "idle",
  last_compiled: null,
  error: null,
};

app.post(
  "/api/weekly/compile",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    if (weeklyCompilationState.status === "running") {
      return res.json({
        status: "already running",
        message: "Weekly compilation is already in progress",
      });
    }

    weeklyCompilationState = {
      status: "running",
      started_at: new Date().toISOString(),
      error: null,
    };
    res.json({ status: "started", message: "Weekly compilation initiated" });

    try {
      const { compileWeekly } = require("./weekly_compile");
      const result = await compileWeekly();
      weeklyCompilationState = {
        status: result ? "complete" : "skipped",
        last_compiled: new Date().toISOString(),
        result: result || null,
        error: null,
      };
    } catch (err) {
      console.log(`[server] Weekly compilation error: ${err.message}`);
      weeklyCompilationState = {
        status: "error",
        last_compiled: null,
        error: err.message,
      };
    }
  },
);

app.get("/api/weekly/status", requireAuth, async (req, res) => {
  let compilationData = null;
  try {
    const compilationPath = path.join(__dirname, "weekly_compilation.json");
    if (await fs.pathExists(compilationPath)) {
      compilationData = await fs.readJson(compilationPath);
    }
  } catch (err) {
    /* skip */
  }

  res.json({
    ...weeklyCompilationState,
    last_compilation: compilationData,
  });
});

// --- Topic compilation endpoints ---
let topicCompilationState = { status: "idle", topic: null, error: null };

app.post(
  "/api/compile/topic",
  requireAuth,
  rateLimit(5, 60000),
  async (req, res) => {
    const { topic } = req.body;
    if (!topic || typeof topic !== "string" || !topic.trim()) {
      return res.status(400).json({ error: "topic string required" });
    }

    if (topicCompilationState.status === "running") {
      return res.json({
        status: "already running",
        topic: topicCompilationState.topic,
      });
    }

    const topicName = topic.trim();
    topicCompilationState = {
      status: "running",
      topic: topicName,
      started_at: new Date().toISOString(),
      error: null,
    };
    res.json({ status: "started", topic: topicName });

    try {
      const { compileByTopic } = require("./weekly_compile");
      const result = await compileByTopic(topicName);
      topicCompilationState = {
        status: result ? "complete" : "skipped",
        topic: topicName,
        last_compiled: new Date().toISOString(),
        result: result || null,
        error: null,
      };
    } catch (err) {
      console.log(
        `[server] Topic compilation error (${topicName}): ${err.message}`,
      );
      topicCompilationState = {
        status: "error",
        topic: topicName,
        last_compiled: null,
        error: err.message,
      };
    }
  },
);

app.get("/api/compile/topics", requireAuth, async (req, res) => {
  try {
    const { identifyCompilableTopics } = require("./weekly_compile");
    const days = parseInt(req.query.days, 10) || 30;
    const topics = await identifyCompilableTopics(days);
    res.json({ days, topics });
  } catch (err) {
    console.log(`[server] Compilable topics error: ${err.message}`);
    console.error(`[server] Internal error: ${err.message}`);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- Railway deploy webhook - forwards build/deploy failures to Discord ---
app.post("/api/webhook/railway", rateLimit(30, 60000), async (req, res) => {
  res.json({ ok: true });
  try {
    const sendDiscord = require("./notify");
    const payload = req.body || {};
    const status = payload.status || payload.type || "unknown";
    const service =
      payload.service?.name || payload.meta?.serviceName || "Pulse Gaming";

    if (
      ["FAILED", "CRASHED", "REMOVED", "BUILD_FAILED"].includes(
        status.toUpperCase(),
      ) ||
      (payload.type === "deploy" && payload.status === "FAILED")
    ) {
      const error =
        payload.error || payload.meta?.error || "No details provided";
      await sendDiscord(
        `**Railway Deploy FAILED**\n` +
          `Service: ${service}\n` +
          `Status: ${status}\n` +
          `Error: ${error}\n\n` +
          `Check Railway dashboard for details.`,
      );
    } else if (
      status.toUpperCase() === "SUCCESS" ||
      status.toUpperCase() === "DEPLOYED"
    ) {
      await sendDiscord(
        `**Railway Deploy OK** - ${service} deployed successfully`,
      );
    }
  } catch (err) {
    console.log(`[server] Railway webhook error: ${err.message}`);
  }
});

// Sentry error handler (must be after all routes, before SPA fallback)
if (sentryMw.errorHandler === "__sentry_v8__") {
  setupErrorHandler(app);
} else {
  app.use(sentryMw.errorHandler);
}

// --- SPA fallback ---
app.get("/{*splat}", (req, res) => {
  const indexPath = path.join(__dirname, "dist", "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    const pubIndex = path.join(__dirname, "public", "index.html");
    if (fs.existsSync(pubIndex)) {
      res.sendFile(pubIndex);
    } else {
      res.status(404).send("Frontend not built. Run: npm run build");
    }
  }
});

const server = app.listen(PORT, () => {
  console.log(
    `[server] Pulse Gaming Command Centre v2 running on http://localhost:${PORT}`,
  );

  // Notify Discord on successful deploy (Railway restarts the process on each deploy)
  (async () => {
    try {
      const sendDiscord = require("./notify");
      const deployId = process.env.RAILWAY_DEPLOYMENT_ID || "local";
      const commitRef =
        process.env.RAILWAY_GIT_COMMIT_SHA?.substring(0, 7) || "dev";
      await sendDiscord(
        `**Railway Deploy OK**\n` +
          `Service: Pulse Gaming\n` +
          `Commit: ${commitRef}\n` +
          `Deploy: ${deployId}`,
      );
    } catch (e) {
      /* silent */
    }
  })();

  startAutonomousScheduler().catch((err) => {
    console.log(`[server] Autonomous scheduler startup error: ${err.message}`);
  });

  // Start Discord bot alongside the server
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID) {
    try {
      const botProcess = spawn("node", ["discord/bot.js"], {
        cwd: __dirname,
        stdio: "inherit",
        env: process.env,
      });
      botProcess.on("error", (err) => {
        console.log(`[server] Discord bot failed to start: ${err.message}`);
      });
      botProcess.on("exit", (code) => {
        if (code !== 0)
          console.log(`[server] Discord bot exited with code ${code}`);
      });
      console.log("[server] Discord bot started");
    } catch (err) {
      console.log(`[server] Discord bot error: ${err.message}`);
    }
  } else {
    console.log(
      "[server] Discord bot skipped - DISCORD_BOT_TOKEN or DISCORD_GUILD_ID not set",
    );
  }
});

// --- Graceful shutdown: flush SQLite WAL and close connections ---
function gracefulShutdown(signal) {
  console.log(`[server] ${signal} received. Shutting down gracefully...`);

  // Stop the hunter interval
  if (hunterInterval) {
    clearTimeout(hunterInterval);
    clearInterval(hunterInterval);
    hunterInterval = null;
  }

  // Flush and close SQLite
  try {
    const db = require("./lib/db");
    if (db.close) {
      db.close();
      console.log("[server] SQLite connections closed and WAL flushed");
    }
  } catch (err) {
    console.log(`[server] DB close error: ${err.message}`);
  }

  server.close(() => {
    console.log("[server] HTTP server closed");
    console.log("[server] Graceful shutdown complete");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[server] Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
}
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

module.exports = { broadcastProgress };
