// The funny jobs (FUNNY_SHORTS and MEME_POSTS, both off by default).
//
// funnyTick, every 20 minutes: the newest of the owner's recordings (STREAM_ASKS_VOD_DIR, the same folder the HUD
// reader and the VOD miner read) not yet looked at is ranked for funny moments (src/funny/finder.ts), with the HUD
// reader's whole-VOD events when it has read the recording, and the PC's local vision relay. The best moment that
// clears FUNNY_MIN_SCORE and the vision bar is cut into the gameplay lane's inbox as a "funny_" clip, one at a time
// (a second waits until the first is out), so at most one a day reaches the late gameplay slot. When the relay is
// down the recording is tried again later: a funny clip is never picked without the vision check (unless FUNNY_VISION
// is off on purpose).
//
// memeTick, every 30 minutes: once a week (MEME_DAY from MEME_HOUR, twice a week once promoted) one meme image from
// the week's best funny moments (src/funny/meme.ts). The YouTube API has no community-post endpoint, Instagram image
// posts and X both need the owner (X goes through his browser), so the meme is queued in data/memes/queue.json and
// sent to the alerts channel with the image and the words, ready to post. Nothing posts by itself.
//
// Both are judged on subscribers per 1,000 views every Sunday (src/subslearn, src/funny/verdict.ts): a dropped one
// stops here.

import fs from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config.ts";
import type { Db } from "../db.ts";
import type { DiscordMessage } from "../approval/discord.ts";
import { errorMessage, log } from "../lib/util.ts";
import { dayKey, weekday } from "../lanes.ts";
import { listRecordings } from "../vodindex/vods.ts";
import { readMeta } from "../gameplay.ts";
import { readJson, vodHudDir } from "../hudreader/telemetry.ts";
import type { HudTrack } from "../hudreader/telemetry.ts";
import {
  cutFunnyClip,
  findFunnyMoments,
  payoffFrames,
  type FunnyMeta,
} from "./finder.ts";
import type { FunnyHud } from "./moments.ts";
import { rateComedy } from "./vision.ts";
import { FUNNY_ID_PREFIX } from "./review.ts";
import { memeProblems, pickMeme, type MemePick } from "./meme.ts";
import { judgeTrial, trialLine, verdictKey, type TrialFormat, type Verdict } from "./verdict.ts";
import type { SubsFormat, SubsTally } from "../subslearn/learn.ts";

type FunnyConfig = Pick<
  Config,
  | "funny"
  | "gameplayRoot"
  | "gameplayEnabled"
  | "dataDir"
  | "timezone"
  | "streamAsks"
  | "spoilerWindowDays"
>;

/** GTA VI's launch day: its story is protected for SPOILER_WINDOW_DAYS from here. */
export const GTA6_LAUNCH = "2026-11-19";

/** Whether a recording's game is inside its story's spoiler window today (pure). */
export function inSpoilerWindow(
  title: string,
  today: string,
  days: number,
): boolean {
  if (!/\b(gta\s*(vi|6)|grand theft auto\s*(vi|6))\b/i.test(title))
    return false;
  const end = new Date(
    Date.parse(`${GTA6_LAUNCH}T00:00:00Z`) + days * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
  return today >= GTA6_LAUNCH && today < end;
}

/** A trial format's verdict as stored; "trial" when none. */
export async function readVerdict(db: Db, f: TrialFormat): Promise<Verdict> {
  const [row] = await db.query<{ value: string }>(
    `SELECT value FROM settings WHERE key = $1`,
    [verdictKey(f)],
  );
  const v = row?.value;
  // FUNNY_RESET / MEME_RESET: the owner puts a dropped format back on trial.
  if (
    v === "dropped" &&
    process.env[f === "funny" ? "FUNNY_RESET" : "MEME_RESET"] === "true"
  )
    return "trial";
  return v === "promoted" || v === "dropped" ? v : "trial";
}

export async function writeVerdict(
  db: Db,
  f: TrialFormat,
  v: Verdict,
): Promise<void> {
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [verdictKey(f), v],
  );
}

interface Ledger {
  done: Record<
    string,
    { at: string; picked?: string; best?: number; why?: string }
  >;
}

