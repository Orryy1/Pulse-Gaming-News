"use strict";

const {
  countSpokenWords,
  secondsPerWordForTtsProvider,
} = require("./services/short-runtime-planner");
const { inferHeadlineGameCandidates } = require("./game-title-inference");

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";

function decodeMojibakeText(value) {
  return String(value || "")
    .replace(/&\s*#?\s*8217;?/g, "'")
    .replace(/&\s*#?\s*8216;?/g, "'")
    .replace(/&\s*#?\s*8220;?/g, '"')
    .replace(/&\s*#?\s*8221;?/g, '"')
    .replace(/&\s*#?\s*8211;?|&\s*#?\s*8212;?/g, "-")
    .replace(/&\s*(\d{4})\b;?/g, (_, code) => {
      const map = {
        8216: "'",
        8217: "'",
        8220: '"',
        8221: '"',
        8211: "-",
        8212: "-",
      };
      return map[code] || `&#${code};`;
    })
    .replace(/â€“|â€”/g, "-")
    .replace(/â€˜|â€™/g, "'")
    .replace(/â€œ|â€/g, '"')
    .replace(/PokÃ©mon/g, "Pokemon");
}

function normaliseText(value) {
  value = decodeMojibakeText(value);
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceText(story = {}, sourceMaterial = "") {
  return [
    story.title,
    story.original_title,
    story.source_title,
    story.article_title,
    sourceMaterial,
  ]
    .filter(Boolean)
    .join(" ");
}

function sourceNameFromOptions(options = {}) {
  const raw = normaliseText(options.sourceName);
  if (!raw) return "the source";
  const known = new Map([
    ["PCGamer", "PC Gamer"],
    ["PCGamesN", "PCGamesN"],
    ["GamesRadar", "GamesRadar"],
    ["GameSpot", "GameSpot"],
    ["Xbox", "Xbox Wire"],
  ]);
  return known.get(raw) || raw;
}

function stripGeneratedAngleSuffixes(value = "") {
  return normaliseText(value)
    .replace(/(?:\s+Needs One Real Proof Point)+$/i, "")
    .trim();
}

function expandedCanonicalSubjectFromHeadline(story = {}, canonicalSubject = "") {
  const canonical = stripGeneratedAngleSuffixes(canonicalSubject);
  if (!canonical || canonical.includes(":")) return "";
  const headline = normaliseText([
    story.source_title,
    story.article_title,
    story.original_title,
    story.title,
  ].filter(Boolean).join(" | "));
  if (!headline) return "";
  const escaped = canonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = headline.match(new RegExp(`\\b${escaped}\\s*:\\s*([^|]+)`, "i"));
  if (!match) return "";
  const suffix = normaliseText(match[1])
    .split(
      /\s+(?=(?:on|for|gets?|has|launches?|reveals?|announces?|adds?|updates?|arrives?|comes?|is|will|could|just|with|at|from|shows?|turns?|makes?|needs?|puts?|scores?)\b)/i,
    )[0]
    .replace(/\s*[-,]\s*.*$/, "")
    .trim();
  if (!suffix || suffix.split(/\s+/).length > 6) return "";
  return `${canonical}: ${suffix}`;
}

function detectGameTitle(story = {}, sourceMaterial = "") {
  const canonicalSubject = stripGeneratedAngleSuffixes(
    story.canonical_subject || story.canonical_game || "",
  );
  const expandedCanonicalSubject = expandedCanonicalSubjectFromHeadline(
    story,
    canonicalSubject,
  );
  if (expandedCanonicalSubject) return expandedCanonicalSubject;
  if (
    canonicalSubject &&
    !/^(?:this game|game|gaming|update|news|source)$/i.test(canonicalSubject) &&
    canonicalSubject.split(/\s+/).length <= 10
  ) {
    return canonicalSubject;
  }
  const text = normaliseText(sourceText(story, sourceMaterial));
  if (/\bLords of the Fallen\s*2\b/i.test(text)) return "Lords of the Fallen 2";
  if (/\b(?:GTA\s*5|Grand Theft Auto V)\b/i.test(text)) return "GTA 5";
  if (/\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(text)) return "GTA 6";
  if (/\bCall of Duty:\s*Black Ops\s*(?:1|I)\s*(?:and|&)\s*(?:2|II)\b/i.test(text)) return "Black Ops 1 and 2";
  if (/\bBlack Ops\s*(?:1|I)\s*(?:and|&)\s*(?:2|II)\b/i.test(text)) return "Black Ops 1 and 2";
  if (/\b(?:Assassin['\u2019]?s Creed\s+)?Black Flag Resynced\b/i.test(text)) {
    return "Black Flag Resynced";
  }
  if (/\bCyberpunk\s*2077\b/i.test(text)) return "Cyberpunk 2077";
  if (/\b(?:The Legend of Zelda:\s*)?Ocarina of Time\b/i.test(text)) return "Ocarina of Time";
  if (/\bMarvel['\u2019]?s Wolverine\b/i.test(text)) return "Marvel's Wolverine";
  if (/\bHellraiser:\s*Revival\b/i.test(text)) return "Hellraiser: Revival";
  if (/\bGranblue Fantasy(?::\s*Relink)?\b/i.test(text)) return "Granblue Fantasy";
  if (/\bGUILTY\s+GEAR\s*[-:]?\s*STRIVE\b/i.test(text)) return "GUILTY GEAR -STRIVE-";
  if (/\bThe Adventures of Elliot\b/i.test(text)) return "The Adventures of Elliot";
  if (/\bDave the Diver\b/i.test(text)) return "Dave the Diver";
  if (/\bFree Play Days\b/i.test(text)) return "Free Play Days";
  const known = text.match(
    /\b(?:Forza Horizon 6|Subnautica 2|Destiny 2|Helldivers 2|Valorant|GTA 6|GTA VI|Nintendo Switch 2|Resident Evil Requiem|Pokemon Pokopia|Pokémon Pokopia)\b/i,
  );
  if (known) return known[0].replace(/^GTA VI$/i, "GTA 6");

  const cleanedHeadline = stripGeneratedAngleSuffixes(
    story.title || story.article_title || "",
  );
  const inferred = inferHeadlineGameCandidates(cleanedHeadline);
  if (inferred.length > 0) return inferred[0];

  const title = stripGeneratedAngleSuffixes(story.title).replace(/\s+-\s+.*$/g, "");
  const subject = title
    .replace(/\s+(?:will|won't|wont|becomes|became|hits?|reaches?|crosses?|gets?|confirms?|announces?|reveals?|launches?|delays?|immediately)\b.*$/i, "")
    .trim();
  return subject || "This game";
}

function extractFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = String(text || "").match(pattern);
    if (match) return match[1] || match[0];
  }
  return null;
}

function joinReadableList(items = []) {
  const rows = items.filter(Boolean);
  if (rows.length <= 1) return rows[0] || "";
  if (rows.length === 2) return `${rows[0]} and ${rows[1]}`;
  return `${rows.slice(0, -1).join(", ")} and ${rows[rows.length - 1]}`;
}

function extractFacts(story = {}, sourceMaterial = "") {
  const text = normaliseText(sourceText(story, sourceMaterial));
  const score = extractFirst(text, [
    /\b(?:score|aggregate)\s+of\s+(\d{2,3})\b/i,
    /\b(\d{2,3})\s+(?:aggregate|Metacritic|critic score)\b/i,
    /\bMetacritic(?:'s)?[^.]{0,80}\b(\d{2,3})\b/i,
  ]);
  const competitorScore = extractFirst(text, [
    /\b(?:Pokemon|Pokémon)\s+Pokopia[^.]{0,80}?(?:at|sits at|score of)\s+(\d{2,3})\b/i,
    /\bahead of (?:Pokemon|Pokémon)\s+Pokopia\s+at\s+(\d{2,3})\b/i,
  ]);
  const steamPeak = extractFirst(text, [
    /\b(\d{1,3}(?:,\d{3})+)\s+concurrent\s+(?:users|players)\b/i,
    /\bpeak\s+of\s+(\d{1,3}(?:,\d{3})+)\b/i,
  ]);
  const price = extractFirst(text, [/\$(\d{2,4})\b/i]);
  const launchDate = extractFirst(text, [
    /\b(?:scheduled for|launches?|launch)\s+(?:on\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)\b/i,
    /\b(?:scheduled for|launches?|launch|releases?|release date)\b[^.]{0,140}?\bon\s+(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,\s*\d{4})?)\b/i,
    /\b(?:update|version\s+\d{1,3}(?:\.\d{1,3})+|full release|comes? to|available through|available on|Game Pass)\b[^.]{0,100}?\bon\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?)\b/i,
    /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,\s*\d{4})?)\b/i,
  ]);
  const version = extractFirst(text, [
    /\b(?:system update|firmware|version|update)\s+(\d{1,3}(?:\.\d{1,3})+)\b/i,
    /\b(\d{1,3}(?:\.\d{1,3})+)\b/i,
  ]);
  const subscriptionService = extractFirst(text, [
    /\b(EA Play|Game Pass|PlayStation Plus|PS Plus|Ubisoft\+|GTA\+|Netflix|Prime Gaming)\b/i,
  ]);
  const hasSteamPerformance =
    Boolean(steamPeak) ||
    /\b(?:SteamDB|concurrent|Premium Edition|early[-\s]?access|Steam peak|Steam players?|all-time peak)\b/i.test(text);
  const hasCoverArt =
    /\b(?:cover art|box art|key art|official art|artwork)\b/i.test(text);
  const hasPreorder =
    /\b(?:pre[-\s]?order|preorders|store listing|store page|edition|editions|pricing)\b/i.test(text);
  const hasTrailer =
    /\b(?:trailer|gameplay trailer|reveal trailer|launch trailer|showcase video|YouTube)\b/i.test(text);
  const hasGameplay =
    /\b(?:gameplay|hands[-\s]?on|demo|played|combat|racing|drifting|track|tracks|mission|co[-\s]?op|boss|map|mode)\b/i.test(text);
  const hasGameplayFootage =
    hasGameplay &&
    /\b(?:gameplay footage|new gameplay|first[-\s]?person gameplay|gameplay preview|preview footage|closer look|footage)\b/i.test(
      text,
    );
  const hasHandsOnDemo =
    /\b(?:hands[-\s]?on|demo available|playable demo|press event|had the chance to experience|played)\b/i.test(text) &&
    /\b(?:demo|hands[-\s]?on|expansion|combat|action RPG|launch)\b/i.test(text);
  const demoAvailableToday =
    hasHandsOnDemo && /\b(?:demo available today|playable demo available today|available today|out today|available now)\b/i.test(text);
  const hasExplorationCombatPreview =
    /\bThe Adventures of Elliot\b/i.test(text) &&
    /\b(?:exploration|combat|discovery|RPG|pace|loop)\b/i.test(text);
  const hasDlcAvailableNow =
    /\bDLC\b/i.test(text) &&
    /\b(?:available today|out today|available now|launches today|released today|new DLC)\b/i.test(text);
  const hasFreePlayDays =
    /\bFree Play Days\b/i.test(text) &&
    /\b(?:PGA Tour 2K25|Two Point Museum|Assetto Corsa|Dead by Daylight|weekend|trial|limited)\b/i.test(text);
  const freePlayGames = [
    "PGA Tour 2K25",
    "Two Point Museum",
    "Assetto Corsa",
    "Dead by Daylight",
  ].filter((game) => new RegExp(`\\b${game.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
  const hasPatchNotes =
    /\b(?:system update|firmware|patch notes|version\s+\d|update\s+\d{1,3}(?:\.\d{1,3})+|hotfix|stability update)\b/i.test(
      text,
    );
  const hasPs5ProPssrUpgrade =
    /\bPSSR\b/i.test(text) &&
    /\bPS5 Pro\b/i.test(text) &&
    /\b(?:sharper|image quality|temporal stability|frame rates?|4K|performance)\b/i.test(text);
  const hasFreeCarsUpdate =
    /\bForza Horizon\s*6\b/i.test(text) &&
    /\b(?:free cars?|car pack|cars? confirmed|Horizon Playlist|Horizon Decades|Series\s*\d+|festival playlist)\b/i.test(
      text,
    );
  const hasVotingSignal =
    /\b(?:Players'? Choice|player'?s choice|vote|voting|poll|pick from|choose from)\b/i.test(text);
  const liveServiceWindow = extractFirst(text, [
    /\b((?:June|July|August|September|October|November|December|January|February|March|April|May)\s+\d{1,2}\s+to\s+(?:June|July|August|September|October|November|December|January|February|March|April|May)\s+\d{1,2})\b/i,
    /\b(\d{1,2}\s+(?:June|July|August|September|October|November|December|January|February|March|April|May)\s+to\s+\d{1,2}\s+(?:June|July|August|September|October|November|December|January|February|March|April|May))\b/i,
  ]);
  const namedCharacters = [
    ...new Set((text.match(/\b(?:Jason|Lucia)\b/g) || []).map((item) => item.trim())),
  ];
  const fightingGameCharacter = extractFirst(text, [
    /\b(Robo[-\s]?Ky)\b/i,
    /\b(Yasmine|Yasmin|Mai|Elena|Sagat|Viper|Akuma|Luke|Ryu|Ken|Chun[-\s]?Li|Cammy|Juri|Kimberly)\b/i,
  ]);
  return {
    gameTitle: detectGameTitle(story, sourceMaterial),
    hasMetacritic: /\b(?:Metacritic|critic|critics|review|reviews|rated|rating|score|scores)\b/i.test(text),
    hasSteam: hasSteamPerformance,
    hasSteamPlatform: /\bSteam\b/i.test(text),
    hasSteamPerformance,
    hasXbox: /\bXbox|Game Pass|Microsoft\b/i.test(text) || /Forza Horizon/i.test(text),
    hasMusicLicencePreservation:
      /\b(?:music|soundtrack|licensed)\b/i.test(text) &&
      /\b(?:licen[cs]e|delist|perpetuity|rights expire|paid extra)\b/i.test(text),
    hasHorrorFraming:
      /\b(?:Hellraiser|Resident Evil|Silent Hill|horror|survival[-\s]?horror|Alien|jump scares?|scares?|enemy threat)\b/i.test(
        text,
      ),
    hasBungieLayoffShift:
      /\bDestiny 2\b/i.test(text) &&
      /\bBungie\b/i.test(text) &&
      /\b(?:plans?\s+layoffs?|layoffs?|job cuts?|cuts jobs?|staff cuts?)\b/i.test(text),
    hasLiveServiceDevelopmentShift:
      /\bDestiny 2\b/i.test(text) &&
      /\bBungie\b/i.test(text) &&
      /\b(?:didn['’]?t know|did not know|only learned|announcement went public|almost all)\b/i.test(text) &&
      /\b(?:ending active development|active development was ending|final content update|final update|walks away)\b/i.test(
        text,
      ),
    hasBlackFlagResyncedMonetisationBacklash:
      /\b(?:Assassin['\u2019]?s Creed\s+)?Black Flag Resynced\b/i.test(text) &&
      /\b(?:microtransactions?|paid DLC|DLC furore|negative Steam reviews?|standard edition|full complete experience)\b/i.test(text),
    hasBlackFlagResyncedSalesMilestone:
      /\b(?:Assassin['\u2019]?s Creed\s+)?Black Flag Resynced\b/i.test(text) &&
      /\b(?:3\s*million|three\s+million|copies sold|sold more than)\b/i.test(text) &&
      /\b(?:one week|in a week|day one|first day)\b/i.test(text),
    hasBethesdaUnionResponse:
      /\bBethesda\b/i.test(text) &&
      /\b(?:union|workers?|staff)\b/i.test(text) &&
      /\b(?:protest|solidarity|layoffs?|job cuts?)\b/i.test(text),
    hasBethesdaLayoffRoadmapRisk:
      /\bBethesda\b/i.test(text) &&
      /\b(?:layoffs?|job cuts?|staff cuts?)\b/i.test(text) &&
      /\b(?:Fallout\s*5|The Elder Scrolls\s*6|Elder Scrolls\s*6|Blade|games? pipeline|future games?)\b/i.test(text),
    hasVanguardAntiCheatControl:
      /\bValorant\b/i.test(text) &&
      /\bVanguard\b/i.test(text) &&
      /\b(?:anti[-\s]?cheat|DMA|bricking?|cheat hardware|kernel[-\s]?level|paperweights?)\b/i.test(text),
    hasHaloPs5AccountRequirement:
      /\bHalo(?::\s*Campaign Evolved)?\b/i.test(text) &&
      /\bPS5|PlayStation\s*5\b/i.test(text) &&
      /\b(?:Xbox account|gamertag)\b/i.test(text) &&
      /\b(?:PS Plus|split[-\s]?screen|co[-\s]?op)\b/i.test(text),
    hasXboxMonetisationPressure:
      /\bXbox\b/i.test(text) &&
      /\b(?:moneti[sz]ed enough|videogames are not monetised enough|videogames aren't monetised enough)\b/i.test(
        text,
      ) &&
      /\b(?:layoffs?|cancelled games?|68\.7\s*billion|AI spending|acquisition)\b/i.test(text),
    hasXboxDashboardExclusivityLabel:
      /\bXbox\b/i.test(text) &&
      /\b(?:EXCLUSIVE label|exclusive label|dashboard)\b/i.test(text) &&
      /\b(?:exclusivity|exclusive|criteria|counts as an Xbox exclusive)\b/i.test(text),
    hasSubscriptionAccess:
      /\b(?:joins?|joined|added to|available through|available on|coming to|now on|is now on|included with|hits?)\b[^.]{0,60}\b(?:Game Pass|PlayStation Plus|PS Plus|EA Play|Ubisoft\+|GTA\+|Netflix|Prime Gaming|subscription)\b/i.test(
        text,
      ) ||
      /\b(?:Game Pass|PlayStation Plus|PS Plus|EA Play|Ubisoft\+|GTA\+|Netflix|Prime Gaming|subscription)\s+update\b/i.test(text) ||
      /\b(?:update|version\s+\d{1,3}(?:\.\d{1,3})+|full release|1\.0)\b[^.]{0,80}\b(?:Game Pass|PlayStation Plus|PS Plus|EA Play|Ubisoft\+|GTA\+|Netflix|Prime Gaming|subscription)\b/i.test(text) ||
      /\bjoins?\s+a\s+subscription\b/i.test(text),
    hasGta5SubscriptionRunway:
      /\b(?:GTA\s*5|Grand Theft Auto V)\b/i.test(text) &&
      /\b(?:subscription|Game Pass|PlayStation Plus|PS Plus|GTA\+|joins?\s+a\s+subscription)\b/i.test(text) &&
      /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(text),
    hasGta5CurrentGenFreeUpgrade:
      /\b(?:GTA\s*5|Grand Theft Auto V)\b/i.test(text) &&
      /\bfree\s+upgrades?\b/i.test(text) &&
      /\b(?:PS5|PlayStation\s*5|Xbox Series X\/S|Xbox Series X|Xbox Series S)\b/i.test(text),
    hasGta6PreorderLaunch:
      /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(text) &&
      /\bpre[-\s]?orders?\b/i.test(text) &&
      /\b(?:confirmed|launch|starts?|June\s*25|editions?|bonuses?|price)\b/i.test(text),
    hasGta6LaunchEndgame:
      /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(text) &&
      /\bRockstar\b/i.test(text) &&
      /\b(?:end\s*game|endgame|launching|launch|delay|stop worrying|worried)\b/i.test(text),
    hasGta6AvoidanceDelay:
      /\bLords of the Fallen\s*2\b/i.test(text) &&
      /\b(?:delay|delayed|pushed|moved)\b/i.test(text) &&
      /\b(?:avoid|avoiding|dodge|dodges|away from)\b/i.test(text) &&
      /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI|Rockstar)\b/i.test(text),
    hasBlackOpsPortPricing:
      /\b(?:Call of Duty:\s*)?Black Ops\s*(?:1|I)\s*(?:and|&)\s*(?:2|II)\b/i.test(text) &&
      /\b(?:PlayStation|PS4|PS5|store listings?|ports?|pricey|pricing|price)\b/i.test(text),
    hasPhysicalReleaseBacklash:
      /\b(?:physical disc|physical release|disc release|physical edition|physical copy|on disc)\b/i.test(
        text,
      ) &&
      /\b(?:backlash|comments?|requests?|asking|digital[-\s]?only|ownership|retail format)\b/i.test(
        text,
      ),
    hasCyberpunkTrustDebt:
      /\b(?:CD Projekt Red|CDPR)\b/i.test(text) &&
      /\bCyberpunk\s*2077\b/i.test(text) &&
      /\b(?:lost the faith|lost faith|burned|disastrous launch|trust)\b/i.test(text),
    hasXboxFounderSkepticism:
      /\bXbox\b/i.test(text) &&
      /\b(?:founding|founder|original|early)\b/i.test(text) &&
      /\b(?:skepticisms?|coming true|25 years later|twenty-five years later)\b/i.test(text),
    hasOcarinaDirectDemandSignal:
      /\bOcarina of Time\b/i.test(text) &&
      /\b(?:Nintendo Direct|Summer Game Fest|most[-\s]?watched|most[-\s]?viewed|trailer)\b/i.test(text),
    hasHiddenOcarinaDescriptionRemoval:
      /\bOcarina of Time\b/i.test(text) &&
      /\bhidden description\b/i.test(text) &&
      /\b(?:removed|removes|pulled)\b/i.test(text) &&
      /\bSwitch\s*2\b/i.test(text),
    hasCoverArt,
    hasPreorder,
    hasTrailer,
    hasFightingGameCharacterTrailer:
      hasTrailer &&
      (/\b(?:GUILTY\s+GEAR|Street Fighter|Tekken|Mortal Kombat|King of Fighters|Fatal Fury|2XKO)\b/i.test(text) ||
        Boolean(fightingGameCharacter)),
    fightingGameCharacter,
    hasGameplay,
    hasGameplayFootage,
    hasHandsOnDemo,
    demoAvailableToday,
    hasExplorationCombatPreview,
    hasDlcAvailableNow,
    hasFreePlayDays,
    freePlayGames,
    hasTrailerGameplay: (hasTrailer || hasGameplayFootage) && hasGameplay,
    hasPs5ProPssrUpgrade,
    hasPatchNotes,
    hasFreeCarsUpdate,
    hasVotingSignal,
    liveServiceWindow,
    namedCharacters,
    hasPlayStationPlatforms: /\b(?:PS5|PlayStation\s*5)\b/i.test(text) && /\b(?:PS4|PlayStation\s*4)\b/i.test(text),
    hasPrice: Boolean(price),
    hasEarlyAccess: /\bearly[-\s]?access|Premium Edition\b/i.test(text),
    hasLaunchDate: Boolean(launchDate) || /\brelease date\b/i.test(text),
    score,
    competitorScore,
    steamPeak,
    price: price ? `$${price}` : null,
    launchDate,
    subscriptionService,
    version,
  };
}

function buildHandsOnDemoAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const datePhrase = facts.launchDate ? ` before its ${facts.launchDate} launch` : " before launch";
  const availabilityPhrase = facts.demoAvailableToday ? " is available today" : " is playable";
  const platformPhrase = facts.hasPlayStationPlatforms ? " on PS5 and PS4" : "";
  return {
    lane: "hands_on_demo",
    hook: `${game} just put its comeback in players' hands.`,
    sourceLine:
      `${sourceName} reports ${game}'s demo${availabilityPhrase}${platformPhrase}${datePhrase}, so players can judge the expansion by feel instead of preview hype.`,
    tension:
      "That matters because a preview can praise combat all day, but a demo lets players feel animation weight, camera pressure and whether the loop still clicks.",
    stakes:
      "For a returning action RPG, the new content has to feel worth reinstalling for, not just remind people why they drifted away.",
    caveat:
      "A demo can prove feel and pace, but it cannot prove the full expansion holds up for every boss, build or endgame grind.",
    viewerValue:
      "Try the slice for combat feel first, then decide whether the full launch deserves your time.",
    payoff:
      `If the demo sells the controller feel, ${game} has a real comeback case instead of just another expansion listing.`,
    thumbnailText: "DEMO TEST",
    title: `${game} Demo Puts Combat In Your Hands`.slice(0, 60),
  };
}

function buildExplorationCombatPreviewAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "exploration_combat_preview",
    hook: `${game} now has to prove its old-school RPG loop is more than nostalgia.`,
    sourceLine:
      `${sourceName} reports the preview is being framed around exploration, combat and discovery, which is exactly where throwback RPGs either sing or stall.`,
    tension:
      "That matters because charm gets attention, but pacing keeps people playing once the map opens and the same combat rhythm starts repeating.",
    stakes:
      "Players need to know whether discovery keeps pulling them forward or whether the adventure turns into pretty screens wrapped around slow chores.",
    caveat:
      "A preview cannot prove the whole journey yet, and it should not pretend a few systems answer every pacing question.",
    viewerValue:
      "Players need exploration, fights and rewards to feed each other quickly enough to survive a crowded release calendar.",
    payoff:
      "If that loop feels sharp, the game has a real identity; if not, nostalgia will not carry it alone.",
    thumbnailText: "RPG LOOP TEST",
    title: `${game} RPG Loop Test`.slice(0, 60),
  };
}

function buildDlcAvailableNowAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "dlc_available_now",
    hook: `${game} just gave lapsed players a reason to come back today.`,
    sourceLine:
      `${sourceName} reports ${game}'s new jungle DLC is available today, adding a fresh biome and new reasons to dive back in.`,
    tension:
      "That matters because DLC is not only about more content; it is a test of whether a finished game can make people reinstall without feeling like homework.",
    stakes:
      "The jungle pitch has to do more than change the background, because returning players need new creatures, new surprises and a loop that feels worth the time.",
    caveat:
      "A new zone can look charming and still fade quickly if the objectives feel like the same old checklist.",
    viewerValue:
      "Players are choosing between a proper comeback run and a quick curiosity download.",
    payoff:
      `If the jungle changes the rhythm enough, ${game} gets the rare DLC win: a real reason to return after the credits.`,
    thumbnailText: "JUNGLE COMEBACK",
    title: `${game} Jungle Comeback`.slice(0, 60),
  };
}

function buildFreePlayDaysAngle(facts, sourceName) {
  const games = facts.freePlayGames.length
    ? joinReadableList(facts.freePlayGames)
    : "PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight";
  return {
    lane: "free_play_days",
    hook: "Free Play Days just turned this weekend into a four-way download choice.",
    sourceLine:
      `${sourceName} reports Xbox's latest Free Play Days trial includes ${games} for a limited weekend window.`,
    tension:
      "Free sounds good, but the harder choice is which download is actually worth spending your weekend on.",
    stakes:
      "The list splits four very different moods: sport, management, racing and horror, so the win is finding the one that survives more than ten curious minutes.",
    caveat:
      "Limited trials can turn into noise fast if players install everything and finish nothing.",
    viewerValue:
      "Pick one game, test the first hour and only buy if the loop earns the rest of the weekend.",
    payoff:
      "If even one trial sticks, this becomes a no-risk discovery week instead of another store carousel you scroll past.",
    thumbnailText: "FREE WEEKEND",
    title: "Free Play Days Pick".slice(0, 60),
  };
}

function buildStoreSignalAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const publisherPhrase = /\b(?:GTA\s*6|Grand Theft Auto VI)\b/i.test(game)
    ? `Rockstar revealed new ${game} key art`
    : `new ${game} key art appeared`;
  const characterPhrase = facts.namedCharacters.length
    ? `, with ${facts.namedCharacters.join(" and ")} now front and centre`
    : "";
  const salesPhrase = facts.hasPreorder
    ? "while preorders still have no confirmed start date"
    : "while players wait for the next store-page detail";
  return {
    lane: "store_signal",
    hook: `${game} just turned cover art into a preorder watch.`,
    sourceLine:
      `${sourceName} reports ${publisherPhrase} on YouTube${characterPhrase} ${salesPhrase}.`,
    tension:
      "That matters because cover art is usually the last quiet step before store pages, editions and pricing start moving.",
    stakes:
      "Preorder pages also reveal more than price; they tell players which editions, bonuses and platforms the publisher wants to push first.",
    caveat:
      "Art is not a release-date change, and it does not prove new gameplay is coming today.",
    payoff:
      `If the next store update lands, ${game} stops being a trailer wait and becomes a money decision.`,
    viewerValue:
      "The image is real, the sales details are still missing and every store update now matters.",
    thumbnailText: "PREORDER WATCH",
    title: `${game} Preorder Watch`.slice(0, 60),
  };
}

function buildGta6PreorderLaunchAngle(facts, sourceName) {
  const datePhrase = facts.launchDate || "June 25";
  return {
    lane: "gta6_preorder_launch",
    hook: "GTA 6 preorders just became a real buying decision.",
    sourceLine:
      `${sourceName} reports Rockstar has confirmed GTA 6 preorders launch on ${datePhrase}, while players still wait for editions, bonuses and price details.`,
    tension:
      "That matters because the preorder page is where hype becomes a wallet choice, not just another trailer conversation.",
    stakes:
      "The first store details can reveal which platforms Rockstar is pushing hardest, what extras are being used to tempt early buyers and how much the preorder premium version costs.",
    caveat:
      "A preorder date does not prove new gameplay is coming that day, and it does not mean every version will be worth buying.",
    viewerValue:
      "Separate the confirmed preorder timing from the missing price details, bonus details and platform details before locking money in.",
    payoff:
      "If the store page lands cleanly, GTA 6 finally shifts from anticipation into the first real buy, wait or skip argument.",
    thumbnailText: "PREORDERS LIVE",
    title: "GTA 6's Preorder Decision",
  };
}

function buildGameplayTrailerAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const isRacer = /\b(?:kart|racing|drift|drifting|track|tracks)\b/i.test(game);
  const sourceClipNoun = facts.hasTrailer ? "trailer" : "gameplay footage";
  return {
    lane: "trailer_gameplay",
    hook: isRacer
      ? `${game} just showed the part a kart racer cannot fake: speed.`
      : `${game} just showed the part trailers usually hide: how it plays.`,
    sourceLine: isRacer
      ? `${sourceName} reports the new ${game} ${sourceClipNoun} shows racing, drifting and track variety before launch.`
      : `${sourceName} reports the new ${game} ${sourceClipNoun} shows real gameplay, not just another logo beat.`,
    tension: isRacer
      ? "That matters because a funny licence only works if cornering, track flow and item chaos look readable on the first lap."
      : "That matters because players can judge movement, combat and camera weight instead of guessing from a cinematic cut.",
    stakes: isRacer
      ? "Players now have a cleaner way to decide whether this is an actual party racer or just a joke listing with a mascot."
      : "Players now have a cleaner way to decide whether the pitch survives contact with the controller.",
    caveat: isRacer
      ? "The trailer still does not prove online stability, final handling or how quickly the joke wears off."
      : "The trailer still does not prove performance, mission design or whether the best moments are only in the cut.",
    payoff: isRacer
      ? `If the drifting looks responsive, ${game} becomes a real cheap-racer argument instead of a meme listing.`
      : `If the controls match the footage, ${game} moves from trailer curiosity into something players can judge properly.`,
    viewerValue: isRacer
      ? "For players, every clip needs speed, readable corners and tracks that look fun twice."
      : "The blunt test is this: does the gameplay stay fun after the first minute?",
    thumbnailText: isRacer ? "REAL SPEED TEST" : "GAMEPLAY CHECK",
    title: isRacer ? `${game} Speed Test`.slice(0, 60) : `${game} Gameplay Check`.slice(0, 60),
  };
}

function buildFightingGameCharacterTrailerAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const character = facts.fightingGameCharacter || "the new fighter";
  return {
    lane: "fighting_game_character_trailer",
    hook: `${character} just made ${game}'s next roster argument very direct.`,
    sourceLine:
      `${sourceName} carries the new ${character} trailer, and the useful part is not nostalgia; it is what the character might do to matchups.`,
    tension:
      "That matters because fighting-game reveals are not just about who gets cheered on stage. They change lab time, mains, counter-picks and what ranked players have to learn before the patch lands.",
    stakes:
      "If the trailer shows strange movement, awkward pressure or unusual resource tricks, the character becomes homework instead of a cameo.",
    caveat:
      "A trailer cannot prove frame data, tournament strength or balance by itself, so the hype still needs a playable build.",
    viewerValue:
      "The clean question is whether this looks fun to fight with and annoying to fight against.",
    payoff:
      `If ${character} has real tools, ${game} gets a roster shake-up; if not, this is just fan-service with a metal face.`,
    thumbnailText: "ROSTER PANIC",
    title: `${character} Raises ${game}'s Roster Stakes`.slice(0, 60),
  };
}

function buildPatchNotesAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "patch_notes",
    hook: `${game} just got a boring-looking update with a warning players should not miss.`,
    sourceLine:
      `${sourceName} reports system update ${facts.version || ""}`.replace(/\s+$/, "") +
      " is live, and the patch notes tell players what changed before they download it.",
    tension:
      "That matters because console updates become interesting when they touch saves, performance, online play or controller reliability.",
    stakes:
      "Version numbers sound dry, but they become real fast when a download blocks a game session or fixes a bug players already hit.",
    caveat:
      "This is not a new game reveal; it is housekeeping.",
    payoff:
      `If the patch keeps systems smoother before the next big release, it becomes the kind of invisible fix players tend to notice when it fails.`,
    viewerValue:
      `For ${game} owners, smoother sessions matter more than a louder version number.`,
    thumbnailText: "PATCH CHECK",
    title: `${game} Patch Check`.slice(0, 60),
  };
}

