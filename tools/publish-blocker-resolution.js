#!/usr/bin/env node
"use strict";

const fs = require("fs-extra");
const path = require("node:path");
require("dotenv").config({ override: true });

const {
  buildGovernanceGreenApprovalPromotionPlan,
  buildPublishBlockerResolutionPlan,
  formatPublishBlockerResolutionMarkdown,
} = require("../lib/services/publish-blocker-resolution");
const {
  DEFAULT_BRIDGE_CANDIDATES_PATH,
  DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH,
  DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH,
  DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH,
  DEFAULT_UPSTREAM_BENCHMARK_REPORT_PATH,
  attachPreflightQa,
  buildNextPublishCandidatesReport,
  readBridgeCandidateManifest,
  runPreflightQaForStory,
  selectCandidateSourceStories,
} = require("./next-publish-candidates");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");
const DEFAULT_ANALYTICS_PATH = "D:\\pulse-data\\analytics_findings.md";

function parseArgs(argv) {
  const args = {
    json: false,
    help: false,
    limit: 40,
    storyId: "",
    lane: "",
    dryRun: false,
    apply: false,
    operatorConfirmed: false,
    analyticsPath: DEFAULT_ANALYTICS_PATH,
    bridgeCandidatesPath: DEFAULT_BRIDGE_CANDIDATES_PATH,
    allowLiveFallback: false,
    directVideoEnrichmentWorkOrderPath: DEFAULT_DIRECT_VIDEO_ENRICHMENT_WORK_ORDER_PATH,
    sourceFamilyAcquisitionReportPath: DEFAULT_SOURCE_FAMILY_ACQUISITION_REPORT_PATH,
    upstreamAntiSpamReportPath: DEFAULT_UPSTREAM_ANTI_SPAM_REPORT_PATH,
    upstreamBenchmarkReportPath: DEFAULT_UPSTREAM_BENCHMARK_REPORT_PATH,
    governanceManifest: path.join(OUT, "governance_1thsxw7", "publish_manifest.json"),
    renderStory: path.join(OUT, "story_1thsxw7_v4_render_ready.json"),
    renderPath: path.join(OUT, "studio_v4_1thsxw7_fresh_ready_proof.mp4"),
    renderReport: path.join(OUT, "1thsxw7_studio_v4_proof_report.json"),
    v4SourceDeficit: path.join(OUT, "studio_v4_source_deficit.json"),
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--operator-confirmed") args.operatorConfirmed = true;
    else if (arg === "--help" || arg === "-?") args.help = true;
    else if (arg === "--story-id") args.storyId = argv[++i] || "";
    else if (arg.startsWith("--story-id=")) args.storyId = arg.slice("--story-id=".length);
    else if (arg === "--lane") args.lane = argv[++i] || "";
    else if (arg.startsWith("--lane=")) args.lane = arg.slice("--lane=".length);
    else if (arg === "--limit") args.limit = Number(argv[++i] || args.limit);
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.slice("--limit=".length) || args.limit);
    else if (arg === "--analytics") args.analyticsPath = argv[++i] || args.analyticsPath;
    else if (arg.startsWith("--analytics=")) args.analyticsPath = arg.slice("--analytics=".length);
    else if (arg === "--bridge" || arg === "--bridge-candidates") {
      args.bridgeCandidatesPath = argv[++i] || args.bridgeCandidatesPath;
    } else if (arg.startsWith("--bridge=")) {
      args.bridgeCandidatesPath = arg.slice("--bridge=".length);
    } else if (arg.startsWith("--bridge-candidates=")) {
      args.bridgeCandidatesPath = arg.slice("--bridge-candidates=".length);
    } else if (arg === "--no-bridge" || arg === "--no-bridge-candidates") {
      args.bridgeCandidatesPath = null;
    } else if (arg === "--allow-live-fallback") {
      args.allowLiveFallback = true;
    } else if (arg === "--direct-video-work-order") {
      args.directVideoEnrichmentWorkOrderPath = argv[++i] || "";
    } else if (arg.startsWith("--direct-video-work-order=")) {
      args.directVideoEnrichmentWorkOrderPath = arg.slice("--direct-video-work-order=".length);
    } else if (arg === "--no-direct-video-work-order") {
      args.directVideoEnrichmentWorkOrderPath = "";
    } else if (arg === "--source-family-acquisition") {
      args.sourceFamilyAcquisitionReportPath = argv[++i] || "";
    } else if (arg.startsWith("--source-family-acquisition=")) {
      args.sourceFamilyAcquisitionReportPath = arg.slice("--source-family-acquisition=".length);
    } else if (arg === "--no-source-family-acquisition") {
      args.sourceFamilyAcquisitionReportPath = "";
    } else if (arg === "--upstream-anti-spam-report" || arg === "--goal20-report") {
      args.upstreamAntiSpamReportPath = argv[++i] || "";
    } else if (arg.startsWith("--upstream-anti-spam-report=")) {
      args.upstreamAntiSpamReportPath = arg.slice("--upstream-anti-spam-report=".length);
    } else if (arg.startsWith("--goal20-report=")) {
      args.upstreamAntiSpamReportPath = arg.slice("--goal20-report=".length);
    } else if (arg === "--no-upstream-anti-spam-report" || arg === "--no-goal20-report") {
      args.upstreamAntiSpamReportPath = "";
    } else if (arg === "--upstream-benchmark-report" || arg === "--goal10-report") {
      args.upstreamBenchmarkReportPath = argv[++i] || "";
    } else if (arg.startsWith("--upstream-benchmark-report=")) {
      args.upstreamBenchmarkReportPath = arg.slice("--upstream-benchmark-report=".length);
    } else if (arg.startsWith("--goal10-report=")) {
      args.upstreamBenchmarkReportPath = arg.slice("--goal10-report=".length);
    } else if (arg === "--no-upstream-benchmark-report" || arg === "--no-goal10-report") {
      args.upstreamBenchmarkReportPath = "";
    }
    else if (arg === "--governance-manifest") args.governanceManifest = argv[++i] || "";
    else if (arg.startsWith("--governance-manifest=")) {
      args.governanceManifest = arg.slice("--governance-manifest=".length);
    } else if (arg === "--render-story") args.renderStory = argv[++i] || "";
    else if (arg.startsWith("--render-story=")) {
      args.renderStory = arg.slice("--render-story=".length);
    } else if (arg === "--render-path") args.renderPath = argv[++i] || "";
    else if (arg.startsWith("--render-path=")) {
      args.renderPath = arg.slice("--render-path=".length);
    } else if (arg === "--render-report") args.renderReport = argv[++i] || "";
    else if (arg.startsWith("--render-report=")) {
      args.renderReport = arg.slice("--render-report=".length);
    } else if (arg === "--v4-source-deficit") args.v4SourceDeficit = argv[++i] || "";
    else if (arg.startsWith("--v4-source-deficit=")) {
      args.v4SourceDeficit = arg.slice("--v4-source-deficit=".length);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    "Usage: node tools/publish-blocker-resolution.js [--json] [--limit N] [--story-id ID] [--lane NAME] [--dry-run]\n" +
      "       node tools/publish-blocker-resolution.js --story-id ID --lane governance-green-approval --apply --operator-confirmed\n" +
      "Builds a no-dead-end recovery plan. Apply mode is only for governance-green approval promotion and creates a DB backup first.\n",
  );
}

