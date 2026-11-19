// The blind panel (top creator gap plan, 19 Nov 2026). The blind test on 24 stories showed what lifts quality: several
// versions, two blind critics (a tough editor and an audience stand-in), keep the best, then check the marks against
// real outcomes. The writers' room did this for the script; this is the same loop as one small reusable piece, so any
// craft can use it (the room's two reads, the first second of a Short, a long video's packaging).
//
// Input: candidates (an id and exactly what a critic may see, as text), critics (each an injected async judge that
// returns whole-number marks, an overall, a one-line biggest fault and an optional drop), a pick rule (the best mean
// overall, then named tie-breaks) and caps on calls. Output: every critic's marks for every candidate, the pick and
// why. Critics run one after another in the order given; a required critic that fails stops the panel (nothing after
// it is called) and leaves it without a pick. No pipeline imports: everything outside is injected.

/** The panel's own limits; a caller's caps can only lower them. */
export const PANEL = {
  /** Model calls one panel run makes at most, whatever the caller asks. */
  callsMax: 8,
  /** Candidates one run shows at most. */
  candidatesMax: 12,
  /** A fault line is cut to this many characters in the record. */
  faultChars: 240,
} as const;

/** One candidate: its id and exactly what a critic may see, as text (never the plan or the sources). */
export interface PanelCandidate {
  id: string;
  view: string;
}

/** One critic's read of one candidate. Marks are whole numbers (1 to 10 by convention). */
export interface PanelRead<R = unknown> {
  id: string;
  marks: Record<string, number>;
  overall: number;
  /** The single biggest fault, one line. */
  fault: string;
  /** True when this critic would not put the candidate out at all. */
  drop?: boolean;
  /** The critic's own answer for this candidate, untouched, for callers that need more than the marks. */
  raw?: R;
}

/** One critic's answer for a set of candidates. */
export interface PanelVerdict<R = unknown> {
  reads: PanelRead<R>[];
  /** The candidate(s) the critic would choose itself, when it names one ("criticPick" tie-break). */
  pick?: string | readonly string[];
  /** The critic's whole answer, untouched. */
  raw?: unknown;
}

export interface PanelCritic<R = unknown> {
  name: string;
  judge: (candidates: readonly PanelCandidate[]) => Promise<PanelVerdict<R>>;
  /** A candidate this critic did not mark cannot be picked, and its failure stops the panel. */
  required?: boolean;
}

/** The named tie-breaks, applied in order after the mean overall; the candidates' order always settles the rest. */
export type PanelTie =
  /** This candidate wins a tie (for example "the current version wins ties"). */
  | { by: "prefer"; id: string }
  /** The candidate this critic picked itself wins a tie. */
  | { by: "criticPick"; critic: string }
  /** The candidate this critic marked higher wins a tie. */
  | { by: "critic"; critic: string }
  /** The earlier candidate wins a tie. */
  | { by: "order" };

export interface PanelRule {
  name: string;
  ties: readonly PanelTie[];
}

export interface PanelCaps {
  /** Calls this run may make in all. */
  calls?: number;
  /** Calls each named critic may make in this run (0 skips it). */
  perCritic?: Record<string, number>;
  /** Candidates shown at most (the first ones are kept). */
  candidates?: number;
}

export type PanelEvent =
  | { kind: "call"; critic: string; candidates: string[] }
  | { kind: "read"; critic: string; reads: PanelMark[] }
  | { kind: "fail"; critic: string; error: string }
  | { kind: "skip"; critic: string; why: "cap" }
  | { kind: "pick"; pick?: string; why: string };

/** One mark line of the record: a critic, a candidate and what it gave. */
export interface PanelMark {
  critic: string;
  id: string;
  marks: Record<string, number>;
  overall: number;
  fault: string;
  drop?: boolean;
}

export interface PanelPick {
  pick?: string;
  why: string;
  /** Each candidate's mean overall over the critics that marked it. */
  means: Record<string, number>;
  /** Every critic in the panel read the pick and said drop. */
  drop: boolean;
}

