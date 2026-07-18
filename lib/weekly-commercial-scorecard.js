"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const PRIMARY_EVIDENCE_BY_STAGE = Object.freeze({
  cash_received: Object.freeze([
    "affiliate_network_payment_statement",
    "bank_statement",
    "bank_transaction",
    "payment_processor_settlement",
    "platform_payout_statement",
    "sponsor_remittance_advice",
  ]),
  booked_revenue: Object.freeze([
    "affiliate_network_approved_commission",
    "issued_invoice",
    "purchase_order",
    "signed_recurring_contract",
    "signed_sponsor_contract",
  ]),
  platform_receivable: Object.freeze([
    "platform_earnings_statement",
  ]),
});

const PRIMARY_COST_EVIDENCE_BY_TYPE = Object.freeze({
  direct_production: Object.freeze([
    "card_statement",
    "provider_invoice",
    "provider_usage_statement",
    "receipt",
  ]),
  labour_replacement: Object.freeze([
    "contractor_quote",
    "operator_time_log",
    "replacement_cost_basis",
  ]),
});

const TARGET_METRICS = Object.freeze([
  "cash_received_gbp",
  "booked_revenue_gbp",
  "platform_receivables_gbp",
  "recurring_mrr_gbp",
  "variable_revenue_gbp",
  "direct_production_cost_gbp",
  "labour_replacement_cost_gbp",
  "contribution_margin_gbp",
  "profit_gbp",
]);

