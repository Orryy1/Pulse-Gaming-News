-- Every comment the channel has looked at in a video's first hours, and what it did:
-- a reply (with the reply's id) or a skip with the reason. A comment is judged once.

CREATE TABLE IF NOT EXISTS comment_replies (
  comment_id  TEXT PRIMARY KEY,
  episode_id  TEXT NOT NULL,
  video_id    TEXT NOT NULL,
  comment     TEXT NOT NULL,
  decision    TEXT NOT NULL,            -- reply | skip
  reason      TEXT,
  reply_text  TEXT,
  reply_id    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_replies_day_idx ON comment_replies (decision, created_at);
CREATE INDEX IF NOT EXISTS comment_replies_episode_idx ON comment_replies (episode_id);
