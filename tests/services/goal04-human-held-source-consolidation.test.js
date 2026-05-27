"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  buildGoal04HumanHeldSourceConsolidation,
  renderGoal04HumanHeldSourceConsolidationMarkdown,
} = require("../../lib/goal04-human-held-source-consolidation");
const { main: runGoal04SourceHoldsCli } = require("../../tools/goal04-human-held-source-consolidation");

const GENERATED_AT = "2026-05-25T10:19:51.343Z";

function sampleOwnedSourceWorkOrder() {
  return {
    mode: "OWNED_MOTION_SOURCE_SAFETY_WORK_ORDER",
    jobs: [
      {
        story_id: "1tbpzah",
        title: "Capturing Has One Player Question",
        blocker_type: "owned_explainer_requires_non_discovery_primary_source",
        repair_lane: "non_discovery_primary_source_intake",
        exact_missing_input:
          "A non-discovery primary source, official source or reliable publication source.",
        recommended_command: "node tools/official-source-intake.js --story-json story.json",
        operator_approval_required: true,
        db_mutation_required: false,
        post_repair_validation_command: "npm run ops:goal-owned-motion -- --story-id 1tbpzah",
      },
    ],
  };
}

function samplePublicSourceWorkOrder() {
  return {
    mode: "SOURCE_ATTRIBUTION_REPAIR_WORK_ORDER",
    jobs: [
      {
        story_id: "1tbpzah",
        title: "Capturing Has One Player Question",
        blocker_type: "public_copy:non_news_image_post_source",
        repair_lane: "official_source_intake_required",
        exact_missing_input:
          "A non-image primary source, official source or reliable publication source.",
        recommended_command: "node tools/official-source-intake.js --story-json story.json",
        operator_approval_required: true,
        db_mutation_required: false,
        post_repair_validation_command: "npm run ops:goal-dry-run-publish -- --json",
      },
    ],
  };
}

function sampleSourceFamilyReport() {
  return {
    execution_mode: "studio_v4_source_family_acquisition",
    rows: [
      {
        story_id: "1s4d0ev",
        title: "PS5 Price Hike Rumour Hits Europe",
        primary_story_entity: "PS5",
        readiness_status: "v4_motion_blocked",
        blockers: [
          "actual_motion_clip_minimum_not_met",
          "distinct_motion_families_minimum_not_met",
          "no_trusted_footage_references_for_story",
        ],
        source_search_blockers: [],
        governed_visual_plan: {
          plan_type: "platform_product_visual_plan",
          operator_approval_required: true,
          counts_towards_motion_readiness: false,
          required_approvals: [
            "operator_confirms_source_matches_story",
            "operator_confirms_rights_basis",
          ],
          next_step:
            "Provide an official, licensed or operator-approved source entry.",
        },
        safe_next_commands: [
          {
            step: "validate_operator_supplied_official_sources",
            command: "npm run media:intake-official-sources -- --story-id 1s4d0ev",
          },
        ],
      },
      {
        story_id: "1s43gen",
        title: "Kadokawa Stake Just Passed Sony",
        primary_story_entity: "Kadokawa",
        readiness_status: "v4_motion_blocked",
        blockers: ["actual_motion_clip_minimum_not_met"],
        source_search_blockers: [
          "corporate_transaction_requires_owned_explainer_visual_plan",
        ],
        governed_visual_plan: {
          plan_type: "corporate_transaction_owned_explainer_plan",
          operator_approval_required: true,
          counts_towards_motion_readiness: false,
          required_approvals: ["operator_confirms_rights_basis"],
        },
      },
      {
        story_id: "1tbpzah",
        title: "Capturing Has One Player Question",
        primary_story_entity: "Capturing",
        readiness_status: "v4_motion_blocked",
        blockers: [
          "actual_motion_clip_minimum_not_met",
          "distinct_motion_families_minimum_not_met",
        ],
        source_search_blockers: [
          "generic_primary_entity",
          "generic_gerund_primary_entity",
        ],
        source_family_candidates: [],
        governed_visual_plan: null,
      },
    ],
  };
}

function sampleSourceDeficitReport() {
  return {
    execution_mode: "studio_v4_source_deficit",
    rows: [
      {
        story_id: "1s49ty7",
        title: "Star Wars Zero Company Is More Than XCOM",
        readiness_status: "v4_motion_blocked",
        render_decision: "hold_v4_source_acquisition_required",
        blockers: [
          "actual_motion_clip_minimum_not_met",
          "distinct_motion_families_minimum_not_met",
          "no_trusted_footage_references_for_story",
        ],
        required_acquisitions: [
          {
            source_family: "steam_star_wars_zero_company_announce_trailer",
            action: "intake_direct_media_and_validate_segments",
            segment_validation_status: "validation_failed",
            segment_validation_rejection_reason: "segment_lacks_gameplay_action_samples",
          },
        ],
        acquisition_counts: {
          direct_media_ready: 1,
          licence_or_operator_required: 0,
          direct_media_missing: 0,
        },
        safe_next_commands: [
          {
            step: "validate_motion_segments",
            command: "npm run media:validate-trailer-segments -- --story-id 1s49ty7",
          },
        ],
      },
    ],
  };
}

