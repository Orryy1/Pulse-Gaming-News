// The subscriber learner (owner, 14 Nov 2026). The channel had 50 subscribers; a month of 130 videos brought 52,000
// views but only 22 subscribers. Why story Shorts (about 83% viewed) won most of them, news Shorts (39-46% viewed) got
// views and almost none. Retention alone was steering the mix, so this steers it by what it is for: subscribers.
//
// Every Sunday from 09:00 local (before the 10:00 growth report) it reads each video's views and subscribers gained over
// the last 7 and 28 days from YouTube Analytics (the same channelReport request, client and scope the weekly analytics
// loop uses; the day-four "retention" rows when that request fails), groups them by format and works out subscribers per
// 1,000 views. When one of the flexible slot formats (news and Why, the two made in the news lane on daily HH:MM slots)
// clearly beats another over 28 days, one slot moves from the weaker to the stronger. Safe bounds:
//   - a format must have SUBS_LEARN_MIN_VIEWS views and SUBS_LEARN_MIN_VIDEOS videos over 28 days to win or lose a slot,
//     and the stronger one SUBS_LEARN_MIN_SUBS subscribers, and a SUBS_LEARN_LEAD lead;
//   - no format ever drops to zero slots, and news keeps at least one, so breaking news and the day's news still go out
//     (breaking Shorts have their own allowance and never use these slots anyway);
//   - no format moves more than SUBS_LEARN_MAX_SHIFT slots from its configured count;
//   - the GTA File's slot (SERIES_GTA_FILE_SLOT) stays a Why slot;
//   - at most one slot moves a week, and every change (or the reason none was made) is said in the alerts channel.
// SUBS_LEARN turns it on; SUBS_LEARN_APPLY=false reports what it would do and changes nothing. The moves live in the
// settings table, so they survive a restart; turning SUBS_LEARN off (or APPLY off) puts the configured slots back.

import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { DiscordMessage } from "../approval/discord.ts";
import { logEvent } from "../episodes.ts";
import { dayKey, weekday } from "../lanes.ts";
import type { SubsLearnSettings } from "./settings.ts";

export type SubsFormat =
  | "news"
  | "why"
  | "search"
  | "ranking"
  | "gameplay"
  | "reply"
  | "live_clip"
  | "long_ranking"
  | "documentary"
  | "gta_daily"
  | "funny"
  | "meme"
  | "other";

/** Report order. */
export const SUBS_FORMATS: SubsFormat[] = [
  "news",
  "why",
  "search",
  "ranking",
  "gameplay",
  "reply",
  "live_clip",
  "long_ranking",
  "documentary",
  "gta_daily",
  "funny",
  "meme",
  "other",
];

export const SUBS_NAMES: Record<SubsFormat, string> = {
  news: "News",
  why: "The Why",
  search: "Search answers",
  ranking: "Rankings (Shorts)",
  gameplay: "Gameplay",
  reply: "Comment replies",
  live_clip: "Live clips",
  long_ranking: "Long rankings",
  documentary: "Documentaries",
  gta_daily: "GTA daily (The GTA File)",
  funny: "Funny Shorts (on trial)",
  meme: "Meme posts (on trial)",
  other: "Other",
};

/** The formats that hold daily HH:MM slots the learner may move between. */
export type FlexFormat = "news" | "why";
export const FLEX_FORMATS: FlexFormat[] = ["news", "why"];
/** Slots a flexible format always keeps: news keeps one so the day's news still goes out. */
export const FLEX_MIN: Record<FlexFormat, number> = { news: 1, why: 1 };

/** Which format a video belongs to, from how it was made (pure). */
export function subsFormat(ep: {
  lane: string;
  story_hash?: string | null;
  evergreen_format?: string | null;
  runtime?: string | null;
  live?: boolean | string | null;
}): SubsFormat {
  const h = ep.story_hash ?? "";
  const long = ep.runtime === "long" || ep.lane === "longform";
  if (h.startsWith("gtafile:")) return "gta_daily";
  // FUNNY_SHORTS and MEME_POSTS (src/funny): their own formats, so they are judged on their own numbers.
  if (h.startsWith("gameplay:funny_")) return "funny";
  if (h.startsWith("meme:")) return "meme";
  if (h.startsWith("reply:")) return "reply";
  if (h.startsWith("search:")) return "search";
  if (h.startsWith("why:")) return "why";
  if (h.startsWith("documentary:") || ep.evergreen_format === "documentary")
    return "documentary";
  if (
    ep.lane === "longform" ||
    (long &&
      (ep.evergreen_format === "ranking" || h.startsWith("evergreen:ranking")))
  )
    return "long_ranking";
  if (ep.lane === "gameplay")
    return ep.live === true || ep.live === "true" ? "live_clip" : "gameplay";
  if (
    ep.lane === "cutdown" ||
    ep.evergreen_format === "ranking" ||
    h.startsWith("evergreen:ranking")
  )
    return "ranking";
  if (ep.lane === "news" || ep.lane === "news_breaking") return "news";
  return "other";
}

