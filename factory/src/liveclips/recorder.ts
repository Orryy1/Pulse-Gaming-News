// The live stream's last few minutes on disk (LIVE_CLIPS), and the cut from them. yt-dlp reads the stream (it keeps
// Twitch's access token fresh) and ffmpeg copies it, untouched, into 10-second pieces named by the wall clock in UTC
// ("seg_20261118T113005.ts"), so any moment's window is a handful of files. Copying costs almost nothing; both run at
// macOS background priority. The cut (a re-encode of 40 seconds, and eight frames) waits its turn behind Pulse's own
// renders through ~/orch/macrun.sh. Its pieces are copied aside first, so a long wait never loses the moment.

import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { SecondSample } from "./detect.ts";

const run = promisify(execFile);
export const SEGMENT_SECONDS = 10;

/** "seg_20261118T113005.ts" -> its start (ms), or undefined (pure). */
export function segmentStart(name: string): number | undefined {
  const m = name.match(/^seg_(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)\.ts$/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number) as number[];
  return Date.UTC(y!, mo! - 1, d!, h!, mi!, s!);
}

export interface Segment {
  name: string;
  start: number;
}

/** The pieces in a folder, oldest first (the newest is still being written and is left out). */
export function listSegments(dir: string): Segment[] {
  const all = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
    .map((name) => ({ name, start: segmentStart(name) }))
    .filter((s): s is Segment => s.start !== undefined)
    .sort((a, b) => a.start - b.start);
  return all.slice(0, -1);
}

/**
 * The pieces a window needs and where it starts inside the first one, or undefined while the window's end is not
 * recorded yet or a piece is missing (pure).
 */
export function segmentsFor(
  segs: Segment[],
  start: number,
  end: number,
): { names: string[]; offset: number } | undefined {
  const next = (i: number) =>
    segs[i + 1]?.start ?? segs[i]!.start + SEGMENT_SECONDS * 1000;
  const picked = segs.filter((s, i) => s.start < end && next(i) > start);
  if (!picked.length) return undefined;
  const last = segs.indexOf(picked[picked.length - 1]!);
  // The last piece listed is finished (listSegments drops the one being written), so its end is known.
  if (next(last) < end) return undefined;
  if (picked[0]!.start > start + 2000) return undefined;
  // A hole (the recorder restarted) inside the window: cut what is whole, never a jump.
  for (let i = 1; i < picked.length; i++)
    if (picked[i]!.start - picked[i - 1]!.start > SEGMENT_SECONDS * 1000 + 3000)
      return undefined;
  return {
    names: picked.map((s) => s.name),
    offset: Math.max(0, (start - picked[0]!.start) / 1000),
  };
}

/** Pieces older than the buffer (pure): the names to delete. */
export function expiredSegments(
  segs: Segment[],
  now: number,
  bufferMinutes: number,
): string[] {
  return segs
    .filter((s) => now - s.start > bufferMinutes * 60_000)
    .map((s) => s.name);
}

export interface Recorder {
  readonly startedAt: number;
  alive(): boolean;
  stop(): void;
}

/** Background priority on a Mac (efficiency cores, throttled disk and network); as is elsewhere. */
function background(cmd: string, args: string[]): [string, string[]] {
  return process.platform === "darwin" && fs.existsSync("/usr/sbin/taskpolicy")
    ? ["/usr/sbin/taskpolicy", ["-b", cmd, ...args]]
    : [cmd, args];
}

/** Starts the stream copy into dir. */
export function startRecorder(o: {
  channel: string;
  dir: string;
  maxHeight: number;
  ytdlp: string;
  ffmpeg: string;
  onExit?: (why: string) => void;
}): Recorder {
  fs.mkdirSync(o.dir, { recursive: true });
  const [yc, ya] = background(o.ytdlp, [
    "--quiet",
    "--no-warnings",
    "--no-part",
    "-f",
    `best[height<=${o.maxHeight}]/best`,
    "-o",
    "-",
    `https://www.twitch.tv/${o.channel}`,
  ]);
  const [fc, fa] = background(o.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    "pipe:0",
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c",
    "copy",
    "-f",
    "segment",
    "-segment_time",
    String(SEGMENT_SECONDS),
    "-reset_timestamps",
    "1",
    "-strftime",
    "1",
    path.join(o.dir, "seg_%Y%m%dT%H%M%S.ts"),
  ]);
  const yt: ChildProcess = spawn(yc, ya, { stdio: ["ignore", "pipe", "pipe"] });
  // UTC names, whatever the Mac's time zone.
  const ff: ChildProcess = spawn(fc, fa, {
    stdio: ["pipe", "ignore", "pipe"],
    env: { ...process.env, TZ: "UTC" },
  });
  yt.stdout!.pipe(ff.stdin!);
  ff.stdin!.on("error", () => undefined);
  let err = "";
  yt.stderr!.on("data", (d) => (err = (err + String(d)).slice(-500)));
  ff.stderr!.on("data", (d) => (err = (err + String(d)).slice(-500)));
  let done = false;
  const finish = (who: string, code: number | null) => {
    if (done) return;
    done = true;
    yt.kill();
    ff.kill();
    o.onExit?.(`${who} stopped (${code ?? "signal"}) ${err.trim()}`.trim());
  };
  yt.on("exit", (c) => finish("yt-dlp", c));
  ff.on("exit", (c) => finish("ffmpeg", c));
  return {
    startedAt: Date.now(),
    alive: () => !done,
    stop: () => finish("stop", 0),
  };
}

