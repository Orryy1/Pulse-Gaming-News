// Subscribers per 1,000 views by series (format redesign plan, section 6 and items 1, 9 and 11). The weekly analytics
// loop (src/analyticsloop.ts) calls seriesReadings on its YouTube rows and writes the result to latest.md and to
// latest.json under `series`, so the judging reports of 5 and 12 Dec read the same numbers (readSeriesResults).
//
// Only Shorts at least 72 hours old count. Each series is summed over its Shorts (subscribers gained over views), the
// control arm is split into GTA news and the rest so The GTA File is not flattered by the launch, and a series where one
// Short holds over half the subscribers is flagged. The verdicts follow the plan's rules: scale, keep or kill, and
// never a verdict under the minimum views.

import fs from "node:fs";
import path from "node:path";
import {
  GROUP_NAMES,
  GROUP_ORDER,
  seriesGroup,
  type SeriesGroup,
  type SeriesTag,
} from "./series.ts";

const H = 3_600_000;
/** Shorts younger than this are left out (plan, section 6). */
export const SERIES_MIN_AGE_HOURS = 72;
/** The channel's usual percentage viewed (plan, section 6): a series more than 10 points under it is killed. */
export const CHANNEL_VIEWED_PCT = 54;
export const VIEWED_KILL_POINTS = 10;

/** A YouTube Short as the reading needs it: the loop's row joined with what the factory knows. */
export interface SeriesRow {
  episode_id: string;
  posted_at: string;
  views: number | null;
  subs?: number;
  viewed_pct?: number;
  title: string;
  game: string;
  series?: SeriesTag;
  next_line?: { arm: "line" | "none"; said: boolean };
}

export interface SeriesReading {
  group: SeriesGroup;
  name: string;
  shorts: number;
  views: number;
  subs: number;
  /** Subscribers per 1,000 views; undefined with no views. */
  rate?: number;
  /** Views-weighted percentage viewed, where read. */
  viewed_pct?: number;
  /** The Short with the most subscribers, and its share of the group's subscribers. */
  top?: { episode_id: string; title: string; subs: number; share: number };
  /** One Short holds over half the subscribers: the plan says wait a week rather than decide on it. */
  single_breakout: boolean;
}

const age = (r: SeriesRow, now: Date) =>
  (now.getTime() - Date.parse(r.posted_at)) / H;

/** The rows a reading counts: Shorts 72 hours or older with a views and a subscriber reading. */
export function readableRows(rows: SeriesRow[], now: Date): SeriesRow[] {
  return rows.filter(
    (r) =>
      age(r, now) >= SERIES_MIN_AGE_HOURS &&
      r.views !== null &&
      r.subs !== undefined,
  );
}

function sum(group: SeriesGroup, xs: SeriesRow[]): SeriesReading {
  const views = xs.reduce((a, r) => a + (r.views ?? 0), 0);
  const subs = xs.reduce((a, r) => a + (r.subs ?? 0), 0);
  const watched = xs.filter(
    (r) => r.viewed_pct !== undefined && (r.views ?? 0) > 0,
  );
  const wv = watched.reduce((a, r) => a + r.views!, 0);
  const best = [...xs].sort((a, b) => (b.subs ?? 0) - (a.subs ?? 0))[0];
  const share = best && subs > 0 ? (best.subs ?? 0) / subs : 0;
  return {
    group,
    name: GROUP_NAMES[group],
    shorts: xs.length,
    views,
    subs,
    rate: views > 0 ? (1000 * subs) / views : undefined,
    viewed_pct:
      wv > 0
        ? watched.reduce((a, r) => a + r.viewed_pct! * r.views!, 0) / wv
        : undefined,
    top:
      best && (best.subs ?? 0) > 0
        ? {
            episode_id: best.episode_id,
            title: best.title,
            subs: best.subs ?? 0,
            share,
          }
        : undefined,
    // One subscriber alone is not a breakout: at least 3 in the group before the warning means anything.
    single_breakout: subs >= 3 && share > 0.5,
  };
}

/** Each group's reading, in the plan's order; groups with no Shorts are left out. */
export function seriesReadings(rows: SeriesRow[], now: Date): SeriesReading[] {
  const xs = readableRows(rows, now);
  const by = new Map<SeriesGroup, SeriesRow[]>();
  for (const r of xs) {
    const g = seriesGroup(r.series, r.game, r.title);
    by.set(g, [...(by.get(g) ?? []), r]);
  }
  return GROUP_ORDER.filter((g) => by.has(g)).map((g) => sum(g, by.get(g)!));
}

// ------------------------------------------------------------------ the next-part line test (plan item 9)

