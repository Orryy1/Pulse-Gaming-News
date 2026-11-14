// The word lists and patterns the Packaging Lab reads titles with (src/packaging/features.ts, ./clarity.ts). Kept in one
// file so a lesson can change a list without touching the code that counts it. Every pattern is case-insensitive.

/** Words that open a gap the viewer wants closed: a reason, a hidden side, a turn. */
export const CURIOSITY =
  /\b(why|how|what really|the real|secret(ly)?|hidden|nobody|no one|finally|still|actually|turns out|the truth|here'?s why|this is why|wasn'?t|isn'?t|never|almost|quietly|behind)\b/i;

/** A stake the viewer can feel: money, time, a release, a price, a free thing. */
export const STAKES =
  /(\$\s?\d|\bfree\b|\bprice[ds]?\b|\bdelay(ed|s)?\b|\brelease date\b|\bpreorders?\b|\brefunds?\b|\bsales?\b|\bcopies\b|\bplayers\b|\brecord\b|\bbanned?\b|\bshut(s|ting)? down\b|\bcancel(l?ed|s)?\b|\bremoved?\b)/i;

/** Words that carry a negative charge (a fall, a fault, a loss). */
export const NEGATIVE =
  /\b(worst|fail(ed|s|ure)?|lost|loses?|broke(n)?|ruin(ed|s)?|problem|disaster|flop(ped)?|mess|down|backlash|angry|hated?|wrong|dead|delay(ed)?|bad|crash(es|ed)?|missing|gone|nerf(ed)?|downgrade)\b/i;

/** Words that carry a positive charge (a win, a record, praise). */
export const POSITIVE =
  /\b(best|glowing|perfect|record|masterpiece|incredible|great(est)?|saved?|comeback|returns?|win(s|ner)?|beautiful|legendary|finally)\b/i;

/** A ranking or a list. */
export const LIST =
  /\b(ranked|ranking|every|top \d+|\d+ (best|games|things|reasons)|worst to best|best to worst|tier list)\b/i;

/** A head-to-head. */
export const VERSUS = /\b(vs\.?|versus)(?![A-Za-z])/i;

/** Words that label a claim as unconfirmed; a rumour's title must carry one (CLAUDE.md: rumours are labelled). */
export const RUMOUR_LABEL =
  /\b(reportedly|rumou?r(ed|s)?|leak(ed|s)?|could|may|might|claims?|allegedly|insider|sources?( say)?|tipped|hint(s|ed)?|\?)/i;

/** Words that assert a claim as settled: never on a rumour. */
export const CERTAINTY =
  /\b(confirmed|official(ly)?|it'?s happening|announced|revealed|proven|guaranteed)\b/i;

/** Hype that tells instead of shows; the channel's voice avoids it (src/editorial/voice.ts HYPE). */
export const HYPE =
  /\b(insane|insanely|massive|huge|crazy|mind[- ]blowing|shocking|unbelievable|epic)\b/i;

/** Clickbait the clarity check refuses outright: promises a video cannot keep or that misleads. */
export const CLICKBAIT =
  /\b(you won'?t believe|gone wrong|not clickbait|must watch|doctors hate|watch before it'?s deleted|99% of|this changes everything|the end of gaming)\b/i;

/** Ordinals spelled out; the channel writes them as figures (14th, not fourteenth). */
export const SPELLED_ORDINAL =
  /\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\s+(of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth)\b/i;

/** Dashes the channel never writes (an obvious machine tell). */
export const LONG_DASH = /[—–]/;

/** Speaking to the viewer. */
export const SECOND_PERSON = /\b(you|your|you'?re|you'?ll)\b/i;

/** A big figure: a thousand or more, or one written as millions or billions. */
export const BIG_NUMBER =
  /(\b\d{1,3}(,\d{3})+\b|\b\d{4,}\b(?!s)|\b\d+(\.\d+)?\s?(k|m|million|billion)\b)/i;

/** A calendar year (1970 to 2039). */
export const YEAR = /\b(19[7-9]\d|20[0-3]\d)\b/;

/** Emoji and pictographs. */
export const EMOJI = /\p{Extended_Pictographic}/u;

/** Jargon a casual US viewer may not know; fine in the description, a cost in a title. */
export const JARGON =
  /\b(sku|dlss|fsr|tflops?|rdna|ip|devkit|vertical slice|live[- ]service|gaas|mtx|sbmm|ttk|dps|fov|lod)\b/i;

/**
 * Franchises and platforms a gaming viewer recognises at a glance. Order matters only for readability. A title that
 * leads with one is "named"; the feature does not need the list to be complete, only consistent.
 */
export const FRANCHISES: readonly string[] = [
  "GTA",
  "Grand Theft Auto",
  "Call of Duty",
  "CoD",
  "Black Ops",
  "Modern Warfare",
  "Warzone",
  "Zelda",
  "Ocarina",
  "Mario",
  "Pokemon",
  "Pokémon",
  "Nintendo",
  "Switch",
  "PlayStation",
  "PS5",
  "PS4",
  "PS1",
  "PS2",
  "PS3",
  "Xbox",
  "Steam",
  "Halo",
  "God of War",
  "Resident Evil",
  "Silent Hill",
  "Minecraft",
  "Fortnite",
  "Roblox",
  "Elden Ring",
  "Dark Souls",
  "Skyrim",
  "Elder Scrolls",
  "Fallout",
  "Cyberpunk",
  "Witcher",
  "Final Fantasy",
  "Assassin's Creed",
  "Battlefield",
  "Destiny",
  "Bungie",
  "Marathon",
  "Helldivers",
  "Red Dead",
  "Rockstar",
  "Sony",
  "Microsoft",
  "Ubisoft",
  "EA",
  "Valve",
  "Half-Life",
  "Counter-Strike",
  "Valorant",
  "League of Legends",
  "Overwatch",
  "Diablo",
  "World of Warcraft",
  "WoW",
  "Starfield",
  "Fable",
  "Wolverine",
  "Spider-Man",
  "Batman",
  "Metal Gear",
  "Kojima",
  "Death Stranding",
  "Hollow Knight",
  "Silksong",
  "Borderlands",
  "Mass Effect",
  "Dragon Age",
  "BioWare",
  "Sonic",
  "Crash Bandicoot",
  "Tomb Raider",
  "Need for Speed",
  "Mario Kart",
  "Smash",
  "Street Fighter",
  "Mortal Kombat",
  "Tekken",
  "Persona",
  "Kingdom Hearts",
  "Baldur's Gate",
  "Civilization",
  "Sims",
  "FIFA",
  "EA Sports FC",
  "Madden",
  "NBA 2K",
  "2K",
  "Bloodborne",
  "Sekiro",
  "Monster Hunter",
  "Star Wars",
  "Intergalactic",
  "Naughty Dog",
  "Last of Us",
  "Uncharted",
  "Ghost of",
  "Horizon",
  "Doom",
  "Portal",
  "Poppy Playtime",
  "Dispatch",
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One pattern for every franchise, longest first so "Grand Theft Auto" wins over "GTA" inside it. */
export const FRANCHISE = new RegExp(
  `(^|[^A-Za-z0-9])(${[...FRANCHISES]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})(?![A-Za-z])`,
  "i",
);

/** Hashtags (Shorts titles from other channels carry them; they are stripped before reading the title). */
export const HASHTAG = /#[\p{L}\p{N}_]+/gu;

/** Small capitalised words that are not names (title case capitalises them). */
export const SMALL_WORD = /^(The|A|An|And|Of|In|On|To|For|Is|It|Its|Was|At|By|With|From|This|That|Your|You)$/;

/** A figure and up to three words after it, stopping at punctuation ("17% of the vote", "21 PC classics"). */
export const FIGURE_PHRASE = /\$?\d[\d,.]*\s?(%|GB|TB|million|billion|k|m)?(\s+[\p{L}'-]+){1,3}/iu;

/** Small words a phrase must not end on. */
export const TRAILING_SMALL = /(\s+(of|the|a|an|to|for|and|in|on|with|at|by|from|its|your))+$/i;
