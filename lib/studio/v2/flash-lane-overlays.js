"use strict";

const { normaliseText } = require("../../text-hygiene");

const ACCENT = "0xFF6B1A";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanLabel(value) {
  return normaliseText(String(value || ""))
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ffEscape(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

function normaliseEntity(value) {
  const cleaned = cleanLabel(value);
  if (!cleaned) return null;
  if (/^pokemon$/i.test(cleaned) || /^pok\u00e9mon$/i.test(cleaned)) return "Pok\u00e9mon";
  if (/^grand theft auto$/i.test(cleaned)) return "GTA";
  if (/^red dead(?: redemption)?$/i.test(cleaned)) return "Red Dead";
  return cleaned;
}

function extractOverlayEntities({ story = {}, scenes = [] } = {}) {
  const known = [
    "Marathon",
    "GTA",
    "Grand Theft Auto",
    "Red Dead",
    "Red Dead Redemption",
    "BioShock",
    "Xbox",
    "PlayStation",
    "Nintendo",
    "Switch 2",
    "Steam",
    "Subnautica 2",
    "Resident Evil",
    "Pokemon",
    "Pokémon",
  ];
  const text = `${story.title || ""} ${story.full_script || ""} ${story.body || ""}`;
  const sceneEntities = asArray(scenes)
    .map((scene) => normaliseEntity(scene?.entity))
    .filter(Boolean);
  const textEntities = known
    .filter((entity) => new RegExp(`\\b${entity.replace(/\s+/g, "\\s+")}\\b`, "i").test(text))
    .map(normaliseEntity)
    .filter(Boolean);
  return [...new Set([...sceneEntities, ...textEntities])].slice(0, 5);
}

function sourceLabel(story = {}) {
  const sourceType = String(story.source_type || "").toLowerCase();
  const raw = story.subreddit || story.publisher || story.source_name || story.source || "";
  if (sourceType === "reddit" && raw) return cleanLabel(raw).replace(/^r\//i, "").toUpperCase();
  return cleanLabel(raw || sourceType || "NEWS").toUpperCase();
}

function commentOverlay(story = {}) {
  const hasComment = Boolean(String(story.top_comment || "").trim());
  if (!hasComment) {
    return {
      allowed: false,
      source_type: "no_comments",
      reason: "No real comment source available.",
    };
  }
  if (String(story.source_type || "").toLowerCase() === "reddit") {
    return {
      allowed: true,
      source_type: "real_reddit_comment",
      label: `r/${cleanLabel(story.subreddit || "gaming")}`,
      reason: "Reddit source with a real top comment.",
    };
  }
  return {
    allowed: false,
    source_type: String(story.source_type || "").toLowerCase() === "rss" ? "rss_description_only" : "unknown_non_reddit_text",
    reason: "Non-Reddit text must not be styled as a Reddit comment.",
  };
}

function boundedTime(value, durationS, fallback) {
  const duration = Number(durationS) || 0;
  const raw = Number(value);
  const candidate = Number.isFinite(raw) ? raw : fallback;
  if (duration <= 0) return Math.max(0, candidate);
  return Math.max(0.25, Math.min(duration - 1.5, candidate));
}

function buildFlashLaneOverlayPlan({ story = {}, scenes = [], durationS = 0 } = {}) {
  const entities = extractOverlayEntities({ story, scenes });
  const source = sourceLabel(story);
  const comment = commentOverlay(story);
  const timeline = [];
  const duration = Number(durationS) || 0;

  timeline.push({
    kind: "hook_chip",
    label: "WAIT... WHAT?",
    at_s: boundedTime(0.55, duration, 0.55),
    duration_s: 2.3,
    anchor: "upper_right",
  });
  timeline.push({
    kind: "source_chip",
    label: source,
    at_s: boundedTime(3.0, duration, 3.0),
    duration_s: 2.6,
    anchor: "upper_left",
  });

  entities.slice(0, 4).forEach((entity, index) => {
    timeline.push({
      kind: "entity_chip",
      label: entity.toUpperCase(),
      entity,
      at_s: boundedTime(7 + index * 8, duration, 7 + index * 8),
      duration_s: 2.4,
      anchor: index % 2 === 0 ? "upper_right" : "upper_left",
    });
  });

  if (duration >= 45) {
    timeline.push({
      kind: "micro_takeaway",
      label: "THE DETAIL THAT MATTERS",
      at_s: boundedTime(duration * 0.58, duration, 38),
      duration_s: 2.8,
      anchor: "lower_left",
    });
  }
  if (comment.allowed && duration >= 50) {
    timeline.push({
      kind: "comment_chip",
      label: comment.label,
      at_s: boundedTime(duration * 0.68, duration, 44),
      duration_s: 3.2,
      anchor: "upper_right",
    });
  }

  return {
    schema_version: 1,
    verdict: timeline.length ? "ready" : "empty",
    style: "flash_lane_creator_chips",
    entities,
    comment_overlay: comment,
    timeline: timeline.sort((a, b) => a.at_s - b.at_s),
    safety: {
      local_only: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function position(anchor) {
  switch (anchor) {
    case "upper_right":
      return { x: "w-420", y: "128", align: "right" };
    case "lower_left":
      return { x: "64", y: "h-430", align: "left" };
    case "upper_left":
    default:
      return { x: "64", y: "128", align: "left" };
  }
}

function chipWidth(item) {
  const len = String(item.label || "").length;
  if (item.kind === "micro_takeaway") return 560;
  return Math.max(230, Math.min(470, 116 + len * 15));
}

function chipFilters(item, fontOpt) {
  const label = ffEscape(String(item.label || "").toUpperCase());
  const p = position(item.anchor);
  const w = chipWidth(item);
  const h = item.kind === "micro_takeaway" ? 92 : 72;
  const startNum = Number(item.at_s || 0);
  const endNum = startNum + Number(item.duration_s || 2.2);
  const start = startNum.toFixed(2);
  const end = endNum.toFixed(2);
  const fadeOut = Math.max(startNum, endNum - 0.18).toFixed(2);
  const enable = `enable='between(t\\,${start}\\,${end})'`;
  const alpha = `alpha='if(lt(t\\,${start})\\,0\\,if(lt(t-${start}\\,0.16)\\,(t-${start})/0.16\\,if(gt(t\\,${fadeOut})\\,max(0\\,1-(t-${fadeOut})/0.18)\\,1)))'`;
  const fontSize = item.kind === "micro_takeaway" ? 34 : label.length > 18 ? 24 : 29;
  const textX = p.align === "right" ? `${p.x}+${w}-tw-28` : `${p.x}+28`;
  const kicker =
    item.kind === "source_chip"
      ? "SOURCE"
      : item.kind === "entity_chip"
        ? "SUBJECT"
        : item.kind === "comment_chip"
          ? "REAL COMMENT"
          : item.kind === "micro_takeaway"
            ? "WHY IT MATTERS"
            : "PULSE";
  return [
    `drawbox=x=${p.x}:y=${p.y}:w=${w}:h=${h}:color=black@0.48:t=fill:${enable}`,
    `drawbox=x=${p.x}:y=${p.y}:w=7:h=${h}:color=${ACCENT}@0.98:t=fill:${enable}`,
    `drawtext=text='${ffEscape(kicker)}':${fontOpt}:fontcolor=${ACCENT}:fontsize=18:x=${textX}:y=${p.y}+11:${alpha}:${enable}`,
    `drawtext=text='${label}':${fontOpt}:fontcolor=white:fontsize=${fontSize}:x=${textX}:y=${p.y}+34:${alpha}:${enable}`,
  ];
}

function buildFlashLaneOverlayFilters({
  plan,
  inputLabel = "base",
  outputLabel = "overlayed",
  fontOpt,
} = {}) {
  const timeline = asArray(plan?.timeline);
  if (!timeline.length) return [`[${inputLabel}]copy[${outputLabel}]`];
  const filters = [];
  for (const item of timeline) filters.push(...chipFilters(item, fontOpt));
  filters.push(`format=yuv420p[${outputLabel}]`);
  return [`[${inputLabel}]${filters.join(",")}`];
}

module.exports = {
  buildFlashLaneOverlayPlan,
  buildFlashLaneOverlayFilters,
  extractOverlayEntities,
};
