#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_STORY_PACKAGES = path.join(ROOT, "output", "goal-contract", "production_cutover_story_packages.json");
const DEFAULT_REPAIR_TEMPLATE = path.join(ROOT, "output", "goal-contract", "visual_v4_canonical_entity_repair_template_remaining.json");
const DEFAULT_OUT_DIR = path.join(ROOT, "output", "goal-contract");

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return typeof value === "object" ? [value] : [];
}

function storyIdFrom(value = {}) {
  return cleanText(value.story_id || value.storyId || value.id);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackages: DEFAULT_STORY_PACKAGES,
    repairTemplate: DEFAULT_REPAIR_TEMPLATE,
    outDir: DEFAULT_OUT_DIR,
    storyIds: [],
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--story-packages") args.storyPackages = argv[++i] || args.storyPackages;
    else if (arg === "--repair-template" || arg === "--canonical-entity-repair-template") {
      args.repairTemplate = argv[++i] || args.repairTemplate;
    } else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--story-id" || arg === "--story") args.storyIds.push(argv[++i] || "");
    else if (arg === "--story-ids" || arg === "--stories") {
      args.storyIds.push(...String(argv[++i] || "").split(","));
    } else if (arg.startsWith("--story-id=")) {
      args.storyIds.push(arg.slice("--story-id=".length));
    } else if (arg.startsWith("--story-ids=")) {
      args.storyIds.push(...arg.slice("--story-ids=".length).split(","));
    } else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.storyIds = args.storyIds.map(cleanText).filter(Boolean);
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:v4-apply-canonical-entity-repairs -- [options]",
    "",
    "Options:",
    "  --story-packages <path>              Story package array to update",
    "  --repair-template <path>             Canonical entity repair template",
    "  --out-dir <dir>                      Output directory for apply report",
    "  --story-id <id>                      Apply one story id; repeatable",
    "  --story-ids <ids>                    Comma-separated story ids",
    "  --generated-at <iso>                 Fixed timestamp",
    "  --json                               Print JSON",
    "",
    "Local-only: updates package manifests and writes an audit report. It does not fetch media, publish, mutate DB, or touch credentials.",
  ].join("\n");
}

function resolveFromRoot(filePath, root = ROOT) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
}

function storyPackagesFrom(raw) {
  if (Array.isArray(raw)) return raw;
  return asArray(raw.packages || raw.story_packages || raw.stories || raw.items);
}

function repairEntriesFrom(raw) {
  if (Array.isArray(raw)) return raw;
  return asArray(raw.entries || raw.repairs || raw.items || raw.canonical_entity_repair_template?.entries);
}

function manifestPathForPackage(pkg = {}, root = ROOT) {
  const explicit = cleanText(
    pkg.canonical_story_manifest_path ||
      pkg.canonicalStoryManifestPath ||
      pkg.manifest_path ||
      pkg.manifestPath,
  );
  if (explicit) return resolveFromRoot(explicit, root);
  const artifactDir = cleanText(pkg.artifact_dir || pkg.artifactDir || pkg.artefact_dir);
  if (!artifactDir) return null;
  return path.join(resolveFromRoot(artifactDir, root), "canonical_story_manifest.json");
}

function applyRepairToManifest(manifest = {}, entry = {}, generatedAt = new Date().toISOString()) {
  const suggested = cleanText(entry.suggested_repaired_entity || entry.repaired_entity || entry.entity);
  if (!suggested) {
    return {
      manifest,
      changed: false,
      blockers: ["canonical_entity_repair_missing_suggested_entity"],
    };
  }
  const before = {
    canonical_subject: cleanText(manifest.canonical_subject),
    canonical_game: cleanText(manifest.canonical_game),
  };
  const updated = {
    ...manifest,
    canonical_subject: suggested,
    canonical_game: suggested,
    canonical_entity_repaired_at: generatedAt,
    canonical_entity_repair: {
      applied_at: generatedAt,
      repair_lane: cleanText(entry.repair_lane || "canonical_entity_repair"),
      previous_canonical_subject: before.canonical_subject,
      previous_canonical_game: before.canonical_game,
      suggested_repaired_entity: suggested,
      blockers: asArray(entry.blockers).map(cleanText).filter(Boolean),
      source: "visual_v4_canonical_entity_repair_template",
    },
  };
  return {
    manifest: updated,
    changed: before.canonical_subject !== suggested || before.canonical_game !== suggested,
    blockers: [],
  };
}

