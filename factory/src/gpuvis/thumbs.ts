// THUMB_CANDIDATES: more thumbnail candidates for a long video, made with the PC's GPU, and a ranking of every
// candidate (old designs and new) by the local vision model against a rubric drawn from top gaming thumbnails. The
// top three go out as the thumbnail and YouTube's Test & compare variants (thumb.jpg, thumb_b.jpg, thumb_c.jpg).
//
// The game's own art is always the picture. The image model only ever adds what a designer would add around it:
//   extended  the art's background continued sideways by FLUX.2 [klein] 4B (fill.ts), so a centred hero can sit to
//             one side with clean room for the words instead of being cropped and zoomed
//   relit     an abstract light plate (haze, rim light, light rays; no objects, no people, no writing) drawn by klein
//             and screened over the side the words sit on, for contrast and colour
//   crisp     low-resolution art enlarged by Real-ESRGAN first (upscale.ts)
// Nothing here draws a character, a scene or a screenshot.

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { DEFAULT_COMFY_URL, downloadImage, runWorkflow } from "./comfy.ts";
import { probeSize } from "./pixels.ts";
import { stack } from "./sheet.ts";
import { systemFont } from "../assets/linevisuals.ts";
import type { Ask } from "./vision.ts";
import { plateWorkflow } from "./workflows.ts";

const run = promisify(execFile);
const ff = (args: string[]) =>
  run(FFMPEG, ["-v", "error", "-y", ...args], { maxBuffer: 64 * 1024 * 1024 });

/**
 * The rubric, from the thumbnails that win in gaming (the 19 Nov 2026 review of Pulse's own seven long videos, the
 * owner's hero rule in src/qa/thumbrule.ts, and the niche study's top performers): one big subject, 1-4 huge words
 * that open a question or make a claim, hard contrast, one strong colour, nothing small or busy, nothing fake.
 * Weights sum to 1.
 */
export const RUBRIC: Array<{ key: string; weight: number; ask: string }> = [
  {
    key: "subject",
    weight: 0.22,
    ask: "one clear, big subject (a character, face or iconic object) you recognise instantly; low when there is no single focus or the subject is small",
  },
  {
    key: "readable",
    weight: 0.22,
    ask: "in the small feed-size copy, every word reads instantly and is huge; low when any word is small, thin, cut off or blends into the picture",
  },
  {
    key: "contrast",
    weight: 0.16,
    ask: "strong light-dark and colour contrast: the subject and the words separate cleanly from the background; low when it is muddy, dark or flat",
  },
  {
    key: "curiosity",
    weight: 0.16,
    ask: "the words and picture together make a scroller want to click: a claim to argue with, a question, a surprise or an emotion; low when it is a plain label",
  },
  {
    key: "clean",
    weight: 0.12,
    ask: "simple and uncluttered: at most three things to look at, no small panels, logos or extra lines of text",
  },
  {
    key: "authentic",
    weight: 0.12,
    ask: "looks like the real game's art, professionally finished; low for smears, melted shapes, odd extra limbs or faces, seams or anything that looks AI-made",
  },
];

export const RUBRIC_PROMPT = `You are a YouTube thumbnail expert for a gaming channel. Two copies of the same thumbnail follow: first as it appears in a phone feed (tiny), then full size. Score it from 1 to 10 on each point:\n${RUBRIC.map((r) => `${r.key}: ${r.ask}`).join("\n")}\nBe strict: 9-10 only for thumbnails as strong as the best on YouTube.`;

export const RUBRIC_SCHEMA = {
  properties: Object.fromEntries(
    RUBRIC.map((r) => [r.key, { type: "number" }]),
  ),
  required: RUBRIC.map((r) => r.key),
};

/** The weighted rubric score from the model's answer, 0 to 10 (pure); undefined when the answer is unusable. */
export function rubricScore(answer: any): number | undefined {
  let total = 0;
  for (const r of RUBRIC) {
    const v = Number(answer?.[r.key]);
    if (!Number.isFinite(v)) return undefined;
    total += Math.min(10, Math.max(0, v)) * r.weight;
  }
  return Math.round(total * 100) / 100;
}

export interface Scored {
  file: string;
  label: string;
  score?: number;
  parts?: Record<string, number>;
  /** Problems from the factory's own thumbnail rule: a candidate with any never ranks above one without. */
  problems?: string[];
}

/**
 * The order to use (pure): candidates without rule problems first, then by score (unscored last), ties kept in the
 * order given, so the factory's own first choice wins a tie.
 */
