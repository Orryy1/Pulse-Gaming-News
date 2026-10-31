import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipTags,
  gameWorlds,
  judgeRecon,
  reconFor,
  reconForChapter,
  reconMaxSeconds,
  reconRate,
  hasHud,
  saysWord,
  sceneOf,
  sentenceTimes,
  type ReconChapter,
  type ReconClip,
  type ReconMoment,
} from "../src/assets/recon.ts";
import {
  BAR,
  BARS_IN,
  RECON_TAG,
  barsAt,
  gameLine,
  poseAt,
  reconGrade,
  reconMove,
} from "../src/render/reconplan.ts";

const m = (show = "", extra: Partial<ReconMoment> = {}): ReconMoment => ({
  show,
  broll: "",
  person: "",
  graphic: { kind: "none" },
  ...extra,
});

// The GTA IV chapter of the Vice City documentary (ep_20261027_865858f8), in miniature.
const gta4: ReconChapter = {
  entry: 4,
  game: "Grand Theft Auto IV",
  year: 2008,
  sentences: [
    "It's November 2004, and San Andreas has been on store shelves for barely a month.",
    "Then the team went to New York.",
    "Police officers who had worked the beat drove them around Washington Heights.",
    "Back in Scotland, New York footage played on office televisions, so artists could look up and see the city.",
    "Some key members worked 12-hour days, often without holidays.",
    "Critics agreed.",
    "One long-time employee quit in objection to how the game portrayed a lawsuit.",
    "The new map was roughly three times the size of the old one.",
  ],
  times: [0, 6, 10, 16, 24, 40, 60, 90],
};
const clips: ReconClip[] = [
  {
    file: "a.mp4",
    beatIndex: 4,
    label: "Yellow taxi driving down street",
    durationSeconds: 5.3,
  },
  {
    file: "b.mp4",
    beatIndex: 4,
    label: "Helicopter flying over building",
    durationSeconds: 2.3,
  },
  {
    file: "c.mp4",
    beatIndex: 4,
    label: "Armored trucks driving at night",
    durationSeconds: 7.9,
  },
  {
    file: "d.mp4",
    beatIndex: 4,
    label: "Car at night with tutorial text",
    durationSeconds: 7.9,
  },
  {
    file: "e.mp4",
    beatIndex: 4,
    label: "Taxi driving under elevated rail",
    durationSeconds: 5.2,
    moment: 7,
  },
  {
    file: "f.mp4",
    beatIndex: 4,
    label: "New York street at night",
    durationSeconds: 4,
    stock: true,
  },
  {
    file: "g.mp4",
    beatIndex: 3,
    label: "Car driving at night on a city street",
    durationSeconds: 6,
  },
];

test("a trip to the real city the game models is staged with the game's own city", () => {
  const c = reconFor(1, m("New York skyline from the air"), gta4, clips);
  assert.ok(c);
  assert.equal(c.area, "recon");
  assert.equal(c.kind, "reconstruction");
  assert.deepEqual(c.scene.worlds, ["liberty city"]);
  assert.ok(c.confidence >= 0.5);
  // The aerial note wants the helicopter pass over the city.
  assert.equal(clips[c.clip]!.file, "b.mp4");
});

test("a drive through the real place takes a car on an in-game street", () => {
  const c = reconFor(
    2,
    m("Washington Heights streets seen from a police car"),
    gta4,
    clips,
  );
  assert.ok(c);
  assert.equal(clips[c.clip]!.file, "a.mp4");
  assert.ok(c.confidence >= 0.8);
  assert.match(c.reason, /vehicle/);
});

test("stock footage, other chapters' clips, HUD and violent clips are never a reconstruction", () => {
  // Only the stock clip (f), another chapter's clip (g), a tutorial (d) and armoured trucks (c) show night.
  const j = judgeRecon(4, m("Developers working late at night"), gta4, clips);
  assert.equal(j.candidate, undefined);
  assert.match(j.decline!, /no clip/);
  assert.deepEqual(clipTags("Car at night with tutorial text"), {
    refuse: "text or HUD on screen",
  });
  assert.deepEqual(clipTags("Armored trucks driving at night"), {
    refuse: "violence or a chase",
  });
  assert.deepEqual(clipTags("Stylized GTA III character group artwork"), {
    refuse: "not a shot of the world",
  });
});

