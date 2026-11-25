// ACE_BEDS (src/render/acebeds.ts): which Shorts take an era or genre bed, the long video's extra beds, the ident on
// the opening sting, the fantasy mood that only these beds carry, and the generated library's files. Pure, plus a
// look at public/ for the files the library names.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  aceExtraBeds,
  aceIdent,
  acePool,
  aceShortMood,
  withIdent,
  type AceLibrary,
} from "../src/render/acebeds.ts";
import { ACE_LIBRARY } from "../src/render/acebedlib.ts";
import { moodOf, musicSections } from "../src/render/musicplan.ts";
import { inKey } from "../src/render/soundscape.ts";

const lib: AceLibrary = {
  beds: [
    { file: "music/ace/retro_1.flac", key: "E", mood: "retro" },
    { file: "music/ace/synthwave_1.flac", key: "D", mood: "synthwave" },
    { file: "music/ace/fantasy_1.flac", key: "D", mood: "fantasy" },
    { file: "music/ace/tense_1.flac", key: "D", mood: "tense" },
  ],
  idents: [
    { sting: "ace/ident_1", peak: 0.4 },
    { sting: "ace/ident_2", peak: 0.5 },
  ],
};

test("aceShortMood: old games, Vice City and fantasy worlds take an ACE bed; other moods keep the house rotation", () => {
  assert.equal(
    aceShortMood({ text: "A remaster is coming.", year: 1998 }, lib),
    "retro",
  );
  assert.equal(
    aceShortMood(
      { text: "GTA 6 maps out Leonida and Vice City in the new trailer." },
      lib,
    ),
    "synthwave",
  );
  assert.equal(
    aceShortMood(
      {
        text: "Dragons, a ruined kingdom, a quest for a cursed sword and the magic that binds the realm.",
      },
      lib,
    ),
    "fantasy",
  );
  // Tense is a long video's mood, not a Short's, even with a tense bed on hand.
  assert.equal(
    aceShortMood(
      {
        text: "The delay, then crunch, then a leak and a lawsuit.",
        year: 2020,
      },
      lib,
    ),
    undefined,
  );
  // A mood with no ACE bed keeps the house rotation.
  assert.equal(
    aceShortMood(
      { text: "A remaster is coming.", year: 1998 },
      { beds: [], idents: [] },
    ),
    undefined,
  );
});

test("moodOf: fantasy only when a fantasy bed is on hand, so nothing changes with the switch off", () => {
  const base = { first: false, last: false, documentary: true, year: 2017 };
  const text =
    "Dragons, a ruined kingdom, a quest for a cursed sword and the magic that binds the realm.";
  assert.equal(moodOf({ ...base, text }), undefined);
  assert.equal(moodOf({ ...base, text, fantasy: true }), "fantasy");
  // musicSections asks has("fantasy").
  const chapters = [
    { frame: 0, text: "Opening." },
    { frame: 3000, text },
    { frame: 6000, text: "The end." },
  ];
  const off = musicSections(
    chapters,
    9000,
    true,
    100,
    100000,
    (m) => m !== "fantasy",
  );
  assert.ok(off.every((s) => s.mood !== "fantasy"));
  const on = musicSections(chapters, 9000, true, 100, 100000, () => true);
  assert.ok(on.some((s) => s.mood === "fantasy"));
});

test("acePool and aceExtraBeds: the mood's files; every bed as a long video's extra bed", () => {
  assert.deepEqual(acePool("retro", lib), ["music/ace/retro_1.flac"]);
  assert.deepEqual(acePool("hype", lib), []);
  assert.deepEqual(aceExtraBeds(lib)[2], {
    file: "music/ace/fantasy_1.flac",
    key: "D",
    mood: "fantasy",
  });
});

test("aceIdent and withIdent: the opening sting becomes the ident; the close and other sounds stay", () => {
  assert.equal(aceIdent({ beds: [], idents: [] }, 5), undefined);
  assert.equal(aceIdent(lib, 3)?.sting, "ace/ident_2");
  const cues = [
    { file: "sfx/v3/sting.mp3", frame: 0, volume: 0.4 },
    { file: "sfx/v3/air-1.mp3", frame: 120, volume: 0.2 },
    { file: "sfx/v3/sting.mp3", frame: 900, volume: 0.3 },
  ];
  const out = withIdent(cues, "sfx/v3/sting.mp3", "sfx/ace/ident_2.mp3");
  assert.deepEqual(
    out.map((c) => c.file),
    ["sfx/ace/ident_2.mp3", "sfx/v3/air-1.mp3", "sfx/v3/sting.mp3"],
  );
  assert.equal(out[0]!.volume, 0.4);
  assert.equal(withIdent(cues, "sfx/v3/sting.mp3", undefined), cues);
});

test("the generated library: every file it names is in public/, in both keys for the idents, and tuned", () => {
  const pub = path.join(import.meta.dirname, "..", "public");
  for (const b of ACE_LIBRARY.beds) {
    assert.ok(fs.existsSync(path.join(pub, b.file)), b.file);
    assert.ok(b.key === "D" || b.key === "E");
  }
  for (const i of ACE_LIBRARY.idents) {
    for (const k of ["D", "E"])
      assert.ok(
        fs.existsSync(path.join(pub, "sfx", `${i.sting}-${k}.mp3`)),
        `${i.sting}-${k}`,
      );
    assert.match(
      inKey(
        `sfx/${i.sting}.mp3`,
        ACE_LIBRARY.beds[0]?.file ?? "music/bed_1.wav",
      ),
      /-[DE]\.mp3$/,
    );
  }
  if (ACE_LIBRARY.theme)
    assert.ok(fs.existsSync(path.join(pub, ACE_LIBRARY.theme.file)));
});
