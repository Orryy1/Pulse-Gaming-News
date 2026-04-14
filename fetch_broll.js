/*
  B-roll fetcher — trailer / gameplay footage for stories where Steam has none.

  Steam trailers are already pulled in hunter.js + images_download.js. This
  module fills the gap for:
    - console exclusives (Nintendo, most Sony, some Xbox) with no Steam page
    - industry / studio stories that don't map to a specific game
    - cases where Steam search missed the match

  Source priority:
    1. IGDB (Twitch dev creds) — returns a YouTube video_id for a trailer
    2. YouTube Data API search — "official trailer {game}" first result
  Both converge on yt-dlp to download and trim the first 12 seconds.

  Fair-use guardrails enforced here:
    - CLIP_MAX_SECONDS = 12  (short enough that narration transformation dominates)
    - Skips videos longer than 20 min (full podcasts / reviews, not trailers)
    - Refuses to download if no game title could be extracted (prevents random
      footage being stapled onto industry stories)

  All functions return { path, source } or null. Never throws.
*/

const fs = require("fs-extra");
const path = require("path");
const axios = require("axios");
const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

const VIDEO_CACHE_DIR = path.join("output", "video_cache");
const CLIP_MAX_SECONDS = 12;
const MAX_TRAILER_DURATION_SECONDS = 20 * 60; // reject podcasts / reviews

// --- IGDB (via Twitch app token) ---
let _igdbToken = null;
let _igdbTokenExp = 0;

async function getIgdbToken() {
  const cid = process.env.TWITCH_CLIENT_ID;
  const secret = process.env.TWITCH_CLIENT_SECRET;
  if (!cid || !secret) return null;
  if (_igdbToken && Date.now() < _igdbTokenExp) return _igdbToken;

  try {
    const resp = await axios.post(
      `https://id.twitch.tv/oauth2/token?client_id=${cid}&client_secret=${secret}&grant_type=client_credentials`,
      null,
      { timeout: 8000 },
    );
    _igdbToken = resp.data.access_token;
    // expires_in is seconds, subtract 60s safety margin
    _igdbTokenExp = Date.now() + (resp.data.expires_in - 60) * 1000;
    return _igdbToken;
  } catch (err) {
    console.log(`[broll] IGDB auth failed: ${err.message}`);
    return null;
  }
}

