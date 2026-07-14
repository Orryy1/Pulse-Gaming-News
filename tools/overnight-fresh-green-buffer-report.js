#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildOvernightFreshGreenBufferReports,
  formatOvernightFreshGreenBufferMarkdown,
} = require("../lib/ops/overnight-fresh-green-buffer-report");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "overnight-fresh-green-buffer", "current-20260713");

function parseArgs(argv) {
  const args = { outDir: DEFAULT_OUT, json: false, help: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++index]);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
  }
  return args;
}

async function readJson(filePath, fallback = {}) {
  return fs.pathExists(filePath) ? fs.readJson(filePath) : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pass(value) {
  return ["pass", "passed", "green", "ok", "ready", "viral_ready", "post_render_forensics_passed"]
    .includes(clean(value).toLowerCase());
}

async function buildPackageEvidence(candidate = {}) {
  const storyId = clean(candidate.id || candidate.story_id);
  const renderPath = candidate.source?.exported_path || candidate.exported_path;
  const artifactDir = renderPath ? path.dirname(path.resolve(renderPath)) : null;
  if (!artifactDir || !(await fs.pathExists(artifactDir))) {
    return {
      story_id: storyId,
      artifact_dir: artifactDir,
      coherence_verdict: "fail",
      transcript_blockers: ["package_artifact_dir_missing"],
      visual_verdict: "fail",
      visual_blockers: ["package_artifact_dir_missing"],
      tts_caption_verdict: "fail",
      tts_caption_blockers: ["package_artifact_dir_missing"],
    };
  }

  const [coherence, script, forensic, visual, audio, captions] = await Promise.all([
    readJson(path.join(artifactDir, "coherence_report.json")),
    readJson(path.join(artifactDir, "script_scorecard.json")),
    readJson(path.join(artifactDir, "forensic_qa_report.json")),
    readJson(path.join(artifactDir, "visual_quality_report.json")),
    readJson(path.join(artifactDir, "audio_manifest.json")),
    readJson(path.join(artifactDir, "caption_manifest.json")),
  ]);

  const transcriptBlockers = [
    ...asArray(coherence.failures),
    ...asArray(coherence.blockers),
    ...asArray(script.blockers),
  ].map((item) => clean(item.code || item.reason || item)).filter(Boolean);
  const visualBlockers = [
    ...asArray(forensic.blockers),
    ...asArray(forensic.failures),
    ...asArray(visual.blockers),
    ...asArray(visual.failures),
  ].map((item) => clean(item.code || item.reason || item)).filter(Boolean);

  const alignment = audio.timestamp_whisper_alignment || {};
  const expectedWords = Number(alignment.script_expected_word_count);
  const actualWords = Number(alignment.script_actual_word_count);
  const insertedWords = Number(alignment.script_inserted_actual_word_count);
  const trailingWords = Number(alignment.script_trailing_actual_word_count);
  const captionWords = Number(captions.word_count);
  const timestampWords = Number(audio.word_timestamp_count);
  const strictWhisper = audio.word_timestamp_provenance?.strict_whisper_aligned === true;
  const ttsCaptionBlockers = [];
  if (!pass(audio.voice_status === "materialized" ? "pass" : audio.voice_status)) ttsCaptionBlockers.push("narration_not_materialized");
  if (!strictWhisper) ttsCaptionBlockers.push("strict_whisper_alignment_missing");
  if (!Number.isFinite(insertedWords) || insertedWords !== 0) ttsCaptionBlockers.push("asr_inserted_words_nonzero_or_unknown");
  if (!Number.isFinite(trailingWords) || trailingWords !== 0) ttsCaptionBlockers.push("asr_trailing_words_nonzero_or_unknown");
  if (!Number.isFinite(expectedWords) || !Number.isFinite(actualWords) || expectedWords !== actualWords) {
    ttsCaptionBlockers.push("asr_expected_actual_word_mismatch");
  }
  if (!Number.isFinite(captionWords) || !Number.isFinite(timestampWords) || captionWords !== timestampWords) {
    ttsCaptionBlockers.push("caption_timestamp_word_mismatch");
  }

  const coherencePass = pass(coherence.result || coherence.verdict) &&
    pass(script.verdict) && transcriptBlockers.length === 0;
  const visualPass = pass(forensic.result || forensic.verdict) &&
    pass(visual.result || visual.verdict) && visualBlockers.length === 0;

  return {
    story_id: storyId,
    artifact_dir: artifactDir,
    coherence_verdict: coherencePass ? "pass" : "fail",
    transcript_blockers: transcriptBlockers,
    script_verdict: script.verdict || null,
    viral_score: Number.isFinite(Number(script.viral_score)) ? Number(script.viral_score) : null,
    visual_verdict: visualPass ? "pass" : "fail",
    visual_blockers: visualBlockers,
    forensic_verdict: forensic.result || forensic.verdict || null,
    visual_quality_verdict: visual.result || visual.verdict || null,
    tts_caption_verdict: ttsCaptionBlockers.length === 0 ? "pass" : "fail",
    tts_caption_blockers: ttsCaptionBlockers,
    voice_provider: audio.voice_provider || null,
    voice_status: audio.voice_status || null,
    word_timestamp_source: audio.word_timestamp_source || null,
    strict_whisper_aligned: strictWhisper,
    expected_word_count: Number.isFinite(expectedWords) ? expectedWords : null,
    actual_word_count: Number.isFinite(actualWords) ? actualWords : null,
    caption_word_count: Number.isFinite(captionWords) ? captionWords : null,
    asr_inserted_words: Number.isFinite(insertedWords) ? insertedWords : null,
    asr_trailing_words: Number.isFinite(trailingWords) ? trailingWords : null,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    process.stdout.write("Usage: node tools/overnight-fresh-green-buffer-report.js [--out-dir PATH] [--json]\n");
    return;
  }

  const candidateReportPath = path.join(args.outDir, "next_publish_candidates.json");
  const dryRunPath = path.join(args.outDir, "dry_run_publish_plan.json");
  const [candidateReport, dryRunPlan, cutoverPlan, renderHealth, platformStatus, platformDoctor, runtimeSentinel, queueInspect] =
    await Promise.all([
      readJson(candidateReportPath),
      readJson(dryRunPath),
      readJson(path.join(args.outDir, "production_render_cutover_plan.json")),
      readJson(path.join(args.outDir, "render_health_report.json")),
      readJson(path.join(args.outDir, "platform_status_matrix.json")),
      readJson(path.join(ROOT, "test", "output", "platform_readiness_doctor.json")),
      readJson(path.join(ROOT, "output", "runtime-ownership", "runtime_ownership_status.json")),
      readJson(path.join(ROOT, "test", "output", "queue_inspect.json")),
    ]);
  const packageEvidence = await Promise.all(asArray(candidateReport.candidates).map(buildPackageEvidence));
  const reports = buildOvernightFreshGreenBufferReports({
    candidateReport,
    dryRunPlan,
    cutoverPlan,
    renderHealth,
    platformStatus,
    platformDoctor,
    runtimeSentinel,
    queueInspect,
    packageEvidence,
  });

  await fs.ensureDir(args.outDir);
  await Promise.all([
    fs.writeJson(path.join(args.outDir, "overnight_fresh_green_buffer_report.json"), reports.summary, { spaces: 2 }),
    fs.writeFile(path.join(args.outDir, "overnight_fresh_green_buffer_report.md"), formatOvernightFreshGreenBufferMarkdown(reports), "utf8"),
    fs.writeJson(path.join(args.outDir, "fresh_candidate_queue.json"), reports.freshCandidateQueue, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "blocked_candidate_report.json"), reports.blockedCandidateReport, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "stale_source_rejection_report.json"), reports.staleSourceRejectionReport, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "transcript_coherence_report.json"), reports.transcriptCoherenceReport, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "visual_motion_repair_report.json"), reports.visualMotionRepairReport, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "tts_caption_repair_report.json"), reports.ttsCaptionRepairReport, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "strict_dry_run_publish_plan.json"), dryRunPlan, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "scheduler_preflight_report.json"), candidateReport, { spaces: 2 }),
    fs.writeJson(path.join(args.outDir, "platform_status_matrix.json"), platformStatus, { spaces: 2 }),
  ]);

  if (args.json) process.stdout.write(`${JSON.stringify(reports.summary, null, 2)}\n`);
  else process.stdout.write(`${formatOvernightFreshGreenBufferMarkdown(reports)}\n`);
  process.exitCode = reports.summary.verdict === "PASS" ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`[overnight-fresh-green-buffer-report] ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
