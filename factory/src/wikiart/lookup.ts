// lookupArt(game, name): the best picture the wiki art library holds for a name the narration says, or nothing.
// The same rule as the mentions code: never invent a picture. A name only matches an entity's own name or one of
// its aliases (the wiki's redirects to that article, and the name it was asked for when the wiki's search found an
// article with that exact title or redirect), after spelling is evened out ("Scooter Bros" = "Scooter Brothers",
// accents, "the", punctuation). No match means no picture.
//
// Where it reads from: on the PC the library folder itself (WIKIART_DIR); on the Mac the PC's game library server
// (GAMELIB_REMOTE, http://192.168.0.93:8793), which serves the index and pictures under /wikiart/ and answers
// /wikiart/lookup?game=&name= itself so the Mac never has to pull a whole index.

import fs from "node:fs/promises";
import path from "node:path";
import { canonicalGame } from "../assets/gamelib.ts";
import { fetchWithTimeout } from "../lib/util.ts";
import {
  artSlug,
  readIndex,
  wikiartRoot,
  type ArtEntity,
  type ArtImage,
  type ArtIndex,
} from "./store.ts";

export interface ArtHit {
  game: string;
  /** The entity's name on the wiki ("Scooter Brothers") and what it is. */
  name: string;
  type: string;
  kind: ArtImage["kind"];
  origin: ArtImage["origin"];
  /** The picture is filed under this very game (false: another game of the same series showed the thing). */
  forGame: boolean;
  /** Local path (PC) or URL (served by the PC library server). */
  file?: string;
  url?: string;
  width: number;
  height: number;
  /** What to show in the credits, and the terms as the wiki states them. */
  credit: string;
  licence: string;
  /** The article and the file page it came from. */
  sourcePage: string;
  filePage: string;
  /** Other pictures of the same thing, best first (ids), for variety. */
  more: number;
}

const WORD_FORMS: Array<[RegExp, string]> = [
  [/\bbros\b\.?/g, "brothers"],
  [/\bbro\b/g, "brother"],
  [/\bst\b\.?/g, "saint"],
  [/\bmt\b\.?/g, "mount"],
  [/\bft\b\.?/g, "fort"],
  [/\bdr\b\.?/g, "doctor"],
  [/\bco\b\.?/g, "company"],
  [/\bintl\b/g, "international"],
  [/&/g, " and "],
  [/\+/g, " plus "],
];

/** A name in one comparable spelling (pure): lower case, no accents, no "the", no punctuation, short forms spelt out. */
export function normName(s: string): string {
  let t = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\s*\((?:[^)]*)\)\s*$/g, " ") // "Mandy (GTA 6)": the wiki's disambiguation in brackets
    .replace(/'s\b/g, "s")
    .replace(/'/g, "");
  for (const [re, to] of WORD_FORMS) t = t.replace(re, to);
  return t
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/^(the|a|an) /, "")
    .trim();
}

const TYPE_RANK: Record<string, number> = {
  logo: 0,
  sign: 1,
  boxart: 2,
  artwork: 3,
  render: 4,
  screenshot: 5,
  map: 6,
  icon: 7,
};

/** The entities a name matches (pure), the game's own first. */
export function matchEntities(
  idx: Pick<ArtIndex, "entities">,
  name: string,
): ArtEntity[] {
  const want = normName(name);
  if (!want) return [];
  const hits = idx.entities.filter(
    (e) =>
      e.images.length &&
      [e.name, ...e.aliases].some((a) => normName(a) === want),
  );
  return hits.sort((a, b) => Number(b.ofGame) - Number(a.ofGame));
}

/** The best picture of an entity (pure): its lead picture unless a better kind for its type is there; official first. */
export function bestImage(
  e: ArtEntity,
  images: Map<string, ArtImage>,
  prefer?: ArtImage["kind"][],
): ArtImage | undefined {
  const list = e.images
    .map((id) => images.get(id))
    .filter((i): i is ArtImage => !!i);
  if (!list.length) return undefined;
  const wanted =
    prefer ??
    (e.type === "brand" || e.type === "radio" || e.type === "company"
      ? ["logo", "sign", "artwork", "screenshot"]
      : e.type === "game"
        ? ["boxart", "logo", "artwork", "screenshot"]
        : e.type === "place"
          ? ["artwork", "screenshot", "map", "sign"]
          : ["artwork", "render", "screenshot", "logo"]);
  const rank = (i: ArtImage) => {
    const k = wanted.indexOf(i.kind);
    // This game's own picture of the thing beats one filed under another game of the series, whatever its kind.
    return (
      (i.forGame === false ? 1000 : 0) +
      (k < 0 ? 10 + (TYPE_RANK[i.kind] ?? 9) : k) * 10 +
      (i.origin === "official" ? 0 : 1)
    );
  };
  const lead = list[0]!;
  const sorted = [...list].sort(
    (a, b) => rank(a) - rank(b) || b.width * b.height - a.width * a.height,
  );
  // The article's own lead picture wins a tie of kind: it is the one the wiki chose to show the thing.
  return rank(lead) <= rank(sorted[0]!) ? lead : sorted[0];
}

