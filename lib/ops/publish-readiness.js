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

async function pillarPlatformStatus({ stories } = {}) {
  const ps = safeRequire("./platform-status");
  if (!ps || typeof ps.buildPlatformStatus !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
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
      reason: summarisePlatformStatusReason(status),
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

function pillarRenderMetadata({ stories } = {}) {
  // Reports stamped/unstamped breakdown over recent stories.
  const recent = (stories || [])
    .filter((s) => s && s.exported_path)
    .slice(0, 30);
  if (recent.length === 0) {
    return { ok: false, verdict: UNKNOWN, reason: "no_exported_stories" };
  }
  let stamped = 0;
  const laneCounts = {};
  const classCounts = {};
  for (const s of recent) {
    if (s.render_lane) {
      stamped++;
      laneCounts[s.render_lane] = (laneCounts[s.render_lane] || 0) + 1;
    }
    if (s.render_quality_class) {
      classCounts[s.render_quality_class] =
        (classCounts[s.render_quality_class] || 0) + 1;
    }
  }
  const stampedPct = recent.length > 0 ? stamped / recent.length : 0;
  let verdict = GREEN;
  if (stampedPct < 0.5) verdict = AMBER;
  return {
    ok: true,
    verdict,
    raw: {
      stamped,
      total: recent.length,
      stamped_pct: Math.round(stampedPct * 100),
      lane_counts: laneCounts,
      class_counts: classCounts,
    },
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
    disabled_platform_count: disabledPlatformCount,
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

  if (
    raw.overall_verdict === RED ||
    raw.blocked_story_count > 0 ||
    raw.blocked_action_count > 0
  ) {
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
    return {
      ok: false,
      verdict: deadEndItems > 0 ? RED : AMBER,
      reason: summariseRepairBacklogReason(report),
      raw,
    };
  }

  return {
    ok: true,
    verdict: GREEN,
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
  let verdict = GREEN;
  if (ageHours > 48) verdict = AMBER;
  return {
    ok: true,
    verdict,
    raw: {
      latest_id: latest.story.id,
      latest_title: (latest.story.title || "").slice(0, 80),
      age_hours: Math.round(ageHours),
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
  "railway_deploy",
  "queue_health",
  "publish_cadence",
  "strict_dry_run_control",
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

  const strictDryRun = pillars.strict_dry_run_control;
  if (strictDryRun?.verdict === RED) {
    return "Do not publish. Strict dry-run preflight has active blockers.";
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
    sd = rd = qh = ps = mv = mi = docs = skipped;
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

    [sd, rd, qh, ps, mv, mi, docs] = await Promise.all([
      pillarSystemDoctor(),
      pillarRailwayDeploy(),
      pillarQueueHealth(),
      pillarPlatformStatus({ stories }),
      pillarMediaVerify({ stories, planPath: opts.strictDryRunPlanPath }),
      pillarMediaInventory({ stories }),
      docsPromise,
    ]);
  }

  const rawPillars = {
    system_doctor: sd,
    railway_deploy: rd,
    queue_health: qh,
    publish_cadence: pillarPublishCadence({ stories, env, now }),
    strict_dry_run_control: pillarStrictDryRunControl({
      planPath: opts.strictDryRunPlanPath,
      now,
      maxAgeHours: opts.strictDryRunMaxAgeHours,
    }),
    repair_backlog: pillarRepairBacklog({
      repairBacklogPath: opts.repairBacklogPath,
      now,
      maxAgeHours: opts.repairBacklogMaxAgeHours,
    }),
    platform_status: ps,
    media_verify: mv,
    media_inventory: mi,
    topicality_gate: pillarTopicalityGate(),
    visual_count_gate: pillarVisualCountGate({ env }),
    thumbnail_safety: pillarThumbnailSafety(),
    render_metadata: pillarRenderMetadata({ stories }),
    instagram_pending: pillarInstagramPending({ stories }),
    tiktok_external_block: pillarTiktokExternalBlock({ doctorPath: opts.platformDoctorPath }),
    facebook_reel_eligibility: pillarFacebookReelEligibility(),
    facebook_card_fallback: pillarFacebookCardFallback({ stories }),
    recent_failed_candidates: pillarRecentFailedCandidates({ stories, now }),
    recent_skipped_qa: pillarRecentSkippedQa({ stories }),
    recent_publish: pillarRecentPublish({ stories }),
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
  pillarStrictDryRunControl,
  pillarRepairBacklog,
  pillarFacebookReelEligibility,
  PILLAR_NAMES,
  RED,
  AMBER,
  GREEN,
  UNKNOWN,
  summariseSystemDoctorReason,
  summariseMediaVerifyReason,
  summarisePlatformStatusReason,
  summariseTiktokExternalBlockReason,
  summariseRepairBacklogReason,
  buildMediaVerifyStoriesFromDryRunPlan,
  summariseRecentFailedCandidates,
};
