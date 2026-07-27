"use strict";

const assert = require("node:assert/strict");
const { afterEach, test } = require("node:test");

const HANDLERS_PATH = require.resolve("../../lib/job-handlers");
const PUBLISHER_PATH = require.resolve("../../publisher");
const ENGAGEMENT_PATH = require.resolve("../../engagement");
const DB_PATH = require.resolve("../../lib/db");
const ANALYTICS_PATH = require.resolve("../../analytics");
const HUNTER_PATH = require.resolve("../../hunter");
const PROCESSOR_PATH = require.resolve("../../processor");
const STUDIO_ANALYTICS_PATH = require.resolve(
  "../../tools/studio-v2-analytics-loop",
);
const WEEKLY_COMPILE_PATH = require.resolve("../../weekly_compile");
const NOTIFY_PATH = require.resolve("../../notify");
const BLOG_BUILD_PATH = require.resolve("../../blog/build");
const DB_BACKUP_PATH = require.resolve("../../lib/db_backup");
const OPTIMAL_TIMING_PATH = require.resolve("../../optimal_timing");
const INSTAGRAM_UPLOAD_PATH = require.resolve("../../upload_instagram");
const FS_EXTRA_PATH = require.resolve("fs-extra");
const OVERNIGHT_PATH = require.resolve(
  "../../lib/intelligence/overnight-workshop",
);
const LIVE_ANALYST_PATH = require.resolve(
  "../../lib/intelligence/live-performance-analyst",
);
const RENDER_HEALTH_PATH = require.resolve(
  "../../lib/intelligence/render-health-digest",
);
const INSTAGRAM_VERIFIER_PATH = require.resolve(
  "../../lib/intelligence/instagram-pending-verifier",
);
const TIKTOK_UPLOAD_PATH = require.resolve("../../upload_tiktok");
const DEPLOYMENT_MODE_PATH = require.resolve("../../lib/deployment-mode");
const OBSERVABILITY_PATH = require.resolve("../../lib/observability");
const REPURPOSE_PATH = require.resolve("../../lib/repurpose");
const ROUNDUP_PATH = require.resolve("../../lib/roundup");

const originalModules = new Map();

function stubModule(resolvedPath, exports) {
  if (!originalModules.has(resolvedPath)) {
    originalModules.set(resolvedPath, require.cache[resolvedPath]);
  }
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports,
  };
}

function loadHandlers() {
  delete require.cache[HANDLERS_PATH];
  return require("../../lib/job-handlers").handlers;
}

afterEach(() => {
  delete require.cache[HANDLERS_PATH];
  for (const [resolvedPath, cached] of originalModules) {
    if (cached) require.cache[resolvedPath] = cached;
    else delete require.cache[resolvedPath];
  }
  originalModules.clear();
});

