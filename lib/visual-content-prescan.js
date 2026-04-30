"use strict";

/**
 * lib/visual-content-prescan.js — pixel-level heuristic prescan for
 * downloaded images.
 *
 * Per the 2026-04-29 forensic audit: existing thumbnail-safety checks
 * are URL/metadata heuristics (filename contains "avatar", source is
 * "logo"). They miss real-pixel cases — a Pexels stock photo of a
 * smiling person, an article hero image of an unrelated executive,
 * a logo wrapped in a story-card. This module adds a lightweight
 * pixel-level prescan using sharp (already a dependency).
 *
 * NEVER identifies people. Only detects PRESENCE of common content
 * patterns (face-photo, logo, screenshot, stock person).
 *
 * Signals computed:
 *   - aspect_ratio
 *   - skin_tone_ratio  — proportion of pixels in the central 50%
 *     rectangle that match common skin-tone hue/saturation/luma bands.
 *     High values (>0.18) correlate with face/portrait photos.
 *   - central_luminance_oval — correlation between the central
 *     luminance distribution and an oval template (face shape).
 *   - edge_density — proportion of high-gradient pixels (sobel-style).
 *     Screenshots / illustrations have high edge density;
 *     portrait photos have low edge density on the subject region.
 *   - saturation_mean — heuristic for stylised art vs photo
 *   - text_overlay_likelihood — count of horizontal high-contrast
 *     strips (proxy for embedded text / logo wordmarks).
 *
 * Composite verdicts (heuristic, not identification):
 *   - likely_has_face: skin-tone ratio above threshold AND
 *     central_luminance_oval correlation above threshold.
 *   - likely_is_logo: small file (<60KB), high text-overlay,
 *     low saturation, square or vertical aspect, low skin-tone.
 *   - likely_is_screenshot: very high edge density + high saturation
 *     range. Game screenshots in particular.
 *   - likely_is_stock_person: face detected AND the source URL hints
 *     at stock photography (caller passes the source_type hint).
 *
 * Pure: takes a file path or buffer + an optional source_type hint,
 * returns a signals object. No DB writes — caller decides whether to
 * persist via media_provenance repo. No throws on bad input — every
 * path returns a structured result with `error` set.
 */

const fs = require("fs-extra");
const crypto = require("node:crypto");

const SAMPLE_DIM = 96; // downscale before analysis — fast enough for hot path
const CENTRAL_FRACTION = 0.5; // central window = 50% of each axis
const SKIN_TONE_RATIO_FACE_THRESHOLD = 0.18;
const OVAL_CORR_FACE_THRESHOLD = 0.55;
const TEXT_OVERLAY_LOGO_THRESHOLD = 0.22;
const EDGE_SCREENSHOT_THRESHOLD = 0.32;

/**
 * Compute sha256 hex digest of a buffer or file path.
 */
