import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseIgdbSeries, type IgdbSeriesRow } from "../src/assets/igdb.ts";
import {
  EVERY_SHOT_TARGET,
  HARDWARE_PROVENANCE,
  chapterList,
  deviceOf,
  displayTitle,
  eraAudit,
  eraOf,
  eraProblems,
  eraStampBeats,
  eraStampsFor,
  eraTrue,
  everyGameDocOutline,
  everyGameDocTopic,
  everyGameTitles,
  everyGameToScript,
  honestyProblems,
  mustFixEveryGame,
  provenanceSource,
  rosterFromIgdb,
  shortEntries,
  spokenNames,
  titleProblems,
  validateEveryGameOutline,
  validateEveryGameShort,
  type EveryGameOutline,
  type EveryGameShort,
  type SeriesRoster,
} from "../src/editorial/everygame.ts";
import {
  DEFAULT_EVERYGAME_FILE,
  everyLongDue,
  everyShortDue,
  readEveryGamePlan,
  rosterTweaks,
  type EveryGameEntry,
} from "../src/everygame.ts";
import {
  auditEveryGameAssets,
  footageBeat,
  gatherEveryGameEntry,
} from "../src/everygamestep.ts";
import { localTime } from "../src/lanes.ts";
import { planCuts } from "../src/render/plan.ts";
import {
  ERA_FRAME_H,
  ERA_FRAME_W,
  ERA_SCREENS,
} from "../src/render/EraFrame.tsx";
import { ENTRY_CARD_TOP } from "../src/render/rankcard.ts";
import { loadConfig } from "../src/config.ts";
import {
  evergreenTitle,
  keywordLead,
  pinnedComment,
} from "../src/editorial/seo.ts";
import { formatName, formatOf } from "../src/formats.ts";
import { tmpDir } from "./helpers.ts";

const NOW = new Date("2026-11-12T12:00:00Z");

const row = (
  name: string,
  date: string | undefined,
  type: number,
  platforms: string[],
  over: Partial<IgdbSeriesRow> = {},
): IgdbSeriesRow => ({
  id: Math.abs(
    [...(name + (date ?? "") + type)].reduce(
      (n, c) => (n * 31 + c.charCodeAt(0)) | 0,
      7,
    ),
  ),
  name,
  ...(date ? { date, year: Number(date.slice(0, 4)) } : {}),
  type,
  edition: false,
  platforms,
  allPlatforms: platforms,
  ratings: 100,
  screenshots: 4,
  ...over,
});

/** The series as IGDB lists it, in small: main games, expansions, ports, bundles, remasters, an app, a DLC. */
const ROWS: IgdbSeriesRow[] = [
  row("Grand Theft Auto", "1997-10-21", 0, ["DOS", "PC", "PS1"]),
  row("Grand Theft Auto: London 1969", "1999-03-31", 2, ["PC", "PS1"], {
    ratings: 59,
  }),
  row("Grand Theft Auto: Director's Cut", "1999-04-30", 3, ["PC"]),
  row("Grand Theft Auto 2", "1999-10-22", 0, ["PC", "DC"]),
  row("Grand Theft Auto 2", "1999-10-22", 11, ["PS1"]),
  row("Grand Theft Auto III", "2001-10-22", 0, ["PS2", "PC"]),
  row("Grand Theft Auto: Vice City", "2002-10-27", 0, ["PS2", "PC"]),
  row("Grand Theft Auto: San Andreas", "2004-10-26", 0, ["PS2", "PC", "XBOX"]),
  row("Grand Theft Auto Advance", "2004-10-26", 0, ["GBA"], { ratings: 25 }),
  row("Grand Theft Auto: Liberty City Stories", "2005-10-24", 0, ["PSP"]),
  row("Grand Theft Auto: Vice City Stories", "2006-10-31", 0, ["PSP", "PS2"]),
  row("Grand Theft Auto IV", "2008-04-29", 0, ["PS3", "X360", "PC"]),
  row("Grand Theft Auto: Chinatown Wars", "2009-03-17", 0, ["NDS", "PSP"]),
  row("Grand Theft Auto: iFruit", "2013-09-12", 0, ["Android", "iOS"], {
    ratings: 0,
  }),
  row("Grand Theft Auto V", "2013-09-17", 0, ["PS3", "X360"]),
  row("Grand Theft Auto V: Special Edition", "2013-09-17", 0, ["PS3"], {
    edition: true,
  }),
  row("Grand Theft Auto Online", "2014-11-18", 4, ["PS3", "X360", "PS4"], {
    ratings: 74,
  }),
  row("Grand Theft Auto Online: Heists", "2015-03-10", 14, ["PS4"]),
  row("Grand Theft Auto III: The Definitive Edition", "2021-11-11", 9, ["PS5"]),
  row("Grand Theft Auto V: Story Mode", "2022-03-15", 2, ["PS5"], {
    ratings: 16,
  }),
  row("Grand Theft Auto VI", "2026-11-19", 0, ["PS5", "Series X|S"], {
    ratings: 0,
  }),
  row("Grand Theft Auto Tokyo", undefined, 0, ["PS2"], { ratings: 0 }),
];

const roster = (): SeriesRoster =>
  rosterFromIgdb("Grand Theft Auto", ROWS, NOW, {
    short: "GTA",
    years: { "Grand Theft Auto Online": 2013 },
  });

