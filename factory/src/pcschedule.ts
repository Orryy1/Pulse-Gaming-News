import fs from "node:fs";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { addDays, dayKey, localTime, weekday } from "./lanes.ts";
import { errorMessage, log } from "./lib/util.ts";

/**
 * Pulse's slots, told to the PC orchestrator (C:\Claude\orchestrator) that schedules heavy work across all of
 * Martin's projects on this PC. Pulse is the project with deadlines, so each slot keeps the PC free for the
 * stretch before it: nothing long from another project (an Orryy After Effects render, say) starts if it would
 * still be running then, and Pulse's own renders inside it go to the front of the queue. A window is let go as
 * soon as its episode has rendered, or 20 minutes into its lead time if no episode took the slot.
 */

/** Statuses before the render: an episode here still needs the PC before its slot. */
const PRE_RENDER = ["selected", "scripted", "voiced"];
const DEAD = ["failed", "rejected"];
/** No episode claimed the slot this long after its lead time began: the lane had nothing to make. */
const UNCLAIMED_AFTER_MIN = 20;
/** How long before a slot the PC is kept free: a Short renders in 10-13 min, a long video in 25-40. */
const KEEP_SHORT_MIN = 75;
const KEEP_LONG_MIN = 150;
const KEEP_DOC_MIN = 180;

export interface PlannedSlot {
  lane: string;
  at: Date;
  lead: number; // minutes before the slot that production starts
  keep: number; // minutes before the slot the PC is kept free
}

export interface PcWindow {
  lane: string;
  from: string;
  until: string;
  done: boolean;
  note: string;
}

