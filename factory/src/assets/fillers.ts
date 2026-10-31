// One chooser over every filler family (31 Oct 2026). After the sentence top-up (./fill.ts) and the graphics
// pass, about one documentary sentence in five still has nothing of its own on screen: a meeting, a decision,
// a late night, a shipment, a turn in the story. Six families were built to answer those lines, each with a
// pure chooser that offers a candidate with a confidence (0..1 on one scale) and a reason, or declines:
// kinetic type and explainer diagrams (src/render/components/kinetic, diagram), archive documents (docs),
// drawn period objects and silhouettes (objects) and in-game reconstructions (./recon.ts, which looks at its
// clips' frames first). This pass asks every family about every sentence that is bare (no picture, clip or
// graphic of its own) or stock-only (its only own media is an illustrative stock clip), then picks one per
// sentence by confidence under variety rules a picture editor would keep:
//   - never the same family on two sentences in a row;
//   - at most KINETIC_PER_CHAPTER kinetic cards and DOCUMENTS_PER_CHAPTER document pages a chapter, and one
//     drawn scene of each kind a chapter;
//   - a reconstruction's clip stages one scene per video (reconForVideo enforces it);
//   - a stock-only sentence keeps its stock unless the best candidate reaches STOCK_UPGRADE (0.7);
//   - the chapter's first sentence plays under its title card and is never given one.
// Concept sketches and AI motion clips are not chosen here: when their settings are on (ILLUSTRATE_ENABLED,
// ILLUSTRATE_VIDEO_ENABLED) the fill pass has already drawn and pinned them, so those sentences are no longer
// bare; this pass only counts them. Every word a filler puts on screen comes from its sentence, the chapter's
// text or a fixed label (each family's own rule), and every invented scene carries its ILLUSTRATION or
// RECONSTRUCTION tag on screen. No model is called.

import {
  kineticVerdict,
  type KineticData,
} from "../render/components/kinetic/choose.ts";
import {
  diagramVerdict,
  type DiagramData,
} from "../render/components/diagram/choose.ts";
import { documentFor } from "../render/components/docs/choose.ts";
import {
  objectsDecision,
  silhouetteDecision,
} from "../render/components/objects/choose.ts";
import { backdropFor } from "../render/components/kinetic/backdrop.ts";
import type {
  FillerChapter,
  FillerMoment,
} from "../render/components/kinetic/types.ts";
import {
  judgeRecon,
  reconForVideo,
  type ReconCandidate,
  type ReconClip,
  type ReconClipCheck,
  type ReconMoment,
} from "./recon.ts";
import { illustratable } from "./illustrate.ts";
import {
  FAMILY_WORDS,
  FILLER_FAMILIES,
  type FillerFamily,
  type MomentFiller,
} from "../render/fillerplan.ts";

/** At most this many kinetic cards in one chapter: type is a punctuation mark, not the picture. */
export const KINETIC_PER_CHAPTER = 3;
/** At most this many document pages in one chapter. */
export const DOCUMENTS_PER_CHAPTER = 2;
/** A stock-only sentence gives up its stock clip only for a candidate at least this sure. */
export const STOCK_UPGRADE = 0.7;
/** Below this no candidate is taken, whatever its family says (documents offer general memos at 0.48). */
export const FILLER_MIN_CONFIDENCE = 0.45;

/** A shot-list moment as the episode stores it (src/editorial/documentary.ts DocMoment, loosened). */
export interface FillerShotMoment extends FillerMoment {
  show: string;
  keywords?: string[];
  filler?: MomentFiller;
}

export interface FillersChapter {
  /** beatIndex of the chapter's pictures and clips. */
  entry: number;
  game: string;
  year?: number;
  sentences: string[];
  moments: FillerShotMoment[];
}

export type FillerImage = {
  file: string;
  kind: string;
  aspect?: number;
  label?: string;
  beatIndex?: number;
  moment?: number;
};
export type FillerClip = ReconClip;

/** Why a sentence is eligible: nothing of its own, or only an illustrative stock clip. */
export type Need = "bare" | "stock";

