import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breakingAllowed,
  floorBackFactor,
  isLateSlot,
  newsSlotsFor,
  onHomeShelf,
  parseHomeShelf,
  rumourCapFor,
  rumourShareFrom,
  seriesGroup,
  seriesTagFor,
  shortFloorProblems,
  shortFloorRule,
  shortMinWords,
} from "../src/series.ts";
import {
  rumoursPerDayNow,
  nextLineArm,
  NEXT_LINE_START,
} from "../src/experiments.ts";
import {
  pulseCheckFor,
  pulseCheckRule,
  seriesPulseCheckNote,
  seriesPulseCheckRule,
} from "../src/editorial/newssegment.ts";
import { dayPhrase, gtaFileParts, nextPartFor, type PartEntry } from "../src/nextpart.ts";
import { readRun } from "../src/shortrun.ts";
import {
  endingProblems,
  nextLineProblems,
  nextLineRule,
} from "../src/editorial/shortrules.ts";
import { narrationOf, wordCount } from "../src/editorial/schema.ts";
import { goodScript, testDb } from "./helpers.ts";

// ------------------------------------------------------------------ item 1: the series tag

test("every Short gets its series: the script's own tag first, then the story's, then the lane", () => {
  assert.equal(
    seriesTagFor({ lane: "news", story_json: {} }, { series: "verdict" }),
    "verdict",
  );
  assert.equal(
    seriesTagFor({ lane: "news", story_json: { series: "gta_file", why: {} } }),
    "gta_file",
  );
  assert.equal(
    seriesTagFor({ lane: "news", story_json: { why: { question: "q" } } }),
    "why",
  );
  assert.equal(seriesTagFor({ lane: "news", story_json: {} }), "news_control");
  assert.equal(
    seriesTagFor({ lane: "news", story_json: {} }, { is_rumour: true }),
    undefined,
    "a rumour is not the control",
  );
  assert.equal(
    seriesTagFor({ lane: "news_breaking", story_json: {} }),
    undefined,
    "breaking is not the control",
  );
  assert.equal(seriesTagFor({ lane: "evergreen", story_json: {} }), undefined);
  assert.equal(
    seriesTagFor({ lane: "news", story_json: {} }, { series: "nonsense" }),
    "news_control",
    "an unknown tag is ignored",
  );
});

test("the control's GTA news is read apart from the rest of the control", () => {
  assert.equal(seriesGroup("news_control", "Grand Theft Auto VI"), "gta_news");
  assert.equal(
    seriesGroup("news_control", "", "GTA 6 sells 25 million"),
    "gta_news",
  );
  assert.equal(seriesGroup("news_control", "Starfield"), "news_control");
  assert.equal(
    seriesGroup("gta_file", "Grand Theft Auto VI"),
    "gta_file",
    "The GTA File stays itself",
  );
  assert.equal(seriesGroup(undefined, "GTA VI"), "other");
});

// ------------------------------------------------------------------ item 2: the mix

test("RUMOUR_SHARE: 1 or unreadable keeps the allowance, 0 stops rumour Shorts whatever the verdict left", async () => {
  assert.equal(rumourShareFrom("1"), 1);
  assert.equal(rumourShareFrom("0"), 0);
  assert.equal(rumourShareFrom("0.5"), 0.5);
  assert.equal(rumourShareFrom("lots"), 1);
  assert.equal(rumourShareFrom(""), 1);
  assert.equal(rumourShareFrom("7"), 1);
  assert.equal(rumourCapFor(2, 1), 2);
  assert.equal(rumourCapFor(2, 0), 0);
  assert.equal(rumourCapFor(2, 0.5), 1);
  const db = await testDb();
  assert.equal(
    await rumoursPerDayNow(db, { rumoursPerDay: 2 }),
    2,
    "off: as before",
  );
  assert.equal(
    await rumoursPerDayNow(db, { rumoursPerDay: 2, rumourShare: 1 }),
    2,
  );
  assert.equal(
    await rumoursPerDayNow(db, { rumoursPerDay: 2, rumourShare: 0 }),
    0,
  );
  await db.close();
});

test("NEWS_LATE_SLOT_ENABLED: on keeps NEWS_SLOTS as written, off drops the 22:00 slot", () => {
  assert.equal(isLateSlot("22:00"), true);
  assert.equal(isLateSlot("21:00"), true);
  assert.equal(isLateSlot("17:00"), false);
  assert.deepEqual(newsSlotsFor(["17:00", "22:00"], true), ["17:00", "22:00"]);
  assert.deepEqual(newsSlotsFor(["13:00", "17:00", "22:00"], false), [
    "13:00",
    "17:00",
  ]);
});

