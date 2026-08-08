"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildMultiLaneWorkerDefinitions,
} = require("../../lib/services/multi-lane-worker-topology");

test("worker topology assigns every registered handler exactly once", () => {
  const handlers = {
    hunt() {},
    governed_multi_lane_plan() {},
    publish() {},
    produce_breaking_short() {},
    produce_evergreen_short() {},
    longform_evidence_refresh() {},
    analytics() {},
  };
  const definitions = buildMultiLaneWorkerDefinitions({ handlers });
  const assignments = definitions.flatMap((definition) =>
    definition.kinds.map((kind) => ({
      kind,
      pool: definition.pool_id,
    })),
  );

  assert.deepEqual(
    assignments.map((item) => item.kind).sort(),
    Object.keys(handlers).sort(),
  );
  assert.equal(
    new Set(assignments.map((item) => item.kind)).size,
    assignments.length,
  );
});

test("breaking, evergreen and longform work cannot share a blocking production runner", () => {
  const handlers = {
    produce_breaking_short() {},
    produce_evergreen_short() {},
    materialize_evergreen_motion_repair() {},
    produce_weekly_longform() {},
    publish() {},
    governed_youtube_runway_t60() {},
  };
  const definitions = buildMultiLaneWorkerDefinitions({ handlers });
  const poolFor = (kind) =>
    definitions.find((definition) =>
      definition.kinds.includes(kind),
    )?.pool_id;

  assert.equal(poolFor("produce_breaking_short"), "breaking_production");
  assert.equal(
    poolFor("produce_evergreen_short"),
    "evergreen_production",
  );
  assert.equal(
    poolFor("materialize_evergreen_motion_repair"),
    "evergreen_production",
  );
  assert.equal(
    poolFor("produce_weekly_longform"),
    "longform_production",
  );
  assert.equal(poolFor("publish"), "critical_publication");
  assert.equal(
    poolFor("governed_youtube_runway_t60"),
    "critical_publication",
  );
  assert.equal(
    new Set([
      poolFor("produce_breaking_short"),
      poolFor("produce_evergreen_short"),
      poolFor("produce_weekly_longform"),
      poolFor("publish"),
    ]).size,
    4,
  );
});

test("breaking production receives two independent runners while longform receives one", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      produce_breaking_short() {},
      produce_weekly_longform() {},
    },
  });
  const breaking = definitions.find(
    (definition) => definition.pool_id === "breaking_production",
  );
  const longform = definitions.find(
    (definition) => definition.pool_id === "longform_production",
  );

  assert.equal(breaking.instances, 2);
  assert.equal(longform.instances, 1);
});

test("breaking verification has dedicated capacity while slower planners share the reserved planning runner", () => {
  const breakingKinds = [
    "breaking_story_discovery",
    "plan_breaking_short",
  ];
  const sharedPlanningKinds = [
    "hunt",
    "governed_editorial_evidence_backfill",
    "evergreen_candidate_builder",
    "governed_multi_lane_plan",
    "prime_governed_youtube_window_checkpoints",
    "plan_evergreen_short",
    "plan_weekly_longform",
  ];
  const handlers = Object.fromEntries(
    [...breakingKinds, ...sharedPlanningKinds].map((kind) => [
      kind,
      () => {},
    ]),
  );
  const definitions = buildMultiLaneWorkerDefinitions({ handlers });
  const breaking = definitions.find(
    (definition) => definition.pool_id === "breaking_planning",
  );
  const planning = definitions.find(
    (definition) => definition.pool_id === "critical_planning",
  );

  assert.equal(breaking.instances, 2);
  assert.deepEqual(breaking.kinds.sort(), breakingKinds.sort());
  assert.deepEqual(
    planning.kinds.sort(),
    sharedPlanningKinds.sort(),
  );
});

test("slow editorial evidence capture has two dedicated runners and cannot block inventory preparation", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      breaking_story_discovery() {},
      governed_multi_lane_plan() {},
      governed_editorial_evidence_discovery() {},
      prepare_editorial_inventory() {},
      reconcile_editorial_inventory() {},
    },
  });
  const evidenceCapture = definitions.find(
    (definition) =>
      definition.pool_id === "editorial_evidence_capture",
  );
  const preparation = definitions.find(
    (definition) =>
      definition.pool_id === "editorial_preparation",
  );

  assert.equal(evidenceCapture.instances, 2);
  assert.deepEqual(evidenceCapture.kinds, [
    "governed_editorial_evidence_discovery",
  ]);
  assert.equal(preparation.instances, 1);
  assert.deepEqual(preparation.kinds, [
    "prepare_editorial_inventory",
    "reconcile_editorial_inventory",
  ]);
  assert.notEqual(evidenceCapture.pool_id, preparation.pool_id);
});

