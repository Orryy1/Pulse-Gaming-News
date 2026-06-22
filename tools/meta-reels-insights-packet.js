#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const Database = require("better-sqlite3");
const axios = require("axios");
require("dotenv").config({ override: true, quiet: true });

const { recordSnapshot } = require("../lib/repositories/platform_metric_snapshots");
const {
  buildMetaInsightsRequest,
  buildMetaReelsInsightsPlan,
  collectMetaReelsInsightSnapshots,
  renderMetaReelsInsightsPlanMarkdown,
} = require("../lib/intelligence/meta-reels-insights");

const ROOT = path.resolve(__dirname, "..");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dbPath: process.env.SQLITE_DB_PATH || process.env.PULSE_DB_PATH || "D:/pulse-data/pulse.db",
    outDir: path.join(ROOT, "output", "analytics", "meta-reels-insights"),
    limit: 100,
    json: false,
    collect: false,
    apply: false,
    graphVersion: process.env.META_GRAPH_VERSION || "v21.0",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db-path") args.dbPath = argv[++index] || args.dbPath;
    else if (arg.startsWith("--db-path=")) args.dbPath = arg.slice("--db-path=".length);
    else if (arg === "--out-dir") args.outDir = path.resolve(ROOT, argv[++index] || args.outDir);
    else if (arg.startsWith("--out-dir=")) args.outDir = path.resolve(ROOT, arg.slice("--out-dir=".length));
    else if (arg === "--limit") args.limit = Number(argv[++index] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length));
    else if (arg === "--collect") args.collect = true;
    else if (arg === "--apply") {
      args.collect = true;
      args.apply = true;
    }
    else if (arg === "--graph-version") args.graphVersion = argv[++index] || args.graphVersion;
    else if (arg.startsWith("--graph-version=")) args.graphVersion = arg.slice("--graph-version=".length);
    else if (arg === "--json") args.json = true;
  }
  if (!Number.isFinite(args.limit) || args.limit < 1) args.limit = 100;
  args.limit = Math.min(500, Math.floor(args.limit));
  return args;
}

function resolveTokenForTarget(target, env = process.env) {
  if (target.platform === "instagram_reels") {
    return env.INSTAGRAM_ACCESS_TOKEN || env.FACEBOOK_PAGE_TOKEN || env.META_ACCESS_TOKEN || "";
  }
  if (target.platform === "facebook_reels") {
    return env.FACEBOOK_PAGE_TOKEN || env.FACEBOOK_PAGE_ACCESS_TOKEN || env.META_ACCESS_TOKEN || "";
  }
  return "";
}

function uniqueMetricNames(target = {}) {
  const names = [];
  for (const value of Object.values(target.metrics || {})) {
    for (const name of Array.isArray(value) ? value : []) {
      if (name && !names.includes(name)) names.push(name);
    }
  }
  return names;
}

function redactError(error) {
  const graphError = error?.response?.data?.error;
  return {
    status: error?.response?.status || null,
    code: graphError?.code || null,
    type: graphError?.type || null,
    message: graphError?.message || error?.message || String(error),
  };
}

function createMetaInsightsFetcher({ graphVersion = "v21.0", env = process.env } = {}) {
  return async function fetchInsights(target) {
    const token = resolveTokenForTarget(target, env);
    if (!token) throw new Error(`${target.platform}_access_token_missing`);
    const metrics = uniqueMetricNames(target);
    if (!metrics.length) throw new Error(`${target.platform}_metric_names_missing`);

    const { url: endpoint } = buildMetaInsightsRequest({ target, graphVersion });
    try {
      const response = await axios.get(endpoint, {
        params: {
          metric: metrics.join(","),
          access_token: token,
        },
        timeout: 20000,
      });
      return response.data;
    } catch (error) {
      // Meta can reject one unsupported metric and fail the whole batch. Fall
      // back to individual metric reads so usable counters still get captured.
      const data = [];
      const failures = [];
      for (const metric of metrics) {
        try {
          const response = await axios.get(endpoint, {
            params: {
              metric,
              access_token: token,
            },
            timeout: 15000,
          });
          data.push(...(Array.isArray(response.data?.data) ? response.data.data : []));
        } catch (metricError) {
          failures.push({ metric, error: redactError(metricError) });
        }
      }
      if (!data.length) {
        const err = new Error(redactError(error).message || "meta_insights_fetch_failed");
        err.response = error.response;
        throw err;
      }
      return { data, partial_failures: failures };
    }
  };
}

async function readMetaPlatformPosts({ dbPath, limit = 100 } = {}) {
  if (!dbPath || !(await fs.pathExists(dbPath))) return [];
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const hasTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='platform_posts'")
      .get();
    if (!hasTable) return [];
    return db
      .prepare(
        `SELECT story_id, channel_id, platform, status, external_id, published_at, created_at, updated_at
         FROM platform_posts
         WHERE platform IN ('instagram_reel', 'instagram_reels', 'facebook_reel', 'facebook_reels')
         ORDER BY COALESCE(published_at, updated_at, created_at) DESC
         LIMIT ?`,
      )
      .all(limit);
  } finally {
    db.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const platformPosts = await readMetaPlatformPosts(args);
  const plan = buildMetaReelsInsightsPlan({ platformPosts });
  let collection = null;
  if (args.collect) {
    let db = null;
    try {
      if (args.apply) db = new Database(args.dbPath);
      collection = await collectMetaReelsInsightSnapshots({
        targets: plan.targets,
        apply: args.apply,
        fetchInsights: createMetaInsightsFetcher({
          graphVersion: args.graphVersion,
        }),
        persistSnapshot: args.apply
          ? (row) => recordSnapshot(db, row)
          : null,
      });
    } finally {
      if (db) db.close();
    }
  }
  await fs.ensureDir(args.outDir);
  const jsonPath = path.join(args.outDir, "meta_reels_insights_plan.json");
  const mdPath = path.join(args.outDir, "meta_reels_insights_plan.md");
  const collectionJsonPath = path.join(args.outDir, "meta_reels_insights_collection.json");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, renderMetaReelsInsightsPlanMarkdown(plan), "utf8");
  if (collection) await fs.writeJson(collectionJsonPath, collection, { spaces: 2 });
  const output = collection ? { plan, collection } : plan;
  if (args.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else {
    process.stdout.write(renderMetaReelsInsightsPlanMarkdown(plan));
    process.stderr.write(`[meta-reels-insights] json=${path.relative(ROOT, jsonPath)}\n`);
    process.stderr.write(`[meta-reels-insights] md=${path.relative(ROOT, mdPath)}\n`);
    if (collection) {
      process.stderr.write(
        `[meta-reels-insights] collection=${path.relative(ROOT, collectionJsonPath)}\n`,
      );
    }
  }
  return { plan, collection, jsonPath, mdPath, collectionJsonPath };
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`[meta-reels-insights] FAILED: ${err.stack || err.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  createMetaInsightsFetcher,
  main,
  parseArgs,
  readMetaPlatformPosts,
  resolveTokenForTarget,
};
