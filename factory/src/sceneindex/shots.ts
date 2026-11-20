// Splitting a game movie into shots (pure maths, tested without ffmpeg). The scan gives one row a sampled frame
// (time, brightness, frame difference, ffmpeg's scene score); cuts come from the matcher's own detector
// (src/assets/clipscore.ts detectCuts) so a shot here is the same thing a clip there is. A text-box conversation
// can hold one camera for minutes, so long shots are divided into even parts: each part gets its own keyframes and
// description, and a lookup lands near the line it wants instead of somewhere in a two-minute shot.

import { detectCuts } from "../assets/clipscore.ts";

export interface ScanRow {
  time: number;
  luma: number;
  motion: number;
  scene?: number;
}

/** A shot shorter than this is a flash or a transition frame: it joins the shot before it. */
export const MIN_SHOT_SECONDS = 0.7;
/** A shot longer than this is divided into even parts no longer than it. */
export const MAX_SHOT_SECONDS = 12;
/** Below this mean brightness the whole shot is a fade or a black card. */
export const BLANK_LUMA = 14;

export interface ShotSpan {
  start: number;
  end: number;
  luma: number;
  motion: number;
  blank: boolean;
}

/**
 * Shot boundaries inside [from, to) from cut times: cuts outside the stretch are ignored, a shot shorter than
 * `min` joins its neighbour, a shot longer than `max` is divided evenly. Always covers the stretch end to end
 * with no gaps or overlaps.
 */
export function splitShots(
  cuts: number[],
  from: number,
  to: number,
  o: { min?: number; max?: number } = {},
): Array<{ start: number; end: number }> {
  const min = o.min ?? MIN_SHOT_SECONDS;
  const max = o.max ?? MAX_SHOT_SECONDS;
  if (!(to > from)) return [];
  const edges = [from];
  for (const c of [...cuts].sort((a, b) => a - b)) {
    if (c <= from || c >= to) continue;
    // A cut too close to the last edge would make a shot too short to show: the earlier edge stands.
    if (c - edges[edges.length - 1]! < min) continue;
    edges.push(c);
  }
  // The last shot must be long enough too: otherwise it joins the one before.
  if (edges.length > 1 && to - edges[edges.length - 1]! < min) edges.pop();
  edges.push(to);
  const out: Array<{ start: number; end: number }> = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    const parts = Math.max(1, Math.ceil((b - a) / max - 1e-9));
    for (let k = 0; k < parts; k++)
      out.push({
        start: round(a + ((b - a) * k) / parts),
        end: round(a + ((b - a) * (k + 1)) / parts),
      });
  }
  return out;
}

const round = (t: number) => Math.round(t * 100) / 100;

/**
 * The moments of a shot to look at: its middle when short, two when it runs a few seconds, three beyond that.
 * Never on the first or last tenth, where a dissolve is still mixing two pictures.
 */
export function keyframeTimes(start: number, end: number): number[] {
  const len = end - start;
  if (len <= 0) return [];
  const at = (f: number) => round(start + len * f);
  if (len < 2.5) return [at(0.5)];
  if (len < 6) return [at(0.25), at(0.75)];
  return [at(0.15), at(0.5), at(0.85)];
}

/** Shots of a stretch from its scan rows, each with its mean brightness and movement. Times are source seconds. */
export function shotsFromScan(
  rows: ScanRow[],
  from: number,
  to: number,
  o: { min?: number; max?: number } = {},
): ShotSpan[] {
  const cuts = detectCuts(rows);
  return splitShots(cuts, from, to, o).map((s) => {
    let luma = 0;
    let motion = 0;
    let n = 0;
    for (const r of rows) {
      // The frame on a cut carries the cut's own difference: not the shot's movement.
      if (r.time < s.start + 0.15 || r.time >= s.end) continue;
      luma += r.luma;
      motion += r.motion;
      n++;
    }
    const mean = n ? luma / n : 0;
    return {
      ...s,
      luma: Math.round(mean * 10) / 10,
      motion: Math.round((n ? motion / n : 0) * 10) / 10,
      blank: n > 0 && mean < BLANK_LUMA,
    };
  });
}