export interface SubsRow {
  format: SubsFormat;
  views: number;
  subs: number;
}

export interface SubsTally {
  videos: number;
  views: number;
  subs: number;
}

/** Subscribers per 1,000 views; undefined with no views. */
export function per1k(t: SubsTally): number | undefined {
  return t.views > 0 ? (t.subs / t.views) * 1000 : undefined;
}

/** Each format's videos, views and subscribers (pure). A video with no views in the window is not counted. */
export function tallyFormats(
  rows: readonly SubsRow[],
): Map<SubsFormat, SubsTally> {
  const out = new Map<SubsFormat, SubsTally>();
  for (const r of rows) {
    if (!(r.views > 0)) continue;
    const t = out.get(r.format) ?? { videos: 0, views: 0, subs: 0 };
    t.videos++;
    t.views += r.views;
    t.subs += Math.max(0, r.subs);
    out.set(r.format, t);
  }
  return out;
}

/** Whether a format has enough behind it to win or lose a slot. */
export function sampleOk(
  t: SubsTally | undefined,
  s: Pick<SubsLearnSettings, "minViews" | "minVideos">,
): boolean {
  return Boolean(t && t.views >= s.minViews && t.videos >= s.minVideos);
}

// ------------------------------------------------------------------ slots

export type FlexSlots = Record<FlexFormat, string[]>;

export interface SlotMove {
  slot: string;
  from: FlexFormat;
  to: FlexFormat;
  /** ISO instant the move was made. */
  at: string;
}

export interface SubsLearnState {
  moves: SlotMove[];
  /** ISO instant of the last change: the next may come a week later. */
  lastChangeAt?: string;
}

/** The slots after the moves, in order; a move whose slot is no longer where it was is skipped (pure). */
export function applyMoves(
  base: FlexSlots,
  moves: readonly SlotMove[],
): FlexSlots {
  const out: FlexSlots = { news: [...base.news], why: [...base.why] };
  for (const m of moves) {
    if (
      m.from === m.to ||
      !out[m.from].includes(m.slot) ||
      out[m.to].includes(m.slot)
    )
      continue;
    if (out[m.from].length <= FLEX_MIN[m.from]) continue;
    out[m.from] = out[m.from].filter((s) => s !== m.slot);
    out[m.to] = [...out[m.to], m.slot].sort();
  }
  return out;
}

/** The moves with one more, where a move that undoes an earlier one removes it instead (pure). */
export function addMove(
  moves: readonly SlotMove[],
  move: SlotMove,
): SlotMove[] {
  const undo = moves.findIndex(
    (m) => m.slot === move.slot && m.from === move.to && m.to === move.from,
  );
  return undo >= 0 ? moves.filter((_, i) => i !== undo) : [...moves, move];
}

export const WEEK_MS = 7 * 86_400_000;

export type Decision =
  | {
      kind: "move";
      move: SlotMove;
      winner: { format: FlexFormat; tally: SubsTally };
      loser: { format: FlexFormat; tally: SubsTally };
      after: FlexSlots;
    }
  | { kind: "hold"; reason: string };

/**
 * Whether to move a slot this week, and which (pure). Formats are compared over 28 days; only the flexible formats
 * still enabled (`pool`) take part. See the file header for the bounds.
 */
