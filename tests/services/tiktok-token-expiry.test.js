/**
 * tests/services/tiktok-token-expiry.test.js
 *
 * Pins the defensive expires_in handling added 2026-04-19 after the
 * TikTok Sandbox OAuth exchange produced a token file with no
 * `expires_at` at all — /api/platforms/status showed expires_at
 * missing, and the refresh logic in getAccessToken only triggers when
 * expires_at is a finite number, so a silently-corrupt token would
 * work for ~24h and then break with no auto-refresh.
 *
 * Covers:
 *   - coerceExpiresIn accepts numbers and numeric strings
 *   - coerceExpiresIn returns null for missing / empty / non-numeric /
 *     zero / negative / NaN / infinite inputs
 *   - buildTokenRecord always produces a numeric expires_at
 *   - buildTokenRecord preserves every field TikTok returned
 *     (access_token, refresh_token, scope, open_id, etc.)
 *   - buildTokenRecord preserves refresh_expires_in → refresh_expires_at
 *     when TikTok returns it
 *   - buildTokenRecord falls back to DEFAULT_EXPIRES_IN_SECONDS when
 *     TikTok omits or corrupts expires_in, and logs a warning WITHOUT
 *     leaking any token content
 *   - exchangeCode writes a file whose expires_at is numeric even
 *     when TikTok's response omits expires_in (the actual 2026-04-19
 *     Sandbox failure mode)
 *   - stored tokens never surface token contents via the status shape
 *
 * Run: node --test tests/services/tiktok-token-expiry.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

const {
  coerceExpiresIn,
  buildTokenRecord,
  DEFAULT_EXPIRES_IN_SECONDS,
  exchangeCode,
} = require("../../upload_tiktok");

// ---------- coerceExpiresIn: number shapes ----------

test("coerceExpiresIn: positive number passes through", () => {
  assert.equal(coerceExpiresIn(86400), 86400);
  assert.equal(coerceExpiresIn(1), 1);
  assert.equal(coerceExpiresIn(31536000), 31536000);
});

test("coerceExpiresIn: positive numeric string is parsed", () => {
  assert.equal(coerceExpiresIn("86400"), 86400);
  assert.equal(coerceExpiresIn("  86400  "), 86400);
  assert.equal(coerceExpiresIn("3600"), 3600);
});

test("coerceExpiresIn: string with trailing units does NOT parse (too risky)", () => {
  // "86400s" could mean seconds OR milliseconds; safer to reject and use
  // the 24h fallback than to guess wrong.
  assert.equal(coerceExpiresIn("86400s"), null);
  assert.equal(coerceExpiresIn("1h"), null);
});

test("coerceExpiresIn: floating-point numbers and strings parse to their number", () => {
  assert.equal(coerceExpiresIn(86400.5), 86400.5);
  assert.equal(coerceExpiresIn("86400.5"), 86400.5);
});

// ---------- coerceExpiresIn: rejection cases ----------

test("coerceExpiresIn: null / undefined / empty string return null", () => {
  assert.equal(coerceExpiresIn(null), null);
  assert.equal(coerceExpiresIn(undefined), null);
  assert.equal(coerceExpiresIn(""), null);
  assert.equal(coerceExpiresIn("   "), null);
});

test("coerceExpiresIn: non-numeric strings return null", () => {
  assert.equal(coerceExpiresIn("abc"), null);
  assert.equal(coerceExpiresIn("N/A"), null);
  assert.equal(coerceExpiresIn("NaN"), null);
});

test("coerceExpiresIn: zero and negatives return null (invalid expiry)", () => {
  assert.equal(coerceExpiresIn(0), null);
  assert.equal(coerceExpiresIn(-1), null);
  assert.equal(coerceExpiresIn("-86400"), null);
  assert.equal(coerceExpiresIn("0"), null);
});

test("coerceExpiresIn: NaN and Infinity return null", () => {
  assert.equal(coerceExpiresIn(NaN), null);
  assert.equal(coerceExpiresIn(Infinity), null);
  assert.equal(coerceExpiresIn(-Infinity), null);
});

test("coerceExpiresIn: non-primitives return null", () => {
  assert.equal(coerceExpiresIn({}), null);
  assert.equal(coerceExpiresIn([]), null);
  assert.equal(coerceExpiresIn(true), null);
  assert.equal(coerceExpiresIn(false), null);
});

// ---------- buildTokenRecord: happy path ----------

test("buildTokenRecord: preserves every TikTok field AND adds numeric expires_at", () => {
  const now = 1_700_000_000_000;
  const input = {
    access_token: "act_x",
    refresh_token: "ref_x",
    open_id: "oid_x",
    scope: "user.info.basic,video.publish,video.upload",
    token_type: "Bearer",
    expires_in: 86400,
  };
  const out = buildTokenRecord(input, { now });
  // Original fields preserved verbatim.
  assert.equal(out.access_token, "act_x");
  assert.equal(out.refresh_token, "ref_x");
  assert.equal(out.open_id, "oid_x");
  assert.equal(out.scope, "user.info.basic,video.publish,video.upload");
  assert.equal(out.token_type, "Bearer");
  assert.equal(out.expires_in, 86400);
  // The critical added field.
  assert.equal(out.expires_at, now + 86400 * 1000);
  assert.equal(typeof out.expires_at, "number");
  assert.ok(Number.isFinite(out.expires_at));
});

test("buildTokenRecord: string expires_in ('86400') normalises to numeric expires_at", () => {
  // This is the exact shape that may have caused the 2026-04-19 sandbox
  // failure — TikTok returning expires_in as a string.
  const now = 1_700_000_000_000;
  const out = buildTokenRecord(
    { access_token: "x", refresh_token: "r", expires_in: "86400" },
    { now },
  );
  assert.equal(out.expires_at, now + 86400 * 1000);
  assert.equal(typeof out.expires_at, "number");
});

test("buildTokenRecord: refresh_expires_in → refresh_expires_at when present", () => {
  const now = 1_700_000_000_000;
  const out = buildTokenRecord(
    {
      access_token: "x",
      refresh_token: "r",
      expires_in: 86400,
      refresh_expires_in: 31536000,
    },
    { now },
  );
  assert.equal(out.refresh_expires_at, now + 31536000 * 1000);
  assert.equal(typeof out.refresh_expires_at, "number");
});

test("buildTokenRecord: omits refresh_expires_at when TikTok omits refresh_expires_in", () => {
  const out = buildTokenRecord({
    access_token: "x",
    refresh_token: "r",
    expires_in: 86400,
  });
  assert.equal("refresh_expires_at" in out, false);
});

// ---------- buildTokenRecord: fallback + warning ----------

test("buildTokenRecord: missing expires_in falls back to DEFAULT_EXPIRES_IN_SECONDS", () => {
  const now = 1_700_000_000_000;
  const logs = [];
  const orig = console.log;
  console.log = (msg) => logs.push(String(msg));
  try {
    const out = buildTokenRecord(
      { access_token: "x", refresh_token: "r" },
      { now },
    );
    assert.equal(out.expires_at, now + DEFAULT_EXPIRES_IN_SECONDS * 1000);
    assert.equal(typeof out.expires_at, "number");
    // Warning was logged.
    const warned = logs.some(
      (l) =>
        l.includes("[tiktok] WARNING") &&
        l.includes("expires_in") &&
        l.includes(String(DEFAULT_EXPIRES_IN_SECONDS)),
    );
    assert.ok(warned, `expected warning log; got: ${logs.join(" | ")}`);
    // Warning must not contain the access_token or refresh_token.
    for (const l of logs) {
      assert.ok(!l.includes("act_x"), `log leaked access_token: ${l}`);
      assert.ok(!l.includes("ref_x"), `log leaked refresh_token: ${l}`);
    }
  } finally {
    console.log = orig;
  }
});

test("buildTokenRecord: invalid expires_in ('bogus') falls back to default + warning", () => {
  const now = 1_700_000_000_000;
  const origLog = console.log;
  const logs = [];
  console.log = (msg) => logs.push(String(msg));
  try {
    const out = buildTokenRecord(
      { access_token: "x", refresh_token: "r", expires_in: "bogus" },
      { now },
    );
    assert.equal(out.expires_at, now + DEFAULT_EXPIRES_IN_SECONDS * 1000);
    assert.ok(logs.some((l) => l.includes("[tiktok] WARNING")));
  } finally {
    console.log = origLog;
  }
});

test("buildTokenRecord: zero / negative expires_in treated as invalid → default", () => {
  const now = 1_700_000_000_000;
  const origLog = console.log;
  console.log = () => {};
  try {
    const outZero = buildTokenRecord(
      { access_token: "x", expires_in: 0 },
      { now },
    );
    assert.equal(outZero.expires_at, now + DEFAULT_EXPIRES_IN_SECONDS * 1000);
    const outNeg = buildTokenRecord(
      { access_token: "x", expires_in: -1 },
      { now },
    );
    assert.equal(outNeg.expires_at, now + DEFAULT_EXPIRES_IN_SECONDS * 1000);
  } finally {
    console.log = origLog;
  }
});

test("buildTokenRecord: DEFAULT_EXPIRES_IN_SECONDS is a conservative 24h", () => {
  // Document the invariant so changes to this constant fail a test
  // rather than silently shifting the refresh cadence.
  assert.equal(DEFAULT_EXPIRES_IN_SECONDS, 86400);
});

test("buildTokenRecord: null / undefined / non-object input returns a safe record", () => {
  // Defensive: if something upstream hands us garbage, don't throw.
  const now = 1_700_000_000_000;
  const origLog = console.log;
  console.log = () => {};
  try {
    const outNull = buildTokenRecord(null, { now });
    assert.equal(typeof outNull.expires_at, "number");
    assert.equal(outNull.expires_at, now + DEFAULT_EXPIRES_IN_SECONDS * 1000);
    const outUndef = buildTokenRecord(undefined, { now });
    assert.equal(typeof outUndef.expires_at, "number");
  } finally {
    console.log = origLog;
  }
});

// ---------- Integration: exchangeCode writes a sane file even with missing expires_in ----------

async function withEnv(patch, fn) {
  const keys = [
    "TIKTOK_TOKEN_PATH",
    "TIKTOK_CLIENT_KEY",
    "TIKTOK_CLIENT_SECRET",
  ];
  const before = {};
  for (const k of keys) before[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return await fn();
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

test("exchangeCode: writes numeric expires_at even when TikTok response has no expires_in", async () => {
  // Replicates the 2026-04-19 sandbox shape — expires_in missing from
  // the response entirely. The file on disk MUST still end up with a
  // finite numeric expires_at or the auto-refresh logic can't fire.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-expiry-"));
  const target = path.join(tmp, "tokens", "tiktok_token.json");
  const axios = require("axios");
  const origPost = axios.post;
  axios.post = async () => ({
    data: {
      access_token: "fake_access_xyz",
      refresh_token: "fake_refresh_xyz",
      open_id: "fake_open_id",
      scope: "user.info.basic,video.publish,video.upload",
      token_type: "Bearer",
      // intentionally NO expires_in
    },
  });
  const origLog = console.log;
  console.log = () => {};
  try {
    await withEnv(
      {
        TIKTOK_TOKEN_PATH: target,
        TIKTOK_CLIENT_KEY: "dummy",
        TIKTOK_CLIENT_SECRET: "dummy",
      },
      async () => {
        await exchangeCode("fake_code");
      },
    );
    const persisted = await fs.readJson(target);
    assert.equal(typeof persisted.expires_at, "number");
    assert.ok(
      Number.isFinite(persisted.expires_at),
      `expires_at must be finite; got ${persisted.expires_at}`,
    );
    assert.ok(persisted.expires_at > Date.now());
    // Original fields still there.
    assert.equal(persisted.access_token, "fake_access_xyz");
    assert.equal(persisted.refresh_token, "fake_refresh_xyz");
  } finally {
    console.log = origLog;
    axios.post = origPost;
    await fs.remove(tmp).catch(() => {});
  }
});

test("exchangeCode: string expires_in still produces numeric expires_at", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-expiry-"));
  const target = path.join(tmp, "tokens", "tiktok_token.json");
  const axios = require("axios");
  const origPost = axios.post;
  axios.post = async () => ({
    data: {
      // Realistic-length access_token — the 2026-04-20 fix added a
      // min-length assertion to reject TikTok error bodies that have
      // empty/short access_token values. Use a value long enough to
      // pass that check while still keeping the test focused on
      // expires_in string coercion.
      access_token: "act.example12345Example12345Example",
      refresh_token: "rft.example12345Example12345Example",
      expires_in: "86400", // string form
    },
  });
  const origLog = console.log;
  console.log = () => {};
  try {
    await withEnv(
      {
        TIKTOK_TOKEN_PATH: target,
        TIKTOK_CLIENT_KEY: "dummy",
        TIKTOK_CLIENT_SECRET: "dummy",
      },
      async () => {
        await exchangeCode("fake");
      },
    );
    const persisted = await fs.readJson(target);
    assert.equal(typeof persisted.expires_at, "number");
    assert.ok(Number.isFinite(persisted.expires_at));
  } finally {
    console.log = origLog;
    axios.post = origPost;
    await fs.remove(tmp).catch(() => {});
  }
});
