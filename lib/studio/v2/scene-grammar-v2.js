/**
 * lib/studio/v2/scene-grammar-v2.js — extended scene types for the
 * v2 prototype.
 *
 * Adds three new scene types on top of the existing v1 grammar:
 *
 *   - `punch`        1.2–2.2s micro-cut from a trailer clip.
 *                    Used to break up longer beats with rapid-fire
 *                    re-entries to footage. Subject of the visible
 *                    "more cuts per minute" upgrade.
 *
 *   - `speed-ramp`   Clip rendered with a non-1.0 speed envelope.
 *                    Two flavours:
 *                       fast-out: starts at 1.0x, ramps to 0.5x
 *                       slow-in:  starts at 0.5x, ramps to 1.0x
 *                    Visible "intentional edit" cue — used at most
 *                    once per slate to keep it deliberate.
 *
 *   - `freeze-frame` Clip frozen on a single frame with a caption
 *                    beat. Rendered as: clip plays for the first
 *                    0.6s at normal speed, then freezes via tpad
 *                    on the last frame for the remainder of the
 *                    scene. A bold caption appears on the freeze.
 *
 * Each builder returns:
 *   { sceneType, ffmpegInput, ffmpegFilter, ...sceneOpts }
 *
 * The v2 renderer's dispatcher picks builders by sceneType.
 */

"use strict";

const FPS = 30;

function ffEscape(s) {
  return String(s ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "’")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/=/g, "\\=")
    .replace(/%/g, "\\%");
}

/**
 * Build a `punch` scene. Takes a trailer clip + a start offset +
 * a duration. Pulls a sub-slice and renders it to 1080×1920.
 */
