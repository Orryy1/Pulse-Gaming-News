// The humaniser (owner, 14 Nov 2026: the latest Short said "Sid Meier's" every single time; "a human would say the full
// name only the first time, then maybe shorten to Civ ... apply this as a general rule to lots of things"). It reads a
// script's spoken lines in order, Short or long video, and makes them sound like a person talking: progressive naming,
// no repeated openings or connectives, contractions and plain connectives, no AI-tell words or em dashes, exact
// spoken numbers, relative dates against the publish date, callbacks in long videos, capped filler and varied credits.
//
// HUMANISE=off|check|fix (src/config.ts, default off). "check" measures and logs; "fix" applies the safe fixes, sends
// what needs a rewrite back to the delivery writer once with exact notes, and the pipeline then runs the fact check on
// the result, keeping it only when it passes. The deterministic guard here (humaniseDrift) refuses any version where a
// figure, a name or a quotation moved; a "sounds human" score (humanScore) is measured and logged but never overrides
// clarity or facts.
//
// Pure: no I/O, no model calls.

import { factDrift } from "../friendpass.ts";
import { speakTitles } from "../../voice/speakable.ts";
import { scrubWikipedia } from "../attribution.ts";
import type { Script } from "../schema.ts";
import { aliasWords, dictionary, type Entity } from "./aliases.ts";
import { progressiveNaming } from "./naming.ts";
import {
  callbacks,
  humanNumbers,
  relativeDates,
  spokenFiguresBack,
} from "./numbers.ts";
import {
  aiTells,
  attribution,
  emDashes,
  filler,
  register,
  repetition,
  type Finding,
  type RuleContext,
  type RuleId,
} from "./rules.ts";
import { wordsOf } from "./text.ts";

export type HumaniseMode = "off" | "check" | "fix";

export const HUMANISE_MODES: HumaniseMode[] = ["off", "check", "fix"];

/** HUMANISE as read from the environment: anything unknown is "off". */
export function humaniseMode(raw: string | undefined): HumaniseMode {
  const v = (raw ?? "").trim().toLowerCase();
  return (HUMANISE_MODES as string[]).includes(v) ? (v as HumaniseMode) : "off";
}

export interface HumaniseOptions {
  mode: Exclude<HumaniseMode, "off">;
  format: "short" | "long";
  /** Extra dictionary entries (IGDB alternative names). */
  entities?: Entity[];
  /** The titles the script is about as games. */
  games?: string[];
  /** Narration already said earlier in the video. */
  earlier?: string;
  /** Segments never edited (character quotes). */
  locked?: boolean[];
  /** Segments whose figures and dates stay exact (the hook). */
  exact?: number[];
  /** Figures that carry the story (stamp, cards, headline). */
  pointFigures?: string[];
  /** The scheduled publish time; without it no date is made relative. */
  publishAt?: Date;
  /** The story is about a date: every date stays exact. */
  exactDates?: boolean;
}

export type RuleCounts = Record<RuleId, number>;

export interface HumaniseReport {
  counts: RuleCounts;
  findings: Finding[];
  /** Exact notes for the writer: what the safe fixes could not do. */
  notes: string[];
  /** "Sounds human", 0 to 10. Measured, never a gate. */
  score: number;
  words: number;
}

export interface HumaniseResult {
  segments: string[];
  before: HumaniseReport;
  after: HumaniseReport;
  /** Figures a rule turned into words on purpose (relative dates): the fact guard allows exactly these to go. */
  removedFigures: string[];
  changed: boolean;
}

const RULES: RuleId[] = [
  "naming",
  "repetition.near",
  "repetition.opening",
  "repetition.connective",
  "repetition.shape",
  "register.contraction",
  "register.formal",
  "register.rhythm",
  "aitell",
  "emdash",
  "numbers",
  "dates",
  "callback",
  "filler",
  "attribution",
];

const zero = (): RuleCounts =>
  Object.fromEntries(RULES.map((r) => [r, 0])) as RuleCounts;