function buildCommercialPlanningModel() {
  const centralMonthlyMix = {
    shorts_ad_revenue: 500,
    longform_ad_revenue: 1_500,
    sponsor_integrations_and_retainers: 3_000,
    memberships: 1_746.5,
    affiliate_and_commerce: 500,
  };
  return {
    classification: "planning_target_not_forecast",
    guarantee: false,
    gross_monthly_revenue_target_gbp: {
      minimum: 5_000,
      central: 7_246.5,
      maximum: 12_000,
    },
    central_monthly_mix_gbp: {
      ...centralMonthlyMix,
      total: money(Object.values(centralMonthlyMix).reduce((total, value) => total + value, 0)),
    },
    central_volume_assumptions: {
      shorts_views: 5_000_000,
      longform_views: 500_000,
      sponsor_integrations_or_retainers: 2,
      paying_members: 500,
      membership_price_gbp: 4.99,
      creator_share: 0.7,
    },
    dependable_recurring_mrr_target_gbp: {
      minimum: 1_750,
      maximum: 4_750,
      qualifying_sources: ["memberships", "contracted_sponsor_retainers"],
    },
    variable_revenue_sources: [
      "platform_ad_revenue",
      "one_off_sponsorships",
      "affiliate_and_commerce",
    ],
    milestones: [
      {
        id: "first_verified_1000_gross_month",
        amount_gbp: 1_000,
        acceptance: "reconciled_primary_revenue_evidence",
      },
      {
        id: "repeatable_5000_gross_month",
        amount_gbp: 5_000,
        acceptance: "repeated_month_with_reconciled_primary_revenue_evidence",
      },
      {
        id: "10000_month_with_durable_economics",
        amount_gbp: 10_000,
        acceptance: "sponsor_retainers_and_positive_contribution_economics",
      },
    ],
    capacity_scenarios: [
      {
        id: "strong_publisher_capacity",
        classification: "capacity_target_only",
        gross_monthly_revenue_gbp: { minimum: 30_000, maximum: 65_000 },
      },
      {
        id: "breakout_capacity",
        classification: "capacity_target_only",
        gross_monthly_revenue_gbp: { minimum: 85_000, maximum: 180_000 },
      },
    ],
    supersession_rule:
      "Replace planning assumptions only with reconciled primary platform, invoice, contract, affiliate or payment evidence.",
  };
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function signedMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isWithinRoot(root, target) {
  const relative = path.relative(root, target);
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function realpathSync(filePath) {
  return typeof fs.realpathSync.native === "function"
    ? fs.realpathSync.native(filePath)
    : fs.realpathSync(filePath);
}

function ledgerRows(payload = {}, key) {
  const snakeKey = key === "revenue" ? "revenue_entries" : "cost_entries";
  const camelKey = key === "revenue" ? "revenueEntries" : "costEntries";
  return asArray(payload[snakeKey] || payload[camelKey]);
}

function inspectInputLedger({
  inputLedgerPath = null,
  revenueEntries = [],
  costEntries = [],
} = {}) {
  const claimedEntryCount = asArray(revenueEntries).length + asArray(costEntries).length;
  if (!inputLedgerPath) {
    return {
      status: claimedEntryCount ? "missing" : "not_provided",
      path: null,
      sha256: null,
      size_bytes: 0,
      payload_matches_inputs: claimedEntryCount ? false : null,
    };
  }

  const resolved = path.resolve(inputLedgerPath);
  try {
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) {
      return {
        status: "not_file",
        path: resolved,
        sha256: null,
        size_bytes: 0,
        payload_matches_inputs: false,
      };
    }
    if (stat.size <= 0) {
      return {
        status: "empty",
        path: resolved,
        sha256: null,
        size_bytes: 0,
        payload_matches_inputs: false,
      };
    }
    const bytes = fs.readFileSync(resolved);
    const payload = JSON.parse(bytes.toString("utf8"));
    const payloadMatchesInputs =
      canonicalJson(ledgerRows(payload, "revenue")) === canonicalJson(asArray(revenueEntries)) &&
      canonicalJson(ledgerRows(payload, "cost")) === canonicalJson(asArray(costEntries));
    return {
      status: payloadMatchesInputs ? "verified" : "payload_mismatch",
      path: realpathSync(resolved),
      sha256: sha256(bytes),
      size_bytes: stat.size,
      payload_matches_inputs: payloadMatchesInputs,
    };
  } catch (error) {
    return {
      status: error?.code === "ENOENT" ? "missing" : "invalid",
      path: resolved,
      sha256: null,
      size_bytes: 0,
      payload_matches_inputs: false,
      error: clean(error?.message) || "input ledger could not be verified",
    };
  }
}

function normaliseEvidence(evidence = {}) {
  return {
    evidence_id: clean(evidence.evidence_id || evidence.id) || null,
    evidence_type: clean(evidence.evidence_type || evidence.type).toLowerCase() || null,
    evidence_class: clean(evidence.evidence_class || evidence.class).toLowerCase() || null,
    source_uri: clean(evidence.source_uri || evidence.uri || evidence.path) || null,
    confidence: clean(evidence.confidence).toLowerCase() || "low",
  };
}

function inspectMaterialisedEvidence(evidence = {}, { evidenceRoot = null } = {}) {
  const base = {
    integrity_status: "unverified",
    integrity_verified: false,
    resolved_path: null,
    sha256: null,
    size_bytes: 0,
  };
  if (!evidence.source_uri) return { ...base, integrity_status: "source_uri_missing" };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(evidence.source_uri)) {
    return { ...base, integrity_status: "remote_uri_not_materialised" };
  }
  if (!evidenceRoot) return { ...base, integrity_status: "evidence_root_missing" };

  const resolvedRoot = path.resolve(evidenceRoot);
  const candidate = path.isAbsolute(evidence.source_uri)
    ? path.resolve(evidence.source_uri)
    : path.resolve(resolvedRoot, evidence.source_uri);
  if (!isWithinRoot(resolvedRoot, candidate)) {
    return { ...base, integrity_status: "outside_evidence_root" };
  }

  try {
    const canonicalRoot = realpathSync(resolvedRoot);
    const canonicalCandidate = realpathSync(candidate);
    if (!isWithinRoot(canonicalRoot, canonicalCandidate)) {
      return { ...base, integrity_status: "outside_evidence_root" };
    }
    const stat = fs.statSync(canonicalCandidate);
    if (!stat.isFile()) {
      return {
        ...base,
        integrity_status: "not_file",
        resolved_path: canonicalCandidate,
      };
    }
    if (stat.size <= 0) {
      return {
        ...base,
        integrity_status: "empty",
        resolved_path: canonicalCandidate,
      };
    }
    const bytes = fs.readFileSync(canonicalCandidate);
    return {
      integrity_status: "verified",
      integrity_verified: true,
      resolved_path: canonicalCandidate,
      sha256: sha256(bytes),
      size_bytes: stat.size,
    };
  } catch (error) {
    return {
      ...base,
      integrity_status: error?.code === "ENOENT" ? "missing" : "unreadable",
      resolved_path: candidate,
      error: clean(error?.message) || "evidence file could not be verified",
    };
  }
}

