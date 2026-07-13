"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildLongformOperationsReport,
} = require("../../lib/ops/longform-operations");
const { runLongformOperations } = require("../../tools/longform-operations");

test("longform operations preserves blockers and does not promote operator review to GREEN", () => {
  const report = buildLongformOperationsReport({
    generatedAt: "2026-07-12T22:00:00.000Z",
    weeklyReport: {
      verdict: "NOT_READY",
      quality_report: {
        verdict: "fail",
        blockers: ["duration_under_10_minutes", "source_pack_incomplete"],
      },
      next_action: "Rebuild the weekly roundup.",
    },
    releaseRadarPackage: {
      format: "monthly_release_radar",
      month_label: "July 2026",
      readiness: {
        verdict: "READY_FOR_OPERATOR_REVIEW",
        operator_review_required: true,
        ready_candidate_count: 10,
        blocked_candidate_count: 0,
        hard_blockers: [],
      },
      affiliate_plan: {
        disclosure_required: true,
        disclosure_copy: "Affiliate links may earn a commission.",
        links: [{ url: "https://example.test/game?tag=pulse-21" }],
      },
    },
    releaseRadarReadme: "# July 2026 Release Radar\n\nOperator review required.",
  });

  assert.equal(report.verdict, "RED");
  assert.deepEqual(report.ready_formats.map((item) => item.format_id), [
    "monthly_release_radar",
  ]);
  assert.equal(report.ready_formats[0].status, "AMBER");
  assert.equal(report.blocked_formats[0].format_id, "weekly_roundup");
  assert.deepEqual(report.blocked_formats[0].blockers, [
    "duration_under_10_minutes",
    "source_pack_incomplete",
  ]);
  assert.equal(report.next_production_priority.format_id, "weekly_roundup");
  assert.equal(report.revenue_readiness.status, "AMBER");
  assert.equal(report.safety.safe_to_publish, false);
});

test("longform operations includes optional portfolio formats in priorities", () => {
  const report = buildLongformOperationsReport({
    weeklyReport: {
      verdict: "READY_FOR_OPERATOR_REVIEW",
      quality_report: { verdict: "pass", blockers: [] },
    },
    releaseRadarPackage: {
      format: "monthly_release_radar",
      readiness: { verdict: "GREEN", hard_blockers: [] },
      affiliate_plan: {
        disclosure_required: false,
        links: [{ url: "https://example.test/radar" }],
      },
    },
    releaseRadarReadme: "# Release Radar",
    portfolioReport: {
      formats: [
        {
          format_id: "game_deep_dive",
          label: "Game Deep Dive",
          verdict: "GREEN",
          blockers: [],
        },
        {
          format_id: "studio_documentary",
          label: "Studio Documentary",
          verdict: "RED",
          blockers: ["rights_clearance_missing"],
          next_action: "Clear documentary footage rights.",
        },
      ],
    },
  });

  assert.equal(report.verdict, "RED");
  assert.ok(report.ready_formats.some((item) => item.format_id === "game_deep_dive"));
  assert.deepEqual(report.blocked_formats.map((item) => item.format_id), [
    "studio_documentary",
  ]);
  assert.deepEqual(report.exact_blockers, ["rights_clearance_missing"]);
  assert.equal(report.next_production_priority.format_id, "studio_documentary");
  assert.equal(report.portfolio.provided, true);
});

