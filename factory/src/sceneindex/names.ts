// The game's own names (characters, places, the things its story turns on), so a shot is described with them:
// "Ganondorf" and "Temple of Time", not "a man in armour" and "a stone hall". They come from the game's Wikipedia
// article (the factory's existing reader, src/discovery/wikipedia.ts: plot, setting and characters sections), from
// the name plates the text reader saw beside the dialogue, and are handed to the local vision model as the only
// names it may use. Extraction is pure and tested; only gameNames() touches the network.

import { splitSections } from "../discovery/wikipedia.ts";

const PLACE_WORD =
  /\b(Castle|Temple|Forest|Woods|Village|Town|City|Lake|Mountain|Mount|Valley|Desert|Field|Fields|Ranch|Kingdom|Realm|Island|Islands|Domain|Cavern|Caverns|Cave|River|Tower|Fortress|Palace|Dungeon|Shrine|Market|Graveyard|Bay|Beach|Harbor|Harbour|County|Street|Bridge|Prison|Swamp|Keys|Heights|Station|Hotel|Bar|Club|Church|Sanctuary|Garden|Gardens|Ruins|Plains|Canyon|Volcano|Crater|Sea|Ocean|World|Land|Lands)\b/;

/** Capitalised words that are not the game's names: the calendar, platforms, companies, wiki furniture. */
const NOT_NAMES = new Set(
  "The A An In On At After Before When While As It He She They His Her Their This That These Those However Although Meanwhile Later During With Without Upon Once Now Then There Here But And Or If Because Since Having Using Following Players Player Development Gameplay Plot Story Setting Characters Reception Release Synopsis Nintendo Switch PlayStation Xbox Sony Microsoft Windows Steam PC Wii GameCube Game Boy Advance DS Rockstar Games Ubisoft Capcom Sega Square Enix Bandai Namco Electronic Arts Activision Blizzard IGN GameSpot Eurogamer Famitsu Metacritic Japan Japanese North America American Europe European English January February March April May June July August September October November December Monday Tuesday Wednesday Thursday Friday Saturday Sunday HD DLC RPG AI NPC II III IV VI VII VIII IX One Two Three Four Five Six Seven Eight Nine Ten First Second Third New Old Great".split(
    " ",
  ),
);

/**
 * Names in running text: runs of capitalised words (small joining words allowed inside: "Temple of Time", "Lon
 * Lon Ranch"), counted where they are not just the first word of a sentence. A one-word name must be used at
 * least twice inside sentences; a longer one once. Most used first.
 */
export function namesInText(text: string, max = 80): string[] {
  const counts = new Map<string, number>();
  const sentences = text
    .replace(/==+[^=]+==+/g, ". ")
    .split(/(?<=[.!?:;])\s+|\n+/);
  const run =
    /\b[\p{Lu}][\p{L}'’-]+(?:\s+(?:of|the|de|del|la|von|and)\s+(?=[\p{Lu}])|\s+(?=[\p{Lu}]))?(?:[\p{Lu}][\p{L}'’-]+(?:\s+(?:of|the|de|la)\s+(?=[\p{Lu}])|\s+(?=[\p{Lu}]))?){0,3}/gu;
  for (const sentence of sentences) {
    for (const m of sentence.matchAll(run)) {
      let name = m[0].trim().replace(/['’]s$/, "");
      let words = name.split(/\s+/);
      // The first word of a sentence is capitalised whatever it is: drop it when it is an ordinary word.
      if (m.index === 0 && NOT_NAMES.has(words[0]!)) {
        words = words.slice(1);
        name = words.join(" ");
      }
      while (words.length && NOT_NAMES.has(words[words.length - 1]!))
        words.pop();
      while (words.length && NOT_NAMES.has(words[0]!)) words.shift();
      name = words.join(" ");
      if (!name || name.length < 3 || words.every((w) => NOT_NAMES.has(w)))
        continue;
      const startOfSentence = m.index === 0 && words.length === 1;
      counts.set(name, (counts.get(name) ?? 0) + (startOfSentence ? 0.5 : 1));
    }
  }
  return [...counts]
    .filter(([name, n]) => (name.includes(" ") ? n >= 1 : n >= 1.5))
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([name]) => name);
}

/** Names split into places (by their kind of word: Castle, Forest, Village...) and everything else (people, things). */
export function splitNames(names: string[]): {
  cast: string[];
  places: string[];
} {
  const cast: string[] = [];
  const places: string[] = [];
  for (const n of names) (PLACE_WORD.test(n) ? places : cast).push(n);
  return { cast, places };
}

