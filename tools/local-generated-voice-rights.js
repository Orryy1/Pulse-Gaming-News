#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  materializeGeneratedVoiceReviewPacket,
} = require("../lib/local-generated-voice-rights");

const DEFAULT_MODEL_REVISION = "bffb3df5a29440629464e5e839f4d214c8714c3d";

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

async function main() {
  const root = process.cwd();
  const auditionDir = path.join(
    root,
    "test",
    "output",
    "local-tts-voice-audition-v2",
  );
  const result = await materializeGeneratedVoiceReviewPacket({
    referencePath: argValue(
      "--reference",
      path.join(auditionDir, "no_ref_default.wav"),
    ),
    legacyAuditionReportPath: argValue(
      "--report",
      path.join(auditionDir, "voice_audition_report.json"),
    ),
    generatorScriptPath: argValue(
      "--generator",
      path.join(root, "tools", "local_tts_voice_audition.py"),
    ),
    outDir: argValue(
      "--out-dir",
      path.join(root, "output", "cadence-recovery", "generated-voice-review"),
    ),
    modelRevision: argValue("--model-revision", DEFAULT_MODEL_REVISION),
    generatedAt: new Date().toISOString(),
  });
  const summary = {
    verdict: result.review.verdict,
    blockers: result.review.blockers,
    reference_sha256: result.review.reference.sha256,
    reference_size_bytes: result.review.reference.size_bytes,
    evidence_json: result.paths.evidence_json,
    review_json: result.paths.review_json,
    review_markdown: result.paths.review_markdown,
    live_configuration_changed: false,
    publish_authority_changed: false,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = result.review.verdict === "GREEN" ? 0 : 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { main };