function bindEvidenceIntegrity(evidence = {}, {
  evidenceRoot = null,
  inputLedgerBound = false,
} = {}) {
  const normalised = normaliseEvidence(evidence);
  return {
    ...normalised,
    ...inspectMaterialisedEvidence(normalised, { evidenceRoot }),
    input_ledger_bound: inputLedgerBound,
  };
}

function primaryEvidenceForStage(stage, evidence = []) {
  const acceptedTypes = PRIMARY_EVIDENCE_BY_STAGE[stage] || [];
  return evidence.filter((item) =>
    item.evidence_class === "primary" &&
    item.source_uri &&
    item.integrity_verified === true &&
    item.input_ledger_bound === true &&
    acceptedTypes.includes(item.evidence_type));
}

function hasPrimaryEvidence(stage, evidence = []) {
  return primaryEvidenceForStage(stage, evidence).length > 0;
}

function weakestConfidence(evidence = []) {
  const rank = { low: 1, medium: 2, high: 3 };
  return evidence.reduce((weakest, item) => {
    const confidence = rank[item.confidence] ? item.confidence : "low";
    return rank[confidence] < rank[weakest] ? confidence : weakest;
  }, "high");
}

function hasPrimaryCostEvidence(costType, evidence = []) {
  const acceptedTypes = PRIMARY_COST_EVIDENCE_BY_TYPE[costType] || [];
  return evidence.some((item) =>
    item.evidence_class === "primary" &&
    item.source_uri &&
    item.integrity_verified === true &&
    item.input_ledger_bound === true &&
    acceptedTypes.includes(item.evidence_type));
}

function normaliseTargetMetrics(metrics = {}) {
  const output = {};
  for (const field of TARGET_METRICS) {
    if (Object.hasOwn(metrics, field)) output[field] = money(metrics[field]);
  }
  return output;
}

function normaliseSourceContext(item = {}) {
  return {
    domain: clean(item.domain).toLowerCase() || "unknown",
    source_kind: clean(item.source_kind).toLowerCase() || "local_artefact",
    source_uri: clean(item.source_uri || item.uri || item.path) || null,
    evidence_class: clean(item.evidence_class).toLowerCase() || "secondary",
    confidence: clean(item.confidence).toLowerCase() || "low",
    accounting_treatment: clean(item.accounting_treatment).toLowerCase() || "context_only",
    finding: clean(item.finding) || null,
  };
}

function formatGbp(value) {
  return `GBP ${signedMoney(value).toFixed(2)}`;
}

function formatTargetMetrics(metrics = {}) {
  return Object.entries(metrics).map(([field, value]) => {
    const label = field.replace(/_gbp$/, "").replace(/_/g, " ");
    return `${label} ${formatGbp(value)}`;
  }).join(", ");
}

function qualifiedRevenueEvidence(stage, evidence = []) {
  const acceptedTypes = PRIMARY_EVIDENCE_BY_STAGE[stage] || [];
  return evidence.filter((item) =>
    item.evidence_class === "primary" &&
    item.source_uri &&
    acceptedTypes.includes(item.evidence_type));
}

function qualifiedCostEvidence(costType, evidence = []) {
  const acceptedTypes = PRIMARY_COST_EVIDENCE_BY_TYPE[costType] || [];
  return evidence.filter((item) =>
    item.evidence_class === "primary" &&
    item.source_uri &&
    acceptedTypes.includes(item.evidence_type));
}

function integrityBlockerSuffix(status) {
  const suffixes = {
    evidence_root_missing: "evidence_root_missing",
    empty: "evidence_file_empty",
    missing: "evidence_file_missing",
    not_file: "evidence_not_file",
    outside_evidence_root: "evidence_outside_root",
    remote_uri_not_materialised: "remote_evidence_not_materialised",
    source_uri_missing: "evidence_source_uri_missing",
    unreadable: "evidence_file_unreadable",
  };
  return suffixes[status] || "evidence_integrity_unverified";
}

