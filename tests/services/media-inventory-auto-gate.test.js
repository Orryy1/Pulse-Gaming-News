"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  applyMediaInventoryAutoGate,
  getMediaInventoryClass,
  INVENTORY_AUTO_BLOCK_CLASSES,
} = require("../../lib/decision-engine");

// Empirical context (Codex media-inventory report, 2026-04-29):
// 9/10 of recent production stories scored `blog_only` from thin
// visual inventory. The auto-approve pass already gates on script
// quality (PR #67); this gate adds a complementary check on
// media-inventory class so a story can't auto-publish when the
// renderer would have nothing safe to show.
//
// Hard-blocking `blog_only` would silence 90% of Pulse output
// overnight, so this gate is intentionally narrow:
//   reject_visuals → demote auto → review
//   everything else → unaffected (operator still sees the
//   downgrade hint via publisher.js's warn-only logger).

test("inventory gate: reject_visuals story has its auto decision demoted to review", () => {
  const story = {
    id: "fix-rej",
    title: "Stock Portrait Story",
    flair: "News",
    downloaded_images: [
      {
        path: "/c/stock-1.jpg",
        type: "screenshot",
        source: "pexels",
        stock: true,
        likely_human: true,
        url: "https://pexels.com/people/headshot-1",
      },
      {
        path: "/c/stock-2.jpg",
        type: "screenshot",
        source: "unsplash",
        stock: true,
        likely_human: true,
        url: "https://unsplash.com/people/portrait-2",
      },
      {
        path: "/c/stock-3.jpg",
        type: "screenshot",
        source: "pexels",
        stock: true,
        likely_human: true,
      },
    ],
    video_clips: [],
  };
  const score = { decision: "auto", inputs: {} };
  applyMediaInventoryAutoGate(story, score);
  assert.equal(score.decision, "review");
  assert.match(score.media_inventory_auto_block, /reject_visuals/);
  assert.equal(score.inputs.media_inventory_class, "reject_visuals");
});

test("inventory gate: blog_only stays auto (narrow first rollout)", () => {
  const story = {
    id: "fix-blog",
    title: "Quiet Engine Whispers",
    flair: "Rumour",
    downloaded_images: [],
    video_clips: [],
  };
  const score = { decision: "auto", inputs: {} };
  applyMediaInventoryAutoGate(story, score);
  // Inventory class IS recorded — operator can see it in story_scores.
  assert.equal(score.inputs.media_inventory_class, "blog_only");
  // But the gate does not block.
  assert.equal(score.decision, "auto");
  assert.equal(score.media_inventory_auto_block, undefined);
});

test("inventory gate: premium_video story is unaffected", () => {
  const story = {
    id: "fix-prem",
    title: "Iron Saint Console Reveal",
    flair: "Confirmed",
    downloaded_images: [
      { path: "/c/k.jpg", type: "key_art", source: "steam", priority: 95 },
      { path: "/c/h.jpg", type: "hero", source: "steam", priority: 92 },
      { path: "/c/s1.jpg", type: "screenshot", source: "steam", priority: 88 },
      { path: "/c/s2.jpg", type: "screenshot", source: "steam", priority: 86 },
      {
        path: "/c/tf1.jpg",
        type: "trailer_frame",
        source: "trailer",
        priority: 80,
      },
      {
        path: "/c/tf2.jpg",
        type: "trailer_frame",
        source: "trailer",
        priority: 79,
      },
    ],
    video_clips: [
      { path: "/c/announce.mp4", type: "trailer", source: "trailer" },
    ],
  };
  const score = { decision: "auto", inputs: {} };
  applyMediaInventoryAutoGate(story, score);
  assert.equal(score.decision, "auto");
  assert.equal(score.inputs.media_inventory_class, "premium_video");
  assert.equal(score.media_inventory_auto_block, undefined);
});

test("inventory gate: review/defer/reject decisions are not promoted to auto", () => {
  // The gate must only DEMOTE from auto, never PROMOTE the other
  // way. Verify by feeding a reject_visuals story with a non-auto
  // decision and confirming the decision stays put.
  const story = {
    id: "fix-rej2",
    title: "Stock Portrait Story",
    flair: "News",
    downloaded_images: [
      {
        path: "/c/p1.jpg",
        type: "screenshot",
        source: "pexels",
        stock: true,
        likely_human: true,
        url: "https://pexels.com/p/1",
      },
      {
        path: "/c/p2.jpg",
        type: "screenshot",
        source: "pexels",
        stock: true,
        likely_human: true,
        url: "https://pexels.com/p/2",
      },
    ],
    video_clips: [],
  };
  for (const decision of ["review", "defer", "reject"]) {
    const score = { decision, inputs: {} };
    applyMediaInventoryAutoGate(story, score);
    assert.equal(score.decision, decision);
  }
});

test("inventory gate: missing inventory data is a no-op (no crash, no demotion)", () => {
  const score = { decision: "auto", inputs: {} };
  applyMediaInventoryAutoGate({ id: "fix-empty" }, score);
  assert.equal(score.decision, "auto");
});

test("inventory gate: getMediaInventoryClass tolerates malformed stories", () => {
  assert.equal(getMediaInventoryClass(null), null);
  assert.equal(getMediaInventoryClass(undefined), null);
  // Non-throwing: a story object missing fields just classifies as blog_only.
  const cls = getMediaInventoryClass({ id: "x" });
  assert.equal(cls, "blog_only");
});

test("inventory gate: INVENTORY_AUTO_BLOCK_CLASSES starts narrow (reject_visuals only)", () => {
  // Pin the deliberate scope: blog_only is NOT in the block set.
  // When the operator confirms ready to widen, this assertion is the
  // one that flips first.
  assert.equal(INVENTORY_AUTO_BLOCK_CLASSES.has("reject_visuals"), true);
  assert.equal(INVENTORY_AUTO_BLOCK_CLASSES.has("blog_only"), false);
  assert.equal(INVENTORY_AUTO_BLOCK_CLASSES.has("briefing_item"), false);
  assert.equal(INVENTORY_AUTO_BLOCK_CLASSES.has("short_only"), false);
  assert.equal(INVENTORY_AUTO_BLOCK_CLASSES.has("standard_video"), false);
  assert.equal(INVENTORY_AUTO_BLOCK_CLASSES.has("premium_video"), false);
});
