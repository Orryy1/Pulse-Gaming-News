"use strict";

/**
 * lib/script-game-enrichment.js — extract game titles mentioned in
 * the narration script, then fetch Steam + IGDB images for each.
 *
 * Why this exists (2026-04-30 reported issue): a story like
 * "Take-Two Rejected A Sequel, Won't Say Which" gets ONE Steam
 * search against the article title, which doesn't match a single
 * game and falls through to the article scrape / Pexels stock. But
 * the SCRIPT mentions GTA, Red Dead, BioShock, Civilization,
 * Borderlands, Mafia, NBA 2K — every single one has rich Steam +
 * IGDB key art ready to download. We were leaving 80% of the
 * available imagery on the table.
 *
 * This module:
 *   1. Pattern-matches a curated dictionary of game titles +
 *      franchises against the script text.
 *   2. Returns a deduped list of distinct titles (sequels collapsed
 *      into the canonical search term).
 *   3. For each title, fetches Steam search + IGDB images via the
 *      existing helpers.
 *   4. Caps total enrichment at MAX_TITLES titles × MAX_PER_TITLE
 *      images, ordered by first-mention so headline games take
 *      priority.
 *
 * Dictionary-driven (no Claude call at runtime). Zero per-story
 * API cost. Deterministic. Easy to extend by appending entries.
 *
 * The matched titles are passed back to the caller so they can be
 * stamped on the provenance ledger / story for analytics.
 */

const axios = require("axios");

// Cap total new image set this enrichment can add to a story so we
// don't blow the 12-image visual deck or starve other sources.
const MAX_TITLES = 5;
const MAX_PER_TITLE = 3;

