-- 019_media_provenance.sql
-- Asset provenance ledger (audit P1 #2 / #8).
--
-- Per the 2026-04-29 forensic audit:
--   "Asset provenance is not yet first-class enough for a premium
--    operation. Make asset provenance mandatory: source URL, source
--    type, detected content type, licence/risk class, story relevance
--    score, thumbnail safety verdict, reason accepted/rejected."
--
-- Two new tables.
--
-- media_provenance — one row per downloaded asset. Append-only.
--   Indexed by content_hash so dedupe-across-stories is cheap, plus
--   by story_id for per-story rollups, and by source_type for
--   licence/source distribution audits. raw_meta_json carries the
--   full upstream response payload for forensic recovery if a source
--   later denies serving.
--
-- visual_content_signals — pixel-level prescan output keyed by
--   content_hash so a single image only gets scanned once even if
--   it's referenced by N stories. Records ratios that indicate
--   whether the asset is likely a face photo, an avatar, a logo,
--   stock people, etc. Heuristic, not identification.

CREATE TABLE IF NOT EXISTS media_provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  channel_id TEXT NOT NULL DEFAULT 'pulse-gaming',
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Source identity
  source_url TEXT NOT NULL,
  source_type TEXT NOT NULL,
  -- one of: article_hero, article_inline, steam_capsule, steam_hero,
  -- steam_key_art, steam_screenshot, steam_trailer, igdb_cover,
  -- igdb_screenshot, reddit_thumb, company_logo, pexels, unsplash,
  -- bing, youtube_broll, other

  -- Asset identity
  file_path TEXT,
  file_size_bytes INTEGER,
  mime_type TEXT,
  content_hash TEXT,
  -- sha256 hex string. Lets two stories that downloaded the same
  -- image share one row in visual_content_signals.

  -- Classification
  detected_content_type TEXT,
  -- one of: photo, illustration, screenshot, key_art, logo, avatar,
  -- portrait, stock, infographic, unknown
  licence_class TEXT,
  -- one of: official_publisher, store_metadata, royalty_free,
  -- editorial_use, scraped_unknown, fair_use_review, blocked
  story_relevance_score REAL,
  -- 0..1 — does the image actually depict the story's subject?
  thumbnail_safety_verdict TEXT,
  -- pass | warn | fail
  thumbnail_safety_reasons_json TEXT,

  -- Decision audit trail
  accepted INTEGER NOT NULL DEFAULT 1,
  -- 1 if the asset was accepted into the render set, 0 if rejected
  reject_reason TEXT,
  -- enum tag when accepted=0; null otherwise

  raw_meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_provenance_story
  ON media_provenance (story_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_provenance_content_hash
  ON media_provenance (content_hash);

CREATE INDEX IF NOT EXISTS idx_provenance_source_type
  ON media_provenance (source_type, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_provenance_accepted
  ON media_provenance (accepted, reject_reason);

CREATE TABLE IF NOT EXISTS visual_content_signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_hash TEXT NOT NULL UNIQUE,
  scanned_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- Image metadata
  width INTEGER,
  height INTEGER,
  aspect_ratio REAL,
  is_animated INTEGER NOT NULL DEFAULT 0,

  -- Pixel-level signals (ratios in 0..1 range)
  skin_tone_ratio REAL,
  -- proportion of pixels in the central rectangle matching skin tones.
  -- High values = likely face/person photo.
  central_luminance_oval REAL,
  -- correlation between the central image region and an oval
  -- luminance template. High values = face-like centerpiece.
  edge_density REAL,
  -- proportion of high-gradient pixels. Low + oval = portrait;
  -- high = screenshot / illustration / detailed art.
  saturation_mean REAL,
  text_overlay_likelihood REAL,
  -- heuristic: ratio of high-contrast horizontal edges,
  -- which correlates with embedded text / logos.

  -- Composite verdicts (heuristic, not identification)
  likely_has_face INTEGER NOT NULL DEFAULT 0,
  likely_is_logo INTEGER NOT NULL DEFAULT 0,
  likely_is_screenshot INTEGER NOT NULL DEFAULT 0,
  likely_is_stock_person INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_visual_signals_hash
  ON visual_content_signals (content_hash);

CREATE INDEX IF NOT EXISTS idx_visual_signals_face
  ON visual_content_signals (likely_has_face, scanned_at DESC);