const ledgerFile = (dataDir: string) =>
  path.join(dataDir, "funny", "done.json");

async function readLedger(dataDir: string): Promise<Ledger> {
  try {
    return JSON.parse(await fs.readFile(ledgerFile(dataDir), "utf8")) as Ledger;
  } catch {
    return { done: {} };
  }
}

async function writeLedger(dataDir: string, l: Ledger): Promise<void> {
  await fs.mkdir(path.dirname(ledgerFile(dataDir)), { recursive: true });
  await fs.writeFile(ledgerFile(dataDir), JSON.stringify(l, null, 2));
}

/** Funny clips in the inbox not yet out (new to awaiting approval). */
export async function pendingFunny(root: string): Promise<number> {
  const inbox = path.join(root, "inbox");
  const names = (await fs.readdir(inbox).catch(() => [] as string[])).filter(
    (n) => n.startsWith(FUNNY_ID_PREFIX),
  );
  let n = 0;
  for (const name of names) {
    const m = await readMeta(path.join(inbox, name));
    if (m && !["published", "skipped", "rejected"].includes(m.status)) n++;
  }
  return n;
}

/** The HUD reader's events for a whole recording, when it has read it (HUD_READER's own job). */
async function wholeVodHud(
  dataDir: string,
  vodId: string,
): Promise<FunnyHud[] | undefined> {
  const track = await readJson<HudTrack>(
    path.join(vodHudDir(dataDir, vodId), "track.json"),
  ).catch(() => undefined);
  return track?.events.map((e) => ({
    t: e.t,
    kind: e.kind,
    ...(e.value !== undefined ? { value: e.value } : {}),
    ...(e.from !== undefined ? { from: e.from } : {}),
    detail: e.detail,
  }));
}

let busy = false;

export async function funnyTick(
  cfg: FunnyConfig,
  deps: { db: Db; now?: () => Date },
): Promise<void> {
  const s = cfg.funny;
  if (!s.shorts || !cfg.gameplayEnabled || !cfg.gameplayRoot || busy) return;
  busy = true;
  try {
    const now = deps.now?.() ?? new Date();
    const today = dayKey(now, cfg.timezone);
    if ((await readVerdict(deps.db, "funny")) === "dropped") return;
    // The day before FUNNY_START may already find tomorrow's (a late stream); nothing earlier.
    if (
      today < s.start &&
      dayKey(new Date(now.getTime() + 86_400_000), cfg.timezone) < s.start
    )
      return;
    if ((await pendingFunny(cfg.gameplayRoot)) > 0) return;
    const ledger = await readLedger(cfg.dataDir);
    const recs = (await listRecordings(cfg.streamAsks.vodDir, [])).filter(
      (r) =>
        !ledger.done[r.vodId] &&
        (r.recordedOn || "0000") >=
          dayKey(new Date(now.getTime() - 2 * 86_400_000), cfg.timezone),
    );
    const rec = recs[0];
    if (!rec) return;
    // A recording still being written grows: wait until it has been still for ten minutes.
    if (now.getTime() - rec.mtimeMs < 10 * 60_000) return;
    const hud = s.hud ? await wholeVodHud(cfg.dataDir, rec.vodId) : undefined;
    const work = path.join(cfg.dataDir, "funny", rec.vodId);
    const result = await findFunnyMoments(
      rec.file,
      {
        work,
        candidates: s.candidates,
        inSpoilerWindow: inSpoilerWindow(
          rec.title,
          today,
          cfg.spoilerWindowDays,
        ),
        visionMin: s.visionMin,
      },
      {
        ...(s.vision ? { rate: rateComedy } : {}),
        ...(hud
          ? {
              readHud: async (start: number, duration: number) =>
                hud.filter((e) => e.t >= start && e.t <= start + duration),
            }
          : {}),
        log: (line) => log("info", `funny: ${line}`, { vod: rec.vodId }),
      },
    );
    await fs
      .writeFile(
        path.join(work, "moments.json"),
        JSON.stringify({ ...result, cues: result.cues.length }, null, 2),
      )
      .catch(() => undefined);
    if (s.vision && result.visionChecked === 0 && result.ranked.length) {
      log(
        "info",
        "funny: the local vision relay did not answer; the recording waits",
        { vod: rec.vodId },
      );
      return;
    }
    const best = result.ranked.find((c) => !c.veto && c.score >= s.minScore);
    if (!best) {
      ledger.done[rec.vodId] = {
        at: now.toISOString(),
        why: `nothing cleared the bar (best ${result.ranked[0]?.score ?? 0})`,
      };
      await writeLedger(cfg.dataDir, ledger);
      return;
    }
    const id =
      `${FUNNY_ID_PREFIX}${rec.vodId}_${Math.round(best.payoff)}`.replace(
        /[^\w-]/g,
        "_",
      );
    await cutFunnyClip({
      file: rec.file,
      title: rec.title,
      recordedOn: rec.recordedOn,
      candidate: best,
      cues: result.cues,
      inbox: path.join(cfg.gameplayRoot, "inbox"),
      id,
      now,
    });
    ledger.done[rec.vodId] = {
      at: now.toISOString(),
      picked: id,
      best: best.score,
    };
    await writeLedger(cfg.dataDir, ledger);
    log("info", "funny: a clip went to the gameplay lane", {
      vod: rec.vodId,
      id,
      score: best.score,
    });
  } catch (err) {
    log("warn", "funny tick failed", { error: errorMessage(err) });
  } finally {
    busy = false;
  }
}

