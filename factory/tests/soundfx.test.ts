// The documentary's sound craft (src/render/soundfx.ts): every planning rule, pure.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUTTON_REACH_SECONDS,
  CRAFT_OFF,
  DEVICE_FOLEY,
  DISPLAY_FOLEY,
  FOLEY_CLEAR_SECONDS,
  FOLEY_GAP_SECONDS,
  FOLEY_SAME_GAP_SECONDS,
  GAME_POCKET,
  GAME_UNDER,
  JL_MAX_SECONDS,
  PHOTO_FOLEY,
  PHRASE_IN_FRAMES,
  REVERB_WET_PEAK,
  REVERB_WET_START,
  SKETCH_FOLEY,
  bedEdge,
  bedSchedule,
  chapterButtons,
  craftOf,
  cueFrame,
  dryLevel,
  foleyFile,
  gameEnvelope,
  gateFoley,
  isMessageQuote,
  jlCuts,
  jlEdge,
  phoneSpan,
  phraseSnap,
  pocketOf,
  pocketWeight,
  reverbLevel,
  riserPeaks,
  soundCraftLine,
  voiceFxPlan,
} from "../src/render/soundfx.ts";
import {
  BED_GRID,
  BEDS,
  LEVEL,
  MOOD_BEDS,
  RISER_SFX,
  foleyLevel,
  gateLongSounds,
  inKey,
  leadFrames,
} from "../src/render/soundscape.ts";
import { ALL_STYLES } from "../src/render/components/packs/index.ts";
import { PHOTO_TREATMENTS } from "../src/render/photoplan.ts";
import { SKETCH_TREATMENTS } from "../src/render/sketchplan.ts";
import type { BeatCue } from "../src/render/musicplan.ts";

const FPS = 30;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const db = (x: number) => 20 * Math.log10(x);

test("an absent sound-craft prop is the old mix; a partial one turns on only what it names", () => {
  assert.deepEqual(craftOf(undefined), CRAFT_OFF);
  assert.deepEqual(craftOf({ foley: true }), { ...CRAFT_OFF, foley: true });
});

// ---------------------------------------------------------------- J and L cuts

const clipShot = (start: number, end: number, index = 0) => ({
  start,
  end,
  media: { type: "clip", index },
});

test("a gameplay clip with spare footage leads its picture by up to 0.6 s, the next one trails it", () => {
  const max = Math.round(JL_MAX_SECONDS * FPS);
  const clips = [{ durationSeconds: 5, audio: true }];
  const cuts = jlCuts([clipShot(300, 360), clipShot(400, 460)], clips, FPS, []);
  // Shot 0 (even) takes the lead first, the rest of the spare goes to the tail; shot 1 the other way round.
  assert.deepEqual(cuts.get(0), { lead: max, tail: max });
  assert.deepEqual(cuts.get(1), { lead: max, tail: max });
  const tight = jlCuts(
    [clipShot(300, 360), clipShot(400, 460)],
    [{ durationSeconds: 70 / FPS, audio: true }],
    FPS,
    [],
  );
  assert.deepEqual(tight.get(0), { lead: 10, tail: 0 });
  assert.deepEqual(tight.get(1), { lead: 0, tail: 10 });
});

test("J and L cuts only for clips that keep their sound, with footage to spare, never across a chapter change", () => {
  const shots = [clipShot(300, 360)];
  assert.equal(jlCuts(shots, [{ durationSeconds: 5 }], FPS, []).size, 0);
  assert.equal(
    jlCuts(shots, [{ durationSeconds: 2, audio: true }], FPS, []).size,
    0,
  );
  assert.equal(
    jlCuts(
      [{ start: 0, end: 60, media: { type: "image", index: 0 } }],
      [{ durationSeconds: 5, audio: true }],
      FPS,
      [],
    ).size,
    0,
  );
  // A chapter opens on the shot: no lead; one opens 6 frames after it ends: the tail stops short of it.
  const c = jlCuts(
    shots,
    [{ durationSeconds: 5, audio: true }],
    FPS,
    [300, 366],
  );
  assert.deepEqual(c.get(0), { lead: 0, tail: 6 });
  // Never before frame 0.
  const first = jlCuts(
    [clipShot(5, 65)],
    [{ durationSeconds: 5, audio: true }],
    FPS,
    [],
  );
  assert.equal(first.get(0)!.lead, 5);
});

