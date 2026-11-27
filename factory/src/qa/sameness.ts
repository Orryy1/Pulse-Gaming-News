// How alike the newest Shorts are (gap 2 of the 18 Nov 2026 top creator gap plan): the same effect sequence, the same
// first and last effect, the same opening and closing, the same music bed, the same card order. YouTube's test before
// a channel can earn is whether its videos look made from a template, and its reviewers sample the newest uploads,
// so this is scored over the newest N (30 by default) and printed for the weekly report by src/tools/sameness.ts.
// Pure: rows in, numbers out.

import type { SfxCue } from "../render/plan.ts";
import { sequenceOf, sfxName } from "../render/untemplate.ts";

/** One Short as the score sees it. */
export interface SameRecord {
  id: string;
  /** Effect names in order of play ("sting", "air-1"). */
  sfx: string[];
  open: string;
  close: string;
  bed: string;
  /** The cards' kinds in order ("stat>quote>title"). */
  cards: string[];
  seconds: number;
}

/** A Short's record from its stored episode (pure): plan, shape, bed and script as the database keeps them. */
export function recordOf(row: {
  id: string;
  assets?: {
    plan?: { sfx?: SfxCue[]; totalFrames?: number; fps?: number };
    shortShape?: { open?: string; close?: string };
    musicFile?: string | null;
  } | null;
  script?: {
    beats?: Array<{ visual?: { kind?: string; primary?: string } | null }>;
    pulse_take?: { on_screen?: string };
  } | null;
}): SameRecord {
  const plan = row.assets?.plan;
  const sfx = [...(plan?.sfx ?? [])]
    .filter((c) => c && typeof c.file === "string")
    .sort((a, b) => a.frame - b.frame);
  const cards = (row.script?.beats ?? [])
    .map((b) => b?.visual?.kind)
    .filter((k): k is string => !!k && k !== "none");
  if (row.script?.pulse_take?.on_screen?.trim()) cards.push("title");
  return {
    id: row.id,
    sfx: sfx.map((c) => sfxName(c.file)),
    open: row.assets?.shortShape?.open ?? "card",
    close: row.assets?.shortShape?.close ?? "card",
    bed: (row.assets?.musicFile ?? "").split(/[\\/]/).pop() || "none",
    cards,
    seconds: plan?.totalFrames && plan.fps ? plan.totalFrames / plan.fps : 0,
  };
}

export interface SameScore {
  n: number;
  /** Share whose (non-empty) effect sequence another Short in the window also has. */
  sharedSequence: number;
  /** The same, counting Shorts with no effect at all as one shared sequence. */
  sharedSequenceWithSilent: number;
  /** The most common sequence and its share. */
  topSequence: { sequence: string; share: number };
  /** Share starting on the most common first effect, and that effect; the same for the last. */
  sameFirst: { effect: string; share: number };
  sameLast: { effect: string; share: number };
  /** Share playing no effect at all. */
  silent: number;
  /** Effects per 10 s, mean over the window. */
  effectsPer10s: number;
  /** Distinct effect files heard in the window. */
  vocabulary: number;
  opening: Array<[string, number]>;
  closing: Array<[string, number]>;
  beds: Array<[string, number]>;
  /** Share whose (non-empty) card order another Short in the window also has. */
  sharedCardOrder: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Values by share, largest first, ties by name. */
function shares(values: string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([k, c]) => [k, r2(c / Math.max(1, values.length))]);
}

/** Share of items whose key another item also has; empty keys are skipped unless `countEmpty`. */
function sharedShare(keys: string[], countEmpty = false): number {
  const m = new Map<string, number>();
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
  const hit = keys.filter(
    (k) => (countEmpty || k !== "") && (m.get(k) ?? 0) > 1,
  ).length;
  return r2(hit / Math.max(1, keys.length));
}

/** The sameness score of the newest `n` records (pure); records newest first. */
export function samenessScore(records: SameRecord[], n = 30): SameScore {
  const w = records.slice(0, n);
  const seqs = w.map((r) => r.sfx.join(">"));
  const top = shares(seqs.filter(Boolean))[0];
  const first = shares(w.map((r) => r.sfx[0] ?? "(none)"))[0];
  const last = shares(w.map((r) => r.sfx.at(-1) ?? "(none)"))[0];
  const per10 = w
    .filter((r) => r.seconds > 0)
    .map((r) => (r.sfx.length / r.seconds) * 10);
  return {
    n: w.length,
    sharedSequence: sharedShare(seqs),
    sharedSequenceWithSilent: sharedShare(seqs, true),
    topSequence: top
      ? {
          sequence: top[0],
          share: r2(
            seqs.filter((s) => s === top[0]).length / Math.max(1, w.length),
          ),
        }
      : { sequence: "", share: 0 },
    sameFirst: { effect: first?.[0] ?? "", share: first?.[1] ?? 0 },
    sameLast: { effect: last?.[0] ?? "", share: last?.[1] ?? 0 },
    silent: r2(w.filter((r) => !r.sfx.length).length / Math.max(1, w.length)),
    effectsPer10s: r2(
      per10.reduce((a, b) => a + b, 0) / Math.max(1, per10.length),
    ),
    vocabulary: new Set(w.flatMap((r) => r.sfx)).size,
    opening: shares(w.map((r) => r.open)),
    closing: shares(w.map((r) => r.close)),
    beds: shares(w.map((r) => r.bed)),
    sharedCardOrder: sharedShare(w.map((r) => r.cards.join(">"))),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const list = (xs: Array<[string, number]>, max = 6) =>
  xs
    .slice(0, max)
    .map(([k, v]) => `${k} ${pct(v)}`)
    .join(", ") + (xs.length > max ? `, +${xs.length - max} more` : "");

/** The score as a Markdown table for the weekly report; with `after`, a before and after column. */
export function samenessTable(
  before: SameScore,
  after?: SameScore,
  labels = ["Now", "After"],
): string {
  const rows: Array<[string, (s: SameScore) => string]> = [
    ["Shorts in the window", (s) => String(s.n)],
    [
      "Same effect sequence as another Short (target under 15%)",
      (s) => pct(s.sharedSequence),
    ],
    [
      "... counting Shorts with no effect as one sequence",
      (s) => pct(s.sharedSequenceWithSilent),
    ],
    [
      "Most common sequence",
      (s) =>
        s.topSequence.sequence
          ? `${s.topSequence.sequence} (${pct(s.topSequence.share)})`
          : "none",
    ],
    [
      "Start on the same effect",
      (s) => `${s.sameFirst.effect} ${pct(s.sameFirst.share)}`,
    ],
    [
      "End on the same effect",
      (s) => `${s.sameLast.effect} ${pct(s.sameLast.share)}`,
    ],
    ["No effect at all", (s) => pct(s.silent)],
    ["Effects per 10 s (hits: 0.36)", (s) => s.effectsPer10s.toFixed(2)],
    ["Effect files heard", (s) => String(s.vocabulary)],
    ["Openings (no one over 40%)", (s) => list(s.opening)],
    ["Closings", (s) => list(s.closing)],
    ["Music beds", (s) => list(s.beds)],
    ["Same card order as another Short", (s) => pct(s.sharedCardOrder)],
  ];
  const head = after
    ? `| Measure | ${labels[0]} | ${labels[1]} |\n| --- | --- | --- |`
    : `| Measure | ${labels[0]} |\n| --- | --- |`;
  return [
    head,
    ...rows.map(([name, f]) =>
      after
        ? `| ${name} | ${f(before)} | ${f(after)} |`
        : `| ${name} | ${f(before)} |`,
    ),
  ].join("\n");
}

export { sequenceOf };
