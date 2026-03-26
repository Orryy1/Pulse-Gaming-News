const express = require('express');
const cors = require('cors');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

dotenv.config({ override: true });

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_FILE = path.join(__dirname, 'daily_news.json');
const PUBLIC_DIR = path.join(__dirname, 'public', 'generated');

fs.ensureDirSync(PUBLIC_DIR);

app.use(cors());
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[server] ${req.method} ${req.path}`);
  next();
});

// Serve Vite build from dist/
app.use(express.static(path.join(__dirname, 'dist')));
app.use('/generated', express.static(PUBLIC_DIR));

// --- SSE for real-time progress ---
const sseClients = new Map();

function broadcastProgress(storyId, type, progress, stage) {
  const data = JSON.stringify({ storyId, type, progress, stage });
  for (const [, res] of sseClients) {
    res.write(`data: ${data}\n\n`);
  }
}

// --- Data helpers ---
function readNews() {
  if (!fs.existsSync(DATA_FILE)) return [];
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writeNews(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function findStory(id) {
  const stories = readNews();
  const story = stories.find(s => s.id === id);
  return { stories, story };
}

function updateStory(id, updates) {
  const stories = readNews();
  const idx = stories.findIndex(s => s.id === id);
  if (idx === -1) return null;
  Object.assign(stories[idx], updates);
  writeNews(stories);
  return stories[idx];
}

// --- API Routes ---

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    hunterActive: !!hunterInterval,
  });
});

app.get('/api/news', (req, res) => {
  try {
    const stories = readNews();
    res.json(Array.isArray(stories) ? stories : []);
  } catch (err) {
    console.log(`[server] ERROR reading news: ${err.message}`);
    res.json([]);
  }
});

app.get('/api/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('data: {"type":"connected"}\n\n');

  const clientId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  sseClients.set(clientId, res);

  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

app.post('/api/approve', (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { story } = findStory(id);
    if (!story) return res.status(404).json({ error: 'story not found' });

    updateStory(id, { approved: true });
    console.log(`[server] Approved: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.log(`[server] ERROR approving: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- Publish pipeline ---
let publishState = { status: 'idle', message: '' };

app.post('/api/publish', (req, res) => {
  if (publishState.status === 'running') {
    return res.json({ status: 'already running' });
  }

  publishState = { status: 'running', message: 'Starting publish pipeline...' };
  console.log('[server] Starting publish pipeline...');

  const child = spawn('node', ['run.js', 'produce'], {
    cwd: __dirname,
    stdio: 'inherit',
  });

  child.on('close', (code) => {
    publishState = {
      status: code === 0 ? 'complete' : 'error',
      message: code === 0 ? 'Pipeline finished successfully' : 'Pipeline exited with errors',
    };
    console.log(`[server] Publish pipeline finished: ${publishState.status}`);
  });

  child.on('error', (err) => {
    publishState = { status: 'error', message: err.message };
    console.log(`[server] Publish pipeline error: ${err.message}`);
  });

  res.json({ status: 'running' });
});

app.get('/api/publish-status', (req, res) => {
  res.json(publishState);
});

// --- Image/Video generation queues ---
app.post('/api/generate-image', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { story } = findStory(id);
    if (!story) return res.status(404).json({ error: 'story not found' });

    const queuePath = 'image_queue.json';
    const queue = await fs.pathExists(queuePath) ? await fs.readJson(queuePath) : [];
    queue.push({ id, queued_at: new Date().toISOString() });
    await fs.writeJson(queuePath, queue, { spaces: 2 });

    console.log(`[server] Image queued: ${id}`);
    res.json({ status: 'generating', id });

    // Broadcast initial progress
    broadcastProgress(id, 'image', 10, 'Queued for generation');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/generate-video', async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id required' });

    const { story } = findStory(id);
    if (!story) return res.status(404).json({ error: 'story not found' });

    const queuePath = 'video_queue.json';
    const queue = await fs.pathExists(queuePath) ? await fs.readJson(queuePath) : [];
    queue.push({ id, queued_at: new Date().toISOString() });
    await fs.writeJson(queuePath, queue, { spaces: 2 });

    console.log(`[server] Video queued: ${id}`);
    res.json({ status: 'generating', id });

    broadcastProgress(id, 'video', 10, 'Queued for generation');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Schedule ---
app.post('/api/schedule', (req, res) => {
  const { id, scheduleTime } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const updated = updateStory(id, { schedule_time: scheduleTime || null });
  if (!updated) return res.status(404).json({ error: 'story not found' });

  res.json({ status: 'scheduled', id, scheduleTime });
});

// --- Retry publish ---
app.post('/api/retry-publish', (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const updated = updateStory(id, { publish_status: 'publishing', publish_error: undefined });
  if (!updated) return res.status(404).json({ error: 'story not found' });

  res.json({ status: 'retrying', id });
});

// --- Download ---
app.get('/api/download/:id', async (req, res) => {
  try {
    const stories = readNews();
    const story = stories.find(s => s.id === req.params.id);

    if (!story || !story.exported_path) {
      return res.status(404).json({ error: 'video not found' });
    }

    const filePath = path.resolve(story.exported_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'file not found on disk' });
    }

    res.setHeader('Content-Disposition', `attachment; filename=pulse-gaming-${req.params.id}.mp4`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.log(`[server] ERROR downloading: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// --- Stats ---
app.get('/api/stats/:postId', async (req, res) => {
  try {
    const { platform } = req.query;

    if (platform === 'youtube') {
      const apiKey = process.env.YOUTUBE_API_KEY;
      if (!apiKey || apiKey === 'placeholder') {
        return res.json({ views: 0, note: 'YouTube API key not configured' });
      }
      try {
        const ytRes = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${encodeURIComponent(req.params.postId)}&key=${encodeURIComponent(apiKey)}`
        );
        if (ytRes.ok) {
          const ytData = await ytRes.json();
          const item = ytData.items?.[0];
          return res.json({ views: item ? parseInt(item.statistics.viewCount, 10) || 0 : 0 });
        }
      } catch (e) {
        // fall through
      }
      return res.json({ views: 0 });
    }

    if (platform === 'tiktok') {
      return res.json({ views: 0 });
    }

    res.json({ views: 0, likes: 0, note: 'YouTube API integration pending' });
  } catch (err) {
    console.log(`[server] ERROR stats: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stats/update', (req, res) => {
  const { id, youtube_views, tiktok_views } = req.body;
  if (!id) return res.status(400).json({ error: 'id required' });

  const updates = {};
  if (youtube_views !== undefined) updates.youtube_views = youtube_views;
  if (tiktok_views !== undefined) updates.tiktok_views = tiktok_views;

  const updated = updateStory(id, updates);
  if (!updated) return res.status(404).json({ error: 'story not found' });

  res.json({ status: 'updated', id });
});

// --- Hunter endpoints ---
const HUNTER_INTERVAL_MS = 6 * 60 * 60 * 1000;
let hunterInterval = null;
let lastHunterRun = new Date(0);

async function runHunter() {
  console.log('[server] Running hunter cycle...');
  lastHunterRun = new Date();

  try {
    const hunt = require('./hunter');
    const process_stories = require('./processor');

    const posts = await hunt();
    const existingStories = readNews();
    const existingIds = new Set(existingStories.map(s => s.id));

    // Only process new stories
    const newPosts = posts.filter(p => !existingIds.has(p.id));

    if (newPosts.length > 0) {
      // Write new posts to pending_news.json for processor
      await fs.writeJson('pending_news.json', { timestamp: new Date().toISOString(), stories: newPosts }, { spaces: 2 });
      await process_stories();

      // Merge newly processed stories with existing
      const processed = readNews();
      // processed now contains only new stories; merge with existing
      if (existingStories.length > 0 && processed.length > 0) {
        const merged = [...processed, ...existingStories];
        writeNews(merged);
      }
    }

    console.log(`[server] Hunter cycle complete: ${newPosts.length} new stories`);
  } catch (err) {
    console.log(`[server] Hunter error: ${err.message}`);
  }
}

app.get('/api/hunter/status', (req, res) => {
  res.json({
    active: !!hunterInterval,
    lastRun: lastHunterRun.toISOString(),
    nextRun: hunterInterval ? new Date(lastHunterRun.getTime() + HUNTER_INTERVAL_MS).toISOString() : null,
  });
});

app.post('/api/hunter/run', async (req, res) => {
  res.json({ status: 'started' });
  await runHunter();
});

function startHunter() {
  const hasKey = process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== 'placeholder';
  if (hasKey) {
    console.log('[server] Auto-hunter enabled. Running every 6 hours.');
    runHunter();
    hunterInterval = setInterval(runHunter, HUNTER_INTERVAL_MS);
  } else {
    console.log('[server] Auto-hunter disabled. Set ANTHROPIC_API_KEY to enable.');
  }
}

// --- SPA fallback ---
app.get('/{*splat}', (req, res) => {
  const indexPath = path.join(__dirname, 'dist', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Fallback to public/index.html for dev without build
    const pubIndex = path.join(__dirname, 'public', 'index.html');
    if (fs.existsSync(pubIndex)) {
      res.sendFile(pubIndex);
    } else {
      res.status(404).send('Frontend not built. Run: npm run build');
    }
  }
});

app.listen(PORT, () => {
  console.log(`[server] Pulse Gaming Command Centre running on http://localhost:${PORT}`);
  startHunter();
});

module.exports = { broadcastProgress };
