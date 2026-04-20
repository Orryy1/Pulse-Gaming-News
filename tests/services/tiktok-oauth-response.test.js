const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs-extra");
const os = require("os");
const path = require("path");

// Regression coverage for the 2026-04-20 "garbage token" incident.
// TikTok's v2 OAuth endpoint requires application/x-www-form-urlencoded.
// Sending JSON made TikTok return a 200-level response whose body was an
// error object — `{error:"invalid_request", error_description:"Only
// \`application/x-www-form-urlencoded\` is accepted as Content-Type."}`.
// Because exchangeCode didn't check for `error` and buildTokenRecord
// spread every top-level field into a "token record", the error body
// was persisted to /data/tokens/tiktok_token.json as if it were a
// token, complete with a synthesised 24h expires_at. Status then looked
// "healthy" while every publish would have sent `undefined` as the
// bearer. These tests pin the invariants that would have caught it.

const { assertTokenResponse, getAccessToken } = require("../../upload_tiktok");

// ---------- assertTokenResponse ----------

test("assertTokenResponse: throws on the exact error body TikTok returned", () => {
  assert.throws(
    () =>
      assertTokenResponse(
        {
          error: "invalid_request",
          error_description:
            "Only `application/x-www-form-urlencoded` is accepted as Content-Type.",
          log_id: "202604201234",
        },
        "code exchange",
      ),
    (err) => {
      assert.match(err.message, /code exchange rejected/);
      assert.match(err.message, /invalid_request/);
      assert.match(err.message, /x-www-form-urlencoded/);
      return true;
    },
  );
});

test("assertTokenResponse: throws on missing access_token", () => {
  // Some error bodies omit the `error` field entirely (we've seen rate
  // limit messages from TikTok's sandbox do this). The absent
  // access_token is the belt-and-braces guard.
  assert.throws(
    () => assertTokenResponse({ log_id: "abc", open_id: "oid" }, "refresh"),
    /missing access_token/,
  );
});

test("assertTokenResponse: throws on a token that's suspiciously short", () => {
  // `access_token: ""` would otherwise spread into a record with an
  // empty-string bearer, which is worse than throwing.
  assert.throws(
    () => assertTokenResponse({ access_token: "" }, "code exchange"),
    /missing access_token/,
  );
  assert.throws(
    () => assertTokenResponse({ access_token: "abc" }, "code exchange"),
    /missing access_token/,
  );
});

test("assertTokenResponse: passes on a real-looking TikTok token body", () => {
  assert.doesNotThrow(() =>
    assertTokenResponse(
      {
        access_token: "act.example12345Example12345Example",
        refresh_token: "rft.example12345Example12345Example",
        expires_in: 86400,
        open_id: "oid",
        scope: "user.info.basic,video.publish,video.upload",
        token_type: "Bearer",
      },
      "code exchange",
    ),
  );
});

test("assertTokenResponse: throws on null / undefined / non-object bodies", () => {
  assert.throws(() => assertTokenResponse(null, "code exchange"), /no JSON/);
  assert.throws(() => assertTokenResponse(undefined, "refresh"), /no JSON/);
  assert.throws(
    () => assertTokenResponse("oops string body", "code exchange"),
    /no JSON/,
  );
});

// ---------- getAccessToken with a corrupted file on disk ----------

test("getAccessToken: rejects a token file that has expires_at but no access_token", async () => {
  // Simulate exactly the /data file we saw in prod after the bad
  // callback: numeric expires_at (so hasValidExpiry=true in the old
  // code), error fields, no access_token. Previously this silently
  // returned `undefined` as the bearer; now it should throw a clear
  // re-auth instruction.
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-"));
  const tokenFile = path.join(tmp, "tiktok_token.json");
  await fs.writeJson(tokenFile, {
    error: "invalid_request",
    error_description:
      "Only `application/x-www-form-urlencoded` is accepted as Content-Type.",
    log_id: "abc",
    expires_at: Date.now() + 86_400_000,
  });

  const prev = process.env.TIKTOK_TOKEN_PATH;
  process.env.TIKTOK_TOKEN_PATH = tokenFile;
  try {
    await assert.rejects(getAccessToken(), (err) => {
      assert.match(err.message, /no access_token/);
      assert.match(err.message, /\/auth\/tiktok/);
      // The previous error should be surfaced so the operator knows why
      // the file is bad without having to read it themselves.
      assert.match(err.message, /invalid_request/);
      return true;
    });
  } finally {
    if (prev === undefined) delete process.env.TIKTOK_TOKEN_PATH;
    else process.env.TIKTOK_TOKEN_PATH = prev;
    await fs.remove(tmp).catch(() => {});
  }
});

test("getAccessToken: rejects on an empty-string access_token too", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-tiktok-"));
  const tokenFile = path.join(tmp, "tiktok_token.json");
  await fs.writeJson(tokenFile, {
    access_token: "",
    refresh_token: "rft.real",
    expires_at: Date.now() + 86_400_000,
  });

  const prev = process.env.TIKTOK_TOKEN_PATH;
  process.env.TIKTOK_TOKEN_PATH = tokenFile;
  try {
    await assert.rejects(getAccessToken(), /no access_token/);
  } finally {
    if (prev === undefined) delete process.env.TIKTOK_TOKEN_PATH;
    else process.env.TIKTOK_TOKEN_PATH = prev;
    await fs.remove(tmp).catch(() => {});
  }
});
