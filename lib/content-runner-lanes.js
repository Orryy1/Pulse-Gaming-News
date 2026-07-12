"use strict";

const FORBIDDEN_CONTENT_KINDS = Object.freeze([
  "publish",
  "publish_window_watchdog",
  "instagram_token_refresh",
  "tiktok_auth_check",
]);

const CONTENT_RUNNER_LANES = Object.freeze([
  Object.freeze({
    id: "content-runway",
    kinds: Object.freeze(["candidate_supply_monitor", "fresh_production_refill"]),
  }),
  Object.freeze({
    id: "content-repair",
    kinds: Object.freeze([
      "fresh_review_script_repair",
      "safe_auto_repair_runner",
      "local_tts_doctor",
      "local_tts_retry_recovery",
    ]),
  }),
  Object.freeze({
    id: "content-ops",
    kinds: Object.freeze([
      "hunt",
      "produce",
      "analytics",
      "scoring_digest",
      "engage",
      "engage_first_hour",
      "blog_rebuild",
      "db_backup",
      "instagram_pending_verify",
      "overnight_produce_sweep",
      "overnight_analytics_backfill",
      "overnight_claude_analyst",
      "overnight_morning_digest",
    ]),
  }),
  Object.freeze({
    id: "content-learning",
    kinds: Object.freeze([
      "live_performance_analyst",
      "studio_analytics_loop",
      "commercial_learning_loop",
      "competitor_forensics_lab",
      "competitor_quality_gate",
      "autonomous_feedback_monitor",
      "continuous_learning_loop",
    ]),
  }),
]);

function assertSafeContentRunnerLanes(lanes) {
  for (const lane of lanes || []) {
    if (!String(lane?.id || "").trim()) throw new Error("Content runner lane requires an id");
    if (!Array.isArray(lane?.kinds) || lane.kinds.length === 0) {
      throw new Error(`Content runner lane ${lane?.id || "unknown"} requires non-empty kinds`);
    }
    for (const kind of lane.kinds) {
      if (FORBIDDEN_CONTENT_KINDS.includes(kind)) {
        throw new Error(`Forbidden content runner job kind: ${kind}`);
      }
    }
  }
  return true;
}

module.exports = {
  CONTENT_RUNNER_LANES,
  FORBIDDEN_CONTENT_KINDS,
  assertSafeContentRunnerLanes,
};
