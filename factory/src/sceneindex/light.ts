// The light scene index (ARCHIVE_LIGHT, owner, 12 Nov 2026: "index like every single game via YouTube and only
// actually download / pull clips live as we go ... essentially using the world's largest real-time video library").
// A light index downloads no video at all. It is built from what YouTube serves beside the stream:
//   1. the captions (auto-subs when there are no uploaded ones), with word timings: the dialogue lines;
//   2. the chapter list and the timestamps in the description: the places and story beats, by time;
//   3. the storyboard sprite sheets (sb0, 320x180 frames every few seconds): cut estimates, brightness, and the
//      small frames the text reader and, at night, the local vision model look at;
//   4. the comments' timestamps ("Ganondorf reveal 3:21:05"): moment names.
// It is the same SceneIndex the lookups already read (tier "light"), a few megabytes a game, so hundreds of games
// fit on the Mac. Clips are still cut live from full-quality sections of the same upload, and each pick is checked
// on the downloaded seconds before it is used (src/sceneindex/footage.ts). The full index (proxy, Whisper, per-shot
// text reading) stays an upgrade for the few games where precision matters (src/sceneindex/archive.ts).

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { FFMPEG, YTDLP_TEXT } from "../lib/bin.ts";
import { errorMessage, log } from "../lib/util.ts";
import {
  SCENE_INDEX_VERSION,
  sceneSlug,
  saveSceneIndex,
  sceneIndexDir,
  shotAt,
  type IndexChapter,
  type IndexMoment,
  type SceneIndex,
  type SceneShot,
  type SceneSource,
  type TimedWord,
} from "./schema.ts";
import { voiceLines, type TextLine } from "./dialogue.ts";
import { MAX_SHOT_SECONDS, BLANK_LUMA } from "./shots.ts";
import { tidyIndex } from "./tidy.ts";

const exec = promisify(execFile);

// ---------------------------------------------------------------- what YouTube serves (pure parsing)

/** A storyboard format as yt-dlp lists it (sb0 is the largest). */
export interface StoryboardFormat {
  format_id: string;
  width: number;
  height: number;
  rows: number;
  columns: number;
  fps: number;
  fragments: Array<{ url: string; duration: number }>;
}

/** One small frame of the storyboard: its time in the source and where it sits in which sheet. */
export interface Tile {
  time: number;
  sheet: number;
  /** Position inside the sheet, row-major. */
  cell: number;
}

/** The largest storyboard the upload has (pure), or undefined. */
export function pickStoryboard(
  formats: unknown[],
): StoryboardFormat | undefined {
  const boards = (Array.isArray(formats) ? formats : [])
    .filter(
      (f): f is StoryboardFormat =>
        !!f &&
        typeof (f as StoryboardFormat).format_id === "string" &&
        /^sb\d+$/.test((f as StoryboardFormat).format_id) &&
        Array.isArray((f as StoryboardFormat).fragments) &&
        (f as StoryboardFormat).fragments.length > 0 &&
        Number((f as StoryboardFormat).rows) > 0 &&
        Number((f as StoryboardFormat).columns) > 0,
    )
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return boards[0];
}

/**
 * Every tile's time (pure): a sheet holds rows x columns frames, one every 1/fps seconds, and each sheet's
 * fragment says how many seconds it spans (the last one is short). A tile's time is the middle of its interval.
 */
export function storyboardTiles(
  sb: Pick<StoryboardFormat, "rows" | "columns" | "fps" | "fragments">,
  duration: number,
): Tile[] {
  const per = sb.rows * sb.columns;
  const step = sb.fps > 0 ? 1 / sb.fps : 0;
  const out: Tile[] = [];
  let at = 0;
  sb.fragments.forEach((frag, sheet) => {
    const span = Number(frag.duration) || per * step;
    const n =
      step > 0 ? Math.min(per, Math.max(1, Math.round(span / step))) : per;
    const each = span / n;
    for (let cell = 0; cell < n; cell++) {
      const time = at + each * (cell + 0.5);
      if (time < duration)
        out.push({ time: Math.round(time * 100) / 100, sheet, cell });
    }
    at += span;
  });
  return out;
}

