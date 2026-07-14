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
const { buildPulseMediaHouseScore } = require("../../lib/pulse-media-house-score");
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

test("caption SRT repairs Cyberpunk 2077 ASR split tokens", () => {
  const srt = buildCaptionSrt(
    "Cyberpunk 2077's biggest launch problem is not bugs anymore.",
    6,
    {
      words: [
        { word: "Cyberpunk", start: 0, end: 0.62 },
        { word: "2070", start: 0.62, end: 1.34 },
        { word: "seven's", start: 1.34, end: 2.04 },
        { word: "biggest", start: 2.04, end: 2.4 },
        { word: "launch", start: 2.4, end: 2.72 },
        { word: "problem", start: 2.72, end: 3.1 },
      ],
      maxWordsPerPhrase: 2,
      maxPhraseChars: 18,
      maxPhraseDurationS: 1.05,
      danglingMergeMaxWords: 2,
    },
  );

  assert.match(srt, /\nCyberpunk 2077's\n/);
  assert.doesNotMatch(srt, /\nCyberpunk\n/);
  assert.doesNotMatch(srt, /\n2070\n/);
  assert.doesNotMatch(srt, /seven's/);
});

test("caption SRT protects Pulse Gaming as one brand phrase", () => {
  const srt = buildCaptionSrt(
    "Follow Pulse Gaming so you never miss a beat.",
    5,
    {
      words: [
        { word: "Follow", start: 0, end: 0.28 },
        { word: "Pulse", start: 0.3, end: 0.56 },
        { word: "Gaming", start: 1.28, end: 1.62 },
        { word: "so", start: 1.64, end: 1.74 },
        { word: "you", start: 1.76, end: 1.88 },
        { word: "never", start: 1.9, end: 2.12 },
        { word: "miss", start: 2.14, end: 2.32 },
        { word: "a", start: 2.34, end: 2.42 },
        { word: "beat.", start: 2.44, end: 2.7 },
      ],
      maxWordsPerPhrase: 2,
      maxPhraseChars: 22,
      maxPhraseDurationS: 1.05,
    },
  );

  assert.match(srt, /Follow Pulse Gaming/);
  assert.doesNotMatch(srt, /\nFollow Pulse\n\n/);
  assert.doesNotMatch(srt, /\nGaming so\n/);
});

test("caption SRT keeps protected game names instead of phonetic ASR spellings", () => {
  const srt = buildCaptionSrt(
    "Beastro is the Game Pass card game. Beastro wins if strategy feels generous.",
    8,
    {
      words: [
        { word: "Beastrow", start: 0, end: 0.68 },
        { word: "is", start: 0.68, end: 0.9 },
        { word: "the", start: 0.9, end: 1.06 },
        { word: "Game", start: 1.06, end: 1.38 },
        { word: "Pass", start: 1.38, end: 1.7 },
        { word: "card", start: 1.7, end: 2.02 },
        { word: "game.", start: 2.02, end: 2.36 },
        { word: "Bistro", start: 3.1, end: 3.72 },
        { word: "wins", start: 3.72, end: 4.02 },
        { word: "if", start: 4.02, end: 4.2 },
        { word: "strategy", start: 4.2, end: 4.78 },
        { word: "feels", start: 4.78, end: 5.1 },
        { word: "generous.", start: 5.1, end: 5.68 },
      ],
      maxWordsPerPhrase: 2,
      maxPhraseChars: 18,
      maxPhraseDurationS: 1.05,
    },
  );

  assert.match(srt, /Beastro is/);
  assert.match(srt, /Beastro wins/);
  assert.doesNotMatch(srt, /Beastrow|Bistro/);
});

test("caption SRT normalises hardware, years and GTA acronym-number ASR", () => {
  const srt = buildCaptionSrt(
    "The GTA 6 delay hits PlayStation 5 in 2027. Gears of War E-Day needs RTX 2060 hardware.",
    12,
    {
      words: [
        { word: "The", start: 0, end: 0.2 },
        { word: "G", start: 0.2, end: 0.34 },
        { word: "T", start: 0.34, end: 0.48 },
        { word: "A", start: 0.48, end: 0.62 },
        { word: "six", start: 0.62, end: 0.9 },
        { word: "delay", start: 0.9, end: 1.2 },
        { word: "hits", start: 1.2, end: 1.46 },
        { word: "PlayStation", start: 1.46, end: 1.94 },
        { word: "five", start: 1.94, end: 2.2 },
        { word: "in", start: 2.2, end: 2.36 },
        { word: "twenty", start: 2.36, end: 2.72 },
        { word: "twenty", start: 2.72, end: 3.08 },
        { word: "seven.", start: 3.08, end: 3.48 },
        { word: "Gears", start: 4.1, end: 4.42 },
        { word: "of", start: 4.42, end: 4.56 },
        { word: "War", start: 4.56, end: 4.84 },
        { word: "E", start: 4.84, end: 5.02 },
        { word: "Day", start: 5.02, end: 5.3 },
        { word: "needs", start: 5.3, end: 5.62 },
        { word: "RTX", start: 5.62, end: 5.96 },
        { word: "twenty", start: 5.96, end: 6.28 },
        { word: "sixty", start: 6.28, end: 6.64 },
        { word: "hardware.", start: 6.64, end: 7.1 },
      ],
      maxWordsPerPhrase: 5,
      maxPhraseChars: 32,
      maxPhraseDurationS: 2.4,
    },
  );

  assert.match(srt, /GTA VI/);
  assert.match(srt, /PlayStation 5/);
  assert.match(srt, /2027/);
  assert.match(srt, /Gears of War E-Day/);
  assert.match(srt, /RTX 2060/);
  assert.doesNotMatch(srt, /G T A|PlayStation five|twenty twenty seven|twenty sixty|E Day/);
});

test("caption SRT protects title and platform fragments before phrase grouping", () => {
  const srt = buildCaptionSrt(
    "GameSpot says GTA 6 hits PlayStation 5 in 2026.",
    8,
    {
      words: [
        { word: "Game", start: 0, end: 0.2 },
        { word: "Spot", start: 0.2, end: 0.44 },
        { word: "says", start: 0.44, end: 0.68 },
        { word: "G", start: 0.68, end: 0.8 },
        { word: "T", start: 0.8, end: 0.92 },
        { word: "A", start: 0.92, end: 1.04 },
        { word: "six", start: 1.04, end: 1.28 },
        { word: "hits", start: 1.28, end: 1.52 },
        { word: "PlayStation", start: 1.52, end: 1.98 },
        { word: "five", start: 1.98, end: 2.22 },
        { word: "in", start: 2.22, end: 2.36 },
        { word: "twenty", start: 2.36, end: 2.64 },
        { word: "twenty", start: 2.64, end: 2.92 },
        { word: "six.", start: 2.92, end: 3.2 },
      ],
      maxWordsPerPhrase: 2,
      maxPhraseChars: 14,
      maxPhraseDurationS: 0.8,
      danglingMergeMaxWords: 2,
    },
  );

  assert.match(srt, /GameSpot/);
  assert.match(srt, /GTA VI/);
  assert.match(srt, /PlayStation 5/);
  assert.match(srt, /2026/);
  assert.doesNotMatch(srt, /Game Spot|G T A|PlayStation five|twenty twenty six/);
});

test("public copy rewrite avoids fragile GTA VI spoken-six opener", () => {
  const manifest = {
    story_id: "rss_gta_vi_preorder_voice",
    canonical_subject: "Grand Theft Auto VI",
    canonical_game: "Grand Theft Auto VI",
    canonical_title: "GTA VI Starts The Preorder Fight",
    selected_title: "GTA VI Starts The Preorder Fight",
    short_title: "GTA VI Starts The Preorder Fight",
    primary_source: "Xbox Wire",
    primary_source_url: "https://www.xbox.com/en-US/games/store/grand-theft-auto-vi/9NNZSNHLR63L#new_tab",
    confirmed_claims: [
      "Xbox Wire says Grand Theft Auto VI pre-orders open on June 25 after Rockstar put Jason and Lucia on the official cover art.",
    ],
    narration_script:
      "Rockstar just turned GTA VI pre-orders into a buy, wait or skip argument. Follow Pulse Gaming so you never miss a beat.",
  };

  const repair = repairGoalPublicCopyManifest(manifest, {
    generatedAt: "2026-06-27T00:00:00.000Z",
    forceNarrationRewrite: true,
  });
  const opener = repair.manifest.narration_script.split(/\s+/).slice(0, 12).join(" ");

  assert.equal(repair.after.verdict, "pass");
  assert.doesNotMatch(opener, /\b(?:GTA\s+VI|GTA\s+6|Grand Theft Auto VI)\b/i);
  assert.doesNotMatch(opener, /\bGrand Theft Auto six\b/i);
  assert.match(repair.manifest.narration_script, /Grand Theft Auto VI pre-orders open on June 25/i);
  assert.match(repair.manifest.selected_title, /GTA VI Starts The Preorder Fight/i);
});

test("caption SRT protects GameSpot possessives before phrase grouping", () => {
  const srt = buildCaptionSrt(
    "GameSpot's footage shows Capcom giving Yasmine fast step-ins.",
    5,
    {
      words: [
        { word: "Game", start: 0, end: 0.28 },
        { word: "Spot's", start: 0.28, end: 0.62 },
        { word: "footage", start: 0.62, end: 1.02 },
        { word: "shows", start: 1.02, end: 1.26 },
        { word: "Capcom", start: 1.26, end: 1.7 },
        { word: "giving", start: 1.7, end: 2.0 },
        { word: "Yasmine", start: 2.0, end: 2.48 },
        { word: "fast", start: 2.48, end: 2.72 },
        { word: "step-ins.", start: 2.72, end: 3.14 },
      ],
      maxWordsPerPhrase: 3,
      maxPhraseChars: 26,
      maxPhraseDurationS: 1.2,
    },
  );

  assert.match(srt, /GameSpot's footage/);
  assert.doesNotMatch(srt, /Game Spot/);
});

test("caption SRT prevents overlapping cue timings after protected token merges", () => {
  const srt = buildCaptionSrt(
    "GTA 6 preorders begin on June 25, while price still matters.",
    6,
    {
      words: [
        { word: "G", start: 7.56, end: 7.72 },
        { word: "T", start: 7.72, end: 7.96 },
        { word: "A", start: 7.96, end: 8.16 },
        { word: "six", start: 8.16, end: 8.72 },
        { word: "preorders", start: 8.72, end: 9.16 },
        { word: "begin", start: 9.16, end: 9.48 },
        { word: "on", start: 9.48, end: 9.68 },
        { word: "June", start: 9.68, end: 9.88 },
        { word: "25,", start: 9.88, end: 10.46 },
        { word: "while", start: 11.1, end: 11.18 },
        { word: "price", start: 11.16, end: 11.6 },
        { word: "still", start: 11.6, end: 12.0 },
        { word: "matters.", start: 12.0, end: 12.36 },
      ],
      maxWordsPerPhrase: 3,
      maxPhraseChars: 20,
      maxPhraseDurationS: 1.2,
    },
  );
  const timings = Array.from(srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g))
    .map((match) => ({
      start:
        Number(match[1]) * 3600 +
        Number(match[2]) * 60 +
        Number(match[3]) +
        Number(match[4]) / 1000,
      end:
        Number(match[5]) * 3600 +
        Number(match[6]) * 60 +
        Number(match[7]) +
        Number(match[8]) / 1000,
    }));

  assert.ok(timings.length > 1);
  for (let index = 1; index < timings.length; index += 1) {
    assert.ok(
      timings[index].start >= timings[index - 1].end,
      `${JSON.stringify(timings[index - 1])} overlaps ${JSON.stringify(timings[index])}`,
    );
  }
});

test("caption SRT restores Grand Theft Auto roman numerals from spoken words", () => {
  const srt = buildCaptionSrt(
    "Grand Theft Auto VI cover art just became the first thing players judge.",
    8,
    {
      words: [
        { word: "Grand", start: 0, end: 0.28 },
        { word: "Theft", start: 0.32, end: 0.56 },
        { word: "Auto", start: 0.6, end: 0.84 },
        { word: "Six", start: 0.9, end: 1.1 },
        { word: "cover", start: 1.16, end: 1.44 },
        { word: "art", start: 1.5, end: 1.74 },
        { word: "just", start: 1.8, end: 2.02 },
        { word: "became", start: 2.08, end: 2.42 },
        { word: "the", start: 2.48, end: 2.62 },
        { word: "first", start: 2.68, end: 2.92 },
        { word: "thing", start: 2.98, end: 3.22 },
        { word: "players", start: 3.28, end: 3.66 },
        { word: "judge.", start: 3.72, end: 4.1 },
      ],
      maxWordsPerPhrase: 4,
      maxPhraseChars: 32,
      maxPhraseDurationS: 2.2,
    },
  );

  assert.match(srt, /GTA VI/);
  assert.doesNotMatch(srt, /Grand Theft Auto Six/);
});

test("caption SRT keeps Gears E-Day specs captions numeric after local TTS expansion", () => {
  const srt = buildCaptionSrt(
    "Gears of War E-Day just made its PC version a storage test. The new requirements list a 130 GB SSD install, with RTX 2060-era hardware as the minimum floor. That is not shocking for a 2026 blockbuster, but it changes the real conversation. If E-Day looks this heavy, players will accept the size.",
    32,
    {
      words: [
        { word: "Gears", start: 0, end: 0.28 },
        { word: "of", start: 0.34, end: 0.4 },
        { word: "War", start: 0.44, end: 0.66 },
        { word: "E", start: 0.8, end: 0.88 },
        { word: "Day", start: 0.92, end: 1.12 },
        { word: "just", start: 1.22, end: 1.42 },
        { word: "made", start: 1.46, end: 1.6 },
        { word: "its", start: 1.64, end: 1.74 },
        { word: "PC", start: 1.8, end: 2.19 },
        { word: "version", start: 2.25, end: 2.61 },
        { word: "a", start: 2.71, end: 2.75 },
        { word: "storage", start: 2.81, end: 3.21 },
        { word: "test.", start: 3.27, end: 3.55 },
        { word: "The", start: 4.61, end: 4.71 },
        { word: "new", start: 4.75, end: 4.87 },
        { word: "requirements", start: 4.91, end: 5.47 },
        { word: "list", start: 5.55, end: 5.77 },
        { word: "a", start: 5.77, end: 6.07 },
        { word: "130", start: 6.11, end: 6.35 },
        { word: "GB", start: 6.73, end: 7.23 },
        { word: "SSD", start: 7.45, end: 7.77 },
        { word: "install,", start: 7.83, end: 8.28 },
        { word: "with", start: 8.4, end: 8.54 },
        { word: "RTX", start: 8.72, end: 9.16 },
        { word: "twenty", start: 9.22, end: 9.48 },
        { word: "sixty", start: 9.54, end: 9.86 },
        { word: "era", start: 9.96, end: 10.16 },
        { word: "hardware", start: 10.2, end: 10.62 },
        { word: "as", start: 10.72, end: 10.82 },
        { word: "the", start: 10.84, end: 10.92 },
        { word: "minimum", start: 10.96, end: 11.3 },
        { word: "floor.", start: 11.34, end: 11.56 },
        { word: "That", start: 13.14, end: 13.28 },
        { word: "is", start: 13.34, end: 13.42 },
        { word: "not", start: 13.48, end: 13.68 },
        { word: "shocking", start: 13.76, end: 14.18 },
        { word: "for", start: 14.24, end: 14.38 },
        { word: "a", start: 14.42, end: 14.44 },
        { word: "twenty", start: 14.52, end: 14.76 },
        { word: "twenty", start: 14.8, end: 15.0 },
        { word: "six", start: 15.06, end: 15.26 },
        { word: "blockbuster,", start: 15.32, end: 15.99 },
        { word: "but", start: 16.55, end: 16.65 },
        { word: "it", start: 16.69, end: 16.73 },
        { word: "changes", start: 16.83, end: 17.21 },
        { word: "the", start: 17.25, end: 17.33 },
        { word: "real", start: 17.43, end: 17.65 },
        { word: "conversation.", start: 17.71, end: 18.35 },
        { word: "If", start: 26.52, end: 26.58 },
        { word: "E", start: 26.74, end: 26.8 },
        { word: "Day", start: 26.84, end: 27.0 },
        { word: "looks", start: 27.04, end: 27.24 },
        { word: "this", start: 27.28, end: 27.44 },
        { word: "heavy,", start: 27.48, end: 27.74 },
        { word: "players", start: 32.12, end: 32.31 },
        { word: "will", start: 32.32, end: 32.35 },
        { word: "accept", start: 32.36, end: 32.39 },
        { word: "the", start: 32.4, end: 32.43 },
        { word: "size.", start: 32.44, end: 32.47 },
      ],
      maxWordsPerPhrase: 3,
      maxPhraseChars: 24,
      maxPhraseDurationS: 1.6,
      danglingMergeMaxWords: 3,
    },
  );

  assert.match(srt, /RTX 2060-era/);
  assert.match(srt, /2026/);
  assert.match(srt, /If E-Day/);
  assert.doesNotMatch(srt, /twenty\s+sixty|twenty\s+twenty\s+six|2020 six|E Day/);
});

test("public copy repair gives Gears E-Day specs stories a clearer player-impact script", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "fresh_gears_eday_pc_specs_20260616",
      canonical_subject: "Gears Of War: E-Day",
      canonical_game: "Gears of War E-Day",
      canonical_title: "Gears E-Day Has A 130GB Problem",
      selected_title: "Gears E-Day Has A 130GB Problem",
      primary_source: "PC Gamer",
      confirmed_claims: [
        "PC Gamer reports Gears of War E-Day PC requirements list a 130 GB SSD install.",
        "The listed minimum GPU floor includes RTX 2060-era hardware.",
      ],
      narration_script:
        "Gears of War E-Day just made its PC version a storage test. The new requirements list a 130 GB SSD install, with RTX 2060-era hardware as the minimum floor.",
    },
    { generatedAt: "2026-06-18T09:30:00.000Z" },
  );

  assert.equal(repaired.manifest.selected_title, "Gears E-Day Has A 130GB Problem");
  assert.match(repaired.manifest.narration_script, /^Gears of War E-Day just turned PC specs into the story\./);
  assert.match(repaired.manifest.narration_script, /PC Gamer says/);
  assert.match(repaired.manifest.narration_script, /130 GB SSD install/);
  assert.match(repaired.manifest.narration_script, /RTX 2060-era/);
  assert.match(repaired.manifest.narration_script, /what players have to delete before launch night/);
  assert.match(repaired.manifest.narration_script, /weight, not bloat/);
  assert.match(repaired.manifest.narration_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.ok(repaired.manifest.narration_script.split(/\s+/).length >= 120);
});

