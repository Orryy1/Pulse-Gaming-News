#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: false, quiet: true });
}

const {
  buildGuardedDispatchPreflight,
  renderGuardedDispatchPreflightMarkdown,
  writeGuardedDispatchPreflight,
} = require("../lib/goal-guarded-dispatch-preflight");
const {
  auditGeneratedTranscripts,
  writeTranscriptAudienceAudit,
} = require("../lib/ops/transcript-audience-audit");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    approvalGateReportPath: null,
    strictDryRunPlanPath: null,
    platformStatusMatrixPath: null,
    transcriptAudienceReportPath: null,
    guardedLiveDispatchExecutorReportPath: null,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--approval-gate-report") args.approvalGateReportPath = argv[++i] || "";
    else if (arg === "--strict-dry-run-plan") args.strictDryRunPlanPath = argv[++i] || "";
    else if (arg === "--platform-status-matrix") args.platformStatusMatrixPath = argv[++i] || "";
    else if (arg === "--transcript-audience-report") args.transcriptAudienceReportPath = argv[++i] || "";
    else if (arg === "--guarded-live-dispatch-report" || arg === "--executor-report") {
      args.guardedLiveDispatchExecutorReportPath = argv[++i] || "";
    }
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
    "Usage: npm run ops:goal-guarded-dispatch-preflight -- [options]",
    "",
    "Options:",
    "  --root <dir>                    Workspace root",
    "  --approval-gate-report <path>    human_review_approval_gate_report.json",
    "  --strict-dry-run-plan <path>     dry_run_publish_plan.json",
    "  --platform-status-matrix <path>  platform_status_matrix.json",
    "  --transcript-audience-report <path> transcript_audience_audit.json",
    "  --guarded-live-dispatch-report <path> guarded_live_dispatch_executor_report.json",
    "  --out-dir <dir>                  Output directory",
    "  --generated-at <iso>             Fixed timestamp",
    "  --json                           Print JSON",
    "",
    "Final no-posting preflight for operator-approved HUMAN_REVIEW actions.",
    "This command never publishes, mutates DB rows or touches OAuth/token settings.",
  ].join("\n");
}

async function readJson(filePath, label) {
  if (!await fs.pathExists(filePath)) throw new Error(`${label} not found: ${filePath}`);
  return fs.readJson(filePath);
}

async function readOptionalJson(filePath) {
  if (!filePath || !await fs.pathExists(filePath)) return null;
  return fs.readJson(filePath);
}

function cleanStoryIds(values = []) {
  return Array.from(new Set(
    values
      .map((value) => clean(value))
      .filter(Boolean),
  ));
}

function storyIdsFromStrictDryRunPlan(plan = {}) {
  return cleanStoryIds([
    ...((Array.isArray(plan.actions) ? plan.actions : [])
      .filter((action) => clean(action.action) === "would_publish")
      .map((action) => action.story_id || action.id)),
    ...((Array.isArray(plan.ready_stories) ? plan.ready_stories : [])
      .map((story) => story.story_id || story.id)),
  ]);
}

function transcriptAudienceStoryIds(report = {}) {
  return new Set(cleanStoryIds((Array.isArray(report.stories) ? report.stories : [])
    .map((story) => story.story_id || story.id)));
}

function transcriptAudienceReportCoversStories(report = {}, storyIds = []) {
  const required = cleanStoryIds(storyIds);
  if (!required.length) return true;
  const present = transcriptAudienceStoryIds(report);
  return required.every((storyId) => present.has(storyId));
}

function generatedAtMs(value = {}) {
  const raw = typeof value === "string" ? value : value?.generated_at;
  const ms = Date.parse(clean(raw));
  return Number.isFinite(ms) ? ms : null;
}

function dirOfPath(value = "") {
  const resolved = clean(value);
  return resolved ? path.dirname(resolved) : "";
}

function artifactDirsFromStrictDryRunPlan(plan = {}) {
  const dirs = [];
  const collect = (row = {}) => {
    const candidates = [
      row.artifact_dir,
      dirOfPath(row.canonical_manifest_path),
      dirOfPath(row.platform_publish_manifest_path),
      dirOfPath(row.video_path),
      dirOfPath(row.captions_path),
      dirOfPath(row.cover_frame_source),
      dirOfPath(row.first_frame_source),
    ];
    dirs.push(...candidates);
  };
  for (const action of Array.isArray(plan.actions) ? plan.actions : []) {
    if (clean(action.action) === "would_publish") collect(action);
  }
  for (const story of Array.isArray(plan.ready_stories) ? plan.ready_stories : []) collect(story);
  return Array.from(new Set(dirs.map((dir) => clean(dir)).filter(Boolean)));
}

function pathMatches(left = "", right = "") {
  const normalise = (value) => clean(value).replace(/\\/g, "/").toLowerCase().replace(/\/+$/, "");
  return normalise(left) === normalise(right);
}

