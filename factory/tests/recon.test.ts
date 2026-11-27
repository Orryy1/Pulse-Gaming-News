import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clipTags,
  gameWorlds,
  judgeRecon,
  reconFor,
  reconForChapter,
  reconForVideo,
  RECON_MIN_CONFIDENCE,
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
  MIN_LUMA,
  clipVerdict,
  frameFault,
  frameStats,
} from "../src/assets/reconcheck.ts";
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
    label: "Aerial view of city through clouds",
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
  assert.ok(reconFor(2, m("Empty roads across the city"), ch, v));
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

test("a clip stages one reconstruction per video, across chapters too", () => {
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
  const used = new Set<number>();
  const got = reconForChapter(
    ch,
    [m(), m(), m(), m(), m()],
    [1, 2, 4],
    one,
    used,
  );
  // Three lines want it, even 40 s apart: only one gets it.
  assert.equal(got.size, 1);
  assert.deepEqual([...used], [0]);
  // The same set passed to the next chapter keeps it out there too.
  const again = reconForChapter(
    ch,
    [m(), m(), m(), m(), m()],
    [1, 2, 4],
    one,
    used,
  );
  assert.equal(again.size, 0);
});

test("an aircraft in shot is not a view from the air", () => {
  const heli = clipTags("Helicopter flying over building");
  assert.ok(!("refuse" in heli));
  assert.ok(!heli.tags.includes("aerial") && !heli.tags.includes("city"));
  const view = clipTags("Aerial view of city through clouds");
  assert.ok(!("refuse" in view) && view.tags.includes("aerial"));
  // A New York trip line no longer takes the helicopter close-up (31 Oct 2026 sheet).
  const ch: ReconChapter = {
    entry: 4,
    game: "Grand Theft Auto IV",
    sentences: ["x", "Then the team went to New York."],
  };
  const c = reconFor(1, m("New York skyline from the air"), ch, [
    {
      file: "h.mp4",
      beatIndex: 4,
      label: "Helicopter flying over building",
      durationSeconds: 5,
    },
  ]);
  assert.equal(c, undefined);
});

test("abstract lines are not staged on a mood; the bar is 0.6", () => {
  const ch: ReconChapter = {
    entry: 2,
    game: "Grand Theft Auto: Vice City",
    sentences: ["x", "Nobody outside the studio knows it yet."],
  };
  const night: ReconClip[] = [
    {
      file: "official_1.mp4",
      beatIndex: 2,
      label: "Station wagon on dark street",
      durationSeconds: 6,
    },
  ];
  const j = judgeRecon(
    1,
    m("Closed studio door, secret project", { broll: "office at night" }),
    ch,
    night,
  );
  assert.match(j.decline!, /abstract/);
  // Two of the note's scene words matching the label is enough.
  const two = judgeRecon(
    1,
    m("A car driving down a dark street at night"),
    ch,
    night,
  );
  assert.ok(two.candidate);
  assert.ok(two.candidate.confidence >= 0.6);
  assert.equal(RECON_MIN_CONFIDENCE, 0.6);
});

test("the video pass verifies each picked clip from its frames and picks again without a failing one", async () => {
  const ch: ReconChapter = {
    entry: 1,
    game: "Grand Theft Auto III",
    sentences: ["x", "They drove the city streets at night."],
  };
  const clips: ReconClip[] = [
    {
      file: "dark.mp4",
      beatIndex: 1,
      label: "Car driving on a city street at night",
      durationSeconds: 6,
    },
    {
      file: "ok.mp4",
      beatIndex: 1,
      label: "Car on a city street at night",
      durationSeconds: 6,
    },
  ];
  const looked: string[] = [];
  const { picks, refused } = await reconForVideo(
    [{ chapter: ch, moments: [m(), m()], bare: [1] }],
    clips,
    async (c) => {
      looked.push(c.file);
      return c.file === "dark.mp4"
        ? { ok: false, reason: "3 of 3 frames fail: too dark" }
        : { ok: true, reason: "3 of 3 frames read" };
    },
  );
  assert.equal(picks.get(1)!.get(1)!.clip, 1);
  assert.match(refused.get(0)!, /too dark/);
  assert.deepEqual(looked, ["dark.mp4", "ok.mp4"]);
});

test("frame check: dark, flat and detail-free frames fail; a dark frame under a lit sky reads", () => {
  const W = 40;
  const H = 20;
  const fill = (f: (x: number, y: number) => number) => {
    const g = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) g[y * W + x] = f(x, y);
    return frameStats(g, W, H);
  };
  // Busy mid-grey detail: reads.
  const busy = fill((x, y) => ((x * 7 + y * 13) % 5) * 40 + 40);
  assert.equal(frameFault(busy), undefined);
  // Near-black with faint detail (the dark highway: luma 22): too dark.
  assert.match(
    frameFault(fill((x, y) => 15 + ((x + y) % 2) * 14))!,
    /too dark/,
  );
  // One flat grey (the grey abstract frame): flat.
  assert.match(frameFault(fill(() => 120))!, /flat/);
  // Smooth gradient, no edges: no detail.
  assert.match(frameFault(fill((x) => 60 + x * 3))!, /detail|flat/);
  // Dark street with a lit sky across the top 15% (the dusk car): reads.
  const dusk = fill((x, y) => (y < 3 ? 160 : 4 + ((x * 7 + y * 13) % 5) * 8));
  assert.ok(dusk.luma < MIN_LUMA);
  assert.equal(frameFault(dusk), undefined);
  // A clip passes on two of three frames, fails on one of three.
  assert.equal(clipVerdict([busy, busy, fill(() => 120)]).ok, true);
  assert.equal(clipVerdict([busy, fill(() => 120), fill(() => 5)]).ok, false);
  assert.equal(clipVerdict([]).ok, false);
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
      assert.ok(
        screenY > 1080 - BAR || screenX <= 0,
        `seed ${seed} frame ${f}`,
      );
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
