"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  MAXIMUM_AGE_MS,
  OPERATIONAL_LANE_ID,
  POLICY_ID,
  SCHEMA_VERSION,
  SEMANTIC_CLASSIFICATION,
  createGovernedFastNewsLaneDecision,
  validateGovernedFastNewsLaneDecision,
} = require("../../lib/services/governed-fast-news-lane-decision");

const INVENTORY_SHA256 = "a".repeat(64);
const SOURCE_EVIDENCE_SHA256 = "b".repeat(64);

function input(overrides = {}) {
  return {
    story_id: "official-xbox-catalogue-update",
    evaluated_at: "2026-07-30T06:30:00.000Z",
    scheduled_for: "2026-07-30T09:00:00.000Z",
    source_published_at: "2026-07-29T17:00:00.000Z",
    verification_status: "CONFIRMED",
    source_class: "OFFICIAL_FIRST_PARTY",
    inventory_file_sha256: INVENTORY_SHA256,
    source_evidence_sha256: SOURCE_EVIDENCE_SHA256,
    explicit_formats: [
      "What Changes For Players",
      "short",
      "what_changes_for_players",
    ],
    ...overrides,
  };
}

test("creates a deterministic hash-bound decision for recent confirmed first-party news", () => {
  const first = createGovernedFastNewsLaneDecision(input());
  const replay = createGovernedFastNewsLaneDecision(input());

  assert.deepEqual(first, replay);
  assert.equal(first.schema_version, SCHEMA_VERSION);
  assert.equal(first.policy_id, POLICY_ID);
  assert.equal(first.decision, "ELIGIBLE");
  assert.equal(
    first.semantic_classification,
    SEMANTIC_CLASSIFICATION,
  );
  assert.equal(first.operational_lane_id, OPERATIONAL_LANE_ID);
  assert.equal(first.public_breaking_claim_authorised, false);
  assert.equal(first.maximum_age_ms, MAXIMUM_AGE_MS);
  assert.equal(first.story_id, input().story_id);
  assert.equal(first.inventory_file_sha256, INVENTORY_SHA256);
  assert.equal(
    first.source_evidence_sha256,
    SOURCE_EVIDENCE_SHA256,
  );
  assert.deepEqual(first.explicit_formats, [
    "short",
    "what changes for players",
    "what_changes_for_players",
  ]);
  assert.equal(first.decision_sha256.length, 64);
  assert.equal(Object.hasOwn(first, "story_score"), false);
  assert.deepEqual(
    validateGovernedFastNewsLaneDecision(first),
    first,
  );
});

test("allows a source exactly 72 hours old at the scheduled window", () => {
  const decision = createGovernedFastNewsLaneDecision(
    input({
      evaluated_at: "2026-07-30T08:00:00.000Z",
      scheduled_for: "2026-07-30T09:00:00.000Z",
      source_published_at: "2026-07-27T09:00:00.000Z",
    }),
  );

  assert.equal(decision.decision, "ELIGIBLE");
  assert.equal(decision.maximum_age_ms, 72 * 60 * 60 * 1000);
});

test("rejects stale sources and sources more than five minutes in the evaluator's future", () => {
  assert.throws(
    () =>
      createGovernedFastNewsLaneDecision(
        input({
          evaluated_at: "2026-07-30T08:00:00.000Z",
          scheduled_for: "2026-07-30T09:00:00.000Z",
          source_published_at: "2026-07-27T08:59:59.999Z",
        }),
      ),
    (error) => error?.code === "fast_news_source_stale",
  );

  assert.throws(
    () =>
      createGovernedFastNewsLaneDecision(
        input({
          source_published_at: "2026-07-30T06:35:00.001Z",
        }),
      ),
    (error) => error?.code === "fast_news_source_from_future",
  );
});

for (const explicitFormat of [
  "weekly_longform",
  "Premium Long Form",
  "evergreen",
  "Epix-Evergreen-Short",
]) {
  test(`rejects explicit non-fast-news format ${explicitFormat}`, () => {
    assert.throws(
      () =>
        createGovernedFastNewsLaneDecision(
          input({ explicit_formats: [explicitFormat] }),
        ),
      (error) =>
        error?.code === "fast_news_explicit_format_forbidden",
    );
  });
}

test("requires confirmed official-first-party evidence", () => {
  assert.throws(
    () =>
      createGovernedFastNewsLaneDecision(
        input({ verification_status: "UNVERIFIED" }),
      ),
    (error) =>
      error?.code === "fast_news_verification_status_invalid",
  );
  assert.throws(
    () =>
      createGovernedFastNewsLaneDecision(
        input({ source_class: "MAJOR_OUTLET" }),
      ),
    (error) => error?.code === "fast_news_source_class_invalid",
  );
});

test("keeps generic ranking scores outside the closed classification input", () => {
  assert.throws(
    () =>
      createGovernedFastNewsLaneDecision({
        ...input(),
        story_score: 100,
      }),
    (error) => error?.code === "fast_news_input_fields_invalid",
  );

  const hiddenAuthority = input();
  Object.defineProperty(hiddenAuthority, "publish_now", {
    enumerable: false,
    value: true,
  });
  assert.throws(
    () => createGovernedFastNewsLaneDecision(hiddenAuthority),
    (error) => error?.code === "fast_news_input_fields_invalid",
  );
});

test("strict validation recreates the decision and detects tampering", () => {
  const decision = createGovernedFastNewsLaneDecision(input());

  for (const mutate of [
    (value) => {
      value.semantic_classification = "BREAKING_NEWS";
    },
    (value) => {
      value.public_breaking_claim_authorised = true;
    },
    (value) => {
      value.source_evidence_sha256 = "c".repeat(64);
    },
    (value) => {
      value.explicit_formats.push("weekly_longform");
    },
    (value) => {
      value.decision_sha256 = "d".repeat(64);
    },
  ]) {
    const tampered = structuredClone(decision);
    mutate(tampered);
    assert.throws(
      () => validateGovernedFastNewsLaneDecision(tampered),
      (error) =>
        String(error?.code || "").startsWith("fast_news_"),
    );
  }
});

test("validation can enforce the caller's story and schedule binding", () => {
  const decision = createGovernedFastNewsLaneDecision(input());

  assert.deepEqual(
    validateGovernedFastNewsLaneDecision(decision, {
      story_id: decision.story_id,
      scheduled_for: decision.scheduled_for,
      operational_lane_id: "breaking_short",
      public_breaking_claim_authorised: false,
      decision_sha256: decision.decision_sha256,
    }),
    decision,
  );
  assert.throws(
    () =>
      validateGovernedFastNewsLaneDecision(decision, {
        story_id: "different-story",
      }),
    (error) => error?.code === "fast_news_expected_binding_mismatch",
  );
});
