"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  buildSourceBoundFallbackScript,
  shouldUseSourceBoundFallback,
  sourceNameFromUrl,
} = require("../../lib/source-bound-script-writer");
const { runScriptCoherenceQa } = require("../../lib/script-coherence-qa");
const { lintScript } = require("../../lib/services/script-lint");
const {
  classifyShortScriptRuntime,
} = require("../../lib/services/short-runtime-planner");
const {
  buildViralScriptIntelligence,
} = require("../../lib/viral-script-intelligence");
const {
  evaluateGoalPublicCopy,
} = require("../../lib/goal-public-copy-qa");

const LOCAL_PROFILE = {
  provider: "local",
  secondsPerWord: 0.3,
  minWords: 204,
  maxWords: 250,
  aimMin: 216,
  aimMax: 238,
};

const SHORT_LOCAL_PROFILE = {
  provider: "local",
  secondsPerWord: 0.35,
  minWords: 175,
  maxWords: 214,
  aimMin: 185,
  aimMax: 205,
};

const BREAKING_LOCAL_PROFILE = {
  provider: "local",
  secondsPerWord: 0.3,
  minWords: 80,
  maxWords: 180,
  aimMin: 105,
  aimMax: 145,
  durationLane: "breaking_news",
};

function publicCopyQaForScript({ story, script, canonicalSubject, sourceName }) {
  const firstLine = script.full_script.split(/(?<=[.!?])\s+/).find(Boolean) || "";
  return evaluateGoalPublicCopy({
    canonical_subject: canonicalSubject,
    canonical_game: canonicalSubject,
    selected_title: script.suggested_title || canonicalSubject,
    short_title: script.suggested_title || canonicalSubject,
    thumbnail_headline: script.suggested_thumbnail_text || canonicalSubject,
    description: `${firstLine} Source: ${sourceName}.`,
    first_spoken_line: firstLine,
    narration_script: script.full_script,
    full_script: script.full_script,
    tts_script: script.full_script,
    primary_source: sourceName,
    primary_source_url: story.article_url || story.url,
    confirmed_claims: [story.title],
  });
}

const SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "lib", "source-bound-script-writer.js"),
  "utf8",
);
const EDITORIAL_ANGLE_SOURCE = fs.readFileSync(
  path.join(__dirname, "..", "..", "lib", "editorial-angle-engine.js"),
  "utf8",
);

const INSTRUCTION_LIKE_PUBLIC_SCRIPT_RE =
  /core detail plainly|keep the claim tight|anything outside the report|outside the narration|outside the script|fake certainty|question is practical|what players can actually do with it|source line|decision filter|useful version is narrow|if the source is right|useful take is not blind hype|headline is only the doorway|listing or patch|how players read the next trailer/i;
const MASS_AUDIENCE_SCAFFOLD_RE =
  /\b(?:useful|practical|there is a catch|the catch is|simple:|real test|real question|smart question|smarter play|real win|useful debate|useful split|useful choice|useful comparison|useful takeaway|useful bit|practical read|practical move)\b/i;
const MOJIBAKE_RE = /(?:â€“|â€”|â€˜|â€™|â€œ|â€|PokÃ©mon)/;

test("source-bound fallback builds a validated Forza script from an article-backed Reddit story", () => {
  const story = {
    id: "1te1oq7",
    title:
      "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players, and that's only counting people willing to pay $120 for early access",
    source_type: "reddit",
    subreddit: "pcgaming",
    article_url:
      "https://www.gamesradar.com/games/racing/forza-horizon-6-immediately-beats-its-predecessors-all-time-steam-record-with-130-000-concurrent-players-and-thats-only-counting-people-willing-to-pay-usd120-for-early-access/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial: "Forza Horizon 6 takes the series to Japan.",
  });

  assert.ok(script);
  assert.equal(script.classification, "[CONFIRMED]");
  assert.match(script.full_script, /GamesRadar reports/);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(script.full_script, /,\./);
  assert.doesNotMatch(script.full_script, /signal|safe read|community is buzzing|verified insider/i);
  assert.ok(script.word_count >= LOCAL_PROFILE.minWords && script.word_count <= LOCAL_PROFILE.maxWords);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));

  const lint = lintScript(script.full_script, {
    minWords: LOCAL_PROFILE.minWords,
    maxWords: LOCAL_PROFILE.maxWords,
  });
  assert.notEqual(lint.result, "fail");
  assert.deepEqual(lint.failures, []);

  const runtime = classifyShortScriptRuntime({
    text: script.full_script,
    secondsPerWord: LOCAL_PROFILE.secondsPerWord,
  });
  assert.equal(runtime.result, "pass");
});

test("source-bound fallback builds the Xbox PC announcement from exact first-party facts", () => {
  const story = {
    id: "rss_5efb04ad7c4889e1",
    title:
      "Play More of the Games You Love, Wherever You Play with XBOX Backward Compatibility on PC",
    source_type: "rss",
    subreddit: "Xbox Wire",
    url: "https://news.xbox.com/en-us/2026/07/22/xbox-backward-compatibility-on-pc/",
  };
  const sourceMaterial =
    "Xbox Backward Compatibility on PC launches in early release with four classic original XBOX games. " +
    "BLiNX: The Time Sweeper, Conker: Live and Reloaded, Crimson Skies: High Road to Revenge and Fuzion Frenzy are playable on PC and supported handhelds. " +
    "Each game is included with all XBOX Game Pass plans. Existing console digital licenses carry over to PC. " +
    "Achievements arrive in the coming months.";

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: BREAKING_LOCAL_PROFILE,
    sourceMaterial,
  });

  assert.ok(script);
  assert.equal(script.suggested_title, "4 Xbox Classics Hit PC, Achievements Come Later");
  assert.match(script.full_script, /BLiNX/i);
  assert.match(script.full_script, /Conker: Live and Reloaded/i);
  assert.match(script.full_script, /Crimson Skies/i);
  assert.match(script.full_script, /Fuzion Frenzy/i);
  assert.match(script.full_script, /digital licences carry over/i);
  assert.match(script.full_script, /achievements arrive in the coming months/i);
  assert.doesNotMatch(script.full_script, /every Xbox game|entire(?:ly)? new library/i);
  assert.doesNotMatch(script.full_script, /purchase(?:d)? (?:them )?(?:directly )?(?:via|through) Game Pass/i);
  assert.ok(
    script.word_count >= BREAKING_LOCAL_PROFILE.minWords &&
      script.word_count <= BREAKING_LOCAL_PROFILE.maxWords,
  );

  const quality = buildViralScriptIntelligence({
    story: {
      ...story,
      source_name: "Xbox Wire",
      source_material_excerpt: sourceMaterial,
    },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("source-bound fallback does not inject Steam player-count context into Forza review-score stories", () => {
  const story = {
    id: "1tftq7f",
    title: "Forza Horizon 6 Becomes Highest Rated Game of 2026 on Metacritic",
    source_type: "reddit",
    subreddit: "PCMasterRace",
    article_url:
      "https://twistedvoxel.com/forza-horizon-6-becomes-highest-rated-game-of-2026-on-metacritic/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "Twisted Voxel reports Forza Horizon 6 reached a 92 Metacritic score and is currently the highest rated game of 2026. The story is about critic score framing, not Steam player counts or sales.",
  });

  assert.ok(script);
  assert.match(script.hook, /Xbox/i);
  assert.match(script.full_script, /Metacritic/i);
  assert.doesNotMatch(script.full_script, /Steam number|Steam peak|concurrent players|early-access crowd|\$120/i);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));
});

