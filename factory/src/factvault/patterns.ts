// Every pattern the Fact Vault reads text with, in one file, so a rule can be read, tested and changed in one place.

/** Outlets a script may credit, longest names first so "PC Gamer" wins over a bare "Gamer". */
export const OUTLETS: readonly string[] = [
  "Electronic Gaming Monthly",
  "Official PlayStation Magazine",
  "Official Xbox Magazine",
  "Computer Gaming World",
  "Video Games Chronicle",
  "Rock Paper Shotgun",
  "Nintendo World Report",
  "Hardcore Gamer",
  "Game Informer",
  "GameRevolution",
  "Digital Trends",
  "Nintendo Life",
  "Insider Gaming",
  "The Guardian",
  "The Verge",
  "Push Square",
  "Destructoid",
  "GamesRadar+",
  "GamesRadar",
  "Giant Bomb",
  "Eurogamer",
  "Shacknews",
  "OpenCritic",
  "Metacritic",
  "Pure Xbox",
  "PC Gamer",
  "GameSpot",
  "GameSpy",
  "Polygon",
  "Gematsu",
  "USgamer",
  "Engadget",
  "Bloomberg",
  "Famitsu",
  "Kotaku",
  "VG247",
  "X-Play",
  "1UP.com",
  "1UP",
  "Edge",
  "IGN",
  "VGC",
  "EGM",
  "Time",
];

