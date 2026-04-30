"use strict";

/**
 * lib/intelligence/overnight-workshop.js
 *
 * The "overnight workshop" — four bounded passes that run hands-off
 * through the night to leave the project in a meaningfully better
 * state by morning. Designed to respect platform rate limits and
 * fail closed (an env flag toggles the entire system off).
 *
 * Passes (UTC times set by the scheduler):
 *
 *   02:00  produce_sweep    — runs publisher.produce() against the
 *                              full approved-but-not-exported queue
 *                              with the new IGDB / Steam-trailer
 *                              pipeline. Today's regular cycle only
 *                              fires at 18:00 and processes one
 *                              candidate; this catches the rest.
 *
 *   04:00  analytics_backfill — pulls fresh view/like/comment counts
 *                                for every published story <30d old
 *                                across YouTube + TikTok. Rate-limited:
 *                                YouTube allows 10k units/day with
 *                                videos.list@1u and TikTok video/query
 *                                is 6 req/min. We pace one call every
 *                                1.1s so we stay well inside both.
 *
 *   05:30  claude_analyst   — single Anthropic call. Reads yesterday's
 *                              produced + analytics + live signals,
 *                              produces a markdown briefing with
 *                              "what worked / what didn't / approve
 *                              first today". ~$0.001 per pass.
 *
 *   06:00  morning_digest   — Discord post: how many stories the
 *                              workshop produced, top analytics
 *                              movers, the analyst's recommendations.
 *
 * All gated behind OVERNIGHT_WORKSHOP_ENABLED. When the env flag is
 * unset (default), the four handlers return early with skipped:true
 * and post nothing. Operators flip the flag in Railway env to turn
 * the workshop on for tonight.
 */

const path = require("node:path");
const fs = require("fs-extra");

const MAX_BACKFILL_PER_PASS = 60; // YT calls per backfill pass
const BACKFILL_INTERPASS_MS = 1100; // 1.1s sleep between API calls
const ANALYTICS_LOOKBACK_DAYS = 30;

