"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairGoalPublicCopyManifest,
  repairGoalPublicCopyPackages,
  buildAudioRegenerationWorkbench,
  buildCaptionSrt,
  buildProductionRerenderWorkOrder,
  buildSourceAttributionRepairWorkOrder,
  publicCopyRegenerationPending,
} = require("../../lib/goal-public-copy-repair");
const {
  parseArgs: parsePublicCopyRepairArgs,
  main: runPublicCopyRepairCli,
} = require("../../tools/goal-public-copy-repair");
const { evaluateGoalPublicCopy } = require("../../lib/goal-public-copy-qa");
const { runScriptCoherenceQa } = require("../../lib/script-coherence-qa");
const { buildViralScriptIntelligence } = require("../../lib/viral-script-intelligence");

test("caption SRT uses word timestamps instead of evenly distributing full sentences", () => {
  const srt = buildCaptionSrt(
    "Hades II just hit consoles. Follow Pulse Gaming.",
    8,
    {
      words: [
        { word: "Hades", start: 0, end: 0.42 },
        { word: "two", start: 0.42, end: 0.78 },
        { word: "just", start: 0.78, end: 1.02 },
        { word: "hit", start: 1.02, end: 1.22 },
        { word: "consoles.", start: 1.22, end: 1.7 },
        { word: "Follow", start: 3.5, end: 3.82 },
        { word: "Paul", start: 3.82, end: 4.04 },
        { word: "Skaming", start: 4.04, end: 4.48 },
      ],
    },
  );

  assert.match(srt, /00:00:00,000 --> 00:00:01,020\nHades II just/);
  assert.match(srt, /00:00:03,500 --> 00:00:04,480\nFollow Pulse Gaming/);
  assert.doesNotMatch(srt, /00:00:00,000 --> 00:00:04,000\nHades II just hit consoles/);
  assert.doesNotMatch(srt, /Paul Skaming/);
});

test("caption SRT keeps a protected game title together when local TTS expands the number", () => {
  const srt = buildCaptionSrt(
    "Hades 2 is not just leaving early access.",
    5,
    {
      words: [
        { word: "Hades", start: 0, end: 0.3 },
        { word: "number", start: 0.3, end: 0.68 },
        { word: "two", start: 0.68, end: 1.06 },
        { word: "is", start: 1.06, end: 1.2 },
        { word: "not", start: 1.2, end: 1.4 },
        { word: "just", start: 1.4, end: 1.62 },
        { word: "leaving", start: 1.62, end: 2.04 },
        { word: "early", start: 2.04, end: 2.32 },
        { word: "access.", start: 2.32, end: 2.72 },
      ],
      maxWordsPerPhrase: 2,
      maxPhraseChars: 18,
      maxPhraseDurationS: 1.05,
      danglingMergeMaxWords: 2,
    },
  );

  assert.match(srt, /00:00:00,000 --> 00:00:01,060\nHades 2/);
  assert.match(srt, /00:00:01,060 --> 00:00:01,400\nis not/);
  assert.doesNotMatch(srt, /\nHades\n\n2\n/);
  assert.doesNotMatch(srt, /\n2 is\n/);
});

test("public copy repair turns a quote fragment Kickstarter story into usable copy", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "kickstarter",
      canonical_subject: 'Honestly? We botched it"',
      canonical_title:
        '"Honestly? We botched it" - Kickstarter apologises for its criticised adult content rules',
      selected_title: 'Honestly? We botched it" Just Raised The Stakes',
      primary_source: "Eurogamer",
      primary_source_url: "https://www.eurogamer.net/kickstarter-adult-content-rules-censorship-apology",
      description:
        'Honestly? We botched it": Kickstarter has issued an apology after changing adult content rules. Read more Source: Eurogamer.',
    },
    { generatedAt: "2026-05-22T03:10:00.000Z" },
  );

  assert.equal(repaired.manifest.canonical_subject, "Kickstarter");
  assert.equal(repaired.manifest.selected_title, "Kickstarter Just Walked Back Its Rules");
  assert.equal(repaired.manifest.first_spoken_line, "Kickstarter just walked back its adult content rules after creator backlash.");
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair strips article residue and keeps source labels", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "destiny",
      canonical_subject: "Destiny 2",
      canonical_title: "Bungie Walks Away From Destiny 2, Final Content Update Coming In June",
      selected_title: "Destiny 2 Just Raised The Stakes",
      primary_source: "GameSpot",
      description:
        "Nearly nine years after release, live service support for&nbsp; Destiny 2 &nbsp;is coming to an end. https://www.youtube.com/watch?v=fnsVFF6lfeE Read more Source: GameSpot.",
    },
    { generatedAt: "2026-05-22T03:10:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Destiny 2 Is Getting Its Final Update");
  assert.doesNotMatch(repaired.manifest.description, /Read more|https?:|&nbsp;/i);
  assert.match(repaired.manifest.description, /Source: GameSpot\.$/);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair removes retailer text from Super Mario RPG canonical subject", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "super-mario-rpg-deal",
      canonical_subject: "Super Mario RPG GameStop,",
      canonical_game: "Super Mario RPG GameStop,",
      canonical_title: "Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever",
      selected_title: "Super Mario RPG GameStop, Just Got More Expensive",
      first_spoken_line: "Super Mario RPG GameStop, just got more expensive for players.",
      primary_source: "Reddit",
      description: "Super Mario RPG is $15 at GameStop. Source: Reddit.",
      confirmed_claims: ["Super Mario RPG is $15 at GameStop."],
    },
    { generatedAt: "2026-05-26T13:00:00.000Z" },
  );

  assert.equal(repaired.manifest.canonical_subject, "Super Mario RPG");
  assert.equal(repaired.manifest.canonical_game, "Super Mario RPG");
  assert.match(repaired.manifest.first_spoken_line, /^Super Mario RPG\b/);
  assert.doesNotMatch(repaired.manifest.first_spoken_line, /GameStop,/);
});

test("public copy repair fixes discounted Super Mario RPG stories instead of saying prices rose", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "super-mario-rpg-deal",
      canonical_subject: "Super Mario RPG",
      canonical_game: "Super Mario RPG",
      canonical_title: "Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever",
      selected_title: "Super Mario RPG Just Got More Expensive",
      thumbnail_headline: "SUPER MARIO RPG PRICE JUMP",
      first_spoken_line: "Super Mario RPG just got more expensive for players.",
      narration_script:
        "Super Mario RPG just got more expensive for players. GameStop reports Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever.",
      primary_source: "GameStop",
      description: "Super Mario RPG is $15 at GameStop, 70% off. Source: GameStop.",
      confirmed_claims: [
        "Super Mario RPG - $15 (70% off) at GameStop, physical, lowest price ever",
      ],
    },
    { generatedAt: "2026-05-26T13:10:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Super Mario RPG Drops To $15");
  assert.equal(repaired.manifest.thumbnail_headline, "SUPER MARIO RPG $15 DEAL");
  assert.equal(repaired.manifest.first_spoken_line, "Super Mario RPG just dropped to $15 at GameStop.");
  assert.doesNotMatch(repaired.manifest.narration_script, /more expensive|prices? (?:went|go(?:es)?) up|price jump/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair does not use discount filler for PS5 price hikes", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "ps5-price-hike",
      canonical_subject: "PS5",
      canonical_game: "PS5",
      canonical_title: "Rumor: Another PS5 price hike coming to at least Europe shortly",
      selected_title: "PS5 Prices Went Up In Europe",
      first_spoken_line: "PS5 prices went up across Europe and the UK.",
      narration_script:
        "PS5 prices went up across Europe and the UK. PlayStation Blog reports Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK. The catch matters as much as the saving, because platform and seller details can change the value fast. Anyone already building that setup now has a lower entry point.",
      primary_source: "PlayStation Blog",
      official_source: "PlayStation Blog",
      confirmed_claims: [
        "Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK.",
      ],
    },
    { generatedAt: "2026-05-26T13:15:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "PS5 Prices Went Up In Europe");
  assert.doesNotMatch(repaired.manifest.narration_script, /saving|discount|lower entry point/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair corrects Steam Controller stories misfiled as Steam Deck", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "steam-controller-date",
      canonical_subject: "Steam Deck",
      canonical_game: "Steam Deck",
      canonical_title: "The Steam controller release date may have been leaked online",
      selected_title: "Steam Controller Date May Have Leaked",
      first_spoken_line: "Steam Controller release timing may have leaked early.",
      primary_source: "The Verge",
      description: "The Steam controller release date may have been leaked online. Source: The Verge.",
      confirmed_claims: ["The Steam controller release date may have been leaked online."],
    },
    { generatedAt: "2026-05-26T13:00:00.000Z" },
  );

  assert.equal(repaired.manifest.canonical_subject, "Steam Controller");
  assert.equal(repaired.manifest.canonical_game, "Steam Controller");
  assert.equal(repaired.manifest.selected_title, "Steam Controller Date May Have Leaked");
  assert.match(repaired.manifest.first_spoken_line, /^Steam Controller\b/);
});

test("public copy package repair rewrites canonical entity mismatches before platform sync", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-canonical-mismatch-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "steam-controller-date",
    canonical_subject: "Steam Deck",
    canonical_game: "Steam Deck",
    canonical_title: "The Steam controller release date may have been leaked online",
    selected_title: "Steam Controller Date May Have Leaked",
    thumbnail_headline: "STEAM CONTROLLER DATE",
    first_spoken_line: "Steam Controller release timing may have leaked early.",
    narration_script:
      "Steam Controller release timing may have leaked early. The Verge reports the Steam controller release date may have appeared online.",
    description: "The Steam controller release date may have been leaked online. Source: The Verge.",
    primary_source: "The Verge",
    source_card_label: "The Verge",
    confirmed_claims: ["The Steam controller release date may have been leaked online."],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "steam-controller-date", artifact_dir: artifactDir }],
    generatedAt: "2026-05-26T13:05:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "changed");
  assert.equal(updated.canonical_subject, "Steam Controller");
  assert.equal(updated.canonical_game, "Steam Controller");
});

test("public copy repair removes mismatched reporting-source prefixes from claims", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "dawn-source-mismatch",
      canonical_subject: "Warhammer 40,000: Dawn of War 4",
      selected_title: "Dawn Of War 4 Finally Shows Gameplay",
      primary_source: "GameSpot",
      description: "IGN says Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing. Source: GameSpot.",
      confirmed_claims: [
        "IGN says Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing",
      ],
    },
    { generatedAt: "2026-05-22T23:35:00.000Z" },
  );

  assert.doesNotMatch(repaired.manifest.narration_script, /IGN\s+(?:says|reports)/i);
  assert.doesNotMatch(repaired.manifest.description, /IGN\s+(?:says|reports)/i);
  assert.match(repaired.manifest.narration_script, /GameSpot reports Dawn of War 4/i);
  assert.match(repaired.manifest.description, /Source: GameSpot\.$/);
});

test("public copy repair promotes official channel owner over YouTube host labels", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "expanse-osiris",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      canonical_company: "xbox",
      canonical_title: "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026",
      selected_title: "The Expanse Shows Real Gameplay",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      narration_script:
        "The Expanse: Osiris Reborn finally showed real gameplay. Youtube reports The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026.",
      description: "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026. Source: Youtube.",
      primary_source: "Youtube",
      source_card_label: "Youtube",
      primary_source_url: "https://www.youtube.com/watch?v=LBxjH-lZjEo",
      confirmed_claims: [
        "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026",
      ],
    },
    { generatedAt: "2026-05-23T09:00:00.000Z" },
  );

  assert.equal(repaired.manifest.primary_source, "Xbox");
  assert.equal(repaired.manifest.source_card_label, "Xbox");
  assert.doesNotMatch(repaired.manifest.narration_script, /YouTube|Youtube reports/i);
  assert.match(repaired.manifest.narration_script, /Xbox showed The Expanse: Osiris Reborn gameplay/i);
  assert.match(repaired.manifest.description, /Source: Xbox\.$/);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy package repair rewrites YouTube-host source labels", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-youtube-host-repair-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "expanse-osiris",
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_game: "The Expanse: Osiris Reborn",
    canonical_company: "xbox",
    canonical_title: "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    narration_script:
      "The Expanse: Osiris Reborn finally showed real gameplay. Youtube reports The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026.",
    description: "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026. Source: Youtube.",
    primary_source: "Youtube",
    source_card_label: "Youtube",
    primary_source_url: "https://www.youtube.com/watch?v=LBxjH-lZjEo",
    confirmed_claims: [
      "The Expanse: Osiris Reborn | Official Gameplay Trailer | Xbox Partner Preview 2026",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "pokemon-brand-story",
    outputs: {
      youtube_shorts: {
        title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
        cover_frame: { headline: "POKEMON GO MEGA MEWTWO", source_label: "Eurogamer" },
      },
      x: {
        poll_candidate: "Is Pokemon Go finally getting the event it needed?",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "expanse-osiris", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T09:01:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.primary_source, "Xbox");
  assert.equal(updated.source_card_label, "Xbox");
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy package repair syncs stale full_script and tts_script fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-script-field-sync-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "hades-sync",
    canonical_subject: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    first_spoken_line: "Hades II just broke PlayStation's silence.",
    narration_script:
      "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
    tts_script:
      "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
    description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
    primary_source: "Xbox",
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "hades-sync", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T20:05:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.full_script, updated.narration_script);
  assert.equal(updated.tts_script, updated.narration_script);
  assert.doesNotMatch(updated.tts_script, /confirmed claim is simple/i);
});

test("public copy repair rewrites the Boltgun preview away from weak impression copy", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "boltgun-preview",
      canonical_subject: "Warhammer 40,000 Boltgun 2",
      canonical_title:
        "Warhammer 40,000 Boltgun 2 Takes the Ultraviolent '90s FPS to the Great Outdoors | IGN Preview",
      selected_title: "Boltgun 2 Already Feels Loud",
      primary_source: "IGN",
      description:
        "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. IGN reports Warhammer 40,000 Boltgun 2 Takes the Ultraviolent '90s FPS to the Great Outdoors | IGN Preview The player angle is simple: check the price, access or platform details before you decide what to play next.",
      confirmed_claims: [
        "Warhammer 40,000 Boltgun 2 Takes the Ultraviolent '90s FPS to the Great Outdoors | IGN Preview",
      ],
    },
    { generatedAt: "2026-05-22T18:45:00.000Z" },
  );

  assert.equal(repaired.manifest.canonical_subject, "Warhammer 40,000: Boltgun 2");
  assert.equal(repaired.manifest.selected_title, "Boltgun 2 Leaves The Corridors");
  assert.equal(
    repaired.manifest.first_spoken_line,
    "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces.",
  );
  assert.doesNotMatch(repaired.manifest.narration_script, /The player angle is simple|check the price, access or platform details/i);
  assert.doesNotMatch(repaired.manifest.description, /IGN Preview The player angle|Already Feels Loud/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair uses the canonical Pulse CTA for viral script scoring", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "steam-controller-date",
      canonical_subject: "Steam Controller",
      canonical_title: "The Steam controller release date may have been leaked online",
      selected_title: "Steam Controller Date May Have Leaked",
      first_spoken_line: "Steam Controller release timing may have leaked early.",
      primary_source: "The Verge",
      description: "The Steam controller release date may have been leaked online. Source: The Verge.",
      confirmed_claims: ["The Steam controller release date may have been leaked online."],
    },
    { generatedAt: "2026-05-26T15:30:00.000Z" },
  );

  assert.match(repaired.manifest.narration_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.doesNotMatch(repaired.manifest.narration_script, /gaming stories behind the headline/i);
});

test("public copy repair gives leaked hardware stories a curiosity beat", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "steam-controller-date",
      canonical_subject: "Steam Controller",
      canonical_title: "The Steam controller release date may have been leaked online",
      selected_title: "Steam Controller Date May Have Leaked",
      first_spoken_line: "Steam Controller release timing may have leaked early.",
      primary_source: "The Verge",
      confirmed_claims: ["The Steam controller release date may have been leaked online."],
    },
    { generatedAt: "2026-05-26T15:35:00.000Z" },
  );
  const intelligence = buildViralScriptIntelligence({
    story: {
      id: "steam-controller-date",
      title: repaired.manifest.selected_title,
      source_name: repaired.manifest.primary_source,
    },
    script: repaired.manifest.narration_script,
  });

  assert.match(repaired.manifest.narration_script, /\b(?:catch|but)\b/i);
  assert.equal(intelligence.blockers.length, 0);
  assert.ok(intelligence.viral_score >= 75, JSON.stringify(intelligence, null, 2));
});

test("public copy repair produces script-score-safe rewrites for scheduler-blocked review and price stories", () => {
  const cases = [
    {
      story_id: "forza-review-thread",
      canonical_subject: "Forza Horizon 6",
      selected_title: "Forza Horizon 6 Reviews Are In",
      primary_source: "PC Gamer",
      confirmed_claims: ["Forza Horizon 6 reviews are now in."],
      expectedHook: /catch|problem|risk/i,
    },
    {
      story_id: "ps5-price-rise",
      canonical_subject: "PS5",
      selected_title: "PS5 Prices Went Up In Europe",
      primary_source: "PlayStation Blog",
      confirmed_claims: [
        "Sony announced updated PS5, PS5 Digital Edition, PS5 Pro and PlayStation Portal recommended retail prices effective April 2, 2026, including Europe and the UK.",
      ],
      expectedHook: /problem|risk/i,
    },
    {
      story_id: "crimson-live",
      canonical_subject: "Crimson Desert",
      selected_title: "Crimson Desert Is Already Live",
      primary_source: "GameSpot",
      confirmed_claims: ["Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing."],
      expectedHook: /risk|problem/i,
    },
  ];

  for (const manifest of cases) {
    const repaired = repairGoalPublicCopyManifest(manifest, {
      generatedAt: "2026-05-28T12:30:00.000Z",
    });
    const intelligence = buildViralScriptIntelligence({
      story: {
        id: manifest.story_id,
        title: repaired.manifest.selected_title,
        source_name: repaired.manifest.primary_source,
      },
      script: repaired.manifest.narration_script,
    });

    assert.match(repaired.manifest.first_spoken_line, manifest.expectedHook, manifest.story_id);
    assert.equal(intelligence.blockers.length, 0, JSON.stringify({ story: manifest.story_id, intelligence }, null, 2));
    assert.ok(intelligence.viral_score >= 75, JSON.stringify({ story: manifest.story_id, intelligence }, null, 2));
  }
});

