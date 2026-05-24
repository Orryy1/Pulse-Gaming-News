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
const {
  visualEvidenceProfile,
} = require("../visual-evidence-classifier");

const DEFAULT_WINDOW_HOURS = 24;

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

function renderHealthTimestamp(story) {
  if (!story) return "";
  return (
    story.exported_at ||
    story.rendered_at ||
    story.render_fallback_at ||
    story.published_at ||
    story.youtube_published_at ||
    story.created_at ||
    ""
  );
}

function isWithinWindow(story, sinceMs) {
  if (!story) return false;
  // Prefer explicit render/export stamps. Older rows do not carry
  // exported_at, so fall back through publish timestamps before
  // created_at; otherwise a newly published legacy row created weeks
  // ago looks invisible to the daily Discord digest. Do not use
  // updated_at here: analytics and repair passes can update old rows
  // without producing a new render.
  const t = Date.parse(renderHealthTimestamp(story)) || 0;
  return t >= sinceMs;
}

function isStamped(story) {
  return (
    story &&
    typeof story.render_quality_class === "string" &&
    QUALITY_CLASSES.includes(story.render_quality_class)
  );
}

function bridgeHealthTimestamp(candidate) {
  if (!candidate) return "";
  return (
    candidate.scheduler_bridge_generated_at ||
    candidate.bridge_generated_at ||
    candidate.approved_at ||
    candidate.exported_at ||
    candidate.rendered_at ||
    candidate.published_at ||
    candidate.created_at ||
    candidate._bridge_loaded_at ||
    ""
  );
}

function isBridgeCandidateWithinWindow(candidate, sinceMs) {
  if (!candidate) return false;
  const t = Date.parse(bridgeHealthTimestamp(candidate)) || 0;
  return t >= sinceMs;
}

