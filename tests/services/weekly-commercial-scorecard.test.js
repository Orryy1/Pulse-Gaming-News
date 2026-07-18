"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildWeeklyCommercialScorecard,
  writeWeeklyCommercialScorecard,
} = require("../../lib/weekly-commercial-scorecard");

function writeCommercialLedger(root, payload) {
  const ledgerPath = path.join(root, "commercial-ledger.json");
  fs.writeJsonSync(ledgerPath, payload, { spaces: 2 });
  return ledgerPath;
}

function writeEvidence(root, relativePath, contents = "primary evidence\n") {
  const evidencePath = path.join(root, relativePath);
  fs.outputFileSync(evidencePath, contents);
  return evidencePath;
}

test("weekly scorecard rejects missing and out-of-root files labelled as primary evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-integrity-red-"));
  const outsidePath = path.join(path.dirname(root), `${path.basename(root)}-outside.pdf`);
  fs.writeFileSync(outsidePath, "outside evidence\n");
  const revenueEntries = [
    {
      id: "missing-cash",
      stage: "cash_received",
      revenue_type: "variable",
      amount_gbp: 100,
      evidence: [
        {
          evidence_type: "payment_processor_settlement",
          evidence_class: "primary",
          source_uri: "evidence/missing-settlement.pdf",
          confidence: "high",
        },
      ],
    },
  ];
  const costEntries = [
    {
      id: "escaped-cost",
      cost_type: "direct_production",
      amount_gbp: 30,
      evidence: [
        {
          evidence_type: "provider_invoice",
          evidence_class: "primary",
          source_uri: path.relative(root, outsidePath),
          confidence: "high",
        },
      ],
    },
  ];
  const ledgerPath = writeCommercialLedger(root, {
    revenue_entries: revenueEntries,
    cost_entries: costEntries,
  });

  const scorecard = buildWeeklyCommercialScorecard({
    revenueEntries,
    costEntries,
    evidenceRoot: root,
    inputLedgerPath: ledgerPath,
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.equal(scorecard.costs.direct_production_cost_status, "unknown_no_primary_evidence");
  assert.equal(scorecard.economics.contribution_margin_status, "unavailable_missing_direct_cost_evidence");
  assert.equal(scorecard.economics.profit_status, "unavailable_missing_fully_loaded_cost_evidence");
  assert.equal(scorecard.revenue_entries[0].recognition_status, "excluded_unmaterialised_primary_evidence");
  assert.equal(scorecard.cost_entries[0].tracking_status, "excluded_unmaterialised_primary_evidence");
  assert.equal(scorecard.commercial_evidence_integrity.verdict, "RED");
  assert.equal(scorecard.commercial_evidence_integrity.input_ledger.status, "verified");
  assert.equal(scorecard.commercial_evidence_integrity.input_ledger.payload_matches_inputs, true);
  assert.ok(scorecard.commercial_evidence_integrity.input_ledger.sha256);
  assert.ok(scorecard.commercial_evidence_integrity.input_ledger.size_bytes > 0);
  assert.deepEqual(
    scorecard.commercial_evidence_integrity.evidence_rows.map((row) => row.integrity_status),
    ["missing", "outside_evidence_root"],
  );
  assert.ok(scorecard.blockers.includes("revenue:missing-cash:evidence_file_missing"));
  assert.ok(scorecard.blockers.includes("cost:escaped-cost:evidence_outside_root"));
});

