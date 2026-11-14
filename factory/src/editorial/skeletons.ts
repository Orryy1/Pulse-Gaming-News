// Short structures (upgrade queue item 10, niche research changes 3 and 6, 11 Nov 2026). YouTube's test for earning
// is whether a channel "looks like it's made with a template", and reviewers sample the newest uploads: at four Shorts
// a day that sample is almost all Shorts, and the World class audit read them as one skeleton (hook, three facts,
// card, question). A news Short's structure here is four parts chosen together: how it opens, the order the body
// runs in, its length (two, three or four beats) and how it ends. The writer is given one, and no two of the newest
// SKELETON_WINDOW Shorts share the same four. Consecutive Shorts also differ in opening, order, length and ending
// where the choice allows. The take's own shape (src/editorial/phrasing.ts takeShapeFor) still varies on its own.
// The structure is stored on the script as `skeleton`, read back by recentShapes (src/pipeline.ts) and counted in
// the weekly analytics (src/analyticsloop.ts). SHORT_SKELETONS turns it on; off, nothing here runs. Pure.

import type { Script } from "./schema.ts";

/** No two of the newest this-many Shorts share a structure (the reviewers' sample, and the monthly swap test). */
export const SKELETON_WINDOW = 30;

export interface SkeletonPart {
  id: string;
  /** The owner's words for the report. */
  label: string;
  /** What the writer is told. */
  rule: string;
}

export interface OpeningPart extends SkeletonPart {
  /** The hook is a question (true), a statement (false). */
  question: boolean;
}

export interface LengthPart extends SkeletonPart {
  beats: number;
}

export interface EndingPart extends SkeletonPart {
  /** The loop line asks the viewer something. Left out while SHORT_END_PAYOFF wants a statement. */
  question: boolean;
}

export const OPENINGS: OpeningPart[] = [
  {
    id: "stake",
    label: "opens on the stake",
    question: false,
    rule: "the news with its stake for you, in one statement: what it does to your money, console, save or weekend",
  },
  {
    id: "question",
    label: "opens on a question",
    question: true,
    rule: "one answerable question that carries the news and that the take answers plainly; the hook ends with a question mark",
  },
  {
    id: "surprise",
    label: "opens on the surprise",
    question: false,
    rule: "the single most surprising concrete fact, said flat, with no build-up",
  },
  {
    id: "verdict",
    label: "opens on a verdict",
    question: false,
    rule: 'your call first, in a few words, with the news inside it ("An $80 Zelda is a bad sign for Switch 2."); the beats then earn it',
  },
  {
    id: "warning",
    label: "opens on a warning",
    question: false,
    rule: 'one warning to the viewer: what not to do yet, or what to check first ("Don\'t pre-order the PC version yet."), with the game named',
  },
  {
    id: "contrast",
    label: "opens on a contrast",
    question: false,
    rule: 'a before and after, or this against that, in one line ("Ten hours last time. Three now."), with the game named',
  },
];

/** How the body runs. "argument" is used only by the argument test's half (SHORT_ARGUMENT_SHARE). */
export const ORDERS: SkeletonPart[] = [
  {
    id: "facts_then_call",
    label: "evidence then the call",
    rule: "the beats are the evidence in the order a friend would tell it, and the take gives the call at the end",
  },
  {
    id: "call_then_proof",
    label: "the call then the proof",
    rule: "the first beat says your call plainly, the next beats are the proof for it, and the take says what would change your mind or what you would do",
  },
  {
    id: "one_detail",
    label: "one detail, deep",
    rule: "the whole Short is about one detail: each beat digs further into it (what it is, why they did it, what it changes for you), never a second unrelated fact",
  },
  {
    id: "then_and_now",
    label: "then against now",
    rule: "the beats set the past against now (the last game, the old price, the earlier promise), and the take says which way it cuts",
  },
  {
    id: "argument",
    label: "one running argument",
    rule: "one running argument, as set out in the shape rule below",
  },
];

export const LENGTHS: LengthPart[] = [
  {
    id: "brisk",
    label: "brisk",
    beats: 2,
    rule: "brisk: exactly two beats, at the low end of the word range",
  },
  {
    id: "standard",
    label: "standard",
    beats: 3,
    rule: "standard: exactly three beats, in the middle of the word range",
  },
  {
    id: "full",
    label: "full",
    beats: 4,
    rule: "full: exactly four beats, at the top of the word range, each one short",
  },
];

export const ENDINGS: EndingPart[] = [
  {
    id: "fork",
    label: "ends on a fork",
    question: true,
    rule: "a personal either/or the viewer answers about their own choice, ending with a question mark",
  },
  {
    id: "name_one",
    label: "ends on name one",
    question: true,
    rule: "ask the viewer to name one, specific enough to answer in five words, ending with a question mark",
  },
  {
    id: "callback",
    label: "ends on a callback",
    question: false,
    rule: "a statement that runs straight back into the hook, so a replay sounds like the next sentence",
  },
  {
    id: "next_date",
    label: "ends on what's next",
    question: false,
    rule: "a statement naming the next date or decision to watch and what it would mean",
  },
  {
    id: "dry_line",
    label: "ends on a dry line",
    question: false,
    rule: "a dry closing statement: the narrator's last word on it",
  },
  {
    id: "advice",
    label: "ends on advice",
    question: false,
    rule: "a statement of what you should do now (wait, buy, skip, check) and the one reason",
  },
];

