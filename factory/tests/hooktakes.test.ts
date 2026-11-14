import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLARITY_FLOOR,
  chooseHook,
  clarityOf,
  hookOf,
  hookSplit,
  MATCH_CEILING,
  scoreHooks,
  spliceWords,
  SPLICE_MARGIN,
  type HookMeasure,
} from "../src/voice/hooktakes.ts";
import { voicedPitches } from "../src/voice/takecheck.ts";
import type { Word } from "../src/voice/elevenlabs.ts";

const w = (text: string, start: number, end: number): Word => ({
  text,
  start,
  end,
});

test("the hook is the first sentence when it is hook-sized", () => {
  assert.equal(
    hookOf("GTA 6 just broke a record nobody expected. Here's why it matters."),
    "GTA 6 just broke a record nobody expected.",
  );
  assert.equal(
    hookOf("Wait, what? Rockstar did it again."),
    undefined,
    "two words is too short",
  );
  assert.equal(
    hookOf("Is this the best price yet for a PS5? It might be."),
    "Is this the best price yet for a PS5?",
  );
  assert.equal(
    hookOf("Version 4.5 lands today with ray tracing for everyone. More soon."),
    "Version 4.5 lands today with ray tracing for everyone.",
  );
  assert.equal(
    hookOf("One sentence only, nothing after it."),
    undefined,
    "a hook needs a rest to splice onto",
  );
  assert.equal(hookOf(""), undefined);
});

test("the hook's end is found in the word timings, cut in the middle of the pause", () => {
  const words = [
    w("GTA", 0.1, 0.4),
    w("6", 0.4, 0.6),
    w("broke", 0.6, 0.9),
    w("records.", 0.9, 1.3),
    w("Here's", 1.7, 1.9),
    w("why.", 1.9, 2.2),
  ];
  const s = hookSplit(words, "GTA 6 broke records.");
  assert.ok(s);
  assert.equal(s.count, 4);
  assert.equal(s.end, 1.3);
  assert.ok(Math.abs(s.cut - 1.5) < 1e-9);
  assert.ok(Math.abs(s.tail - 0.2) < 1e-9);
  assert.equal(
    hookSplit(words, "GTA 7 broke records."),
    undefined,
    "a different hook is refused",
  );
  assert.equal(
    hookSplit(words.slice(0, 4), "GTA 6 broke records."),
    undefined,
    "nothing after the hook",
  );
  const tight = [...words.slice(0, 4), w("Here's", 1.3, 1.5)];
  assert.equal(
    hookSplit(tight, "GTA 6 broke records."),
    undefined,
    "no pause to cut in",
  );
});

test("clarity is the share of the hook's words heard in order", () => {
  assert.equal(
    clarityOf("GTA 6 broke a record", "GTA six broke a record"),
    1,
    "figures read either way",
  );
  assert.equal(
    clarityOf("Rockstar just moved the date", "rock star just moved the date"),
    0.8,
  );
  assert.equal(clarityOf("the price just dropped", "the prize dropped"), 0.5);
  assert.equal(clarityOf("", "anything"), 0);
});

const m = (o: Partial<HookMeasure>): HookMeasure => ({
  label: "x",
  wpm: 175,
  rangeSt: 12,
  levelDb: -18,
  loudBreaths: 0,
  clarity: 1,
  ...o,
});

test("scores reward range, level, clarity, the target pace and no breaths", () => {
  const [best, flat, quiet, rushed, breathy] = scoreHooks(
    [
      m({}),
      m({ rangeSt: 4 }),
      m({ levelDb: -21 }),
      m({ wpm: 215 }),
      m({ loudBreaths: 2 }),
    ],
    175,
  );
  assert.ok(
    best!.total > flat!.total &&
      best!.total > quiet!.total &&
      best!.total > rushed!.total &&
      best!.total > breathy!.total,
  );
  assert.equal(best!.parts.pace, 1);
  assert.equal(rushed!.parts.pace, 0, "40 wpm off loses all the pace marks");
  assert.equal(breathy!.parts.breaths, 0);
  assert.ok(best!.total > 0.99 && best!.total <= 1);
});

test("an unclear or mismatched take is out; a take without clarity is scored on the rest", () => {
  const [a, b, c] = scoreHooks(
    [
      m({ clarity: CLARITY_FLOOR - 0.01 }),
      m({ match: MATCH_CEILING + 0.1 }),
      m({ clarity: undefined }),
    ],
    175,
  );
  assert.match(a!.out ?? "", /words heard/);
  assert.match(b!.out ?? "", /unlike the rest/);
  assert.equal(c!.out, undefined);
  assert.equal(c!.parts.clarity, undefined);
  assert.ok(c!.total > 0.99, "re-weighted over the parts that were measured");
});

test("the narration's own read wins unless a take clearly beats it", () => {
  const s = (total: number, out?: string) => ({
    label: "",
    total,
    parts: { energy: 0, pace: 0, breaths: 0 },
    ...(out ? { out } : {}),
  });
  assert.equal(chooseHook([s(0.7), s(0.7 + SPLICE_MARGIN / 2), s(0.6)]), 0);
  assert.equal(chooseHook([s(0.7), s(0.7 + SPLICE_MARGIN), s(0.6)]), 1);
  assert.equal(
    chooseHook([s(0.7), s(0.9, "unclear"), s(0.8)]),
    2,
    "a take that is out never wins",
  );
  assert.equal(
    chooseHook([s(0.9, "unclear"), s(0.5), s(0.6)]),
    2,
    "an unclear narration read loses to any take that passes",
  );
  assert.equal(
    chooseHook([s(0.9, "x"), s(0.5, "y")]),
    0,
    "nothing passes: keep what is there",
  );
});

test("a spliced hook keeps its own timings and moves the rest by the change in length", () => {
  const main = [
    w("A", 0, 0.3),
    w("hook.", 0.3, 0.8),
    w("Rest", 1.2, 1.5),
    w("here.", 1.5, 1.9),
  ];
  const take = [w("A", 0.05, 0.25), w("hook.", 0.25, 0.6)];
  const out = spliceWords(main, take, 2, 1.0, 0.8);
  assert.deepEqual(
    out.map((x) => x.text),
    ["A", "hook.", "Rest", "here."],
  );
  assert.equal(out[1]!.end, 0.6);
  assert.ok(Math.abs(out[2]!.start - 1.0) < 1e-9);
  assert.ok(Math.abs(out[3]!.end - 1.7) < 1e-9);
  assert.equal(main[2]!.start, 1.2, "the input is untouched");
});

test("the pitch track of a rising tone spans its interval", () => {
  // A one-second glide from 110 to 220 Hz (an octave, 12 semitones) at 16 kHz.
  const rate = 16_000;
  const x = new Float32Array(rate);
  let ph = 0;
  for (let i = 0; i < rate; i++) {
    const f = 110 * 2 ** (i / rate);
    ph += (2 * Math.PI * f) / rate;
    x[i] = 0.5 * Math.sin(ph);
  }
  const p = voicedPitches(x, rate).sort((a, b) => a - b);
  assert.ok(p.length > 15);
  const st =
    12 *
    Math.log2(p[Math.floor(p.length * 0.9)]! / p[Math.floor(p.length * 0.1)]!);
  assert.ok(st > 8 && st < 12, `range ${st.toFixed(1)} semitones`);
});