export function decide(input: {
  month: ReadonlyMap<SubsFormat, SubsTally>;
  base: FlexSlots;
  state: SubsLearnState;
  now: Date;
  settings: Pick<
    SubsLearnSettings,
    "minViews" | "minVideos" | "minSubs" | "lead" | "maxShift"
  >;
  pool?: readonly FlexFormat[];
  /** Slots that never leave their format (the GTA File's Why slot). */
  protectedSlots?: readonly string[];
}): Decision {
  const { month, base, state, now, settings: s } = input;
  const pool = input.pool ?? FLEX_FORMATS;
  if (
    state.lastChangeAt &&
    now.getTime() - new Date(state.lastChangeAt).getTime() < WEEK_MS
  )
    return {
      kind: "hold",
      reason: `a slot already moved on ${state.lastChangeAt.slice(0, 10)}, and only one changes a week`,
    };
  const ready = pool
    .filter((f) => sampleOk(month.get(f), s))
    .map((f) => ({
      format: f,
      tally: month.get(f)!,
      rate: per1k(month.get(f)!)!,
    }))
    .sort((a, b) => b.rate - a.rate);
  const short = pool.filter((f) => !sampleOk(month.get(f), s));
  if (ready.length < 2)
    return {
      kind: "hold",
      reason: `not enough data yet (each format needs ${s.minViews.toLocaleString("en-US")} views and ${s.minVideos} videos over 28 days; short: ${short.map((f) => SUBS_NAMES[f]).join(", ")})`,
    };
  const current = applyMoves(base, state.moves);
  const best = ready[0]!;
  if (best.tally.subs < s.minSubs)
    return {
      kind: "hold",
      reason: `${SUBS_NAMES[best.format]} leads but on only ${best.tally.subs} subscriber${best.tally.subs === 1 ? "" : "s"} (needs ${s.minSubs})`,
    };
  const protectedSlots = new Set(input.protectedSlots ?? []);
  let blocked: string | undefined;
  for (const loser of [...ready].reverse()) {
    if (loser.format === best.format) break;
    if (best.rate < s.lead * loser.rate) continue;
    const to = best.format;
    const from = loser.format;
    if (current[to].length >= base[to].length + s.maxShift) {
      blocked = `${SUBS_NAMES[to]} already has ${current[to].length} slots, the most it may have`;
      break;
    }
    if (
      current[from].length <=
      Math.max(FLEX_MIN[from], base[from].length - s.maxShift)
    ) {
      blocked = `${SUBS_NAMES[from]} is down to ${current[from].length} slot${current[from].length === 1 ? "" : "s"}, the fewest it may have`;
      continue;
    }
    const movable = current[from].filter(
      (t) => !protectedSlots.has(t) && !current[to].includes(t),
    );
    // Undo an earlier move first (the slot goes back where it was configured), else the latest slot of the day.
    const slot =
      movable.find((t) => base[to].includes(t)) ?? movable.sort().at(-1);
    if (!slot) {
      blocked = `none of ${SUBS_NAMES[from]}'s slots can move`;
      continue;
    }
    const move: SlotMove = { slot, from, to, at: now.toISOString() };
    return {
      kind: "move",
      move,
      winner: { format: to, tally: best.tally },
      loser: { format: from, tally: loser.tally },
      after: applyMoves(base, addMove(state.moves, move)),
    };
  }
  if (blocked) return { kind: "hold", reason: blocked };
  const next = ready[1]!;
  return {
    kind: "hold",
    reason: `no format is clearly ahead (${SUBS_NAMES[best.format]} ${best.rate.toFixed(1)} against ${SUBS_NAMES[next.format]} ${next.rate.toFixed(1)} per 1,000 views; a move needs ${s.lead}x)`,
  };
}

// ------------------------------------------------------------------ words

const n0 = (n: number) => Math.round(n).toLocaleString("en-US");
const rate = (t: SubsTally) => (per1k(t) ?? 0).toFixed(1);
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** The Discord line for a week's decision, in plain English (pure). */
export function decisionLine(
  d: Decision,
  apply: boolean,
  now: Date,
  timeZone: string,
): string {
  if (d.kind === "hold")
    return `📈 **Subscriber learning:** no slot moved this week: ${d.reason}.`;
  const { move, winner, loser, after } = d;
  const next = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(now.getTime() + WEEK_MS));
  const why = `Over the last 28 days ${SUBS_NAMES[winner.format]} brought ${rate(winner.tally)} subscribers per 1,000 views (${plural(winner.tally.videos, "video")}, ${n0(winner.tally.views)} views, +${winner.tally.subs}) against ${rate(loser.tally)} for ${SUBS_NAMES[loser.format]} (${plural(loser.tally.videos, "video")}, ${n0(loser.tally.views)} views, +${loser.tally.subs}).`;
  const keeps = (verb: [string, string]) =>
    `${SUBS_NAMES.news} ${verb[0]} ${plural(after.news.length, "slot")} (${after.news.join(", ")}) and ${SUBS_NAMES.why} ${verb[1]} ${plural(after.why.length, "slot")} (${after.why.join(", ")}); breaking news is never held by this.`;
  if (!apply)
    return `📈 **Subscriber learning (report only):** I would move the ${move.slot} slot from ${SUBS_NAMES[move.from]} to ${SUBS_NAMES[move.to]}. ${why} ${keeps(["would keep", "would have"])} Nothing changed: SUBS_LEARN_APPLY is off.`;
  return `📈 **Subscriber learning:** moved the ${move.slot} slot from ${SUBS_NAMES[move.from]} to ${SUBS_NAMES[move.to]}. ${why} ${keeps(["keeps", "has"])} The next change can come no sooner than ${next}.`;
}