async function readOptionalText(filePath) {
  try {
    if (filePath && await fs.pathExists(filePath)) return fs.readFile(filePath, "utf8");
  } catch {
    // reported as unavailable by consumers
  }
  return "";
}

async function readOptionalJson(filePath) {
  try {
    if (filePath && await fs.pathExists(filePath)) return fs.readJson(filePath);
  } catch {
    // missing optional context is fine
  }
  return null;
}

function governanceGreenIdsFromManifest(manifest) {
  if (!manifest || typeof manifest !== "object") return [];
  if (manifest.publish_status === "GREEN" && manifest.story_id) return [manifest.story_id];
  return [];
}

function v4ReadyIdsFromSourceDeficit(report) {
  const rows = Array.isArray(report?.rows) ? report.rows : [];
  return rows
    .filter((row) =>
      row &&
      row.story_id &&
      row.render_decision === "render_visual_v4" &&
      Number(row.missing_motion_families || 0) === 0 &&
      Number(row.missing_motion_clips || 0) === 0,
    )
    .map((row) => row.story_id);
}

function publishResolutionInputsFromCandidateReport(candidateReport = {}) {
  const candidates = Array.isArray(candidateReport.candidates) ? candidateReport.candidates : [];
  const excluded = Array.isArray(candidateReport.excluded) ? [...candidateReport.excluded] : [];
  let preflightEvidenceSeen = false;
  let candidateCount = 0;

  for (const candidate of candidates) {
    const preflight = candidate?.preflight_qa;
    if (!preflight) continue;
    preflightEvidenceSeen = true;
    if (preflight.status === "pass") {
      candidateCount += 1;
    } else if (preflight.status === "blocked") {
      excluded.push({
        id: candidate.id,
        title: candidate.title,
        reason: Array.isArray(preflight.blockers) && preflight.blockers.length
          ? preflight.blockers[0]
          : "preflight_qa_blocked",
      });
    } else if (preflight.status === "warn") {
      excluded.push({
        id: candidate.id,
        title: candidate.title,
        reason: Array.isArray(preflight.warnings) && preflight.warnings.length
          ? `preflight_warning:${preflight.warnings[0]}`
          : "preflight_warning",
      });
    }
  }

  return {
    candidateCount: preflightEvidenceSeen
      ? candidateCount
      : Number(candidateReport?.totals?.candidates || 0),
    excluded,
  };
}

