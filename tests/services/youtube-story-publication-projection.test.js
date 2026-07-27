"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  inspectYoutubeStoryProjection,
  projectYoutubeStoryPublication,
} = require("../../lib/services/youtube-story-publication-projection");

function fixture() {
  const db = new Database(":memory:");
  db.exec(
    `CREATE TABLE stories (
       id TEXT PRIMARY KEY,
       youtube_post_id TEXT,
       youtube_url TEXT,
       youtube_published_at TEXT,
       published_at TEXT,
       publish_status TEXT,
       publish_error TEXT,
       updated_at TEXT
     );
     INSERT INTO stories (id, publish_error)
     VALUES ('story-1', 'prior_failure')`,
  );
  return db;
}

test("shared YouTube projection writes every legacy publication field", () => {
  const db = fixture();
  const projected = projectYoutubeStoryPublication({
    db,
    storyId: "story-1",
    externalId: "yt-public-1",
    externalUrl: "https://www.youtube.com/shorts/yt-public-1",
    publishedAt: "2026-07-27T12:59:00.000Z",
  });

  assert.deepEqual(
    {
      youtube_post_id: projected.youtube_post_id,
      youtube_url: projected.youtube_url,
      youtube_published_at: projected.youtube_published_at,
      published_at: projected.published_at,
      publish_status: projected.publish_status,
    },
    {
      youtube_post_id: "yt-public-1",
      youtube_url: "https://www.youtube.com/shorts/yt-public-1",
      youtube_published_at: "2026-07-27T12:59:00.000Z",
      published_at: "2026-07-27T12:59:00.000Z",
      publish_status: "published",
    },
  );
  assert.equal(
    db
      .prepare("SELECT publish_error FROM stories WHERE id = ?")
      .get("story-1").publish_error,
    null,
  );
  db.close();
});

test("shared YouTube projection exposes identity conflicts before writes", () => {
  const db = fixture();
  db.prepare(
    `UPDATE stories
     SET youtube_url = ?
     WHERE id = ?`,
  ).run(
    "https://www.youtube.com/watch?v=yt-other",
    "story-1",
  );

  const inspection = inspectYoutubeStoryProjection({
    db,
    storyId: "story-1",
    externalId: "yt-public-1",
  });
  assert.deepEqual(inspection.blockers, [
    "story_youtube_url_identity_conflict",
  ]);
  assert.throws(
    () =>
      projectYoutubeStoryPublication({
        db,
        storyId: "story-1",
        externalId: "yt-public-1",
        externalUrl: "https://www.youtube.com/shorts/yt-public-1",
        publishedAt: "2026-07-27T12:59:00.000Z",
      }),
    /story_youtube_url_identity_conflict/,
  );
  assert.equal(
    db
      .prepare("SELECT youtube_post_id FROM stories WHERE id = ?")
      .get("story-1").youtube_post_id,
    null,
  );
  db.close();
});

test("shared YouTube projection rejects a supplied URL for another object", () => {
  const db = fixture();
  assert.throws(
    () =>
      projectYoutubeStoryPublication({
        db,
        storyId: "story-1",
        externalId: "yt-public-1",
        externalUrl: "https://youtu.be/yt-other",
        publishedAt: "2026-07-27T12:59:00.000Z",
      }),
    /youtube_story_projection_url_identity_mismatch/,
  );
  assert.equal(
    db
      .prepare("SELECT youtube_post_id FROM stories WHERE id = ?")
      .get("story-1").youtube_post_id,
    null,
  );
  db.close();
});
