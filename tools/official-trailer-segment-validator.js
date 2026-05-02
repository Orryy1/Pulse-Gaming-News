#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true });
} catch {}

const {
  buildOfficialTrailerClipsFromFrameReport,
} = require("../lib/studio/v2/official-trailer-clip-refs");
const {
  DEFAULT_OUTPUT_ROOT,
  renderOfficialTrailerSegmentValidationMarkdown,
  runOfficialTrailerSegmentValidation,
} = require("../lib/studio/v2/official-trailer-segment-validator");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FRAME_REPORT = path.join(OUT, "controlled_frame_extraction_worker_v1.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    frameReport: DEFAULT_FRAME_REPORT,
    dryRun: true,
    applyLocal: false,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    maxSegments: 6,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--frame-report") args.frameReport = argv[++i] || DEFAULT_FRAME_REPORT;
    else if (arg === "--dry-run") {
      args.dryRun = true;
      args.applyLocal = false;
    } else if (arg === "--apply-local") {
      args.dryRun = false;
      args.applyLocal = true;
    } else if (arg === "--output-root") {
      args.outputRoot = argv[++i] || DEFAULT_OUTPUT_ROOT;
    } else if (arg === "--max-segments") {
      args.maxSegments = Math.max(1, Number(argv[++i]) || 6);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/official-trailer-segment-validator.js [options]",
      "",
      "Options:",
      "  --frame-report <p>     Read a controlled frame extraction worker report",
      "  --story-id <id>        Validate one story from the report",
      "  --dry-run              Default. No writes and no source fetches",
      "  --apply-local          Sample trailer segment frames to test/output only",
      "  --output-root <path>   Apply-local output root, must be under test/output",
      "  --max-segments <n>     Cap segment validations",
      "  --json                 Print JSON instead of Markdown",
      "",
      "This command is local-only. It validates proposed official trailer clip windows before they can be used by Flash Lane.",
    ].join("\n") + "\n",
  );
}

async function loadFrameReport(args) {
  const filePath = path.resolve(ROOT, args.frameReport);
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`frame report not found: ${filePath}`);
  }
  const report = await fs.readJson(filePath);
  return { report, filePath };
}

function buildClipRefsFromReport(frameReport, storyId) {
  const storyIds = storyId
    ? [storyId]
    : [
        ...new Set(
          (Array.isArray(frameReport?.plans) ? frameReport.plans : [])
            .map((plan) => plan.story_id)
            .filter(Boolean),
        ),
      ];
  return storyIds.flatMap((id) =>
    buildOfficialTrailerClipsFromFrameReport(frameReport, id).map((clip) => ({
      ...clip,
      story_id: id,
      storyId: id,
      provenance: {
        ...(clip.provenance || {}),
        story_id: id,
      },
    })),
  );
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.applyLocal && process.env.RAILWAY_ENVIRONMENT) {
    throw new Error("apply-local segment validation is disabled in Railway environments");
  }

  const loaded = await loadFrameReport(args);
  const clipRefs = buildClipRefsFromReport(loaded.report, args.storyId);
  const report = await runOfficialTrailerSegmentValidation(clipRefs, {
    applyLocal: args.applyLocal,
    outputRoot: args.outputRoot,
    maxSegments: args.maxSegments,
  });
  report.frame_report_source = loaded.filePath;
  report.clip_refs_input_count = clipRefs.length;

  const markdown = renderOfficialTrailerSegmentValidationMarkdown(report);
  await fs.ensureDir(OUT);
  const stem = args.applyLocal
    ? "official_trailer_segment_validation_apply_local"
    : "official_trailer_segment_validation_dry_run";
  await fs.writeJson(path.join(OUT, `${stem}.json`), report, { spaces: 2 });
  await fs.writeFile(path.join(OUT, `${stem}.md`), markdown, "utf8");
  await fs.writeJson(path.join(OUT, "official_trailer_segment_validation_v1.json"), report, {
    spaces: 2,
  });
  await fs.writeFile(path.join(OUT, "official_trailer_segment_validation_v1.md"), markdown, "utf8");

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(`[segment-validator] wrote test/output/${stem}.{json,md}\n`);
}

main().catch((err) => {
  process.stderr.write(`[segment-validator] ${err.stack || err.message}\n`);
  process.exit(1);
});