function buildPs5ProPssrUpgradeAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "ps5_pro_visual_upgrade",
    hook: `${game} just gave PS5 Pro owners a real before-and-after test.`,
    sourceLine:
      `${sourceName} says Version ${facts.version || "1.4"} upgrades PSSR for sharper detail, steadier motion and more consistent frame rates at 4K.`,
    tension:
      "That matters because an expensive console upgrade only earns its pitch when players can see the difference during movement, not just in a paused screenshot.",
    stakes:
      "Character materials should stay cleaner in combat while busy environments hold together instead of smearing when the camera moves.",
    caveat:
      "PSSR cannot fix weak art direction or unstable game code, so the patch still has to prove itself across a full session.",
    viewerValue:
      "For PS5 Pro owners, this patch earns its name only if normal play looks noticeably clearer.",
    payoff:
      `If Version ${facts.version || "1.4"} keeps ${game} sharp at 4K without sacrificing responsiveness, this becomes a genuine reason to use the Pro mode rather than another settings-menu promise.`,
    thumbnailText: "PS5 PRO: REAL UPGRADE?",
    title: `${game} Puts PS5 Pro's 4K Promise Under Pressure`.slice(0, 60),
  };
}

function buildForzaFreeCarsAngle(facts, sourceName) {
  const windowPhrase = facts.liveServiceWindow
    ? `, running ${facts.liveServiceWindow}`
    : "";
  return {
    lane: "live_service_free_content",
    hook: "Forza Horizon 6 just made its next retention test obvious.",
    sourceLine:
      `${sourceName} reports Horizon Playlist Series 2, Horizon Decades, is adding another batch of free cars${windowPhrase}.`,
    tension:
      "Free cars sound like a small reward, but in a live-service racer they are the weekly habit: log in, chase the playlist and keep the garage growing.",
    stakes:
      "That matters because Forza does not only need a strong launch; it needs players to keep treating the map like a place worth revisiting.",
    caveat:
      "Free rewards can look generous and still feel like chores if the playlist asks for dull repeats.",
    viewerValue:
      "The sharper question is whether these cars are exciting enough to bring people back, or just another checklist.",
    payoff:
      "If Horizon Decades makes the rewards feel worth the drive, this becomes retention fuel, not just a content-calendar bullet point.",
    thumbnailText: "FREE CARS TEST",
    title: "Forza's Free Cars Test",
  };
}

