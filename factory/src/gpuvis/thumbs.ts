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
