// Beat-aware footage. Each official trailer is downloaded once, a keyframe is
// read every 1.5 s with its brightness and motion, and every narration line
// is matched to the moment that shows what it names: the model picks when a
// key is available, a motion rule picks otherwise. The chosen moments are
// cut as 4.8 s muted clips tagged with the beat they belong to, so the render
// planner lays each under the words that describe it.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { FFMPEG } from "../lib/bin.ts";
import { errorMessage, fetchWithTimeout, log } from "../lib/util.ts";
import type { Llm, LlmContent } from "../editorial/llm.ts";
import type { Script } from "../editorial/schema.ts";
import {
  parseMediaPlaylist,
  pickVariant,
  type SteamApp,
  type VisualAsset,
} from "./steam.ts";

const run = promisify(execFile);

export const CLIP_SECONDS = 4.8;
export const MIN_CLIP_SECONDS = 1.6; // a shot shorter than this cannot carry a line (the planner's shortest shot is 1.5 s)
export const CANDIDATE_STEP = 1.5;
const MAX_CANDIDATES_TO_MODEL = 24;
const QUIET_KINDS = new Set([
  "stat",
  "date",
  "timeline",
  "compare",
  "countdown",
  "price",
  "score",
]);

export type FootageWant =
  | "gameplay"
  | "cinematic"
  | "character"
  | "world"
  | "vehicle"
  | "ui"
  | "calm"
  | "none";

/** One line of narration that wants a picture. */
export interface FootageTarget {
  key: string; // "hook" | "beat:0" | "beat:1" ...
  text: string;
  want: FootageWant;
  energy: "high" | "medium" | "low";
  keywords: string[];
}

/** A keyframe inside a trailer. */
export interface Candidate {
  index: number;
  movie: number;
  time: number; // seconds into the trailer
  luma: number; // 0-255 mean brightness
  motion: number; // 0-255 mean frame difference
  frame: string; // jpeg path
  nextCut?: number; // seconds: the first shot change after `time`, if the trailer was scanned for cuts
}

export interface Assignment {
  key: string;
  candidate: number;
  confidence: number;
  reason: string;
  label?: string;
}

/** Hook and beats that want footage, in on-screen order; the take stays on the hero still for the loop. */
export function targetsFor(script: Script): FootageTarget[] {
  const out: FootageTarget[] = [];
  const hookWant = script.hook_footage?.want ?? "gameplay";
  if (hookWant !== "none")
    out.push({
      key: "hook",
      text: script.hook,
      want: hookWant,
      energy: "high",
      keywords: script.hook_footage?.keywords ?? [],
    });
  script.beats.forEach((b, i) => {
    const want =
      b.footage?.want ?? (QUIET_KINDS.has(b.visual.kind) ? "calm" : "gameplay");
    if (want === "none") return;
    out.push({
      key: `beat:${i}`,
      text: b.narration,
      want,
      energy:
        QUIET_KINDS.has(b.visual.kind) || want === "calm" ? "low" : "medium",
      keywords: b.footage?.keywords ?? [],
    });
  });
  return out;
}

/** Parses ffmpeg's metadata=print output into per-frame brightness and motion. */
export function parseSignalStats(
  text: string,
): Array<{ time: number; luma: number; motion: number; scene?: number }> {
  const out: Array<{ time: number; luma: number; motion: number; scene?: number }> = [];
  let cur: { time: number; luma: number; motion: number; scene?: number } | undefined;
  for (const line of text.split(/\r?\n/)) {
    const f = line.match(/^frame:\d+\s+pts:\S+\s+pts_time:([\d.]+)/);
    if (f) {
      if (cur) out.push(cur);
      cur = { time: Number(f[1]), luma: 0, motion: 0 };
      continue;
    }
    const y = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (y && cur) cur.luma = Number(y[1]);
    const d = line.match(/lavfi\.signalstats\.YDIF=([\d.]+)/);
    if (d && cur) cur.motion = Number(d[1]);
    const sc = line.match(/lavfi\.scene_score=([\d.]+)/);
    if (sc && cur) cur.scene = Number(sc[1]);
  }
  if (cur) out.push(cur);
  return out;
}

