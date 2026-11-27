// The output audit (OUTPUT_AUDIT): once a day, what each lane was planned to publish over the last week against
// what actually went public. No long video went out from 10 Nov 2026 although the factory tried several times a
// week, and nothing said so for nine days: each failure was a line in a log, never a pattern. This puts the pattern
// in one evening message: the lanes under half their plan, how long since a long video went public
// (LONG_DROUGHT_DAYS), and the failed attempts grouped by cause with a count for each.
import type { Db } from "./db.ts";
import type { Config } from "./config.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { LIVE_AT } from "./analytics.ts";
import { addDays, dayKey, localTime } from "./lanes.ts";
import { slotsOnDay } from "./pcschedule.ts";

/** The week the audit reads. */
export const AUDIT_DAYS = 7;
/** A lane under this share of its plan is flagged ("about half"). */
export const AUDIT_MIN_SHARE = 0.5;

/** The plan's lane an episode counts toward (pure), from the hash its selection gave it and its lane. */
export function auditLaneOf(e: {
  lane: string | null;
  story_hash: string;
}): string {
  const h = e.story_hash ?? "";
  if (h.startsWith("documentary:")) return "documentary";
  if (h.startsWith("longform:")) return "longform";
  if (h.startsWith("weekly:")) return "weekly";
  if (h.startsWith("daily:deals:")) return "deals";
  if (h.startsWith("why:")) return "why";
  if (h.startsWith("cutdown:") || e.lane === "cutdown") return "cutdown";
  if (h.startsWith("evergreen:")) return "evergreen";
  if (e.lane === "news") return "news";
  return e.lane || "other";
}

/**
 * Long videos, whatever lane planned them: every long video is made in the longform lane, so a long weekly recap
 * or explainer clears the long-video alarm too (the alarm is about long output stopping, not one format). Some
 * lanes publish more than the plan shows (surplus documentaries, every-game Shorts) and breaking news has no plan;
 * those count where they land and are never flagged, so a shortfall can hide behind them. Judgement calls, kept
 * simple on purpose.
 */
const LONG_SQL = `(e.lane = 'longform' OR e.script_json->>'runtime' = 'long')`;

/** Planned slots per lane whose time fell in the last `days` (pure), from the same plan the PC schedule reads. */
export function plannedCounts(
  cfg: Config,
  now: Date,
  days = AUDIT_DAYS,
): Map<string, number> {
  const out = new Map<string, number>();
  const from = now.getTime() - days * 86_400_000;
  const today = dayKey(now, cfg.timezone);
  for (let k = days; k >= 0; k--) {
    const d = addDays(today, -k);
    for (const [lane, hhmm] of slotsOnDay(cfg, d)) {
      const at = localTime(d, hhmm, cfg.timezone).getTime();
      if (at > from && at <= now.getTime())
        out.set(lane, (out.get(lane) ?? 0) + 1);
    }
  }
  return out;
}

/**
 * A failure's cause, so the same fault on different videos counts once (pure): the error's first line up to its
 * first colon (when that leaves a real phrase), with quotes, numbers and ids folded away.
 */
