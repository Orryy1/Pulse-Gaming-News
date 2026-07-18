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
