// Near-live clips (LIVE_CLIPS, owner's brief 12 Nov 2026: "while he is live, detect big moments within minutes, not
// the next day, and get a Short out while the topic is hot"). Off by default.
//
// While twitch.tv/<LIVE_CLIPS_CHANNEL> is live (Helix, checked every minute):
//   - the stream's last LIVE_CLIPS_BUFFER_MINUTES are kept on disk in 10-second pieces (src/liveclips/recorder.ts);
//   - each finished piece is measured for sound and action, the chat is read anonymously, viewers' clips are listed,
//     and the detector (src/liveclips/detect.ts) says when a moment is worth it, within the hourly and daily caps;
//   - the moment's pieces are copied aside at once, cut behind Pulse's renders (~/orch/macrun.sh), and the 40-second
//     clip goes into the gameplay lane's inbox as "twitch_live", first in the queue. From there it is the lane as
//     ever: heard, looked at, the spoiler guard, the friend voice, game sound, the graphics audit, and the owner's
//     one-tap card in Discord. Nothing publishes without that tap.
// When the stream ends, the stretches already cut are written to <GAMEPLAY_ROOT>/live_taken.json under the VOD's id,
// so the nightly highlight finder does not cut the same moment again from the VOD.

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Config } from "../config.ts";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { writeWhole, type GameplayMeta } from "../gameplay.ts";
import { openAsks } from "../streamasks/asks.ts";
import { readAsks } from "../streamasks/job.ts";
import {
  CLIP_SECONDS,
  LiveDetector,
  type ChatLine,
  type Moment,
} from "./detect.ts";
import {
  cutClip,
  expiredSegments,
  listSegments,
  measure,
  segmentsFor,
  startRecorder,
  type Recorder,
} from "./recorder.ts";
import { Helix, readChat, type ChatReader, type LiveStream } from "./twitch.ts";

const run = promisify(execFile);

export interface LiveState {
  /** Moments sent to the lane (ms), for the caps across restarts. */
  sent: number[];
  /** Per stream: when it started, its VOD once known, and the stretches cut (seconds from the stream's start). */
  streams: Record<
    string,
    {
      startedAt: string;
      ended?: string;
      vod?: string;
      taken: Array<[number, number]>;
    }
  >;
}

export const liveDir = (dataDir: string) => path.join(dataDir, "liveclips");

export function readState(dataDir: string): LiveState {
  try {
    const o = JSON.parse(
      fs.readFileSync(path.join(liveDir(dataDir), "state.json"), "utf8"),
    ) as LiveState;
    return { sent: o.sent ?? [], streams: o.streams ?? {} };
  } catch {
    return { sent: [], streams: {} };
  }
}

async function saveState(dataDir: string, s: LiveState): Promise<void> {
  // A week of caps is plenty.
  s.sent = s.sent.filter((t) => Date.now() - t < 7 * 86_400_000);
  await fsp.mkdir(liveDir(dataDir), { recursive: true });
  await writeWhole(
    path.join(liveDir(dataDir), "state.json"),
    JSON.stringify(s, null, 2),
  );
}

/** The start of the local day a time falls in (ms), in a time zone (pure). */
export function dayStartIn(timeZone: string): (at: number) => number {
  return (at) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
        .formatToParts(new Date(at))
        .map((x) => [x.type, x.value]),
    );
    const into =
      ((Number(parts.hour) % 24) * 3600 +
        Number(parts.minute) * 60 +
        Number(parts.second)) *
      1000;
    return at - into - (at % 1000);
  };
}

/** The inbox entry for a live moment (pure). */
export function liveMeta(
  m: Moment,
  stream: Pick<LiveStream, "id" | "startedAt" | "title">,
  frames: string[],
  now: Date,
): GameplayMeta {
  const id = `gp_live_${crypto.createHash("sha1").update(`${stream.id}|${m.at}`).digest("hex").slice(0, 10)}`;
  return {
    id,
    status: "new",
    source: {
      file: `twitch live stream ${stream.id}`,
      title: stream.title,
      kind: "twitch_live",
    },
    clip: {
      file: "clip.mp4",
      start_in_source: Math.max(
        0,
        Math.round((m.start - Date.parse(stream.startedAt)) / 1000),
      ),
      peak_in_clip: m.peakInClip,
      seconds: CLIP_SECONDS,
    },
    score: m.score,
    frames,
    created_at: now.toISOString(),
    live: {
      stream_id: stream.id,
      moment_at: new Date(m.at).toISOString(),
      decided_at: new Date(m.decidedAt).toISOString(),
      signals: m.signals.map((s) => ({
        kind: s.kind,
        score: s.score,
        detail: s.detail,
      })),
      ...(m.ask ? { ask: m.ask.question } : {}),
    },
  };
}

