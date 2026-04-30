"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const w = require("../../lib/intelligence/overnight-workshop");

// 2026-04-29: overnight workshop — four bounded passes that fire
// through the night to leave the project meaningfully better by
// morning. Pins the env-gating contract on each pass + the
// orchestration shape (no real network calls).

// ── env gating ────────────────────────────────────────────────────

test("isEnabled: false when env flag absent", () => {
  assert.equal(w.isEnabled({}), false);
  assert.equal(w.isEnabled({ OVERNIGHT_WORKSHOP_ENABLED: "false" }), false);
});

test("isEnabled: true on case-insensitive 'true'", () => {
  assert.equal(w.isEnabled({ OVERNIGHT_WORKSHOP_ENABLED: "true" }), true);
  assert.equal(w.isEnabled({ OVERNIGHT_WORKSHOP_ENABLED: "TRUE" }), true);
});

// ── produce sweep ────────────────────────────────────────────────

test("runOvernightProduceSweep: env unset → enabled=false, publisher not invoked", async () => {
  let invoked = false;
  const result = await w.runOvernightProduceSweep({
    env: {},
    publisher: {
      async produce() {
        invoked = true;
        return { ok: true };
      },
    },
    log: () => {},
  });
  assert.equal(result.enabled, false);
  assert.equal(invoked, false);
});

test("runOvernightProduceSweep: env true → calls publisher.produce, returns elapsed", async () => {
  const path = require("node:path");
  const os = require("node:os");
  const fs = require("fs-extra");
  const tmpLock = path.join(os.tmpdir(), `pulse-test-lock-${Date.now()}.json`);
  try {
    const result = await w.runOvernightProduceSweep({
      env: { OVERNIGHT_WORKSHOP_ENABLED: "true" },
      publisher: {
        async produce() {
          return { produced: 3 };
        },
      },
      log: () => {},
      lockPath: tmpLock,
    });
    assert.equal(result.enabled, true);
    assert.deepEqual(result.result, { produced: 3 });
    assert.ok(typeof result.elapsed_ms === "number");
    assert.equal(await fs.pathExists(tmpLock), false);
  } finally {
    await fs.remove(tmpLock).catch(() => {});
  }
});

test("runOvernightProduceSweep: skips when fresh lock present (single-flight guard)", async () => {
  const path = require("node:path");
  const os = require("node:os");
  const fs = require("fs-extra");
  const tmpLock = path.join(os.tmpdir(), `pulse-test-lock2-${Date.now()}.json`);
  try {
    await fs.writeJson(tmpLock, { started_at: Date.now(), pid: 99999 });
    let invoked = false;
    const result = await w.runOvernightProduceSweep({
      env: { OVERNIGHT_WORKSHOP_ENABLED: "true" },
      publisher: {
        async produce() {
          invoked = true;
          return { ok: true };
        },
      },
      log: () => {},
      lockPath: tmpLock,
    });
    assert.equal(result.enabled, true);
    assert.equal(result.skipped, "previous_sweep_in_flight");
    assert.equal(invoked, false);
  } finally {
    await fs.remove(tmpLock).catch(() => {});
  }
});

test("runOvernightProduceSweep: clears stale lock and proceeds", async () => {
  const path = require("node:path");
  const os = require("node:os");
  const fs = require("fs-extra");
  const tmpLock = path.join(os.tmpdir(), `pulse-test-lock3-${Date.now()}.json`);
  try {
    const stale = Date.now() - 12 * 60 * 60 * 1000;
    await fs.writeJson(tmpLock, { started_at: stale, pid: 99999 });
    let invoked = false;
    const result = await w.runOvernightProduceSweep({
      env: { OVERNIGHT_WORKSHOP_ENABLED: "true" },
      publisher: {
        async produce() {
          invoked = true;
          return { ok: true };
        },
      },
      log: () => {},
      lockPath: tmpLock,
    });
    assert.equal(result.enabled, true);
    assert.equal(invoked, true);
    assert.deepEqual(result.result, { ok: true });
  } finally {
    await fs.remove(tmpLock).catch(() => {});
  }
});

// ── analytics backfill ───────────────────────────────────────────

test("runOvernightAnalyticsBackfill: env unset → enabled=false, no fetch", async () => {
  let yt = 0;
  const result = await w.runOvernightAnalyticsBackfill({
    env: {},
    db: {
      async getStories() {
        return [
          {
            id: "x",
            youtube_post_id: "yt",
            created_at: new Date().toISOString(),
          },
        ];
      },
    },
    fetchYouTubeStats: async () => {
      yt++;
      return { views: 1 };
    },
    fetchTikTokStats: async () => null,
    log: () => {},
  });
  assert.equal(result.enabled, false);
  assert.equal(yt, 0);
});

