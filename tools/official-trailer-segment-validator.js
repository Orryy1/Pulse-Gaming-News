#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

try {
  require("dotenv").config({ override: true });
} catch {}

const {
  buildOfficialTrailerClipsFromAcquisitionPlan,
  buildOfficialTrailerClipsFromFrameReport,
  DEFAULT_EXPLORATORY_START_SECONDS,
} = require("../lib/studio/v2/official-trailer-clip-refs");
const {
  DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD,
  DEFAULT_OUTPUT_ROOT,
  filterExhaustedSourceFamilyClipRefs,
  filterPreviouslySampledClipRefs,
  filterSegmentsForStoryIds,
  mergeOfficialTrailerSegmentReports,
  renderOfficialTrailerSegmentValidationMarkdown,
  runOfficialTrailerSegmentValidation,
} = require("../lib/studio/v2/official-trailer-segment-validator");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_FRAME_REPORT = path.join(OUT, "controlled_frame_extraction_worker_v1.json");
const DEFAULT_REFERENCE_REPORT = path.join(OUT, "official_trailer_references_v1.json");
const DEFAULT_ACQUISITION_PLAN = path.join(OUT, "flash_lane_footage_acquisition_v1.json");

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    frameReport: DEFAULT_FRAME_REPORT,
    referenceReport: DEFAULT_REFERENCE_REPORT,
    acquisitionPlan: null,
    previousValidationReport: null,
    noReferenceReport: false,
    mergePrevious: false,
    dryRun: true,
    applyLocal: false,
    outputRoot: DEFAULT_OUTPUT_ROOT,
    maxSegments: 6,
    candidateWindowsPerSource: 1,
    exhaustedSourceFamilyThreshold: DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD,
    noExhaustedSourceFamilyFilter: false,
    includeFrameAnchoredWindows: false,
    includeExploratoryWindows: false,
    exploratoryStartSeconds: DEFAULT_EXPLORATORY_START_SECONDS,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--frame-report") args.frameReport = argv[++i] || DEFAULT_FRAME_REPORT;
    else if (arg === "--reference-report" || arg === "--trailer-references") {
      args.referenceReport = argv[++i] || DEFAULT_REFERENCE_REPORT;
      args.noReferenceReport = false;
    } else if (arg === "--no-reference-report" || arg === "--no-trailer-references") {
      args.noReferenceReport = true;
    } else if (arg === "--acquisition-plan") {
      args.acquisitionPlan = argv[++i] || DEFAULT_ACQUISITION_PLAN;
    } else if (arg === "--previous-validation-report") {
      args.previousValidationReport = argv[++i] || null;
    } else if (arg === "--merge-previous") {
      args.mergePrevious = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
      args.applyLocal = false;
    } else if (arg === "--apply-local") {
      args.dryRun = false;
      args.applyLocal = true;
    } else if (arg === "--output-root") {
      args.outputRoot = argv[++i] || DEFAULT_OUTPUT_ROOT;
    } else if (arg === "--max-segments") {
      args.maxSegments = Math.max(1, Number(argv[++i]) || 6);
    } else if (arg === "--candidate-windows-per-source") {
      args.candidateWindowsPerSource = Math.max(1, Number(argv[++i]) || 1);
    } else if (arg === "--exhausted-source-family-threshold") {
      args.exhaustedSourceFamilyThreshold = Math.max(
        1,
        Number(argv[++i]) || DEFAULT_EXHAUSTED_SOURCE_FAMILY_THRESHOLD,
      );
    } else if (arg === "--no-exhausted-source-family-filter") {
      args.noExhaustedSourceFamilyFilter = true;
    } else if (arg === "--include-frame-anchored-windows") {
      args.includeFrameAnchoredWindows = true;
    } else if (arg === "--deep-scan" || arg === "--include-exploratory-windows") {
      args.includeExploratoryWindows = true;
    } else if (arg === "--exploratory-starts") {
      args.exploratoryStartSeconds = String(argv[++i] || "")
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item));
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
      "  --reference-report <p> Read official trailer resolver references for alternate source scanning",
      "  --no-reference-report  Ignore test/output/official_trailer_references_v1.json",
      "  --acquisition-plan <p>",
      "                         Use Flash Lane shopping-list windows from test/output/flash_lane_footage_acquisition_v1.json",
      "  --previous-validation-report <p>",
      "                         Skip clip windows already sampled in a previous validation report",
      "  --merge-previous       Merge previous validation segments into the written report",
      "  --story-id <id>        Validate one story from the report",
      "  --dry-run              Default. No writes and no source fetches",
      "  --apply-local          Sample trailer segment frames to test/output only",
      "  --output-root <path>   Apply-local output root, must be under test/output",
      "  --max-segments <n>     Cap segment validations",
      "  --candidate-windows-per-source <n>",
      "                         Validate alternate windows from the same official source",
      "  --exhausted-source-family-threshold <n>",
      "                         Skip a source family after this many failed previous windows",
      "  --no-exhausted-source-family-filter",
      "                         Keep sampling previously exhausted source families",
      "  --include-frame-anchored-windows",
      "                         Also validate windows that start shortly before a safe frame",
      "  --deep-scan            Add uniform exploratory windows from every official source",
      "  --exploratory-starts <csv>",
      "                         Start seconds for --deep-scan, default: 36,42,48,54,60,66",
      "  --json                 Print JSON instead of Markdown",
      "",
      "This command is local-only. It validates proposed official trailer clip windows before they can be used by Flash Lane.",
    ].join("\n") + "\n",
  );
}

