"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  KINETIC_TYPOGRAPHY_V5,
  buildPremiumKineticAss,
  inspectPremiumCaptionCadence,
} = require("../../lib/studio/v5/kinetic-typography");

test("V5 kinetic typography groups narration into readable semantic phrases", () => {
  const scriptText = "GTA VI just revealed the detail that changes the entire launch debate.";
  const tokens = scriptText.split(/\s+/);
  const words = tokens.map((word, index) => ({
    word,
    start: index * 0.24,
    end: index * 0.24 + 0.22,
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "GTA VI Cover Art Reveal" },
    words,
    duration: 4,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass");
  assert.equal(report.metrics.maximum_words_per_caption <= KINETIC_TYPOGRAPHY_V5.max_words_per_phrase, true);
  assert.equal(report.metrics.caption_count < tokens.length / 2, true);
  assert.equal(report.metrics.single_word_caption_ratio, 0);
  assert.match(ass, /GTA/);
  assert.match(ass, /VI/);
});

test("V5 caption cadence rejects strobing one-word subtitle decks", () => {
  const ass = [
    "[Events]",
    "Dialogue: 0,0:00:00.00,0:00:00.18,Pop,,0,0,0,,ONE",
    "Dialogue: 0,0:00:00.18,0:00:00.36,Pop,,0,0,0,,WORD",
    "Dialogue: 0,0:00:00.36,0:00:00.54,Pop,,0,0,0,,FLASHES",
    "Dialogue: 0,0:00:00.54,0:00:00.72,Pop,,0,0,0,,FAST",
  ].join("\n");
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("caption_single_word_ratio_above_premium_ceiling"));
  assert.ok(report.blockers.includes("caption_dwell_below_premium_floor"));
});

test("V5 kinetic typography rebalances single-word sentence tails", () => {
  const scriptText = "Small dinosaurs can collect wild resources.";
  const words = scriptText.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.24,
    end: index * 0.24 + 0.22,
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "Paleo Pines Players' Choice Update" },
    words,
    duration: 2,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass");
  assert.equal(report.metrics.single_word_caption_count, 0);
  assert.deepEqual(
    report.captions.map((caption) => caption.text),
    ["SMALL DINOSAURS CAN COLLECT", "WILD RESOURCES."],
  );
});

