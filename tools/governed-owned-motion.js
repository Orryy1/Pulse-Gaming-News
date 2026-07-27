#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  validateStoryIntakeManifest,
} = require("../lib/services/governed-story-intake");
const {
  buildOwnedMotionPlan,
  inspectFfmpeg,
  materializeOwnedMotion,
  validateApplyAuthority,
  writeOwnedMotionPlan,
} = require("../lib/services/governed-owned-motion");

const RESULT_SCHEMA = "pulse-governed-owned-motion-result-v1";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyManifest: null,
    outputDir: null,
    applyRequested: false,
    confirmStoryId: null,
    confirmManifestSha256: null,
    generatedAt: new Date().toISOString(),
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--apply") {
      args.applyRequested = true;
      continue;
    }
    if (argument === "--help" || argument === "-h" || argument === "-?") {
      args.help = true;
      continue;
    }
    const mapped = {
      "--story-manifest": "storyManifest",
      "--out-dir": "outputDir",
      "--confirm-story-id": "confirmStoryId",
      "--confirm-manifest-sha256": "confirmManifestSha256",
      "--generated-at": "generatedAt",
    }[argument];
    if (!mapped) throw new Error(`unknown_argument:${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing_value:${argument}`);
    }
    args[mapped] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/governed-owned-motion.js [options]",
    "",
    "Required:",
    "  --story-manifest <path>        Validated official story-intake manifest",
    "  --out-dir <path>               Explicit local proof output directory",
    "",
    "Apply-only:",
    "  --apply                        Materialise owned stills and motion",
    "  --confirm-story-id <id>        Exact deterministic story id",
    "  --confirm-manifest-sha256 <h>  Exact story-intake file SHA-256",
    "",
    "Optional:",
    "  --generated-at <iso>           Fixed evidence timestamp",
    "",
    "Dry-run is the default. This command never uses a database, OAuth,",
    "platform APIs, third-party acquisition or external publishing.",
  ].join("\n");
}

function resultSummary({
  plan,
  written,
  mode,
  verdict,
  blockers = [],
  materialized = null,
} = {}) {
  return {
    schema_version: RESULT_SCHEMA,
    generated_at: plan.generated_at,
    mode,
    verdict,
    mutated: Boolean(materialized),
    story_id: plan.story_id,
    intake_manifest_sha256: plan.intake_manifest_sha256,
    plan_path: written.plan_path,
    markdown_path: written.markdown_path,
    asset_manifest_path: materialized?.manifest_path || null,
    asset_manifest_markdown_path: materialized?.markdown_path || null,
    asset_manifest_sha256: materialized?.manifest_sha256 || null,
    asset_count: materialized?.manifest?.assets?.length || 0,
    blockers: [...new Set(blockers)],
    rights_basis: "OWNED",
    attribution_required: false,
    external_publish_authorised: false,
    database_mutation_authorised: false,
    oauth_mutation_authorised: false,
    network_used: false,
  };
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { help: true };
  }
  if (!args.storyManifest) {
    throw new Error("story_manifest_required");
  }
  if (!args.outputDir) {
    throw new Error("explicit_output_dir_required");
  }
  const validate =
    deps.validateStoryIntakeManifest || validateStoryIntakeManifest;
  const validation = validate({
    manifestPath: path.resolve(args.storyManifest),
  });
  const inspect = deps.inspectFfmpeg || inspectFfmpeg;
  const ffmpeg = inspect();
  const plan = buildOwnedMotionPlan({
    intake: validation.manifest,
    intakeManifestSha256: validation.manifestSha256,
    outputDir: path.resolve(args.outputDir),
    generatedAt: args.generatedAt,
    ffmpegAvailable: ffmpeg.available === true,
  });
  const writePlan = deps.writeOwnedMotionPlan || writeOwnedMotionPlan;
  const written = await writePlan(plan);

  let result;
  if (!args.applyRequested) {
    result = resultSummary({
      plan,
      written,
      mode: "DRY_RUN",
      verdict: plan.ready ? "READY" : "HOLD",
      blockers: plan.blockers,
    });
  } else {
    const authority = validateApplyAuthority({
      applyRequested: true,
      confirmStoryId: args.confirmStoryId,
      confirmManifestSha256: args.confirmManifestSha256,
      plan,
      env: deps.env || process.env,
    });
    if (!authority.authorised) {
      result = resultSummary({
        plan,
        written,
        mode: "APPLY",
        verdict: "HOLD",
        blockers: authority.blockers,
      });
    } else {
      const materialize = deps.materializeOwnedMotion || materializeOwnedMotion;
      const materialized = await materialize({
        intake: validation.manifest,
        plan,
        authority,
        generatedAt: args.generatedAt,
        renderStill: deps.renderStill,
        renderVideo: deps.renderVideo,
        inspectAsset: deps.inspectAsset,
      });
      result = resultSummary({
        plan,
        written,
        mode: "APPLY",
        verdict: "MATERIALIZED_HUMAN_REVIEW",
        materialized,
      });
    }
  }
  stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  main()
    .then((result) => {
      if (result?.verdict === "HOLD") process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(
        `[governed-owned-motion] ${error.stack || error.message}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  RESULT_SCHEMA,
  main,
  parseArgs,
  resultSummary,
  usage,
};
