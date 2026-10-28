// Read-only pages and done-records for the Studio browser routines (the Claude scheduled tasks
// pulse-youtube-community, pulse-related-video-links, pulse-studio-abtest and pulse-weekly-poll).
// A scheduled run cannot answer a shell approval prompt, so every step it takes is a browser step:
// it opens http://127.0.0.1:8080/routine/... in a tab and reads the JSON, and records progress by
// opening /routine/done?kind=...&key=.... These pages are for this PC only: the Cloudflare tunnel
// also arrives from 127.0.0.1, so anything that carries a proxy header is refused as if the page did
// not exist. Nothing here needs or shows a secret.

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import type { EvergreenCandidate } from "./editorial/evergreen.ts";
import { logEvent } from "./episodes.ts";
import { dayKey, weekday } from "./lanes.ts";
import { YTDLP_TEXT } from "./lib/bin.ts";
import { errorMessage, log } from "./lib/util.ts";
import { pollPlan, readPoll, recordPollResult } from "./social/poll.ts";

const run = promisify(execFile);

// ------------------------------------------------------------------ the guard

const LOOPBACK_ADDR =
  /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const PROXY_HEADERS = [
  "cdn-loop",
  "x-forwarded-for",
  "x-forwarded-host",
  "forwarded",
  "x-real-ip",
];

/**
 * A request from this PC's own browser: a loopback socket, a loopback Host and no Cloudflare or proxy
 * header (the tunnel connects from 127.0.0.1 too, but always adds cf-ray and cdn-loop). Sec-Fetch-Site
 * cannot help: the browser extension's own navigations arrive as "cross-site" (checked in Brave, 28 Oct 2026).
 */
export function routineAllowed(
  req: Pick<http.IncomingMessage, "headers" | "socket">,
): boolean {
  if (!LOOPBACK_ADDR.test(req.socket?.remoteAddress ?? "")) return false;
  if (!LOOPBACK_HOST.test(String(req.headers.host ?? ""))) return false;
  for (const h of Object.keys(req.headers))
    if (h.startsWith("cf-") || PROXY_HEADERS.includes(h)) return false;
  return true;
}

// ------------------------------------------------------------------ done records

const VIDEO_ID = /^[\w-]{11}$/;
// Hearted comments are "author|first 60 characters": any printable text, no control characters.
const HEARTED = /^[^\p{C}]{1,120}$/u;

