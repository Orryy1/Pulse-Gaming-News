// Each game's own colour (owner, 28 Oct 2026: bespoke colour per video): the dominant vivid colour of a
// picture, read from a 24x24 thumbnail of it. The long renderer washes that game's chapter in it (Pulse
// amber stays the colour of the text and graphics).
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";

const run = promisify(execFile);

/** The strongest vivid hue of some RGB pixels, as "#rrggbb"; undefined for a grey or near-black picture. */
export function dominantVivid(rgb: Uint8Array): string | undefined {
  const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 2 < rgb.length; i += 3) {
    const r = rgb[i]! / 255;
    const g = rgb[i + 1]! / 255;
    const b = rgb[i + 2]! / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max ? (max - min) / max : 0;
    if (sat < 0.25 || max < 0.2) continue;
    let h = 0;
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    const bin = bins[Math.floor(((((h * 60) % 360) + 360) % 360) / 30)]!;
    const w = sat * max;
    bin.w += w;
    bin.r += r * w;
    bin.g += g * w;
    bin.b += b * w;
  }
  const best = bins.reduce((a, c) => (c.w > a.w ? c : a));
  if (best.w < 2) return undefined;
  // Brought to a usable brightness so a dark poster still gives a colour that reads as a wash.
  let [r, g, b] = [best.r / best.w, best.g / best.w, best.b / best.w];
  const k = 0.85 / Math.max(r, g, b);
  [r, g, b] = [r * k, g * k, b * k];
  const hex = (x: number) =>
    Math.round(Math.min(1, x) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** The picture's dominant vivid colour, or undefined when it has none or cannot be read. */
export async function paletteOf(file: string): Promise<string | undefined> {
  try {
    const { stdout } = await run(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        file,
        "-vf",
        "scale=24:24",
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
    return dominantVivid(new Uint8Array(stdout as unknown as Buffer));
  } catch {
    return undefined;
  }
}