test("a J/L clip's sound rises over its lead, falls over its tail, and keeps the old 8-frame fade otherwise", () => {
  assert.equal(jlEdge(0, 18, 60, 18), 0);
  assert.equal(jlEdge(9, 18, 60, 18), 0.5);
  assert.equal(jlEdge(18, 18, 60, 18), 1);
  assert.equal(jlEdge(18 + 60 + 9, 18, 60, 18), 0.5);
  assert.equal(jlEdge(96, 18, 60, 18), 0);
  assert.equal(jlEdge(4, 0, 60, 18), 0.5);
});

test("game sound sits at its old level under the voice and rises softly only in a pause of 0.9 s or more", () => {
  const on = new Uint8Array(300).fill(1);
  on.fill(0, 100, 110); // 0.33 s: part of the delivery
  on.fill(0, 200, 260); // 2 s: a pause that carries
  const env = gameEnvelope(on, FPS);
  assert.ok(Math.abs(env[50]! - GAME_UNDER) < 1e-6);
  assert.ok(Math.abs(env[105]! - GAME_UNDER) < 1e-6);
  assert.ok(Math.abs(env[240]! - GAME_POCKET) < 1e-6);
  // Back down before the next word.
  assert.ok(Math.abs(env[260]! - GAME_UNDER) < 1e-6);
  // Never more than 6 dB over its old level.
  assert.ok(db(GAME_POCKET / GAME_UNDER) <= 6);
});

// ---------------------------------------------------------------- foley

test("every photo and sketch treatment and every display is mapped, and every foley file exists in both keys when tuned", () => {
  for (const t of PHOTO_TREATMENTS) assert.ok(t in PHOTO_FOLEY, t);
  for (const t of SKETCH_TREATMENTS) assert.ok(SKETCH_FOLEY[t], t);
  for (const d of ["crt", "lcd", "flat", "phone"] as const)
    assert.ok(DISPLAY_FOLEY[d]);
  const names = new Set([
    ...Object.values(PHOTO_FOLEY).flatMap((c) => (c ? [c.sound] : [])),
    ...Object.values(SKETCH_FOLEY).flatMap((c) => (c ? [c.sound] : [])),
    ...Object.values(DISPLAY_FOLEY).map((c) => c.sound),
    ...Object.values(DEVICE_FOLEY).map((c) => c.sound),
  ]);
  for (const n of [...names, "riser" as const, "button" as const]) {
    const file = foleyFile(n);
    const files = ["D", "E"].map((k) =>
      inKey(file, `music/bed_${k === "D" ? 2 : 1}.wav`),
    );
    for (const f of files)
      assert.ok(fs.existsSync(path.join(ROOT, "public", "sfx", `${f}.mp3`)), f);
  }
});

test("device foley names only styles that exist, and never a style whose own sound is a stamp", () => {
  for (const name of Object.keys(DEVICE_FOLEY)) {
    assert.ok(ALL_STYLES[name], name);
    assert.notEqual(ALL_STYLES[name]!.sound, "stamp", name);
  }
});

test("a treatment's foley lands on its landing frame, a darkroom's when the tongs lift the print", () => {
  assert.equal(cueFrame(PHOTO_FOLEY.instantDrop!, 90), 16);
  assert.equal(cueFrame(PHOTO_FOLEY.evidenceBoard!, 90), 14);
  // Darkroom: develop runs 40% of the shot (45-75 frames), the lift 10 after.
  assert.equal(cueFrame(PHOTO_FOLEY.darkroom!, 150), 70);
  assert.equal(cueFrame(PHOTO_FOLEY.darkroom!, 300), 85);
  assert.equal(PHOTO_FOLEY.magnifier, undefined);
});

test("foley fits around the chosen sounds: clear of them and of entry changes, spaced, never the same sound twice running close", () => {
  const f = (s: number) => Math.round(s * FPS);
  const picks = gateFoley(
    [
      { key: 1, frame: f(10), sound: "pin" },
      { key: 2, frame: f(10.5), sound: "paper" }, // under FOLEY_GAP after key 1
      { key: 3, frame: f(14), sound: "pin" }, // same sound within FOLEY_SAME_GAP
      { key: 4, frame: f(14.2), sound: "tape" },
      { key: 5, frame: f(20.5), sound: "paper" }, // within FOLEY_CLEAR of a taken sound at 21
      { key: 6, frame: f(30.5), sound: "shutter" }, // within 1.5 s of an entry change at 31
      { key: 7, frame: f(40), sound: "pin" },
    ],
    [f(21)],
    [f(31)],
    FPS,
  );
  assert.deepEqual([...picks.keys()], [1, 4, 7]);
  assert.ok(
    FOLEY_GAP_SECONDS >= 2 &&
      FOLEY_SAME_GAP_SECONDS > FOLEY_GAP_SECONDS &&
      FOLEY_CLEAR_SECONDS >= 1,
  );
});

