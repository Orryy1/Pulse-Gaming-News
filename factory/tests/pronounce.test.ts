// The pronunciation pass (12 Nov 2026): abbreviations said the way players say them, captions as written, the
// narration check's letter watch, the plan for a token the voice spelled out, and the running list of unknowns.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  applySayAs,
  knownSpokenForm,
  SAID_AS_LETTERS,
  speakable,
  speakContext,
} from "../src/voice/speakable.ts";
import {
  checkNarration,
  joinLetters,
  letterReadings,
  lettersOf,
  tokens,
} from "../src/qa/narration.ts";
import {
  contextExpansion,
  initialsMatch,
  pronunciationPlan,
  readUnknown,
  recordUnknown,
  unknownDigestLine,
} from "../src/voice/pronounce.ts";

const show = async (spoken: string) => {
  const { displayWords } = await import("../src/render/timeline.ts");
  return displayWords(
    spoken.split(" ").map((text, i) => ({ text, start: i, end: i + 1 })),
  )
    .map((w) => w.text)
    .join(" ");
};

test("abbreviations said as words or full names, letters kept where players say letters", () => {
  assert.equal(
    speakable("GOTY at TGA, a AAA hit and two AA games"),
    "Game of the Year at The Game Awards, a triple-A hit and two double-A games",
  );
  assert.equal(
    speakable("FF7 Remake, FFXIV, RE4 and MW4"),
    "Final Fantasy 7 Remake, Final Fantasy 14, Resident Evil 4 and Modern Warfare 4",
  );
  assert.equal(speakable("BO6 and RDR2"), "Black Ops 6 and Red Dead 2");
  assert.equal(speakable("PUBG, FIFA and LEGO"), "Pub-G, Fifa and Lego");
  assert.equal(
    speakable("CoD fans and WoW players"),
    "Call of Duty fans and World of Warcraft players",
  );
  // Said as letters: left for the voice to spell, which it does right.
  assert.equal(
    speakable("DLC for the PS5, PC and an RPG"),
    "DLC for the PS5, PC and an RPG",
  );
  assert.equal(speakable("GTA6, GTAV and GTA VI"), "GTA 6, GTA 5 and GTA 6");
  assert.equal(
    speakable("NBA 2K26 from EA? No, 2K"),
    "NBA 2K 26 from EA? No, 2K",
  );
  for (const t of [
    "PC",
    "PS",
    "GTA",
    "DLC",
    "RPG",
    "NPC",
    "FPS",
    "AI",
    "EA",
    "IGN",
    "CJ",
  ])
    assert.ok(SAID_AS_LETTERS.has(t), t);
});

test("symbols, versions, resolutions, frame rates, web addresses and time zones as they are said", () => {
  assert.equal(speakable("R&D at Xbox & PC"), "R and D at Xbox and PC");
  assert.equal(speakable("90% of fans"), "90 percent of fans");
  assert.equal(speakable("3.1% of fans"), "three point one percent of fans");
  assert.equal(
    speakable("Version 1.0, v1.2 and 1.1.1"),
    "Version one point oh, version one point two and one point one point one",
  );
  assert.equal(
    speakable("4K at 60fps, 1080p at 30 FPS"),
    "four K at 60 FPS, ten-eighty P at 30 FPS",
  );
  assert.equal(speakable("a $4K bonus"), "a four thousand dollars bonus");
  assert.equal(
    speakable("on mod.io and Battle.net, @PulseGMG"),
    "on mod dot I O and Battle dot net, at Pulse GMG",
  );
  assert.equal(
    speakable("GTA+ and New Game+, Series X/S"),
    "GTA Plus and New Game Plus, Series X and S",
  );
  assert.equal(
    speakable("PvP in DayZ on SteamOS"),
    "P v P in Day Z on Steam OS",
  );
  assert.equal(
    speakable("GTAGarage and NielsenIQ"),
    "GTA Garage and Nielsen IQ",
  );
  assert.equal(
    speakable("at 7pm ET and 4 p.m. PT"),
    "at 7pm Eastern and 4 p.m. Pacific",
  );
  assert.equal(speakable("the PT demo"), "the PT demo");
  assert.equal(speakable("Great news 🎉 :)"), "Great news ");
});

