/**
 * SQLite Database Layer for Pulse Gaming Pipeline
 *
 * Feature-flagged via USE_SQLITE env var.
 * When USE_SQLITE=true, all story/analytics persistence goes through SQLite.
 * When USE_SQLITE is falsy or unset, this module falls back to JSON file operations
 * so the existing pipeline is entirely unaffected.
 *
 * Usage:
 *   const db = require('./lib/db');
 *   const stories = await db.getStories();
 *   await db.upsertStory(story);
 */

const path = require("path");
const fs = require("fs-extra");

/**
 * Resolve the canonical SQLite DB path.
 *
 * Precedence:
 *   1. `SQLITE_DB_PATH` env var (absolute path to the DB file). Intended
 *      for production, where Railway must mount a persistent volume and
 *      point this at e.g. `/data/pulse.db`.
 *   2. Legacy in-repo location `<repo>/data/pulse.db`. Used for local
 *      dev and back-compat with existing boxes.
 *
 * WHY this helper exists:
 *   The 2026-04-19 "DB wipe on deploy" incident. Railway's container
 *   filesystem is ephemeral; `<repo>/data/` sat on it and got replaced
 *   on every deploy, wiping stories/approvals/scores. This env var
 *   lets an operator mount a volume anywhere (e.g. /data) without
 *   re-vendoring the repo path.
 *
 * Returns an absolute path. Also emits a one-line log line the first
 * time it's called so ops can confirm the live location from the
 * deploy banner.
 *
 * Side effect: ensures the parent directory exists.
 */
function resolveDbPath() {
  const fromEnv = (process.env.SQLITE_DB_PATH || "").trim();
  const resolved = fromEnv
    ? path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(process.cwd(), fromEnv)
    : path.join(__dirname, "..", "data", "pulse.db");

  // Warn loudly in production if the resolved path looks ephemeral.
  // We check for two tell-tales of Railway's container filesystem:
  //   - falls under /app/ (Railway's container WORKDIR)
  //   - is under the repo checkout dir (same place in dev and in prod)
  // Operators who've mounted a volume at e.g. /data/ will see a clean
  // path and no warning. Operators who haven't will see this warning
  // on every boot until they fix it.
  const isProd =
    process.env.NODE_ENV === "production" ||
    !!process.env.RAILWAY_ENVIRONMENT ||
    !!process.env.RAILWAY_PUBLIC_URL;
  const looksEphemeral =
    resolved.startsWith("/app/") ||
    resolved.startsWith(path.join(__dirname, "..") + path.sep);
  if (isProd && looksEphemeral) {
    console.log(
      `[db] WARNING: SQLite path ${resolved} looks ephemeral in production. ` +
        "Set SQLITE_DB_PATH to an absolute path on a persistent Railway volume " +
        "(e.g. SQLITE_DB_PATH=/data/pulse.db with a volume mounted at /data) " +
        "to avoid losing state on redeploy.",
    );
  }
  return resolved;
}

const DB_PATH = resolveDbPath();
// Co-locate the deploy lock with the DB so the same persistent volume
// carries all SQLite-adjacent state.
const LOCK_PATH = path.join(path.dirname(DB_PATH), "deploy.lock");
const DAILY_NEWS_PATH = path.join(__dirname, "..", "daily_news.json");
const ANALYTICS_HISTORY_PATH = path.join(
  __dirname,
  "..",
  "analytics_history.json",
);
const BREAKING_LOG_PATH = path.join(__dirname, "..", "breaking_log.json");
const ENGAGEMENT_REPLY_LOG_PATH = path.join(
  __dirname,
  "..",
  "engagement_reply_log.json",
);

// ---------- Feature flag ----------

function useSqlite() {
  return process.env.USE_SQLITE === "true";
}

// ---------- Deploy lock (Blue-Green race prevention) ----------