test("BREAKING_HOME_ONLY: off lets every story break; on, only the home shelf or a major story", () => {
  const shelf = parseHomeShelf(" GTA | Grand Theft Auto |Resident Evil|");
  assert.deepEqual(shelf, ["GTA", "Grand Theft Auto", "Resident Evil"]);
  assert.equal(onHomeShelf("GTA 6 trailer 3 is out", shelf), true);
  assert.equal(onHomeShelf("Resident Evil Requiem gets a date", shelf), true);
  assert.equal(
    onHomeShelf("Vagrant Story remaster", shelf),
    false,
    "whole words only",
  );
  assert.equal(onHomeShelf("Zelda remake announced", shelf), false);
  const off = { breakingHomeOnly: false, homeShelf: shelf };
  const on = { breakingHomeOnly: true, homeShelf: shelf };
  assert.equal(breakingAllowed(off, "Zelda remake announced", false), true);
  assert.equal(breakingAllowed(on, "Zelda remake announced", false), false);
  assert.equal(
    breakingAllowed(on, "Zelda remake announced", true),
    true,
    "a major story still breaks",
  );
  assert.equal(breakingAllowed(on, "GTA 6 delayed", false), true);
});

test("SHORT_MIN_SECONDS: 0 is off; 30 asks for 78 spoken words and sends back a draft under it", () => {
  assert.equal(shortMinWords(0), 0);
  assert.equal(shortMinWords(30), 78);
  assert.equal(shortFloorRule(0), "");
  assert.match(
    shortFloorRule(30),
    /at least 30 seconds, so at least 78 spoken words/,
  );
  assert.deepEqual(shortFloorProblems(40, 0), [], "off: never a problem");
  assert.deepEqual(shortFloorProblems(78, 30), []);
  assert.match(
    shortFloorProblems(60, 30).join(),
    /60 spoken words, under the 78/,
  );
  const words = wordCount(narrationOf(goodScript()));
  assert.ok(words >= 78, `the test script is ${words} words, over the floor`);
});

// ------------------------------------------------------------------ item 6: the Pulse Check on series Shorts

test("the Pulse Check: news Shorts as before, series Shorts only with NEWS_SEGMENT_SERIES", () => {
  const news = {
    lane: "news",
    why: false,
    argument: false,
    series: "news_control",
  };
  const why = { lane: "news", why: true, argument: false, series: "why" };
  const verdict = {
    lane: "evergreen",
    why: false,
    argument: false,
    series: "verdict",
  };
  // NEWS_SEGMENT alone (on today): news only, and the Why is untouched until 22 Nov.
  assert.equal(pulseCheckFor({ newsSegment: true }, news), true);
  assert.equal(pulseCheckFor({ newsSegment: true }, why), false);
  assert.equal(
    pulseCheckFor({ newsSegment: true, newsSegmentSeries: false }, why),
    false,
  );
  assert.equal(pulseCheckFor({ newsSegment: false }, news), false);
  // NEWS_SEGMENT_SERIES: every series Short.
  const both = { newsSegment: true, newsSegmentSeries: true };
  assert.equal(pulseCheckFor(both, why), true);
  assert.equal(pulseCheckFor(both, { ...why, series: "gta_file" }), true);
  assert.equal(pulseCheckFor(both, verdict), true);
  assert.equal(
    pulseCheckFor({ newsSegment: false, newsSegmentSeries: true }, news),
    false,
    "the control stays as NEWS_SEGMENT says",
  );
  assert.equal(
    pulseCheckFor(both, { ...why, argument: true }),
    false,
    "the argument test has no labelled take",
  );
  assert.equal(
    pulseCheckFor(both, { lane: "news_breaking", why: false, argument: false }),
    true,
  );
});

test("each series gets a note on what the reading means there; the rule itself is the news rule", () => {
  assert.match(seriesPulseCheckNote("why"), /The Why/);
  assert.match(seriesPulseCheckNote("gta_file"), /GTA VI player/);
  assert.match(
    seriesPulseCheckNote("verdict"),
    /strong for a buy, steady for a wait, weak for a skip/,
  );
  assert.equal(seriesPulseCheckNote("news_control"), "");
  assert.equal(seriesPulseCheckNote(undefined), "");
  assert.ok(seriesPulseCheckRule("verdict").startsWith(pulseCheckRule()));
  assert.equal(seriesPulseCheckRule("news_control"), pulseCheckRule());
});