/** Keyframes that could open a clip: past the rating boards, before the end slate, neither black nor blown out. */
export function usableCandidates(
  all: Candidate[],
  totalSeconds: number,
  clipSeconds = CLIP_SECONDS,
): Candidate[] {
  const lead =
    totalSeconds > 60
      ? Math.max(22, totalSeconds * 0.15)
      : Math.max(10, totalSeconds * 0.2);
  const tail = totalSeconds > 60 ? 12 : 8;
  const fits = all.filter(
    (c) =>
      c.time >= lead &&
      c.time + clipSeconds <= totalSeconds - tail &&
      c.luma >= 25 &&
      c.luma <= 230,
  );
  // A clip that changes shot under the words it was chosen for no longer shows what they say:
  // the clip will end where its shot ends, so a shot too short to carry a line is passed over.
  const whole = fits.filter((c) => shotLength(c, clipSeconds) >= MIN_CLIP_SECONDS);
  return whole.length >= 4 ? whole : fits;
}

/** How long a clip opening at this moment can run before the shot changes. */
export function shotLength(c: Candidate, clipSeconds = CLIP_SECONDS): number {
  if (c.nextCut === undefined) return clipSeconds;
  return Math.min(clipSeconds, Math.max(0, c.nextCut - c.time - 0.2));
}

/**
 * Shot changes (seconds) from a per-frame scan: ffmpeg's scene score catches
 * hard cuts, and a frame-difference spike against the surrounding half second
 * catches cuts inside fast motion where the score stays low. Detections closer
 * than a quarter second are one transition, placed at its last frame.
 */
export function detectCuts(
  rows: Array<{ time: number; motion: number; scene?: number }>,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    const lo = Math.max(0, i - 15);
    const hi = Math.min(rows.length, i + 16);
    const nb = rows
      .slice(lo, hi)
      .filter((_, k) => k !== i - lo)
      .map((x) => x.motion)
      .sort((a, b) => a - b);
    const median = nb.length ? nb[Math.floor(nb.length / 2)]! : 0;
    const spike = r.motion > 10 && r.motion > 2.2 * median;
    const scene = (r.scene ?? 0) > 0.12;
    if (!(scene || spike)) continue;
    // Detections within a quarter second are one transition (a dissolve or a whip): the cut is its last frame.
    if (out.length && r.time - out[out.length - 1]! <= 0.25) out[out.length - 1] = r.time;
    else out.push(r.time);
  }
  return out;
}

/**
 * Moves each candidate to the start of the shot its keyframe sits in (so the
 * clip opens on the cut, not partway through), notes where the shot ends,
 * and keeps one candidate per shot.
 */
export function withCuts(candidates: Candidate[], cuts: number[]): Candidate[] {
  if (!cuts.length) return candidates;
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: Candidate[] = [];
  const seen = new Set<number>();
  for (const c of candidates) {
    let prev: number | undefined;
    for (const t of sorted) {
      if (t <= c.time + 0.05) prev = t;
      else break;
    }
    const start = prev !== undefined && c.time - prev <= 6 ? prev : c.time;
    const next = sorted.find((t) => t > start + 0.1);
    const key = Math.round(start * 100);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(next === undefined ? { ...c, time: start } : { ...c, time: start, nextCut: next });
  }
  return out;
}

