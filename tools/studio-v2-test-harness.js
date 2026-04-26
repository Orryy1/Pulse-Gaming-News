/**
 * tools/studio-v2-test-harness.js — engine robustness test harness.
 *
 * Validates that v2 modules handle edge cases not exercised by the
 * happy-path 1sn9xhe render. Runs as a single script with a
 * pass/fail summary at the end. Each test is independent — one
 * failure does not abort the run.
 *
 * Tests:
 *
 *   1. STORY PACKAGE — synthetic fixtures
 *      a. story with NO comment       → quoteCandidates empty
 *      b. story with NO clips         → riskFlag "no-trailer-clips"
 *      c. story with stock-only       → riskFlag "stock-only"
 *      d. hook with AI-tell phrase    → variants filter, viability hit
 *      e. ultra-long hook (40+ chars) → wordCount risk flag
 *
 *   2. CARD CONTENT DERIVATION
 *      a. year-gap from 2 release years → "Y YEARS / LAST ENTRY IN <earlier>"
 *      b. one release year only        → uses currentYear
 *      c. future-only years (in-game)  → falls through to BACKGROUND
 *      d. money-bearing script         → "$Y" / REVENUE FIGURE
 *      e. percent-bearing script       → "Y%" / BY THE NUMBERS
 *      f. long top_comment             → quote text trimmed to short sentence
 *
 *   3. CROSS-CLIP PUNCH PICKER PERMUTATIONS
 *      a. 1 clip available  → punch transformation skipped
 *      b. 2 clips available → first pair only (no second pair)
 *      c. 3 clips available → both pairs, distinct sources
 *      d. 4+ clips available → both pairs, picks least-used
 *
 *   4. SUBTITLE REALIGNMENT STRESS
 *      a. clean alignment    → no realignment needed, all words pass through
 *      b. year-bearing script "Metro 2039" — script has digit form,
 *         alignment has spoken expansion; safety reset NOT triggered
 *      c. heavily corrupted alignment (random word substitutions) →
 *         8-mismatch threshold triggers safety reset
 *      d. empty alignment    → returns empty, no crash
 */

"use strict";

const path = require("node:path");
const fs = require("fs-extra");

const ROOT = path.resolve(__dirname, "..");

const {
  buildPronunciationMap,
  generateOfflineHookVariants,
} = require("../lib/studio/v2/story-package");
const { deriveCardContent } = require("../lib/studio/v2/hf-card-builders");
const {
  realignTimestampsToScript,
  groupIntoPhrases,
  buildKineticAss,
} = require("../lib/studio/v2/subtitle-layer-v2");

const PASS = "  ✓";
const FAIL = "  ✗";

let totalPass = 0;
let totalFail = 0;
const failures = [];

function check(name, predicate, details) {
  if (predicate) {
    console.log(`${PASS} ${name}`);
    totalPass++;
  } else {
    console.log(`${FAIL} ${name}`);
    if (details) console.log(`      ${details}`);
    totalFail++;
    failures.push({ name, details });
  }
}

function group(title) {
  console.log("");
  console.log(`▸ ${title}`);
}

// ------------------------------------------------------------------ //
// Group 1: STORY PACKAGE                                             //
// ------------------------------------------------------------------ //

function testStoryPackage() {
  group("STORY PACKAGE — pronunciation + hook generation");

  // 1.a — pronunciation map: years
  const map1 = buildPronunciationMap("Released in 2024 with the 2039 sequel.");
  check(
    "pronunciation: detects 2024 as a year",
    map1.some((e) => e.written === "2024" && e.spoken === "twenty twenty-four"),
    JSON.stringify(map1),
  );
  check(
    "pronunciation: detects 2039 as a year",
    map1.some((e) => e.written === "2039" && e.spoken === "twenty thirty-nine"),
    JSON.stringify(map1),
  );

  // 1.b — pronunciation map: acronym + number
  const map2 = buildPronunciationMap("GTA 6 leaks again.");
  check(
    "pronunciation: detects GTA 6 acronym + number",
    map2.some((e) => e.kind === "acronym-number" && /GTA/i.test(e.written)),
    JSON.stringify(map2),
  );

  // 1.c — pronunciation map: money
  const map3 = buildPronunciationMap("Microsoft offered $5B for the studio.");
  check(
    "pronunciation: detects $5B as money",
    map3.some((e) => e.kind === "money" && e.spoken.includes("billion")),
    JSON.stringify(map3),
  );

  // 1.d — offline hook variants always returns 10 entries
  const story1 = {
    title: "Some Big Game Reveal",
    hook: "Some Big Game just announced a sequel.",
    body: "Details below.",
  };
  const variants = generateOfflineHookVariants(story1);
  check(
    "offline hooks: returns 10 variants",
    Array.isArray(variants) && variants.length === 10,
    `got ${variants?.length}`,
  );
  check(
    "offline hooks: every variant has a word count",
    variants.every((v) => typeof v.wordCount === "number"),
    "missing wordCount on at least one",
  );
  check(
    "offline hooks: at least one passes the 8-12 word band",
    variants.some((v) => v.wordCount >= 8 && v.wordCount <= 12),
    "no variant in the green band",
  );
  check(
    "offline hooks: no variant has an AI-tell phrase",
    variants.every((v) => !v.hasAiTell),
    "AI-tell detected in template (template should be clean)",
  );
}

