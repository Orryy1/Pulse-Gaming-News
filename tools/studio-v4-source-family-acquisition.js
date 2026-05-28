#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const {
  buildStudioV4SourceFamilyAcquisitionReport,
  renderStudioV4SourceFamilyAcquisitionMarkdown,
} = require("../lib/studio/v4/source-family-acquisition");

const ROOT = path.resolve(__dirname, "..");
const TEST_OUT = path.join(ROOT, "test", "output");
const DEFAULT_MOTION_PACK_DIR = path.join(ROOT, "output", "studio-v4", "motion-packs");
const DEFAULT_MOTION_PACK_INDEX = path.join(DEFAULT_MOTION_PACK_DIR, "visual_v4_motion_packs.json");
const DEFAULT_ARTIFACT_ROOT = path.join(ROOT, "output", "goal-proof", "batch");
const DEFAULT_TRUSTED_REPORTS = [
  path.join(ROOT, "output", "trusted_footage_registry_report.json"),
  path.join(TEST_OUT, "trusted_footage_registry_report.json"),
];
const DEFAULT_REFERENCE_REPORTS = [
  path.join(TEST_OUT, "official_trailer_references_v1.json"),
  path.join(TEST_OUT, "official_trailer_references_v1_story.json"),
];
const DEFAULT_OUTPUT_JSON = path.join(TEST_OUT, "studio_v4_source_family_acquisition.json");
const DEFAULT_OUTPUT_MD = path.join(TEST_OUT, "studio_v4_source_family_acquisition.md");
const DEFAULT_INTAKE_TEMPLATE = path.join(TEST_OUT, "visual_v4_source_family_intake_template.json");
const DEFAULT_SEARCH_TEMPLATE = path.join(TEST_OUT, "visual_v4_official_search_template.json");
const DEFAULT_GOVERNED_VISUAL_PLAN_TEMPLATE = path.join(TEST_OUT, "visual_v4_governed_visual_plan_template.json");
const DEFAULT_CANONICAL_ENTITY_REPAIR_TEMPLATE = path.join(TEST_OUT, "visual_v4_canonical_entity_repair_template.json");
const DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER = path.join(
  ROOT,
  "output",
  "goal-contract",
  "direct_video_enrichment_work_order.json",
);
const DEFAULT_STORY_PACKAGES = path.join(
  ROOT,
  "output",
  "goal-contract",
  "production_cutover_story_packages.json",
);

function parseArgs(argv) {
  const args = {
    help: false,
    json: false,
    storyId: null,
    storyIds: [],
    motionPack: null,
    motionPacks: [],
    motionPackIndex: DEFAULT_MOTION_PACK_INDEX,
    trustedFootageReport: null,
    referenceReport: null,
    referenceReports: [],
    storyPackages: DEFAULT_STORY_PACKAGES,
    workOrder: DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER,
    artifactRoot: DEFAULT_ARTIFACT_ROOT,
    outputJson: DEFAULT_OUTPUT_JSON,
    outputMd: DEFAULT_OUTPUT_MD,
    intakeTemplate: DEFAULT_INTAKE_TEMPLATE,
    searchTemplate: DEFAULT_SEARCH_TEMPLATE,
    governedVisualPlanTemplate: DEFAULT_GOVERNED_VISUAL_PLAN_TEMPLATE,
    canonicalEntityRepairTemplate: DEFAULT_CANONICAL_ENTITY_REPAIR_TEMPLATE,
    _explicitPaths: {
      outputJson: false,
      intakeTemplate: false,
      searchTemplate: false,
      governedVisualPlanTemplate: false,
      canonicalEntityRepairTemplate: false,
    },
  };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--story-id" || arg === "--story") {
      addStoryIdFilters(args, argv[++i] || null);
    } else if (arg === "--story-ids" || arg === "--stories") {
      addStoryIdFilters(args, argv[++i] || null);
    }
    else if (arg === "--motion-pack") {
      const value = argv[++i] || null;
      args.motionPack = value;
      if (value) args.motionPacks.push(value);
    } else if (arg === "--motion-pack-index") {
      args.motionPackIndex = argv[++i] || DEFAULT_MOTION_PACK_INDEX;
    } else if (arg === "--trusted-footage-report") {
      args.trustedFootageReport = argv[++i] || null;
    } else if (arg === "--reference-report" || arg === "--trailer-references") {
      const value = argv[++i] || null;
      args.referenceReport = value;
      if (value) args.referenceReports.push(value);
    } else if (arg === "--story-packages") {
      args.storyPackages = argv[++i] || null;
    } else if (arg === "--no-story-packages") {
      args.storyPackages = null;
    } else if (arg === "--work-order" || arg === "--render-input-work-order") {
      args.workOrder = argv[++i] || null;
    } else if (arg === "--no-work-order") {
      args.workOrder = null;
    } else if (arg === "--artifact-root") {
      args.artifactRoot = argv[++i] || DEFAULT_ARTIFACT_ROOT;
    } else if (arg === "--output-json") {
      args.outputJson = argv[++i] || DEFAULT_OUTPUT_JSON;
      args._explicitPaths.outputJson = true;
    } else if (arg === "--output-md") {
      args.outputMd = argv[++i] || DEFAULT_OUTPUT_MD;
    } else if (arg === "--intake-template") {
      args.intakeTemplate = argv[++i] || DEFAULT_INTAKE_TEMPLATE;
      args._explicitPaths.intakeTemplate = true;
    } else if (arg === "--search-template" || arg === "--official-search-template") {
      args.searchTemplate = argv[++i] || DEFAULT_SEARCH_TEMPLATE;
      args._explicitPaths.searchTemplate = true;
    } else if (arg === "--governed-visual-plan-template" || arg === "--visual-plan-template") {
      args.governedVisualPlanTemplate = argv[++i] || DEFAULT_GOVERNED_VISUAL_PLAN_TEMPLATE;
      args._explicitPaths.governedVisualPlanTemplate = true;
    } else if (arg === "--canonical-entity-repair-template" || arg === "--entity-repair-template") {
      args.canonicalEntityRepairTemplate = argv[++i] || DEFAULT_CANONICAL_ENTITY_REPAIR_TEMPLATE;
      args._explicitPaths.canonicalEntityRepairTemplate = true;
    }
  }
  applyOutputJsonTemplateDefaults(args);
  return args;
}

