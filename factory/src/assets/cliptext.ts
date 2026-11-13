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

/** Under this, a ranking clip's vertical crop is a smear: a 240p game blown up, or a whip pan. Read on real clips, 5 Nov 2026; rankings only, as fog and dark scenes also read low. */
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

// ---------------------------------------------------------------- LONG_INWORLD_TEXT
// A long video shows the whole 16:9 picture, and the game's own footage is full of writing that belongs to it: shop
// signs ("THE WELL STACKED PIZZA CO." refused most of San Andreas's full-story movie on 13 Nov 2026), the HUD, mission
// cards, the game's subtitles. None of that is a fault. What is: writing the uploader put on top of the game, a
// channel name or handle, a link, a "subscribe", the upload's own title words, and a fixed caption parked at the
// frame's edge for the whole clip (a watermark in text). Each OCR word is judged by what it says and where it sits.

/** Words only an uploader puts on a game's picture (one OCR word each; links and handles by their marks). */
export const OVERLAY_WORD =
  /^(subscribe[ds]?|subscribers?|patreon|twitch|youtube|discord|instagram|tiktok|twitter|facebook|walkthrough|playthrough|longplay|gameplay|commentary|cutscenes?|1080p|1440p|2160p|720p|60fps|30fps|50fps|4k|8k|remastered)$/i;
/** A link, a handle or a tag, wherever it sits. */
export const OVERLAY_MARK = /(^www\.|https?:|\.(com|net|org|tv|gg|io|co)\b|^@\w{3,}|^#\w{3,})/i;
/** Lettering that is the game's own HUD: money, a clock, a score, ammo (digits and their marks). */
export const HUD_LIKE = /^[\d$£€:.,/%+\-x×]+$/i;
/** A word's centre this near the frame's edge (share of the width or height) is in the edge band. */
export const EDGE_BAND = 0.13;
/** A word at the same place in this share of a clip's samples is fixed there. */
export const FIXED_SHARE = 0.8;
/** How far a fixed word may wander between samples, as a share of the width and height. */
export const FIXED_TOLERANCE = 0.02;

/** An uploader's name split into the words a channel mark would spell ("ThirstyHyena": thirsty, hyena, thirstyhyena). */
export function uploaderWords(uploader: string | undefined): string[] {
  if (!uploader?.trim()) return [];
  const whole = uploader.toLowerCase().replace(/[^a-z0-9]/g, "");
  const parts = uploader
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 5);
  return [...new Set([whole, ...parts].filter((w) => w.length >= 4))];
}

const letters = (t: string) => t.replace(/[^\p{L}\p{N}]/gu, "");
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The words on a clip's sampled pages that are not from the game (pure), and which samples carry one. In-world text
 * (signs, the HUD, mission titles, the game's subtitles) passes; a word fails when it is an uploader's word, a link or
 * handle, the uploader's own name, or when it sits fixed at the frame's edge in nearly every sample (FIXED_SHARE)
 * while not reading like the HUD (digits and money). A clip of one or two samples is judged on its words alone.
 */
export function overlayWords(
  pages: readonly OcrPage[],
  o: { uploader?: string } = {},
): { faulted: boolean[]; words: string[] } {
  const mine = uploaderWords(o.uploader);
  const words: string[] = [];
  const faulted = pages.map(() => false);
  const fixed = new Map<string, Array<{ page: number; cx: number; cy: number }>>();
  for (const [i, page] of pages.entries()) {
    if (!page.width || !page.height) continue;
    for (const w of page.words) {
      const l = letters(w.text);
      if (l.length < 2) continue;
      const n = norm(w.text);
      if (OVERLAY_WORD.test(l) || OVERLAY_MARK.test(w.text.trim()) || (n.length >= 4 && mine.includes(n))) {
        faulted[i] = true;
        words.push(w.text);
        continue;
      }
      if (HUD_LIKE.test(w.text.trim()) || l.length < 3) continue;
      const cx = (w.x + w.w / 2) / page.width;
      const cy = (w.y + w.h / 2) / page.height;
      const edge = cx < EDGE_BAND || cx > 1 - EDGE_BAND || cy < EDGE_BAND || cy > 1 - EDGE_BAND;
      if (!edge) continue;
      const seen = fixed.get(n) ?? [];
      seen.push({ page: i, cx, cy });
      fixed.set(n, seen);
    }
  }
  const sampled = pages.filter((p) => p.width && p.height).length;
  if (sampled >= 3)
    for (const [n, seen] of fixed) {
      const first = seen[0]!;
      const still = seen.filter((s) => Math.abs(s.cx - first.cx) <= FIXED_TOLERANCE && Math.abs(s.cy - first.cy) <= FIXED_TOLERANCE);
      const at = new Set(still.map((s) => s.page));
      if (at.size / sampled < FIXED_SHARE) continue;
      for (const k of at) faulted[k] = true;
      words.push(n);
    }
  return { faulted, words };
}

/**
 * LONG_INWORLD_TEXT: a long video's clip of the game's own footage read for text that is not from the game
 * (overlayWords). Reads like clipBigText and, like it, says clean on any failure: a missing OCR never costs a clip.
 */
export async function clipOverlayText(
  file: string,
  seconds: number,
  o: { uploader?: string } = {},
): Promise<ClipTextResult> {
  const clean = (): ClipTextResult => ({ clean: true, words: [], run: { start: 0, length: seconds } });
  const work = `${file}.ocr`;
  try {
    await fs.mkdir(work, { recursive: true });
    await runCapped(FFMPEG, ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `fps=${1 / TEXT_SAMPLE_STEP},scale=960:-2`, "-q:v", "3", path.join(work, "f%03d.jpg")]);
    const frames = (await fs.readdir(work))
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f) => path.join(work, f));
    if (!frames.length) return clean();
    const pages = await readText(frames);
    if (!pages.size) return clean();
    const read = overlayWords(
      frames.map((f) => pages.get(f) ?? { width: 0, height: 0, words: [] }),
      o,
    );
    return {
      clean: !read.faulted.some(Boolean),
      words: read.words,
      run: longestCleanRun(read.faulted, TEXT_SAMPLE_STEP, seconds),
    };
  } catch {
    return clean();
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}
