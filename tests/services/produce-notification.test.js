"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildProduceCompletionSummary,
  shouldSendProduceCompletionDiscord,
} = require("../../lib/ops/produce-notification");

test("produce notification suppresses no-op historical backlog lists", () => {
  const beforeStories = [
    { id: "old_a", exported_path: "output/final/old_a.mp4" },
    { id: "old_b", exported_path: "output/final/old_b.mp4" },
  ];
  const afterStories = [
    { id: "old_a", exported_path: "output/final/old_a.mp4" },
    { id: "old_b", exported_path: "output/final/old_b.mp4" },
  ];

  const summary = buildProduceCompletionSummary({
    beforeStories,
    afterStories,
    recentlyTouchedExportPaths: [],
  });

  assert.equal(summary.shouldNotifyDiscord, false);
  assert.match(summary.message, /0 new\/updated exports this run/);
  assert.match(summary.message, /2 total ready/);
  assert.doesNotMatch(summary.message, /old_a\.mp4\noutput\\\/final\\\/old_b\.mp4/);
});

test("produce notification reports only new or touched exports from this run", () => {
  const beforeStories = [
    { id: "old_a", exported_path: "output/final/old_a.mp4" },
    { id: "old_b", exported_path: "output/final/old_b.mp4" },
  ];
  const afterStories = [
    { id: "old_a", exported_path: "output/final/old_a.mp4" },
    { id: "old_b", exported_path: "output/final/old_b.mp4" },
    { id: "new_c", exported_path: "output/final/new_c.mp4" },
  ];

  const summary = buildProduceCompletionSummary({
    beforeStories,
    afterStories,
    recentlyTouchedExportPaths: ["output/final/old_b.mp4"],
    maxLines: 5,
  });

  assert.equal(summary.shouldNotifyDiscord, true);
  assert.equal(summary.changedExports.length, 2);
  assert.match(summary.message, /2 new\/updated exports this run \(3 total ready\)/);
  assert.match(summary.message, /output\/final\/old_b\.mp4/);
  assert.match(summary.message, /output\/final\/new_c\.mp4/);
  assert.doesNotMatch(summary.message, /output\/final\/old_a\.mp4/);
});

test("produce notification caps long current-run lists", () => {
  const afterStories = Array.from({ length: 6 }, (_, index) => ({
    id: `story_${index}`,
    exported_path: `output/final/story_${index}.mp4`,
  }));

  const summary = buildProduceCompletionSummary({
    beforeStories: [],
    afterStories,
    maxLines: 3,
  });

  assert.equal(summary.shouldNotifyDiscord, true);
  assert.match(summary.message, /6 new\/updated exports this run \(6 total ready\)/);
  assert.match(summary.message, /\+3 more/);
  assert.match(summary.message, /story_0\.mp4/);
  assert.match(summary.message, /story_2\.mp4/);
  assert.doesNotMatch(summary.message, /story_3\.mp4/);
});

test("manual produce Discord notification is opt-in", () => {
  const summary = { shouldNotifyDiscord: true };

  assert.equal(shouldSendProduceCompletionDiscord(summary, {}), false);
  assert.equal(
    shouldSendProduceCompletionDiscord(summary, { PRODUCE_NOTIFY_DISCORD: "true" }),
    true,
  );
});

test("manual produce no-op Discord notification also requires opt-in", () => {
  const summary = { shouldNotifyDiscord: false };

  assert.equal(
    shouldSendProduceCompletionDiscord(summary, { PRODUCE_NOTIFY_NOOP: "true" }),
    false,
  );
  assert.equal(
    shouldSendProduceCompletionDiscord(summary, {
      PRODUCE_NOTIFY_DISCORD: "true",
      PRODUCE_NOTIFY_NOOP: "true",
    }),
    true,
  );
});
