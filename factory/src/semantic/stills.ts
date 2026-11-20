// Pictures pinned to the lines they show, by meaning (MATCH_SEMANTIC). Two places use it:
//   - a Short (pinShortStills): its stills nobody tagged for a line were shown in turn, whatever was being said (the
//     Scooter Bros Short put a controller press shot under "a handy phone app that delivers your own car"). Each
//     untagged still that clearly shows one line is tagged for that line's beat; the rest stay in turn as before.
//   - a long video (pinChapterMoments): before the picture editor's pass over the bin, a chapter's own unpinned
//     pictures and clips are pinned to the bare sentences they clearly show, so the editor sees only what is left.
// It only ever chooses among pictures the gatherers already accepted for this video (right game, rights, faces,
// verdicts), never adds one, and never moves a picture another rule placed.

import fs from "node:fs/promises";
import path from "node:path";
import { clipFrame } from "../assets/stillscore.ts";
import { errorMessage, log } from "../lib/util.ts";
import type { Embedder } from "./embed.ts";
import {
  assign,
  cosine,
  lineQuery,
  meanVector,
  type Assignment,
} from "./match.ts";

export interface PinOptions {
  minScore: number;
  margin: number;
  /**
   * Pictures of the same game the line's typical likeness is measured against (the scene index's shot vectors): a
   * Short has a handful of stills, too few to say what an ordinary picture scores for the line.
   */
  background?: readonly Float32Array[];
}

/** Each line's median cosine over the background set (pure); undefined without one. */
export function backgroundBase(
  lines: readonly Float32Array[],
  background?: readonly Float32Array[],
): Array<number | undefined> {
  if (!background?.length) return lines.map(() => undefined);
  return lines.map((l) => {
    if (!l.length) return undefined;
    const c = background.map((b) => cosine(l, b)).sort((a, b) => a - b);
    return c[Math.floor(c.length / 2)];
  });
}

/** Lines' vectors: each line and its shot note asked together (undefined when the model is down). */
async function lineVectors(
  embedder: Embedder,
  lines: ReadonlyArray<{ text: string; note?: string }>,
): Promise<Float32Array[] | undefined> {
  const asks = lines.map((l) => lineQuery(l.text, l.note));
  const got = await embedder.texts(asks.flat());
  if (!got) return undefined;
  const out: Float32Array[] = [];
  let at = 0;
  for (const a of asks) {
    out.push(meanVector(got.slice(at, at + a.length)) ?? new Float32Array(0));
    at += a.length;
  }
  return out;
}

/** The cosine table, lines by candidates (pure); a candidate with no vector scores 0 everywhere. */
export function simTable(
  lines: readonly Float32Array[],
  cands: ReadonlyArray<Float32Array | undefined>,
): number[][] {
  return lines.map((l) => cands.map((c) => (c && l.length ? cosine(l, c) : 0)));
}

export interface ShortStill {
  file: string;
  kind: string;
  beatIndex?: number;
  role?: string;
  then?: boolean;
  /** Already placed on spoken words by the picture editor: never moved. */
  forWords?: string;
}

/** The stills of a Short the meaning pass may tag (pure): untagged, not box art or a logo card, not the hero. */
export function freeStills(
  images: readonly ShortStill[],
  heroIndex?: number,
): number[] {
  return images
    .map((_, i) => i)
    .filter((i) => {
      const im = images[i]!;
      return (
        im.beatIndex === undefined &&
        !im.role &&
        !im.then &&
        !im.forWords &&
        im.kind !== "hero" &&
        im.kind !== "capsule" &&
        im.kind !== "logo" &&
        i !== heroIndex
      );
    });
}

/**
 * How far under its lines a picture may sit on average before it counts as about something else (cosine): measured
 * 20 Nov 2026 on the Scooter Bros Short, whose controller press shots sat 0.05 to 0.09 under the typical GTA VI frame
 * for every line while its game screenshots sat within 0.03.
 */
export const OFF_TOPIC_GAP = 0.045;

/**
 * Pictures about something else (pure): on average over the lines, clearly less like them than the game's typical
 * picture is (the background median). Needs the background; without one nothing is called off topic.
 */
export function offTopic(sims: readonly (readonly number[])[], bases: ReadonlyArray<number | undefined>, gap = OFF_TOPIC_GAP): number[] {
  const lines = sims.map((_, l) => l).filter((l) => bases[l] !== undefined);
  if (!lines.length || !sims[0]?.length) return [];
  return sims[0]!
    .map((_, c) => c)
    .filter((c) => lines.reduce((n, l) => n + (bases[l]! - sims[l]![c]!), 0) / lines.length > gap);
}