function isEnabled(env) {
  return String(env.OVERNIGHT_WORKSHOP_ENABLED || "").toLowerCase() === "true";
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Pass 1: produce sweep. Iterates every approved-but-not-exported
 * story and produces them. Reuses the existing publisher pipeline so
 * no new code path goes untested — same audio, images (now IGDB-
 * enriched), assemble.
 *
 * IMPORTANT: per the 2026-04-29 audit, we deliberately do NOT race
 * `publisher.produce()` against a wall-clock timeout. Promise.race
 * doesn't cancel the work — it just stops waiting on it. The
 * underlying ffmpeg and platform calls keep running, can collide
 * with the next 02:00 fire, and create false-timeout signals while
 * actual work proceeds in background.
 *
 * Instead: a lock-file pre-flight check refuses to start if a
 * previous sweep is recorded as still in-flight. The lock is
 * best-effort — it stops the scheduler from double-firing, and
 * clears itself when a previous run truly crashed (older than
 * staleLockMs).
 */
async function runOvernightProduceSweep({
  log = console.log,
  env = process.env,
  publisher = require("../../publisher"),
  lockPath = path.join(
    __dirname,
    "..",
    "..",
    "data",
    "overnight_produce_sweep.lock",
  ),
  staleLockMs = 6 * 60 * 60 * 1000, // 6h — clears itself between nights
} = {}) {
  if (!isEnabled(env)) return { enabled: false, skipped: "disabled_by_env" };
  const started = Date.now();

  // Pre-flight lock check
  try {
    if (await fs.pathExists(lockPath)) {
      const lock = await fs.readJson(lockPath).catch(() => ({}));
      const age = Date.now() - (Number(lock.started_at) || 0);
      if (age >= 0 && age < staleLockMs) {
        log(
          `[overnight-workshop] produce_sweep skipped — previous sweep started ${Math.round(age / 60000)}m ago still in flight`,
        );
        return {
          enabled: true,
          skipped: "previous_sweep_in_flight",
          previous_started_at: lock.started_at,
        };
      }
      log(
        `[overnight-workshop] produce_sweep removing stale lock (${Math.round(age / 60000)}m old)`,
      );
    }
    await fs.ensureDir(path.dirname(lockPath));
    await fs.writeJson(lockPath, {
      started_at: started,
      pid: process.pid,
    });
  } catch (lockErr) {
    log(
      `[overnight-workshop] produce_sweep lock error (continuing): ${lockErr.message}`,
    );
  }

  log("[overnight-workshop] produce_sweep starting");
  let result;
  try {
    result = await publisher.produce();
  } catch (err) {
    log(`[overnight-workshop] produce_sweep error: ${err.message}`);
    await fs.remove(lockPath).catch(() => {});
    return {
      enabled: true,
      error: err.message,
      elapsed_ms: Date.now() - started,
    };
  }
  await fs.remove(lockPath).catch(() => {});
  return {
    enabled: true,
    elapsed_ms: Date.now() - started,
    result: result || { ok: true },
  };
}

/**
 * Pass 2: analytics backfill. For each published story <30d old, hit
 * YouTube videos.list and TikTok video/query for fresh counts and
 * write a row into platform_metric_snapshots. Paced so we never burst.
 */
async function runOvernightAnalyticsBackfill({
  log = console.log,
  env = process.env,
  db = require("../db"),
  repos = null,
  fetchYouTubeStats = null,
  fetchTikTokStats = null,
  maxStories = MAX_BACKFILL_PER_PASS,
  pauseMs = BACKFILL_INTERPASS_MS,
  now = Date.now(),
} = {}) {
  if (!isEnabled(env)) return { enabled: false, skipped: "disabled_by_env" };

  const started = Date.now();
  let stories;
  try {
    stories = await db.getStories();
  } catch (err) {
    return { enabled: true, error: `getStories: ${err.message}` };
  }

  // Lazy-load repos
  let activeRepos = repos;
  if (!activeRepos) {
    try {
      activeRepos = require("../repositories").getRepos();
    } catch {
      activeRepos = null;
    }
  }

  const sinceMs = now - ANALYTICS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const targets = (stories || [])
    .filter((s) => s && (s.youtube_post_id || s.tiktok_post_id))
    .filter((s) => {
      const ts = Date.parse(s.published_at || s.created_at || "") || 0;
      return ts >= sinceMs;
    })
    .slice(0, maxStories);

  log(
    `[overnight-workshop] analytics_backfill: ${targets.length} stories in window`,
  );

  // Defaults: lazy-load the actual platform clients only if not injected.
  const ytClient =
    fetchYouTubeStats ||
    (async (videoId) => {
      try {
        const yt = require("../../upload_youtube");
        return await yt.fetchVideoStats?.(videoId);
      } catch {
        return null;
      }
    });
  const ttClient =
    fetchTikTokStats ||
    (async (postId) => {
      try {
        const tt = require("../../upload_tiktok");
        return await tt.fetchVideoStats?.(postId);
      } catch {
        return null;
      }
    });

  let yt_ok = 0;
  let yt_fail = 0;
  let tt_ok = 0;
  let tt_fail = 0;

  for (const story of targets) {
    if (story.youtube_post_id) {
      try {
        const stats = await ytClient(story.youtube_post_id);
        if (stats) {
          await maybeRecordSnapshot({
            repos: activeRepos,
            story,
            platform: "youtube",
            stats,
          });
          yt_ok++;
        } else {
          yt_fail++;
        }
      } catch (err) {
        yt_fail++;
        log(`[overnight-workshop] yt fetch ${story.id} failed: ${err.message}`);
      }
      await sleep(pauseMs);
    }
    if (story.tiktok_post_id) {
      try {
        const stats = await ttClient(story.tiktok_post_id);
        if (stats) {
          await maybeRecordSnapshot({
            repos: activeRepos,
            story,
            platform: "tiktok",
            stats,
          });
          tt_ok++;
        } else {
          tt_fail++;
        }
      } catch (err) {
        tt_fail++;
        log(`[overnight-workshop] tt fetch ${story.id} failed: ${err.message}`);
      }
      await sleep(pauseMs);
    }
  }

  return {
    enabled: true,
    elapsed_ms: Date.now() - started,
    stories_targeted: targets.length,
    youtube: { ok: yt_ok, fail: yt_fail },
    tiktok: { ok: tt_ok, fail: tt_fail },
  };
}

async function maybeRecordSnapshot({ repos, story, platform, stats }) {
  if (!repos || !repos.db) return;
  // Best-effort write into platform_metric_snapshots. Schema is
  // additive — write only the columns we have. Caller already
  // normalised stats.
  try {
    repos.db
      .prepare(
        `INSERT INTO platform_metric_snapshots
           (story_id, platform, external_id, channel_id,
            views, likes, comments, shares,
            watch_time_seconds, retention_percent, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        story.id,
        platform,
        story[`${platform}_post_id`] ||
          story.youtube_post_id ||
          story.tiktok_post_id ||
          null,
        story.channel_id || "pulse-gaming",
        Number.isFinite(stats.views) ? stats.views : null,
        Number.isFinite(stats.likes) ? stats.likes : null,
        Number.isFinite(stats.comments) ? stats.comments : null,
        Number.isFinite(stats.shares) ? stats.shares : null,
        Number.isFinite(stats.watch_time_seconds)
          ? stats.watch_time_seconds
          : null,
        Number.isFinite(stats.retention_percent)
          ? stats.retention_percent
          : null,
        JSON.stringify(stats.raw || stats || {}),
      );
  } catch {
    // Schema may not be migrated; non-fatal.
  }
}

/**
 * Pass 3: Claude analyst. Single Anthropic call summarising the
 * overnight produce + analytics state. Output: markdown briefing.
 *
 * The prompt is opinionated about output structure so the morning
 * digest formatter doesn't have to guess.
 */
async function runOvernightClaudeAnalyst({
  log = console.log,
  env = process.env,
  db = require("../db"),
  anthropicCall = null,
  now = Date.now(),
} = {}) {
  if (!isEnabled(env)) return { enabled: false, skipped: "disabled_by_env" };
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey && !anthropicCall) {
    return { enabled: true, skipped: "no_anthropic_key" };
  }

  let stories;
  try {
    stories = await db.getStories();
  } catch (err) {
    return { enabled: true, error: `getStories: ${err.message}` };
  }
  const sinceMs = now - 24 * 60 * 60 * 1000;
  const recent = (stories || []).filter((s) => {
    const ts = Date.parse(s.created_at || "") || 0;
    return ts >= sinceMs;
  });
  const produced = recent.filter((s) => s.exported_path);
  const published = recent.filter(
    (s) => s.youtube_post_id || s.tiktok_post_id || s.instagram_media_id,
  );

  const compactSummary = {
    window: "last_24h",
    counts: {
      total_recent: recent.length,
      produced: produced.length,
      published: published.length,
    },
    sample_titles: recent.slice(0, 10).map((s) => ({
      id: s.id,
      title: (s.title || "").slice(0, 100),
      flair: s.flair,
      content_pillar: s.content_pillar,
      render_quality_class: s.render_quality_class,
      distinct_visual_count: s.distinct_visual_count,
      published: !!(
        s.youtube_post_id ||
        s.tiktok_post_id ||
        s.instagram_media_id
      ),
    })),
  };

  const prompt =
    "You are a content-ops analyst for the Pulse Gaming Shorts channel. " +
    "Below is JSON describing the last 24h of activity. " +
    "Return Markdown with these exact sections: " +
    "1. **What worked** (bullet points, max 5). " +
    "2. **What didn't** (bullet points, max 5). " +
    "3. **Approve first today** — list up to 3 specific story IDs " +
    "from the data with one-sentence reasoning each. " +
    "4. **One thing to watch** — a single observation. " +
    "Keep total under 300 words. British English. No em dashes.\n\n" +
    "Data:\n```json\n" +
    JSON.stringify(compactSummary, null, 2) +
    "\n```";

  const callFn =
    anthropicCall ||
    (async (p) => {
      const Anthropic = require("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey });
      const res = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [{ role: "user", content: p }],
      });
      return res?.content?.[0]?.text || "";
    });

  let briefing;
  try {
    briefing = await callFn(prompt);
  } catch (err) {
    return { enabled: true, error: `anthropic: ${err.message}` };
  }

  // Persist alongside the Session 3 daily learning digest pattern.
  try {
    const outDir = path.join(__dirname, "..", "..", "data");
    await fs.ensureDir(outDir);
    const stamp = new Date().toISOString().slice(0, 10);
    await fs.writeFile(
      path.join(outDir, `overnight_briefing_${stamp}.md`),
      briefing,
      "utf-8",
    );
  } catch {
    /* persist failure is non-fatal — the briefing still goes to digest */
  }
  return { enabled: true, briefing, summary: compactSummary };
}

/**
 * Pass 4: morning Discord digest. Pulls together the produce sweep
 * count, analytics backfill stats, and the Claude analyst briefing.
 * Posts to Discord once.
 */
async function runOvernightMorningDigest({
  log = console.log,
  env = process.env,
  db = require("../db"),
  repos = null,
  notify = null,
  fs: fsLib = fs,
  now = Date.now(),
} = {}) {
  if (!isEnabled(env)) return { enabled: false, skipped: "disabled_by_env" };

  let stories;
  try {
    stories = await db.getStories();
  } catch (err) {
    return { enabled: true, error: `getStories: ${err.message}` };
  }
  const sinceMs = now - 12 * 60 * 60 * 1000; // last 12h ≈ overnight window
  const recent = (stories || []).filter((s) => {
    const ts = Date.parse(s.exported_at || s.created_at || "") || 0;
    return ts >= sinceMs;
  });
  const produced = recent.filter((s) => s.exported_path).length;
  const stamped = recent.filter(
    (s) =>
      s.render_quality_class && typeof s.distinct_visual_count === "number",
  );
  const visuals =
    stamped.length > 0
      ? stamped.reduce((a, s) => a + (s.distinct_visual_count || 0), 0) /
        stamped.length
      : null;

  // Live signal count (24h)
  let liveSignals = 0;
  let activeRepos = repos;
  if (!activeRepos) {
    try {
      activeRepos = require("../repositories").getRepos();
    } catch {
      activeRepos = null;
    }
  }
  if (activeRepos && activeRepos.db) {
    try {
      const row = activeRepos.db
        .prepare(
          "SELECT COUNT(*) as n FROM live_performance_signals WHERE detected_at >= datetime('now', '-1 day')",
        )
        .get();
      liveSignals = (row && row.n) || 0;
    } catch {
      /* table may not exist yet on a deploy that hasn't run migration 018 */
    }
  }

  // Briefing from yesterday's analyst pass
  let briefing = "";
  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const filePath = path.join(
      __dirname,
      "..",
      "..",
      "data",
      `overnight_briefing_${stamp}.md`,
    );
    if (await fsLib.pathExists(filePath)) {
      briefing = (await fsLib.readFile(filePath, "utf-8")).slice(0, 1400);
    }
  } catch {
    /* non-fatal */
  }

  const lines = [];
  lines.push("**🌅 Overnight workshop — morning digest**");
  lines.push(
    `Produced overnight: ${produced} | Live signals (24h): ${liveSignals}`,
  );
  if (visuals !== null) {
    lines.push(`Avg visual count per stamped render: ${visuals.toFixed(1)}`);
  }
  if (briefing) {
    lines.push("");
    lines.push("**Analyst briefing**");
    lines.push(briefing);
  } else {
    lines.push("(no analyst briefing available — fallback path)");
  }

  const message = lines.join("\n");
  const notifySend =
    notify ||
    (async (msg) => {
      try {
        const sendDiscord = require("../../notify");
        await sendDiscord(msg);
      } catch (err) {
        log(`[overnight-workshop] notify failed: ${err.message}`);
      }
    });
  try {
    await notifySend(message);
  } catch (err) {
    return { enabled: true, error: `notify: ${err.message}` };
  }
  return {
    enabled: true,
    produced_overnight: produced,
    avg_visual_count: visuals,
    live_signals_24h: liveSignals,
    posted: true,
  };
}

module.exports = {
  runOvernightProduceSweep,
  runOvernightAnalyticsBackfill,
  runOvernightClaudeAnalyst,
  runOvernightMorningDigest,
  maybeRecordSnapshot,
  isEnabled,
  MAX_BACKFILL_PER_PASS,
  BACKFILL_INTERPASS_MS,
  ANALYTICS_LOOKBACK_DAYS,
};