export function rankScored<T extends Scored>(list: T[]): T[] {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const pa = a.c.problems?.length ? 1 : 0;
      const pb = b.c.problems?.length ? 1 : 0;
      if (pa !== pb) return pa - pb;
      const sa = a.c.score ?? -1;
      const sb = b.c.score ?? -1;
      if (sa !== sb) return sb - sa;
      return a.i - b.i;
    })
    .map((x) => x.c);
}

export const GRID_PROMPT = (n: number) =>
  `You are a YouTube thumbnail expert for a gaming channel. ${n} candidate thumbnails for the same video are shown in a grid, each with a big number in its corner. Rank them from the one most likely to win the click in a phone feed to the least likely, judging: ${RUBRIC.map((r) => `${r.key} (${r.ask})`).join("; ")}. Answer with order: every number exactly once, best first.`;

/**
 * Borda points from several rankings (pure): each ranking gives n-1 points to its first, 0 to its last; numbers a
 * ranking leaves out get nothing from it. Returns points per index scaled to 0-10.
 */
export function bordaScores(rankings: number[][], n: number): number[] {
  const pts = new Array<number>(n).fill(0);
  let used = 0;
  for (const r of rankings) {
    const seen = new Set<number>();
    const clean = r.filter(
      (k) =>
        Number.isInteger(k) && k >= 0 && k < n && !seen.has(k) && seen.add(k),
    );
    if (clean.length < Math.min(2, n)) continue;
    used++;
    clean.forEach((k, pos) => (pts[k]! += n - 1 - pos));
  }
  const max = Math.max(1, used * Math.max(1, n - 1));
  return pts.map((p) => Math.round((p / max) * 1000) / 100);
}

/**
 * Ranks the candidates against each other: the absolute rubric saturated (20 Nov 2026: qwen3-vl 8B gave every GTA VI
 * poster 10/10, the 30B 9/9 on everything that was not the old grid), so the model sees them together in a numbered
 * grid and orders them. Run `rounds` times in shuffled orders to cancel position bias; Borda points become the score.
 */
export async function rankByGrid<T extends Scored>(
  list: T[],
  ask: Ask,
  workDir: string,
  rounds = 2,
): Promise<T[]> {
  await fs.mkdir(workDir, { recursive: true });
  const n = list.length;
  if (n < 2) return list;
  // The tile numbers are drawn in a font this machine has (macOS, Windows or Linux); with none the grid cannot be
  // numbered, so the factory's order stands.
  const sys = systemFont();
  if (!sys) return list;
  const font = sys.replace(/:/g, "\\:");
  const rankings: number[][] = [];
  for (let r = 0; r < rounds; r++) {
    // A round whose grid cannot be built (ffmpeg failed) counts for nothing, like a round the model did not answer.
    try {
      // Round 0 in the given order, later rounds reversed and rotated, so each candidate sits in different places.
      const order = Array.from({ length: n }, (_, i) => i);
      if (r % 2 === 1) order.reverse();
      const shift = Math.floor((r * n) / Math.max(1, rounds));
      const shown = [...order.slice(shift), ...order.slice(0, shift)];
      const tiles: string[] = [];
      for (const [pos, k] of shown.entries()) {
        const tile = path.join(workDir, `r${r}_t${pos}.jpg`);
        await ff([
          "-i",
          list[k]!.file,
          "-vf",
          `scale=480:270,drawbox=x=0:y=0:w=64:h=64:color=black@0.85:t=fill,drawtext=fontfile='${font}':text='${pos + 1}':x=18:y=10:fontsize=46:fontcolor=yellow`,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          tile,
        ]);
        tiles.push(tile);
      }
      const per = n <= 4 ? 2 : 3;
      const rows: string[] = [];
      for (let i = 0; i < tiles.length; i += per) {
        const chunk = tiles.slice(i, i + per);
        const row = path.join(workDir, `r${r}_row${i}.jpg`);
        await ff([
          ...chunk.flatMap((c) => ["-i", c]),
          "-filter_complex",
          `${stack(chunk.length, "h", "pad=488:278:4:4:color=0x222222")},pad=${488 * per}:278:0:0:color=0x222222`,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          row,
        ]);
        rows.push(row);
      }
      const grid = path.join(workDir, `r${r}_grid.jpg`);
      await ff([
        ...rows.flatMap((x) => ["-i", x]),
        "-filter_complex",
        stack(rows.length, "v"),
        "-frames:v",
        "1",
        "-q:v",
        "3",
        grid,
      ]);
      const ans = await ask([grid], GRID_PROMPT(n), {
        properties: { order: { type: "array", items: { type: "integer" } } },
        required: ["order"],
      });
      const said = Array.isArray(ans?.order)
        ? (ans.order as unknown[]).map((x) => Number(x) - 1)
        : [];
      rankings.push(said.map((pos) => shown[pos] ?? -1));
    } catch {
      /* one failed round counts for nothing */
    }
  }
  if (!rankings.some((r) => r.filter((k) => k >= 0).length >= 2)) return list;
  const scores = bordaScores(rankings, n);
  list.forEach((c, i) => (c.score = scores[i]));
  return list;
}

