// The owner's own gameplay: NVIDIA instant replay (and similar) saves clips to
// Videos\<Game>\<Game> YYYY.MM.DD - HH.MM.SS.NN.mp4, and the gameplay lane's inbox holds 40-second
// cuts of every Twitch/Xbox broadcast, each with the game its reviewer saw. When a video covers a game
// the owner has recorded, those recordings come first: they are the best footage
// there is, and publishers' content-usage rules allow it. Originals are never
// changed or deleted: the matcher works on hard links inside the episode folder.
import fs from "node:fs/promises";
import path from "node:path";
import type { Llm } from "../editorial/llm.ts";
import { errorMessage, log } from "../lib/util.ts";
import { matchClips, type FootageTarget } from "./clipscore.ts";
import { trailerMatchesGame } from "./commons.ts";
import type { VisualAsset } from "./steam.ts";
import { keepGameSound } from "./talk.ts";

export interface LibraryFile {
  game: string; // the folder name, which the recorder sets to the game's name
  file: string;
  mtimeMs: number;
  bytes: number;
}

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[®™©:–—\-]/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Recordings whose file name starts with their folder's name (the NVIDIA pattern), newest first. */
export async function libraryFiles(root: string): Promise<LibraryFile[]> {
  const out: LibraryFile[] = [];
  const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const folder = path.join(root, d.name);
    for (const f of await fs.readdir(folder).catch(() => [] as string[])) {
      if (!/\.(mp4|mkv|mov)$/i.test(f) || !norm(f).startsWith(norm(d.name)))
        continue;
      const st = await fs.stat(path.join(folder, f)).catch(() => undefined);
      if (st?.isFile())
        out.push({
          game: d.name,
          file: path.join(folder, f),
          mtimeMs: st.mtimeMs,
          bytes: st.size,
        });
    }
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * The gameplay lane's inbox clips (Pulse Gameplay\inbox\<id>\clip.mp4) whose reviewer named the game, newest
 * first. A clip with licensed radio audible stays out (Content ID), and so does one not yet looked at.
 */
export async function inboxFiles(root: string): Promise<LibraryFile[]> {
  const out: LibraryFile[] = [];
  const inbox = path.join(root, "inbox");
  for (const id of await fs.readdir(inbox).catch(() => [] as string[])) {
    const dir = path.join(inbox, id);
    const meta = await fs
      .readFile(path.join(dir, "meta.json"), "utf8")
      .then((t) => JSON.parse(t.trimStart()))
      .catch(() => undefined);
    const game = meta?.review?.game;
    if (typeof game !== "string" || !game.trim() || meta.review.radio === true)
      continue;
    if (meta.status === "new" || meta.status === "reviewing") continue;
    // Another streamer's play (a permitted channel, src/vodindex/sources.ts) is never "the owner's own footage".
    if (meta.source?.credit) continue;
    const file = path.join(dir, meta.clip?.file || "clip.mp4");
    const st = await fs.stat(file).catch(() => undefined);
    if (st?.isFile())
      out.push({ game, file, mtimeMs: st.mtimeMs, bytes: st.size });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** The owner's stream recordings of exactly this game, by the game their title names, newest first. */
export async function vodFiles(dir: string, game: string): Promise<LibraryFile[]> {
  const { listRecordings } = await import("../vodindex/vods.ts");
  return (await listRecordings(dir, [game]).catch(() => []))
    .filter((r) => r.game === game)
    .map((r) => ({ game, file: r.file, mtimeMs: r.mtimeMs, bytes: r.bytes }));
}

/** The recordings of exactly this game (a sequel's or the series' other games' never count). */
export function recordingsOf(
  files: LibraryFile[],
  game: string,
  franchise: string,
): LibraryFile[] {
  return files.filter(
    (f) =>
      norm(f.game) === norm(game) ||
      trailerMatchesGame(f.game, game, franchise),
  );
}

export interface LibraryClipOpts {
  root: string;
  /** The gameplay lane's folder (holds inbox/); empty leaves those clips out. */
  inbox?: string;
  /** The owner's whole stream recordings (VOD miner, "YYYY-MM-DD <title> [id].mp4"): the game is read from the title. */
  vods?: string;
  game: string;
  franchise: string;
  episodeDir: string;
  targets: FootageTarget[];
  maxClips: number;
  llm?: Llm;
  prefix?: string;
}

/** Moments from the owner's recordings matched to the given lines, with game sound when nobody is talking. */
export async function libraryClips(o: LibraryClipOpts): Promise<VisualAsset[]> {
  if ((!o.root && !o.inbox && !o.vods) || !o.targets.length || o.maxClips <= 0) return [];
  // Long NVIDIA recordings: the newest three. The inbox's 40-second cuts are short, so up to eight of them.
  const mine = [
    ...recordingsOf(
      o.root ? await libraryFiles(o.root) : [],
      o.game,
      o.franchise,
    ).slice(0, 3),
    ...recordingsOf(
      o.inbox ? await inboxFiles(o.inbox) : [],
      o.game,
      o.franchise,
    ).slice(0, 8),
    // The day's whole streams too (15 Nov 2026: a GTA V stream sat on the PC and no Short could reach it).
    ...(o.vods ? await vodFiles(o.vods, o.game) : []).slice(0, 2),
  ];
  if (!mine.length) return [];
  const prefix = o.prefix ?? "own";
  const work = path.join(o.episodeDir, `${prefix}_work`);
  await fs.mkdir(work, { recursive: true });
  const trailers: Array<{
    file: string;
    name: string;
    url: string;
    total: number;
  }> = [];
  for (const [i, f] of mine.entries()) {
    const link = path.join(work, `${prefix}_${i}${path.extname(f.file)}`);
    try {
      await fs.link(f.file, link).catch(async () => fs.copyFile(f.file, link)); // a link where the drive allows, else a copy
      trailers.push({
        file: link,
        name: path.basename(f.file),
        url: `own:${path.basename(f.file)}`,
        total: 0,
      });
    } catch (err) {
      log("warn", "own recording unavailable", {
        file: f.file,
        error: errorMessage(err),
      });
    }
  }
  if (!trailers.length) return [];
  // The matcher needs each recording's length.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { FFMPEG } = await import("../lib/bin.ts");
  for (const t of trailers) {
    const { stderr } = await promisify(execFile)(
      FFMPEG,
      ["-hide_banner", "-i", t.file],
      { maxBuffer: 4 * 1024 * 1024 },
    ).catch((e: { stderr?: string }) => ({ stderr: String(e.stderr ?? "") }));
    const m = String(stderr).match(/Duration: (\d+):(\d+):([\d.]+)/);
    t.total = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  }
  const usable = trailers.filter((t) => t.total >= 10);
  const clips = usable.length
    ? await matchClips({
        trailers: usable,
        episodeDir: o.episodeDir,
        targets: o.targets,
        maxClips: o.maxClips,
        llm: o.llm,
        prefix,
        clipSeconds: 8,
        continuous: true,
        describe: (t, seconds, at) =>
          `Pulse's own gameplay capture of ${o.game} (${t.name}), ${seconds}s at ${at.toFixed(1)}s, muted`,
      }).catch((err) => {
        log("warn", "own footage matching failed", {
          game: o.game,
          error: errorMessage(err),
        });
        return [] as VisualAsset[];
      })
    : [];
  await fs.rm(work, { recursive: true, force: true }).catch(() => undefined); // removes the links only; the recordings stay
  const out: VisualAsset[] = [];
  const dark: string[] = [];
  for (const c of clips) {
    // Murky play never goes out as the owner's footage (27 Nov guide proof: a dim warehouse, mean brightness 30-58,
    // under the first twenty seconds); the next footage takes its place.
    if (!ownClipVisible(await sampledLumas(path.join(o.episodeDir, c.file)))) {
      dark.push(c.file);
      continue;
    }
    const audio = await keepGameSound(path.join(o.episodeDir, c.file)).catch(
      () => false,
    );
    out.push({
      ...c,
      audio,
      provenance: audio
        ? c.provenance.replace(/, muted$/, ", with game sound")
        : c.provenance,
    });
  }
  if (dark.length)
    log("info", "own gameplay too dark, left out", { game: o.game, clips: dark.length });
  if (out.length)
    log("info", "own gameplay used", {
      game: o.game,
      clips: out.length,
      withSound: out.filter((c) => c.audio).length,
    });
  return out;
}

/**
 * Murky play (27 Nov guide proof: a dim warehouse, raw frames averaging 45-55 with nothing brighter than about 110 and
 * almost no colour) is told from night play (dark on average, but lit: headlights, neon, street lamps) by the bright
 * end and the colour of each frame. A frame is murky when its average is under MURKY_LUMA, its bright end (signalstats
 * YHIGH, the 90th percentile) under MURKY_HIGH and its colour (SATAVG) under MURKY_SAT: a night road lit by a few small
 * lamps or one neon sign keeps its colour. With no bright-end reading, murky is an average under OWN_CLIP_MIN_LUMA.
 * (YMAX can't tell them apart: the white HUD text keeps it near 200 in the warehouse too.)
 */
export const OWN_CLIP_MIN_LUMA = 45;
export const MURKY_LUMA = 70;
export const MURKY_HIGH = 120;
export const MURKY_SAT = 15;

export type FrameLight = number | { luma: number; high?: number; sat?: number };

/** Whether one sampled frame is murky (pure). */
export function murkyFrame(f: FrameLight): boolean {
  const { luma, high, sat } = typeof f === "number" ? { luma: f, high: undefined, sat: undefined } : f;
  return high === undefined
    ? luma < OWN_CLIP_MIN_LUMA
    : luma < MURKY_LUMA && high < MURKY_HIGH && (sat ?? 0) < MURKY_SAT;
}

/**
 * Whether an own-play clip is fit to show (pure): fewer than half its sampled frames murky. No reading (ffmpeg could
 * not say) keeps the clip, as before.
 */
export function ownClipVisible(frames: readonly FrameLight[]): boolean {
  if (!frames.length) return true;
  return frames.filter(murkyFrame).length / frames.length < 0.5;
}

/** A clip's light, two frames a second at 320 px over its first 30 s: each frame's average and bright end. */
export async function sampledLumas(file: string): Promise<Array<{ luma: number; high?: number; sat?: number }>> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { FFMPEG } = await import("../lib/bin.ts");
    const { stdout, stderr } = await promisify(execFile)(
      FFMPEG,
      ["-hide_banner", "-t", "30", "-i", file, "-vf", "fps=2,scale=320:-2,format=yuv420p,signalstats,metadata=print:file=-", "-f", "null", "-"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return lightFrames(`${stdout}\n${stderr}`);
  } catch {
    return [];
  }
}

/** ffmpeg's metadata=print output as frames of average and bright end (pure). */
export function lightFrames(text: string): Array<{ luma: number; high?: number; sat?: number }> {
  const out: Array<{ luma: number; high?: number; sat?: number }> = [];
  for (const block of text.split(/frame:\d+/).slice(1)) {
    const luma = Number(block.match(/YAVG=([\d.]+)/)?.[1]);
    const high = Number(block.match(/YHIGH=([\d.]+)/)?.[1]);
    const sat = Number(block.match(/SATAVG=([\d.]+)/)?.[1]);
    if (!Number.isFinite(luma)) continue;
    out.push({ luma, ...(Number.isFinite(high) ? { high } : {}), ...(Number.isFinite(sat) ? { sat } : {}) });
  }
  return out;
}