export interface Skeleton {
  key: string;
  opening: OpeningPart;
  order: SkeletonPart;
  length: LengthPart;
  ending: EndingPart;
}

const SEP = ".";

export function skeletonKey(
  p: Pick<Skeleton, "opening" | "order" | "length" | "ending">,
): string {
  return [p.opening.id, p.order.id, p.length.id, p.ending.id].join(SEP);
}

/** A stored key back to its parts; undefined for a key from another version or none. */
export function parseSkeleton(
  key: string | null | undefined,
): Skeleton | undefined {
  const [o, r, l, e, extra] = (key ?? "").split(SEP);
  const opening = OPENINGS.find((x) => x.id === o);
  const order = ORDERS.find((x) => x.id === r);
  const length = LENGTHS.find((x) => x.id === l);
  const ending = ENDINGS.find((x) => x.id === e);
  if (!opening || !order || !length || !ending || extra !== undefined)
    return undefined;
  return { key: key!, opening, order, length, ending };
}

export interface SkeletonOptions {
  /** False while SHORT_END_PAYOFF wants the last line to be a statement. */
  questionEndings: boolean;
  /** This Short is in the argument test's half: its body is the running argument. */
  argument: boolean;
  /** Only these orders (an official drop's one reframing idea, src/editorial/dropangle.ts). */
  orders?: string[];
  /** Only these openings (the hook-style test's variant or its winner, src/growth.ts). */
  openings?: string[];
}

/**
 * The openings the hook-style test allows (src/growth.ts "hook_style"): its running variant for this Short, else
 * the variant that won it; undefined when it has neither, so every opening is open. A is the question gap, B a stated
 * stake (any statement opening).
 */
export function hookStyleOpenings(
  current: { key: string; variant: string } | undefined,
  defaults: Array<{ test: { key: string }; variant: string }>,
): string[] | undefined {
  const variant =
    current?.key === "hook_style"
      ? current.variant
      : defaults.find((d) => d.test.key === "hook_style")?.variant;
  if (!variant) return undefined;
  return OPENINGS.filter((o) => o.question === (variant === "A")).map(
    (o) => o.id,
  );
}

/** Every structure the options allow, in a fixed order. */
export function allSkeletons(opts: SkeletonOptions): Skeleton[] {
  const orders = ORDERS.filter((o) =>
    opts.argument
      ? o.id === "argument"
      : o.id !== "argument" && (!opts.orders || opts.orders.includes(o.id)),
  );
  const endings = ENDINGS.filter((e) => opts.questionEndings || !e.question);
  const openings = OPENINGS.filter(
    (o) => !opts.openings || opts.openings.includes(o.id),
  );
  const out: Skeleton[] = [];
  for (const opening of openings)
    for (const order of orders)
      for (const length of LENGTHS)
        for (const ending of endings) {
          const p = { opening, order, length, ending };
          out.push({ key: skeletonKey(p), ...p });
        }
  return out;
}

function hash(seed: string): number {
  let h = 0;
  for (const c of `skeleton:${seed}`) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  return h;
}

/**
 * This Short's structure. `recent` holds the newest Shorts' stored keys, newest first ("" for a Short without one);
 * only the first SKELETON_WINDOW count. A structure one of them used is never chosen while another is free. Then,
 * each only while something is left: an opening unlike the last two, and an order, a length and an ending unlike
 * the last one. Among what remains, the seed (the story's hash) decides, so the same story gets the same answer.
 */
export function pickSkeleton(
  seed: string,
  recent: string[],
  opts: SkeletonOptions,
): Skeleton {
  const all = allSkeletons(opts);
  const window = recent.slice(0, SKELETON_WINDOW);
  const used = new Set(window);
  const last = window.slice(0, 2).map(parseSkeleton);
  let pool = all.filter((s) => !used.has(s.key));
  // Every allowed structure ran inside the window (the options left only a few): the one used longest ago.
  if (!pool.length) {
    const age = (s: Skeleton) => window.indexOf(s.key);
    const oldest = Math.max(...all.map(age));
    pool = all.filter((s) => age(s) === oldest);
  }
  const narrow = (keep: (s: Skeleton) => boolean) => {
    const next = pool.filter(keep);
    if (next.length) pool = next;
  };
  const openings = last.flatMap((x) => (x ? [x.opening.id] : []));
  narrow((s) => !openings.includes(s.opening.id));
  const prev = last[0];
  if (prev) {
    narrow((s) => s.order.id !== prev.order.id);
    narrow((s) => s.length.id !== prev.length.id);
    narrow((s) => s.ending.id !== prev.ending.id);
  }
  return pool[hash(seed) % pool.length]!;
}

