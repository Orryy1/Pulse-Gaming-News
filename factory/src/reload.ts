// A code reload without a hand restart. The factory runs as the "Pulse Factory" scheduled task through
// windows/run.ps1, which pulls the branch and starts src/server.ts again whenever the process exits. Until
// 30 Oct 2026 a lead restarted it by hand at a quiet moment. Now whoever deploys new code writes an empty
// file data/admin/reload-requested; once a minute the factory checks it and, when it is idle by the lead's
// own definition (no tick running, nothing uploading, no upload due, no PC-orchestrator job of ours, no
// data/admin/hold-restart flag, and more than RELOAD_MINUTES_BEFORE_SLOT minutes from the next slot), it logs
// an event, tells Discord, deletes the flag and exits with RELOAD_EXIT_CODE, which run.ps1 treats as
// "restart me now". The idle test is a pure function over the health fields and the slot times, so it is
// tested without a clock.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { DiscordMessage } from "./approval/discord.ts";
import { logEvent } from "./episodes.ts";
import { errorMessage, log } from "./lib/util.ts";
import { plannedSlots } from "./pcschedule.ts";

/** The exit code windows/run.ps1 reads as "restart straight away". */
export const RELOAD_EXIT_CODE = 75;

export const reloadFlag = (cfg: Pick<Config, "dataDir">): string =>
  path.join(cfg.dataDir, "admin", "reload-requested");
export const holdRestartFlag = (cfg: Pick<Config, "dataDir">): string =>
  path.join(cfg.dataDir, "admin", "hold-restart");

/** What the factory is doing right now, as the /health fields and the process flags say. */
export interface FactoryActivity {
  ticking: boolean; // the Shorts tick is mid-run
  longTicking: boolean; // the long-form tick is mid-run (a render, a gather)
  uploadsActive: number; // upload streams open to YouTube
  inFlight: number; // episodes an idle moment must not interrupt (see inFlightCount)
  holdRestart: boolean; // data/admin/hold-restart is present
  orchPulseJobs: number; // Pulse jobs held or queued in the PC orchestrator
}

/** The next slot inside `minutes` from now, if any (a slot already past does not count). */
export function nextSlotWithin(
  slots: Date[],
  now: Date,
  minutes: number,
): Date | undefined {
  return slots
    .filter((t) => {
      const ms = t.getTime() - now.getTime();
      return ms >= 0 && ms <= minutes * 60_000;
    })
    .sort((a, b) => a.getTime() - b.getTime())[0];
}

/**
 * Whether the factory may exit for a reload this minute, and the first reason it may not. Pure: the clock,
 * the activity and the slot times are all passed in.
 */
export function factoryIdle(
  a: FactoryActivity,
  slots: Date[],
  now: Date,
  minutesBeforeSlot: number,
): { idle: boolean; why: string } {
  if (a.holdRestart) return { idle: false, why: "hold-restart flag is set" };
  if (a.ticking) return { idle: false, why: "the Shorts tick is running" };
  if (a.longTicking)
    return {
      idle: false,
      why: "the long-form tick is running (a render or gather)",
    };
  if (a.uploadsActive > 0)
    return { idle: false, why: `${a.uploadsActive} upload(s) in progress` };
  if (a.inFlight > 0)
    return {
      idle: false,
      why: `${a.inFlight} episode(s) about to upload or mid-upload`,
    };
  if (a.orchPulseJobs > 0)
    return {
      idle: false,
      why: `${a.orchPulseJobs} Pulse job(s) in the PC orchestrator`,
    };
  const slot = nextSlotWithin(slots, now, minutesBeforeSlot);
  if (slot)
    return {
      idle: false,
      why: `a slot at ${slot.toISOString()} is under ${minutesBeforeSlot} minutes away`,
    };
  return { idle: true, why: "idle" };
}

/** Pulse's jobs in the orchestrator's state file (held leases and the queue), from its JSON text. */
export function pulseJobsIn(leasesJson: string): number {
  try {
    const j = JSON.parse(leasesJson) as {
      leases?: Array<{ project?: string }>;
      waiting?: Array<{ project?: string }>;
    };
    return [...(j.leases ?? []), ...(j.waiting ?? [])].filter(
      (x) => x.project === "pulse",
    ).length;
  } catch {
    return 0;
  }
}

/** Where the orchestrator keeps its leases (ORCH_RESERVATIONS_DIR's parent, as src/pcschedule.ts reads it). */
export function orchLeasesFile(): string {
  const dir =
    process.env.ORCH_RESERVATIONS_DIR ||
    "C:/Claude/orchestrator/state/reservations";
  return path.join(path.dirname(dir), "leases.json");
}