test("runOvernightAnalyticsBackfill: env true + 2 stories → 2 YT fetches, paced", async () => {
  const calls = [];
  const recorded = [];
  const fakeRepos = {
    db: {
      prepare() {
        return {
          run(...args) {
            recorded.push(args);
          },
        };
      },
    },
  };
  const result = await w.runOvernightAnalyticsBackfill({
    env: { OVERNIGHT_WORKSHOP_ENABLED: "true" },
    repos: fakeRepos,
    db: {
      async getStories() {
        const now = new Date().toISOString();
        return [
          { id: "a", youtube_post_id: "yta", created_at: now },
          { id: "b", youtube_post_id: "ytb", created_at: now },
        ];
      },
    },
    fetchYouTubeStats: async (id) => {
      calls.push(id);
      return { views: 100, likes: 5, comments: 1 };
    },
    fetchTikTokStats: async () => null,
    pauseMs: 1, // make the test fast
    log: () => {},
  });
  assert.equal(result.enabled, true);
  assert.equal(result.youtube.ok, 2);
  assert.equal(result.youtube.fail, 0);
  assert.deepEqual(calls, ["yta", "ytb"]);
});

test("runOvernightAnalyticsBackfill: skips stories outside the 30d window", async () => {
  let calls = 0;
  const old = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
  await w.runOvernightAnalyticsBackfill({
    env: { OVERNIGHT_WORKSHOP_ENABLED: "true" },
    db: {
      async getStories() {
        return [{ id: "old", youtube_post_id: "yt", created_at: old }];
      },
    },
    fetchYouTubeStats: async () => {
      calls++;
      return { views: 1 };
    },
    fetchTikTokStats: async () => null,
    pauseMs: 1,
    log: () => {},
  });
  assert.equal(calls, 0);
});

// ── claude analyst ──────────────────────────────────────────────

test("runOvernightClaudeAnalyst: env unset → enabled=false, no anthropic call", async () => {
  let calls = 0;
  const result = await w.runOvernightClaudeAnalyst({
    env: {},
    db: {
      async getStories() {
        return [];
      },
    },
    anthropicCall: async () => {
      calls++;
      return "x";
    },
    log: () => {},
  });
  assert.equal(result.enabled, false);
  assert.equal(calls, 0);
});

test("runOvernightClaudeAnalyst: env true + injected anthropic returns briefing", async () => {
  const result = await w.runOvernightClaudeAnalyst({
    env: { OVERNIGHT_WORKSHOP_ENABLED: "true", ANTHROPIC_API_KEY: "k" },
    db: {
      async getStories() {
        return [
          {
            id: "story1",
            title: "Sample story",
            created_at: new Date().toISOString(),
            exported_path: "/tmp/x.mp4",
            content_pillar: "Confirmed Drop",
            render_quality_class: "premium",
            distinct_visual_count: 5,
            youtube_post_id: "yt1",
          },
        ];
      },
    },
    anthropicCall: async (prompt) => {
      assert.match(prompt, /Pulse Gaming/);
      assert.match(prompt, /story1/);
      return "## What worked\n- Hook X\n## What didn't\n- Long body\n## Approve first today\n- story1\n## One thing to watch\n- TBC";
    },
    log: () => {},
  });
  assert.equal(result.enabled, true);
  assert.match(result.briefing, /What worked/);
});

test("runOvernightClaudeAnalyst: anthropic call failure → returns error, doesn't throw", async () => {
  const result = await w.runOvernightClaudeAnalyst({
    env: { OVERNIGHT_WORKSHOP_ENABLED: "true", ANTHROPIC_API_KEY: "k" },
    db: {
      async getStories() {
        return [];
      },
    },
    anthropicCall: async () => {
      throw new Error("rate_limit");
    },
    log: () => {},
  });
  assert.equal(result.enabled, true);
  assert.match(result.error, /rate_limit/);
});

// ── morning digest ───────────────────────────────────────────────

test("runOvernightMorningDigest: env unset → enabled=false, no notify", async () => {
  let posts = 0;
  const result = await w.runOvernightMorningDigest({
    env: {},
    db: {
      async getStories() {
        return [];
      },
    },
    notify: async () => {
      posts++;
    },
    log: () => {},
  });
  assert.equal(result.enabled, false);
  assert.equal(posts, 0);
});

test("runOvernightMorningDigest: env true → posts a Discord summary", async () => {
  let posted = null;
  const recent = new Date().toISOString();
  const result = await w.runOvernightMorningDigest({
    env: { OVERNIGHT_WORKSHOP_ENABLED: "true" },
    db: {
      async getStories() {
        return [
          {
            id: "s1",
            exported_path: "/tmp/s1.mp4",
            exported_at: recent,
            distinct_visual_count: 6,
            render_quality_class: "premium",
          },
          {
            id: "s2",
            exported_path: "/tmp/s2.mp4",
            exported_at: recent,
            distinct_visual_count: 4,
            render_quality_class: "standard",
          },
        ];
      },
    },
    repos: { db: null },
    notify: async (msg) => {
      posted = msg;
    },
    fs: {
      async pathExists() {
        return false;
      },
    },
    log: () => {},
  });
  assert.equal(result.enabled, true);
  assert.equal(result.produced_overnight, 2);
  assert.equal(result.avg_visual_count, 5);
  assert.match(posted, /Overnight workshop/);
});
