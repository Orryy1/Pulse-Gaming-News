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
    Math.min(8.0, (audioDurationS + overlap + 0.4) / sceneCount),
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
  };
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

/**
 * Decide whether to insert a card.source for this story. Always
 * insert if we know the source — providing context is part of the
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
  if (String(story?.source_type || "").toLowerCase() === "reddit") return true;
  return Array.isArray(story?.reddit_comments) && story.reddit_comments.length > 0;
}

function shouldUseKnownUnknownReleaseCard(story) {
  const text = [
    story?.title,
    story?.hook,
    story?.body,
    story?.classification,
    story?.content_pillar,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/\bpassed on\b|\bkilled\b|\blegacy franchise\b/.test(text)) return false;
  return /\b(release|launch|trailer|debut|coming|announced|date|showcase|direct)\b/.test(text);
}

/**
 * Pick a filler card scene for a middle slot. Constraints:
 *   - Cannot use quote/release/takeaway — those are reservedTail
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
  if (!scenes.some((s) => s.label === "card_context")) {
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
    return buildKnownUnknownCardScene(story, {
      duration,
      backdrop: cardBackdrop(idx),
    });
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
  return {
    type: SCENE_TYPES.CARD_STAT,
    duration: opts.duration,
    label: "card_context",
    backgroundSource: opts.backdrop,
    statLabel: "WHY IT MATTERS",
    sublabel:
      story?.classification === "Rumour"
        ? "Treat this as unconfirmed until official sources land"
        : "This changes how players read the next update",
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
    heading: String(story?.title || "STORY")
      .split(/\s+[-–—:|]\s+/)[0]
      .toUpperCase()
      .slice(0, 22),
    bullets: [
      "Source report is live",
      "Player access is the shift",
      "Follow-up details still matter",
    ],
    cardKind: "timeline",
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
  const targetCount = computeTargetSceneCount(audioDurationS);
  const sceneDur = computeSceneDuration(audioDurationS, targetCount);

  const flashLane = opts.flashLane === true;
  const sourceCardAsOverlay = flashLane && opts.sourceCardMode === "overlay";
  const clips = (media?.clips || []).slice();
  const reusableClips = clips.slice();
  const frames = (media?.trailerFrames || []).slice();
  const heroes = (media?.articleHeroes || []).slice();
  const publisher = (media?.publisherAssets || []).slice();
  const stock = (media?.stockFillers || []).slice();
  const cardBackdrops = [...frames, ...heroes, ...publisher, ...stock].filter(
    (asset) => asset?.path,
  );

  // Backdrops for cards: prefer trailer frames (heavily themed),
  // then rotate through verified stills instead of reusing the first
  // article hero for every card.
  const cardBackdrop = (i) =>
    (cardBackdrops[i % Math.max(1, cardBackdrops.length)] || null)?.path || null;

  const scenes = [];

  // Slot 0 — opener. Clip if available, else article hero with text.
  if (clips[0]) {
    const c = clips[0];
    scenes.push({
      type: SCENE_TYPES.OPENER,
      duration: sceneDur,
      label: "opener_clip",
      source: c.path,
      isClipBacked: true,
      ...visualSceneMeta(c),
    });
    clips.shift();
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

  // Slot 1 — second clip if available, else trailer frame.
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

  // Slot 2 — source card.
  if (!sourceCardAsOverlay) {
    scenes.push(
      buildSourceCardScene(story, {
        duration: sceneDur,
        backdrop: cardBackdrop(0),
      }),
    );
  }

  // Middle slots — fill with alternating clip / trailer-frame /
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
    ? Math.min(Math.ceil(targetCount * 0.65), reusableClips.length)
    : 0;
  const flashClipReuseBudget = flashLane
    ? reusableClips.length * MAX_FLASH_REUSE_PER_CLIP
    : Number.POSITIVE_INFINITY;
  let reusableClipUseCount = actualClipSceneCount(scenes);

  for (let i = 0; i < middleTarget; i++) {
    if (
      flashLane &&
      reusableClips.length > 0 &&
      actualClipSceneCount(scenes) < minFlashClipScenes &&
      actualClipSceneCount(scenes) < flashClipReuseBudget
    ) {
      const c = reusableClipVariant(reusableClips, reusableClipUseCount++);
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

    // Alternation pattern: clip every 4th slot when available;
    // trailer-frame on most slots; article-hero sparingly.
    const wantClip = !flashLane && clips.length > 0 && i % 4 === 2;
    const wantHero = !flashLane && heroes.length > heroIdx && i % 6 === 5;
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
    if (count > 2) {
      const sub = pickFillerScene(scenes, story, s.duration, cardBackdrop, i, {
        sourceCardAsOverlay,
      });
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