async function applyCanonicalEntityRepairs({
  root = ROOT,
  storyPackagesPath = DEFAULT_STORY_PACKAGES,
  repairTemplatePath = DEFAULT_REPAIR_TEMPLATE,
  outDir = DEFAULT_OUT_DIR,
  storyIds = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const storyPackagesFile = resolveFromRoot(storyPackagesPath, root);
  const repairTemplateFile = resolveFromRoot(repairTemplatePath, root);
  const rawStoryPackages = await fs.readJson(storyPackagesFile);
  const storyPackages = storyPackagesFrom(rawStoryPackages);
  const rawRepairTemplate = await fs.readJson(repairTemplateFile);
  const allowed = new Set(storyIds.map(cleanText).filter(Boolean));
  const repairs = repairEntriesFrom(rawRepairTemplate)
    .filter((entry) => storyIdFrom(entry))
    .filter((entry) => !allowed.size || allowed.has(storyIdFrom(entry)));
  const packagesById = new Map(storyPackages.map((pkg) => [storyIdFrom(pkg), pkg]));
  const changed = [];
  const unchanged = [];
  const blocked = [];

  for (const entry of repairs) {
    const storyId = storyIdFrom(entry);
    const pkg = packagesById.get(storyId);
    if (!pkg) {
      blocked.push({
        story_id: storyId,
        status: "blocked",
        blockers: ["story_package_missing"],
      });
      continue;
    }
    const manifestPath = manifestPathForPackage(pkg, root);
    if (!manifestPath || !(await fs.pathExists(manifestPath))) {
      blocked.push({
        story_id: storyId,
        status: "blocked",
        blockers: ["canonical_story_manifest_missing"],
        manifest_path: manifestPath,
      });
      continue;
    }

    const manifest = await fs.readJson(manifestPath);
    const result = applyRepairToManifest(manifest, entry, generatedAt);
    if (result.blockers.length) {
      blocked.push({
        story_id: storyId,
        status: "blocked",
        blockers: result.blockers,
        manifest_path: manifestPath,
      });
      continue;
    }

    await fs.writeJson(manifestPath, result.manifest, { spaces: 2 });
    pkg.canonical_subject = result.manifest.canonical_subject;
    pkg.canonical_game = result.manifest.canonical_game;
    pkg.canonical_entity_repaired_at = generatedAt;
    pkg.canonical_entity_repair = result.manifest.canonical_entity_repair;
    const item = {
      story_id: storyId,
      title: cleanText(result.manifest.selected_title || result.manifest.title || pkg.title),
      manifest_path: manifestPath,
      canonical_subject: result.manifest.canonical_subject,
      canonical_game: result.manifest.canonical_game,
      previous_canonical_subject: result.manifest.canonical_entity_repair.previous_canonical_subject,
      previous_canonical_game: result.manifest.canonical_entity_repair.previous_canonical_game,
      status: result.changed ? "changed" : "already_repaired",
    };
    if (result.changed) changed.push(item);
    else unchanged.push(item);
  }

  await fs.writeJson(storyPackagesFile, Array.isArray(rawStoryPackages)
    ? storyPackages
    : { ...rawStoryPackages, packages: storyPackages }, { spaces: 2 });

  const report = {
    schema_version: 1,
    generated_at: generatedAt,
    mode: "VISUAL_V4_CANONICAL_ENTITY_REPAIR_APPLY",
    summary: {
      repair_template_entry_count: repairs.length,
      changed_count: changed.length,
      unchanged_count: unchanged.length,
      blocked_count: blocked.length,
    },
    changed,
    unchanged,
    blocked,
    safety: {
      no_publish_triggered: true,
      no_network_uploads: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
      package_manifests_updated_only: true,
    },
  };
  const resolvedOutDir = resolveFromRoot(outDir, root);
  await fs.ensureDir(resolvedOutDir);
  await fs.writeJson(path.join(resolvedOutDir, "canonical_entity_repair_apply_report.json"), report, { spaces: 2 });
  return report;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const report = await applyCanonicalEntityRepairs({
    storyPackagesPath: args.storyPackages,
    repairTemplatePath: args.repairTemplate,
    outDir: args.outDir,
    storyIds: args.storyIds,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      [
        "# Visual V4 Canonical Entity Repair Apply",
        "",
        `Changed: ${report.summary.changed_count}`,
        `Unchanged: ${report.summary.unchanged_count}`,
        `Blocked: ${report.summary.blocked_count}`,
        "",
        "No publishing, DB mutation, network upload or credential change was performed.",
      ].join("\n"),
    );
  }
  return report;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[studio-v4-apply-canonical-entity-repairs] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  applyRepairToManifest,
  applyCanonicalEntityRepairs,
  storyPackagesFrom,
  repairEntriesFrom,
};