test("weekly scorecard rejects primary evidence when the materialised ledger does not match inputs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-ledger-mismatch-"));
  writeEvidence(root, "evidence/settlement.pdf");
  const ledgerPath = writeCommercialLedger(root, {
    revenue_entries: [],
    cost_entries: [],
  });
  const revenueEntries = [
    {
      id: "unbound-cash",
      stage: "cash_received",
      revenue_type: "variable",
      amount_gbp: 100,
      evidence: [
        {
          evidence_type: "payment_processor_settlement",
          evidence_class: "primary",
          source_uri: "evidence/settlement.pdf",
          confidence: "high",
        },
      ],
    },
  ];

  const scorecard = buildWeeklyCommercialScorecard({
    revenueEntries,
    evidenceRoot: root,
    inputLedgerPath: ledgerPath,
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.equal(scorecard.revenue_entries[0].recognition_status, "excluded_unbound_input_ledger");
  assert.equal(scorecard.commercial_evidence_integrity.verdict, "RED");
  assert.equal(scorecard.commercial_evidence_integrity.input_ledger.status, "payload_mismatch");
  assert.equal(scorecard.commercial_evidence_integrity.input_ledger.payload_matches_inputs, false);
  assert.ok(scorecard.blockers.includes("commercial_input_ledger_payload_mismatch"));
});

test("weekly scorecard recognises only ledger-bound, materialised, non-empty primary evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-integrity-green-"));
  writeEvidence(root, "evidence/settlement.pdf");
  writeEvidence(root, "evidence/provider-invoice.pdf");
  writeEvidence(root, "evidence/replacement-basis.json", "{\"hours\":2,\"rate_gbp\":25}\n");
  const revenueEntries = [
    {
      id: "cash-settlement",
      stage: "cash_received",
      revenue_type: "variable",
      amount_gbp: 200,
      evidence: [
        {
          evidence_id: "settlement-1",
          evidence_type: "payment_processor_settlement",
          evidence_class: "primary",
          source_uri: "evidence/settlement.pdf",
          confidence: "high",
        },
      ],
    },
  ];
  const costEntries = [
    {
      id: "provider-cost",
      cost_type: "direct_production",
      amount_gbp: 20,
      evidence: [
        {
          evidence_id: "invoice-1",
          evidence_type: "provider_invoice",
          evidence_class: "primary",
          source_uri: "evidence/provider-invoice.pdf",
          confidence: "high",
        },
      ],
    },
    {
      id: "replacement-labour",
      cost_type: "labour_replacement",
      amount_gbp: 50,
      evidence: [
        {
          evidence_id: "replacement-basis-1",
          evidence_type: "replacement_cost_basis",
          evidence_class: "primary",
          source_uri: "evidence/replacement-basis.json",
          confidence: "medium",
        },
      ],
    },
  ];
  const ledgerPath = writeCommercialLedger(root, {
    revenue_entries: revenueEntries,
    cost_entries: costEntries,
  });

  const scorecard = buildWeeklyCommercialScorecard({
    revenueEntries,
    costEntries,
    evidenceRoot: root,
    inputLedgerPath: ledgerPath,
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 200);
  assert.equal(scorecard.costs.total_economic_cost_gbp, 70);
  assert.equal(scorecard.economics.contribution_margin_gbp, 180);
  assert.equal(scorecard.economics.profit_gbp, 130);
  assert.equal(scorecard.commercial_evidence_integrity.verdict, "GREEN");
  assert.equal(scorecard.commercial_evidence_integrity.verified_evidence_count, 3);
  assert.equal(scorecard.commercial_evidence_integrity.invalid_evidence_count, 0);
  for (const row of scorecard.commercial_evidence_integrity.evidence_rows) {
    assert.equal(row.integrity_status, "verified");
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
    assert.ok(row.size_bytes > 0);
  }
});

