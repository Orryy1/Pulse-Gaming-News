import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docToScript,
  groundDocMoments,
  type DocDraft,
  type DocMoment,
} from "../src/editorial/documentary.ts";
import {
  buildLongPlan,
  momentWindows,
  usefulGraphic,
} from "../src/render/longplan.ts";
import { buildSegments } from "../src/render/timeline.ts";
import { segmentInputs } from "../src/pipeline.ts";
import { sentencesOf } from "../src/editorial/longform.ts";

const source = {
  title: "Grand Theft Auto V",
  url: "https://en.wikipedia.org/wiki/Grand_Theft_Auto_V",
  text: `## Development\nDevelopment began in 2008 and the budget was $265 million. Dan Houser said "we wanted the city to feel alive". It sold 11.21 million copies in 2013.`,
};

const none = {
  kind: "none" as const,
  primary: "",
  secondary: "",
  items: [] as string[],
};
const moment = (
  g: Partial<DocMoment["graphic"]> = {},
  broll = "",
): DocMoment => ({
  show: "Los Santos skyline",
  keywords: ["Los Santos"],
  broll,
  graphic: { ...none, ...g },
  emphasis: "",
  person: "",
});

test("the shot list keeps only on-screen facts that are in the source", () => {
  const { moments, removed } = groundDocMoments(
    [
      moment({ kind: "stat", primary: "$265 million", secondary: "budget" }), // under the chapter card: dropped
      moment({
        kind: "quote",
        primary: "we wanted the city to feel alive",
        secondary: "Dan Houser",
      }),
      moment({ kind: "stat", primary: "11.21 million", secondary: "copies" }), // straight after a graphic: dropped
      moment(),
      moment({
        kind: "quote",
        primary: "the greatest game of all time, ever made",
        secondary: "Nobody",
      }),
      moment(),
      moment({
        kind: "timeline",
        primary: "The road",
        items: ["2008: Work begins", "2013: Launch"],
      }),
      moment(),
      moment({
        kind: "timeline",
        primary: "Made up",
        items: ["1999: Something", "2013: Launch"],
      }),
      moment(),
      moment({
        kind: "compare",
        primary: "Budget",
        items: ["GTA V:$265 million", "GTA IV:$100 million"],
      }),
    ],
    source,
  );
  assert.deepEqual(
    moments.map((m) => m.graphic.kind),
    [
      "none",
      "quote",
      "none",
      "none",
      "none",
      "none",
      "timeline",
      "none",
      "none",
      "none",
      "none",
    ],
  );
  assert.equal(removed.length, 5);
});

function draftWithMoments(): DocDraft {
  const para = (seed: string) => ({
    narration: `${seed} opens the scene in 2008. The team grows to hundreds of people. Money pours in.`,
    callout: { kind: "none" as const, primary: "", secondary: "" },
    footage: { want: "gameplay" as const, keywords: [seed] },
  });
  const chapters = [0, 1].map((ci) => {
    const paragraphs = [
      para(`Alpha${ci}`),
      para(`Beta${ci}`),
      para(`Gamma${ci}`),
    ];
    const n = paragraphs.flatMap((p) => sentencesOf(p.narration)).length;
    return {
      plan: {
        chapter_title: `Turn ${ci + 1}`,
        game_title: `Game ${ci + 1}`,
        wiki_title: `Game ${ci + 1}`,
        steam_search_term: "",
        year: 2008,
        platforms: "PS3",
        focus: "x",
        photo_searches: [] as string[],
      },
      chapter: { paragraphs, claims: [] },
      source,
      moments: Array.from({ length: n }, (_, k) =>
        moment(
          k === 4
            ? {
                kind: "quote",
                primary: "we wanted the city to feel alive",
                secondary: "Dan Houser",
              }
            : {},
          k === 7 ? "office at night" : "",
        ),
      ),
    };
  });
  return {
    topic: {
      kind: "story",
      franchise_index: -1,
      story_index: 0,
      franchise: "GTA",
      title_idea: "x",
      angle: "x",
      reason: "x",
    },
    outline: {
      question: "Why?",
      title: "Why",
      kicker: "k",
      franchise_wiki_title: "GTA",
      chapters: chapters.map((c) => c.plan),
      youtube: { title: "t", description: "d", tags: [] },
    },
    chapters,
    bookends: {
      intro: {
        narration: "Welcome to the story. It begins here.",
        on_screen: "x",
      },
      outro: {
        label: "Verdict",
        narration: "That is the story. Thanks for watching.",
        on_screen: "y",
      },
    },
  } as DocDraft;
}

