// MATCH_WIPE: the same place, two games. Finds the moments in two games' footage that show the same kind of place
// from a similar camera (a beach at sunset, a night skyline from the air, a car on a highway), so a comparison can
// wipe from one to the other (src/render/MatchWipe.tsx). Three passes, cheapest first:
//   1. the footage library's own scene notes (tags and the "seen" line every scene carries, src/sceneindex):
//      pairs that share place words are kept
//   2. the frames themselves at 64x36: edge layout and colour, so the two shots are framed alike
//   3. the PC's vision model on the best pairs side by side: same place? same framing? what is the place?
// The library's "unusable" scenes (lettering, not ad-safe) never take part.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { rawRgb } from "./pixels.ts";
import { stack } from "./sheet.ts";
import type { Ask } from "./vision.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });

export interface Scene {
  /** The clip file (absolute). */
  file: string;
  at: number;
  end: number;
  tags: string[];
  seen: string;
}

export interface Match {
  a: Scene;
  b: Scene;
  /** Library notes overlap, 0-1. */
  notes: number;
  /** Frame layout and colour likeness, 0-1. */
  frames?: number;
  /** The vision model's place and framing scores, 0-10 each. */
  place?: number;
  framing?: number;
  /** The shared place in a few words, for the on-screen label. */
  label?: string;
  score: number;
}

/** Tags that say nothing about the place or shot, left out of the comparison. */
const GENERIC = new Set([
  "character",
  "close-up",
  "couple",
  "day",
  "people",
  "person",
  "man",
  "woman",
  "interior",
]);
const STOP = new Set(
  "a an the and with of in on at to from by for is are its it this that view shot scene scenes game in-game showing shows visible".split(
    " ",
  ),
);

/** The place words of a scene (pure): its specific tags and the content words of its "seen" line. */
export function placeWords(s: Pick<Scene, "tags" | "seen">): Set<string> {
  const out = new Set<string>();
  for (const t of s.tags) if (!GENERIC.has(t)) out.add(t.toLowerCase());
  for (const w of s.seen.toLowerCase().match(/[a-z][a-z-]+/g) ?? [])
    if (!STOP.has(w) && w.length > 2) out.add(w);
  return out;
}

/** A scene the comparison may use (pure): long enough, and not one the library marked unusable. */
export function usable(s: Scene, minSeconds = 1.6): boolean {
  return (
    s.end - s.at >= minSeconds &&
    !/^unusable/i.test(s.seen) &&
    (s.tags.length > 0 || s.seen.length > 12)
  );
}

