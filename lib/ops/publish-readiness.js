"use strict";

const fs = require("fs-extra");
const path = require("node:path");

/**
 * lib/ops/publish-readiness.js — unified publish-readiness report.
 *
 * Per the 2026-04-30 mission brief: the operator needs ONE command
 * that aggregates every available signal into a single
 * GREEN/AMBER/RED verdict and explains it in plain English.
 *
 * This is the operator's morning check. It must:
 *   1. NEVER mutate production (read-only across the board).
 *   2. NEVER conflate historical failures with current live failures.
 *   3. Label external blockers (TikTok API, FB Reel page gate)
 *      honestly — they aren't our bugs.
 *   4. Mark missing data as "unknown", not silently green.
 *
 * The report extends the existing lib/ops/control-room.js with the
 * full 20-input set the mission listed. Where a control-room pillar
 * already covers the input, we reuse it; the rest are new pillars.
 *
 * Exports:
 *   - buildPublishReadinessReport(opts) → JSON object
 *   - formatPublishReadinessMarkdown(report) → string
 *
 * Each pillar resolves to one of:
 *   { ok, verdict: "green" | "amber" | "red" | "unknown", reason?, raw? }
 *
 * The overall verdict is most-conservative-wins:
 *   - any RED   → RED
 *   - any AMBER → AMBER
 *   - all GREEN → GREEN
 *
 * Pillars whose verdict is "unknown" do NOT pull the overall up to
 * green — they get tagged in the report as "unknown — supply data".
 */

function safeRequire(modulePath) {
  try {
    return require(modulePath);
  } catch {
    return null;
  }
}

const RED = "red";
const AMBER = "amber";
const GREEN = "green";
const UNKNOWN = "unknown";
const DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS = 12;

function normaliseReadinessVerdict(verdict) {
  const value = String(verdict || "").trim().toLowerCase();
  if (["red", "fail", "failed", "blocked", "block"].includes(value)) return RED;
  if (["amber", "review", "warn", "warning", "degraded"].includes(value)) return AMBER;
  if (["green", "pass", "passed", "ok", "healthy"].includes(value)) return GREEN;
  if (["unknown", "skip", "skipped", "unavailable", ""].includes(value)) return UNKNOWN;
  return UNKNOWN;
}

function normalisePillar(pillar = {}) {
  return {
    ...pillar,
    verdict: normaliseReadinessVerdict(pillar.verdict),
  };
}

function topCounts(items = [], limit = 3) {
  const counts = new Map();
  for (const item of items) {
    const value = String(item || "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => `${value} x${count}`);
}

function summariseSystemDoctorReason(report = {}) {
  const blockers = Array.isArray(report.blockers) ? report.blockers.filter(Boolean).map(String) : [];
  const findings = Array.isArray(report.findings) ? report.findings.filter(Boolean).map(String) : [];
  const advisories = Array.isArray(report.advisories) ? report.advisories.filter(Boolean).map(String) : [];
  if (blockers.length > 0) return blockers.slice(0, 3).join(", ");
  if (findings.length > 0) return findings.slice(0, 3).join(", ");
  if (advisories.length > 0) return advisories.slice(0, 3).join(", ");
  return undefined;
}

function summariseMediaVerifyReason(report = {}) {
  const issueCount = Number(report.issueCount || 0);
  if (issueCount <= 0) return undefined;
  const groups = topCounts(
    (Array.isArray(report.issues) ? report.issues : []).map((issue) => issue?.issue || "unknown"),
  );
  return `${issueCount}_media_path_issues${groups.length ? `: ${groups.join(", ")}` : ""}`;
}

function summarisePlatformStatusReason(report = {}) {
  const summary = report.summary || {};
  const operational = report.operational || {};
  const describe = (platform) => {
    const entry = operational[platform] || {};
    const reason = entry.reason || entry.state || "not_ready";
    return `${platform}=${reason}`;
  };
  const needsCredentials = [...new Set(Array.isArray(summary.needs_credentials_platforms)
    ? summary.needs_credentials_platforms
    : [])].sort();
  const disabled = [...new Set(Array.isArray(summary.disabled_platforms)
    ? summary.disabled_platforms
    : [])]
    .filter((platform) => !needsCredentials.includes(platform))
    .sort();
  const external = [...new Set(Array.isArray(summary.blocked_external_platforms)
    ? summary.blocked_external_platforms
    : [])].sort();
  const parts = [];
  if (needsCredentials.length) {
    parts.push(`needs_credentials: ${needsCredentials.map(describe).join(", ")}`);
  }
  if (disabled.length) {
    parts.push(`disabled: ${disabled.map(describe).join(", ")}`);
  }
  if (external.length) {
    parts.push(`external_block: ${external.map(describe).join(", ")}`);
  }
  return parts.join("; ") || undefined;
}

function applyStrictPlatformEvidenceToStatus(
  status = {},
  { strictDryRunPlan = null, platformDoctor = null } = {},
) {
  const dryRunTiktok =
    strictDryRunPlan?.platform_operational_config?.tiktok ||
    strictDryRunPlan?.platform_operational_config?.platforms?.tiktok ||
    {};
  const matrixTiktok = strictDryRunPlan?.platform_status_matrix?.platforms?.tiktok || {};
  const doctorTiktok = platformDoctor?.platforms?.tiktok || {};
  const tiktokSignals = [
    dryRunTiktok.state,
    dryRunTiktok.reason,
    matrixTiktok.operational_state,
    matrixTiktok.operational_reason,
    doctorTiktok.status,
    doctorTiktok?.token?.reason,
    doctorTiktok?.no_post_readiness?.local_token?.status,
    doctorTiktok?.no_post_readiness?.official_inbox?.status,
  ].map((value) => String(value || ""));
  const tiktokNeedsCredentials = tiktokSignals.some((signal) =>
    /needs_credentials|token_refresh|refresh_or_sync|expired_but_refreshable|needs_local_token_refresh_or_sync/i.test(signal),
  );
  if (!tiktokNeedsCredentials) return status;

  const reason =
    dryRunTiktok.reason ||
    matrixTiktok.operational_reason ||
    (doctorTiktok.status === "needs_local_token_refresh_or_sync"
      ? "tiktok_local_token_refresh_or_sync_required"
      : null) ||
    doctorTiktok?.no_post_readiness?.local_token?.next_action ||
    doctorTiktok.recommendation ||
    "tiktok_credentials_required";
  const nextAction =
    dryRunTiktok.enablement_next_action ||
    matrixTiktok.enablement_next_action ||
    doctorTiktok.recommendation ||
    null;
  const summary = { ...(status.summary || {}) };
  const needsCredentials = new Set(
    Array.isArray(summary.needs_credentials_platforms)
      ? summary.needs_credentials_platforms
      : [],
  );
  needsCredentials.add("tiktok");
  const disabledPlatforms = new Set(
    Array.isArray(summary.disabled_platforms) ? summary.disabled_platforms : [],
  );
  disabledPlatforms.delete("tiktok");
  summary.needs_credentials_platforms = [...needsCredentials].sort();
  summary.disabled_platforms = [...disabledPlatforms].sort();
  summary.needs_credentials_platform_count = summary.needs_credentials_platforms.length;
  summary.disabled_platform_count = summary.disabled_platforms.length;
  const priorTikTok = (status.operational || {}).tiktok || {};
  const tiktokCounts = status.counts?.tiktok || {};
  const tiktokRowCount = Object.values(tiktokCounts).reduce((sum, value) => {
    const number = Number(value);
    return sum + (Number.isFinite(number) ? number : 0);
  }, 0);
  const counts = {
    ...(status.counts || {}),
    ...(tiktokRowCount > 0 ? { tiktok: { needs_credentials: tiktokRowCount } } : {}),
  };
  const operational = {
    ...(status.operational || {}),
    tiktok: {
      ...priorTikTok,
      state: "needs_credentials",
      reason,
      operator_state: priorTikTok.operator_state || priorTikTok.state || null,
      operator_reason: priorTikTok.operator_reason || priorTikTok.reason || null,
      enablement_next_action: nextAction,
      effective_readiness_source: "strict_dry_run_or_platform_doctor",
    },
  };
  return {
    ...status,
    summary,
    operational,
    counts,
  };
}

function summariseTiktokExternalBlockReason(report = {}) {
  const tiktok = report?.platforms?.tiktok || {};
  const directPostBlocker = tiktok?.no_post_readiness?.direct_post?.blocker;
  const recommendation = tiktok.recommendation;
  const reasons = [];
  for (const blocker of Array.isArray(report.blockers) ? report.blockers : []) {
    if (/tiktok/i.test(String(blocker))) reasons.push(String(blocker));
  }
  if (directPostBlocker) reasons.push(String(directPostBlocker));
  if (recommendation) reasons.push(`next=${recommendation}`);
  return [...new Set(reasons)].join("; ") || undefined;
}

function summariseLocalRestartReadinessReason(report = {}) {
  const parts = [];
  const blockers = Array.isArray(report.blockers) ? report.blockers.filter(Boolean).map(String) : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings.filter(Boolean).map(String) : [];
  if (blockers.length > 0) parts.push(blockers.slice(0, 3).join("; "));
  const schedulerHygiene = report.windows_scheduler_hygiene || {};
  const visibleRiskCount = Number(schedulerHygiene.visible_console_risk_count || 0);
  if (visibleRiskCount > 0) {
    const names = Array.isArray(schedulerHygiene.risk_task_names)
      ? schedulerHygiene.risk_task_names.filter(Boolean).map(String).slice(0, 3)
      : [];
    parts.push(
      `scheduler_visible_console_risks=${visibleRiskCount}${names.length ? `: ${names.join(", ")}` : ""}`,
    );
  }
  if (parts.length === 0 && warnings.length > 0) parts.push(warnings.slice(0, 3).join("; "));
  if (parts.length === 0 && report.restart_recommendation) {
    parts.push(String(report.restart_recommendation));
  }
  return parts.join("; ") || undefined;
}

async function pillarLocalRestartReadiness(opts = {}) {
  if (opts.report) {
    return {
      ok: true,
      verdict: opts.report.verdict || UNKNOWN,
      reason: summariseLocalRestartReadinessReason(opts.report),
      raw: opts.report,
    };
  }
  const mod = safeRequire("./local-restart-readiness");
  if (!mod || typeof mod.buildLocalRestartReadiness !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    const report = await mod.buildLocalRestartReadiness({
      cwd: opts.cwd || path.join(__dirname, "..", ".."),
      env: opts.env || process.env,
      now: opts.now ? new Date(opts.now) : new Date(),
    });
    return {
      ok: true,
      verdict: report.verdict || UNKNOWN,
      reason: summariseLocalRestartReadinessReason(report),
      raw: report,
    };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `local_restart_readiness: ${err.message}`,
    };
  }
}

function numberFromAny(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function repairBacklogLaneCounts(report = {}) {
  const summaryCounts = report?.summary?.lane_counts || report?.summary?.repair_lane_counts;
  const counts = new Map();
  if (summaryCounts && typeof summaryCounts === "object") {
    for (const [lane, count] of Object.entries(summaryCounts)) {
      const value = Number(count);
      if (!lane || !Number.isFinite(value) || value <= 0) continue;
      counts.set(String(lane), value);
    }
  }
  if (counts.size === 0) {
    for (const item of Array.isArray(report.items) ? report.items : []) {
      const lane = String(item?.repair_lane || item?.lane || item?.stage_id || "unknown").trim();
      if (!lane) continue;
      counts.set(lane, (counts.get(lane) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([lane, count]) => ({ lane, count }));
}

function summariseRepairBacklogReason(report = {}) {
  const summary = report.summary || {};
  const items = Array.isArray(report.items) ? report.items : [];
  const totalItems = numberFromAny(summary.total_items, items.length);
  const autoRepairableItems = numberFromAny(
    summary.auto_repairable_items,
    summary.auto_repairable_jobs,
    items.filter((item) => item?.auto_repairable === true).length,
  );
  const operatorRequiredItems = numberFromAny(
    summary.operator_required_items,
    summary.operator_required_jobs,
    items.filter(
      (item) =>
        item?.operator_approval_required === true ||
        item?.operator_approval_needed === true,
    ).length,
  );
  const deadEndItems = numberFromAny(
    summary.dead_end_items,
    summary.dead_end_blocker_items,
    summary.dead_end_blockers,
    items.filter((item) => item?.dead_end_blocker === true).length,
  );
  if (totalItems <= 0) return undefined;
  const laneParts = repairBacklogLaneCounts(report)
    .slice(0, 3)
    .map(({ lane, count }) => `${lane} x${count}`);
  const parts = [
    `${totalItems}_open_repair_items`,
    `${autoRepairableItems}_auto`,
    `${operatorRequiredItems}_operator`,
    `${deadEndItems}_dead_end`,
  ];
  return `${parts[0]}: ${parts.slice(1).join(", ")}${laneParts.length ? `; top_lanes: ${laneParts.join(", ")}` : ""}`;
}

function buildMediaVerifyStoriesFromDryRunPlan(plan = {}) {
  if (!dryRunSafetyIsIntact(plan)) return [];
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  const seen = new Set();
  const rows = [];
  for (const action of actions) {
    const actionType = String(action?.action || "");
    if (!["would_publish", "would_queue_when_enabled"].includes(actionType)) continue;
    const storyId = String(action.story_id || action.storyId || "").trim();
    const platform = String(action.platform || "unknown_platform").trim();
    const key = `${storyId}:${platform}`;
    if (!storyId || seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: key,
      exported_path: action.video_path || null,
      captions_path: action.captions_path || null,
      cover_frame_source: action.cover_frame_source || null,
    });
  }
  return rows;
}

function dominantVerdict(verdicts) {
  const normalised = (verdicts || []).map(normaliseReadinessVerdict);
  if (normalised.includes(RED)) return RED;
  if (normalised.includes(AMBER)) return AMBER;
  // unknown does not block green — but if EVERY pillar is unknown,
  // we're in unknown rather than green.
  if (normalised.length === 0 || normalised.every((v) => v === UNKNOWN)) return UNKNOWN;
  return GREEN;
}

// ── Pillar resolvers ─────────────────────────────────────────────

async function pillarSystemDoctor() {
  const sd = safeRequire("./system-doctor");
  if (!sd || typeof sd.buildSystemDoctorReport !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    const report = await sd.buildSystemDoctorReport();
    return {
      ok: true,
      verdict: report.verdict || (report.ok ? GREEN : AMBER),
      reason: summariseSystemDoctorReason(report),
      raw: report,
    };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `system_doctor: ${err.message}`,
    };
  }
}

async function pillarRailwayDeploy() {
  // Read-only fetch of /api/health on the canonical production URL.
  // Reports the deployed commit + uptime. RED only when health
  // endpoint is unreachable. Note: we resolve quickly via 5s timeout
  // so a network blip doesn't stall the whole report.
  const url = process.env.RAILWAY_PUBLIC_URL || null;
  if (!url) {
    return { ok: false, verdict: UNKNOWN, reason: "RAILWAY_PUBLIC_URL_unset" };
  }
  return new Promise((resolve) => {
    let resolved = false;
    let req = null;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      if (req && typeof req.destroy === "function") {
        req.destroy();
      }
      resolve({ ok: false, verdict: AMBER, reason: "health_timeout" });
    }, 5000);
    try {
      const https = require("https");
      const u = new URL(`${url.replace(/\/$/, "")}/api/health`);
      req = https
        .get(u, (res) => {
          let body = "";
          res.on("data", (d) => (body += d));
          res.on("end", () => {
            if (resolved) return;
            resolved = true;
            clearTimeout(timer);
            try {
              const j = JSON.parse(body);
              const status = j && j.status;
              const verdict = status === "ok" ? GREEN : AMBER;
              resolve({
                ok: true,
                verdict,
                raw: {
                  status,
                  commit: j?.build?.commit_short || null,
                  uptime_min: j?.uptime ? Math.round(j.uptime / 60) : null,
                },
              });
            } catch {
              resolve({
                ok: false,
                verdict: AMBER,
                reason: "health_parse_failed",
              });
            }
          });
        })
        .on("error", (err) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          resolve({
            ok: false,
            verdict: RED,
            reason: `health_unreachable: ${err.code || err.message}`,
          });
        });
    } catch (err) {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        verdict: AMBER,
        reason: `request_setup: ${err.message}`,
      });
    }
  });
}

