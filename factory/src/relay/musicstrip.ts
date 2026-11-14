// The live relay's music remover (RELAY_MUSIC_STRIP, off by default). The owner plays GTA with licensed car radio on;
// the relay (claude/streamrelay) copies his Twitch stream to the Pulse YouTube channel, where Content ID can interrupt
// the stream or mute the archive. This is the filter the relay puts between streamlink and its ffmpeg:
//
//   streamlink --stdout <channel> best
//     | ffmpeg #1 (splitArgs):  audio as raw s16le 48 kHz stereo on stdout, video copied as MPEG-TS on pipe:3
//   ffmpeg #1 stdout -> musicstrip (radiostrip.py stream) -> ffmpeg #2 stdin
//   ffmpeg #1 pipe:3 ------------------------------------------> ffmpeg #2 pipe:3
//     ffmpeg #2 (muxArgs): the cleaned audio, the video delayed by exactly sampleDelaySeconds, out to YouTube
//
// The filter's audio runs exactly sampleDelaySeconds (look-ahead plus the cross-fade) behind its input in samples,
// so ffmpeg #2 shifts the video by the same amount with -itsoffset and they stay in sync. In wall-clock time the
// viewer is about wallLatencySeconds further behind Twitch (one block has to arrive and be processed), 10 s at most.
// The filter writes JSON lines on stderr: a "ready" line, then {blocks, rtf, worstSeconds} every minute or so.
// Whether the Mac mini can hold real time is measured, not assumed: see previews/2026-11-14-avtools/live/.
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { AVTOOLS_DIR } from "../assets/radiostrip.ts";
import type { AvToolsSettings } from "../assets/avtools/settings.ts";

export const RELAY_RATE = 48_000;
/** The cross-fade at each block seam (radiostrip.py LiveStripper's default). */
export const SEAM_SECONDS = 0.05;
/** The most the relay may run behind Twitch with the filter in. */
export const MAX_WALL_LATENCY = 10;

export interface MusicStripSpec {
  cmd: string;
  args: string[];
  cwd: string;
  /** The filter's output is this far behind its input in samples: delay the video by exactly this. */
  sampleDelaySeconds: number;
  /** Roughly how far behind the input the output leaves the filter in wall-clock time (before compute). */
  wallLatencySeconds: number;
  format: "s16le";
  rate: number;
  channels: 2;
}

/** The filter's command (pure). passthrough: the same plumbing with no model, to test the relay without the GPU. */
export function musicStripSpec(
  s: Pick<AvToolsSettings, "python" | "models" | "relay">,
  o: { rate?: number; passthrough?: boolean } = {},
): MusicStripSpec {
  const rate = o.rate ?? RELAY_RATE;
  const { block, ahead, left, device } = s.relay;
  return {
    cmd: s.python,
    args: [
      "-I",
      path.join(AVTOOLS_DIR, "radiostrip.py"),
      "stream",
      "--models",
      s.models,
      "--rate",
      String(rate),
      "--block",
      String(block),
      "--ahead",
      String(ahead),
      "--left",
      String(left),
      ...(device ? ["--device", device] : []),
      ...(o.passthrough ? ["--passthrough"] : []),
    ],
    cwd: AVTOOLS_DIR,
    sampleDelaySeconds: round(ahead + SEAM_SECONDS),
    wallLatencySeconds: round(block + ahead + SEAM_SECONDS),
    format: "s16le",
    rate,
    channels: 2,
  };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/** Whether the settings can stay within MAX_WALL_LATENCY given a measured worst step time (pure). */
export function latencyOk(
  spec: Pick<MusicStripSpec, "wallLatencySeconds">,
  worstStepSeconds: number,
): boolean {
  return spec.wallLatencySeconds + worstStepSeconds <= MAX_WALL_LATENCY;
}

/** ffmpeg #1's arguments (pure): the stream on stdin, raw audio to stdout, the video copied to pipe:3. */
export function splitArgs(rate = RELAY_RATE): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    "pipe:0",
    "-map",
    "0:a:0",
    "-f",
    "s16le",
    "-ar",
    String(rate),
    "-ac",
    "2",
    "pipe:1",
    "-map",
    "0:v:0",
    "-c",
    "copy",
    "-f",
    "mpegts",
    "pipe:3",
  ];
}

/** ffmpeg #2's arguments (pure): the cleaned audio on stdin, the video on pipe:3 shifted to match, out to `target`. */
export function muxArgs(
  spec: Pick<MusicStripSpec, "sampleDelaySeconds" | "rate">,
  target: string,
  o: { audioBitrate?: string; format?: string } = {},
): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-thread_queue_size",
    "4096",
    "-f",
    "s16le",
    "-ar",
    String(spec.rate),
    "-ac",
    "2",
    "-i",
    "pipe:0",
    "-thread_queue_size",
    "4096",
    "-itsoffset",
    spec.sampleDelaySeconds.toFixed(3),
    "-f",
    "mpegts",
    "-i",
    "pipe:3",
    "-map",
    "1:v:0",
    "-map",
    "0:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    o.audioBitrate ?? "160k",
    "-f",
    o.format ?? "flv",
    target,
  ];
}

export interface StripStats {
  blocks: number;
  rtf: number;
  worstSeconds: number;
}

/** One stderr line from the filter, when it is one of its JSON reports (pure). */
export function parseStripLine(
  line: string,
):
  | {
      ready?: { sampleDelaySeconds: number; device: string };
      stats?: StripStats;
    }
  | undefined {
  if (!line.startsWith("{")) return undefined;
  try {
    const j = JSON.parse(line) as Record<string, unknown>;
    if (j.musicStrip === "ready")
      return {
        ready: {
          sampleDelaySeconds: Number(j.sampleDelaySeconds),
          device: String(j.device),
        },
      };
    if (typeof j.rtf === "number" && typeof j.blocks === "number")
      return {
        stats: {
          blocks: j.blocks,
          rtf: j.rtf,
          worstSeconds: Number(j.worstSeconds ?? 0),
        },
      };
  } catch {
    // not one of its lines
  }
  return undefined;
}

/**
 * Starts the filter: write the stream's raw audio to its stdin, read the cleaned audio from its stdout. onStats sees
 * every report, so the relay can drop the filter (and carry on with the music, or stop) if it falls behind real time.
 */
export function spawnMusicStrip(
  spec: MusicStripSpec,
  onStats?: (s: StripStats) => void,
): ChildProcess {
  const child = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  let buf = "";
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (d: string) => {
    buf += d;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      const r = parseStripLine(line);
      if (r?.stats) onStats?.(r.stats);
    }
  });
  return child;
}
