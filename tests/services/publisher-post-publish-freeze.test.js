"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const publisherSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "publisher.js"),
  "utf8",
);

test("the governed publish path does not generate or post autonomous engagement", () => {
  assert.equal(/\bgeneratePollComment\b/.test(publisherSource), false);
  assert.equal(
    /\bpinEngagement\s*\(\s*story\.youtube_post_id/.test(publisherSource),
    false,
  );
});

test("blog generation is not a post-publish side effect", () => {
  assert.equal(/\bgenerateAndSaveBlogPost\b/.test(publisherSource), false);
});
