"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildAutoRepairRunPlan,
  commandSafety,
  executeAutoRepairRunPlan,
  parseNpmRunCommand,
  resolveExecutableCommand,
  renderAutoRepairRunMarkdown,
} = require("../../lib/ops/auto-repair-runner");
const { parseArgs } = require("../../tools/auto-repair-runner");

function planFixture() {
  return {
    schema_version: 1,
    generated_at: "2026-05-31T00:00:00.000Z",
    mode: "LOCAL_AUTO_REPAIR_PLAN",
    items: [
      {
        story_id: "audio-1",
        title: "Audio One",
        repair_lane: "audio_regeneration",
        blocker_type: "qa:audio_generation_failed:server_down",
        recommended_command: "npm run ops:local-tts-publish-refresh -- --story-id audio-1 --dry-run",
        post_repair_validation_command:
          "npm run ops:local-tts-publish-refresh -- --story-id audio-1 --dry-run && npm run ops:next-publish-candidates -- --preflight-qa --story-id audio-1",
        auto_repairable: true,
      },
      {
        story_id: "motion-1",
        title: "Motion One",
        repair_lane: "visual_v4_motion_enrichment",
        blocker_type: "qa:gold_standard:motion_density_below_reference",
        recommended_command: "npm run ops:v4-source-deficit -- --story-id motion-1 --json",
        post_repair_validation_command:
          "npm run ops:v4-source-deficit -- --story-id motion-1 --json && npm run ops:next-publish-candidates -- --preflight-qa --story-id motion-1",
        auto_repairable: true,
      },
      {
        story_id: "publish-1",
        title: "Unsafe Publish",
        repair_lane: "produce_or_render",
        blocker_type: "missing_mp4",
        recommended_command: "npm run produce -- --story-id publish-1",
        post_repair_validation_command: "npm run ops:next-publish-candidates -- --preflight-qa --story-id publish-1",
        auto_repairable: true,
      },
      {
        story_id: "render-no-input",
        title: "Render Without Input",
        repair_lane: "produce_or_render",
        blocker_type: "qa:approved_voice:local_voice_mastering_missing",
        recommended_command: "npm run ops:goal-production-render -- --story-id render-no-input",
        post_repair_validation_command:
          "npm run ops:next-publish-candidates -- --preflight-qa --story-id render-no-input",
        auto_repairable: true,
      },
      {
        story_id: "manual-1",
        title: "Manual Story",
        repair_lane: "manual_triage",
        blocker_type: "qa:unsupported_source_claim",
        recommended_command: "npm run ops:pipeline-backlog -- --json",
        auto_repairable: false,
      },
      {
        story_id: "voice-1",
        title: "Voice One",
        repair_lane: "voice_mastering_repair",
        blocker_type: "qa:approved_voice:local_voice_mastering_missing",
        recommended_command: "npm run voice:repair-final-audio -- --story-id voice-1 --dry-run",
        post_repair_validation_command:
          "npm run voice:repair-final-audio -- --story-id voice-1 --dry-run && npm run ops:next-publish-candidates -- --preflight-qa --story-id voice-1",
        auto_repairable: true,
      },
    ],
  };
}

test("auto repair runner builds a lane-filtered dry-run plan with safety classifications", () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "audio_regeneration",
    limit: 5,
    generatedAt: "2026-05-31T01:00:00.000Z",
  });

  assert.equal(runPlan.mode, "LOCAL_AUTO_REPAIR_RUN_PLAN");
  assert.equal(runPlan.summary.total_items_considered, 6);
  assert.equal(runPlan.summary.selected_items, 1);
  assert.equal(runPlan.summary.safe_executable_items, 1);
  assert.equal(runPlan.summary.unsafe_items, 0);
  assert.equal(runPlan.lanes.audio_regeneration.total, 1);
  assert.equal(runPlan.items[0].story_id, "audio-1");
  assert.equal(runPlan.items[0].command_safety.safe, true);
  assert.equal(runPlan.items[0].execute_command.args.at(-1), "--dry-run");
  assert.match(runPlan.items[0].validation_command, /next-publish-candidates/);
});

