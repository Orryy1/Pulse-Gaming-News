/**
 * Discord + Web approval workflow.
 *
 * Flow:
 *   1. Starts approval web server (accessible from phone)
 *   2. Sends stories to Discord with direct approval links
 *   3. User taps links on phone → approves stories + picks images
 *   4. User taps "Produce" → pipeline auto-runs
 *
 * The approval page works on any device — no need for same WiFi if using
 * a tunnel (ngrok, cloudflare tunnel, etc.)
 *
 * Requires: DISCORD_WEBHOOK_URL in .env
 */
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");
const http = require("http");
const os = require("os");
const dotenv = require("dotenv");
const db = require("./lib/db");

dotenv.config({ override: true });

/**
 * Apply the operator's approval choice to a story and persist it via the
 * canonical SQLite-backed path. Extracted from the `/api/approve` handler
 * so the Phase C-aligned persistence behaviour has a testable surface
 * without spinning up an HTTP server.
 *
 * Returns the updated story on success, or null if the id was not found.
 * On error, throws — the HTTP layer catches and maps to a generic 400.
 *
 * Why this wraps db.upsertStory instead of a fs.writeJson:
 *   - Under USE_SQLITE=true this becomes a single-row upsert on the
 *     stories table (no full-file rewrite, no JSON growth footgun).
 *   - Under USE_SQLITE!=true it falls back to the exact pre-patch
 *     read-mutate-write-JSON behaviour via db.upsertStory's legacy
 *     branch, so dev loops without a DB still work.
 */
async function applyApproval(
  storyId,
  { imageIndex, titleIndex } = {},
  { dbHandle = db } = {},
) {
  if (!storyId) throw new Error("storyId required");
  const story = await dbHandle.getStory(storyId);
  if (!story) return null;

  story.approved = true;
  if (imageIndex !== undefined && story.candidate_images?.[imageIndex]) {
    story.selected_image = story.candidate_images[imageIndex].path;
    // Also set as primary background so the produce pipeline picks it up
    // without the operator having to reselect.
    story.background_images = [story.candidate_images[imageIndex].path];
  }
  if (titleIndex !== undefined && story.title_options?.[titleIndex]) {
    story.selected_title = story.title_options[titleIndex];
  }
  await dbHandle.upsertStory(story);
  return story;
}

/** Symmetric reject helper. See applyApproval for the persistence
 * contract. */
async function applyRejection(storyId, { dbHandle = db } = {}) {
  if (!storyId) throw new Error("storyId required");
  const story = await dbHandle.getStory(storyId);
  if (!story) return null;
  story.approved = false;
  await dbHandle.upsertStory(story);
  return story;
}

const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const APPROVAL_PORT = parseInt(process.env.APPROVAL_PORT || "3002");
// Default to loopback. The old 0.0.0.0 bind exposed an unauthenticated
// mutation API (/api/approve, /api/reject, /api/produce) to everyone on
// the local network. Set APPROVAL_BIND_EXTERNAL=true to opt in to LAN
// reach for the phone-approval flow (requires same WiFi).
const BIND_EXTERNAL = process.env.APPROVAL_BIND_EXTERNAL === "true";
const BIND_HOST = BIND_EXTERNAL ? "0.0.0.0" : "127.0.0.1";

/**
 * Get the local network IP so we can share with phone.
 */
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

/**
 * Upload an image to Discord via webhook and return the attachment URL.
 */
async function uploadImageToDiscord(imagePath, filename) {
  const FormData = require("form-data");
  const form = new FormData();
  form.append("file", fs.createReadStream(imagePath), filename);

  const response = await axios.post(WEBHOOK_URL + "?wait=true", form, {
    headers: form.getHeaders(),
  });

  const attachments = response.data.attachments || [];
  return attachments[0]?.url || null;
}

/**
 * Send a story to Discord with approval link and candidate images.
 */