/** Motion rule: the hook takes the liveliest moment, calm lines the stillest, the rest the next liveliest, no moment twice. */
export function rankByRule(
  targets: FootageTarget[],
  candidates: Candidate[],
): Assignment[] {
  const byMotion = [...candidates].sort((a, b) => b.motion - a.motion);
  const used = new Set<number>();
  const out: Assignment[] = [];
  const take = (pool: Candidate[]) =>
    pool.find((c) => !used.has(c.index) && !nearUsed(c));
  const nearUsed = (c: Candidate) =>
    [...used].some((u) => {
      const o = candidates.find((x) => x.index === u);
      return (
        !!o && o.movie === c.movie && Math.abs(o.time - c.time) < CLIP_SECONDS
      );
    });
  for (const t of targets) {
    const pick =
      t.energy === "low" ? take([...byMotion].reverse()) : take(byMotion);
    if (!pick) continue;
    used.add(pick.index);
    out.push({
      key: t.key,
      candidate: pick.index,
      confidence: 0.55,
      reason:
        t.energy === "low"
          ? "stillest unused moment"
          : "liveliest unused moment",
    });
  }
  return out;
}

export const ClipRankingSchema = z.object({
  candidates: z.array(
    z.object({
      index: z.number(),
      label: z.string().describe("What the frame shows, under 8 words"),
      has_text_or_logo: z
        .boolean()
        .describe(
          "Any readable words or letters in the frame: title cards, taglines, objective text, HUD, menus, rating boards, logos, captions, subtitles or watermarks",
        ),
      energy: z.enum(["high", "medium", "low"]),
    }),
  ),
  assignments: z.array(
    z.object({
      key: z
        .string()
        .describe("The target key exactly as given, e.g. hook or beat:1"),
      candidate_index: z.number(),
      confidence: z
        .number()
        .describe(
          "0-1. Below 0.5 means no frame truly shows what the line names",
        ),
      reason: z.string(),
    }),
  ),
});

const RANK_PROMPT = `You are the picture editor for a gaming news Short. You see numbered keyframes from the game's official trailer, each the start of a possible 4.8 second clip, and the lines of narration that need footage.
For every line, pick the keyframe whose moment best shows what the line names: the character, place, vehicle, mechanic or action it talks about. A line about a new map wants the map; a line about a price or a date wants a calm, readable wide shot; the hook wants the most striking gameplay moment.
Reject any frame with readable words or letters anywhere in it: title cards, trailer taglines, objective or reward text, HUD and menus, rating boards, logos, captions, subtitles, dialogue text or watermarks. Also reject letterboxed black bars filling more than a third of the frame. Reject gore and graphic violence too: blood sprays, wounds, bodies, executions; the channel must stay advertiser-friendly, so pick action without the injury. Be strict: an overlay will be printed on top of the chosen moment, and any text behind it is a failure. Never use the same keyframe, or one within 5 seconds of it in the same trailer, for two lines.
Confidence under 0.5 means no frame truly fits; say so rather than forcing a match.`;

/** One vision call: the keyframes, then the lines, back as labelled candidates and per-line picks. */
export async function rankByModel(
  llm: Llm,
  targets: FootageTarget[],
  candidates: Candidate[],
  textFrames?: Set<number>,
): Promise<Assignment[]> {
  const shown = candidates.slice(0, MAX_CANDIDATES_TO_MODEL);
  const content: LlmContent = [];
  for (const c of shown) {
    content.push({
      type: "text",
      text: `Keyframe ${c.index} (trailer ${c.movie + 1}, ${c.time.toFixed(1)}s)`,
    });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: (await fs.readFile(c.frame)).toString("base64"),
      },
    });
  }
  content.push({
    type: "text",
    text: `Lines needing footage:\n${targets.map((t) => `- ${t.key}: "${t.text}" (wants ${t.want}${t.keywords.length ? `: ${t.keywords.join(", ")}` : ""}, energy ${t.energy})`).join("\n")}`,
  });
  const r = await llm.structured({
    system: RANK_PROMPT,
    content,
    schema: ClipRankingSchema,
    effort: "low",
  });
    const bad = new Set(
    r.candidates.filter((c) => c.has_text_or_logo).map((c) => c.index),
  );
  for (const b of bad) textFrames?.add(b);
  const labels = new Map(r.candidates.map((c) => [c.index, c.label]));
  const known = new Set(shown.map((c) => c.index));
  const used = new Set<number>();
  const out: Assignment[] = [];
  for (const a of r.assignments) {
    if (
      !known.has(a.candidate_index) ||
      bad.has(a.candidate_index) ||
      used.has(a.candidate_index) ||
      a.confidence < 0.5
    )
      continue;
    if (!targets.some((t) => t.key === a.key)) continue;
    used.add(a.candidate_index);
    out.push({
      key: a.key,
      candidate: a.candidate_index,
      confidence: a.confidence,
      reason: a.reason,
      label: labels.get(a.candidate_index),
    });
  }
  return out;
}

