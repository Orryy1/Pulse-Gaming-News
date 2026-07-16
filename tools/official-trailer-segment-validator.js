#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { ffprobeDuration } = require("../lib/studio/media-acquisition");
const { mediaSourceUrlKindFields } = require("../lib/media-source-url-kind");

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
const DEFAULT_REFERENCE_DURATION_PROBE_TIMEOUT_MS = 10000;
const DEFAULT_MAX_REFERENCE_DURATION_PROBES = 12;

function boundedPositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    frameReport: DEFAULT_FRAME_REPORT,
    referenceReport: DEFAULT_REFERENCE_REPORT,
    referenceReports: [],
    acquisitionPlan: null,
    previousValidationReport: null,
    noReferenceReport: false,
    noReferenceDurationProbe: false,
    referenceDurationProbeTimeoutMs: boundedPositiveInteger(
      process.env.REFERENCE_DURATION_PROBE_TIMEOUT_MS,
      DEFAULT_REFERENCE_DURATION_PROBE_TIMEOUT_MS,
      { min: 1000, max: 120000 },
    ),
    maxReferenceDurationProbes: boundedPositiveInteger(
      process.env.MAX_REFERENCE_DURATION_PROBES,
      DEFAULT_MAX_REFERENCE_DURATION_PROBES,
      { min: 1, max: 500 },
    ),
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
    exploratoryStartSeconds: null,
    exploratoryDurationS: 5,
    allowEarlyExploratoryWindows: false,
    reportJson: null,
    reportMd: null,
    checkpointReport: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story" || arg === "--story-id") args.storyId = argv[++i] || null;
    else if (arg === "--frame-report") args.frameReport = argv[++i] || DEFAULT_FRAME_REPORT;
    else if (arg === "--reference-report" || arg === "--trailer-references") {
      const referenceReport = argv[++i] || DEFAULT_REFERENCE_REPORT;
      args.referenceReport = referenceReport;
      args.referenceReports.push(referenceReport);
      args.noReferenceReport = false;
    } else if (arg === "--no-reference-report" || arg === "--no-trailer-references") {
      args.noReferenceReport = true;
      args.referenceReports = [];
    } else if (arg === "--no-reference-duration-probe") {
      args.noReferenceDurationProbe = true;
    } else if (arg === "--reference-duration-probe-timeout-ms") {
      args.referenceDurationProbeTimeoutMs = boundedPositiveInteger(argv[++i], args.referenceDurationProbeTimeoutMs, {
        min: 1000,
        max: 120000,
      });
    } else if (arg === "--max-reference-duration-probes") {
      args.maxReferenceDurationProbes = boundedPositiveInteger(argv[++i], args.maxReferenceDurationProbes, {
        min: 1,
        max: 500,
      });
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
    } else if (arg === "--exploratory-duration-s") {
      const duration = Number(argv[++i]);
      if (Number.isFinite(duration)) args.exploratoryDurationS = Math.max(1, Math.min(5, duration));
    } else if (arg === "--allow-early-exploratory-windows") {
      args.allowEarlyExploratoryWindows = true;
    } else if (arg === "--report-json") {
      args.reportJson = argv[++i] || null;
    } else if (arg === "--report-md") {
      args.reportMd = argv[++i] || null;
    } else if (arg === "--checkpoint-report") {
      args.checkpointReport = true;
    }
  }
  return args;
}

function shouldProbeReferenceDurations(args = {}) {
  return args.applyLocal === true && args.noReferenceDurationProbe !== true;
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
      "  --no-reference-duration-probe",
      "                         Do not ffprobe missing HLS/DASH/direct durations before local validation",
      "  --reference-duration-probe-timeout-ms <n>",
      "                         Bound each reference duration probe, default 10000",
      "  --max-reference-duration-probes <n>",
      "                         Bound batch duration probes before validation, default 12",
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
      "  --exploratory-duration-s <n>",
      "                         Window length for --deep-scan, 1-5 seconds, default 5",
      "  --allow-early-exploratory-windows",
      "                         Sample explicit starts from 6s onward through full frame QA",
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
  const reportTargets = [...new Set(targets)].map((stem) => ({
    stem,
    json: path.join(OUT, `${stem}.json`),
    md: path.join(OUT, `${stem}.md`),
  }));
  if (args.reportJson) {
    const json = path.resolve(ROOT, args.reportJson);
    const md = path.resolve(ROOT, args.reportMd || args.reportJson.replace(/\.json$/i, ".md"));
    reportTargets.push({
      stem: safeReportStemPart(path.basename(json, ".json")) || "custom_report",
      json,
      md,
    });
  }
  return reportTargets;
}