test("source-bound fallback turns Forza free-car updates into concrete live-service value scripts", () => {
  const story = {
    id: "rss_9c02586434dedbd9",
    title: "Next Batch of Free Cars Confirmed for Forza Horizon 6",
    source_type: "rss",
    subreddit: "IGN",
    article_url: "https://www.ign.com/articles/next-batch-of-free-cars-confirmed-for-forza-horizon-6",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceName: "IGN",
    sourceMaterial:
      "IGN reports the Horizon Playlist Series 2, dubbed Horizon Decades, will run from June 18 to July 16, adding a bunch of free cars to Forza Horizon 6.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^Forza Horizon 6\b/);
  assert.match(script.full_script, /IGN reports/i);
  assert.match(script.full_script, /free cars/i);
  assert.match(script.full_script, /Horizon Decades|Series 2|June 18|July 16/i);
  assert.match(script.full_script, /reason to come back|weekly habit|live-service/i);
  assert.doesNotMatch(script.full_script, /Metacritic|review score|Steam peak|Premium Edition|GTA|subscription/i);
  assert.doesNotMatch(
    script.full_script,
    /player-facing detail|separating from the noise|reason to exist beyond repeating the feed|watchlist|stronger short keeps|fades into the feed|something specific to judge/i,
  );
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.ok(script.word_count >= LOCAL_PROFILE.minWords && script.word_count <= LOCAL_PROFILE.maxWords);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));

  const quality = buildViralScriptIntelligence({
    story: { ...story, source_name: "IGN" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
  assert.ok(quality.viral_score >= 75, JSON.stringify(quality, null, 2));
});

test("source-bound fallback does not narrate editorial instructions", () => {
  const story = {
    id: "resident_evil_requiem_preview",
    title: "Resident Evil Requiem shows new first-person gameplay in latest preview",
    source_type: "reddit",
    subreddit: "Games",
    article_url:
      "https://www.ign.com/articles/resident-evil-requiem-preview-first-person-gameplay",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "IGN reports Resident Evil Requiem has new first-person gameplay footage, with a closer look at exploration, lighting and survival-horror pacing.",
  });

  assert.ok(script);
  assert.match(script.full_script, /Resident Evil Requiem/i);
  assert.match(script.full_script, /IGN/i);
  assert.doesNotMatch(script.full_script, INSTRUCTION_LIKE_PUBLIC_SCRIPT_RE);
});

test("source-bound fallback does not misroute gameplay previews as review-score scripts", () => {
  const story = {
    id: "resident_evil_requiem_preview",
    title: "Resident Evil Requiem shows new first-person gameplay in latest preview",
    source_type: "reddit",
    subreddit: "Games",
    article_url:
      "https://www.ign.com/articles/resident-evil-requiem-preview-first-person-gameplay",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "IGN reports Resident Evil Requiem has new first-person gameplay footage, with a closer look at exploration, lighting and survival-horror pacing.",
  });

  assert.ok(script);
  assert.match(script.full_script, /gameplay|footage|movement|camera|controller/i);
  assert.doesNotMatch(script.full_script, /score|critic badge|review conversation|Metacritic/i);
});

test("source-bound fallback treats Bungie active-development reports as a live-service trust story", () => {
  const story = {
    id: "bungie_active_development",
    title:
      "\"Almost All\" Of Bungie Reportedly Didn't Know Destiny 2 Was Ending Active Development Until It Was Announced",
    source_type: "reddit",
    subreddit: "GamingLeaksAndRumours",
    article_url:
      "https://thegamepost.com/bungie-destiny-2-active-development-ending/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "The Game Post reports that almost all Bungie staff did not know Destiny 2 was ending active development until the announcement went public.",
  });

  assert.ok(script);
  assert.match(script.full_script, /Destiny 2/i);
  assert.match(script.full_script, /Bungie/i);
  assert.match(script.full_script, /The Game Post reports/i);
  assert.match(script.hook, /Destiny 2/i);
  assert.doesNotMatch(script.full_script, /Almost All Of Bungie/i);
  assert.doesNotMatch(script.full_script, /review score|critic badge|Metacritic|store-banner|trailer, listing or patch/i);
  assert.doesNotMatch(script.full_script, INSTRUCTION_LIKE_PUBLIC_SCRIPT_RE);
  assert.ok(script.word_count >= LOCAL_PROFILE.minWords && script.word_count <= LOCAL_PROFILE.maxWords);

  const lint = lintScript(script.full_script, {
    minWords: LOCAL_PROFILE.minWords,
    maxWords: LOCAL_PROFILE.maxWords,
  });
  assert.deepEqual(lint.failures, []);

  const runtime = classifyShortScriptRuntime({
    text: script.full_script,
    secondsPerWord: LOCAL_PROFILE.secondsPerWord,
  });
  assert.equal(runtime.result, "pass");
});

test("source-bound fallback treats Bungie layoff reports as a separate studio-pressure story", () => {
  const story = {
    id: "bungie_layoffs",
    title: "Bungie Plans Layoffs After Ending 'Destiny 2' Development",
    source_type: "reddit",
    subreddit: "gaming",
    article_url:
      "https://www.bloomberg.com/news/articles/2026-05-21/bungie-plans-layoffs-after-ending-destiny-2-development",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "Bloomberg reports Bungie is planning layoffs after ending Destiny 2 development.",
  });

  assert.ok(script);
  assert.match(script.full_script, /Destiny 2/i);
  assert.match(script.full_script, /Bungie/i);
  assert.match(script.full_script, /Bloomberg reports/i);
  assert.match(script.hook, /jobs|layoffs|Bungie/i);
  assert.doesNotMatch(script.full_script, /staff only learned|announcement went public|almost all Bungie staff/i);
  assert.doesNotMatch(script.full_script, /review score|critic badge|Metacritic|store-banner/i);
  assert.doesNotMatch(script.full_script, INSTRUCTION_LIKE_PUBLIC_SCRIPT_RE);
  assert.ok(script.word_count >= LOCAL_PROFILE.minWords && script.word_count <= LOCAL_PROFILE.maxWords);
});

test("source-bound fallback refuses general community Reddit posts without article backing", () => {
  const story = {
    title: "Had a PS5 for years and someone just pointed this out to me.",
    source_type: "reddit",
    subreddit: "PS5",
  };

  assert.equal(shouldUseSourceBoundFallback(story), false);
  assert.equal(buildSourceBoundFallbackScript(story, { runtimeProfile: LOCAL_PROFILE }), null);
});

