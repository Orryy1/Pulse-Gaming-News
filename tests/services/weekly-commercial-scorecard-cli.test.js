"use strict";

const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "../..");

test("weekly commercial scorecard has a canonical operator command", () => {
  const packageJson = fs.readJsonSync(path.join(ROOT, "package.json"));
  assert.equal(
    packageJson.scripts["ops:commercial-scorecard"],
    "node tools/weekly-commercial-scorecard.js",
  );
});

test("weekly commercial scorecard CLI writes local proof from an explicit ledger", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-weekly-commercial-cli-"));
  const inputPath = path.join(root, "ledger.json");
  const outputDir = path.join(root, "proof");
  await fs.writeJson(inputPath, {
    revenue_entries: [
      {
        id: "unsupported-claim",
        stage: "cash_received",
        revenue_type: "variable",
        amount_gbp: 999,
        evidence: [],
      },
    ],
    planning_scenarios: [
      {
        id: "weekly-target",
        label: "Commercial validation target",
        target_period: "2026-07-13/2026-07-19",
        metrics: { cash_received_gbp: 100 },
      },
    ],
    source_context: [
      {
        domain: "sponsor",
        source_uri: "output/goal-25/sponsor_pricing_bands.json",
        evidence_class: "planning",
        confidence: "high",
        accounting_treatment: "target_basis_only",
      },
    ],
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "tools/weekly-commercial-scorecard.js",
    "--input",
    inputPath,
    "--out-dir",
    outputDir,
    "--week-start",
    "2026-07-13",
    "--week-end",
    "2026-07-19",
    "--generated-at",
    "2026-07-15T12:00:00.000Z",
    "--json",
  ], { cwd: ROOT });

  const report = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(report.revenue.realised_revenue_gbp, 0);
  assert.equal(report.planning_targets[0].classification, "target");
  assert.equal(report.source_context[0].source_uri, "output/goal-25/sponsor_pricing_bands.json");
  assert.equal(await fs.pathExists(path.join(outputDir, "weekly_commercial_scorecard.json")), true);
  assert.equal(await fs.pathExists(path.join(outputDir, "weekly_commercial_scorecard.md")), true);
  assert.equal(await fs.pathExists(path.join(outputDir, "commercial_evidence_integrity_report.json")), true);
  const integrity = await fs.readJson(path.join(outputDir, "commercial_evidence_integrity_report.json"));
  assert.equal(integrity.input_ledger.status, "verified");
  assert.equal(integrity.input_ledger.payload_matches_inputs, true);
  assert.match(integrity.input_ledger.sha256, /^[a-f0-9]{64}$/);
  assert.ok(integrity.input_ledger.size_bytes > 0);
});

test("weekly commercial scorecard CLI allocates local evidence against a published snapshot", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-weekly-allocation-cli-"));
  const inputPath = path.join(root, "source-evidence-ledger.json");
  const snapshotPath = path.join(root, "published-snapshot.json");
  const outputDir = path.join(root, "proof");
  await fs.outputFile(
    path.join(root, "evidence", "youtube-payout.txt"),
    "Paid GBP 10.00 for external_id yt-video-1\n",
  );
  await fs.outputFile(
    path.join(root, "evidence", "provider-invoice.txt"),
    "Invoice total GBP 0.00 for external_id yt-video-1\n",
  );
  await fs.outputFile(
    path.join(root, "evidence", "operator-time.csv"),
    "external_id,hours\nyt-video-1,unknown\n",
  );
  await fs.writeJson(inputPath, {
    evidence_records: [
      {
        id: "youtube-payout",
        record_type: "platform_payout",
        amount_status: "verified",
        amount_gbp: 10,
        evidence: [
          {
            evidence_type: "platform_payout_statement",
            evidence_class: "primary",
            source_uri: "evidence/youtube-payout.txt",
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 10,
            allocation_basis: "statement_line_item",
          },
        ],
      },
      {
        id: "provider-free-tier",
        record_type: "provider_invoice",
        amount_status: "verified",
        amount_gbp: 0,
        evidence: [
          {
            evidence_type: "provider_invoice",
            evidence_class: "primary",
            source_uri: "evidence/provider-invoice.txt",
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            amount_gbp: 0,
            allocation_basis: "invoice_line_item",
          },
        ],
      },
      {
        id: "operator-time-unpriced",
        record_type: "operator_time",
        amount_status: "unknown",
        evidence: [
          {
            evidence_type: "operator_time_log",
            evidence_class: "primary",
            source_uri: "evidence/operator-time.csv",
            confidence: "high",
          },
        ],
        allocations: [
          {
            platform: "youtube",
            external_id: "yt-video-1",
            allocation_basis: "time_log_line_item",
          },
        ],
      },
    ],
  });
  await fs.writeJson(snapshotPath, {
    stories: [{ id: "story-1", title: "A Published Story" }],
    platform_posts: [
      {
        story_id: "story-1",
        platform: "youtube",
        status: "published",
        external_id: "yt-video-1",
        published_at: "2026-07-18 18:00:00",
      },
    ],
  });

  const { stdout, stderr } = await execFileAsync(process.execPath, [
    "tools/weekly-commercial-scorecard.js",
    "--allocation-input",
    inputPath,
    "--published-snapshot",
    snapshotPath,
    "--evidence-root",
    root,
    "--out-dir",
    outputDir,
    "--week-start",
    "2026-07-13",
    "--week-end",
    "2026-07-19",
    "--generated-at",
    "2026-07-20T10:00:00.000Z",
    "--json",
  ], { cwd: ROOT });

  const report = JSON.parse(stdout);
  assert.equal(stderr, "");
  assert.equal(report.revenue.realised_revenue_gbp, 10);
  assert.equal(report.costs.direct_production_cost_status, "evidence_backed");
  assert.equal(report.costs.direct_production_cost_gbp, 0);
  assert.equal(report.costs.labour_replacement_cost_status, "unknown_no_primary_evidence");
  assert.equal(report.economics.contribution_margin_gbp, 10);
  assert.equal(report.economics.contribution_margin_status, "evidence_backed");
  assert.equal(report.economics.profit_status, "unavailable_missing_fully_loaded_cost_evidence");
  assert.equal(report.economics.profit_gbp, null);
  assert.equal(report.commercial_evidence_allocation.verdict, "AMBER");
  assert.equal(report.commercial_evidence_allocation.unavailable_record_count, 1);
  assert.equal(report.commercial_evidence_integrity.verdict, "AMBER");
  assert.equal(report.commercial_evidence_integrity.input_ledger.status, "verified");
  assert.deepEqual(report.revenue_entries[0].scope, {
    story_id: "story-1",
    platform: "youtube",
    external_id: "yt-video-1",
    cohort_id: "2026-07-13/2026-07-19",
  });
  assert.match(
    report.commercial_evidence_allocation.publication_snapshot.sha256,
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    await fs.pathExists(path.join(outputDir, "allocated_commercial_ledger.json")),
    true,
  );
  assert.equal(
    await fs.pathExists(
      path.join(outputDir, "commercial_evidence_allocation_report.json"),
    ),
    true,
  );
  assert.equal(
    report.commercial_evidence_integrity.input_ledger.sha256,
    report.commercial_evidence_allocation.allocated_ledger.sha256,
  );
  const markdown = await fs.readFile(
    path.join(outputDir, "weekly_commercial_scorecard.md"),
    "utf8",
  );
  assert.match(markdown, /## Evidence Allocation/);
  assert.match(markdown, /Unavailable records: 1/);
  assert.match(markdown, /Profit: not available/);
});
