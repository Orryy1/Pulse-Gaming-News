const { test, before, beforeEach, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

// Tests for the 2026-04-20/21 TikTok auth-honesty pass:
//   - inspectTokenStatus() returns a structured read-only check,
//     never touches TikTok, never logs token values
//   - getAccessToken() no longer silently swallows refresh failures
//     or returns a stale token on a dead refresh_token
//   - handleTiktokAuthCheck() scheduled job alerts Discord on real
//     problems and refreshes proactively near expiry, without
//     leaking token values in the alert

const { inspectTokenStatus, getAccessToken } = require("../../upload_tiktok");

// Temp-file helpers so every test gets an isolated token path.
let tmpRoot;
let tokenFile;
let originalEnv;

before(() => {
  originalEnv = {
    TIKTOK_TOKEN_PATH: process.env.TIKTOK_TOKEN_PATH,
    TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY,
    TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET,
  };
});

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-"));
  tokenFile = path.join(tmpRoot, "tiktok_token.json");
  process.env.TIKTOK_TOKEN_PATH = tokenFile;
  process.env.TIKTOK_CLIENT_KEY = "sbfake";
  process.env.TIKTOK_CLIENT_SECRET = "sbfakesecret";
});

after(async () => {
  for (const k of Object.keys(originalEnv)) {
    if (originalEnv[k] === undefined) delete process.env[k];
    else process.env[k] = originalEnv[k];
  }
});

// ---------- inspectTokenStatus ----------

test("inspectTokenStatus: token file missing → needs_reauth", async () => {
  const r = await inspectTokenStatus();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "token_file_missing");
  assert.strictEqual(r.needs_reauth, true);
  assert.strictEqual(r.refresh_available, false);
  assert.strictEqual(r.expires_at, null);
});

test("inspectTokenStatus: garbage error-body token → needs_reauth", async () => {
  // Exact shape the prod /data file held after the JSON-body bug:
  // error/error_description/log_id + a synthesised expires_at but
  // zero actual token fields.
  await fs.writeJson(tokenFile, {
    error: "invalid_request",
    error_description:
      "Only `application/x-www-form-urlencoded` is accepted as Content-Type.",
    log_id: "abc",
    expires_at: Date.now() + 86_400_000,
  });
  const r = await inspectTokenStatus();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "access_token_missing");
  assert.strictEqual(r.needs_reauth, true);
});

test("inspectTokenStatus: valid token far from expiry → ok", async () => {
  const expiresAt = Date.now() + 86_400_000; // 24h
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    refresh_token: "rft.example12345Example12345",
    expires_at: expiresAt,
  });
  const r = await inspectTokenStatus();
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.reason, "ok");
  assert.strictEqual(r.needs_reauth, false);
  assert.strictEqual(r.refresh_available, true);
  assert.ok(r.expires_in_seconds > 86_000);
});

test("inspectTokenStatus: expired token with refresh_token → not ok, can heal", async () => {
  const expiresAt = Date.now() - 60_000;
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    refresh_token: "rft.example12345Example12345",
    expires_at: expiresAt,
  });
  const r = await inspectTokenStatus();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "expired");
  assert.strictEqual(r.needs_reauth, false);
  assert.strictEqual(r.refresh_available, true);
});

test("inspectTokenStatus: expired token with NO refresh_token → needs_reauth", async () => {
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    expires_at: Date.now() - 60_000,
  });
  const r = await inspectTokenStatus();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "expired");
  assert.strictEqual(r.needs_reauth, true);
  assert.strictEqual(r.refresh_available, false);
});

test("inspectTokenStatus: missing expires_at with refresh → heal-able, no reauth", async () => {
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    refresh_token: "rft.example12345Example12345",
  });
  const r = await inspectTokenStatus();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.reason, "expires_at_invalid");
  assert.strictEqual(r.refresh_available, true);
  assert.strictEqual(r.needs_reauth, false);
});

test("inspectTokenStatus: `now` is injectable for deterministic boundary tests", async () => {
  const fixed = 1_800_000_000_000;
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    refresh_token: "rft.example12345Example12345",
    expires_at: fixed + 5 * 60 * 1000, // 5 min ahead
  });
  const r = await inspectTokenStatus({ now: fixed });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.expires_in_seconds, 300);
});

// ---------- getAccessToken honesty ----------

test("getAccessToken: throws on expired-without-refresh instead of silently returning stale", async () => {
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    expires_at: Date.now() - 60_000,
  });
  await assert.rejects(getAccessToken(), (err) => {
    // The specific message matters — scheduled job + heal endpoint
    // match on this wording to classify the failure.
    assert.match(err.message, /no refresh_token/i);
    assert.match(err.message, /\/auth\/tiktok/);
    return true;
  });
});

test("getAccessToken: propagates refresh-API failure instead of silently returning stale", async () => {
  // Mock axios.post so the refresh call comes back with TikTok's
  // error shape. Old behaviour: silently logged + returned stale
  // access_token. New behaviour: throw.
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    refresh_token: "rft.example12345Example12345",
    expires_at: Date.now() - 60_000,
  });
  const axios = require("axios");
  const origPost = axios.post;
  axios.post = async () => {
    // TikTok OAuth errors come back as 200 + error body; our
    // assertTokenResponse should still catch this.
    return { data: { error: "invalid_grant", error_description: "dead" } };
  };
  try {
    await assert.rejects(getAccessToken(), (err) => {
      assert.match(err.message, /refresh rejected|invalid_grant/i);
      return true;
    });
  } finally {
    axios.post = origPost;
  }
});