// ------------------------------------------------------------------ memes

interface MemeQueue {
  items: Array<
    MemePick & {
      at: string;
      image: string;
      status: "queued" | "posted";
      views?: number;
      follows?: number;
    }
  >;
}

const memeQueueFile = (dataDir: string) =>
  path.join(dataDir, "memes", "queue.json");

export async function readMemeQueue(dataDir: string): Promise<MemeQueue> {
  try {
    return JSON.parse(
      await fs.readFile(memeQueueFile(dataDir), "utf8"),
    ) as MemeQueue;
  } catch {
    return { items: [] };
  }
}

/** Whether a meme is due now (pure): on MEME_DAY from MEME_HOUR (and three days later once promoted), once each. */
export function memeDue(
  s: { memeDay: string; memeHour: number },
  o: { now: Date; timeZone: string; promoted: boolean; madeOn: string[] },
): string | undefined {
  const day = weekday(o.now, o.timeZone);
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const second = days[(days.indexOf(s.memeDay) + 3) % 7]!;
  if (day !== s.memeDay && !(o.promoted && day === second)) return undefined;
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: o.timeZone,
      hour: "2-digit",
      hour12: false,
    }).format(o.now),
  );
  if (hour < s.memeHour) return undefined;
  const key = dayKey(o.now, o.timeZone);
  return o.madeOn.includes(key) ? undefined : key;
}

/** The meme's rows for the subscriber learner: views and follows filled in once known, 28 days back. */
export async function memeRows(
  dataDir: string,
  now: Date,
): Promise<Array<{ format: "meme"; views: number; subs: number }>> {
  const q = await readMemeQueue(dataDir);
  const from = now.getTime() - 28 * 86_400_000;
  return q.items
    .filter(
      (i) =>
        i.status === "posted" && Date.parse(i.at) >= from && (i.views ?? 0) > 0,
    )
    .map((i) => ({
      format: "meme" as const,
      views: i.views ?? 0,
      subs: i.follows ?? 0,
    }));
}

