#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const {
  buildStudioEnterpriseOSPack,
  renderStudioEnterpriseOSMarkdown,
  writeStudioEnterpriseOSArtifacts,
} = require("../lib/studio-enterprise-os");
const {
  loadGoldStandardReferenceLibrary,
} = require("../lib/gold-standard-reference-library");

function resolvePath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(ROOT, value);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storiesPath: path.join(ROOT, "daily_news.json"),
    retentionBaselinePath: path.join(ROOT, "config", "retention-baseline.json"),
    revenuePathsPath: path.join(ROOT, "output", "revenue", "revenue-paths.json"),
    commercialLearningPath: path.join(ROOT, "output", "commercial", "commercial-learning.json"),
    commentsPath: path.join(ROOT, "output", "comments", "comment-digest.json"),
    renderHealthPath: path.join(ROOT, "test", "output", "render_health.json"),
    v4SourceDeficitPath: path.join(ROOT, "test", "output", "studio_v4_source_deficit.json"),
    v4MotionPacksPath: path.join(ROOT, "output", "studio-v4", "motion-packs", "visual_v4_motion_packs.json"),
    goldStandardsPath: process.env.GOLD_STANDARDS_REFERENCE_LIBRARY || null,
    costSnapshotPath: path.join(ROOT, "output", "enterprise-os", "cost-snapshot.json"),
    securitySnapshotPath: path.join(ROOT, "output", "enterprise-os", "security-snapshot.json"),
    governanceSummaryPath: path.join(ROOT, "output", "governance", "publish_manifest.json"),
    outDir: path.join(ROOT, "output", "enterprise-os"),
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--stories") args.storiesPath = resolvePath(argv[++i]);
    else if (arg === "--retention-baseline") args.retentionBaselinePath = resolvePath(argv[++i]);
    else if (arg === "--revenue-paths") args.revenuePathsPath = resolvePath(argv[++i]);
    else if (arg === "--commercial-learning") args.commercialLearningPath = resolvePath(argv[++i]);
    else if (arg === "--comments") args.commentsPath = resolvePath(argv[++i]);
    else if (arg === "--render-health") args.renderHealthPath = resolvePath(argv[++i]);
    else if (arg === "--v4-source-deficit") args.v4SourceDeficitPath = resolvePath(argv[++i]);
    else if (arg === "--v4-motion-packs") args.v4MotionPacksPath = resolvePath(argv[++i]);
    else if (arg === "--gold-standards") args.goldStandardsPath = resolvePath(argv[++i]);
    else if (arg === "--cost-snapshot") args.costSnapshotPath = resolvePath(argv[++i]);
    else if (arg === "--security-snapshot") args.securitySnapshotPath = resolvePath(argv[++i]);
    else if (arg === "--governance-summary") args.governanceSummaryPath = resolvePath(argv[++i]);
    else if (arg === "--out-dir") args.outDir = resolvePath(argv[++i]);
    else if (arg === "--generated-at") args.generatedAt = argv[++i];
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:studio-enterprise-os -- [options]",
    "",
    "Options:",
    "  --stories <path>             Story JSON file",
    "  --retention-baseline <path>  Retention baseline JSON",
    "  --revenue-paths <path>       Revenue Path Engine digest JSON",
    "  --commercial-learning <path> Commercial learning digest JSON",
    "  --comments <path>            Comment digest JSON",
    "  --render-health <path>       Render health summary JSON",
    "  --v4-source-deficit <path>   Visual V4 source deficit JSON",
    "  --v4-motion-packs <path>     Visual V4 motion pack JSON",
    "  --gold-standards <path>      Gold standards workbook or JSON",
    "  --cost-snapshot <path>       Cost snapshot JSON",
    "  --security-snapshot <path>   Security snapshot JSON",
    "  --governance-summary <path>  Latest Studio Governance summary JSON",
    "  --out-dir <dir>              Output directory",
    "  --generated-at <iso>         Fixed timestamp for tests",
    "  --json                       Print JSON instead of Markdown",
  ].join("\n");
}

async function readJsonMaybe(filePath, fallback = {}) {
  if (!filePath) return fallback;
  try {
    return await fs.readJson(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

function defaultSecuritySnapshot() {
  return {
    api_token_present: Boolean(process.env.API_TOKEN),
    hardcoded_secret_findings: [],
    env_separation: process.env.NODE_ENV || "local",
    token_rotation_days: null,
    audit_log_enabled: true,
    emergency_kill_switch: true,
    rollback_renderer_available: true,
  };
}

async function loadGoldStandards(filePath) {
  if (!filePath) {
    try {
      return loadGoldStandardReferenceLibrary();
    } catch {
      return {};
    }
  }
  if (/\.json$/i.test(filePath)) return readJsonMaybe(filePath, {});
  try {
    return loadGoldStandardReferenceLibrary({ workbookPath: filePath });
  } catch {
    return {};
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const [
    storiesRaw,
    retentionBaseline,
    revenuePathRaw,
    commercialLearningDigest,
    commentsDigest,
    renderHealthRaw,
    v4SourceDeficit,
    v4MotionPacks,
    goldStandardLibrary,
    costSnapshot,
    securitySnapshotRaw,
    governanceSummaryRaw,
  ] = await Promise.all([
    readJsonMaybe(args.storiesPath, []),
    readJsonMaybe(args.retentionBaselinePath, {}),
    readJsonMaybe(args.revenuePathsPath, {}),
    readJsonMaybe(args.commercialLearningPath, {}),
    readJsonMaybe(args.commentsPath, {}),
    readJsonMaybe(args.renderHealthPath, {}),
    readJsonMaybe(args.v4SourceDeficitPath, {}),
    readJsonMaybe(args.v4MotionPacksPath, {}),
    loadGoldStandards(args.goldStandardsPath),
    readJsonMaybe(args.costSnapshotPath, {}),
    readJsonMaybe(args.securitySnapshotPath, defaultSecuritySnapshot()),
    readJsonMaybe(args.governanceSummaryPath, {}),
  ]);

  const stories = Array.isArray(storiesRaw) ? storiesRaw : [];
  const revenuePathDigest = revenuePathRaw.digest || revenuePathRaw;
  const renderHealthSummary = renderHealthRaw.summary || renderHealthRaw;
  const governanceSummary = governanceSummaryRaw.publish_control_tower || governanceSummaryRaw;
  const securitySnapshot = {
    ...defaultSecuritySnapshot(),
    ...(securitySnapshotRaw || {}),
  };

  const pack = buildStudioEnterpriseOSPack({
    generatedAt: args.generatedAt || new Date().toISOString(),
    stories,
    retentionBaseline,
    revenuePathDigest,
    commercialLearningDigest,
    commentsDigest,
    renderHealthSummary,
    v4SourceDeficit,
    v4MotionPacks,
    goldStandardLibrary,
    costSnapshot,
    securitySnapshot,
    governanceSummary,
  });
  const artefacts = await writeStudioEnterpriseOSArtifacts(pack, { outputDir: args.outDir });

  if (args.json) console.log(JSON.stringify(pack, null, 2));
  else console.log(renderStudioEnterpriseOSMarkdown(pack).trimEnd());
  return { pack, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[studio-enterprise-os] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  main,
  readJsonMaybe,
};