test("auto repair runner accepts publish-unblock repair orchestration output", () => {
  const runPlan = buildAutoRepairRunPlan({
    schema_version: 1,
    generated_at: "2026-05-31T02:00:00.000Z",
    repair_orchestration: {
      stages: [
        {
          id: "operator_review_backlog",
          requires_operator_confirmation: true,
          items: [
            {
              story_id: "manual-qa",
              title: "Manual QA",
              repair_lane: "manual_triage",
              blocker_type: "qa:unsupported_source_claim",
              recommended_command: "npm run ops:pipeline-backlog -- --json",
              operator_approval_required: true,
            },
          ],
        },
        {
          id: "auto_repair_backlog",
          requires_operator_confirmation: false,
          items: [
            {
              story_id: "copy-fix",
              title: "Copy Fix",
              repair_lane: "public_copy_package_repair",
              blocker_type: "qa:public_output:placeholder_title",
              recommended_command:
                "npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id copy-fix --out-dir output/goal-contract --json",
              post_repair_validation_command:
                "npm run ops:next-publish-candidates -- --preflight-qa --story-id copy-fix",
              operator_approval_required: false,
            },
          ],
        },
      ],
    },
  }, {
    generatedAt: "2026-05-31T02:05:00.000Z",
  });

  assert.equal(runPlan.summary.total_items_considered, 2);
  assert.equal(runPlan.summary.source_auto_repairable_items, 1);
  assert.equal(runPlan.summary.selected_items, 1);
  assert.equal(runPlan.summary.safe_executable_items, 1);
  assert.equal(runPlan.items[0].story_id, "copy-fix");
  assert.equal(runPlan.items[0].repair_lane, "public_copy_package_repair");
  assert.equal(runPlan.items[0].command_safety.safe, true);
});

test("auto repair runner accepts local script-extension source-bound rewrite work orders", () => {
  const runPlan = buildAutoRepairRunPlan({
    schema_version: 1,
    generated_at: "2026-06-01T06:00:00.000Z",
    mode: "LOCAL_SCRIPT_EXTENSION_PLAN",
    source_bound_rewrite_work_orders: [
      {
        story_id: "script-review",
        title: "Script Review",
        blocker_type: "public_copy_blocked",
        repair_lane: "source_bound_script_rewrite",
        recommended_command:
          "npm run ops:reprocess-script-failures -- --story-id script-review --force-story --source-bound-only --dry-run --json",
        post_repair_validation_command:
          "npm run ops:local-script-extension -- --story-id script-review --dry-run",
        auto_repairable: true,
        operator_approval_required: true,
        db_mutation_required: false,
      },
    ],
  }, {
    lane: "source_bound_script_rewrite",
    generatedAt: "2026-06-01T06:05:00.000Z",
  });

  assert.equal(runPlan.summary.total_items_considered, 1);
  assert.equal(runPlan.summary.source_auto_repairable_items, 1);
  assert.equal(runPlan.summary.selected_items, 1);
  assert.equal(runPlan.summary.safe_executable_items, 1);
  assert.equal(runPlan.items[0].source, "local_script_extension.source_bound_rewrite_work_orders");
  assert.equal(runPlan.items[0].execute_command.script, "ops:reprocess-script-failures");
  assert.equal(runPlan.items[0].execute_command.args.at(-2), "--dry-run");
});

test("auto repair runner keeps unsafe commands visible but not executable", () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    generatedAt: "2026-05-31T01:00:00.000Z",
  });

  const unsafe = runPlan.items.find((item) => item.story_id === "publish-1");
  assert.ok(unsafe);
  assert.equal(unsafe.command_safety.safe, false);
  assert.match(unsafe.command_safety.reason, /script_not_allowed/);
  assert.equal(runPlan.summary.unsafe_items, 2);
  assert.equal(runPlan.lanes.produce_or_render.unsafe, 2);
});

