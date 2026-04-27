"use strict";

function asNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeRatio(numerator, denominator) {
  const n = asNumber(numerator, 0);
  const d = asNumber(denominator, 0);
  if (d <= 0) return 0;
  return Number((n / d).toFixed(3));
}

function titlePattern(title = "") {
  const t = String(title || "").trim();
  if (!t) return "unknown";
  if (/\?/.test(t)) return "question";
  if (/\bis real\b/i.test(t)) return "is-real-reveal";
  if (/confirmed|official|revealed/i.test(t)) return "confirmed-reveal";
  if (/leak|rumou?r|reportedly/i.test(t)) return "rumour-report";
  if (/\d{4}/.test(t)) return "year-led";
  return "statement";
}

function hookType(text = "") {
  const hook = String(text || "").trim();
  if (!hook) return "unknown";
  if (/\?/.test(hook)) return "question";
  if (/\bis real\b/i.test(hook)) return "hard-reveal";
  if (/confirmed|official|revealed/i.test(hook)) return "confirmation";
  if (/reportedly|sources suggest|rumou?r/i.test(hook)) return "qualified-rumour";
  if (/grim|strange|unusual|wild|messy/i.test(hook)) return "tone-turn";
  return "direct-statement";
}

function inferTopic({ story = {}, report = {} } = {}) {
  const title = story.title || report?.seo?.title || report?.editorial?.chosenHook || "";
  const match = String(title).match(/\b(Metro|Nintendo|Xbox|PlayStation|Steam|Bloodlines|Switch|GTA|Sonic|Halo|Fallout)\b/i);
  return match ? match[1] : "unknown";
}

function sourceMixFromReport(report = {}) {
  const auto = report.auto || {};
  const sceneList = Array.isArray(report.sceneList) ? report.sceneList : [];
  const counts = sceneList.reduce(
    (acc, scene) => {
      const type = scene?.type || "unknown";
      if (type.startsWith("card.")) acc.cards += 1;
      else if (type === "clip.frame" || type === "freeze-frame") acc.stills += 1;
      else if (type === "opener" || type === "punch" || type === "clip") acc.clips += 1;
      else acc.other += 1;
      acc.total += 1;
      return acc;
    },
    { clips: 0, stills: 0, cards: 0, other: 0, total: 0 },
  );

  const total = counts.total || auto?.sourceDiversity?.totalScenes || 0;
  return {
    clip_count: counts.clips || auto?.clipDominance?.clipScenes || 0,
    still_count: counts.stills,
    card_count: counts.cards,
    other_count: counts.other,
    scene_count: total,
    clip_ratio: safeRatio(counts.clips || auto?.clipDominance?.clipScenes, total),
    still_ratio: safeRatio(counts.stills, total),
    card_ratio: safeRatio(counts.cards, total),
  };
}

function extractVideoFeatures({ story = {}, report = {}, analytics = {} } = {}) {
  const mix = sourceMixFromReport(report);
  const title = analytics.title || report?.seo?.title || story.title || "";
  const chosenHook = report?.editorial?.chosenHook || story.hook || title;

  return {
    video_id: analytics.video_id || story.youtube_post_id || report.storyId || story.id || "local-fixture",
    story_id: story.id || report.storyId || null,
    channel_id: story.channel_id || analytics.channel_id || "pulse-gaming",
    title,
    publish_time: analytics.publish_time || story.published_at || story.timestamp || null,
    topic: inferTopic({ story, report }),
    franchise: inferTopic({ story, report }),
    story_type: story.content_pillar || story.flair || "unknown",
    hook_type: hookType(chosenHook),
    title_pattern: titlePattern(title),
    runtime_seconds: asNumber(report?.runtime?.durationS || analytics.runtime_seconds, null),
    render_version: analytics.render_version || (report.heroMoments?.enabled ? "studio-v21" : "studio-v2"),
    source_mix: mix,
    clip_ratio: mix.clip_ratio,
    still_ratio: mix.still_ratio,
    card_ratio: mix.card_ratio,
    hero_moment_count: report.heroMoments?.momentCount || 0,
  };
}

module.exports = {
  asNumber,
  extractVideoFeatures,
  hookType,
  sourceMixFromReport,
  titlePattern,
};
