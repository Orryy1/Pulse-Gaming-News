"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildLongformCandidateIntake,
  hydrateCandidateFromProof,
} = require("../lib/ops/longform-candidate-intake");
const {
  buildPulseReleaseRadarPack,
  renderPulseReleaseRadarMarkdown,
} = require("../lib/formats/pulse-release-radar");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, "output", "longform-candidate-intake");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: null,
    inputs: [],
    outputDir: DEFAULT_OUTPUT_DIR,
    targetMonth: null,
    now: new Date().toISOString(),
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--input") {
      const inputPath = path.resolve(argv[++index]);
      args.inputs.push(inputPath);
      if (!args.input) args.input = inputPath;
    }
    else if (arg === "--output-dir") args.outputDir = path.resolve(argv[++index]);
    else if (arg === "--target-month") args.targetMonth = argv[++index];
    else if (arg === "--now") args.now = argv[++index];
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function collectNamedFiles(directory, fileName, found = []) {
  if (!(await fs.pathExists(directory))) return found;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectNamedFiles(entryPath, fileName, found);
    else if (entry.name === fileName) {
      const stat = await fs.stat(entryPath);
      found.push({ path: entryPath, mtimeMs: stat.mtimeMs });
    }
  }
  return found;
}

async function latestCandidateQueue() {
  const files = await collectNamedFiles(
    path.join(ROOT, "output", "candidate-supply"),
    "fresh_candidate_queue.json",
  );
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files[0]?.path || null;
}

function candidatesFrom(value) {
  if (Array.isArray(value)) return value;
  return value.candidates || value.items || value.queue || value.bridge_candidates || [];
}

