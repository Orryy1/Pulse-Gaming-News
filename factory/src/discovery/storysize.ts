// How big is this story? (owner, 4 Nov 2026: "all day on Twitter the Ocarina remake is the highest rated game of the
// year, and it was nowhere on Pulse".) The feeds saw it: 13 articles under one hash, more under a dozen others, each
// scored alone and none of them enough. The cluster score answers "is this a good Short for right now" and decays by
// the hour. This answers a different question, in code and for nothing: how much is the games press talking about
// this, however the articles were split? It pools every article the sightings hold, drops deals and guides, groups
// what is left by game and by kind of news, and scores each group on independent outlets, first-party sources, the
// franchise, the speed of coverage, its persistence across days and what kind of news it is.

import type { FeedItem } from "./rss.ts";
import type { StoryCluster } from "./cluster.ts";
import { canonicalUrl, similarity, tokens } from "./cluster.ts";

export type StoryEvent =
  | "acclaim"
  | "delay"
  | "business"
  | "commercial"
  | "reveal"
  | "release"
  | "price"
  | "collab"
  | "update"
  | "other";

/** A row of cluster_sightings, as far as sizing needs it. */
export interface SizedSighting {
  hash: string;
  max_score?: number;
  cluster_json: Pick<StoryCluster, "items">;
}

export interface SizedStory {
  /** Stable identity: the game and the kind of news. */
  key: string;
  entity: string;
  /** The game or franchise as a person would say it. */
  name: string;
  event: StoryEvent;
  size: number;
  /** How the size was reached, for logs and reports. */
  why: string;
  headline: string;
  outlets: string[];
  articles: number;
  official: boolean;
  rumour: boolean;
  leak: boolean;
  unsafe: boolean;
  firstAt: string;
  newestAt: string;
  /** Newest first, every article of the story. */
  items: FeedItem[];
  /** Every sighting holding one of the articles: all of them count as covered once the story is made. */
  hashes: string[];
}