test("public copy repair can force a quality rewrite for clean Gears E-Day specs packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-gears-quality-rewrite-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "fresh_gears_eday_pc_specs_20260616",
    canonical_subject: "Gears Of War: E-Day",
    canonical_game: "Gears of War E-Day",
    canonical_title: "Gears E-Day Has A 130GB Problem",
    selected_title: "Gears E-Day Has A 130GB Problem",
    short_title: "Gears E-Day Has A 130GB Problem",
    thumbnail_headline: "GEARS E-DAY PC TEST",
    first_spoken_line: "Gears of War E-Day just made its PC version a storage test.",
    narration_script:
      "Gears of War E-Day just made its PC version a storage test. The new requirements list a 130 GB SSD install, with RTX 2060-era hardware as the minimum floor. That is not shocking for a 2026 blockbuster, but it changes the real conversation. The catch is not just can my PC run it. It is what else gets deleted before launch night. For Xbox, the upside is clear: if E-Day looks this heavy because the campaign is dense, cinematic and technically serious, players will accept the size. If it feels bloated, that install number becomes the first complaint. Follow Pulse Gaming so you never miss a beat.",
    description:
      "PC Gamer reports Gears of War E-Day PC requirements list a 130 GB SSD install. Source: PC Gamer.",
    primary_source: "PC Gamer",
    source_card_label: "PC Gamer",
    confirmed_claims: [
      "PC Gamer reports Gears of War E-Day PC requirements list a 130 GB SSD install.",
      "The listed minimum GPU floor includes RTX 2060-era hardware.",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Gears E-Day Has A 130GB Problem",
        description:
          "PC Gamer reports Gears of War E-Day PC requirements list a 130 GB SSD install. Source: PC Gamer.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "fresh_gears_eday_pc_specs_20260616", artifact_dir: artifactDir }],
    generatedAt: "2026-06-18T10:15:00.000Z",
    forceQualityRewriteStoryIds: ["fresh_gears_eday_pc_specs_20260616"],
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const srt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);
  const mediaHouseScore = buildPulseMediaHouseScore({
    story_id: "fresh_gears_eday_pc_specs_20260616",
    canonical: updated,
    platformManifest,
  });

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  assert.equal(report.changed[0].public_copy_regeneration_pending, true);
  assert.match(updated.narration_script, /^Gears of War E-Day just turned PC specs into the story\./);
  assert.match(updated.narration_script, /E-Day has to make 130 GB feel like weight, not bloat\./);
  assert.doesNotMatch(
    platformManifest.outputs.youtube_shorts.description,
    /^PC Gamer reports Gears of War E-Day PC requirements list a 130 GB SSD install\. Source: PC Gamer\.$/,
  );
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:platform_copy_too_plain"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.match(srt, /RTX 2060-era/);
  assert.match(srt, /2026/);
  assert.deepEqual(workbench.jobs.map((job) => job.story_id), ["fresh_gears_eday_pc_specs_20260616"]);
  assert.deepEqual(renderWorkOrder.jobs.map((job) => job.story_id), ["fresh_gears_eday_pc_specs_20260616"]);
  assert.equal(renderWorkOrder.summary.ready_for_final_render_job_count, 1);
});

test("public copy repair can force a quality rewrite for Hellraiser release-date packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-hellraiser-quality-rewrite-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_cb82aef32f0c73e9",
    canonical_subject: "Hellraiser: Revival",
    canonical_game: "Hellraiser: Revival",
    canonical_title: "Hellraiser: Revival Gets A Date",
    selected_title: "Hellraiser: Revival Gets A Date",
    short_title: "Hellraiser: Revival Gets A Date",
    thumbnail_headline: "HELLRAISER: REVIVAL GETS A DATE",
    first_spoken_line: "Hellraiser: Revival Gets A Date.",
    narration_script:
      "Hellraiser: Revival Gets A Date. Eurogamer reports Hellraiser: Revival hooks a release date with trailer full of Doom-like glory kills and otherworldly powers. The catch is whether Hellraiser still has weight when the trailer stops jumping between money shots. Now players can see the pace, camera and combat instead of reading another announcement. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Eurogamer reports Hellraiser: Revival hooks a release date with trailer full of Doom-like glory kills and otherworldly powers. Source: Eurogamer.",
    primary_source: "Eurogamer",
    source_card_label: "Eurogamer",
    confirmed_claims: [
      "Hellraiser: Revival is set for October 8, 2026 on PS5, Xbox Series X/S and PC after a new trailer.",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Hellraiser: Revival Gets A Date",
        description:
          "Eurogamer reports Hellraiser: Revival hooks a release date with trailer full of Doom-like glory kills and otherworldly powers. Source: Eurogamer.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_cb82aef32f0c73e9", artifact_dir: artifactDir }],
    generatedAt: "2026-06-22T10:15:00.000Z",
    forceQualityRewriteStoryIds: ["rss_cb82aef32f0c73e9"],
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const srt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const workbench = buildAudioRegenerationWorkbench(report, {
    localTts: { ready: true, verdict: "green" },
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);
  const mediaHouseScore = buildPulseMediaHouseScore({
    story_id: "rss_cb82aef32f0c73e9",
    canonical: updated,
    platformManifest,
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(updated.selected_title, "Hellraiser: Revival's October Date Is A Risk");
  assert.equal(updated.first_spoken_line, "Hellraiser: Revival picked October 8, and that is brave for all the wrong reasons.");
  assert.match(updated.description, /October 8, 2026/);
  assert.match(updated.narration_script, /Genesis Configuration/);
  assert.match(updated.narration_script, /If the box power lands/);
  assert.match(updated.narration_script, /Xbox Series X and S/);
  assert.doesNotMatch(updated.narration_script, /X\/S/);
  assert.doesNotMatch(updated.narration_script, /judging whether Hellraiser can be nasty; they are judging whether/);
  assert.doesNotMatch(updated.narration_script, /^Hellraiser: Revival Gets A Date\./);
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.ok(savedScorecard.viral_score >= 85, JSON.stringify(savedScorecard, null, 2));
  assert.match(platformManifest.outputs.youtube_shorts.title, /October Date Is A Risk/);
  assert.match(platformManifest.outputs.youtube_shorts.description, /combat, puzzle box powers and Labyrinth chase/);
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:platform_title_too_plain"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:platform_copy_too_plain"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.match(srt, /October 8/);
  assert.match(srt, /Genesis Configuration/);
  assert.deepEqual(workbench.jobs.map((job) => job.story_id), ["rss_cb82aef32f0c73e9"]);
  assert.deepEqual(renderWorkOrder.jobs.map((job) => job.story_id), ["rss_cb82aef32f0c73e9"]);
  assert.equal(renderWorkOrder.summary.ready_for_final_render_job_count, 1);
});

test("public copy repair can force a quality rewrite for Doom PS5 Pro PSSR packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-doom-pssr-quality-rewrite-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_d574fecf8311b041",
    canonical_subject: "Doom: The Dark Ages",
    canonical_game: "Doom: The Dark Ages",
    canonical_title: "Doom The Dark Ages Becomes A PS5 Pro Test",
    selected_title: "Doom The Dark Ages Becomes A PS5 Pro Test",
    short_title: "Doom The Dark Ages Becomes A PS5 Pro Test",
    thumbnail_headline: "DOOM PS5 PRO",
    first_spoken_line: "Doom: The Dark Ages just became a PS5 Pro tech test.",
    narration_script:
      "Doom: The Dark Ages just became a PS5 Pro tech test. PlayStation Blog says upgraded PSSR is coming to Doom: The Dark Ages on PS5 Pro. That matters because image quality is where fast shooters either look premium or turn into blur once the arena gets loud. If the upgrade keeps Doom sharp in motion, PS5 Pro owners get a real showcase. If not, it is another spec-sheet promise. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Doom: The Dark Ages just became a PS5 Pro tech test. If not, it is another spec-sheet promise. Source: PlayStation Blog.",
    primary_source: "PlayStation Blog",
    source_card_label: "PlayStation Blog",
    confirmed_claims: [
      "Upgraded PSSR comes to Doom: The Dark Ages on PS5 Pro",
    ],
  }, { spaces: 2 });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4", "clip-c.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Doom The Dark Ages Becomes A PS5 Pro Test",
        description:
          "Doom: The Dark Ages just became a PS5 Pro tech test. If not, it is another spec-sheet promise. Source: PlayStation Blog.",
        cover_frame: { headline: "DOOM PS5 PRO" },
      },
      instagram_reels: {
        caption:
          "Doom: The Dark Ages just became a PS5 Pro tech test. If not, it is another spec-sheet promise. Source: PlayStation Blog.",
        cover_frame: { headline: "DOOM PS5 PRO" },
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_d574fecf8311b041", artifact_dir: artifactDir }],
    generatedAt: "2026-06-25T21:20:00.000Z",
    forceQualityRewriteStoryIds: ["rss_d574fecf8311b041"],
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const srt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const mediaHouseScore = buildPulseMediaHouseScore({
    story_id: "rss_d574fecf8311b041",
    canonical: updated,
    platformManifest,
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  assert.equal(updated.selected_title, "Doom The Dark Ages PS5 Pro Upgrade Risks Blur");
  assert.equal(updated.thumbnail_headline, "DOOM DARK AGES BLUR RISK");
  assert.match(updated.narration_script, /^Doom The Dark Ages has one PlayStation 5 Pro risk players will feel fast\./);
  assert.match(updated.narration_script, /readability when fire, steel and demons fill the arena/);
  assert.match(updated.narration_script, /sharper fights, or expensive blur/);
  assert.doesNotMatch(updated.narration_script, /^Doom: The Dark Ages/);
  assert.doesNotMatch(updated.narration_script, /tech test|spec-sheet promise|source-backed update/);
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.ok(savedScorecard.viral_score >= 90, JSON.stringify(savedScorecard, null, 2));
  assert.equal(platformManifest.outputs.youtube_shorts.title, "Doom The Dark Ages PS5 Pro Upgrade Risks Blur");
  assert.match(platformManifest.outputs.youtube_shorts.description, /fast arena combat/i);
  assert.equal(platformManifest.outputs.instagram_reels.cover_frame.headline, "DOOM DARK AGES BLUR RISK");
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:platform_copy_too_plain"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:shorts_feed_competition_weak"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.match(srt, /PlayStation 5 Pro/);
  assert.match(srt, /expensive blur/);
});

test("public copy repair syncs broad Doom game aliases without rewriting passing narration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-doom-canonical-sync-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  const script =
    "Doom The Dark Ages just made its next DLC about speed, not size. Xbox Wire says the Revelations update adds a Chain Spear built around fast movement. The risk is obvious: Doom gets worse when speed turns into unreadable effects spam. The question is whether this weapon pulls you into danger with control, or just throws more noise across the arena. If the Chain Spear sharpens that push-forward combat, lapsed players get a real reason to come back. If it is only a flashy tool, the novelty dies after the first fight. Follow Pulse Gaming so you never miss a beat.";
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_e2914175f30e0777",
    canonical_subject: "Doom: The Dark Ages",
    canonical_game: "DOOM",
    canonical_title: "Doom The Dark Ages Chain Spear Changes The Fight",
    selected_title: "Doom The Dark Ages Chain Spear Changes The Fight",
    short_title: "Doom The Dark Ages Chain Spear Changes The Fight",
    thumbnail_headline: "CHAIN SPEAR TEST",
    first_spoken_line: "Doom The Dark Ages just made its next DLC about speed, not size.",
    narration_hook: "Doom The Dark Ages just made its next DLC about speed, not size.",
    narration_script: script,
    tts_script: script,
    spoken_narration_script: script,
    description:
      "Doom The Dark Ages just made its next DLC about speed, not size. Xbox Wire says the Revelations update adds a Chain Spear built around fast movement. Source: Xbox Wire.",
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    confirmed_claims: ["DOOM: The Dark Ages Goes Supersonic With New DLC Chain Spear"],
  }, { spaces: 2 });
  await fs.outputJson(path.join(artifactDir, "script_scorecard.json"), buildViralScriptIntelligence({
    story: {
      id: "rss_e2914175f30e0777",
      title: "Doom The Dark Ages Chain Spear Changes The Fight",
      source_name: "Xbox Wire",
    },
    script,
  }), { spaces: 2 });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Doom The Dark Ages Chain Spear Changes The Fight",
        description:
          "Doom The Dark Ages just made its next DLC about speed, not size. Xbox Wire says the Revelations update adds a Chain Spear built around fast movement. Source: Xbox Wire.",
        cover_frame: { headline: "CHAIN SPEAR TEST" },
      },
      instagram_reels: {
        caption:
          "Doom The Dark Ages just made its next DLC about speed, not size. Xbox Wire says the Revelations update adds a Chain Spear built around fast movement. Source: Xbox Wire.",
        cover_frame: { headline: "CHAIN SPEAR TEST" },
      },
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_e2914175f30e0777", artifact_dir: artifactDir }],
    generatedAt: "2026-07-02T17:15:00.000Z",
  });

  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "canonical_entity_synced");
  assert.equal(updated.canonical_subject, "Doom: The Dark Ages");
  assert.equal(updated.canonical_game, "Doom: The Dark Ages");
  assert.equal(updated.narration_script, script);
  assert.equal(platformManifest.outputs.youtube_shorts.title, "Doom The Dark Ages Chain Spear Changes The Fight");
  assert.match(platformManifest.outputs.instagram_reels.caption, /Chain Spear/i);
});

