// MAP_PINS (default off): when a documentary sentence names a place in its game (a district, city, landmark or
// region), the sentence shows the game's own map with the camera flying down to a pin on that spot
// (src/render/components/GameMap3D.tsx). The maps and their places are tables in src/assets/gamemaps/*.json:
//   - the map is the publisher's own (Rockstar's Leonida poster) or a game-wiki file whose page says it is an
//     in-game or official map (wikiMapAllowed), never a fan-made one;
//   - every place has a spot on that picture, taken from the map's own printed label by the local vision model
//     and checked once against a close crop (src/tools/gamemap-locate.ts), or from the wiki's place page;
//   - only checked places are pinned. A place the table does not know gets no pin: a location is never guessed.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { GameMapGraphic, GameMapPin } from "../render/gamemap.ts";
import { fetchWithTimeout, sha256, USER_AGENT } from "../lib/util.ts";

export interface GameMapPlace extends GameMapPin {
  aliases?: string[];
  /** How the spot was found: the map's printed label (by the vision model) or the wiki's place page. */
  located: "vision" | "wiki";
  /** Only a checked place is ever pinned. */
  checked: boolean;
  /** The name is also an ordinary word or a real town ("Bonanza", "Downtown"): pinned only after a place word. */
  ambiguous?: boolean;
  /** What checked it and when, for the record. */
  check?: string;
}

