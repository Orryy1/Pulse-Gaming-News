#!/usr/bin/env node

/**
 * One-time migration script: JSON files -> SQLite
 *
 * Reads existing JSON data files and imports them into the SQLite database.
 * Safe to run multiple times — uses upsert logic so existing rows are updated.
 *
 * Usage: node lib/db-migrate.js
 */

const fs = require('fs-extra');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ override: true });

// Force SQLite on for migration regardless of env var
process.env.USE_SQLITE = 'true';

const db = require('./db');

const DAILY_NEWS_PATH = path.join(__dirname, '..', 'daily_news.json');
const ANALYTICS_HISTORY_PATH = path.join(__dirname, '..', 'analytics_history.json');
const BREAKING_LOG_PATH = path.join(__dirname, '..', 'breaking_log.json');
const ENGAGEMENT_STATS_PATH = path.join(__dirname, '..', 'engagement_stats.json');

async function migrate() {
  console.log('[db-migrate] === SQLite Migration ===');
  console.log(`[db-migrate] Database: ${db.DB_PATH}`);

  // Ensure the database is initialised (schema created)
  db.getDb();

  // 1. Migrate daily_news.json -> stories table
  if (await fs.pathExists(DAILY_NEWS_PATH)) {
    const stories = await fs.readJson(DAILY_NEWS_PATH);
    console.log(`[db-migrate] Importing ${stories.length} stories from daily_news.json...`);

    const sqlite = db.getDb();
    const upsert = sqlite.transaction((items) => {
      for (const story of items) {
        // Convert the story to a row
        const row = storyToRow(story);
        const keys = Object.keys(row);
        const placeholders = keys.map(() => '?').join(', ');
        const updates = keys.filter(k => k !== 'id').map(k => `${k} = excluded.${k}`).join(', ');

        const sql = `INSERT INTO stories (${keys.join(', ')})
          VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET ${updates}`;

        sqlite.prepare(sql).run(...keys.map(k => row[k]));
      }
    });

    upsert(stories);
    console.log(`[db-migrate] Imported ${stories.length} stories`);
  } else {
    console.log('[db-migrate] No daily_news.json found — skipping stories');
  }

  // 2. Migrate analytics_history.json -> analytics_snapshots + analytics_topic_stats
  if (await fs.pathExists(ANALYTICS_HISTORY_PATH)) {
    const history = await fs.readJson(ANALYTICS_HISTORY_PATH);
    const entries = history.entries || [];
    const topicStats = history.topicStats || {};

    console.log(`[db-migrate] Importing ${entries.length} analytics entries and ${Object.keys(topicStats).length} topic stats...`);

    await db.saveAnalyticsHistory(history);
    console.log(`[db-migrate] Imported analytics history`);
  } else {
    console.log('[db-migrate] No analytics_history.json found — skipping analytics');
  }

  // 3. Migrate breaking_log.json -> breaking_log table
  if (await fs.pathExists(BREAKING_LOG_PATH)) {
    const log = await fs.readJson(BREAKING_LOG_PATH);
    const entries = Array.isArray(log) ? log : [];

    console.log(`[db-migrate] Importing ${entries.length} breaking log entries...`);

    const sqlite = db.getDb();
    const insert = sqlite.transaction((items) => {
      for (const entry of items) {
        sqlite.prepare(`INSERT OR IGNORE INTO breaking_log (story_id, title, breaking_score, flair, source_type, logged_at)
          VALUES (?, ?, ?, ?, ?, ?)`)
          .run(
            entry.story_id || entry.id || '',
            entry.title || '',
            entry.breaking_score || 0,
            entry.flair || '',
            entry.source_type || '',
            entry.logged_at || entry.timestamp || new Date().toISOString()
          );
      }
    });

    insert(entries);
    console.log(`[db-migrate] Imported ${entries.length} breaking log entries`);
  } else {
    console.log('[db-migrate] No breaking_log.json found — skipping breaking log');
  }

  // 4. Migrate engagement_stats.json -> engagement_log table
  if (await fs.pathExists(ENGAGEMENT_STATS_PATH)) {
    const stats = await fs.readJson(ENGAGEMENT_STATS_PATH);

    const dates = Object.keys(stats);
    console.log(`[db-migrate] Importing ${dates.length} engagement stat days...`);

    const sqlite = db.getDb();
    const insert = sqlite.transaction((entries) => {
      for (const [date, data] of entries) {
        sqlite.prepare(`INSERT OR REPLACE INTO engagement_log (date, hearted, replies, pins)
          VALUES (?, ?, ?, ?)`)
          .run(date, data.hearted || 0, data.replies || 0, data.pins || 0);
      }
    });

    insert(Object.entries(stats));
    console.log(`[db-migrate] Imported ${dates.length} engagement stat days`);
  } else {
    console.log('[db-migrate] No engagement_stats.json found — skipping engagement stats');
  }

  // Summary
  const sqlite = db.getDb();
  const storyCount = sqlite.prepare('SELECT COUNT(*) as c FROM stories').get().c;
  const analyticsCount = sqlite.prepare('SELECT COUNT(*) as c FROM analytics_snapshots').get().c;
  const breakingCount = sqlite.prepare('SELECT COUNT(*) as c FROM breaking_log').get().c;
  const engagementCount = sqlite.prepare('SELECT COUNT(*) as c FROM engagement_log').get().c;

  console.log('\n[db-migrate] === Migration Complete ===');
  console.log(`[db-migrate] stories:             ${storyCount}`);
  console.log(`[db-migrate] analytics_snapshots:  ${analyticsCount}`);
  console.log(`[db-migrate] breaking_log:         ${breakingCount}`);
  console.log(`[db-migrate] engagement_log:        ${engagementCount}`);
  console.log(`[db-migrate] Database: ${db.DB_PATH}`);

  db.closeDb();
}