test("public copy repair promotes Marvel Tokon roster packages from character-list subjects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-marvel-tokon-quality-rewrite-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_228f6f28b62f8426",
    canonical_subject: "Blade Loki Deadpool",
    canonical_game: "Blade Loki Deadpool",
    canonical_title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
    selected_title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
    short_title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
    thumbnail_headline: "BLADE LOKI DEADPOOL PLAYER TEST",
    first_spoken_line: "MARVEL Tokon just turned its roster reveal into a pressure test.",
    narration_script:
      "MARVEL Tokon just turned its roster reveal into a pressure test. PlayStation Blog says Blade, Loki and Deadpool are joining Fighting Souls. That matters because tag fighters live on team chemistry, not famous names. Players need matchups, assists and screen control that make each character feel dangerous for a different reason. If these three change how teams are built, Tokon gets a real meta argument. If they only look good in a trailer, the roster reveal fades fast. Follow Pulse Gaming so you never miss a beat.",
    description:
      "PlayStation Blog says Blade, Loki and Deadpool are joining Fighting Souls. If they only look good in a trailer, the roster reveal fades fast. Source: PlayStation Blog.",
    primary_source: "PlayStation Blog",
    source_card_label: "PlayStation Blog",
    primary_source_url:
      "https://blog.playstation.com/2026/06/28/blade-loki-deadpool-announced-for-marvel-tokon-fighting-souls/",
    confirmed_claims: [
      "Blade, Loki, Deadpool announced for MARVEL Tokon: Fighting Souls",
    ],
  }, { spaces: 2 });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4", "clip-c.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "MARVEL Tokon Turns Its Roster Into A Meta Fight",
        description:
          "PlayStation Blog says Blade, Loki and Deadpool are joining Fighting Souls. If they only look good in a trailer, the roster reveal fades fast. Source: PlayStation Blog.",
        cover_frame: { headline: "BLADE LOKI DEADPOOL PLAYER TEST" },
      },
      instagram_reels: {
        caption:
          "PlayStation Blog says Blade, Loki and Deadpool are joining Fighting Souls. If they only look good in a trailer, the roster reveal fades fast. Source: PlayStation Blog.",
        cover_frame: { headline: "BLADE LOKI DEADPOOL PLAYER TEST" },
        story_poll_idea: "Does Blade Loki Deadpool change your watchlist?",
      },
      x: {
        hot_take_post:
          "Blade Loki Deadpool just turned the roster reveal into a pressure test.",
        source_safe_post:
          "MARVEL Tokon Turns Its Roster Into A Meta Fight\n\nSource: PlayStation Blog.",
        poll_candidate: "Is Blade Loki Deadpool a buy-now story or a wait-for-reviews story?",
      },
    },
    platform_native_evidence: {
      schema_version: 1,
      verdict: "fail",
      platforms: [
        { platform: "youtube_shorts", status: "pass", copy_fingerprint: "old youtube" },
        { platform: "instagram_reels", status: "pass", copy_fingerprint: "old instagram" },
      ],
      failures: [
        { platform: "youtube_shorts", reason: "weak_cover_headline" },
        { platform: "instagram_reels", reason: "weak_cover_headline" },
      ],
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_228f6f28b62f8426", artifact_dir: artifactDir }],
    generatedAt: "2026-07-01T04:55:00.000Z",
    forceQualityRewriteStoryIds: ["rss_228f6f28b62f8426"],
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const srt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const mediaHouseScore = buildPulseMediaHouseScore({
    story_id: "rss_228f6f28b62f8426",
    canonical: updated,
    platformManifest,
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  assert.equal(updated.canonical_subject, "MARVEL Tokon");
  assert.equal(updated.canonical_game, "MARVEL Tokon");
  assert.equal(updated.selected_title, "MARVEL Tokon Just Started A Roster Fight");
  assert.equal(updated.thumbnail_headline, "MARVEL TOKON ROSTER FIGHT");
  assert.match(updated.first_spoken_line, /^MARVEL Tokon just turned Blade, Loki and Deadpool into a team-building test\./);
  assert.match(updated.narration_script, /tag fighters live or die on readable teams/i);
  assert.match(updated.narration_script, /assist chains/);
  assert.match(updated.narration_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.equal(updated.spoken_narration_script, updated.tts_script);
  assert.match(updated.spoken_narration_script, /changes team plans/);
  assert.doesNotMatch(updated.spoken_narration_script, /roster reveal into a pressure test/i);
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.match(platformManifest.outputs.youtube_shorts.description, /readable tag-fighter matchups/i);
  assert.equal(platformManifest.outputs.instagram_reels.cover_frame.headline, "MARVEL TOKON ROSTER FIGHT");
  assert.equal(
    platformManifest.outputs.instagram_reels.story_poll_idea,
    "Does MARVEL Tokon now look like a real roster fight?",
  );
  assert.equal(
    platformManifest.outputs.x.poll_candidate,
    "Does MARVEL Tokon now look like a real roster fight?",
  );
  assert.equal(
    platformManifest.platform_native_evidence.failures.some(
      (failure) => failure.reason === "weak_cover_headline",
    ),
    false,
    JSON.stringify(platformManifest.platform_native_evidence.failures),
  );
  assert.equal(
    platformManifest.platform_native_evidence.platform_native_evidence_refreshed_from_outputs,
    true,
  );
  assert.equal(
    evaluateGoalPublicCopy({ ...updated, platform_publish_manifest: platformManifest }).verdict,
    "pass",
  );
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:source_title_mismatch"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:platform_copy_too_plain"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:shorts_feed_competition_weak"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.match(srt, /MARVEL Tokon/);
  assert.doesNotMatch(srt, /Blade Loki Deadpool Player Test/i);
});

test("public copy repair can force a quality rewrite for Cyberpunk trust-debt packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-cyberpunk-quality-rewrite-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_4921d15c5d54b86d",
    canonical_subject: "Cyberpunk 2077",
    canonical_game: "Cyberpunk 2077",
    canonical_title: "Cyberpunk 2077's Trust Debt",
    selected_title: "Cyberpunk 2077's Trust Debt",
    short_title: "Cyberpunk 2077's Trust Debt",
    thumbnail_headline: "CYBERPUNK TRUST DEBT",
    first_spoken_line: "CD Projekt Red is still paying for Cyberpunk 2077's launch.",
    narration_script:
      "CD Projekt Red is still paying for Cyberpunk 2077's launch. PC Gamer reports a CD Projekt Red boss believes some players may have lost faith indefinitely after Cyberpunk 2077's disastrous release. The next thing to watch is whether the official follow-up gives players a clear date, platform detail or gameplay proof. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Cyberpunk 2077 has an expansion trust test now. The DLC sounds big, but players need to know whether the new zone feels worth returning for. Source: PC Gamer.",
    primary_source: "PC Gamer",
    source_card_label: "PC Gamer",
    primary_source_url:
      "https://www.pcgamer.com/games/rpg/cd-projekt-red-boss-believes-some-fans-were-forever-burned-by-cyberpunk-2077s-disastrous-launch-im-convinced-that-we-lost-the-faith-of-some-people-indefinitely/",
    confirmed_claims: [
      "PC Gamer reports CD Projekt Red boss believes some fans were forever burned by Cyberpunk 2077's disastrous launch: 'I'm convinced that we lost the faith of some people indefinitely'.",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Cyberpunk 2077's Trust Debt",
        description:
          "Cyberpunk 2077 has an expansion trust test now. Source: PC Gamer.",
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_4921d15c5d54b86d", artifact_dir: artifactDir }],
    generatedAt: "2026-06-22T11:00:00.000Z",
    forceQualityRewriteStoryIds: ["rss_4921d15c5d54b86d"],
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const copyQa = evaluateGoalPublicCopy(updated);

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  assert.equal(copyQa.verdict, "pass", copyQa.failures.join(", "));
  assert.equal(updated.first_spoken_line, "Cyberpunk 2077's biggest launch problem is not bugs anymore.");
  assert.match(updated.narration_script, /lost their faith indefinitely/);
  assert.match(updated.narration_script, /before trust comes back/);
  assert.match(updated.narration_script, /day one memory/);
  assert.match(updated.narration_script, /The risk is that a great trailer can still look suspicious/);
  assert.match(updated.narration_script, /If it promises too much again, Cyberpunk becomes the warning label/);
  assert.doesNotMatch(updated.narration_script, /The next thing to watch/i);
  assert.doesNotMatch(updated.narration_script, /before the hype does the talking|day-one|overpromises/);
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.warnings, [], JSON.stringify(savedScorecard, null, 2));
  assert.ok(savedScorecard.viral_score >= 85, JSON.stringify(savedScorecard, null, 2));
  assert.match(platformManifest.outputs.youtube_shorts.description, /warning label|trust test|recovery arc/i);
});

test("public copy repair can force a quality rewrite for Ghost at Dawn feed-competition packages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-ghost-at-dawn-quality-rewrite-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_ba849c6ab11e475c",
    canonical_subject: "Ghost at Dawn",
    canonical_game: "Ghost at Dawn",
    canonical_title: "Ghost at Dawn Has A Jump-Scare Risk",
    selected_title: "Ghost at Dawn Has A Jump-Scare Risk",
    short_title: "Ghost at Dawn Has A Jump-Scare Risk",
    title_candidates: [
      "Ghost At Dawn Turns Fear Into A Choice",
      "Ghost at Dawn is about Fear, Empathy, and Questionable Choices",
    ],
    thumbnail_headline: "GHOST AT DAWN JUMP SCARE RISK",
    first_spoken_line: "Ghost at Dawn is selling horror on something more interesting than jump scares.",
    narration_script:
      "Ghost at Dawn is selling horror on something more interesting than jump scares. Xbox Wire says the game is built around fear, empathy and questionable choices. Players have to decide whether those choices feel personal, because horror games are easy to market with monsters and much harder to make memorable with regret. If those choices actually change how the story feels, Ghost at Dawn has a hook. If not, it risks becoming another eerie trailer with no bite. Follow Pulse Gaming so you never miss a beat.",
    description:
      "Ghost at Dawn is selling horror without leaning on jump scares. Players have to judge whether the choices feel personal, because atmosphere matters more than monsters here. Source: Xbox Wire.",
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/2026/06/19/ghost-at-dawn-is-about-fear-empathy/",
    confirmed_claims: [
      "Ghost at Dawn is about Fear, Empathy, and Questionable Choices",
    ],
  });
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: ["clip-a.mp4", "clip-b.mp4"],
  });
  await fs.outputJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Ghost at Dawn Has A Jump-Scare Risk",
        description:
          "Ghost at Dawn is selling horror without leaning on jump scares. Players have to judge whether the choices feel personal, because atmosphere matters more than monsters here. Source: Xbox Wire.",
        cover_frame: { headline: "GHOST AT DAWN JUMP SCARE RISK" },
      },
      instagram_reels: {
        caption:
          "Ghost at Dawn is selling horror without leaning on jump scares. Players have to judge whether the choices feel personal, because atmosphere matters more than monsters here. Source: Xbox Wire.",
        cover_frame: { headline: "GHOST AT DAWN JUMP SCARE RISK" },
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_ba849c6ab11e475c", artifact_dir: artifactDir }],
    generatedAt: "2026-06-22T11:15:00.000Z",
    forceQualityRewriteStoryIds: ["rss_ba849c6ab11e475c"],
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");

  const srt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const workbench = buildAudioRegenerationWorkbench(report, {
    elevenlabsTts: { ready: true, verdict: "green" },
    providerPreference: "elevenlabs",
  });
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);
  const mediaHouseScore = buildPulseMediaHouseScore({
    story_id: "rss_ba849c6ab11e475c",
    canonical: updated,
    platformManifest,
  });

  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(updated.selected_title, "Ghost at Dawn Turns Choices Into Horror");
  assert.equal(updated.title, "Ghost at Dawn Turns Choices Into Horror");
  assert.equal(updated.public_title, "Ghost at Dawn Turns Choices Into Horror");
  assert.equal(updated.thumbnail_headline, "GHOST CHOICES RISK");
  assert.equal(updated.suggested_thumbnail_text, "GHOST CHOICES RISK");
  assert.equal(updated.first_frame_text, "GHOST CHOICES RISK");
  assert.equal(updated.first_spoken_line, "Ghost at Dawn is trying to make player choices scarier than jump scares.");
  assert.match(updated.description, /trailer is selling horror through player choices/i);
  assert.match(updated.description, /campaign memorable/i);
  assert.match(updated.narration_script, /fear, empathy and questionable choices/i);
  assert.match(updated.narration_script, /If that lands, it sticks/i);
  assert.doesNotMatch(updated.narration_script, /the horror becomes personal|choices barely matter|personal horror is the payoff|scare follows players/i);
  assert.doesNotMatch(updated.narration_script, /has a hook|eerie trailer with no bite/i);
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.match(platformManifest.outputs.youtube_shorts.title, /Choices Into Horror/);
  assert.match(platformManifest.outputs.youtube_shorts.description, /player choices/i);
  assert.equal(platformManifest.outputs.youtube_shorts.cover_frame.headline, "GHOST CHOICES RISK");
  assert.ok(
    ["pass", "standout"].includes(mediaHouseScore.shorts_feed_competition_report.status),
    mediaHouseScore.shorts_feed_competition_report.status,
  );
  assert.deepEqual(mediaHouseScore.shorts_feed_competition_report.blockers, []);
  assert.ok(
    !mediaHouseScore.hard_failures.includes("media_house:shorts_feed_competition_weak"),
    mediaHouseScore.hard_failures.join(", "),
  );
  assert.match(srt, /player choices/);
  assert.deepEqual(workbench.jobs.map((job) => job.tts_provider), ["elevenlabs"]);
  assert.deepEqual(renderWorkOrder.jobs.map((job) => job.story_id), ["rss_ba849c6ab11e475c"]);
  assert.equal(renderWorkOrder.summary.ready_for_final_render_job_count, 1);
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