function renderWeeklyCommercialScorecardMarkdown(scorecard = {}) {
  const revenue = scorecard.revenue || {};
  const costs = scorecard.costs || {};
  const economics = scorecard.economics || {};
  const integrity = scorecard.commercial_evidence_integrity || {};
  const recognisedRevenue = asArray(scorecard.revenue_entries)
    .filter((entry) => entry.recognition_status === "recognised_primary_evidence");
  const planningModel = scorecard.commercial_planning_model || {};
  const planningVsActual = scorecard.planning_vs_actual || {};
  const lines = [
    "# Weekly Commercial Scorecard",
    "",
    `Period: ${scorecard.period?.week_start || "not set"} to ${scorecard.period?.week_end || "not set"}`,
    `Generated: ${scorecard.generated_at || "unknown"}`,
    `Mode: ${scorecard.mode || "LOCAL_PROOF"}`,
    "",
    "## Revenue Actuals",
    `- Realised revenue: ${formatGbp(revenue.realised_revenue_gbp)}`,
    `- Evidence status: ${revenue.realised_revenue_status || "unknown"} (${revenue.realised_revenue_confidence || "low"} confidence)`,
    `- Cash received: ${formatGbp(revenue.cash_received_gbp)}`,
    `- Booked revenue: ${formatGbp(revenue.booked_revenue_gbp)}`,
    `- Platform receivables: ${formatGbp(revenue.platform_receivables_gbp)}`,
    `- Recurring MRR: ${formatGbp(revenue.recurring_mrr_gbp)}`,
    `- Variable revenue: ${formatGbp(revenue.variable_revenue_gbp)}`,
    `- Primary revenue evidence: ${revenue.primary_revenue_evidence_count || "none"}`,
  ];
  for (const entry of recognisedRevenue) {
    const links = primaryEvidenceForStage(entry.stage, asArray(entry.evidence))
      .map((evidence) => `${evidence.evidence_type}: ${evidence.source_uri} (${evidence.confidence})`);
    lines.push(`- ${entry.id}: ${links.join(", ")}`);
  }
  lines.push(
    "",
    "## Costs And Economics",
    costs.direct_production_cost_status === "evidence_backed"
      ? `- Direct production cost: ${formatGbp(costs.direct_production_cost_gbp)}`
      : "- Direct production cost: not available (no primary evidence)",
    costs.labour_replacement_cost_status === "evidence_backed"
      ? `- Labour replacement cost: ${formatGbp(costs.labour_replacement_cost_gbp)}`
      : "- Labour replacement cost: not available (no primary evidence)",
    economics.contribution_margin_status === "evidence_backed"
      ? `- Contribution margin: ${formatGbp(economics.contribution_margin_gbp)}`
      : "- Contribution margin: not available (direct cost evidence missing)",
    economics.profit_status === "evidence_backed"
      ? `- Profit: ${formatGbp(economics.profit_gbp)}`
      : "- Profit: not available (fully loaded cost evidence missing)",
    "",
    "## Planning Targets",
    `- Central planning target: ${formatGbp(planningModel.gross_monthly_revenue_target_gbp?.central)} per month`,
    `- Gross planning range: ${formatGbp(planningModel.gross_monthly_revenue_target_gbp?.minimum)} to ${formatGbp(planningModel.gross_monthly_revenue_target_gbp?.maximum)} per month`,
    `- Dependable recurring MRR target: ${formatGbp(planningModel.dependable_recurring_mrr_target_gbp?.minimum)} to ${formatGbp(planningModel.dependable_recurring_mrr_target_gbp?.maximum)}`,
    `- Forecast status: ${planningVsActual.forecast_status || "unavailable"}`,
    `- Actual gap to central planning target: ${formatGbp(planningVsActual.central_target_gap_gbp)}`,
  );
  if (asArray(scorecard.planning_targets).length) {
    for (const target of scorecard.planning_targets) {
      const metrics = formatTargetMetrics(target.metrics);
      lines.push(`- ${target.label}: target for ${target.target_period || "unspecified period"} (${target.confidence} confidence)${metrics ? `; ${metrics}` : ""}`);
    }
  } else {
    lines.push("- None recorded.");
  }
  lines.push(
    "- Planning scenarios are targets, not forecasts.",
    "",
    "## Evidence Integrity",
    `- Verdict: ${integrity.verdict || "AMBER"}`,
    `- Input ledger: ${integrity.input_ledger?.status || "not_provided"}`,
    `- Verified evidence files: ${integrity.verified_evidence_count || 0}`,
    `- Invalid evidence files: ${integrity.invalid_evidence_count || 0}`,
    "",
    "## Audited Context",
  );
  if (asArray(scorecard.source_context).length) {
    for (const item of scorecard.source_context) {
      lines.push(`- ${item.domain}: ${item.source_uri || "no link"} (${item.confidence}; ${item.accounting_treatment})`);
    }
  } else {
    lines.push("- None supplied.");
  }
  lines.push(
    "",
    "## Safety",
    "- LOCAL_PROOF only. No external contact, spending, credential change, publishing or DB mutation occurred.",
  );
  return `${lines.join("\n")}\n`;
}