/** Jaccard overlap of two scenes' place words (pure); time of day must agree when both say it. */
export function notesOverlap(
  a: Pick<Scene, "tags" | "seen">,
  b: Pick<Scene, "tags" | "seen">,
): number {
  const night = (s: Pick<Scene, "tags" | "seen">) =>
    s.tags.includes("night") || /\bnight\b/i.test(s.seen)
      ? "night"
      : s.tags.includes("day") || /\b(day|daytime|sunny)\b/i.test(s.seen)
        ? "day"
        : "";
  const na = night(a);
  const nb = night(b);
  if (na && nb && na !== nb) return 0;
  const A = placeWords(a);
  const B = placeWords(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

/** The best pairs by notes alone (pure): each scene in at most one pair, highest overlap first. */
export function shortlist(
  as: Scene[],
  bs: Scene[],
  k = 10,
  min = 0.12,
): Match[] {
  const pairs: Match[] = [];
  for (const a of as.filter((s) => usable(s)))
    for (const b of bs.filter((s) => usable(s))) {
      const notes = notesOverlap(a, b);
      if (notes >= min) pairs.push({ a, b, notes, score: notes });
    }
  pairs.sort((x, y) => y.notes - x.notes);
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const out: Match[] = [];
  for (const p of pairs) {
    const ka = `${p.a.file}@${p.a.at}`;
    const kb = `${p.b.file}@${p.b.at}`;
    if (usedA.has(ka) || usedB.has(kb)) continue;
    usedA.add(ka);
    usedB.add(kb);
    out.push(p);
    if (out.length >= k) break;
  }
  return out;
}

/** Edge-layout correlation and colour-histogram overlap of two 64x36 RGB frames, 0-1 (pure). */
export function frameLikeness(a: Buffer, b: Buffer, w = 64, h = 36): number {
  const edges = (d: Buffer) => {
    const lum = (x: number, y: number) => {
      const i = (y * w + x) * 3;
      return 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
    };
    const e = new Float64Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const gx =
          lum(x + 1, y - 1) +
          2 * lum(x + 1, y) +
          lum(x + 1, y + 1) -
          lum(x - 1, y - 1) -
          2 * lum(x - 1, y) -
          lum(x - 1, y + 1);
        const gy =
          lum(x - 1, y + 1) +
          2 * lum(x, y + 1) +
          lum(x + 1, y + 1) -
          lum(x - 1, y - 1) -
          2 * lum(x, y - 1) -
          lum(x + 1, y - 1);
        e[y * w + x] = Math.hypot(gx, gy);
      }
    return e;
  };
  const ea = edges(a);
  const eb = edges(b);
  const mean = (e: Float64Array) => e.reduce((s, v) => s + v, 0) / e.length;
  const ma = mean(ea);
  const mb = mean(eb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ea.length; i++) {
    num += (ea[i]! - ma) * (eb[i]! - mb);
    da += (ea[i]! - ma) ** 2;
    db += (eb[i]! - mb) ** 2;
  }
  const ncc = da && db ? num / Math.sqrt(da * db) : 0;
  const hist = (d: Buffer) => {
    const hgram = new Float64Array(64);
    for (let i = 0; i < d.length; i += 3)
      hgram[
        ((d[i]! >> 6) << 4) | ((d[i + 1]! >> 6) << 2) | (d[i + 2]! >> 6)
      ]! += 1;
    const n = d.length / 3;
    return hgram.map((v) => v / n);
  };
  const ha = hist(a);
  const hb = hist(b);
  let inter = 0;
  for (let i = 0; i < 64; i++) inter += Math.min(ha[i]!, hb[i]!);
  return Math.max(0, 0.6 * Math.max(0, ncc) + 0.4 * inter);
}

/** One frame of a clip at a time, as a JPEG. */
export async function grabFrame(
  file: string,
  at: number,
  dest: string,
  width = 640,
): Promise<string> {
  await ff([
    "-ss",
    at.toFixed(2),
    "-i",
    file,
    "-frames:v",
    "1",
    "-vf",
    `scale=${width}:-2`,
    "-q:v",
    "3",
    dest,
  ]);
  return dest;
}

export const MATCH_PROMPT =
  'Two frames from two different video games are side by side. place: 0-10, how clearly both show the same kind of place (both a beach at sunset, both a city skyline at night from the air, both a car on a highway); 0 when the places differ. framing: 0-10, how alike the camera is (distance, angle, where the horizon and the main subject sit). label: the shared place in 2 to 5 plain words, for example "Beach at sunset".';

/**
 * Scores the shortlist on the frames, then asks the vision model about the best `judge` of them, and returns the
 * matches best first. The final score weighs the model's place and framing scores most, then frame likeness.
 */
export async function judgeMatches(
  list: Match[],
  ask: Ask,
  work: string,
  judge = 6,
): Promise<Match[]> {
  await fs.mkdir(work, { recursive: true });
  for (const [i, m] of list.entries()) {
    const fa = await grabFrame(
      m.a.file,
      (m.a.at + m.a.end) / 2,
      path.join(work, `m${i}_a.jpg`),
    );
    const fb = await grabFrame(
      m.b.file,
      (m.b.at + m.b.end) / 2,
      path.join(work, `m${i}_b.jpg`),
    );
    const [ra, rb] = await Promise.all([
      rawRgb(fa, { width: 64, height: 36 }),
      rawRgb(fb, { width: 64, height: 36 }),
    ]);
    m.frames = frameLikeness(ra.data, rb.data);
    m.score = 0.5 * m.notes + 0.5 * m.frames;
  }
  const best = [...list].sort((x, y) => y.score - x.score).slice(0, judge);
  for (const m of best) {
    const i = list.indexOf(m);
    const pair = path.join(work, `m${i}_pair.jpg`);
    await ff([
      "-i",
      path.join(work, `m${i}_a.jpg`),
      "-i",
      path.join(work, `m${i}_b.jpg`),
      "-filter_complex",
      stack(2, "h", "scale=640:360"),
      "-frames:v",
      "1",
      "-q:v",
      "3",
      pair,
    ]);
    const ans = await ask([pair], MATCH_PROMPT, {
      properties: {
        place: { type: "number" },
        framing: { type: "number" },
        label: { type: "string" },
      },
      required: ["place", "framing", "label"],
    }).catch(() => ({}));
    m.place = Number(ans.place) || 0;
    m.framing = Number(ans.framing) || 0;
    m.label =
      typeof ans.label === "string" ? ans.label.trim().slice(0, 40) : undefined;
    m.score =
      0.45 * (m.place / 10) +
      0.3 * (m.framing / 10) +
      0.15 * (m.frames ?? 0) +
      0.1 * m.notes;
  }
  return best.sort((x, y) => y.score - x.score);
}

/** The scenes of one game's footage library (D:\pulse-data\library\<game>\library.json), clip paths made absolute. */
export async function libraryScenes(
  libraryDir: string,
  onlyIds?: string[],
): Promise<Scene[]> {
  const lib = JSON.parse(
    await fs.readFile(path.join(libraryDir, "library.json"), "utf8"),
  ) as {
    items: Array<{
      id: string;
      kind: string;
      file: string;
      scenes?: Array<{
        at: number;
        end: number;
        tags?: string[];
        seen?: string;
      }>;
    }>;
  };
  return lib.items
    .filter((i) => i.kind === "video" && (!onlyIds || onlyIds.includes(i.id)))
    .flatMap((i) =>
      (i.scenes ?? []).map((s) => ({
        file: path.join(libraryDir, i.file),
        at: s.at,
        end: s.end,
        tags: s.tags ?? [],
        seen: s.seen ?? "",
      })),
    );
}

/** Seconds of one pair (pure): the shorter scene, between 3 and 5 (a shorter scene is slowed to fit, at most 1.6x). */
export function pairSeconds(m: Pick<Match, "a" | "b">): number {
  const len = Math.min(m.a.end - m.a.at, m.b.end - m.b.at);
  return Math.max(3, Math.min(5, len * 1.6));
}
