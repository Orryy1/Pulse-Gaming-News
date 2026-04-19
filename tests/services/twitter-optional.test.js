/**
 * tests/services/twitter-optional.test.js
 *
 * Pins the TWITTER_ENABLED=true opt-in added 2026-04-19. Twitter/X is
 * explicitly optional because the free API tier cannot post videos
 * (since Feb 2023) and paid tiers start at $200/mo — so the default
 * behaviour is "do not call the API at all, return a structured skipped
 * result that the Discord summary renders as '⏸ disabled'."
 *
 * Covers:
 *   - uploadShort returns { skipped: true, reason: 'twitter_disabled' }
 *     when TWITTER_ENABLED is unset, "false", "" or anything other than
 *     the exact string "true"
 *   - uploadShort does NOT call axios when disabled (no 402 noise, no
 *     Sentry breadcrumb, no media upload)
 *   - uploadAll short-circuits to [] when disabled
 *   - postImageTweet returns the same structured skipped result
 *   - twitterEnabled() helper matches the gate
 *
 * Run: node --test tests/services/twitter-optional.test.js
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// Async-aware wrapper: awaits the callback so `finally` restoration
// happens after the async callback settles, not synchronously after the
// Promise is kicked off.
async function withEnv(patch, fn) {
  const keys = ["TWITTER_ENABLED"];
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

test("twitterEnabled: default (env unset) returns false", async () => {
  const { twitterEnabled } = require("../../upload_twitter");
  const v = await withEnv({ TWITTER_ENABLED: undefined }, () =>
    twitterEnabled(),
  );
  assert.equal(v, false);
});

test("twitterEnabled: 'false' / '' / 'no' return false", async () => {
  const { twitterEnabled } = require("../../upload_twitter");
  for (const val of ["false", "", "no", "0", "FALSE"]) {
    const v = await withEnv({ TWITTER_ENABLED: val }, () => twitterEnabled());
    assert.equal(v, false, `expected false for TWITTER_ENABLED="${val}"`);
  }
});

test("twitterEnabled: 'true' returns true (case-insensitive)", async () => {
  const { twitterEnabled } = require("../../upload_twitter");
  for (const val of ["true", "TRUE", "True"]) {
    const v = await withEnv({ TWITTER_ENABLED: val }, () => twitterEnabled());
    assert.equal(v, true, `expected true for TWITTER_ENABLED="${val}"`);
  }
});

test("uploadShort: returns structured skipped without calling axios when disabled", async () => {
  const axios = require("axios");
  const origPost = axios.post;
  const origGet = axios.get;
  let called = false;
  axios.post = async () => {
    called = true;
    throw new Error("axios.post should NEVER be called when disabled");
  };
  axios.get = async () => {
    called = true;
    throw new Error("axios.get should NEVER be called when disabled");
  };

  try {
    const result = await withEnv({ TWITTER_ENABLED: "false" }, async () => {
      const { uploadShort } = require("../../upload_twitter");
      return await uploadShort({
        id: "test-1",
        title: "test",
        exported_path: "/does/not/exist.mp4",
      });
    });
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "twitter_disabled");
    assert.equal(result.platform, "twitter");
    assert.equal(called, false, "no axios call should have happened");
  } finally {
    axios.post = origPost;
    axios.get = origGet;
  }
});

test("uploadAll: returns [] and makes no axios call when disabled", async () => {
  const axios = require("axios");
  const origPost = axios.post;
  let called = false;
  axios.post = async () => {
    called = true;
    throw new Error("axios.post should NEVER be called when disabled");
  };

  try {
    const result = await withEnv({ TWITTER_ENABLED: "false" }, async () => {
      const { uploadAll } = require("../../upload_twitter");
      return await uploadAll();
    });
    assert.deepEqual(result, []);
    assert.equal(called, false);
  } finally {
    axios.post = origPost;
  }
});

test("postImageTweet: returns structured skipped when disabled", async () => {
  const result = await withEnv({ TWITTER_ENABLED: "false" }, async () => {
    const { postImageTweet } = require("../../upload_twitter");
    return await postImageTweet({
      id: "test-2",
      title: "test",
      story_image_path: "/does/not/exist.png",
    });
  });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "twitter_disabled");
  assert.equal(result.platform, "twitter_image");
});
