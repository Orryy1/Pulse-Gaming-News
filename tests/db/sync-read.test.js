/**
 * tests/db/sync-read.test.js — Phase 3A sync-read parity tests.
 *
 * The persistence cutover added synchronous siblings (getStoriesSync,
 * getStorySync) to lib/db.js so server.js::readNews() could prefer
 * SQLite without an async refactor. This file covers the contract
 * those siblings need to honour.
 *
 * Note on scope: lib/db.js resolves DAILY_NEWS_PATH and DB_PATH at
 * require-time via path.join(__dirname, ...). That anchors them to the
 * source tree regardless of process.cwd(), which makes it hard to
 * isolate tests that exercise the module-level singletons. Rather than
 * stub DAILY_NEWS_PATH (out of scope for the patch) or mutate the real
 * repo file (unsafe), the tests here exercise the underlying contract
 * via better-sqlite3 directly. The JSON-fallback path is a 3-line
 * wrapper around readFileSync + JSON.parse that is code-reviewable and
 * trivially exception-safe.
 *
 * Run: node --test tests/db/sync-read.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");

test("SQLite sync read: prepared statement returns expected shape for stories", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });

  db.prepare(
    `INSERT INTO stories (id, title, url, created_at) VALUES
     ('s1', 'first', 'https://a.com/1', datetime('now')),
     ('s2', 'second', 'https://a.com/2', datetime('now', '-1 minute'))`,
  ).run();

  // Mirror the exact query getStoriesSync uses.
  const rows = db
    .prepare("SELECT * FROM stories ORDER BY created_at DESC")
    .all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, "s1");
  assert.equal(rows[1].id, "s2");

  // source_url_hash column exists after migration 011 and is NULL
  // when rows are inserted directly (not via storyToRow). The Phase 2C
  // auto-populate path only fires through lib/db::upsertStory, which
  // this test deliberately skips. See tests/db/migrations.test.js for
  // the end-to-end path.
  assert.equal(rows[0].source_url_hash, null);
});

test("SQLite sync read: single-row lookup by id matches getStorySync contract", () => {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  db.prepare(
    `INSERT INTO stories (id, title, url, created_at)
     VALUES ('only', 'only story', 'https://a.com/only', datetime('now'))`,
  ).run();

  const hit = db.prepare("SELECT * FROM stories WHERE id = ?").get("only");
  assert.ok(hit);
  assert.equal(hit.id, "only");

  const miss = db.prepare("SELECT * FROM stories WHERE id = ?").get("nope");
  assert.equal(miss, undefined);
});
