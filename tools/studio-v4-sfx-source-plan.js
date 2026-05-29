#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildCreatorStudioSfxSourcingPlan,
} = require("../lib/studio/v4/sfx-source-registry");

const ROOT = path.resolve(__dirname, "..");

const DEFAULT_CUES = [
  { id: "hook_hit", family: "impact" },
  { id: "motion_whoosh", family: "whoosh" },
  { id: "source_tick", family: "source_tick" },
  { id: "chart_tick", family: "chart_tick" },
  { id: "retention_transition", family: "transition_hit" },
  { id: "low_end_stop", family: "sub_hit" },
  { id: "glitch_cut", family: "glitch" },
];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: ROOT,
    sfxManifestPath: null,
    ingestReportPath: null,
    installedAssetsPath: null,
    rightsLedgerPath: null,
    defaultEvidence: true,
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--sfx-manifest") args.sfxManifestPath = argv[++i] || null;
    else if (arg === "--ingest-report") args.ingestReportPath = argv[++i] || null;
    else if (arg === "--installed-assets") args.installedAssetsPath = argv[++i] || null;
    else if (arg === "--rights-ledger") args.rightsLedgerPath = argv[++i] || null;
    else if (arg === "--no-default-evidence") args.defaultEvidence = false;
    else if (arg === "--out-dir") args.outDir = argv[++i] || args.outDir;
    else if (arg === "--generated-at") args.generatedAt = argv[++i] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/studio-v4-sfx-source-plan.js [options]",
    "",
    "Builds a local-only SFX sourcing plan for Visual V4. It does not download assets, publish, mutate DB rows or touch OAuth.",
    "",
    "Options:",
    "  --root <dir>              Workspace root for default evidence files",
    "  --sfx-manifest <path>     Optional manifest containing existing planned cues",
    "  --ingest-report <path>    Optional SFX library ingest report with asset inventory and rights ledger",
    "  --installed-assets <path>  Optional installed asset inventory JSON",
    "  --rights-ledger <path>     Optional rights ledger JSON for installed assets",
    "  --no-default-evidence     Do not auto-load output/goal-contract SFX evidence",
    "  --out-dir <dir>",
    "  --generated-at <iso>",
    "  --json",
  ].join("\n");
}

async function cuesFromManifest(filePath) {
  if (!filePath) return DEFAULT_CUES;
  const manifest = await fs.readJson(path.resolve(filePath));
  const cues = Array.isArray(manifest.cues)
    ? manifest.cues
    : Array.isArray(manifest.sfx?.cues)
      ? manifest.sfx.cues
      : [];
  return cues.length ? cues : DEFAULT_CUES;
}

function arrayFromReport(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function ledgerRecordsFrom(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value.records)) return value.records;
  if (Array.isArray(value.assets)) return value.assets;
  if (Array.isArray(value.rights_records)) return value.rights_records;
  return [];
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || ""));
}

function resolveInputPath(root, filePath) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(root || ROOT, filePath);
}

function defaultEvidencePaths(root) {
  const goalDir = path.join(path.resolve(root || ROOT), "output", "goal-contract");
  return {
    ingestReportPath: path.join(goalDir, "sfx_library_ingest_report.json"),
    installedAssetsPath: path.join(goalDir, "sfx_asset_inventory.json"),
    rightsLedgerPath: path.join(goalDir, "sfx_rights_ledger.json"),
  };
}

async function readJsonIfPresent(filePath, root = ROOT) {
  if (!filePath) return null;
  const resolved = resolveInputPath(root, filePath);
  if (!await fs.pathExists(resolved)) return null;
  return fs.readJson(resolved);
}

