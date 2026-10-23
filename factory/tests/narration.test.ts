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
