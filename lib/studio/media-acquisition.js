"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync } = require("node:child_process");

const CLIP_TAGS = ["A", "B", "C", "D"];

function ffprobeDuration(file) {
  try {
    const out = execFileSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        file,
      ],
      { encoding: "utf8" },
    ).trim();
    return Number.parseFloat(out);
  } catch {
    return null;
  }
}

function inferStillKind(filename) {
  const f = String(filename || "").toLowerCase();
  if (f.includes("trailerframe")) return "trailer-frame";
  if (f.includes("article")) return "article";
  if (f.includes("steam")) return "steam";
  if (f.includes("pexels") || f.includes("unsplash") || f.includes("bing")) {
    return "stock";
  }
  return "unknown";
}

async function listMatchingFiles(dir, predicate) {
  if (!(await fs.pathExists(dir))) return [];
  const names = await fs.readdir(dir);
  return names.filter(predicate).map((name) => path.join(dir, name));
}

async function discoverLocalStudioMedia({ root, storyId }) {
  const imageCache = path.join(root, "output", "image_cache");
  const videoCache = path.join(root, "output", "video_cache");

  const articleHeroes = [];
  const articlePath = path.join(imageCache, `${storyId}_article.jpg`);
  if (await fs.pathExists(articlePath)) {
    articleHeroes.push({ path: articlePath, kind: "article", score: 85 });
  }

  const trailerFrames = [];
  for (let i = 1; i <= 8; i++) {
    const p = path.join(imageCache, `${storyId}_trailerframe_${i}.jpg`);
    if (await fs.pathExists(p)) {
      trailerFrames.push({
        path: p,
        kind: "trailer-frame",
        score: 100 - i,
      });
    }
  }

  const clips = [];
  for (const tag of CLIP_TAGS) {
    const p = path.join(videoCache, `${storyId}_clip_${tag}.mp4`);
    if (await fs.pathExists(p)) {
      clips.push({
        path: p,
        tag,
        kind: "trailer-clip",
        durationS: ffprobeDuration(p),
        score: 120,
      });
    }
  }

  const trailerPath = path.join(videoCache, `${storyId}_trailer.mp4`);
  const stockFillers = (
    await listMatchingFiles(
      imageCache,
      (name) =>
        name.startsWith(`${storyId}_`) &&
        /\.(jpe?g|png)$/i.test(name) &&
        inferStillKind(name) === "stock" &&
        !name.includes("_smartcrop"),
    )
  ).map((p) => ({ path: p, kind: "stock", score: 5, _stock: true }));

  const otherImages = (
    await listMatchingFiles(
      imageCache,
      (name) =>
        name.startsWith(`${storyId}_`) &&
        /\.(jpe?g|png)$/i.test(name) &&
        inferStillKind(name) !== "stock" &&
        !name.includes("_smartcrop") &&
        !name.includes("trailerframe") &&
        !name.includes("_article.jpg"),
    )
  ).map((p) => ({
    path: p,
    kind: inferStillKind(path.basename(p)),
    score: 40,
  }));

  return {
    clips,
    trailerFrames,
    articleHeroes,
    publisherAssets: otherImages,
    stockFillers,
    trailerPath: (await fs.pathExists(trailerPath)) ? trailerPath : null,
  };
}

function buildClipSlicePlan({ trailerPath, storyId, outputDir }) {
  if (!trailerPath) return [];
  return [
    { tag: "A", startS: 1.2, durationS: 5.0 },
    { tag: "B", startS: 7.5, durationS: 5.0 },
    { tag: "C", startS: 15.0, durationS: 5.0 },
  ].map((slice) => ({
    ...slice,
    input: trailerPath,
    output: path.join(outputDir, `${storyId}_clip_${slice.tag}.mp4`),
  }));
}

function buildFrameExtractionPlan({ trailerPath, storyId, outputDir }) {
  if (!trailerPath) return [];
  return [2.0, 5.5, 9.0, 13.0, 17.0, 21.0].map((timeS, index) => ({
    timeS,
    input: trailerPath,
    output: path.join(outputDir, `${storyId}_trailerframe_${index + 1}.jpg`),
  }));
}

async function ensureTrailerClipSlices({ root, storyId, media }) {
  if (media.clips.length >= 3 || !media.trailerPath) return media;
  const videoCache = path.join(root, "output", "video_cache");
  await fs.ensureDir(videoCache);
  const plan = buildClipSlicePlan({
    trailerPath: media.trailerPath,
    storyId,
    outputDir: videoCache,
  });
  for (const item of plan) {
    if (await fs.pathExists(item.output)) continue;
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(item.startS),
      "-t",
      String(item.durationS),
      "-i",
      item.input,
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
      "-an",
      "-c:v",
      "libx264",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      item.output,
    ]);
  }
  return discoverLocalStudioMedia({ root, storyId });
}

async function ensureTrailerFrames({ root, storyId, media }) {
  if (media.trailerFrames.length >= 6 || !media.trailerPath) return media;
  const imageCache = path.join(root, "output", "image_cache");
  await fs.ensureDir(imageCache);
  const plan = buildFrameExtractionPlan({
    trailerPath: media.trailerPath,
    storyId,
    outputDir: imageCache,
  });
  for (const item of plan) {
    if (await fs.pathExists(item.output)) continue;
    execFileSync("ffmpeg", [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(item.timeS),
      "-i",
      item.input,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      item.output,
    ]);
  }
  return discoverLocalStudioMedia({ root, storyId });
}

function rankSourceDiversity(media) {
  const groups = {
    clips: media.clips.length,
    trailerFrames: media.trailerFrames.length,
    articleHeroes: media.articleHeroes.length,
    publisherAssets: media.publisherAssets.length,
    stockFillers: media.stockFillers.length,
  };
  const topicalSources =
    groups.clips + groups.trailerFrames + groups.articleHeroes + groups.publisherAssets;
  const stockSuppressed = groups.stockFillers > 0 && topicalSources >= 3;
  const score = Math.min(100, topicalSources * 12 + groups.clips * 14);
  return {
    groups,
    topicalSources,
    stockSuppressed,
    sourceMixScore: score,
    verdict: stockSuppressed
      ? "stock-suppressed"
      : groups.stockFillers > 0
        ? "stock-risk"
        : "topical-only",
  };
}

module.exports = {
  discoverLocalStudioMedia,
  ensureTrailerClipSlices,
  ensureTrailerFrames,
  buildClipSlicePlan,
  buildFrameExtractionPlan,
  rankSourceDiversity,
  ffprobeDuration,
};