function safeReportStemPart(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function reportOutputTargets(args = {}) {
  const modeStem = args.applyLocal ? "apply_local" : "dry_run";
  const targets = [
    `official_trailer_segment_validation_${modeStem}`,
    "official_trailer_segment_validation_v1",
  ];
  const safeStoryId = safeReportStemPart(args.storyId);
  if (safeStoryId) {
    targets.push(`official_trailer_segment_validation_story_${safeStoryId}_${modeStem}`);
  }
  return [...new Set(targets)].map((stem) => ({
    stem,
    json: path.join(OUT, `${stem}.json`),
    md: path.join(OUT, `${stem}.md`),
  }));
}

async function loadFrameReport(args) {
  const filePath = path.resolve(ROOT, args.frameReport);
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`frame report not found: ${filePath}`);
  }
  const report = await fs.readJson(filePath);
  return { report, filePath };
}

async function loadOptionalReferenceReport(args) {
  if (args.noReferenceReport) return { report: null, filePath: null };
  const filePath = path.resolve(ROOT, args.referenceReport || DEFAULT_REFERENCE_REPORT);
  if (!(await fs.pathExists(filePath))) return { report: null, filePath: null };
  const report = await fs.readJson(filePath);
  return { report, filePath };
}

async function loadOptionalPreviousValidationReport(args) {
  if (!args.previousValidationReport) return { report: null, filePath: null };
  const filePath = path.resolve(ROOT, args.previousValidationReport);
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`previous validation report not found: ${filePath}`);
  }
  const report = await fs.readJson(filePath);
  return { report, filePath };
}

async function loadOptionalAcquisitionPlan(args) {
  if (!args.acquisitionPlan) return { report: null, filePath: null };
  const filePath = path.resolve(ROOT, args.acquisitionPlan);
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`acquisition plan not found: ${filePath}`);
  }
  const report = await fs.readJson(filePath);
  return { report, filePath };
}

