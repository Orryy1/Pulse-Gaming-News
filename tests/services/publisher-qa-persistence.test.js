const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

// QA-fail deadlock fix (2026-04-21)
//
// Before: publisher.js::_publishNextStoryInner ran content-QA +
// video-QA in a pre-flight block. On hard-fail it returned an
// in-memory { qa_failed: true } result but NEVER wrote that state
// to the story row. Consequence: the selector at the top of the
// function had no way to know the story had been refused, so the
// same story got re-picked at the NEXT publish window (and the
// one after that — three 09/14/19 UTC windows per day wasted on
// one broken story).
//
// Fix: on QA hard-fail, set story.qa_failed=true,
// story.publish_status="failed", story.publish_error,
// story.qa_failed_at, then await db.upsertStory(story) BEFORE
// returning. The publish candidate selector now skips
// qa_failed=true and publish_status="failed" rows.
//
// These tests combine source-scan pins (so the fix can't be
// silently reverted) with integration tests that drive
// publishNextStory() against stubbed content-qa / video-qa /
// db / uploader modules to assert the persistence actually
// happens.

const PUBLISHER_PATH = path.join(__dirname, "..", "..", "publisher.js");
const SRC = fs.readFileSync(PUBLISHER_PATH, "utf8");

// ---------- source-scan pins ----------

