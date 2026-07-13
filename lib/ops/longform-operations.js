"use strict";

const fs = require("fs-extra");
const path = require("node:path");

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(asArray(values).map(clean).filter(Boolean))];
}

function normaliseVerdict(value) {
  return clean(value).toUpperCase();
}

function weeklyFormat(report) {
  const quality = report?.quality_report || {};
  const sourceVerdict = normaliseVerdict(report?.verdict);
  const qualityVerdict = normaliseVerdict(quality.verdict);
  const acceptedSource = ["GREEN", "PASS", "PASSED", "READY", "READY_FOR_OPERATOR_REVIEW"].includes(
    sourceVerdict,
  );
  const reviewRequired =
    report?.operator_review_required === true || sourceVerdict === "READY_FOR_OPERATOR_REVIEW";
  let blockers = unique([
    ...asArray(quality.blockers),
    ...(!report ? ["weekly_readiness_report_missing"] : []),
  ]);
  if (report && (!acceptedSource || qualityVerdict !== "PASS") && blockers.length === 0) {
    blockers = [
      !acceptedSource
        ? `weekly_readiness_not_ready:${sourceVerdict.toLowerCase() || "unknown"}`
        : `weekly_quality_not_pass:${qualityVerdict.toLowerCase() || "unknown"}`,
    ];
  }
  const passed =
    acceptedSource &&
    qualityVerdict === "PASS" &&
    blockers.length === 0;
  return {
    format_id: "weekly_roundup",
    label: "Weekly Roundup",
    status: passed ? (reviewRequired ? "AMBER" : "GREEN") : "RED",
    readiness: passed
      ? reviewRequired
        ? "ready_for_operator_review"
        : "ready"
      : "blocked",
    blockers,
    next_action: clean(report?.next_action) || null,
    evidence: {
      report_present: Boolean(report),
      source_verdict: clean(report?.verdict) || null,
      quality_verdict: clean(quality.verdict) || null,
      operator_review_required: reviewRequired,
    },
  };
}

function releaseRadarFormat(pack, readme) {
  const readiness = pack?.readiness || {};
  const blockers = unique([
    ...asArray(readiness.hard_blockers),
    ...(!pack ? ["release_radar_package_missing"] : []),
    ...(!clean(readme) ? ["release_radar_readme_missing"] : []),
  ]);
  const sourceVerdict = normaliseVerdict(readiness.verdict || pack?.verdict);
  const passed =
    ["READY", "PASS", "GREEN", "READY_FOR_OPERATOR_REVIEW"].includes(sourceVerdict) &&
    blockers.length === 0;
  const reviewRequired =
    readiness.operator_review_required === true || sourceVerdict === "READY_FOR_OPERATOR_REVIEW";
  return {
    format_id: clean(pack?.format) || "monthly_release_radar",
    label: clean(pack?.month_label)
      ? `${clean(pack.month_label)} Release Radar`
      : "Monthly Release Radar",
    status: passed ? (reviewRequired ? "AMBER" : "GREEN") : "RED",
    readiness: passed
      ? reviewRequired
        ? "ready_for_operator_review"
        : "ready"
      : "blocked",
    blockers,
    next_action: passed
      ? reviewRequired
        ? "Complete operator review before any publish decision."
        : "Hold for an explicitly authorised production run."
      : "Resolve the release-radar hard blockers and rebuild the package.",
    evidence: {
      package_present: Boolean(pack),
      readme_present: Boolean(clean(readme)),
      source_verdict: clean(readiness.verdict || pack?.verdict) || null,
      operator_review_required: reviewRequired,
      ready_candidate_count: Number(readiness.ready_candidate_count || 0),
      blocked_candidate_count: Number(readiness.blocked_candidate_count || 0),
    },
  };
}

