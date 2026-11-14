// The pre-publish edit director (RETENTION_DIRECTOR=off|advise|fix, default off; owner, 14 Nov 2026). Once a Short's
// shot plan is built, and before it renders, the retention model (src/retentionmodel.ts) predicts its retention curve
// and finds its weakest moments. Each weak moment gets a diagnosis and, where one is safe, a fix that the model itself
// re-scores before it is kept:
//   - a still or a plain plate where unused moving footage is waiting: the shot takes the footage instead;
//   - a first second without the strongest picture: the strongest picture (the hook moment, the liveliest footage,
//     the hero art) moves into it;
//   - a card whose text is long: its small second line goes (the narration still says it);
//   - a slow line (a long pause or a slow pace): no safe fix without a new voice take, so it is advice for the writers.
// Because it runs before the render, a fix never needs a re-render: the one render already has it. "advise" changes
// nothing and records the prediction and the advice (the episode's event log and assets.retention, which the shot
// picker and the writers' lessons read); "fix" also applies the fixes the model scores as gains. The ad-safety check
// of the first seconds runs after the director, so a swapped shot is screened like any other.

import fs from "node:fs";
import path from "node:path";
import { QUIET_KINDS, type RenderPlan, type Shot } from "./render/plan.ts";
import type { Segment } from "./render/timeline.ts";
import type { Script } from "./editorial/schema.ts";
import type { Word } from "./voice/elevenlabs.ts";
import {
  applyCardTrim,
  cardText,
  predictFrame,
  shortFrame,
  weakMoments,
  type CardTrim,
  type Prediction,
  type RetentionModel,
  type SegmentsOf,
  type ShortFrame,
  type WeakMoment,
} from "./retentionmodel.ts";

export type DirectorMode = "off" | "advise" | "fix";

export function directorMode(v: string | undefined): DirectorMode {
  const m = String(v ?? "")
    .trim()
    .toLowerCase();
  return m === "advise" || m === "fix" ? m : "off";
}

export interface DirectorClip {
  durationSeconds: number;
  motion?: number;
  provenance?: string;
  beatIndex?: number;
  role?: string;
  luma?: number;
}

export interface DirectorImage {
  kind?: string;
  luma?: number;
  aesthetic?: number;
  role?: string;
  wordy?: boolean;
  frame?: boolean;
}

export interface DirectorInput {
  lane: string;
  script: Script;
  words: Word[];
  /** The narration's length in seconds (assets.durationSeconds). */
  spokenSeconds: number;
  segments: Segment[];
  plan: RenderPlan;
  images: DirectorImage[];
  clips: DirectorClip[];
  gameAudio?: unknown;
  desk?: boolean;
}

export interface Fix {
  kind: "footage" | "opening" | "card_text";
  /** What changed, in words. */
  what: string;
  /** Predicted gain in points of the average share watched. */
  gain: number;
  shot?: number;
  segment?: number;
}

export interface WeakReport extends WeakMoment {
  said: string;
  /** What was on screen: the shot's kind, the card, a pause. */
  onScreen: string[];
  advice: string[];
}

export interface DirectorReport {
  mode: DirectorMode;
  at: string;
  model: {
    trainedAt: string;
    videos: number;
    withinSpearman?: number;
    dropPrecision?: number;
    chancePrecision?: number;
  };
  /** Predicted average share watched (relative to the first second), percent, and our usual curve's for this length. */
  predicted: number;
  usual: number;
  /** After the fixes ("fix" only). */
  after?: number;
  weak: WeakReport[];
  /** Fixes the model scored as gains: applied in "fix", proposed in "advise". */
  fixes: Fix[];
  /** Advice for the writers and the shot picker (also for what could not be fixed safely). */
  advice: string[];
  cardTrims: CardTrim[];
  /** The predicted curve, 21 points (every 5% of the length), percent of the first second. */
  curve: number[];
  curveAfter?: number[];
}