function buildForzaAngle(facts, sourceName) {
  const hasMoneySignal = facts.hasSteam && (facts.steamPeak || facts.price || facts.hasEarlyAccess);
  const scorePhrase = facts.score
    ? `a ${facts.score} aggregate`
    : "the top Metacritic slot";
  const steamPhrase = facts.steamPeak
    ? `${facts.steamPeak} Steam players`
    : "a visible Steam spike";
  const premiumAccessPhrase = facts.price ? `the ${facts.price} Premium Edition` : "Premium Edition";

  return {
    lane: hasMoneySignal ? "status_money" : "status",
    hook: "Forza just gave Xbox the headline it badly needed.",
    sourceLine: `${sourceName} says Forza Horizon 6 has moved to the top of Metacritic's 2026 list with ${scorePhrase}${
      facts.competitorScore ? `, ahead of Pokemon Pokopia at ${facts.competitorScore}` : ""
    }.`,
    tension: hasMoneySignal
      ? `A ${facts.score || "top"} review score sounds like the story, but the sharper detail is money: the same report points to ${steamPhrase} while access was still tied to ${premiumAccessPhrase}.`
      : "That sounds like one review stat, but the bigger part is status: Xbox has needed a clean first-party win people can explain in one sentence.",
    stakes: hasMoneySignal
      ? `That means critics are not the only early audience reacting, because some players paid before the standard launch wave and before Game Pass can blur the numbers.`
      : "A top score does not prove sales, retention or Game Pass engagement, but it can drag undecided players back into the conversation before the wider launch has settled.",
    caveat:
      "The risk is that early scores and early-access peaks can spike fast, then flatten once the full audience arrives.",
    payoff: hasMoneySignal
      ? "If the wider launch holds, this stops being a neat review-chart fact and starts looking like Xbox's cleanest first-party win of the year."
      : "If the Japan setting and driving model hold after standard launch, this starts looking like Xbox's cleanest first-party win of the year.",
    viewerValue:
      "The player split is not headline volume; it is whether the praise matches the version normal buyers actually get.",
    thumbnailText: "XBOX NEEDED THIS",
    title: "Forza's Xbox Moment",
  };
}

function buildSteamMoneyAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const steamPhrase = facts.steamPeak
    ? `${facts.steamPeak} Steam players`
    : "a major Steam player spike";
  const pricePhrase = facts.price || "early-access";
  return {
    lane: "money",
    hook: `${game}'s paid crowd just sent a loud warning.`,
    sourceLine: `${sourceName} reports that ${game} posted ${steamPhrase} before the standard audience fully arrived.`,
    tension: `The uncomfortable detail is not just the number. It is who counted: people willing to move early, pay attention and in some cases spend ${pricePhrase} before the cheap wave lands.`,
    stakes:
      "That makes the launch harder to dismiss as trailer hype, because paid early demand carries more weight than wishlist noise.",
    caveat:
      "Early-access peaks can cool down quickly once the first weekend ends.",
    payoff:
      "If the next wave holds, this becomes a momentum story, not just a leaderboard screenshot.",
    viewerValue:
      "The next proof is whether that early crowd keeps playing once the cheaper wave arrives.",
    thumbnailText: "PAID PLAYERS",
    title: `${game}'s Paid Signal`.slice(0, 60),
  };
}

function buildReviewStatusAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const scorePhrase = facts.score ? `a ${facts.score}` : "a major review score";
  return {
    lane: "status",
    hook: `${game} just got a score its publisher can market hard.`,
    sourceLine: `${sourceName} reports that ${game} is now sitting on ${scorePhrase} in the current review conversation.`,
    tension:
      "That is not just a critic badge. It is the kind of simple status marker that makes hesitant players look twice.",
    stakes:
      "A strong score can move a game from another release into the one people feel they should check.",
    caveat:
      "Review momentum still has to survive real players, patches and the first wider weekend.",
    payoff:
      "If the score holds while the audience grows, the publisher has a cleaner win than any trailer could buy.",
    viewerValue:
      "For players, the value is knowing whether the hype has evidence behind it before the storefront banners arrive.",
    thumbnailText: "REVIEW POWER",
    title: `${game}'s Review Signal`.slice(0, 60),
  };
}

function buildReleaseDateAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const hasConcreteDate = Boolean(facts.launchDate);
  const datePhrase = facts.launchDate;
  const isHorror = facts.hasHorrorFraming;
  return {
    lane: "release_date",
    hook: !hasConcreteDate
      ? `${game}'s release date just became a trust check, not a new reveal.`
      : isHorror
      ? `${game} finally has a date, and now tone has to do the hard work.`
      : `${game} finally has a launch date, so players can stop guessing and start planning.`,
    sourceLine: hasConcreteDate
      ? `${sourceName} reports that ${game} is launching on ${datePhrase}.`
      : `${sourceName} reports ${game}'s release timing has been reiterated without new footage, price or edition detail.`,
    tension: !hasConcreteDate
      ? "That matters because repeated date confidence can calm delay anxiety, but it does not give players anything new to judge on screen."
      : isHorror
      ? "That matters because a date turns a horror reveal from atmosphere into a buy, wait or skip decision."
      : "That matters because a date turns vague interest into a calendar, wishlist and budget decision.",
    stakes: !hasConcreteDate
      ? "The pressure now shifts back to proof: gameplay, platform wording, editions and whether Rockstar's next official beat makes the schedule feel solid."
      : isHorror
      ? "The trailer promise only holds if combat, pacing and licensed weirdness work together once players can judge them."
      : "The next pressure is footage quality: controls, pacing and platform performance now have to match the schedule.",
    caveat: !hasConcreteDate
      ? "A CEO repeating confidence is not the same as a new trailer, and it should not be treated like fresh gameplay evidence."
      : isHorror
      ? "A date does not prove quality by itself, especially for a licensed horror game that has to make the name feel playable."
      : "A date can still move, and it does not prove the final game will land cleanly.",
    payoff: !hasConcreteDate
      ? "If the next Rockstar beat adds store pages or footage, this becomes a launch-plan story; until then, it is a confidence signal."
      : isHorror
      ? "If the footage matches the mood, this stops being just another recognisable licence and becomes a proper October wildcard."
      : "If the next showing backs up the date with strong gameplay, this becomes a release players can plan around.",
    viewerValue: !hasConcreteDate
      ? "For players, the smart move is to separate date confidence from the missing details that still decide the preorder argument."
      : isHorror
      ? "The clean takeaway: the window is real, but the footage now has to prove the hook deserves the calendar slot."
      : "The takeaway: the date gives players a timeline, but the footage still has to earn the calendar space.",
    thumbnailText: hasConcreteDate ? "DATE LOCKED" : "DATE CONFIDENCE",
    title: hasConcreteDate ? `${game} Gets A Date`.slice(0, 60) : `${game}'s Date Trust Check`.slice(0, 60),
  };
}

function buildPolicyFightAngle(facts, sourceName) {
  return {
    lane: "player_rights",
    hook: "Game shutdowns just became a real political fight.",
    sourceLine:
      `${sourceName} reports that a California bill backed by Stop Killing Games passed a key hurdle on the way to a full assembly vote.`,
    tension:
      "This is not about one angry forum thread. It is about whether sold online games should keep some playable form after servers go dark.",
    stakes:
      "That matters because players keep being asked to buy games that can disappear when a publisher decides the service is finished.",
    caveat:
      "The key nuance is that a committee vote is progress, not a finished law.",
    payoff:
      "If it keeps moving, publishers will have to explain where ownership ends and rented access begins.",
    viewerValue:
      "For players, it turns a complaint into a concrete policy fight with a visible next step.",
    thumbnailText: "GAME OWNERSHIP FIGHT",
    title: "Game Shutdowns Hit Politics",
  };
}

function buildMusicLicencePreservationAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "music_licence_preservation",
    hook: `${game} may have dodged one of gaming's worst preservation problems.`,
    sourceLine:
      `${sourceName} reports that ${game}'s developer paid extra so its music licences last in perpetuity.`,
    tension:
      "That matters because games built around licensed soundtracks can disappear from sale when those rights expire.",
    stakes:
      `${game} is being sold on its soundtrack as part of the identity, so losing the music later would not be a small detail.`,
    caveat:
      "This protects the music-rights claim, not every future price, platform or store decision.",
    payoff:
      "If that licence work holds, this is a rare case where a soundtrack-heavy game planned for preservation before players had to ask.",
    viewerValue:
      "The preservation win is that the game may be less exposed to the delisting trap that has hit other music-heavy releases.",
    thumbnailText: "MIXTAPE WON'T VANISH",
    title: `${game} Avoided Delisting Trap`.slice(0, 60),
  };
}

function buildLiveServiceDevelopmentShiftAngle(facts, sourceName) {
  return {
    lane: "studio_live_service",
    hook: "Destiny 2's ending just got a messy Bungie twist.",
    sourceLine:
      `${sourceName} reports that many Bungie staff only learned Destiny 2 was ending active development when the announcement went public.`,
    tension:
      "That turns a roadmap update into a trust problem, because live-service games run on clear communication as much as new missions.",
    stakes:
      "Players are not just waiting for one more content drop now; they are watching whether support, fixes and messaging still hold after the main team moves on.",
    caveat:
      "The report does not prove every future Destiny plan, and it should not be treated as a finished postmortem.",
    payoff:
      "If Bungie wants the next chapter to land, the handoff has to feel cleaner than the way this reportedly reached its own staff.",
    viewerValue:
      "The June update now has to answer what still gets supported, what slows down and what Bungie is willing to say clearly.",
    thumbnailText: "DESTINY HANDOFF",
    title: "Destiny's Bungie Problem",
  };
}

function buildBungieLayoffShiftAngle(facts, sourceName) {
  return {
    lane: "studio_jobs",
    hook: "Destiny 2's wind-down is now hitting Bungie jobs.",
    sourceLine:
      `${sourceName} reports that Bungie is planning layoffs after ending Destiny 2 development.`,
    tension:
      "That makes this more than a roadmap change. It is a studio-pressure story around the team that kept the live service moving.",
    stakes:
      "Players may feel the fallout in support, fixes, communication and how confidently Bungie talks about what comes after the final update.",
    caveat:
      "The report does not mean Destiny 2 disappears tomorrow, and it does not settle every future project inside Bungie.",
    payoff:
      "If Bungie wants trust through the wind-down, the next message has to be clearer than a corporate reshuffle headline.",
    viewerValue:
      "For players, the worry is whether the handoff still feels stable when the people building the game are also facing cuts.",
    thumbnailText: "BUNGIE JOBS HIT",
    title: "Destiny's Bungie Cuts",
  };
}

function buildVanguardAntiCheatAngle(facts, sourceName) {
  return {
    lane: "anti_cheat_trust",
    hook: "Valorant's anti-cheat fight just got nastier.",
    sourceLine:
      `${sourceName} reports Riot says Vanguard cannot brick a PC, but the update can block DMA cheat hardware.`,
    tension:
      "That distinction matters because the scary claim is PC damage, while Riot is drawing a line between a broken computer and hardware used to bypass anti-cheat.",
    stakes:
      "The real issue is trust. Kernel-level anti-cheat sits deep in Windows, so a heavy-handed update can become bigger than one ban wave.",
    caveat:
      "The important limit is that the report does not show normal Valorant players suddenly facing hardware failure from one match.",
    payoff:
      "If Riot wants this to land cleanly, the next message has to explain exactly what Vanguard touches and what it cannot touch.",
    viewerValue:
      "Check Riot support notes before blaming a PC failure on Valorant.",
    thumbnailText: "VANGUARD PANIC",
    title: "Valorant's Vanguard Fight",
  };
}