async function lookupIgdbTrailer(gameTitle) {
  const token = await getIgdbToken();
  if (!token) return null;
  const cid = process.env.TWITCH_CLIENT_ID;

  try {
    // Search the game, then fetch its videos (IGDB requires two steps)
    const searchBody = `search "${gameTitle.replace(/"/g, "")}"; fields id,name,videos; limit 3;`;
    const searchResp = await axios.post(
      "https://api.igdb.com/v4/games",
      searchBody,
      {
        headers: {
          "Client-ID": cid,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        timeout: 8000,
      },
    );
    const games = searchResp.data || [];
    const withVideos = games.find((g) => g.videos && g.videos.length > 0);
    if (!withVideos) return null;

    const videoIds = withVideos.videos.slice(0, 5).join(",");
    const videosBody = `fields video_id,name,game; where id = (${videoIds});`;
    const videosResp = await axios.post(
      "https://api.igdb.com/v4/game_videos",
      videosBody,
      {
        headers: {
          "Client-ID": cid,
          Authorization: `Bearer ${token}`,
          "Content-Type": "text/plain",
        },
        timeout: 8000,
      },
    );
    const videos = videosResp.data || [];
    // Prefer anything named "trailer" / "reveal" over "gameplay" / "teaser"
    const ranked = videos.sort((a, b) => {
      const score = (v) =>
        /trailer|reveal|launch/i.test(v.name || "")
          ? 3
          : /gameplay/i.test(v.name || "")
            ? 2
            : 1;
      return score(b) - score(a);
    });
    if (ranked[0]?.video_id) {
      return {
        youtubeId: ranked[0].video_id,
        source: `igdb:${withVideos.name}`,
      };
    }
    return null;
  } catch (err) {
    console.log(`[broll] IGDB lookup failed: ${err.message}`);
    return null;
  }
}

// --- YouTube Data API search ---
async function searchYoutubeTrailer(gameTitle) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return null;

  try {
    const q = `${gameTitle} official trailer`;
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&videoDuration=short&maxResults=5&q=${encodeURIComponent(q)}&key=${apiKey}`;
    const resp = await axios.get(url, { timeout: 8000 });
    const items = resp.data?.items || [];
    if (items.length === 0) return null;

    // Prefer official / verified publisher channels where we can detect them
    const preferred = items.find((item) => {
      const ch = (item.snippet?.channelTitle || "").toLowerCase();
      return /official|playstation|xbox|nintendo|steam|ign|gamespot/i.test(ch);
    });
    const chosen = preferred || items[0];
    return {
      youtubeId: chosen.id.videoId,
      source: `youtube:${chosen.snippet.channelTitle}`,
    };
  } catch (err) {
    console.log(`[broll] YouTube search failed: ${err.message}`);
    return null;
  }
}

// --- yt-dlp download of first N seconds ---
async function downloadYoutubeClip(youtubeId, filename, source) {
  await fs.ensureDir(VIDEO_CACHE_DIR);
  const outPath = path.join(VIDEO_CACHE_DIR, filename);
  if (await fs.pathExists(outPath)) return { path: outPath, source };

  const url = `https://www.youtube.com/watch?v=${youtubeId}`;

  try {
    // Quick metadata probe — reject podcasts / long reviews
    const probeCmd = `yt-dlp --no-warnings --skip-download --print "%(duration)s" "${url}"`;
    const { stdout } = await execAsync(probeCmd, { timeout: 15000 });
    const duration = parseInt(stdout.trim(), 10);
    if (!duration || duration > MAX_TRAILER_DURATION_SECONDS) {
      console.log(
        `[broll] Skipping ${youtubeId}: duration ${duration}s exceeds cap`,
      );
      return null;
    }
  } catch (probeErr) {
    // If probe fails we abort — most likely yt-dlp not installed or video blocked
    console.log(
      `[broll] yt-dlp probe failed for ${youtubeId}: ${probeErr.message}`,
    );
    return null;
  }

  try {
    // Download first CLIP_MAX_SECONDS only.
    // Force mp4 container + 720p max (Shorts is 1080 tall but 720 scales fine)
    const dlCmd =
      `yt-dlp --no-warnings -q ` +
      `--download-sections "*0-${CLIP_MAX_SECONDS}" ` +
      `--format "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best" ` +
      `--merge-output-format mp4 ` +
      `-o "${outPath.replace(/\\/g, "/")}" "${url}"`;
    await execAsync(dlCmd, { timeout: 90000, maxBuffer: 10 * 1024 * 1024 });

    if (!(await fs.pathExists(outPath))) return null;
    const stat = await fs.stat(outPath);
    if (stat.size < 20000) {
      await fs.remove(outPath);
      return null;
    }

    console.log(
      `[broll] Downloaded ${source}: ${filename} (${Math.round(stat.size / 1024)}KB)`,
    );
    return { path: outPath, source };
  } catch (err) {
    console.log(
      `[broll] yt-dlp download failed for ${youtubeId}: ${err.message}`,
    );
    return null;
  }
}

// --- Clean game title for search queries ---
// Gaming headlines often put the game name before a colon ("Metroid Prime 4:
// new gameplay revealed"). Keep whichever side of the colon has more capital
// words, since that's almost always where the proper noun / game name lives.
function extractGameTitle(story) {
  if (!story?.title) return null;
  let t = story.title;
  if (t.includes(":")) {
    const parts = t.split(":", 2);
    const countCaps = (s) => (s.match(/\b[A-Z][a-zA-Z0-9']+/g) || []).length;
    t = countCaps(parts[0]) >= countCaps(parts[1]) ? parts[0] : parts[1];
  }
  t = t
    .replace(
      /\b(reportedly|officially|confirmed|leaked|rumoured|rumored|allegedly|now|just|new)\b/gi,
      "",
    )
    .replace(
      /\b(announced|announces|reveals|revealed|drops|dropped|launches|launched|releases|released)\b/gi,
      "",
    )
    .replace(/\b(gameplay|trailer|footage|update|patch|review|date)\b/gi, "")
    .replace(/[^a-zA-Z0-9\s:'-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  // If what's left is too short, story isn't game-specific enough for trailer B-roll
  if (t.length < 4 || t.split(/\s+/).length < 1) return null;
  return t.substring(0, 60);
}

// --- Public entry point ---
// Returns an array of { path, source } (max 2 clips) or [] if nothing usable.
// Only called when Steam returned no clips.
async function fetchFallbackBroll(story) {
  const gameTitle = extractGameTitle(story);
  if (!gameTitle) {
    console.log(
      `[broll] Skipping "${(story.title || "").substring(0, 40)}..." - no game title extractable`,
    );
    return [];
  }

  // Rumour stories should not get real gameplay footage - implies confirmation
  if (story.flair && /rumour|rumor/i.test(story.flair)) {
    console.log(
      `[broll] Skipping rumour story - no gameplay footage for unverified claims`,
    );
    return [];
  }

  const clips = [];

  // 1. IGDB
  const igdb = await lookupIgdbTrailer(gameTitle);
  if (igdb) {
    const clip = await downloadYoutubeClip(
      igdb.youtubeId,
      `${story.id}_igdb_${igdb.youtubeId}.mp4`,
      igdb.source,
    );
    if (clip) clips.push(clip);
  }

  // 2. YouTube Data API (opt-in only - higher copyright-strike risk than Steam / IGDB)
  if (clips.length === 0 && process.env.BROLL_YOUTUBE_FALLBACK === "true") {
    const yt = await searchYoutubeTrailer(gameTitle);
    if (yt) {
      const clip = await downloadYoutubeClip(
        yt.youtubeId,
        `${story.id}_yt_${yt.youtubeId}.mp4`,
        yt.source,
      );
      if (clip) clips.push(clip);
    }
  }

  if (clips.length > 0) {
    console.log(
      `[broll] Sourced ${clips.length} fallback clip(s) for "${gameTitle}" via ${clips.map((c) => c.source).join(", ")}`,
    );
  }
  return clips;
}

module.exports = {
  fetchFallbackBroll,
  extractGameTitle,
  downloadYoutubeClip,
  searchYoutubeTrailer,
  lookupIgdbTrailer,
};