export interface GameMapTable {
  id: string;
  /** The game's titles as videos name them; matched whole, so "Grand Theft Auto: Vice City" never takes GTA VI's map. */
  titles: string[];
  /** The map's own name, used as the graphic's heading ("Leonida"). */
  name: string;
  map: {
    /** The cached picture's file name (data/gamemaps/<file>). */
    file: string;
    url: string;
    width: number;
    height: number;
    sha256?: string;
    /** The part of the picture that is map (shares: left, top, right, bottom), for an in-game screen with its menu. */
    crop?: [number, number, number, number];
    credit: string;
    provenance: { kind: "official" | "wiki"; page: string; note: string };
  };
  places: GameMapPlace[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TABLE_DIR = path.join(HERE, "gamemaps");

let cache: GameMapTable[] | undefined;

/** Every table in src/assets/gamemaps (read once). */
export function gameMapTables(dir = TABLE_DIR): GameMapTable[] {
  if (cache && dir === TABLE_DIR) return cache;
  const out: GameMapTable[] = [];
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
    if (!f.endsWith(".json")) continue;
    out.push(
      JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as GameMapTable,
    );
  }
  if (dir === TABLE_DIR) cache = out;
  return out;
}

const normTitle = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The map table for a game, by whole title (or one of its listed short forms). */
export function gameMapFor(
  title: string,
  tables = gameMapTables(),
): GameMapTable | undefined {
  const t = normTitle(title);
  if (!t) return undefined;
  return tables.find((m) => m.titles.some((x) => normTitle(x) === t));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A game's title just before a name: "Grand Theft Auto: Vice City" is the 2002 game, not the place. */
const TITLE_BEFORE = /(Grand Theft Auto:?|GTA:?)\s*$/;
/** Another capitalised word just after a name: "Lanayru Wetlands", "Vice City Stories" are other things. */
const NAME_AFTER = /^\s+[A-Z][a-z]/;
/** For a name that is also an ordinary word (ambiguous in the table): the word before must say it is a place. */
const PLACE_WORD_BEFORE =
  /\b(in|at|from|to|into|near|of|through|around|across|toward|towards)\s+(the\s+)?$/i;

/**
 * The checked places a sentence names, in the order it names them, at most three. Names match whole words as the
 * map prints them (capitals and all), so "a crosstown drive" is not Crosstown; a name the table marks ambiguous (an
 * ordinary word, or a real town too) also needs a place word before it ("in Bonanza"). A longer name wins over one
 * inside it, over every name in the table, checked or not: "Vice City International Airport" is never read as
 * Vice City. A name right after the series' title, or run on into another capitalised word, is not the place.
 */
export function placesIn(
  sentence: string,
  table: GameMapTable,
): GameMapPlace[] {
  const hits: Array<{ at: number; end: number; place: GameMapPlace }> = [];
  for (const place of table.places) {
    for (const name of [place.name, ...(place.aliases ?? [])]) {
      const re = new RegExp(
        `(^|[^A-Za-z0-9])(${escape(name)})(?![A-Za-z0-9])`,
        "g",
      );
      for (const m of sentence.matchAll(re)) {
        const at = (m.index ?? 0) + m[1]!.length;
        const end = at + m[2]!.length;
        const before = sentence.slice(0, at);
        if (TITLE_BEFORE.test(before) || NAME_AFTER.test(sentence.slice(end)))
          continue;
        if (place.ambiguous && !PLACE_WORD_BEFORE.test(before)) continue;
        hits.push({ at, end, place });
      }
    }
  }
  hits.sort((a, b) => b.end - b.at - (a.end - a.at) || a.at - b.at);
  const kept: typeof hits = [];
  for (const h of hits)
    if (
      !kept.some((k) => h.at < k.end && k.at < h.end) &&
      !kept.some((k) => k.place === h.place)
    )
      kept.push(h);
  return kept
    .filter((h) => h.place.checked)
    .sort((a, b) => a.at - b.at)
    .map((h) => h.place)
    .slice(0, 3);
}

/** A map graphic for these places (the pins carry no table-only fields). */
export function gameMapGraphic(
  table: GameMapTable,
  game: string,
  places: GameMapPlace[],
): GameMapGraphic {
  const [l, t, r, b] = table.map.crop ?? [0, 0, 1, 1];
  return {
    map: table.id,
    game,
    width: Math.round(table.map.width * (r - l)),
    height: Math.round(table.map.height * (b - t)),
    credit: table.map.credit,
    ...(table.map.crop ? { crop: table.map.crop } : {}),
    // Pins as shares of the crop.
    pins: places.map(({ name, x, y, kind }) => ({
      name,
      x: (x - l) / (r - l),
      y: (y - t) / (b - t),
      kind,
    })),
  };
}

/** Whether a place lies inside the table's map crop (all of the picture when there is none), clear of its edge. */
export function insideCrop(
  table: GameMapTable,
  p: { x: number; y: number },
): boolean {
  const [l, t, r, b] = table.map.crop ?? [0, 0, 1, 1];
  const mx = (r - l) * 0.03;
  const my = (b - t) * 0.03;
  return p.x > l + mx && p.x < r - mx && p.y > t + my && p.y < b - my;
}

type Graphic = {
  kind: string;
  primary: string;
  secondary: string;
  items: string[];
  gameMap?: GameMapGraphic;
  evidence?: unknown;
};

/**
 * MAP_PINS: put the game's map on sentences that name its places. Only a sentence with nothing of its own on
 * screen takes one (no graphic, filler shot or person's name tag), at most `max` a chapter (default 2), never two
 * within `gap` sentences (default 4), never the opening sentence. Pure: the picture is staged later (stageGameMaps).
 */
export function markGameMaps<
  M extends { graphic: Graphic; emphasis: string; filler?: unknown; person?: string },
>(
  moments: M[],
  sentences: string[],
  game: string,
  opts: { max?: number; gap?: number; tables?: GameMapTable[] } = {},
): { moments: M[]; added: string[] } {
  const table = gameMapFor(game, opts.tables);
  if (!table) return { moments, added: [] };
  const max = opts.max ?? 2;
  const gap = opts.gap ?? 4;
  const added: string[] = [];
  let last = -Infinity;
  const out = moments.map((m, i) => {
    if (i === 0 || added.length >= max || i - last < gap) return m;
    if (m.graphic.kind !== "none" || m.filler || m.person?.trim()) return m;
    const places = placesIn(sentences[i] ?? "", table).filter((p) =>
      insideCrop(table, p),
    );
    if (!places.length) return m;
    last = i;
    added.push(`${i + 1}: ${places.map((p) => p.name).join(", ")}`);
    return {
      ...m,
      emphasis: "",
      graphic: {
        kind: "map",
        primary: table.name,
        secondary: game,
        items: places.map((p) => p.name),
        gameMap: gameMapGraphic(table, game, places),
      },
    };
  });
  return { moments: out, added };
}

/**
 * Whether a game-wiki file page allows its picture as a map: it must say the map is in-game or official (or be a
 * screenshot or promotional picture of the game), and never be fan-made or an edited version.
 */
export function wikiMapAllowed(fileInfo: string): boolean {
  const t = fileInfo.toLowerCase();
  if (
    /fan[- ]?made|fan ?art|fanart|edited version|recreat|custom map|unofficial|mock-?up|concept by/.test(
      t,
    )
  )
    return false;
  return (
    /in-game|in game|as seen in the game|\bofficial\b/.test(t) ||
    /\|\s*type\s*=\s*(screenshot|promotional screenshot|promotional artwork)\b/.test(
      t,
    )
  );
}

/** The map picture on disk (data/gamemaps/<file>), downloaded once from its source and checked. */
export async function ensureMapImage(
  table: GameMapTable,
  cacheDir: string,
): Promise<string> {
  const file = path.join(cacheDir, table.map.file);
  const ok = (buf: Buffer) =>
    buf.length > 10_000 &&
    (!table.map.sha256 || sha256(buf) === table.map.sha256);
  if (fs.existsSync(file) && ok(await fsp.readFile(file))) return file;
  const res = await fetchWithTimeout(
    table.map.url,
    { headers: { "user-agent": USER_AGENT } },
    60_000,
  );
  if (!res.ok)
    throw new Error(`map ${table.id}: ${res.status} from ${table.map.url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!ok(buf))
    throw new Error(
      `map ${table.id}: the downloaded picture does not match the table`,
    );
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.writeFile(file, buf);
  return file;
}

/**
 * Copy each map a chapter's graphics use into the episode's folder (gamemaps/<file>) and point the graphics at it.
 * A map whose picture cannot be had is taken off again: the sentence goes back to what it was before marking
 * (`before`, its caption included), or to no graphic, never a blank map.
 */
export async function stageGameMaps<M extends { graphic: Graphic }>(
  moments: M[],
  episodeDir: string,
  cacheDir: string,
  opts: {
    tables?: GameMapTable[];
    fetchImage?: typeof ensureMapImage;
    before?: M[];
  } = {},
): Promise<{ moments: M[]; failed: string[] }> {
  const tables = opts.tables ?? gameMapTables();
  const fetchImage = opts.fetchImage ?? ensureMapImage;
  const failed: string[] = [];
  const staged = new Map<string, string | undefined>();
  const out: M[] = [];
  for (const [i, m] of moments.entries()) {
    const gm = m.graphic.gameMap;
    if (!gm || gm.file) {
      out.push(m);
      continue;
    }
    if (!staged.has(gm.map)) {
      const table = tables.find((t) => t.id === gm.map);
      try {
        if (!table) throw new Error(`no table ${gm.map}`);
        const src = await fetchImage(table, cacheDir);
        const rel = `gamemaps/${table.map.file}`;
        await fsp.mkdir(path.join(episodeDir, "gamemaps"), { recursive: true });
        await fsp.copyFile(src, path.join(episodeDir, rel));
        staged.set(gm.map, rel);
      } catch (err) {
        failed.push(
          `${gm.map}: ${err instanceof Error ? err.message : String(err)}`,
        );
        staged.set(gm.map, undefined);
      }
    }
    const rel = staged.get(gm.map);
    out.push(
      rel
        ? { ...m, graphic: { ...m.graphic, gameMap: { ...gm, file: rel } } }
        : (opts.before?.[i] ?? {
            ...m,
            graphic: { kind: "none", primary: "", secondary: "", items: [] },
          }),
    );
  }
  return { moments: out, failed };
}