function portfolioFormats(report) {
  const rows = asArray(report?.formats || report?.entries || report?.stories);
  return rows.filter((row) => {
    const hasExplicitVerdict = Boolean(
      clean(row?.verdict || row?.status || row?.readiness?.verdict),
    );
    const hasExplicitBlockers = asArray(
      row?.blockers || row?.hard_blockers || row?.reasons,
    ).length > 0;
    return hasExplicitVerdict || hasExplicitBlockers;
  }).map((row, index) => {
    const blockers = unique(row?.blockers || row?.hard_blockers || row?.reasons);
    const sourceVerdict = normaliseVerdict(
      row?.verdict || row?.status || row?.readiness?.verdict,
    );
    const reviewRequired =
      row?.operator_review_required === true ||
      row?.readiness?.operator_review_required === true ||
      sourceVerdict === "READY_FOR_OPERATOR_REVIEW";
    const passed =
      blockers.length === 0 &&
      ["GREEN", "PASS", "PASSED", "READY", "READY_FOR_OPERATOR_REVIEW"].includes(
        sourceVerdict,
      );
    return {
      format_id: clean(row?.format_id || row?.id || row?.format) || `portfolio_format_${index + 1}`,
      label: clean(row?.label || row?.title || row?.name) || "Portfolio Format",
      status: passed ? (reviewRequired ? "AMBER" : "GREEN") : "RED",
      readiness: passed
        ? reviewRequired
          ? "ready_for_operator_review"
          : "ready"
        : "blocked",
      blockers,
      next_action:
        clean(row?.next_action || row?.production_priority || row?.recommended_action) ||
        (passed
          ? reviewRequired
            ? "Complete operator review before any publish decision."
            : "Hold for an explicitly authorised production run."
          : "Resolve the portfolio format blockers."),
      evidence: {
        portfolio_report_present: true,
        source_verdict: clean(row?.verdict || row?.status || row?.readiness?.verdict) || null,
        operator_review_required: reviewRequired,
      },
    };
  });
}

function revenueReadiness(releaseRadarPackage, formats) {
  const affiliate = releaseRadarPackage?.affiliate_plan || {};
  const links = asArray(affiliate.links);
  const disclosureRequired = affiliate.disclosure_required === true;
  const disclosurePresent = Boolean(clean(affiliate.disclosure_copy || affiliate.disclosure));
  const blockers = [];
  const evidencePresent = Object.keys(affiliate).length > 0;
  if (!evidencePresent) blockers.push("revenue_evidence_missing");
  if (disclosureRequired && !disclosurePresent) blockers.push("affiliate_disclosure_missing");
  if (evidencePresent && links.length === 0) blockers.push("revenue_links_missing");
  const productionReady = formats.some((item) => item.status === "GREEN");
  const confirmedFailure = blockers.includes("affiliate_disclosure_missing");
  return {
    status: confirmedFailure ? "RED" : blockers.length ? "AMBER" : productionReady ? "GREEN" : "AMBER",
    ready_for_revenue: blockers.length === 0 && productionReady,
    blockers,
    evidence: {
      affiliate_plan_present: evidencePresent,
      disclosure_required: disclosureRequired,
      disclosure_present: disclosurePresent,
      link_count: links.length,
    },
  };
}

function sourceSafetyFindings(weeklyReport, releaseRadarPackage, portfolioReport) {
  const findings = [];
  const sources = [
    ["weekly_report", weeklyReport?.safety || {}],
    ["release_radar", releaseRadarPackage?.safety || {}],
    ["portfolio_report", portfolioReport?.safety || {}],
  ];
  for (const [prefix, safety] of sources) {
    if (
      safety.live_publish_attempted === true ||
      safety.live_publish_performed === true ||
      safety.upload_performed === true ||
      safety.external_posting_performed === true
    ) {
      findings.push(`${prefix}_live_publish_attempted`);
    }
    if (safety.db_mutation === true || safety.production_db_mutated === true) {
      findings.push(`${prefix}_db_mutation_recorded`);
    }
    if (
      safety.oauth_or_token_mutation === true ||
      safety.oauth_or_token_mutated === true
    ) {
      findings.push(`${prefix}_oauth_or_token_mutation_recorded`);
    }
    if (safety.scheduler_touched === true || safety.scheduler_mutated === true) {
      findings.push(`${prefix}_scheduler_mutation_recorded`);
    }
  }
  return unique(findings);
}

