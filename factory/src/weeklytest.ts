// The weekly video's growth test (owner-approved, 1 Nov 2026): the round-up of the week's stories ("This Week in
// Gaming", the arm the channel runs now) against one big story explained in depth (src/editorial/explained.ts).
//
// Why not src/growth.ts: that loop runs one test at a time on the news Shorts, needs six Shorts a side and judges
// the three-second hold from retention curves. A weekly long video gets one entry a week, so it would hold the
// Shorts tests up for months, and its question is a different one: which shape earns more viewers, watch time
// and subscribers. So this test keeps its own record (the settings row "weekly_shape_test") and its own judge,
// and speaks through the same Discord notices as the growth tests.
//
// Fair by construction: the two arms take turns week by week in the same slot (RECAP_DAYS at WEEKLY_SLOT),
// through the same long-video pipeline, with the same production start. Each week goes to the arm with fewer
// videos so far (on a tie, the one that did not run last), so a failed week or a week with no story strong enough
// for the explainer (it falls back to the round-up) never tips the balance. A video counts once it is published.
// The verdict reads three numbers per video: views at 7 days (the video_metrics "7d" row), average view duration
// and subscribers per 1,000 views (the "retention" row, captured from day four). With three videos a side the
// judge calls a winner when it leads on views at 7 days by at least 15% and is not behind on both of the other
// two; with six a side and no winner the test closes and the round-up stays. Every start, every finished week and
// the verdict is one plain-English Discord post.

import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { logEvent } from "./episodes.ts";
import { dayKey } from "./lanes.ts";
import { log } from "./lib/util.ts";

export type WeeklyArm = "roundup" | "explained";

export const ARM_LABEL: Record<WeeklyArm, string> = {
  roundup: "the round-up (This Week in Gaming)",
  explained: "the week's biggest story, explained",
};

/** Published videos a side before the judge may call a winner. */
export const WEEKLY_MIN_EACH = 3;
/** Published videos a side after which, with no winner, the test closes and the round-up stays. */
export const WEEKLY_MAX_EACH = 6;
/** How far ahead on views at 7 days a winner must be (0.15 = 15%). */
export const VIEWS_MARGIN = 0.15;

const STATE_KEY = "weekly_shape_test";

export interface WeeklyEntry {
  id: string;
  arm: WeeklyArm;
  /** The owner's day the video was selected (YYYY-MM-DD). */
  day: string;
  /** Set when an explained week fell back to the round-up. */
  fallback?: string;
}

export interface WeeklyState {
  since?: string;
  entries: WeeklyEntry[];
  /** Episodes whose finished week has been reported. */
  reported: string[];
  done?: { winner?: WeeklyArm; at: string };
}

export async function readWeeklyState(db: Db): Promise<WeeklyState> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [STATE_KEY],
  );
  try {
    if (row) {
      const s = JSON.parse(row.value) as WeeklyState;
      if (Array.isArray(s.entries))
        return { ...s, reported: Array.isArray(s.reported) ? s.reported : [] };
    }
  } catch {
    // a damaged record reads as never started
  }
  return { entries: [], reported: [] };
}

async function writeWeeklyState(db: Db, s: WeeklyState): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify(s)],
  );
}

/**
 * The arm for this week (pure): the finished test's winner when there is one; else the arm with fewer weeks so
 * far, and on a tie the one that did not run last; the explainer first, since it is the arm with no record yet.
 * `entries` are the weeks that count (not failed or rejected).
 */
export function nextArm(
  entries: ReadonlyArray<Pick<WeeklyEntry, "arm">>,
  winner?: WeeklyArm,
): WeeklyArm {
  if (winner) return winner;
  const n = (a: WeeklyArm) => entries.filter((e) => e.arm === a).length;
  const r = n("roundup");
  const x = n("explained");
  if (r !== x) return r < x ? "roundup" : "explained";
  const last = entries.at(-1)?.arm;
  return last === "explained" ? "roundup" : "explained";
}

