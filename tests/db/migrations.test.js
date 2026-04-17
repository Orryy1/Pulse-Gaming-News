/**
 * tests/db/migrations.test.js — migration runner + migration 011 shape.
 *
 * Verifies:
 *   - runMigrations applies all NNN_*.sql files cleanly against an empty
 *     in-memory DB.
 *   - Second run is a no-op (no duplicate applications).
 *   - Migration 011 creates source_url_hash column + index.
 *   - publish-dedupe's url-hash branch works after migration applies.
 *
 * Run: node --test tests/db/migrations.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { runMigrations, status } = require("../../lib/migrate");

test("runMigrations: applies every migration cleanly to fresh DB", () => {
  const db = new Database(":memory:");
  const res = runMigrations(db, { log: () => {} });
  assert.ok(
    res.applied.length >= 11,
    `expected >=11 migrations, got ${res.applied.length}`,
  );
  assert.equal(res.skipped.length, 0);

  // status() should show every migration as applied now
  const rows = status(db);
  for (const r of rows) {
    assert.equal(r.status, "applied", `${r.filename} not applied`);
  }
});

test("runMigrations: second run is a no-op (all skipped)", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  const second = runMigrations(db, { log: () => {} });
  assert.equal(second.applied.length, 0);
  assert.ok(second.skipped.length >= 11);
});

test("migration 011: stories.source_url_hash column + index exist", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });

  const cols = db
    .prepare("SELECT name FROM pragma_table_info('stories')")
    .all()
    .map((r) => r.name);
  assert.ok(
    cols.includes("source_url_hash"),
    `source_url_hash missing; got columns: ${cols.join(", ")}`,
  );

  const indexes = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='stories'",
    )
    .all()
    .map((r) => r.name);
  assert.ok(
    indexes.includes("idx_stories_source_url_hash"),
    `idx_stories_source_url_hash missing; got indexes: ${indexes.join(", ")}`,
  );
});

test("after migration 011: publish-dedupe url-hash branch is active", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });

  const {
    decidePublish,
    storyUrlHash,
  } = require("../../lib/services/publish-dedupe");
  const {
    bind: bindPlatformPosts,
  } = require("../../lib/repositories/platform_posts");

  // Insert origin story WITH source_url_hash populated (simulates what
  // Phase 2C's hunter-side wiring will do for new stories)
  const originUrl = "https://gamespot.com/pragmata";
  const originHash = storyUrlHash({ url: originUrl });
  db.prepare(
    `INSERT INTO stories (id, title, url, source_url_hash, created_at)
     VALUES (?, ?, ?, ?, datetime('now'))`,
  ).run("pragmata-v1", "Pragmata gameplay", originUrl, originHash);
  db.prepare(
    `INSERT INTO platform_posts (story_id, platform, external_id, status, published_at)
     VALUES ('pragmata-v1', 'instagram_reel', 'ig-orig', 'published', datetime('now'))`,
  ).run();

  // Re-hunted story — different ID, tweaked title, tracking params on URL
  const rehunted = {
    id: "pragmata-v2",
    title: "Watch: Pragmata 20min Switch 2 Gameplay Reveal",
    url: "https://www.gamespot.com/pragmata?utm_source=rss&utm_campaign=twitter",
  };
  // The hunter doesn't know about this yet — insert it without hash,
  // but decidePublish computes the hash from the raw story.url itself
  // so the cross-match works even before Phase 2C backfills.
  db.prepare(
    `INSERT INTO stories (id, title, url, created_at)
     VALUES (?, ?, ?, datetime('now'))`,
  ).run(rehunted.id, rehunted.title, rehunted.url);

  const repos = { db, platformPosts: bindPlatformPosts(db) };
  const decision = decidePublish(rehunted, "instagram_reel", repos);
  // With migration 011 applied, the url-hash branch CAN activate.
  // BUT: pragmata-v2 has no source_url_hash populated yet in the
  // stories table, only pragmata-v1 does. The JOIN matches on
  // stories.source_url_hash equalling the hash of rehunted.url. The
  // incoming story's own hash has to match the ORIGIN story's stored
  // hash. They do match here because both URLs canonicalise to the
  // same value.
  assert.equal(decision.decision, "block_dupe");
  assert.equal(decision.reason, "url-hash");
  assert.equal(decision.existing.external_id, "ig-orig");
});
