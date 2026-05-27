"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  buildGoal04OperatorSourceIntakeQueue,
  renderGoal04OperatorSourceIntakeQueueMarkdown,
} = require("../../lib/goal04-operator-source-intake-queue");
const { main: runOperatorQueueCli } = require("../../tools/goal04-operator-source-intake-queue");

const GENERATED_AT = "2026-05-25T10:50:01.663Z";

function sampleConsolidation() {
  return {
    schema_version: 1,
    generated_at: GENERATED_AT,
    mode: "GOAL04_HUMAN_HELD_SOURCE_CONSOLIDATION",
    goal: "04_owned_motion_materialiser",
    summary: {
      story_count: 3,
      human_held_story_count: 3,
      ready_for_goal05: false,
      goal_verdict: "PARTIAL",
    },
    safe_to_advance: false,
    stories: [
      {
        story_id: "1tbpzah",
        title: "Capturing Has One Player Question",
        primary_story_entity: "Capturing",
        hold_status: "human_held_source_intake_required",
        blocking_lanes: [
          "owned_motion_source_safety",
          "public_copy_source_attribution",
          "source_family_acquisition",
        ],
        blockers: [
          "public_copy:non_news_image_post_source",
          "generic_primary_entity",
          "generic_gerund_primary_entity",
          "owned_explainer_requires_non_discovery_primary_source",
        ],
        required_human_inputs: [
          "A non-image primary source, official source or reliable publication source that supports the public claim.",
          "Canonical entity or reference plan needed before source-family acquisition can search official media.",
        ],
        safe_next_commands: [
          {
            step: "run_safe_local_command",
            command:
              "node tools/official-source-intake.js --story-json story.json --input output/goal-contract/source-attribution-repair/1tbpzah_official_source_entries.json --json",
          },
        ],
        operator_approval_required: true,
        db_mutation_required: false,
        counts_towards_motion_readiness: false,
        ready_for_final_render: false,
      },
      {
        story_id: "1s49ty7",
        title: "Star Wars Zero Company Is More Than XCOM",
        primary_story_entity: "Star Wars Zero Company",
        hold_status: "human_held_alternate_motion_source_required",
        blocking_lanes: ["real_motion_source_deficit", "source_family_acquisition"],
        blockers: ["segment_validation_failed", "segment_lacks_gameplay_action_samples"],
        required_human_inputs: [
          "An alternate official or operator-approved motion source is required because current direct media failed segment validation.",
        ],
        operator_approval_required: true,
        db_mutation_required: false,
        counts_towards_motion_readiness: false,
        ready_for_final_render: false,
      },
      {
        story_id: "1s43gen",
        title: "Kadokawa Stake Just Passed Sony",
        primary_story_entity: "Kadokawa",
        hold_status: "human_held_source_intake_required",
        blocking_lanes: ["owned_motion_source_safety", "source_family_acquisition"],
        repair_lanes: [
          "non_discovery_primary_source_intake",
          "corporate_transaction_owned_explainer_plan",
        ],
        blockers: ["corporate_transaction_requires_owned_explainer_visual_plan"],
        required_human_inputs: [
          "Operator-approved corporate source, rights basis and owned explainer plan required.",
        ],
        required_approvals: [
          "operator_confirms_source_matches_story",
          "operator_confirms_rights_basis",
        ],
        operator_approval_required: true,
        db_mutation_required: false,
        counts_towards_motion_readiness: false,
        ready_for_final_render: false,
      },
    ],
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

test("Goal 04 operator source queue creates fillable entries and keeps automation stopped", () => {
  const report = buildGoal04OperatorSourceIntakeQueue({
    generatedAt: GENERATED_AT,
    consolidationReport: sampleConsolidation(),
  });

  assert.equal(report.schema_version, 1);
  assert.equal(report.mode, "GOAL04_OPERATOR_SOURCE_INTAKE_QUEUE");
  assert.equal(report.summary.story_count, 3);
  assert.equal(report.summary.human_authorisation_required, true);
  assert.equal(report.summary.auto_continue_allowed, false);
  assert.equal(report.summary.ready_for_goal05, false);
  assert.equal(report.summary.goal_verdict, "PARTIAL");
  assert.equal(report.stop_condition.status, "WAITING_FOR_OPERATOR_SOURCE_INPUT");
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_network_uploads, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.safety.no_oauth_or_token_change, true);

  const capturing = report.stories.find((story) => story.story_id === "1tbpzah");
  assert.ok(capturing.intake_items.some((item) => item.intake_type === "non_discovery_primary_source"));
  assert.ok(capturing.intake_items.some((item) => item.intake_type === "canonical_entity_or_reference_plan"));
  assert.equal(capturing.ready_for_final_render, false);
  assert.equal(capturing.counts_towards_motion_readiness, false);
  assert.ok(capturing.rejection_guards.includes("raw_image_source_not_allowed"));
  assert.ok(capturing.rejection_guards.includes("source_attribution:image_only_source_not_allowed"));

  const officialTemplate = report.official_source_entries_template.entries.find(
    (entry) => entry.story_id === "1tbpzah",
  );
  assert.equal(officialTemplate.downloads_allowed, false);
  assert.equal(officialTemplate.official_source_url, "");
  assert.ok(officialTemplate.accepted_source_types.includes("official_game_website_media_page"));

  const motionTemplate = report.licensed_direct_media_operator_intake_template.entries.find(
    (entry) => entry.story_id === "1s49ty7",
  );
  assert.equal(motionTemplate.autonomous_use_approved, false);
  assert.equal(motionTemplate.approved_direct_media_url, "");
  assert.ok(motionTemplate.acceptance_checks.some((check) => check.includes("not a random reupload")));

  assert.ok(
    report.post_operator_submission_validation_plan.commands.some((command) =>
      command.command.includes("official-source-intake.js"),
    ),
  );
  assert.ok(
    report.post_operator_submission_validation_plan.commands.some((command) =>
      command.command.includes("ops:v4-licensed-direct-media"),
    ),
  );

  const markdown = renderGoal04OperatorSourceIntakeQueueMarkdown(report);
  assert.match(markdown, /Operator Source Intake Queue/);
  assert.match(markdown, /WAITING_FOR_OPERATOR_SOURCE_INPUT/);
  assert.match(markdown, /No live publishing/);
});

test("Goal 04 operator source queue CLI writes queue, templates and validation plan", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal04-operator-queue-"));
  const inputPath = path.join(tempDir, "consolidation.json");
  const outputJson = path.join(tempDir, "operator_source_intake_queue.json");
  const outputMd = path.join(tempDir, "operator_source_intake_queue.md");
  const officialTemplatePath = path.join(tempDir, "official_source_entries_template.json");
  const licensedTemplatePath = path.join(tempDir, "licensed_direct_media_operator_intake_template.json");
  const validationPlanPath = path.join(tempDir, "post_operator_submission_validation_plan.json");

  await fs.writeJson(inputPath, sampleConsolidation(), { spaces: 2 });

  const result = await runOperatorQueueCli([
    "--consolidation-report",
    inputPath,
    "--output-json",
    outputJson,
    "--output-md",
    outputMd,
    "--official-source-template",
    officialTemplatePath,
    "--licensed-media-template",
    licensedTemplatePath,
    "--validation-plan",
    validationPlanPath,
    "--generated-at",
    GENERATED_AT,
    "--json",
  ]);

  assert.equal(result.report.summary.goal_verdict, "PARTIAL");
  assert.equal(result.report.summary.auto_continue_allowed, false);
  assert.equal(await fs.pathExists(outputJson), true);
  assert.equal(await fs.pathExists(outputMd), true);
  assert.equal(await fs.pathExists(officialTemplatePath), true);
  assert.equal(await fs.pathExists(licensedTemplatePath), true);
  assert.equal(await fs.pathExists(validationPlanPath), true);
  assert.equal((await fs.readJson(validationPlanPath)).safe_to_run_after_operator_submission, true);
  assert.match(await fs.readFile(outputMd, "utf8"), /human source input is required/i);
});