function buildSubscriptionAccessAngle(facts, sourceName) {
  const game = facts.gameTitle || "the game";
  const isGta = facts.hasGta5SubscriptionRunway || /\bGTA 5\b/i.test(game);
  const versionedGame =
    facts.version && !new RegExp(`\\b${String(facts.version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(game)
      ? `${game} ${facts.version}`
      : game;
  if (isGta) {
    return {
      lane: "subscription_access",
      hook: "GTA 5 just became the GTA 6 waiting room.",
      sourceLine:
        `${sourceName} reports GTA 5 has joined a subscription service ahead of GTA 6.`,
      tension:
        "That is the important bit: Rockstar can keep old players close without asking everyone to buy the same game again.",
      stakes:
        "For lapsed players, subscription access lowers the friction. For Take-Two, it keeps Los Santos active while the sequel owns the calendar.",
      caveat:
        "Subscription libraries move, so this is access, not ownership.",
      payoff:
        "If people reinstall now, GTA 5 stops looking like old back catalogue and starts working like a warm-up act for GTA 6.",
      viewerValue:
        "That creates a clean split: jump back in for a low-friction warm-up, or wait for GTA 6.",
      thumbnailText: "GTA 6 WAITING ROOM",
      title: "GTA 5 Becomes GTA 6 Warm-Up",
    };
  }

  return {
    lane: "subscription_access",
    hook: facts.version
      ? `${versionedGame} just turned into a real comeback test.`
      : `${game} just became easier to try, and easier to drop.`,
    sourceLine: facts.subscriptionService
      ? facts.launchDate
        ? `${sourceName} reports ${game} comes to ${facts.subscriptionService} on ${facts.launchDate}.`
        : `${sourceName} reports ${game} is available through ${facts.subscriptionService}.`
      : facts.launchDate
        ? `${sourceName} reports ${game} comes to a subscription service on ${facts.launchDate}.`
        : `${sourceName} reports ${game} has joined a subscription service.`,
    tension:
      "That changes the first decision from buying the game to deciding whether it is worth the download.",
    stakes:
      facts.version
        ? "For a full-release update, the question is not just whether people can try it. It is whether lapsed players have a reason to come back and see what changed."
        : "Subscription access can revive attention fast, especially for players who skipped the full-price pitch.",
    caveat:
      "Library access can disappear, so it is not the same as owning a copy.",
    payoff:
      facts.version
        ? "If the update fixes friction and gives players a clearer loop, this becomes a second launch. If not, Game Pass just makes the exit easier."
        : "If the player spike follows, this becomes a second-launch story rather than a quiet catalogue move.",
    viewerValue:
      facts.version
        ? "The clean player question is whether this is finally worth reinstalling."
        : "The split is whether the lower barrier makes the game worth trying now or still easy to ignore.",
    thumbnailText: facts.version ? "COMEBACK TEST" : "SUBSCRIPTION TEST",
    title: facts.version
      ? `${game} Gets A Comeback Test`.slice(0, 60)
      : `${game} Gets A Subscription Test`.slice(0, 60),
  };
}

function buildHaloAccountRequirementAngle(facts, sourceName) {
  return {
    lane: "halo_account_requirement",
    hook: "Halo on PS5 just picked up a very Xbox-shaped requirement.",
    sourceLine:
      `${sourceName} reports Halo: Campaign Evolved PS5 players will need an Xbox account and gamertag to play, plus PS Plus for split-screen co-op.`,
    tension:
      "That matters because this is not just a normal port note; PlayStation players are still being pulled through Xbox identity inside the game.",
    stakes:
      "For fans, the issue is friction. A remake can reach a bigger audience, but extra sign-ins can sour that welcome fast.",
    caveat:
      "This does not mean the PS5 version is cancelled or weaker; it means the access rules need to be understood before people buy.",
    viewerValue:
      "If you are playing on PS5, check the account requirement and co-op rules before assuming it works like a normal PlayStation release.",
    payoff:
      "If Xbox makes the setup painless, Halo gets a cleaner cross-platform moment; if not, the first fight starts before the campaign does.",
    thumbnailText: "PS5 CATCH",
    title: "Halo's PS5 Account Catch",
  };
}

function buildXboxMonetisationPressureAngle(facts, sourceName) {
  return {
    lane: "xbox_monetisation_pressure",
    hook: "Xbox's next problem is not just layoffs; it is pressure to make every player worth more money.",
    sourceLine:
      `${sourceName} reports Microsoft's CEO said its videogames are not monetised enough as Xbox faces layoffs, cancelled games and spending scrutiny.`,
    tension:
      "That matters because the strategy now sounds less like reaching more players and more like earning more from each player.",
    stakes:
      "For fans, that can show up in subscriptions, premium editions, live-service hooks, DLC pressure and fewer risky games getting approved.",
    caveat:
      "One CEO comment does not prove a specific price rise, cancellation or Game Pass change by itself.",
    viewerValue:
      "Watch what changes next: prices, passes, editions and whether smaller Xbox projects still get room to exist.",
    payoff:
      "If Microsoft chases monetisation too hard, Xbox risks turning a strategy problem into a trust problem players can feel every month.",
    thumbnailText: "XBOX MONEY PRESSURE",
    title: "Xbox's Monetisation Pressure",
  };
}

function buildXboxDashboardExclusivityLabelAngle(facts, sourceName) {
  return {
    lane: "xbox_dashboard_exclusivity_label",
    hook: "Xbox just made its exclusives problem visible on the dashboard.",
    sourceLine:
      `${sourceName} reports Xbox is using an EXCLUSIVE label on the console dashboard while players are still trying to understand what counts as an Xbox exclusive.`,
    tension:
      "That matters because the word exclusive used to be simple; now players see PC launches, PlayStation ports, Game Pass deals and dashboard labels all pulling in different directions.",
    stakes:
      "For Xbox fans, the problem is trust. A label can clarify the store page, but it cannot fix a strategy that still feels hard to explain.",
    caveat:
      "A dashboard badge does not prove Microsoft has changed its whole platform plan.",
    viewerValue:
      "Watch whether Xbox uses the label consistently, because confusion around exclusivity makes every future announcement harder to read.",
    payoff:
      "If the wording becomes clear, Xbox gets cleaner expectations; if it stays messy, the dashboard becomes another argument instead of an answer.",
    thumbnailText: "EXCLUSIVE?",
    title: "Xbox's Exclusive Label Problem",
  };
}

function buildGta5CurrentGenUpgradeAngle(facts, sourceName) {
  return {
    lane: "current_gen_upgrade_runway",
    hook: "GTA 5 just made its current-gen upgrade free for easy-to-miss owners.",
    sourceLine:
      `${sourceName} reports GTA 5 players on PS4 and Xbox One can claim the PS5 and Xbox Series X and S version for free this week.`,
    tension:
      "That matters because this is the native current-gen version, not just backward compatibility: better graphics, faster loading and current platform support are the actual value.",
    stakes:
      "For lapsed players, the free upgrade lowers the friction and gives them a reason to check saves, accounts and online progress before reinstalling.",
    caveat:
      "The free headline still depends on eligibility, so old owners need to check whether their copy is covered before assuming it costs nothing.",
    viewerValue:
      "If you still own the old version, the claim window and platform eligibility are the bits to check before paying again.",
    payoff:
      "If Rockstar makes the claim painless, an old upgrade fee turns into a clean retention win; if eligibility is messy, the free headline starts the argument.",
    thumbnailText: "FREE UPGRADE",
    title: "GTA 5's Free Upgrade Runway",
  };
}

function buildGta6LaunchEndgameAngle(facts, sourceName) {
  return {
    lane: "gta6_launch_rollout",
    hook: "GTA 6 may finally be shifting from delay fear to launch countdown.",
    sourceLine:
      `${sourceName} argues Rockstar is entering the endgame for launching GTA 6, with the key claim that another delay now looks less likely.`,
    tension:
      "That matters because players are not only waiting for a trailer; they are trying to read whether the marketing machine is finally moving like a launch plan.",
    stakes:
      "Every official asset, store hint and timing signal now carries more weight because GTA 6 is big enough to distort the whole release calendar.",
    caveat:
      "That is not proof the date cannot move, and an argument column should stay cautious until Rockstar confirms the next step itself.",
    viewerValue:
      "Delay anxiety may be easing, but preorders, editions and platform details still need official confirmation.",
    payoff:
      "If Rockstar follows with store details soon, GTA 6 stops feeling like a distant promise and starts behaving like a launch campaign.",
    thumbnailText: "DELAY FEAR EASES",
    title: "GTA 6's Launch Endgame",
  };
}

function buildOcarinaDirectDemandAngle(facts, sourceName) {
  return {
    lane: "ocarina_demand_signal",
    hook: "Ocarina of Time just made Nintendo's remake demand impossible to ignore.",
    sourceLine:
      `${sourceName} reports June's Nintendo Direct was reportedly 2026's most-watched Summer Game Fest showcase, while the Ocarina of Time remake trailer was the most-viewed clip.`,
    tension:
      "That matters because viewership is not a review score; it is a demand signal from players telling Nintendo which nostalgia bet carries the most pressure.",
    stakes:
      "A remake of this game has to please people who want the N64 memory preserved and people who expect Switch 2 polish.",
    caveat:
      "Trailer views prove attention, not final quality, performance or design restraint.",
    viewerValue:
      "For players, the split is whether Nintendo treats this like a careful restoration or a full modern rebuild.",
    payoff:
      "If expectations keep climbing, Ocarina of Time becomes less like a safe remake and more like Nintendo's hardest promise to land.",
    thumbnailText: "DEMAND SPIKE",
    title: "Ocarina's Remake Pressure",
  };
}

function buildHiddenOcarinaDescriptionAngle(facts, sourceName) {
  return {
    lane: "ocarina_hidden_description",
    hook: "Ocarina of Time just dropped a new clue Nintendo pulled back.",
    sourceLine:
      `${sourceName} reports Nintendo removed a hidden description for Ocarina of Time on Switch 2 that fans say pointed to a faithful update of the N64 original.`,
    tension:
      "That matters because hidden store copy is not marketing fluff once it disappears; fans read the removal as a sign Nintendo was not ready for that promise to be public.",
    stakes:
      "The sharper issue is what faithful even means: preserved structure, cleaner visuals or something closer to a remaster.",
    caveat:
      "It does not confirm a remake, and removed copy should be treated as cautious evidence rather than a finished announcement.",
    viewerValue:
      "The takeaway is narrow: the wording suggests intent, but Nintendo still has to show what Switch 2 actually changes.",
    payoff:
      "If Nintendo confirms it later, this pulled description becomes the first clue to what kind of Ocarina remake fans are really getting.",
    thumbnailText: "HIDDEN CLUE",
    title: "Ocarina's Hidden Switch 2 Clue",
  };
}

function buildBlackOpsPortPricingAngle(facts, sourceName) {
  return {
    lane: "classic_port_pricing",
    hook: "Black Ops 1 and 2 just turned nostalgia into a price test.",
    sourceLine:
      `${sourceName} reports PlayStation listings for the two classic Black Ops games have fans watching for whether these ports land as sensible re-releases or expensive nostalgia.`,
    tension:
      "That matters because older Call of Duty campaigns are not just museum pieces; they are games people still want accessible without paying modern premium prices again.",
    stakes:
      "The split is direct: are these convenient classics, or another reminder that preservation can become a storefront upsell?",
    caveat:
      "Listings do not prove final price, performance, release timing or whether multiplayer support will be meaningful.",
    viewerValue:
      "Watch the price and feature list first, because nostalgia only carries this if the package respects what players are actually buying.",
    payoff:
      "If Activision prices this cleanly, it gets an easy goodwill win; if not, the backlash writes itself before launch.",
    thumbnailText: "PRICE TEST",
    title: "Black Ops Classics Face A Price Test",
  };
}

function buildPhysicalReleaseBacklashAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "physical_release_trust",
    hook: `${game} just turned its trailer comments into an ownership fight.`,
    sourceLine:
      `${sourceName} reports requests for a physical disc release are flooding the trailer comments while PlayStation players push back against digital-only launches.`,
    tension:
      "That matters because the argument is not about shelf decoration. It is about whether a full-price game can be kept, lent or resold without a storefront deciding access.",
    stakes:
      `For ${game} fans, Sony's final retail format now carries almost as much trust as the footage: a disc edition says this release can outlive an account or server problem.`,
    caveat:
      "Sony has not announced the final retail format, and comment volume cannot prove what most buyers will choose.",
    viewerValue:
      "Watch the box, not just the trailer. A genuine disc build would answer the ownership concern; a code-in-box would pour fuel on it.",
    payoff:
      "If PlayStation confirms a proper physical release, the backlash becomes a quick goodwill win. If it stays digital-only, every new trailer inherits the same argument.",
    thumbnailText: "DISC OR DIGITAL?",
    title: `${game} Faces A Physical Release Fight`.slice(0, 60),
  };
}

function buildCyberpunkTrustDebtAngle(facts, sourceName) {
  return {
    lane: "studio_trust_debt",
    hook: "CD Projekt Red is still paying for Cyberpunk 2077's launch.",
    sourceLine:
      `${sourceName} reports a CD Projekt Red boss believes some players may have lost faith indefinitely after Cyberpunk 2077's disastrous release.`,
    tension:
      "That matters because trust is not repaired by one patch note, one expansion or one apology; it is rebuilt every time the studio asks players to believe the next promise.",
    stakes:
      "For fans, CDPR's next reveal needs restraint, proof and playable detail before the hype machine gets loud again.",
    caveat:
      "This does not mean every player is still angry, and it does not erase Cyberpunk's later recovery.",
    viewerValue:
      "The lesson is sharper than drama: when a launch burns people once, the next game has to show evidence earlier.",
    payoff:
      "If CDPR handles its next rollout carefully, the redemption arc keeps working; if it overpromises, the old wound opens fast.",
    thumbnailText: "TRUST DEBT",
    title: "Cyberpunk 2077's Trust Debt",
  };
}

function buildXboxFounderSkepticismAngle(facts, sourceName) {
  return {
    lane: "platform_strategy_trust",
    hook: "An original Xbox insider just made the brand problem sound painfully simple.",
    sourceLine:
      `${sourceName} reports a founding Xbox figure says early fears about the console business are coming true 25 years later.`,
    tension:
      "That matters because Xbox's hardest fight is no longer only hardware power or Game Pass value; it is whether players understand what the platform is trying to be.",
    stakes:
      "When even early insiders frame the old doubts as relevant now, every exclusivity shift, storefront move and hardware signal gets read as strategy drift.",
    caveat:
      "One insider quote is not the whole company plan, and it does not prove Xbox hardware is finished.",
    viewerValue:
      "Xbox has to make its next move feel like a plan instead of another mixed message.",
    payoff:
      "If Xbox explains the strategy clearly, the brand can still reset; if it keeps sounding conflicted, players will fill the silence themselves.",
    thumbnailText: "XBOX STRATEGY",
    title: "Xbox's Strategy Trust Problem",
  };
}

function buildGta6AvoidanceDelayAngle(facts, sourceName) {
  return {
    lane: "gta6_avoidance_delay",
    hook: "Lords of the Fallen 2 just blinked first in the GTA 6 traffic jam.",
    sourceLine:
      `${sourceName} reports Lords of the Fallen 2 was delayed to avoid GTA 6 and give the sequel more enhancement time before launch.`,
    tension:
      "That matters because avoiding Rockstar is not ordinary scheduling; it tells players this release calendar is dangerous enough to reshape a game's rollout before the marketing fight even starts.",
    stakes:
      "For players, the delay only wins if the extra time turns into cleaner combat, better performance and a sharper sequel, not just a quieter launch window.",
    caveat:
      "Dodging GTA 6 is sensible, but it also raises expectations: once a studio asks for more time, the next trailer has to show what improved.",
    viewerValue:
      "The debate is whether this is smart positioning or a warning sign, because Lords of the Fallen 2 now has to justify both the wait and the move.",
    payoff:
      "If the enhancements are real, this looks disciplined; if not, players will remember it as a retreat before GTA 6 even arrived.",
    thumbnailText: "GTA 6 TRAFFIC",
    title: "Lords Of The Fallen 2 Dodges GTA 6",
  };
}

function buildBlackFlagResyncedMonetisationBacklashAngle(facts, sourceName) {
  return {
    lane: "remaster_monetisation_backlash",
    hook: "Black Flag Resynced's paid-content backlash just forced Ubisoft to explain what the standard edition actually includes.",
    sourceLine:
      `${sourceName} reports Ubisoft calls the standard edition the full experience after negative reviews criticised microtransactions and paid DLC.`,
    tension:
      "That answer matters because players are not arguing about prettier water; they are asking whether a full-price comeback is being sliced into extras.",
    stakes:
      "If the base game feels complete and every add-on stays optional, the outrage can fade once people are sailing again.",
    caveat:
      "But if progression keeps pointing players towards the store, the word complete will sound like marketing instead of reassurance.",
    viewerValue:
      "The fairest test is simple: compare what normal play unlocks with what the storefront keeps behind another payment.",
    payoff:
      "That means Black Flag Resynced is now a fight between a fair remaster and a nostalgia tax, and the launch build will settle it.",
    thumbnailText: "NOSTALGIA TAX?",
    title: "Black Flag Resynced's Steam Backlash Put Ubisoft On Defence",
  };
}

function buildBlackFlagSalesMomentumAngle(facts, sourceName) {
  return {
    lane: "black_flag_sales_momentum",
    hook:
      "Ubisoft's new Black Flag sold 3 million copies in its launch week. But the number after day one tells the better story.",
    sourceLine:
      `${sourceName} says 2 million copies sold on day one, then at least another million across the next six days.`,
    tension:
      "That second wave arrived after players had seen the remake, posted reviews and told friends whether the nostalgia actually held up.",
    stakes:
      "Steam reviews also climbed to Very Positive while Ubisoft shipped fixes and announced New Game Plus.",
    caveat:
      "These are publisher-reported sales, and sales alone cannot prove how many people kept playing.",
    viewerValue:
      "The question is whether word of mouth kept pulling new players in after the launch rush faded. That is the clearest sign of staying power.",
    payoff:
      "If word of mouth holds, Ubisoft has more than a nostalgia hit and proof this remake survived contact with its audience.",
    thumbnailText: "3 MILLION IN A WEEK",
    title: "Black Flag Sold 3 Million. The Second Wave Is The Real Win",
  };
}

function buildBethesdaLayoffRoadmapAngle(facts, sourceName) {
  return {
    lane: "studio_cut_roadmap_risk",
    hook: "Bethesda's cuts just turned Fallout 5 into Xbox's biggest pipeline risk.",
    sourceLine:
      `${sourceName} reports layoffs have hit Bethesda while Fallout 5, The Elder Scrolls 6 and Marvel's Blade remain in Xbox's future pipeline.`,
    tension:
      "Those projects already need years of writing, tools, testing and support, so fewer people can turn an ambitious roadmap into a slower and narrower one.",
    stakes:
      "For players, the risk is not a delay anyone can prove today; it is fewer teams carrying some of gaming's biggest worlds tomorrow.",
    caveat:
      "A workforce cut does not automatically cancel a game, and Xbox has not attached a new release date to this report.",
    viewerValue:
      "The next useful proof is staffing and production detail around Fallout 5 and The Elder Scrolls 6, not another logo or distant promise.",
    payoff:
      "That means Xbox now has to prove it is focusing Bethesda rather than hollowing out the pipeline fans still expect it to deliver.",
    thumbnailText: "BETHESDA CUTS",
    title: "Bethesda's Layoffs Put Fallout 5 Under Pressure",
  };
}

function buildBethesdaUnionResponseAngle(facts, sourceName) {
  return {
    lane: "studio_union_response",
    hook: "Bethesda workers just turned Xbox's layoffs into a public warning.",
    sourceLine:
      `${sourceName} reports union-represented Bethesda workers are planning a protest after the latest Xbox layoffs.`,
    tension:
      "That turns a corporate restructuring story into a direct challenge from the people building, testing and supporting the games.",
    stakes:
      "Players feel those cuts later through slower updates, thinner support and fewer experienced developers carrying knowledge between projects.",
    caveat:
      "A protest cannot reverse every decision by itself, and the report does not prove which individual games will change.",
    viewerValue:
      "What it can do is force Xbox to explain why the cuts are necessary while Bethesda still has major releases and live games to support.",
    payoff:
      "That means Xbox now has a public trust fight with the workers it needs to deliver the games still on its roadmap.",
    thumbnailText: "WORKERS PUSH BACK",
    title: "Bethesda Workers Take Xbox's Layoff Fight Public",
  };
}

function buildGenericAngle(facts, sourceName) {
  const game = facts.gameTitle;
  if (facts.hasVotingSignal) {
    return {
      lane: "community_signal",
      hook: `${game} is really a quick read on what players are backing right now.`,
      sourceLine:
        `${sourceName} reports the latest ${game} vote, and the main signal is which releases are still loud enough for players to choose after launch.`,
      tension:
        "That matters because voting stories can look tiny, but they show which games are still cutting through after the first trailer cycle ends.",
      stakes:
        "For players, the result is less about a trophy and more about momentum: which game still has enough word of mouth to pull attention back.",
      caveat:
        "A community vote is not sales data, review proof or a guarantee that the winner keeps growing.",
      payoff:
        "If the winner matches the online noise, it confirms the buzz is real; if it does not, the gap becomes the story.",
      viewerValue:
        "Watch the result as a signal, not a verdict.",
      thumbnailText: "PLAYER VOTE",
      title: `${game} Vote Shows The Real Signal`.slice(0, 60),
    };
  }
  return {
    lane: "source_signal",
    hook: `${game} has one detail worth checking before it becomes background noise.`,
    sourceLine:
      `${sourceName} reports the latest ${game} update, so the important part is whether it changes timing, access, price, performance or actual footage.`,
    tension:
      "That matters because not every update deserves a spotlight; the story has to change what people understand, watch or wait for.",
    stakes:
      "For players, the stakes are immediate: who is affected, what improves and what still needs proof.",
    caveat:
      "One report cannot settle the whole game, so anything beyond the named source stays out.",
    payoff:
      "If the next update adds footage, price or a firm date, that becomes the bigger story.",
    viewerValue:
      "Use this as a watch signal, not a verdict.",
    thumbnailText: "WATCH SIGNAL",
    title: `${game} Needs One Real Proof Point`.slice(0, 60),
  };
}

