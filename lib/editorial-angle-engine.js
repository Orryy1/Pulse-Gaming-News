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
    /\b(?:Forza Horizon 6|Subnautica 2|GTA 6|GTA VI|Nintendo Switch 2|Resident Evil Requiem|Pokemon Pokopia|Pokémon Pokopia)\b/i,
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

function buildGenericAngle(facts, sourceName) {
  const game = facts.gameTitle;
  return {
    lane: "impact",
    hook: `${game} just picked up a detail worth watching.`,
    sourceLine: `${sourceName} reports the latest ${game} update, and it could change how players read the next trailer, listing or patch.`,
    tension:
      "The headline is only the doorway. The sharper part is whether it shifts price, access, trust, timing or the next thing people actually download.",
    stakes:
      "That gives the short a real reason to exist instead of just repeating the feed.",
    caveat:
      "The limit is simple: the story has to stay with the facts the source actually gives.",
    payoff:
      "If the next update adds footage, platform details or a firm date, that becomes the follow-up.",
    viewerValue:
      "The viewer leaves knowing what changed and what still needs proof.",
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
  const pads =
    angle.lane === "status_money" || angle.lane === "money"
      ? [
          "The split matters: reviews point to quality, while early Steam numbers show who paid attention before the cheaper route opened.",
          "The next pressure point is the normal launch: it either builds on the premium crowd or exposes a short-lived spike.",
          "The stronger read separates the proof point from launch-week theatre.",
          "That gives players a clearer way to judge the next marketing wave.",
          "The wider audience is where the story either holds or fades.",
        ]
      : [
          "The split matters: a score can earn attention, but players still need to see whether the wider audience agrees.",
          "The next pressure point is the launch itself: does attention grow after the first headline fades?",
          "The stronger read separates a real proof point from a store-banner line.",
          "That gives players a clearer way to judge the next promotion wave.",
          "The wider audience is where the story either holds or fades.",
        ];
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
