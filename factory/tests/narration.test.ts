import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNarration, joinFigures, tokens } from "../src/qa/narration.ts";

const say = (text: string, from = 0, step = 0.35) =>
  text
    .split(" ")
    .map((t, i) => ({
      text: t,
      start: from + i * step,
      end: from + i * step + 0.3,
    }));

test("formatting is not a fault: figures, Roman numerals, compounds and hyphens", () => {
  const meant = say(
    "In nineteen ninety-seven Rockstar made GTA 5 feel like a touch-screen dream for fifty-nine dollars ninety-nine with eight thousand forty-nine reviews and a three-lead story",
  );
  const heard = say(
    "In 1997 rock star made GTA V feel like a touch screen dream for $59 .99 with 8 ,049 reviews and a three lead story",
  );
  const c = checkNarration(meant, heard);
  assert.deepEqual(c.issues, []);
  assert.equal(c.ok, true);
});

test("the GTA ranking's real faults are caught", () => {
  const meant = say(
    "The back half's tone wanders. The controls are pure PS2 and the Definitive Edition sits low. Then GTA 5 then San Andreas. Fans will argue.",
  );
  const heard = say(
    "The back half's tone wanders. The Contrapurps 2 and the Definitive Edition sits low. Then GTA then Sayus. We'll argue.",
  );
  const c = checkNarration(meant, heard);
  assert.equal(c.ok, false);
  const said = c.issues.map((x) => `${x.meant} > ${x.heard}`);
  assert.ok(
    said.some((x) => /controls are pure PS2/.test(x)),
    said.join(" | "),
  );
  assert.ok(
    said.some((x) => /San Andreas/.test(x) && /Sayus/.test(x)),
    said.join(" | "),
  );
  assert.ok(
    said.some((x) => /^5/.test(x)),
    said.join(" | "),
  );
  assert.ok(
    said.some((x) => /Fans will/.test(x)),
    said.join(" | "),
  );
});

test("one misheard word is Whisper's slip, not the voice's", () => {
  const c = checkNarration(
    say("his name is Huang Lee and he plants a seed"),
    say("his name is Huang Li and he plants a seat"),
  );
  assert.equal(c.ok, true);
});

test("timings that drift away from the audio fail the check", () => {
  const words = Array.from({ length: 600 }, (_, i) => `word${i % 50}`).join(
    " ",
  );
  const meant = say(words, 0, 0.5);
  // The audio runs steadily ahead of the timings: a second by the end.
  const heard = meant.map((w, i) => ({
    ...w,
    start: w.start - (i / meant.length) * 1.05,
  }));
  const c = checkNarration(meant, heard);
  assert.ok(c.drift > 0.6, `drift ${c.drift}`);
  assert.equal(c.ok, false);
  const steady = checkNarration(
    meant,
    meant.map((w) => ({ ...w, start: w.start - 0.05 })),
  );
  assert.equal(steady.ok, true);
});

test("tokens and split figures", () => {
  assert.deepEqual(tokens("1997,"), ["nineteen", "ninety", "seven"]);
  assert.deepEqual(tokens("V,"), ["five"]);
  assert.deepEqual(tokens("I"), ["i"]);
  assert.deepEqual(tokens("29th"), ["twenty", "nine"]);
  assert.deepEqual(
    joinFigures(say("8 ,049 reviews")).map((w) => w.text),
    ["8,049", "reviews"],
  );
});

test("a changed figure, status word or platform is never forgiven as a mishearing (audit, 24 Oct 2026)", () => {
  const bad = (meant: string, heard: string) => assert.equal(checkNarration(say(meant), say(heard)).ok, false, `${meant} > ${heard}`);
  bad("It costs fifteen dollars on Steam today", "It costs fifty dollars on Steam today");
  bad("The sequel is confirmed for next year", "The sequel is cancelled for next year");
  bad("It launches on PlayStation first", "It launches on Xbox first");
  bad("GTA 6 arrives in November", "GTA 5 arrives in November");
  bad("The studio is not making a sequel", "The studio is now making a sequel");
  // Ordinary mishearings still pass.
  assert.equal(checkNarration(say("he plants a seed in the garden"), say("he plants a seat in the garden")).ok, true);
});

test("a half-second gap where the script has no punctuation is reported as a mid-sentence pause", async () => {
  const { midSentencePauses } = await import("../src/qa/narration.ts");
  const meant = [
    { text: "Modern", start: 0 },
    { text: "Warfare", start: 0.45 },
    { text: "4's", start: 0.9 },
    { text: "first", start: 1.2 },
    { text: "DLC.", start: 1.5 },
    { text: "He's", start: 2.6 },
    { text: "Kyle", start: 2.9 },
  ];
  const heard = [
    { text: "Modern", start: 0, end: 0.42 },
    { text: "Warfare,", start: 0.44, end: 0.88 },
    { text: "4's", start: 1.4, end: 1.7 },
    { text: "first", start: 1.72, end: 2.0 },
    { text: "DLC.", start: 2.02, end: 2.6 },
    { text: "He's", start: 3.2, end: 3.4 },
    { text: "Kyle", start: 3.42, end: 3.6 },
  ];
  const pauses = midSentencePauses(meant, heard);
  assert.equal(pauses.length, 1, "the pause after 'DLC.' is a sentence end and is fine");
  assert.equal(pauses[0]!.before, "Warfare");
  assert.equal(pauses[0]!.after, "4's");
  assert.ok(pauses[0]!.seconds >= 0.5);
});
