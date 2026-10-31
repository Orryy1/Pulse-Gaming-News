// The one hand behind every Short graphic (owner, 30 Oct 2026: "the same visual fidelity across all
// types"). The Numbers and Words packs (./numbers/kit.tsx, ./words/kit.ts) and the word-moment suite
// (../wordmoment/kit.tsx) all draw from here: the beat's timing (build inside twelve frames, exit over the
// last ten), one paper and one grain, one ink, one shadow ladder, one way of mixing the accent and one
// seeded random. A style keeps its own idea; these are the things a viewer should never see differ
// between two cards. Everything is a pure function.
import { Easing, interpolate } from "remotion";
import { displayText } from "../../timeline.ts";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Remotion easings for interpolate(). */
export const easeOut = Easing.out(Easing.cubic);
export const easeOutQuint = Easing.out(Easing.poly(5));
/** The same curves as plain functions of 0..1. */
export const easeOutFn = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeOutQuintFn = (x: number) => 1 - (1 - clamp01(x)) ** 5;

/** Frames a card takes to leave: a lift, a slight shrink and a fade, the same on every style. */
export const EXIT_FRAMES = 10;

/** 1 until the last EXIT_FRAMES of the beat, then down to 0 (ease in). */
export function exitOf(frame: number, len: number, n = EXIT_FRAMES): number {
  if (!Number.isFinite(len) || len <= n * 2) return 1;
  return interpolate(frame, [len - n, len], [1, 0], {
    ...clamp,
    easing: Easing.in(Easing.quad),
  });
}

/** The exit as a style: `out` from exitOf. */
export const exitStyle = (out: number) => ({
  opacity: out,
  transform: `translateY(${(1 - out) * -26}px) scale(${0.96 + 0.04 * out})`,
});

// ---- Text ---------------------------------------------------------------------------------------

/** Long dashes, written as escapes so no dash character sits in the source. */
const LONG_DASH = new RegExp(" *[\\u2013\\u2014\\u2015] *", "g");

/** Text from the beat as it goes on screen: percent as %, long dashes as `dash`, single spaces. */
export function clean(t: string | undefined, dash = " - "): string {
  return displayText(String(t ?? ""))
    .replace(LONG_DASH, dash)
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Randomness ---------------------------------------------------------------------------------

/** A stable 0..1 for (seed, slot): every "random" choice in a card comes from here, never Math.random. */
export function rnd(seed: number, i: number): number {
  let h =
    (Math.imul(seed | 0, 0x9e3779b1) ^
      Math.imul((i | 0) + 0x632be5ab, 0x85ebca6b)) >>>
    0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** -1..1 */
export const jit = (seed: number, i: number) => rnd(seed, i) * 2 - 1;

/** The Numbers pack's older seeded number, kept so its layouts do not shift. */
export function seeded(variant: number, slot: number): number {
  const x = Math.sin((variant + 1) * 12.9898 + slot * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// ---- Colour -------------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] | null {
  let x = hex.replace("#", "");
  if (x.length === 3)
    x = x
      .split("")
      .map((c) => c + c)
      .join("");
  if (!/^[0-9a-f]{6}$/i.test(x)) return null;
  const n = parseInt(x, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Two colours mixed: t 0 is a, 1 is b. Hex in, hex out. */
export function mix(a: string, b: string, t: number): string {
  const p = rgb(a) ?? [255, 107, 26];
  const q = rgb(b) ?? [255, 107, 26];
  const m = (u: number, v: number) => Math.round(u + (v - u) * t);
  return `#${[m(p[0], q[0]), m(p[1], q[1]), m(p[2], q[2])].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/** The colour at an alpha, for glows and washes; an unreadable hex falls back to amber. */
export function alpha(hex: string, a: number): string {
  const c = rgb(hex) ?? [255, 107, 26];
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
export const rgba = alpha;

/** Ink or paper, whichever reads on the colour. */
export function onAccent(hex: string): string {
  const c = rgb(hex);
  if (!c) return INK;
  const [r, g, b] = c.map((x) => x / 255) as [number, number, number];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.38 ? INK : "#F5F5F2";
}

// ---- Materials ----------------------------------------------------------------------------------

export const INK = "#141312";
/** The channel's paper, flat. */
export const PAPER = "#f3ede0";
/** The channel's paper with its light: a warm cream, brighter at the top left. */
export const PAPER_GRADIENT =
  "linear-gradient(165deg, #fbf8f0 0%, #f3ede0 55%, #e6dfcf 100%)";

/** Fine paper fibres, fainter than the long-form pack's grain: a phone screen shows grain coarse. */
export const SOFT_GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='g' x='0' y='0' width='100%' height='100%'>" +
    "<feTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='2' seed='7' stitchTiles='stitch'/>" +
    "<feColorMatrix values='0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.07  0.8 0 0 0 -0.4'/></filter>" +
    "<rect width='240' height='240' filter='url(#g)'/></svg>",
)}")`;

/**
 * The shadow ladder: a near, sharp shadow and a far, soft one, scaled by `lift` (0.35 a sticky note on
 * a board, 0.6 a phone card, 1 a tag or sheet held off the frame). One ladder so every card sits at a
 * believable height over the footage.
 */
export const shadow = (lift = 1) =>
  `0 ${Math.round(6 * lift)}px ${Math.round(14 * lift)}px rgba(0,0,0,${(0.35 * lift).toFixed(2)}), 0 ${Math.round(28 * lift)}px ${Math.round(70 * lift)}px rgba(0,0,0,${(0.55 * Math.min(1, lift)).toFixed(2)})`;
