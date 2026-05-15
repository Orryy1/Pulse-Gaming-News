"use strict";

const { normaliseText } = require("../../text-hygiene");

const ACCENT = "0xFF6B1A";
const DEFAULT_FRAME = { width: 1080, height: 1920 };

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

function compactChipLabel(value, maxLen = 24) {
  const cleaned = normaliseText(String(value || ""))
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  if (cleaned.length <= maxLen) return cleaned;
  return cleaned
    .slice(0, maxLen - 3)
    .replace(/\s+\S*$/, "")
    .trim()
    .concat("...");
}

function uniqueTimeline(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.kind}:${String(item.label || "").toUpperCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deconflictTimeline(items, { minGapS = 0.08 } = {}) {
  const anchorEnd = new Map();
  return items
    .slice()
    .sort((a, b) => Number(a.at_s || 0) - Number(b.at_s || 0))
    .map((item) => {
      const anchor = item.anchor || "upper_left";
      const start = Number(item.at_s || 0);
      const duration = Math.max(0.1, Number(item.duration_s || 2.2));
      const earliest = anchorEnd.get(anchor);
      const at_s =
        Number.isFinite(earliest) && start < earliest + minGapS
          ? Number((earliest + minGapS).toFixed(2))
          : start;
      anchorEnd.set(anchor, at_s + duration);
      return { ...item, at_s };
    });
}

function sceneWindows(scenes = []) {
  let cursor = 0;
  return asArray(scenes).map((scene) => {
    const duration = Math.max(0, Number(scene?.duration || 0));
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    return {
      type: String(scene?.type || scene?.sceneType || ""),
      isClipBacked: scene?.isClipBacked === true,
      start,
      end,
    };
  });
}

function isReservedCardScene(window) {
  if (/^card\./.test(window.type)) return true;
  return window.type === "opener" && window.isClipBacked !== true;
}

function overlapsCardScene(item, windows) {
  const start = Number(item?.at_s || 0);
  const end = start + Math.max(0.1, Number(item?.duration_s || 2.2));
  return windows.some((window) => {
    if (!isReservedCardScene(window)) return false;
    return start < window.end && end > window.start;
  });
}

function itemTimeWindow(item) {
  const start = Number(item?.at_s || 0);
  const duration = Math.max(0.1, Number(item?.duration_s || 2.2));
  return { start, end: start + duration };
}

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function fullScreenOverlayBlockWindows(scenes = []) {
  return sceneWindows(scenes).filter(isReservedCardScene);
}

function numericBoxValue(value, frame = DEFAULT_FRAME) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value || "").trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const widthOffset = text.match(/^w-(\d+(?:\.\d+)?)$/);
  if (widthOffset) return frame.width - Number(widthOffset[1]);
  const heightOffset = text.match(/^h-(\d+(?:\.\d+)?)$/);
  if (heightOffset) return frame.height - Number(heightOffset[1]);
  return null;
}

function overlayBounds(item, frame = DEFAULT_FRAME) {
  const width = chipWidth(item);
  const pos = position(item?.anchor, width);
  const x = numericBoxValue(pos.x, frame);
  const y = numericBoxValue(pos.y, frame);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x,
    y,
    width,
    height: item?.kind === "micro_takeaway" ? 92 : 72,
  };
}

function boxesOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

function normaliseCaptionBand(band, frame = DEFAULT_FRAME) {
  const x = numericBoxValue(band?.x ?? 0, frame);
  const y = numericBoxValue(band?.y, frame);
  const width = numericBoxValue(band?.width ?? frame.width, frame);
  const height = numericBoxValue(band?.height, frame);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return {
    x,
    y,
    width,
    height,
    start: Number.isFinite(Number(band?.start_s)) ? Number(band.start_s) : 0,
    end: Number.isFinite(Number(band?.end_s)) ? Number(band.end_s) : Infinity,
  };
}

