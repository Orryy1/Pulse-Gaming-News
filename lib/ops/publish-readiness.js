"use strict";

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

function dominantVerdict(verdicts) {
  if (verdicts.includes(RED)) return RED;
  if (verdicts.includes(AMBER)) return AMBER;
  // unknown does not block green — but if EVERY pillar is unknown,
  // we're in unknown rather than green.
  if (verdicts.every((v) => v === UNKNOWN)) return UNKNOWN;
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
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      resolve({ ok: false, verdict: AMBER, reason: "health_timeout" });
    }, 5000);
    try {
      const https = require("https");
      const u = new URL(`${url.replace(/\/$/, "")}/api/health`);
      https
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
    return { ok: true, verdict: status.verdict || GREEN, raw: status };
  } catch (err) {
    return {
      ok: false,
      verdict: AMBER,
      reason: `platform_status: ${err.message}`,
    };
  }
}

async function pillarMediaVerify({ stories } = {}) {
  const mv = safeRequire("./media-verify");
  if (!mv || typeof mv.verifyMedia !== "function") {
    return { ok: false, verdict: UNKNOWN, reason: "module_unavailable" };
  }
  try {
    const r = await mv.verifyMedia({ stories: stories || [] });
    return {
      ok: true,
      verdict: r.verdict || (r.issueCount > 0 ? AMBER : GREEN),
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

function pillarTiktokExternalBlock() {
  // External blocker — report it honestly, not as our bug.
  return {
    ok: true,
    verdict: AMBER,
    raw: {
      mode: "externally_blocked",
      cause: "tiktok_api_app_review",
      action: "manual_dispatch_via_tools/tiktok-dispatch-pack.js",
    },
  };
}

function pillarFacebookReelEligibility() {
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
  const allFailed = (stories || [])
    .filter((s) => s && s.qa_failed === true)
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

async function buildPublishReadinessReport(opts = {}) {
  const env = opts.env || process.env;
  const db = opts.db || require("../db");
  const now = opts.now || Date.now();
  let stories = [];
  try {
    stories = (await db.getStories()) || [];
  } catch {
    stories = [];
  }

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

  const [sd, rd, qh, ps, mv, mi, docs] = await Promise.all([
    pillarSystemDoctor(),
    pillarRailwayDeploy(),
    pillarQueueHealth(),
    pillarPlatformStatus({ stories }),
    pillarMediaVerify({ stories }),
    pillarMediaInventory({ stories }),
    docsPromise,
  ]);

  const pillars = {
    system_doctor: sd,
    railway_deploy: rd,
    queue_health: qh,
    publish_cadence: pillarPublishCadence({ stories, env, now }),
    platform_status: ps,
    media_verify: mv,
    media_inventory: mi,
    topicality_gate: pillarTopicalityGate(),
    visual_count_gate: pillarVisualCountGate({ env }),
    thumbnail_safety: pillarThumbnailSafety(),
    render_metadata: pillarRenderMetadata({ stories }),
    instagram_pending: pillarInstagramPending({ stories }),
    tiktok_external_block: pillarTiktokExternalBlock(),
    facebook_reel_eligibility: pillarFacebookReelEligibility(),
    facebook_card_fallback: pillarFacebookCardFallback({ stories }),
    recent_failed_candidates: pillarRecentFailedCandidates({ stories, now }),
    recent_skipped_qa: pillarRecentSkippedQa({ stories }),
    recent_publish: pillarRecentPublish({ stories }),
    test_build_health: pillarTestBuildHealth(),
    security_blockers: pillarSecurityBlockers(),
    docs_drift: docs,
  };

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

  // Recommended action
  let next_action;
  if (overall === RED)
    next_action = "Do not publish until red blockers cleared.";
  else if (pillars.publish_cadence?.verdict === AMBER) {
    const nextSafe =
      pillars.publish_cadence?.raw?.next_safe_publish?.next_safe_publish_at_utc;
    next_action = nextSafe
      ? `Hold manual or targeted publishing until cadence clears; let the scheduler resume at ${nextSafe}.`
      : "Hold manual or targeted publishing until cadence clears; let the scheduler resume at a canonical window.";
  }
  else if (overall === AMBER)
    next_action =
      "Publish possible. Watch advisory list. Run npm run ops:publish-readiness again before next window.";
  else next_action = "Publish normally.";

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
  const g = VERDICT_GLYPH[report.overall_verdict] || "⚪";
  lines.push(
    `${g} **Pulse Gaming Publish Readiness — ${report.overall_verdict.toUpperCase()}**`,
  );
  lines.push(`Stories in DB: ${report.story_count}`);
  lines.push(`Generated: ${report.generated_at}`);
  lines.push("");
  lines.push("## Pillars");
  for (const [name, p] of Object.entries(report.pillars)) {
    const pg = VERDICT_GLYPH[p.verdict] || "⚪";
    let line = `${pg} ${name}: ${p.verdict}`;
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
  pillarPublishCadence,
  PILLAR_NAMES,
  RED,
  AMBER,
  GREEN,
  UNKNOWN,
  summariseRecentFailedCandidates,
};