async function pillarQueueHealth() {
  const qi = safeRequire("./queue-inspect");
  if (!qi || typeof qi.buildQueueReport !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    const report = await qi.buildQueueReport();
    if (report.verdict === "skip") {
      return {
        ok: false,
        verdict: UNKNOWN,
        reason: report.reason || "queue_unavailable",
        raw: report,
      };
    }
    const verdict =
      report.verdict === "fail"
        ? RED
        : report.verdict === "review"
          ? AMBER
          : GREEN;
    const reason =
      verdict === RED
        ? (report.hardFails || []).join(", ") || "queue_failed"
        : verdict === AMBER
          ? (report.warnings || []).join(", ") || "queue_review"
          : undefined;
    return { ok: true, verdict, reason, raw: report };
  } catch (err) {
    return { ok: false, verdict: UNKNOWN, reason: `queue: ${err.message}` };
  }
}

function defaultStrictDryRunPlanPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "dry_run_publish_plan.json",
  );
}

function defaultSchedulerBridgeCandidatesPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "scheduler_bridge_candidates.json",
  );
}

function defaultPlatformDoctorPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "test",
    "output",
    "platform_readiness_doctor.json",
  );
}

function defaultRepairBacklogPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "repair_backlog.json",
  );
}

function defaultProductionRenderReportPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "production_render_materialization_report.json",
  );
}

function defaultPlatformDurationContractReportPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "platform_duration_contract_report.json",
  );
}

function defaultFinalVoiceAuditPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "final_voice_audit.json",
  );
}

function defaultLocalTestVideoManifestPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "local_test_video_manifest.json",
  );
}

function defaultHumanReviewApprovalGateReportPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "human_review_approval_gate_report.json",
  );
}

function defaultHumanReviewDecisionSheetPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "human_review_decision_sheet.json",
  );
}

function defaultHumanReviewOperatorIndexPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "human_review_operator_index.json",
  );
}

function defaultHumanReviewConsolePath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "human_review_console.json",
  );
}

function defaultGuardedDispatchPreflightReportPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "guarded_dispatch_preflight_report.json",
  );
}

function defaultGuardedDispatchExecutorPreflightReportPath() {
  return path.join(
    __dirname,
    "..",
    "..",
    "output",
    "goal-contract",
    "guarded_dispatch_executor_preflight_report.json",
  );
}

function readJsonIfPresent(file) {
  if (!file || !fs.existsSync(file)) return null;
  return fs.readJsonSync(file);
}

function dryRunSafetyIsIntact(plan) {
  const safety = plan?.safety || {};
  return (
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.dry_run_only === true
  );
}

function humanReviewApprovalGateSafetyIsIntact(report) {
  const safety = report?.safety || {};
  const safePublishPlanSafety = report?.safe_publish_plan?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safePublishPlanSafety.no_publish_triggered === true &&
    safePublishPlanSafety.no_network_uploads === true &&
    safePublishPlanSafety.no_db_mutation === true &&
    safePublishPlanSafety.no_oauth_or_token_change === true &&
    report?.safe_publish_plan?.live_publish_allowed_from_this_tool === false
  );
}

function humanReviewDecisionSheetSafetyIsIntact(report) {
  const safety = report?.safety || {};
  const safePublishPlanSafety = report?.safe_publish_plan?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    report?.safe_publish_plan?.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safePublishPlanSafety.no_publish_triggered === true &&
    safePublishPlanSafety.no_network_uploads === true &&
    safePublishPlanSafety.no_db_mutation === true &&
    safePublishPlanSafety.no_oauth_or_token_change === true
  );
}

function humanReviewOperatorIndexSafetyIsIntact(report) {
  const safety = report?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function humanReviewConsoleSafetyIsIntact(report) {
  const safety = report?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_console === true
  );
}

function humanReviewVisualStripSafetyIsIntact(report) {
  const safety = report?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_visual_strip === true
  );
}

function humanReviewVisualStripQaSafetyIsIntact(report) {
  const safety = report?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.approval_omitted_from_visual_strip_qa === true
  );
}

function parsedTimestampMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function visualStripFreshness(consoleReport = {}, visualStripReport = {}) {
  if (!visualStripReport) return { stale: false, reason: null };

  const consoleDryRunAt =
    consoleReport.source_operator_index_dry_run_generated_at ||
    consoleReport.source_dry_run_generated_at ||
    consoleReport.freshness_reference_generated_at ||
    null;
  const stripDryRunAt = visualStripReport.source_console_dry_run_generated_at || null;
  const dryRunLineageMatches =
    Boolean(consoleDryRunAt && stripDryRunAt) &&
    String(consoleDryRunAt) === String(stripDryRunAt);
  const consoleStrictDryRunAt = consoleReport.source_strict_dry_run_generated_at || null;
  const stripStrictDryRunAt = visualStripReport.source_strict_dry_run_generated_at || null;
  const strictLineageMatches =
    !consoleStrictDryRunAt ||
    !stripStrictDryRunAt ||
    String(consoleStrictDryRunAt) === String(stripStrictDryRunAt);

  const consoleGeneratedAt = consoleReport.generated_at || null;
  const stripSourceConsoleAt = visualStripReport.source_console_generated_at || null;
  const consoleGeneratedMs = parsedTimestampMs(consoleGeneratedAt);
  const stripSourceConsoleMs = parsedTimestampMs(stripSourceConsoleAt);
  if (
    Number.isFinite(consoleGeneratedMs) &&
    Number.isFinite(stripSourceConsoleMs) &&
    stripSourceConsoleMs < consoleGeneratedMs &&
    !(dryRunLineageMatches && strictLineageMatches)
  ) {
    return { stale: true, reason: "source_console_generated_at_older_than_console" };
  }

  const stripGeneratedMs = parsedTimestampMs(visualStripReport.generated_at);
  if (
    Number.isFinite(consoleGeneratedMs) &&
    Number.isFinite(stripGeneratedMs) &&
    stripGeneratedMs < consoleGeneratedMs &&
    !(dryRunLineageMatches && strictLineageMatches)
  ) {
    return { stale: true, reason: "visual_strip_generated_before_console" };
  }

  if (consoleDryRunAt && stripDryRunAt && String(consoleDryRunAt) !== String(stripDryRunAt)) {
    return { stale: true, reason: "source_console_dry_run_generated_at_mismatch" };
  }

  if (
    consoleStrictDryRunAt &&
    stripStrictDryRunAt &&
    String(consoleStrictDryRunAt) !== String(stripStrictDryRunAt)
  ) {
    return { stale: true, reason: "source_strict_dry_run_generated_at_mismatch" };
  }

  return { stale: false, reason: null };
}

function visualStripQaFreshness(visualStripReport = {}, visualStripQaReport = {}) {
  if (!visualStripQaReport || !visualStripReport) return { stale: false, reason: null };

  const qaSourceStripAt = visualStripQaReport.source_visual_strip_generated_at || null;
  const stripGeneratedAt = visualStripReport.generated_at || null;
  if (qaSourceStripAt && stripGeneratedAt && String(qaSourceStripAt) !== String(stripGeneratedAt)) {
    return { stale: true, reason: "source_visual_strip_generated_at_mismatch" };
  }

  const qaGeneratedMs = parsedTimestampMs(visualStripQaReport.generated_at);
  const stripGeneratedMs = parsedTimestampMs(stripGeneratedAt);
  if (
    Number.isFinite(qaGeneratedMs) &&
    Number.isFinite(stripGeneratedMs) &&
    qaGeneratedMs < stripGeneratedMs
  ) {
    return { stale: true, reason: "visual_strip_qa_generated_before_visual_strip" };
  }

  return { stale: false, reason: null };
}

function guardedDispatchPreflightSafetyIsIntact(report) {
  const safety = report?.safety || {};
  const planSafety = report?.guarded_dispatch_plan?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    report?.guarded_dispatch_plan?.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    planSafety.no_publish_triggered === true &&
    planSafety.no_network_uploads === true &&
    planSafety.no_db_mutation === true &&
    planSafety.no_oauth_or_token_change === true
  );
}

function guardedDispatchExecutorPreflightSafetyIsIntact(report) {
  const safety = report?.safety || {};
  const planSafety = report?.executor_plan?.safety || {};
  return (
    report?.safe_to_publish_boolean === false &&
    report?.executor_plan?.live_publish_allowed_from_this_tool === false &&
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    planSafety.no_publish_triggered === true &&
    planSafety.no_network_uploads === true &&
    planSafety.no_db_mutation === true &&
    planSafety.no_oauth_or_token_change === true
  );
}

function strictDryRunQuarantineContext({
  planPath = defaultStrictDryRunPlanPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  const plan = readJsonIfPresent(planPath);
  if (!plan) return { available: false, reason: "strict_dry_run_missing" };
  const generatedMs = Date.parse(plan.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  if (ageHours == null) return { available: false, reason: "strict_dry_run_generated_at_missing" };
  if (ageHours > maxAgeHours) {
    return { available: false, reason: `strict_dry_run_stale:${ageHours.toFixed(1)}h`, age_hours: ageHours };
  }
  if (!dryRunSafetyIsIntact(plan)) {
    return { available: false, reason: "strict_dry_run_safety_contract_missing", age_hours: ageHours };
  }

  const summary = plan.summary || {};
  const activeBlockedStoryCount = numberFromAny(summary.blocked_story_count, plan.blocked_story_count);
  const activeBlockedActionCount = numberFromAny(summary.blocked_action_count, plan.blocked_action_count);
  const readyStoryCount = numberFromAny(summary.ready_story_count, plan.ready_story_count);
  const quarantinedStoryCount = numberFromAny(
    summary.quarantined_incident_guard_failed_story_count,
    summary.total_incident_guard_failed_story_count,
    summary.held_story_count,
    summary.skipped_story_count,
  );
  const activeBlocked =
    normaliseReadinessVerdict(plan.overall_verdict) === RED ||
    activeBlockedStoryCount > 0 ||
    activeBlockedActionCount > 0;

  return {
    available: true,
    generated_at: plan.generated_at || null,
    generated_ms: generatedMs,
    age_hours: ageHours,
    active_blocked: activeBlocked,
    active_blocked_story_count: activeBlockedStoryCount,
    active_blocked_action_count: activeBlockedActionCount,
    ready_story_count: readyStoryCount,
    quarantined_story_count: quarantinedStoryCount,
  };
}

function productionRenderReportSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true &&
    safety.no_gate_weakened === true
  );
}

function platformDurationContractSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    safety.no_publish_triggered === true &&
    safety.no_network_uploads === true &&
    safety.no_db_mutation === true &&
    safety.no_oauth_or_token_change === true
  );
}

function finalVoiceAuditSafetyIsIntact(report = {}) {
  const safety = report.safety || {};
  return (
    safety.read_only === true &&
    safety.mutates_media === false &&
    safety.mutates_production_db === false &&
    safety.mutates_tokens === false &&
    safety.posts_to_platforms === false
  );
}

function isVisualProductionRenderRepairItem(item = {}) {
  const lane = String(item.repair_lane || item.lane || item.stage_id || "").trim();
  const blocker = String(item.blocker_type || "").trim();
  return (
    lane === "visual_v4_production_render" ||
    blocker === "run_visual_v4_production_render"
  );
}

