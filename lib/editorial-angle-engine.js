"use strict";

const {
  countSpokenWords,
  secondsPerWordForTtsProvider,
} = require("./services/short-runtime-planner");
const { inferHeadlineGameCandidates } = require("./game-title-inference");

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";

function normaliseText(value) {
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

function detectGameTitle(story = {}, sourceMaterial = "") {
  const text = sourceText(story, sourceMaterial);
  if (/\b(?:GTA\s*5|Grand Theft Auto V)\b/i.test(text)) return "GTA 5";
  if (/\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(text)) return "GTA 6";
  if (/\bHellraiser:\s*Revival\b/i.test(text)) return "Hellraiser: Revival";
  const known = text.match(
    /\b(?:Forza Horizon 6|Subnautica 2|Destiny 2|Helldivers 2|Valorant|GTA 6|GTA VI|Nintendo Switch 2|Resident Evil Requiem|Pokemon Pokopia|Pokémon Pokopia)\b/i,
  );
  if (known) return known[0].replace(/^GTA VI$/i, "GTA 6");

  const inferred = inferHeadlineGameCandidates(story.title || story.article_title || "");
  if (inferred.length > 0) return inferred[0];

  const title = normaliseText(story.title).replace(/\s+-\s+.*$/g, "");
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

function extractFacts(story = {}, sourceMaterial = "") {
  const text = sourceText(story, sourceMaterial);
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
    /\b(\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)(?:,\s*\d{4})?)\b/i,
  ]);
  const version = extractFirst(text, [
    /\b(?:system update|firmware|version|update)\s+(\d{1,3}(?:\.\d{1,3})+)\b/i,
    /\b(\d{1,3}(?:\.\d{1,3})+)\b/i,
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
  const hasPatchNotes =
    /\b(?:system update|firmware|patch notes|version\s+\d|update\s+\d{1,3}(?:\.\d{1,3})+|hotfix|stability update)\b/i.test(
      text,
    );
  const hasFreeCarsUpdate =
    /\bForza Horizon\s*6\b/i.test(text) &&
    /\b(?:free cars?|car pack|cars? confirmed|Horizon Playlist|Horizon Decades|Series\s*\d+|festival playlist)\b/i.test(
      text,
    );
  const liveServiceWindow = extractFirst(text, [
    /\b((?:June|July|August|September|October|November|December|January|February|March|April|May)\s+\d{1,2}\s+to\s+(?:June|July|August|September|October|November|December|January|February|March|April|May)\s+\d{1,2})\b/i,
    /\b(\d{1,2}\s+(?:June|July|August|September|October|November|December|January|February|March|April|May)\s+to\s+\d{1,2}\s+(?:June|July|August|September|October|November|December|January|February|March|April|May))\b/i,
  ]);
  const namedCharacters = [
    ...new Set((text.match(/\b(?:Jason|Lucia)\b/g) || []).map((item) => item.trim())),
  ];
  return {
    gameTitle: detectGameTitle(story, sourceMaterial),
    hasMetacritic: /\bMetacritic|critic|review|rated|rating|score\b/i.test(text),
    hasSteam: hasSteamPerformance,
    hasSteamPlatform: /\bSteam\b/i.test(text),
    hasSteamPerformance,
    hasXbox: /\bXbox|Game Pass|Microsoft\b/i.test(text) || /Forza Horizon/i.test(text),
    hasMusicLicencePreservation:
      /\b(?:music|soundtrack|licensed)\b/i.test(text) &&
      /\b(?:licen[cs]e|delist|perpetuity|rights expire|paid extra)\b/i.test(text),
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
    hasVanguardAntiCheatControl:
      /\bValorant\b/i.test(text) &&
      /\bVanguard\b/i.test(text) &&
      /\b(?:anti[-\s]?cheat|DMA|bricking?|cheat hardware|kernel[-\s]?level|paperweights?)\b/i.test(text),
    hasSubscriptionAccess:
      /\b(?:subscription|Game Pass|PlayStation Plus|PS Plus|GTA\+|Netflix|Prime Gaming)\b/i.test(text) ||
      /\bjoins?\s+a\s+subscription\b/i.test(text),
    hasGta5SubscriptionRunway:
      /\b(?:GTA\s*5|Grand Theft Auto V)\b/i.test(text) &&
      /\b(?:subscription|Game Pass|PlayStation Plus|PS Plus|GTA\+|joins?\s+a\s+subscription)\b/i.test(text) &&
      /\b(?:GTA\s*6|GTA\s*VI|Grand Theft Auto VI)\b/i.test(text),
    hasCoverArt,
    hasPreorder,
    hasTrailer,
    hasGameplay,
    hasTrailerGameplay: hasTrailer && hasGameplay,
    hasPatchNotes,
    hasFreeCarsUpdate,
    liveServiceWindow,
    namedCharacters,
    hasPrice: Boolean(price),
    hasEarlyAccess: /\bearly[-\s]?access|Premium Edition\b/i.test(text),
    hasLaunchDate: Boolean(launchDate) || /\brelease date\b/i.test(text),
    score,
    competitorScore,
    steamPeak,
    price: price ? `$${price}` : null,
    launchDate,
    version,
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
      "The catch is that art is not a release-date change, and it does not prove new gameplay is coming today.",
    payoff:
      `If the next store update lands, ${game} stops being a trailer wait and becomes a money decision.`,
    viewerValue:
      "For players, the useful split is plain: the image is real, the sales details are still missing and every store update now matters.",
    thumbnailText: "PREORDER WATCH",
    title: `${game} Preorder Watch`.slice(0, 60),
  };
}

function buildGameplayTrailerAngle(facts, sourceName) {
  const game = facts.gameTitle;
  const isRacer = /\b(?:kart|racing|drift|drifting|track|tracks)\b/i.test(game);
  return {
    lane: "trailer_gameplay",
    hook: isRacer
      ? `${game} just showed the part a kart racer cannot fake: speed.`
      : `${game} just showed the part trailers usually hide: how it plays.`,
    sourceLine: isRacer
      ? `${sourceName} reports the new ${game} gameplay trailer shows racing, drifting and track variety before launch.`
      : `${sourceName} reports the new ${game} trailer shows real gameplay, not just another logo beat.`,
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
      : `If the controls match the footage, ${game} moves from wait-and-see trailer to something players can judge properly.`,
    viewerValue: isRacer
      ? "For players, the useful test is whether every clip shows speed, readable corners and tracks that look fun twice."
      : "For players, the useful test is whether the footage shows repeated play, not one perfect trailer moment.",
    thumbnailText: isRacer ? "REAL SPEED TEST" : "GAMEPLAY CHECK",
    title: isRacer ? `${game} Speed Test`.slice(0, 60) : `${game} Gameplay Check`.slice(0, 60),
  };
}

function buildPatchNotesAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "patch_notes",
    hook: `${game} just got a boring-looking update with a useful warning.`,
    sourceLine:
      `${sourceName} reports system update ${facts.version || ""}`.replace(/\s+$/, "") +
      " is live, and the patch notes tell players what changed before they download it.",
    tension:
      "That matters because console updates only become interesting when they touch saves, performance, online play or controller reliability.",
    stakes:
      "Version numbers sound dry, but they become real fast when a download blocks a game session, breaks matchmaking or fixes a bug everyone hit.",
    caveat:
      "The catch is that this is not a new game reveal; it is housekeeping.",
    payoff:
      `If the patch keeps systems smoother before the next big release, it becomes the kind of invisible fix players only notice when it fails.`,
    viewerValue:
      `For ${game} owners, the practical question is whether the update makes the console feel more stable or just resets the version number.`,
    thumbnailText: "PATCH CHECK",
    title: `${game} Patch Check`.slice(0, 60),
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
      "The catch is that free rewards can look generous and still feel like chores if the playlist asks for dull repeats.",
    viewerValue:
      "For players, the useful question is simple: are these cars exciting enough to bring people back, or just another checklist?",
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
      : "That sounds like one review stat, but the useful part is status: Xbox has needed a clean first-party win people can explain in one sentence.",
    stakes: hasMoneySignal
      ? `That means critics are not the only early audience reacting, because some players paid before the standard launch wave and before Game Pass can blur the numbers.`
      : "A top score does not prove sales, retention or Game Pass engagement, but it can drag undecided players back into the conversation before the wider launch has settled.",
    caveat:
      "The risk is that early scores and early-access peaks can spike fast, then flatten once the full audience arrives.",
    payoff: hasMoneySignal
      ? "If the wider launch holds, this stops being a neat review-chart fact and starts looking like Xbox's cleanest first-party win of the year."
      : "If the Japan setting and driving model hold after standard launch, this starts looking like Xbox's cleanest first-party win of the year.",
    viewerValue:
      "For players, the useful split is not headline volume; it is whether the praise matches the version normal buyers actually get.",
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
      "The catch is that early-access peaks can cool down quickly once the first weekend ends.",
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
      "The catch is that review momentum still has to survive real players, patches and the first wider weekend.",
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
  const datePhrase = facts.launchDate || "a release date";
  return {
    lane: "release_date",
    hook: `${game} finally has a date, and now the real test is tone.`,
    sourceLine: `${sourceName} reports that ${game} is launching on ${datePhrase}.`,
    tension:
      "That matters because a date turns a horror reveal from atmosphere into a real buy, wait or skip decision.",
    stakes:
      "The useful question is whether the trailer promise holds once players can judge the combat, pacing and licensed weirdness together.",
    caveat:
      "A date does not prove quality by itself, especially for a licensed horror game that has to make the name feel playable.",
    payoff:
      "If the footage matches the mood, this stops being just another recognisable licence and becomes a proper October wildcard.",
    viewerValue:
      "For players, the clean takeaway is simple: the window is real, but the footage now has to prove the hook deserves the calendar slot.",
    thumbnailText: "DATE LOCKED",
    title: `${game} Gets A Date`.slice(0, 60),
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
      "For players, this is useful because it turns a complaint into a concrete policy fight with a visible next step.",
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
      "The limit is simple: this protects the music-rights claim, not every future price, platform or store decision.",
    payoff:
      "If that licence work holds, this is a rare case where a soundtrack-heavy game planned for preservation before players had to ask.",
    viewerValue:
      "For players, the useful bit is practical: the game may be less exposed to the delisting trap that has hit other music-heavy releases.",
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
      "The real issue is trust. Kernel-level anti-cheat sits deep in Windows, so every heavy-handed update becomes bigger than one ban wave.",
    caveat:
      "The important limit is that the report does not show normal Valorant players suddenly facing hardware failure from one match.",
    payoff:
      "If Riot wants this to land cleanly, the next message has to explain exactly what Vanguard touches and what it cannot touch.",
    viewerValue:
      "For players, the practical move is simple: check Riot support notes before blaming a PC failure on Valorant.",
    thumbnailText: "VANGUARD PANIC",
    title: "Valorant's Vanguard Fight",
  };
}

