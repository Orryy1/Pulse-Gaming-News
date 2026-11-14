// The week's story (pure): which moments make the cut and how they group into chapters. The video runs in a fixed
// order a returning viewer learns: what was tested, the myths checked, the hidden details found, the funniest
// moments, then the best of the rest as the finale. Inside a chapter the moments run in the order they happened,
// Day 1 to Day 7, so the week reads as a week. A chapter needs two moments or its moments join the finale; every
// stream of the week is represented before any one stream gets a third moment; and the cut is filled to the target
// length from the best moments down, never past the maximum.

import type { MomentKind, WeekMoment } from "./moments.ts";
import { dayNumber } from "../gtadaily.ts";
import { addDays } from "../lanes.ts";

export const CHAPTER_ORDER: MomentKind[] = [
  "test",
  "myth",
  "challenge",
  "hidden",
  "funny",
  "action",
];

/** The short name fans search for: "GTA 6", "GTA 5"; other games as they are. */
export function shortGameName(game: string): string {
  const m =
    game.match(/^grand theft auto\s+(vi|v|iv|iii)\b/i) ??
    game.match(/^gta\s*(vi|v|iv|iii|6|5|4|3)\b/i);
  if (!m) return game;
  const n =
    { vi: 6, v: 5, iv: 4, iii: 3 }[m[1]!.toLowerCase() as "vi"] ?? Number(m[1]);
  return `GTA ${n}`;
}

/** Each chapter's searchable title: it names the game, so it stands alone in search and in YouTube's chapter list. */
export function chapterTitle(kind: MomentKind, game: string): string {
  const g = shortGameName(game);
  switch (kind) {
    case "test":
      return `${g} Tests You Asked For`;
    case "myth":
      return `${g} Myths Put to the Test`;
    case "challenge":
      return `${g} Stunts and Challenges`;
    case "hidden":
      return `Hidden Details in ${g}`;
    case "funny":
      return `Funniest ${g} Moments`;
    case "action":
      return `Best ${g} Moments of the Week`;
  }
}

/** Week N of a date (pure): Week 1 is the first seven days from the series' start; 0 before it. */
export function weekNumber(start: string, date: string): number {
  const d = dayNumber(start, date);
  return d < 1 ? 0 : Math.floor((d - 1) / 7) + 1;
}

/** The dates (YYYY-MM-DD) Week N covers. */
export function weekDates(
  start: string,
  week: number,
): { from: string; to: string } {
  const from = addDays(start, (week - 1) * 7);
  return { from, to: addDays(from, 6) };
}

/** Seconds the narration and furniture around a moment take (estimates; the timeline measures the real ones). */
export const COST = {
  coldOpen: 9,
  intro: 16,
  card: 3,
  bridge: 9,
  outro: 14,
  endCard: 20,
};

export interface PlannedMoment extends WeekMoment {
  /** Day N of the series (from the recording's date), when it has one. */
  day?: number;
}

export interface ChapterPlan {
  kind: MomentKind;
  title: string;
  moments: PlannedMoment[];
}

export interface WeekPlan {
  game: string;
  week: number;
  dates: { from: string; to: string };
  /** The top moment, teased in the cold open. */
  teaser?: PlannedMoment;
  chapters: ChapterPlan[];
  /** Estimated seconds. */
  seconds: number;
  /** Moments ranked but left out, and why (for the report). */
  left: Array<{ vodId: string; start: number; score: number; why: string }>;
}

export interface PlanOptions {
  game: string;
  week: number;
  start: string;
  minSeconds: number;
  maxSeconds: number;
  /** The fewest moments in a chapter of its own (else the finale takes them). */
  minPerChapter?: number;
}

const momentCost = (m: WeekMoment) => m.end - m.start + COST.bridge;

/**
 * The cut (pure): moments in, chapters out. The best moments are taken while the estimate stays under the target
 * (midway between the minimum and the maximum), more only while it is under the minimum, never past the maximum.
 * A stream that already gave two moments is passed over while another stream still has a usable one.
 */
