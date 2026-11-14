// What a thumbnail or a Short's first frame is made of, as numbers (the pixel part is pure; reading the file uses the
// factory's bundled ffmpeg). Read at tile size, because that is the size a viewer decides at: a 64x36 grid for a long
// video's 16:9 thumbnail, 36x64 for a Short's 9:16 frame. Optional extras come from the PC's local vision model
// (src/assets/localvision.ts packagingLook): a face or character, how big the subject is, how many words are on it.
// Nothing here calls a paid model.
import { FFMPEG } from "../lib/bin.ts";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export const IMAGE_FEATURES = [
  "lum_mean",
  "lum_sd",
  "sat_mean",
  "colourful",
  "edges",
  "centre_focus",
  "subject_area",
  "warm",
  "dark_share",
  "bright_share",
  "text_like",
  "palette_spread",
  // From the local vision model when it answered (otherwise the model's mean is used: no effect).
  "v_face",
  "v_character",
  "v_real_person",
  "v_subject_size",
  "v_words",
] as const;

export type ImageFeatureVector = Partial<
  Record<(typeof IMAGE_FEATURES)[number], number>
>;

const lum = (r: number, g: number, b: number) =>
  (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** Pixel features of an RGB grid (pure). */
export function pixelFeatures(
  rgb: Uint8Array,
  w: number,
  h: number,
): ImageFeatureVector {
  const n = w * h;
  if (!n || rgb.length < n * 3) return {};
  const L = new Float64Array(n);
  const S = new Float64Array(n);
  let rg = 0;
  let yb = 0;
  let rg2 = 0;
  let yb2 = 0;
  let warm = 0;
  let dark = 0;
  let bright = 0;
  const hueBins = new Array(12).fill(0);
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 3]!;
    const g = rgb[i * 3 + 1]!;
    const b = rgb[i * 3 + 2]!;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    L[i] = lum(r, g, b);
    S[i] = mx ? (mx - mn) / mx : 0;
    const a = r - g;
    const c = 0.5 * (r + g) - b;
    rg += a;
    yb += c;
    rg2 += a * a;
    yb2 += c * c;
    if (L[i]! < 0.12) dark++;
    if (L[i]! > 0.85) bright++;
    if (S[i]! > 0.25 && mx > 60) {
      // hue in 12 bins; red, orange and yellow count as warm
      const d = mx - mn || 1;
      let hue =
        mx === r
          ? ((g - b) / d) % 6
          : mx === g
            ? (b - r) / d + 2
            : (r - g) / d + 4;
      hue = (hue * 60 + 360) % 360;
      hueBins[Math.floor(hue / 30) % 12]++;
      if (hue < 60 || hue >= 340) warm++;
    }
  }
  const mean = (v: Float64Array) => v.reduce((x, y) => x + y, 0) / n;
  const lm = mean(L);
  const lsd = Math.sqrt(L.reduce((x, y) => x + (y - lm) ** 2, 0) / n);
  const sm = mean(S);
  const sdRg = Math.sqrt(Math.max(0, rg2 / n - (rg / n) ** 2));
  const sdYb = Math.sqrt(Math.max(0, yb2 / n - (yb / n) ** 2));
  const colourful =
    (Math.sqrt(sdRg ** 2 + sdYb ** 2) +
      0.3 * Math.sqrt((rg / n) ** 2 + (yb / n) ** 2)) /
    150;
  // Gradient magnitude per cell.
  const G = new Float64Array(n);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      G[i] = Math.abs(L[i + 1]! - L[i - 1]!) + Math.abs(L[i + w]! - L[i - w]!);
    }
  const gm = mean(G);
  // Centre focus: detail in the middle third against the border.
  let cIn = 0;
  let cInN = 0;
  let cOut = 0;
  let cOutN = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside =
        x >= w / 4 && x < (3 * w) / 4 && y >= h / 4 && y < (3 * h) / 4;
      if (inside) {
        cIn += G[y * w + x]!;
        cInN++;
      } else {
        cOut += G[y * w + x]!;
        cOutN++;
      }
    }
  const centre = cOutN && cOut ? cIn / cInN / (cOut / cOutN) : 1;
  // Subject area: the bounding box of cells that stand out from the picture's mean colour and brightness.
  const sal = Array.from(
    { length: n },
    (_, i) => Math.abs(L[i]! - lm) + 0.5 * Math.abs(S[i]! - sm),
  );
  const sorted = [...sal].sort((a, b) => a - b);
  const cut = sorted[Math.floor(n * 0.8)]!;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (sal[y * w + x]! > cut && sal[y * w + x]! > 0.05) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  const area = x1 >= 0 ? ((x1 - x0 + 1) * (y1 - y0 + 1)) / n : 0;
  // Text-like rows: many sharp light/dark flips along a row (big captions), as a share of rows.
  let textRows = 0;
  for (let y = 0; y < h; y++) {
    let flips = 0;
    for (let x = 1; x < w; x++)
      if (Math.abs(L[y * w + x]! - L[y * w + x - 1]!) > 0.35) flips++;
    if (flips >= Math.max(4, w / 8)) textRows++;
  }
  const occupied = hueBins.filter((c) => c > n * 0.02).length;
  return {
    lum_mean: lm,
    lum_sd: Math.min(1, lsd * 3),
    sat_mean: sm,
    colourful: Math.min(1, colourful),
    edges: Math.min(1, gm * 4),
    centre_focus: Math.min(1, centre / 3),
    subject_area: area,
    warm: warm / n,
    dark_share: dark / n,
    bright_share: bright / n,
    text_like: textRows / h,
    palette_spread: occupied / 12,
  };
}

