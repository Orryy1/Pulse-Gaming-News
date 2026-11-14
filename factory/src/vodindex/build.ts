// Building a stream's index (the part that touches ffmpeg, the text reader, Whisper and the vision model; the rules
// live in the scene index's pure modules, reused as they are). One call does one bounded piece of work and saves, so
// the job can stop after any piece and pick up later (renders always win on the Mac):
//   1. stretch by stretch (VOD_MINER_CHUNK_MINUTES): find the cuts, read the writing on screen now and then, transcribe
//      everything said, and store the shots and the lines;
//   2. describe the shots with the free local vision model (PC Ollama, qwen3-vl:8b, think off) whenever it answers.
// A stream is mostly long unbroken play, so a shot is at most MAX_SHOT_SECONDS long and only every few seconds of
// writing is read (VOD_MINER_OCR_FPS); a six-hour stream is about two thousand shots.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG, FFPROBE } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import { parseSignalStats } from "../assets/clipscore.ts";
import { readText, type OcrPage } from "../assets/ocr.ts";
import { transcribeWords } from "../qa/narration.ts";
import { frameArgs, ocrFrameArgs, scanArgs } from "../sceneindex/build.ts";
import { keyframeTimes, shotsFromScan } from "../sceneindex/shots.ts";
import {
  shotText,
  voiceLines,
  type OcrSample,
  type TextLine,
} from "../sceneindex/dialogue.ts";
import { lookAtShot, visionUp, type ShotLook } from "../sceneindex/describe.ts";
import {
  mergeStretch,
  nextGap,
  type SceneShot,
  type TimedWord,
} from "../sceneindex/schema.ts";
import {
  asSceneIndex,
  emptyVodIndex,
  loadVodIndex,
  parseVodName,
  saveVodIndex,
  vodIndexDir,
  type VodIndex,
} from "./schema.ts";

const exec = promisify(execFile);
const run = (
  cmd: string,
  args: string[],
  o: { cwd?: string; timeout?: number } = {},
) =>
  exec(cmd, args, {
    cwd: o.cwd,
    timeout: o.timeout ?? 60 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    killSignal: "SIGKILL",
  });

export interface VodBuildSettings {
  dataDir: string;
  /** Python with Whisper (src/qa/whisperwords.py); empty: only the writing on screen is read. */
  whisperPython: string;
  /** Frames a second the text reader looks at; 0 reads none. */
  ocrFps: number;
  /** Seconds of the recording indexed in one piece of work. */
  chunkSeconds: number;
  /** Shots looked at in one piece of work. */
  describeBatch: number;
}

export interface VodBuildDeps {
  readText?: (files: string[]) => Promise<Map<string, OcrPage>>;
  hear?: (wav: string) => Promise<TimedWord[]>;
  look?: typeof lookAtShot;
  visionUp?: () => Promise<boolean>;
  duration?: (file: string) => Promise<number>;
  now?: () => Date;
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]);
  return Number(stdout.trim()) || 0;
}

/** The index for a recording, made empty the first time. */
export async function openVodIndex(
  file: string,
  game: string,
  s: Pick<VodBuildSettings, "dataDir">,
  deps: VodBuildDeps = {},
): Promise<VodIndex> {
  const { vodId } = parseVodName(file);
  const have = await loadVodIndex(s.dataDir, vodId);
  if (have) {
    if (game && have.game !== game) {
      have.game = game;
      await saveVodIndex(s.dataDir, have);
    }
    return have;
  }
  const duration = await (deps.duration ?? probeDuration)(file);
  if (!(duration > 0)) throw new Error(`no length for ${file}`);
  const v = emptyVodIndex(file, duration, game, deps.now?.() ?? new Date());
  await saveVodIndex(s.dataDir, v);
  return v;
}

