const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const uploadYoutube = require("../../upload_youtube");

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "..", "upload_youtube.js"),
  "utf8",
);

test("YouTube upload timeout helper defaults to ten minutes", () => {
  assert.equal(
    uploadYoutube.getYoutubeUploadTimeoutMs({}),
    10 * 60 * 1000,
  );
});

test("YouTube upload timeout helper accepts sane env override", () => {
  assert.equal(
    uploadYoutube.getYoutubeUploadTimeoutMs({
      YOUTUBE_UPLOAD_TIMEOUT_MS: "120000",
    }),
    120000,
  );
});

test("YouTube upload timeout helper rejects too-small override", () => {
  assert.equal(
    uploadYoutube.getYoutubeUploadTimeoutMs({
      YOUTUBE_UPLOAD_TIMEOUT_MS: "1000",
    }),
    10 * 60 * 1000,
  );
});

test("getAuthClient can fall back from stale token file to env refresh token", () => {
  assert.match(
    SRC,
    /useEnvRefreshToken\(oauth2Client,\s*"file_token_refresh_failed"\)/,
    "expired repo-local YouTube tokens should not block a valid env refresh token",
  );
});

test("YouTube video uploads use request timeout options", () => {
  assert.match(
    SRC,
    /youtube\.videos\.insert\([\s\S]*?youtubeRequestOptions\(\)/,
    "youtube.videos.insert must receive a timeout option",
  );
});

test("YouTube upload retry is circuit-breaker labelled", () => {
  assert.match(
    SRC,
    /\{\s*label:\s*"youtube upload",\s*platform:\s*"youtube"\s*\}/,
    "YouTube upload retry should be labelled for circuit breaker state",
  );
});