test("a clip pinned to another sentence within 30 seconds is not reused; further away it may be", () => {
  // e.mp4 is pinned to sentence 7 (90 s). Sentence 6 sits 30 s away: allowed; sentence 5 (40 s): 50 s away.
  const near: ReconChapter = { ...gta4, times: [0, 6, 10, 16, 24, 70, 80, 90] };
  const only = [clips[4]!];
  assert.equal(reconFor(5, m("A taxi on a street"), near, only), undefined);
  const far = reconFor(5, m("A taxi on a street"), gta4, only);
  assert.ok(far);
  assert.equal(far.reuse, true);
  assert.match(far.reason, /reused from sentence 7/);
  // Given only the text, the sentence's time is unknown: no pinned clip is reused.
  assert.equal(
    reconFor(
      gta4.sentences[5]!.replace("agreed", "x"),
      m("A taxi on a street"),
      gta4,
      only,
    ),
    undefined,
  );
});

test("a line set in a real place the game does not show, or about another game's city, is declined", () => {
  assert.match(
    judgeRecon(3, m("New York footage on office TVs in Scotland"), gta4, clips)
      .decline!,
    /object or document|Scotland/,
  );
  assert.match(
    judgeRecon(
      1,
      m("Rockstar North studio exterior in Edinburgh at night"),
      gta4,
      clips,
    ).decline!,
    /Edinburgh/,
  );
  assert.match(
    judgeRecon(7, m("Los Santos skyline teasing GTA V"), gta4, clips).decline!,
    /Los Santos/,
  );
});

test("sensitive lines, quotes, object notes, abstractions and the chapter's first line are declined", () => {
  assert.match(
    judgeRecon(6, m("An empty city street"), gta4, clips).decline!,
    /sensitive/,
  );
  assert.match(
    judgeRecon(0, m("A street"), gta4, clips).decline!,
    /title card/,
  );
  assert.match(
    judgeRecon(5, m("Critics praise the game"), gta4, clips).decline!,
    /no scene/,
  );
  assert.match(
    judgeRecon(1, m("Grand Theft Auto IV logo reveal"), gta4, clips).decline!,
    /logo/,
  );
  const quoted: ReconChapter = {
    ...gta4,
    sentences: ["x", 'He called the drive "a nightmare" on the street.'],
  };
  assert.match(judgeRecon(1, m("A street"), quoted, clips).decline!, /quote/);
  assert.match(
    judgeRecon(1, m("A street", { graphic: { kind: "map" } }), gta4, clips)
      .decline!,
    /graphic/,
  );
});

test("harmless phrases holding a sensitive word are not sensitive", () => {
  const ch: ReconChapter = {
    entry: 5,
    game: "Grand Theft Auto V",
    sentences: [
      "x",
      "Key members took research trips across Southern California, shooting photos and video.",
      "They wanted fewer dead spots on the roads.",
    ],
  };
  const v: ReconClip[] = [
    {
      file: "v.mp4",
      beatIndex: 5,
      label: "Black sports car at dusk in city",
      durationSeconds: 3,
    },
  ];
  const trip = reconFor(
    1,
    m("Research trips across Southern California"),
    ch,
    v,
  );
  assert.ok(trip);
  assert.deepEqual(trip.scene.worlds, ["los santos"]);
  assert.equal(trip.scene.survey, true);
  assert.ok(reconFor(2, m("Empty roads"), ch, v));
});

test("a named person's line never takes a clip with a game character in it", () => {
  const ch: ReconChapter = {
    entry: 2,
    game: "Grand Theft Auto: Vice City",
    sentences: ["x", "Sam Houser flew to Miami to see the city for himself."],
  };
  const withMan: ReconClip[] = [
    {
      file: "t.mp4",
      beatIndex: 2,
      label: "Tommy running on plaza, Vice City",
      durationSeconds: 4,
    },
  ];
  assert.equal(reconFor(1, m("Miami from the air"), ch, withMan), undefined);
  const empty: ReconClip[] = [
    ...withMan,
    {
      file: "c.mp4",
      beatIndex: 2,
      label: "Blue car on road toward arch",
      durationSeconds: 4.6,
    },
  ];
  const c = reconFor(1, m("Miami from the air"), ch, empty);
  assert.ok(c);
  assert.equal(empty[c.clip]!.file, "c.mp4");
  assert.deepEqual(c.scene.worlds, ["vice city"]);
});

