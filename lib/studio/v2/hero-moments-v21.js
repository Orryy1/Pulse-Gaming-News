"use strict";

const path = require("node:path");

function round(value, digits = 3) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function sceneType(scene) {
  return scene?.type || scene?.sceneType || "unknown";
}

function buildSceneTimeline(scenes = [], transitions = []) {
  return scenes.map((scene, index) => {
    const startS =
      index === 0
        ? 0
        : Number(transitions[index - 1]?.offset ?? 0);
    const durationS = Number(scene?.duration || 0);
    return {
      index,
      type: sceneType(scene),
      label: scene?.label || sceneType(scene),
      startS: round(startS, 3),
      endS: round(startS + durationS, 3),
      durationS: round(durationS, 3),
      scene,
    };
  });
}

function isHyperFramesScene(scene) {
  return Boolean(scene?.prerenderedMp4 || scene?.premiumLane === "hyperframes");
}

function basename(value) {
  return value ? path.basename(String(value)) : null;
}

function momentFromScene({
  id,
  type,
  timelineEntry,
  editorialReason,
  visualTreatment,
  riskNotes,
  expectedImpact,
  overlayKind,
  pulseDurationS,
}) {
  const scene = timelineEntry.scene;
  return {
    id,
    type,
    sceneIndex: timelineEntry.index,
    sceneType: timelineEntry.type,
    sceneLabel: timelineEntry.label,
    targetTimestampS: timelineEntry.startS,
    targetEndS: timelineEntry.endS,
    durationS: timelineEntry.durationS,
    editorialReason,
    visualTreatment,
    hyperframesUsed: isHyperFramesScene(scene),
    hyperframesAsset: basename(scene?.prerenderedMp4),
    riskNotes,
    expectedImpact,
    overlayKind,
    pulseDurationS,
  };
}

function firstTimelineEntry(timeline, predicate) {
  return timeline.find((entry) => predicate(entry.scene, entry));
}

function planHeroMomentsV21({
  story,
  scenes = [],
  transitions = [],
  maxMoments = 3,
} = {}) {
  const timeline = buildSceneTimeline(scenes, transitions);
  const candidates = [];

  const source = firstTimelineEntry(
    timeline,
    (scene) => sceneType(scene) === "card.source",
  );
  if (source) {
    candidates.push(
      momentFromScene({
        id: "hero_source_slam",
        type: "source_slam",
        timelineEntry: source,
        editorialReason:
          "The story depends on source credibility, so the source card gets a deliberate confirmation beat.",
        visualTreatment:
          "Short amber edge slam over the existing HyperFrames source card.",
        riskNotes:
          "No new scene, no audio cue and no media-source change, so source diversity and audio recurrence should remain stable.",
        expectedImpact:
          "Makes the first credibility beat feel more intentional without adding clutter.",
        overlayKind: "edge-slam",
        pulseDurationS: 0.36,
      }),
    );
  }

  const context = firstTimelineEntry(
    timeline,
    (scene) => sceneType(scene) === "card.timeline" || sceneType(scene) === "card.stat",
  );
  if (context) {
    candidates.push(
      momentFromScene({
        id: "hero_context_reframe",
        type: "context_reframe",
        timelineEntry: context,
        editorialReason:
          "The middle of the short needs a clean reframe, not another still cycle.",
        visualTreatment:
          "Restrained amber bracket pulse over the context card.",
        riskNotes:
          "Uses an existing card scene and keeps subtitles in their normal safe area.",
        expectedImpact:
          "Signals that the video has moved from reveal to interpretation.",
        overlayKind: "reframe-bracket",
        pulseDurationS: 0.62,
      }),
    );
  }

  const quote = firstTimelineEntry(
    timeline,
    (scene) => sceneType(scene) === "card.quote",
  );
  if (quote && candidates.length < maxMoments) {
    candidates.push(
      momentFromScene({
        id: "hero_quote_impact",
        type: "quote_impact",
        timelineEntry: quote,
        editorialReason:
          "The quote card is where viewer sentiment lands, so it can carry one impact accent.",
        visualTreatment:
          "Single amber edge hold at quote entry, keeping the quote itself readable.",
        riskNotes:
          "No extra text and no sound punctuation, avoiding the failed shutter-flash problem.",
        expectedImpact:
          "Gives the quote a clearer arrival without changing the card copy.",
        overlayKind: "edge-hold",
        pulseDurationS: 0.48,
      }),
    );
  }

  const endLock = firstTimelineEntry(
    timeline,
    (scene) => sceneType(scene) === "card.takeaway",
  );
  if (endLock && candidates.length < maxMoments) {
    candidates.push(
      momentFromScene({
        id: "hero_end_lock",
        type: "end_lock",
        timelineEntry: endLock,
        editorialReason:
          "The final CTA should feel like a locked ending, not a drift out.",
        visualTreatment:
          "Closing amber border pulse on the existing takeaway card.",
        riskNotes:
          "Edge-only overlay keeps captions and card text unobstructed.",
        expectedImpact:
          "Adds a more deliberate final beat and brand finish.",
        overlayKind: "closing-lock",
        pulseDurationS: 0.55,
      }),
    );
  }

  const moments = candidates.slice(0, maxMoments);
  return {
    schemaVersion: 1,
    storyId: story?.id || null,
    generatedAt: new Date().toISOString(),
    maxMoments,
    momentCount: moments.length,
    moments,
    skippedCandidateCount: Math.max(0, candidates.length - moments.length),
    notes:
      moments.length === 0
        ? ["No fitting hero moments found in the scene slate."]
        : [
            "Hero moments are sparse and overlay existing strong beats.",
            "No additional clip/still source is consumed.",
            "No extra SFX is introduced.",
          ],
  };
}

