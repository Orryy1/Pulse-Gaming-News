"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pr = require("../../lib/ops/publish-readiness");
const TOOL_PATH = path.resolve(__dirname, "..", "..", "tools", "publish-readiness.js");

// 2026-04-30 mission: ops:publish-readiness must give one
// GREEN/AMBER/RED verdict per pillar combination, never mutate
// production, and never silently mark unknown data as green.
//
// These tests pin the verdict ladder, the unknown handling,
// and the markdown formatter shape. The full async pillars are
// integration-tested separately — here we focus on the pure
// orchestration logic that isn't easily exercised end-to-end
// without a running DB + Railway.

// ── dominantVerdict ──────────────────────────────────────────────

test("dominantVerdict: red wins over everything", () => {
  assert.equal(pr.dominantVerdict(["green", "amber", "red"]), "red");
  assert.equal(pr.dominantVerdict(["green", "red", "unknown"]), "red");
});

test("dominantVerdict: amber wins over green when no red", () => {
  assert.equal(pr.dominantVerdict(["green", "amber"]), "amber");
});

test("dominantVerdict: unknown alone returns unknown (never silent green)", () => {
  assert.equal(pr.dominantVerdict(["unknown"]), "unknown");
  assert.equal(pr.dominantVerdict(["unknown", "unknown"]), "unknown");
});

test("dominantVerdict: mix of unknown + green stays green (some signal IS positive)", () => {
  assert.equal(pr.dominantVerdict(["green", "unknown"]), "green");
});

test("dominantVerdict: all green stays green", () => {
  assert.equal(pr.dominantVerdict(["green", "green", "green"]), "green");
});

// ── PILLAR_NAMES contract ────────────────────────────────────────

test("PILLAR_NAMES: 20 pillars (matches mission spec)", () => {
  assert.equal(pr.PILLAR_NAMES.length, 20);
});

test("PILLAR_NAMES: includes the audit-flagged external blockers", () => {
  assert.ok(pr.PILLAR_NAMES.includes("tiktok_external_block"));
  assert.ok(pr.PILLAR_NAMES.includes("facebook_reel_eligibility"));
  assert.ok(pr.PILLAR_NAMES.includes("facebook_card_fallback"));
});

test("PILLAR_NAMES: includes the security + docs drift pillars", () => {
  assert.ok(pr.PILLAR_NAMES.includes("security_blockers"));
  assert.ok(pr.PILLAR_NAMES.includes("docs_drift"));
});

test("tools/publish-readiness.js loads .env for local operator runs", () => {
  const src = fs.readFileSync(TOOL_PATH, "utf8");
  assert.match(src, /require\(["']dotenv["']\)\.config\(\{\s*override:\s*true\s*\}\)/);
});

// ── formatPublishReadinessMarkdown ───────────────────────────────

test("formatPublishReadinessMarkdown: green report uses green glyph", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "green",
    pillars: { foo: { verdict: "green" } },
    blockers: [],
    advisory: [],
    recently_improved: [],
    next_action: "Publish normally.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /🟢/);
  assert.match(md, /GREEN/);
  assert.match(md, /Publish normally/);
});

test("formatPublishReadinessMarkdown: red report includes blocking section", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "red",
    pillars: {
      security_blockers: {
        verdict: "red",
        reason: "token_log_pattern_re_introduced",
      },
    },
    blockers: ["security_blockers: token leak detected"],
    advisory: [],
    recently_improved: [],
    next_action: "Do not publish until red blockers cleared.",
    story_count: 1,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /🔴/);
  assert.match(md, /Blocking/);
  assert.match(md, /Do not publish/);
});

test("formatPublishReadinessMarkdown: amber report includes advisory section", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "amber",
    pillars: { tiktok: { verdict: "amber", reason: "externally_blocked" } },
    blockers: [],
    advisory: ["tiktok_external_block: externally_blocked"],
    recently_improved: [],
    next_action: "Publish possible. Watch advisory list.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /🟡/);
  assert.match(md, /Advisory/);
});

test("formatPublishReadinessMarkdown: unknown verdict surfaces in pillar list", () => {
  const md = pr.formatPublishReadinessMarkdown({
    overall_verdict: "amber",
    pillars: {
      queue_health: { verdict: "unknown", reason: "module_unavailable" },
    },
    blockers: [],
    advisory: ["queue_health: unknown"],
    recently_improved: [],
    next_action: "Publish possible.",
    story_count: 5,
    generated_at: "2026-04-30T22:00:00Z",
  });
  assert.match(md, /unknown/);
  assert.match(md, /⚪/);
});

// ── buildPublishReadinessReport with empty DB ────────────────────

test("buildPublishReadinessReport: empty store does not crash, returns at least one pillar", async () => {
  // We use a fake DB and let the real pillars run. They should
  // gracefully degrade to amber/unknown, never throw.
  const report = await pr.buildPublishReadinessReport({
    db: {
      async getStories() {
        return [];
      },
    },
    env: {},
  });
  assert.ok(typeof report.overall_verdict === "string");
  assert.ok(
    ["green", "amber", "red", "unknown"].includes(report.overall_verdict),
  );
  assert.equal(report.story_count, 0);
  assert.ok(typeof report.pillars === "object");
  assert.equal(Object.keys(report.pillars).length, 20);
  assert.ok(typeof report.next_action === "string");
});

test("buildPublishReadinessReport: db throw degrades gracefully (no throw)", async () => {
  const report = await pr.buildPublishReadinessReport({
    db: {
      async getStories() {
        throw new Error("db down");
      },
    },
    env: {},
  });
  assert.ok(typeof report.overall_verdict === "string");
  assert.equal(report.story_count, 0);
});