test("public copy repair gives GTA subscription stories a specific debate payoff instead of generic filler", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "gta-subscription",
      canonical_subject: "GTA 5",
      canonical_game: "GTA 5",
      canonical_title: "GTA 5 joins subscription service ahead of GTA 6 launch",
      primary_source_url: "https://www.gamespot.com/articles/gta-5-joins-a-subscription-ahead-of-gta-6-launch/",
      selected_title: "GTA 5 Became The GTA 6 Waiting Room",
      first_spoken_line: "GTA 5 just became the GTA 6 waiting room.",
      primary_source: "GameSpot",
      description: "GTA 5 has joined a subscription service ahead of GTA 6. Source: GameSpot.",
      confirmed_claims: [
        "GTA 5 has joined a subscription service ahead of GTA 6.",
      ],
    },
    { generatedAt: "2026-06-12T19:40:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.match(script, /^GTA 5 just became the GTA 6 waiting room\./);
  assert.match(script, /GameSpot says GTA 5 has joined a subscription service ahead of GTA 6/);
  assert.match(script, /subscription access can vanish/i);
  assert.match(script, /warm-up act for GTA 6/i);
  assert.doesNotMatch(script, /concrete next step|background noise|vague update/i);
  assert.equal((script.match(/Follow Pulse Gaming so you never miss a beat/g) || []).length, 1);
  assert.ok(script.split(/\s+/).length >= 95);
  assert.ok(script.split(/\s+/).length <= 130);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  assert.equal(runScriptCoherenceQa(repaired.manifest).result, "pass");
});

test("public copy repair gives Valor Mortis release-window stories a player-stakes payoff", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "valor-mortis-delay",
      canonical_subject: "Valor Mortis",
      canonical_game: "Valor Mortis",
      canonical_title: "September Is So Busy For Games That One Of Them Just Got Delayed To Avoid The Others And GTA 6",
      primary_source_url: "https://www.gamespot.com/articles/september-is-so-busy-for-games-that-one-of-them-just-got-delayed-to-avoid-the-others-and-gta-6/",
      selected_title: "Valor Mortis Just Dodged September",
      first_spoken_line: "Valor Mortis just admitted the release calendar is part of the boss fight.",
      primary_source: "GameSpot",
      description: "Valor Mortis moved from September 24 to October 13. Source: GameSpot.",
      confirmed_claims: [
        "One More Level moved Valor Mortis from September 24 to October 13 after September became a crowded release window.",
      ],
    },
    { generatedAt: "2026-06-12T20:38:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.match(script, /^Valor Mortis just did something smarter than pretending September is empty\./);
  assert.match(script, /moved it from September 24 to October 13/i);
  assert.match(script, /good games can die if they pick the wrong week/i);
  assert.match(script, /backlog guilt/i);
  assert.match(script, /how many smaller games are about to get buried/i);
  assert.doesNotMatch(script, /part of the boss fight|concrete next step|source-backed update/i);
  assert.equal((script.match(/Follow Pulse Gaming so you never miss a beat/g) || []).length, 1);
  assert.ok(script.split(/\s+/).length >= 95);
  assert.ok(script.split(/\s+/).length <= 130);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  assert.equal(runScriptCoherenceQa(repaired.manifest).result, "pass");
});

test("public copy repair does not generate source-neutral catch filler for generic launch stories", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "crimson-desert-launch",
      canonical_subject: "Crimson Desert",
      canonical_game: "Crimson Desert",
      canonical_title: "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing",
      selected_title: "Crimson Desert Is Already Live",
      first_spoken_line: "Crimson Desert is past the trailer hype, and the risk is the real build.",
      primary_source: "GameSpot",
      description: "Crimson Desert launched on March 19, 2026. Source: GameSpot.",
      confirmed_claims: [
        "Crimson Desert launched on March 19, 2026 after Pearl Abyss announced the launch timing.",
      ],
    },
    { generatedAt: "2026-06-15T02:10:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.doesNotMatch(script, /concrete next step|just another vague update/i);
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "crimson-desert-launch",
      title: repaired.manifest.selected_title,
      source_name: "GameSpot",
    },
    script,
  });
  assert.ok(!scorecard.blockers.includes("source_neutral_catch_template"), JSON.stringify(scorecard, null, 2));
});

test("public copy repair paraphrases review headline recitations before narration QA", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "forza-review-headline",
      canonical_subject: "Forza Horizon 6",
      canonical_game: "Forza Horizon 6",
      canonical_title: "Forza Horizon 6 review (PC Gamer: 84/100)",
      selected_title: "Forza Horizon 6 Scores 84 On PC Gamer",
      first_spoken_line: "Forza Horizon 6 just landed strong reviews, but launch demand is the harder test.",
      primary_source: "PC Gamer",
      description: "Forza Horizon 6 review (PC Gamer: 84/100). Source: PC Gamer.",
      confirmed_claims: ["Forza Horizon 6 review (PC Gamer: 84/100)."],
    },
    { generatedAt: "2026-06-15T02:10:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.doesNotMatch(script, /PC Gamer reports Forza Horizon 6 review \(PC Gamer/i);
  assert.ok((script.match(/\bthe catch is\b/gi) || []).length <= 1, script);
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "forza-review-headline",
      title: repaired.manifest.selected_title,
      source_name: "PC Gamer",
    },
    script,
  });
  assert.ok(!scorecard.blockers.includes("source_title_recitation"), JSON.stringify(scorecard, null, 2));
  assert.ok(!scorecard.blockers.includes("repeated_catch_pivot"), JSON.stringify(scorecard, null, 2));
});

test("public copy repair rewrites Halo remake stories into concrete mission-led scripts", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "halo-remake-demo",
      canonical_subject: "Halo: Campaign Evolved",
      canonical_game: "Halo: Campaign Evolved",
      selected_title: "Halo: Campaign Evolved Shows The Real Remake Test",
      primary_source: "Xbox Wire",
      primary_source_url:
        "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
      confirmed_claims: [
        "Xbox Wire says Halo Studios showed Assault on the Control Room in hands-on demo form.",
        "Xbox Wire says the remake launches globally on July 28, 2026 with early access on July 23 for Premium Edition owners.",
        "Xbox Wire says the game supports cross-play and cross-progression across Xbox Series X|S, Windows PC, Steam and PlayStation 5.",
      ],
    },
    { generatedAt: "2026-06-15T02:30:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.match(script, /^Halo's remake has one brutal test: Assault on the Control Room\./);
  assert.match(script, /tanks, Marines, Banshees, Covenant pressure and long Forerunner routes/i);
  assert.doesNotMatch(script, /real remake test|changes what players buy|background noise|the hook here is|the signal is/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "halo-remake-demo",
      title: repaired.manifest.selected_title,
      source_name: "Xbox Wire",
    },
    script,
  });
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.ok(scorecard.viral_score >= 85, JSON.stringify(scorecard.scores));
});

test("public copy repair preserves Halo Campaign Evolved PS5 account-catch angle", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "halo-ps5-account-catch",
      canonical_subject: "Halo: Campaign Evolved",
      canonical_game: "Halo: Campaign Evolved",
      selected_title: "Halo's PS5 Account Catch",
      primary_source: "Eurogamer",
      primary_source_url:
        "https://www.eurogamer.net/halo-campaign-evolved-on-playstation-requires-an-xbox-account",
      description:
        "Halo: Campaign Evolved on PS5 now has an Xbox account catch. Check it before you buy, because one extra sign-in can turn split-screen co-op from an easy nostalgia play into setup friction. Source: Eurogamer.",
      confirmed_claims: [
        "Eurogamer reports Halo: Campaign Evolved PS5 players will need an Xbox account and gamertag.",
        "Eurogamer reports PS Plus is needed for split-screen co-op.",
      ],
    },
    { generatedAt: "2026-06-23T03:20:00.000Z", forceNarrationRewrite: true },
  );

  const script = repaired.manifest.narration_script;
  assert.equal(
    repaired.manifest.selected_title,
    "Halo Campaign Evolved Has A PS5 Account Catch",
  );
  assert.equal(repaired.manifest.thumbnail_headline, "HALO PS5 ACCOUNT CATCH");
  assert.match(script, /^Halo: Campaign Evolved on PS5 has a real catch: an Xbox account\./);
  assert.match(script, /Xbox account and gamertag/i);
  assert.match(script, /PS Plus for split-screen co-op/i);
  assert.doesNotMatch(script, /useful bit is simple/i);
  assert.doesNotMatch(script, /between the two/i);
  assert.doesNotMatch(script, /Assault on the Control Room|snowy mission|Banshees/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "halo-ps5-account-catch",
      title: repaired.manifest.selected_title,
      source_name: "Eurogamer",
    },
    script,
  });
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.ok(scorecard.viral_score >= 85, JSON.stringify(scorecard.scores));
});

test("public copy repair rewrites Gears E-Day headline recaps into player-stakes scripts", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "gears-e-day-recap",
      canonical_subject: "Gears of War: E-Day",
      canonical_game: "Gears of War: E-Day",
      canonical_title: "Everything We Know About Gears Of War: E-Day, Xbox's Big Exclusive For 2026",
      selected_title: "Gears Of War: E-Day Just Got A New Signal",
      primary_source: "Kotaku",
      confirmed_claims: [
        "Everything We Know About Gears Of War: E-Day, Xbox's Big Exclusive For 2026",
      ],
    },
    { generatedAt: "2026-06-15T02:31:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.equal(repaired.manifest.selected_title, "Gears E-Day Has To Make Xbox Feel Dangerous");
  assert.match(script, /^Gears of War: E-Day has to make Xbox's safest exclusive feel dangerous again\./);
  assert.match(script, /old Gears fans need to feel that fear before release/i);
  assert.doesNotMatch(script, /Everything We Know|Just Got A New Signal|changes what players buy|background noise/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "gears-e-day-recap",
      title: repaired.manifest.selected_title,
      source_name: "Kotaku",
    },
    script,
  });
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
});

