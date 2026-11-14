// Breadth then selection for news hooks (LEARN_HOOKS, research item 6). Polishing one hook through serial rewrites
// flattens voice (Doshi and Hauser 2024: AI help makes outputs alike). Instead the writer's draft is followed by ONE
// call asking for 4 to 6 hooks, each from a different angle brief; each candidate is checked against the house rules
// (it may not add a problem the draft did not have, so a test arm's rule still holds), refused when it reads like any
// of the last 30 hooks (the sameness guard), scored by the packaging lab's scorer when one is plugged in (else the
// channel's own small hook model) and the best two go to the clarity judge. The winner replaces the draft's hook before
// the fact check, so a new hook is fact-checked like every other word. In shadow mode everything is written down and
// the draft's hook is kept.

import { z } from "zod";
import type { Llm } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import { rng, seedOf } from "./stats.ts";

/** The angle briefs: deliberately different ways into the same story. */
export const ANGLE_BRIEFS: Array<{ id: string; brief: string }> = [
  {
    id: "stake",
    brief:
      "Lead with what this changes for the viewer: their money, their time, their game.",
  },
  {
    id: "number",
    brief:
      "Lead with the one figure that carries the story (a price, a date, a count), the game named first.",
  },
  {
    id: "surprise",
    brief:
      "Lead with the part that cuts against what fans expected, stated plainly.",
  },
  {
    id: "question",
    brief:
      "Open one answerable question the Short then answers in its first line.",
  },
  {
    id: "person",
    brief:
      "Lead with who did or said it (a studio, a boss, a platform) and the move they made.",
  },
  {
    id: "next",
    brief:
      "Lead with what happens next and when, so the viewer knows why it matters now.",
  },
  {
    id: "contrast",
    brief:
      "Lead with a sharp before-and-after or this-versus-that the story sets up.",
  },
];

/** The briefs for one Short: a seeded choice so different Shorts try different mixes. */
export function briefsFor(
  episodeId: string,
  n: number,
): Array<{ id: string; brief: string }> {
  const r = rng(seedOf(`hooks:${episodeId}`));
  const pool = [...ANGLE_BRIEFS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(1, Math.min(n, pool.length)));
}

const LETTERS = /[^a-z0-9 ]/g;

function trigrams(s: string): Map<string, number> {
  const t = ` ${s.toLowerCase().replace(LETTERS, " ").replace(/\s+/g, " ").trim()} `;
  const m = new Map<string, number>();
  for (let i = 0; i + 3 <= t.length; i++)
    m.set(t.slice(i, i + 3), (m.get(t.slice(i, i + 3)) ?? 0) + 1);
  return m;
}

/** Character-trigram cosine similarity (0-1): how much two hooks read alike, with no model needed. */
export function similarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  let dot = 0;
  let nx = 0;
  let ny = 0;
  for (const [k, v] of x) {
    nx += v * v;
    dot += v * (y.get(k) ?? 0);
  }
  for (const v of y.values()) ny += v * v;
  return nx && ny ? dot / Math.sqrt(nx * ny) : 0;
}

/** The closest of the recent hooks, with its similarity. */
export function closest(
  hook: string,
  recent: string[],
): { hook?: string; sim: number } {
  let best: { hook?: string; sim: number } = { sim: 0 };
  for (const r of recent.slice(0, 30)) {
    const s = similarity(hook, r);
    if (s > best.sim) best = { hook: r, sim: s };
  }
  return best;
}

// ---- The channel's own small hook model (used when no packaging scorer is plugged in) --------------

const QUESTION = /\?\s*$/;
const DIGIT = /\d/;
const YOU = /\byou(r|'re|'ll)?\b/i;
const FIRST_PERSON = /\b(i|i'm|i'd|my)\b/i;

export function hookFeatures(hook: string, game?: string): number[] {
  const words = hook.trim().split(/\s+/).filter(Boolean);
  const head = words.slice(0, 5).join(" ").toLowerCase();
  const g = (game ?? "").toLowerCase().split(/\s+/)[0] ?? "";
  return [
    1,
    QUESTION.test(hook) ? 1 : 0,
    DIGIT.test(hook) ? 1 : 0,
    Math.min(words.length, 16) / 16,
    YOU.test(hook) ? 1 : 0,
    FIRST_PERSON.test(hook) ? 1 : 0,
    g && head.includes(g) ? 1 : 0,
  ];
}

/** Ridge regression (closed form, Gauss-Jordan) of the 3-second hold on hook features (pure). */
export function fitHookModel(
  rows: Array<{ hook: string; game?: string; y: number }>,
  lambda = 2,
): number[] | undefined {
  if (rows.length < 20) return undefined;
  const X = rows.map((r) => hookFeatures(r.hook, r.game));
  const k = X[0]!.length;
  const A = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k + 1 }, (_, j) =>
      j < k ? (i === j && i > 0 ? lambda : 0) : 0,
    ),
  );
  rows.forEach((r, n) => {
    const x = X[n]!;
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) A[i]![j]! += x[i]! * x[j]!;
      A[i]![k]! += x[i]! * r.y;
    }
  });
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++)
      if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const pv = A[c]![c]!;
    if (Math.abs(pv) < 1e-12) return undefined;
    for (let j = c; j <= k; j++) A[c]![j]! /= pv;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  return A.map((row) => row[k]!);
}

export const predictHook = (w: number[], hook: string, game?: string): number =>
  hookFeatures(hook, game).reduce((s, x, i) => s + x * (w[i] ?? 0), 0);

// ---- The packaging lab's scorer, when present ------------------------------------------------------

