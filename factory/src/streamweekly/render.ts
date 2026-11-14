// Rendering the cut: each stretch of the recordings is cut once into the episode folder (1080p30, its sound brought
// to one loudness so a quiet stream and a loud one sit together), then the PulseStreamWeekly composition draws the
// timeline over them inside a render turn (the PC orchestrator's, or none on the Mac).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { renderStill, selectComposition } from "@remotion/renderer";
import { FFMPEG } from "../lib/bin.ts";
import {
  getBundle,
  renderWithTurn,
  serveDir,
  webPath,
} from "../render/render.ts";
import type { StreamWeeklyProps } from "../render/StreamWeekly.tsx";
import { DUCK, type Timeline } from "./timeline.ts";

const run = promisify(execFile);

/** The ffmpeg arguments that cut one stretch to the episode's format (pure). */
export function cutArgs(
  source: string,
  from: number,
  len: number,
  out: string,
): string[] {
  return [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    from.toFixed(3),
    "-t",
    len.toFixed(3),
    "-i",
    source,
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30,format=yuv420p",
    "-af",
    "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    out,
  ];
}

/** A cut's file name: the same stretch is cut once, whatever the clip is called (pure). */
export function cutName(source: string, from: number, len: number): string {
  return `cut_${crypto
    .createHash("sha1")
    .update(`${source}|${from.toFixed(2)}|${len.toFixed(2)}`)
    .digest("hex")
    .slice(0, 12)}.mp4`;
}

/** Cuts every clip of the timeline that is not cut yet; returns key -> file relative to the episode folder. */
export async function cutClips(
  tl: Timeline,
  episodeDir: string,
  o: { cut?: (args: string[]) => Promise<void> } = {},
): Promise<Map<string, string>> {
  await fs.mkdir(path.join(episodeDir, "clips"), { recursive: true });
  const out = new Map<string, string>();
  for (const c of tl.clips) {
    const rel = path.join("clips", cutName(c.source, c.srcFrom, c.len));
    const abs = path.join(episodeDir, rel);
    const have = await fs.stat(abs).catch(() => undefined);
    if (!have?.size) {
      const tmp = `${abs}.part.mp4`;
      const args = cutArgs(c.source, c.srcFrom, c.len, tmp);
      if (o.cut) await o.cut(args);
      else
        await run(FFMPEG, args, {
          timeout: 15 * 60_000,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
        });
      await fs.rename(tmp, abs);
    }
    out.set(c.key, rel);
  }
  return out;
}

/** The composition's props from the timeline, the cut files and the end card (pure). */
export function weekProps(
  tl: Timeline,
  files: Map<string, string>,
  o: {
    game: string;
    base: string;
    endLine: string;
    next: StreamWeeklyProps["next"];
  },
): StreamWeeklyProps {
  const url = (rel: string) => `${o.base}/${webPath(rel)}`;
  return {
    durationSeconds: tl.seconds,
    game: o.game,
    clips: tl.clips.map((c) => ({
      key: c.key,
      src: url(files.get(c.key)!),
      at: c.at,
      len: c.len,
      ducked: c.ducked,
      muted: c.muted,
      ...(c.fadeOut ? { fadeOut: true } : {}),
    })),
    voices: tl.voices.map((v) => ({
      key: v.key,
      src: url(v.file),
      at: v.at,
      len: v.len,
    })),
    cards: tl.cards,
    labels: tl.labels.map((l) => ({
      key: l.key,
      tag: l.tag,
      text: l.text,
      at: l.at,
      len: l.len,
    })),
    title: tl.title,
    teaser: tl.teaser,
    endCard: tl.endCard,
    endLine: o.endLine,
    next: o.next
      ? { ...o.next, thumbSrc: o.next.thumbSrc ? url(o.next.thumbSrc) : null }
      : null,
    logoSrc: "logo.png",
    duck: DUCK,
  };
}

export interface WeekRenderInput {
  episodeDir: string;
  timeline: Timeline;
  game: string;
  outFile: string;
  posterFile: string;
  endLine: string;
  next: StreamWeeklyProps["next"];
  concurrency: number;
  gl?: "swangle" | "angle" | "egl" | "swiftshader" | "vulkan" | "angle-egl";
  browserExecutable?: string;
}