/** Scores every candidate with the vision model (feed-size and full-size copies); a failed call leaves it unscored. */
export async function scoreThumbs<T extends Scored>(
  list: T[],
  ask: Ask,
  workDir: string,
): Promise<T[]> {
  await fs.mkdir(workDir, { recursive: true });
  for (const [i, c] of list.entries()) {
    const small = path.join(workDir, `feed_${i}.png`);
    const big = path.join(workDir, `full_${i}.jpg`);
    try {
      await ff([
        "-i",
        c.file,
        "-vf",
        "scale=168:94:flags=area,scale=336:188:flags=neighbor",
        "-frames:v",
        "1",
        small,
      ]);
      await ff([
        "-i",
        c.file,
        "-vf",
        "scale=1280:720",
        "-frames:v",
        "1",
        "-q:v",
        "3",
        big,
      ]);
      const ans = await ask([small, big], RUBRIC_PROMPT, RUBRIC_SCHEMA);
      c.score = rubricScore(ans);
      if (c.score !== undefined)
        c.parts = Object.fromEntries(
          RUBRIC.map((r) => [r.key, Number(ans[r.key])]),
        );
    } catch {
      c.score = undefined;
    }
  }
  return list;
}

/** Light plates: atmosphere only, in Pulse's orange, so the words' side gains contrast and colour. */
export const PLATE_PROMPTS = [
  "Abstract cinematic lighting plate on pure black: warm orange volumetric haze and soft god rays streaming from the upper left, fine dust particles, gentle lens bloom. Empty atmosphere only, no objects, no figures, no lettering.",
  "Abstract dark background with a strong orange and amber rim-light glow and drifting smoke, deep teal shadows at the edges, soft film grain. Empty atmosphere only, no objects, no figures, no lettering.",
];

/** Draws one light plate (1344x768) with klein. */
export async function drawPlate(
  dest: string,
  seed: number,
  variant = 0,
  url = DEFAULT_COMFY_URL,
): Promise<string> {
  const imgs = await runWorkflow(
    url,
    plateWorkflow({
      prompt: PLATE_PROMPTS[variant % PLATE_PROMPTS.length]!,
      seed,
      width: 1344,
      height: 768,
    }),
    180_000,
  );
  return downloadImage(url, imgs[0]!, dest);
}

/**
 * The art relit: the plate screened over it, strongest on the side away from the subject (where the poster puts the
 * words) and fading out before the subject, so the game's art under the subject is untouched.
 */
export async function relight(
  art: string,
  plate: string,
  dest: string,
  subjectX: number,
): Promise<string> {
  const { width, height } = await probeSize(art);
  // Weight 1 at the far edge from the subject, 0 from 0.15 before the subject onwards.
  const wordsLeft = subjectX >= 0.5;
  const edge = wordsLeft
    ? Math.max(0.05, subjectX - 0.15)
    : Math.min(0.95, subjectX + 0.15);
  const ramp = wordsLeft
    ? `clip((${edge}-X/W)/${edge},0,1)`
    : `clip((X/W-${edge})/(1-${edge}),0,1)`;
  await ff([
    "-i",
    art,
    "-i",
    plate,
    "-filter_complex",
    `[1]scale=${width}:${height},format=gbrp,geq=r='r(X,Y)*${ramp}':g='g(X,Y)*${ramp}':b='b(X,Y)*${ramp}'[p];[0]format=gbrp[a];[a][p]blend=all_mode=screen:all_opacity=0.85,eq=contrast=1.06:saturation=1.08,format=yuvj420p`,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    dest,
  ]);
  return dest;
}

/**
 * How far to extend art sideways so its subject lands where the poster wants it (0.73 or 0.27 of the width) without
 * zooming in (pure). Returns the output width for a picture of width w, or undefined when the subject is already near
 * enough to its side (within 0.12) that the poster's own crop does the job.
 */
export function extendWidth(
  w: number,
  subjectX: number,
): { outW: number; place: "left" | "right" } | undefined {
  if (subjectX >= 0.5) {
    if (subjectX >= 0.61) return undefined;
    // The original goes on the right, the new picture on the left: (E + s*w) / (E + w) = 0.73.
    const E = (w * (0.73 - subjectX)) / 0.27;
    return { outW: Math.round(w + E), place: "right" };
  }
  if (subjectX <= 0.39) return undefined;
  const E = (w * (subjectX - 0.27)) / 0.27;
  return { outW: Math.round(w + E), place: "left" };
}
