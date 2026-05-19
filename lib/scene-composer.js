/**
 * lib/scene-composer.js â€” Studio Short Engine composer.
 *
 * Takes a media inventory + story metadata + audio duration and
 * produces a typed scene list. The renderer (tools/quality-prototype.js)
 * walks this list and dispatches per-scene-type filter generators.
 *
 * The composer is opinionated:
 *   - Slot 0 is always the opener (clip-backed if a clip exists, else
 *     a designed title card on top of the article hero).
 *   - One card.source goes between slots 1â€“3.
 *   - card.quote is inserted near 50% if a top_comment exists.
 *   - card.release is inserted near 75% if release metadata exists.
 *   - Last slot is always card.takeaway.
 *   - Remaining slots alternate clip / trailer-frame / article-hero,
 *     biased toward clips when available.
 *
 * Anti-repetition is enforced AFTER allocation:
 *   - No still rendered more than 2Ã— per video. Substitutes a card
 *     scene when count > 2.
 *   - No two ADJACENT scenes share the same source. Swaps the
 *     repeated scene with the next non-conflicting one.
 *   - Different crops of the same source count as the SAME still.
 *
 * The composer doesn't render anything. It produces a scene list +
 * metrics object describing what kind of slate it built. The
 * renderer translates each scene to ffmpeg and the quality harness
 * reads the metrics to judge whether the result qualifies as
 * studio-grade.
 */

"use strict";

const { inferPrimaryEntity } = require("./studio/v2/visual-v3-overlays");

const SCENE_TYPES = {
  OPENER: "opener",
  CLIP: "clip",
  PUNCH: "punch",
  SPEED_RAMP: "speed-ramp",
  FREEZE_FRAME: "freeze-frame",
  STILL: "still",
  CLIP_FRAME: "clip.frame", // a still extracted from a trailer
  CARD_SOURCE: "card.source",
  CARD_RELEASE: "card.release",
  CARD_QUOTE: "card.quote",
  CARD_STAT: "card.stat",
  CARD_TAKEAWAY: "card.takeaway",
  CARD_TIMELINE: "card.timeline", // 3-bullet authored "what we know" beat (v2)
};

const STILL_TYPES = new Set([SCENE_TYPES.STILL, SCENE_TYPES.CLIP_FRAME]);
const MAX_FLASH_REUSE_PER_CLIP = 3;

const CARD_TYPES = new Set([
  SCENE_TYPES.OPENER, // when synthesised, opener is card-like
  SCENE_TYPES.CARD_SOURCE,
  SCENE_TYPES.CARD_RELEASE,
  SCENE_TYPES.CARD_QUOTE,
  SCENE_TYPES.CARD_STAT,
  SCENE_TYPES.CARD_TAKEAWAY,
  SCENE_TYPES.CARD_TIMELINE,
]);

/**
 * Compute the target scene count from audio duration.
 * Studio shorts run 12â€“16 cuts in 60s for a fast-paced feel. Visual V3
 * quick-cut proofs deliberately run denser, closer to short-form news edits.
 */
function computeTargetSceneCount(audioDurationS, opts = {}) {
  if (opts.quickCut === true) {
    const quickIdeal = Math.ceil(audioDurationS / 2.6);
    return Math.min(24, Math.max(20, quickIdeal));
  }
  if (opts.flashLane === true && Number(audioDurationS) >= 60) {
    const flashIdeal = Math.ceil(audioDurationS / 3.1);
    return Math.min(22, Math.max(18, flashIdeal));
  }
  const ideal = Math.ceil(audioDurationS / 4.0);
  return Math.min(16, Math.max(12, ideal));
}

/**
 * Compute per-scene base duration so scenes sum to ~audio duration.
 * Mixed transitions shrink coverage by ~0.12s per edge on average.
 */
function computeSceneDuration(audioDurationS, sceneCount) {
  const overlap = (sceneCount - 1) * 0.12;
  // 0.4s tail margin so -shortest doesn't clip the last word
  return Math.max(
    3.0,
    Math.min(8.0, (audioDurationS + overlap + 0.4) / sceneCount),
  );
}

/**
 * Return a stable identifier for a scene's "source identity" â€” used
 * for repetition counting. Different crops of the same image share
 * an id; clips share the source clip's path.
 */
function sourceId(scene) {
  if (!scene) return null;
  // Strip multi-crop suffixes (`_smartcrop_v2_attention.jpg` etc.)
  // so the same source-image-with-different-crop counts as one.
  const raw = scene.source || scene.backgroundSource || scene.label || "";
  return String(raw).replace(/_smartcrop_v2(_[a-z]+)?\.jpe?g$/i, ".jpg");
}

function backdropSourceId(value) {
  if (!value) return null;
  return sourceId({ source: value });
}

function chooseCardBackdrop(cardBackdrops, index, avoidIds = new Set()) {
  if (!Array.isArray(cardBackdrops) || cardBackdrops.length === 0) return null;
  const safeAvoid = avoidIds instanceof Set ? avoidIds : new Set();
  for (let step = 0; step < cardBackdrops.length; step++) {
    const asset = cardBackdrops[(index + step) % cardBackdrops.length];
    const source = asset?.path || null;
    if (!source) continue;
    if (!safeAvoid.has(backdropSourceId(source))) return source;
  }
  return cardBackdrops[index % cardBackdrops.length]?.path || null;
}

function interleaveAssetPools(primary = [], secondary = []) {
  const out = [];
  const max = Math.max(primary.length, secondary.length);
  for (let i = 0; i < max; i++) {
    if (primary[i]) out.push(primary[i]);
    if (secondary[i]) out.push(secondary[i]);
  }
  return out;
}