function applyOutputJsonTemplateDefaults(args = {}) {
  if (!args._explicitPaths?.outputJson) return args;
  const outputDir = path.dirname(args.outputJson || DEFAULT_OUTPUT_JSON);
  if (!args._explicitPaths.intakeTemplate) {
    args.intakeTemplate = path.join(outputDir, "visual_v4_source_family_intake_template.json");
  }
  if (!args._explicitPaths.searchTemplate) {
    args.searchTemplate = path.join(outputDir, "visual_v4_official_search_template.json");
  }
  if (!args._explicitPaths.governedVisualPlanTemplate) {
    args.governedVisualPlanTemplate = path.join(outputDir, "visual_v4_governed_visual_plan_template.json");
  }
  if (!args._explicitPaths.canonicalEntityRepairTemplate) {
    args.canonicalEntityRepairTemplate = path.join(outputDir, "visual_v4_canonical_entity_repair_template.json");
  }
  return args;
}

function addStoryIdFilters(args, value) {
  for (const item of String(value || "").split(",")) {
    const storyId = cleanText(item);
    if (!storyId || args.storyIds.includes(storyId)) continue;
    args.storyIds.push(storyId);
    if (!args.storyId) args.storyId = storyId;
  }
}

function printHelp() {
  process.stdout.write(
    [
      "Usage: node tools/studio-v4-source-family-acquisition.js [options]",
      "",
      "Options:",
      "  --story-id <id>                  Report one story; repeatable",
      "  --story-ids <ids>                Comma-separated story IDs",
      "  --motion-pack <path>             Read one motion-pack manifest; repeatable",
      "  --motion-pack-index <path>       Read motion-pack index, default output/studio-v4/motion-packs/visual_v4_motion_packs.json",
      "  --trusted-footage-report <path>  Read trusted footage registry report",
      "  --reference-report <path>        Read trailer reference report; repeatable",
      "  --story-packages <path>          Hydrate motion packs from governed story package manifests, default output/goal-contract/production_cutover_story_packages.json",
      "  --no-story-packages              Do not hydrate motion packs from story packages",
      "  --work-order <path>              Limit report to work-order story IDs, default output/goal-contract/direct_video_enrichment_work_order.json",
      "  --no-work-order                  Ignore the default direct-video enrichment work order",
      "  --artifact-root <path>           Canonical package root, default output/goal-proof/batch",
      "  --output-json <path>             Write local JSON report",
      "  --output-md <path>               Write local Markdown report",
      "  --intake-template <path>         Write fillable official-source intake template",
      "  --search-template <path>         Write official search action template when no source family is known",
      "  --governed-visual-plan-template <path> Write operator-held governed visual plans",
      "  --canonical-entity-repair-template <path> Write malformed/generic canonical entity repair rows",
      "  --json                           Print JSON instead of Markdown",
      "",
      "This command only writes local reports/templates. It does not download media, mutate the DB, change OAuth, restart services or post.",
    ].join("\n") + "\n",
  );
}

