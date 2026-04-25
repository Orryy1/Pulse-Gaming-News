/**
 * lib/image-crop.js — subject-aware cropping for video assembly.
 *
 * 2026-04-25 redesign (quality-redesign branch):
 *   The original implementation produced JPEGs via Sharp's mozjpeg
 *   encoder. mozjpeg writes a non-standard JFIF header — some files
 *   ffprobe as `pix_fmt: none(bt470bg/unknown/unknown)` and ffmpeg's
 *   auto-inserted swscaler refuses them with
 *     [auto_scale_N] Failed to configure output pad
 *   This crashed every multi-image render, so the integration was
 *   reverted on 545c622.
 *
 *   This redesign re-enables smart-crop with an ffmpeg-safe output:
 *     - vanilla JPEG (no mozjpeg)
 *     - explicit chromaSubsampling: '4:2:0' (matches the encoder
 *       output, eliminates auto-scaler range conversion)
 *     - withMetadata({ icc: undefined, exif: undefined }) so the
 *       JFIF stays clean — no embedded colour profiles for ffmpeg
 *       to misinterpret
 *     - cache filename suffix bumped to `_smartcrop_v2.jpg` to bust
 *       any stale `_smartcrop.jpg` files from the previous attempt
 *
 *   The fail-safe semantics are preserved: any Sharp error and we
 *   return the input path unchanged, so assemble.js can still
 *   render with the original scale+pad path.
 *
 * Why smart-crop matters:
 *   Article og:image / Steam keyart for character stories arrives as
 *   1920×1080 landscape. assemble.js's scale+pad letterboxes them
 *   into 1080×1920 portrait — the character's face lands in the top
 *   20% of the frame with huge black bars and the middle of the
 *   frame is an arm / torso / background. Viewer's eye goes to the
 *   middle; the middle is empty. Smart-crop uses Sharp's attention
 *   strategy (libvips entropy + skin heuristic) to find the
 *   highest-detail region and crop to 1080×1920 around it, so the
 *   subject is centred.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;

// Cache filename suffix. Bump when the encoder settings change so
// stale crops from previous strategies don't get reused.
const CACHE_SUFFIX = "_smartcrop_v2.jpg";

/**
 * Smart-crop an image to REEL_WIDTH × REEL_HEIGHT using Sharp's
 * attention strategy. Returns the absolute path of the cropped
 * output. Subsequent calls for the same input short-circuit via the
 * filename cache.
 *
 * @param {string} inputAbsPath  absolute path to the source image
 * @param {object} [opts]
 * @param {boolean} [opts.force]  bypass cache and re-generate
 * @returns {Promise<string>}    absolute path of the cropped output,
 *                               OR the input path on any failure
 */
async function smartCropToReel(inputAbsPath, opts = {}) {
  if (!inputAbsPath || typeof inputAbsPath !== "string") return inputAbsPath;
  if (!(await fs.pathExists(inputAbsPath))) return inputAbsPath;

  const parsed = path.parse(inputAbsPath);
  const outPath = path.join(parsed.dir, `${parsed.name}${CACHE_SUFFIX}`);

  if (!opts.force && (await fs.pathExists(outPath))) return outPath;

  try {
    const sharp = require("sharp");
    await sharp(inputAbsPath)
      .resize(REEL_WIDTH, REEL_HEIGHT, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      // Vanilla JPEG: no mozjpeg, explicit 4:2:0 chroma, no embedded
      // colour profile. This produces a JFIF that ffmpeg's swscaler
      // reads as standard yuvj420p limited-range without needing
      // auto-scale insertion.
      .jpeg({
        quality: 90,
        chromaSubsampling: "4:2:0",
        mozjpeg: false,
      })
      .withMetadata({}) // strip ICC / EXIF
      .toFile(outPath);
    return outPath;
  } catch (err) {
    console.log(
      `[image-crop] smart-crop failed for ${inputAbsPath}: ${err.message} — using original`,
    );
    return inputAbsPath;
  }
}

async function smartCropBatch(absPaths, opts = {}) {
  if (!Array.isArray(absPaths)) return [];
  return Promise.all(absPaths.map((p) => smartCropToReel(p, opts)));
}

module.exports = {
  smartCropToReel,
  smartCropBatch,
  REEL_WIDTH,
  REEL_HEIGHT,
  CACHE_SUFFIX,
};
