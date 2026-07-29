"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  hasValidEvergreenMotionRepairWorkOrderHash,
  hashEvergreenMotionRepairWorkOrder,
} = require("../../lib/services/evergreen-motion-repair-work-order");

test("motion-repair work-order hash is canonical across object key order but binds changed work", () => {
  const first = {
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
    story_id: "story-one",
    candidate_id: "candidate-one",
    additional_motion_seconds_required: 25.3,
    safety: {
      local_proof_only: true,
      publish_authority_created: false,
    },
  };
  const reordered = {
    safety: {
      publish_authority_created: false,
      local_proof_only: true,
    },
    additional_motion_seconds_required: 25.3,
    candidate_id: "candidate-one",
    story_id: "story-one",
    schema_version:
      "pulse-evergreen-motion-coverage-repair-work-order-v1",
  };

  assert.equal(
    hashEvergreenMotionRepairWorkOrder(first),
    hashEvergreenMotionRepairWorkOrder(reordered),
  );
  const signed = {
    ...first,
    work_order_sha256:
      hashEvergreenMotionRepairWorkOrder(first),
  };
  assert.equal(
    hasValidEvergreenMotionRepairWorkOrderHash(signed),
    true,
  );
  assert.equal(
    hasValidEvergreenMotionRepairWorkOrderHash({
      ...signed,
      additional_motion_seconds_required: 26,
    }),
    false,
  );
});