export const NEXT_LINE_MIN_VIEWS = 4000;
/** The line arm must beat the no-line arm by this much on subscribers per 1,000. */
export const NEXT_LINE_LIFT = 1.5;
/** ...with the percentage viewed no more than this many points lower. */
export const NEXT_LINE_VIEWED_POINTS = 3;

export interface NextLineReading {
  line: SeriesReading;
  none: SeriesReading;
  verdict: "pass" | "fail" | "too few";
  why: string;
}

/**
 * The next-part line test, both series pooled: Shorts that said the line against Shorts on no-line days. A line-day
 * Short with no planned part said nothing and is in neither arm.
 */
export function nextLineReading(rows: SeriesRow[], now: Date): NextLineReading {
  const xs = readableRows(rows, now).filter(
    (r) => (r.series === "why" || r.series === "gta_file") && r.next_line,
  );
  const line = sum(
    "other",
    xs.filter((r) => r.next_line!.arm === "line" && r.next_line!.said),
  );
  const none = sum(
    "other",
    xs.filter((r) => r.next_line!.arm === "none"),
  );
  line.name = "Next-part line";
  none.name = "No line";
  if (line.views < NEXT_LINE_MIN_VIEWS || none.views < NEXT_LINE_MIN_VIEWS)
    return {
      line,
      none,
      verdict: "too few",
      why: `each arm needs ${NEXT_LINE_MIN_VIEWS.toLocaleString("en-US")} views (line ${line.views.toLocaleString("en-US")}, no line ${none.views.toLocaleString("en-US")})`,
    };
  const lr = line.rate ?? 0;
  const nr = none.rate ?? 0;
  const viewedDrop =
    line.viewed_pct !== undefined && none.viewed_pct !== undefined
      ? none.viewed_pct - line.viewed_pct
      : 0;
  const beats = nr > 0 ? lr >= NEXT_LINE_LIFT * nr : lr > 0;
  if (beats && viewedDrop <= NEXT_LINE_VIEWED_POINTS)
    return {
      line,
      none,
      verdict: "pass",
      why: `${lr.toFixed(2)} against ${nr.toFixed(2)} per 1,000, viewed ${viewedDrop > 0 ? `${viewedDrop.toFixed(1)} points lower` : "no lower"}`,
    };
  return {
    line,
    none,
    verdict: "fail",
    why: !beats
      ? `${lr.toFixed(2)} against ${nr.toFixed(2)} per 1,000, under the 50% lift`
      : `viewed ${viewedDrop.toFixed(1)} points lower, over the ${NEXT_LINE_VIEWED_POINTS}`,
  };
}

// ------------------------------------------------------------------ the judging (plan item 11)

export type SeriesDecision = "scale" | "keep" | "kill";

/** The plan's pass marks (section 6). */
export const PASS_MARKS: Partial<
  Record<
    SeriesGroup,
    { minViews: number; rate: number; minSubs: number; vsControl: number }
  >
> = {
  why: { minViews: 5000, rate: 1.0, minSubs: 5, vsControl: 2 },
  gta_file: { minViews: 5000, rate: 1.0, minSubs: 5, vsControl: 2 },
  verdict: { minViews: 2500, rate: 1.0, minSubs: 3, vsControl: 0 },
};

export interface SeriesVerdict {
  group: SeriesGroup;
  name: string;
  /** "pass" meets the pass mark; the scale decision also needs the second reading to hold (judgeSeries' caller). */
  mark: "pass" | "between" | "under minimum" | "at or below control";
  decision: SeriesDecision;
  why: string;
}

/**
 * One series against its pass mark and the control. Pass: the rate, the subscribers and (for The Why and The GTA File)
 * double the control. Kill: at or below the control after double the minimum views, or viewed more than 10 points under
 * the channel's 54%. Anything else, or under the minimum views, keeps running. A single breakout never decides: it
 * keeps the series running a week. The GTA File is held to GTA news as well as to all news.
 * `passedBefore`: the series passed at the last judging, so a second pass scales it.
 */