// ------------------------------------------------------------------ item 9: the next-part line

const why = (
  date: string,
  slot: string,
  title: string,
  extra: Partial<PartEntry> = {},
): PartEntry => ({
  kind: "why",
  date,
  slot,
  title,
  arc: "launch",
  game: "Grand Theft Auto VI",
  ...extra,
});
const london = (date: string, slot: string) => {
  const [h, m] = slot.split(":").map(Number);
  return new Date(
    Date.UTC(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10)),
      h!,
      m!,
    ),
  );
};

test("the next part is the run's next entry on the same arc, numbered and dated; no plan, no part", () => {
  const run = [
    why("2026-11-30", "12:00", "What launch week changed"),
    why("2026-12-01", "12:00", "The map is hiding more"),
    why("2026-12-04", "12:00", "Why Online is the real launch"),
    why("2026-12-01", "18:30", "Another arc", { arc: "other" }),
    { kind: "doc", date: "2026-12-02", slot: "20:00", title: "doc" },
  ];
  const first = nextPartFor(
    run,
    london("2026-11-30", "12:00"),
    "Europe/London",
  );
  assert.deepEqual(first, {
    part: 2,
    day: "tomorrow",
    title: "The map is hiding more",
    date: "2026-12-01",
    slot: "12:00",
  });
  const second = nextPartFor(
    run,
    london("2026-12-01", "12:00"),
    "Europe/London",
  );
  assert.equal(second?.part, 3);
  assert.equal(second?.day, "on Friday");
  assert.equal(
    nextPartFor(run, london("2026-12-04", "12:00"), "Europe/London"),
    undefined,
    "the last part promises nothing",
  );
  assert.equal(
    nextPartFor(run, london("2026-12-05", "12:00"), "Europe/London"),
    undefined,
    "nothing planned for this slot",
  );
  assert.equal(
    nextPartFor([], london("2026-11-30", "12:00"), "Europe/London"),
    undefined,
  );
  // An entry's own series and part number win.
  const numbered = [
    why("2026-11-30", "18:30", "File 7", {
      series: "gta_file",
      part: 7,
      arc: "a",
    }),
    why("2026-12-01", "18:30", "File 8", {
      series: "gta_file",
      part: 8,
      arc: "b",
    }),
  ];
  assert.equal(
    nextPartFor(numbered, london("2026-11-30", "18:30"), "Europe/London")?.part,
    8,
  );
});

test("SHORT_MIN_SECONDS survives SHORT_SPEED: a sped-up take under the floor plays back slower, never below its voiced pace", () => {
  // 12 Nov 2026: 87 words came out at 28.5 s at 1.1x; voiced, it ran 31.35 s.
  const f = floorBackFactor(28.5, 30, 1.1);
  assert.ok(f < 1 && f >= 1 / 1.1);
  assert.ok(Math.abs(28.5 / f - 30.5) < 0.01, "back up to the floor and half a second");
  // Far under: only as slow as the voice itself.
  assert.equal(floorBackFactor(20, 30, 1.1), 1 / 1.1);
  // Over the floor, no floor, or no speed-up: untouched.
  assert.equal(floorBackFactor(31, 30, 1.1), 1);
  assert.equal(floorBackFactor(25, 0, 1.1), 1);
  assert.equal(floorBackFactor(25, 30, 1), 1);
});

