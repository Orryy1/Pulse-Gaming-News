import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  OBJECT_SCENES,
  SILHOUETTE_SCENES,
  boxOf,
  driveOf,
  eraOf,
  monthOf,
  objectsDecision,
  objectsFor,
  phoneOf,
  recorderOf,
  sceneYear,
  silhouetteDecision,
  silhouetteFor,
  type SceneMoment,
} from "../src/render/components/objects/choose.ts";
import { SCENE_STYLES } from "../src/render/components/objects/index.ts";
import {
  boardStrokes,
  monthGrid,
} from "../src/render/components/objects/Objects.tsx";
import {
  alongPolyline,
  handAt,
} from "../src/render/components/objects/kit.tsx";

const bare = (show = "", broll = ""): SceneMoment => ({
  show,
  broll,
  person: "",
  graphic: { kind: "none" },
});
const ch = (year?: number) => ({ game: "Grand Theft Auto: Vice City", year });

test("each period-object scene is chosen from the words that ask for it", () => {
  const cases: Array<[string, string, number?]> = [
    ["The team spent months rewriting the engine.", "desk"],
    [
      "By October 15, development stopped and the discs went to manufacturing.",
      "discs",
    ],
    [
      "The publisher faxed over a letter of intent the next morning.",
      "fax",
      1998,
    ],
    ["Then the phone calls started coming in from every publisher.", "phone"],
    ["Most of the team worked through the night to hit it.", "clock"],
    ["The schedule didn't survive contact with the game.", "calendar"],
    ["They mapped it out on a whiteboard in the first week.", "whiteboard"],
    ["Even the voice work was hard to count.", "booth"],
    ["The source code sat on a single drive in the office.", "drive"],
    ["In 1999 the studio moved into a bigger office across town.", "moving"],
  ];
  for (const [sentence, scene, year] of cases) {
    const c = objectsFor(sentence, bare(), ch(year ?? 2001));
    assert.equal(c?.scene, scene, sentence);
    assert.equal(c?.style, `Objects/${scene}`);
    assert.ok(c!.confidence >= 0.7, `${sentence}: ${c!.confidence}`);
    assert.equal(c?.tag, "ILLUSTRATION");
  }
});

test("each silhouette scene is chosen from the words that ask for it", () => {
  const cases: Array<[string, string]> = [
    ["The leads met with the publisher's board every Friday.", "meeting"],
    [
      "Each time, the crew had to talk them into letting the work continue.",
      "pitch",
    ],
    ["Developers hadn't had a proper break after Vice City.", "crunch"],
    ["Then the ownership changed.", "handshake"],
    ["Two of the lead designers quit before the game was finished.", "walkout"],
    ["Fans queued around the block for the midnight launch.", "queue"],
    ["The whole studio celebrated when the game went gold.", "cheer"],
  ];
  for (const [sentence, scene] of cases) {
    const c = silhouetteFor(sentence, bare(), ch(2002));
    assert.equal(c?.scene, scene, sentence);
    assert.equal(c?.style, `Silhouettes/${scene}`);
  }
});

test("the writer's shot note can ask for a scene the sentence only hints at, and agreement raises confidence", () => {
  const s = "The demand was real.";
  const withNote = silhouetteFor(
    s,
    bare("Crowds queueing for Vice City", "people queueing at a shop"),
    ch(2002),
  );
  assert.equal(withNote?.scene, "queue");
  assert.ok(withNote!.confidence > 0.8);
  assert.match(withNote!.reason, /shot note/);
  // The sentence's weak word alone is not enough.
  assert.equal(silhouetteFor(s, bare(), ch(2002)), undefined);
});

test("the stock note alone never picks a scene: 'office at night' is the writer's default", () => {
  const d = objectsDecision(
    "Nobody outside the studio knows it yet.",
    bare("Closed studio door, secret project", "office at night"),
    ch(2002),
  );
  assert.equal(d.candidate, undefined);
  assert.match(d.declined!, /nothing in the words/);
  assert.equal(
    silhouetteFor(
      "The free updates had a business underneath them.",
      bare("Money flowing beneath updates", "office at night"),
      ch(2013),
    ),
    undefined,
  );
});