function buildEditorialAngle(story = {}, options = {}) {
  const sourceMaterial = String(options.sourceMaterial || "");
  const sourceName = sourceNameFromOptions(options);
  const facts = extractFacts(story, sourceMaterial);
  const titleText = sourceText(story, sourceMaterial);

  let angle;
  if (/Stop Killing Games|server shutdowns|keep games playable|AB\s*1921/i.test(titleText)) {
    angle = buildPolicyFightAngle(facts, sourceName);
  } else if (facts.hasMusicLicencePreservation) {
    angle = buildMusicLicencePreservationAngle(facts, sourceName);
  } else if (facts.hasBlackFlagResyncedSalesMilestone) {
    angle = buildBlackFlagSalesMomentumAngle(facts, sourceName);
  } else if (facts.hasBlackFlagResyncedMonetisationBacklash) {
    angle = buildBlackFlagResyncedMonetisationBacklashAngle(facts, sourceName);
  } else if (facts.hasBethesdaUnionResponse) {
    angle = buildBethesdaUnionResponseAngle(facts, sourceName);
  } else if (facts.hasBethesdaLayoffRoadmapRisk) {
    angle = buildBethesdaLayoffRoadmapAngle(facts, sourceName);
  } else if (facts.hasBungieLayoffShift) {
    angle = buildBungieLayoffShiftAngle(facts, sourceName);
  } else if (facts.hasLiveServiceDevelopmentShift) {
    angle = buildLiveServiceDevelopmentShiftAngle(facts, sourceName);
  } else if (facts.hasVanguardAntiCheatControl) {
    angle = buildVanguardAntiCheatAngle(facts, sourceName);
  } else if (facts.hasGta5CurrentGenFreeUpgrade) {
    angle = buildGta5CurrentGenUpgradeAngle(facts, sourceName);
  } else if (facts.hasGta6PreorderLaunch) {
    angle = buildGta6PreorderLaunchAngle(facts, sourceName);
  } else if (facts.hasGta6LaunchEndgame) {
    angle = buildGta6LaunchEndgameAngle(facts, sourceName);
  } else if (facts.hasGta6AvoidanceDelay) {
    angle = buildGta6AvoidanceDelayAngle(facts, sourceName);
  } else if (facts.hasHaloPs5AccountRequirement) {
    angle = buildHaloAccountRequirementAngle(facts, sourceName);
  } else if (facts.hasXboxMonetisationPressure) {
    angle = buildXboxMonetisationPressureAngle(facts, sourceName);
  } else if (facts.hasXboxDashboardExclusivityLabel) {
    angle = buildXboxDashboardExclusivityLabelAngle(facts, sourceName);
  } else if (facts.hasHiddenOcarinaDescriptionRemoval) {
    angle = buildHiddenOcarinaDescriptionAngle(facts, sourceName);
  } else if (facts.hasOcarinaDirectDemandSignal) {
    angle = buildOcarinaDirectDemandAngle(facts, sourceName);
  } else if (facts.hasBlackOpsPortPricing) {
    angle = buildBlackOpsPortPricingAngle(facts, sourceName);
  } else if (facts.hasPhysicalReleaseBacklash) {
    angle = buildPhysicalReleaseBacklashAngle(facts, sourceName);
  } else if (facts.hasCyberpunkTrustDebt) {
    angle = buildCyberpunkTrustDebtAngle(facts, sourceName);
  } else if (facts.hasXboxFounderSkepticism) {
    angle = buildXboxFounderSkepticismAngle(facts, sourceName);
  } else if (facts.hasSubscriptionAccess) {
    angle = buildSubscriptionAccessAngle(facts, sourceName);
  } else if (facts.hasPs5ProPssrUpgrade) {
    angle = buildPs5ProPssrUpgradeAngle(facts, sourceName);
  } else if (facts.hasPatchNotes) {
    angle = buildPatchNotesAngle(facts, sourceName);
  } else if (facts.hasCoverArt || (facts.hasPreorder && /GTA\s*6|Grand Theft Auto VI/i.test(titleText))) {
    angle = buildStoreSignalAngle(facts, sourceName);
  } else if (facts.hasHandsOnDemo) {
    angle = buildHandsOnDemoAngle(facts, sourceName);
  } else if (facts.hasExplorationCombatPreview) {
    angle = buildExplorationCombatPreviewAngle(facts, sourceName);
  } else if (facts.hasDlcAvailableNow) {
    angle = buildDlcAvailableNowAngle(facts, sourceName);
  } else if (facts.hasFreePlayDays) {
    angle = buildFreePlayDaysAngle(facts, sourceName);
  } else if (facts.hasFightingGameCharacterTrailer) {
    angle = buildFightingGameCharacterTrailerAngle(facts, sourceName);
  } else if (facts.hasTrailerGameplay) {
    angle = buildGameplayTrailerAngle(facts, sourceName);
  } else if (facts.hasFreeCarsUpdate) {
    angle = buildForzaFreeCarsAngle(facts, sourceName);
  } else if (/Forza Horizon 6/i.test(titleText) && facts.hasMetacritic) {
    angle = buildForzaAngle(facts, sourceName);
  } else if (facts.hasLaunchDate) {
    angle = buildReleaseDateAngle(facts, sourceName);
  } else if (facts.hasSteamPerformance || facts.hasEarlyAccess) {
    angle = buildSteamMoneyAngle(facts, sourceName);
  } else if (facts.hasMetacritic) {
    angle = buildReviewStatusAngle(facts, sourceName);
  } else {
    angle = buildGenericAngle(facts, sourceName);
  }

  return {
    ...angle,
    facts,
    sourceName,
  };
}

function runtimeProfileFromOptions(options = {}) {
  const profile = options.runtimeProfile || {};
  const provider = profile.provider || options.ttsProvider || process.env.TTS_PROVIDER || "local";
  const secondsPerWord =
    Number(profile.secondsPerWord) > 0
      ? Number(profile.secondsPerWord)
      : secondsPerWordForTtsProvider(provider, options.env || process.env);
  const minWords = Number(profile.minWords) || Math.ceil(61 / secondsPerWord);
  const maxWords = Number(profile.maxWords) || Math.floor(75 / secondsPerWord);
  const span = Math.max(0, maxWords - minWords);
  return {
    provider,
    secondsPerWord,
    minWords,
    maxWords,
    aimMin: Number(profile.aimMin) || Math.ceil(minWords + span * 0.25),
    aimMax: Number(profile.aimMax) || Math.floor(maxWords - span * 0.25),
  };
}

function classificationFromStory(story = {}) {
  const text = [story.title, story.flair, story.classification].filter(Boolean).join(" ").toLowerCase();
  if (/\bleak|leaked|slipped up\b/.test(text)) return "[LEAK]";
  if (/\brumou?r|reportedly|may|might|could\b/.test(text)) return "[RUMOR]";
  if (/\bbreaking|just announced|just confirmed\b/.test(text)) return "[BREAKING]";
  return "[CONFIRMED]";
}