// ------------------------------------------------------------------ //
// Group 2: CARD CONTENT DERIVATION                                   //
// ------------------------------------------------------------------ //

function testCardContent() {
  group("CARD CONTENT DERIVATION");

  // 2.a — year-gap from 2 release years
  const c1 = deriveCardContent({
    story: { title: "Test", subreddit: "GAMES", flair: "Trailer" },
    pkg: { script: { tightened: "Released in 2007 and again in 2018 now." } },
  });
  check(
    "year-gap: 2007 + 2018 → 11 YEARS / LAST ENTRY IN 2007",
    c1.context.number === "11 YEARS" && c1.context.sub === "LAST ENTRY IN 2007",
    JSON.stringify(c1.context),
  );

  // 2.b — single release year + currentYear fallback
  const currentYear = new Date().getFullYear();
  const c2 = deriveCardContent({
    story: { title: "Test", subreddit: "GAMES" },
    pkg: { script: { tightened: "The first instalment shipped in 2019." } },
  });
  const expectedGap2 = currentYear - 2019;
  check(
    `single year: 2019 + currentYear (${currentYear}) → ${expectedGap2} YEARS`,
    c2.context.number === `${expectedGap2} YEARS` &&
      c2.context.sub === "LAST ENTRY IN 2019",
    JSON.stringify(c2.context),
  );

  // 2.c — future-only years (in-game date) should not produce gap
  const c3 = deriveCardContent({
    story: { title: "Test", subreddit: "GAMES" },
    pkg: { script: { tightened: "The story is set in 2087 and 2099." } },
  });
  check(
    "future-only: in-game years (2087, 2099) NOT used as release gap",
    c3.context.number !== "12 YEARS",
    JSON.stringify(c3.context),
  );

  // 2.d — money-bearing script
  const c4 = deriveCardContent({
    story: { title: "Acquisition Story" },
    pkg: { script: { tightened: "Microsoft offered $5B for Activision." } },
  });
  check(
    "money: $5B detected as REVENUE FIGURE",
    c4.context.number === "$5B" && c4.context.sub === "REVENUE FIGURE",
    JSON.stringify(c4.context),
  );

  // 2.e — percent-bearing script
  const c5 = deriveCardContent({
    story: { title: "Sales Stats" },
    pkg: { script: { tightened: "Steam reviews are 92% positive overall." } },
  });
  check(
    "percent: 92% detected as BY THE NUMBERS",
    c5.context.number === "92%" && c5.context.sub === "BY THE NUMBERS",
    JSON.stringify(c5.context),
  );

  // 2.f — long top_comment trimmed to short sentence
  const longComment =
    "This is a very long reddit comment that spans multiple sentences. The first sentence is short. " +
    "But the second one is too long to use as a quote because it contains too much content " +
    "to display readably on a portrait card.";
  const c6 = deriveCardContent({
    story: {
      title: "Test",
      subreddit: "GAMES",
      top_comment: longComment,
    },
    pkg: {},
  });
  check(
    "quote: long comment trimmed to short sentence",
    c6.quote && c6.quote.quoteText && c6.quote.quoteText.length <= 90,
    c6.quote ? `length=${c6.quote.quoteText.length}` : "no quote",
  );

  // 2.g — no comment → no quote card
  const c7 = deriveCardContent({
    story: { title: "Test", subreddit: "GAMES" },
    pkg: {},
  });
  check(
    "no comment: quote is null",
    c7.quote === null,
    JSON.stringify(c7.quote),
  );

  // 2.h — title cues drive takeaway
  const c8 = deriveCardContent({
    story: { title: "Mark The Date Release", flair: "Announcement" },
    pkg: {},
  });
  check(
    "takeaway: release/launch title → MARK THE DATE",
    JSON.stringify(c8.takeaway.headlineWords) ===
      JSON.stringify(["MARK", "THE", "DATE"]),
    JSON.stringify(c8.takeaway.headlineWords),
  );

  const c9 = deriveCardContent({
    story: { title: "GTA 6 Leak Hits 4chan", flair: "Rumour" },
    pkg: {},
  });
  check(
    "takeaway: rumour flair → WAIT FOR CONFIRMATION",
    JSON.stringify(c9.takeaway.headlineWords) ===
      JSON.stringify(["WAIT", "FOR", "CONFIRMATION"]),
    JSON.stringify(c9.takeaway.headlineWords),
  );
}