/**
 * yt-dlp's json3 captions as timed words (pure): each event's segments with their offsets; a word ends where the
 * next one starts (or at its event's end). Line breaks and the "[Music]" style sound tags are left out.
 */
export function json3Words(raw: unknown): TimedWord[] {
  const events = (raw as { events?: unknown[] } | null)?.events;
  const words: Array<TimedWord & { cap: number }> = [];
  for (const e of Array.isArray(events) ? events : []) {
    const ev = e as {
      tStartMs?: number;
      dDurationMs?: number;
      segs?: Array<{ utf8?: string; tOffsetMs?: number }>;
    };
    if (!Array.isArray(ev.segs) || !Number.isFinite(ev.tStartMs)) continue;
    const start = (ev.tStartMs ?? 0) / 1000;
    const cap = start + (ev.dDurationMs ?? 0) / 1000;
    for (const seg of ev.segs) {
      const text = String(seg.utf8 ?? "");
      if (!text.trim() || /^\s*\[[^\]]*\]\s*$/.test(text)) continue;
      const at = start + (seg.tOffsetMs ?? 0) / 1000;
      for (const [k, w] of text.trim().split(/\s+/).entries())
        if (w) words.push({ text: w, start: Math.round((at + k * 0.01) * 100) / 100, end: 0, cap });
    }
  }
  words.sort((a, b) => a.start - b.start);
  return words.map((w, i) => {
    const next = words[i + 1]?.start ?? Infinity;
    const end = Math.max(w.start + 0.05, Math.min(next, w.cap > w.start ? w.cap : w.start + 0.4));
    return { text: w.text, start: w.start, end: Math.round(end * 100) / 100 };
  });
}

/** "1:02:03", "12:34" or "0:05" as seconds (pure); NaN when it is not a timestamp. */
export function clockSeconds(text: string): number {
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * The timestamps written in a text (pure): a description's or a comment's "3:21:05 Ganondorf reveal" or "the
 * Ganondorf reveal at 3:21:05". Each with the words beside it on the same line (up to eight), within the source.
 */
export function timestampsIn(
  text: string,
  duration: number,
): Array<{ at: number; label: string }> {
  const out: Array<{ at: number; label: string }> = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const stamps = [
      ...line.matchAll(/(?<![\d:])(\d{1,2}:)?\d{1,2}:\d{2}(?![\d:])/g),
    ];
    for (const [i, m] of stamps.entries()) {
      const at = clockSeconds(m[0]);
      if (!Number.isFinite(at) || at >= duration) continue;
      const after = line.slice(
        m.index! + m[0].length,
        stamps[i + 1]?.index ?? line.length,
      );
      const before = i === 0 ? line.slice(0, m.index) : "";
      const label = (
        after.replace(/^[\s\-–:|.)\]]+/, "").trim() || before.trim()
      )
        .replace(/https?:\/\/\S+/g, "")
        .replace(/[^\p{L}\p{N}'’\s-]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .slice(0, 8)
        .join(" ");
      if (label.length >= 3) out.push({ at, label });
    }
  }
  return out;
}