/** A fix is kept only when the model predicts at least this gain (points of the average share watched). */
export const MIN_GAIN = 0.15;
/** A card's text is long from this many characters (a 1080-wide card fits about two short lines). */
export const LONG_CARD = 34;
/**
 * Cards whose small second line is a subtitle the card reads without (a title's tag, a timeline's or a date's caption):
 * the only ones trimmed. A stat, price or score needs its label; a quote, report or rank names its source.
 */
export const TRIM_SECONDARY = new Set(["title", "timeline", "date", "milestones", "platforms", "chapter", "specs"]);
/** A pause this long (s) inside a weak moment is a slow line. */
export const SLOW_PAUSE = 0.45;
/** Narration slower than this (words a second) inside a weak moment is a slow line. */
export const SLOW_WPS = 2.3;

const pct = (x: number) => +(100 * x).toFixed(1);

/** The frame the model reads, from the director's input (pure). */
export function frameOf(
  input: DirectorInput,
  segmentsOf: SegmentsOf,
  trims: CardTrim[] = [],
): ShortFrame | undefined {
  const segments = structuredClone(input.segments);
  for (const t of trims) applyCardTrim(segments, t);
  return shortFrame(
    {
      lane: input.lane,
      script: input.script,
      gameAudio: input.gameAudio,
      assets: {
        words: input.words,
        durationSeconds: input.spokenSeconds,
        plan: input.plan,
        clips: input.clips,
        desk: input.desk,
      },
    },
    segmentsOf,
    undefined,
    segments,
  );
}

const sample21 = (rel: number[]) =>
  Array.from({ length: 21 }, (_, k) =>
    pct(
      rel[Math.min(rel.length - 1, Math.round((k / 20) * (rel.length - 1)))]!,
    ),
  );

/** How many frames of each clip the plan already uses (the furthest frame reached), by clip index. */
export function clipFramesUsed(plan: RenderPlan): Map<number, number> {
  const used = new Map<number, number>();
  for (const s of plan.shots)
    if (s.media.type === "clip")
      used.set(
        s.media.index,
        Math.max(
          used.get(s.media.index) ?? 0,
          (s.media.trimFrom ?? 0) + (s.end - s.start),
        ),
      );
  return used;
}

/** The clips that can still fill `frames` with footage not yet shown, best first (pure). */
export function freshFootage(
  plan: RenderPlan,
  clips: DirectorClip[],
  frames: number,
  beat?: number,
): Array<{ index: number; trimFrom: number }> {
  const used = clipFramesUsed(plan);
  return clips
    .map((c, index) => ({ c, index, trimFrom: used.get(index) ?? 0 }))
    .filter(
      ({ c, trimFrom }) =>
        Math.floor(c.durationSeconds * plan.fps) - trimFrom >= frames,
    )
    .sort(
      (a, b) =>
        Number(b.c.beatIndex === beat && beat !== undefined) -
          Number(a.c.beatIndex === beat && beat !== undefined) ||
        Number(a.c.beatIndex !== undefined && a.c.beatIndex !== beat) -
          Number(b.c.beatIndex !== undefined && b.c.beatIndex !== beat) ||
        (b.c.motion ?? 0.5) - (a.c.motion ?? 0.5) ||
        a.index - b.index,
    )
    .map(({ index, trimFrom }) => ({ index, trimFrom }));
}


/** The beat index of a segment (0 for the first beat), or undefined for the hook, take and loop. */
function beatOf(segments: Segment[], k: number): number | undefined {
  if (segments[k]?.kind !== "beat") return undefined;
  return segments.slice(0, k).filter((g) => g.kind === "beat").length;
}

/** The shot covering a second. */
const shotAt = (plan: RenderPlan, t: number) =>
  plan.shots.findIndex((s) => t * plan.fps >= s.start && t * plan.fps < s.end);

