"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  evaluateFreshProductionRefillOutcome,
} = require("../../lib/ops/fresh-production-refill-outcome");

function strictDependencies({ ready = false } = {}) {
  return {
    async buildProductionRenderCutoverPlan() {
      return {
        scheduler_bridge: {
          candidates: [{ id: "fresh-story-a", story_id: "fresh-story-a" }],
        },
        blocked: [],
        queue: [],
      };
    },
    buildNextPublishCandidatesReport() {
      return {
        candidates: [{ id: "fresh-story-a", status: "publish_ready" }],
        excluded: [],
      };
    },
    async attachPreflightQa(report) {
      report.candidates[0].preflight_qa = {
        status: "pass",
        blockers: [],
        warnings: [],
      };
      return report;
    },
    async buildGoalDryRunPublishPlan() {
      if (ready) {
        return {
          ready_stories: [{ story_id: "fresh-story-a" }],
          blocked_stories: [],
          held_stories: [],
          actions: [
            {
              story_id: "fresh-story-a",
              platform: "youtube_shorts",
              platform_enabled: true,
              autonomous_green_lit_by_dry_run: true,
              blockers: [],
            },
          ],
        };
      }
      return {
        ready_stories: [],
        blocked_stories: [
          {
            story_id: "fresh-story-a",
            blockers: ["rights:selected_asset_commercial_rights_unverified"],
          },
        ],
        held_stories: [],
        actions: [],
      };
    },
  };
}

test("refill local GREEN remains an incident when strict scheduler yield is zero", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-refill-outcome-zero-"));
  try {
    const result = await evaluateFreshProductionRefillOutcome({
      storyPackages: [
        {
          story_id: "fresh-story-a",
          verdict: "GREEN",
          artifact_dir: path.join(root, "fresh-story-a"),
        },
      ],
      localPackageGreenCount: 1,
      minimumNewGreenCandidates: 3,
      parentJobId: 4401,
      generatedAt: "2026-07-17T04:00:00.000Z",
      outputDir: root,
      dependencies: strictDependencies({ ready: false }),
    });

    assert.equal(result.status, "incident");
    assert.equal(result.outcome, "zero_strict_green_yield");
    assert.equal(result.local_package_green_count, 1);
    assert.equal(result.strict_green_count, 0);
    assert.equal(result.minimum_new_green_candidates, 3);
    assert.equal(result.shortfall, 3);
    assert.equal(result.target_met, false);
    assert.equal(result.safety.publish_authorised, false);
    assert.deepEqual(result.attempted_story_ids, ["fresh-story-a"]);
    assert.ok(
      result.strict_blockers.includes(
        "fresh-story-a:rights:selected_asset_commercial_rights_unverified",
      ),
    );
    assert.ok(await fs.pathExists(result.outputs.incident_report));
    assert.ok(await fs.pathExists(result.outputs.incident_blockers));

    const incident = await fs.readJson(result.outputs.incident_report);
    assert.equal(incident.parent_job_id, 4401);
    assert.equal(incident.outcome, "zero_strict_green_yield");
    assert.equal(incident.safety.publish_authorised, false);
    assert.deepEqual(incident.attempted_story_ids, ["fresh-story-a"]);
  } finally {
    await fs.remove(root);
  }
});

test("refill target is met only by enabled strict dry-run actions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-refill-outcome-green-"));
  try {
    const result = await evaluateFreshProductionRefillOutcome({
      storyPackages: [
        {
          story_id: "fresh-story-a",
          verdict: "GREEN",
          artifact_dir: path.join(root, "fresh-story-a"),
        },
      ],
      localPackageGreenCount: 1,
      minimumNewGreenCandidates: 1,
      parentJobId: 4402,
      generatedAt: "2026-07-17T04:05:00.000Z",
      outputDir: root,
      dependencies: strictDependencies({ ready: true }),
    });

    assert.equal(result.status, "completed");
    assert.equal(result.outcome, "strict_green_yield");
    assert.equal(result.strict_green_count, 1);
    assert.equal(result.enabled_strict_action_count, 1);
    assert.equal(result.shortfall, 0);
    assert.equal(result.target_met, true);
    assert.deepEqual(result.strict_green_story_ids, ["fresh-story-a"]);
    assert.equal(result.outputs.incident_report, null);
    assert.equal(result.outputs.incident_blockers, null);
  } finally {
    await fs.remove(root);
  }
});