test("public copy package repair refreshes stale script scorecards before scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-script-score-"));
  const artifactDir = path.join(root, "batch", "v-rising");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "v-rising",
    canonical_subject: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    first_spoken_line: "V Rising's developers are already building another vampire game.",
    primary_source: "GameSpot",
    confirmed_claims: [
      "Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update.",
    ],
    narration_script:
      "V Rising's developers are already building another vampire game. GameSpot reports Stunlock Studios is making a new game set in the world of V Rising, while V Rising itself shifts towards balance and bug-fix support. That shifts the fan question from the next patch to how far Stunlock can stretch its vampire world. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "V Rising's developers are already building another vampire game. GameSpot reports Stunlock Studios is making a new game set in the world of V Rising, while V Rising itself shifts towards balance and bug-fix support. That shifts the fan question from the next patch to how far Stunlock can stretch its vampire world. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "V Rising's developers are already building another vampire game. GameSpot reports Stunlock Studios is making a new game set in the world of V Rising, while V Rising itself shifts towards balance and bug-fix support. That shifts the fan question from the next patch to how far Stunlock can stretch its vampire world. Follow Pulse Gaming so you never miss a beat.",
    description:
      "V Rising: Stunlock Studios says it is working on a new game set in the world of V Rising. Source: GameSpot.",
    thumbnail_headline: "V RISING VAMPIRE GAME",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    viral_score: 55,
    blockers: ["stale_scorecard"],
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "v-rising", artifact_dir: artifactDir }],
    generatedAt: "2026-05-28T12:31:00.000Z",
  });

  assert.equal(report.summary.changed_count, 1);
  assert.match(report.changed[0].status, /^script_scorecard_(?:refreshed|repaired)$/);
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.notEqual(savedScorecard.verdict, "rewrite_required");
  assert.ok(savedScorecard.viral_score >= 75, JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair rewrites no-curiosity script scorecards before scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-curiosity-score-"));
  const artifactDir = path.join(root, "batch", "subnautica-bonus");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "subnautica-bonus",
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Bonus Fight Got Bigger",
    first_spoken_line: "Subnautica 2's bonus fight now looks bigger than the sequel hype.",
    primary_source: "Aftermath",
    confirmed_claims: [
      "Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus.",
    ],
    narration_script:
      "Subnautica 2's bonus fight now looks bigger than the sequel hype. Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus. Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Subnautica 2's bonus fight now looks bigger than the sequel hype. Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus. Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Subnautica 2's bonus fight now looks bigger than the sequel hype. Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus. Fans are watching the sequel and the payout fight at the same time, which makes every official update land heavier. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Subnautica 2: Aftermath reports Subnautica 2's developers appear to be in line for a $250 million bonus. Source: Aftermath.",
    thumbnail_headline: "SUBNAUTICA BONUS FIGHT",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "tighten_before_tts",
    viral_score: 82,
    blockers: [],
    warnings: ["no_curiosity_marker"],
    scores: {
      hook_strength: 100,
      curiosity_gap: 65,
      insight_density: 64,
      source_safety: 86,
      retention_pacing: 93,
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "subnautica-bonus", artifact_dir: artifactDir }],
    generatedAt: "2026-05-28T12:35:00.000Z",
  });

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "script_scorecard_repaired");
  const savedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.match(savedManifest.narration_script, /\bThe catch\b/i);
  assert.ok(savedScorecard.scores.curiosity_gap >= 70, JSON.stringify(savedScorecard, null, 2));
  assert.ok(!savedScorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair gives leak and deal scripts recognised curiosity markers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-curiosity-classes-"));
  const cases = [
    {
      storyId: "subnautica-leak",
      subject: "Subnautica 2",
      title: "Subnautica 2 Dev Calls Out Leakers",
      firstLine: "Subnautica 2's developer is already fighting leaked builds.",
      source: "Respawnfirst",
      claim: "A Subnautica 2 developer responded after leaked builds started spreading before launch.",
    },
    {
      storyId: "mario-deal",
      subject: "Super Mario RPG",
      title: "Super Mario RPG Drops To $15",
      firstLine: "Super Mario RPG just dropped to $15 at GameStop.",
      source: "Gamestop",
      claim: "GameStop lists Super Mario RPG at $15, 70% off its listed price.",
    },
  ];
  const packages = [];
  for (const item of cases) {
    const artifactDir = path.join(root, "batch", item.storyId);
    packages.push({ story_id: item.storyId, artifact_dir: artifactDir });
    await fs.ensureDir(artifactDir);
    const script = `${item.firstLine} ${item.source} reports ${item.claim} Players should check the source before reacting. Follow Pulse Gaming so you never miss a beat.`;
    await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
      story_id: item.storyId,
      canonical_subject: item.subject,
      canonical_game: item.subject,
      selected_title: item.title,
      first_spoken_line: item.firstLine,
      primary_source: item.source,
      confirmed_claims: [item.claim],
      narration_script: script,
      full_script: script,
      tts_script: script,
      description: `${item.claim} Source: ${item.source}.`,
      thumbnail_headline: item.title.toUpperCase(),
    }, { spaces: 2 });
    await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
      verdict: "tighten_before_tts",
      viral_score: 82,
      blockers: [],
      warnings: ["no_curiosity_marker"],
      scores: {
        hook_strength: 100,
        curiosity_gap: 65,
        insight_density: 64,
        source_safety: 86,
        retention_pacing: 93,
      },
    }, { spaces: 2 });
  }

  const report = await repairGoalPublicCopyPackages({
    storyPackages: packages,
    generatedAt: "2026-05-28T16:55:00.000Z",
  });

  assert.equal(report.summary.changed_count, 2, JSON.stringify(report, null, 2));
  for (const item of cases) {
    const artifactDir = path.join(root, "batch", item.storyId);
    const savedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
    const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
    assert.match(savedManifest.narration_script, /\bThe catch is (?:what matters|what this changes)\b/i);
    assert.ok(savedScorecard.scores.curiosity_gap >= 70, JSON.stringify(savedScorecard, null, 2));
    assert.ok(!savedScorecard.warnings.includes("no_curiosity_marker"), JSON.stringify(savedScorecard, null, 2));
  }
});

test("public copy package repair rewrites trailer scorecard blockers with story-specific narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-trailer-score-"));
  const cases = [
    {
      storyId: "hades-console",
      subject: "Hades II",
      title: "Hades II Just Broke PlayStation's Silence",
      firstLine: "Hades II just put PlayStation and Xbox players on the same April countdown.",
      source: "Xbox",
      claim: "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
      thumbnail: "HADES II CONSOLE DATE",
      expected: /The catch is controller feel/i,
      forbidden: /\bHades (?:II|2) is not just leaving early access\b|\bThe catch is what matters after the reveal cut\b/i,
      speechAlias: /\bHades II hits Xbox and PlayStation on the same April clock\b/i,
    },
    {
      storyId: "stranger-five-eras",
      subject: "STRANGER THAN HEAVEN Five Eras",
      title: "Stranger Than Heaven Shows Five Eras",
      firstLine: "Stranger Than Heaven just showed its five-era setup.",
      source: "Xbox",
      claim: "Xbox showed Stranger Than Heaven's Five Eras reveal during Xbox Partner Preview.",
      thumbnail: "STRANGER FIVE ERAS",
      expected: /The catch is why those eras matter/i,
      forbidden: /\bThe catch is what matters after the reveal cut\b/i,
    },
    {
      storyId: "star-wars-racer",
      subject: "Star Wars: Galactic Racer",
      title: "Star Wars Racer Date Leaked Early",
      firstLine: "Star Wars: Galactic Racer may have leaked its own release date.",
      source: "Rock Paper Shotgun",
      claim: "Chuba! Star Wars: Galactic Racer's release date has been accidentally revealed early",
      thumbnail: "STAR WARS RACER DATE LEAKED",
      expected: /date leak is not the sell/i,
      forbidden: /\bChuba!\b|\bThe catch is what matters after the reveal cut\b/i,
    },
  ];
  const packages = [];
  for (const item of cases) {
    const artifactDir = path.join(root, "batch", item.storyId);
    packages.push({ story_id: item.storyId, artifact_dir: artifactDir });
    await fs.ensureDir(artifactDir);
    const staleScript = `${item.firstLine} ${item.source} reports ${item.claim}. The catch is what matters after the reveal cut: whether the full mission flow can match it. Follow Pulse Gaming so you never miss a beat.`;
    await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
      story_id: item.storyId,
      canonical_subject: item.subject,
      canonical_game: item.subject,
      selected_title: item.title,
      short_title: item.title,
      first_spoken_line: item.firstLine,
      primary_source: item.source,
      confirmed_claims: [item.claim],
      narration_script: staleScript,
      full_script: staleScript,
      tts_script: staleScript,
      description: `${item.claim}. Source: ${item.source}.`,
      thumbnail_headline: item.thumbnail,
      thumbnail_text: item.thumbnail,
    }, { spaces: 2 });
    await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
      verdict: "rewrite_required",
      viral_score: 62,
      blockers: ["stale_trailer_template"],
      warnings: ["no_curiosity_marker"],
      scores: {
        hook_strength: 82,
        curiosity_gap: 35,
        insight_density: 54,
        source_safety: 86,
        retention_pacing: 82,
      },
    }, { spaces: 2 });
  }

  const report = await repairGoalPublicCopyPackages({
    storyPackages: packages,
    generatedAt: "2026-05-28T18:42:00.000Z",
  });

  assert.equal(report.summary.changed_count, 3, JSON.stringify(report, null, 2));
  for (const item of cases) {
    const artifactDir = path.join(root, "batch", item.storyId);
    const savedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
    const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
    assert.equal(report.changed.find((entry) => entry.story_id === item.storyId)?.status, "script_scorecard_repaired");
    assert.match(savedManifest.narration_script, item.expected, item.storyId);
    assert.doesNotMatch(savedManifest.narration_script, item.forbidden, item.storyId);
    if (item.speechAlias) assert.match(savedManifest.narration_script, item.speechAlias, item.storyId);
    assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
    assert.ok(savedScorecard.viral_score >= 75, JSON.stringify(savedScorecard, null, 2));
    assert.ok(savedScorecard.scores.curiosity_gap >= 70, JSON.stringify(savedScorecard, null, 2));
  }
});

test("public copy repair avoids generic reveal-cut filler for ordinary gameplay trailers", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "generic-gameplay-trailer",
      canonical_subject: "Test Game",
      canonical_game: "Test Game",
      selected_title: "Test Game Shows Real Gameplay",
      first_spoken_line: "Test Game finally showed real gameplay.",
      primary_source: "Xbox",
      source_card_label: "Xbox",
      confirmed_claims: [
        "Xbox showed Test Game real gameplay during its latest showcase.",
      ],
      description: "Xbox showed Test Game real gameplay. Source: Xbox.",
    },
    { generatedAt: "2026-05-28T19:10:00.000Z" },
  );

  assert.equal(repaired.after.verdict, "pass", repaired.after.failures.join(", "));
  assert.doesNotMatch(repaired.manifest.narration_script, /The catch is what matters after the reveal cut/i);
  assert.match(
    repaired.manifest.narration_script,
    /The catch is whether Test Game still has weight when the trailer stops jumping between money shots/i,
  );
  assert.match(repaired.manifest.narration_script, /\bTest Game\b/);

  const staleQa = evaluateGoalPublicCopy({
    ...repaired.manifest,
    narration_script:
      "Test Game finally showed real gameplay. Xbox reports Test Game gameplay. The catch is what matters after the reveal cut: whether the full mission flow can match it.",
    full_script:
      "Test Game finally showed real gameplay. Xbox reports Test Game gameplay. The catch is what matters after the reveal cut: whether the full mission flow can match it.",
    tts_script:
      "Test Game finally showed real gameplay. Xbox reports Test Game gameplay. The catch is what matters after the reveal cut: whether the full mission flow can match it.",
  });
  assert.equal(staleQa.verdict, "fail");
  assert.ok(staleQa.failures.includes("public_copy:formulaic_public_narration"), JSON.stringify(staleQa));
});

test("public copy package repair detects stale passing scorecards against current script rules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-stale-pass-score-"));
  const artifactDir = path.join(root, "batch", "expanse-gameplay");
  await fs.ensureDir(artifactDir);
  const staleScript =
    "The Expanse: Osiris Reborn finally showed real gameplay. " +
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. " +
    "The catch is what matters after the reveal cut: whether the full mission flow can match it. " +
    "Now the camera, gunfights and scale are on screen instead of hidden behind a logo. " +
    "Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "expanse-gameplay",
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_game: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
    primary_source: "Xbox",
    confirmed_claims: [
      "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    ],
    narration_script: staleScript,
    full_script: staleScript,
    tts_script: staleScript,
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    thumbnail_headline: "EXPANSE GAMEPLAY REVEAL",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 88,
    blockers: [],
    warnings: [],
    scores: {
      hook_strength: 88,
      curiosity_gap: 87,
      insight_density: 80,
      source_safety: 86,
      retention_pacing: 82,
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "expanse-gameplay", artifact_dir: artifactDir }],
    generatedAt: "2026-05-28T18:46:00.000Z",
  });

  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "script_scorecard_repaired");
  assert.ok(!savedScorecard.blockers.includes("generic_reveal_catch_template"), JSON.stringify(savedScorecard, null, 2));
  assert.ok(savedScorecard.viral_score >= 75, JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair rewrites Mega Mewtwo title-repeat hooks before scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-pokemon-hook-"));
  const artifactDir = path.join(root, "batch", "mega-mewtwo");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "mega-mewtwo",
    canonical_subject: "Pokemon Go",
    canonical_game: "Pokemon Go",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    short_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    thumbnail_headline: "POKEMON GO MEGA MEWTWO",
    first_spoken_line: "Mega Mewtwo is finally coming to Pokemon Go, and this reveal has a real catch.",
    narration_script:
      "Mega Mewtwo is finally coming to Pokemon Go, and this reveal has a real catch: everyone gets a fair shot, but only if Niantic handles access properly. Eurogamer reports the debut is tied to Go Fest Global, with the event free for all players. That turns it from a paid-event flex into a comeback moment for players who left the app behind. Now Niantic has to land the basics. Raid windows, regional timing and free-player access need to be clear, or the hype turns messy fast. If the rollout is clean, lapsed players may come back for the weekend. Fair access, clear timing and no paywall confusion decide whether this lands. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Mega Mewtwo is finally coming to Pokemon Go, and this reveal has a real catch: everyone gets a fair shot, but only if Niantic handles access properly. Eurogamer reports the debut is tied to Go Fest Global, with the event free for all players. That turns it from a paid-event flex into a comeback moment for players who left the app behind. Now Niantic has to land the basics. Raid windows, regional timing and free-player access need to be clear, or the hype turns messy fast. If the rollout is clean, lapsed players may come back for the weekend. Fair access, clear timing and no paywall confusion decide whether this lands. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Mega Mewtwo is finally coming to Pokemon Go, and this reveal has a real catch: everyone gets a fair shot, but only if Niantic handles access properly. Eurogamer reports the debut is tied to Go Fest Global, with the event free for all players. That turns it from a paid-event flex into a comeback moment for players who left the app behind. Now Niantic has to land the basics. Raid windows, regional timing and free-player access need to be clear, or the hype turns messy fast. If the rollout is clean, lapsed players may come back for the weekend. Fair access, clear timing and no paywall confusion decide whether this lands. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Mega Mewtwo's Pokemon Go debut was announced and Go Fest Global is free for all players. Source: Eurogamer.",
    pinned_comment: "Source: Eurogamer.",
    primary_source: "Eurogamer",
    confirmed_claims: [
      "Mega Mewtwo's Pokemon Go debut finally announced and Go Fest Global is free for all players.",
    ],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    viral_score: 61,
    blockers: ["weak_hook_repeats_headline"],
    warnings: [],
    scores: {
      hook_strength: 42,
      curiosity_gap: 93,
      insight_density: 64,
      source_safety: 86,
      retention_pacing: 82,
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "mega-mewtwo", artifact_dir: artifactDir }],
    generatedAt: "2026-05-28T17:20:00.000Z",
  });

  const savedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  const freshScorecard = buildViralScriptIntelligence({
    story: {
      id: savedManifest.story_id,
      title: savedManifest.selected_title,
      source_name: savedManifest.primary_source,
    },
    script: savedManifest.narration_script,
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "script_scorecard_repaired");
  assert.match(savedManifest.selected_title, /Pokémon Go/i);
  assert.doesNotMatch(savedManifest.selected_title, /^Mega Mewtwo Is Finally Coming/i);
  assert.match(savedManifest.first_spoken_line, /Mega Mewtwo/i);
  const normalTitle = savedManifest.selected_title.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const normalHook = savedManifest.first_spoken_line.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  assert.equal(normalHook.startsWith(normalTitle), false);
  assert.deepEqual(savedScorecard.blockers, []);
  assert.ok(savedScorecard.viral_score >= 75, JSON.stringify(savedScorecard, null, 2));
  assert.equal(freshScorecard.verdict, savedScorecard.verdict);
});

test("public copy package repair explains unrepaired script scorecard failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-script-blocker-"));
  const artifactDir = path.join(root, "batch", "weak-script");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "weak-script",
    canonical_subject: "Forza Horizon 6",
    selected_title: "Forza Horizon 6",
    first_spoken_line: "Forza Horizon 6.",
    primary_source: "PC Gamer",
    confirmed_claims: ["PC Gamer scored Forza Horizon 6 at 84."],
    narration_script:
      "Forza Horizon 6. PC Gamer scored Forza Horizon 6 at 84. Forza Horizon 6. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Forza Horizon 6. PC Gamer scored Forza Horizon 6 at 84. Forza Horizon 6. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Forza Horizon 6. PC Gamer scored Forza Horizon 6 at 84. Forza Horizon 6. Follow Pulse Gaming so you never miss a beat.",
    description: "Forza Horizon 6 scored 84 on PC Gamer. Source: PC Gamer.",
    thumbnail_headline: "FORZA HORIZON 6",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "tighten_before_tts",
    viral_score: 82,
    blockers: [],
    warnings: ["no_curiosity_marker"],
    scores: {
      hook_strength: 55,
      curiosity_gap: 35,
      insight_density: 30,
      source_safety: 86,
      retention_pacing: 65,
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "weak-script", artifact_dir: artifactDir }],
    generatedAt: "2026-05-28T12:40:00.000Z",
  });

  assert.equal(report.summary.blocked_count, 1);
  assert.ok(report.blocked[0].blockers.length > 0, JSON.stringify(report.blocked[0], null, 2));
});

