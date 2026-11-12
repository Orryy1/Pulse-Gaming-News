-- The community engine (COMMUNITY_ENGINE, src/youtube/viewers.ts): who wrote each judged comment, so a person is
-- answered once per video, and what the Studio routine should do with it (a heart, a pin score, the comment's kind).

ALTER TABLE comment_replies ADD COLUMN IF NOT EXISTS author_channel TEXT;
ALTER TABLE comment_replies ADD COLUMN IF NOT EXISTS author_name TEXT;
ALTER TABLE comment_replies ADD COLUMN IF NOT EXISTS heart BOOLEAN;
ALTER TABLE comment_replies ADD COLUMN IF NOT EXISTS pin_score INTEGER;
ALTER TABLE comment_replies ADD COLUMN IF NOT EXISTS kind TEXT;
CREATE INDEX IF NOT EXISTS comment_replies_author_idx ON comment_replies (video_id, author_channel);
