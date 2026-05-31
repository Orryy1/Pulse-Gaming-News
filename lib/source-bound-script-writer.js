"use strict";

const {
  countSpokenWords,
  secondsPerWordForTtsProvider,
} = require("./services/short-runtime-planner");
const {
  buildAngleFirstScript,
} = require("./editorial-angle-engine");

const EXACT_CTA = "Follow Pulse Gaming so you never miss a beat.";
const DEFAULT_LOCAL_SOURCE_BOUND_SECONDS_PER_WORD = 0.35;

const HOST_SOURCE_NAMES = new Map([
  ["aftermath.site", "Aftermath"],
  ["gamesradar.com", "GamesRadar"],
  ["pcgamer.com", "PC Gamer"],
  ["rockpapershotgun.com", "Rock Paper Shotgun"],
  ["twistedvoxel.com", "Twisted Voxel"],
  ["pcgamesn.com", "PCGamesN"],
  ["ign.com", "IGN"],
  ["eurogamer.net", "Eurogamer"],
  ["thegamepost.com", "The Game Post"],
  ["thephrasemaker.com", "The Phrasemaker"],
  ["nintendo.com", "Nintendo"],
  ["xbox.com", "Xbox Wire"],
  ["playstation.com", "PlayStation Blog"],
  ["steampowered.com", "Steam"],
]);

const COMMUNITY_PROMPT_RE =
  /\b(?:what(?:'s| is) the best|did we lose|came across|had a .+ pointed|just found out|finally met|made me feel|this is exactly|how to make your game|safe rooms look like this)\b/i;

const SOURCE_BACKED_REDDIT = new Set(["gamingleaksandrumours"]);

function normaliseText(value) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u2013\u2014]/g, ",")
    .replace(/\s+/g, " ")
    .trim();
}