function buildLongformOperationsReport({
  weeklyReport = null,
  releaseRadarPackage = null,
  releaseRadarReadme = "",
  portfolioReport = null,
  sources = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const formats = [
    weeklyFormat(weeklyReport),
    releaseRadarFormat(releaseRadarPackage, releaseRadarReadme),
    ...portfolioFormats(portfolioReport),
  ];
  const readyFormats = formats.filter((item) => item.status !== "RED");
  const blockedFormats = formats.filter((item) => item.status === "RED");
  const safetyFindings = sourceSafetyFindings(
    weeklyReport,
    releaseRadarPackage,
    portfolioReport,
  );
  const verdict = blockedFormats.length || safetyFindings.length
    ? "RED"
    : formats.some((item) => item.status === "AMBER")
      ? "AMBER"
      : "GREEN";
  const nextProductionPriority =
    blockedFormats[0] || readyFormats.find((item) => item.status === "AMBER") || readyFormats[0] || null;

  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "READ_ONLY_LONGFORM_OPERATIONS",
    verdict,
    ready_formats: readyFormats,
    blocked_formats: blockedFormats,
    exact_blockers: unique([
      ...blockedFormats.flatMap((item) => item.blockers),
      ...safetyFindings,
    ]),
    next_production_priority: nextProductionPriority
      ? {
          format_id: nextProductionPriority.format_id,
          status: nextProductionPriority.status,
          action: nextProductionPriority.next_action,
          blockers: nextProductionPriority.blockers,
        }
      : null,
    revenue_readiness: revenueReadiness(releaseRadarPackage, formats),
    portfolio: {
      provided: Boolean(portfolioReport),
      defined_format_count: asArray(
        portfolioReport?.formats || portfolioReport?.entries || portfolioReport?.stories,
      ).length,
      report: portfolioReport || null,
    },
    source_artefacts: {
      weekly_readiness_report: sources.weeklyReportPath || null,
      release_radar_package: sources.releaseRadarPackagePath || null,
      release_radar_readme: sources.releaseRadarReadmePath || null,
      longform_portfolio_report: sources.portfolioReportPath || null,
    },
    safety: {
      status: safetyFindings.length ? "RED" : "GREEN",
      source_evidence_findings: safetyFindings,
      safe_to_publish: false,
      read_only: true,
      no_uploads: true,
      no_external_posting: true,
      no_db_mutation: true,
      no_oauth_or_token_mutation: true,
      no_scheduler_mutation: true,
    },
  };
}

function renderLongformOperationsMarkdown(report = {}) {
  const lines = [
    "# Longform Operations",
    "",
    `Generated: ${report.generated_at || "unknown"}`,
    `Verdict: ${report.verdict || "RED"}`,
    "",
    "## Ready Formats",
    "",
  ];
  if (!asArray(report.ready_formats).length) lines.push("- none");
  for (const format of asArray(report.ready_formats)) {
    lines.push(`- ${format.label} (${format.format_id}): ${format.status}`);
  }
  lines.push("", "## Blocked Formats", "");
  if (!asArray(report.blocked_formats).length) lines.push("- none");
  for (const format of asArray(report.blocked_formats)) {
    lines.push(`- ${format.label} (${format.format_id}): ${asArray(format.blockers).join(", ") || "blocked"}`);
  }
  lines.push("", "## Next Production Priority", "");
  if (report.next_production_priority) {
    lines.push(`- Format: ${report.next_production_priority.format_id}`);
    lines.push(`- Action: ${report.next_production_priority.action || "No action recorded"}`);
  } else {
    lines.push("- none");
  }
  lines.push("", "## Revenue Readiness", "");
  lines.push(`- Status: ${report.revenue_readiness?.status || "AMBER"}`);
  lines.push(`- Ready for revenue: ${report.revenue_readiness?.ready_for_revenue === true}`);
  for (const blocker of asArray(report.revenue_readiness?.blockers)) lines.push(`- Blocker: ${blocker}`);
  lines.push("", "## Safety", "");
  lines.push("- Read-only operations report");
  lines.push("- No uploads, external posts, database mutations or OAuth/token changes");
  lines.push("- This report is evidence, not publish permission");
  return `${lines.join("\n")}\n`;
}

async function writeLongformOperationsReport(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeLongformOperationsReport requires outputDir");
  const outDir = path.resolve(outputDir);
  await fs.ensureDir(outDir);
  const json = path.join(outDir, "longform_operations_report.json");
  const markdown = path.join(outDir, "longform_operations_report.md");
  await fs.writeJson(json, report, { spaces: 2 });
  await fs.writeFile(markdown, renderLongformOperationsMarkdown(report), "utf8");
  return { json, markdown };
}

module.exports = {
  buildLongformOperationsReport,
  renderLongformOperationsMarkdown,
  writeLongformOperationsReport,
};
