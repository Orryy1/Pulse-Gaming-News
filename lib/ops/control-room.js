"use strict";

const fs = require("fs-extra");
const path = require("node:path");

/**
 * lib/ops/control-room.js — the unified operator control-room report.
 *
 * Per the 2026-04-29 forensic audit (P0 #6 in the roadmap), Pulse has
 * many useful diagnostics but no single command that gives a publish-
 * readiness verdict in under 2 minutes. This module aggregates the
 * existing read-only ops modules and renders one Markdown verdict
 * with three colour states: green / amber / red.
 *
 * Inputs (all read-only):
 *   - lib/ops/system-doctor   — scheduler + queue + DB health
 *   - lib/ops/platform-status — per-platform configured/auth state
 *   - lib/ops/media-verify    — on-disk media path integrity
 *   - lib/intelligence/render-health-digest — last-24h render quality
 *   - latest publish summary (read from lib/db.getStories last row)
 *
 * Output:
 *   {
 *     verdict: "green" | "amber" | "red",
 *     reasons: string[],          // why amber/red
 *     recommendations: string[],  // operator next-step actions
 *     pillars: { systemDoctor, platformStatus, mediaVerify, renderHealth, recentPublish },
 *     generated_at: ISOString,
 *   }
 *
 * Pure orchestration — never mutates production state, never posts
 * Discord, never triggers OAuth. Caller decides whether to write the
 * Markdown to disk + post to Discord.
 *
 * The verdict ladder (most-conservative wins):
 *   - red   → at least one pillar is red OR the pipeline cannot publish
 *             (no scheduler, DB unreachable, no platforms configured)
 *   - amber → at least one warning signal (thin visuals trending up,
 *             auth expiring, last publish was a fail, etc)
 *   - green → all pillars green AND last publish succeeded
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
const ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_STRICT_DRY_RUN_PLAN_PATH = path.join(
  ROOT,
  "output",
  "goal-contract",
  "dry_run_publish_plan.json",
);

function normaliseVerdict(value, fallback = AMBER) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return fallback;
  if (["green", "pass", "passed", "ok", "ready"].includes(text)) return GREEN;
  if (["amber", "warn", "warning", "review", "degraded"].includes(text)) {
    return AMBER;
  }
  if (["red", "fail", "failed", "blocked", "error"].includes(text)) return RED;
  return fallback;
}

function normalisePillar(pillar = {}, fallback = AMBER) {
  return {
    ...pillar,
    verdict: normaliseVerdict(pillar.verdict, fallback),
  };
}

function dominantVerdict(verdicts) {
  const normalised = verdicts.map((verdict) => normaliseVerdict(verdict));
  if (normalised.includes(RED)) return RED;
  if (normalised.includes(AMBER)) return AMBER;
  return GREEN;
}

async function runSystemDoctor() {
  const sd = safeRequire("./system-doctor");
  if (!sd || typeof sd.buildSystemDoctorReport !== "function") {
    return {
      ok: false,
      verdict: AMBER,
      reason: "system_doctor_module_unavailable",
    };
  }
  try {
    const report = await sd.buildSystemDoctorReport();
    return normalisePillar({
      ok: true,
      verdict: report.verdict || (report.ok ? GREEN : AMBER),
      raw: report,
    });
  } catch (err) {
    return { ok: false, verdict: RED, reason: `system_doctor: ${err.message}` };
  }
}

async function runPlatformStatus({ stories } = {}) {
  const ps = safeRequire("./platform-status");
  if (!ps || typeof ps.buildPlatformStatus !== "function") {
    return {
      ok: false,
      verdict: AMBER,
      reason: "platform_status_module_unavailable",
    };
  }
  try {
    const cfg =
      typeof ps.buildPlatformOperationalConfig === "function"
        ? ps.buildPlatformOperationalConfig()
        : null;
    const status = ps.buildPlatformStatus({
      env: process.env,
      stories: stories || [],
      platformPosts: [],
      operationalConfig: cfg,
    });
    return normalisePillar({
      ok: true,
      verdict: status.verdict || GREEN,
      raw: status,
    });
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `platform_status: ${err.message}`,
    };
  }
}

async function runMediaVerify({ stories } = {}) {
  const mv = safeRequire("./media-verify");
  if (!mv || typeof mv.verifyMedia !== "function") {
    return {
      ok: false,
      verdict: AMBER,
      reason: "media_verify_module_unavailable",
    };
  }
  try {
    const report = await mv.verifyMedia({ stories: stories || [] });
    return normalisePillar({
      ok: true,
      verdict: report.verdict || (report.issueCount > 0 ? AMBER : GREEN),
      raw: report,
    });
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `media_verify: ${err.message}`,
    };
  }
}

async function runRenderHealth({ stories } = {}) {
  const rh = safeRequire("../intelligence/render-health-digest");
  if (!rh) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "render_health_module_unavailable",
    };
  }
  try {
    const summary = rh.buildRenderHealthSummary(stories || [], {
      windowHours: 24,
    });
    let verdict = GREEN;
    if (summary.percentages.thin >= 50) verdict = RED;
    else if (summary.percentages.thin >= 20) verdict = AMBER;
    if (summary.outro && summary.outro.missing > 0) {
      verdict = verdict === GREEN ? AMBER : verdict;
    }
    return normalisePillar({
      ok: true,
      verdict,
      raw: summary,
    });
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `render_health: ${err.message}`,
    };
  }
}

async function readStrictDryRunPlan(
  planPath = DEFAULT_STRICT_DRY_RUN_PLAN_PATH,
) {
  try {
    if (!(await fs.pathExists(planPath))) return null;
    return await fs.readJson(planPath);
  } catch (err) {
    return { unreadable: true, error: err.message, path: planPath };
  }
}

async function runStrictDryRun() {
  const plan = await readStrictDryRunPlan();
  return evaluateStrictDryRunPlan(plan);
}

function evaluateStrictDryRunPlan(plan = null) {
  if (!plan || typeof plan !== "object") {
    return {
      ok: false,
      verdict: AMBER,
      reason: "strict_dry_run_plan_missing",
    };
  }
  if (plan.unreadable) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "strict_dry_run_plan_unreadable",
      detail: plan.error || null,
      path: plan.path || null,
    };
  }

  const summary = plan.summary || {};
  const readyStoryCount = Number(summary.ready_story_count || 0);
  const blockedStoryCount = Number(summary.blocked_story_count || 0);
  const blockedActionCount = Number(summary.blocked_action_count || 0);
  const deferredPlatformActionCount = Number(
    summary.deferred_platform_action_count ||
      summary.platform_deferred_action_count ||
      0,
  );
  const humanReviewActionCount = Number(
    summary.enabled_human_review_action_count ||
      summary.human_review_required_action_count ||
      0,
  );
  const livePublishAllowedActionCount = Number(
    summary.live_publish_allowed_action_count || 0,
  );
  const schedulerPreflightRequired =
    summary.scheduler_preflight_required !== false;
  const schedulerPreflightLoaded =
    summary.scheduler_preflight_report_loaded === true ||
    summary.preflight_checked_story_count > 0;

  let verdict = normaliseVerdict(plan.overall_verdict, AMBER);
  let reason =
    Array.isArray(plan.readiness_reasons) && plan.readiness_reasons.length
      ? plan.readiness_reasons[0]
      : null;

  if (livePublishAllowedActionCount > 0) {
    verdict = RED;
    reason = "dry_run_plan_allows_live_publish_actions";
  } else if (schedulerPreflightRequired && !schedulerPreflightLoaded) {
    verdict = RED;
    reason = "scheduler_preflight_missing";
  } else if (blockedStoryCount > 0 || blockedActionCount > 0) {
    verdict = RED;
    reason = "strict_dry_run_has_blocked_items";
  } else if (readyStoryCount > 0 && verdict === GREEN && deferredPlatformActionCount > 0) {
    verdict = AMBER;
    reason = "platform_actions_deferred_until_enabled";
  } else if (readyStoryCount > 0 && !reason && verdict === AMBER) {
    reason = "human_review_ready_with_warnings";
  } else if (readyStoryCount === 0 && !reason) {
    verdict = AMBER;
    reason = "no_ready_dry_run_candidates";
  }
  return {
    ok: verdict === GREEN,
    verdict,
    reason,
    ready_story_count: readyStoryCount,
    blocked_story_count: blockedStoryCount,
    blocked_action_count: blockedActionCount,
    deferred_platform_action_count: deferredPlatformActionCount,
    enabled_human_review_action_count: humanReviewActionCount,
    live_publish_allowed_action_count: livePublishAllowedActionCount,
    scheduler_preflight_required: schedulerPreflightRequired,
    scheduler_preflight_report_loaded: schedulerPreflightLoaded,
    story_count: Number(summary.story_count || 0),
    raw: plan,
  };
}

function evaluateRecentPublish(stories) {
  if (!Array.isArray(stories) || stories.length === 0) {
    return { ok: false, verdict: AMBER, reason: "no_stories_in_db" };
  }
  // Find the most recently published story (any platform).
  let latest = null;
  for (const s of stories) {
    if (!s) continue;
    const pubs = [
      s.youtube_post_id,
      s.tiktok_post_id,
      s.instagram_media_id,
      s.facebook_post_id,
    ].filter(Boolean);
    if (pubs.length === 0) continue;
    const rawTimestamp = s.published_at || s.created_at || "";
    const parsedTimestamp = Date.parse(rawTimestamp);
    const ts =
      Number.isFinite(parsedTimestamp) && parsedTimestamp > 0
        ? parsedTimestamp
        : null;
    if (!latest || (ts ?? -1) > (latest.ts ?? -1)) {
      latest = { story: s, ts };
    }
  }
  if (!latest) {
    return { ok: false, verdict: AMBER, reason: "no_published_stories_found" };
  }
  if (latest.ts === null) {
    return {
      ok: false,
      verdict: AMBER,
      reason: "published_row_missing_timestamp",
      latest_id: latest.story.id,
      latest_title: latest.story.title,
    };
  }
  const ageHours = (Date.now() - latest.ts) / (60 * 60 * 1000);
  // Stale: > 48h since last successful publish on any platform.
  if (ageHours > 48) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `last_publish_${Math.round(ageHours)}h_ago`,
      latest_id: latest.story.id,
      latest_title: latest.story.title,
    };
  }
  return {
    ok: true,
    verdict: GREEN,
    latest_id: latest.story.id,
    latest_title: latest.story.title,
    latest_age_hours: Math.round(ageHours),
  };
}

/**
 * Build the full control-room report. All inputs are dependency-injected
 * so unit tests can swap modules in without touching the real DB.
 */