function sentenceCase(value) {
  const text = normaliseText(value).replace(/[.!,;:\s]+$/, "");
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function lowerFirst(value) {
  const text = normaliseText(value).replace(/[.!,;:\s]+$/, "");
  if (!text) return "";
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

function sourceNameFromUrl(url) {
  try {
    const host = new URL(String(url || "")).hostname.replace(/^www\./, "").toLowerCase();
    if (HOST_SOURCE_NAMES.has(host)) return HOST_SOURCE_NAMES.get(host);
    const base = host.split(".")[0] || "the source";
    return base
      .split(/[-_]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return "";
  }
}

function hasNonRedditArticle(story = {}) {
  const url = String(story.article_url || story.source_url || story.url || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;
  if (/reddit\.com|redd\.it/i.test(url)) return false;
  if (/\.(?:avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(url)) return false;
  return true;
}

function isTrustedSourceBackedStory(story = {}) {
  if (String(story.source_type || "").toLowerCase() === "rss") return true;
  if (hasNonRedditArticle(story)) return true;
  const subreddit = String(story.subreddit || story.source_name || "")
    .toLowerCase()
    .replace(/^r\//, "")
    .trim();
  return SOURCE_BACKED_REDDIT.has(subreddit);
}

function shouldUseSourceBoundFallback(story = {}) {
  if (!story || !story.title) return false;
  if (!isTrustedSourceBackedStory(story)) return false;
  if (COMMUNITY_PROMPT_RE.test(String(story.title || "")) && !hasNonRedditArticle(story)) {
    return false;
  }
  return true;
}

function classifyFromTitle(title = "") {
  const text = String(title || "").toLowerCase();
  if (/\b(?:rumou?r|reportedly|leak|leaked|slipped up|seems like|may|might|could)\b/.test(text)) {
    if (/\bleak|leaked|slipped up\b/.test(text)) return "[LEAK]";
    return "[RUMOR]";
  }
  if (/\b(?:breaking|just announced|just confirmed)\b/.test(text)) return "[BREAKING]";
  return "[CONFIRMED]";
}

function sourceUrlFor(story = {}) {
  return story.article_url || story.source_url || story.url || "";
}

function isLocalProvider(provider = "") {
  return /^(local|voxcpm|voicebox)$/i.test(String(provider || "").trim());
}

function sourceBoundSecondsPerWord(provider = "", env = process.env) {
  const override = Number(
    env.SOURCE_BOUND_SECONDS_PER_WORD ||
      env.SOURCE_BOUND_LOCAL_SECONDS_PER_WORD ||
      env.LOCAL_SCRIPT_EXTENSION_SECONDS_PER_WORD,
  );
  if (Number.isFinite(override) && override > 0) return override;
  if (isLocalProvider(provider)) return DEFAULT_LOCAL_SOURCE_BOUND_SECONDS_PER_WORD;
  return secondsPerWordForTtsProvider(provider, env);
}

function titleSubject(title = "") {
  const clean = normaliseText(title)
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+-\s+.*$/g, "")
    .replace(/\s+immediately\b.*$/i, "")
    .replace(/\s+has\b.*$/i, "")
    .replace(/\s+just\b.*$/i, "")
    .replace(/\s+gets\b.*$/i, "")
    .replace(/\s+says\b.*$/i, "")
    .replace(/\s+confirms\b.*$/i, "")
    .trim();
  if (clean.split(/\s+/).length >= 2 && clean.split(/\s+/).length <= 6) {
    return clean;
  }
  const known = normaliseText(title).match(
    /\b(?:Forza Horizon 6|Subnautica 2|Stop Killing Games|GTA 6|Final Fantasy 7 Rebirth|Nintendo Switch 2|Windows 11)\b/i,
  );
  return known ? known[0] : "This update";
}

function cleanClaim(title = "") {
  return normaliseText(title)
    .replace(/\s+-\s+.*$/g, "")
    .replace(/\s+and that's\s+/i, ". That is ")
    .replace(/,+/g, ",")
    .replace(/\s+,/g, ",")
    .replace(/\$120\b/g, "$120")
    .replace(/,\s*$/g, "")
    .replace(/,\./g, ".")
    .replace(/[.!\s]+$/g, "");
}

function hasSourcePhrase(sourceMaterial = "", re) {
  return re.test(String(sourceMaterial || ""));
}

function storyAndSourceText(story = {}, sourceMaterial = "") {
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

function hasForzaSteamPlayerCue(text = "") {
  return /\b(?:Steam|concurrent|players?|early[-\s]?access|premium|Steam peak|Steam record|\$120|120 dollars)\b/i.test(
    String(text || ""),
  );
}

function hasForzaReviewScoreCue(text = "") {
  return /\b(?:Metacritic|review|reviews?|rated|rating|score|critic|critics)\b/i.test(
    String(text || ""),
  );
}

function isForzaSteamPlayerStory(story = {}, sourceMaterial = "") {
  const title = normaliseText(story.title);
  if (!/Forza Horizon 6/i.test(title)) return false;
  if (hasForzaReviewScoreCue(title) && !hasForzaSteamPlayerCue(title)) return false;
  return hasForzaSteamPlayerCue(storyAndSourceText(story, sourceMaterial));
}

function isForzaReviewScoreStory(story = {}, sourceMaterial = "") {
  const title = normaliseText(story.title);
  if (!/Forza Horizon 6/i.test(title)) return false;
  return hasForzaReviewScoreCue(storyAndSourceText(story, sourceMaterial));
}

function buildHook(story = {}, sourceMaterial = "") {
  const title = normaliseText(story.title);
  if (isForzaSteamPlayerStory(story, sourceMaterial)) {
    return "Forza Horizon 6 just put up a wild Steam number.";
  }
  if (isForzaReviewScoreStory(story, sourceMaterial)) {
    return "Forza Horizon 6 just grabbed the year's top review-score slot.";
  }
  if (/Subnautica 2/i.test(title) && /\b(?:sold|copies|players|million)\b/i.test(title)) {
    return "Subnautica 2 just turned into a sales monster.";
  }
  if (/Stop Killing Games|server shutdowns|AB\s*1921/i.test(title)) {
    return "California just moved a game ownership bill forward.";
  }
  if (/Windows 11|graphics drivers/i.test(title)) {
    return "Microsoft just admitted a nasty Windows gaming problem.";
  }
  if (hasSourcePhrase(sourceMaterial, /\bSteam\b/i)) {
    return `${titleSubject(title)} just picked up a major Steam datapoint.`;
  }
  return sentenceCase(`${titleSubject(title)} just picked up a player-facing update`);
}

function specificContextSentences(story = {}, sourceMaterial = "") {
  const title = normaliseText(story.title);
  const sentences = [];

  if (isForzaSteamPlayerStory(story, sourceMaterial)) {
    sentences.push(
      "That already beats Forza Horizon five's all-time Steam peak, while only counting the early-access crowd.",
      "The caveat matters.",
      "This is not total players across Xbox, Game Pass, Microsoft Store or the standard launch.",
      "It is one visible PC leaderboard.",
      "But that makes the number sharper, because the cheaper wave has not fully arrived yet.",
    );
    if (/Japan/i.test(sourceMaterial) || /japan/i.test(title)) {
      sentences.push(
        "Players have wanted the Japan setting for years, and this is the first public data point showing that demand is turning into paid play.",
      );
    }
    sentences.push(
      "The next test is retention, because a giant early-access peak only matters if the full launch keeps climbing.",
      "For Xbox, the useful comparison is simple: the premium-only opening has already beaten the last game's biggest Steam moment.",
      "That does not prove long-term success yet, but it does make the launch harder to dismiss as trailer hype.",
    );
    return sentences;
  }

  if (isForzaReviewScoreStory(story, sourceMaterial)) {
    sentences.push(
      "The score is the story, but it cannot carry sales data by itself.",
      "A Metacritic lead is a critic snapshot, not total sales, total players or a long-term verdict.",
      "That distinction matters because a review score can move attention before the wider launch finishes rolling out.",
      "Now the wider audience has to show whether the praised setting and driving model hold up.",
      "Critic momentum is not sales certainty.",
    );
    if (/Japan/i.test(sourceMaterial) || /japan/i.test(title)) {
      sentences.push(
        "If the source mentions Japan, keep it as setting context, not proof of sales performance.",
      );
    }
    return sentences;
  }

  if (/Subnautica 2/i.test(title)) {
    sentences.push(
      "The important wording is Early Access, not Electronic Arts.",
      "This is a sales and player-count story, not a final verdict on the finished game.",
      "The scale still matters because survival games usually build through word of mouth, not just one launch-day advert.",
      "If the numbers hold, the argument around Krafton's bonus dispute becomes much harder to ignore.",
      "The clean takeaway is that players are voting with purchases while the business side is still under a spotlight.",
    );
    return sentences;
  }

  if (/Stop Killing Games|server shutdowns|AB\s*1921/i.test(title)) {
    sentences.push(
      "This is about access after shutdown, not one review score or one angry forum thread.",
      "The key nuance is that a committee vote is progress, not a finished law.",
      "Publishers would still have room to argue details, but the political question is now much clearer.",
      "When a company sells an online game, players are asking what should survive after the servers go dark.",
      "That is why this story matters beyond California: it turns a gamer complaint into a policy fight.",
    );
    return sentences;
  }

  sentences.push(
    "The player impact is the part worth watching: price, access, platform support or trust changes when the official details land.",
    "A smaller factual story still works when it tells players what changes and what does not.",
    "Players need the plain detail: what changed, what is still missing and why it matters.",
  );
  return sentences;
}

function sourceLeadSentence(story = {}, sourceName = "the source") {
  const title = cleanClaim(story.title);
  if (!title) return `${sourceName} has published a new gaming update.`;
  return `${sourceName} reports ${sentenceCase(title)}`;
}

function buildSourceBoundFallbackScript(story = {}, options = {}) {
  if (!shouldUseSourceBoundFallback(story)) return null;

  const sourceUrl = sourceUrlFor(story);
  const sourceName = options.sourceName || sourceNameFromUrl(sourceUrl) || "the source";
  const sourceMaterial = String(options.sourceMaterial || "");
  const profile = options.runtimeProfile || {};
  const provider = profile.provider || options.ttsProvider || process.env.TTS_PROVIDER || "local";
  const secondsPerWord =
    Number(profile.secondsPerWord) > 0
      ? Number(profile.secondsPerWord)
      : sourceBoundSecondsPerWord(provider, options.env || process.env);
  const minWords = Number(profile.minWords) || Math.ceil(61 / secondsPerWord);
  const maxWords = Number(profile.maxWords) || Math.floor(75 / secondsPerWord);
  const aimMin = Number(profile.aimMin) || Math.ceil(minWords + (maxWords - minWords) * 0.25);
  const aimMax = Number(profile.aimMax) || Math.floor(maxWords - (maxWords - minWords) * 0.25);

  const angleFirst = buildAngleFirstScript(story, {
    ...options,
    sourceName,
    sourceMaterial,
    runtimeProfile: {
      provider,
      secondsPerWord,
      minWords,
      maxWords,
      aimMin,
      aimMax,
    },
  });
  if (angleFirst) return angleFirst;

  const hook = buildHook(story, sourceMaterial);
  const sentences = [
    hook,
    sourceLeadSentence(story, sourceName),
    ...specificContextSentences(story, sourceMaterial),
  ];

  const pads = [
    "That keeps the update focused on what the report actually shows.",
    "Loose speculation would make the story weaker than the actual update.",
    "The confirmed detail should carry the tension without extra padding.",
    "For players, the payoff is knowing whether this changes a buy, download, trust or watchlist decision.",
  ];

  let bodySentences = [...sentences];
  let padIndex = 0;
  while (
    countSpokenWords(`${bodySentences.join(" ")} ${EXACT_CTA}`) < aimMin &&
    padIndex < pads.length
  ) {
    bodySentences.push(pads[padIndex]);
    padIndex += 1;
  }

  while (
    countSpokenWords(`${bodySentences.join(" ")} ${EXACT_CTA}`) > maxWords &&
    bodySentences.length > 4
  ) {
    bodySentences.splice(bodySentences.length - 2, 1);
  }

  const fullScript = `${bodySentences.join(" ")} ${EXACT_CTA}`
    .replace(/\s+/g, " ")
    .trim();
  const wordCount = countSpokenWords(fullScript);

  if (wordCount < minWords || wordCount > maxWords) {
    return null;
  }

  const classification = classifyFromTitle(story.title);
  return {
    classification,
    hook,
    body: bodySentences.slice(1).join(" "),
    cta: EXACT_CTA,
    full_script: fullScript,
    word_count: wordCount,
    suggested_thumbnail_text: titleSubject(story.title).slice(0, 40).toUpperCase(),
    suggested_title: titleSubject(story.title).slice(0, 60),
    content_pillar: classification === "[RUMOR]" ? "Rumour Watch" : "Confirmed Drop",
    script_generation_status: "script_ready",
    script_source: "source_bound_fallback",
  };
}

module.exports = {
  buildSourceBoundFallbackScript,
  shouldUseSourceBoundFallback,
  sourceNameFromUrl,
};