test("public copy repair rewrites confirmed-claim memo language before rerender", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "hades-confirmed-claim",
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      first_spoken_line: "Hades II just broke PlayStation's silence.",
      narration_script:
        "Hades II just broke PlayStation's silence. Xbox showed the latest trailer. The confirmed claim is simple: Hades II is coming to Xbox and PlayStation.",
      description: "Xbox showed the latest Hades II trailer. Source: Xbox.",
      primary_source: "Xbox",
      confirmed_claims: ["Hades II is coming to Xbox and PlayStation"],
    },
    { generatedAt: "2026-05-23T20:12:00.000Z" },
  );

  assert.doesNotMatch(repaired.manifest.narration_script, /confirmed claim is simple/i);
  assert.equal(repaired.manifest.full_script, repaired.manifest.narration_script);
  assert.equal(repaired.manifest.tts_script, repaired.manifest.narration_script);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair rewrites raw official Hades trailer metadata into creator narration", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "hades-official-trailer-title",
      canonical_subject: "Hades II",
      canonical_game: "Hades II",
      canonical_title: "Hades II - Xbox & PlayStation Trailer (Coming April 14th!)",
      selected_title: "Hades II Just Broke PlayStation's Silence",
      first_spoken_line: "Hades II just broke PlayStation's silence.",
      narration_script:
        "Hades II just broke PlayStation's silence. Xbox reports Hades II - Xbox & PlayStation Trailer (Coming April 14th!).",
      description: "Hades II - Xbox & PlayStation Trailer (Coming April 14th!). Source: Xbox.",
      primary_source: "Xbox",
      source_card_label: "Xbox",
      official_source: "Xbox",
      confirmed_claims: ["Hades II - Xbox & PlayStation Trailer (Coming April 14th!)"],
    },
    { generatedAt: "2026-05-23T21:05:00.000Z" },
  );

  assert.doesNotMatch(repaired.manifest.narration_script, /Xbox reports Hades II - Xbox/i);
  assert.match(repaired.manifest.narration_script, /Hades II hits Xbox and PlayStation on the same April clock/i);
  assert.match(repaired.manifest.narration_script, /Xbox's trailer lists Supergiant's sequel for both consoles on April 14/i);
  assert.doesNotMatch(repaired.manifest.narration_script, /not just leaving early access/i);
  assert.doesNotMatch(repaired.manifest.narration_script, /For players, this only matters/i);
  assert.equal(repaired.manifest.full_script, repaired.manifest.narration_script);
  assert.equal(repaired.manifest.tts_script, repaired.manifest.narration_script);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy QA rejects flat Hades narration and semantically truncated thumbnail text", () => {
  const qa = evaluateGoalPublicCopy({
    story_id: "hades-flat-review-sample",
    canonical_subject: "Hades II",
    canonical_game: "Hades II",
    selected_title: "Hades II Just Broke PlayStation's Silence",
    thumbnail_headline: "HADES II JUST BROKE PLAYSTATION'S",
    first_spoken_line: "Hades II just broke PlayStation's silence.",
    narration_script: [
      "Hades II just broke PlayStation's silence.",
      "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
      "The platform list is the point: this is no longer just a PC early-access story.",
      "The console version needs to feel as sharp as the PC build.",
      "A longer public showing would say more than another quick trailer.",
      "Follow Pulse Gaming so you never miss a beat.",
    ].join(" "),
    full_script: [
      "Hades II just broke PlayStation's silence.",
      "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
      "The platform list is the point: this is no longer just a PC early-access story.",
      "The console version needs to feel as sharp as the PC build.",
      "A longer public showing would say more than another quick trailer.",
      "Follow Pulse Gaming so you never miss a beat.",
    ].join(" "),
    tts_script: [
      "Hades II just broke PlayStation's silence.",
      "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date.",
      "The platform list is the point: this is no longer just a PC early-access story.",
      "The console version needs to feel as sharp as the PC build.",
      "A longer public showing would say more than another quick trailer.",
      "Follow Pulse Gaming so you never miss a beat.",
    ].join(" "),
    description: "Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date. Source: Xbox.",
    primary_source: "Xbox",
    confirmed_claims: ["Xbox's trailer lists Hades II for Xbox and PlayStation, with an April 14 date."],
  });

  assert.equal(qa.verdict, "fail");
  assert.ok(qa.failures.includes("public_copy:formulaic_public_narration"));
  assert.ok(qa.failures.includes("public_copy:thumbnail_semantically_truncated"));
});

test("public copy QA rejects the Boltgun weak-title and lazy player-angle sentence", () => {
  const qa = evaluateGoalPublicCopy({
    canonical_subject: "Warhammer 40,000: Boltgun 2",
    selected_title: "Boltgun 2 Already Feels Loud",
    first_spoken_line: "Warhammer 40,000: Boltgun 2 already feels loud in its new demo.",
    narration_script:
      "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. The player angle is simple: check the price, access or platform details before you decide what to play next.",
    description:
      "Warhammer 40,000: Boltgun 2 already feels loud in its new demo. Source: IGN.",
  });

  assert.equal(qa.verdict, "fail");
  assert.ok(qa.failures.includes("public_copy:weak_title_pattern"));
  assert.ok(qa.failures.includes("public_copy:lazy_player_angle_sentence"));
});

test("public copy repair writes changed packages and emits regeneration work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story",
    canonical_subject: "Warhammer 40,000 Boltgun 2",
    canonical_title: "Warhammer 40,000: Boltgun 2 demo impressions",
    selected_title: "Warhammer 40,000 Boltgun 2 Just Got A Content Push",
    primary_source: "IGN",
    description: "I've only played a couple hours of Warhammer 40,000: Boltgun 2. Source: IGN.",
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    title: "Boltgun 2 Already Feels Loud",
    thumbnail_headline: "BOLTGUN 2 ALREADY FEELS LOUD",
    first_frame_text: "BOLTGUN 2 ALREADY FEELS LOUD",
    mobile_hook_text: "Warhammer 40,000: Boltgun 2 already feels loud in its new demo.",
    narration_script: "Warhammer 40,000: Boltgun 2 already feels loud in its new demo.",
    full_script: "Warhammer 40,000: Boltgun 2 already feels loud in its new demo.",
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "story",
    outputs: {
      youtube_shorts: {
        title: "Boltgun 2 Already Feels Loud",
        cta: "Follow Pulse Gaming so you never miss a beat.",
        description:
          "Warhammer 40,000: Boltgun 2: source_locked_update. Source: IGN. Sources and related links: /p/boltgun",
        cover_frame: {
          headline: "BOLTGUN 2 ALREADY FEELS LOUD",
          subject: "Warhammer 40,000 Boltgun 2",
          source_label: "IGN",
        },
      },
      tiktok: {
        conversational_hook: "Warhammer 40,000: Boltgun 2 already feels loud in its new demo.",
        caption: "Warhammer 40,000: Boltgun 2 has a practical catch.",
      },
      instagram_reels: {
        caption: "Boltgun 2 already feels loud. Source: IGN.",
        cover_frame: {
          headline: "BOLTGUN 2 ALREADY FEELS LOUD",
        },
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T03:15:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const renderStory = await fs.readJson(path.join(artifactDir, "visual_v4_render_story.json"));
  const captions = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const workOrder = await buildProductionRerenderWorkOrder(report);

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.public_copy_repaired_at, "2026-05-22T03:15:00.000Z");
  assert.match(captions, /Warhammer 40,000: Boltgun 2/);
  assert.equal(platform.public_copy_synced_at, "2026-05-22T03:15:00.000Z");
  assert.equal(platform.outputs.youtube_shorts.title, "Boltgun 2 Leaves The Corridors");
  assert.equal(platform.outputs.youtube_shorts.cta, "Follow Pulse Gaming so you never miss a beat.");
  assert.match(platform.outputs.youtube_shorts.description, /bigger outdoor spaces/i);
  assert.doesNotMatch(JSON.stringify(platform.outputs), /Already Feels Loud|source_locked_update|practical catch/i);
  assert.equal(platform.outputs.tiktok.conversational_hook, updated.first_spoken_line);
  assert.equal(platform.outputs.instagram_reels.cover_frame.headline, "BOLTGUN 2 LEAVES THE CORRIDORS");
  assert.equal(renderStory.title, "Boltgun 2 Leaves The Corridors");
  assert.equal(renderStory.thumbnail_headline, "BOLTGUN 2 LEAVES THE CORRIDORS");
  assert.equal(renderStory.first_frame_text, "BOLTGUN 2 LEAVES THE CORRIDORS");
  assert.equal(renderStory.narration_script, updated.narration_script);
  assert.equal(workbench.jobs[0].status, "requires_audio_timestamp_generation");
  assert.equal(workOrder.jobs[0].status, "ready_for_final_render_job");
  assert.deepEqual(workOrder.jobs[0].evidence.materialised_motion_clip_paths, ["clip-a.mp4", "clip-b.mp4"]);
});

test("public copy repair routes Reddit-primary blockers into source attribution work orders", async () => {
  const report = {
    generated_at: "2026-05-23T18:58:00.000Z",
    blocked: [
      {
        story_id: "v-rising-source",
        artifact_dir: "output/goal-proof/batch/v-rising-source",
        blockers: ["public_copy:reddit_discovery_label_used_as_primary_source"],
      },
      {
        story_id: "image-source",
        artifact_dir: "output/goal-proof/batch/image-source",
        blockers: ["public_copy:non_news_image_post_source"],
      },
    ],
  };

  const workOrder = buildSourceAttributionRepairWorkOrder(report);

  assert.equal(workOrder.summary.story_count, 2);
  assert.equal(workOrder.jobs[0].repair_lane, "official_source_intake_required");
  assert.equal(workOrder.jobs[0].blocker_type, "public_copy:reddit_discovery_label_used_as_primary_source");
  assert.match(workOrder.jobs[0].recommended_command, /official-source-intake/);
  assert.equal(workOrder.jobs[0].db_mutation_required, false);
  assert.equal(workOrder.jobs[0].operator_approval_required, true);
  assert.equal(workOrder.jobs[1].blocker_type, "public_copy:non_news_image_post_source");
  assert.match(workOrder.jobs[1].exact_missing_input, /non-image/i);
});

test("public copy repair applies verified non-Reddit source attribution before rewriting Reddit-primary copy", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-source-attribution-entry-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "forza-review-thread",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_title: "'Forza Horizon 6' - Review Thread",
    selected_title: "Forza Horizon 6 Reviews Are In",
    first_spoken_line: "Forza Horizon 6 reviews are finally in.",
    narration_script:
      "Forza Horizon 6 reviews are finally in. Reddit reports Forza Horizon 6 reviews are now in. The watch point is what changes for players before the next buy, install or wishlist decision.",
    description: "Forza Horizon 6 reviews are now in. Source: Reddit.",
    primary_source: "Reddit",
    source_card_label: "Reddit",
    primary_source_url:
      "https://reddit.com/r/gaming/comments/1tcw2yy/forza_horizon_6_review_thread/",
    discovery_source: "Reddit",
    confirmed_claims: ["Forza Horizon 6 reviews are now in."],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "forza-review-thread",
    outputs: {
      youtube_shorts: {
        title: "Forza Horizon 6 Reviews Are In",
        description: "Forza Horizon 6 reviews are now in. Source: Reddit.",
        cover_frame: { headline: "FORZA HORIZON 6 REVIEWS", source_label: "Reddit" },
      },
      tiktok: {
        conversational_hook: "Forza Horizon 6 reviews are finally in.",
        caption: "Forza Horizon 6 reviews are finally in. Source: Reddit.",
      },
      x: {
        source_safe_post: "Forza Horizon 6 Reviews Are In\n\nSource: Reddit. Full source list: /p/forza-horizon-6-1tcw2yy",
        thread_posts: [
          "Forza Horizon 6 Reviews Are In",
          "Source: Reddit. The confirmed angle is racing_game_setup.",
        ],
      },
      threads: {
        discussion_post: "Forza Horizon 6 is worth watching for the player impact, not just the headline. Source: Reddit.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "forza-review-thread", artifact_dir: artifactDir }],
    sourceAttributionEntries: [
      {
        story_id: "forza-review-thread",
        source_name: "PC Gamer",
        source_url: "https://www.pcgamer.com/games/racing/forza-horizon-6-review/",
        source_type: "reliable_publication_article",
        source_title: "Forza Horizon 6 review",
        supported_claim:
          "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
        evidence_notes: "Publication review page directly names Forza Horizon 6.",
        secondary_sources: [
          {
            name: "GameSpot",
            url: "https://www.gamespot.com/reviews/forza-horizon-6-review-dopamine-highway/1900-6418489/",
          },
          {
            name: "VGC",
            url: "https://www.videogameschronicle.com/review/forza-horizon-6/",
          },
        ],
      },
    ],
    generatedAt: "2026-05-23T20:15:00.000Z",
  });

  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const qa = evaluateGoalPublicCopy(updated);

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.equal(updated.primary_source, "PC Gamer");
  assert.equal(updated.source_card_label, "PC Gamer");
  assert.equal(updated.primary_source_url, "https://www.pcgamer.com/games/racing/forza-horizon-6-review/");
  assert.equal(updated.official_source, null);
  assert.match(updated.narration_script, /PC Gamer published its Forza Horizon 6 review/i);
  assert.doesNotMatch(updated.narration_script, /Reddit reports|watch point|useful test|only firm read/i);
  assert.match(platform.outputs.youtube_shorts.description, /Source: PC Gamer/i);
  assert.equal(platform.outputs.youtube_shorts.cover_frame.source_label, "PC Gamer");
  assert.doesNotMatch(JSON.stringify(platform.outputs), /Source: Reddit|racing_game_setup/i);
  assert.match(platform.outputs.x.source_safe_post, /Source: PC Gamer/i);
  assert.match(platform.outputs.threads.discussion_post, /PC Gamer/i);
  assert.equal(qa.verdict, "pass");
});

test("public copy repair accepts official attribution for short product subjects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-short-subject-source-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "ps5-price",
    canonical_subject: "PS5",
    canonical_game: "PS5",
    canonical_title: "PS5 price hike rumour hits Europe",
    selected_title: "PS5 Price Hike Rumour Hits Europe",
    first_spoken_line: "PS5 price hike rumours are back in Europe.",
    narration_script:
      "PS5 price hike rumours are back in Europe. Reddit reports PS5 prices could rise again. The useful test is whether you should buy now or wait.",
    description: "PS5 price hike rumours are back in Europe. Source: Reddit.",
    primary_source: "Reddit",
    source_card_label: "Reddit",
    primary_source_url: "https://reddit.com/r/gamingleaksandrumours/comments/1s4d0ev/ps5_price_hike/",
    discovery_source: "Reddit",
    confirmed_claims: ["PS5 price hike rumours are back in Europe."],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "ps5-price",
    outputs: {
      youtube_shorts: {
        title: "PS5 Price Hike Rumour Hits Europe",
        description: "PS5 price hike rumours are back in Europe. Source: Reddit.",
        cover_frame: { headline: "PS5 PRICE HIKE", source_label: "Reddit" },
      },
      tiktok: {
        conversational_hook: "PS5 price hike rumours are back in Europe.",
        caption: "PS5 price hike rumours are back in Europe. Source: Reddit.",
      },
      x: {
        source_safe_post: "PS5 Price Hike Rumour Hits Europe\n\nSource: Reddit.",
        thread_posts: ["PS5 Price Hike Rumour Hits Europe", "Source: Reddit."],
      },
      threads: {
        discussion_post: "PS5 buyers in Europe may need to watch this. Source: Reddit.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "ps5-price", artifact_dir: artifactDir }],
    sourceAttributionEntries: [
      {
        story_id: "ps5-price",
        source_name: "PlayStation Blog",
        source_url:
          "https://blog.playstation.com/2026/03/27/new-price-changes-for-ps5-ps5-pro-and-playstation-portal-remote-player/",
        source_type: "official_publisher_statement",
        source_title: "New price changes for PS5, PS5 Pro and PlayStation Portal remote player",
        supported_claim:
          "PlayStation Blog announced new PS5, PS5 Pro and PlayStation Portal prices in Europe, Australia and New Zealand from 14 April 2026.",
        evidence_notes: "The official PlayStation post directly names PS5 and the affected regions.",
      },
    ],
    generatedAt: "2026-05-23T20:20:00.000Z",
  });

  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const qa = evaluateGoalPublicCopy(updated);

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.equal(updated.selected_title, "PS5 Prices Went Up In Europe");
  assert.equal(updated.first_spoken_line, "PS5 prices went up, but the problem is how wide Sony made the list.");
  assert.equal(updated.thumbnail_headline, "PS5 PRICE JUMP");
  assert.equal(updated.primary_source, "PlayStation Blog");
  assert.equal(updated.source_card_label, "PlayStation Blog");
  assert.equal(updated.official_source, "PlayStation Blog");
  assert.match(updated.narration_script, /PlayStation Blog announced new PS5/i);
  assert.doesNotMatch(updated.narration_script, /Reddit reports|rumou?r|useful test/i);
  assert.doesNotMatch(updated.selected_title, /rumou?r/i);
  assert.match(platform.outputs.youtube_shorts.description, /Source: PlayStation Blog/i);
  assert.equal(platform.outputs.youtube_shorts.cover_frame.source_label, "PlayStation Blog");
  assert.equal(platform.outputs.youtube_shorts.cover_frame.headline, "PS5 PRICE JUMP");
  assert.doesNotMatch(JSON.stringify(platform.outputs), /Source: Reddit/i);
  assert.equal(qa.verdict, "pass");
});

test("public copy repair rejects image-only source attribution entries", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-image-source-attribution-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "1tbpzah",
    canonical_subject: "Capturing",
    canonical_game: "Capturing",
    canonical_title: "Capturing mewtwo in the office shh (pokemon red version) game boy color og",
    selected_title: "Capturing Has One Player Question",
    first_spoken_line: "Capturing Has One Player Question.",
    narration_script:
      "Capturing Has One Player Question. I reports Capturing mewtwo in the office shh (pokemon red version) game boy color og.",
    description: "Capturing mewtwo in the office shh (pokemon red version) game boy color og. Source: I.",
    primary_source: "I",
    source_card_label: "I",
    primary_source_url: "https://i.redd.it/g9uhlr6g9u0h1.jpeg",
    confirmed_claims: ["Capturing mewtwo in the office shh (pokemon red version) game boy color og"],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "1tbpzah", artifact_dir: artifactDir }],
    sourceAttributionEntries: [
      {
        story_id: "1tbpzah",
        source_name: "Pokemon image post",
        source_url: "https://i.redd.it/g9uhlr6g9u0h1.jpeg",
        source_type: "reliable_publication_article",
        source_title: "Capturing Mewtwo in Pokemon Red",
        supported_claim: "Capturing Mewtwo in Pokemon Red appears in the submitted image.",
        evidence_notes: "This is still only a raw image URL, not a news or official source.",
      },
    ],
    generatedAt: "2026-05-25T09:49:40.592Z",
  });
  const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.blocked_count, 1);
  assert.ok(report.blocked[0].blockers.includes("source_attribution:image_only_source_not_allowed"));
  assert.equal(manifest.primary_source, "I");
  assert.equal(manifest.primary_source_url, "https://i.redd.it/g9uhlr6g9u0h1.jpeg");
});

test("public copy repair applies supplied source attribution even when copy already passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-source-attribution-pass-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "kadokawa-source-pass",
    canonical_subject: "Kadokawa",
    canonical_game: "Kadokawa",
    canonical_title: "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's",
    selected_title: "Kadokawa Stake Just Passed Sony",
    thumbnail_headline: "KADOKAWA STAKE JUST PASSED SONY",
    first_spoken_line: "Kadokawa's activist investor now has a bigger stake than Sony.",
    narration_script:
      "Kadokawa's activist investor now has a bigger stake than Sony. Reddit reports Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's. Source: Reddit.",
    primary_source: "Reddit",
    source_card_label: "Reddit",
    discovery_source: "Reddit",
    primary_source_url: "https://reddit.com/r/GamingLeaksAndRumours/comments/example/kadokawa/",
    confirmed_claims: [
      "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "kadokawa-source-pass", artifact_dir: artifactDir }],
    sourceAttributionEntries: [
      {
        story_id: "kadokawa-source-pass",
        source_name: "Automaton West",
        source_url:
          "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
        source_type: "reliable_publication_article",
        source_title: "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's",
        supported_claim:
          "Automaton West reported that Oasis Management raised its Kadokawa stake to 11.85%, exceeding Sony's stake.",
        evidence_notes:
          "Publication article directly names Kadokawa, Oasis Management, the 11.85% stake and Sony comparison.",
      },
    ],
    generatedAt: "2026-05-25T05:05:00.000Z",
  });

  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.primary_source, "Automaton West");
  assert.equal(updated.source_card_label, "Automaton West");
  assert.equal(
    updated.primary_source_url,
    "https://automaton-media.com/en/news/kadokawas-activist-shareholder-oasis-management-raises-stake-to-11-85-exceeding-sonys/",
  );
  assert.match(updated.narration_script, /Automaton West reported/i);
  assert.doesNotMatch(updated.narration_script, /Reddit reports/i);
});

