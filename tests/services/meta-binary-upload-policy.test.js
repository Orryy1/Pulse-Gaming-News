"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  instagramResumableUploadHeaders,
  metaBinaryUploadHeaders,
  metaBinaryUploadTimeoutMs,
} = require("../../lib/platforms/meta-binary-upload-policy");

test("Meta binary upload timeout scales with file size", () => {
  const small = metaBinaryUploadTimeoutMs(10 * 1024 * 1024);
  const medium = metaBinaryUploadTimeoutMs(64 * 1024 * 1024);
  const large = metaBinaryUploadTimeoutMs(170 * 1024 * 1024);

  assert.equal(small, 300000);
  assert.ok(medium > small);
  assert.ok(large >= 540000);
  assert.ok(large <= 1800000);
});

test("Meta reel uploaders stream media and use the shared adaptive timeout", () => {
  const root = path.resolve(__dirname, "..", "..");
  for (const [filename, expectedHeaders, expectedStream] of [
    [
      "upload_facebook.js",
      /metaBinaryUploadHeaders/,
      /fs\.createReadStream\(delivery\.path\)/,
    ],
    [
      "upload_instagram.js",
      /instagramResumableUploadHeaders/,
      /fs\.createReadStream\(exportedAbs\)/,
    ],
  ]) {
    const source = fs.readFileSync(path.join(root, filename), "utf8");
    assert.match(source, expectedHeaders);
    assert.match(source, /metaBinaryUploadTimeoutMs/);
    assert.match(source, expectedStream);
    assert.doesNotMatch(source, /data:\s*videoBuffer/);
    assert.doesNotMatch(source, /timeout:\s*120000/);
  }
});

test("Meta binary upload headers bind the complete stream length for RUpload", () => {
  assert.deepEqual(
    metaBinaryUploadHeaders(80976910, {
      accessToken: "test-token",
      contentType: "video/mp4",
    }),
    {
      Authorization: "OAuth test-token",
      offset: "0",
      file_size: "80976910",
      "Content-Length": "80976910",
      "X-Entity-Length": "80976910",
      "Content-Type": "video/mp4",
    },
  );
});

test("Instagram resumable upload headers use Meta's documented fields plus the required stream lengths", () => {
  assert.deepEqual(
    instagramResumableUploadHeaders(23299648, {
      accessToken: "test-token",
    }),
    {
      Authorization: "OAuth test-token",
      offset: "0",
      file_size: "23299648",
      "Content-Length": "23299648",
      "X-Entity-Length": "23299648",
    },
  );
});

test("Meta binary upload timeout accepts bounded platform override", () => {
  assert.equal(metaBinaryUploadTimeoutMs(170, {
    env: { FACEBOOK_BINARY_UPLOAD_TIMEOUT_MS: "900000" },
    envName: "FACEBOOK_BINARY_UPLOAD_TIMEOUT_MS",
  }), 900000);
  assert.equal(metaBinaryUploadTimeoutMs(170, {
    env: { FACEBOOK_BINARY_UPLOAD_TIMEOUT_MS: "5000" },
    envName: "FACEBOOK_BINARY_UPLOAD_TIMEOUT_MS",
  }), 120000);
  assert.equal(metaBinaryUploadTimeoutMs(170, {
    env: { FACEBOOK_BINARY_UPLOAD_TIMEOUT_MS: "99999999" },
    envName: "FACEBOOK_BINARY_UPLOAD_TIMEOUT_MS",
  }), 1800000);
});
