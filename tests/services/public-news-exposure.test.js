const { test } = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("node:http");

// Contract tests for the public /api/news exposure surface, locked
// in after the 2026-04-20 audit found the endpoint was leaking the
// full editorial record — scripts, scoring internals, Reddit comment
// authors (PII), internal file paths, platform post IDs, the lot.
//
// Two layers of coverage:
//   1. Unit tests on the sanitizer itself (lib/public-story.js) —
//      assert each internal field is dropped and each permitted
//      field survives. Cheap, deterministic, no HTTP needed.
//   2. Endpoint tests that spin a minimal Express app importing the
//      real server's route code pattern — GET /api/news returns the
//      sanitised array, GET /api/news/full requires Bearer auth.

const {
  PUBLIC_FIELDS,
  sanitizeStoryForPublic,
  sanitizeStoriesForPublic,
  isPubliclyVisible,
} = require("../../lib/public-story");

// A realistic "dirty" story with every field we know we've seen in
// prod. Any test that adds a field here should also decide whether
// it's `PUBLIC_FIELDS` or must be dropped.
function fixtureInternalStory(overrides = {}) {
  return {
    // --- Safe / public ----------------------------------------------
    id: "rss_abc123",
    title: "Elden Ring Movie Release Date and Full Cast Announced",
    timestamp: "2026-04-20T19:00:00.000Z",
    published_at: "2026-04-20T20:02:00.000Z",
    flair: "Verified",
    source_type: "rss",
    subreddit: "GamingLeaksAndRumours",
    url: "https://www.eurogamer.net/elden-ring-movie-cast",
    youtube_url: "https://youtube.com/shorts/iRWg2GWVdfY",
    article_image: "https://example.com/og.jpg",
    company_name: "Eurogamer",
    num_comments: 420,
    score: 1337,
    // --- Sensitive / editorial --------------------------------------
    hook: "A dead franchise just got resurrected...",
    body: "The film will be shot and released in IMAX. Alex Garland...",
    loop: "But here's what's raising eyebrows...",
    full_script: "Full editorial script with the whole 50-second narration.",
    tts_script: "TTS variant with [PAUSE] markers removed.",
    pinned_comment: "Check it out here: https://amzn.to/xyz?tag=orryy-21",
    suggested_thumbnail_text: "ELDEN RING MOVIE",
    title_options: ["Option A", "Option B", "Option C"],
    seo_description: "Elden Ring movie seo description...",
    seo_tags: ["elden ring", "movie"],
    word_count: 148,
    approved: true,
    auto_approved: true,
    classification: "[CONFIRMED]",
    breaking_score: 82,
    content_pillar: "Confirmed Drop",
    affiliate_url: "https://www.amazon.co.uk/s?k=Elden&tag=orryy-21",
    // --- Internal pipeline state ------------------------------------
    audio_path: "output/audio/rss_abc123.mp3",
    image_path: "output/images/rss_abc123.png",
    exported_path: "output/final/rss_abc123.mp4",
    publish_status: "published",
    publish_error: null,
    schedule_time: null,
    // --- Platform IDs / tokens / metrics ----------------------------
    youtube_post_id: "iRWg2GWVdfY",
    tiktok_post_id: "7300000000000000000",
    tiktok_status: "published",
    instagram_media_id: "17895683219471234",
    facebook_post_id: "9876543210",
    twitter_post_id: null,
    youtube_views: 12345,
    tiktok_views: 6789,
    // --- Raw source data with potential PII -------------------------
    reddit_comments: [
      { author: "kingrawer", score: 683, body: "This looks great" },
      { author: "BatChest_redditor", score: 369, body: "Excited" },
    ],
    top_comment: "This is looking like...",
    reddit_images: [],
    candidate_images: [
      {
        path: "output/images/rss_abc123/candidates/candidate_0.jpg",
        prompt: "A dramatic cinematic shot of a futuristic studio...",
      },
    ],
    downloaded_images: [
      {
        path: "output/image_cache/rss_abc123_article.jpg",
        type: "article_hero",
      },
    ],
    game_images: [{ url: "https://example.com/hero.jpg", type: "hero" }],
    company_logo_url: "https://example.com/logo.png",
    ...overrides,
  };
}

// ---------- unit: which fields survive the sanitizer ----------

test("sanitizeStoryForPublic: keeps only the whitelisted public fields", () => {
  const dirty = fixtureInternalStory();
  const clean = sanitizeStoryForPublic(dirty);
  // Every emitted key must be in the public whitelist.
  for (const k of Object.keys(clean)) {
    assert.ok(
      PUBLIC_FIELDS.includes(k),
      `unexpected key leaked via sanitizer: ${k}`,
    );
  }
});

