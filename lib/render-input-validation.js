"use strict";

/**
 * lib/render-input-validation.js — pre-flight checks + fallback
 * reason classification for the assemble.js multi-image render.
 *
 * Why this exists (2026-04-30 reported issue): a story with 8
 * downloaded images fell back to legacy_single_image_fallback. The
 * forensic stamp shipped earlier (`render_fallback_reason`) captures
 * the ffmpeg stderr tail, but only AFTER the failure. This module
 * adds the BEFORE check: every input image is opened with sharp and
 * checked for usable dimensions. Bad inputs get dropped and the
 * multi-image graph proceeds with the survivors.
 *
 * Plus: a stderr → enum classifier so when a fallback DOES still
 * happen (despite validation), the reason carries a structured class
 * the operator can grep on, not just a 400-char raw tail.
 *
 * No assemble.js rewrite — these helpers are dependency-injected
 * into the existing flow with a single call.
 */

const fs = require("fs-extra");

// Recognised ffmpeg failure classes. Each entry has a regex matched
// against stderr/error text. Most-specific first wins — a single
// classify() call walks the list in order.
const FFMPEG_ERROR_CLASSES = [
  // I/O errors first — these are common deploy fingerprints
  { class: "input_no_such_file", re: /No such file or directory/i },
  {
    class: "input_invalid_data",
    re: /Invalid data found when processing input/i,
  },
  {
    class: "input_decode_error",
    re: /Error while decoding stream|Could not decode/i,
  },
  {
    class: "input_unsupported",
    re: /Unknown decoder|unrecognized option|unsupported codec/i,
  },
  // Filter graph parse / wiring errors
  {
    class: "filter_graph_parse_error",
    re: /Error parsing filtergraph|filter_complex.*error|invalid filtergraph/i,
  },
  {
    class: "filter_label_not_found",
    re: /Cannot find a matching stream|Output pad .* with label .* does not exist|No such filter/i,
  },
  {
    class: "filter_param_error",
    re: /Invalid argument|Option .* not found|missing parameter/i,
  },
  // Drawtext / ASS specific
  { class: "drawtext_error", re: /\[drawtext.*\] (Failed|Could not|Cannot)/i },
  { class: "ass_error", re: /\[ass[^\]]*\] (could not|fail|error)/i },
  { class: "ass_path_error", re: /\[Parsed_ass_/i }, // ASS-pass parse fail
  // Resource limits
  {
    class: "input_count_exceeded",
    re: /Too many open files|exceeds max input/i,
  },
  { class: "memory_error", re: /Cannot allocate memory|out of memory/i },
  // xfade / concat math
  { class: "xfade_offset_error", re: /xfade.*invalid offset/i },
  { class: "concat_error", re: /\[concat.*\] (Cannot|Failed)/i },
  // Catch-all
  { class: "killed_by_signal", re: /Killed|received signal|SIGKILL/i },
  { class: "timeout", re: /timeout|operation timed out/i },
];

/**
 * Classify an ffmpeg failure into one of the known classes.
 * Returns "ffmpeg_unknown" when nothing matches.
 *
 * @param {string|Error} input  stderr text or Error object
 * @returns {string}  the class name (snake_case)
 */
function classifyFfmpegError(input) {
  if (!input) return "ffmpeg_unknown";
  const text =
    typeof input === "string"
      ? input
      : (input.stderr || input.message || "").toString();
  for (const { class: cls, re } of FFMPEG_ERROR_CLASSES) {
    if (re.test(text)) return cls;
  }
  return "ffmpeg_unknown";
}

/**
 * Pre-flight check on a single image path. Returns { ok, width,
 * height, reason }. Dependency-injects sharp so unit tests can
 * stub the image-decode call.
 *
 * Bad inputs:
 *   - file missing
 *   - file under 200 bytes (truncated download)
 *   - sharp decode throws
 *   - dimensions 0x0 or NaN
 *   - dimensions absurdly small (under 32×32 — won't survive scale+crop)
 *
 * The MIN_DIM threshold is conservative: 32×32 is barely a thumbnail
 * but ffmpeg's scale filter will gracefully upscale anything above
 * this. Below it, the chroma subsampling assertions fail.
 */
async function validateImageFile(
  imagePath,
  { sharp = null, fsLib = fs, minBytes = 200, minDim = 32 } = {},
) {
  if (!imagePath) {
    return { ok: false, reason: "no_path", path: imagePath };
  }
  let stat;
  try {
    stat = await fsLib.stat(imagePath);
  } catch (err) {
    return {
      ok: false,
      reason: `stat_failed:${err.code || "unknown"}`,
      path: imagePath,
    };
  }
  if (!stat.isFile()) {
    return { ok: false, reason: "not_a_file", path: imagePath };
  }
  if (stat.size < minBytes) {
    return {
      ok: false,
      reason: `too_small:${stat.size}_bytes`,
      path: imagePath,
      size: stat.size,
    };
  }
  let sharpLib = sharp;
  if (!sharpLib) {
    try {
      sharpLib = require("sharp");
    } catch (err) {
      return {
        ok: false,
        reason: `sharp_missing:${err.message}`,
        path: imagePath,
      };
    }
  }
  let metadata;
  try {
    metadata = await sharpLib(imagePath).metadata();
  } catch (err) {
    return {
      ok: false,
      reason: `sharp_decode:${(err.message || "").slice(0, 120)}`,
      path: imagePath,
    };
  }
  const w = metadata.width || 0;
  const h = metadata.height || 0;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { ok: false, reason: "zero_dimensions", path: imagePath };
  }
  if (w < minDim || h < minDim) {
    return {
      ok: false,
      reason: `dim_too_small:${w}x${h}`,
      path: imagePath,
      width: w,
      height: h,
    };
  }
  return { ok: true, width: w, height: h, size: stat.size, path: imagePath };
}

/**
 * Validate every path in a list. Returns:
 *   { good: [...paths], bad: [...{ path, reason }] }
 *
 * The order of `good` matches the input order (stable filter so the
 * caller can keep priority).
 */
async function validateImageBatch(paths, opts = {}) {
  const good = [];
  const bad = [];
  for (const p of paths || []) {
    const r = await validateImageFile(p, opts);
    if (r.ok) good.push(p);
    else bad.push({ path: p, reason: r.reason });
  }
  return { good, bad };
}

/**
 * Build the structured render_fallback_reason value that gets
 * stamped on the story. Combines the classification with a human-
 * readable tail. Caps at 400 chars.
 */
function buildFallbackReason({
  errorClass = "ffmpeg_unknown",
  detail = "",
  inputsValidated = null,
  inputsBad = null,
} = {}) {
  const parts = [`class=${errorClass}`];
  if (inputsValidated != null)
    parts.push(`inputs_validated=${inputsValidated}`);
  if (inputsBad != null && inputsBad > 0) parts.push(`inputs_bad=${inputsBad}`);
  if (detail) parts.push(`detail=${String(detail).slice(0, 280)}`);
  return parts.join(" | ").slice(0, 400);
}

module.exports = {
  classifyFfmpegError,
  validateImageFile,
  validateImageBatch,
  buildFallbackReason,
  FFMPEG_ERROR_CLASSES,
};