test("public copy repair CLI writes source attribution work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-source-attribution-cli-"));
  const artifactDir = path.join(root, "story");
  const outDir = path.join(root, "out");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "v-rising-source",
    canonical_subject: "V Rising",
    canonical_game: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    first_spoken_line: "V Rising's developers are making another vampire game.",
    narration_script:
      "V Rising's developers are making another vampire game. Reddit says the studio has another vampire project in development.",
    description: "V Rising's developers are making another vampire game. Source: Reddit.",
    primary_source: "Reddit",
    source_card_label: "Reddit",
    discovery_source: "Reddit",
    confirmed_claims: ["V Rising's developers are making another vampire game"],
  });
  await fs.outputJson(path.join(root, "story-packages.json"), [
    { story_id: "v-rising-source", artifact_dir: artifactDir },
  ]);

  const originalLog = console.log;
  let result;
  console.log = () => {};
  try {
    result = await runPublicCopyRepairCli([
      "--root",
      root,
      "--story-packages",
      "story-packages.json",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-23T19:05:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }
  const workOrder = await fs.readJson(path.join(outDir, "source_attribution_repair_work_order.json"));

  assert.equal(result.sourceAttributionWorkOrder.summary.story_count, 1);
  assert.equal(workOrder.summary.story_count, 1);
  assert.equal(workOrder.jobs[0].repair_lane, "official_source_intake_required");
});

test("public copy repair CLI filters packages by repeatable story id", async () => {
  const args = parsePublicCopyRepairArgs([
    "--story-id",
    "target-story",
    "--story-id",
    "second-story",
    "--story-ids",
    "third-story, fourth-story",
    "--reserved-title",
    "Forza Horizon 6 Scores 84 On PC Gamer",
    "--reserved-titles",
    "Helldivers 2 Is Getting Warhammer Gear||Lego Batman Is Chasing Arkham",
  ]);

  assert.deepEqual(args.storyIds, ["target-story", "second-story", "third-story", "fourth-story"]);
  assert.deepEqual(args.reservedTitles, [
    "Forza Horizon 6 Scores 84 On PC Gamer",
    "Helldivers 2 Is Getting Warhammer Gear",
    "Lego Batman Is Chasing Arkham",
  ]);
});

test("public copy repair CLI only mutates selected story packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-story-filter-cli-"));
  const targetDir = path.join(root, "target");
  const otherDir = path.join(root, "other");
  const outDir = path.join(root, "out");
  await fs.ensureDir(targetDir);
  await fs.ensureDir(otherDir);
  await fs.outputJson(path.join(targetDir, "canonical_story_manifest.json"), {
    story_id: "target-story",
    canonical_subject: "Rumor",
    canonical_game: "Rumor",
    canonical_title: "Rumor: Another PS5 price hike coming to at least Europe shortly",
    selected_title: "Rumor Just Got More Expensive",
    primary_source: "Reddit",
    description: "Rumor: Another PS5 price hike coming to at least Europe shortly. Source: Reddit.",
    confirmed_claims: ["Rumor: Another PS5 price hike coming to at least Europe shortly"],
  });
  await fs.outputJson(path.join(otherDir, "canonical_story_manifest.json"), {
    story_id: "other-story",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_title: "Forza Horizon 6 Has Made Over $140 Million from Premium Edition",
    selected_title: "Forza Horizon 6 Just Got More Expensive",
    primary_source: "Insider Gaming",
    description: "Forza Horizon 6 Has Made Over $140 Million from Premium Edition. Source: Insider Gaming.",
    confirmed_claims: ["Forza Horizon 6 Premium Edition has made over $140 million."],
  });
  await fs.outputJson(path.join(root, "story-packages.json"), [
    { story_id: "target-story", artifact_dir: targetDir },
    { story_id: "other-story", artifact_dir: otherDir },
  ]);

  const originalLog = console.log;
  let result;
  console.log = () => {};
  try {
    result = await runPublicCopyRepairCli([
      "--root",
      root,
      "--story-packages",
      "story-packages.json",
      "--story-id",
      "target-story",
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-24T17:29:34.290Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  const target = await fs.readJson(path.join(targetDir, "canonical_story_manifest.json"));
  const other = await fs.readJson(path.join(otherDir, "canonical_story_manifest.json"));
  const report = await fs.readJson(path.join(outDir, "public_copy_repair_report.json"));

  assert.equal(result.report.summary.package_count, 1);
  assert.equal(report.summary.package_count, 1);
  assert.equal(target.canonical_subject, "PS5");
  assert.equal(other.selected_title, "Forza Horizon 6 Just Got More Expensive");
  assert.equal(other.public_copy_repaired_at, undefined);
});

test("public copy repair CLI prefers fresh local TTS doctor over stale ElevenLabs workbench", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-local-tts-cli-"));
  const artifactDir = path.join(root, "story");
  const outDir = path.join(root, "out");
  const staleWorkbenchPath = path.join(root, "audio_timestamp_workbench.json");
  const doctorPath = path.join(root, "local_tts_doctor.json");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "forza-copy",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Has One Player Question",
    first_spoken_line: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling.",
    narration_script:
      "Forza Horizon 6 Just Broke Xbox's Steam Ceiling. The practical question is whether this changes what people buy, wishlist or wait on.",
    description: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling. Source: GamesRadar.",
    primary_source: "GamesRadar",
    confirmed_claims: ["Forza Horizon 6 Just Broke Xbox's Steam Ceiling"],
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });
  await fs.outputJson(path.join(root, "story-packages.json"), [
    { story_id: "forza-copy", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(staleWorkbenchPath, {
    local_tts: { ready: false, verdict: "stale", stale: true },
    elevenlabs_tts: { ready: true, configured: true, secret_values_exposed: false },
    provider_preference: "elevenlabs",
  });
  await fs.outputJson(doctorPath, {
    generated_at: "2026-05-23T19:20:00.000Z",
    verdict: "green",
    action: "none",
    failure_code: null,
    reason: "local Liam ready",
    before: { status: "ok", ready: true, voice: "liam" },
  });

  const originalLog = console.log;
  let result;
  console.log = () => {};
  try {
    result = await runPublicCopyRepairCli([
      "--root",
      root,
      "--story-packages",
      "story-packages.json",
      "--audio-workbench",
      staleWorkbenchPath,
      "--local-tts-doctor",
      doctorPath,
      "--out-dir",
      outDir,
      "--generated-at",
      "2026-05-23T19:21:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.audioWorkbench.summary.story_count, 1);
  assert.equal(result.audioWorkbench.summary.elevenlabs_generation_count, 0);
  assert.equal(result.audioWorkbench.jobs[0].tts_provider, "local");
  assert.equal(result.audioWorkbench.provider_preference, "local");
});

test("public copy repair workbench routes regenerated narration to ElevenLabs when local TTS is down", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-elevenlabs-workbench-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "story",
    canonical_subject: "Forza Horizon 6",
    canonical_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
    selected_title: "Forza Horizon 6 Has One Player Question",
    primary_source: "GamesRadar",
    narration_script:
      "Forza Horizon 6 Just Broke Xbox's Steam Ceiling. The practical question is whether this changes what people buy, wishlist, reinstall or wait on.",
    description: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling. Source: GamesRadar.",
    confirmed_claims: ["Forza Horizon 6 Just Broke Xbox's Steam Ceiling"],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T08:25:00.000Z",
  });
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: false, verdict: "red" },
    elevenlabsTts: { provider: "elevenlabs", ready: true, configured: true, secret_values_exposed: false },
    providerPreference: "auto",
  });

  assert.equal(workbench.summary.elevenlabs_generation_count, 1);
  assert.equal(workbench.summary.blocked_tts_count, 0);
  assert.equal(workbench.jobs[0].tts_provider, "elevenlabs");
  assert.equal(workbench.elevenlabs_tts.secret_values_exposed, false);
});

test("public copy package repair rewrites source-attribution mismatches", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-source-mismatch-repair-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "source-mismatch-story",
    canonical_subject: "Warhammer 40,000: Dawn of War 4",
    selected_title: "Dawn Of War 4 Finally Shows Gameplay",
    thumbnail_headline: "DAWN OF WAR 4 GAMEPLAY",
    first_spoken_line: "Warhammer 40,000: Dawn of War 4 finally shows gameplay.",
    narration_script:
      "Warhammer 40,000: Dawn of War 4 finally shows gameplay. IGN says Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing.",
    description: "IGN says Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing. Source: GameSpot.",
    primary_source: "GameSpot",
    confirmed_claims: [
      "IGN says Dawn of War 4 now has gameplay footage and a clearer Warhammer Skulls showing",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "source-mismatch-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T23:45:00.000Z",
  });

  assert.equal(report.summary.changed_count, 1);
  const repaired = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.doesNotMatch(repaired.narration_script, /IGN\s+(?:says|reports)/i);
  assert.match(repaired.narration_script, /GameSpot reports Dawn of War 4/i);
});

test("public copy repair leaves already-clean packages out of regeneration work orders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-clean-"));
  const artifactDir = path.join(root, "clean-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "clean-story",
    canonical_subject: "Total War: Warhammer 40,000",
    canonical_game: "Total War: Warhammer 40,000",
    canonical_title: "Total War Is Going Full Warhammer 40K",
    selected_title: "Total War Is Going Full Warhammer 40K",
    short_title: "Total War Is Going Full Warhammer 40K",
    title_candidates: ["Total War Is Going Full Warhammer 40K"],
    thumbnail_headline: "TOTAL WAR IS GOING FULL",
    thumbnail_text: "TOTAL WAR IS GOING FULL",
    first_spoken_line: "Total War: Warhammer 40,000 finally showed up at Warhammer Skulls.",
    narration_hook: "Total War: Warhammer 40,000 finally showed up at Warhammer Skulls.",
    narration_script:
      "Total War: Warhammer 40,000 finally showed up at Warhammer Skulls. GameSpot reports Total War: Warhammer 40K has an official Warhammer Skulls teaser trailer. That matters because Creative Assembly is no longer only talking around the idea. Follow Pulse Gaming so you never miss a beat.",
    description: "Total War: Warhammer 40K has an official Warhammer Skulls teaser trailer. Source: GameSpot.",
    pinned_comment: "Source: GameSpot.",
    primary_source: "GameSpot",
    confirmed_claims: ["Total War: Warhammer 40K has an official Warhammer Skulls teaser trailer"],
    allowed_public_wording: [
      "Total War Is Going Full Warhammer 40K",
      "Total War: Warhammer 40,000 finally showed up at Warhammer Skulls.",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "clean-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T12:02:00.000Z",
  });
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });

  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.unchanged_count, 1);
  assert.equal(workbench.jobs.length, 0);
});

test("public copy repair resyncs stale platform packs even when canonical copy is clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-platform-stale-"));
  const artifactDir = path.join(root, "platform-stale-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "platform-stale-story",
    canonical_subject: "Warhammer 40,000: Boltgun 2",
    selected_title: "Boltgun 2 Leaves The Corridors",
    short_title: "Boltgun 2 Leaves The Corridors",
    thumbnail_headline: "BOLTGUN 2 LEAVES THE CORRIDORS",
    thumbnail_text: "BOLTGUN 2 LEAVES THE CORRIDORS",
    first_spoken_line: "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces.",
    narration_script:
      "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces. IGN reports the sequel is moving its retro FPS combat into bigger outdoor spaces. For players, the real question is whether those bigger arenas make the sequel feel like a proper step up. Follow Pulse Gaming so you never miss a beat.",
    description: "IGN previewed Warhammer 40,000: Boltgun 2 moving its retro FPS combat into bigger outdoor spaces. Source: IGN.",
    pinned_comment: "Source: IGN.",
    primary_source: "IGN",
    confirmed_claims: [
      "IGN previewed Warhammer 40,000: Boltgun 2 moving its retro FPS combat into bigger outdoor spaces",
    ],
    allowed_public_wording: [
      "Boltgun 2 Leaves The Corridors",
      "Warhammer 40,000: Boltgun 2 is taking its retro FPS chaos into bigger outdoor spaces.",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "platform-stale-story",
    outputs: {
      youtube_shorts: {
        title: "Boltgun 2 Already Feels Loud",
        description: "Warhammer 40,000: Boltgun 2: source_locked_update. Source: IGN.",
        cover_frame: { headline: "BOLTGUN 2 ALREADY FEELS LOUD" },
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "platform-stale-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T18:55:00.000Z",
  });
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(platform.outputs.youtube_shorts.title, "Boltgun 2 Leaves The Corridors");
  assert.doesNotMatch(JSON.stringify(platform.outputs), /Already Feels Loud|source_locked_update/i);
});

test("public copy repair does not queue audio or rerender jobs for platform-pack-only syncs", async () => {
  const report = {
    generated_at: "2026-05-22T23:35:00.000Z",
    changed: [
      {
        story_id: "canonical-change",
        title: "Boltgun 2 Leaves The Corridors",
        artifact_dir: path.join(os.tmpdir(), "canonical-change"),
        status: "changed",
      },
      {
        story_id: "platform-only",
        title: "Xbox Controller Deal Has One Catch",
        artifact_dir: path.join(os.tmpdir(), "platform-only"),
        status: "platform_pack_synced",
      },
    ],
  };
  await fs.ensureDir(path.join(os.tmpdir(), "canonical-change"));
  await fs.outputJson(path.join(os.tmpdir(), "canonical-change", "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4"],
  });

  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);

  assert.deepEqual(workbench.jobs.map((job) => job.story_id), ["canonical-change"]);
  assert.deepEqual(renderWorkOrder.jobs.map((job) => job.story_id), ["canonical-change"]);
});

test("public copy repair keeps prior copy rewrites in regeneration work orders until consumed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-pending-rerender-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "pending-copy",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    short_title: "Forza Horizon 6 Broke Xbox's Steam Ceiling",
    thumbnail_headline: "FORZA HORIZON 6 BROKE",
    first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
    narration_script:
      "Forza Horizon 6 just turned its Steam launch into an Xbox signal. GamesRadar reports the game is drawing heavy Steam attention. If Steam is where Forza takes off, Xbox has a different launch story on its hands. Follow Pulse Gaming so you never miss a beat.",
    description: "Forza Horizon 6 is drawing heavy Steam attention. Source: GamesRadar.",
    primary_source: "GamesRadar",
    confirmed_claims: ["Forza Horizon 6 is drawing heavy Steam attention"],
    public_copy_repaired_at: "2026-05-23T19:30:00.000Z",
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "pending-copy", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T19:35:00.000Z",
  });
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);

  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.unchanged_count, 1);
  assert.equal(report.unchanged[0].status, "unchanged_pending_public_copy_regeneration");
  assert.deepEqual(workbench.jobs.map((job) => job.story_id), ["pending-copy"]);
  assert.deepEqual(renderWorkOrder.jobs.map((job) => job.story_id), ["pending-copy"]);
});

test("public copy repair rewrites clean-looking packages when thumbnail lacks the subject", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-thumbnail-subject-"));
  const artifactDir = path.join(root, "thumbnail-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "thumbnail-story",
    canonical_subject: "Nintendo Switch 2",
    canonical_game: "Nintendo Switch 2",
    canonical_title: "Nintendo Switch 2 just got more expensive in one market",
    selected_title: "Nintendo Switch 2 Just Got More Expensive",
    short_title: "Nintendo Switch 2 Just Got More Expensive",
    thumbnail_headline: "PRICES WENT UP",
    thumbnail_text: "PRICES WENT UP",
    first_spoken_line: "Nintendo Switch 2 just got more expensive for players.",
    narration_script:
      "Nintendo Switch 2 just got more expensive for players. IGN reports the regional price change is now live. The player angle is simple: check the exact bundle before you buy.",
    description: "Nintendo Switch 2 has a regional price change. Source: IGN.",
    pinned_comment: "Source: IGN.",
    primary_source: "IGN",
    confirmed_claims: ["Nintendo Switch 2 has a regional price change"],
    allowed_public_wording: [
      "Nintendo Switch 2 Just Got More Expensive",
      "Nintendo Switch 2 just got more expensive for players.",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "thumbnail-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T17:10:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.thumbnail_headline, "SWITCH 2 PRICE JUMP");
  assert.equal(updated.thumbnail_text, "SWITCH 2 PRICE JUMP");
  assert.equal(updated.public_copy_repaired_at, "2026-05-22T17:10:00.000Z");
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy repair normalises protected brand names before preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-protected-brand-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "pokemon-brand-story",
    canonical_subject: "Pokemon Go",
    canonical_game: "Pokemon Go",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    thumbnail_headline: "POKEMON GO MEGA MEWTWO",
    first_spoken_line: "Mega Mewtwo is finally coming to Pokemon Go.",
    narration_script:
      "Mega Mewtwo is finally coming to Pokemon Go. Eurogamer reports Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players. Source: Eurogamer.",
    primary_source: "Eurogamer",
    primary_source_url: "https://www.eurogamer.net/pokemon-go-mega-mewtwo",
    source_card_label: "Eurogamer",
    confirmed_claims: [
      "Mega Mewtwo's Pokemon Go debut has been announced and Go Fest Global is free for players.",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "pokemon-brand-story",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
    canonical_subject: "Pokemon Go",
    thumbnail_headline: "POKEMON GO MEGA MEWTWO",
    outputs: {
      youtube_shorts: {
        title: "Mega Mewtwo Is Finally Coming To Pokemon Go",
        description:
          "Mega Mewtwo's Pokemon Go debut has been announced. Sources and related links: /p/Pok\u00e9mon-go-pokemon-brand-story",
        profile_or_landing_page_cta: "Story sources and related links: /p/Pok\u00e9mon-go-pokemon-brand-story",
        cover_frame: {
          headline: "POKEMON GO MEGA MEWTWO",
          subject: "Pokemon Go",
          source_label: "Eurogamer",
        },
      },
      instagram_reels: {
        caption: "Mega Mewtwo is finally coming to Pokemon Go. Source: Eurogamer.",
        bio_link_cta: "Story page in bio: /p/Pok\u00e9mon-go-pokemon-brand-story",
      },
      x: {
        hot_take_post: "Pokemon Go finally got the Mega Mewtwo moment players wanted.",
        poll_candidate: "Is Pokemon Go finally getting the event it needed?",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "pokemon-brand-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-25T05:30:00.000Z",
  });

  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.match(updated.selected_title, /Pokémon Go/);
  assert.match(updated.narration_script, /Pokémon Go/);
  assert.match(updated.description, /Pokémon Go/);
  assert.doesNotMatch(updated.selected_title, /\bPokemon\b/);
  assert.doesNotMatch(updated.narration_script, /\bPokemon\b/);
  assert.match(platform.outputs.youtube_shorts.title, /Pokémon Go/);
  assert.match(platform.outputs.youtube_shorts.description, /Pokémon Go/);
  assert.match(platform.outputs.youtube_shorts.profile_or_landing_page_cta, /\/p\/pokemon-go-pokemon-brand-story/);
  assert.match(platform.outputs.instagram_reels.bio_link_cta, /\/p\/pokemon-go-pokemon-brand-story/);
  assert.match(platform.outputs.youtube_shorts.cover_frame.headline, /POKÉMON GO/i);
  assert.match(platform.outputs.x.poll_candidate, /Pokémon Go/i);
  assert.doesNotMatch(platform.outputs.youtube_shorts.title, /\bPokemon\b/);
  assert.doesNotMatch(platform.outputs.youtube_shorts.description.replace(/\/p\/[^\s,.]+/g, ""), /\bPokemon\b/);
});

test("public copy repair normalises mojibake across nested public fields without rewriting links", () => {
  const productUrl = "https://example.com/search?q=Pokemon%20Go";
  const storyRoute = "/go/story/game-accessory-pokemon-go-plus-plus";
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "pokemon-mojibake-story",
      canonical_subject: "Pok\u00c3\u00a9mon Go",
      canonical_game: "Pok\u00c3\u00a9mon Go",
      canonical_title: "Mega Mewtwo is coming to Pok\u00c3\u00a9mon Go",
      selected_title: "Mega Mewtwo Is Finally Coming To Pok\u00c3\u00a9mon Go",
      thumbnail_headline: "POK\u00c3\u0089MON GO MEGA MEWTWO",
      first_spoken_line: "Mega Mewtwo is finally coming to Pok\u00c3\u00a9mon Go.",
      narration_script:
        "Mega Mewtwo is finally coming to Pok\u00c3\u00a9mon Go. Eurogamer reports the Go Fest debut.",
      description: "Mega Mewtwo is coming to Pok\u00c3\u00a9mon Go. Source: Eurogamer.",
      primary_source: "Eurogamer",
      primary_source_url: "https://www.eurogamer.net/pokemon-go-mega-mewtwo",
      confirmed_claims: ["Mega Mewtwo is coming to Pok\u00c3\u00a9mon Go."],
      allowed_public_wording: ["Mega Mewtwo is coming to Pok\u00c3\u00a9mon Go."],
      commercial_intelligence: {
        fallback_links: [
          {
            id: "pokemon-go-plus-plus",
            label: "Pok\u00c3\u00a9mon Go Plus Plus",
            query: "Pok\u00c3\u00a9mon Go accessory",
            reason: "Useful for Pok\u00c3\u00a9mon Go players who want an event accessory.",
            url: productUrl,
            route: storyRoute,
          },
        ],
      },
    },
    { generatedAt: "2026-05-26T15:10:00.000Z" },
  );

  const manifest = repaired.manifest;
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /Pok\u00c3|\u00c3|\u00c2/);
  assert.equal(manifest.story_id, "pokemon-mojibake-story");
  assert.equal(manifest.commercial_intelligence.fallback_links[0].id, "pokemon-go-plus-plus");
  assert.match(manifest.canonical_subject, /Pok\u00e9mon Go/);
  assert.match(manifest.selected_title, /Pok\u00e9mon Go/);
  assert.match(manifest.commercial_intelligence.fallback_links[0].label, /Pok\u00e9mon Go/);
  assert.match(manifest.commercial_intelligence.fallback_links[0].query, /Pok\u00e9mon Go/);
  assert.match(manifest.commercial_intelligence.fallback_links[0].reason, /Pok\u00e9mon Go/);
  assert.equal(manifest.commercial_intelligence.fallback_links[0].url, productUrl);
  assert.equal(manifest.commercial_intelligence.fallback_links[0].route, storyRoute);
});

