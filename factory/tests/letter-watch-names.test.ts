// LETTER_WATCH_NAMES (src/qa/narration.ts nameShaped): names built from capitalised parts are not spelled letters.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNarration, letterReadings, lettersOf, nameShaped } from "../src/qa/narration.ts";
import { SAID_AS_LETTERS } from "../src/voice/speakable.ts";
import { loadConfig } from "../src/config.ts";

test("name-shaped tokens are names; letter runs stay watched", () => {
  for (const n of ["McCoy", "McCoy's", "YouTube", "GameSpot", "LeBron", "DeLorean", "MacArthur"])
    assert.equal(nameShaped(n), true, n);
  for (const n of ["PvP", "PvPs", "LoL", "WoW", "DeNA", "iOS", "GOTY", "NPCs", "PS5", "Rockstar", "McC"])
    assert.equal(nameShaped(n), false, n);
  assert.equal(lettersOf("McCoy"), undefined);
  assert.equal(lettersOf("YouTube"), undefined);
  assert.equal(lettersOf("PvP"), "PVP");
  assert.equal(lettersOf("GOTY"), "GOTY");
  // Switched off, the old reading comes back.
  assert.equal(lettersOf("McCoy", { names: false }), "MCCOY");
});

// The real case (Titanfall 2 Short, ep_20261125_d007d47a, 25 Nov 2026): "McCoy's line" held before a pause.
const meant = [
  { text: "That", start: 0, end: 0.2 },
  { text: "was", start: 0.22, end: 0.4 },
  { text: "McCoy's", start: 0.42, end: 0.8 },
  { text: "line.", start: 1.9, end: 2.2 },
];
const heard = [
  { text: "That", start: 0, end: 0.2 },
  { text: "was", start: 0.22, end: 0.4 },
  { text: "McCoy's", start: 0.42, end: 1.85 },
  { text: "line.", start: 1.9, end: 2.2 },
];

test("a name held before a pause is not logged as spelled", () => {
  assert.equal(letterReadings(meant, heard, { names: false }).length, 1, "the old watch flagged it");
  assert.equal(letterReadings(meant, heard).length, 0);
  assert.equal(checkNarration(meant, heard).letters?.length ?? 0, 0);
});

test("a real spelled token is still caught next to a name", () => {
  const m = [...meant, { text: "GOTY", start: 2.3, end: 3.3 }];
  const h = [
    ...heard,
    { text: "G", start: 2.3, end: 2.55 },
    { text: "O", start: 2.55, end: 2.8 },
    { text: "T", start: 2.8, end: 3.05 },
    { text: "Y", start: 3.05, end: 3.3 },
  ];
  assert.deepEqual(letterReadings(m, h).map((l) => l.token), ["GOTY"]);
});

test("GOG is said as letters, and the setting defaults on", () => {
  assert.equal(SAID_AS_LETTERS.has("GOG"), true);
  const before = process.env.LETTER_WATCH_NAMES;
  delete process.env.LETTER_WATCH_NAMES;
  try {
    assert.equal(loadConfig().letterWatchNames, true);
    process.env.LETTER_WATCH_NAMES = "false";
    assert.equal(loadConfig().letterWatchNames, false);
  } finally {
    if (before === undefined) delete process.env.LETTER_WATCH_NAMES;
    else process.env.LETTER_WATCH_NAMES = before;
  }
});
