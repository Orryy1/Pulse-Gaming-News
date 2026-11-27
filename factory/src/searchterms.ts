// The words people actually type (growth levers, 5 Nov 2026). A third of the channel's Short views come from YouTube
// search, and 86% of its thumbnail impressions, and what they type is rarely what a headline says: "mw4 campaign
// review", "aot 3 game", "saros zenith". YouTube's own autocomplete is free, needs no key and uses no quota, so before an
// upload the factory asks it what people search around the game and keeps the few that this video really answers: every
// word of a term beyond the game's name has to be in the script. Nothing is promised that the video doesn't deliver,
// and those terms go only in the tags and one plain line of the description. SEARCH_TERMS turns it on. A failure means
// no terms; it can't delay or stop an upload.
import { log } from "./lib/util.ts";

export const SEARCH_TERMS_MAX = 4;

// Searches we never court, whatever the script says: cheats, piracy, leaks.
const NEVER =
  /\b(leak|leaks|leaked|datamine|datamined|crack|cracked|torrent|free download|apk|mod menu|glitch|glitches|cheat|cheats|hack|hacks|nude|nudes|sex|rom|roms|emulator)\b/;
// Words that say nothing about what a video covers, so they don't have to be in the script.
const FILLER = new Set(
  "the a an of in on for and to is it you my game games video videos new with at".split(
    " ",
  ),
);

// Words that promise a kind of video: they must be in the title, headline or hook, not just somewhere in the script.
const PROMISE = new Set(
  "review reviews trailer gameplay walkthrough guide tutorial ending endings explained tips ranked ranking comparison".split(
    " ",
  ),
);

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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

/** The name as people shorten it (pure): "Call of Duty: Modern Warfare 4" also gives "modern warfare 4", "VI" gives "6". */
export function searchSeeds(game: string): string[] {
  const out = new Set<string>();
  const clean = norm(game);
  if (!clean) return [];
  out.add(clean);
  const after = game.includes(":") ? norm(game.split(":").pop() ?? "") : "";
  if (after.split(" ").length >= 2) out.add(after);
  for (const s of [...out]) {
    const num = s
      .split(" ")
      .map((w) => ROMAN[w] ?? w)
      .join(" ");
    if (num !== s) out.add(num);
  }
  // A long name is searched by its initials: "grand theft auto 6" as "gta 6", "attack on titan 3" as "aot 3". Only a
  // plain name or one ending in its number: "the elder scrolls 6 sentinel" isn't "tes6s" to anyone.
  for (const s of [...out]) {
    const words = s.replace(/^the /, "").split(" ");
    const tail = /^\d+$/.test(words.at(-1) ?? "") ? words.at(-1)! : "";
    const head = tail ? words.slice(0, -1) : words;
    if (head.length < 3 || head.length > 5 || head.some((w) => /\d|^[ivx]+$/.test(w)))
      continue;
    out.add(`${head.map((w) => w[0]).join("")}${tail ? ` ${tail}` : ""}`);
  }
  return [...out];
}

/**
 * The terms a video can honestly be found under (pure), best first as autocomplete gave them. A term has to carry one of
 * the game's names, every other word must be in the script, and cheats and leaks never count.
 */
export function usableTerms(
  suggestions: string[],
  game: string,
  scriptText: string,
  max = SEARCH_TERMS_MAX,
  promiseText = scriptText,
): string[] {
  const seeds = searchSeeds(game).sort((a, b) => b.length - a.length);
  if (!seeds.length) return [];
  const said = new Set(norm(scriptText).split(" "));
  const promised = new Set(norm(promiseText).split(" "));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of suggestions) {
    const term = norm(raw);
    if (!term || seen.has(term) || term.length > 60 || NEVER.test(term))
      continue;
    seen.add(term);
    const seed = seeds.find(
      (s) => term.startsWith(`${s} `) || term.endsWith(` ${s}`),
    );
    if (!seed) continue; // the bare name is in every tag list already
    const rest = term.replace(seed, " ").split(/\s+/).filter(Boolean);
    if (rest.some((w) => !FILLER.has(w) && !said.has(w))) continue;
    if (rest.some((w) => PROMISE.has(w) && !promised.has(w))) continue;
    if (seeds.includes(term)) continue;
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

export type SuggestFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/** YouTube's autocomplete for one phrase. Empty on any trouble. */
export async function suggestions(
  phrase: string,
  fetchFn: SuggestFetch = fetch,
): Promise<string[]> {
  try {
    const res = await fetchFn(
      `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&gl=US&q=${encodeURIComponent(phrase)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return [];
    const body = JSON.parse(await res.text()) as [string, string[]];
    return Array.isArray(body?.[1]) ? body[1].map(String) : [];
  } catch {
    return [];
  }
}

/** The title's distinctive words, for asking autocomplete about this story and not only about the game (pure). */
export function titleWords(title: string, game: string, max = 3): string[] {
  const inName = new Set(searchSeeds(game).join(" ").split(" "));
  return [
    ...new Set(
      norm(title)
        .split(" ")
        .filter(
          (w) => w.length >= 4 && !FILLER.has(w) && !inName.has(w) && !/^\d+$/.test(w),
        ),
    ),
  ].slice(0, max);
}

/** The terms for one video: autocomplete on the game's shortest names and on the shortest name plus each title word. */
export async function searchTermsFor(
  game: string,
  scriptText: string,
  fetchFn: SuggestFetch = fetch,
  title = "",
  promiseText = scriptText,
): Promise<string[]> {
  const seeds = searchSeeds(game).sort((a, b) => a.length - b.length);
  const shortest = seeds[0];
  if (!shortest || norm(game).split(" ").length > 8) return [];
  const phrases = [
    ...seeds.slice(0, 2),
    ...titleWords(title, game).map((w) => `${shortest} ${w}`),
  ];
  const lists = await Promise.all(phrases.map((s) => suggestions(s, fetchFn)));
  const terms = usableTerms(
    lists.flat(),
    game,
    scriptText,
    SEARCH_TERMS_MAX,
    promiseText,
  );
  if (terms.length)
    log("info", "search terms found", { game, terms: terms.length });
  return terms;
}

/** The one plain line in the description, or nothing. */
export function searchLine(terms: string[] | undefined): string {
  return terms?.length ? `Covers: ${terms.join(", ")}.` : "";
}
