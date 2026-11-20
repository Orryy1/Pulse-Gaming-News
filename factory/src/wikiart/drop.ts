// The owner's drop folder for the wiki art library: D:\pulse-data\wikiart-drop\ (WIKIART_DROP_DIR). Pictures the
// owner saved by hand while browsing a wiki (the GTA Wiki's Scooter Bros logo) go in one subfolder per game, named as
// people say it ("GTA 6", "Grand Theft Auto VI", "Elden Ring", mapped through canonicalGame), one picture per thing,
// named after the thing ("Scooter Bros.png", "Flash FM.jpg"). Optional, beside it: "Scooter Bros.txt" (or
// "Scooter Bros.png.txt") holding the page the picture came from, which gives the credit and the source page. A
// suffix like " (logo)" in the name sets the kind; otherwise small or transparent pictures are logos and the rest
// artwork.
//
// importDrop() brings the folder into the library: each picture is checked (a real image, at least 64 px, not a
// repeat by dHash), shrunk to at most 1600 px (PNG transparency kept) and indexed as an entity of origin "owner",
// which lookupArt ranks first for its name because he chose it. The original stays in the drop folder; drop-state.json
// under the library root remembers what was brought in, so re-runs add nothing twice, a changed picture is replaced
// and a picture taken out of the drop folder is taken out of the library. Nothing is fetched from the web.

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { FFMPEG } from "../lib/bin.ts";
import { canonicalGame } from "../assets/gamelib.ts";
import type { ArtKind } from "./classify.ts";
import { normName } from "./lookup.ts";
import {
  duplicateOf,
  emptyIndex,
  gameDir,
  imageId,
  logRejected,
  normalisePicture,
  pictureHash,
  pictureSize,
  readIndex,
  writeIndex,
  type ArtEntity,
  type ArtImage,
  type ArtIndex,
} from "./store.ts";

const exec = promisify(execFile);

/** The wiki field of everything the owner dropped in: how lookupArt knows his pictures. */
export const OWNER_WIKI = "owner";
/** The smallest picture taken: its longer side at least this, its shorter side at least a quarter of it. */
export const MIN_SIDE = 64;
/** At or under this on the longer side, a picture with no kind in its name counts as a logo. */
export const SMALL_SIDE = 512;

const PICTURE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;
const KINDS: Record<string, ArtKind> = {
  logo: "logo",
  sign: "sign",
  boxart: "boxart",
  "box art": "boxart",
  cover: "boxart",
  artwork: "artwork",
  art: "artwork",
  render: "render",
  map: "map",
  screenshot: "screenshot",
  icon: "icon",
};

export function dropRoot(): string {
  return (
    process.env.WIKIART_DROP_DIR ||
    (process.platform === "win32"
      ? "D:\\pulse-data\\wikiart-drop"
      : path.join(process.env.DATA_DIR || "data", "wikiart-drop"))
  );
}

/**
 * The thing a dropped file is named after, and the kind its name sets (pure): "Scooter Bros (logo).png" is
 * { name: "Scooter Bros", kind: "logo" }. A bracket that is not a kind stays part of the name ("Mandy (GTA 6)").
 */
export function parseDropName(file: string): { name: string; kind?: ArtKind } {
  const base = path.basename(file).replace(PICTURE, "").trim();
  const m = /^(.*\S)\s*\(([^)]+)\)$/.exec(base);
  const kind = m ? KINDS[m[2]!.trim().toLowerCase()] : undefined;
  if (kind) return { name: m![1]!.trim(), kind };
  // "Vice City Police logo.png": the narration says "Vice City Police", so a last word "logo" is the kind too.
  const bare = /^(.*\S)\s+logo$/i.exec(base);
  return bare ? { name: bare[1]!, kind: "logo" } : { name: base };
}

