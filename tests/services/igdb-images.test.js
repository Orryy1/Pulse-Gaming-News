"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const igdb = require("../../lib/igdb-images");

// 2026-04-29: IGDB cover + screenshot enrichment. The production image
// pipeline (images_download.js) had Steam as the only gaming-image
// source. When Steam missed (PS/Xbox exclusives, mobile, indie, retro)
// AND the article scrape was paywalled, we fell straight through to
// generic Pexels stock — which produced thin-visual composite-only
// renders for a real chunk of the RSS-sourced backlog.
//
// IGDB knows about ~99% of games even when they're not on Steam. This
// file pins the contract: cover comes first, then screenshots, with
// the right t_<size> path on the IGDB CDN URL. Defensive paths return
// [] without throwing on every failure mode.

function mockHttp(handlers = []) {
  const calls = [];
  let cursor = 0;
  return {
    calls,
    async post(url, body, options) {
      calls.push({ url, body, options });
      const handler = handlers[cursor++];
      if (!handler) {
        throw new Error(`mockHttp: no handler for call ${cursor} to ${url}`);
      }
      if (typeof handler === "function") return handler({ url, body, options });
      if (handler.__throw) throw handler.__throw;
      return handler;
    },
    async get(url) {
      calls.push({ url });
      return { data: {} };
    },
  };
}

const ENV_OK = {
  TWITCH_CLIENT_ID: "cid",
  TWITCH_CLIENT_SECRET: "secret",
};

function freshTokenStore() {
  return { token: null, expiresAt: 0 };
}

// ── buildImageUrl ───────────────────────────────────────────────────

test("buildImageUrl renders the IGDB CDN URL with the requested size segment", () => {
  assert.equal(
    igdb.buildImageUrl("abc123", igdb.COVER_SIZE),
    "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/abc123.jpg",
  );
  assert.equal(
    igdb.buildImageUrl("scrn99", igdb.SCREENSHOT_SIZE),
    "https://images.igdb.com/igdb/image/upload/t_1080p/scrn99.jpg",
  );
  assert.equal(igdb.buildImageUrl(null, "t_1080p"), null);
});

// ── getIgdbAccessToken ─────────────────────────────────────────────

test("getIgdbAccessToken: missing env returns null without HTTP call", async () => {
  const http = mockHttp([]);
  const t = await igdb.getIgdbAccessToken({
    http,
    env: {},
    tokenStore: freshTokenStore(),
  });
  assert.equal(t, null);
  assert.equal(http.calls.length, 0);
});

test("getIgdbAccessToken: caches the token until expiry", async () => {
  const http = mockHttp([
    { data: { access_token: "tok-1", expires_in: 3600 } },
  ]);
  const store = freshTokenStore();
  const a = await igdb.getIgdbAccessToken({
    http,
    env: ENV_OK,
    tokenStore: store,
  });
  const b = await igdb.getIgdbAccessToken({
    http,
    env: ENV_OK,
    tokenStore: store,
  });
  assert.equal(a, "tok-1");
  assert.equal(b, "tok-1");
  // Only one Twitch token request — second call hit the cache.
  assert.equal(http.calls.length, 1);
});

test("getIgdbAccessToken: HTTP failure returns null, doesn't throw", async () => {
  const http = mockHttp([
    () => {
      throw new Error("twitch down");
    },
  ]);
  const t = await igdb.getIgdbAccessToken({
    http,
    env: ENV_OK,
    tokenStore: freshTokenStore(),
  });
  assert.equal(t, null);
});

// ── searchGame ─────────────────────────────────────────────────────

test("searchGame: prefers a result that has imagery over one that doesn't", async () => {
  const http = mockHttp([
    {
      data: [
        { id: 1, name: "Empty Game" }, // no cover/screenshots
        { id: 2, name: "Real Game", cover: 42, screenshots: [9, 10] },
      ],
    },
  ]);
  const g = await igdb.searchGame({
    gameTitle: "Real Game",
    token: "tok",
    clientId: "cid",
    http,
  });
  assert.equal(g.id, 2);
  assert.equal(g.name, "Real Game");
});

test("searchGame: returns null when API fails", async () => {
  const http = mockHttp([
    () => {
      throw new Error("igdb 500");
    },
  ]);
  const g = await igdb.searchGame({
    gameTitle: "Anything",
    token: "tok",
    clientId: "cid",
    http,
  });
  assert.equal(g, null);
});

test("searchGame: escapes embedded quotes in the title", async () => {
  const http = mockHttp([{ data: [] }]);
  await igdb.searchGame({
    gameTitle: 'Joe "evil" Game',
    token: "tok",
    clientId: "cid",
    http,
  });
  // The body must NOT contain a raw inner quote that would break IGDB
  // query syntax — the IGDB API rejects malformed quoted searches.
  assert.equal(http.calls[0].body.includes(`"Joe evil Game"`), true);
});

// ── fetchIgdbImages: end-to-end ─────────────────────────────────────

