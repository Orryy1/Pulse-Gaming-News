// Harvest what people type about a game (SEARCH_SHORTS, 12 Nov 2026). About a fifth of Pulse's views come from search,
// and what people search is rarely what a headline says. Three public, keyless suggestion endpoints, read only:
//   - YouTube's autocomplete (suggestqueries.google.com, ds=yt): what people type into YouTube;
//   - Google's web autocomplete (the same endpoint without ds): what they type into Google;
//   - DuckDuckGo's autocomplete for question forms (SEARCH_PAA): the nearest free stand-in for Google's "people also
//     ask" box, which has no public endpoint and is not scraped.
// Each seed is the game's search name plus a question stem ("gta 6 can you", "is gta 6 worth it"). The reader is
// polite: one request at a time per site, a pause between requests, a short timeout, a cap on requests a pass, and
// a site that answers 403 or 429 is left alone for the rest of the pass. A failure means fewer suggestions, never a
// stopped factory.

import { searchSeeds } from "../searchterms.ts";
import { log } from "../lib/util.ts";

export type SuggestSource = "youtube" | "google" | "ddg";

/** One suggestion as it came back: the text, its place in the list (0 = first) and what was typed to get it. */
export interface Observation {
  game: string;
  query: string;
  rank: number;
  source: SuggestSource;
  seed: string;
  at: string;
}

export type HarvestFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

/** Question stems put after the game's name: the autocomplete finishes the sentence. */
export const TAIL_STEMS = [
  "how to",
  "can you",
  "best",
  "how long",
  "where",
  "how much",
  "does",
];
/** Question forms with the game's name at the end: the autocomplete finishes the question. */
export const HEAD_STEMS = [
  "is {g} worth it",
  "is {g}",
  "does {g}",
  "can you {g}",
  "how long is {g}",
  "where is {g}",
  "when does {g}",
  "how much is {g}",
  "will {g}",
];
/** The question forms also asked of DuckDuckGo (people-also-ask style). */
export const PAA_STEMS = [
  "what is {g}",
  "why is {g}",
  "how does {g}",
  "is {g}",
  "can you {g}",
  "when does {g}",
];

export interface SeedPhrase {
  phrase: string;
  sources: SuggestSource[];
}

/**
 * The phrases to type for one game (pure): its search names bare, then the shortest name with every stem. YouTube
 * and Google get every phrase; DuckDuckGo only the question forms.
 */
export function seedPhrases(game: string, paa = true): SeedPhrase[] {
  // A run of five or more initials ("codmw 4" for Call of Duty: Modern Warfare 4) is nobody's search: left out.
  const seeds = searchSeeds(game);
  const initials = new Set(
    seeds.map((n) =>
      n
        .replace(/^the /, "")
        .split(" ")
        .filter((w) => !/^\d+$/.test(w))
        .map((w) => w[0])
        .join(""),
    ),
  );
  const names = seeds
    .filter((n) => {
      const head = n.split(" ")[0]!;
      return head.length < 5 || !initials.has(head);
    })
    .sort((a, b) => a.length - b.length);
  const short = names[0];
  if (!short) return [];
  const both = (): SuggestSource[] => ["youtube", "google"];
  const out: SeedPhrase[] = names
    .slice(0, 2)
    .map((n) => ({ phrase: n, sources: both() }));
  for (const st of TAIL_STEMS)
    out.push({ phrase: `${short} ${st}`, sources: both() });
  for (const st of HEAD_STEMS)
    out.push({ phrase: st.replace("{g}", short), sources: both() });
  if (paa)
    for (const st of PAA_STEMS) {
      const phrase = st.replace("{g}", short);
      const have = out.find((p) => p.phrase === phrase);
      if (have) have.sources.push("ddg");
      else out.push({ phrase, sources: ["ddg"] });
    }
  return out;
}

