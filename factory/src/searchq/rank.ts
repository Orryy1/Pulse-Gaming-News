// Cluster and score what people search (SEARCH_SHORTS). Everything here is pure.
//   - Duplicates are one query: the game's name is set aside, its many spellings ("gta 6", "gta vi", "gta6") are one,
//     phrasings that mean the same ("come out", "release date") become one word, and what is left is the key.
//   - Each query is scored by demand (its place in the suggestion lists, how many sites and seeds gave it), freshness
//     (new since the last harvests, or about a launch days away) and how answerable it is from confirmed facts or the
//     owner's own play. A query no confirmed line answers is never made, whatever its demand.
//   - Leaks, cheats and piracy are never courted; story spoilers (endings, deaths, twists) are dropped outright, as the
//     spoiler guard would refuse the script anyway (src/sceneindex/spoilers.ts); a query a Pulse video already
//     answered is left out.
//   - The title is the searcher's own words, title-cased, inside the house title rules (src/editorial/editorial.ts).

import { searchSeeds } from "../searchterms.ts";
import { gameAliases, SPOILER_PHRASES } from "../sceneindex/spoilers.ts";
import { titleProblems as seoTitleProblems } from "../editorial/seo.ts";
import type { Fact, PlayNote } from "./facts.ts";
import type { Observation, SuggestSource } from "./harvest.ts";

export type AnswerKind = "facts" | "play" | "press" | "none";

export interface QueryCluster {
  key: string;
  game: string;
  /** The best-placed wording: what the title and the Short answer. */
  query: string;
  variants: string[];
  sources: SuggestSource[];
  seeds: number;
  /** Best place in any list, 0 = first. */
  bestRank: number;
  hits: number;
  intent: string;
  kind: AnswerKind;
  /** 0-1: how well confirmed facts or the owner's play answer it. */
  answerable: number;
  facts: Fact[];
  playNotes: PlayNote[];
  /** Answered only by a reported (unconfirmed) line: said with its label. */
  rumour: boolean;
  firstSeen: string;
  lastSeen: string;
  demand: number;
  fresh: number;
  score: number;
  title: string;
  titleProblems: string[];
  /** Why it will not be made: a spoiler, a leak, covered by a Pulse video, not answerable. */
  dropped?: string;
  covered?: string;
}

