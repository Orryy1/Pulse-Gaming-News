"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyBridgePreflightStampRepairPlan,
  buildBridgePreflightStampRepairPlan,
  buildRepairedStory,
  hasOnlyRepairableFailures,
  isBridgePromotedRetentionShort,
} = require("../../lib/bridge-preflight-stamp-repair");

function bridgeStampedStory(overrides = {}) {
  return {
    id: "rss_bridge_stamped",
    title: "Total War Is Going Full Warhammer 40K",
    approved: true,
    auto_approved: true,
    qa_failed: true,
    qa_failures: [
      "script_too_short (56 words, min 80)",
      "approved_voice:spoken_outro_missing",
      "script_coherence:missing_exact_cta_in_script",
    ],
    publish_status: "failed",
    publish_error: "qa_blocked: script_too_short (56 words, min 80)",
    visual_v4_render_bridge_status: "promoted_to_live_state",
    render_lane: "visual_v4_production",
    render_quality_class: "premium",
    duration_lane: "pulse_retention_short",
    allow_retention_short_video: true,
    governance_publish_status: "GREEN",
    exported_path: "render.mp4",
    full_script: "Total War is going full Warhammer 40K. Players now know what Creative Assembly is building next.",
    ...overrides,
  };
}

function passingDeps(overrides = {}) {
  return {
    runContentQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    buildVideoQaOptionsForStory: () => ({ minDurationSeconds: 15 }),
    runPlatformVideoQa: async () => ({ result: "pass", failures: [], warnings: [] }),
    runStudioGovernancePreflight: async () => ({ result: "pass", failures: [], warnings: [] }),
    ...overrides,
  };
}

test("bridge preflight stamp repair recognises only the stale bridge failure set", () => {
  assert.equal(isBridgePromotedRetentionShort(bridgeStampedStory()), true);
  assert.equal(hasOnlyRepairableFailures(bridgeStampedStory()), true);
  assert.equal(
    hasOnlyRepairableFailures(
      bridgeStampedStory({ qa_failures: ["exported_mp4_not_on_disk"] }),
    ),
    false,
  );
});

test("bridge preflight stamp repair clears only rows that pass current gates", async () => {
  const plan = await buildBridgePreflightStampRepairPlan({
    generatedAt: "2026-05-22T09:20:00.000Z",
    stories: [
      bridgeStampedStory({ id: "eligible" }),
      bridgeStampedStory({
        id: "current-content-fail",
        qa_failures: ["script_too_short (56 words, min 80)"],
      }),
      bridgeStampedStory({
        id: "not-repairable",
        qa_failures: ["exported_mp4_not_on_disk"],
      }),
    ],
    deps: passingDeps({
      runContentQa: async (story) =>
        story.id === "current-content-fail"
          ? { result: "fail", failures: ["script_too_short (30 words, min 45)"], warnings: [] }
          : { result: "pass", failures: [], warnings: [] },
    }),
  });

  assert.equal(plan.status, "ready_for_operator_confirmed_apply");
  assert.deepEqual(plan.eligible_repairs.map((item) => item.story_id), ["eligible"]);
  assert.ok(
    plan.blocked_repairs.some(
      (item) => item.story_id === "current-content-fail" && item.reasons.includes("content:script_too_short (30 words, min 45)"),
    ),
  );
  assert.ok(
    plan.blocked_repairs.some(
      (item) => item.story_id === "not-repairable" && item.reasons.includes("qa_failures_not_in_repairable_stamp_set"),
    ),
  );
});

test("bridge preflight stamp repaired story clears stale QA fields but keeps audit evidence", () => {
  const repaired = buildRepairedStory(
    bridgeStampedStory({ id: "repaired" }),
    "2026-05-22T09:21:00.000Z",
  );

  assert.equal(repaired.qa_failed, false);
  assert.deepEqual(repaired.qa_failures, []);
  assert.deepEqual(repaired.content_qa_failures, []);
  assert.deepEqual(repaired.video_qa_failures, []);
  assert.equal(repaired.publish_status, null);
  assert.equal(repaired.publish_error, null);
  assert.equal(repaired.bridge_preflight_stamp_repaired_at, "2026-05-22T09:21:00.000Z");
  assert.deepEqual(repaired.bridge_preflight_stamp_original_failures, [
    "script_too_short (56 words, min 80)",
    "approved_voice:spoken_outro_missing",
    "script_coherence:missing_exact_cta_in_script",
  ]);
});

test("bridge preflight stamp repair apply requires confirmation and writes through db adapter", async () => {
  const plan = await buildBridgePreflightStampRepairPlan({
    stories: [bridgeStampedStory({ id: "apply-me" })],
    deps: passingDeps(),
  });
  const calls = [];
  const db = {
    DB_PATH: "D:\\pulse-data\\pulse.db",
    getDb() {
      return {
        async backup(filePath) {
          calls.push(["backup", filePath]);
        },
      };
    },
    async upsertStory(story) {
      calls.push(["upsertStory", story.id, story.qa_failed]);
    },
  };

  await assert.rejects(
    () => applyBridgePreflightStampRepairPlan(plan, { db, operatorConfirmed: false }),
    /requires_operator_confirmed/,
  );

  const result = await applyBridgePreflightStampRepairPlan(plan, {
    db,
    operatorConfirmed: true,
    ensureDir: async () => {},
  });

  assert.equal(result.status, "applied");
  assert.equal(result.applied_count, 1);
  assert.equal(result.posting, false);
  assert.equal(result.oauth, false);
  assert.equal(result.safety_gates_weakened, false);
  assert.equal(calls[0][0], "backup");
  assert.match(calls[0][1], /pulse-pre-bridge-preflight-stamp-repair/);
  assert.deepEqual(calls[1], ["upsertStory", "apply-me", false]);
});