test("sanitizeStoryForPublic: strips every known-sensitive field", () => {
  const dirty = fixtureInternalStory();
  const clean = sanitizeStoryForPublic(dirty);
  // Editorial drafts — must not appear pre-publish.
  for (const k of [
    "hook",
    "body",
    "loop",
    "full_script",
    "tts_script",
    "pinned_comment",
    "suggested_thumbnail_text",
    "title_options",
    "seo_description",
    "seo_tags",
    "word_count",
  ]) {
    assert.strictEqual(clean[k], undefined, `leaked editorial field ${k}`);
  }
  // Scoring / classification internals.
  for (const k of [
    "classification",
    "breaking_score",
    "content_pillar",
    "approved",
    "auto_approved",
    "affiliate_url",
  ]) {
    assert.strictEqual(clean[k], undefined, `leaked scoring field ${k}`);
  }
  // Internal disk paths.
  for (const k of [
    "audio_path",
    "image_path",
    "exported_path",
    "candidate_images",
    "downloaded_images",
    "game_images",
    "company_logo_url",
  ]) {
    assert.strictEqual(clean[k], undefined, `leaked path/asset field ${k}`);
  }
  // Platform IDs, metrics, pipeline state.
  for (const k of [
    "youtube_post_id",
    "tiktok_post_id",
    "tiktok_status",
    "instagram_media_id",
    "facebook_post_id",
    "twitter_post_id",
    "youtube_views",
    "tiktok_views",
    "publish_status",
    "publish_error",
    "schedule_time",
  ]) {
    assert.strictEqual(clean[k], undefined, `leaked platform field ${k}`);
  }
  // Raw source data with PII (Reddit usernames).
  for (const k of ["reddit_comments", "top_comment", "reddit_images"]) {
    assert.strictEqual(clean[k], undefined, `leaked PII/source field ${k}`);
  }
});

test("sanitizeStoryForPublic: preserves the display fields verbatim", () => {
  const dirty = fixtureInternalStory();
  const clean = sanitizeStoryForPublic(dirty);
  assert.strictEqual(clean.id, "rss_abc123");
  assert.strictEqual(clean.title, dirty.title);
  assert.strictEqual(clean.timestamp, dirty.timestamp);
  assert.strictEqual(clean.published_at, dirty.published_at);
  assert.strictEqual(clean.flair, "Verified");
  assert.strictEqual(clean.source_type, "rss");
  assert.strictEqual(clean.subreddit, "GamingLeaksAndRumours");
  assert.strictEqual(clean.url, dirty.url);
  assert.strictEqual(clean.youtube_url, dirty.youtube_url);
  assert.strictEqual(clean.article_image, dirty.article_image);
  assert.strictEqual(clean.company_name, "Eurogamer");
  assert.strictEqual(clean.num_comments, 420);
  assert.strictEqual(clean.score, 1337);
});

test("sanitizeStoryForPublic: drops nested objects even if their key is on the whitelist-adjacent", () => {
  // Sanity guard: even if a future refactor accidentally adds an
  // object-typed field to PUBLIC_FIELDS, the type check inside the
  // sanitizer should refuse to emit it — only primitives pass.
  const dirty = fixtureInternalStory({
    title: { toString: () => "accidental object" },
  });
  const clean = sanitizeStoryForPublic(dirty);
  assert.strictEqual(clean.title, undefined);
});

test("sanitizeStoryForPublic: null / undefined / non-object input returns null", () => {
  assert.strictEqual(sanitizeStoryForPublic(null), null);
  assert.strictEqual(sanitizeStoryForPublic(undefined), null);
  assert.strictEqual(sanitizeStoryForPublic("string"), null);
  assert.strictEqual(sanitizeStoryForPublic(12345), null);
});

// ---------- unit: visibility filter ----------

test("isPubliclyVisible: a story with no youtube URL or post id is hidden", () => {
  const s = fixtureInternalStory({ youtube_url: null, youtube_post_id: null });
  assert.strictEqual(isPubliclyVisible(s), false);
});

test("isPubliclyVisible: draft / queued / failed publish statuses are hidden", () => {
  for (const status of ["idle", "publishing", "failed"]) {
    const s = fixtureInternalStory({ publish_status: status });
    assert.strictEqual(
      isPubliclyVisible(s),
      false,
      `status=${status} should be hidden`,
    );
  }
});

test("isPubliclyVisible: published and partial both pass (YT live is live)", () => {
  assert.strictEqual(
    isPubliclyVisible(fixtureInternalStory({ publish_status: "published" })),
    true,
  );
  assert.strictEqual(
    isPubliclyVisible(fixtureInternalStory({ publish_status: "partial" })),
    true,
  );
});

