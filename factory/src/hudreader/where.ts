// "Where" for a clip (HUD_PIN): the spot on the stitched map the clip happens at, and a name for it. Pure.
//
// The position is the median of the placed samples in the clip's window (a misplaced frame cannot move it). The name,
// best first:
//   1. the area name the game printed during the clip (GTA V writes it bottom right): read off this very footage;
//   2. the nearest place the atlas has learned a name for, within NAME_RADIUS map units: "near Vespucci Canals";
//   3. none: the pin then shows only "Day N spot" and the map, never an invented name.
// Confidence is the share of the window's live-play samples the minimap placed, halved when they disagree (spread
// wider than SPREAD_LIMIT): a pin under the bar is not drawn.

import type { RawPlace, HudTrack } from "./telemetry.ts";

export const NAME_RADIUS = 700;
export const SPREAD_LIMIT = 400;

export interface Pin {
  island: number;
  x: number;
  y: number;
  label?: string;
  /** "screen": printed by the game during the clip; "atlas": the nearest named place; "none". */
  labelSource: "screen" | "atlas" | "none";
  confidence: number;
  /** Seconds into the recording the pin rests on (the window's middle placed sample). */
  t: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2
    ? s[(s.length - 1) / 2]!
    : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** The pin for a window of a track (pure); undefined when nothing in it was placed. */
export function pinFor(
  track: HudTrack,
  from: number,
  to: number,
  places: RawPlace[] = [],
): Pin | undefined {
  const inWin = track.points.filter((p) => p.t >= from && p.t <= to);
  const hud = inWin.filter((p) => p.state === "hud");
  const placed = hud.filter(
    (p) => p.island !== undefined && p.x !== undefined && p.y !== undefined,
  );
  if (!placed.length) return undefined;
  // The island most of the window is on.
  const counts = new Map<number, number>();
  for (const p of placed)
    counts.set(p.island!, (counts.get(p.island!) ?? 0) + 1);
  const island = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  const on = placed.filter((p) => p.island === island);
  const x = median(on.map((p) => p.x!));
  const y = median(on.map((p) => p.y!));
  const spread = median(on.map((p) => Math.hypot(p.x! - x, p.y! - y)));
  let confidence = on.length / Math.max(1, hud.length);
  if (spread > SPREAD_LIMIT) confidence /= 2;
  const mid = on[Math.floor(on.length / 2)]!;
  const screen = track.events
    .filter((e) => e.kind === "area" && e.t >= from - 5 && e.t <= to && e.text)
    .pop()?.text;
  let label: string | undefined;
  let labelSource: Pin["labelSource"] = "none";
  if (screen) {
    label = screen;
    labelSource = "screen";
  } else {
    const near = places
      .filter((p) => p.island === island)
      .map((p) => ({ p, d: Math.hypot(p.x - x, p.y - y) }))
      .filter((c) => c.d <= NAME_RADIUS)
      .sort((a, b) => a.d - b.d || b.p.seen - a.p.seen)[0];
    if (near) {
      label = near.d < NAME_RADIUS / 3 ? near.p.name : `near ${near.p.name}`;
      labelSource = "atlas";
    }
  }
  return {
    island,
    x: Math.round(x),
    y: Math.round(y),
    ...(label ? { label } : {}),
    labelSource,
    confidence: Math.round(confidence * 100) / 100,
    t: mid.t,
  };
}