test("command safety rejects shell chaining, apply modes and token/oauth operations", () => {
  assert.equal(commandSafety("npm run ops:local-tts-publish-refresh -- --story-id a --dry-run").safe, true);
  assert.equal(commandSafety("npm run ops:bridge-live-rights-repair -- --story-id a --json").safe, true);
  assert.equal(commandSafety("npm run ops:bridge-live-rights-repair -- --story-id a --apply").safe, false);
  assert.equal(commandSafety("npm run ops:next-publish-candidates -- --json && node upload_youtube.js").safe, false);
  assert.equal(commandSafety("npm run tiktok:token -- CODE").safe, false);
  assert.equal(commandSafety("node run.js publish").safe, false);
});

test("auto repair runner holds render commands that lack a concrete render input package", () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "produce_or_render",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });

  const noInput = runPlan.items.find((item) => item.story_id === "render-no-input");
  assert.equal(noInput.command_safety.safe, false);
  assert.match(noInput.command_safety.reason, /render_input_package_missing/);
  assert.equal(noInput.execute_command, null);
});

test("auto repair runner allows local media apply only for voice mastering repairs", () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "voice_mastering_repair",
    localMediaApply: true,
    generatedAt: "2026-05-31T01:00:00.000Z",
  });

  assert.equal(runPlan.summary.selected_items, 1);
  assert.equal(runPlan.summary.safe_executable_items, 1);
  assert.equal(runPlan.safety.local_media_writes, true);
  assert.equal(runPlan.items[0].command, "npm run voice:repair-final-audio -- --story-id voice-1 --apply-local");
  assert.equal(runPlan.items[0].execute_command.args.at(-1), "--apply-local");

  const wrongLane = commandSafety(
    "npm run ops:local-media-repair -- --story-id media-1 --apply-local",
    { allowLocalMediaApply: true, repairLane: "platform_media_repair" },
  );
  assert.equal(wrongLane.safe, false);
  assert.match(wrongLane.reason, /unsafe_flag/);
});

test("auto repair runner parses npm commands without using a shell", () => {
  const parsed = parseNpmRunCommand("npm run ops:v4-source-deficit -- --story-id motion-1 --json");

  assert.equal(parsed.ok, true);
  assert.equal(parsed.executable, "npm");
  assert.deepEqual(parsed.args, ["run", "ops:v4-source-deficit", "--", "--story-id", "motion-1", "--json"]);
});

test("auto repair runner resolves npm scripts through npm_execpath without shelling out", () => {
  const resolved = resolveExecutableCommand({
    executable: "npm",
    args: ["run", "ops:next-publish-candidates", "--", "--json"],
  }, {
    npmExecPath: "C:/node/npm-cli.js",
    nodeExecPath: "C:/node/node.exe",
  });

  assert.equal(resolved.executable, "C:/node/node.exe");
  assert.deepEqual(resolved.args, ["C:/node/npm-cli.js", "run", "ops:next-publish-candidates", "--", "--json"]);
  assert.equal(resolved.shell, false);
});

test("auto repair runner dry-run execution does not call the command runner", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "audio_regeneration",
  });
  let called = false;

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: false,
    runCommand: async () => {
      called = true;
    },
  });

  assert.equal(called, false);
  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.planned_only, 1);
  assert.equal(report.safety.execution_requested, false);
});

test("auto repair runner execute mode runs only safe selected commands", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  const ran = [];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async (command) => {
      ran.push(command);
      return { code: 0, stdout: "ok", stderr: "" };
    },
  });

  assert.deepEqual(
    ran.map((command) => command.script),
    ["ops:local-tts-publish-refresh", "ops:v4-source-deficit", "voice:repair-final-audio"],
  );
  assert.equal(report.summary.executed, 3);
  assert.equal(report.summary.no_effect, 0);
  assert.equal(report.summary.skipped_unsafe, 2);
  assert.equal(report.results.find((item) => item.story_id === "publish-1").status, "skipped_unsafe");
});

