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
  return normaliseText(options.sourceName) || "the source";
}

function detectGameTitle(story = {}, sourceMaterial = "") {
  const text = sourceText(story, sourceMaterial);
  const known = text.match(
    /\b(?:Forza Horizon 6|Subnautica 2|Destiny 2|Helldivers 2|GTA 6|GTA VI|Nintendo Switch 2|Resident Evil Requiem|Pokemon Pokopia|Pokémon Pokopia)\b/i,
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
  ]);
  return {
    gameTitle: detectGameTitle(story, sourceMaterial),
    hasMetacritic: /\bMetacritic|critic|review|rated|rating|score\b/i.test(text),
    hasSteam: /\bSteam|SteamDB|concurrent|Premium Edition|early[-\s]?access\b/i.test(text),
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
    hasPrice: Boolean(price),
    hasEarlyAccess: /\bearly[-\s]?access|Premium Edition\b/i.test(text),
    score,
    competitorScore,
    steamPeak,
    price: price ? `$${price}` : null,
    launchDate,
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
      "The catch is simple: early scores and early-access peaks can spike fast, then flatten once the full audience arrives.",
    payoff: hasMoneySignal
      ? "If the wider launch holds, this stops being a neat review-chart fact and starts looking like Xbox's cleanest first-party win of the year."
      : "If the Japan setting and driving model hold after standard launch, this starts looking like Xbox's cleanest first-party win of the year.",
    viewerValue:
      "For players, the question is not whether the headline is loud. It is whether the praise matches the version normal buyers actually get.",
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
      "For players, the takeaway is simple: watch whether the spike turns into retention before calling it a long-term win.",
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
      "For players, the point is simple: the June update needs to answer what still gets supported, what slows down and what Bungie is willing to say clearly.",
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
      "For players, the question is whether the handoff still feels stable when the people building the game are also facing cuts.",
    thumbnailText: "BUNGIE JOBS HIT",
    title: "Destiny's Bungie Cuts",
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
      "For players, the point is knowing what changed and what still needs proof.",
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
  } else if (/Forza Horizon 6/i.test(titleText) && facts.hasMetacritic) {
    angle = buildForzaAngle(facts, sourceName);
  } else if (facts.hasSteam || facts.hasPrice || facts.hasEarlyAccess) {
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