/** Downloads a whole HLS variant into one mp4 (init plus every segment). */
async function fetchTrailer(variantUrl: string, dest: string): Promise<number> {
  const res = await fetchWithTimeout(variantUrl, {}, 20_000);
  if (!res.ok) throw new Error(`playlist HTTP ${res.status}`);
  const { init, segments } = parseMediaPlaylist(await res.text());
  if (!init || segments.length === 0)
    throw new Error("playlist has no segments");
  const base = new URL(variantUrl);
  const parts: Buffer[] = [];
  const initRes = await fetchWithTimeout(
    new URL(init, base).toString(),
    {},
    20_000,
  );
  if (!initRes.ok) throw new Error(`init HTTP ${initRes.status}`);
  parts.push(Buffer.from(await initRes.arrayBuffer()));
  for (const seg of segments) {
    const r = await fetchWithTimeout(
      new URL(seg.uri, base).toString(),
      {},
      30_000,
    );
    if (!r.ok) throw new Error(`segment HTTP ${r.status}`);
    parts.push(Buffer.from(await r.arrayBuffer()));
  }
  await fs.writeFile(dest, Buffer.concat(parts));
  return segments.reduce((s, x) => s + x.duration, 0);
}

/** One ffmpeg pass: a 320 px keyframe every CANDIDATE_STEP seconds plus brightness and motion per frame. */
async function analyseTrailer(
  raw: string,
  movie: number,
  dir: string,
  offset: number,
): Promise<Candidate[]> {
  // Run from inside the work folder with bare file names: a Windows drive letter's colon
  // would otherwise be read as a filter-option separator inside metadata=print:file=...
  const statsName = `stats_${movie}.txt`;
  await run(
    FFMPEG,
    [
      "-loglevel",
      "error",
      "-y",
      "-i",
      path.basename(raw),
      "-vf",
      `fps=1/${CANDIDATE_STEP},scale=320:-2,signalstats,metadata=print:file=${statsName}`,
      "-q:v",
      "4",
      `kf_${movie}_%04d.jpg`,
    ],
    { cwd: dir },
  );
  const rows = parseSignalStats(
    await fs.readFile(path.join(dir, statsName), "utf8"),
  );
  // Shot changes from a per-frame scan at 320 px (scene score plus frame difference).
  let cuts: number[] = [];
  try {
    const scenesName = `scenes_${movie}.txt`;
    await run(
      FFMPEG,
      ["-loglevel", "error", "-y", "-i", path.basename(raw), "-vf", `scale=320:-2,select='gte(scene,0)',signalstats,metadata=print:file=${scenesName}`, "-an", "-f", "null", "-"],
      { cwd: dir, maxBuffer: 32 * 1024 * 1024 },
    );
    cuts = detectCuts(parseSignalStats(await fs.readFile(path.join(dir, scenesName), "utf8")));
  } catch (err) {
    log("warn", "scene scan failed; clips may cross a cut", { error: errorMessage(err) });
  }
  const candidates = rows.map((r, i) => ({
    index: offset + i,
    movie,
    time: r.time,
    luma: r.luma,
    motion: r.motion,
    frame: path.join(dir, `kf_${movie}_${String(i + 1).padStart(4, "0")}.jpg`),
  }));
  return withCuts(candidates, cuts);
}

