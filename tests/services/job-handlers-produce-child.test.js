"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const test = require("node:test");

const HANDLERS_PATH = require.resolve("../../lib/job-handlers");

function loadHandlersWithSpawn(fakeSpawn) {
  const cp = require("node:child_process");
  const originalSpawn = cp.spawn;
  delete require.cache[HANDLERS_PATH];
  cp.spawn = fakeSpawn;
  const loaded = require("../../lib/job-handlers");
  cp.spawn = originalSpawn;
  return loaded;
}

function fakeChild({ code = 0, stdout = "", stderr = "" } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setImmediate(() => {
    if (stdout) child.stdout.emit("data", Buffer.from(stdout));
    if (stderr) child.stderr.emit("data", Buffer.from(stderr));
    child.emit("close", code, null);
  });
  return child;
}

test("produce job handler scopes the produce CLI to its queued story", async () => {
  let captured = null;
  const logs = [];
  const { handlers } = loadHandlersWithSpawn((command, args, options) => {
    captured = { command, args, options };
    return fakeChild({ stdout: "[run] Produce complete\n" });
  });

  const result = await handlers.produce(
    {
      id: 42,
      kind: "produce",
      story_id: "rss_fresh_story",
      payload: { story_id: "rss_fresh_story" },
    },
    { log: (line) => logs.push(line) },
  );

  assert.equal(captured.command, process.execPath);
  assert.deepEqual(captured.args, [
    "run.js",
    "produce",
    "--story-id",
    "rss_fresh_story",
  ]);
  assert.equal(captured.options.cwd, path.resolve(__dirname, "..", ".."));
  assert.equal(captured.options.windowsHide, true);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "child_process");
  assert.equal(result.exit_code, 0);
  assert.match(result.stdout_tail, /Produce complete/);
  assert.ok(logs.some((line) => line.includes("[produce-child] [run] Produce complete")));
});

test("produce job handler fails the job when the child process exits non-zero", async () => {
  const { handlers } = loadHandlersWithSpawn(() =>
    fakeChild({ code: 7, stderr: "fatal produce failure\n" }),
  );

  await assert.rejects(
    handlers.produce(
      {
        id: 43,
        kind: "produce",
        story_id: "rss_failed_story",
        payload: { story_id: "rss_failed_story" },
      },
      { log: () => {} },
    ),
    /produce child process failed with code 7: fatal produce failure/,
  );
});

test("legacy produce jobs select one fresh recoverable unpublished story", async () => {
  let captured = null;
  const { handlers } = loadHandlersWithSpawn((command, args, options) => {
    captured = { command, args, options };
    return fakeChild({ stdout: "[run] Produce complete\n" });
  });
  const now = new Date("2026-07-23T20:00:00.000Z");

  const result = await handlers.produce(
    { id: 44, kind: "produce", payload: {} },
    {
      log: () => {},
      now,
      getStories: async () => [
        {
          id: "rss_stale",
          approved: true,
          full_script: "A complete but stale script.",
          timestamp: "2026-07-18T12:00:00.000Z",
        },
        {
          id: "rss_published",
          approved: true,
          full_script: "Already posted.",
          timestamp: "2026-07-23T19:30:00.000Z",
          youtube_post_id: "yt-live-id",
        },
        {
          id: "rss_unapproved",
          approved: false,
          full_script: "Not approved.",
          timestamp: "2026-07-23T19:20:00.000Z",
        },
        {
          id: "rss_hard_qa_failure",
          approved: true,
          full_script: "A script outside the governed duration lane.",
          timestamp: "2026-07-23T19:15:00.000Z",
          qa_failed: true,
          publish_error:
            "qa_blocked: breaking_news_script_word_count_out_of_bounds",
        },
        {
          id: "rss_recoverable_tts",
          approved: true,
          full_script: "Fresh story whose transient TTS failure can be retried.",
          timestamp: "2026-07-23T19:00:00.000Z",
          qa_failed: true,
          publish_error:
            "audio_generation_failed: server_down: local TTS server is not reachable",
        },
        {
          id: "rss_older_ready",
          approved: true,
          full_script: "Another eligible fresh story.",
          timestamp: "2026-07-23T18:00:00.000Z",
        },
      ],
    },
  );

  assert.deepEqual(captured.args, [
    "run.js",
    "produce",
    "--story-id",
    "rss_recoverable_tts",
  ]);
  assert.equal(result.story_id, "rss_recoverable_tts");
});

