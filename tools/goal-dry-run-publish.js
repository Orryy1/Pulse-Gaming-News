#!/usr/bin/env node
"use strict";

const path = require("node:path");
const fs = require("fs-extra");

if (!/^(true|1|yes|on)$/i.test(String(process.env.PULSE_SKIP_DOTENV || ""))) {
  require("dotenv").config({ override: false, quiet: true });
}

const {
  buildGoalDryRunPublishPlan,
  normalizePlatformKey,
  renderGoalDryRunPublishPlanMarkdown,
  writeGoalDryRunPublishPlan,
} = require("../lib/goal-dry-run-publisher");
const { buildPlatformOperationalConfig } = require("../lib/ops/platform-status");
const { canonicalHash } = require("../lib/services/url-canonical");
const { titleTopicKey } = require("../lib/services/publish-dedupe");

const CANDIDATE_REPORT_BRIDGE_WRITE_SKEW_MS = 10_000;
const DEFAULT_STORY_PACKAGE_SOURCES = [
  {
    name: "production_cutover",
    priority: 3,
    relativePath: ["output", "goal-contract", "production_cutover_story_packages.json"],
  },
  {
    name: "scheduler_bridge",
    priority: 2,
    relativePath: ["output", "goal-contract", "scheduler_bridge_candidates.json"],
  },
  {
    name: "story_packages",
    priority: 1,
    relativePath: ["output", "goal-contract", "story-packages.json"],
  },
];

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    root: process.cwd(),
    storyPackagesPath: null,
    candidateReportPath: path.join(process.cwd(), "output", "goal-contract", "next_publish_candidates.json"),
    platformStatusPath: null,
    repairWorkOrderPath: null,
    antiSpamReportPath: null,
    publishedPlatformEvidencePath: null,
    guardedLiveDispatchExecutorReportPath: null,
    guardedLiveDispatchExecutorReportDefaultEnabled: true,
    motionPackRoot: null,
    requireSchedulerPreflight: true,
    outDir: path.join(process.cwd(), "output", "goal-contract"),
    generatedAt: null,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") args.root = argv[++i] || args.root;
    else if (arg === "--story-packages") args.storyPackagesPath = argv[++i] || "";
    else if (arg === "--candidate-report" || arg === "--preflight-report") {
      args.candidateReportPath = argv[++i] || "";
    }
    else if (arg === "--platform-status") args.platformStatusPath = argv[++i] || "";
    else if (arg === "--repair-work-order") args.repairWorkOrderPath = argv[++i] || "";
    else if (arg === "--anti-spam-report") args.antiSpamReportPath = argv[++i] || "";
    else if (arg === "--published-platform-evidence") args.publishedPlatformEvidencePath = argv[++i] || "";
    else if (arg === "--guarded-live-dispatch-report" || arg === "--executor-report") {
      args.guardedLiveDispatchExecutorReportPath = argv[++i] || "";
      args.guardedLiveDispatchExecutorReportDefaultEnabled = true;
    }
    else if (arg === "--no-guarded-live-dispatch-report" || arg === "--no-executor-report") {
      args.guardedLiveDispatchExecutorReportPath = null;
      args.guardedLiveDispatchExecutorReportDefaultEnabled = false;
    }
    else if (arg === "--motion-pack-root") args.motionPackRoot = argv[++i] || "";
    else if (arg === "--no-scheduler-preflight") args.requireSchedulerPreflight = false;
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
    "Usage: npm run ops:goal-dry-run-publish -- [options]",
    "",
    "Options:",
    "  --root <dir>              Workspace root",
    "  --story-packages <path>   Story package manifest",
    "  --candidate-report <path> Scheduler next-publish preflight report",
    "  --platform-status <path>  Platform operational status report",
    "  --repair-work-order <path> Render input repair work order",
    "  --anti-spam-report <path>  Goal20 anti-spam readiness report",
    "  --published-platform-evidence <path> Optional read-only published platform evidence JSON",
    "  --guarded-live-dispatch-report <path> Prior guarded executor report for terminal duplicate holds",
    "  --no-guarded-live-dispatch-report Ignore prior guarded executor report",
    "  --motion-pack-root <dir>  Story-scoped V4 motion pack manifest directory",
    "  --no-scheduler-preflight  Diagnostic mode only; do not require scheduler preflight evidence",
    "  --out-dir <dir>           Output directory",
    "  --generated-at <iso>      Fixed timestamp",
    "  --json                    Print JSON",
    "",
    "Dry-run only. Does not publish, mutate DB rows or touch OAuth/token settings.",
  ].join("\n");
}