test("public copy repair rewrites Mina spoiler-interview recaps into payoff-led scripts", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "mina-spoiler-interview",
      canonical_subject: "Mina the Hollower",
      canonical_game: "Mina the Hollower",
      canonical_title: "Mina The Hollower Spoiler Interview: Sequel Talk, Chrono Trigger Homages, And That Ending",
      selected_title: "Mina The Hollower Ending Points At The Sequel Risk",
      primary_source: "GameSpot",
      confirmed_claims: [
        "Mina The Hollower Spoiler Interview: Sequel Talk, Chrono Trigger Homages, And That Ending",
      ],
    },
    { generatedAt: "2026-06-15T02:32:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.match(script, /^Mina the Hollower's ending is already doing sequel work\./);
  assert.match(script, /Yacht Club has something rarer than nostalgia/i);
  assert.doesNotMatch(script, /Spoiler Interview|changes what players buy|talent squeeze|background noise/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "mina-spoiler-interview",
      title: repaired.manifest.selected_title,
      source_name: "GameSpot",
    },
    script,
  });
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
});

test("public copy repair rewrites Quake update recaps into retention-stakes scripts", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "quake-update",
      canonical_subject: "Quake Champions",
      canonical_game: "Quake Champions",
      canonical_title: "Quake Champions gets a huge update and free battle pass to celebrate the anniversary",
      selected_title: "Quake Champions gets a huge update and free battle pass to celebrate the",
      primary_source: "PC Gamer",
      confirmed_claims: [
        "Quake Champions gets a huge update and free battle pass to celebrate the anniversary.",
      ],
    },
    { generatedAt: "2026-06-15T02:33:00.000Z" },
  );

  const script = repaired.manifest.narration_script;
  assert.equal(repaired.manifest.selected_title, "Quake Champions Tests A Real Comeback");
  assert.match(script, /^Quake Champions just put its comeback claim on trial\./);
  assert.match(script, /queue health, netcode and whether the fights still feel brutally fair/i);
  assert.doesNotMatch(script, /changes what players buy|background noise|gets a huge update and free battle pass to celebrate the\./i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "quake-update",
      title: repaired.manifest.selected_title,
      source_name: "PC Gamer",
    },
    script,
  });
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
});

test("public copy repair rewrites Robo-Ky release moves into player-stakes scripts", () => {
  const repaired = repairGoalPublicCopyManifest(
    {
      story_id: "robo-ky-release-move",
      canonical_subject: "GUILTY GEAR -STRIVE- Robo-Ky Official",
      canonical_game: "GUILTY GEAR -STRIVE-",
      canonical_title: "GUILTY GEAR -STRIVE- Robo-Ky Official Just Dodged A Release-Date Fight",
      selected_title: "GUILTY GEAR -STRIVE- Robo-Ky Official Just Dodged A Release-Date Fight",
      primary_source: "GameSpot",
      confirmed_claims: [
        "GameSpot is carrying new GUILTY GEAR -STRIVE- Robo-Ky footage after the character moved away from the crowded release calendar.",
      ],
    },
    { generatedAt: "2026-06-28T18:40:00.000Z", forceNarrationRewrite: true },
  );

  const script = repaired.manifest.narration_script;
  assert.equal(repaired.manifest.canonical_subject, "Robo-Ky");
  assert.equal(repaired.manifest.selected_title, "Robo-Ky Delay Puts Guilty Gear On Trial");
  assert.equal(repaired.manifest.thumbnail_headline, "ROBO-KY DELAY TEST");
  assert.match(script, /^Robo-Ky just turned Guilty Gear Strive into a release-date argument\./);
  assert.match(script, /lab time, matchup practice and a clean first weekend/i);
  assert.match(script, /whether the delay means polish/i);
  assert.match(script, /balanced, readable and ridiculous/i);
  assert.doesNotMatch(script, /mood instead of play|part players can actually judge|source-backed update/i);
  assert.equal(evaluateGoalPublicCopy(repaired.manifest).verdict, "pass");
  const scorecard = buildViralScriptIntelligence({
    story: {
      id: "robo-ky-release-move",
      title: repaired.manifest.selected_title,
      source_name: "GameSpot",
    },
    script,
  });
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.ok(scorecard.viral_score >= 85, JSON.stringify(scorecard.scores));
  assert.ok(scorecard.scores.curiosity_gap >= 70, JSON.stringify(scorecard.scores));
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

test("public copy package repair creates missing script scorecards before scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-missing-scorecard-"));
  const artifactDir = path.join(root, "batch", "gta6");
  await fs.ensureDir(artifactDir);
  const script =
    "GTA 6 preorders just became a real buying decision. GameSpot reports Rockstar has confirmed GTA 6 preorders launch on June 25, while players still wait for editions, bonuses and price details. That matters because the preorder page is where hype becomes a wallet choice, not just another trailer conversation. The first store details can reveal which platforms Rockstar is pushing hardest, what extras are being used to tempt early buyers and how much the preorder premium version costs. A preorder date does not prove new gameplay is coming that day, and it does not mean every version will be worth buying. Separate the confirmed preorder timing from the missing price details, bonus details and platform details before locking money in. That is also where impulse buying gets risky, because a preorder button can arrive before the clearest value comparison does. The question is not whether GTA 6 will be huge; it is which version actually makes sense to buy first. If the store page lands cleanly, GTA 6 finally shifts from anticipation into the first real buy, wait or skip argument. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "gta6-scorecard",
    canonical_subject: "GTA 6",
    canonical_game: "GTA 6",
    selected_title: "GTA 6 Preorders Have A Price Risk",
    short_title: "GTA 6 Preorders Have A Price Risk",
    first_spoken_line: "GTA 6 preorders just became a real buying decision.",
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
    confirmed_claims: [
      "GameSpot reports Rockstar has confirmed GTA 6 preorders launch on June 25.",
    ],
    narration_script: script,
    full_script: script,
    tts_script: script,
    description:
      "GTA 6 preorders start June 25, but players still need the price, editions and bonuses before locking money in. Source: GameSpot.",
    thumbnail_headline: "GTA 6 PRICE RISK",
    thumbnail_text: "GTA 6 PRICE RISK",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "GTA 6 Preorders Have A Price Risk",
        description:
          "GTA 6 preorders start June 25, but players still need the price, editions and bonuses before locking money in. Source: GameSpot.",
      },
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "gta6-scorecard", artifact_dir: artifactDir }],
    generatedAt: "2026-06-22T17:40:00.000Z",
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "script_scorecard_refreshed");
  assert.equal(report.changed[0].public_copy_regeneration_pending, false);
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.ok(savedScorecard.viral_score >= 75, JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair preserves a market-ready script instead of replacing it with a thin fallback", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-no-thin-fallback-"));
  const artifactDir = path.join(root, "batch", "paleo-pines");
  await fs.ensureDir(artifactDir);
  const script =
    "Paleo Pines just fixed one of its most exhausting hunts. The free Players' Choice update adds a skin tracker that lets you target one dinosaur colour and pattern. When that rarity next spawns, the game guarantees the combination you chose. A blind grind now has an actual finish line. Saddlebags let large dinosaurs carry up to four items. Small dinosaurs can collect wild resources and finally help with composters around the ranch. There are new crops, recipes and decorations too, plus a compass and automatic inventory sorting. For players who love rare dinos but hate wasting whole evenings on random spawns, that is a huge quality-of-life win. But it also creates the argument: does a guaranteed target respect your time, or make the rarest dinosaurs feel less special? If the tracker saves hours without flattening the hunt, it turns rare dinos into a goal instead of a lottery. Follow Pulse Gaming so you never miss a beat.";
  const manifest = {
    story_id: "paleo-pines-no-thin-fallback",
    canonical_subject: "Paleo Pines",
    canonical_game: "Paleo Pines",
    selected_title: "Paleo Pines Just Ended Its Worst Dinosaur Grind",
    short_title: "Paleo Pines Just Ended Its Worst Dinosaur Grind",
    first_spoken_line: "Paleo Pines just fixed one of its most exhausting hunts.",
    primary_source: "PlayStation Blog",
    confirmed_claims: ["Paleo Pines received the free Players' Choice update on July 13, 2026."],
    narration_script: script,
    full_script: script,
    tts_script: script,
    description: "Paleo Pines now guarantees a chosen rare dinosaur skin combination. Source: PlayStation Blog.",
    thumbnail_headline: "RARE DINO, GUARANTEED",
    thumbnail_text: "RARE DINO, GUARANTEED",
    public_copy_repaired_at: "2026-07-13T19:59:00.000Z",
  };
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), manifest, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), {
    result: "pass",
    failures: [],
    blockers: [],
    generated_at: "2026-07-13T19:30:00.000Z",
    manifest: {
      ...manifest,
      narration_script:
        "Paleo Pines has one detail worth checking before it becomes background noise. Follow Pulse Gaming so you never miss a beat.",
      full_script:
        "Paleo Pines has one detail worth checking before it becomes background noise. Follow Pulse Gaming so you never miss a beat.",
      tts_script:
        "Paleo Pines has one detail worth checking before it becomes background noise. Follow Pulse Gaming so you never miss a beat.",
      public_copy_repaired_at: "2026-07-13T19:20:00.000Z",
    },
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: manifest.selected_title,
        description: manifest.description,
      },
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: manifest.story_id, artifact_dir: artifactDir }],
    generatedAt: "2026-07-13T20:00:00.000Z",
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.summary.blocked_count, 0, JSON.stringify(report, null, 2));
  const saved = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(saved.narration_script, script);
  const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(scorecard.verdict, "viral_ready", JSON.stringify(scorecard, null, 2));
  assert.deepEqual(scorecard.blockers, [], JSON.stringify(scorecard, null, 2));
});

test("public copy repair keeps The Mound thumbnail subject anchored without repeating the title", () => {
  const script =
    "The Mound has found a nastier co-op enemy: the friend who swears they saw something. Launching July 15, this horror game sends a team into a cursed jungle where its madness system distorts what players see and hear. One person calls out movement. Nobody else sees it. Do you trust them, spend resources checking, or assume the game is inside their head? That uncertainty could create stories scripted jump scares cannot. A bad call splits the team. A real warning gets ignored. Voice chat becomes part of the horror. But randomness is the danger. If hallucinations feel arbitrary, players tune them out. If they arrive at the right moment, The Mound turns trust itself into the monster. Follow Pulse Gaming so you never miss a beat.";
  const repaired = repairGoalPublicCopyManifest({
    story_id: "the-mound-thumbnail",
    canonical_subject: "The Mound: Omen of Cthulhu",
    canonical_game: "The Mound: Omen of Cthulhu",
    selected_title: "The Mound Makes Your Own Co-op Team The Threat",
    short_title: "The Mound Makes Your Own Co-op Team The Threat",
    first_spoken_line: "The Mound has found a nastier co-op enemy: the friend who swears they saw something.",
    primary_source: "Xbox Wire",
    confirmed_claims: ["The Mound: Omen of Cthulhu launches on July 15."],
    narration_script: script,
    full_script: script,
    tts_script: script,
    description: "The Mound turns conflicting co-op hallucinations into the real threat. Source: Xbox Wire.",
    thumbnail_headline: "THE MOUND: TRUST NO ONE",
    thumbnail_text: "THE MOUND: TRUST NO ONE",
  });

  assert.equal(repaired.after.verdict, "pass", JSON.stringify(repaired.after, null, 2));
  assert.equal(repaired.manifest.thumbnail_headline, "THE MOUND: TRUST NO ONE");
  assert.equal(repaired.manifest.narration_script, script);
});

test("public copy package repair rewrites GTA 5 free upgrade stories into viral-ready owner payoff", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-gta5-upgrade-"));
  const artifactDir = path.join(root, "batch", "gta5-upgrade");
  await fs.ensureDir(artifactDir);
  const weakScript =
    "GTA 5 has a free upgrade catch. GameSpot reports digital PS4 and Xbox One owners can claim the PS5 and Xbox Series X/S version from June 18. That matters because it is a useful player-facing update. Players should check the details before paying again. Comment what you think. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "gta5-free-upgrade",
    canonical_subject: "GTA 5",
    canonical_game: "GTA 5",
    selected_title: "GTA 5 Has A Free Upgrade Catch",
    short_title: "GTA 5 Has A Free Upgrade Catch",
    first_spoken_line: "GTA 5 has a free upgrade catch.",
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
    confirmed_claims: [
      "GameSpot reports digital PS4 and Xbox One owners can claim the PS5 and Xbox Series X/S version from June 18.",
    ],
    narration_script: weakScript,
    full_script: weakScript,
    tts_script: weakScript,
    description:
      "GTA 5 just turned a paid current-gen upgrade into a free claim for eligible PS4 and Xbox One owners. Source: GameSpot.",
    thumbnail_headline: "GTA 5 FREE UPGRADE",
    thumbnail_text: "GTA 5 FREE UPGRADE",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "GTA 5 Has A Free Upgrade Catch",
        description:
          "GTA 5 just turned a paid current-gen upgrade into a free claim for eligible PS4 and Xbox One owners. Source: GameSpot.",
      },
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "gta5-free-upgrade", artifact_dir: artifactDir }],
    generatedAt: "2026-06-23T02:30:00.000Z",
    forceQualityRewriteStoryIds: ["gta5-free-upgrade"],
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  assert.equal(report.changed[0].public_copy_regeneration_pending, true);
  const repairedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(repairedManifest.thumbnail_headline, "GTA 5 FREE UPGRADE");
  assert.equal(repairedManifest.thumbnail_text, "GTA 5 FREE UPGRADE");
  assert.match(repairedManifest.narration_script, /retention play instead of a simple gift/);
  assert.doesNotMatch(repairedManifest.narration_script, /\bGTA\s*6\b/i);
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.equal(savedScorecard.viral_score >= 85, true, JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.warnings, [], JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair keeps GTA preorder platform copy out of deal filler", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-gta-platform-"));
  const artifactDir = path.join(root, "batch", "gta6-platform");
  await fs.ensureDir(artifactDir);
  const script =
    "GTA 6 preorders just became a real buying decision. GameSpot reports Rockstar confirmed GTA 6 preorders begin on June 25, while price, editions and bonuses still need checking. The risk is not whether GTA 6 will be huge; it is whether the first store page makes the value clear. Price, editions and bonuses decide whether fans buy early, wait or argue about the premium version. That turns the first store page into a real buy, wait or skip argument. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "gta6-platform",
    canonical_subject: "GTA 6",
    canonical_game: "GTA 6",
    selected_title: "GTA 6 Preorders Have A Price Risk",
    short_title: "GTA 6 Preorders Have A Price Risk",
    first_spoken_line: "GTA 6 preorders just became a real buying decision.",
    primary_source: "GameSpot",
    source_card_label: "GameSpot",
    confirmed_claims: [
      "GameSpot reports Rockstar confirmed GTA 6 preorders begin on June 25.",
    ],
    narration_script: script,
    full_script: script,
    tts_script: script,
    description:
      "GTA 6 preorders start June 25, but players still need the price, editions and bonuses before locking money in. That turns hype into a buy, wait or skip decision. Source: GameSpot.",
    thumbnail_headline: "GTA 6 PRICE RISK",
    thumbnail_text: "GTA 6 PRICE RISK",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 90,
    blockers: [],
    warnings: [],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "GTA 6: source_locked_update",
        description: "GTA 6: source_locked_update. Source: GameSpot.",
      },
      instagram_reels: {
        caption: "GTA 6: source_locked_update. Source: GameSpot.",
      },
      facebook_reels: {
        page_caption: "GTA 6: source_locked_update. Source: GameSpot.",
      },
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "gta6-platform", artifact_dir: artifactDir }],
    generatedAt: "2026-06-22T17:45:00.000Z",
  });

  assert.equal(report.changed[0].status, "platform_pack_synced", JSON.stringify(report, null, 2));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const platformCopy = JSON.stringify(platformManifest.outputs);
  assert.match(platformManifest.outputs.youtube_shorts.description, /price, editions and bonuses decide/i);
  assert.doesNotMatch(platformCopy, /saving|deal|discount|source_locked_update/i);
});