/** Per-second loudness (dB) from ffmpeg's astats output (pure). */
export function parseLoudness(stderr: string): number[] {
  return [...stderr.matchAll(/RMS_level=(-?[\d.]+|-inf)/g)].map((m) =>
    m[1] === "-inf" ? -90 : Math.max(-90, Number(m[1])),
  );
}

/** Per-second scene-change scores from ffmpeg's metadata output, keyframe gaps filled as the finder does (pure). */
export function parseMotion(stderr: string, seconds: number): number[] {
  const out = new Array(Math.max(1, Math.ceil(seconds))).fill(0) as number[];
  let t: number | null = null;
  for (const line of stderr.split("\n")) {
    const pt = line.match(/pts_time:([\d.]+)/);
    if (pt) t = Number(pt[1]);
    const sc = line.match(/scene_score=([\d.]+)/);
    if (sc && t !== null) {
      const i = Math.min(out.length - 1, Math.floor(t));
      out[i] = Math.max(out[i]!, Number(sc[1]));
    }
  }
  for (let i = 1; i < out.length; i++) if (!out[i]) out[i] = out[i - 1]! * 0.9;
  return out;
}

/**
 * One recording's (a 10-second piece, or a whole VOD for the replay) sound and picture per second, the finder's
 * measures: RMS loudness of each second, and the scene change at each keyframe.
 */
export async function measure(
  ffmpeg: string,
  file: string,
  startMs: number,
  seconds: number,
): Promise<SecondSample[]> {
  const opts = { maxBuffer: 1 << 28 };
  const [cl, al] = background(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-i",
    file,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-af",
    "asetnsamples=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
    "-f",
    "null",
    "-",
  ]);
  const [cm, am] = background(ffmpeg, [
    "-hide_banner",
    "-nostats",
    "-skip_frame",
    "nokey",
    "-i",
    file,
    "-an",
    "-vf",
    "scale=160:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
    "-fps_mode",
    "passthrough",
    "-f",
    "null",
    "-",
  ]);
  const [loudErr, motionErr] = await Promise.all([
    run(cl, al, opts).then(
      (r) => r.stderr,
      (e: { stderr?: string }) => e.stderr ?? "",
    ),
    run(cm, am, opts).then(
      (r) => r.stderr,
      (e: { stderr?: string }) => e.stderr ?? "",
    ),
  ]);
  const loud = parseLoudness(loudErr);
  const motion = parseMotion(motionErr, seconds);
  const n = Math.min(Math.round(seconds), loud.length || Math.round(seconds));
  return Array.from({ length: n }, (_, i) => ({
    at: startMs + i * 1000,
    loud: loud[i] ?? -90,
    motion: motion[i] ?? 0,
  }));
}

/** A job behind the Mac's turn-taker (Pulse's renders first), at background priority where it is not installed. */
export function behindRenders(
  name: string,
  cmd: string,
  args: string[],
): [string, string[]] {
  const macrun = path.join(os.homedir(), "orch", "macrun.sh");
  return fs.existsSync(macrun)
    ? ["/bin/bash", [macrun, name, cmd, ...args]]
    : background(cmd, args);
}

/** The cut: the pieces joined, 40 seconds from offset re-encoded to clip.mp4, and eight frames for the reviewer. */
export async function cutClip(o: {
  ffmpeg: string;
  pieces: string[];
  offset: number;
  seconds: number;
  outDir: string;
  waitMinutes: number;
}): Promise<string[]> {
  await fsp.mkdir(path.join(o.outDir, "frames"), { recursive: true });
  const clip = path.join(o.outDir, "clip.mp4");
  const encoder =
    process.platform === "darwin"
      ? ["libx264", "-preset", "fast", "-crf", "15"]
      : ["libx264", "-preset", "veryfast", "-crf", "17"];
  const env = { ...process.env, MACRUN_WAIT_MIN: String(o.waitMinutes) };
  const [c, a] = behindRenders("pulse-liveclip", o.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    `concat:${o.pieces.join("|")}`,
    "-ss",
    o.offset.toFixed(2),
    "-t",
    String(o.seconds),
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-c:v",
    ...encoder,
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    clip,
  ]);
  await run(c, a, { env, timeout: (o.waitMinutes + 10) * 60_000 });
  const [fc, fa] = background(o.ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    clip,
    "-vf",
    `fps=8/${o.seconds},scale=480:-2`,
    "-frames:v",
    "8",
    path.join(o.outDir, "frames", "%02d.jpg"),
  ]);
  await run(fc, fa, { timeout: 5 * 60_000 });
  return (await fsp.readdir(path.join(o.outDir, "frames")))
    .filter((n) => n.endsWith(".jpg"))
    .sort()
    .map((n) => `frames/${n}`);
}