test("IGDB's rows give each game the platforms it first came out on, earliest first", () => {
  const day = (iso: string) => Date.parse(iso) / 1000;
  const [g] = parseIgdbSeries([
    {
      id: 1,
      name: "Grand Theft Auto III",
      first_release_date: day("2001-10-22"),
      game_type: 0,
      platforms: [
        { abbreviation: "XBOX" },
        { abbreviation: "PS4" },
        { abbreviation: "PC" },
        { abbreviation: "PS2" },
      ],
      release_dates: [
        { date: day("2015-12-05"), platform: { abbreviation: "PS4" } },
        { date: day("2002-05-20"), platform: { abbreviation: "PC" } },
        { date: day("2001-10-22"), platform: { abbreviation: "PS2" } },
        { date: day("2003-11-04"), platform: { abbreviation: "XBOX" } },
      ],
      total_rating_count: 1635,
      screenshots: [{ image_id: "a" }, { image_id: "b" }],
      cover: { image_id: "c" },
    },
  ]);
  assert.deepEqual(
    g!.platforms,
    ["PS2", "PC"],
    "the Xbox port two years on and the PS4 one are not its launch",
  );
  assert.equal(g!.year, 2001);
  assert.equal(g!.type, 0);
  assert.equal(g!.screenshots, 2);
});

test("the roster keeps main games and rated expansions, in release order, and nothing else", () => {
  const r = roster();
  assert.deepEqual(
    r.entries.map((e) => `${e.year} ${e.title}`),
    [
      "1997 Grand Theft Auto",
      "1999 Grand Theft Auto: London 1969",
      "1999 Grand Theft Auto 2",
      "2001 Grand Theft Auto III",
      "2002 Grand Theft Auto: Vice City",
      "2004 Grand Theft Auto: San Andreas",
      "2004 Grand Theft Auto Advance",
      "2005 Grand Theft Auto: Liberty City Stories",
      "2006 Grand Theft Auto: Vice City Stories",
      "2008 Grand Theft Auto IV",
      "2009 Grand Theft Auto: Chinatown Wars",
      "2013 Grand Theft Auto V",
      "2013 Grand Theft Auto Online",
      "2026 Grand Theft Auto VI",
    ],
  );
  const why = new Map(r.dropped.map((d) => [d.title, d.why]));
  assert.match(why.get("Grand Theft Auto: Director's Cut")!, /bundle/);
  assert.match(
    why.get("Grand Theft Auto III: The Definitive Edition")!,
    /remaster/,
  );
  assert.match(why.get("Grand Theft Auto V: Special Edition")!, /edition/);
  assert.match(why.get("Grand Theft Auto: iFruit")!, /companion app/);
  assert.match(why.get("Grand Theft Auto V: Story Mode")!, /minor expansion/);
  assert.match(why.get("Grand Theft Auto Tokyo")!, /no release date/);
  assert.match(why.get("Grand Theft Auto Online: Heists")!, /update/);
  // An unreleased game has no ratings yet and still belongs: it is the payoff.
  assert.equal(r.entries.at(-1)!.title, "Grand Theft Auto VI");
  // The plan's own year wins over IGDB's (which dates GTA Online by its PS4 release).
  assert.equal(
    r.entries.find((e) => e.title === "Grand Theft Auto Online")!.year,
    2013,
  );
  assert.equal(r.short, "GTA");
});

test("each game sits on the hardware of its day", () => {
  const r = roster();
  const dev = (t: string) => r.entries.find((e) => e.title === t)!;
  assert.equal(
    dev("Grand Theft Auto").device,
    "crt-monitor",
    "the first game came out on PC",
  );
  assert.equal(dev("Grand Theft Auto III").device, "crt-tv");
  assert.equal(dev("Grand Theft Auto Advance").device, "handheld-wide");
  assert.equal(dev("Grand Theft Auto Advance").handheld, true);
  assert.equal(
    dev("Grand Theft Auto: Liberty City Stories").device,
    "handheld-wide",
  );
  assert.equal(dev("Grand Theft Auto: Chinatown Wars").device, "handheld-dual");
  assert.equal(dev("Grand Theft Auto IV").device, "flat-tv");
  assert.equal(dev("Grand Theft Auto IV").handheld, false);
  assert.deepEqual(dev("Grand Theft Auto IV").platforms, [
    "PS3",
    "Xbox 360",
    "PC",
  ]);
  assert.equal(deviceOf(["GB"], 1992), "handheld-brick");
  assert.equal(deviceOf(["PC"], 2012), "flat-monitor");
  assert.equal(
    deviceOf(["iOS", "PS2"], 2003),
    "crt-tv",
    "a phone port never decides the hardware",
  );
});

test("the year stamp lands on the first game and on each new console era, never on a handheld", () => {
  const r = roster();
  const at = eraStampBeats(r.entries).map((i) => r.entries[i]!.year);
  assert.deepEqual(at, [1997, 2001, 2008, 2013, 2026]);
  assert.equal(eraOf(2006), "Comet");
  // Vice City Stories (PSP, 2006) is in the new generation's years and still does not open the era.
  assert.ok(
    !eraStampBeats(r.entries).includes(
      r.entries.findIndex((e) => e.title.endsWith("Vice City Stories")),
    ),
  );
});

