/**
 * lib/scene-composer.js — Studio Short Engine composer.
 *
 * Takes a media inventory + story metadata + audio duration and
 * produces a typed scene list. The renderer (tools/quality-prototype.js)
 * walks this list and dispatches per-scene-type filter generators.
 *
 * The composer is opinionated:
 *   - Slot 0 is always the opener (clip-backed if a clip exists, else
 *     a designed title card on top of the article hero).
 *   - One card.source goes between slots 1–3.
 *   - card.quote is inserted near 50% if a top_comment exists.
 *   - card.release is inserted near 75% if release metadata exists.
 *   - Last slot is always card.takeaway.
 *   - Remaining slots alternate clip / trailer-frame / article-hero,
 *     biased toward clips when available.
 *
 * Anti-repetition is enforced AFTER allocation:
 *   - No still rendered more than 2× per video. Substitutes a card
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

const SCENE_TYPES = {
  OPENER: "opener",
  CLIP: "clip",
  STILL: "still",
  CLIP_FRAME: "clip.frame", // a still extracted from a trailer
  CARD_SOURCE: "card.source",
  CARD_RELEASE: "card.release",
  CARD_QUOTE: "card.quote",
  CARD_STAT: "card.stat",
  CARD_TAKEAWAY: "card.takeaway",
};

const STILL_TYPES = new Set([SCENE_TYPES.STILL, SCENE_TYPES.CLIP_FRAME]);

const CARD_TYPES = new Set([
  SCENE_TYPES.OPENER, // when synthesised, opener is card-like
  SCENE_TYPES.CARD_SOURCE,
  SCENE_TYPES.CARD_RELEASE,
  SCENE_TYPES.CARD_QUOTE,
  SCENE_TYPES.CARD_STAT,
  SCENE_TYPES.CARD_TAKEAWAY,
]);

/**
 * Compute the target scene count from audio duration.
 * Studio shorts run 12–16 cuts in 60s for a fast-paced feel. With
 * average 4s per scene at 60s of audio that's 15 scenes. Cap at 16
 * to keep edit complexity manageable, floor at 12 to ensure pace.
 */
function computeTargetSceneCount(audioDurationS) {
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
    Math.min(6.0, (audioDurationS + overlap + 0.4) / sceneCount),
  );
}

/**
 * Return a stable identifier for a scene's "source identity" — used
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

/**
 * Decide whether to insert a card.source for this story. Always
 * insert if we know the source — providing context is part of the
 * studio voice.
 */
function buildSourceCardScene(story, opts) {
  const subreddit = story?.subreddit ? `r/${story.subreddit}` : null;
  const publisher = story?.source_type;
  const label = subreddit || (publisher ? publisher.toUpperCase() : "NEWS");
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
  // placeholder when the model has nothing concrete.
  const date =
    story?.release_date || story?.launch_date || story?._release || null;
  return {
    type: SCENE_TYPES.CARD_RELEASE,
    duration: opts.duration,
    label: "card_release",
    backgroundSource: opts.backdrop,
    dateLabel: date || "TBA",
    kicker: date ? "RELEASE DATE" : "RELEASE WINDOW",
    sublabel: date ? "" : "UNCONFIRMED",
  };
}

