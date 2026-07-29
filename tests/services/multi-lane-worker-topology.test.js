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

test("the candidate inventory monitor runs in reserved critical planning capacity", () => {
  const definitions = buildMultiLaneWorkerDefinitions({
    handlers: {
      governed_youtube_window_inventory_monitor() {},
    },
  });
  const poolFor = (kind) =>
    definitions.find((definition) =>
      definition.kinds.includes(kind),
    )?.pool_id;
  assert.equal(
    poolFor("governed_youtube_window_inventory_monitor"),
    "critical_planning",
  );
});
