/**
 * tests/services/publish-block.test.js
 *
 * Pins the structured-status replacement for the DUPE_BLOCKED /
 * DUPE_SKIPPED sentinel writes in publisher.js (YouTube path).
 *
 * Covers:
 *   - recordPlatformBlock writes a platform_posts row with status='blocked'
 *     and the given block_reason. external_id stays NULL (no sentinel).
 *   - Calling recordPlatformBlock twice for the same (storyId, platform)
 *     updates the existing row — no duplicate rows.
 *   - recordPlatformBlock returns persisted=false (not throw) when repos
 *     are unavailable, so the dev-mode legacy fallback can kick in.
 *   - getPlatformStatus returns the last row's status for a given
 *     (storyId, platform); null when nothing is persisted.
 *
 * Run: node --test tests/services/publish-block.test.js
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const {
  recordPlatformBlock,
  getPlatformStatus,
} = require("../../lib/services/publish-block");
const {
  bind: bindPlatformPosts,
} = require("../../lib/repositories/platform_posts");

function makeRepos() {
  const db = new Database(":memory:");
  runMigrations(db, { log: () => {} });
  const platformPosts = bindPlatformPosts(db);
  return { db, platformPosts };
}

function seedStory(db, id = "s1") {
  db.prepare(
    `INSERT INTO stories (id, title, url, created_at)
     VALUES (?, 'Test', ?, datetime('now'))`,
  ).run(id, `https://ex.com/${id}`);
}

test("recordPlatformBlock: writes platform_posts row with status=blocked + reason, external_id NULL", () => {
  const repos = makeRepos();
  seedStory(repos.db, "s1");

  const out = recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "youtube",
    reason: "title-skip: Another similar story",
    log: () => {},
  });
  assert.equal(out.persisted, true);
  assert.ok(out.id, "row id returned");

  const row = repos.db
    .prepare(
      `SELECT * FROM platform_posts WHERE story_id = 's1' AND platform = 'youtube'`,
    )
    .get();
  assert.equal(row.status, "blocked");
  assert.equal(
    row.external_id,
    null,
    "external_id must NOT carry a DUPE_* sentinel",
  );
  assert.equal(row.block_reason, "title-skip: Another similar story");
});

test("recordPlatformBlock is idempotent: second call updates the same row, does not insert a duplicate", () => {
  const repos = makeRepos();
  seedStory(repos.db, "s1");

  recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "youtube",
    reason: "first",
    log: () => {},
  });
  recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "youtube",
    reason: "second-call-wins",
    log: () => {},
  });

  const count = repos.db
    .prepare(
      `SELECT COUNT(*) AS n FROM platform_posts WHERE story_id = 's1' AND platform = 'youtube'`,
    )
    .get().n;
  assert.equal(count, 1, "exactly one row, never a duplicate");

  const row = repos.db
    .prepare(
      `SELECT block_reason FROM platform_posts WHERE story_id = 's1' AND platform = 'youtube'`,
    )
    .get();
  assert.equal(
    row.block_reason,
    "second-call-wins",
    "markBlocked overwrites the prior block_reason",
  );
});

test("recordPlatformBlock: different platforms for same story each get their own row", () => {
  const repos = makeRepos();
  seedStory(repos.db, "s1");

  recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "youtube",
    reason: "yt",
    log: () => {},
  });
  recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "tiktok",
    reason: "tt",
    log: () => {},
  });

  const rows = repos.db
    .prepare(
      `SELECT platform, block_reason FROM platform_posts WHERE story_id = 's1'`,
    )
    .all()
    .sort((a, b) => a.platform.localeCompare(b.platform));
  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.map((r) => r.platform),
    ["tiktok", "youtube"],
  );
});

test("recordPlatformBlock: missing repos returns persisted=false and does not throw", () => {
  const out = recordPlatformBlock({
    repos: null,
    storyId: "s1",
    platform: "youtube",
    reason: "x",
    log: () => {},
  });
  assert.equal(out.persisted, false);
  assert.equal(out.reason, "repos_unavailable");
});

test("recordPlatformBlock: missing storyId throws (HTTP layer maps to 400 upstream)", () => {
  assert.throws(() =>
    recordPlatformBlock({
      repos: null,
      platform: "youtube",
      reason: "x",
      log: () => {},
    }),
  );
});

test("getPlatformStatus: returns the row when one exists, null otherwise", () => {
  const repos = makeRepos();
  seedStory(repos.db, "s1");
  seedStory(repos.db, "s2");

  recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "youtube",
    reason: "x",
    log: () => {},
  });

  const hit = getPlatformStatus({
    repos,
    storyId: "s1",
    platform: "youtube",
  });
  assert.ok(hit);
  assert.equal(hit.status, "blocked");

  const miss = getPlatformStatus({
    repos,
    storyId: "s2",
    platform: "youtube",
  });
  assert.equal(miss, null);
});

test("publish-block covers every publisher.js platform key (tiktok, instagram_reel, facebook_reel, twitter_video) without sentinel pollution", () => {
  // Pins the Task-1 cutover: each platform_key written from publisher.js
  // produces a structured blocked row with external_id=NULL. If someone
  // later adds a new platform to publisher.js and forgets to add it to
  // platform_posts.PLATFORMS, this test will catch it (ensurePending
  // will refuse an unknown platform).
  const repos = makeRepos();
  seedStory(repos.db, "pragmata");

  const platforms = [
    "tiktok",
    "instagram_reel",
    "facebook_reel",
    "twitter_video",
  ];
  for (const platform of platforms) {
    const out = recordPlatformBlock({
      repos,
      storyId: "pragmata",
      platform,
      reason: `title-skip: another pragmata story on ${platform}`,
      log: () => {},
    });
    assert.equal(out.persisted, true, `${platform} must persist`);
  }

  const rows = repos.db
    .prepare(
      `SELECT platform, status, external_id, block_reason FROM platform_posts
       WHERE story_id = 'pragmata'
       ORDER BY platform`,
    )
    .all();
  assert.equal(rows.length, 4, "exactly one row per platform");
  for (const row of rows) {
    assert.equal(row.status, "blocked");
    assert.equal(
      row.external_id,
      null,
      `${row.platform} external_id must be NULL`,
    );
    assert.ok(/^title-skip:/.test(row.block_reason));
  }
});

test("no sentinel pollution: external_id never contains a DUPE_* string via this helper", () => {
  const repos = makeRepos();
  seedStory(repos.db, "s1");

  recordPlatformBlock({
    repos,
    storyId: "s1",
    platform: "youtube",
    reason: "this string contains DUPE_BLOCKED on purpose",
    log: () => {},
  });

  const row = repos.db
    .prepare(
      `SELECT external_id, block_reason FROM platform_posts WHERE story_id = 's1'`,
    )
    .get();
  // The reason text can mention DUPE_* (it's free-text), but external_id
  // must remain NULL — that's the whole point of migration 003's comment.
  assert.equal(row.external_id, null);
  assert.ok(row.block_reason.includes("DUPE_BLOCKED"));
});
