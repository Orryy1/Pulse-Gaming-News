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

test("publisher.js: publishNextStory selector skips qa_failed and publish_status=failed", () => {
  const selectorIdx = SRC.indexOf(
    "Stabilisation has one automated public target",
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
    /scheduledCandidates\.slice\(\s*0,\s*MAX_PUBLISH_CANDIDATES_PER_WINDOW/,
    "multi-candidate loop must apply the cap after governance scheduling",
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
const RENDER_DECISION_RESOLVED = require.resolve("../../lib/render-decision.js");
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
const PUBLISH_NOW = new Date("2026-07-27T09:05:00.000Z");

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
let governedDispatchCalls;

function withTestPublisherLease(publisher) {
  const liveGuardedEnv = {
    PULSE_OPERATING_MODE: "LIVE_GUARDED",
    AUTO_PUBLISH: "true",
    PULSE_GUARDED_LIVE_DISPATCH_ENABLED: "true",
    USE_JOB_QUEUE: "true",
    USE_SQLITE: "true",
    PULSE_PRIMARY_INSTANCE: "true",
    PULSE_EMERGENCY_KILL_SWITCH: "false",
  };
  const leases = {
    acquire({ name, ownerId, now, leaseMs, metadata }) {
      return {
        name,
        owner_id: ownerId,
        acquired_at: new Date(now).toISOString(),
        heartbeat_at: new Date(now).toISOString(),
        expires_at: new Date(new Date(now).getTime() + leaseMs).toISOString(),
        metadata: JSON.stringify(metadata),
        acquired: true,
      };
    },
    heartbeat() {
      return true;
    },
    release() {
      return true;
    },
  };
  const publicationRepos = {
    db: {},
    platformPosts: {},
    publicationGovernance: {
      getLatestLifecycleEvent(storyId, platform, toState) {
        assert.equal(platform, "youtube");
        assert.equal(toState, "SCHEDULED");
        return {
          story_id: storyId,
          platform,
          to_state: "SCHEDULED",
          evidence_json: JSON.stringify({
            dispatch_idempotency_key: `youtube:${storyId}:test-operation`,
            request_fingerprint: "a".repeat(64),
            scheduled_for: "2026-07-27T09:00:00.000Z",
          }),
        };
      },
    },
  };
  const governedDispatch = async (input) => {
    governedDispatchCalls.push(input);
    const uploadResult = await input.upload({
      markCreateAttemptStarted() {},
    });
    if (uploadResult?.blocked) {
      return {
        status: "blocked",
        blocked: true,
        reason: uploadResult.reason || "blocked",
      };
    }
    return {
      status: "published",
      published: true,
      externalId: uploadResult.externalId,
      externalUrl: uploadResult.externalUrl,
    };
  };
  return {
    ...publisher,
    publishNextStory(options = {}) {
      return publisher.publishNextStory({
        env: liveGuardedEnv,
        repos: publicationRepos,
        governedDispatch,
        async fingerprintPublicationRequest(story) {
          return {
            request_fingerprint:
              story.test_request_fingerprint || "a".repeat(64),
            media_sha256: "d".repeat(64),
            script_sha256: "e".repeat(64),
          };
        },
        now: PUBLISH_NOW,
        cadenceEvaluator: () => ({ allowed: true, reason: null }),
        verifyYoutubePublic: async () => {
          throw new Error("test governed dispatcher owns verification");
        },
        ...options,
        leases,
      });
    },
    publishToAllPlatforms(options = {}) {
      return publisher.publishToAllPlatforms({ ...options, leases });
    },
  };
}

function setupMocks({
  cqaResult,
  vqaResult,
  pvqaResult = { result: "pass", failures: [], warnings: [] },
  renderDecisionError = null,
  stories,
}) {
  dbState = {
    stories: stories.slice(),
    upsertCalls: [],
  };
  uploaderCalls = [];
  governedDispatchCalls = [];

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
      if (cqaResult instanceof Error) throw cqaResult;
      return cqaResult;
    },
  });
  stubModule(VQA_RESOLVED, {
    async runVideoQa() {
      if (vqaResult instanceof Error) throw vqaResult;
      return vqaResult;
    },
  });
  stubModule(PVQA_RESOLVED, {
    async runPlatformVideoQa() {
      if (pvqaResult instanceof Error) throw pvqaResult;
      return pvqaResult;
    },
  });
  if (renderDecisionError) {
    stubModule(RENDER_DECISION_RESOLVED, {
      async decideForStory() {
        throw renderDecisionError;
      },
    });
  } else {
    delete require.cache[RENDER_DECISION_RESOLVED];
  }

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
  return withTestPublisherLease(require("../../publisher.js"));
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
  governedDispatchCalls = [];
  delete require.cache[RENDER_DECISION_RESOLVED];

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
  return withTestPublisherLease(require("../../publisher.js"));
}

beforeEach(() => {
  delete process.env.USE_SQLITE;
  delete process.env.USE_CANONICAL_DEDUPE;
});

afterEach(() => {
  clearPublisherCache();
  delete require.cache[RENDER_DECISION_RESOLVED];
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

test("publishNextStory: LOCAL_PROOF fails closed before candidate selection or upload", async () => {
  const story = {
    id: "rss_local_proof_block",
    title: "Must not leave local proof",
    approved: true,
    exported_path: "/tmp/never-upload.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
      USE_JOB_QUEUE: "true",
      USE_SQLITE: "true",
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.top_reason, "live_guarded_mode_required");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: cadence is rechecked inside the durable publisher lease", async () => {
  const story = {
    id: "rss_cadence_block",
    title: "Must wait for the next guarded window",
    approved: true,
    exported_path: "/tmp/cadence-block.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    cadenceEvaluator: ({ excludeJobId }) => {
      assert.equal(excludeJobId, 73);
      return {
        allowed: false,
        reason: "stabilisation_minimum_publish_gap",
        recent_count: 1,
      };
    },
    currentJobId: 73,
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "stabilisation_minimum_publish_gap");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: stabilisation dispatch attempts YouTube only", async () => {
  const story = {
    id: "rss_youtube_only",
    title: "One controlled platform",
    approved: true,
    exported_path: "/tmp/youtube-only.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(
    governedDispatchCalls[0].idempotencyKey,
    "youtube:rss_youtube_only:test-operation",
  );
  assert.equal(governedDispatchCalls[0].requestFingerprint, "a".repeat(64));
  assert.equal(governedDispatchCalls[0].platform, "youtube");
  assert.equal(result.platform_outcomes.youtube, "new_upload");
  for (const platform of [
    "tiktok",
    "instagram",
    "facebook",
    "twitter",
    "facebook_card",
    "instagram_story",
    "twitter_image",
  ]) {
    assert.equal(
      result.platform_outcomes[platform],
      "operator_disabled",
      platform,
    );
  }
  const persisted = dbState.stories.find(
    (entry) => entry.id === story.id,
  );
  assert.equal(persisted.publish_status, "published");
  assert.ok(persisted.youtube_post_id);
  assert.equal(persisted.tiktok_post_id, undefined);
});

test("publishNextStory: changed content is blocked when its current fingerprint differs from admission", async () => {
  const story = {
    id: "rss_changed_after_admission",
    title: "Changed after the operator approved it",
    approved: true,
    exported_path: "/tmp/changed-after-admission.mp4",
    test_request_fingerprint: "f".repeat(64),
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory();

  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.equal(
    result.errors.youtube,
    "scheduled_request_fingerprint_mismatch",
  );
  assert.equal(
    result.platform_outcomes.youtube,
    "governance_blocked",
  );
});

test("publishNextStory: missing scheduled governance evidence blocks before uploader", async () => {
  const story = {
    id: "rss_unscheduled",
    title: "Not yet scheduled",
    approved: true,
    exported_path: "/tmp/unscheduled.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {
          return null;
        },
      },
    },
  });

  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.status, "blocked");
  assert.equal(result.top_reason, "scheduled_dispatch_evidence_required");
  assert.equal(result.governance_skipped_count, 1);
  assert.deepEqual(dbState.upsertCalls, []);
});