/**
 * Episodes a reload must wait for: one approved (its upload starts on the next tick), one uploading whose
 * next attempt is due inside five minutes (bytes may be mid-flight or about to be), one uploaded (YouTube is
 * processing it and the captions, thumbnail and pinned comment follow), and a breaking Short anywhere before
 * publish (it has no slot: it goes out as soon as it is ready).
 */
export async function inFlightCount(db: Db, now: Date): Promise<number> {
  const [row] = await db.query<{ n: string | number }>(
    `SELECT count(*) AS n FROM episodes
      WHERE status IN ('approved','uploaded')
         OR (status = 'uploading' AND (next_attempt_at IS NULL OR next_attempt_at <= $1::timestamptz + interval '5 minutes'))
         OR (lane = 'news_breaking' AND status IN ('selected','scripted','voiced','rendered','awaiting_approval'))`,
    [now.toISOString()],
  );
  return Number(row?.n ?? 0);
}

/** The slots ahead: every lane's planned publish times plus live episodes' own slots and publish times. */
export async function slotTimes(
  db: Db,
  cfg: Config,
  now: Date,
): Promise<Date[]> {
  const planned = plannedSlots(cfg, now, 3).map((p) => p.at);
  const rows = await db.query<{ t: string }>(
    `SELECT t FROM (
       SELECT slot_at AS t FROM episodes WHERE status NOT IN ('published','failed','rejected')
       UNION ALL
       SELECT publish_at AS t FROM episodes WHERE status NOT IN ('published','failed','rejected')
     ) x WHERE t IS NOT NULL AND t BETWEEN $1::timestamptz AND $1::timestamptz + interval '3 hours'`,
    [now.toISOString()],
  );
  return [...planned, ...rows.map((r) => new Date(r.t))];
}

export interface ReloadDeps {
  db: Db;
  cfg: Config;
  now: Date;
  /** The process flags: whether a tick is mid-run and how many upload streams are open. */
  activity(): { ticking: boolean; longTicking: boolean; uploadsActive: number };
  notify(msg: DiscordMessage): Promise<unknown>;
  /** Ends the process; the real one is process.exit. */
  exit(code: number): void;
  leasesFile?: string;
  /** Kept between calls so a waiting reload is logged once per reason, not every minute. */
  state?: { lastWhy?: string };
}

/**
 * The once-a-minute check: nothing without the flag; with it, exits with RELOAD_EXIT_CODE the first idle
 * minute. Returns true when the process is on its way out. A flag that cannot be deleted stops the reload
 * (otherwise the fresh process would exit again at once, for ever).
 */
export async function maybeReload(deps: ReloadDeps): Promise<boolean> {
  const flag = reloadFlag(deps.cfg);
  if (!(await exists(flag))) return false;
  const act = deps.activity();
  const leases = await fs
    .readFile(deps.leasesFile ?? orchLeasesFile(), "utf8")
    .catch(() => "");
  const activity: FactoryActivity = {
    ...act,
    inFlight: await inFlightCount(deps.db, deps.now),
    holdRestart: await exists(holdRestartFlag(deps.cfg)),
    orchPulseJobs: pulseJobsIn(leases),
  };
  const slots = await slotTimes(deps.db, deps.cfg, deps.now);
  const r = factoryIdle(
    activity,
    slots,
    deps.now,
    deps.cfg.reloadMinutesBeforeSlot,
  );
  if (!r.idle) {
    if (deps.state && deps.state.lastWhy !== r.why) {
      deps.state.lastWhy = r.why;
      log("info", "reload requested; waiting", { why: r.why });
    }
    return false;
  }
  try {
    await fs.rm(flag, { force: true });
    if (await exists(flag)) throw new Error("flag still present");
  } catch (err) {
    log("error", "reload flag could not be removed; not restarting", {
      error: errorMessage(err),
    });
    if (deps.state && deps.state.lastWhy !== "flag stuck") {
      deps.state.lastWhy = "flag stuck";
      await deps.notify({
        content: `⚠️ Pulse Factory was asked to reload (data/admin/reload-requested) but cannot delete the flag, so it keeps running the old code. Remove the file by hand and write it again.`,
      });
    }
    return false;
  }
  const next = slots
    .filter((t) => t > deps.now)
    .sort((a, b) => a.getTime() - b.getTime())[0];
  await logEvent(deps.db, null, "reload", {
    why: "data/admin/reload-requested",
    next_slot: next?.toISOString() ?? null,
  });
  log("info", "reloading for new code", { nextSlot: next?.toISOString() });
  await deps.notify({
    content: `🔁 Pulse Factory is restarting to load new code (asked by data/admin/reload-requested). Nothing was in flight${next ? `; the next slot is at ${next.toISOString().slice(11, 16)} UTC` : ""}. Back in about a minute.`,
  });
  await deps.db.close();
  deps.exit(RELOAD_EXIT_CODE);
  return true;
}

async function exists(file: string): Promise<boolean> {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false);
}
