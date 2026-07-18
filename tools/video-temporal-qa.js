#!/usr/bin/env node

const crypto = require("node:crypto");
const fsNative = require("node:fs");
const path = require("node:path");
const fs = require("fs-extra");
const {
  reconcileTemporalRepeatScopes,
  runVideoQa,
  validateTemporalVideoQaReport,
} = require("../lib/services/video-qa");

function parseFinite(value, flag) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${flag} requires a finite number`);
  return number;
}

function parseArgs(argv = process.argv) {
  const args = {
    mp4Path: "",
    storyId: "",
    outDir: "",
    minDuration: null,
    maxDuration: null,
    temporalSampleFps: null,
    json: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mp4") args.mp4Path = argv[++index] || "";
    else if (arg.startsWith("--mp4=")) args.mp4Path = arg.slice("--mp4=".length);
    else if (arg === "--story-id") args.storyId = argv[++index] || "";
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--out-dir") args.outDir = argv[++index] || "";
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice("--out-dir=".length);
    else if (arg === "--min-duration") {
      args.minDuration = parseFinite(argv[++index], "--min-duration");
    } else if (arg.startsWith("--min-duration=")) {
      args.minDuration = parseFinite(arg.slice("--min-duration=".length), "--min-duration");
    } else if (arg === "--max-duration") {
      args.maxDuration = parseFinite(argv[++index], "--max-duration");
    } else if (arg.startsWith("--max-duration=")) {
      args.maxDuration = parseFinite(arg.slice("--max-duration=".length), "--max-duration");
    } else if (arg === "--temporal-sample-fps") {
      args.temporalSampleFps = parseFinite(argv[++index], "--temporal-sample-fps");
    } else if (arg.startsWith("--temporal-sample-fps=")) {
      args.temporalSampleFps = parseFinite(
        arg.slice("--temporal-sample-fps=".length),
        "--temporal-sample-fps",
      );
    } else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !String(args.mp4Path || "").trim()) {
    throw new Error("--mp4 is required");
  }
  return args;
}

async function sha256File(filePath, deps = {}) {
  const createReadStream = deps.createReadStream || fsNative.createReadStream;
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function reconcileVerdict(qa = {}) {
  const blockers = Array.isArray(qa.failures) ? [...qa.failures] : [];
  const warnings = Array.isArray(qa.warnings) ? [...qa.warnings] : [];
  const decode = qa.evidence?.decode || {};
  const temporal = qa.evidence?.temporal || {};

  if (decode.complete !== true) blockers.push("full_audio_video_decode_not_proven");
  if (decode.video_stream !== true) blockers.push("decoded_video_stream_not_proven");
  if (decode.audio_stream !== true) blockers.push("decoded_audio_stream_not_proven");
  if (temporal.scan_complete !== true) blockers.push("temporal_scan_incomplete");
  const repeatReconciliation = reconcileTemporalRepeatScopes(temporal);
  if (!Array.isArray(temporal.repeated_motion_sequences)) {
    blockers.push("repeated_motion_evidence_missing");
  } else if (repeatReconciliation.blocking_full_frame_repeat) {
    blockers.push("repeated_motion_sequences_detected");
  }
  if (repeatReconciliation.center_crop_repeat_detected) {
    blockers.push("repeated_motion_sequences_detected_center_crop");
  }
  if (temporal.cadence?.choppy !== false) blockers.push("clean_temporal_cadence_not_proven");

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  const verdict =
    uniqueBlockers.length > 0 || qa.result === "fail"
      ? "RED"
      : uniqueWarnings.length > 0 || qa.result === "warn" || qa.result === "skip"
        ? "AMBER"
        : qa.result === "pass"
          ? "GREEN"
          : "RED";
  return {
    verdict,
    canPublish: verdict === "GREEN",
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
  };
}

function formatMarkdown(report = {}) {
  const temporal = report.evidence?.temporal || {};
  const cadence = temporal.cadence || {};
  return [
    "# Temporal Video QA",
    "",
    `- Story: ${report.story_id || "unknown"}`,
    `- Verdict: ${report.verdict}`,
    `- Final MP4: ${report.final_media?.path || "missing"}`,
    `- SHA-256: ${report.final_media?.sha256 || "missing"}`,
    `- Size: ${report.final_media?.size_bytes ?? "unknown"} bytes`,
    `- Full audio/video decode: ${report.evidence?.decode?.complete === true ? "PASS" : "FAIL"}`,
    `- Temporal coverage: ${temporal.coverage_ratio ?? 0}`,
    `- Repeated motion sequences: ${temporal.repeated_motion_sequences?.length ?? "missing"}`,
    `- Choppy cadence: ${cadence.choppy === true ? "YES" : cadence.choppy === false ? "NO" : "UNKNOWN"}`,
    `- Blockers: ${report.blockers?.length ? report.blockers.join(", ") : "none"}`,
    `- Warnings: ${report.warnings?.length ? report.warnings.join(", ") : "none"}`,
    "",
    "This report is local QA evidence only. It does not authorise or perform publishing.",
    "",
  ].join("\n");
}

async function runCli(argv = process.argv, deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  const fsApi = deps.fs || fs;
  const runQa = deps.runVideoQa || runVideoQa;
  const generatedAt = deps.generatedAt || new Date().toISOString();

  if (args.help) {
    stdout.write(
      "Usage: node tools/video-temporal-qa.js --mp4 PATH [--story-id ID] [--out-dir DIR] [--min-duration N] [--max-duration N] [--temporal-sample-fps N] [--json]\n",
    );
    return { exitCode: 0, report: null };
  }

  const mp4Path = path.resolve(args.mp4Path);
  const exists = await fsApi.pathExists(mp4Path);
  if (!exists) throw new Error(`MP4 not found: ${mp4Path}`);
  const stat = await fsApi.stat(mp4Path);
  const sha256 = await sha256File(mp4Path, deps);
  const outDir = path.resolve(
    args.outDir || path.join(path.dirname(mp4Path), "qa", "temporal-video"),
  );

  const qa = await runQa(mp4Path, {
    requireDecodeScan: true,
    requireTemporalScan: true,
    ...(args.minDuration == null ? {} : { minDuration: args.minDuration }),
    ...(args.maxDuration == null ? {} : { maxDuration: args.maxDuration }),
    ...(args.temporalSampleFps == null
      ? {}
      : { temporalSampleFps: args.temporalSampleFps }),
  });
  const reconciliation = reconcileVerdict(qa);
  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_TEMPORAL_VIDEO_QA",
    story_id: String(args.storyId || path.basename(mp4Path, path.extname(mp4Path))),
    verdict: reconciliation.verdict,
    can_publish: reconciliation.canPublish,
    blockers: reconciliation.blockers,
    warnings: reconciliation.warnings,
    final_media: {
      path: mp4Path,
      size_bytes: stat.size,
      sha256,
    },
    evidence: qa.evidence || {},
    source_result: {
      result: qa.result || "unknown",
      failures: Array.isArray(qa.failures) ? qa.failures : [],
      warnings: Array.isArray(qa.warnings) ? qa.warnings : [],
    },
    safety: {
      local_qa_only: true,
      no_publish_triggered: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
  const validation = validateTemporalVideoQaReport(report, {
    storyId: report.story_id,
    renderSha256: sha256,
    renderSizeBytes: stat.size,
  });
  report.verdict = validation.verdict;
  report.can_publish = validation.valid === true;
  report.blockers = validation.blockers;
  report.warnings = validation.warnings;
  report.validation = validation.evidence;

  await fsApi.ensureDir(outDir);
  const jsonPath = path.join(outDir, "temporal_video_qa_report.json");
  const markdownPath = path.join(outDir, "temporal_video_qa_report.md");
  await fsApi.writeJson(jsonPath, report, { spaces: 2 });
  await fsApi.writeFile(markdownPath, formatMarkdown(report), "utf8");

  if (args.json) stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else stdout.write(formatMarkdown(report));
  return {
    exitCode: report.verdict === "GREEN" ? 0 : 2,
    report,
    jsonPath,
    markdownPath,
  };
}

if (require.main === module) {
  runCli()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`[video-temporal-qa] ${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  formatMarkdown,
  parseArgs,
  reconcileVerdict,
  runCli,
  sha256File,
};