/** The URL for one phrase at one site. */
export function suggestUrl(source: SuggestSource, phrase: string): string {
  const q = encodeURIComponent(phrase);
  if (source === "ddg")
    return `https://duckduckgo.com/ac/?q=${q}&type=list&kl=us-en`;
  return `https://suggestqueries.google.com/complete/search?client=firefox${source === "youtube" ? "&ds=yt" : ""}&hl=en&gl=US&q=${q}`;
}

/** The suggestions in a response body (pure): both sites answer ["typed", ["s1", "s2", ...]]. */
export function parseSuggestions(body: string): string[] {
  try {
    const j = JSON.parse(body) as unknown;
    if (Array.isArray(j) && Array.isArray(j[1]))
      return (j[1] as unknown[]).map(String).filter(Boolean);
    // DuckDuckGo's older shape: [{ phrase }, ...].
    if (Array.isArray(j))
      return j
        .map((x) =>
          x && typeof x === "object"
            ? String((x as { phrase?: unknown }).phrase ?? "")
            : "",
        )
        .filter(Boolean);
  } catch {
    // not JSON: nothing
  }
  return [];
}

export interface HarvestOptions {
  paa?: boolean;
  rateMs?: number;
  maxRequests?: number;
  fetchFn?: HarvestFetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
}

export interface HarvestResult {
  observations: Observation[];
  requests: number;
  failed: number;
  /** Sites that refused (403/429) and were left alone for the rest of the pass. */
  refused: SuggestSource[];
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Every game's suggestions, one request at a time per site with a pause between them. */
export async function harvest(
  games: string[],
  o: HarvestOptions = {},
): Promise<HarvestResult> {
  const fetchFn = o.fetchFn ?? fetch;
  const sleep = o.sleep ?? pause;
  const rate = o.rateMs ?? 1200;
  const max = o.maxRequests ?? 240;
  const now = o.now ?? (() => new Date());
  const refused = new Set<SuggestSource>();
  const observations: Observation[] = [];
  let requests = 0;
  let failed = 0;
  // The sites take turns, so one site sees a request only every two or three turns.
  const queue: Array<{ game: string; phrase: string; source: SuggestSource }> =
    [];
  // The games take turns too, so a cap on requests shares out evenly.
  const perGame = games.map((game) =>
    seedPhrases(game, o.paa ?? true).flatMap((p) =>
      p.sources.map((source) => ({ game, phrase: p.phrase, source })),
    ),
  );
  for (let i = 0; perGame.some((l) => i < l.length); i++)
    for (const l of perGame) if (l[i]) queue.push(l[i]!);
  const last = new Map<SuggestSource, number>();
  for (const job of queue) {
    if (requests >= max) break;
    if (refused.has(job.source)) continue;
    const wait = (last.get(job.source) ?? 0) + rate - Date.now();
    if (wait > 0) await sleep(wait);
    last.set(job.source, Date.now());
    requests++;
    try {
      const res = await fetchFn(suggestUrl(job.source, job.phrase), {
        headers: { "user-agent": "Mozilla/5.0", accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 403 || res.status === 429) {
        refused.add(job.source);
        failed++;
        log(
          "warn",
          "search harvest: a site refused, leaving it for this pass",
          {
            source: job.source,
            status: res.status,
          },
        );
        continue;
      }
      if (!res.ok) {
        failed++;
        continue;
      }
      // Google answers in the Latin-1 its firefox client asks for; decode the bytes as such when it says so.
      const type = res.headers.get("content-type") ?? "";
      const body = /iso-8859-1|latin1/i.test(type)
        ? new TextDecoder("latin1").decode(await res.arrayBuffer())
        : await res.text();
      const at = now().toISOString();
      parseSuggestions(body)
        .slice(0, 10)
        .forEach((query, rank) =>
          observations.push({
            game: job.game,
            query,
            rank,
            source: job.source,
            seed: job.phrase,
            at,
          }),
        );
    } catch {
      failed++;
    }
  }
  log("info", "search harvest done", {
    games: games.length,
    requests,
    observations: observations.length,
    failed,
  });
  return { observations, requests, failed, refused: [...refused] };
}
