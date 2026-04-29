"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const digest = require("../../lib/intelligence/render-health-digest");

// 2026-04-29 follow-up to the production render regression.
// assemble.js now stamps render_lane / render_quality_class /
// outro_present / distinct_visual_count on every produced story.
// This file pins the daily Discord digest that turns those stamps into
// a per-day shape of rendering quality — drives the operator's
// decision on flipping BLOCK_THIN_VISUALS=true.

function story(overrides = {}) {
  // Default = a healthy stamped multi-image render finished moments ago.
  return {
    id: `s_${Math.random().toString(36).slice(2, 8)}`,
    exported_at: new Date().toISOString(),
    render_lane: "legacy_multi_image",
    render_quality_class: "standard",
    outro_present: true,
    thumbnail_candidate_present: true,
    distinct_visual_count: 4,
    ...overrides,
  };
}

const oldStamp = () => new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(); // 36h ago

// ── window selection ──────────────────────────────────────────────

test("buildRenderHealthSummary: stories outside window are excluded", () => {
  const stories = [
    story({ exported_at: new Date().toISOString() }),
    story({ exported_at: oldStamp() }),
    story({ exported_at: oldStamp() }),
  ];
  const r = digest.buildRenderHealthSummary(stories, { windowHours: 24 });
  assert.equal(r.total_in_window, 1);
  assert.equal(r.stamped, 1);
});

test("buildRenderHealthSummary: stamp-less rows count as unstamped (excluded from %)", () => {
  const stories = [
    story(),
    story({ render_quality_class: undefined, render_lane: undefined }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.total_in_window, 2);
  assert.equal(r.stamped, 1);
  assert.equal(r.unstamped, 1);
});

// ── quality / lane / outro tallies ────────────────────────────────

test("buildRenderHealthSummary: tallies quality classes correctly", () => {
  const stories = [
    story({ render_quality_class: "premium", distinct_visual_count: 8 }),
    story({ render_quality_class: "premium", distinct_visual_count: 7 }),
    story({ render_quality_class: "standard", distinct_visual_count: 4 }),
    story({ render_quality_class: "fallback", distinct_visual_count: 2 }),
    story({ render_quality_class: "reject", distinct_visual_count: 0 }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.deepEqual(r.quality, {
    premium: 2,
    standard: 1,
    fallback: 1,
    reject: 1,
  });
  assert.equal(r.percentages.quality.premium, 40);
});

test("buildRenderHealthSummary: tallies render lanes including 'other' bucket for unknown", () => {
  const stories = [
    story({ render_lane: "legacy_multi_image" }),
    story({ render_lane: "legacy_multi_image" }),
    story({ render_lane: "legacy_single_image_fallback" }),
    story({ render_lane: "studio_v2_speculative" }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.lane.legacy_multi_image, 2);
  assert.equal(r.lane.legacy_single_image_fallback, 1);
  assert.equal(r.lane.other, 1);
});

test("buildRenderHealthSummary: outro tallies present/missing/unknown", () => {
  const stories = [
    story({ outro_present: true }),
    story({ outro_present: true }),
    story({ outro_present: false }),
    // Stamp-less outro field (stamped quality but missing outro_present).
    story({ outro_present: undefined }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.outro.present, 2);
  assert.equal(r.outro.missing, 1);
  assert.equal(r.outro.unknown, 1);
  assert.equal(r.percentages.outro.present, 50);
});

test("buildRenderHealthSummary: thin_count = stamped stories with distinct_visual_count < 3", () => {
  const stories = [
    story({ distinct_visual_count: 8 }),
    story({ distinct_visual_count: 5 }),
    story({ distinct_visual_count: 2 }),
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 0 }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.thin_count, 3);
  assert.equal(r.percentages.thin, 60);
});

test("buildRenderHealthSummary: visual_count summary returns null fields when no stamped rows", () => {
  const r = digest.buildRenderHealthSummary([]);
  assert.equal(r.stamped, 0);
  assert.equal(r.visual_count.median, null);
  assert.equal(r.visual_count.mean, null);
  assert.equal(r.percentages.thin, 0);
});

test("buildRenderHealthSummary: visual_count returns min/max/median/mean", () => {
  const stories = [
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 3 }),
    story({ distinct_visual_count: 5 }),
    story({ distinct_visual_count: 7 }),
  ];
  const r = digest.buildRenderHealthSummary(stories);
  assert.equal(r.visual_count.min, 1);
  assert.equal(r.visual_count.max, 7);
  assert.equal(r.visual_count.median, 4);
  assert.equal(r.visual_count.mean, 4);
});

// ── markdown rendering ────────────────────────────────────────────

test("formatDigest: empty window emits 'no stamped stories'", () => {
  const r = digest.buildRenderHealthSummary([]);
  const md = digest.formatDigest(r);
  assert.match(md, /No stamped stories in window/);
});

test("formatDigest: high thin-rate triggers 'hold off' operator hint", () => {
  const stories = [
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 1 }),
    story({ distinct_visual_count: 8 }),
  ];
  const md = digest.formatDigest(digest.buildRenderHealthSummary(stories));
  assert.match(md, /Hold off on BLOCK_THIN_VISUALS=true/);
});

test("formatDigest: low thin-rate + sufficient sample triggers 'safe to flip' hint", () => {
  const stories = Array.from({ length: 12 }, () =>
    story({ distinct_visual_count: 6, render_quality_class: "premium" }),
  );
  const md = digest.formatDigest(digest.buildRenderHealthSummary(stories));
  assert.match(md, /Safe to flip BLOCK_THIN_VISUALS=true/);
});

test("formatDigest: surfaces outro misses with the warning glyph", () => {
  const stories = [
    story({ outro_present: true }),
    story({ outro_present: false }),
  ];
  const md = digest.formatDigest(digest.buildRenderHealthSummary(stories));
  assert.match(md, /1 missing/);
});

// ── runRenderHealthDigest end-to-end ───────────────────────────────

test("runRenderHealthDigest: pulls stories via injected db, returns summary + markdown", async () => {
  const fakeDb = {
    async getStories() {
      return [story({ render_quality_class: "premium" }), story()];
    },
  };
  const { summary, markdown } = await digest.runRenderHealthDigest({
    db: fakeDb,
  });
  assert.equal(summary.stamped, 2);
  assert.match(markdown, /Render health/);
});

test("runRenderHealthDigest: db throw is swallowed, returns empty summary + markdown", async () => {
  const fakeDb = {
    async getStories() {
      throw new Error("db down");
    },
  };
  const { summary, markdown } = await digest.runRenderHealthDigest({
    db: fakeDb,
  });
  assert.equal(summary.stamped, 0);
  assert.match(markdown, /No stamped stories/);
});
