// Scoring and choosing packaging (pure, apart from loading the model file). One score per candidate: the blend of the
// model's heads for the video's format, less the clarity check's soft costs; a candidate the clarity check refuses is
// never chosen whatever it scores.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { titleFeatures } from "./features.ts";
import { predictNamed, type LinearModel } from "./model.ts";
import { clarity, type ClarityContext, type ClarityResult } from "./clarity.ts";
import type { Candidate } from "./candidates.ts";
import type { Format } from "./corpus.ts";
import type { Head, PackagingModel } from "./train.ts";
import type { ImageFeatureVector } from "./image.ts";

/** The thumbnail model rides beside the title heads in the same file. */
export type FullModel = PackagingModel & {
  image?: Partial<Record<Format, LinearModel>>;
};

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODEL_FILE = path.join(here, "model.default.json");

let cached: { file: string; mtime: number; model: FullModel } | undefined;

/**
 * The model: data/packaging/model.json when a newer fit has been written there, else the one shipped with the code.
 * Undefined only when neither can be read (then nothing is scored and nothing changes).
 */
export function loadModel(dataDir?: string): FullModel | undefined {
  const files = [
    dataDir ? path.join(dataDir, "packaging", "model.json") : "",
    DEFAULT_MODEL_FILE,
  ].filter(Boolean);
  for (const file of files) {
    try {
      const mtime = fs.statSync(file).mtimeMs;
      if (cached && cached.file === file && cached.mtime === mtime)
        return cached.model;
      const model = JSON.parse(fs.readFileSync(file, "utf8")) as FullModel;
      if (model?.version !== 1 || !model.heads) continue;
      cached = { file, mtime, model };
      return model;
    } catch {
      // try the next
    }
  }
  return undefined;
}

/** A title's model score for its format (pure): the blend of the heads it has. */
export function titleScore(
  model: FullModel,
  format: Format,
  text: string,
  game?: string,
): number {
  const heads = model.heads[format] ?? {};
  const blend = model.blend[format] ?? { prior: 1 };
  const f = titleFeatures(text, { game });
  let s = 0;
  let w = 0;
  for (const [h, weight] of Object.entries(blend) as Array<[Head, number]>) {
    const m = heads[h] ?? heads.prior;
    if (!m || !weight) continue;
    s += weight * predictNamed(m, f);
    w += weight;
  }
  return w ? s / w : 0;
}

/** A hook line's score: the viewed head (how many stayed past the first seconds) where there is one, else the title blend. */
export function hookScore(
  model: FullModel,
  text: string,
  game?: string,
): number {
  const m = model.heads.short?.viewed;
  return m
    ? predictNamed(m, titleFeatures(text, { game }))
    : titleScore(model, "short", text, game);
}

/** A thumbnail's or first frame's score (pure); 0 when there is no image model for the format. */
export function imageScore(
  model: FullModel,
  format: Format,
  f: ImageFeatureVector,
): number {
  const m = model.image?.[format];
  return m ? predictNamed(m, f as Record<string, number>) : 0;
}

export interface Scored extends Candidate {
  score: number;
  clarity: ClarityResult;
  /** score less the clarity costs; -Infinity when the clarity check refuses it. */
  final: number;
}

/** Every candidate scored and checked, best first (pure). */
export function rankCandidates(
  candidates: Candidate[],
  scoreOf: (text: string) => number,
  ctx: ClarityContext,
): Scored[] {
  return candidates
    .map((c) => {
      const score = scoreOf(c.text);
      const cl = clarity(c.text, ctx);
      return {
        ...c,
        score,
        clarity: cl,
        final: cl.ok ? score - cl.penalty : -Infinity,
      };
    })
    .sort((a, b) => b.final - a.final || b.score - a.score);
}

export interface Pick {
  chosen: Scored;
  /** The live or writer's packaging, scored the same way. */
  current: Scored;
  /** chosen.final - current.final (0 when the current one stays). */
  lift: number;
  changed: boolean;
  /** The next best that pass, for Test & compare and the second chance. */
  runnersUp: Scored[];
}

/**
 * The choice (pure): the best candidate that passes, unless it beats the current one by less than `minLift` (a small
 * difference is noise, and the writer's own words win ties). A current one that fails the clarity check gives way to
 * any passing candidate.
 */
export function pickBest(
  ranked: Scored[],
  currentText: string,
  minLift: number,
): Pick | undefined {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9$]/g, "");
  const current = ranked.find((r) => norm(r.text) === norm(currentText));
  const passing = ranked.filter((r) => r.clarity.ok);
  if (!current) return undefined;
  const best = passing[0];
  const runnersUp = passing
    .filter((r) => r !== best && norm(r.text) !== norm(currentText))
    .slice(0, 4);
  if (!best || norm(best.text) === norm(currentText))
    return { chosen: current, current, lift: 0, changed: false, runnersUp };
  const lift = current.clarity.ok ? best.final - current.final : Infinity;
  if (lift < minLift)
    return {
      chosen: current,
      current,
      lift: 0,
      changed: false,
      runnersUp: passing
        .filter((r) => norm(r.text) !== norm(currentText))
        .slice(0, 4),
    };
  return { chosen: best, current, lift, changed: true, runnersUp };
}