test("weekly scorecard defaults realised revenue to GBP 0 without primary evidence", () => {
  const scorecard = buildWeeklyCommercialScorecard({
    period: {
      week_start: "2026-07-13",
      week_end: "2026-07-19",
    },
    generatedAt: "2026-07-15T12:00:00.000Z",
    revenueEntries: [
      {
        id: "unsupported-affiliate-claim",
        stage: "cash_received",
        revenue_type: "variable",
        amount_gbp: 125,
        confidence: "high",
        evidence: [],
      },
    ],
  });

  assert.equal(scorecard.currency, "GBP");
  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.equal(scorecard.revenue.realised_revenue_status, "default_zero_no_primary_evidence");
  assert.equal(scorecard.revenue.realised_revenue_confidence, "low");
  assert.equal(scorecard.revenue.cash_received_gbp, 0);
  assert.equal(scorecard.revenue.booked_revenue_gbp, 0);
  assert.equal(scorecard.revenue.platform_receivables_gbp, 0);
  assert.equal(scorecard.revenue.recurring_mrr_gbp, 0);
  assert.equal(scorecard.revenue.variable_revenue_gbp, 0);
  assert.equal(scorecard.revenue_entries[0].recognition_status, "excluded_missing_primary_evidence");
  assert.deepEqual(scorecard.revenue_entries[0].evidence, []);
  assert.ok(scorecard.blockers.includes("revenue:unsupported-affiliate-claim:primary_evidence_missing"));
  assert.equal(scorecard.costs.direct_production_cost_status, "unknown_no_primary_evidence");
  assert.equal(scorecard.costs.labour_replacement_cost_status, "unknown_no_primary_evidence");
  assert.equal(scorecard.costs.total_economic_cost_status, "unavailable_missing_cost_evidence");
  assert.equal(scorecard.economics.contribution_margin_status, "unavailable_missing_direct_cost_evidence");
  assert.equal(scorecard.economics.profit_status, "unavailable_missing_fully_loaded_cost_evidence");
});

test("weekly scorecard separates evidenced revenue lifecycle and revenue model", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-revenue-lifecycle-"));
  for (const evidencePath of [
    "evidence/affiliate/settlement-42.pdf",
    "evidence/sponsors/contract-7.pdf",
    "evidence/platforms/youtube-earnings-july.pdf",
    "evidence/sponsors/recurring-contract-1.pdf",
  ]) {
    writeEvidence(root, evidencePath);
  }
  const revenueEntries = [
      {
        id: "affiliate-cash",
        stage: "cash_received",
        revenue_type: "variable",
        amount_gbp: 80,
        evidence: [
          {
            evidence_id: "affiliate-settlement-42",
            evidence_type: "affiliate_network_payment_statement",
            evidence_class: "primary",
            source_uri: "evidence/affiliate/settlement-42.pdf",
            confidence: "high",
          },
        ],
      },
      {
        id: "sponsor-booking",
        stage: "booked_revenue",
        revenue_type: "variable",
        amount_gbp: 250,
        evidence: [
          {
            evidence_id: "sponsor-contract-7",
            evidence_type: "signed_sponsor_contract",
            evidence_class: "primary",
            source_uri: "evidence/sponsors/contract-7.pdf",
            confidence: "high",
          },
        ],
      },
      {
        id: "youtube-receivable",
        stage: "platform_receivable",
        revenue_type: "variable",
        amount_gbp: 42.35,
        evidence: [
          {
            evidence_id: "youtube-earnings-july",
            evidence_type: "platform_earnings_statement",
            evidence_class: "primary",
            source_uri: "evidence/platforms/youtube-earnings-july.pdf",
            confidence: "medium",
          },
        ],
      },
      {
        id: "recurring-sponsor-booking",
        stage: "booked_revenue",
        revenue_type: "recurring",
        amount_gbp: 1_200,
        monthly_recurring_amount_gbp: 100,
        evidence: [
          {
            evidence_id: "recurring-contract-1",
            evidence_type: "signed_recurring_contract",
            evidence_class: "primary",
            source_uri: "evidence/sponsors/recurring-contract-1.pdf",
            confidence: "high",
          },
        ],
      },
    ];
  const ledgerPath = writeCommercialLedger(root, {
    revenue_entries: revenueEntries,
    cost_entries: [],
  });
  const scorecard = buildWeeklyCommercialScorecard({
    period: {
      week_start: "2026-07-13",
      week_end: "2026-07-19",
    },
    revenueEntries,
    evidenceRoot: root,
    inputLedgerPath: ledgerPath,
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 80);
  assert.equal(scorecard.revenue.realised_revenue_status, "evidence_backed");
  assert.equal(scorecard.revenue.realised_revenue_confidence, "high");
  assert.equal(scorecard.revenue.cash_received_gbp, 80);
  assert.equal(scorecard.revenue.booked_revenue_gbp, 1_450);
  assert.equal(scorecard.revenue.platform_receivables_gbp, 42.35);
  assert.equal(scorecard.revenue.recurring_mrr_gbp, 100);
  assert.equal(scorecard.revenue.variable_revenue_gbp, 80);

  const receivable = scorecard.revenue_entries.find((entry) => entry.id === "youtube-receivable");
  assert.equal(receivable.recognition_status, "recognised_primary_evidence");
  assert.equal(receivable.evidence[0].source_uri, "evidence/platforms/youtube-earnings-july.pdf");
  assert.equal(receivable.evidence[0].confidence, "medium");
});