/** The sentences a filler may serve in one chapter, with their need. Pure. */
export function needsOf(
  ch: FillersChapter,
  images: FillerImage[],
  clips: FillerClip[],
): Map<number, Need> {
  const own = new Set<number>();
  const stock = new Set<number>();
  for (const x of images)
    if (x.beatIndex === ch.entry && x.moment !== undefined) own.add(x.moment);
  for (const c of clips)
    if (c.beatIndex === ch.entry && c.moment !== undefined)
      (c.stock ? stock : own).add(c.moment);
  const out = new Map<number, Need>();
  ch.moments.forEach((m, k) => {
    if (k === 0 || k >= ch.sentences.length) return;
    if (m.graphic && m.graphic.kind !== "none") return;
    if (own.has(k)) return;
    out.set(k, stock.has(k) ? "stock" : "bare");
  });
  return out;
}

/** One family's offer for one sentence, in a shape every family shares. */
export interface Offer {
  family: FillerFamily;
  style: string;
  confidence: number;
  reason: string;
  /** What the decision stores (before the backdrop and the rotation are settled). */
  raw: unknown;
}

/** Every family's offer for a sentence, and each declining family's reason. Pure. */
export function offersFor(
  ch: FillersChapter,
  k: number,
  recon: ReconCandidate | undefined,
  seed: number,
): { offers: Offer[]; declined: Partial<Record<FillerFamily, string>> } {
  const sentence = ch.sentences[k] ?? "";
  const m = ch.moments[k]!;
  const chapter: FillerChapter = {
    game: ch.game,
    year: ch.year,
    sentences: ch.sentences,
    moments: ch.moments,
  };
  const offers: Offer[] = [];
  const declined: Partial<Record<FillerFamily, string>> = {};
  const kv = kineticVerdict(sentence, m, chapter, { index: k, seed });
  if ("candidate" in kv)
    offers.push({
      family: "kinetic",
      style: kv.candidate.style,
      confidence: kv.candidate.confidence,
      reason: kv.candidate.reason,
      raw: kv.candidate.data,
    });
  else declined.kinetic = kv.declined;
  const dv = diagramVerdict(sentence, m, chapter, { index: k, seed });
  if ("candidate" in dv)
    offers.push({
      family: "diagram",
      style: dv.candidate.style,
      confidence: dv.candidate.confidence,
      reason: dv.candidate.reason,
      raw: dv.candidate.data,
    });
  else declined.diagram = dv.declined;
  const doc = documentFor(sentence, m, { game: ch.game, year: ch.year });
  if (doc)
    offers.push({
      family: "document",
      style: doc.kind,
      confidence: doc.confidence,
      reason: doc.reason,
      raw: doc.scene,
    });
  else declined.document = "no paper of the line's business";
  const scene = {
    show: m.show ?? "",
    broll: m.broll,
    person: m.person,
    graphic: m.graphic,
  };
  for (const [family, decide] of [
    ["objects", objectsDecision],
    ["silhouettes", silhouetteDecision],
  ] as const) {
    const d = decide(sentence, scene, { game: ch.game, year: ch.year });
    if (d.candidate)
      offers.push({
        family,
        style: d.candidate.style,
        confidence: d.candidate.confidence,
        reason: d.candidate.reason,
        raw: d.candidate,
      });
    else declined[family] = d.declined;
  }
  if (recon)
    offers.push({
      family: "recon",
      style: "scope",
      confidence: recon.confidence,
      reason: recon.reason,
      raw: recon,
    });
  return { offers, declined };
}

const ORDER = new Map(FILLER_FAMILIES.map((f, i) => [f, i]));

export interface FillerPick {
  entry: number;
  moment: number;
  need: Need;
  filler: MomentFiller;
}

export interface LeftBare {
  entry: number;
  moment: number;
  need: Need;
  sentence: string;
  why: string;
}