test("public copy package repair force-rewrites GTA VI cover art packages into a publishable rerender lane", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-gta-cover-quality-"));
  const artifactDir = path.join(root, "batch", "gta-vi-cover");
  await fs.ensureDir(artifactDir);
  const staleScript =
    "Grand Theft Auto VI Cover Art Revealed. Xbox Wire says Grand Theft Auto VI has new cover art and preorders start soon. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "rss_b36937ce024ac02b",
    canonical_subject: "GTA VI",
    canonical_game: "GTA VI",
    selected_title: "Grand Theft Auto VI Cover Art Revealed",
    short_title: "Grand Theft Auto VI Cover Art Revealed",
    first_spoken_line: "Grand Theft Auto VI Cover Art Revealed.",
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    official_source: "Rockstar",
    confirmed_claims: [
      "Xbox Wire says Grand Theft Auto VI pre-orders open on June 25 after Rockstar revealed new Jason and Lucia cover art.",
    ],
    narration_script: staleScript,
    full_script: staleScript,
    tts_script: staleScript,
    description:
      "Xbox Wire says GTA VI pre-orders open on June 25 after Rockstar revealed new Jason and Lucia cover art. Source: Xbox Wire.",
    thumbnail_headline: "GTA VI COVER ART",
    thumbnail_text: "GTA VI COVER ART",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    viral_score: 58,
    blockers: ["weak_hook_repeats_headline"],
    warnings: [],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: "Grand Theft Auto VI Cover Art Revealed",
        description:
          "Xbox Wire says GTA VI pre-orders open on June 25 after Rockstar revealed new Jason and Lucia cover art. Source: Xbox Wire.",
      },
      instagram_reels: {
        caption:
          "Xbox Wire says GTA VI pre-orders open on June 25 after Rockstar revealed new Jason and Lucia cover art. Source: Xbox Wire.",
      },
      facebook_reels: {
        page_caption:
          "Xbox Wire says GTA VI pre-orders open on June 25 after Rockstar revealed new Jason and Lucia cover art. Source: Xbox Wire.",
      },
    },
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: [
      { local_materialized_path: "C:\\clips\\gta-vi-cover-1.mp4", materialized: true, validated: true, counts_towards_motion_readiness: true },
      { local_materialized_path: "C:\\clips\\gta-vi-cover-2.mp4", materialized: true, validated: true, counts_towards_motion_readiness: true },
    ],
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_b36937ce024ac02b", artifact_dir: artifactDir }],
    generatedAt: "2026-06-26T03:15:00.000Z",
    forceQualityRewriteStoryIds: ["rss_b36937ce024ac02b"],
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "quality_rewrite_pending_audio_rerender");
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));
  const renderWorkOrder = await buildProductionRerenderWorkOrder(report);

  assert.match(updated.selected_title, /GTA VI/i);
  assert.equal(updated.thumbnail_headline, "GTA VI PREORDER FIGHT");
  assert.equal(updated.thumbnail_text, "GTA VI PREORDER FIGHT");
  assert.doesNotMatch(updated.narration_script, /^Grand Theft Auto VI Cover Art Revealed\./);
  assert.match(updated.narration_script, /Jason and Lucia/i);
  assert.match(updated.narration_script, /June 25/i);
  assert.match(
    updated.narration_script,
    /^Rockstar's next Grand Theft Auto just made pre-orders a trust test\./,
  );
  assert.doesNotMatch(
    updated.narration_script.split(/\s+/).slice(0, 12).join(" "),
    /\b(?:GTA\s+VI|GTA\s+6|Grand Theft Auto VI|Grand Theft Auto six)\b/i,
  );
  assert.doesNotMatch(updated.narration_script, /^Grand Theft Auto VI\b/);
  assert.match(updated.narration_script, /store page is the test/i);
  assert.match(updated.narration_script, /where fans split/i);
  assert.match(updated.narration_script, /Wait for value, or lock in/i);
  assert.match(updated.narration_script, /the reveal becomes the first real fight/i);
  assert.match(updated.narration_script, /which version is worth buying/i);
  assert.doesNotMatch(updated.narration_script, /fine print lands|GTA VI's preorder fight/i);
  assert.match(updated.narration_script, /Follow Pulse Gaming so you never miss a beat\.$/);
  assert.equal(savedScorecard.verdict, "viral_ready", JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.blockers, [], JSON.stringify(savedScorecard, null, 2));
  assert.deepEqual(savedScorecard.warnings, [], JSON.stringify(savedScorecard, null, 2));
  assert.match(platformManifest.outputs.youtube_shorts.description, /price, editions and bonuses/i);
  assert.match(platformManifest.outputs.youtube_shorts.description, /buy, wait or skip/i);
  assert.equal(renderWorkOrder.summary.ready_for_final_render_job_count, 1);
  assert.deepEqual(renderWorkOrder.jobs[0].blockers, []);
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

test("public copy package repair blocks Dragonwilds update scripts without concrete source proof before scheduler preflight", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-dragonwilds-score-"));
  const artifactDir = path.join(root, "batch", "dragonwilds");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "dragonwilds",
    canonical_subject: "RuneScape: Dragonwilds",
    canonical_game: "RuneScape: Dragonwilds",
    selected_title: "Dragonwilds Has One Last Early Access Test",
    first_spoken_line: "RuneScape: Dragonwilds is trying to make one last Early Access impression before its 1.0 launch.",
    primary_source: "Rock Paper Shotgun",
    confirmed_claims: [
      "Ahead of its 1.0 launch, RuneScape: Dragonwilds fits in one more, scorching hot update later this month",
    ],
    narration_script:
      "RuneScape: Dragonwilds is trying to make one last Early Access impression before its 1.0 launch. Rock Paper Shotgun says the survival spin-off is getting another major update later this month ahead of that launch. Patch size is the boring part. What matters is whether gathering, crafting and combat still feel good in the tenth hour, not just the first trailer minute. If this update lands, Dragonwilds gets momentum before 1.0. If it does not, launch day has to do all the convincing by itself. Follow Pulse Gaming so you never miss a beat.",
    full_script:
      "RuneScape: Dragonwilds is trying to make one last Early Access impression before its 1.0 launch. Rock Paper Shotgun says the survival spin-off is getting another major update later this month ahead of that launch. Patch size is the boring part. What matters is whether gathering, crafting and combat still feel good in the tenth hour, not just the first trailer minute. If this update lands, Dragonwilds gets momentum before 1.0. If it does not, launch day has to do all the convincing by itself. Follow Pulse Gaming so you never miss a beat.",
    tts_script:
      "RuneScape: Dragonwilds is trying to make one last Early Access impression before its 1.0 launch. Rock Paper Shotgun says the survival spin-off is getting another major update later this month ahead of that launch. Patch size is the boring part. What matters is whether gathering, crafting and combat still feel good in the tenth hour, not just the first trailer minute. If this update lands, Dragonwilds gets momentum before 1.0. If it does not, launch day has to do all the convincing by itself. Follow Pulse Gaming so you never miss a beat.",
    description:
      "RuneScape: Dragonwilds fits in one more update before 1.0. Source: Rock Paper Shotgun.",
    thumbnail_headline: "DRAGONWILDS EARLY ACCESS",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    viral_score: 78,
    blockers: ["missing_relatable_stakes"],
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "dragonwilds", artifact_dir: artifactDir }],
    generatedAt: "2026-06-12T16:20:00.000Z",
  });

  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.blocked_count, 1);
  assert.equal(report.blocked[0].status, "blocked");
  assert.ok(
    report.blocked[0].blockers.includes("script_scorecard:vague_update_without_concrete_proof"),
    JSON.stringify(report.blocked[0], null, 2),
  );
  const savedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.equal(savedScorecard.verdict, "rewrite_required");
  assert.deepEqual(savedScorecard.blockers, ["missing_relatable_stakes"]);
  assert.match(savedManifest.narration_script, /Rock Paper Shotgun says the survival spin-off is getting another major update/i);
  assert.doesNotMatch(savedManifest.narration_script, /RuneScape Dragonwilds is getting one last chance to win back Early Access players/i);
});

test("public copy package repair blocks old Dragonwilds loop phrasing even when cached scorecard is green", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-dragonwilds-loop-"));
  const artifactDir = path.join(root, "batch", "dragonwilds-loop");
  await fs.ensureDir(artifactDir);
  const script =
    "RuneScape: Dragonwilds is getting one last chance to win back the people who bounced off Early Access. Rock Paper Shotgun says the survival spin-off has another major update coming later this month before full launch. The catch is brutally practical: players do not judge survival games by a patch note. They judge them after ten minutes of chopping, crafting, fighting and asking if the loop has finally clicked. The game has to prove it is a RuneScape game people can actually main, not a side experiment they try for a weekend and leave. If the loop feels sharper now, launch day has a foundation. If it does not, full launch starts by asking players to trust it again. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "dragonwilds-loop",
    canonical_subject: "RuneScape: Dragonwilds",
    canonical_game: "RuneScape: Dragonwilds",
    selected_title: "Dragonwilds Has One Last Early Access Test",
    first_spoken_line: "RuneScape: Dragonwilds is getting one last chance to win back the people who bounced off Early Access.",
    primary_source: "Rock Paper Shotgun",
    confirmed_claims: [
      "RuneScape: Dragonwilds has another major update coming later this month before full launch.",
    ],
    narration_script: script,
    full_script: script,
    tts_script: script,
    description: "RuneScape: Dragonwilds has another major update before full launch. Source: Rock Paper Shotgun.",
    thumbnail_headline: "DRAGONWILDS EARLY ACCESS",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "viral_ready",
    viral_score: 88,
    blockers: [],
    warnings: [],
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "dragonwilds-loop", artifact_dir: artifactDir }],
    generatedAt: "2026-06-12T16:58:00.000Z",
  });

  const savedManifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.blocked_count, 1);
  assert.ok(
    !report.blocked[0].blockers.includes("public_copy_rewrite_would_create_thin_narration"),
    JSON.stringify(report.blocked[0], null, 2),
  );
  assert.ok(
    report.blocked[0].blockers.includes("script_scorecard:vague_update_without_concrete_proof"),
    JSON.stringify(report.blocked[0], null, 2),
  );
  assert.equal(savedManifest.narration_script, script);
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

