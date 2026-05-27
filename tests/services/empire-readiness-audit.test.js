const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildEmpireReadinessAudit,
  renderEmpireReadinessMarkdown,
} = require("../../lib/empire-readiness-audit");
const {
  REQUIRED_REFERENCE_PACKS,
} = require("../../lib/gold-standard-reference-library");

function library() {
  return {
    workbook_path: "C:/Users/MORR/Downloads/gold_standards_reference_library.xlsx",
    summary: {
      total_references: 50,
      core_legal_rule:
        "Treat every entry as reference-only unless a specific asset has verified reuse rights.",
    },
    references: Array.from({ length: 50 }, (_, index) => ({
      source_channel: `Reference ${index + 1}`,
    })),
    codex_rules: Array.from({ length: 12 }, (_, index) => ({
      rule_id: `GATE_${index + 1}`,
    })),
    reference_packs: REQUIRED_REFERENCE_PACKS.map((pack) => ({ pack })),
  };
}

test("empire audit turns the current Pulse weaknesses into hard workstreams", () => {
  const audit = buildEmpireReadinessAudit({
    generatedAt: "2026-05-20T01:30:00.000Z",
    library: library(),
    retentionBaseline: {
      views_28d: 19300,
      watch_hours_28d: 58,
      avg_watch_seconds_estimate: 10.8,
      stayed_to_watch: 39.3,
      swiped_away: 60.7,
      subscriber_conversion_estimate: 0.041,
      top_short_ceiling_current: 900,
    },
    renderHealthSummary: {
      stamped: 7,
      quality: { premium: 0, standard: 2, fallback: 5, reject: 0 },
      lane: { legacy_multi_image: 7, legacy_single_image_fallback: 0, other: 0 },
      percentages: {
        quality: { premium: 0, standard: 29, fallback: 71, reject: 0 },
        lane: { legacy_multi_image: 100, legacy_single_image_fallback: 0, other: 0 },
        thin: 71,
      },
      thin_count: 5,
      visual_count: { median: 2, mean: 2, min: 1, max: 4 },
    },
    v4SourceDeficit: {
      summary: {
        blocked_stories: 1,
        v4_ready_stories: 0,
        direct_media_ready: 1,
        licence_or_operator_required: 6,
        direct_media_missing: 1,
      },
    },
    v4MotionPacks: {
      summary: {
        ready: 0,
        blocked: 1,
        clips: 1,
        rejected_candidates: 5,
      },
    },
    revenuePathDigest: {
      totals: {
        paths: 50,
        pass: 18,
        review: 29,
        blocked_for_compliance: 3,
        average_revenue_path_score: 61,
      },
    },
  });

  assert.equal(audit.verdict, "build_not_scale_ready");
  assert.ok(audit.scores.gold_standard_coverage_score >= 95);
  assert.ok(audit.scores.motion_readiness_score < 35);
  assert.ok(audit.scores.retention_score < 45);
  assert.ok(audit.blockers.includes("shorts_retention_below_first_target"));
  assert.ok(audit.blockers.includes("v4_motion_blocked_by_safe_source_shortage"));
  assert.ok(audit.blockers.includes("render_health_has_zero_premium_renders"));
  assert.ok(audit.blockers.includes("revenue_paths_need_review_before_scaling"));
  assert.equal(audit.workstreams[0].id, "v4_motion_source_acquisition");
  assert.ok(
    audit.workstreams.some((item) => item.reference_packs.includes("Pacing / Retention / Impact")),
  );
  assert.equal(audit.safety.no_publish_side_effects, true);
});

test("empire audit can recognise a scale candidate without fantasy revenue claims", () => {
  const audit = buildEmpireReadinessAudit({
    library: library(),
    retentionBaseline: {
      avg_watch_seconds_estimate: 22,
      stayed_to_watch: 54,
      swiped_away: 46,
      subscriber_conversion_estimate: 0.14,
      top_short_ceiling_current: 12000,
    },
    renderHealthSummary: {
      stamped: 16,
      quality: { premium: 12, standard: 4, fallback: 0, reject: 0 },
      lane: { legacy_multi_image: 0, legacy_single_image_fallback: 0, other: 16 },
      percentages: {
        quality: { premium: 75, standard: 25, fallback: 0, reject: 0 },
        lane: { legacy_multi_image: 0, legacy_single_image_fallback: 0, other: 100 },
        thin: 0,
      },
      thin_count: 0,
      visual_count: { median: 7, mean: 7.4, min: 6, max: 10 },
    },
    v4SourceDeficit: {
      summary: {
        blocked_stories: 0,
        v4_ready_stories: 4,
        direct_media_ready: 8,
        licence_or_operator_required: 0,
        direct_media_missing: 0,
      },
    },
    v4MotionPacks: {
      summary: {
        ready: 4,
        blocked: 0,
        clips: 32,
        rejected_candidates: 1,
      },
    },
    revenuePathDigest: {
      totals: {
        paths: 40,
        pass: 34,
        review: 6,
        blocked_for_compliance: 0,
        average_revenue_path_score: 84,
      },
    },
  });

  assert.equal(audit.verdict, "scale_candidate");
  assert.equal(audit.blockers.length, 0);
  assert.ok(audit.scores.empire_readiness_score >= 80);
  assert.equal(audit.safety.no_fantasy_revenue_projection, true);
});

test("empire audit markdown is operator-readable and benchmark-linked", () => {
  const audit = buildEmpireReadinessAudit({
    generatedAt: "2026-05-20T01:30:00.000Z",
    library: library(),
    retentionBaseline: { stayed_to_watch: 39.3, avg_watch_seconds_estimate: 10.8 },
    v4MotionPacks: { summary: { ready: 0, blocked: 1, clips: 1 } },
  });
  const markdown = renderEmpireReadinessMarkdown(audit);

  assert.match(markdown, /# Pulse Empire Readiness Audit/);
  assert.match(markdown, /Verdict: build_not_scale_ready/);
  assert.match(markdown, /Gold references: 50/);
  assert.match(markdown, /V4 motion source acquisition/);
  assert.doesNotMatch(markdown, /guaranteed/i);
  assert.doesNotMatch(markdown, /loads of money/i);
});