export function judgeSeries(
  readings: SeriesReading[],
  group: "why" | "gta_file" | "verdict",
  passedBefore = false,
): SeriesVerdict | undefined {
  const r = readings.find((x) => x.group === group);
  const mark = PASS_MARKS[group]!;
  const name = GROUP_NAMES[group];
  if (!r) return undefined;
  const control = [
    readings.find((x) => x.group === "news_control"),
    ...(group === "gta_file"
      ? [readings.find((x) => x.group === "gta_news")]
      : []),
  ].filter((x): x is SeriesReading => !!x && x.rate !== undefined);
  const rate = r.rate ?? 0;
  const bar = control.length ? Math.max(...control.map((c) => c.rate!)) : 0;
  const ctl =
    control.map((c) => `${c.name} ${c.rate!.toFixed(2)}`).join(", ") ||
    "no control reading";
  const numbers = `${rate.toFixed(2)} per 1,000 on ${r.views.toLocaleString("en-US")} views, ${r.subs} subscribers (${ctl})`;
  if (
    r.viewed_pct !== undefined &&
    r.viewed_pct < CHANNEL_VIEWED_PCT - VIEWED_KILL_POINTS
  )
    return {
      group,
      name,
      mark: "between",
      decision: "kill",
      why: `viewed ${Math.round(r.viewed_pct)}%, more than ${VIEWED_KILL_POINTS} points under the channel's ${CHANNEL_VIEWED_PCT}%. ${numbers}`,
    };
  if (r.views < mark.minViews)
    return {
      group,
      name,
      mark: "under minimum",
      decision: "keep",
      why: `under the ${mark.minViews.toLocaleString("en-US")} views needed to judge; run on. ${numbers}`,
    };
  if (control.length && rate <= bar && r.views >= 2 * mark.minViews)
    return {
      group,
      name,
      mark: "at or below control",
      decision: "kill",
      why: `at or below the control after double the minimum views. ${numbers}`,
    };
  const passes =
    rate >= mark.rate &&
    r.subs >= mark.minSubs &&
    (mark.vsControl === 0 ||
      !control.length ||
      control.every((c) => rate >= mark.vsControl * c.rate!));
  if (passes && r.single_breakout)
    return {
      group,
      name,
      mark: "pass",
      decision: "keep",
      why: `passes, but one Short holds ${Math.round((r.top?.share ?? 0) * 100)}% of the subscribers; wait a week. ${numbers}`,
    };
  if (passes)
    return {
      group,
      name,
      mark: "pass",
      decision: passedBefore ? "scale" : "keep",
      why: `${passedBefore ? "passes again: scale it" : "passes; scale if it holds at the next reading"}. ${numbers}`,
    };
  return {
    group,
    name,
    mark: "between",
    decision: "keep",
    why: `between the control and the pass mark; run on. ${numbers}`,
  };
}

/** What latest.json carries for the judging reports. */
export interface SeriesJson {
  readings: SeriesReading[];
  next_line: NextLineReading;
  verdicts: SeriesVerdict[];
}

export function seriesJson(rows: SeriesRow[], now: Date): SeriesJson {
  const readings = seriesReadings(rows, now);
  return {
    readings,
    next_line: nextLineReading(rows, now),
    verdicts: (["why", "gta_file", "verdict"] as const)
      .map((g) => judgeSeries(readings, g))
      .filter((v): v is SeriesVerdict => !!v),
  };
}

/** The series results of the latest weekly report (data/reports/analytics/latest.json), for the judging reports. */
export function readSeriesResults(dir: string): SeriesJson | undefined {
  try {
    const j = JSON.parse(
      fs.readFileSync(path.join(dir, "latest.json"), "utf8"),
    );
    return j?.series ?? undefined;
  } catch {
    return undefined;
  }
}

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");

/** The report's lines: a table by series, the breakout warnings, the line test and the verdicts so far. */
export function seriesLines(s: SeriesJson): string[] {
  if (!s.readings.length)
    return ["No YouTube Short 72 hours or older has a subscriber reading yet."];
  const L = [
    "| Series | Shorts | Views | Subscribers | Per 1,000 | Viewed |",
    "| --- | --- | --- | --- | --- | --- |",
    ...s.readings.map(
      (r) =>
        `| ${r.name} | ${r.shorts} | ${n0(r.views)} | ${r.subs} | ${r.rate === undefined ? "-" : r.rate.toFixed(2)} | ${r.viewed_pct === undefined ? "-" : `${Math.round(r.viewed_pct)}%`} |`,
    ),
    "",
  ];
  for (const r of s.readings.filter((x) => x.single_breakout && x.top))
    L.push(
      `${r.name}: one Short holds ${Math.round(r.top!.share * 100)}% of its subscribers ("${r.top!.title.replace(/\|/g, "/").slice(0, 70)}", ${r.top!.subs}). A single breakout must not decide.`,
    );
  const nl = s.next_line;
  if (nl.line.shorts || nl.none.shorts)
    L.push(
      `Next-part line test (The Why and The GTA File pooled): line ${nl.line.shorts} Shorts, ${nl.line.rate === undefined ? "-" : nl.line.rate.toFixed(2)} per 1,000; no line ${nl.none.shorts} Shorts, ${nl.none.rate === undefined ? "-" : nl.none.rate.toFixed(2)} per 1,000. Reading: ${nl.verdict} (${nl.why}).`,
    );
  for (const v of s.verdicts)
    L.push(`${v.name}: ${v.decision} if judged today (${v.why}).`);
  return L;
}