test("Goal 04 consolidation records human-held source blockers without marking readiness green", () => {
  const report = buildGoal04HumanHeldSourceConsolidation({
    generatedAt: GENERATED_AT,
    ownedSourceSafetyWorkOrders: [sampleOwnedSourceWorkOrder()],
    publicSourceAttributionWorkOrders: [samplePublicSourceWorkOrder()],
    sourceFamilyReports: [sampleSourceFamilyReport()],
    sourceDeficitReports: [sampleSourceDeficitReport()],
  });

  assert.equal(report.schema_version, 1);
  assert.equal(report.mode, "GOAL04_HUMAN_HELD_SOURCE_CONSOLIDATION");
  assert.equal(report.summary.story_count, 4);
  assert.equal(report.summary.human_held_story_count, 4);
  assert.equal(report.summary.ready_for_goal05, false);
  assert.equal(report.summary.goal_verdict, "PARTIAL");
  assert.equal(report.safe_to_advance, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);

  const sourceBlocked = report.stories.find((story) => story.story_id === "1tbpzah");
  assert.equal(sourceBlocked.hold_status, "human_held_source_intake_required");
  assert.ok(sourceBlocked.blocking_lanes.includes("public_copy_source_attribution"));
  assert.ok(sourceBlocked.blocking_lanes.includes("owned_motion_source_safety"));
  assert.ok(sourceBlocked.blocking_lanes.includes("source_family_acquisition"));
  assert.equal(sourceBlocked.operator_approval_required, true);
  assert.equal(sourceBlocked.db_mutation_required, false);
  assert.equal(sourceBlocked.counts_towards_motion_readiness, false);
  assert.equal(sourceBlocked.ready_for_final_render, false);
  assert.ok(sourceBlocked.blockers.includes("generic_primary_entity"));
  assert.ok(
    sourceBlocked.required_human_inputs.some((input) =>
      input.includes("non-image primary source"),
    ),
  );

  const directMediaHeld = report.stories.find((story) => story.story_id === "1s49ty7");
  assert.equal(directMediaHeld.hold_status, "human_held_alternate_motion_source_required");
  assert.equal(directMediaHeld.operator_approval_required, true);
  assert.ok(directMediaHeld.blockers.includes("segment_validation_failed"));
  assert.ok(
    directMediaHeld.required_human_inputs.some((input) =>
      input.includes("alternate official or operator-approved motion source"),
    ),
  );

  const markdown = renderGoal04HumanHeldSourceConsolidationMarkdown(report);
  assert.match(markdown, /Goal 04 Human-Held Source Consolidation/);
  assert.match(markdown, /Capturing Has One Player Question/);
  assert.match(markdown, /No story in this report is render-ready/);
});

test("Goal 04 consolidation human-holds generated-only decks after benchmark failure", () => {
  const report = buildGoal04HumanHeldSourceConsolidation({
    generatedAt: GENERATED_AT,
    sourceFamilyReports: [
      {
        execution_mode: "studio_v4_source_family_acquisition",
        rows: [
          {
            story_id: "1s43gen",
            title: "Kadokawa Stake Just Passed Sony",
            primary_story_entity: "Kadokawa",
            readiness_status: "v4_motion_blocked",
            real_visual_media_required_after_owned_explainer_failed: true,
            blockers: [
              "actual_motion_clip_minimum_not_met",
              "distinct_motion_families_minimum_not_met",
              "no_trusted_footage_references_for_story",
            ],
            source_search_blockers: [],
            governed_visual_plan: null,
            safe_next_commands: [
              {
                step: "supply_rights_backed_real_visual_media",
                command:
                  "npm run ops:goal04-operator-source-queue -- --consolidation-report output/goal-04/goal04_human_held_source_consolidation.json --json",
              },
            ],
          },
        ],
      },
    ],
  });

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.human_held_story_count, 1);
  assert.equal(report.summary.auto_repairable_story_count, 0);
  assert.equal(report.safe_to_advance, false);

  const story = report.stories[0];
  assert.equal(story.hold_status, "human_held_alternate_motion_source_required");
  assert.equal(story.operator_approval_required, true);
  assert.equal(story.counts_towards_motion_readiness, false);
  assert.equal(story.ready_for_final_render, false);
  assert.ok(
    story.blockers.includes("real_visual_media_required_after_owned_explainer_failed_benchmark"),
  );
  assert.ok(
    story.required_human_inputs.some((input) =>
      input.includes("alternate official, licensed or operator-approved motion source"),
    ),
  );
});

test("Goal 04 consolidation CLI writes JSON and Markdown artefacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal04-source-holds-"));
  const ownedPath = path.join(tempDir, "owned.json");
  const publicPath = path.join(tempDir, "public.json");
  const familyPath = path.join(tempDir, "family.json");
  const deficitPath = path.join(tempDir, "deficit.json");
  const outputJson = path.join(tempDir, "goal04_human_held_source_consolidation.json");
  const outputMd = path.join(tempDir, "goal04_human_held_source_consolidation.md");

  await fs.writeJson(ownedPath, sampleOwnedSourceWorkOrder());
  await fs.writeJson(publicPath, samplePublicSourceWorkOrder());
  await fs.writeJson(familyPath, sampleSourceFamilyReport());
  await fs.writeJson(deficitPath, sampleSourceDeficitReport());

  const result = await runGoal04SourceHoldsCli([
    "--owned-source-work-order",
    ownedPath,
    "--public-source-work-order",
    publicPath,
    "--source-family-report",
    familyPath,
    "--source-deficit-report",
    deficitPath,
    "--output-json",
    outputJson,
    "--output-md",
    outputMd,
    "--generated-at",
    GENERATED_AT,
    "--json",
  ]);

  assert.equal(result.report.summary.human_held_story_count, 4);
  assert.equal(result.report.safe_to_advance, false);
  assert.equal(await fs.pathExists(outputJson), true);
  assert.equal(await fs.pathExists(outputMd), true);
  assert.equal((await fs.readJson(outputJson)).summary.goal_verdict, "PARTIAL");
  assert.match(await fs.readFile(outputMd, "utf8"), /human-held source queue/i);
});