function productionRenderSupersedesRepairBacklog({
  repairBacklog,
  totalItems,
  autoRepairableItems,
  operatorRequiredItems,
  deadEndItems,
  productionRenderReportPath = defaultProductionRenderReportPath(),
  strictDryRunContext,
} = {}) {
  const items = Array.isArray(repairBacklog?.items) ? repairBacklog.items : [];
  if (totalItems <= 0) return { superseded: false, reason: "repair_backlog_empty" };
  if (operatorRequiredItems > 0 || deadEndItems > 0) {
    return { superseded: false, reason: "operator_or_dead_end_repair_debt_present" };
  }
  if (autoRepairableItems < totalItems) {
    return { superseded: false, reason: "non_auto_repair_debt_present" };
  }
  if (items.length > 0 && !items.every(isVisualProductionRenderRepairItem)) {
    return { superseded: false, reason: "non_render_repair_debt_present" };
  }
  if (
    strictDryRunContext?.available !== true ||
    strictDryRunContext.active_blocked === true ||
    Number(strictDryRunContext.ready_story_count || 0) <= 0
  ) {
    return { superseded: false, reason: "clean_strict_dry_run_missing" };
  }

  let productionReport = null;
  try {
    productionReport = readJsonIfPresent(productionRenderReportPath);
  } catch (err) {
    return { superseded: false, reason: `production_render_report_unreadable:${err.message}` };
  }
  if (!productionReport) {
    return { superseded: false, reason: "production_render_report_missing" };
  }

  const backlogGeneratedMs = Date.parse(repairBacklog.generated_at || "");
  const renderGeneratedMs = Date.parse(productionReport.generated_at || "");
  const dryRunGeneratedMs = Number(strictDryRunContext.generated_ms || NaN);
  if (!Number.isFinite(backlogGeneratedMs)) {
    return { superseded: false, reason: "repair_backlog_generated_at_missing" };
  }
  if (!Number.isFinite(renderGeneratedMs) || renderGeneratedMs < backlogGeneratedMs) {
    return { superseded: false, reason: "production_render_report_not_newer_than_backlog" };
  }
  if (!Number.isFinite(dryRunGeneratedMs) || dryRunGeneratedMs < renderGeneratedMs) {
    return { superseded: false, reason: "strict_dry_run_not_newer_than_render_report" };
  }
  if (!productionRenderReportSafetyIsIntact(productionReport)) {
    return { superseded: false, reason: "production_render_report_safety_contract_missing" };
  }

  const summary = productionReport.summary || {};
  const failedCount = Number(summary.failed_count || 0);
  if (failedCount > 0) {
    return { superseded: false, reason: "production_render_report_has_failed_jobs" };
  }
  const jobs = Array.isArray(productionReport.jobs) ? productionReport.jobs : [];
  const renderedStoryIds = new Set(
    jobs
      .filter((job) => String(job?.status || "").trim() === "rendered")
      .map((job) => String(job?.story_id || "").trim())
      .filter(Boolean),
  );
  const requiredStoryIds = items
    .map((item) => String(item?.story_id || "").trim())
    .filter(Boolean);
  const missingRenderedIds = requiredStoryIds.filter((storyId) => !renderedStoryIds.has(storyId));
  if (requiredStoryIds.length > 0 && missingRenderedIds.length > 0) {
    return {
      superseded: false,
      reason: "production_render_report_missing_repaired_story_ids",
      missing_story_ids: missingRenderedIds,
    };
  }

  const renderedCount = numberFromAny(summary.rendered_count, renderedStoryIds.size);
  if (renderedCount < totalItems) {
    return { superseded: false, reason: "production_render_report_rendered_count_too_low" };
  }

  return {
    superseded: true,
    reason: "current_render_report_and_strict_dry_run_clear_render_debt",
    production_render_report_path: productionRenderReportPath,
    production_render_generated_at: productionReport.generated_at || null,
    superseded_repair_items: totalItems,
  };
}

function pillarPublishCadence({ stories = [], env = process.env, now = Date.now() } = {}) {
  const cadenceMod = safeRequire("./publish-cadence");
  if (!cadenceMod || typeof cadenceMod.buildPublishCadenceReport !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    const report = cadenceMod.buildPublishCadenceReport({
      stories,
      jobs: [],
      env,
      now: new Date(now).toISOString(),
      windowHours: 24,
    });
    const summary = report.summary || {};
    const threshold = report.thresholds || {};
    const reasonParts = [];
    if (
      Number(summary.published_count || 0) >
      Number(threshold.max_recommended_posts_per_24h || 3)
    ) {
      reasonParts.push(
        `${summary.published_count}_posts_in_24h_over_cap_${threshold.max_recommended_posts_per_24h || 3}`,
      );
    }
    if (Number(summary.off_schedule_count || 0) > 0) {
      reasonParts.push(`${summary.off_schedule_count}_off_schedule`);
    }
    if (Number(summary.burst_pairs || 0) > 0) {
      reasonParts.push(`${summary.burst_pairs}_tight_spacing_pairs`);
    }
    if (Number(summary.failed_rows_with_platform_ids_recent || 0) > 0) {
      reasonParts.push(
        `${summary.failed_rows_with_platform_ids_recent}_recent_failed_rows_with_platform_ids`,
      );
    }
    if (Number(summary.invalid_public_story_rows || 0) > 0) {
      reasonParts.push(`${summary.invalid_public_story_rows}_invalid_public_rows`);
    }
    return {
      ok: report.verdict === GREEN,
      verdict: report.verdict || UNKNOWN,
      reason:
        reasonParts.join("; ") ||
        report.advisory?.join("; ") ||
        undefined,
      raw: {
        summary,
        thresholds: threshold,
        next_action: report.next_action,
        next_safe_publish: report.next_safe_publish || null,
      },
    };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `cadence: ${err.message}`,
    };
  }
}

async function pillarPlatformStatus({
  stories,
  strictDryRunPlanPath = defaultStrictDryRunPlanPath(),
  platformDoctorPath = defaultPlatformDoctorPath(),
} = {}) {
  const ps = safeRequire("./platform-status");
  if (!ps || typeof ps.buildPlatformStatus !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    const cfg =
      typeof ps.buildPlatformOperationalConfig === "function"
        ? ps.buildPlatformOperationalConfig()
        : null;
    const platformDoctor = readJsonIfPresent(platformDoctorPath);
    const status = ps.buildPlatformStatus({
      env: process.env,
      stories: stories || [],
      platformPosts: [],
      operationalConfig: cfg,
      platformReadinessDoctor: platformDoctor,
    });
    const effectiveStatus = applyStrictPlatformEvidenceToStatus(status, {
      strictDryRunPlan: readJsonIfPresent(strictDryRunPlanPath),
      platformDoctor,
    });
    return {
      ok: true,
      verdict: effectiveStatus.verdict || GREEN,
      reason: summarisePlatformStatusReason(effectiveStatus),
      raw: effectiveStatus,
    };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `platform_status: ${err.message}`,
    };
  }
}

async function pillarMediaVerify({ stories, planPath = defaultStrictDryRunPlanPath() } = {}) {
  const mv = safeRequire("./media-verify");
  if (!mv || typeof mv.verifyMedia !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    let verificationStories = stories || [];
    let scope = "db_stories";
    let dryRunPlan = null;
    try {
      dryRunPlan = readJsonIfPresent(planPath);
      const dryRunMediaStories = buildMediaVerifyStoriesFromDryRunPlan(dryRunPlan);
      if (dryRunMediaStories.length > 0) {
        verificationStories = dryRunMediaStories;
        scope = "strict_dry_run_actions";
      }
    } catch {
      dryRunPlan = null;
    }
    const r = await mv.verifyMedia({ stories: verificationStories });
    r.scope = scope;
    r.strict_dry_run_plan_path = planPath;
    r.strict_dry_run_action_media_count =
      scope === "strict_dry_run_actions" ? verificationStories.length : 0;
    r.db_story_count = Array.isArray(stories) ? stories.length : 0;
    r.strict_dry_run_generated_at = dryRunPlan?.generated_at || null;
    return {
      ok: true,
      verdict: r.verdict || (r.issueCount > 0 ? AMBER : GREEN),
      reason: summariseMediaVerifyReason(r),
      raw: r,
    };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `media_verify: ${err.message}`,
    };
  }
}