/** The hit for a name in an index (pure); undefined when nothing matches. */
export function lookupInIndex(
  idx: ArtIndex,
  name: string,
  o: { base?: string; dir?: string; prefer?: ArtImage["kind"][] } = {},
): ArtHit | undefined {
  const images = new Map(idx.images.map((i) => [i.id, i]));
  for (const e of matchEntities(idx, name)) {
    const img = bestImage(e, images, o.prefer);
    if (!img) continue;
    return {
      game: idx.game,
      name: e.name,
      type: e.type,
      kind: img.kind,
      origin: img.origin,
      forGame: img.forGame !== false,
      ...(o.dir ? { file: path.join(o.dir, img.file) } : {}),
      ...(o.base
        ? { url: `${o.base}/${idx.slug}/${img.file.split(path.sep).join("/")}` }
        : {}),
      width: img.width,
      height: img.height,
      credit: img.credit,
      licence: img.licence,
      sourcePage: e.page,
      filePage: img.filePage,
      more: e.images.length - 1,
    };
  }
  return undefined;
}

const cache = new Map<string, { at: number; idx?: ArtIndex }>();

/** The remote base for the library on the PC's game library server, or undefined on the PC itself. */
export function remoteBase(): string | undefined {
  const r =
    process.env.WIKIART_REMOTE ||
    (process.env.GAMELIB_REMOTE
      ? `${process.env.GAMELIB_REMOTE.replace(/\/$/, "")}/wikiart`
      : "");
  return r || undefined;
}

/**
 * The best official picture for a name in a game (official art first, credited), or undefined: no match, no picture.
 * Reads the local library when it is here (the PC), else asks the PC's server (the Mac).
 */
export async function lookupArt(
  game: string,
  name: string,
  o: { prefer?: ArtImage["kind"][]; root?: string; remote?: string } = {},
): Promise<ArtHit | undefined> {
  const title = canonicalGame(game);
  const root = o.root ?? wikiartRoot();
  const slug = artSlug(title);
  const localIdx = path.join(root, slug, "index.json");
  if (await fs.stat(localIdx).catch(() => undefined)) {
    const hit = cache.get(localIdx);
    let idx = hit && Date.now() - hit.at < 60_000 ? hit.idx : undefined;
    if (!idx) {
      idx = await readIndex(root, title);
      cache.set(localIdx, { at: Date.now(), idx });
    }
    return idx
      ? lookupInIndex(idx, name, {
          dir: path.join(root, slug),
          prefer: o.prefer,
        })
      : undefined;
  }
  const base = o.remote ?? remoteBase();
  if (!base) return undefined;
  try {
    const qs = new URLSearchParams({
      game: title,
      name,
      ...(o.prefer ? { prefer: o.prefer.join(",") } : {}),
    });
    const res = await fetchWithTimeout(`${base}/lookup?${qs}`, {}, 10_000);
    if (!res.ok) return undefined;
    const hit = (await res.json()) as ArtHit | null;
    return hit ?? undefined;
  } catch {
    return undefined;
  }
}

/** Saves a hit's picture into a folder (an episode's assets); returns the path, or undefined when it cannot. */
export async function fetchArt(
  hit: ArtHit,
  destNoExt: string,
): Promise<string | undefined> {
  const ext = path.extname(hit.file ?? hit.url ?? "") || ".jpg";
  const dest = `${destNoExt}${ext}`;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  if (hit.file) {
    await fs.copyFile(hit.file, dest);
    return dest;
  }
  if (!hit.url) return undefined;
  try {
    const res = await fetchWithTimeout(hit.url, {}, 30_000);
    if (!res.ok) return undefined;
    await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    return dest;
  } catch {
    return undefined;
  }
}
