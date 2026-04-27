"use strict";

function countBy(items, keyFn) {
  const counts = new Map();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function grade(score) {
  if (score >= 85) return "pass";
  if (score >= 65) return "review";
  return "reject";
}

function analyseVisualTimeline({ scenes = [], vault = {}, timeline = {} } = {}) {
  const assetById = new Map((vault.assets || []).map((asset) => [asset.id, asset]));
  const sceneSources = scenes.map((scene) => String(scene.source || scene.backgroundSource || scene.prerenderedMp4 || scene.label || ""));
  const sourceCounts = countBy(sceneSources, (source) => source.replace(/_smartcrop_v2(_[a-z]+)?\.jpe?g$/i, ".jpg"));
  const repeatedSources = [...sourceCounts.entries()].filter(([, count]) => count > 2);
  const stockScenes = scenes.filter((scene) => scene._stock || /pexels|unsplash|bing/i.test(scene.source || scene.backgroundSource || ""));
  const adjacentSameType = scenes.filter((scene, index) => {
    if (index === 0) return false;
    const type = scene.type || scene.sceneType;
    const prevType = scenes[index - 1].type || scenes[index - 1].sceneType;
    return type === prevType && /^card\./.test(type);
  });
  const lowScoredAssetScenes = scenes
    .map((scene) => {
      const src = String(scene.source || scene.backgroundSource || "");
      const asset = [...assetById.values()].find((a) => a.path === src || a.id === src.replace(/\\/g, "/"));
      return { scene, asset };
    })
    .filter(({ asset }) => asset && asset.score < 55);
  const beatCoverage = new Set((timeline.beats || []).filter((b) => b.preferredAssetId).map((b) => b.type));

  let score = 100;
  score -= repeatedSources.reduce((sum, [, count]) => sum + (count - 2) * 12, 0);
  score -= stockScenes.length * 25;
  score -= adjacentSameType.length * 18;
  score -= lowScoredAssetScenes.length * 8;
  if (beatCoverage.size < 5) score -= 15;
  score = Math.max(0, score);

  const issues = [
    ...repeatedSources.map(([source, count]) => ({
      severity: count >= 4 ? "fail" : "warn",
      code: "repeated_source",
      message: `${source} appears ${count} times.`,
    })),
    ...stockScenes.map((scene) => ({
      severity: "fail",
      code: "stock_scene",
      message: `Stock-like source used in scene ${scene.label || scene.type}.`,
    })),
    ...adjacentSameType.map((scene) => ({
      severity: "warn",
      code: "adjacent_same_type",
      message: `Adjacent scene type repeated at ${scene.label || scene.type}.`,
    })),
    ...lowScoredAssetScenes.map(({ scene, asset }) => ({
      severity: "warn",
      code: "weak_asset_score",
      message: `${scene.label || scene.type} uses ${asset.file} scored ${asset.score}.`,
    })),
  ];

  return {
    score,
    verdict: grade(score),
    repeatedSources: repeatedSources.map(([source, count]) => ({ source, count })),
    stockSceneCount: stockScenes.length,
    adjacentSameTypeCount: adjacentSameType.length,
    lowScoredAssetSceneCount: lowScoredAssetScenes.length,
    beatCoverage: [...beatCoverage],
    issues,
  };
}

function buildFrameQaChecklist({ renderPath, contactSheetPath } = {}) {
  return [
    { check: "contact_sheet_exists", target: contactSheetPath || null, method: "local rendered proof" },
    { check: "caption_overlap", target: renderPath || null, method: "sample frame OCR/manual review" },
    { check: "dark_dead_frames", target: renderPath || null, method: "blackdetect plus frame luminance pass" },
    { check: "watermark_or_stock", target: renderPath || null, method: "frame audit against vault rejected assets" },
    { check: "subject_crop", target: renderPath || null, method: "sample face/character centre review" },
  ];
}

module.exports = {
  analyseVisualTimeline,
  buildFrameQaChecklist,
};