export interface ShortPins {
  pins: Array<{ image: number; beat: number; score: number }>;
  /** Free stills about something else than every line (image indexes): the caller may drop them. */
  offTopic: number[];
}

/**
 * A Short's free stills tagged for the beats they clearly show. `beats` are the Short's beat lines in order (beat 0
 * first), each with the writer's shot note. Returns the pins made (image index, beat, score) and the free stills that
 * fit no line at all; mutates `images` (the pins only).
 */
export async function pinShortStills(
  embedder: Embedder,
  dir: string,
  images: ShortStill[],
  beats: ReadonlyArray<{ text: string; note?: string }>,
  o: PinOptions & { heroIndex?: number },
): Promise<ShortPins> {
  const free = freeStills(images, o.heroIndex);
  if (!free.length || !beats.length) return { pins: [], offTopic: [] };
  const lv = await lineVectors(embedder, beats);
  if (!lv) return { pins: [], offTopic: [] };
  const iv = await embedder.images(free.map((i) => path.join(dir, images[i]!.file)));
  const bases = backgroundBase(lv, o.background);
  const sims = simTable(lv, iv);
  const pins = assign(sims, { minScore: o.minScore, margin: o.margin, uses: () => 1, base: (l) => bases[l] }).map((p) => ({
    image: free[p.candidate]!,
    beat: p.line,
    score: p.score,
  }));
  for (const p of pins) images[p.image]!.beatIndex = p.beat;
  // A picture with no vector was never judged: it is never called off topic.
  const off = offTopic(sims, bases)
    .filter((c) => iv[c] && !pins.some((p) => p.image === free[c]))
    .map((c) => free[c]!);
  return { pins, offTopic: off };
}

type Placed = { beatIndex?: number; moment?: number };

export interface ChapterLike {
  entry: number;
  game?: string;
  moments: Array<{ show: string }>;
  sentences: string[];
}

/**
 * A long chapter's own unpinned pictures and clips pinned to the bare sentences they clearly show (`open`, by index).
 * Clips are judged on their middle frame. Mutates the pinned items' `moment`; returns the pins.
 */
export async function pinChapterMoments(
  embedder: Embedder,
  dir: string,
  work: string,
  ch: ChapterLike,
  open: number[],
  images: Array<Placed & { file: string; kind: string }>,
  clips: Array<Placed & Record<string, unknown>>,
  o: PinOptions,
): Promise<Assignment[]> {
  if (!open.length) return [];
  const items: Array<{ file: string; set: (k: number) => void }> = [];
  for (const im of images)
    if (
      im.beatIndex === ch.entry &&
      im.moment === undefined &&
      im.kind !== "capsule"
    )
      items.push({
        file: path.join(dir, im.file),
        set: (k) => (im.moment = k),
      });
  for (const [i, c] of clips.entries()) {
    if (
      c.beatIndex !== ch.entry ||
      c.moment !== undefined ||
      c.stock ||
      typeof c.file !== "string"
    )
      continue;
    const frame = path.join(work, `semclip_${ch.entry}_${i}.jpg`);
    try {
      await clipFrame(
        path.join(dir, c.file),
        Number(c.durationSeconds ?? 4),
        frame,
      );
      items.push({ file: frame, set: (k) => (c.moment = k) });
    } catch (err) {
      log("info", "semantic: clip frame not cut", { error: errorMessage(err) });
    }
  }
  if (!items.length) return [];
  const lv = await lineVectors(
    embedder,
    open.map((k) => ({
      text: ch.sentences[k] ?? "",
      note: ch.moments[k]?.show,
    })),
  );
  if (!lv) return [];
  const iv = await embedder.images(items.map((x) => x.file));
  const bases = backgroundBase(lv, o.background);
  const pins = assign(simTable(lv, iv), {
    minScore: o.minScore,
    margin: o.margin,
    uses: () => 1,
    base: (l) => bases[l],
  });
  for (const p of pins) items[p.candidate]!.set(open[p.line]!);
  // The clip frames were only for judging.
  for (const x of items)
    if (path.basename(x.file).startsWith("semclip_")) await fs.rm(x.file, { force: true }).catch(() => undefined);
  return pins.map((p) => ({ ...p, line: open[p.line]! }));
}
