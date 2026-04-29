/**
 * lib/observability.js — compact view layer over the Phase 1-9 stack.
 *
 * Everything the dashboard + Discord digests need in one module. None of
 * these helpers write to the DB except for the lightweight rolling
 * counter on identity-pack fallbacks, which lives in a dedicated table
 * if migration 011 has been applied, and falls back to an in-memory
 * process counter otherwise.
 *
 * Exports:
 *
 *   getQueueStats({ repos })
 *     Returns aggregated counts over jobs and derivatives, grouped by
 *     kind / status / gpu. Cheap — one SQL query per grouping.
 *
 *   getScoringDigest({ repos, sinceHours })
 *     Returns a structured summary of story_scores activity: totals by
 *     decision, top-3 scored stories, bottom-3 near-miss stories that
 *     fell into 'review' just under the auto threshold.
 *
 *   recordIdentityFallback({ channelId, requestedPack, fallbackPack,
 *                            role, flair, breaking, log })
 *     Emits a warning log and (if DISCORD_WEBHOOK_URL is set and
 *     OBSERVABILITY_IDENTITY_ALERTS is true) a Discord alert the first
 *     time a non-default channel falls back to pulse-v1 for a given role
 *     in this process. Deduplicated in-process so a render loop doesn't
 *     fire 50 identical warnings.
 *
 *   buildScoringDigestMessage(summary)
 *     Pure formatter — produces the Discord-ready digest string.
 */

const sendDiscord = require("../notify");

const _fallbackSeen = new Set();

const SECRET_PATTERNS = [
  /(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi,
  /((?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CLIENT[_-]?SECRET|ACCESS[_-]?TOKEN)\s*[=:]\s*)[^\s,;}]+/gi,
  /([?&](?:token|access_token|client_secret|api_key)=)[^&\s]+/gi,
];

function redactQueueError(value) {
  let text = String(value || "");
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "$1[REDACTED]");
  }
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

/**
 * Stats for the jobs + derivatives queues.
 *
 *   {
 *     jobs: {
 *       total: 42,
 *       by_status: { pending: 10, claimed: 1, done: 30, failed: 1 },
 *       by_kind:   [{ kind, status, gpu, n }...],
 *       gpu_pending: 5,
 *       oldest_pending_minutes: 12,
 *       stale_claims: 0,
 *     },
 *     derivatives: {
 *       total: 21,
 *       by_status: { pending: 7, generated: 10, rendered: 4 },
 *       by_kind:   [{ kind, status, n }...],
 *     },
 *   }
 */