function normaliseLaneFilter(value) {
  const lane = String(value || "").trim().replace(/-/g, "_");
  const aliases = {
    governance_green_approval: "governance_green_approval_promotion",
  };
  return aliases[lane] || lane;
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function truthy(value) {
  return value === true ||
    value === 1 ||
    /^(true|1|yes)$/i.test(String(value || "").trim());
}

function parseFailureList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => parseFailureList(item));
  }
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return [];
    if (/^\[/.test(text)) {
      try {
        const parsed = JSON.parse(text);
        return parseFailureList(parsed);
      } catch {
        // fall through to plain text
      }
    }
    return [text];
  }
  return [String(value)];
}

function isQaFailedLiveBacklogRow(story = {}) {
  const publishStatus = cleanText(story.publish_status).toLowerCase();
  const qaStatus = cleanText(story.qa_status).toLowerCase();
  return truthy(story.qa_failed) ||
    publishStatus === "qa_failed" ||
    qaStatus === "qa_failed" ||
    qaStatus === "failed";
}

function qaFailedBacklogReason(story = {}) {
  const failures = [
    ...parseFailureList(story.qa_failures),
    ...parseFailureList(story.content_qa_failures),
    ...parseFailureList(story.video_qa_failures),
  ].map(cleanText).filter(Boolean);
  const reason = failures[0] ||
    cleanText(story.publish_error) ||
    cleanText(story.script_review_reason) ||
    cleanText(story.qa_status) ||
    "qa_failed";
  return /^qa[:_]/i.test(reason) ? reason : `qa:${reason}`;
}

function isLegacyLiveDbOnlyQaReason(reason = "") {
  return /script_validation_review_required_public_row_repair/i.test(String(reason || ""));
}