export interface FillerChoice {
  picks: FillerPick[];
  left: LeftBare[];
  /** Sentences that were eligible: bare and stock-only. */
  eligible: { bare: number; stock: number };
  counts: Partial<Record<FillerFamily, number>>;
}

export interface ChooseOptions {
  images: FillerImage[];
  clips: FillerClip[];
  /** The episode's variant: breaks ties and rotates styles the same way on a retry. */
  seed: number;
  /** Per chapter entry, sentence to the reconstruction reconForVideo verified. */
  recon?: Map<number, Map<number, ReconCandidate>>;
  /** ILLUSTRATE_ENABLED: says so when a line left bare is one a sketch would suit. */
  sketches?: boolean;
}

const short = (s: string, n = 90) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * The fillers for a whole documentary: per chapter, every eligible sentence's offers ranked by confidence and
 * taken greedily under the variety rules. Pure; the moments are not changed (applyFillers writes them).
 */
export function chooseFillers(
  chapters: FillersChapter[],
  opts: ChooseOptions,
): FillerChoice {
  const picks: FillerPick[] = [];
  const left: LeftBare[] = [];
  const eligible = { bare: 0, stock: 0 };
  const counts: Partial<Record<FillerFamily, number>> = {};
  const usedBackdrops: string[] = [];
  let previousKinetic: string | undefined;
  for (const ch of chapters) {
    const needs = needsOf(ch, opts.images, opts.clips);
    const offers = new Map<number, Offer[]>();
    const declines = new Map<number, Partial<Record<FillerFamily, string>>>();
    for (const [k, need] of needs) {
      need === "bare" ? eligible.bare++ : eligible.stock++;
      const o = offersFor(
        ch,
        k,
        opts.recon?.get(ch.entry)?.get(k),
        opts.seed + ch.entry,
      );
      declines.set(k, o.declined);
      offers.set(
        k,
        o.offers.filter(
          (x) =>
            x.confidence >= FILLER_MIN_CONFIDENCE &&
            (need === "bare" || x.confidence >= STOCK_UPGRADE),
        ),
      );
    }
    // Greedy over (sentence, offer) by confidence: the surest line takes its family first.
    const all = [...offers].flatMap(([k, list]) => list.map((o) => ({ k, o })));
    all.sort(
      (a, b) =>
        b.o.confidence - a.o.confidence ||
        a.k - b.k ||
        ORDER.get(a.o.family)! - ORDER.get(b.o.family)!,
    );
    const chosen = new Map<number, Offer>();
    const blocked = new Map<number, string>();
    const perFamily = new Map<FillerFamily, number>();
    const styles = new Set<string>();
    for (const { k, o } of all) {
      if (chosen.has(k)) continue;
      const n = perFamily.get(o.family) ?? 0;
      let why = "";
      if (
        chosen.get(k - 1)?.family === o.family ||
        chosen.get(k + 1)?.family === o.family
      )
        why = `the line beside it already has ${FAMILY_WORDS[o.family][0]}`;
      else if (o.family === "kinetic" && n >= KINETIC_PER_CHAPTER)
        why = `the chapter already has ${KINETIC_PER_CHAPTER} kinetic type cards`;
      else if (o.family === "document" && n >= DOCUMENTS_PER_CHAPTER)
        why = `the chapter already has ${DOCUMENTS_PER_CHAPTER} document pages`;
      else if (
        (o.family === "objects" || o.family === "silhouettes") &&
        styles.has(o.style)
      )
        why = `the chapter already shows that drawn scene (${o.style})`;
      if (why) {
        if (!blocked.has(k))
          blocked.set(k, `${o.family} ${o.confidence}: ${why}`);
        continue;
      }
      chosen.set(k, o);
      perFamily.set(o.family, n + 1);
      styles.add(o.style);
    }
    const chImages = opts.images.filter((x) => x.beatIndex === ch.entry);
    const indexOf = (file: string | undefined) =>
      file === undefined
        ? undefined
        : opts.images.findIndex((x) => x.file === file);
    const gamePicture = indexOf(
      (
        chImages.find((x) => x.kind === "hero") ??
        chImages.find(
          (x) => x.kind === "screenshot" && (x.aspect ?? 1.78) >= 1.2,
        )
      )?.file,
    );
    for (const [k, need] of needs) {
      const o = chosen.get(k);
      const sentence = ch.sentences[k] ?? "";
      if (!o) {
        left.push({
          entry: ch.entry,
          moment: k,
          need,
          sentence: short(sentence),
          why: whyLeft(
            ch,
            k,
            need,
            offers.get(k)!,
            blocked.get(k),
            declines.get(k)!,
            opts,
          ),
        });
        continue;
      }
      const m = ch.moments[k]!;
      let filler: MomentFiller;
      if (o.family === "kinetic") {
        // Restyled in story order so two cards in a row never share a look.
        const v = kineticVerdict(
          sentence,
          m,
          {
            game: ch.game,
            year: ch.year,
            sentences: ch.sentences,
            moments: ch.moments,
          },
          { index: k, seed: opts.seed + ch.entry, previous: previousKinetic },
        );
        const card = (
          "candidate" in v ? v.candidate.data : o.raw
        ) as KineticData;
        const style = "candidate" in v ? v.candidate.style : o.style;
        previousKinetic = style;
        const back = backdropFor(chImages, opts.seed + k, usedBackdrops);
        if (back) usedBackdrops.push(back);
        filler = {
          family: o.family,
          style,
          data: { card, backdrop: indexOf(back) },
          confidence: o.confidence,
          reason: o.reason,
        };
      } else if (o.family === "diagram") {
        const back = backdropFor(chImages, opts.seed + k, usedBackdrops);
        if (back) usedBackdrops.push(back);
        filler = {
          family: o.family,
          style: o.style,
          data: { diagram: o.raw as DiagramData, backdrop: indexOf(back) },
          confidence: o.confidence,
          reason: o.reason,
        };
      } else if (o.family === "document") {
        filler = {
          family: o.family,
          style: o.style,
          data: { scene: o.raw as never },
          confidence: o.confidence,
          reason: o.reason,
        };
      } else if (o.family === "recon") {
        const r = o.raw as ReconCandidate;
        const clip = opts.clips[r.clip];
        filler = {
          family: o.family,
          style: o.style,
          data: {
            clip: r.clip,
            tags: r.scene.tags,
            hud: r.hud,
            clipSeconds: clip?.durationSeconds ?? 0,
            game: ch.game,
            year: ch.year,
          },
          confidence: o.confidence,
          reason: o.reason,
        };
      } else {
        const c = o.raw as { year?: number; month?: string };
        filler = {
          family: o.family,
          style: o.style,
          data: {
            year: c.year,
            month: c.month,
            variant: opts.seed + ch.entry * 7 + k,
            picture: gamePicture,
          },
          confidence: o.confidence,
          reason: o.reason,
        };
      }
      picks.push({ entry: ch.entry, moment: k, need, filler });
      counts[o.family] = (counts[o.family] ?? 0) + 1;
    }
  }
  picks.sort((a, b) => a.entry - b.entry || a.moment - b.moment);
  left.sort((a, b) => a.entry - b.entry || a.moment - b.moment);
  return { picks, left, eligible, counts };
}