function buildQuoteCardScene(story, opts) {
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

/**
 * Pick a filler card scene for a middle slot, knowing the
 * reservedTail will later add quote + release + takeaway. To avoid
 * duplicating any of those, the middle-loop filler ONLY uses
 * card.source — that's the only type the tail won't also produce.
 *
 * If the slate already has a card.source (the slot-2 reveal), we
 * STILL emit another source-card rather than create a duplicate
 * with a tail-reserved type. A second source-card with a different
 * backdrop reads as "another reveal beat" and is far less jarring
 * than the slate showing two consecutive quote scenes.
 */
function pickFillerScene(scenes, story, duration, cardBackdrop, idx) {
  return buildSourceCardScene(story, {
    duration,
    backdrop: cardBackdrop(idx),
  });
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
  const targetCount = computeTargetSceneCount(audioDurationS);
  const sceneDur = computeSceneDuration(audioDurationS, targetCount);

  const clips = (media?.clips || []).slice();
  const frames = (media?.trailerFrames || []).slice();
  const heroes = (media?.articleHeroes || []).slice();
  const publisher = (media?.publisherAssets || []).slice();
  const stock = (media?.stockFillers || []).slice();

  // Backdrops for cards: prefer trailer frames (heavily themed),
  // fall back to article hero.
  const cardBackdrop = (i) =>
    (frames[i % Math.max(1, frames.length)] || heroes[0] || stock[0])?.path ||
    null;

  const scenes = [];

  // Slot 0 — opener. Clip if available, else article hero with text.
  if (clips[0]) {
    scenes.push({
      type: SCENE_TYPES.OPENER,
      duration: sceneDur,
      label: "opener_clip",
      source: clips[0].path,
      isClipBacked: true,
    });
    clips.shift();
  } else if (heroes[0]) {
    scenes.push({
      type: SCENE_TYPES.OPENER,
      duration: sceneDur,
      label: "opener_hero",
      source: heroes[0].path,
      isClipBacked: false,
    });
    heroes.shift();
  }

  // Slot 1 — second clip if available, else trailer frame.
  if (clips[0]) {
    scenes.push({
      type: SCENE_TYPES.CLIP,
      duration: sceneDur,
      label: "clip_post_open",
      source: clips[0].path,
    });
    clips.shift();
  } else if (frames[0]) {
    scenes.push({
      type: SCENE_TYPES.CLIP_FRAME,
      duration: sceneDur,
      label: "frame_post_open",
      source: frames[0].path,
      motion: pickMotion(scenes.length),
    });
    frames.shift();
  }

  // Slot 2 — source card.
  scenes.push(
    buildSourceCardScene(story, {
      duration: sceneDur,
      backdrop: cardBackdrop(0),
    }),
  );

  // Middle slots — fill with alternating clip / trailer-frame /
  // article-hero, biased to clips. Reserve room for the quote +
  // release + takeaway scenes (3 reserved slots).
  const reservedTail = 3;
  const middleTarget = targetCount - scenes.length - reservedTail;

  let frameIdx = 0;
  let heroIdx = 0;

  for (let i = 0; i < middleTarget; i++) {
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
      });
    } else if (wantHero) {
      const h = heroes[heroIdx++];
      scenes.push({
        type: SCENE_TYPES.STILL,
        duration: sceneDur,
        label: `hero_mid_${i}`,
        source: h.path,
        motion: pickMotion(scenes.length),
      });
    } else if (frames[frameIdx]) {
      scenes.push({
        type: SCENE_TYPES.CLIP_FRAME,
        duration: sceneDur,
        label: `frame_mid_${i}`,
        source: frames[frameIdx++].path,
        motion: pickMotion(scenes.length),
      });
    } else if (heroes[heroIdx]) {
      const h = heroes[heroIdx++];
      scenes.push({
        type: SCENE_TYPES.STILL,
        duration: sceneDur,
        label: `hero_fallback_${i}`,
        source: h.path,
        motion: pickMotion(scenes.length),
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
      });
    } else {
      // Out of media — substitute another card to avoid repetition.
      // Avoid duplicating the reservedTail card types (quote / release /
      // takeaway). Only use card types that haven't already appeared in
      // the slate; if every type is used, fall through to a clip.frame
      // re-use rather than producing a duplicate card.
      const sub = pickFillerScene(scenes, story, sceneDur, cardBackdrop, i);
      if (sub) scenes.push(sub);
    }
  }

  // Reserved tail: quote + release + takeaway.
  const quote = buildQuoteCardScene(story, {
    duration: sceneDur,
    backdrop: cardBackdrop(2),
  });
  if (quote) scenes.push(quote);

  scenes.push(
    buildReleaseDateCardScene(story, {
      duration: sceneDur,
      backdrop: cardBackdrop(4),
    }),
  );

  scenes.push(
    buildTakeawayCardScene(story, {
      duration: sceneDur,
      backdrop: cardBackdrop(5),
      takeawayText: opts.takeawayText,
      cta: opts.cta,
    }),
  );

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
    if (count > 2) {
      const sub = pickFillerScene(scenes, story, s.duration, cardBackdrop, i);
      if (sub) {
        sub._substitutedFrom = s.label;
        scenes[i] = sub;
      }
    }
  }

  // No-adjacent-repeat pass: swap an adjacent identical-source pair
  // with the next non-conflicting scene. One pass is enough for a
  // 12–16 element list.
  for (let i = 1; i < scenes.length; i++) {
    if (sourceId(scenes[i]) === sourceId(scenes[i - 1])) {
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
    if (s.type === "clip") m.clipCount++;
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
