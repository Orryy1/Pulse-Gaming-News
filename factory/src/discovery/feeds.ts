// Curated sources. "official" feeds are first-party publisher/platform
// newsrooms: a story they carry counts as confirmed on its own. Outlets need
// a second independent outlet (or an official source) before a story counts
// as corroborated. Reddit is deliberately absent: its public API is closing.

export interface Feed {
  name: string;
  url: string;
  kind: "official" | "outlet";
}

export const FEEDS: Feed[] = [
  { name: "PlayStation Blog", url: "https://blog.playstation.com/feed/", kind: "official" },
  { name: "Xbox Wire", url: "https://news.xbox.com/en-us/feed/", kind: "official" },
  { name: "IGN", url: "https://feeds.feedburner.com/ign/games-all", kind: "outlet" },
  { name: "GameSpot", url: "https://www.gamespot.com/feeds/news/", kind: "outlet" },
  { name: "Eurogamer", url: "https://www.eurogamer.net/feed/news", kind: "outlet" },
  { name: "VGC", url: "https://www.videogameschronicle.com/category/news/feed/", kind: "outlet" },
  { name: "PC Gamer", url: "https://www.pcgamer.com/rss/", kind: "outlet" },
  { name: "Rock Paper Shotgun", url: "https://www.rockpapershotgun.com/feed/news", kind: "outlet" },
  { name: "The Verge", url: "https://www.theverge.com/rss/games/index.xml", kind: "outlet" },
  { name: "Polygon", url: "https://www.polygon.com/rss/news/index.xml", kind: "outlet" },
  { name: "Gematsu", url: "https://www.gematsu.com/feed", kind: "outlet" },
  { name: "Push Square", url: "https://www.pushsquare.com/feeds/latest", kind: "outlet" },
  { name: "Nintendo Life", url: "https://www.nintendolife.com/feeds/latest", kind: "outlet" },
  { name: "Pure Xbox", url: "https://www.purexbox.com/feeds/latest", kind: "outlet" },
  { name: "GamesIndustry.biz", url: "https://www.gamesindustry.biz/feed/news", kind: "outlet" },
  { name: "Insider Gaming", url: "https://insider-gaming.com/feed/", kind: "outlet" },
];

// Franchises and platforms that reliably pull cold Shorts viewers. Weighted
// into the selection score; not a filter.
export const HOT_TERMS: Array<[RegExp, number]> = [
  [/\bgta\s*(vi|6)\b|grand theft auto/i, 30],
  [/\bswitch\s*2\b/i, 18],
  [/\bps5\b|playstation\s*5|ps5 pro|playstation plus|ps plus/i, 12],
  [/\bxbox\b|game pass/i, 12],
  [/\bnintendo\b|zelda|mario|pok[eé]mon/i, 14],
  [/call of duty|\bcod\b|battlefield/i, 14],
  [/elden ring|fromsoftware|souls/i, 12],
  [/\bsteam\b|valve|half-life|steam deck|steam machine/i, 12],
  [/fortnite|minecraft|roblox/i, 10],
  [/the elder scrolls|fallout|starfield|bethesda/i, 12],
  [/witcher|cyberpunk|cd projekt/i, 12],
  [/resident evil|capcom|monster hunter|street fighter/i, 10],
  [/final fantasy|square enix|kingdom hearts/i, 10],
  [/assassin'?s creed|ubisoft/i, 8],
  [/marvel|spider-man|wolverine|insomniac/i, 10],
  [/hollow knight|silksong|hades/i, 10],
  [/god of war|naughty dog|the last of us|ghost of/i, 12],
  [/halo|gears of war|forza/i, 10],
];

// Story-type signals: these are what make a Short worth watching.
export const NEWSWORTHY_TERMS: Array<[RegExp, number]> = [
  [/release date|launch(es|ing)? on|out now|coming (on|in)/i, 14],
  [/delay(ed|s)?|postpone/i, 16],
  [/price|£|\$\d|cost|more expensive|cheaper/i, 12],
  [/trailer|reveal(ed|s)?|announce(d|s|ment)?|first look|gameplay/i, 12],
  [/sold|sales|million (players|copies|units)|record/i, 14],
  [/layoff|shut(s|ting)? down|closure|acquire|acquisition|lawsuit/i, 10],
  [/free|giveaway|game pass|ps plus/i, 8],
  [/leak|rumou?r|insider|reportedly/i, 6],
];

// Things that make poor Shorts or monetisation risks.
export const PENALTY_TERMS: Array<[RegExp, number]> = [
  [/\bdeals?\b|discount|% off|best .* to buy|gift guide|sale\b/i, -30],
  [/review:|review -|review[- ]in[- ]progress|\breview\b.*score|tier list|ranked|best .* of all time/i, -25],
  [/podcast|livestream|stream schedule|quiz|crossword|wordle|connections/i, -40],
  [/guide|how to|walkthrough|where to find|location/i, -35],
  [/suicide|murder|shooting|sexual|assault|died|death of/i, -60],
];
