// Trailer title text showing through (world-class audit, Nov 2026: "DARK SOULS II" JED9VogSPMI 0:05, "ULTIMATE SO"
// iJMwsvsH5js 0:10, "LAUNCH TRAILER" GTq4ZuV0MSg 0:20). A Short shows the middle third of a 16:9 trailer, so a title
// card becomes a giant fragment behind the captions. Each clip is read a few times a second by the OCR built into the
// machine (src/assets/ocr.ts: free, local) and only large lettering inside what the crop keeps counts: a HUD, a menu
// line or small in-world sign is left alone. A clip with such lettering is cut down to its longest clean run; with no
// usable run it goes. Where no OCR exists (Linux) nothing is found and clips pass, as they did before.

import fs from "node:fs/promises";
import path from "node:path";
import { runCapped } from "../lib/child.ts";
import { FFMPEG } from "../lib/bin.ts";
import { readText, type OcrPage } from "./ocr.ts";

/** The share of a 16:9 picture's width a full-bleed 9:16 crop keeps, with a little margin. */
export const CROP_KEEPS = 0.36;
/** Lettering this tall (share of the picture's height) is a title card, not a HUD or a street sign. */
export const BIG_LETTERS = 0.045;
export const TEXT_SAMPLE_STEP = 0.5;

/** The big words a viewer would see in the vertical crop. Noise (single marks, symbols) does not count. */
export function bigWordsInCrop(page: OcrPage): string[] {
  if (!page.width || !page.height) return [];
  const wide = page.width / page.height > 1.2;
  const left = wide ? (1 - CROP_KEEPS) / 2 : 0;
  const right = wide ? 1 - left : 1;
  const hits: string[] = [];
  for (const w of page.words) {
    const letters = w.text.replace(/[^\p{L}\p{N}]/gu, "");
    if (letters.length < 2) continue;
    if (w.h / page.height < BIG_LETTERS) continue;
    const mid = (w.x + w.w / 2) / page.width;
    const overlaps =
      w.x / page.width < right && (w.x + w.w) / page.width > left;
    if (overlaps && mid > left - 0.1 && mid < right + 0.1) hits.push(w.text);
  }
  return hits;
}

/** The longest run of clean samples, in seconds from the clip's start; a sample stands for its step. */
export function longestCleanRun(
  faulted: boolean[],
  step: number,
  seconds: number,
): { start: number; length: number } {
  let best = { start: 0, length: 0 };
  let from = -1;
  for (let i = 0; i <= faulted.length; i++) {
    if (i < faulted.length && !faulted[i]) {
      if (from < 0) from = i;
      continue;
    }
    if (from >= 0) {
      const start = from === 0 ? 0 : from * step + 0.1;
      const end =
        i === faulted.length
          ? seconds
          : Math.max(0, (i - 1) * step + step - 0.1);
      if (end - start > best.length) best = { start, length: end - start };
      from = -1;
    }
  }
  return best;
}

/** The big words on one still, as the vertical crop would show them; none where there is no OCR. */
export async function stillBigText(file: string): Promise<string[]> {
  try {
    const pages = await readText([file]);
    const page = pages.get(file);
    return page ? bigWordsInCrop(page) : [];
  } catch {
    return [];
  }
}

/** Under this, a clip's vertical crop is a smear: a 240p game blown up, or a whip pan. Read on real clips, 5 Nov 2026. */
export const CLIP_DETAIL_FLOOR_KB = 8;

/**
 * How much detail survives the vertical crop: mean JPEG size of three frames at a fixed size and quality, in KB (fine
 * detail costs bytes). The smeared clips the vision check failed on a ranking read 6 to 7; clean footage 9 to 15.
 * Undefined when it cannot say, and a clip is never dropped on that.
 */
export async function clipDetailKb(
  file: string,
  seconds: number,
): Promise<number | undefined> {
  const work = `${file}.detail`;
  try {
    await fs.mkdir(work, { recursive: true });
    const sizes: number[] = [];
    for (const [i, k] of [0.2, 0.5, 0.8].entries()) {
      const out = path.join(work, `${i}.jpg`);
      await runCapped(FFMPEG, [
        "-y",
        "-loglevel",
        "error",
        "-ss",
        (seconds * k).toFixed(2),
        "-i",
        file,
        "-frames:v",
        "1",
        "-vf",
        "scale=-2:360,crop=200:360",
        "-q:v",
        "4",
        out,
      ]);
      sizes.push((await fs.stat(out)).size / 1024);
    }
    return sizes.reduce((a, b) => a + b, 0) / sizes.length;
  } catch {
    return undefined;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface ClipTextResult {
  clean: boolean;
  words: string[];
  /** The longest stretch with no big lettering. */
  run: { start: number; length: number };
}

/** Reads a clip already cut. On any failure it says clean: a missing OCR must never cost a clip. */
export async function clipBigText(
  file: string,
  seconds: number,
): Promise<ClipTextResult> {
  const clean = (): ClipTextResult => ({
    clean: true,
    words: [],
    run: { start: 0, length: seconds },
  });
  const work = `${file}.ocr`;
  try {
    await fs.mkdir(work, { recursive: true });
    await runCapped(FFMPEG, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      file,
      "-vf",
      `fps=${1 / TEXT_SAMPLE_STEP},scale=960:-2`,
      "-q:v",
      "3",
      path.join(work, "f%03d.jpg"),
    ]);
    const frames = (await fs.readdir(work))
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f) => path.join(work, f));
    if (!frames.length) return clean();
    const pages = await readText(frames);
    if (!pages.size) return clean();
    const words: string[] = [];
    const faulted = frames.map((f) => {
      const hits = bigWordsInCrop(
        pages.get(f) ?? { width: 0, height: 0, words: [] },
      );
      words.push(...hits);
      return hits.length > 0;
    });
    return {
      clean: !faulted.some(Boolean),
      words,
      run: longestCleanRun(faulted, TEXT_SAMPLE_STEP, seconds),
    };
  } catch {
    return clean();
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