function storyPackagesFromJson(value, filePath) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    if (Array.isArray(value.story_packages)) return value.story_packages;
    if (Array.isArray(value.packages)) return value.packages;
    if (Array.isArray(value.candidates)) return value.candidates;
  }
  throw new Error(`story package file is not an array: ${filePath}`);
}

function normalizeVerdictToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function storyPackageVerdictTokens(storyPackage = {}) {
  return [
    storyPackage.verdict,
    storyPackage.status,
    storyPackage.publish_status,
    storyPackage.readiness_status,
    storyPackage.publish_verdict?.verdict,
    storyPackage.publish_verdict?.status,
    storyPackage.platform_publish_manifest?.verdict,
    storyPackage.platform_publish_manifest?.status,
    storyPackage.platform_publish_manifest?.publish_status,
    storyPackage.scheduler_preflight_qa?.status,
  ].map(normalizeVerdictToken).filter(Boolean);
}

function storyPackageLooksReady(storyPackage = {}) {
  const tokens = storyPackageVerdictTokens(storyPackage);
  if (tokens.some((token) => ["green", "pass", "passed", "ready", "publish_ready"].includes(token))) {
    return true;
  }
  if (storyPackage.publish_verdict?.can_auto_publish === true) return true;
  if (storyPackage.platform_publish_manifest?.can_auto_publish === true) return true;
  return false;
}

function storyPackageLooksBlocked(storyPackage = {}) {
  const tokens = storyPackageVerdictTokens(storyPackage);
  if (tokens.some((token) => ["red", "fail", "failed", "blocked", "held", "hard_stop"].includes(token))) {
    return true;
  }
  if (Array.isArray(storyPackage.blockers) && storyPackage.blockers.length > 0) return true;
  if (Array.isArray(storyPackage.reason_codes) && storyPackage.reason_codes.length > 0) return true;
  if (Array.isArray(storyPackage.publish_verdict?.reason_codes) && storyPackage.publish_verdict.reason_codes.length > 0) {
    return true;
  }
  return false;
}

function isAllRedGenericStoryPackageSource(source = {}) {
  return source.name === "story_packages" &&
    Array.isArray(source.packages) &&
    source.packages.length > 0 &&
    source.packages.every((storyPackage) => (
      !storyPackageLooksReady(storyPackage) &&
      storyPackageLooksBlocked(storyPackage)
    ));
}

async function readStoryPackageSource(filePath, priority = 0, name = null) {
  const value = await fs.readJson(filePath);
  return {
    name,
    filePath,
    packages: storyPackagesFromJson(value, filePath),
    generatedAtMs: await reportGeneratedAtMs(value, filePath),
    priority,
  };
}

async function readStoryPackages(root, explicitPath = null) {
  if (explicitPath) {
    const filePath = path.resolve(root, explicitPath);
    if (!(await fs.pathExists(filePath))) throw new Error(`story package file not found: ${filePath}`);
    return (await readStoryPackageSource(filePath)).packages;
  }

  const candidates = DEFAULT_STORY_PACKAGE_SOURCES.map((source) => ({
    ...source,
    filePath: path.join(root, ...source.relativePath),
  }));
  const usableSources = [];
  for (const candidate of candidates) {
    if (!(await fs.pathExists(candidate.filePath))) continue;
    usableSources.push(await readStoryPackageSource(candidate.filePath, candidate.priority, candidate.name));
  }
  if (!usableSources.length) throw new Error(`story package file not found: ${candidates[0].filePath}`);
  const hasAlternativeSource = usableSources.some((source) => source.name !== "story_packages");
  const selectableSources = hasAlternativeSource
    ? usableSources.filter((source) => !isAllRedGenericStoryPackageSource(source))
    : usableSources;
  selectableSources.sort((a, b) => {
    const aMs = a.generatedAtMs ?? -Infinity;
    const bMs = b.generatedAtMs ?? -Infinity;
    if (aMs !== bMs) return bMs - aMs;
    return b.priority - a.priority;
  });
  return selectableSources[0].packages;
}