test("a successful legacy produce job enqueues one bounded story-scoped continuation", async () => {
  let captured = null;
  let storyReadCount = 0;
  const enqueued = [];
  const { handlers } = loadHandlersWithSpawn((command, args, options) => {
    captured = { command, args, options };
    return fakeChild({ stdout: "[run] Produce complete\n" });
  });
  const current = {
    id: "rss_current",
    approved: true,
    full_script: "The freshest eligible story.",
    timestamp: "2026-07-23T19:30:00.000Z",
  };
  const next = {
    id: "rss_next",
    approved: true,
    full_script: "The next eligible story.",
    timestamp: "2026-07-23T19:00:00.000Z",
  };

  const result = await handlers.produce(
    {
      id: 45,
      kind: "produce",
      channel_id: "pulse-gaming",
      priority: 30,
      max_attempts: 3,
      payload: {},
    },
    {
      log: () => {},
      now: new Date("2026-07-23T20:00:00.000Z"),
      getStories: async () => {
        storyReadCount += 1;
        return storyReadCount === 1
          ? [current, next]
          : [{ ...current, exported_path: "output/final/rss_current.mp4" }, next];
      },
      repos: {
        jobs: {
          enqueue(job) {
            enqueued.push(job);
            return { id: 9001, ...job };
          },
        },
      },
    },
  );

  assert.deepEqual(captured.args, [
    "run.js",
    "produce",
    "--story-id",
    "rss_current",
  ]);
  assert.equal(storyReadCount, 2);
  assert.equal(enqueued.length, 1);
  assert.deepEqual(enqueued[0], {
    kind: "produce",
    channel_id: "pulse-gaming",
    story_id: "rss_next",
    payload: {
      story_id: "rss_next",
      chain_root_job_id: 45,
      chain_remaining: 4,
      attempted_story_ids: ["rss_current"],
      reason: "story_scoped_produce_continuation",
    },
    priority: 30,
    requires_gpu: false,
    max_attempts: 3,
    idempotency_key: "produce:story-chain:45:rss_next",
  });
  assert.equal(result.continuation_job_id, 9001);
  assert.equal(result.continuation_story_id, "rss_next");
});

test("legacy produce jobs stop safely when no fresh eligible story exists", async () => {
  let spawnCount = 0;
  const { handlers } = loadHandlersWithSpawn(() => {
    spawnCount += 1;
    return fakeChild();
  });

  const result = await handlers.produce(
    { id: 46, kind: "produce", payload: {} },
    {
      log: () => {},
      now: new Date("2026-07-23T20:00:00.000Z"),
      getStories: async () => [
        {
          id: "rss_stale_only",
          approved: true,
          full_script: "Old news must not become cadence filler.",
          timestamp: "2026-07-18T12:00:00.000Z",
        },
        {
          id: "rss_unapproved_only",
          approved: false,
          full_script: "This story has no approval authority.",
          timestamp: "2026-07-23T19:30:00.000Z",
        },
      ],
    },
  );

  assert.equal(spawnCount, 0);
  assert.deepEqual(result, {
    ok: true,
    skipped: true,
    reason: "no_fresh_eligible_story",
  });
});

test("analytics job handler runs the analytics CLI in a child process", async () => {
  let captured = null;
  const logs = [];
  const { handlers } = loadHandlersWithSpawn((command, args, options) => {
    captured = { command, args, options };
    return fakeChild({ stdout: "[analytics] === ANALYTICS PASS COMPLETE ===\n" });
  });

  const result = await handlers.analytics(
    { id: 44, kind: "analytics" },
    { log: (line) => logs.push(line) },
  );

  assert.equal(captured.command, process.execPath);
  assert.deepEqual(captured.args, ["analytics.js"]);
  assert.equal(captured.options.cwd, path.resolve(__dirname, "..", ".."));
  assert.equal(captured.options.windowsHide, true);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "child_process");
  assert.equal(result.exit_code, 0);
  assert.match(result.stdout_tail, /ANALYTICS PASS COMPLETE/);
  assert.ok(logs.some((line) => line.includes("[analytics-child] [analytics] === ANALYTICS PASS COMPLETE ===")));
});