function buildSubscriptionAccessAngle(facts, sourceName) {
  const game = facts.gameTitle || "the game";
  const isGta = facts.hasGta5SubscriptionRunway || /\bGTA 5\b/i.test(game);
  if (isGta) {
    return {
      lane: "subscription_access",
      hook: "GTA 5 just became the GTA 6 waiting room.",
      sourceLine:
        `${sourceName} reports GTA 5 has joined a subscription service ahead of GTA 6.`,
      tension:
        "That is the useful bit: Rockstar can keep old players close without asking everyone to buy the same game again.",
      stakes:
        "For lapsed players, subscription access lowers the friction. For Take-Two, it keeps Los Santos active while the sequel owns the calendar.",
      caveat:
        "The catch is that subscription libraries move, so this is access, not ownership.",
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
    hook: `${game} just became easier to try, but there is a catch.`,
    sourceLine: `${sourceName} reports ${game} has joined a subscription service.`,
    tension:
      "That changes the first decision from buying the game to deciding whether it is worth the download.",
    stakes:
      "Subscription access can revive attention fast, especially for players who skipped the full-price pitch.",
    caveat:
      "The catch is that library access can disappear, so it is not the same as owning a copy.",
    payoff:
      "If the player spike follows, this becomes a second-launch story rather than a quiet catalogue move.",
    viewerValue:
      "For players, the useful split is whether the lower barrier makes the game worth trying now or still easy to ignore.",
    thumbnailText: "SUBSCRIPTION TEST",
    title: `${game} Gets A Subscription Test`.slice(0, 60),
  };
}

function buildGenericAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "impact",
    hook: `${game} has a new detail players should clock.`,
    sourceLine: `${sourceName} reports a new ${game} update with a player-facing detail still worth separating from the noise.`,
    tension:
      "The interesting part is not that another update exists. It is whether this changes timing, access, trust or what players should pay attention to next.",
    stakes:
      "That gives the story a reason to exist beyond repeating the feed.",
    caveat:
      "Until another source adds more, this stays a tight update instead of a hype cycle.",
    payoff:
      "If the next update adds footage, platform details or a firm date, that becomes the follow-up.",
    viewerValue:
      "The next useful proof is footage, platform detail or a firm date that changes whether the game belongs on a watchlist.",
    thumbnailText: "PLAYER IMPACT",
    title: `${game} Player Impact`.slice(0, 60),
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
  } else if (facts.hasBungieLayoffShift) {
    angle = buildBungieLayoffShiftAngle(facts, sourceName);
  } else if (facts.hasLiveServiceDevelopmentShift) {
    angle = buildLiveServiceDevelopmentShiftAngle(facts, sourceName);
  } else if (facts.hasVanguardAntiCheatControl) {
    angle = buildVanguardAntiCheatAngle(facts, sourceName);
  } else if (facts.hasSubscriptionAccess) {
    angle = buildSubscriptionAccessAngle(facts, sourceName);
  } else if (facts.hasPatchNotes) {
    angle = buildPatchNotesAngle(facts, sourceName);
  } else if (facts.hasCoverArt || (facts.hasPreorder && /GTA\s*6|Grand Theft Auto VI/i.test(titleText))) {
    angle = buildStoreSignalAngle(facts, sourceName);
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
      "The real player concern is simple: smaller teams usually mean slower fixes, slower communication and fewer chances to rebuild trust.",
      "That turns the next Bungie update into more than scheduling; it becomes a test of how much support is really left.",
    ];
  } else if (angle.lane === "anti_cheat_trust") {
    pads = [
      "That matters even if you hate cheaters, because a tool powerful enough to police hardware has to be explained clearly.",
      "The actual split is cheat devices versus normal PCs; Riot needs to keep that line impossible to miss.",
      "Valorant players need that line drawn clearly before every PC problem gets blamed on anti-cheat.",
      "Riot can win the cheat-hardware fight and still lose trust if the explanation sounds dismissive.",
      "The next update should separate cheat devices, normal peripherals and actual system failures in plain language.",
    ];
  } else if (angle.lane === "subscription_access") {
    pads = [
      "That is why the timing matters: the sequel is close enough to shape behaviour, but far enough away that players may still want something to play now.",
      "Subscription drops do not create the same commitment as a purchase, but they can restart a habit very quickly.",
      "The real test is whether people return for one nostalgic session or stay long enough for the sequel marketing to matter.",
      "That makes this less like a discount and more like a low-friction reminder of why GTA still owns so much attention.",
      "The offer also gives players a cleaner excuse to argue about whether GTA Online still has life left before the sequel lands.",
    ];
  } else if (angle.lane === "store_signal") {
    pads = [
      "That is why the timing matters: official art can look small, but it is the point where casual players start asking what version they will actually buy.",
      "The next store page can answer what the trailer cannot: editions, bonuses, platforms and the first real price signal.",
      "Rockstar does not need to say much for players to start reading the rollout, because every official asset now feels like a step toward checkout.",
      "The useful debate is whether this is normal marketing rhythm or the first sign that the sales machine is about to switch on.",
      "That gives the next official update more weight than another reposted screenshot.",
    ];
  } else if (angle.lane === "trailer_gameplay") {
    pads = [
      "That is why the footage matters more than the headline: a trailer can sell a mood, but repeated motion shows whether the loop has energy.",
      "Players can pause the clips and see whether the environments, animations and camera actually support the pitch.",
      "The next proof is longer footage, because quick cuts can hide weak pacing better than they hide weak art.",
      "That gives fans something sharper to argue about than whether the licence is famous enough.",
      "A gameplay beat can lift a small release fast when the clips show a real reason to try it.",
    ];
  } else if (angle.lane === "live_service_free_content") {
    pads = [
      "The debate is not whether free is good; it is whether the rewards are good enough to beat backlog fatigue.",
      "For a racer, a new car can be a reason to play for ten minutes or a reason to spend the whole night tuning, sharing and chasing rivals.",
      "That is why the playlist cadence matters more than the headline count.",
      "The best live-service updates make players feel pulled back in, not dragged through homework.",
      "That gives Forza a clean test: can it turn free content into routine excitement instead of routine admin?",
    ];
  } else if (angle.lane === "patch_notes") {
    pads = [
      "The important thing is not drama; it is whether early owners avoid small irritations that make new hardware feel unfinished.",
      "That makes patch notes worth checking before assuming nothing changed.",
      "For a new console, boring fixes can matter more than flashy menus when the first wave of players is still testing the hardware every day.",
      "The next update will show whether this was routine cleanup or part of a faster stability rhythm.",
      "That gives owners a practical reason to check the notes before blaming a game for a console-side problem.",
    ];
  } else if (angle.lane === "release_date") {
    pads = [
      "The platform list matters too, because PC and console players are getting the same calendar target instead of a vague staggered promise.",
      "For horror fans, the debate is whether the licence is strong enough to carry a full action-horror game, not just a trailer mood.",
      "That makes the next gameplay beat more important than another logo card.",
      "A date gives players something concrete, but the footage still has to show weight, threat and pace.",
      "The closer this gets to October, the less the name can hide weak combat or flat scares.",
    ];
  } else if (angle.lane === "player_rights") {
    pads = [
      "The next vote matters because it decides whether the idea keeps moving or stalls before publishers have to respond in detail.",
      "For players, the useful pressure point is simple: sold games should not become useless just because a server bill gets inconvenient.",
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
  } else {
    pads = [
      "The next thing to watch is whether the official follow-up gives players a clear date, platform detail or gameplay proof.",
      "That is where a small update either becomes useful or fades into the feed.",
      "A sharper follow-up should answer the player question directly instead of making the announcement feel bigger than it is.",
      "The stronger short keeps the subject named and the consequence visible from the first line.",
      "That gives the update enough shape without pretending the source answered everything.",
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
