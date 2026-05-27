"use strict";

const { SCENE_TYPES } = require("../../scene-composer");
const { safeClipRenderDuration } = require("../ffmpeg-scene-renderer");

function numeric(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumSceneDurations(scenes) {
  return (Array.isArray(scenes) ? scenes : []).reduce(
    (sum, scene) => sum + (numeric(scene?.duration) || 0),
    0,
  );
}

function isFlexibleVisualScene(scene) {
  const type = String(scene?.type || scene?.sceneType || "");
  return (
    type === SCENE_TYPES.STILL ||
    type === SCENE_TYPES.CLIP_FRAME ||
    type.startsWith("card.")
  );
}

function capClipFreezeRiskDurations(scenes) {
  let adjusted = false;
  const cappedScenes = [];
  const nextScenes = (Array.isArray(scenes) ? scenes : []).map((scene, index) => {
    const duration = numeric(scene?.duration);
    if (duration === null || duration <= 0) return scene;
    const safeDuration = safeClipRenderDuration(scene, duration);
    if (!Number.isFinite(safeDuration) || safeDuration >= duration - 0.01) return scene;
    adjusted = true;
    cappedScenes.push({
      index,
      label: scene.label || null,
      type: scene.type || scene.sceneType || null,
      fromS: Number(duration.toFixed(3)),
      toS: Number(safeDuration.toFixed(3)),
    });
    return {
      ...scene,
      duration: Number(safeDuration.toFixed(3)),
      clipDurationCapped: true,
      clipDurationCapReason: "prevent_visible_tpad_freeze",
    };
  });

  return { scenes: nextScenes, adjusted, cappedScenes };
}

function redistributeDurationToFlexibleScenes(scenes, targetDurationS, opts = {}) {
  const target = numeric(targetDurationS);
  if (target === null || target <= 0) {
    return { scenes, adjusted: false, redistributedS: 0 };
  }

  const current = sumSceneDurations(scenes);
  let remaining = target - current;
  if (remaining <= 0.04) {
    return { scenes, adjusted: false, redistributedS: 0 };
  }

  const maxFlexibleDurationS = Math.max(3, Number(opts.maxFlexibleDurationS || 6.2));
  const nextScenes = scenes.map((scene) => ({ ...scene }));
  const flexible = nextScenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => isFlexibleVisualScene(scene));
  if (!flexible.length) {
    return { scenes: nextScenes, adjusted: false, redistributedS: 0 };
  }

  let distributed = 0;
  for (let i = 0; i < flexible.length && remaining > 0.04; i++) {
    const { scene } = flexible[i];
    const duration = numeric(scene.duration) || 0;
    const evenShare = remaining / (flexible.length - i);
    const capacity = Math.max(0, maxFlexibleDurationS - duration);
    const add = Math.min(evenShare, capacity || evenShare);
    if (add <= 0) continue;
    scene.duration = Number((duration + add).toFixed(3));
    distributed += add;
    remaining -= add;
  }

  if (remaining > 0.04) {
    const tail = flexible[flexible.length - 1].scene;
    tail.duration = Number(((numeric(tail.duration) || 0) + remaining).toFixed(3));
    distributed += remaining;
    remaining = 0;
  }

  return {
    scenes: nextScenes,
    adjusted: distributed > 0.04,
    redistributedS: Number(distributed.toFixed(3)),
  };
}

function protectClipSceneDurationsFromFreezes(scenes, opts = {}) {
  const capped = capClipFreezeRiskDurations(scenes);
  const redistributed = redistributeDurationToFlexibleScenes(
    capped.scenes,
    opts.targetDurationS,
    opts,
  );

  return {
    scenes: redistributed.scenes,
    adjusted: capped.adjusted || redistributed.adjusted,
    cappedScenes: capped.cappedScenes,
    redistributedS: redistributed.redistributedS,
    targetDurationS: numeric(opts.targetDurationS),
  };
}

module.exports = {
  capClipFreezeRiskDurations,
  protectClipSceneDurationsFromFreezes,
  redistributeDurationToFlexibleScenes,
  sumSceneDurations,
};
