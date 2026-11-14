// The flight simulator (src/flightsim): the factory's own scheduler loop, lanes, slots, steps, uploads and alerts,
// run against a sandbox database and the stubbed world on a simulated clock, so a week passes in minutes. It is a
// tool: nothing here runs inside the live factory, and it never reaches the real network or spends a paid call.
//
// The loop mirrors src/server.ts: boot clears leases; every TICK_MINUTES the Shorts tick, then the long lane; every
// quarter hour the output watch. A restart fault leaves the step under it hanging, as a dying process does, and
// boots again three minutes later with the database as it was left.

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Config } from "../config.ts";
import { testConfig } from "../../tests/helpers.ts";
import { tick, tickLong, type Services } from "../pipeline.ts";
import { quietAlert } from "../outputwatch.ts";
import {
  setSpoilerWindows,
  spoilerWindow,
  type SpoilerWindow,
} from "../sceneindex/spoilers.ts";
import { SimClock, installClock, uninstallClock } from "./clock.ts";
import { simDb, type SimDb } from "./simdb.ts";
import { createWorld, strayFetch, type World } from "./world.ts";
import { faultSchedule, type FaultWindow } from "./faults.ts";
import {
  checkAll,
  type InvariantResult,
  type SimEpisode,
  type SimRecord,
} from "./invariants.ts";

export interface SimOptions {
  days: number;
  faults: string[];
  start?: Date;
  seed?: number;
  /** Settings over the production-like profile (tests use this to try one rule). */
  overrides?: Partial<Config>;
  maxSilentHours?: number;
  /** Progress lines, one a simulated day. */
  onDay?: (line: string) => void;
}

export interface SimResult {
  record: SimRecord;
  results: InvariantResult[];
  ok: boolean;
  stats: {
    realSeconds: number;
    ticks: number;
    longTicks: number;
    restarts: number;
    episodes: Record<string, number>;
    published: number;
    notices: number;
    llmCalls: number;
    queries: number;
    voices: Record<string, number>;
    codexFallbacks: number;
    strayHosts: Record<string, number>;
    unknownSchemas: Record<string, number>;
  };
}

/** The live factory's lanes and rules as the Mac runs them (its .env, 14 Nov 2026), on the test harness's safe base. */
export function simProfile(
  dataDir: string,
  overrides: Partial<Config> = {},
): Config {
  return testConfig(dataDir, {
    timezone: "Europe/London",
    newsSlots: ["17:00"],
    dailyTarget: 5, // SHORTS_PER_DAY=5 on the Mac (it wins over DAILY_TARGET)
    shortsPerDayMax: 5,
    minUploadGapMinutes: 60,
    breakingEnabled: true,
    breakingPerDay: 1,
    breakingScoreMin: 75,
    breakingMaxAgeMinutes: 90,
    breakingWindow: "07:00-03:00",
    includeRumours: true,
    rumoursPerDay: 2,
    approvalMode: "auto",
    maxProducing: 2,
    maxAttempts: 3,
    tickMinutes: 10,
    evergreenEnabled: true,
    evergreenDays: ["mon", "tue", "thu", "sat"],
    evergreenApprovalMode: "auto",
    evergreenSlot: "20:00",
    whyEnabled: true,
    whyDays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    whySlots: ["12:00", "18:30", "22:00"],
    whySlot: "12:00",
    whyFreshDays: 14,
    longformEnabled: true,
    longformDays: ["sat"],
    longformSlot: "17:00",
    longformApprovalMode: "auto",
    spoilerGuard: true,
    writerNotesGuard: true,
    codexLlm: true,
    codexCalls: ["factcheck", "clarity", "search"],
    voiceProvider: "elevenlabs-first",
    youtubePrivacy: "public",
    uploadRetryMinutes: 10,
    uploadMoves: 1,
    ...overrides,
  });
}