async function buildControlRoomReport({
  db = require("../db"),
  systemDoctor = runSystemDoctor,
  platformStatus = runPlatformStatus,
  mediaVerify = runMediaVerify,
  renderHealth = runRenderHealth,
  strictDryRun = runStrictDryRun,
  recentPublish = evaluateRecentPublish,
} = {}) {
  let stories = [];
  try {
    stories = (await db.getStories()) || [];
  } catch {
    stories = [];
  }

  const [sdRaw, psRaw, mvRaw, rhRaw, strictDryRunRaw] = await Promise.all([
    systemDoctor(),
    platformStatus({ stories }),
    mediaVerify({ stories }),
    renderHealth({ stories }),
    strictDryRun({ stories }),
  ]);
  const sd = normalisePillar(sdRaw);
  const ps = normalisePillar(psRaw);
  const mv = normalisePillar(mvRaw);
  const rh = normalisePillar(rhRaw);
  const strictDryRunReport = normalisePillar(strictDryRunRaw);
  const rp = normalisePillar(recentPublish(stories));

  const verdicts = [
    sd.verdict,
    ps.verdict,
    mv.verdict,
    rh.verdict,
    strictDryRunReport.verdict,
    rp.verdict,
  ];
  const verdict = dominantVerdict(verdicts);

  const reasons = [];
  const recommendations = [];

  if (sd.verdict !== GREEN) {
    reasons.push(
      `system_doctor=${sd.verdict}${sd.reason ? `: ${sd.reason}` : ""}`,
    );
  }
  if (ps.verdict !== GREEN) {
    reasons.push(
      `platform_status=${ps.verdict}${ps.reason ? `: ${ps.reason}` : ""}`,
    );
  }
  if (mv.verdict !== GREEN) {
    const mediaReasonLabel =
      Number(strictDryRunReport.ready_story_count || 0) > 0
        ? "live_db_media_verify"
        : "media_verify";
    reasons.push(
      `${mediaReasonLabel}=${mv.verdict}${mv.reason ? `: ${mv.reason}` : ""}`,
    );
  }
  if (rh.verdict !== GREEN) {
    reasons.push(
      `render_health=${rh.verdict}` +
        (rh.raw && rh.raw.percentages
          ? ` (thin=${rh.raw.percentages.thin}%, outro_missing=${rh.raw.outro?.missing || 0})`
          : ""),
    );
  }
  if (strictDryRunReport.verdict !== GREEN) {
    reasons.push(
      `strict_dry_run=${strictDryRunReport.verdict}` +
        (strictDryRunReport.reason ? `: ${strictDryRunReport.reason}` : ""),
    );
  }
  if (rp.verdict !== GREEN) {
    reasons.push(
      `recent_publish=${rp.verdict}${rp.reason ? `: ${rp.reason}` : ""}`,
    );
  }

  // Recommendations
  if (Number(strictDryRunReport.ready_story_count || 0) > 0) {
    recommendations.push(
      `Route ${strictDryRunReport.ready_story_count} ready bridge candidates through HUMAN_REVIEW on enabled platforms; keep deferred platforms out of publish counts.`,
    );
  }
  if (mv.verdict !== GREEN && Number(strictDryRunReport.ready_story_count || 0) > 0) {
    recommendations.push(
      "Live DB media debt is separate from strict dry-run bridge readiness; repair legacy rows without downgrading current bridge candidates.",
    );
  }
  if (rh.raw && rh.raw.percentages && rh.raw.percentages.thin >= 50) {
    recommendations.push(
      "Hold off enabling BLOCK_THIN_VISUALS=true — over half of recent renders would be blocked.",
    );
  } else if (
    rh.raw &&
    rh.raw.percentages &&
    rh.raw.percentages.thin <= 10 &&
    rh.raw.stamped >= 10
  ) {
    recommendations.push(
      "BLOCK_THIN_VISUALS=true is approval-ready for a controlled next-window pilot; thin-visual rate is low across a meaningful sample, but this changes live publish gating.",
    );
  }
  if (
    rp.verdict === AMBER &&
    /last_publish_\d+h_ago/.test(rp.reason || "") &&
    Number(strictDryRunReport.ready_story_count || 0) === 0
  ) {
    recommendations.push(
      "Investigate why publishing has been stalled — check platform_status and queue_inspect.",
    );
  }

  if (rp.reason === "published_row_missing_timestamp") {
    recommendations.push(
      "Repair live publish timestamp metadata so cadence reports can trust the last-publish clock.",
    );
  }

  return {
    verdict,
    reasons,
    recommendations,
    pillars: {
      system_doctor: sd,
      platform_status: ps,
      media_verify: mv,
      render_health: rh,
      strict_dry_run: strictDryRunReport,
      recent_publish: rp,
    },
    story_count: stories.length,
    live_db_story_count: stories.length,
    strict_dry_run_summary: {
      story_count: Number(strictDryRunReport.story_count || 0),
      ready_story_count: Number(strictDryRunReport.ready_story_count || 0),
      blocked_story_count: Number(strictDryRunReport.blocked_story_count || 0),
      deferred_platform_action_count: Number(
        strictDryRunReport.deferred_platform_action_count || 0,
      ),
      live_publish_allowed_action_count: Number(
        strictDryRunReport.live_publish_allowed_action_count || 0,
      ),
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * Render the report as a Discord-friendly Markdown block.
 */
function formatControlRoomMarkdown(report) {
  if (!report) return "";
  const glyph = { green: "🟢", amber: "🟡", red: "🔴" };
  const lines = [];
  lines.push(
    `${glyph[report.verdict] || "⚪"} **Pulse Gaming Control Room** — ${report.verdict.toUpperCase()}`,
  );
  lines.push(`Live DB stories: ${report.live_db_story_count ?? report.story_count}`);
  if (report.strict_dry_run_summary) {
    const dryRun = report.strict_dry_run_summary;
    lines.push(
      `Strict dry-run: ${Number(dryRun.ready_story_count || 0)} ready / ` +
        `${Number(dryRun.blocked_story_count || 0)} blocked / ` +
        `${Number(dryRun.deferred_platform_action_count || 0)} deferred platform actions`,
    );
    lines.push(
      `Live publish allowed: ${Number(dryRun.live_publish_allowed_action_count || 0)}`,
    );
  }
  lines.push("");
  lines.push("**Pillars**");
  for (const [key, value] of Object.entries(report.pillars)) {
    const g = glyph[value.verdict] || "⚪";
    lines.push(
      `  ${g} ${key}: ${value.verdict}${value.reason ? ` — ${value.reason}` : ""}`,
    );
  }
  if (report.reasons.length > 0) {
    lines.push("");
    lines.push("**Reasons**");
    for (const r of report.reasons) lines.push(`  • ${r}`);
  }
  if (report.recommendations.length > 0) {
    lines.push("");
    lines.push("**Recommendations**");
    for (const r of report.recommendations) lines.push(`  • ${r}`);
  }
  return lines.join("\n");
}

module.exports = {
  buildControlRoomReport,
  formatControlRoomMarkdown,
  runSystemDoctor,
  runPlatformStatus,
  runMediaVerify,
  runRenderHealth,
  runStrictDryRun,
  readStrictDryRunPlan,
  evaluateStrictDryRunPlan,
  evaluateRecentPublish,
  normaliseVerdict,
  dominantVerdict,
  RED,
  AMBER,
  GREEN,
};
