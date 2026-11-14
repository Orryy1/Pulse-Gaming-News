// The weekly job (STREAM_WEEKLY): once a week, STREAM_WEEKLY_MAKE_HOURS before the slot (STREAM_WEEKLY_DAY at
// STREAM_WEEKLY_SLOT), the week's recordings of the game become the compilation. The week covered is the seven days
// before the slot's day; it is Week N counted from STREAM_WEEKLY_START (Day 1). Recordings are found the way the VOD
// miner finds them (VOD_MINER_DIR) and need the miner's stream index; one not indexed yet is left out and named.
// With STREAM_WEEKLY_UPLOAD the video goes up private, scheduled for the slot, with the Day N links and the pinned
// comment; otherwise the file and the package are handed over in Discord. Each week is done once: the state file
// (data/streamweekly/state.json) remembers it, and a restart picks up where it left off.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { Llm } from "../editorial/llm.ts";
import { errorMessage, log } from "../lib/util.ts";
import { addDays, dayKey, localTime, weekday } from "../lanes.ts";
import { postDiscord } from "../approval/discord.ts";
import { narrate } from "../voice/index.ts";
import { listRecordings, detectGame } from "../vodindex/vods.ts";
import { loadSceneIndex } from "../sceneindex/schema.ts";
import { spoilerWindows } from "../sceneindex/spoilers.ts";
import { claimedDays, dailySeries, GTA_DAILY_PLAYLIST } from "../gtadaily.ts";
import { YouTubeClient, buildResource, markerTag } from "../youtube/upload.ts";
import { weekNumber } from "./chapters.ts";
import {
  compileWeek,
  gatherStream,
  readyIndex,
  spoilerRule,
  weeklyDir,
} from "./build.ts";
import { checkWeekRender, renderWeek } from "./render.ts";
import type { DayLink } from "./timeline.ts";
import type { StreamWeeklySettings } from "./settings.ts";

export interface WeekSlot {
  /** Local YYYY-MM-DD of the slot. */
  date: string;
  at: Date;
  week: number;
  /** The recordings' dates it covers. */
  from: string;
  to: string;
}

/** The next weekly slot at or after `now` minus the grace (pure): the slot's day and time, its week and the dates covered. */
export function nextWeekSlot(
  s: Pick<StreamWeeklySettings, "day" | "slot" | "start">,
  now: Date,
  timeZone: string,
  graceHours = 2,
): WeekSlot | undefined {
  const today = dayKey(now, timeZone);
  for (let i = -1; i <= 7; i++) {
    const date = addDays(today, i);
    const at = localTime(date, s.slot, timeZone);
    if (weekday(at, timeZone) !== s.day) continue;
    if (at.getTime() < now.getTime() - graceHours * 3_600_000) continue;
    const to = addDays(date, -1);
    const week = weekNumber(s.start, to);
    if (week < 1) return undefined;
    return { date, at, week, from: addDays(date, -7), to };
  }
  return undefined;
}

/** True when it is time to make the slot's week (pure): inside the make window, and not done yet. */
export function weekDue(
  slot: WeekSlot,
  now: Date,
  makeHours: number,
  done: ReadonlySet<number>,
): boolean {
  if (done.has(slot.week)) return false;
  const t = now.getTime();
  return (
    t >= slot.at.getTime() - makeHours * 3_600_000 &&
    t < slot.at.getTime() + 2 * 3_600_000
  );
}

interface WeekState {
  weeks: Record<
    string,
    {
      status: string;
      at: string;
      file?: string;
      videoId?: string;
      note?: string;
    }
  >;
  /** Failed attempts per week: after MAX_TRIES the week is marked failed and the owner told. */
  tries?: Record<string, number>;
}

export const MAX_TRIES = 2;

async function readState(dataDir: string): Promise<WeekState> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(weeklyDir(dataDir), "state.json"), "utf8"),
    ) as WeekState;
  } catch {
    return { weeks: {} };
  }
}

async function writeState(dataDir: string, s: WeekState): Promise<void> {
  await fs.mkdir(weeklyDir(dataDir), { recursive: true });
  const file = path.join(weeklyDir(dataDir), "state.json");
  await fs.writeFile(`${file}.tmp`, JSON.stringify(s, null, 1));
  await fs.rename(`${file}.tmp`, file);
}