// ---------------------------------------------------------------- words

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9$ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ROMAN_TO: Record<string, string> = {
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

/** Every way the game's name is typed, normalised, longest first (pure): "grand theft auto vi", "gta 6", "gta6"... */
export function nameForms(game: string): string[] {
  const out = new Set<string>();
  for (const a of [...searchSeeds(game), ...gameAliases(game).map(norm)]) {
    const n = norm(a);
    if (!n) continue;
    out.add(n);
    const words = n.split(" ");
    const last = words.at(-1) ?? "";
    // The numeral both ways, and run together ("gta6", "gtavi").
    const swapped =
      ROMAN_TO[last] ??
      Object.entries(ROMAN_TO).find(([, d]) => d === last)?.[0];
    if (swapped) out.add([...words.slice(0, -1), swapped].join(" "));
    for (const f of [...out])
      if (/ \w+$/.test(f) && f.split(" ").length === 2)
        out.add(f.replace(" ", ""));
  }
  return [...out]
    .filter((f) => f.length >= 3)
    .sort((a, b) => b.length - a.length);
}

/** The query with the game's name as "{g}", or undefined when the game is not in it (pure). */
export function withPlaceholder(
  query: string,
  forms: string[],
): string | undefined {
  const q = ` ${norm(query)} `;
  for (const f of forms) {
    const i = q.indexOf(` ${f} `);
    if (i >= 0)
      return `${q.slice(0, i)} {g} ${q.slice(i + f.length + 2)}`
        .replace(/\s+/g, " ")
        .trim();
  }
  return undefined;
}

// Phrasings that mean the same thing, applied before the key is made ("come out" and "release date" are one ask).
const SYNONYMS: Array<[RegExp, string]> = [
  [
    /\b(how long (till|until|before|left)|how many days (till|until|left)|days (till|until|left))\b/g,
    "release",
  ],
  [
    /\b(release date|release day|come out|comes out|coming out|out yet|launch date|launch day|release|launch|is out|be out|drop|drops|dropping)\b/g,
    "release",
  ],
  [/\b(pre ?load|preload|pre loading|preloading)\b/g, "preload"],
  [/\b(pre ?order|preorder|pre ordering|preordering)\b/g, "preorder"],
  [
    /\b(file size|download size|install size|storage|how many gb|how much gb|how much space|gb)\b/g,
    "size gb",
  ],
  [
    /\b(how much (did it|did|does it|will it)? ?(cost )?to make|cost to make|budget|development cost)\b/g,
    "budget",
  ],
  [
    /\b(how much (did|has|will) (it|they|gta 6|{g}) (make|made|earn|earned|sell|sold)|copies sold|sales|sold)\b/g,
    "sales",
  ],
  [/\b(how much money)\b/g, "money"],
  [/\bhow much (fps|frames)\b/g, "fps"],
  [/\b(how much|price|prices|cost|costs|expensive|cheap)\b/g, "price"],
  [/\b(worth it|worth buying|worth the money|worth)\b/g, "worth"],
  [/\b(cross platform|crossplatform|cross play|crossplay)\b/g, "crossplay"],
  [/\b(how long to beat|how long is|length|hours long)\b/g, "length"],
  [/\b(frame rate|framerate|fps)\b/g, "fps"],
  [/\b(physical copy|physical|disc|disk)\b/g, "disc"],
  [/\b(trailers)\b/g, "trailer"],
  [/\b(characters|protagonists)\b/g, "character"],
];
const STOP = new Set(
  "the a an in on of to for is it its does do did will would can could you your i my be are was were and or with at by from there this that what when where why how who which about get gonna going really actually new game till until play playing not no so 2025 2026 2027 {g}".split(
    " ",
  ),
);

/** The cluster key (pure): the content words, phrasings merged, sorted; empty for a question with nothing in it ("can you {g}"). */
export function queryKey(placeheld: string): string {
  let t = ` ${placeheld} `;
  for (const [re, to] of SYNONYMS) t = t.replace(re, to);
  const words = t.split(" ").filter(Boolean);
  const content = [
    ...new Set(
      words
        .filter((w) => !STOP.has(w))
        .map((w) =>
          w.length > 3 && w.endsWith("s") && !w.endsWith("ss")
            ? w.slice(0, -1)
            : w,
        ),
    ),
  ];
  return content.sort().join(" ");
}

// ---------------------------------------------------------------- what the query is about

export interface Intent {
  id: string;
  match: RegExp;
  /** The fact lines that answer it. */
  facts?: RegExp;
  /** Answerable from the owner's own play once the game is out. */
  play?: boolean;
  /** About the launch itself: worth most in the days just before it. */
  launch?: boolean;
}

/** What people ask about a game, specific first (the first that matches wins). */
export const INTENTS: Intent[] = [
  {
    id: "size",
    match: /\b(preload|gb|how big is the (file|download)|space|install)\b/,
    facts: /pre-load|\bGB\b/i,
    launch: true,
  },
  {
    id: "unlock time",
    match:
      /\b(release time|what time|unlock|midnight|time zone|timezone|new zealand|early access|countdown)\b/,
    facts: /unlock|New Zealand/i,
    launch: true,
  },
  // Why a date moved, or what it cost to make: the press answers that, not a confirmed line.
  {
    id: "why delayed",
    match: /\bwhy\b.*\b(delay|delayed|delays|taking so long)\b/,
  },
  { id: "budget", match: /\b(budget)\b/ },
  { id: "sales", match: /\b(sales)\b/ },
  { id: "downgrade", match: /\b(downgrade|downgraded|nerfed|cut content)\b/ },
  {
    id: "preorder",
    match: /\b(preorder|bonus|vintage vice city)\b/,
    facts: /pre-order/i,
    launch: true,
  },
  {
    id: "editions",
    match: /\b(edition|editions|ultimate|standard|deluxe|collectors?)\b/,
    facts: /Ultimate|Standard/i,
  },
  {
    id: "crossplay",
    match: /\b(crossplay|online|multiplayer|co op|coop|servers?)\b/,
    play: true,
  },
  {
    id: "worth",
    match: /\b(worth|good|review|reviews|rating|metacritic|score|bad|fun)\b/,
  },
  {
    id: "price",
    match: /\b(price|\$|cheap|expensive|dollars?|pounds?|free)\b/,
    facts: /Price|\$\d/i,
  },
  {
    id: "disc",
    match: /\b(disc|boxed|box|cartridge|retail|retailers?|digital)\b/,
    facts: /disc|download code/i,
  },
  {
    id: "pc",
    match: /\b(pc|steam|computer|laptop|epic games)\b/,
    facts: /\bPC\b/,
  },
  {
    id: "platforms",
    match:
      /\b(ps4|xbox one|switch|series s|series x|xbox|ps5 pro|ps5|platforms?|consoles?|playstation)\b/,
    facts: /PS5|Xbox/i,
  },
  {
    id: "performance",
    match:
      /\b(fps|60|30|resolution|4k|pro enhanced|performance|graphics|ray tracing)\b/,
    facts: /PS5 Pro|frame rate/i,
  },
  {
    id: "release",
    match: /\b(release|delay|delayed|when|date|out now|today|tomorrow)\b/,
    facts: /Release/i,
    launch: true,
  },
  {
    id: "map",
    match: /\b(map|size|square|miles|km|bigger|biggest|how big)\b/,
    facts: /\bmap\b/i,
  },
  {
    id: "music",
    match: /\b(radio|songs?|soundtrack|music|album|stations?|artists?)\b/,
    facts: /radio|album|song/i,
  },
  {
    id: "trailer",
    match: /\b(trailer|extended look)\b/,
    facts: /trailer|Extended Look/i,
  },
  {
    id: "wildlife",
    match: /\b(animals?|wildlife|alligators?|gators?|sharks?|dogs?|pets?)\b/,
    facts: /animal/i,
  },
  {
    id: "weather",
    match: /\b(hurricanes?|storms?|weather|rain)\b/,
    facts: /hurricane|storm/i,
  },
  {
    id: "story",
    match: /\b(jason|lucia|character|story|cast|voice actors?|main)\b/,
    play: true,
  },
  { id: "length", match: /\b(length|missions?|hours)\b/, play: true },
  {
    id: "setting",
    match: /\b(set|setting|vice city|leonida|florida|location|city)\b/,
  },
  {
    id: "how to",
    match:
      /\b(how to|how do|can you|can i|where|best|tips|guide|money|cars?|weapons?|guns?|houses?|propert(y|ies)|swim|fly|planes?|police|cops?|wanted|boats?|bikes?|customi[sz]e|save|first person|controls?|phone)\b/,
    play: true,
  },
];

export function intentOf(placeheld: string, key: string): Intent | undefined {
  const text = `${placeheld} ${key}`;
  return INTENTS.find((i) => i.match.test(text));
}

// Never courted: leaks, cheats, piracy and worse (as src/searchterms.ts), and story spoilers.
const NEVER =
  /\b(leak|leaks|leaked|datamine|datamined|crack|cracked|torrent|free download|download free|apk|mod menu|cheat|cheats|hack|hacks|nude|nudes|sex|rom|roms|emulator|xxx|unblocked)\b/;
const SPOILER_WORDS =
  /\b(ending|endings|dies|die|death|killed|twist|final mission|last mission|post credits|epilogue|spoilers?)\b/;

/** Why a query is never made into a Short, or undefined (pure). */
export function refusal(query: string): string | undefined {
  const q = norm(query);
  if (NEVER.test(q)) return "leaks, cheats or piracy are never courted";
  if (SPOILER_WORDS.test(q) || SPOILER_PHRASES.some(([re]) => re.test(q)))
    return "a story spoiler";
  return undefined;
}

// ---------------------------------------------------------------- answerable

const contentWords = (s: string) =>
  norm(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * How a query can be answered (pure): from the confirmed facts that match its intent, from the owner's play notes
 * once the game is out, or not at all. Rumour lines count only with their label and score lower.
 */
export function answerability(
  intent: Intent | undefined,
  key: string,
  facts: Fact[],
  notes: PlayNote[],
  released: boolean,
): {
  kind: AnswerKind;
  answerable: number;
  facts: Fact[];
  playNotes: PlayNote[];
  rumour: boolean;
} {
  const none = {
    facts: [] as Fact[],
    playNotes: [] as PlayNote[],
    rumour: false,
  };
  const words = key.split(" ").filter((w) => w.length > 2 && w !== "{g}");
  // The owner's own play answers anything it touches once the game is out.
  const played = released
    ? notes.filter((n) =>
        words.some((w) => contentWords(n.text).some((c) => c.startsWith(w))),
      )
    : [];
  if (intent?.facts) {
    const hit = facts.filter((f) => intent.facts!.test(f.text));
    const confirmed = hit.filter((f) => !f.rumour);
    if (confirmed.length)
      return {
        kind: "facts",
        answerable: 1,
        facts: confirmed.slice(0, 4),
        playNotes: played.slice(0, 4),
        rumour: false,
      };
    if (hit.length)
      return {
        kind: "facts",
        answerable: 0.6,
        facts: hit.slice(0, 3),
        playNotes: played.slice(0, 4),
        rumour: true,
      };
  }
  if (played.length)
    return {
      kind: "play",
      answerable: 0.9,
      ...none,
      playNotes: played.slice(0, 6),
    };
  if (intent?.play)
    return { kind: "play", answerable: released ? 0.4 : 0, ...none };
  if (intent) return { kind: "press", answerable: 0.3, ...none };
  return { kind: "none", answerable: 0.1, ...none };
}

// ---------------------------------------------------------------- titles

const UPPER = new Set([
  "gta",
  "ps5",
  "ps4",
  "pc",
  "gb",
  "fps",
  "dlc",
  "npc",
  "npcs",
  "mw4",
  "mw3",
  "bf6",
  "ai",
  "nz",
  "us",
  "uk",
  "rpg",
  "4k",
  "tv",
  "gta6",
  "vi",
  "ii",
  "iii",
  "iv",
  "z",
  "a",
]);
const SMALL = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "of",
  "in",
  "on",
  "to",
  "for",
  "vs",
  "at",
  "by",
  "is",
  "it",
]);
const QUESTION =
  /^(is|does|do|can|how|where|when|what|why|will|who|are|which|should|did|was|has)\b/;