async function readCandidateReport(root, explicitPath = null) {
  const explicit = Boolean(explicitPath);
  const candidates = explicit
    ? [path.resolve(root, explicitPath)]
    : [
        path.join(root, "output", "goal-contract", "next_publish_candidates.json"),
        path.join(root, "test", "output", "next_publish_candidates.json"),
      ];
  const usableReports = [];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    const report = await fs.readJson(filePath);
    if (explicit) return report;
    if (!explicit && candidateReportIsStoryFiltered(report)) continue;
    if (!explicit && await candidateReportIsStaleAgainstBridge(root, report, filePath)) continue;
    usableReports.push({
      report,
      filePath,
      generatedAtMs: await reportGeneratedAtMs(report, filePath),
      productionPriority: filePath.includes(`${path.sep}output${path.sep}goal-contract${path.sep}`) ? 1 : 0,
    });
  }
  if (!usableReports.length) return null;
  usableReports.sort((a, b) => {
    const aMs = a.generatedAtMs ?? -Infinity;
    const bMs = b.generatedAtMs ?? -Infinity;
    if (aMs !== bMs) return bMs - aMs;
    return b.productionPriority - a.productionPriority;
  });
  return usableReports[0].report;
}

function candidateReportIsStoryFiltered(report = {}) {
  if (!report || typeof report !== "object") return false;
  if (report.story_filter && typeof report.story_filter === "object") return true;
  if (report.story_preflight?.enabled === true && Array.isArray(report.candidates)) {
    const storyId = String(report.story_preflight.story_id || "").trim();
    return Boolean(storyId) && report.candidates.every((candidate) => String(candidate?.id || "") === storyId);
  }
  return false;
}

function parseTimeMs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : null;
}

async function reportGeneratedAtMs(report = {}, filePath = "") {
  const generatedAt = parseTimeMs(report.generated_at || report.generatedAt);
  if (generatedAt != null) return generatedAt;
  try {
    const stat = await fs.stat(filePath);
    return Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : null;
  } catch {
    return null;
  }
}

async function candidateReportIsStaleAgainstBridge(root, report = {}, filePath = "") {
  const bridgePath = path.join(root, "output", "goal-contract", "scheduler_bridge_candidates.json");
  if (!(await fs.pathExists(bridgePath))) return false;
  const bridge = await fs.readJson(bridgePath).catch(() => null);
  const bridgeGeneratedAt = await reportGeneratedAtMs(bridge, bridgePath);
  if (bridgeGeneratedAt == null) return false;
  const reportGeneratedAt = await reportGeneratedAtMs(report, filePath);
  if (reportGeneratedAt == null) return false;
  return reportGeneratedAt + CANDIDATE_REPORT_BRIDGE_WRITE_SKEW_MS < bridgeGeneratedAt;
}

async function readPlatformOperationalConfig(root, explicitPath = null) {
  if (explicitPath) {
    const filePath = path.resolve(root, explicitPath);
    if (!(await fs.pathExists(filePath))) return null;
    const report = await fs.readJson(filePath);
    return report.operational ||
      report.platform_operational_config ||
      platformStatusMatrixToOperational(report) ||
      platformReadinessDoctorToOperational(report) ||
      null;
  }
  let operational = null;
  const statusCandidates = [
    path.join(root, "test", "output", "platform_status.json"),
    path.join(root, "output", "goal-contract", "platform_status.json"),
    path.join(root, "output", "goal-contract", "platform_status_matrix.json"),
  ];
  for (const filePath of statusCandidates) {
    if (!(await fs.pathExists(filePath))) continue;
    const report = await fs.readJson(filePath);
    operational = report.operational ||
      report.platform_operational_config ||
      platformStatusMatrixToOperational(report) ||
      null;
    if (operational) break;
  }
  operational = operational || buildPlatformOperationalConfig(process.env);

  const doctorCandidates = [
    path.join(root, "test", "output", "platform_readiness_doctor.json"),
    path.join(root, "output", "goal-contract", "platform_readiness_doctor.json"),
  ];
  for (const filePath of doctorCandidates) {
    if (!(await fs.pathExists(filePath))) continue;
    const doctorOperational = platformReadinessDoctorToOperational(await fs.readJson(filePath));
    if (doctorOperational) {
      operational = mergePlatformOperationalConfig(operational, doctorOperational);
      break;
    }
  }
  return operational;
}

