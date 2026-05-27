#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGoal23SecuritySecretsDeploymentSafety,
  renderGoal23SecuritySecretsDeploymentSafetyMarkdown,
  writeGoal23SecuritySecretsDeploymentSafety,
} = require("../lib/goal23-security-secrets-deployment-safety");

const ROOT = path.resolve(__dirname, "..");

const DEFAULT_SOURCE_ROOTS = [
  "lib",
  "tools",
  "server.js",
  "run.js",
  "publisher.js",
  "processor.js",
  "audio.js",
  "assemble.js",
  "upload_youtube.js",
  "upload_tiktok.js",
  "upload_instagram.js",
  "upload_facebook.js",
  "upload_twitter.js",
  "src",
];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamRegistryReportPath: path.join(ROOT, "output", "goal-22", "goal22_readiness_report.json"),
    dryRunPlanPath: path.join(ROOT, "output", "goal-contract", "dry_run_publish_plan.json"),
    outDir: path.join(ROOT, "output", "goal-23"),
    workspaceRoot: ROOT,
    sourceRoots: [],
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-registry-report") args.upstreamRegistryReportPath = argv[++index] || args.upstreamRegistryReportPath;
    else if (arg === "--dry-run-plan") args.dryRunPlanPath = argv[++index] || args.dryRunPlanPath;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--source-root") args.sourceRoots.push(argv[++index]);
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal23-security-secrets-deployment-safety -- [options]",
    "",
    "Options:",
    "  --story-packages <path>             Story package manifest",
    "  --upstream-registry-report <path>   Goal 22 readiness report",
    "  --dry-run-plan <path>               Strict dry-run publish plan",
    "  --out-dir <dir>                     Output directory for Goal 23 proof",
    "  --workspace <dir>                   Workspace root for relative paths",
    "  --source-root <path>                Source root to scan; repeatable",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON report",
    "",
    "LOCAL_PROOF only. This command scans source files with redacted findings and compiles security, secrets scan and deployment safety artefacts from existing proof files. It does not load .env, inspect tokens, publish, post externally, mutate production rows or change OAuth/token state.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

async function readTextIfPresent(filePath) {
  if (!filePath || !(await fs.pathExists(filePath))) return "";
  return fs.readFile(filePath, "utf8");
}

function containsAll(text, words = []) {
  const lower = String(text || "").toLowerCase();
  return words.every((word) => lower.includes(word));
}

async function deriveSecuritySnapshot(workspaceRoot, dryRunPlan = {}) {
  const agentsText = await readTextIfPresent(path.join(workspaceRoot, "AGENTS.md"));
  const cutoverText = await readTextIfPresent(path.join(workspaceRoot, "docs", "production-cutover-playbook.md"));
  const securityText = await readTextIfPresent(path.join(workspaceRoot, "docs", "security-deployment-safety.md"));
  const packageText = await readTextIfPresent(path.join(workspaceRoot, "package.json"));
  const oauthText = [
    "upload_youtube.js",
    "upload_tiktok.js",
    "upload_instagram.js",
    "upload_facebook.js",
    "upload_twitter.js",
  ].map((file) => readTextIfPresent(path.join(workspaceRoot, file)));
  const uploadText = (await Promise.all(oauthText)).join("\n");
  const controlText = `${agentsText}\n${cutoverText}\n${securityText}`;
  const combined = `${controlText}\n${packageText}\n${uploadText}`;
  const rotationDays = Number((controlText.match(/token rotation[^.\n]*?(\d{1,3})\s*days/i) || [])[1]);

  return {
    scoped_oauth: containsAll(uploadText, ["scope"]) || (containsAll(agentsText, ["oauth"]) && containsAll(agentsText, ["scope"])),
    token_rotation_plan: containsAll(controlText, ["token rotation"]) ? { present: true, rotation_days: Number.isFinite(rotationDays) ? rotationDays : null } : null,
    environment_separation: containsAll(combined, ["local_proof"]) && containsAll(combined, ["dry_run_publish"]),
    least_privilege: containsAll(combined, ["least privilege"]),
    local_dev_prod_modes:
      containsAll(combined, ["local_proof"]) &&
      containsAll(combined, ["dry_run_publish"]) &&
      packageText.includes('"dev"') &&
      packageText.includes('"start"'),
    dry_run_publishing: String(dryRunPlan.mode || "").toUpperCase() === "DRY_RUN_PUBLISH",
    queue_approval: containsAll(combined, ["human_review"]) || containsAll(combined, ["queue approval"]),
    emergency_kill_switch: containsAll(combined, ["kill switch"]),
    retry_logging: containsAll(combined, ["retry"]) && containsAll(combined, ["logging"]),
    audit_trail: await fs.pathExists(path.join(workspaceRoot, "output", "goal-22", "production_audit_log.json")),
    rollback_path: containsAll(controlText, ["rollback"]) || await fs.pathExists(path.join(workspaceRoot, "docs", "production-cutover-playbook.md")),
    safe_api_handling: containsAll(combined, ["safe api"]) || containsAll(combined, ["no live publishing"]),
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const workspaceRoot = path.resolve(args.workspaceRoot);
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const upstreamRegistryReport = await readJsonIfPresent(path.resolve(args.upstreamRegistryReportPath), {});
  const dryRunPlan = await readJsonIfPresent(path.resolve(args.dryRunPlanPath), {});
  const sourceRoots = args.sourceRoots.length ? args.sourceRoots : DEFAULT_SOURCE_ROOTS;
  const securitySnapshot = await deriveSecuritySnapshot(workspaceRoot, dryRunPlan);
  const report = await buildGoal23SecuritySecretsDeploymentSafety({
    storyPackages,
    upstreamRegistryReport,
    workspaceRoot,
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
    securitySnapshot,
    sourceRoots,
    dryRunPlan,
  });
  const written = await writeGoal23SecuritySecretsDeploymentSafety(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal23SecuritySecretsDeploymentSafetyMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal23-security-secrets-deployment-safety] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_SOURCE_ROOTS,
  deriveSecuritySnapshot,
  main,
  parseArgs,
  usage,
};
