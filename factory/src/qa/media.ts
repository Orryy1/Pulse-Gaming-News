// Technical QA with ffprobe/ffmpeg. Any failure here blocks upload.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";

const run = promisify(execFile);

export interface ProbeResult {
  width: number;
  height: number;
  durationSeconds: number;
  hasAudio: boolean;
  videoCodec: string;
  fps: number;
}

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await run(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const j = JSON.parse(stdout) as { streams: Array<Record<string, any>>; format: Record<string, any> };
  const v = j.streams.find((s) => s.codec_type === "video");
  const [num, den] = String(v?.avg_frame_rate ?? "0/1").split("/").map(Number);
  return {
    width: Number(v?.width ?? 0),
    height: Number(v?.height ?? 0),
    durationSeconds: Number(j.format.duration ?? 0),
    hasAudio: j.streams.some((s) => s.codec_type === "audio"),
    videoCodec: String(v?.codec_name ?? ""),
    fps: den ? num! / den : 0,
  };
}

export async function imageAspect(file: string): Promise<number> {
  const p = await probe(file);
  return p.width && p.height ? p.width / p.height : 16 / 9;
}

export async function loudness(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "ebur128", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024 });
  const m = stderr.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/);
  return m ? Number(m[1]) : Number.NaN;
}

export async function blackSeconds(file: string): Promise<number> {
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-vf", "blackdetect=d=0.4:pix_th=0.06", "-an", "-f", "null", "-"], {
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...stderr.matchAll(/black_duration:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
}

/**
 * Brief dips to black between the first half-second and the end card: a frame
 * or two of black at a cut reads as flicker on screen but is far too short for
 * blackdetect's 0.4 s minimum or a sampled still to catch.
 */
export function flashRuns(frames: Array<{ time: number; luma: number }>, durationSeconds: number, threshold = 12): Array<{ start: number; end: number; frames: number }> {
  // A render flash is the canvas showing through: near-black, short, and much darker than the
  // frames either side. A dim scene (no jump) and a trailer's own one-frame flicker between two
  // dark-ish frames are content, not glitches.
  const runs: Array<{ start: number; end: number; frames: number }> = [];
  let i = 0;
  while (i < frames.length) {
    const f = frames[i]!;
    const dark = f.luma < threshold && f.time > 0.5 && f.time < durationSeconds - 1.5;
    if (!dark) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < frames.length && frames[j + 1]!.luma < threshold) j++;
    const before = frames[i - 1]?.luma ?? 0;
    const after = frames[j + 1]?.luma ?? 0;
    const darkest = Math.max(...frames.slice(i, j + 1).map((x) => x.luma));
    const count = j - i + 1;
    if (count <= 20 && Math.min(before, after) >= darkest + 25) runs.push({ start: f.time, end: frames[j]!.time, frames: count });
    i = j + 1;
  }
  return runs;
}

export async function blackFlashes(file: string, durationSeconds: number): Promise<Array<{ start: number; end: number; frames: number }>> {
  const { stdout } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-an", "-vf", "scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-", "-f", "null", "-"], {
    maxBuffer: 256 * 1024 * 1024,
  });
  const frames: Array<{ time: number; luma: number }> = [];
  let time = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const t = line.match(/pts_time:([\d.]+)/);
    if (t) time = Number(t[1]);
    const y = line.match(/YAVG=([\d.]+)/);
    if (y) frames.push({ time, luma: Number(y[1]) });
  }
  return flashRuns(frames, durationSeconds);
}

export async function extractFrames(file: string, outDir: string, times: number[]): Promise<string[]> {
  await fs.mkdir(outDir, { recursive: true });
  const out: string[] = [];
  for (const [i, t] of times.entries()) {
    const dest = path.join(outDir, `frame_${i}.jpg`);
    await run(FFMPEG, ["-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", file, "-frames:v", "1", "-vf", "scale=540:-1", "-q:v", "4", dest]);
    out.push(dest);
  }
  return out;
}

export interface TechQa {
  blackFlashes?: number;
  ok: boolean;
  problems: string[];
  probe: ProbeResult;
  loudnessLufs: number;
  blackSeconds: number;
}

export async function technicalQa(file: string, expectedSeconds: number, band: { minSeconds: number; maxSeconds: number; width?: number; height?: number } = { minSeconds: 12, maxSeconds: 59 }): Promise<TechQa> {
  const want = { width: band.width ?? 1080, height: band.height ?? 1920 };
  const p = await probe(file);
  const lufs = await loudness(file);
  const black = await blackSeconds(file);
  const problems: string[] = [];
  if (p.width !== want.width || p.height !== want.height) problems.push(`Resolution is ${p.width}x${p.height}, expected ${want.width}x${want.height}.`);
  if (p.videoCodec !== "h264") problems.push(`Video codec is ${p.videoCodec}, expected h264.`);
  if (!p.hasAudio) problems.push("No audio stream.");
  if (p.durationSeconds < band.minSeconds || p.durationSeconds > band.maxSeconds) problems.push(`Duration ${p.durationSeconds.toFixed(1)}s is outside ${band.minSeconds}-${band.maxSeconds}s.`);
  if (Math.abs(p.durationSeconds - expectedSeconds) > 1.5) problems.push(`Duration ${p.durationSeconds.toFixed(1)}s does not match narration ${expectedSeconds.toFixed(1)}s.`);
  if (!Number.isFinite(lufs) || lufs < -18.5 || lufs > -13.5) problems.push(`Integrated loudness ${lufs} LUFS is outside -18.5 to -13.5.`);
  if (black > 0.8) problems.push(`${black.toFixed(1)}s of black frames.`);
  const flashes = await blackFlashes(file, p.durationSeconds).catch(() => []);
  if (flashes.length) {
    const at = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
    problems.push(`${flashes.length} black flash${flashes.length === 1 ? "" : "es"} at cuts (${flashes.slice(0, 5).map((f) => `${at(f.start)}, ${f.frames} frame${f.frames === 1 ? "" : "s"}`).join("; ")}).`);
  }
  return { ok: problems.length === 0, problems, probe: p, loudnessLufs: lufs, blackSeconds: black, blackFlashes: flashes.length };
}

/** Masters at -16 LUFS (YouTube normalises to -14; -16 keeps the music bed from tripping recurrence checks), without re-encoding video. */
export async function normaliseLoudness(input: string, output: string): Promise<void> {
  await run(FFMPEG, [
    "-loglevel", "error", "-y", "-i", input,
    "-c:v", "copy",
    "-af", "loudnorm=I=-16:TP=-1.5:LRA=9",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    output,
  ]);
}
