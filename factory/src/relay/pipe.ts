// The relay's pipe: streamlink reads the Twitch stream (ads filtered out) and ffmpeg pushes it to YouTube's ingest.
//
//   plain (RELAY_MUSIC_STRIP off):  streamlink -O | ffmpeg -c copy -f flv <ingest>
//       no re-encode at all: YouTube gets exactly what the Xbox sent Twitch, at a few per cent of one core.
//   music strip (RELAY_MUSIC_STRIP on, RELAY_MUSIC_STRIP_CMD set):
//       streamlink -O | ffmpeg A ──video, copied, MPEG-TS on fd 3──────────────────────▶ ffmpeg B -c:v copy -c:a aac
//                               └─audio, 48 kHz stereo s16le on stdout ─▶ filter ─▶ stdin ┘            -f flv <ingest>
//       only the audio is decoded and re-encoded. Both legs start at zero (A uses -copyts -start_at_zero), and A's
//       audio is resampled against its timestamps (aresample async), so an ad gap becomes silence rather than drift.
//       The filter is the claude/avtools helper's job; the relay only promises it PCM in and expects PCM out.
//
// A watchdog restarts the chain when it exits or when no bytes have come from Twitch for 45 seconds, waiting longer
// each time (5 s up to 2 min) and giving up after 8 failures inside 10 minutes. The ingest address carries the
// stream key, so every line of process output is passed through redact() before it is kept or logged.

import { spawn, type ChildProcess } from "node:child_process";

export const PCM_ARGS = ["-f", "s16le", "-ar", "48000", "-ac", "2"];

export function streamlinkArgs(channel: string, quality: string): string[] {
  return [
    "--twitch-disable-ads",
    "--retry-streams",
    "5",
    "--retry-max",
    "6",
    "--stream-segment-attempts",
    "5",
    "--stream-timeout",
    "60",
    "--loglevel",
    "warning",
    "--stdout",
    `https://www.twitch.tv/${channel}`,
    quality,
  ];
}

const head = ["-hide_banner", "-loglevel", "warning"];
const flvOut = (url: string) => [
  "-f",
  "flv",
  "-flvflags",
  "no_duration_filesize",
  url,
];

/** ffmpeg for the plain pipe: everything copied (pure). */
export function plainArgs(url: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-fflags",
    "+genpts+discardcorrupt",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-bsf:a",
    "aac_adtstoasc",
    ...flvOut(url),
  ];
}

/** ffmpeg A of the music-strip pipe: video copied to fd 3, audio as PCM to stdout (pure). */
export function splitArgs(): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-fflags",
    "+genpts+discardcorrupt",
    "-copyts",
    "-start_at_zero",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-c:v",
    "copy",
    "-muxdelay",
    "0",
    "-muxpreload",
    "0",
    "-f",
    "mpegts",
    "pipe:3",
    "-map",
    "0:a:0",
    "-af",
    "aresample=async=1:first_pts=0",
    ...PCM_ARGS,
    "pipe:1",
  ];
}

/** ffmpeg B of the music-strip pipe: copied video from fd 3, filtered PCM from stdin, AAC out (pure). */
export function joinArgs(url: string): string[] {
  return [
    ...head,
    "-thread_queue_size",
    "1024",
    "-i",
    "pipe:3",
    "-thread_queue_size",
    "1024",
    ...PCM_ARGS,
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    ...flvOut(url),
  ];
}

