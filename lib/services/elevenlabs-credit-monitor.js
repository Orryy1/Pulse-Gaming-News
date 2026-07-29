"use strict";

const MONITOR_SCHEMA = "pulse-elevenlabs-credit-monitor-v1";

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isoFromUnix(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildElevenLabsCreditMonitorArtifact(report = {}) {
  const safeSpendable = Math.max(
    0,
    Math.floor(finite(report.available_credits_before_request)),
  );
  const multiplier = Math.max(1, finite(report.estimate_multiplier, 1.25));
  const shortCost = Math.ceil(750 * multiplier);
  const longformCost = Math.ceil(10_000 * multiplier);
  const status = String(report.status || "").trim().toLowerCase();
  const warnings = [
    ...new Set(
      (Array.isArray(report.warnings) ? report.warnings : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    ),
  ];
  const allowPaidSynthesis =
    ["active", "trialing", "free"].includes(status) &&
    safeSpendable > 0;
  const verdict = !allowPaidSynthesis
    ? "BLOCKED"
    : warnings.length
      ? "WARN"
      : "GREEN";
  const actions = [];
  if (!allowPaidSynthesis) {
    actions.push(
      "paid_tts_blocked_use_qualified_local_tts_or_wait_for_reset",
    );
  }
  if (
    warnings.includes("included_credits_below_warning_threshold")
  ) {
    actions.push(
      "prefer_qualified_local_tts_while_below_warning_threshold",
    );
  }
  if (
    report.external_overage_enabled === true &&
    report.local_overage_allowed !== true
  ) {
    actions.push("keep_local_overage_hard_stop_enabled");
  }
  if (finite(report.current_overage_amount) > 0) {
    actions.push("operator_review_current_account_overage");
  }

  return {
    schema_version: MONITOR_SCHEMA,
    generated_at:
      String(report.generated_at || "").trim() ||
      new Date().toISOString(),
    provider: "elevenlabs",
    verdict,
    allow_paid_synthesis: allowPaidSynthesis,
    subscription: {
      tier: String(report.tier || "").trim() || null,
      status: String(report.status || "").trim() || null,
      currency: String(report.currency || "").trim() || null,
      current_overage_amount:
        String(report.current_overage_amount ?? "0"),
      external_overage_enabled:
        report.external_overage_enabled === true,
      local_overage_allowed: report.local_overage_allowed === true,
    },
    included_credits: {
      used: finite(report.used_credits),
      limit: finite(report.included_credit_limit),
      remaining: finite(report.included_credits_remaining),
      remaining_percent: finite(report.remaining_percent),
      hard_reserve: finite(report.hard_reserve_credits),
      safe_spendable: safeSpendable,
      unobserved_committed: finite(
        report.unobserved_committed_credits,
      ),
      active_reserved: finite(report.active_reserved_credits),
    },
    next_reset_at: isoFromUnix(report.next_reset_unix),
    warning_threshold_percent: finite(
      report.warning_threshold_percent,
      50,
    ),
    conservative_estimate_multiplier: multiplier,
    capacity: {
      short_750_characters: {
        estimated_credits: shortCost,
        safe_renders: Math.floor(safeSpendable / shortCost),
      },
      longform_10000_characters: {
        estimated_credits: longformCost,
        safe_renders: Math.floor(safeSpendable / longformCost),
      },
    },
    warnings,
    actions,
    safety: {
      secrets_excluded: true,
      permits_overage: false,
      mutates_subscription: false,
      external_publish_authority: false,
      oauth_mutation_authority: false,
      database_mutation_authority: false,
    },
  };
}

module.exports = {
  MONITOR_SCHEMA,
  buildElevenLabsCreditMonitorArtifact,
};
