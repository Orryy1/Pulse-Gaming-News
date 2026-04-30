"use strict";

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

function dominantVerdict(verdicts) {
  if (verdicts.includes(RED)) return RED;
  if (verdicts.includes(AMBER)) return AMBER;
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
    return {
      ok: true,
      verdict: report.verdict || (report.ok ? GREEN : AMBER),
      raw: report,
    };
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
    return {
      ok: true,
      verdict: status.verdict || GREEN,
      raw: status,
    };
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
    return {
      ok: true,
      verdict: report.verdict || (report.issueCount > 0 ? AMBER : GREEN),
      raw: report,
    };
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
    return {
      ok: true,
      verdict,
      raw: summary,
    };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `render_health: ${err.message}`,
    };
  }
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
    const ts = Date.parse(s.published_at || s.created_at || "") || 0;
    if (!latest || ts > latest.ts) {
      latest = { story: s, ts };
    }
  }
  if (!latest) {
    return { ok: false, verdict: AMBER, reason: "no_published_stories_found" };
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
  recentPublish = evaluateRecentPublish,
} = {}) {
  let stories = [];
  try {
    stories = (await db.getStories()) || [];
  } catch {
    stories = [];
  }

  const [sd, ps, mv, rh] = await Promise.all([
    systemDoctor(),
    platformStatus({ stories }),
    mediaVerify({ stories }),
    renderHealth({ stories }),
  ]);
  const rp = recentPublish(stories);

  const verdicts = [sd.verdict, ps.verdict, mv.verdict, rh.verdict, rp.verdict];
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
    reasons.push(
      `media_verify=${mv.verdict}${mv.reason ? `: ${mv.reason}` : ""}`,
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
  if (rp.verdict !== GREEN) {
    reasons.push(
      `recent_publish=${rp.verdict}${rp.reason ? `: ${rp.reason}` : ""}`,
    );
  }

  // Recommendations
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
      "Safe to flip BLOCK_THIN_VISUALS=true — thin-visual rate is low across a meaningful sample.",
    );
  }
  if (rp.verdict === AMBER && /last_publish_\d+h_ago/.test(rp.reason || "")) {
    recommendations.push(
      "Investigate why publishing has been stalled — check platform_status and queue_inspect.",
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
      recent_publish: rp,
    },
    story_count: stories.length,
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
  lines.push(`Stories in DB: ${report.story_count}`);
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
  evaluateRecentPublish,
  dominantVerdict,
  RED,
  AMBER,
  GREEN,
};