function appendQaFailedBacklogRepairContext({
  candidateReport = {},
  mergedStories = [],
  stories = [],
  requestedStoryId = "",
} = {}) {
  const wantedStoryId = cleanText(requestedStoryId);
  const mergedIds = new Set(
    (Array.isArray(mergedStories) ? mergedStories : [])
      .map((story) => cleanText(story?.id))
      .filter(Boolean),
  );
  const candidateIds = new Set(
    (Array.isArray(candidateReport.candidates) ? candidateReport.candidates : [])
      .map((row) => cleanText(row?.id))
      .filter(Boolean),
  );
  const excluded = Array.isArray(candidateReport.excluded)
    ? candidateReport.excluded
    : [];
  const excludedIds = new Set(
    excluded.map((row) => cleanText(row?.id)).filter(Boolean),
  );
  const appended = [];

  for (const story of Array.isArray(stories) ? stories : []) {
    const id = cleanText(story?.id);
    if (!id) continue;
    if (wantedStoryId && id !== wantedStoryId) continue;
    if (!isQaFailedLiveBacklogRow(story)) continue;
    if (!mergedIds.has(id)) {
      mergedStories.push(story);
      mergedIds.add(id);
    }
    if (!candidateIds.has(id) && !excludedIds.has(id)) {
      const reason = qaFailedBacklogReason(story);
      excluded.push({
        id,
        title: cleanText(story.title),
        reason: isLegacyLiveDbOnlyQaReason(reason)
          ? `live_db_legacy_debt:${reason.replace(/^qa[:_]?/i, "")}`
          : reason,
        scheduler_bridge_source: "live_qa_failed_backlog",
      });
      excludedIds.add(id);
      appended.push(id);
    }
  }

  if (appended.length > 0 || !Array.isArray(candidateReport.excluded)) {
    candidateReport.excluded = excluded;
  }
  if (appended.length > 0) {
    candidateReport.repair_context = {
      ...(candidateReport.repair_context || {}),
      qa_failed_live_backlog_outside_authoritative_bridge: true,
      qa_failed_backlog_count: Number(candidateReport.repair_context?.qa_failed_backlog_count || 0) + appended.length,
    };
  }
  return appended;
}

function fileExistsFromRoot(filePath) {
  if (!filePath) return false;
  try {
    const mediaPaths = require("../lib/media-paths");
    const resolved = mediaPaths.resolveExistingSync(filePath);
    if (resolved && fs.pathExistsSync(resolved)) return true;
  } catch {
    // fall through to repo-root checks
  }
  return fs.pathExistsSync(filePath) || fs.pathExistsSync(path.resolve(ROOT, filePath));
}

function resolveFromRoot(filePath) {
  if (!filePath) return "";
  try {
    const mediaPaths = require("../lib/media-paths");
    const resolved = mediaPaths.resolveExistingSync(filePath);
    if (resolved && fs.pathExistsSync(resolved)) return resolved;
  } catch {
    // fall through to repo-root checks
  }
  if (fs.pathExistsSync(filePath)) return filePath;
  return path.resolve(ROOT, filePath);
}

function staleTemporalReviewPathForStory(story = {}, { root = ROOT } = {}) {
  const storyId = String(story?.id || story?.story_id || "").trim();
  if (!storyId) return "";
  const artifactDir = String(story.artifact_dir || "").trim();
  if (artifactDir) return path.join(artifactDir, "stale_temporal_review.json");
  return path.join(root, "output", "goal-proof", "batch", storyId, "stale_temporal_review.json");
}

async function hydrateStaleTemporalReviewArtifacts(stories = [], { root = ROOT } = {}) {
  const rows = Array.isArray(stories) ? stories : [];
  await Promise.all(
    rows.map(async (story) => {
      if (!story || story.stale_temporal_review) return;
      const reviewPath = staleTemporalReviewPathForStory(story, { root });
      if (!reviewPath) return;
      try {
        if (await fs.pathExists(reviewPath)) {
          story.stale_temporal_review = await fs.readJson(reviewPath);
        }
      } catch {
        // Missing or malformed review artefacts stay visible as repair work.
      }
    }),
  );
}

function renderHasAudioStream(filePath) {
  const resolved = resolveFromRoot(filePath);
  if (!resolved || !fs.pathExistsSync(resolved)) return false;
  try {
    const cp = require("node:child_process");
    const output = cp.execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-select_streams",
        "a",
        "-show_entries",
        "stream=codec_type",
        "-of",
        "csv=p=0",
        resolved,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    return String(output || "").includes("audio");
  } catch {
    return false;
  }
}

function backupFileName(now = new Date()) {
  return `pulse-pre-governance-green-promotion-${now.toISOString().replace(/[:.]/g, "-")}.db`;
}