async function sendStoryToDiscord(story, index, baseUrl) {
  const flairColour =
    story.flair === "Verified"
      ? 0x10b981
      : story.flair === "Highly Likely"
        ? 0xf59e0b
        : 0xf97316;

  // Upload first candidate image as embed thumbnail
  let imageUrl = null;
  const candidates = story.candidate_images || [];
  if (candidates.length > 0 && (await fs.pathExists(candidates[0].path))) {
    imageUrl = await uploadImageToDiscord(
      candidates[0].path,
      `story${index + 1}.jpg`,
    );
  }

  // Build title options text
  const titleOptions = story.title_options?.length
    ? story.title_options.map((t, i) => `**${i + 1}.** ${t}`).join("\n")
    : `**1.** ${story.title}`;

  const approveUrl = `${baseUrl}/approve/${story.id}`;

  const embed = {
    title: `📰 Story ${index + 1}: ${story.title.substring(0, 200)}`,
    description: [
      `**Flair:** ${story.flair} | **Score:** ${story.score} | **Comments:** ${story.num_comments}`,
      `**Source:** r/${story.subreddit}`,
      "",
      "**📝 Title Options:**",
      titleOptions,
      "",
      "**🎬 Script Preview:**",
      `> ${(story.hook || "").substring(0, 150)}`,
      `> ${(story.body || story.full_script || "").substring(0, 250)}...`,
      "",
      candidates.length > 0
        ? `🖼️ **${candidates.length} AI images generated** — pick your favourite on the approval page`
        : "",
      "",
      `**👉 [TAP TO REVIEW & APPROVE](${approveUrl})**`,
    ].join("\n"),
    color: flairColour,
    footer: { text: `Story ID: ${story.id} | Pulse Gaming` },
    timestamp: new Date().toISOString(),
  };

  if (imageUrl) {
    embed.image = { url: imageUrl };
  }

  await axios.post(WEBHOOK_URL + "?wait=true", { embeds: [embed] });
  await new Promise((r) => setTimeout(r, 1000));
}

/**
 * Start the approval web server and send stories to Discord.
 */