test("night lines want night footage, and day footage under a night line scores lower", () => {
  const ch: ReconChapter = {
    entry: 1,
    game: "Grand Theft Auto III",
    sentences: ["x", "Crunch ran into the night on the city streets."],
  };
  const night = reconFor(1, m(""), ch, [
    {
      file: "n.mp4",
      beatIndex: 1,
      label: "Car passing green-lit building at night",
      durationSeconds: 7.9,
    },
  ]);
  const dusk = reconFor(1, m(""), ch, [
    {
      file: "d.mp4",
      beatIndex: 1,
      label: "Car on city street at sunset",
      durationSeconds: 7.9,
    },
  ]);
  assert.ok(night);
  assert.ok(night.scene.tags.includes("night"));
  assert.ok(!dusk || dusk.confidence < night.confidence);
});

test("clips shorter than two seconds cannot carry a slow move", () => {
  const ch: ReconChapter = {
    entry: 1,
    game: "Grand Theft Auto III",
    sentences: ["x", "They drove the streets."],
  };
  assert.equal(
    reconFor(1, m(""), ch, [
      {
        file: "s.mp4",
        beatIndex: 1,
        label: "Car on a city street",
        durationSeconds: 1.5,
      },
    ]),
    undefined,
  );
});

test("the chapter pass gives one clip to two sentences only when they are 30 seconds apart", () => {
  const ch: ReconChapter = {
    entry: 1,
    game: "Grand Theft Auto III",
    sentences: [
      "x",
      "They drove the streets.",
      "They drove the streets again.",
      "x",
      "They drove the streets once more.",
    ],
    times: [0, 5, 10, 20, 50],
  };
  const one: ReconClip[] = [
    {
      file: "s.mp4",
      beatIndex: 1,
      label: "Car on a city street",
      durationSeconds: 5,
    },
  ];
  const got = reconForChapter(ch, [m(), m(), m(), m(), m()], [1, 2, 4], one);
  // 1 and 2 are 5 s apart, so only one of them takes it; 4 is 40+ s away from either.
  assert.equal(got.size, 2);
  assert.ok(got.has(4));
  assert.ok(got.has(1) !== got.has(2));
  assert.equal(got.get(4)!.reuse, true);
});

test("worlds, words and timings", () => {
  assert.deepEqual(gameWorlds("Grand Theft Auto: Vice City"), ["vice city"]);
  assert.deepEqual(gameWorlds("Grand Theft Auto VI"), ["vice city"]);
  assert.deepEqual(gameWorlds("Grand Theft Auto V"), ["los santos"]);
  assert.deepEqual(gameWorlds("Grand Theft Auto IV"), ["liberty city"]);
  assert.deepEqual(gameWorlds("Grand Theft Auto Online"), ["los santos"]);
  assert.deepEqual(gameWorlds("Halo 3"), []);
  // A capitalised word inside a line is a name, not the thing.
  assert.equal(
    saysWord("Flying Lotus wrote music for the game.", /\bflying\b/i),
    true,
  ); // line start
  assert.equal(saysWord("Music by Flying Lotus.", /\bflying\b/i), false);
  assert.equal(saysWord("A plane flying over the city.", /\bflying\b/i), true);
  assert.deepEqual(
    sceneOf("Music by Flying Lotus.", m(""), "Grand Theft Auto V").tags,
    [],
  );
  assert.deepEqual(
    sentenceTimes({
      entry: 0,
      game: "",
      sentences: ["one two three four five six", "seven"],
    }).map((t) => Math.round(t * 10)),
    [0, 23],
  );
  assert.equal(reconRate(5, 4), 0.85);
  assert.equal(reconRate(3, 4), 0.75);
  assert.equal(reconMaxSeconds(3), 4);
});

