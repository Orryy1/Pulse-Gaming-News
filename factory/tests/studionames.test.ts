// Studio names with digits said the way fans say them (26 Nov 2026: "343 Industries" came out as a count).
import test from "node:test";
import assert from "node:assert/strict";
import {
  speakable,
  saidInName,
  studioFigureSaid,
} from "../src/voice/speakable.ts";
import { displayWords, writtenForms } from "../src/render/timeline.ts";
import { checkNarration, usUk } from "../src/qa/narration.ts";
import { wordTimes } from "../src/render/components/kinetic/words.ts";
import { figureSupported } from "../src/qa/gfxaudit.ts";

const timed = (text: string) =>
  text
    .split(" ")
    .map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
const shown = (text: string) =>
  displayWords(timed(speakable(text)))
    .map((w) => w.text)
    .join(" ");

// Each studio: the script line, and how Whisper writes a correct reading (figures, as it does).
const LINES: Array<[string, string]> = [
  ["343 Industries made the game.", "343 Industries made the game."],
  ["4A Games made the game.", "4A Games made the game."],
  ["505 Games made the game.", "505 Games made the game."],
  ["2K Games made the game.", "2K Games made the game."],
  ["2K Sports made the game.", "2K Sports made the game."],
  ["3D Realms made the game.", "3D Realms made the game."],
  ["11 bit studios made the game.", "11 bit studios made the game."],
  ["1047 Games made the game.", "1047 Games made the game."],
];

test("studio names with digits are said as fans say them; plain counts are not touched", () => {
  assert.match(
    speakable("343 Industries laid off staff."),
    /^three four three Industries/,
  );
  assert.equal(
    speakable("4A Games and 505 Games"),
    "four A Games and five oh five Games",
  );
  assert.match(
    speakable("2K Games said 2K Sports grew."),
    /two K Games said two K Sports/,
  );
  assert.match(speakable("3D Realms is back."), /three D Realms/);
  assert.doesNotMatch(speakable("It sold 343 copies."), /three four three/);
  // Capitals, and the studio's short form.
  assert.match(
    speakable("343 INDUSTRIES confirmed it."),
    /^three four three Industries/,
  );
  assert.match(speakable("343's next game"), /^three four three's next game/);
  assert.match(speakable("343’s next game"), /^three four three’s next game/);
});

test("captions show the written studio names, possessives included", () => {
  for (const [line] of LINES) assert.equal(shown(line), line, line);
  assert.equal(
    shown("343 Industries' next game is out."),
    "343 Industries' next game is out.",
  );
  assert.equal(shown("1047 Games' boss spoke."), "1047 Games' boss spoke.");
  assert.equal(shown("343's next game is out."), "343's next game is out.");
  assert.equal(shown("2K Sports grew."), "2K Sports grew.");
  // writtenForms alone keeps the timing of the whole name.
  const w = writtenForms(timed("three four three Industries' boss"));
  assert.equal(w[0]!.text, "343 Industries'");
  assert.equal(w[0]!.start, 0);
  assert.equal(w[0]!.end, timed("a b c d")[3]!.end);
});

test("the narration check passes a correct reading however Whisper writes the studio name", () => {
  for (const [line, heard] of LINES) {
    const r = checkNarration(timed(speakable(line)), timed(heard));
    assert.equal(r.ok, true, `${line}: ${JSON.stringify(r.issues)}`);
  }
  // Whisper writing the words it heard, hyphenated or split, and the possessives.
  const pairs: Array<[string, string]> = [
    ["343 Industries made the game.", "Three-four-three Industries made the game."],
    ["505 Games made the game.", "Five-oh-five Games made the game."],
    ["1047 Games made the game.", "10 47 Games made the game."],
    ["4A Games made the game.", "4-A Games made the game."],
    ["343's next game is out.", "343's next game is out."],
    ["343 Industries' next game is out.", "343 Industries' next game is out."],
  ];
  for (const [line, heard] of pairs) {
    const r = checkNarration(timed(speakable(line)), timed(heard));
    assert.equal(r.ok, true, `${heard}: ${JSON.stringify(r.issues)}`);
  }
});

test("a real mis-read of a studio name still fails the narration check", () => {
  const meant = timed(speakable("343 Industries made the game."));
  assert.equal(
    checkNarration(meant, timed("353 Industries made the game.")).ok,
    false,
  );
  assert.equal(
    checkNarration(meant, timed("Three four four Industries made the game."))
      .ok,
    false,
  );
  const four = timed(speakable("4A Games made the game."));
  assert.equal(
    checkNarration(four, timed("Four Games made the game.")).ok,
    false,
  );
  assert.equal(
    checkNarration(
      timed(speakable("505 Games made it.")),
      timed("515 Games made it."),
    ).ok,
    false,
  );
});

test("captions: curly possessives stay curly, a script's own two K and a lone 2K are left alone, any case", () => {
  assert.equal(shown("343’s next game is out."), "343’s next game is out.");
  assert.equal(displayWords(timed("He scored two K.")).map((w) => w.text).join(" "), "He scored two K.");
  assert.equal(shown("2K resolution is fine."), "2K resolution is fine.");
  assert.equal(speakable("2K resolution"), "2K resolution");
  assert.match(speakable("3d realms and 2k sports"), /^three D Realms and two K sports/);
  assert.equal(shown("2K Vegas grew."), "2K Vegas grew.");
});

test("four heard as for is still no voice fault", () => {
  const r = checkNarration(timed("It took four years."), timed("It took for years."));
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test("number words are not respelt as US or UK spellings", () => {
  assert.equal(usUk("four"), "four");
  assert.equal(usUk("fours"), "fours");
  assert.equal(usUk("rumoured"), "rumored");
});

test("per-word callers say a studio's figure the studio's way", () => {
  assert.equal(saidInName(["343", "Industries"], 0), "three four three");
  assert.equal(saidInName(["11", "bit", "studios"], 0), "eleven");
  assert.equal(saidInName(["2K", "Sports,"], 0), "two K");
  assert.equal(saidInName(["343", "copies"], 0), undefined);
  assert.equal(saidInName(["343's"], 0), "three four three's");
  // The kinetic words land "Industries" on the spoken "Industries", not three words late.
  const spoken = timed("three four three Industries made it");
  const times = wordTimes(["343", "Industries", "made", "it"], spoken, 0);
  assert.equal(times[1], spoken[3]!.start);
  // The figure audit accepts "343" on screen when the studio's name was said.
  assert.deepEqual(studioFigureSaid("343"), [["three", "four", "three"]]);
  assert.deepEqual(studioFigureSaid("2K"), [["two", "k"]]);
  const said = "three four three industries made it".split(" ");
  assert.equal(figureSupported("343", "", "", said), true);
  assert.equal(figureSupported("353", "", "", said), false);
});
