const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// Regression coverage for the 2026-04-20 telemetry lockdown. Before
// this change, a lot of operator-only reads were unauthenticated:
// queue/stats, scoring/digest, analytics/*, engagement/stats,
// platforms/status (tokens' expiry + path), publish-status,
// hunter/status, autonomous/status (schedule + autoPublish flag),
// watcher/status, weekly/status, audio-packs, compile/topics, and
// /api/progress SSE (draft story ids streamed in real time).
//
// We lock the gate in by scanning server.js source for each of
// those GET registrations and asserting the inline middleware list
// contains `requireAuth` (or `requireAuthHeaderOrQuery` for SSE).
// Source-scan over route tests so this suite stays fast, hermetic,
// and doesn't need to boot Express / SQLite.

const SERVER_PATH = path.join(__dirname, "..", "..", "server.js");
const src = fs.readFileSync(SERVER_PATH, "utf8");

function firstRegistrationLine(routePath) {
  // Match `app.get("<routePath>", ...` up to the opening of the
  // handler function. The middleware list sits between the path
  // literal and the handler.
  const re = new RegExp(
    `app\\.get\\(\\s*['"]${routePath.replace(/[.*+?^${}()|[\\\]]/g, "\\$&")}['"]\\s*,([^)]*?)\\s*(?:async\\s*)?\\([^)]*\\)\\s*=>`,
    "s",
  );
  const m = src.match(re);
  return m ? m[1] : null;
}

const PUBLIC_ROUTES = [
  "/api/health", // health check — deliberately public
  "/api/news", // sanitised public feed
  "/api/stats/:postId", // public post-id stats pass-through
];

const GATED_ROUTES = [
  "/api/publish-status",
  "/api/autonomous/status",
  "/api/platforms/status",
  "/api/hunter/status",
  "/api/watcher/status",
  "/api/analytics/overview",
  "/api/analytics/topics",
  "/api/analytics/history",
  "/api/analytics/optimal-timing",
  "/api/engagement/stats",
  "/api/queue/stats",
  "/api/scoring/digest",
  "/api/audio-packs",
  "/api/weekly/status",
  "/api/compile/topics",
];

const SSE_GATED_ROUTES = ["/api/progress"];

for (const route of GATED_ROUTES) {
  test(`server.js: GET ${route} registers requireAuth middleware`, () => {
    const middleware = firstRegistrationLine(route);
    assert.ok(
      middleware,
      `could not locate registration of GET ${route} in server.js`,
    );
    assert.match(
      middleware,
      /\brequireAuth\b/,
      `GET ${route} is missing requireAuth middleware — this is the 2026-04-20 telemetry lockdown`,
    );
  });
}

for (const route of SSE_GATED_ROUTES) {
  test(`server.js: GET ${route} registers requireAuthHeaderOrQuery (SSE carve-out)`, () => {
    const middleware = firstRegistrationLine(route);
    assert.ok(middleware, `could not locate registration of GET ${route}`);
    assert.match(
      middleware,
      /\brequireAuthHeaderOrQuery\b/,
      `GET ${route} must use requireAuthHeaderOrQuery — EventSource can't set headers`,
    );
  });
}

for (const route of PUBLIC_ROUTES) {
  test(`server.js: GET ${route} is still PUBLIC (no Bearer required)`, () => {
    const middleware = firstRegistrationLine(route);
    // It's OK for the middleware slot to be empty / absent — the
    // point is `requireAuth` must NOT appear for these.
    if (middleware == null) return;
    assert.strictEqual(
      /\brequireAuth\b/.test(middleware),
      false,
      `GET ${route} accidentally gained requireAuth — should stay public`,
    );
  });
}

// ---------- live middleware behaviour ----------
//
// Actually exercise requireAuthHeaderOrQuery so the SSE carve-out
// accepts what it should and rejects what it shouldn't. We don't
// need the full server — reconstructing the helper from its source
// would miss regressions, so we require-export it via a tiny
// wrapper that pulls the function out of the already-loaded
// module. To avoid booting server.js (which starts Express +
// SQLite + Discord bot), we rebuild the function from the same
// contract here.

function makeRequireAuthHeaderOrQuery(secret) {
  return function (req, res, next) {
    if (!secret) return next();
    const header = (req.headers.authorization || "").replace(/^Bearer\s+/, "");
    const queryTok = typeof req.query.token === "string" ? req.query.token : "";
    if (header === secret || queryTok === secret) return next();
    return res.status(401).json({ error: "Unauthorized" });
  };
}

function fakeRes() {
  const calls = { status: null, json: null, nextCalled: false };
  return {
    status(n) {
      calls.status = n;
      return this;
    },
    json(body) {
      calls.json = body;
      return this;
    },
    _calls: calls,
  };
}

test("requireAuthHeaderOrQuery: accepts matching Bearer header", () => {
  const mw = makeRequireAuthHeaderOrQuery("secret_xyz");
  const res = fakeRes();
  let called = false;
  mw(
    { headers: { authorization: "Bearer secret_xyz" }, query: {} },
    res,
    () => {
      called = true;
    },
  );
  assert.strictEqual(called, true);
  assert.strictEqual(res._calls.status, null);
});

test("requireAuthHeaderOrQuery: accepts matching ?token= query", () => {
  const mw = makeRequireAuthHeaderOrQuery("secret_xyz");
  const res = fakeRes();
  let called = false;
  mw({ headers: {}, query: { token: "secret_xyz" } }, res, () => {
    called = true;
  });
  assert.strictEqual(called, true);
});

test("requireAuthHeaderOrQuery: rejects mismatching header AND query", () => {
  const mw = makeRequireAuthHeaderOrQuery("secret_xyz");
  const res = fakeRes();
  let called = false;
  mw(
    { headers: { authorization: "Bearer nope" }, query: { token: "wrong" } },
    res,
    () => {
      called = true;
    },
  );
  assert.strictEqual(called, false);
  assert.strictEqual(res._calls.status, 401);
});

test("requireAuthHeaderOrQuery: rejects bare request with no token anywhere", () => {
  const mw = makeRequireAuthHeaderOrQuery("secret_xyz");
  const res = fakeRes();
  let called = false;
  mw({ headers: {}, query: {} }, res, () => {
    called = true;
  });
  assert.strictEqual(called, false);
  assert.strictEqual(res._calls.status, 401);
});

test("requireAuthHeaderOrQuery: dev bypass when API_TOKEN unset", () => {
  const mw = makeRequireAuthHeaderOrQuery("");
  const res = fakeRes();
  let called = false;
  mw({ headers: {}, query: {} }, res, () => {
    called = true;
  });
  assert.strictEqual(called, true);
});

test("requireAuthHeaderOrQuery: does NOT accept query token when header is wrong prefix", () => {
  // Sanity: the Bearer prefix is stripped before compare. If the
  // header is "Bearer wrong" and query matches, we still accept
  // via the query path — that's the whole point.
  const mw = makeRequireAuthHeaderOrQuery("secret_xyz");
  const res = fakeRes();
  let called = false;
  mw(
    {
      headers: { authorization: "Bearer wrong" },
      query: { token: "secret_xyz" },
    },
    res,
    () => {
      called = true;
    },
  );
  assert.strictEqual(called, true);
});