/** Why a sentence stays as it is, in plain English. */
function whyLeft(
  ch: FillersChapter,
  k: number,
  need: Need,
  offers: Offer[],
  blocked: string | undefined,
  declined: Partial<Record<FillerFamily, string>>,
  opts: ChooseOptions,
): string {
  if (blocked) return `variety rules: ${blocked}`;
  if (need === "stock")
    return `keeps its stock clip: no candidate reaches ${STOCK_UPGRADE}`;
  if (offers.length) return "every offer was under the bar";
  const m = ch.moments[k]!;
  const sketch =
    !opts.sketches &&
    illustratable(ch.sentences[k] ?? "", {
      show: m.show ?? "",
      person: m.person,
      broll: m.broll,
      graphic: m.graphic,
    })
      ? "a concept sketch would suit it (ILLUSTRATE_ENABLED is off); "
      : "";
  const parts = (["kinetic", "objects", "diagram"] as const)
    .map((f) => (declined[f] ? `${f}: ${short(declined[f]!, 60)}` : ""))
    .filter(Boolean);
  return `${sketch}no family fits (${parts.join("; ")})`;
}

/** Writes each pick on its moment (moment.filler) and clears any earlier decision. */
export function applyFillers(
  chapters: FillersChapter[],
  choice: FillerChoice,
): void {
  for (const ch of chapters) for (const m of ch.moments) delete m.filler;
  for (const p of choice.picks) {
    const ch = chapters.find((c) => c.entry === p.entry);
    const m = ch?.moments[p.moment];
    if (m) m.filler = p.filler;
  }
}