/** live_taken.json's entries from the state (pure): VOD id -> stretches in seconds. */
export function takenByVod(
  s: LiveState,
): Record<string, Array<[number, number]>> {
  const out: Record<string, Array<[number, number]>> = {};
  for (const st of Object.values(s.streams))
    if (st.vod && st.taken.length) out[st.vod] = st.taken;
  return out;
}

interface Session {
  stream: LiveStream;
  recorder?: Recorder;
  recorderFails: number;
  chat?: ChatReader;
  detector: LiveDetector;
  measured: Set<string>;
  waiting: Array<{ m: Moment; since: number }>;
  clipsCheckedAt: number;
}

let session: Session | undefined;
let checkedAt = 0;
let vodCheckedAt = 0;
let busy = false;
let cutting = false;
const newlyTaken: Array<{ stream: string; span: [number, number] }> = [];

/** One pass of the job; the server calls it every 15 seconds while LIVE_CLIPS is on. */
export async function liveClipsTick(cfg: Config): Promise<void> {
  const lc = cfg.liveClips;
  if (!lc.enabled || busy || !cfg.gameplayEnabled) return;
  busy = true;
  try {
    const helix = helixFor(cfg);
    const state = readState(cfg.dataDir);
    const now = Date.now();
    if (helix.ready && now - checkedAt >= 60_000) {
      checkedAt = now;
      const live = await helix.live(lc.channel).catch((err) => {
        log("warn", "live clips: Twitch check failed", {
          error: errorMessage(err),
        });
        return session?.stream; // a failed check changes nothing
      });
      if (live && !session) await begin(cfg, live, state);
      else if (!live && session) end(state);
    }
    if (session) await during(cfg, helix, state, session);
    if (now - vodCheckedAt >= 5 * 60_000) {
      vodCheckedAt = now;
      await findVods(cfg, helix, state);
    }
    for (const t of newlyTaken.splice(0))
      state.streams[t.stream]?.taken.push(t.span);
    await saveState(cfg.dataDir, state);
  } catch (err) {
    log("warn", "live clips pass failed", { error: errorMessage(err) });
  } finally {
    busy = false;
  }
}

let helixCache: Helix | undefined;
function helixFor(cfg: Config): Helix {
  helixCache ??= new Helix(cfg.twitchClientId, cfg.twitchClientSecret);
  return helixCache;
}

async function begin(cfg: Config, stream: LiveStream, state: LiveState) {
  const lc = cfg.liveClips;
  const detector = new LiveDetector({
    minScore: lc.minScore,
    perHour: lc.perHour,
    perDay: lc.perDay,
    gapMinutes: lc.gapMinutes,
    warmupMinutes: lc.warmupMinutes,
    chatLagSeconds: 8,
    clipLagSeconds: 15,
    dayStart: dayStartIn(cfg.timezone),
  });
  detector.sent = [...state.sent];
  detector.title = stream.title;
  if (cfg.streamAsks.enabled)
    detector.asks = openAsks((await readAsks(cfg.dataDir)).asks).map((a) => ({
      id: a.id,
      question: a.question,
    }));
  state.streams[stream.id] ??= { startedAt: stream.startedAt, taken: [] };
  session = {
    stream,
    recorderFails: 0,
    detector,
    measured: new Set(),
    waiting: [],
    clipsCheckedAt: 0,
  };
  if (lc.chat) {
    const logFile = path.join(
      liveDir(cfg.dataDir),
      "chat",
      `${stream.startedAt.slice(0, 10)}_${stream.id}.jsonl`,
    );
    if (lc.chatLog) fs.mkdirSync(path.dirname(logFile), { recursive: true });
    session.chat = readChat(lc.channel, (l: ChatLine) => {
      session?.detector.addChat(l);
      if (lc.chatLog)
        fs.appendFile(logFile, `${JSON.stringify(l)}\n`, () => undefined);
    });
  }
  log("info", "live clips: the owner is live", {
    stream: stream.id,
    title: stream.title,
  });
}

