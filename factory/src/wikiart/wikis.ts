// Where each game's art lives: the franchise's own community wiki (Fandom, wiki.gg or an independent MediaWiki),
// reached only through its MediaWiki API. A franchise wiki covers many games, so each game also gets the names its
// wiki files that game under ("GTA VI" on GTA Wiki: "Category:Characters in GTA VI"). A game no rule knows is tried
// on <name>.fandom.com and <name>.wiki.gg, kept only when the wiki's own name says it is about that game.
//
// Left out on purpose: wikis whose robots.txt keeps generic agents off api.php (Super Mario Wiki, Halopedia,
// bg3.wiki, Grand Theft Wiki, UESP, SmashWiki, Metroid Wiki, warcraft.wiki.gg; and Wikipedia, Commons and Wikidata,
// whose robots.txt disallows /w/ for crawlers). The crawler checks robots.txt for every host anyway, so a wiki that
// changes its mind is honoured either way. Fandom allows its API, but its picture server answers automated clients
// with a Cloudflare browser challenge (checked 20 Nov 2026); the crawler does not try to get past a challenge, so a
// Fandom wiki is skipped once a sample picture fails (FranchiseRule.alt lists the independent wikis tried first).

export interface Wiki {
  id: string;
  name: string;
  /** https://gta.fandom.com/api.php */
  api: string;
  /** Article URL prefix: https://gta.fandom.com/wiki/ */
  articles: string;
  /** One game per wiki (the whole wiki is that game) or many. */
  scope: "game" | "franchise";
  /** The API of the wiki that holds the file pages, when files come from a shared repository (Bulbagarden Archives). */
  fileApi?: string;
}

const fandom = (
  sub: string,
  name: string,
  scope: Wiki["scope"] = "franchise",
): Wiki => ({
  id: `${sub}.fandom`,
  name,
  api: `https://${sub}.fandom.com/api.php`,
  articles: `https://${sub}.fandom.com/wiki/`,
  scope,
});
const wikigg = (
  sub: string,
  name: string,
  scope: Wiki["scope"] = "franchise",
): Wiki => ({
  id: `${sub}.wiki.gg`,
  name,
  api: `https://${sub}.wiki.gg/api.php`,
  articles: `https://${sub}.wiki.gg/wiki/`,
  scope,
});
const own = (
  id: string,
  name: string,
  host: string,
  apiPath: string,
  articles: string,
  scope: Wiki["scope"] = "franchise",
): Wiki => ({
  id,
  name,
  api: `https://${host}${apiPath}`,
  articles: `https://${host}${articles}`,
  scope,
});

/** Roman numerals for "GTA VI" style short names. */
const ROMAN = [
  "",
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "VIII",
  "IX",
  "X",
  "XI",
  "XII",
  "XIII",
  "XIV",
  "XV",
  "XVI",
];
const toRoman = (s: string) =>
  s.replace(/\b(\d{1,2})\b/g, (m, n: string) => ROMAN[Number(n)] ?? m);

export interface FranchiseRule {
  match: RegExp;
  wiki: Wiki;
  /**
   * Independent wikis tried before `wiki`. Fandom's picture server (static.wikia.nocookie.net) answers automated
   * clients with a browser challenge, so a Fandom wiki can be read but its pictures cannot be fetched politely;
   * an independent or wiki.gg wiki of the same franchise is preferred whenever one exists and allows its API.
   */
  alt?: Wiki[];
  /** The names the wiki files this game under, best first ("GTA VI", "Grand Theft Auto VI"). */
  names: (title: string) => string[];
  /** Extra categories worth crawling for every game of the franchise (brands, radio, shared places). */
  shared?: string[];
}

const plain = (title: string) => [
  title,
  title.replace(/^The /, ""),
  title.split(":")[0]!.trim(),
];

