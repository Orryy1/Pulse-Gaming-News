"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  startGovernedBreakingWatcher,
} = require("../../lib/services/governed-breaking-watcher");
const { runMigrations } = require("../../lib/migrate");
const {
  bind: bindJobs,
} = require("../../lib/repositories/jobs");

test("canonical watcher durably enqueues breaking discoveries and detaches cleanly", async () => {
  const emitter = new EventEmitter();
  const queued = [];
  const logs = [];
  let stopped = 0;
  const handle = startGovernedBreakingWatcher({
    startWatching() {
      return emitter;
    },
    stopWatching() {
      stopped += 1;
    },
    jobs: {
      enqueue(input) {
        queued.push(input);
        return { id: 44, ...input };
      },
    },
    nowProvider: () => new Date("2026-07-28T14:05:00.000Z"),
    log(message) {
      logs.push(message);
    },
  });

  assert.equal(handle.active, true);
  emitter.emit("breaking", {
    id: "breaking-44",
    title: "Xbox publishes a major compatibility update",
    url: "https://news.xbox.com/example",
    source_type: "rss",
    breaking_score: 150,
  });
  await handle.flush();

  assert.equal(queued.length, 1);
  assert.equal(queued[0].kind, "breaking_story_discovery");
  assert.ok(logs.some((line) => /breaking-44/.test(line)));

  handle.stop();
  assert.equal(handle.active, false);
  assert.equal(stopped, 1);
  emitter.emit("breaking", {
    id: "breaking-after-stop",
    title: "Should not enqueue",
    breaking_score: 150,
  });
  await handle.flush();
  assert.equal(queued.length, 1);
});

test("watcher errors are logged without creating an unhandled rejection", async () => {
  const emitter = new EventEmitter();
  const logs = [];
  const handle = startGovernedBreakingWatcher({
    startWatching: () => emitter,
    stopWatching() {},
    jobs: {
      enqueue() {
        throw new Error("sqlite_busy");
      },
    },
    log: (message) => logs.push(message),
  });

  emitter.emit("breaking", {
    id: "breaking-error",
    title: "Valid urgent event",
    breaking_score: 150,
  });
  await handle.flush();
  assert.ok(logs.some((line) => /sqlite_busy/.test(line)));
  handle.stop();
});

test("recurrent timestamp-less watcher observations reuse one real repository job", async (t) => {
  const db = new Database(":memory:");
  runMigrations(db, {
    log() {},
    env: { PULSE_RUNTIME_MODE: "LOCAL_PROOF" },
  });
  db.prepare(
    "INSERT INTO channels (id, name) VALUES (?, ?)",
  ).run("pulse-gaming", "Pulse Gaming");
  t.after(() => db.close());
  const jobs = bindJobs(db);
  const emitter = new EventEmitter();
  const logs = [];
  let observedAt = "2026-07-28T14:05:00.000Z";
  const handle = startGovernedBreakingWatcher({
    startWatching: () => emitter,
    stopWatching() {},
    jobs,
    nowProvider: () => new Date(observedAt),
    log: (message) => logs.push(message),
  });
  t.after(() => handle.stop());
  const timestampLessStory = {
    id: "breaking-no-source-time",
    title: "Xbox publishes a major compatibility update",
    url: "https://news.xbox.com/example",
    source_type: "rss",
    breaking_score: 150,
  };

  emitter.emit("breaking", timestampLessStory);
  await handle.flush();
  observedAt = "2026-07-28T14:06:00.000Z";
  emitter.emit("breaking", timestampLessStory);
  await handle.flush();

  const discoveries = jobs
    .listPending()
    .filter((job) => job.kind === "breaking_story_discovery");
  assert.equal(discoveries.length, 1);
  assert.ok(logs.some((line) => /queued=true/.test(line)));
  assert.ok(logs.some((line) => /queued=false/.test(line)));
});
