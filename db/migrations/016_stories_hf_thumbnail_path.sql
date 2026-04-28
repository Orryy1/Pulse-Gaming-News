-- 016_stories_hf_thumbnail_path.sql
--
-- Promote hf_thumbnail_path from the _extra JSON blob to a real
-- column on stories. The path stores the 1280x720 JPEG produced by
-- lib/studio/v2/hf-thumbnail-builder.js's batch helper (see
-- publisher.js produce flow). Wiring shipped in commit f1a9e6b
-- which intentionally let the field land in _extra for zero-risk
-- rollout. Now that the round-trip is verified, give it a proper
-- column so:
--   1. self-heal queries can index on it like the other media
--      paths (exported_path, audio_path, image_path,
--      story_image_path)
--   2. dashboards / analytics can SELECT WHERE hf_thumbnail_path
--      IS NOT NULL without parsing JSON
--   3. the YouTube uploader's preference chain
--      (hf_thumbnail_path → story_image_path → image_path) reads
--      from a column native to the stories table
--
-- Backfill existing rows: any row that already stamped a path into
-- _extra during the post-f1a9e6b window gets its value promoted.
-- The mapper in lib/db.js storyToRow() will stop writing the field
-- to _extra on the next upsert because STORIES_COLUMNS now claims
-- it as a known column.

ALTER TABLE stories ADD COLUMN hf_thumbnail_path TEXT;

UPDATE stories
SET hf_thumbnail_path = json_extract(_extra, '$.hf_thumbnail_path')
WHERE _extra IS NOT NULL
  AND json_extract(_extra, '$.hf_thumbnail_path') IS NOT NULL
  AND hf_thumbnail_path IS NULL;
