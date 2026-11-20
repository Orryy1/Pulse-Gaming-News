// The publisher's own named pictures, from the game library (src/assets/gamelib.ts), into the wiki art index: the
// official stills a publisher's site files under a name (Rockstar's "People/Jason Duval", "Places/Vice City") become
// entities there too, so lookupArt answers them with the publisher as the source. Only stills from the publisher's
// own site with a real name are taken (never IGDB, Steam or the owner's recordings, never a bare "screenshot" tag).
// Nothing is fetched from the web.

import fs from "node:fs/promises";
import path from "node:path";
import {
  libraryDir,
  libraryRoot,
  readLibrary,
  canonicalGame,
} from "../assets/gamelib.ts";
import { normName } from "./lookup.ts";
import {
  duplicateOf,
  emptyIndex,
  gameDir,
  imageId,
  normalisePicture,
  pictureHash,
  readIndex,
  writeIndex,
  type ArtImage,
} from "./store.ts";

/** Whether a library tag is a name worth an entity (pure): not a generic word, not an all-capitals pattern name. */
export function nameTag(tag: string): boolean {
  if (!tag || tag.length < 3) return false;
  if (
    /^(screenshot|trailer|gameplay|still|video|artwork|key art|logo)$/i.test(
      tag,
    )
  )
    return false;
  if (tag === tag.toUpperCase() && /[A-Z]{4,}/.test(tag)) return false; // "VINTAGE VICE CITY WEAPON PATTERN"
  return /^[A-Z]/.test(tag);
}

export async function importLibrary(
  root: string,
  game: string,
  log: (l: string) => void = console.log,
): Promise<{ kept: number; entities: number }> {
  const title = canonicalGame(game);
  const libRoot = libraryRoot(process.env.DATA_DIR || "data");
  const lib = await readLibrary(libRoot, title);
  if (!lib) throw new Error(`no game library for ${title} under ${libRoot}`);
  const src = libraryDir(libRoot, title);
  const idx = (await readIndex(root, title)) ?? emptyIndex(title);
  const dir = gameDir(root, title);
  await fs.mkdir(path.join(dir, "img"), { recursive: true });
  const images = new Map(idx.images.map((i) => [i.id, i]));
  let kept = 0;
  for (const item of lib.items) {
    if (item.kind !== "still" || item.unusable) continue;
    if (
      /^(IGDB|Steam|own)$/i.test(item.source) ||
      !/^Official /.test(item.provenance)
    )
      continue;
    const names = item.named.filter(nameTag);
    if (!names.length) continue;
    const id = imageId(`library:${item.source}`, item.sourceUrl);
    if (!images.has(id)) {
      const out = await normalisePicture(
        path.join(src, item.file),
        path.join(dir, "img", id),
        false,
      );
      if (!out) {
        log(`  could not read ${item.file}`);
        continue;
      }
      const hash = await pictureHash(out.file);
      const dup = duplicateOf(hash, undefined, [], idx.images);
      if (dup) {
        await fs.rm(out.file, { force: true });
        images.set(id, dup);
      } else {
        const img: ArtImage = {
          id,
          file: `img/${path.basename(out.file)}`,
          kind: "screenshot",
          origin: "official",
          width: out.width,
          height: out.height,
          bytes: out.bytes,
          ...(hash ? { dhash: hash } : {}),
          wiki: `${item.source} (publisher's site)`,
          filePage: item.sourceUrl,
          fileUrl: item.sourceUrl,
          fileTitle: item.sourceUrl.split("#").pop() ?? item.sourceUrl,
          licence: "the publisher's own press material, from its official site",
          forGame: true,
          credit: `${item.source} official screenshot`,
          description: item.provenance.slice(0, 240),
          addedAt: new Date().toISOString(),
        };
        idx.images.push(img);
        images.set(id, img);
        kept++;
      }
    }
    const imgId = images.get(id)!.id;
    for (const n of names) {
      let ent = idx.entities.find((e) => normName(e.name) === normName(n));
      if (!ent) {
        // The pack's own folders say what it shows: "#People/Jason Duval/...", "#Places/Vice City/...".
        const folder = item.sourceUrl.split("#")[1] ?? "";
        ent = {
          name: n,
          aliases: [],
          type:
            /(^|\/)people\//i.test(folder) && !/ and /.test(n)
              ? "character"
              : /(^|\/)places\//i.test(folder)
                ? "place"
                : "thing",
          page: item.sourceUrl.split("#")[0]!,
          wiki: `${item.source} (publisher's site)`,
          ofGame: true,
          images: [],
        };
        idx.entities.push(ent);
      }
      // The publisher's own picture goes before wiki pictures of the same thing.
      // In the publisher's own order (its first picture of each thing leads).
      if (!ent.images.includes(imgId)) ent.images.push(imgId);
    }
  }
  await writeIndex(root, idx);
  log(
    `${title}: ${kept} publisher pictures added, ${idx.entities.length} named things in the index`,
  );
  return { kept, entities: idx.entities.length };
}