/** The game's name as people type it in a title (pure): "GTA 6", "Battlefield 6", "Silksong". */
export function displayName(game: string): string {
  const short =
    searchSeeds(game).sort((a, b) => a.length - b.length)[0] ?? norm(game);
  return casedWords(short, true);
}

function casedWords(text: string, keepSmall = false): string {
  return text
    .split(" ")
    .filter(Boolean)
    .map((w, i) => {
      if (UPPER.has(w) && w !== "a" && w !== "z") return w.toUpperCase();
      if (w === "z" || (w === "a" && i > 0 && !keepSmall))
        return w === "z" ? "Z" : "a";
      if (i > 0 && SMALL.has(w))
        return w === "is" || w === "it" ? w[0]!.toUpperCase() + w.slice(1) : w;
      if (/^\$/.test(w)) return w;
      return w[0]!.toUpperCase() + w.slice(1);
    })
    .join(" ");
}

/** The title in the searcher's own words (pure): the query title-cased, the game named the way people type it. */
export function searchTitle(query: string, game: string): string {
  const forms = nameForms(game);
  const held = withPlaceholder(query, forms) ?? norm(query);
  const words = held.split(" ");
  const name = displayName(game);
  const body = casedWords(
    words.map((w) => (w === "{g}" ? "{g}" : w)).join(" "),
  ).replace(/\{G\}/g, "{g}");
  let title = body
    .replace("{g}", name)
    .replace(/\bPre (Order|Load)/g, "Pre-$1");
  if (!/^[A-Z]/.test(title)) title = title[0]!.toUpperCase() + title.slice(1);
  if (QUESTION.test(held) && !title.endsWith("?")) title += "?";
  return title;
}