/** GTA VI in its spoiler window across the run, as SPOILER_GUARD has it from launch. */
export function simSpoilerWindows(start: Date, days: number): SpoilerWindow[] {
  // Built as the server builds them (aliases include the full name), so the writers' guard sees what it sees live.
  const w = spoilerWindow("Grand Theft Auto VI", new Date(start.getTime() - 86_400_000).toISOString(), {
    days: days + 28,
    openingShare: 0.1,
    lateTerms: ["Port Gellhorn"],
  });
  return w ? [w] : [];
}

async function readEpisodes(db: SimDb): Promise<SimEpisode[]> {
  const rows = await db.query<{
    id: string;
    lane: string;
    status: string;
    slot_at: Date | null;
    publish_at: Date | null;
    created_at: Date;
    updated_at: Date;
    last_error: string | null;
    youtube_video_id: string | null;
    story_json: {
      headline?: string;
      rumourSignals?: boolean;
      bigStory?: unknown;
    } | null;
    script_json: { headline?: string; is_rumour?: boolean } | null;
  }>(
    `SELECT id, lane, status, slot_at, publish_at, created_at, updated_at, last_error, youtube_video_id, story_json, script_json FROM episodes ORDER BY created_at`,
  );
  const evs = await db.query<{ episode_id: string; kind: string; created_at: Date; detail: unknown }>(
    `SELECT episode_id, kind, created_at, detail FROM events WHERE episode_id IS NOT NULL ORDER BY id`,
  );
  const byEp = new Map<string, Array<{ at: string; kind: string; detail: string }>>();
  for (const e of evs)
    byEp.set(e.episode_id, [
      ...(byEp.get(e.episode_id) ?? []),
      { at: new Date(e.created_at).toISOString(), kind: e.kind, detail: JSON.stringify(e.detail ?? {}).slice(0, 200) },
    ]);
  const iso = (d: Date | string | null) =>
    d ? new Date(d).toISOString() : null;
  return rows.map((r) => ({
    id: r.id,
    lane: r.lane,
    status: r.status,
    slot_at: iso(r.slot_at),
    publish_at: iso(r.publish_at),
    created_at: iso(r.created_at)!,
    updated_at: iso(r.updated_at)!,
    last_error: r.last_error,
    youtube_video_id: r.youtube_video_id,
    headline: r.script_json?.headline ?? r.story_json?.headline ?? r.id,
    rumour: r.script_json
      ? r.script_json.is_rumour === true
      : r.story_json?.rumourSignals === true,
    big: Boolean(r.story_json && "bigStory" in r.story_json),
    script: r.script_json,
    events: byEp.get(r.id) ?? [],
  }));
}

/** Waits for a pass to finish, or for a crash fault to leave it hanging (then it is abandoned, as a dead process is). */
async function runPass(
  world: World,
  job: Promise<unknown>,
): Promise<"done" | "crashed"> {
  let done = false;
  let failed: unknown;
  job.then(
    () => (done = true),
    (err) => {
      done = true;
      failed = err;
    },
  );
  for (;;) {
    if (done) {
      if (failed) throw failed;
      return "done";
    }
    if (world.crashPending()) return "crashed";
    await new Promise((r) => setImmediate(r));
  }
}