function acquireLock() {
  try {
    fs.ensureDirSync(path.dirname(LOCK_PATH));
    // Write current PID to lock file
    const lockData = { pid: process.pid, timestamp: Date.now() };

    if (fs.existsSync(LOCK_PATH)) {
      const existing = JSON.parse(fs.readFileSync(LOCK_PATH, "utf-8"));
      // Check if the locking process is still alive
      try {
        process.kill(existing.pid, 0); // Signal 0 = check if process exists
        // Process still alive and it's not us - stale check (5 min timeout)
        if (
          existing.pid !== process.pid &&
          Date.now() - existing.timestamp < 5 * 60 * 1000
        ) {
          console.log(
            `[db] Deploy lock held by PID ${existing.pid}, waiting...`,
          );
          return false;
        }
      } catch (e) {
        // Process not found - lock is stale, safe to take over
      }
    }

    fs.writeFileSync(LOCK_PATH, JSON.stringify(lockData));
    return true;
  } catch (err) {
    console.log(`[db] Lock acquisition error: ${err.message}`);
    return true; // Fail open to avoid blocking the pipeline
  }
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const existing = JSON.parse(fs.readFileSync(LOCK_PATH, "utf-8"));
      if (existing.pid === process.pid) {
        fs.removeSync(LOCK_PATH);
      }
    }
  } catch (err) {
    // Silent - lock cleanup is best-effort
  }
}

// ---------- Lazy-loaded DB singleton ----------

let _db = null;

function getDb() {
  if (_db) return _db;

  acquireLock();

  const Database = require("better-sqlite3");
  fs.ensureDirSync(path.dirname(DB_PATH));
  _db = new Database(DB_PATH);
  // One-shot log so operators can confirm the live location from the
  // deploy banner. Matches the style of the /api/health build/runtime
  // block. Does NOT leak any secret-shaped value — just the file path.
  console.log(`[db] opened SQLite at ${DB_PATH}`);

  // Performance pragmas
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("foreign_keys = ON");

  // Keep the legacy inline schema for backwards compatibility (matches
  // what every previous process would have written). The versioned
  // migration runner then layers 002..010 on top — safe on both fresh
  // and existing databases because every migration is guarded by a
  // schema_migrations row.
  initSchema(_db);

  try {
    const { runMigrations } = require("./migrate");
    const result = runMigrations(_db, { log: () => {} });
    if (result.applied.length) {
      console.log(`[db] applied migrations: ${result.applied.join(", ")}`);
    }
  } catch (err) {
    console.error(`[db] migration runner failed: ${err.message}`);
    throw err;
  }

  return _db;
}