function validateFlashLaneOverlayGeometry({
  overlayPlan,
  scenes = [],
  captionBands,
  frame = DEFAULT_FRAME,
} = {}) {
  const timeline = asArray(overlayPlan?.timeline);
  const fullScreenWindows = fullScreenOverlayBlockWindows(scenes);
  const bands = asArray(captionBands || overlayPlan?.captionBands)
    .map((band) => normaliseCaptionBand(band, frame))
    .filter(Boolean);
  const findings = [];

  for (const item of timeline) {
    if (item?.anchor !== "upper_left") continue;
    const itemWindow = itemTimeWindow(item);
    const bounds = overlayBounds(item, frame);

    for (const window of fullScreenWindows) {
      if (!intervalsOverlap(itemWindow.start, itemWindow.end, window.start, window.end)) continue;
      findings.push({
        type: "fullscreen_scene_interval",
        code: "flash_lane_upper_left_overlay_intersects_fullscreen_scene",
        overlayKind: item.kind || "overlay",
        overlayLabel: item.label || null,
        sceneType: window.type,
        start_s: Number(itemWindow.start.toFixed(2)),
        end_s: Number(itemWindow.end.toFixed(2)),
        sceneStart_s: Number(window.start.toFixed(2)),
        sceneEnd_s: Number(window.end.toFixed(2)),
      });
    }

    if (!bounds) continue;
    bands.forEach((band, index) => {
      if (!intervalsOverlap(itemWindow.start, itemWindow.end, band.start, band.end)) return;
      if (!boxesOverlap(bounds, band)) return;
      findings.push({
        type: "caption_band_overlap",
        code: "flash_lane_upper_left_overlay_overlaps_caption_band",
        overlayKind: item.kind || "overlay",
        overlayLabel: item.label || null,
        captionBandIndex: index,
        bounds,
        band: {
          x: band.x,
          y: band.y,
          width: band.width,
          height: band.height,
          start_s: Number.isFinite(band.start) ? Number(band.start.toFixed(2)) : null,
          end_s: Number.isFinite(band.end) ? Number(band.end.toFixed(2)) : null,
        },
      });
    });
  }

  const blockers = [...new Set(findings.map((finding) => finding.code))];
  return {
    verdict: blockers.length ? "block" : "allow",
    blockers,
    warnings: [],
    findings,
    metrics: {
      overlayCount: timeline.length,
      upperLeftOverlayCount: timeline.filter((item) => item?.anchor === "upper_left").length,
      fullScreenWindowCount: fullScreenWindows.length,
      captionBandCount: bands.length,
    },
    safety: {
      local_only: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function avoidCardSceneGeometry(items, scenes) {
  const windows = sceneWindows(scenes);
  if (!windows.length) return items;
  return items.map((item) => {
    if (item.anchor !== "upper_left") return item;
    if (!overlapsCardScene(item, windows)) return item;
    return {
      ...item,
      anchor: "mid_left",
      anchor_note: "moved_from_upper_left_to_avoid_card_scene",
    };
  });
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

function storyText(story = {}) {
  return cleanLabel(
    `${story.title || ""} ${story.hook || ""} ${story.body || ""} ${story.full_script || ""}`,
  ).toLowerCase();
}

function addBeat(beats, label, reason) {
  const compact = compactChipLabel(label);
  if (!compact) return;
  if (beats.some((beat) => beat.label === compact)) return;
  beats.push({ label: compact, reason });
}

function extractStoryBeats({ story = {}, entities = [] } = {}) {
  const text = storyText(story);
  const beats = [];

  if (/\b(?:passed on|killed|cancelled|canceled|scrapped|shelved|veto|dropped)\b/i.test(text)) {
    addBeat(beats, "Sequel veto", "cancelled_or_rejected_project");
  }
  if (/\b(?:which one|legacy franchise|mystery|unknown franchise)\b/i.test(text) && entities.length >= 2) {
    addBeat(beats, "Multi-game mystery", "multiple_entities_with_unknown_target");
  }
  if (/\b(?:no date yet|no release date|date yet|launch window|still unsaid|without a date|platforms? .*unsaid)\b/i.test(text)) {
    addBeat(beats, "No date yet", "missing_release_or_platform_detail");
  }
  if (/\b(?:age verification|under[- ]?18|under the age of 18|age gate|new law|ban anyone under)\b/i.test(text)) {
    addBeat(beats, "Age gate", "age_restriction_policy");
  }
  if (/\b(?:price|pricing|\$100|cost|reasonable)\b/i.test(text)) {
    addBeat(beats, "Price watch", "price_or_value_angle");
  }
  if (
    !/\b(?:no date yet|no release date|date yet|without a date)\b/i.test(text) &&
    /\b(?:release date|release time|launches|launch date|goes live)\b/i.test(text)
  ) {
    addBeat(beats, "Date confirmed", "confirmed_release_timing");
  }
  if (/\b(?:free|freebie|game pass|ps plus|included|no extra cost)\b/i.test(text)) {
    addBeat(beats, "Freebie alert", "free_or_subscription_value");
  }
  if (/\b(?:trailer|teaser|showcase|revealed|debut)\b/i.test(text)) {
    addBeat(beats, "Trailer watch", "trailer_or_reveal_angle");
  }
  if (/\b(?:mixed reviews|review bomb|steam reviews|main page|slop|ai games?)\b/i.test(text)) {
    addBeat(beats, "Steam reaction", "community_or_review_reaction");
  }
  if (/\b(?:down this quarter|revenue|player.*down|daily ccu|concurrent players|top 50)\b/i.test(text)) {
    addBeat(beats, "Numbers down", "performance_or_business_signal");
  }

  if (!beats.length && entities.length) {
    addBeat(beats, `${entities[0]} update`, "entity_update_fallback");
  }

  return beats.slice(0, 4);
}

function hookChipLabel({ story = {}, beats = [] } = {}) {
  const text = storyText(story);
  if (beats.some((beat) => beat.label === "MULTI-GAME MYSTERY")) return "WAIT, WHICH GAME?";
  if (beats.some((beat) => beat.label === "AGE GATE")) return "AGE CHECK?";
  if (beats.some((beat) => beat.label === "PRICE WATCH")) return "PRICE SHOCK?";
  if (beats.some((beat) => beat.label === "DATE CONFIRMED")) return "DATE LOCKED";
  if (/\b(?:confirmed|official|revealed)\b/i.test(text)) return "CONFIRMED";
  if (/\b(?:rumour|rumor|reportedly|could|might)\b/i.test(text)) return "RUMOUR WATCH";
  return "WAIT... WHAT?";
}

function microTakeawayLabel(beats = []) {
  const noDate = beats.find((beat) => beat.label === "NO DATE YET");
  if (noDate) return noDate.label;
  if (beats.length > 1) return beats[1].label;
  return "WHY IT MATTERS";
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
  const beats = extractStoryBeats({ story, entities });
  const source = sourceLabel(story);
  const comment = commentOverlay(story);
  const timeline = [];
  const duration = Number(durationS) || 0;

  timeline.push({
    kind: "hook_chip",
    label: hookChipLabel({ story, beats }),
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

  beats.slice(0, 3).forEach((beat, index) => {
    timeline.push({
      kind: "beat_chip",
      label: beat.label,
      reason: beat.reason,
      at_s: boundedTime(5.6 + index * 7.2, duration, 5.6 + index * 7.2),
      duration_s: 2.45,
      anchor: index % 2 === 0 ? "lower_left" : "upper_right",
    });
  });

  entities.slice(0, 4).forEach((entity, index) => {
    timeline.push({
      kind: "entity_chip",
      label: compactChipLabel(entity),
      entity,
      at_s: boundedTime(9 + index * 8, duration, 9 + index * 8),
      duration_s: 2.4,
      anchor: index % 2 === 0 ? "upper_right" : "upper_left",
    });
  });

  if (duration >= 45) {
    timeline.push({
      kind: "micro_takeaway",
      label: microTakeawayLabel(beats),
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
    story_beats: beats,
    comment_overlay: comment,
    timeline: deconflictTimeline(
      avoidCardSceneGeometry(uniqueTimeline(timeline), scenes),
    ),
    safety: {
      local_only: true,
      production_db_mutated: false,
      railway_mutated: false,
      oauth_triggered: false,
      posted_to_platforms: false,
    },
  };
}

function position(anchor, width) {
  switch (anchor) {
    case "upper_right":
      return { x: `w-${width}`, y: "128", align: "right" };
    case "mid_left":
      return { x: "64", y: "980", align: "left" };
    case "lower_left":
      return { x: "64", y: "h-430", align: "left" };
    case "upper_left":
    default:
      // Scene-level badges occupy the high corner, and Flash source
      // cards reserve y=196..352. Keep global chips below both zones.
      return { x: "64", y: "388", align: "left" };
  }
}

function chipWidth(item) {
  const len = String(item.label || "").length;
  if (item.kind === "micro_takeaway") return 560;
  if (item.kind === "beat_chip") return Math.max(300, Math.min(520, 146 + len * 16));
  return Math.max(230, Math.min(470, 116 + len * 15));
}

function chipFilters(item, fontOpt) {
  const label = ffEscape(String(item.label || "").toUpperCase());
  const w = chipWidth(item);
  const p = position(item.anchor, w);
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
        : item.kind === "beat_chip"
          ? "KEY BEAT"
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
  validateFlashLaneOverlayGeometry,
};