/** Lists joined without repeats, whatever the capitals ("Great Deku Tree" once), first spelling kept. */
export function mergeNames(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of lists.flat()) {
    const k = name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name.trim());
  }
  return out;
}

/**
 * A name from the list for something the model or the text reader wrote: the list's own spelling when the words
 * are the same or the reading is a single slip away ("Ganondorf" for "Ganondort"), undefined when it is not on
 * the list. A one-word reading also matches a longer name it is the telling word of ("Zelda" -> "Princess Zelda").
 */
export function knownName(reading: string, list: string[]): string | undefined {
  const norm = (t: string) =>
    t
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const r = norm(reading);
  if (r.length < 3) return undefined;
  const exact = list.find((n) => norm(n) === r);
  if (exact) return exact;
  const part = list.find(
    (n) => norm(n).split(" ").includes(r) && r.length >= 4,
  );
  if (part) return part;
  return list.find((n) => {
    const k = norm(n);
    return (
      Math.abs(k.length - r.length) <= 1 && k.length >= 6 && slips(k, r) <= 1
    );
  });
}

/** Edits between two strings, counted up to 2. */
function slips(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === b.length) {
    let d = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return 2;
    return d;
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  for (let i = 0; i < long.length; i++)
    if (long.slice(0, i) + long.slice(i + 1) === short) return 1;
  return 2;
}

const API = "https://en.wikipedia.org/w/api.php";
const UA = "PulseGamingNewsBot/1.0 (+https://www.youtube.com/@PulseGamingNews)";
/** The parts of a game's article that tell its story; development, sales and awards name people who are not in the game. */
const STORY_SECTION = /^(plot|story|synopsis|premise|narrative|setting|characters?|world|cast)\b|\b(setting|characters|plot|story)$/i;

/** The story text of an article's plain-text extract: its plot, setting and character sections (pure). */
export function storyText(extract: string): string {
  return splitSections(extract)
    .filter((sec) => STORY_SECTION.test(sec.title.trim()))
    .map((sec) => sec.text)
    .join("\n\n");
}

async function extract(title: string, fetchFn: typeof fetch): Promise<string> {
  const q = new URLSearchParams({
    action: "query",
    prop: "extracts",
    explaintext: "1",
    exsectionformat: "wiki",
    redirects: "1",
    format: "json",
    formatversion: "2",
    titles: title,
  });
  const res = await fetchFn(`${API}?${q}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return "";
  const page = ((await res.json()) as any)?.query?.pages?.[0];
  return page && !page.missing ? String(page.extract ?? "") : "";
}

async function search(query: string, fetchFn: typeof fetch): Promise<string[]> {
  const q = new URLSearchParams({ action: "query", list: "search", srsearch: query, srlimit: "3", format: "json", formatversion: "2" });
  const res = await fetchFn(`${API}?${q}`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return [];
  return (((await res.json()) as any)?.query?.search ?? []).map((x: { title: string }) => String(x.title));
}

/**
 * The game's names from Wikipedia: the story sections of its own article (and, for a remake, of the original's,
 * whose plot section is the full one), plus the game's own "List of ... characters" article where one exists.
 * Empty lists when Wikipedia has nothing; the name plates read off the screen then make the cast.
 */
export async function gameNames(
  game: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ cast: string[]; places: string[] }> {
  const titles = new Set<string>([game]);
  for (const t of await search(`${game} video game`, fetchFn).catch(() => [])) {
    // The same game under a disambiguated title ("... (2026 video game)"), never a sequel or a spin-off.
    if (t.replace(/\s*\([^)]*\)\s*$/, "").toLowerCase() === game.toLowerCase()) titles.add(t);
  }
  const lists = (await search(`intitle:characters ${game}`, fetchFn).catch(() => [])).filter(
    (t) => /characters/i.test(t) && t.toLowerCase().includes(game.toLowerCase()),
  );
  const texts: string[] = [];
  for (const title of titles) texts.push(storyText(await extract(title, fetchFn).catch(() => "")));
  for (const title of lists.slice(0, 1)) {
    const text = await extract(title, fetchFn).catch(() => "");
    // A characters list is all story; its section headings are names themselves.
    texts.push(
      splitSections(text)
        .filter((sec) => !/^(reception|development|concept|legacy|influence|merchandise)/i.test(sec.title))
        .map((sec) => `${sec.title}. ${sec.text.slice(0, 1500)}`)
        .join("\n\n"),
    );
  }
  return splitNames(namesInText(texts.join("\n\n")).filter((n) => !game.toLowerCase().includes(n.toLowerCase())));
}