test("a Short takes every game, the main games when there are too many, or declines", () => {
  const r = roster();
  assert.equal(shortEntries(r).scope, "every");
  const many: SeriesRoster = {
    ...r,
    entries: [
      ...Array.from({ length: 16 }, (_, i) => ({
        ...r.entries[3]!,
        title: `Game ${i}`,
        year: 2000 + i,
      })),
      ...Array.from({ length: 6 }, (_, i) => ({
        ...r.entries[1]!,
        title: `Pack ${i}`,
        year: 2001 + i,
      })),
    ],
  };
  const main = shortEntries(many);
  assert.equal(main.scope, "mainline");
  assert.equal(main.entries.length, 16);
  assert.equal(
    shortEntries({ ...r, entries: r.entries.slice(0, 3) }).scope,
    "too_few",
  );
  assert.equal(
    shortEntries({
      ...r,
      entries: Array.from({ length: 30 }, (_, i) => ({
        ...r.entries[3]!,
        title: `G${i}`,
      })),
    }).scope,
    "too_many",
  );
});

test("Pulse never claims to have played them: the narration and the title stay in the honest frame", () => {
  assert.equal(
    honestyProblems(
      "I'd argue GTA 2 still gets overlooked. For me, Vice City is the peak.",
    ).length,
    0,
  );
  assert.equal(
    honestyProblems(
      "I think San Andreas is the best one, and I could be wrong.",
    ).length,
    0,
  );
  for (const lie of [
    "I played every one of these.",
    "We've finished all 17.",
    "I grew up with Vice City.",
    "My first copy was on PS2.",
    "When I was a kid this was everything.",
    "I've beaten GTA 3 four times.",
  ])
    assert.equal(honestyProblems(lie).length, 1, lie);
  assert.equal(
    honestyProblems('Houser said "I played it for a year" and meant it.')
      .length,
    0,
    "a quoted person may",
  );
  const r = roster();
  for (const t of [
    ...everyGameTitles("GTA"),
    "The Story of Every GTA Game in 60 Seconds",
  ])
    assert.deepEqual(titleProblems(t, r), [], t);
  assert.match(
    titleProblems("I Played Every GTA Game", r)[0]!,
    /claims Pulse played/,
  );
  assert.match(titleProblems("Every GTA Game Ranked", r)[0]!, /ranking/);
  assert.match(titleProblems("The Whole GTA Story", r)[0]!, /Every GTA Game/);
});

const LINES: Record<string, [string, string]> = {
  "Grand Theft Auto": [
    "The first GTA was top-down chaos from Dundee.",
    "TOP-DOWN CHAOS",
  ],
  "Grand Theft Auto: London 1969": [
    "London 1969 took the crime spree to England.",
    "SWINGING LONDON",
  ],
  "Grand Theft Auto 2": [
    "I'd argue GTA 2 still gets overlooked.",
    "RETRO FUTURE",
  ],
  "Grand Theft Auto III": ["GTA 3 dragged Liberty City into 3D.", "FIRST 3D"],
  "Grand Theft Auto: Vice City": [
    "Vice City gave you neon Miami and a soundtrack.",
    "NEON NIGHTS",
  ],
  "Grand Theft Auto: San Andreas": [
    "San Andreas went bigger than anyone asked for.",
    "THREE CITIES",
  ],
  "Grand Theft Auto Advance": [
    "GTA Advance shrank Liberty City for Game Boy.",
    "POCKET SIZED",
  ],
  "Grand Theft Auto: Liberty City Stories": [
    "Liberty City Stories put 3D in your pocket.",
    "HANDHELD 3D",
  ],
  "Grand Theft Auto: Vice City Stories": [
    "Vice City Stories is the handheld I'd defend.",
    "UNDERRATED",
  ],
  "Grand Theft Auto IV": [
    "Everyone calls GTA 4 gloomy, and I disagree.",
    "GRITTY HD",
  ],
  "Grand Theft Auto: Chinatown Wars": [
    "Chinatown Wars brought the top-down camera back.",
    "TOP-DOWN RETURNS",
  ],
  "Grand Theft Auto V": [
    "GTA 5 let you swap between three leads.",
    "THREE LEADS",
  ],
  "Grand Theft Auto Online": [
    "For me, GTA Online is why the wait got so long.",
    "NEVER ENDING",
  ],
  "Grand Theft Auto VI": [
    "GTA 6 arrives with everything to prove.",
    "THE WAIT",
  ],
};

const draft = (over: Partial<EveryGameShort> = {}): EveryGameShort => ({
  hook: "You know GTA 5. Here are all 14, in order.",
  entries: roster().entries.map((e) => ({
    game_title: e.title,
    line: LINES[e.title]![0],
    caption: LINES[e.title]![1],
    footage: { want: "gameplay", keywords: [e.title] },
  })),
  payoff: {
    label: "THE TAKE",
    narration:
      "No series stayed this good for this long. I'd put that run against anything in games.",
    on_screen: "Gaming's best run",
  },
  loop_line: "Now you know more than GTA 5.",
  youtube: {
    title: "The Story of Every GTA Game in 60 Seconds",
    description:
      "Every Grand Theft Auto game in release order, one line each, with our honest take.",
    tags: ["gta"],
  },
  claims: [{ claim: "GTA III was the first in 3D", source: "wikipedia" }],
  ...over,
});

test("a Short that keeps the roster, the lengths and the friend's voice passes", () => {
  const r = roster();
  assert.deepEqual(
    validateEveryGameShort(draft(), r, r.entries, {
      title: "The Story of Every GTA Game in 60 Seconds",
    }),
    [],
  );
  assert.deepEqual(mustFixEveryGame(draft(), r, r.entries), []);
});

