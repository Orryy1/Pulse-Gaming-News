// The owner's own gameplay: NVIDIA instant replay (and similar) saves clips to
// Videos\<Game>\<Game> YYYY.MM.DD - HH.MM.SS.NN.mp4. When a video covers a game
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
  if (!o.root || !o.targets.length || o.maxClips <= 0) return [];
  const mine = recordingsOf(
    await libraryFiles(o.root),
    o.game,
    o.franchise,
  ).slice(0, 3);
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
  for (const c of clips) {
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
  if (out.length)
    log("info", "own gameplay used", {
      game: o.game,
      clips: out.length,
      withSound: out.filter((c) => c.audio).length,
    });
  return out;
}
