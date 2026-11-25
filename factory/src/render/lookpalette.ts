// GAME_LOOK: a game's palette from its key art and logo (src/tools/gamelook-build.ts feeds this the pixels). Pure,
// so tests pin the rules: the accent is the art's most vivid prominent colour, lifted until it reads on the ink
// (4.5:1 or better); the second accent is a clearly different hue; the ink is the art's darkest colour pressed
// near black; the text is a warm white with a touch of the accent, at least 12:1 on the ink.

export type Rgb = [number, number, number];

export const hex = (c: Rgb) =>
  `#${c
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

export function parseHex(h: string): Rgb {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function lin(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(c: Rgb): number {
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function toHsl([r, g, b]: Rgb): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === R
      ? ((G - B) / d + (G < B ? 6 : 0)) * 60
      : max === G
        ? ((B - R) / d + 2) * 60
        : ((R - G) / d + 4) * 60;
  return [h, s, l];
}

export function fromHsl(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

/** k-means over RGB pixels (k colours), seeded deterministically from the sorted pixels. */
export function clusters(
  pixels: Uint8Array | number[],
  k = 8,
  rounds = 12,
): Array<{ c: Rgb; share: number }> {
  const pts: Rgb[] = [];
  for (let i = 0; i + 2 < pixels.length; i += 3)
    pts.push([pixels[i]!, pixels[i + 1]!, pixels[i + 2]!]);
  if (!pts.length) return [];
  const sorted = [...pts].sort((a, b) => luminance(a) - luminance(b));
  let centres: Rgb[] = Array.from(
    { length: Math.min(k, pts.length) },
    (_, i) =>
      [
        ...sorted[
          Math.floor(((i + 0.5) / Math.min(k, pts.length)) * sorted.length)
        ]!,
      ] as Rgb,
  );
  let counts: number[] = [];
  for (let r = 0; r < rounds; r++) {
    const sums = centres.map(() => [0, 0, 0]);
    counts = centres.map(() => 0);
    for (const p of pts) {
      let best = 0;
      let bd = Infinity;
      centres.forEach((c, j) => {
        const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
        if (d < bd) {
          bd = d;
          best = j;
        }
      });
      sums[best]![0]! += p[0];
      sums[best]![1]! += p[1];
      sums[best]![2]! += p[2];
      counts[best]!++;
    }
    centres = centres.map((c, j) =>
      counts[j] ? (sums[j]!.map((v) => v / counts[j]!) as Rgb) : c,
    );
  }
  return centres
    .map((c, j) => ({ c, share: (counts[j] ?? 0) / pts.length }))
    .filter((x) => x.share > 0)
    .sort((a, b) => b.share - a.share);
}

/** A colour lifted (lightness up, keeping its hue) until it reads at `ratio` on the ink. */
export function readableOn(c: Rgb, ink: Rgb, ratio = 4.5): Rgb {
  const [h, s, l0] = toHsl(c);
  let out = c;
  for (let l = l0; l <= 0.95 && contrast(out, ink) < ratio; l += 0.02)
    out = fromHsl(h, Math.max(s, 0.45), l);
  return out.map((v) => Math.round(v)) as Rgb;
}

/**
 * The mean of the art's own vivid pixels near a hue (within 30 degrees, saturation over 0.4, neither near black nor
 * near white), when they cover at least 0.3% of it: a small red logo on a grey cover still leads. Else undefined.
 */
export function hintedColour(
  pixels: Uint8Array | number[],
  hue: number,
): Rgb | undefined {
  let n = 0;
  let total = 0;
  const sum = [0, 0, 0];
  for (let i = 0; i + 2 < pixels.length; i += 3) {
    total++;
    const c: Rgb = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
    const [h, s, l] = toHsl(c);
    if (s < 0.4 || l < 0.18 || l > 0.85 || hueGap(h, hue) > 30) continue;
    n++;
    sum[0]! += c[0];
    sum[1]! += c[1];
    sum[2]! += c[2];
  }
  if (!total || n / total < 0.003) return undefined;
  return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
}

export interface LookPalette {
  accent: string;
  accent2: string;
  ink: string;
  paper: string;
  muted: string;
}

/**
 * The palette from the art's pixels (and the logo's, weighted in as they are passed). A hint (a hex colour) wins
 * the accent when the art has enough vivid pixels near its hue (hintedColour): the profile can steer which of the art's own
 * colours leads without inventing one.
 */
export function lookPalette(
  pixels: Uint8Array | number[],
  hint?: string,
): LookPalette {
  const cs = clusters(pixels, 10);
  const vivid = (x: { c: Rgb; share: number }) => {
    const [, s, l] = toHsl(x.c);
    const lightOk = l > 0.22 && l < 0.85 ? 1 : 0.25;
    return s * Math.sqrt(x.share) * lightOk;
  };
  const byVivid = [...cs].sort((a, b) => vivid(b) - vivid(a));
  const hintHue = hint ? toHsl(parseHex(hint))[0] : undefined;
  const hinted =
    hintHue !== undefined ? hintedColour(pixels, hintHue) : undefined;
  const lead = hinted ? { c: hinted, share: 0 } : byVivid[0];
  const darkest = [...cs].sort((a, b) => luminance(a.c) - luminance(b.c))[0];
  const [dh, ds] = darkest ? toHsl(darkest.c) : [0, 0];
  const ink = fromHsl(dh, Math.min(ds, 0.35), 0.055).map((v) =>
    Math.round(v),
  ) as Rgb;
  const accentRaw = lead?.c ?? [255, 107, 26];
  const accent = readableOn(accentRaw, ink, 4.5);
  const aHue = toHsl(accent)[0];
  const second = byVivid.find(
    (x) =>
      x !== lead && toHsl(x.c)[1] > 0.2 && hueGap(toHsl(x.c)[0], aHue) > 40,
  );
  const accent2 = readableOn(
    second?.c ?? fromHsl((aHue + 40) % 360, 0.6, 0.55),
    ink,
    3,
  );
  const paper = fromHsl(toHsl(accent)[0], 0.25, 0.95).map((v) =>
    Math.round(v),
  ) as Rgb;
  const muted = readableOn(fromHsl(toHsl(accent)[0], 0.08, 0.62), ink, 4.5);
  return {
    accent: hex(accent),
    accent2: hex(accent2),
    ink: hex(ink),
    paper: hex(paper),
    muted: hex(muted),
  };
}