/** One table line per format with data (pure): 7-day and 28-day subscribers per 1,000 views. */
export function subsTableLines(
  week: ReadonlyMap<SubsFormat, SubsTally>,
  month: ReadonlyMap<SubsFormat, SubsTally>,
  s: Pick<SubsLearnSettings, "minViews" | "minVideos">,
): string[] {
  const cell = (t: SubsTally | undefined) =>
    t
      ? `${per1k(t) === undefined ? "-" : rate(t)} (${n0(t.views)} views, ${plural(t.videos, "video")}, +${t.subs})`
      : "no videos";
  const shown = SUBS_FORMATS.filter((f) => week.has(f) || month.has(f));
  if (!shown.length)
    return ["👥 **Subscribers per 1,000 views, by format:** no numbers yet."];
  return [
    "👥 **Subscribers per 1,000 views, by format** (7 days | 28 days):",
    ...shown.map(
      (f) =>
        `• ${SUBS_NAMES[f]}: ${cell(week.get(f))} | ${cell(month.get(f))}${sampleOk(month.get(f), s) ? "" : " (below the sample to act on)"}`,
    ),
  ];
}

// ------------------------------------------------------------------ data

/** A row of YouTube Analytics' channel report: video id, views, subscribersGained (and more). */
export type ReportRow = Record<string, number | string>;
export type ChannelReport = (
  start: string,
  end: string,
) => Promise<ReportRow[]>;

interface EpisodeInfo {
  youtube_video_id: string;
  lane: string;
  story_hash: string | null;
  evergreen_format: string | null;
  runtime: string | null;
  live: string | null;
}

async function episodeFormats(
  db: Db,
  ids: string[],
): Promise<Map<string, SubsFormat>> {
  const out = new Map<string, SubsFormat>();
  if (!ids.length) return out;
  const rows = await db.query<EpisodeInfo>(
    `SELECT youtube_video_id, lane, story_hash, script_json->>'evergreen_format' AS evergreen_format,
            script_json->>'runtime' AS runtime, story_json->'gameplay'->>'live' AS live
       FROM episodes WHERE youtube_video_id = ANY($1::text[]) AND lane <> 'twin'`,
    [ids],
  );
  for (const r of rows) out.set(r.youtube_video_id, subsFormat(r));
  return out;
}

/** The report's rows as format rows: videos the factory did not make are left out. */
export async function rowsFromReport(
  db: Db,
  report: readonly ReportRow[],
): Promise<SubsRow[]> {
  const formats = await episodeFormats(
    db,
    report.map((r) => String(r.video ?? "")).filter(Boolean),
  );
  return report.flatMap((r) => {
    const format = formats.get(String(r.video ?? ""));
    return format
      ? [
          {
            format,
            views: Number(r.views ?? 0),
            subs: Number(r.subscribersGained ?? 0),
          },
        ]
      : [];
  });
}