/** The first post, as the test starts. */
export function weeklyStartNotice(now: Date, timeZone: string): string {
  return `Weekly growth test started today: **the weekly long video's shape**, ${ARM_LABEL.roundup} against ${ARM_LABEL.explained} (one story told in depth, 15-20 minutes, "Why X Really ..." titles). The two take turns week by week in the same slot, through the same pipeline; the explainer goes first. Each video is judged on its views at 7 days, its average view duration and the subscribers it brings per 1,000 views. With ${WEEKLY_MIN_EACH} videos a side the factory calls a winner if one leads on views at 7 days by ${Math.round(VIEWS_MARGIN * 100)}% or more without trailing on both of the others; with no winner after ${WEEKLY_MAX_EACH} a side the round-up stays. Nothing else changes. (${dayKey(now, timeZone)})`;
}

/** Weeks that count: entries whose episode is not failed or rejected. */
async function countedEntries(db: Db, s: WeeklyState): Promise<WeeklyEntry[]> {
  if (!s.entries.length) return [];
  const rows = await db.query<{ id: string }>(
    `SELECT id FROM episodes WHERE id = ANY($1::text[]) AND status NOT IN ('failed','rejected')`,
    [s.entries.map((e) => e.id)],
  );
  const live = new Set(rows.map((r) => r.id));
  return s.entries.filter((e) => live.has(e.id));
}

/**
 * The arm for the weekly video being selected now. Off (WEEKLY_EXPLAINED_TEST=false) it is always the round-up.
 * The first call starts the test and posts the notice.
 */
export async function weeklyArm(
  db: Db,
  cfg: Pick<Config, "weeklyExplainedTest" | "timezone">,
  now: Date,
  notify?: (m: DiscordMessage) => Promise<unknown>,
): Promise<WeeklyArm> {
  if (!cfg.weeklyExplainedTest) return "roundup";
  const s = await readWeeklyState(db);
  if (s.done) return s.done.winner ?? "roundup";
  if (!s.since) {
    s.since = now.toISOString();
    await writeWeeklyState(db, s);
    await logEvent(db, null, "growth_test_started", { key: "weekly_shape" });
    log("info", "weekly shape test started");
    if (notify)
      await notify({ content: weeklyStartNotice(now, cfg.timezone) }).catch(
        () => undefined,
      );
  }
  return nextArm(await countedEntries(db, s));
}

/** Records which arm an episode is (once per episode). */
export async function recordWeeklyArm(
  db: Db,
  cfg: Pick<Config, "weeklyExplainedTest" | "timezone">,
  id: string,
  arm: WeeklyArm,
  now: Date,
  fallback?: string,
): Promise<void> {
  if (!cfg.weeklyExplainedTest) return;
  const s = await readWeeklyState(db);
  if (s.done || s.entries.some((e) => e.id === id)) return;
  s.entries.push({
    id,
    arm,
    day: dayKey(now, cfg.timezone),
    ...(fallback ? { fallback } : {}),
  });
  await writeWeeklyState(db, s);
  await logEvent(db, id, "growth_test", {
    key: "weekly_shape",
    variant: arm,
    label: ARM_LABEL[arm],
    ...(fallback ? { fallback } : {}),
  });
}

/** The post when an explained week has no story strong enough and the round-up takes the slot. */
export function fallbackNotice(reason: string): string {
  return `Weekly growth test: no story this week is strong and safe enough to explain on its own (${reason}), so the round-up runs instead. It counts as a round-up week, and the explainer gets the next turn.`;
}

// ---- The judge -----------------------------------------------------------------------------------

/** One weekly video's numbers. */
export interface WeeklyResult {
  id: string;
  arm: WeeklyArm;
  title: string;
  views7d?: number;
  avdSeconds?: number;
  avgPercent?: number;
  subsPer1k?: number;
}