test("publishNextStory: an expired admission ticket cannot catch up in a later window", async () => {
  const story = {
    id: "rss_expired_schedule",
    title: "Missed window must remain held",
    approved: true,
    exported_path: "/tmp/expired-schedule.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    now: new Date("2026-07-27T19:00:00.000Z"),
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent() {
          return {
            id: 21,
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                "youtube:rss_expired_schedule:2026-07-27T09:00:00.000Z",
              request_fingerprint: "a".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
            }),
          };
        },
      },
    },
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "scheduled_dispatch_window_expired");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: skips an unscheduled high-score story and dispatches the scheduled candidate", async () => {
  const unscheduled = {
    id: "rss_unscheduled_first",
    title: "High score but not approved for this window",
    approved: true,
    breaking_score: 100,
    exported_path: "/tmp/unscheduled-first.mp4",
  };
  const scheduled = {
    id: "rss_scheduled_second",
    title: "Human-approved scheduled candidate",
    approved: true,
    breaking_score: 50,
    exported_path: "/tmp/scheduled-second.mp4",
    test_request_fingerprint: "b".repeat(64),
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [unscheduled, scheduled],
  });

  const result = await publishNextStory({
    repos: {
      db: {},
      platformPosts: {},
      publicationGovernance: {
        getLatestLifecycleEvent(storyId) {
          if (storyId !== scheduled.id) return null;
          return {
            id: 22,
            story_id: storyId,
            platform: "youtube",
            to_state: "SCHEDULED",
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                "youtube:rss_scheduled_second:test-operation",
              request_fingerprint: "b".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
            }),
          };
        },
      },
    },
  });

  assert.equal(result.title, scheduled.title);
  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, scheduled.id);
  assert.equal(governedDispatchCalls[0].requestFingerprint, "b".repeat(64));
});

