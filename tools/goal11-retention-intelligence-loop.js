#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const Database = require("better-sqlite3");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: true });
}

const {
  buildGoal11RetentionIntelligenceLoop,
  renderGoal11RetentionIntelligenceLoopMarkdown,
  writeGoal11RetentionIntelligenceLoop,
} = require("../lib/goal11-retention-intelligence-loop");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    storyPackagesPath: path.join(ROOT, "output", "goal-contract", "story-packages.json"),
    upstreamBenchmarkReportPath: path.join(ROOT, "output", "goal-10", "goal10_readiness_report.json"),
    metricsPath: path.join(ROOT, "output", "analytics", "retention_metrics.json"),
    outDir: path.join(ROOT, "output", "goal-11"),
    workspaceRoot: ROOT,
    dbPath: process.env.SQLITE_DB_PATH || process.env.PULSE_DB_PATH || "D:/pulse-data/pulse.db",
    useDbSnapshots: true,
    dbSnapshotsLimit: 200,
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--story-packages") args.storyPackagesPath = argv[++index] || args.storyPackagesPath;
    else if (arg === "--upstream-benchmark-report") args.upstreamBenchmarkReportPath = argv[++index] || args.upstreamBenchmarkReportPath;
    else if (arg === "--metrics") args.metricsPath = argv[++index] || args.metricsPath;
    else if (arg === "--db-path") args.dbPath = argv[++index] || args.dbPath;
    else if (arg === "--db-snapshots-limit") args.dbSnapshotsLimit = Number(argv[++index] || args.dbSnapshotsLimit);
    else if (arg === "--no-db-snapshots") args.useDbSnapshots = false;
    else if (arg === "--out-dir") args.outDir = argv[++index] || args.outDir;
    else if (arg === "--workspace") args.workspaceRoot = argv[++index] || args.workspaceRoot;
    else if (arg === "--generated-at") args.generatedAt = argv[++index] || null;
    else if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    "Usage: npm run ops:goal11-retention-intelligence -- [options]",
    "",
    "Options:",
    "  --story-packages <path>             Story package manifest",
    "  --upstream-benchmark-report <path>  Goal 10 readiness report",
    "  --metrics <path>                    Local read-only retention metrics manifest",
    "  --db-path <path>                    SQLite DB for read-only shallow snapshot fallback",
    "  --db-snapshots-limit <n>            Max shallow snapshot rows to read when metrics manifest is absent",
    "  --no-db-snapshots                   Disable read-only DB snapshot fallback",
    "  --out-dir <dir>                     Output directory for Goal 11 proof",
    "  --workspace <dir>                   Workspace root for relative package paths",
    "  --generated-at <iso>                Fixed timestamp for deterministic reports",
    "  --json                              Print JSON report",
    "",
    "LOCAL_PROOF only. This command reads local package evidence, optional local metrics manifests and optional read-only SQLite platform snapshots. It does not call analytics APIs, publish, post, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

async function readJsonIfPresent(filePath, fallback) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function buildMetricsManifestFromSnapshotRows(rows = [], { generatedAt = new Date().toISOString() } = {}) {
  return {
    schema_version: 1,
    source: "sqlite_platform_metric_snapshots_read_only",
    generated_at: generatedAt,
    stories: rows
      .filter((row) => row && row.story_id)
      .map((row) => ({
        story_id: row.story_id,
        title: row.title || null,
        platform: row.platform || null,
        video_id: row.external_id || row.video_id || null,
        views: row.views == null ? null : Number(row.views),
        likes: row.likes == null ? null : Number(row.likes),
        comments: row.comments == null ? null : Number(row.comments),
        shares: row.shares == null ? null : Number(row.shares),
        average_view_duration_seconds:
          row.watch_time_seconds == null ? null : Number(row.watch_time_seconds),
        retention_percent: row.retention_percent == null ? null : Number(row.retention_percent),
        snapshot_at: row.snapshot_at || null,
        partial_metrics_only: true,
        analytics_depth: "shallow_platform_snapshot",
      })),
    safety: {
      read_only_db_snapshot: true,
      raw_json_omitted: true,
      no_analytics_api_call: true,
      no_db_mutation: true,
      no_oauth_or_token_change: true,
    },
  };
}

async function readSnapshotMetricsFromDb({ dbPath, limit = 200, generatedAt = new Date().toISOString() } = {}) {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(Number(limit) || 200)));
  if (!dbPath || !(await fs.pathExists(dbPath))) {
    return buildMetricsManifestFromSnapshotRows([], { generatedAt });
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_metric_snapshots'").get();
    if (!hasTable) return buildMetricsManifestFromSnapshotRows([], { generatedAt });
    const rows = db.prepare(`
      SELECT
        p.story_id,
        p.platform,
        p.external_id,
        p.snapshot_at,
        p.views,
        p.likes,
        p.comments,
        p.shares,
        p.watch_time_seconds,
        p.retention_percent,
        s.title
      FROM platform_metric_snapshots p
      LEFT JOIN stories s ON s.id = p.story_id
      JOIN (
        SELECT story_id, platform, MAX(snapshot_at) AS latest_snapshot_at
        FROM platform_metric_snapshots
        WHERE story_id IS NOT NULL AND story_id != ''
        GROUP BY story_id, platform
      ) latest
        ON latest.story_id = p.story_id
       AND latest.platform = p.platform
       AND latest.latest_snapshot_at = p.snapshot_at
      ORDER BY p.snapshot_at DESC
      LIMIT ?
    `).all(safeLimit);
    return buildMetricsManifestFromSnapshotRows(rows, { generatedAt });
  } finally {
    db.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const storyPackages = await readJsonIfPresent(path.resolve(args.storyPackagesPath), []);
  const upstreamBenchmarkReport = await readJsonIfPresent(path.resolve(args.upstreamBenchmarkReportPath), {});
  const metricsPath = path.resolve(args.metricsPath);
  const metricsManifest = (await fs.pathExists(metricsPath))
    ? await readJsonIfPresent(metricsPath, { stories: [] })
    : args.useDbSnapshots
      ? await readSnapshotMetricsFromDb({
          dbPath: args.dbPath,
          limit: args.dbSnapshotsLimit,
          generatedAt: args.generatedAt || new Date().toISOString(),
        })
      : { stories: [] };
  const report = await buildGoal11RetentionIntelligenceLoop({
    storyPackages,
    upstreamBenchmarkReport,
    metricsManifest,
    workspaceRoot: path.resolve(args.workspaceRoot),
    outputDir: path.resolve(args.outDir),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const written = await writeGoal11RetentionIntelligenceLoop(report, {
    outputDir: path.resolve(args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGoal11RetentionIntelligenceLoopMarkdown(report).trimEnd());
  return { report, written };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[goal11-retention-intelligence-loop] FAILED: ${error.stack || error.message}`);
    process.exit(1);
  });
}

module.exports = {
  buildMetricsManifestFromSnapshotRows,
  main,
  parseArgs,
  readSnapshotMetricsFromDb,
  usage,
};
