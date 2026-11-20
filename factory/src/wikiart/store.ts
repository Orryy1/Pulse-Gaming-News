// The wiki art library on disk: D:\pulse-data\wikiart\<game slug>\ (WIKIART_DIR), one folder per game with
//   index.json   the entities (a character, place, vehicle, brand, item or logo) with their aliases, and the images
//                kept for them, each with kind, source page, file page, licence text, credit and size
//   state.json   what the crawl has done (pages and files seen, and why a file was turned down) so it resumes
//   rejected.jsonl  every file turned down and why, for the audit
//   img/<id>.jpg|png  the pictures, at most 1600 px on the long side
// Pictures are deduplicated by perceptual hash (dHash, as the game library does) within the game.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { FFMPEG } from "../lib/bin.ts";
import { sceneSlug } from "../sceneindex/schema.ts";
import type { ArtKind } from "./classify.ts";

const exec = promisify(execFile);

export const WIKIART_VERSION = 1;
export const MAX_SIDE = 1600;

export function wikiartRoot(): string {
  return (
    process.env.WIKIART_DIR ||
    (process.platform === "win32"
      ? "D:\\pulse-data\\wikiart"
      : path.join(process.env.DATA_DIR || "data", "wikiart"))
  );
}

/** A game's folder name: the same slug the game library uses ("grand-theft-auto-vi"). */
export function artSlug(canonicalTitle: string): string {
  return sceneSlug(canonicalTitle);
}

export interface ArtImage {
  id: string;
  /** Relative to the game folder: "img/3fa2c1d0.jpg". */
  file: string;
  kind: ArtKind;
  origin: "official" | "in-game";
  width: number;
  height: number;
  bytes: number;
  dhash?: string;
  sha1?: string;
  /** The wiki it came from ("GTA Wiki") and its file description page. */
  wiki: string;
  filePage: string;
  /** The original file URL on the wiki's CDN. */
  fileUrl: string;
  /** "File:Artwork-JasonDuval-GTAVI.jpg" */
  fileTitle: string;
  /** The licence or copyright line as the wiki gives it. */
  licence: string;
  /** Filed under this very game (its code in the file name, the template's game field or a category). */
  forGame?: boolean;
  /** The credit line to show: "Rockstar Games artwork, via GTA Wiki". */
  credit: string;
  description?: string;
  addedAt: string;
}

export interface ArtEntity {
  name: string;
  aliases: string[];
  /** "character" | "place" | "vehicle" | "brand" | "item" | "radio" | "game" | "thing", from the article's categories. */
  type: string;
  /** The article it was found on. */
  page: string;
  wiki: string;
  /** In the game's own categories (true) or a franchise-wide extra (false, e.g. a brand page from an older game). */
  ofGame: boolean;
  /** Image ids, best first (the article's lead picture first). */
  images: string[];
}

export interface ArtIndex {
  version: number;
  game: string;
  slug: string;
  wikis: Array<{ id: string; name: string; api: string; root?: string }>;
  entities: ArtEntity[];
  images: ArtImage[];
  updatedAt: string;
}

export interface CrawlState {
  /** Article titles fully handled, per wiki id. */
  pages: Record<string, string[]>;
  /** File titles decided: "kept:<id>", "dup:<id>" or "rejected:<why>". */
  files: Record<string, string>;
  /** Categories walked, per wiki id. */
  categories: Record<string, string[]>;
  /** Names asked for that are still to look up. */
  wanted: string[];
  /** Names looked up and not found on any wiki, with when. */
  missing: Record<string, string>;
  lastRun?: string;
}

export const emptyIndex = (game: string): ArtIndex => ({
  version: WIKIART_VERSION,
  game,
  slug: artSlug(game),
  wikis: [],
  entities: [],
  images: [],
  updatedAt: "",
});
export const emptyState = (): CrawlState => ({
  pages: {},
  files: {},
  categories: {},
  wanted: [],
  missing: {},
});

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 1), "utf8");
  await fs.rename(tmp, file);
}

export function gameDir(root: string, game: string): string {
  return path.join(root, artSlug(game));
}

export async function readIndex(
  root: string,
  game: string,
): Promise<ArtIndex | undefined> {
  return readJson<ArtIndex>(path.join(gameDir(root, game), "index.json"));
}
export async function writeIndex(root: string, idx: ArtIndex): Promise<void> {
  idx.updatedAt = new Date().toISOString();
  await writeJson(path.join(root, idx.slug, "index.json"), idx);
}
export async function readState(
  root: string,
  game: string,
): Promise<CrawlState> {
  return {
    ...emptyState(),
    ...((await readJson<CrawlState>(
      path.join(gameDir(root, game), "state.json"),
    )) ?? {}),
  };
}
export async function writeState(
  root: string,
  game: string,
  st: CrawlState,
): Promise<void> {
  st.lastRun = new Date().toISOString();
  await writeJson(path.join(gameDir(root, game), "state.json"), st);
}
export async function logRejected(
  root: string,
  game: string,
  line: Record<string, unknown>,
): Promise<void> {
  await fs.mkdir(gameDir(root, game), { recursive: true });
  await fs.appendFile(
    path.join(gameDir(root, game), "rejected.jsonl"),
    `${JSON.stringify({ at: new Date().toISOString(), ...line })}\n`,
    "utf8",
  );
}

