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
import type { Embedder } from "../semantic/embed.ts";
import { embedShots, loadFailedShots, loadShotVectors, unembedded, vectorFile } from "../semantic/shots.ts";
import { loadVodTags, tagVodStretches, untagged, wordsFromTags, type TagDeps } from "./tags.ts";
import type { VodWork } from "./slices.ts";
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
  /** VOD_WHISPER_DEVICE: cpu (default for streams, src/vodindex/slices.ts) or cuda. */
  whisperDevice?: string;
  /** VOD_WHISPER_MODEL: the faster-whisper model for streams (medium.en unless set; vodpc.ts uses small.en). */
  whisperModel?: string;
  /** VOD_WHISPER_BEAM: the beam width (5 unless set; vodpc.ts uses 1). */
  whisperBeam?: number;
  /** Frames a second the text reader looks at; 0 reads none. */
  ocrFps: number;
  /** Seconds of the recording indexed in one piece of work. */
  chunkSeconds: number;
  /** Shots looked at in one piece of work. */
  describeBatch: number;
  /** Vision requests in flight at once while describing (2 unless set; the stream index sets 1). */
  describeWorkers?: number;
  /** Epoch ms after which no new shot, stretch or vector batch is started (the slice's turn is nearly over). */
  until?: number;
  /**
   * Only this kind of work (the slice's turn was taken for it, src/vodindex/slices.ts): anything else answers
   * "waiting" untouched, so a call can never start work its turn was not taken for.
   */
  only?: VodWork;
  /**
   * VOD_TAGS: stretches tagged in one piece of work (src/vodindex/tags.ts) once every shot is described, then the
   * shots' meaning vectors; unset: no tags.
   */
  tags?: { batch: number; places: string[]; embedder?: Embedder; model?: string; embedBatch?: number };
}

export interface VodBuildDeps {
  readText?: (files: string[]) => Promise<Map<string, OcrPage>>;
  hear?: (wav: string) => Promise<TimedWord[]>;
  look?: typeof lookAtShot;
  visionUp?: () => Promise<boolean>;
  duration?: (file: string) => Promise<number>;
  now?: () => Date;
  /** VOD_TAGS: stand-ins for the tagger's frame grab and model (tests). */
  tag?: TagDeps;
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
      transcribeWords(wav, s.whisperPython, {
        ...(s.whisperDevice ? { device: s.whisperDevice } : {}),
        ...(s.whisperModel ? { model: s.whisperModel } : {}),
        ...(s.whisperBeam ? { beam: s.whisperBeam } : {}),
        // CPU Whisper is slower: an hour for one chunk at most, still well inside a run.
        timeoutMs: 60 * 60_000,
      }));
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
  // Stretch mode: shots take their words from the stretch tags, never described one by one.
  if (v.describe === "stretch") return [];
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
      if (s.until !== undefined && Date.now() > s.until) break;
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
    await Promise.all(Array.from({ length: Math.min(s.describeWorkers ?? 2, todo.length) }, worker));
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
  return { index: await persist(), described, failed };
}

export type VodStep = "stretch" | "described" | "tagged" | "embedded" | "waiting" | "done";

/**
 * What vodIndexStep would do next on this index, and how many units are left of it (seconds of recording still
 * uncovered, shots to describe or embed, stretches to tag), without doing it: vodpc.ts plans the slice and takes the
 * orchestrator turn the work needs first (src/vodindex/slices.ts). vodIndexStep follows the same answer, so the two
 * can never disagree.
 */
