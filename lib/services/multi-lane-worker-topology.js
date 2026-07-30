"use strict";

const POOLS = Object.freeze([
  Object.freeze({
    pool_id: "breaking_planning",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "critical_planning",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "runway_monitor",
    instances: 1,
    lease_ms: 90 * 1000,
    heartbeat_ms: 20 * 1000,
  }),
  Object.freeze({
    pool_id: "window_deadline",
    instances: 2,
    lease_ms: 90 * 1000,
    heartbeat_ms: 20 * 1000,
  }),
  Object.freeze({
    pool_id: "editorial_evidence_capture",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "editorial_preparation",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "governed_review",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "critical_publication",
    instances: 2,
    lease_ms: 90 * 1000,
    heartbeat_ms: 20 * 1000,
  }),
  Object.freeze({
    pool_id: "breaking_production",
    instances: 2,
  }),
  Object.freeze({
    pool_id: "evergreen_production",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "longform_production",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "general_production",
    instances: 1,
  }),
  Object.freeze({
    pool_id: "maintenance",
    instances: 1,
  }),
]);

function poolForKind(kind) {
  if (
    kind === "governed_youtube_window_inventory_monitor" ||
    kind === "governed_youtube_runway_slo_monitor"
  ) {
    return "runway_monitor";
  }
  if (
    kind ===
      "prepare_governed_autonomous_pre_t90_window" ||
    kind === "governed_youtube_runway_t90"
  ) {
    return "window_deadline";
  }
  if (
    kind === "publish" ||
    kind === "admit_governed_publication" ||
    kind === "dispatch_governed_publication" ||
    kind === "governed_youtube_runway_t60" ||
    kind === "prestage_governed_youtube_release" ||
    kind === "verify_governed_youtube_release_tminus15" ||
    kind === "verify_governed_youtube_release_t0" ||
    kind === "governed_youtube_runway_tplus15"
  ) {
    return "critical_publication";
  }
  if (
    kind === "breaking_story_discovery" ||
    kind === "plan_breaking_short"
  ) {
    return "breaking_planning";
  }
  if (
    kind === "hunt" ||
    kind === "governed_editorial_evidence_backfill" ||
    kind === "governed_multi_lane_plan" ||
    kind ===
      "plan_governed_autonomous_window_production" ||
    kind ===
      "prime_governed_youtube_window_checkpoints" ||
    kind === "evergreen_candidate_builder" ||
    kind === "plan_evergreen_short" ||
    kind === "plan_weekly_longform"
  ) {
    return "critical_planning";
  }
  if (kind === "governed_editorial_evidence_discovery") {
    return "editorial_evidence_capture";
  }
  if (
    kind === "prepare_editorial_inventory" ||
    kind === "reconcile_editorial_inventory"
  ) {
    return "editorial_preparation";
  }
  if (
    kind === "review_breaking_short" ||
    kind === "review_evergreen_short" ||
    kind === "review_weekly_longform"
  ) {
    return "governed_review";
  }
  if (
    kind === "produce_breaking_short" ||
    kind.startsWith("breaking_produce")
  ) {
    return "breaking_production";
  }
  if (
    kind === "enrich_evergreen_short" ||
    kind === "materialize_evergreen_motion_repair" ||
    kind === "produce_evergreen_short" ||
    kind.startsWith("evergreen_produce")
  ) {
    return "evergreen_production";
  }
  if (
    kind === "enrich_weekly_longform" ||
    kind === "produce_weekly_longform" ||
    kind.startsWith("longform_") ||
    kind === "roundup_weekly" ||
    kind === "roundup_monthly_topics"
  ) {
    return "longform_production";
  }
  if (
    kind === "produce" ||
    kind === "roundup_fanout" ||
    kind.startsWith("derivative_")
  ) {
    return "general_production";
  }
  return "maintenance";
}

function buildMultiLaneWorkerDefinitions({
  handlers,
  kinds = null,
} = {}) {
  if (!handlers || typeof handlers !== "object") {
    throw new Error("multi_lane_worker_handlers_required");
  }
  const allowedKinds =
    kinds === null
      ? null
      : new Set(Array.isArray(kinds) ? kinds : [kinds]);
  const kindsByPool = new Map(
    POOLS.map((pool) => [pool.pool_id, []]),
  );
  for (const kind of Object.keys(handlers).sort()) {
    if (allowedKinds && !allowedKinds.has(kind)) continue;
    kindsByPool.get(poolForKind(kind)).push(kind);
  }
  return POOLS.filter(
    (pool) => kindsByPool.get(pool.pool_id).length > 0,
  ).map((pool) => ({
    pool_id: pool.pool_id,
    instances: pool.instances,
    ...(pool.lease_ms
      ? { lease_ms: pool.lease_ms }
      : {}),
    ...(pool.heartbeat_ms
      ? { heartbeat_ms: pool.heartbeat_ms }
      : {}),
    kinds: kindsByPool.get(pool.pool_id),
  }));
}

module.exports = {
  POOLS,
  buildMultiLaneWorkerDefinitions,
};