test("captions show the written form of what the voice respelt", async () => {
  assert.equal(await show("a triple-A hit"), "a AAA hit");
  assert.equal(await show("in four K at ten-eighty P,"), "in 4K at 1080p,");
  assert.equal(await show("P v P and Pub-G"), "PvP and PUBG");
  assert.equal(await show("version one point oh"), "version 1.0");
  assert.equal(await show("said T G G."), "said TGG.");
  assert.equal(await show("90 percent of fans"), "90% of fans");
  assert.equal(await show("for more pollish."), "for more polish.");
  // A full name is what was said, and reads well on screen as it is.
  assert.equal(await show("Game of the Year"), "Game of the Year");
});

test("the narration check hears respellings, letters and numerals as the same words", () => {
  assert.deepEqual(tokens("AAA"), tokens("triple-A"));
  assert.deepEqual(tokens("4K"), ["four", "k"]);
  assert.deepEqual(tokens("G-O-T-Y"), ["goty"]);
  assert.deepEqual(tokens("U.S."), tokens("US"));
  assert.deepEqual(tokens("XIV's"), tokens("fourteen's"));
  assert.deepEqual(tokens("obbuh"), tokens("Obbe"));
  assert.deepEqual(tokens("tohst"), tokens("t0st"));
  assert.deepEqual(tokens("8.0"), tokens("eight point zero"));
  assert.deepEqual(
    joinLetters([
      { text: "T", start: 0, end: 0.2 },
      { text: "G", start: 0.2, end: 0.4 },
      { text: "G.", start: 0.4, end: 0.6 },
      { text: "I", start: 0.7, end: 0.8 },
    ]).map((w) => w.text),
    ["TGG.", "I"],
  );
  const at = (s: string) =>
    s
      .split(" ")
      .map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
  // "Switch 2" heard as "Switch too" is the same sound (FFXIV and Ocarina Shorts, 5 Nov 2026).
  assert.equal(
    checkNarration(at("On Switch 2 you can"), at("On Switch too you can")).ok,
    true,
  );
  assert.equal(
    checkNarration(
      at("Final Fantasy fourteen's patch"),
      at("Final Fantasy XIV's patch"),
    ).ok,
    true,
  );
  assert.equal(
    checkNarration(at("said T G G today"), at("said TGG today")).ok,
    true,
  );
});

test("the letter watch finds a token the voice spelled, and leaves letters players say alone", () => {
  assert.equal(lettersOf("GOTY"), "GOTY");
  assert.equal(lettersOf("NPCs"), "NPC");
  assert.equal(lettersOf("PS5"), "PS");
  assert.equal(lettersOf("XIV"), undefined);
  assert.equal(lettersOf("Rockstar"), undefined);
  const meant = [
    { text: "won", start: 0, end: 0.3 },
    { text: "GOTY", start: 0.35, end: 1.4 },
    { text: "on", start: 1.45, end: 1.6 },
    { text: "PS5.", start: 1.65, end: 2.4 },
  ];
  // Whisper's single letters in a row.
  const letters = letterReadings(meant, [
    { text: "won", start: 0, end: 0.3 },
    { text: "G", start: 0.35, end: 0.6 },
    { text: "O", start: 0.6, end: 0.85 },
    { text: "T", start: 0.85, end: 1.1 },
    { text: "Y", start: 1.1, end: 1.4 },
    { text: "on", start: 1.45, end: 1.6 },
    { text: "PS5.", start: 1.65, end: 2.4 },
  ]);
  assert.deepEqual(
    letters.map((l) => [l.token, l.clean]),
    [["GOTY", true]],
  );
  // The capitals themselves, held 0.25 s a letter; and the hyphened form.
  assert.equal(
    letterReadings(meant, [
      { text: "won", start: 0, end: 0.3 },
      { text: "GOTY", start: 0.35, end: 1.4 },
    ]).length,
    1,
  );
  assert.equal(
    letterReadings(meant, [{ text: "G-O-T-Y", start: 0.35, end: 1.4 }]).length,
    1,
  );
  // Read as a word: quick, so nothing to flag.
  assert.equal(
    letterReadings(meant, [{ text: "GOTY", start: 0.35, end: 0.6 }]).length,
    0,
  );
  // A garbled run is not clean.
  assert.equal(
    letterReadings(meant, [
      { text: "G", start: 0.35, end: 0.6 },
      { text: "T", start: 0.6, end: 0.9 },
    ])[0]?.clean,
    false,
  );
});