test("every new sound is at least 14 dB under the narrator (the house scale: glint 0.138 is 20 dB under)", () => {
  const under = (g: number) => 20 - db(g / 0.138);
  for (const n of [
    "foley/pin",
    "foley/buzz",
    "foley/tickroll",
    "foley/bars-D",
    "foley/riser-E",
    "foley/button-D",
  ])
    assert.ok(
      under(foleyLevel(n)) >= 14,
      `${n} ${under(foleyLevel(n)).toFixed(1)} dB`,
    );
  assert.ok(under(LEVEL.foleyLong) >= 21);
  assert.equal(foleyLevel("foley/riser-D"), LEVEL.riserLong);
  assert.equal(foleyLevel("foley/button"), LEVEL.buttonLong);
  // The voice texture: the reverb's wet share stays at least 14 dB under the dry line.
  assert.ok(db(REVERB_WET_PEAK) <= -14);
});

test("tuned foley follows the bed's key and peaks are found with the key suffix", () => {
  assert.equal(inKey("foley/riser", "music/bed_2.wav"), "foley/riser-D");
  assert.equal(inKey("foley/riser", "music/bed_1.wav"), "foley/riser-E");
  assert.equal(inKey("foley/pin", "music/bed_2.wav"), "foley/pin");
  assert.equal(
    leadFrames("foley/riser-D", FPS),
    leadFrames("foley/riser", FPS),
  );
  assert.ok(leadFrames("foley/riser", FPS) >= 30);
  assert.equal(leadFrames("v3/swell", FPS), 27);
});

// ---------------------------------------------------------------- risers

test("a riser peaks on each reveal's word, claims its moment and is at most one in 20 s", () => {
  const cues: BeatCue[] = [
    { kind: "reveal", at: 900, start: 870, end: 960 },
    { kind: "key", at: 1500, start: 1500, end: 1600 },
    { kind: "reveal", at: 1200, start: 1180, end: 1260 },
    { kind: "reveal", at: 2000, start: 1980, end: 2060 },
  ];
  assert.deepEqual(riserPeaks(cues), [900, 1200, 2000]);
  const out = gateLongSounds(
    [
      { key: 1, frame: 880, kind: "glint" }, // would stack with the riser at 900
      ...riserPeaks(cues).map((at, i) => ({
        key: 700 + i,
        frame: at,
        kind: "riser" as const,
      })),
    ],
    [],
    FPS,
  );
  assert.equal(out.get(700), RISER_SFX);
  assert.equal(out.has(1), false);
  assert.equal(out.has(701), false); // 10 s after the first
  assert.equal(out.get(702), RISER_SFX);
});

// ---------------------------------------------------------------- chapter buttons and bar-line edits

test("a chapter's closing hit lands on its last word when that ends just before the next chapter opens", () => {
  const words = [10, 20, 56.95, 61.5, 70].map((s) => s * FPS);
  assert.deepEqual(chapterButtons([57.05 * FPS], words, FPS), [
    Math.round(56.95 * FPS),
  ]);
  // A last word further back than BUTTON_REACH_SECONDS: the hit stays on the entry frame.
  const far = (65 + BUTTON_REACH_SECONDS + 1) * FPS;
  assert.deepEqual(chapterButtons([far], words, FPS), [far]);
});

test("a bed change snaps to the outgoing bed's bar line, a phrase line within reach first", () => {
  const grid = { bar: 2, first: 0, loop: 64 };
  // Bed started at frame 0: bar lines every 60 frames, phrases every 240.
  assert.equal(phraseSnap(250, 0, grid, FPS), 240); // phrase 10 frames away
  assert.equal(phraseSnap(300, 0, grid, FPS), 300); // on a bar line, no phrase within 37 frames
  assert.equal(phraseSnap(320, 0, grid, FPS), 300); // nearest bar line
  // Loops restart the grid: a 63 s loop leaves bar lines at 63 s + k bars.
  const odd = { bar: 2, first: 0.5, loop: 63 };
  assert.equal(
    phraseSnap(Math.round(63.6 * FPS), 0, odd, FPS),
    Math.round(63.5 * FPS),
  );
  // Out of reach or before the bed began: unchanged.
  assert.equal(phraseSnap(100, 200, grid, FPS), 100);
  assert.equal(phraseSnap(130, 0, { bar: 10, first: 0, loop: 100 }, FPS), 130);
});