test("governed review has independent capacity and cannot stall rendering or publication", () => {
  const reviewKinds = [
    "review_breaking_short",
    "review_evergreen_short",
    "review_weekly_longform",
  ];
  const handlers = Object.fromEntries(
    [
      ...reviewKinds,
      "produce_breaking_short",
      "produce_evergreen_short",
      "produce_weekly_longform",
      "admit_governed_publication",
    ].map((kind) => [kind, () => {}]),
  );
  const definitions = buildMultiLaneWorkerDefinitions({ handlers });
  const review = definitions.find(
    (definition) => definition.pool_id === "governed_review",
  );

  assert.equal(review.instances, 2);
  assert.deepEqual(review.kinds.sort(), reviewKinds.sort());
  assert.equal(
    definitions
      .filter((definition) =>
        definition.kinds.some((kind) => reviewKinds.includes(kind)),
      )
      .length,
    1,
  );
});

test("critical publication claims expire before the bounded T-70 recovery window", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      prestage_governed_youtube_release() {},
      verify_governed_youtube_release_tminus15() {},
      verify_governed_youtube_release_t0() {},
    },
  });
  const publication = definitions.find(
    (definition) =>
      definition.pool_id === "critical_publication",
  );

  assert.equal(
    publication.instances,
    2,
    "one stalled critical-publication handler must not consume the only exact-window worker",
  );
  assert.equal(publication.lease_ms, 90_000);
  assert.equal(publication.heartbeat_ms, 20_000);
  assert.ok(
    publication.heartbeat_ms < publication.lease_ms,
  );
});

test("runway monitors run serially in isolated short-lease capacity", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      governed_youtube_window_inventory_monitor() {},
      governed_youtube_runway_slo_monitor() {},
      hunt() {},
      evergreen_candidate_builder() {},
    },
  });
  const poolFor = (kind) =>
    definitions.find((definition) =>
      definition.kinds.includes(kind),
    );
  const runwayMonitor = poolFor(
    "governed_youtube_window_inventory_monitor",
  );

  assert.equal(runwayMonitor.pool_id, "runway_monitor");
  assert.equal(runwayMonitor.instances, 1);
  assert.equal(runwayMonitor.lease_ms, 90_000);
  assert.equal(runwayMonitor.heartbeat_ms, 20_000);
  assert.deepEqual(runwayMonitor.kinds.sort(), [
    "governed_youtube_runway_slo_monitor",
    "governed_youtube_window_inventory_monitor",
  ]);
  assert.equal(poolFor("hunt").pool_id, "critical_planning");
  assert.equal(
    poolFor("evergreen_candidate_builder").pool_id,
    "critical_planning",
  );
  assert.notEqual(
    runwayMonitor.pool_id,
    poolFor("hunt").pool_id,
  );
});

test("exact-window planning has bounded isolated capacity that hunt cannot starve", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      plan_governed_autonomous_window_production() {},
      hunt() {},
      governed_multi_lane_plan() {},
    },
  });
  const exactWindow = definitions.find(
    (definition) =>
      definition.pool_id === "exact_window_planning",
  );
  const sharedPlanning = definitions.find(
    (definition) =>
      definition.pool_id === "critical_planning",
  );

  assert.equal(exactWindow.instances, 1);
  assert.deepEqual(exactWindow.kinds, [
    "plan_governed_autonomous_window_production",
  ]);
  assert.deepEqual(sharedPlanning.kinds.sort(), [
    "governed_multi_lane_plan",
    "hunt",
  ]);
  assert.notEqual(
    exactWindow.pool_id,
    sharedPlanning.pool_id,
  );
});

test("T-90 deadline work has two isolated short-lease runners that hunt and exact-window planning cannot starve", () => {
  const deadlineKinds = [
    "prepare_governed_autonomous_pre_t90_window",
    "governed_youtube_runway_t90",
  ];
  const planningKinds = [
    "hunt",
    "governed_editorial_evidence_backfill",
  ];
  const exactWindowKinds = [
    "plan_governed_autonomous_window_production",
  ];
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: Object.fromEntries(
      [
        ...deadlineKinds,
        ...planningKinds,
        ...exactWindowKinds,
      ].map((kind) => [kind, () => {}]),
    ),
  });
  const deadline = definitions.find(
    (definition) => definition.pool_id === "window_deadline",
  );
  const planning = definitions.find(
    (definition) =>
      definition.pool_id === "critical_planning",
  );
  const exactWindow = definitions.find(
    (definition) =>
      definition.pool_id === "exact_window_planning",
  );

  assert.equal(deadline.instances, 2);
  assert.equal(deadline.lease_ms, 90_000);
  assert.equal(deadline.heartbeat_ms, 20_000);
  assert.deepEqual(
    deadline.kinds.sort(),
    deadlineKinds.sort(),
  );
  assert.deepEqual(
    planning.kinds.sort(),
    planningKinds.sort(),
  );
  assert.deepEqual(
    exactWindow.kinds,
    exactWindowKinds,
  );
  assert.notEqual(deadline.pool_id, planning.pool_id);
  assert.notEqual(deadline.pool_id, exactWindow.pool_id);
  assert.notEqual(exactWindow.pool_id, planning.pool_id);
});