function getQueueStats({ repos } = {}) {
  if (!repos) repos = require("./repositories").getRepos();
  const db = repos.db;

  const jobsByStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`)
    .all();
  const jobsByKind = db
    .prepare(
      `SELECT kind, status, requires_gpu AS gpu, COUNT(*) AS n
       FROM jobs GROUP BY kind, status, requires_gpu ORDER BY kind, status`,
    )
    .all();
  const gpuPending = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs WHERE status = 'pending' AND requires_gpu = 1`,
    )
    .get().n;
  const oldestPending = db
    .prepare(
      `SELECT MIN(run_at) AS t FROM jobs WHERE status = 'pending'
         AND run_at <= datetime('now')`,
    )
    .get();
  const staleClaims = db
    .prepare(
      `SELECT COUNT(*) AS n FROM jobs
        WHERE status = 'claimed' AND lease_until < datetime('now')`,
    )
    .get().n;
  const recentFailed = db
    .prepare(
      `SELECT id, kind, story_id, attempt_count, max_attempts, last_error, updated_at
       FROM jobs
       WHERE status = 'failed'
       ORDER BY updated_at DESC, id DESC
       LIMIT 5`,
    )
    .all()
    .map((job) => ({
      id: job.id,
      kind: job.kind,
      story_id: job.story_id || null,
      attempt_count: job.attempt_count,
      max_attempts: job.max_attempts,
      updated_at: job.updated_at,
      last_error: redactQueueError(job.last_error),
    }));
  const jobsTotal = db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n;

  let oldestPendingMinutes = null;
  if (oldestPending && oldestPending.t) {
    const ageMs = Date.now() - new Date(oldestPending.t + "Z").getTime();
    oldestPendingMinutes = Math.max(0, Math.round(ageMs / 60000));
  }

  const derivByStatus = db
    .prepare(`SELECT status, COUNT(*) AS n FROM derivatives GROUP BY status`)
    .all();
  const derivByKind = db
    .prepare(
      `SELECT kind, status, COUNT(*) AS n FROM derivatives
        GROUP BY kind, status ORDER BY kind, status`,
    )
    .all();
  const derivTotal = db
    .prepare(`SELECT COUNT(*) AS n FROM derivatives`)
    .get().n;

  return {
    jobs: {
      total: jobsTotal,
      by_status: Object.fromEntries(jobsByStatus.map((r) => [r.status, r.n])),
      by_kind: jobsByKind,
      gpu_pending: gpuPending,
      oldest_pending_minutes: oldestPendingMinutes,
      stale_claims: staleClaims,
      recent_failed: recentFailed,
    },
    derivatives: {
      total: derivTotal,
      by_status: Object.fromEntries(derivByStatus.map((r) => [r.status, r.n])),
      by_kind: derivByKind,
    },
    generated_at: new Date().toISOString(),
  };
}

/**
 * Summary of story_scores activity over the recent window.
 *
 *   {
 *     window_hours: 24,
 *     scored: 48,
 *     by_decision: { auto: 10, review: 30, defer: 5, reject: 3 },
 *     hard_stops: 2,
 *     top: [{ story_id, title, total, decision }, ...],
 *     near_miss: [{ story_id, title, total, decision }, ...],  // total in [60, 74]
 *     avg_total: 63.4,
 *   }
 */
