const { test } = require("node:test");
const assert = require("node:assert");

// Regression test for the TikTok heal path. `/api/platforms/status?heal=true`
// in server.js destructures `getAccessToken` from upload_tiktok and awaits
// it. Before this test existed, `getAccessToken` was defined in the module
// but missing from module.exports, so the server path threw
// "getAccessToken is not a function" and the token was never repaired.
// Pin the export surface so that regresses loudly if someone removes it.

test("upload_tiktok exports getAccessToken as a function (heal-path contract)", () => {
  const mod = require("../../upload_tiktok");
  assert.strictEqual(
    typeof mod.getAccessToken,
    "function",
    "getAccessToken must be exported so server.js can call it from ?heal=true",
  );
});

test("upload_tiktok exports the full public surface required by server.js", () => {
  // The server imports these names directly from the module. If any goes
  // missing, the corresponding route will 500. Keep this list in sync
  // with what server.js actually destructures.
  const mod = require("../../upload_tiktok");
  const required = [
    "getAccessToken",
    "resolveTokenPath",
    "uploadVideo",
    "uploadShort",
    "uploadAll",
    "generateAuthUrl",
    "buildAuthorizeUrl",
    "exchangeCode",
  ];
  for (const name of required) {
    assert.strictEqual(
      typeof mod[name],
      "function",
      `upload_tiktok must export ${name} as a function`,
    );
  }
});

test("server.js's platforms/status heal destructure matches upload_tiktok exports", () => {
  // Guard against the specific shape the heal route uses. If server.js
  // is refactored to destructure new names, or upload_tiktok's export
  // list changes, this test will catch the drift before a deploy does.
  const mod = require("../../upload_tiktok");
  const { resolveTokenPath, getAccessToken } = mod;
  assert.strictEqual(typeof resolveTokenPath, "function");
  assert.strictEqual(typeof getAccessToken, "function");
});