async function computeContentHash(input) {
  let buf;
  if (Buffer.isBuffer(input)) {
    buf = input;
  } else if (typeof input === "string") {
    try {
      buf = await fs.readFile(input);
    } catch {
      return null;
    }
  } else {
    return null;
  }
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Skin-tone match in YCbCr space. Conservative bands picked to span
 * the documented healthy range across human skin tones.
 *
 * Inputs: r, g, b in 0..255.
 */
function isSkinTone(r, g, b) {
  // Convert RGB to YCbCr (BT.601)
  const Y = 0.299 * r + 0.587 * g + 0.114 * b;
  const Cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const Cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return Y > 60 && Y < 240 && Cb >= 77 && Cb <= 127 && Cr >= 133 && Cr <= 173;
}

/**
 * Compute pixel-level signals for a sample buffer of size dim×dim×3.
 * Pure / synchronous so the test surface is minimal.
 */
function computeSignalsFromSample(rgbBuffer, dim) {
  const total = dim * dim;
  const px = (x, y) => {
    const i = (y * dim + x) * 3;
    return [rgbBuffer[i], rgbBuffer[i + 1], rgbBuffer[i + 2]];
  };

  // 1. Skin-tone ratio in central window
  const cMargin = Math.floor((dim * (1 - CENTRAL_FRACTION)) / 2);
  const cSize = dim - cMargin * 2;
  let skinHits = 0;
  let skinTotal = 0;
  for (let y = cMargin; y < cMargin + cSize; y++) {
    for (let x = cMargin; x < cMargin + cSize; x++) {
      const [r, g, b] = px(x, y);
      if (isSkinTone(r, g, b)) skinHits++;
      skinTotal++;
    }
  }
  const skin_tone_ratio = skinTotal > 0 ? skinHits / skinTotal : 0;

  // 2. Central luminance oval correlation. Build a normalised oval
  // template (1 inside an ellipse, 0 outside) on the central window
  // and correlate it against the image's luminance map.
  let lumSum = 0;
  let lumSumSq = 0;
  let templSum = 0;
  let templSumSq = 0;
  let crossSum = 0;
  let cn = 0;
  const cx = (cMargin + cMargin + cSize - 1) / 2;
  const cy = (cMargin + cMargin + cSize - 1) / 2;
  const rx = cSize / 2;
  const ry = cSize / 2;
  for (let y = cMargin; y < cMargin + cSize; y++) {
    for (let x = cMargin; x < cMargin + cSize; x++) {
      const [r, g, b] = px(x, y);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const inside = dx * dx + dy * dy <= 1 ? 1 : 0;
      lumSum += lum;
      lumSumSq += lum * lum;
      templSum += inside;
      templSumSq += inside * inside;
      crossSum += lum * inside;
      cn++;
    }
  }
  const lumMean = cn > 0 ? lumSum / cn : 0;
  const templMean = cn > 0 ? templSum / cn : 0;
  const lumVar = cn > 0 ? lumSumSq / cn - lumMean * lumMean : 0;
  const templVar = cn > 0 ? templSumSq / cn - templMean * templMean : 0;
  const cov = cn > 0 ? crossSum / cn - lumMean * templMean : 0;
  const denom = Math.sqrt(Math.max(lumVar, 0) * Math.max(templVar, 0));
  // Brighter centre → positive correlation; faces are typically
  // brighter than the surrounding (haircut, neck, background).
  const central_luminance_oval =
    denom > 1e-6 ? Math.max(0, Math.min(1, (cov / denom + 1) / 2)) : 0;

  // 3. Edge density via Sobel-lite (4-tap luminance gradient)
  let edges = 0;
  let edgeTotal = 0;
  for (let y = 1; y < dim - 1; y++) {
    for (let x = 1; x < dim - 1; x++) {
      const [r, g, b] = px(x, y);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const [r1, g1, b1] = px(x + 1, y);
      const lumR = 0.299 * r1 + 0.587 * g1 + 0.114 * b1;
      const [r2, g2, b2] = px(x, y + 1);
      const lumD = 0.299 * r2 + 0.587 * g2 + 0.114 * b2;
      const grad = Math.abs(lumR - lum) + Math.abs(lumD - lum);
      if (grad > 40) edges++;
      edgeTotal++;
    }
  }
  const edge_density = edgeTotal > 0 ? edges / edgeTotal : 0;

  // 4. Saturation mean (HSV V)
  let satSum = 0;
  for (let y = 0; y < dim; y++) {
    for (let x = 0; x < dim; x++) {
      const [r, g, b] = px(x, y);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      satSum += sat;
    }
  }
  const saturation_mean = total > 0 ? satSum / total : 0;

  // 5. Text-overlay likelihood: count rows that have many strong
  // horizontal-edge pixels (text characters create high vertical
  // contrast on a row).
  let textRows = 0;
  for (let y = 1; y < dim - 1; y++) {
    let strongEdges = 0;
    for (let x = 1; x < dim - 1; x++) {
      const [r, g, b] = px(x, y);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const [rR, gR, bR] = px(x + 1, y);
      const lumR = 0.299 * rR + 0.587 * gR + 0.114 * bR;
      if (Math.abs(lumR - lum) > 70) strongEdges++;
    }
    if (strongEdges / (dim - 2) > 0.18) textRows++;
  }
  const text_overlay_likelihood = textRows / (dim - 2);

  return {
    skin_tone_ratio,
    central_luminance_oval,
    edge_density,
    saturation_mean,
    text_overlay_likelihood,
  };
}

/**
 * Run the full prescan over an image file. Falls back to a structured
 * error result on any failure path so the caller can keep going.
 */
async function prescanImage(filePath, opts = {}) {
  const { sourceTypeHint = null, sharp = null } = opts;
  const result = {
    file_path: filePath,
    width: null,
    height: null,
    aspect_ratio: null,
    is_animated: false,
    skin_tone_ratio: null,
    central_luminance_oval: null,
    edge_density: null,
    saturation_mean: null,
    text_overlay_likelihood: null,
    likely_has_face: false,
    likely_is_logo: false,
    likely_is_screenshot: false,
    likely_is_stock_person: false,
    error: null,
  };

  if (!filePath) {
    result.error = "no_path";
    return result;
  }

  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (err) {
    result.error = `stat:${err.code || "unknown"}`;
    return result;
  }

  let sharpLib = sharp;
  if (!sharpLib) {
    try {
      sharpLib = require("sharp");
    } catch (err) {
      result.error = `sharp_missing:${err.message}`;
      return result;
    }
  }

  let metadata;
  let raw;
  try {
    const img = sharpLib(filePath);
    metadata = await img.metadata();
    const downscaled = await img
      .resize(SAMPLE_DIM, SAMPLE_DIM, { fit: "cover" })
      .removeAlpha()
      .raw()
      .toBuffer();
    raw = downscaled;
  } catch (err) {
    result.error = `sharp_decode:${err.message.slice(0, 100)}`;
    return result;
  }

  result.width = metadata.width || null;
  result.height = metadata.height || null;
  result.aspect_ratio =
    metadata.width && metadata.height ? metadata.width / metadata.height : null;
  result.is_animated = !!(metadata.pages && metadata.pages > 1);

  const sig = computeSignalsFromSample(raw, SAMPLE_DIM);
  result.skin_tone_ratio = sig.skin_tone_ratio;
  result.central_luminance_oval = sig.central_luminance_oval;
  result.edge_density = sig.edge_density;
  result.saturation_mean = sig.saturation_mean;
  result.text_overlay_likelihood = sig.text_overlay_likelihood;

  // Composite verdicts
  result.likely_has_face =
    sig.skin_tone_ratio >= SKIN_TONE_RATIO_FACE_THRESHOLD &&
    sig.central_luminance_oval >= OVAL_CORR_FACE_THRESHOLD;

  result.likely_is_logo =
    stat.size < 60 * 1024 &&
    sig.text_overlay_likelihood >= TEXT_OVERLAY_LOGO_THRESHOLD &&
    sig.skin_tone_ratio < 0.05 &&
    sig.saturation_mean < 0.4;

  result.likely_is_screenshot =
    sig.edge_density >= EDGE_SCREENSHOT_THRESHOLD &&
    sig.saturation_mean > 0.25 &&
    !result.likely_has_face;

  // stock-person hint: caller's source is pexels/unsplash AND we
  // detected a face. Rules out ambiguous own-publisher hero photos.
  const stockSources = new Set(["pexels", "unsplash"]);
  result.likely_is_stock_person =
    !!(sourceTypeHint && stockSources.has(sourceTypeHint)) &&
    result.likely_has_face;

  return result;
}

module.exports = {
  prescanImage,
  computeSignalsFromSample,
  computeContentHash,
  isSkinTone,
  SAMPLE_DIM,
  SKIN_TONE_RATIO_FACE_THRESHOLD,
  OVAL_CORR_FACE_THRESHOLD,
  TEXT_OVERLAY_LOGO_THRESHOLD,
  EDGE_SCREENSHOT_THRESHOLD,
};