/** A stable id for a wiki file. */
export function imageId(wikiId: string, fileTitle: string): string {
  return createHash("sha1")
    .update(`${wikiId}|${fileTitle}`)
    .digest("hex")
    .slice(0, 12);
}

/** Hamming distance of two hex dHashes. */
export function hamming(a: string, b: string): number {
  let n = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      n += x & 1;
      x >>= 1;
    }
  }
  return n;
}

/** Bits set in a hash: a near-blank picture (a plain logo on transparency) has very few or nearly all. */
export function hashBits(h: string): number {
  return [...h].reduce(
    (n, c) => n + (parseInt(c, 16).toString(2).match(/1/g)?.length ?? 0),
    0,
  );
}

/**
 * The image already kept that a new one repeats (pure). Within the same entity a near match (6 bits) is a repeat;
 * across entities only a near-exact match (3 bits) of a picture with real detail is, so two plain text logos with
 * similar blank hashes are never merged into one (that would show the wrong brand).
 */
export function duplicateOf(
  hash: string | undefined,
  sha1: string | undefined,
  entityImages: ArtImage[],
  allImages: ArtImage[],
): ArtImage | undefined {
  if (sha1) {
    const same = allImages.find((i) => i.sha1 === sha1);
    if (same) return same;
  }
  if (!hash) return undefined;
  const near = entityImages.find((i) => i.dhash && hamming(i.dhash, hash) <= 6);
  if (near) return near;
  const bits = hashBits(hash);
  if (bits < 8 || bits > 56) return undefined;
  return allImages.find(
    (i) =>
      i.dhash &&
      hamming(i.dhash, hash) <= 3 &&
      hashBits(i.dhash) >= 8 &&
      hashBits(i.dhash) <= 56,
  );
}

/** dHash of a picture file (9x8 grey, alpha flattened on mid grey so transparent logos still hash their shape). */
export async function pictureHash(file: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec(
      FFMPEG,
      [
        "-v",
        "error",
        "-i",
        file,
        "-frames:v",
        "1",
        "-filter_complex",
        "color=c=0x808080:s=64x64[bg];[0:v]scale=64:64:flags=area,format=rgba[fg];[bg][fg]overlay=format=auto,scale=9:8:flags=area,format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20, timeout: 60_000 },
    );
    const px = stdout as unknown as Buffer;
    if (px.length < 72) return undefined;
    let bits = "";
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        bits += px[y * 9 + x]! > px[y * 9 + x + 1]! ? "1" : "0";
    let hex = "";
    for (let i = 0; i < 64; i += 4)
      hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  } catch {
    return undefined;
  }
}

/** Shrinks a downloaded picture to at most 1600 px a side: PNG keeps transparency (logos), the rest become JPEG. */
export async function normalisePicture(
  src: string,
  destNoExt: string,
  keepAlpha: boolean,
): Promise<
  { file: string; width: number; height: number; bytes: number } | undefined
> {
  const dest = `${destNoExt}.${keepAlpha ? "png" : "jpg"}`;
  const scale = `scale='min(${MAX_SIDE},iw)':'min(${MAX_SIDE},ih)':force_original_aspect_ratio=decrease:flags=lanczos`;
  const args = keepAlpha
    ? [
        "-y",
        "-v",
        "error",
        "-i",
        src,
        "-frames:v",
        "1",
        "-vf",
        `${scale},format=rgba`,
        dest,
      ]
    : [
        "-y",
        "-v",
        "error",
        "-i",
        src,
        "-frames:v",
        "1",
        "-vf",
        `${scale},format=yuvj444p`,
        "-q:v",
        "3",
        dest,
      ];
  try {
    await exec(FFMPEG, args, { timeout: 120_000 });
    const st = await fs.stat(dest);
    const dims = await pictureSize(dest);
    if (!dims) return undefined;
    return { file: dest, ...dims, bytes: st.size };
  } catch {
    await fs.rm(dest, { force: true });
    return undefined;
  }
}

/** Width and height of a picture, read by ffmpeg. */
export async function pictureSize(
  file: string,
): Promise<{ width: number; height: number } | undefined> {
  const r = await exec(FFMPEG, ["-hide_banner", "-i", file], {
    timeout: 30_000,
  }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(
    String((r as { stderr?: string }).stderr ?? ""),
  );
  return m ? { width: Number(m[1]), height: Number(m[2]) } : undefined;
}

/** Bytes used under the library root (all games). */
export async function diskUsage(root: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs
      .readdir(d, { withFileTypes: true })
      .catch(() => [])) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile())
        total += (await fs.stat(p).catch(() => ({ size: 0 }))).size;
    }
  };
  await walk(root);
  return total;
}

/** The cap on the whole library, from WIKIART_MAX_GB (default 40). */
export function capBytes(): number {
  return Number(process.env.WIKIART_MAX_GB ?? 40) * 1e9;
}