export function causeOf(error: string | null | undefined): string {
  const e = (error ?? "").trim();
  if (!e) return "no error recorded";
  let head = e.split(/\r?\n/)[0]!;
  const colon = head.indexOf(": ");
  if (colon >= 12) head = head.slice(0, colon);
  return head
    .replace(/"[^"]*"|“[^”]*”/g, '"..."')
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+(\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export interface AuditFailure {
  lane: string;
  title: string;
  error: string | null;
}

export interface AuditInput {
  planned: Map<string, number>;
  published: Map<string, number>;
  failures: AuditFailure[];
  /** Reasons the long ranking's topic picker gave for leaving a slot empty, newest first. */
  skips: string[];
  /** The last long video that went public. */
  lastLong?: { title: string; at: Date };
  /** The latest long attempts, newest first. */
  longAttempts: Array<{
    title: string;
    status: string;
    at: Date;
    reason: string | null;
  }>;
  droughtDays: number;
  /** A long video was planned in the alarm's window: with long videos switched off, no drought alarm. */
  longPlanned: boolean;
  timeZone: string;
}

const shortDate = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).format(d);

/** The audit's message (pure), or nothing when every lane is near its plan and long videos are going out. */
export function auditMessage(input: AuditInput, now: Date): string | undefined {
  const lanes = [...input.planned.entries()].filter(([, n]) => n > 0);
  const short = lanes.filter(
    ([lane, n]) => (input.published.get(lane) ?? 0) < n * AUDIT_MIN_SHARE,
  );
  const daysSince = input.lastLong
    ? Math.floor((now.getTime() - input.lastLong.at.getTime()) / 86_400_000)
    : undefined;
  const drought =
    input.longPlanned &&
    (daysSince === undefined || daysSince >= input.droughtDays);
  if (!short.length && !drought) return undefined;
  const lines: string[] = [`📉 **Output audit, last ${AUDIT_DAYS} days**`];
  lines.push(
    `Planned against public: ${lanes.map(([lane, n]) => `${lane} ${input.published.get(lane) ?? 0}/${n}`).join(", ") || "nothing planned"}.`,
  );
  if (short.length)
    lines.push(
      `⚠️ Under half the plan:\n${short.map(([lane, n]) => `• ${lane}: ${input.published.get(lane) ?? 0} of ${n} went public`).join("\n")}`,
    );
  if (drought) {
    const since = input.lastLong
      ? `none since "${input.lastLong.title.slice(0, 70)}" on ${shortDate(input.lastLong.at, input.timeZone)} (${daysSince} days)`
      : "none on record";
    const tries = input.longAttempts.slice(0, 5).map((a) => {
      const why =
        a.status === "failed"
          ? (a.reason ?? "no error recorded").replace(/\s+/g, " ").slice(0, 160)
          : a.status === "rejected"
            ? "rejected"
            : `still at ${a.status}`;
      return `• "${a.title.slice(0, 60)}" (${shortDate(a.at, input.timeZone)}): ${why}`;
    });
    lines.push(
      `⚠️ Long videos: ${since}; the alarm is at ${input.droughtDays} days.${tries.length ? `\nLast attempts:\n${tries.join("\n")}` : "\nNo long attempt in that time."}`,
    );
  }
  const causes = new Map<
    string,
    { n: number; lanes: Set<string>; title: string }
  >();
  for (const f of input.failures) {
    const c = causeOf(f.error);
    const g = causes.get(c) ?? {
      n: 0,
      lanes: new Set<string>(),
      title: f.title,
    };
    g.n++;
    g.lanes.add(f.lane);
    causes.set(c, g);
  }
  if (input.skips.length)
    causes.set(
      `long ranking topic picker chose nothing (latest: ${input.skips[0]!.replace(/\s+/g, " ").slice(0, 120)})`,
      {
        n: input.skips.length,
        lanes: new Set(["longform"]),
        title: "",
      },
    );
  if (causes.size)
    lines.push(
      `Failed attempts by cause:\n${[...causes.entries()]
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, 8)
        .map(
          ([c, g]) =>
            `• ${g.n}x ${c} [${[...g.lanes].sort().join(", ")}]${g.title ? `, e.g. "${g.title.slice(0, 50)}"` : ""}`,
        )
        .join("\n")}`,
    );
  return lines.join("\n\n").slice(0, 1990);
}

/** Reads the week and returns the audit's message, or nothing when there is nothing to warn about. */
export async function outputAudit(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<DiscordMessage | undefined> {
  if (!cfg.outputAudit) return undefined;
  const since = new Date(now.getTime() - AUDIT_DAYS * 86_400_000);
  const live = await db.query<{ lane: string | null; story_hash: string }>(
    `SELECT e.lane, e.story_hash FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.youtube_status IS DISTINCT FROM 'dry_run'
        AND ${LIVE_AT("e")} > $1 AND ${LIVE_AT("e")} <= $2`,
    [since, now],
  );
  const published = new Map<string, number>();
  for (const r of live) {
    const lane = auditLaneOf(r);
    published.set(lane, (published.get(lane) ?? 0) + 1);
  }
  const failed = await db.query<{
    lane: string | null;
    story_hash: string;
    title: string | null;
    last_error: string | null;
  }>(
    `SELECT e.lane, e.story_hash, coalesce(e.script_json->'youtube'->>'title', e.story_json->>'headline') AS title, e.last_error
       FROM episodes e WHERE e.status = 'failed' AND e.updated_at > $1 AND e.updated_at <= $2 ORDER BY e.updated_at DESC`,
    [since, now],
  );
  // The picker runs every tick while a slot is due: one skip per slot, not per tick.
  const skipRows = await db.query<{ id: number; reason: string | null; slot: string | null }>(
    `SELECT id, detail->>'reason' AS reason, detail->>'slot_at' AS slot FROM events WHERE kind = 'long_topic_skipped' AND created_at > $1 AND created_at <= $2 ORDER BY id DESC`,
    [since, now],
  );
  const slotsSeen = new Set<string>();
  const skips = skipRows.filter((r) => {
    const key = r.slot ?? `id:${r.id}`;
    if (slotsSeen.has(key)) return false;
    slotsSeen.add(key);
    return true;
  });
  const droughtPlan = plannedCounts(cfg, now, cfg.longDroughtDays);
  const [lastLong] = await db.query<{
    title: string | null;
    at: string | Date;
  }>(
    `SELECT coalesce(e.script_json->'youtube'->>'title', e.story_json->>'headline') AS title, ${LIVE_AT("e")} AS at
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND e.youtube_status IS DISTINCT FROM 'dry_run'
        AND ${LONG_SQL} AND ${LIVE_AT("e")} <= $1
      ORDER BY ${LIVE_AT("e")} DESC LIMIT 1`,
    [now],
  );
  const attempts = await db.query<{
    title: string | null;
    status: string;
    created_at: string | Date;
    last_error: string | null;
  }>(
    `SELECT coalesce(e.script_json->'youtube'->>'title', e.story_json->>'headline') AS title, e.status, e.created_at, e.last_error
       FROM episodes e WHERE ${LONG_SQL} AND e.status <> 'published' AND e.created_at <= $1
      ORDER BY e.created_at DESC LIMIT 5`,
    [now],
  );
  const content = auditMessage(
    {
      planned: plannedCounts(cfg, now),
      published,
      failures: failed.map((f) => ({
        lane: auditLaneOf(f),
        title: f.title ?? "",
        error: f.last_error,
      })),
      skips: skips.map((x) => x.reason ?? "").filter(Boolean),
      ...(lastLong
        ? {
            lastLong: {
              title: lastLong.title ?? "",
              at: new Date(lastLong.at),
            },
          }
        : {}),
      longAttempts: attempts
        .filter(
          (a) => !lastLong || new Date(a.created_at) > new Date(lastLong.at),
        )
        .map((a) => ({
          title: a.title ?? "",
          status: a.status,
          at: new Date(a.created_at),
          reason: a.last_error,
        })),
      droughtDays: cfg.longDroughtDays,
      longPlanned:
        (droughtPlan.get("longform") ?? 0) + (droughtPlan.get("documentary") ?? 0) > 0,
      timeZone: cfg.timezone,
    },
    now,
  );
  return content ? { content } : undefined;
}