async function pillarMediaInventory({ stories } = {}) {
  // Re-runs media-inventory-scorer over recent stories to surface the
  // "blog_only / short_only" distribution the audit flagged as the
  // primary creative bottleneck.
  const scorer = safeRequire("../creative/media-inventory-scorer");
  if (!scorer || typeof scorer.scoreStoryMediaInventory !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  const recent = (stories || [])
    .filter((s) => s && s.exported_path)
    .slice(0, 30);
  if (recent.length === 0) {
    return { ok: false, verdict: UNKNOWN, reason: "no_exported_stories" };
  }
  const counts = {};
  for (const s of recent) {
    try {
      const score = scorer.scoreStoryMediaInventory(s);
      const cls = (score && score.inventory_class) || "unknown";
      counts[cls] = (counts[cls] || 0) + 1;
    } catch {
      counts.unknown = (counts.unknown || 0) + 1;
    }
  }
  const blogOnly = counts.blog_only || 0;
  const total = recent.length;
  const blogPct = total > 0 ? blogOnly / total : 0;
  let verdict = GREEN;
  if (blogPct >= 0.7) verdict = RED;
  else if (blogPct >= 0.4) verdict = AMBER;
  return {
    ok: true,
    verdict,
    raw: {
      counts,
      blog_only_pct: Math.round(blogPct * 100),
      sample_size: total,
    },
  };
}

function pillarTopicalityGate() {
  // The topicality gate is wired into auto-approve. This pillar just
  // confirms the module is loadable + the live auto-approve path uses
  // it. RED only if the module is broken.
  const t = safeRequire("../topicality-gate");
  if (!t || typeof t.evaluatePulseGamingTopicality !== "function") {
    return { ok: false, verdict: AMBER, reason: "module_unavailable" };
  }
  return { ok: true, verdict: GREEN, raw: { module_loaded: true } };
}

function pillarVisualCountGate({ env } = {}) {
  const block = String(env?.BLOCK_THIN_VISUALS || "").toLowerCase() === "true";
  return {
    ok: true,
    verdict: GREEN,
    raw: {
      mode: block ? "blocking" : "warn_only",
      blocked_env_set: block,
    },
  };
}

function pillarThumbnailSafety() {
  const t = safeRequire("../thumbnail-safety");
  if (!t) return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  // Heuristic gate; pixel-level visual prescan added 2026-04-30.
  return {
    ok: true,
    verdict: GREEN,
    raw: { module_loaded: true, layered_with: "visual-content-prescan" },
  };
}

function storyId(story = {}) {
  return String(story.id || story.story_id || story.storyId || "").trim();
}

function renderMetadataCounts(stories = []) {
  let stamped = 0;
  const laneCounts = {};
  const classCounts = {};
  for (const s of stories) {
    if (s.render_lane) {
      stamped++;
      laneCounts[s.render_lane] = (laneCounts[s.render_lane] || 0) + 1;
    }
    if (s.render_quality_class) {
      classCounts[s.render_quality_class] =
        (classCounts[s.render_quality_class] || 0) + 1;
    }
  }
  const total = stories.length;
  const stampedPct = total > 0 ? stamped / total : 0;
  return {
    stamped,
    total,
    stamped_pct: Math.round(stampedPct * 100),
    lane_counts: laneCounts,
    class_counts: classCounts,
  };
}

function strictDryRunStoryIds(plan = {}) {
  const idsFrom = (rows) =>
    new Set(
      (Array.isArray(rows) ? rows : [])
        .map((row) => String(row?.story_id || row?.id || "").trim())
        .filter(Boolean),
    );
  return {
    active: idsFrom(plan.ready_stories),
    quarantined: new Set([
      ...idsFrom(plan.blocked_stories),
      ...idsFrom(plan.held_stories),
      ...idsFrom(plan.skipped_stories),
    ]),
  };
}

function bridgeCandidateRows(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (Array.isArray(value?.scheduler_bridge_candidates)) {
    return value.scheduler_bridge_candidates.filter(Boolean);
  }
  if (Array.isArray(value?.candidates)) return value.candidates.filter(Boolean);
  return [];
}

function scopedRenderStories({ recent = [], ids = new Set(), bridgeCandidates = [] } = {}) {
  const byId = new Map();
  for (const row of recent) {
    const id = storyId(row);
    if (ids.has(id)) byId.set(id, row);
  }
  for (const row of bridgeCandidates) {
    const id = storyId(row);
    if (ids.has(id)) byId.set(id, row);
  }
  return [...byId.values()];
}

function legacyOrFallbackRenderCount(stories = []) {
  return stories.filter((s) => {
    const lane = String(s.render_lane || "");
    const quality = String(s.render_quality_class || "");
    return lane === "legacy_multi_image" || quality === "fallback";
  }).length;
}

function pillarRenderMetadata({
  stories,
  strictDryRunPlanPath = defaultStrictDryRunPlanPath(),
  schedulerBridgeCandidatesPath = defaultSchedulerBridgeCandidatesPath(),
} = {}) {
  // Reports stamped/unstamped breakdown over recent stories.
  const recent = (stories || [])
    .filter((s) => s && s.exported_path)
    .slice(0, 30);
  if (recent.length === 0) {
    return { ok: false, verdict: UNKNOWN, reason: "no_exported_stories" };
  }
  const aggregate = renderMetadataCounts(recent);
  let verdict = GREEN;
  if (aggregate.stamped / aggregate.total < 0.5) verdict = AMBER;

  const plan = readJsonIfPresent(strictDryRunPlanPath);
  if (plan && dryRunSafetyIsIntact(plan)) {
    const ids = strictDryRunStoryIds(plan);
    if (ids.active.size || ids.quarantined.size) {
      const bridgeCandidates = bridgeCandidateRows(readJsonIfPresent(schedulerBridgeCandidatesPath));
      const active = scopedRenderStories({
        recent,
        ids: ids.active,
        bridgeCandidates,
      });
      const quarantined = recent.filter((s) => ids.quarantined.has(storyId(s)));
      const activeCounts = renderMetadataCounts(active);
      const quarantinedCounts = renderMetadataCounts(quarantined);
      const activeLegacyOrFallback = legacyOrFallbackRenderCount(active);
      const quarantinedLegacyOrFallback = legacyOrFallbackRenderCount(quarantined);
      const activeStampedRatio =
        activeCounts.total > 0 ? activeCounts.stamped / activeCounts.total : 0;
      let scopedVerdict = GREEN;
      let reason;
      if (activeCounts.total === 0) {
        scopedVerdict = UNKNOWN;
        reason = "strict_dry_run_active_render_metadata_missing";
      } else if (activeStampedRatio < 0.5) {
        scopedVerdict = AMBER;
        reason = "strict_dry_run_active_render_metadata_understamped";
      } else if (activeLegacyOrFallback > 0) {
        scopedVerdict = AMBER;
        reason = "strict_dry_run_active_legacy_or_fallback_render_debt";
      }
      return {
        ok: scopedVerdict !== UNKNOWN,
        verdict: scopedVerdict,
        reason,
        raw: {
          ...aggregate,
          readiness_scope: "strict_dry_run_scoped",
          strict_dry_run_plan_path: strictDryRunPlanPath,
          scheduler_bridge_candidates_path: schedulerBridgeCandidatesPath,
          active: activeCounts,
          quarantined: quarantinedCounts,
          active_legacy_or_fallback_count: activeLegacyOrFallback,
          quarantined_legacy_or_fallback_count: quarantinedLegacyOrFallback,
        },
      };
    }
  }

  return {
    ok: true,
    verdict,
    raw: aggregate,
  };
}

function pillarInstagramPending({ stories } = {}) {
  // Counts stories with instagram_error containing pending_processing_timeout
  // and no instagram_media_id yet.
  const pending = (stories || []).filter(
    (s) =>
      s &&
      s.instagram_error &&
      /pending_processing_timeout/.test(s.instagram_error) &&
      !s.instagram_media_id,
  );
  let verdict = GREEN;
  if (pending.length >= 3) verdict = AMBER;
  return {
    ok: true,
    verdict,
    raw: {
      pending_count: pending.length,
      ids: pending.map((s) => s.id).slice(0, 10),
    },
  };
}

function pillarTiktokExternalBlock({ doctorPath = defaultPlatformDoctorPath() } = {}) {
  const doctor = readJsonIfPresent(doctorPath);
  const doctorReason = summariseTiktokExternalBlockReason(doctor || {});
  if (doctorReason) {
    return {
      ok: true,
      verdict: AMBER,
      reason: doctorReason,
      raw: {
        mode: "externally_or_operator_blocked",
        source: "platform_readiness_doctor",
        doctor_path: doctorPath,
        tiktok_status: doctor?.platforms?.tiktok?.status || null,
        recommendation: doctor?.platforms?.tiktok?.recommendation || null,
      },
    };
  }
  // External blocker — report it honestly, not as our bug.
  return {
    ok: true,
    verdict: AMBER,
    reason: "tiktok_api_app_review",
    raw: {
      mode: "externally_blocked",
      cause: "tiktok_api_app_review",
      action: "manual_dispatch_via_tools/tiktok-dispatch-pack.js",
    },
  };
}

function pillarFacebookReelEligibility({ evidencePath = null } = {}) {
  const fs = require("fs-extra");
  const path = require("node:path");
  const resolvedEvidencePath = evidencePath || path.join(
    __dirname,
    "..",
    "..",
    "test",
    "output",
    "facebook_reels_eligibility.json",
  );
  try {
    if (fs.pathExistsSync(resolvedEvidencePath)) {
      const report = fs.readJsonSync(resolvedEvidencePath);
      const classification = report?.classification || {};
      const evidence = report?.evidence || {};
      const eligible =
        classification.verdict === "eligible_for_normal_publish" &&
        evidence?.page?.data?.can_post === true &&
        evidence?.tokenDebug?.data?.is_valid === true &&
        (Number(evidence?.videos?.count || 0) > 0 ||
          Number(evidence?.reels?.count || 0) > 0);
      if (eligible) {
        return {
          ok: true,
          verdict: GREEN,
          raw: {
            mode: "graph_verified",
            cause: classification.reason || "visible_graph_video_or_reel_found",
            action: "facebook_reel_attempts_enabled_with_strict_verifier_and_card_fallback",
            videos_count: Number(evidence?.videos?.count || 0),
            reels_count: Number(evidence?.reels?.count || 0),
          },
        };
      }
    }
  } catch {
    // Fall back to cautious amber below. This pillar is advisory and
    // must never throw the whole readiness report.
  }
  return {
    ok: true,
    verdict: AMBER,
    raw: {
      mode: "graph_probe_available",
      cause: "manual_reel_and_graph_evidence_present",
      action: "facebook_reel_attempts_enabled_by_default_with_card_fallback",
    },
  };
}

function pillarFacebookCardFallback({ stories } = {}) {
  const fbCards = (stories || []).filter(
    (s) => s && (s.facebook_card_post_id || s.facebook_post_id),
  );
  return {
    ok: true,
    verdict: GREEN,
    raw: { recent_with_fb_card: fbCards.length },
  };
}

function parseFailureList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
  } catch {
    /* fall through */
  }
  return value
    .split(/[;,]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function firstFailureReason(story) {
  const qaFailures = parseFailureList(story?.qa_failures);
  if (qaFailures.length > 0) return `qa:${qaFailures[0]}`;
  if (story?.publish_error) return String(story.publish_error).slice(0, 160);
  if (story?.render_contract_blocked === true) return "render_contract_blocked";
  return "qa:unknown";
}

function sortFailureTime(story) {
  const raw =
    story?.qa_failed_at || story?.updated_at || story?.created_at || story?.timestamp;
  const ts = Date.parse(raw || "");
  return Number.isFinite(ts) ? ts : 0;
}

function failureReasonGroup(reason) {
  return String(reason || "qa:unknown")
    .replace(/\s*\([^)]*\)\s*$/, "")
    .slice(0, 120);
}

function summariseRecentFailedCandidates(
  stories = [],
  { limit = 10, now = Date.now(), recentWindowHours = 24 } = {},
) {
  const nowMs = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const windowMs = Math.max(1, Number(recentWindowHours) || 24) * 60 * 60 * 1000;
  const cutoff = nowMs - windowMs;
  const repairedPublicRows = (stories || []).filter((s) => {
    const publishError = String(s?.publish_error || "");
    return (
      s &&
      s.qa_failed === true &&
      (
        publishError.includes("script_validation_review_required_public_row_repair") ||
        s.public_row_repair
      )
    );
  });
  const allFailed = (stories || [])
    .filter((s) => s && s.qa_failed === true && !repairedPublicRows.includes(s))
    .sort((a, b) => sortFailureTime(b) - sortFailureTime(a));
  const recentWindow = allFailed.filter((s) => {
    const t = sortFailureTime(s);
    return t > 0 && t >= cutoff;
  });
  const recent = allFailed.slice(0, limit);
  const examples = recent.map((s) => ({
    id: s.id,
    title: (s.title || "").slice(0, 120),
    reason: firstFailureReason(s),
    qa_failed_at: s.qa_failed_at || null,
    render_lane: s.render_lane || null,
    render_quality_class: s.render_quality_class || null,
  }));
  const reasonGroups = new Map();
  for (const s of recentWindow) {
    const group = failureReasonGroup(firstFailureReason(s));
    reasonGroups.set(group, (reasonGroups.get(group) || 0) + 1);
  }
  const latestTime = allFailed.length > 0 ? sortFailureTime(allFailed[0]) : 0;
  return {
    count: allFailed.length,
    repaired_public_row_count: repairedPublicRows.length,
    recent_window_hours: recentWindowHours,
    recent_count: recentWindow.length,
    latest_failed_at: latestTime > 0 ? new Date(latestTime).toISOString() : null,
    latest_failed_age_hours:
      latestTime > 0 ? Math.max(0, (nowMs - latestTime) / (60 * 60 * 1000)) : null,
    reason_groups: [...reasonGroups.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([reason, count]) => ({ reason, count })),
    shown_count: recent.length,
    ids: recent.map((s) => s.id),
    examples,
  };
}

function blockedActionReasons(action = {}) {
  return [...new Set([
    ...(Array.isArray(action.blockers) ? action.blockers : []),
    ...(Array.isArray(action.live_execution_gate_reasons)
      ? action.live_execution_gate_reasons
      : []),
  ]
    .map((reason) => String(reason || "").trim())
    .filter(Boolean))];
}

