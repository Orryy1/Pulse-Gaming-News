// The Twitch-to-YouTube relay (STREAM_RELAY, owner's brief 14 Nov 2026). The owner streams from his Xbox, which can
// only broadcast to Twitch; this mirrors that stream live on the Pulse YouTube channel and keeps every archive public,
// because archived live watch time counts towards the Partner Programme. His only job was switching live on in Studio.
//
// Every pass (STREAM_RELAY_POLL_SECONDS, 60 by default):
//   - Twitch is asked whether he is live (Helix streams?user_login=, the factory's app login).
//   - Live and not yet mirrored: the relay's reusable YouTube stream is found or made, a public broadcast is made with
//     the day's title and description (src/liveclips/simulcast.ts: Day N, the AI line, the Twitch link), bound to it,
//     and streamlink to ffmpeg starts pushing (src/relay/pipe.ts). YouTube starts the broadcast when data arrives.
//   - While live: if YouTube ends or removes the broadcast (a Content ID stop over car radio, most likely) a fresh one,
//     "(part 2)", is made and bound to the same stream, up to STREAM_RELAY_MAX_RESTARTS times. If YouTube shows no
//     data for STREAM_RELAY_HEALTH_MINUTES, the pipe is restarted once, then Discord is told.
//   - Offline for STREAM_RELAY_OFFLINE_MINUTES: the pipe stops and the broadcast is ended (YouTube would auto-stop it
//     too). The archive stays public. Nothing here ever deletes, unlists or makes private any video.
//   - After the stream: each archive is listed in data/relay/archives.json (for the Studio "Erase song" task and the
//     other jobs), and the stream's recording reaches the stream index: the Twitch VOD when Twitch keeps one (the
//     existing downloader fetches it), otherwise the YouTube archive itself is fetched into the same folder with the
//     same naming, so the VOD index, live clips' bookkeeping and GTA 6 Day N see it like any other recording.

import fs from "node:fs";
import path from "node:path";
import { dayNumber } from "../gtadaily.ts";
import { challengeSeriesTitle, closeQuiet, editRegistry, noteStream } from "../challenge.ts";
import { dayKey } from "../lanes.ts";
import { streamDescription, streamTitle } from "../liveclips/simulcast.ts";
import type { LiveStream } from "../liveclips/twitch.ts";
import type { PipeHandle } from "./pipe.ts";
import type { RelaySettings } from "./settings.ts";
import { YouTubeApiError, type LiveApi } from "./youtube.ts";

export interface Archive {
  /** The YouTube video id of the broadcast (its archive keeps the same id). */
  videoId: string;
  url: string;
  title: string;
  part: number;
  day: number;
  game: string;
  /** The owner's local date of the stream. */
  date: string;
  twitchStreamIds: string[];
  startedAt: string;
  endedAt?: string;
  /** Why it ended: "stream over", or YouTube's interruption. */
  endReason?: string;
  /** The Twitch past broadcast of the same stream ("v123"), when Twitch keeps one. */
  twitchVod?: string;
  /** Where the stream index gets this stream from: the Twitch VOD, this archive, or nowhere (gave up). */
  indexSource?: "twitch" | "youtube" | "none";
  fetchedFile?: string;
  fetchTries?: number;
  checkedAt?: string;
  /**
   * For the Studio browser task that applies YouTube's "Erase song" to claimed stretches, so a claimed archive stays
   * public and watchable: "pending" until that task has looked, then "done" or "none" (written by that task).
   */
  eraseSong: "pending" | "done" | "none";
}

export interface Current {
  twitchStreamIds: string[];
  startedAt: string;
  game: string;
  day: number;
  date: string;
  part: number;
  restarts: number;
  broadcastId?: string;
  streamId?: string;
  offlineSince?: number;
  noDataSince?: number;
  healthRestarted?: boolean;
  healthAlerted?: boolean;
  setupFailedAt?: number;
  setupAlerted?: boolean;
  pipeAlertedAt?: number;
  /** YouTube cut it off too often: Twitch carries on, the mirror stops for this stream. */
  givenUp?: boolean;
  /** The Twitch title as last seen (the owner's "[CHALLENGE: rule]" tag lives there). */
  twitchTitle?: string;
}