test("source-bound fallback keeps Stop Killing Games wording intact", () => {
  const story = {
    title:
      "California bill backed by Stop Killing Games campaign pushing to keep games playable after server shutdowns passes key hurdle, paving way for full assembly vote",
    source_type: "reddit",
    subreddit: "Games",
    article_url:
      "https://www.rockpapershotgun.com/california-bill-pushing-to-keep-games-playable-after-server-shutdowns-passes-key-hurdle-paving-way-for-full-assembly-vote",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
  });

  assert.ok(script);
  assert.match(script.full_script, /Stop Killing Games/);
  assert.doesNotMatch(script.full_script, /Stop Ending Games/i);
  assert.match(script.full_script, /committee vote is progress, not a finished law/i);
});

test("source-bound fallback rewrites Mixtape as a viewer-facing preservation story", () => {
  const story = {
    id: "mixtape_rps",
    title:
      "Mixtape will be safe from a music licensing related delisting, ensured by its developer paying extra for the privilege",
    source_type: "reddit",
    subreddit: "Games",
    article_url:
      "https://www.rockpapershotgun.com/mixtape-will-be-safe-from-a-music-licensing-related-delisting-ensured-by-its-developer-paying-extra-for-the-privilege",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: LOCAL_PROFILE,
    sourceMaterial:
      "Rock Paper Shotgun reports that Mixtape's developer paid extra for music licences in perpetuity, reducing future delisting risk.",
  });

  assert.ok(script);
  assert.match(script.hook, /^Mixtape\b/);
  assert.match(script.full_script, /music licences last in perpetuity/i);
  assert.match(script.suggested_title, /Mixtape/i);
  assert.doesNotMatch(
    script.full_script,
    /source-backed update|not a blank cheque|not a blank check|invent extra details|named source confirms|wait-and-see column|Reddit reaction into evidence/i,
  );
});

test("source-bound fallback turns Valorant Vanguard panic into a source-safe anti-cheat trust story", () => {
  const story = {
    id: "1tkik53",
    title:
      "Valorant's new Vanguard update seems to be bricking cheaters' PCs. Riot's response? \"Congrats on your $6k paperweights\"",
    source_type: "reddit",
    subreddit: "pcgaming",
    article_url:
      "https://www.pcgamesn.com/valorant/vanguard-update-bricking-cheaters-pcs",
  };

  const script = buildSourceBoundFallbackScript(story, {
    env: { TTS_PROVIDER: "local" },
    sourceMaterial:
      "PCGamesN reports Riot says Vanguard cannot brick a PC, but the anti-cheat update can block DMA cheat hardware. Riot said it would not and cannot impact normal PC functionality.",
  });

  assert.ok(script);
  assert.match(script.hook, /Valorant|Vanguard/i);
  assert.match(script.full_script, /PCGamesN reports/i);
  assert.match(script.full_script, /Vanguard/i);
  assert.match(script.full_script, /DMA cheat hardware/i);
  assert.match(script.full_script, /kernel-level anti-cheat/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(script.full_script, /has a new detail players should clock|another update exists|fades into the feed/i);
  assert.doesNotMatch(script.full_script, /bricking cheaters' PCs\./i);
  assert.doesNotMatch(script.full_script, /This isn't|This is not|source-backed update|safe read|useful version|boring, exact explanations/i);
  assert.ok(script.word_count >= 175 && script.word_count <= 214);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));

  const lint = lintScript(script.full_script, {
    minWords: 175,
    maxWords: 214,
  });
  assert.deepEqual(lint.failures, []);

  const runtime = classifyShortScriptRuntime({
    text: script.full_script,
    secondsPerWord: 0.35,
  });
  assert.equal(runtime.result, "pass");
});

test("source-bound fallback turns subscription access into a concrete player-debate story", () => {
  const story = {
    id: "rss_600fca97d3e40552",
    title: "GTA 5 Joins A Subscription Ahead Of GTA 6 Launch",
    source_type: "rss",
    subreddit: "GameSpot",
    article_url:
      "https://www.gamespot.com/articles/gta-5-joins-a-subscription-ahead-of-gta-6-launch/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    env: { TTS_PROVIDER: "local" },
    sourceName: "GameSpot",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
  });

  assert.ok(script);
  assert.match(script.hook, /GTA 5/i);
  assert.match(script.full_script, /GameSpot reports/i);
  assert.match(script.full_script, /subscription/i);
  assert.match(script.full_script, /GTA 6/i);
  assert.match(script.full_script, /worth reinstalling|wait for GTA 6|reinstall/i);
  assert.match(script.full_script, /back catalogue|warm-up/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    script.full_script,
    /new detail players should clock|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps/i,
  );

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));
});

test("source-bound fallback keeps non-GTA subscription access scripts on the named game", () => {
  const story = {
    id: "rss_a4b5c10c9b4d8018",
    title: "EA SPORTS FC 26 Is Now on EA Play",
    source_type: "rss",
    article_url: "https://news.xbox.com/en-us/2026/06/18/ea-play-fc-26/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "Xbox Wire reports EA SPORTS FC 26 is now available through EA Play, giving subscribers a lower-friction way to try the football game before deciding whether to buy.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^EA SPORTS FC 26\b/);
  assert.match(script.full_script, /Xbox Wire reports/i);
  assert.match(script.full_script, /EA Play/i);
  assert.match(script.full_script, /subscription|try|buy|download/i);
  assert.doesNotMatch(script.full_script, /GTA|Los Santos|Rockstar|sequel marketing|GTA Online/i);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));
});