function summarizeBlockedActionReasons(actions = []) {
  const counts = new Map();
  for (const action of Array.isArray(actions) ? actions : []) {
    for (const reason of blockedActionReasons(action)) {
      counts.set(reason, (counts.get(reason) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({ reason, count }));
}

function isPlatformVariantOnlyBlockedAction(action = {}) {
  const reasons = blockedActionReasons(action);
  return (
    reasons.length > 0 &&
    reasons.every((reason) => /^platform_variant_stale_after_render:[a-z0-9_]+$/i.test(reason)) &&
    action.live_publish_allowed_from_dry_run !== true
  );
}

function isEnabledHumanReviewDryRunAction(action = {}) {
  const liveGate = String(action.live_execution_gate || "").trim().toLowerCase();
  return (
    action.action === "would_publish" &&
    action.platform_enabled !== false &&
    !(Array.isArray(action.blockers) && action.blockers.length > 0) &&
    action.live_publish_allowed_from_dry_run !== true &&
    (!liveGate || liveGate === "human_review_required" || liveGate === "operator_human_review_required")
  );
}

function pillarStrictDryRunControl({
  planPath = defaultStrictDryRunPlanPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let plan = null;
  try {
    plan = readJsonIfPresent(planPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `strict_dry_run_unreadable:${err.message}`,
      raw: { plan_path: planPath },
    };
  }

  if (!plan) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "strict_dry_run_missing",
      raw: { plan_path: planPath },
    };
  }

  const summary = plan.summary || {};
  const generatedMs = Date.parse(plan.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const disabledPlatformCount =
    Number(plan.platform_upload_preflight_report?.summary?.disabled_platform_count || 0);
  const blockedActions = Array.isArray(plan.blocked_actions) ? plan.blocked_actions : [];
  const actionList = Array.isArray(plan.actions) ? plan.actions : [];
  const blockedActionReasonGroups = summarizeBlockedActionReasons(blockedActions);
  const blockedActionsArePlatformVariantOnly =
    blockedActions.length > 0 && blockedActions.every(isPlatformVariantOnlyBlockedAction);
  const reviewableEnabledActions = actionList.filter(isEnabledHumanReviewDryRunAction);
  const raw = {
    plan_path: planPath,
    generated_at: plan.generated_at || null,
    overall_verdict: String(plan.overall_verdict || "").toLowerCase() || null,
    ready_for_unattended_publish: plan.ready_for_unattended_publish === true,
    readiness_reasons: Array.isArray(plan.readiness_reasons)
      ? plan.readiness_reasons
      : [],
    ready_story_count: Number(summary.ready_story_count || 0),
    blocked_story_count: Number(summary.blocked_story_count || 0),
    held_story_count: Number(summary.held_story_count || 0),
    skipped_story_count: Number(summary.skipped_story_count || 0),
    platform_publish_now_action_count: Number(
      summary.platform_publish_now_action_count || 0,
    ),
    platform_deferred_action_count: Number(
      summary.platform_deferred_action_count || 0,
    ),
    blocked_action_count: Number(summary.blocked_action_count || 0),
    warning_action_count: Number(summary.warning_action_count || 0),
    human_review_required_action_count: Number(
      summary.human_review_required_action_count || 0,
    ),
    live_publish_allowed_action_count: Number(
      summary.live_publish_allowed_action_count || 0,
    ),
    disabled_platform_count: disabledPlatformCount,
    reviewable_enabled_action_count: reviewableEnabledActions.length,
    blocked_actions_platform_variant_only: blockedActionsArePlatformVariantOnly,
    blocked_action_reason_groups: blockedActionReasonGroups,
    age_hours: ageHours,
    safety_intact: dryRunSafetyIsIntact(plan),
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "strict_dry_run_safety_contract_missing",
      raw,
    };
  }

  if (raw.blocked_story_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "strict_dry_run_blocked",
      raw,
    };
  }

  if (raw.overall_verdict === RED || raw.blocked_action_count > 0) {
    if (
      raw.ready_story_count > 0 &&
      raw.platform_publish_now_action_count > 0 &&
      raw.human_review_required_action_count > 0 &&
      raw.live_publish_allowed_action_count === 0 &&
      raw.reviewable_enabled_action_count > 0 &&
      raw.blocked_actions_platform_variant_only === true
    ) {
      return {
        ok: true,
        verdict: AMBER,
        reason: "human_review_ready_with_platform_variant_blockers",
        raw,
      };
    }
    return {
      ok: false,
      verdict: RED,
      reason: "strict_dry_run_blocked",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `strict_dry_run_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (plan.ready_for_unattended_publish !== true) {
    const reason =
      raw.ready_story_count > 0
        ? "human_review_required_or_platforms_deferred"
        : "strict_dry_run_not_publish_ready";
    return {
      ok: true,
      verdict: AMBER,
      reason,
      raw,
    };
  }

  return {
    ok: true,
    verdict: GREEN,
    raw,
  };
}

function pillarRepairBacklog({
  repairBacklogPath = defaultRepairBacklogPath(),
  strictDryRunPlanPath = defaultStrictDryRunPlanPath(),
  productionRenderReportPath = defaultProductionRenderReportPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(repairBacklogPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `repair_backlog_unreadable:${err.message}`,
      raw: { repair_backlog_path: repairBacklogPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: UNKNOWN,
      reason: "repair_backlog_missing",
      raw: { repair_backlog_path: repairBacklogPath },
    };
  }

  const summary = report.summary || {};
  const items = Array.isArray(report.items) ? report.items : [];
  const totalItems = numberFromAny(summary.total_items, items.length);
  const autoRepairableItems = numberFromAny(
    summary.auto_repairable_items,
    summary.auto_repairable_jobs,
    items.filter((item) => item?.auto_repairable === true).length,
  );
  const operatorRequiredItems = numberFromAny(
    summary.operator_required_items,
    summary.operator_required_jobs,
    items.filter(
      (item) =>
        item?.operator_approval_required === true ||
        item?.operator_approval_needed === true,
    ).length,
  );
  const deadEndItems = numberFromAny(
    summary.dead_end_items,
    summary.dead_end_blocker_items,
    summary.dead_end_blockers,
    items.filter((item) => item?.dead_end_blocker === true).length,
  );
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const topLanes = repairBacklogLaneCounts(report).slice(0, 5);
  const raw = {
    repair_backlog_path: repairBacklogPath,
    generated_at: report.generated_at || null,
    age_hours: ageHours,
    total_items: totalItems,
    auto_repairable_items: autoRepairableItems,
    operator_required_items: operatorRequiredItems,
    dead_end_items: deadEndItems,
    publish_blocker_resolution_items: numberFromAny(
      summary.publish_blocker_resolution_items,
      items.filter((item) => item?.source === "publish_blocker_resolution").length,
    ),
    top_lanes: topLanes,
  };
  const publishBlockerResolutionItems = raw.publish_blocker_resolution_items;

  if (ageHours == null) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "repair_backlog_generated_at_missing",
      raw,
    };
  }

  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `repair_backlog_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (totalItems > 0) {
    const quarantineContext = strictDryRunQuarantineContext({
      planPath: strictDryRunPlanPath,
      now,
      maxAgeHours,
    });
    const supersession = productionRenderSupersedesRepairBacklog({
      repairBacklog: report,
      totalItems,
      autoRepairableItems,
      operatorRequiredItems,
      deadEndItems,
      productionRenderReportPath,
      strictDryRunContext: quarantineContext,
    });
    if (supersession.superseded === true) {
      return {
        ok: true,
        verdict: GREEN,
        raw: {
          ...raw,
          readiness_scope: "superseded_by_clean_strict_dry_run",
          active_publish_blocker_items: 0,
          superseded_repair_items: supersession.superseded_repair_items,
          production_render_report_path: supersession.production_render_report_path,
          production_render_generated_at: supersession.production_render_generated_at,
          strict_dry_run_context: quarantineContext,
        },
      };
    }
    const allItemsRequireOperatorOrDeadEnd =
      autoRepairableItems === 0 &&
      operatorRequiredItems + deadEndItems >= totalItems;
    const quarantinedDebtOnly =
      publishBlockerResolutionItems === 0 &&
      allItemsRequireOperatorOrDeadEnd &&
      quarantineContext.available === true &&
      quarantineContext.active_blocked === false &&
      quarantineContext.ready_story_count > 0;
    if (quarantinedDebtOnly) {
      return {
        ok: true,
        verdict: AMBER,
        reason: `quarantined_debt:${summariseRepairBacklogReason(report)}`,
        raw: {
          ...raw,
          readiness_scope: "quarantined_debt",
          active_publish_blocker_items: 0,
          strict_dry_run_context: quarantineContext,
        },
      };
    }
    return {
      ok: false,
      verdict: deadEndItems > 0 ? RED : AMBER,
      reason: summariseRepairBacklogReason(report),
      raw: {
        ...raw,
        readiness_scope: "active_or_unproven_repair_debt",
        active_publish_blocker_items: totalItems,
        supersession_reason: supersession.reason,
        strict_dry_run_context: quarantineContext,
      },
    };
  }

  return {
    ok: true,
    verdict: GREEN,
    raw,
  };
}

function countJobsByReadinessScope(jobs = []) {
  let active = 0;
  let quarantined = 0;
  for (const job of Array.isArray(jobs) ? jobs : []) {
    const scope = String(job?.readiness_scope || "").trim().toLowerCase();
    if (scope === "quarantined") quarantined += 1;
    else active += 1;
  }
  return { active, quarantined };
}

function summarisePlatformDurationContractReason(raw = {}) {
  const parts = [];
  if (Number(raw.active_blocked_count || 0) > 0) {
    parts.push(`active_duration_blockers=${raw.active_blocked_count}`);
  }
  if (Number(raw.active_variant_repair_required_count || 0) > 0) {
    parts.push(`active_variant_repairs=${raw.active_variant_repair_required_count}`);
  }
  if (Number(raw.active_tiktok_creator_rewards_variant_required_count || 0) > 0) {
    parts.push(
      `active_tiktok_creator_rewards_variants=${raw.active_tiktok_creator_rewards_variant_required_count}`,
    );
  }
  if (parts.length === 0) parts.push("active_duration_clean");
  if (Number(raw.quarantined_blocked_count || 0) > 0) {
    parts.push(`quarantined_blocked=${raw.quarantined_blocked_count}`);
  }
  if (Number(raw.quarantined_variant_repair_required_count || 0) > 0) {
    parts.push(`quarantined_variant_repairs=${raw.quarantined_variant_repair_required_count}`);
  }
  if (Number(raw.quarantined_tiktok_creator_rewards_variant_required_count || 0) > 0) {
    parts.push(
      `quarantined_tiktok_creator_rewards_variants=${raw.quarantined_tiktok_creator_rewards_variant_required_count}`,
    );
  }
  return parts.join("; ");
}

function finalVoiceAuditRowCounts(rows = []) {
  const counts = { pass: 0, review: 0, reject: 0, skip: 0, unknown: 0 };
  for (const row of Array.isArray(rows) ? rows : []) {
    const verdict = String(row?.verdict || "").trim().toLowerCase();
    if (Object.prototype.hasOwnProperty.call(counts, verdict)) counts[verdict] += 1;
    else counts.unknown += 1;
  }
  return counts;
}

function normaliseComparablePath(filePath) {
  if (!filePath) return "";
  return path.resolve(String(filePath)).toLowerCase();
}

function activeVideoPathSetFromManifest(manifest = {}) {
  const videos = Array.isArray(manifest.videos) ? manifest.videos : [];
  const paths = new Set();
  for (const video of videos) {
    const normalised = normaliseComparablePath(video?.video_path || video?.videoPath);
    if (normalised) paths.add(normalised);
  }
  return paths;
}

function summariseFinalVoiceAuditReason(raw = {}) {
  const parts = [];
  if (Number(raw.active_reject_count || 0) > 0) {
    parts.push(`active_voice_reject=${raw.active_reject_count}`);
  }
  if (Number(raw.active_review_count || 0) > 0) {
    parts.push(`active_voice_review=${raw.active_review_count}`);
  }
  if (Number(raw.active_unknown_count || 0) > 0) {
    parts.push(`active_voice_unknown=${raw.active_unknown_count}`);
  }
  if (Number(raw.active_row_count || 0) === 0) {
    parts.push("active_voice_rows_missing");
  }
  if (parts.length === 0) parts.push("active_voice_clean");
  if (Number(raw.quarantined_reject_count || 0) > 0) {
    parts.push(`quarantined_reject=${raw.quarantined_reject_count}`);
  }
  if (Number(raw.quarantined_review_count || 0) > 0) {
    parts.push(`quarantined_review=${raw.quarantined_review_count}`);
  }
  if (Number(raw.quarantined_unknown_count || 0) > 0) {
    parts.push(`quarantined_unknown=${raw.quarantined_unknown_count}`);
  }
  return parts.join("; ");
}

function pillarPlatformDurationContract({
  reportPath = defaultPlatformDurationContractReportPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `platform_duration_contract_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: UNKNOWN,
      reason: "platform_duration_contract_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  const blocked = Array.isArray(report.blocked) ? report.blocked : [];
  const activeBlocked = blocked.filter(
    (item) => String(item?.readiness_scope || "").trim().toLowerCase() !== "quarantined",
  ).length;
  const quarantinedBlocked = blocked.length - activeBlocked;
  const variantScopeCounts = countJobsByReadinessScope(report.variant_repair_work_order?.jobs);
  const tiktokScopeCounts = countJobsByReadinessScope(
    report.tiktok_creator_rewards_variant_work_order?.jobs,
  );
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;

  const raw = {
    report_path: reportPath,
    generated_at: report.generated_at || null,
    age_hours: ageHours,
    package_count: numberFromAny(summary.package_count),
    blocked_count: numberFromAny(summary.blocked_count, blocked.length),
    active_blocked_count: numberFromAny(summary.active_blocked_count, activeBlocked),
    quarantined_blocked_count: numberFromAny(summary.quarantined_blocked_count, quarantinedBlocked),
    active_variant_repair_required_count: numberFromAny(
      summary.active_variant_repair_required_count,
      variantScopeCounts.active,
    ),
    quarantined_variant_repair_required_count: numberFromAny(
      summary.quarantined_variant_repair_required_count,
      variantScopeCounts.quarantined,
    ),
    active_tiktok_creator_rewards_variant_required_count: numberFromAny(
      summary.active_tiktok_creator_rewards_variant_required_count,
      tiktokScopeCounts.active,
    ),
    quarantined_tiktok_creator_rewards_variant_required_count: numberFromAny(
      summary.quarantined_tiktok_creator_rewards_variant_required_count,
      tiktokScopeCounts.quarantined,
    ),
    safety_intact: platformDurationContractSafetyIsIntact(report),
  };

  const reason = summarisePlatformDurationContractReason(raw);

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "platform_duration_contract_safety_contract_missing",
      raw,
    };
  }
  if (ageHours == null) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "platform_duration_contract_generated_at_missing",
      raw,
    };
  }
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `platform_duration_contract_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }
  if (raw.active_blocked_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason,
      raw,
    };
  }
  if (
    raw.active_variant_repair_required_count > 0 ||
    raw.active_tiktok_creator_rewards_variant_required_count > 0
  ) {
    return {
      ok: false,
      verdict: AMBER,
      reason,
      raw,
    };
  }

  return {
    ok: true,
    verdict: GREEN,
    reason,
    raw,
  };
}

function pillarFinalVoiceAudit({
  auditPath = defaultFinalVoiceAuditPath(),
  localTestManifestPath = defaultLocalTestVideoManifestPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  let manifest = null;
  try {
    report = readJsonIfPresent(auditPath);
    manifest = readJsonIfPresent(localTestManifestPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `final_voice_audit_unreadable:${err.message}`,
      raw: { audit_path: auditPath, local_test_manifest_path: localTestManifestPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: UNKNOWN,
      reason: "final_voice_audit_missing",
      raw: { audit_path: auditPath, local_test_manifest_path: localTestManifestPath },
    };
  }

  const rows = Array.isArray(report.rows) ? report.rows : [];
  const activePaths = activeVideoPathSetFromManifest(manifest || {});
  const scopedToManifest = activePaths.size > 0;
  const activeRows = scopedToManifest
    ? rows.filter((row) => activePaths.has(normaliseComparablePath(row?.mp4_path)))
    : rows;
  const quarantinedRows = scopedToManifest
    ? rows.filter((row) => !activePaths.has(normaliseComparablePath(row?.mp4_path)))
    : [];
  const activeCounts = finalVoiceAuditRowCounts(activeRows);
  const quarantinedCounts = finalVoiceAuditRowCounts(quarantinedRows);
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    audit_path: auditPath,
    local_test_manifest_path: localTestManifestPath,
    generated_at: report.generated_at || null,
    age_hours: ageHours,
    scoped_to_local_test_manifest: scopedToManifest,
    total_row_count: rows.length,
    active_row_count: activeRows.length,
    quarantined_row_count: quarantinedRows.length,
    active_pass_count: activeCounts.pass,
    active_review_count: activeCounts.review,
    active_reject_count: activeCounts.reject,
    active_skip_count: activeCounts.skip,
    active_unknown_count: activeCounts.unknown,
    quarantined_pass_count: quarantinedCounts.pass,
    quarantined_review_count: quarantinedCounts.review,
    quarantined_reject_count: quarantinedCounts.reject,
    quarantined_skip_count: quarantinedCounts.skip,
    quarantined_unknown_count: quarantinedCounts.unknown,
    safety_intact: finalVoiceAuditSafetyIsIntact(report),
  };
  const reason = summariseFinalVoiceAuditReason(raw);

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "final_voice_audit_safety_contract_missing",
      raw,
    };
  }
  if (ageHours == null) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "final_voice_audit_generated_at_missing",
      raw,
    };
  }
  if (ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `final_voice_audit_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }
  if (activeRows.length === 0) {
    return {
      ok: false,
      verdict: AMBER,
      reason,
      raw,
    };
  }
  if (raw.active_reject_count > 0 || raw.active_unknown_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason,
      raw,
    };
  }
  if (raw.active_review_count > 0) {
    return {
      ok: false,
      verdict: AMBER,
      reason,
      raw,
    };
  }

  return {
    ok: true,
    verdict: GREEN,
    reason,
    raw,
  };
}

function pillarHumanReviewApprovalGate({
  reportPath = defaultHumanReviewApprovalGateReportPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_approval_gate_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "human_review_approval_gate_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    report_path: reportPath,
    generated_at: report.generated_at || null,
    approval_gate_verdict: String(report.verdict || "").toLowerCase() || null,
    review_packet_count: Number(summary.review_packet_count || 0),
    decision_count: Number(summary.decision_count || 0),
    approved_story_count: Number(summary.approved_story_count || 0),
    approved_action_count: Number(summary.approved_action_count || 0),
    pending_review_packet_count: Number(summary.pending_review_packet_count || 0),
    invalid_decision_count: Number(summary.invalid_decision_count || 0),
    rejected_story_count: Number(summary.rejected_story_count || 0),
    repair_requested_story_count: Number(summary.repair_requested_story_count || 0),
    guarded_dispatch_eligible: report.safe_publish_plan?.guarded_dispatch_eligible === true,
    live_publish_allowed_from_this_tool:
      report.safe_publish_plan?.live_publish_allowed_from_this_tool === true,
    required_next_step: report.safe_publish_plan?.required_next_step || null,
    advisory: Array.isArray(report.advisory) ? report.advisory : [],
    age_hours: ageHours,
    safety_intact: humanReviewApprovalGateSafetyIsIntact(report),
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_approval_gate_safety_contract_missing",
      raw,
    };
  }

  if (raw.approval_gate_verdict === RED || raw.invalid_decision_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_approval_gate_invalid_decisions",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_approval_gate_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (raw.approved_action_count > 0 && raw.guarded_dispatch_eligible === true) {
    return {
      ok: true,
      verdict: GREEN,
      raw,
    };
  }

  if (raw.review_packet_count > 0 && raw.decision_count === 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "no_recorded_operator_decisions",
      raw,
    };
  }

  if (raw.pending_review_packet_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "review_packets_still_pending_operator_decision",
      raw,
    };
  }

  if (raw.repair_requested_story_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "operator_requested_repairs",
      raw,
    };
  }

  if (raw.rejected_story_count > 0 && raw.approved_action_count <= 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "operator_rejected_all_reviewed_stories",
      raw,
    };
  }

  return {
    ok: true,
    verdict: AMBER,
    reason: "human_review_approval_gate_has_no_guarded_actions",
    raw,
  };
}

function pillarHumanReviewDecisionSheet({
  reportPath = defaultHumanReviewDecisionSheetPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_decision_sheet_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "human_review_decision_sheet_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    report_path: reportPath,
    generated_at: report.generated_at || null,
    decision_sheet_verdict: String(report.verdict || "").toLowerCase() || null,
    decision_slot_count: Number(summary.decision_slot_count || 0),
    pending_decision_count: Number(summary.pending_decision_count || 0),
    already_decided_count: Number(summary.already_decided_count || 0),
    blocked_input_count: Number(summary.blocked_input_count || 0),
    live_publish_allowed_from_this_tool:
      report.safe_publish_plan?.live_publish_allowed_from_this_tool === true,
    can_publish_without_operator: report.safe_publish_plan?.can_publish_without_operator === true,
    required_next_step: report.safe_publish_plan?.required_next_step || null,
    age_hours: ageHours,
    safety_intact: humanReviewDecisionSheetSafetyIsIntact(report),
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_decision_sheet_safety_contract_missing",
      raw,
    };
  }

  if (raw.decision_sheet_verdict === RED || raw.blocked_input_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_decision_sheet_input_blocked",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_decision_sheet_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (raw.pending_decision_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: `${raw.pending_decision_count}_operator_decisions_pending`,
      raw,
    };
  }

  if (raw.decision_slot_count > 0 && raw.already_decided_count === raw.decision_slot_count) {
    return {
      ok: true,
      verdict: GREEN,
      raw,
    };
  }

  return {
    ok: true,
    verdict: AMBER,
    reason: "human_review_decision_sheet_has_no_decision_slots",
    raw,
  };
}

function pillarHumanReviewOperatorIndex({
  reportPath = defaultHumanReviewOperatorIndexPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_operator_index_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "human_review_operator_index_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    report_path: reportPath,
    generated_at: report.generated_at || null,
    operator_index_verdict: String(report.verdict || "").toLowerCase() || null,
    review_card_count: Number(summary.review_card_count || 0),
    pending_review_count: Number(summary.pending_review_count || 0),
    ready_for_operator_review_count: Number(summary.ready_for_operator_review_count || 0),
    missing_artefact_card_count: Number(summary.missing_artefact_card_count || 0),
    already_decided_count: Number(summary.already_decided_count || 0),
    blocked_input_count: Number(summary.blocked_input_count || 0),
    next_step: report.next_step || null,
    age_hours: ageHours,
    safety_intact: humanReviewOperatorIndexSafetyIsIntact(report),
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_operator_index_safety_contract_missing",
      raw,
    };
  }

  if (raw.operator_index_verdict === RED || raw.blocked_input_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_operator_index_input_blocked",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_operator_index_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (raw.missing_artefact_card_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: `${raw.missing_artefact_card_count}_review_cards_missing_artefacts`,
      raw,
    };
  }

  if (raw.pending_review_count > 0 && raw.ready_for_operator_review_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: `${raw.ready_for_operator_review_count}_operator_review_cards_ready`,
      raw,
    };
  }

  if (raw.review_card_count > 0 && raw.already_decided_count === raw.review_card_count) {
    return {
      ok: true,
      verdict: GREEN,
      raw,
    };
  }

  return {
    ok: true,
    verdict: AMBER,
    reason: "human_review_operator_index_has_no_review_cards",
    raw,
  };
}

function pillarHumanReviewConsole({
  reportPath = defaultHumanReviewConsolePath(),
  visualStripReportPath = path.join(path.dirname(reportPath), "human_review_visual_strip_report.json"),
  visualStripQaReportPath = path.join(path.dirname(reportPath), "human_review_visual_strip_qa_report.json"),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_console_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "human_review_console_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  let visualStripReport = null;
  try {
    visualStripReport = readJsonIfPresent(visualStripReportPath);
  } catch {
    visualStripReport = null;
  }
  let visualStripQaReport = null;
  try {
    visualStripQaReport = readJsonIfPresent(visualStripQaReportPath);
  } catch {
    visualStripQaReport = null;
  }
  const visualStripSummary = visualStripReport?.summary || {};
  const visualStripQaSummary = visualStripQaReport?.summary || {};
  const visualStripFresh = visualStripFreshness(report, visualStripReport);
  const visualStripQaFresh = visualStripQaFreshness(visualStripReport, visualStripQaReport);
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    report_path: reportPath,
    html_path: path.join(path.dirname(reportPath), "human_review_console.html"),
    generated_at: report.generated_at || null,
    console_verdict: String(report.verdict || "").toLowerCase() || null,
    card_count: Number(summary.card_count || 0),
    ready_card_count: Number(summary.ready_card_count || 0),
    actionable_card_count: Number(summary.actionable_card_count || 0),
    missing_artefact_card_count: Number(summary.missing_artefact_card_count || 0),
    blocked_input_count: Number(summary.blocked_input_count || 0),
    next_step: report.next_step || null,
    age_hours: ageHours,
    safety_intact: humanReviewConsoleSafetyIsIntact(report),
    visual_strip: visualStripReport
      ? {
          report_path: visualStripReportPath,
          html_path: path.join(path.dirname(visualStripReportPath), "human_review_visual_strip_report.html"),
          generated_at: visualStripReport.generated_at || null,
          source_console_generated_at: visualStripReport.source_console_generated_at || null,
          source_console_dry_run_generated_at: visualStripReport.source_console_dry_run_generated_at || null,
          source_strict_dry_run_generated_at: visualStripReport.source_strict_dry_run_generated_at || null,
          verdict: String(visualStripReport.verdict || "").toLowerCase() || null,
          card_count: Number(visualStripSummary.card_count || 0),
          extracted_card_count: Number(visualStripSummary.extracted_card_count || 0),
          failed_card_count: Number(visualStripSummary.failed_card_count || 0),
          extracted_frame_count: Number(visualStripSummary.extracted_frame_count || 0),
          stale: visualStripFresh.stale,
          stale_reason: visualStripFresh.reason,
          safety_intact: humanReviewVisualStripSafetyIsIntact(visualStripReport),
        }
      : null,
    visual_strip_qa: visualStripQaReport
      ? {
          report_path: visualStripQaReportPath,
          html_path: path.join(path.dirname(visualStripQaReportPath), "human_review_visual_strip_qa_report.html"),
          generated_at: visualStripQaReport.generated_at || null,
          source_visual_strip_generated_at: visualStripQaReport.source_visual_strip_generated_at || null,
          source_console_generated_at: visualStripQaReport.source_console_generated_at || null,
          source_console_dry_run_generated_at: visualStripQaReport.source_console_dry_run_generated_at || null,
          source_strict_dry_run_generated_at: visualStripQaReport.source_strict_dry_run_generated_at || null,
          verdict: String(visualStripQaReport.verdict || "").toLowerCase() || null,
          card_count: Number(visualStripQaSummary.card_count || 0),
          risk_card_count: Number(visualStripQaSummary.risk_card_count || 0),
          frame_warning_count: Number(visualStripQaSummary.frame_warning_count || 0),
          red_card_count: Number(visualStripQaSummary.red_card_count || 0),
          amber_card_count: Number(visualStripQaSummary.amber_card_count || 0),
          visual_repair_work_order_job_count: Number(
            visualStripQaReport.visual_repair_work_order?.summary?.job_count || 0,
          ),
          visual_repair_work_order_path: path.join(
            path.dirname(visualStripQaReportPath),
            "human_review_visual_repair_work_order.json",
          ),
          visual_repair_work_order_markdown_path: path.join(
            path.dirname(visualStripQaReportPath),
            "human_review_visual_repair_work_order.md",
          ),
          stale: visualStripQaFresh.stale,
          stale_reason: visualStripQaFresh.reason,
          safety_intact: humanReviewVisualStripQaSafetyIsIntact(visualStripQaReport),
        }
      : null,
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_console_safety_contract_missing",
      raw,
    };
  }

  if (raw.console_verdict === RED || raw.blocked_input_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "human_review_console_input_blocked",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `human_review_console_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (raw.visual_strip?.stale === true) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "human_review_visual_strip_stale_after_console",
      raw,
    };
  }

  if (raw.visual_strip_qa?.stale === true) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "human_review_visual_strip_qa_stale_after_visual_strip",
      raw,
    };
  }

  if (raw.missing_artefact_card_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: `${raw.missing_artefact_card_count}_human_review_console_cards_missing_artefacts`,
      raw,
    };
  }

  if (raw.actionable_card_count > 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: `${raw.actionable_card_count}_human_review_console_cards_actionable`,
      raw,
    };
  }

  if (raw.card_count > 0) {
    return {
      ok: true,
      verdict: GREEN,
      raw,
    };
  }

  return {
    ok: true,
    verdict: AMBER,
    reason: "human_review_console_has_no_cards",
    raw,
  };
}