/** yt-dlp's chapter list (pure), in order, within the source. */
export function chaptersOf(
  info: { chapters?: unknown },
  duration: number,
): IndexChapter[] {
  const list = Array.isArray(info.chapters) ? info.chapters : [];
  return list
    .map((c) => c as { start_time?: number; end_time?: number; title?: string })
    .filter(
      (c) =>
        Number.isFinite(c.start_time) &&
        typeof c.title === "string" &&
        c.title.trim(),
    )
    .map((c) => ({
      start: Number(c.start_time),
      end: Math.min(duration, Number(c.end_time) || duration),
      title: String(c.title).trim(),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
}

/** A chapter title that only numbers the part ("Part 3", "Chapter 12", "Intro") says nothing of the place. */
const BARE_CHAPTER =
  /^(?:part|chapter|ch\.?|episode|ep\.?|mission|act)?\s*#?\s*\d+\s*$|^(?:intro|outro|start|end|credits)$/i;

/**
 * The moments named by the description and the comments (pure): the description's timestamps that are not the
 * chapter list itself, and the comments' timestamps, the most liked first; one a few seconds, longest label kept.
 */
export function momentsOf(
  description: string,
  comments: Array<{ text: string; likes?: number }>,
  chapters: IndexChapter[],
  duration: number,
): IndexMoment[] {
  const chapterAt = new Set(chapters.map((c) => Math.round(c.start)));
  const all: IndexMoment[] = [
    ...timestampsIn(description, duration)
      .filter((t) => !chapterAt.has(Math.round(t.at)))
      .map((t) => ({ ...t, from: "description" as const, likes: 0 })),
    ...[...comments]
      .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
      .flatMap((c) =>
        timestampsIn(c.text, duration).map((t) => ({
          ...t,
          from: "comment" as const,
          likes: c.likes ?? 0,
        })),
      ),
  ];
  const kept: IndexMoment[] = [];
  for (const m of all) {
    const near = kept.find((k) => Math.abs(k.at - m.at) <= 4);
    if (!near) kept.push(m);
    else if (m.label.length > near.label.length && m.from === near.from)
      near.label = m.label;
  }
  return kept.sort((a, b) => a.at - b.at).slice(0, 400);
}

/** One storyboard frame's numbers: mean brightness 0-255 and a tiny greyscale picture for comparing frames. */
export interface TileStats {
  time: number;
  luma: number;
  thumb: Uint8Array;
}

/** Mean absolute difference of two tiny pictures, 0-255 (pure). */
export function thumbDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += Math.abs(a[i]! - b[i]!);
  return s / n;
}

/** A change between two storyboard frames this big (0-255) is taken as a cut between them. */
export const TILE_CUT = 18;
/** A dialogue line starting after this much quiet starts a new shot: dialogue turns follow the camera closely. */
export const LINE_GAP = 1.0;
/** No light shot shorter than this. */
export const LIGHT_MIN_SECONDS = 1.5;

/**
 * The light index's shots (pure). Boundaries come from three places: a big change between two storyboard frames
 * (the cut is put halfway between them), a dialogue line that starts after a quiet moment (dialogue turns follow
 * the camera; and a caption's time is right to a second, where a storyboard frame is several seconds apart), and
 * a chapter's start. Shots under LIGHT_MIN_SECONDS fold into the one before; shots over MAX_SHOT_SECONDS are split
 * evenly. Each shot's brightness, motion and keyframes come from the storyboard frames inside it (the nearest one
 * when none is).
 */
export function lightShots(
  tiles: TileStats[],
  lines: Array<Pick<TextLine, "start" | "end">>,
  chapters: IndexChapter[],
  duration: number,
): Array<Omit<SceneShot, "id">> {
  const cuts = new Set<number>([0]);
  for (let i = 1; i < tiles.length; i++)
    if (thumbDiff(tiles[i - 1]!.thumb, tiles[i]!.thumb) >= TILE_CUT)
      cuts.add(
        Math.round(((tiles[i - 1]!.time + tiles[i]!.time) / 2) * 100) / 100,
      );
  let lastEnd = -Infinity;
  for (const l of [...lines].sort((a, b) => a.start - b.start)) {
    if (l.start - lastEnd >= LINE_GAP)
      cuts.add(Math.round(l.start * 100) / 100);
    lastEnd = Math.max(lastEnd, l.end);
  }
  for (const c of chapters) cuts.add(Math.round(c.start * 100) / 100);
  const sorted = [...cuts]
    .filter((t) => t >= 0 && t < duration)
    .sort((a, b) => a - b);
  const bounds: number[] = [];
  for (const t of sorted)
    if (!bounds.length || t - bounds[bounds.length - 1]! >= LIGHT_MIN_SECONDS)
      bounds.push(t);
  const spans: Array<{ start: number; end: number }> = [];
  bounds.forEach((start, i) => {
    const end = bounds[i + 1] ?? duration;
    if (end - start <= 0.05) return;
    const parts = Math.max(1, Math.ceil((end - start) / MAX_SHOT_SECONDS));
    const each = (end - start) / parts;
    for (let k = 0; k < parts; k++)
      spans.push({
        start: Math.round((start + k * each) * 100) / 100,
        end: Math.round((start + (k + 1) * each) * 100) / 100,
      });
  });
  return spans.map((sp) => {
    const inside = tiles.filter((t) => t.time >= sp.start && t.time < sp.end);
    const near = inside.length
      ? inside
      : tiles.length
        ? [
            tiles.reduce((a, b) =>
              Math.abs(b.time - (sp.start + sp.end) / 2) <
              Math.abs(a.time - (sp.start + sp.end) / 2)
                ? b
                : a,
            ),
          ]
        : [];
    const luma = near.length
      ? near.reduce((n, t) => n + t.luma, 0) / near.length
      : 0;
    let motion = 0;
    for (let i = 1; i < inside.length; i++)
      motion += thumbDiff(inside[i - 1]!.thumb, inside[i]!.thumb);
    motion = inside.length > 1 ? motion / (inside.length - 1) : 0;
    return {
      start: sp.start,
      end: sp.end,
      keyframes: near.map((t) => t.time).slice(0, 3),
      desc: "",
      who: [] as string[],
      where: "",
      mood: "",
      tags: [] as string[],
      text: "",
      luma: Math.round(luma),
      motion: Math.round(motion * 10) / 10,
      ...(near.length && luma < BLANK_LUMA ? { blank: true } : {}),
    };
  });
}

/**
 * The light index (pure): shots from lightShots; lines from the captions; each shot's place is its chapter's title
 * (unless the chapter only numbers the part); the moments' names go into the tags of the shot they fall in and the
 * next one (a comment's time is usually a second or two early or late); the frames' text, when read, is the shot's.
 */
export function assembleLight(input: {
  game: string;
  source: SceneSource;
  words: TimedWord[];
  tiles: TileStats[];
  chapters: IndexChapter[];
  moments: IndexMoment[];
  cast?: string[];
  places?: string[];
  /** Text read off storyboard frames, by frame time. */
  tileText?: Map<number, string>;
  storyboard?: SceneIndex["storyboard"];
  now: Date;
}): SceneIndex {
  const duration = input.source.duration;
  const lines = voiceLines(input.words, { offset: 0 });
  const shots = lightShots(input.tiles, lines, input.chapters, duration).map(
    (s, id) => ({ ...s, id }),
  );
  for (const s of shots) {
    const ch = input.chapters.find(
      (c) => s.start >= c.start - 0.01 && s.start < c.end,
    );
    if (ch && !BARE_CHAPTER.test(ch.title)) s.where = ch.title;
    if (input.tileText) {
      const text = s.keyframes
        .map((t) => input.tileText!.get(t) ?? "")
        .filter(Boolean)
        .join(" ")
        .trim();
      if (text) s.text = text.slice(0, 200);
    }
  }
  for (const m of input.moments) {
    const i = shotAt(shots, m.at);
    for (const k of [i, i + 1]) {
      const s = shots[k];
      if (!s) continue;
      for (const w of m.label.split(/\s+/))
        if (w.length > 2 && !s.tags.includes(w)) s.tags.push(w);
      s.tags = s.tags.slice(0, 24);
    }
  }
  const index: SceneIndex = {
    version: SCENE_INDEX_VERSION,
    game: input.game,
    slug: sceneSlug(input.game),
    source: input.source,
    builtAt: input.now.toISOString(),
    tier: "light",
    coverage: duration > 0 ? [{ from: 0, to: duration }] : [],
    cast: input.cast ?? [],
    places: input.places ?? [],
    chapters: input.chapters,
    moments: input.moments,
    ...(input.storyboard ? { storyboard: input.storyboard } : {}),
    shots,
    lines: lines.map((l, id) => ({ ...l, id, shot: shotAt(shots, l.start) })),
  };
  return tidyIndex(index);
}

// ---------------------------------------------------------------- fetching (network, ffmpeg)

export interface LightDeps {
  info?: (videoId: string) => Promise<Record<string, unknown>>;
  captions?: (
    videoId: string,
    info: Record<string, unknown>,
    work: string,
  ) => Promise<TimedWord[]>;
  comments?: (
    videoId: string,
  ) => Promise<Array<{ text: string; likes?: number }>>;
  sheets?: (sb: StoryboardFormat, work: string) => Promise<string[]>;
  tiles?: (
    sheets: string[],
    sb: StoryboardFormat,
    tiles: Tile[],
    work: string,
  ) => Promise<TileStats[]>;
  readTiles?: (files: string[]) => Promise<Map<string, string>>;
  names?: (game: string) => Promise<{ cast: string[]; places: string[] }>;
  now?: () => Date;
}

export interface LightSettings {
  dataDir: string;
  ytdlp: string;
  /** Comments read for moment names (0: none). */
  comments: number;
  /** Read the text on the storyboard frames (Apple Vision on the Mac, Windows OCR on the PC). */
  ocr: boolean;
}

async function ytJson(
  ytdlp: string,
  args: string[],
  timeout = 120_000,
): Promise<Record<string, unknown>> {
  const { stdout } = await exec(
    ytdlp,
    [...YTDLP_TEXT.args, "--no-warnings", ...args],
    {
      timeout,
      maxBuffer: 256 * 1024 * 1024,
      env: YTDLP_TEXT.env,
      windowsHide: true,
    },
  );
  return JSON.parse(stdout) as Record<string, unknown>;
}

/** The upload's details with its formats (storyboards included), chapters and caption lists. */
export function uploadInfo(
  videoId: string,
  ytdlp: string,
): Promise<Record<string, unknown>> {
  return ytJson(ytdlp, [
    "--no-playlist",
    "--skip-download",
    "--dump-single-json",
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
}

/** True when the upload has English captions, its own or automatic (pure). */
export function hasCaptions(info: Record<string, unknown>): boolean {
  const keys = [...Object.keys((info.subtitles ?? {}) as object), ...Object.keys((info.automatic_captions ?? {}) as object)];
  return keys.some((k) => /^en($|-)/i.test(k));
}

/** The captions' words: uploaded English ones first, else the automatic ones; none when the upload has neither. */
async function fetchCaptions(
  videoId: string,
  info: Record<string, unknown>,
  work: string,
  ytdlp: string,
): Promise<TimedWord[]> {
  const subs = (info.subtitles ?? {}) as Record<string, unknown>;
  const auto = (info.automatic_captions ?? {}) as Record<string, unknown>;
  const own = Object.keys(subs).find((k) => /^en(\b|-)/i.test(k));
  const lang =
    own ??
    (Object.keys(auto).find((k) => /^en(-orig)?$/i.test(k))
      ? Object.keys(auto).includes("en-orig")
        ? "en-orig"
        : "en"
      : undefined);
  if (!lang) return [];
  await exec(
    ytdlp,
    [
      ...YTDLP_TEXT.args,
      "--no-warnings",
      "--no-playlist",
      "--skip-download",
      own ? "--write-subs" : "--write-auto-subs",
      "--sub-langs",
      lang,
      "--sub-format",
      "json3",
      "-o",
      path.join(work, "cap"),
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    {
      timeout: 180_000,
      env: YTDLP_TEXT.env,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const file = (await fs.readdir(work)).find(
    (f) => f.startsWith("cap.") && f.endsWith(".json3"),
  );
  if (!file) return [];
  return json3Words(
    JSON.parse(await fs.readFile(path.join(work, file), "utf8")),
  );
}

/** The top comments' text and likes (yt-dlp's comment reader; a few hundred at most). */
async function fetchComments(
  videoId: string,
  max: number,
  ytdlp: string,
): Promise<Array<{ text: string; likes?: number }>> {
  if (max <= 0) return [];
  const info = await ytJson(
    ytdlp,
    [
      "--no-playlist",
      "--skip-download",
      "--write-comments",
      "--extractor-args",
      `youtube:max_comments=${max},${max},0,0;comment_sort=top`,
      "--dump-single-json",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    300_000,
  );
  return (Array.isArray(info.comments) ? info.comments : [])
    .map((c) => c as { text?: string; like_count?: number })
    .filter((c) => typeof c.text === "string")
    .map((c) => ({ text: String(c.text), likes: Number(c.like_count) || 0 }));
}

/** Every sheet of the storyboard, downloaded (small JPEGs, a few kilobytes each), in order. */
async function fetchSheets(
  sb: StoryboardFormat,
  work: string,
): Promise<string[]> {
  const out: string[] = [];
  const queue = sb.fragments.map((f, i) => ({
    url: f.url,
    file: path.join(work, `sheet_${String(i).padStart(5, "0")}.jpg`),
  }));
  let next = 0;
  const worker = async () => {
    while (next < queue.length) {
      const q = queue[next++]!;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(q.url, {
            signal: AbortSignal.timeout(30_000),
          });
          if (!res.ok) throw new Error(`storyboard sheet ${res.status}`);
          await fs.writeFile(q.file, Buffer.from(await res.arrayBuffer()));
          break;
        } catch (err) {
          if (attempt === 2) throw err;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const q of queue) out.push(q.file);
  return out;
}

/** The thumbnail size frames are compared at: 16 by 9 grey pixels. */
const THUMB_W = 16;
const THUMB_H = 9;

/**
 * Every storyboard frame's numbers, from all the sheets in one ffmpeg run: the sheets are cut into their frames
 * (untile) and each frame shrunk to a 16x9 grey picture, read back raw. A sheet's empty cells (the last sheet) are
 * dropped by matching the frames to the tiles' list.
 */
async function measureTiles(
  sheets: string[],
  sb: StoryboardFormat,
  tiles: Tile[],
  work: string,
): Promise<TileStats[]> {
  const list = path.join(work, "sheets.txt");
  await fs.writeFile(
    list,
    sheets
      .map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
      .join("\n"),
  );
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn(
      FFMPEG,
      [
        "-v",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        list,
        "-vf",
        `settb=1/25,setpts=N,scale=${sb.width * sb.columns}:${sb.height * sb.rows},untile=${sb.columns}x${sb.rows},setpts=N,scale=${THUMB_W}:${THUMB_H}:flags=area,format=gray`,
        "-fps_mode",
        "passthrough",
        "-f",
        "rawvideo",
        "-",
      ],
      { windowsHide: true },
    );
    const chunks: Buffer[] = [];
    let err = "";
    p.stdout.on("data", (c: Buffer) => chunks.push(c));
    p.stderr.on("data", (c: Buffer) => (err += String(c)));
    p.on("error", reject);
    p.on("close", (code) =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`ffmpeg untile ${code}: ${err.slice(0, 300)}`)),
    );
  });
  const size = THUMB_W * THUMB_H;
  const per = sb.rows * sb.columns;
  const out: TileStats[] = [];
  for (const t of tiles) {
    const at = (t.sheet * per + t.cell) * size;
    if (at + size > raw.length) break;
    const thumb = new Uint8Array(raw.subarray(at, at + size));
    out.push({
      time: t.time,
      luma: thumb.reduce((n, v) => n + v, 0) / size,
      thumb,
    });
  }
  return out;
}

/** The storyboard frames at the given times as JPEG files (for the text reader and the vision model). */
export async function tileFiles(
  sheets: string[],
  sb: Pick<StoryboardFormat, "width" | "height" | "rows" | "columns">,
  tiles: Tile[],
  work: string,
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const bySheet = new Map<number, Tile[]>();
  for (const t of tiles)
    bySheet.set(t.sheet, [...(bySheet.get(t.sheet) ?? []), t]);
  for (const [sheet, list] of bySheet) {
    const src = sheets[sheet];
    if (!src) continue;
    for (const t of list) {
      const x = (t.cell % sb.columns) * sb.width;
      const y = Math.floor(t.cell / sb.columns) * sb.height;
      const file = path.join(work, `tile_${sheet}_${t.cell}.jpg`);
      await exec(
        FFMPEG,
        [
          "-v",
          "error",
          "-y",
          "-i",
          src,
          "-vf",
          `crop=${sb.width}:${sb.height}:${x}:${y},scale=${sb.width * 2}:-2:flags=lanczos`,
          "-q:v",
          "3",
          file,
        ],
        {
          timeout: 60_000,
          windowsHide: true,
        },
      );
      out.set(t.time, file);
    }
  }
  return out;
}

export interface LightResult {
  index: SceneIndex;
  stats: {
    seconds: number;
    bytes: number;
    words: number;
    lines: number;
    shots: number;
    chapters: number;
    moments: number;
    tiles: number;
    comments: number;
    read: number;
  };
}

/**
 * Builds and saves a game's light index from its chosen upload, downloading no video: details, captions, comments
 * and storyboard sheets only, all in a work folder that is removed afterwards. Keeps an existing index's names.
 */
export async function buildLight(
  game: string,
  source: SceneSource,
  s: LightSettings,
  deps: LightDeps = {},
): Promise<LightResult> {
  const t0 = Date.now();
  const now = (deps.now ?? (() => new Date()))();
  const dir = sceneIndexDir(s.dataDir, game);
  await fs.mkdir(dir, { recursive: true });
  const work = await fs.mkdtemp(path.join(dir, "light_"));
  try {
    const info = await (deps.info ?? ((id: string) => uploadInfo(id, s.ytdlp)))(
      source.videoId,
    );
    const duration = Number(info.duration) || source.duration;
    const src: SceneSource = { ...source, duration };
    const words = await (
      deps.captions ?? ((id, i, w) => fetchCaptions(id, i, w, s.ytdlp))
    )(source.videoId, info, work).catch((err) => {
      log("warn", "light index: no captions", {
        game,
        error: errorMessage(err),
      });
      return [] as TimedWord[];
    });
    const comments = await (
      deps.comments ?? ((id: string) => fetchComments(id, s.comments, s.ytdlp))
    )(source.videoId).catch((err) => {
      log("warn", "light index: comments not read", {
        game,
        error: errorMessage(err),
      });
      return [] as Array<{ text: string; likes?: number }>;
    });
    const chapters = chaptersOf(info, duration);
    const moments = momentsOf(
      String(info.description ?? ""),
      comments,
      chapters,
      duration,
    );
    const sb = pickStoryboard(info.formats as unknown[]);
    let stats: TileStats[] = [];
    let tileText: Map<number, string> | undefined;
    let tiles: Tile[] = [];
    if (sb) {
      tiles = storyboardTiles(sb, duration);
      const sheets = await (deps.sheets ?? fetchSheets)(sb, work);
      stats = await (deps.tiles ?? measureTiles)(sheets, sb, tiles, work).catch(
        (err) => {
          log("warn", "light index: storyboard not measured", {
            game,
            error: errorMessage(err),
          });
          return [] as TileStats[];
        },
      );
      if (s.ocr) {
        const files = await tileFiles(sheets, sb, tiles, work).catch(
          () => new Map<number, string>(),
        );
        const read = await (deps.readTiles ?? readTileText)([
          ...files.values(),
        ]).catch(() => new Map<string, string>());
        tileText = new Map(
          [...files].flatMap(([t, f]) =>
            read.get(f) ? [[t, read.get(f)!] as [number, string]] : [],
          ),
        );
      }
    }
    const names = await (
      deps.names ??
      (async () => ({ cast: [] as string[], places: [] as string[] }))
    )(game).catch(() => ({
      cast: [] as string[],
      places: [] as string[],
    }));
    const index = assembleLight({
      game,
      source: src,
      words,
      tiles: stats,
      chapters,
      moments,
      cast: names.cast,
      places: names.places,
      tileText,
      ...(sb
        ? {
            storyboard: {
              format: sb.format_id,
              width: sb.width,
              height: sb.height,
              interval: sb.fps > 0 ? Math.round((1 / sb.fps) * 100) / 100 : 0,
            },
          }
        : {}),
      now,
    });
    const file = await saveSceneIndex(s.dataDir, index);
    const bytes = (await fs.stat(file)).size;
    return {
      index,
      stats: {
        seconds: Math.round((Date.now() - t0) / 100) / 10,
        bytes,
        words: words.length,
        lines: index.lines.length,
        shots: index.shots.length,
        chapters: chapters.length,
        moments: moments.length,
        tiles: stats.length,
        comments: comments.length,
        read: tileText?.size ?? 0,
      },
    };
  } finally {
    await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** The text on storyboard frames, by file: the machine's own reader, words joined. */
async function readTileText(files: string[]): Promise<Map<string, string>> {
  const { readText } = await import("../assets/ocr.ts");
  const out = new Map<string, string>();
  for (let i = 0; i < files.length; i += 120) {
    const pages = await readText(files.slice(i, i + 120));
    for (const [file, page] of pages) {
      const text = page.words
        .map((w) => w.text)
        .join(" ")
        .trim();
      if (text.length >= 3) out.set(file, text);
    }
  }
  return out;
}

/**
 * The storyboard frame nearest each time, as JPEG files in `work` (the light index's describing, at night): the
 * upload's storyboard is listed again (its sheet addresses expire), only the sheets needed are downloaded.
 */
export async function lightFrames(
  index: Pick<SceneIndex, "source">,
  times: number[],
  work: string,
  ytdlp: string,
  deps: { info?: LightDeps["info"] } = {},
): Promise<Map<number, string>> {
  const info = await (deps.info ?? ((id: string) => uploadInfo(id, ytdlp)))(
    index.source.videoId,
  );
  const sb = pickStoryboard(info.formats as unknown[]);
  if (!sb) return new Map();
  const tiles = storyboardTiles(
    sb,
    Number(info.duration) || index.source.duration,
  );
  if (!tiles.length) return new Map();
  const want = new Map<number, Tile>();
  for (const t of times) {
    const near = tiles.reduce((a, b) =>
      Math.abs(b.time - t) < Math.abs(a.time - t) ? b : a,
    );
    want.set(t, near);
  }
  const sheets: string[] = [];
  const needed = new Set([...want.values()].map((t) => t.sheet));
  for (const i of needed) {
    const file = path.join(work, `sheet_${i}.jpg`);
    const res = await fetch(sb.fragments[i]!.url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) continue;
    await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
    sheets[i] = file;
  }
  const files = await tileFiles(sheets, sb, [...new Set(want.values())], work);
  return new Map(
    [...want].flatMap(([t, tile]) =>
      files.get(tile.time)
        ? [[t, files.get(tile.time)!] as [number, string]]
        : [],
    ),
  );
}