test("the scope frame: bars close by frame 14 and the move never shows the frame's edge", () => {
  assert.equal(barsAt(0), 0);
  assert.equal(barsAt(BARS_IN), BAR);
  assert.equal(barsAt(200), BAR);
  assert.equal(BAR, 138);
  assert.ok(barsAt(5) > 0 && barsAt(5) < BAR);
  for (const tags of [[], ["aerial"], ["vehicle"], ["interior"]] as const)
    for (const seed of [1, 2, 3, 4]) {
      const mv = reconMove(seed, [...tags]);
      for (const f of [0, 40, 89]) {
        const p = poseAt(mv, f, 90);
        // Spare picture each side at this scale must exceed the drift.
        assert.ok(
          ((p.scale - 1) * 1920) / 2 > Math.abs(p.x) * p.scale,
          `x ${seed} ${tags}`,
        );
        assert.ok(
          ((p.scale - 1) * 1080) / 2 > Math.abs(p.y) * p.scale,
          `y ${seed} ${tags}`,
        );
      }
      // It keeps moving: start and end differ.
      assert.notDeepEqual(poseAt(mv, 0, 90), poseAt(mv, 89, 90));
    }
  // Deterministic and seed-dependent drift side.
  assert.deepEqual(reconMove(7, ["vehicle"]), reconMove(7, ["vehicle"]));
  const sides = new Set(
    [1, 2, 3, 4, 5, 6, 7, 8].map((s) =>
      Math.sign(reconMove(s, ["vehicle"]).to.x),
    ),
  );
  assert.equal(sides.size, 2);
});

test("the grade takes the chapter's colour and the tag is fixed words with the game's name", () => {
  assert.equal(reconGrade("#d99c7c").tint, "#d99c7c");
  assert.equal(reconGrade(null).tint, "#5f8fa3");
  assert.equal(reconGrade("not a colour").tint, "#5f8fa3");
  assert.ok(
    reconGrade("#d99c7c", ["night"]).tintOpacity >
      reconGrade("#d99c7c").tintOpacity,
  );
  assert.equal(RECON_TAG, "RECONSTRUCTION · IN-GAME");
  assert.equal(
    gameLine("Grand Theft Auto: Vice City", 2002),
    "GRAND THEFT AUTO: VICE CITY · 2002",
  );
  assert.equal(gameLine("Grand Theft Auto IV"), "GRAND THEFT AUTO IV");
  const dash = String.fromCharCode(0x2014);
  assert.equal(gameLine(`A ${dash} B`, 1), "A, B · 1");
});

test("gameplay captures are framed tight enough to push the HUD corners out of the scope frame", () => {
  // The minimap of a gameplay capture sits about 240 px in and from 840 px down (1080p frame): with the
  // HUD framing it stays off the left edge or under the bottom bar for the whole move.
  for (const seed of [1, 2, 3, 4]) {
    const mv = reconMove(seed, ["vehicle"], true);
    for (const f of [0, 45, 89]) {
      const p = poseAt(mv, f, 90);
      const screenY = 540 + (840 - 540 + p.y) * p.scale;
      const screenX = 960 + (240 - 960 + p.x) * p.scale;
      assert.ok(screenY > 1080 - BAR || screenX <= 0, `seed ${seed} frame ${f}`);
      assert.ok(((p.scale - 1) * 1920) / 2 > Math.abs(p.x) * p.scale);
    }
  }
  // Official trailer moments have no HUD; gameplay captures and the owner's recordings do.
  assert.equal(hasHud({ file: "entry_2\\assets\\official_0.mp4" }), false);
  assert.equal(hasHud({ file: "entry_2\\assets\\clip_1.mp4" }), false);
  assert.equal(hasHud({ file: "entry_2\\assets\\gameplay_3.mp4" }), true);
  assert.equal(hasHud({ file: "entry_5/assets/own_2.mp4" }), true);
  assert.equal(
    hasHud({ file: "x.mp4", credit: "GAMEPLAY: THE DOT EATERS / CC BY" }),
    true,
  );
  // With two equal clips, the trailer moment (no HUD) wins.
  const ch: ReconChapter = {
    entry: 1,
    game: "Grand Theft Auto III",
    sentences: ["x", "They drove the streets."],
  };
  const c = reconFor(1, m(""), ch, [
    {
      file: "entry_1/assets/gameplay_0.mp4",
      beatIndex: 1,
      label: "Car on a city street",
      durationSeconds: 5,
    },
    {
      file: "entry_1/assets/official_0.mp4",
      beatIndex: 1,
      label: "Car on a city street",
      durationSeconds: 5,
    },
  ]);
  assert.ok(c);
  assert.equal(c.clip, 1);
  assert.equal(c.hud, false);
});