test("publisher.js: content-QA fail branch persists qa_failed + publish_status=failed BEFORE returning", () => {
  // Find the content-QA fail block. Anchor on the log line we emit
  // for this specific failure so we're not matching the video-QA
  // block or anything else.
  const idx = SRC.indexOf("content QA FAIL — refusing to publish");
  assert.ok(
    idx > 0,
    "content QA fail log line must exist as an anchor for this test",
  );
  // Take a generous window forward from the anchor — the block
  // spans roughly 30 lines including persistence + return.
  const block = SRC.slice(idx, idx + 2500);
  assert.match(
    block,
    /story\.qa_failed\s*=\s*true/,
    "content-QA fail block must set story.qa_failed = true",
  );
  assert.match(
    block,
    /story\.publish_status\s*=\s*["']failed["']/,
    "content-QA fail block must set story.publish_status = 'failed'",
  );
  assert.match(
    block,
    /story\.publish_error\s*=/,
    "content-QA fail block must set story.publish_error",
  );
  assert.match(
    block,
    /await\s+db\.upsertStory\(story\)/,
    "content-QA fail block must persist via db.upsertStory before return",
  );
  // Ensure the upsertStory call is BEFORE the return (not after).
  const returnIdx = block.indexOf("return {");
  const upsertIdx = block.indexOf("db.upsertStory(story)");
  assert.ok(
    upsertIdx > 0 && upsertIdx < returnIdx,
    "db.upsertStory must precede the return statement",
  );
});

test("publisher.js: video-QA fail branch persists qa_failed + publish_status=failed BEFORE returning", () => {
  const idx = SRC.indexOf("video QA FAIL — refusing to publish");
  assert.ok(
    idx > 0,
    "video QA fail log line must exist as an anchor for this test",
  );
  const block = SRC.slice(idx, idx + 2500);
  assert.match(
    block,
    /story\.qa_failed\s*=\s*true/,
    "video-QA fail block must set story.qa_failed = true",
  );
  assert.match(
    block,
    /story\.publish_status\s*=\s*["']failed["']/,
    "video-QA fail block must set story.publish_status = 'failed'",
  );
  assert.match(
    block,
    /await\s+db\.upsertStory\(story\)/,
    "video-QA fail block must persist via db.upsertStory before return",
  );
  const returnIdx = block.indexOf("return {");
  const upsertIdx = block.indexOf("db.upsertStory(story)");
  assert.ok(
    upsertIdx > 0 && upsertIdx < returnIdx,
    "video-QA fail: db.upsertStory must precede the return statement",
  );
});

test("publisher.js: publishNextStory selector skips qa_failed and publish_status=failed", () => {
  // Locate the selector block. Anchor on the specific comment we
  // added for the fix so we're matching the right filter.
  const selectorIdx = SRC.indexOf(
    "Find stories that still need publishing to at least one platform",
  );
  assert.ok(selectorIdx > 0, "selector anchor comment must exist");
  const block = SRC.slice(selectorIdx, selectorIdx + 3000);
  assert.match(
    block,
    /if\s*\(\s*s\.qa_failed\s*===\s*true\s*\)\s*return\s+false/,
    "selector must skip stories with qa_failed === true",
  );
  assert.match(
    block,
    /if\s*\(\s*s\.publish_status\s*===\s*["']failed["']\s*\)\s*return\s+false/,
    "selector must skip stories with publish_status === 'failed'",
  );
});

// ---------- integration: publishNextStory end-to-end ----------

const PUBLISHER_RESOLVED = require.resolve("../../publisher.js");
const DB_RESOLVED = require.resolve("../../lib/db.js");
const CQA_RESOLVED = require.resolve("../../lib/services/content-qa.js");
const VQA_RESOLVED = require.resolve("../../lib/services/video-qa.js");
const NOTIFY_RESOLVED = require.resolve("../../notify.js");
const SENTRY_RESOLVED = require.resolve("../../lib/sentry.js");
const PUBLISH_BLOCK_RESOLVED =
  require.resolve("../../lib/services/publish-block.js");

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

function clearPublisherCache() {
  // Only drop publisher itself. The stubbed modules we install below
  // live in require.cache and are picked up by publisher's top-level
  // requires on the next load — if we delete them here we'd lose the
  // stubs.
  delete require.cache[PUBLISHER_RESOLVED];
}

let dbState;
let uploaderCalls;

function setupMocks({ cqaResult, vqaResult, stories }) {
  dbState = {
    stories: stories.slice(),
    upsertCalls: [],
  };
  uploaderCalls = [];

  // Stub notify + sentry so require('./notify') / require('./lib/sentry')
  // at the top of publisher.js doesn't try to hit Discord.
  stubModule(NOTIFY_RESOLVED, async () => {});
  stubModule(SENTRY_RESOLVED, {
    addBreadcrumb: () => {},
    captureException: () => {},
  });

  stubModule(DB_RESOLVED, {
    async getStories() {
      return dbState.stories.slice();
    },
    async upsertStory(story) {
      dbState.upsertCalls.push({ ...story });
      const idx = dbState.stories.findIndex((s) => s.id === story.id);
      if (idx >= 0) dbState.stories[idx] = { ...story };
      else dbState.stories.push({ ...story });
    },
    async saveStories(arr) {
      dbState.stories = arr.slice();
    },
  });

  stubModule(CQA_RESOLVED, {
    async runContentQa() {
      return cqaResult;
    },
  });
  stubModule(VQA_RESOLVED, {
    async runVideoQa() {
      return vqaResult;
    },
  });

  // Stub publish-block so the SQLite-gated require doesn't throw.
  stubModule(PUBLISH_BLOCK_RESOLVED, {
    recordPlatformBlock: () => ({ persisted: false }),
    getPlatformStatus: () => null,
  });

  // Track uploader calls — if QA-fail works, none of these should
  // ever get invoked. We intercept via require.cache of the module
  // paths the publisher imports lazily inside the function body.
  for (const name of [
    "upload_youtube",
    "upload_tiktok",
    "upload_instagram",
    "upload_facebook",
    "upload_twitter",
  ]) {
    const resolved = require.resolve(`../../${name}.js`);
    stubModule(resolved, {
      async uploadShort() {
        uploaderCalls.push(name);
        return { videoId: "should_not_be_called", url: "x" };
      },
      async uploadAll() {
        uploaderCalls.push(name);
        return [];
      },
      async uploadReelViaUrl() {
        uploaderCalls.push(name);
        return { videoId: "x" };
      },
      async uploadStoryImage() {
        uploaderCalls.push(name);
        return { mediaId: "x", storyId: "x" };
      },
      async postImageTweet() {
        uploaderCalls.push(name);
        return { tweetId: "x" };
      },
    });
  }

  clearPublisherCache();
  return require("../../publisher.js");
}

beforeEach(() => {
  delete process.env.USE_SQLITE;
  delete process.env.USE_CANONICAL_DEDUPE;
});

afterEach(() => {
  clearPublisherCache();
});

test("publishNextStory: content-QA fail persists qa_failed=true + publish_status=failed + publish_error", async () => {
  const story = {
    id: "rss_qa_fail_content",
    title: "Broken content story",
    approved: true,
    exported_path: "/tmp/broken.mp4",
    full_script: "too short", // any content — QA stub decides
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["script_too_short (12 words, min 80)"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  // Return value carries the QA-fail fingerprint.
  assert.strictEqual(result.qa_failed, true);
  assert.deepStrictEqual(result.qa_failures, [
    "script_too_short (12 words, min 80)",
  ]);

  // State was persisted via db.upsertStory at least once.
  assert.ok(
    dbState.upsertCalls.length >= 1,
    "db.upsertStory must be called on QA fail",
  );
  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.strictEqual(
    persisted.qa_failed,
    true,
    "persisted qa_failed must be true",
  );
  assert.strictEqual(
    persisted.publish_status,
    "failed",
    "persisted publish_status must be 'failed'",
  );
  assert.match(
    persisted.publish_error || "",
    /^qa_blocked:/,
    "persisted publish_error must start with 'qa_blocked:'",
  );
  assert.ok(persisted.qa_failed_at, "qa_failed_at timestamp must be set");
  assert.deepStrictEqual(persisted.qa_failures, [
    "script_too_short (12 words, min 80)",
  ]);

  // No uploader called — QA short-circuit must happen before
  // any platform attempt.
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    `no uploader should be called after content-QA fail, got: ${uploaderCalls.join(", ")}`,
  );
});

test("publishNextStory: video-QA fail persists qa_failed=true + publish_status=failed + no uploaders fire", async () => {
  const story = {
    id: "rss_qa_fail_video",
    title: "Broken video story",
    approved: true,
    exported_path: "/tmp/broken.mp4",
    full_script:
      "A fully-formed script that passes content-QA fine. It has plenty of words and no banned phrases. " +
      "The producer generated it correctly. It's the mp4 itself that turned out broken — long black " +
      "segment at the start, or duration way off. Video-QA catches that. " +
      "That's what this test is exercising. More filler to keep the word count up because the " +
      "content QA stub passes unconditionally here anyway.",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: {
      result: "fail",
      failures: ["long_black_segment: 4.2s"],
      warnings: [],
    },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.qa_failed, true);

  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.strictEqual(persisted.qa_failed, true);
  assert.strictEqual(persisted.publish_status, "failed");
  assert.match(persisted.publish_error || "", /^qa_blocked:/);
  assert.deepStrictEqual(persisted.qa_failures, ["long_black_segment: 4.2s"]);
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    `no uploader should be called after video-QA fail, got: ${uploaderCalls.join(", ")}`,
  );
});

test("publishNextStory: QA-failed story is NOT re-selected on subsequent calls (deadlock fixed)", async () => {
  // Two stories approved. The first one fails QA. On second call,
  // the selector must skip it and pick the second.
  const bad = {
    id: "rss_broken",
    title: "Broken",
    approved: true,
    exported_path: "/tmp/a.mp4",
  };
  const good = {
    id: "rss_good",
    title: "Good",
    approved: true,
    exported_path: "/tmp/b.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "fail", failures: ["script_missing"], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [bad, good],
  });

  // First call: picks bad, QA-fails it, persists qa_failed=true.
  await publishNextStory();

  // Mutate the CQA stub to PASS for the retry so we can prove the
  // selector picked `good` — but in reality, the bad story should
  // be filtered out before it reaches the QA stub at all.
  // We do this by re-stubbing content-qa and clearing the publisher
  // cache. For simplicity, just assert bad is now qa_failed=true
  // and was NOT the second pick.
  const badRow = dbState.stories.find((s) => s.id === "rss_broken");
  assert.strictEqual(badRow.qa_failed, true);
  assert.strictEqual(badRow.publish_status, "failed");

  // Second call — the QA stub still returns fail (same setup).
  // If the selector were broken, it would pick bad again and
  // try to QA-fail it a second time (idempotent but wrong). Here
  // we pass a fresh content-qa that would fail, yet the selector
  // has to skip the bad row entirely and land on `good` — which
  // would then ALSO fail QA (both stubs return fail), but the
  // important invariant is that both stories end up qa_failed,
  // proving the selector advanced past bad.
  await publishNextStory();

  const goodRow = dbState.stories.find((s) => s.id === "rss_good");
  assert.strictEqual(
    goodRow.qa_failed,
    true,
    "second call should have selected `good` (not the already-failed `bad`)",
  );
});

test("publishNextStory: selector skips publish_status='failed' stories (all-core upload-fail case)", async () => {
  // Pre-failed story shouldn't be re-selected. This covers the
  // case where prior publish attempted all 4 core platforms and
  // they all failed — publish_status got set to "failed" and we
  // must not come back for another round.
  const failed = {
    id: "rss_upload_fail",
    title: "All uploads failed",
    approved: true,
    exported_path: "/tmp/x.mp4",
    publish_status: "failed",
    publish_error: "prior: all 4 core uploads failed",
  };
  const fresh = {
    id: "rss_fresh",
    title: "Fresh candidate",
    approved: true,
    exported_path: "/tmp/y.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "fail", failures: ["script_missing"], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [failed, fresh],
  });

  await publishNextStory();

  // Only fresh should have been touched — failed was pre-filtered.
  assert.ok(
    dbState.upsertCalls.find((c) => c.id === "rss_fresh"),
    "fresh story should have been selected and QA-failed",
  );
  assert.strictEqual(
    dbState.upsertCalls.find((c) => c.id === "rss_upload_fail"),
    undefined,
    "pre-failed story must NOT be selected",
  );
});

// Pure replica of the publishNextStory selector filter. Intentionally
// mirrors the live code — if publisher.js drifts, these branches
// will stop matching reality and the source-scan pin above will
// flag it. Keeping this replica lets us test the filter exhaustively
// without having to boot the whole publish pipeline (which fans out
// into engagement / blog / discord network paths even on retries).
function selectorFilter(s) {
  if (!s.approved || !s.exported_path) return false;
  if (s.qa_failed === true) return false;
  if (s.publish_status === "failed") return false;
  const platformsDone = [
    s.youtube_post_id,
    s.tiktok_post_id,
    s.instagram_media_id,
    s.facebook_post_id,
    s.twitter_post_id,
  ].filter(Boolean).length;
  return platformsDone < 5;
}

test("selector: partial stories remain eligible for retry (regression pin)", () => {
  // publish_status="partial" must NOT be filtered — only "failed"
  // is. This keeps the normal retry loop working for stories where
  // e.g. TikTok was flaky but the other 3 core platforms succeeded.
  const partial = {
    approved: true,
    exported_path: "/tmp/p.mp4",
    publish_status: "partial",
    youtube_post_id: "yt_real",
    instagram_media_id: "ig_real",
    tiktok_post_id: null,
    facebook_post_id: null,
  };
  assert.strictEqual(
    selectorFilter(partial),
    true,
    "partial story must be eligible — selector over-filtering regression",
  );
});

test("selector: fully-published story is skipped (platformsDone === 5)", () => {
  const fullyDone = {
    approved: true,
    exported_path: "/tmp/x.mp4",
    publish_status: "published",
    youtube_post_id: "yt",
    tiktok_post_id: "tt",
    instagram_media_id: "ig",
    facebook_post_id: "fb",
    twitter_post_id: "tw",
  };
  assert.strictEqual(selectorFilter(fullyDone), false);
});

test("publishNextStory: QA-fail return shape includes publish_status='failed' for callers", async () => {
  // The scheduled job handler inspects the result shape. Make
  // sure publish_status="failed" is in the returned object as
  // well, not just persisted — that way job summaries can render
  // "QA blocked" rather than a bland "skipped".
  const story = {
    id: "rss_shape",
    title: "Return shape",
    approved: true,
    exported_path: "/tmp/x.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["script_missing"],
      warnings: ["minor"],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.qa_failed, true);
  assert.strictEqual(result.publish_status, "failed");
  assert.deepStrictEqual(result.qa_failures, ["script_missing"]);
});
