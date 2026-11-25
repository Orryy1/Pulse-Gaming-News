// Which Steam page may stand for a ranking entry (STEAM_EDITIONS, 25 Nov 2026). The year rule in
// src/pipeline.ts steamAppForEntry refused any store page more than a year off the entry's year, to keep the 2019
// Modern Warfare reboot off "Call of Duty 4" and the Resident Evil 4 remake off the 2005 game. On the Mass Effect
// ranking it refused all four Steam pages (Legendary Edition 2021 for Mass Effect and Mass Effect 3, Andromeda
// Deluxe Edition 2020, "Mass Effect 2 (2010) Edition" 2023), so every entry lost its trailers and screenshots and the
// video was 0.6% moving footage. A later edition of the same game, or a collection of the series that contains it,
// shows the same game: those are taken now. A remake or a reboot is a different game and stays refused.
// Pure: no network, no files.

/** Words that say a store page is a re-release of the same game, not a new one. */
export const EDITION =
  /\b(legendary|deluxe|definitive|complete|ultimate|gold|premium|enhanced|anniversary|game of the year|goty|remaster(ed)?|hd|collection|trilogy|anthology|bundle|director'?s cut|special|standard|digital)\b|\(\s*(19|20)\d\d\s*\)|\bedition\b/i;
/**
 * Words that mark a re-release whatever the gap (a Legendary Edition, a remaster, a "(2010) Edition"). The other
 * edition words (Deluxe, Gold, Ultimate, Standard...) are purchase tiers that new games launch with too: "Resident
 * Evil 4 Gold Edition" is the 2023 remake's, so a tier word alone counts only within TIER_MAX_GAP years. Definitive,
 * Complete and Anniversary are tier words too: "Mafia: Definitive Edition" (2020) and "Tomb Raider: Anniversary"
 * (2007) are remakes, "SimCity Complete Edition" the 2013 reboot.
 */
const RERELEASE =
  /\b(legendary|enhanced|remaster(ed)?|hd|collection|trilogy|anthology|director'?s cut)\b|\(\s*(19|20)\d\d\s*\)/i;
export const TIER_MAX_GAP = 4;
/** Words that say it is a new game made again: never the old one's pictures. */
const REMADE = /\b(remake|reboot|reimagined|re-?imagin\w*)\b/i;

/** A title as words, trademark signs and punctuation gone (pure). */
export function titleWords(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[™®©]/g, " ")
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

const ROMAN: Record<string, string> = {
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  vi: "6",
  vii: "7",
  viii: "8",
  ix: "9",
  x: "10",
};
const norm = (w: string) => ROMAN[w] ?? w;

/** The store name without its edition words and years: what game it is (pure). */
export function storeBase(storeName: string): string[] {
  return titleWords(
    storeName
      .replace(/\(\s*(19|20)\d\d\s*\)/g, " ")
      .replace(new RegExp(EDITION.source, "gi"), " "),
  )
    .filter((w) => w !== "the" && w !== "edition")
    .map(norm);
}

/**
 * How a Steam page relates to a ranking entry whose year it does not match (pure):
 * - "edition": the same game re-released (its base title is the entry's title), e.g. Mass Effect 2 (2010) Edition;
 * - "collection": a series collection whose base title starts the entry's title, e.g. Mass Effect Legendary Edition
 *   for Mass Effect 3 (its trailers show the trilogy: the clip matcher picks this entry's moments by what they show);
 * - undefined: anything else, a remake, a reboot or another game, which stays refused.
 */
export function steamEditionOf(
  entryTitle: string,
  storeName: string,
  /** Years between the entry's release and the store page's. */
  gapYears: number,
  /** The writer's Steam search term for the entry: a collection is taken only when it was asked for by name. */
  asked?: string,
  /** The entry's release year, checked against a year in the store's name. */
  entryYear?: number,
): "edition" | "collection" | undefined {
  if (!storeName.trim() || !entryTitle.trim()) return undefined;
  if (REMADE.test(storeName)) return undefined;
  if (!EDITION.test(storeName)) return undefined;
  // A store page older than the entry is an older game ("Resident Evil 4 (2005)" for the 2023 remake).
  if (gapYears < 0) return undefined;
  if (!RERELEASE.test(storeName) && gapYears > TIER_MAX_GAP) return undefined;
  // A year in the store's name is the game's own year: it must be the entry's ("DOOM (1993)" is not DOOM 2016).
  const named = storeName.match(/\(\s*((?:19|20)\d\d)\s*\)/)?.[1];
  if (
    named &&
    entryYear !== undefined &&
    Math.abs(Number(named) - entryYear) > 1
  )
    return undefined;
  const entry = titleWords(entryTitle)
    .filter((w) => w !== "the")
    .map(norm);
  const base = storeBase(storeName);
  if (!base.length || !entry.length) return undefined;
  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((w, i) => w === b[i]);
  // "Mass Effect: Andromeda" as an entry and "Mass Effect Andromeda Deluxe Edition" as the page: the same words.
  if (same(base, entry)) return "edition";
  // A series collection: the store's base is the series name the entry's title starts with, and the page calls
  // itself a collection of some kind (a Legendary Edition, a Trilogy, a Collection), never a numbered sequel.
  const prefix =
    base.length < entry.length && base.every((w, i) => w === entry[i]);
  const collects =
    /\b(legendary|collection|trilogy|anthology|complete|bundle)\b/i.test(
      storeName,
    );
  // Only when the writer asked for that collection by name (the entry's steam_search_term): a series collection
  // need not contain every game of the series (the Legendary Edition has no Andromeda).
  const askedFor =
    !!asked &&
    storeBase(asked).length > 0 &&
    storeBase(asked).every((w, i) => w === base[i]) &&
    /\b(legendary|collection|trilogy|anthology|complete|bundle)\b/i.test(asked);
  if (prefix && collects && askedFor && !/\d/.test(base[base.length - 1] ?? ""))
    return "collection";
  return undefined;
}
