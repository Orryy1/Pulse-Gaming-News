// Helpers shared by the franchise motifs (../Franchises.tsx): seeded numbers, the card's fade, and type
// fitting from measured advance widths, so a heading of any length fills its block without overflowing.
import { interpolate } from "remotion";

export const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

/** A seeded number in [0, 1): the same on every render. */
export const rand = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A card's opacity: in over 4 frames, out over the last 10. */
export function cardFade(frame: number, frames: number): number {
  const f = Math.max(30, frames);
  return interpolate(frame, [0, 4, f - 10, f], [0, 1, 1, 0], clamp);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/** Advance widths in em, measured from the font files; `avg` covers anything not listed. */
export type Metrics = { w: Record<string, number>; avg: number };

const table = (chars: string, widths: number[], avg: number): Metrics => {
  const w: Record<string, number> = {};
  chars.split("").forEach((c, i) => {
    if (widths[i] !== undefined) w[c] = widths[i]!;
  });
  return { w, avg };
};

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,:;'!?&-/()%$#+";

/** Anton (DISPLAY), upper case. */
export const ANTON = table(
  UPPER,
  [
    0.485, 0.479, 0.474, 0.493, 0.412, 0.399, 0.485, 0.499, 0.227, 0.466, 0.472,
    0.397, 0.746, 0.498, 0.486, 0.472, 0.494, 0.477, 0.461, 0.396, 0.474, 0.469,
    0.712, 0.484, 0.446, 0.41, 0.494, 0.331, 0.494, 0.494, 0.494, 0.494, 0.494,
    0.494, 0.494, 0.494, 0.234, 0.229, 0.236, 0.242, 0.245, 0.214, 0.229, 0.492,
    0.52, 0.311, 0.405, 0.291, 0.291, 1.057, 0.462, 0.546, 0.355,
  ],
  0.5,
);

/** Rockwell Bold, upper case. */
export const SLAB_BOLD = table(
  UPPER,
  [
    0.698, 0.698, 0.781, 0.802, 0.667, 0.646, 0.844, 0.76, 0.427, 0.406, 0.781,
    0.646, 1.042, 0.792, 0.854, 0.667, 0.854, 0.729, 0.531, 0.677, 0.677, 0.698,
    0.99, 0.74, 0.698, 0.646, 0.552, 0.552, 0.552, 0.552, 0.552, 0.552, 0.552,
    0.552, 0.552, 0.552, 0.25, 0.354, 0.354, 0.354, 0.354, 0.281, 0.354, 0.563,
    0.802, 0.344, 0.508, 0.344, 0.344, 0.927, 0.563, 0.668, 0.668,
  ],
  0.74,
);

/** Rockwell regular, mixed case (quotes). */
export const SLAB = table(
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,:;'!?-",
  [
    0.698, 0.583, 0.76, 0.729, 0.625, 0.552, 0.802, 0.708, 0.313, 0.313, 0.625,
    0.521, 0.875, 0.719, 0.802, 0.573, 0.802, 0.604, 0.531, 0.573, 0.677, 0.708,
    1.0, 0.656, 0.646, 0.563, 0.531, 0.646, 0.521, 0.625, 0.573, 0.292, 0.625,
    0.573, 0.292, 0.292, 0.573, 0.292, 0.865, 0.573, 0.573, 0.625, 0.615, 0.417,
    0.458, 0.302, 0.563, 0.542, 0.771, 0.552, 0.563, 0.448, 0.542, 0.542, 0.542,
    0.542, 0.542, 0.542, 0.542, 0.542, 0.542, 0.542, 0.25, 0.292, 0.292, 0.292,
    0.292, 0.177, 0.292, 0.469, 0.354,
  ],
  0.58,
);

/** Palatino, upper case (the engraved capitals). */
export const ROMAN = table(
  UPPER,
  [
    0.778, 0.611, 0.709, 0.774, 0.611, 0.556, 0.763, 0.832, 0.337, 0.333, 0.726,
    0.611, 0.946, 0.831, 0.786, 0.604, 0.786, 0.668, 0.525, 0.613, 0.778, 0.722,
    1.0, 0.667, 0.667, 0.667, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5,
    0.25, 0.25, 0.25, 0.25, 0.25, 0.208, 0.278, 0.444, 0.778, 0.333, 0.32,
    0.333, 0.333, 0.84, 0.5, 0.479, 0.5,
  ],
  0.7,
);

/** Any monospace face (Consolas 0.55, Menlo and Courier 0.6): the wider one, to be safe. */
export const MONO_METRICS: Metrics = { w: {}, avg: 0.6 };

/** A line's width in em, `tracking` em added after each character (CSS letter-spacing). */
export function textEm(text: string, m: Metrics, tracking = 0): number {
  let sum = 0;
  for (const c of text) sum += (m.w[c] ?? m.avg) + tracking;
  return sum;
}

/** Words split into k lines whose widest line is as narrow as it can be. */
function partition(
  words: string[],
  k: number,
  m: Metrics,
  tracking: number,
): string[] | undefined {
  const n = words.length;
  if (k < 1 || k > n) return undefined;
  const width = (a: number, b: number) =>
    textEm(words.slice(a, b).join(" "), m, tracking);
  const INF = 1e9;
  const cost: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(INF),
  );
  const cut: number[][] = Array.from({ length: k + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  cost[0]![0] = 0;
  for (let j = 1; j <= k; j++)
    for (let i = j; i <= n; i++)
      for (let p = j - 1; p < i; p++) {
        const c = Math.max(cost[j - 1]![p]!, width(p, i));
        if (c < cost[j]![i]!) {
          cost[j]![i] = c;
          cut[j]![i] = p;
        }
      }
  const lines: string[] = [];
  let i = n;
  for (let j = k; j >= 1; j--) {
    const p = cut[j]![i]!;
    lines.unshift(words.slice(p, i).join(" "));
    i = p;
  }
  return lines;
}

export type FitOptions = {
  /** Box width and height in px. */
  width: number;
  height: number;
  /** Line height as a multiple of the font size. */
  lineHeight: number;
  maxLines: number;
  maxSize: number;
  minSize: number;
  /** Letter-spacing in em. */
  tracking?: number;
  /** Extra em per line (padding of a box around each line). */
  padEm?: number;
};

/** The biggest size, and the balanced line breaks, that fit the text in the box. */
export function fitText(
  text: string,
  m: Metrics,
  o: FitOptions,
): { size: number; lines: string[] } {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return { size: o.minSize, lines: [] };
  let best: { size: number; lines: string[] } | undefined;
  for (let k = 1; k <= Math.min(o.maxLines, words.length); k++) {
    const lines = partition(words, k, m, o.tracking ?? 0);
    if (!lines) continue;
    const em =
      Math.max(...lines.map((l) => textEm(l, m, o.tracking ?? 0))) +
      (o.padEm ?? 0);
    const size = Math.min(
      o.maxSize,
      o.width / em,
      o.height / (k * o.lineHeight),
    );
    // One more line has to buy real size, not a point or two.
    if (!best || size > best.size * 1.08) best = { size, lines };
  }
  const out = best ?? { size: o.minSize, lines: words };
  return { size: Math.max(o.minSize, Math.floor(out.size)), lines: out.lines };
}

/** Does the text fit the box at no less than `minSize`? (For a style's fits().) */
export function fitsAt(text: string, m: Metrics, o: FitOptions): boolean {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  for (let k = 1; k <= Math.min(o.maxLines, words.length); k++) {
    const lines = partition(words, k, m, o.tracking ?? 0);
    if (!lines) continue;
    const em =
      Math.max(...lines.map((l) => textEm(l, m, o.tracking ?? 0))) +
      (o.padEm ?? 0);
    if (Math.min(o.width / em, o.height / (k * o.lineHeight)) >= o.minSize)
      return true;
  }
  return false;
}
