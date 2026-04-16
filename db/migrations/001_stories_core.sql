-- 001_stories_core.sql
-- Brings the pre-migration schema under version control.
--
-- This migration matches what lib/db.js's inline initSchema() has been
-- creating. On an existing install the CREATE TABLE IF NOT EXISTS / CREATE
-- INDEX IF NOT EXISTS statements are no-ops — the migration simply records
-- that version 001 is "applied" so future migrations can safely ALTER.

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