function repairCardBackdropAdjacency(scenes, cardBackdrops) {
  if (!Array.isArray(scenes) || !Array.isArray(cardBackdrops) || cardBackdrops.length === 0) {
    return;
  }
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!CARD_TYPES.has(scene?.type) || !scene.backgroundSource) continue;
    const avoid = new Set();
    if (i > 0) avoid.add(sourceId(scenes[i - 1]));
    if (i + 1 < scenes.length) avoid.add(sourceId(scenes[i + 1]));
    const current = sourceId(scene);
    if (!avoid.has(current)) continue;
    const replacement = chooseCardBackdrop(cardBackdrops, i + 1, avoid);
    if (replacement) scene.backgroundSource = replacement;
  }
}

function repairCardBackdropReuse(scenes, cardBackdrops) {
  if (!Array.isArray(scenes) || !Array.isArray(cardBackdrops) || cardBackdrops.length === 0) {
    return;
  }
  const used = new Set();
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const current = sourceId(scene);
    if (CARD_TYPES.has(scene?.type) && scene.backgroundSource) {
      if (used.has(current)) {
        const avoid = new Set(used);
        if (i + 1 < scenes.length) avoid.add(sourceId(scenes[i + 1]));
        const replacement = chooseCardBackdrop(cardBackdrops, i + 1, avoid);
        if (replacement) {
          scene.backgroundSource = replacement;
        }
      }
      used.add(sourceId(scene));
      continue;
    }
    if (scene?.source) used.add(sourceId(scene));
  }
}

function ensureTakeawayTail(scenes) {
  if (!Array.isArray(scenes) || scenes.length < 2) return;
  const takeawayIndex = scenes.findIndex((scene) => scene?.type === SCENE_TYPES.CARD_TAKEAWAY);
  if (takeawayIndex < 0 || takeawayIndex === scenes.length - 1) return;
  const [takeaway] = scenes.splice(takeawayIndex, 1);
  scenes.push(takeaway);
}

/**
 * Pick a motion preset for a still slot, deterministically rotating
 * presets across slots so adjacent stills get visibly different
 * animation.
 */
function pickMotion(slotIdx) {
  const presets = [
    "pushInCentre",
    "pullBackCentre",
    "pushPanRight",
    "pushPanLeft",
    "driftDown",
  ];
  return presets[slotIdx % presets.length];
}

function visualSceneMeta(asset) {
  const clipDurationS = Number.isFinite(Number(asset?.durationS))
    ? Number(asset.durationS)
    : Number.isFinite(Number(asset?.duration_s))
      ? Number(asset.duration_s)
      : null;
  const provenance = asset?.provenance || {};
  return {
    entity: asset?.entity || asset?.exact_subject_group || null,
    sourceType: asset?.sourceType || asset?.source_type || asset?.kind || null,
    clipDurationS:
      clipDurationS === null || clipDurationS <= 0
        ? null
        : Number(clipDurationS.toFixed(2)),
    clipTimingProvenance:
      clipDurationS === null || clipDurationS <= 0
        ? null
        : {
            clip_start_policy: provenance.clip_start_policy || null,
            segment_validated:
              typeof provenance.segment_validated === "boolean"
                ? provenance.segment_validated
                : null,
            allowed_for_flash_lane:
              typeof provenance.allowed_for_flash_lane === "boolean"
                ? provenance.allowed_for_flash_lane
                : null,
            segment_trim_recommended:
              typeof provenance.segment_trim_recommended === "boolean"
                ? provenance.segment_trim_recommended
                : null,
            segment_original_start_s:
              Number.isFinite(Number(provenance.segment_original_start_s))
                ? Number(Number(provenance.segment_original_start_s).toFixed(2))
                : null,
            segment_original_duration_s:
              Number.isFinite(Number(provenance.segment_original_duration_s))
                ? Number(Number(provenance.segment_original_duration_s).toFixed(2))
                : null,
            segment_recommended_start_s:
              Number.isFinite(Number(provenance.segment_recommended_start_s))
                ? Number(Number(provenance.segment_recommended_start_s).toFixed(2))
                : null,
            segment_recommended_duration_s:
              Number.isFinite(Number(provenance.segment_recommended_duration_s))
                ? Number(Number(provenance.segment_recommended_duration_s).toFixed(2))
                : null,
          },
    mediaStartS:
      Number.isFinite(Number(asset?.mediaStartS))
        ? Number(asset.mediaStartS)
        : Number.isFinite(Number(asset?.media_start_s))
          ? Number(asset.media_start_s)
          : null,
    targetTimeS:
      Number.isFinite(Number(provenance.target_time_seconds))
        ? Number(Number(provenance.target_time_seconds).toFixed(2))
        : Number.isFinite(Number(asset?.targetTimeS))
          ? Number(Number(asset.targetTimeS).toFixed(2))
          : Number.isFinite(Number(asset?.target_time_seconds))
            ? Number(Number(asset.target_time_seconds).toFixed(2))
            : null,
  };
}

function canonicalMediaUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/[?#].*$/, "");
}