test("weekly scorecard does not recognise secondary evidence or planning documents as cash", () => {
  const scorecard = buildWeeklyCommercialScorecard({
    revenueEntries: [
      {
        id: "secondary-affiliate-report",
        stage: "cash_received",
        revenue_type: "variable",
        amount_gbp: 90,
        evidence: [
          {
            evidence_type: "affiliate_network_payment_statement",
            evidence_class: "secondary",
            source_uri: "output/goal-15/revenue_attribution.json",
            confidence: "high",
          },
        ],
      },
      {
        id: "draft-sponsor-price",
        stage: "cash_received",
        revenue_type: "variable",
        amount_gbp: 50,
        evidence: [
          {
            evidence_type: "sponsor_pricing_target",
            evidence_class: "primary",
            source_uri: "output/goal-25/sponsor_pricing_bands.json",
            confidence: "high",
          },
        ],
      },
    ],
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.ok(scorecard.revenue_entries.every((entry) => entry.recognition_status === "excluded_unqualified_evidence"));
  assert.equal(scorecard.revenue_entries[0].evidence[0].source_uri, "output/goal-15/revenue_attribution.json");
  assert.equal(scorecard.revenue_entries[0].evidence[0].confidence, "high");
});

test("weekly scorecard calculates contribution margin and profit from separate cost classes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-commercial-economics-"));
  for (const evidencePath of [
    "evidence/payments/settlement-1.pdf",
    "evidence/costs/provider-invoice.pdf",
    "evidence/costs/operator-time-and-rate.json",
  ]) {
    writeEvidence(root, evidencePath);
  }
  const revenueEntries = [
      {
        id: "cash-settlement",
        stage: "cash_received",
        revenue_type: "variable",
        amount_gbp: 200,
        evidence: [
          {
            evidence_type: "payment_processor_settlement",
            evidence_class: "primary",
            source_uri: "evidence/payments/settlement-1.pdf",
            confidence: "high",
          },
        ],
      },
    ];
  const costEntries = [
      {
        id: "production-api-cost",
        cost_type: "direct_production",
        amount_gbp: 20,
        basis: "incurred",
        evidence: [
          {
            evidence_type: "provider_invoice",
            evidence_class: "primary",
            source_uri: "evidence/costs/provider-invoice.pdf",
            confidence: "high",
          },
        ],
      },
      {
        id: "operator-replacement-cost",
        cost_type: "labour_replacement",
        amount_gbp: 120,
        basis: "replacement_estimate",
        evidence: [
          {
            evidence_type: "replacement_cost_basis",
            evidence_class: "primary",
            source_uri: "evidence/costs/operator-time-and-rate.json",
            confidence: "medium",
          },
        ],
      },
    ];
  const ledgerPath = writeCommercialLedger(root, {
    revenue_entries: revenueEntries,
    cost_entries: costEntries,
  });
  const scorecard = buildWeeklyCommercialScorecard({
    revenueEntries,
    costEntries,
    evidenceRoot: root,
    inputLedgerPath: ledgerPath,
  });

  assert.equal(scorecard.costs.direct_production_cost_gbp, 20);
  assert.equal(scorecard.costs.labour_replacement_cost_gbp, 120);
  assert.equal(scorecard.costs.total_economic_cost_gbp, 140);
  assert.equal(scorecard.costs.direct_production_cost_status, "evidence_backed");
  assert.equal(scorecard.costs.labour_replacement_cost_status, "evidence_backed");
  assert.equal(scorecard.costs.total_economic_cost_status, "evidence_backed");
  assert.equal(scorecard.economics.contribution_margin_gbp, 180);
  assert.equal(scorecard.economics.contribution_margin_rate, 0.9);
  assert.equal(scorecard.economics.contribution_margin_status, "evidence_backed");
  assert.equal(scorecard.economics.profit_gbp, 60);
  assert.equal(scorecard.economics.profit_status, "evidence_backed");
  assert.equal(scorecard.cost_entries[1].basis, "replacement_estimate");
  assert.equal(scorecard.cost_entries[1].evidence[0].confidence, "medium");
});