// ---------- Schema ----------

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      url TEXT,
      score INTEGER DEFAULT 0,
      flair TEXT,
      subreddit TEXT,
      source_type TEXT,
      breaking_score REAL DEFAULT 0,
      top_comment TEXT,
      timestamp TEXT,
      num_comments INTEGER DEFAULT 0,
      hook TEXT,
      body TEXT,
      loop TEXT,
      full_script TEXT,
      tts_script TEXT,
      word_count INTEGER DEFAULT 0,
      suggested_title TEXT,
      suggested_thumbnail_text TEXT,
      content_pillar TEXT,
      affiliate_url TEXT,
      pinned_comment TEXT,
      approved INTEGER DEFAULT 0,
      auto_approved INTEGER DEFAULT 0,
      approved_at TEXT,
      audio_path TEXT,
      image_path TEXT,
      exported_path TEXT,
      youtube_post_id TEXT,
      youtube_url TEXT,
      tiktok_post_id TEXT,
      instagram_media_id TEXT,
      facebook_post_id TEXT,
      twitter_post_id TEXT,
      article_image TEXT,
      article_url TEXT,
      company_name TEXT,
      company_logo_url TEXT,
      classification TEXT,
      quality_score REAL,
      title_variants TEXT,
      active_title_index INTEGER DEFAULT 0,
      game_images TEXT,
      downloaded_images TEXT,
      video_clips TEXT,
      story_image_path TEXT,
      cta TEXT,
      publish_status TEXT,
      publish_error TEXT,
      youtube_published_at TEXT,
      youtube_views INTEGER DEFAULT 0,
      youtube_likes INTEGER DEFAULT 0,
      youtube_comments INTEGER DEFAULT 0,
      tiktok_views INTEGER DEFAULT 0,
      tiktok_likes INTEGER DEFAULT 0,
      tiktok_comments INTEGER DEFAULT 0,
      tiktok_shares INTEGER DEFAULT 0,
      instagram_views INTEGER DEFAULT 0,
      instagram_likes INTEGER DEFAULT 0,
      instagram_comments INTEGER DEFAULT 0,
      virality_score REAL DEFAULT 0,
      stats_fetched_at TEXT,
      engagement_comment_id TEXT,
      engagement_hearts INTEGER DEFAULT 0,
      engagement_replies INTEGER DEFAULT 0,
      engagement_last_run TEXT,
      schedule_time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      published_at TEXT,
      _extra TEXT
    );

    CREATE TABLE IF NOT EXISTS analytics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      title TEXT,
      flair TEXT,
      content_pillar TEXT,
      youtube_post_id TEXT,
      tiktok_post_id TEXT,
      instagram_media_id TEXT,
      youtube_views INTEGER DEFAULT 0,
      youtube_likes INTEGER DEFAULT 0,
      youtube_comments INTEGER DEFAULT 0,
      tiktok_views INTEGER DEFAULT 0,
      tiktok_likes INTEGER DEFAULT 0,
      tiktok_comments INTEGER DEFAULT 0,
      tiktok_shares INTEGER DEFAULT 0,
      instagram_views INTEGER DEFAULT 0,
      instagram_likes INTEGER DEFAULT 0,
      instagram_comments INTEGER DEFAULT 0,
      total_views INTEGER DEFAULT 0,
      virality_score REAL DEFAULT 0,
      published_at TEXT,
      updated_at TEXT,
      UNIQUE(story_id)
    );

    CREATE TABLE IF NOT EXISTS analytics_topic_stats (
      key TEXT PRIMARY KEY,
      count INTEGER DEFAULT 0,
      total_virality REAL DEFAULT 0,
      avg_virality REAL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS breaking_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT,
      title TEXT,
      breaking_score REAL,
      flair TEXT,
      source_type TEXT,
      logged_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS engagement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      hearted INTEGER DEFAULT 0,
      replies INTEGER DEFAULT 0,
      pins INTEGER DEFAULT 0,
      UNIQUE(date)
    );

    CREATE INDEX IF NOT EXISTS idx_stories_approved ON stories(approved);
    CREATE INDEX IF NOT EXISTS idx_stories_published ON stories(youtube_post_id);
    CREATE INDEX IF NOT EXISTS idx_stories_exported ON stories(exported_path);
    CREATE INDEX IF NOT EXISTS idx_analytics_story ON analytics_snapshots(story_id);
  `);
}

// ---------- Column list for stories ----------

// Known columns in the stories table (used to split known vs extra fields)
const STORIES_COLUMNS = new Set([
  "id",
  "title",
  "url",
  "score",
  "flair",
  "subreddit",
  "source_type",
  "breaking_score",
  "top_comment",
  "timestamp",
  "num_comments",
  "hook",
  "body",
  "loop",
  "full_script",
  "tts_script",
  "word_count",
  "suggested_title",
  "suggested_thumbnail_text",
  "content_pillar",
  "affiliate_url",
  "pinned_comment",
  "approved",
  "auto_approved",
  "approved_at",
  "audio_path",
  "image_path",
  "exported_path",
  "youtube_post_id",
  "youtube_url",
  "tiktok_post_id",
  "instagram_media_id",
  "facebook_post_id",
  "twitter_post_id",
  "article_image",
  "article_url",
  "company_name",
  "company_logo_url",
  "classification",
  "quality_score",
  "title_variants",
  "active_title_index",
  "game_images",
  "downloaded_images",
  "video_clips",
  "story_image_path",
  "cta",
  "publish_status",
  "publish_error",
  "youtube_published_at",
  "youtube_views",
  "youtube_likes",
  "youtube_comments",
  "tiktok_views",
  "tiktok_likes",
  "tiktok_comments",
  "tiktok_shares",
  "instagram_views",
  "instagram_likes",
  "instagram_comments",
  "virality_score",
  "stats_fetched_at",
  "engagement_comment_id",
  "engagement_hearts",
  "engagement_replies",
  "engagement_last_run",
  "schedule_time",
  "created_at",
  "updated_at",
  "published_at",
  // Phase 2B (migration 011): canonical-URL hash used by
  // lib/services/publish-dedupe.js to catch re-hunted duplicates across
  // story_id boundaries. Auto-populated in storyToRow() from the url
  // field, so callers don't have to remember to set it.
  "source_url_hash",
  // Migration 012: durable Discord post-once markers. Set by publisher.js
  // after a successful postVideoUpload() / postStoryPoll() so re-renders
  // that clear platform ids don't re-trigger the #video-drops or #polls
  // announcement (17 April 2026 Pragmata incident).
  "discord_video_drop_posted_at",
  "discord_story_poll_posted_at",
  "_extra",
]);

// Fields stored as JSON text in SQLite
const JSON_FIELDS = new Set([
  "title_variants",
  "game_images",
  "downloaded_images",
  "video_clips",
]);

// ---------- Conversion helpers ----------

/** Convert a JS story object into a row-friendly format for SQLite. */
function storyToRow(story) {
  const row = {};
  const extra = {};

  for (const [key, value] of Object.entries(story)) {
    if (STORIES_COLUMNS.has(key)) {
      if (
        JSON_FIELDS.has(key) &&
        value !== null &&
        value !== undefined &&
        typeof value !== "string"
      ) {
        row[key] = JSON.stringify(value);
      } else if (typeof value === "boolean") {
        row[key] = value ? 1 : 0;
      } else {
        row[key] = value === undefined ? null : value;
      }
    } else {
      // Stash unknown fields in _extra so no data is lost
      if (value !== undefined && value !== null) {
        extra[key] = value;
      }
    }
  }

  if (Object.keys(extra).length > 0) {
    row._extra = JSON.stringify(extra);
  }

  // Phase 2B: auto-populate source_url_hash when we have a url but the
  // caller didn't set the hash explicitly. Keeps the hunter/processor
  // flow hash-aware without requiring every callsite to import the
  // canonical helper. Safe on upserts: passing a fresh hash just
  // overwrites with the same value for unchanged URLs.
  if (
    row.url &&
    (row.source_url_hash === undefined || row.source_url_hash === null)
  ) {
    try {
      const { canonicalHash } = require("./services/url-canonical");
      const hash = canonicalHash(row.url);
      if (hash && hash !== "invalid-url") row.source_url_hash = hash;
    } catch {
      // If the helper isn't importable for any reason (shouldn't
      // happen in prod), leave the column NULL — the dedup service
      // handles that cleanly.
    }
  }

  row.updated_at = new Date().toISOString();
  return row;
}

/** Convert a SQLite row back into a JS story object matching JSON format. */
function rowToStory(row) {
  if (!row) return null;
  const story = {};

  for (const [key, value] of Object.entries(row)) {
    if (key === "_extra") continue;
    if (
      JSON_FIELDS.has(key) &&
      typeof value === "string" &&
      value.startsWith("[")
    ) {
      try {
        story[key] = JSON.parse(value);
      } catch {
        story[key] = value;
      }
    } else if (key === "approved" || key === "auto_approved") {
      story[key] = !!value;
    } else if (value !== null) {
      story[key] = value;
    }
  }

  // Merge extra fields back
  if (row._extra) {
    try {
      const extra = JSON.parse(row._extra);
      Object.assign(story, extra);
    } catch {
      /* ignore parse errors */
    }
  }

  return story;
}

// ---------- JSON fallback helpers ----------

async function jsonGetStories() {
  if (await fs.pathExists(DAILY_NEWS_PATH)) {
    return fs.readJson(DAILY_NEWS_PATH);
  }
  return [];
}

async function jsonSaveStories(stories) {
  await fs.writeJson(DAILY_NEWS_PATH, stories, { spaces: 2 });
}

// ---------- Public API ----------

/**
 * Returns all stories as an array.
 * Replaces: fs.readJson('daily_news.json')
 */
async function getStories() {
  if (!useSqlite()) return jsonGetStories();

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM stories ORDER BY created_at DESC")
    .all();
  return rows.map(rowToStory);
}

/**
 * Synchronous sibling of getStories() — better-sqlite3 is natively
 * synchronous, and every non-test caller of getStories currently
 * either awaits it or wraps it in a try/catch. This version is for
 * synchronous code paths like server.js::readNews() that never had
 * an async context to wait in. Falls through to readFileSync for the
 * JSON fallback path, same behaviour, just no Promise.
 *
 * Added in the Phase 3A persistence-cutover patch so /api/news and
 * every readNews() callsite in server.js can prefer SQLite when
 * USE_SQLITE=true without a full async-ification refactor.
 */
function getStoriesSync() {
  if (!useSqlite()) {
    if (!fs.existsSync(DAILY_NEWS_PATH)) return [];
    const raw = fs.readFileSync(DAILY_NEWS_PATH, "utf-8");
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM stories ORDER BY created_at DESC")
    .all();
  return rows.map(rowToStory);
}

/**
 * Returns a single story by ID, or null.
 */
async function getStory(id) {
  if (!useSqlite()) {
    const stories = await jsonGetStories();
    return stories.find((s) => s.id === id) || null;
  }

  const db = getDb();
  const row = db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  return rowToStory(row);
}

/**
 * Synchronous sibling of getStory(). Same semantics as getStoriesSync.
 */
function getStorySync(id) {
  if (!useSqlite()) {
    const stories = getStoriesSync();
    return stories.find((s) => s.id === id) || null;
  }
  const db = getDb();
  const row = db.prepare("SELECT * FROM stories WHERE id = ?").get(id);
  return rowToStory(row);
}

/**
 * Insert or update a single story.
 */
async function upsertStory(story) {
  if (!useSqlite()) {
    const stories = await jsonGetStories();
    const idx = stories.findIndex((s) => s.id === story.id);
    if (idx >= 0) {
      Object.assign(stories[idx], story);
    } else {
      stories.push(story);
    }
    await jsonSaveStories(stories);
    return;
  }

  const db = getDb();
  const row = storyToRow(story);
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  const updates = keys
    .filter((k) => k !== "id")
    .map((k) => `${k} = excluded.${k}`)
    .join(", ");

  const sql = `INSERT INTO stories (${keys.join(", ")})
    VALUES (${placeholders})
    ON CONFLICT(id) DO UPDATE SET ${updates}`;

  db.prepare(sql).run(...keys.map((k) => row[k]));
}

/**
 * Bulk insert/update stories.
 */
async function upsertStories(stories) {
  if (!useSqlite()) {
    const existing = await jsonGetStories();
    const map = new Map(existing.map((s) => [s.id, s]));
    for (const story of stories) {
      if (map.has(story.id)) {
        Object.assign(map.get(story.id), story);
      } else {
        map.set(story.id, story);
      }
    }
    await jsonSaveStories(Array.from(map.values()));
    return;
  }

  const db = getDb();
  const upsert = db.transaction((items) => {
    for (const story of items) {
      const row = storyToRow(story);
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(", ");
      const updates = keys
        .filter((k) => k !== "id")
        .map((k) => `${k} = excluded.${k}`)
        .join(", ");

      const sql = `INSERT INTO stories (${keys.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET ${updates}`;

      db.prepare(sql).run(...keys.map((k) => row[k]));
    }
  });

  upsert(stories);
}

/**
 * Full replace - writes stories array as the complete dataset.
 * For backwards compatibility with code that does writeJson('daily_news.json', stories).
 */
async function saveStories(stories) {
  if (!useSqlite()) {
    await jsonSaveStories(stories);
    return;
  }

  const db = getDb();
  const save = db.transaction((items) => {
    // Upsert all stories (never delete - old stories with platform IDs must persist)
    for (const story of items) {
      const row = storyToRow(story);
      const keys = Object.keys(row);
      const placeholders = keys.map(() => "?").join(", ");
      const updates = keys
        .filter((k) => k !== "id")
        .map((k) => `${k} = excluded.${k}`)
        .join(", ");

      const sql = `INSERT INTO stories (${keys.join(", ")})
        VALUES (${placeholders})
        ON CONFLICT(id) DO UPDATE SET ${updates}`;

      db.prepare(sql).run(...keys.map((k) => row[k]));
    }
  });

  save(stories);
}

/**
 * Stories that are approved, have an exported video, but haven't been published to YouTube yet.
 */
async function getApprovedReady() {
  if (!useSqlite()) {
    const stories = await jsonGetStories();
    return stories.filter(
      (s) => s.approved && s.exported_path && !s.youtube_post_id,
    );
  }

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM stories WHERE approved = 1 AND exported_path IS NOT NULL AND youtube_post_id IS NULL ORDER BY breaking_score DESC",
    )
    .all();
  return rows.map(rowToStory);
}

/**
 * Stories that have been published to at least one platform.
 */
async function getPublished() {
  if (!useSqlite()) {
    const stories = await jsonGetStories();
    return stories.filter(
      (s) => s.youtube_post_id || s.tiktok_post_id || s.instagram_media_id,
    );
  }

  const db = getDb();
  const rows = db
    .prepare(
      "SELECT * FROM stories WHERE youtube_post_id IS NOT NULL OR tiktok_post_id IS NOT NULL OR instagram_media_id IS NOT NULL",
    )
    .all();
  return rows.map(rowToStory);
}

/**
 * Export the stories table as a JSON array matching the daily_news.json format.
 */
async function exportAsJson() {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM stories ORDER BY created_at DESC")
    .all();
  return rows.map(rowToStory);
}

/**
 * Dump the stories table to daily_news.json (for backwards compat / debugging).
 */
async function exportToJsonFile() {
  const stories = await exportAsJson();
  await fs.writeJson(DAILY_NEWS_PATH, stories, { spaces: 2 });
  return stories.length;
}

// ---------- Analytics helpers ----------

async function getAnalyticsHistory() {
  if (!useSqlite()) {
    if (await fs.pathExists(ANALYTICS_HISTORY_PATH)) {
      return fs.readJson(ANALYTICS_HISTORY_PATH);
    }
    return { entries: [], topicStats: {} };
  }

  const db = getDb();
  const entries = db
    .prepare("SELECT * FROM analytics_snapshots ORDER BY updated_at DESC")
    .all();
  const topicRows = db.prepare("SELECT * FROM analytics_topic_stats").all();

  const topicStats = {};
  for (const row of topicRows) {
    topicStats[row.key] = {
      count: row.count,
      totalVirality: row.total_virality,
      avgVirality: row.avg_virality,
    };
  }

  return { entries, topicStats };
}

async function saveAnalyticsHistory(history) {
  if (!useSqlite()) {
    await fs.writeJson(ANALYTICS_HISTORY_PATH, history, { spaces: 2 });
    return;
  }

  const db = getDb();
  const save = db.transaction(() => {
    // Upsert entries
    for (const entry of history.entries || []) {
      const sql = `INSERT INTO analytics_snapshots (
        story_id, title, flair, content_pillar,
        youtube_post_id, tiktok_post_id, instagram_media_id,
        youtube_views, youtube_likes, youtube_comments,
        tiktok_views, tiktok_likes, tiktok_comments, tiktok_shares,
        instagram_views, instagram_likes, instagram_comments,
        total_views, virality_score, published_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(story_id) DO UPDATE SET
        title=excluded.title, flair=excluded.flair, content_pillar=excluded.content_pillar,
        youtube_post_id=excluded.youtube_post_id, tiktok_post_id=excluded.tiktok_post_id,
        instagram_media_id=excluded.instagram_media_id,
        youtube_views=excluded.youtube_views, youtube_likes=excluded.youtube_likes,
        youtube_comments=excluded.youtube_comments,
        tiktok_views=excluded.tiktok_views, tiktok_likes=excluded.tiktok_likes,
        tiktok_comments=excluded.tiktok_comments, tiktok_shares=excluded.tiktok_shares,
        instagram_views=excluded.instagram_views, instagram_likes=excluded.instagram_likes,
        instagram_comments=excluded.instagram_comments,
        total_views=excluded.total_views, virality_score=excluded.virality_score,
        published_at=excluded.published_at, updated_at=excluded.updated_at`;

      db.prepare(sql).run(
        entry.story_id || entry.id,
        entry.title,
        entry.flair,
        entry.content_pillar,
        entry.youtube_post_id,
        entry.tiktok_post_id,
        entry.instagram_media_id,
        entry.youtube_views || 0,
        entry.youtube_likes || 0,
        entry.youtube_comments || 0,
        entry.tiktok_views || 0,
        entry.tiktok_likes || 0,
        entry.tiktok_comments || 0,
        entry.tiktok_shares || 0,
        entry.instagram_views || 0,
        entry.instagram_likes || 0,
        entry.instagram_comments || 0,
        entry.total_views || 0,
        entry.virality_score || 0,
        entry.published_at,
        entry.updated_at,
      );
    }

    // Upsert topic stats
    for (const [key, data] of Object.entries(history.topicStats || {})) {
      db.prepare(
        `INSERT INTO analytics_topic_stats (key, count, total_virality, avg_virality)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET count=excluded.count, total_virality=excluded.total_virality, avg_virality=excluded.avg_virality`,
      ).run(key, data.count, data.totalVirality, data.avgVirality);
    }
  });

  save();
}

// ---------- Breaking log ----------

async function getBreakingLog() {
  if (!useSqlite()) {
    if (await fs.pathExists(BREAKING_LOG_PATH)) {
      return fs.readJson(BREAKING_LOG_PATH);
    }
    return [];
  }

  const db = getDb();
  return db.prepare("SELECT * FROM breaking_log ORDER BY logged_at DESC").all();
}

async function appendBreakingLog(entry) {
  if (!useSqlite()) {
    let log = [];
    if (await fs.pathExists(BREAKING_LOG_PATH)) {
      log = await fs.readJson(BREAKING_LOG_PATH);
    }
    log.push(entry);
    await fs.writeJson(BREAKING_LOG_PATH, log, { spaces: 2 });
    return;
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO breaking_log (story_id, title, breaking_score, flair, source_type, logged_at)
    VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.story_id || entry.id,
    entry.title,
    entry.breaking_score,
    entry.flair,
    entry.source_type,
    entry.logged_at || new Date().toISOString(),
  );
}

// ---------- Engagement log ----------

async function getEngagementStats() {
  if (!useSqlite()) {
    if (
      await fs.pathExists(
        ENGAGEMENT_REPLY_LOG_PATH.replace("reply_log", "stats"),
      )
    ) {
      return fs.readJson(
        ENGAGEMENT_REPLY_LOG_PATH.replace("reply_log", "stats"),
      );
    }
    return {};
  }

  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM engagement_log ORDER BY date DESC")
    .all();
  const stats = {};
  for (const row of rows) {
    stats[row.date] = {
      hearted: row.hearted,
      replies: row.replies,
      pins: row.pins,
    };
  }
  return stats;
}

async function recordEngagementStats(date, hearted, replies, pins) {
  if (!useSqlite()) {
    // Fall through to original implementation
    return null;
  }

  const db = getDb();
  db.prepare(
    `INSERT INTO engagement_log (date, hearted, replies, pins)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date) DO UPDATE SET
      hearted = hearted + excluded.hearted,
      replies = replies + excluded.replies,
      pins = pins + excluded.pins`,
  ).run(date, hearted, replies, pins);
}

// ---------- Cleanup ----------

function closeDb() {
  if (_db) {
    try {
      _db.pragma("wal_checkpoint(TRUNCATE)");
      _db.close();
      _db = null;
      releaseLock();
      console.log("[db] Database closed and WAL checkpointed");
    } catch (err) {
      console.log(`[db] Close error: ${err.message}`);
      releaseLock();
    }
  }
}

function checkpointDb() {
  if (_db) {
    try {
      _db.pragma("wal_checkpoint(PASSIVE)");
    } catch (err) {
      console.log(`[db] Checkpoint error: ${err.message}`);
    }
  }
}

// ---------- Exports ----------

module.exports = {
  useSqlite,
  getDb,
  getStories,
  getStoriesSync,
  getStory,
  getStorySync,
  upsertStory,
  upsertStories,
  getApprovedReady,
  getPublished,
  saveStories,
  exportAsJson,
  exportToJsonFile,
  getAnalyticsHistory,
  saveAnalyticsHistory,
  getBreakingLog,
  appendBreakingLog,
  getEngagementStats,
  recordEngagementStats,
  closeDb,
  close: closeDb,
  checkpoint: checkpointDb,
  // Expose paths for migration script
  DB_PATH,
  DAILY_NEWS_PATH,
  ANALYTICS_HISTORY_PATH,
  BREAKING_LOG_PATH,
  // Pure helper for tests (the DB_PATH constant above is captured at
  // require-time, so tests that want to exercise env-var overrides
  // without re-requiring the module use this directly).
  resolveDbPath,
};
