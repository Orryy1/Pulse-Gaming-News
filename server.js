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
const PUBLIC_DIR = path.join(__dirname, "public", "generated");

fs.ensureDirSync(PUBLIC_DIR);

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
function requireAuth(req, res, next) {
  // Skip auth if no API_TOKEN configured (backwards compat for local dev)
  const secret = process.env.API_TOKEN;
  if (!secret) return next();

  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
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
app.use("/generated", express.static(PUBLIC_DIR));
app.use("/branding", express.static(path.join(__dirname, "branding")));

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
app.get("/auth/tiktok/callback", async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error) {
    console.log(`[tiktok] OAuth error: ${error} - ${error_description}`);
    return res
      .status(400)
      .send(
        `<h1>TikTok Auth Error</h1><p>${escapeHtml(error)}: ${escapeHtml(error_description)}</p>`,
      );
  }

  if (!code) {
    return res.status(400).send("<h1>Missing auth code</h1>");
  }

  try {
    const { exchangeCode } = require("./upload_tiktok");
    const tokenData = await exchangeCode(code);
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
function readNews() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, "utf-8");
  return JSON.parse(raw);
}

function writeNews(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  // When SQLite is enabled, keep the database in sync
  if (db.useSqlite()) {
    try {
      db.saveStories(data);
    } catch (err) {
      console.log(`[server] SQLite sync error: ${err.message}`);
    }
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
  res.json({
    status: "ok",
    version: "v2.2.0",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    hunterActive: !!hunterInterval,
    autonomousMode: process.env.AUTO_PUBLISH === "true",
    schedulerActive: schedulerRunning,
    circuitBreakers,
  });
});

app.get("/api/news", (req, res) => {
  try {
    const stories = readNews();
    res.json(Array.isArray(stories) ? stories : []);
  } catch (err) {
    console.log(`[server] ERROR reading news: ${err.message}`);
    res.json([]);
  }
});

app.get("/api/progress", (req, res) => {
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

app.get("/api/publish-status", (req, res) => {
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
      const count = await autoApprove();
      res.json({ status: "ok", approved: count });
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
app.get("/api/autonomous/status", (req, res) => {
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
app.get("/api/platforms/status", async (req, res) => {
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

  // TikTok
  try {
    status.tiktok.configured = !!process.env.TIKTOK_CLIENT_KEY;
    status.tiktok.authenticated = await fs.pathExists(
      path.join(__dirname, "tokens", "tiktok_token.json"),
    );
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

// --- Story image download (for Instagram Stories) ---
app.get("/api/story-image/:id", async (req, res) => {
  try {
    const stories = readNews();
    const story = stories.find((s) => s.id === req.params.id);
    if (!story || !story.story_image_path) {
      return res.status(404).json({ error: "story image not found" });
    }
    const filePath = path.resolve(story.story_image_path);
    const allowedBase = path.resolve(__dirname, "output");
    if (
      !filePath.startsWith(allowedBase + path.sep) &&
      filePath !== allowedBase
    ) {
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

// Serve story images directory for easy browsing
app.use("/stories", express.static(path.join(__dirname, "output", "stories")));

// --- Download ---
app.get("/api/download/:id", async (req, res) => {
  try {
    const stories = readNews();
    const story = stories.find((s) => s.id === req.params.id);

    if (!story || !story.exported_path) {
      return res.status(404).json({ error: "video not found" });
    }

    const filePath = path.resolve(story.exported_path);
    const allowedBase = path.resolve(__dirname, "output");
    if (
      !filePath.startsWith(allowedBase + path.sep) &&
      filePath !== allowedBase
    ) {
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

    if (platform === "youtube") {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey || apiKey === "placeholder") {
        return res.json({ views: 0, note: "YouTube API key not configured" });
      }
      try {
        const ytRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(req.params.postId)}&key=${encodeURIComponent(apiKey)}`,
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
      // Write new posts to pending_news.json for processor
      await fs.writeJson(
        "pending_news.json",
        { timestamp: new Date().toISOString(), stories: newPosts },
        { spaces: 2 },
      );
      await process_stories();

      // Merge newly processed stories with existing
      const processed = readNews();
      if (existingStories.length > 0 && processed.length > 0) {
        const merged = [...processed, ...existingStories];
        writeNews(merged);
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

app.get("/api/hunter/status", (req, res) => {
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
app.get("/api/watcher/status", (req, res) => {
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

app.get("/api/analytics/overview", async (req, res) => {
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

app.get("/api/analytics/topics", async (req, res) => {
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

app.get("/api/analytics/history", async (req, res) => {
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
app.get("/api/analytics/optimal-timing", async (req, res) => {
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

// --- Blog static site ---
app.use("/blog", express.static(path.join(__dirname, "blog", "dist")));

// --- Engagement stats endpoint ---
app.get("/api/engagement/stats", async (req, res) => {
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

app.get("/api/weekly/status", async (req, res) => {
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

app.get("/api/compile/topics", async (req, res) => {
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