function pillarGuardedDispatchPreflight({
  reportPath = defaultGuardedDispatchPreflightReportPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `guarded_dispatch_preflight_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "guarded_dispatch_preflight_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    report_path: reportPath,
    generated_at: report.generated_at || null,
    preflight_verdict: String(report.verdict || "").toLowerCase() || null,
    approved_action_count: Number(summary.approved_action_count || 0),
    dispatch_ready_action_count: Number(summary.dispatch_ready_action_count || 0),
    blocked_action_count: Number(summary.blocked_action_count || 0),
    safety_blocker_count: Number(summary.safety_blocker_count || 0),
    ready_for_guarded_dispatch: report.guarded_dispatch_plan?.ready_for_guarded_dispatch === true,
    live_publish_allowed_from_this_tool:
      report.guarded_dispatch_plan?.live_publish_allowed_from_this_tool === true,
    required_next_step: report.guarded_dispatch_plan?.required_next_step || null,
    advisory: Array.isArray(report.advisory) ? report.advisory : [],
    age_hours: ageHours,
    safety_intact: guardedDispatchPreflightSafetyIsIntact(report),
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "guarded_dispatch_preflight_safety_contract_missing",
      raw,
    };
  }

  if (raw.preflight_verdict === RED || raw.blocked_action_count > 0 || raw.safety_blocker_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "guarded_dispatch_preflight_blocked",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `guarded_dispatch_preflight_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (raw.dispatch_ready_action_count > 0 && raw.ready_for_guarded_dispatch === true) {
    return {
      ok: true,
      verdict: GREEN,
      raw,
    };
  }

  if (raw.approved_action_count <= 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "no_operator_approved_actions",
      raw,
    };
  }

  return {
    ok: true,
    verdict: AMBER,
    reason: "guarded_dispatch_preflight_has_no_dispatch_ready_actions",
    raw,
  };
}

function pillarGuardedDispatchExecutorPreflight({
  reportPath = defaultGuardedDispatchExecutorPreflightReportPath(),
  now = Date.now(),
  maxAgeHours = DEFAULT_STRICT_DRY_RUN_MAX_AGE_HOURS,
} = {}) {
  let report = null;
  try {
    report = readJsonIfPresent(reportPath);
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `guarded_dispatch_executor_preflight_unreadable:${err.message}`,
      raw: { report_path: reportPath },
    };
  }

  if (!report) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "guarded_dispatch_executor_preflight_missing",
      raw: { report_path: reportPath },
    };
  }

  const summary = report.summary || {};
  const generatedMs = Date.parse(report.generated_at || "");
  const ageHours = Number.isFinite(generatedMs)
    ? (Number(now) - generatedMs) / (60 * 60 * 1000)
    : null;
  const raw = {
    report_path: reportPath,
    generated_at: report.generated_at || null,
    preflight_verdict: String(report.verdict || "").toLowerCase() || null,
    dispatch_ready_action_count: Number(summary.dispatch_ready_action_count || 0),
    selected_action_count: Number(summary.selected_action_count || 0),
    handoff_ready_action_count: Number(summary.handoff_ready_action_count || 0),
    blocked_selected_action_count: Number(summary.blocked_selected_action_count || 0),
    ready_for_live_executor_handoff:
      report.executor_plan?.ready_for_live_executor_handoff === true,
    live_publish_allowed_from_this_tool:
      report.executor_plan?.live_publish_allowed_from_this_tool === true,
    required_next_step: report.executor_plan?.required_next_step || null,
    advisory: Array.isArray(report.advisory) ? report.advisory : [],
    age_hours: ageHours,
    safety_intact: guardedDispatchExecutorPreflightSafetyIsIntact(report),
  };

  if (!raw.safety_intact) {
    return {
      ok: false,
      verdict: RED,
      reason: "guarded_dispatch_executor_preflight_safety_contract_missing",
      raw,
    };
  }

  if (raw.preflight_verdict === RED || raw.blocked_selected_action_count > 0) {
    return {
      ok: false,
      verdict: RED,
      reason: "guarded_dispatch_executor_preflight_blocked",
      raw,
    };
  }

  if (ageHours != null && ageHours > maxAgeHours) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `guarded_dispatch_executor_preflight_stale:${ageHours.toFixed(1)}h`,
      raw,
    };
  }

  if (raw.handoff_ready_action_count > 0 && raw.ready_for_live_executor_handoff === true) {
    return {
      ok: true,
      verdict: GREEN,
      raw,
    };
  }

  if (raw.dispatch_ready_action_count > 0 && raw.selected_action_count <= 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "explicit_action_ids_required",
      raw,
    };
  }

  if (raw.dispatch_ready_action_count <= 0) {
    return {
      ok: true,
      verdict: AMBER,
      reason: "no_dispatch_ready_actions",
      raw,
    };
  }

  return {
    ok: true,
    verdict: AMBER,
    reason: "guarded_dispatch_executor_preflight_has_no_handoff_ready_actions",
    raw,
  };
}