export function planWeek(ranked: WeekMoment[], o: PlanOptions): WeekPlan {
  const usable = ranked.filter((m) => !m.blocked);
  const left: WeekPlan["left"] = ranked
    .filter((m) => m.blocked)
    .map((m) => ({
      vodId: m.vodId,
      start: m.start,
      score: m.score,
      why: m.blocked!,
    }));
  const fixed = COST.coldOpen + COST.intro + COST.outro + COST.endCard;
  const target = (o.minSeconds + o.maxSeconds) / 2;
  const streams = new Set(usable.map((m) => m.vodId)).size;
  const taken: WeekMoment[] = [];
  const perStream = new Map<string, number>();
  let seconds = fixed + CHAPTER_ORDER.length * COST.card;
  const pool = [...usable].sort((a, b) => b.score - a.score);
  // Pass one: every stream's best before any stream's third. Pass two: whatever is best.
  for (const pass of [1, 2]) {
    for (const m of pool) {
      if (taken.includes(m)) continue;
      const n = perStream.get(m.vodId) ?? 0;
      if (pass === 1 && streams > 1 && n >= 2) continue;
      const cost = momentCost(m);
      if (seconds + cost > o.maxSeconds) continue;
      if (seconds >= target && seconds >= o.minSeconds) break;
      taken.push(m);
      perStream.set(m.vodId, n + 1);
      seconds += cost;
    }
  }
  for (const m of pool)
    if (!taken.includes(m))
      left.push({
        vodId: m.vodId,
        start: m.start,
        score: m.score,
        why: "not needed for the length",
      });

  const minPer = o.minPerChapter ?? 2;
  const byKind = new Map<MomentKind, WeekMoment[]>();
  for (const m of taken) byKind.set(m.kind, [...(byKind.get(m.kind) ?? []), m]);
  // A chapter of one moment is no chapter: it joins the finale.
  for (const k of CHAPTER_ORDER)
    if (
      k !== "action" &&
      (byKind.get(k)?.length ?? 0) > 0 &&
      byKind.get(k)!.length < minPer
    ) {
      byKind.set("action", [
        ...(byKind.get("action") ?? []),
        ...byKind.get(k)!,
      ]);
      byKind.delete(k);
    }
  const withDay = (m: WeekMoment): PlannedMoment => {
    const day = m.recordedOn ? dayNumber(o.start, m.recordedOn) : undefined;
    return { ...m, ...(day && day >= 1 ? { day } : {}) };
  };
  const chapters: ChapterPlan[] = CHAPTER_ORDER.filter(
    (k) => byKind.get(k)?.length,
  ).map((k) => ({
    kind: k,
    title: chapterTitle(k, o.game),
    moments: byKind
      .get(k)!
      .sort(
        (a, b) =>
          a.recordedOn.localeCompare(b.recordedOn) ||
          a.vodId.localeCompare(b.vodId) ||
          a.start - b.start,
      )
      .map(withDay),
  }));
  // One kind all week still makes chapters: the biggest chapter splits by day, or (one stream) into its two halves.
  if (chapters.length < 2) splitLonely(chapters, o.game);
  // The finale ends on its strongest moment: the rest stay in order, the best is moved last.
  const finale = chapters.find((c) => c.kind === "action");
  if (finale && finale.moments.length > 2) {
    const best = finale.moments.reduce((a, b) => (b.score > a.score ? b : a));
    finale.moments = [...finale.moments.filter((m) => m !== best), best];
  }
  const teaser = taken.length
    ? withDay(taken.reduce((a, b) => (b.score > a.score ? b : a)))
    : undefined;
  return {
    game: o.game,
    week: o.week,
    dates: weekDates(o.start, Math.max(1, o.week)),
    ...(teaser ? { teaser } : {}),
    chapters,
    seconds: Math.round(
      fixed +
        chapters.length * COST.card +
        taken.reduce((n, m) => n + momentCost(m), 0),
    ),
    left,
  };
}

/** Splits a lone chapter so the cut has at least two (in place): by day when the week has more than one, else in halves. */
export function splitLonely(chapters: ChapterPlan[], game: string): void {
  const only = chapters[0];
  if (!only || only.moments.length < 4) return;
  const days = [...new Set(only.moments.map((m) => m.day ?? 0))];
  if (days.length >= 2) {
    const g = shortGameName(game);
    chapters.splice(
      0,
      1,
      ...days.map((d) => ({
        kind: only.kind,
        title: d ? `${only.title.replace(/ of the Week$/, "")}: Day ${d}` : only.title,
        moments: only.moments.filter((m) => (m.day ?? 0) === d),
      })),
    );
    void g;
    return;
  }
  const half = Math.ceil(only.moments.length / 2);
  const first = only.moments.slice(0, half);
  const second = only.moments.slice(half);
  chapters.splice(0, 1, { kind: only.kind, title: only.title, moments: first }, { kind: only.kind, title: `More ${only.title}`, moments: second });
}

/** What is wrong with a plan before it is written and rendered (pure): empty when it may go ahead. */
export function planProblems(
  p: WeekPlan,
  o: Pick<PlanOptions, "minSeconds" | "maxSeconds"> & { minMoments: number },
): string[] {
  const out: string[] = [];
  const n = p.chapters.reduce((k, c) => k + c.moments.length, 0);
  if (n < o.minMoments)
    out.push(`only ${n} usable moments (needs ${o.minMoments})`);
  if (p.chapters.length < 2)
    out.push(
      "fewer than two chapters: YouTube needs three chapter marks with the intro",
    );
  if (p.seconds < o.minSeconds * 0.85)
    out.push(
      `about ${Math.round(p.seconds / 60)} min of material, under the ${Math.round(o.minSeconds / 60)} min minimum`,
    );
  if (p.seconds > o.maxSeconds)
    out.push(
      `about ${Math.round(p.seconds / 60)} min, over the ${Math.round(o.maxSeconds / 60)} min maximum`,
    );
  return out;
}
