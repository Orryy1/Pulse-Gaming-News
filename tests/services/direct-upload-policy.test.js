"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");

const {
  buildDirectUploadPolicy,
  assertDirectUploadAllowed,
} = require("../../lib/services/direct-upload-policy");

function source(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("direct upload policy blocks actual upload by default", () => {
  const policy = buildDirectUploadPolicy({
    platform: "youtube",
    env: {},
    argv: ["node", "upload_youtube.js"],
  });

  assert.equal(policy.mode, "actual_upload");
  assert.equal(policy.blocked, true);
  assert.equal(policy.verdict, "red");
  assert.ok(policy.blockers.includes("direct_upload_not_enabled"));
  assert.throws(
    () => assertDirectUploadAllowed(policy),
    /direct_upload_blocked:youtube:direct_upload_not_enabled/,
  );
});

test("direct upload policy allows explicit unsafe operator mode", () => {
  const policy = buildDirectUploadPolicy({
    platform: "instagram",
    env: {},
    argv: ["node", "upload_instagram.js", "--unsafe-direct-upload"],
  });

  assert.equal(policy.blocked, false);
  assert.equal(policy.verdict, "amber");
  assert.equal(policy.allowReason, "flag:--unsafe-direct-upload");
  assert.equal(policy.unsafeOperatorMode, true);
});

test("direct upload policy allows dry-run and preflight without unsafe mode", () => {
  const dryRun = buildDirectUploadPolicy({
    platform: "facebook",
    env: {},
    argv: ["node", "upload_facebook.js", "--dry-run"],
  });
  const preflight = buildDirectUploadPolicy({
    platform: "tiktok",
    env: {},
    argv: ["node", "upload_tiktok.js", "preflight"],
  });

  assert.equal(dryRun.mode, "dry_run");
  assert.equal(dryRun.blocked, false);
  assert.equal(preflight.mode, "preflight");
  assert.equal(preflight.blocked, false);
});

test("direct upload policy does not treat AUTO_PUBLISH as direct upload consent", () => {
  const policy = buildDirectUploadPolicy({
    platform: "youtube",
    env: { AUTO_PUBLISH: "true" },
    argv: ["node", "upload_youtube.js"],
  });

  assert.equal(policy.autoPublish, true);
  assert.equal(policy.blocked, true);
  assert.ok(policy.blockers.includes("direct_upload_not_enabled"));
});

test("direct upload policy redacts unsafe env values from summaries", () => {
  const policy = buildDirectUploadPolicy({
    platform: "twitter",
    env: {
      DIRECT_UPLOAD_UNSAFE_ALLOW: "true",
      TWITTER_ACCESS_TOKEN: "secret-token-value",
      AUTO_PUBLISH: "false",
    },
    argv: ["node", "upload_twitter.js"],
  });

  const text = JSON.stringify(policy);
  assert.equal(policy.blocked, false);
  assert.equal(policy.allowReason, "env:DIRECT_UPLOAD_UNSAFE_ALLOW");
  assert.ok(!text.includes("secret-token-value"));
});

test("direct uploader modules keep their normal public exports", () => {
  const youtube = require("../../upload_youtube");
  const instagram = require("../../upload_instagram");
  const facebook = require("../../upload_facebook");
  const tiktok = require("../../upload_tiktok");
  const twitter = require("../../upload_twitter");

  assert.equal(typeof youtube.uploadAll, "function");
  assert.equal(typeof youtube.uploadShort, "function");
  assert.equal(typeof instagram.uploadAll, "function");
  assert.equal(typeof instagram.uploadShort, "function");
  assert.equal(typeof facebook.uploadAll, "function");
  assert.equal(typeof facebook.uploadShort, "function");
  assert.equal(typeof tiktok.uploadAll, "function");
  assert.equal(typeof tiktok.uploadShort, "function");
  assert.equal(typeof twitter.uploadAll, "function");
  assert.equal(typeof twitter.uploadShort, "function");
});

test("direct CLI main paths require shared direct upload policy before uploadAll", () => {
  for (const file of [
    "upload_youtube.js",
    "upload_instagram.js",
    "upload_facebook.js",
    "upload_tiktok.js",
    "upload_tiktok_browser.js",
    "upload_twitter.js",
  ]) {
    const src = source(file);
    const mainIndex = src.indexOf("if (require.main === module)");
    assert.notEqual(mainIndex, -1, `${file} must have a CLI main path`);
    const main = src.slice(mainIndex);
    assert.match(main, /assertDirectUploadAllowed/, `${file} must assert direct upload policy`);
    assert.match(main, /buildDirectUploadPolicy/, `${file} must build direct upload policy`);
    assert.ok(
      main.indexOf("assertDirectUploadAllowed") < main.indexOf("uploadAll().catch"),
      `${file} must guard before uploadAll`,
    );
  }
});