test("fetchIgdbImages: env unset returns [] with no HTTP call", async () => {
  const http = mockHttp([]);
  const out = await igdb.fetchIgdbImages("Halo Infinite", {
    http,
    env: {},
    tokenStore: freshTokenStore(),
  });
  assert.deepEqual(out, []);
  assert.equal(http.calls.length, 0);
});

test("fetchIgdbImages: happy path returns cover (key_art) + screenshots in order", async () => {
  const http = mockHttp([
    // 1. token
    { data: { access_token: "tok", expires_in: 3600 } },
    // 2. games search
    {
      data: [
        {
          id: 11,
          name: "Halo Infinite",
          cover: 7,
          screenshots: [101, 102, 103],
        },
      ],
    },
    // 3. cover lookup
    { data: [{ id: 7, image_id: "co_halo" }] },
    // 4. screenshots lookup
    {
      data: [
        { id: 101, image_id: "sc_halo_a" },
        { id: 102, image_id: "sc_halo_b" },
        { id: 103, image_id: "sc_halo_c" },
      ],
    },
  ]);
  const out = await igdb.fetchIgdbImages("Halo Infinite", {
    http,
    env: ENV_OK,
    tokenStore: freshTokenStore(),
  });
  assert.equal(out.length, 4);
  assert.equal(out[0].type, "key_art");
  assert.equal(out[0].source, "igdb");
  assert.equal(out[0].game_name, "Halo Infinite");
  assert.equal(
    out[0].url,
    "https://images.igdb.com/igdb/image/upload/t_cover_big_2x/co_halo.jpg",
  );
  for (const i of out.slice(1)) {
    assert.equal(i.type, "screenshot");
    assert.equal(i.source, "igdb");
    assert.match(i.url, /t_1080p\/sc_halo_/);
  }
});

test("fetchIgdbImages: respects the max cap", async () => {
  const http = mockHttp([
    { data: { access_token: "tok", expires_in: 3600 } },
    {
      data: [
        {
          id: 11,
          name: "Game",
          cover: 7,
          screenshots: [1, 2, 3, 4, 5],
        },
      ],
    },
    { data: [{ id: 7, image_id: "cov" }] },
    {
      data: [
        { id: 1, image_id: "s1" },
        { id: 2, image_id: "s2" },
      ],
    },
  ]);
  const out = await igdb.fetchIgdbImages("Game", {
    http,
    env: ENV_OK,
    max: 3, // cover + 2 screenshots
    tokenStore: freshTokenStore(),
  });
  assert.equal(out.length, 3);
  assert.equal(out[0].type, "key_art");
  assert.equal(out.filter((i) => i.type === "screenshot").length, 2);
});

test("fetchIgdbImages: cover-only (no screenshots) still returns 1 image", async () => {
  const http = mockHttp([
    { data: { access_token: "tok", expires_in: 3600 } },
    {
      data: [
        {
          id: 11,
          name: "Indie Game",
          cover: 7,
          // no screenshots field at all
        },
      ],
    },
    { data: [{ id: 7, image_id: "co_indie" }] },
  ]);
  const out = await igdb.fetchIgdbImages("Indie Game", {
    http,
    env: ENV_OK,
    tokenStore: freshTokenStore(),
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "key_art");
});

test("fetchIgdbImages: screenshots-only (no cover) returns just screenshots", async () => {
  const http = mockHttp([
    { data: { access_token: "tok", expires_in: 3600 } },
    {
      data: [
        {
          id: 11,
          name: "Demo",
          screenshots: [1, 2],
        },
      ],
    },
    {
      data: [
        { id: 1, image_id: "s1" },
        { id: 2, image_id: "s2" },
      ],
    },
  ]);
  const out = await igdb.fetchIgdbImages("Demo", {
    http,
    env: ENV_OK,
    tokenStore: freshTokenStore(),
  });
  assert.equal(out.length, 2);
  for (const i of out) assert.equal(i.type, "screenshot");
});

test("fetchIgdbImages: no match → []", async () => {
  const http = mockHttp([
    { data: { access_token: "tok", expires_in: 3600 } },
    { data: [] },
  ]);
  const out = await igdb.fetchIgdbImages("Nonexistent Game 9991", {
    http,
    env: ENV_OK,
    tokenStore: freshTokenStore(),
  });
  assert.deepEqual(out, []);
});

test("fetchIgdbImages: token request failure → []", async () => {
  const http = mockHttp([
    () => {
      throw new Error("twitch 503");
    },
  ]);
  const out = await igdb.fetchIgdbImages("Anything", {
    http,
    env: ENV_OK,
    tokenStore: freshTokenStore(),
  });
  assert.deepEqual(out, []);
});

test("fetchIgdbImages: empty / non-string title → []", async () => {
  const http = mockHttp([]);
  assert.deepEqual(
    await igdb.fetchIgdbImages("", {
      http,
      env: ENV_OK,
      tokenStore: freshTokenStore(),
    }),
    [],
  );
  assert.deepEqual(
    await igdb.fetchIgdbImages(null, {
      http,
      env: ENV_OK,
      tokenStore: freshTokenStore(),
    }),
    [],
  );
});