test("source-bound fallback turns generic fresh trailer stories into concrete viral-ready scripts", () => {
  const story = {
    id: "rss_gta6_cover_art",
    title: "GTA 6 Cover Art and Preorders Have Fans Watching Rockstar Again",
    source_type: "rss",
    subreddit: "GameSpot",
    article_url: "https://www.gamespot.com/articles/gta-6-cover-art-and-preorders/",
    source_name: "GameSpot",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "GameSpot",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "GameSpot reports Rockstar revealed new GTA 6 cover art on YouTube, with Jason and Lucia in the key art while fans are waiting for preorders and the next store listing update.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^GTA 6\b/);
  assert.match(script.full_script, /cover art|preorders|Jason|Lucia|Rockstar/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(
    script.full_script,
    /player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist/i,
  );

  const quality = buildViralScriptIntelligence({
    story: { ...story, source_name: "GameSpot" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
  assert.ok(quality.viral_score >= 75, JSON.stringify(quality, null, 2));
});

test("source-bound fallback turns GTA 6 preorder launch stories into concrete buying-decision scripts", () => {
  const story = {
    id: "rss_3830b2720b250551",
    title: "7 Burning Questions for the GTA 6 Pre-Order Launch",
    source_type: "rss",
    subreddit: "IGN",
    article_url: "https://www.ign.com/articles/gta-6-pre-order-launch-burning-questions",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "IGN",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "GTA 6 is alive. IGN says Rockstar has confirmed that pre-orders launch on June 25, with players still waiting for editions, bonuses and price details.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^GTA 6\b/);
  assert.match(script.full_script, /pre-?orders|June 25|editions|price|buying/i);
  assert.doesNotMatch(script.full_script, /cover art|delay fear|endgame|end game/i);
  assert.doesNotMatch(
    script.full_script,
    /new detail players should clock|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist/i,
  );
});

test("source-bound fallback turns GTA 5 free upgrade stories into concrete current-gen runway scripts", () => {
  const story = {
    id: "rss_46d4ac46639fcfea",
    title:
      "As GTA Online readies for another large update, and GTA 6 approaches, Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series S/X",
    source_type: "rss",
    subreddit: "Eurogamer",
    article_url: "https://www.eurogamer.net/gta-5-free-ps5-xbox-series-x-s-upgrade",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "Eurogamer",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "Eurogamer reports Rockstar Games is giving GTA 5 players on PS4 or Xbox One a free upgrade to GTA 5 on PS5 or Xbox Series X/S as GTA Online readies another large update and GTA 6 approaches.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^GTA 5\b/);
  assert.match(script.full_script, /free upgrade|PS5|Xbox Series X\/S|GTA 6/i);
  assert.match(script.full_script, /current-gen|old players|warm-up|waiting room/i);
  assert.doesNotMatch(
    script.full_script,
    /new detail players should clock|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist/i,
  );
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);
});

test("source-bound fallback turns PlayStation Blog hands-on demo stories into concrete try-before-launch scripts", () => {
  const story = {
    id: "rss_ef48a283a91d0f8f",
    title: "Granblue Fantasy: Relink - Endless Ragnarok hands-on report, demo available today",
    source_type: "rss",
    article_url:
      "https://blog.playstation.com/2026/06/18/granblue-fantasy-relink-endless-ragnarok-hands-on-report-demo-available-today/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "Set to touch down on PlayStation 5 and PlayStation 4 on Thursday, July 9, Granblue Fantasy: Relink - Endless Ragnarok is a massive new expansion built to significantly evolve the high-flying action RPG. At a recent press event, PlayStation Blog had the chance to experience the demo.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^Granblue Fantasy\b/);
  assert.match(script.full_script, /PlayStation Blog reports/i);
  assert.match(script.full_script, /demo|hands-on|July 9|PS5|PlayStation 5/i);
  assert.match(script.full_script, /try|judge|controller|expansion|combat/i);
  assert.doesNotMatch(script.full_script, /subscription|GTA|Los Santos|warm-up act/i);
  assert.doesNotMatch(script.full_script, /the real question is/i);
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));
});

test("source-bound fallback turns Xbox Wire exploration-combat previews into specific player-decision scripts", () => {
  const story = {
    id: "rss_83a2384dad72273d",
    title:
      "How The Adventures of Elliot: The Millennium Tales Balances Exploration, Combat, and Discovery",
    source_type: "rss",
    article_url:
      "https://news.xbox.com/en-us/2026/06/18/the-adventures-of-elliot-exploration-combat-discovery/",
  };

  const script = buildSourceBoundFallbackScript(story, {
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "Xbox Wire explains how The Adventures of Elliot: The Millennium Tales balances exploration, combat and discovery, with players reading whether the throwback RPG loop has enough modern pace.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^The Adventures of Elliot\b/);
  assert.match(script.full_script, /Xbox Wire reports/i);
  assert.match(script.full_script, /exploration|combat|discovery|RPG|pace/i);
  assert.match(script.full_script, /loop|judge|players/i);
  assert.doesNotMatch(script.full_script, /subscription|GTA|Los Santos|warm-up act/i);
  assert.ok(
    (script.full_script.match(/The Adventures of Elliot/g) || []).length <= 2,
    script.full_script,
  );

  const coherence = runScriptCoherenceQa(
    { ...story, ...script },
    { requireCtaField: true, requireFullScriptCta: true },
  );
  assert.equal(coherence.result, "pass", coherence.failures.join(", "));
});

test("source-bound fallback turns Ocarina viewership stories into a debate about demand, not generic update filler", () => {
  const story = {
    id: "rss_e784dee5af18e23f",
    title:
      "Nintendo's latest Direct was reportedly 2026's most-watched Summer Game Fest showcase, and Zelda: Ocarina of Time's remake was the most-viewed trailer",
    source_type: "rss",
    subreddit: "Eurogamer",
    article_url: "https://www.eurogamer.net/nintendo-direct-june-2026-zelda-ocarina-of-time",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "Eurogamer",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "Eurogamer reports June's Nintendo Direct was 2026's most-watched Summer Game Fest showcase, while The Legend of Zelda: Ocarina of Time's remake was the most-viewed trailer.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^Ocarina of Time\b/);
  assert.match(script.full_script, /Nintendo Direct|most-watched|most-viewed trailer|Summer Game Fest/i);
  assert.match(script.full_script, /demand|remake|pressure|expectations/i);
  assert.doesNotMatch(script.full_script, /Ocarina of Time's has/i);
  assert.doesNotMatch(
    script.full_script,
    /new detail players should clock|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist/i,
  );

  const quality = buildViralScriptIntelligence({
    story: { ...story, source_name: "Eurogamer" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("source-bound fallback treats hidden Ocarina remake descriptions as cautious evidence, not a confirmed remake script", () => {
  const story = {
    id: "rss_5a2b699b2d65a5bc",
    title:
      "Nintendo Removes Hidden The Legend of Zelda: Ocarina of Time Switch 2 Description That Suggested It's a Faithful Remake",
    source_type: "rss",
    subreddit: "IGN",
    article_url:
      "https://www.ign.com/articles/nintendo-removes-hidden-the-legend-of-zelda-ocarina-of-time-switch-2-description-that-suggested-its-a-faithful-remake",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "IGN",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "IGN reports Nintendo removed a hidden description for The Legend of Zelda: Ocarina of Time on Switch 2 that fans say suggested a faithful update of the N64 original.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^Ocarina of Time\b/);
  assert.match(script.full_script, /hidden description|removed|Switch 2|faithful|N64/i);
  assert.match(script.full_script, /not confirmation|does not confirm|cautious/i);
  assert.doesNotMatch(script.full_script, /Nintendo Removes Hidden The Legend of Zelda/i);
  assert.doesNotMatch(
    script.full_script,
    /new detail players should clock|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist/i,
  );

  const quality = buildViralScriptIntelligence({
    story: { ...story, source_name: "IGN" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("source-bound fallback turns GTA 6 launch endgame columns into cautious rollout scripts", () => {
  const story = {
    id: "rss_9709766057f774ad",
    title: "Here's How I Know We Are Entering Rockstar's End Game For Launching GTA 6",
    source_type: "rss",
    subreddit: "Kotaku",
    article_url:
      "https://kotaku.com/heres-how-i-know-we-are-entering-rockstars-end-game-for-launching-gta-6-2000708079",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "Kotaku",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "Kotaku says if you were worried about another GTA 6 delay, you can probably stop worrying because Rockstar is entering its end game for launching GTA 6.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^GTA 6\b/);
  assert.match(script.full_script, /Rockstar|launch|delay|rollout/i);
  assert.match(script.full_script, /not proof|does not prove|cautious/i);
  assert.doesNotMatch(
    script.full_script,
    /new detail players should clock|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist/i,
  );
});

test("source-bound fallback treats system patch notes as concrete player-impact scripts", () => {
  const story = {
    id: "rss_switch2_patch",
    title: "Nintendo Switch 2 System Update 22.5.0 Available - Here Are the Patch Notes",
    source_type: "rss",
    subreddit: "IGN",
    article_url: "https://www.ign.com/articles/nintendo-switch-2-system-update-2250-patch-notes",
    source_name: "IGN",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "IGN",
    runtimeProfile: {
      provider: "local",
      secondsPerWord: 0.35,
      minWords: 175,
      maxWords: 214,
      aimMin: 185,
      aimMax: 205,
    },
    sourceMaterial:
      "IGN reports Nintendo Switch 2 system update 22.5.0 is available now, with patch notes covering the latest console firmware update.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^Nintendo Switch 2\b/);
  assert.match(script.full_script, /22\.5\.0|patch notes|console|download|stable/i);
  assert.doesNotMatch(
    script.full_script,
    /player-facing detail|separating from the noise|reason to exist beyond repeating the feed|watchlist|clear date, platform detail or gameplay proof/i,
  );

  const quality = buildViralScriptIntelligence({
    story: { ...story, source_name: "IGN" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
  assert.ok(quality.viral_score >= 75, JSON.stringify(quality, null, 2));
});

test("source-bound fallback treats Game Pass version updates as access stories, not patch notes", () => {
  const story = {
    id: "seed_palworld_10_game_pass_20260708",
    title: "Palworld 1.0 Is About To Test Its Whole Comeback",
    source_type: "rss",
    subreddit: "Xbox Wire",
    article_url: "https://news.xbox.com/en-us/2026/07/07/xbox-game-pass-july-2026-wave-1/",
    source_name: "Xbox Wire",
  };

  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "Xbox Wire",
    runtimeProfile: SHORT_LOCAL_PROFILE,
    sourceMaterial:
      "Xbox Wire says Palworld 1.0 is a Game Pass update on July 10, 2026. Pocketpair says Palworld is exiting Early Access with Version 1.0 on July 10, 2026.",
  });

  assert.ok(script);
  assert.match(script.full_script, /^Palworld 1\.0\b/);
  assert.match(script.full_script, /Game Pass|July 10, 2026|comeback|reinstall|second launch/i);
  assert.doesNotMatch(script.full_script, /system update|patch notes|available now|is live|housekeeping/i);
  assert.doesNotMatch(script.full_script, /Palworld 1\.0 1\.0/i);
});

test("source-bound fallback source does not carry internal analyst-note phrases", () => {
  assert.doesNotMatch(
    SOURCE,
    /source-backed update|not a blank cheque|not a blank check|invent extra details|named source confirms|wait-and-see column|Reddit reaction into evidence|core detail plainly|keep the claim tight|anything outside the report|fake certainty|what players can actually do with it|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist|official follow-up gives players|small update either becomes|one concrete player question|stronger script keeps/i,
  );
  assert.doesNotMatch(
    EDITORIAL_ANGLE_SOURCE,
    /source-backed update|not a blank cheque|not a blank check|invent extra details|named source confirms|wait-and-see column|Reddit reaction into evidence|core detail plainly|keep the claim tight|anything outside the report|fake certainty|what players can actually do with it|player-facing detail|separating from the noise|reason to exist beyond repeating the feed|fades into the feed|stronger short keeps|watchlist|official follow-up gives players|small update either becomes|one concrete player question|stronger script keeps/i,
  );
});

test("source-bound fallback keeps non-horror release-date stories out of horror framing", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_phantom_blade_zero_release_date",
      title: "Phantom Blade Zero release date confirmed for September 9, 2026",
      source_type: "rss",
      subreddit: "IGN",
      article_url: "https://www.ign.com/articles/phantom-blade-zero-release-date-september-2026",
    },
    {
      sourceName: "IGN",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "IGN reports Phantom Blade Zero launches on September 9, 2026 for PS5 and PC after a new gameplay trailer showed fast action combat.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Phantom Blade Zero\b/);
  assert.match(script.full_script, /September 9, 2026|PS5|PC|combat|gameplay/i);
  assert.doesNotMatch(
    script.full_script,
    /horror|licensed weirdness|flat scares|enemy threat|October wildcard|recognisable licence/i,
  );
  assert.doesNotMatch(script.full_script, MASS_AUDIENCE_SCAFFOLD_RE);
});

test("source-bound fallback generic lane writes viewer-facing copy without template scaffolding", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_monster_hunter_wilds_benchmark",
      title: "Monster Hunter Wilds gets a new PC benchmark tool update",
      source_type: "rss",
      subreddit: "PC Gamer",
      article_url: "https://www.pcgamer.com/games/action/monster-hunter-wilds-benchmark-tool-update/",
    },
    {
      sourceName: "PC Gamer",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "PC Gamer reports Monster Hunter Wilds has a new PC benchmark tool update that helps players test performance before changing settings or reinstalling the game.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Monster Hunter Wilds\b/);
  assert.match(script.full_script, /benchmark|performance|settings|PC/i);
  assert.doesNotMatch(
    script.full_script,
    /one concrete player question|fresh .* update|proof still needs to arrive|official follow-up|small update|stronger script|source only answers one part/i,
  );
  assert.doesNotMatch(script.full_script, MASS_AUDIENCE_SCAFFOLD_RE);
});

test("source-bound fallback handles Halo PS5 account requirements without false subscription access", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_halo_campaign_evolved_ps5_account",
      title:
        "Halo: Campaign Evolved PS5 players will require an Xbox account and gamertag to play, as well as PS Plus for split-screen co-op",
      source_type: "rss",
      subreddit: "Eurogamer",
      article_url: "https://www.eurogamer.net/halo-campaign-evolved-ps5-xbox-account-gamertag-psplus",
    },
    {
      sourceName: "Eurogamer",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "Eurogamer reports Halo: Campaign Evolved PS5 players will require an Xbox account and gamertag to play, plus PS Plus to play split-screen co-op.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Halo\b/);
  assert.match(script.full_script, /Xbox account|gamertag|PS Plus|split-screen co-op/i);
  assert.doesNotMatch(script.full_script, /available through PS Plus|joined? a subscription|subscription service|easier to try/i);
});

test("source-bound fallback turns Black Ops port listings into a specific preservation price debate", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_black_ops_ports_pricey_playstation",
      title: "Call of Duty: Black Ops 1 and 2 Listings Have Fans Fearing Pricey PlayStation Ports",
      source_type: "rss",
      subreddit: "IGN",
      article_url:
        "https://www.ign.com/articles/call-of-duty-black-ops-1-and-2-listings-have-fans-fearing-pricey-playstation-ports",
    },
    {
      sourceName: "IGN",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "IGN reports PlayStation listings for Call of Duty: Black Ops 1 and 2 have fans watching whether the classic ports arrive as sensible re-releases or expensive nostalgia.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Black Ops 1 and 2\b/);
  assert.match(script.full_script, /price|ports|preservation|storefront|multiplayer/i);
  assert.doesNotMatch(
    script.full_script,
    /first test is simple|headline belongs in the backlog|next proof has to be visible|player consequence/i,
  );
});

test("source-bound fallback turns Cyberpunk launch damage into a specific CDPR trust-debt script", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_cyberpunk_trust_debt",
      title:
        "CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch",
      source_type: "rss",
      subreddit: "PC Gamer",
      article_url:
        "https://www.pcgamer.com/games/rpg/cd-projekt-red-boss-believes-some-fans-were-forever-burned-by-cyberpunk-2077s-disastrous-launch/",
    },
    {
      sourceName: "PC Gamer",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "PC Gamer reports a CD Projekt Red boss believes some fans lost faith indefinitely after Cyberpunk 2077's disastrous launch.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^CD Projekt Red\b/);
  assert.match(script.full_script, /Cyberpunk 2077|trust|trailer|proof|real build/i);
  assert.doesNotMatch(
    script.full_script,
    /first test is simple|headline belongs in the backlog|next proof has to be visible|player consequence/i,
  );
});

test("source-bound fallback does not say a game is launching on a release date when no date is named", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_gta6_date_reiterated",
      title: "GTA 6 Release Date Confirmed Again By CEO Who Also Explains Why It's Taking So Long",
      source_type: "rss",
      subreddit: "GameSpot",
      article_url: "https://www.gamespot.com/articles/gta-6-release-date-confirmed-again-by-ceo/",
    },
    {
      sourceName: "GameSpot",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "GameSpot reports Take-Two's CEO reiterated the GTA 6 release date and discussed why the game is taking so long, without revealing new footage, editions or price details.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^GTA 6\b/);
  assert.match(script.full_script, /Take-Two|Rockstar|delay|launch|date/i);
  assert.doesNotMatch(script.full_script, /launching on a release date|on a release date|finally has a launch date/i);
});

test("source-bound fallback turns Xbox monetisation layoff stories into a named strategy script", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_xbox_monetisation_layoffs",
      title:
        "As Xbox eyes layoffs, Microsoft's CEO says its videogames aren't monetised enough, so it's not the cancelled games or $68.7 billion deals or AI overspending, then",
      source_type: "rss",
      subreddit: "PC Gamer",
      article_url:
        "https://www.pcgamer.com/gaming-industry/as-xbox-eyes-layoffs-microsofts-ceo-says-its-videogames-arent-monetised-enough/",
    },
    {
      sourceName: "PC Gamer",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "PC Gamer reports Microsoft's CEO said Xbox videogames are not monetised enough as the company eyes layoffs, after cancelled games, a $68.7 billion acquisition and AI spending scrutiny.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Xbox\b/);
  assert.match(script.full_script, /monetised|layoffs|Microsoft|spending|Game Pass|players/i);
  assert.doesNotMatch(script.full_script, /As Xbox eyes layoffs.*just got an update|new As Xbox eyes layoffs/i);
  assert.doesNotMatch(
    script.full_script,
    /first test is simple|headline belongs in the backlog|next proof has to be visible|player consequence/i,
  );
});

test("source-bound fallback turns Xbox dashboard exclusivity labels into a clear platform-trust script", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_xbox_exclusive_dashboard_label",
      title: "Xbox's Confusing Exclusivity Criteria Now Aided by 'EXCLUSIVE' Label on Console Dashboard",
      source_type: "rss",
      subreddit: "IGN",
      article_url: "https://www.ign.com/articles/xbox-confusing-exclusivity-criteria-exclusive-label-dashboard",
    },
    {
      sourceName: "IGN",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "IGN reports Xbox's confusing exclusivity criteria are now aided by an EXCLUSIVE label on the console dashboard, as players try to understand what still counts as an Xbox exclusive.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Xbox\b/);
  assert.match(script.full_script, /EXCLUSIVE label|dashboard|exclusivity|exclusive/i);
  assert.doesNotMatch(
    script.full_script,
    /Xbox's Confusing Exclusivity Criteria.*just got an update|new Xbox's Confusing Exclusivity Criteria/i,
  );
  assert.doesNotMatch(
    script.full_script,
    /first test is simple|headline belongs in the backlog|next proof has to be visible|player consequence/i,
  );
});

test("source-bound fallback turns Lords of the Fallen 2 GTA 6 delay into a named release-calendar script", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_lords_fallen_2_gta6_delay",
      title: "Lords Of The Fallen 2 Delayed To Avoid GTA 6 And Get More Enhancements",
      source_type: "rss",
      subreddit: "PC Gamer",
      article_url:
        "https://www.pcgamer.com/games/action/lords-of-the-fallen-2-delayed-to-avoid-gta-6/",
    },
    {
      sourceName: "PC Gamer",
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial:
        "PC Gamer reports Lords of the Fallen 2 has been delayed to avoid GTA 6 and give the sequel more enhancements before launch.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Lords of the Fallen 2\b/i);
  assert.match(script.full_script, /delayed|delay|GTA 6|enhancements|release calendar/i);
  assert.match(script.full_script, /Rockstar|launch window|publisher|players|pressure/i);
  assert.doesNotMatch(script.suggested_title, /Player Impact/i);
  assert.doesNotMatch(
    script.full_script,
    /one concrete player question|just got an update that changes the player decision|new .{0,80} detail around access,\s*timing,\s*performance or expectations|PLAYER IMPACT|player impact/i,
  );
});

test("source-bound fallback turns Dave the Diver DLC into concrete player impact", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_dave_jungle_dlc",
      title: "Why You Should Follow Dave the Diver to the Jungle in New DLC Today",
      source_type: "rss",
      subreddit: "Xbox Wire",
      article_url: "https://news.xbox.com/en-us/2026/06/18/dave-the-diver-in-the-jungle-out-now/",
    },
    {
      sourceName: "Xbox Wire",
      runtimeProfile: {
        provider: "local",
        secondsPerWord: 0.35,
        minWords: 175,
        maxWords: 214,
        aimMin: 185,
        aimMax: 205,
      },
      sourceMaterial:
        "Xbox Wire reports Dave the Diver goes to the jungle in new DLC available today, with a new biome, new creatures and a reason to return after the main game.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Dave the Diver\b/);
  assert.match(script.full_script, /jungle|DLC|available today|out today/i);
  assert.match(script.full_script, /return|reinstall|come back/i);
  assert.doesNotMatch(
    script.full_script,
    /one concrete player question|fresh .* update|proof still needs to arrive|new detail players should clock/i,
  );

  const quality = buildViralScriptIntelligence({
    story: { id: "rss_dave_jungle_dlc", title: "Why You Should Follow Dave the Diver to the Jungle in New DLC Today", source_name: "Xbox Wire" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("source-bound fallback makes Xbox Free Play Days practical without generic filler", () => {
  const script = buildSourceBoundFallbackScript(
    {
      id: "rss_free_play_days_20260618",
      title: "Free Play Days - PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight",
      source_type: "rss",
      subreddit: "Xbox Wire",
      article_url: "https://news.xbox.com/en-us/2026/06/18/free-play-days-06-18-2026/",
    },
    {
      sourceName: "Xbox Wire",
      runtimeProfile: {
        provider: "local",
        secondsPerWord: 0.35,
        minWords: 175,
        maxWords: 214,
        aimMin: 185,
        aimMax: 205,
      },
      sourceMaterial:
        "Xbox Wire reports Free Play Days includes PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight for a limited weekend trial window.",
    },
  );

  assert.ok(script);
  assert.match(script.full_script, /^Free Play Days\b/);
  assert.match(script.full_script, /PGA Tour 2K25|Two Point Museum|Assetto Corsa|Dead by Daylight/i);
  assert.match(script.full_script, /weekend|trial|download|try/i);
  assert.doesNotMatch(
    script.full_script,
    /one concrete player question|fresh .* update|proof still needs to arrive|new detail players should clock/i,
  );

  const quality = buildViralScriptIntelligence({
    story: { id: "rss_free_play_days_20260618", title: "Free Play Days - PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight", source_name: "Xbox Wire" },
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("source-bound promoted fresh lanes pass goal public-copy QA", () => {
  const cases = [
    {
      canonicalSubject: "EA SPORTS FC 26",
      sourceName: "Xbox Wire",
      story: {
        id: "rss_ea_fc_26_ea_play",
        title: "EA SPORTS FC 26 Is Now on EA Play",
        source_type: "rss",
        subreddit: "Xbox Wire",
        article_url: "https://news.xbox.com/en-us/2026/06/18/ea-play-fc-26/",
      },
      sourceMaterial: "Xbox Wire reports EA SPORTS FC 26 is now available through EA Play.",
    },
    {
      canonicalSubject: "Garfield",
      sourceName: "IGN",
      story: {
        id: "rss_garfield_gameplay",
        title: "Garfield - Escape From Monday Gameplay Trailer Teases the Terror of The Curse of the Spinach Lasagna",
        source_type: "rss",
        subreddit: "IGN",
        article_url: "https://www.ign.com/articles/garfield-escape-from-monday-gameplay-trailer",
      },
      sourceMaterial: "IGN reports a Garfield gameplay trailer shows platforming, camera movement and repeated gameplay beats.",
    },
    {
      canonicalSubject: "GTA 5",
      sourceName: "Eurogamer",
      story: {
        id: "rss_gta5_upgrade",
        title: "Rockstar offers free upgrades to GTA 5 on PS5 and Xbox Series X/S as GTA 6 approaches",
        source_type: "rss",
        subreddit: "Eurogamer",
        article_url: "https://www.eurogamer.net/gta-5-free-ps5-xbox-series-x-s-upgrade",
      },
      sourceMaterial: "Eurogamer reports GTA 5 players on PS4 and Xbox One can upgrade to PS5 and Xbox Series X/S free as GTA Online updates and GTA 6 approaches.",
    },
    {
      canonicalSubject: "Dave the Diver",
      sourceName: "Xbox Wire",
      story: {
        id: "rss_dave_jungle_dlc",
        title: "Why You Should Follow Dave the Diver to the Jungle in New DLC Today",
        source_type: "rss",
        subreddit: "Xbox Wire",
        article_url: "https://news.xbox.com/en-us/2026/06/18/dave-the-diver-in-the-jungle-out-now/",
      },
      sourceMaterial: "Xbox Wire reports Dave the Diver goes to the jungle in new DLC available today, with a new biome, new creatures and a reason to return after the main game.",
    },
    {
      canonicalSubject: "Hellraiser: Revival",
      sourceName: "Eurogamer",
      story: {
        id: "rss_hellraiser_date",
        title: "Hellraiser: Revival hooks a release date with trailer full of Doom-like glory kills and otherworldly powers",
        source_type: "rss",
        subreddit: "Eurogamer",
        article_url: "https://www.eurogamer.net/hellraiser-revival-release-date-trailer",
      },
      sourceMaterial: "Eurogamer reports Hellraiser: Revival launches on 8th October, 2026, with a new trailer showing combat and otherworldly powers.",
    },
    {
      canonicalSubject: "Nintendo Switch 2",
      sourceName: "IGN",
      story: {
        id: "rss_switch2_patch",
        title: "Nintendo Switch 2 System Update 22.5.0 Available - Here Are the Patch Notes",
        source_type: "rss",
        subreddit: "IGN",
        article_url: "https://www.ign.com/articles/nintendo-switch-2-system-update-2250-patch-notes",
      },
      sourceMaterial: "IGN reports Nintendo Switch 2 system update 22.5.0 is available now, with patch notes covering the latest console firmware update.",
    },
    {
      canonicalSubject: "GTA 6",
      sourceName: "Forbes",
      story: {
        id: "rss_gta6_launch_endgame",
        title: "Here's How I Know We Are Entering Rockstar's End Game For Launching GTA 6",
        source_type: "rss",
        subreddit: "Forbes",
        article_url: "https://www.forbes.com/sites/paultassi/2026/06/18/gta-6-launch-endgame/",
      },
      sourceMaterial:
        "Forbes argues Rockstar is entering the endgame for launching GTA 6, and says another delay now looks less likely while official preorder and edition details remain missing.",
    },
  ];

  for (const item of cases) {
    const script = buildSourceBoundFallbackScript(item.story, {
      sourceName: item.sourceName,
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial: item.sourceMaterial,
    });
    assert.ok(script, item.story.id);
    const qa = publicCopyQaForScript({
      story: item.story,
      script,
      canonicalSubject: item.canonicalSubject,
      sourceName: item.sourceName,
    });
    assert.equal(qa.verdict, "pass", `${item.story.id} ${JSON.stringify(qa, null, 2)}`);
  }
});

test("source-bound promoted fresh lanes avoid template scaffolding and mojibake", () => {
  const cases = [
    {
      story: {
        id: "rss_ea_fc_26_ea_play",
        title: "EA SPORTS FC 26 Is Now on EA Play",
        source_type: "rss",
        subreddit: "Xbox Wire",
        article_url: "https://news.xbox.com/en-us/2026/06/18/ea-play-fc-26/",
      },
      sourceName: "Xbox Wire",
      sourceMaterial: "Xbox Wire reports EA SPORTS FC 26 is now available through EA Play.",
    },
    {
      story: {
        id: "rss_adventures_of_elliot_preview",
        title: "How The Adventures of Elliot: The Millennium Tales Balances Exploration, Combat, and Discovery",
        source_type: "rss",
        subreddit: "Xbox Wire",
        article_url:
          "https://news.xbox.com/en-us/2026/06/18/the-adventures-of-elliot-exploration-combat-discovery/",
      },
      sourceName: "Xbox Wire",
      sourceMaterial:
        "Xbox Wire reports The Adventures of Elliot is framed around exploration, combat and discovery in a new RPG preview.",
    },
    {
      story: {
        id: "rss_gta6_preorder",
        title: "7 Burning Questions for the GTA 6 Pre-Order Launch",
        source_type: "rss",
        subreddit: "IGN",
        article_url: "https://www.ign.com/articles/7-burning-questions-for-the-gta-6-pre-order-launch",
      },
      sourceName: "IGN",
      sourceMaterial:
        "IGN reports Rockstar confirmed GTA 6 preorders launch on June 25, with editions, bonuses, price and platform details still missing.",
    },
    {
      story: {
        id: "rss_free_play_days_20260618",
        title: "Free Play Days - PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight",
        source_type: "rss",
        subreddit: "Xbox Wire",
        article_url: "https://news.xbox.com/en-us/2026/06/18/free-play-days-06-18-2026/",
      },
      sourceName: "Xbox Wire",
      sourceMaterial:
        "Xbox Wire reports Free Play Days includes PGA Tour 2K25, Two Point Museum, Assetto Corsa and Dead by Daylight for a limited weekend trial window.",
    },
    {
      story: {
        id: "rss_dave_jungle_dlc",
        title: "Why You Should Follow Dave the Diver to the Jungle in New DLC Today",
        source_type: "rss",
        subreddit: "Xbox Wire",
        article_url: "https://news.xbox.com/en-us/2026/06/18/dave-the-diver-in-the-jungle-out-now/",
      },
      sourceName: "Xbox Wire",
      sourceMaterial:
        "Xbox Wire reports Dave the Diver goes to the jungle in new DLC available today, with a new biome, new creatures and a reason to return after the main game.",
    },
  ];

  for (const item of cases) {
    const script = buildSourceBoundFallbackScript(item.story, {
      sourceName: item.sourceName,
      runtimeProfile: SHORT_LOCAL_PROFILE,
      sourceMaterial: item.sourceMaterial,
    });
    assert.ok(script, item.story.id);
    assert.doesNotMatch(script.full_script, MASS_AUDIENCE_SCAFFOLD_RE, item.story.id);
    assert.doesNotMatch(script.full_script, MOJIBAKE_RE, item.story.id);
    assert.equal(script.cta, "Follow Pulse Gaming so you never miss a beat.");
  }
});

test("source-bound fallback turns a physical-release backlash story into a concrete player-trust angle", () => {
  const story = {
    id: "rss_wolverine_physical_disc",
    title:
      "Marvel's Wolverine Trailer Flooded With Comments as Physical Disc Backlash Against PlayStation Continues",
    source_type: "rss",
    subreddit: "GameSpot",
    article_url:
      "https://www.gamespot.com/articles/marvels-wolverine-trailer-physical-disc-backlash-playstation/",
  };
  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "GameSpot",
    runtimeProfile: SHORT_LOCAL_PROFILE,
    sourceMaterial:
      "GameSpot reports comments under the new Marvel's Wolverine trailer are dominated by requests for a physical disc release as PlayStation players push back against digital-only launches. Sony has not announced the final retail format.",
  });

  assert.ok(script);
  assert.equal(script.editorial_angle?.lane, "physical_release_trust");
  assert.equal(script.suggested_title, "Marvel's Wolverine Faces A Physical Release Fight");
  assert.match(script.full_script, /^Marvel's Wolverine\b/);
  assert.match(script.full_script, /physical disc|physical release/i);
  assert.match(script.full_script, /digital-only|ownership|retail format/i);
  assert.match(script.full_script, /Sony has not|not announced/i);
  assert.doesNotMatch(
    script.full_script,
    /one detail worth checking|watch signal|what people install, buy, wishlist or ignore/i,
  );
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);

  const quality = buildViralScriptIntelligence({
    story,
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("source-bound fallback turns Black Flag's 3 million sales milestone into a retention story", () => {
  const story = {
    id: "official_black_flag_three_million_20260717",
    title: "Assassin's Creed Black Flag Resynced Sells Over 3 Million Copies in a Week",
    source_type: "official",
    source_name: "Ubisoft",
    article_url:
      "https://news.ubisoft.com/en-us/article/3FcqYa0y8K39sboBSUfXzk/assassins-creed-black-flag-resynced-sells-over-3-million-copies-in-a-week",
  };
  const script = buildSourceBoundFallbackScript(story, {
    sourceName: "Ubisoft",
    runtimeProfile: SHORT_LOCAL_PROFILE,
    sourceMaterial:
      "Ubisoft reports Assassin's Creed Black Flag Resynced sold more than 3 million copies in one week after selling 2 million on day one. Steam user reviews improved to Very Positive while post-launch fixes and New Game Plus were announced.",
  });

  assert.ok(script);
  assert.equal(script.editorial_angle?.lane, "black_flag_sales_momentum");
  assert.equal(
    script.suggested_title,
    "Black Flag Sold 3 Million. The Second Wave Is The Real Win",
  );
  assert.match(
    script.full_script,
    /^Ubisoft says its new Black Flag sold 3 million copies in its launch week\./,
  );
  assert.doesNotMatch(script.full_script, /\bBlack Flag Resynced sold\b/i);
  assert.match(script.full_script, /3 million copies/i);
  assert.match(script.full_script, /2 million copies (?:sold )?on day one/i);
  assert.match(script.full_script, /Very Positive/i);
  assert.match(script.full_script, /retention|staying power|momentum/i);
  assert.match(script.full_script, /word of mouth/i);
  assert.match(script.full_script, /publisher-reported|publisher's number/i);
  assert.doesNotMatch(
    script.full_script,
    /one detail worth checking|watch signal|what people install, buy, wishlist or ignore/i,
  );
  assert.match(script.full_script, /Follow Pulse Gaming so you never miss a beat\.$/);

  const quality = buildViralScriptIntelligence({
    story,
    script: script.full_script,
  });
  assert.equal(quality.verdict, "viral_ready", JSON.stringify(quality, null, 2));
});

test("sourceNameFromUrl gives readable publisher names", () => {
  assert.equal(
    sourceNameFromUrl("https://www.rockpapershotgun.com/example"),
    "Rock Paper Shotgun",
  );
  assert.equal(sourceNameFromUrl("https://twistedvoxel.com/example"), "Twisted Voxel");
  assert.equal(sourceNameFromUrl("https://www.pcgamer.com/example"), "PC Gamer");
  assert.equal(sourceNameFromUrl("https://www.gamespot.com/articles/example/"), "GameSpot");
  assert.equal(sourceNameFromUrl("https://blog.playstation.com/example"), "PlayStation Blog");
  assert.equal(sourceNameFromUrl("https://news.xbox.com/en-us/example"), "Xbox Wire");
  assert.equal(sourceNameFromUrl("https://slayersclub.bethesda.net/en-US/article/example"), "Slayers Club");
  assert.equal(sourceNameFromUrl("https://youtu.be/PGqkjDoyI8o"), "YouTube");
  assert.equal(sourceNameFromUrl("https://www.youtube.com/watch?v=LBxjH-lZjEo"), "YouTube");
});