test("longform operations treats a definition-only portfolio as a catalogue, not failed production", () => {
  const report = buildLongformOperationsReport({
    weeklyReport: {
      verdict: "GREEN",
      quality_report: { verdict: "pass", blockers: [] },
    },
    releaseRadarPackage: {
      format: "monthly_release_radar",
      readiness: { verdict: "GREEN", hard_blockers: [] },
      affiliate_plan: {
        disclosure_required: false,
        links: [{ url: "https://example.test/radar" }],
      },
    },
    releaseRadarReadme: "# Release Radar",
    portfolioReport: {
      status: "portfolio_defined_local_proof_only",
      formats: [
        { id: "ranked_countdown", label: "Ranked Countdown", targets: { segments: { min: 8 } } },
      ],
    },
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.blocked_formats.length, 0);
  assert.equal(report.portfolio.defined_format_count, 1);
  assert.ok(!report.ready_formats.some((item) => item.format_id === "ranked_countdown"));
});

test("longform operations names missing required inputs without inventing revenue readiness", () => {
  const report = buildLongformOperationsReport();

  assert.equal(report.verdict, "RED");
  assert.deepEqual(report.exact_blockers, [
    "weekly_readiness_report_missing",
    "release_radar_package_missing",
    "release_radar_readme_missing",
  ]);
  assert.equal(report.revenue_readiness.status, "AMBER");
  assert.equal(report.revenue_readiness.ready_for_revenue, false);
  assert.deepEqual(report.revenue_readiness.blockers, ["revenue_evidence_missing"]);
  assert.equal(report.portfolio.provided, false);
});

test("longform operations tool reads source artefacts and writes JSON plus Markdown", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-longform-ops-"));
  const weeklyPath = path.join(root, "weekly.json");
  const radarPath = path.join(root, "radar.json");
  const readmePath = path.join(root, "README.md");
  const portfolioPath = path.join(root, "portfolio.json");
  const outDir = path.join(root, "output", "longform-operations");

  await fs.writeJson(weeklyPath, {
    verdict: "READY_FOR_OPERATOR_REVIEW",
    quality_report: { verdict: "pass", blockers: [] },
  });
  await fs.writeJson(radarPath, {
    format: "monthly_release_radar",
    readiness: { verdict: "GREEN", hard_blockers: [] },
    affiliate_plan: { disclosure_required: false, links: [{ url: "https://example.test" }] },
  });
  await fs.writeFile(readmePath, "# Release Radar\n");
  await fs.writeJson(portfolioPath, { formats: [] });

  const result = await runLongformOperations({
    weeklyReportPath: weeklyPath,
    releaseRadarPackagePath: radarPath,
    releaseRadarReadmePath: readmePath,
    portfolioReportPath: portfolioPath,
    outputDir: outDir,
    generatedAt: "2026-07-12T22:30:00.000Z",
  });

  assert.equal(await fs.pathExists(result.paths.json), true);
  assert.equal(await fs.pathExists(result.paths.markdown), true);
  const written = await fs.readJson(result.paths.json);
  assert.equal(written.mode, "READ_ONLY_LONGFORM_OPERATIONS");
  assert.equal(written.safety.no_uploads, true);
  const markdown = await fs.readFile(result.paths.markdown, "utf8");
  assert.match(markdown, /# Longform Operations/);
  assert.match(markdown, /No uploads, external posts, database mutations or OAuth\/token changes/);
});

test("longform operations surfaces unsafe source evidence as RED", () => {
  const report = buildLongformOperationsReport({
    weeklyReport: {
      verdict: "READY_FOR_OPERATOR_REVIEW",
      quality_report: { verdict: "pass", blockers: [] },
      safety: {
        live_publish_attempted: true,
        db_mutation: false,
        oauth_or_token_mutation: false,
      },
    },
    releaseRadarPackage: {
      format: "monthly_release_radar",
      readiness: { verdict: "GREEN", hard_blockers: [] },
      affiliate_plan: { disclosure_required: false, links: [{ url: "https://example.test" }] },
    },
    releaseRadarReadme: "# Release Radar",
  });

  assert.equal(report.verdict, "RED");
  assert.equal(report.safety.status, "RED");
  assert.deepEqual(report.safety.source_evidence_findings, [
    "weekly_report_live_publish_attempted",
  ]);
  assert.equal(report.safety.no_uploads, true);
});

test("longform operations returns GREEN only for explicitly green unblocked evidence", () => {
  const report = buildLongformOperationsReport({
    weeklyReport: {
      verdict: "GREEN",
      operator_review_required: false,
      quality_report: { verdict: "pass", blockers: [] },
    },
    releaseRadarPackage: {
      format: "monthly_release_radar",
      readiness: {
        verdict: "GREEN",
        operator_review_required: false,
        hard_blockers: [],
      },
      affiliate_plan: {
        disclosure_required: false,
        links: [{ url: "https://example.test" }],
      },
    },
    releaseRadarReadme: "# Release Radar",
  });

  assert.equal(report.verdict, "GREEN");
  assert.deepEqual(report.blocked_formats, []);
  assert.ok(report.ready_formats.every((item) => item.status === "GREEN"));
  assert.equal(report.revenue_readiness.status, "GREEN");
});
