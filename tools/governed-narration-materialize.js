#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const {
  buildGovernedNarrationPlan,
  materializeGovernedNarration,
  validateApplyAuthority,
  writeGovernedNarrationPlan,
} = require("../lib/services/governed-narration-materialize");

const RESULT_SCHEMA = "pulse-governed-narration-result-v1";

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyId: null,
    script: null,
    scriptFile: null,
    scriptSha256: null,
    audioPath: null,
    audioSha256: null,
    alignmentPath: null,
    alignmentSha256: null,
    outputDir: null,
    finalTargetSeconds: null,
    visualBreathAllowanceSeconds: null,
    expectedProvider: null,
    expectedVoiceId: null,
    expectedModelId: null,
    expectedSpeed: null,
    licenceEvidenceReference: null,
    licenceAttestedBy: null,
    licenceAttestedAt: null,
    generatedAt: new Date().toISOString(),
    applyRequested: false,
    confirmStoryId: null,
    confirmScriptSha256: null,
    confirmAudioSha256: null,
    confirmAlignmentSha256: null,
    confirmPlanSha256: null,
    help: false,
  };

  const mappings = {
    "--story-id": "storyId",
    "--script": "script",
    "--script-file": "scriptFile",
    "--script-sha256": "scriptSha256",
    "--audio": "audioPath",
    "--audio-sha256": "audioSha256",
    "--alignment": "alignmentPath",
    "--alignment-sha256": "alignmentSha256",
    "--out-dir": "outputDir",
    "--final-target-seconds": "finalTargetSeconds",
    "--visual-breath-seconds": "visualBreathAllowanceSeconds",
    "--provider": "expectedProvider",
    "--voice-id": "expectedVoiceId",
    "--model-id": "expectedModelId",
    "--speed": "expectedSpeed",
    "--licence-evidence-ref": "licenceEvidenceReference",
    "--licence-attested-by": "licenceAttestedBy",
    "--licence-attested-at": "licenceAttestedAt",
    "--generated-at": "generatedAt",
    "--confirm-story-id": "confirmStoryId",
    "--confirm-script-sha256": "confirmScriptSha256",
    "--confirm-audio-sha256": "confirmAudioSha256",
    "--confirm-alignment-sha256": "confirmAlignmentSha256",
    "--confirm-plan-sha256": "confirmPlanSha256",
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
    const mapped = mappings[argument];
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
    "Usage: node tools/governed-narration-materialize.js [options]",
    "",
    "Required:",
    "  --story-id <id>                  Exact governed story ID",
    "  --script <text>                   Exact script text",
    "    or --script-file <path>         Local file containing exact script text",
    "  --script-sha256 <hash>            Exact normalised script SHA-256",
    "  --audio <path>                    Existing local MP3",
    "  --audio-sha256 <hash>             Exact source MP3 SHA-256",
    "  --alignment <path>                Raw with-timestamps alignment JSON",
    "  --alignment-sha256 <hash>         Exact alignment JSON SHA-256",
    "  --out-dir <path>                  Explicit local proof output directory",
    "  --final-target-seconds <25..32>   Intended final video duration",
    "  --visual-breath-seconds <number>  Declared non-narrated visual allowance",
    "  --provider elevenlabs             Expected provider attestation",
    "  --voice-id <id>                   Expected voice ID",
    "  --model-id <id>                   Expected model ID",
    "  --speed <0.7..1.2>                Expected generation speed",
    "  --licence-evidence-ref <ref>      Non-secret licence evidence reference",
    "  --licence-attested-by <operator>  Attesting operator identity",
    "  --licence-attested-at <iso>       Attestation timestamp",
    "",
    "Apply-only:",
    "  --apply                           Materialise governed local evidence",
    "  --confirm-story-id <id>           Exact story confirmation",
    "  --confirm-script-sha256 <hash>    Exact script confirmation",
    "  --confirm-audio-sha256 <hash>     Exact audio confirmation",
    "  --confirm-alignment-sha256 <hash> Exact alignment confirmation",
    "  --confirm-plan-sha256 <hash>      Exact dry-run plan confirmation",
    "",
    "Optional:",
    "  --generated-at <iso>              Fixed proof timestamp",
    "",
    "Dry-run is the default. This command only reads local script, MP3 and",
    "alignment inputs, runs ffprobe and writes local proof evidence. It never",
    "generates speech, calls external services, mutates a database or publishes.",
  ].join("\n");
}

function required(value, code) {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(code);
  }
  return value;
}