// Weights per finding for the score: what the owner hears most (a repeated full title, an AI word) costs most.
const WEIGHT: Record<RuleId, number> = {
  naming: 1,
  "repetition.near": 0.3,
  "repetition.opening": 0.75,
  "repetition.connective": 0.5,
  "repetition.shape": 0.5,
  "register.contraction": 0.25,
  "register.formal": 0.5,
  "register.rhythm": 0.75,
  aitell: 1,
  emdash: 0.5,
  numbers: 0,
  dates: 0,
  callback: 0,
  filler: 0.5,
  attribution: 0.5,
};

/** "Sounds human", 0 to 10: ten less the weighted findings per 150 words (pure). */
export function humanScore(counts: RuleCounts, words: number): number {
  const penalty = RULES.reduce((a, r) => a + counts[r] * WEIGHT[r], 0);
  const per150 = (penalty * 150) / Math.max(words, 150);
  return Math.round(Math.max(0, Math.min(10, 10 - per150)) * 10) / 10;
}

/** One pass of every rule; `fix` decides whether segments change. */
function pass(segments: string[], opts: HumaniseOptions, fix: boolean) {
  const ctx: RuleContext = {
    fix,
    format: opts.format,
    ...(opts.locked ? { locked: opts.locked } : {}),
  };
  const findings: Finding[] = [];
  let s = segments;
  const step = (r: { segments: string[]; findings: Finding[] }) => {
    findings.push(...r.findings);
    s = r.segments;
  };
  // Wikipedia never reaches the voice (feedback_primary_sources_varied); the credit goes, the fact stays.
  if (fix) s = s.map((x, i) => (opts.locked?.[i] ? x : scrubWikipedia(x)));
  step(emDashes(s, ctx));
  step(aiTells(s, ctx));
  step(filler(s, ctx));
  step(attribution(s, ctx));
  const naming = progressiveNaming(s, {
    entities: dictionary(opts.entities),
    ...(opts.games ? { games: opts.games } : {}),
    ...(opts.earlier ? { earlier: opts.earlier } : {}),
    ...(opts.locked ? { locked: opts.locked } : {}),
    fix,
  });
  s = naming.segments;
  for (let i = 0; i < naming.repeatedFull; i++)
    findings.push({ rule: "naming", text: "full title said again" });
  step(repetition(s, ctx));
  // Register last among the word rules, so a pronoun the naming rule put in ("it is") is contracted too.
  step(register(s, ctx));
  const numberCtx = {
    ...ctx,
    ...(opts.pointFigures ? { pointFigures: opts.pointFigures } : {}),
    ...(opts.exact ? { exact: opts.exact } : {}),
  };
  step(humanNumbers(s, numberCtx));
  const dates = relativeDates(s, {
    ...numberCtx,
    ...(opts.publishAt ? { publishAt: opts.publishAt } : {}),
    ...(opts.exactDates ? { exactDates: true } : {}),
  });
  step(dates);
  step(
    callbacks(s, {
      ...ctx,
      ...(opts.earlier ? { earlier: opts.earlier } : {}),
    }),
  );
  return {
    segments: s,
    findings,
    removed: dates.removed,
    ambiguous: naming.ambiguous,
  };
}

function report(findings: Finding[], segments: string[]): HumaniseReport {
  const counts = zero();
  // Numbers, dates and callbacks found are opportunities, not faults: they are counted only when fixed.
  for (const f of findings) counts[f.rule]++;
  const words = wordsOf(segments.join(" ")).length;
  const notes = [
    ...new Set(findings.filter((f) => f.note).map((f) => f.note!)),
  ];
  return { counts, findings, notes, score: humanScore(counts, words), words };
}

/**
 * Humanise a script's spoken segments, in order (pure). In check mode the segments come back unchanged; `before` and
 * `after` are the same measurement. In fix mode the safe fixes are applied and `after` measures the result.
 */
export function humaniseSegments(
  segments: string[],
  opts: HumaniseOptions,
): HumaniseResult {
  const first = pass(segments, opts, false);
  const before = report(first.findings, segments);
  if (opts.mode === "check")
    return {
      segments,
      before,
      after: before,
      removedFigures: [],
      changed: false,
    };
  const fixed = pass(segments, opts, true);
  // Measure the fixed text as it now stands (a second read, nothing changed).
  const again = pass(fixed.segments, { ...opts }, false);
  const after = report(
    again.findings.filter(
      (f) =>
        f.rule !== "numbers" && f.rule !== "dates" && f.rule !== "callback",
    ),
    fixed.segments,
  );
  const changed = fixed.segments.some((x, i) => x !== segments[i]);
  return {
    segments: fixed.segments,
    before,
    after,
    removedFigures: fixed.removed,
    changed,
  };
}