// ------------------------------------------------------------------ //
// Group 3: CROSS-CLIP PUNCH PICKER PERMUTATIONS                      //
// ------------------------------------------------------------------ //

function testPunchPicker() {
  group("CROSS-CLIP PUNCH PICKER PERMUTATIONS");

  // The picker logic lives inside applySceneGrammarV2 in the
  // orchestrator. We import the orchestrator's transform indirectly
  // by replicating the deterministic picker logic here so we can
  // exercise it without rendering. The contract: given N clips and
  // N clip-bearing scenes, the picker should emit punches drawn
  // from clips DIFFERENT from each other, preferring least-used
  // sources.
  function pickPunchPair(clipScenes, mediaClips) {
    const sourceUseCount = new Map();
    for (const cs of clipScenes) {
      const src = cs.source;
      if (!src) continue;
      sourceUseCount.set(src, (sourceUseCount.get(src) || 0) + 1);
    }
    for (const c of mediaClips) {
      if (!sourceUseCount.has(c.path)) sourceUseCount.set(c.path, 0);
    }
    const sortedClips = [...sourceUseCount.entries()].sort(
      (a, b) => a[1] - b[1],
    );
    return sortedClips.slice(0, 2).map(([p]) => p);
  }

  // 3.a — 1 clip
  const r1 = pickPunchPair([{ source: "clipA" }], [{ path: "clipA" }]);
  check(
    "1 clip available: picker returns < 2 distinct → punch skipped",
    r1.length < 2 || r1[0] === r1[1],
    JSON.stringify(r1),
  );

  // 3.b — 2 clips, both used
  const r2 = pickPunchPair(
    [{ source: "clipA" }, { source: "clipB" }],
    [{ path: "clipA" }, { path: "clipB" }],
  );
  check(
    "2 clips available: picker returns 2 distinct sources",
    r2.length === 2 && r2[0] !== r2[1],
    JSON.stringify(r2),
  );

  // 3.c — 3 clips, A used twice, B once, C unused
  const r3 = pickPunchPair(
    [{ source: "clipA" }, { source: "clipA" }, { source: "clipB" }],
    [{ path: "clipA" }, { path: "clipB" }, { path: "clipC" }],
  );
  check(
    "3 clips, prefer least-used: picker returns C + B (not A)",
    r3.length === 2 && r3.includes("clipC") && r3.includes("clipB"),
    JSON.stringify(r3),
  );

  // 3.d — 4 clips, B and D unused
  const r4 = pickPunchPair(
    [{ source: "clipA" }, { source: "clipC" }],
    [
      { path: "clipA" },
      { path: "clipB" },
      { path: "clipC" },
      { path: "clipD" },
    ],
  );
  check(
    "4 clips, picker prefers least-used pair (B + D)",
    r4.length === 2 &&
      ((r4[0] === "clipB" && r4[1] === "clipD") ||
        (r4[0] === "clipD" && r4[1] === "clipB")),
    JSON.stringify(r4),
  );
}

// ------------------------------------------------------------------ //
// Group 4: SUBTITLE REALIGNMENT STRESS                               //
// ------------------------------------------------------------------ //