async function sendForApproval() {
  console.log("[discord] Loading stories from canonical store...");

  // Phase C: read via the canonical persistence surface. Under
  // USE_SQLITE=true this hits the stories table directly; under JSON
  // mode it falls back to daily_news.json exactly as before.
  const stories = await db.getStories();
  if (!Array.isArray(stories) || stories.length === 0) {
    console.log(
      "[discord] ERROR: no stories found (SQLite empty or daily_news.json missing).",
    );
    return;
  }

  // Start server first so we have the URL.
  // Honour the bind setting — if we're loopback-only the LAN IP link
  // won't work from a phone, so prefer a configured tunnel URL or
  // localhost instead of sending a dead link to Discord.
  const tunnel = process.env.APPROVAL_PUBLIC_URL;
  let baseUrl;
  if (tunnel) {
    baseUrl = tunnel.replace(/\/$/, "");
  } else if (BIND_EXTERNAL) {
    const localIP = getLocalIP();
    baseUrl = `http://${localIP}:${APPROVAL_PORT}`;
  } else {
    baseUrl = `http://localhost:${APPROVAL_PORT}`;
  }

  const server = await startApprovalServer();

  console.log(`[discord] Approval page ready: ${baseUrl}`);

  const toSend = stories.filter((s) => s.full_script).slice(0, 10);

  console.log(`[discord] Sending ${toSend.length} stories to Discord...`);

  // Header message with approval page link
  await axios.post(WEBHOOK_URL, {
    content: [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      "**🎮 PULSE GAMING — DAILY STORY APPROVAL**",
      `📅 **${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}**`,
      `${toSend.length} stories ready for review.`,
      "",
      `📱 **Open approval page:** ${baseUrl}`,
      "Tap each story below to review, or use the approval page to see all images and approve.",
      "",
      "When done approving, tap **PRODUCE** on the approval page to start the pipeline.",
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n"),
  });

  await new Promise((r) => setTimeout(r, 1500));

  for (let i = 0; i < toSend.length; i++) {
    console.log(
      `[discord] Sending story ${i + 1}/${toSend.length}: ${toSend[i].title.substring(0, 50)}...`,
    );
    await sendStoryToDiscord(toSend[i], i, baseUrl);
  }

  // Final message with produce link
  await axios.post(WEBHOOK_URL, {
    content: [
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      `✅ All ${toSend.length} stories sent.`,
      `📱 **Approve & produce:** ${baseUrl}`,
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    ].join("\n"),
  });

  console.log("[discord] All stories sent to Discord!");
  console.log(`[discord] Approval page: ${baseUrl}`);
  console.log(`[discord] Also try: http://localhost:${APPROVAL_PORT}`);
}

/**
 * Mobile-friendly approval web server.
 */
async function startApprovalServer() {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url, `http://localhost:${APPROVAL_PORT}`);
    const pathname = parsedUrl.pathname;

    // CORS headers for all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // API: Get all stories — reads from the canonical persistence surface
    // (SQLite when USE_SQLITE=true, daily_news.json as the dev fallback).
    if (pathname === "/api/stories") {
      try {
        const data = await db.getStories();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            (Array.isArray(data) ? data : [])
              .filter((s) => s.full_script)
              .slice(0, 10),
          ),
        );
      } catch (err) {
        console.error(`[approve] /api/stories failed: ${err.message}`);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // API: Approve a story. Phase C: persists via db.upsertStory so
    // SQLite is the durable record; legacy JSON writes are handled by
    // the upsertStory fallback only when USE_SQLITE is off.
    if (pathname === "/api/approve" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { storyId, imageIndex, titleIndex } = JSON.parse(body);
          const story = await applyApproval(storyId, {
            imageIndex,
            titleIndex,
          });
          if (story) {
            console.log(
              `[approve] ✅ Approved: ${(story.title || "").substring(0, 50)}`,
            );
            // Notify Discord (best-effort)
            try {
              await axios.post(WEBHOOK_URL, {
                content: `✅ **Approved:** ${story.selected_title || story.title}`,
              });
            } catch (e) {
              /* ignore */
            }
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          // Log the real reason server-side; never leak err.message to the
          // client — it can expose FS paths or parser internals.
          console.error(`[approve] approve failed: ${err.message}`);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request" }));
        }
      });
      return;
    }

    // API: Reject a story. Same persistence contract as approve.
    if (pathname === "/api/reject" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", async () => {
        try {
          const { storyId } = JSON.parse(body);
          const story = await applyRejection(storyId);
          if (story) {
            console.log(
              `[approve] ❌ Skipped: ${(story.title || "").substring(0, 50)}`,
            );
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          console.error(`[approve] reject failed: ${err.message}`);
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Bad request" }));
        }
      });
      return;
    }

    // API: Trigger production pipeline
    if (pathname === "/api/produce" && req.method === "POST") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "Pipeline triggered" }));

      console.log("[approve] 🚀 Production pipeline triggered!");
      await axios
        .post(WEBHOOK_URL, {
          content:
            "🚀 **Production pipeline started!** Videos will be uploaded when ready.",
        })
        .catch(() => {});

      const { exec } = require("child_process");
      exec(
        "node run.js produce",
        { cwd: __dirname },
        async (err, stdout, stderr) => {
          if (err) {
            // Log the full error locally, but keep the Discord notification
            // generic — webhook contents are visible to anyone with the URL.
            console.error("[approve] Produce error:", err.message);
            await axios
              .post(WEBHOOK_URL, {
                content: `❌ **Production failed.** Check server logs for details.`,
              })
              .catch(() => {});
          } else {
            console.log("[approve] Produce complete!");
            await axios
              .post(WEBHOOK_URL, {
                content:
                  "✅ **Production complete!** Videos uploaded to YouTube.",
              })
              .catch(() => {});
          }
        },
      );
      return;
    }

    // Serve candidate images
    if (pathname.startsWith("/images/")) {
      const imgPath = path.join(
        "output",
        "images",
        pathname.replace("/images/", ""),
      );
      if (await fs.pathExists(imgPath)) {
        const ext = path.extname(imgPath).toLowerCase();
        const mime =
          ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
        res.writeHead(200, {
          "Content-Type": mime,
          "Cache-Control": "max-age=3600",
        });
        fs.createReadStream(imgPath).pipe(res);
        return;
      }
    }

    // Quick-approve URL from Discord (GET /approve/:id)
    const approveMatch = pathname.match(/^\/approve\/(\w+)$/);
    if (approveMatch) {
      // Redirect to the main page with the story pre-selected
      res.writeHead(302, { Location: `/?highlight=${approveMatch[1]}` });
      res.end();
      return;
    }

    // Serve approval page
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(getApprovalHTML());
  });

  return new Promise((resolve) => {
    server.listen(APPROVAL_PORT, BIND_HOST, () => {
      const localIP = getLocalIP();
      console.log(`[discord] Approval server running (bind=${BIND_HOST}):`);
      console.log(`[discord]   Local:   http://localhost:${APPROVAL_PORT}`);
      if (BIND_EXTERNAL) {
        console.log(`[discord]   Network: http://${localIP}:${APPROVAL_PORT}`);
        console.log(
          `[discord]   (Open the Network URL on your phone — same WiFi required)`,
        );
      } else {
        console.log(
          `[discord]   LAN access disabled. Set APPROVAL_BIND_EXTERNAL=true to expose on ${localIP}.`,
        );
      }
      resolve(server);
    });
  });
}

function getApprovalHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Pulse Gaming — Approve</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body { background: #0a1628; color: #fff; font-family: -apple-system, Inter, system-ui, sans-serif; padding: 12px; padding-bottom: 100px; }
  h1 { color: #39FF14; font-size: 18px; text-align: center; margin: 12px 0 4px; letter-spacing: 3px; font-weight: 900; }
  .sub { text-align: center; color: rgba(255,255,255,0.35); font-size: 12px; margin-bottom: 16px; }
  .count-bar { display: flex; justify-content: center; gap: 16px; margin-bottom: 16px; font-size: 13px; }
  .count-bar span { padding: 6px 14px; border-radius: 20px; }
  .c-approved { background: rgba(57,255,20,0.1); color: #39FF14; }
  .c-pending { background: rgba(255,255,255,0.05); color: rgba(255,255,255,0.4); }

  .story { background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 16px; margin-bottom: 16px; overflow: hidden; transition: all 0.3s; }
  .story.approved { border-color: #39FF14; background: rgba(57,255,20,0.03); }
  .story.rejected { opacity: 0.3; max-height: 60px; overflow: hidden; }
  .story-header { padding: 14px 16px 8px; }
  .flair { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; }
  .flair-verified { background: rgba(16,185,129,0.15); color: #10B981; }
  .flair-likely { background: rgba(245,158,11,0.15); color: #F59E0B; }
  .flair-rumour { background: rgba(249,115,22,0.15); color: #F97316; }
  .flair-news { background: rgba(59,130,246,0.15); color: #3B82F6; }
  .story-title { font-size: 15px; font-weight: 700; margin: 8px 0; line-height: 1.35; }
  .story-meta { font-size: 11px; color: rgba(255,255,255,0.3); }
  .story-score { color: #39FF14; font-weight: 700; }

  .section-label { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.25); padding: 8px 16px 4px; }

  .titles { padding: 0 16px 8px; }
  .title-opt { padding: 10px 12px; margin: 4px 0; border-radius: 10px; background: rgba(255,255,255,0.03); border: 1.5px solid transparent; cursor: pointer; font-size: 13px; line-height: 1.3; transition: all 0.2s; }
  .title-opt.selected { border-color: #39FF14; background: rgba(57,255,20,0.06); }
  .title-opt:active { transform: scale(0.98); }

  .script-preview { font-size: 12px; color: rgba(255,255,255,0.5); line-height: 1.5; padding: 8px 16px; background: rgba(0,0,0,0.2); margin: 0 12px; border-radius: 10px; }

  .images-row { display: flex; gap: 8px; padding: 12px 16px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .img-opt { position: relative; flex-shrink: 0; width: 110px; height: 196px; border-radius: 12px; overflow: hidden; border: 2.5px solid transparent; cursor: pointer; transition: all 0.2s; }
  .img-opt.selected { border-color: #39FF14; box-shadow: 0 0 20px rgba(57,255,20,0.2); }
  .img-opt:active { transform: scale(0.95); }
  .img-opt img { width: 100%; height: 100%; object-fit: cover; }
  .img-num { position: absolute; top: 6px; right: 6px; background: rgba(0,0,0,0.7); color: #fff; font-size: 11px; font-weight: 700; width: 22px; height: 22px; border-radius: 11px; display: flex; align-items: center; justify-content: center; }

  .actions { display: flex; gap: 8px; padding: 12px 16px; }
  .btn { flex: 1; padding: 14px; border: none; border-radius: 12px; font-size: 14px; font-weight: 700; cursor: pointer; transition: all 0.15s; }
  .btn:active { transform: scale(0.97); }
  .btn-approve { background: #39FF14; color: #0a1628; }
  .btn-approve.done { background: rgba(57,255,20,0.2); color: #39FF14; }
  .btn-skip { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.4); }

  .produce-bar { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px 16px; background: linear-gradient(transparent, #0a1628 30%); padding-top: 30px; }
  .produce-btn { width: 100%; padding: 16px; background: #39FF14; color: #0a1628; border: none; border-radius: 14px; font-size: 16px; font-weight: 900; letter-spacing: 2px; cursor: pointer; transition: all 0.15s; }
  .produce-btn:active { transform: scale(0.98); }
  .produce-btn:disabled { opacity: 0.25; }
  .produce-btn.running { background: rgba(57,255,20,0.2); color: #39FF14; animation: pulse 1.5s ease infinite; }
  @keyframes pulse { 0%,100% { opacity: 0.6; } 50% { opacity: 1; } }

  .highlight { animation: flash 1s ease; }
  @keyframes flash { 0% { box-shadow: 0 0 30px rgba(57,255,20,0.5); } 100% { box-shadow: none; } }
</style>
</head>
<body>
<h1>PULSE GAMING</h1>
<p class="sub">Tap to approve stories &amp; pick images</p>
<div class="count-bar">
  <span class="c-approved" id="approvedCount">0 approved</span>
  <span class="c-pending" id="pendingCount">loading...</span>
</div>
<div id="stories"></div>
<div class="produce-bar">
  <button class="produce-btn" id="produceBtn" disabled onclick="produce()">PRODUCE & UPLOAD</button>
</div>

<script>
let stories = [];
let selections = {};

// Check URL for highlight param
const params = new URLSearchParams(location.search);
const highlightId = params.get('highlight');

async function load() {
  const res = await fetch('/api/stories');
  stories = await res.json();
  // Restore any previously approved stories
  stories.forEach(s => {
    if (s.approved === true) selections[s.id] = { approved: true, imageIndex: 0, titleIndex: 0 };
  });
  render();
  if (highlightId) {
    setTimeout(() => {
      const el = document.getElementById('s-' + highlightId);
      if (el) { el.classList.add('highlight'); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 300);
  }
}

function render() {
  const approved = Object.values(selections).filter(s => s.approved).length;
  const total = stories.length;
  document.getElementById('approvedCount').textContent = approved + ' approved';
  document.getElementById('pendingCount').textContent = (total - approved) + ' pending';
  document.getElementById('produceBtn').disabled = approved === 0;

  document.getElementById('stories').innerHTML = stories.map((s, idx) => {
    const sel = selections[s.id] || {};
    const isApproved = sel.approved === true;
    const isRejected = sel.approved === false;
    const flair = s.flair || '';
    const flairClass = flair.includes('Verified') ? 'verified' : flair.includes('Highly Likely') ? 'likely' : flair.includes('Rumour') || flair.includes('Rumor') ? 'rumour' : 'news';
    const candidates = s.candidate_images || [];
    const titles = s.title_options || [s.title];

    return '<div class="story ' + (isApproved ? 'approved' : isRejected ? 'rejected' : '') + '" id="s-' + s.id + '">' +
      '<div class="story-header">' +
        '<span class="flair flair-' + flairClass + '">' + esc(flair || 'News') + '</span>' +
        '<div class="story-title">' + esc(s.title) + '</div>' +
        '<div class="story-meta">r/' + esc(s.subreddit) + ' · <span class="story-score">' + s.score + '</span> upvotes · ' + s.num_comments + ' comments</div>' +
      '</div>' +

      '<div class="section-label">Pick title</div>' +
      '<div class="titles">' +
        titles.map((t, ti) =>
          '<div class="title-opt ' + (sel.titleIndex === ti ? 'selected' : '') + '" onclick="pickTitle(\\'' + s.id + '\\',' + ti + ')">' + esc(t) + '</div>'
        ).join('') +
      '</div>' +

      '<div class="section-label">Script preview</div>' +
      '<div class="script-preview">' + esc((s.hook || '') + ' ' + (s.body || s.full_script || '').substring(0, 250)) + '...</div>' +

      (candidates.length > 0 ? (
        '<div class="section-label">Pick image (' + candidates.length + ' options)</div>' +
        '<div class="images-row">' +
          candidates.map((c, ci) =>
            '<div class="img-opt ' + (sel.imageIndex === ci ? 'selected' : '') + '" onclick="pickImage(\\'' + s.id + '\\',' + ci + ')">' +
              '<img src="/images/' + s.id + '/candidates/candidate_' + ci + '.jpg" loading="lazy"/>' +
              '<span class="img-num">' + (ci + 1) + '</span>' +
            '</div>'
          ).join('') +
        '</div>'
      ) : '') +

      '<div class="actions">' +
        '<button class="btn btn-approve ' + (isApproved ? 'done' : '') + '" onclick="approve(\\'' + s.id + '\\')">' + (isApproved ? '✅ APPROVED' : '✅ APPROVE') + '</button>' +
        '<button class="btn btn-skip" onclick="reject(\\'' + s.id + '\\')">SKIP</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function pickTitle(id, idx) {
  if (!selections[id]) selections[id] = {};
  selections[id].titleIndex = idx;
  render();
}

function pickImage(id, idx) {
  if (!selections[id]) selections[id] = {};
  selections[id].imageIndex = idx;
  render();
}

async function approve(id) {
  const sel = selections[id] || { titleIndex: 0, imageIndex: 0 };
  selections[id] = { ...sel, approved: true };
  render();
  await fetch('/api/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyId: id, imageIndex: sel.imageIndex || 0, titleIndex: sel.titleIndex || 0 }),
  });
}

async function reject(id) {
  selections[id] = { approved: false };
  render();
  await fetch('/api/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storyId: id }),
  });
}

async function produce() {
  const count = Object.values(selections).filter(s => s.approved).length;
  if (!confirm('Produce ' + count + ' approved stories and upload to YouTube?')) return;
  const btn = document.getElementById('produceBtn');
  btn.textContent = 'PRODUCING...';
  btn.classList.add('running');
  btn.disabled = true;
  await fetch('/api/produce', { method: 'POST' });
}

load();
</script>
</body>
</html>`;
}

module.exports = {
  sendForApproval,
  startApprovalServer,
  applyApproval,
  applyRejection,
};

if (require.main === module) {
  const mode = process.argv[2];
  if (mode === "server") {
    startApprovalServer();
  } else {
    sendForApproval().catch((err) => {
      console.log(`[discord] ERROR: ${err.message}`);
      process.exit(1);
    });
  }
}