test("bed schedule: off, exactly the old overlap; on, the change moves to a bar line and the new bed starts on its beat", () => {
  const sections = [
    { from: 0, to: 3000, src: "music/bed_1.wav" },
    { from: 3000, to: 6000, src: "music/bed_2.wav" },
    { from: 6000, to: 9000, src: "music/unknown.wav" },
  ];
  const grid = (src: string) => BED_GRID[src.split("/").pop()!];
  const off = bedSchedule(sections, FPS, 45, false, grid);
  assert.deepEqual(
    off.map((b) => [b.from, b.span, b.inLen, b.outLen]),
    [
      [0, 3045, 0, 45],
      [2955, 3090, 45, 45],
      [5955, 3045, 45, 0],
    ],
  );
  const on = bedSchedule(sections, FPS, 45, true, grid);
  // bed_1: 2.4 s bars from 0.0227 s; 100 s = frame 3000 is 41.66 bars in: the phrase at 40 bars (96.02 s) is
  // out of reach, the bar line at 42 bars (100.82 s) within it.
  const at = Math.round((0.0227 + 42 * 2.4) * FPS);
  assert.equal(on[0]!.from + on[0]!.outAt, at);
  assert.equal(on[1]!.from + on[1]!.inAt, at);
  assert.equal(on[1]!.inLen, PHRASE_IN_FRAMES);
  // The next change follows bed_2's own grid from where it really started; the unknown bed has none.
  assert.ok(on[2]!.inLen === PHRASE_IN_FRAMES);
  assert.equal(bedEdge(on[1]!.inAt - 1, on[1]!), 0);
  assert.equal(bedEdge(on[1]!.inAt + PHRASE_IN_FRAMES, on[1]!), 1);
  assert.equal(bedEdge(on[0]!.outAt + 45, on[0]!), 0);
});

test("every bed with a grid is a real bed, its bars between 1.5 and 4 s", () => {
  const files = new Set(
    [...BEDS, ...Object.values(MOOD_BEDS).flat()].map((b) =>
      b.file.split("/").pop(),
    ),
  );
  for (const [f, g] of Object.entries(BED_GRID)) {
    assert.ok(files.has(f), f);
    assert.ok(g.bar >= 1.5 && g.bar <= 4 && g.loop > 60, f);
  }
});

// ---------------------------------------------------------------- the voice pocket

test("the pocketed copy plays under the voice and fades out in pauses, in proportion to the bed envelope", () => {
  assert.equal(pocketOf("music/bed_1.wav"), "music/pocket/bed_1.flac");
  assert.equal(
    pocketOf("http://x/music/mood_tense_2.wav"),
    "http://x/music/pocket/mood_tense_2.flac",
  );
  assert.equal(pocketWeight(0.07, 0.07, 0.11), 1);
  assert.equal(pocketWeight(0.11, 0.07, 0.11), 0);
  assert.equal(pocketWeight(0.42, 0.07, 0.11), 0);
  assert.ok(Math.abs(pocketWeight(0.09, 0.07, 0.11) - 0.5) < 1e-9);
  for (const b of [...BEDS, ...Object.values(MOOD_BEDS).flat()])
    assert.ok(
      fs.existsSync(path.join(ROOT, "public", pocketOf(b.file))),
      b.file,
    );
});

// ---------------------------------------------------------------- the voice's texture

const w = (text: string, start: number, end: number) => ({ text, start, end });

test("a quote from a call or a message is recognised by its words or picture; an interview is not", () => {
  const q = (secondary: string) => ({ kind: "quote", primary: "x", secondary });
  assert.ok(isMessageQuote(q("Dan Houser, in an email to staff")));
  assert.ok(isMessageQuote(q("a leaked voicemail")));
  assert.ok(isMessageQuote(q("Sam Houser"), "Tweet from Rockstar"));
  assert.ok(
    !isMessageQuote(
      q("Keith Hamilton, project leader"),
      "Keith Hamilton in a 1997 interview",
    ),
  );
  assert.ok(
    !isMessageQuote({ kind: "stat", primary: "x", secondary: "an email" }),
  );
});

test("the telephone band covers the quote's own words, cut in the silences either side", () => {
  const words = [
    w("He", 10, 10.2),
    w("wrote,", 10.25, 10.6),
    w("we're", 11.0, 11.2),
    w("going", 11.25, 11.5),
    w("to", 11.55, 11.6),
    w("Miami.", 11.65, 12.1),
    w("Then", 12.5, 12.7),
  ];
  const s = phoneSpan("We're going to Miami", words)!;
  assert.equal(s.kind, "phone");
  assert.ok(s.from > 10.6 && s.from <= 11.0, String(s.from));
  assert.ok(s.to >= 12.1 && s.to < 12.5, String(s.to));
  // Too short a match, or none: no span.
  assert.equal(phoneSpan("going", words), undefined);
  assert.equal(phoneSpan("nothing like this at all", words), undefined);
});

