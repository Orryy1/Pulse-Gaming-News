// The running season tally (PULSE_LAB_TALLY; research 14 Nov section E: a visible count makes a series feel
// collectible and gives a late arrival a reason to binge). Every series Short carries one line in a small chip:
//   Receipts      "Receipts: 14 graded"            (and "9 true, 3 false, 2 partly" under it)
//   myths         "Myths: 9 proved, 6 busted"      (a myth-kind stream ask the footage settled)
//   I measured it "Lab: 7 measured"
//   You asked     "You asked: 5 tested"
//   6 vs 5        "GTA 6 vs 5: 4 tests"
//   GTA 6 Day N   "Day 12"                          (the day's own number: nothing to count)
//   The Why       "The Why: 24 answered"
//   The GTA File  "GTA File: 7 opened"
//   Buy, Wait or Skip "Verdicts: 5 buy, 3 wait, 2 skip"
// The control arm (news_control) never gets one: it is the unchanged format on purpose.
//
// Counting lives in the database (lab_tally, migrations/007_pulselab.sql): one row per counted Short, claimed when it
// is rendered (so the Short shows itself in the count) and keyed by episode, so a retried render never counts twice and
// a restart loses nothing. A Short rejected or failed drops out of the count by itself.

import type { Db } from "../db.ts";

export const TALLY_SERIES = [
  "receipts",
  "myths",
  "measured",
  "asked",
  "versus",
  "why",
  "gta_file",
  "verdict",
] as const;
export type TallySeries = (typeof TALLY_SERIES)[number];

export type TallyOutcome =
  | "TRUE"
  | "FALSE"
  | "PARTLY"
  | "proved"
  | "busted"
  | "buy"
  | "wait"
  | "skip"
  | "counted";

export type TallyCounts = Partial<Record<TallyOutcome, number>> & {
  total: number;
};

export interface TallyLine {
  /** The chip's words: "Receipts: 14 graded". */
  line: string;
  /** A smaller second line when there is a breakdown worth reading. */
  sub?: string;
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The chip's words for a series' counts (pure). Undefined when there is nothing to show yet. */
export function tallyLine(
  series: TallySeries,
  c: TallyCounts,
): TallyLine | undefined {
  if (!c.total) return undefined;
  const n = (k: TallyOutcome) => c[k] ?? 0;
  switch (series) {
    case "receipts": {
      const parts = [
        n("TRUE") ? `${n("TRUE")} true` : "",
        n("FALSE") ? `${n("FALSE")} false` : "",
        n("PARTLY") ? `${n("PARTLY")} partly` : "",
      ].filter(Boolean);
      return {
        line: `Receipts: ${c.total} graded`,
        ...(parts.length > 1 ? { sub: parts.join(", ") } : {}),
      };
    }
    case "myths":
      return { line: `Myths: ${n("proved")} proved, ${n("busted")} busted` };
    case "measured":
      return { line: `Lab: ${c.total} measured` };
    case "asked":
      return { line: `You asked: ${c.total} tested` };
    case "versus":
      return { line: `GTA 6 vs 5: ${plural(c.total, "test")}` };
    case "why":
      return { line: `The Why: ${c.total} answered` };
    case "gta_file":
      return { line: `GTA File: ${c.total} opened` };
    case "verdict":
      return {
        line: `Verdicts: ${n("buy")} buy, ${n("wait")} wait, ${n("skip")} skip`,
      };
  }
}

/** GTA 6 Day N's tally is its own day (pure). */
export const dayTally = (day: number): TallyLine => ({ line: `Day ${day}` });

/** Rows into counts (pure). */
export function countsOf(rows: Array<{ outcome: string }>): TallyCounts {
  const c: TallyCounts = { total: 0 };
  for (const r of rows) {
    c.total++;
    const k = r.outcome as TallyOutcome;
    c[k] = (c[k] ?? 0) + 1;
  }
  return c;
}

/**
 * Counts this Short towards its series (idempotent): a retried step updates the outcome, never adds a row. Returns the
 * tally as this Short shows it: every live Short of the series counted up to and including this one.
 */
export async function claimTally(
  db: Db,
  series: TallySeries,
  season: string,
  episodeId: string,
  outcome: TallyOutcome,
): Promise<TallyCounts> {
  await db.query(
    `INSERT INTO lab_tally (series, season, episode_id, outcome) VALUES ($1, $2, $3, $4)
     ON CONFLICT (series, season, episode_id) DO UPDATE SET outcome = EXCLUDED.outcome`,
    [series, season, episodeId, outcome],
  );
  return tallyAsOf(db, series, season, episodeId);
}

/** The tally as a given Short shows it: live rows created no later than its own (a later Short never leaks back). */
export async function tallyAsOf(
  db: Db,
  series: TallySeries,
  season: string,
  episodeId: string,
): Promise<TallyCounts> {
  const rows = await db.query<{ outcome: string }>(
    `SELECT t.outcome FROM lab_tally t
      WHERE t.series = $1 AND t.season = $2
        AND t.created_at <= COALESCE((SELECT created_at FROM lab_tally WHERE series = $1 AND season = $2 AND episode_id = $3), now())
        AND (t.episode_id = $3 OR NOT EXISTS (
              SELECT 1 FROM episodes e WHERE e.id = t.episode_id AND e.status IN ('rejected','failed')))`,
    [series, season, episodeId],
  );
  return countsOf(rows);
}

/** The whole season's tally, for the reports. */
export async function seasonTally(
  db: Db,
  series: TallySeries,
  season: string,
): Promise<TallyCounts> {
  const rows = await db.query<{ outcome: string }>(
    `SELECT t.outcome FROM lab_tally t WHERE t.series = $1 AND t.season = $2
        AND NOT EXISTS (SELECT 1 FROM episodes e WHERE e.id = t.episode_id AND e.status IN ('rejected','failed'))`,
    [series, season],
  );
  return countsOf(rows);
}

/** What a series Short adds to its tally (pure), from its series tag and what it found. Undefined: nothing to count. */
export function tallyEntryFor(o: {
  series?: string;
  verdictWord?: string;
}): { series: TallySeries; outcome: TallyOutcome } | undefined {
  if (o.series === "why") return { series: "why", outcome: "counted" };
  if (o.series === "gta_file")
    return { series: "gta_file", outcome: "counted" };
  if (o.series === "verdict") {
    const w = (o.verdictWord ?? "").toLowerCase();
    const outcome: TallyOutcome = /\bbuy\b/.test(w)
      ? "buy"
      : /\bwait\b/.test(w)
        ? "wait"
        : /\bskip\b/.test(w)
          ? "skip"
          : "counted";
    return { series: "verdict", outcome };
  }
  return undefined;
}
