// The experiments' verdicts, taken by the factory itself (owner, 28 Oct 2026: no AI session needed). On
// EXPERIMENT_VERDICT_DATE (UK day, default 8 Nov 2026) the analytics tick judges three tests from the
// factory's own numbers and posts one plain-English Discord report:
//   1. the desk question (a second voice asks the viewer's question before the take): kept, dropped or
//      given another week, and judged again a week later while it stays undecided;
//   2. the Pulse narrator against the earlier Liam and Alice Shorts: a report only, nothing changes;
//   3. labelled leak Shorts against the other news Shorts: the rumour allowance drops to one a day when
//      they do clearly worse.
// Once the desk test has a verdict, Pip the mascot (src/render/components/Pip.tsx) starts on half of Shorts.
// Decisions are settings overrides read at runtime (deskShareNow and friends), never .env edits.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { Episode } from "./episodes.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { LIVE_AT } from "./analytics.ts";
import { dayKey } from "./lanes.ts";
import { log } from "./lib/util.ts";

/** Only Shorts live this long with this many views count on either side. */
export const MIN_DAYS_LIVE = 2;
export const MIN_VIEWS = 30;
/** Desk question: Shorts a side, and the stayed-to-watch gap in points that decides. */
export const DESK_MIN_EACH = 5;
export const DESK_POINTS = 3;
/** Labelled leaks: Shorts a side, the stayed-to-watch gap in points and the views-a-day ratio that cut them. */
export const LEAK_MIN = 3;
export const LEAK_POINTS = 5;
export const LEAK_VIEWS_RATIO = 0.5;
/** The desk test is judged at most this many times (8, 15, 22 and 29 Nov), then left at its share. */
export const MAX_RUNS = 4;
/** The desk test began on 25 Oct 2026: only Shorts live since then are compared. */
export const DESK_SINCE = "2026-10-25T00:00:00Z";
/** The share of Shorts Pip goes on once the desk test has its verdict. */
export const MASCOT_START_SHARE = 0.5;

const NEWS_LANES = ["news", "news_breaking", "free"];
const SHORT_LANES = [
  "news_breaking",
  "news",
  "free",
  "evergreen",
  "cutdown",
  "gameplay",
];
const STATE_KEY = "experiment_verdicts";
const OVERRIDE = {
  desk: "override:desk_share",
  rumours: "override:rumours_per_day",
  mascot: "override:mascot_share",
} as const;

// ---- Runtime overrides -------------------------------------------------------------------------

async function readOverride(db: Db, key: string): Promise<number | undefined> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [key],
  );
  const n = row ? Number(row.value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

async function writeOverride(
  db: Db,
  key: string,
  value: number,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, String(value)],
  );
}

const share = (n: number) => Math.max(0, Math.min(1, n));

/** The desk question's share now: the verdict's setting when there is one, else DESK_SHARE. */
export async function deskShareNow(
  db: Db,
  cfg: Pick<Config, "deskShare">,
): Promise<number> {
  return share((await readOverride(db, OVERRIDE.desk)) ?? cfg.deskShare);
}

/** Rumour Shorts a day now: the verdict's setting when there is one, else RUMOURS_PER_DAY. */
export async function rumoursPerDayNow(
  db: Db,
  cfg: Pick<Config, "rumoursPerDay">,
): Promise<number> {
  return Math.max(
    0,
    Math.round((await readOverride(db, OVERRIDE.rumours)) ?? cfg.rumoursPerDay),
  );
}

/** Pip's share now: the verdict's setting when there is one, else MASCOT_SHARE. */
export async function mascotShareNow(
  db: Db,
  cfg: Pick<Config, "mascotShare">,
): Promise<number> {
  return share((await readOverride(db, OVERRIDE.mascot)) ?? cfg.mascotShare);
}

/**
 * Whether this Short carries Pip: a stable hash of the episode id, salted so it is independent of the
 * desk and new-look tests. The Spanish twin copies its source and is left out.
 */
export function mascotFor(
  mascotShare: number,
  ep: Pick<Episode, "id" | "lane">,
): boolean {
  if (mascotShare <= 0 || ep.lane === "twin") return false;
  let h = 7;
  for (const c of `mascot:${ep.id}`) h = (h * 131 + c.charCodeAt(0)) >>> 0;
  return h % 1000 < mascotShare * 1000;
}

// ---- The numbers -------------------------------------------------------------------------------