function frameTargetTime(asset = {}) {
  const provenance = asset.provenance || {};
  const candidates = [
    asset.targetTimeS,
    asset.target_time_seconds,
    asset.targetTimeSeconds,
    asset.seek_seconds,
    asset.seekSeconds,
    provenance.target_time_seconds,
    provenance.seek_seconds,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function clipWindow(clip = {}) {
  const start = Number(clip.mediaStartS ?? clip.media_start_s ?? clip.startS ?? clip.start_s);
  const duration = Number(clip.durationS ?? clip.duration_s ?? clip.duration);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return null;
  const source = canonicalMediaUrl(clip.path || clip.source_url || clip.sourceUrl || clip.url);
  return {
    source,
    start,
    end: start + duration,
  };
}

function frameOverlapsClipWindow(frame = {}, windows = []) {
  const target = frameTargetTime(frame);
  if (!Number.isFinite(target)) return false;
  const frameSource = canonicalMediaUrl(
    frame.sourceUrl ||
      frame.source_url ||
      frame.provenance?.source_url ||
      frame.provenance?.url ||
      frame.path,
  );
  return windows.some((window) => {
    if (!window) return false;
    if (window.source && frameSource && window.source !== frameSource) return false;
    return target >= window.start - 0.35 && target <= window.end + 0.65;
  });
}

function removeFramesCoveredByMotionWindows(frames = [], clips = []) {
  const windows = clips.map(clipWindow).filter(Boolean);
  if (!windows.length) return frames;
  return frames.filter((frame) => !frameOverlapsClipWindow(frame, windows));
}

function actualClipSceneCount(scenes) {
  return scenes.filter(
    (scene) =>
      scene.type === SCENE_TYPES.CLIP ||
      scene.type === SCENE_TYPES.PUNCH ||
      scene.type === SCENE_TYPES.SPEED_RAMP ||
      scene.type === SCENE_TYPES.FREEZE_FRAME ||
      (scene.type === SCENE_TYPES.OPENER && scene.isClipBacked === true),
  ).length;
}

function deferFlashSourceCardAfterHook(scenes) {
  const sourceIndex = scenes.findIndex((scene) => scene.type === SCENE_TYPES.CARD_SOURCE);
  if (sourceIndex < 0 || sourceIndex > 2 || scenes.length <= 4) return;
  const [sourceCard] = scenes.splice(sourceIndex, 1);
  const targetIndex = Math.min(4, Math.max(3, scenes.length - 1));
  scenes.splice(targetIndex, 0, sourceCard);
}

function reusableClipVariant(clips, useIndex) {
  if (!Array.isArray(clips) || clips.length === 0) return null;
  const clip = clips[useIndex % clips.length];
  const validatedStart = Number.isFinite(Number(clip?.mediaStartS))
    ? Number(clip.mediaStartS)
    : Number.isFinite(Number(clip?.media_start_s))
      ? Number(clip.media_start_s)
      : null;
  return {
    ...clip,
    mediaStartS: validatedStart === null ? null : Number(validatedStart.toFixed(2)),
  };
}

function clipActionScore(clip = {}) {
  const provenance = clip.provenance || {};
  const value = Number(
    clip.actionScore ??
      clip.action_score ??
      provenance.segment_action_score ??
      provenance.action_score,
  );
  return Number.isFinite(value) ? value : 0;
}

function clipDurationSeconds(clip = {}) {
  const value = Number(clip.durationS ?? clip.duration_s ?? clip.duration);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clipStartSeconds(clip = {}) {
  const value = Number(clip.mediaStartS ?? clip.media_start_s ?? clip.startS);
  return Number.isFinite(value) ? value : null;
}

function isTrimmedClipWindow(clip = {}) {
  const provenance = clip.provenance || {};
  return (
    clip.trim_recommended === true ||
    provenance.segment_trim_recommended === true ||
    /trimmed/i.test(String(provenance.clip_start_policy || "")) ||
    /trimmed/i.test(String(provenance.segment_validation_reason || ""))
  );
}

function openerClipScore(clip = {}, index = 0) {
  if (!clip?.path) return Number.NEGATIVE_INFINITY;
  const durationS = clipDurationSeconds(clip);
  const startS = clipStartSeconds(clip);
  let score = clipActionScore(clip);
  score += Math.min(durationS, 5) * 10;
  if (durationS >= 4.2) score += 18;
  if (durationS < 3) score -= 10;
  if (isTrimmedClipWindow(clip)) score -= 18;
  if (Number.isFinite(startS) && startS < 45) score -= 4;
  score -= index * 0.01;
  return score;
}

function takeBestOpenerClip(clips = []) {
  if (!Array.isArray(clips) || clips.length === 0) return null;
  let bestIndex = 0;
  let bestScore = openerClipScore(clips[0], 0);
  for (let index = 1; index < clips.length; index += 1) {
    const score = openerClipScore(clips[index], index);
    if (score > bestScore) {
      bestIndex = index;
      bestScore = score;
    }
  }
  const [clip] = clips.splice(bestIndex, 1);
  return clip || null;
}

function flashLaneClipType(slotIndex) {
  if (slotIndex === 1) return SCENE_TYPES.PUNCH;
  if (slotIndex === 3) return SCENE_TYPES.SPEED_RAMP;
  if (slotIndex === 5) return SCENE_TYPES.FREEZE_FRAME;
  return SCENE_TYPES.CLIP;
}

function flashLaneFreezeCaption(story) {
  const text = `${story?.title || ""} ${story?.hook || ""} ${story?.body || ""}`.toLowerCase();
  if (/\blegacy\b.*\bsequel\b|\bpassed on\b|\bkilled\b/.test(text)) {
    return "LEGACY SEQUEL AXED";
  }
  if (/\bprice\b|\bcost\b|\b\$100\b/.test(text)) return "PRICE STILL UNKNOWN";
  if (/\brelease\b|\blaunch\b|\btimes?\b/.test(text)) return "TIMES CONFIRMED";
  if (/\btrailer\b|\bteaser\b|\breveal\b/.test(text)) return "TRAILER TELLS ALL";
  return "WHY IT MATTERS";
}

function storyCorpus(story) {
  return [
    story?.title,
    story?.hook,
    story?.body,
    story?.full_script,
    story?.classification,
    story?.content_pillar,
  ]
    .filter(Boolean)
    .join(" ");
}

function isSteamPlayerMetricStory(story) {
  const text = storyCorpus(story).toLowerCase();
  return /\bsteam\b/.test(text) && /\b(?:concurrent players|players|peak|record|ccu)\b/.test(text);
}

function extractCommaNumber(text) {
  return String(text || "").match(/\b\d{1,3}(?:,\d{3})+\b/)?.[0] || null;
}

function timelineHeadingForStory(story) {
  const entity = inferPrimaryEntity(story);
  if (entity) return entity.toUpperCase();
  const title = String(story?.title || "STORY");
  return title
    .split(/\s+[-:|]\s+|\s+[\u2013\u2014]\s+/u)[0]
    .split(
      /\s+\b(?:just|immediately|reportedly|officially|finally|hit|hits|beats|beat|breaks|broke|drops|dropped|launches|launched|record|steam)\b/i,
    )[0]
    .trim()
    .toUpperCase()
    .slice(0, 28);
}

/**
 * Decide whether to insert a card.source for this story. Always
 * insert if we know the source â€” providing context is part of the
 * studio voice.
 */
function buildSourceCardScene(story, opts) {
  const sourceType = String(story?.source_type || "").toLowerCase();
  const isReddit = sourceType === "reddit";
  const sourceName = story?.subreddit || story?.publisher || story?.source_name || "";
  const label = isReddit && sourceName
    ? `r/${sourceName}`
    : sourceName || (story?.source_type ? String(story.source_type).toUpperCase() : "NEWS");
  return {
    type: SCENE_TYPES.CARD_SOURCE,
    duration: opts.duration,
    label: "card_source",
    backgroundSource: opts.backdrop,
    sourceLabel: label,
    flair: story?.flair || story?.classification,
    sublabel: story?.flair ? String(story.flair).toUpperCase() : "",
  };
}

function buildReleaseDateCardScene(story, opts) {
  // Try to detect a release-date-ish field. Fallback to a sensible
  // editorial beat when the trailer withholds concrete launch info.
  const date =
    story?.release_date || story?.launch_date || story?._release || null;
  if (!date && !shouldUseKnownUnknownReleaseCard(story)) return null;
  return {
    type: SCENE_TYPES.CARD_RELEASE,
    duration: opts.duration,
    label: "card_release",
    backgroundSource: opts.backdrop,
    dateLabel: date || "NO DATE YET",
    kicker: date ? "RELEASE DATE" : "KNOWN UNKNOWN",
    sublabel: date ? "" : "PLATFORMS AND LAUNCH WINDOW STILL UNSAID",
    cardKind: date ? "release-date" : "known-unknown",
  };
}

function buildQuoteCardScene(story, opts) {
  if (isSteamPlayerMetricStory(story)) return null;
  if (!hasRealRedditComment(story)) return null;
  const top = story?.top_comment;
  if (!top) return null;
  const author =
    story?.reddit_comments?.[0]?.author ||
    story?.top_comment_author ||
    "Redditor";
  const score = story?.reddit_comments?.[0]?.score ?? null;
  return {
    type: SCENE_TYPES.CARD_QUOTE,
    duration: opts.duration,
    label: "card_quote",
    backgroundSource: opts.backdrop,
    body: String(top),
    author,
    score,
  };
}

function hasRealRedditComment(story) {
  if (!story?.top_comment) return false;
  if (isSteamPlayerMetricStory(story)) return false;
  if (String(story?.source_type || "").toLowerCase() === "reddit") return true;
  return Array.isArray(story?.reddit_comments) && story.reddit_comments.length > 0;
}

function shouldUseKnownUnknownReleaseCard(story) {
  const text = storyCorpus(story).toLowerCase();

  if (/\bpassed on\b|\bkilled\b|\blegacy franchise\b/.test(text)) return false;
  if (isSteamPlayerMetricStory(story)) return false;
  if (/\b(?:no date yet|no release date|without a date|date unconfirmed|platforms? unconfirmed|launch window still unsaid)\b/.test(text)) {
    return true;
  }
  return (
    /\b(?:trailer|teaser|reveal|showcase|direct|announced|coming)\b/.test(text) &&
    !/\b(?:launch hit|launched|launches|goes live|release date)\b/.test(text)
  );
}

/**
 * Pick a filler card scene for a middle slot. Constraints:
 *   - Cannot use quote/release/takeaway â€” those are reservedTail
 *     and would duplicate.
 *   - Source-cards are CAPPED at 2 per video total. The first is
 *     the dedicated reveal at slot 2. A SECOND source-card filler
 *     reads as a deliberate re-anchor; a THIRD reads as a slate
 *     bug (user feedback: "it appears twice 8 seconds apart, not
 *     needed").
 *
 * When the cap is reached, return null. The caller falls back to
 * re-using a clip.frame from the inventory pool (handed in via
 * the `frames`/`heroes` references). One source-card too few is
 * better than three source-cards too many.
 */
function pickFillerScene(scenes, story, duration, cardBackdrop, idx, opts = {}) {
  const sourceCount = scenes.filter(
    (s) => s.type === SCENE_TYPES.CARD_SOURCE,
  ).length;
  if (!opts.sourceCardAsOverlay && sourceCount < 1) {
    return buildSourceCardScene(story, {
      duration,
      backdrop: cardBackdrop(idx),
    });
  }
  const steamMetric = isSteamPlayerMetricStory(story);
  if (
    (!steamMetric || opts.allowSteamContextCard !== false) &&
    !scenes.some((s) => s.label === "card_context")
  ) {
    return buildContextCardScene(story, {
      duration,
      backdrop: cardBackdrop(idx),
    });
  }
  if (!scenes.some((s) => s.label === "card_timeline")) {
    return buildTimelineSummaryCardScene(story, {
      duration,
      backdrop: cardBackdrop(idx),
    });
  }
  if (!scenes.some((s) => s.label === "card_known_unknowns")) {
    const knownUnknown = buildKnownUnknownCardScene(story, {
      duration,
      backdrop: cardBackdrop(idx),
    });
    if (knownUnknown) return knownUnknown;
  }
  if (opts.flashLane === true && opts.allowFlashExpansionCards !== false) {
    return buildFlashLaneSupplementalCardScene(
      story,
      {
        duration,
        backdrop: cardBackdrop(idx),
      },
      new Set(scenes.map((s) => s.label).filter(Boolean)),
    );
  }
  return null;
}

function buildTakeawayCardScene(story, opts) {
  return {
    type: SCENE_TYPES.CARD_TAKEAWAY,
    duration: opts.duration,
    label: "card_takeaway",
    backgroundSource: opts.backdrop,
    text: opts.takeawayText || "WATCH THE FULL TRAILER",
    cta: opts.cta || "FOLLOW FOR MORE",
    cardKind: "takeaway",
  };
}

function buildKnownUnknownCardScene(story, opts) {
  if (isSteamPlayerMetricStory(story)) return null;
  return {
    type: SCENE_TYPES.CARD_RELEASE,
    duration: opts.duration,
    label: "card_known_unknowns",
    backgroundSource: opts.backdrop,
    dateLabel: "TRAILER ONLY",
    kicker: "CONFIRMED",
    sublabel: "NO GAMEPLAY, DATE OR PLATFORMS CONFIRMED",
    cardKind: "evidence-gap",
  };
}

function buildContextCardScene(story, opts) {
  const steamMetric = isSteamPlayerMetricStory(story)
    ? extractCommaNumber(storyCorpus(story))
    : null;
  return {
    type: SCENE_TYPES.CARD_STAT,
    duration: opts.duration,
    label: "card_context",
    backgroundSource: opts.backdrop,
    statLabel: steamMetric ? "STEAM PEAK" : "WHY IT MATTERS",
    sublabel:
      steamMetric
        ? `${steamMetric} concurrent players`
        : story?.classification === "Rumour"
        ? "Treat this as unconfirmed until official sources land"
        : "This changes how players read the next update",
    badge: steamMetric ? "HARD NUMBERS" : "SOURCE-BACKED",
    cardKind: "context",
  };
}

function buildTimelineSummaryCardScene(story, opts) {
  return {
    type: SCENE_TYPES.CARD_TIMELINE,
    duration: opts.duration,
    label: "card_timeline",
    backgroundSource: opts.backdrop,
    kicker: "WHAT WE KNOW",
    heading: timelineHeadingForStory(story),
    bullets: [
      isSteamPlayerMetricStory(story) ? "Steam peak is live" : "Source report is live",
      isSteamPlayerMetricStory(story) ? "Other storefronts excluded" : "Player access is the shift",
      isSteamPlayerMetricStory(story) ? "Full launch could climb" : "Follow-up details still matter",
    ],
    cardKind: "timeline",
  };
}

function buildFlashLaneSupplementalCardScene(story, opts, usedLabels) {
  const steamMetric = isSteamPlayerMetricStory(story);
  const metric = steamMetric ? extractCommaNumber(storyCorpus(story)) : null;
  const variants = steamMetric
    ? [
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_steam_chart",
          statLabel: metric || "STEAM PEAK",
          sublabel: "Steam-only early access signal",
          badge: "LIVE METRIC",
          cardKind: "steam-chart",
        },
        {
          type: SCENE_TYPES.CARD_TIMELINE,
          label: "card_storefront_gap",
          kicker: "CONTEXT",
          heading: "NOT THE WHOLE AUDIENCE",
          bullets: ["Xbox not counted", "Game Pass not counted", "Microsoft Store not counted"],
          cardKind: "storefront-gap",
        },
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_early_access",
          statLabel: "EARLY ACCESS",
          sublabel: "Full launch could push the peak higher",
          badge: "CAVEAT",
          cardKind: "early-access",
        },
        {
          type: SCENE_TYPES.CARD_TIMELINE,
          label: "card_launch_watch",
          kicker: "NEXT WATCH",
          heading: "FULL LAUNCH TEST",
          bullets: ["Retention after day one", "Storefront split", "Weekend peak"],
          cardKind: "launch-watch",
        },
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_record_check",
          statLabel: "RECORD CHECK",
          sublabel: "Compare the peak against older series highs",
          badge: "BENCHMARK",
          cardKind: "record-check",
        },
        {
          type: SCENE_TYPES.CARD_TIMELINE,
          label: "card_retention_watch",
          kicker: "RETENTION",
          heading: "DO PLAYERS STAY?",
          bullets: ["First spike", "Second-session drop", "Weekend replay"],
          cardKind: "retention-watch",
        },
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_player_signal",
          statLabel: "PLAYER SIGNAL",
          sublabel: "A big Steam spike before the wider launch",
          badge: "MOMENTUM",
          cardKind: "player-signal",
        },
        {
          type: SCENE_TYPES.CARD_TIMELINE,
          label: "card_source_lock",
          kicker: "SOURCE LOCK",
          heading: timelineHeadingForStory(story),
          bullets: ["Reported peak", "Platform caveat", "Launch question"],
          cardKind: "source-lock",
        },
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_heat_check",
          statLabel: "HEAT CHECK",
          sublabel: "Launch-week attention is already visible",
          badge: "TREND",
          cardKind: "heat-check",
        },
        {
          type: SCENE_TYPES.CARD_TIMELINE,
          label: "card_what_matters",
          kicker: "WHY IT MATTERS",
          heading: "STEAM IS THE SNAPSHOT",
          bullets: ["One platform", "One launch window", "One signal to watch"],
          cardKind: "what-matters",
        },
      ]
    : [
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_impact",
          statLabel: "WHY IT MATTERS",
          sublabel: "The next detail changes the player read",
          badge: "IMPACT",
          cardKind: "impact",
        },
        {
          type: SCENE_TYPES.CARD_TIMELINE,
          label: "card_evidence",
          kicker: "SOURCE CHECK",
          heading: timelineHeadingForStory(story),
          bullets: ["Claim", "Evidence", "What remains open"],
          cardKind: "evidence",
        },
        {
          type: SCENE_TYPES.CARD_STAT,
          label: "card_watch_next",
          statLabel: "WATCH NEXT",
          sublabel: "Publisher response, dates and platform detail",
          badge: "NEXT BEAT",
          cardKind: "watch-next",
        },
      ];

  const variant = variants.find((item) => !usedLabels.has(item.label));
  if (!variant) return null;
  return {
    ...variant,
    duration: opts.duration,
    backgroundSource: opts.backdrop,
  };
}

