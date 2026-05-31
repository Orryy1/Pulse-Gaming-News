"use strict";

const cp = require("node:child_process");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function unique(values = []) {
  return [...new Set(values.map(cleanText).filter(Boolean))];
}

function splitCommand(command = "") {
  const input = String(command || "").trim();
  const tokens = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) return { ok: false, reason: "unclosed_quote", tokens: [] };
  if (current) tokens.push(current);
  return { ok: true, tokens };
}

function hasShellControl(command = "") {
  return /(?:&&|\|\||[|;<>`]|[$]\(|\r|\n)/.test(String(command || ""));
}

function parseNpmRunCommand(command = "") {
  const raw = cleanText(command);
  if (!raw) return { ok: false, reason: "empty_command", raw };
  if (hasShellControl(raw)) return { ok: false, reason: "shell_control_operator", raw };
  const split = splitCommand(raw);
  if (!split.ok) return { ok: false, reason: split.reason, raw };
  const tokens = split.tokens;
  const executable = tokens[0] || "";
  if (!/^npm(?:\.cmd)?$/i.test(executable)) {
    return { ok: false, reason: "not_npm_run_command", raw, tokens };
  }
  if (tokens[1] !== "run" || !tokens[2]) {
    return { ok: false, reason: "not_npm_run_command", raw, tokens };
  }
  return {
    ok: true,
    raw,
    executable: "npm",
    script: tokens[2],
    args: ["run", tokens[2], ...tokens.slice(3)],
    tokens,
  };
}

const SAFE_EXECUTABLE_SCRIPTS = new Set([
  "ops:local-tts-publish-refresh",
  "ops:reprocess-script-failures",
  "ops:v4-source-deficit",
  "ops:bridge-live-rights-repair",
  "ops:local-media-repair",
  "ops:goal-stale-temporal-review",
  "ops:next-publish-candidates",
  "ops:goal-render-inputs",
  "ops:goal-audio-timestamps",
  "ops:goal-audio-materialize",
  "ops:goal-owned-motion",
  "ops:goal-real-motion",
  "ops:goal-public-copy-repair",
  "ops:goal-coherence-artifact-repair",
  "ops:goal-narration-qa-repair",
  "ops:goal-sfx-evidence-repair",
  "ops:goal-production-render",
  "voice:repair-final-audio",
]);

const DRY_RUN_REQUIRED_SCRIPTS = new Set([
  "ops:local-tts-publish-refresh",
  "ops:reprocess-script-failures",
  "ops:local-media-repair",
  "voice:repair-final-audio",
]);

const UNSAFE_FLAG_PATTERNS = [
  /^--apply$/,
  /^--operator-confirmed$/,
  /^--apply-local$/,
  /^--apply-local-audio$/,
  /^--apply-local-reset$/,
  /^--rerender$/,
  /^--allow-published-repair$/,
  /^--token$/,
  /^--auth$/,
];

function argsContain(args = [], value = "") {
  return asArray(args).includes(value);
}

function unsafeFlag(args = []) {
  return asArray(args).find((arg) => UNSAFE_FLAG_PATTERNS.some((pattern) => pattern.test(String(arg || ""))));
}

function isAllowedLocalMediaApply({ script = "", repairLane = "", flag = "" } = {}) {
  return (
    flag === "--apply-local" &&
    script === "voice:repair-final-audio" &&
    repairLane === "voice_mastering_repair"
  );
}

function commandSafety(command = "", { allowLocalMediaApply = false, repairLane = "" } = {}) {
  const parsed = parseNpmRunCommand(command);
  if (!parsed.ok) {
    return {
      safe: false,
      reason: parsed.reason || "unparseable_command",
      parsed,
    };
  }
  const script = parsed.script;
  const args = parsed.args.slice(2);
  if (!SAFE_EXECUTABLE_SCRIPTS.has(script)) {
    return {
      safe: false,
      reason: `script_not_allowed:${script}`,
      parsed,
    };
  }
  const blockedFlag = unsafeFlag(args);
  if (
    blockedFlag &&
    !(allowLocalMediaApply && isAllowedLocalMediaApply({ script, repairLane: cleanText(repairLane), flag: blockedFlag }))
  ) {
    return {
      safe: false,
      reason: `unsafe_flag:${blockedFlag}`,
      parsed,
    };
  }
  if (
    DRY_RUN_REQUIRED_SCRIPTS.has(script) &&
    !argsContain(args, "--dry-run") &&
    !(allowLocalMediaApply && isAllowedLocalMediaApply({ script, repairLane: cleanText(repairLane), flag: "--apply-local" }) && argsContain(args, "--apply-local"))
  ) {
    return {
      safe: false,
      reason: `dry_run_flag_required:${script}`,
      parsed,
    };
  }
  return {
    safe: true,
    reason: "safe_local_repair_command",
    parsed,
  };
}

function normaliseLane(item = {}) {
  return cleanText(item.repair_lane || item.lane || "unknown");
}

function itemCommand(item = {}) {
  return cleanText(item.recommended_command || item.command || "");
}

function stageId(stage = {}) {
  return cleanText(stage.id || stage.stage || stage.lane);
}

function isOperatorRequired(item = {}, stage = {}) {
  return (
    item.operator_approval_required === true ||
    item.requires_operator_confirmation === true ||
    stage.requires_operator_confirmation === true ||
    stageId(stage) === "operator_review_backlog"
  );
}

function isAutoRepairablePlanItem(item = {}, stage = {}) {
  if (item.auto_repairable === true || item.can_apply_automatically === true) return true;
  if (item.auto_repairable === false || item.can_apply_automatically === false) return false;
  return stageId(stage) === "auto_repair_backlog" && !isOperatorRequired(item, stage);
}

function normaliseRepairPlanItem(item = {}, { stage = null, source = "" } = {}) {
  const stageSource = stage ? `repair_orchestration.${stageId(stage) || "stage"}` : "";
  return {
    ...item,
    repair_lane: cleanText(item.repair_lane || item.resolution_lane || item.lane || stage?.repair_lane || stage?.lane),
    lane: cleanText(item.lane || item.repair_lane || item.resolution_lane || stage?.lane || stage?.repair_lane),
    blocker_type: cleanText(item.blocker_type || item.blocker),
    recommended_command: cleanText(item.recommended_command || item.command || item.safe_next_command),
    command: cleanText(item.command || item.recommended_command || item.safe_next_command),
    post_repair_validation_command: cleanText(item.post_repair_validation_command || item.validation_command),
    auto_repairable: isAutoRepairablePlanItem(item, stage || {}),
    source: cleanText(item.source || source || stageSource || "auto_repair_plan"),
  };
}

function dedupeRepairPlanItems(items = []) {
  const seen = new Set();
  const result = [];
  for (const item of asArray(items)) {
    const key = [
      cleanText(item.story_id),
      cleanText(item.blocker_type || item.blocker),
      cleanText(item.recommended_command || item.command || item.safe_next_command),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractAutoRepairPlanItems(autoRepairPlan = {}) {
  const directItems = asArray(autoRepairPlan.items);
  if (directItems.length) {
    return dedupeRepairPlanItems(directItems.map((item) => normaliseRepairPlanItem(item)));
  }

  const stagedItems = asArray(autoRepairPlan.repair_orchestration?.stages)
    .flatMap((stage) => asArray(stage.items).map((item) => normaliseRepairPlanItem(item, {
      stage,
      source: "publish_blocker_resolution.repair_orchestration",
    })));
  if (stagedItems.length) return dedupeRepairPlanItems(stagedItems);

  const priorityItems = asArray(autoRepairPlan.priority_items)
    .map((item) => normaliseRepairPlanItem(item, {
      source: "publish_blocker_resolution.priority_items",
    }));
  if (priorityItems.length) return dedupeRepairPlanItems(priorityItems);

  const backlogItems = asArray(autoRepairPlan.repair_backlog?.items)
    .map((item) => normaliseRepairPlanItem(item, {
      source: "repair_backlog.items",
    }));
  if (backlogItems.length) return dedupeRepairPlanItems(backlogItems);

  return [];
}

function localApplyCommandForItem(item = {}, command = "") {
  const lane = normaliseLane(item);
  if (lane !== "voice_mastering_repair") return command;
  const parsed = parseNpmRunCommand(command);
  if (!parsed.ok || parsed.script !== "voice:repair-final-audio") return command;
  const tokens = parsed.tokens.slice();
  const dryRunIndex = tokens.indexOf("--dry-run");
  if (dryRunIndex >= 0) {
    tokens[dryRunIndex] = "--apply-local";
    return tokens.join(" ");
  }
  if (!tokens.includes("--apply-local")) tokens.push("--apply-local");
  return tokens.join(" ");
}

function countByLane(items = []) {
  const lanes = {};
  for (const item of asArray(items)) {
    const lane = normaliseLane(item);
    if (!lanes[lane]) {
      lanes[lane] = { total: 0, safe: 0, unsafe: 0 };
    }
    lanes[lane].total += 1;
    if (item.command_safety?.safe === true) lanes[lane].safe += 1;
    else lanes[lane].unsafe += 1;
  }
  return lanes;
}

function renderInputPackagePresent(item = {}) {
  return Boolean(
    cleanText(item.artifact_dir) ||
    cleanText(item.required_artefact_path) ||
    asArray(item.required_artefact_paths).some(cleanText),
  );
}

function selectAutoRepairItems(items = [], { lane = "", storyIds = [], limit = 0 } = {}) {
  const wantedLane = cleanText(lane);
  const wantedStories = new Set(unique(storyIds));
  const selected = asArray(items).filter((item) => {
    if (item.auto_repairable !== true) return false;
    if (wantedLane && normaliseLane(item) !== wantedLane) return false;
    if (wantedStories.size && !wantedStories.has(cleanText(item.story_id))) return false;
    return true;
  });
  const max = numberOrZero(limit);
  return max > 0 ? selected.slice(0, max) : selected;
}

function buildAutoRepairRunPlan(autoRepairPlan = {}, {
  lane = "",
  storyIds = [],
  limit = 0,
  generatedAt = new Date().toISOString(),
  localMediaApply = false,
} = {}) {
  const sourceItems = extractAutoRepairPlanItems(autoRepairPlan);
  const selected = selectAutoRepairItems(sourceItems, { lane, storyIds, limit });
  const items = selected.map((item) => {
    const baseCommand = itemCommand(item);
    const command = localMediaApply ? localApplyCommandForItem(item, baseCommand) : baseCommand;
    let safety = commandSafety(command, {
      allowLocalMediaApply: localMediaApply === true,
      repairLane: normaliseLane(item),
    });
    if (
      safety.safe === true &&
      normaliseLane(item) === "produce_or_render" &&
      !renderInputPackagePresent(item)
    ) {
      safety = {
        ...safety,
        safe: false,
        reason: "render_input_package_missing",
      };
    }
    return {
      story_id: cleanText(item.story_id),
      title: cleanText(item.title),
      blocker_type: cleanText(item.blocker_type || item.blocker),
      repair_lane: normaliseLane(item),
      command,
      recommended_command: command,
      validation_command: cleanText(item.post_repair_validation_command),
      command_safety: {
        safe: safety.safe,
        reason: safety.reason,
      },
      execute_command: safety.safe
        ? {
            executable: safety.parsed.executable,
            script: safety.parsed.script,
            args: safety.parsed.args,
          }
        : null,
      expected_output: item.expected_output || [],
      required_artefact_path: item.required_artefact_path || "",
      required_artefact_paths: asArray(item.required_artefact_paths || [item.required_artefact_path]).filter(Boolean),
      source: item.source || autoRepairPlan.mode || "auto_repair_plan",
    };
  });
  const safeCount = items.filter((item) => item.command_safety.safe).length;
  const unsafeCount = items.length - safeCount;
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_AUTO_REPAIR_RUN_PLAN",
    source_plan_generated_at: autoRepairPlan.generated_at || null,
    filters: {
      lane: cleanText(lane) || null,
      story_ids: unique(storyIds),
      limit: numberOrZero(limit),
    },
    summary: {
      total_items_considered: sourceItems.length,
      source_auto_repairable_items: sourceItems.filter((item) => item.auto_repairable === true).length,
      selected_items: items.length,
      safe_executable_items: safeCount,
      unsafe_items: unsafeCount,
    },
    lanes: countByLane(items),
    items,
    safety: {
      mode: "LOCAL_PROOF",
      dry_run_by_default: true,
      local_media_writes: localMediaApply === true,
      posting: false,
      oauth: false,
      token_mutation: false,
      db_mutation: false,
      safety_gates_weakened: false,
      shell_execution: false,
    },
  };
}

function resolveExecutableCommand(command = {}, env = process.env) {
  if (command.executable !== "npm") {
    return {
      executable: command.executable,
      args: asArray(command.args),
      shell: false,
    };
  }
  const npmExecPath = cleanText(env.npmExecPath || env.npm_execpath);
  const nodeExecPath = cleanText(env.nodeExecPath || process.execPath);
  if (npmExecPath && nodeExecPath) {
    return {
      executable: nodeExecPath,
      args: [npmExecPath, ...asArray(command.args)],
      shell: false,
    };
  }
  return {
    executable: process.platform === "win32" ? "npm.cmd" : "npm",
    args: asArray(command.args),
    shell: false,
  };
}

function defaultRunCommand(command) {
  return new Promise((resolve) => {
    const resolved = resolveExecutableCommand(command);
    cp.execFile(resolved.executable, resolved.args, {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolve({
        code: error && Number.isInteger(error.code) ? error.code : 0,
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        error: error ? cleanText(error.message) : "",
      });
    });
  });
}

function executionNoEffect(stdout = "", stderr = "") {
  const output = cleanText(`${stdout} ${stderr}`);
  return (
    /rendered=0 failed=0 skipped=0/.test(output) ||
    /mode=apply-local inspected=\d+ needs=[1-9]\d* applied=0/.test(output) ||
    /ready=0 runtime_blocked=[1-9]\d*/.test(output) ||
    /ready=0 .* no_action=[1-9]\d*/.test(output) ||
    /plan refreshable=0 blocked=[1-9]\d*/.test(output) ||
    /blockers:\s*story_not_found\b/i.test(output) ||
    /"script_ready"\s*:\s*0\s*,\s*"still_review"\s*:\s*[1-9]\d*/.test(output) ||
    /"candidates"\s*:\s*0\s*,\s*"processed"\s*:\s*0/.test(output) ||
    /"package_count"\s*:\s*0\s*,\s*"changed_count"\s*:\s*0/.test(output) ||
    /Script-ready:\s*0\b.*Still review:\s*[1-9]\d*/i.test(output) ||
    /Candidates:\s*0\b.*Processed:\s*0\b/i.test(output)
  );
}

function executionPlanGenerated(stdout = "", stderr = "") {
  const output = cleanText(`${stdout} ${stderr}`);
  return (
    /"safe_next_commands"\s*:/.test(output) ||
    /plan refreshable=[1-9]\d* blocked=\d+/.test(output) ||
    (/"apply_result"\s*:\s*null/.test(output) && /"requires_operator_confirmed"\s*:\s*true/.test(output))
  );
}

async function executeAutoRepairRunPlan(runPlan = {}, {
  execute = false,
  runCommand = defaultRunCommand,
  generatedAt = new Date().toISOString(),
} = {}) {
  const results = [];
  for (const item of asArray(runPlan.items)) {
    if (item.command_safety?.safe !== true || !item.execute_command) {
      results.push({
        story_id: item.story_id,
        repair_lane: item.repair_lane,
        status: "skipped_unsafe",
        reason: item.command_safety?.reason || "unsafe_command",
        command: item.command,
      });
      continue;
    }
    if (!execute) {
      results.push({
        story_id: item.story_id,
        repair_lane: item.repair_lane,
        status: "planned_only",
        command: item.command,
      });
      continue;
    }
    const startedAt = new Date().toISOString();
    const result = await runCommand(item.execute_command, item);
    const exitCode = Number.isInteger(result?.code) ? result.code : 0;
    const noEffect = exitCode === 0 && executionNoEffect(result?.stdout, result?.stderr || result?.error);
    const planGenerated = exitCode === 0 && !noEffect && executionPlanGenerated(result?.stdout, result?.stderr || result?.error);
    const status = exitCode !== 0
      ? "failed"
      : noEffect
        ? "executed_no_effect"
        : planGenerated
          ? "executed_plan_generated"
          : "executed";
    results.push({
      story_id: item.story_id,
      repair_lane: item.repair_lane,
      status,
      command: item.command,
      exit_code: exitCode,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      stdout_tail: cleanText(result?.stdout).slice(-2000),
      stderr_tail: cleanText(result?.stderr || result?.error).slice(-2000),
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: execute ? "LOCAL_AUTO_REPAIR_EXECUTION_RESULT" : "LOCAL_AUTO_REPAIR_DRY_RUN_RESULT",
    source_plan_generated_at: runPlan.generated_at || null,
    summary: {
      total_items: results.length,
      executed: results.filter((item) => item.status === "executed").length,
      no_effect: results.filter((item) => item.status === "executed_no_effect").length,
      plan_generated: results.filter((item) => item.status === "executed_plan_generated").length,
      failed: results.filter((item) => item.status === "failed").length,
      planned_only: results.filter((item) => item.status === "planned_only").length,
      skipped_unsafe: results.filter((item) => item.status === "skipped_unsafe").length,
    },
    safety: {
      execution_requested: execute === true,
      local_media_writes: runPlan.safety?.local_media_writes === true,
      posting: false,
      oauth: false,
      token_mutation: false,
      db_mutation: false,
      safety_gates_weakened: false,
      shell_execution: false,
    },
    results,
  };
}

function renderAutoRepairRunMarkdown(runPlan = {}, executionReport = null) {
  const lines = [];
  const summary = runPlan.summary || {};
  lines.push("# Auto Repair Run Plan");
  lines.push("");
  lines.push(`Generated: ${runPlan.generated_at || ""}`);
  lines.push(`Selected repair items: ${summary.selected_items || 0}`);
  lines.push(`Safe executable items: ${summary.safe_executable_items || 0}`);
  lines.push(`Unsafe items held: ${summary.unsafe_items || 0}`);
  lines.push("");
  lines.push("No posting, token changes or OAuth changes are allowed by this runner.");
  lines.push("");
  lines.push("## Lanes");
  const lanes = runPlan.lanes || {};
  for (const lane of Object.keys(lanes).sort()) {
    const row = lanes[lane];
    lines.push(`- ${lane}: ${row.total || 0} total, ${row.safe || 0} safe, ${row.unsafe || 0} held`);
  }
  if (!Object.keys(lanes).length) lines.push("- none");
  lines.push("");
  lines.push("## Items");
  for (const item of asArray(runPlan.items).slice(0, 30)) {
    const status = item.command_safety?.safe ? "safe" : `held (${item.command_safety?.reason || "unsafe"})`;
    lines.push(`- ${item.story_id}: ${item.repair_lane}; ${status}`);
  }
  if (!asArray(runPlan.items).length) lines.push("- none");
  if (executionReport) {
    lines.push("");
    lines.push("## Execution");
    lines.push(`Executed: ${executionReport.summary?.executed || 0}`);
    lines.push(`No effect: ${executionReport.summary?.no_effect || 0}`);
    lines.push(`Repair plans generated: ${executionReport.summary?.plan_generated || 0}`);
    lines.push(`Failed: ${executionReport.summary?.failed || 0}`);
    lines.push(`Planned only: ${executionReport.summary?.planned_only || 0}`);
    lines.push(`Skipped unsafe: ${executionReport.summary?.skipped_unsafe || 0}`);
  }
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildAutoRepairRunPlan,
  commandSafety,
  executeAutoRepairRunPlan,
  parseNpmRunCommand,
  renderAutoRepairRunMarkdown,
  resolveExecutableCommand,
  splitCommand,
};