test("public copy repair rewrites Crimson Desert without instruction-like buyer narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-crimson-"));
  const artifactDir = path.join(root, "crimson-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "crimson-story",
    canonical_subject: "Crimson Desert",
    canonical_game: "Crimson Desert",
    canonical_title: "Crimson Desert launched on March 19, 2026",
    selected_title: "Crimson Desert Finally Has A Date",
    short_title: "Crimson Desert Finally Has A Date",
    thumbnail_headline: "CRIMSON DATE",
    first_spoken_line: "Crimson Desert is already live, so the question is whether players should jump in now.",
    narration_script:
      "Crimson Desert is already live, so the question is whether players should jump in now. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. That matters because this is where a headline turns into a real player decision. Follow Pulse Gaming so you never miss a beat.",
    description: "Crimson Desert launched on March 19, 2026. Source: GameSpot.",
    primary_source: "GameSpot",
    confirmed_claims: [
      "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing.",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "crimson-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-24T11:20:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
  assert.match(updated.narration_script, /Crimson Desert/);
  assert.doesNotMatch(
    updated.narration_script,
    /question is whether players should|headline turns into a real player decision|buy, download, wait or skip/i,
  );
});

test("public copy repair rewrites ASR-exhausted narration even when public copy passes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-asr-exhausted-"));
  const artifactDir = path.join(root, "crimson-asr-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "crimson-asr-story",
    canonical_subject: "Crimson Desert",
    canonical_game: "Crimson Desert",
    canonical_title: "Crimson Desert launched on March 19, 2026",
    selected_title: "Crimson Desert Is Already Live",
    short_title: "Crimson Desert Is Already Live",
    thumbnail_headline: "CRIMSON DESERT LIVE",
    thumbnail_text: "CRIMSON DESERT LIVE",
    first_spoken_line: "Crimson Desert is already live after years of glossy showcase footage.",
    narration_script:
      "Crimson Desert is already live after years of glossy showcase footage. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. Now the shipped build has to carry the spectacle: combat, performance and scale, not just trailer shots. Crimson Desert is out in the wild after years of huge trailers. GameSpot reports Crimson Desert is out now after Pearl Abyss confirmed the launch timing. Pearl Abyss now has to make the shipped build feel as sharp as the trailers looked. Performance is the danger point: big battles and wide areas have to survive real hardware. That turns the story from showcase hype into a real player verdict. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Crimson Desert is already live after years of glossy showcase footage. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. Now the shipped build has to carry the spectacle: combat, performance and scale, not just trailer shots. Crimson Desert is out in the wild after years of huge trailers. GameSpot reports Crimson Desert is out now after Pearl Abyss confirmed the launch timing. Pearl Abyss now has to make the shipped build feel as sharp as the trailers looked. Performance is the danger point: big battles and wide areas have to survive real hardware. That turns the story from showcase hype into a real player verdict. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Crimson Desert is already live after years of glossy showcase footage. GameSpot reports Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing. Now the shipped build has to carry the spectacle: combat, performance and scale, not just trailer shots. Crimson Desert is out in the wild after years of huge trailers. GameSpot reports Crimson Desert is out now after Pearl Abyss confirmed the launch timing. Pearl Abyss now has to make the shipped build feel as sharp as the trailers looked. Performance is the danger point: big battles and wide areas have to survive real hardware. That turns the story from showcase hype into a real player verdict. Follow Pulse Gaming so you never miss a beat.",
    description: "Crimson Desert launched on March 19, 2026. Source: GameSpot.",
    pinned_comment: "Source: GameSpot.",
    primary_source: "GameSpot",
    confirmed_claims: [
      "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing.",
    ],
    allowed_public_wording: [
      "Crimson Desert Is Already Live",
      "Crimson Desert is already live after years of glossy showcase footage.",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "crimson-asr-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-26T18:45:00.000Z",
    audioWorkbench: {
      jobs: [
        {
          story_id: "crimson-asr-story",
          asr_failure: {
            status: "exhausted_requires_narration_regeneration",
            reason: "script_coverage_below_threshold",
          },
        },
      ],
    },
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "changed_asr_exhausted_rewrite");
  assert.equal(updated.public_copy_repair_strategy, "deterministic_source_safe_rewrite");
  assert.match(updated.narration_script, /Crimson Desert/);
  assert.doesNotMatch(updated.narration_script, /out in the wild after years of huge trailers/i);
  assert.equal(
    (updated.narration_script.match(/GameSpot reports/g) || []).length,
    1,
  );
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy repair rewrites ASR-inserted narration before another local TTS pass", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-asr-inserted-"));
  const artifactDir = path.join(root, "mega-mewtwo-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "mega-mewtwo-story",
    canonical_subject: "Pokémon Go",
    canonical_game: "Pokémon Go",
    canonical_title: "Mega Mewtwo's Pokémon Go debut finally announced and Go Fest Global is free for all players",
    selected_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    short_title: "Mega Mewtwo Is Finally Coming To Pokémon Go",
    thumbnail_headline: "POKÉMON GO MEGA MEWTWO",
    thumbnail_text: "POKÉMON GO MEGA MEWTWO",
    first_spoken_line: "Mega Mewtwo is finally coming to Pokémon Go.",
    narration_script:
      "Mega Mewtwo is finally coming to Pokémon Go. Eurogamer reports Mega Mewtwo's Pokémon Go debut finally announced and Go Fest Global is free for all players. The free Go Fest detail matters because this is one of Pokémon Go's biggest locked-away debuts. Mega Mewtwo finally has a Pokémon Go path instead of another tease. That matters because Mega Mewtwo has been one of Pokémon Go's longest-running absences. Making Go Fest Global free gives casual players a reason to open the app even if they were not buying a ticket. Niantic now has to make the weekend feel worth returning for, not just worth checking once. The player detail is timing, raid access and whether free players actually get a fair shot. The next official post needs the exact raid window, access rules and regional timing. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Mega Mewtwo's Pokémon Go debut was announced and Go Fest Global is free for all players. Source: Eurogamer.",
    pinned_comment: "Source: Eurogamer.",
    primary_source: "Eurogamer",
    confirmed_claims: [
      "Mega Mewtwo's Pokémon Go debut finally announced and Go Fest Global is free for all players.",
    ],
    allowed_public_wording: [
      "Mega Mewtwo Is Finally Coming To Pokémon Go",
      "Mega Mewtwo is finally coming to Pokémon Go.",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "mega-mewtwo-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-27T14:05:00.000Z",
    audioWorkbench: {
      jobs: [
        {
          story_id: "mega-mewtwo-story",
          audio: { usable: false, reason: "asr_inserted_words_regenerate_narration" },
          timestamps: {
            usable: false,
            reason: "asr_inserted_words_above_threshold",
            requires_audio_regeneration: true,
          },
        },
      ],
    },
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "changed_asr_exhausted_rewrite");
  assert.equal(updated.public_copy_repair_strategy, "deterministic_source_safe_rewrite");
  assert.match(updated.narration_script, /Mega Mewtwo/);
  assert.doesNotMatch(updated.narration_script, /not just worth checking once|raid window, access rules/i);
  assert.ok(updated.narration_script.split(/\s+/).length < 70);
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy repair rewrites editor-instruction narration before render", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-instruction-transcript-"));
  const artifactDir = path.join(root, "switch-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "switch-instruction-transcript",
    canonical_subject: "Nintendo Switch 2",
    canonical_game: "Nintendo Switch 2",
    canonical_title: "This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17",
    selected_title: "Nintendo Switch 2 Just Got More Expensive",
    short_title: "Nintendo Switch 2 Just Got More Expensive",
    thumbnail_headline: "SWITCH 2 PRICE JUMP",
    first_spoken_line: "Nintendo Switch 2 just got more expensive for players.",
    narration_script:
      "Nintendo Switch 2 just got more expensive for players. IGN reports This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17. The real test is whether Nintendo Switch 2 changes play, not whether the patch note sounds bigger. A useful update should fix a real friction point, not just add a louder headline. If the next patch moves the detail again, update the story before treating it as settled.",
    full_script:
      "Nintendo Switch 2 just got more expensive for players. IGN reports This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17. The real test is whether Nintendo Switch 2 changes play, not whether the patch note sounds bigger. A useful update should fix a real friction point, not just add a louder headline. If the next patch moves the detail again, update the story before treating it as settled.",
    tts_script:
      "Nintendo Switch 2 just got more expensive for players. IGN reports This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17. The real test is whether Nintendo Switch 2 changes play, not whether the patch note sounds bigger. A useful update should fix a real friction point, not just add a louder headline. If the next patch moves the detail again, update the story before treating it as settled.",
    description: "Nintendo Switch 2 has a new accessory deal. Source: IGN.",
    primary_source: "IGN",
    source_card_label: "IGN",
    confirmed_claims: [
      "This Iniu 20,000 Power Bank Quadruples Your Nintendo Switch 2 Play Time For $17",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "switch-instruction-transcript", artifact_dir: artifactDir }],
    generatedAt: "2026-05-24T13:00:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.full_script, updated.narration_script);
  assert.equal(updated.tts_script, updated.narration_script);
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
  assert.doesNotMatch(
    updated.narration_script,
    /practical question|real test|useful update|patch note sounds|update the story before treating it as settled/i,
  );
});

test("public copy repair treats broad Warhammer thumbnails as unanchored when the subject is missing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-warhammer-thumbnail-"));
  const artifactDir = path.join(root, "warhammer-story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "warhammer-story",
    canonical_subject: "Warhammer 40 000",
    canonical_game: "Warhammer 40 000",
    canonical_title: "Warhammer 40,000: Chaos Gate - Deathwatch announced at Warhammer Skulls",
    selected_title: "Warhammer 40 000 Just Got More Expensive",
    short_title: "Warhammer 40 000 Just Got More Expensive",
    thumbnail_headline: "PRICES WENT UP",
    thumbnail_text: "PRICES WENT UP",
    first_spoken_line: "Warhammer 40 000 just turned the Warhammer showcase into a player watchlist story.",
    narration_script:
      "Warhammer 40 000 just turned the Warhammer showcase into a player watchlist story. IGN reports the reveal came from Warhammer Skulls.",
    description: "Warhammer 40,000: Chaos Gate - Deathwatch was announced at Warhammer Skulls. Source: IGN.",
    primary_source: "IGN",
    confirmed_claims: ["Warhammer 40,000: Chaos Gate - Deathwatch was announced at Warhammer Skulls"],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "warhammer-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T17:18:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.thumbnail_headline, "WARHAMMER 40 000 PRICE JUMP");
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy repair stops generating production-note narration lines", () => {
  const cases = [
    {
      story_id: "expanse-production-note",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      canonical_title: "The Expanse Shows Real Gameplay",
      selected_title: "The Expanse Shows Real Gameplay",
      primary_source: "Xbox",
      description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
      confirmed_claims: [
        "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview",
      ],
    },
    {
      story_id: "warhammer-production-note",
      canonical_subject: "Warhammer 40,000: Dawn of War 4",
      canonical_game: "Warhammer 40,000: Dawn of War 4",
      canonical_title: "Dawn of War 4 Gameplay Appeared At Warhammer Skulls",
      selected_title: "Dawn of War 4 Shows Real Gameplay",
      primary_source: "GameSpot",
      description: "GameSpot reports Dawn of War 4 showed gameplay during Warhammer Skulls. Source: GameSpot.",
      confirmed_claims: [
        "Dawn of War 4 showed gameplay during Warhammer Skulls",
      ],
    },
    {
      story_id: "deal-production-note",
      canonical_subject: "GameSir G7 Pro",
      canonical_game: "GameSir G7 Pro",
      canonical_title: "GameSir G7 Pro Deal Has One Catch",
      selected_title: "GameSir G7 Pro Deal Has One Catch",
      primary_source: "IGN",
      description: "IGN reports a GameSir G7 Pro deal is available through AliExpress. Source: IGN.",
      confirmed_claims: [
        "A GameSir G7 Pro deal is available through AliExpress",
      ],
    },
    {
      story_id: "xbox-feedback-production-note",
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      canonical_title:
        "Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives",
      selected_title: "Xbox Fans Used Feedback To Demand Exclusives",
      primary_source: "IGN",
      description:
        "IGN reports Microsoft launched Xbox Player Voice to gather feedback and fans immediately demanded exclusives. Source: IGN.",
      confirmed_claims: [
        "Microsoft launched Xbox Player Voice to gather feedback and fans immediately demanded exclusives",
      ],
    },
    {
      story_id: "nintendo-lawsuit-production-note",
      canonical_subject: "Nintendo",
      canonical_game: "Nintendo",
      canonical_title:
        "An Iowa man filed a lawsuit against Nintendo of America and The Pokemon Company International after being denied Pokemon Professor status",
      selected_title: "Nintendo Professor Lawsuit Just Got Weird",
      primary_source: "Dexerto",
      description:
        "Dexerto reports an Iowa man sued Nintendo of America and The Pokemon Company International after being denied Pokemon Professor status. Source: Dexerto.",
      confirmed_claims: [
        "An Iowa man sued Nintendo of America and The Pokemon Company International after being denied Pokemon Professor status",
      ],
    },
    {
      story_id: "kadokawa-stake-production-note",
      canonical_subject: "Kadokawa",
      canonical_game: "Kadokawa",
      canonical_title: "Oasis Management raised its Kadokawa stake above Sony's stake",
      selected_title: "Kadokawa Stake Just Passed Sony",
      primary_source: "Automaton West",
      description:
        "Automaton West reports Oasis Management raised its Kadokawa stake above Sony's stake. Source: Automaton West.",
      confirmed_claims: [
        "Oasis Management raised its Kadokawa stake above Sony's stake",
      ],
    },
  ];

  for (const manifest of cases) {
    const repaired = repairGoalPublicCopyManifest(manifest, {
      generatedAt: "2026-05-24T13:30:00.000Z",
    });
    const qa = evaluateGoalPublicCopy(repaired.manifest);

    assert.equal(qa.verdict, "pass", `${manifest.story_id}: ${qa.failures.join(", ")}`);
    assert.doesNotMatch(
      repaired.manifest.narration_script,
      /the news is simple|title-card promise|player watchlist story|first gameplay cut|another logo reveal|changes the version people were actually|clearer public hook|bit players will argue over|one concrete change worth remembering|clean shape:\s*what changed|source visible and no extra lore/i,
      manifest.story_id,
    );
  }
});

test("public copy repair leaves duration-repaired clean packages unchanged", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-duration-clean-"));
  const artifactDir = path.join(root, "duration-clean-story");
  await fs.ensureDir(artifactDir);
  const manifest = {
    story_id: "duration-clean-story",
    canonical_subject: "Star Fox",
    canonical_game: "Star Fox",
    canonical_title: "Star Fox just got a Switch 2 route",
    selected_title: "Star Fox Just Got A Switch 2 Route",
    short_title: "Star Fox Just Got A Switch 2 Route",
    title_candidates: ["Star Fox Just Got A Switch 2 Route"],
    thumbnail_headline: "STAR FOX SWITCH 2 ROUTE",
    thumbnail_text: "STAR FOX SWITCH 2 ROUTE",
    first_spoken_line: "Star Fox just got a Switch 2 route for players who missed the original window.",
    narration_hook: "Star Fox just got a Switch 2 route for players who missed the original window.",
    narration_script:
      "Star Fox just got a Switch 2 route for players who missed the original window. Nintendo Life reports the new route is tied to Switch Online and the Switch 2 upgrade path. That matters because older Nintendo games keep turning into subscription decisions, not just nostalgia. Check the source and the platform details before you decide what to play next. Follow Pulse Gaming so you never miss a beat.",
    description: "Star Fox has a Switch 2 route through Nintendo's platform plans. Source: Nintendo Life.",
    pinned_comment: "Source: Nintendo Life.",
    primary_source: "Nintendo Life",
    confirmed_claims: ["Star Fox has a Switch 2 route through Nintendo's platform plans"],
    allowed_public_wording: [
      "Star Fox Just Got A Switch 2 Route",
      "Star Fox just got a Switch 2 route for players who missed the original window.",
    ],
    duration_variant_repaired_at: "2026-05-22T13:30:00.000Z",
  };
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), manifest);

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "duration-clean-story", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T14:05:00.000Z",
  });
  const after = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.unchanged_count, 1);
  assert.equal(after.narration_script, manifest.narration_script);
  assert.equal(after.duration_variant_repaired_at, "2026-05-22T13:30:00.000Z");
});

