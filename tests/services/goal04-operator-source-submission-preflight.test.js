"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  buildGoal04OperatorSourceSubmissionPreflight,
  renderGoal04OperatorSourceSubmissionPreflightMarkdown,
} = require("../../lib/goal04-operator-source-submission-preflight");
const { main: runSubmissionPreflightCli } = require("../../tools/goal04-operator-source-submission-preflight");

const GENERATED_AT = "2026-05-25T11:20:10.529Z";

function sampleQueue() {
  return {
    schema_version: 1,
    generated_at: "2026-05-25T10:50:01.663Z",
    mode: "GOAL04_OPERATOR_SOURCE_INTAKE_QUEUE",
    summary: {
      story_count: 2,
      queue_item_count: 5,
      official_source_template_entries: 2,
      licensed_media_template_entries: 2,
      auto_continue_allowed: false,
      ready_for_goal05: false,
      goal_verdict: "PARTIAL",
    },
    stories: [
      {
        story_id: "1tbpzah",
        title: "Capturing Has One Player Question",
        hold_status: "human_held_source_intake_required",
        intake_items: [
          {
            intake_type: "canonical_entity_or_reference_plan",
            required_fields: [
              "canonical_subject",
              "canonical_entity",
              "source_search_terms",
              "reference_plan_notes",
            ],
            template_kind: "operator_plan",
          },
          {
            intake_type: "non_discovery_primary_source",
            template_kind: "official_source",
          },
          {
            intake_type: "operator_approved_motion_source",
            template_kind: "licensed_media",
          },
        ],
      },
      {
        story_id: "1s49ty7",
        title: "Star Wars Zero Company Is More Than XCOM",
        hold_status: "human_held_alternate_motion_source_required",
        intake_items: [
          {
            intake_type: "operator_approved_motion_source",
            template_kind: "licensed_media",
          },
          {
            intake_type: "governed_visual_plan_approval",
            template_kind: "operator_plan",
          },
        ],
      },
    ],
    post_operator_submission_validation_plan: {
      safe_to_run_after_operator_submission: true,
      commands: [
        {
          step: "validate_official_source_entries",
          command: "node tools/official-source-intake.js --input output/submitted.json --json",
        },
        {
          step: "validate_operator_media_access",
          command: "npm run ops:v4-licensed-direct-media -- --story-id 1tbpzah",
        },
      ],
    },
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_gate_weakened: true,
    },
  };
}

function blankOfficialTemplate() {
  return {
    entries: [
      {
        story_id: "1tbpzah",
        entity: "Capturing",
        source_family: "1tbpzah_non_discovery_primary_source",
        source_type: "",
        source_owner: "",
        official_source_url: "",
        evidence_of_officialness: "",
        entity_match_notes: "",
        downloads_allowed: false,
      },
    ],
  };
}

function partialLicensedTemplate() {
  return {
    entries: [
      {
        story_id: "1tbpzah",
        entity: "Capturing",
        source_family: "1tbpzah_operator_approved_motion_source",
        source_owner: "",
        official_source_url: "",
        approved_direct_media_url: "",
        local_operator_file_path: "",
        licence_evidence: "",
        permission_evidence: "",
        autonomous_use_approved: false,
      },
    ],
  };
}

test("Goal 04 operator submission preflight blocks blank templates and does not release validation", () => {
  const report = buildGoal04OperatorSourceSubmissionPreflight({
    generatedAt: GENERATED_AT,
    operatorQueue: sampleQueue(),
    officialSourceSubmissions: [blankOfficialTemplate()],
    licensedMediaSubmissions: [partialLicensedTemplate()],
    operatorPlanSubmissions: [],
  });

  assert.equal(report.schema_version, 1);
  assert.equal(report.mode, "GOAL04_OPERATOR_SOURCE_SUBMISSION_PREFLIGHT");
  assert.equal(report.summary.required_queue_items, 5);
  assert.equal(report.summary.complete_submission_items, 0);
  assert.equal(report.summary.incomplete_submission_items, 2);
  assert.equal(report.summary.missing_submission_items, 5);
  assert.equal(report.summary.validation_allowed, false);
  assert.equal(report.summary.auto_continue_allowed, false);
  assert.equal(report.summary.ready_for_goal05, false);
  assert.equal(report.stop_condition.status, "WAITING_FOR_OPERATOR_SOURCE_INPUT");
  assert.equal(report.post_operator_submission_validation_plan.status, "blocked_until_submissions_complete");
  assert.deepEqual(report.post_operator_submission_validation_plan.released_commands, []);

  const official = report.submitted_items.find((item) => item.template_kind === "official_source");
  assert.ok(official.missing_fields.includes("source_type"));
  assert.ok(official.missing_fields.includes("official_source_url"));
  assert.equal(official.status, "incomplete_submission");

  const motion = report.submitted_items.find((item) => item.template_kind === "licensed_media");
  assert.ok(motion.missing_fields.includes("approved_direct_media_url_or_local_operator_file_path"));
  assert.equal(motion.status, "incomplete_submission");
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);

  const markdown = renderGoal04OperatorSourceSubmissionPreflightMarkdown(report);
  assert.match(markdown, /Submission Preflight/);
  assert.match(markdown, /WAITING_FOR_OPERATOR_SOURCE_INPUT/);
  assert.match(markdown, /Validation commands remain blocked/);
});

test("Goal 04 operator submission preflight CLI writes proof artefacts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal04-submission-preflight-"));
  const queuePath = path.join(tempDir, "queue.json");
  const officialPath = path.join(tempDir, "official.json");
  const licensedPath = path.join(tempDir, "licensed.json");
  const outputJson = path.join(tempDir, "operator_source_submission_preflight.json");
  const outputMd = path.join(tempDir, "operator_source_submission_preflight.md");

  await fs.writeJson(queuePath, sampleQueue(), { spaces: 2 });
  await fs.writeJson(officialPath, blankOfficialTemplate(), { spaces: 2 });
  await fs.writeJson(licensedPath, partialLicensedTemplate(), { spaces: 2 });

  const result = await runSubmissionPreflightCli([
    "--operator-queue",
    queuePath,
    "--official-source-submission",
    officialPath,
    "--licensed-media-submission",
    licensedPath,
    "--output-json",
    outputJson,
    "--output-md",
    outputMd,
    "--generated-at",
    GENERATED_AT,
    "--json",
  ]);

  assert.equal(result.report.summary.validation_allowed, false);
  assert.equal(result.report.summary.complete_submission_items, 0);
  assert.equal(await fs.pathExists(outputJson), true);
  assert.equal(await fs.pathExists(outputMd), true);
  assert.equal((await fs.readJson(outputJson)).stop_condition.status, "WAITING_FOR_OPERATOR_SOURCE_INPUT");
  assert.match(await fs.readFile(outputMd, "utf8"), /No intake validation was run/i);
});