export async function runFlightSim(o: SimOptions): Promise<SimResult> {
  const realStart = performance.now();
  const start = o.start ?? new Date("2026-11-16T00:00:00Z");
  const end = new Date(start.getTime() + o.days * 86_400_000);
  const clock = new SimClock(start);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-flightsim-"));
  const cfg = simProfile(dir, o.overrides);
  const faults: FaultWindow[] = faultSchedule(o.faults, start, o.days);
  const world = createWorld({ clock, faults, cfg, seed: o.seed ?? 1 });
  const windows = simSpoilerWindows(start, o.days);
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const realErr = console.error;
  const crashes: SimRecord["crashes"] = [];
  let ticks = 0;
  let longTicks = 0;
  let restarts = 0;
  installClock(clock);
  globalThis.fetch = strayFetch(world.log);
  // The factory logs a line per step; the run's own report is what matters here.
  if (!process.env.FLIGHTSIM_VERBOSE) {
    console.log = () => undefined;
    console.error = () => undefined;
  }
  setSpoilerWindows(windows);
  const db = await simDb(clock);
  try {
    const boot = async (): Promise<Services> => {
      await db.query(`DELETE FROM leases`);
      return world.services(db);
    };
    let s = await boot();
    const step = cfg.tickMinutes * 60_000;
    let nextWatch = start.getTime();
    let lastDay = "";
    while (clock.millis < end.getTime()) {
      const passStart = clock.millis;
      const crashed = async (where: string) => {
        const inFlight = (
          await db.query<{ id: string }>(
            `SELECT id FROM episodes WHERE status IN ('selected','scripted','voiced','rendered','awaiting_approval','approved','uploading','uploaded')`,
          )
        ).map((r) => r.id);
        crashes.push({
          at: clock.now().toISOString(),
          where: world.crashPending() ?? where,
          inFlight,
        });
        world.clearCrash();
        restarts++;
        clock.advance(3 * 60_000); // launchd brings it back
        s = await boot();
      };
      ticks++;
      if ((await runPass(world, tick(s))) === "crashed") await crashed("tick");
      longTicks++;
      if ((await runPass(world, tickLong(s))) === "crashed")
        await crashed("long tick");
      if (clock.millis >= nextWatch) {
        const text = await quietAlert(db, clock.now(), cfg.timezone, {
          slots: [...cfg.newsSlots, ...(cfg.whyEnabled ? cfg.whySlots : [])],
          dailyTarget: cfg.dailyTarget,
        }).catch(
          () => undefined,
        );
        if (text) await s.notify({ content: text });
        nextWatch = clock.millis + 15 * 60_000;
      }
      const day = clock.now().toISOString().slice(0, 10);
      if (day !== lastDay) {
        lastDay = day;
        const [n] = await db.query<{ n: string }>(
          `SELECT count(*) AS n FROM episodes WHERE status = 'published'`,
        );
        o.onDay?.(
          `${day}: ${n?.n ?? 0} published so far, ${world.log.notices.length} notices, faults now: ${world.faultsNow().join(", ") || "none"}`,
        );
      }
      // The next pass starts a tick after this one started, or at once if this one ran long (as setInterval with
      // the running guard behaves).
      clock.set(new Date(Math.max(passStart + step, clock.millis)));
    }
    const episodes = await readEpisodes(db);
    const record: SimRecord = {
      start: start.toISOString(),
      end: end.toISOString(),
      cfg: {
        timezone: cfg.timezone,
        newsSlots: cfg.newsSlots,
        whySlots: cfg.whySlots,
        whyEnabled: cfg.whyEnabled,
        dailyTarget: cfg.dailyTarget,
        shortsPerDayMax: cfg.shortsPerDayMax,
        breakingPerDay: cfg.breakingPerDay,
        breakingBigScore: cfg.breakingBigScore,
        rumoursPerDay: cfg.rumoursPerDay,
        minUploadGapMinutes: cfg.minUploadGapMinutes,
        breakingWindow: cfg.breakingWindow,
      },
      faults,
      episodes,
      notices: world.log.notices,
      videos: world.log.videos,
      crashes,
      spoilerWindows: windows,
      maxSilentHours: o.maxSilentHours ?? 30,
    };
    const results = checkAll(record);
    const statuses: Record<string, number> = {};
    for (const e of episodes)
      statuses[e.status] = (statuses[e.status] ?? 0) + 1;
    return {
      record,
      results,
      ok: results.every((r) => r.ok),
      stats: {
        realSeconds: Math.round((performance.now() - realStart) / 100) / 10,
        ticks,
        longTicks,
        restarts,
        episodes: statuses,
        published: statuses.published ?? 0,
        notices: world.log.notices.length,
        llmCalls: world.log.llmCalls,
        queries: db.queries(),
        voices: world.log.voices,
        codexFallbacks: world.log.codexFallbacks,
        strayHosts: world.log.strayHosts,
        unknownSchemas: world.log.unknownSchemas,
      },
    };
  } finally {
    setSpoilerWindows([]);
    globalThis.fetch = realFetch;
    console.log = realLog;
    console.error = realErr;
    uninstallClock();
    await db.close().catch(() => undefined);
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
