// The owner's stream index (VOD_MINER, owner, 12 Nov 2026: "pull clips out of my already recorded gameplay when I
// stream every single day"). One file a recording, made the same way as a game's scene index (src/sceneindex): the
// recording split into shots at its cuts, each shot described by the free local vision model, the writing on screen
// read, and everything said (the owner's own commentary and the game's voices) transcribed by Whisper with word times.
// Unlike a scene index it is the owner's own play, so it says what he did, not what the story is: the stream-ask
// miner (src/streamasks/miner.ts) searches it for moments that prove or disprove what people are asking, and the
// weekly long guide (claude/longguide) can look moments up in it the same way.
// On disk: <data>/vodindex/<vod-id>/index.json. The recording itself is never copied: the index names the file.
// This file is the shape and the rules for reading and storing it (pure except the small file helpers at the end).

import fs from "node:fs/promises";
import path from "node:path";
import {
  mergeCoverage,
  sceneSlug,
  type DialogueLine,
  type SceneIndex,
  type SceneShot,
} from "../sceneindex/schema.ts";

export const VOD_INDEX_VERSION = 1;

export interface VodIndex {
  version: number;
  /** The Twitch id ("v2917738469") or, for a file without one, a name made from the file. */
  vodId: string;
  /** The recording on this machine (absolute). */
  file: string;
  /** The stream title, from the file name. */
  title: string;
  /** The game played, from the title (or set by hand); "" when it could not be told. */
  game: string;
  /** YYYY-MM-DD the stream was recorded, from the file name; "" when unknown. */
  recordedOn: string;
  /** Seconds. */
  duration: number;
  builtAt: string;
  coverage: Array<{ from: number; to: number }>;
  shots: SceneShot[];
  lines: DialogueLine[];
}

/** A recording's name as the downloader writes it: "2026-11-02 GTA V 100% [v2917738469].mp4" (pure). */
export function parseVodName(file: string): {
  vodId: string;
  title: string;
  recordedOn: string;
} {
  const base = path.basename(file).replace(/\.[a-z0-9]+$/i, "");
  const id = base.match(/\[([\w-]+)\]\s*$/)?.[1];
  const date = base.match(/^(\d{4}-\d{2}-\d{2})\s+/)?.[1] ?? "";
  const title = base
    .replace(/\s*\[[\w-]+\]\s*$/, "")
    .replace(/^\d{4}-\d{2}-\d{2}\s+/, "")
    .replace(/[：]/g, ":")
    .trim();
  return {
    vodId: id ?? `f-${sceneSlug(base).slice(0, 60) || "recording"}`,
    title,
    recordedOn: date,
  };
}

export function vodIndexDir(dataDir: string, vodId: string): string {
  return path.join(dataDir, "vodindex", vodId.replace(/[^\w-]/g, "_"));
}

export function emptyVodIndex(
  file: string,
  duration: number,
  game: string,
  now: Date,
): VodIndex {
  const n = parseVodName(file);
  return {
    version: VOD_INDEX_VERSION,
    vodId: n.vodId,
    file,
    title: n.title,
    game,
    recordedOn: n.recordedOn,
    duration,
    builtAt: now.toISOString(),
    coverage: [],
    shots: [],
    lines: [],
  };
}