async function cutClip(
  raw: string,
  at: number,
  seconds: number,
  dest: string,
): Promise<void> {
  await run(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-ss",
    at.toFixed(2),
    "-i",
    raw,
    "-t",
    seconds.toFixed(2),
    "-an",
    "-vf",
    "scale=-2:1080,fps=30",
    "-c:v",
    "libx264",
    "-crf",
    "17",
    "-preset",
    "fast",
    "-pix_fmt",
    "yuv420p",
    dest,
  ]);
}

/** A trailer already on disk, ready for keyframe matching. */
export interface TrailerFile {
  file: string;
  name: string;
  url: string;
  total: number; // seconds
}

export interface MatchClipsOptions {
  trailers: TrailerFile[];
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  llm?: Llm; // omitted or failing: the motion rule decides
  clipSeconds?: number;
  /** Provenance text for a chosen clip, e.g. where the trailer came from. */
  describe: (trailer: TrailerFile, seconds: number, at: number) => string;
  /** Written output name prefix inside assets/, so two sources never collide. */
  prefix?: string;
}

/**
 * Beat-matched clips from trailers already on disk, in target order (hook
 * first), each tagged with its beat. Keyframes are written next to the
 * trailers and removed afterwards together with them.
 */
export async function matchClips(o: MatchClipsOptions): Promise<VisualAsset[]> {
  const clipSeconds = o.clipSeconds ?? CLIP_SECONDS;
  if (!o.trailers.length || !o.targets.length) return [];
  const work = path.dirname(o.trailers[0]!.file);
  const assetsDir = path.join(o.episodeDir, "assets");
  await fs.mkdir(assetsDir, { recursive: true });
  const candidates: Candidate[] = [];
  try {
    for (const [i, t] of o.trailers.entries()) {
      try {
        const all = await analyseTrailer(t.file, i, work, candidates.length);
        candidates.push(...usableCandidates(all, t.total, clipSeconds));
      } catch (err) {
        log("warn", "trailer analysis failed", { movie: t.name, error: errorMessage(err) });
      }
    }
    if (candidates.length < 2) return [];
    // Even spread when there are more keyframes than the model can look at.
    const pool =
      candidates.length > MAX_CANDIDATES_TO_MODEL
        ? candidates.filter((_, i) => i % Math.ceil(candidates.length / MAX_CANDIDATES_TO_MODEL) === 0)
        : candidates;
        let assignments: Assignment[] = [];
    let how = "rule";
    // Keyframes the editor saw text in, so a clip can stop before one.
    const textFrames = new Set<number>();
    if (o.llm) {
      try {
                assignments = await rankByModel(o.llm, o.targets, pool, textFrames);
        how = "model";
      } catch (err) {
        log("warn", "clip ranking by model failed; using the motion rule", { error: errorMessage(err) });
      }
    }
    // Lines the model left without a match get the rule's pick from what is left.
    const missing = o.targets.filter((t) => !assignments.some((a) => a.key === t.key));
    if (missing.length) {
      const taken = new Set(assignments.map((a) => a.candidate));
      assignments.push(...rankByRule(missing, pool.filter((c) => !taken.has(c.index))));
    }
    const out: VisualAsset[] = [];
    const prefix = o.prefix ?? "clip";
    for (const t of o.targets) {
      if (out.length >= o.maxClips) break;
      const a = assignments.find((x) => x.key === t.key);
      const c = a && candidates.find((x) => x.index === a.candidate);
      const r = c && o.trailers[c.movie];
      if (!a || !c || !r) continue;
      const file = path.join("assets", `${prefix}_${out.length}.mp4`);
            // The clip ends where its shot ends (rounded to a frame) so it never changes picture under the line,
      // and before any later keyframe in it that carries text (a title card appearing mid-shot).
      let span = shotLength(c, clipSeconds);
      const textAt = candidates
        .filter((x) => x.movie === c.movie && x.time > c.time && x.time < c.time + span && textFrames.has(x.index))
        .map((x) => x.time - c.time);
      if (textAt.length) span = Math.min(span, Math.min(...textAt) - 0.2);
      if (span < MIN_CLIP_SECONDS) continue;
      const seconds = Math.round(Math.max(MIN_CLIP_SECONDS, span) * 30) / 30;
      try {
        await cutClip(r.file, c.time, seconds, path.join(o.episodeDir, file));
      } catch (err) {
        log("warn", "clip cut failed", { at: c.time, error: errorMessage(err) });
        continue;
      }
      const beatIndex = t.key.startsWith("beat:") ? Number.parseInt(t.key.slice(5), 10) : undefined;
      const moment = t.key.match(/#m(\d+)$/)?.[1];
      out.push({
        kind: "clip",
        file,
        sourceUrl: r.url,
        durationSeconds: seconds,
        beatIndex,
        moment: moment === undefined ? undefined : Number(moment),
        role: t.key === "hook" ? "hook" : undefined,
        startSeconds: c.time,
        motion: Math.min(1, c.motion / 40),
        luma: c.luma,
        label: a.label,
        reason: `${how}: ${a.reason}`,
        provenance: `${o.describe(r, seconds, c.time)}; chosen for ${t.key} by ${how} (${a.label ?? a.reason})`,
      });
    }
    log("info", "beat-matched clips", { count: out.length, how, targets: o.targets.length, candidates: candidates.length });
    return out;
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface SelectClipsOptions {
  /** "campaign": the video is about single-player campaigns; multiplayer trailers are skipped. */
  scope?: "campaign";
  app: SteamApp;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  llm?: Llm; // omitted or failing: the motion rule decides
  clipSeconds?: number;
}

/**
 * Beat-matched clips from the game's official Steam trailers. Trailers and
 * keyframes are removed afterwards; only the chosen clips stay in the
 * episode folder.
 */
/** Trailers that are not single-player footage, for a video about campaigns. */
export const NOT_CAMPAIGN = /multiplayer|\bmp\b|zombies|warzone|\bseason\b|battle ?pass|\bbeta\b|ranked|\bdmz\b|operator|bundle|tracer pack|co-?op|spec ops|battle royale|launch event|esports|\bcdl\b/i;

export async function selectClips(o: SelectClipsOptions): Promise<VisualAsset[]> {
  let movies = ((o.app.details.movies ?? []) as Array<Record<string, any>>).filter((m) => m.hls_h264);
  movies.sort((a, b) => Number(Boolean(b.highlight)) - Number(Boolean(a.highlight)));
  if (o.scope === "campaign") {
    const story = movies.filter((m) => !NOT_CAMPAIGN.test(String(m.name ?? "")));
    if (story.length) movies = story.sort((a, b) => Number(/campaign|story/i.test(String(b.name))) - Number(/campaign|story/i.test(String(a.name))));
  }
  if (!movies.length || !o.targets.length) return [];
  const work = path.join(o.episodeDir, "trailers");
  await fs.mkdir(work, { recursive: true });
  const trailers: TrailerFile[] = [];
  for (const [i, movie] of movies.slice(0, 2).entries()) {
    try {
      const masterRes = await fetchWithTimeout(movie.hls_h264, {}, 20_000);
      if (!masterRes.ok) continue;
      const variant = pickVariant(await masterRes.text());
      if (!variant) continue;
      const variantUrl = new URL(variant, movie.hls_h264).toString();
      const raw = path.join(work, `trailer_${i}.mp4`);
      const total = await fetchTrailer(variantUrl, raw);
      trailers.push({ file: raw, name: String(movie.name ?? `trailer ${i + 1}`), url: movie.hls_h264, total });
    } catch (err) {
      log("warn", "trailer download failed", { movie: movie.name, error: errorMessage(err) });
    }
  }
  if (!trailers.length) {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    return [];
  }
  return matchClips({
    ...o,
    trailers,
    describe: (t, seconds, at) => `Official Steam trailer "${t.name}" for "${o.app.name}" (app ${o.app.appId}), ${seconds}s at ${at.toFixed(1)}s, muted`,
  });
}