test("the writer can never change the roster, its order or the honest frame", () => {
  const r = roster();
  const d = draft();
  const dropped = {
    ...d,
    entries: d.entries.filter((e) => !e.game_title.includes("Advance")),
  };
  assert.match(
    mustFixEveryGame(dropped, r, r.entries).join(" "),
    /Missing: Grand Theft Auto Advance/,
  );
  const added = {
    ...d,
    entries: [
      ...d.entries,
      {
        ...d.entries[0]!,
        game_title: "Grand Theft Auto III: The Definitive Edition",
      },
    ],
  };
  assert.match(
    mustFixEveryGame(added, r, r.entries).join(" "),
    /Not in the roster: Grand Theft Auto III: The Definitive Edition/,
  );
  const swapped = {
    ...d,
    entries: [d.entries[1]!, d.entries[0]!, ...d.entries.slice(2)],
  };
  assert.match(
    mustFixEveryGame(swapped, r, r.entries).join(" "),
    /out of order/,
  );
  const lied = {
    ...d,
    entries: d.entries.map((e, i) =>
      i === 4 ? { ...e, line: "I played Vice City for a whole summer." } : e,
    ),
  };
  assert.match(
    mustFixEveryGame(lied, r, r.entries).join(" "),
    /claims an experience/,
  );
  const ranked = {
    ...d,
    youtube: { ...d.youtube, title: "Every GTA Game Ranked" },
  };
  assert.match(mustFixEveryGame(ranked, r, r.entries).join(" "), /ranking/);
  assert.match(
    mustFixEveryGame(d, r, r.entries, {
      title: "The Story of Every GTA Game",
    }).join(" "),
    /youtube.title must be/,
  );
});

test("the house rules catch a line that is too long, unnamed, or a caption that is a year", () => {
  const r = roster();
  const d = draft();
  const edit = (
    i: number,
    over: Partial<EveryGameShort["entries"][number]>,
  ) => ({
    ...d,
    entries: d.entries.map((e, k) => (k === i ? { ...e, ...over } : e)),
  });
  assert.match(
    validateEveryGameShort(
      edit(3, {
        line: "GTA 3 took the whole idea, rebuilt it in three dimensions and changed what open worlds could be.",
      }),
      r,
      r.entries,
    ).join(" "),
    /at most 11/,
  );
  assert.match(
    validateEveryGameShort(
      edit(3, { line: "This one dragged Liberty City into 3D." }),
      r,
      r.entries,
    ).join(" "),
    /never names the game/,
  );
  assert.match(
    validateEveryGameShort(edit(3, { caption: "2001" }), r, r.entries).join(
      " ",
    ),
    /never a year/,
  );
  assert.match(
    validateEveryGameShort(
      edit(3, { caption: "THE BIG LEAP FORWARD" }),
      r,
      r.entries,
    ).join(" "),
    /one or two short words/,
  );
  const flat = {
    ...d,
    hook: "Here are all 14 GTA games, in order.",
    entries: d.entries.map((e) => ({
      ...e,
      line: e.line.replace(
        /I'd argue |, and I disagree|I'd defend|For me, |your |you /g,
        "",
      ),
    })),
    payoff: {
      ...d.payoff,
      narration: "No series stayed this good for this long.",
    },
    loop_line: "That is the whole run.",
  };
  const problems = validateEveryGameShort(flat, r, r.entries).join(" ");
  assert.match(problems, /owns a take/);
  assert.match(problems, /"You" is said/);
});

test("the game is named the way people say it", () => {
  const r = roster();
  const names = (t: string) => spokenNames({ title: t }, r);
  assert.deepEqual(names("Grand Theft Auto"), ["gta", "grand theft auto"]);
  assert.deepEqual(names("Grand Theft Auto III"), ["3"]);
  assert.deepEqual(names("Grand Theft Auto: Vice City Stories"), [
    "vice",
    "city",
    "stories",
  ]);
  assert.ok(
    names("Grand Theft Auto IV: The Lost and Damned").includes("damned"),
  );
  assert.equal(
    displayTitle("Grand Theft Auto: Vice City", r),
    "GTA: Vice City",
  );
  assert.equal(displayTitle("Grand Theft Auto IV", r), "GTA IV");
  assert.equal(
    displayTitle("Halo 3", { series: "Halo", short: "Halo" }),
    "Halo 3",
  );
});