const validDay = (k: string) => {
  const d = new Date(`${k}T12:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(k) &&
    !Number.isNaN(d.getTime()) &&
    d.toISOString().slice(0, 10) === k
  );
};

/** Each routine's ledger: a JSON array of keys under the data folder. */
export const DONE_KINDS = {
  community: { file: ["admin", "community_done.json"], valid: validDay },
  related: {
    file: ["admin", "related_done.json"],
    valid: (k: string) => VIDEO_ID.test(k),
  },
  abtest: {
    file: ["abtests", "done.json"],
    valid: (k: string) => VIDEO_ID.test(k),
  },
  hearted: {
    file: ["admin", "comments_hearted.json"],
    valid: (k: string) => HEARTED.test(k) && /\S/.test(k),
  },
  poll: { file: ["admin", "poll_done.json"], valid: validDay },
} as const;
export type DoneKind = keyof typeof DONE_KINDS;

export function validDoneKey(kind: string, key: string): kind is DoneKind {
  return (
    Object.hasOwn(DONE_KINDS, kind) && DONE_KINDS[kind as DoneKind].valid(key)
  );
}

const doneFile = (cfg: Config, kind: DoneKind) =>
  path.join(cfg.dataDir, ...DONE_KINDS[kind].file);

/** A ledger's keys; a missing file is empty, an unreadable one is an error (never overwritten). */
function readList(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const list = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(list))
    throw new Error(`${path.basename(file)} is not a list`);
  return list.map(String);
}

/** Adds the keys not already there (synchronously, so two requests never interleave). */
export function appendDone(
  cfg: Config,
  kind: DoneKind,
  keys: string[],
): { added: string[]; already: string[] } {
  const file = doneFile(cfg, kind);
  const list = readList(file);
  const added = [...new Set(keys)].filter((k) => !list.includes(k));
  const already = keys.filter((k) => list.includes(k));
  if (added.length) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      `${file}.tmp`,
      JSON.stringify([...list, ...added], null, 2),
      "utf8",
    );
    fs.renameSync(`${file}.tmp`, file);
  }
  return { added, already };
}

// ------------------------------------------------------------------ related videos

export interface RelatedRow {
  id: string;
  lane: string;
  youtube_video_id: string | null;
  live_at: string | null;
  script_json?: {
    game_title?: string;
    headline?: string;
    runtime?: string;
    youtube?: { title?: string };
    cutdown?: { parent_video?: string };
  } | null;
}
export interface LongVideo {
  id: string;
  title: string;
}
export interface RelatedItem {
  short: string;
  title: string;
  target: string;
  targetTitle: string;
  reason: string;
}

/** Long videos on the channel, newest first (the factory's own episodes miss older uploads). No API quota: yt-dlp reads the public page. */
export async function channelLongs(): Promise<LongVideo[]> {
  const { stdout } = await run(
    process.env.YTDLP_PATH || "yt-dlp",
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--flat-playlist",
      "--playlist-end",
      "30",
      "--print",
      "%(id)s\t%(duration)s\t%(title)s",
      "https://www.youtube.com/channel/UCvgNDjtTezrpxL8oUe6mYwA/videos",
    ],
    {
      encoding: "utf8",
      env: YTDLP_TEXT.env,
      timeout: 120_000,
      maxBuffer: 4 << 20,
    },
  );
  return stdout
    .split("\n")
    .map((l) => l.replace(/\r$/, "").split("\t"))
    .filter(
      (p) => p.length === 3 && Number(p[1]) >= 180 && Number(p[1]) < 3 * 3600,
    )
    .map(([id, , title]) => ({ id: id!, title: title! }));
}

// Series words: a Short about "Call of Duty 4" matches the long "Call of Duty Campaigns Ranked".
const series = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !/^(ranked|worst|best|every|games|game|campaigns|from|with|this|that|what|year)$/.test(
          w,
        ),
    );

/**
 * The "related video" link for each recent Short. Rules, in order: a Short cut from a long ranking
 * links to that ranking; a Short about a series that has a long video links to the newest such
 * long video; anything else links to the newest long video (the hub).
 */
export function planRelated(
  rows: RelatedRow[],
  longs: LongVideo[],
): RelatedItem[] {
  if (!longs.length) throw new Error("no long videos found on the channel");
  return rows
    .filter((r) => r.youtube_video_id && r.script_json?.runtime !== "long")
    .map((r) => {
      const sc = r.script_json ?? {};
      const title = sc.youtube?.title ?? sc.headline ?? "";
      if (sc.cutdown?.parent_video)
        return {
          short: r.youtube_video_id!,
          title,
          target: sc.cutdown.parent_video,
          targetTitle:
            longs.find((l) => l.id === sc.cutdown!.parent_video)?.title ?? "",
          reason: "cut from this ranking",
        };
      const words = series(`${sc.game_title ?? ""} ${title}`);
      const match = longs.find((l) => {
        const lw = series(l.title);
        return words.filter((w) => lw.includes(w)).length >= 2;
      });
      const target = match ?? longs[0]!;
      return {
        short: r.youtube_video_id!,
        title,
        target: target.id,
        targetTitle: target.title,
        reason: match ? "same series" : "newest long video",
      };
    });
}

/** The factory's published videos of the last few days (what /admin/export lists). */
async function recentPublished(db: Db, days: number): Promise<RelatedRow[]> {
  return db.query<RelatedRow>(
    `SELECT e.id, e.lane, e.youtube_video_id, coalesce(e.publish_at, e.updated_at) AS live_at, e.script_json
       FROM episodes e
      WHERE e.status = 'published' AND e.youtube_video_id IS NOT NULL AND coalesce(e.publish_at, e.updated_at) > now() - make_interval(days => $1)
      ORDER BY live_at DESC`,
    [days],
  );
}

// The plan reads the channel page with yt-dlp, so it is kept for half an hour; the done list is
// applied on every request, so a Short disappears from the page as soon as it is recorded.
const RELATED_TTL_MS = 30 * 60_000;
let relatedCache: { at: number; plan: Promise<RelatedItem[]> } | undefined;

export function clearRelatedCache(): void {
  relatedCache = undefined;
}

// ------------------------------------------------------------------ poll results

/** A poll result as the routine read it off the Posts tab: 2 to 5 named options with percentages. */
export function pollOptions(
  data: string,
): Array<{ name: string; percent: number }> {
  if (data.length > 2000) throw new Error("poll result too long");
  const raw = JSON.parse(data) as { options?: unknown };
  if (!Array.isArray(raw?.options))
    throw new Error('expected {"options":[...]}');
  const options = raw.options.map(
    (o: { name?: unknown; percent?: unknown }) => {
      const name = typeof o?.name === "string" ? o.name.trim() : "";
      const percent = Number(o?.percent);
      if (!name || name.length > 40 || /\p{C}/u.test(name))
        throw new Error("bad option name");
      if (!Number.isFinite(percent) || percent < 0 || percent > 100)
        throw new Error("bad option percent");
      return { name, percent };
    },
  );
  if (options.length < 2 || options.length > 5)
    throw new Error("a poll has 2 to 5 options");
  return options;
}

// ------------------------------------------------------------------ the pages

export interface RoutineContext {
  db: Db;
  cfg: Config;
  /** This week's ranking candidates, for the poll's options. */
  pollCandidates: () => Promise<EvergreenCandidate[]>;
  /** Long videos on the channel (tests pass a fake; the default reads the channel page). */
  channelLongs?: () => Promise<LongVideo[]>;
  now?: () => Date;
}

const json = (res: http.ServerResponse, code: number, body: unknown) =>
  res
    .writeHead(code, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    })
    .end(JSON.stringify(body, null, 2));

/**
 * Serves /routine/*. Returns false for anything it does not serve, including every refused request,
 * so those fall through to the server's ordinary "Not found".
 */
export async function handleRoutine(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: RoutineContext,
): Promise<boolean> {
  if (!url.pathname.startsWith("/routine/") || req.method !== "GET")
    return false;
  if (!routineAllowed(req)) return false;
  const { db, cfg } = ctx;
  const now = ctx.now?.() ?? new Date();
  const today = dayKey(now, cfg.timezone);
  try {
    switch (url.pathname) {
      // Today's community post (question, caption, picture on disk) and whether it is already on YouTube.
      case "/routine/community": {
        const [row] = await db.query<{
          id: number;
          created_at: string;
          detail: any;
        }>(
          `SELECT id, created_at, detail FROM events WHERE kind = 'engage_post' AND detail ? 'question' AND NOT detail ? 'skipped' ORDER BY id DESC LIMIT 1`,
        );
        const posted = readList(doneFile(cfg, "community"));
        json(res, 200, {
          today,
          post: row ?? null,
          done: Boolean(row && posted.includes(String(row.detail?.day))),
        });
        return true;
      }
      // Recent Shorts still without a related video, at most `max`.
      case "/routine/related": {
        const max = Math.min(
          50,
          Math.max(1, Number(url.searchParams.get("max")) || 15),
        );
        if (!relatedCache || now.getTime() - relatedCache.at > RELATED_TTL_MS) {
          const plan = Promise.all([
            recentPublished(db, 3),
            (ctx.channelLongs ?? channelLongs)(),
          ]).then(([rows, longs]) => planRelated(rows, longs));
          relatedCache = { at: now.getTime(), plan };
          plan.catch(() => {
            if (relatedCache?.plan === plan) relatedCache = undefined;
          });
        }
        const planned = await relatedCache.plan;
        const done = new Set(readList(doneFile(cfg, "related")));
        const items = planned.filter((p) => !done.has(p.short)).slice(0, max);
        json(res, 200, {
          planned_at: new Date(relatedCache.at).toISOString(),
          count: items.length,
          items,
        });
        return true;
      }
      // Long videos waiting for Test & compare; "ready" once the video is public.
      case "/routine/abtest": {
        const file = path.join(cfg.dataDir, "abtests", "pending.json");
        const pending = fs.existsSync(file)
          ? (JSON.parse(fs.readFileSync(file, "utf8")) as Array<{
              videoId: string;
              publishAt?: string | null;
            }>)
          : [];
        const done = new Set(readList(doneFile(cfg, "abtest")));
        json(res, 200, {
          now: now.toISOString(),
          tests: pending
            .filter((t) => !done.has(t.videoId))
            .map((t) => ({
              ...t,
              ready:
                Boolean(t.publishAt) &&
                new Date(t.publishAt!).getTime() <= now.getTime(),
            })),
        });
        return true;
      }
      case "/routine/hearted": {
        json(res, 200, { hearted: readList(doneFile(cfg, "hearted")) });
        return true;
      }
      // This week's poll options and whether today's poll is already posted.
      case "/routine/poll": {
        const plan = await pollPlan(
          db,
          cfg,
          await ctx.pollCandidates().catch(() => []),
          now,
        );
        json(res, 200, {
          today,
          done: readList(doneFile(cfg, "poll")).includes(today),
          ...plan,
        });
        return true;
      }
      // Records progress: one or more keys (repeat &key=) for one routine's ledger.
      case "/routine/done": {
        const kind = url.searchParams.get("kind") ?? "";
        const keys = url.searchParams.getAll("key");
        if (
          !keys.length ||
          keys.length > 30 ||
          !keys.every((k) => validDoneKey(kind, k))
        ) {
          json(res, 400, { ok: false, error: "bad kind or key" });
          return true;
        }
        json(res, 200, {
          ok: true,
          kind,
          ...appendDone(cfg, kind as DoneKind, keys),
        });
        return true;
      }
      // Last week's poll result, read off the Posts tab; the same result twice is recorded once.
      case "/routine/poll-result": {
        let options: Array<{ name: string; percent: number }>;
        try {
          options = pollOptions(url.searchParams.get("data") ?? "");
        } catch (err) {
          json(res, 400, { ok: false, error: errorMessage(err) });
          return true;
        }
        const last = await readPoll(db);
        const same =
          last &&
          now.getTime() - new Date(last.at).getTime() < 7 * 86_400_000 &&
          JSON.stringify(last.options) === JSON.stringify(options);
        if (!same) {
          await recordPollResult(db, { at: now.toISOString(), options });
          await logEvent(db, null, "poll_result", { options, via: "routine" });
        }
        json(res, 200, { ok: true, unchanged: Boolean(same), options });
        return true;
      }
      // The channel report and export are served by server.ts (the same code as /admin/...), for the
      // review routines that cannot read the admin key.
      case "/routine/channel-report":
      case "/routine/export":
        return false;
      default:
        json(res, 404, { ok: false, error: "no such routine page" });
        return true;
    }
  } catch (err) {
    log("warn", "routine page failed", {
      page: url.pathname,
      error: errorMessage(err),
    });
    json(res, 500, { ok: false, error: errorMessage(err) });
    return true;
  }
}

// ------------------------------------------------------------------ Brave to the front

// Studio's dialogs and lists stay empty while Brave sits behind other windows, so the factory brings
// it forward around each routine's start. MUST MATCH the scheduled tasks' cron times (local UK time,
// set in the Claude scheduled tasks, not in this repo).
const EVERY_DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export const ROUTINE_SCHEDULE: ReadonlyArray<{
  task: string;
  days: readonly string[];
  times: readonly string[];
}> = [
  {
    task: "pulse-related-video-links",
    days: EVERY_DAY,
    times: ["13:40", "23:40"],
  },
  {
    task: "pulse-youtube-community",
    days: ["sun", "tue", "thu"],
    times: ["16:30"],
  },
  { task: "pulse-studio-abtest", days: EVERY_DAY, times: ["11:20", "20:20"] },
  { task: "pulse-weekly-poll", days: ["sat"], times: ["07:40"] },
];

// From 3 minutes before a start to 15 minutes after (a run begins up to about 13 minutes late), every 4 minutes.
const LEAD_MIN = 3;
const TAIL_MIN = 15;
const REPEAT_MS = 4 * 60_000;
const WEEK_MIN = 7 * 1440;

function minuteOfWeek(now: Date, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return (
    EVERY_DAY.indexOf(weekday(now, timeZone) as never) * 1440 +
    Number(p.hour) * 60 +
    Number(p.minute)
  );
}

/** Whether to bring Brave forward now: inside a routine's window and 4 minutes since the last time. */
export function braveFrontDue(
  now: Date,
  timeZone: string,
  lastRun?: number,
  schedule = ROUTINE_SCHEDULE,
): boolean {
  if (lastRun !== undefined && now.getTime() - lastRun < REPEAT_MS - 30_000)
    return false;
  const at = minuteOfWeek(now, timeZone);
  return schedule.some((s) =>
    s.days.some((d) =>
      s.times.some((t) => {
        const [h, m] = t.split(":").map(Number) as [number, number];
        const start = EVERY_DAY.indexOf(d as never) * 1440 + h * 60 + m;
        const delta = (((at - start) % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
        return delta <= TAIL_MIN || delta >= WEEK_MIN - LEAD_MIN;
      }),
    ),
  );
}

/** Runs windows/brave-front.ps1 around each routine's start (Windows only). */
export function startBraveFront(timeZone: string): void {
  if (process.platform !== "win32") return;
  const script = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "windows",
    "brave-front.ps1",
  );
  if (!fs.existsSync(script)) return;
  let last: number | undefined;
  setInterval(() => {
    const now = new Date();
    if (!braveFrontDue(now, timeZone, last)) return;
    last = now.getTime();
    run(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script],
      {
        windowsHide: true,
        timeout: 30_000,
      },
    ).catch((err) =>
      log("warn", "bringing Brave forward failed", {
        error: errorMessage(err),
      }),
    );
  }, 60_000);
}