test("publishNextStory: authenticated Pulse dispatch ignores a higher-scored story from another channel", async () => {
  const stacked = {
    id: "stacked_higher_score",
    channel_id: "stacked",
    title: "Finance story must not use the Pulse credential",
    approved: true,
    breaking_score: 100,
    exported_path: "/tmp/stacked-higher-score.mp4",
  };
  const pulse = {
    id: "pulse_lower_score",
    channel_id: "pulse-gaming",
    title: "Pulse story bound to the authenticated channel",
    approved: true,
    breaking_score: 20,
    exported_path: "/tmp/pulse-lower-score.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [stacked, pulse],
  });

  const result = await publishNextStory();

  assert.equal(result.title, pulse.title);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, pulse.id);
  assert.equal(governedDispatchCalls[0].channelId, "pulse-gaming");
});

test("publishNextStory: requested channel must match the authenticated YouTube channel", async () => {
  const story = {
    id: "stacked_wrong_credential",
    channel_id: "stacked",
    title: "Must not cross the authenticated channel boundary",
    approved: true,
    exported_path: "/tmp/stacked-wrong-credential.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [story],
  });

  const result = await publishNextStory({
    channelId: "stacked",
  });

  assert.equal(result.publish_dispatch_blocked, true);
  assert.equal(result.top_reason, "youtube_authenticated_channel_mismatch");
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);
});

