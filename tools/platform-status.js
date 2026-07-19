"use strict";

const fs = require("fs-extra");
const path = require("node:path");
const {
  buildPlatformOperationalConfig,
  buildPlatformStatus,
  renderPlatformStatusMarkdown,
} = require("../lib/ops/platform-status");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:platform:status -- [options]",
    "",
    "Options:",
    "  --help, -h  Show this help without loading credentials or opening SQLite",
  ].join("\n");
}

async function readJsonIfExists(filePath) {
  try {
    if (!(await fs.pathExists(filePath))) return null;
    return await fs.readJson(filePath);
  } catch {
    return null;
  }
}

async function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  if (args.help) {
    (deps.stdout || process.stdout).write(`${usage()}\n`);
    return { help: true };
  }
  (deps.dotenv || require("dotenv")).config({ override: true, quiet: true });
  await fs.ensureDir(OUT);
  const db = deps.db || require("../lib/db");
  const stories = await db.getStories();
  let platformPosts = [];
  try {
    if (db.useSqlite()) {
      platformPosts = db
        .getDb()
        .prepare("SELECT * FROM platform_posts ORDER BY updated_at DESC, id DESC LIMIT 200")
        .all();
    }
  } catch {
    platformPosts = [];
  }
  const report = buildPlatformStatus({
    stories,
    platformPosts,
    platformConfig: buildPlatformOperationalConfig(deps.env || process.env),
    platformReadinessDoctor: await readJsonIfExists(path.join(OUT, "platform_readiness_doctor.json")),
  });
  const jsonPath = path.join(OUT, "platform_status.json");
  const mdPath = path.join(OUT, "platform_status.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderPlatformStatusMarkdown(report), "utf8");
  console.log(`[platform-status] stories=${report.storyCount}`);
  console.log(`[platform-status] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[platform-status] md=${path.relative(ROOT, mdPath)}`);
  return { report, jsonPath, mdPath };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  parseArgs,
  usage,
};