function normaliseVisualCount(candidate) {
  const direct =
    candidate.distinct_visual_count ??
    candidate.qa_visual_count ??
    candidate.visual_count;
  const n = Number(direct);
  if (Number.isFinite(n)) return n;

  if (Array.isArray(candidate.video_clips)) return candidate.video_clips.length;
  if (Array.isArray(candidate.visual_v4_bridge_video_clips)) {
    return candidate.visual_v4_bridge_video_clips.length;
  }
  if (Array.isArray(candidate.downloaded_images)) {
    return candidate.downloaded_images.length;
  }
  return null;
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function candidateRightsLedger(candidate = {}) {
  if (Array.isArray(candidate.rights_ledger)) return candidate.rights_ledger;
  if (Array.isArray(candidate.rights_records)) return candidate.rights_records;
  if (candidate.rights_ledger && typeof candidate.rights_ledger === "object") {
    return candidate.rights_ledger;
  }
  return {};
}

function motionEvidenceAssets(candidate = {}) {
  return [
    ...asArray(candidate.visual_v4_bridge_video_clips),
    ...asArray(candidate.video_clips),
    ...asArray(candidate.motion_clips),
    ...asArray(candidate.footage_inventory?.motion_inventory?.accepted_local_clips),
    ...asArray(candidate.footage_inventory?.motion_inventory?.production_motion_clips),
    ...asArray(candidate.rights_ledger),
    ...asArray(candidate.rights_records),
  ];
}

function hasDirectVideoMotion(candidate = {}) {
  return motionEvidenceAssets(candidate).some((asset) => {
    const text = [
      asset.path,
      asset.local_path,
      asset.file_path,
      asset.media_path,
      asset.source_url,
      asset.url,
      asset.source_type,
      asset.asset_type,
      asset.kind,
      asset.type,
      asset.licence_basis,
      asset.license_basis,
      asset.rights_risk_class,
      asset.transformation_notes,
    ]
      .map(cleanText)
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!text) return false;
    if (/screenshot|visual_still|still|image|jpg|jpeg|png|gif/.test(text)) return false;
    return /\.(?:mp4|mov|webm|mkv)(?:$|[?#])/i.test(text) ||
      /\b(?:direct_video|official_trailer_segment|official_video|gameplay|trailer)\b/i.test(text);
  });
}

function bridgeVisualEvidence(candidate = {}) {
  const profile = visualEvidenceProfile({
    story: candidate,
    rightsLedger: candidateRightsLedger(candidate),
    footageInventory: candidate.footage_inventory || {},
    directorPlan: candidate.visual_v4_director_plan || candidate.director_plan || {},
  });
  return {
    profile,
    has_direct_video_motion: hasDirectVideoMotion(candidate),
  };
}

function buildBridgeSummary(candidates, sinceMs) {
  const input = Array.isArray(candidates) ? candidates : [];
  const inWindow = input.filter((candidate) =>
    isBridgeCandidateWithinWindow(candidate, sinceMs),
  );
  const stamped = inWindow.filter(isStamped);
  const quality = Object.fromEntries(QUALITY_CLASSES.map((k) => [k, 0]));
  quality.other = 0;
  const lane = {};
  const visualCounts = [];
  let thinCount = 0;
  const visualEvidence = {
    real_media_ready_count: 0,
    generated_only_motion_deck_count: 0,
    no_real_visual_media_asset_count: 0,
    direct_video_motion_count: 0,
    screenshot_derived_only_count: 0,
  };

  for (const candidate of stamped) {
    if (QUALITY_CLASSES.includes(candidate.render_quality_class)) {
      quality[candidate.render_quality_class]++;
    } else {
      quality.other++;
    }

    const laneKey =
      typeof candidate.render_lane === "string" && candidate.render_lane.trim()
        ? candidate.render_lane.trim()
        : "unknown";
    lane[laneKey] = (lane[laneKey] || 0) + 1;

    const visualCount = normaliseVisualCount(candidate);
    if (Number.isFinite(visualCount)) {
      visualCounts.push(visualCount);
      if (visualCount < 3) thinCount++;
    }

    const evidence = bridgeVisualEvidence(candidate);
    const profile = evidence.profile || {};
    if (Number(profile.real_media_asset_count) > 0) {
      visualEvidence.real_media_ready_count++;
    }
    if (profile.generated_only_motion_deck === true) {
      visualEvidence.generated_only_motion_deck_count++;
    }
    if (asArray(profile.blockers).includes("visual_evidence:no_real_visual_media_asset")) {
      visualEvidence.no_real_visual_media_asset_count++;
    }
    if (evidence.has_direct_video_motion) {
      visualEvidence.direct_video_motion_count++;
    } else if (Number(profile.real_motion_asset_count) > 0) {
      visualEvidence.screenshot_derived_only_count++;
    }
  }

  const total = stamped.length;
  const pct = (n) => (total > 0 ? Math.round((n / total) * 100) : 0);

  return {
    candidate_count: inWindow.length,
    total_in_window: inWindow.length,
    stamped: total,
    unstamped: inWindow.length - total,
    quality,
    lane,
    visual_count: summariseNumeric(visualCounts),
    thin_count: thinCount,
    visual_evidence: visualEvidence,
    percentages: {
      quality: Object.fromEntries(
        Object.entries(quality).map(([k, v]) => [k, pct(v)]),
      ),
      lane: Object.fromEntries(
        Object.entries(lane).map(([k, v]) => [k, pct(v)]),
      ),
      thin: pct(thinCount),
    },
  };
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
  const bridge = buildBridgeSummary(opts.bridgeCandidates, sinceMs);

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
    bridge,
  };
}

function splitRenderHealthSummary(summary = {}, { generatedAt = new Date().toISOString() } = {}) {
  const { bridge, ...liveDbHealthReport } = summary || {};
  const bridgeHealthReport = {
    ...(bridge || {}),
    candidate_count_meaning: "scheduler_bridge_candidates",
    readiness_note:
      "Counts only governed scheduler bridge candidates supplied to render-health, separate from live DB stamped rows.",
  };
  return {
    render_health_report: summary,
    live_db_health_report: liveDbHealthReport,
    bridge_health_report: bridgeHealthReport,
    discord_digest_payload: {
      generated_at: generatedAt,
      summary: {
        live_db_total_in_window: Number(liveDbHealthReport.total_in_window || 0),
        live_db_stamped: Number(liveDbHealthReport.stamped || 0),
        live_db_unstamped: Number(liveDbHealthReport.unstamped || 0),
        scheduler_bridge_candidate_count: Number(bridgeHealthReport.candidate_count || 0),
        scheduler_bridge_stamped: Number(bridgeHealthReport.stamped || 0),
        scheduler_bridge_direct_video_motion_count: Number(
          bridgeHealthReport.visual_evidence?.direct_video_motion_count || 0,
        ),
      },
    },
  };
}

function appendBridgeDigest(lines, summary) {
  const bridge = summary && summary.bridge;
  if (!bridge || bridge.candidate_count <= 0) return;

  lines.push(
    `Bridge V4 final renders: ${bridge.stamped} stamped (${bridge.candidate_count} candidates).`,
  );
  if (bridge.stamped > 0 && bridge.visual_evidence) {
    const evidence = bridge.visual_evidence;
    lines.push(
      `Bridge visual evidence: real media ${evidence.real_media_ready_count}/${bridge.stamped}; ` +
        `direct-video motion ${evidence.direct_video_motion_count}/${bridge.stamped}; ` +
        `generated-only ${evidence.generated_only_motion_deck_count}; ` +
        `screenshot-derived only ${evidence.screenshot_derived_only_count}.`,
    );
    if (evidence.generated_only_motion_deck_count > 0) {
      lines.push(
        "Bridge warning: generated-only motion decks are not publish-ready even if they are stamped premium.",
      );
    }
    if (evidence.direct_video_motion_count === 0 && evidence.real_media_ready_count > 0) {
      lines.push(
        "Bridge warning: current bridge candidates use still-derived motion only; treat them as safer than cards but below rich gameplay-video standard.",
      );
    } else if (evidence.direct_video_motion_count < Math.ceil(bridge.stamped / 2)) {
      lines.push(
        "Bridge warning: direct-video motion coverage is low; do not treat still-derived V4 as rich gameplay-video standard.",
      );
    }
  }

  if (summary.stamped === 0 && bridge.stamped > 0) {
    lines.push(
      "live DB still has no stamped rows; bridge candidates are scheduler-visible dry-run inputs until operator-confirmed cutover persists them.",
    );
  }
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
    appendBridgeDigest(lines, summary);
    return lines.join("\n");
  }
  lines.push(
    `Stamped renders: ${summary.stamped}` +
      (summary.unstamped > 0
        ? ` (+${summary.unstamped} unstamped legacy)`
        : ""),
  );
  appendBridgeDigest(lines, summary);

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
      `✓ Thin-visual rate is low. BLOCK_THIN_VISUALS=true is approval-ready for a controlled next-window pilot; do not flip it silently because it changes live publish gating.`,
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
  bridgeCandidates = [],
} = {}) {
  let stories = [];
  try {
    stories = await db.getStories();
  } catch {
    stories = [];
  }
  const summary = buildRenderHealthSummary(stories, {
    windowHours,
    now,
    bridgeCandidates,
  });
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
  renderHealthTimestamp,
  bridgeHealthTimestamp,
  isBridgeCandidateWithinWindow,
  normaliseVisualCount,
  buildBridgeSummary,
  splitRenderHealthSummary,
};
