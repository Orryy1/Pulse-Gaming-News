// A scale Chrome's GPU rasteriser can always draw. Skia Graphite, Chrome's Metal rasteriser on the Mac, aborts
// the whole GPU process when it clips a rounded box under a matrix with no inverse (Transform.cpp "check(valid)"
// under Device::clipRRect): a shadowed, rounded bar at scaleX(0) did it on 1 Nov 2026, and three aborts drop
// Chrome to a crawl. The PC's rasteriser tolerates the same frame, so nothing shows there. A scale this small is
// under a tenth of a pixel across a full 4K width at most, so the picture is the same as at zero.

export const MIN_SCALE = 0.00002;

/** `v`, moved off zero (keeping its sign) and off NaN, for any scale an animation can start or end at 0. */
export function safeScale(v: number): number {
  if (!Number.isFinite(v)) return MIN_SCALE;
  return Math.abs(v) < MIN_SCALE ? (v < 0 ? -MIN_SCALE : MIN_SCALE) : v;
}
