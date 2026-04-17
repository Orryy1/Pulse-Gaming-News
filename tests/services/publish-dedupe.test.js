/**
 * tests/services/publish-dedupe.test.js — decision matrix for
 * lib/services/publish-dedupe::decidePublish.
 *
 * Exercises all four decision branches:
 *   1. already_published (exact story_id + platform match)
 *   2. block_dupe / url-hash  (cross-story canonical URL match)
 *   3. block_dupe / title-jaccard (legacy fallback)
 *   4. publish (no match)
 *
 * The url-hash branch is the Pragmata regression case — a re-hunted
 * article with a slightly different title that slipped past the old
 * Jaccard threshold. The new canonical-URL hash catches it.
 *
 * Uses better-sqlite3 in-memory DB + minimal schema matching migrations
 * 003 and a future 011 (source_url_hash column). No network, no
 * filesystem.
 *
 * Run: node --test tests/services/publish-dedupe.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const {
  decidePublish,
  storyUrlHash,
  titleJaccard,
} = require("../../lib/services/publish-dedupe");
const {
  bind: bindPlatformPosts,
} = require("../../lib/repositories/platform_posts");

// ---- Fixture helpers -----------------------------------------------------

function makeDb({ withUrlHashColumn = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY,
      name TEXT,
      niche TEXT
    );
    CREATE TABLE stories (
      id TEXT PRIMARY KEY,
      title TEXT,
      url TEXT${withUrlHashColumn ? ",\n      source_url_hash TEXT" : ""}
    );
    CREATE TABLE platform_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      channel_id TEXT,
      platform TEXT NOT NULL,
      external_id TEXT,
      external_url TEXT,
      status TEXT NOT NULL,
      block_reason TEXT,
      error_message TEXT,
      idempotency_key TEXT,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      stats_fetched_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX ux_platform_posts_story_platform_published
      ON platform_posts(story_id, platform)
      WHERE status = 'published';
  `);
  return db;
}

function insertStory(db, { id, title, url, hash = null }) {
  const hasHashCol =
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM pragma_table_info('stories') WHERE name='source_url_hash'",
      )
      .get().c > 0;
  if (hasHashCol) {
    db.prepare(
      "INSERT INTO stories (id, title, url, source_url_hash) VALUES (?, ?, ?, ?)",
    ).run(id, title, url, hash || storyUrlHash({ url }));
  } else {
    db.prepare("INSERT INTO stories (id, title, url) VALUES (?, ?, ?)").run(
      id,
      title,
      url,
    );
  }
}

function insertPublished(db, { storyId, platform, externalId }) {
  db.prepare(
    `INSERT INTO platform_posts
      (story_id, platform, external_id, status, published_at)
     VALUES (?, ?, ?, 'published', datetime('now'))`,
  ).run(storyId, platform, externalId);
}

function makeRepos(db) {
  return { db, platformPosts: bindPlatformPosts(db) };
}

// ---- Branch 1: already_published -----------------------------------------

test("decidePublish: exact story_id+platform already published -> already_published", () => {
  const db = makeDb();
  insertStory(db, {
    id: "s1",
    title: "Pragmata 20 min gameplay",
    url: "https://gamespot.com/pragmata",
  });
  insertPublished(db, {
    storyId: "s1",
    platform: "youtube",
    externalId: "yt-abc123",
  });
  const repos = makeRepos(db);

  const r = decidePublish(
    {
      id: "s1",
      title: "Pragmata 20 min gameplay",
      url: "https://gamespot.com/pragmata",
    },
    "youtube",
    repos,
  );
  assert.equal(r.decision, "already_published");
  assert.equal(r.reason, "yt-abc123");
  assert.ok(r.existing);
});

// ---- Branch 2: url-hash cross-story block (Pragmata regression) ----------

test("Pragmata regression: re-hunted story with tweaked title -> block_dupe url-hash", () => {
  const db = makeDb();
  // Original story: first hunt, published to IG
  insertStory(db, {
    id: "pragmata-v1",
    title: "Pragmata - 20 Minutes of Nintendo Switch 2 Gameplay",
    url: "https://gamespot.com/articles/pragmata-gameplay?utm_source=rss",
  });
  insertPublished(db, {
    storyId: "pragmata-v1",
    platform: "instagram_reel",
    externalId: "ig-original-id",
  });

  // Re-hunted story: different story_id, slightly shifted title, same
  // canonical URL (different utm). The LEGACY Jaccard 0.5 check would
  // still catch this particular example because the word overlap is
  // very high — but the test's job is to prove the URL-hash branch
  // fires FIRST (before the fallback would have), so the reason is
  // "url-hash" not "title-jaccard".
  const rehunted = {
    id: "pragmata-v2",
    title: "Watch: Pragmata - 20 Minutes of Switch 2 Gameplay Revealed",
    url: "https://www.gamespot.com/articles/pragmata-gameplay?utm_campaign=twitter",
  };
  const r = decidePublish(rehunted, "instagram_reel", makeRepos(db));
  assert.equal(r.decision, "block_dupe");
  assert.equal(r.reason, "url-hash");
  assert.equal(r.existing.external_id, "ig-original-id");
});

test("url-hash branch: different platform doesn't block (asymmetry preserved)", () => {
  const db = makeDb();
  insertStory(db, {
    id: "orig",
    title: "Story",
    url: "https://site.com/a",
  });
  insertPublished(db, {
    storyId: "orig",
    platform: "youtube",
    externalId: "yt-1",
  });

  // Same URL, same platform (YouTube) → should block
  const rehunted = {
    id: "rehunt",
    title: "Story v2",
    url: "https://site.com/a",
  };
  const ytDecision = decidePublish(rehunted, "youtube", makeRepos(db));
  assert.equal(ytDecision.decision, "block_dupe");
  assert.equal(ytDecision.reason, "url-hash");

  // Same URL, different platform (IG) → allowed, because IG has no
  // prior publish for this article
  const igDecision = decidePublish(rehunted, "instagram_reel", makeRepos(db));
  assert.equal(igDecision.decision, "publish");
});

test("url-hash branch: a blocked platform_posts row does NOT trigger block (only 'published' counts)", () => {
  const db = makeDb();
  insertStory(db, { id: "orig", title: "Story", url: "https://site.com/a" });
  // A prior attempt was BLOCKED (never actually published)
  db.prepare(
    `INSERT INTO platform_posts (story_id, platform, status, block_reason)
     VALUES ('orig', 'youtube', 'blocked', 'some-reason')`,
  ).run();

  const rehunted = { id: "rehunt", title: "Story", url: "https://site.com/a" };
  const r = decidePublish(rehunted, "youtube", makeRepos(db));
  // Nothing has actually been published, so we should still try.
  assert.equal(r.decision, "publish");
});

// ---- Branch 3: title-jaccard legacy fallback -----------------------------

test("title-jaccard fallback: no URL present -> matches legacy array", () => {
  const db = makeDb();
  // Incoming story has no URL at all
  const incoming = {
    id: "s-new",
    title: "Pragmata 20 minute gameplay reveal",
    url: "",
  };
  const legacyStories = [
    {
      id: "s-old",
      title: "Pragmata 20 minute gameplay reveal trailer",
      instagram_media_id: "ig-real-id",
    },
  ];
  const r = decidePublish(incoming, "instagram_reel", makeRepos(db), {
    legacyStoriesArray: legacyStories,
  });
  assert.equal(r.decision, "block_dupe");
  assert.equal(r.reason, "title-jaccard");
  assert.equal(r.existing.story_id, "s-old");
});

test("title-jaccard fallback: DUPE_SKIPPED sentinel in legacy row is NOT a match", () => {
  const db = makeDb();
  const incoming = { id: "s-new", title: "Same title exactly", url: "" };
  // Legacy row has only a sentinel — shouldn't count as a real match
  const legacyStories = [
    {
      id: "s-old",
      title: "Same title exactly",
      instagram_media_id: "DUPE_SKIPPED",
    },
  ];
  const r = decidePublish(incoming, "instagram_reel", makeRepos(db), {
    legacyStoriesArray: legacyStories,
  });
  assert.equal(r.decision, "publish");
});

test("title-jaccard fallback: below threshold -> publish", () => {
  const db = makeDb();
  const incoming = {
    id: "s-new",
    title: "Completely different headline about a new game",
    url: "",
  };
  const legacyStories = [
    {
      id: "s-old",
      title: "Pragmata - 20 Minutes of Nintendo Switch 2 Gameplay",
      instagram_media_id: "ig-real-id",
    },
  ];
  const r = decidePublish(incoming, "instagram_reel", makeRepos(db), {
    legacyStoriesArray: legacyStories,
  });
  assert.equal(r.decision, "publish");
});

// ---- Branch 4: publish ---------------------------------------------------

test("decidePublish: no matches at all -> publish", () => {
  const db = makeDb();
  insertStory(db, {
    id: "s1",
    title: "Totally new story",
    url: "https://example.com/new",
  });
  const r = decidePublish(
    { id: "s1", title: "Totally new story", url: "https://example.com/new" },
    "youtube",
    makeRepos(db),
  );
  assert.equal(r.decision, "publish");
  assert.equal(r.reason, null);
  assert.equal(r.existing, null);
});

// ---- Safety: migration 011 not yet applied -------------------------------

test("graceful fallback when source_url_hash column missing", () => {
  // Simulates a DB that has platform_posts (migration 003) but not yet
  // the source_url_hash column (migration 011). The service must not
  // throw — it should skip the URL-hash branch and fall through to
  // title-jaccard or publish.
  const db = makeDb({ withUrlHashColumn: false });
  insertStory(db, {
    id: "s1",
    title: "Story",
    url: "https://site.com/a",
  });
  const r = decidePublish(
    { id: "s1", title: "Story", url: "https://site.com/a" },
    "youtube",
    makeRepos(db),
  );
  // No legacy array, no URL-hash match (column missing), no exact match.
  assert.equal(r.decision, "publish");
});

// ---- titleJaccard sanity checks ------------------------------------------

test("titleJaccard: identical titles -> 1.0", () => {
  assert.equal(titleJaccard("a b c", "a b c"), 1);
});
test("titleJaccard: disjoint -> 0", () => {
  assert.equal(titleJaccard("a b c", "x y z"), 0);
});
test("titleJaccard: empty inputs -> 0", () => {
  assert.equal(titleJaccard("", "a b"), 0);
  assert.equal(titleJaccard(null, "a"), 0);
});

// ---- Input validation ----------------------------------------------------

test("decidePublish: missing story.id throws", () => {
  assert.throws(
    () => decidePublish({ title: "x" }, "youtube", makeRepos(makeDb())),
    /story\.id required/,
  );
});
test("decidePublish: missing platform throws", () => {
  assert.throws(
    () => decidePublish({ id: "s" }, null, makeRepos(makeDb())),
    /platform required/,
  );
});
test("decidePublish: missing repos.platformPosts throws", () => {
  assert.throws(
    () => decidePublish({ id: "s" }, "youtube", {}),
    /repos\.platformPosts required/,
  );
});