export async function weeklyResults(
  db: Db,
  entries: WeeklyEntry[],
): Promise<WeeklyResult[]> {
  if (!entries.length) return [];
  const rows = await db.query<{
    id: string;
    title: string | null;
    v7: number | null;
    ret: unknown;
  }>(
    `SELECT e.id, e.script_json->'youtube'->>'title' AS title,
            (SELECT m.views FROM video_metrics m WHERE m.episode_id = e.id AND m.label = '7d') AS v7,
            (SELECT m.raw FROM video_metrics m WHERE m.episode_id = e.id AND m.label = 'retention') AS ret
       FROM episodes e
      WHERE e.id = ANY($1::text[]) AND e.status = 'published' AND e.youtube_video_id IS NOT NULL`,
    [entries.map((e) => e.id)],
  );
  const arm = new Map(entries.map((e) => [e.id, e.arm]));
  return rows.map((r) => {
    const ret = (typeof r.ret === "string" ? JSON.parse(r.ret) : r.ret) as {
      views?: number;
      avgViewSeconds?: number;
      avgViewPercent?: number;
      subscribersGained?: number;
    } | null;
    const rv = Number(ret?.views ?? 0);
    return {
      id: r.id,
      arm: arm.get(r.id)!,
      title: r.title ?? r.id,
      views7d: r.v7 ?? undefined,
      avdSeconds: ret?.avgViewSeconds,
      avgPercent: ret?.avgViewPercent,
      subsPer1k:
        ret && rv > 0
          ? (Number(ret.subscribersGained ?? 0) / rv) * 1000
          : undefined,
    };
  });
}

/** A video counts for the verdict once its 7-day views and its retention row are in. */
export const complete = (r: WeeklyResult) =>
  r.views7d !== undefined && r.avdSeconds !== undefined;

