"use strict";

const CLIP_SCENE_TYPES = new Set([
  "opener",
  "clip",
  "punch",
  "speed-ramp",
  "freeze-frame",
]);

const STATIC_SCENE_TYPES = new Set([
  "still",
  "clip.frame",
  "card.source",
  "card.release",
  "card.quote",
  "card.stat",
  "card.takeaway",
  "card.timeline",
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function wordCount(value) {
  const text = cleanText(value);
  return text ? text.split(/\s+/).length : 0;
}

function normaliseFraction(value, { elapsed = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (elapsed) return round(n > 1 ? n / 100 : n, 4);
  if (Math.abs(n) > 5) return round(n / 100, 4);
  return round(n, 4);
}

function normalizeRetentionRows(rows = []) {
  return asArray(rows)
    .map((row) => ({
      video_id: row.video_id || row.videoId || null,
      elapsed_video_time_ratio: normaliseFraction(
        row.elapsed_video_time_ratio ?? row.elapsedVideoTimeRatio,
        { elapsed: true },
      ),
      audience_watch_ratio: normaliseFraction(
        row.audience_watch_ratio ?? row.audienceWatchRatio,
      ),
      relative_retention_performance: normaliseFraction(
        row.relative_retention_performance ?? row.relativeRetentionPerformance,
      ),
    }))
    .filter(
      (row) =>
        row.elapsed_video_time_ratio !== null &&
        row.audience_watch_ratio !== null,
    )
    .sort((a, b) => a.elapsed_video_time_ratio - b.elapsed_video_time_ratio);
}

function normalizeTrafficRows(rows = []) {
  return asArray(rows).map((row) => ({
    traffic_source_type: String(
      row.traffic_source_type || row.trafficSourceType || "UNKNOWN",
    ).toUpperCase(),
    views: Number.isFinite(Number(row.views)) ? Number(row.views) : null,
    average_view_duration_seconds: Number.isFinite(
      Number(row.average_view_duration_seconds ?? row.averageViewDuration),
    )
      ? Number(row.average_view_duration_seconds ?? row.averageViewDuration)
      : null,
    average_percentage_viewed: normaliseFraction(
      row.average_percentage_viewed ?? row.averagePercentageViewed,
    ),
  }));
}

function normalizeChannelBaseline(baseline = {}) {
  const stayed = Number(baseline.stayed_to_watch ?? baseline.stayedToWatch);
  const swiped = Number(baseline.swiped_away ?? baseline.swipedAway);
  const avgWatch = Number(
    baseline.avg_watch_seconds_estimate ??
      baseline.average_watch_seconds ??
      baseline.averageWatchSeconds,
  );
  const mobileShare = Number(baseline.mobile_share ?? baseline.mobileShare);
  const subscriberConversion = Number(
    baseline.subscriber_conversion_estimate ??
      baseline.subscriber_conversion ??
      baseline.subscriberConversion,
  );
  const topCeiling = Number(
    baseline.top_short_ceiling_current ??
      baseline.top_short_ceiling ??
      baseline.topShortCeiling,
  );

  return {
    views_28d: Number.isFinite(Number(baseline.views_28d)) ? Number(baseline.views_28d) : null,
    watch_hours_28d: Number.isFinite(Number(baseline.watch_hours_28d))
      ? Number(baseline.watch_hours_28d)
      : null,
    avg_watch_seconds_estimate: Number.isFinite(avgWatch) ? avgWatch : null,
    stayed_to_watch: Number.isFinite(stayed) ? stayed : null,
    swiped_away: Number.isFinite(swiped) ? swiped : null,
    subscriber_conversion_estimate: Number.isFinite(subscriberConversion)
      ? subscriberConversion
      : null,
    top_short_ceiling_current: Number.isFinite(topCeiling) ? topCeiling : null,
    mobile_share: Number.isFinite(mobileShare) ? mobileShare : null,
    audience_core: cleanText(baseline.audience_core || baseline.audienceCore),
  };
}

function isGenericPublicTitle(value) {
  return /^(?:this gaming story|gaming news update|new gaming update|this story)$/i.test(
    cleanText(value).replace(/[.!?]+$/g, ""),
  );
}

function firstFrameText(story = {}, sceneTimeline = {}) {
  const scenes = normalizeSceneTimeline(sceneTimeline);
  const opening = scenes.find((scene) => scene.startS <= 0.35) || scenes[0] || {};
  return cleanText(
    opening.text ||
      opening.labelText ||
      opening.label_text ||
      opening.headline ||
      story.first_frame_text ||
      story.thumbnail_text ||
      story.suggested_thumbnail_text,
  );
}

function targetDurationForBaseline(baseline = {}) {
  const avgWatch = baseline.avg_watch_seconds_estimate;
  const stayed = baseline.stayed_to_watch;
  if ((avgWatch !== null && avgWatch < 15) || (stayed !== null && stayed < 45)) {
    return {
      min: 25,
      max: 40,
      reason: "avg_watch_seconds_below_15_and_stayed_to_watch_below_45",
    };
  }
  if ((avgWatch !== null && avgWatch < 20) || (stayed !== null && stayed < 50)) {
    return {
      min: 35,
      max: 45,
      reason: "retention_below_next_target",
    };
  }
  return {
    min: 45,
    max: 60,
    reason: "retention_ready_for_standard_short",
  };
}

function buildChannelPressure({ story = {}, channelBaseline = {}, sceneTimeline = {} } = {}) {
  const baseline = normalizeChannelBaseline(channelBaseline);
  const hasBaseline =
    baseline.stayed_to_watch !== null ||
    baseline.swiped_away !== null ||
    baseline.avg_watch_seconds_estimate !== null ||
    baseline.mobile_share !== null;
  if (!hasBaseline) {
    return {
      status: "missing_channel_baseline",
      baseline,
      targets: {},
      target_duration_s: targetDurationForBaseline(baseline),
      recommendations: [],
    };
  }

  const recommendations = [];
  const targets = {
    stayed_to_watch_short_term: 45,
    stayed_to_watch_next: 50,
    swiped_away_short_term_max: 55,
    swiped_away_next_max: 50,
    average_watch_seconds_min: 15,
    top_short_breakout_target: 2500,
    subscriber_conversion_min: 0.1,
    first_frame_text_words_max: 5,
  };
  const title = cleanText(story.suggested_title || story.public_title || story.title);
  const openingText = firstFrameText(story, sceneTimeline);
  const openingWords = wordCount(openingText);
  const targetDuration = targetDurationForBaseline(baseline);

  if (baseline.stayed_to_watch !== null && baseline.stayed_to_watch < targets.stayed_to_watch_short_term) {
    recommendations.push({
      id: "shorten_default_runtime_until_retention_recovers",
      severity: "high",
      action: "Use 25-40 second cuts until stayed-to-watch clears 45%.",
      evidence: `stayed_to_watch=${baseline.stayed_to_watch}`,
    });
  }
  if (baseline.swiped_away !== null && baseline.swiped_away > targets.swiped_away_short_term_max) {
    recommendations.push({
      id: "attack_first_three_seconds",
      severity: "high",
      action: "Open with motion, named subject, consequence and proof before the three-second mark.",
      evidence: `swiped_away=${baseline.swiped_away}`,
    });
  }
  if (isGenericPublicTitle(title)) {
    recommendations.push({
      id: "named_entity_title_consequence_tension",
      severity: "high",
      action: "Replace generic titles with named entity plus consequence plus tension.",
      evidence: `title=${title || "missing"}`,
    });
  }
  if (openingWords > targets.first_frame_text_words_max || openingWords === 0) {
    recommendations.push({
      id: "first_frame_text_under_5_words",
      severity: "high",
      action: "Keep first-frame text to 3-5 large words on one clear subject.",
      evidence: `first_frame_words=${openingWords}`,
    });
  }
  if (baseline.mobile_share !== null && baseline.mobile_share >= 70) {
    recommendations.push({
      id: "mobile_readability_first",
      severity: "medium",
      action: "Design cover text, captions and data cards for phone viewing before desktop.",
      evidence: `mobile_share=${baseline.mobile_share}`,
    });
  }

  return {
    status: recommendations.length
      ? "retention_baseline_under_target"
      : "channel_baseline_on_target",
    baseline,
    targets,
    target_duration_s: targetDuration,
    first_frame: {
      text: openingText,
      word_count: openingWords,
      max_words: targets.first_frame_text_words_max,
    },
    recommendations,
  };
}

function retentionNear(rows, targetRatio) {
  const safeRows = normalizeRetentionRows(rows);
  if (!safeRows.length) return null;
  let winner = safeRows[0];
  let bestDistance = Math.abs(winner.elapsed_video_time_ratio - targetRatio);
  for (const row of safeRows.slice(1)) {
    const distance = Math.abs(row.elapsed_video_time_ratio - targetRatio);
    if (distance < bestDistance) {
      winner = row;
      bestDistance = distance;
    }
  }
  return winner;
}

function scoreHookRetention(rows, durationS = 60) {
  const retentionRows = normalizeRetentionRows(rows);
  if (!retentionRows.length) {
    return {
      score: 0,
      status: "missing_retention_data",
      first_3s_watch_ratio: null,
      first_6s_watch_ratio: null,
      drop_first_6s: null,
    };
  }

  const duration = Math.max(1, Number(durationS) || 60);
  const initial = retentionRows[0].audience_watch_ratio;
  const first3 = retentionNear(retentionRows, clamp(3 / duration, 0.03, 0.08));
  const first6 = retentionNear(retentionRows, clamp(6 / duration, 0.06, 0.14));
  const first3Ratio = first3?.audience_watch_ratio ?? initial;
  const first6Ratio = first6?.audience_watch_ratio ?? first3Ratio;
  const score = clamp(Math.round(first6Ratio * 100), 0, 100);

  return {
    score,
    status:
      score >= 82
        ? "strong_hook"
        : score >= 75
          ? "acceptable_hook"
          : "needs_hook_rework",
    first_3s_watch_ratio: round(first3Ratio, 4),
    first_6s_watch_ratio: round(first6Ratio, 4),
    drop_first_6s: round(Math.max(0, initial - first6Ratio), 4),
    evidence: {
      initial_watch_ratio: round(initial, 4),
      first_3s_elapsed_ratio: first3?.elapsed_video_time_ratio ?? null,
      first_6s_elapsed_ratio: first6?.elapsed_video_time_ratio ?? null,
    },
  };
}

function normalizeSceneTimeline(sceneTimeline = {}) {
  const rawScenes = Array.isArray(sceneTimeline)
    ? sceneTimeline
    : asArray(sceneTimeline.scenes || sceneTimeline.timeline);
  let cursor = 0;
  return rawScenes.map((scene, index) => {
    const start =
      scene.startS ??
      scene.start_s ??
      scene.start ??
      scene.offsetS ??
      scene.offset_s ??
      cursor;
    const duration =
      scene.durationS ??
      scene.duration_s ??
      scene.duration ??
      (scene.endS || scene.end_s || scene.end
        ? Number(scene.endS ?? scene.end_s ?? scene.end) - Number(start)
        : 0);
    const safeStart = Number.isFinite(Number(start)) ? Number(start) : cursor;
    const safeDuration = Math.max(0, Number(duration) || 0);
    const out = {
      index,
      type: scene.type || scene.kind || "unknown",
      label: scene.label || scene.id || null,
      source: scene.source || scene.path || null,
      mediaStartS:
        scene.mediaStartS ?? scene.media_start_s ?? scene.media_start ?? null,
      startS: round(safeStart, 3),
      durationS: round(safeDuration, 3),
      endS: round(safeStart + safeDuration, 3),
    };
    cursor = safeStart + safeDuration;
    return out;
  });
}

function clipWindowKey(scene) {
  if (!scene?.source || !CLIP_SCENE_TYPES.has(scene.type)) return null;
  const start = Number(scene.mediaStartS);
  const window = Number.isFinite(start) ? start.toFixed(2) : "";
  return `${scene.source}|${window}`;
}

function repeatedClipWindows(scenes = []) {
  const counts = new Map();
  for (const scene of normalizeSceneTimeline(scenes)) {
    const key = clipWindowKey(scene);
    if (!key) continue;
    if (!counts.has(key)) counts.set(key, { key, count: 0, scenes: [] });
    const item = counts.get(key);
    item.count += 1;
    item.scenes.push({
      index: scene.index,
      label: scene.label,
      startS: scene.startS,
      type: scene.type,
    });
  }
  return [...counts.values()].filter((item) => item.count > 1);
}

function retentionDrops(rows = [], durationS = 60) {
  const retentionRows = normalizeRetentionRows(rows);
  const duration = Math.max(1, Number(durationS) || 60);
  const drops = [];
  for (let i = 1; i < retentionRows.length; i++) {
    const prev = retentionRows[i - 1];
    const current = retentionRows[i];
    const drop = prev.audience_watch_ratio - current.audience_watch_ratio;
    if (drop <= 0) continue;
    drops.push({
      at_ratio: current.elapsed_video_time_ratio,
      atS: round(current.elapsed_video_time_ratio * duration, 3),
      drop: round(drop, 4),
      from: round(prev.audience_watch_ratio, 4),
      to: round(current.audience_watch_ratio, 4),
    });
  }
  return drops.sort((a, b) => b.drop - a.drop);
}

function sceneAtTime(scenes, atS) {
  return normalizeSceneTimeline(scenes).find(
    (scene) => atS >= scene.startS && atS < scene.endS,
  );
}

function scoreVisualPacing({ retentionRows = [], sceneTimeline = {}, durationS = 60 } = {}) {
  const scenes = normalizeSceneTimeline(sceneTimeline);
  const drops = retentionDrops(retentionRows, durationS);
  const largestDrop = drops[0] || null;
  const repeated = repeatedClipWindows(scenes);
  const longStaticScenes = scenes.filter(
    (scene) => STATIC_SCENE_TYPES.has(scene.type) && Number(scene.durationS) > 5.2,
  );
  const repeatedPenalty = repeated.reduce(
    (sum, item) => sum + Math.max(0, item.count - 1) * 14,
    0,
  );
  const dropPenalty = largestDrop ? Math.round(largestDrop.drop * 130) : 0;
  const staticPenalty = Math.min(16, longStaticScenes.length * 4);
  const score = clamp(100 - repeatedPenalty - dropPenalty - staticPenalty, 0, 100);

  return {
    score,
    status:
      score >= 84
        ? "strong_pacing"
        : score >= 75
          ? "watch_pacing"
          : "needs_visual_pacing_rework",
    largest_drop: largestDrop
      ? {
          ...largestDrop,
          scene: sceneAtTime(scenes, largestDrop.atS) || null,
        }
      : null,
    repeated_clip_windows: repeated,
    long_static_scenes: longStaticScenes,
  };
}

function storyHasSteamMetric(story = {}) {
  const text = [
    story.title,
    story.hook,
    story.body,
    story.full_script,
    story.tts_script,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\bsteam\b/.test(text) && /\b(?:\d{1,3}(?:,\d{3})+|\d+\s*k|players?|ccu|peak)\b/i.test(text);
}

function summariseTraffic(rows = []) {
  const trafficRows = normalizeTrafficRows(rows);
  const totalViews = trafficRows.reduce((sum, row) => sum + (row.views || 0), 0);
  const shorts = trafficRows.find((row) => /SHORTS|YT_SHORTS/.test(row.traffic_source_type));
  const weightedPercentage = trafficRows.reduce((sum, row) => {
    const weight = row.views || 1;
    return sum + (row.average_percentage_viewed || 0) * weight;
  }, 0);
  const weightTotal = trafficRows.reduce((sum, row) => sum + (row.views || 1), 0);
  return {
    total_views: totalViews || null,
    dominant_source: shorts ? shorts.traffic_source_type : trafficRows[0]?.traffic_source_type || null,
    shorts_average_percentage_viewed: shorts?.average_percentage_viewed ?? null,
    weighted_average_percentage_viewed: weightTotal
      ? round(weightedPercentage / weightTotal, 4)
      : null,
  };
}

function buildRecommendations({ story = {}, hook, visualPacing, traffic }) {
  const recommendations = [];
  if (hook.score < 75) {
    recommendations.push({
      id: "tighten_first_three_seconds",
      severity: "high",
      action:
        "Rewrite the hook so the named game, concrete number and consequence all land in the first three seconds.",
      evidence: `first_6s_watch_ratio=${hook.first_6s_watch_ratio}`,
    });
  }
  if (visualPacing.repeated_clip_windows.length) {
    recommendations.push({
      id: "replace_repeated_clip_windows",
      severity: "high",
      action:
        "Use each official clip path plus mediaStartS window once before falling back to frames, charts or authored cards.",
      evidence: `${visualPacing.repeated_clip_windows.length} repeated clip window(s) found`,
    });
  }
  if (visualPacing.largest_drop && visualPacing.largest_drop.drop >= 0.12) {
    recommendations.push({
      id: "insert_pattern_interrupt_before_drop",
      severity: "medium",
      action:
        "Add a short pattern interrupt 0.8 to 1.2 seconds before the largest retention dip.",
      evidence: `drop=${visualPacing.largest_drop.drop} at ${visualPacing.largest_drop.atS}s`,
    });
  }
  if (storyHasSteamMetric(story) && hook.score < 82) {
    recommendations.push({
      id: "move_metric_overlay_earlier",
      severity: "medium",
      action:
        "Pull the Steam chart or number into the opening four seconds instead of waiting for the middle.",
      evidence: "steam_metric_story_with_soft_hook_retention",
    });
  }
  if (
    traffic.shorts_average_percentage_viewed !== null &&
    traffic.shorts_average_percentage_viewed < 0.7
  ) {
    recommendations.push({
      id: "shorts_feed_pacing_rework",
      severity: "medium",
      action:
        "Treat the next render as a Shorts-feed save: faster first cut, fewer static beats and bigger number-led overlays.",
      evidence: `shorts_average_percentage_viewed=${traffic.shorts_average_percentage_viewed}`,
    });
  }
  return recommendations;
}

function buildVisualV3Adjustments({
  story = {},
  durationS = 60,
  hook,
  visualPacing,
  recommendations,
  channelPressure = {},
}) {
  const duration = Math.max(1, Number(durationS) || 60);
  const promptDirectives = [
    "Avoid repeating official clip windows; use each source plus mediaStartS once before stills, charts or authored cards.",
  ];
  const timelineEvents = [];

  if (hook.score < 75) {
    promptDirectives.push(
      "Put the named game, concrete number and consequence inside the first three seconds.",
    );
    timelineEvents.push({
      id: "retention_pattern_interrupt_3s",
      kind: "retention_pattern_interrupt",
      label: storyHasSteamMetric(story) ? "THE NUMBER IS THE STORY" : "WHY THIS MATTERS",
      detail: "Retention save beat before the first dip",
      atS: round(clamp(2.2, 0.6, Math.max(0.6, duration - 2)), 3),
      durationS: 1.8,
      priority: 96,
    });
  }

  if (visualPacing.largest_drop && visualPacing.largest_drop.drop >= 0.12) {
    const atS = clamp(visualPacing.largest_drop.atS - 1.0, 2.0, Math.max(2, duration - 2));
    timelineEvents.push({
      id: "retention_pattern_interrupt_largest_drop",
      kind: "retention_pattern_interrupt",
      label: "NEW ANGLE",
      detail: "Cut before the visible audience dip",
      atS: round(atS, 3),
      durationS: 1.6,
      priority: 84,
    });
  }

  if (storyHasSteamMetric(story)) {
    promptDirectives.push(
      "Move the Steam chart or player-number visual into the first four seconds and keep it numeric, e.g. 130,000.",
    );
  }

  if (recommendations.some((item) => item.id === "shorts_feed_pacing_rework")) {
    promptDirectives.push(
      "Use quicker visual changes in the first 12 seconds: clip, chart, source lock, game art and a caveat beat.",
    );
  }

  if (channelPressure.status === "retention_baseline_under_target") {
    const durationTarget = channelPressure.target_duration_s || {};
    if (durationTarget.max <= 40) {
      promptDirectives.push(
        "Default the next render to 25-40 seconds until stayed-to-watch clears 45%.",
      );
    }
    if (
      asArray(channelPressure.recommendations).some(
        (item) => item.id === "first_frame_text_under_5_words",
      )
    ) {
      promptDirectives.push(
        "First frame must use 3-5 large words, one recognisable subject and no paragraph text.",
      );
    }
    if (
      asArray(channelPressure.recommendations).some(
        (item) => item.id === "named_entity_title_consequence_tension",
      )
    ) {
      promptDirectives.push(
        "Title must use named entity plus consequence plus tension; never use generic fallback wording.",
      );
    }
  }

  return {
    max_clip_window_repeats: 1,
    prompt_directives: [...new Set(promptDirectives)],
    timeline_events: timelineEvents,
  };
}

function buildRetentionIntelligence({
  story = {},
  videoId,
  durationS = 60,
  retentionRows = [],
  trafficRows = [],
  sceneTimeline = {},
  channelBaseline = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const normalizedRetention = normalizeRetentionRows(retentionRows);
  const normalizedTraffic = normalizeTrafficRows(trafficRows);
  const hook = scoreHookRetention(normalizedRetention, durationS);
  const visualPacing = scoreVisualPacing({
    retentionRows: normalizedRetention,
    sceneTimeline,
    durationS,
  });
  const traffic = summariseTraffic(normalizedTraffic);
  const channelPressure = buildChannelPressure({
    story,
    channelBaseline,
    sceneTimeline,
  });
  const recommendations = buildRecommendations({
    story,
    hook,
    visualPacing,
    traffic,
  });
  const visualV3Adjustments = buildVisualV3Adjustments({
    story,
    durationS,
    hook,
    visualPacing,
    recommendations,
    channelPressure,
  });
  const verdict =
    channelPressure.status === "retention_baseline_under_target"
      ? "needs_render_adjustment"
      : !normalizedRetention.length
      ? "needs_retention_data"
      : recommendations.length
        ? "needs_render_adjustment"
        : "retention_ready";

  return {
    schema_version: 1,
    generated_at: generatedAt,
    story_id: story.id || null,
    video_id: videoId || story.youtube_post_id || story.video_id || null,
    verdict,
    durationS: round(durationS, 3),
    hook,
    visual_pacing: visualPacing,
    traffic,
    channel_pressure: channelPressure,
    recommendations,
    visual_v3_adjustments: visualV3Adjustments,
    safety: {
      oauth_triggered: false,
      network_called: false,
      token_values_printed: false,
      production_db_mutated: false,
      social_posting_triggered: false,
    },
  };
}

function renderRetentionIntelligenceMarkdown(intelligence = {}) {
  const lines = [];
  lines.push("# Retention Intelligence");
  lines.push("");
  lines.push(`Generated: ${intelligence.generated_at || ""}`);
  lines.push(`Verdict: ${intelligence.verdict || "unknown"}`);
  lines.push(`Story: ${intelligence.story_id || "unknown"}`);
  lines.push(`Video: ${intelligence.video_id || "unknown"}`);
  lines.push("");
  lines.push("## Scores");
  lines.push(`- Hook score: ${intelligence.hook?.score ?? "n/a"}`);
  lines.push(`- Hook status: ${intelligence.hook?.status || "n/a"}`);
  lines.push(`- Visual pacing score: ${intelligence.visual_pacing?.score ?? "n/a"}`);
  lines.push(`- Visual pacing status: ${intelligence.visual_pacing?.status || "n/a"}`);
  lines.push(`- Channel pressure: ${intelligence.channel_pressure?.status || "n/a"}`);
  lines.push("");
  lines.push("## Recommendations");
  if (!asArray(intelligence.recommendations).length) lines.push("- none");
  for (const item of asArray(intelligence.recommendations)) {
    lines.push(`- ${item.id}: ${item.action}`);
  }
  for (const item of asArray(intelligence.channel_pressure?.recommendations)) {
    lines.push(`- ${item.id}: ${item.action}`);
  }
  lines.push("");
  lines.push("## Visual V3 adjustments");
  const adjustments = intelligence.visual_v3_adjustments || {};
  lines.push(`- Max clip window repeats: ${adjustments.max_clip_window_repeats ?? 1}`);
  for (const directive of asArray(adjustments.prompt_directives)) {
    lines.push(`- ${directive}`);
  }
  for (const event of asArray(adjustments.timeline_events)) {
    lines.push(`- Event ${event.id}: ${event.kind} at ${event.atS}s`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("- No OAuth was triggered.");
  lines.push("- No network call was made by this module.");
  lines.push("- No token values were printed.");
  lines.push("- No production DB rows were mutated.");
  lines.push("- No social posting was triggered.");
  return `${lines.join("\n")}\n`;
}

module.exports = {
  buildRetentionIntelligence,
  normalizeRetentionRows,
  normalizeTrafficRows,
  renderRetentionIntelligenceMarkdown,
  repeatedClipWindows,
  scoreHookRetention,
  scoreVisualPacing,
  _private: {
    buildChannelPressure,
    normalizeChannelBaseline,
  },
};