/** What the writer reads: the structure, part by part. */
export function skeletonRule(s: Skeleton): string {
  return `This Short's structure (it replaces the general hook, beat and loop-line shapes above where they differ; recent Shorts used other structures, so keep to this one):
- opening (hook): ${s.opening.rule}.
- order: ${s.order.rule}.
- length: ${s.length.rule}.
- ending (loop_line): ${s.ending.rule}.`;
}

const ASKS = /\?["”']?\s*$/;

/** Where a draft departs from its structure, in the parts a check can read. */
export function skeletonProblems(
  script: Pick<Script, "hook" | "beats" | "loop_line">,
  s: Skeleton,
): string[] {
  const out: string[] = [];
  if (script.beats.length !== s.length.beats)
    out.push(
      `This Short's structure is ${s.length.label}: exactly ${s.length.beats} beats, not ${script.beats.length}.`,
    );
  const hookAsks = ASKS.test(script.hook.trim());
  if (s.opening.question && !hookAsks)
    out.push(
      `This Short's structure opens on a question: the hook must be one answerable question ending with "?".`,
    );
  if (!s.opening.question && hookAsks)
    out.push(
      `This Short's structure ${s.opening.label}, not a question: make the hook a statement.`,
    );
  const loopAsks = ASKS.test(script.loop_line.trim());
  if (s.ending.question && !loopAsks)
    out.push(
      `This Short's structure ${s.ending.label}: the loop line must ask the viewer, ending with "?".`,
    );
  if (!s.ending.question && loopAsks)
    out.push(
      `This Short's structure ${s.ending.label}: the loop line is a statement, not a question.`,
    );
  return out;
}

/** The owner's words for a stored key. */
export function skeletonLabel(key: string): string {
  const s = parseSkeleton(key);
  return s
    ? `${s.opening.label}, ${s.order.label}, ${s.length.label}, ${s.ending.label}`
    : key;
}

export interface StructureCounts {
  /** Shorts looked at. */
  shorts: number;
  /** Of them, written to a structure. */
  structured: number;
  distinct: number;
  /** Each structure and how often it ran, most first. */
  runs: Array<{ key: string; n: number }>;
  openings: Record<string, number>;
  endings: Record<string, number>;
  /** Pairs among the newest SKELETON_WINDOW Shorts that share a structure (the swap test's target is zero). */
  sharedPairs: number;
}

/** How often each structure ran. `keys` are the Shorts' stored keys, newest first (empty for none). */
export function structureCounts(
  keys: Array<string | null | undefined>,
): StructureCounts {
  const parsed = keys.map(parseSkeleton);
  const runs = new Map<string, number>();
  const openings: Record<string, number> = {};
  const endings: Record<string, number> = {};
  for (const s of parsed) {
    if (!s) continue;
    runs.set(s.key, (runs.get(s.key) ?? 0) + 1);
    openings[s.opening.id] = (openings[s.opening.id] ?? 0) + 1;
    endings[s.ending.id] = (endings[s.ending.id] ?? 0) + 1;
  }
  const inWindow = new Map<string, number>();
  for (const s of parsed.slice(0, SKELETON_WINDOW))
    if (s) inWindow.set(s.key, (inWindow.get(s.key) ?? 0) + 1);
  let sharedPairs = 0;
  for (const n of inWindow.values()) sharedPairs += (n * (n - 1)) / 2;
  return {
    shorts: keys.length,
    structured: parsed.filter(Boolean).length,
    distinct: runs.size,
    runs: [...runs]
      .map(([key, n]) => ({ key, n }))
      .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)),
    openings,
    endings,
    sharedPairs,
  };
}

const tally = (counts: Record<string, number>, parts: SkeletonPart[]) =>
  parts
    .filter((p) => counts[p.id])
    .map((p) => `${p.label.replace(/^(opens|ends) on /, "")} ${counts[p.id]}`)
    .join(", ");

/** The weekly report's line; undefined when no Short in the period had a structure. */
export function structureLine(
  keys: Array<string | null | undefined>,
): string | undefined {
  const c = structureCounts(keys);
  if (!c.structured) return undefined;
  const repeats = c.runs.filter((r) => r.n > 1);
  return `Short structures (SHORT_SKELETONS): ${c.structured} of ${c.shorts} Shorts were written to one, ${c.distinct} different. ${
    repeats.length
      ? `Ran more than once: ${repeats
          .slice(0, 3)
          .map((r) => `"${skeletonLabel(r.key)}" ${r.n} times`)
          .join("; ")}.`
      : "None ran twice."
  } Openings: ${tally(c.openings, OPENINGS)}. Endings: ${tally(c.endings, ENDINGS)}. Pairs among the newest ${SKELETON_WINDOW} sharing one: ${c.sharedPairs} (target 0).`;
}
