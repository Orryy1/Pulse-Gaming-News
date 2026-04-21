const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("node:http");

const {
  buildAnalyticsDigest,
  computeDelta,
  sanitiseMetricRow,
  pickPublishedStories,
  DEFAULT_LIMIT,
} = require("../../lib/services/analytics-digest");

// ---------- pure helpers ----------

test("pickPublishedStories: keeps only stories with at least one platform post id", () => {
  const got = pickPublishedStories(
    [
      { id: "a", youtube_post_id: "yt1", published_at: "2026-04-10" },
      { id: "b", tiktok_post_id: "tt1", published_at: "2026-04-11" },
      { id: "c" /* no post ids */, published_at: "2026-04-12" },
      { id: "d", facebook_post_id: "fb1", published_at: "2026-04-13" },
      null,
      "not an object",
    ],
    10,
  );
  assert.deepStrictEqual(
    got.map((s) => s.id),
    ["d", "b", "a"],
  );
});

test("pickPublishedStories: honours the limit", () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    youtube_post_id: "yt",
    published_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const got = pickPublishedStories(rows, 3);
  assert.strictEqual(got.length, 3);
  assert.strictEqual(got[0].id, "s19");
});

test("sanitiseMetricRow: keeps only the public shape; drops raw_json", () => {
  const sanitised = sanitiseMetricRow({
    id: 42,
    story_id: "s1",
    platform: "youtube",
    external_id: "yt_abc",
    snapshot_at: "2026-04-21T12:00:00.000Z",
    channel_id: "pulse-gaming",
    views: 1000,
    likes: 50,
    comments: 5,
    shares: null,
    watch_time_seconds: 42,
    retention_percent: 67,
    raw_json: '{"secret": "metadata"}',
  });
  assert.strictEqual(sanitised.external_id, "yt_abc");
  assert.strictEqual(sanitised.views, 1000);
  assert.strictEqual(sanitised.retention_percent, 67);
  assert.strictEqual(sanitised.raw_json, undefined);
  assert.strictEqual(sanitised.story_id, undefined);
  assert.strictEqual(sanitised.id, undefined);
  assert.strictEqual(sanitised.channel_id, undefined);
});

test("sanitiseMetricRow: null → null", () => {
  assert.strictEqual(sanitiseMetricRow(null), null);
  assert.strictEqual(sanitiseMetricRow(undefined), null);
});

test("computeDelta: returns +deltas for metrics present in both rows", () => {
  const delta = computeDelta(
    {
      views: 100,
      likes: 10,
      comments: 2,
      shares: 1,
      snapshot_at: "2026-04-21T14:00:00.000Z",
    },
    {
      views: 60,
      likes: 7,
      comments: 2,
      shares: 0,
      snapshot_at: "2026-04-21T10:00:00.000Z",
    },
  );
  assert.strictEqual(delta.views, 40);
  assert.strictEqual(delta.likes, 3);
  assert.strictEqual(delta.comments, 0);
  assert.strictEqual(delta.shares, 1);
  assert.strictEqual(delta.window_from, "2026-04-21T10:00:00.000Z");
  assert.strictEqual(delta.window_to, "2026-04-21T14:00:00.000Z");
});

test("computeDelta: returns null when no comparable metrics exist", () => {
  assert.strictEqual(computeDelta(null, null), null);
  assert.strictEqual(
    computeDelta({ views: 10 }, null),
    null,
    "previous missing → null",
  );
  // Latest has numeric, previous has null → no comparable
  const r = computeDelta(
    { views: 10, snapshot_at: "later" },
    { views: null, snapshot_at: "earlier" },
  );
  assert.strictEqual(r, null);
});

// ---------- buildAnalyticsDigest ----------

function fakePmsRepo(rowsByStoryAndPlatform) {
  return {
    listForStory(_db, storyId, { platform, limit }) {
      const rows =
        (rowsByStoryAndPlatform[storyId] &&
          rowsByStoryAndPlatform[storyId][platform]) ||
        [];
      return rows.slice(0, limit);
    },
  };
}

test("buildAnalyticsDigest: happy path with delta", () => {
  const stories = [
    {
      id: "s1",
      title: "Story 1",
      flair: "Verified",
      classification: "[CONFIRMED]",
      content_pillar: "Confirmed Drop",
      youtube_post_id: "yt1",
      youtube_url: "https://youtube.com/shorts/yt1",
      channel_id: "pulse-gaming",
      published_at: "2026-04-21T08:00:00.000Z",
      // sensitive fields that must not leak into the digest
      full_script: "SECRET SCRIPT",
      pinned_comment: "SECRET COMMENT",
    },
  ];
  const repo = fakePmsRepo({
    s1: {
      youtube: [
        {
          snapshot_at: "2026-04-21T14:00:00.000Z",
          views: 500,
          likes: 40,
          raw_json: '{"secret":"x"}',
        },
        {
          snapshot_at: "2026-04-21T10:00:00.000Z",
          views: 200,
          likes: 10,
        },
      ],
    },
  });
  const digest = buildAnalyticsDigest({
    stories,
    pmsRepo: repo,
    dbHandle: {}, // any truthy value — our fake repo ignores it
  });
  assert.strictEqual(digest.count, 1);
  assert.strictEqual(digest.items[0].id, "s1");
  assert.strictEqual(digest.items[0].platforms.youtube.latest.views, 500);
  assert.strictEqual(digest.items[0].platforms.youtube.delta.views, 300);
  // Sensitive fields absent.
  assert.strictEqual(JSON.stringify(digest.items[0]).includes("SECRET"), false);
});