export interface RelayState {
  current?: Current;
}

export interface RelayDeps {
  settings: RelaySettings;
  twitch: {
    live(login: string): Promise<LiveStream | undefined>;
    vodFor(login: string, streamId: string): Promise<string | undefined>;
  };
  yt: LiveApi;
  /** Starts the pipe to an ingest address (a secret: it stays in memory). */
  startPipe(url: string): PipeHandle;
  notify(text: string): Promise<void>;
  /** Fetches a YouTube archive into the recordings folder; returns the file. */
  fetchArchive(a: Archive): Promise<string>;
  now(): number;
  log(
    level: "info" | "warn",
    msg: string,
    extra?: Record<string, unknown>,
  ): void;
}

export const relayDir = (dataDir: string) => path.join(dataDir, "relay");

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export const readArchives = (dataDir: string) =>
  readJson<Archive[]>(path.join(relayDir(dataDir), "archives.json"), []);

/** The YouTube "Erase song" worklist (pure): ended archives the Studio task has not looked at yet. */
export function eraseSongQueue(archives: Archive[]): Archive[] {
  return archives.filter((a) => a.endedAt && a.eraseSong === "pending");
}

const GTA6 = /grand theft auto vi\b|\bgta ?(6|vi)\b/i;

/**
 * The stream's day number (pure): for GTA VI, the calendar day of the GTA 6 Day N series (GTA_DAILY_START is Day 1),
 * so the stream and that day's Short share a number; for anything else, or before launch, the count of days streamed.
 */
export function streamDay(
  game: string,
  date: string,
  dailyStart: string,
  archives: Pick<Archive, "date">[],
): number {
  if (GTA6.test(game) && /^\d{4}-\d{2}-\d{2}$/.test(dailyStart)) {
    const n = dayNumber(dailyStart, date);
    if (n >= 1) return n;
  }
  const days = new Set(archives.map((a) => a.date));
  days.delete(date);
  return days.size + 1;
}

/** Plain-English words for a setup failure (pure). */
export function setupProblem(err: unknown): string {
  if (err instanceof YouTubeApiError) {
    if (err.reasons.includes("liveStreamingNotEnabled"))
      return "live streaming is not switched on for the Pulse channel yet (YouTube Studio, Create, Go live; it can take 24 hours the first time)";
    if (err.reasons.includes("quotaExceeded"))
      return "the YouTube daily quota is used up; I try again every 10 minutes";
    if (err.status === 401 || err.status === 403)
      return `YouTube refused the factory's login (${err.reasons.join(", ") || err.status})`;
  }
  return err instanceof Error ? err.message : String(err);
}

const ENDED = new Set(["complete", "revoked"]);
const RUNNING = new Set(["live", "testing", "liveStarting", "testStarting"]);
const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;

export class RelayJob {
  pipe?: PipeHandle;
  state: RelayState;
  private file: string;

  constructor(private d: RelayDeps) {
    this.file = path.join(relayDir(d.settings.dataDir), "state.json");
    this.state = readJson<RelayState>(this.file, {});
  }

  private archives(): Archive[] {
    return readArchives(this.d.settings.dataDir);
  }

  /** Read, change, write: the Studio task may edit the same file, so it is read fresh every time. */
  private editArchives(change: (a: Archive[]) => void): void {
    const list = this.archives();
    change(list);
    writeJson(
      path.join(relayDir(this.d.settings.dataDir), "archives.json"),
      list,
    );
  }

  private save(): void {
    writeJson(this.file, this.state);
  }