test("public copy package repair treats tighten-before-TTS scorecards as not publish-ready", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-tighten-score-"));
  const artifactDir = path.join(root, "batch", "expanse-gameplay");
  await fs.ensureDir(artifactDir);
  const script =
    "The Expanse: Osiris Reborn finally has real gameplay on screen. Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview. The catch is what changes now: this is no longer just a logo and a licence, so the combat, scale and dialogue have to carry the name. Follow Pulse Gaming so you never miss a beat.";
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "expanse-gameplay",
    canonical_subject: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Shows Real Gameplay",
    first_spoken_line: "The Expanse: Osiris Reborn finally has real gameplay on screen.",
    primary_source: "Xbox",
    confirmed_claims: [
      "Xbox showed The Expanse: Osiris Reborn gameplay during Partner Preview.",
    ],
    narration_script: script,
    full_script: script,
    tts_script: script,
    description: "Xbox showed The Expanse: Osiris Reborn gameplay during Xbox Partner Preview. Source: Xbox.",
    thumbnail_headline: "EXPANSE GAMEPLAY REVEAL",
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "tighten_before_tts",
    viral_score: 83,
    blockers: [],
    warnings: [],
    scores: {
      hook_strength: 82,
      curiosity_gap: 87,
      insight_density: 78,
      source_safety: 86,
      retention_pacing: 82,
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "expanse-gameplay", artifact_dir: artifactDir }],
    generatedAt: "2026-05-31T04:50:00.000Z",
  });

  assert.equal(report.summary.changed_count, 1, JSON.stringify(report, null, 2));
  assert.equal(report.changed[0].status, "script_scorecard_repaired");
  const savedScorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
  assert.notEqual(savedScorecard.verdict, "tighten_before_tts");
  assert.ok(savedScorecard.viral_score >= 85, JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair rewrites source-locked scaffold narration into viral-ready viewer scripts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-scaffold-rewrite-"));
  const artifactDir = path.join(root, "batch", "playstation-pc-trust");
  await fs.ensureDir(artifactDir);
  const staleScript = [
    "PlayStation needs one cleaner proof point before the hype is worth trusting.",
    "IGN says Sony Ditches Mention of PC Releases From Business Strategy Document, as PlayStation's Single-Player Games Now Expected to Be Fully Exclusive.",
    "The source is real, but the useful part for players is still the missing detail: what changes on screen, on the store page or in their next download.",
    "Follow Pulse Gaming so you never miss a beat.",
  ].join(" ");
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "playstation-pc-trust",
    canonical_subject: "PlayStation",
    canonical_game: "PlayStation",
    selected_title: "PlayStation Has A PC Port Trust Problem",
    short_title: "PlayStation Has A PC Port Trust Problem",
    thumbnail_headline: "PLAYSTATION PC TRUST",
    first_spoken_line: "PlayStation needs one cleaner proof point before the hype is worth trusting.",
    narration_script: staleScript,
    full_script: staleScript,
    tts_script: staleScript,
    description: "PlayStation changed wording around PC releases in a Sony business strategy document. Source: IGN.",
    pinned_comment: "Source: IGN.",
    primary_source: "IGN",
    confirmed_claims: [
      "Sony Ditches Mention of PC Releases From Business Strategy Document, as PlayStation's Single-Player Games Now Expected to Be Fully Exclusive",
    ],
  }, { spaces: 2 });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "rewrite_required",
    viral_score: 48,
    blockers: ["source_title_recitation", "missing_story_specific_payoff"],
    warnings: ["no_curiosity_marker"],
    scores: {
      hook_strength: 41,
      curiosity_gap: 35,
      insight_density: 50,
      source_safety: 48,
      retention_pacing: 62,
    },
  }, { spaces: 2 });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "playstation-pc-trust", artifact_dir: artifactDir }],
    generatedAt: "2026-06-25T16:15:00.000Z",
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
  assert.match(savedManifest.narration_script, /PlayStation just made PC players read the fine print again/i);
  assert.match(savedManifest.narration_script, /first-party games/i);
  assert.match(savedManifest.narration_script, /strategy slide/i);
  assert.doesNotMatch(
    savedManifest.narration_script,
    /needs one cleaner proof point|source is real|missing detail|source-backed update|IGN says Sony Ditches/i,
  );
  assert.deepEqual(savedScorecard.blockers, []);
  assert.deepEqual(freshScorecard.blockers, []);
  assert.equal(savedScorecard.verdict, "viral_ready");
  assert.ok(savedScorecard.viral_score >= 85, JSON.stringify(savedScorecard, null, 2));
});

test("public copy package repair clears current scaffolded backlog story classes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-public-copy-current-backlog-"));
  const cases = [
    {
      storyId: "planet-crafter",
      subject: "The Planet Crafter",
      title: "The Planet Crafter Has A PS5 Survival Risk",
      source: "PlayStation Blog",
      claim: "The Planet Crafter launches on PS5 July 21",
      staleHook: "The Planet Crafter is about to find out whether its survival loop works on PS5.",
      expectedScript: /slow survival loop has to feel worth the wait/i,
      forbiddenScript: /controller|pad|raids|jump scares|needs one cleaner proof point|source is real/i,
    },
    {
      storyId: "steam-next-fest",
      subject: "Steam Next Fest June 2026:",
      title: "Steam Next Fest June 2026: Has A Demo Trust Test",
      source: "GameSpot",
      claim: "Steam Next Fest June 2026: 35 Of The Best Demos You Can Play Right Now",
      staleHook: "Steam Next Fest June 2026: needs one cleaner proof point before the hype is worth trusting.",
      expectedTitle: /Steam Next Fest Has A Demo Overload Problem/i,
      expectedScript: /filtering problem/i,
      forbiddenScript: /needs one cleaner proof point|source is real|missing detail/i,
    },
    {
      storyId: "steam-controller",
      subject: "If You Haven't Reserved Steam",
      title: "Steam Controller Has A 2027 Wait Problem",
      source: "GameSpot",
      claim: "If You Haven't Reserved A Steam Controller Yet, You'll Have To Wait Until Next Year",
      staleHook: "If You Haven't Reserved Steam needs one cleaner proof point before the hype is worth trusting.",
      expectedTitle: /Steam Controller Has A 2027 Wait Problem/i,
      expectedScript: /wait is now part of the pitch/i,
      forbiddenScript: /needs one cleaner proof point|source is real|missing detail/i,
    },
    {
      storyId: "pragmata-diana",
      subject: "Pragmata's development team included group",
      title: "Pragmata Has A Character Trust Problem",
      source: "Eurogamer",
      claim: "Pragmata's development team included a group of women known as the \"Diana Police\" to convincingly capture her child-like innocence",
      staleHook: "Pragmata's development team included group needs one cleaner proof point before the hype is worth trusting.",
      expectedTitle: /Pragmata Has A Character Trust Problem/i,
      expectedScript: /Diana Police/i,
      expectedThumbnail: /PRAGMATA DIANA/i,
      forbiddenScript: /needs one cleaner proof point|source is real|missing detail/i,
    },
  ];
  const packages = [];

  for (const item of cases) {
    const artifactDir = path.join(root, "batch", item.storyId);
    packages.push({ story_id: item.storyId, artifact_dir: artifactDir });
    await fs.ensureDir(artifactDir);
    const staleScript = [
      item.staleHook,
      `${item.source} says ${item.claim}.`,
      "The source is real, but the useful part for players is still the missing detail: what changes on screen, on the store page or in their next download.",
      "Follow Pulse Gaming so you never miss a beat.",
    ].join(" ");
    await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
      story_id: item.storyId,
      canonical_subject: item.subject,
      canonical_game: item.subject,
      selected_title: item.title,
      short_title: item.title,
      thumbnail_headline: item.title.toUpperCase().split(/\s+/).slice(0, 5).join(" "),
      first_spoken_line: item.staleHook,
      narration_script: staleScript,
      full_script: staleScript,
      tts_script: staleScript,
      description: `${item.claim}. Source: ${item.source}.`,
      pinned_comment: `Source: ${item.source}.`,
      primary_source: item.source,
      confirmed_claims: [item.claim],
    }, { spaces: 2 });
    await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
      verdict: "rewrite_required",
      viral_score: 50,
      blockers: ["source_title_recitation", "missing_story_specific_payoff"],
      warnings: ["no_curiosity_marker"],
      scores: {
        hook_strength: 42,
        curiosity_gap: 35,
        insight_density: 50,
        source_safety: 50,
        retention_pacing: 70,
      },
    }, { spaces: 2 });
  }

  const report = await repairGoalPublicCopyPackages({
    storyPackages: packages,
    generatedAt: "2026-06-25T16:30:00.000Z",
  });

  assert.equal(report.summary.blocked_count, 0, JSON.stringify(report, null, 2));
  assert.equal(report.summary.changed_count, cases.length, JSON.stringify(report, null, 2));
  for (const item of cases) {
    const artifactDir = path.join(root, "batch", item.storyId);
    const manifest = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
    const scorecard = await fs.readJson(path.join(artifactDir, "script_scorecard.json"));
    if (item.expectedTitle) assert.match(manifest.selected_title, item.expectedTitle);
    if (item.expectedThumbnail) assert.match(manifest.thumbnail_headline, item.expectedThumbnail);
    assert.match(manifest.narration_script, item.expectedScript);
    assert.doesNotMatch(manifest.narration_script, item.forbiddenScript);
    assert.deepEqual(scorecard.blockers, []);
    assert.ok(scorecard.viral_score >= 75, JSON.stringify(scorecard, null, 2));
  }
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
    assert.match(savedManifest.narration_script, /\b(?:The catch is (?:what matters|what this changes)|The trade-off is)\b/i);
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
      expected: /every era has to change investigation, fights and movement/i,
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
  assert.ok(savedManifest.narration_script.split(/\s+/).length >= 115);
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
  assert.equal(workOrder.jobs[1].repair_lane, "reject_or_human_review_non_news_image_post");
  assert.equal(workOrder.jobs[1].dead_end_blocker, true);
  assert.equal(workOrder.jobs[1].operator_approval_required, true);
  assert.match(workOrder.jobs[1].recommended_command, /human review/i);
  assert.match(workOrder.jobs[1].exact_missing_input, /not a source-backed gaming news story/i);
  assert.equal(workOrder.summary.official_source_intake_required_count, 1);
  assert.equal(workOrder.summary.reject_or_human_review_count, 1);
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
    "--force-quality-rewrite",
  ]);

  assert.deepEqual(args.storyIds, ["target-story", "second-story", "third-story", "fourth-story"]);
  assert.deepEqual(args.reservedTitles, [
    "Forza Horizon 6 Scores 84 On PC Gamer",
    "Helldivers 2 Is Getting Warhammer Gear",
    "Lego Batman Is Chasing Arkham",
  ]);
  assert.equal(args.forceQualityRewrite, true);
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

test("public copy repair CLI honours explicit ElevenLabs preference over stale workbench provider state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-elevenlabs-explicit-cli-"));
  const artifactDir = path.join(root, "story");
  const outDir = path.join(root, "out");
  const staleWorkbenchPath = path.join(root, "audio_timestamp_workbench.json");
  await fs.ensureDir(artifactDir);
  await fs.outputJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: "expanse-copy",
    canonical_subject: "The Expanse: Osiris Reborn",
    canonical_game: "The Expanse: Osiris Reborn",
    selected_title: "The Expanse Has One Gameplay Question",
    first_spoken_line: "The Expanse: Osiris Reborn finally has real gameplay on screen.",
    narration_script:
      "The Expanse: Osiris Reborn finally has real gameplay on screen. The practical question is whether the missions feel like The Expanse once the trailer cut ends.",
    description: "Xbox showed The Expanse: Osiris Reborn gameplay. Source: Xbox.",
    primary_source: "Xbox",
    confirmed_claims: ["Xbox showed The Expanse: Osiris Reborn gameplay."],
  });
  await fs.outputJson(path.join(root, "story-packages.json"), [
    { story_id: "expanse-copy", artifact_dir: artifactDir },
  ]);
  await fs.outputJson(staleWorkbenchPath, {
    local_tts: { ready: true, verdict: "green" },
    elevenlabs_tts: {
      provider: "elevenlabs",
      ready: false,
      allowed: false,
      configured: true,
      missing: [],
      reason: "external ElevenLabs generation requires --provider elevenlabs; local clone is default",
      secret_values_exposed: false,
    },
    provider_preference: "auto",
  });

  const originalLog = console.log;
  const originalKey = process.env.ELEVENLABS_API_KEY;
  const originalVoice = process.env.ELEVENLABS_VOICE_ID;
  let result;
  console.log = () => {};
  process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
  process.env.ELEVENLABS_VOICE_ID = "test-elevenlabs-voice";
  try {
    result = await runPublicCopyRepairCli([
      "--root",
      root,
      "--story-packages",
      "story-packages.json",
      "--audio-workbench",
      staleWorkbenchPath,
      "--out-dir",
      outDir,
      "--provider-preference",
      "elevenlabs",
      "--generated-at",
      "2026-05-23T19:31:00.000Z",
      "--json",
    ]);
  } finally {
    console.log = originalLog;
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalKey;
    if (originalVoice === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = originalVoice;
  }

  assert.equal(result.audioWorkbench.provider_preference, "elevenlabs");
  assert.equal(result.audioWorkbench.elevenlabs_tts.ready, true);
  assert.equal(result.audioWorkbench.elevenlabs_tts.allowed, true);
  assert.equal(result.audioWorkbench.summary.elevenlabs_generation_count, 1);
  assert.equal(result.audioWorkbench.jobs[0].tts_provider, "elevenlabs");
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
  assert.ok(updated.narration_script.split(/\s+/).length >= 115);
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
  assert.ok(updated.narration_script.split(/\s+/).length >= 115);
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

test("public copy repair leaves evidence-backed named-character cover headlines unchanged", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-named-character-cover-"));
  const artifactDir = path.join(root, "sf6-yasmine");
  await fs.ensureDir(artifactDir);
  const script =
    "Street Fighter 6 just made Yasmine look like a ranked-mode problem. GameSpot's footage shows Capcom giving her Eskrima combat, knife feints and fast step-ins that punish anyone who backs up. That matters for players because zoner mains may have to spend meter just to breathe, while rushdown players may get a new bully on 3 August. The catch is her space control: defenders may not get time to reset. If that pressure survives release, ranked mode turns into a fight over fairness, not just hype. Follow Pulse Gaming so you never miss a beat.";
  const manifest = {
    schema_version: 1,
    story_id: "rss_sf6_yasmine",
    canonical_subject: "Street Fighter 6",
    canonical_game: "Street Fighter 6",
    selected_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
    public_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
    upload_title: "Street Fighter 6 Just Revealed A Rushdown Problem",
    short_title: "Yasmine Looks Dangerous",
    thumbnail_headline: "YASMINE PRESSURE",
    thumbnail_text: "YASMINE PRESSURE",
    suggested_thumbnail_text: "YASMINE PRESSURE",
    first_spoken_line: "Street Fighter 6 just made Yasmine look dangerous for one simple reason: this trailer is about pressure, not patience.",
    narration_hook: "Street Fighter 6 just made Yasmine look dangerous for one simple reason: this trailer is about pressure, not patience.",
    narration_script: script,
    full_script: script,
    tts_script: script,
    description: "Street Fighter 6 has a player-trust test now. Source: GameSpot.",
    pinned_comment: "Source: GameSpot.",
    primary_source: "GameSpot",
    primary_source_url: "https://www.gamespot.com/videos/street-fighter-6-yasmine-character-gameplay-reveal-trailer/",
    source_published_at: "2026-06-17T23:11:20.000Z",
    confirmed_claims: [
      "Capcom's official Street Fighter 6 trailer shows Yasmine gameplay.",
      "Yasmine uses Eskrima-inspired pressure and close-range movement.",
      "Yasmine is listed for a 3 August release in the source copy.",
    ],
    allowed_public_wording: [
      "Street Fighter 6 Just Revealed A Rushdown Problem",
      "Street Fighter 6 just made Yasmine look like a ranked-mode problem.",
    ],
    script_coherence_result: "pass",
    script_coherence_failures: [],
  };
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), manifest);
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    verdict: "pass",
    score: 92,
    blockers: [],
    failures: [],
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "rss_sf6_yasmine", artifact_dir: artifactDir }],
    generatedAt: "2026-06-23T19:05:00.000Z",
  });
  const after = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(report.summary.changed_count, 0);
  assert.equal(report.summary.unchanged_count, 1);
  assert.equal(after.thumbnail_headline, "YASMINE PRESSURE");
  assert.equal(after.narration_script, script);
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