test("auto repair runner does not count no-effect local repairs as successful repair work", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "voice_mastering_repair",
    localMediaApply: true,
    generatedAt: "2026-05-31T01:00:00.000Z",
  });

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: "{\"summary\":{\"candidates\":0,\"processed\":0,\"script_ready\":0}}",
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_no_effect");
});

test("auto repair runner treats runtime-blocked local media dry runs as no-effect", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "platform_media_repair",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "media-1",
      repair_lane: "platform_media_repair",
      command: "npm run ops:local-media-repair -- --story-id media-1 --dry-run",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:local-media-repair",
        args: ["run", "ops:local-media-repair", "--", "--story-id", "media-1", "--dry-run"],
      },
    },
  ];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: "[local-media-repair] total=1 ready=0 runtime_blocked=1 tts_blocked=0 no_action=0",
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_no_effect");
});

test("auto repair runner treats markdown zero-candidate script reprocess runs as no-effect", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "script_runtime_rewrite",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "script-1",
      repair_lane: "script_runtime_rewrite",
      command: "npm run ops:reprocess-script-failures -- --story-id script-1 --dry-run",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:reprocess-script-failures",
        args: ["run", "ops:reprocess-script-failures", "--", "--story-id", "script-1", "--dry-run"],
      },
    },
  ];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: "## Summary - Candidates: 0 - Processed: 0 - Script-ready: 0 - Still review: 0 - Failed: 0 ## Rows - none",
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_no_effect");
});

test("auto repair runner treats still-review script reprocess runs as no-effect", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "script_runtime_rewrite",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "script-review",
      repair_lane: "script_runtime_rewrite",
      command: "npm run ops:reprocess-script-failures -- --story-id script-review --dry-run",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:reprocess-script-failures",
        args: ["run", "ops:reprocess-script-failures", "--", "--story-id", "script-review", "--dry-run"],
      },
    },
  ];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout:
        "## Summary - Candidates: 1 - Processed: 1 - Script-ready: 0 - Still review: 1 - Failed: 0 ## Rows - script-review: still_review",
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_no_effect");
});

test("auto repair runner treats zero-package public-copy repair as no-effect", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "public_copy_package_repair",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "copy-1",
      repair_lane: "public_copy_package_repair",
      command:
        "npm run ops:goal-public-copy-repair -- --story-packages output/goal-contract/production_cutover_story_packages.json --story-id copy-1 --out-dir output/goal-contract --json",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:goal-public-copy-repair",
        args: [
          "run",
          "ops:goal-public-copy-repair",
          "--",
          "--story-packages",
          "output/goal-contract/production_cutover_story_packages.json",
          "--story-id",
          "copy-1",
          "--out-dir",
          "output/goal-contract",
          "--json",
        ],
      },
    },
  ];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: "{\"summary\":{\"package_count\":0,\"changed_count\":0,\"blocked_count\":0}}",
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_no_effect");
});

test("auto repair runner classifies local TTS dry-run refresh plans without claiming audio repair", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "audio_regeneration",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "audio-plan",
      repair_lane: "audio_regeneration",
      command: "npm run ops:local-tts-publish-refresh -- --story-id audio-plan --dry-run",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:local-tts-publish-refresh",
        args: ["run", "ops:local-tts-publish-refresh", "--", "--story-id", "audio-plan", "--dry-run"],
      },
    },
    {
      story_id: "audio-blocked",
      repair_lane: "audio_regeneration",
      command: "npm run ops:local-tts-publish-refresh -- --story-id audio-blocked --dry-run",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:local-tts-publish-refresh",
        args: ["run", "ops:local-tts-publish-refresh", "--", "--story-id", "audio-blocked", "--dry-run"],
      },
    },
  ];

  const outputs = [
    "[local-tts-publish-refresh] plan refreshable=1 blocked=0",
    "[local-tts-publish-refresh] plan refreshable=0 blocked=1",
  ];
  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: outputs.shift(),
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.plan_generated, 1);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_plan_generated");
  assert.equal(report.results[1].status, "executed_no_effect");
});

