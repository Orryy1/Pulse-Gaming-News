"use strict";

/**
 * lib/intelligence/live-performance-analyst.js
 *
 * The "living, breathing" continuous-analysis model. Fires every 30
 * minutes via the scheduler. For each story published in the last
 * 72h (the engagement-meaningful window):
 *
 *   1. Fetch the latest platform metric snapshot (views, watch %,
 *      comments, etc) from platform_metric_snapshots.
 *   2. Look up the story's feature row (hook_type, topic, content
 *      pillar, source, render_quality_class, publish_hour, etc).
 *   3. Update the incremental Welford-online statistics in
 *      live_model_state — running mean + M2 per (feature, metric).
 *   4. For each story, compute the "predicted" value as the mean of
 *      the matching (feature_kind, feature_value) cells, and the
 *      observed value from the latest snapshot. If the observed is
 *      >= OUTLIER_SIGMA standard deviations from predicted, write a
 *      live_performance_signals row and (optionally) Discord notify.
 *
 * Welford's algorithm (numerically stable online mean/variance):
 *   delta = x - mean
 *   mean += delta / n
 *   delta2 = x - mean
 *   M2 += delta * delta2
 *   variance = M2 / n
 *
 * Why this design:
 *   - Bounded work per 30-min tick. Only stories <72h old, only the
 *     latest snapshot per platform. Linear in story count.
 *   - No matrix algebra / no LLM call. Cheap enough to run every 30
 *     min indefinitely.
 *   - Per-feature mean instead of full regression. With dozens of
 *     videos as N, full regression overfits. Per-feature mean gives
 *     interpretable signal ("hook_type=question performs 1.8× the
 *     channel median").
 *   - Welford lets us update statistics incrementally so we never
 *     re-read the full snapshot history. Running totals persist in
 *     live_model_state, so a Railway redeploy doesn't reset the
 *     model.
 *
 * Env-gated. handler returns early when LIVE_ANALYST_ENABLED !== "true".
 *
 * Output is signal rows + (optionally) a Discord notify when an
 * outlier crosses LIVE_NOTIFY_SIGMA. Signal rows are append-only;
 * the morning digest reads the last 24h.
 */

const FEATURE_KINDS = [
  "hook_type",
  "topic",
  "content_pillar",
  "source_type",
  "publish_hour_utc",
  "render_quality_class",
  "comment_source_type",
];

// Outlier triggers
const OUTLIER_SIGMA = 1.5; // log a signal when |z| >= this
const NOTIFY_SIGMA = 2.5; // additionally Discord-notify when |z| >= this

// Minimum sample count in the (feature, metric) cell for σ to be
// trustworthy. Below this we still write a signal but mark it
// confidence='low'.
const MIN_SAMPLES_FOR_CONFIDENCE = 5;

const LOOKBACK_HOURS = 72; // analyse stories published in this window

/**
 * Welford online update. Given current (n, mean, m2) and a new value,
 * returns updated (n, mean, m2). Pure.
 */
function welfordUpdate(state, value) {
  const n = (state.sample_count || 0) + 1;
  const delta = value - (state.running_mean || 0);
  const mean = (state.running_mean || 0) + delta / n;
  const delta2 = value - mean;
  const m2 = (state.running_m2 || 0) + delta * delta2;
  return { sample_count: n, running_mean: mean, running_m2: m2 };
}

function variance(state) {
  const n = state.sample_count || 0;
  if (n < 2) return 0;
  return state.running_m2 / n;
}

function stdev(state) {
  return Math.sqrt(variance(state));
}

/**
 * Pull the latest metric snapshot for a story across all platforms,
 * collapsing to one row per platform (the most recent).
 */
function latestSnapshotsByPlatform(snapshots) {
  const out = new Map();
  for (const s of snapshots || []) {
    const platform = s.platform || "unknown";
    const at = s.snapshot_at || s.captured_at || "";
    const prev = out.get(platform);
    if (!prev || at > (prev.snapshot_at || prev.captured_at || "")) {
      out.set(platform, s);
    }
  }
  return out;
}

/**
 * Extract the feature dimensions we want to track from a story.
 * Returns an object keyed by FEATURE_KINDS, with values normalised to
 * lowercase short strings.
 */
function extractFeatures(story) {
  const safe = (v, fallback = "unknown") =>
    v == null || v === "" ? fallback : String(v).toLowerCase();
  let publishHour = "unknown";
  if (story.youtube_post_id || story.published_at || story.created_at) {
    const ts = Date.parse(story.published_at || story.created_at || "");
    if (!Number.isNaN(ts)) {
      publishHour = String(new Date(ts).getUTCHours());
    }
  }
  return {
    hook_type: safe(story.hook_type),
    topic: safe(story.topic),
    content_pillar: safe(story.content_pillar),
    source_type: safe(story.source_type),
    publish_hour_utc: publishHour,
    render_quality_class: safe(story.render_quality_class),
    comment_source_type: safe(story.comment_source_type),
  };
}

/**
 * Filter stories to those published in the lookback window AND that
 * have a platform metric snapshot we can analyse.
 */
