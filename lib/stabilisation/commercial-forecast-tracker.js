"use strict";

const COMMERCIAL_BASELINE = Object.freeze({
  schema_version: "pulse-commercial-forecast-v1",
  classification: "planning_forecast_not_guarantee",
  currency: "GBP",
  as_of: "2026-07-25",
  channel_and_brand_value_today_gbp: Object.freeze({ low: 0, high: 1000 }),
  current_system_sale_value_gbp: Object.freeze({
    low: 5000,
    central_low: 12000,
    central_high: 15000,
    high: 20000,
  }),
  strategic_buyer_value_today_gbp: Object.freeze({ low: 20000, high: 40000 }),
  stabilised_90_day_value_gbp: Object.freeze({ low: 25000, high: 60000 }),
  replacement_cost_gbp: Object.freeze({
    lean_low: 75000,
    lean_high: 125000,
    commercial_low: 125000,
    commercial_high: 250000,
  }),
  monthly_revenue_scenarios_gbp: Object.freeze({
    present_scale: Object.freeze({ low: 0, high: 0 }),
    next_12_months_most_likely: Object.freeze({ low: 0, high: 500 }),
    small_functioning_channel: Object.freeze({ low: 300, high: 900 }),
    successful_side_business: Object.freeze({ low: 1000, high: 5000 }),
    strong_outcome: Object.freeze({ low: 5000, high: 15000 }),
    breakout_outcome: Object.freeze({ low: 15000, high: 30000 }),
  }),
  central_success_mrr_gbp: 3000,
  current_actual_mrr_gbp: null,
  current_actual_monthly_operating_cost_gbp: null,
  saas_productisation_status: "frozen_not_implemented",
  commercial_priority:
    "Prove the editorial product and dependable revenue before affiliate expansion, sponsorship systems or multi-tenant product work.",
});

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function compareActualsToForecast({
  actualMrrGbp = null,
  actualMonthlyOperatingCostGbp = null,
  measuredAt = null,
} = {}) {
  const actualMrr = finiteOrNull(actualMrrGbp);
  const actualCost = finiteOrNull(actualMonthlyOperatingCostGbp);
  const contribution =
    actualMrr === null || actualCost === null ? null : actualMrr - actualCost;
  return {
    schema_version: "pulse-commercial-actual-vs-forecast-v1",
    classification: "measured_actual_vs_planning_forecast",
    measured_at: measuredAt || null,
    actual_mrr_gbp: actualMrr,
    actual_monthly_operating_cost_gbp: actualCost,
    actual_monthly_contribution_gbp: contribution,
    central_success_mrr_gbp: COMMERCIAL_BASELINE.central_success_mrr_gbp,
    variance_from_central_success_gbp:
      actualMrr === null
        ? null
        : actualMrr - COMMERCIAL_BASELINE.central_success_mrr_gbp,
    actuals_complete: actualMrr !== null && actualCost !== null,
    forecast_is_guarantee: false,
  };
}

module.exports = {
  COMMERCIAL_BASELINE,
  compareActualsToForecast,
};
