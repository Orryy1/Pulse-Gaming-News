"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const VERTICALS = [
  {
    id: "pulse_gaming",
    label: "Pulse Gaming",
    status: "live_core",
    allowed_now: true,
    expansion_order: 1,
    required_gate: "gaming_autonomy_control_tower",
  },
  {
    id: "pulse_tech_ai",
    label: "Pulse Tech / AI",
    status: "planned_gated",
    allowed_now: false,
    expansion_order: 2,
    required_gate: "tech_ai_source_policy_and_model_claims_gate",
  },
  {
    id: "pulse_gear",
    label: "Pulse Gear",
    status: "planned_gated",
    allowed_now: false,
    expansion_order: 3,
    required_gate: "affiliate_disclosure_and_product_evidence_gate",
  },
  {
    id: "pulse_finance",
    label: "Pulse Finance",
    status: "blocked_by_firewall",
    allowed_now: false,
    expansion_order: 4,
    required_gate: "finance_crypto_firewall_operator_approved",
  },
  {
    id: "pulse_crypto",
    label: "Pulse Crypto",
    status: "blocked_by_firewall",
    allowed_now: false,
    expansion_order: 5,
    required_gate: "finance_crypto_firewall_operator_approved",
  },
];

const FINANCE_CRYPTO_HARD_RULES = [
  "no_buy_sell_hold_language",
  "no_pump_or_profit_promises",
  "no_leverage_promotion",
  "no_token_shilling",
  "no_personal_financial_advice",
  "strict_disclosure_required",
  "human_review_required",
];

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalise(value) {
  return clean(value).toLowerCase();
}