export async function vodNextWork(
  v: VodIndex,
  s: Pick<VodBuildSettings, "dataDir" | "chunkSeconds" | "tags">,
): Promise<{ work: VodWork; left: number }> {
  if (nextGap(asSceneIndex(v), s.chunkSeconds)) {
    const covered = v.coverage.reduce((n, c) => n + Math.max(0, c.to - c.from), 0);
    return { work: "stretch", left: Math.max(1, v.duration - covered) };
  }
  const todo = undescribedVod(v).length;
  if (todo) return { work: "describe", left: todo };
  if (!s.tags) return { work: "done", left: 0 };
  const tags = await loadVodTags(s.dataDir, v.vodId);
  const tagsLeft = untagged(v, tags).length;
  if (tagsLeft) return { work: "tag", left: tagsLeft };
  // Stretch mode, all tagged: shots still without words take them from the tags (on a copy here, to count).
  if (
    v.describe === "stretch" &&
    v.shots.some((x) => !x.blank && !x.menu && !x.desc) &&
    wordsFromTags(structuredClone(v), tags) > 0
  )
    return { work: "words", left: 1 };
  if (s.tags.embedder && s.tags.model) {
    const file = vectorFile(vodIndexDir(s.dataDir, v.vodId), s.tags.model);
    const left = unembedded(v.shots, await loadShotVectors(file), await loadFailedShots(file)).length;
    if (left) return { work: "embed", left };
  }
  return { work: "done", left: 0 };
}

/** One bounded piece of work on a recording's index. Call again until it answers "done". */
export async function vodIndexStep(
  file: string,
  game: string,
  s: VodBuildSettings,
  deps: VodBuildDeps = {},
): Promise<{ index: VodIndex; did: VodStep }> {
  let v = await openVodIndex(file, game, s, deps);
  const next = await vodNextWork(v, s);
  if (s.only && next.work !== s.only) return { index: v, did: "waiting" };
  if (next.work === "stretch") {
    const gap = nextGap(asSceneIndex(v), s.chunkSeconds)!;
    v = await indexVodStretch(v, s, gap, deps);
    return { index: v, did: "stretch" };
  }
  if (next.work === "describe") {
    if (!(await (deps.visionUp ?? visionUp)()))
      return { index: v, did: "waiting" };
    const r = await describeVodShots(v, s, s.describeBatch, deps);
    return { index: r.index, did: r.described ? "described" : "waiting" };
  }
  if (s.tags) {
    if (next.work === "tag") {
      if (!(await (deps.visionUp ?? visionUp)()))
        return { index: v, did: "waiting" };
      const r = await tagVodStretches(
        v,
        { dataDir: s.dataDir, places: s.tags.places, limit: s.tags.batch, ...(s.until !== undefined ? { until: s.until } : {}) },
        deps.tag,
      );
      return { index: v, did: r.tagged ? "tagged" : "waiting" };
    }
    // Stretch mode, all tagged: the shots take their words from the tags, once.
    if (next.work === "words") {
      const fresh = (await loadVodIndex(s.dataDir, v.vodId)) ?? v;
      if (wordsFromTags(fresh, await loadVodTags(s.dataDir, v.vodId))) {
        await saveVodIndex(s.dataDir, fresh);
        return { index: fresh, did: "tagged" };
      }
    }
    if (next.work === "embed" && s.tags.embedder && s.tags.model) {
      const file = vectorFile(vodIndexDir(s.dataDir, v.vodId), s.tags.model);
      const r = await embedShots({
        shots: v.shots,
        video: v.file,
        vectorsFile: file,
        embedder: s.tags.embedder,
        model: s.tags.model,
        work: vodIndexDir(s.dataDir, v.vodId),
        limit: s.tags.embedBatch ?? 600,
        ...(s.until !== undefined ? { until: s.until } : {}),
        ...(deps.tag?.grab ? { grab: deps.tag.grab } : {}),
      });
      return { index: v, did: r.added ? "embedded" : "waiting" };
    }
  }
  return { index: v, did: "done" };
}

/** True when the whole recording is indexed and every picture shot has been looked at. */
export function vodIndexReady(v: VodIndex): boolean {
  // Stretch mode: ready once every picture shot has its words from the tags, as the miner expects.
  const words = v.describe !== "stretch" || !v.shots.some((s) => !s.blank && !s.menu && !s.desc);
  return !nextGap(asSceneIndex(v), 60) && undescribedVod(v).length === 0 && words;
}