test("declines: a graphic, a sensitive subject, a figure, reported words and the game itself", () => {
  const withGraphic = {
    ...bare("Developers at desks"),
    graphic: { kind: "stat" },
  };
  assert.match(
    objectsDecision("The team rewrote the engine.", withGraphic, ch(2001))
      .declined!,
    /graphic/,
  );
  assert.match(
    silhouetteDecision(
      "One long-time employee quit in objection to how Rockstar portrayed African Americans.",
      bare("Empty desk of departing employee", "empty office desk"),
      ch(2004),
    ).declined!,
    /sensitive/,
  );
  assert.match(
    objectsDecision(
      "After the September 11 attacks, Rockstar delayed the game.",
      bare(),
      ch(2001),
    ).declined!,
    /sensitive/,
  );
  assert.match(
    silhouetteDecision(
      "In March or April 2005, 60 to 70 Rockstar North staff spent a week and a half there.",
      bare("Rockstar North staff on a New York research trip"),
      ch(2008),
    ).declined!,
    /figure/,
  );
  assert.match(
    objectsDecision(
      'Destructoid\'s Chris Carter called it a "messy launch" that should have been delayed.',
      bare("Destructoid review of Online"),
      ch(2013),
    ).declined!,
    /said/,
  );
  assert.match(
    objectsDecision(
      "The second week went no better.",
      bare("Players stuck in menus in week two"),
      ch(2013),
    ).declined!,
    /game itself/,
  );
});

test("words that only look like a scene are not taken", () => {
  // "called" as naming, "build" as a verb, resources "moved", download codes.
  assert.equal(
    objectsFor(
      "He called the job of following up San Andreas a nightmare.",
      bare(),
      ch(2008),
    )?.scene,
    undefined,
  );
  assert.equal(
    objectsFor("That's one way to build a mailing list.", bare(), ch(2013)),
    undefined,
  );
  assert.equal(
    objectsFor(
      "Planned single-player DLC had been scrapped, its resources moved to GTA Online.",
      bare(),
      ch(2013),
    ),
    undefined,
  );
  assert.equal(
    objectsFor(
      "Physical copies will hold download codes instead of discs.",
      bare(),
      ch(2026),
    ),
    undefined,
  );
});

test("a game title is not a sensitive word: Red Dead stays drawable", () => {
  const c = silhouetteFor(
    "Crunch on Red Dead Redemption 2 became the story of the year.",
    bare(),
    ch(2018),
  );
  assert.equal(c?.scene, "crunch");
});

test("a cheer is never offered for a line of bad news", () => {
  assert.equal(
    silhouetteFor(
      "Nobody celebrated when the game finally shipped.",
      bare(),
      ch(2002),
    ),
    undefined,
  );
});

test("people are drawn anonymously when the line names someone, and the reason says so", () => {
  const m = { ...bare("Sam Houser at a meeting"), person: "Sam Houser" };
  const c = silhouetteFor(
    "Sam Houser met with the leads every morning.",
    m,
    ch(2001),
  );
  assert.equal(c?.scene, "meeting");
  assert.match(c!.reason, /anonymous/);
});

test("the year comes from the sentence first, so a fax is declined on a modern line", () => {
  assert.equal(
    sceneYear("It's November 2004, and the game is out.", ch(2008)),
    2004,
  );
  assert.equal(sceneYear("The game is out.", ch(2008)), 2008);
  assert.equal(
    objectsFor("The publisher faxed a contract in 2013.", bare(), ch(2001)),
    undefined,
  );
  assert.equal(
    objectsFor("The publisher faxed a contract in 1997.", bare(), ch(2013))
      ?.scene,
    "fax",
  );
  const c = objectsFor(
    "The publisher faxed a contract in 1997.",
    bare(),
    ch(2013),
  );
  assert.equal(c?.year, 1997);
  assert.equal(c?.era, "crt");
});

test("era rules: CRT to 2005, and each object's period by year", () => {
  assert.equal(eraOf(2005), "crt");
  assert.equal(eraOf(2006), "flat");
  assert.equal(eraOf(undefined), "flat");
  assert.equal(phoneOf(1999), "pager");
  assert.equal(phoneOf(2000), "flip");
  assert.equal(phoneOf(2007), "flip");
  assert.equal(phoneOf(2008), "smart");
  assert.equal(driveOf(1998), "floppy");
  assert.equal(driveOf(2005), "spindle");
  assert.equal(driveOf(2006), "hdd");
  assert.equal(recorderOf(2003), "tape");
  assert.equal(recorderOf(2004), "screen");
  assert.equal(boxOf(1995), "cartridge");
  assert.equal(boxOf(2005), "jewel");
  assert.equal(boxOf(2006), "keep");
});

test("the calendar takes a month only when the sentence names one, and May only as a month", () => {
  assert.equal(monthOf("The deadline was set for March 2001."), "March");
  assert.equal(monthOf("They may ship it late."), undefined);
  assert.equal(monthOf("It slipped to May 2008."), "May");
  assert.equal(monthOf("Work stopped in May."), "May");
  const c = objectsFor(
    "The release date slipped to October.",
    bare(),
    ch(2002),
  );
  assert.equal(c?.scene, "calendar");
  assert.equal(c?.month, "October");
  assert.equal(
    objectsFor("The schedule slipped again.", bare(), ch(2002))?.month,
    undefined,
  );
});