/** The fallback: each video's day-four "retention" row whose numbers came in during the window. */
export async function rowsFromRetention(
  db: Db,
  from: Date,
  to: Date,
): Promise<SubsRow[]> {
  const rows = await db.query<{
    lane: string;
    story_hash: string | null;
    evergreen_format: string | null;
    runtime: string | null;
    live: string | null;
    raw: unknown;
  }>(
    `SELECT e.lane, e.story_hash, e.script_json->>'evergreen_format' AS evergreen_format,
            e.script_json->>'runtime' AS runtime, e.story_json->'gameplay'->>'live' AS live, m.raw
       FROM video_metrics m JOIN episodes e ON e.id = m.episode_id
      WHERE m.label = 'retention' AND e.lane <> 'twin' AND m.captured_at >= $1 AND m.captured_at < $2`,
    [from, to],
  );
  return rows.map((r) => {
    const raw = (typeof r.raw === "string" ? JSON.parse(r.raw) : r.raw) as {
      views?: number;
      subscribersGained?: number;
    } | null;
    return {
      format: subsFormat(r),
      views: Number(raw?.views ?? 0),
      subs: Number(raw?.subscribersGained ?? 0),
    };
  });
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface SubsWindows {
  week: Map<SubsFormat, SubsTally>;
  month: Map<SubsFormat, SubsTally>;
  source: "analytics" | "retention";
}

/**
 * The 7- and 28-day tallies: from YouTube Analytics (subscribers gained in the window, whatever the video's age) when
 * the report is there, else the day-four retention rows. Analytics lags about two days, so the windows end two days back.
 */
export async function subsWindows(
  db: Db,
  now: Date,
  report?: ChannelReport,
): Promise<SubsWindows> {
  const day = 86_400_000;
  const end = new Date(now.getTime() - 2 * day);
  if (report) {
    try {
      const [w, m] = [
        await report(ymd(new Date(end.getTime() - 6 * day)), ymd(end)),
        await report(ymd(new Date(end.getTime() - 27 * day)), ymd(end)),
      ];
      return {
        week: tallyFormats(await rowsFromReport(db, w)),
        month: tallyFormats(await rowsFromReport(db, m)),
        source: "analytics",
      };
    } catch {
      // Fall through to the rows on file.
    }
  }
  return {
    week: tallyFormats(
      await rowsFromRetention(db, new Date(now.getTime() - 7 * day), now),
    ),
    month: tallyFormats(
      await rowsFromRetention(db, new Date(now.getTime() - 28 * day), now),
    ),
    source: "retention",
  };
}

// ------------------------------------------------------------------ state and config

const STATE_KEY = "subs_learn_state";
const DUE_KEY = "subs_learn_sent";

export async function readState(db: Db): Promise<SubsLearnState> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [STATE_KEY],
  );
  try {
    const v = row ? (JSON.parse(row.value) as SubsLearnState) : undefined;
    return {
      moves: Array.isArray(v?.moves) ? v!.moves : [],
      lastChangeAt: v?.lastChangeAt,
    };
  } catch {
    return { moves: [] };
  }
}

export async function writeState(db: Db, state: SubsLearnState): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [STATE_KEY, JSON.stringify(state)],
  );
}

type SlotConfig = Pick<
  Config,
  "newsSlots" | "whySlots" | "whySlot" | "whyEnabled" | "seriesGtaFileSlot"
> & {
  subsLearn: SubsLearnSettings;
};

/** The configured slots, taken the first time the learner sees the config (before any move is applied to it). */
const BASE = new WeakMap<object, FlexSlots>();
export function baseSlots(cfg: SlotConfig): FlexSlots {
  let b = BASE.get(cfg);
  if (!b) {
    b = { news: [...cfg.newsSlots], why: [...cfg.whySlots] };
    BASE.set(cfg, b);
  }
  return b;
}

/** The formats taking part: news always, Why while its lane runs. */
export function flexPool(cfg: Pick<Config, "whyEnabled">): FlexFormat[] {
  return cfg.whyEnabled ? ["news", "why"] : ["news"];
}

/**
 * Puts the moves into the running config in place (the services share the object), or the configured slots back when
 * the learner is off or report-only. Returns the slots now in force.
 */
export function applyToConfig(
  cfg: SlotConfig,
  state: SubsLearnState,
): FlexSlots {
  const base = baseSlots(cfg);
  const on = cfg.subsLearn.enabled && cfg.subsLearn.apply && cfg.whyEnabled;
  const now = on ? applyMoves(base, state.moves) : base;
  cfg.newsSlots = [...now.news];
  cfg.whySlots = [...now.why];
  cfg.whySlot = cfg.whySlots[0] ?? cfg.whySlot;
  return now;
}

/** At boot: the saved moves back into the config. */
export async function restoreSubsLearn(
  db: Db,
  cfg: SlotConfig,
): Promise<FlexSlots> {
  return applyToConfig(
    cfg,
    cfg.subsLearn.enabled ? await readState(db) : { moves: [] },
  );
}

