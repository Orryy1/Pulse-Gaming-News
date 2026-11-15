// 2.5D stills in Shorts (SHORT_PARALLAX, improvement engine 15 Nov 2026). The Sunday retention curves showed viewers
// leaving 1.3 times as fast while a still picture is up (faster in 56 of 81 Shorts, about 24.5 s of stills a Short).
// Long videos already cut their wide stills into depth layers (src/render/parallax.ts) and drift them like a camera
// move; Shorts only did that for the opening hero. This works out each layer's drift, so a still reads as footage.
// Pure: the pipeline runs the depth model (src/render/parallax.ts picks the stills), components/Background.tsx draws.
// Browser-safe (the Remotion bundle loads it): the selection lives in src/render/parallax.ts.

/** The three layers, back to front, with how far each moves against the back one (nearer moves further). */
export const SHORT_DEPTH_LAYERS = [
  { key: "bg", k: 0 },
  { key: "mid", k: 0.6 },
  { key: "fg", k: 1.4 },
] as const;

/** Sideways travel of the nearest layer over the whole shot, in pixels of the 1080-wide frame. */
export const SHORT_DEPTH_TRUCK = 30;

/**
 * One layer's scale and offset at progress p (0-1) of the shot (pure). The still's own ambient move is shared by
 * every layer, so it keeps its usual direction; on top, the camera trucks across and the nearer layers travel
 * further and grow a touch, the 2.5D look. The scale is never less than what keeps the layer's edges outside a
 * frame `width` wide (CSS: scale(s) translate(x), so the layer shifts x * s on screen).
 */
export function shortDepthTransform(
  k: number,
  p: number,
  dir: 1 | -1,
  base: { scale: number; x: number; y: number },
  width = 1080,
): { scale: number; x: number; y: number } {
  const t = Math.min(1, Math.max(0, p));
  const truck = (t - 0.5) * SHORT_DEPTH_TRUCK * dir;
  const x = base.x + truck * k;
  const half = width / 2;
  const cover = half / Math.max(1, half - Math.abs(x)) + 0.005;
  return {
    scale: Math.max(base.scale + 0.04 + 0.03 * k * t, cover),
    x,
    y: base.y,
  };
}

/** Whether a layer's edge stays outside a frame of this width at this transform (pure; for tests and checks). */
export function edgesCovered(
  width: number,
  tr: { scale: number; x: number },
): boolean {
  const spare = ((tr.scale - 1) * width) / 2; // how far the scaled layer reaches past each side
  return Math.abs(tr.x) * tr.scale <= spare + 1e-9;
}