function buildScriptFromAngle(angle) {
  return [
    angle.hook,
    angle.sourceLine,
    angle.tension,
    angle.stakes,
    angle.caveat,
    angle.viewerValue,
    angle.payoff,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function padScriptSentences(angle, runtimeProfile) {
  let pads;
  if (angle.lane === "status_money" || angle.lane === "money") {
    pads = [
      "The split matters: reviews point to quality, while early Steam numbers show who paid attention before the cheaper route opened.",
      "The next pressure point is the normal launch: it either builds on the premium crowd or exposes a short-lived spike.",
      "The stronger read separates the proof point from launch-week theatre.",
      "That gives players a clearer way to judge the next marketing wave.",
      "The wider audience is where the story either holds or fades.",
    ];
  } else if (angle.lane === "status") {
    pads = [
      "The split matters: a score can earn attention, but players still need to see whether the wider audience agrees.",
      "The next pressure point is the launch itself: does attention grow after the first headline fades?",
      "The stronger read separates a real proof point from a store-banner line.",
      "That gives players a clearer way to judge the next promotion wave.",
      "The wider audience is where the story either holds or fades.",
    ];
  } else if (angle.lane === "studio_live_service") {
    pads = [
      "The awkward bit is timing: Destiny players have heard long-term promises before, so a vague roadmap will not carry the same weight.",
      "The next official post now matters more than usual, because it has to prove the live service still has a real plan.",
      "For a game built around years of trust, the communication gap is part of the story.",
    ];
  } else if (angle.lane === "studio_jobs") {
    pads = [
      "The brutal bit is that live-service endings are not just content decisions; they decide who stays, who leaves and what support survives.",
      "That is why this matters even if you are not following every Destiny season.",
      "A cleaner update would say what support continues, not just what development phase is ending.",
      "The risk for Bungie is that players read the cuts as a signal about confidence, not just costs.",
      "That makes every follow-up message carry more weight than a normal seasonal note.",
      "A live game can survive a wind-down, but it needs straight answers while that wind-down happens.",
      "Smaller teams usually mean slower fixes, slower communication and fewer chances to rebuild trust.",
      "That turns the next Bungie update into more than scheduling; it becomes a test of how much support is really left.",
    ];
  } else if (angle.lane === "anti_cheat_trust") {
    pads = [
      "That matters even if you hate cheaters, because a tool powerful enough to police hardware has to be explained clearly.",
      "The actual split is cheat devices versus normal PCs; Riot needs to keep that line impossible to miss.",
      "Valorant players need that line drawn clearly before unrelated PC failures get blamed on anti-cheat.",
      "Riot can win the cheat-hardware fight and still lose trust if the explanation sounds dismissive.",
      "The next update should separate cheat devices, normal peripherals and actual system failures in plain language.",
    ];
  } else if (angle.lane === "halo_account_requirement") {
    pads = [
      "The awkward part is that Halo going wider should feel simple, but account rules can make the first setup feel like platform politics.",
      "Cross-platform releases live or die on friction; one extra sign-in can change the mood before the first mission loads.",
      "The co-op detail matters too, because split-screen players need to know which subscription rules apply before planning a session.",
      "A clean setup makes the PS5 launch feel welcoming; a messy one turns the port into another ecosystem argument.",
    ];
  } else if (angle.lane === "xbox_monetisation_pressure") {
    pads = [
      "That is the tension behind the quote: players hear monetisation and immediately think prices, ads, passes and pressure.",
      "Xbox already has a trust problem around cancellations, exclusivity shifts and what Game Pass is supposed to become.",
      "A stronger business can still be good for players, but only if it funds better games instead of squeezing the same audience harder.",
      "The next Xbox showcase now has to prove there is a creative plan behind the financial pressure.",
    ];
  } else if (angle.lane === "xbox_dashboard_exclusivity_label") {
    pads = [
      "The awkward part is that the badge can be technically correct and still make the bigger message feel more confused.",
      "Players are not only asking where a game launches; they are asking what Xbox wants the word exclusive to mean now.",
      "That makes the next first-party announcement a communication test as much as a content reveal.",
      "A cleaner label system would help, but only if the release strategy behind it stops changing shape every few months.",
    ];
  } else if (angle.lane === "classic_port_pricing") {
    pads = [
      "The uncomfortable part is that these campaigns carry emotional value, but the storefront still has to justify the price.",
      "Players will forgive a paid port faster if the package is clear: campaign access, stable performance and honest multiplayer expectations.",
      "The worst version is a nostalgia tax that makes preservation feel like paying twice for the same memory.",
      "That is why the first real listing needs details, not just another familiar logo.",
    ];
  } else if (angle.lane === "studio_trust_debt") {
    pads = [
      "That is why the next CDPR trailer has to show less promise and more proof.",
      "The audience already knows the studio can recover a broken game; the harder question is whether it can avoid the break next time.",
      "A cautious rollout may sound boring, but boring is exactly what trust needs after a chaotic launch.",
      "Every future preview now has to answer the same question: are players seeing the real build or another promise?",
    ];
  } else if (angle.lane === "platform_strategy_trust") {
    pads = [
      "The problem is not that Xbox lacks games; it is that players keep getting different answers about where those games belong.",
      "A hardware buyer, a Game Pass subscriber and a PlayStation player may now hear the same Xbox announcement differently.",
      "That confusion turns every new exclusive into a referendum on the wider strategy.",
      "The next reset has to sound obvious in one sentence, because players are tired of decoding the plan.",
    ];
  } else if (angle.lane === "subscription_access") {
    const isGtaSubscription = /\bGTA\s*5\b|\bGrand Theft Auto V\b/i.test(
      `${angle.hook || ""} ${angle.sourceLine || ""}`,
    );
    pads = isGtaSubscription
      ? [
          "That is why the timing matters: the sequel is close enough to shape behaviour, but far enough away that players may still want something to play now.",
          "Subscription drops do not create the same commitment as a purchase, but they can restart a habit very quickly.",
          "Now watch whether people return for one nostalgic session or stay long enough for the sequel marketing to matter.",
          "That makes this less like a discount and more like a low-friction reminder of why GTA still owns so much attention.",
          "The offer also gives players a cleaner excuse to argue about whether GTA Online still has life left before the sequel lands.",
        ]
      : [
          "Now watch whether low-friction access turns into actual play time, not just another library tile people scroll past.",
          "Subscription drops can make a game easier to sample, but they still have to prove the first session is worth keeping installed.",
          "That gives players a cleaner choice: try it while access is included or wait until the full-price value is clearer.",
          "That leaves a sharper split: second chance, or temporary visibility bump.",
          "If the player response holds after the first curiosity spike, the subscription move did its job.",
        ];
  } else if (angle.lane === "store_signal") {
    pads = [
      "That is why the timing matters: official art can look small, but it is the point where casual players start asking what version they will actually buy.",
      "The next store page can answer what the trailer cannot: editions, bonuses, platforms and the first real price signal.",
      "Rockstar does not need to say much for players to start reading the rollout, because every official asset now feels like a step toward checkout.",
      "The tension is whether this is normal marketing rhythm or the first sign that the sales machine is about to switch on.",
      "That gives the next official update more weight than another reposted screenshot.",
    ];
  } else if (angle.lane === "gta6_preorder_launch") {
    pads = [
      "That is also where impulse buying gets risky, because a preorder button can arrive before the clearest value comparison does.",
      "The question is not whether GTA 6 will be huge; it is which version actually makes sense to buy first.",
      "Players should be looking for edition differences, upgrade paths and whether any bonus is worth locking money in early.",
      "Rockstar can make the first store page feel like an event, but the details still decide whether it is a good buy.",
      "That makes the preorder page the first real clash between hype and value.",
    ];
  } else if (angle.lane === "current_gen_upgrade_runway") {
    pads = [
      "The useful split is eligibility: digital ownership, platform version and whether the claim appears before anyone pays twice.",
      "This is the kind of old-game update that matters because it prevents a needless rebuy.",
      "For anyone still on the older version, the decision is no longer whether to rebuy; it is whether free current-gen access is worth the reinstall.",
      "If the claim is simple, Rockstar turns an old upgrade fee into goodwill instead of another confusing store page.",
    ];
  } else if (angle.lane === "gta6_launch_rollout") {
    pads = [
      "The next proof is concrete: preorders, edition pages, platform wording or a dated gameplay beat.",
      "That is why players are reading rollout signals so closely; GTA 6 is not a normal release that can move quietly.",
      "Rockstar can build momentum deliberately while fans still fill gaps between official beats.",
      "A careful read keeps both ideas in view: delay fear can ease without pretending the launch is untouchable.",
    ];
  } else if (angle.lane === "ocarina_demand_signal") {
    pads = [
      "That pressure matters because Ocarina is not just another back-catalogue name; it is one of Nintendo's most protected memories.",
      "A huge trailer audience raises the ceiling and the risk at the same time.",
      "Fans may want a faithful remake until the first modernised system changes what they remember.",
      "That makes every visual, camera and control detail more loaded than a normal nostalgia reveal.",
    ];
  } else if (angle.lane === "ocarina_hidden_description") {
    pads = [
      "The removal changes the player question: did Nintendo pull unfinished store copy, or did it accidentally show the shape of the remake too early?",
      "A faithful update sounds simple, but Ocarina fans disagree hard on what should be preserved and what should be modernised.",
      "That makes Nintendo's eventual wording important: remake, remaster and update all create different expectations.",
      "The cautious read is that the clue matters, but the announcement still has to do the heavy lifting.",
    ];
  } else if (angle.lane === "trailer_gameplay") {
    pads = [
      "That is why the footage matters more than the headline: a trailer can sell a mood, but repeated motion shows whether the loop has energy.",
      "Players can pause the clips and see whether the environments, animations and camera actually support the pitch.",
      "The next proof is longer footage, because quick cuts can disguise pacing problems more easily than weak art.",
      "That gives players a clearer question: does the footage show a real loop, or just a familiar licence in motion?",
      "A gameplay beat can lift a small release fast when the clips show a real reason to try it.",
    ];
  } else if (angle.lane === "hands_on_demo") {
    pads = [
      "That gives the story a cleaner hook than normal preview hype: players can test the promise instead of only trusting a write-up.",
      "The first question is whether the combat feels faster and clearer, not whether the expansion sounds big on paper.",
      "A good demo turns curiosity into intent; a flat one tells players to wait for reviews.",
      "That makes the controller feel the strongest proof this story can offer.",
    ];
  } else if (angle.lane === "exploration_combat_preview") {
    pads = [
      "That is why the balance matters: discovery has to reward curiosity, combat has to stay readable and traversal cannot feel like filler.",
      "The risk for a throwback RPG is that it looks warm in screenshots but feels slow after the first few fights.",
      "A sharper loop would make every new area feel like a choice, not a corridor between battles.",
      "That gives players a better debate than whether the art style is charming enough.",
    ];
  } else if (angle.lane === "dlc_available_now") {
    pads = [
      "That makes the first session important: the DLC has to show something new before nostalgia wears off.",
      "A strong return beat gives existing players a reason to talk, not just a reason to patch the game.",
      "The best version of this update makes the jungle feel like a fresh route through a familiar loop.",
      "That is the difference between a DLC announcement and a genuine comeback moment.",
    ];
  } else if (angle.lane === "free_play_days") {
    pads = [
      "Do not hoard downloads; pick the game that fills a gap in your weekend.",
      "A free window only matters if it answers whether the full game deserves money or storage space.",
      "That makes the lineup a discovery filter rather than a pile of temporary licences.",
      "The best outcome is finding one game worth keeping, not sampling four for five minutes each.",
    ];
  } else if (angle.lane === "live_service_free_content") {
    pads = [
      "Free is not the issue; the rewards need to beat backlog fatigue.",
      "For a racer, a new car can be a reason to play for ten minutes or a reason to spend the whole night tuning, sharing and chasing rivals.",
      "That is why the playlist cadence matters more than the headline count.",
      "The best live-service updates make players feel pulled back in, not dragged through homework.",
      "That gives Forza a clean test: can it turn free content into routine excitement instead of routine admin?",
    ];
  } else if (angle.lane === "patch_notes") {
    pads = [
      "The important thing is not drama; it is whether early owners avoid small irritations that make new hardware feel unfinished.",
      "That makes patch notes worth checking before assuming nothing changed.",
      "For a new console, boring fixes can matter more than flashy menus while the first wave of players tests the hardware day to day.",
      "The next update will show whether this was routine cleanup or part of a faster stability rhythm.",
      "That gives owners a reason to check the notes before blaming a game for a console-side problem.",
    ];
  } else if (angle.lane === "gta6_avoidance_delay") {
    pads = [
      "It is also a visibility test: dark fantasy action games need momentum, and launching beside the loudest open-world event on earth would flatten that conversation fast.",
      "That makes the next footage matter more than the new window, because enhancements only count when players can see sharper fights, cleaner performance or stronger bosses.",
      "The move may be smart, but it gives fans a clean receipt to check when the game comes back into view.",
      "A delay like this can protect a launch, but it also turns every vague promise into a measurable expectation.",
    ];
  } else if (angle.lane === "release_date") {
    pads = angle.facts?.hasHorrorFraming
      ? [
          "The platform list matters too, because PC and console players are getting the same calendar target instead of a vague staggered promise.",
          "Horror fans will judge the licence by combat weight, enemy threat and pace, not by the name alone.",
          "That makes the next gameplay beat more important than another logo card.",
          "A date gives players something concrete, but the footage still has to show weight, threat and pace.",
          "The closer this gets to October, the less the name can hide weak combat or flat scares.",
        ]
      : [
          "The platform list matters because players need to know which version is actually landing on the same day.",
          "A date gives everyone a target, but it also raises the standard for the next gameplay beat.",
          "From here, every trailer has to answer a clearer question: does the game look ready for that slot?",
          "Players can now plan around the month, but performance, price and edition details still decide how confident that plan should feel.",
          "The closer launch gets, the less a good headline can hide thin footage or vague platform messaging.",
        ];
  } else if (angle.lane === "player_rights") {
    pads = [
      "The next vote matters because it decides whether the idea keeps moving or stalls before publishers have to respond in detail.",
      "The player pressure point is that sold games should not become useless just because a server bill gets inconvenient.",
      "That is why this story keeps jumping from gaming forums into actual legislation.",
      "The fight is now about obligations after money changes hands, not nostalgia for one shut-down title.",
      "Players who bought always-online games know exactly why that wording matters.",
      "The next vote will show whether the complaint becomes lawmaking pressure or stalls as a campaign moment.",
      "That makes the story bigger than one bill, because it tests whether ownership language still means anything for live games.",
    ];
  } else if (angle.lane === "music_licence_preservation") {
    pads = [
      "That extra licence work matters because soundtrack-heavy games can age badly when the store version loses the music that sold the mood.",
      "It also gives players a clearer reason to trust the version they buy today will still resemble itself later.",
      "Preservation is not glamorous, but it is exactly where music-driven games often break years after launch.",
      "That makes the deal less about hype and more about whether the game can stay intact.",
      "It is rare because music-heavy games often run into rights problems long after launch week is over.",
      "It also gives players a clean reason to care now: the soundtrack is part of what they are buying.",
      "A preservation detail like this matters most later, when storefront pages usually get messy.",
    ];
  } else if (angle.lane === "physical_release_trust") {
    pads = [
      "That distinction matters most years later, when delistings, licence changes and broken online services turn convenience into a preservation problem.",
      "Because this is one of PlayStation's biggest exclusives, the decision will be read as a signal for the games that follow.",
    ];
  } else if (angle.lane === "black_flag_sales_momentum") {
    pads = [
      "Nostalgia can create a huge first day, but it cannot guarantee another week of recommendations.",
      "New Game Plus gives finished players a reason to return instead of letting the launch spike disappear.",
    ];
  } else {
    pads = [
      "The first check is whether this changes what people install, buy, wishlist or ignore this week.",
      "If not, the story should stay small.",
      "If it does, the proof has to be visible: footage, price, date or platform detail.",
      "That is the difference between a forgettable update and a story people can understand instantly.",
      "A stronger follow-up should show the change plainly instead of explaining around it.",
    ];
  }
  const sentences = [
    angle.hook,
    angle.sourceLine,
    angle.tension,
    angle.stakes,
    angle.caveat,
    angle.viewerValue,
    angle.payoff,
  ].filter(Boolean);

  let padIndex = 0;
  while (
    countSpokenWords(`${sentences.join(" ")} ${EXACT_CTA}`) < runtimeProfile.aimMin &&
    padIndex < pads.length
  ) {
    sentences.splice(Math.max(3, sentences.length - 1), 0, pads[padIndex]);
    padIndex += 1;
  }

  while (
    countSpokenWords(`${sentences.join(" ")} ${EXACT_CTA}`) > runtimeProfile.maxWords &&
    sentences.length > 5
  ) {
    sentences.splice(sentences.length - 2, 1);
  }

  return `${sentences.join(" ")} ${EXACT_CTA}`.replace(/\s+/g, " ").trim();
}

function buildAngleFirstScript(story = {}, options = {}) {
  const runtimeProfile = runtimeProfileFromOptions(options);
  const angle = buildEditorialAngle(story, options);
  const fullScript = padScriptSentences(angle, runtimeProfile);
  const wordCount = countSpokenWords(fullScript);
  if (wordCount < runtimeProfile.minWords || wordCount > runtimeProfile.maxWords) {
    return null;
  }

  const hook = normaliseText(angle.hook);
  const body = normaliseText(fullScript.replace(hook, "").replace(EXACT_CTA, ""));
  return {
    classification: classificationFromStory(story),
    hook,
    body,
    cta: EXACT_CTA,
    full_script: fullScript,
    word_count: wordCount,
    suggested_thumbnail_text: angle.thumbnailText,
    suggested_title: angle.title,
    content_pillar: classificationFromStory(story) === "[RUMOR]" ? "Rumour Watch" : "Confirmed Drop",
    script_generation_status: "script_ready",
    script_source: "angle_first_source_bound_fallback",
    format_route: "flash_short",
    runtime_route: "flash_short",
    editorial_angle: {
      lane: angle.lane,
      hook: angle.hook,
      payoff: angle.payoff,
      source_name: angle.sourceName,
    },
  };
}

module.exports = {
  buildEditorialAngle,
  buildAngleFirstScript,
  extractFacts,
};