test("V5 kinetic typography borrows safe dwell from the previous phrase before a sentence boundary", () => {
  const scriptText =
    "Arknights Endfield just gave PS5 Pro owners a real before-and-after test. PlayStation Blog says Version 1.4 upgrades PSSR.";
  const timestampTokens = [
    "Arknights",
    "Endfield",
    "just",
    "gave",
    "PS5",
    "Pro",
    "owners",
    "a",
    "real",
    "before",
    "and",
    "after",
    "test.",
    "PlayStation",
    "Blog",
    "says",
    "Version",
    "1.4",
    "upgrades",
    "PSSR.",
  ];
  const words = timestampTokens.map((word, index) => ({
    word,
    start: Number((0.2 + index * 0.3714).toFixed(4)),
    end: Number((0.2 + (index + 1) * 0.3714).toFixed(4)),
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "Arknights Endfield PS5 Pro Upgrade" },
    words,
    duration: 8.5,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.equal(
    report.captions.some((caption) => caption.text === "TEST."),
    false,
  );
  assert.equal(
    report.captions.some((caption) => caption.text === "A REAL BEFORE-AND-AFTER TEST."),
    true,
  );
});

test("V5 kinetic typography rebalances a short dangling word before a long currency token", () => {
  const scriptText = "Steam lists them at $84.91 combined, while the base game costs $59.99.";
  const words = [
    ["Steam", 0, 0.28],
    ["lists", 0.28, 0.48],
    ["them", 0.48, 0.74],
    ["at", 0.74, 1.0],
    ["84", 1.0, 1.25],
    ["dollars", 1.25, 1.5],
    ["91", 1.5, 2.28],
    ["combined,", 2.28, 2.96],
    ["while", 3.26, 3.36],
    ["the", 3.36, 3.54],
    ["base", 3.54, 3.74],
    ["game", 3.74, 3.98],
    ["costs", 3.98, 4.26],
    ["59", 4.26, 4.61],
    ["dollars", 4.61, 4.96],
    ["99.", 4.96, 6.04],
  ].map(([word, start, end]) => ({ word, start, end }));
  const ass = buildPremiumKineticAss({
    story: { title: "Black Flag Resynced DLC Pricing" },
    words,
    duration: 6.5,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.captions.some((caption) => caption.text === "COSTS"), false);
  assert.equal(report.metrics.minimum_caption_dwell_s >= KINETIC_TYPOGRAPHY_V5.min_phrase_duration_s, true);
  assert.ok(report.captions.some((caption) => caption.text === "GAME COSTS"));
});

test("V5 kinetic typography never lets dangling-tail repair exceed the premium word ceiling", () => {
  const scriptText = "Make or break it is four.";
  const words = scriptText.split(/\s+/).map((word, index) => ({
    word,
    start: index * 0.2,
    end: index * 0.2 + 0.18,
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "MARVEL Tokon" },
    words,
    duration: 1.5,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass");
  assert.equal(
    report.metrics.maximum_words_per_caption <= KINETIC_TYPOGRAPHY_V5.max_words_per_phrase,
    true,
  );
});

test("V5 kinetic typography never leaves articles or connectors at a caption tail", () => {
  const scriptText =
    "It also adds two regions, two operators, the story finale, a roguelike mode and a two-player challenge.";
  const words = scriptText.split(/\s+/).map((word, index) => ({
    word,
    start: Number((index * 0.32).toFixed(2)),
    end: Number((index * 0.32 + 0.28).toFixed(2)),
  }));
  const ass = buildPremiumKineticAss({
    story: { title: "Arknights: Endfield Version 1.4" },
    words,
    duration: 8,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.equal(
    report.captions.some((caption) =>
      /\b(?:A|AN|THE|AND|OR|TO|OF|FOR|WITH|IN|ON)$/.test(caption.text),
    ),
    false,
  );
});

test("V5 kinetic typography reflows following phrases when a dangling article cannot fit directly", () => {
  const scriptText =
    "That matters because an expensive console upgrade only earns its pitch when players can see the difference during movement, not just in a paused screenshot.";
  const timestamps = [
    ["That", 0, 0.12],
    ["matters", 0.12, 0.5],
    ["because", 0.5, 0.84],
    ["an", 0.84, 1.02],
    ["expensive", 1.02, 1.28],
    ["console", 1.28, 1.72],
    ["upgrade", 1.72, 2.2],
    ["only", 2.2, 2.58],
    ["earns", 2.58, 2.92],
    ["its", 2.92, 3.12],
    ["pitch", 3.12, 3.34],
    ["when", 3.34, 3.58],
    ["players", 3.58, 3.86],
    ["can", 3.86, 4.08],
    ["see", 4.08, 4.28],
    ["the", 4.28, 4.4],
    ["difference", 4.4, 4.66],
    ["during", 4.66, 4.9],
    ["movement,", 4.9, 5.16],
    ["not", 5.56, 5.76],
    ["just", 5.76, 5.96],
    ["in", 5.96, 6.14],
    ["a", 6.14, 6.22],
    ["paused", 6.22, 6.42],
    ["screenshot.", 6.42, 6.8],
  ].map(([word, start, end]) => ({ word, start, end }));
  const ass = buildPremiumKineticAss({
    story: { title: "Arknights: Endfield Version 1.4" },
    words: timestamps,
    duration: 7,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.equal(
    report.captions.some((caption) =>
      /\b(?:A|AN|THE|AND|OR|TO|OF|FOR|WITH|IN|ON)$/.test(caption.text),
    ),
    false,
  );
  assert.ok(
    report.captions.some((caption) => caption.text === "AN EXPENSIVE CONSOLE UPGRADE"),
  );
});

test("V5 caption cadence rejects a dangling function word even when dwell is sufficient", () => {
  const ass = [
    "[Events]",
    "Dialogue: 0,0:00:00.00,0:00:01.00,Pop,,0,0,0,,STORY FINALE, A",
    "Dialogue: 0,0:00:01.00,0:00:02.00,Pop,,0,0,0,,ROGUELIKE MODE",
  ].join("\n");
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "fail");
  assert.ok(report.blockers.includes("caption_dangling_function_word_tail"));
});

test("V5 kinetic typography reflows a connector into two readable following phrases", () => {
  const scriptText =
    "Sales still do not prove long-term retention, and these figures come from Ubisoft.";
  const words = [
    ["Sales", 0, 0.36],
    ["still", 0.36, 0.8],
    ["do", 0.8, 1],
    ["not", 1.047, 1.187],
    ["prove", 1.187, 1.467],
    ["long-term", 1.467, 2.007],
    ["retention,", 2.007, 2.327],
    ["and", 2.947, 3.087],
    ["these", 3.134, 3.314],
    ["figures", 3.314, 3.694],
    ["come", 3.694, 4.014],
    ["from", 4.014, 4.214],
    ["Ubisoft.", 4.214, 4.454],
  ].map(([word, start, end]) => ({ word, start, end }));
  const ass = buildPremiumKineticAss({
    story: { title: "Black Flag Sold 3 Million" },
    words,
    duration: 5,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.equal(
    report.captions.some((caption) => caption.text === "LONG-TERM RETENTION, AND"),
    false,
  );
  assert.ok(report.captions.some((caption) => caption.text === "AND THESE FIGURES"));
  assert.ok(report.captions.some((caption) => caption.text === "COME FROM UBISOFT."));
});

test("V5 kinetic typography repairs a multi-word phrase below the premium dwell floor", () => {
  const scriptText =
    "But the second-wave million suggests the game did more than cash in on its name.";
  const words = [
    ["But", 0, 0.08],
    ["the", 0.08, 0.2],
    ["second-wave", 0.2, 0.747],
    ["million", 0.747, 1.027],
    ["suggests", 1.027, 1.407],
    ["the", 1.407, 1.767],
    ["game", 1.767, 1.987],
    ["did", 1.987, 2.207],
    ["more", 2.254, 2.494],
    ["than", 2.494, 2.674],
    ["cash", 2.674, 2.894],
    ["in", 2.894, 3.234],
    ["on", 3.234, 3.354],
    ["its", 3.354, 3.474],
    ["name.", 3.474, 3.754],
  ].map(([word, start, end]) => ({ word, start, end }));
  const ass = buildPremiumKineticAss({
    story: { title: "Black Flag Sold 3 Million" },
    words,
    duration: 4.2,
    scriptText,
  });
  const report = inspectPremiumCaptionCadence(ass);

  assert.equal(report.status, "pass", JSON.stringify(report, null, 2));
  assert.equal(
    report.metrics.minimum_caption_dwell_s >= KINETIC_TYPOGRAPHY_V5.min_phrase_duration_s,
    true,
  );
  assert.ok(report.captions.some((caption) => caption.text === "SUGGESTS THE GAME"));
  assert.ok(report.captions.some((caption) => caption.text === "DID MORE THAN CASH"));
});
