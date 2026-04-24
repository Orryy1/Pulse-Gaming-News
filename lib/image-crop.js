/**
 * lib/image-crop.js — subject-aware cropping for video assembly.
 *
 * Problem we're solving (2026-04-24, Ingrid screenshot):
 *   Article og:image / Steam keyart for a character story arrives at
 *   e.g. 1920×1080 landscape. assemble.js's ffmpeg filter graph then
 *   does `scale=w=1080:h=1920:force_original_aspect_ratio=decrease,
 *   pad=1080:1920:(ow-iw)/2:(oh-ih)/2` — "fit inside the portrait
 *   frame with black bars". For a wide shot of a character that's
 *   already cropped for cinematic landscape framing, the character's
 *   FACE ends up in the top 20% of the 1920px portrait height, with
 *   big black bars above and below — and the middle of the portrait
 *   frame lands on an arm / torso / background. Looks like a broken
 *   slideshow.
 *
 *   Viewer's eye goes to the middle of the frame; the middle of our
 *   frame is an arm. We want a face.
 *
 * Fix: pre-process every video image through Sharp's attention-based
 * smart crop before feeding it to ffmpeg. `sharp.strategy.attention`
 * uses Libvips' `entropy/skin` heuristic to find the most
 * interesting/high-detail region — very good at landing on faces +
 * character figures in game art.
 *
 * The cropped output is always 1080×1920 (portrait Reel format) with
 * `fit: 'cover'` — no letterbox, the entire frame is filled with the
 * subject. ffmpeg's downstream scale+pad becomes a no-op.
 *
 * The cropped files land next to the originals with a `_smartcrop`
 * suffix so the cache can be inspected / invalidated.
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");

// Target dimensions for the video canvas (matches the 1080×1920
// output the ffmpeg filter graph produces).
const REEL_WIDTH = 1080;
const REEL_HEIGHT = 1920;

/**
 * Smart-crop an image to `REEL_WIDTH × REEL_HEIGHT` using Sharp's
 * attention strategy. Returns the absolute path of the cropped
 * output, which is cached — subsequent calls for the same input
 * short-circuit.
 *
 * Safety:
 *   - If Sharp throws (corrupt input, unreadable file), the helper
 *     resolves to the original path so assemble.js can continue.
 *     The original path's scale+pad will handle it.
 *   - No file is overwritten in-place; the crop writes to
 *     `<original>_smartcrop.jpg`.
 *
 * @param {string} inputAbsPath  absolute filesystem path to source
 * @param {object} [opts]
 * @param {boolean} [opts.force]  bypass cache and re-generate
 * @returns {Promise<string>}    absolute path to cropped output
 */
async function smartCropToReel(inputAbsPath, opts = {}) {
  if (!inputAbsPath || typeof inputAbsPath !== "string") return inputAbsPath;
  if (!(await fs.pathExists(inputAbsPath))) return inputAbsPath;

  const parsed = path.parse(inputAbsPath);
  // Keep the directory, replace the extension with .jpg, add the
  // suffix. JPEG is deliberate — smaller, ffmpeg reads it fine,
  // and we're discarding alpha anyway.
  const outPath = path.join(parsed.dir, `${parsed.name}_smartcrop.jpg`);

  if (!opts.force && (await fs.pathExists(outPath))) return outPath;

  try {
    const sharp = require("sharp");
    await sharp(inputAbsPath)
      .resize(REEL_WIDTH, REEL_HEIGHT, {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      // Explicit jpeg format + reasonable quality — we're cropping
      // then re-compressing so quality 88 keeps the file small
      // without visible banding in the video composite.
      .jpeg({ quality: 88, mozjpeg: true })
      .toFile(outPath);
    return outPath;
  } catch (err) {
    // Sharp failure on a specific image is recoverable — ffmpeg can
    // still handle the original via its scale+pad path. Log so the
    // operator can see which image's smart-crop failed.
    console.log(
      `[image-crop] smart-crop failed for ${inputAbsPath}: ${err.message} — using original`,
    );
    return inputAbsPath;
  }
}

/**
 * Convenience: smart-crop a list of image paths in parallel.
 * Returns a list of (possibly-new) absolute paths in the same order.
 */
async function smartCropBatch(absPaths, opts = {}) {
  if (!Array.isArray(absPaths)) return [];
  return Promise.all(absPaths.map((p) => smartCropToReel(p, opts)));
}

module.exports = {
  smartCropToReel,
  smartCropBatch,
  REEL_WIDTH,
  REEL_HEIGHT,
};