function getScoringDigest({ repos, sinceHours = 24, channelId = null } = {}) {
  if (!repos) repos = require("./repositories").getRepos();
  const db = repos.db;
  const since = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

  const whereChannel = channelId ? `AND sc.channel_id = ?` : "";
  const params = channelId ? [since, channelId] : [since];

  const byDecision = db
    .prepare(
      `SELECT decision, COUNT(*) AS n FROM story_scores sc
        WHERE scored_at >= ? ${whereChannel}
        GROUP BY decision`,
    )
    .all(...params);

  const total = byDecision.reduce((a, r) => a + r.n, 0);
  const avgTotalRow = db
    .prepare(
      `SELECT AVG(total) AS avg FROM story_scores sc
        WHERE scored_at >= ? ${whereChannel}`,
    )
    .get(...params);

  const hardStops = db
    .prepare(
      `SELECT COUNT(*) AS n FROM story_scores sc
        WHERE scored_at >= ? ${whereChannel}
          AND hard_stops IS NOT NULL
          AND hard_stops != '[]'`,
    )
    .get(...params).n;

  const top = db
    .prepare(
      `SELECT sc.story_id, sc.total, sc.decision, s.title
         FROM story_scores sc
         LEFT JOIN stories s ON s.id = sc.story_id
        WHERE sc.scored_at >= ? ${whereChannel}
        ORDER BY sc.total DESC LIMIT 3`,
    )
    .all(...params);

  const nearMiss = db
    .prepare(
      `SELECT sc.story_id, sc.total, sc.decision, s.title
         FROM story_scores sc
         LEFT JOIN stories s ON s.id = sc.story_id
        WHERE sc.scored_at >= ? ${whereChannel}
          AND sc.decision = 'review'
          AND sc.total >= 60
        ORDER BY sc.total DESC LIMIT 3`,
    )
    .all(...params);

  return {
    window_hours: sinceHours,
    channel_id: channelId,
    scored: total,
    by_decision: Object.fromEntries(byDecision.map((r) => [r.decision, r.n])),
    hard_stops: hardStops,
    avg_total:
      avgTotalRow && avgTotalRow.avg
        ? Number(avgTotalRow.avg.toFixed(1))
        : null,
    top,
    near_miss: nearMiss,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Human-readable Discord-ready digest message.
 */
function buildScoringDigestMessage(summary) {
  if (!summary || !summary.scored) {
    return (
      `**Scoring Digest** (last ${summary && summary.window_hours}h) — ` +
      `no stories scored`
    );
  }
  const d = summary.by_decision || {};
  const lines = [
    `**Scoring Digest** (last ${summary.window_hours}h` +
      (summary.channel_id ? `, ${summary.channel_id}` : "") +
      `)`,
    `Scored: **${summary.scored}**   |   ` +
      `auto: ${d.auto || 0}   review: ${d.review || 0}   ` +
      `defer: ${d.defer || 0}   reject: ${d.reject || 0}   ` +
      `hard-stop: ${summary.hard_stops || 0}`,
    `Avg total: **${summary.avg_total ?? "n/a"}**`,
    "",
  ];
  if (summary.top && summary.top.length) {
    lines.push(`**Top ${summary.top.length}:**`);
    for (const t of summary.top) {
      lines.push(
        `- \`${t.total}\` (${t.decision}) ${String(t.title || t.story_id).slice(
          0,
          72,
        )}`,
      );
    }
  }
  if (summary.near_miss && summary.near_miss.length) {
    lines.push("");
    lines.push(`**Near-miss review (60-74):**`);
    for (const t of summary.near_miss) {
      lines.push(
        `- \`${t.total}\` ${String(t.title || t.story_id).slice(0, 72)}`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Called from the audio-identity resolver when a non-default channel
 * falls back to pulse-v1 for a role it should own. Dedupes per-process
 * per (channel, role, requestedPack) so we don't spam Discord.
 *
 * Arguments:
 *   channelId     — channel that asked for the stem
 *   requestedPack — the pack the channel should own (may be null if
 *                   the channel has no registered pack at all)
 *   fallbackPack  — the pack that actually provided the asset
 *   role, flair, breaking — context of the lookup
 *
 * Emits when:
 *   - channelId is not pulse-gaming
 *   - AND requestedPack !== fallbackPack (i.e. a real fallback happened)
 *   - AND we haven't already alerted this key in this process
 */
function recordIdentityFallback({
  channelId,
  requestedPack,
  fallbackPack,
  role,
  flair = null,
  breaking = false,
  log = console,
} = {}) {
  if (!channelId || channelId === "pulse-gaming") return;
  if (!fallbackPack || requestedPack === fallbackPack) return;

  const key = `${channelId}:${role}:${requestedPack || "none"}:${fallbackPack}`;
  if (_fallbackSeen.has(key)) return;
  _fallbackSeen.add(key);

  const msg =
    `[audio-identity] fallback: channel=${channelId} role=${role} ` +
    `flair=${flair || "-"} breaking=${breaking} requested=${requestedPack || "none"} ` +
    `-> fallback=${fallbackPack}`;
  if (log && log.warn) log.warn(msg);
  else if (log && log.log) log.log(msg);

  // Discord alert opt-in — turns off cleanly in dev.
  if (process.env.OBSERVABILITY_IDENTITY_ALERTS === "true") {
    sendDiscord(
      `**Identity-pack fallback** — \`${channelId}\` has no \`${role}\` ` +
        `stem${flair ? ` (flair=${flair})` : ""}; inherited from ` +
        `\`${fallbackPack}\`. Add an asset to the channel's pack.json ` +
        `to close this fallback.`,
    ).catch(() => {});
  }
}

function resetFallbackCache() {
  _fallbackSeen.clear();
}

module.exports = {
  getQueueStats,
  getScoringDigest,
  buildScoringDigestMessage,
  recordIdentityFallback,
  resetFallbackCache,
  redactQueueError,
};
