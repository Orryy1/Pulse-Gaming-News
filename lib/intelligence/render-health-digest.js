"use strict";

/**
 * lib/intelligence/render-health-digest.js
 *
 * Builds a per-day summary of render-quality metadata stamped by
 * assemble.js. The metadata fields the digest reads are:
 *
 *   story.render_lane                 // legacy_multi_image | legacy_single_image_fallback
 *   story.distinct_visual_count       // number — count of real images used
 *   story.render_quality_class        // premium | standard | fallback | reject
 *   story.outro_present               // boolean — was OUTRO_CARD attached?
 *   story.thumbnail_candidate_present // boolean
 *
 * Output:
 *   - JSON object with per-bucket counts
 *   - Markdown digest suitable for posting to Discord
 *
 * Why: the visual-count gate (content-qa.js) is currently warn-only by
 * operator choice. Before flipping BLOCK_THIN_VISUALS=true the operator
 * needs a daily picture of what fraction of recent renders would be
 * blocked. This digest turns the per-story stamps into that picture.
 *
 * Pure: takes stories in, returns a result. No DB writes, no Discord
 * posts. The handler in lib/job-handlers.js posts the markdown line.
 *
 * Stamp-less (pre-2026-04-29) stories are deliberately excluded from
 * percentages — they don't reflect current rendering and would dilute
 * the signal. Counted separately as `unstamped`.
 */

const QUALITY_CLASSES = ["premium", "standard", "fallback", "reject"];
const RENDER_LANES = ["legacy_multi_image", "legacy_single_image_fallback"];

const DEFAULT_WINDOW_HOURS = 24;

function isWithinWindow(story, sinceMs) {
  if (!story) return false;
  // Use exported_at if present, otherwise fall back to created_at.
  // We want stories that finished rendering inside the window, which
  // is closer to exported_at; not every row carries it though.
  const t = Date.parse(story.exported_at || story.created_at || "") || 0;
  return t >= sinceMs;
}

function isStamped(story) {
  return (
    story &&
    typeof story.render_quality_class === "string" &&
    QUALITY_CLASSES.includes(story.render_quality_class)
  );
}

/**
 * Compute the render-health summary over the supplied story rows. The
 * digest looks at stories whose exported_at / created_at falls within
 * the last `windowHours` (default 24h). Only stories with a stamped
 * `render_quality_class` are counted in percentages — old (unstamped)
 * rows are reported separately.
 *
 * Returns:
 *   {
 *     window_hours,
 *     total_in_window,
 *     stamped,
 *     unstamped,
 *     quality: { premium, standard, fallback, reject },
 *     lane:    { legacy_multi_image, legacy_single_image_fallback, other },
 *     outro:   { present, missing, unknown },
 *     thumbnail: { present, missing },
 *     visual_count: { min, max, median, mean }, // among stamped
 *     thin_count: number,    // distinct_visual_count < 3
 *     percentages: { quality, lane, outro, thumbnail, thin }
 *   }
 */
function buildRenderHealthSummary(stories, opts = {}) {
  const windowHours = Number(opts.windowHours) || DEFAULT_WINDOW_HOURS;
  const now = opts.now ? Date.parse(opts.now) || Date.now() : Date.now();
  const sinceMs = now - windowHours * 60 * 60 * 1000;

  const inWindow = (Array.isArray(stories) ? stories : []).filter((s) =>
    isWithinWindow(s, sinceMs),
  );
  const stamped = inWindow.filter(isStamped);
  const unstamped = inWindow.length - stamped.length;

  const quality = Object.fromEntries(QUALITY_CLASSES.map((k) => [k, 0]));
  const lane = Object.fromEntries(RENDER_LANES.map((k) => [k, 0]));
  lane.other = 0;
  const outro = { present: 0, missing: 0, unknown: 0 };
  const thumbnail = { present: 0, missing: 0 };
  const visualCounts = [];
  let thinCount = 0;

  for (const s of stamped) {
    quality[s.render_quality_class]++;
    if (RENDER_LANES.includes(s.render_lane)) {
      lane[s.render_lane]++;
    } else {
      lane.other++;
    }
    if (s.outro_present === true) outro.present++;
    else if (s.outro_present === false) outro.missing++;
    else outro.unknown++;
    if (s.thumbnail_candidate_present === true) thumbnail.present++;
    else thumbnail.missing++;

    if (Number.isFinite(s.distinct_visual_count)) {
      visualCounts.push(s.distinct_visual_count);
      if (s.distinct_visual_count < 3) thinCount++;
    }
  }

  const total = stamped.length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const percentages = {
    quality: Object.fromEntries(
      Object.entries(quality).map(([k, v]) => [k, pct(v)]),
    ),
    lane: Object.fromEntries(Object.entries(lane).map(([k, v]) => [k, pct(v)])),
    outro: {
      present: pct(outro.present),
      missing: pct(outro.missing),
      unknown: pct(outro.unknown),
    },
    thumbnail: {
      present: pct(thumbnail.present),
      missing: pct(thumbnail.missing),
    },
    thin: pct(thinCount),
  };

  function summariseNumeric(arr) {
    if (arr.length === 0) {
      return { min: null, max: null, median: null, mean: null };
    }
    const sorted = arr.slice().sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const mid = Math.floor(sorted.length / 2);
    const median =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    return {
      min,
      max,
      median,
      mean: Math.round(mean * 10) / 10,
    };
  }

  return {
    window_hours: windowHours,
    total_in_window: inWindow.length,
    stamped: total,
    unstamped,
    quality,
    lane,
    outro,
    thumbnail,
    visual_count: summariseNumeric(visualCounts),
    thin_count: thinCount,
    percentages,
  };
}

