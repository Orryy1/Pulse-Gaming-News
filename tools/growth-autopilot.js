#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ quiet: true });
const {
  buildGrowthAutopilotPlan,
  writeGrowthAutopilotArtefacts,
} = require("../lib/ops/growth-autopilot");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "growth-autopilot");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    snapshotPath: null,
    outDir: DEFAULT_OUT,
    generatedAt: null,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--snapshot" && argv[i + 1]) args.snapshotPath = argv[++i];
    else if (arg.startsWith("--snapshot=")) args.snapshotPath = arg.slice(11);
    else if (arg === "--out-dir" && argv[i + 1]) args.outDir = argv[++i];
    else if (arg.startsWith("--out-dir=")) args.outDir = arg.slice(10);
    else if (arg === "--generated-at" && argv[i + 1]) args.generatedAt = argv[++i];
    else if (arg.startsWith("--generated-at=")) args.generatedAt = arg.slice(15);
    else if (arg === "--json") args.json = true;
  }
  return args;
}

async function readJsonIfPresent(filePath, fallback = {}) {
  if (!filePath || !(await fs.pathExists(filePath))) return fallback;
  return fs.readJson(filePath);
}

function mondayUtc(date) {
  const value = new Date(date);
  const day = value.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  value.setUTCDate(value.getUTCDate() + offset);
  value.setUTCHours(0, 0, 0, 0);
  return value.toISOString().slice(0, 10);
}

function median(values = []) {
  const numbers = values
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  return numbers.length % 2
    ? numbers[middle]
    : (numbers[middle - 1] + numbers[middle]) / 2;
}

function buildPublishedYouTubeSnapshot(rows = [], {
  now = new Date().toISOString(),
} = {}) {
  const validRows = rows
    .map((row) => ({
      published_at: row.published_at || row.updated_at || row.created_at || null,
      views: Number.isFinite(Number(row.views)) ? Number(row.views) : 0,
    }))
    .filter((row) => Number.isFinite(Date.parse(row.published_at)))
    .sort((a, b) => Date.parse(a.published_at) - Date.parse(b.published_at));
  const since28d = Date.parse(now) - 28 * 86400000;
  const cohorts = new Map();
  for (const row of validRows) {
    const weekStart = mondayUtc(row.published_at);
    if (!cohorts.has(weekStart)) cohorts.set(weekStart, []);
    cohorts.get(weekStart).push(row.views);
  }
  return {
    latest_post_at: validRows.at(-1)?.published_at || null,
    views_28d: validRows
      .filter((row) => Date.parse(row.published_at) >= since28d)
      .reduce((sum, row) => sum + row.views, 0),
    weekly_cohorts: [...cohorts.entries()].map(([weekStart, views]) => ({
      week_start: weekStart,
      posts: views.length,
      views: views.reduce((sum, value) => sum + value, 0),
      median_views: median(views),
      subscribers_gained: null,
    })),
  };
}

function readLivePublishedYouTubeSnapshot({ now } = {}) {
  let sqlite = null;
  try {
    const dbModule = require("../lib/db");
    const dbPath =
      process.env.SQLITE_DB_PATH ||
      process.env.PULSE_DB_PATH ||
      dbModule.DB_PATH ||
      dbModule.resolveDbPath();
    if (!dbPath || !fs.existsSync(dbPath)) return null;
    const Database = require("better-sqlite3");
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    const exists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_posts'")
      .get();
    if (!exists) return null;
    const rows = sqlite.prepare(`
      SELECT
        p.published_at,
        p.created_at,
        p.updated_at,
        COALESCE(NULLIF(p.views, 0), s.youtube_views, 0) AS views
      FROM platform_posts p
      LEFT JOIN stories s ON s.id = p.story_id
      WHERE p.platform IN ('youtube', 'youtube_short', 'youtube_shorts')
        AND p.published_at IS NOT NULL
        AND p.external_id IS NOT NULL
        AND p.external_id NOT LIKE 'DUPE_%'
      ORDER BY p.published_at ASC
      LIMIT 1000
    `).all();
    return {
      ...buildPublishedYouTubeSnapshot(rows, { now }),
      db_path: dbPath,
      row_count: rows.length,
    };
  } catch {
    return null;
  } finally {
    if (sqlite) sqlite.close();
  }
}

function reportIsFresh(generatedAt, now, maxAgeHours = 6) {
  const ageMs = Date.parse(now) - Date.parse(generatedAt);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeHours * 3600000;
}