async function ocrStretch(
  file: string,
  from: number,
  to: number,
  work: string,
  fps: number,
  deps: VodBuildDeps,
): Promise<OcrSample[]> {
  if (!(fps > 0)) return [];
  const dir = path.join(work, "ocr");
  await fs.mkdir(dir, { recursive: true });
  await run(
    FFMPEG,
    ocrFrameArgs(file, from, to - from, fps, path.join(dir, "f_%06d.jpg")),
  );
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".jpg"))
    .sort();
  const read = deps.readText ?? ((list: string[]) => readText(list));
  const samples: OcrSample[] = [];
  for (let i = 0; i < files.length; i += 120) {
    const batch = files.slice(i, i + 120).map((f) => path.join(dir, f));
    const pages = await read(batch);
    batch.forEach((f, k) => {
      const page = pages.get(f);
      if (page)
        samples.push({
          time: Math.round((from + (i + k) / fps) * 100) / 100,
          page,
        });
    });
  }
  return samples;
}

async function hearStretch(
  file: string,
  from: number,
  to: number,
  work: string,
  s: VodBuildSettings,
  deps: VodBuildDeps,
): Promise<TextLine[]> {
  if (!deps.hear && !s.whisperPython) return [];
  const wav = path.join(work, "sound.wav");
  try {
    await run(FFMPEG, [
      "-loglevel",
      "error",
      "-y",
      "-ss",
      from.toFixed(2),
      "-t",
      (to - from).toFixed(2),
      "-i",
      file,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      wav,
    ]);
    const words = await (deps.hear?.(wav) ??
      transcribeWords(wav, s.whisperPython));
    return voiceLines(
      words.map((w) => ({
        text: w.text,
        start: w.start,
        end: w.end ?? w.start + 0.3,
      })),
      { offset: from },
    );
  } catch (err) {
    log("warn", "stream index: sound not transcribed", {
      from,
      error: errorMessage(err),
    });
    return [];
  }
}