function assertReportTargetSafe(target = {}) {
  const allowedRoots = [OUT, path.join(ROOT, "output")];
  for (const filePath of [target.json, target.md]) {
    const resolved = path.resolve(filePath);
    const insideAllowedRoot = allowedRoots.some((root) => {
      const rel = path.relative(root, resolved);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
    if (!insideAllowedRoot) {
      throw new Error(`segment validation report output must stay under test/output or output: ${resolved}`);
    }
  }
}

async function writeSegmentValidationReports(report, targets) {
  const markdown = renderOfficialTrailerSegmentValidationMarkdown(report);
  for (const target of targets) {
    assertReportTargetSafe(target);
    await fs.ensureDir(path.dirname(target.json));
    await fs.writeJson(target.json, report, { spaces: 2 });
    await fs.writeFile(target.md, markdown, "utf8");
  }
}

function clipSourceUrl(clip = {}) {
  return String(clip?.path || clip?.source_url || clip?.sourceUrl || clip?.clip_url || "").trim();
}

function currentReferenceSourceUrls(clipRefs = []) {
  return [...new Set((Array.isArray(clipRefs) ? clipRefs : []).map(clipSourceUrl).filter(Boolean))];
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
  const referencePaths = Array.isArray(args.referenceReports) && args.referenceReports.length
    ? args.referenceReports
    : [args.referenceReport || DEFAULT_REFERENCE_REPORT];
  const filePaths = [];
  const reports = [];
  for (const referencePath of referencePaths) {
    const filePath = path.resolve(ROOT, referencePath);
    filePaths.push(filePath);
    if (!(await fs.pathExists(filePath))) {
      if (referencePaths.length === 1) return { report: null, filePath: null };
      continue;
    }
    reports.push(await fs.readJson(filePath));
  }
  return {
    report: reports.length ? mergeReferenceReportPayloads(reports) : null,
    filePath: filePaths.length === 1 ? filePaths[0] : filePaths,
  };
}

function existingDurationSeconds(record = {}) {
  const provenance = record.provenance || {};
  for (const value of [
    record.sourceDurationS,
    record.source_duration_s,
    record.durationSeconds,
    record.duration_seconds,
    record.referenceDurationS,
    record.reference_duration_s,
    provenance.sourceDurationS,
    provenance.source_duration_s,
    provenance.durationSeconds,
    provenance.duration_seconds,
  ]) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
}

function durationProbeEligibleReference(reference = {}) {
  if (!reference || typeof reference !== "object") return false;
  if (existingDurationSeconds(reference)) return false;
  if (reference.segment_validation_eligible === false) return false;
  const sourceUrl = String(reference.source_url || reference.sourceUrl || reference.local_path || "").trim();
  if (!sourceUrl) return false;
  const urlKind = reference.source_url_kind || mediaSourceUrlKindFields(sourceUrl).source_url_kind;
  return ["direct_video", "hls_manifest", "dash_manifest", "local_video_file"].includes(urlKind);
}

function scopedStoryIdSet(options = {}) {
  const raw = [
    options.storyId,
    options.story_id,
    ...(Array.isArray(options.storyIds) ? options.storyIds : []),
    ...(Array.isArray(options.story_ids) ? options.story_ids : []),
  ];
  return new Set(raw.map((item) => String(item || "").trim()).filter(Boolean));
}

function referenceInStoryScope(plan = {}, reference = {}, storyIds = new Set()) {
  if (!storyIds.size) return true;
  const candidates = [
    plan.story_id,
    plan.storyId,
    reference.story_id,
    reference.storyId,
    reference.provenance?.story_id,
    reference.provenance?.storyId,
  ].map((item) => String(item || "").trim());
  return candidates.some((item) => item && storyIds.has(item));
}

function durationProbeTimeoutError(timeoutMs) {
  const err = new Error(`duration_probe_timeout_${timeoutMs}ms`);
  err.code = "duration_probe_timeout";
  return err;
}

function durationProbeWithTimeout(durationProbe, sourceUrl, reference, timeoutMs) {
  const timeout = boundedPositiveInteger(timeoutMs, DEFAULT_REFERENCE_DURATION_PROBE_TIMEOUT_MS, {
    min: 1,
    max: 120000,
  });
  let timer = null;
  return Promise.race([
    Promise.resolve().then(() => durationProbe(sourceUrl, reference)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(durationProbeTimeoutError(timeout)), timeout);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function referenceRowsFromLicensedDirectMediaReport(report = {}) {
  const rows = Array.isArray(report?.accepted_references)
    ? report.accepted_references
    : Array.isArray(report?.render_ready_sources)
      ? report.render_ready_sources
      : [];
  return rows.filter((row) => row && typeof row === "object");
}

function officialProductPageUrl(row = {}) {
  const url = String(
    row.official_source_url ||
      row.reference_url ||
      row.canonical_source_url ||
      row.product_page_url ||
      "",
  ).trim();
  if (!url) return "";
  return /(?:store\.playstation\.com\/|xbox\.com\/[^?#]*\/games\/store\/|store\.steampowered\.com\/app\/|nintendo\.com\/[^?#]*(?:store\/products|games\/detail)\/|epicgames\.com\/store\/)/i.test(
    url,
  )
    ? url
    : "";
}

function sourceTypeForLicensedDirectMediaReference(row = {}) {
  const provenance = row.provenance || {};
  const explicit = String(row.source_type || row.sourceType || "").trim();
  if (/official_platform_product_page/i.test(explicit)) return "official_platform_product_page";
  const productPageUrl = officialProductPageUrl(row);
  const officialEvidence = [
    row.rights_gate,
    row.rightsGate,
    row.access_mode,
    row.accessMode,
    row.source_tier,
    row.sourceTier,
    row.status,
    row.rights_risk_class,
    row.rightsRiskClass,
    provenance.rights_gate,
    provenance.rightsGate,
    provenance.access_mode,
    provenance.accessMode,
    provenance.rights_risk_class,
    provenance.rightsRiskClass,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const officialSource =
    /\bofficial_source\b/.test(officialEvidence) ||
    /\bapproved_direct_media_url\b/.test(officialEvidence) ||
    /\bofficial\b/.test(officialEvidence);
  if (productPageUrl && officialSource) return "official_platform_product_page";
  return explicit || "licensed_direct_media_url";
}

function normaliseLicensedDirectMediaReference(row = {}) {
  const sourceUrl = String(
    row.source_url ||
      row.sourceUrl ||
      row.approved_media_url ||
      row.local_operator_file_path ||
      row.local_path ||
      "",
  ).trim();
  const urlKind = mediaSourceUrlKindFields(sourceUrl);
  const segmentEligible =
    row.segment_validation_eligible !== false && urlKind.segment_validation_eligible === true;
  const sourceType = sourceTypeForLicensedDirectMediaReference(row);
  return {
    ...row,
    source_url: sourceUrl,
    source_url_kind: row.source_url_kind || urlKind.source_url_kind,
    segment_validation_eligible: segmentEligible,
    segment_validation_ineligible_reason: segmentEligible
      ? null
      : row.segment_validation_ineligible_reason ||
        urlKind.segment_validation_ineligible_reason ||
        "segment_source_url_not_direct_media",
    source_type: sourceType,
    provider: row.provider || "licensed_direct_media_acquisition",
    downloads_allowed: false,
    allowed_render_use: row.allowed_render_use || "official_direct_media_segment_candidate",
    rights_risk_class: row.rights_risk_class || "official_direct_media",
    provenance: {
      ...(row.provenance || {}),
      source: row.provenance?.source || "visual_v4_licensed_direct_media_acquisition",
      original_source_type: row.source_type || row.sourceType || null,
      official_product_page_url: officialProductPageUrl(row) || null,
      source_url_kind: row.source_url_kind || urlKind.source_url_kind,
      segment_validation_eligible: segmentEligible,
    },
  };
}

function normaliseReferenceReportPayload(report = {}) {
  if (!report || typeof report !== "object") return report;
  if (Array.isArray(report.plans)) return report;
  const rows = referenceRowsFromLicensedDirectMediaReport(report);
  if (!rows.length) return report;
  const byStoryId = new Map();
  for (const row of rows) {
    const storyId = String(row.story_id || row.storyId || "").trim();
    if (!storyId) continue;
    if (!byStoryId.has(storyId)) byStoryId.set(storyId, []);
    byStoryId.get(storyId).push(normaliseLicensedDirectMediaReference(row));
  }
  return {
    ...report,
    reference_report_adapter: "licensed_direct_media_accepted_references_v1",
    plans: [...byStoryId.entries()].map(([storyId, references]) => ({
      story_id: storyId,
      references,
    })),
  };
}

function mergeReferenceReportPayloads(reports = []) {
  const normalisedReports = (Array.isArray(reports) ? reports : [reports])
    .map((report) => normaliseReferenceReportPayload(report))
    .filter((report) => report && typeof report === "object");
  if (normalisedReports.length <= 1) return normalisedReports[0] || null;

  const byStoryId = new Map();
  for (const report of normalisedReports) {
    for (const plan of Array.isArray(report.plans) ? report.plans : []) {
      const storyId = String(plan.story_id || plan.storyId || "").trim();
      if (!storyId) continue;
      if (!byStoryId.has(storyId)) byStoryId.set(storyId, []);
      const references = byStoryId.get(storyId);
      const seen = new Set(
        references.map((reference) =>
          [
            String(reference.source_url || reference.sourceUrl || reference.local_path || "").trim(),
            String(reference.entity || "").trim().toLowerCase(),
            String(reference.source_family || reference.sourceFamily || "").trim().toLowerCase(),
          ].join("|"),
        ),
      );
      for (const reference of Array.isArray(plan.references) ? plan.references : []) {
        const key = [
          String(reference.source_url || reference.sourceUrl || reference.local_path || "").trim(),
          String(reference.entity || "").trim().toLowerCase(),
          String(reference.source_family || reference.sourceFamily || "").trim().toLowerCase(),
        ].join("|");
        if (!key.trim() || seen.has(key)) continue;
        seen.add(key);
        references.push(reference);
      }
    }
  }

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    reference_report_adapter: "merged_reference_reports_v1",
    plans: [...byStoryId.entries()].map(([storyId, references]) => ({
      story_id: storyId,
      references,
    })),
  };
}

async function enrichReferenceReportDurations(report = null, options = {}) {
  const enabled = options.enabled !== false;
  const durationProbe = options.durationProbe || ffprobeDuration;
  const storyIds = scopedStoryIdSet(options);
  const timeoutMs = boundedPositiveInteger(
    options.durationProbeTimeoutMs ?? options.timeoutMs,
    DEFAULT_REFERENCE_DURATION_PROBE_TIMEOUT_MS,
    { min: 1, max: 120000 },
  );
  const maxProbes = boundedPositiveInteger(
    options.maxProbes ?? options.maxReferenceDurationProbes,
    Number.POSITIVE_INFINITY,
    { min: 1, max: Number.MAX_SAFE_INTEGER },
  );
  const summary = {
    enabled,
    candidates: 0,
    probed: 0,
    failed: 0,
    timed_out: 0,
    skipped_out_of_scope: 0,
    skipped_probe_budget: 0,
    skipped_existing_duration: 0,
    timeout_ms: timeoutMs,
    max_probes: Number.isFinite(maxProbes) ? maxProbes : null,
  };
  const normalisedReport = normaliseReferenceReportPayload(report);
  if (!normalisedReport || typeof normalisedReport !== "object") return { report: normalisedReport, summary };
  const plans = Array.isArray(normalisedReport.plans) ? normalisedReport.plans : [];
  const enriched = {
    ...normalisedReport,
    plans: plans.map((plan) => ({
      ...plan,
      references: Array.isArray(plan.references) ? plan.references.map((reference) => ({ ...reference })) : [],
    })),
  };
  if (!enabled) return { report: enriched, summary };

  for (const plan of enriched.plans) {
    for (const reference of plan.references) {
      if (!referenceInStoryScope(plan, reference, storyIds)) {
        summary.skipped_out_of_scope += 1;
        continue;
      }
      if (existingDurationSeconds(reference)) {
        summary.skipped_existing_duration += 1;
        continue;
      }
      if (!durationProbeEligibleReference(reference)) continue;
      if (Number.isFinite(maxProbes) && summary.candidates >= maxProbes) {
        summary.skipped_probe_budget += 1;
        continue;
      }
      summary.candidates += 1;
      const sourceUrl = String(reference.source_url || reference.sourceUrl || reference.local_path || "").trim();
      try {
        const duration = await durationProbeWithTimeout(durationProbe, sourceUrl, reference, timeoutMs);
        const number = Number(duration);
        if (!Number.isFinite(number) || number <= 0) {
          summary.failed += 1;
          continue;
        }
        const rounded = Number(number.toFixed(2));
        reference.source_duration_s = rounded;
        reference.provenance = {
          ...(reference.provenance || {}),
          source_duration_s: rounded,
          duration_probe: "ffprobe",
        };
        summary.probed += 1;
      } catch (err) {
        summary.failed += 1;
        if (err?.code === "duration_probe_timeout") {
          summary.timed_out += 1;
          reference.provenance = {
            ...(reference.provenance || {}),
            duration_probe: "ffprobe",
            duration_probe_error: "timeout",
            duration_probe_timeout_ms: timeoutMs,
          };
        }
      }
    }
  }
  return { report: enriched, summary };
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
  const normalisedReferenceReport = normaliseReferenceReportPayload(referenceReport);
  const referenceStoryIds = [
    ...new Set(
      (Array.isArray(normalisedReferenceReport?.plans) ? normalisedReferenceReport.plans : [])
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
      exploratoryDurationS: args.exploratoryDurationS,
      allowEarlyExploratoryWindows: args.allowEarlyExploratoryWindows,
      referenceReport: normalisedReferenceReport,
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
  const enrichedReference = await enrichReferenceReportDurations(loadedReference.report, {
    enabled: shouldProbeReferenceDurations(args),
    storyId: args.storyId,
    durationProbeTimeoutMs: args.referenceDurationProbeTimeoutMs,
    maxProbes: args.maxReferenceDurationProbes,
  });
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
        enrichedReference.report,
        args.storyId,
      )
    : buildClipRefsFromReport(loaded.report, enrichedReference.report, args.storyId, {
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
  const outputTargets = reportOutputTargets(args);
  let report = await runOfficialTrailerSegmentValidation(validationClipRefs, {
    applyLocal: args.applyLocal,
    outputRoot: args.outputRoot,
    maxSegments: args.maxSegments,
    onProgress: args.checkpointReport
      ? async (partialReport) => {
          const checkpoint = {
            ...partialReport,
            checkpoint_report: true,
            frame_report_source: loaded.filePath,
            reference_report_source: loadedReference.filePath,
            reference_duration_probe: enrichedReference.summary,
            acquisition_plan_source: loadedAcquisition.filePath,
            clip_refs_source: loadedAcquisition.report ? "flash_lane_acquisition_plan" : "frame_or_reference_report",
            clip_refs_input_count: clipRefs.length,
            previous_validation_source: loadedPrevious.filePath,
          };
          const reportForWrite = args.mergePrevious && loadedPrevious.report
            ? {
                ...mergeOfficialTrailerSegmentReports(scopedPreviousReport, checkpoint, {
                  preserveUnscopedPrevious: true,
                  storyIds: args.storyId ? [args.storyId] : [],
                  currentReferenceSourceUrls: currentReferenceSourceUrls(clipRefs),
                }),
                status: "partial",
                completed: false,
                checkpoint_report: true,
              }
            : checkpoint;
          await writeSegmentValidationReports(reportForWrite, outputTargets);
        }
      : null,
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
  report.reference_duration_probe = enrichedReference.summary;
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
      storyIds: args.storyId ? [args.storyId] : [],
      currentReferenceSourceUrls: currentReferenceSourceUrls(clipRefs),
    });
    if (args.storyId) report.display_story_ids = [args.storyId];
    report.current_run = currentRun;
    report.frame_report_source = loaded.filePath;
    report.reference_report_source = loadedReference.filePath;
    report.reference_duration_probe = enrichedReference.summary;
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

  await fs.ensureDir(OUT);
  await writeSegmentValidationReports(report, outputTargets);

  const markdown = renderOfficialTrailerSegmentValidationMarkdown(report);
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
  normaliseReferenceReportPayload,
  parseArgs,
  reportOutputTargets,
  shouldProbeReferenceDurations,
  enrichReferenceReportDurations,
  mergeReferenceReportPayloads,
};
