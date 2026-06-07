#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

dotenv.config({ override: true, quiet: true });

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join(ROOT, "output", "goal-contract");

const {
  inspectTokenStatus,
  queryCreatorInfo,
  resolveTokenPath,
} = require("../upload_tiktok");
const {
  buildTikTokReadinessReport,
  buildTikTokCandidateActions,
  buildTikTokPublishPackSet,
  buildTikTokPlatformPreflight,
  buildTikTokDurationVariantReport,
  writeTikTokLiveEnablementArtifacts,
} = require("../lib/platforms/tiktok-live-enablement");

function getArg(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || fallback : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function parseArgs(argv = process.argv.slice(2)) {
  return {
    outDir: getArg(argv, "--out-dir", DEFAULT_OUT),
    dryRunPlanPath: getArg(argv, "--dry-run-plan", path.join(DEFAULT_OUT, "dry_run_publish_plan.json")),
    nextCandidatesPath: getArg(argv, "--next-candidates", path.join(DEFAULT_OUT, "next_publish_candidates.json")),
    platformStatusMatrixPath: getArg(argv, "--platform-status-matrix", path.join(DEFAULT_OUT, "platform_status_matrix.json")),
    noLiveCreatorInfo: hasFlag(argv, "--no-live-creator-info"),
    desiredPrivacyLevel: getArg(argv, "--privacy-level", process.env.TIKTOK_PRIVACY_LEVEL || "PUBLIC_TO_EVERYONE"),
  };
}

async function readJsonIfExists(filePath, fallback = null) {
  try {
    if (filePath && (await fs.pathExists(filePath))) return await fs.readJson(filePath);
  } catch {}
  return fallback;
}

function scopeList(value = "") {
  return String(value || "")
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean)
    .sort();
}

async function inspectTokenFileSafe() {
  const tokenPath = resolveTokenPath();
  const report = {
    path: tokenPath,
    exists: false,
    readable: false,
    json: false,
    access_token_present: false,
    refresh_token_present: false,
    open_id_present: false,
    scope_list: [],
    expires_at: null,
    expires_in_seconds: null,
    refresh_expires_at: null,
    refresh_expires_in_seconds: null,
    error_shape_present: false,
  };
  try {
    report.exists = await fs.pathExists(tokenPath);
    if (!report.exists) return report;
    const data = await fs.readJson(tokenPath);
    report.readable = true;
    report.json = data && typeof data === "object";
    report.access_token_present = typeof data.access_token === "string" && data.access_token.length >= 8;
    report.refresh_token_present = typeof data.refresh_token === "string" && data.refresh_token.length >= 8;
    report.open_id_present = typeof data.open_id === "string" && data.open_id.length > 0;
    report.scope_list = scopeList(data.scope || data.scopes);
    report.expires_at = Number.isFinite(Number(data.expires_at)) ? Number(data.expires_at) : null;
    report.expires_in_seconds =
      report.expires_at == null ? null : Math.round((report.expires_at - Date.now()) / 1000);
    report.refresh_expires_at =
      Number.isFinite(Number(data.refresh_expires_at)) ? Number(data.refresh_expires_at) : null;
    report.refresh_expires_in_seconds =
      report.refresh_expires_at == null
        ? null
        : Math.round((report.refresh_expires_at - Date.now()) / 1000);
    report.error_shape_present = Boolean(data.error || data.error_description);
  } catch (err) {
    report.read_error = err.name || "read_error";
  }
  return report;
}

async function readAccessTokenForCreatorInfoOnly() {
  const tokenPath = resolveTokenPath();
  const data = await fs.readJson(tokenPath);
  if (typeof data.access_token !== "string" || data.access_token.length < 8) {
    throw new Error("local TikTok credential missing");
  }
  return data.access_token;
}

async function maybeQueryCreatorInfo({ tokenStatus, noLiveCreatorInfo }) {
  if (noLiveCreatorInfo) {
    return { ok: false, skipped: true, raw_error_code: "skipped_by_operator_flag" };
  }
  if (tokenStatus?.ok !== true) {
    return { ok: false, skipped: true, raw_error_code: "token_not_valid" };
  }
  try {
    return await queryCreatorInfo({
      accessToken: await readAccessTokenForCreatorInfoOnly(),
    });
  } catch (err) {
    return {
      ok: false,
      http_status: null,
      data: null,
      raw_error_code: err.code || err.name || "creator_info_query_failed",
      raw_error_message: err.message || "creator_info query failed",
    };
  }
}