function buildClipRefsFromReport(frameReport, referenceReport, storyId, args = {}) {
  const referenceStoryIds = [
    ...new Set(
      (Array.isArray(referenceReport?.plans) ? referenceReport.plans : [])
        .map((plan) => plan.story_id)
        .filter(Boolean),
    ),
  ];
  const storyIds = storyId
    ? [storyId]
    : referenceStoryIds.length
      ? referenceStoryIds
    : [
        ...new Set(
          (Array.isArray(frameReport?.plans) ? frameReport.plans : [])
            .map((plan) => plan.story_id)
            .filter(Boolean),
        ),
      ];
  return storyIds.flatMap((id) =>
    buildOfficialTrailerClipsFromFrameReport(frameReport, id, {
      maxCandidateWindowsPerSource: args.candidateWindowsPerSource,
      includeFrameAnchoredWindows: args.includeFrameAnchoredWindows,
      maxClips: args.maxSegments,
      includeExploratoryWindows: args.includeExploratoryWindows,
      exploratoryStartSeconds: args.exploratoryStartSeconds,
      referenceReport,
    }).map((clip) => ({
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

function clipRefStoryId(ref = {}) {
  return String(ref.story_id || ref.storyId || ref.provenance?.story_id || "").trim();
}

function balanceClipRefsAcrossStories(clipRefs = []) {
  const groups = new Map();
  const storyOrder = [];
  const unscoped = [];
  for (const ref of Array.isArray(clipRefs) ? clipRefs : []) {
    const storyId = clipRefStoryId(ref);
    if (!storyId) {
      unscoped.push(ref);
      continue;
    }
    if (!groups.has(storyId)) {
      groups.set(storyId, []);
      storyOrder.push(storyId);
    }
    groups.get(storyId).push(ref);
  }
  if (storyOrder.length <= 1) return Array.isArray(clipRefs) ? clipRefs : [];

  const balanced = [];
  let index = 0;
  let madeProgress = true;
  while (madeProgress) {
    madeProgress = false;
    for (const storyId of storyOrder) {
      const refs = groups.get(storyId) || [];
      if (index >= refs.length) continue;
      balanced.push(refs[index]);
      madeProgress = true;
    }
    index++;
  }
  return balanced.concat(unscoped);
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
  const loadedReference = await loadOptionalReferenceReport(args);
  const loadedPrevious = await loadOptionalPreviousValidationReport(args);
  const loadedAcquisition = await loadOptionalAcquisitionPlan(args);
  const scopedPreviousReport = loadedPrevious.report && args.storyId
    ? {
        ...loadedPrevious.report,
        segments: filterSegmentsForStoryIds(loadedPrevious.report.segments, [args.storyId]),
      }
    : loadedPrevious.report;
  const previousSegmentCount = Array.isArray(scopedPreviousReport?.segments)
    ? scopedPreviousReport.segments.length
    : 0;
  const clipRefs = loadedAcquisition.report
    ? buildOfficialTrailerClipsFromAcquisitionPlan(
        loadedAcquisition.report,
        loadedReference.report,
        args.storyId,
      )
    : buildClipRefsFromReport(loaded.report, loadedReference.report, args.storyId, {
        ...args,
        maxSegments: previousSegmentCount > 0 ? args.maxSegments + previousSegmentCount : args.maxSegments,
      });
  const filteredClipRefs = scopedPreviousReport
    ? filterPreviouslySampledClipRefs(clipRefs, scopedPreviousReport)
    : clipRefs;
  const exhaustedFilter =
    scopedPreviousReport && !args.noExhaustedSourceFamilyFilter
      ? filterExhaustedSourceFamilyClipRefs(filteredClipRefs, scopedPreviousReport, {
          threshold: args.exhaustedSourceFamilyThreshold,
        })
      : {
          clipRefs: filteredClipRefs,
          skipped: [],
          exhausted_source_families: [],
        };
  const validationClipRefs = args.storyId
    ? exhaustedFilter.clipRefs
    : balanceClipRefsAcrossStories(exhaustedFilter.clipRefs);
  let report = await runOfficialTrailerSegmentValidation(validationClipRefs, {
    applyLocal: args.applyLocal,
    outputRoot: args.outputRoot,
    maxSegments: args.maxSegments,
  });
  const currentRun = {
    mode: report.mode,
    dry_run: report.dry_run,
    apply_local: report.apply_local,
    will_fetch_source_for_segment_samples: report.will_fetch_source_for_segment_samples,
  };
  report.current_run = currentRun;
  report.frame_report_source = loaded.filePath;
  report.reference_report_source = loadedReference.filePath;
  report.acquisition_plan_source = loadedAcquisition.filePath;
  report.clip_refs_source = loadedAcquisition.report ? "flash_lane_acquisition_plan" : "frame_or_reference_report";
  report.clip_refs_input_count = clipRefs.length;
  report.clip_refs_filtered_previous_count = clipRefs.length - filteredClipRefs.length;
  report.clip_refs_filtered_exhausted_source_family_count = exhaustedFilter.skipped.length;
  report.clip_refs_balanced_for_batch = !args.storyId && validationClipRefs !== exhaustedFilter.clipRefs;
  report.exhausted_source_family_filter = {
    enabled: Boolean(loadedPrevious.report) && !args.noExhaustedSourceFamilyFilter,
    threshold: args.exhaustedSourceFamilyThreshold,
    skipped_clip_refs: exhaustedFilter.skipped,
    exhausted_source_families: exhaustedFilter.exhausted_source_families,
  };
  report.previous_validation_source = loadedPrevious.filePath;
  if (args.storyId) report.display_story_ids = [args.storyId];
  if (args.mergePrevious && loadedPrevious.report) {
    report = mergeOfficialTrailerSegmentReports(loadedPrevious.report, report, {
      preserveUnscopedPrevious: true,
    });
    if (args.storyId) report.display_story_ids = [args.storyId];
    report.current_run = currentRun;
    report.frame_report_source = loaded.filePath;
    report.reference_report_source = loadedReference.filePath;
    report.acquisition_plan_source = loadedAcquisition.filePath;
    report.clip_refs_source = loadedAcquisition.report ? "flash_lane_acquisition_plan" : "frame_or_reference_report";
    report.clip_refs_input_count = clipRefs.length;
    report.clip_refs_filtered_previous_count = clipRefs.length - filteredClipRefs.length;
    report.clip_refs_filtered_exhausted_source_family_count = exhaustedFilter.skipped.length;
    report.clip_refs_balanced_for_batch = !args.storyId && validationClipRefs !== exhaustedFilter.clipRefs;
    report.exhausted_source_family_filter = {
      enabled: true,
      threshold: args.exhaustedSourceFamilyThreshold,
      skipped_clip_refs: exhaustedFilter.skipped,
      exhausted_source_families: exhaustedFilter.exhausted_source_families,
    };
    report.previous_validation_source = loadedPrevious.filePath;
  }

  const markdown = renderOfficialTrailerSegmentValidationMarkdown(report);
  await fs.ensureDir(OUT);
  const outputTargets = reportOutputTargets(args);
  for (const target of outputTargets) {
    await fs.writeJson(target.json, report, { spaces: 2 });
    await fs.writeFile(target.md, markdown, "utf8");
  }

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  const writtenStems = outputTargets.map((target) => `test/output/${target.stem}.{json,md}`).join(", ");
  process.stderr.write(`[segment-validator] wrote ${writtenStems}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[segment-validator] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  balanceClipRefsAcrossStories,
  buildClipRefsFromReport,
  main,
  parseArgs,
  reportOutputTargets,
};
