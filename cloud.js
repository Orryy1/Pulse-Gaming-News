/**
 * Unified cloud entry point for Railway/Render deployment.
 *
 * Runs:
 *   1. Express API server (dashboard + approval page)
 *   2. Cron scheduler (auto-hunt at 6AM GMT daily)
 *   3. Approval endpoints (accessible from phone anywhere)
 *
 * All in one process, one port.
 */
const cron = require("node-cron");
const fs = require("fs-extra");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const PORT = parseInt(process.env.PORT || "3001");

// Fail closed: cloud.js is the Railway entrypoint (see Dockerfile CMD).
// Without API_TOKEN every mutation route below (approve/reject/produce/hunt)
// would be world-writable, which means anyone can shell-exec `node run.js
// produce` and burn paid API credit. Local dev keeps the bypass.
const IS_PRODUCTION =
  process.env.NODE_ENV === "production" ||
  !!process.env.RAILWAY_ENVIRONMENT ||
  !!process.env.RAILWAY_PUBLIC_URL;
if (IS_PRODUCTION && !process.env.API_TOKEN) {
  console.error(
    "[cloud] FATAL: API_TOKEN is required in production. Refusing to start.",
  );
  process.exit(1);
}

function requireAuth(req, res, next) {
  const secret = process.env.API_TOKEN;
  if (!secret) return next(); // dev bypass only — startup guard blocks prod
  // Accept either Bearer header or ?token= query (for Discord approval links
  // opened from a phone, where setting a header is awkward).
  const header = req.headers.authorization?.replace("Bearer ", "");
  const queryToken =
    typeof req.query.token === "string" ? req.query.token : null;
  const supplied = header || queryToken;
  if (supplied !== secret) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

async function startServer() {
  // Dynamically require server.js which sets up Express
  const express = require("express");
  const cors = require("cors");
  const http = require("http");
  const os = require("os");

  const app = express();
  app.use(cors());
  app.use(express.json());

  const PUBLIC_URL =
    process.env.RAILWAY_PUBLIC_URL || `http://localhost:${PORT}`;

  // ===== Approval Page Endpoints =====

  // Serve candidate images
  app.get("/images/:storyId/:folder/:file", async (req, res) => {
    const imgPath = path.join(
      "output",
      "images",
      req.params.storyId,
      req.params.folder,
      req.params.file,
    );
    if (await fs.pathExists(imgPath)) {
      const ext = path.extname(imgPath).toLowerCase();
      const mime =
        ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      res.type(mime).sendFile(path.resolve(imgPath));
    } else {
      res.status(404).send("Not found");
    }
  });

  // API: Get stories for approval (auth — returns full scripts, sensitive)
  app.get("/api/stories", requireAuth, async (req, res) => {
    try {
      if (!(await fs.pathExists("daily_news.json"))) return res.json([]);
      const data = await fs.readJson("daily_news.json");
      res.json(data.filter((s) => s.full_script).slice(0, 10));
    } catch (err) {
      console.error("[cloud] /api/stories failed:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // API: Approve a story (mutation — auth required)
  app.post("/api/approve", requireAuth, async (req, res) => {
    try {
      const { storyId, imageIndex, titleIndex } = req.body;
      const data = await fs.readJson("daily_news.json");
      const story = data.find((s) => s.id === storyId);
      if (story) {
        story.approved = true;
        if (imageIndex !== undefined && story.candidate_images?.[imageIndex]) {
          story.selected_image = story.candidate_images[imageIndex].path;
          story.background_images = [story.candidate_images[imageIndex].path];
        }
        if (titleIndex !== undefined && story.title_options?.[titleIndex]) {
          story.selected_title = story.title_options[titleIndex];
        }
        await fs.writeJson("daily_news.json", data, { spaces: 2 });
        console.log(`[cloud] ✅ Approved: ${story.title.substring(0, 50)}`);

        // Notify Discord
        const sendDiscord = require("./notify");
        await sendDiscord(
          `✅ **Approved:** ${story.selected_title || story.title}`,
        ).catch(() => {});
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[cloud] /api/approve failed:", err.message);
      res.status(400).json({ error: "Bad request" });
    }
  });

  // API: Reject a story (mutation — auth required)
  app.post("/api/reject", requireAuth, async (req, res) => {
    try {
      const { storyId } = req.body;
      const data = await fs.readJson("daily_news.json");
      const story = data.find((s) => s.id === storyId);
      if (story) {
        story.approved = false;
        await fs.writeJson("daily_news.json", data, { spaces: 2 });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error("[cloud] /api/reject failed:", err.message);
      res.status(400).json({ error: "Bad request" });
    }
  });

  // API: Trigger production pipeline (shells out — auth critical)
  app.post("/api/produce", requireAuth, async (req, res) => {
    res.json({ ok: true, message: "Pipeline triggered" });
    console.log("[cloud] 🚀 Production pipeline triggered!");

    const sendDiscord = require("./notify");
    await sendDiscord("🚀 **Production pipeline started!**").catch(() => {});

    try {
      const { exec } = require("child_process");
      const util = require("util");
      const execAsync = util.promisify(exec);
      await execAsync("node run.js produce", {
        cwd: __dirname,
        timeout: 600000,
      });
      console.log("[cloud] ✅ Production complete");
      await sendDiscord(
        "✅ **Production complete!** Videos uploaded to YouTube.",
      ).catch(() => {});
    } catch (err) {
      // Don't surface err.message externally — it can embed FS paths / stderr.
      // Discord is owner-only so full message is safe there.
      console.error("[cloud] ❌ Production error:", err.message);
      await sendDiscord(`❌ **Production failed:** ${err.message}`).catch(
        () => {},
      );
    }
  });

  // API: Trigger hunt manually (mutation — auth required)
  app.post("/api/hunt", requireAuth, async (req, res) => {
    res.json({ ok: true, message: "Hunt triggered" });
    console.log("[cloud] 🔍 Manual hunt triggered");
    runDailyHunt();
  });

  // API: Pipeline status (unauthenticated — just counts, no content)
  app.get("/api/status", async (req, res) => {
    try {
      const stories = (await fs.pathExists("daily_news.json"))
        ? await fs.readJson("daily_news.json")
        : [];
      const approved = stories.filter((s) => s.approved).length;
      const exported = stories.filter((s) => s.exported_path).length;
      const total = stories.filter((s) => s.full_script).length;
      res.json({
        total,
        approved,
        exported,
        lastHunt: stories[0]?.timestamp || null,
      });
    } catch (err) {
      console.error("[cloud] /api/status failed:", err.message);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Redirect /approve/:id to approval page with highlight (preserves ?token)
  app.get("/approve/:id", (req, res) => {
    const token = typeof req.query.token === "string" ? req.query.token : null;
    const q = token
      ? `?highlight=${encodeURIComponent(req.params.id)}&token=${encodeURIComponent(token)}`
      : `?highlight=${encodeURIComponent(req.params.id)}`;
    res.redirect("/" + q);
  });

  // Serve the approval page HTML. The page itself is public shell; every
  // fetch() call inside includes the ?token param via sessionStorage.
  app.get("/", (req, res) => {
    res.type("html").send(getApprovalHTML(PUBLIC_URL));
  });

  // ===== Start Server =====

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[cloud] Server running on port ${PORT}`);
    console.log(`[cloud] Public URL: ${PUBLIC_URL}`);
    console.log(`[cloud] Approval page: ${PUBLIC_URL}`);
  });

  // ===== Cron Scheduler =====

  // Hunt at 5:30 AM GMT daily (gives time for image gen before 6AM Discord send)
  cron.schedule(
    "30 5 * * *",
    () => {
      console.log("[cloud] ⏰ Scheduled daily hunt triggered (5:30 AM GMT)");
      runDailyHunt();
    },
    { timezone: "Europe/London" },
  );

  console.log("[cloud] Cron scheduled: daily hunt at 5:30 AM GMT");
}

async function runDailyHunt() {
  const sendDiscord = require("./notify");

  try {
    console.log("[cloud] === DAILY HUNT ===");

    const hunt = require("./hunter");
    const process_stories = require("./processor");

    console.log("[cloud] Step 1: Hunting Reddit...");
    const stories = await hunt();

    console.log("[cloud] Step 2: Processing scripts + SEO...");
    await process_stories();

    console.log("[cloud] Step 3: Generating AI images...");
    try {
      const { generateAllImages } = require("./imagen");
      await generateAllImages();
    } catch (err) {
      console.log(`[cloud] Image gen failed (non-fatal): ${err.message}`);
    }

    const PUBLIC_URL =
      process.env.RAILWAY_PUBLIC_URL || `http://localhost:${PORT}`;

    // Embed the API_TOKEN in the Discord deep-link so the mobile browser
    // auto-picks it up (the page script strips it from the URL bar and
    // moves it into sessionStorage). This only lives in the owner's
    // private Discord channel.
    const token = process.env.API_TOKEN;
    const linkUrl = token
      ? `${PUBLIC_URL}?token=${encodeURIComponent(token)}`
      : PUBLIC_URL;

    // Send to Discord with approval links
    const axios = require("axios");
    const WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

    await axios.post(WEBHOOK_URL, {
      content: [
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
        "**🎮 PULSE GAMING — DAILY STORIES READY**",
        `📅 ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`,
        `${stories.length} stories with AI images ready for review.`,
        "",
        `📱 **Tap to approve:** ${linkUrl}`,
        "",
        stories
          .slice(0, 10)
          .map(
            (s, i) =>
              `${i + 1}. **[${s.flair || "News"}]** ${s.title} (${s.score} pts)`,
          )
          .join("\n"),
        "",
        `👉 **[OPEN APPROVAL PAGE](${linkUrl})**`,
        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"),
    });

    console.log("[cloud] Hunt complete — sent to Discord");
  } catch (err) {
    console.log(`[cloud] Hunt error: ${err.message}`);
    await sendDiscord(`❌ **Hunt failed:** ${err.message}`).catch(() => {});
  }
}

function getApprovalHTML(publicUrl) {
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
  .produce-btn { width: 100%; padding: 16px; background: #39FF14; color: #0a1628; border: none; border-radius: 14px; font-size: 16px; font-weight: 900; letter-spacing: 2px; cursor: pointer; }
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
let stories=[], selections={};
const params = new URLSearchParams(location.search);
const highlightId = params.get('highlight');
// Capture ?token=… from the Discord deep-link, persist in sessionStorage so
// subsequent page loads in the same tab keep working, and strip it from the
// URL bar so a casual screenshot doesn't leak it.
const urlToken = params.get('token');
if (urlToken) {
  try { sessionStorage.setItem('pg_token', urlToken); } catch (e) {}
  const clean = new URL(location.href);
  clean.searchParams.delete('token');
  history.replaceState(null, '', clean.toString());
}
function getToken() {
  try { return sessionStorage.getItem('pg_token') || ''; } catch (e) { return ''; }
}
function authHeaders(extra) {
  const h = Object.assign({}, extra || {});
  const t = getToken();
  if (t) h['Authorization'] = 'Bearer ' + t;
  return h;
}

async function load() {
  const r = await fetch('/api/stories', { headers: authHeaders() });
  if (r.status === 401) {
    document.getElementById('stories').innerHTML = '<div style="padding:40px;text-align:center;color:#F97316">Unauthorized. Open this page from the Discord approval link so the access token is attached.</div>';
    return;
  }
  stories = await r.json();
  stories.forEach(s => { if (s.approved===true) selections[s.id]={approved:true,imageIndex:0,titleIndex:0}; });
  render();
  if (highlightId) setTimeout(() => {
    const el=document.getElementById('s-'+highlightId);
    if(el){el.classList.add('highlight');el.scrollIntoView({behavior:'smooth',block:'center'});}
  }, 300);
}

function render() {
  const approved=Object.values(selections).filter(s=>s.approved).length;
  document.getElementById('approvedCount').textContent=approved+' approved';
  document.getElementById('pendingCount').textContent=(stories.length-approved)+' pending';
  document.getElementById('produceBtn').disabled=approved===0;

  document.getElementById('stories').innerHTML=stories.map(s => {
    const sel=selections[s.id]||{};
    const isApproved=sel.approved===true, isRejected=sel.approved===false;
    const flair=s.flair||'';
    const fc=flair.includes('Verified')?'verified':flair.includes('Highly Likely')?'likely':flair.includes('Rumou')||flair.includes('Rumor')?'rumour':'news';
    const cands=s.candidate_images||[];
    const titles=s.title_options||[s.title];

    return '<div class="story '+(isApproved?'approved':isRejected?'rejected':'')+'" id="s-'+s.id+'">' +
      '<div class="story-header">' +
        '<span class="flair flair-'+fc+'">'+esc(flair||'News')+'</span>' +
        '<div class="story-title">'+esc(s.title)+'</div>' +
        '<div class="story-meta">r/'+esc(s.subreddit)+' · <span class="story-score">'+s.score+'</span> · '+s.num_comments+' comments</div>' +
      '</div>' +
      '<div class="section-label">Pick title</div>' +
      '<div class="titles">'+titles.map((t,ti)=>'<div class="title-opt '+(sel.titleIndex===ti?'selected':'')+'" onclick="pickTitle(\\''+s.id+'\\','+ti+')">'+esc(t)+'</div>').join('')+'</div>' +
      '<div class="section-label">Script</div>' +
      '<div class="script-preview">'+esc((s.hook||'')+' '+(s.body||s.full_script||'').substring(0,250))+'...</div>' +
      (cands.length>0?'<div class="section-label">Pick image ('+cands.length+')</div><div class="images-row">'+cands.map((c,ci)=>'<div class="img-opt '+(sel.imageIndex===ci?'selected':'')+'" onclick="pickImage(\\''+s.id+'\\','+ci+')"><img src="/images/'+s.id+'/candidates/candidate_'+ci+'.jpg" loading="lazy"/><span class="img-num">'+(ci+1)+'</span></div>').join('')+'</div>':'') +
      '<div class="actions"><button class="btn btn-approve '+(isApproved?'done':'')+'" onclick="approve(\\''+s.id+'\\')">'+(isApproved?'✅ APPROVED':'✅ APPROVE')+'</button><button class="btn btn-skip" onclick="reject(\\''+s.id+'\\')">SKIP</button></div></div>';
  }).join('');
}

function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function pickTitle(id,idx){if(!selections[id])selections[id]={};selections[id].titleIndex=idx;render();}
function pickImage(id,idx){if(!selections[id])selections[id]={};selections[id].imageIndex=idx;render();}

async function approve(id) {
  const sel=selections[id]||{titleIndex:0,imageIndex:0};
  selections[id]={...sel,approved:true};
  render();
  await fetch('/api/approve',{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({storyId:id,imageIndex:sel.imageIndex||0,titleIndex:sel.titleIndex||0})});
}

async function reject(id) {
  selections[id]={approved:false};
  render();
  await fetch('/api/reject',{method:'POST',headers:authHeaders({'Content-Type':'application/json'}),body:JSON.stringify({storyId:id})});
}

async function produce() {
  const n=Object.values(selections).filter(s=>s.approved).length;
  if(!confirm('Produce '+n+' stories and upload to YouTube?'))return;
  const btn=document.getElementById('produceBtn');
  btn.textContent='PRODUCING...';btn.classList.add('running');btn.disabled=true;
  await fetch('/api/produce',{method:'POST',headers:authHeaders()});
}

load();
</script>
</body>
</html>`;
}

// ===== Start =====
startServer().catch((err) => {
  console.error("[cloud] FATAL:", err.message);
  process.exit(1);
});