async function readRepairWorkOrder(root, explicitPath = null) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : [path.join(root, "output", "goal-contract", "render_input_work_order.json")];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    return fs.readJson(filePath);
  }
  return null;
}

async function readAntiSpamReport(root, explicitPath = null) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : [path.join(root, "output", "goal-20", "goal20_readiness_report.json")];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    return fs.readJson(filePath);
  }
  return null;
}

async function readGuardedLiveDispatchExecutorReport(root, explicitPath = null, defaultEnabled = true) {
  const candidates = explicitPath
    ? [path.resolve(root, explicitPath)]
    : defaultEnabled
      ? [path.join(root, "output", "goal-contract", "guarded_live_dispatch_executor_report.json")]
      : [];
  for (const filePath of candidates) {
    if (!(await fs.pathExists(filePath))) continue;
    return fs.readJson(filePath);
  }
  return null;
}

function matrixStateToOperationalState(value = "") {
  const state = String(value || "").trim();
  if (state === "ready_now") return "enabled";
  if (state === "deferred_until_platform_enabled") return "blocked_external";
  if (state === "no_ready_actions") return "blocked_external";
  return state || "unknown";
}

function platformStatusMatrixToOperational(report = {}) {
  const platforms = report?.platforms;
  if (!platforms || typeof platforms !== "object") return null;
  const mapping = {
    youtube_shorts: "youtube",
    tiktok: "tiktok",
    instagram_reels: "instagram_reel",
    facebook_reels: "facebook_reel",
    x: "twitter",
    threads: "threads",
    pinterest: "pinterest",
  };
  const operational = {};
  for (const [platform, key] of Object.entries(mapping)) {
    const row = platforms[platform];
    if (!row || typeof row !== "object") continue;
    operational[key] = {
      state: matrixStateToOperationalState(row.operational_state || row.status),
      reason: String(row.operational_reason || row.reason || "derived_from_platform_status_matrix").trim(),
    };
  }
  return Object.keys(operational).length ? operational : null;
}

function doctorPlatformStateToOperationalState(platform = "", status = "") {
  const state = String(status || "").trim();
  if (platform === "tiktok" && state === "needs_local_token_refresh_or_sync") return "needs_credentials";
  if (platform === "x" && state === "operator_disabled") return "disabled";
  if (state === "enabled_monitor_next_publish" || state === "enabled_verify_after_upload") return "enabled";
  if (state === "ready_for_operator_review") return "blocked_external";
  if (state === "blocked_by_app_review_or_direct_post_approval") return "blocked_external";
  return state || "unknown";
}

function platformReadinessDoctorToOperational(report = {}) {
  const platforms = report?.platforms;
  if (!platforms || typeof platforms !== "object") return null;
  const mapping = {
    tiktok: "tiktok",
    x: "twitter",
    facebook_reel: "facebook_reel",
    instagram_reel: "instagram_reel",
  };
  const operational = {};
  for (const [platform, key] of Object.entries(mapping)) {
    const row = platforms[platform];
    if (!row || typeof row !== "object") continue;
    const gaps = Array.isArray(row.enablement_gaps) ? row.enablement_gaps : [];
    const platformBlockers = Array.isArray(report.blockers)
      ? report.blockers.filter((blocker) => String(blocker || "").toLowerCase().startsWith(platform))
      : [];
    const enablementGaps = Array.from(new Set([...gaps, ...platformBlockers].filter(Boolean)));
    operational[key] = {
      state: doctorPlatformStateToOperationalState(platform, row.status),
      reason: String(row.reason || row.blocker || enablementGaps[0] || row.status || "platform_readiness_doctor").trim(),
      enablement_gaps: enablementGaps,
      enablement_next_action: String(row.recommendation || row.next_action || "").trim(),
    };
  }
  return Object.keys(operational).length ? operational : null;
}