function money(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function numberValue(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function passLike(value) {
  return ["pass", "passed", "green", "ready", "clear", "ok"].includes(normalise(value));
}

function buildFinanceCryptoFirewallExpansionStatus(financeCryptoFirewallReport = {}) {
  const verdict = passLike(financeCryptoFirewallReport.verdict || financeCryptoFirewallReport.status)
    ? "PASS"
    : "BLOCKED";
  return {
    schema_version: 1,
    verdict,
    source_verdict: clean(financeCryptoFirewallReport.verdict || financeCryptoFirewallReport.status || "missing"),
    blockers: asArray(financeCryptoFirewallReport.blockers || financeCryptoFirewallReport.failures || financeCryptoFirewallReport.reason_codes),
    hard_rules: FINANCE_CRYPTO_HARD_RULES,
    finance_ready_for_publish: false,
    crypto_ready_for_publish: false,
    next_operator_action: verdict === "PASS"
      ? "keep_finance_crypto_human_reviewed_until_channel_specific_controls_exist"
      : "complete_operator_finance_crypto_firewall_review_before_any_finance_or_crypto_vertical_publish",
  };
}

function buildMultiVerticalExpansionPlan({ financeCryptoFirewallReport = {}, generatedAt = new Date().toISOString() } = {}) {
  const firewall = buildFinanceCryptoFirewallExpansionStatus(financeCryptoFirewallReport);
  const verticals = VERTICALS.map((vertical) => {
    if (vertical.id !== "pulse_finance" && vertical.id !== "pulse_crypto") return { ...vertical };
    return {
      ...vertical,
      status: firewall.verdict === "PASS" ? "firewall_present_but_operator_gated" : "blocked_by_firewall",
      allowed_now: false,
      firewall_verdict: firewall.verdict,
    };
  });
  return {
    schema_version: 1,
    generated_at: generatedAt,
    current_live_vertical: "pulse_gaming",
    next_expansion_candidate: "pulse_tech_ai",
    verticals,
    expansion_rules: {
      gaming_pipeline_is_not_reused_casually: true,
      finance_crypto_firewall_required: true,
      disabled_verticals_do_not_publish: true,
      operator_approval_required_for_new_vertical: true,
    },
  };
}

function renderJobCost(job = {}) {
  if (Number.isFinite(Number(job.total_cost))) return money(job.total_cost);
  return money(
    numberValue(job.render_cost, 0) +
      numberValue(job.api_cost, 0) +
      numberValue(job.tts_cost, 0) +
      numberValue(job.sfx_cost, 0) +
      numberValue(job.storage_cost, 0) +
      numberValue(job.other_cost, 0),
  );
}

function buildPlatformSummary(renderJobs = []) {
  const platforms = {};
  for (const job of asArray(renderJobs)) {
    const platform = clean(job.platform || "unassigned");
    const row = platforms[platform] || {
      render_count: 0,
      views: 0,
      cost: 0,
      realized_revenue: 0,
      net_profit: 0,
    };
    row.render_count += 1;
    row.views += numberValue(job.views, 0);
    row.cost = money(row.cost + renderJobCost(job));
    row.realized_revenue = money(row.realized_revenue + numberValue(job.realized_revenue, 0));
    row.net_profit = money(row.realized_revenue - row.cost);
    platforms[platform] = row;
  }
  return platforms;
}

function affiliateRevenue(affiliateAttribution = {}, renderJobs = []) {
  const explicit = Number(affiliateAttribution.total_realized_revenue ?? affiliateAttribution.realized_revenue);
  if (Number.isFinite(explicit)) return money(explicit);
  return money(asArray(renderJobs).reduce((sum, job) => sum + numberValue(job.realized_revenue, 0), 0));
}

function buildCostProfitDashboard({
  renderJobs = [],
  affiliateAttribution = {},
  sponsorReadiness = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const jobs = asArray(renderJobs);
  const totalCost = money(jobs.reduce((sum, job) => sum + renderJobCost(job), 0));
  const realizedRevenue = affiliateRevenue(affiliateAttribution, jobs);
  const sponsorKit = sponsorReadiness.sponsor_media_kit || {};
  const sponsorPitch = sponsorReadiness.sponsor_pitch_pack || {};
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    render_count: jobs.length,
    total_cost: totalCost,
    cost_per_render: jobs.length ? money(totalCost / jobs.length) : 0,
    realized_revenue: realizedRevenue,
    net_profit: money(realizedRevenue - totalCost),
    platforms: buildPlatformSummary(jobs),
    affiliate_performance: {
      total_clicks: numberValue(affiliateAttribution.total_clicks, 0),
      realized_revenue: affiliateRevenue(affiliateAttribution, jobs),
      story_count: asArray(affiliateAttribution.stories).length,
      attribution_status: clean(affiliateAttribution.status || affiliateAttribution.verdict || "local_proof"),
    },
    sponsor_performance: {
      readiness_verdict: clean(sponsorReadiness.verdict || "unknown"),
      ready_for_outreach: sponsorKit.ready_for_outreach === true,
      draft_pricing_ranges: asArray(sponsorKit.pricing_recommendations?.ranges),
      outreach_sent: sponsorPitch.outreach_sent === true,
      realized_sponsor_revenue: 0,
      draft_pricing_not_counted_as_revenue: true,
    },
    cost_breakdown: {
      render: money(jobs.reduce((sum, job) => sum + numberValue(job.render_cost, 0), 0)),
      api: money(jobs.reduce((sum, job) => sum + numberValue(job.api_cost, 0), 0)),
      tts: money(jobs.reduce((sum, job) => sum + numberValue(job.tts_cost, 0), 0)),
      sfx: money(jobs.reduce((sum, job) => sum + numberValue(job.sfx_cost, 0), 0)),
      storage: money(jobs.reduce((sum, job) => sum + numberValue(job.storage_cost, 0), 0)),
    },
    safety: {
      local_proof_only: true,
      no_external_financial_claims: true,
      no_sponsor_outreach_sent: true,
      draft_sponsor_pricing_excluded_from_revenue: true,
    },
  };
}

function buildValuationMetrics(costProfitDashboard = {}) {
  const realizedRevenue = numberValue(costProfitDashboard.realized_revenue, 0);
  const netProfit = numberValue(costProfitDashboard.net_profit, 0);
  return {
    schema_version: 1,
    mode: "LOCAL_PROOF",
    revenue_run_rate: {
      realized_monthly: money(realizedRevenue),
      annualised_from_current_snapshot: money(realizedRevenue * 12),
      sponsor_draft_pricing_excluded: true,
    },
    gross_margin: realizedRevenue > 0 ? money(netProfit / realizedRevenue) : 0,
    content_asset_count: numberValue(costProfitDashboard.render_count, 0),
    profit_status: netProfit > 0 ? "profitable_on_realized_revenue" : netProfit < 0 ? "loss_on_realized_revenue" : "break_even_or_no_revenue",
    valuation_inputs_ready: realizedRevenue > 0 && numberValue(costProfitDashboard.render_count, 0) > 0,
    caution:
      "This is a local operating dashboard, not a business valuation, investment claim or public revenue statement.",
  };
}

function buildMultiVerticalCostProfitDashboard({
  renderJobs = [],
  affiliateAttribution = {},
  sponsorReadiness = {},
  financeCryptoFirewallReport = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const multiVerticalExpansionPlan = buildMultiVerticalExpansionPlan({ financeCryptoFirewallReport, generatedAt });
  const financeCryptoFirewallExpansionStatus = buildFinanceCryptoFirewallExpansionStatus(financeCryptoFirewallReport);
  const costProfitDashboard = buildCostProfitDashboard({
    renderJobs,
    affiliateAttribution,
    sponsorReadiness,
    generatedAt,
  });
  const valuationMetrics = buildValuationMetrics(costProfitDashboard);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict: financeCryptoFirewallExpansionStatus.verdict === "PASS" ? "AMBER" : "PASS",
    multi_vertical_expansion_plan: multiVerticalExpansionPlan,
    finance_crypto_firewall_expansion_status: financeCryptoFirewallExpansionStatus,
    cost_profit_dashboard: costProfitDashboard,
    valuation_metrics: valuationMetrics,
    safety: {
      local_proof_only: true,
      no_live_publish: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_finance_crypto_publish_without_firewall: true,
      no_public_revenue_or_valuation_claim: true,
    },
  };
}

function renderMarkdown(report = {}) {
  const dashboard = report.cost_profit_dashboard || {};
  const valuation = report.valuation_metrics || {};
  const lines = [
    "# Multi-Vertical Cost / Profit Dashboard",
    "",
    `Verdict: ${report.verdict || "UNKNOWN"}`,
    `Generated: ${report.generated_at || "unknown"}`,
    "",
    "## Expansion",
  ];
  for (const vertical of asArray(report.multi_vertical_expansion_plan?.verticals)) {
    lines.push(`- ${vertical.label}: ${vertical.status}`);
  }
  lines.push(
    "",
    "## Cost / Profit",
    `- Renders: ${dashboard.render_count ?? 0}`,
    `- Total cost: ${dashboard.total_cost ?? 0}`,
    `- Realised revenue: ${dashboard.realized_revenue ?? 0}`,
    `- Net profit: ${dashboard.net_profit ?? 0}`,
    "",
    "## Valuation Inputs",
    `- Profit status: ${valuation.profit_status || "unknown"}`,
    `- Annualised realised run-rate: ${valuation.revenue_run_rate?.annualised_from_current_snapshot ?? 0}`,
    "",
    "## Safety",
    "- LOCAL_PROOF only.",
    "- Finance and crypto remain blocked from publishing until their firewall and operator review pass.",
    "- Draft sponsor pricing is not counted as realised revenue.",
  );
  return `${lines.join("\n")}\n`;
}

async function writeMultiVerticalCostProfitDashboard(report = {}, { outputDir } = {}) {
  if (!outputDir) throw new Error("writeMultiVerticalCostProfitDashboard requires outputDir");
  await fs.ensureDir(outputDir);
  const paths = {
    reportJson: path.join(outputDir, "multi_vertical_cost_profit_report.json"),
    reportMarkdown: path.join(outputDir, "multi_vertical_cost_profit_report.md"),
    multiVerticalExpansionPlan: path.join(outputDir, "multi_vertical_expansion_plan.json"),
    financeCryptoFirewallExpansionStatus: path.join(outputDir, "finance_crypto_firewall_expansion_status.json"),
    costProfitDashboard: path.join(outputDir, "cost_profit_dashboard.json"),
    valuationMetrics: path.join(outputDir, "valuation_metrics.json"),
  };
  await fs.writeJson(paths.reportJson, report, { spaces: 2 });
  await fs.outputFile(paths.reportMarkdown, renderMarkdown(report));
  await fs.writeJson(paths.multiVerticalExpansionPlan, report.multi_vertical_expansion_plan || {}, { spaces: 2 });
  await fs.writeJson(paths.financeCryptoFirewallExpansionStatus, report.finance_crypto_firewall_expansion_status || {}, { spaces: 2 });
  await fs.writeJson(paths.costProfitDashboard, report.cost_profit_dashboard || {}, { spaces: 2 });
  await fs.writeJson(paths.valuationMetrics, report.valuation_metrics || {}, { spaces: 2 });
  return paths;
}

module.exports = {
  FINANCE_CRYPTO_HARD_RULES,
  VERTICALS,
  buildCostProfitDashboard,
  buildFinanceCryptoFirewallExpansionStatus,
  buildMultiVerticalCostProfitDashboard,
  buildMultiVerticalExpansionPlan,
  buildValuationMetrics,
  renderMarkdown,
  writeMultiVerticalCostProfitDashboard,
};