/** The reconstructions for every eligible sentence: chosen and frame-checked per video (./recon.ts). */
export async function reconPicks(
  chapters: FillersChapter[],
  images: FillerImage[],
  clips: FillerClip[],
  check: ReconClipCheck,
): Promise<{
  picks: Map<number, Map<number, ReconCandidate>>;
  refused: Map<number, string>;
}> {
  return reconForVideo(
    chapters.map((ch) => ({
      chapter: {
        entry: ch.entry,
        game: ch.game,
        year: ch.year,
        sentences: ch.sentences,
      },
      moments: ch.moments.map(
        (m) => ({ ...m, show: m.show ?? "" }) as ReconMoment,
      ),
      bare: [...needsOf(ch, images, clips).keys()],
    })),
    clips,
    check,
  );
}

/** Why a reconstruction was not offered for a sentence (for the audit); empty when it was. */
export function reconDecline(
  ch: FillersChapter,
  k: number,
  clips: FillerClip[],
): string {
  const j = judgeRecon(
    k,
    { ...ch.moments[k]!, show: ch.moments[k]?.show ?? "" } as ReconMoment,
    { entry: ch.entry, game: ch.game, year: ch.year, sentences: ch.sentences },
    clips,
  );
  return j.decline ?? "";
}

/** The event's payload: counts per family, eligibility and every sentence left as it was, with why. */
export function fillersEvent(
  choice: FillerChoice,
  extra: { sketches?: number; localvideo?: number; reconRefused?: number },
): Record<string, unknown> {
  return {
    counts: choice.counts,
    chosen: choice.picks.length,
    upgradedStock: choice.picks.filter((p) => p.need === "stock").length,
    eligible: choice.eligible,
    ...extra,
    left: choice.left.map((l) => ({
      at: `${l.entry}:${l.moment}`,
      need: l.need,
      sentence: l.sentence,
      why: l.why,
    })),
  };
}

/** The owner's Discord line, in plain English. */
export function fillersNotice(
  headline: string,
  choice: FillerChoice,
  /** The owner's word for the format (src/longformat.ts longKindLabel). */
  kind = "Documentary",
): string {
  const n = choice.picks.length;
  const parts = FILLER_FAMILIES.filter((f) => choice.counts[f]).map(
    (f) =>
      `${choice.counts[f]} ${FAMILY_WORDS[f][choice.counts[f] === 1 ? 0 : 1]}`,
  );
  const stock = choice.picks.filter((p) => p.need === "stock").length;
  const bare = choice.left.filter((l) => l.need === "bare").length;
  const total = choice.eligible.bare + choice.eligible.stock;
  if (!total)
    return `${kind} "${headline}": every line already has its own picture, clip or graphic; no filler visuals needed. Setting: FILLERS_ENABLED.`;
  return `${kind} "${headline}": ${n} of ${total} lines that nothing filmed can show now get a visual of their own${parts.length ? `: ${parts.join(", ")}` : ""}${stock ? ` (${stock} of them replacing a stock clip)` : ""}. Invented scenes are tagged ILLUSTRATION or RECONSTRUCTION on screen. ${bare} line${bare === 1 ? "" : "s"} stay on the chapter's footage because nothing fitted them. Setting: FILLERS_ENABLED.`;
}
