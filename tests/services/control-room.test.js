"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cr = require("../../lib/ops/control-room");

const ROOT = path.resolve(__dirname, "..", "..");

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

test("evaluateRecentPublish: published row without timestamp does not invent a huge stall age", () => {
  const r = cr.evaluateRecentPublish([
    {
      id: "missing_ts",
      title: "Published Somewhere",
      youtube_post_id: "yt",
    },
  ]);
  assert.equal(r.verdict, "amber");
  assert.equal(r.reason, "published_row_missing_timestamp");
  assert.doesNotMatch(r.reason, /last_publish_\d+h_ago/);
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
    strictDryRun: mockPillar("green"),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });
  assert.equal(report.verdict, "green");
  assert.deepEqual(report.reasons, []);
});

test("buildControlRoomReport: pass verdict aliases are normalised to green", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [];
      },
    },
    systemDoctor: mockPillar("pass"),
    platformStatus: mockPillar("green"),
    mediaVerify: mockPillar("pass"),
    renderHealth: mockPillar("green"),
    recentPublish: () => ({ ok: true, verdict: "green" }),
    strictDryRun: () => ({ ok: true, verdict: "green" }),
  });
  assert.equal(report.verdict, "green");
  assert.deepEqual(report.reasons, []);
});

test("buildControlRoomReport: strict dry-run readiness is surfaced separately from live DB publish debt", async () => {
  const dryRunPlan = {
    overall_verdict: "AMBER",
    summary: {
      story_count: 30,
      ready_story_count: 12,
      blocked_story_count: 0,
      deferred_platform_action_count: 48,
      enabled_human_review_action_count: 36,
      live_publish_allowed_action_count: 0,
      scheduler_preflight_required: true,
      scheduler_preflight_report_loaded: true,
      preflight_checked_story_count: 12,
    },
  };
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [
          {
            id: "bridge_ready_but_live_row_has_no_ts",
            title: "Bridge Ready",
            youtube_post_id: "yt",
          },
        ];
      },
    },
    systemDoctor: mockPillar("pass"),
    platformStatus: mockPillar("amber", "disabled_platforms"),
    mediaVerify: mockPillar("pass"),
    renderHealth: mockPillar("green"),
    recentPublish: cr.evaluateRecentPublish,
    strictDryRun: () => cr.evaluateStrictDryRunPlan(dryRunPlan),
  });

  assert.equal(report.verdict, "amber");
  assert.equal(report.pillars.strict_dry_run.verdict, "amber");
  assert.equal(report.pillars.strict_dry_run.ready_story_count, 12);
  assert.equal(report.pillars.recent_publish.reason, "published_row_missing_timestamp");
  assert.ok(
    report.recommendations.some((line) => /12 ready bridge candidates through HUMAN_REVIEW/.test(line)),
  );
  assert.ok(
    report.recommendations.every((line) => !/publishing has been stalled/.test(line)),
  );
});

test("buildControlRoomReport: live DB media debt is labelled separately when bridge candidates are ready", async () => {
  const report = await cr.buildControlRoomReport({
    db: {
      async getStories() {
        return [{ id: "legacy_live_debt" }];
      },
    },
    systemDoctor: mockPillar("green"),
    platformStatus: mockPillar("green"),
    mediaVerify: mockPillar("amber", "legacy_media_missing"),
    renderHealth: mockPillar("green"),
    strictDryRun: () => ({
      ok: false,
      verdict: "amber",
      reason: "platform_actions_deferred_until_enabled",
      ready_story_count: 12,
      blocked_story_count: 0,
      deferred_platform_action_count: 48,
      live_publish_allowed_action_count: 0,
    }),
    recentPublish: () => ({ ok: true, verdict: "green" }),
  });

  assert.ok(report.reasons.some((line) => line.startsWith("live_db_media_verify=amber")));
  assert.ok(
    report.recommendations.some((line) =>
      /Live DB media debt is separate from strict dry-run bridge readiness/.test(line),
    ),
  );
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
    strictDryRun: () => ({ ok: true, verdict: "green" }),
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

test("buildControlRoomReport: low thin-rate + sample triggers approval-ready pilot hint", async () => {
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
      /BLOCK_THIN_VISUALS=true is approval-ready/.test(r),
    ),
  );
  assert.ok(
    report.recommendations.some((r) => /changes live publish gating/.test(r)),
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

test("formatControlRoomMarkdown: strict dry-run counts are labelled separately from live DB rows", () => {
  const md = cr.formatControlRoomMarkdown({
    verdict: "amber",
    reasons: [],
    recommendations: [],
    story_count: 10,
    live_db_story_count: 10,
    strict_dry_run_summary: {
      story_count: 30,
      ready_story_count: 12,
      blocked_story_count: 0,
      deferred_platform_action_count: 48,
      live_publish_allowed_action_count: 0,
    },
    pillars: {
      strict_dry_run: { verdict: "amber", reason: "platform_actions_deferred_until_enabled" },
      recent_publish: { verdict: "amber", reason: "published_row_missing_timestamp" },
    },
    generated_at: "2026-05-30T22:00:00Z",
  });
  assert.match(md, /Live DB stories: 10/);
  assert.match(md, /Strict dry-run: 12 ready \/ 0 blocked \/ 48 deferred platform actions/);
  assert.match(md, /Live publish allowed: 0/);
  assert.doesNotMatch(md, /Stories in DB: 10/);
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

test("ops:control-room command loads dotenv before DB-backed reporting", () => {
  const tool = fs.readFileSync(path.join(ROOT, "tools", "control-room.js"), "utf8");
  assert.match(tool, /require\("dotenv"\)\.config/);
  assert.match(tool, /PULSE_SKIP_DOTENV/);
});
