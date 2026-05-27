"use strict";

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

function wordBoundaries(words) {
  const out = [];
  for (const word of Array.isArray(words) ? words : []) {
    for (const value of [word?.start, word?.end]) {
      const boundary = numeric(value);
      if (boundary !== null && boundary > 0) out.push(boundary);
    }
  }
  return [...new Set(out.map((value) => Number(value.toFixed(3))))].sort((a, b) => a - b);
}

function nearestBoundary({ target, min, max, boundaries }) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const boundary of boundaries) {
    if (boundary < min || boundary > max) continue;
    const distance = Math.abs(boundary - target);
    if (distance < bestDistance) {
      best = boundary;
      bestDistance = distance;
    }
  }
  return best;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function alignSceneDurationsToWordBoundaries(scenes, words, opts = {}) {
  const list = Array.isArray(scenes) ? scenes : [];
  if (list.length < 2) {
    return { scenes: list, adjusted: false, cutTimes: [], reason: "not_enough_scenes" };
  }
  const boundaries = wordBoundaries(words);
  if (boundaries.length === 0) {
    return { scenes: list, adjusted: false, cutTimes: [], reason: "no_word_boundaries" };
  }

  const totalDurationS = numeric(opts.totalDurationS) || sumSceneDurations(list);
  if (!Number.isFinite(totalDurationS) || totalDurationS <= 0) {
    return { scenes: list, adjusted: false, cutTimes: [], reason: "invalid_total_duration" };
  }

  const minSceneDurationS = Math.max(0.5, Number(opts.minSceneDurationS || 2.6));
  const maxSceneDurationS = Math.max(minSceneDurationS, Number(opts.maxSceneDurationS || 8.2));
  const naturalCuts = [];
  let natural = 0;
  for (let i = 0; i < list.length - 1; i++) {
    natural += numeric(list[i]?.duration) || 0;
    naturalCuts.push(natural);
  }

  const cutTimes = [];
  let previousCut = 0;
  for (let i = 0; i < naturalCuts.length; i++) {
    const remainingScenes = list.length - i - 1;
    const min = Math.max(
      previousCut + minSceneDurationS,
      totalDurationS - remainingScenes * maxSceneDurationS,
    );
    const max = Math.min(
      previousCut + maxSceneDurationS,
      totalDurationS - remainingScenes * minSceneDurationS,
    );
    if (min > max) {
      return { scenes: list, adjusted: false, cutTimes: [], reason: "duration_constraints_conflict" };
    }
    const target = clamp(naturalCuts[i], min, max);
    const snapped = nearestBoundary({ target, min, max, boundaries });
    const cut = snapped === null ? target : snapped;
    const rounded = Number(cut.toFixed(3));
    cutTimes.push(rounded);
    previousCut = rounded;
  }

  const aligned = list.map((scene) => ({ ...scene }));
  let start = 0;
  for (let i = 0; i < aligned.length; i++) {
    const end = i < cutTimes.length ? cutTimes[i] : totalDurationS;
    aligned[i].duration = Number(Math.max(0.1, end - start).toFixed(3));
    start = end;
  }

  return {
    scenes: aligned,
    adjusted: true,
    cutTimes,
    totalDurationS: Number(totalDurationS.toFixed(3)),
  };
}

function sceneType(scene) {
  return String(scene?.type || scene?.sceneType || "");
}

function capStaticCardDurations(scenes, opts = {}) {
  const list = Array.isArray(scenes) ? scenes.map((scene) => ({ ...scene })) : [];
  if (!list.length) return { scenes: list, adjusted: false, redistributedS: 0 };

  const maxStaticCardDurationS = Math.max(2.2, Number(opts.maxStaticCardDurationS || 3.2));
  let excess = 0;
  for (const scene of list) {
    const type = sceneType(scene);
    const duration = numeric(scene.duration) || 0;
    if (!["card.stat", "card.timeline"].includes(type)) continue;
    if (duration <= maxStaticCardDurationS) continue;
    scene.duration = Number(maxStaticCardDurationS.toFixed(3));
    excess += duration - maxStaticCardDurationS;
  }

  if (excess <= 0.001) {
    return { scenes: list, adjusted: false, redistributedS: 0 };
  }

  const maxFlexibleDurationS = Math.max(
    maxStaticCardDurationS,
    Number(opts.maxFlexibleDurationS || 6.8),
  );
  const flexible = list.filter((scene) =>
    ["still", "clip.frame"].includes(sceneType(scene)),
  );
  const fallback = list.filter((scene) => !["card.stat", "card.timeline"].includes(sceneType(scene)));
  const targets = flexible.length ? flexible : fallback;
  let remaining = excess;
  for (let index = 0; index < targets.length && remaining > 0.001; index += 1) {
    const scene = targets[index];
    const duration = numeric(scene.duration) || 0;
    const share = remaining / (targets.length - index);
    const capacity = Math.max(0, maxFlexibleDurationS - duration);
    const add = Math.min(share, capacity || share);
    if (add <= 0.001) continue;
    scene.duration = Number((duration + add).toFixed(3));
    remaining -= add;
  }
  if (remaining > 0.001 && targets.length) {
    const last = targets[targets.length - 1];
    last.duration = Number(((numeric(last.duration) || 0) + remaining).toFixed(3));
    remaining = 0;
  }

  return {
    scenes: list,
    adjusted: true,
    redistributedS: Number((excess - remaining).toFixed(3)),
  };
}

module.exports = {
  alignSceneDurationsToWordBoundaries,
  capStaticCardDurations,
  sumSceneDurations,
  wordBoundaries,
};