/**
 * Build the studio slate. Returns { scenes, metrics }.
 *
 * @param {object} args
 * @param {object} args.story
 * @param {object} args.media
 *   - clips:           [{ path, durationS }, ...]
 *   - trailerFrames:   [{ path }, ...]
 *   - articleHeroes:   [{ path }, ...]
 *   - publisherAssets: [{ path }, ...]   (currently unused by renderer)
 *   - stockFillers:    [{ path }, ...]
 * @param {number} args.audioDurationS
 * @param {object} [args.opts]
 *   - takeawayText: text on the end-sting
 *   - cta:          CTA pill text
 *   - allowStockFiller: bool, default false
 * @returns {{ scenes: object[], metrics: object }}
 */
function composeStudioSlate({ story, media, audioDurationS, opts = {} }) {
  // Target stays the duration-based ideal (12-16 scenes for 60s).
  // Filler-card adjacency is now handled by the no-adjacent-
  // same-type post-pass instead of by reducing target count.
  // Reducing target count was producing fractional scene durations
  // that broke xfade negotiation in some chains.
  const flashLane = opts.flashLane === true;
  const quickCut = opts.quickCut === true;
  const sourceCardAsOverlay = flashLane && opts.sourceCardMode === "overlay";
  const clips = (media?.clips || []).slice();
  const reusableClips = clips.slice();
  const frames = removeFramesCoveredByMotionWindows(
    (media?.trailerFrames || []).slice(),
    reusableClips,
  );
  const heroes = (media?.articleHeroes || []).slice();
  const publisher = (media?.publisherAssets || []).slice();
  const stock = (media?.stockFillers || []).slice();
  const allowFlashExpansionCards = flashLane && opts.allowFlashExpansionCards === true;
  const expandScarceFlashLane =
    flashLane &&
    reusableClips.length < 4 &&
    allowFlashExpansionCards &&
    sourceCardAsOverlay &&
    Number(audioDurationS) >= 60;
  const targetCount = computeTargetSceneCount(audioDurationS, {
    flashLane: expandScarceFlashLane,
    quickCut,
  });
  const sceneDur = computeSceneDuration(audioDurationS, targetCount);
  const flashFrames = frames.filter((asset) => asset?.path);
  const flashHeroes = heroes.filter((asset) => asset?.path);
  const flashStillPool = flashLane && reusableClips.length < 6
    ? flashFrames.length >= 6
      ? flashFrames
      : interleaveAssetPools(flashFrames, flashHeroes)
    : [];
  const flashHasStillAlternatives = flashStillPool.length > 0;
  const allowFlashClipReuse =
    flashLane &&
    reusableClips.length > 0 &&
    reusableClips.length < 6 &&
    !flashHasStillAlternatives &&
    opts.allowFlashClipReuse !== false;
  let flashStillUseCount = 0;
  const cardBackdrops = [...frames, ...heroes, ...publisher, ...stock].filter(
    (asset) => asset?.path,
  );

  // Backdrops for cards: prefer trailer frames (heavily themed),
  // then rotate through verified stills instead of reusing the first
  // article hero for every card.
  const cardBackdrop = (i) => chooseCardBackdrop(cardBackdrops, i);

  const scenes = [];

  // Slot 0 â€” opener. Clip if available, else article hero with text.
  const openerClip = takeBestOpenerClip(clips);
  if (openerClip) {
    const c = openerClip;
    scenes.push({
      type: SCENE_TYPES.OPENER,
      duration: sceneDur,
      label: "opener_clip",
      source: c.path,
      isClipBacked: true,
      ...visualSceneMeta(c),
    });
  } else if (heroes[0]) {
    const h = heroes[0];
    scenes.push({
      type: SCENE_TYPES.OPENER,
      duration: sceneDur,
      label: "opener_hero",
      source: h.path,
      isClipBacked: false,
      ...visualSceneMeta(h),
    });
    heroes.shift();
  }

  // Slot 1 â€” second clip if available, else trailer frame.
  if (clips[0]) {
    scenes.push({
      type: SCENE_TYPES.CLIP,
      duration: sceneDur,
      label: "clip_post_open",
      source: clips[0].path,
      ...visualSceneMeta(clips[0]),
    });
    clips.shift();
  } else if (frames[0]) {
    scenes.push({
      type: SCENE_TYPES.CLIP_FRAME,
      duration: sceneDur,
      label: "frame_post_open",
      source: frames[0].path,
      motion: pickMotion(scenes.length),
      ...visualSceneMeta(frames[0]),
    });
    frames.shift();
  }

  // Slot 2 â€” source card.
  if (!sourceCardAsOverlay) {
    scenes.push(
      buildSourceCardScene(story, {
        duration: sceneDur,
        backdrop: cardBackdrop(0),
      }),
    );
  }

  // Middle slots â€” fill with alternating clip / trailer-frame /
  // article-hero, biased to clips. Reserve room for the quote +
  // release + takeaway scenes (3 reserved slots).
  const quoteTail = buildQuoteCardScene(story, {
    duration: sceneDur,
    backdrop: cardBackdrop(2),
  });
  const releaseTail = buildReleaseDateCardScene(story, {
    duration: sceneDur,
    backdrop: cardBackdrop(4),
  });
  const reservedTail = 1 + (quoteTail ? 1 : 0) + (releaseTail ? 1 : 0);
  const middleTarget = targetCount - scenes.length - reservedTail;

  let frameIdx = 0;
  let heroIdx = 0;
  const minFlashClipScenes = flashLane
    ? Math.min(
        Math.ceil(targetCount * 0.65),
        allowFlashClipReuse
          ? reusableClips.length * MAX_FLASH_REUSE_PER_CLIP
          : reusableClips.length,
      )
    : 0;
  const flashClipReuseBudget = flashLane
    ? allowFlashClipReuse
      ? reusableClips.length * MAX_FLASH_REUSE_PER_CLIP
      : reusableClips.length
    : Number.POSITIVE_INFINITY;
  let reusableClipUseCount = actualClipSceneCount(scenes);
  const flashStillRepeatCap = flashLane
    ? Math.max(1, Math.floor(Number(opts.flashStillRepeatCap) || 1))
    : 2;
  const allowSteamContextCard = !flashLane || Number(audioDurationS) >= 60;

  for (let i = 0; i < middleTarget; i++) {
    if (
      flashLane &&
      reusableClips.length > 0 &&
      actualClipSceneCount(scenes) < minFlashClipScenes &&
      actualClipSceneCount(scenes) < flashClipReuseBudget
    ) {
      let c = clips.shift();
      if (c) reusableClipUseCount += 1;
      else if (allowFlashClipReuse) c = reusableClipVariant(reusableClips, reusableClipUseCount++);
      if (!c) continue;
      const flashType = flashLaneClipType(i);
      scenes.push({
        type: flashType,
        duration: sceneDur,
        label: `flash_clip_${i}`,
        source: c.path,
        caption:
          flashType === SCENE_TYPES.FREEZE_FRAME
            ? flashLaneFreezeCaption(story)
            : null,
        envelope:
          flashType === SCENE_TYPES.SPEED_RAMP
            ? (i % 2 === 0 ? "fast-out" : "slow-in")
            : null,
        ...visualSceneMeta(c),
      });
      continue;
    }

    if (
      flashLane &&
      flashStillPool.length > 0 &&
      flashStillUseCount < flashStillPool.length * flashStillRepeatCap
    ) {
      const f = flashStillPool[flashStillUseCount % flashStillPool.length];
      flashStillUseCount += 1;
      const type =
        f.kind === "trailer-frame" ||
        /(?:official_)?trailer[_ -]?frame|steam_trailer_frame/i.test(
          String(f.sourceType || f.source_type || ""),
        )
          ? SCENE_TYPES.CLIP_FRAME
          : SCENE_TYPES.STILL;
      scenes.push({
        type,
        duration: sceneDur,
        label: `flash_visual_${i}`,
        source: f.path,
        motion: pickMotion(scenes.length),
        ...visualSceneMeta(f),
      });
      continue;
    }

    if (flashLane) {
      const sub = pickFillerScene(scenes, story, sceneDur, cardBackdrop, i, {
        sourceCardAsOverlay,
        flashLane,
        allowFlashExpansionCards,
        allowSteamContextCard,
      });
      if (sub) scenes.push(sub);
      continue;
    }

    // Alternation pattern: clip every 4th slot when available;
    // trailer-frame on most slots; article-hero sparingly.
    const wantClip = clips.length > 0 && i % 4 === 2;
    const wantHero = heroes.length > heroIdx && i % 6 === 5;
    if (wantClip) {
      const c = clips.shift();
      scenes.push({
        type: SCENE_TYPES.CLIP,
        duration: sceneDur,
        label: `clip_mid_${i}`,
        source: c.path,
        ...visualSceneMeta(c),
      });
    } else if (wantHero) {
      const h = heroes[heroIdx++];
      scenes.push({
        type: SCENE_TYPES.STILL,
        duration: sceneDur,
        label: `hero_mid_${i}`,
        source: h.path,
        motion: pickMotion(scenes.length),
        ...visualSceneMeta(h),
      });
    } else if (frames[frameIdx]) {
      const f = frames[frameIdx++];
      scenes.push({
        type: SCENE_TYPES.CLIP_FRAME,
        duration: sceneDur,
        label: `frame_mid_${i}`,
        source: f.path,
        motion: pickMotion(scenes.length),
        ...visualSceneMeta(f),
      });
    } else if (!flashLane && heroes[heroIdx]) {
      const h = heroes[heroIdx++];
      scenes.push({
        type: SCENE_TYPES.STILL,
        duration: sceneDur,
        label: `hero_fallback_${i}`,
        source: h.path,
        motion: pickMotion(scenes.length),
        ...visualSceneMeta(h),
      });
    } else if (opts.allowStockFiller && stock.length > 0) {
      const s = stock.shift();
      scenes.push({
        type: SCENE_TYPES.STILL,
        duration: sceneDur,
        label: `stock_${i}`,
        source: s.path,
        motion: pickMotion(scenes.length),
        _stock: true,
        ...visualSceneMeta(s),
      });
    } else {
      // Out of fresh media. Use each fallback card kind once, then
      // skip the remaining slots instead of padding with repeat cards.
      const sub = pickFillerScene(scenes, story, sceneDur, cardBackdrop, i, {
        sourceCardAsOverlay,
        flashLane,
        allowFlashExpansionCards,
        allowSteamContextCard,
      });
      if (sub) {
        scenes.push(sub);
      } else {
        continue;
      }
    }
  }

  // Reserved tail: quote + release + takeaway.
  if (quoteTail) scenes.push(quoteTail);
  if (releaseTail) scenes.push(releaseTail);

  scenes.push(
    buildTakeawayCardScene(story, {
      duration: sceneDur,
      backdrop: cardBackdrop(5),
      takeawayText: opts.takeawayText,
      cta: opts.cta,
    }),
  );

  if (flashLane && !sourceCardAsOverlay) deferFlashSourceCardAfterHook(scenes);

  // Anti-repetition pass: walk scenes; if a still source has been
  // used >= 2 times already, substitute a card the slate hasn't
  // used yet (or fall back to a release-date card which is the
  // safest non-duplicate).
  const stillCounts = new Map();
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!STILL_TYPES.has(s.type)) continue;
    const id = sourceId(s);
    const count = (stillCounts.get(id) || 0) + 1;
    stillCounts.set(id, count);
    if (count > flashStillRepeatCap) {
      const sub = pickFillerScene(scenes, story, s.duration, cardBackdrop, i, {
        sourceCardAsOverlay,
        flashLane,
        allowFlashExpansionCards,
        allowSteamContextCard,
      });
      if (sub) {
        sub._substitutedFrom = s.label;
        scenes[i] = sub;
      }
    }
  }

  // No-adjacent-repeat pass: swap an adjacent identical-source pair
  // with the next non-conflicting scene. One pass is enough for a
  // 12â€“16 element list.
  for (let i = 1; i < scenes.length; i++) {
    if (sourceId(scenes[i]) === sourceId(scenes[i - 1])) {
      if (CARD_TYPES.has(scenes[i]?.type) && scenes[i].backgroundSource) {
        const replacement = chooseCardBackdrop(
          cardBackdrops,
          i + 1,
          new Set([sourceId(scenes[i - 1]), sourceId(scenes[i + 1])]),
        );
        if (replacement && backdropSourceId(replacement) !== sourceId(scenes[i])) {
          scenes[i].backgroundSource = replacement;
          continue;
        }
      }
      // find swap target after i
      for (let j = i + 1; j < scenes.length; j++) {
        if (
          sourceId(scenes[j]) !== sourceId(scenes[i - 1]) &&
          (j + 1 >= scenes.length ||
            sourceId(scenes[i]) !== sourceId(scenes[j + 1]))
        ) {
          const tmp = scenes[i];
          scenes[i] = scenes[j];
          scenes[j] = tmp;
          break;
        }
      }
    }
  }

  ensureTakeawayTail(scenes);
  repairCardBackdropAdjacency(scenes, cardBackdrops);
  repairCardBackdropReuse(scenes, cardBackdrops);

  // No-adjacent-same-TYPE pass: even if source IDs differ, two
  // consecutive scenes of the same type (e.g. card.source then
  // card.source again) reads as a slate bug. Walk the list; if
  // adjacent types match, swap with the nearest non-conflicting
  // scene later in the slate. One linear pass.
  for (let i = 1; i < scenes.length; i++) {
    if (
      scenes[i].type === scenes[i - 1].type &&
      CARD_TYPES.has(scenes[i].type)
    ) {
      for (let j = i + 1; j < scenes.length; j++) {
        const wouldConflict =
          scenes[j].type === scenes[i - 1].type ||
          (j + 1 < scenes.length && scenes[i].type === scenes[j + 1].type);
        if (!wouldConflict) {
          const tmp = scenes[i];
          scenes[i] = scenes[j];
          scenes[j] = tmp;
          break;
        }
      }
    }
  }

  const finalSceneDur = computeSceneDuration(audioDurationS, scenes.length);
  for (const scene of scenes) {
    scene.duration = finalSceneDur;
    if (flashLane && CARD_TYPES.has(scene.type)) {
      scene.cardTreatment = "flash_lane";
    }
  }

  // Compute metrics.
  const metrics = computeMetrics(scenes);

  return { scenes, metrics };
}