/** A quoted span in straight or curly double quotes; the words sit in group 1. */
export const QUOTE_SPAN = /[“"]([^“”"]{3,400})[”"]/g;

/** Written money: "$69.99", "£59.99", "€5", "$750 million". */
export const MONEY_WRITTEN =
  /(?<![\w.])([$£€])\s?(\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?)(?:\s?(million|billion|bn|m)\b)?/gi;

/** A currency word after a spoken amount. */
export const CURRENCY_WORD = /^(dollars?|bucks|pounds?|quid|euros?)$/i;

/** Spoken number words the parser understands. */
export const NUMBER_WORD =
  /^(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|and|a)$/i;

/** A word that hedges a number: "about two dollars" and "over 25 million" are not exact claims. */
export const HEDGE_BEFORE =
  /\b(about|around|roughly|nearly|almost|under|just under|over|more than|at least|close to|upwards of|some|approximately|less than|below)\s*$/i;

/** Hedges that say "at least this many". */
export const AT_LEAST = /\b(over|more than|at least|upwards of)\s*$/i;

/** Hedges that say "a little under this". */
export const AT_MOST =
  /\b(nearly|almost|under|just under|less than|below|close to)\s*$/i;

/** A four-digit year a game could come out in. */
export const YEAR_DIGITS = /\b(19[7-9]\d|20[0-4]\d)\b/g;

/** A spoken year: "twenty nineteen", "nineteen ninety-seven", "two thousand and eight". */
export const YEAR_SPOKEN =
  /\b(nineteen|twenty)[ -](ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|sixty(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|seventy(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|eighty(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|ninety(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|o[ -](?:one|two|three|four|five|six|seven|eight|nine)|oh[ -](?:one|two|three|four|five|six|seven|eight|nine))\b|\btwo thousand(?:[ -]and)?(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?\b/gi;

/** A line about when something came out. */
export const RELEASE_CONTEXT =
  /\b(released?|launch(?:ed|es)?|came out|comes out|arriv(?:ed|es)|debut(?:ed|s)?|first (?:launched|released|arrived)|hit (?:shelves|stores)|out in|release date)\b/i;

/** A line about a port, remaster or re-release, where a later year is not the original release. */
export const PORT_CONTEXT =
  /\b(port(?:ed)?|remaster(?:ed)?|remake|re-?release[ds]?|switch 2|switch|ps5|ps4|xbox series|next-gen|definitive|enhanced|anniversary|collection|backwards? compatib|game pass|later|again|returned)\b/i;

/** Regions a release line can name, and the key the vault keeps them under. */
export const REGION_WORDS: ReadonlyArray<[RegExp, string]> = [
  [/\b(north america|the us|the united states|america|american)\b/i, "NA"],
  [/\b(europe|european|the uk|britain|pal)\b/i, "EU"],
  [/\b(japan|japanese)\b/i, "JP"],
  [/\b(china|chinese)\b/i, "CN"],
  [/\b(korea|korean)\b/i, "KR"],
  [/\b(australia)\b/i, "AU"],
  [/\b(worldwide|globally|global)\b/i, "WW"],
];

/** A sales or player milestone: "sold over 25 million copies", "29.62 million units". */
export const SALES_DIGITS =
  /(\d{1,4}(?:[.,]\d{1,3})?)\s*(million|billion|m\b|bn\b)\s*(copies|units|sales|players|people|accounts)?/gi;

/** Words after a count that make it a sales count. */
export const SALES_CONTEXT =
  /\b(sold|sales|sell|selling|copies|units|shipped|shipments|sell-through)\b/i;

/** Words that make a count a player count. */
export const PLAYERS_CONTEXT =
  /\b(players|concurrent|playing|player count|peak)\b/i;

/** Claims a vault fact alone can never settle: a superlative or an absolute needs a comparison the vault doesn't hold. */
export const SUPERLATIVE =
  /\b(best[- ]selling|fastest|biggest|most|only|first(?! launched| released)|every|never|always|largest|highest|lowest|record|ever|by a distance|of all time|no other)\b/i;

/** What a fact checker's complaint is about, read from its own words. */
export const PROBLEM_KIND: ReadonlyArray<[RegExp, ClaimKind]> = [
  [/\b(quot|verbatim|paraphras|attribut|review|wording)/i, "quote"],
  [/\b(price|priced|cost|\$|£|€|dollar|rounding|rounded)/i, "price"],
  [/\b(sales|sold|copies|units|shipped)\b/i, "sales"],
  [/\b(release|released|launch|launched|debut|year|month|date)\b/i, "year"],
];

export type ClaimKind = "quote" | "price" | "year" | "sales";

/** A verb that reports what an outlet or reviewer wrote. */
export const REPORTING_VERB =
  /\b(called|calls|described|describes|praised|praises|criticised|criticized|wrote|writes|said|says|noted|notes|found|finds|deemed|labelled|labeled|summed|concluded|declared|dubbed|complained|lauded|hailed|panned)\b/i;

/** A review address. */
export const REVIEW_URL =
  /(\/reviews?\/|[-_/]review(?:[-_/.]|$)|review[-_]|\/test\/|\/critique)/i;

/** Wikipedia: a map to the record, never a source. */
export const WIKIPEDIA_URL = /^https?:\/\/([a-z-]+\.)?(m\.)?wikipedia\.org\//i;

/** An archived copy of a page. */
export const ARCHIVE_URL =
  /^https?:\/\/(web\.archive\.org|archive\.(?:org|is|today|ph|li))\//i;

/** The original address inside a Wayback Machine link. */
export const WAYBACK_ORIGINAL =
  /^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\/(https?:\/\/.+)$/i;

/** Source types by address, first match wins. */
export const SOURCE_TYPE_BY_URL: ReadonlyArray<[RegExp, SourceType]> = [
  [/store\.steampowered\.com\/app\//i, "store_page"],
  [/(metacritic|opencritic|gamerankings)\.com/i, "review_aggregate"],
  [
    /(\/ir\/|investor|earnings|annual[-_ ]?report|financial|results|integrated[-_]report|\/ir\.|ir\.[a-z-]+\.(com|co\.jp)|\.pdf(\?|$))/i,
    "earnings_call",
  ],
  [/interview/i, "interview"],
  [
    /(press[-_]?release|presskit|press-kit|\/press\/|businesswire|prnewswire|globenewswire)/i,
    "press_kit",
  ],
  [
    /(news\.xbox\.com|blog\.playstation\.com|nintendo\.(com|co\.jp|co\.uk)|rockstargames\.com|bethesda\.net|ea\.com|ubisoft\.com|capcom|square-enix|bandai|sega\.(com|jp)|konami|activision|blizzard|take2games|cdprojekt|valvesoftware|steampowered\.com\/news|store\.steampowered\.com\/news|epicgames\.com\/site|insomniac|naughtydog|bungie\.net|halowaypoint|playstation\.com|xbox\.com)/i,
    "publisher_post",
  ],
];

export type SourceType =
  | "publisher_post"
  | "earnings_call"
  | "interview"
  | "review"
  | "review_aggregate"
  | "store_page"
  | "press_kit"
  | "official_site"
  | "news_report"
  | "database";

/** Month names, for dates as sources write them. */
export const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "September 30, 1997", "30 September 1997", "Sept. 30, 1997". */
export const DATE_WORDS =
  /\b(?:(\d{1,2})(?:st|nd|rd|th)?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,?\s+(?:(\d{1,2})(?:st|nd|rd|th)?,?\s+)?(19[7-9]\d|20[0-4]\d)\b/gi;

/** An ISO date "1997-09-30" or month "1997-09". */
export const DATE_ISO =
  /\b(19[7-9]\d|20[0-4]\d)-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?\b/g;

/** A Wikipedia sentence about an award. */
export const AWARD_CONTEXT =
  /\b(won|winner|awarded|received|nominated)\b[^.]{0,80}\b(game of the year|award|awards|goty|bafta|golden joystick|the game awards|d\.i\.c\.e\.|interactive achievement)\b/i;

/** A Wikipedia sentence naming who made the game: "directed by Tim Cain", "lead designer Chris Avellone". */
export const PERSON_ROLE =
  /\b(directed|produced|designed|written|composed|created|led)\s+by\s+((?:[A-Z][a-zà-ÿ'’.-]+\s){0,3}[A-Z][a-zà-ÿ'’-]+)|\b(director|producer|lead designer|designer|writer|composer|creator|creative director)\s+((?:[A-Z][a-zà-ÿ'’.-]+\s){0,3}[A-Z][a-zà-ÿ'’-]+)/g;

/** A Wikipedia sentence about the engine. */
export const ENGINE_CONTEXT =
  /\b(built|runs|running|developed|made)\b[^.]{0,40}\b(on|in|with|using)\s+(?:the\s+)?((?:[A-Z][\w.-]*\s?){1,4})\s*engine\b|\b((?:Unreal Engine|Unity|RAGE|Creation Engine|Gamebryo|id Tech|Frostbite|Source|REDengine|Decima|RE Engine|Fox Engine|Snowdrop|Anvil|IW engine|Northlight|Havok|CryEngine|Luminous)(?:\s?\d(?:\.\d)?)?)\b/;

/** A Wikipedia sentence placing the game in a series. */
export const SERIES_CONTEXT =
  /\b(sequel to|prequel to|follow-up to|successor to|spin-off of|spin-off from|followed by|instalment in|installment in|entry in)\s+((?:the\s)?[A-Z0-9][\w'’:.-]*(?:\s(?:of|the|and|[A-Z0-9][\w'’:.-]*)){0,6})/;

/** Where a release verb sits in a cited sentence ("was released in North America on September 30, 1997"). */
export const RELEASE_VERB_AT =
  /\b(released|launched|came out|went on sale|was published|shipped)\b/i;

/** A cited sentence about a re-release, where the date is not the original release. */
export const CITED_PORT =
  /\b(port(?:ed)?|remaster(?:ed)?|remake|re-?release[ds]?|definitive edition|enhanced edition|collection|backward(?:s)? compatib|re-?issued?|update|patch|dlc|expansion|version|edition|soundtrack|mode|demo|beta|trailer|announced|revealed)\b/i;

/** A sales figure for a series, a publisher or several games together. */
export const SERIES_TOTAL =
  /\b(series|franchise|combined|collectively|in total|together|cumulative|across all|the trilogy|both games|history of|games in the|entries)\b/i;

/** A review score: "8.5/10", "9 out of 10", "92/100", "4/5". */
export const REVIEW_SCORE =
  /\b(\d{1,3}(?:\.\d)?)\s*(?:\/|out of)\s*(10|100|5)\b/i;

/** A sentence worth keeping from a review as a quotable verdict: it judges, in the reviewer's own words. */
export const VERDICT_WORDS =
  /\b(best|worst|great|brilliant|superb|excellent|masterpiece|disappoint\w*|repetitive|tedious|fun|boring|stunning|gorgeous|clunky|frustrat\w*|essential|flawed|shallow|ambitious|memorable|forgettable|polished|janky|satisfying|charming|tense|thrilling|dull|bland|beautiful|addictive|rewarding|overall|verdict|ultimately|recommend\w*)\b/i;

/** A figure in a claim ("18", "2.5", "2015"). */
export const FIGURE = /\d+(?:\.\d+)?/g;

/** Page furniture that is not a reviewer's words: shopping lists, rating widgets, sign-ups, related links. */
export const PAGE_JUNK =
  /(^\d+\s+best\b|\bbest (gaming|graphics|budget|cheap)\b|\brate this\b|\bselect 1\b|\bsign up\b|\bnewsletter\b|\bsubscribe\b|\bcookies?\b|\bdeals?\b|\bprice drop\b|\bsponsored\b|\baffiliate\b|\bclick here\b|\bread more\b|\bshare this\b|\bcomments?\b|\bfollow us\b|\bworth spending money\b)/i;

/** Text that is a writer's or editor's note rather than a fact. */
export const NOT_A_CLAIM = /^(?:\[|\(|note:|citation needed)/i;

/** The number words, as a regex alternation (longest first so "seventeen" wins over "seven"). */
const NUM_ALT =
  "seventeen|thirteen|fourteen|eighteen|nineteen|fifteen|sixteen|thousand|million|billion|hundred|eleven|twelve|twenty|thirty|seventy|eighty|ninety|forty|fifty|sixty|three|seven|eight|zero|four|five|nine|one|two|six|ten";

/** A spoken amount of money: "two dollars", "four dollars ninety-nine", "seventy pounds". */
export const MONEY_SPOKEN = new RegExp(
  String.raw`\b((?:(?:${NUM_ALT}|a|and)[ -]){0,5}(?:${NUM_ALT}|a))\s+(dollars?|bucks|pounds?|quid|euros?)\b(?:\s+((?:${NUM_ALT})(?:[ -](?:${NUM_ALT}))?)(?:\s+cents)?)?`,
  "gi",
);

/** A spoken count with a scale: "twenty-five million" ("one point five million" is left to the digits form). */
export const COUNT_SPOKEN = new RegExp(
  String.raw`\b((?:(?:${NUM_ALT}|and)[ -]){0,4}(?:${NUM_ALT}))[ -](million|billion)\b(\s*(?:copies|units|sales|players|people|accounts))?`,
  "gi",
);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Outlet names as one pattern; case must match, so "Edge" and "Time" are names, not words. */
export const OUTLET_PATTERN = new RegExp(
  String.raw`(?<![\w-])(${OUTLETS.map(escapeRe).join("|")})(?![\w-])`,
);

/** Content words for comparing two claims: short words and stop words out. */
export const STOP_WORDS = new Set(
  "the a an and or of to in on for with at by from as is was were be been it its that this which who his her their they he she has had have not but also after into than more most over you your just so".split(
    " ",
  ),
);