/** One main-channel Short, live 2+ days with 30+ views. */
export interface ShortStat {
  id: string;
  lane: string;
  liveAt: Date;
  views: number;
  viewsPerDay: number;
  /** Stayed to watch: engagedViews / views from the 'retention' row, in percent (undefined until captured). */
  stay?: number;
  /** Average percentage viewed from the 'retention' row (avgViewPercent). */
  pct?: number;
  desk: boolean;
  narrator?: string;
  rumour: boolean;
}

/** Names the narrator the same way whatever the record says (old rows hold Liam's voice id, the local clone adds a suffix). */
export function narratorGroup(
  name: string | null | undefined,
): string | undefined {
  if (!name) return undefined;
  const n = name.replace(/\s*\(local clone\)\s*$/i, "").trim();
  if (n === "TX3LPaxmHKxFdv7VOQHJ" || /^liam\b/i.test(n)) return "Liam";
  if (n === "OJ8Q3U8s4XUozYoCc8n7" || /^pulse narrator/i.test(n))
    return "Pulse narrator";
  if (/^alice\b/i.test(n)) return "Alice";
  return n;
}

export async function shortStats(db: Db, now: Date): Promise<ShortStat[]> {
  const rows = await db.query<{
    id: string;
    lane: string;
    live_at: string;
    desk: boolean;
    narrator: string | null;
    rumour: boolean | null;
    retention: unknown;
    views: number | string | null;
    views_at: string | null;
  }>(
    `SELECT e.id, e.lane, ${LIVE_AT("e")} AS live_at,
            (e.assets_json->'desk') IS NOT NULL AS desk,
            e.assets_json->'voice'->>'name' AS narrator,
            (e.script_json->>'is_rumour') = 'true' AS rumour,
            (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention' LIMIT 1) AS retention,
            (SELECT m.views FROM video_metrics m WHERE m.episode_id = e.id AND m.label <> 'curve' ORDER BY m.views DESC, m.captured_at DESC LIMIT 1) AS views,
            (SELECT m.captured_at FROM video_metrics m WHERE m.episode_id = e.id AND m.label <> 'curve' ORDER BY m.views DESC, m.captured_at DESC LIMIT 1) AS views_at
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL
        AND e.lane <> 'twin' AND e.lane = ANY($2)
        AND ${LIVE_AT("e")} < $1::timestamptz - make_interval(days => $3)
        AND ${LIVE_AT("e")} > $1::timestamptz - interval '45 days'`,
    [now, SHORT_LANES, MIN_DAYS_LIVE],
  );
  const out: ShortStat[] = [];
  for (const r of rows) {
    const views = Number(r.views ?? 0);
    if (views < MIN_VIEWS) continue;
    const liveAt = new Date(r.live_at);
    const at = r.views_at ? new Date(r.views_at) : now;
    const days = Math.max(1, (at.getTime() - liveAt.getTime()) / 86_400_000);
    const raw = (
      typeof r.retention === "string" ? JSON.parse(r.retention) : r.retention
    ) as {
      views?: number;
      engagedViews?: number;
      avgViewPercent?: number;
    } | null;
    out.push({
      id: r.id,
      lane: r.lane,
      liveAt,
      views,
      viewsPerDay: views / days,
      stay:
        raw?.engagedViews !== undefined && Number(raw?.views) > 0
          ? (100 * Number(raw.engagedViews)) / Number(raw.views)
          : undefined,
      pct:
        raw?.avgViewPercent !== undefined
          ? Number(raw.avgViewPercent)
          : undefined,
      desk: Boolean(r.desk),
      narrator: narratorGroup(r.narrator),
      rumour: Boolean(r.rumour),
    });
  }
  return out;
}

/** One side of a comparison: counts and averages. */
export interface Side {
  n: number; // Shorts with a stayed-to-watch figure
  all: number; // Shorts counted for views a day
  stay: number;
  pct: number;
  viewsPerDay: number;
}

export function sideOf(rows: ShortStat[]): Side {
  const held = rows.filter((r) => r.stay !== undefined);
  const mean = (xs: number[]) =>
    xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  return {
    n: held.length,
    all: rows.length,
    stay: mean(held.map((r) => r.stay!)),
    pct: mean(held.filter((r) => r.pct !== undefined).map((r) => r.pct!)),
    viewsPerDay: mean(rows.map((r) => r.viewsPerDay)),
  };
}

// ---- 1. The desk question ----------------------------------------------------------------------

export type DeskDecision = "keep" | "drop" | "extend";
export interface DeskVerdict {
  decision: DeskDecision;
  withDesk: Side;
  without: Side;
  enough: boolean;
}