test("public copy repair syncs stale platform packs without shortening clean duration-extended scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-sync-only-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  const script = [
    "Star Fox has a Switch 2 camera deal.",
    "IGN reports the Nintendo Switch 2 Camera is discounted for Memorial Day.",
    "The useful part is the timing: Nintendo is testing Switch 2 accessory demand around a discount window.",
    "Star Fox is the hook, but the story is really about how quickly Switch 2 extras need a reason to exist.",
  ].join(" ");
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "starfox",
    canonical_subject: "Star Fox",
    canonical_game: "Star Fox",
    selected_title: "Star Fox Just Got A Switch 2 Route",
    thumbnail_headline: "STAR FOX SWITCH 2",
    first_spoken_line: "Star Fox has a Switch 2 camera deal.",
    narration_script: script,
    primary_source: "IGN",
    description: "The Nintendo Switch 2 Camera is discounted for Memorial Day. Source: IGN.",
    confirmed_claims: ["Nintendo Switch 2 Camera is discounted for Memorial Day"],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Star Fox Just Got A Switch 2 Route",
        description: "Star Fox: source_locked_update. Source: IGN.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "starfox", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T14:05:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "platform_pack_synced");
  assert.equal(updated.narration_script, script);
  assert.equal(platform.public_copy_synced_at, "2026-05-22T14:05:00.000Z");
  assert.doesNotMatch(platform.outputs.youtube_shorts.description, /source_locked_update/i);
});

test("public copy repair resyncs stale X and Threads source labels when canonical copy is clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-platform-social-source-sync-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "forza-social-sync",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    selected_title: "Forza Horizon 6 Reviews Are In",
    short_title: "Forza Horizon 6 Reviews Are In",
    thumbnail_headline: "FORZA HORIZON 6 REVIEWS",
    first_spoken_line: "Forza Horizon 6 reviews are finally in.",
    narration_script:
      "Forza Horizon 6 reviews are finally in. PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. Strong reviews matter here because this is when fence-sitters decide whether another Horizon is enough. Follow Pulse Gaming so you never miss a beat.",
    description:
      "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. Source: PC Gamer.",
    primary_source: "PC Gamer",
    source_card_label: "PC Gamer",
    confirmed_claims: [
      "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
    ],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      x: {
        hot_take_post: "Forza Horizon 6 is the part of this story everyone will argue about: racing_game_setup.",
        source_safe_post: "Forza Horizon 6 Reviews Are In\n\nSource: Reddit. Full source list: /p/forza",
        concise_news_post: "Forza Horizon 6: racing_game_setup.",
        thread_posts: ["Forza Horizon 6 Reviews Are In", "Source: Reddit. The confirmed angle is racing_game_setup."],
        landing_page_link: "/p/forza",
      },
      threads: {
        discussion_post: "Forza Horizon 6 is worth watching for the player impact, not just the headline. Source: Reddit.",
      },
      pinterest: {
        pin_title: "Forza Horizon 6 story guide",
        pin_description: "Forza Horizon 6: racing_game_setup.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "forza-social-sync", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T20:28:00.000Z",
  });
  const platform = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "platform_pack_synced");
  assert.doesNotMatch(JSON.stringify(platform.outputs), /Source: Reddit|racing_game_setup/i);
  assert.match(platform.outputs.x.source_safe_post, /Source: PC Gamer/i);
  assert.match(platform.outputs.threads.discussion_post, /PC Gamer/);
});

test("public copy repair syncs standalone publish packs when the aggregate manifest is clean", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-standalone-pack-sync-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "v-rising-standalone-sync",
    canonical_subject: "V Rising",
    canonical_game: "V Rising",
    selected_title: "V Rising Devs Are Making Another Vampire Game",
    short_title: "V Rising Devs Are Making Another Vampire Game",
    thumbnail_headline: "V RISING VAMPIRE GAME",
    first_spoken_line: "V Rising's developers are already building another vampire game.",
    narration_script:
      "V Rising's developers are already building another vampire game. Stunlock Studios says it is working on a new game set in the world of V Rising. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Stunlock Studios says it is working on a new game set in the world of V Rising. Source: Stunlock Studios.",
    primary_source: "Stunlock Studios",
    source_card_label: "Stunlock Studios",
    confirmed_claims: [
      "Stunlock Studios says it is working on a new game set in the world of V Rising.",
    ],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "V Rising Devs Are Making Another Vampire Game",
        description:
          "Stunlock Studios says it is working on a new game set in the world of V Rising. Source: Stunlock Studios. Sources and related links: /p/v-rising-devs-are-making-another-vampire-game",
        cover_frame: {
          headline: "V RISING VAMPIRE GAME",
          source_label: "Stunlock Studios",
        },
      },
      x: {
        source_safe_post:
          "V Rising Devs Are Making Another Vampire Game\n\nSource: Stunlock Studios. Full source list: /p/v-rising-devs-are-making-another-vampire-game",
        landing_page_link: "/p/v-rising-devs-are-making-another-vampire-game",
      },
    },
  });
  await fs.writeJson(path.join(artifactDir, "youtube_publish_pack.json"), {
    title: "V Rising Devs Are Making Another Vampire Game",
    description:
      "V Rising: Confirmed Drop. Source: Reddit. Sources and related links: /p/v-rising-devs-are-making-another-vampire-game",
    cover_frame: {
      headline: "V RISING VAMPIRE GAME",
      source_label: "Reddit",
    },
  });
  await fs.writeJson(path.join(artifactDir, "x_publish_pack.json"), {
    source_safe_post:
      "V Rising Devs Are Making Another Vampire Game\n\nSource: Reddit. Full source list: /p/v-rising-devs-are-making-another-vampire-game",
    thread_posts: [
      "V Rising Devs Are Making Another Vampire Game",
      "Source: Reddit. The confirmed angle is Confirmed Drop.",
    ],
    landing_page_link: "/p/v-rising-devs-are-making-another-vampire-game",
  });
  await fs.writeJson(path.join(artifactDir, "platform_variant_scorecard.json"), {
    outputs: {
      youtube_shorts: {
        title: "V Rising Devs Are Making Another Vampire Game",
        description:
          "V Rising: Confirmed Drop. Source: Reddit. Sources and related links: /p/v-rising-devs-are-making-another-vampire-game",
        cover_frame: {
          headline: "V RISING VAMPIRE GAME",
          source_label: "Reddit",
        },
      },
      threads: {
        discussion_post: "V Rising is worth watching for the player impact, not just the headline. Source: Reddit.",
        landing_page_link: "/p/v-rising-devs-are-making-another-vampire-game",
      },
    },
    platform_native_evidence: {
      verdict: "pass",
      platforms: [
        {
          platform: "youtube_shorts",
          status: "pass",
          copy_fingerprint: "v rising confirmed drop source reddit",
        },
        {
          platform: "threads",
          status: "pass",
          copy_fingerprint: "v rising source reddit",
        },
      ],
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "v-rising-standalone-sync", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T22:10:00.000Z",
  });

  const youtube = await fs.readJson(path.join(artifactDir, "youtube_publish_pack.json"));
  const x = await fs.readJson(path.join(artifactDir, "x_publish_pack.json"));
  const variant = await fs.readJson(path.join(artifactDir, "platform_variant_scorecard.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "platform_pack_synced");
  assert.match(youtube.description, /Source: Stunlock Studios/i);
  assert.equal(youtube.cover_frame.source_label, "Stunlock Studios");
  assert.doesNotMatch(x.source_safe_post, /Source: Reddit|Confirmed Drop/i);
  assert.match(x.source_safe_post, /Source: Stunlock Studios/i);
  assert.match(variant.outputs.youtube_shorts.description, /Source: Stunlock Studios/i);
  assert.match(variant.outputs.threads.discussion_post, /Stunlock Studios/i);
  assert.doesNotMatch(JSON.stringify(variant.platform_native_evidence || {}), /source reddit/i);
});

test("public copy repair keeps pending audio jobs when a stale platform sync follows a canonical rewrite", async () => {
  const report = {
    generated_at: "2026-05-23T20:33:00.000Z",
    changed: [
      {
        story_id: "forza-pending-platform-sync",
        title: "Forza Horizon 6 Reviews Are In",
        artifact_dir: path.join(os.tmpdir(), "forza-pending-platform-sync"),
        status: "platform_pack_synced_pending_public_copy_regeneration",
        public_copy_regeneration_pending: true,
      },
    ],
  };
  await fs.ensureDir(path.join(os.tmpdir(), "forza-pending-platform-sync"));
  await fs.outputJson(path.join(os.tmpdir(), "forza-pending-platform-sync", "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4"],
  });

  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);

  assert.deepEqual(workbench.jobs.map((job) => job.story_id), ["forza-pending-platform-sync"]);
  assert.deepEqual(renderWorkOrder.jobs.map((job) => job.story_id), ["forza-pending-platform-sync"]);
});

test("public copy rerender work order blocks repaired copy without local V4 clips", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-rerender-no-clips-"));
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: [],
  });
  const report = {
    generated_at: "2026-05-23T22:58:00.000Z",
    changed: [
      {
        story_id: "copy-no-clips",
        title: "Copy Repair Needs Motion",
        artifact_dir: artifactDir,
        status: "platform_pack_synced_pending_public_copy_regeneration",
        public_copy_regeneration_pending: true,
      },
    ],
  };

  const workOrder = await buildProductionRerenderWorkOrder(report);

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 0);
  assert.equal(workOrder.summary.blocked_on_render_inputs_count, 1);
  assert.equal(workOrder.jobs[0].status, "blocked_on_render_inputs");
  assert.deepEqual(workOrder.jobs[0].blockers, ["materialised_motion_clip_paths_missing"]);
});

test("public copy repair fixes Warhammer description subjects without shortening duration-extended scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-description-subject-only-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  const script = [
    "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap.",
    "IGN reports Dawn of War 4 has a Year 1 roadmap and new playable factions.",
    "The real test is whether that roadmap gives returning strategy players enough confidence.",
    "That matters because Warhammer strategy games live or die on factions, post-launch support and whether the first month feels alive.",
  ].join(" ");
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "dawn-description-only",
    canonical_subject: "Warhammer 40,000: Dawn of War 4",
    canonical_game: "Warhammer 40,000: Dawn of War 4",
    selected_title: "Dawn Of War 4 Already Has A Roadmap",
    thumbnail_headline: "DAWN OF WAR 4 ROADMAP",
    first_spoken_line: "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap.",
    narration_script: script,
    description: "Dawn of War 4 has a Year 1 roadmap and new playable factions. Source: IGN.",
    primary_source: "IGN",
    confirmed_claims: ["Dawn of War 4 has a Year 1 roadmap and new playable factions"],
    duration_variant_repaired_at: "2026-05-23T00:38:00.000Z",
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Dawn Of War 4 Already Has A Roadmap",
        description: "Dawn of War 4 has a Year 1 roadmap and new playable factions. Source: IGN.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "dawn-description-only", artifact_dir: artifactDir }],
    generatedAt: "2026-05-23T01:01:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const workOrder = await buildProductionRerenderWorkOrder(report);

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "description_subject_synced");
  assert.equal(updated.narration_script, script);
  assert.match(updated.description, /Warhammer 40,000: Dawn of War 4/);
  assert.equal(workbench.jobs.length, 0);
  assert.equal(workOrder.jobs.length, 0);
});

test("public copy repair gives duplicate package titles distinct subject-safe variants", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-duplicates-"));
  const firstDir = path.join(root, "first");
  const secondDir = path.join(root, "second");
  await fs.ensureDir(firstDir);
  await fs.ensureDir(secondDir);
  const baseManifest = {
    canonical_subject: "Helldivers 2",
    canonical_game: "Helldivers 2",
    canonical_title: "Helldivers 2 Is Getting a Warhammer 40,000 Legendary Warbond",
    selected_title: "Helldivers 2 Is Getting Warhammer Gear",
    title_candidates: [
      "Helldivers 2 Is Getting Warhammer Gear",
      "Helldivers 2 Won't Get Space Marines",
      "Helldivers 2 Just Got A Crossover Push",
    ],
    first_spoken_line: "Helldivers 2 is getting Warhammer gear.",
    narration_script: "Helldivers 2 is getting Warhammer gear.",
    description: "Helldivers 2 is getting a Warhammer 40,000 Legendary Warbond. Source: GameSpot.",
    primary_source: "GameSpot",
    confirmed_claims: ["Helldivers 2 is getting a Warhammer 40,000 Legendary Warbond"],
  };
  await fs.outputJson(path.join(firstDir, "canonical_story_manifest.json"), {
    ...baseManifest,
    story_id: "first",
  });
  await fs.outputJson(path.join(secondDir, "canonical_story_manifest.json"), {
    ...baseManifest,
    story_id: "second",
    canonical_title:
      "Helldivers 2's Next Legendary Warbond Is Warhammer 40K, But Don't Expect Space Marines",
    confirmed_claims: [
      "Helldivers 2's Next Legendary Warbond Is Warhammer 40K, But Don't Expect Space Marines",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [
      { story_id: "first", artifact_dir: firstDir },
      { story_id: "second", artifact_dir: secondDir },
    ],
    generatedAt: "2026-05-22T12:05:00.000Z",
  });
  const first = await fs.readJson(path.join(firstDir, "canonical_story_manifest.json"));
  const second = await fs.readJson(path.join(secondDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.blocked_count, 0);
  assert.notEqual(first.selected_title, second.selected_title);
  assert.equal(second.selected_title, "Helldivers 2 Won't Get Space Marines");
  assert.match(second.first_spoken_line, /Helldivers 2/);
  assert.equal(evaluateGoalPublicCopy(second).verdict, "pass");
});

test("public copy repair can reserve an already-used title during targeted duplicate repair", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-reserved-title-"));
  const artifactDir = path.join(root, "duplicate");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "forza-review-thread",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_title: "'Forza Horizon 6' - Review Thread",
    selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
    title_candidates: [
      "Forza Horizon 6 Scores 84 On PC Gamer",
      "Forza Horizon 6 Reviews Are In",
      "Forza Horizon 6 Reviews Just Sent A Signal",
    ],
    thumbnail_headline: "FORZA HORIZON 6 SCORES 84",
    first_spoken_line: "The Forza Horizon 6 review wave has a catch: it cannot prove launch demand yet.",
    narration_script:
      "The Forza Horizon 6 review wave has a catch: it cannot prove launch demand yet. PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
    description:
      "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in. Source: PC Gamer.",
    primary_source: "PC Gamer",
    confirmed_claims: [
      "PC Gamer published its Forza Horizon 6 review, with GameSpot and VGC also weighing in.",
    ],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "forza-review-thread", artifact_dir: artifactDir }],
    reservedTitles: ["Forza Horizon 6 Scores 84 On PC Gamer"],
    generatedAt: "2026-05-28T13:35:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.selected_title, "Forza Horizon 6 Reviews Are In");
  assert.notEqual(updated.selected_title, "Forza Horizon 6 Scores 84 On PC Gamer");
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy repair turns malformed Paranormal Activity quote copy into a factual description", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "paranormal",
      canonical_subject: "Paranormal Activity: Threshold",
      canonical_title:
        '"Honestly difficult to imagine a path forward with it" - licensed Paranormal Activity horror game "technically done for good", says Mortuary Assistant creator',
      selected_title: "Paranormal Activity Game Is Done",
      primary_source: "Eurogamer",
      description:
        '"Honestly difficult to imagine a path forward with it" - licensed Paranormal Activity horror game "technically done for good", says Mortuary Assistant creator. Source: Eurogamer.',
      confirmed_claims: [
        '"Honestly difficult to imagine a path forward with it" - licensed Paranormal Activity horror game "technically done for good", says Mortuary Assistant creator',
      ],
    },
    { generatedAt: "2026-05-22T12:08:00.000Z" },
  );

  assert.equal(repaired.manifest.description, "The licensed Paranormal Activity game is technically done for good. Source: Eurogamer.");
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair keeps Deathmaster alternate first lines anchored to Warhammer", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "deathmaster",
      canonical_subject: "Warhammer Age Of Sigmar: Deathmaster",
      canonical_game: "Warhammer Age Of Sigmar: Deathmaster",
      canonical_title: "Warhammer Age Of Sigmar: Deathmaster Brings Sneaky Assassinations To PC And Consoles Next Year",
      selected_title: "Deathmaster Makes Warhammer A Stealth Game",
      title_candidates: [
        "Deathmaster Makes Warhammer A Stealth Game",
        "Deathmaster Brings Stealth To Consoles",
      ],
      primary_source: "GameSpot",
      description:
        "Warhammer Age Of Sigmar: Deathmaster Brings Sneaky Assassinations To PC And Consoles Next Year. Source: GameSpot.",
      confirmed_claims: [
        "Warhammer Age Of Sigmar: Deathmaster Brings Sneaky Assassinations To PC And Consoles Next Year",
      ],
    },
    {
      generatedAt: "2026-05-22T12:12:00.000Z",
      usedTitles: new Set(["deathmaster makes warhammer a stealth game"]),
    },
  );

  assert.equal(repaired.manifest.selected_title, "Deathmaster Brings Stealth To Consoles");
  assert.match(repaired.manifest.first_spoken_line, /^Warhammer Age Of Sigmar: Deathmaster/);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair paraphrases advertiser-risk Xbox strategy copy", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "xbox_strategy",
      canonical_subject: "Xbox",
      canonical_game: "Xbox",
      canonical_title:
        "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer in another leadership revamp",
      selected_title: "Xbox Just Got More Expensive",
      primary_source: "Eurogamer",
      description:
        "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer in another leadership revamp. Source: Eurogamer.",
      confirmed_claims: [
        "Xbox hires analyst who said games were losing the attention battle with gambling, crypto and porn as chief strategy officer in another leadership revamp",
      ],
    },
    { generatedAt: "2026-05-22T12:35:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Xbox Just Made A Strategy Hire");
  assert.equal(
    repaired.manifest.description,
    "Xbox hired an analyst as chief strategy officer after another leadership revamp. Source: Eurogamer.",
  );
  assert.doesNotMatch(repaired.manifest.narration_script, /gambling|crypto|porn/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair infers a named subject instead of publishing This story fallback copy", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "kadokawa_oasis",
      canonical_subject: "This story",
      canonical_game: "This story",
      canonical_title:
        "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's",
      selected_title: "This story Has One Player Question",
      first_spoken_line: "This story Has One Player Question.",
      primary_source: "VGC",
      description:
        "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's. Source: VGC.",
      confirmed_claims: [
        "Kadokawa's activist shareholder Oasis Management raises stake to 11.85%, exceeding Sony's",
      ],
    },
    { generatedAt: "2026-05-22T12:40:00.000Z" },
  );

  assert.equal(repaired.manifest.canonical_subject, "Kadokawa");
  assert.equal(repaired.manifest.selected_title, "Kadokawa Stake Just Passed Sony");
  assert.match(repaired.manifest.first_spoken_line, /^Kadokawa/);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair keeps unresolvable fallback titles blocked by QA", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "thin_reddit_clip",
      canonical_subject: "Capturing",
      canonical_game: "Capturing",
      canonical_title: "Capturing mewtwo in the office shh (pokemon red version) game boy color og",
      selected_title: "Capturing Has One Player Question",
      first_spoken_line: "",
      primary_source: "I",
      description: "Capturing mewtwo in the office shh (pokemon red version) game boy color og. Source: I.",
      confirmed_claims: ["Capturing mewtwo in the office shh (pokemon red version) game boy color og"],
    },
    { generatedAt: "2026-05-22T12:42:00.000Z" },
  );

  const qa = evaluateGoalPublicCopy(repaired.manifest);
  assert.equal(qa.verdict, "fail");
  assert.ok(qa.failures.includes("public_copy:weak_title_pattern"));
});