export interface PanelResult<R = unknown> extends PanelPick {
  rule: string;
  /** The ids shown, in order. */
  candidates: string[];
  marks: PanelMark[];
  /** Each critic's answer; absent for a critic that failed or was skipped. */
  verdicts: Record<string, PanelVerdict<R> | undefined>;
  calls: number;
  callsBy: Record<string, number>;
  /** Critics whose call failed, with the error. */
  failed: Record<string, string>;
  /** Critics not called because a cap was reached. */
  skipped: string[];
}

/** The rule every panel starts from: the best mean overall, ties to the earlier candidate. */
export const BEST_MEAN: PanelRule = {
  name: "best mean overall",
  ties: [{ by: "order" }],
};

const tieName = (t: PanelTie): string =>
  t.by === "prefer"
    ? `the preferred candidate (${t.id})`
    : t.by === "criticPick"
      ? `the ${t.critic}'s own pick`
      : t.by === "critic"
        ? `the ${t.critic}'s higher mark`
        : "the earlier candidate";

const pickIds = (p: PanelVerdict["pick"]): readonly string[] =>
  p === undefined ? [] : typeof p === "string" ? [p] : p;

const firstRead = <R>(
  v: PanelVerdict<R> | undefined,
  id: string,
): PanelRead<R> | undefined => v?.reads.find((r) => r.id === id);

/**
 * The pick (pure): among the candidates every required critic marked, the best mean overall; then each named
 * tie-break in turn; then the earlier candidate. `verdicts` lists every critic in the panel, with or without an answer.
 */
export function panelPick(
  ids: readonly string[],
  verdicts: ReadonlyArray<{
    critic: string;
    required?: boolean;
    verdict?: PanelVerdict<unknown>;
  }>,
  rule: PanelRule,
): PanelPick {
  const means: Record<string, number> = {};
  const ties = [
    ...rule.ties.filter((t) => t.by !== "order"),
    { by: "order" } as PanelTie,
  ];
  const tieValue = (t: PanelTie, id: string, index: number): number => {
    if (t.by === "prefer") return id === t.id ? 1 : 0;
    if (t.by === "order") return -index;
    const v = verdicts.find((x) => x.critic === t.critic)?.verdict;
    if (t.by === "criticPick") return pickIds(v?.pick).includes(id) ? 1 : 0;
    return firstRead(v, id)?.overall ?? Number.NEGATIVE_INFINITY;
  };
  let best = -1;
  let bestKey: number[] = [];
  let second: number[] | undefined;
  ids.forEach((id, i) => {
    if (verdicts.some((v) => v.required && !firstRead(v.verdict, id))) return;
    const reads = verdicts
      .map((v) => firstRead(v.verdict, id))
      .filter((r): r is PanelRead<unknown> => !!r);
    if (!reads.length) return;
    let sum = 0;
    for (const r of reads) sum += r.overall;
    const mean = sum / reads.length;
    means[id] = mean;
    const key = [mean, ...ties.map((t) => tieValue(t, id, i))];
    if (best < 0 || compareKeys(key, bestKey) > 0) {
      if (best >= 0) second = bestKey;
      best = i;
      bestKey = key;
    } else if (!second || compareKeys(key, second) > 0) second = key;
  });
  if (best < 0)
    return {
      why: "no candidate was marked by every required critic",
      means,
      drop: false,
    };
  const pick = ids[best]!;
  const parts = verdicts
    .map((v) => {
      const r = firstRead(v.verdict, pick);
      return r ? `${v.critic} ${r.overall}` : "";
    })
    .filter(Boolean);
  let why = `${pick}: ${rule.name}, ${fmt(bestKey[0]!)} (${parts.join(", ")})`;
  if (second && second[0] === bestKey[0]) {
    const at = bestKey.findIndex((x, k) => k > 0 && x !== second![k]);
    why += at > 0 ? `; a tie broken by ${tieName(ties[at - 1]!)}` : "; a tie";
  }
  const drop =
    verdicts.length > 0 &&
    verdicts.every((v) => firstRead(v.verdict, pick)?.drop === true);
  return { pick, why, means, drop };
}