function transcriptAudienceReportMatchesCurrentArtifacts(report = {}, plan = {}) {
  const rowsByStory = new Map();
  for (const row of Array.isArray(report.stories) ? report.stories : []) {
    const storyId = clean(row.story_id || row.id);
    if (!storyId) continue;
    if (!rowsByStory.has(storyId)) rowsByStory.set(storyId, []);
    rowsByStory.get(storyId).push(row);
  }
  const dirsByStory = new Map();
  const collect = (row = {}) => {
    const storyId = clean(row.story_id || row.id);
    if (!storyId) return;
    const dirs = [
      row.artifact_dir,
      dirOfPath(row.canonical_manifest_path),
      dirOfPath(row.platform_publish_manifest_path),
      dirOfPath(row.video_path),
      dirOfPath(row.captions_path),
      dirOfPath(row.cover_frame_source),
      dirOfPath(row.first_frame_source),
    ].map((dir) => clean(dir)).filter(Boolean);
    if (!dirs.length) return;
    if (!dirsByStory.has(storyId)) dirsByStory.set(storyId, new Set());
    for (const dir of dirs) dirsByStory.get(storyId).add(dir);
  };
  for (const action of Array.isArray(plan.actions) ? plan.actions : []) {
    if (clean(action.action) === "would_publish") collect(action);
  }
  for (const story of Array.isArray(plan.ready_stories) ? plan.ready_stories : []) collect(story);

  for (const [storyId, currentDirs] of dirsByStory.entries()) {
    const rows = rowsByStory.get(storyId) || [];
    const rowsWithArtifacts = rows.filter((row) => clean(row.artifact_dir));
    if (!rowsWithArtifacts.length) continue;
    const matches = rowsWithArtifacts.some((row) =>
      Array.from(currentDirs).some((dir) => pathMatches(row.artifact_dir, dir)),
    );
    if (!matches) return false;
  }
  return true;
}

function transcriptAudienceReportFreshForStrictDryRun(report = {}, strictDryRunPlan = {}, requiredStoryIds = []) {
  if (!report || !transcriptAudienceReportCoversStories(report, requiredStoryIds)) return false;
  const planGeneratedAt = generatedAtMs(strictDryRunPlan);
  const reportGeneratedAt = generatedAtMs(report);
  if (planGeneratedAt !== null && (reportGeneratedAt === null || reportGeneratedAt < planGeneratedAt)) {
    return false;
  }
  return transcriptAudienceReportMatchesCurrentArtifacts(report, strictDryRunPlan);
}

async function refreshTranscriptAudienceReportForStrictDryRun({ root, strictDryRunPlan, outputPath } = {}) {
  const artifactDirs = artifactDirsFromStrictDryRunPlan(strictDryRunPlan)
    .filter((dir) => fs.existsSync(path.join(dir, "canonical_story_manifest.json")));
  if (!artifactDirs.length) return null;
  const report = await auditGeneratedTranscripts({ root, artifactDirs });
  await writeTranscriptAudienceAudit(report, {
    outputDir: path.dirname(outputPath),
  });
  return report;
}