/** Every scheduled publish time in the next `hours`, lane by lane, as the selection code plans them. */
export function plannedSlots(
  cfg: Config,
  now: Date,
  hours = 12,
): PlannedSlot[] {
  const tz = cfg.timezone;
  const out: PlannedSlot[] = [];
  const today = dayKey(now, tz);
  for (const d of [today, addDays(today, 1)]) {
    const day = weekday(localTime(d, "12:00", tz), tz);
    const due: [string, string, number, number][] = []; // lane, HH:MM, lead, keep
    for (const s of cfg.newsSlots)
      due.push(["news", s, cfg.slotLeadMinutes, KEEP_SHORT_MIN]);
    if (cfg.whyEnabled && cfg.whyDays.includes(day))
      due.push(["why", cfg.whySlot, cfg.slotLeadMinutes + 30, KEEP_SHORT_MIN]);
    if (cfg.evergreenEnabled && cfg.evergreenDays.includes(day))
      due.push([
        "evergreen",
        cfg.evergreenSlot,
        cfg.slotLeadMinutes + 45,
        KEEP_SHORT_MIN,
      ]);
    if (cfg.weeklyEnabled) {
      const recap = cfg.recapDays.includes(day);
      const weekly = [
        cfg.radarDays,
        cfg.freeDays,
        cfg.climbersDays,
        cfg.achievementDays,
      ].some((ds) => ds.includes(day));
      if (recap || weekly)
        due.push([
          "weekly",
          cfg.weeklySlot,
          cfg.slotLeadMinutes + 30,
          recap && cfg.recapLong ? KEEP_LONG_MIN : KEEP_SHORT_MIN,
        ]);
    }
    if (cfg.dealsDays.includes(day))
      due.push([
        "deals",
        cfg.dealsSlot,
        cfg.slotLeadMinutes + 30,
        KEEP_SHORT_MIN,
      ]);
    if (cfg.cutdownsEnabled)
      due.push([
        "cutdown",
        cfg.cutdownSlot,
        cfg.slotLeadMinutes,
        KEEP_SHORT_MIN,
      ]);
    if (
      cfg.longformEnabled &&
      cfg.longformDays.includes(day) &&
      !cfg.longformSkip.includes(d)
    )
      due.push([
        "longform",
        cfg.longformSlot,
        cfg.slotLeadMinutes + 420,
        KEEP_LONG_MIN,
      ]);
    if (
      cfg.docEnabled &&
      cfg.docDays.includes(day) &&
      cfg.docWeeks.includes(Math.ceil(Number(d.slice(8)) / 7))
    )
      due.push(["documentary", cfg.docSlot, cfg.docLeadMinutes, KEEP_DOC_MIN]);
    for (const [lane, hhmm, lead, keep] of due) {
      const at = localTime(d, hhmm, tz);
      if (at > now && at.getTime() - now.getTime() <= hours * 3600_000)
        out.push({ lane, at, lead, keep });
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The windows to keep free: one per planned slot (released once its episode has rendered, or when no episode
 * took it), plus any episode still being made for a slot of its own (spare, gameplay) and breaking Shorts.
 */
export function pcWindows(
  cfg: Config,
  now: Date,
  episodes: { lane: string; status: string; slot_at: string | Date | null }[],
): PcWindow[] {
  const MIN = 60_000;
  const bySlot = new Map<number, string[]>();
  for (const e of episodes) {
    if (!e.slot_at || DEAD.includes(e.status)) continue;
    const t = new Date(e.slot_at).getTime();
    bySlot.set(t, [...(bySlot.get(t) ?? []), e.status]);
  }
  const out: PcWindow[] = [];
  const seen = new Set<number>();
  for (const p of plannedSlots(cfg, now)) {
    const t = p.at.getTime();
    if (seen.has(t)) continue;
    seen.add(t);
    const statuses = bySlot.get(t) ?? [];
    let done = false;
    let note = "expected";
    if (statuses.length) {
      done = !statuses.some((s) => PRE_RENDER.includes(s));
      note = done
        ? "rendered"
        : `in production (${statuses.find((s) => PRE_RENDER.includes(s))})`;
    } else if (now.getTime() > t - p.lead * MIN + UNCLAIMED_AFTER_MIN * MIN) {
      done = true;
      note = "no episode took the slot";
    }
    out.push({
      lane: p.lane,
      from: new Date(t - Math.min(p.lead, p.keep) * MIN).toISOString(),
      until: p.at.toISOString(),
      done,
      note,
    });
  }
  for (const e of episodes) {
    if (!PRE_RENDER.includes(e.status)) continue;
    if (e.slot_at) {
      const t = new Date(e.slot_at).getTime();
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({
        lane: e.lane,
        from: new Date(t - KEEP_SHORT_MIN * MIN).toISOString(),
        until: new Date(Math.max(t, now.getTime() + 15 * MIN)).toISOString(), // a slot just missed: as soon as possible
        done: false,
        note: `in production (${e.status})`,
      });
    } else if (e.lane === "news_breaking") {
      out.push({
        lane: "breaking",
        from: now.toISOString(),
        until: new Date(now.getTime() + 60 * MIN).toISOString(),
        done: false,
        note: `in production (${e.status}), publishes as soon as it's ready`,
      });
    }
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** Where the orchestrator reads reservations from; its history sits in the folder above. */
function reservationsDir(): string {
  return (
    process.env.ORCH_RESERVATIONS_DIR ||
    "C:/Claude/orchestrator/state/reservations"
  );
}

/** The episodes the windows are built from: everything before its render, and anything with a slot near now. */
async function scheduleRows(
  db: Db,
  now: Date,
): Promise<{ lane: string; status: string; slot_at: string | null }[]> {
  return db.query<{ lane: string; status: string; slot_at: string | null }>(
    `SELECT lane, status, slot_at FROM episodes
      WHERE status IN ('selected','scripted','voiced')
         OR slot_at BETWEEN $1::timestamptz - interval '3 hours' AND $1::timestamptz + interval '13 hours'`,
    [now.toISOString()],
  );
}

/** Writes the windows for the orchestrator; a no-op on a machine without it. Never throws. */
export async function publishPcSchedule(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<void> {
  const dir = reservationsDir();
  if (cfg.dryRun || !fs.existsSync(path.dirname(dir))) return;
  try {
    const rows = await scheduleRows(db, now);
    const doc = {
      project: "pulse",
      class: "heavy",
      updated: Date.now() / 1000,
      windows: pcWindows(cfg, now, rows),
    };
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "pulse.json");
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 1));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    log("warn", "PC schedule not published", { error: errorMessage(err) });
  }
}

/** Planned slots of long videos: their windows belong to the long render, never to a Short. */
const LONG_LANES = ["longform", "documentary"];

/**
 * How long a long render keeps the PC, in minutes: the slowest of its last five turns in the orchestrator's
 * history (the figure the orchestrator itself plans with; an hour at least, since preview excerpts share the
 * kind), plus 20 for the work around it (depth layers, normalising, frame checks). Two hours without history.
 */
export function longRenderMinutes(): number {
  try {
    const file = path.join(path.dirname(reservationsDir()), "history.jsonl");
    const secs = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .slice(-500)
      .flatMap((l) => {
        try {
          const r = JSON.parse(l) as {
            kind?: string;
            outcome?: string;
            seconds?: number;
          };
          return r.kind === "pulse:long" && r.outcome === "done"
            ? [Number(r.seconds) || 0]
            : [];
        } catch {
          return [];
        }
      })
      .slice(-5);
    if (secs.length) return Math.max(60, Math.max(...secs) / 60) + 20;
  } catch {
    // No orchestrator on this machine, or no history yet.
  }
  return 120;
}

/**
 * The Shorts' windows not yet released, open now or to come, soonest first: what a long render must keep out
 * of. The orchestrator gives a Pulse job the deadline of any Pulse window opening within half an hour, so a
 * long render granted then would jump the queue as if it were that Short, and a turn holding a deadline stops
 * the Short's own start at its last safe moment, so it would wait out the whole render. Long videos' own
 * windows (their planned slots, this episode's slot) are left out.
 */
export async function shortWindows(
  db: Db,
  cfg: Config,
  now: Date,
  ownSlot?: Date,
): Promise<PcWindow[]> {
  const rows = (await scheduleRows(db, now)).filter(
    (r) => r.lane !== "longform",
  );
  return pcWindows(cfg, now, rows).filter(
    (w) =>
      !w.done &&
      !LONG_LANES.includes(w.lane) &&
      Date.parse(w.until) !== ownSlot?.getTime() &&
      Date.parse(w.until) > now.getTime(),
  );
}

/** How long a Pulse turn may wait in the orchestrator's queue before the next Short's window would hand it that Short's deadline. */
export const INHERIT_MINUTES = 30;

/** A long render's turn did not come in time: it goes back to the pipeline, which waits for the next gap. */
export class PcTurnTimeout extends Error {
  override name = "PcTurnTimeout";
}