// Dictionary of game titles + franchises. Each entry is:
//   { name: "canonical search term passed to Steam/IGDB",
//     pattern: regex matching the script,
//     publisher?: optional tag for provenance/audit }
//
// Regexes are case-insensitive and word-boundary anchored. The
// entries are ordered roughly by mainstream search hit-rate so the
// most-frequently-mentioned games hit early in the dictionary
// scan (no functional impact, just a maintenance preference).
//
// Adding to this dictionary requires three things to be true:
//   1. The game has a Steam page (key art available).
//   2. The pattern can't accidentally match a different title or
//      everyday word (no "Pong" — too short, too ambiguous).
//   3. The replacement title is searchable as-is on Steam.
const GAME_DICTIONARY = [
  // Take-Two / Rockstar / 2K
  {
    name: "Grand Theft Auto V",
    pattern: /\bGTA\s*(V|5)\b|\bGrand Theft Auto\s*(V|5)\b/i,
    publisher: "rockstar",
  },
  {
    name: "Grand Theft Auto VI",
    pattern: /\bGTA\s*(VI|6)\b|\bGrand Theft Auto\s*(VI|6)\b/i,
    publisher: "rockstar",
  },
  {
    name: "Grand Theft Auto",
    pattern: /\bGTA\b|\bGrand Theft Auto\b/i,
    publisher: "rockstar",
  },
  {
    name: "Red Dead Redemption 2",
    pattern: /\bRed Dead Redemption\s*(2|II)\b|\bRDR\s*2\b/i,
    publisher: "rockstar",
  },
  {
    name: "Red Dead Redemption",
    pattern: /\bRed Dead Redemption\b|\bRed Dead\b/i,
    publisher: "rockstar",
  },
  { name: "BioShock", pattern: /\bBioShock\b/i, publisher: "2k" },
  {
    name: "BioShock Infinite",
    pattern: /\bBioShock Infinite\b/i,
    publisher: "2k",
  },
  { name: "Borderlands 3", pattern: /\bBorderlands\s*3\b/i, publisher: "2k" },
  { name: "Borderlands 2", pattern: /\bBorderlands\s*2\b/i, publisher: "2k" },
  { name: "Borderlands", pattern: /\bBorderlands\b/i, publisher: "2k" },
  {
    name: "Civilization VI",
    pattern: /\bCiv(ilization)?\s*(VI|6)\b/i,
    publisher: "2k",
  },
  {
    name: "Civilization VII",
    pattern: /\bCiv(ilization)?\s*(VII|7)\b/i,
    publisher: "2k",
  },
  {
    name: "Civilization",
    pattern: /\bSid Meier'?s Civilization\b|\bCivilization\b/i,
    publisher: "2k",
  },
  { name: "NBA 2K25", pattern: /\bNBA\s*2K\s*25\b/i, publisher: "2k" },
  { name: "NBA 2K", pattern: /\bNBA\s*2K\b/i, publisher: "2k" },
  { name: "WWE 2K25", pattern: /\bWWE\s*2K\s*25\b/i, publisher: "2k" },
  { name: "WWE 2K", pattern: /\bWWE\s*2K\b/i, publisher: "2k" },
  { name: "Mafia", pattern: /\bMafia\b/i, publisher: "2k" },
  { name: "Max Payne 3", pattern: /\bMax Payne\s*3\b/i, publisher: "rockstar" },
  { name: "Max Payne", pattern: /\bMax Payne\b/i, publisher: "rockstar" },
  {
    name: "L.A. Noire",
    pattern: /\bL\.?A\.?\s*Noire\b/i,
    publisher: "rockstar",
  },
  { name: "Bully", pattern: /\bBully\b/i, publisher: "rockstar" },
  { name: "Manhunt", pattern: /\bManhunt\b/i, publisher: "rockstar" },
  {
    name: "Midnight Club",
    pattern: /\bMidnight Club\b/i,
    publisher: "rockstar",
  },
  {
    name: "The Outer Worlds",
    pattern: /\b(The )?Outer Worlds\b/i,
    publisher: "private_division",
  },
  {
    name: "Kerbal Space Program",
    pattern: /\bKerbal Space Program\b|\bKSP\b/i,
    publisher: "private_division",
  },

  // Bethesda
  {
    name: "The Elder Scrolls V Skyrim",
    pattern: /\bSkyrim\b/i,
    publisher: "bethesda",
  },
  {
    name: "The Elder Scrolls VI",
    pattern: /\bElder Scrolls\s*(VI|6)\b/i,
    publisher: "bethesda",
  },
  {
    name: "The Elder Scrolls",
    pattern: /\bElder Scrolls\b/i,
    publisher: "bethesda",
  },
  { name: "Fallout 76", pattern: /\bFallout\s*76\b/i, publisher: "bethesda" },
  { name: "Fallout 4", pattern: /\bFallout\s*4\b/i, publisher: "bethesda" },
  { name: "Fallout", pattern: /\bFallout\b/i, publisher: "bethesda" },
  { name: "Starfield", pattern: /\bStarfield\b/i, publisher: "bethesda" },
  { name: "DOOM Eternal", pattern: /\bDoom Eternal\b/i, publisher: "bethesda" },
  { name: "DOOM", pattern: /\bDOOM\b/i, publisher: "bethesda" },

  // Ubisoft
  {
    name: "Assassin's Creed Shadows",
    pattern: /\bAssassin'?s Creed Shadows\b/i,
    publisher: "ubisoft",
  },
  {
    name: "Assassin's Creed Mirage",
    pattern: /\bAssassin'?s Creed Mirage\b/i,
    publisher: "ubisoft",
  },
  {
    name: "Assassin's Creed Valhalla",
    pattern: /\bAssassin'?s Creed Valhalla\b/i,
    publisher: "ubisoft",
  },
  {
    name: "Assassin's Creed",
    pattern: /\bAssassin'?s Creed\b|\bAC\s+Mirage\b/i,
    publisher: "ubisoft",
  },
  { name: "Far Cry 6", pattern: /\bFar Cry\s*6\b/i, publisher: "ubisoft" },
  { name: "Far Cry", pattern: /\bFar Cry\b/i, publisher: "ubisoft" },
  {
    name: "Watch Dogs Legion",
    pattern: /\bWatch Dogs Legion\b/i,
    publisher: "ubisoft",
  },
  { name: "Watch Dogs", pattern: /\bWatch Dogs\b/i, publisher: "ubisoft" },
  {
    name: "The Crew Motorfest",
    pattern: /\bThe Crew Motorfest\b/i,
    publisher: "ubisoft",
  },
  {
    name: "The Division 2",
    pattern: /\bDivision\s*2\b/i,
    publisher: "ubisoft",
  },
  {
    name: "Rainbow Six Siege",
    pattern: /\bRainbow Six Siege\b|\bR6\s*Siege\b/i,
    publisher: "ubisoft",
  },

  // EA
  {
    name: "FIFA 25",
    pattern: /\bFIFA\s*25\b|\bEA Sports FC 25\b|\bFC\s*25\b/i,
    publisher: "ea",
  },
  { name: "FIFA", pattern: /\bFIFA\b/i, publisher: "ea" },
  { name: "Battlefield 6", pattern: /\bBattlefield\s*6\b/i, publisher: "ea" },
  {
    name: "Battlefield 2042",
    pattern: /\bBattlefield\s*2042\b/i,
    publisher: "ea",
  },
  { name: "Battlefield", pattern: /\bBattlefield\b/i, publisher: "ea" },
  {
    name: "Madden NFL 25",
    pattern: /\bMadden\s*(NFL\s*)?25\b/i,
    publisher: "ea",
  },
  { name: "Madden NFL", pattern: /\bMadden\b/i, publisher: "ea" },
  {
    name: "Apex Legends",
    pattern: /\bApex Legends\b|\bApex\b/i,
    publisher: "ea",
  },
  {
    name: "The Sims 4",
    pattern: /\bThe Sims\s*4\b|\bSims\s*4\b/i,
    publisher: "ea",
  },
  {
    name: "Dragon Age The Veilguard",
    pattern: /\bDragon Age (The )?Veilguard\b/i,
    publisher: "ea",
  },
  { name: "Dragon Age", pattern: /\bDragon Age\b/i, publisher: "ea" },
  { name: "Mass Effect", pattern: /\bMass Effect\b/i, publisher: "ea" },

  // Microsoft / Xbox Studios
  {
    name: "Halo Infinite",
    pattern: /\bHalo Infinite\b/i,
    publisher: "microsoft",
  },
  { name: "Halo", pattern: /\bHalo\b/i, publisher: "microsoft" },
  {
    name: "Forza Horizon 5",
    pattern: /\bForza Horizon\s*5\b/i,
    publisher: "microsoft",
  },
  {
    name: "Forza Motorsport",
    pattern: /\bForza Motorsport\b/i,
    publisher: "microsoft",
  },
  { name: "Forza", pattern: /\bForza\b/i, publisher: "microsoft" },
  {
    name: "Gears of War",
    pattern: /\bGears of War\b|\bGears\s*5\b/i,
    publisher: "microsoft",
  },

  // Sony
  {
    name: "Marvel's Spider-Man 2",
    pattern: /\bSpider-?Man\s*2\b/i,
    publisher: "sony",
  },
  {
    name: "Marvel's Spider-Man",
    pattern: /\bMarvel'?s Spider-?Man\b/i,
    publisher: "sony",
  },
  {
    name: "God of War Ragnarok",
    pattern: /\bGod of War Ragnar(o|ö)k\b/i,
    publisher: "sony",
  },
  { name: "God of War", pattern: /\bGod of War\b/i, publisher: "sony" },
  {
    name: "The Last of Us Part II",
    pattern: /\bLast of Us\s*(Part )?(II|2)\b/i,
    publisher: "sony",
  },
  { name: "The Last of Us", pattern: /\bLast of Us\b/i, publisher: "sony" },
  {
    name: "Horizon Forbidden West",
    pattern: /\bHorizon Forbidden West\b/i,
    publisher: "sony",
  },
  {
    name: "Horizon Zero Dawn",
    pattern: /\bHorizon Zero Dawn\b/i,
    publisher: "sony",
  },
  {
    name: "Ghost of Tsushima",
    pattern: /\bGhost of Tsushima\b/i,
    publisher: "sony",
  },
  {
    name: "Death Stranding",
    pattern: /\bDeath Stranding\b/i,
    publisher: "sony",
  },

  // Nintendo
  {
    name: "The Legend of Zelda Tears of the Kingdom",
    pattern: /\bTears of the Kingdom\b/i,
    publisher: "nintendo",
  },
  {
    name: "The Legend of Zelda Breath of the Wild",
    pattern: /\bBreath of the Wild\b/i,
    publisher: "nintendo",
  },
  {
    name: "The Legend of Zelda",
    pattern: /\bLegend of Zelda\b|\bZelda\b/i,
    publisher: "nintendo",
  },
  {
    name: "Super Mario Wonder",
    pattern: /\bSuper Mario Wonder\b/i,
    publisher: "nintendo",
  },
  { name: "Super Mario", pattern: /\bSuper Mario\b/i, publisher: "nintendo" },
  { name: "Mario Kart", pattern: /\bMario Kart\b/i, publisher: "nintendo" },
  {
    name: "Pokemon Scarlet",
    pattern: /\bPok(é|e)mon Scarlet\b/i,
    publisher: "nintendo",
  },
  {
    name: "Pokemon Violet",
    pattern: /\bPok(é|e)mon Violet\b/i,
    publisher: "nintendo",
  },
  { name: "Pokemon", pattern: /\bPok(é|e)mon\b/i, publisher: "nintendo" },
  {
    name: "Metroid Prime 4",
    pattern: /\bMetroid Prime\s*4\b/i,
    publisher: "nintendo",
  },
  { name: "Metroid", pattern: /\bMetroid\b/i, publisher: "nintendo" },
  { name: "Splatoon 3", pattern: /\bSplatoon\s*3\b/i, publisher: "nintendo" },
  {
    name: "Animal Crossing",
    pattern: /\bAnimal Crossing\b/i,
    publisher: "nintendo",
  },

  // Square Enix
  {
    name: "Final Fantasy 7 Rebirth",
    pattern: /\bFinal Fantasy\s*(7|VII)\s*Rebirth\b/i,
    publisher: "square_enix",
  },
  {
    name: "Final Fantasy 7 Remake",
    pattern: /\bFinal Fantasy\s*(7|VII)\s*Remake\b/i,
    publisher: "square_enix",
  },
  {
    name: "Final Fantasy XVI",
    pattern: /\bFinal Fantasy\s*(XVI|16)\b/i,
    publisher: "square_enix",
  },
  {
    name: "Final Fantasy XIV",
    pattern: /\bFinal Fantasy\s*(XIV|14)\b|\bFFXIV\b|\bFF14\b/i,
    publisher: "square_enix",
  },
  {
    name: "Final Fantasy",
    pattern: /\bFinal Fantasy\b/i,
    publisher: "square_enix",
  },
  {
    name: "Kingdom Hearts",
    pattern: /\bKingdom Hearts\b/i,
    publisher: "square_enix",
  },
  {
    name: "Tomb Raider",
    pattern: /\bTomb Raider\b/i,
    publisher: "square_enix",
  },

  // Activision / Blizzard
  {
    name: "Call of Duty Black Ops 6",
    pattern: /\bCall of Duty\s+Black Ops\s*6\b|\bBO6\b/i,
    publisher: "activision",
  },
  {
    name: "Call of Duty Modern Warfare",
    pattern: /\bModern Warfare\b/i,
    publisher: "activision",
  },
  {
    name: "Call of Duty Warzone",
    pattern: /\bWarzone\b/i,
    publisher: "activision",
  },
  {
    name: "Call of Duty",
    pattern: /\bCall of Duty\b|\bCoD\b/i,
    publisher: "activision",
  },
  { name: "Diablo IV", pattern: /\bDiablo\s*(IV|4)\b/i, publisher: "blizzard" },
  {
    name: "Diablo III",
    pattern: /\bDiablo\s*(III|3)\b/i,
    publisher: "blizzard",
  },
  { name: "Diablo", pattern: /\bDiablo\b/i, publisher: "blizzard" },
  { name: "Overwatch 2", pattern: /\bOverwatch\s*2\b/i, publisher: "blizzard" },
  {
    name: "World of Warcraft",
    pattern: /\bWorld of Warcraft\b|\bWoW\b/i,
    publisher: "blizzard",
  },

  // FromSoftware / Bandai Namco
  {
    name: "Elden Ring Nightreign",
    pattern: /\bElden Ring Nightreign\b/i,
    publisher: "fromsoftware",
  },
  { name: "Elden Ring", pattern: /\bElden Ring\b/i, publisher: "fromsoftware" },
  { name: "Dark Souls", pattern: /\bDark Souls\b/i, publisher: "fromsoftware" },
  { name: "Sekiro", pattern: /\bSekiro\b/i, publisher: "fromsoftware" },
  { name: "Bloodborne", pattern: /\bBloodborne\b/i, publisher: "fromsoftware" },

  // Capcom
  {
    name: "Resident Evil 4",
    pattern: /\bResident Evil\s*(4|IV)\b/i,
    publisher: "capcom",
  },
  {
    name: "Resident Evil Village",
    pattern: /\bResident Evil Village\b/i,
    publisher: "capcom",
  },
  { name: "Resident Evil", pattern: /\bResident Evil\b/i, publisher: "capcom" },
  {
    name: "Monster Hunter Wilds",
    pattern: /\bMonster Hunter Wilds\b/i,
    publisher: "capcom",
  },
  {
    name: "Monster Hunter",
    pattern: /\bMonster Hunter\b/i,
    publisher: "capcom",
  },
  { name: "Devil May Cry", pattern: /\bDevil May Cry\b/i, publisher: "capcom" },
  {
    name: "Street Fighter 6",
    pattern: /\bStreet Fighter\s*6\b/i,
    publisher: "capcom",
  },

  // Sega
  {
    name: "Sonic Frontiers",
    pattern: /\bSonic Frontiers\b/i,
    publisher: "sega",
  },
  { name: "Sonic", pattern: /\bSonic\b/i, publisher: "sega" },
  {
    name: "Like a Dragon",
    pattern: /\bLike a Dragon\b|\bYakuza\b/i,
    publisher: "sega",
  },
  {
    name: "Persona 5 Royal",
    pattern: /\bPersona\s*5 Royal\b/i,
    publisher: "sega",
  },
  { name: "Persona", pattern: /\bPersona\b/i, publisher: "sega" },

  // Massive standalone
  {
    name: "Cyberpunk 2077",
    pattern: /\bCyberpunk 2077\b|\bCyberpunk\b/i,
    publisher: "cdpr",
  },
  { name: "The Witcher 3", pattern: /\bWitcher\s*3\b/i, publisher: "cdpr" },
  { name: "The Witcher", pattern: /\bWitcher\b/i, publisher: "cdpr" },
  { name: "Hogwarts Legacy", pattern: /\bHogwarts Legacy\b/i, publisher: "wb" },
  {
    name: "Mortal Kombat 1",
    pattern: /\bMortal Kombat\s*1\b/i,
    publisher: "wb",
  },
  { name: "Mortal Kombat", pattern: /\bMortal Kombat\b/i, publisher: "wb" },
  {
    name: "Hollow Knight Silksong",
    pattern: /\bSilksong\b/i,
    publisher: "team_cherry",
  },
  {
    name: "Hollow Knight",
    pattern: /\bHollow Knight\b/i,
    publisher: "team_cherry",
  },
  { name: "Hades 2", pattern: /\bHades\s*(2|II)\b/i, publisher: "supergiant" },
  { name: "Hades", pattern: /\bHades\b/i, publisher: "supergiant" },
  {
    name: "Stardew Valley",
    pattern: /\bStardew Valley\b/i,
    publisher: "concernedape",
  },
  { name: "Minecraft", pattern: /\bMinecraft\b/i, publisher: "mojang" },
  { name: "Fortnite", pattern: /\bFortnite\b/i, publisher: "epic" },
  { name: "Valorant", pattern: /\bValorant\b/i, publisher: "riot" },
  {
    name: "League of Legends",
    pattern: /\bLeague of Legends\b|\bLoL\b/i,
    publisher: "riot",
  },
  { name: "Helldivers 2", pattern: /\bHelldivers\s*2\b/i, publisher: "sony" },
  { name: "Helldivers", pattern: /\bHelldivers\b/i, publisher: "sony" },
  {
    name: "Baldur's Gate 3",
    pattern: /\bBaldur'?s Gate\s*3\b/i,
    publisher: "larian",
  },
  {
    name: "Black Myth Wukong",
    pattern: /\bBlack Myth\s*Wukong\b|\bWukong\b/i,
    publisher: "game_science",
  },
  { name: "Hi-Fi Rush", pattern: /\bHi-?Fi Rush\b/i, publisher: "tango" },
  {
    name: "Marvel Rivals",
    pattern: /\bMarvel Rivals\b/i,
    publisher: "netease",
  },
];