function resolveFromRoot(filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(ROOT, filePath);
}

function commandPathFromRoot(filePath) {
  const resolved = resolveFromRoot(filePath);
  if (!resolved) return "";
  const relative = path.relative(ROOT, resolved);
  const insideRoot = relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  return (insideRoot ? relative : resolved).replace(/\\/g, "/");
}

function commandPathsFromArgs(args = {}) {
  const intakeTemplate = resolveFromRoot(args.intakeTemplate);
  const officialDirectMediaIntakeTemplate = intakeTemplate
    ? path.join(path.dirname(intakeTemplate), "official_direct_media_intake_template.json")
    : null;
  const officialDirectMediaDiscoveryJson = intakeTemplate
    ? path.join(path.dirname(intakeTemplate), "official_direct_media_discovery.json")
    : null;
  const officialDirectMediaDiscoveryMd = intakeTemplate
    ? path.join(path.dirname(intakeTemplate), "official_direct_media_discovery.md")
    : null;
  const licensedDirectMediaReport = intakeTemplate
    ? path.join(path.dirname(intakeTemplate), "studio_v4_licensed_direct_media_acquisition.json")
    : null;
  const trustedFootageRegistryReport = intakeTemplate
    ? path.join(path.dirname(intakeTemplate), "trusted_footage_registry_report.json")
    : null;
  const segmentValidationReport = intakeTemplate
    ? path.join(path.dirname(intakeTemplate), "official_trailer_segment_validation_apply_local.json")
    : null;
  return {
    sourceFamilyIntakeTemplate: commandPathFromRoot(args.intakeTemplate),
    officialSearchTemplate: commandPathFromRoot(args.searchTemplate),
    governedVisualPlanTemplate: commandPathFromRoot(args.governedVisualPlanTemplate),
    officialDirectMediaIntakeTemplate: commandPathFromRoot(officialDirectMediaIntakeTemplate),
    officialDirectMediaDiscoveryJson: commandPathFromRoot(officialDirectMediaDiscoveryJson),
    officialDirectMediaDiscoveryMd: commandPathFromRoot(officialDirectMediaDiscoveryMd),
    licensedDirectMediaReport: commandPathFromRoot(licensedDirectMediaReport),
    trustedFootageRegistryReport: commandPathFromRoot(trustedFootageRegistryReport),
    segmentValidationReport: commandPathFromRoot(segmentValidationReport),
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function firstText(...values) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return typeof value === "object" ? [value] : [];
}

function storyIdFrom(value = {}) {
  return firstText(value.story_id, value.storyId, value.id);
}

function storyIdFilterSet(args = {}) {
  const ids = [...asArray(args.storyIds), args.storyId].map(cleanText).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function storyIdAllowed(args = {}, value = {}) {
  const filters = storyIdFilterSet(args);
  if (!filters) return true;
  return filters.has(cleanText(typeof value === "string" ? value : storyIdFrom(value)));
}

async function readJsonIfExists(filePath, fallback = {}) {
  const resolved = resolveFromRoot(filePath);
  if (!resolved || !(await fs.pathExists(resolved))) return fallback;
  return fs.readJson(resolved);
}

function storyPackagesFrom(raw) {
  if (Array.isArray(raw)) return raw;
  return asArray(raw.packages || raw.story_packages || raw.stories || raw.items);
}

function manifestPathForPackage(pkg = {}, args = {}) {
  const storyId = storyIdFrom(pkg);
  const explicitArtifactDir = firstText(pkg.artifact_dir, pkg.artifactDir, pkg.artefact_dir);
  if (explicitArtifactDir) {
    return path.join(resolveFromRoot(explicitArtifactDir), "canonical_story_manifest.json");
  }
  if (!storyId) return null;
  const artifactRoot = resolveFromRoot(args.artifactRoot || DEFAULT_ARTIFACT_ROOT);
  return path.join(artifactRoot, storyId, "canonical_story_manifest.json");
}

function hydrateMotionPacksWithCanonicalManifests(motionPackReports = [], canonicalManifestsByStoryId = new Map()) {
  const manifestFor = (storyId) => {
    if (!storyId) return null;
    if (canonicalManifestsByStoryId instanceof Map) return canonicalManifestsByStoryId.get(storyId) || null;
    return canonicalManifestsByStoryId[storyId] || null;
  };

  return asArray(motionPackReports).map((pack) => {
    const storyId = storyIdFrom(pack);
    const manifest = manifestFor(storyId);
    if (!manifest) return pack;

    return {
      ...pack,
      title: firstText(manifest.selected_title, manifest.canonical_title, manifest.title, pack.title),
      canonical_subject: firstText(manifest.canonical_subject, pack.canonical_subject),
      canonical_game: firstText(manifest.canonical_game, pack.canonical_game, pack.game),
      canonical_company: firstText(manifest.canonical_company, pack.canonical_company),
      canonical_people: manifest.canonical_people || pack.canonical_people,
      canonical_platforms: manifest.canonical_platforms || pack.canonical_platforms,
      primary_source: firstText(manifest.primary_source, pack.primary_source),
      primary_source_url: firstText(manifest.primary_source_url, pack.primary_source_url),
      canonical_manifest_hydration: {
        source: "goal_story_package",
        manifest_path: manifest.__manifest_path || null,
        title_before: pack.title || null,
        title_after: firstText(manifest.selected_title, manifest.canonical_title, manifest.title, pack.title) || null,
      },
    };
  });
}

async function loadCanonicalManifestsFromStoryPackages(args) {
  if (!args.storyPackages) return new Map();
  const raw = await readJsonIfExists(args.storyPackages, null);
  const packages = storyPackagesFrom(raw);
  const manifests = new Map();

  for (const pkg of packages) {
    const storyId = storyIdFrom(pkg);
    if (!storyId) continue;
    if (pkg.canonical_story_manifest && typeof pkg.canonical_story_manifest === "object") {
      manifests.set(storyId, { ...pkg.canonical_story_manifest, __manifest_path: null });
      continue;
    }
    const manifestPath = manifestPathForPackage(pkg, args);
    const manifest = await readJsonIfExists(manifestPath, null);
    if (!manifest) continue;
    manifests.set(storyId, { ...manifest, __manifest_path: manifestPath });
  }

  return manifests;
}

async function readFirstExisting(candidates, fallback = {}) {
  for (const filePath of candidates) {
    const resolved = resolveFromRoot(filePath);
    if (resolved && (await fs.pathExists(resolved))) return fs.readJson(resolved);
  }
  return fallback;
}

async function loadStoryPackageIdSet(args) {
  if (!args.storyPackages) return null;
  const raw = await readJsonIfExists(args.storyPackages, null);
  const filters = storyIdFilterSet(args);
  const ids = storyPackagesFrom(raw)
    .map(storyIdFrom)
    .filter((storyId) => storyId && (!filters || filters.has(storyId)));
  return ids.length ? new Set(ids) : null;
}

async function loadWorkOrderIdSet(args) {
  if (!args.workOrder) return null;
  const raw = await readJsonIfExists(args.workOrder, null);
  const filters = storyIdFilterSet(args);
  const ids = asArray(raw?.jobs)
    .map(storyIdFrom)
    .filter((storyId) => storyId && (!filters || filters.has(storyId)));
  return ids.length ? new Set(ids) : null;
}

async function loadDirectVideoEnrichmentWorkOrder(args) {
  if (!args.workOrder) return {};
  const raw = await readJsonIfExists(args.workOrder, null);
  if (!raw || typeof raw !== "object") return {};
  const filters = storyIdFilterSet(args);
  const jobs = asArray(raw.jobs).filter((job) => {
    const storyId = storyIdFrom(job);
    return storyId && (!filters || filters.has(storyId));
  });
  if (!jobs.length) return {};
  return {
    ...raw,
    jobs,
  };
}

async function loadMotionPackStoryFilter(args) {
  const workOrderIds = await loadWorkOrderIdSet(args);
  if (workOrderIds) return workOrderIds;
  return loadStoryPackageIdSet(args);
}

async function loadMotionPacks(args) {
  const paths = [...args.motionPacks];
  const packageStoryIds = await loadMotionPackStoryFilter(args);
  const indexedStoryIds = new Set();
  if (!paths.length) {
    const index = await readJsonIfExists(args.motionPackIndex, null);
    if (index) {
      for (const item of Array.isArray(index.packs) ? index.packs : []) {
        if (!item.manifest_path) continue;
        if (!storyIdAllowed(args, item)) continue;
        if (packageStoryIds && !packageStoryIds.has(storyIdFrom(item))) continue;
        paths.push(item.manifest_path);
        indexedStoryIds.add(storyIdFrom(item));
      }
    }
    if (packageStoryIds) {
      for (const storyId of packageStoryIds) {
        if (!storyId || indexedStoryIds.has(storyId)) continue;
        paths.push(path.join(DEFAULT_MOTION_PACK_DIR, `${storyId}_motion_pack_manifest.json`));
      }
    }
  }
  if (!paths.length) {
    const filters = storyIdFilterSet(args);
    if (filters) {
      for (const storyId of filters) {
        paths.push(path.join(DEFAULT_MOTION_PACK_DIR, `${storyId}_motion_pack_manifest.json`));
      }
    }
  }

  const packs = [];
  for (const filePath of paths) {
    const pack = await readJsonIfExists(filePath, null);
    if (!pack) continue;
    if (!storyIdAllowed(args, pack)) continue;
    if (packageStoryIds && !packageStoryIds.has(storyIdFrom(pack))) continue;
    packs.push(pack);
  }
  return packs;
}

async function loadTrustedReport(args) {
  if (args.trustedFootageReport) return readJsonIfExists(args.trustedFootageReport, {});
  return readFirstExisting(DEFAULT_TRUSTED_REPORTS, {});
}

function mergeReferenceReports(reports = []) {
  const inputs = asArray(reports).filter((report) => report && typeof report === "object");
  const plans = inputs.flatMap((report) => asArray(report.plans));
  return {
    schema_version: 1,
    execution_mode: "merged_reference_reports",
    merged_reference_report_count: inputs.length,
    merged_reference_plan_count: plans.length,
    plans,
  };
}

async function loadReferenceReport(args) {
  if (args.referenceReports?.length) {
    const reports = [];
    for (const filePath of args.referenceReports) {
      const report = await readJsonIfExists(filePath, null);
      if (report) reports.push(report);
    }
    return mergeReferenceReports(reports);
  }
  if (args.referenceReport) return readJsonIfExists(args.referenceReport, {});
  return readFirstExisting(DEFAULT_REFERENCE_REPORTS, {});
}

async function writeReportFiles(args, report, markdown) {
  const outputJson = resolveFromRoot(args.outputJson);
  const outputMd = resolveFromRoot(args.outputMd);
  const intakeTemplate = resolveFromRoot(args.intakeTemplate);
  const searchTemplate = resolveFromRoot(args.searchTemplate);
  const governedVisualPlanTemplate = resolveFromRoot(args.governedVisualPlanTemplate);
  const canonicalEntityRepairTemplate = resolveFromRoot(args.canonicalEntityRepairTemplate);
  await fs.ensureDir(path.dirname(outputJson));
  await fs.ensureDir(path.dirname(outputMd));
  await fs.ensureDir(path.dirname(intakeTemplate));
  await fs.ensureDir(path.dirname(searchTemplate));
  await fs.ensureDir(path.dirname(governedVisualPlanTemplate));
  await fs.ensureDir(path.dirname(canonicalEntityRepairTemplate));
  await fs.writeJson(outputJson, report, { spaces: 2 });
  await fs.writeFile(outputMd, markdown, "utf8");
  await fs.writeJson(intakeTemplate, report.source_intake_template.entries, { spaces: 2 });
  await fs.writeJson(searchTemplate, report.official_search_template.entries, { spaces: 2 });
  await fs.writeJson(governedVisualPlanTemplate, report.governed_visual_plan_template.entries, { spaces: 2 });
  await fs.writeJson(canonicalEntityRepairTemplate, report.canonical_entity_repair_template.entries, { spaces: 2 });
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  const motionPackReports = await loadMotionPacks(args);
  const canonicalManifests = await loadCanonicalManifestsFromStoryPackages(args);
  const hydratedMotionPackReports = hydrateMotionPacksWithCanonicalManifests(
    motionPackReports,
    canonicalManifests,
  );
  const trustedFootageReport = await loadTrustedReport(args);
  const referenceReport = await loadReferenceReport(args);
  const directVideoEnrichmentWorkOrder = await loadDirectVideoEnrichmentWorkOrder(args);
  const report = buildStudioV4SourceFamilyAcquisitionReport({
    motionPackReports: hydratedMotionPackReports,
    trustedFootageReport,
    referenceReport,
    directVideoEnrichmentWorkOrder,
    commandPaths: commandPathsFromArgs(args),
  });
  const markdown = renderStudioV4SourceFamilyAcquisitionMarkdown(report);
  await writeReportFiles(args, report, markdown);

  process.stdout.write(args.json ? JSON.stringify(report, null, 2) + "\n" : markdown);
  process.stderr.write(
    `[studio-v4-source-family-acquisition] wrote ${path.relative(ROOT, resolveFromRoot(args.outputJson)).replace(/\\/g, "/")}\n`,
  );
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[studio-v4-source-family-acquisition] ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  hydrateMotionPacksWithCanonicalManifests,
  mergeReferenceReports,
  parseArgs,
  storyIdFilterSet,
  commandPathsFromArgs,
};
