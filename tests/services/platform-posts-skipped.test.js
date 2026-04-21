const { test } = require("node:test");
const assert = require("node:assert");
const Database = require("better-sqlite3");
const fs = require("fs-extra");
const path = require("node:path");

// Regression coverage for the Task 10 'skipped' status addition.
// platform_posts used to have only pending / published / blocked /
// failed; optional-platform short-circuits (e.g. Twitter when
// TWITTER_ENABLED !== 'true') had no durable record — they lived
// only in the in-memory result.skipped bucket of a single
// publishNextStory() call. Now an optional-platform skip is a real
// row the analytics digest + Discord summary can point at.

const { bind, PLATFORMS } = require("../../lib/repositories/platform_posts");

function newDb() {
  const db = new Database(":memory:");
  // Apply migrations 001–013 to get a platform_posts table that
  // matches production (channel_id, unique publish guard, etc).
  const migrationsDir = path.join(__dirname, "..", "..", "db", "migrations");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    db.exec(fs.readFileSync(path.join(migrationsDir, f), "utf8"));
  }
  return db;
}

test("PLATFORMS: content types are already enumerated (regression)", () => {
  // Task 10 spec explicitly requires that FB Reel / FB Card / IG
  // Reel / IG Story / Twitter video / Twitter image are DISTINCT
  // platform entries, not one aggregated row per service. This
  // was already true before Task 10 but pin it so future
  // consolidation attempts fail CI.
  const expected = [
    "youtube",
    "tiktok",
    "instagram_reel",
    "instagram_story",
    "facebook_reel",
    "facebook_story",
    "twitter_video",
    "twitter_image",
  ];
  for (const p of expected) {
    assert.ok(PLATFORMS.includes(p), `missing platform: ${p}`);
  }
});

test("markSkipped: records an optional-platform skip as its own row state", () => {
  const db = newDb();
  // Seed a story + channel row so the FKs are happy.
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse')`,
  ).run();
  db.prepare(
    `INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`,
  ).run("s1", "Story", "pulse-gaming");

  const repo = bind(db);
  const row = repo.ensurePending("s1", "twitter_video", {
    channelId: "pulse-gaming",
  });
  repo.markSkipped(row.id, "twitter_disabled");

  const after = repo.getByStoryPlatform("s1", "twitter_video");
  assert.strictEqual(after.status, "skipped");
  assert.strictEqual(after.block_reason, "twitter_disabled");
  assert.strictEqual(after.external_id, null);
  assert.strictEqual(after.error_message, null);
});

test("markSkipped: default reason when none supplied", () => {
  const db = newDb();
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse')`,
  ).run();
  db.prepare(
    `INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`,
  ).run("s2", "Story2", "pulse-gaming");
  const repo = bind(db);
  const row = repo.ensurePending("s2", "twitter_video");
  repo.markSkipped(row.id);
  const after = repo.getByStoryPlatform("s2", "twitter_video");
  assert.strictEqual(after.block_reason, "skipped");
});

test("getLegacyShape: skipped optional platform does NOT appear as a published ID", () => {
  // The Discord summary is built from result.skipped + result.twitter
  // booleans, but any downstream consumer that still reads through
  // getLegacyShape expects *_post_id to be populated only for real
  // publishes. A skipped Twitter should NOT become a twitter_post_id
  // in that view — that would make the analytics digest think
  // Twitter published.
  const db = newDb();
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse')`,
  ).run();
  db.prepare(
    `INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`,
  ).run("s3", "Story3", "pulse-gaming");
  const repo = bind(db);
  const yt = repo.ensurePending("s3", "youtube");
  repo.markPublished(yt.id, {
    externalId: "yt_real_id",
    externalUrl: "https://youtube.com/shorts/yt_real_id",
  });
  const tw = repo.ensurePending("s3", "twitter_video");
  repo.markSkipped(tw.id, "twitter_disabled");

  const shape = repo.getLegacyShape("s3");
  assert.strictEqual(shape.youtube_post_id, "yt_real_id");
  assert.strictEqual(
    shape.youtube_url,
    "https://youtube.com/shorts/yt_real_id",
  );
  // Twitter must NOT show up — it was skipped, not published.
  assert.strictEqual(shape.twitter_post_id, undefined);
});

test("FB Reel and FB Card persist as separate rows (regression)", () => {
  // Task 5 of the overnight session already pinned FB Reel vs FB
  // Card separation at the Discord-summary layer. Re-pin it here
  // at the data layer: a successful FB Card must not appear in
  // the shape as facebook_post_id.
  const db = newDb();
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse')`,
  ).run();
  db.prepare(
    `INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`,
  ).run("s4", "Story4", "pulse-gaming");
  const repo = bind(db);
  const reel = repo.ensurePending("s4", "facebook_reel");
  repo.markFailed(reel.id, "Reel upload timed out");
  const card = repo.ensurePending("s4", "facebook_story");
  repo.markPublished(card.id, {
    externalId: "fb_card_id",
  });
  const shape = repo.getLegacyShape("s4");
  // The Reel failed — nothing for facebook_post_id.
  assert.strictEqual(shape.facebook_post_id, undefined);
  // The Card succeeded, but it lands on facebook_story_id, NOT
  // facebook_post_id. So a card success cannot masquerade as a
  // Reel success at the legacy-shape level either.
  assert.strictEqual(shape.facebook_story_id, "fb_card_id");
});

test("TikTok failure persisted safely — error message stored, no external_id", () => {
  const db = newDb();
  db.prepare(
    `INSERT OR IGNORE INTO channels (id, name) VALUES ('pulse-gaming', 'Pulse')`,
  ).run();
  db.prepare(
    `INSERT INTO stories (id, title, channel_id) VALUES (?, ?, ?)`,
  ).run("s5", "Story5", "pulse-gaming");
  const repo = bind(db);
  const tt = repo.ensurePending("s5", "tiktok");
  repo.markFailed(tt.id, new Error("TikTok not authenticated"));
  const row = repo.getByStoryPlatform("s5", "tiktok");
  assert.strictEqual(row.status, "failed");
  assert.strictEqual(row.external_id, null);
  assert.strictEqual(row.error_message, "TikTok not authenticated");
  const shape = repo.getLegacyShape("s5");
  assert.strictEqual(shape.tiktok_post_id, undefined);
});