/** The other spellings a dropped name answers to (pure): its file name, and "Bros" and "Brothers" swapped. */
export function dropAliases(name: string, file?: string): string[] {
  const out = new Set<string>();
  if (file) out.add(path.basename(file).replace(PICTURE, "").trim());
  const swapped = name
    .replace(/\bBrothers\b/g, "\u0000")
    .replace(/\bbrothers\b/g, "\u0001")
    .replace(/\bBros\b\.?/g, "Brothers")
    .replace(/\bbros\b\.?/g, "brothers")
    .replace(/\u0000/g, "Bros")
    .replace(/\u0001/g, "bros");
  out.add(swapped);
  out.delete(name);
  out.delete("");
  return [...out];
}

/** The page a sidecar .txt names (pure): its first web address, or undefined. */
export function sourceFromText(text: string): string | undefined {
  const m = /https?:\/\/[^\s"'<>]+/i.exec(text);
  if (!m) return undefined;
  try {
    return new URL(m[0].replace(/[).,;]+$/, "")).toString();
  } catch {
    return undefined;
  }
}

/** The credit line (pure): "Image: gta.fandom.com" from the page's site, else "Image: game wiki". */
export function dropCredit(page: string | undefined): string {
  if (page) {
    try {
      const host = new URL(page).hostname.replace(/^www\./i, "");
      if (host) return `Image: ${host}`;
    } catch {
      /* not an address: the general credit */
    }
  }
  return "Image: game wiki";
}

/** The kind of a dropped picture (pure): the name's own, else a logo when small or transparent, else artwork. */
export function dropKind(
  named: ArtKind | undefined,
  width: number,
  height: number,
  transparent: boolean,
): ArtKind {
  if (named) return named;
  return transparent || Math.max(width, height) <= SMALL_SIDE
    ? "logo"
    : "artwork";
}

/** Whether a picture is big enough to use (pure). */
export function bigEnough(width: number, height: number): boolean {
  const long = Math.max(width, height);
  return long >= MIN_SIDE && Math.min(width, height) >= Math.max(16, long / 16);
}

/** Whether a picture really has see-through pixels (not just an alpha channel that is all opaque). */
export async function hasTransparency(file: string): Promise<boolean> {
  const probe = await exec(FFMPEG, ["-hide_banner", "-i", file], {
    timeout: 30_000,
  }).catch((e: { stderr?: string }) => ({ stderr: e.stderr ?? "" }));
  const line = /Video:[^\n]*/.exec(
    String((probe as { stderr?: string }).stderr ?? ""),
  )?.[0];
  if (!line || !/(rgba|bgra|argb|abgr|ya8|ya16|yuva|gbrap|pal8)/i.test(line))
    return false;
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
        "-vf",
        "format=rgba,alphaextract,scale=64:64:flags=area,format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      { encoding: "buffer", maxBuffer: 1 << 20, timeout: 60_000 },
    );
    const px = stdout as unknown as Buffer;
    return px.some((v) => v < 250);
  } catch {
    return false;
  }
}

/** One picture in the drop folder as found on disk. */
export interface DropFile {
  /** Relative to the drop root, forward slashes: "GTA 6/Scooter Bros.png". */
  rel: string;
  folder: string;
  game: string;
  file: string;
  size: number;
  mtimeMs: number;
  /** The sidecar's text, when there is one. */
  txt?: string;
}

/** What drop-state.json remembers of a picture brought in (or turned down). */
export interface DropRecord {
  game: string;
  size: number;
  mtimeMs: number;
  txt?: string;
  /** The image id it is shown by, and whether that picture is its own (false: it repeated one already kept). */
  id?: string;
  own?: boolean;
  name?: string;
  rejected?: string;
  at: string;
}

export interface DropState {
  /** The drop folder the records came from. */
  dir?: string;
  files: Record<string, DropRecord>;
}