function end(state: LiveState) {
  if (!session) return;
  session.recorder?.stop();
  session.chat?.close();
  const st = state.streams[session.stream.id];
  if (st) st.ended = new Date().toISOString();
  log("info", "live clips: the stream ended", { stream: session.stream.id });
  session = undefined;
}

async function during(cfg: Config, helix: Helix, state: LiveState, s: Session) {
  const lc = cfg.liveClips;
  const bufDir = path.join(liveDir(cfg.dataDir), "buffer");
  // The recorder, restarted when it stops (Twitch drops a connection now and then); three failures in a row wait.
  {
    if (!s.recorder?.alive() && s.recorderFails < 3) {
      s.recorder = startRecorder({
        channel: lc.channel,
        dir: bufDir,
        maxHeight: lc.maxHeight,
        ytdlp: cfg.ytdlpPath,
        ffmpeg: FFMPEG,
        onExit: (why) => {
          if (
            session === s &&
            Date.now() - (s.recorder?.startedAt ?? 0) < 60_000
          )
            s.recorderFails++;
          else s.recorderFails = 0;
          log("warn", "live clips: the stream copy stopped", {
            why: why.slice(0, 300),
          });
        },
      });
    }
  }
  const segs = listSegments(bufDir);
  // Sound and action of each finished piece, in order.
  if (lc.loudness)
    for (const seg of segs) {
      if (s.measured.has(seg.name)) continue;
      s.measured.add(seg.name);
      const samples = await measure(
        FFMPEG,
        path.join(bufDir, seg.name),
        seg.start,
        10,
      ).catch(() => []);
      for (const x of samples) s.detector.addSecond(x);
    }
  if (
    lc.viewerClips &&
    helix.ready &&
    Date.now() - s.clipsCheckedAt >= 60_000
  ) {
    s.clipsCheckedAt = Date.now();
    for (const c of await helix
      .clipsSince(lc.channel, s.stream.startedAt)
      .catch(() => []))
      s.detector.addClip(c);
  }
  for (const m of s.detector.poll(Date.now())) {
    s.waiting.push({ m, since: Date.now() });
    state.sent.push(m.at);
    log("info", "live clips: a moment", {
      at: new Date(m.at).toISOString(),
      score: m.score,
      signals: m.signals.map((x) => x.kind).join("+"),
    });
  }
  for (const w of [...s.waiting]) {
    const need = segmentsFor(segs, w.m.start, w.m.end);
    if (!need) {
      // A hole in the copy: a viewer's clip of it is the fallback, otherwise it is let go after three minutes.
      if (Date.now() - w.since > 3 * 60_000) {
        s.waiting.splice(s.waiting.indexOf(w), 1);
        const clip = w.m.signals.find((x) => x.kind === "clip");
        if (clip) void fromViewerClip(cfg, s.stream, w.m, clip.detail, state);
        else
          log(
            "warn",
            "live clips: the moment's footage is incomplete; let go",
            { at: new Date(w.m.at).toISOString() },
          );
      }
      continue;
    }
    s.waiting.splice(s.waiting.indexOf(w), 1);
    // Copied aside now: the buffer moves on while the cut waits its turn.
    const held = path.join(liveDir(cfg.dataDir), "held", String(w.m.at));
    await fsp.mkdir(held, { recursive: true });
    for (const n of need.names)
      await fsp.copyFile(path.join(bufDir, n), path.join(held, n));
    void cutToInbox(cfg, s.stream, w.m, held, need, state);
  }
  for (const n of expiredSegments(segs, Date.now(), lc.bufferMinutes)) {
    s.measured.delete(n);
    await fsp.rm(path.join(bufDir, n), { force: true });
  }
}