test("public copy repair rewrites Subnautica leak copy without peaceful-rule drift", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "subnautica-leak",
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      canonical_title: "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch",
      selected_title: "Subnautica 2 Is Keeping Its Peaceful Rule",
      first_spoken_line: "Subnautica 2 is keeping one of its strangest survival rules.",
      primary_source: "Respawnfirst",
      description:
        "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch. Source: Respawnfirst.",
      confirmed_claims: [
        "After Forza Horizon 6, Now Subnautica 2 Has Reportedly Leaked 48 Hours Ahead of Launch",
      ],
    },
    { generatedAt: "2026-05-24T17:10:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Subnautica 2 Reportedly Leaked Early");
  assert.equal(repaired.manifest.first_spoken_line, "Subnautica 2 reportedly leaked before launch.");
  assert.doesNotMatch(repaired.manifest.narration_script, /peaceful|strangest survival rule|kill-list|monster-hunting/i);
  assert.doesNotMatch(repaired.manifest.narration_script, /named change|source behind it|lawsuit, the rejection/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair turns common review and platform stories into named creator titles", () => {
  const forzaReview = repairGoalPublicCopyManifest(
    {
      story_id: "forza_review",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 review (PC Gamer: 84/100)",
      selected_title: "Forza Horizon 6 Has One Player Question",
      primary_source: "PC Gamer",
      description: "Forza Horizon 6 review (PC Gamer: 84/100). Source: PC Gamer.",
      confirmed_claims: ["Forza Horizon 6 review (PC Gamer: 84/100)"],
    },
    { generatedAt: "2026-05-22T12:43:00.000Z" },
  );
  const ps5Price = repairGoalPublicCopyManifest(
    {
      story_id: "ps5_price",
      canonical_subject: "Rumor",
      canonical_game: "Rumor",
      canonical_title: "Rumor: Another PS5 price hike coming to at least Europe shortly",
      selected_title: "Rumor Just Got More Expensive",
      primary_source: "Reddit",
      description: "Rumor: Another PS5 price hike coming to at least Europe shortly. Source: Reddit.",
      confirmed_claims: ["Rumor: Another PS5 price hike coming to at least Europe shortly"],
    },
    { generatedAt: "2026-05-22T12:44:00.000Z" },
  );

  assert.equal(forzaReview.manifest.selected_title, "Forza Horizon 6 Scores 84 On PC Gamer");
  assert.equal(evaluateGoalPublicCopy(forzaReview.manifest).verdict, "pass");
  assert.equal(ps5Price.manifest.canonical_subject, "PS5");
  assert.equal(ps5Price.manifest.selected_title, "PS5 Price Hike Rumour Hits Europe");
  assert.equal(evaluateGoalPublicCopy(ps5Price.manifest).verdict, "pass");
});

test("public copy repair fixes review-thread and Xbox feedback fallbacks", () => {
  const reviewThread = repairGoalPublicCopyManifest(
    {
      story_id: "forza_review_thread",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "'Forza Horizon 6' - Review Thread",
      selected_title: "Forza Horizon 6 Reviews Just Sent A Signal",
      primary_source: "Reddit",
      description: "'Forza Horizon 6' - Review Thread Source: Reddit.",
      confirmed_claims: ["'Forza Horizon 6' - Review Thread"],
    },
    { generatedAt: "2026-05-22T12:46:00.000Z" },
  );
  const xboxFeedback = repairGoalPublicCopyManifest(
    {
      story_id: "xbox_player_voice",
      canonical_subject: "Forza",
      canonical_game: "Forza",
      canonical_title: "Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives",
      selected_title: "Forza Has One Player Question",
      primary_source: "IGN",
      description: "Forza: Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives. Source: IGN.",
      confirmed_claims: ["Microsoft Launches Xbox Player Voice to Gather Feedback, Fans Immediately Demand Exclusives"],
    },
    { generatedAt: "2026-05-22T12:47:00.000Z" },
  );

  assert.equal(reviewThread.manifest.selected_title, "Forza Horizon 6 Reviews Are In");
  assert.equal(evaluateGoalPublicCopy(reviewThread.manifest).verdict, "pass");
  assert.equal(xboxFeedback.manifest.canonical_subject, "Xbox");
  assert.equal(xboxFeedback.manifest.selected_title, "Xbox Fans Used Feedback To Demand Exclusives");
  assert.equal(evaluateGoalPublicCopy(xboxFeedback.manifest).verdict, "pass");
});

test("public copy repair avoids repeated Warhammer 40,000 numeric claims", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "dawn_roadmap",
      canonical_subject: "Warhammer 40,000: Dawn of War 4",
      canonical_game: "Warhammer 40,000: Dawn of War 4",
      canonical_title:
        "The Big Warhammer 40,000: Dawn of War IV Interview: Year 1 Roadmap, New Playable Factions, and More",
      selected_title: "Dawn Of War 4 Already Has A Roadmap",
      first_spoken_line: "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap.",
      primary_source: "IGN",
      description:
        "The Big Warhammer 40,000: Dawn of War IV Interview: Year 1 Roadmap, New Playable Factions, and More. Source: IGN.",
      confirmed_claims: [
        "The Big Warhammer 40,000: Dawn of War IV Interview: Year 1 Roadmap, New Playable Factions, and More",
      ],
    },
    { generatedAt: "2026-05-22T12:45:00.000Z" },
  );

  const coherence = runScriptCoherenceQa(
    { title: repaired.manifest.selected_title, full_script: repaired.manifest.narration_script },
    { requireCtaField: false, requireFullScriptCta: false },
  );

  assert.equal(repaired.manifest.selected_title, "Dawn Of War 4 Already Has A Roadmap");
  assert.doesNotMatch(coherence.failures.join("\n"), /repeated_numeric_claim/);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair anchors Warhammer descriptions to the full canonical subject", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "dawn_description_subject",
      canonical_subject: "Warhammer 40,000: Dawn of War 4",
      canonical_game: "Warhammer 40,000: Dawn of War 4",
      canonical_title:
        "The Big Warhammer 40,000: Dawn of War IV Interview: Year 1 Roadmap, New Playable Factions, and More",
      selected_title: "Dawn Of War 4 Already Has A Roadmap",
      first_spoken_line: "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap.",
      primary_source: "IGN",
      description: "Dawn of War 4 has a Year 1 roadmap and new playable factions. Source: IGN.",
      confirmed_claims: [
        "Dawn of War 4 has a Year 1 roadmap and new playable factions.",
      ],
    },
    { generatedAt: "2026-05-22T12:48:00.000Z" },
  );

  assert.match(repaired.manifest.description, /Warhammer 40,000: Dawn of War 4/);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy package repair rewrites scripts that pass basic copy QA but fail coherence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-coherence-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "dawn_roadmap",
    canonical_subject: "Warhammer 40,000: Dawn of War 4",
    canonical_game: "Warhammer 40,000: Dawn of War 4",
    selected_title: "Dawn Of War 4 Already Has A Roadmap",
    first_spoken_line: "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap.",
    narration_script:
      "Warhammer 40,000: Dawn of War 4 already has a post-launch roadmap. IGN reports The Big Warhammer 40,000: Dawn of War IV Interview: Year 1 Roadmap, New Playable Factions, and More. Warhammer 40,000: Dawn of War 4 needs cleaner source-safe copy.",
    primary_source: "IGN",
    description: "Dawn of War 4 has a Year 1 roadmap. Source: IGN.",
    confirmed_claims: [
      "The Big Warhammer 40,000: Dawn of War IV Interview: Year 1 Roadmap, New Playable Factions, and More",
    ],
  });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: { youtube_shorts: { title: "Dawn Of War 4 Already Has A Roadmap" } },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "dawn_roadmap", artifact_dir: artifactDir }],
    generatedAt: "2026-05-22T12:50:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.ok(report.changed[0].before_failures.includes("script_coherence:repeated_numeric_claim:40,000"));
  assert.doesNotMatch(updated.narration_script, /Warhammer 40,000.*Warhammer 40,000.*Warhammer 40,000/i);
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");
});

test("public copy repair expands PlayStation Plus in descriptions", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "ps_plus_price",
      canonical_subject: "PlayStation Plus",
      canonical_game: "PlayStation Plus",
      canonical_title: "It's not just PS Plus Essential getting a price hike: Premium and Extra tiers are now more expensive too",
      selected_title: "PlayStation Plus Just Got More Expensive",
      primary_source: "Eurogamer",
      description: "It's not just PS Plus Essential getting a price hike: Premium and Extra tiers are now more expensive too. Source: Eurogamer.",
      confirmed_claims: [
        "It's not just PS Plus Essential getting a price hike: Premium and Extra tiers are now more expensive too",
      ],
    },
    { generatedAt: "2026-05-22T13:55:00.000Z" },
  );

  assert.equal(
    repaired.manifest.description,
    "PlayStation Plus Premium and Extra tiers are now more expensive too. Source: Eurogamer.",
  );
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair rewrites Forza Steam-ceiling filler into creator copy", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "1thsxw7",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      selected_title: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling",
      title_candidates: ["Forza Horizon 6 Just Broke Xbox's Steam Ceiling"],
      first_spoken_line: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling.",
      narration_script:
        "Forza Horizon 6 Just Broke Xbox's Steam Ceiling. GamesRadar reports Forza Horizon 6 Just Broke Xbox's Steam Ceiling The practical question is whether this changes what people buy, wishlist, reinstall or wait on. The headline gets attention, but the follow-through decides whether this becomes a real player problem. The confirmed bit is still the anchor: Forza Horizon 6 Just Broke Xbox's Steam Ceiling.",
      primary_source: "GamesRadar",
      primary_source_url: "https://www.gamesradar.com/games/racing/forza-horizon-6-is-already-a-massive-success/",
      description: "Forza Horizon 6 Just Broke Xbox's Steam Ceiling. Source: GamesRadar.",
      confirmed_claims: ["Forza Horizon 6 Just Broke Xbox's Steam Ceiling"],
    },
    { generatedAt: "2026-05-23T08:15:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Forza Horizon 6 Broke Xbox's Steam Ceiling");
  assert.doesNotMatch(repaired.manifest.narration_script, /practical question|confirmed bit|gives the story enough shape|headline gets attention/i);
  assert.match(repaired.manifest.narration_script, /Forza Horizon 6/i);
  assert.match(repaired.manifest.narration_script, /GamesRadar/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair rewrites Forza premium buyer-advice narration into a news story", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "1tf955x",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 Has Made Over $140 Million from Premium Edition",
      selected_title: "Forza Horizon 6 Just Got More Expensive",
      title_candidates: ["Forza Horizon 6 Has Made Over $140 Million from Premium Edition"],
      first_spoken_line: "Forza Horizon 6 just got more expensive for players.",
      narration_script:
        "Forza Horizon 6 just got more expensive for players. Insider Gaming reports Forza Horizon 6 Has Made Over $140 Million from Premium Edition. Before you spend, check the live price, the platform listing and whether this changes the practical call. The recommendation moves with it: buy now, wait or skip it. Treat the headline as a price check, not a verdict.",
      primary_source: "Insider Gaming",
      primary_source_url: "https://insider-gaming.com/forza-horizon-6-premium-edition-revenue/",
      description:
        "Forza Horizon 6 Has Made Over $140 Million from Premium Edition. Source: Insider Gaming.",
      confirmed_claims: ["Forza Horizon 6 Premium Edition has made over $140 million."],
    },
    { generatedAt: "2026-05-24T10:30:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Forza Horizon 6 Premium Already Made $140M");
  assert.equal(repaired.manifest.thumbnail_headline, "FORZA PREMIUM $140M");
  assert.equal(
    repaired.manifest.first_spoken_line,
    "Forza Horizon 6 Premium Edition is already turning early access into the real launch story.",
  );
  assert.doesNotMatch(
    repaired.manifest.narration_script,
    /before you spend|buy now,\s*wait or skip|practical call|recommendation moves|price check/i,
  );
  assert.match(repaired.manifest.narration_script, /early access is becoming the launch window/i);
  assert.match(repaired.manifest.description, /^Forza Horizon 6 Premium Edition has made more than \$140 million\./);
  assert.equal(repaired.manifest.full_script, repaired.manifest.narration_script);
  assert.equal(repaired.manifest.tts_script, repaired.manifest.narration_script);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair default player value does not generate checklist advice", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "crimson-default",
      canonical_subject: "Crimson Desert",
      canonical_game: "Crimson Desert",
      canonical_title: "Crimson Desert Finally Has A Launch Signal",
      selected_title: "Crimson Desert Finally Has A Launch Signal",
      title_candidates: ["Crimson Desert Finally Has A Launch Signal"],
      first_spoken_line: "Crimson Desert finally has a launch signal.",
      narration_script:
        "Crimson Desert finally has a launch signal. The confirmed bit is still the anchor. That matters because the next choice is practical: buy, download, wait or skip.",
      primary_source: "PlayStation Blog",
      primary_source_url: "https://blog.playstation.com/example",
      description: "Crimson Desert finally has a launch signal. Source: PlayStation Blog.",
      confirmed_claims: ["Crimson Desert has a new launch signal."],
    },
    { generatedAt: "2026-05-24T11:00:00.000Z" },
  );

  assert.doesNotMatch(
    repaired.manifest.narration_script,
    /next choice is practical|buy,\s*download,\s*wait|wishlist,\s*download or ignore/i,
  );
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair gives games-industry job stories specific public context", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "deus-ex-jobs",
      canonical_subject: "Deus Ex",
      canonical_game: "Deus Ex",
      canonical_title:
        "It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year",
      selected_title: "Deus Ex Composer Says The Jobs Vanished",
      first_spoken_line: "A Deus Ex composer says the games job market has gone brutally quiet.",
      narration_script:
        "A Deus Ex composer says the games job market has gone brutally quiet. The sharper angle is what changes once players see footage, price, platform details or real reaction.",
      primary_source: "PC Gamer",
      description:
        "It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year. Source: PC Gamer.",
      confirmed_claims: [
        "It's brutal out there: Deus Ex and Unreal composer says he's submitted 50 resumes and gotten one interview in the last year",
      ],
    },
    { generatedAt: "2026-05-24T11:15:00.000Z" },
  );

  assert.match(repaired.manifest.narration_script, /talent squeeze|games job market/i);
  assert.doesNotMatch(
    repaired.manifest.narration_script,
    /footage,\s*price,\s*platform details|concrete gaming hook|named game and source give viewers/i,
  );
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair rewrites broken thumbnail headlines before approval", () => {
  const dangling = repairGoalPublicCopyManifest(
    {
      story_id: "deus-ex-thumbnail",
      canonical_subject: "Deus Ex",
      canonical_game: "Deus Ex",
      selected_title: "Deus Ex Composer Says The Jobs Vanished",
      thumbnail_headline: "DEUS EX COMPOSER SAYS THE",
      first_spoken_line: "A Deus Ex composer says the games job market has gone brutally quiet.",
      narration_script:
        "A Deus Ex composer says the games job market has gone brutally quiet. PC Gamer reports a veteran composer sent dozens of resumes and got one interview.",
      primary_source: "PC Gamer",
      description: "A Deus Ex composer says the games job market is brutal. Source: PC Gamer.",
      confirmed_claims: [
        "A Deus Ex and Unreal composer says he submitted 50 resumes and got one interview in the last year.",
      ],
    },
    { generatedAt: "2026-05-26T22:45:00.000Z" },
  );

  assert.equal(dangling.manifest.thumbnail_headline, "DEUS EX JOBS VANISHED");
  assert.equal(evaluateGoalPublicCopy(dangling.manifest).verdict, "pass");

  const repeated = repairGoalPublicCopyManifest(
    {
      story_id: "ps5-thumbnail",
      canonical_subject: "PS5",
      canonical_game: "PS5",
      selected_title: "PS5 Prices Went Up In Europe",
      thumbnail_headline: "PS5 PS5 PRICES WENT UP",
      first_spoken_line: "PS5 prices went up across Europe and the UK.",
      narration_script:
        "PS5 prices went up across Europe and the UK. PlayStation Blog confirms the new pricing for selected markets.",
      primary_source: "PlayStation Blog",
      official_source: "PlayStation Blog",
      description: "PS5 prices are rising in selected markets. Source: PlayStation Blog.",
      confirmed_claims: ["PS5 prices are rising in selected markets."],
    },
    { generatedAt: "2026-05-26T22:45:00.000Z" },
  );

  assert.equal(repeated.manifest.thumbnail_headline, "PS5 PRICE JUMP");
  assert.equal(evaluateGoalPublicCopy(repeated.manifest).verdict, "pass");

  const repeatedSubject = repairGoalPublicCopyManifest(
    {
      story_id: "expanse-thumbnail",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      thumbnail_headline: "EXPANSE: OSIRIS REBORN THE EXPANSE",
      thumbnail_text: "EXPANSE: OSIRIS REBORN THE EXPANSE",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      narration_script:
        "The Expanse: Osiris Reborn finally showed real gameplay. Xbox showed the new cut during Partner Preview.",
      primary_source: "Xbox",
      description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview."],
    },
    { generatedAt: "2026-05-26T22:45:00.000Z" },
  );

  assert.equal(repeatedSubject.manifest.thumbnail_headline, "EXPANSE GAMEPLAY REVEAL");
  assert.equal(repeatedSubject.manifest.thumbnail_text, "EXPANSE GAMEPLAY REVEAL");
  assert.equal(evaluateGoalPublicCopy(repeatedSubject.manifest).verdict, "pass");

  const durationExpandedScript = [
    "The Expanse: Osiris Reborn finally showed real gameplay.",
    "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview.",
    "Now the camera, gunfights and scale are on screen instead of hidden behind a logo.",
    "The sharper question is whether the camera, gunfights and scale make it feel like The Expanse, not just another licensed shooter.",
    "Short showcases can sell impact, but mission flow will decide whether players trust the reveal.",
    "If the full missions keep that pace, this could become more than another licensed announcement.",
    "One more direct play segment would show whether the combat rhythm and camera weight match the reveal.",
    "Release timing and platform detail turn curiosity into something viewers can actually act on.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");
  const thumbnailOnly = repairGoalPublicCopyManifest(
    {
      story_id: "expanse-thumbnail-only",
      canonical_subject: "The Expanse: Osiris Reborn",
      canonical_game: "The Expanse: Osiris Reborn",
      selected_title: "The Expanse Shows Real Gameplay",
      thumbnail_headline: "EXPANSE: OSIRIS REBORN THE SHOWS",
      thumbnail_text: "EXPANSE: OSIRIS REBORN THE SHOWS",
      first_spoken_line: "The Expanse: Osiris Reborn finally showed real gameplay.",
      narration_script: durationExpandedScript,
      full_script: durationExpandedScript,
      tts_script: durationExpandedScript,
      word_count: durationExpandedScript.split(/\s+/).length,
      tts_word_count: durationExpandedScript.split(/\s+/).length,
      primary_source: "Xbox",
      official_source: "Xbox",
      description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
      confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview."],
      duration_variant_repaired_at: "2026-05-28T11:25:09.544Z",
      duration_variant_repair_strategy: "normal_production_safe_script_expansion",
    },
    { generatedAt: "2026-05-28T11:30:00.000Z" },
  );

  assert.equal(thumbnailOnly.manifest.thumbnail_headline, "EXPANSE GAMEPLAY REVEAL");
  assert.equal(thumbnailOnly.manifest.narration_script, durationExpandedScript);
  assert.equal(thumbnailOnly.manifest.full_script, durationExpandedScript);
  assert.equal(thumbnailOnly.manifest.tts_script, durationExpandedScript);
  assert.equal(thumbnailOnly.manifest.word_count, durationExpandedScript.split(/\s+/).length);
  assert.equal(evaluateGoalPublicCopy(thumbnailOnly.manifest).verdict, "pass");

  const vRising = repairGoalPublicCopyManifest(
    {
      story_id: "v-rising-thumbnail",
      canonical_subject: "V Rising",
      canonical_game: "V Rising",
      selected_title: "V Rising Devs Are Making Another Vampire Game",
      thumbnail_headline: "V RISING DEVS ARE MAKING",
      first_spoken_line: "V Rising's developers are already building another vampire game.",
      narration_script:
        "V Rising's developers are already building another vampire game. Stunlock Studios says it is working on a new game set in the world of V Rising.",
      primary_source: "Stunlock Studios",
      description: "Stunlock Studios says it is working on another vampire game. Source: Stunlock Studios.",
      confirmed_claims: [
        "Stunlock Studios says it is working on a new game set in the world of V Rising.",
      ],
    },
    { generatedAt: "2026-05-26T22:45:00.000Z" },
  );

  assert.equal(vRising.manifest.thumbnail_headline, "V RISING VAMPIRE GAME");
  assert.equal(evaluateGoalPublicCopy(vRising.manifest).verdict, "pass");

  const stranger = repairGoalPublicCopyManifest(
    {
      story_id: "stranger-five-eras-thumbnail",
      canonical_subject: "Stranger Than Heaven",
      canonical_game: "Stranger Than Heaven",
      selected_title: "Stranger Than Heaven Shows Five Eras",
      thumbnail_headline: "STRANGER THAN HEAVEN SHOWS FIVE",
      first_spoken_line: "Stranger Than Heaven just showed its five-era setup.",
      narration_script:
        "Stranger Than Heaven just showed its five-era setup. Xbox showed the trailer during Partner Preview.",
      primary_source: "Xbox",
      description: "Stranger Than Heaven showed its five-era setup. Source: Xbox.",
      confirmed_claims: ["Stranger Than Heaven showed its five-era setup."],
    },
    { generatedAt: "2026-05-26T22:45:00.000Z" },
  );

  assert.equal(stranger.manifest.thumbnail_headline, "STRANGER FIVE ERAS");
  assert.equal(evaluateGoalPublicCopy(stranger.manifest).verdict, "pass");

  const subnautica = repairGoalPublicCopyManifest(
    {
      story_id: "subnautica-leakers-thumbnail",
      canonical_subject: "Subnautica 2",
      canonical_game: "Subnautica 2",
      canonical_title: 'Subnautica 2 Dev Responds to Pirates Leaking the Game; "I hope you rethink your life choices"',
      selected_title: "Subnautica 2 Dev Calls Out Leakers",
      thumbnail_headline: "SUBNAUTICA 2 DEV CALLS OUT",
      first_spoken_line: "Subnautica 2's developer is already fighting leaked builds.",
      narration_script:
        "Subnautica 2's developer is already fighting leaked builds. Respawnfirst reports the studio responded after the game leaked early.",
      primary_source: "Respawnfirst",
      description: "Subnautica 2's developer responded to leaked builds. Source: Respawnfirst.",
      confirmed_claims: ["Subnautica 2's developer responded after the game leaked early."],
    },
    { generatedAt: "2026-05-26T22:45:00.000Z" },
  );

  assert.equal(subnautica.manifest.thumbnail_headline, "SUBNAUTICA LEAKERS CALLED OUT");
  assert.equal(evaluateGoalPublicCopy(subnautica.manifest).verdict, "pass");
});