async function statActionVideo(action = null) {
  if (!action?.video_path) return null;
  const candidates = [
    path.isAbsolute(action.video_path) ? action.video_path : path.join(ROOT, action.video_path),
    action.video_path,
  ];
  for (const candidate of candidates) {
    try {
      if (!(await fs.pathExists(candidate))) continue;
      return (await fs.stat(candidate)).size;
    } catch {}
  }
  return null;
}

async function statActionVideosByStoryId(actions = []) {
  const sizes = new Map();
  for (const action of Array.isArray(actions) ? actions : []) {
    const storyId = action?.story_id || action?.id;
    if (!storyId) continue;
    sizes.set(storyId, await statActionVideo(action));
  }
  return sizes;
}

function findTikTokAction(dryRunPlan = {}) {
  const actions = Array.isArray(dryRunPlan.actions) ? dryRunPlan.actions : [];
  return (
    actions.find((action) => action.platform === "tiktok" && action.action === "would_publish") ||
    actions.find((action) => action.platform === "tiktok" && action.action === "would_queue_when_enabled") ||
    actions.find((action) => action.platform === "tiktok") ||
    null
  );
}

function mergeTikTokPlatformStatusMatrix(existing = {}, preflight = {}) {
  const matrix = existing && typeof existing === "object" ? existing : {};
  return {
    ...matrix,
    schema_version: matrix.schema_version || 1,
    generated_at: new Date().toISOString(),
    platforms: {
      ...(matrix.platforms || {}),
      tiktok: {
        ...(matrix.platforms?.tiktok || {}),
        ...preflight,
        status: preflight.status,
        publish_now_action_count: preflight.publishable_now_count,
        deferred_action_count: preflight.queued_when_enabled_count,
        blocked_action_count: preflight.blocked_count,
      },
    },
  };
}

async function buildTikTokLiveEnablement({ args = parseArgs() } = {}) {
  const [tokenFile, tokenStatus, dryRunPlan, nextCandidatesReport, existingMatrix] = await Promise.all([
    inspectTokenFileSafe(),
    inspectTokenStatus(),
    readJsonIfExists(args.dryRunPlanPath, {}),
    readJsonIfExists(args.nextCandidatesPath, {}),
    readJsonIfExists(args.platformStatusMatrixPath, {}),
  ]);
  const creatorInfo = await maybeQueryCreatorInfo({
    tokenStatus,
    noLiveCreatorInfo: args.noLiveCreatorInfo,
  });
  const readinessReport = buildTikTokReadinessReport({
    env: process.env,
    tokenFile,
    tokenStatus,
    creatorInfo,
    uploadCode: { ok: true },
  });
  const candidateActions = buildTikTokCandidateActions({
    dryRunPlan,
    nextCandidatesReport,
    readiness: readinessReport,
  });
  const videoSizesByStoryId = await statActionVideosByStoryId(candidateActions);
  const publishPack = buildTikTokPublishPackSet({
    readiness: readinessReport,
    actions: candidateActions,
    videoSizesByStoryId,
    desiredPrivacyLevel: args.desiredPrivacyLevel,
  });
  const platformPreflight = buildTikTokPlatformPreflight({
    readiness: readinessReport,
    publishPack,
  });
  const durationVariantReport = buildTikTokDurationVariantReport({
    actions: candidateActions,
    readiness: readinessReport,
  });
  const platformStatusMatrix = mergeTikTokPlatformStatusMatrix(existingMatrix, platformPreflight);
  const testsRunSummary = await readJsonIfExists(path.join(args.outDir, "tests_run_summary.json"), {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    commands: [],
  });
  const artefacts = await writeTikTokLiveEnablementArtifacts({
    outputDir: args.outDir,
    readinessReport,
    publishPack,
    platformPreflight,
    durationVariantReport,
    testsRunSummary,
    platformStatusMatrix,
  });
  return {
    readinessReport,
    publishPack,
    platformPreflight,
    durationVariantReport,
    platformStatusMatrix,
    artefacts,
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const result = await buildTikTokLiveEnablement({ args });
  console.log(`[tiktok-live-enablement] classification=${result.readinessReport.classification}`);
  console.log(`[tiktok-live-enablement] publishable_now=${result.platformPreflight.publishable_now_count}`);
  console.log(`[tiktok-live-enablement] out=${path.relative(ROOT, path.resolve(args.outDir))}`);
  console.log("[tiktok-live-enablement] no OAuth, token mutation, upload or public post");
  return result;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[tiktok-live-enablement] FAILED: ${err.message || err}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildTikTokLiveEnablement,
  findTikTokAction,
  inspectTokenFileSafe,
  main,
  mergeTikTokPlatformStatusMatrix,
  parseArgs,
};