/**
 * At least five Shorts a side: the desk side better by 3+ points on stayed to watch, without a worse
 * average percentage viewed, keeps it; worse by 3+ points drops it; anything else runs another week.
 */
export function judgeDesk(rows: ShortStat[]): DeskVerdict {
  const pool = rows.filter(
    (r) =>
      NEWS_LANES.includes(r.lane) &&
      r.liveAt.getTime() >= Date.parse(DESK_SINCE),
  );
  const withDesk = sideOf(pool.filter((r) => r.desk));
  const without = sideOf(pool.filter((r) => !r.desk));
  const enough = withDesk.n >= DESK_MIN_EACH && without.n >= DESK_MIN_EACH;
  let decision: DeskDecision = "extend";
  if (enough) {
    const gap = withDesk.stay - without.stay;
    if (gap >= DESK_POINTS && withDesk.pct >= without.pct) decision = "keep";
    else if (gap <= -DESK_POINTS) decision = "drop";
  }
  return { decision, withDesk, without, enough };
}

// ---- 2. The narrator (report only) -------------------------------------------------------------

export interface NarratorReport {
  pulse: Side;
  earlier: Side;
  liam: Side;
  alice: Side;
  enough: boolean;
  direction?: "better" | "worse" | "level";
}

export function narratorReport(rows: ShortStat[]): NarratorReport {
  const pulse = sideOf(rows.filter((r) => r.narrator === "Pulse narrator"));
  const liam = sideOf(rows.filter((r) => r.narrator === "Liam"));
  const alice = sideOf(rows.filter((r) => r.narrator === "Alice"));
  const earlier = sideOf(
    rows.filter((r) => r.narrator === "Liam" || r.narrator === "Alice"),
  );
  const enough = pulse.n >= DESK_MIN_EACH && earlier.n >= DESK_MIN_EACH;
  const gap = pulse.stay - earlier.stay;
  const direction = !enough
    ? undefined
    : gap >= DESK_POINTS
      ? "better"
      : gap <= -DESK_POINTS
        ? "worse"
        : "level";
  return { pulse, earlier, liam, alice, enough, direction };
}

// ---- 3. Labelled leaks -------------------------------------------------------------------------

export type LeakDecision = "cut" | "keep" | "hold" | "too_few";
export interface LeakVerdict {
  decision: LeakDecision;
  leaks: Side;
  others: Side;
  /** Points by which leaks trail on stayed to watch (when both sides have three with the figure). */
  stayGap?: number;
  /** Leaks' views a day over the others'. */
  viewsRatio?: number;
}

/**
 * At least three labelled leak Shorts against the other news Shorts. Worse by 5+ points on stayed to
 * watch, or under half the views a day, cuts the allowance to one a day; better on both leaves it;
 * anything between is held as it is.
 */
export function judgeLeaks(rows: ShortStat[]): LeakVerdict {
  const pool = rows.filter((r) => NEWS_LANES.includes(r.lane));
  const leakRows = pool.filter((r) => r.rumour);
  const otherRows = pool.filter((r) => !r.rumour);
  const leaks = sideOf(leakRows);
  const others = sideOf(otherRows);
  const stayGap =
    leaks.n >= LEAK_MIN && others.n >= LEAK_MIN
      ? leaks.stay - others.stay
      : undefined;
  const viewsRatio =
    leaks.all >= LEAK_MIN && others.all >= LEAK_MIN && others.viewsPerDay > 0
      ? leaks.viewsPerDay / others.viewsPerDay
      : undefined;
  let decision: LeakDecision = "too_few";
  if (stayGap !== undefined || viewsRatio !== undefined) {
    if (
      (stayGap !== undefined && stayGap <= -LEAK_POINTS) ||
      (viewsRatio !== undefined && viewsRatio < LEAK_VIEWS_RATIO)
    )
      decision = "cut";
    else if (
      (stayGap === undefined || stayGap > 0) &&
      (viewsRatio === undefined || viewsRatio >= 1)
    )
      decision = "keep";
    else decision = "hold";
  }
  return { decision, leaks, others, stayGap, viewsRatio };
}

// ---- The run -----------------------------------------------------------------------------------

export interface VerdictRun {
  day: string;
  at: string;
  desk: DeskDecision;
  leaks: LeakDecision;
  narrator?: NarratorReport["direction"];
  deskShare: number;
  rumoursPerDay: number;
  mascotShare: number;
  report: string;
}

