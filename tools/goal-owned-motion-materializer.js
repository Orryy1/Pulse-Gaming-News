#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  isOwnedGeneratedMotion,
  materializeGoalOwnedMotionClips,
  renderGoalOwnedMotionMaterializationMarkdown,
  writeGoalOwnedMotionMaterializationReport,
} = require("../lib/goal-owned-motion-materializer");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    workOrderPath: path.join(ROOT, "output", "goal-contract", "render_input_work_order.json"),
    storyPackagesPath: null,
    outDir: path.join(ROOT, "output", "goal-contract"),
    root: ROOT,
    generatedAt: null,
    storyIds: [],
    refreshExisting: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--work-order") args.workOrderPath = argv[++i] || args.workOrderPath;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || args.storyPackagesPath;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-id") {
      const value = argv[++i] || "";
      args.storyIds.push(...String(value).split(",").map((item) => item.trim()).filter(Boolean));
    }
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--refresh-existing") args.refreshExisting = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal-owned-motion -- [options]",
    "",
    "Options:",
    "  --work-order <path>   Render input work-order JSON",
    "  --story-packages <path> Governed story-packages JSON to derive missing owned-motion jobs",
    "  --out-dir <dir>       Output directory for materialization report",
    "  --root <dir>          Repo/media root for relative output paths",
    "  --story-id <id>       Optional story id filter; repeatable",
    "  --generated-at <iso>  Fixed timestamp for deterministic reports",
    "  --refresh-existing    Regenerate usable owned/generated clips with current renderer policy",
    "  --dry-run             Plan only; do not invoke ffmpeg or alter story package evidence",
    "  --json                Print JSON report",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function selectedStoryIds(storyIds = []) {
  return new Set(asArray(storyIds).map(cleanText).filter(Boolean));
}

function isOwnedMotionJob(job = {}) {
  return asArray(job.actions).some(
    (action) => cleanText(action.action_id) === "materialise_owned_generated_motion_clips",
  );
}