function selectAnalysableStories(stories, snapshotIndex, now = Date.now()) {
  const sinceMs = now - LOOKBACK_HOURS * 60 * 60 * 1000;
  const out = [];
  for (const s of stories || []) {
    if (!s) continue;
    if (!s.youtube_post_id && !s.tiktok_post_id && !s.instagram_media_id)
      continue;
    const ts = Date.parse(s.published_at || s.created_at || "") || 0;
    if (ts < sinceMs) continue;
    const snaps = snapshotIndex.get(s.id) || [];
    if (snaps.length === 0) continue;
    out.push(s);
  }
  return out;
}

/**
 * Pure: take a story + its latest snapshot + the current model state map,
 * and return:
 *   - updates:  rows to upsert into live_model_state
 *   - signals:  rows to insert into live_performance_signals
 */
function analyseStory({
  story,
  snapshot,
  modelState,
  outlierSigma = OUTLIER_SIGMA,
}) {
  const features = extractFeatures(story);
  const observed = {
    views: Number(snapshot.views) || 0,
    // platform_metric_snapshots stores retention as `retention_percent`
    // (already 0–100). Normalise to 0–1 to match avg_view_pct semantics.
    avg_view_pct:
      Number(snapshot.retention_percent || snapshot.average_percentage_viewed) /
        100 || 0,
    comments_per_view:
      Number(snapshot.views) > 0
        ? (Number(snapshot.comments) || 0) / Number(snapshot.views)
        : 0,
  };
  const updates = [];
  const signals = [];

  for (const featureKind of FEATURE_KINDS) {
    const featureValue = features[featureKind];
    for (const metric of Object.keys(observed)) {
      const key = `${featureKind}|${featureValue}|${metric}`;
      const prev = modelState.get(key) || {
        feature_kind: featureKind,
        feature_value: featureValue,
        metric,
        sample_count: 0,
        running_mean: 0,
        running_m2: 0,
      };
      const updated = welfordUpdate(prev, observed[metric]);
      const next = { ...prev, ...updated };
      updates.push(next);
      modelState.set(key, next);

      // Outlier check uses the PREVIOUS state (avoids self-bias).
      if (prev.sample_count >= 2) {
        const sigma = stdev(prev);
        if (sigma > 0) {
          const z = (observed[metric] - prev.running_mean) / sigma;
          if (Math.abs(z) >= outlierSigma) {
            signals.push({
              story_id: story.id,
              channel_id: story.channel_id || "pulse-gaming",
              signal_kind:
                z >= 0 ? "outlier_overperform" : "outlier_underperform",
              severity: Number(z.toFixed(3)),
              metric,
              observed_value: observed[metric],
              predicted_value: prev.running_mean,
              features_json: JSON.stringify(features),
              raw_json: JSON.stringify({
                snapshot_label: snapshot.snapshot_label,
                snapshot_at: snapshot.snapshot_at,
                feature_kind: featureKind,
                feature_value: featureValue,
                prior_n: prev.sample_count,
                prior_sigma: Number(sigma.toFixed(4)),
                confidence:
                  prev.sample_count >= MIN_SAMPLES_FOR_CONFIDENCE
                    ? "high"
                    : "low",
              }),
            });
          }
        }
      }
    }
  }
  return { updates, signals };
}

/**
 * Run one full pass. Reads stories + snapshots + model state via repos,
 * computes updates + signals, persists.
 *
 * Returns:
 *   {
 *     enabled: boolean,
 *     analysed: number,        // stories analysed
 *     signals_logged: number,
 *     updates_persisted: number,
 *     notified: number,        // signals at >= NOTIFY_SIGMA
 *     errors: string[],
 *   }
 */