test("public copy regeneration stays pending when the repair is newer than the last regenerated render", () => {
  assert.equal(
    publicCopyRegenerationPending({
      public_copy_repaired_at: "2026-05-24T08:39:05.924Z",
      public_copy_regeneration_completed_at: "2026-05-24T06:12:50.889Z",
      public_copy_final_render_regenerated_at: "2026-05-24T06:12:50.889Z",
    }),
    true,
  );

  assert.equal(
    publicCopyRegenerationPending({
      public_copy_repaired_at: "2026-05-24T08:39:05.924Z",
      public_copy_regeneration_completed_at: "2026-05-24T08:45:00.000Z",
      public_copy_final_render_regenerated_at: "2026-05-24T08:45:00.000Z",
    }),
    false,
  );
});

test("public copy package repair refreshes stale Forza revenue thumbnails before rerender", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-forza-revenue-thumb-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "1tf955x",
    canonical_subject: "Forza Horizon 6",
    canonical_game: "Forza Horizon 6",
    canonical_title: "Forza Horizon 6 Has Made Over $140 Million from Premium Edition",
    selected_title: "Forza Horizon 6 Premium Already Made $140M",
    thumbnail_headline: "FORZA HORIZON 6 PREMIUM ALREADY",
    thumbnail_text: "FORZA HORIZON 6 PREMIUM ALREADY",
    first_spoken_line: "Forza Horizon 6 Premium Edition is already turning early access into the real launch story.",
    narration_script:
      "Forza Horizon 6 Premium Edition is already turning early access into the real launch story. Insider Gaming reports Forza Horizon 6 Premium Edition has made more than $140 million. The awkward part is the business model: early access is becoming the launch window. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "Forza Horizon 6 Premium Edition is already turning early access into the real launch story. Insider Gaming reports Forza Horizon 6 Premium Edition has made more than $140 million. The awkward part is the business model: early access is becoming the launch window. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "Forza Horizon 6 Premium Edition is already turning early access into the real launch story. Insider Gaming reports Forza Horizon 6 Premium Edition has made more than $140 million. The awkward part is the business model: early access is becoming the launch window. Follow Pulse Gaming so you never miss a beat.",
    description: "Forza Horizon 6 Premium Edition has made more than $140 million. Source: Insider Gaming.",
    primary_source: "Insider Gaming",
    source_card_label: "Insider Gaming",
    confirmed_claims: ["Forza Horizon 6 Premium Edition has made more than $140 million."],
    public_copy_repaired_at: "2026-05-24T08:39:05.924Z",
    public_copy_regeneration_completed_at: "2026-05-24T06:12:50.889Z",
    public_copy_final_render_regenerated_at: "2026-05-24T06:12:50.889Z",
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "1tf955x", artifact_dir: artifactDir }],
    generatedAt: "2026-05-24T08:50:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(updated.thumbnail_headline, "FORZA PREMIUM $140M");
  assert.equal(updated.thumbnail_text, "FORZA PREMIUM $140M");
  assert.equal(publicCopyRegenerationPending(updated), true);
});

test("public copy repair does not generate source-process Threads copy", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "spellcasters-threads",
      canonical_subject: "Spellcasters Chronicles",
      canonical_game: "Spellcasters Chronicles",
      canonical_title: "Spellcasters Chronicles Is Shutting Down",
      selected_title: "Spellcasters Chronicles Is Shutting Down",
      first_spoken_line: "Spellcasters Chronicles is shutting down only months after early access.",
      narration_script:
        "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source for this story. It stays a gaming story because it changes what players check around the game, platform or launch window.",
      full_script:
        "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source for this story. It stays a gaming story because it changes what players check around the game, platform or launch window.",
      tts_script:
        "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source for this story. It stays a gaming story because it changes what players check around the game, platform or launch window.",
      primary_source: "Eurogamer",
      source_card_label: "Eurogamer",
      description:
        "Spellcasters Chronicles is shutting down only months after early access. Source: Eurogamer.",
      confirmed_claims: [
        "Spellcasters Chronicles is shutting down only months after early access.",
      ],
      platform_publish_manifest: {
        outputs: {
          threads: {
            discussion_post:
              "Spellcasters Chronicles is shutting down only months after early access. Eurogamer is the source; the next question is whether players should act on it.",
          },
        },
      },
    },
    { generatedAt: "2026-05-24T12:00:00.000Z" },
  );

  const discussionPost = repaired.manifest.platform_publish_manifest.outputs.threads.discussion_post;
  assert.doesNotMatch(
    `${repaired.manifest.narration_script} ${discussionPost}`,
    /is the source for this story|stays a gaming story|next question is whether players should act/i,
  );
  assert.match(discussionPost, /Spellcasters Chronicles/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair promotes vague Store labels to Steam and keeps the claim storefront-safe", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "forza-steam-store",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 is available now on Steam",
      selected_title: "Forza Horizon 6 Finally Hit Steam",
      first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Store reports Forza Horizon 6 is already being framed as a major Steam success for Xbox.",
      description: "Forza Horizon 6 is available now on Steam. Source: Store.",
      primary_source: "Store",
      source_card_label: "Store",
      primary_source_url: "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
      confirmed_claims: ["Forza Horizon 6 is available now on Steam"],
    },
    { generatedAt: "2026-05-24T20:00:00.000Z" },
  );

  assert.equal(repaired.manifest.primary_source, "Steam");
  assert.equal(repaired.manifest.source_card_label, "Steam");
  assert.doesNotMatch(repaired.manifest.narration_script, /\bStore reports\b/i);
  assert.match(repaired.manifest.narration_script, /\bSteam lists Forza Horizon 6 as available now\b/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair promotes wrong non-Steam labels when the source URL is Steam", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "forza-steam-url-mismatch",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 is available now on Steam",
      selected_title: "Forza Horizon 6 Finally Hit Steam",
      first_spoken_line: "Forza Horizon 6 just turned its Steam launch into an Xbox signal.",
      narration_script:
        "Forza Horizon 6 just turned its Steam launch into an Xbox signal. Xbox reports Forza Horizon 6 is available now on Steam.",
      description: "Forza Horizon 6 is available now on Steam. Source: Xbox.",
      primary_source: "Xbox",
      source_card_label: "Xbox",
      primary_source_url: "https://store.steampowered.com/app/2483190/Forza_Horizon_6/",
      confirmed_claims: ["Forza Horizon 6 is available now on Steam."],
    },
    { generatedAt: "2026-05-24T20:00:30.000Z" },
  );

  assert.equal(repaired.manifest.primary_source, "Steam");
  assert.equal(repaired.manifest.source_card_label, "Steam");
  assert.doesNotMatch(repaired.manifest.narration_script, /\bXbox reports\b/i);
  assert.match(repaired.manifest.narration_script, /\bSteam lists Forza Horizon 6 as available now\b/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair strips Automaton headline residue from Pragmata narration", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "pragmata-automaton",
      canonical_subject: "Pragmata",
      canonical_game: "Pragmata",
      canonical_title:
        'Pragmata\'s newly revealed New York stage was painstakingly made by human developers to look "AI generated," according to director - AUTOMATON WEST',
      selected_title: "Pragmata's AI-Look Stage Was Handmade",
      first_spoken_line: "Pragmata's AI-looking stage was actually handmade by developers.",
      narration_script:
        'Pragmata\'s AI-looking stage was actually handmade by developers. Automaton Media reports Pragmata\'s newly revealed New York stage was painstakingly made by human developers to look "AI generated," according to director - AUTOMATON WEST.',
      description:
        'Pragmata\'s newly revealed New York stage was painstakingly made by human developers to look "AI generated," according to director - AUTOMATON WEST. Source: Automaton Media.',
      primary_source: "Automaton Media",
      source_card_label: "Automaton Media",
      confirmed_claims: [
        'Pragmata\'s newly revealed New York stage was painstakingly made by human developers to look "AI generated," according to director - AUTOMATON WEST',
      ],
    },
    { generatedAt: "2026-05-24T20:01:00.000Z" },
  );

  assert.doesNotMatch(repaired.manifest.narration_script, /AUTOMATON WEST/i);
  assert.doesNotMatch(repaired.manifest.description, /AUTOMATON WEST/i);
  assert.match(repaired.manifest.narration_script, /Automaton Media reports Pragmata's New York stage was handmade/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair removes unsupported V Rising gameplay-specific filler", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "v-rising-specifics",
      canonical_subject: "V Rising",
      canonical_game: "V Rising",
      selected_title: "V Rising Devs Are Making Another Vampire Game",
      first_spoken_line: "V Rising's developers are already building another vampire game.",
      narration_script:
        "V Rising's developers are already building another vampire game. Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update. Frame-rate clips, matchmaking clips and balance complaints will expose weak fixes fast.",
      description:
        "Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update. Source: Stunlock Studios.",
      primary_source: "Stunlock Studios",
      source_card_label: "Stunlock Studios",
      confirmed_claims: [
        "Stunlock Studios says it is working on a new game set in the world of V Rising, with V Rising itself moving to balance and bug-fix support rather than a new content update.",
      ],
    },
    { generatedAt: "2026-05-24T20:02:00.000Z" },
  );

  assert.doesNotMatch(repaired.manifest.narration_script, /frame-rate clips|matchmaking clips|balance complaints/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair removes producer-note narration before audio regeneration", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "star-wars-zero-producer-note",
      canonical_subject: "Star Wars Zero Company",
      canonical_game: "Star Wars Zero Company",
      canonical_title: "Star Wars Zero Company is more than Star Wars XCOM",
      selected_title: "Star Wars Zero Company Is More Than XCOM",
      first_spoken_line: "Star Wars Zero Company is trying to be more than Star Wars XCOM.",
      narration_script:
        "Star Wars Zero Company is trying to be more than Star Wars XCOM. PC Gamer reports the game mixes turn-based tactics with crew pressure. That is the angle to watch when longer footage lands.",
      description:
        "PC Gamer reports Star Wars Zero Company mixes turn-based tactics with crew pressure. Source: PC Gamer.",
      primary_source: "PC Gamer",
      source_card_label: "PC Gamer",
      confirmed_claims: [
        "Star Wars Zero Company mixes turn-based tactics with crew pressure.",
      ],
    },
    { generatedAt: "2026-05-24T20:03:00.000Z" },
  );

  assert.doesNotMatch(repaired.manifest.narration_script, /\bangle to watch|longer footage lands\b/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
});

test("public copy repair rewrites vague-tease fallback narration into story-specific copy", () => {
  const repaired = repairGoalPublicCopyManifest({
    story_id: "pragmata-vague-tease",
    canonical_subject: "Pragmata",
    selected_title: "Pragmata's AI-Look Stage Was Handmade",
    first_spoken_line: "Pragmata's AI-looking stage was actually handmade by developers.",
    narration_script:
      "Pragmata's AI-looking stage was actually handmade by developers. Automaton Media reports Pragmata's New York stage was handmade by developers to look AI generated. Pragmata now has a real detail on the table, which is better than another vague tease. Follow Pulse Gaming so you never miss a beat.",
    description: "Pragmata's New York stage was handmade to look AI generated. Source: Automaton Media.",
    primary_source: "Automaton Media",
    source_card_label: "Automaton Media",
    confirmed_claims: [
      "Pragmata's New York stage was handmade by developers to look AI generated.",
    ],
  });

  assert.equal(repaired.after.verdict, "pass", repaired.after.failures.join(", "));
  assert.doesNotMatch(repaired.manifest.narration_script, /real detail on the table|vague tease/i);
  assert.match(repaired.manifest.narration_script, /strange texture/i);
});

test("public copy repair removes cross-story jobs residue from Subnautica leak scripts", () => {
  const repaired = repairGoalPublicCopyManifest({
    story_id: "subnautica-cross-story-residue",
    canonical_subject: "Subnautica 2",
    selected_title: "Subnautica 2 Dev Calls Out Leakers",
    first_spoken_line: "Subnautica 2's developer is already fighting leaked builds.",
    narration_script:
      "Subnautica 2's developer is already fighting leaked builds. Respawnfirst reports A Subnautica 2 developer responded after leaked builds started spreading before launch. Subnautica 2 is the familiar name attached to a brutal jobs story. When a composer with Deus Ex and Unreal credits is sending dozens of resumes, the market problem stops sounding abstract. Follow Pulse Gaming so you never miss a beat.",
    description: "A Subnautica 2 developer responded to leaked builds. Source: Respawnfirst.",
    primary_source: "Respawnfirst",
    source_card_label: "Respawnfirst",
    confirmed_claims: [
      "A Subnautica 2 developer responded after leaked builds started spreading before launch.",
    ],
  });

  assert.equal(repaired.after.verdict, "pass", repaired.after.failures.join(", "));
  assert.doesNotMatch(repaired.manifest.narration_script, /Deus Ex|Unreal|composer|resume|jobs story/i);
  assert.match(repaired.manifest.narration_script, /rough leaked material/i);
});

test("public copy repair promotes truncated YouTube source labels to the official platform source", () => {
  const repaired = repairGoalPublicCopyManifest({
    story_id: "stranger-than-heaven-youtu",
    canonical_subject: "STRANGER THAN HEAVEN Five Eras",
    canonical_company: "Xbox",
    selected_title: "Stranger Than Heaven Shows Five Eras",
    first_spoken_line: "Stranger Than Heaven just showed its five-era setup.",
    narration_script:
      "Stranger Than Heaven just showed its five-era setup. Youtu reports STRANGER THAN HEAVEN Five Eras Reveal Trailer at Xbox Partner Preview.",
    description: "Stranger Than Heaven showed its Five Eras trailer. Source: Youtu.",
    primary_source: "Youtu",
    source_card_label: "Youtu",
    primary_source_url: "https://www.youtube.com/watch?v=example",
    confirmed_claims: [
      "STRANGER THAN HEAVEN showed a Five Eras reveal trailer at Xbox Partner Preview.",
    ],
  });

  assert.equal(repaired.after.verdict, "pass", repaired.after.failures.join(", "));
  assert.equal(repaired.manifest.primary_source, "Xbox");
  assert.doesNotMatch(repaired.manifest.narration_script, /Youtu reports/i);
  assert.match(repaired.manifest.narration_script, /Xbox Partner Preview/i);
});
