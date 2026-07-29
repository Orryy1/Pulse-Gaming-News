"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const { handlers } = require("../../lib/job-handlers");

function breakingStory(overrides = {}) {
  return {
    id: "breaking-exact-1",
    title: "Xbox confirms a major compatibility update",
    approved: 1,
    full_script:
      "Xbox has confirmed a major compatibility update and explained what changes for players.",
    breaking_score: 130,
    publish_status: "review",
    _extra: JSON.stringify({
      primary_source_url:
        "https://news.xbox.com/en-us/2026/07/28/example/",
      source_evidence_sha256: crypto
        .createHash("sha256")
        .update("verified source")
        .digest("hex"),
      verification_status: "CONFIRMED",
    }),
    ...overrides,
  };
}

test("breaking production handler invokes the renderer pipeline for exactly one governed story", async () => {
  const calls = [];
  const story = breakingStory();
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      channel_id: "pulse-gaming",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
      },
    },
    {
      repos: {
        stories: {
          get(id) {
            return id === story.id ? story : null;
          },
        },
      },
      async produceExactStory(options) {
        calls.push(options);
        return {
          story_ids: options.storyIds,
          render: { candidates: options.storyIds, results: [] },
        };
      },
    },
  );

  assert.deepEqual(calls, [
    {
      storyIds: [story.id],
      laneId: "breaking_short",
    },
  ]);
  assert.equal(result.status, "prepared_for_human_review");
  assert.equal(result.no_publish, true);
  assert.equal(result.story_id, story.id);
});

test("lane production fails closed before rendering when source evidence or format identity is absent", async () => {
  let called = false;
  const story = breakingStory({
    breaking_score: 10,
    _extra: "{}",
  });
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
      },
    },
    {
      repos: { stories: { get: () => story } },
      async produceExactStory() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.deepEqual(result.blockers, [
    "breaking_score_below_80",
    "confirmed_primary_source_required",
    "source_evidence_sha256_required",
  ]);
  assert.equal(result.no_publish, true);
});

test("evergreen production cannot be claimed by a normal breaking-news story", async () => {
  const story = breakingStory();
  const result = await handlers.produce_evergreen_short(
    {
      kind: "produce_evergreen_short",
      payload: {
        lane_id: "evergreen_short",
        story_id: story.id,
      },
    },
    {
      repos: { stories: { get: () => story } },
      async produceExactStory() {
        throw new Error("must_not_run");
      },
    },
  );

  assert.equal(result.status, "held");
  assert.ok(
    result.blockers.includes("evergreen_verdict_format_required"),
  );
});

test("an unapproved story may render only as an explicit non-publication human-review draft", async () => {
  const calls = [];
  const story = breakingStory({ approved: 0 });
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
        publish_authority: false,
        human_review_required: true,
      },
    },
    {
      repos: { stories: { get: () => story } },
      async produceExactStory(options) {
        calls.push(options);
        return { story_ids: options.storyIds };
      },
    },
  );

  assert.equal(result.status, "prepared_for_human_review");
  assert.equal(result.no_publish, true);
  assert.equal(result.human_review_required, true);
  assert.equal(calls.length, 1);
});

test("an unapproved story remains held without the exact local-review safety envelope", async () => {
  let called = false;
  const story = breakingStory({ approved: 0 });
  const result = await handlers.produce_breaking_short(
    {
      kind: "produce_breaking_short",
      payload: {
        lane_id: "breaking_short",
        story_id: story.id,
      },
    },
    {
      repos: { stories: { get: () => story } },
      async produceExactStory() {
        called = true;
      },
    },
  );

  assert.equal(called, false);
  assert.equal(result.status, "held");
  assert.ok(result.blockers.includes("story_not_approved_for_production"));
});