/** The content words of a query, its game's name set aside (pure). */
export function queryWords(query: string, game: string): string[] {
  const held = withPlaceholder(query, nameForms(game)) ?? norm(query);
  return held.split(" ").filter((w) => w && w !== "{g}" && !STOP.has(w));
}

const PROMISE_WORDS = /\b(every|ultimate|complete)\b/i;

/**
 * What breaks a search Short's title (pure): it must carry every content word of the query and name the game, and
 * it answers to the house rules (under 60 characters, no "Game: fact" colon, no exclamation marks, no shouting, no
 * "every", "ultimate" or "complete" the query itself did not ask about).
 */
export function searchTitleProblems(
  title: string,
  query: string,
  game: string,
): string[] {
  const out = [...seoTitleProblems(title)];
  const t = ` ${norm(title)} `;
  const missing = queryWords(query, game).filter(
    (w) => !t.includes(` ${w} `) && !t.includes(` ${w}s `),
  );
  if (missing.length)
    out.push(
      `The title must use the searcher's own words ("${query}"); it leaves out: ${missing.join(", ")}.`,
    );
  if (!withPlaceholder(title, nameForms(game)))
    out.push(
      `The title must name the game the way people search it (${displayName(game)}).`,
    );
  if (/^[^:?]{2,30}:\s/.test(title))
    out.push('No "Game: fact" colon template in the title.');
  if (/!/.test(title)) out.push("No exclamation marks in the title.");
  const promise = title.match(PROMISE_WORDS)?.[0];
  if (promise && !new RegExp(`\\b${promise}\\b`, "i").test(query))
    out.push(`"${promise}" promises more than one Short covers; leave it out.`);
  return out;
}