function computeMetrics(scenes) {
  const m = {
    totalScenes: scenes.length,
    clipCount: 0,
    trailerFrameCount: 0,
    articleHeroCount: 0,
    cardCount: 0,
    stockFillerCount: 0,
    uniqueStillSources: 0,
    repeatedStillScenes: 0,
    isSlideshow: false,
  };
  const seen = new Map();
  for (const s of scenes) {
    if (
      s.type === "clip" ||
      s.type === SCENE_TYPES.PUNCH ||
      s.type === SCENE_TYPES.SPEED_RAMP ||
      s.type === SCENE_TYPES.FREEZE_FRAME
    ) m.clipCount++;
    else if (s.type === "clip.frame") m.trailerFrameCount++;
    else if (s.type === "still") m.articleHeroCount++;
    else if (s.type === "opener" && s.isClipBacked) m.clipCount++;
    else if (s.type === "opener") m.articleHeroCount++;
    else if (CARD_TYPES.has(s.type)) m.cardCount++;
    if (s._stock) m.stockFillerCount++;
    if (STILL_TYPES.has(s.type)) {
      const id = sourceId(s);
      const c = (seen.get(id) || 0) + 1;
      seen.set(id, c);
    }
  }
  m.uniqueStillSources = seen.size;
  for (const c of seen.values()) {
    if (c > 1) m.repeatedStillScenes += c - 1;
  }
  // Slideshow heuristic: if clips < 2 OR (cards < 2 AND repeats > 30%)
  const stillTotal = m.trailerFrameCount + m.articleHeroCount;
  const repeatRatio = stillTotal > 0 ? m.repeatedStillScenes / stillTotal : 0;
  m.isSlideshow = m.clipCount < 2 || (m.cardCount < 2 && repeatRatio > 0.3);
  return m;
}

module.exports = {
  composeStudioSlate,
  computeTargetSceneCount,
  computeSceneDuration,
  computeMetrics,
  sourceId,
  SCENE_TYPES,
  STILL_TYPES,
  CARD_TYPES,
};