/** A hook and title scorer (claude/packaginglab's CTR scorer plugs in here): higher is better, 0-1. */
export type HookScorer = (c: {
  hook: string;
  title: string;
  game?: string;
  format: string;
}) => Promise<number | undefined>;
let scorer: { name: string; fn: HookScorer } | undefined;
export function setHookScorer(name: string, fn: HookScorer | undefined): void {
  scorer = fn ? { name, fn } : undefined;
}
export const hookScorerName = (): string | undefined => scorer?.name;
export const hookScorer = (): HookScorer | undefined => scorer?.fn;

// ---- The one call and the pick ---------------------------------------------------------------------

export const HOOKS_SITE = "hooks.breadth";

const Candidates = z.object({
  candidates: z
    .array(
      z.object({
        angle: z
          .string()
          .describe("The id of the angle brief this hook follows."),
        hook: z.string().describe("The opening line, spoken, one sentence."),
      }),
    )
    .describe("One hook per angle brief, each genuinely different."),
});

export async function writeHookCandidates(
  llm: Llm,
  o: {
    script: Pick<
      Script,
      "hook" | "beats" | "pulse_take" | "game_title" | "youtube"
    >;
    briefs: Array<{ id: string; brief: string }>;
    rules: string;
  },
): Promise<Array<{ angle: string; hook: string }>> {
  const body = [
    ...o.script.beats.map((b) => b.narration),
    o.script.pulse_take.narration,
  ].join(" ");
  const r = await llm.structured({
    site: HOOKS_SITE,
    tier: "top",
    effort: "low",
    maxTokens: 2000,
    system:
      "You write opening lines for Pulse Gaming's news Shorts: one spoken sentence that makes a gamer stay. British English, no em dashes, no clickbait, nothing the Short does not then deliver. Every hook must stay true to the script it opens: add no fact, figure or claim the script does not already make.",
    content: `The Short's script after its hook:\n${body}\n\nIts current hook: "${o.script.hook}"\nIts title: "${o.script.youtube.title}"\n\nWrite one hook for each angle brief, each a different way in:\n${o.briefs.map((b) => `- ${b.id}: ${b.brief}`).join("\n")}${o.rules ? `\n\nEvery hook must also follow these rules:\n${o.rules}` : ""}`,
    schema: Candidates,
  });
  const ids = new Set(o.briefs.map((b) => b.id));
  return r.candidates
    .filter((c) => c.hook.trim() && ids.has(c.angle))
    .slice(0, o.briefs.length);
}

export interface Candidate {
  idx: number;
  angle: string;
  hook: string;
  refused?: string;
  scores: {
    prior?: number;
    packaging?: number;
    clarity?: number;
    sameness: number;
  };
  score?: number;
}

/** The pick (pure apart from the callbacks): refuse, score, judge the best two, choose; the draft is index 0. */
export async function choose(
  draft: string,
  cands: Array<{ angle: string; hook: string }>,
  o: {
    recent: string[];
    maxSameness: number;
    problemsWith: (hook: string) => number;
    prior: (hook: string) => number | undefined;
    packaging?: (hook: string) => Promise<number | undefined>;
    clarity?: (hook: string) => Promise<number | undefined>;
  },
): Promise<{ all: Candidate[]; chosen: Candidate }> {
  const base = o.problemsWith(draft);
  const all: Candidate[] = [{ angle: "draft", hook: draft }, ...cands].map(
    (c, idx) => {
      const near = closest(c.hook, o.recent);
      const cand: Candidate = {
        idx,
        angle: c.angle,
        hook: c.hook.trim(),
        scores: { sameness: Math.round(near.sim * 100) / 100 },
      };
      if (idx > 0) {
        if (near.sim > o.maxSameness)
          cand.refused = `reads like a recent hook ("${near.hook}", ${Math.round(near.sim * 100)}% alike)`;
        else if (o.problemsWith(cand.hook) > base)
          cand.refused = "breaks a house rule the draft kept";
        else if (
          cands.slice(0, idx - 1).some((p) => similarity(p.hook, c.hook) > 0.85)
        )
          cand.refused = "a near copy of another candidate";
      }
      return cand;
    },
  );
  const live = all.filter((c) => !c.refused);
  // The prior: the packaging scorer when plugged in, else the channel's own hook model, scaled to 0-1 across the set.
  for (const c of live) {
    c.scores.packaging = o.packaging
      ? await o.packaging(c.hook).catch(() => undefined)
      : undefined;
    c.scores.prior = o.prior(c.hook);
  }
  const priors = live
    .map((c) => c.scores.packaging ?? c.scores.prior)
    .filter((x): x is number => x !== undefined);
  const lo = Math.min(...priors);
  const hi = Math.max(...priors);
  const scaled = (c: Candidate) => {
    const v = c.scores.packaging ?? c.scores.prior;
    return v === undefined ? 0.5 : hi > lo ? (v - lo) / (hi - lo) : 0.5;
  };
  const order = [...live].sort(
    (a, b) => scaled(b) - scaled(a) || a.idx - b.idx,
  );
  const finalists = o.clarity ? order.slice(0, 2) : [];
  // The draft is always judged too, so a candidate must beat it on clarity as well, never by default.
  const draftCand = all[0]!;
  if (o.clarity && !finalists.includes(draftCand)) finalists.push(draftCand);
  for (const c of finalists)
    c.scores.clarity = await o.clarity!(c.hook).catch(() => undefined);
  for (const c of live)
    c.score =
      0.5 * scaled(c) +
      0.5 * ((c.scores.clarity ?? (finalists.length ? 0 : 5)) / 10);
  const chosen =
    [...live].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0) || a.idx - b.idx,
    )[0] ?? draftCand;
  return { all, chosen };
}
