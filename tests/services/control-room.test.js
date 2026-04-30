"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const cr = require("../../lib/ops/control-room");

// 2026-04-29 audit P0 #6: single operator publish-readiness check.
// This pins the verdict ladder, the dependency-injected pillars
// surface, and the markdown formatter so an operator can trust the
// rolled-up green/amber/red signal.

// ── dominantVerdict ──────────────────────────────────────────────

test("dominantVerdict: red wins over everything", () => {
  assert.equal(cr.dominantVerdict(["green", "amber", "red"]), "red");
  assert.equal(cr.dominantVerdict(["green", "red"]), "red");
});

test("dominantVerdict: amber wins when no red present", () => {
  assert.equal(cr.dominantVerdict(["green", "amber", "green"]), "amber");
});

test("dominantVerdict: all green stays green", () => {
  assert.equal(cr.dominantVerdict(["green", "green", "green"]), "green");
});

// ── evaluateRecentPublish ────────────────────────────────────────

test("evaluateRecentPublish: empty store is amber, not red", () => {
  const r = cr.evaluateRecentPublish([]);
  assert.equal(r.verdict, "amber");
  assert.match(r.reason, /no_stories/);
});

test("evaluateRecentPublish: no published rows is amber", () => {
  const r = cr.evaluateRecentPublish([
    { id: "x", title: "Unpublished", created_at: new Date().toISOString() },
  ]);
  assert.equal(r.verdict, "amber");
});

test("evaluateRecentPublish: recent (within 48h) → green", () => {
  const recent = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const r = cr.evaluateRecentPublish([
    {
      id: "p",
      title: "Recent",
      youtube_post_id: "yt",
      published_at: recent,
    },
  ]);
  assert.equal(r.verdict, "green");
});

test("evaluateRecentPublish: stale (> 48h) → amber with reason", () => {
  const stale = new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString();
  const r = cr.evaluateRecentPublish([
    {
      id: "s",
      title: "Stale",
      youtube_post_id: "yt",
      published_at: stale,
    },
  ]);
  assert.equal(r.verdict, "amber");
  assert.match(r.reason, /last_publish_/);
});

// ── buildControlRoomReport: full orchestration with mocks ────────

function mockPillar(verdict, reason) {
  return async () => ({ ok: true, verdict, reason });
}

test("buildControlRoomReport: all green → verdict green, no reasons", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [];
      },
    },
    systemDoctor: mockPillar("green"),
    platformStatus: mockPillar("green"),
    mediaVerify: mockPillar("green"),
    renderHealth: mockPillar("green"),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });
  assert.equal(report.verdict, "green");
  assert.deepEqual(report.reasons, []);
});

test("buildControlRoomReport: any red pillar → verdict red", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [];
      },
    },
    systemDoctor: mockPillar("green"),
    platformStatus: mockPillar("red", "no_platforms_configured"),
    mediaVerify: mockPillar("green"),
    renderHealth: mockPillar("green"),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });
  assert.equal(report.verdict, "red");
  assert.ok(report.reasons.some((r) => r.includes("platform_status=red")));
});

test("buildControlRoomReport: amber pillars elevate verdict to amber", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [];
      },
    },
    systemDoctor: mockPillar("green"),
    platformStatus: mockPillar("green"),
    mediaVerify: mockPillar("amber", "missing_paths"),
    renderHealth: mockPillar("green"),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });
  assert.equal(report.verdict, "amber");
});

test("buildControlRoomReport: high thin-rate triggers operator hint", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [];
      },
    },
    systemDoctor: mockPillar("green"),
    platformStatus: mockPillar("green"),
    mediaVerify: mockPillar("green"),
    renderHealth: async () => ({
      ok: true,
      verdict: "red",
      raw: { percentages: { thin: 70 }, stamped: 12, outro: { missing: 0 } },
    }),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });
  assert.ok(
    report.recommendations.some((r) =>
      /Hold off enabling BLOCK_THIN_VISUALS/.test(r),
    ),
  );
});

test("buildControlRoomReport: low thin-rate + sample triggers safe-to-flip hint", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [];
      },
    },
    systemDoctor: mockPillar("green"),
    platformStatus: mockPillar("green"),
    mediaVerify: mockPillar("green"),
    renderHealth: async () => ({
      ok: true,
      verdict: "green",
      raw: { percentages: { thin: 5 }, stamped: 14, outro: { missing: 0 } },
    }),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });
  assert.ok(
    report.recommendations.some((r) =>
      /Safe to flip BLOCK_THIN_VISUALS/.test(r),
    ),
  );
});

// ── formatControlRoomMarkdown ────────────────────────────────────

test("formatControlRoomMarkdown: green report uses green glyph and no reasons section", () => {
  const md = cr.formatControlRoomMarkdown({
    verdict: "green",
    reasons: [],
    recommendations: [],
    pillars: {
      system_doctor: { verdict: "green" },
      platform_status: { verdict: "green" },
    },
    story_count: 5,
    generated_at: "2026-04-29T20:00:00Z",
  });
  assert.match(md, /Control Room/);
  assert.match(md, /GREEN/);
  assert.doesNotMatch(md, /\*\*Reasons\*\*/);
});

test("formatControlRoomMarkdown: red report includes reasons section", () => {
  const md = cr.formatControlRoomMarkdown({
    verdict: "red",
    reasons: ["platform_status=red: oauth expired"],
    recommendations: [],
    pillars: { platform_status: { verdict: "red", reason: "oauth_expired" } },
    story_count: 1,
    generated_at: "2026-04-29T20:00:00Z",
  });
  assert.match(md, /\*\*Reasons\*\*/);
  assert.match(md, /platform_status=red/);
});