test("produce fences the durable operation before and after its await", async () => {
  const events = [];
  stubModule(PUBLISHER_PATH, {
    async produce() {
      events.push("produce");
      return { produced: true };
    },
  });

  const result = await loadHandlers().produce(
    { id: 1 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { produced: true });
  assert.deepEqual(events, ["lease", "produce", "lease"]);
});

test("a lost lease prevents production from starting", async () => {
  let produceCalled = false;
  stubModule(PUBLISHER_PATH, {
    async produce() {
      produceCalled = true;
    },
  });

  await assert.rejects(
    loadHandlers().produce(
      { id: 101 },
      {
        assertLeaseHealthy() {
          throw new Error("job_lease_lost");
        },
      },
    ),
    /job_lease_lost/,
  );
  assert.equal(produceCalled, false);
});

test("engage fences the external engagement pass before and after its await", async () => {
  const events = [];
  stubModule(ENGAGEMENT_PATH, {
    async engageRecent() {
      events.push("engage");
    },
  });

  const result = await loadHandlers().engage(
    { id: 2 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ["lease", "engage", "lease"]);
});

test("first-hour engagement fences each external action", async () => {
  const events = [];
  stubModule(DB_PATH, {
    useSqlite: () => true,
    getStoriesSync: () => [
      {
        id: "recent",
        youtube_post_id: "yt-recent",
        publish_status: "published",
        published_at: new Date().toISOString(),
      },
    ],
  });
  stubModule(ENGAGEMENT_PATH, {
    async engageFirstHour() {
      events.push("engage-first-hour");
    },
  });

  const result = await loadHandlers().engage_first_hour(
    { id: 3 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { processed: 1 });
  assert.deepEqual(events, ["lease", "engage-first-hour", "lease"]);
});

test("analytics fences its external fetch and durable metrics update", async () => {
  const events = [];
  stubModule(ANALYTICS_PATH, {
    async runAnalytics() {
      events.push("analytics");
    },
  });

  const result = await loadHandlers().analytics(
    { id: 4 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ["lease", "analytics", "lease"]);
});

test("hunt fences discovery, durable processing and approval separately", async () => {
  const events = [];
  stubModule(HUNTER_PATH, async () => {
    events.push("hunt");
    return [{ id: "story-1" }];
  });
  stubModule(PROCESSOR_PATH, async () => {
    events.push("process");
  });
  stubModule(PUBLISHER_PATH, {
    async autoApprove() {
      events.push("approve");
      return { approved: 1 };
    },
  });

  const result = await loadHandlers().hunt(
    { id: 5 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, {
    fetched: 1,
    scoring: { approved: 1 },
  });
  assert.deepEqual(events, [
    "lease",
    "hunt",
    "lease",
    "lease",
    "process",
    "lease",
    "lease",
    "approve",
    "lease",
  ]);
});

test("studio analytics fences its durable analysis pass", async () => {
  const events = [];
  stubModule(STUDIO_ANALYTICS_PATH, {
    async main(options) {
      events.push(["studio", options]);
    },
  });

  const result = await loadHandlers().studio_analytics_loop(
    { id: 6, payload: { days: 21, dry: true } },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { ok: true, days: 21 });
  assert.deepEqual(events, [
    "lease",
    ["studio", { days: 21, dry: true }],
    "lease",
  ]);
});

test("weekly roundup fences compilation and operator notification", async () => {
  const events = [];
  stubModule(WEEKLY_COMPILE_PATH, {
    async compileWeekly() {
      events.push("compile");
      return {
        story_count: 5,
        duration_seconds: 600,
        youtube_url: "https://example.invalid/weekly",
      };
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    events.push("notify");
  });

  const result = await loadHandlers().roundup_weekly(
    { id: 7, channel_id: "pulse-gaming" },
    {
      repos: { jobs: { enqueue() {} } },
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, {
    story_count: 5,
    duration_seconds: 600,
    youtube_url: "https://example.invalid/weekly",
    roundup_id: null,
  });
  assert.deepEqual(events, [
    "lease",
    "compile",
    "lease",
    "lease",
    "notify",
    "lease",
  ]);
});

test("monthly roundup leaves topic discovery read-only and fences compilation", async () => {
  const events = [];
  stubModule(WEEKLY_COMPILE_PATH, {
    async identifyCompilableTopics() {
      events.push("discover-topics");
      return [{ keyword: "Xbox" }];
    },
    async compileByTopic(keyword) {
      events.push(["compile-topic", keyword]);
      return { duration_seconds: 480 };
    },
  });

  const result = await loadHandlers().roundup_monthly_topics(
    { id: 8 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, {
    completed: [
      {
        keyword: "Xbox",
        ok: true,
        duration_seconds: 480,
      },
    ],
  });
  assert.deepEqual(events, [
    "discover-topics",
    "lease",
    ["compile-topic", "Xbox"],
    "lease",
  ]);
});

test("blog rebuild fences the durable site write", async () => {
  const events = [];
  stubModule(BLOG_BUILD_PATH, {
    async build() {
      events.push("build");
    },
  });

  const result = await loadHandlers().blog_rebuild(
    { id: 9 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ["lease", "build", "lease"]);
});

test("database backup fences the durable backup operation", async () => {
  const events = [];
  stubModule(DB_BACKUP_PATH, {
    async backupDatabase() {
      events.push("backup");
    },
  });

  const result = await loadHandlers().db_backup(
    { id: 10 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ["lease", "backup", "lease"]);
});

test("timing analysis fences notification but not the read-only report", async () => {
  const events = [];
  stubModule(OPTIMAL_TIMING_PATH, {
    async getTimingReport() {
      events.push("report");
      return "timing report";
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    events.push("notify");
  });

  const result = await loadHandlers().timing_reanalysis(
    { id: 11 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(events, ["report", "lease", "notify", "lease"]);
});

test("best-effort notification handling does not swallow lease loss", async () => {
  let checks = 0;
  stubModule(OPTIMAL_TIMING_PATH, {
    async getTimingReport() {
      return "timing report";
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    throw new Error("notification failed");
  });

  await assert.rejects(
    loadHandlers().timing_reanalysis(
      { id: 102 },
      {
        assertLeaseHealthy() {
          checks += 1;
          if (checks === 2) throw new Error("job_lease_lost");
        },
      },
    ),
    /job_lease_lost/,
  );
  assert.equal(checks, 2);
});

test("Instagram token maintenance fences seed and refresh writes", async () => {
  const events = [];
  stubModule(INSTAGRAM_UPLOAD_PATH, {
    async seedTokenFromEnv() {
      events.push("seed");
    },
    async refreshToken() {
      events.push("refresh");
    },
  });
  stubModule(FS_EXTRA_PATH, {
    async pathExists() {
      events.push("exists");
      return true;
    },
    async readJson() {
      events.push("read");
      return {
        access_token: "redacted-test-token",
        expires_at: Date.now() + 10 * 24 * 60 * 60 * 1000,
      };
    },
  });

  const result = await loadHandlers().instagram_token_refresh(
    { id: 12 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.equal(result.refreshed, true);
  assert.deepEqual(events, [
    "lease",
    "seed",
    "lease",
    "exists",
    "read",
    "lease",
    "refresh",
    "lease",
  ]);
});

test("overnight production sweep fences its durable workshop pass", async () => {
  const events = [];
  stubModule(OVERNIGHT_PATH, {
    async runOvernightProduceSweep() {
      events.push("overnight-produce");
      return { produced: 2 };
    },
  });

  const result = await loadHandlers().overnight_produce_sweep(
    { id: 13 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { produced: 2 });
  assert.deepEqual(events, ["lease", "overnight-produce", "lease"]);
});

test("overnight analytics backfill fences its durable metrics pass", async () => {
  const events = [];
  stubModule(OVERNIGHT_PATH, {
    async runOvernightAnalyticsBackfill() {
      events.push("overnight-analytics");
      return { snapshots_written: 3 };
    },
  });

  const result = await loadHandlers().overnight_analytics_backfill(
    { id: 14 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { snapshots_written: 3 });
  assert.deepEqual(events, ["lease", "overnight-analytics", "lease"]);
});

test("overnight analyst fences its external model and durable report pass", async () => {
  const events = [];
  stubModule(OVERNIGHT_PATH, {
    async runOvernightClaudeAnalyst() {
      events.push("overnight-analyst");
      return { findings_written: 1 };
    },
  });

  const result = await loadHandlers().overnight_claude_analyst(
    { id: 15 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { findings_written: 1 });
  assert.deepEqual(events, ["lease", "overnight-analyst", "lease"]);
});

test("overnight morning digest fences its external notification pass", async () => {
  const events = [];
  stubModule(OVERNIGHT_PATH, {
    async runOvernightMorningDigest() {
      events.push("overnight-digest");
      return { notified: true };
    },
  });

  const result = await loadHandlers().overnight_morning_digest(
    { id: 16 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { notified: true });
  assert.deepEqual(events, ["lease", "overnight-digest", "lease"]);
});

test("live performance analyst fences durable model updates and alerts", async () => {
  const events = [];
  stubModule(LIVE_ANALYST_PATH, {
    async runLiveAnalystPass() {
      events.push("live-analyst");
      return { signals_written: 2 };
    },
  });

  const result = await loadHandlers().live_performance_analyst(
    { id: 17 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { signals_written: 2 });
  assert.deepEqual(events, ["lease", "live-analyst", "lease"]);
});

test("render-health digest fences notification but not its read-only analysis", async () => {
  const events = [];
  stubModule(RENDER_HEALTH_PATH, {
    async runRenderHealthDigest() {
      events.push("render-read");
      return {
        summary: { stories: 4 },
        markdown: "render health",
      };
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    events.push("notify");
  });

  const result = await loadHandlers().render_health_digest(
    { id: 18 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { stories: 4 });
  assert.deepEqual(events, ["render-read", "lease", "notify", "lease"]);
});

test("Instagram pending verification fences reconciliation and notification", async () => {
  const events = [];
  stubModule(INSTAGRAM_VERIFIER_PATH, {
    async runVerifyPass() {
      events.push("verify");
      return {
        enabled: true,
        checked: 1,
        finished: 1,
        still_pending: 0,
        expired_or_error: 0,
        transient: 0,
      };
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    events.push("notify");
  });

  const result = await loadHandlers().instagram_pending_verify(
    { id: 19 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.equal(result.finished, 1);
  assert.deepEqual(events, [
    "lease",
    "verify",
    "lease",
    "lease",
    "notify",
    "lease",
  ]);
});

test("TikTok auth check leaves token inspection read-only and fences refresh", async () => {
  const events = [];
  stubModule(TIKTOK_UPLOAD_PATH, {
    async inspectTokenStatus() {
      events.push("inspect");
      return {
        ok: true,
        reason: "valid",
        expires_in_seconds: 60,
        needs_reauth: false,
      };
    },
    async getAccessToken() {
      events.push("refresh");
    },
  });
  stubModule(DEPLOYMENT_MODE_PATH, {
    getPublicUrl: () => "https://example.invalid",
  });

  const result = await loadHandlers().tiktok_auth_check(
    { id: 20 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.equal(result.refresh_ok, true);
  assert.deepEqual(events, ["inspect", "lease", "refresh", "lease"]);
});

test("scoring digest fences notification but not its read-only summary", async () => {
  const events = [];
  stubModule(OBSERVABILITY_PATH, {
    getScoringDigest() {
      events.push("summary");
      return {
        scored: 3,
        by_decision: { approved: 2, rejected: 1 },
        avg_total: 72,
      };
    },
    buildScoringDigestMessage() {
      return "scoring digest";
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    events.push("notify");
  });

  const result = await loadHandlers().scoring_digest(
    { id: 21, payload: { hours: 12 } },
    {
      repos: {},
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.equal(result.scored, 3);
  assert.deepEqual(events, ["summary", "lease", "notify", "lease"]);
});

test("derivative jobs fence durable repurposing work", async () => {
  const events = [];
  stubModule(REPURPOSE_PATH, {
    async runDerivative() {
      events.push("derivative");
      return { derivative_id: 31 };
    },
  });

  const result = await loadHandlers().derivative_blog_post(
    { id: 22 },
    {
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { derivative_id: 31 });
  assert.deepEqual(events, ["lease", "derivative", "lease"]);
});

test("roundup fanout fences durable derivative creation", async () => {
  const events = [];
  stubModule(REPURPOSE_PATH, {
    async fanoutRoundup() {
      events.push("fanout");
      return { derivatives_created: 4 };
    },
  });

  const result = await loadHandlers().roundup_fanout(
    {
      id: 23,
      channel_id: "pulse-gaming",
      payload: { roundup_id: 41 },
    },
    {
      repos: {},
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(result, { derivatives_created: 4 });
  assert.deepEqual(events, ["lease", "fanout", "lease"]);
});

test("jobs reap fences the synchronous queue mutation", async () => {
  const events = [];

  const result = await loadHandlers().jobs_reap(
    { id: 24 },
    {
      repos: {
        jobs: {
          reapStaleClaims() {
            events.push("reap");
            return 2;
          },
        },
      },
      assertLeaseHealthy() {
        events.push("lease");
      },
    },
  );

  assert.deepEqual(result, { reclaimed: 2 });
  assert.deepEqual(events, ["lease", "reap", "lease"]);
});

test("weekly roundup fences synchronous planning and fanout queue writes", async (t) => {
  const previous = process.env.USE_SCORING_ENGINE;
  process.env.USE_SCORING_ENGINE = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.USE_SCORING_ENGINE;
    else process.env.USE_SCORING_ENGINE = previous;
  });

  const events = [];
  stubModule(ROUNDUP_PATH, {
    buildWeeklyRoundup() {
      events.push("plan");
      return {
        skipped: false,
        roundup_id: 51,
        main_count: 3,
        quickfire_count: 2,
      };
    },
  });
  stubModule(WEEKLY_COMPILE_PATH, {
    async compileWeekly() {
      events.push("compile");
      return {
        story_count: 5,
        duration_seconds: 600,
        youtube_url: null,
      };
    },
  });
  stubModule(NOTIFY_PATH, async () => {
    events.push("notify");
  });

  await loadHandlers().roundup_weekly(
    { id: 25, channel_id: "pulse-gaming" },
    {
      repos: {
        jobs: {
          enqueue() {
            events.push("enqueue");
          },
        },
      },
      assertLeaseHealthy() {
        events.push("lease");
      },
      log() {},
    },
  );

  assert.deepEqual(events, [
    "lease",
    "plan",
    "lease",
    "lease",
    "compile",
    "lease",
    "lease",
    "notify",
    "lease",
    "lease",
    "enqueue",
    "lease",
  ]);
});