function pillarRecentFailedCandidates({ stories, now } = {}) {
  const summary = summariseRecentFailedCandidates(stories, {
    limit: 10,
    now,
    recentWindowHours: 24,
  });
  let verdict = GREEN;
  if (summary.recent_count >= 5) verdict = AMBER;
  const reason =
    verdict === AMBER
      ? `${summary.recent_count}_qa_failed_last_${summary.recent_window_hours}h; ` +
        `${summary.count}_historical_total; top_groups: ` +
        summary.reason_groups
          .slice(0, 3)
          .map((g) => `${g.reason} x${g.count}`)
          .join(", ") +
        "; top_recent: " +
        summary.examples
          .slice(0, 3)
          .map((s) => `${s.id}:${s.reason}`)
          .join(", ")
      : undefined;
  return {
    ok: true,
    verdict,
    reason,
    raw: summary,
  };
}

function pillarRecentSkippedQa({ stories } = {}) {
  // Stories with publish_status='failed' AND a contract reject reason
  const skipped = (stories || [])
    .filter(
      (s) =>
        s &&
        (s.render_contract_blocked === true ||
          s.publish_status === "qa_failed"),
    )
    .slice(0, 10);
  return {
    ok: true,
    verdict: skipped.length >= 5 ? AMBER : GREEN,
    raw: { count: skipped.length },
  };
}

function pillarRecentPublish({ stories, now = Date.now() } = {}) {
  let latest = null;
  for (const s of stories || []) {
    if (!s) continue;
    const pubs = [
      s.youtube_post_id,
      s.tiktok_post_id,
      s.instagram_media_id,
      s.facebook_post_id,
    ].filter(Boolean);
    if (pubs.length === 0) continue;
    const ts = Date.parse(s.published_at || s.created_at || "") || 0;
    if (!latest || ts > latest.ts) latest = { story: s, ts };
  }
  if (!latest) {
    return { ok: false, verdict: AMBER, reason: "no_published_rows" };
  }
  const ageHours = (now - latest.ts) / (60 * 60 * 1000);
  const roundedAgeHours = Math.round(ageHours);
  const staleThresholdHours = 48;
  let verdict = GREEN;
  let reason;
  if (ageHours > staleThresholdHours) {
    verdict = AMBER;
    reason = `latest_publish_stale_${roundedAgeHours}h_exceeds_${staleThresholdHours}h_threshold: ${latest.story.id || "unknown_story"}`;
  }
  return {
    ok: true,
    verdict,
    reason,
    raw: {
      latest_id: latest.story.id,
      latest_title: (latest.story.title || "").slice(0, 80),
      age_hours: roundedAgeHours,
      stale_threshold_hours: staleThresholdHours,
    },
  };
}

function pillarTestBuildHealth() {
  // Read-only check: report whether the most recent test/build
  // artefact suggests health. We can't run npm test from inside this
  // function (would recurse). Instead we look for recent artefact in
  // dist/.
  const fs = require("fs-extra");
  const path = require("node:path");
  try {
    const distPath = path.join(__dirname, "..", "..", "dist", "index.html");
    if (fs.pathExistsSync(distPath)) {
      const stat = fs.statSync(distPath);
      const ageHours = (Date.now() - stat.mtimeMs) / (60 * 60 * 1000);
      return {
        ok: true,
        verdict: ageHours < 24 ? GREEN : AMBER,
        raw: {
          dist_age_hours: Math.round(ageHours),
          note: "dist age inferred from index.html mtime; run npm run build to refresh",
        },
      };
    }
  } catch {
    /* fall through */
  }
  return { ok: false, verdict: UNKNOWN, reason: "no_dist_artefact" };
}

function pillarSecurityBlockers() {
  // Static check: scan known auth surfaces for token-logging anti-
  // patterns. Fixed in 5facfd3 (server.js Facebook OAuth callback)
  // and tonight (scripts/fb_auth.js CLI). This pillar reverifies —
  // RED if any pattern reappears.
  const fs = require("fs-extra");
  const path = require("node:path");
  // Patterns that would leak a token VALUE rather than a status.
  const patterns = [
    {
      re: /FACEBOOK_PAGE_TOKEN=\$\{pageToken\}/,
      label: "fb_token_template_literal",
    },
    {
      re: /INSTAGRAM_ACCESS_TOKEN=\$\{pageToken\}/,
      label: "ig_token_template_literal",
    },
    {
      re: /FACEBOOK_PAGE_TOKEN=\$\{page\.access_token\}/,
      label: "fb_token_template_literal_page",
    },
    {
      re: /INSTAGRAM_ACCESS_TOKEN=\$\{page\.access_token\}/,
      label: "ig_token_template_literal_page",
    },
  ];
  const targets = [
    path.join(__dirname, "..", "..", "server.js"),
    path.join(__dirname, "..", "..", "scripts", "fb_auth.js"),
  ];
  try {
    const hits = [];
    let scanned = 0;
    for (const file of targets) {
      if (!fs.pathExistsSync(file)) continue;
      scanned++;
      const txt = fs.readFileSync(file, "utf-8");
      for (const p of patterns) {
        if (p.re.test(txt)) hits.push(`${path.basename(file)}:${p.label}`);
      }
    }
    if (hits.length === 0) {
      return {
        ok: true,
        verdict: GREEN,
        raw: { token_log_patterns_found: 0, files_scanned: scanned },
      };
    }
    return {
      ok: true,
      verdict: RED,
      raw: { hits, files_scanned: scanned },
      reason: `token_log_pattern_re_introduced: ${hits.join(",")}`,
    };
  } catch (err) {
    return {
      ok: false,
      verdict: UNKNOWN,
      reason: `scan_failed: ${err.message}`,
    };
  }
}