export interface ArmStat {
  n: number;
  views7d: number;
  avdSeconds: number;
  avgPercent: number;
  subsPer1k: number;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;

export function armStat(rows: WeeklyResult[]): ArmStat {
  const c = rows.filter(complete);
  return {
    n: c.length,
    views7d: mean(c.map((r) => r.views7d!)),
    avdSeconds: mean(c.map((r) => r.avdSeconds!)),
    avgPercent: mean(c.map((r) => r.avgPercent ?? 0)),
    subsPer1k: mean(c.map((r) => r.subsPer1k ?? 0)),
  };
}

export interface WeeklyJudgement {
  winner?: WeeklyArm;
  enough: boolean;
  closed: boolean;
  roundup: ArmStat;
  explained: ArmStat;
  reason: "too_few" | "win" | "too_close" | "mixed" | "closed";
}

/**
 * The rule (pure): three complete videos a side; the arm with at least 15% more views at 7 days wins unless it is
 * behind on both average view duration and subscribers per 1,000 views; with six a side and no winner, closed.
 */
export function judgeWeekly(rows: WeeklyResult[]): WeeklyJudgement {
  const roundup = armStat(rows.filter((r) => r.arm === "roundup"));
  const explained = armStat(rows.filter((r) => r.arm === "explained"));
  const enough = roundup.n >= WEEKLY_MIN_EACH && explained.n >= WEEKLY_MIN_EACH;
  const full = roundup.n >= WEEKLY_MAX_EACH && explained.n >= WEEKLY_MAX_EACH;
  if (!enough)
    return { enough, closed: false, roundup, explained, reason: "too_few" };
  const [lead, other, arm]: [ArmStat, ArmStat, WeeklyArm] =
    explained.views7d >= roundup.views7d
      ? [explained, roundup, "explained"]
      : [roundup, explained, "roundup"];
  const ahead =
    other.views7d > 0
      ? lead.views7d / other.views7d - 1 >= VIEWS_MARGIN
      : lead.views7d > 0;
  const behindOnBoth =
    lead.avdSeconds < other.avdSeconds && lead.subsPer1k < other.subsPer1k;
  if (ahead && !behindOnBoth)
    return {
      winner: arm,
      enough,
      closed: false,
      roundup,
      explained,
      reason: "win",
    };
  if (full)
    return { enough, closed: true, roundup, explained, reason: "closed" };
  return {
    enough,
    closed: false,
    roundup,
    explained,
    reason: ahead ? "mixed" : "too_close",
  };
}

const n0 = (x: number) => Math.round(x).toLocaleString("en-US");
const mins = (s: number) =>
  `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function armLine(arm: WeeklyArm, s: ArmStat): string {
  if (!s.n) return `- ${ARM_LABEL[arm]}: no finished weeks yet`;
  return `- ${ARM_LABEL[arm]}: ${n0(s.views7d)} views at 7 days, ${mins(s.avdSeconds)} watched on average (${Math.round(s.avgPercent)}%), ${s.subsPer1k.toFixed(1)} subscribers per 1,000 views (${s.n} video${s.n === 1 ? "" : "s"})`;
}

/** The post for one finished week, with the running tally (plain English). */
export function weekReport(r: WeeklyResult, j: WeeklyJudgement): string {
  const own = complete(r)
    ? `${n0(r.views7d!)} views at 7 days, ${mins(r.avdSeconds!)} watched on average, ${(r.subsPer1k ?? 0).toFixed(1)} subscribers per 1,000 views`
    : `${r.views7d !== undefined ? `${n0(r.views7d)} views at 7 days` : "7-day views not in yet"}; watch time and subscribers arrive in a few days`;
  return `Weekly growth test: "${r.title}" (${ARM_LABEL[r.arm]}) finished its first week: ${own}.\n${armLine("roundup", j.roundup)}\n${armLine("explained", j.explained)}`;
}

/** The verdict post (plain English). */
export function verdictPost(j: WeeklyJudgement): string {
  const lines = [
    "**Weekly growth test: the weekly long video's shape**",
    armLine("roundup", j.roundup),
    armLine("explained", j.explained),
  ];
  if (j.winner) {
    const [w, l] =
      j.winner === "explained"
        ? [j.explained, j.roundup]
        : [j.roundup, j.explained];
    lines.push(
      `Verdict: **${ARM_LABEL[j.winner]} wins**, with ${Math.round((w.views7d / Math.max(1, l.views7d) - 1) * 100)}% more views at 7 days. Every weekly video now takes that shape; the test is over. (A longer video watches longer by nature, so the subscribers per 1,000 views is the fairer second check.)`,
    );
  } else if (j.closed)
    lines.push(
      `Verdict: **no clear difference after ${WEEKLY_MAX_EACH} weeks a side.** The round-up stays as the weekly video; the test is over.`,
    );
  return lines.join("\n");
}

/**
 * From the analytics tick: posts each finished week once (its 7-day views are in), and the verdict when the rule
 * is met. A decision is recorded before it is posted, so a failed post never repeats it.
 */
export async function weeklyVerdict(
  db: Db,
  cfg: Pick<Config, "weeklyExplainedTest">,
  now: Date,
  notify: (m: DiscordMessage) => Promise<unknown>,
): Promise<string | undefined> {
  if (!cfg.weeklyExplainedTest) return undefined;
  const s = await readWeeklyState(db);
  if (!s.since || s.done || !s.entries.length) return undefined;
  const results = await weeklyResults(db, s.entries);
  const j = judgeWeekly(results);
  const posts: string[] = [];
  for (const r of results) {
    if (r.views7d === undefined || s.reported.includes(r.id)) continue;
    s.reported.push(r.id);
    posts.push(weekReport(r, j));
  }
  if (j.winner || j.closed) {
    s.done = { winner: j.winner, at: now.toISOString() };
    posts.push(verdictPost(j));
    await logEvent(db, null, "growth_verdict", {
      key: "weekly_shape",
      winner: j.winner ?? null,
      reason: j.reason,
      roundup: j.roundup.n,
      explained: j.explained.n,
    });
    log("info", "weekly shape test judged", { winner: j.winner ?? "none" });
  }
  if (!posts.length) return undefined;
  await writeWeeklyState(db, s);
  for (const p of posts) await notify({ content: p }).catch(() => undefined);
  return posts.join("\n\n");
}