function describe(
  input: DirectorInput,
  frame: ShortFrame,
  w: WeakMoment,
): { said: string; onScreen: string[]; slow: boolean; slowWhy: string } {
  const said = input.words
    .filter((x) => x.end > w.from - 0.3 && x.start < w.to + 0.3)
    .map((x) => x.text)
    .join(" ");
  const on = new Set<string>();
  for (const s of frame.shots.filter((s) => s.from < w.to && s.to > w.from))
    on.add(
      s.type === "plate"
        ? "a plain plate"
        : s.type === "image"
          ? s.static
            ? "a static still"
            : "a still picture"
          : s.trailer
            ? "trailer footage"
            : "moving footage",
    );
  for (const c of frame.cards.filter((c) => c.from < w.to && c.to > w.from))
    on.add(`a ${c.kind} card (${c.chars} characters)`);
  const ws = input.words.filter((x) => x.end > w.from && x.start < w.to);
  const gaps: number[] = [];
  for (let i = 1; i < input.words.length; i++) {
    const a = input.words[i - 1]!;
    const b = input.words[i]!;
    if (b.start > w.from && a.end < w.to) gaps.push(b.start - a.end);
  }
  const maxGap = Math.max(0, ...gaps);
  const wps = ws.length / Math.max(0.5, w.to - w.from);
  const slow = maxGap >= SLOW_PAUSE || (ws.length > 0 && wps < SLOW_WPS);
  if (maxGap >= SLOW_PAUSE) on.add(`a ${maxGap.toFixed(1)} s pause`);
  return {
    said,
    onScreen: [...on],
    slow,
    slowWhy:
      maxGap >= SLOW_PAUSE
        ? `a ${maxGap.toFixed(1)} s pause`
        : `${wps.toFixed(1)} words a second`,
  };
}

/**
 * The director (pure apart from the plan and segments it changes in "fix"): predicts, finds the weak moments, scores
 * each candidate fix with the model, keeps the gains. In "fix" it changes `input.plan.shots` and `input.segments` in
 * place and returns the card trims to store (so a retried render repeats them).
 */
