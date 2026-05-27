"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");
const { execFileSync: defaultExecFileSync } = require("node:child_process");
const { ffprobeDuration: defaultFfprobeDuration } = require("../media-acquisition");
const { mediaSourceUrlKindFields } = require("../../media-source-url-kind");
const { isSafeOutboundUrl } = require("../../safe-url");

const RENDER_CACHE_SIGNATURE = "studio_v4_clip_materializer_accurate_seek_v2";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeFileStem(value) {
  return (
    cleanText(value)
      .replace(/[^a-z0-9_-]+/gi, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 90) || "clip"
  );
}

function clipCacheKey(clip = {}) {
  return crypto
    .createHash("sha1")
    .update(
      [
        cleanText(clip.path),
        cleanText(clip.source_url),
        String(numberOr(clip.mediaStartS ?? clip.media_start_s, 0).toFixed(2)),
        String(numberOr(clip.durationS ?? clip.duration_s, 0).toFixed(2)),
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 12);
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(cleanText(value));
}

function isSafeDirectMediaUrl(value) {
  const text = cleanText(value);
  if (!isHttpUrl(text)) return false;
  if (!isSafeOutboundUrl(text)) return false;
  return mediaSourceUrlKindFields(text).segment_validation_eligible === true;
}

function outputClipPath({ root, storyId, clip, index }) {
  const stem = safeFileStem(clip.id || clip.source_family || `clip_${index + 1}`);
  const cacheKey = clipCacheKey(clip);
  return path.join(
    root,
    "output",
    "video_cache",
    `${safeFileStem(storyId)}_v4_clip_${index + 1}_${stem}_${cacheKey}.mp4`,
  );
}

function outputMetadataPath(outputPath) {
  return `${outputPath}.json`;
}

function cacheMetadata({ originalPath, startS, durationS }) {
  return {
    schema_version: 1,
    render_signature: RENDER_CACHE_SIGNATURE,
    source_url: cleanText(originalPath),
    media_start_s: Number(startS || 0),
    duration_s: Number(durationS || 0),
  };
}

async function cachedClipMatches(output, expected = {}) {
  const metaPath = outputMetadataPath(output);
  if (!(await fs.pathExists(output)) || !(await fs.pathExists(metaPath))) return false;
  try {
    const actual = await fs.readJson(metaPath);
    return (
      cleanText(actual.render_signature) === RENDER_CACHE_SIGNATURE &&
      cleanText(actual.source_url) === cleanText(expected.source_url) &&
      Number(actual.media_start_s).toFixed(2) === Number(expected.media_start_s).toFixed(2) &&
      Number(actual.duration_s).toFixed(2) === Number(expected.duration_s).toFixed(2)
    );
  } catch {
    return false;
  }
}

function localPathFor(root, clipPath) {
  const text = cleanText(clipPath);
  if (!text || isHttpUrl(text)) return null;
  return path.isAbsolute(text) ? text : path.resolve(root, text);
}

function isUsableClip(filePath, ffprobeDuration) {
  const duration = ffprobeDuration(filePath);
  return Number.isFinite(duration) && duration > 0.2;
}

function buildFfmpegArgs({ input, output, startS, durationS }) {
  return [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-ss",
    String(Number(startS || 0).toFixed(2).replace(/\.00$/, "")),
    "-t",
    String(Number(durationS || 3).toFixed(2).replace(/\.00$/, "")),
    "-vf",
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    output,
  ];
}

async function materializeStudioV4BridgeClips({
  root = process.cwd(),
  story = {},
  bridge = {},
  execFileSync = defaultExecFileSync,
  ffprobeDuration = defaultFfprobeDuration,
} = {}) {
  const clips = asArray(bridge.video_clips);
  const accepted = [];
  const materialized = [];
  const rejected = [];
  const storyId = story.id || bridge.story_id || "story";
  const outDir = path.join(root, "output", "video_cache");
  await fs.ensureDir(outDir);

  if (bridge.readiness?.status !== "bridge_ready") {
    return {
      readiness: { status: "materialization_skipped", blockers: ["bridge_not_ready"] },
      bridge,
      materialized,
      rejected,
    };
  }

  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index] || {};
    const originalPath = cleanText(clip.path);
    const localPath = localPathFor(root, originalPath);
    if (localPath) {
      if (await fs.pathExists(localPath)) {
        accepted.push({ ...clip, path: localPath, materialized: false });
      } else {
        rejected.push({ id: clip.id || null, path: originalPath, reason: "local_clip_missing" });
      }
      continue;
    }

    if (!isSafeDirectMediaUrl(originalPath)) {
      rejected.push({ id: clip.id || null, path: originalPath, reason: "unsafe_direct_media_url" });
      continue;
    }

    const output = outputClipPath({ root, storyId, clip, index });
    const startS = Math.max(0, numberOr(clip.mediaStartS ?? clip.media_start_s, 0));
    const durationS = Math.max(0.5, numberOr(clip.durationS ?? clip.duration_s, 3));
    const expectedCache = cacheMetadata({
      originalPath,
      startS,
      durationS,
    });

    try {
      const cacheMatches = await cachedClipMatches(output, expectedCache);
      if (!cacheMatches || !isUsableClip(output, ffprobeDuration)) {
        await fs.remove(output).catch(() => {});
        await fs.remove(outputMetadataPath(output)).catch(() => {});
        execFileSync("ffmpeg", buildFfmpegArgs({
          input: originalPath,
          output,
          startS,
          durationS,
        }), {
          cwd: root,
          stdio: "ignore",
        });
      }
      if (!isUsableClip(output, ffprobeDuration)) {
        await fs.remove(output).catch(() => {});
        await fs.remove(outputMetadataPath(output)).catch(() => {});
        rejected.push({ id: clip.id || null, path: originalPath, reason: "materialized_clip_invalid" });
        continue;
      }
      await fs.writeJson(outputMetadataPath(output), expectedCache, { spaces: 2 });
      const nextClip = {
        ...clip,
        path: output,
        source_url: originalPath,
        local_materialized_path: output,
        materialized: true,
        materialized_media_start_s: startS,
        materialized_duration_s: durationS,
      };
      accepted.push(nextClip);
      materialized.push({
        id: clip.id || null,
        source_family: clip.source_family || null,
        source_url: originalPath,
        path: output,
        mediaStartS: startS,
        durationS,
      });
    } catch (err) {
      await fs.remove(output).catch(() => {});
      rejected.push({
        id: clip.id || null,
        path: originalPath,
        reason: "ffmpeg_materialization_failed",
        error: err.message,
      });
    }
  }

  const ready = accepted.length === clips.length && clips.length > 0;
  const nextBridge = {
    ...bridge,
    video_clips: ready ? accepted : [],
    materialization: {
      status: ready ? "materialized" : "materialization_blocked",
      accepted: accepted.length,
      rejected: rejected.length,
      materialized: materialized.length,
      output_dir: outDir,
    },
    readiness: ready
      ? bridge.readiness
      : {
          status: "bridge_blocked",
          blockers: ["v4_clip_materialization_failed"],
          warnings: [],
        },
  };

  return {
    readiness: {
      status: ready ? "materialized" : "materialization_blocked",
      blockers: ready ? [] : ["v4_clip_materialization_failed"],
    },
    bridge: nextBridge,
    materialized,
    rejected,
  };
}

module.exports = {
  materializeStudioV4BridgeClips,
  isSafeDirectMediaUrl,
  buildFfmpegArgs,
};
