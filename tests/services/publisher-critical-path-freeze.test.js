"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const publisherSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "publisher.js"),
  "utf8",
);
const runnerSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "run.js"),
  "utf8",
);
const processorSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "processor.js"),
  "utf8",
);
const youtubeSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "upload_youtube.js"),
  "utf8",
);

test("the governed production path excludes premature commercial work", () => {
  const produceStart = publisherSource.indexOf("async function produce()");
  const produceEnd = publisherSource.indexOf(
    "// --- Format catalogue generation",
    produceStart,
  );
  const produceBody = publisherSource.slice(produceStart, produceEnd);

  assert.ok(produceStart >= 0, "produce() must exist");
  assert.doesNotMatch(produceBody, /require\(["']\.\/affiliates["']\)/);
  assert.doesNotMatch(produceBody, /\bawait affiliates\s*\(/);
});

test("the governed production path excludes secondary-platform asset work", () => {
  const produceStart = publisherSource.indexOf("async function produce()");
  const produceEnd = publisherSource.indexOf(
    "// --- Format catalogue generation",
    produceStart,
  );
  const produceBody = publisherSource.slice(produceStart, produceEnd);

  assert.doesNotMatch(produceBody, /require\(["']\.\/images_story["']\)/);
  assert.doesNotMatch(produceBody, /\bgenerateStoryImages\s*\(/);
});

test("legacy broad-autonomy cycles cannot dispatch or auto-approve", () => {
  const fullStart = publisherSource.indexOf(
    "async function fullAutonomousCycle()",
  );
  const fullEnd = publisherSource.indexOf(
    "// --- Publish-only cycle",
    fullStart,
  );
  const publishOnlyStart = publisherSource.indexOf(
    "async function publishOnlyCycle()",
  );
  const publishOnlyEnd = publisherSource.indexOf(
    "async function _publishNextStoryWithMemoryLock",
    publishOnlyStart,
  );
  const fullBody = publisherSource.slice(fullStart, fullEnd);
  const publishOnlyBody = publisherSource.slice(
    publishOnlyStart,
    publishOnlyEnd,
  );

  assert.doesNotMatch(fullBody, /\bpublishToAllPlatforms\s*\(/);
  assert.doesNotMatch(fullBody, /process\.env\.AUTO_PUBLISH/);
  assert.match(fullBody, /stabilisation_human_review_required/);
  assert.doesNotMatch(publishOnlyBody, /\bautoApprove\s*\(/);
  assert.doesNotMatch(publishOnlyBody, /\bproduce\s*\(/);
  assert.doesNotMatch(publishOnlyBody, /\bpublishToAllPlatforms\s*\(/);
  assert.match(publishOnlyBody, /stabilisation_human_review_required/);
});

test("the command-line produce path delegates to the governed renderer graph", () => {
  const start = runnerSource.indexOf("async function runProduce()");
  const end = runnerSource.indexOf("async function runPublish()", start);
  const body = runnerSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(body, /require\(["']\.\/publisher["']\)/);
  assert.match(body, /\bproduce\s*\(/);
  assert.doesNotMatch(body, /require\(["']\.\/affiliates["']\)/);
  assert.doesNotMatch(body, /require\(["']\.\/assemble["']\)/);
  assert.doesNotMatch(body, /require\(["']\.\/images_story["']\)/);
});

test("the command-line publish path enters the governed single-story dispatcher", () => {
  const start = runnerSource.indexOf("async function runPublish()");
  const end = runnerSource.indexOf("async function runFull()", start);
  const body = runnerSource.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(body, /publishNextStory/);
  assert.doesNotMatch(body, /publishToAllPlatforms/);
});

test("story processing and YouTube metadata do not reinsert frozen commercial or generic CTA copy", () => {
  assert.doesNotMatch(processorSource, /process\.env\.AMAZON_AFFILIATE_TAG/);
  assert.doesNotMatch(processorSource, /affiliate_url:\s*affiliateUrl/);
  assert.doesNotMatch(processorSource, /pinned_comment:\s*pinnedComment/);
  assert.doesNotMatch(
    processorSource,
    /What do you think, legit or fake\?/i,
  );
  assert.doesNotMatch(
    youtubeSource,
    /Subscribe so you never miss a roundup\./i,
  );
});
