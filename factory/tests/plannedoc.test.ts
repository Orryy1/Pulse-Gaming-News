import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DASH,
  LEAK_RULED_OUT,
  LEAK_WORDS,
  applyPlannedChapters,
  factsPath,
  plannedDocProblems,
  plannedFactsText,
  plannedOutlineBrief,
  plannedTitle,
  type PlannedDoc,
} from "../src/plannedoc.ts";
import { docRunDue, readRun, type RunDoc } from "../src/shortrun.ts";
import { localTime } from "../src/lanes.ts";
import { airTimeProblems, releaseDateProblems } from "../src/launchprep.ts";
import type { DocOutline } from "../src/editorial/documentary.ts";
import { tmpDir } from "./helpers.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN = path.join(ROOT, "launch_run.json");
const tz = "Europe/London";
const GAME = "Grand Theft Auto VI";

const plan: PlannedDoc = {
  title: "Everything You Need to Know Before You Play GTA 6",
  search_query: "gta 6 everything you need to know",
  thumb: "BEFORE YOU PLAY",
  chapters: [
    { title: "GTA 6 Release Date", focus: "The date and the unlock times." },
    {
      title: "GTA 6 Price and Editions",
      focus: "Dollars first, then pounds and euros.",
    },
  ],
};

const chapter = (title: string): DocOutline["chapters"][number] => ({
  chapter_title: title,
  game_title: GAME,
  wiki_title: GAME,
  steam_search_term: "",
  year: 2026,
  platforms: "PS5, Xbox Series X|S",
  focus: "written focus",
  photo_searches: ["Miami Beach"],
});

const outline = (titles: string[]): DocOutline => ({
  question: "q",
  title: "t",
  kicker: "k",
  franchise_wiki_title: "Grand Theft Auto",
  chapters: titles.map(chapter),
  youtube: { title: "Written", description: "d", tags: [] },
});

test("the search title step keeps a written title only when it keeps the search's words", () => {
  assert.equal(
    plannedTitle(
      "GTA 6, Everything You Need to Know Before Launch",
      plan,
      GAME,
    ),
    "GTA 6, Everything You Need to Know Before Launch",
  );
  assert.equal(
    plannedTitle("How Rockstar Built Leonida", plan, GAME),
    plan.title,
    "drops the search",
  );
  assert.equal(
    plannedTitle("GTA 6: Everything You Need to Know", plan, GAME),
    plan.title,
    "colon template",
  );
  assert.equal(
    plannedTitle("Everything You Need to Know — GTA 6", plan, GAME),
    plan.title,
    "dash",
  );
  assert.equal(plannedTitle("", plan, GAME), plan.title);
  assert.equal(
    plannedTitle("Anything", { title: "Fixed" }, GAME),
    "Fixed",
    "no search: the plan's title",
  );
});

test("the outline is told the planned chapters, and held to them", () => {
  assert.equal(plannedOutlineBrief(undefined), "");
  assert.equal(plannedOutlineBrief({ title: "x" }), "");
  const brief = plannedOutlineBrief(plan);
  assert.match(brief, /1\. GTA 6 Release Date: The date/);
  assert.match(brief, /gta 6 everything you need to know/);

  const same = applyPlannedChapters(
    outline(["GTA 6 Release Date", "GTA 6 Price and Editions"]),
    plan,
    GAME,
  );
  assert.deepEqual(same.changed, []);
  assert.equal(
    same.outline.chapters[1]!.focus,
    "Dollars first, then pounds and euros. written focus",
  );

  const off = applyPlannedChapters(
    outline(["Dates", "Money", "Extra"]),
    plan,
    GAME,
  );
  assert.deepEqual(
    off.outline.chapters.map((c) => c.chapter_title),
    ["GTA 6 Release Date", "GTA 6 Price and Editions"],
  );
  assert.equal(off.changed.length, 3);

  const short = applyPlannedChapters(
    outline(["GTA 6 Release Date"]),
    plan,
    "Grand Theft Auto VI",
  );
  assert.equal(short.outline.chapters.length, 2);
  assert.equal(
    short.outline.chapters[1]!.chapter_title,
    "GTA 6 Price and Editions",
  );
  assert.equal(short.outline.chapters[1]!.wiki_title, "Grand Theft Auto VI");
  assert.deepEqual(short.outline.chapters[1]!.photo_searches, []);

  const none = outline(["A b", "C d"]);
  assert.equal(applyPlannedChapters(none, { title: "x" }, GAME).outline, none);
});

test("a facts file sits beside the run file and is read whole, reported lines kept", async () => {
  assert.equal(factsPath("/abs/f.md", "launch_run.json"), "/abs/f.md");
  assert.equal(
    factsPath("f.md", path.join("a", "run.json")),
    path.resolve("a", "f.md"),
  );
  const dir = await tmpDir();
  const f = path.join(dir, "facts.md");
  fs.writeFileSync(
    f,
    "## Confirmed\n- Out November 19\n## Reported\n- PC early 2027",
  );
  const got = plannedFactsText(f);
  assert.match(got.text, /^\[Rockstar and Take-Two, collected\]/);
  assert.match(got.text, /PC early 2027/);
  assert.match(got.text, /reportedly/);
  assert.deepEqual(plannedFactsText(path.join(dir, "missing.md")), {
    text: "",
    missed: [path.join(dir, "missing.md")],
  });
});

