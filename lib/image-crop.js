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

/**
 * Available position strategies. `attention` is Sharp's saliency
 * heuristic (best default), `entropy` finds high-detail regions
 * (often a different focal point than attention), and the cardinal
 * positions force a fixed crop side. Used by `smartCropVariant` to
 * produce visually different shots from the SAME source image.
 *
 * The 7 strategies give us up to 7 distinct 1080×1920 outputs from
 * one source — enough to cover a 12-segment video from 2 source
 * images without modulo-style "same image 6 times in a row".
 */
const VARIANT_STRATEGIES = [
  "attention",
  "entropy",
  "north",
  "south",
  "east",
  "west",
  "centre",
];

/**
 * Crop a single source image with a SPECIFIC strategy. Used to
 * generate multiple visually-distinct shots from one source.
 *
 * @param {string} inputAbsPath
 * @param {string} strategy   one of VARIANT_STRATEGIES
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
async function smartCropVariant(inputAbsPath, strategy, opts = {}) {
  if (!inputAbsPath || typeof inputAbsPath !== "string") return inputAbsPath;
  if (!(await fs.pathExists(inputAbsPath))) return inputAbsPath;
  if (!VARIANT_STRATEGIES.includes(strategy)) {
    return smartCropToReel(inputAbsPath, opts);
  }

  const parsed = path.parse(inputAbsPath);
  const variantTag = `_smartcrop_v2_${strategy}.jpg`;
  const outPath = path.join(parsed.dir, `${parsed.name}${variantTag}`);

  if (!opts.force && (await fs.pathExists(outPath))) return outPath;

  try {
    const sharp = require("sharp");
    let position;
    if (strategy === "attention") position = sharp.strategy.attention;
    else if (strategy === "entropy") position = sharp.strategy.entropy;
    else position = strategy;
    await sharp(inputAbsPath)
      .resize(REEL_WIDTH, REEL_HEIGHT, { fit: "cover", position })
      .jpeg({ quality: 90, chromaSubsampling: "4:2:0", mozjpeg: false })
      .withMetadata({})
      .toFile(outPath);
    return outPath;
  } catch (err) {
    console.log(
      `[image-crop] variant ${strategy} failed for ${inputAbsPath}: ${err.message} — using original`,
    );
    return inputAbsPath;
  }
}

/**
 * Produce up to `targetCount` visually-distinct crops from
 * `sourcePaths`. Strategy:
 *
 *   - If we have ≥ targetCount unique sources, just smart-crop each
 *     once (the existing batch behaviour, preferred).
 *   - Otherwise, walk the sources in round-robin fashion applying
 *     a different strategy per pass: source[0] gets attention,
 *     source[1] entropy, source[2] north, then source[0] entropy,
 *     etc. This keeps adjacent slots from being identical-looking
 *     re-runs of the same image.
 *
 * Output array length === targetCount.
 *
 * @param {Array<string>} sourcePaths
 * @param {number} targetCount
 * @returns {Promise<Array<string>>}
 */
async function smartCropForCount(sourcePaths, targetCount, opts = {}) {
  if (
    !Array.isArray(sourcePaths) ||
    sourcePaths.length === 0 ||
    targetCount <= 0
  ) {
    return [];
  }

  // Plenty of sources — just smart-crop each once.
  if (sourcePaths.length >= targetCount) {
    return Promise.all(
      sourcePaths.slice(0, targetCount).map((p) => smartCropToReel(p, opts)),
    );
  }

  // Fewer sources than slots: cycle sources × strategies. Each
  // (source, strategy) pair is a unique cropped output.
  const out = [];
  let strategyIdx = 0;
  let sourceIdx = 0;
  for (let i = 0; i < targetCount; i++) {
    const source = sourcePaths[sourceIdx];
    const strategy = VARIANT_STRATEGIES[strategyIdx];
     
    out.push(await smartCropVariant(source, strategy, opts));

    // Advance: source first (so adjacent slots get different
    // sources), then bump strategy when we wrap.
    sourceIdx = (sourceIdx + 1) % sourcePaths.length;
    if (sourceIdx === 0) {
      strategyIdx = (strategyIdx + 1) % VARIANT_STRATEGIES.length;
    }
  }
  return out;
}

module.exports = {
  smartCropToReel,
  smartCropBatch,
  smartCropVariant,
  smartCropForCount,
  REEL_WIDTH,
  REEL_HEIGHT,
  CACHE_SUFFIX,
  VARIANT_STRATEGIES,
};
