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
  ok: boolean;
  problems: string[];
  probe: ProbeResult;
  loudnessLufs: number;
  blackSeconds: number;
}

export async function technicalQa(file: string, expectedSeconds: number): Promise<TechQa> {
  const p = await probe(file);
  const lufs = await loudness(file);
  const black = await blackSeconds(file);
  const problems: string[] = [];
  if (p.width !== 1080 || p.height !== 1920) problems.push(`Resolution is ${p.width}x${p.height}, expected 1080x1920.`);
  if (p.videoCodec !== "h264") problems.push(`Video codec is ${p.videoCodec}, expected h264.`);
  if (!p.hasAudio) problems.push("No audio stream.");
  if (p.durationSeconds < 12 || p.durationSeconds > 59) problems.push(`Duration ${p.durationSeconds.toFixed(1)}s is outside 12-59s.`);
  if (Math.abs(p.durationSeconds - expectedSeconds) > 1.5) problems.push(`Duration ${p.durationSeconds.toFixed(1)}s does not match narration ${expectedSeconds.toFixed(1)}s.`);
  if (!Number.isFinite(lufs) || lufs < -26 || lufs > -9) problems.push(`Integrated loudness ${lufs} LUFS is outside -26 to -9.`);
  if (black > 0.8) problems.push(`${black.toFixed(1)}s of black frames.`);
  return { ok: problems.length === 0, problems, probe: p, loudnessLufs: lufs, blackSeconds: black };
}

/** Brings the mix to the -14 LUFS platforms normalise to, without re-encoding video. */
export async function normaliseLoudness(input: string, output: string): Promise<void> {
  await run(FFMPEG, [
    "-loglevel", "error", "-y", "-i", input,
    "-c:v", "copy",
    "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    output,
  ]);
}