test("public copy rerender work order accepts materialised motion manifest clips", async () => {
  const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-rerender-materialised-clips-"));
  await fs.outputJson(path.join(artifactDir, "visual_v4_render_story.json"), {
    video_clips: [],
  });
  await fs.outputJson(path.join(artifactDir, "materialised_motion_clips.json"), {
    status: "ready",
    clips: [
      {
        path: "C:\\clips\\doom-pssr-1.mp4",
        local_materialized_path: "C:\\clips\\doom-pssr-1.mp4",
        materialized: true,
        validated: true,
        counts_towards_motion_readiness: true,
      },
      {
        local_materialized_path: "C:\\clips\\doom-pssr-2.mp4",
        materialized: true,
        validated: true,
        counts_towards_motion_readiness: true,
      },
    ],
  });
  const report = {
    generated_at: "2026-06-25T22:00:00.000Z",
    changed: [
      {
        story_id: "doom-pssr",
        title: "Doom The Dark Ages PS5 Pro Upgrade Risks Blur",
        artifact_dir: artifactDir,
        status: "quality_rewrite_pending_audio_rerender",
        public_copy_regeneration_pending: true,
      },
    ],
  };

  const workOrder = await buildProductionRerenderWorkOrder(report);

  assert.equal(workOrder.summary.ready_for_final_render_job_count, 1);
  assert.equal(workOrder.summary.blocked_on_render_inputs_count, 0);
  assert.equal(workOrder.jobs[0].status, "ready_for_final_render_job");
  assert.deepEqual(workOrder.jobs[0].blockers, []);
  assert.deepEqual(workOrder.jobs[0].evidence.materialised_motion_clip_paths, [
    "C:\\clips\\doom-pssr-1.mp4",
    "C:\\clips\\doom-pssr-2.mp4",
  ]);
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

test("public copy package repair hydrates stale package metadata from fresher coherence artefacts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-fresh-coherence-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  const staleScript =
    "Palworld 1.0 has a low-risk trial. Xbox Wire says Palworld 1.0 lands on Game Pass on July 10. Follow Pulse Gaming so you never miss a beat.";
  const freshScript =
    "Palworld 1.0 just got the cleanest comeback button Xbox can give it. Game Pass. Xbox Wire says the full release lands on July 10 across Cloud, Console and PC, so lapsed players do not have to buy back in to check what changed. That is powerful, but it also makes the verdict harsher. People remember the launch chaos, the huge numbers and the rough edges. Now the question is simple: does the full version feel like a better game, or just a louder return to the same loop? If it lands, Palworld gets a second wave. Follow Pulse Gaming so you never miss a beat.";
  const staleManifest = {
    story_id: "official_palworld_10_gamepass_20260707_repair",
    canonical_subject: "Palworld 1.0",
    canonical_game: "Palworld",
    canonical_title: "Palworld 1.0 Has A Low-Risk Trial",
    selected_title: "Palworld 1.0 Has A Low-Risk Trial",
    short_title: "Palworld 1.0 Makes Game Pass The Comeback Button",
    thumbnail_headline: "PALWORLD 1 0 PLAYER TEST",
    thumbnail_text: "PALWORLD 1 0 PLAYER TEST",
    first_spoken_line: "Palworld 1.0 has a low-risk trial.",
    narration_script: staleScript,
    full_script: staleScript,
    tts_script: staleScript,
    description: "Palworld 1.0 has a low-risk trial. Source: Xbox Wire.",
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/2026/07/07/xbox-game-pass-july-2026-wave-1/",
    confirmed_claims: [
      "Xbox Wire lists Palworld 1.0 for Game Pass on July 10 across Cloud, Console and PC.",
    ],
    allowed_public_wording: [
      "Palworld 1.0 Makes Game Pass The Comeback Button",
      "Palworld 1.0 just got the cleanest comeback button Xbox can give it.",
    ],
    title_candidates: ["Palworld 1.0 Makes Game Pass The Comeback Button"],
  };
  const freshManifest = {
    ...staleManifest,
    canonical_title: "Palworld 1.0 Makes Game Pass The Comeback Button",
    selected_title: "Palworld 1.0 Makes Game Pass The Comeback Button",
    short_title: "Palworld 1.0 Makes Game Pass The Comeback Button",
    first_spoken_line: "Palworld 1.0 just got the cleanest comeback button Xbox can give it.",
    narration_hook: "Palworld 1.0 just got the cleanest comeback button Xbox can give it.",
    narration_script: freshScript,
    full_script: freshScript,
    tts_script: freshScript,
    spoken_narration_script: freshScript,
    description:
      "Palworld 1.0 just got the cleanest comeback button Xbox can give it. If it lands, Palworld gets a second wave. Source: Xbox Wire.",
  };
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), staleManifest);
  await fs.writeJson(path.join(artifactDir, "coherence_report.json"), {
    result: "pass",
    failures: [],
    warnings: [],
    manifest: freshManifest,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), buildViralScriptIntelligence({
    title: freshManifest.selected_title,
    full_script: freshManifest.narration_script,
    canonical_subject: freshManifest.canonical_subject,
    primary_source: freshManifest.primary_source,
    confirmed_claims: freshManifest.confirmed_claims,
  }));
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: staleManifest.selected_title,
        description: staleManifest.description,
        cover: { headline: staleManifest.thumbnail_headline },
      },
    },
  });

  const report = await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "official_palworld_10_gamepass_20260707_repair", artifact_dir: artifactDir }],
    generatedAt: "2026-07-07T20:15:00.000Z",
  });
  const updated = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));
  const platformManifest = await fs.readJson(path.join(artifactDir, "platform_publish_manifest.json"));

  assert.equal(report.summary.changed_count, 1);
  assert.equal(report.summary.blocked_count, 0);
  assert.equal(updated.selected_title, "Palworld 1.0 Makes Game Pass The Comeback Button");
  assert.equal(updated.thumbnail_headline, "PALWORLD COMEBACK BUTTON");
  assert.equal(updated.narration_script, freshScript);
  assert.equal(platformManifest.outputs.youtube_shorts.title, updated.selected_title);
  assert.match(JSON.stringify(platformManifest), /PALWORLD COMEBACK BUTTON/);
  assert.equal(evaluateGoalPublicCopy(updated).verdict, "pass");

  const cadenceScript = freshScript.replace(
    "Game Pass. Xbox Wire says",
    "Game Pass is the catch. Xbox Wire says",
  );
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    ...updated,
    narration_script: cadenceScript,
    full_script: cadenceScript,
    tts_script: cadenceScript,
    spoken_narration_script: cadenceScript,
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), buildViralScriptIntelligence({
    story: updated,
    script: cadenceScript,
  }));
  await fs.utimes(
    path.join(artifactDir, "canonical_story_manifest.json"),
    new Date("2026-07-07T21:00:00.000Z"),
    new Date("2026-07-07T21:00:00.000Z"),
  );
  await fs.utimes(
    path.join(artifactDir, "coherence_report.json"),
    new Date("2026-07-07T20:00:00.000Z"),
    new Date("2026-07-07T20:00:00.000Z"),
  );

  await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: "official_palworld_10_gamepass_20260707_repair", artifact_dir: artifactDir }],
    generatedAt: "2026-07-07T21:05:00.000Z",
  });
  const cadencePreserved = await fs.readJson(path.join(artifactDir, "canonical_story_manifest.json"));

  assert.equal(cadencePreserved.narration_script, cadenceScript);
});

test("public copy package repair does not hydrate a newer canonical script from stale coherence evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-copy-repair-stale-coherence-"));
  const artifactDir = path.join(root, "story");
  await fs.ensureDir(artifactDir);
  const staleScript =
    "Denshattack asks one ridiculous question: can a train do a kickflip? Xbox Wire confirms it hits Game Pass and Xbox Play Anywhere on July 15, with players flipping, grinding and tricking a customisable train across a colourful Japanese dystopia. The trailer sells the joke instantly. The controls have to sell the next ten hours. The catch is whether a clean combo feels improvised, not like watching a preset stunt reel. Game Pass removes the price risk, but it cannot make canned tricks satisfying. The split is simple: players who master a ridiculous line need to feel they earned it, while everyone else should still enjoy the crash. If the stunts feel earned, Denshattack becomes this summer's strangest one-more-run obsession; if they look canned, the gimmick stops being funny after one clip. Follow Pulse Gaming so you never miss a beat.";
  const currentScript =
    "Denshattack asks one ridiculous question. Can a train do a kickflip? Xbox Wire confirms it hits Game Pass and Xbox Play Anywhere on July 15. Players flip, grind and trick a customisable train across a colourful Japanese dystopia. The trailer sells the joke instantly. The controls have to sell the next ten hours. A clean combo should feel improvised. It should not look like a preset stunt reel. Game Pass removes the price risk. It cannot make canned tricks satisfying. The split is simple. Players who master a ridiculous line need to feel they earned it. Everyone else should still enjoy the crash. If the stunts feel earned, Denshattack becomes this summer's strangest one-more-run obsession. If they look canned, the gimmick stops being funny after one clip. Follow Pulse Gaming so you never miss a beat.";
  const manifest = {
    story_id: "denshattack-stale-coherence",
    canonical_subject: "Denshattack",
    canonical_game: "Denshattack",
    canonical_title: "Why Denshattack's Train Kickflips Could Actually Work",
    selected_title: "Why Denshattack's Train Kickflips Could Actually Work",
    short_title: "Why Denshattack's Train Kickflips Could Actually Work",
    first_spoken_line: "Denshattack asks one ridiculous question.",
    narration_script: currentScript,
    full_script: currentScript,
    tts_script: currentScript,
    description: "Denshattack brings train kickflips to Game Pass on July 15. Source: Xbox Wire.",
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    primary_source_url: "https://news.xbox.com/en-us/2026/07/13/denshattack-game-pass/",
    confirmed_claims: ["Denshattack launches on Game Pass on July 15."],
    thumbnail_headline: "DENSHATTACK TRAIN KICKFLIPS",
    thumbnail_text: "DENSHATTACK TRAIN KICKFLIPS",
  };
  const coherencePath = path.join(artifactDir, "coherence_report.json");
  const manifestPath = path.join(artifactDir, "canonical_story_manifest.json");
  await fs.writeJson(coherencePath, {
    result: "pass",
    failures: [],
    warnings: [],
    generated_at: "2026-07-13T20:00:00.000Z",
    manifest: {
      ...manifest,
      first_spoken_line: "Denshattack asks one ridiculous question: can a train do a kickflip?",
      narration_script: staleScript,
      full_script: staleScript,
      tts_script: staleScript,
    },
  });
  await fs.utimes(coherencePath, new Date("2026-07-13T20:00:00.000Z"), new Date("2026-07-13T20:00:00.000Z"));
  await fs.writeJson(manifestPath, manifest);
  await fs.utimes(manifestPath, new Date("2026-07-13T21:00:00.000Z"), new Date("2026-07-13T21:00:00.000Z"));
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), buildViralScriptIntelligence({
    story: manifest,
    script: currentScript,
  }));
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    outputs: {
      youtube_shorts: {
        title: manifest.selected_title,
        description: manifest.description,
        cover: { headline: manifest.thumbnail_headline },
      },
    },
  });

  await repairGoalPublicCopyPackages({
    storyPackages: [{ story_id: manifest.story_id, artifact_dir: artifactDir }],
    generatedAt: "2026-07-13T21:05:00.000Z",
  });
  const updated = await fs.readJson(manifestPath);

  assert.equal(updated.narration_script, currentScript);
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

test("public copy repair turns test-framed stories into consequence hooks instead of title repeats", () => {
  const repaired = repairGoalPublicCopyManifest({
    story_id: "fresh_xbox_beastro_20260611",
    canonical_subject: "Beastro",
    canonical_game: "Beastro",
    selected_title: "Beastro Has A Cozy Deckbuilding Test",
    first_spoken_line:
      "Xbox just put a cosy deckbuilder on Game Pass, and the real question is whether it can make card battles feel human.",
    narration_script:
      "Xbox just put a cosy deckbuilder on Game Pass, and the real question is whether it can make card battles feel human. The game is Beastro, and Xbox Wire says it is out now, with cooking, farming and village care feeding the cards you take beyond the wall.",
    description:
      "Beastro is out now on Xbox and Game Pass, mixing village care, cooking, farming and card battles around Caretakers defending a wall. Source: Xbox Wire.",
    primary_source: "Xbox Wire",
    source_card_label: "Xbox Wire",
    confirmed_claims: [
      "Beastro is out now on Xbox and Game Pass, mixing village care, cooking, farming and card battles around Caretakers defending a wall.",
    ],
  });

  assert.equal(repaired.after.verdict, "pass", repaired.after.failures.join(", "));
  assert.match(repaired.manifest.first_spoken_line, /^Beastro\b/);
  assert.match(repaired.manifest.first_spoken_line, /Game Pass|card battles|deckbuilding/i);
  assert.notEqual(repaired.manifest.first_spoken_line, "Beastro Has A Cozy Deckbuilding Test.");
  assert.doesNotMatch(repaired.manifest.narration_script, /^Beastro Has A Cozy Deckbuilding Test\./);
});