async function firstExistingJson(paths = [], { requiredStoryIds = [], strictDryRunPlan = null, root = process.cwd() } = {}) {
  const existing = [];
  for (const filePath of paths) {
    if (!filePath || !await fs.pathExists(filePath)) continue;
    const report = await fs.readJson(filePath);
    existing.push(report);
    if (!strictDryRunPlan && transcriptAudienceReportCoversStories(report, requiredStoryIds)) return report;
    if (strictDryRunPlan && transcriptAudienceReportFreshForStrictDryRun(report, strictDryRunPlan, requiredStoryIds)) {
      return report;
    }
  }
  if (strictDryRunPlan && paths[0]) {
    const refreshed = await refreshTranscriptAudienceReportForStrictDryRun({
      root,
      strictDryRunPlan,
      outputPath: paths[0],
    });
    if (refreshed) return refreshed;
  }
  return existing[0] || null;
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function sqliteEvidenceEnabled(env = process.env) {
  return truthy(env.USE_SQLITE) || !!clean(env.SQLITE_DB_PATH);
}

function sqliteTableExists(db, tableName) {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
}

function readPublishedPlatformEvidenceFromSqlite(env = process.env) {
  if (!sqliteEvidenceEnabled(env)) return { rows: [], error: null };
  let dbPath = "";
  try {
    dbPath = require("../lib/db").resolveDbPath();
  } catch (err) {
    return { rows: [], error: `sqlite_path_resolve_failed:${err.message}` };
  }
  if (!dbPath || !fs.existsSync(dbPath)) {
    return { rows: [], error: `sqlite_db_missing:${dbPath || "unknown"}` };
  }

  let sqlite = null;
  try {
    const Database = require("better-sqlite3");
    sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = [];

    if (sqliteTableExists(sqlite, "platform_posts")) {
      rows.push(
        ...sqlite
          .prepare(
            `SELECT story_id, platform, external_id, external_url, status, published_at, updated_at
               FROM platform_posts
              WHERE status = 'published'`,
          )
          .all()
          .map((row) => ({ ...row, evidence_source: "platform_posts" })),
      );
    }

    if (sqliteTableExists(sqlite, "stories")) {
      const storyRows = sqlite
        .prepare(
          `SELECT id, youtube_post_id, youtube_url, instagram_media_id, facebook_post_id,
                  tiktok_post_id, twitter_post_id
             FROM stories`,
        )
        .all();
      for (const row of storyRows) {
        if (clean(row.youtube_post_id)) {
          rows.push({
            story_id: row.id,
            platform: "youtube",
            external_id: row.youtube_post_id,
            external_url: row.youtube_url || null,
            status: "published",
            evidence_source: "stories.youtube_post_id",
          });
        }
        if (clean(row.instagram_media_id)) {
          rows.push({
            story_id: row.id,
            platform: "instagram_reel",
            external_id: row.instagram_media_id,
            status: "published",
            evidence_source: "stories.instagram_media_id",
          });
        }
        if (clean(row.facebook_post_id)) {
          rows.push({
            story_id: row.id,
            platform: "facebook_reel",
            external_id: row.facebook_post_id,
            status: "published",
            evidence_source: "stories.facebook_post_id",
          });
        }
        if (clean(row.tiktok_post_id)) {
          rows.push({
            story_id: row.id,
            platform: "tiktok",
            external_id: row.tiktok_post_id,
            status: "published",
            evidence_source: "stories.tiktok_post_id",
          });
        }
        if (clean(row.twitter_post_id)) {
          rows.push({
            story_id: row.id,
            platform: "twitter_video",
            external_id: row.twitter_post_id,
            status: "published",
            evidence_source: "stories.twitter_post_id",
          });
        }
      }
    }

    return { rows, error: null };
  } catch (err) {
    return { rows: [], error: `sqlite_published_platform_evidence_failed:${err.message}` };
  } finally {
    if (sqlite) sqlite.close();
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return { help: true };
  }
  const root = path.resolve(args.root);
  const approvalGateReportPath = args.approvalGateReportPath
    ? path.resolve(root, args.approvalGateReportPath)
    : path.join(root, "output", "goal-contract", "human_review_approval_gate_report.json");
  const strictDryRunPlanPath = args.strictDryRunPlanPath
    ? path.resolve(root, args.strictDryRunPlanPath)
    : path.join(root, "output", "goal-contract", "dry_run_publish_plan.json");
  const platformStatusMatrixPath = args.platformStatusMatrixPath
    ? path.resolve(root, args.platformStatusMatrixPath)
    : path.join(root, "output", "goal-contract", "platform_status_matrix.json");
  const transcriptAudienceReportPaths = args.transcriptAudienceReportPath
    ? [path.resolve(root, args.transcriptAudienceReportPath)]
    : [
        path.join(root, "output", "goal-contract", "transcript_audience_audit.json"),
        path.join(root, "output", "transcript-audience-audit", "transcript_audience_audit.json"),
      ];
  const guardedLiveDispatchExecutorReportPath = args.guardedLiveDispatchExecutorReportPath
    ? path.resolve(root, args.guardedLiveDispatchExecutorReportPath)
    : path.join(root, "output", "goal-contract", "guarded_live_dispatch_executor_report.json");

  const strictDryRunPlan = await readJson(strictDryRunPlanPath, "strict dry-run plan");
  const publishedEvidence = readPublishedPlatformEvidenceFromSqlite();
  const report = buildGuardedDispatchPreflight({
    approvalGateReport: await readJson(approvalGateReportPath, "human review approval gate report"),
    strictDryRunPlan,
    platformStatusMatrix: await readJson(platformStatusMatrixPath, "platform status matrix"),
    transcriptAudienceReport: args.transcriptAudienceReportPath
      ? await readOptionalJson(transcriptAudienceReportPaths[0])
      : await firstExistingJson(transcriptAudienceReportPaths, {
        requiredStoryIds: storyIdsFromStrictDryRunPlan(strictDryRunPlan),
        strictDryRunPlan,
        root,
      }),
    guardedLiveDispatchExecutorReport: await readOptionalJson(guardedLiveDispatchExecutorReportPath),
    publishedPlatformEvidence: publishedEvidence.rows,
    publishedPlatformEvidenceError: publishedEvidence.error,
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGuardedDispatchPreflight(report, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else console.log(renderGuardedDispatchPreflightMarkdown(report).trimEnd());
  return { report, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-guarded-dispatch-preflight] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  firstExistingJson,
  artifactDirsFromStrictDryRunPlan,
  main,
  parseArgs,
  readPublishedPlatformEvidenceFromSqlite,
  storyIdsFromStrictDryRunPlan,
  transcriptAudienceReportCoversStories,
  transcriptAudienceReportFreshForStrictDryRun,
};