function mergePlatformOperationalConfig(base = {}, override = {}) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    const current = merged[key] && typeof merged[key] === "object" ? merged[key] : {};
    merged[key] = {
      ...current,
      ...value,
      enablement_gaps: Array.from(new Set([
        ...((Array.isArray(current.enablement_gaps) && current.enablement_gaps) || []),
        ...((Array.isArray(value.enablement_gaps) && value.enablement_gaps) || []),
      ].filter(Boolean))),
      enablement_next_action: value.enablement_next_action || current.enablement_next_action || "",
    };
  }
  return merged;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function uniqueCleanStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of asArray(values)) {
    const text = cleanText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function mergePreflightCandidateStoryPackages(storyPackages = [], candidatePreflightReport = null, root = process.cwd()) {
  const merged = Array.isArray(storyPackages) ? [...storyPackages] : [];
  const seen = new Set(
    merged
      .map((item) => cleanText(item?.story_id || item?.id))
      .filter(Boolean),
  );
  const candidates = Array.isArray(candidatePreflightReport?.candidates)
    ? candidatePreflightReport.candidates
    : [];
  for (const candidate of candidates) {
    const storyId = cleanText(candidate?.id || candidate?.story_id);
    if (!storyId || seen.has(storyId)) continue;
    if (cleanText(candidate.status) !== "publish_ready") continue;
    const exportedPath = cleanText(candidate.source?.exported_path || candidate.exported_path || candidate.final_mp4_path);
    if (!exportedPath) continue;
    const resolvedExportedPath = path.isAbsolute(exportedPath)
      ? exportedPath
      : path.resolve(root, exportedPath);
    const artifactDir = path.dirname(resolvedExportedPath);
    merged.push({
      story_id: storyId,
      artifact_dir: artifactDir,
      scheduler_preflight_qa: candidate.preflight_qa || {},
      scheduler_preflight_status: cleanText(candidate.preflight_qa?.status || candidate.status),
      already_published_platforms: uniqueCleanStrings([
        ...asArray(candidate.already_published_platforms),
        ...asArray(candidate.published_platforms),
        ...asArray(candidate.source?.already_published_platforms),
        ...asArray(candidate.source?.published_platforms),
      ]),
      missing_enabled_platforms: uniqueCleanStrings([
        ...asArray(candidate.missing_enabled_platforms),
        ...asArray(candidate.source?.missing_enabled_platforms),
      ]),
      scheduler_preflight_package_source: "candidate_exported_path",
      no_publish_triggered: true,
      no_db_mutation: true,
    });
    seen.add(storyId);
  }
  return merged;
}

function storyIdsFromPackages(storyPackages = []) {
  return uniqueCleanStrings(
    asArray(storyPackages).map((story) => story?.story_id || story?.id),
  );
}

async function sourceUrlHashesFromPackages(storyPackages = []) {
  const hashes = [];
  for (const story of asArray(storyPackages)) {
    const values = [
      story?.url,
      story?.source_url,
      story?.primary_source_url,
      story?.primary_source?.url,
      story?.source?.url,
      story?.source?.source_url,
    ];
    const artifactDir = cleanText(story?.artifact_dir || story?.artifactDir);
    if (artifactDir) {
      const canonicalPath = path.join(artifactDir, "canonical_story_manifest.json");
      const platformPath = path.join(artifactDir, "platform_publish_manifest.json");
      for (const filePath of [canonicalPath, platformPath]) {
        try {
          if (!(await fs.pathExists(filePath))) continue;
          const manifest = await fs.readJson(filePath);
          values.push(
            manifest?.url,
            manifest?.source_url,
            manifest?.primary_source_url,
            manifest?.primary_source?.url,
            manifest?.official_source?.url,
          );
        } catch {
          // Ignore malformed optional evidence here; strict dry-run will
          // report malformed artefacts through the normal package gates.
        }
      }
    }
    for (const value of values) {
      const hash = canonicalHash(cleanText(value));
      if (hash && hash !== "invalid-url") hashes.push(hash);
    }
  }
  return uniqueCleanStrings(hashes);
}

function addPublishedPlatformEvidence(byStoryId, storyId, platform, evidence = {}) {
  const id = cleanText(storyId);
  const key = normalizePlatformKey(platform);
  if (!id || !key) return;
  if (!byStoryId[id]) {
    byStoryId[id] = {
      story_id: id,
      already_published_platforms: [],
      rows: [],
    };
  }
  byStoryId[id].already_published_platforms = uniqueCleanStrings([
    ...asArray(byStoryId[id].already_published_platforms),
    key,
  ]);
  byStoryId[id].rows.push({
    platform: key,
    source_platform: cleanText(platform),
    external_id: cleanText(evidence.external_id),
    external_url: cleanText(evidence.external_url),
    published_at: cleanText(evidence.published_at),
    source: cleanText(evidence.source || "platform_posts"),
  });
}

function addPublishedSourceHashEvidence(bySourceUrlHash, sourceUrlHash, platform, evidence = {}) {
  const hash = cleanText(sourceUrlHash);
  const key = normalizePlatformKey(platform);
  if (!hash || !key) return;
  if (!bySourceUrlHash[hash]) {
    bySourceUrlHash[hash] = {
      source_url_hash: hash,
      already_published_platforms: [],
      rows: [],
    };
  }
  bySourceUrlHash[hash].already_published_platforms = uniqueCleanStrings([
    ...asArray(bySourceUrlHash[hash].already_published_platforms),
    key,
  ]);
  bySourceUrlHash[hash].rows.push({
    platform: key,
    story_id: cleanText(evidence.story_id),
    source_platform: cleanText(platform),
    external_id: cleanText(evidence.external_id),
    external_url: cleanText(evidence.external_url),
    published_at: cleanText(evidence.published_at),
    source: cleanText(evidence.source || "platform_posts.source_url_hash"),
  });
}

function addPublishedTopicKeyEvidence(byTopicKey, title, platform, evidence = {}) {
  const topicKey = titleTopicKey(title);
  const key = normalizePlatformKey(platform);
  if (!topicKey || !key) return;
  if (!byTopicKey[topicKey]) {
    byTopicKey[topicKey] = {
      topic_key: topicKey,
      already_published_platforms: [],
      rows: [],
    };
  }
  byTopicKey[topicKey].already_published_platforms = uniqueCleanStrings([
    ...asArray(byTopicKey[topicKey].already_published_platforms),
    key,
  ]);
  byTopicKey[topicKey].rows.push({
    platform: key,
    story_id: cleanText(evidence.story_id),
    title: cleanText(title),
    source_platform: cleanText(platform),
    external_id: cleanText(evidence.external_id),
    external_url: cleanText(evidence.external_url),
    published_at: cleanText(evidence.published_at),
    source: cleanText(evidence.source || "platform_posts.topic_key"),
  });
}

function buildPublishedPlatformEvidence({ platformPostRows = [], legacyStoryRows = [], source = "" } = {}) {
  const byStoryId = {};
  const bySourceUrlHash = {};
  const byTopicKey = {};
  for (const row of asArray(platformPostRows)) {
    addPublishedPlatformEvidence(byStoryId, row.story_id, row.platform, {
      external_id: row.external_id,
      external_url: row.external_url,
      published_at: row.published_at,
      source: "platform_posts",
    });
    addPublishedSourceHashEvidence(bySourceUrlHash, row.source_url_hash, row.platform, {
      story_id: row.story_id,
      external_id: row.external_id,
      external_url: row.external_url,
      published_at: row.published_at,
      source: "platform_posts.source_url_hash",
    });
    addPublishedTopicKeyEvidence(byTopicKey, row.story_title || row.title, row.platform, {
      story_id: row.story_id,
      external_id: row.external_id,
      external_url: row.external_url,
      published_at: row.published_at,
      source: "platform_posts.topic_key",
    });
  }
  const legacyFieldMap = {
    youtube_post_id: "youtube_shorts",
    youtube_url: "youtube_shorts",
    instagram_media_id: "instagram_reels",
    facebook_post_id: "facebook_reels",
    tiktok_post_id: "tiktok",
    twitter_post_id: "x",
  };
  for (const row of asArray(legacyStoryRows)) {
    for (const [field, platform] of Object.entries(legacyFieldMap)) {
      if (!cleanText(row?.[field])) continue;
      addPublishedPlatformEvidence(byStoryId, row.story_id || row.id, platform, {
        external_id: row[field],
        source: `stories.${field}`,
      });
      addPublishedSourceHashEvidence(bySourceUrlHash, row.source_url_hash, platform, {
        story_id: row.story_id || row.id,
        external_id: row[field],
        source: `stories.${field}.source_url_hash`,
      });
      addPublishedTopicKeyEvidence(byTopicKey, row.title, platform, {
        story_id: row.story_id || row.id,
        external_id: row[field],
        source: `stories.${field}.topic_key`,
      });
    }
  }
  return {
    schema_version: 1,
    source: source || "read_only_platform_publication_evidence",
    by_story_id: byStoryId,
    by_source_url_hash: bySourceUrlHash,
    by_topic_key: byTopicKey,
    story_count: Object.keys(byStoryId).length,
    source_url_hash_count: Object.keys(bySourceUrlHash).length,
    topic_key_count: Object.keys(byTopicKey).length,
  };
}

function resolveLocalSqlitePath(root) {
  const fromEnv = cleanText(process.env.SQLITE_DB_PATH);
  if (fromEnv) return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(root, fromEnv);
  return path.join(root, "data", "pulse.db");
}

async function readPublishedPlatformEvidence(
  root,
  storyPackages = [],
  explicitPath = null,
  options = {},
) {
  if (explicitPath) {
    const filePath = path.resolve(root, explicitPath);
    if (!(await fs.pathExists(filePath))) return null;
    return fs.readJson(filePath);
  }
  const storyIds = storyIdsFromPackages(storyPackages);
  if (!storyIds.length) return null;
  const sourceUrlHashes = await sourceUrlHashesFromPackages(storyPackages);
  const dbPath = options.dbPath
    ? path.resolve(root, options.dbPath)
    : resolveLocalSqlitePath(root);
  if (!(await fs.pathExists(dbPath))) return null;
  let Database = null;
  try {
    Database = require("better-sqlite3");
  } catch {
    return null;
  }
  const placeholders = storyIds.map(() => "?").join(",");
  const hashPlaceholders = sourceUrlHashes.map(() => "?").join(",");
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    let platformPostRows = [];
    let legacyStoryRows = [];
    try {
      const clauses = [`p.story_id IN (${placeholders})`];
      const values = [...storyIds];
      if (sourceUrlHashes.length) {
        clauses.push(`s.source_url_hash IN (${hashPlaceholders})`);
        values.push(...sourceUrlHashes);
      }
      platformPostRows = db.prepare(`
        SELECT p.story_id, p.platform, p.external_id, p.external_url, p.status, p.published_at,
               s.source_url_hash,
               s.title AS story_title
        FROM platform_posts p
        LEFT JOIN stories s ON s.id = p.story_id
        WHERE p.status = 'published'
          AND p.external_id IS NOT NULL
          AND (${clauses.join(" OR ")})
      `).all(...values);
    } catch (err) {
      if (!/no such table|no such column/i.test(err.message)) throw err;
      platformPostRows = db.prepare(`
        SELECT story_id, platform, external_id, external_url, status, published_at
        FROM platform_posts
        WHERE status = 'published'
          AND external_id IS NOT NULL
          AND story_id IN (${placeholders})
      `).all(...storyIds);
    }
    try {
      const recentRows = db.prepare(`
        SELECT p.story_id, p.platform, p.external_id, p.external_url, p.status, p.published_at,
               s.source_url_hash,
               s.title AS story_title
        FROM platform_posts p
        LEFT JOIN stories s ON s.id = p.story_id
        WHERE p.status = 'published'
          AND p.external_id IS NOT NULL
          AND s.title IS NOT NULL
          AND COALESCE(p.published_at, p.updated_at, p.created_at) >= datetime('now', '-14 days')
        ORDER BY COALESCE(p.published_at, p.updated_at, p.created_at) DESC
        LIMIT 500
      `).all();
      platformPostRows.push(...recentRows);
    } catch (err) {
      if (!/no such table|no such column/i.test(err.message)) throw err;
      try {
        const recentRows = db.prepare(`
          SELECT p.story_id, p.platform, p.external_id, p.external_url, p.status, p.published_at,
                 s.source_url_hash,
                 s.title AS story_title
          FROM platform_posts p
          LEFT JOIN stories s ON s.id = p.story_id
          WHERE p.status = 'published'
            AND p.external_id IS NOT NULL
            AND s.title IS NOT NULL
            AND p.published_at >= datetime('now', '-14 days')
          ORDER BY p.published_at DESC
          LIMIT 500
        `).all();
        platformPostRows.push(...recentRows);
      } catch (fallbackErr) {
        if (!/no such table|no such column/i.test(fallbackErr.message)) throw fallbackErr;
      }
    }
    try {
      legacyStoryRows = db.prepare(`
        SELECT id AS story_id,
               title,
               youtube_post_id,
               youtube_url,
               instagram_media_id,
               facebook_post_id,
               tiktok_post_id,
               twitter_post_id,
               source_url_hash
        FROM stories
        WHERE id IN (${placeholders})${sourceUrlHashes.length ? ` OR source_url_hash IN (${hashPlaceholders})` : ""}
      `).all(...storyIds, ...sourceUrlHashes);
    } catch (err) {
      if (!/no such table|no such column/i.test(err.message)) throw err;
    }
    return buildPublishedPlatformEvidence({
      platformPostRows,
      legacyStoryRows,
      source: "read_only_local_sqlite_publication_evidence",
    });
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
  const root = path.resolve(args.root);
  const [
    storyPackages,
    candidatePreflightReport,
    platformOperationalConfig,
    repairWorkOrder,
    upstreamAntiSpamReport,
    guardedLiveDispatchExecutorReport,
  ] = await Promise.all([
    readStoryPackages(root, args.storyPackagesPath),
    readCandidateReport(root, args.candidateReportPath),
    readPlatformOperationalConfig(root, args.platformStatusPath),
    readRepairWorkOrder(root, args.repairWorkOrderPath),
    readAntiSpamReport(root, args.antiSpamReportPath),
    readGuardedLiveDispatchExecutorReport(
      root,
      args.guardedLiveDispatchExecutorReportPath,
      args.guardedLiveDispatchExecutorReportDefaultEnabled,
    ),
  ]);
  const mergedStoryPackages = mergePreflightCandidateStoryPackages(
    storyPackages,
    candidatePreflightReport,
    root,
  );
  const publishedPlatformEvidence = await readPublishedPlatformEvidence(
    root,
    mergedStoryPackages,
    args.publishedPlatformEvidencePath,
  );
  const plan = await buildGoalDryRunPublishPlan({
    storyPackages: mergedStoryPackages,
    candidatePreflightReport,
    requireSchedulerPreflight: args.requireSchedulerPreflight,
    platformOperationalConfig,
    repairWorkOrder,
    upstreamAntiSpamReport,
    publishedPlatformEvidence,
    guardedLiveDispatchExecutorReport,
    motionPackRoot: path.resolve(root, args.motionPackRoot || path.join("output", "studio-v4", "motion-packs")),
    generatedAt: args.generatedAt || new Date().toISOString(),
  });
  const artefacts = await writeGoalDryRunPublishPlan(plan, {
    outputDir: path.resolve(root, args.outDir),
  });
  if (args.json) console.log(JSON.stringify(plan, null, 2));
  else console.log(renderGoalDryRunPublishPlanMarkdown(plan).trimEnd());
  return { plan, artefacts };
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`[goal-dry-run-publish] FAILED: ${err.stack || err.message}`);
    process.exit(1);
  });
}

module.exports = {
  parseArgs,
  readCandidateReport,
  readPlatformOperationalConfig,
  readRepairWorkOrder,
  readAntiSpamReport,
  readGuardedLiveDispatchExecutorReport,
  readStoryPackages,
  readPublishedPlatformEvidence,
  buildPublishedPlatformEvidence,
  mergePreflightCandidateStoryPackages,
  platformStatusMatrixToOperational,
  platformReadinessDoctorToOperational,
  main,
};