// ---------------------------------------------------------------- covered

/** The Pulse video that already answers a query, or undefined (pure): all its content words in one title of that game. */
export function coveredBy(
  query: string,
  game: string,
  covered: string[],
): string | undefined {
  const words = queryWords(query, game).map((w) => w.replace(/s$/, ""));
  if (!words.length) return undefined;
  const forms = nameForms(game);
  const keyOf = (s: string) => {
    const held = withPlaceholder(s, forms);
    return held ? queryKey(held).split(" ").filter(Boolean) : undefined;
  };
  const mine = keyOf(query) ?? [];
  for (const c of covered) {
    const theirs = keyOf(c);
    if (!theirs) continue;
    const words2 = new Set(
      norm(c)
        .split(" ")
        .map((w) => w.replace(/s$/, "")),
    );
    if (words.every((w) => words2.has(w))) return c;
    if (mine.length && mine.every((w) => theirs.includes(w))) return c;
  }
  return undefined;
}

// ---------------------------------------------------------------- scoring

export interface History {
  /** Per game, the harvests so far. */
  harvests: Record<string, number>;
  /** Per game, when its first harvest ran: anything seen then is the baseline, not news. */
  started?: Record<string, string>;
  /** Per "game|key", when it was first and last seen. */
  seen: Record<string, { first: string; last: string }>;
}

export interface RankContext {
  now: Date;
  facts: Record<string, Fact[]>;
  notes: Record<string, PlayNote[]>;
  /** Release instants by game (ISO); missing or past: out. */
  releases: Record<string, string>;
  covered: string[];
  history?: History;
}

const DAY = 86_400_000;

/** Demand from the lists (pure): the best place, plus a little for every other site and seed that gave it. */
export function demandOf(obs: Observation[]): number {
  if (!obs.length) return 0;
  const best = Math.max(...obs.map((o) => (10 - Math.min(9, o.rank)) / 10));
  const sites = new Set(obs.map((o) => o.source)).size;
  const seeds = new Set(obs.map((o) => o.seed)).size;
  return Math.min(1, best + 0.15 * (sites - 1) + 0.05 * Math.min(4, seeds - 1));
}

/**
 * Freshness (pure): a query first seen after the game's first harvest is new (1 for two days, then fading); one in
 * the baseline, or with no history, is neutral (0.5). About a launch in the next ten days: more.
 */
export function freshnessOf(
  first: string | undefined,
  started: string | undefined,
  now: Date,
  launchSoon: boolean,
): number {
  let f: number;
  if (
    !first ||
    !started ||
    Date.parse(first) <= Date.parse(started) + 3_600_000
  )
    f = 0.5;
  else {
    const age = (now.getTime() - Date.parse(first)) / DAY;
    f = age <= 2 ? 1 : 0.2 + 0.6 * Math.exp(-age / 7);
  }
  return Math.min(1, f + (launchSoon ? 0.3 : 0));
}