async function runLiveAnalystPass({
  forceEnabled = false,
  log = console.log,
  db = require("../db"),
  repos = null,
  notify = null,
  env = process.env,
  now = Date.now(),
} = {}) {
  const summary = {
    enabled: false,
    analysed: 0,
    signals_logged: 0,
    updates_persisted: 0,
    notified: 0,
    errors: [],
  };
  const enabled =
    forceEnabled ||
    String(env.LIVE_ANALYST_ENABLED || "").toLowerCase() === "true";
  if (!enabled) return summary;
  summary.enabled = true;

  let stories;
  try {
    stories = await db.getStories();
  } catch (err) {
    summary.errors.push(`getStories: ${err.message}`);
    return summary;
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

  // Build snapshot index per story_id. Falls through silently when the
  // repos aren't available or the table is empty.
  const snapshotIndex = new Map();
  let snapshotRows = [];
  try {
    if (activeRepos && activeRepos.db) {
      snapshotRows = activeRepos.db
        .prepare(
          "SELECT * FROM platform_metric_snapshots WHERE snapshot_at >= datetime(?, 'unixepoch') ORDER BY snapshot_at DESC",
        )
        .all(Math.floor((now - LOOKBACK_HOURS * 60 * 60 * 1000) / 1000));
    }
  } catch (err) {
    // Migration may not have been applied yet — skip gracefully.
    summary.errors.push(`snapshot_query: ${err.message}`);
  }
  for (const row of snapshotRows) {
    if (!row || !row.story_id) continue;
    const arr = snapshotIndex.get(row.story_id) || [];
    arr.push(row);
    snapshotIndex.set(row.story_id, arr);
  }

  const candidates = selectAnalysableStories(stories, snapshotIndex, now);
  if (candidates.length === 0) {
    return summary;
  }

  // Load current model state into a Map keyed by (kind|value|metric).
  const modelState = new Map();
  try {
    if (activeRepos && activeRepos.db) {
      const rows = activeRepos.db
        .prepare("SELECT * FROM live_model_state")
        .all();
      for (const r of rows) {
        modelState.set(`${r.feature_kind}|${r.feature_value}|${r.metric}`, r);
      }
    }
  } catch (err) {
    summary.errors.push(`model_state_load: ${err.message}`);
  }

  const allUpdates = [];
  const allSignals = [];
  for (const story of candidates) {
    const snaps = latestSnapshotsByPlatform(snapshotIndex.get(story.id) || []);
    // Prefer YouTube snapshot for the canonical metric set; fall back
    // to whatever's there.
    const snapshot = snaps.get("youtube") || snaps.values().next().value;
    if (!snapshot) continue;
    summary.analysed++;
    const { updates, signals } = analyseStory({
      story,
      snapshot,
      modelState,
    });
    allUpdates.push(...updates);
    allSignals.push(...signals);
  }

  // Persist updates (UPSERT into live_model_state)
  try {
    if (activeRepos && activeRepos.db && allUpdates.length > 0) {
      const upsert = activeRepos.db.prepare(`
        INSERT INTO live_model_state
          (feature_kind, feature_value, metric, sample_count, running_mean, running_m2, last_updated_at)
        VALUES (@feature_kind, @feature_value, @metric, @sample_count, @running_mean, @running_m2, datetime('now'))
        ON CONFLICT (feature_kind, feature_value, metric) DO UPDATE SET
          sample_count = excluded.sample_count,
          running_mean = excluded.running_mean,
          running_m2 = excluded.running_m2,
          last_updated_at = excluded.last_updated_at
      `);
      const tx = activeRepos.db.transaction((rows) => {
        for (const r of rows) upsert.run(r);
      });
      tx(allUpdates);
      summary.updates_persisted = allUpdates.length;
    }
  } catch (err) {
    summary.errors.push(`persist_updates: ${err.message}`);
  }

  // Persist signals
  try {
    if (activeRepos && activeRepos.db && allSignals.length > 0) {
      const insert = activeRepos.db.prepare(`
        INSERT INTO live_performance_signals
          (story_id, channel_id, signal_kind, severity, metric,
           observed_value, predicted_value, features_json, raw_json)
        VALUES (@story_id, @channel_id, @signal_kind, @severity, @metric,
                @observed_value, @predicted_value, @features_json, @raw_json)
      `);
      const tx = activeRepos.db.transaction((rows) => {
        for (const r of rows) insert.run(r);
      });
      tx(allSignals);
      summary.signals_logged = allSignals.length;
    }
  } catch (err) {
    summary.errors.push(`persist_signals: ${err.message}`);
  }

  // Discord-notify the strongest signals (|z| >= NOTIFY_SIGMA).
  // Cap at 5 per pass so a noisy day doesn't spam.
  const notifySend =
    notify ||
    (async (msg) => {
      try {
        const sendDiscord = require("../../notify");
        await sendDiscord(msg);
      } catch (err) {
        log(`[live-analyst] discord notify failed: ${err.message}`);
      }
    });
  const strong = allSignals
    .filter((s) => Math.abs(s.severity) >= NOTIFY_SIGMA)
    .sort((a, b) => Math.abs(b.severity) - Math.abs(a.severity))
    .slice(0, 5);
  for (const s of strong) {
    const arrow = s.severity >= 0 ? "📈" : "📉";
    const lines = [
      `${arrow} **Live performance signal** — story ${s.story_id}`,
      `${s.signal_kind} on ${s.metric}: observed ${formatMetric(s.metric, s.observed_value)} vs predicted ${formatMetric(s.metric, s.predicted_value)} (${s.severity >= 0 ? "+" : ""}${s.severity.toFixed(1)}σ)`,
    ];
    try {
      await notifySend(lines.join("\n"));
      summary.notified++;
    } catch (err) {
      summary.errors.push(`notify: ${err.message}`);
    }
  }

  return summary;
}

function formatMetric(metric, value) {
  if (metric === "comments_per_view") return (value * 1000).toFixed(2) + "‰";
  if (metric === "avg_view_pct") return (value * 100).toFixed(1) + "%";
  if (metric === "views") return Math.round(value).toString();
  return String(value);
}

module.exports = {
  runLiveAnalystPass,
  analyseStory,
  extractFeatures,
  selectAnalysableStories,
  welfordUpdate,
  variance,
  stdev,
  latestSnapshotsByPlatform,
  formatMetric,
  FEATURE_KINDS,
  OUTLIER_SIGMA,
  NOTIFY_SIGMA,
  MIN_SAMPLES_FOR_CONFIDENCE,
  LOOKBACK_HOURS,
};