/** The grid a format is read at. */
export const gridFor = (format: "short" | "long"): { w: number; h: number } =>
  format === "short" ? { w: 36, h: 64 } : { w: 64, h: 36 };

/** A picture's pixel features, or undefined when ffmpeg cannot read it. */
export async function imageFeatures(
  file: string,
  format: "short" | "long",
): Promise<ImageFeatureVector | undefined> {
  const { w, h } = gridFor(format);
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        `scale=${w}:${h}:flags=area`,
        "-frames:v",
        "1",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20, windowsHide: true },
    );
    return pixelFeatures(new Uint8Array(stdout as unknown as Buffer), w, h);
  } catch {
    return undefined;
  }
}

/** The local vision model's answer as features (pure). */
export function lookFeatures(
  look:
    | {
        subject: "face" | "body" | "thing";
        realPerson: boolean;
        size: number;
        words: number;
      }
    | undefined,
): ImageFeatureVector {
  if (!look) return {};
  return {
    v_face: look.subject === "face" ? 1 : 0,
    v_character: look.subject !== "thing" ? 1 : 0,
    v_real_person: look.realPerson ? 1 : 0,
    v_subject_size: Math.max(0, Math.min(1, look.size)),
    v_words: Math.min(1, look.words / 8),
  };
}

/** Two pictures' difference at a glance (mean absolute grey difference on a 16x9 grid, 0 same to 1 opposite); undefined when either cannot be read. */
export async function imageDistance(a: string, b: string): Promise<number | undefined> {
  const grey = async (file: string) => {
    try {
      const { stdout } = await run(
        FFMPEG,
        ["-v", "error", "-i", file, "-vf", "scale=16:9:flags=area", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        { encoding: "buffer", maxBuffer: 1 << 16, windowsHide: true },
      );
      return new Uint8Array(stdout as unknown as Buffer);
    } catch {
      return undefined;
    }
  };
  const [x, y] = [await grey(a), await grey(b)];
  if (!x || !y || x.length !== y.length || !x.length) return undefined;
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(x[i]! - y[i]!);
  return d / x.length / 255;
}