function pillarDocsDrift() {
  const dd = safeRequire("./docs-doctor");
  if (!dd || typeof dd.buildDocsDoctorReport !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  // Async; resolved at call site.
  return null;
}

// ── Top-level builder ────────────────────────────────────────────

const PILLAR_NAMES = [
  "system_doctor",
  "local_restart_readiness",
  "railway_deploy",
  "queue_health",
  "publish_cadence",
  "strict_dry_run_control",
  "human_review_decision_sheet",
  "human_review_operator_index",
  "human_review_console",
  "human_review_approval_gate",
  "guarded_dispatch_preflight",
  "guarded_dispatch_executor_preflight",
  "platform_duration_contract",
  "final_voice_audit",
  "repair_backlog",
  "platform_status",
  "media_verify",
  "media_inventory",
  "topicality_gate",
  "visual_count_gate",
  "thumbnail_safety",
  "render_metadata",
  "instagram_pending",
  "tiktok_external_block",
  "facebook_reel_eligibility",
  "facebook_card_fallback",
  "recent_failed_candidates",
  "recent_skipped_qa",
  "recent_publish",
  "test_build_health",
  "security_blockers",
  "docs_drift",
];

function resolvePublishReadinessNextAction({ overall, pillars = {} } = {}) {
  if (overall === RED) {
    return "Do not publish until red blockers cleared.";
  }

  if (pillars.publish_cadence?.verdict === AMBER) {
    const nextSafe =
      pillars.publish_cadence?.raw?.next_safe_publish?.next_safe_publish_at_utc;
    return nextSafe
      ? `Hold manual or targeted publishing until cadence clears; let the scheduler resume at ${nextSafe}.`
      : "Hold manual or targeted publishing until cadence clears; let the scheduler resume at a canonical window.";
  }

  const repairBacklog = pillars.repair_backlog;
  if (repairBacklog?.verdict === AMBER) {
    const raw = repairBacklog.raw || {};
    const autoCount = Number(raw.auto_repairable_items || 0);
    if (autoCount > 0) {
      return `Run the auto-repair backlog first: ${autoCount} repairable items remain. Do not publish unattended; regenerate render inputs, strict dry-run and publish-readiness after the repairs.`;
    }
    return "Clear or route the open repair backlog before expanding cadence. Do not publish unattended until publish-readiness is rerun.";
  }

  const durationContract = pillars.platform_duration_contract;
  if (durationContract?.verdict === AMBER) {
    const raw = durationContract.raw || {};
    const activeVariantCount = Number(raw.active_variant_repair_required_count || 0);
    const activeTiktokRewardsCount = Number(
      raw.active_tiktok_creator_rewards_variant_required_count || 0,
    );
    if (activeVariantCount > 0) {
      return `Repair active platform duration variants first: ${activeVariantCount} active duration jobs remain. Do not publish unattended; rerun strict dry-run and publish-readiness after repair.`;
    }
    if (activeTiktokRewardsCount > 0) {
      return `Generate or approve TikTok Creator Rewards variants for ${activeTiktokRewardsCount} active stories before counting TikTok monetisation-ready. Enabled platforms still require HUMAN_REVIEW.`;
    }
  }

  const finalVoiceAudit = pillars.final_voice_audit;
  if (finalVoiceAudit?.verdict === RED) {
    return "Do not publish. Active final voice audit rows have reject-level evidence; regenerate or repair narration, timestamps and voice mastering before review.";
  }
  if (finalVoiceAudit?.verdict === AMBER) {
    return "Do not publish unattended. Final voice audit needs active-row review or fresh evidence before the human-review queue can be trusted.";
  }

  const strictDryRun = pillars.strict_dry_run_control;
  if (strictDryRun?.verdict === RED) {
    return "Do not publish. Strict dry-run preflight has active blockers.";
  }

  const humanReviewApprovalGate = pillars.human_review_approval_gate;
  const humanReviewOperatorIndex = pillars.human_review_operator_index;
  const humanReviewConsole = pillars.human_review_console;
  if (humanReviewConsole?.verdict === RED) {
    return "Do not publish. Human-review console inputs are unsafe; regenerate the console before recording decisions.";
  }
  if (humanReviewOperatorIndex?.verdict === RED) {
    return "Do not publish. Human-review operator index inputs are unsafe; regenerate the index before recording decisions.";
  }
  if (humanReviewConsole?.verdict === AMBER) {
    const raw = humanReviewConsole.raw || {};
    if (Number(raw.missing_artefact_card_count || 0) > 0) {
      return `Request repairs for ${raw.missing_artefact_card_count} human-review console cards with missing artefacts before approving anything.`;
    }
  }
  if (humanReviewOperatorIndex?.verdict === AMBER) {
    const raw = humanReviewOperatorIndex.raw || {};
    if (Number(raw.missing_artefact_card_count || 0) > 0) {
      return `Request repairs for ${raw.missing_artefact_card_count} human-review cards with missing artefacts before approving anything.`;
    }
  }

  if (humanReviewApprovalGate?.verdict === RED) {
    return "Do not publish. Human-review approval decisions are invalid; repair the decision log before guarded dispatch.";
  }
  if (humanReviewApprovalGate?.verdict === AMBER) {
    const raw = humanReviewApprovalGate.raw || {};
    if (Number(raw.review_packet_count || 0) > 0 && Number(raw.decision_count || 0) === 0) {
      const decisionSheet = pillars.human_review_decision_sheet?.raw || {};
      const pendingSheetCount = Number(decisionSheet.pending_decision_count || 0);
      const consoleActionableCount = Number(humanReviewConsole?.raw?.actionable_card_count || 0);
      const consoleHtmlPath = humanReviewConsole?.raw?.html_path;
      const visualStrip = humanReviewConsole?.raw?.visual_strip || {};
      const visualStripQa = humanReviewConsole?.raw?.visual_strip_qa || {};
      const visualStripFrameCount = Number(visualStrip.extracted_frame_count || 0);
      const visualStripHtmlPath = visualStrip.html_path;
      const visualStripReportPath = visualStrip.report_path;
      const visualStripQaHtmlPath = visualStripQa.html_path;
      const visualStripQaReportPath = visualStripQa.report_path;
      const visualStripQaRiskCount = Number(visualStripQa.risk_card_count || 0);
      const visualStripQaWarningCount = Number(visualStripQa.frame_warning_count || 0);
      const visualRepairWorkOrderPath = visualStripQa.visual_repair_work_order_markdown_path;
      const visualRepairWorkOrderCount = Number(visualStripQa.visual_repair_work_order_job_count || 0);
      const indexReadyCount = Number(humanReviewOperatorIndex?.raw?.ready_for_operator_review_count || 0);
      if (visualStrip.stale === true) {
        return `Regenerate the human review visual strip from the current console before any operator decisions. The stale strip at ${visualStripReportPath || "output/goal-contract/human_review_visual_strip_report.json"} was built from older review evidence (${visualStrip.stale_reason || "stale_visual_strip"}). This path does not publish or mutate tokens.`;
      }
      if (visualStripQa.stale === true) {
        return `Regenerate the human review visual strip QA from the current strip before any operator decisions. The stale QA report at ${visualStripQaReportPath || "output/goal-contract/human_review_visual_strip_qa_report.json"} no longer matches the latest strip (${visualStripQa.stale_reason || "stale_visual_strip_qa"}). This path does not publish or mutate tokens.`;
      }
      return consoleActionableCount > 0
        ? visualStripQa.safety_intact === true && (visualStripQaRiskCount > 0 || visualStripQaWarningCount > 0)
          ? `Open the visual strip QA report at ${visualStripQaHtmlPath || "output/goal-contract/human_review_visual_strip_qa_report.html"} first (${visualStripQaRiskCount} risky cards, ${visualStripQaWarningCount} frame warnings). Use the visual repair work order at ${visualRepairWorkOrderPath || "output/goal-contract/human_review_visual_repair_work_order.md"} for ${visualRepairWorkOrderCount} local repair jobs, then inspect the visual strip report at ${visualStripHtmlPath || "output/goal-contract/human_review_visual_strip_report.html"} and watch the human review console at ${consoleHtmlPath || "output/goal-contract/human_review_console.html"} for ${consoleActionableCount} artefact-complete cards before recording decisions. This path does not publish or mutate tokens.`
          : visualStripFrameCount > 0 && visualStrip.safety_intact === true
          ? `Open the visual strip report at ${visualStripHtmlPath || "output/goal-contract/human_review_visual_strip_report.html"} first (${visualStripFrameCount} extracted first-3s frames), then watch the human review console at ${consoleHtmlPath || "output/goal-contract/human_review_console.html"} for ${consoleActionableCount} artefact-complete cards before recording decisions. This path does not publish or mutate tokens.`
          : `Open the human review console at ${consoleHtmlPath || "output/goal-contract/human_review_console.html"} to watch ${consoleActionableCount} artefact-complete cards, then record decisions before guarded dispatch. This path does not publish or mutate tokens.`
        : indexReadyCount > 0
        ? `Use the human review operator index to watch ${indexReadyCount} artefact-complete review cards, then record decisions before guarded dispatch. This path does not publish or mutate tokens.`
        : pendingSheetCount > 0
          ? `Use the human review decision sheet to record ${pendingSheetCount} operator decisions before guarded dispatch. This approval path does not publish or mutate tokens.`
        : "Record operator decisions for the HUMAN_REVIEW packets before guarded dispatch. This approval gate does not publish or mutate tokens.";
    }
    if (Number(raw.pending_review_packet_count || 0) > 0) {
      return "Finish the pending HUMAN_REVIEW decisions before expanding cadence or guarded dispatch.";
    }
  }

  const guardedDispatchPreflight = pillars.guarded_dispatch_preflight;
  if (guardedDispatchPreflight?.verdict === RED) {
    return "Do not publish. Guarded-dispatch preflight found stale, disabled-platform or media mismatches in approved actions.";
  }
  if (guardedDispatchPreflight?.verdict === AMBER) {
    const raw = guardedDispatchPreflight.raw || {};
    if (Number(raw.approved_action_count || 0) > 0) {
      return "Run or repair guarded-dispatch preflight before handing approved actions to any live dispatcher.";
    }
  }

  const guardedDispatchExecutorPreflight = pillars.guarded_dispatch_executor_preflight;
  if (guardedDispatchExecutorPreflight?.verdict === RED) {
    return "Do not publish. Guarded dispatch executor preflight blocked the selected action handoff.";
  }
  if (guardedDispatchExecutorPreflight?.verdict === AMBER) {
    const raw = guardedDispatchExecutorPreflight.raw || {};
    if (Number(raw.dispatch_ready_action_count || 0) > 0 && Number(raw.selected_action_count || 0) <= 0) {
      return "Select explicit guarded dispatch action IDs before any live executor handoff. The preflight still does not publish.";
    }
  }

  if (strictDryRun?.verdict === AMBER) {
    const raw = strictDryRun.raw || {};
    if (raw.ready_story_count > 0 && raw.ready_for_unattended_publish !== true) {
      return "Do not publish unattended. Route eligible stories through HUMAN_REVIEW; only enabled-platform actions may proceed after approval.";
    }
    return "Do not publish unattended. Regenerate strict dry-run preflight and resolve AMBER readiness reasons first.";
  }

  if (overall === AMBER) {
    return "Operator review required before any live publish. Rerun npm run ops:publish-readiness before the next window.";
  }
  return "Publish normally.";
}

async function buildPublishReadinessReport(opts = {}) {
  const env = opts.env || process.env;
  const db = opts.db || require("../db");
  const now = opts.now || Date.now();
  const skipOperationalPillars = opts.skipOperationalPillars === true;
  let stories = [];
  try {
    stories = (await db.getStories()) || [];
  } catch {
    stories = [];
  }

  let sd;
  let rd;
  let qh;
  let lr;
  let ps;
  let mv;
  let mi;
  let docs;
  if (skipOperationalPillars) {
    const skipped = {
      ok: false,
      verdict: UNKNOWN,
      reason: "skipped_for_unit_test",
    };
    sd = rd = qh = lr = ps = mv = mi = docs = skipped;
  } else {
    // Run async pillars in parallel
    const docsMod = safeRequire("./docs-doctor");
    const docsPromise =
      docsMod && typeof docsMod.buildDocsDoctorReport === "function"
        ? docsMod
            .buildDocsDoctorReport()
            .then((r) => {
              const high = (r.summary && r.summary.high) || 0;
              const med = (r.summary && r.summary.medium) || 0;
              let verdict = GREEN;
              if (high > 0) verdict = AMBER;
              return {
                ok: true,
                verdict,
                raw: { high, medium: med, total: r.drift_signals.length },
              };
            })
            .catch((err) => ({
              ok: false,
              verdict: AMBER,
              reason: `docs: ${err.message}`,
            }))
        : Promise.resolve({
            ok: false,
            verdict: UNKNOWN,
            reason: "module_unavailable",
          });

    [sd, lr, rd, qh, ps, mv, mi, docs] = await Promise.all([
      pillarSystemDoctor(),
      pillarLocalRestartReadiness({ env, now }),
      pillarRailwayDeploy(),
      pillarQueueHealth(),
      pillarPlatformStatus({
        stories,
        strictDryRunPlanPath: opts.strictDryRunPlanPath,
        platformDoctorPath: opts.platformDoctorPath,
      }),
      pillarMediaVerify({ stories, planPath: opts.strictDryRunPlanPath }),
      pillarMediaInventory({ stories }),
      docsPromise,
    ]);
  }

  const rawPillars = {
    system_doctor: sd,
    local_restart_readiness: lr,
    railway_deploy: rd,
    queue_health: qh,
    publish_cadence: pillarPublishCadence({ stories, env, now }),
    strict_dry_run_control: pillarStrictDryRunControl({
      planPath: opts.strictDryRunPlanPath,
      now,
      maxAgeHours: opts.strictDryRunMaxAgeHours,
    }),
    human_review_decision_sheet: pillarHumanReviewDecisionSheet({
      reportPath: opts.humanReviewDecisionSheetPath,
      now,
      maxAgeHours: opts.humanReviewDecisionSheetMaxAgeHours,
    }),
    human_review_operator_index: pillarHumanReviewOperatorIndex({
      reportPath: opts.humanReviewOperatorIndexPath,
      now,
      maxAgeHours: opts.humanReviewOperatorIndexMaxAgeHours,
    }),
    human_review_console: pillarHumanReviewConsole({
      reportPath: opts.humanReviewConsolePath,
      now,
      maxAgeHours: opts.humanReviewConsoleMaxAgeHours,
    }),
    human_review_approval_gate: pillarHumanReviewApprovalGate({
      reportPath: opts.humanReviewApprovalGatePath,
      now,
      maxAgeHours: opts.humanReviewApprovalGateMaxAgeHours,
    }),
    guarded_dispatch_preflight: pillarGuardedDispatchPreflight({
      reportPath: opts.guardedDispatchPreflightPath,
      now,
      maxAgeHours: opts.guardedDispatchPreflightMaxAgeHours,
    }),
    guarded_dispatch_executor_preflight: pillarGuardedDispatchExecutorPreflight({
      reportPath: opts.guardedDispatchExecutorPreflightPath,
      now,
      maxAgeHours: opts.guardedDispatchExecutorPreflightMaxAgeHours,
    }),
    platform_duration_contract: pillarPlatformDurationContract({
      reportPath: opts.platformDurationContractPath,
      now,
      maxAgeHours: opts.platformDurationContractMaxAgeHours,
    }),
    final_voice_audit: pillarFinalVoiceAudit({
      auditPath: opts.finalVoiceAuditPath,
      localTestManifestPath: opts.localTestVideoManifestPath,
      now,
      maxAgeHours: opts.finalVoiceAuditMaxAgeHours,
    }),
    repair_backlog: pillarRepairBacklog({
      repairBacklogPath: opts.repairBacklogPath,
      strictDryRunPlanPath: opts.strictDryRunPlanPath,
      now,
      maxAgeHours: opts.repairBacklogMaxAgeHours,
    }),
    platform_status: ps,
    media_verify: mv,
    media_inventory: mi,
    topicality_gate: pillarTopicalityGate(),
    visual_count_gate: pillarVisualCountGate({ env }),
    thumbnail_safety: pillarThumbnailSafety(),
    render_metadata: pillarRenderMetadata({
      stories,
      strictDryRunPlanPath: opts.strictDryRunPlanPath,
      schedulerBridgeCandidatesPath: opts.schedulerBridgeCandidatesPath,
    }),
    instagram_pending: pillarInstagramPending({ stories }),
    tiktok_external_block: pillarTiktokExternalBlock({ doctorPath: opts.platformDoctorPath }),
    facebook_reel_eligibility: pillarFacebookReelEligibility(),
    facebook_card_fallback: pillarFacebookCardFallback({ stories }),
    recent_failed_candidates: pillarRecentFailedCandidates({ stories, now }),
    recent_skipped_qa: pillarRecentSkippedQa({ stories }),
    recent_publish: pillarRecentPublish({ stories, now }),
    test_build_health: pillarTestBuildHealth(),
    security_blockers: pillarSecurityBlockers(),
    docs_drift: docs,
  };
  const pillars = Object.fromEntries(
    Object.entries(rawPillars).map(([name, pillar]) => [name, normalisePillar(pillar)]),
  );

  const verdicts = Object.values(pillars).map((p) => p.verdict);
  const overall = dominantVerdict(verdicts);

  // Build narrative
  const blockers = [];
  const advisory = [];
  const recently_improved = [];
  for (const [name, p] of Object.entries(pillars)) {
    if (p.verdict === RED) {
      blockers.push(`${name}: ${p.reason || "(no reason)"}`);
    } else if (p.verdict === AMBER) {
      advisory.push(`${name}: ${p.reason || "amber"}`);
    } else if (p.verdict === UNKNOWN) {
      advisory.push(`${name}: unknown — supply data`);
    }
  }

  const next_action = resolvePublishReadinessNextAction({ overall, pillars });

  return {
    overall_verdict: overall,
    pillars,
    blockers,
    advisory,
    recently_improved,
    next_action,
    story_count: stories.length,
    generated_at: new Date().toISOString(),
  };
}

const VERDICT_GLYPH = {
  green: "🟢",
  amber: "🟡",
  red: "🔴",
  unknown: "⚪",
};

function formatPublishReadinessMarkdown(report) {
  if (!report) return "";
  const lines = [];
  const overallVerdict = normaliseReadinessVerdict(report.overall_verdict);
  const g = VERDICT_GLYPH[overallVerdict] || "⚪";
  lines.push(
    `${g} **Pulse Gaming Publish Readiness — ${overallVerdict.toUpperCase()}**`,
  );
  lines.push(`Stories in DB: ${report.story_count}`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push("## Pillars");
  for (const [name, p] of Object.entries(report.pillars)) {
    const verdict = normaliseReadinessVerdict(p.verdict);
    const pg = VERDICT_GLYPH[verdict] || "⚪";
    let line = `${pg} ${name}: ${verdict}`;
    if (p.reason) line += ` — ${p.reason}`;
    lines.push(line);
  }
  if (report.blockers.length > 0) {
    lines.push("");
    lines.push("## Blocking (RED)");
    for (const b of report.blockers) lines.push(`  • ${b}`);
  }
  if (report.advisory.length > 0) {
    lines.push("");
    lines.push("## Advisory");
    for (const a of report.advisory) lines.push(`  • ${a}`);
  }
  lines.push("");
  lines.push("## Next operator action");
  lines.push(`> ${report.next_action}`);
  return lines.join("\n");
}

module.exports = {
  buildPublishReadinessReport,
  formatPublishReadinessMarkdown,
  dominantVerdict,
  normaliseReadinessVerdict,
  resolvePublishReadinessNextAction,
  pillarPublishCadence,
  pillarLocalRestartReadiness,
  pillarStrictDryRunControl,
  pillarHumanReviewDecisionSheet,
  pillarHumanReviewOperatorIndex,
  pillarHumanReviewConsole,
  pillarHumanReviewApprovalGate,
  pillarGuardedDispatchPreflight,
  pillarGuardedDispatchExecutorPreflight,
  pillarPlatformDurationContract,
  pillarFinalVoiceAudit,
  pillarRepairBacklog,
  pillarRenderMetadata,
  pillarFacebookReelEligibility,
  PILLAR_NAMES,
  RED,
  AMBER,
  GREEN,
  UNKNOWN,
  summariseSystemDoctorReason,
  summariseMediaVerifyReason,
  summarisePlatformStatusReason,
  applyStrictPlatformEvidenceToStatus,
  summariseTiktokExternalBlockReason,
  summariseLocalRestartReadinessReason,
  summariseRepairBacklogReason,
  buildMediaVerifyStoriesFromDryRunPlan,
  summariseRecentFailedCandidates,
};
