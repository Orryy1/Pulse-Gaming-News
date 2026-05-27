#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildEmpireReadinessAudit,
  renderEmpireReadinessMarkdown,
} = require("../lib/empire-readiness-audit");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT_DIR = path.join(ROOT, "test", "output");
const DEFAULT_RETENTION_BASELINE = path.join(ROOT, "config", "retention-baseline.json");
const DEFAULT_RENDER_HEALTH = path.join(ROOT, "test", "output", "render_health.json");
const DEFAULT_V4_SOURCE_DEFICIT = path.join(ROOT, "test", "output", "studio_v4_source_deficit.json");
const DEFAULT_V4_MOTION_PACKS = path.join(ROOT, "output", "studio-v4", "motion-packs", "visual_v4_motion_packs.json");
const DEFAULT_REVENUE_PATHS = path.join(ROOT, "output", "revenue", "revenue-paths.json");

function resolvePath(value) {
  if (!value) return value;
  return path.isAbsolute(value) ? value : path.resolve(value);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    retentionBaselinePath: DEFAULT_RETENTION_BASELINE,
    renderHealthPath: DEFAULT_RENDER_HEALTH,
    v4SourceDeficitPath: DEFAULT_V4_SOURCE_DEFICIT,
    v4MotionPacksPath: DEFAULT_V4_MOTION_PACKS,
    revenuePathsPath: DEFAULT_REVENUE_PATHS,
    outDir: DEFAULT_OUT_DIR,
    generatedAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--retention-baseline") {
      args.retentionBaselinePath = resolvePath(argv[++i]);
    } else if (arg === "--render-health") {
      args.renderHealthPath = resolvePath(argv[++i]);
    } else if (arg === "--v4-source-deficit") {
      args.v4SourceDeficitPath = resolvePath(argv[++i]);
    } else if (arg === "--v4-motion-packs") {
      args.v4MotionPacksPath = resolvePath(argv[++i]);
    } else if (arg === "--revenue-paths") {
      args.revenuePathsPath = resolvePath(argv[++i]);
    } else if (arg === "--out-dir") {
      args.outDir = resolvePath(argv[++i]);
    } else if (arg === "--generated-at") {
      args.generatedAt = argv[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:empire-readiness -- [options]",
    "",
    "Options:",
    "  --retention-baseline <path>  JSON baseline with Shorts retention stats",
    "  --render-health <path>       Render-health summary JSON",
    "  --v4-source-deficit <path>   Visual V4 source deficit JSON",
    "  --v4-motion-packs <path>     Visual V4 motion pack JSON",
    "  --revenue-paths <path>       Revenue Path Engine digest JSON",
    "  --out-dir <dir>              Output directory",
    "  --generated-at <iso>         Fixed timestamp for tests",
    "  --json                       Print JSON instead of Markdown",
  ].join("\n");
}

async function readJsonMaybe(filePath, fallback = {}) {
  if (!filePath) return fallback;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (err) {
    if (err && err.code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeAudit(audit, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "empire_readiness_audit.json");
  const mdPath = path.join(outDir, "empire_readiness_audit.md");
  const markdown = renderEmpireReadinessMarkdown(audit);
  await fs.writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  await fs.writeFile(mdPath, markdown, "utf8");
  return { jsonPath, mdPath, markdown };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }

  const [
    retentionBaseline,
    renderHealth,
    v4SourceDeficit,
    v4MotionPacks,
    revenuePaths,
  ] = await Promise.all([
    readJsonMaybe(args.retentionBaselinePath, {}),
    readJsonMaybe(args.renderHealthPath, {}),
    readJsonMaybe(args.v4SourceDeficitPath, {}),
    readJsonMaybe(args.v4MotionPacksPath, {}),
    readJsonMaybe(args.revenuePathsPath, {}),
  ]);

  const audit = buildEmpireReadinessAudit({
    generatedAt: args.generatedAt || new Date().toISOString(),
    retentionBaseline,
    renderHealthSummary: renderHealth.summary || renderHealth,
    v4SourceDeficit,
    v4MotionPacks,
    revenuePathDigest: revenuePaths.digest || revenuePaths,
  });
  const artefacts = await writeAudit(audit, args.outDir);

  if (args.json) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    console.log(artefacts.markdown.trimEnd());
  }
  return { audit, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[empire-readiness-audit] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_OUT_DIR,
  parseArgs,
  main,
};