async function buildDefaultSnapshot({ generatedAt } = {}) {
  const now = generatedAt || new Date().toISOString();
  const normalOps = await readJsonIfPresent(
    path.join(ROOT, "output", "normal-operations", "normal_operations_report.json"),
  );
  const feedback = await readJsonIfPresent(
    path.join(ROOT, "output", "autonomous-feedback-monitor", "autonomous_feedback_report.json"),
  );
  const postWindow =
    normalOps.layers?.post_window_verification ||
    await readJsonIfPresent(
      path.join(ROOT, "output", "normal-operations", "post_window_verification.json"),
    );
  const candidateBuffer =
    normalOps.layers?.candidate_buffer ||
    await readJsonIfPresent(
      path.join(ROOT, "output", "normal-operations", "candidate_buffer_report.json"),
    );
  const platformPerformance =
    normalOps.layers?.platform_performance ||
    await readJsonIfPresent(
      path.join(ROOT, "output", "normal-operations", "platform_performance_report.json"),
    );
  const youtube =
    platformPerformance.platforms?.youtube_shorts ||
    platformPerformance.youtube_shorts ||
    {};
  const livePublished = readLivePublishedYouTubeSnapshot({ now });
  const normalOpsFresh = reportIsFresh(normalOps.generated_at, now);
  const feedbackFresh = reportIsFresh(feedback.generated_at, now);
  const evidenceFresh = normalOpsFresh || feedbackFresh;

  return {
    generated_at: now,
    channel_id: "pulse-gaming",
    channel: {
      latest_post_at:
        livePublished?.latest_post_at ||
        postWindow.latest_public_post?.published_at ||
        null,
      views_28d: livePublished?.views_28d ?? youtube.views_28d ?? null,
      subscribers: youtube.subscribers ?? null,
      watch_hours_28d: youtube.watch_hours_28d ?? null,
    },
    weekly_cohorts: asWeeklyCohorts(
      livePublished?.weekly_cohorts?.length
        ? livePublished.weekly_cohorts
        : youtube.weekly_cohorts || platformPerformance.weekly_cohorts || [],
    ),
    pipeline: {
      scheduler_candidate_count: evidenceFresh
        ? candidateBuffer.counts?.ready_candidates ??
          feedback.candidate_supply?.ready_candidates ??
          0
        : 0,
      publish_readiness: evidenceFresh
        ? normalOps.layers?.publish_readiness ||
          feedback.publish_readiness ||
          { verdict: "RED", blockers: ["publish_readiness_evidence_missing"] }
        : { verdict: "RED", blockers: ["publish_readiness_evidence_stale"] },
      control_tower:
        evidenceFresh
          ? normalOps.layers?.control_tower ||
            feedback.control_tower ||
            { verdict: "RED" }
          : { verdict: "RED", blockers: ["control_tower_evidence_stale"] },
      platforms: {
        youtube: { enabled: true },
        x: {
          enabled:
            normalOps.layers?.platform_health?.enabled_publish_platforms?.includes("x") === true,
        },
      },
    },
    evidence: {
      source: "existing_governed_reports",
      normal_operations_generated_at: normalOps.generated_at || null,
      autonomous_feedback_generated_at: feedback.generated_at || null,
      governed_reports_fresh: evidenceFresh,
      live_publication_rows: livePublished?.row_count ?? null,
    },
  };
}

function asWeeklyCohorts(value) {
  return Array.isArray(value) ? value : [];
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const snapshot = args.snapshotPath
    ? await fs.readJson(path.resolve(ROOT, args.snapshotPath))
    : await buildDefaultSnapshot({ generatedAt: args.generatedAt });
  if (args.generatedAt) snapshot.generated_at = args.generatedAt;
  const report = buildGrowthAutopilotPlan(snapshot);
  const outDir = path.resolve(ROOT, args.outDir);
  const files = await writeGrowthAutopilotArtefacts({ report, outDir });
  if (args.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else {
    console.log(`[growth-autopilot] phase=${report.growth_phase}`);
    console.log(`[growth-autopilot] execution=${report.execution_status}`);
    console.log(`[growth-autopilot] next=${report.next_action}`);
    console.log(`[growth-autopilot] report=${path.relative(ROOT, files.report_json)}`);
  }
  return { report, files };
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[growth-autopilot] FAILED: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildDefaultSnapshot,
  buildPublishedYouTubeSnapshot,
  readLivePublishedYouTubeSnapshot,
  main,
  parseArgs,
};