// ---------------------------------------------------------------- the fact guard

/**
 * What the humaniser changed that it mustn't (pure): any figure, name or quotation that moved, except the short forms
 * the dictionary itself introduces ("Civ" for "Civilization") and the date figures a relative date replaced on purpose.
 */
export function humaniseDrift(
  before: string,
  after: string,
  opts: { entities?: Entity[]; removedFigures?: string[] } = {},
): string[] {
  const dict = dictionary(opts.entities);
  const allowedNames = aliasWords(dict);
  // A name whose short form is still said has not gone ("Civilization 5" said as "Civ 5" throughout).
  const shortStillSaid = (n: string) =>
    dict.some(
      (e) =>
        [e.full, ...e.forms].some((f) => f.split(/\s+/).includes(n)) &&
        [e.short, e.nick].some((a) => !!a && after.includes(a.text)),
    );
  for (const w of [
    "it",
    "its",
    "yesterday",
    "today",
    "back",
    "remember",
    "wikipedia",
  ])
    allowedNames.add(w);
  const removed = new Set(opts.removedFigures ?? []);
  // Numerals compared the way they are said: "Civilization VI" and "Civ 6" carry the same figure.
  const said = (t: string) => spokenFiguresBack(speakTitles(t));
  const b = said(before);
  // What the guard already reports on the original against itself is a quirk of its tokeniser ("R18+"), not drift.
  const baseline = new Set(factDrift(b, b));
  const DAY =
    /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Remember|Back|Yesterday|Today)$/;
  return factDrift(b, said(after)).filter((p) => {
    if (baseline.has(p)) return false;
    const added = p.match(/^The rewrite adds the name (.+)\.$/)?.[1];
    if (added)
      return added
        .split(", ")
        .some((n) => !allowedNames.has(n.toLowerCase()) && !DAY.test(n));
    // Wikipedia never reaches the voice (scrubWikipedia): its name going is the point.
    const dropped = p.match(/^The rewrite drops the name (.+)\.$/)?.[1];
    if (dropped)
      return dropped.split(", ").some((n) => !/^wikipedia$/i.test(n) && !shortStillSaid(n) && !removed.has(n));
    const lost = p.match(/^The rewrite drops the figure (.+)\.$/)?.[1];
    if (lost) return lost.split(", ").some((f) => !removed.has(f));
    return true;
  });
}

// ---------------------------------------------------------------- adapters

/** A Short's spoken segments in voice order: hook, beats, take, loop line. */
export function shortSegments(
  s: Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
): string[] {
  return [
    s.hook,
    ...s.beats.map((b) => b.narration),
    s.pulse_take.narration,
    s.loop_line,
  ];
}

/** The segments put back into a Short (pure). */
export function withShortSegments<
  T extends Pick<Script, "hook" | "beats" | "pulse_take" | "loop_line">,
>(s: T, segs: string[]): T {
  const n = s.beats.length;
  return {
    ...s,
    hook: segs[0]!,
    beats: s.beats.map((b, i) => ({ ...b, narration: segs[i + 1]! })),
    pulse_take: { ...s.pulse_take, narration: segs[n + 1]! },
    loop_line: segs[n + 2]!,
  };
}

/** The figures a Short's story rests on: stamp, cards and headline. */
export function shortPointFigures(s: Script): string[] {
  return [
    s.headline,
    s.stamp?.text ?? "",
    s.stamp?.word ?? "",
    ...s.beats.flatMap((b) => [b.visual.primary, ...(b.visual.items ?? [])]),
  ]
    .flatMap((t) => t.match(/[$£€]?\d[\d,.]*%?/g) ?? [])
    .filter(Boolean);
}

const DATE_STORIES = new Set(["release_date", "delay", "countdown"]);