function timed(s: ReturnType<typeof docToScript>) {
  const all = segmentInputs(s).flatMap((x) =>
    x.text.split(/\s+/).filter(Boolean),
  );
  return all.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
}

test("a documentary chapter's shot list runs on across its paragraphs (27 Oct 2026)", () => {
  const s = docToScript(draftWithMoments());
  const entries = [...s.entries!].sort((a, b) => b.rank - a.rank);
  assert.equal(
    entries[0]!.moments!.length,
    9,
    "three sentences in each of three paragraphs",
  );
  const w = timed(s);
  const segs = buildSegments(segmentInputs(s), w, w.at(-1)!.end + 6);
  const windows = momentWindows(
    segs,
    w,
    entries.map((e) => e.moments!.length),
  );
  const first = windows.filter((x) => x.entry === 0);
  assert.deepEqual(
    first.map((x) => x.moment),
    [0, 1, 2, 3, 4, 5, 6, 7, 8],
  );
  // Paragraph two's first sentence is moment 3 and starts its own segment.
  assert.equal(new Set(first.map((x) => x.segment)).size, 3);
  assert.ok(first[3]!.segment !== first[2]!.segment);
});

test("a B-roll clip plays on the sentence it was picked for, not earlier", () => {
  const s = docToScript(draftWithMoments());
  const entries = [...s.entries!].sort((a, b) => b.rank - a.rank);
  const w = timed(s);
  const segs = buildSegments(segmentInputs(s), w, w.at(-1)!.end + 6);
  const windows = momentWindows(
    segs,
    w,
    entries.map((e) => e.moments!.length),
  );
  const images = Array.from({ length: 6 }, () => ({
    kind: "screenshot",
    aspect: 1.78,
    beatIndex: 0,
  }));
  const clips = [
    { durationSeconds: 4, beatIndex: 0, moment: 7 }, // stock for sentence 7
    { durationSeconds: 4, beatIndex: 0 }, // a trailer moment
  ];
  const plan = buildLongPlan({
    segments: segs,
    words: w,
    durationSeconds: w.at(-1)!.end + 6,
    images,
    clips,
    variant: 0,
    momentCounts: entries.map((e) => e.moments!.length),
  });
  const stockShot = plan.shots.find(
    (x) => x.media.type === "clip" && x.media.index === 0,
  );
  assert.ok(stockShot, "the B-roll is used");
  const seven = windows.find((x) => x.entry === 0 && x.moment === 7)!;
  assert.ok(
    stockShot!.start >= Math.round(seven.start * 30) - 1,
    "not before its sentence",
  );
  assert.ok(plan.shots.every((x) => x.end > x.start));
});

test("a quote or timeline is never mistaken for a rank graphic", () => {
  assert.equal(
    usefulGraphic({
      kind: "quote",
      primary: "the best place to work in the first place",
      secondary: "x",
    }),
    true,
  );
  assert.equal(
    usefulGraphic({
      kind: "timeline",
      primary: "",
      secondary: "",
      items: ["2008: a", "2013: b"],
    } as any),
    true,
  );
});

import { advertiserProblems } from "../src/editorial/voice.ts";

test("advertiser-unfriendly words are sent back with a softer phrase; game names pass (27 Oct 2026)", () => {
  assert.equal(
    advertiserProblems("The hidden sex minigame was found by modders.").length,
    1,
  );
  assert.match(
    advertiserProblems("a sexual content patch")[0]!,
    /adult content/,
  );
  assert.equal(advertiserProblems("a torture scene drew complaints").length, 1);
  assert.deepEqual(
    advertiserProblems(
      "Naked Snake meets Suicide Squad in The Texas Chain Saw Massacre.",
    ),
    [],
  );
  assert.deepEqual(
    advertiserProblems("Hot Coffee: hidden adult content left in the files."),
    [],
  );
  assert.deepEqual(
    advertiserProblems("Sussex studios and the Method engine"),
    [],
  );
});

import { chapterGaps, openWords, insertSilence } from "../src/voice/pauses.ts";
import { openChaptersAtBreaks } from "../src/render/longplan.ts";
import { execFileSync } from "node:child_process";
import os from "node:os";
import fsp from "node:fs/promises";
import pathM from "node:path";
import { FFMPEG, FFPROBE } from "../src/lib/bin.ts";