function buildPunchScene({ slot, source, startInSourceS, duration, fontOpt }) {
  const escSrc = source.replace(/\\/g, "/");
  // Input: -ss before -i so seeking is fast and accurate
  const ffmpegInput = `-ss ${startInSourceS.toFixed(2)} -t ${(duration + 0.2).toFixed(2)} -i "${escSrc}"`;
  const ffmpegFilter = [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    `fps=${FPS}`,
    `trim=duration=${duration},setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
  return {
    sceneType: "punch",
    ffmpegInput,
    ffmpegFilter,
    duration,
    label: `punch_${slot}`,
    source,
  };
}

/**
 * Build a `speed-ramp` scene. The ramp is implemented via a single
 * `setpts` filter with a piecewise expression.
 *
 * Ramp envelopes:
 *   fast-out:  PTS scale 1.0 → 2.0 over the duration → speed 1.0 → 0.5
 *   slow-in:   PTS scale 2.0 → 1.0 over the duration → speed 0.5 → 1.0
 *
 * setpts uses N (frame index) / FPS / TB so we can interpolate.
 *
 * Note: setpts changes ONLY video timestamps; if we wanted audio
 * sync we'd need atempo too. The v2 renderer always strips audio
 * from clip inputs (we mix the narration on top), so this is fine.
 */
function buildSpeedRampScene({
  slot,
  source,
  startInSourceS,
  duration,
  envelope = "slow-in",
}) {
  const escSrc = source.replace(/\\/g, "/");
  // Read enough source for the slow portion.
  const sourceReadDur = duration * 2.2;
  const ffmpegInput = `-ss ${startInSourceS.toFixed(2)} -t ${sourceReadDur.toFixed(2)} -i "${escSrc}"`;
  // Speed envelope expressed as PTS scaling factor that interpolates
  // linearly from start→end over the duration.
  const dFrames = Math.round(duration * FPS);
  let scaleStart, scaleEnd;
  if (envelope === "fast-out") {
    scaleStart = 1.0;
    scaleEnd = 2.0;
  } else {
    // slow-in
    scaleStart = 2.0;
    scaleEnd = 1.0;
  }
  // Linear interp: scale(t) = scaleStart + (scaleEnd - scaleStart) * (N / dFrames)
  // setpts expression: PTS * scale(t). PTS_NEXT = (N / FPS) * scale.
  // Easier form: setpts = T * scale_fn.
  const setpts = `setpts='(N/${FPS}/TB) * (${scaleStart} + (${scaleEnd - scaleStart}) * min(N/${dFrames}\\,1))'`;

  const ffmpegFilter = [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    `fps=${FPS}`,
    setpts,
    `trim=duration=${duration}`,
    `setpts=PTS-STARTPTS`,
    `format=yuv420p,setsar=1[v${slot}]`,
  ].join(",");
  return {
    sceneType: "speed-ramp",
    envelope,
    ffmpegInput,
    ffmpegFilter,
    duration,
    label: `speedramp_${envelope}_${slot}`,
    source,
  };
}

/**
 * Build a `freeze-frame` scene. The clip plays normally for the
 * first `playInS` seconds, then freezes on the last frame for the
 * remainder of the scene with an optional caption beat overlay.
 *
 * Implementation: tpad with stop_mode=clone holds the last frame.
 * We feed a clip that's playInS long, then tpad pads the
 * remainder up to `duration`.
 */
function buildFreezeFrameScene({
  slot,
  source,
  startInSourceS,
  playInS = 0.6,
  duration,
  caption = "",
  fontOpt,
}) {
  const escSrc = source.replace(/\\/g, "/");
  const isStill = /\.(jpe?g|png|webp|bmp)$/i.test(source);
  // Read just the play portion + a small buffer. tpad will hold the
  // last frame for the rest.
  // For still-image sources, ffmpeg defaults to a single frame —
  // -loop 1 is required to make the input loopable so fps + tpad can
  // produce the correct duration. Without it, the freeze-frame ends
  // up clamped to one frame and the slate runs short.
  const loopFlag = isStill ? "-loop 1 " : "";
  const ffmpegInput = `${loopFlag}-ss ${startInSourceS.toFixed(2)} -t ${(playInS + 0.2).toFixed(2)} -i "${escSrc}"`;
  const padFrames = Math.round((duration - playInS) * FPS);
  const captionText = caption ? ffEscape(caption.toUpperCase()) : null;

  const filterParts = [
    `[${slot}:v]setrange=tv`,
    `scale=1080:1920:force_original_aspect_ratio=increase`,
    `crop=1080:1920:(iw-1080)/2:(ih-1920)/2`,
    `fps=${FPS}`,
    `tpad=stop_mode=clone:stop_duration=${(duration - playInS).toFixed(2)}`,
  ];
  if (captionText) {
    // Caption appears AT the freeze (t >= playInS), with a fast pop
    // animation: scale from 0.85 → 1.0 over 0.18s, then steady.
    const enable = `enable='gte(t\\,${playInS.toFixed(2)})'`;
    const fade = `alpha='if(lt(t-${playInS.toFixed(2)}\\,0.18)\\,(t-${playInS.toFixed(2)})/0.18\\,1)'`;
    // Background bar for legibility
    filterParts.push(
      `drawbox=x=0:y=h/2-90:w=iw:h=180:color=black@0.65:t=fill:${enable}`,
    );
    // Amber accent line above
    filterParts.push(
      `drawbox=x=(w-720)/2:y=h/2-90:w=720:h=4:color=0xFF6B1A@0.95:t=fill:${enable}`,
    );
    filterParts.push(
      `drawtext=text='${captionText}':${fontOpt}:fontcolor=white:fontsize=68:x=(w-tw)/2:y=h/2-32:${fade}:${enable}`,
    );
  }
  filterParts.push(`trim=duration=${duration}`);
  filterParts.push(`setpts=PTS-STARTPTS`);
  filterParts.push(`format=yuv420p,setsar=1[v${slot}]`);

  return {
    sceneType: "freeze-frame",
    ffmpegInput,
    ffmpegFilter: filterParts.join(","),
    duration,
    label: `freeze_${slot}`,
    source,
    caption,
  };
}

/**
 * Plan a slate of "punch" scenes from a longer trailer clip.
 * Splits a 5–6s clip into N short slices (1.4–2.0s each) at
 * deterministic offsets, returning the scene specs the composer
 * can interleave.
 *
 * Returns an array of { startInSourceS, duration } objects ready
 * to feed buildPunchScene.
 */
function planPunchSlicesFromClip(clipPath, clipDurationS, count = 3) {
  const sliceDuration = Math.min(
    2.0,
    Math.max(1.4, clipDurationS / (count + 1)),
  );
  const offsets = [];
  // Spread offsets across the clip with small gaps so each slice
  // shows different content.
  const usableSpan = clipDurationS - sliceDuration;
  if (count === 1 || usableSpan <= 0) {
    offsets.push(0);
  } else {
    for (let i = 0; i < count; i++) {
      offsets.push((usableSpan * i) / Math.max(1, count - 1));
    }
  }
  return offsets.map((startInSourceS, idx) => ({
    source: clipPath,
    startInSourceS,
    duration: Number(sliceDuration.toFixed(2)),
    sliceIndex: idx,
  }));
}

module.exports = {
  buildPunchScene,
  buildSpeedRampScene,
  buildFreezeFrameScene,
  planPunchSlicesFromClip,
  ffEscape,
  FPS,
};