async function installedEvidenceFromArgs(args = {}) {
  const root = path.resolve(args.root || ROOT);
  const useDefaults = args.defaultEvidence !== false && !truthy(process.env.PULSE_SKIP_DEFAULT_SFX_EVIDENCE);
  const defaults = useDefaults ? defaultEvidencePaths(root) : {};
  const ingestReportPath = args.ingestReportPath || defaults.ingestReportPath;
  const installedAssetsPath = args.installedAssetsPath || defaults.installedAssetsPath;
  const rightsLedgerPath = args.rightsLedgerPath || defaults.rightsLedgerPath;
  const evidenceSources = [];
  const ingestReport = await readJsonIfPresent(ingestReportPath, root);
  if (ingestReport) evidenceSources.push(path.basename(resolveInputPath(root, ingestReportPath)));
  const installedAssetsInput = await readJsonIfPresent(installedAssetsPath, root);
  if (installedAssetsInput) evidenceSources.push(path.basename(resolveInputPath(root, installedAssetsPath)));
  const rightsLedgerInput = await readJsonIfPresent(rightsLedgerPath, root);
  if (rightsLedgerInput) evidenceSources.push(path.basename(resolveInputPath(root, rightsLedgerPath)));

  const installedAssets = [
    ...arrayFromReport(ingestReport, ["asset_inventory", "installed_assets", "assets"]),
    ...arrayFromReport(installedAssetsInput, ["asset_inventory", "installed_assets", "assets"]),
  ];
  const rightsLedger = [
    ...ledgerRecordsFrom(ingestReport?.rights_ledger),
    ...ledgerRecordsFrom(rightsLedgerInput),
  ];

  return { installedAssets, rightsLedger, evidenceSources: Array.from(new Set(evidenceSources)) };
}

function renderMarkdown(plan = {}) {
  const lines = [];
  lines.push("# Visual V4 SFX Source Plan");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at || ""}`);
  lines.push(`Readiness: ${plan.readiness?.status || "unknown"}`);
  if (plan.readiness?.blockers?.length) {
    lines.push(`Blockers: ${plan.readiness.blockers.join(", ")}`);
  }
  lines.push("");
  lines.push("## Required roles");
  for (const role of plan.required_roles || []) lines.push(`- ${role}`);
  lines.push("");
  lines.push("## Recommended sources");
  for (const source of plan.recommended_sources || []) {
    lines.push(
      `- ${source.name}: ${source.matching_roles.join(", ")}. Licence evidence: ${source.licence_evidence_url}`,
    );
  }
  if (plan.selected_assets?.length) {
    lines.push("");
    lines.push("## Installed licensed assets");
    for (const asset of plan.selected_assets || []) {
      lines.push(`- ${asset.role}: ${asset.provider_name} (${asset.asset_id})`);
    }
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- No downloads were started.");
  lines.push("- No publishing APIs were called.");
  lines.push("- No database rows were mutated.");
  lines.push("- No OAuth or token settings were changed.");
  return `${lines.join("\n")}\n`;
}

async function writePlan(plan = {}, { outDir } = {}) {
  const resolvedOut = path.resolve(outDir);
  await fs.ensureDir(resolvedOut);
  const jsonPath = path.join(resolvedOut, "sfx_source_plan.json");
  const markdownPath = path.join(resolvedOut, "sfx_source_plan.md");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(markdownPath, renderMarkdown(plan), "utf8");
  return { outputDir: resolvedOut, jsonPath, markdownPath };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root || ROOT);
  const cues = await cuesFromManifest(args.sfxManifestPath ? resolveInputPath(root, args.sfxManifestPath) : null);
  const { installedAssets, rightsLedger, evidenceSources } = await installedEvidenceFromArgs({ ...args, root });
  const plan = buildCreatorStudioSfxSourcingPlan({
    cues,
    installedAssets,
    rightsLedger,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  plan.evidence_sources = evidenceSources;
  const outputs = await writePlan(plan, { outDir: args.outDir });
  if (args.json) console.log(JSON.stringify({ plan, outputs }, null, 2));
  else {
    console.log(`SFX source plan: ${plan.readiness.status}`);
    console.log(`Output: ${outputs.outputDir}`);
    console.log("Safety: local-only planner, no downloads, no publish, no DB mutation, no OAuth changes.");
  }
  return { plan, outputs };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[studio-v4-sfx-source-plan] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_CUES,
  installedEvidenceFromArgs,
  parseArgs,
  renderMarkdown,
  main,
};