export function directShort(
  model: RetentionModel,
  input: DirectorInput,
  mode: DirectorMode,
  segmentsOf: SegmentsOf,
  now = new Date(),
): DirectorReport | undefined {
  if (mode === "off") return undefined;
  const frame0 = frameOf(input, segmentsOf);
  if (!frame0) return undefined;
  const before = predictFrame(model, frame0);
  const weak = weakMoments(before.steps, {
    n: 3,
    seconds: 1.5,
    minExcess: 0.01,
  });
  // Work on a copy; "fix" copies the result back.
  const work: DirectorInput = { ...input, plan: structuredClone(input.plan) };
  const trims: CardTrim[] = [];
  const score = (): Prediction | undefined => {
    const f = frameOf(work, segmentsOf, trims);
    return f ? predictFrame(model, f) : undefined;
  };
  let current = before;
  const fixes: Fix[] = [];
  const advice: string[] = [];
  const tryFix = (
    apply: () => (() => void) | undefined,
    fix: Omit<Fix, "gain">,
  ) => {
    const undo = apply();
    if (!undo) return false;
    const p = score();
    const gain = p ? 100 * (p.avg - current.avg) : 0;
    if (p && gain >= MIN_GAIN) {
      fixes.push({ ...fix, gain: +gain.toFixed(2) });
      current = p;
      return true;
    }
    undo();
    return false;
  };
  const fps = work.plan.fps;
  // 1. The first second: the strongest picture belongs there.
  const firstShot = shotAt(work.plan, 0.7);
  const fs0 = work.plan.shots[firstShot];
  if (fs0 && fs0.media.type !== "clip" && fs0.media.type !== "scene") {
    const len = fs0.end - fs0.start;
    const hook = work.clips.findIndex((c) => c.role === "hook");
    const cands = [
      ...(hook >= 0
        ? freshFootage(work.plan, work.clips, len).filter(
            (c) => c.index === hook,
          )
        : []),
      ...freshFootage(work.plan, work.clips, len),
    ];
    for (const c of cands.slice(0, 3))
      if (
        tryFix(
          () =>
            swapMedia(
              work.plan,
              firstShot,
              { type: "clip", index: c.index, trimFrom: c.trimFrom },
              framedFor(work, fs0),
              work.clips[c.index]?.luma,
            ),
          {
            kind: "opening",
            what: `the first second now opens on moving footage (clip ${c.index + 1}) instead of ${fs0.media.type === "plate" ? "a plain plate" : "a still"}`,
            shot: firstShot,
          },
        )
      )
        break;
    if (work.plan.shots[firstShot]!.media.type === "plate") {
      const best = strongestImage(work.images);
      if (best !== undefined)
        tryFix(
          () =>
            swapMedia(
              work.plan,
              firstShot,
              { type: "image", index: best },
              fs0.framed,
              work.images[best]?.luma,
            ),
          {
            kind: "opening",
            what: `the first second now shows the strongest picture (image ${best + 1}) instead of a plain plate`,
            shot: firstShot,
          },
        );
    }
  }
  // 2. Each weak moment.
  const weakReports: WeakReport[] = [];
  for (const w of weak) {
    const d = describe(input, frame0, w);
    const rep: WeakReport = {
      ...w,
      excess: +w.excess.toFixed(4),
      said: d.said,
      onScreen: d.onScreen,
      advice: [],
    };
    // Stills and plates in it take fresh footage.
    const shotIdx = work.plan.shots
      .map((s, i) => ({ s, i }))
      .filter(
        ({ s }) =>
          s.start / fps < w.to && s.end / fps > w.from && s.start >= 12,
      );
    for (const { s, i } of shotIdx) {
      if (s.media.type === "clip" || s.media.type === "scene") continue;
      const beat = beatOf(work.segments, s.segment);
      const cands = freshFootage(work.plan, work.clips, s.end - s.start, beat);
      let done = false;
      for (const c of cands.slice(0, 3)) {
        done = tryFix(
          () =>
            swapMedia(
              work.plan,
              i,
              { type: "clip", index: c.index, trimFrom: c.trimFrom },
              framedFor(work, s),
              work.clips[c.index]?.luma,
            ),
          {
            kind: "footage",
            what: `shot ${i + 1} (${(s.start / fps).toFixed(1)}-${(s.end / fps).toFixed(1)} s) shows moving footage (clip ${c.index + 1}) instead of ${s.media.type === "plate" ? "a plain plate" : "a still"}`,
            shot: i,
          },
        );
        if (done) break;
      }
      if (!done && !cands.length)
        rep.advice.push(
          `Shot picker: ${(s.start / fps).toFixed(1)}-${(s.end / fps).toFixed(1)} s is ${s.media.type === "plate" ? "a plain plate" : "a still"} with no unused footage left to swap in; fetch footage for "${d.said.slice(0, 60)}".`,
        );
    }
    // Long card text in it loses its second line.
    const segs = new Set(
      work.segments
        .map((g, k) => ({ g, k }))
        .filter(
          ({ g }) => g.start < w.to && g.end > w.from && g.kind !== "hook",
        )
        .map(({ k }) => k),
    );
    for (const k of segs) {
      const v = work.segments[k]!.visual;
      if (
        !v ||
        v.kind === "none" ||
        !v.secondary ||
        !TRIM_SECONDARY.has(v.kind) ||
        cardText(v).length < LONG_CARD
      )
        continue;
      const t: CardTrim = { segment: k, dropSecondary: true };
      const ok = tryFix(
        () => {
          trims.push(t);
          return () => trims.pop();
        },
        {
          kind: "card_text",
          what: `the ${v.kind} card loses its second line ("${v.secondary}"): ${cardText(v).length} characters were too many to read in time`,
          segment: k,
        },
      );
      if (!ok)
        rep.advice.push(
          `Writers: the ${v.kind} card here carries ${cardText(v).length} characters; keep cards under ${LONG_CARD}.`,
        );
    }
    if (d.slow)
      rep.advice.push(
        `Writers: tighten "${d.said.slice(0, 80)}" (${d.slowWhy}); a faster, fuller line holds viewers here.`,
      );
    weakReports.push(rep);
    advice.push(...rep.advice);
  }
  const report: DirectorReport = {
    mode,
    at: now.toISOString(),
    model: {
      trainedAt: model.trainedAt,
      videos: model.videos,
      withinSpearman: model.validation?.withinSpearman.gbm,
      dropPrecision: model.validation?.drops.precision,
      chancePrecision: model.validation?.drops.randomPrecision,
    },
    predicted: pct(before.avg),
    usual: pct(before.baseAvg),
    weak: weakReports,
    fixes,
    advice: [...new Set(advice)],
    cardTrims: mode === "fix" ? trims : [],
    curve: sample21(before.rel),
  };
  if (mode === "fix" && fixes.length) {
    input.plan.shots = work.plan.shots;
    for (const t of trims) applyCardTrim(input.segments, t);
    report.after = pct(current.avg);
    report.curveAfter = sample21(current.rel);
  } else if (fixes.length) report.after = pct(current.avg);
  return report;
}