/** Indexes one stretch of the recording: cuts, writing on screen, everything said. Saved. */
export async function indexVodStretch(
  v: VodIndex,
  s: VodBuildSettings,
  stretch: { from: number; to: number },
  deps: VodBuildDeps = {},
): Promise<VodIndex> {
  const dir = vodIndexDir(s.dataDir, v.vodId);
  await fs.mkdir(dir, { recursive: true });
  const work = await fs.mkdtemp(path.join(dir, "work_"));
  try {
    const from = Math.max(0, stretch.from);
    const to = Math.min(v.duration, stretch.to);
    await run(FFMPEG, scanArgs(v.file, from, to - from, "scan.txt"), {
      cwd: work,
    });
    const rows = parseSignalStats(
      await fs.readFile(path.join(work, "scan.txt"), "utf8"),
    ).map((r) => ({ ...r, time: r.time + from }));
    const spans = shotsFromScan(rows, from, to);
    const samples = await ocrStretch(v.file, from, to, work, s.ocrFps, deps);
    const heard = await hearStretch(v.file, from, to, work, s, deps);
    const shots: Array<Omit<SceneShot, "id">> = spans.map((sp) => ({
      start: sp.start,
      end: sp.end,
      keyframes: keyframeTimes(sp.start, sp.end),
      desc: "",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: shotText(
        samples.filter((x) => x.time >= sp.start - 1 && x.time < sp.end + 1),
      ),
      luma: sp.luma,
      motion: sp.motion,
      ...(sp.blank ? { blank: true } : {}),
    }));
    const base = (await loadVodIndex(s.dataDir, v.vodId)) ?? v;
    const merged = mergeStretch(asSceneIndex(base), { from, to }, shots, heard);
    const next: VodIndex = {
      ...base,
      shots: merged.shots,
      lines: merged.lines,
      coverage: merged.coverage,
      builtAt: (deps.now?.() ?? new Date()).toISOString(),
    };
    await saveVodIndex(s.dataDir, next);
    log("info", "stream index: stretch indexed", {
      vod: v.vodId,
      from,
      to,
      shots: shots.length,
      heard: heard.length,
      read: samples.length,
    });
    return next;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Shots that are pictures and have not been looked at yet. */
export function undescribedVod(v: VodIndex): SceneShot[] {
  return v.shots.filter((x) => !x.blank && !x.menu && !x.desc);
}

/** Looks at up to `limit` shots with the local vision model and stores what it saw; stops on three failures in a row. */
export async function describeVodShots(
  v: VodIndex,
  s: VodBuildSettings,
  limit: number,
  deps: VodBuildDeps = {},
): Promise<{ index: VodIndex; described: number; failed: number }> {
  const todo = undescribedVod(v).slice(0, limit);
  if (!todo.length) return { index: v, described: 0, failed: 0 };
  const dir = vodIndexDir(s.dataDir, v.vodId);
  const work = await fs.mkdtemp(path.join(dir, "look_"));
  const look = deps.look ?? lookAtShot;
  let described = 0;
  let failed = 0;
  let streak = 0;
  let next = 0;
  const persist = async () => {
    const fresh = (await loadVodIndex(s.dataDir, v.vodId)) ?? v;
    const at = (x: { start: number; end: number }) =>
      `${x.start.toFixed(2)}|${x.end.toFixed(2)}`;
    const mine = new Map(todo.filter((t) => t.desc).map((t) => [at(t), t]));
    for (const shot of fresh.shots) {
      const t = mine.get(at(shot));
      if (!t) continue;
      Object.assign(shot, {
        desc: t.desc,
        who: t.who,
        where: t.where,
        mood: t.mood,
        tags: t.tags,
      });
      if (t.menu) shot.menu = true;
    }
    fresh.builtAt = (deps.now?.() ?? new Date()).toISOString();
    await saveVodIndex(s.dataDir, fresh);
    return fresh;
  };
  const worker = async () => {
    while (next < todo.length && streak < 3) {
      const shot = todo[next++]!;
      const frames: string[] = [];
      try {
        const times = (
          shot.keyframes.length
            ? shot.keyframes
            : keyframeTimes(shot.start, shot.end)
        ).slice(0, 2);
        for (const [k, time] of times.entries()) {
          const f = path.join(work, `s_${shot.id}_${k}.jpg`);
          await run(FFMPEG, frameArgs(v.file, time, f), { timeout: 60_000 });
          frames.push(f);
        }
        const said = v.lines
          .filter((l) => l.start < shot.end && l.end > shot.start)
          .map((l) => l.text);
        const seen: ShotLook | undefined = await look(frames, {
          game: v.game || v.title,
          cast: [],
          places: [],
          dialogue: said,
          text: shot.text,
          frames: times.length,
        });
        streak = 0;
        if (!seen) {
          shot.desc = "-";
          failed++;
        } else {
          Object.assign(shot, {
            desc: seen.desc,
            who: seen.who,
            where: seen.where,
            mood: seen.mood,
            tags: seen.tags,
          });
          if (seen.menu) shot.menu = true;
          described++;
        }
        if ((described + failed) % 40 === 0) await persist();
      } catch (err) {
        streak++;
        failed++;
        if (streak === 3)
          log(
            "warn",
            "stream index: vision model not answering; shots wait for the next pass",
            {
              error: errorMessage(err),
            },
          );
      } finally {
        for (const f of frames)
          await fs.rm(f, { force: true }).catch(() => undefined);
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(2, todo.length) }, worker));
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  return { index: await persist(), described, failed };
}

export type VodStep = "stretch" | "described" | "waiting" | "done";

/** One bounded piece of work on a recording's index. Call again until it answers "done". */
export async function vodIndexStep(
  file: string,
  game: string,
  s: VodBuildSettings,
  deps: VodBuildDeps = {},
): Promise<{ index: VodIndex; did: VodStep }> {
  let v = await openVodIndex(file, game, s, deps);
  const gap = nextGap(asSceneIndex(v), s.chunkSeconds);
  if (gap) {
    v = await indexVodStretch(v, s, gap, deps);
    return { index: v, did: "stretch" };
  }
  if (undescribedVod(v).length) {
    if (!(await (deps.visionUp ?? visionUp)()))
      return { index: v, did: "waiting" };
    const r = await describeVodShots(v, s, s.describeBatch, deps);
    return { index: r.index, did: r.described ? "described" : "waiting" };
  }
  return { index: v, did: "done" };
}

/** True when the whole recording is indexed and every picture shot has been looked at. */
export function vodIndexReady(v: VodIndex): boolean {
  return !nextGap(asSceneIndex(v), 60) && undescribedVod(v).length === 0;
}