function buildPromotionApplyPreview({ promotionPlan = {}, dbPath = "", preApplyPreflight = null } = {}) {
  const storyId = String(promotionPlan.story_id || "").trim();
  const planReady = promotionPlan.status === "ready_for_operator_confirmed_apply";
  const preflightStatus = preApplyPreflight?.status || null;
  const preflightBlocked = preflightStatus === "blocked";
  const ready = planReady && !preflightBlocked;
  const generatedAt = promotionPlan.generated_at
    ? new Date(promotionPlan.generated_at)
    : new Date();
  const safeGeneratedAt = Number.isNaN(generatedAt.getTime()) ? new Date() : generatedAt;
  const backupDir = dbPath ? path.join(path.dirname(dbPath), "backups") : "";
  const expectedBackupPath = backupDir
    ? path.join(backupDir, backupFileName(safeGeneratedAt))
    : "";

  return {
    status: preflightBlocked ? "blocked_preflight" : ready ? "ready_operator_only" : "blocked",
    story_id: storyId || null,
    requires_operator_confirmed: true,
    backup_required: true,
    expected_backup_path: expectedBackupPath || null,
    db_mutation_on_apply: true,
    posting: false,
    oauth: false,
    token_printing: false,
    safety_gates_weakened: false,
    pre_apply_preflight_required: true,
    pre_apply_preflight_status: preflightStatus,
    verification_phase: "post_apply",
    live_row_expected_blocked_before_apply: true,
    pre_apply_preflight_blockers: Array.isArray(preApplyPreflight?.blockers)
      ? preApplyPreflight.blockers
      : [],
    pre_apply_preflight_warnings: Array.isArray(preApplyPreflight?.warnings)
      ? preApplyPreflight.warnings
      : [],
    apply_command: storyId
      ? `npm run ops:publish-unblock -- --story-id ${storyId} --lane governance-green-approval --apply --operator-confirmed`
      : null,
    verification_commands: storyId
      ? [
          `npm run ops:next-publish-candidates -- --preflight-qa --story-id ${storyId}`,
          `npm run ops:publish-unblock -- --story-id ${storyId} --lane governance-green-approval --dry-run --json`,
          "npm run ops:publish-unblock -- --json --limit 20",
        ]
      : [],
  };
}

function buildPublishResolutionCandidateContext({
  stories = [],
  analyticsText = "",
  analyticsPath = DEFAULT_ANALYTICS_PATH,
  bridgeManifest = {},
  directVideoEnrichmentWorkOrder = null,
  sourceFamilyAcquisitionReport = null,
  upstreamAntiSpamReport = null,
  limit = 40,
  storyId = "",
  allowLiveFallback = false,
} = {}) {
  const selected = selectCandidateSourceStories({
    liveStories: stories,
    bridgeCandidates: bridgeManifest?.candidates,
    bridgeManifest: {
      ...bridgeManifest,
      allowLiveFallback,
    },
  });
  const requestedStoryId = String(storyId || "").trim();
  const mergedStories = [...selected.stories];
  const bridgeMotionGovernanceEvidence = {
    directVideoEnrichmentWorkOrder,
    sourceFamilyAcquisitionReport,
  };
  const candidateReport = buildNextPublishCandidatesReport(mergedStories, {
    analyticsText,
    analyticsPath,
    limit: Math.max(1000, Number(limit) || 40),
    storyId,
    bridgeManifest: selected.bridge_manifest,
    upstreamAntiSpamReport,
  });
  appendQaFailedBacklogRepairContext({
    candidateReport,
    mergedStories,
    stories,
    requestedStoryId,
  });
  if (requestedStoryId && !mergedStories.some((story) => String(story?.id || "") === requestedStoryId)) {
    const requestedLiveStory = (Array.isArray(stories) ? stories : []).find(
      (story) => String(story?.id || "") === requestedStoryId,
    );
    if (requestedLiveStory) {
      mergedStories.push(requestedLiveStory);
      const liveOnlyReport = buildNextPublishCandidatesReport([requestedLiveStory], {
        analyticsText,
        analyticsPath,
        limit: 1,
        storyId: requestedStoryId,
        bridgeManifest: { requested: false, exists: false },
        upstreamAntiSpamReport,
      });
      const liveExclusion = (Array.isArray(liveOnlyReport.excluded)
        ? liveOnlyReport.excluded
        : []).find((row) => String(row?.id || "") === requestedStoryId);
      const liveCandidate = (Array.isArray(liveOnlyReport.candidates)
        ? liveOnlyReport.candidates
        : []).find((row) => String(row?.id || "") === requestedStoryId);
      const excluded = Array.isArray(candidateReport.excluded)
        ? candidateReport.excluded
        : [];
      excluded.push({
        id: requestedStoryId,
        title: requestedLiveStory.title || liveExclusion?.title || liveCandidate?.title || "",
        reason: liveExclusion?.reason || "stale_scheduler_bridge_candidate:not_in_current_bridge",
        scheduler_bridge_source: "live_row_repair_context",
      });
      candidateReport.excluded = excluded;
      candidateReport.repair_context = {
        ...(candidateReport.repair_context || {}),
        requested_live_row_outside_authoritative_bridge: true,
        requested_story_id: requestedStoryId,
      };
    }
  }
  return {
    selected,
    mergedStories,
    bridgeMotionGovernanceEvidence,
    candidateReport,
  };
}