test("sanitizeStoriesForPublic: filters unpublished stories OUT of the list", () => {
  const live = fixtureInternalStory();
  const draft = fixtureInternalStory({
    id: "draft_1",
    publish_status: "idle",
    youtube_url: null,
    youtube_post_id: null,
  });
  const result = sanitizeStoriesForPublic([live, draft]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "rss_abc123");
});

test("sanitizeStoriesForPublic: safe on non-array input", () => {
  assert.deepStrictEqual(sanitizeStoriesForPublic(null), []);
  assert.deepStrictEqual(sanitizeStoriesForPublic(undefined), []);
  assert.deepStrictEqual(sanitizeStoriesForPublic({}), []);
});

// ---------- endpoint contract: auth matrix ----------
//
// Spin up a minimal Express app that mirrors the two routes added to
// server.js — public `/api/news` (sanitised) and authenticated
// `/api/news/full` (full internal payload). No SQLite, no cron, no
// Discord — just the two handlers, so we test the shape contract
// in isolation.

function buildTestApp({ stories, apiToken }) {
  const app = express();
  const { sanitizeStoriesForPublic } = require("../../lib/public-story");

  function requireAuth(req, res, next) {
    const secret = apiToken;
    if (!secret) return next();
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    if (token !== secret)
      return res.status(401).json({ error: "Unauthorized" });
    next();
  }

  app.get("/api/news", (_req, res) => {
    res.json(sanitizeStoriesForPublic(stories));
  });
  app.get("/api/news/full", requireAuth, (_req, res) => {
    res.json(stories);
  });

  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () =>
          resolve({ status: res.statusCode, body, headers: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

test("GET /api/news (unauthenticated): returns only sanitised fields + only live stories", async () => {
  const stories = [
    fixtureInternalStory(),
    fixtureInternalStory({
      id: "draft_1",
      publish_status: "idle",
      youtube_url: null,
      youtube_post_id: null,
    }),
  ];
  const app = buildTestApp({ stories, apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const res = await get(port, "/api/news");
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1, "draft story must be filtered out");
    // Must NOT expose the editorial/internal surface.
    const leakedKeys = [
      "full_script",
      "tts_script",
      "hook",
      "body",
      "loop",
      "pinned_comment",
      "candidate_images",
      "downloaded_images",
      "reddit_comments",
      "top_comment",
      "audio_path",
      "image_path",
      "exported_path",
      "tiktok_post_id",
      "instagram_media_id",
      "facebook_post_id",
      "breaking_score",
      "classification",
      "affiliate_url",
      "approved",
      "publish_status",
      "publish_error",
    ];
    for (const k of leakedKeys) {
      assert.strictEqual(body[0][k], undefined, `leaked key: ${k}`);
    }
    // Raw response must not contain the token we configured either.
    assert.strictEqual(res.body.includes("tok_verysecret123"), false);
  } finally {
    server.close();
  }
});

test("GET /api/news/full (no token): returns 401 and does not leak the body", async () => {
  const stories = [fixtureInternalStory()];
  const app = buildTestApp({ stories, apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const res = await get(port, "/api/news/full");
    assert.strictEqual(res.status, 401);
    // The body should not include any sensitive story field.
    assert.strictEqual(res.body.includes("full_script"), false);
    assert.strictEqual(res.body.includes("pinned_comment"), false);
    assert.strictEqual(res.body.includes("tok_verysecret123"), false);
  } finally {
    server.close();
  }
});

test("GET /api/news/full (wrong token): returns 401 — does not treat empty/different bearer as valid", async () => {
  const stories = [fixtureInternalStory()];
  const app = buildTestApp({ stories, apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const res = await get(port, "/api/news/full", {
      Authorization: "Bearer not_the_real_token",
    });
    assert.strictEqual(res.status, 401);
  } finally {
    server.close();
  }
});

test("GET /api/news/full (valid token): returns the full internal shape", async () => {
  const stories = [fixtureInternalStory()];
  const app = buildTestApp({ stories, apiToken: "tok_verysecret123" });
  const { server, port } = await listen(app);
  try {
    const res = await get(port, "/api/news/full", {
      Authorization: "Bearer tok_verysecret123",
    });
    assert.strictEqual(res.status, 200);
    const body = JSON.parse(res.body);
    assert.ok(Array.isArray(body));
    assert.strictEqual(body.length, 1);
    // Full payload: fields we deliberately strip in public must be
    // present here.
    assert.strictEqual(typeof body[0].full_script, "string");
    assert.strictEqual(typeof body[0].pinned_comment, "string");
    assert.strictEqual(typeof body[0].breaking_score, "number");
    assert.strictEqual(typeof body[0].audio_path, "string");
  } finally {
    server.close();
  }
});
