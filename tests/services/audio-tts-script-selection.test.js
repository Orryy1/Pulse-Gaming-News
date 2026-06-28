"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  cleanForTTS,
  ensureSpokenOutro,
  selectRawTtsScript,
  resolveTtsTimeoutMs,
} = require("../../audio");

test("selectRawTtsScript: uses clean full_script when cached tts_script damaged a protected name", () => {
  const story = {
    id: "pokemon-story",
    full_script: "Pok\u00e9mon Go has a new Mega Mewtwo event.",
    tts_script: "Pokmon Go has a new Mega Mewtwo event.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.full_script));
});

test("selectRawTtsScript: keeps clean cached tts_script", () => {
  const story = {
    full_script: "Game Pass has a new report.",
    tts_script: "Xbox Game Pass has a new report.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.tts_script));
});

test("selectRawTtsScript: normalises cached GTA VI spoken-risk before selection", () => {
  const story = {
    full_script: "Grand Theft Auto VI now has one real preorder catch.",
    tts_script: "GTA si-six starts the preorder fight.",
  };

  const selected = selectRawTtsScript(story);

  assert.equal(
    selected,
    "Rockstar's next Grand Theft Auto starts the preorder fight. Follow Pulse Gaming so you never miss a beat.",
  );
  assert.doesNotMatch(selected, /\b(?:GTA|Grand Theft Auto|G\s+T\s+A)\s+(?:VI|six|si[- ]?six)\b/i);
});

test("selectRawTtsScript: normalises fallback GTA VI text when no cached script exists", () => {
  const story = {
    full_script: "GTA VI pre-orders just turned the cover art reveal into a buying argument.",
  };

  const selected = selectRawTtsScript(story);

  assert.equal(
    selected,
    "Rockstar's next Grand Theft Auto pre orders just turned the cover art reveal into a buying argument. Follow Pulse Gaming so you never miss a beat.",
  );
  assert.doesNotMatch(selected, /\b(?:GTA|Grand Theft Auto|G\s+T\s+A)\s+(?:VI|six|si[- ]?six)\b/i);
});

test("selectRawTtsScript: prefers canonical full_script over non-canonical cached spelling", () => {
  const story = {
    full_script: "Pok\u00e9mon Go Fest is free for all players.",
    tts_script: "Pokemon Go Fest is free for all players.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.full_script));
});

test("selectRawTtsScript: returns cached script when no better fallback exists", () => {
  const story = {
    tts_script: "Pokmon Go has a new event.",
  };

  assert.equal(selectRawTtsScript(story), ensureSpokenOutro(story.tts_script));
});

test("selectRawTtsScript: restores the required spoken outro for source scripts missing it", () => {
  const story = {
    full_script: "Subnautica 2 just passed a million sales.",
  };

  assert.equal(
    selectRawTtsScript(story),
    "Subnautica 2 just passed a million sales. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("selectRawTtsScript: removes adjacent duplicate opener and duplicate spoken outro", () => {
  const opener = "Forza Horizon 6 just put up a ridiculous Steam number.";
  const story = {
    id: "forza-steam-record",
    tts_script:
      `${opener} ${opener} GamesRadar reports the early access launch hit a new Steam peak. ` +
      "Follow Pulse Gaming so you never miss a beat. Follow Pulse Gaming so you never miss a beat.",
  };

  const selected = selectRawTtsScript(story);

  assert.equal(
    (selected.match(/Forza Horizon 6 just put up a ridiculous Steam number/g) || []).length,
    1,
  );
  assert.equal(
    (selected.match(/Follow Pulse Gaming so you never miss a beat/g) || []).length,
    1,
  );
  assert.equal(
    selected,
    `${opener} GamesRadar reports the early access launch hit a new Steam peak. Follow Pulse Gaming so you never miss a beat.`,
  );
});

test("ensureSpokenOutro: collapses repeated terminal CTAs to exactly one", () => {
  assert.equal(
    ensureSpokenOutro(
      "A clean gaming update. Follow Pulse Gaming so you never miss a beat. Follow Pulse Gaming so you never miss a beat.",
    ),
    "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("ensureSpokenOutro: normalises a custom terminal Pulse CTA to the approved spoken outro", () => {
  assert.equal(
    ensureSpokenOutro("A clean gaming update. Follow Pulse Gaming for the next read."),
    "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("ensureSpokenOutro: replaces temporary short news CTA with Pulse Gaming catch line", () => {
  assert.equal(
    ensureSpokenOutro("A clean gaming update. Follow for more gaming news."),
    "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("ensureSpokenOutro: replaces pause-marked Pulse Gaming terminal CTA", () => {
  assert.equal(
    ensureSpokenOutro("A clean gaming update. Follow Pulse [PAUSE] Gaming so you never miss a beat."),
    "A clean gaming update. Follow Pulse Gaming so you never miss a beat.",
  );
});

test("cleanForTTS: removes Pulse Gaming outro pauses from generated narration", () => {
  assert.equal(
    cleanForTTS("Follow Pulse [PAUSE] Gaming so you never miss a beat."),
    "Follow Pulse Gaming so you never miss a beat.",
  );
});

test("cleanForTTS: restores temporary short news CTA to Pulse Gaming catch line", () => {
  assert.equal(
    cleanForTTS("Follow for more gaming news."),
    "Follow Pulse Gaming so you never miss a beat.",
  );
});

test("cleanForTTS: expands comma-formatted large numbers for clearer narration", () => {
  assert.equal(
    cleanForTTS("Forza Horizon 6 hit 130,000 concurrent players on Steam."),
    "Forza Horizon 6 hit one hundred and thirty thousand concurrent players on Steam.",
  );
});

test("cleanForTTS: expands modern years without hybrid spoken digits", () => {
  assert.equal(
    cleanForTTS("Forza Horizon 6 topped Metacritic in 2026, not 2039."),
    "Forza Horizon 6 topped Metacritic in twenty twenty six, not twenty thirty nine.",
  );
});

test("cleanForTTS: repairs hybrid decade wording before local narration", () => {
  assert.equal(
    cleanForTTS("Nintendo made the call in the twenty 10s, before the 2020s took over."),
    "Nintendo made the call in the twenty tens, before the twenty twenties took over.",
  );
});

test("cleanForTTS: expands review scores with slash notation for local narration", () => {
  assert.equal(
    cleanForTTS("PC Gamer scored Forza Horizon 6 at 84/100."),
    "PC Gamer scored Forza Horizon 6 at eighty four out of one hundred.",
  );
});

test("cleanForTTS: speaks Hades II as Hades two without comma artefacts", () => {
  assert.equal(
    cleanForTTS("Hades II just put PlayStation and Xbox players on the same April countdown."),
    "Hades two just put PlayStation and Xbox players on the same April countdown.",
  );
});

test("cleanForTTS: removes title-colon pauses inside canonical game names", () => {
  assert.equal(
    cleanForTTS("The Expanse: Osiris Reborn finally showed real gameplay."),
    "The Expanse Osiris Reborn finally showed real gameplay.",
  );
  assert.equal(
    cleanForTTS("Halo: Campaign Evolved just gave Xbox a real remake test."),
    "Halo Campaign Evolved just gave Xbox a real remake test.",
  );
});

test("cleanForTTS: removes hyphen pause from Gears of War E-Day while keeping the title together", () => {
  assert.equal(
    cleanForTTS("Gears of War E-Day finally has new footage."),
    "Gears of War E Day finally has new footage.",
  );
  assert.equal(
    cleanForTTS("Gears of War. E-Day finally has new footage."),
    "Gears of War E Day finally has new footage.",
  );
});

test("cleanForTTS: normalises Stranger Than Heaven title casing for local clone clarity", () => {
  assert.equal(
    cleanForTTS("STRANGER THAN HEAVEN Five Eras is swinging at more than one period piece."),
    "Stranger Than Heaven five era setup is swinging at more than one period piece.",
  );
});

test("cleanForTTS: protects Beastro from local ASR title drift", () => {
  assert.equal(
    cleanForTTS("Beastro wins if it makes strategy feel generous."),
    "Beastrow wins if it makes strategy feel generous.",
  );
});

test("cleanForTTS: expands PS5 when it leads a spoken news line", () => {
  assert.equal(
    cleanForTTS("PS5 prices went up across Europe and the UK. PS5 Pro moved too."),
    "PlayStation five prices went up across Europe and the UK. PlayStation five Pro moved too.",
  );
});

test("cleanForTTS: speaks GTA 5 and GTA 6 without risky GTA VI spoken-six openers", () => {
  assert.equal(
    cleanForTTS("GTA 5 just became the GTA 6 waiting room. GTA V still feeds GTA VI interest."),
    "Grand Theft Auto five just became the next Grand Theft Auto waiting room. Grand Theft Auto five still feeds Rockstar's next Grand Theft Auto interest.",
  );
  assert.equal(
    cleanForTTS("Grand Theft Auto VI now has one real preorder catch."),
    "Rockstar's next Grand Theft Auto now has one real preorder catch.",
  );
});

test("cleanForTTS: removes old spaced GTA acronym forms before local narration", () => {
  const spoken = cleanForTTS("G T A six is the hook, but GTA VI is the title.");

  assert.equal(
    spoken,
    "Rockstar's next Grand Theft Auto is the hook, but the next Grand Theft Auto is the title.",
  );
  assert.doesNotMatch(spoken, /\bG\s+T\s+A\s+six\b/i);
  assert.doesNotMatch(spoken, /\b(?:GTA|Grand Theft Auto)\s+Six\b/i);
});

test("cleanForTTS: repairs malformed GTA VI stutters before local narration", () => {
  const spoken = cleanForTTS(
    "GTA si-six starts the preorder fight. Grand Theft Auto si-six is still months away.",
  );

  assert.equal(
    spoken,
    "Rockstar's next Grand Theft Auto starts the preorder fight. Rockstar's next Grand Theft Auto is still months away.",
  );
  assert.doesNotMatch(spoken, /\b(?:si|sigh|s)\s*[- ]?\s*six\b/i);
});

test("cleanForTTS: never leaves standalone GTA as spaced letters for local narration", () => {
  const spoken = cleanForTTS("GTA Online is the argument after GTA VI pre-orders.");

  assert.equal(
    spoken,
    "Grand Theft Auto Online is the argument after Rockstar's next Grand Theft Auto pre orders.",
  );
  assert.doesNotMatch(spoken, /\bG\s+T\s+A\b/);
});

test("cleanForTTS: turns article-style deal snippets into spoken sentences", () => {
  assert.equal(
    cleanForTTS("Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever."),
    "Super Mario RPG, 15 dollars, 70 percent off, at Game Stop, physical, lowest price ever.",
  );
});

test("cleanForTTS: avoids hyphenated phonetic tokens that break word alignment", () => {
  assert.equal(
    cleanForTTS("Pearl Abyss announced the Crimson Desert timing."),
    "Pearl uh biss announced the Crimson Desert timing.",
  );
});

test("resolveTtsTimeoutMs: local VoxCPM defaults to a bounded timeout but remains configurable", () => {
  assert.equal(resolveTtsTimeoutMs("local", {}), 300000);
  assert.equal(
    resolveTtsTimeoutMs("local", { LOCAL_TTS_TIMEOUT_MS: "900000" }),
    900000,
  );
  assert.equal(resolveTtsTimeoutMs("elevenlabs", {}), 60000);
});
