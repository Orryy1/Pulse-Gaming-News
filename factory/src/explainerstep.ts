// The explainers' place in the factory (EXPLAINERS, src/editorial/explainers.ts). Shorts: once per episode, at the start
// of the render step (the script is settled and its pictures are in), the explainer pass marks the lines that explain
// how something works; an anatomy explainer is placed on the episode's own screenshots by the local vision model, or
// dropped. The marks are kept on script.explainers (an empty list means "looked, none"), so a re-render never asks
// again. Documentaries: per chapter, the marks go on the sentence's shot-list moment (moment.explainer), where the
// filler chooser (src/assets/fillers.ts) gives the line an explainer shot. Off, nothing here runs. Never throws: a
// failed pass leaves the video exactly as it would have been.

import path from "node:path";
import type { Db } from "./db.ts";
import type { Llm } from "./editorial/llm.ts";
import type { Script } from "./editorial/schema.ts";
import {
  explainersNote,
  markChapterExplainers,
  markShortExplainers,
  type ShortExplainer,
} from "./editorial/explainers.ts";
import { placeAnatomy, anatomyAsk } from "./assets/anatomy.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import {
  EXPLAINER_KICKER,
  type Explainer,
} from "./render/components/explainers/types.ts";
import type { Orientation } from "./render/components/explainers/layout.ts";

export type ExplainersMode = "off" | "short" | "long" | "all";

export const explainersOn = (mode: ExplainersMode, lane: "short" | "long") =>
  mode === "all" || mode === lane;

/**
 * The pictures an anatomy explainer may point into: the episode's game screenshots and key art near 16:9, best first.
 * Logos, box art, capsules, sketches, people and stock photos never: a callout names a part of the game's own picture.
 */
export function anatomyPictures(
  images: Array<{ file: string; kind?: string; aspect?: number }>,
  dir: string,
): Array<{ file: string; src: string; aspect: number }> {
  const rank = (k?: string) => (k === "screenshot" ? 0 : k === "hero" ? 1 : 2);
  return images
    .filter((i) => {
      const a = i.aspect ?? 1.78;
      return (
        a >= 1.6 &&
        a <= 2.0 &&
        !/logo|capsule|box|sketch|person|people|portrait|photo|stock/i.test(
          i.kind ?? "",
        )
      );
    })
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((i) => ({
      file: path.join(dir, i.file),
      src: i.file,
      aspect: i.aspect ?? 1.78,
    }));
}

/** The words an explainer puts on screen, for the vision check's list of expected graphics. */
export function explainerTexts(e: Explainer): string[] {
  return [
    e.title,
    ...e.items.flatMap((i) => [i.label, i.value ?? ""]),
    EXPLAINER_KICKER[e.type],
  ].filter(Boolean);
}

/** Anatomy explainers placed on pictures (or dropped); the others unchanged. */
async function placeAll<T extends { explainer: Explainer }>(
  list: T[],
  pictures: Array<{ file: string; src: string; aspect?: number }>,
  game: string,
  ask: (file: string, prompt: string) => Promise<unknown>,
  notes: string[],
  orientation: Orientation,
): Promise<T[]> {
  const out: T[] = [];
  for (const x of list) {
    if (x.explainer.type !== "anatomy") {
      out.push(x);
      continue;
    }
    const placed = await placeAnatomy(
      x.explainer,
      pictures,
      game,
      ask,
      (n) => notes.push(n),
      { orientation },
    );
    if (placed) out.push({ ...x, explainer: placed });
    else notes.push("anatomy dropped: no picture shows two of its parts");
  }
  return out;
}

export async function shortExplainersStep(
  s: { db: Db; llm: Llm; cfg: { explainers: ExplainersMode } },
  ep: { id: string },
  script: Script,
  assets: { images?: Array<{ file: string; kind?: string; aspect?: number }> },
  dir: string,
  deps: { ask?: (file: string, prompt: string) => Promise<unknown> } = {},
): Promise<void> {
  if (!explainersOn(s.cfg.explainers, "short") || script.explainers) return;
  try {
    const r = await markShortExplainers(s.llm, script);
    const notes = [...r.dropped];
    const kept: ShortExplainer[] = await placeAll(
      r.explainers,
      anatomyPictures(assets.images ?? [], dir),
      script.game_title,
      deps.ask ?? ((f, p) => anatomyAsk(f, p, 45_000)),
      notes,
      "tall",
    );
    script.explainers = kept;
    await s.db.query(`UPDATE episodes SET script_json = $2 WHERE id = $1`, [
      ep.id,
      JSON.stringify(script),
    ]);
    await logEvent(s.db, ep.id, "explainers", {
      kept: explainersNote(kept),
      count: kept.length,
      notes: notes.slice(0, 20),
    }).catch(() => undefined);
    log("info", "explainers", { episode: ep.id, kept: kept.length });
  } catch (err) {
    log("warn", "explainers failed", {
      episode: ep.id,
      error: errorMessage(err),
    });
  }
}

/**
 * A documentary's explainers: per chapter, one pass over its sentences and source, each kept explainer written on its
 * sentence's moment. Sentences that already carry a graphic are not offered. Returns how many were kept.
 */
export async function longExplainersStep(
  s: { db: Db; llm: Llm; cfg: { explainers: ExplainersMode } },
  ep: { id: string },
  chapters: Array<{
    game: string;
    sentences: string[];
    source: string;
    moments: Array<{ graphic?: { kind: string }; explainer?: Explainer }>;
    pictures: Array<{ file: string; src: string; aspect?: number }>;
  }>,
  deps: { ask?: (file: string, prompt: string) => Promise<unknown> } = {},
): Promise<number> {
  if (!explainersOn(s.cfg.explainers, "long")) return 0;
  let count = 0;
  const notes: string[] = [];
  for (const ch of chapters) {
    if (ch.moments.some((m) => m.explainer)) continue;
    try {
      const taken = new Set(
        ch.moments
          .map((m, i) => (m.graphic && m.graphic.kind !== "none" ? i : -1))
          .filter((i) => i >= 0),
      );
      const r = await markChapterExplainers(s.llm, {
        game: ch.game,
        sentences: ch.sentences,
        source: ch.source,
        taken,
      });
      notes.push(...r.dropped.slice(0, 6));
      const placed = await placeAll(
        [...r.explainers].map(([line, explainer]) => ({ line, explainer })),
        ch.pictures,
        ch.game,
        deps.ask ?? ((f, p) => anatomyAsk(f, p, 45_000)),
        notes,
        "wide",
      );
      for (const p of placed)
        if (ch.moments[p.line]) {
          ch.moments[p.line]!.explainer = p.explainer;
          count++;
        }
    } catch (err) {
      notes.push(`chapter "${ch.game}": ${errorMessage(err).slice(0, 160)}`);
    }
  }
  await logEvent(s.db, ep.id, "explainers", {
    count,
    notes: notes.slice(0, 30),
  }).catch(() => undefined);
  return count;
}