/** Franchise wikis, most specific first. */
export const FRANCHISES: FranchiseRule[] = [
  {
    match: /^grand theft auto|^gta\b/i,
    wiki: fandom("gta", "GTA Wiki"),
    names: (t) => {
      const sub = t.replace(/^Grand Theft Auto:?\s*/i, "").trim();
      return [`GTA ${toRoman(sub)}`, `GTA: ${sub}`, t, sub];
    },
    shared: [
      "Category:Mod shop brands",
      "Category:Manufacturers",
      "Category:Radio Stations",
      "Category:Companies",
      "Category:Brands",
    ],
  },
  {
    match: /^red dead/i,
    wiki: fandom("reddead", "Red Dead Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /zelda/i,
    wiki: own(
      "zeldawiki",
      "Zelda Wiki",
      "zeldawiki.wiki",
      "/w/api.php",
      "/wiki/",
    ),
    names: (t) => [t.replace(/^The Legend of Zelda:?\s*/i, "").trim(), t],
  },
  {
    match: /pok[eé]mon/i,
    wiki: fandom("pokemon", "Pokémon Wiki"),
    alt: [
      {
        ...own(
          "bulbapedia",
          "Bulbapedia",
          "bulbapedia.bulbagarden.net",
          "/w/api.php",
          "/wiki/",
        ),
        fileApi: "https://archives.bulbagarden.net/w/api.php",
      },
    ],
    names: (t) => plain(t),
  },
  {
    match:
      /^(super )?mario|mario kart|^luigi|^yoshi|^donkey kong|^wario|^peach/i,
    wiki: fandom("mario", "Super Mario Wiki (Fandom)"),
    names: (t) => plain(t),
  },
  {
    match: /^halo\b/i,
    wiki: fandom("halo", "Halo Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /call of duty|^cod\b/i,
    wiki: fandom("callofduty", "Call of Duty Wiki"),
    names: (t) => [t.replace(/^Call of Duty:?\s*/i, "").trim(), t],
  },
  {
    match: /assassin'?s creed/i,
    wiki: fandom("assassinscreed", "Assassin's Creed Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /final fantasy xiv|final fantasy 14|^ffxiv/i,
    wiki: own(
      "ffxiv.consolegameswiki",
      "Final Fantasy XIV Online Wiki",
      "ffxiv.consolegameswiki.com",
      "/mediawiki/api.php",
      "/wiki/",
      "game",
    ),
    names: (t) => plain(t),
  },
  {
    match: /final fantasy/i,
    wiki: fandom("finalfantasy", "Final Fantasy Wiki"),
    names: (t) => [toRoman(t), t],
  },
  {
    match: /elder scrolls|skyrim|oblivion|morrowind/i,
    wiki: fandom("elderscrolls", "Elder Scrolls Wiki"),
    names: (t) => [t.replace(/^The Elder Scrolls [IVX]+:\s*/i, ""), t],
  },
  {
    match: /^fallout/i,
    wiki: own(
      "fallout.wiki",
      "Fallout Wiki",
      "fallout.wiki",
      "/api.php",
      "/wiki/",
    ),
    names: (t) => plain(t),
  },
  {
    match: /resident evil|biohazard/i,
    wiki: fandom("residentevil", "Resident Evil Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /elden ring/i,
    wiki: fandom("eldenring", "Elden Ring Wiki", "game"),
    alt: [wikigg("eldenring", "Eldenpedia", "game")],
    names: (t) => plain(t),
  },
  {
    match: /dark souls|demon'?s souls|bloodborne|sekiro/i,
    wiki: fandom("darksouls", "Dark Souls Wiki"),
    names: (t) => [toRoman(t), t],
  },
  {
    match: /god of war/i,
    wiki: fandom("godofwar", "God of War Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /minecraft/i,
    wiki: own(
      "minecraft.wiki",
      "Minecraft Wiki",
      "minecraft.wiki",
      "/api.php",
      "/w/",
    ),
    names: (t) => plain(t),
  },
  {
    match: /witcher/i,
    wiki: fandom("witcher", "Witcher Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /cyberpunk/i,
    wiki: fandom("cyberpunk", "Cyberpunk Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /diablo/i,
    wiki: fandom("diablo", "Diablo Wiki"),
    names: (t) => [toRoman(t), t],
  },
  {
    match: /smash bros/i,
    wiki: fandom("supersmashbros", "Smash Bros. Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /metroid/i,
    wiki: fandom("metroid", "Wikitroid"),
    names: (t) => plain(t),
  },
  {
    match: /sonic/i,
    wiki: fandom("sonic", "Sonic Wiki Zone"),
    alt: [
      own("sonicretro", "Sonic Retro", "info.sonicretro.org", "/api.php", "/"),
    ],
    names: (t) => plain(t),
  },
  {
    match: /star wars/i,
    wiki: fandom("starwars", "Wookieepedia"),
    names: (t) => plain(t),
  },
  {
    match: /spider-?man/i,
    wiki: fandom("marvels-spider-man", "Marvel's Spider-Man Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /hollow knight/i,
    wiki: fandom("hollowknight", "Hollow Knight Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /baldur'?s gate/i,
    wiki: fandom("baldursgate", "Baldur's Gate Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /mass effect/i,
    wiki: fandom("masseffect", "Mass Effect Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^gears of war/i,
    wiki: fandom("gearsofwar", "Gears of War Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^doom\b/i,
    wiki: fandom("doom", "Doom Wiki (Fandom)"),
    names: (t) => plain(t),
  },
  {
    match: /metal gear/i,
    wiki: fandom("metalgear", "Metal Gear Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /silent hill/i,
    wiki: fandom("silenthill", "Silent Hill Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /tomb raider/i,
    wiki: fandom("tombraider", "Tomb Raider Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /crash bandicoot/i,
    wiki: fandom("crashbandicoot", "Crash Bandicoot Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /spyro/i,
    wiki: fandom("spyro", "Spyro Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /street fighter/i,
    wiki: fandom("streetfighter", "Street Fighter Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /warcraft/i,
    wiki: fandom("wowpedia", "Wowpedia"),
    names: (t) => plain(t),
  },
  {
    match: /starcraft/i,
    wiki: fandom("starcraft", "StarCraft Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^fortnite/i,
    wiki: fandom("fortnite", "Fortnite Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /prince of persia/i,
    wiki: fandom("princeofpersia", "Prince of Persia Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /ratchet/i,
    wiki: fandom("ratchetandclank", "Ratchet & Clank Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^nier/i,
    wiki: fandom("nier", "NieR Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^bully\b/i,
    wiki: fandom("bully", "Bully Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^xcom/i,
    wiki: fandom("xcom", "XCOM Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /civilization/i,
    wiki: fandom("civilization", "Civilization Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /rainbow six/i,
    wiki: fandom("rainbowsix", "Rainbow Six Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /^fable\b/i,
    wiki: fandom("fable", "Fable Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /need for speed/i,
    wiki: fandom("nfs", "Need for Speed Wiki"),
    names: (t) => plain(t),
  },
  {
    match: /no man'?s sky/i,
    wiki: fandom("nomanssky", "No Man's Sky Wiki", "game"),
    names: (t) => plain(t),
  },
  {
    match: /pubg|battlegrounds/i,
    wiki: fandom("pubg", "PUBG Wiki", "game"),
    names: (t) => plain(t),
  },
  {
    match: /terraria/i,
    wiki: wikigg("terraria", "Terraria Wiki", "game"),
    names: (t) => plain(t),
  },
];

/** The franchise rule for a game, if one knows it (pure). */
export function franchiseFor(title: string): FranchiseRule | undefined {
  return FRANCHISES.find((f) => f.match.test(title));
}

/** Candidate single-game wikis for a game no rule knows: <name>.fandom.com and <name>.wiki.gg (pure). */
export function guessWikis(title: string): Wiki[] {
  const head = title
    .split(":")[0]!
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^the /, "")
    .replace(/['’&.]/g, "");
  // A sequel usually shares its series' wiki ("Hades II" on hades.fandom.com): the bare name first, then the full one.
  const bases = [head.replace(/\s+(\d{1,2}|[ivx]{1,4})$/, ""), head].map((b) =>
    b.replace(/[^a-z0-9]+/g, ""),
  );
  const name = `${title.split(":")[0]} Wiki`;
  return [...new Set(bases)]
    .filter((b) => b.length >= 3)
    .flatMap((b) => [fandom(b, name, "game"), wikigg(b, name, "game")]);
}

/** Category title candidates for a game on its wiki (pure): "Category:GTA VI", "Category:Grand Theft Auto VI". */
export function rootCategoryCandidates(
  title: string,
  rule?: FranchiseRule,
): string[] {
  const names = rule ? rule.names(title) : plain(title);
  return [...new Set(names.filter(Boolean).map((n) => `Category:${n.trim()}`))];
}

/** A subcategory belongs to the game when it carries one of the game's names (pure). */
export function categoryOfGame(cat: string, gameNames: string[]): boolean {
  const c = cat.toLowerCase();
  return gameNames.some((n) => {
    const name = n.toLowerCase().trim();
    if (name.length < 3) return false;
    const i = c.indexOf(name);
    if (i < 0) return false;
    // "GTA V" must not take "GTA VI" or "GTA Vice City": the name ends at a word boundary.
    const after = c.slice(i + name.length, i + name.length + 1);
    return !after || !/[a-z0-9]/.test(after);
  });
}

/** Category names that rarely hold pictures of named things, skipped while walking (pure). */
export function boringCategory(cat: string): boolean {
  return /\b(stubs?|candidates|cleanup|templates?|maintenance|pages (with|using|needing|containing)|articles (with|needing)|new pages|beta changes|speculation|disambiguation|trivia|achievements|trophies|missions? walkthrough|real-world people|staff|credits|voice actors|cast|soundtrack|songs|tracks|music|users?|user images)\b/i.test(
    cat,
  );
}

/**
 * StrategyWiki: a guide wiki covering thousands of games, each with its box art (sourced from the publisher's store
 * page) on the game's own page and a logo on its "Table of Contents" subpage. Crawled for every game after its own
 * wiki, for the game's box art and logo and the named pictures on its subpages.
 */
export const STRATEGYWIKI: Wiki = own("strategywiki", "StrategyWiki", "strategywiki.org", "/w/api.php", "/wiki/", "franchise");