function framedFor(input: DirectorInput, s: Shot): boolean {
  const v = input.segments[s.segment]?.visual;
  return Boolean(v && QUIET_KINDS.has(v.kind));
}

/** Swaps a shot's picture (its brightness follows); returns the undo. */
function swapMedia(plan: RenderPlan, i: number, media: Shot["media"], framed: boolean, luma?: number): () => void {
  const prev = plan.shots[i]!;
  const was = { ...prev, media: { ...prev.media } };
  plan.shots[i] = { ...prev, media, framed, luma: luma ?? prev.luma };
  return () => {
    plan.shots[i] = was;
  };
}

/** The strongest still: the picture editor's hook pick, then the best aesthetic score, then the brightest clean art. */
export function strongestImage(images: DirectorImage[]): number | undefined {
  const ok = images
    .map((im, i) => ({ im, i }))
    .filter(({ im }) => !im.wordy && !im.frame);
  if (!ok.length) return undefined;
  const hook = ok.find(({ im }) => im.role === "hook");
  if (hook) return hook.i;
  return ok.sort(
    (a, b) =>
      (b.im.aesthetic ?? -2) - (a.im.aesthetic ?? -2) ||
      (b.im.luma ?? 0) - (a.im.luma ?? 0) ||
      a.i - b.i,
  )[0]!.i;
}

// ---------------------------------------------------------------- the model file

/** Where the trained model lives under the data folder. */
export const modelFile = (dataDir: string) =>
  path.join(dataDir, "retention", "model.json");

let cached: { file: string; mtime: number; model: RetentionModel } | undefined;

/** The trained model, or undefined when none has been trained yet (read once, again when the file changes). */
export function loadModel(dataDir: string): RetentionModel | undefined {
  const file = modelFile(dataDir);
  try {
    const mtime = fs.statSync(file).mtimeMs;
    if (cached?.file === file && cached.mtime === mtime) return cached.model;
    const model = JSON.parse(fs.readFileSync(file, "utf8")) as RetentionModel;
    if (model.version !== 1 || !model.gbm?.trees) return undefined;
    cached = { file, mtime, model };
    return model;
  } catch {
    return undefined;
  }
}

export function saveModel(dataDir: string, model: RetentionModel): void {
  const file = modelFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(model));
  fs.renameSync(tmp, file);
}

/** The report in a few lines for the event log and Discord. */
export function directorSummary(r: DirectorReport): string {
  const parts = [
    `predicted ${r.predicted}% watched on average (our usual curve ${r.usual}%)`,
  ];
  if (r.fixes.length)
    parts.push(
      `${r.mode === "fix" ? "fixed" : "would fix"}: ${r.fixes.map((f) => `${f.what} (+${f.gain})`).join("; ")}${r.after !== undefined ? `, now ${r.after}%` : ""}`,
    );
  if (r.weak.length)
    parts.push(
      `weakest: ${r.weak.map((w) => `${w.from.toFixed(1)}-${w.to.toFixed(1)} s`).join(", ")}`,
    );
  return parts.join(". ");
}