function resolveScriptText(args) {
  if (args.script && args.scriptFile) {
    throw new Error("script_and_script_file_are_mutually_exclusive");
  }
  if (args.script) return args.script;
  if (!args.scriptFile) throw new Error("script_or_script_file_required");
  if (
    !fs.existsSync(args.scriptFile) ||
    !fs.statSync(args.scriptFile).isFile()
  ) {
    throw new Error("script_file_not_found");
  }
  return fs.readFileSync(args.scriptFile, "utf8");
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
    script_sha256: plan.script.sha256,
    audio_sha256: plan.sources.audio.expected_sha256,
    alignment_sha256: plan.sources.alignment.expected_sha256,
    plan_sha256: plan.plan_sha256,
    word_count: plan.script.word_count,
    audio_duration_seconds: plan.timing.audio_duration_seconds,
    plan_path: written.plan_path,
    markdown_path: written.markdown_path,
    timestamps_path: materialized?.timestamps_path || null,
    timestamps_sha256: materialized?.timestamps_sha256 || null,
    manifest_path: materialized?.manifest_path || null,
    manifest_sha256: materialized?.manifest_sha256 || null,
    manifest_markdown_path: materialized?.markdown_path || null,
    blockers: [...new Set(blockers)],
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

  required(args.storyId, "story_id_required");
  required(args.scriptSha256, "script_sha256_required");
  required(args.audioPath, "audio_path_required");
  required(args.audioSha256, "audio_sha256_required");
  required(args.alignmentPath, "alignment_path_required");
  required(args.alignmentSha256, "alignment_sha256_required");
  required(args.outputDir, "explicit_output_dir_required");
  required(args.finalTargetSeconds, "final_target_seconds_required");
  required(
    args.visualBreathAllowanceSeconds,
    "visual_breath_seconds_required",
  );
  required(args.expectedProvider, "expected_provider_required");
  required(args.expectedVoiceId, "expected_voice_id_required");
  required(args.expectedModelId, "expected_model_id_required");
  required(args.expectedSpeed, "expected_speed_required");
  required(
    args.licenceEvidenceReference,
    "licence_evidence_reference_required",
  );
  required(args.licenceAttestedBy, "licence_attested_by_required");
  required(args.licenceAttestedAt, "licence_attested_at_required");

  const scriptText = resolveScriptText(args);
  const buildPlan =
    deps.buildGovernedNarrationPlan || buildGovernedNarrationPlan;
  const plan = await buildPlan({
    storyId: args.storyId,
    scriptText,
    scriptSha256: args.scriptSha256,
    audioPath: args.audioPath,
    audioSha256: args.audioSha256,
    alignmentPath: args.alignmentPath,
    alignmentSha256: args.alignmentSha256,
    outputDir: args.outputDir,
    generatedAt: args.generatedAt,
    finalTargetSeconds: args.finalTargetSeconds,
    visualBreathAllowanceSeconds: args.visualBreathAllowanceSeconds,
    expectedProvider: args.expectedProvider,
    expectedVoiceId: args.expectedVoiceId,
    expectedModelId: args.expectedModelId,
    expectedSpeed: args.expectedSpeed,
    licenceEvidenceReference: args.licenceEvidenceReference,
    licenceAttestedBy: args.licenceAttestedBy,
    licenceAttestedAt: args.licenceAttestedAt,
    probeAudio: deps.probeAudio,
    ffprobePath: deps.ffprobePath,
    probeTimeoutMs: deps.probeTimeoutMs,
  });
  const writePlan =
    deps.writeGovernedNarrationPlan || writeGovernedNarrationPlan;
  const written = await writePlan(plan);

  let result;
  if (!args.applyRequested) {
    result = resultSummary({
      plan,
      written,
      mode: "DRY_RUN",
      verdict: "READY",
    });
  } else {
    const authority = validateApplyAuthority({
      applyRequested: true,
      confirmStoryId: args.confirmStoryId,
      confirmScriptSha256: args.confirmScriptSha256,
      confirmAudioSha256: args.confirmAudioSha256,
      confirmAlignmentSha256: args.confirmAlignmentSha256,
      confirmPlanSha256: args.confirmPlanSha256,
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
      const materialize =
        deps.materializeGovernedNarration ||
        materializeGovernedNarration;
      const materialized = await materialize({
        plan,
        authority,
        beforeCommit: deps.beforeCommit,
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
        `[governed-narration-materialize] ${error.stack || error.message}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  RESULT_SCHEMA,
  main,
  parseArgs,
  resolveScriptText,
  resultSummary,
  usage,
};