/** The pictures in the drop folder, one level of game folders deep. */
export async function scanDrop(dir: string): Promise<DropFile[]> {
  const out: DropFile[] = [];
  for (const g of await fs
    .readdir(dir, { withFileTypes: true })
    .catch(() => [])) {
    if (!g.isDirectory() || g.name.startsWith(".") || g.name.startsWith("_"))
      continue;
    const gdir = path.join(dir, g.name);
    const entries = await fs.readdir(gdir).catch(() => [] as string[]);
    const lower = new Map(entries.map((e) => [e.toLowerCase(), e]));
    for (const f of entries) {
      if (!PICTURE.test(f) || f.startsWith(".")) continue;
      const file = path.join(gdir, f);
      const st = await fs.stat(file).catch(() => undefined);
      if (!st?.isFile()) continue;
      const side =
        lower.get(`${f}.txt`.toLowerCase()) ??
        lower.get(`${f.replace(PICTURE, "")}.txt`.toLowerCase());
      const txt = side
        ? await fs
            .readFile(path.join(gdir, side), "utf8")
            .catch(() => undefined)
        : undefined;
      out.push({
        rel: `${g.name}/${f}`,
        folder: g.name,
        game: canonicalGame(g.name),
        file,
        size: st.size,
        mtimeMs: Math.round(st.mtimeMs),
        ...(txt !== undefined ? { txt: txt.trim() } : {}),
      });
    }
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** Whether a file is unchanged since it was brought in (pure). */
export function unchanged(f: DropFile, r: DropRecord | undefined): boolean {
  return (
    !!r &&
    r.game === f.game &&
    r.size === f.size &&
    r.mtimeMs === f.mtimeMs &&
    (r.txt ?? "") === (f.txt ?? "")
  );
}

/**
 * Takes one dropped picture out of an index (pure on the index): off its owner entity, the entity gone when it has no
 * pictures left, and the owner's own picture gone when nothing else shows it. Returns the picture files to delete.
 */
export function removeFromIndex(idx: ArtIndex, rec: DropRecord): string[] {
  const id = rec.id;
  if (!id) return [];
  for (const e of idx.entities)
    if (
      e.wiki === OWNER_WIKI &&
      (!rec.name || normName(e.name) === normName(rec.name))
    )
      e.images = e.images.filter((x) => x !== id);
  idx.entities = idx.entities.filter(
    (e) => e.wiki !== OWNER_WIKI || e.images.length,
  );
  const img = idx.images.find((i) => i.id === id);
  if (!img || img.origin !== "owner") return [];
  if (idx.entities.some((e) => e.images.includes(id))) return [];
  idx.images = idx.images.filter((i) => i.id !== id);
  return [img.file];
}

/** Adds a picture to the owner's entity for a name (pure on the index), creating the entity when it is new. */
export function addToIndex(
  idx: ArtIndex,
  name: string,
  aliases: string[],
  page: string,
  id: string,
  kind: ArtKind,
): ArtEntity {
  let ent = idx.entities.find(
    (e) => e.wiki === OWNER_WIKI && normName(e.name) === normName(name),
  );
  if (!ent) {
    ent = {
      name,
      aliases: [],
      type: kind === "logo" || kind === "sign" ? "brand" : "thing",
      page,
      wiki: OWNER_WIKI,
      ofGame: true,
      images: [],
    };
    idx.entities.push(ent);
  }
  for (const a of aliases)
    if (a !== ent.name && !ent.aliases.includes(a)) ent.aliases.push(a);
  if ((!ent.page || ent.page.startsWith("owner drop folder:")) && page)
    ent.page = page;
  if (!ent.images.includes(id)) ent.images.push(id);
  return ent;
}

export interface DropReport {
  added: string[];
  removed: string[];
  /** Every picture in the drop folder not used, and why (this run's and earlier ones still there). */
  rejected: Array<{ rel: string; why: string }>;
  /** Pictures turned down on this run. */
  turnedDown: number;
  unchanged: number;
}

async function readDropState(root: string): Promise<DropState> {
  try {
    const s = JSON.parse(
      await fs.readFile(path.join(root, "drop-state.json"), "utf8"),
    ) as DropState;
    return { ...(s.dir ? { dir: s.dir } : {}), files: s.files ?? {} };
  } catch {
    return { files: {} };
  }
}

async function writeDropState(root: string, st: DropState): Promise<void> {
  const file = path.join(root, "drop-state.json");
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(`${file}.tmp`, JSON.stringify(st, null, 1), "utf8");
  await fs.rename(`${file}.tmp`, file);
}

/** Whether two folder paths are the same folder (pure; Windows paths compare without case). */
export function sameFolder(a: string, b: string): boolean {
  const n = (p: string) => {
    const r = path.resolve(p).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
}

/** Where a picture with no .txt says it came from, so the source page is never blank. */
const placeholderPage = (rel: string) => `owner drop folder: ${rel}`;

/** Brings the drop folder into the library: new and changed pictures in, removed ones out. */
export async function importDrop(
  root: string,
  dir = dropRoot(),
  log: (l: string) => void = console.log,
): Promise<DropReport> {
  const report: DropReport = {
    added: [],
    removed: [],
    rejected: [],
    turnedDown: 0,
    unchanged: 0,
  };
  const st = await readDropState(root);
  // A drop folder that cannot be read (D: not ready) or a different folder than the one the library was filled
  // from must never read as "everything was deleted".
  if (!(await fs.stat(dir).catch(() => undefined))?.isDirectory()) {
    log(`the drop folder ${dir} cannot be read: nothing changed`);
    return report;
  }
  if (st.dir && !sameFolder(st.dir, dir)) {
    log(
      `the library was filled from the drop folder ${st.dir}, not ${dir}: nothing changed`,
    );
    return report;
  }
  st.dir = dir;
  const files = await scanDrop(dir);
  const seen = new Set(files.map((f) => f.rel));
  const todo = files.filter((f) => !unchanged(f, st.files[f.rel]));
  report.unchanged = files.filter(
    (f) => !todo.includes(f) && !st.files[f.rel]?.rejected,
  ).length;
  // Gone from the drop folder, or changed (taken out first, then brought in again below).
  let out = Object.keys(st.files).filter(
    (rel) => !seen.has(rel) || todo.some((f) => f.rel === rel),
  );
  const shown = Object.values(st.files).filter((r) => r.id).length;
  if (!files.length && shown > 3) {
    log(
      `the drop folder looks empty but ${shown} pictures came from it: nothing removed (delete drop-state.json to start again)`,
    );
    out = [];
  }
  if (!out.length && !todo.length) {
    report.rejected = rejectedNow(st);
    return report;
  }

  const indexes = new Map<string, ArtIndex>();
  const unreadable = new Set<string>();
  // A missing index starts empty; one that is there but cannot be read is left alone (never rewritten with only the
  // owner's pictures, which would lose the whole wiki crawl).
  const indexFor = async (game: string): Promise<ArtIndex | undefined> => {
    if (unreadable.has(game)) return undefined;
    let idx = indexes.get(game);
    if (!idx) {
      const exists = await fs
        .stat(path.join(gameDir(root, game), "index.json"))
        .catch((e: NodeJS.ErrnoException) =>
          e.code === "ENOENT" ? undefined : e,
        );
      idx = exists ? await readIndex(root, game) : emptyIndex(game);
      if (!idx) {
        unreadable.add(game);
        log(`  the index of ${game} cannot be read: its drop pictures wait`);
        return undefined;
      }
      indexes.set(game, idx);
    }
    return idx;
  };
  const deletions: string[] = [];
  const outSet = new Set(out);

  for (const rel of out) {
    const rec = st.files[rel]!;
    if (rec.id) {
      const idx = await indexFor(rec.game);
      if (!idx) continue;
      // Another drop file that stays shows the same picture under the same name: it keeps it.
      const shared = Object.entries(st.files).some(
        ([r, o]) =>
          !outSet.has(r) &&
          o.id === rec.id &&
          o.game === rec.game &&
          normName(o.name ?? "") === normName(rec.name ?? ""),
      );
      if (!shared)
        for (const f of removeFromIndex(idx, rec))
          deletions.push(path.join(gameDir(root, rec.game), f));
    }
    if (!seen.has(rel)) {
      if (!rec.rejected) report.removed.push(rel);
      log(`  out: ${rel}`);
    }
    delete st.files[rel];
  }

  for (const f of todo) {
    if (unreadable.has(f.game)) continue;
    let made: string | undefined;
    try {
      const { name, kind: named } = parseDropName(f.file);
      const base = {
        game: f.game,
        size: f.size,
        mtimeMs: f.mtimeMs,
        ...(f.txt !== undefined ? { txt: f.txt } : {}),
      };
      const reject = async (why: string) => {
        st.files[f.rel] = {
          ...base,
          rejected: why,
          at: new Date().toISOString(),
        };
        report.turnedDown++;
        await logRejected(root, f.game, { file: f.rel, why, owner: true });
        log(`  turned down: ${f.rel}: ${why}`);
      };
      if (!name) {
        await reject("the file has no name to look it up by");
        continue;
      }
      const dims = await pictureSize(f.file);
      if (!dims) {
        await reject("not a picture that can be read");
        continue;
      }
      if (!bigEnough(dims.width, dims.height)) {
        await reject(
          `too small (${dims.width}x${dims.height}, at least ${MIN_SIDE} px wanted)`,
        );
        continue;
      }
      const transparent = await hasTransparency(f.file);
      const kind = dropKind(named, dims.width, dims.height, transparent);
      const page = f.txt ? sourceFromText(f.txt) : undefined;
      const idx = await indexFor(f.game);
      if (!idx) continue;
      const dirOut = gameDir(root, f.game);
      await fs.mkdir(path.join(dirOut, "img"), { recursive: true });
      const sha1 = createHash("sha1")
        .update(await fs.readFile(f.file))
        .digest("hex");
      const id = imageId(OWNER_WIKI, `${f.rel}|${sha1}`);
      const norm = await normalisePicture(
        f.file,
        path.join(dirOut, "img", id),
        transparent,
      );
      if (!norm) {
        await reject("could not be converted");
        continue;
      }
      made = norm.file;
      const hash = await pictureHash(norm.file);
      const ownEntity = idx.entities.find(
        (e) => e.wiki === OWNER_WIKI && normName(e.name) === normName(name),
      );
      const entImages = idx.images.filter((i) =>
        ownEntity?.images.includes(i.id),
      );
      const dup = duplicateOf(hash, sha1, entImages, idx.images);
      const facts = {
        filePage: page ?? placeholderPage(f.rel),
        fileUrl: page ?? "",
        fileTitle: path.basename(f.file),
        licence: `saved by hand by the channel owner${page ? ` from ${page}` : ""}; the game's own art`,
        credit: dropCredit(page),
        description: `Owner drop folder: ${f.rel}`,
      };
      let useId = id;
      let own = true;
      if (dup && dup.id !== id) {
        // The same picture is already kept: his name points at it, and no second copy is stored.
        await fs.rm(norm.file, { force: true });
        useId = dup.id;
        own = false;
        log(`  ${f.rel}: the same picture as ${dup.fileTitle}, kept once`);
      } else if (dup) {
        // The very same picture back (only its .txt changed): its credit and source follow the new .txt.
        if (dup.origin === "owner") Object.assign(dup, facts, { kind });
      } else {
        const img: ArtImage = {
          id,
          file: `img/${path.basename(norm.file)}`,
          kind,
          origin: "owner",
          width: norm.width,
          height: norm.height,
          bytes: norm.bytes,
          ...(hash ? { dhash: hash } : {}),
          sha1,
          wiki: OWNER_WIKI,
          ...facts,
          forGame: true,
          addedAt: new Date().toISOString(),
        };
        idx.images.push(img);
      }
      addToIndex(
        idx,
        name,
        dropAliases(name, f.file),
        page ?? placeholderPage(f.rel),
        useId,
        kind,
      );
      st.files[f.rel] = {
        ...base,
        id: useId,
        own,
        name,
        at: new Date().toISOString(),
      };
      report.added.push(f.rel);
      log(`  in: ${f.rel} as "${name}" (${kind}, ${f.game})`);
    } catch (e) {
      // Still being saved, locked or gone mid-run: not recorded, so the next run tries again.
      log(
        `  ${f.rel}: ${e instanceof Error ? e.message : e}; trying again next run`,
      );
      const idx = indexes.get(f.game);
      if (
        made &&
        !idx?.images.some((i) => path.join(root, idx.slug, i.file) === made)
      )
        await fs.rm(made, { force: true }).catch(() => {});
    }
  }

  for (const idx of indexes.values()) await writeIndex(root, idx);
  // A changed .txt brings the same picture back under the same id: its file stays.
  const kept = new Set(
    [...indexes.values()].flatMap((idx) =>
      idx.images.map((i) => path.join(root, idx.slug, i.file)),
    ),
  );
  for (const d of deletions) if (!kept.has(d)) await fs.rm(d, { force: true });
  await writeDropState(root, st);
  report.rejected = rejectedNow(st);
  return report;
}

/** Every picture in the drop folder that is not used, and why (pure). */
function rejectedNow(st: DropState): Array<{ rel: string; why: string }> {
  return Object.entries(st.files)
    .filter(([, r]) => r.rejected)
    .map(([rel, r]) => ({ rel, why: r.rejected! }));
}

/** The note for the owner at the top of the drop folder (written when it is missing). */
export const DROP_README = `WIKI ART DROP FOLDER
====================

Pictures you save here go into Pulse's wiki art library by themselves, within
half an hour. The factory then uses them when the narration names the thing,
and your picture comes first: you chose it.

HOW TO ADD A PICTURE

1. Make a folder for the game, named the way people say it, for example
   "GTA 6", "Grand Theft Auto VI" or "Elden Ring". Both GTA names land in
   the same place.

2. Save the picture into that folder, named after the thing it shows:
       GTA 6\\Scooter Bros.png
       GTA 6\\Flash FM.jpg
       GTA 6\\Vice City Police logo.png
   One picture per thing. "Bros" and "Brothers" both find it.

3. Optional: say where it came from. Make a text file with the same name
   ending in .txt and paste the page address into it:
       GTA 6\\Scooter Bros.txt   containing   https://gta.fandom.com/wiki/Scooter_Brothers
   The credit then names that site ("Image: gta.fandom.com"). Without it
   the credit says "Image: game wiki".

4. Optional: say what kind of picture it is by adding it in brackets at the
   end of the name: "Scooter Bros (logo).png". A name ending in the word
   logo, like "Vice City Police logo.png", counts as a logo of "Vice City
   Police". The kinds are logo, sign,
   artwork, render, screenshot, map, box art and icon. Without one, small or
   see-through pictures count as logos and bigger ones as artwork.

GOOD TO KNOW

- PNG keeps see-through backgrounds, so logos look best as PNG.
- Pictures need to be at least 64 pixels across. Big ones are shrunk to
  1600 pixels; your original stays here untouched.
- To take a picture out of the library, delete it from this folder.
  To swap it for a better one, save the new one over it with the same name.
- The same picture twice is only kept once.
- _report.txt in this folder says what the last check added, removed or
  could not use, and why.
`;

/** A short plain-English note of the last run, for the owner, in the drop folder. */
export function reportText(r: DropReport, when = new Date()): string {
  const lines = [
    `Last checked ${when.toISOString().slice(0, 16).replace("T", " ")} (UTC).`,
    `${r.added.length} picture(s) added, ${r.removed.length} removed, ${r.unchanged} already in the library.`,
  ];
  if (r.added.length) lines.push("", "Added:", ...r.added.map((x) => `  ${x}`));
  if (r.removed.length)
    lines.push("", "Removed:", ...r.removed.map((x) => `  ${x}`));
  if (r.rejected.length)
    lines.push(
      "",
      "Not used (fix and save again):",
      ...r.rejected.map((x) => `  ${x.rel}: ${x.why}`),
    );
  return `${lines.join("\r\n")}\r\n`;
}
