// The framing of an in-game reconstruction (src/assets/recon.ts picks the clip; components/recon/ReconShot.tsx
// draws it). What makes a game clip read as deliberate scene-setting instead of filler is the language of a
// cinema establishing shot: 2.39:1 letterbox bars that close in as the shot starts, a slow push or drift that
// never stops moving, the clip played a little slow, a grade that pulls the game's colours toward the
// chapter's own palette, and a small tag saying what it is. All pure functions of the frame and a seed, so a
// re-render is identical, and the treatment is settled (bars closed, tag in) long before frame 100.

import type { ReconTag } from "../assets/recon.ts";

export const RECON_W = 1920;
export const RECON_H = 1080;
/** Cinema scope: the picture between the bars is 2.39:1. */
export const SCOPE = 2.39;
/** Height of each letterbox bar at full close (px). */
export const BAR = Math.round((RECON_H - RECON_W / SCOPE) / 2);
/** The bars close over this many frames. */
export const BARS_IN = 14;
/** The tag fades in over these frames. */
export const TAG_IN: [number, number] = [12, 26];
/** On screen, word for word: fixed generic labels only. */
export const RECON_TAG = "RECONSTRUCTION · IN-GAME";

const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeInOut = (x: number) =>
  x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Each bar's height at a frame: closing in from nothing, eased. */
export function barsAt(frame: number): number {
  return Math.round(BAR * easeOut(clamp01(frame / BARS_IN)) * 10) / 10;
}

/** A repeatable 0..1 from a seed (one mulberry32 step). */
function rand(seed: number): number {
  let t = (Math.floor(seed) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface ReconPose {
  scale: number;
  x: number; // px
  y: number; // px
}

export interface ReconMove {
  from: ReconPose;
  to: ReconPose;
}

/**
 * The camera move: always a slow push, with a drift chosen by the scene. An aerial or skyline pass drifts
 * down a little, as a camera tilting toward the city; a drive drifts sideways with the road; an interior
 * barely moves. The side comes from the seed so consecutive reconstructions do not all drift the same way.
 * Scale never drops below 1.06, so a drift never shows the frame's edge.
 *
 * Licensed gameplay captures carry the game's HUD in the corners (the minimap bottom left, money and
 * wanted stars top right; 31 Oct 2026 stills: the minimap sat inside the scope frame). With `hud` the
 * camera stays at least HUD_SCALE in and drifts only leftward (content moving left), which keeps the
 * minimap corner off the left edge for the whole move; the bars take most of the top-right HUD.
 */
export const HUD_SCALE = 1.4;

export function reconMove(
  seed: number,
  tags: ReconTag[] = [],
  hud = false,
): ReconMove {
  const side = rand(seed) < 0.5 ? -1 : 1;
  if (hud)
    return {
      from: { scale: HUD_SCALE, x: 0, y: 0 },
      to: { scale: HUD_SCALE + 0.05, x: -28, y: side * 6 },
    };
  if (tags.includes("interior"))
    return {
      from: { scale: 1.06, x: 0, y: 0 },
      to: { scale: 1.1, x: side * 10, y: 0 },
    };
  if (tags.includes("aerial") || tags.includes("skyline"))
    return {
      from: { scale: 1.08, x: side * -16, y: -14 },
      to: { scale: 1.16, x: side * 16, y: 14 },
    };
  if (tags.includes("vehicle") || tags.includes("street"))
    return {
      from: { scale: 1.1, x: side * -34, y: 0 },
      to: { scale: 1.15, x: side * 34, y: -6 },
    };
  return {
    from: { scale: 1.07, x: side * -12, y: 0 },
    to: { scale: 1.14, x: side * 12, y: 0 },
  };
}

/** The pose at a frame of a shot `len` frames long: eased in and out, moving from the first frame to the last. */
export function poseAt(move: ReconMove, frame: number, len: number): ReconPose {
  const p = easeInOut(clamp01(frame / Math.max(1, len - 1)));
  const mix = (a: number, b: number) =>
    Math.round((a + (b - a) * p) * 1000) / 1000;
  return {
    scale: mix(move.from.scale, move.to.scale),
    x: mix(move.from.x, move.to.x),
    y: mix(move.from.y, move.to.y),
  };
}

export interface ReconGrade {
  /** CSS filter on the footage: a touch less saturated, more contrast, slightly darker. */
  filter: string;
  /** The chapter's colour laid over in "color" blend, and how strongly. */
  tint: string;
  tintOpacity: number;
}

/** A "#rrggbb" colour or undefined. */
function hex(c: string | null | undefined): string | undefined {
  return c && /^#[0-9a-f]{6}$/i.test(c) ? c : undefined;
}

/**
 * The grade: footage pulled toward the chapter's palette (assets.palette, each game's colour from its key
 * art), cooler and a little darker at night, a neutral teal when the chapter has no colour.
 */
export function reconGrade(
  palette: string | null | undefined,
  tags: ReconTag[] = [],
): ReconGrade {
  const night = tags.includes("night");
  return {
    filter: night
      ? "saturate(0.8) contrast(1.1) brightness(0.9)"
      : "saturate(0.86) contrast(1.08) brightness(0.96)",
    tint: hex(palette) ?? "#5f8fa3",
    tintOpacity: night ? 0.2 : 0.16,
  };
}

/** The game's name as the picture labels show it: upper case, with its year. */
export function gameLine(game: string, year?: number | string): string {
  const name = game
    .replace(new RegExp("\\s*[\\u2013\\u2014]\\s*", "g"), ", ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return [name, year === undefined || year === "" ? "" : String(year)]
    .filter(Boolean)
    .join(" · ");
}