test("the house rules for a planned entry: search words, no dash, no Wikipedia, an official source, no leaks", () => {
  assert.ok(DASH.test("a — b") && !DASH.test("a - b"));
  assert.ok(
    LEAK_WORDS.test("the leaked map") && LEAK_RULED_OUT.test("No leaks, ever."),
  );
  const ok = {
    title: plan.title,
    angle: "No leaks, no datamined material.",
    franchise: GAME,
    search_query: plan.search_query,
    chapters: Array.from({ length: 5 }, (_, i) => ({
      title: `Chapter Number ${i + 1}`,
      focus: "What it covers.",
    })),
    sources: [
      {
        url: "https://www.rockstargames.com/VI",
        source: "Rockstar",
        official: true,
      },
    ],
  };
  assert.deepEqual(plannedDocProblems(ok), []);
  const bad = plannedDocProblems({
    ...ok,
    title: "How Rockstar Built It — GTA 6",
    angle: "Use the leaked map.",
    thumb: "ONE TWO THREE FOUR FIVE",
    chapters: [{ title: "One", focus: "Too few." }],
    sources: [
      {
        url: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_VI",
        source: "Wikipedia",
      },
    ],
  });
  for (const want of [
    /searcher's own words/,
    /dash/,
    /leaks without/,
    /1 chapters/,
    /is 1 words/,
    /more than 4/,
    /Wikipedia/,
    /no official source/,
  ])
    assert.ok(
      bad.some((p) => want.test(p)),
      `${want} in ${bad.join(" | ")}`,
    );
});

// The real plan: the two GTA VI search-led videos in launch_run.json.
const planned = readRun(RUN).filter(
  (e): e is RunDoc => e.kind === "doc" && Boolean(e.search_query),
);

test("the launch run plans both GTA VI search-led videos before any unlock, and they pass the house rules", () => {
  assert.deepEqual(
    planned.map((e) => [e.date, e.slot, e.title]),
    [
      [
        "2026-11-17",
        "20:00",
        "Everything You Need to Know Before You Play GTA 6",
      ],
      [
        "2026-11-18",
        "01:00",
        "GTA 6 Map Explained, Everything We Know About Leonida",
      ],
    ],
  );
  const nz = new Date("2026-11-18T11:00:00Z").getTime();
  for (const e of planned) {
    assert.deepEqual(plannedDocProblems(e), [], e.title);
    assert.ok(
      localTime(e.date, e.slot, tz).getTime() < nz,
      `${e.title} goes out before New Zealand unlocks`,
    );
    assert.ok(
      e.chapters && e.chapters.length >= 8,
      `${e.title} plans its chapters`,
    );
    assert.ok(
      e.facts_file && fs.existsSync(factsPath(e.facts_file, RUN)),
      `${e.title} facts file exists`,
    );
    const words = [e.angle, ...(e.chapters ?? []).map((c) => c.focus)].join(
      " ",
    );
    assert.deepEqual(
      releaseDateProblems(words),
      [],
      `${e.title} release date wording`,
    );
    assert.deepEqual(
      airTimeProblems(words, localTime(e.date, e.slot, tz)),
      [],
      `${e.title} time words`,
    );
    // Wikipedia is named only to rule it out.
    for (const sentence of words.match(/[^.]*\bwikipedia\b[^.]*/gi) ?? [])
      assert.match(sentence, /\bnever\b/i, sentence);
  }
});

test("each planned video's facts file has primary sources only and no dashes", () => {
  for (const e of planned) {
    const md = fs.readFileSync(factsPath(e.facts_file!, RUN), "utf8");
    assert.ok(!DASH.test(md), `${e.facts_file} has a dash`);
    assert.doesNotMatch(md, /wikipedia\.org/i);
    assert.match(md, /^## Confirmed/m);
    for (const url of md.match(/https:\/\/\S+/g) ?? [])
      assert.match(
        url,
        /rockstargames\.com|take2games\.com|playstation\.com|youtube\.com\/watch\?v=(QdBZY2fkU-0|VQRLujxTm3c)/,
        url,
      );
  }
});

test("the planned videos reach the writer with their search, chapters, thumbnail and facts", () => {
  for (const e of planned) {
    const at = localTime(e.date, e.slot, tz);
    // Their windows do not overlap in a way that lets one hide the other: each is found in its own window.
    const due = docRunDue(planned, new Date(at.getTime() - 3600_000), [], tz)!;
    const want =
      due.entry.title === e.title
        ? due
        : docRunDue(
            planned,
            new Date(at.getTime() - 3600_000),
            [localTime(due.entry.date, due.entry.slot, tz)],
            tz,
          )!;
    assert.equal(want.entry.title, e.title);
    assert.equal(want.topic.format, "guide");
    assert.equal(want.topic.planned?.search_query, e.search_query);
    assert.equal(want.topic.planned?.thumb, e.thumb);
    assert.equal(want.topic.planned?.chapters?.length, e.chapters?.length);
    assert.equal(want.topic.planned?.facts_file, e.facts_file);
    assert.ok(want.topic.sources?.every((s) => s.official));
  }
  // An entry with none of the new fields carries no plan (the 21 Nov launch-day test video runs as before).
  const plain = readRun(RUN).find(
    (e): e is RunDoc => e.kind === "doc" && e.date === "2026-11-21",
  )!;
  const due = docRunDue(
    [plain],
    new Date(localTime(plain.date, plain.slot, tz).getTime() - 3600_000),
    [],
    tz,
  )!;
  assert.equal(due.topic.planned, undefined);
});

test("both planned titles also pass the long-video title-shape step before upload", async () => {
  const { titleShapeProblems } = await import("../src/editorial/titleshape.ts");
  for (const e of planned) {
    assert.deepEqual(titleShapeProblems(e.title), [], e.title);
    assert.equal(plannedTitle(e.title, { title: e.title, search_query: e.search_query }, e.franchise), e.title);
  }
});
