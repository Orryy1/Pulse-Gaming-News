"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const r = require("../../lib/ops/reclassify-report");

// 2026-04-29 audit P0 #5: read-only quarantine candidate report.
// Pins the per-story decision logic, the summary tally, and the
// markdown formatter shape.

const cleanTopicality = () => ({ decision: "auto", reasons: [] });
const reviewTopicality = () => ({ decision: "review", reasons: ["weak"] });
const rejectTopicality = () => ({
  decision: "reject",
  reasons: ["off_brand_entertainment"],
});
const cleanHygiene = () => ({ severity: "clean", issues: [] });
const failHygiene = () => ({
  severity: "fail",
  issues: ["raw_html_entity_after_normalise"],
});

// ── evaluateStoryForQuarantine ────────────────────────────────────

test("evaluateStoryForQuarantine: clean story returns null", () => {
  const v = r.evaluateStoryForQuarantine(
    {
      id: "ok",
      title: "Test",
      full_script: "All clean.",
      distinct_visual_count: 5,
    },
    { topicalityFn: cleanTopicality, hygieneFn: cleanHygiene },
  );
  assert.equal(v, null);
});

test("evaluateStoryForQuarantine: topicality reject → severity high", () => {
  const v = r.evaluateStoryForQuarantine(
    { id: "off", title: "TV show review", distinct_visual_count: 4 },
    { topicalityFn: rejectTopicality, hygieneFn: cleanHygiene },
  );
  assert.ok(v);
  assert.equal(v.severity, "high");
  assert.ok(v.reasons.includes("topicality_reject"));
});

test("evaluateStoryForQuarantine: topicality review only → severity review", () => {
  const v = r.evaluateStoryForQuarantine(
    { id: "rev", title: "Adjacent", distinct_visual_count: 4 },
    { topicalityFn: reviewTopicality, hygieneFn: cleanHygiene },
  );
  assert.ok(v);
  assert.equal(v.severity, "review");
});

test("evaluateStoryForQuarantine: text hygiene fail → severity high", () => {
  const v = r.evaluateStoryForQuarantine(
    {
      id: "h",
      title: "Test",
      full_script: "Broken &nope; entity",
      distinct_visual_count: 4,
    },
    { topicalityFn: cleanTopicality, hygieneFn: failHygiene },
  );
  assert.ok(v);
  assert.equal(v.severity, "high");
  assert.ok(v.reasons.some((x) => x.startsWith("text_hygiene_fail")));
});

test("evaluateStoryForQuarantine: zero visuals → flagged severe", () => {
  const v = r.evaluateStoryForQuarantine(
    { id: "z", title: "Story", distinct_visual_count: 0 },
    { topicalityFn: cleanTopicality, hygieneFn: cleanHygiene },
  );
  assert.ok(v);
  assert.ok(v.reasons.includes("zero_visuals_used_composite"));
  assert.equal(v.severity, "high");
});

test("evaluateStoryForQuarantine: surfaces has_been_published flag", () => {
  const v = r.evaluateStoryForQuarantine(
    {
      id: "pub",
      title: "Story",
      youtube_post_id: "yt1",
      distinct_visual_count: 0,
    },
    { topicalityFn: cleanTopicality, hygieneFn: cleanHygiene },
  );
  assert.ok(v);
  assert.equal(v.has_been_published, true);
});

test("evaluateStoryForQuarantine: stories with no public-facing fields don't error", () => {
  const v = r.evaluateStoryForQuarantine(
    { id: "minimal" },
    { topicalityFn: cleanTopicality, hygieneFn: cleanHygiene },
  );
  // Clean story with no script and no visual count → null
  assert.equal(v, null);
});

// ── buildReclassifyReport orchestration ─────────────────────────────

test("buildReclassifyReport: tallies summary across mixed stores", async () => {
  const stories = [
    { id: "ok", title: "Game launch", distinct_visual_count: 5 },
    { id: "rej1", title: "TV show", distinct_visual_count: 4 },
    { id: "rev1", title: "Maybe", distinct_visual_count: 4 },
    { id: "zero", title: "Story", distinct_visual_count: 0 },
  ];
  const topicalityFn = (story) => {
    if (story.id === "rej1") return rejectTopicality();
    if (story.id === "rev1") return reviewTopicality();
    return cleanTopicality();
  };
  const report = await r.buildReclassifyReport({
    db: {
      async getStories() {
        return stories;
      },
    },
    topicality: topicalityFn,
    hygiene: cleanHygiene,
  });
  assert.equal(report.scanned, 4);
  assert.equal(report.quarantine_candidates.length, 3);
  assert.equal(report.summary.reject_topicality, 1);
  assert.equal(report.summary.review_topicality, 1);
  assert.equal(report.summary.zero_visuals, 1);
});

test("buildReclassifyReport: empty store returns clean report", async () => {
  const report = await r.buildReclassifyReport({
    db: {
      async getStories() {
        return [];
      },
    },
    topicality: cleanTopicality,
    hygiene: cleanHygiene,
  });
  assert.equal(report.scanned, 0);
  assert.deepEqual(report.quarantine_candidates, []);
});

test("buildReclassifyReport: db throw returns scanned=0, no candidates", async () => {
  const report = await r.buildReclassifyReport({
    db: {
      async getStories() {
        throw new Error("db down");
      },
    },
    topicality: cleanTopicality,
    hygiene: cleanHygiene,
  });
  assert.equal(report.scanned, 0);
});

// ── formatReclassifyMarkdown ──────────────────────────────────────

test("formatReclassifyMarkdown: clean store renders 'No quarantine candidates'", () => {
  const md = r.formatReclassifyMarkdown({
    scanned: 5,
    quarantine_candidates: [],
    summary: {
      reject_topicality: 0,
      review_topicality: 0,
      text_hygiene_fail: 0,
      zero_visuals: 0,
      already_published: 0,
    },
  });
  assert.match(md, /No quarantine candidates/);
});

test("formatReclassifyMarkdown: surfaces 'already published' marker on hot rows", () => {
  const md = r.formatReclassifyMarkdown({
    scanned: 1,
    quarantine_candidates: [
      {
        id: "pub",
        title: "Already shipped",
        flair: null,
        source_type: null,
        reasons: ["zero_visuals_used_composite"],
        topicality_decision: "auto",
        severity: "high",
        has_been_published: true,
      },
    ],
    summary: {
      reject_topicality: 0,
      review_topicality: 0,
      text_hygiene_fail: 0,
      zero_visuals: 1,
      already_published: 1,
    },
  });
  assert.match(md, /already published/);
  assert.match(md, /zero_visuals_used_composite/);
});

test("formatReclassifyMarkdown: caps top candidates at 20", () => {
  const candidates = Array.from({ length: 50 }, (_, i) => ({
    id: `s${i}`,
    title: `Story ${i}`,
    reasons: ["topicality_review"],
    severity: "review",
    has_been_published: false,
  }));
  const md = r.formatReclassifyMarkdown({
    scanned: 50,
    quarantine_candidates: candidates,
    summary: {
      reject_topicality: 0,
      review_topicality: 50,
      text_hygiene_fail: 0,
      zero_visuals: 0,
      already_published: 0,
    },
  });
  // Should mention only 20 by id
  const occurrences = (md.match(/\bs\d+\b/g) || []).length;
  assert.equal(occurrences, 20);
});