test("getAccessToken: valid fresh token returns access_token without hitting TikTok", async () => {
  const axios = require("axios");
  const origPost = axios.post;
  let called = false;
  axios.post = async () => {
    called = true;
    throw new Error("should not have hit TikTok");
  };
  try {
    await fs.writeJson(tokenFile, {
      access_token: "act.example12345Example12345",
      refresh_token: "rft.example12345Example12345",
      expires_at: Date.now() + 86_400_000,
    });
    const tok = await getAccessToken();
    assert.strictEqual(tok, "act.example12345Example12345");
    assert.strictEqual(called, false);
  } finally {
    axios.post = origPost;
  }
});

// ---------- scheduled job: handleTiktokAuthCheck ----------
//
// The handler lives in lib/job-handlers.js and calls Discord
// notify() on alerts. We stub the notify module via require-cache
// mutation and assert on what the handler tried to send.

function stubDiscord() {
  const sent = [];
  const cacheKey = require.resolve("../../notify");
  require.cache[cacheKey] = {
    id: cacheKey,
    filename: cacheKey,
    loaded: true,
    exports: async (msg) => sent.push(msg),
  };
  return {
    sent,
    restore() {
      delete require.cache[cacheKey];
    },
  };
}

function clearHandlersCache() {
  delete require.cache[require.resolve("../../lib/job-handlers")];
}

test("handleTiktokAuthCheck: silent success when token is healthy", async () => {
  await fs.writeJson(tokenFile, {
    access_token: "act.example12345Example12345",
    refresh_token: "rft.example12345Example12345",
    expires_at: Date.now() + 86_400_000, // 24h ahead — well past 3h threshold
  });
  const discord = stubDiscord();
  try {
    clearHandlersCache();
    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.tiktok_auth_check({}, { log() {} });
    assert.strictEqual(result.initial_reason, "ok");
    assert.strictEqual(result.refresh_attempted, false);
    assert.strictEqual(discord.sent.length, 0);
  } finally {
    discord.restore();
  }
});

test("handleTiktokAuthCheck: alerts when token file is missing", async () => {
  // No token file written for this test.
  const discord = stubDiscord();
  try {
    clearHandlersCache();
    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.tiktok_auth_check({}, { log() {} });
    assert.strictEqual(result.initial_reason, "token_file_missing");
    assert.strictEqual(result.needs_reauth, true);
    assert.strictEqual(discord.sent.length, 1);
    const msg = discord.sent[0];
    assert.match(msg, /TikTok token broken/);
    assert.match(msg, /token_file_missing/);
    assert.match(msg, /\/auth\/tiktok/);
  } finally {
    discord.restore();
  }
});

test("handleTiktokAuthCheck: alerts when token has access_token_missing (garbage file)", async () => {
  await fs.writeJson(tokenFile, {
    error: "invalid_request",
    error_description: "something",
    expires_at: Date.now() + 86_400_000,
  });
  const discord = stubDiscord();
  try {
    clearHandlersCache();
    const { handlers } = require("../../lib/job-handlers");
    const result = await handlers.tiktok_auth_check({}, { log() {} });
    assert.strictEqual(result.initial_reason, "access_token_missing");
    assert.strictEqual(result.needs_reauth, true);
    assert.strictEqual(discord.sent.length, 1);
    assert.match(discord.sent[0], /access_token_missing/);
  } finally {
    discord.restore();
  }
});

test("handleTiktokAuthCheck: alert message does NOT include token-shaped values", async () => {
  await fs.writeJson(tokenFile, {
    access_token: "act.SECRET_ACCESS_TOKEN_VALUE",
    refresh_token: "rft.SECRET_REFRESH_TOKEN_VALUE",
    expires_at: Date.now() - 60_000, // expired
  });
  // Break the refresh endpoint so the handler tries to refresh and
  // fails — producing the richest alert path.
  const axios = require("axios");
  const origPost = axios.post;
  axios.post = async () => ({
    data: { error: "invalid_grant", error_description: "dead" },
  });
  const discord = stubDiscord();
  try {
    clearHandlersCache();
    const { handlers } = require("../../lib/job-handlers");
    await handlers.tiktok_auth_check({}, { log() {} });
    const allText = discord.sent.join("\n");
    assert.strictEqual(
      allText.includes("SECRET_ACCESS_TOKEN_VALUE"),
      false,
      "access_token value leaked to Discord alert",
    );
    assert.strictEqual(
      allText.includes("SECRET_REFRESH_TOKEN_VALUE"),
      false,
      "refresh_token value leaked to Discord alert",
    );
  } finally {
    axios.post = origPost;
    discord.restore();
  }
});

// ---------- scheduler registration ----------

test("scheduler.DEFAULT_SCHEDULES: tiktok_auth_check is registered at 17:30 UTC", () => {
  const { DEFAULT_SCHEDULES } = require("../../lib/scheduler");
  const entry = DEFAULT_SCHEDULES.find((s) => s.name === "tiktok_auth_check");
  assert.ok(entry, "tiktok_auth_check schedule row missing");
  assert.strictEqual(entry.kind, "tiktok_auth_check");
  assert.strictEqual(entry.cron_expr, "30 17 * * *");
  assert.ok(
    entry.idempotencyTemplate.includes("{date}"),
    "idempotency template should key on {date} to dedupe per-day",
  );
});
