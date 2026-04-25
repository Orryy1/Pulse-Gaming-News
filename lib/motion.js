/**
 * lib/motion.js — varied per-image motion for the Ken Burns layer.
 *
 * Replaces the rigid `i % 2` zoom + `i % 3` pan logic in the legacy
 * assemble.js. The legacy strategy alternated zoom-in / zoom-out and
 * cycled three pan strategies, so every third image looked
 * mechanically identical. This module:
 *
 *   - exposes a small library of motion presets
 *   - picks a preset per slot using a deterministic hash so the
 *     same story always renders identically (testable + cacheable)
 *   - biases the FIRST image (hook) towards a punchy push-in so
 *     the opening 2s lands with energy
 *   - caps zoom range so images stay sharp (no >1.20 zoom — the
 *     scale=1080:1920:force_original_aspect_ratio=increase upstream
 *     gives us a couple of pixels of headroom but not more)
 *
 * Every preset returns a filter graph fragment that ends with
 * `format=yuv420p,setsar=1` so the downstream xfade chain has a
 * single, predictable pix_fmt to negotiate against.
 */

"use strict";

const FPS = 30;

// Hard caps. Sharpness fades fast above 1.20 with bilinear scaling
// in zoompan; we stay conservative.
const MAX_ZOOM = 1.18;
const MIN_ZOOM = 1.0;

// All presets receive { segmentDurationFrames, slot }. They return a
// zoompan expression body (no leading `[i:v]`, no trailing format).
const PRESETS = {
  // Slow push-in to centre — punchy but not distracting. Good for
  // hooks and any "headline shot".
  pushInCentre(d) {
    const inc = Math.round(10000 * (0.18 / d)) / 10000;
    return [
      `zoompan=z=min(zoom+${inc}\\,${MAX_ZOOM})`,
      `x=iw/2-(iw/zoom/2)`,
      `y=ih/2-(ih/zoom/2)`,
      `d=${d}:s=1080x1920:fps=${FPS}`,
    ].join(":");
  },

  // Pull-back from a zoomed start to natural — reveals context.
  pullBackCentre(d) {
    const inc = Math.round(10000 * (0.18 / d)) / 10000;
    return [
      `zoompan=z=if(eq(on\\,1)\\,${MAX_ZOOM}\\,max(zoom-${inc}\\,${MIN_ZOOM}))`,
      `x=iw/2-(iw/zoom/2)`,
      `y=ih/2-(ih/zoom/2)`,
      `d=${d}:s=1080x1920:fps=${FPS}`,
    ].join(":");
  },

  // Zoom-in panning right. Good for landscape art.
  pushPanRight(d) {
    const inc = Math.round(10000 * (0.15 / d)) / 10000;
    return [
      `zoompan=z=min(zoom+${inc}\\,${MAX_ZOOM})`,
      `x=(iw-iw/zoom)*on/${d}`,
      `y=ih/2-(ih/zoom/2)`,
      `d=${d}:s=1080x1920:fps=${FPS}`,
    ].join(":");
  },

  // Zoom-in panning left.
  pushPanLeft(d) {
    const inc = Math.round(10000 * (0.15 / d)) / 10000;
    return [
      `zoompan=z=min(zoom+${inc}\\,${MAX_ZOOM})`,
      `x=(iw-iw/zoom)*(1-on/${d})`,
      `y=ih/2-(ih/zoom/2)`,
      `d=${d}:s=1080x1920:fps=${FPS}`,
    ].join(":");
  },

  // Subtle drift down — for character art with the face up high.
  driftDown(d) {
    const inc = Math.round(10000 * (0.12 / d)) / 10000;
    return [
      `zoompan=z=min(zoom+${inc}\\,${MAX_ZOOM})`,
      `x=iw/2-(iw/zoom/2)`,
      `y=(ih-ih/zoom)*on/${d}`,
      `d=${d}:s=1080x1920:fps=${FPS}`,
    ].join(":");
  },
};

/**
 * Deterministically pick a preset for `slot` given the total
 * `segmentCount` so the same story always gets the same motion.
 */
function pickPreset(slot, segmentCount) {
  // Slot 0 = hook visual. Always push-in centre — punchy opener.
  if (slot === 0) return "pushInCentre";

  // Slot 1 (post-hook) — pullback for variety after the push-in.
  if (slot === 1) return "pullBackCentre";

  // Last slot — drift down so the outro fades in over a calmer
  // visual.
  if (slot === segmentCount - 1) return "driftDown";

  // Everything else: rotate through pan presets, biased so we
  // don't repeat the same direction twice in a row.
  const rot = ["pushPanRight", "pushInCentre", "pushPanLeft", "pullBackCentre"];
  return rot[(slot - 2) % rot.length];
}

/**
 * Build the per-segment filter expression.
 *
 * @param {object} args
 * @param {number} args.slot               0-indexed segment slot
 * @param {number} args.segmentCount       total segments in the video
 * @param {number} args.segmentDuration    seconds per segment
 * @param {boolean} [args.isVideoSlot]     true if this slot is a video
 *                                         clip — skip the zoompan entirely
 * @returns {string}                       filter graph expression for this
 *                                         slot's `[N:v]` input, ending in
 *                                         the `[vN]` output label.
 */
function buildPerImageMotion({
  slot,
  segmentCount,
  segmentDuration,
  isVideoSlot = false,
}) {
  const dFrames = Math.max(1, Math.round(segmentDuration * FPS));
  const trim = `trim=duration=${segmentDuration},setpts=PTS-STARTPTS`;
  const tail = `${trim},format=yuv420p,setsar=1[v${slot}]`;

  if (isVideoSlot) {
    // Video clips already have motion — just normalise + crop, skip
    // zoompan entirely. This avoids the auto_scale_N regression
    // where ffmpeg tries to rescale a moving source through zoompan.
    return [
      `[${slot}:v]scale=1080:1920:force_original_aspect_ratio=increase`,
      `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
      `fps=${FPS}`,
      tail,
    ].join(",");
  }

  const presetName = pickPreset(slot, segmentCount);
  const zoompan = PRESETS[presetName](dFrames);

  // setrange=tv before zoompan: explicitly mark the input as
  // limited-range so the swscaler doesn't have to guess. This is
  // the fix for the `auto_scale_N: Failed to configure output pad`
  // regression — yuvj420p (JPEG full-range) inputs were failing
  // negotiation against the rest of the filter graph.
  return [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    zoompan,
    tail,
  ].join(",");
}

module.exports = {
  buildPerImageMotion,
  pickPreset,
  PRESETS,
  FPS,
  MAX_ZOOM,
};