/** All harvested suggestions as scored clusters, best first (pure). */
export function rankQueries(
  observations: Observation[],
  ctx: RankContext,
): QueryCluster[] {
  const groups = new Map<
    string,
    { game: string; held: Map<string, Observation[]> }
  >();
  for (const o of observations) {
    const held = withPlaceholder(o.query, nameForms(o.game));
    // Not about this game, the bare name, or a stem the autocomplete echoed back ("can you minecraft"): nothing asked.
    if (!held || !queryKey(held)) continue;
    const k = `${o.game}|${queryKey(held)}`;
    const g = groups.get(k) ?? { game: o.game, held: new Map() };
    const q = norm(o.query);
    g.held.set(q, [...(g.held.get(q) ?? []), o]);
    groups.set(k, g);
  }
  const out: QueryCluster[] = [];
  for (const [k, g] of groups) {
    const key = k.slice(g.game.length + 1);
    const all = [...g.held.values()].flat();
    // The wording people reach for most: the best placed, then the most seen, then the shortest.
    const variants = [...g.held.entries()]
      .map(([q, obs]) => ({ q, d: demandOf(obs), n: obs.length }))
      .sort((a, b) => b.d - a.d || b.n - a.n || a.q.length - b.q.length);
    const query = variants[0]!.q;
    const held = withPlaceholder(query, nameForms(g.game))!;
    const intent = intentOf(held, key);
    const rel = ctx.releases[g.game];
    const released = !rel || Date.parse(rel) <= ctx.now.getTime();
    const ans = answerability(
      intent,
      key,
      ctx.facts[g.game] ?? [],
      ctx.notes[g.game] ?? [],
      released,
    );
    const seen = ctx.history?.seen[k];
    const launchSoon =
      !!intent?.launch &&
      !!rel &&
      Date.parse(rel) - ctx.now.getTime() < 10 * DAY &&
      Date.parse(rel) > ctx.now.getTime() - DAY;
    const fresh = freshnessOf(
      seen?.first,
      ctx.history?.started?.[g.game],
      ctx.now,
      launchSoon,
    );
    const demand = demandOf(all);
    const score = Math.round(
      100 * (0.45 * demand + 0.2 * fresh + 0.35 * ans.answerable),
    );
    const title = searchTitle(query, g.game);
    const covered = coveredBy(query, g.game, ctx.covered);
    const refused = refusal(query);
    const dropped =
      refused ??
      (covered
        ? "already covered by Pulse"
        : (ans.kind === "facts" && ans.facts.length) ||
            (ans.kind === "play" && ans.playNotes.length)
          ? undefined
          : ans.kind === "play" && !released
            ? "needs the owner's play (after launch)"
            : "no confirmed source answers it");
    out.push({
      key,
      game: g.game,
      query,
      variants: variants.map((v) => v.q),
      sources: [...new Set(all.map((o) => o.source))],
      seeds: new Set(all.map((o) => o.seed)).size,
      bestRank: Math.min(...all.map((o) => o.rank)),
      hits: all.length,
      intent: intent?.id ?? "other",
      ...ans,
      firstSeen: seen?.first ?? all.map((o) => o.at).sort()[0]!,
      lastSeen: all
        .map((o) => o.at)
        .sort()
        .at(-1)!,
      demand: Math.round(demand * 100) / 100,
      fresh: Math.round(fresh * 100) / 100,
      score,
      title,
      titleProblems: searchTitleProblems(title, query, g.game),
      ...(dropped ? { dropped } : {}),
      ...(covered ? { covered } : {}),
    });
  }
  return out.sort(
    (a, b) =>
      Number(!!a.dropped) - Number(!!b.dropped) ||
      b.score - a.score ||
      b.demand - a.demand ||
      b.hits - a.hits ||
      a.query.length - b.query.length,
  );
}

/** The history after a harvest (pure): every key's first and last sighting, and one more harvest per game. */
export function updateHistory(
  h: History | undefined,
  clusters: QueryCluster[],
  games: string[],
  now: Date,
): History {
  const next: History = {
    harvests: { ...(h?.harvests ?? {}) },
    started: { ...(h?.started ?? {}) },
    seen: { ...(h?.seen ?? {}) },
  };
  for (const c of clusters) {
    const k = `${c.game}|${c.key}`;
    next.seen[k] = {
      first: next.seen[k]?.first ?? c.firstSeen,
      last: now.toISOString(),
    };
  }
  for (const g of games) {
    next.harvests[g] = (next.harvests[g] ?? 0) + 1;
    next.started![g] ??= now.toISOString();
  }
  return next;
}

/** The queries fit to make (pure): answerable from confirmed lines or play notes, not covered, not refused, over the bar. */
export function makeable(
  clusters: QueryCluster[],
  minScore: number,
  made: string[] = [],
  /** "game|intent" of the search Shorts of the last few days: two Shorts on one ask in a row read as a repeat. */
  recentIntents: string[] = [],
): QueryCluster[] {
  const done = new Set(made);
  const recent = new Set(recentIntents);
  return clusters.filter(
    (c) =>
      !c.dropped &&
      c.score >= minScore &&
      !c.titleProblems.length &&
      !done.has(searchSlug(c.game, c.key)) &&
      !recent.has(`${c.game}|${c.intent}`),
  );
}

/** The best `n` with no two on the same ask of the same game (pure): what one harvest can fill. */
export function distinctAsks(
  clusters: QueryCluster[],
  n: number,
): QueryCluster[] {
  const out: QueryCluster[] = [];
  const seen = new Set<string>();
  for (const c of clusters) {
    const k = `${c.game}|${c.intent}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

/** The episode key of a query: "search:<game>-<key>". */
export function searchSlug(game: string, key: string): string {
  return `${norm(searchSeeds(game).sort((a, b) => a.length - b.length)[0] ?? game)} ${key}`
    .replace(/[{}$]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}