// [key, name, pattern, tier]. Tier 1 is what the whole hobby talks about; tier 3 still has its own audience.
const FRANCHISES: ReadonlyArray<readonly [string, string, RegExp, 1 | 2 | 3]> =
  [
    ["gta", "GTA", /\bgta\b|grand theft auto|\brockstar\b/i, 1],
    ["zelda", "Zelda", /\bzelda\b|ocarina of time|tears of the kingdom/i, 1],
    ["mario", "Mario", /\bmario\b/i, 1],
    ["pokemon", "Pokemon", /pok[eé]mon|pokopia/i, 1],
    ["god-of-war", "God of War", /god of war|\blaufey\b/i, 1],
    [
      "elder-scrolls",
      "The Elder Scrolls",
      /elder scrolls|\bskyrim\b|\boblivion\b/i,
      1,
    ],
    [
      "call-of-duty",
      "Call of Duty",
      /call of duty|\bmw4\b|\bwarzone\b|\bcod\b/i,
      1,
    ],
    ["minecraft", "Minecraft", /minecraft/i, 1],
    ["fortnite", "Fortnite", /fortnite/i, 1],
    [
      "elden-ring",
      "Elden Ring",
      /elden ring|\bduskbloods\b|fromsoftware|dark souls/i,
      1,
    ],
    ["red-dead", "Red Dead", /red dead/i, 1],
    ["last-of-us", "The Last of Us", /the last of us|naughty dog/i, 1],
    ["half-life", "Half-Life", /half-life/i, 1],
    ["fallout", "Fallout", /\bfallout\b/i, 2],
    ["witcher", "The Witcher", /witcher|cd projekt/i, 2],
    ["cyberpunk", "Cyberpunk", /cyberpunk/i, 2],
    ["resident-evil", "Resident Evil", /resident evil/i, 2],
    ["final-fantasy", "Final Fantasy", /final fantasy|\bffxiv\b/i, 2],
    ["assassins-creed", "Assassin's Creed", /assassin'?s creed/i, 2],
    ["halo", "Halo", /\bhalo\b/i, 2],
    ["gears", "Gears of War", /gears of war/i, 2],
    ["spider-man", "Spider-Man", /spider-man|wolverine|insomniac/i, 2],
    ["battlefield", "Battlefield", /battlefield|battlefront/i, 2],
    ["mass-effect", "Mass Effect", /mass effect|\bbioware\b/i, 2],
    ["silksong", "Hollow Knight", /hollow knight|silksong/i, 2],
    ["monster-hunter", "Monster Hunter", /monster hunter/i, 2],
    ["street-fighter", "Street Fighter", /street fighter/i, 2],
    ["metal-gear", "Metal Gear", /metal gear/i, 2],
    ["silent-hill", "Silent Hill", /silent hill/i, 2],
    ["ghost", "Ghost of Yotei", /ghost of (tsushima|y[oō]tei)/i, 2],
    ["horizon", "Horizon", /\bhorizon (zero|forbidden|steel)/i, 2],
    ["starfield", "Starfield", /starfield/i, 2],
    ["doom", "Doom", /\bdoom\b/i, 2],
    ["steam-hw", "Steam hardware", /steam (machine|deck|frame|controller)/i, 2],
    ["baldurs-gate", "Baldur's Gate", /baldur'?s gate/i, 2],
    ["diablo", "Diablo", /\bdiablo\b/i, 2],
    ["warcraft", "World of Warcraft", /warcraft|\bwow\b/i, 2],
    ["roblox", "Roblox", /roblox/i, 2],
    ["phantom-blade", "Phantom Blade Zero", /phantom blade/i, 2],
    ["persona", "Persona", /\bpersona\b/i, 2],
    ["kingdom-hearts", "Kingdom Hearts", /kingdom hearts/i, 2],
    ["destiny", "Destiny", /\bdestiny\b|\bbungie\b/i, 3],
    ["overwatch", "Overwatch", /overwatch/i, 3],
    ["valorant", "Valorant", /valorant/i, 3],
    ["helldivers", "Helldivers", /helldivers/i, 3],
    ["pubg", "PUBG", /\bpubg\b/i, 3],
    ["arc-raiders", "Arc Raiders", /arc raiders/i, 3],
    ["counter-strike", "Counter-Strike", /counter-strike|\bcs2\b/i, 3],
    ["dragons-dogma", "Dragon's Dogma", /dragon'?s dogma/i, 3],
    ["palworld", "Palworld", /palworld/i, 3],
    ["dune", "Dune Awakening", /dune:? (awakening|blood)/i, 3],
    ["forza", "Forza", /\bforza\b/i, 3],
    ["borderlands", "Borderlands", /borderlands/i, 3],
    ["hades", "Hades", /\bhades\b/i, 3],
  ];

const TIER_POINTS = { 1: 24, 2: 16, 3: 8 } as const;

// The commonest words of 2,240 real headlines (17 Oct to 4 Nov 2026), names of games and studios taken out, plus names
// that belong to several games. A word here never ties two articles together on its own.
const GENERIC = new Set(
  `game games 2026 2027 xbox november switch officially ps5 update release time all out blade world says free nintendo but steam zero ai phantom star october launches up best remake years next coming pc patch about one review gets final call series studio launch sale day codes first early modern warfare play get december fantasy live can players so back no here dlc devs available date horror adds playstation director year dead wars not official some fans 000 war off announced could big today getting season revealed week full million like legend before finally edition black dev reveals ea delayed most pass halloween down access still reportedly pre plus trailer made co effect makes team story ever grand gameplay hints latest set notes south us feature support friday gaming rpg fixes two development brings hit month auto open copies released event marvel need last theft indie footage developer confirms expansion confirmed every dark action online video there guide them won ps would sony movie former anniversary brand remastered make original content publisher studios sim report list download long creed issues if days franchise look vi three console company don life being sold he top inspired store following may surprise biggest far times away mode changes map legends want returns complete features do drops maintenance way version survival major re making physical know reveal soon microsoft name these had epic my boss key future lead despite classic announces upcoming planet go project music real shop until pirate explains february ahead dragon man arrives mobile dungeon working treasure space because community de exclusive huge massive use alien return adventure god claims promo save too monster take revenue football showcase place digital end rewards looks never played system already deals fps sales mods secret fan another almost controller explained when preview stop hunters queen funding buy notice releases midnight includes red reviews answer answers second playable updates other ceo producer demo where find selling characters playing night start which manager might power hours class offers going ps4 style does square job domain academy returning taking cards again based among only data character seemingly remakes yet teases blood player bundle fate adding stream improvements leaked months role unknown very good even bringing problem lost special things using ve mmo added say backlash record beat battle terrible show retro people users actor size server much since silver magic chronicles legendary escape nov point mod control discounts begins titan spooky active countdown nearly hardware keep probably ram card servers test details fire division fun union vote google billion through announcement developers right stellar code me korean doesn any comes perfect order episode netflix great lets popular scariest fully turn quest composer high later consoles tech something watch sequel souls pro anime published fighting thanks godzilla orders sky gamers according success state everything win combat gate galaxy sets plans enhanced portal deck monthly include tv charting mini completely multiple wild tips entire should shares multiplayer engine news chapter walkthrough crush faces head gen while less limited transparent short price north wants continue claim age setting own builds max gathering medieval creative bad ultra hat split clones easter ban buying business attack positive cozy build upgrade locations tier closing continues roadmap collab gives statement public founder pack account rivals hunt stage uk impossible different inside shut claimed ll coo decade soundtrack isn valley families remove solutions january apple amid breaks asia actually updated behind four spent fix come light expectations during redeem japan sparks workers layoffs side heroes total results voice city expect ready bit hard thinks score bill art film cut under step poll chance work simulator shooter against teaser bring share leaks echoes gone fi shows egg racing preload global rules monsters rebirth school fight funded french accuses saying sabotaging profitable metacritic goty ubisoft valve bethesda blizzard capcom activision nvidia gog anthropic sega konami bandai namco`.split(
    " ",
  ),
);

// Never a story: the article is about something to buy, a how-to or a piece of site furniture.
const JUNK =
  /\bdeals?\b|black friday|cyber monday|% off|\bdiscount|last chance to save|\bsave \$|save \d+%|\bon sale\b|\bgift guide\b|\bbest .* to buy\b|\bgames? to buy\b|\bsale\b|\bguide\b|how to\b|walkthrough|where to find|\bcodes\b|\bwordle\b|\bcrossword\b|\bquiz\b|\bpodcast\b|^feature:|^countdown:|\bdungeon crawl #|\btier list\b|\bnyt\b/i;

const EVENTS: ReadonlyArray<readonly [StoryEvent, RegExp]> = [
  [
    "acclaim",
    /metacritic|opencritic|\breviews?\b|highest[- ]rated|best[- ]reviewed|top[- ]rated|perfect score|10\/10|masterpiece|game of the year|\bgoty\b|\bcritics?\b|acclaim|first impressions|all[- ]time/i,
  ],
  ["delay", /\bdelay|postpone|pushed back|\bslips?\b|\bslipped\b/i],
  [
    "business",
    /\bacquir|acquisition|\bbids?\b|layoff|laid off|\bclos(e|es|ing|ure)\b|shut(s|ting)? (down|the)|\bunion\b|lawsuit|\bsues?\b|sabotag|merger|\bsold to\b|\bceo\b/i,
  ],
  [
    "commercial",
    /\bmillion\b|\bsold\b|\bsales\b|\brecords?\b|\bpeaks?\b|concurrent|best[- ]selling|fastest[- ]selling|biggest launch/i,
  ],
  [
    "reveal",
    /\breveal|\bannounc|\btrailer|first look|\bteaser|\bshowcase|\bdirect\b|\bhas a name\b|\bofficial (name|title)\b|\bname\b|\bsubtitled\b/i,
  ],
  [
    "release",
    /release (date|time)|\blaunch|out now|pre-?load|pre-?download|available now|early access/i,
  ],
  ["price", /\bprice|\$\d|\bcosts?\b/i],
  ["collab", /\bcollab|crossover/i],
  ["update", /\bpatch|\bupdate|hotfix|\bseason\b|\bdlc\b/i],
];

const EVENT_POINTS: Record<StoryEvent, number> = {
  acclaim: 14,
  delay: 14,
  business: 10,
  commercial: 12,
  reveal: 8,
  release: 6,
  price: 6,
  collab: -14,
  update: -6,
  other: -8,
};

/** Points by independent outlets: the first few say the most. */
const OUTLET_POINTS = [0, 6, 16, 26, 34, 40, 45, 49, 52, 55, 58];

const RUMOUR =
  /\b(rumou?rs?|reportedly|allegedly|insiders?|unconfirmed|sources say)\b/i;
const LEAK = /\b(leak|leaks|leaked|datamin\w*)\b/i;
const UNSAFE = /suicide|murder|shooting|sexual|assault|\bdied\b|\bdies\b|death of/i;

/** First-party feeds. "Steam News" is not one: its group pages reprint the press, its app pages are patch notes. */
const NOT_A_SOURCE = new Set(["Steam News"]);
/** One publisher's sister sites cross-post: they count as one outlet. */
const OUTLET_GROUP: Record<string, string> = {
  "Push Square": "Hookshot",
  "Nintendo Life": "Hookshot",
  "Pure Xbox": "Hookshot",
};

/** The kind of news a headline carries (pure). */
export function storyEvent(title: string): StoryEvent {
  return EVENTS.find(([, re]) => re.test(title))?.[0] ?? "other";
}

/** Is this article a deals post, a guide or site furniture? */
export function isJunkTitle(title: string): boolean {
  return JUNK.test(title);
}

/** The known franchise a headline is about: the one named first in it. */
export function knownEntity(
  title: string,
): { key: string; name: string; tier: 1 | 2 | 3 } | undefined {
  let best: { key: string; name: string; tier: 1 | 2 | 3 } | undefined;
  let at = Infinity;
  for (const [key, name, re, tier] of FRANCHISES) {
    const m = re.exec(title);
    if (m && m.index < at) {
      at = m.index;
      best = { key, name, tier };
    }
  }
  return best;
}

function anchors(title: string): string[] {
  return [...tokens(title)].filter((t) => !GENERIC.has(t) && !/^\d+$/.test(t));
}

/** The headline's own words, with the game's name and the common words of the trade taken out. */
function ownWords(title: string): string[] {
  let t = title;
  for (const [, , re] of FRANCHISES) t = t.replace(new RegExp(re.source, "gi"), " ");
  return anchors(t);
}

/** Do two headlines about one game tell the same news? Sharing the game's name is not enough. */
export function similarTitles(a: string, b: string): boolean {
  const x = ownWords(a);
  const y = ownWords(b);
  if (x.filter((t) => y.includes(t)).length >= 2) return true;
  return similarity(tokens(a), tokens(b)) >= 0.75;
}

function unionFind(n: number) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!;
      i = parent[i]!;
    }
    return i;
  };
  return {
    find,
    union: (a: number, b: number) => {
      parent[find(a)] = find(b);
    },
  };
}