async function runCli(argv = process.argv) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { exitCode: 0 };
  }

  const db = require("../lib/db");
  const [
    stories,
    analyticsText,
    governanceManifest,
    v4SourceDeficit,
    bridgeManifest,
    directVideoEnrichmentWorkOrder,
    sourceFamilyAcquisitionReport,
    upstreamAntiSpamReport,
    upstreamBenchmarkReport,
  ] = await Promise.all([
    db.getStories(),
    readOptionalText(args.analyticsPath),
    readOptionalJson(args.governanceManifest),
    readOptionalJson(args.v4SourceDeficit),
    readBridgeCandidateManifest(args.bridgeCandidatesPath),
    readOptionalJson(args.directVideoEnrichmentWorkOrderPath),
    readOptionalJson(args.sourceFamilyAcquisitionReportPath),
    readOptionalJson(args.upstreamAntiSpamReportPath),
    readOptionalJson(args.upstreamBenchmarkReportPath),
  ]);
  const candidateContext = buildPublishResolutionCandidateContext({
    stories,
    analyticsText,
    analyticsPath: args.analyticsPath,
    bridgeManifest,
    directVideoEnrichmentWorkOrder,
    sourceFamilyAcquisitionReport,
    upstreamAntiSpamReport,
    limit: args.limit,
    storyId: args.storyId,
    allowLiveFallback: args.allowLiveFallback,
  });
  const candidateReport = candidateContext.candidateReport;
  const mergedStories = candidateContext.mergedStories;
  await hydrateStaleTemporalReviewArtifacts(mergedStories);
  await attachPreflightQa(candidateReport, mergedStories, {
    bridgeMotionGovernanceEvidence: candidateContext.bridgeMotionGovernanceEvidence,
    upstreamBenchmarkReport,
  });
  const resolutionInputs = publishResolutionInputsFromCandidateReport(candidateReport);
  const plan = buildPublishBlockerResolutionPlan({
    stories: mergedStories,
    excluded: resolutionInputs.excluded,
    candidateCount: resolutionInputs.candidateCount,
    governanceGreenStoryIds: governanceGreenIdsFromManifest(governanceManifest),
    v4ReadyStoryIds: v4ReadyIdsFromSourceDeficit(v4SourceDeficit),
    limit: args.limit,
  });
  if (args.storyId || args.lane) {
    const lane = normaliseLaneFilter(args.lane);
    plan.priority_items = plan.priority_items.filter((item) => {
      if (args.storyId && item.story_id !== args.storyId) return false;
      if (lane && item.resolution_lane !== lane) return false;
      return true;
    });
    plan.summary.resolution_items = plan.priority_items.length;
    plan.summary.returned_resolution_items = plan.priority_items.length;
    plan.summary.returned_auto_repairable_items = plan.priority_items.filter((item) => item.can_apply_automatically).length;
    plan.summary.returned_operator_confirmed_items = plan.priority_items.filter((item) =>
      /operator_confirmed/.test(item.safety_gate),
    ).length;
    if (plan.publish_runway) {
      plan.publish_runway.returned_items = plan.priority_items.length;
    }
    plan.filter = {
      story_id: args.storyId || null,
      lane: args.lane || null,
      dry_run: args.dryRun === true,
      apply: args.apply === true,
    };

    if (args.storyId && lane === "governance_green_approval_promotion") {
      const renderStory = await readOptionalJson(args.renderStory);
      const renderReport = await readOptionalJson(args.renderReport);
      if (governanceManifest) governanceManifest.__file = args.governanceManifest;
      const liveStory = stories.find((story) => story && String(story.id) === args.storyId) || {};
      const promotionPlan = buildGovernanceGreenApprovalPromotionPlan({
        liveStory,
        renderStory: renderStory || {},
        manifest: governanceManifest || {},
        renderPath: args.renderPath,
        renderReport: renderReport || {},
        fileExists: fileExistsFromRoot,
        renderHasAudio: renderHasAudioStream,
      });
      plan.promotion_plan = promotionPlan;
      if (promotionPlan.update_story) {
        plan.promotion_preflight = await runPreflightQaForStory(promotionPlan.update_story);
      }
      plan.promotion_apply_preview = buildPromotionApplyPreview({
        promotionPlan,
        dbPath: db.DB_PATH,
        preApplyPreflight: plan.promotion_preflight,
      });

      if (args.apply) {
        if (args.operatorConfirmed !== true) {
          throw new Error("governance_green_promotion_apply_requires_operator_confirmed");
        }
        if (promotionPlan.status !== "ready_for_operator_confirmed_apply") {
          throw new Error(
            `governance_green_promotion_blocked:${promotionPlan.blockers.join(",")}`,
          );
        }
        if (plan.promotion_preflight?.status === "blocked") {
          throw new Error(
            `governance_green_promotion_preflight_blocked:${plan.promotion_preflight.blockers.join(",")}`,
          );
        }
        const backupDir = path.join(path.dirname(db.DB_PATH), "backups");
        await fs.ensureDir(backupDir);
        const backupPath = path.join(backupDir, backupFileName(new Date(promotionPlan.generated_at)));
        await db.getDb().backup(backupPath);
        await db.upsertStory(promotionPlan.update_story);
        plan.apply_result = {
          status: "applied",
          story_id: promotionPlan.story_id,
          backup_path: backupPath,
          db_mutation: true,
          posting: false,
        };
        plan.safety = {
          ...(plan.safety || {}),
          mode: "apply",
          db_mutation: true,
          posting: false,
          oauth: false,
          token_printing: false,
          safety_gates_weakened: false,
        };
      }
    }
  }
  const markdown = formatPublishBlockerResolutionMarkdown(plan);

  await fs.ensureDir(OUT);
  const jsonPath = path.join(OUT, "publish_blocker_resolution.json");
  const mdPath = path.join(OUT, "publish_blocker_resolution.md");
  await fs.writeJson(jsonPath, plan, { spaces: 2 });
  await fs.writeFile(mdPath, markdown, "utf8");

  if (args.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  else process.stdout.write(markdown);
  process.stderr.write(`[publish-blocker-resolution] json=${path.relative(ROOT, jsonPath)}\n`);
  process.stderr.write(`[publish-blocker-resolution] md=${path.relative(ROOT, mdPath)}\n`);
  return { exitCode: 0, plan };
}

if (require.main === module) {
  runCli().catch((err) => {
    process.stderr.write(`[publish-blocker-resolution] ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  runCli,
  parseArgs,
  buildPublishResolutionCandidateContext,
  buildPromotionApplyPreview,
  governanceGreenIdsFromManifest,
  hydrateStaleTemporalReviewArtifacts,
  normaliseLaneFilter,
  publishResolutionInputsFromCandidateReport,
  v4ReadyIdsFromSourceDeficit,
};
