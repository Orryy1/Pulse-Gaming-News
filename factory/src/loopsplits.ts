// Per-arm readings for the weekly analytics loop (src/analyticsloop.ts), from the 19 Nov 2026 audit. Each groups
// YouTube Shorts 72 hours or older by a value recorded on the episode (the Why length test's arm, and later the writer
// and the narrator) and gives each group its median 72-hour views and subscribers per 1,000 views. Medians, not
// breakout counts: a handful of breakouts in a few dozen Shorts is noise, a middle value is not.

/** One YouTube Short as a reading needs it. */
export interface SplitRow {
  episode_id: string;
  posted_at: string;
  views: number | null;
  views_72h?: number;
  subs?: number;
}

export interface SplitGroup {
  group: string;
  shorts: number;
  /** Median views at 72 hours (the latest reading when no 72-hour one was kept). */
  median: number;
  views: number;
  subs: number;
  /** Subscribers per 1,000 views; undefined with no views or no subscriber readings. */
  per_1000?: number;
}

const H = 3_600_000;
/** Shorts younger than this are left out, as everywhere in the loop. */
export const SPLIT_MIN_AGE_HOURS = 72;
/** A group comparison needs at least this many Shorts a side before it is judged. */
export const SPLIT_MIN_SIDE = 15;

export const medianOf = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

/** The groups, largest first; rows with no group (undefined) and Shorts under 72 hours are left out (pure). */
export function splitReading(
  rows: SplitRow[],
  groupOf: (r: SplitRow) => string | undefined,
  now: Date,
): SplitGroup[] {
  const by = new Map<string, SplitRow[]>();
  for (const r of rows) {
    if (r.views === null) continue;
    if ((now.getTime() - Date.parse(r.posted_at)) / H < SPLIT_MIN_AGE_HOURS)
      continue;
    const g = groupOf(r);
    if (!g) continue;
    by.set(g, [...(by.get(g) ?? []), r]);
  }
  return [...by.entries()]
    .map(([group, xs]) => {
      const withSubs = xs.filter((r) => r.subs !== undefined);
      const subViews = withSubs.reduce((a, r) => a + (r.views ?? 0), 0);
      const subs = withSubs.reduce((a, r) => a + (r.subs ?? 0), 0);
      return {
        group,
        shorts: xs.length,
        median: medianOf(xs.map((r) => r.views_72h ?? r.views!)),
        views: xs.reduce((a, r) => a + (r.views ?? 0), 0),
        subs,
        ...(subViews > 0 ? { per_1000: (1000 * subs) / subViews } : {}),
      };
    })
    .sort((a, b) => b.shorts - a.shorts || a.group.localeCompare(b.group));
}

/** One table line per group. */
export function splitLines(groups: SplitGroup[]): string[] {
  return groups.map(
    (g) =>
      `${g.group}: ${g.shorts} Shorts, median ${Math.round(g.median).toLocaleString("en-US")} views at 72 h, ${g.per_1000 === undefined ? "no subscriber reading" : `${g.per_1000.toFixed(2)} subscribers per 1,000`}.`,
  );
}

// ---- The Why length test (WHY_LENGTH_AB) -------------------------------------------------------------------------

/** The short arm passes at this many times the long arm's median views... */
export const LENGTH_AB_VIEWS_LIFT = 1.5;
/** ...with subscribers per 1,000 no more than this far below the long arm's. */
export const LENGTH_AB_SUBS_SLACK = 0.2;

export interface LengthAbReading {
  short?: SplitGroup;
  long?: SplitGroup;
  verdict: "keep short" | "keep long" | "too few";
  why: string;
}

/** The Why length test's reading (audit upgrade 1's pass mark), both series pooled (pure). */
export function lengthAbReading(groups: SplitGroup[]): LengthAbReading {
  const short = groups.find((g) => g.group === "short");
  const long = groups.find((g) => g.group === "long");
  const base = { ...(short ? { short } : {}), ...(long ? { long } : {}) };
  if (!short || !long || Math.min(short.shorts, long.shorts) < SPLIT_MIN_SIDE)
    return {
      ...base,
      verdict: "too few",
      why: `${short?.shorts ?? 0} short-arm and ${long?.shorts ?? 0} long-arm Shorts; ${SPLIT_MIN_SIDE} a side needed`,
    };
  const lift =
    long.median > 0
      ? short.median / long.median
      : short.median > 0
        ? Infinity
        : 1;
  const subsOk =
    short.per_1000 === undefined ||
    long.per_1000 === undefined ||
    short.per_1000 >= long.per_1000 - LENGTH_AB_SUBS_SLACK;
  const keep = lift >= LENGTH_AB_VIEWS_LIFT && subsOk;
  return {
    ...base,
    verdict: keep ? "keep short" : "keep long",
    why: `short median ${Math.round(short.median)} against ${Math.round(long.median)} (${Number.isFinite(lift) ? lift.toFixed(2) : "inf"}x, pass at ${LENGTH_AB_VIEWS_LIFT}x); subscribers per 1,000 ${short.per_1000?.toFixed(2) ?? "-"} against ${long.per_1000?.toFixed(2) ?? "-"} (no more than ${LENGTH_AB_SUBS_SLACK} lower)`,
  };
}