test("the voice texture plan: phone spans on message quotes (frame-aligned), reverb on long reveals, never overlapping", () => {
  const words = [
    w("She", 20, 20.2),
    w("texted", 20.3, 20.6),
    w("see", 21.0, 21.2),
    w("you", 21.3, 21.5),
    w("tomorrow", 21.6, 22.1),
  ];
  const windows = [
    { entry: 0, moment: 1, start: 20, end: 23 },
    { entry: 0, moment: 2, start: 23, end: 26 },
  ];
  const moments = [
    [
      undefined,
      {
        show: "a text message",
        graphic: {
          kind: "quote",
          primary: "see you tomorrow",
          secondary: "a friend",
        },
      },
      { show: "x", graphic: { kind: "none", primary: "", secondary: "" } },
    ],
  ];
  const beats: BeatCue[] = [
    { kind: "reveal", at: 700, start: 690, end: 780 }, // 23-26 s: three seconds
    { kind: "reveal", at: 615, start: 600, end: 660 }, // overlaps the phone span: left out
    { kind: "reveal", at: 1000, start: 990, end: 1020 }, // one second: too short to swell
  ];
  const plan = voiceFxPlan(windows, moments, words, beats, FPS);
  assert.deepEqual(
    plan.map((p) => p.kind),
    ["phone", "reverb"],
  );
  const p = plan[0]!;
  assert.equal(Math.round(p.from * FPS), p.from * FPS);
  assert.equal(Math.round(p.to * FPS), p.to * FPS);
  assert.deepEqual([plan[1]!.from, plan[1]!.to], [23, 26]);
});

test("the dry narration and the telephone slice always sum to one, and the reverb swells over its line", () => {
  const spans = [{ kind: "phone" as const, from: 10, to: 11 }];
  for (const f of [299, 300, 301, 302, 315, 328, 329, 330]) {
    const d = dryLevel(f, spans, FPS);
    assert.ok(d >= 0 && d <= 1);
  }
  assert.equal(dryLevel(299, spans, FPS), 1);
  assert.equal(dryLevel(300, spans, FPS), 1);
  assert.equal(dryLevel(302, spans, FPS), 0);
  assert.equal(dryLevel(315, spans, FPS), 0);
  assert.equal(dryLevel(330, spans, FPS), 1);
  assert.equal(dryLevel(315, [{ kind: "reverb", from: 10, to: 11 }], FPS), 1);
  assert.equal(reverbLevel(0, 90), REVERB_WET_START);
  assert.equal(reverbLevel(90, 90), REVERB_WET_PEAK);
  assert.equal(reverbLevel(200, 90), REVERB_WET_PEAK);
  assert.ok(reverbLevel(45, 90) < (REVERB_WET_START + REVERB_WET_PEAK) / 2);
});

test("the owner's line names what the sound craft will do, and says when it is off", () => {
  const on = soundCraftLine(
    "Vice City",
    { ...CRAFT_OFF, jl: true, foley: true, risers: true, voiceFx: true },
    { jl: 12, risers: 0, buttons: 3, phone: 1, reverb: 0 },
  );
  assert.match(on, /12 game clips lead or trail/);
  assert.match(on, /make their own small sounds/);
  assert.match(on, /1 message quote through a telephone band/);
  assert.doesNotMatch(on, /riser|chapter ending/);
  assert.doesNotMatch(on, /—/);
  assert.match(
    soundCraftLine("x", CRAFT_OFF, {
      jl: 0,
      risers: 0,
      buttons: 0,
      phone: 0,
      reverb: 0,
    }),
    /off/,
  );
});

test("every looping music bed in the long video keeps its volume curve across loops (no replayed lift at a loop point)", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "src", "render", "Long.tsx"),
    "utf8",
  );
  // Each <Audio ...> element up to its "/>" (its props hold arrow functions, so no [^>] matching).
  const loops = src
    .split("<Audio")
    .slice(1)
    .map((s) => s.slice(0, s.indexOf("/>")))
    .filter((a) => /^\s*loop\s*$/m.test(a));
  assert.ok(loops.length >= 2);
  for (const a of loops) assert.match(a, /loopVolumeCurveBehavior="extend"/);
});
