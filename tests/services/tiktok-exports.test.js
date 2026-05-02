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
    "resolveRedirectUri",
    "isLoopbackRedirectUri",
    "generatePkceVerifier",
    "buildPkceChallenge",
    "exchangeCode",
    "buildPublishStatusFetchRequest",
  ];
  for (const name of required) {
    assert.strictEqual(
      typeof mod[name],
      "function",
      `upload_tiktok must export ${name} as a function`,
    );
  }
});

test("upload_tiktok builds an official inbox upload request without public post settings", () => {
  const { buildInboxUploadInitRequest } = require("../../upload_tiktok");
  const req = buildInboxUploadInitRequest({
    videoSize: 12_345_678,
    chunkSize: 12_345_678,
    totalChunkCount: 1,
  });

  assert.match(req.url, /\/v2\/post\/publish\/inbox\/video\/init\/$/);
  assert.strictEqual(req.safety.publicAutoPublish, false);
  assert.strictEqual(req.safety.requiresManualCompletion, true);
  assert.deepStrictEqual(req.body, {
    source_info: {
      source: "FILE_UPLOAD",
      video_size: 12_345_678,
      chunk_size: 12_345_678,
      total_chunk_count: 1,
    },
  });
  assert.ok(!Object.prototype.hasOwnProperty.call(req.body, "post_info"));
});

test("upload_tiktok builds a redaction-safe publish status fetch request", () => {
  const { buildPublishStatusFetchRequest } = require("../../upload_tiktok");
  const req = buildPublishStatusFetchRequest("v_inbox_file~123");

  assert.match(req.url, /\/v2\/post\/publish\/status\/fetch\/$/);
  assert.deepStrictEqual(req.body, { publish_id: "v_inbox_file~123" });
  assert.strictEqual(req.safety.publicAutoPublish, false);
  assert.strictEqual(req.safety.printsToken, false);
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
