const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");

function source(file) {
  return fs.readFileSync(path.join(repoRoot, file), "utf8");
}

function assertEntryPointQaGate(file, functionName, platform) {
  const text = source(file);
  assert.match(
    text,
    /assertPlatformVideoQaPass/,
    `${file} should import/use assertPlatformVideoQaPass`,
  );

  const functionStart = text.indexOf(`async function ${functionName}`);
  assert.notStrictEqual(functionStart, -1, `${functionName} should exist in ${file}`);
  const functionEnd = text.indexOf("\nasync function ", functionStart + 1);
  const body = text.slice(
    functionStart,
    functionEnd === -1 ? text.length : functionEnd,
  );

  const validateIndex = body.indexOf(`await validateVideo(exportedAbs, "${platform}")`);
  const gateIndex = body.indexOf(
    `await assertPlatformVideoQaPass(exportedAbs, { platform: "${platform}" })`,
  );
  assert.notStrictEqual(
    validateIndex,
    -1,
    `${file} ${functionName} should still run validateVideo`,
  );
  assert.notStrictEqual(
    gateIndex,
    -1,
    `${file} ${functionName} should run platform QA upload gate`,
  );
  assert.ok(
    gateIndex > validateIndex,
    `${file} ${functionName} should run platform QA after validateVideo`,
  );
}

test("Instagram upload entrypoints run local platform QA after validateVideo", () => {
  assertEntryPointQaGate("upload_instagram.js", "uploadReel", "instagram");
  assertEntryPointQaGate("upload_instagram.js", "uploadReelViaUrl", "instagram");
});

test("Facebook upload entrypoints run local platform QA after validateVideo", () => {
  assertEntryPointQaGate("upload_facebook.js", "uploadReel", "facebook");
  assertEntryPointQaGate("upload_facebook.js", "uploadReelViaUrl", "facebook");
});

test("TikTok upload entrypoints run local platform QA after validateVideo", () => {
  assertEntryPointQaGate("upload_tiktok.js", "uploadVideoToInbox", "tiktok");
  assertEntryPointQaGate("upload_tiktok.js", "uploadVideo", "tiktok");
});