const num = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** An index file as this code can use it, or undefined (newer, broken, not an index): undefined means build again. */
export function parseVodIndex(raw: unknown): VodIndex | undefined {
  const o = raw as Partial<VodIndex> | null;
  if (!o || typeof o !== "object") return undefined;
  if (!num(o.version) || o.version < 1 || o.version > VOD_INDEX_VERSION)
    return undefined;
  if (typeof o.vodId !== "string" || !o.vodId || typeof o.file !== "string")
    return undefined;
  if (!num(o.duration) || o.duration <= 0) return undefined;
  const shots = (Array.isArray(o.shots) ? o.shots : [])
    .filter((s) => s && num(s.start) && num(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start)
    .map((s, i) => ({
      ...s,
      id: i,
      keyframes: Array.isArray(s.keyframes) ? s.keyframes.filter(num) : [],
      desc: String(s.desc ?? ""),
      who: Array.isArray(s.who) ? s.who.map(String) : [],
      where: String(s.where ?? ""),
      mood: String(s.mood ?? ""),
      tags: Array.isArray(s.tags) ? s.tags.map(String) : [],
      text: String(s.text ?? ""),
      luma: num(s.luma) ? s.luma : 0,
      motion: num(s.motion) ? s.motion : 0,
    }));
  const lines = (Array.isArray(o.lines) ? o.lines : [])
    .filter(
      (l) => l && num(l.start) && num(l.end) && String(l.text ?? "").trim(),
    )
    .sort((a, b) => a.start - b.start)
    .map((l, i) => ({ ...l, id: i, text: String(l.text).trim() }));
  return {
    version: VOD_INDEX_VERSION,
    vodId: o.vodId,
    file: o.file,
    title: String(o.title ?? ""),
    game: String(o.game ?? ""),
    recordedOn: String(o.recordedOn ?? ""),
    duration: o.duration,
    builtAt: String(o.builtAt ?? ""),
    coverage: mergeCoverage(
      (Array.isArray(o.coverage) ? o.coverage : []).filter(
        (c) => c && num(c.from) && num(c.to),
      ),
    ),
    shots,
    lines,
  };
}

/**
 * The index in the scene index's shape (pure), so the scene index's lookups (findShots, findQuote) search a stream
 * the same way they search a game. The source is the recording; its id is the VOD's, not a YouTube id.
 */
export function asSceneIndex(v: VodIndex): SceneIndex {
  return {
    version: 1,
    game: v.game || v.title,
    slug: sceneSlug(v.game || v.title),
    source: {
      videoId: v.vodId,
      title: v.title,
      uploader: "TinoTV",
      duration: v.duration,
      kind: "playthrough",
      pickedAt: v.builtAt,
    },
    builtAt: v.builtAt,
    coverage: v.coverage,
    cast: [],
    places: [],
    shots: v.shots,
    lines: v.lines,
  };
}

/** What was said and read between two moments, in order (pure): the miner's and the guide's transcript window. */
export function wordsBetween(
  v: Pick<VodIndex, "lines">,
  from: number,
  to: number,
): string {
  return v.lines
    .filter((l) => l.end > from && l.start < to)
    .map((l) => l.text)
    .join(" ");
}

/** Shots between two moments (pure). */
export function shotsBetween(
  v: Pick<VodIndex, "shots">,
  from: number,
  to: number,
): SceneShot[] {
  return v.shots.filter((s) => s.end > from && s.start < to);
}

export async function loadVodIndex(
  dataDir: string,
  vodId: string,
): Promise<VodIndex | undefined> {
  try {
    return parseVodIndex(
      JSON.parse(
        await fs.readFile(
          path.join(vodIndexDir(dataDir, vodId), "index.json"),
          "utf8",
        ),
      ),
    );
  } catch {
    return undefined;
  }
}

/** Every stored index, newest recording first (for the guide and the miner). */
export async function listVodIndexes(dataDir: string): Promise<VodIndex[]> {
  const root = path.join(dataDir, "vodindex");
  const names = await fs.readdir(root).catch(() => [] as string[]);
  const out: VodIndex[] = [];
  for (const name of names) {
    const v = await loadVodIndex(dataDir, name);
    if (v) out.push(v);
  }
  return out.sort(
    (a, b) =>
      b.recordedOn.localeCompare(a.recordedOn) ||
      b.vodId.localeCompare(a.vodId),
  );
}

/** Written beside itself first and renamed, so a reader never sees half a file. */
export async function saveVodIndex(
  dataDir: string,
  v: VodIndex,
): Promise<string> {
  const dir = vodIndexDir(dataDir, v.vodId);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, "index.json");
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(v));
  await fs.rename(tmp, file);
  return file;
}