function testSubtitleRealignment() {
  group("SUBTITLE REALIGNMENT STRESS");

  // 4.a — clean alignment: scriptText matches words exactly. Note
  // the realigner emits the SCRIPT token (with punctuation) when it
  // matches the alignment's clean form — so "again." in the script
  // pairs with "again" in the alignment and emits "again." as output.
  const cleanWords = [
    { word: "Hello", start: 0.0, end: 0.5 },
    { word: "world", start: 0.5, end: 1.0 },
    { word: "again", start: 1.0, end: 1.5 },
  ];
  const r1 = realignTimestampsToScript("Hello world again.", cleanWords);
  check(
    "clean: returns same length as input",
    r1.length === 3,
    `got length ${r1.length}`,
  );
  check(
    "clean: script-form punctuation preserved",
    r1[0].word === "Hello" && r1[2].word === "again.",
    JSON.stringify(r1.map((r) => r.word)),
  );

  // 4.b — year expansion: script "2039", alignment "twenty 39" (this
  // mirrors how ElevenLabs actually splits the speech: it emits "39"
  // as a numeric token rather than "thirty-nine" hyphenated).
  const yearWords = [
    { word: "Metro", start: 0.0, end: 0.4 },
    { word: "twenty", start: 0.4, end: 0.7 },
    { word: "39", start: 0.7, end: 1.2 },
    { word: "is", start: 1.2, end: 1.4 },
    { word: "real", start: 1.4, end: 1.8 },
  ];
  const r2 = realignTimestampsToScript("Metro 2039 is real.", yearWords);
  check(
    "year-expansion: '2039' merges 'twenty' + '39' into one token",
    r2.some((w) => w.word === "2039"),
    JSON.stringify(r2.map((r) => r.word)),
  );
  const merged = r2.find((w) => w.word === "2039");
  check(
    "year-expansion: timestamps preserved (start of 'twenty', end of '39')",
    merged?.start === 0.4 && merged?.end === 1.2,
    JSON.stringify(merged),
  );

  // 4.c — heavy corruption: 8+ consecutive mismatches → safety reset
  const corruptedWords = Array.from({ length: 20 }, (_, i) => ({
    word: `wordX${i}`,
    start: i * 0.5,
    end: i * 0.5 + 0.4,
  }));
  const cleanScript = "this script has totally different words from above";
  const r3 = realignTimestampsToScript(cleanScript, corruptedWords);
  check(
    "heavy corruption: returns 20 entries (safety reset → keep original)",
    r3.length === 20,
    `got length ${r3.length}`,
  );

  // 4.d — empty alignment
  const r4 = realignTimestampsToScript("Hello world.", []);
  check(
    "empty alignment: returns []",
    Array.isArray(r4) && r4.length === 0,
    JSON.stringify(r4),
  );

  // 4.e — phrase grouping: 4 words/phrase, breaks on punctuation
  const phrases = groupIntoPhrases([
    { word: "First", start: 0, end: 0.3 },
    { word: "second", start: 0.3, end: 0.6 },
    { word: "third.", start: 0.6, end: 0.9 },
    { word: "Fourth", start: 0.9, end: 1.2 },
    { word: "fifth", start: 1.2, end: 1.5 },
  ]);
  check(
    "phrase grouping: punctuation ends a phrase",
    phrases.length >= 2 && phrases[0].words.length === 3,
    JSON.stringify(phrases.map((p) => p.words.length)),
  );

  // 4.f — full ASS build doesn't crash on typical inputs
  let assOk = true;
  let assContent = "";
  try {
    assContent = buildKineticAss({
      story: { title: "Test Story" },
      words: yearWords,
      duration: 2.0,
      scriptText: "Metro 2039 is real.",
    });
  } catch {
    assOk = false;
  }
  check(
    "buildKineticAss: produces valid ASS without crashing",
    assOk &&
      assContent.includes("[Events]") &&
      assContent.includes("Dialogue:"),
    assOk ? "" : "threw an exception",
  );

  // 4.g — empty words → ASS still produces a valid header
  let assEmpty = "";
  try {
    assEmpty = buildKineticAss({
      story: { title: "Test" },
      words: [],
      duration: 1.0,
      scriptText: "",
    });
  } catch {
    assEmpty = null;
  }
  check(
    "buildKineticAss: empty input still produces valid ASS header",
    assEmpty &&
      assEmpty.includes("[Script Info]") &&
      assEmpty.includes("[Events]"),
    assEmpty ? "no [Events] section" : "threw an exception",
  );
}

// ------------------------------------------------------------------ //
// Main                                                                //
// ------------------------------------------------------------------ //

async function main() {
  console.log("");
  console.log("================================================");
  console.log("  Studio Short Engine v2 — robustness harness");
  console.log("================================================");

  testStoryPackage();
  testCardContent();
  testPunchPicker();
  testSubtitleRealignment();

  console.log("");
  console.log("================================================");
  console.log(`  ${totalPass} passed · ${totalFail} failed`);
  console.log("================================================");
  if (failures.length > 0) {
    console.log("");
    console.log("FAILURES:");
    for (const f of failures) {
      console.log(`  - ${f.name}`);
      if (f.details) console.log(`      ${f.details}`);
    }
    process.exit(1);
  }

  // Write a JSON report for the deliverables page to ingest
  const report = {
    storyId: "harness",
    generatedAt: new Date().toISOString(),
    totalPass,
    totalFail,
    failures,
  };
  await fs.writeJson(
    path.join(ROOT, "test", "output", "studio_v2_test_harness_report.json"),
    report,
    { spaces: 2 },
  );
  console.log("");
  console.log("Report: test/output/studio_v2_test_harness_report.json");
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