/**
 * Render the summary as a Discord-friendly markdown block.
 */
function formatDigest(summary) {
  if (!summary) return "";
  const lines = [];
  lines.push(`**Render health (last ${summary.window_hours}h)**`);
  if (summary.stamped === 0) {
    lines.push(
      `No stamped stories in window (${summary.total_in_window} total, ${summary.unstamped} unstamped pre-2026-04-29 rows).`,
    );
    return lines.join("\n");
  }
  lines.push(
    `Stamped renders: ${summary.stamped}` +
      (summary.unstamped > 0
        ? ` (+${summary.unstamped} unstamped legacy)`
        : ""),
  );

  // Quality class
  const q = summary.quality;
  const qp = summary.percentages.quality;
  lines.push("Quality class:");
  for (const k of QUALITY_CLASSES) {
    if (q[k] === 0 && k !== "premium") continue;
    lines.push(`  • ${k}: ${q[k]} (${qp[k]}%)`);
  }

  // Lane
  const l = summary.lane;
  const lp = summary.percentages.lane;
  lines.push("Render lane:");
  for (const k of RENDER_LANES) {
    if (l[k] === 0) continue;
    lines.push(`  • ${k}: ${l[k]} (${lp[k]}%)`);
  }
  if (l.other > 0) lines.push(`  • other: ${l.other} (${lp.other}%)`);

  // Outro
  const o = summary.outro;
  const op = summary.percentages.outro;
  lines.push(
    `Outro present: ${o.present}/${summary.stamped} (${op.present}%)` +
      (o.missing > 0 ? ` — ⚠ ${o.missing} missing` : "") +
      (o.unknown > 0 ? `, ${o.unknown} unknown` : ""),
  );

  // Thin count headline — drives the BLOCK_THIN_VISUALS decision
  lines.push(
    `Thin (visuals <3): ${summary.thin_count}/${summary.stamped} (${summary.percentages.thin}%)`,
  );

  // Visual count distribution
  const v = summary.visual_count;
  if (v.median !== null) {
    lines.push(
      `Visual count: median ${v.median}, mean ${v.mean}, range ${v.min}–${v.max}`,
    );
  }

  // Operator hint
  if (summary.percentages.thin >= 50) {
    lines.push(
      `⚠ Over half of stamped renders are thin. Hold off on BLOCK_THIN_VISUALS=true until upstream image enrichment lands more wins.`,
    );
  } else if (summary.percentages.thin <= 10 && summary.stamped >= 10) {
    lines.push(
      `✓ Thin-visual rate is low. Safe to flip BLOCK_THIN_VISUALS=true for the next publish window.`,
    );
  }

  return lines.join("\n");
}

/**
 * Run the digest end-to-end. Reads stories via the supplied db handle
 * (defaults to the canonical lib/db) and returns both summary + the
 * formatted markdown.
 */
async function runRenderHealthDigest({
  db = require("../db"),
  windowHours = DEFAULT_WINDOW_HOURS,
  now,
} = {}) {
  let stories = [];
  try {
    stories = await db.getStories();
  } catch {
    stories = [];
  }
  const summary = buildRenderHealthSummary(stories, { windowHours, now });
  return { summary, markdown: formatDigest(summary) };
}

module.exports = {
  buildRenderHealthSummary,
  formatDigest,
  runRenderHealthDigest,
  isWithinWindow,
  isStamped,
  QUALITY_CLASSES,
  RENDER_LANES,
  DEFAULT_WINDOW_HOURS,
};
