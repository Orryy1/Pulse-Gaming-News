const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

// Task 6 coverage: handleEngageFirstHour reads from the SQLite
// canonical store, not daily_news.json. Previously the JSON
// mirror could be absent on fresh deploys or stale behind a
// write, causing valid-but-recent publishes to be silently
// skipped. The handler now goes straight to db.getStoriesSync
// and throws on read failure so the job runner can retry.
//
// We stub the lib/db + engagement + fs modules via require-cache
// so the test runs sync + isolated, no SQLite or JSON required.

const HANDLER_PATH = require.resolve("../../lib/job-handlers");
const DB_PATH = require.resolve("../../lib/db");
const ENG_PATH = require.resolve("../../engagement");
const FS_PATH = require.resolve("fs-extra");

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

function clearHandlersCache() {
  delete require.cache[HANDLER_PATH];
}

let engageCalls;
function mockEngagement() {
  engageCalls = [];
  stubModule(ENG_PATH, {
    async engageFirstHour(ytId, story) {
      engageCalls.push({ ytId, storyId: story && story.id });
    },
  });
}

function mockDb(stories) {
  stubModule(DB_PATH, {
    useSqlite: () => true,
    getStoriesSync: () => stories,
    async getStories() {
      return stories;
    },
  });
}

function failingDb(msg = "connection refused") {
  stubModule(DB_PATH, {
    useSqlite: () => true,
    getStoriesSync: () => {
      throw new Error(msg);
    },
    async getStories() {
      throw new Error(msg);
    },
  });
}

// When handleEngageFirstHour is imported from the handlers
// module, the module also pulls in fs-extra (for unrelated
// handlers in the same file). We leave that alone — just pin
// that THIS handler doesn't touch it.
let fsReadCalls;
function wrapFsExtra() {
  fsReadCalls = 0;
  const orig = require("fs-extra");
  const wrapped = {
    ...orig,
    async readJson(...args) {
      fsReadCalls++;
      return orig.readJson(...args);
    },
  };
  stubModule(FS_PATH, wrapped);
}

function restoreAll() {
  delete require.cache[DB_PATH];
  delete require.cache[ENG_PATH];
  delete require.cache[FS_PATH];
  delete require.cache[HANDLER_PATH];
}

beforeEach(() => {
  wrapFsExtra();
  mockEngagement();
});

afterEach(() => {
  restoreAll();
});

// ---------- happy path ----------

test("engage_first_hour: recent published YouTube story → engaged", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "recent_ok",
      youtube_post_id: "yt_abc",
      publish_status: "published",
      published_at: new Date(now - 10 * 60 * 1000).toISOString(), // 10 min ago
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { processed: 1 });
  assert.strictEqual(engageCalls.length, 1);
  assert.strictEqual(engageCalls[0].ytId, "yt_abc");
  assert.strictEqual(engageCalls[0].storyId, "recent_ok");
});

test("engage_first_hour: no daily_news.json read", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "recent_ok",
      youtube_post_id: "yt_abc",
      publish_status: "published",
      published_at: new Date(now - 10 * 60 * 1000).toISOString(),
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  await handlers.engage_first_hour({}, { log: () => {} });
  // handleEngageFirstHour must NOT have called fs.readJson —
  // the whole point of the Task 6 fix is to skip the JSON
  // fallback. (Other handlers in job-handlers.js may read JSON;
  // we count only THIS handler's run, which has no other reads.)
  assert.strictEqual(
    fsReadCalls,
    0,
    "engage_first_hour must not read daily_news.json",
  );
});

// ---------- skip branches ----------

test("engage_first_hour: old published story (>1h) → skipped", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "old_ok",
      youtube_post_id: "yt_abc",
      publish_status: "published",
      published_at: new Date(now - 3 * 60 * 60 * 1000).toISOString(),
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { skipped: true });
  assert.strictEqual(engageCalls.length, 0);
});

test("engage_first_hour: missing YouTube post id → skipped", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "no_yt",
      youtube_post_id: null,
      publish_status: "published",
      published_at: new Date(now - 10 * 60 * 1000).toISOString(),
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { skipped: true });
});

test("engage_first_hour: partial status (not published) → skipped", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "partial",
      youtube_post_id: "yt_abc",
      publish_status: "partial", // has YT but TT pending
      published_at: new Date(now - 10 * 60 * 1000).toISOString(),
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { skipped: true });
});

test("engage_first_hour: DUPE_ sentinel youtube_post_id → skipped", async () => {
  // Legacy rows from pre-2026-04-19 cutover may have
  // "DUPE_BLOCKED" / "DUPE_SKIPPED" in the column. Must not be
  // mistaken for a real post id.
  const now = Date.now();
  mockDb([
    {
      id: "dupe",
      youtube_post_id: "DUPE_BLOCKED",
      publish_status: "published",
      published_at: new Date(now - 10 * 60 * 1000).toISOString(),
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { skipped: true });
});

test("engage_first_hour: empty story list → skipped", async () => {
  mockDb([]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { skipped: true });
});

// ---------- error surfacing ----------

test("engage_first_hour: DB read failure surfaces as job failure (not silent skip)", async () => {
  failingDb("sqlite busy");
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  await assert.rejects(
    handlers.engage_first_hour({}, { log: () => {} }),
    (err) => {
      assert.match(err.message, /engage_first_hour: DB read failed/);
      assert.match(err.message, /sqlite busy/);
      return true;
    },
  );
  // No engagement calls fire on a failed read.
  assert.strictEqual(engageCalls.length, 0);
});

// ---------- multiple stories ----------

test("engage_first_hour: processes every eligible story in the window", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "a",
      youtube_post_id: "yt_a",
      publish_status: "published",
      published_at: new Date(now - 5 * 60 * 1000).toISOString(),
    },
    {
      id: "b",
      youtube_post_id: "yt_b",
      publish_status: "published",
      published_at: new Date(now - 45 * 60 * 1000).toISOString(),
    },
    {
      id: "old",
      youtube_post_id: "yt_old",
      publish_status: "published",
      published_at: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    },
  ]);
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const result = await handlers.engage_first_hour({}, { log: () => {} });
  assert.deepStrictEqual(result, { processed: 2 });
  assert.strictEqual(engageCalls.length, 2);
  const ids = engageCalls.map((c) => c.storyId).sort();
  assert.deepStrictEqual(ids, ["a", "b"]);
});

test("engage_first_hour: one engagement throwing doesn't block the others", async () => {
  const now = Date.now();
  mockDb([
    {
      id: "ok",
      youtube_post_id: "yt_ok",
      publish_status: "published",
      published_at: new Date(now - 5 * 60 * 1000).toISOString(),
    },
    {
      id: "bad",
      youtube_post_id: "yt_bad",
      publish_status: "published",
      published_at: new Date(now - 10 * 60 * 1000).toISOString(),
    },
  ]);
  // Override engagement to throw on the second story only.
  stubModule(ENG_PATH, {
    async engageFirstHour(ytId) {
      engageCalls.push({ ytId });
      if (ytId === "yt_bad") throw new Error("API rate limited");
    },
  });
  clearHandlersCache();
  const { handlers } = require("../../lib/job-handlers");
  const logs = [];
  const result = await handlers.engage_first_hour(
    {},
    { log: (m) => logs.push(m) },
  );
  assert.deepStrictEqual(result, { processed: 2 });
  assert.strictEqual(engageCalls.length, 2);
  // The error lands in ctx.log, not as a thrown exception.
  assert.ok(logs.some((l) => l.includes("engageFirstHour error")));
});