test("the Script is one beat per game in release order, years from the roster, the newest game last", () => {
  const r = roster();
  const s = everyGameToScript(draft(), r, r.entries);
  assert.equal(s.evergreen_format, "every_game");
  assert.equal(s.beats.length, 14);
  assert.ok(
    s.beats.every((b) => b.visual.kind === "rank"),
    "rank beats: the plan gives a beat only its own game's pictures",
  );
  assert.deepEqual(
    s.beats.map((b) => b.visual.value_a),
    [14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  );
  assert.equal(s.beats[0]!.visual.primary, "GTA");
  assert.deepEqual(s.beats[3]!.visual.items, ["2001", "PS2, PC"]);
  assert.equal(s.beats[3]!.visual.secondary, "FIRST 3D");
  assert.equal(s.entries!.at(-1)!.game_title, "Grand Theft Auto VI");
  assert.equal(
    s.entries!.at(-1)!.rank,
    1,
    "the newest game is where the take's picture comes from",
  );
  assert.ok(
    s.entries!.every((e) => e.steam_search_term === ""),
    "never the store: an old game's page is its remaster",
  );
  assert.deepEqual(
    s.every_game!.beats.filter((b) => b.stamp).map((b) => b.year),
    [1997, 2001, 2008, 2013, 2026],
  );
  assert.equal(s.every_game!.beats[6]!.device, "handheld-wide");
  assert.equal(s.pulse_take.narration, draft().payoff.narration);
  assert.equal(formatOf("evergreen", s), "every_game");
  assert.equal(formatName("every_game"), "Every-game Shorts");
  // The title is the plan's own, never rebuilt as a ranking's.
  assert.equal(evergreenTitle(s), "The Story of Every GTA Game in 60 Seconds");
  assert.match(
    keywordLead(s),
    /^Every GTA game in release order, from 1997 to 2026/,
  );
  assert.doesNotMatch(keywordLead(s), /ranked/i);
  assert.match(pinnedComment(s), /Which GTA game was the one for you/);
});

test("the year stamps are timed to the start of their beats", () => {
  const r = roster();
  const s = everyGameToScript(draft(), r, r.entries);
  const starts = s.beats.map((_, i) => 3 + i * 3.4);
  const stamps = eraStampsFor(s, starts, "#fff");
  assert.deepEqual(
    stamps.map((x) => x.text),
    ["1997", "2001", "2008", "2013", "2026"],
  );
  assert.ok(Math.abs(stamps[1]!.at - (3 + 3 * 3.4)) < 0.1);
  assert.deepEqual(
    eraStampsFor({}, starts, "#fff"),
    [],
    "every other Short has none",
  );
});

test("a beat shot aims for a cut about every 1.8 seconds", () => {
  const segments = [
    { kind: "hook" as const, text: "h", start: 0, end: 3 },
    ...Array.from({ length: 6 }, (_, i) => ({
      kind: "beat" as const,
      text: "b",
      start: 3 + i * 3.4,
      end: 3 + (i + 1) * 3.4,
    })),
    { kind: "take" as const, text: "t", start: 23.4, end: 28 },
  ];
  const total = 28 * 30;
  const usual = planCuts(segments, [], total).filter(
    (c) => c.segment >= 1 && c.segment <= 6,
  );
  const quick = planCuts(
    segments,
    [],
    total,
    false,
    false,
    EVERY_SHOT_TARGET,
  ).filter((c) => c.segment >= 1 && c.segment <= 6);
  assert.equal(usual.length, 6, "one shot a beat as it always was");
  assert.equal(quick.length, 12, "two shots a beat");
  const mean =
    quick.reduce((n, c) => n + (c.end - c.start), 0) / quick.length / 30;
  assert.ok(mean > 1.5 && mean < 2, `a cut every ${mean.toFixed(2)} s`);
  assert.ok(
    quick.every((c) => c.end - c.start >= 45),
    "never under the shortest shot",
  );
});

test("a picture is era-true only when it is that game's own release", () => {
  const vc = { title: "Grand Theft Auto: Vice City", year: 2002 };
  assert.ok(eraTrue({ game: "Grand Theft Auto: Vice City", year: 2002 }, vc));
  assert.ok(
    eraTrue({ game: "Grand Theft Auto: Vice City", year: 2003 }, vc),
    "a port within a year",
  );
  assert.ok(
    !eraTrue({ game: "Grand Theft Auto: Vice City", year: 2013 }, vc),
    "the PS3 re-release",
  );
  assert.ok(
    !eraTrue(
      {
        game: "Grand Theft Auto: Vice City - The Definitive Edition",
        year: 2021,
      },
      vc,
    ),
  );
  assert.ok(
    !eraTrue(
      { game: "Grand Theft Auto: Vice City - The Definitive Edition" },
      vc,
    ),
    "a remaster, year or no year",
  );
  assert.ok(
    !eraTrue({ game: "Grand Theft Auto: Vice City Stories", year: 2006 }, vc),
    "a later game",
  );
  assert.ok(
    eraTrue(
      { game: "Grand Theft Auto 3", year: 2001 },
      { title: "Grand Theft Auto III", year: 2001 },
    ),
  );
  assert.deepEqual(
    provenanceSource(
      'IGDB screenshot for "Grand Theft Auto 2" (1999), publisher material via igdb.com',
    ),
    { game: "Grand Theft Auto 2", year: 1999 },
  );
  assert.deepEqual(
    provenanceSource(
      'Official trailer for "Grand Theft Auto VI" (2026): YouTube "Trailer 2" (publisher: Rockstar Games)',
    ),
    { game: "Grand Theft Auto VI", year: 2026 },
  );
  assert.equal(provenanceSource("Steam screenshot"), undefined);
});

const igdb = (game: string, year: number, kind = "screenshot") =>
  `IGDB ${kind} for "${game}" (${year}), publisher material via igdb.com`;

test("the audit finds a beat showing another release and a beat with nothing of its own", () => {
  const r = roster();
  const s = everyGameToScript(draft(), r, r.entries);
  const meta = s.every_game!;
  const images = meta.beats.flatMap((b, i) => [
    {
      file: `entry_${i}/cover.jpg`,
      provenance: igdb(b.title, b.year, "cover"),
      beatIndex: i,
      kind: "capsule",
    },
    {
      file: `entry_${i}/a.jpg`,
      provenance: b.handheld
        ? `${igdb(b.title, b.year)}, shown ${HARDWARE_PROVENANCE}`
        : igdb(b.title, b.year),
      beatIndex: i,
      kind: "screenshot",
    },
  ]);
  const clips = [
    {
      file: "entry_13/official_0.mp4",
      provenance:
        'Official trailer for "Grand Theft Auto VI" (2026): Trailer (publisher: Rockstar Games)',
      beatIndex: 13,
    },
  ];
  const good = eraAudit(meta, images, clips);
  assert.deepEqual(eraProblems(good), []);
  assert.equal(good[13]!.shows, "footage");
  assert.equal(good[3]!.shows, "pictures");
  assert.equal(good[6]!.shows, "hardware", "GTA Advance sits on a handheld");
  // A Definitive Edition screenshot under GTA III, a GTA V picture under GTA IV, and a beat left with its cover only.
  const bad = [
    ...images.filter((i) => i.beatIndex !== 5 || i.kind === "capsule"),
    {
      file: "entry_3/de.jpg",
      provenance: igdb("Grand Theft Auto III: The Definitive Edition", 2021),
      beatIndex: 3,
      kind: "screenshot",
    },
    {
      file: "entry_9/v.jpg",
      provenance: igdb("Grand Theft Auto V", 2013),
      beatIndex: 9,
      kind: "screenshot",
    },
    {
      file: "entry_4/late.jpg",
      provenance: igdb("Grand Theft Auto: Vice City", 2013),
      beatIndex: 4,
      kind: "screenshot",
    },
  ];
  const audit = eraAudit(meta, bad, clips);
  assert.deepEqual(audit[3]!.wrong, ["entry_3/de.jpg"]);
  assert.deepEqual(audit[9]!.wrong, ["entry_9/v.jpg"]);
  assert.deepEqual(audit[4]!.wrong, ["entry_4/late.jpg"]);
  assert.equal(
    audit[5]!.shows,
    "empty",
    "box art alone is the card's, not a picture",
  );
  const problems = eraProblems(audit).join(" | ");
  assert.match(
    problems,
    /Grand Theft Auto III \(2001\) has 1 picture of another release/,
  );
  assert.match(problems, /San Andreas \(2004\) has no picture of its own/);
  // Before the render the wrong pictures are dropped; the empty beat still stops it.
  const cleaned = auditEveryGameAssets(s, {
    images: bad as never,
    clips: clips as never,
  });
  assert.equal(cleaned.dropped.length, 3);
  assert.ok(!cleaned.images.some((i) => i.file === "entry_3/de.jpg"));
  assert.equal(cleaned.problems.length, 1);
  assert.match(cleaned.problems[0]!, /San Andreas/);
});

test("trailer moments go to the newest entries only", () => {
  const beats = roster().entries;
  const year = 2026;
  const allowed = beats.map((_, i) => footageBeat(beats, i, year));
  assert.equal(allowed.at(-1), true, "the newest game, the payoff");
  assert.equal(allowed[0], false);
  assert.equal(
    allowed.filter(Boolean).length,
    1,
    "GTA V and Online are over ten years old",
  );
  const recent = [
    { year: 2019 },
    { year: 2021 },
    { year: 2023 },
    { year: 2025 },
  ];
  assert.deepEqual(
    recent.map((_, i) => footageBeat(recent, i, 2026)),
    [false, true, true, true],
  );
});

test("a beat's gather keeps only its own era: handhelds on hardware, box art on a console when nothing else", async () => {
  const r = roster();
  const s = everyGameToScript(draft(), r, r.entries);
  const frames: Array<{
    imageFile: string;
    mode: string;
    device: string;
    outFile: string;
  }> = [];
  const art = (game: string, year: number, shots: number) => [
    ...Array.from({ length: shots }, (_, k) => ({
      kind: "screenshot" as const,
      file: `assets/igdb-s${k}.jpg`,
      sourceUrl: `u${k}`,
      provenance: igdb(game, year),
    })),
    {
      kind: "capsule" as const,
      file: "assets/igdb-cover.jpg",
      sourceUrl: "c",
      provenance: igdb(game, year, "cover"),
    },
  ];
  const services = (shots: number, year?: number) =>
    ({
      cfg: { footage: false, remotionGl: "swangle", browserExecutable: "" },
      now: () => NOW,
      igdbArt: async (title: string, y: number) => art(title, year ?? y, shots),
      fetchOfficialMedia: async () => {
        throw new Error("no trailer for an old game");
      },
      renderEraFrame: async (o: never) => {
        frames.push(o);
      },
    }) as never;
  const run = async (beat: number, shots: number, year?: number) => {
    const images: never[] = [];
    await gatherEveryGameEntry(
      services(shots, year),
      s,
      s.entries![beat]!,
      beat,
      "/ep",
      images,
      [],
    );
    return images as Array<{
      file: string;
      kind: string;
      provenance: string;
      beatIndex?: number;
    }>;
  };
  // GTA III on PS2: its own screenshots, plain, and its cover for the card.
  const three = await run(3, 4);
  assert.deepEqual(
    three.map((i) => i.kind),
    ["capsule", "screenshot", "screenshot", "screenshot"],
  );
  assert.ok(
    three.every(
      (i) =>
        i.beatIndex === 3 && i.file.startsWith(path.join("entry_3", "assets")),
    ),
  );
  assert.ok(!three.some((i) => i.provenance.includes(HARDWARE_PROVENANCE)));
  // GTA Advance: both shots on the handheld.
  frames.length = 0;
  const advance = await run(6, 4);
  assert.equal(
    advance.filter((i) => i.provenance.includes(HARDWARE_PROVENANCE)).length,
    2,
  );
  assert.ok(
    !advance.some(
      (i) =>
        i.kind === "screenshot" && !i.provenance.includes(HARDWARE_PROVENANCE),
    ),
  );
  assert.deepEqual(
    frames.map((f) => `${f.device}:${f.mode}`),
    ["handheld-wide:screen", "handheld-wide:screen"],
  );
  // No screenshot of its own: the box art on the television of its day.
  frames.length = 0;
  const boxed = await run(4, 0);
  assert.deepEqual(
    frames.map((f) => `${f.device}:${f.mode}`),
    ["crt-tv:box"],
  );
  assert.equal(boxed.filter((i) => i.kind === "screenshot").length, 1);
  assert.match(
    boxed.find((i) => i.kind === "screenshot")!.provenance,
    /cover for "Grand Theft Auto: Vice City" \(2002\).*hardware of its day/,
  );
  // IGDB hands back a later release's pictures: none of them is used.
  frames.length = 0;
  const late = await run(4, 4, 2013);
  assert.deepEqual(late, []);
  // The first game also gives the Short its opening picture, on its hardware.
  frames.length = 0;
  const first = await run(0, 3);
  const opener = first.find((i) => i.beatIndex === undefined)!;
  assert.equal(opener.kind, "hero");
  assert.match(
    opener.provenance,
    /"Grand Theft Auto" \(1997\).*hardware of its day/,
  );
  assert.deepEqual(
    frames.map((f) => `${f.device}:${f.mode}`),
    ["crt-monitor:screen"],
  );
});

test("every device's screen sits inside the frame, under the entry card and above the caption line's end", () => {
  for (const [device, s] of Object.entries(ERA_SCREENS)) {
    assert.ok(
      s.x >= 0 && s.x + s.w <= ERA_FRAME_W,
      `${device} is inside the frame`,
    );
    assert.ok(s.y >= ENTRY_CARD_TOP + 280, `${device} clears the entry card`);
    assert.ok(
      s.y + s.h <= ERA_FRAME_H * 0.68,
      `${device}'s screen ends above the lower third`,
    );
    assert.ok(
      s.w >= 540,
      `${device}'s screen is wide enough to read on a phone`,
    );
  }
});

const outline = (): EveryGameOutline => {
  const r = roster();
  const title = (t: string) => `${displayTitle(t, r)} Changes the Rules`;
  return {
    question:
      "How did a top-down game about stealing cars become the biggest launch in entertainment?",
    kicker: "From Dundee to Leonida",
    franchise_wiki_title: "Grand Theft Auto",
    chapters: r.entries.map((e) => ({
      chapter_title: title(e.title).split(/\s+/).slice(0, 7).join(" "),
      game_title: e.title,
      covers: [e.title],
      wiki_title: e.title,
      focus: "What it did and the take.",
      photo_searches: ["Rockstar North Edinburgh"],
    })),
    youtube: {
      thumb_text: "EVERY ONE",
      description: "The series in release order.",
      tags: ["gta"],
    },
  };
};

test("the long video's outline tells every roster game once, in release order, under a named chapter", () => {
  const r = roster();
  const o = outline();
  assert.deepEqual(validateEveryGameOutline(o, r), []);
  // An expansion may share its parent's chapter; a main game may not be folded away.
  const folded = {
    ...o,
    chapters: o.chapters
      .filter((c) => c.game_title !== "Grand Theft Auto: London 1969")
      .map((c) =>
        c.game_title === "Grand Theft Auto"
          ? {
              ...c,
              covers: ["Grand Theft Auto", "Grand Theft Auto: London 1969"],
            }
          : c,
      ),
  };
  assert.deepEqual(validateEveryGameOutline(folded, r), []);
  const missing = {
    ...o,
    chapters: o.chapters.filter(
      (c) => c.game_title !== "Grand Theft Auto Advance",
    ),
  };
  assert.match(
    validateEveryGameOutline(missing, r).join(" "),
    /"Grand Theft Auto Advance" \(2004\) has no chapter/,
  );
  const mainFolded = {
    ...o,
    chapters: o.chapters
      .filter((c) => c.game_title !== "Grand Theft Auto 2")
      .map((c) =>
        c.game_title === "Grand Theft Auto III"
          ? { ...c, covers: [c.game_title, "Grand Theft Auto 2"] }
          : c,
      ),
  };
  assert.match(
    validateEveryGameOutline(mainFolded, r).join(" "),
    /folds a main game/,
  );
  const reordered = {
    ...o,
    chapters: [
      o.chapters[2]!,
      o.chapters[0]!,
      o.chapters[1]!,
      ...o.chapters.slice(3),
    ],
  };
  assert.match(
    validateEveryGameOutline(reordered, r).join(" "),
    /out of release order/,
  );
  const invented = {
    ...o,
    chapters: [
      ...o.chapters,
      { ...o.chapters[0]!, game_title: "Grand Theft Auto Tokyo", covers: [] },
    ],
  };
  assert.match(
    validateEveryGameOutline(invented, r).join(" "),
    /not in the roster/,
  );
  const bare = {
    ...o,
    chapters: o.chapters.map((c, i) =>
      i === 3 ? { ...c, chapter_title: "Grand Theft Auto III" } : c,
    ),
  };
  assert.match(validateEveryGameOutline(bare, r).join(" "), /turning point/);
});

test("the outline becomes the documentary lane's, with the roster's years and the planned title", () => {
  const r = roster();
  const o = outline();
  const doc = everyGameDocOutline(o, r, "The Story of Every GTA Game");
  assert.equal(doc.title, "The Story of Every GTA Game");
  assert.equal(doc.youtube.title, "The Story of Every GTA Game");
  assert.equal(doc.chapters.length, r.entries.length);
  assert.equal(doc.chapters[3]!.year, 2001);
  assert.equal(doc.chapters[3]!.platforms, "PS2, PC");
  assert.equal(doc.chapters[12]!.year, 2013, "the plan's year for GTA Online");
  assert.equal(chapterList(o, r)[0], "1. GTA Changes the Rules (1997)");
  const topic = everyGameDocTopic(
    r,
    "The Story of Every GTA Game",
    "angle",
    "Grand Theft Auto",
  );
  assert.equal(topic.format, "everygame");
  assert.equal(topic.kind, "franchise");
  assert.equal(topic.roster!.entries.length, r.entries.length);
});

const ENTRY: EveryGameEntry = {
  series: "Grand Theft Auto",
  short: "GTA",
  on: true,
  title: "The Story of Every GTA Game",
  angle: "a",
  roster: { years: { "Grand Theft Auto Online": 2013 } },
  short_video: {
    date: "2026-11-28",
    slot: "20:00",
    title: "The Story of Every GTA Game in 60 Seconds",
  },
  long_video: { date: "2026-12-05", slot: "17:00", make_hours_before: 30 },
};

test("the Short is due inside its lead time, once, and only with the setting and the entry both on", () => {
  const tz = "Europe/London";
  const at = localTime("2026-11-28", "20:00", tz);
  const opts = { timeZone: tz, leadMinutes: 120, graceMinutes: 30 };
  const inside = new Date(at.getTime() - 90 * 60_000);
  assert.equal(
    everyShortDue([ENTRY], true, inside, [], opts)!.at.getTime(),
    at.getTime(),
  );
  assert.equal(
    everyShortDue([ENTRY], false, inside, [], opts),
    undefined,
    "the setting is off",
  );
  assert.equal(
    everyShortDue([{ ...ENTRY, on: false }], true, inside, [], opts),
    undefined,
    "the entry is off",
  );
  assert.equal(
    everyShortDue([{ ...ENTRY, on: undefined }], true, inside, [], opts),
    undefined,
  );
  assert.equal(
    everyShortDue(
      [ENTRY],
      true,
      new Date(at.getTime() - 3 * 3600_000),
      [],
      opts,
    ),
    undefined,
    "too early",
  );
  assert.equal(
    everyShortDue([ENTRY], true, new Date(at.getTime() + 3600_000), [], opts),
    undefined,
    "missed",
  );
  assert.equal(
    everyShortDue([ENTRY], true, inside, [at], opts),
    undefined,
    "already made",
  );
  assert.equal(
    everyShortDue(
      [{ ...ENTRY, short_video: undefined }],
      true,
      inside,
      [],
      opts,
    ),
    undefined,
  );
});

test("the long video opens its making window ahead of its slot, behind the same two switches", () => {
  const tz = "Europe/London";
  const at = localTime("2026-12-05", "17:00", tz);
  const inside = new Date(at.getTime() - 29 * 3600_000);
  assert.equal(
    everyLongDue([ENTRY], true, inside, [], tz)!.at.getTime(),
    at.getTime(),
  );
  assert.equal(everyLongDue([ENTRY], false, inside, [], tz), undefined);
  assert.equal(
    everyLongDue([{ ...ENTRY, on: false }], true, inside, [], tz),
    undefined,
  );
  assert.equal(
    everyLongDue([ENTRY], true, new Date(at.getTime() - 31 * 3600_000), [], tz),
    undefined,
  );
  assert.equal(everyLongDue([ENTRY], true, inside, [at], tz), undefined);
  assert.deepEqual(rosterTweaks(ENTRY), {
    years: { "Grand Theft Auto Online": 2013 },
    short: "GTA",
  });
});

test("the plan in the repository is valid, starts with GTA and is switched off, as the setting is", async () => {
  const plan = readEveryGamePlan("");
  assert.ok(fs.existsSync(DEFAULT_EVERYGAME_FILE));
  assert.equal(plan[0]!.series, "Grand Theft Auto");
  assert.equal(plan[0]!.title, "The Story of Every GTA Game");
  assert.deepEqual(
    titleProblems(plan[0]!.title, {
      series: plan[0]!.series,
      short: plan[0]!.short!,
    }),
    [],
  );
  assert.deepEqual(
    titleProblems(plan[0]!.short_video!.title!, {
      series: plan[0]!.series,
      short: plan[0]!.short!,
    }),
    [],
  );
  assert.ok(
    plan.every((e) => !e.on),
    "nothing runs until someone turns it on",
  );
  assert.ok(
    plan[0]!.short_video!.date > "2026-11-22",
    "after the launch run's second part",
  );
  const saved = { ...process.env };
  try {
    delete process.env.EVERYGAME_ENABLED;
    delete process.env.EVERYGAME_FILE;
    const cfg = loadConfig();
    assert.equal(cfg.everyGameEnabled, false);
    assert.equal(cfg.everyGameFile, "");
  } finally {
    Object.assign(process.env, saved);
  }
  // A broken or missing file is no plan, never a stopped factory.
  const dir = await tmpDir();
  const broken = path.join(dir, "plan.json");
  fs.writeFileSync(broken, "{ not json");
  assert.deepEqual(readEveryGamePlan(broken), []);
  assert.deepEqual(readEveryGamePlan(path.join(dir, "none.json")), []);
});
