"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");

function normalisePath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function basename(filePath) {
  return path.basename(String(filePath || ""));
}

function inferKind(asset = {}) {
  const name = basename(asset.path).toLowerCase();
  if (asset.kind) return asset.kind;
  if (name.includes("_clip_") || name.endsWith(".mp4")) return "trailer-clip";
  if (name.includes("trailerframe")) return "trailer-frame";
  if (name.includes("article")) return "article";
  if (name.includes("steam")) return "steam";
  if (name.includes("pexels") || name.includes("unsplash") || name.includes("bing")) return "stock";
  return "unknown";
}

function ffprobeVideo(filePath) {
  try {
    const raw = execFileSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ],
      { encoding: "utf8" },
    );
    const parsed = JSON.parse(raw);
    const stream = (parsed.streams || []).find((s) => s.codec_type === "video") || {};
    return {
      durationS: Number.parseFloat(parsed.format?.duration || stream.duration || "0") || null,
      width: stream.width || null,
      height: stream.height || null,
      codec: stream.codec_name || null,
    };
  } catch {
    return {};
  }
}

function scoreAsset(asset = {}, { usage = new Map() } = {}) {
  const kind = inferKind(asset);
  const filePath = asset.path || "";
  const name = basename(filePath).toLowerCase();
  const isVideo = /\.(mp4|mov|webm|mkv)$/i.test(filePath);
  const probe = isVideo ? ffprobeVideo(filePath) : {};
  const usageCount = usage.get(normalisePath(filePath)) || 0;

  const baseByKind = {
    "trailer-clip": 92,
    "trailer-frame": 78,
    article: 66,
    steam: 62,
    "article-hero": 66,
    "article-inline": 58,
    stock: 8,
    unknown: 34,
  };
  let score = baseByKind[kind] ?? baseByKind.unknown;

  const motionScore = isVideo ? Math.min(100, 65 + Math.round((probe.durationS || 3) * 4)) : kind === "trailer-frame" ? 45 : 20;
  const sourceSpecificity = kind === "stock" ? 5 : kind === "unknown" ? 35 : 85;
  const subjectClarity = name.includes("smartcrop") ? 82 : kind === "trailer-clip" ? 76 : kind === "trailer-frame" ? 72 : 60;
  const textRisk = /logo|title|capsule|cover|thumbnail/i.test(name) ? 45 : 12;
  const watermarkRisk = /pexels|unsplash|bing|watermark/i.test(name) ? 75 : 8;
  const darknessRisk = /tunnel|dark|metro|exodus/i.test(name) ? 25 : 15;
  const reusePenalty = Math.min(35, usageCount * 12);
  const stockPenalty = kind === "stock" ? 70 : 0;
  const resolutionBonus = probe.width && probe.height && probe.width >= 720 && probe.height >= 720 ? 5 : 0;

  score += Math.round(motionScore * 0.16);
  score += Math.round(sourceSpecificity * 0.12);
  score += Math.round(subjectClarity * 0.08);
  score += resolutionBonus;
  score -= Math.round(textRisk * 0.08);
  score -= Math.round(watermarkRisk * 0.12);
  score -= reusePenalty;
  score -= stockPenalty;

  const roles = [];
  if (kind === "trailer-clip") roles.push("motion", "hook", "escalation", "payoff");
  if (kind === "trailer-frame") roles.push("proof", "context", "visual-evidence");
  if (kind === "article" || kind === "article-hero") roles.push("freeze", "end-lock");
  if (kind === "stock") roles.push("reject-premium");

  return {
    id: normalisePath(filePath),
    path: filePath,
    file: basename(filePath),
    kind,
    score: Math.max(0, Math.min(100, score)),
    metrics: {
      motionScore,
      sourceSpecificity,
      subjectClarity,
      textRisk,
      watermarkRisk,
      darknessRisk,
      reusePenalty,
      stockPenalty,
      width: probe.width || null,
      height: probe.height || null,
      durationS: probe.durationS || asset.durationS || null,
    },
    roles,
    rejectReasons: [
      kind === "stock" ? "stock_filler" : null,
      watermarkRisk >= 70 ? "watermark_or_stock_brand_risk" : null,
      usageCount >= 3 ? "reuse_history" : null,
    ].filter(Boolean),
  };
}

function flattenMedia(media = {}) {
  return [
    ...(media.clips || media.trailerClips || []),
    ...(media.trailerFrames || []),
    ...(media.articleHeroes || []),
    ...(media.articleInline || []),
    ...(media.publisherAssets || []),
    ...(media.stockFillers || media.stockFiller || []),
  ].filter((asset) => asset && asset.path);
}

function buildClipIntelligenceVault({ storyId, media = {}, previousUsage = {} } = {}) {
  const usage = new Map(Object.entries(previousUsage || {}));
  const assets = flattenMedia(media).map((asset) => scoreAsset(asset, { usage }));
  const accepted = assets.filter((a) => !a.rejectReasons.includes("stock_filler"));
  const rejected = assets.filter((a) => a.rejectReasons.length > 0);
  const ranked = [...accepted].sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  return {
    storyId,
    generatedAt: new Date().toISOString(),
    assets: ranked,
    rejected,
    stats: {
      totalAssets: assets.length,
      acceptedAssets: accepted.length,
      rejectedAssets: rejected.length,
      clipCount: accepted.filter((a) => a.kind === "trailer-clip").length,
      stillCount: accepted.filter((a) => a.kind !== "trailer-clip").length,
      stockRejected: rejected.filter((a) => a.rejectReasons.includes("stock_filler")).length,
    },
    best: {
      hook: ranked.find((a) => a.roles.includes("hook")) || ranked[0] || null,
      proof: ranked.find((a) => a.roles.includes("proof")) || ranked[1] || ranked[0] || null,
      context: ranked.find((a) => a.roles.includes("context")) || ranked[2] || ranked[0] || null,
      payoff: ranked.find((a) => a.roles.includes("payoff")) || ranked[0] || null,
      freeze: ranked.find((a) => a.roles.includes("freeze")) || ranked.find((a) => a.kind !== "trailer-clip") || null,
    },
  };
}

function reorderMediaByVault(media = {}, vault = {}) {
  const rank = new Map((vault.assets || []).map((a, i) => [normalisePath(a.path), i]));
  const order = (items = []) =>
    items.slice().sort((a, b) => {
      const ar = rank.has(normalisePath(a.path)) ? rank.get(normalisePath(a.path)) : 9999;
      const br = rank.has(normalisePath(b.path)) ? rank.get(normalisePath(b.path)) : 9999;
      return ar - br;
    });
  return {
    ...media,
    clips: order(media.clips || []),
    trailerClips: order(media.trailerClips || []),
    trailerFrames: order(media.trailerFrames || []),
    articleHeroes: order(media.articleHeroes || []),
    articleInline: order(media.articleInline || []),
    publisherAssets: order(media.publisherAssets || []),
    stockFillers: [],
    stockFiller: [],
  };
}

module.exports = {
  buildClipIntelligenceVault,
  flattenMedia,
  inferKind,
  reorderMediaByVault,
  scoreAsset,
};