export async function memeTick(
  cfg: FunnyConfig & Pick<Config, "remotionGl" | "browserExecutable">,
  deps: {
    db: Db;
    notify: (m: DiscordMessage) => Promise<unknown>;
    now?: () => Date;
  },
): Promise<void> {
  const s = cfg.funny;
  if (!s.memes) return;
  const now = deps.now?.() ?? new Date();
  try {
    const verdict = await readVerdict(deps.db, "meme");
    if (verdict === "dropped") return;
    const q = await readMemeQueue(cfg.dataDir);
    const key = memeDue(s, {
      now,
      timeZone: cfg.timezone,
      promoted: verdict === "promoted",
      madeOn: q.items.map((i) => dayKey(new Date(i.at), cfg.timezone)),
    });
    if (!key) return;
    // The week's funny moments: the finder's rankings of the last seven days, best first, only what the vision check
    // saw as real play (never a menu), only the owner's own recordings.
    const root = path.join(cfg.dataDir, "funny");
    const vods = await fs.readdir(root).catch(() => [] as string[]);
    const moments: Array<{
      file: string;
      payoff: number;
      kind: string;
      score: number;
      title: string;
    }> = [];
    for (const v of vods) {
      const m = await fs
        .readFile(path.join(root, v, "moments.json"), "utf8")
        .then((t) => JSON.parse(t))
        .catch(() => undefined);
      if (!m?.ranked) continue;
      const st = await fs
        .stat(path.join(root, v, "moments.json"))
        .catch(() => undefined);
      if (!st || now.getTime() - st.mtimeMs > 7 * 86_400_000) continue;
      for (const c of m.ranked as Array<{
        payoff: number;
        score: number;
        veto?: string;
        vision?: {
          kind: string;
          menu: boolean;
          gore: boolean;
          cutscene: boolean;
        };
      }>)
        if (
          c.vision &&
          !c.vision.menu &&
          !c.vision.gore &&
          !c.vision.cutscene &&
          !/spoiler|music|radio/.test(c.veto ?? "")
        )
          moments.push({
            file: m.file,
            payoff: c.payoff,
            kind: c.vision.kind,
            score: c.score,
            title: path.basename(m.file),
          });
    }
    moments.sort((a, b) => b.score - a.score);
    const top = moments[0];
    if (!top) {
      log("info", "meme: no moments from this week's streams yet");
      return;
    }
    const dir = path.join(cfg.dataDir, "memes", key);
    // The calm before (four seconds back) and the payoff itself, from the best moment.
    const [calm] = await payoffFrames(
      top.file,
      Math.max(0, top.payoff - 3),
      path.join(dir, "calm"),
    );
    const shots = await payoffFrames(
      top.file,
      top.payoff,
      path.join(dir, "payoff"),
    );
    const meme = pickMeme({
      id: key,
      frames: [calm!, shots[1]!],
      kinds: moments.slice(0, 3).map((m) => m.kind),
      game: top.title,
      used: q.items.slice(-6).map((i) => i.key),
    });
    const problems = memeProblems(meme);
    if (problems.length) {
      log("warn", "meme: words failed the checks", { problems });
      return;
    }
    const { renderMeme } = await import("./memerender.ts");
    const image = path.join(dir, "meme.png");
    await renderMeme({
      dir,
      meme,
      outFile: image,
      gl: cfg.remotionGl,
      browserExecutable: cfg.browserExecutable,
    });
    q.items.push({ ...meme, at: now.toISOString(), image, status: "queued" });
    await fs.mkdir(path.dirname(memeQueueFile(cfg.dataDir)), {
      recursive: true,
    });
    await fs.writeFile(memeQueueFile(cfg.dataDir), JSON.stringify(q, null, 2));
    await deps.notify({
      content: [
        "😂 **This week's meme**, from your own stream. Ready to post: the Community tab (paste), Instagram and X.",
        "",
        meme.post,
        "",
        `Once posted, put the views and new follows into data/memes/queue.json (id ${meme.id}) so Sunday's subscriber check can judge memes.`,
      ].join("\n"),
      files: [image],
    });
  } catch (err) {
    log("warn", "meme tick failed", { error: errorMessage(err) });
  }
}

/**
 * Sunday's verdicts for the formats that are switched on (or have numbers), from the subscriber learner's month: one
 * step at most, written only when SUBS_LEARN_APPLY is on. Returns the lines for the learner's message.
 */
export async function runTrials(
  db: Db,
  month: Map<SubsFormat, SubsTally>,
  s: { minViews: number; minVideos: number; lead: number; apply: boolean },
  on: { funny: boolean; meme: boolean },
): Promise<string[]> {
  const lines: string[] = [];
  for (const f of ["funny", "meme"] as TrialFormat[]) {
    if (!on[f] && !month.get(f)) continue;
    const was = await readVerdict(db, f);
    const j = judgeTrial(f, was, month, s);
    if (s.apply && j.now !== was) await writeVerdict(db, f, j.now);
    lines.push(trialLine(j, s.apply));
  }
  return lines;
}

export type { FunnyMeta };
