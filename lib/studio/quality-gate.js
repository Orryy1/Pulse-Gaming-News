"use strict";

const { CARD_TYPES, STILL_TYPES, sourceId } = require("../scene-composer");

function countByType(scenes) {
  const counts = {};
  for (const scene of scenes || []) {
    counts[scene.type] = (counts[scene.type] || 0) + 1;
  }
  return counts;
}

function sourceRepeatStats(scenes) {
  const seen = new Map();
  for (const scene of scenes || []) {
    if (!STILL_TYPES.has(scene.type)) continue;
    const id = sourceId(scene);
    seen.set(id, (seen.get(id) || 0) + 1);
  }
  let repeatedStillCount = 0;
  let maxRepeat = 0;
  for (const count of seen.values()) {
    maxRepeat = Math.max(maxRepeat, count);
    if (count > 1) repeatedStillCount += count - 1;
  }
  return {
    uniqueStillCount: seen.size,
    repeatedStillCount,
    maxStillRepeat: maxRepeat,
  };
}

function sceneMixStats(scenes) {
  let clipCount = 0;
  let stillCount = 0;
  let cardCount = 0;
  let stockFillerCount = 0;
  for (const scene of scenes || []) {
    if (scene.type === "clip" || (scene.type === "opener" && scene.isClipBacked)) {
      clipCount++;
    } else if (STILL_TYPES.has(scene.type) || scene.type === "still") {
      stillCount++;
    } else if (CARD_TYPES.has(scene.type) || /^card\./.test(scene.type)) {
      cardCount++;
    }
    if (scene._stock) stockFillerCount++;
  }
  return { clipCount, stillCount, cardCount, stockFillerCount };
}

function buildQualityReport({
  storyId,
  branch,
  output,
  scenes,
  editorial,
  mediaDiversity,
  voice,
  subtitles,
  premiumLane,
}) {
  const sceneCount = scenes.length;
  const mix = sceneMixStats(scenes);
  const repeats = sourceRepeatStats(scenes);
  const typeCounts = countByType(scenes);
  const sceneTypeDiversity = Object.keys(typeCounts).length;
  const clipCardRatio = sceneCount
    ? (mix.clipCount + mix.cardCount) / sceneCount
    : 0;
  const sourceMixScore = mediaDiversity?.sourceMixScore ?? 0;
  const slideshowRisk =
    mix.clipCount < 3 ||
    clipCardRatio < 0.45 ||
    repeats.maxStillRepeat > 2 ||
    mix.stockFillerCount > 0;

  const premiumPass =
    premiumLane?.verdict === "pass" && premiumLane.hyperframesCardCount >= 2;

  const staleVoiceWarning =
    !voice?.source || /legacy|wrong|stale/i.test(voice.source) || voice.warning;

  return {
    storyId,
    branch,
    generatedAt: new Date().toISOString(),
    output,
    runtime: output?.durationS ?? null,
    sceneCount,
    clipCount: mix.clipCount,
    stillCount: mix.stillCount,
    cardCount: mix.cardCount,
    uniqueStillCount: repeats.uniqueStillCount,
    repeatedStillCount: repeats.repeatedStillCount,
    stockFillerCount: mix.stockFillerCount,
    voiceSourceUsed: voice?.source || "unknown",
    voiceWarning: staleVoiceWarning ? voice?.warning || "voice source needs review" : null,
    subtitleAlignmentStatus: subtitles?.status || "unknown",
    slideshowLikeVerdict: slideshowRisk ? "risk" : "not-slideshow-like",
    premiumLaneVerdict: premiumPass ? "pass" : "partial",
    automaticScores: {
      hookPass: !!editorial?.hookScore?.pass,
      hookWordCount: editorial?.hookScore?.wordCount ?? null,
      spokenWordCount: editorial?.wordCount ?? null,
      sourceMixScore,
      clipCardRatio: Number(clipCardRatio.toFixed(2)),
      sceneTypeDiversity,
      subtitleBlackoutRisk: !!subtitles?.inspection?.blackoutRisk,
      maxStillRepeat: repeats.maxStillRepeat,
    },
    typeCounts,
    mediaDiversity,
    editorial,
    voice,
    subtitles,
    premiumLane,
  };
}

module.exports = {
  buildQualityReport,
  sceneMixStats,
  sourceRepeatStats,
  countByType,
};