// ---------- storyToRow (duplicated from db.js internals for migration) ----------

const JSON_FIELDS = new Set(['title_variants', 'game_images', 'downloaded_images']);
const STORIES_COLUMNS = new Set([
  'id', 'title', 'url', 'score', 'flair', 'subreddit', 'source_type',
  'breaking_score', 'top_comment', 'timestamp', 'num_comments',
  'hook', 'body', 'loop', 'full_script', 'tts_script', 'word_count',
  'suggested_title', 'suggested_thumbnail_text', 'content_pillar',
  'affiliate_url', 'pinned_comment', 'approved', 'auto_approved', 'approved_at',
  'audio_path', 'image_path', 'exported_path',
  'youtube_post_id', 'youtube_url', 'tiktok_post_id', 'instagram_media_id',
  'facebook_post_id', 'twitter_post_id',
  'article_image', 'article_url', 'company_name', 'company_logo_url',
  'classification', 'quality_score', 'title_variants', 'active_title_index',
  'game_images', 'downloaded_images', 'story_image_path', 'cta',
  'publish_status', 'publish_error',
  'youtube_published_at', 'youtube_views', 'youtube_likes', 'youtube_comments',
  'tiktok_views', 'tiktok_likes', 'tiktok_comments', 'tiktok_shares',
  'instagram_views', 'instagram_likes', 'instagram_comments',
  'virality_score', 'stats_fetched_at',
  'engagement_comment_id', 'engagement_hearts', 'engagement_replies', 'engagement_last_run',
  'schedule_time',
  'created_at', 'updated_at', 'published_at',
  '_extra',
]);

function storyToRow(story) {
  const row = {};
  const extra = {};

  for (const [key, value] of Object.entries(story)) {
    if (STORIES_COLUMNS.has(key)) {
      if (JSON_FIELDS.has(key) && value !== null && value !== undefined && typeof value !== 'string') {
        row[key] = JSON.stringify(value);
      } else if (typeof value === 'boolean') {
        row[key] = value ? 1 : 0;
      } else {
        row[key] = value === undefined ? null : value;
      }
    } else {
      if (value !== undefined && value !== null) {
        extra[key] = value;
      }
    }
  }

  if (Object.keys(extra).length > 0) {
    row._extra = JSON.stringify(extra);
  }

  if (!row.updated_at) {
    row.updated_at = new Date().toISOString();
  }

  return row;
}

// ---------- Run ----------

migrate().catch(err => {
  console.error(`[db-migrate] FATAL: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
