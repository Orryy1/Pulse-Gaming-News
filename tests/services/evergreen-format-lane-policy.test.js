"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  buildFormatLanePolicy,
  routeFormatLane,
} = require("../../lib/format-lane-policy");

test("governed evergreen verdict routes into an active extended Short production lane", () => {
  assert.equal(
    routeFormatLane("evergreen_verdict_short"),
    "pulse_evergreen_verdict_short",
  );
  const policy = buildFormatLanePolicy({
    formatRoute: { verdict: "evergreen_verdict_short" },
    sourcePack: { confidence_level: "verified" },
    mediaInventory: { exact_subject_asset_count: 9 },
    renderContract: {
      render_lane: "studio_v2_candidate",
      target_duration_seconds: 82,
      clip_count: 7,
      visual_count: 9,
    },
    story: {
      editorial_format: "evergreen_verdict_short",
      evergreen_verdict_assessment: {
        verdict: "READY_FOR_PRODUCTION",
        blockers: [],
      },
      first_hand_evidence: null,
    },
  });

  assert.equal(policy.lane_id, "pulse_evergreen_verdict_short");
  assert.equal(policy.format_family, "evergreen_verdict_short");
  assert.equal(policy.readiness_colour, "GREEN");
  assert.equal(policy.production_safety.report_only, false);
  assert.equal(policy.production_safety.enables_hard_gates, true);
  assert.deepEqual(policy.platform_targets, [
    "youtube_shorts",
    "instagram_reels",
    "facebook_reels",
  ]);
});

test("evergreen lane fails closed without its source and pitch assessment", () => {
  const policy = buildFormatLanePolicy({
    formatRoute: { verdict: "evergreen_verdict_short" },
    sourcePack: { confidence_level: "rumour" },
    mediaInventory: { exact_subject_asset_count: 2 },
    renderContract: {
      render_lane: "studio_v2_candidate",
      target_duration_seconds: 82,
      clip_count: 2,
      visual_count: 4,
    },
    story: {},
  });

  assert.equal(policy.readiness_colour, "RED");
  assert.ok(
    policy.blockers.includes(
      "evergreen_verdict_pitch_assessment_missing",
    ),
  );
  assert.ok(
    policy.blockers.includes(
      "evergreen_verdict_requires_verified_sources",
    ),
  );
});