test("auto repair runner treats bridge story-not-found preflights as no-effect", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "stale_script_qa_recheck",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "stale-1",
      repair_lane: "stale_script_qa_recheck",
      command: "npm run ops:next-publish-candidates -- --preflight-qa --story-id stale-1",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:next-publish-candidates",
        args: ["run", "ops:next-publish-candidates", "--", "--preflight-qa", "--story-id", "stale-1"],
      },
    },
  ];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: "## Story Preflight - story id: stale-1 - status: blocked - blockers: story_not_found",
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.no_effect, 1);
  assert.equal(report.results[0].status, "executed_no_effect");
});

test("auto repair runner separates generated repair plans from completed repair work", async () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    lane: "motion_v4_motion_enrichment",
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  runPlan.items = [
    {
      story_id: "motion-1",
      repair_lane: "visual_v4_motion_enrichment",
      command: "npm run ops:v4-source-deficit -- --story-id motion-1 --json",
      command_safety: { safe: true, reason: "safe_local_repair_command" },
      execute_command: {
        executable: "npm",
        script: "ops:v4-source-deficit",
        args: ["run", "ops:v4-source-deficit", "--", "--story-id", "motion-1", "--json"],
      },
    },
  ];

  const report = await executeAutoRepairRunPlan(runPlan, {
    execute: true,
    runCommand: async () => ({
      code: 0,
      stdout: JSON.stringify({
        story_id: "motion-1",
        acquisition_counts: { direct_media_ready: 0 },
        safe_next_commands: [{ step: "discover_direct_media", command: "npm run media:discover-direct-media" }],
      }),
      stderr: "",
    }),
  });

  assert.equal(report.summary.executed, 0);
  assert.equal(report.summary.plan_generated, 1);
  assert.equal(report.results[0].status, "executed_plan_generated");
});

test("auto repair runner markdown is operator-facing and explicit about no posting", () => {
  const runPlan = buildAutoRepairRunPlan(planFixture(), {
    generatedAt: "2026-05-31T01:00:00.000Z",
  });
  const executionReport = {
    summary: {
      executed: 1,
      no_effect: 2,
      plan_generated: 3,
      failed: 0,
      planned_only: 4,
      skipped_unsafe: 5,
    },
  };
  const markdown = renderAutoRepairRunMarkdown(runPlan, executionReport);

  assert.match(markdown, /Auto Repair Run Plan/);
  assert.match(markdown, /No posting, token changes or OAuth changes/);
  assert.match(markdown, /audio_regeneration/);
  assert.match(markdown, /No effect: 2/);
  assert.match(markdown, /Repair plans generated: 3/);
});

test("auto repair runner CLI arguments cover plan, lane, limit, execute and output", () => {
  const args = parseArgs([
    "--plan",
    "output/goal-contract/auto_repair_plan.json",
    "--lane",
    "audio_regeneration",
    "--limit",
    "3",
    "--execute",
    "--apply-local-media",
    "--out-dir",
    "test/output/auto-repair-runner",
    "--json",
  ]);

  assert.equal(args.planPath, "output/goal-contract/auto_repair_plan.json");
  assert.equal(args.lane, "audio_regeneration");
  assert.equal(args.limit, 3);
  assert.equal(args.execute, true);
  assert.equal(args.localMediaApply, true);
  assert.equal(args.outDir, "test/output/auto-repair-runner");
  assert.equal(args.json, true);
});