function compareKeys(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

const fmt = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0$/, "");

/** A read as a record line (pure): the raw answer left out, the fault cut to one short line. */
export function panelMark(critic: string, r: PanelRead<unknown>): PanelMark {
  return {
    critic,
    id: r.id,
    marks: { ...r.marks },
    overall: r.overall,
    fault: r.fault.replace(/\s+/g, " ").trim().slice(0, PANEL.faultChars),
    ...(r.drop !== undefined ? { drop: r.drop } : {}),
  };
}

/**
 * One panel run: each critic reads the candidates in turn (within the caps), then the pick. Never throws: a critic's
 * failure is recorded; a required critic's failure stops the run and leaves it without a pick.
 */
export async function runPanel<R = unknown>(o: {
  candidates: readonly PanelCandidate[];
  critics: ReadonlyArray<PanelCritic<R>>;
  rule?: PanelRule;
  caps?: PanelCaps;
  recorder?: (e: PanelEvent) => void;
}): Promise<PanelResult<R>> {
  const rule = o.rule ?? BEST_MEAN;
  const record = (e: PanelEvent) => {
    try {
      o.recorder?.(e);
    } catch {
      // a recorder must never break a run
    }
  };
  const callsMax = Math.min(PANEL.callsMax, o.caps?.calls ?? PANEL.callsMax);
  const shown = o.candidates.slice(
    0,
    Math.max(
      0,
      Math.min(PANEL.candidatesMax, o.caps?.candidates ?? PANEL.candidatesMax),
    ),
  );
  const ids = shown.map((c) => c.id);
  const verdicts: Record<string, PanelVerdict<R> | undefined> = {};
  const callsBy: Record<string, number> = {};
  const failed: Record<string, string> = {};
  const skipped: string[] = [];
  const marks: PanelMark[] = [];
  let calls = 0;
  let stopped = false;
  for (const c of o.critics) {
    callsBy[c.name] ??= 0;
    if (stopped) continue;
    const own = o.caps?.perCritic?.[c.name];
    if (
      !shown.length ||
      calls >= callsMax ||
      (own !== undefined && callsBy[c.name]! >= own)
    ) {
      skipped.push(c.name);
      record({ kind: "skip", critic: c.name, why: "cap" });
      if (c.required) stopped = true;
      continue;
    }
    calls++;
    callsBy[c.name]!++;
    record({ kind: "call", critic: c.name, candidates: ids });
    try {
      const v = await c.judge(shown);
      verdicts[c.name] = v;
      const lines = v.reads
        .filter((r) => ids.includes(r.id))
        .map((r) => panelMark(c.name, r));
      marks.push(...lines);
      record({ kind: "read", critic: c.name, reads: lines });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed[c.name] = error;
      record({ kind: "fail", critic: c.name, error });
      if (c.required) stopped = true;
    }
  }
  const required = o.critics.filter((c) => c.required);
  const pick: PanelPick = required.some((c) => !verdicts[c.name])
    ? { why: "a required critic gave no read", means: {}, drop: false }
    : panelPick(
        ids,
        o.critics.map((c) => ({
          critic: c.name,
          required: c.required,
          ...(verdicts[c.name] ? { verdict: verdicts[c.name] } : {}),
        })),
        rule,
      );
  record({
    kind: "pick",
    ...(pick.pick !== undefined ? { pick: pick.pick } : {}),
    why: pick.why,
  });
  return {
    ...pick,
    rule: rule.name,
    candidates: ids,
    marks,
    verdicts,
    calls,
    callsBy,
    failed,
    skipped,
  };
}

/** The critics' shared view of several candidates (pure): each candidate's text in turn, a blank line between. */
export function panelContent(candidates: readonly PanelCandidate[]): string {
  return candidates.map((c) => c.view).join("\n\n");
}

/**
 * A deterministic shuffle (pure): the same seed always gives the same order, so a blind read can mix candidates with
 * reference items without the factory's own coming first.
 */
export function seededShuffle<T>(xs: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  if (h === 0) h = 1;
  const next = () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
