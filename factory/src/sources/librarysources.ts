// The new sources into the game media library (src/assets/gamelib.ts), so every Short, guide and long video that
// picks from the library gets them: press kit stills (PRESS_KITS) ranked first among stills, and Pulse's own
// achievement cards (ACHIEVEMENT_ART) filed under each achievement's name, so a line that names the achievement
// shows its card.

import fs from "node:fs/promises";
import path from "node:path";
import {
  canonicalGame,
  dhash,
  isNearDuplicate,
  itemId,
  libraryDir,
  LIBRARY_VERSION,
  readLibrary,
  writeLibrary,
  type GameLibrary,
} from "../assets/gamelib.ts";
import { errorMessage, log } from "../lib/util.ts";
import { kitProvenance, type PressKitAsset, type PressKitIndex } from "./presskits.ts";
import type { PoliteFetch } from "./polite.ts";

/** The library source name of a press kit still: "<publisher> press kit" (src/assets/gamelib.ts sourceBonus). */
export const pressKitSourceName = (publisher: string) =>
  `${publisher} press kit`;
export const ACHIEVEMENT_SOURCE = "Steam achievements";

async function load(root: string, game: string): Promise<GameLibrary> {
  return (
    (await readLibrary(root, game)) ?? {
      version: LIBRARY_VERSION,
      game: canonicalGame(game),
      items: [],
      updatedAt: "",
    }
  );
}

const termsLine = (a: PressKitAsset) =>
  `${a.terms.summary} (${a.terms.url}, checked ${a.terms.checked})`;

/**
 * Brings a game's indexed press kit stills (screenshots and key art) into its library: a picture the library already
 * holds (the same address, or a near-identical copy) is marked as the kit's, the rest are downloaded. Returns how
 * many were added and how many existing pictures were marked.
 */
export async function addPressKitStills(
  root: string,
  idx: PressKitIndex,
  fetch: PoliteFetch,
  max = 80,
): Promise<{ added: number; marked: number }> {
  const lib = await load(root, idx.game);
  const dir = libraryDir(root, idx.game);
  await fs.mkdir(path.join(dir, "stills"), { recursive: true });
  let added = 0;
  let marked = 0;
  for (const a of idx.assets) {
    if (added >= max) break;
    if (
      a.terms.allowedUse !== "editorial" ||
      (a.kind !== "screenshot" && a.kind !== "key_art")
    )
      continue;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(a.url)) continue;
    const same = lib.items.find((i) => i.sourceUrl === a.url);
    if (same) {
      if (!same.pressKit) {
        same.pressKit = true;
        same.terms = termsLine(a);
        marked++;
      }
      continue;
    }
    const id = itemId(a.url);
    const file = path.join(
      "stills",
      `${id}${/\.(png|webp)(\?|$)/i.exec(a.url)?.[0]?.replace(/\?$/, "") ?? ".jpg"}`,
    );
    try {
      const res = await fetch(a.url);
      if (!res.ok) continue;
      await fs.writeFile(
        path.join(dir, file),
        Buffer.from(await res.arrayBuffer()),
      );
    } catch (err) {
      log("info", "press kit still not downloaded", {
        url: a.url,
        error: errorMessage(err),
      });
      continue;
    }
    const hash = await dhash(path.join(dir, file));
    const twin = lib.items.find(
      (i) => i.kind === "still" && isNearDuplicate(hash, [i.dhash]),
    );
    if (twin) {
      // The library already holds this picture (often from the publisher's own site): it is the kit picture, so
      // it takes the kit's standing and terms rather than being stored twice.
      await fs.rm(path.join(dir, file), { force: true });
      if (!twin.pressKit) {
        twin.pressKit = true;
        twin.terms = termsLine(a);
        marked++;
      }
      continue;
    }
    lib.items.push({
      id,
      kind: "still",
      file,
      sourceUrl: a.url,
      provenance: kitProvenance(a),
      source: pressKitSourceName(a.publisher),
      named: a.entities.filter((e) => e !== idx.game),
      tags: [],
      seen: "",
      ...(hash ? { dhash: hash } : {}),
      pressKit: true,
      terms: termsLine(a),
      addedAt: new Date().toISOString(),
    });
    added++;
  }
  if (added || marked) await writeLibrary(root, lib);
  return { added, marked };
}

/** Files Pulse's achievement cards in a game's library, each named by its achievement. Returns how many were added. */
export async function addAchievementCards(
  root: string,
  game: string,
  cards: Array<{ file: string; name: string; provenance: string }>,
): Promise<number> {
  const lib = await load(root, game);
  const dir = libraryDir(root, game);
  await fs.mkdir(path.join(dir, "stills"), { recursive: true });
  let added = 0;
  for (const c of cards) {
    const sourceUrl = `pulse-card:${c.provenance.match(/https:\/\/\S+/)?.[0] ?? game}#${c.name}`;
    if (lib.items.some((i) => i.sourceUrl === sourceUrl)) continue;
    const id = itemId(sourceUrl);
    const file = path.join("stills", `${id}.jpg`);
    await fs.copyFile(c.file, path.join(dir, file));
    lib.items.push({
      id,
      kind: "still",
      file,
      sourceUrl,
      provenance: c.provenance,
      source: ACHIEVEMENT_SOURCE,
      named: [c.name, "achievement"],
      // The card is text by design: the tagger's "large lettering" rule must not rule it out, so it is pre-tagged.
      tags: ["achievement", "menu"],
      seen: `achievement card: ${c.name}`,
      addedAt: new Date().toISOString(),
    });
    added++;
  }
  if (added) await writeLibrary(root, lib);
  return added;
}