test("buildAnalyticsDigest: handles stories with no metrics yet", () => {
  const stories = [{ id: "s2", title: "Unseen", youtube_post_id: "yt2" }];
  const repo = fakePmsRepo({}); // empty
  const digest = buildAnalyticsDigest({
    stories,
    pmsRepo: repo,
    dbHandle: {},
  });
  assert.strictEqual(digest.items[0].id, "s2");
  assert.deepStrictEqual(digest.items[0].platforms, {});
});

test("buildAnalyticsDigest: honours limit override", () => {
  const stories = Array.from({ length: 15 }, (_, i) => ({
    id: `s${i}`,
    youtube_post_id: `yt${i}`,
    published_at: `2026-04-${String(i + 1).padStart(2, "0")}T12:00:00.000Z`,
  }));
  const digest = buildAnalyticsDigest({
    stories,
    pmsRepo: { listForStory: () => [] },
    dbHandle: {},
    limit: 3,
  });
  assert.strictEqual(digest.count, 3);
  assert.strictEqual(digest.limit, 3);
});

test("buildAnalyticsDigest: defaults limit when not provided", () => {
  const stories = [{ id: "s", youtube_post_id: "yt" }];
  const digest = buildAnalyticsDigest({
    stories,
    pmsRepo: { listForStory: () => [] },
    dbHandle: {},
  });
  assert.strictEqual(digest.limit, DEFAULT_LIMIT);
});

test("buildAnalyticsDigest: repo throw doesn't crash the digest", () => {
  const stories = [{ id: "s", youtube_post_id: "yt" }];
  const digest = buildAnalyticsDigest({
    stories,
    pmsRepo: {
      listForStory() {
        throw new Error("db closed");
      },
    },
    dbHandle: {},
  });
  assert.strictEqual(digest.count, 1);
  assert.deepStrictEqual(digest.items[0].platforms, {});
});

// ---------- HTTP contract: auth + 401 ----------
//
// Spin a minimal Express app mirroring the real requireAuth +
// handler so we confirm unauthenticated requests get 401 and
// authenticated ones get the digest payload.

function buildTestServer({ apiToken, stories, pmsRepo }) {
  const app = express();
  function requireAuth(req, res, next) {
    if (!apiToken) return next();
    const tok = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    if (tok !== apiToken)
      return res.status(401).json({ error: "Unauthorized" });
    next();
  }
  app.get("/api/analytics/digest", requireAuth, (req, res) => {
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === "string" && /^\d+$/.test(limitRaw)
        ? Math.min(50, parseInt(limitRaw, 10))
        : undefined;
    const digest = buildAnalyticsDigest({
      stories,
      pmsRepo,
      dbHandle: {},
      limit,
    });
    res.json(digest);
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () =>
      resolve({ server, port: server.address().port }),
    );
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("GET /api/analytics/digest — 401 without Bearer", async () => {
  const app = buildTestServer({
    apiToken: "tok_verysecret123",
    stories: [],
    pmsRepo: { listForStory: () => [] },
  });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/analytics/digest");
    assert.strictEqual(r.status, 401);
  } finally {
    server.close();
  }
});

test("GET /api/analytics/digest — 200 with Bearer, sensitive fields absent", async () => {
  const app = buildTestServer({
    apiToken: "tok_verysecret123",
    stories: [
      {
        id: "s1",
        title: "Test",
        youtube_post_id: "yt1",
        full_script: "SECRET",
        pinned_comment: "SECRET",
      },
    ],
    pmsRepo: { listForStory: () => [] },
  });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/analytics/digest", {
      Authorization: "Bearer tok_verysecret123",
    });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.includes("SECRET"), false);
    const parsed = JSON.parse(r.body);
    assert.strictEqual(parsed.count, 1);
    assert.strictEqual(parsed.items[0].id, "s1");
  } finally {
    server.close();
  }
});

test("GET /api/analytics/digest — no data returns empty digest, not 500", async () => {
  const app = buildTestServer({
    apiToken: "tok",
    stories: [],
    pmsRepo: { listForStory: () => [] },
  });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/analytics/digest", {
      Authorization: "Bearer tok",
    });
    assert.strictEqual(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.strictEqual(parsed.count, 0);
    assert.deepStrictEqual(parsed.items, []);
  } finally {
    server.close();
  }
});

test("GET /api/analytics/digest — ?limit clamped to 50 max", async () => {
  const app = buildTestServer({
    apiToken: "tok",
    stories: Array.from({ length: 100 }, (_, i) => ({
      id: `s${i}`,
      youtube_post_id: `yt${i}`,
      published_at: `2026-04-${String(i + 1).padStart(2, "0")}`,
    })),
    pmsRepo: { listForStory: () => [] },
  });
  const { server, port } = await listen(app);
  try {
    const r = await get(port, "/api/analytics/digest?limit=9999", {
      Authorization: "Bearer tok",
    });
    const parsed = JSON.parse(r.body);
    assert.strictEqual(parsed.limit, 50);
    assert.strictEqual(parsed.items.length, 50);
  } finally {
    server.close();
  }
});
