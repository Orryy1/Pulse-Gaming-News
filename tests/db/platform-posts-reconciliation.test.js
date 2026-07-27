"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { bind } = require("../../lib/repositories/platform_posts");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");

function fixture() {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-1",
    "Story one",
  );
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    "pulse-gaming",
    "Pulse Gaming",
  );
  const inserted = db
    .prepare(
      `INSERT INTO platform_posts
         (story_id, channel_id, platform, status, external_id, external_url,
          block_reason, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      "story-1",
      "pulse-gaming",
      "youtube",
      "failed",
      "yt-existing",
      "https://youtube.example/yt-existing",
      "legacy_block",
      "legacy_failure",
    );
  return {
    db,
    id: Number(inserted.lastInsertRowid),
    posts: bind(db),
  };
}

test("markPublished clears stale failure fields and returns canonical row", () => {
  const { db, id, posts } = fixture();
  const row = posts.markPublished(id, {
    externalId: "yt-existing",
    externalUrl: "https://youtube.example/yt-existing",
  });
  assert.equal(row.status, "published");
  assert.equal(row.external_id, "yt-existing");
  assert.equal(row.block_reason, null);
  assert.equal(row.error_message, null);
  assert.ok(row.published_at);
  assert.deepEqual(posts.getById(id), row);
  db.close();
});

test("markPublished reports a missing platform row instead of claiming success", () => {
  const { db, posts } = fixture();
  assert.equal(
    posts.markPublished(999, {
      externalId: "yt-missing",
      externalUrl: null,
    }),
    null,
  );
  assert.equal(posts.getById(999), null);
  db.close();
});

test("markPublished preserves stored evidence and rejects a blank final ID", () => {
  const { db, id, posts } = fixture();
  const preserved = posts.markPublished(id, {
    externalId: null,
    externalUrl: null,
  });
  assert.equal(preserved.external_id, "yt-existing");
  assert.equal(
    preserved.external_url,
    "https://youtube.example/yt-existing",
  );

  const pending = posts.ensurePending("story-1", "instagram_reel", {
    channelId: "pulse-gaming",
    idempotencyKey: "instagram:story-1",
  });
  assert.throws(
    () =>
      posts.markPublished(pending.id, {
        externalId: " ",
        externalUrl: null,
      }),
    /published_platform_external_id_required/,
  );
  assert.equal(posts.getById(pending.id).status, "pending");
  db.close();
});

test("ensurePending cannot reuse an idempotency key across identities", () => {
  const { db, posts } = fixture();
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    "story-2",
    "Story two",
  );
  const original = posts.ensurePending("story-1", "instagram_reel", {
    channelId: "pulse-gaming",
    idempotencyKey: "dispatch:shared",
  });
  assert.equal(original.story_id, "story-1");
  assert.throws(
    () =>
      posts.ensurePending("story-2", "youtube", {
        channelId: "pulse-gaming",
        idempotencyKey: "dispatch:shared",
      }),
    /platform_post_idempotency_conflict/,
  );
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) AS count FROM platform_posts WHERE idempotency_key = ?",
      )
      .get("dispatch:shared").count,
    1,
  );
  db.close();
});

test("published platform identity is immutable and terminal", () => {
  const { db, id, posts } = fixture();
  posts.markPublished(id, {
    externalId: "yt-existing",
    externalUrl: "https://youtube.example/yt-existing",
  });
  assert.throws(
    () =>
      posts.markPublished(id, {
        externalId: "yt-B",
        externalUrl: "https://www.youtube.com/watch?v=yt-B",
      }),
    /published_platform_identity_conflict/,
  );

  posts.markFailed(id, new Error("late callback"));
  posts.markBlocked(id, "late block");
  posts.markSkipped(id, "late skip");
  const current = posts.getById(id);
  assert.equal(current.status, "published");
  assert.equal(current.external_id, "yt-existing");
  assert.equal(
    current.external_url,
    "https://youtube.example/yt-existing",
  );
  db.close();
});

test("anchorExternalObject durably stores the remote identity without declaring publication", () => {
  const { db, posts } = fixture();
  const pending = posts.ensurePending("story-1", "instagram_reel", {
    channelId: "pulse-gaming",
    idempotencyKey: "instagram:story-1:attempt-1",
  });

  const anchored = posts.anchorExternalObject(pending.id, {
    externalId: "ig-created-1",
    externalUrl: "https://instagram.example/reel/ig-created-1",
  });

  assert.equal(anchored.status, "uploading");
  assert.equal(anchored.external_id, "ig-created-1");
  assert.equal(
    anchored.external_url,
    "https://instagram.example/reel/ig-created-1",
  );
  assert.equal(anchored.published_at, null);
  assert.deepEqual(posts.getById(pending.id), anchored);
  assert.throws(
    () =>
      posts.anchorExternalObject(pending.id, {
        externalId: "ig-created-2",
      }),
    /platform_object_identity_conflict/,
  );
  db.close();
});

test("markFailed preserves post-create identity evidence for reconciliation", () => {
  const { db, posts } = fixture();
  const pending = posts.ensurePending("story-1", "facebook_reel", {
    channelId: "pulse-gaming",
    idempotencyKey: "facebook:story-1:attempt-1",
  });

  const failed = posts.markFailed(
    pending.id,
    new Error("adapter returned an ambiguous response"),
    {
      externalId: "fb-created-1",
      externalUrl: "https://facebook.example/reel/fb-created-1",
    },
  );

  assert.equal(failed.status, "failed");
  assert.equal(failed.external_id, "fb-created-1");
  assert.equal(
    failed.external_url,
    "https://facebook.example/reel/fb-created-1",
  );
  assert.match(failed.error_message, /ambiguous response/);
  assert.equal(failed.published_at, null);
  db.close();
});

test("ensurePending starts a new keyed attempt after a failed pre-create attempt", () => {
  const { db, posts } = fixture();
  const first = posts.ensurePending("story-1", "instagram_story", {
    channelId: "pulse-gaming",
    idempotencyKey: "instagram-story:story-1:attempt-1",
  });
  posts.markFailed(first.id, new Error("request failed before create"));

  const retry = posts.ensurePending("story-1", "instagram_story", {
    channelId: "pulse-gaming",
    idempotencyKey: "instagram-story:story-1:attempt-2",
  });

  assert.notEqual(retry.id, first.id);
  assert.equal(retry.status, "pending");
  assert.equal(retry.external_id, null);
  assert.equal(
    retry.idempotency_key,
    "instagram-story:story-1:attempt-2",
  );
  assert.equal(posts.listByStory("story-1").length, 3);
  db.close();
});

test("ensurePending refuses new attempts while an object may exist or work is in flight", () => {
  const { db, posts } = fixture();
  const inFlight = posts.ensurePending("story-1", "instagram_reel", {
    channelId: "pulse-gaming",
    idempotencyKey: "instagram:story-1:attempt-1",
  });
  assert.throws(
    () =>
      posts.ensurePending("story-1", "instagram_reel", {
        channelId: "pulse-gaming",
        idempotencyKey: "instagram:story-1:attempt-2",
      }),
    /platform_post_idempotency_conflict/,
  );

  posts.anchorExternalObject(inFlight.id, {
    externalId: "ig-created-1",
  });
  assert.throws(
    () =>
      posts.ensurePending("story-1", "instagram_reel", {
        channelId: "pulse-gaming",
        idempotencyKey: "instagram:story-1:attempt-2",
      }),
    /platform_post_idempotency_conflict/,
  );

  posts.markFailed(inFlight.id, new Error("confirmation ambiguous"));
  assert.throws(
    () =>
      posts.ensurePending("story-1", "instagram_reel", {
        channelId: "pulse-gaming",
        idempotencyKey: "instagram:story-1:attempt-2",
      }),
    /platform_post_idempotency_conflict/,
  );

  const published = posts.ensurePending("story-1", "facebook_reel", {
    channelId: "pulse-gaming",
    idempotencyKey: "facebook:story-1:attempt-1",
  });
  posts.markPublished(published.id, {
    externalId: "fb-published-1",
    externalUrl: null,
  });
  assert.throws(
    () =>
      posts.ensurePending("story-1", "facebook_reel", {
        channelId: "pulse-gaming",
        idempotencyKey: "facebook:story-1:attempt-2",
      }),
    /platform_post_idempotency_conflict/,
  );
  db.close();
});
