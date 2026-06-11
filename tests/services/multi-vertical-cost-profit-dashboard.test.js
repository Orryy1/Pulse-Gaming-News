"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildMultiVerticalCostProfitDashboard,
  writeMultiVerticalCostProfitDashboard,
} = require("../../lib/multi-vertical-cost-profit-dashboard");

test("multi-vertical framework keeps gaming live and gates finance and crypto behind a firewall", () => {
  const report = buildMultiVerticalCostProfitDashboard({
    generatedAt: "2026-06-11T12:00:00.000Z",
    financeCryptoFirewallReport: { verdict: "BLOCKED", blockers: ["finance_crypto:operator_review_required"] },
  });

  const gaming = report.multi_vertical_expansion_plan.verticals.find((vertical) => vertical.id === "pulse_gaming");
  const finance = report.multi_vertical_expansion_plan.verticals.find((vertical) => vertical.id === "pulse_finance");
  const crypto = report.multi_vertical_expansion_plan.verticals.find((vertical) => vertical.id === "pulse_crypto");

  assert.equal(gaming.status, "live_core");
  assert.equal(finance.status, "blocked_by_firewall");
  assert.equal(crypto.status, "blocked_by_firewall");
  assert.equal(report.finance_crypto_firewall_expansion_status.verdict, "BLOCKED");
  assert.ok(report.finance_crypto_firewall_expansion_status.hard_rules.includes("no_buy_sell_hold_language"));
  assert.equal(report.safety.no_finance_crypto_publish_without_firewall, true);
});

test("cost profit dashboard tracks render cost, platform profit, affiliate and sponsor performance", () => {
  const report = buildMultiVerticalCostProfitDashboard({
    renderJobs: [
      {
        story_id: "story-a",
        platform: "youtube_shorts",
        render_cost: 1.25,
        api_cost: 0.4,
        tts_cost: 0.7,
        sfx_cost: 0.1,
        storage_cost: 0.05,
        views: 1200,
        realized_revenue: 3.5,
      },
      {
        story_id: "story-b",
        platform: "instagram_reels",
        render_cost: 1.1,
        api_cost: 0.35,
        tts_cost: 0.55,
        sfx_cost: 0.05,
        storage_cost: 0.05,
        views: 900,
        realized_revenue: 1.5,
      },
    ],
    affiliateAttribution: {
      total_clicks: 42,
      total_realized_revenue: 5,
      stories: [{ story_id: "story-a", clicks: 30, realized_revenue: 4 }],
    },
    sponsorReadiness: {
      verdict: "PASS",
      sponsor_media_kit: {
        ready_for_outreach: true,
        pricing_recommendations: {
          ranges: [{ format: "sponsor-safe Short integration", floor: 50, ceiling: 100 }],
        },
      },
      sponsor_pitch_pack: { outreach_sent: false },
    },
  });

  assert.equal(report.cost_profit_dashboard.render_count, 2);
  assert.equal(report.cost_profit_dashboard.total_cost, 4.6);
  assert.equal(report.cost_profit_dashboard.cost_per_render, 2.3);
  assert.equal(report.cost_profit_dashboard.realized_revenue, 5);
  assert.equal(report.cost_profit_dashboard.net_profit, 0.4);
  assert.equal(report.cost_profit_dashboard.platforms.youtube_shorts.views, 1200);
  assert.equal(report.cost_profit_dashboard.platforms.youtube_shorts.net_profit, 1);
  assert.equal(report.cost_profit_dashboard.affiliate_performance.total_clicks, 42);
  assert.equal(report.cost_profit_dashboard.sponsor_performance.ready_for_outreach, true);
  assert.equal(report.cost_profit_dashboard.sponsor_performance.realized_sponsor_revenue, 0);
  assert.equal(report.valuation_metrics.revenue_run_rate.realized_monthly, 5);
  assert.equal(report.valuation_metrics.profit_status, "profitable_on_realized_revenue");
});

test("multi-vertical cost profit dashboard writes required artefacts and exposes the npm script", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-multi-vertical-profit-"));
  const report = buildMultiVerticalCostProfitDashboard({
    renderJobs: [{ story_id: "story-a", platform: "youtube_shorts", total_cost: 2, realized_revenue: 0 }],
  });
  const written = await writeMultiVerticalCostProfitDashboard(report, { outputDir: root });

  assert.equal(await fs.pathExists(written.reportJson), true);
  assert.equal(await fs.pathExists(written.reportMarkdown), true);
  assert.equal(await fs.pathExists(written.multiVerticalExpansionPlan), true);
  assert.equal(await fs.pathExists(written.financeCryptoFirewallExpansionStatus), true);
  assert.equal(await fs.pathExists(written.costProfitDashboard), true);
  assert.equal(await fs.pathExists(written.valuationMetrics), true);

  const packageJson = await fs.readJson(path.resolve(__dirname, "../../package.json"));
  assert.equal(packageJson.scripts["ops:multi-vertical-cost-profit"], "node tools/multi-vertical-cost-profit-dashboard.js");
});