test("weekly scorecard labels planning scenarios as targets and keeps them out of actuals", () => {
  const scorecard = buildWeeklyCommercialScorecard({
    planningScenarios: [
      {
        id: "sponsor-growth-case",
        label: "One sponsor booking",
        classification: "forecast",
        forecast: true,
        target_period: "2026-08",
        metrics: {
          booked_revenue_gbp: 500,
          recurring_mrr_gbp: 0,
          profit_gbp: 350,
        },
        confidence: "low",
        evidence: [
          {
            evidence_type: "operator_target_basis",
            evidence_class: "planning",
            source_uri: "output/goal-25/sponsor_pricing_bands.json",
            confidence: "low",
          },
        ],
      },
    ],
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.equal(scorecard.revenue.booked_revenue_gbp, 0);
  assert.equal(scorecard.planning_targets[0].classification, "target");
  assert.equal(scorecard.planning_targets[0].status, "planning_only");
  assert.equal(scorecard.planning_targets[0].metrics.booked_revenue_gbp, 500);
  assert.equal(scorecard.planning_targets[0].confidence, "low");
  assert.equal(scorecard.planning_targets[0].evidence[0].source_uri, "output/goal-25/sponsor_pricing_bands.json");
  assert.equal(Object.hasOwn(scorecard.planning_targets[0], "forecast"), false);
  assert.equal(scorecard.safety.planning_scenarios_are_targets_not_forecasts, true);
});

test("weekly scorecard publishes the governed commercial planning model without promoting it into actuals or forecasts", () => {
  const scorecard = buildWeeklyCommercialScorecard();
  const model = scorecard.commercial_planning_model;

  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.equal(scorecard.revenue.recurring_mrr_gbp, 0);
  assert.equal(model.classification, "planning_target_not_forecast");
  assert.deepEqual(model.gross_monthly_revenue_target_gbp, {
    minimum: 5_000,
    central: 7_246.5,
    maximum: 12_000,
  });
  assert.deepEqual(model.central_monthly_mix_gbp, {
    shorts_ad_revenue: 500,
    longform_ad_revenue: 1_500,
    sponsor_integrations_and_retainers: 3_000,
    memberships: 1_746.5,
    affiliate_and_commerce: 500,
    total: 7_246.5,
  });
  assert.deepEqual(model.central_volume_assumptions, {
    shorts_views: 5_000_000,
    longform_views: 500_000,
    sponsor_integrations_or_retainers: 2,
    paying_members: 500,
    membership_price_gbp: 4.99,
    creator_share: 0.7,
  });
  assert.deepEqual(model.dependable_recurring_mrr_target_gbp, {
    minimum: 1_750,
    maximum: 4_750,
    qualifying_sources: ["memberships", "contracted_sponsor_retainers"],
  });
  assert.deepEqual(model.milestones.map((milestone) => milestone.amount_gbp), [1_000, 5_000, 10_000]);
  assert.equal(model.capacity_scenarios[0].classification, "capacity_target_only");
  assert.deepEqual(model.capacity_scenarios[0].gross_monthly_revenue_gbp, { minimum: 30_000, maximum: 65_000 });
  assert.deepEqual(model.capacity_scenarios[1].gross_monthly_revenue_gbp, { minimum: 85_000, maximum: 180_000 });
  assert.equal(scorecard.planning_vs_actual.forecast_status, "unavailable_no_primary_evidence");
  assert.equal(scorecard.planning_vs_actual.realised_revenue_gbp, 0);
  assert.equal(scorecard.planning_vs_actual.central_target_gbp, 7_246.5);
  assert.equal(scorecard.planning_vs_actual.central_target_gap_gbp, 7_246.5);
  assert.equal(scorecard.safety.planning_model_excluded_from_actuals, true);
});

test("weekly scorecard writes canonical JSON and Markdown proof", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-weekly-commercial-"));
  const scorecard = buildWeeklyCommercialScorecard({
    period: {
      week_start: "2026-07-13",
      week_end: "2026-07-19",
    },
    generatedAt: "2026-07-15T12:00:00.000Z",
    planningScenarios: [
      {
        label: "Sponsor booking",
        target_period: "2026-07-20/2026-07-26",
        metrics: { booked_revenue_gbp: 50 },
        confidence: "low",
      },
    ],
  });

  const written = await writeWeeklyCommercialScorecard(scorecard, { outputDir });
  const json = await fs.readJson(written.json);
  const markdown = await fs.readFile(written.markdown, "utf8");

  assert.equal(json.report_type, "weekly_commercial_scorecard");
  assert.equal(json.revenue.realised_revenue_gbp, 0);
  assert.match(markdown, /Realised revenue: GBP 0\.00/);
  assert.match(markdown, /Evidence status: default_zero_no_primary_evidence \(low confidence\)/);
  assert.match(markdown, /Primary revenue evidence: none/);
  assert.match(markdown, /Sponsor booking: target for 2026-07-20\/2026-07-26 \(low confidence\); booked revenue GBP 50\.00/);
  assert.match(markdown, /Planning scenarios are targets, not forecasts\./);
  assert.match(markdown, /Central planning target: GBP 7246\.50 per month/);
  assert.match(markdown, /Forecast status: unavailable_no_primary_evidence/);
  assert.match(markdown, /Direct production cost: not available \(no primary evidence\)/);
  assert.match(markdown, /Profit: not available \(fully loaded cost evidence missing\)/);
});

test("weekly scorecard preserves audited commercial context without recognising it as revenue", () => {
  const scorecard = buildWeeklyCommercialScorecard({
    sourceContext: [
      {
        domain: "affiliate",
        source_uri: "output/goal-15/revenue_attribution.json",
        evidence_class: "secondary",
        confidence: "high",
        accounting_treatment: "context_only_zeroed_attribution",
        finding: "No affiliate network payment statement is present.",
      },
    ],
  });

  assert.equal(scorecard.revenue.realised_revenue_gbp, 0);
  assert.equal(scorecard.source_context[0].domain, "affiliate");
  assert.equal(scorecard.source_context[0].source_uri, "output/goal-15/revenue_attribution.json");
  assert.equal(scorecard.source_context[0].confidence, "high");
  assert.equal(scorecard.source_context[0].accounting_treatment, "context_only_zeroed_attribution");
});

test("weekly scorecard publishes its accounting policy in machine-readable form", () => {
  const scorecard = buildWeeklyCommercialScorecard();

  assert.equal(
    scorecard.accounting_policy.realised_revenue_basis,
    "cash_received_with_stage_appropriate_primary_evidence",
  );
  assert.equal(scorecard.accounting_policy.variable_revenue_basis, "realised_variable_cash_only");
  assert.equal(
    scorecard.accounting_policy.contribution_margin_formula,
    "realised_revenue_gbp - direct_production_cost_gbp",
  );
  assert.equal(
    scorecard.accounting_policy.profit_formula,
    "contribution_margin_gbp - labour_replacement_cost_gbp",
  );
  assert.deepEqual(
    scorecard.accounting_policy.non_additive_revenue_metrics,
    ["booked_revenue_gbp", "platform_receivables_gbp", "recurring_mrr_gbp"],
  );
});
