#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { parseArgs: parseNodeArgs } = require("node:util");
const fs = require("fs-extra");

const {
  cloneFlagshipScriptRepairWorkspace,
  repairFlagshipScriptWorkspace,
  validateFlagshipScriptPatch,
} = require("../lib/flagship-script-repair");

function parseArgs(argv = []) {
  const { values } = parseNodeArgs({
    args: argv,
    allowPositionals: false,
    options: {
      "artifact-dir": { type: "string" },
      "work-order": { type: "string" },
      patch: { type: "string" },
      workspace: { type: "string" },
      "generated-at": { type: "string" },
      apply: { type: "boolean", default: false },
      "operator-confirmed": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });
  return {
    artifactDir: values["artifact-dir"] || "",
    workOrderPath: values["work-order"] || "",
    patchPath: values.patch || "",
    workspaceDir: values.workspace || "",
    generatedAt: values["generated-at"] || new Date().toISOString(),
    apply: values.apply === true,
    operatorConfirmed: values["operator-confirmed"] === true,
    json: values.json === true,
    help: values.help === true,
  };
}

function usage() {
  return [
    "Usage: node tools/flagship-script-repair.js [options]",
    "",
    "Required:",
    "  --artifact-dir <path>   Governed story artefact directory",
    "  --work-order <path>     Render input work order containing the story",
    "  --patch <path>          Reviewed JSON script patch",
    "  --workspace <dir>       Clone into a new isolated repair workspace",
    "",
    "Plan-only by default. Mutation requires both:",
    "  --apply --operator-confirmed",
    "",
    "Optional:",
    "  --generated-at <ISO>    Deterministic evidence timestamp",
    "  --json                  Print machine-readable report",
  ].join("\n");
}

async function buildPlan({ artifactDir, workOrderPath, patchPath, generatedAt }) {
  const resolvedArtifactDir = path.resolve(artifactDir);
  const resolvedWorkOrderPath = path.resolve(workOrderPath);
  const resolvedPatchPath = path.resolve(patchPath);
  const canonicalPath = path.join(resolvedArtifactDir, "canonical_story_manifest.json");
  const [canonical, patch] = await Promise.all([
    fs.readJson(canonicalPath),
    fs.readJson(resolvedPatchPath),
  ]);
  const validated = validateFlagshipScriptPatch(patch, canonical);
  const workOrder = await fs.readJson(resolvedWorkOrderPath);
  const matchingJobs = (Array.isArray(workOrder.jobs) ? workOrder.jobs : [])
    .filter((job) => String(job?.story_id || "").trim() === validated.storyId);
  if (matchingJobs.length !== 1) {
    throw new Error(`script_repair_work_order_job_count:${matchingJobs.length}`);
  }
  if (path.resolve(matchingJobs[0].artifact_dir || "") !== resolvedArtifactDir) {
    throw new Error("script_repair_work_order_artifact_mismatch");
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "PLAN_VERIFY",
    status: "READY_TO_APPLY",
    story_id: validated.storyId,
    title: validated.title,
    script_word_count: validated.wordCount,
    artifact_dir: resolvedArtifactDir,
    work_order_path: resolvedWorkOrderPath,
    patch_path: resolvedPatchPath,
    mutation_performed: false,
    publish_authorised: false,
    required_apply_flags: ["--apply", "--operator-confirmed"],
    safety: {
      local_only: true,
      no_publish_triggered: true,
      production_db_mutated: false,
      oauth_or_token_mutated: false,
      stale_media_not_invalidated_in_plan_mode: true,
    },
  };
}

async function main(argv = process.argv.slice(2), {
  stdout = process.stdout,
} = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { status: "HELP" };
  }
  if (!args.artifactDir || !args.workOrderPath || !args.patchPath) {
    throw new Error("artifact-dir, work-order and patch are required");
  }
  if (args.apply !== args.operatorConfirmed) {
    throw new Error("script repair apply requires --apply and --operator-confirmed together");
  }

  let result;
  if (args.apply) {
    const patch = await fs.readJson(path.resolve(args.patchPath));
    result = args.workspaceDir
      ? await cloneFlagshipScriptRepairWorkspace({
        sourceArtifactDir: args.artifactDir,
        sourceWorkOrderPath: args.workOrderPath,
        workspaceDir: args.workspaceDir,
        patch,
        generatedAt: args.generatedAt,
      })
      : await repairFlagshipScriptWorkspace({
        artifactDir: args.artifactDir,
        workOrderPath: args.workOrderPath,
        patch,
        generatedAt: args.generatedAt,
      });
  } else {
    result = {
      report: await buildPlan(args),
    };
  }

  const report = result.report || result;
  if (args.json) stdout.write(`${JSON.stringify(report)}\n`);
  else stdout.write(`${report.status}: ${report.story_id}\n`);
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[flagship-script-repair] FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPlan,
  main,
  parseArgs,
  usage,
};
