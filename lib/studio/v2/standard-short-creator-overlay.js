"use strict";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function cleanLabel(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCaseSource(value) {
  const cleaned = cleanLabel(value);
  if (!cleaned) return "UNKNOWN";
  return cleaned.toUpperCase();
}

function isCardScene(scene) {
  const type = String(scene?.type || "").toLowerCase();
  return type === "card" || type.startsWith("card.") || type.includes("_card");
}

function isMotionScene(scene) {
  const type = String(scene?.type || "").toLowerCase();
  return type.includes("clip") || type.includes("frame") || type.includes("motion");
}

function sceneDuration(scene, fallback = 4) {
  const value = Number(scene?.duration ?? scene?.durationS ?? scene?.duration_s);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function extractEntities({ story = {}, scenes = [] } = {}) {
  const sceneEntities = asArray(scenes).map((scene) => cleanLabel(scene.entity));
  const text = `${story.title || ""} ${story.full_script || ""}`;
  const known = [
    "GTA",
    "Grand Theft Auto",
    "Red Dead",
    "Red Dead Redemption",
    "BioShock",
    "Xbox",
    "PlayStation",
    "Nintendo",
    "Switch 2",
    "Subnautica 2",
    "Resident Evil",
    "Pokemon",
    "Pokémon",
  ];
  const textEntities = known.filter((entity) => new RegExp(`\\b${entity.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
  const normalised = [...sceneEntities, ...textEntities].map((entity) => {
    if (/^grand theft auto$/i.test(entity)) return "GTA";
    if (/^red dead redemption$/i.test(entity)) return "Red Dead";
    if (/^pokemon$/i.test(entity)) return "Pokémon";
    return entity;
  });
  return uniq(normalised);
}

function buildCommentOverlay(story = {}) {
  const hasComment = Boolean(String(story.top_comment || "").trim());
  if (story.source_type === "reddit" && hasComment) {
    return {
      allowed: true,
      source_type: "real_reddit_comment",
      label: `r/${cleanLabel(story.subreddit) || "gaming"}`,
      reason: "Reddit source with a real top comment.",
    };
  }
  if (hasComment) {
    return {
      allowed: false,
      source_type: story.source_type === "rss" ? "rss_description_only" : "unknown_non_reddit_text",
      label: null,
      reason: "Non-Reddit text must not be styled as a Reddit comment.",
    };
  }
  return {
    allowed: false,
    source_type: "no_comments",
    label: null,
    reason: "No real comment source available.",
  };
}

function buildEntityPopups(entities, scenes) {
  return entities.map((entity, index) => {
    const matchedScene = asArray(scenes).find((scene) => cleanLabel(scene.entity) === entity);
    return {
      entity,
      kind: "entity_popup",
      style: "small_in_image",
      max_words: 3,
      at_s: Math.max(2, 5 + index * 7),
      duration_s: 2.4,
      anchor: index % 2 === 0 ? "upper_right" : "upper_left",
      paired_scene: matchedScene?.label || null,
      reason: "Named subject should appear as a quick creator-style overlay instead of a full-screen card.",
    };
  });
}

function buildTimeline({ story, scenes, entities, commentOverlay }) {
  const timeline = [];
  const source = titleCaseSource(story.subreddit || story.publisher || story.source_name);
  timeline.push({
    kind: "source_badge",
    label: source,
    at_s: 3,
    duration_s: 2.5,
    style: "compact_corner_badge",
  });
  entities.forEach((entity, index) => {
    timeline.push({
      kind: "entity_popup",
      label: entity,
      entity,
      at_s: Math.max(2, 6 + index * 7),
      duration_s: 2.4,
      style: "in_image_pop",
    });
  });
  const cardCount = asArray(scenes).filter(isCardScene).length;
  if (cardCount > 0) {
    timeline.push({
      kind: "micro_card",
      label: "WHY IT MATTERS",
      at_s: 38,
      duration_s: 2.8,
      style: "lower_third_micro_card",
    });
  }
  if (commentOverlay.allowed) {
    timeline.push({
      kind: "comment_overlay",
      label: commentOverlay.label,
      at_s: 42,
      duration_s: 4,
      style: "verified_comment_chip",
    });
  }
  timeline.push({
    kind: "cta_chip",
    label: "FOLLOW PULSE GAMING",
    at_s: 58,
    duration_s: 3,
    style: "single_line_creator_cta",
  });
  return timeline.sort((a, b) => a.at_s - b.at_s);
}

function buildRecommendations({ cardRatio, motionRatio, blockers }) {
  const recommendations = [];
  if (cardRatio > 0.45) recommendations.push("replace_fullscreen_cards_with_popups");
  if (motionRatio < 0.25) recommendations.push("add_validated_footage_or_gameplay_backbone");
  if (blockers.includes("standard_short_duration_too_long")) {
    recommendations.push("route_to_briefing_or_trim_script_before_render");
  }
  if (recommendations.length === 0) {
    recommendations.push("use_as_standard_short_overlay_contract");
  }
  return recommendations;
}

function buildStandardShortCreatorOverlayPlan({
  story = {},
  scenes = [],
  durationS = 0,
  cardRatioLimit = 0.45,
  maxStandardDurationS = 75,
} = {}) {
  const sceneList = asArray(scenes);
  const totalScenes = sceneList.length;
  const cardScenes = sceneList.filter(isCardScene).length;
  const motionScenes = sceneList.filter(isMotionScene).length;
  const cardRatio = totalScenes > 0 ? Number((cardScenes / totalScenes).toFixed(2)) : 0;
  const motionRatio = totalScenes > 0 ? Number((motionScenes / totalScenes).toFixed(2)) : 0;
  const entities = extractEntities({ story, scenes: sceneList });
  const commentOverlay = buildCommentOverlay(story);
  const blockers = [];
  if (totalScenes === 0) blockers.push("standard_short_has_no_scenes");
  if (cardRatio > cardRatioLimit) blockers.push("standard_short_card_ratio_too_high");
  if (durationS > maxStandardDurationS) blockers.push("standard_short_duration_too_long");

  const warnings = [];
  if (motionRatio < 0.25) warnings.push("standard_short_motion_ratio_low");
  if (entities.length === 0) warnings.push("standard_short_has_no_named_entities");
  if (commentOverlay.source_type === "rss_description_only") warnings.push("rss_description_comment_overlay_disabled");

  const entityPopups = buildEntityPopups(entities, sceneList);
  const timeline = buildTimeline({ story, scenes: sceneList, entities, commentOverlay });
  const recommendations = buildRecommendations({ cardRatio, motionRatio, blockers });

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    story_id: story.id || null,
    verdict: blockers.length ? "needs_standard_overlay_rebuild" : "ready_for_standard_short_overlay",
    blockers,
    warnings,
    duration_s: durationS,
    scene_inventory: {
      total_scenes: totalScenes,
      card_scenes: cardScenes,
      motion_scenes: motionScenes,
      card_ratio: cardRatio,
      motion_ratio: motionRatio,
    },
    caption_rules: {
      style: "creator_punch",
      max_words_per_punch: 2,
      max_phrase_chars: 14,
      max_lines: 1,
      allow_two_line_captions: false,
      animation: "pop_slide_snap",
      emphasis: "bright_keyword_swap",
    },
    entity_popups: entityPopups,
    comment_overlay: commentOverlay,
    timeline,
    recommendations,
    safety: {
      report_only: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
      render_default_changed: false,
    },
  };
}

function renderStandardShortCreatorOverlayMarkdown(plan) {
  const lines = [];
  lines.push("# Standard Short Creator Overlay v1");
  lines.push("");
  lines.push(`Generated: ${plan.generated_at}`);
  lines.push(`Story: ${plan.story_id || "fixture/local"}`);
  lines.push(`Verdict: ${plan.verdict}`);
  lines.push(`Blockers: ${plan.blockers.join(", ") || "clear"}`);
  lines.push(`Warnings: ${plan.warnings.join(", ") || "none"}`);
  lines.push("");
  lines.push("## Caption Rules");
  lines.push("");
  lines.push(`- max words per punch: ${plan.caption_rules.max_words_per_punch}`);
  lines.push(`- max phrase chars: ${plan.caption_rules.max_phrase_chars}`);
  lines.push(`- max lines: ${plan.caption_rules.max_lines}`);
  lines.push(`- animation: ${plan.caption_rules.animation}`);
  lines.push("");
  lines.push("## Entity Popups");
  lines.push("");
  if (plan.entity_popups.length === 0) {
    lines.push("- none");
  } else {
    for (const popup of plan.entity_popups) {
      lines.push(`- ${popup.entity}: ${popup.style} at ${popup.at_s}s`);
    }
  }
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  for (const item of plan.timeline) {
    lines.push(`- ${item.at_s}s ${item.kind}: ${item.label || item.entity || "unlabelled"}`);
  }
  lines.push("");
  lines.push("## Recommendations");
  lines.push("");
  for (const item of plan.recommendations) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  lines.push("## Safety");
  lines.push("");
  lines.push("- Report-only.");
  lines.push("- No DB, Railway, OAuth, render-default or posting changes.");
  return lines.join("\n") + "\n";
}

module.exports = {
  buildStandardShortCreatorOverlayPlan,
  renderStandardShortCreatorOverlayMarkdown,
};