const KEYISH = /(rtmps?:\/\/[^\s"']+)/gi;

/** Text with the ingest address, the key and any RTMP URL replaced (pure). */
export function redact(text: string, secrets: string[] = []): string {
  let out = text.replace(KEYISH, "rtmp://[hidden]");
  for (const s of secrets) if (s) out = out.split(s).join("[hidden]");
  return out;
}

/** The key part of an ingest URL (the last path piece), for redaction. */
export const keyOf = (url: string) => url.split("/").pop() ?? "";

export interface PipeOptions {
  channel: string;
  quality: string;
  url: string;
  streamlink: string;
  ffmpeg: string;
  /** The music filter, run through /bin/sh; empty = the plain pipe. */
  filterCmd?: string;
  onEvent?: (
    kind: "started" | "exited" | "stalled" | "gave-up",
    detail: string,
  ) => void;
  spawnFn?: typeof spawn;
  stallSeconds?: number;
}

export interface PipeHandle {
  alive(): boolean;
  /** Last time bytes came from Twitch (ms). */
  lastData(): number;
  /** Kills the chain and starts it again now. */
  restart(why: string): void;
  stop(): void;
  /** True once the watchdog gave up (too many failures). */
  gaveUp(): boolean;
}

/** The wait before restart n (1-based): 5 s doubling to 2 min (pure). */
export const backoff = (n: number) =>
  Math.min(120_000, 5_000 * 2 ** Math.max(0, n - 1));

export function startPipe(o: PipeOptions): PipeHandle {
  const sp = o.spawnFn ?? spawn;
  const secrets = [o.url, keyOf(o.url)];
  const stall = (o.stallSeconds ?? 45) * 1000;
  let procs: ChildProcess[] = [];
  let lastData = Date.now();
  let stopped = false;
  let gaveUp = false;
  let fails: number[] = [];
  let timer: NodeJS.Timeout | undefined;
  let tail = "";
  const note = (b: Buffer) => {
    tail = redact((tail + b.toString()).slice(-600), secrets);
  };

  const kill = () => {
    for (const p of procs) {
      p.removeAllListeners("exit");
      if (p.exitCode === null) p.kill("SIGTERM");
    }
    procs = [];
  };

  const launch = () => {
    if (stopped) return;
    lastData = Date.now();
    tail = "";
    const sl = sp(o.streamlink, streamlinkArgs(o.channel, o.quality), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    sl.stdout!.on("data", () => {
      lastData = Date.now();
    });
    sl.stderr!.on("data", note);
    if (o.filterCmd) {
      const a = sp(o.ffmpeg, splitArgs(), {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      });
      const f = sp("/bin/sh", ["-c", o.filterCmd], {
        stdio: ["pipe", "pipe", "pipe"],
      });
      const b = sp(o.ffmpeg, joinArgs(o.url), {
        stdio: ["pipe", "ignore", "pipe", "pipe"],
      });
      sl.stdout!.pipe(a.stdin!);
      (a.stdio[3] as NodeJS.ReadableStream).pipe(
        b.stdio[3] as NodeJS.WritableStream,
      );
      a.stdout!.pipe(f.stdin!);
      f.stdout!.pipe(b.stdin!);
      for (const p of [a, f, b]) p.stderr!.on("data", note);
      procs = [sl, a, f, b];
    } else {
      const ff = sp(o.ffmpeg, plainArgs(o.url), {
        stdio: ["pipe", "ignore", "pipe"],
      });
      sl.stdout!.pipe(ff.stdin!);
      ff.stderr!.on("data", note);
      procs = [sl, ff];
    }
    // A broken pipe on one side is expected while the chain comes down; exit events drive the restart.
    for (const p of procs) {
      for (const s of [p.stdin, p.stdout, p.stderr])
        s?.on("error", () => undefined);
      p.on("error", () => undefined);
      p.on("exit", (code) => onExit(`exit ${code ?? "signal"}`));
    }
    o.onEvent?.("started", o.filterCmd ? "music filter on" : "plain copy");
  };

  const onExit = (why: string) => {
    if (stopped) return;
    kill();
    const now = Date.now();
    fails = [...fails.filter((t) => now - t < 10 * 60_000), now];
    o.onEvent?.("exited", `${why}: ${tail.trim().slice(-300)}`);
    if (fails.length >= 8) {
      gaveUp = true;
      o.onEvent?.("gave-up", tail.trim().slice(-300));
      return;
    }
    setTimeout(launch, backoff(fails.length));
  };

  timer = setInterval(() => {
    if (stopped || !procs.length) return;
    if (Date.now() - lastData > stall) {
      o.onEvent?.(
        "stalled",
        `no data from Twitch for ${Math.round(stall / 1000)} s`,
      );
      kill();
      onExit("stalled");
    }
  }, 5_000);
  timer.unref?.();

  launch();
  return {
    alive: () => procs.length > 0 && procs.every((p) => p.exitCode === null),
    lastData: () => lastData,
    gaveUp: () => gaveUp,
    restart(why) {
      if (stopped) return;
      o.onEvent?.("exited", `restart: ${why}`);
      kill();
      gaveUp = false;
      fails = [];
      launch();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      kill();
    },
  };
}