test("publishNextStory: title dedupe is recorded through the governed pre-create boundary", async () => {
  const prior = {
    id: "rss_prior_title",
    title: "Four Xbox classics arrive on PC",
    approved: true,
    exported_path: "/tmp/prior.mp4",
    youtube_post_id: "yt-prior",
  };
  const candidate = {
    id: "rss_title_duplicate",
    title: "Four Xbox classics arrive on PC today",
    approved: true,
    exported_path: "/tmp/title-duplicate.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [prior, candidate],
  });

  const result = await publishNextStory();

  assert.deepEqual(uploaderCalls, []);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, candidate.id);
  assert.equal(result.platform_outcomes.youtube, "duplicate_blocked");
  assert.match(result.errors.youtube, /^dupe-blocked: title-skip:/);
});

test("publishNextStory: a canonically blocked row cannot starve the next scheduled candidate", async () => {
  const blocked = {
    id: "rss_blocked_first",
    title: "Previously blocked operation",
    approved: true,
    breaking_score: 100,
    exported_path: "/tmp/blocked-first.mp4",
  };
  const eligible = {
    id: "rss_eligible_second",
    title: "Next safe operation",
    approved: true,
    breaking_score: 50,
    exported_path: "/tmp/eligible-second.mp4",
    test_request_fingerprint: "c".repeat(64),
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [blocked, eligible],
  });
  const result = await publishNextStory({
    repos: {
      db: {},
      platformPosts: {
        getByStoryPlatform(storyId) {
          return storyId === blocked.id
            ? {
                story_id: storyId,
                platform: "youtube",
                status: "blocked",
                block_reason: "prior governed block",
              }
            : null;
        },
      },
      publicationGovernance: {
        getLatestLifecycleEvent(storyId) {
          return {
            id: storyId === blocked.id ? 31 : 32,
            evidence_json: JSON.stringify({
              dispatch_idempotency_key:
                `youtube:${storyId}:test-operation`,
              request_fingerprint: "c".repeat(64),
              scheduled_for: "2026-07-27T09:00:00.000Z",
            }),
          };
        },
      },
    },
  });

  assert.equal(result.title, eligible.title);
  assert.deepEqual(uploaderCalls, ["upload_youtube"]);
  assert.equal(governedDispatchCalls.length, 1);
  assert.equal(governedDispatchCalls[0].storyId, eligible.id);
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

test("publishNextStory: unavailable QA systems fail closed before any uploader fires", async () => {
  const scenarios = [
    {
      label: "content",
      cqaResult: new Error("content QA crashed"),
      vqaResult: { result: "pass", failures: [], warnings: [] },
      pvqaResult: { result: "pass", failures: [], warnings: [] },
      topReason: "content_qa: content_qa_unavailable",
    },
    {
      label: "video",
      cqaResult: { result: "pass", failures: [], warnings: [] },
      vqaResult: new Error("video QA crashed"),
      pvqaResult: { result: "pass", failures: [], warnings: [] },
      topReason: "video_qa: video_qa_unavailable",
    },
    {
      label: "platform-video",
      cqaResult: { result: "pass", failures: [], warnings: [] },
      vqaResult: { result: "pass", failures: [], warnings: [] },
      pvqaResult: new Error("platform video QA crashed"),
      topReason: "platform_video_qa: platform_video_qa_unavailable",
    },
  ];

  for (const scenario of scenarios) {
    const story = {
      id: `rss_qa_unavailable_${scenario.label}`,
      title: `QA unavailable ${scenario.label}`,
      approved: true,
      exported_path: `/tmp/${scenario.label}.mp4`,
    };
    const { publishNextStory } = setupMocks({
      cqaResult: scenario.cqaResult,
      vqaResult: scenario.vqaResult,
      pvqaResult: scenario.pvqaResult,
      stories: [story],
    });

    const result = await publishNextStory();
    assert.strictEqual(result.no_safe_candidate, true, scenario.label);
    assert.strictEqual(result.top_reason, scenario.topReason, scenario.label);
    assert.deepStrictEqual(uploaderCalls, [], scenario.label);
    const persisted = dbState.stories.find((row) => row.id === story.id);
    assert.strictEqual(persisted.qa_failed, true, scenario.label);
    assert.strictEqual(persisted.publish_status, "failed", scenario.label);
  }
});

test("publishNextStory: unavailable render contract fails closed and preserves the YouTube-only freeze", async () => {
  const story = {
    id: "rss_render_contract_unavailable",
    title: "Render contract unavailable",
    approved: true,
    exported_path: "/tmp/render-contract.mp4",
  };
  const { publishNextStory } = setupMocks({
    cqaResult: { result: "pass", failures: [], warnings: [] },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    pvqaResult: { result: "pass", failures: [], warnings: [] },
    renderDecisionError: new Error("render contract crashed"),
    stories: [story],
  });

  const result = await publishNextStory();
  assert.strictEqual(result.publish_scope, "stabilisation_youtube_only");
  assert.strictEqual(
    result.platform_outcomes.youtube,
    "governance_blocked",
  );
  assert.strictEqual(result.platform_outcomes.tiktok, "operator_disabled");
  assert.strictEqual(result.platform_outcomes.instagram, "operator_disabled");
  assert.strictEqual(result.platform_outcomes.facebook, "operator_disabled");
  assert.strictEqual(
    result.errors.contract,
    "render_contract_evaluation_unavailable",
  );
  assert.deepStrictEqual(uploaderCalls, []);
  const persisted = dbState.stories.find((row) => row.id === story.id);
  assert.strictEqual(persisted.render_contract_blocked, true);
  assert.strictEqual(persisted.publish_status, "held");
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
    title: "Stale mp4",
    approved: true,
    exported_path: "/tmp/bad.mp4",
  };
  const good = {
    id: "rss_good",
    title: "Healthy mp4",
    approved: true,
    exported_path: "/tmp/good.mp4",
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
  assert.strictEqual(result.title, "Healthy mp4");
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

test("multi-candidate: YouTube-complete partial rows do not consume stabilisation windows", async () => {
  // Legacy partial row: YouTube is already public while secondary
  // platforms are missing. QA remains skipped, but the secondary freeze
  // means no uploader is allowed to fire.
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
  // Even if QA stub would fail, the retry path must not run it.
  const { publishNextStory } = setupMocks({
    cqaResult: {
      result: "fail",
      failures: ["WOULD_BLOCK_IF_CALLED"],
      warnings: [],
    },
    vqaResult: { result: "pass", failures: [], warnings: [] },
    stories: [partial],
  });

  const result = await publishNextStory();
  assert.strictEqual(result, null);
  assert.deepEqual(uploaderCalls, []);
  assert.deepEqual(governedDispatchCalls, []);

  // The partial story was NOT persisted as qa_failed — QA wasn't run.
  const row = dbState.stories.find((s) => s.id === "rss_partial_retry");
  assert.notStrictEqual(
    row.qa_failed,
    true,
    "retry candidate must not be qa_failed",
  );
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
function selectorFilter(s) {
  if (!s.approved || !s.exported_path) return false;
  if (s.qa_failed === true) return false;
  if (s.publish_status === "failed") return false;
  return !isRealPlatformPostIdForTest(s.youtube_post_id);
}

function isRealPlatformPostIdForTest(id) {
  return (
    typeof id === "string" &&
    id.trim().length > 0 &&
    !id.startsWith("DUPE_")
  );
}

test("selector: YouTube-complete partial stories are ineligible during stabilisation", () => {
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
    false,
    "frozen secondary gaps must not consume a YouTube publish window",
  );
});

test("selector: a secondary-only legacy story remains eligible for governed YouTube dispatch", () => {
  const partial = {
    approved: true,
    exported_path: "/tmp/p.mp4",
    publish_status: "partial",
    youtube_post_id: null,
    instagram_media_id: "ig_real",
  };
  assert.strictEqual(selectorFilter(partial), true);
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
