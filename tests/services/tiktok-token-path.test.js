/**
 * tests/services/tiktok-token-path.test.js
 *
 * Pins the TIKTOK_TOKEN_PATH env override added 2026-04-19.
 *
 * Background: the TikTok OAuth token was landing on /app/tokens/ which
 * is ephemeral on Railway — every redeploy wiped it, and the next
 * publish cycle failed with "TikTok not authenticated". Parallel to the
 * SQLite fix (SQLITE_DB_PATH=/data/pulse.db), TikTok now resolves its
 * token file through TIKTOK_TOKEN_PATH so it can live on the persistent
 * volume at /data/tokens/tiktok_token.json.
 *
 * Covers:
 *   - resolveTokenPath() prefers TIKTOK_TOKEN_PATH when set
 *   - resolveTokenPath() falls back to the repo-local tokens/ dir for dev
 *   - whitespace-only override is ignored (falls back to default)
 *   - exchangeCode() creates the parent directory before writing
 *   - exchangeCode() writes to the env-overridden path, not the default
 *
 * Run: node --test tests/services/tiktok-token-path.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const path = require("node:path");
const os = require("node:os");

// Save/restore env so tests don't leak TIKTOK_TOKEN_PATH into other suites.
// Async-aware: `await fn()` so the restoration in `finally` happens AFTER
// the callback's Promise settles, not synchronously after it's kicked off.
async function withEnv(patch, fn) {
  const keys = ["TIKTOK_TOKEN_PATH"];
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

test("resolveTokenPath: falls back to repo-local default when env unset", async () => {
  const { resolveTokenPath } = require("../../upload_tiktok");
  const p = await withEnv({ TIKTOK_TOKEN_PATH: undefined }, () =>
    resolveTokenPath(),
  );
  assert.ok(p.endsWith(path.join("tokens", "tiktok_token.json")));
  assert.ok(path.isAbsolute(p));
});

test("resolveTokenPath: honours TIKTOK_TOKEN_PATH env override verbatim", async () => {
  const { resolveTokenPath } = require("../../upload_tiktok");
  const target =
    process.platform === "win32"
      ? "C:\\data\\tokens\\tiktok_token.json"
      : "/data/tokens/tiktok_token.json";
  const p = await withEnv({ TIKTOK_TOKEN_PATH: target }, () =>
    resolveTokenPath(),
  );
  assert.equal(p, target);
});

test("resolveTokenPath: whitespace-only override falls back to default", async () => {
  const { resolveTokenPath } = require("../../upload_tiktok");
  const p = await withEnv({ TIKTOK_TOKEN_PATH: "   " }, () =>
    resolveTokenPath(),
  );
  assert.ok(p.endsWith(path.join("tokens", "tiktok_token.json")));
});

test("exchangeCode: writes to TIKTOK_TOKEN_PATH and creates parent dir", async () => {
  // Use a temp dir with a NESTED parent to prove ensureDir works. On Railway
  // this is /data/tokens which may not pre-exist after volume creation.
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "tiktok-token-"));
  const target = path.join(tmpRoot, "nested", "deeper", "tiktok_token.json");
  assert.equal(await fs.pathExists(path.dirname(target)), false);

  // Stub axios so we don't hit the network.
  const axios = require("axios");
  const origPost = axios.post;
  axios.post = async () => ({
    data: {
      access_token: "test_access_token",
      refresh_token: "test_refresh_token",
      expires_in: 86400,
    },
  });

  try {
    await withEnv(
      {
        TIKTOK_TOKEN_PATH: target,
      },
      async () => {
        // Preserve client key/secret presence; the implementation reads
        // them at call-time. Set deterministic values so a missing .env
        // doesn't change the test outcome.
        process.env.TIKTOK_CLIENT_KEY = "dummy_key";
        process.env.TIKTOK_CLIENT_SECRET = "dummy_secret";
        const { exchangeCode } = require("../../upload_tiktok");
        const tokenData = await exchangeCode("fake_code_from_test");
        assert.ok(tokenData.access_token === "test_access_token");
        assert.ok(typeof tokenData.expires_at === "number");
      },
    );

    // Parent dir was created and token written to the override path, NOT
    // the repo-local default.
    assert.equal(await fs.pathExists(target), true);
    const persisted = await fs.readJson(target);
    assert.equal(persisted.access_token, "test_access_token");
    assert.equal(persisted.refresh_token, "test_refresh_token");
    assert.ok(
      typeof persisted.expires_at === "number" &&
        persisted.expires_at > Date.now(),
    );
  } finally {
    axios.post = origPost;
    await fs.remove(tmpRoot).catch(() => {});
  }
});