test("a calendar grid is the real month when the year is known", () => {
  // 1 January 2024 was a Monday; February 2024 had 29 days; 1 October 2026 is a Thursday.
  assert.deepEqual(monthGrid("January", 2024, 0), { days: 31, offset: 0 });
  assert.deepEqual(monthGrid("February", 2024, 0), { days: 29, offset: 3 });
  assert.deepEqual(monthGrid("October", 2026, 0), { days: 31, offset: 3 });
  assert.equal(monthGrid(undefined, undefined, 7).days, 31);
});

test("Vice City's bare lines: the choosers take the drawable ones and force nothing on the rest", () => {
  const rows: Array<[string, string, string, number, string | undefined]> = [
    [
      "The schedule didn't survive contact with the game.",
      "Calendar pages flipping, missed deadlines",
      "calendar pages turning",
      1997,
      "Objects/calendar",
    ],
    [
      "Each time, the crew had to talk them into letting the work continue.",
      "Team pitching to managers in a meeting",
      "business meeting",
      1997,
      "Silhouettes/pitch",
    ],
    [
      "The real fix wasn't technical.",
      "Programmer debugging code on screen",
      "programmer typing code",
      1997,
      "Objects/desk",
    ],
    [
      "Then the ownership changed.",
      "Studio ownership changing hands",
      "business handshake",
      2001,
      "Silhouettes/handshake",
    ],
    [
      "Even the voice work was hard to count.",
      "Recording booth with voice actor",
      "voice actor recording studio",
      2001,
      "Objects/booth",
    ],
    [
      "The demand was real.",
      "Crowds queueing for Vice City",
      "people queueing at a shop",
      2002,
      "Silhouettes/queue",
    ],
    [
      "Developers hadn't had a proper break after Vice City.",
      "Developers with no break after Vice City",
      "tired programmer at desk",
      2004,
      "Silhouettes/crunch",
    ],
    [
      "The wait didn't hurt.",
      "Fans waiting for the release",
      "people queueing at a shop",
      2013,
      "Silhouettes/queue",
    ],
    [
      "The game was a commercial success.",
      "Original GTA box on store shelf",
      "",
      1997,
      undefined,
    ],
    ["Critics agreed.", "Critics praise Vice City", "", 2002, undefined],
    [
      "Others watched the game freeze while loading early missions.",
      "Game frozen on loading screen",
      "",
      2013,
      undefined,
    ],
  ];
  for (const [s, show, broll, year, want] of rows) {
    const m = bare(show, broll);
    const got = [objectsFor(s, m, ch(year)), silhouetteFor(s, m, ch(year))]
      .filter(Boolean)
      .sort((a, b) => b!.confidence - a!.confidence)[0];
    assert.equal(got?.style, want, s);
  }
});

test("the registry draws every scene the choosers can return", () => {
  for (const s of OBJECT_SCENES) {
    assert.equal(SCENE_STYLES[`Objects/${s}`]?.area, "objects");
    assert.equal(typeof SCENE_STYLES[`Objects/${s}`]?.component, "function");
  }
  for (const s of SILHOUETTE_SCENES) {
    assert.equal(SCENE_STYLES[`Silhouettes/${s}`]?.area, "silhouettes");
    assert.equal(
      typeof SCENE_STYLES[`Silhouettes/${s}`]?.component,
      "function",
    );
  }
  assert.equal(
    Object.keys(SCENE_STYLES).length,
    OBJECT_SCENES.length + SILHOUETTE_SCENES.length,
  );
});

test("the drawn scenes stay deterministic and free of live blurs", async () => {
  const dir = path.join(
    import.meta.dirname,
    "..",
    "src",
    "render",
    "components",
    "objects",
  );
  const BANNED = [
    /Math\.random\(/,
    /Date\.now\(/,
    /new Date\(\)/,
    /performance\.now\(/,
    /\bfetch\(/,
    /from "node:/,
    /backdropFilter/,
    /filter:\s*["'`][^"'`]*blur\(/,
  ];
  for (const f of await fs.readdir(dir)) {
    const src = await fs.readFile(path.join(dir, f), "utf8");
    for (const re of BANNED) assert.doesNotMatch(src, re, `${f} matches ${re}`);
    assert.doesNotMatch(src, /—/, `${f} has an em dash`);
  }
});

test("geometry helpers: the whiteboard's strokes are fixed per variant and a pen rides their ends", () => {
  assert.deepEqual(boardStrokes(0), boardStrokes(0));
  assert.notDeepEqual(boardStrokes(0), boardStrokes(1));
  const pts: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
  ];
  assert.deepEqual(alongPolyline(pts, 0), [0, 0]);
  assert.deepEqual(alongPolyline(pts, 0.5), [10, 0]);
  assert.deepEqual(alongPolyline(pts, 1), [10, 10]);
  // Two figures 340 px apart at scale 1.15 meet hand to hand with the handshake's reach.
  const [hx] = handAt([70, 10]);
  assert.ok(Math.abs(790 + hx * 1.15 - (1130 - hx * 1.15)) < 30);
});
