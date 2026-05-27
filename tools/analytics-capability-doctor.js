#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true });

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "test", "output");
const TOKEN_PATH = path.join(ROOT, "tokens", "youtube_token.json");

const {
  inspectYouTubeTokenShape,
  buildAnalyticsCapabilityReport,
  renderAnalyticsCapabilityMarkdown,
} = require("../lib/intelligence/analytics-capability");

async function readTokenStatus() {
  if (await fs.pathExists(TOKEN_PATH)) {
    try {
      const token = await fs.readJson(TOKEN_PATH);
      return inspectYouTubeTokenShape(token);
    } catch {
      return inspectYouTubeTokenShape(null);
    }
  }
  if (process.env.YOUTUBE_REFRESH_TOKEN) {
    return {
      exists: true,
      has_access_token: false,
      has_refresh_token: true,
      expiry_status: "unknown",
      yt_analytics_scope: "unknown",
    };
  }
  return inspectYouTubeTokenShape(null);
}

async function uploadScopeRequested() {
  try {
    const text = await fs.readFile(path.join(ROOT, "upload_youtube.js"), "utf8");
    return text.includes("https://www.googleapis.com/auth/yt-analytics.readonly");
  } catch {
    return false;
  }
}

function readDbSignals() {
  const signals = {
    platform_metric_rows: 0,
    rich_retention_rows: 0,
    video_performance_rows: 0,
  };
  let dbPath = null;
  try {
    dbPath = require("../lib/db").resolveDbPath();
  } catch {
    return signals;
  }
  if (!dbPath || !fs.existsSync(dbPath)) return signals;

  let db;
  try {
    const Database = require("better-sqlite3");
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const row = db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN retention_percent IS NOT NULL OR watch_time_seconds IS NOT NULL THEN 1 ELSE 0 END) AS rich
           FROM platform_metric_snapshots`,
        )
        .get();
      signals.platform_metric_rows = Number(row?.total || 0);
      signals.rich_retention_rows = Number(row?.rich || 0);
    } catch {
      /* migration may not be present locally */
    }
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS total
           FROM video_performance_snapshots
           WHERE average_percentage_viewed IS NOT NULL
              OR watch_time_seconds IS NOT NULL`,
        )
        .get();
      signals.video_performance_rows = Number(row?.total || 0);
    } catch {
      /* migration may not be present locally */
    }
  } catch {
    return signals;
  } finally {
    if (db) db.close();
  }
  return signals;
}

async function main() {
  await fs.ensureDir(OUT_DIR);
  const tokenStatus = await readTokenStatus();
  const report = buildAnalyticsCapabilityReport({
    env: process.env,
    tokenStatus,
    dbSignals: readDbSignals(),
    uploadScopeRequested: await uploadScopeRequested(),
  });
  const jsonPath = path.join(OUT_DIR, "analytics_capability_doctor.json");
  const mdPath = path.join(OUT_DIR, "analytics_capability_doctor.md");
  await fs.writeJson(jsonPath, report, { spaces: 2 });
  await fs.writeFile(mdPath, renderAnalyticsCapabilityMarkdown(report), "utf8");
  console.log(`[analytics-doctor] verdict=${report.verdict}`);
  console.log(`[analytics-doctor] detailed=${report.capabilities.detailed_youtube_analytics.status}`);
  console.log(`[analytics-doctor] dataset=${report.capabilities.learning_dataset.status}`);
  console.log(`[analytics-doctor] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[analytics-doctor] json=${path.relative(ROOT, jsonPath)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[analytics-doctor] FAILED: ${err.message}`);
    process.exit(1);
  });
}

module.exports = {
  readDbSignals,
  readTokenStatus,
  uploadScopeRequested,
  main,
};