function monthLabel(monthKey) {
  const match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return monthKey || "Target Month";
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${monthKey}-01T00:00:00.000Z`));
}

function renderMarkdown(report, inputPath) {
  const inputLabel = Array.isArray(inputPath) ? inputPath.join(", ") : inputPath;
  const lines = [
    "# Long-form Candidate Intake",
    "",
    `Generated: ${report.generated_at}`,
    `Input: ${inputLabel || "none"}`,
    `Verdict: ${report.verdict}`,
    `Target month: ${report.target_month}`,
    "",
    "## Counts",
    "",
    `- Input: ${report.totals.input}`,
    `- Deduplicated: ${report.totals.deduplicated}`,
    `- Weekly-ready: ${report.totals.weekly_ready}/${report.weekly.minimum_candidates}`,
    `- Release-radar-ready: ${report.totals.release_radar_ready}/${report.release_radar.minimum_candidates}`,
    `- Blocked: ${report.totals.blocked}`,
    "",
    "## Weekly candidates",
    "",
    ...(report.weekly.candidates.length
      ? report.weekly.candidates.map(
          (candidate) => `- ${candidate.title} (${candidate.source_age_hours}h old)`,
        )
      : ["- none"]),
    "",
    "## Release-radar candidates",
    "",
    ...(report.release_radar.candidates.length
      ? report.release_radar.candidates.map(
          (candidate) => `- ${candidate.title} (${candidate.release_date})`,
        )
      : ["- none"]),
    "",
    "## Blocked work",
    "",
    ...(report.blocked.length
      ? report.blocked.map(
          (candidate) =>
            `- ${candidate.title || candidate.id}: weekly [${candidate.weekly_blockers.join(", ")}]; release radar [${candidate.release_radar_blockers.join(", ")}]`,
        )
      : ["- none"]),
    "",
    "## Safety",
    "",
    "- Read-only candidate and proof-artifact inspection",
    "- No upload",
    "- No production DB mutation",
    "- No OAuth, token or platform mutation",
  ];
  return `${lines.join("\n")}\n`;
}

function buildWeeklyWorkOrder(report) {
  return {
    schema_version: 1,
    generated_at: report.generated_at,
    status: report.weekly.candidates.length >= report.weekly.minimum_candidates ? "ready" : "blocked",
    required_candidate_count: report.weekly.minimum_candidates,
    current_candidate_count: report.weekly.candidates.length,
    candidates: report.weekly.candidates.map((candidate, index) => ({
      order: index + 1,
      story_id: candidate.id,
      title: candidate.title,
      source_url: candidate.source_manifest[0]?.url || null,
      source_published_at: candidate.source_published_at,
      motion_url: candidate.official_motion.trailer_url,
      required_next_steps: [
        "write_original_longform_segment",
        "build_chapter_motion_plan",
        "record_fresh_narration_and_timestamps",
        "render_and_run_full_forensic_qa",
      ],
    })),
    blockers:
      report.weekly.candidates.length >= report.weekly.minimum_candidates
        ? []
        : ["insufficient_fresh_governed_weekly_candidates"],
  };
}

async function runLongformCandidateIntake(options = {}) {
  const explicitInputs = Array.isArray(options.inputs) && options.inputs.length
    ? options.inputs
    : options.input
      ? [options.input]
      : [];
  const inputPaths = explicitInputs.length
    ? explicitInputs
    : [(await latestCandidateQueue())].filter(Boolean);
  const rawCandidates = [];
  for (const inputPath of inputPaths) {
    if (!(await fs.pathExists(inputPath))) continue;
    rawCandidates.push(...candidatesFrom(await fs.readJson(inputPath)));
  }
  const hydrated = await Promise.all(rawCandidates.map(hydrateCandidateFromProof));
  const report = buildLongformCandidateIntake({
    candidates: hydrated,
    now: options.now,
    targetMonth: options.targetMonth,
  });
  const releaseRadar = buildPulseReleaseRadarPack({
    monthLabel: monthLabel(report.target_month),
    candidates: report.evaluated_candidates,
    affiliateTag: process.env.AMAZON_AFFILIATE_TAG || "",
  });
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR;
  await fs.ensureDir(outputDir);
  const outputs = {
    report_json: path.join(outputDir, "longform_candidate_intake_report.json"),
    report_markdown: path.join(outputDir, "longform_candidate_intake_report.md"),
    weekly_queue: path.join(outputDir, "weekly_candidate_queue.json"),
    weekly_work_order: path.join(outputDir, "weekly_longform_work_order.json"),
    release_radar_candidates: path.join(outputDir, "release_radar_candidates.json"),
    release_radar_package: path.join(outputDir, "release_radar_package.json"),
    release_radar_markdown: path.join(outputDir, "release_radar_package.md"),
    blocked: path.join(outputDir, "blocked_longform_candidates.json"),
  };
  await fs.writeJson(
    outputs.report_json,
    { ...report, input_path: inputPaths[0] || null, input_paths: inputPaths },
    { spaces: 2 },
  );
  await fs.writeFile(outputs.report_markdown, renderMarkdown(report, inputPaths));
  await fs.writeJson(outputs.weekly_queue, report.weekly, { spaces: 2 });
  await fs.writeJson(outputs.weekly_work_order, buildWeeklyWorkOrder(report), { spaces: 2 });
  await fs.writeJson(
    outputs.release_radar_candidates,
    {
      ...report.release_radar,
      target_month: report.target_month,
      month_label: monthLabel(report.target_month),
    },
    { spaces: 2 },
  );
  await fs.writeJson(outputs.release_radar_package, releaseRadar, { spaces: 2 });
  await fs.writeFile(outputs.release_radar_markdown, renderPulseReleaseRadarMarkdown(releaseRadar));
  await fs.writeJson(outputs.blocked, report.blocked, { spaces: 2 });
  return { report, releaseRadar, inputPath: inputPaths[0] || null, inputPaths, outputs };
}

async function main() {
  const args = parseArgs();
  const result = await runLongformCandidateIntake(args);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(renderMarkdown(result.report, result.inputPaths));
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[longform-candidate-intake] ${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildWeeklyWorkOrder,
  candidatesFrom,
  latestCandidateQueue,
  parseArgs,
  renderMarkdown,
  runLongformCandidateIntake,
};