test("the GTA File's next-part line reads its own run file, and spares in the launch run are never promised", () => {
  // The real plan (gta_file_run.json): parts in the series slot unless one names its own.
  const parts = gtaFileParts(readRun("gta_file_run.json"), "18:30");
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.series === "gta_file" && p.slot && p.part));
  const [p1, p2] = [...parts].sort((a, b) => a.part! - b.part!);
  const next = nextPartFor(parts, london(p1!.date, p1!.slot), "Europe/London");
  assert.equal(next?.part, p2!.part);
  assert.equal(next?.title, p2!.title);
  // Its own slot when the plan gives one; a doc or a Why in the same file is not a part.
  const own = gtaFileParts(
    [
      { kind: "file", part: 1, date: "2026-11-30", title: "A" },
      { kind: "file", part: 2, date: "2026-12-01", slot: "12:00", title: "B" },
      { kind: "why", date: "2026-12-01", slot: "18:30", title: "C" },
    ],
    "18:30",
  );
  assert.deepEqual(own.map((p) => [p.part, p.slot]), [[1, "18:30"], [2, "12:00"]]);
  // A launch-run spare has no slot until it fills one: never a promised part.
  const withSpare = [
    why("2026-11-30", "12:00", "Part one"),
    { kind: "spare", title: "Spare", arc: "launch", game: "Grand Theft Auto VI" },
    why("2026-12-01", "12:00", "Part two"),
  ];
  assert.equal(nextPartFor(withSpare, london("2026-11-30", "12:00"), "Europe/London")?.title, "Part two");
  // A GTA File part is tagged as one, though the Why writer makes it.
  assert.equal(
    seriesTagFor({ lane: "news", story_json: { why: { question: "?" }, gtaFile: { part: 1 } } }),
    "gta_file",
  );
});

test("the day is said the way a person says it, and a promise past a week is not made", () => {
  assert.equal(dayPhrase("2026-11-30", "2026-11-30", "18:30"), "tonight");
  assert.equal(dayPhrase("2026-11-30", "2026-11-30", "13:00"), "later today");
  assert.equal(dayPhrase("2026-11-30", "2026-12-01", "12:00"), "tomorrow");
  assert.equal(dayPhrase("2026-11-30", "2026-12-04", "12:00"), "on Friday");
  assert.equal(dayPhrase("2026-11-30", "2026-12-07", "12:00"), undefined);
  assert.equal(dayPhrase("2026-11-30", "2026-11-29", "12:00"), undefined);
});

test("the arms alternate by day from 29 Nov, and nothing carries the line before it", () => {
  assert.equal(NEXT_LINE_START, "2026-11-29");
  assert.equal(nextLineArm("2026-11-22"), "none");
  assert.equal(nextLineArm("2026-11-28"), "none");
  const days = ["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"].map(
    nextLineArm,
  );
  assert.deepEqual(days, ["none", "line", "none", "line"]);
  assert.equal(
    nextLineArm("2026-11-30"),
    nextLineArm("2026-11-30"),
    "a retry keeps its side",
  );
});

test("the line must name the part and its day in 8 words; with no plan it may not promise a part", () => {
  const next = { part: 8, day: "tomorrow", title: "The map" };
  assert.match(nextLineRule(next), /"Part 8 tomorrow: <two to four words/);
  const ok = "The map was the point all along. Part 8 tomorrow: the map.";
  assert.deepEqual(nextLineProblems(ok, next), []);
  assert.match(
    nextLineProblems("The map was the point all along.", next).join(),
    /naming "Part 8"/,
  );
  assert.match(
    nextLineProblems("The map was the point. Part 8: the map.", next).join(),
    /must say when: "tomorrow"/,
  );
  assert.match(
    nextLineProblems(
      "It was the point. Part 8 tomorrow, where the whole map finally opens up.",
      next,
    ).join(),
    /keep it to 8/,
  );
  assert.match(
    nextLineProblems(
      "It was the point. Part 8 tomorrow: subscribe.",
      next,
    ).join(),
    /asks the viewer/,
  );
  // No plan: a promise is sent back, a plain ending is not.
  assert.match(
    nextLineProblems(ok, undefined).join(),
    /no next part is planned/,
  );
  assert.deepEqual(
    nextLineProblems("The map was the point all along.", undefined),
    [],
  );
});

test("the ending rule's one exception: a planned next-part sentence, and nothing else changes", () => {
  const next = { part: 8, day: "tomorrow" };
  const line = "The map was the point all along. Part 8 tomorrow: the map.";
  assert.deepEqual(endingProblems(line, next), []);
  assert.deepEqual(
    endingProblems("The map was the point all along."),
    [],
    "off: as before",
  );
  assert.match(
    endingProblems("The next Why lands tomorrow.").join(),
    /advertises the channel/,
  );
  assert.match(
    endingProblems("Follow for more. Part 8 tomorrow: the map.", next).join(),
    /advertises the channel/,
    "the rest of the line is still held to the rule",
  );
  assert.match(
    endingProblems("Is that the point? Part 8 tomorrow: the map.", next).join(),
    /ends on a question/,
  );
});