/** The humaniser on a Short (pure). Character-quote beats are never edited; the hook keeps its figures and dates. */
export function humaniseShort(
  s: Script,
  opts: {
    mode: Exclude<HumaniseMode, "off">;
    publishAt?: Date;
    entities?: Entity[];
  },
): { script: Script; result: HumaniseResult } {
  const segs = shortSegments(s);
  const locked = [false, ...s.beats.map((b) => !!b.quote), false, false];
  const games = [
    s.game_title,
    ...(s.entries ?? []).map((e) => e.game_title),
  ].filter(Boolean);
  const result = humaniseSegments(segs, {
    mode: opts.mode,
    format: s.runtime === "long" ? "long" : "short",
    locked,
    exact: [0],
    games,
    pointFigures: shortPointFigures(s),
    exactDates: DATE_STORIES.has(s.story_type),
    ...(opts.publishAt ? { publishAt: opts.publishAt } : {}),
    ...(opts.entities ? { entities: opts.entities } : {}),
  });
  let out = result.changed ? withShortSegments(s, result.segments) : s;
  // The stamp lands on a word the narration says: a change that loses it is undone for that line.
  if (s.stamp?.word && result.changed) {
    const word = s.stamp.word.toLowerCase();
    const has = (t: string) => t.toLowerCase().includes(word);
    const segsNow = shortSegments(out).map((t, i) =>
      has(segs[i]!) && !has(t) ? segs[i]! : t,
    );
    out = withShortSegments(out, segsNow);
  }
  return { script: out, result };
}

/** Problems with a humanised Short (pure): drift, a stamp word lost, an emptied line. */
export function humaniseShortProblems(
  before: Script,
  after: Script,
  removedFigures: string[] = [],
  entities?: Entity[],
): string[] {
  const b = shortSegments(before).join(" ");
  const a = shortSegments(after).join(" ");
  const p = humaniseDrift(b, a, {
    removedFigures,
    ...(entities ? { entities } : {}),
  });
  const was = shortSegments(before);
  if (shortSegments(after).some((t, i) => !t.trim() && !!was[i]?.trim()))
    p.push("The humaniser left a line empty.");
  if (
    before.stamp?.word &&
    !a.toLowerCase().includes(before.stamp.word.toLowerCase())
  )
    p.push(`The stamp word "${before.stamp.word}" is no longer said.`);
  before.beats.forEach((x, i) => {
    if (x.quote && after.beats[i]?.narration !== x.narration)
      p.push("A character quote's line changed.");
  });
  return p;
}

/** The humaniser on a documentary chapter (pure), with the narration already said earlier in the video. */
export function humaniseChapter<
  C extends { paragraphs: Array<{ narration: string }> },
>(
  chapter: C,
  opts: {
    mode: Exclude<HumaniseMode, "off">;
    earlier?: string;
    games?: string[];
    publishAt?: Date;
    entities?: Entity[];
  },
): { chapter: C; result: HumaniseResult } {
  const segs = chapter.paragraphs.map((p) => p.narration);
  const result = humaniseSegments(segs, {
    mode: opts.mode,
    format: "long",
    ...(opts.earlier ? { earlier: opts.earlier } : {}),
    ...(opts.games ? { games: opts.games } : {}),
    ...(opts.publishAt ? { publishAt: opts.publishAt } : {}),
    ...(opts.entities ? { entities: opts.entities } : {}),
  });
  if (!result.changed) return { chapter, result };
  return {
    chapter: {
      ...chapter,
      paragraphs: chapter.paragraphs.map((p, i) => ({
        ...p,
        narration: result.segments[i]!,
      })),
    },
    result,
  };
}

/** A compact log line for the event log and the alert digest. */
export function humaniseLog(r: HumaniseResult): Record<string, unknown> {
  const nonzero = (c: RuleCounts) =>
    Object.fromEntries(Object.entries(c).filter(([, v]) => v > 0));
  return {
    score_before: r.before.score,
    score_after: r.after.score,
    before: nonzero(r.before.counts),
    after: nonzero(r.after.counts),
    notes: r.after.notes.slice(0, 6),
    changed: r.changed,
  };
}