  async tick(): Promise<void> {
    const s = this.d.settings;
    const now = this.d.now();
    let live: LiveStream | undefined | "unknown";
    try {
      live = await this.d.twitch.live(s.channel);
    } catch (err) {
      live = "unknown"; // a failed check changes nothing
      this.d.log("warn", "relay: Twitch check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const cur = this.state.current;
    if (s.challengeSeries) await this.challenges(live === "unknown" ? undefined : live);
    if (live && live !== "unknown") {
      if (!cur) await this.begin(live);
      else {
        cur.offlineSince = undefined;
        // An Xbox reconnect is a new Twitch stream id inside the same session: same broadcast, carry on.
        if (!cur.twitchStreamIds.includes(live.id))
          cur.twitchStreamIds.push(live.id);
        if (!cur.givenUp) {
          if (!cur.broadcastId) {
            if (now - (cur.setupFailedAt ?? 0) >= 10 * 60_000)
              await this.setup(cur);
          } else await this.watch(cur);
        }
      }
    } else if (live === undefined && cur) {
      cur.offlineSince ??= now;
      if (now - cur.offlineSince >= s.offlineMinutes * 60_000)
        await this.finish(cur);
    }
    this.save();
    await this.handoff();
  }

  private async begin(live: LiveStream): Promise<void> {
    const s = this.d.settings;
    const date = dayKey(new Date(this.d.now()), s.timeZone);
    const game = live.game || s.fallbackGame;
    const cur: Current = {
      twitchStreamIds: [live.id],
      startedAt: live.startedAt,
      game,
      day: streamDay(game, date, s.dailyStart, this.archives()),
      date,
      part: 1,
      restarts: 0,
      twitchTitle: live.title,
    };
    this.state.current = cur;
    this.d.log("info", "relay: the owner is live on Twitch", {
      stream: live.id,
      game,
      day: cur.day,
    });
    await this.setup(cur);
  }

  /**
   * CHALLENGE_SERIES (src/challenge.ts): the live title's tag files the challenge (new, still going, or ended with
   * "done"/"failed"), and challenges whose tag has not been seen for CHALLENGE_END_DAYS are closed. Discord hears of
   * each start and end once. A failure is logged and changes nothing else.
   */
  private async challenges(live: LiveStream | undefined): Promise<void> {
    const s = this.d.settings;
    try {
      const now = new Date(this.d.now());
      if (live) {
        if (this.state.current) this.state.current.twitchTitle = live.title;
        const r = editRegistry(s.dataDir, (reg) =>
          noteStream(
            reg,
            {
              id: live.id,
              title: live.title,
              date: dayKey(now, s.timeZone),
              startedAt: live.startedAt,
              game: live.game || s.fallbackGame,
            },
            now,
          ),
        );
        const c = r.challenge;
        if (c && r.started)
          await this.d.notify(
            `🎯 New challenge spotted in the stream title: "${challengeSeriesTitle(c.rule, c.game)}" (challenge ${c.number}). Clips from these streams become numbered episodes with the running count on screen.`,
          );
        if (c && r.ended)
          await this.d.notify(
            `🏁 The "${c.rule}" challenge is marked ${c.ended?.outcome ?? "over"} in the stream title. Its next clip becomes the final "did I make it" episode.`,
          );
      }
      const q = editRegistry(s.dataDir, (reg) => closeQuiet(reg, now, s.challengeQuietDays));
      for (const c of q.closed)
        await this.d.notify(
          `🏁 No "[CHALLENGE: ${c.rule}]" stream for ${s.challengeQuietDays} days, so that challenge is closed. Its next clip becomes the final episode. To carry on, just use the tag again.`,
        );
    } catch (err) {
      this.d.log("warn", "relay: challenge check failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Makes (or remakes) the broadcast, binds it and makes sure the pipe runs. */
  private async setup(cur: Current): Promise<void> {
    const s = this.d.settings;
    try {
      const ingest = await this.d.yt.ingest();
      const title = streamTitle({
        game: cur.game,
        day: cur.day,
        part: cur.part,
      });
      const description = streamDescription({
        game: cur.game,
        day: cur.day,
        date: cur.date,
        twitch: s.channel,
      });
      const id = await this.d.yt.createBroadcast({
        title,
        description,
        privacy: s.privacy,
        start: new Date(this.d.now()),
      });
      await this.d.yt.bind(id, ingest.streamId);
      cur.broadcastId = id;
      cur.streamId = ingest.streamId;
      cur.noDataSince = undefined;
      cur.healthRestarted = false;
      cur.healthAlerted = false;
      cur.setupFailedAt = undefined;
      this.editArchives((list) =>
        list.push({
          videoId: id,
          url: watchUrl(id),
          title,
          part: cur.part,
          day: cur.day,
          game: cur.game,
          date: cur.date,
          twitchStreamIds: [...cur.twitchStreamIds],
          startedAt: new Date(this.d.now()).toISOString(),
          eraseSong: "pending",
        }),
      );
      if (!this.pipe || this.pipe.gaveUp()) {
        this.pipe?.stop();
        this.pipe = this.d.startPipe(ingest.url);
      }
      this.d.log("info", "relay: broadcast ready", {
        broadcast: id,
        part: cur.part,
      });
      if (cur.part === 1)
        await this.d.notify(
          `🔴 TinoTV is live on Twitch, so Pulse is now live on YouTube too: "${title}" ${watchUrl(id)} (the archive stays public afterwards).`,
        );
    } catch (err) {
      cur.setupFailedAt = this.d.now();
      const why = setupProblem(err);
      this.d.log("warn", "relay: could not set up the YouTube broadcast", {
        why,
      });
      if (!cur.setupAlerted) {
        cur.setupAlerted = true;
        await this.d.notify(
          `⚠️ TinoTV is live on Twitch but I could not start the Pulse YouTube stream: ${why}. I keep trying every 10 minutes while he is live.`,
        );
      }
    }
  }

  private async watch(cur: Current): Promise<void> {
    const s = this.d.settings;
    const now = this.d.now();
    // The pipe: started again after a restart of this job, and after it gave up (five minutes' rest first).
    if (!this.pipe) {
      try {
        this.pipe = this.d.startPipe((await this.d.yt.ingest()).url);
      } catch (err) {
        this.d.log("warn", "relay: no ingest address", {
          why: setupProblem(err),
        });
      }
    } else if (this.pipe.gaveUp()) {
      if (!cur.pipeAlertedAt) {
        cur.pipeAlertedAt = now;
        await this.d.notify(
          "⚠️ The Twitch to YouTube relay keeps failing (Twitch or YouTube dropping the connection). I try again in 5 minutes; Twitch itself is unaffected.",
        );
      } else if (now - cur.pipeAlertedAt >= 5 * 60_000) {
        cur.pipeAlertedAt = undefined;
        this.pipe.restart("rested after giving up");
      }
    }

    // The broadcast: still there, or did YouTube end it?
    const b = await this.d.yt
      .broadcast(cur.broadcastId!)
      .catch(() => "unknown" as const);
    if (b !== "unknown" && (!b || ENDED.has(b.lifeCycle))) {
      const reason = b
        ? "YouTube ended the broadcast mid-stream (a Content ID claim or a dropped connection)"
        : "YouTube removed the broadcast mid-stream";
      const old = cur.broadcastId!;
      this.editArchives((list) => {
        const a = list.find((x) => x.videoId === old);
        if (a && !a.endedAt) {
          a.endedAt = new Date(now).toISOString();
          a.endReason = reason;
        }
      });
      if (cur.restarts < s.maxRestarts) {
        cur.restarts++;
        cur.part++;
        cur.broadcastId = undefined;
        cur.setupAlerted = false;
        await this.setup(cur);
        if (cur.broadcastId)
          await this.d.notify(
            `⚠️ ${reason}. TinoTV is still live, so I started part ${cur.part} on YouTube: ${watchUrl(cur.broadcastId)}. The earlier part stays up; its claimed songs go on the Erase song list. Restart ${cur.restarts} of ${s.maxRestarts} for this stream.`,
          );
      } else {
        cur.givenUp = true;
        this.pipe?.stop();
        this.pipe = undefined;
        await this.d.notify(
          `⚠️ ${reason}. That makes ${s.maxRestarts + 1} cut-offs in this stream, so I stopped mirroring this stream to YouTube. Twitch carries on as normal. The next stream starts on YouTube as usual.`,
        );
      }
      return;
    }

    // Health: YouTube receiving data?
    const st = await this.d.yt.stream(cur.streamId!).catch(() => undefined);
    if (!st) return;
    if (st.status === "active") {
      cur.noDataSince = undefined;
      return;
    }
    cur.noDataSince ??= now;
    if (now - cur.noDataSince < s.healthMinutes * 60_000) return;
    if (!cur.healthRestarted) {
      cur.healthRestarted = true;
      cur.noDataSince = now;
      this.d.log(
        "warn",
        "relay: YouTube shows no data; restarting the pipe once",
        {
          status: st.status,
        },
      );
      this.pipe?.restart("YouTube shows no data");
    } else if (!cur.healthAlerted) {
      cur.healthAlerted = true;
      await this.d.notify(
        `⚠️ TinoTV is live on Twitch but YouTube has had no picture from the relay for ${s.healthMinutes * 2} minutes, even after a restart (YouTube says "${st.status}"). I keep it running and will say if it recovers.`,
      );
    }
  }

  private async finish(cur: Current): Promise<void> {
    this.pipe?.stop();
    this.pipe = undefined;
    const now = this.d.now();
    if (cur.broadcastId && !cur.givenUp) {
      const b = await this.d.yt
        .broadcast(cur.broadcastId)
        .catch(() => undefined);
      if (b && RUNNING.has(b.lifeCycle))
        await this.d.yt.end(cur.broadcastId).catch((err) =>
          this.d.log(
            "warn",
            "relay: could not end the broadcast (YouTube auto-stops it)",
            {
              why: setupProblem(err),
            },
          ),
        );
    }
    let ended: Archive[] = [];
    this.editArchives((list) => {
      for (const a of list)
        if (
          !a.endedAt &&
          a.twitchStreamIds.some((x) => cur.twitchStreamIds.includes(x))
        ) {
          a.endedAt = new Date(now).toISOString();
          a.endReason = "stream over";
          a.twitchStreamIds = [...cur.twitchStreamIds];
        }
      ended = list.filter((a) =>
        a.twitchStreamIds.some((x) => cur.twitchStreamIds.includes(x)),
      );
    });
    this.state.current = undefined;
    this.d.log("info", "relay: the stream ended", { parts: ended.length });
    if (ended.length)
      await this.d.notify(
        `✅ TinoTV's stream is over and the Pulse YouTube stream has stopped. The archive stays public: ${ended.map((a) => a.url).join(" , ")}`,
      );
  }

  /** After a stream: its recording into the stream index (Twitch VOD first, the YouTube archive otherwise). */
  private async handoff(): Promise<void> {
    const s = this.d.settings;
    const now = this.d.now();
    const todo = this.archives().filter((a) => a.endedAt && !a.indexSource);
    for (const a of todo) {
      const since = now - Date.parse(a.endedAt!);
      if (since < 15 * 60_000) continue;
      if (a.checkedAt && now - Date.parse(a.checkedAt) < 30 * 60_000) continue;
      let vod: string | undefined;
      for (const id of a.twitchStreamIds) {
        vod = await this.d.twitch.vodFor(s.channel, id).catch(() => undefined);
        if (vod) break;
      }
      const patch: Partial<Archive> = {
        checkedAt: new Date(now).toISOString(),
      };
      if (vod) {
        patch.twitchVod = vod;
        patch.indexSource = "twitch";
      } else if (since >= 72 * 3_600_000 || (a.fetchTries ?? 0) >= 3) {
        patch.indexSource = "none";
      } else if (since >= s.archiveWaitHours * 3_600_000) {
        try {
          patch.fetchedFile = await this.d.fetchArchive(a);
          patch.indexSource = "youtube";
          this.d.log("info", "relay: archive fetched for the stream index", {
            video: a.videoId,
          });
        } catch (err) {
          patch.fetchTries = (a.fetchTries ?? 0) + 1;
          this.d.log("warn", "relay: archive fetch failed", {
            video: a.videoId,
            why: err instanceof Error ? err.message.slice(0, 200) : String(err),
          });
        }
      }
      this.editArchives((list) => {
        const x = list.find((y) => y.videoId === a.videoId);
        if (x) Object.assign(x, patch);
      });
    }
  }

  /** Stops the pipe without ending the broadcast (this job restarting: the next one picks the stream up again). */
  stop(): void {
    this.pipe?.stop();
    this.pipe = undefined;
    this.save();
  }
}

/** The recording's file name, as the Twitch VOD downloader names its files, so the index reads it the same way (pure). */
export function archiveFileName(
  a: Pick<Archive, "date" | "title" | "videoId">,
): string {
  const title = a.title
    .replace(/[/\\:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return `${a.date} ${title} [yt-${a.videoId}].mp4`;
}
