"use strict";

const GAMING_SIGNALS = [
  "video game",
  "videogame",
  "gaming",
  "gameplay",
  "game pass",
  "xbox",
  "playstation",
  "ps5",
  "ps4",
  "ps plus",
  "playstation plus",
  "ps+",
  "nintendo",
  "switch 2",
  "switch",
  "steam",
  "steam store",
  "steam deck",
  "epic games store",
  "console",
  "pc game",
  "dlc",
  "patch",
  "update",
  "price cut",
  "game release",
  "developer",
  "publisher",
  "studio says",
  "game trailer",
  "gameplay trailer",
  "early access",
  "remake",
  "remaster",
  "sequel",
  "mindseye",
  "elden ring",
  "fortnite",
  "gta",
  "grand theft auto",
  "black flag",
  "assassin's creed",
  "assassins creed",
  "bethesda",
  "elder scrolls",
  "skyrim",
  "fallout",
  "starfield",
  "doom",
  "quake",
  "halo",
  "gears of war",
  "forza",
  "call of duty",
  "battlefield",
  "mario",
  "zelda",
  "metroid",
  "pokemon",
  "pokémon",
  "resident evil",
  "monster hunter",
  "silent hill",
  "metal gear",
  "final fantasy",
  "kingdom hearts",
  "dragon quest",
  "street fighter",
  "devil may cry",
  "cyberpunk",
  "the witcher",
  "witcher",
  "red dead",
  "minecraft",
  "diablo",
  "overwatch",
  "warcraft",
  "league of legends",
  "valorant",
  "apex legends",
  "destiny",
  "persona",
  "sonic",
  "tomb raider",
  "death stranding",
  "fromsoftware",
  "metro 2039",
  "metro",
];

const ENTERTAINMENT_SIGNALS = [
  "season",
  "episode",
  "tv",
  "television",
  "series",
  "netflix",
  "hbo",
  "disney+",
  "marvel",
  "dc studios",
  "film",
  "movie",
  "cinema",
  "box office",
  "actor",
  "actress",
  "casting",
  "cast",
  "celebrity",
  "showrunner",
  "house of the dragon",
  "game of thrones",
];

const GAMING_ADAPTATION_SIGNALS = [
  "movie",
  "film",
  "tv",
  "television",
  "casting",
  "cast",
  "actor",
  "actress",
];

function normaliseText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9+#.'\s-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsPhrase(hay, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(hay);
}

function collectMatches(hay, terms) {
  return terms.filter((term) => containsPhrase(hay, term));
}

function evaluatePulseGamingTopicality(story, { channelId = null } = {}) {
  const channel = (channelId || "pulse-gaming").toLowerCase();
  if (channel && channel !== "pulse-gaming") {
    return {
      decision: "accept",
      reason: "non_pulse_channel_not_gated",
      matchedGamingSignals: [],
      matchedEntertainmentSignals: [],
      category: "not_applicable",
    };
  }

  const hay = normaliseText(
    [
      story?.title,
      story?.body,
      story?.hook,
      story?.full_script,
      story?.subreddit,
      story?.flair,
      story?.content_pillar,
    ]
      .filter(Boolean)
      .join(" "),
  );
  const titleHay = normaliseText(story?.title || "");
  const titleGamingSignals = collectMatches(titleHay, GAMING_SIGNALS);
  const titleEntertainmentSignals = collectMatches(
    titleHay,
    ENTERTAINMENT_SIGNALS,
  );

  const matchedGamingSignals = collectMatches(hay, GAMING_SIGNALS);
  const matchedEntertainmentSignals = collectMatches(hay, ENTERTAINMENT_SIGNALS);
  const matchedAdaptationSignals = collectMatches(hay, GAMING_ADAPTATION_SIGNALS);
  const hasGaming = matchedGamingSignals.length > 0;
  const hasEntertainment = matchedEntertainmentSignals.length > 0;
  const hasAdaptation = hasGaming && matchedAdaptationSignals.length > 0;

  if (titleEntertainmentSignals.length > 0 && titleGamingSignals.length === 0) {
    return {
      decision: "reject",
      reason: "off_topic_entertainment",
      matchedGamingSignals,
      matchedEntertainmentSignals,
      category: "off_topic_entertainment",
    };
  }

  if (hasAdaptation) {
    return {
      decision: "review",
      reason: "gaming_adaptation_needs_manual_review",
      matchedGamingSignals,
      matchedEntertainmentSignals,
      category: "gaming_adaptation",
    };
  }

  if (hasGaming) {
    return {
      decision: "accept",
      reason: "gaming_topic_match",
      matchedGamingSignals,
      matchedEntertainmentSignals,
      category: "gaming",
    };
  }

  if (hasEntertainment) {
    return {
      decision: "reject",
      reason: "off_topic_entertainment",
      matchedGamingSignals,
      matchedEntertainmentSignals,
      category: "off_topic_entertainment",
    };
  }

  return {
    decision: "reject",
    reason: "no_gaming_topic_signal",
    matchedGamingSignals,
    matchedEntertainmentSignals,
    category: "unknown_non_gaming",
  };
}

module.exports = {
  evaluatePulseGamingTopicality,
  GAMING_SIGNALS,
  ENTERTAINMENT_SIGNALS,
  GAMING_ADAPTATION_SIGNALS,
};