export interface VerdictState {
  runs: VerdictRun[];
  next: string | null; // UK day of the next run, null when no more are due
}

export async function readVerdicts(db: Db): Promise<VerdictState> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [STATE_KEY],
  );
  try {
    if (row) return JSON.parse(row.value) as VerdictState;
  } catch {
    // a damaged record reads as never run
  }
  return { runs: [], next: null };
}

async function writeVerdicts(db: Db, state: VerdictState): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify(state)],
  );
}

/** Due on or after the verdict date (UK day) the first time, then on the day a week-long extension ends. */
export function verdictDue(
  state: VerdictState,
  today: string,
  firstDay: string,
): boolean {
  if (!state.runs.length) return today >= firstDay;
  return state.next !== null && today >= state.next;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const dayName = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]}`;
};
const pc = (x: number) => `${Math.round(x)}%`;
const pts = (x: number) =>
  `${Math.abs(x).toFixed(1)} point${Math.abs(x).toFixed(1) === "1.0" ? "" : "s"}`;
const perDay = (x: number) =>
  (x >= 100 ? Math.round(x / 10) * 10 : Math.round(x)).toLocaleString("en-US");
const shorts = (n: number) => `${n} Short${n === 1 ? "" : "s"}`;
const sideLine = (name: string, s: Side) =>
  s.n
    ? `${name}: ${pc(s.stay)} stayed to watch, ${pc(s.pct)} of each Short watched on average, about ${perDay(s.viewsPerDay)} views a day (${shorts(s.n)})`
    : `${name}: no Shorts with full numbers yet`;

/**
 * Judges the three tests, applies the decisions as settings overrides, records the run and posts the report.
 * Runs at most once a UK day; does nothing until EXPERIMENT_VERDICT_DATE, then again only while the desk
 * test is extended.
 */
export async function experimentVerdicts(
  db: Db,
  cfg: Config,
  now: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<VerdictRun | undefined> {
  const state = await readVerdicts(db);
  const today = dayKey(now, cfg.timezone);
  if (!verdictDue(state, today, cfg.experimentVerdictDate)) return undefined;
  const rows = await shortStats(db, now);
  const desk = judgeDesk(rows);
  const narrator = narratorReport(rows);
  const leaks = judgeLeaks(rows);
  const runNo = state.runs.length + 1;
  const lines: string[] = [
    `**Experiment results, ${dayName(today)}** (main channel Shorts live 2+ days with 30+ views)`,
  ];

  // 1. Desk question.
  const deskBefore = await deskShareNow(db, cfg);
  let deskShare = deskBefore;
  let next: string | null = null;
  lines.push(
    "",
    "**1. The desk question** (a second voice asks the viewer's question before our take)",
  );
  lines.push(
    `- ${sideLine("With it", desk.withDesk)}`,
    `- ${sideLine("Without it", desk.without)}`,
  );
  if (desk.decision === "keep") {
    deskShare = 1;
    lines.push(
      `Decision: **keep it.** With it, the share who stayed to watch was ${pts(desk.withDesk.stay - desk.without.stay)} higher and they watched no less of each Short. Every news Short with a question now gets it.`,
    );
  } else if (desk.decision === "drop") {
    deskShare = 0;
    lines.push(
      `Decision: **drop it.** With it, the share who stayed to watch was ${pts(desk.withDesk.stay - desk.without.stay)} lower. News Shorts go back to the narrator alone.`,
    );
  } else if (runNo < MAX_RUNS) {
    next = dayKey(new Date(now.getTime() + 7 * 86_400_000), cfg.timezone);
    lines.push(
      desk.enough
        ? `Decision: **another week.** The difference (${pts(desk.withDesk.stay - desk.without.stay)}) is too small to call. It stays on half of news Shorts; next check ${dayName(next)}.`
        : `Decision: **another week.** Not enough Shorts yet (${DESK_MIN_EACH} a side needed). It stays on half of news Shorts; next check ${dayName(next)}.`,
    );
  } else {
    lines.push(
      `Decision: **no clear answer after ${MAX_RUNS} checks.** The desk question stays on ${pc(deskBefore * 100)} of news Shorts and the factory stops judging it.`,
    );
  }
  if (deskShare !== deskBefore)
    await writeOverride(db, OVERRIDE.desk, deskShare);

  // 2. Narrator (information only).
  lines.push(
    "",
    "**2. The Pulse narrator** (information only, nothing changes)",
  );
  lines.push(
    `- ${sideLine("Pulse narrator", narrator.pulse)}`,
    `- ${sideLine("Liam and Alice before it", narrator.earlier)}`,
  );
  if (narrator.liam.n && narrator.alice.n)
    lines.push(
      `  (Liam ${pc(narrator.liam.stay)} over ${shorts(narrator.liam.n)}, Alice ${pc(narrator.alice.stay)} over ${shorts(narrator.alice.n)})`,
    );
  lines.push(
    !narrator.enough
      ? `Too early to say: ${DESK_MIN_EACH} Shorts a side are needed.`
      : narrator.direction === "better"
        ? `The Pulse narrator is doing better: the share who stay to watch is ${pts(narrator.pulse.stay - narrator.earlier.stay)} higher.`
        : narrator.direction === "worse"
          ? `The Pulse narrator is doing worse: the share who stay to watch is ${pts(narrator.pulse.stay - narrator.earlier.stay)} lower. Worth a listen; nothing was changed.`
          : `About the same so far (${pts(narrator.pulse.stay - narrator.earlier.stay)} apart).`,
  );

  // 3. Labelled leaks.
  const rumoursBefore = await rumoursPerDayNow(db, cfg);
  let rumoursPerDay = rumoursBefore;
  lines.push("", "**3. Labelled leak Shorts** against our other news Shorts");
  lines.push(
    `- ${sideLine("Leaks", leaks.leaks)}${leaks.leaks.all > leaks.leaks.n ? ` (${shorts(leaks.leaks.all)} counted for views)` : ""}`,
    `- ${sideLine("Other news", leaks.others)}${leaks.others.all > leaks.others.n ? ` (${shorts(leaks.others.all)} counted for views)` : ""}`,
  );
  if (leaks.decision === "cut") {
    rumoursPerDay = Math.min(1, rumoursBefore);
    const why =
      leaks.stayGap !== undefined && leaks.stayGap <= -LEAK_POINTS
        ? `the share who stayed to watch was ${pts(leaks.stayGap)} lower`
        : `they got ${pc((leaks.viewsRatio ?? 0) * 100)} of the views a day`;
    lines.push(
      rumoursBefore > 1
        ? `Decision: **one leak a day from now** (was ${rumoursBefore}): ${why}.`
        : `Leaks did worse (${why}); the allowance is already ${rumoursBefore} a day.`,
    );
  } else if (leaks.decision === "keep") {
    lines.push(
      `Decision: **leave it at ${rumoursBefore} a day.** Leaks are holding up as well as other news.`,
    );
  } else if (leaks.decision === "hold") {
    lines.push(
      `Decision: **leave it at ${rumoursBefore} a day.** Leaks trail a little, but not by enough to cut.`,
    );
  } else {
    lines.push(
      `Too few to judge (${LEAK_MIN} leak Shorts needed); the allowance stays at ${rumoursBefore} a day.`,
    );
  }
  if (rumoursPerDay !== rumoursBefore)
    await writeOverride(db, OVERRIDE.rumours, rumoursPerDay);

  // 4. Pip, once the desk test has its verdict.
  let mascotShare = await mascotShareNow(db, cfg);
  if (
    desk.decision !== "extend" &&
    (await readOverride(db, OVERRIDE.mascot)) === undefined
  ) {
    mascotShare = MASCOT_START_SHARE;
    await writeOverride(db, OVERRIDE.mascot, mascotShare);
    lines.push(
      "",
      "**4. Pip the mascot** starts today on about half of new Shorts (top right, beside the logo), so the weekly lessons can compare Shorts with and without him.",
    );
  }

  const report = lines.join("\n");
  const run: VerdictRun = {
    day: today,
    at: now.toISOString(),
    desk: desk.decision,
    leaks: leaks.decision,
    narrator: narrator.direction,
    deskShare,
    rumoursPerDay,
    mascotShare,
    report,
  };
  // Recorded before the post, so a failed post never repeats a decision.
  await writeVerdicts(db, { runs: [...state.runs, run], next });
  log("info", "experiment verdicts", {
    desk: desk.decision,
    leaks: leaks.decision,
    narrator: narrator.direction ?? "too few",
    next,
  });
  await notify({ content: report });
  return run;
}

// ---- The posting-time test -----------------------------------------------------------------------
// Facebook, Instagram and the TikTok draft aim for 16:00-20:00 US Eastern (src/social/crosspost.ts
// primeTimeDelay) for two weeks from 29 Oct 2026. On PRIME_TIME_END the factory reports how posts in the
// window did against posts outside it on each platform, and the test stops unless the owner keeps it:
// override:prime_time_posting 1 keeps it on, 0 turns it off at any time.

export const PRIME_TIME_START = "2026-10-29";
export const PRIME_TIME_END = "2026-11-12";
const PRIME_OVERRIDE = "override:prime_time_posting";
const PRIME_REPORT_KEY = "prime_time_report";
/** Posts a side before the report compares a platform. */
export const PRIME_MIN_EACH = 3;

/** Whether the posting-time test is on now: the owner's setting when there is one, else the two test weeks. */
export async function primeTimeNow(
  db: Db,
  now: Date,
  timeZone = "Europe/London",
): Promise<boolean> {
  const o = await readOverride(db, PRIME_OVERRIDE);
  if (o !== undefined) return o > 0;
  const day = dayKey(now, timeZone);
  return day >= PRIME_TIME_START && day < PRIME_TIME_END;
}

/** Whether a post went out inside the evening window, by its US Eastern hour. */
export function inPrimeWindow(at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "America/New_York",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(at),
  );
  return hour >= 16 && hour < 20;
}

const mid = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
};

/** One line per platform: median views a day after posting, inside the window against outside it. */
export function primeTimeLines(
  rows: Array<{ platform: string; at: Date; views: number }>,
): string[] {
  const names: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };
  return Object.keys(names).map((p) => {
    const mine = rows.filter((r) => r.platform === p);
    const inside = mine.filter((r) => inPrimeWindow(r.at)).map((r) => r.views);
    const outside = mine.filter((r) => !inPrimeWindow(r.at)).map((r) => r.views);
    if (inside.length < PRIME_MIN_EACH || outside.length < PRIME_MIN_EACH)
      return `• ${names[p]}: not enough numbers to compare (${inside.length} posts in the evening window, ${outside.length} outside; ${PRIME_MIN_EACH} a side needed).`;
    const a = mid(inside);
    const b = mid(outside);
    const verdict = a > b * 1.2 ? "the evening did better" : b > a * 1.2 ? "the evening did worse" : "about the same";
    return `• ${names[p]}: ${a.toLocaleString("en-US")} median views posted 16:00-20:00 Eastern (${inside.length} posts) against ${b.toLocaleString("en-US")} at other times (${outside.length}): ${verdict}.`;
  });
}

/** On the end day, once: the report, and the test reverts to the usual stagger unless the owner set the override. */
export async function primeTimeVerdict(
  db: Db,
  cfg: Pick<Config, "timezone">,
  now: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<boolean> {
  if (dayKey(now, cfg.timezone) < PRIME_TIME_END) return false;
  const [done] = await db.query<{ value: string }>(`SELECT value FROM settings WHERE key = $1`, [PRIME_REPORT_KEY]);
  if (done) return false;
  // Each post's numbers a day on (or the nearest age read), from 14 days before the test to its end.
  const rows = await db.query<{ platform: string; at: string; views: number | string }>(
    `SELECT v.detail->>'platform' AS platform, v.created_at AS at,
            (SELECT s.views FROM social_metrics s WHERE s.episode_id = v.episode_id AND s.platform = v.detail->>'platform' AND s.views IS NOT NULL
              ORDER BY CASE s.label WHEN '24h' THEN 0 WHEN '72h' THEN 1 WHEN '7d' THEN 2 ELSE 3 END LIMIT 1) AS views
       FROM events v
      WHERE v.kind = 'crosspost' AND v.detail->>'platform' IN ('facebook','instagram','tiktok')
        AND v.created_at >= $1::date - 14 AND v.created_at < $2::date`,
    [PRIME_TIME_START, PRIME_TIME_END],
  );
  const lines = primeTimeLines(
    rows.filter((r) => r.views !== null).map((r) => ({ platform: r.platform, at: new Date(r.at), views: Number(r.views) })),
  );
  const kept = (await readOverride(db, PRIME_OVERRIDE)) ?? 0;
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [PRIME_REPORT_KEY, now.toISOString()],
  );
  await notify({
    content: [
      `**Posting-time test, ${PRIME_TIME_START} to ${PRIME_TIME_END}:** Facebook, Instagram and TikTok drafts aimed for 16:00-20:00 US Eastern.`,
      ...lines,
      kept > 0
        ? "You kept evening posting on, so it carries on."
        : "The test has ended and posts are back to following YouTube by a few minutes. To keep evening posting, tell Claude and it will switch it back on.",
    ].join("\n"),
  });
  log("info", "posting-time test reported", { kept: kept > 0 });
  return true;
}
