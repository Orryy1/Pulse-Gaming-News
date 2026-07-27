#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildAttachmentRequirementLedger,
} = require("../lib/stabilisation/attachment-requirement-ledger");
const {
  COMMERCIAL_BASELINE,
  compareActualsToForecast,
} = require("../lib/stabilisation/commercial-forecast-tracker");
const {
  getProductSurfaceContract,
} = require("../lib/stabilisation/product-surface-contract");
const {
  RECOVERY_PHASES,
  evaluateAutonomousPublishingReadiness,
} = require("../lib/stabilisation/recovery-programme");
const {
  createReportMetadata,
  decorateMarkdownReport,
} = require("../lib/stabilisation/report-governance");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "docs", "stabilisation");

function head() {
  return childProcess
    .execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    })
    .trim();
}

function runtimeSha() {
  const report = JSON.parse(
    fs.readFileSync(path.join(OUT, "runtime_provenance_report.json"), "utf8"),
  );
  return report.metadata.runtime_commit_sha;
}

function metadata(generatedAt, scope) {
  return createReportMetadata({
    generatedAt,
    sourceCommitSha: head(),
    runtimeCommitSha: runtimeSha(),
    environment: "LOCAL_PROOF",
    scope,
    expiresAt: new Date(generatedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    authoritative: false,
  });
}

function writeJson(name, value) {
  fs.writeFileSync(
    path.join(OUT, `${name}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

function writeMarkdown(name, title, report, body) {
  fs.writeFileSync(
    path.join(OUT, `${name}.md`),
    decorateMarkdownReport({
      title,
      metadata: report.metadata,
      body,
    }),
    "utf8",
  );
}

function main() {
  const generatedAt = new Date();
  const product = {
    metadata: metadata(generatedAt, "Pulse v1 essential product and renderer surface"),
    ...getProductSurfaceContract(),
  };
  const recovery = {
    schema_version: "pulse-recovery-programme-v1",
    metadata: metadata(generatedAt, "Ninety-day recovery phases and autonomous-publishing gates"),
    phases: RECOVERY_PHASES,
    current_readiness: evaluateAutonomousPublishingReadiness({}),
  };
  const commercial = {
    metadata: metadata(generatedAt, "Planning forecast baseline and actual-versus-forecast tracker"),
    ...COMMERCIAL_BASELINE,
    actuals: compareActualsToForecast({}),
  };
  const ledger = buildAttachmentRequirementLedger({
    metadata: metadata(generatedAt, "Complete implementation accounting for the 25 July 2026 audit attachment"),
  });

  writeJson("product_surface_contract", product);
  writeMarkdown(
    "product_surface_contract",
    "Pulse v1 product surface contract",
    product,
    [
      `Essential functions: ${product.essential_functions.length}`,
      "",
      `- Standard renderer: ${product.renderer_policy.standard.id}`,
      `- Experimental renderer: ${product.renderer_policy.experimental.id} (local proof only)`,
      `- Variant layer: ${product.renderer_policy.variant_layer.id}`,
      "",
      "Everything outside the nine-function product remains frozen or phase-gated.",
    ].join("\n"),
  );

  writeJson("recovery_programme", recovery);
  writeMarkdown(
    "recovery_programme",
    "Pulse Gaming ninety-day recovery programme",
    recovery,
    [
      `Current autonomy verdict: **${recovery.current_readiness.verdict}**`,
      "",
      ...recovery.phases.map(
        (phase) => `- ${phase.id} (${phase.days}): ${phase.objective}`,
      ),
      "",
      "Autonomous publishing remains blocked until every acceptance gate has current authoritative evidence.",
    ].join("\n"),
  );

  writeJson("commercial_forecast_baseline", commercial);
  writeMarkdown(
    "commercial_forecast_baseline",
    "Commercial forecast baseline",
    commercial,
    [
      "**Classification:** planning forecast, not a guarantee or current valuation certificate.",
      "",
      `- Current system sale-value forecast: £${commercial.current_system_sale_value_gbp.low.toLocaleString("en-GB")}–£${commercial.current_system_sale_value_gbp.high.toLocaleString("en-GB")}`,
      `- Central current range: £${commercial.current_system_sale_value_gbp.central_low.toLocaleString("en-GB")}–£${commercial.current_system_sale_value_gbp.central_high.toLocaleString("en-GB")}`,
      `- Commercial replacement-cost range: £${commercial.replacement_cost_gbp.commercial_low.toLocaleString("en-GB")}–£${commercial.replacement_cost_gbp.commercial_high.toLocaleString("en-GB")}`,
      `- Actual MRR observed by this pass: ${commercial.actuals.actual_mrr_gbp === null ? "not available" : `£${commercial.actuals.actual_mrr_gbp}`}`,
      "",
      "SaaS productisation, affiliate expansion and new commercial systems remain frozen.",
    ].join("\n"),
  );

  writeJson("attachment_implementation_ledger", ledger);
  const statusRows = Object.entries(ledger.status_counts)
    .map(([status, count]) => `| ${status} | ${count} |`)
    .join("\n");
  const requirementRows = ledger.requirements
    .map(
      (item) =>
        `| ${item.id} | ${item.area} | ${item.requirement.replace(/\|/g, "\\|")} | ${item.status} |`,
    )
    .join("\n");
  writeMarkdown(
    "attachment_implementation_ledger",
    "Audit attachment implementation ledger",
    ledger,
    [
      `Requirements accounted for: **${ledger.requirement_count}**`,
      "",
      "| Status | Count |",
      "| --- | ---: |",
      statusRows,
      "",
      "| ID | Area | Requirement | Status |",
      "| --- | --- | --- | --- |",
      requirementRows,
      "",
      ledger.interpretation,
    ].join("\n"),
  );

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      requirement_count: ledger.requirement_count,
      release_ready: false,
      reports_written: 4,
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main };