test("a documentary breathes before each chapter: silence in the gap, words and chapters moved with it", async () => {
  const words = [
    { text: "Intro.", start: 0, end: 1 },
    { text: "Chapter", start: 1.6, end: 2 },
    { text: "one.", start: 2, end: 2.5 },
    { text: "Chapter", start: 3.1, end: 3.5 },
    { text: "two.", start: 3.5, end: 4 },
  ];
  const gaps = chapterGaps(words, [1, 3], 4);
  assert.deepEqual(
    gaps.map((g) => g.at),
    [1.3, 2.8],
  );
  const moved = openWords(words, gaps);
  assert.deepEqual(
    moved.map((w) => w.start),
    [0, 5.6, 6, 11.1, 11.5],
  );
  // The audio: a two-tone file gets 4 s of silence in each gap and grows by 8 s.
  const dir = await fsp.mkdtemp(pathM.join(os.tmpdir(), "brk-"));
  const file = pathM.join(dir, "voice.mp3");
  execFileSync(FFMPEG, [
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:duration=4.5",
    "-ac",
    "1",
    "-ar",
    "44100",
    "-c:a",
    "libmp3lame",
    file,
  ]);
  await insertSilence(file, gaps);
  const probe = execFileSync(FFPROBE, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "csv=p=0",
    file,
  ]).toString();
  assert.ok(Math.abs(Number(probe) - 12.5) < 0.15, `duration ${probe}`);
  await fsp.rm(dir, { recursive: true, force: true });
  // The chapter's segment opens with its breather.
  const segs = [
    { kind: "hook", text: "Intro.", start: 0, end: 5.6 },
    {
      kind: "beat",
      text: "Chapter one.",
      start: 5.6,
      end: 11.1,
      visual: { kind: "chapter", primary: "One", secondary: "G" },
    },
  ] as any;
  const opened = openChaptersAtBreaks(segs, [{ start: 1.3, end: 5.3 }]);
  assert.equal(opened[1]!.start, 1.3);
  assert.equal(opened[0]!.end, 1.3);
});

import { makeParallax } from "../src/render/parallax.ts";

test("without a Python for the depth model the stills simply stay flat", async () => {
  const made = await makeParallax("", "C:/nowhere", ["assets/a.jpg"]);
  assert.equal(made.size, 0);
});

test("a map pins only places the source names and the place list knows; charts and lineages keep to the source", async () => {
  const { placeFor } = await import("../src/render/places.ts");
  assert.equal(placeFor("Montréal")?.name, "Montreal");
  assert.equal(placeFor("new york")?.name, "New York City");
  assert.equal(placeFor("Atlantis"), undefined);
  const src = {
    title: "Rockstar North",
    url: "https://en.wikipedia.org/wiki/Rockstar_North",
    text: "DMA Design was founded in Dundee in 1987 and became Rockstar North in 2002, based in Edinburgh. Grand Theft Auto III sold 14.5 million copies and Vice City sold 17.5 million.",
  };
  const g = (x: Partial<DocMoment["graphic"]>) => moment(x);
  const { moments, removed } = groundDocMoments(
    [
      moment(),
      g({ kind: "map", primary: "Where it began", items: ["Dundee", "Edinburgh"] }),
      moment(),
      g({ kind: "map", primary: "Where it began", items: ["Edinburgh", "Atlantis"] }), // not a place we know
      moment(),
      g({ kind: "map", primary: "A new home", items: ["Montreal"] }), // not in the source
      moment(),
      g({ kind: "bars", primary: "Copies sold", items: ["GTA III: 14.5 million", "Vice City: 17.5 million"] }),
      moment(),
      g({ kind: "bars", primary: "Copies sold", items: ["GTA III: 14.5 million", "Vice City: 20 million"] }), // 20 is not in the source
      moment(),
      g({ kind: "lineage", primary: "One studio", items: ["DMA Design: 1987", "Rockstar North: 2002"] }),
      moment(),
      g({ kind: "lineage", primary: "One studio", items: ["DMA Design: 1987", "Rockstar Leeds: 2004"] }), // not in the source
    ],
    src,
  );
  assert.deepEqual(
    moments.map((m) => m.graphic.kind),
    ["none", "map", "none", "none", "none", "none", "none", "bars", "none", "none", "none", "lineage", "none", "none"],
  );
  assert.equal(removed.length, 4);
});