async function writeWeeklyCommercialScorecard(scorecard = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeWeeklyCommercialScorecard requires outputDir");
  await fs.ensureDir(outputDir);
  const written = {
    json: path.join(outputDir, "weekly_commercial_scorecard.json"),
    markdown: path.join(outputDir, "weekly_commercial_scorecard.md"),
    integrity: path.join(outputDir, "commercial_evidence_integrity_report.json"),
  };
  await fs.writeJson(written.json, scorecard, { spaces: 2 });
  await fs.outputFile(written.markdown, renderWeeklyCommercialScorecardMarkdown(scorecard));
  await fs.writeJson(
    written.integrity,
    scorecard.commercial_evidence_integrity || {
      schema_version: 1,
      report_type: "commercial_evidence_integrity_report",
      verdict: "AMBER",
      blockers: ["commercial_evidence_integrity_not_generated"],
    },
    { spaces: 2 },
  );
  return written;
}

function buildWeeklyCommercialScorecard({
  period = {},
  revenueEntries = [],
  costEntries = [],
  planningScenarios = [],
  sourceContext = [],
  evidenceRoot = null,
  inputLedgerPath = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const blockers = [];
  const revenueInputRows = asArray(revenueEntries);
  const costInputRows = asArray(costEntries);
  const inputLedger = inspectInputLedger({
    inputLedgerPath,
    revenueEntries: revenueInputRows,
    costEntries: costInputRows,
  });
  const inputLedgerBound = inputLedger.status === "verified";
  const resolvedEvidenceRoot = evidenceRoot
    ? path.resolve(evidenceRoot)
    : inputLedgerPath
      ? path.dirname(path.resolve(inputLedgerPath))
      : null;
  if (inputLedger.status === "payload_mismatch") {
    blockers.push("commercial_input_ledger_payload_mismatch");
  } else if (
    (revenueInputRows.length || costInputRows.length) &&
    inputLedger.status !== "verified"
  ) {
    blockers.push(`commercial_input_ledger_${inputLedger.status}`);
  }

  const evidenceRows = [];
  const rows = revenueInputRows.map((entry, index) => {
    const id = clean(entry.id) || `revenue-${index + 1}`;
    const stage = clean(entry.stage).toLowerCase() || "unknown";
    const revenueType = clean(entry.revenue_type).toLowerCase() || "unknown";
    const evidence = asArray(entry.evidence).map((item) =>
      bindEvidenceIntegrity(item, {
        evidenceRoot: resolvedEvidenceRoot,
        inputLedgerBound,
      }));
    const qualifiedEvidence = qualifiedRevenueEvidence(stage, evidence);
    for (const item of evidence) {
      evidenceRows.push({
        entry_kind: "revenue",
        entry_id: id,
        evidence_id: item.evidence_id,
        evidence_type: item.evidence_type,
        evidence_class: item.evidence_class,
        source_uri: item.source_uri,
        qualified_primary: qualifiedEvidence.includes(item),
        integrity_status: item.integrity_status,
        input_ledger_bound: item.input_ledger_bound,
        sha256: item.sha256,
        size_bytes: item.size_bytes,
      });
    }
    const recognised = hasPrimaryEvidence(stage, evidence);
    if (!recognised) {
      if (!evidence.length || !qualifiedEvidence.length) {
        blockers.push(`revenue:${id}:primary_evidence_missing`);
      } else if (!inputLedgerBound) {
        blockers.push(`revenue:${id}:input_ledger_unbound`);
      }
      for (const item of qualifiedEvidence.filter((candidate) => !candidate.integrity_verified)) {
        blockers.push(`revenue:${id}:${integrityBlockerSuffix(item.integrity_status)}`);
      }
    }
    const recognitionStatus = recognised
      ? "recognised_primary_evidence"
      : !evidence.length
        ? "excluded_missing_primary_evidence"
        : !qualifiedEvidence.length
          ? "excluded_unqualified_evidence"
          : !inputLedgerBound
            ? "excluded_unbound_input_ledger"
            : "excluded_unmaterialised_primary_evidence";
    return {
      id,
      stage,
      revenue_type: revenueType,
      claimed_amount_gbp: money(entry.amount_gbp),
      recognised_amount_gbp: recognised ? money(entry.amount_gbp) : 0,
      monthly_recurring_amount_gbp:
        recognised && revenueType === "recurring" ? money(entry.monthly_recurring_amount_gbp) : 0,
      confidence: clean(entry.confidence) || "low",
      recognition_status: recognitionStatus,
      evidence,
    };
  });
  const sumRows = (predicate, field = "recognised_amount_gbp") => money(
    rows.filter(predicate).reduce((total, row) => total + row[field], 0),
  );
  const cashReceived = sumRows((row) => row.stage === "cash_received");
  const cashEvidence = rows
    .filter((row) => row.stage === "cash_received" && row.recognition_status === "recognised_primary_evidence")
    .flatMap((row) => primaryEvidenceForStage(row.stage, row.evidence));
  const costRows = costInputRows.map((entry, index) => {
    const id = clean(entry.id) || `cost-${index + 1}`;
    const costType = clean(entry.cost_type).toLowerCase() || "unknown";
    const evidence = asArray(entry.evidence).map((item) =>
      bindEvidenceIntegrity(item, {
        evidenceRoot: resolvedEvidenceRoot,
        inputLedgerBound,
      }));
    const qualifiedEvidence = qualifiedCostEvidence(costType, evidence);
    for (const item of evidence) {
      evidenceRows.push({
        entry_kind: "cost",
        entry_id: id,
        evidence_id: item.evidence_id,
        evidence_type: item.evidence_type,
        evidence_class: item.evidence_class,
        source_uri: item.source_uri,
        qualified_primary: qualifiedEvidence.includes(item),
        integrity_status: item.integrity_status,
        input_ledger_bound: item.input_ledger_bound,
        sha256: item.sha256,
        size_bytes: item.size_bytes,
      });
    }
    const tracked = hasPrimaryCostEvidence(costType, evidence);
    if (!tracked) {
      if (!evidence.length || !qualifiedEvidence.length) {
        blockers.push(`cost:${id}:primary_evidence_missing`);
      } else if (!inputLedgerBound) {
        blockers.push(`cost:${id}:input_ledger_unbound`);
      }
      for (const item of qualifiedEvidence.filter((candidate) => !candidate.integrity_verified)) {
        blockers.push(`cost:${id}:${integrityBlockerSuffix(item.integrity_status)}`);
      }
    }
    const trackingStatus = tracked
      ? "tracked_primary_evidence"
      : !evidence.length
        ? "excluded_missing_primary_evidence"
        : !qualifiedEvidence.length
          ? "excluded_unqualified_evidence"
          : !inputLedgerBound
            ? "excluded_unbound_input_ledger"
            : "excluded_unmaterialised_primary_evidence";
    return {
      id,
      cost_type: costType,
      basis: clean(entry.basis).toLowerCase() || "unknown",
      claimed_amount_gbp: money(entry.amount_gbp),
      tracked_amount_gbp: tracked ? money(entry.amount_gbp) : 0,
      confidence: clean(entry.confidence).toLowerCase() || "low",
      tracking_status: trackingStatus,
      evidence,
    };
  });
  const sumCosts = (costType) => money(
    costRows
      .filter((row) => row.cost_type === costType)
      .reduce((total, row) => total + row.tracked_amount_gbp, 0),
  );
  const directProductionCost = sumCosts("direct_production");
  const labourReplacementCost = sumCosts("labour_replacement");
  const directProductionCostEvidenceBacked = costRows.some((row) =>
    row.cost_type === "direct_production" && row.tracking_status === "tracked_primary_evidence");
  const labourReplacementCostEvidenceBacked = costRows.some((row) =>
    row.cost_type === "labour_replacement" && row.tracking_status === "tracked_primary_evidence");
  const fullyLoadedCostEvidenceBacked =
    directProductionCostEvidenceBacked && labourReplacementCostEvidenceBacked;
  const contributionMargin = signedMoney(cashReceived - directProductionCost);
  const profit = signedMoney(contributionMargin - labourReplacementCost);
  const planningTargets = asArray(planningScenarios).map((scenario, index) => ({
    id: clean(scenario.id) || `target-${index + 1}`,
    label: clean(scenario.label) || `Target ${index + 1}`,
    classification: "target",
    status: "planning_only",
    target_period: clean(scenario.target_period) || null,
    metrics: normaliseTargetMetrics(scenario.metrics),
    confidence: clean(scenario.confidence).toLowerCase() || "low",
    evidence: asArray(scenario.evidence).map(normaliseEvidence),
  }));
  const commercialPlanningModel = buildCommercialPlanningModel();
  const primaryRevenueEvidenceCount = rows
    .filter((row) => row.recognition_status === "recognised_primary_evidence")
    .reduce((total, row) => total + primaryEvidenceForStage(row.stage, row.evidence).length, 0);
  const centralTarget = commercialPlanningModel.gross_monthly_revenue_target_gbp.central;
  const qualifiedEvidenceRows = evidenceRows.filter((row) => row.qualified_primary);
  const verifiedEvidenceRows = qualifiedEvidenceRows.filter(
    (row) => row.integrity_status === "verified" && row.input_ledger_bound === true,
  );
  const invalidEvidenceRows = qualifiedEvidenceRows.filter(
    (row) => row.integrity_status !== "verified",
  );
  const allClaimedEntriesRecognised =
    rows.every((row) => row.recognition_status === "recognised_primary_evidence") &&
    costRows.every((row) => row.tracking_status === "tracked_primary_evidence");
  const claimedEntryCount = rows.length + costRows.length;
  const commercialIntegrityVerdict = claimedEntryCount === 0
    ? "AMBER"
    : inputLedgerBound && allClaimedEntriesRecognised && invalidEvidenceRows.length === 0
      ? "GREEN"
      : "RED";
  const uniqueBlockers = [...new Set(blockers)];

  return {
    schema_version: 1,
    report_type: "weekly_commercial_scorecard",
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    currency: "GBP",
    period: {
      week_start: clean(period.week_start) || null,
      week_end: clean(period.week_end) || null,
    },
    accounting_policy: {
      realised_revenue_basis: "cash_received_with_stage_appropriate_primary_evidence",
      booked_revenue_basis: "booked_amount_with_stage_appropriate_primary_evidence",
      platform_receivables_basis: "unpaid_platform_earnings_with_primary_platform_statement",
      recurring_mrr_basis: "monthly_recurring_amount_with_qualifying_primary_evidence",
      variable_revenue_basis: "realised_variable_cash_only",
      non_additive_revenue_metrics: [
        "booked_revenue_gbp",
        "platform_receivables_gbp",
        "recurring_mrr_gbp",
      ],
      contribution_margin_formula: "realised_revenue_gbp - direct_production_cost_gbp",
      profit_formula: "contribution_margin_gbp - labour_replacement_cost_gbp",
      planning_scenario_classification: "target_not_forecast",
      accepted_primary_revenue_evidence_by_stage: PRIMARY_EVIDENCE_BY_STAGE,
      accepted_primary_cost_evidence_by_type: PRIMARY_COST_EVIDENCE_BY_TYPE,
    },
    revenue: {
      realised_revenue_gbp: cashReceived,
      realised_revenue_status: cashEvidence.length
        ? "evidence_backed"
        : "default_zero_no_primary_evidence",
      realised_revenue_confidence: cashEvidence.length ? weakestConfidence(cashEvidence) : "low",
      primary_revenue_evidence_count: cashEvidence.length,
      cash_received_gbp: cashReceived,
      booked_revenue_gbp: sumRows((row) => row.stage === "booked_revenue"),
      platform_receivables_gbp: sumRows((row) => row.stage === "platform_receivable"),
      recurring_mrr_gbp: sumRows(
        (row) => row.revenue_type === "recurring",
        "monthly_recurring_amount_gbp",
      ),
      variable_revenue_gbp: sumRows(
        (row) => row.stage === "cash_received" && row.revenue_type === "variable",
      ),
    },
    revenue_entries: rows,
    costs: {
      direct_production_cost_gbp: directProductionCost,
      direct_production_cost_status: directProductionCostEvidenceBacked
        ? "evidence_backed"
        : "unknown_no_primary_evidence",
      labour_replacement_cost_gbp: labourReplacementCost,
      labour_replacement_cost_status: labourReplacementCostEvidenceBacked
        ? "evidence_backed"
        : "unknown_no_primary_evidence",
      total_economic_cost_gbp: money(directProductionCost + labourReplacementCost),
      total_economic_cost_status: fullyLoadedCostEvidenceBacked
        ? "evidence_backed"
        : "unavailable_missing_cost_evidence",
    },
    economics: {
      contribution_margin_gbp: contributionMargin,
      contribution_margin_status: directProductionCostEvidenceBacked
        ? "evidence_backed"
        : "unavailable_missing_direct_cost_evidence",
      contribution_margin_rate: cashReceived > 0
        ? Math.round((contributionMargin / cashReceived) * 10_000) / 10_000
        : null,
      profit_gbp: profit,
      profit_status: fullyLoadedCostEvidenceBacked
        ? "evidence_backed"
        : "unavailable_missing_fully_loaded_cost_evidence",
    },
    cost_entries: costRows,
    commercial_planning_model: commercialPlanningModel,
    planning_vs_actual: {
      classification: "planning_target_vs_reconciled_actual",
      forecast_status: primaryRevenueEvidenceCount
        ? "not_modelled_actuals_available"
        : "unavailable_no_primary_evidence",
      realised_revenue_gbp: cashReceived,
      central_target_gbp: centralTarget,
      central_target_gap_gbp: money(Math.max(0, centralTarget - cashReceived)),
      primary_revenue_evidence_count: primaryRevenueEvidenceCount,
    },
    planning_targets: planningTargets,
    source_context: asArray(sourceContext).map(normaliseSourceContext),
    commercial_evidence_integrity: {
      schema_version: 1,
      report_type: "commercial_evidence_integrity_report",
      generated_at: generatedAt,
      verdict: commercialIntegrityVerdict,
      evidence_root: resolvedEvidenceRoot,
      input_ledger: inputLedger,
      claimed_entry_count: claimedEntryCount,
      qualified_primary_evidence_count: qualifiedEvidenceRows.length,
      verified_evidence_count: verifiedEvidenceRows.length,
      invalid_evidence_count: invalidEvidenceRows.length,
      evidence_rows: evidenceRows,
      blockers: uniqueBlockers,
    },
    blockers: uniqueBlockers,
    safety: {
      local_proof_only: true,
      planning_scenarios_are_targets_not_forecasts: true,
      planning_targets_excluded_from_actuals: true,
      planning_model_excluded_from_actuals: true,
      no_external_contact_or_spend: true,
      no_credentials_or_oauth_change: true,
      no_publish_or_external_posting: true,
      no_db_mutation: true,
    },
  };
}

module.exports = {
  PRIMARY_COST_EVIDENCE_BY_TYPE,
  PRIMARY_EVIDENCE_BY_STAGE,
  TARGET_METRICS,
  buildWeeklyCommercialScorecard,
  renderWeeklyCommercialScorecardMarkdown,
  writeWeeklyCommercialScorecard,
};
