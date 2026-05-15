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
const RUN_PATH = path.join(__dirname, "..", "..", "run.js");
const RUN_SRC = fs.readFileSync(RUN_PATH, "utf8");
let previousPublishCadenceWarnOnly;

// ---------- source-scan pins ----------

test("publisher.js: persistQaFail helper writes qa_failed + publish_status=failed and awaits upsertStory", () => {
  // Refactored 2026-04-22 into a reusable helper so the multi-
  // candidate loop can persist every QA-failing candidate it
  // walks past, not just the first one.
  const idx = SRC.indexOf("async function persistQaFail(");
  assert.ok(idx > 0, "persistQaFail helper must exist");
  const block = SRC.slice(idx, idx + 2500);
  assert.match(
    block,
    /story\.qa_failed\s*=\s*true/,
    "persistQaFail must set story.qa_failed = true",
  );
  assert.match(
    block,
    /story\.publish_status\s*=\s*["']failed["']/,
    "persistQaFail must set story.publish_status = 'failed'",
  );
  assert.match(
    block,
    /story\.publish_error\s*=/,
    "persistQaFail must set story.publish_error",
  );
  assert.match(
    block,
    /await\s+db\.upsertStory\(story\)/,
    "persistQaFail must call db.upsertStory",
  );
});

test("publisher.js: Discord markers are persisted immediately after successful sends", () => {
  assert.match(
    SRC,
    /markVideoDropPosted\(story\);\s*await\s+db\.upsertStory\(story\);/,
    "video-drop marker must be persisted before any later publisher work can crash",
  );
  assert.match(
    SRC,
    /markStoryPollPosted\(story\);\s*await\s+db\.upsertStory\(story\);/,
    "story-poll marker must be persisted before any later publisher work can crash",
  );
});

test("publisher.js: runPreflightQa runs content-QA then video-QA and returns structured pass/fail", () => {
  const idx = SRC.indexOf("async function runPreflightQa(");
  assert.ok(idx > 0, "runPreflightQa helper must exist");
  const block = SRC.slice(idx, idx + 5500);
  assert.match(block, /runContentQa/, "runPreflightQa must call content-QA");
  assert.match(block, /runVideoQa/, "runPreflightQa must call video-QA");
  assert.match(
    block,
    /runPlatformVideoQa/,
    "runPreflightQa must call platform-video-QA",
  );
  assert.match(
    block,
    /source:\s*["']content["']/,
    "content-QA fail result must tag source: 'content'",
  );
  assert.match(
    block,
    /source:\s*["']video["']/,
    "video-QA fail result must tag source: 'video'",
  );
  assert.match(
    block,
    /source:\s*["']platform_video["']/,
    "platform-video-QA fail result must tag source: 'platform_video'",
  );
});

test("publisher.js: legacy batch publish delegates to canonical publishNextStory before raw uploadAll calls", () => {
  const idx = SRC.indexOf("async function publishToAllPlatforms");
  assert.ok(idx > 0, "publishToAllPlatforms must exist");
  const block = SRC.slice(idx, idx + 5000);
  const delegateIdx = block.indexOf("await publishNextStory");
  const returnIdx = block.indexOf("return {");
  const rawBatchIdx = block.indexOf("uploadAll");
  assert.ok(delegateIdx > 0, "legacy publish must delegate to publishNextStory()");
  assert.ok(returnIdx > delegateIdx, "legacy publish must return the canonical summary");
  assert.ok(
    rawBatchIdx === -1 || rawBatchIdx > returnIdx,
    "raw uploadAll batch calls must be unreachable behind the canonical return",
  );
});

test("publisher.js: retry QA bypass cannot bypass strict approved-voice mode", () => {
  const idx = SRC.indexOf("process.env.PUBLISH_RETRY_QA_BYPASS");
  assert.ok(idx > 0, "retry bypass branch must exist");
  const block = SRC.slice(idx - 800, idx + 1200);
  assert.match(block, /strictVoiceQa/, "retry bypass branch must calculate strict voice QA");
  assert.match(block, /!strictVoiceQa/, "retry bypass must be disabled when strict voice QA is active");
});

test("publisher.js: publishNextStory selector skips qa_failed and publish_status=failed", () => {
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
  assert.match(
    block,
    /if\s*\(\s*storyIsStaleUnpublishedBacklog\(s\)\s*\)\s*return\s+false/,
    "selector must skip stale never-published backlog rows by default",
  );
  assert.match(
    SRC,
    /env\.ALLOW_STALE_BACKLOG_PUBLISH\s*===\s*["']true["']/,
    "stale backlog guard must have an explicit operator override",
  );
  assert.match(
    SRC,
    /if\s*\(\s*storyIsRetry\(s\)\s*\)\s*return\s+false/,
    "stale backlog guard must not block partial publish retries",
  );
});

test("publisher.js: optional PUBLISH_STORY_IDS pins the selector without changing default behaviour", () => {
  const publisher = require("../../publisher.js");
  const priv = publisher._private;

  assert.deepEqual(priv.parsePublishStoryIds({}), []);
  assert.deepEqual(
    priv.parsePublishStoryIds({ PUBLISH_STORY_IDS: " 1tbdx3b, rss_123 ,, " }),
    ["1tbdx3b", "rss_123"],
  );
  assert.equal(priv.storyMatchesPublishStoryIds({ id: "any" }, {}), true);
  assert.equal(
    priv.storyMatchesPublishStoryIds(
      { id: "1tbdx3b" },
      { PUBLISH_STORY_IDS: "1tbdx3b" },
    ),
    true,
  );
  assert.equal(
    priv.storyMatchesPublishStoryIds(
      { id: "other" },
      { PUBLISH_STORY_IDS: "1tbdx3b" },
    ),
    false,
  );
});

test("publisher.js: publish selector ranking follows analytics-aware next-candidate score", () => {
  const publisher = require("../../publisher.js");
  const priv = publisher._private;
  const analyticsText =
    "Tomorrow: Front corporate drama with named antagonists and concrete outcomes.";
  const corporate = {
    id: "corporate",
    title: "Xbox boss Asha Sharma confirms Discord partnership after Game Pass price cut",
    approved: true,
    auto_approved: true,
    exported_path: "output/final/corporate.mp4",
    duration_seconds: 68,
    breaking_score: 70,
    score: 70,
  };
  const generic = {
    id: "generic",
    title: "New trailer shows another vague update that could arrive later",
    approved: true,
    auto_approved: true,
    exported_path: "output/final/generic.mp4",
    duration_seconds: 68,
    breaking_score: 95,
    score: 95,
  };

  const ranked = priv.sortPublishReadyStories([generic, corporate], {
    analyticsText,
  });

  assert.equal(ranked[0].id, "corporate");
  assert.ok(
    priv.scorePublishSelectionStory(corporate, analyticsText) >
      priv.scorePublishSelectionStory(generic, analyticsText),
  );
});

test("publisher.js: Instagram Story fallback uses the exported pending-timeout classifier safely", () => {
  const storyFallbackIdx = SRC.indexOf("Instagram Stories (static card");
  assert.ok(storyFallbackIdx > 0, "Instagram Story fallback block must exist");
  const block = SRC.slice(storyFallbackIdx, storyFallbackIdx + 2200);
  assert.match(
    block,
    /isInstagramPendingProcessingTimeout/,
    "fallback block must import the existing upload_instagram timeout classifier",
  );
  assert.match(
    block,
    /typeof\s+isInstagramPendingProcessingTimeoutForStory\s*===\s*["']function["']/,
    "fallback error classification must guard the imported helper before calling it",
  );
  assert.match(
    block,
    /isInstagramPendingProcessingTimeoutForStory\(err\)\s*\?\s*["']accepted_processing["']\s*:\s*["']failed["']/,
    "fallback pending-processing errors must be non-fatal and classified as accepted_processing",
  );
});

test("publisher.js: core publish status is persisted before lower-reach fallback cards", () => {
  const statusIdx = SRC.indexOf("Set publish_status from CORE video-platform outcomes only");
  const fallbackIdx = SRC.indexOf("Story card image distribution");
  assert.ok(statusIdx > 0, "core publish status block must exist");
  assert.ok(fallbackIdx > statusIdx, "fallback card block must follow core status calculation");
  const between = SRC.slice(statusIdx, fallbackIdx);
  assert.match(
    between,
    /coreDone\s*>=\s*coreTotal[\s\S]*story\.publish_status\s*=\s*["']published["']/,
    "core status block must calculate published/partial/failed before fallback work",
  );
  assert.match(
    between,
    /await\s+db\.upsertStory\(story\)/,
    "core publish state must be upserted before any fallback card uploads can throw",
  );
});

test("run.js: publish accepts --story-id/--story and passes storyId without bypassing publish gates", () => {
  assert.match(
    RUN_SRC,
    /function\s+parsePublishStoryIdArg/,
    "run.js should parse targeted publish arguments explicitly",
  );
  assert.match(
    RUN_SRC,
    /--story-id/,
    "run.js publish usage should expose --story-id",
  );
  assert.match(
    RUN_SRC,
    /--story/,
    "run.js publish usage should expose --story",
  );
  assert.match(
    RUN_SRC,
    /process\.env\.PUBLISH_STORY_IDS\s*=\s*storyId/,
    "targeted publish should set the existing PUBLISH_STORY_IDS selector for the current process",
  );
  assert.match(
    RUN_SRC,
    /publishToAllPlatforms\(\{\s*dispatchSource:\s*["']cli_publish["'][\s\S]*storyId/,
    "run.js must pass storyId into the canonical publisher path",
  );
  assert.doesNotMatch(
    RUN_SRC,
    /allowManualOverride:\s*true/,
    "targeted publish must not opt into manual cadence/window overrides",
  );
});

test("publisher.js: duplicate published-story gate runs before upload", () => {
  const idx = SRC.indexOf("findPublishedTitleDuplicate(candidate, stories)");
  assert.ok(idx > 0, "published duplicate gate must exist in candidate loop");
  const block = SRC.slice(idx, idx + 1200);
  assert.match(
    block,
    /published_duplicate_story:/,
    "duplicate gate must persist a clear publish_error reason",
  );
  assert.match(
    block,
    /continue;/,
    "duplicate gate must skip to the next candidate without uploading",
  );
});

test("publisher.js: multi-candidate loop uses MAX_PUBLISH_CANDIDATES_PER_WINDOW cap and persists failures via persistQaFail", () => {
  // Anchor on the constant declaration to make sure it exists with
  // a concrete number (not inferred). 3 ≤ cap ≤ 10 is a sanity
  // bound — anything smaller and a small backlog of stale stories
  // exhausts the window, anything larger and a truly broken batch
  // could burn the publish window on 20+ QA checks.
  const m = SRC.match(/const\s+MAX_PUBLISH_CANDIDATES_PER_WINDOW\s*=\s*(\d+)/);
  assert.ok(m, "MAX_PUBLISH_CANDIDATES_PER_WINDOW constant must exist");
  const cap = parseInt(m[1], 10);
  assert.ok(cap >= 3 && cap <= 10, `cap out of sensible range: ${cap}`);

  // And the main loop must pull its slice from that constant.
  assert.match(
    SRC,
    /sortedReady\.slice\(0,\s*MAX_PUBLISH_CANDIDATES_PER_WINDOW\)/,
    "multi-candidate loop must slice the ready list with the cap constant",
  );
  // No-safe-candidate return shape must include the fields the
  // Discord summary consumes.
  assert.match(SRC, /no_safe_candidate:\s*true/);
  assert.match(SRC, /qa_skipped_count:/);
  assert.match(SRC, /top_reason:/);
  assert.match(SRC, /candidates_tried:/);
});

// ---------- integration: publishNextStory end-to-end ----------

const PUBLISHER_RESOLVED = require.resolve("../../publisher.js");
const DB_RESOLVED = require.resolve("../../lib/db.js");
const CQA_RESOLVED = require.resolve("../../lib/services/content-qa.js");
const VQA_RESOLVED = require.resolve("../../lib/services/video-qa.js");
const PVQA_RESOLVED = require.resolve("../../lib/services/platform-video-qa.js");
const NOTIFY_RESOLVED = require.resolve("../../notify.js");
const SENTRY_RESOLVED = require.resolve("../../lib/sentry.js");
const PUBLISH_BLOCK_RESOLVED =
  require.resolve("../../lib/services/publish-block.js");
const ENGAGEMENT_RESOLVED = require.resolve("../../engagement.js");
const BLOG_RESOLVED = require.resolve("../../blog/generator.js");
const DISCORD_AUTO_POST_RESOLVED =
  require.resolve("../../discord/auto_post.js");
const DISCORD_POST_GATE_RESOLVED =
  require.resolve("../../lib/services/discord-post-gate.js");

function stubModule(resolvedPath, exports) {
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

// Neutralise every downstream module publisher.js loads AFTER a
// successful upload — engagement, blog, discord. Without these
// stubs: engageFirstHour schedules a 5-min setTimeout that keeps
// the Node event loop alive past test completion; Discord post-
// gate + auto-post open real webhook connections; blog generator
// writes files. Tests that go through a successful-publish path
// would otherwise run to the 60s file-level timeout.
function stubDownstreamPublisherDeps() {
  stubModule(ENGAGEMENT_RESOLVED, {
    async engageFirstHour() {},
    async engageRecent() {},
    async generatePollComment() {
      return null;
    },
    async pinComment() {
      return null;
    },
  });
  stubModule(BLOG_RESOLVED, {
    async generateAndSaveBlogPost() {},
  });
  stubModule(DISCORD_AUTO_POST_RESOLVED, {
    async postVideoUpload() {
      return null;
    },
    async postStoryPoll() {
      return null;
    },
  });
  stubModule(DISCORD_POST_GATE_RESOLVED, {
    shouldPostVideoDrop: () => false,
    shouldPostStoryPoll: () => false,
    markVideoDropPosted: () => {},
    markStoryPollPosted: () => {},
  });
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

function setupMocks({
  cqaResult,
  vqaResult,
  pvqaResult = { result: "pass", failures: [], warnings: [] },
  stories,
}) {
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
  stubModule(PVQA_RESOLVED, {
    async runPlatformVideoQa() {
      return pvqaResult;
    },
  });

  // Stub publish-block so the SQLite-gated require doesn't throw.
  stubModule(PUBLISH_BLOCK_RESOLVED, {
    recordPlatformBlock: () => ({ persisted: false }),
    getPlatformStatus: () => null,
  });

  stubDownstreamPublisherDeps();

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

// Variant of setupMocks where content-QA returns a per-story result
// keyed by story.id. Used by multi-candidate tests that need "bad
// story fails QA, next story passes" behaviour in a single test run.
function setupMocksPerStory({
  perStoryCqa,
  vqaResult,
  pvqaResult = { result: "pass", failures: [], warnings: [] },
  stories,
}) {
  dbState = {
    stories: stories.slice(),
    upsertCalls: [],
  };
  uploaderCalls = [];

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
    async runContentQa(story) {
      return (
        perStoryCqa[story.id] || {
          result: "pass",
          failures: [],
          warnings: [],
        }
      );
    },
  });
  stubModule(VQA_RESOLVED, {
    async runVideoQa() {
      return vqaResult;
    },
  });
  stubModule(PVQA_RESOLVED, {
    async runPlatformVideoQa() {
      return pvqaResult;
    },
  });
  stubModule(PUBLISH_BLOCK_RESOLVED, {
    recordPlatformBlock: () => ({ persisted: false }),
    getPlatformStatus: () => null,
  });

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
  previousPublishCadenceWarnOnly = process.env.PUBLISH_CADENCE_WARN_ONLY;
  process.env.PUBLISH_CADENCE_WARN_ONLY = "true";
  delete process.env.USE_SQLITE;
  delete process.env.USE_CANONICAL_DEDUPE;
});

afterEach(() => {
  if (previousPublishCadenceWarnOnly === undefined) {
    delete process.env.PUBLISH_CADENCE_WARN_ONLY;
  } else {
    process.env.PUBLISH_CADENCE_WARN_ONLY = previousPublishCadenceWarnOnly;
  }
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

  // Single-candidate QA fail now returns the multi-candidate
  // "no safe candidate" shape (qa_skipped_count=1) because the
  // publisher exhausted its cap without finding a clean story.
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.strictEqual(result.candidates_tried, 1);
  assert.match(result.top_reason, /^content_qa:/);
  assert.strictEqual(result.qa_skipped.length, 1);
  assert.strictEqual(result.qa_skipped[0].source, "content");

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
  assert.strictEqual(result.no_safe_candidate, true);
  assert.match(result.top_reason, /^video_qa:/);
  assert.strictEqual(result.qa_skipped[0].source, "video");

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

test("publishNextStory: platform-video-QA fail persists before any uploader fires", async () => {
  const story = {
    id: "rss_qa_fail_platform_video",
    title: "Bad MP4 metadata",
    approved: true,
    exported_path: "/tmp/bad-meta.mp4",
    full_script:
      "A healthy script and duration should still be refused if the MP4 stream metadata is not safe for social platforms. " +
      "This protects Meta uploads from old chroma or profile renders that would otherwise fail only after the platform accepts the file.",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    pvqaResult: {
      result: "fail",
      failures: ["video_pixel_format_not_yuv420p (yuv444p)"],
      warnings: [],
    },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.match(result.top_reason, /^platform_video_qa:/);
  assert.strictEqual(result.qa_skipped[0].source, "platform_video");

  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.strictEqual(persisted.qa_failed, true);
  assert.strictEqual(persisted.publish_status, "failed");
  assert.deepStrictEqual(persisted.qa_failures, [
    "video_pixel_format_not_yuv420p (yuv444p)",
  ]);
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    `no uploader should be called after platform-video-QA fail, got: ${uploaderCalls.join(", ")}`,
  );
});

// ---------- multi-candidate fallback tests (2026-04-22) ----------
//
// Drive the publisher with a list of stubbed candidates where the
// first N fail QA and one later candidate passes. Asserts:
//   - earlier candidates are persisted qa_failed=true
//   - only one upload happens (the passing candidate's)
//   - result.qa_skipped_count reports how many were walked past
//   - the cap stops the loop after MAX candidates even if more
//     bad stories remain

test("multi-candidate: first QA-fails, second passes — second uploads, qa_skipped_count=1", async () => {
  const bad = {
    id: "rss_bad",
    title: "Xbox boss confirms Discord partnership after Game Pass price cut",
    approved: true,
    exported_path: "/tmp/bad.mp4",
    breaking_score: 100,
  };
  const good = {
    id: "rss_good",
    title: "Healthy fallback mp4",
    approved: true,
    exported_path: "/tmp/good.mp4",
    breaking_score: 1,
  };
  // Stub content-QA: fail for `bad.id`, pass for `good.id`.
  const { publishNextStory } = setupMocksPerStory({
    perStoryCqa: {
      rss_bad: {
        result: "fail",
        failures: ["exported_mp4_not_on_disk"],
        warnings: [],
      },
      rss_good: { result: "pass", failures: [], warnings: [] },
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [bad, good],
  });

  const result = await publishNextStory();

  // Bad story got persisted qa_failed=true
  const badRow = dbState.stories.find((s) => s.id === "rss_bad");
  assert.strictEqual(badRow.qa_failed, true);
  assert.strictEqual(badRow.publish_status, "failed");

  // Good story got published — result has the normal success shape
  assert.strictEqual(result.no_safe_candidate, undefined);
  assert.strictEqual(result.title, "Healthy fallback mp4");
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.ok(result.qa_skipped && result.qa_skipped.length === 1);
  assert.strictEqual(result.qa_skipped[0].id, "rss_bad");

  // Uploader WAS called (for the good story) — at least one core
  // platform was attempted.
  assert.ok(
    uploaderCalls.length > 0,
    "expected uploader calls for the passing candidate",
  );
});

test("multi-candidate: 3 QA-fail candidates are all marked failed, no uploads", async () => {
  const stories = [
    {
      id: "rss_a",
      title: "A",
      approved: true,
      exported_path: "/tmp/a.mp4",
    },
    {
      id: "rss_b",
      title: "B",
      approved: true,
      exported_path: "/tmp/b.mp4",
    },
    {
      id: "rss_c",
      title: "C",
      approved: true,
      exported_path: "/tmp/c.mp4",
    },
  ];
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["exported_mp4_not_on_disk"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories,
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 3);
  assert.strictEqual(result.candidates_tried, 3);

  // Every story is now qa_failed=true
  for (const id of ["rss_a", "rss_b", "rss_c"]) {
    const row = dbState.stories.find((s) => s.id === id);
    assert.strictEqual(
      row.qa_failed,
      true,
      `${id} must be persisted qa_failed=true`,
    );
    assert.strictEqual(row.publish_status, "failed");
  }
  assert.deepStrictEqual(
    uploaderCalls,
    [],
    "no uploader should fire when all candidates fail QA",
  );
});

test("multi-candidate: cap stops the loop at MAX (5) even if more candidates exist", async () => {
  // 7 candidates all fail — only the first 5 should be tried.
  const stories = Array.from({ length: 7 }, (_, i) => ({
    id: `rss_cap_${i}`,
    title: `Cap ${i}`,
    approved: true,
    exported_path: `/tmp/c${i}.mp4`,
  }));
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["script_missing"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories,
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(
    result.candidates_tried,
    5,
    "cap must limit the walk to 5",
  );
  assert.strictEqual(result.qa_skipped_count, 5);

  // The 6th and 7th stories were never touched — still not qa_failed.
  const unSeen6 = dbState.stories.find((s) => s.id === "rss_cap_5");
  const unSeen7 = dbState.stories.find((s) => s.id === "rss_cap_6");
  assert.notStrictEqual(unSeen6.qa_failed, true);
  assert.notStrictEqual(unSeen7.qa_failed, true);
});

test("multi-candidate: partial retry candidate still runs QA before missing-platform uploads", async () => {
  // Partial retry: YouTube already done, others missing. It still
  // needs current QA because local cutover must not reuse stale or
  // bad-voice artefacts just because one platform succeeded earlier.
  const partial = {
    id: "rss_partial_retry",
    title: "Retry me",
    approved: true,
    exported_path: "/tmp/p.mp4",
    publish_status: "partial",
    youtube_post_id: "yt_real",
    tiktok_post_id: null,
    instagram_media_id: null,
    facebook_post_id: null,
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["approved_voice:metadata_missing"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [partial],
  });

  const result = await publishNextStory();
  // Treated as no-safe-candidate because the retry candidate failed fresh QA.
  assert.strictEqual(result.no_safe_candidate, true);
  assert.deepStrictEqual(uploaderCalls, [], "retry must not invoke uploaders on QA fail");

  // The partial story is persisted as failed so the scheduler does not keep retrying it.
  const row = dbState.stories.find((s) => s.id === "rss_partial_retry");
  assert.strictEqual(row.qa_failed, true);
  assert.strictEqual(row.publish_status, "failed");
  assert.match(row.publish_error, /approved_voice:metadata_missing/);
});

test("multi-candidate: soft warnings on passing candidate do not block publish (classification audit)", async () => {
  // Content-QA returns result="warn" (warnings but zero hard-fails).
  // Publisher must treat this as pass and upload — the warnings
  // get attached to result.qa_warnings for the Discord summary.
  const story = {
    id: "rss_warnings",
    title: "Warn but ship",
    approved: true,
    exported_path: "/tmp/w.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "warn",
      failures: [],
      warnings: [
        "story_card_path_set_but_missing",
        "entity_overlay_coverage_low",
      ],
    },
    vqaResult: {
      result: "warn",
      failures: [],
      warnings: ["opening_black (0.8s)"],
    },
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, undefined);
  assert.ok(uploaderCalls.length > 0, "soft warnings must NOT block publish");
  // Warnings from both QA passes are preserved for summary rendering.
  assert.ok(Array.isArray(result.qa_warnings));
  assert.ok(result.qa_warnings.length >= 2);
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

  // First call with multi-candidate fallback: both bad AND good go
  // through QA in the SAME call because cqaResult is shared. Both
  // fail → both marked qa_failed → no_safe_candidate.
  const result = await publishNextStory();
  assert.strictEqual(result.no_safe_candidate, true);

  const badRow = dbState.stories.find((s) => s.id === "rss_broken");
  assert.strictEqual(
    badRow.qa_failed,
    true,
    "bad story should be persisted qa_failed=true",
  );
  assert.strictEqual(badRow.publish_status, "failed");

  const goodRow = dbState.stories.find((s) => s.id === "rss_good");
  assert.strictEqual(
    goodRow.qa_failed,
    true,
    "good story (with same failing QA stub) should also be qa_failed after multi-candidate walk",
  );

  // Deadlock invariant: a subsequent call must skip both (selector
  // filter on qa_failed === true).
  const result2 = await publishNextStory();
  assert.strictEqual(
    result2,
    null,
    "subsequent call must find NO eligible story (both are qa_failed)",
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
function selectorFilter(s, env = {}) {
  if (!s.approved || !s.exported_path) return false;
  if (s.qa_failed === true) return false;
  if (s.publish_status === "failed") return false;
  const tiktokDisabled = /^(false|0|no|off)$/i.test(
    String(env.TIKTOK_ENABLED || env.TIKTOK_AUTO_UPLOAD_ENABLED || "").trim(),
  );
  const coreIds = [
    s.youtube_post_id,
    s.instagram_media_id,
    s.facebook_post_id,
  ];
  if (!tiktokDisabled) coreIds.splice(1, 0, s.tiktok_post_id);
  const platformsDone = coreIds.filter(
    (id) => typeof id === "string" && id.length > 0 && !id.startsWith("DUPE_"),
  ).length;
  return platformsDone < coreIds.length;
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

test("selector: fully-published story is skipped", () => {
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

test("selector: local TikTok disabled treats YT/IG/FB done as complete", () => {
  const locallyDone = {
    approved: true,
    exported_path: "/tmp/x.mp4",
    publish_status: "published",
    youtube_post_id: "yt",
    tiktok_post_id: null,
    instagram_media_id: "ig",
    facebook_post_id: "fb",
  };
  assert.strictEqual(selectorFilter(locallyDone, { TIKTOK_ENABLED: "false" }), false);
});

test("publishNextStory: local TikTok disabled does not retry YT/IG/FB-complete story", async () => {
  const previous = process.env.TIKTOK_ENABLED;
  process.env.TIKTOK_ENABLED = "false";
  try {
    const story = {
      id: "rss_local_complete",
      title: "Local complete",
      approved: true,
      exported_path: "/tmp/local-complete.mp4",
      publish_status: "published",
      youtube_post_id: "yt",
      tiktok_post_id: null,
      instagram_media_id: "ig",
      facebook_post_id: "fb",
    };
    const { publishNextStory } = setupMocks({
      cqaResult: { result: "pass", failures: [], warnings: [] },
      vqaResult: { result: "pass", failures: [], warnings: [] },
      stories: [story],
    });

    const result = await publishNextStory();
    assert.strictEqual(result, null);
    assert.deepStrictEqual(uploaderCalls, []);
  } finally {
    if (previous === undefined) delete process.env.TIKTOK_ENABLED;
    else process.env.TIKTOK_ENABLED = previous;
  }
});

test("publishNextStory: near-duplicate already-published story is QA-blocked before upload", async () => {
  const published = {
    id: "dead-space-a",
    title:
      '"The Numbers Aren\'t There" for Dead Space 4 to Happen, Says Former Dead Space Writer and Producer',
    approved: true,
    exported_path: "/tmp/a.mp4",
    publish_status: "published",
    youtube_post_id: "yt_dead_space",
    instagram_media_id: "ig",
    facebook_post_id: "fb",
  };
  const duplicate = {
    id: "dead-space-b",
    title:
      "Dead Space 4 likely won’t happen despite a fervent fan base as it can't hit the numbers it needs, explains original producer",
    approved: true,
    exported_path: "/tmp/b.mp4",
  };
  const { publishNextStory, _private } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [published, duplicate],
  });

  assert.equal(_private.titlesNearDuplicate(published.title, duplicate.title), true);

  const result = await publishNextStory();
  assert.equal(result.no_safe_candidate, true);
  assert.equal(result.qa_skipped_count, 1);
  assert.match(result.top_reason, /published_duplicate_story:dead-space-a/);
  assert.deepStrictEqual(uploaderCalls, []);
  const persisted = dbState.upsertCalls[dbState.upsertCalls.length - 1];
  assert.equal(persisted.id, "dead-space-b");
  assert.equal(persisted.qa_failed, true);
  assert.match(persisted.publish_error, /published_duplicate_story:dead-space-a/);
});

test("publishNextStory: no-safe-candidate return shape carries top_reason + qa_skipped for callers", async () => {
  // The scheduled job handler / Discord renderer inspects this
  // shape. Pin the contract — if any of these fields are renamed,
  // the Discord summary will break.
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
  assert.strictEqual(result.no_safe_candidate, true);
  assert.strictEqual(result.qa_skipped_count, 1);
  assert.strictEqual(result.candidates_tried, 1);
  assert.match(result.top_reason, /^content_qa:\s*script_missing$/);
  assert.ok(Array.isArray(result.qa_skipped));
  assert.strictEqual(result.qa_skipped[0].id, "rss_shape");
  assert.strictEqual(result.qa_skipped[0].source, "content");
  assert.strictEqual(result.qa_skipped[0].reason, "script_missing");
});