/** The Day N Shorts already out, for the description's day-by-day list. */
async function dayLinks(db: Db | undefined): Promise<DayLink[]> {
  if (!db) return [];
  try {
    const days = await claimedDays(db);
    const ids = [...days.values()];
    if (!ids.length) return [];
    const rows = await db.query<{
      id: string;
      video_id: string;
      title: string | null;
    }>(
      `SELECT id, youtube_video_id AS video_id, script_json->'youtube'->>'title' AS title FROM episodes WHERE id = ANY($1) AND status = 'published' AND youtube_video_id IS NOT NULL`,
      [ids],
    );
    return [...days.entries()].flatMap(([day, ep]) => {
      const r = rows.find((x) => x.id === ep);
      return r
        ? [{ day, videoId: r.video_id, title: r.title ?? `Day ${day}` }]
        : [];
    });
  } catch (err) {
    log("warn", "stream weekly: day links not read", {
      error: errorMessage(err),
    });
    return [];
  }
}

let busy = false;

export interface WeeklyDeps {
  db?: Db;
  llm?: Llm;
  /** The YouTube login, for STREAM_WEEKLY_UPLOAD. */
  youtubeToken?: () => Promise<string>;
  now?: () => Date;
}

/** One pass: nothing unless a week is due; then the whole week, start to finish. Never throws. */
export async function streamWeeklyTick(
  cfg: Config,
  d: WeeklyDeps = {},
): Promise<void> {
  const s = cfg.streamWeekly;
  if (!s.enabled || busy) return;
  busy = true;
  try {
    const now = d.now?.() ?? new Date();
    const slot = nextWeekSlot(s, now, cfg.timezone);
    const state = await readState(cfg.dataDir);
    const done = new Set(Object.keys(state.weeks).map(Number));
    if (!slot || !weekDue(slot, now, s.makeHours, done)) return;
    const say = (title: string, description: string) =>
      postDiscord(cfg.discordWebhookUrl, {
        embeds: [
          { title, description: description.slice(0, 3900), color: 0xff6b1a },
        ],
      });

    const recordings = (
      await listRecordings(s.vodDir, [s.game, ...cfg.ownerGames])
    )
      .filter((r) => r.recordedOn >= slot.from && r.recordedOn <= slot.to)
      .filter((r) => (r.game ?? detectGame(r.title, [s.game])) === s.game);
    const streams = [];
    const missing: string[] = [];
    for (const r of recordings) {
      const v = await readyIndex(cfg.dataDir, r.vodId);
      if (!v) {
        missing.push(`${r.recordedOn} ${r.title}`);
        continue;
      }
      streams.push(await gatherStream(v, { dataDir: cfg.dataDir, now }));
    }
    // A week whose recordings are still being indexed waits, until the last six hours before the slot.
    if (missing.length && now.getTime() < slot.at.getTime() - 6 * 3_600_000) {
      log("info", "stream weekly: waiting for the stream index", {
        week: slot.week,
        missing,
      });
      return;
    }
    const outDir = path.join(weeklyDir(cfg.dataDir), `week-${slot.week}`);
    const scene = await loadSceneIndex(cfg.dataDir, s.game).catch(
      () => undefined,
    );
    const rule = spoilerRule({
      game: s.game,
      start: s.start,
      days: cfg.spoilerWindowDays || 28,
      live: spoilerWindows(),
      now,
      scene,
    });
    const days = await dayLinks(d.db);
    let playlistId: string | undefined;
    const yt =
      s.upload && d.youtubeToken
        ? new YouTubeClient(d.youtubeToken)
        : undefined;
    if (yt) {
      const series = dailySeries();
      playlistId = await yt
        .findOrCreatePlaylist(series.title, series.description)
        .then((p) => p.id)
        .catch(() => undefined);
    }
    const r = await compileWeek({
      game: s.game,
      week: slot.week,
      start: s.start,
      streams,
      outDir,
      minSeconds: s.minMinutes * 60,
      maxSeconds: s.maxMinutes * 60,
      minMoments: s.minMoments,
      llm: d.llm,
      voice: async (key, text, file) => {
        const n = await narrate(cfg, text, file);
        return { key, file, seconds: n.durationSeconds, text, words: n.words };
      },
      render: (tl, o) =>
        renderWeek({
          episodeDir: o.episodeDir,
          timeline: tl,
          game: s.game,
          outFile: o.file,
          posterFile: o.poster,
          endLine: o.endLine,
          next: o.next,
          concurrency: cfg.remotionConcurrency,
          gl: cfg.remotionGl,
          browserExecutable: cfg.browserExecutable || undefined,
        }),
      check: checkWeekRender,
      spoiler: rule,
      days,
      ...(playlistId ? { playlistId } : {}),
      now,
    });
    if (r.status !== "rendered" || !r.video || !r.pkg) {
      state.weeks[slot.week] = {
        status: "skipped",
        at: now.toISOString(),
        note: (r.why ?? []).join("; "),
      };
      await writeState(cfg.dataDir, state);
      await say(
        `Week ${slot.week} compilation skipped`,
        `${(r.why ?? []).join("\n")}${missing.length ? `\nNot indexed yet: ${missing.join(", ")}` : ""}`,
      );
      return;
    }
    let videoId: string | undefined;
    // A render that fails its measurements is never uploaded: it is handed over with what is wrong.
    const failedChecks = r.check && !r.check.ok ? r.check.problems : [];
    if (yt && !failedChecks.length) {
      const resource = buildResource(
        {
          title: r.pkg.title,
          description: r.pkg.description,
          tags: r.pkg.tags,
          categoryId: "20",
          privacyStatus: "public",
          publishAt: slot.at.toISOString(),
          containsSyntheticMedia: true,
          defaultLanguage: "en",
        },
        markerTag(`streamweekly${slot.week}`),
      );
      const size = (await fs.stat(r.video)).size;
      videoId = await yt.uploadToSession(
        await yt.createSession(resource, size),
        r.video,
      );
      await yt
        .setThumbnail(videoId, path.join(outDir, "poster.jpg"))
        .catch((e) =>
          log("warn", "stream weekly: thumbnail not set", {
            error: errorMessage(e),
          }),
        );
      await yt
        .insertComment(videoId, r.pkg.pinnedComment)
        .catch((e) =>
          log("warn", "stream weekly: comment not posted", {
            error: errorMessage(e),
          }),
        );
    }
    state.weeks[slot.week] = {
      status: videoId ? "uploaded" : "rendered",
      at: now.toISOString(),
      file: r.video,
      ...(videoId ? { videoId } : {}),
    };
    await writeState(cfg.dataDir, state);
    await say(
      `${r.pkg.title}: ${videoId ? `scheduled for ${slot.date} ${s.slot}` : "ready"}`,
      [
        videoId
          ? `https://youtu.be/${videoId} (private until the slot)`
          : `File on the factory machine: ${r.video}`,
        `${Math.round((r.timeline?.seconds ?? 0) / 60)} min, ${r.plan.chapters.map((c) => `${c.title} (${c.moments.length})`).join(", ")}`,
        missing.length ? `Not indexed in time: ${missing.join(", ")}` : "",
        failedChecks.length ? `Not uploaded, the render check found: ${failedChecks.join("; ")}` : "",
        `Every day playlist: "${GTA_DAILY_PLAYLIST}"`,
        "",
        r.pkg.description.slice(0, 1500),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    log("warn", "stream weekly: pass failed", { error: errorMessage(err) });
    try {
      const now = d.now?.() ?? new Date();
      const slot = nextWeekSlot(s, now, cfg.timezone);
      if (slot) {
        const state = await readState(cfg.dataDir);
        const tries = (state.tries ??= {});
        tries[slot.week] = (tries[slot.week] ?? 0) + 1;
        if (tries[slot.week]! >= MAX_TRIES) {
          state.weeks[slot.week] = { status: "failed", at: now.toISOString(), note: errorMessage(err).slice(0, 300) };
          await postDiscord(cfg.discordWebhookUrl, { embeds: [{ title: `Week ${slot.week} compilation failed`, description: errorMessage(err).slice(0, 1500), color: 0xff3b3b }] });
        }
        await writeState(cfg.dataDir, state);
      }
    } catch {
      /* the log line above is enough */
    }
  } finally {
    busy = false;
  }
}