async function cutToInbox(
  cfg: Config,
  stream: LiveStream,
  m: Moment,
  held: string,
  need: { names: string[]; offset: number },
  state: LiveState,
) {
  // One cut at a time; the next waits its turn here.
  while (cutting) await new Promise((r) => setTimeout(r, 5_000));
  cutting = true;
  const tmp = path.join(cfg.gameplayRoot, "inbox", `.live_${m.at}`);
  try {
    const frames = await cutClip({
      ffmpeg: FFMPEG,
      pieces: need.names.map((n) => path.join(held, n)),
      offset: need.offset,
      seconds: CLIP_SECONDS,
      outDir: tmp,
      waitMinutes: cfg.liveClips.waitMinutes,
    });
    await publishToInbox(cfg, stream, m, tmp, frames, state);
    await fsp.rm(held, { recursive: true, force: true });
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    log("warn", "live clips: the cut failed; its pieces are kept", {
      held,
      error: errorMessage(err),
    });
  } finally {
    cutting = false;
  }
}

/** The viewer's own clip (yt-dlp), when the copy has a hole where the moment was. */
async function fromViewerClip(
  cfg: Config,
  stream: LiveStream,
  m: Moment,
  detail: string,
  state: LiveState,
) {
  const id = detail.match(/, ([A-Za-z0-9_-]+)\)$/)?.[1];
  if (!id) return;
  const tmp = path.join(cfg.gameplayRoot, "inbox", `.live_${m.at}`);
  try {
    await fsp.mkdir(path.join(tmp, "frames"), { recursive: true });
    await run(
      cfg.ytdlpPath,
      [
        "-q",
        "-o",
        path.join(tmp, "clip.mp4"),
        "-f",
        "best[ext=mp4]/best",
        `https://clips.twitch.tv/${id}`,
      ],
      { timeout: 5 * 60_000 },
    );
    await run(FFMPEG, [
      "-v",
      "error",
      "-y",
      "-i",
      path.join(tmp, "clip.mp4"),
      "-vf",
      "fps=8/30,scale=480:-2",
      "-frames:v",
      "8",
      path.join(tmp, "frames", "%02d.jpg"),
    ]);
    const frames = (await fsp.readdir(path.join(tmp, "frames")))
      .sort()
      .map((n) => `frames/${n}`);
    // A clip keeps the 30 seconds before the press: the moment sits about 15 s in.
    await publishToInbox(
      cfg,
      stream,
      { ...m, start: m.at - 15_000, end: m.at + 15_000, peakInClip: 15 },
      tmp,
      frames,
      state,
      30,
    );
  } catch (err) {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    log("warn", "live clips: the viewer clip could not be fetched", {
      error: errorMessage(err),
    });
  }
}

async function publishToInbox(
  cfg: Config,
  stream: LiveStream,
  m: Moment,
  tmp: string,
  frames: string[],
  state: LiveState,
  seconds = CLIP_SECONDS,
) {
  const meta = liveMeta(m, stream, frames, new Date());
  meta.clip.seconds = seconds;
  await writeWhole(path.join(tmp, "meta.json"), JSON.stringify(meta, null, 2));
  // The folder appears whole, so the lane never reads a half-made clip.
  await fsp.rename(tmp, path.join(cfg.gameplayRoot, "inbox", meta.id));
  // The state is saved by the next pass, which may not be the one that started this cut.
  const from = meta.clip.start_in_source ?? 0;
  newlyTaken.push({ stream: stream.id, span: [from, from + seconds] });
  log("info", "live clips: a clip is in the gameplay inbox", {
    id: meta.id,
    score: m.score,
    minutes_after: Math.round((Date.now() - m.at) / 6000) / 10,
  });
}

/** Ended streams get their VOD's id, and live_taken.json is rewritten for the nightly finder. */
async function findVods(cfg: Config, helix: Helix, state: LiveState) {
  let changed = false;
  for (const [id, st] of Object.entries(state.streams)) {
    if (st.vod || !st.ended || !st.taken.length || !helix.ready) continue;
    if (Date.now() - Date.parse(st.ended) > 3 * 86_400_000) continue;
    const vod = await helix
      .vodFor(cfg.liveClips.channel, id)
      .catch(() => undefined);
    if (vod) {
      st.vod = vod;
      changed = true;
    }
  }
  if (changed)
    await writeWhole(
      path.join(cfg.gameplayRoot, "live_taken.json"),
      JSON.stringify(takenByVod(state), null, 2),
    );
}

/** Stops everything (the server shutting down). */
export function stopLiveClips(): void {
  session?.recorder?.stop();
  session?.chat?.close();
  session = undefined;
}