/**
 * Extract distinct game titles from a script. Returns an ordered
 * array of canonical game-title strings (deduped, first-mention
 * order preserved). The same script that mentions GTA, Red Dead,
 * and BioShock will return:
 *   ["Grand Theft Auto", "Red Dead Redemption", "BioShock"]
 *
 * Pattern ordering matters: more-specific entries appear before
 * generic franchise entries so "GTA VI" wins over "GTA". After a
 * specific match fires, the franchise entry is skipped.
 *
 * @param {string} script
 * @param {object} [opts]
 * @param {number} [opts.maxTitles] (default MAX_TITLES = 5)
 * @returns {Array<{name: string, publisher: string|null, first_index: number}>}
 */
function extractGameTitles(script, opts = {}) {
  const max = opts.maxTitles || MAX_TITLES;
  if (typeof script !== "string" || script.length === 0) return [];

  const matches = [];
  // Track every index where each game's pattern fired so we can
  // order by first-mention. Also collapse "GTA VI" + "GTA" into the
  // most-specific match — once we've matched a specific title, we
  // suppress the generic franchise entry that would otherwise
  // double-count.
  const matchedAt = new Map(); // canonical name → first match index
  const matchedRegions = []; // [start, end] spans of accepted matches
  for (const entry of GAME_DICTIONARY) {
    const re = new RegExp(
      entry.pattern.source,
      entry.pattern.flags.includes("g")
        ? entry.pattern.flags
        : entry.pattern.flags + "g",
    );
    let m;
    while ((m = re.exec(script)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      // Check if this span overlaps an already-accepted (more-specific)
      // match — if so, skip.
      const overlaps = matchedRegions.some((r) => start < r[1] && end > r[0]);
      if (overlaps) continue;
      if (!matchedAt.has(entry.name)) {
        matchedAt.set(entry.name, start);
        matchedRegions.push([start, end]);
      }
    }
  }

  // Build result, sorted by first-mention index
  const sorted = [...matchedAt.entries()]
    .map(([name, idx]) => {
      const entry = GAME_DICTIONARY.find((e) => e.name === name);
      return {
        name,
        publisher: entry ? entry.publisher || null : null,
        first_index: idx,
      };
    })
    .sort((a, b) => a.first_index - b.first_index);

  return sorted.slice(0, max);
}

/**
 * For one detected game title, fetch Steam screenshots/key art and
 * IGDB cover/screenshots. Returns a structured array of
 * { url, type, source, game_name } that the caller passes through
 * the existing downloadImage helper.
 *
 * Re-uses lib/igdb-images and a tight Steam app-ID search so we
 * don't duplicate the much-bigger Steam fallback in
 * images_download.js — this is a TARGETED enrichment, not a deep
 * search. Caps at MAX_PER_TITLE per game.
 */
async function fetchImageUrlsForTitle(
  gameTitle,
  {
    http = axios,
    env = process.env,
    igdbModule = require("./igdb-images"),
    max = MAX_PER_TITLE,
    randomUA = () => "PulseGamingBot/1.0",
  } = {},
) {
  const out = [];
  if (!gameTitle || typeof gameTitle !== "string") return out;

  // Steam: storesearch is fast, no auth required
  let steamApp = null;
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(
      gameTitle,
    )}&cc=gb&l=english`;
    const res = await http.get(url, {
      timeout: 6000,
      headers: { "User-Agent": randomUA() },
    });
    const items = (res && res.data && res.data.items) || [];
    if (items.length > 0) steamApp = items[0];
  } catch {
    /* Steam search miss is non-fatal; IGDB may still match */
  }

  if (steamApp && steamApp.id) {
    const appId = steamApp.id;
    const steamAppId = String(appId);
    const steamAppTitle = steamApp.name || gameTitle;
    const steamMeta = {
      game_name: steamAppTitle,
      steam_app_id: steamAppId,
      steam_app_title: steamAppTitle,
      steam_matched_query: gameTitle,
      store_app_id: steamAppId,
      store_app_title: steamAppTitle,
      store_matched_query: gameTitle,
    };
    // Direct CDN URLs — no second HTTP call
    out.push({
      url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`,
      type: "capsule",
      source: "steam",
      ...steamMeta,
    });
    if (out.length < max) {
      out.push({
        url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
        type: "hero",
        source: "steam",
        ...steamMeta,
      });
    }
    if (out.length < max) {
      out.push({
        url: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/header.jpg`,
        type: "key_art",
        source: "steam",
        ...steamMeta,
      });
    }
  }

  // IGDB fallback for games not on Steam (PS/Xbox/Nintendo
  // exclusives, indie, retro)
  if (out.length < max && env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET) {
    try {
      const igdb =
        igdbModule && typeof igdbModule.fetchIgdbImages === "function"
          ? await igdbModule.fetchIgdbImages(gameTitle, {
              http,
              env,
              max: max - out.length,
            })
          : [];
      for (const img of igdb || []) {
        if (out.length >= max) break;
        out.push({
          url: img.url,
          type: img.type || "screenshot",
          source: "igdb",
          game_name: img.game_name || gameTitle,
          igdb_id: img.igdb_id || null,
          igdb_title: img.igdb_title || img.game_name || gameTitle,
          igdb_slug: img.igdb_slug || null,
          igdb_matched_query: img.igdb_matched_query || gameTitle,
          store_app_id: img.igdb_id || null,
          store_app_title: img.igdb_title || img.game_name || gameTitle,
          store_app_slug: img.igdb_slug || null,
          store_matched_query: img.igdb_matched_query || gameTitle,
        });
      }
    } catch {
      /* IGDB miss is non-fatal */
    }
  }

  return out;
}

/**
 * Top-level enrichment for a story. Given the story (with a script)
 * and the existing image set, returns ADDITIONAL image URLs to
 * download. The caller (images_download.js) is responsible for
 * actually downloading + persisting them.
 *
 * @param {object} story  must have full_script or tts_script
 * @param {object} [opts]
 *   - existingSources Set<string> of source_type strings already in
 *     the image deck (e.g. "steam", "igdb"). Lets us prioritise
 *     enrichment for stories whose only images are article scrape /
 *     stock.
 *   - http, env, igdbModule, randomUA — for testability
 *   - maxTitles, maxPerTitle — caps
 *
 * Returns {
 *   titles: [{ name, publisher, first_index }],
 *   image_urls: [{ url, type, source, game_name }]
 * }
 */
async function enrichImagesFromScript(story, opts = {}) {
  const out = { titles: [], image_urls: [] };
  if (!story) return out;
  const script = story.full_script || story.tts_script || "";
  if (!script) return out;

  const titles = extractGameTitles(script, {
    maxTitles: opts.maxTitles || MAX_TITLES,
  });
  if (titles.length === 0) return out;
  out.titles = titles;

  const maxPerTitle = opts.maxPerTitle || MAX_PER_TITLE;
  for (const title of titles) {
    const urls = await fetchImageUrlsForTitle(title.name, {
      http: opts.http,
      env: opts.env,
      igdbModule: opts.igdbModule,
      max: maxPerTitle,
      randomUA: opts.randomUA,
    });
    for (const u of urls) {
      out.image_urls.push({
        ...u,
        _entity: title.name,
        _publisher: title.publisher,
      });
    }
  }
  return out;
}

module.exports = {
  extractGameTitles,
  fetchImageUrlsForTitle,
  enrichImagesFromScript,
  GAME_DICTIONARY,
  MAX_TITLES,
  MAX_PER_TITLE,
};