const RUN_HOUR = 9;

/** True once a week: Sunday from 09:00 local (an hour before the growth report), until that Sunday's run is recorded. */
export async function subsLearnDue(
  db: Db,
  cfg: Pick<Config, "timezone"> & {
    subsLearn: Pick<SubsLearnSettings, "enabled">;
  },
  now: Date,
): Promise<string | undefined> {
  if (!cfg.subsLearn.enabled || weekday(now, cfg.timezone) !== "sun")
    return undefined;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: cfg.timezone,
      hour: "2-digit",
      hour12: false,
    }).format(now),
  );
  if (hour < RUN_HOUR) return undefined;
  const key = dayKey(now, cfg.timezone);
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [DUE_KEY],
  );
  return row?.value === key ? undefined : key;
}

export async function markSubsLearnRun(db: Db, key: string): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [DUE_KEY, key],
  );
}

export interface SubsLearnOutcome {
  windows: SubsWindows;
  decision: Decision;
  applied: boolean;
  line: string;
}

/** The week's run: the numbers, the decision, the move when allowed, one line to the alerts channel, an event on file. */
export async function runSubsLearn(deps: {
  db: Db;
  cfg: SlotConfig & Pick<Config, "timezone">;
  now: Date;
  report?: ChannelReport;
  notify: (m: DiscordMessage) => Promise<unknown>;
  /** Rows the YouTube report cannot hold (meme posts live on the Community tab, Instagram and X). */
  extraRows?: () => Promise<SubsRow[]>;
  /** FUNNY_SHORTS and MEME_POSTS on trial: this week's verdicts on the month's numbers, as lines for the message. */
  trials?: (month: Map<SubsFormat, SubsTally>) => Promise<string[]>;
}): Promise<SubsLearnOutcome> {
  const { db, cfg, now } = deps;
  const s = cfg.subsLearn;
  const windows = await subsWindows(db, now, deps.report);
  const extra = (await deps.extraRows?.().catch(() => [])) ?? [];
  if (extra.length) {
    for (const [k, t] of tallyFormats(extra)) {
      windows.month.set(k, t); // 28 days: what the meme ledger holds
    }
  }
  const state = await readState(db);
  const decision = decide({
    month: windows.month,
    base: baseSlots(cfg),
    state,
    now,
    settings: s,
    pool: flexPool(cfg),
    protectedSlots: [cfg.seriesGtaFileSlot],
  });
  let applied = false;
  if (decision.kind === "move" && s.apply) {
    const next: SubsLearnState = {
      moves: addMove(state.moves, decision.move),
      lastChangeAt: now.toISOString(),
    };
    await writeState(db, next);
    applyToConfig(cfg, next);
    applied = true;
  }
  const trialLines = (await deps.trials?.(windows.month).catch(() => [])) ?? [];
  const line = [
    decisionLine(decision, s.apply, now, cfg.timezone),
    ...trialLines,
  ].join("\n");
  await logEvent(db, null, "subs_learn", {
    source: windows.source,
    week: Object.fromEntries(windows.week),
    month: Object.fromEntries(windows.month),
    decision:
      decision.kind === "move"
        ? { ...decision.move, applied }
        : { hold: decision.reason },
  });
  await deps.notify({ level: "info", content: line });
  return { windows, decision, applied, line };
}

/** The growth report's table: this Sunday's run when it is on file, else the retention rows (no API call). */
export async function subsReportLines(
  db: Db,
  now: Date,
  s: Pick<SubsLearnSettings, "minViews" | "minVideos">,
): Promise<string[]> {
  const [ev] = await db.query<{ detail: unknown }>(
    `SELECT detail FROM events WHERE kind = 'subs_learn' AND created_at > $1::timestamptz - interval '8 days' ORDER BY id DESC LIMIT 1`,
    [now],
  );
  const d = (
    typeof ev?.detail === "string" ? JSON.parse(ev.detail) : ev?.detail
  ) as
    | { week?: Record<string, SubsTally>; month?: Record<string, SubsTally> }
    | undefined;
  if (d?.week && d.month)
    return subsTableLines(
      new Map(Object.entries(d.week)) as Map<SubsFormat, SubsTally>,
      new Map(Object.entries(d.month)) as Map<SubsFormat, SubsTally>,
      s,
    );
  const w = await subsWindows(db, now);
  return subsTableLines(w.week, w.month, s);
}
