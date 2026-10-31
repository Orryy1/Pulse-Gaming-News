// Named details found by reading a picture's text (31 Oct 2026, the documentary's camera, src/render/camera.ts):
// when a sentence names something written in the screenshot on screen (a sign, a shop front, a street name),
// the camera can push in on it and a hand-drawn circle or arrow lands on it as the word is said. The words
// and their boxes come from the OCR engine built into Windows (src/assets/winocr.ps1): local, free and
// nothing to install. Anywhere else (the Mac) it finds nothing, and the vision model's boxes still work.
// Logos are left alone: a phrase that is the game's own title or the studio's name is never circled.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { errorMessage, log } from "../lib/util.ts";

const run = promisify(execFile);
const SCRIPT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "winocr.ps1",
);

export interface OcrWord {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface OcrPage {
  width: number;
  height: number;
  words: OcrWord[];
}
/** A box as fractions of the picture: [left, top, right, bottom]. */
export type Box = [number, number, number, number];

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
const STOP = new Set([
  "the",
  "a",
  "an",
  "of",
  "and",
  "in",
  "on",
  "at",
  "to",
  "for",
]);

/**
 * Where a phrase is written in a picture: its telling words, in order, on consecutive OCR words (a long
 * word may match a word the engine read with a stray mark: "GREGGS." for "Greggs"). One word needs four
 * letters or more, so "in" or "GTA" alone never matches a stray scrap. The box is padded a little and must
 * be big enough to point at and not most of the picture.
 */
export function textBox(page: OcrPage, phrase: string): Box | undefined {
  const toks = phrase
    .split(/\s+/)
    .map(norm)
    .filter((t) => t && !STOP.has(t));
  if (!toks.length || !page.width || !page.height) return undefined;
  if (toks.length === 1 && toks[0]!.length < 4) return undefined;
  const words = page.words.map((w) => ({ ...w, n: norm(w.text) }));
  const same = (a: string, t: string) =>
    a === t || (t.length >= 5 && a.length <= t.length + 2 && a.includes(t));
  for (let i = 0; i + toks.length <= words.length; i++) {
    if (!toks.every((t, k) => same(words[i + k]!.n, t))) continue;
    const run = words.slice(i, i + toks.length);
    // Consecutive words on one line: no big jump down the page between them.
    if (
      run.some(
        (w, k) => k && Math.abs(w.y - run[k - 1]!.y) > run[k - 1]!.h * 1.5,
      )
    )
      continue;
    const x1 = Math.min(...run.map((w) => w.x));
    const y1 = Math.min(...run.map((w) => w.y));
    const x2 = Math.max(...run.map((w) => w.x + w.w));
    const y2 = Math.max(...run.map((w) => w.y + w.h));
    const pad = (y2 - y1) * 0.35;
    const box: Box = [
      Math.max(0, (x1 - pad) / page.width),
      Math.max(0, (y1 - pad) / page.height),
      Math.min(1, (x2 + pad) / page.width),
      Math.min(1, (y2 + pad) / page.height),
    ];
    const bw = box[2] - box[0];
    const bh = box[3] - box[1];
    if (bw * bh < 0.0006 || bw * bh > 0.3 || Math.max(bw, bh) < 0.03) continue;
    return box;
  }
  return undefined;
}

/** A phrase that is a logo rather than a detail: the game's own title or a name in `brands`. */
export function isLogo(phrase: string, brands: string[]): boolean {
  const p = norm(phrase);
  if (!p) return true;
  return brands.some((b) => {
    const q = norm(b);
    return !!q && (q.includes(p) || p.includes(q));
  });
}

export interface TextDetailCandidate {
  entry: number;
  moment: number;
  image: number;
  file: string;
  /** The sentence's phrases, most specific first (src/render/longplan.ts momentKeys). */
  keys: string[];
  /** The frame the sentence's picture is first on screen. */
  frame: number;
}

/**
 * The details to mark (pure): for each candidate in time order, the first of its phrases written in its
 * picture, not a logo; at most `max`, at least `gapFrames` apart.
 */
export function pickTextDetails(
  cands: TextDetailCandidate[],
  pages: Map<string, OcrPage>,
  brands: string[],
  gapFrames: number,
  max = 20,
): Array<{
  entry: number;
  moment: number;
  image: number;
  box: Box;
  label: string;
}> {
  const out: Array<{
    entry: number;
    moment: number;
    image: number;
    box: Box;
    label: string;
  }> = [];
  let last = -Infinity;
  for (const c of [...cands].sort((a, b) => a.frame - b.frame)) {
    if (out.length >= max) break;
    if (c.frame - last < gapFrames) continue;
    const page = pages.get(c.file);
    if (!page?.words.length) continue;
    for (const key of c.keys) {
      if (isLogo(key, brands)) continue;
      const box = textBox(page, key);
      if (!box) continue;
      out.push({
        entry: c.entry,
        moment: c.moment,
        image: c.image,
        box,
        label: key,
      });
      last = c.frame;
      break;
    }
  }
  return out;
}

/** The OCR engine's output, parsed: Windows PowerShell 5 leaves raw control characters in its JSON. */
export function parseOcrOutput(raw: string): Map<string, OcrPage> {
  const out = new Map<string, OcrPage>();
  const clean = raw.replace(/^﻿/, "").replace(/[\u0000-\u001f]+/g, " ");
  const body = JSON.parse(clean) as {
    results?: Array<{
      file: string;
      width?: number;
      height?: number;
      words?: OcrWord[] | OcrWord;
    }>;
  };
  for (const r of body.results ?? []) {
    // ConvertTo-Json writes a one-item list as a bare object.
    const words = Array.isArray(r.words) ? r.words : r.words ? [r.words] : [];
    out.set(r.file, { width: r.width ?? 0, height: r.height ?? 0, words });
  }
  return out;
}

/** Reads the text in pictures (absolute paths) on this PC; an empty map off Windows or on any failure. */
export async function readText(files: string[]): Promise<Map<string, OcrPage>> {
  if (
    process.platform !== "win32" ||
    !files.length ||
    process.env.NODE_TEST_CONTEXT
  )
    return new Map();
  const list = path.join(
    os.tmpdir(),
    `pulse-ocr-${process.pid}-${Date.now()}.json`,
  );
  try {
    await fs.writeFile(list, JSON.stringify(files));
    const { stdout } = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        SCRIPT,
        "-ListFile",
        list,
      ],
      { timeout: 5 * 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    return parseOcrOutput(stdout);
  } catch (err) {
    log(
      "warn",
      "picture text not read; details fall back to the vision model",
      {
        error: errorMessage(err),
      },
    );
    return new Map();
  } finally {
    await fs.rm(list, { force: true }).catch(() => undefined);
  }
}

/**
 * The text details of a long video: each sentence with no graphic of its own whose picture (a full-bleed
 * screenshot or key art, on screen for at least 3.5 s from the sentence's key word) has text the sentence
 * names. `images[].file` is relative to `dir`.
 */
export async function findTextDetails(a: {
  dir: string;
  fps: number;
  windows: Array<{ entry: number; moment: number; start: number; at: number }>;
  moments: Array<Array<{ graphic: { kind: string } } | undefined>>;
  keys: (entry: number, moment: number) => string[];
  shots: Array<{ start: number; end: number; media: { type: string; index: number } }>;
  images: Array<{ file: string; kind: string }>;
  brands: string[];
}): Promise<Array<{ entry: number; moment: number; image: number; box: Box; label: string }>> {
  const wide = new Set(["hero", "screenshot", "article", "header"]);
  const cands: TextDetailCandidate[] = [];
  for (const w of a.windows) {
    const m = a.moments[w.entry]?.[w.moment];
    if (!m || m.graphic.kind !== "none" || w.moment === 0) continue;
    const frame = Math.round(Math.max(w.start, w.at - 0.15) * a.fps);
    const shot = a.shots.find((x) => frame >= x.start && frame < x.end);
    if (!shot || shot.media.type !== "image" || shot.end - frame < 3.5 * a.fps) continue;
    const img = a.images[shot.media.index];
    if (!img || !wide.has(img.kind)) continue;
    const keys = a.keys(w.entry, w.moment).filter((k) => k.length <= 32);
    if (!keys.length) continue;
    cands.push({
      entry: w.entry,
      moment: w.moment,
      image: shot.media.index,
      file: path.join(a.dir, img.file),
      keys,
      frame,
    });
  }
  const pages = await readText([...new Set(cands.map((c) => c.file))]);
  return pickTextDetails(cands, pages, a.brands, 30 * a.fps);
}