/** Most articles in any six hours: how fast the press piled in. */
function peakPerSixHours(times: number[]): number {
  const t = [...times].sort((a, b) => a - b);
  let best = 0;
  let from = 0;
  for (let i = 0; i < t.length; i++) {
    while (t[i]! - t[from]! > 6 * 3_600_000) from++;
    best = Math.max(best, i - from + 1);
  }
  return best;
}

/** The headline closest to all the others, a first-party one if there is one. */
function centralHeadline(items: FeedItem[]): string {
  const pool = items.filter(
    (i) => i.sourceKind === "official" && !NOT_A_SOURCE.has(i.source),
  );
  const from = pool.length
    ? pool
    : items.filter((i) => !NOT_A_SOURCE.has(i.source));
  const sets = from.map((i) => tokens(i.title));
  let best = 0;
  let bestScore = -Infinity;
  sets.forEach((s, i) => {
    let score = 0;
    for (const o of sets) for (const t of s) if (o.has(t)) score++;
    // Long headlines share more words by being long; a question or a video post is a poor name for a story.
    score =
      score / Math.max(s.size, 6) -
      (/^(video|round up|feature)\b|\?$/i.test(from[i]!.title) ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  });
  return from[best]?.title ?? items[0]!.title;
}

function tokensKey(title: string): string {
  return [...tokens(title)].sort().slice(0, 4).join("-");
}

/**
 * Every story the sightings hold, biggest first. `windowHours` is how far back coverage counts; the same sightings
 * at a later `now` give the same story with more or fewer articles.
 */
export function sizeStories(
  sightings: SizedSighting[],
  now: Date,
  windowHours = 48,
): SizedStory[] {
  const cutoff = now.getTime() - windowHours * 3_600_000;
  const hashesOf = new Map<string, Set<string>>();
  const byUrl = new Map<string, FeedItem>();
  for (const s of sightings) {
    for (const item of s.cluster_json.items ?? []) {
      const at = new Date(item.publishedAt).getTime();
      if (!(at >= cutoff && at <= now.getTime())) continue;
      const u = canonicalUrl(item.url);
      if (!hashesOf.has(u)) hashesOf.set(u, new Set());
      hashesOf.get(u)!.add(s.hash);
      if (!byUrl.has(u)) byUrl.set(u, item);
    }
  }
  const items = [...byUrl.entries()]
    .map(([url, item]) => ({ url, item }))
    .filter(
      ({ item }) => !NOT_A_SOURCE.has(item.source) && !isJunkTitle(item.title),
    );

  // An article about a game the table does not know joins the distinctive word it shares with the most other articles.
  // One word, no chains: a stray shared word cannot glue the week's news into one story.
  const known = items.map((x) => knownEntity(x.item.title));
  const words = items.map((x) => anchors(x.item.title));
  const wordCount = new Map<string, number>();
  items.forEach((_, i) => {
    if (known[i]) return;
    for (const w of words[i]!) wordCount.set(w, (wordCount.get(w) ?? 0) + 1);
  });
  const entityOf = (i: number): Entity => {
    const k = known[i];
    if (k) return k;
    const top = words[i]!
      .filter((w) => w.length >= 4 && (wordCount.get(w) ?? 0) >= 2)
      .sort(
        (x, y) =>
          (wordCount.get(y) ?? 0) - (wordCount.get(x) ?? 0) ||
          x.localeCompare(y),
      )[0];
    return top
      ? { key: `w:${top}`, name: top[0]!.toUpperCase() + top.slice(1), tier: 0 }
      : { key: `t:${items[i]!.url}`, name: items[i]!.item.title, tier: 0 };
  };

  const buckets = new Map<
    string,
    { entity: Entity; event: StoryEvent; at: number[] }
  >();
  // How much of the press is on this game at all, whatever the news.
  const entityOutlets = new Map<string, Set<string>>();
  // A name the table does not know is rarely in the news twice in two days: its headlines are one story, told under
  // the kind of news most of them carry. Only a known game has several stories at once.
  const leadEvent = new Map<string, StoryEvent>();
  {
    const tally = new Map<string, Map<StoryEvent, number>>();
    items.forEach((x, i) => {
      const k = entityOf(i).key;
      if (known[i]) return;
      const e = storyEvent(x.item.title);
      if (e === "other") return;
      if (!tally.has(k)) tally.set(k, new Map());
      tally.get(k)!.set(e, (tally.get(k)!.get(e) ?? 0) + 1);
    });
    for (const [k, t] of tally)
      leadEvent.set(k, [...t.entries()].sort((a, b) => b[1] - a[1])[0]![0]);
  }
  items.forEach((x, i) => {
    const entity = entityOf(i);
    const event = leadEvent.get(entity.key) ?? storyEvent(x.item.title);
    const key = `${entity.key}|${event}`;
    if (!buckets.has(key)) buckets.set(key, { entity, event, at: [] });
    buckets.get(key)!.at.push(i);
    if (!entityOutlets.has(entity.key))
      entityOutlets.set(entity.key, new Set());
    entityOutlets
      .get(entity.key)!
      .add(OUTLET_GROUP[x.item.source] ?? x.item.source);
  });

  const stories: SizedStory[] = [];
  for (const [bucketKey, b] of buckets) {
    // "Other" and "update" say nothing about being the same news, so their articles must also read alike.
    const groups: number[][] = [];
    if (b.event === "other" || b.event === "update") {
      const sub = unionFind(b.at.length);
      for (let i = 0; i < b.at.length; i++)
        for (let j = 0; j < i; j++)
          if (similarTitles(items[b.at[i]!]!.item.title, items[b.at[j]!]!.item.title))
            sub.union(i, j);
      const seen = new Map<number, number[]>();
      b.at.forEach((idx, i) => {
        const r = sub.find(i);
        if (!seen.has(r)) seen.set(r, []);
        seen.get(r)!.push(idx);
      });
      groups.push(...seen.values());
    } else groups.push(b.at);

    for (const group of groups) {
      const its = group
        .map((i) => items[i]!.item)
        .sort((x, y) => y.publishedAt.localeCompare(x.publishedAt));
      const outlets = [
        ...new Set(its.map((i) => OUTLET_GROUP[i.source] ?? i.source)),
      ];
      const official = its.some((i) => i.sourceKind === "official");
      const times = its.map((i) => new Date(i.publishedAt).getTime());
      const span = new Set(
        times.map((t) => Math.floor((now.getTime() - t) / 86_400_000)),
      ).size;
      const peak = peakPerSixHours(times);
      const heat = entityOutlets.get(b.entity.key)?.size ?? 0;
      const titles = its.map((i) => i.title);
      const rumourShare =
        titles.filter((t) => RUMOUR.test(t)).length / titles.length;

      const pts = {
        outlets:
          OUTLET_POINTS[Math.min(outlets.length, OUTLET_POINTS.length - 1)]!,
        official: official ? 8 : 0,
        franchise: b.entity.tier ? TIER_POINTS[b.entity.tier] : 0,
        kind: EVENT_POINTS[b.event],
        speed: Math.min(10, Math.max(0, peak - 1) * 2),
        days: Math.min(8, Math.max(0, span - 1) * 4),
        heat: heat >= 9 ? 8 : heat >= 6 ? 4 : 0,
      };
      const size = Object.values(pts).reduce((a, v) => a + v, 0);
      stories.push({
        key:
          b.event === "other" || b.event === "update"
            ? `${bucketKey}#${tokensKey(titles[titles.length - 1]!)}`
            : bucketKey,
        entity: b.entity.key,
        name: b.entity.name,
        event: b.event,
        size: Math.max(0, size),
        why: Object.entries(pts)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k} ${v > 0 ? "+" : ""}${v}`)
          .join(", "),
        headline: centralHeadline(its),
        outlets,
        articles: its.length,
        official,
        // Half the headlines hedging makes it a report; one outlet's "reportedly" among eight firm ones does not.
        rumour: !official && rumourShare >= 0.5,
        leak: titles.some((t) => LEAK.test(t)),
        unsafe: titles.some((t) => UNSAFE.test(t)),
        firstAt: its[its.length - 1]!.publishedAt,
        newestAt: its[0]!.publishedAt,
        items: its,
        hashes: [
          ...new Set(
            group.flatMap((i) => [...(hashesOf.get(items[i]!.url) ?? [])]),
          ),
        ],
      });
    }
  }
  return stories.sort((a, b) => b.size - a.size);
}

interface Entity {
  key: string;
  name: string;
  tier: 0 | 1 | 2 | 3;
}

/** A story as the pipeline carries it: all its articles, the first-party ones first, the newest next. */
export function storyCluster(story: SizedStory): StoryCluster {
  const items = [...story.items]
    .sort(
      (a, b) =>
        (a.sourceKind === "official" ? 0 : 1) -
          (b.sourceKind === "official" ? 0 : 1) ||
        b.publishedAt.localeCompare(a.publishedAt),
    )
    .slice(0, 12);
  return {
    hash: `big:${story.key}:${story.firstAt.slice(0, 10)}`,
    headline: story.headline,
    items,
    sources: [...new Set(items.map((i) => i.source))],
    hasOfficial: story.official,
    corroborated: story.official || story.outlets.length >= 2,
    rumourSignals: story.rumour,
    newestAt: story.newestAt,
    score: story.size,
  };
}