function enableExpr(startS, endS) {
  return `enable='between(t\\,${round(startS, 2).toFixed(2)}\\,${round(
    endS,
    2,
  ).toFixed(2)})'`;
}

function edgeDrawboxes({ startS, endS, color, thickness }) {
  const enable = enableExpr(startS, endS);
  return [
    `drawbox=x=0:y=0:w=iw:h=${thickness}:color=${color}:t=fill:${enable}`,
    `drawbox=x=0:y=ih-${thickness}:w=iw:h=${thickness}:color=${color}:t=fill:${enable}`,
    `drawbox=x=0:y=0:w=${thickness}:h=ih:color=${color}:t=fill:${enable}`,
    `drawbox=x=iw-${thickness}:y=0:w=${thickness}:h=ih:color=${color}:t=fill:${enable}`,
  ];
}

function bracketDrawboxes({ startS, endS, color, thickness }) {
  const enable = enableExpr(startS, endS);
  return [
    `drawbox=x=68:y=142:w=944:h=${thickness}:color=${color}:t=fill:${enable}`,
    `drawbox=x=68:y=188:w=312:h=${thickness}:color=${color}:t=fill:${enable}`,
    `drawbox=x=700:y=188:w=312:h=${thickness}:color=${color}:t=fill:${enable}`,
  ];
}

function buildHeroMomentOverlayFilter({
  inputLabel = "base",
  outputLabel = "heroBase",
  plan,
  accentColor = "0xFF6B1A@0.72",
} = {}) {
  const moments = (plan?.moments || []).filter(
    (moment) =>
      Number.isFinite(Number(moment.targetTimestampS)) &&
      Number(moment.pulseDurationS) > 0,
  );
  if (!moments.length) return null;

  const filters = [];
  for (const moment of moments) {
    const startS = Number(moment.targetTimestampS);
    const endS = startS + Number(moment.pulseDurationS);
    if (moment.overlayKind === "reframe-bracket") {
      filters.push(
        ...bracketDrawboxes({
          startS,
          endS,
          color: accentColor,
          thickness: 6,
        }),
      );
    } else {
      filters.push(
        ...edgeDrawboxes({
          startS,
          endS,
          color: accentColor,
          thickness: moment.overlayKind === "closing-lock" ? 9 : 8,
        }),
      );
    }
  }
  return `[${inputLabel}]${filters.join(",")}[${outputLabel}]`;
}

module.exports = {
  buildSceneTimeline,
  planHeroMomentsV21,
  buildHeroMomentOverlayFilter,
};