test("a spelled token gets the tables' form, the script's own name, its letters or a place on the list", () => {
  assert.equal(knownSpokenForm("GOTY"), "Game of the Year");
  assert.equal(knownSpokenForm("XQZ"), undefined);
  assert.ok(initialsMatch("RE4", "Resident Evil 4"));
  assert.ok(initialsMatch("FFVII", "Final Fantasy 7"));
  assert.ok(initialsMatch("GDC", "Game Developers Conference"));
  assert.ok(!initialsMatch("GDC", "Game Awards"));
  const script = {
    game_title: "Silent Hill f",
    hook: "The Game Developers Conference (GDC) heard it first.",
    beats: [
      { narration: "In Kingdom Come Deliverance 2 the KCD2 team did it." },
    ],
  };
  assert.equal(contextExpansion("GDC", script), "Game Developers Conference");
  assert.equal(contextExpansion("KCD2", script), "Kingdom Come Deliverance 2");
  const r = (token: string, clean = true) => ({
    token,
    at: 1,
    heard: token,
    clean,
  });
  const plan = pronunciationPlan(
    [r("GOTY"), r("KCD2"), r("TR30", false), r("XQZ"), r("AA"), r("GOTY")],
    script,
  );
  assert.deepEqual(plan.sayAs, {
    GOTY: "Game of the Year",
    KCD2: "Kingdom Come Deliverance 2",
    TR30: "T R 30",
    AA: "double-A",
  });
  assert.deepEqual(
    plan.unknown.map((u) => u.token),
    ["XQZ"],
  );
  assert.equal(plan.why.KCD2, "script");
});

test("say_as reaches the voice, the segment timings and every speakable caller", async () => {
  assert.equal(
    applySayAs("RE4 and RE", { RE4: "Resident Evil 4" }),
    "Resident Evil 4 and RE",
  );
  assert.equal(
    speakable("Play TGG now", speakContext({ TGG: "T G G" })),
    "Play T G G now",
  );
  const { narrationOf } = await import("../src/editorial/schema.ts");
  const { segmentInputs } = await import("../src/pipeline.ts");
  const script = {
    hook: "KCD2 is back.",
    beats: [{ narration: "KCD2 sold well.", visual: "x" }],
    pulse_take: { narration: "Buy KCD2." },
    loop_line: "Is KCD2 next?",
    say_as: { KCD2: "Kingdom Come 2" },
  } as never;
  assert.match(
    String(narrationOf(script)),
    /^Kingdom Come 2 is back\. Kingdom Come 2 sold well\./,
  );
  assert.match(
    segmentInputs(script)
      .map((s) => s.text)
      .join(" "),
    /Buy Kingdom Come 2\. Is Kingdom Come 2 next\?/,
  );
});

test("unknown tokens go on the running list once per episode, and the digest names them until the tables know them", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pron-"));
  const file = path.join(dir, "admin", "pronunciation_unknown.json");
  const r = { token: "XQZ", at: 2, heard: "XQZ", clean: true };
  await recordUnknown(file, [r], "ep_1", new Date("2026-11-12T10:00:00Z"));
  await recordUnknown(file, [r], "ep_1", new Date("2026-11-12T11:00:00Z"));
  await recordUnknown(
    file,
    [r, { ...r, token: "GOTY" }],
    "ep_2",
    new Date("2026-11-12T12:00:00Z"),
  );
  const list = await readUnknown(file);
  assert.equal(list.XQZ!.count, 2);
  assert.deepEqual(list.XQZ!.episodes, ["ep_1", "ep_2"]);
  const line = unknownDigestLine(list)!;
  assert.match(line, /1 abbreviation the tables do not know yet: XQZ \(2\)/);
  // GOTY has a spoken form now, so it drops out of the line on its own.
  assert.doesNotMatch(line, /GOTY/);
  assert.equal(unknownDigestLine({}), undefined);
  const { alertKind } = await import("../src/alertlog.ts");
  assert.equal(
    alertKind(
      '🔤 The voice spelled out "XQZ" letter by letter in "X", and the pronunciation tables do not know it yet: logged',
    ),
    "pronunciation_unknown",
  );
});

test("the writers are told to write abbreviations the way they are said", async () => {
  const { PULSE_VOICE } = await import("../src/editorial/voice.ts");
  assert.match(
    PULSE_VOICE,
    /Write abbreviations in narration the way people say them/,
  );
  assert.match(PULSE_VOICE, /on-screen text may keep the short form/);
});