function mergeJobsByStoryAndAction(jobs = []) {
  const merged = [];
  const seen = new Set();
  for (const job of asArray(jobs)) {
    const actionIds = asArray(job.actions).map((action) => cleanText(action.action_id)).sort().join(",");
    const key = `${cleanText(job.story_id)}:${actionIds}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(job);
  }
  return merged;
}

async function motionEvidenceReady(artifactDir) {
  const materialised = await readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {});
  const familyReport = await readJsonIfPresent(path.join(artifactDir, "distinct_motion_family_report.json"), {});
  const clipCount = Math.max(
    numberOrZero(materialised.clip_count),
    numberOrZero(materialised.summary?.clip_count),
    asArray(materialised.clips).length,
    asArray(materialised.materialised_clips).length,
  );
  const familyCount = Math.max(
    numberOrZero(materialised.distinct_motion_family_count),
    numberOrZero(materialised.summary?.distinct_motion_family_count),
    numberOrZero(familyReport.distinct_motion_family_count),
    numberOrZero(familyReport.summary?.distinct_motion_family_count),
    asArray(materialised.distinct_motion_families).length,
    asArray(familyReport.families).length,
  );
  return materialised.status === "ready" && clipCount >= 5 && familyCount >= 4;
}

async function ownedMotionEvidencePresent(artifactDir) {
  const materialised = await readJsonIfPresent(path.join(artifactDir, "materialised_motion_clips.json"), {});
  const ownedManifest = await readJsonIfPresent(path.join(artifactDir, "owned_motion_manifest.json"), {});
  const footageInventory = await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {});
  const clips = [
    ...asArray(materialised.clips),
    ...asArray(materialised.materialised_clips),
    ...asArray(ownedManifest.assets),
    ...asArray(ownedManifest.materialised_clips),
    ...asArray(footageInventory.motion_inventory?.accepted_local_clips),
    ...asArray(footageInventory.motion_inventory?.production_motion_clips),
  ];
  return clips.some(isOwnedGeneratedMotion);
}

function clipsFromFootageInventory(footage = {}) {
  const clips = [
    ...asArray(footage?.motion_inventory?.accepted_local_clips),
    ...asArray(footage?.motion_inventory?.production_motion_clips),
    ...asArray(footage?.accepted_local_clips),
    ...asArray(footage?.production_motion_clips),
  ];
  const rows = [];
  const seen = new Set();
  for (const clip of clips) {
    const key = cleanText(clip.id || clip.local_materialized_path || clip.path || clip.source_url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push(clip);
  }
  return rows;
}

async function buildDryRunOwnedMotionMaterializationReport(workOrder = {}, {
  generatedAt = new Date().toISOString(),
} = {}) {
  const stories = [];
  for (const job of asArray(workOrder.jobs).filter(isOwnedMotionJob)) {
    const artifactDir = cleanText(job.artifact_dir);
    const footage = await readJsonIfPresent(path.join(artifactDir, "footage_inventory.json"), {});
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
    const plannedClips = clipsFromFootageInventory(footage).filter(isOwnedGeneratedMotion);
    stories.push({
      story_id: cleanText(job.story_id),
      title: cleanText(job.title || canonical.selected_title),
      artifact_dir: artifactDir,
      status: "dry_run_planned",
      planned_clip_count: plannedClips.length,
      planned_clips: plannedClips.map((clip) => ({
        clip_id: cleanText(clip.id),
        path: cleanText(clip.path || clip.local_materialized_path),
        source_family: cleanText(clip.source_family || clip.motion_family),
        source_type: cleanText(clip.source_type),
      })),
      materialized: [],
      existing: [],
      skipped: [],
      failed: [],
    });
  }
  const plannedClipCount = stories.reduce((sum, story) => sum + story.planned_clip_count, 0);
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "OWNED_GENERATED_MOTION_MATERIALIZATION_DRY_RUN",
    dry_run: true,
    summary: {
      source_story_package_count: workOrder.summary?.source_story_package_count || workOrder.source_story_package_count || null,
      story_count: stories.length,
      planned_clip_count: plannedClipCount,
      materialized_clip_count: 0,
      existing_clip_count: 0,
      failed_clip_count: 0,
      skipped_non_owned_clip_count: 0,
    },
    stories,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_external_media_downloads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      no_rights_gate_weakened: true,
      no_story_package_mutation: true,
      no_ffmpeg_invoked: true,
    },
  };
}

async function deriveOwnedMotionWorkOrderFromStoryPackages(storyPackages = [], {
  generatedAt = new Date().toISOString(),
  storyIds = [],
} = {}) {
  const wanted = selectedStoryIds(storyIds);
  const packages = asArray(storyPackages).filter((storyPackage) => {
    const storyId = cleanText(storyPackage.story_id || storyPackage.id);
    return !wanted.size || wanted.has(storyId);
  });
  const jobs = [];
  for (const storyPackage of packages) {
    const storyId = cleanText(storyPackage.story_id || storyPackage.id);
    const artifactDir = cleanText(storyPackage.artifact_dir || storyPackage.output_dir || storyPackage.package_dir);
    if (!storyId || !artifactDir) continue;
    const ready = await motionEvidenceReady(artifactDir);
    if (ready && !(await ownedMotionEvidencePresent(artifactDir))) continue;
    const canonical = await readJsonIfPresent(path.join(artifactDir, "canonical_story_manifest.json"), {});
    jobs.push({
      story_id: storyId,
      title: cleanText(canonical.selected_title || canonical.title || storyPackage.title || storyId),
      artifact_dir: artifactDir,
      status: "blocked_on_render_inputs",
      blockers: ["materialised_motion_clips_missing", "materialised_motion_families_insufficient"],
      actions: [
        {
          action_id: "materialise_owned_generated_motion_clips",
          repair_lane: "owned_generated_explainer_motion_materialisation",
          exact_missing_input: "owned/generated V4 motion support assets",
          required_artefact_path: path.join(artifactDir, "materialised_motion_clips.json"),
          required_artefact_paths: [
            path.join(artifactDir, "materialised_motion_clips.json"),
            path.join(artifactDir, "owned_motion_manifest.json"),
            path.join(artifactDir, "distinct_motion_family_report.json"),
          ],
          recommended_command:
            `npm run ops:goal-owned-motion -- --story-packages output/goal-contract/story-packages.json --out-dir output/goal-04 --story-id ${storyId} --json`,
          expected_output: [
            "materialised_motion_clips.json with owned/generated clips",
            "owned_motion_manifest.json with rights-backed generated motion records",
            "distinct_motion_family_report.json with at least four families",
          ],
          db_mutation_needed: false,
          operator_approval_needed: false,
          post_repair_validation_command:
            "npm run ops:goal-render-inputs -- --out-dir output/goal-contract --json",
        },
      ],
    });
  }
  return {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "LOCAL_OWNED_GENERATED_MOTION_WORK_ORDER",
    source_story_package_count: packages.length,
    summary: {
      source_story_package_count: packages.length,
      owned_motion_materialisation_jobs: jobs.length,
    },
    jobs,
  };
}

async function main(argv = process.argv.slice(2), overrides = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  let workOrder = await readJsonIfPresent(path.resolve(args.workOrderPath));
  if (args.storyPackagesPath) {
    const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
    const derived = await deriveOwnedMotionWorkOrderFromStoryPackages(storyPackages, {
      generatedAt: args.generatedAt || new Date().toISOString(),
      storyIds: args.storyIds,
    });
    const ownedJobs = mergeJobsByStoryAndAction([
      ...asArray(workOrder.jobs).filter(isOwnedMotionJob),
      ...derived.jobs,
    ]);
    workOrder = {
      schema_version: workOrder.schema_version || 1,
      generated_at: derived.generated_at,
      mode: "LOCAL_OWNED_GENERATED_MOTION_WORK_ORDER",
      source_story_package_count: derived.source_story_package_count,
      summary: {
        source_story_package_count: derived.source_story_package_count,
        story_count: ownedJobs.length,
        owned_motion_materialisation_jobs: ownedJobs.length,
        blocked_on_render_inputs_count: ownedJobs.length,
        auto_repairable_jobs: ownedJobs.length,
        operator_required_jobs: 0,
        dead_end_blocker_jobs: 0,
      },
      jobs: ownedJobs,
    };
  }
  if (args.storyIds.length) {
    workOrder.jobs = (workOrder.jobs || []).filter((job) => args.storyIds.includes(String(job.story_id || "")));
  }
  const generatedAt = args.generatedAt || new Date().toISOString();
  const report = args.dryRun
    ? await buildDryRunOwnedMotionMaterializationReport(workOrder, { generatedAt })
    : await materializeGoalOwnedMotionClips({
        root: path.resolve(args.root),
        workOrder,
        generatedAt,
        execFileSync: overrides.execFileSync,
        ffprobeDuration: overrides.ffprobeDuration,
        refreshExisting: args.refreshExisting,
      });
  const written = await writeGoalOwnedMotionMaterializationReport(report, {
    outputDir: path.resolve(args.outDir),
    workOrder,
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoalOwnedMotionMaterializationMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal-owned-motion-materializer] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildDryRunOwnedMotionMaterializationReport,
  deriveOwnedMotionWorkOrderFromStoryPackages,
  main,
  parseArgs,
  usage,
};