export async function renderWeek(input: WeekRenderInput): Promise<void> {
  const files = await cutClips(input.timeline, input.episodeDir);
  const serveUrl = await getBundle();
  const server = await serveDir(input.episodeDir);
  try {
    const props = weekProps(input.timeline, files, {
      game: input.game,
      base: server.url,
      endLine: input.endLine,
      next: input.next,
    });
    const browserExecutable = input.browserExecutable || undefined;
    const chromiumOptions = { gl: input.gl ?? "swangle" } as const;
    const composition = await selectComposition({
      serveUrl,
      id: "PulseStreamWeekly",
      inputProps: props,
      browserExecutable,
    });
    await renderWithTurn(`weekly ${path.basename(input.outFile)}`, {
      composition,
      serveUrl,
      codec: "h264",
      crf: 19,
      pixelFormat: "yuv420p",
      audioCodec: "aac",
      audioBitrate: "192k",
      outputLocation: input.outFile,
      inputProps: props,
      concurrency: input.concurrency,
      browserExecutable,
      chromiumOptions,
      timeoutInMilliseconds: 180_000,
    });
    const top = input.timeline.labels[0];
    await renderStill({
      composition,
      serveUrl,
      output: input.posterFile,
      inputProps: props,
      frame: Math.min(
        composition.durationInFrames - 1,
        Math.round(((top?.at ?? 2) + 1) * composition.fps),
      ),
      imageFormat: "jpeg",
      jpegQuality: 88,
      browserExecutable,
      chromiumOptions,
    });
  } finally {
    await server.close();
  }
}

// ---------------------------------------------------------------- after the render

/** Silences longer than `min` seconds in an ffmpeg silencedetect log (pure). */
export function parseSilences(log: string, min = 0): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  for (const line of log.split("\n")) {
    const s = line.match(/silence_start:\s*(-?[\d.]+)/);
    if (s) start = Number(s[1]);
    const e = line.match(/silence_end:\s*([\d.]+)/);
    if (e && start !== undefined) {
      if (Number(e[1]) - start >= min) out.push({ start: Math.max(0, start), end: Number(e[1]) });
      start = undefined;
    }
  }
  return out;
}

export interface WeekCheck {
  ok: boolean;
  problems: string[];
  loudnessLufs: number;
  blackSeconds: number;
  silences: Array<{ start: number; end: number }>;
  seconds: number;
}

/**
 * The finished file measured at full frame rate: resolution, codec, length against the timeline, loudness (mastered
 * to -16 LUFS first), black frames and flashes at cuts (chapter starts allowed), and no silence over 3 seconds before
 * the end card (dead air is the enemy of a long video).
 */
export async function checkWeekRender(file: string, tl: Timeline): Promise<WeekCheck> {
  const { technicalQa, normaliseLoudness } = await import("../qa/media.ts");
  const mastered = `${file}.master.mp4`;
  await normaliseLoudness(file, mastered);
  await fs.rename(mastered, file);
  const qa = await technicalQa(file, tl.seconds, {
    minSeconds: Math.max(10, tl.seconds - 2),
    maxSeconds: tl.seconds + 2,
    width: 1920,
    height: 1080,
    chapterStarts: tl.cards.map((c) => c.at),
  });
  const { stderr } = await run(FFMPEG, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=noise=-50dB:d=3", "-f", "null", "-"], { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000, windowsHide: true });
  const silences = parseSilences(stderr, 3).filter((s) => s.start < tl.endCard.at - 0.5);
  const problems = [...qa.problems, ...silences.map((s) => `${(s.end - s.start).toFixed(1)} s of silence at ${s.start.toFixed(1)} s`)];
  return { ok: !problems.length, problems, loudnessLufs: qa.loudnessLufs, blackSeconds: qa.blackSeconds, silences, seconds: qa.probe.durationSeconds };
}

/** Contact sheets: one frame every `every` seconds, 64 to a sheet (eight across). */
export async function contactSheet(file: string, out: string, every = 6): Promise<void> {
  // No burnt-in clock (ffmpeg's drawtext needs a font file on Windows): sheet n, tile k is at ((n - 1) * 64 + k) * every s.
  const vf = `fps=1/${every},scale=320:-1,tile=8x8`;
  await run(FFMPEG, ["-loglevel", "error", "-y", "-i", file, "-vf", vf, out.replace(/\.jpg$/, "_%02d.jpg")], {
    timeout: 30 * 60_000,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
}
