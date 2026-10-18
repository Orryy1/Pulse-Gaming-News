import { test } from "node:test";
import assert from "node:assert/strict";
import {
  docToScript,
  groundCallouts,
  validateChapter,
  docWordCount,
  type DocDraft,
  type DocChapter,
} from "../src/editorial/documentary.ts";
import { splitSections, pickSections } from "../src/discovery/wikipedia.ts";
import {
  buildLongPlan,
  chapterLines,
  entryOf,
} from "../src/render/longplan.ts";
import { buildSegments } from "../src/render/timeline.ts";
import { segmentInputs, chapterFootage } from "../src/pipeline.ts";
import {
  keywordLead,
  thumbTitle,
  pinnedComment,
} from "../src/editorial/seo.ts";

const words = (n: number, seed: string) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? seed : `w${i}`)).join(" ") +
  ".";

const source = (title: string) => ({
  title,
  url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}`,
  text: `## Overview\n${title} was released in October 2002 and sold 17.5 million copies. Sam Houser said "we wanted the city to feel alive".`,
});

function chapter(
  seed: string,
  callouts: DocChapter["paragraphs"][number]["callout"][] = [],
): DocChapter {
  return {
    paragraphs: Array.from({ length: 5 }, (_, i) => ({
      narration: words(90, `${seed}${i}`),
      callout: callouts[i] ?? {
        kind: "none" as const,
        primary: "",
        secondary: "",
      },
      footage: { want: "gameplay" as const, keywords: [`${seed} moment ${i}`] },
    })),
    claims: [{ claim: `${seed} sold well`, section: "Sales" }],
  };
}

function draft(n = 5): DocDraft {
  const chapters = Array.from({ length: n }, (_, ci) => {
    const plan = {
      chapter_title: `Chapter Title ${ci + 1}`,
      game_title: `Game ${ci + 1}`,
      wiki_title: `Game ${ci + 1}`,
      steam_search_term: ci === 0 ? "" : `Game ${ci + 1}`,
      year: 1997 + ci * 3,
      platforms: "PC, PS2",
      focus: "the leap",
      photo_searches: [] as string[],
    };
    return {
      plan,
      chapter: chapter(`c${ci}`),
      source: source(plan.game_title),
    };
  });
  return {
    topic: {
      franchise_index: 0,
      franchise: "Grand Theft Auto",
      title_idea: "The Complete History of GTA",
      angle: "x",
      reason: "y",
    },
    outline: {
      title: "The Complete History of Grand Theft Auto",
      kicker: "From Dundee to Leonida",
      franchise_wiki_title: "Grand Theft Auto",
      chapters: chapters.map((c) => c.plan),
      youtube: {
        title: "The Complete History of Grand Theft Auto | Documentary",
        description: "All of it.",
        tags: ["GTA"],
      },
    },
    chapters,
    bookends: {
      intro: {
        narration: words(150, "October"),
        on_screen: "From Dundee to Leonida",
      },
      outro: {
        label: "What comes next",
        narration: words(120, "Now"),
        on_screen: "Thirty years in",
      },
    },
  };
}


/** Synthetic word timings: 0.4 s a word, as the voice would give. */
function timed(s: ReturnType<typeof docToScript>) {
  const all = segmentInputs(s).flatMap((x) => x.text.split(/\s+/).filter(Boolean));
  return all.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35 }));
}

test("documentary script: one beat per paragraph, a chapter card on each chapter's first", () => {
  const s = docToScript(draft(5));
  assert.equal(s.beats.length, 25);
  const cards = s.beats.filter((b) => b.visual.kind === "chapter");
  assert.equal(cards.length, 5);
  assert.equal(s.beats[0]!.visual.kind, "chapter");
  assert.equal(s.beats[0]!.visual.primary, "Chapter Title 1");
  assert.equal(s.beats[5]!.visual.value_a, 2);
  assert.equal(s.evergreen_format, "documentary");
  assert.equal(s.runtime, "long");
  assert.equal(s.pulse_take.label, "WHAT COMES NEXT");
  // Media is gathered per entry in descending rank: entry i must be chapter i.
  const sorted = [...s.entries!].sort((a, b) => b.rank - a.rank);
  assert.deepEqual(
    sorted.map((e) => e.game_title),
    ["Game 1", "Game 2", "Game 3", "Game 4", "Game 5"],
  );
  assert.equal(s.sources!.length, 5);
  assert.ok(
    s.claims.every((c) => c.source_url.startsWith("https://en.wikipedia.org/")),
  );
});

test("documentary word count covers intro, chapters and outro", () => {
  assert.equal(docWordCount(draft(5)), 150 + 5 * 5 * 90 + 120);
});

test("on-screen callouts must be in the source as written", () => {
  const c = chapter("x", [
    {
      kind: "quote",
      primary: "we wanted the city to feel alive",
      secondary: "Sam Houser",
    },
    { kind: "quote", primary: "the best game ever made", secondary: "Nobody" },
    { kind: "stat", primary: "17.5 million", secondary: "copies sold" },
    { kind: "stat", primary: "40 million", secondary: "copies sold" },
    { kind: "date", primary: "October 2002", secondary: "Release" },
  ]);
  const { chapter: g, removed } = groundCallouts(c, source("Vice City"));
  assert.deepEqual(
    g.paragraphs.map((p) => p.callout.kind),
    ["quote", "none", "stat", "none", "date"],
  );
  assert.equal(removed.length, 2);
});

test("chapter validation catches length and callout overuse", () => {
  assert.deepEqual(validateChapter(chapter("ok")), []);
  const short = {
    ...chapter("s"),
    paragraphs: chapter("s").paragraphs.slice(0, 2),
  };
  assert.ok(validateChapter(short).some((p) => /words/.test(p)));
  const busy = chapter(
    "b",
    Array.from({ length: 5 }, () => ({
      kind: "stat" as const,
      primary: "1",
      secondary: "x",
    })),
  );
  assert.ok(validateChapter(busy).some((p) => /callouts/.test(p)));
});

test("a chapter's beats share one entry, the outro belongs to the last chapter", () => {
  const s = docToScript(draft(3));
  const words: Array<{ text: string; start: number; end: number }> = [];
  const segs = buildSegments(segmentInputs(s), words, 1800);
  const beatEntries = segs.map((_, i) => entryOf(segs, i));
  assert.equal(beatEntries[0], undefined); // the intro uses the topic's own art
  assert.deepEqual(beatEntries.slice(1, 6), [0, 0, 0, 0, 0]);
  assert.deepEqual(beatEntries.slice(6, 11), [1, 1, 1, 1, 1]);
  const take = segs.findIndex((x) => x.kind === "take");
  assert.equal(beatEntries[take], 2);
  assert.deepEqual(
    chapterFootage(s, 1).map((f) => f.keywords[0]),
    ["c1 moment 0", "c1 moment 1", "c1 moment 2", "c1 moment 3", "c1 moment 4"],
  );
});

test("documentary chapters in the description use the searchable chapter titles", () => {
  const s = docToScript(draft(3));
  const w = timed(s);
  const segs = buildSegments(segmentInputs(s), w, w.at(-1)!.end + 6);
  const lines = chapterLines(segs, (seg) =>
    seg.kind === "hook"
      ? "Intro"
      : seg.kind === "beat" && seg.visual?.kind === "chapter"
        ? seg.visual.primary
        : seg.kind === "take"
          ? "What Comes Next"
          : undefined,
  );
  assert.equal(lines[0], "0:00 Intro");
  assert.ok(lines.some((l) => / Chapter Title 2$/.test(l)));
  assert.ok(lines.at(-1)!.endsWith("What Comes Next"));
});

test("a chapter's paragraphs walk its gallery instead of restarting it", () => {
  const s = docToScript(draft(2));
  const w = timed(s);
  const segs = buildSegments(segmentInputs(s), w, w.at(-1)!.end + 6);
  const images = Array.from({ length: 8 }, (_, k) => ({
    kind: "screenshot",
    aspect: 1.78,
    beatIndex: 0,
  })).concat(
    Array.from({ length: 8 }, () => ({
      kind: "screenshot",
      aspect: 1.78,
      beatIndex: 1,
    })),
  );
  const plan = buildLongPlan({
    segments: segs,
    words: [],
    durationSeconds: 600,
    images,
    clips: [],
    variant: 0,
  });
  // The first shot of each of chapter one's paragraphs must not all be the same still.
  const firsts = new Set<number>();
  for (let i = 1; i <= 5; i++) {
    const shot = plan.shots.find((x) => x.segment === i);
    if (shot) firsts.add(shot.media.index);
  }
  assert.ok(
    firsts.size >= 3,
    `paragraph openers reused stills: ${[...firsts]}`,
  );
  assert.ok(plan.shots.every((x) => x.end > x.start));
});

test("documentary SEO: its own lead, thumbnail line and pinned question", () => {
  const s = docToScript(draft(5));
  assert.match(keywordLead(s), /^The complete history of Grand Theft Auto/);
  assert.equal(thumbTitle(s), "The Complete History of Grand Theft Auto");
  assert.match(pinnedComment(s), /Grand Theft Auto game/);
});

test("Wikipedia extracts are cut to the sections a history needs", () => {
  const extract = `Lead text about the game.\n\n== Gameplay ==\nDriving.\n\n== Development ==\nDMA Design built it.\n\n=== Music ===\nRadio.\n\n== Reception ==\nPraised.\n\n== References ==\nRef list.`;
  const sections = splitSections(extract);
  assert.deepEqual(
    sections.map((x) => x.title),
    ["Lead", "Gameplay", "Development", "Music", "Reception", "References"],
  );
  const picked = pickSections(extract, 5000);
  assert.ok(picked.indexOf("## Development") < picked.indexOf("## Reception"));
  assert.ok(picked.indexOf("## Reception") < picked.indexOf("## Gameplay"));
  assert.ok(!picked.includes("Ref list"));
  assert.ok(pickSections(extract, 400).length <= 520);
});

import { trailerMatchesGame, parseCommons } from "../src/assets/commons.ts";
import { photoCredit } from "../src/pipeline.ts";

test("a trailer or store page must name this game, not a sibling", () => {
  assert.equal(trailerMatchesGame("Grand Theft Auto V: The Official Trailer", "Grand Theft Auto 2", "Grand Theft Auto"), false);
  assert.equal(trailerMatchesGame("Grand Theft Auto II Trailer", "Grand Theft Auto 2", "Grand Theft Auto"), true);
  assert.equal(trailerMatchesGame("Grand Theft Auto: Vice City - Anniversary Trailer", "Grand Theft Auto: Vice City", "Grand Theft Auto"), true);
  assert.equal(trailerMatchesGame("Grand Theft Auto III – The Definitive Edition", "Grand Theft Auto III", "Grand Theft Auto"), true);
  assert.equal(trailerMatchesGame("Grand Theft Auto IV: The Complete Edition", "Grand Theft Auto III", "Grand Theft Auto"), false);
  // The first game shares the series name, so nothing can safely be told apart.
  assert.equal(trailerMatchesGame("Grand Theft Auto Trailer", "Grand Theft Auto", "Grand Theft Auto"), false);
});

test("Commons: only free licences, landscape, large, and never logos or screenshots", () => {
  const page = (title: string, license: string, width = 3000, height = 2000) => ({
    title,
    imageinfo: [{ width, height, thumburl: "https://x/1920.jpg", descriptionurl: `https://commons.wikimedia.org/wiki/${title}`, extmetadata: { LicenseShortName: { value: license }, Artist: { value: "<a href='x'>Steve Hammond</a>" }, ImageDescription: { value: "The <b>team</b>" } } }],
  });
  const got = parseCommons({
    query: {
      pages: {
        1: page("File:DMA Design original team in 2011.jpg", "CC BY-SA 2.0"),
        2: page("File:GTA logo.jpg", "CC BY 2.0"),
        3: page("File:Some game screenshot.jpg", "CC BY 2.0"),
        4: page("File:Studio.jpg", "Fair use"),
        5: page("File:Tall.jpg", "CC0", 1000, 2000),
        6: page("File:Old building.jpg", "Public domain"),
      },
    },
  });
  assert.deepEqual(got.map((g) => g.title), ["File:DMA Design original team in 2011.jpg", "File:Old building.jpg"]);
  assert.equal(got[0]!.artist, "Steve Hammond");
  assert.equal(got[0]!.description, "The team");
  assert.equal(photoCredit({ kind: "photo", provenance: `Wikimedia Commons photo by Steve Hammond, CC BY-SA 2.0: https://commons.wikimedia.org/wiki/x` }), "Steve Hammond / CC BY-SA 2.0 / Wikimedia Commons");
  assert.equal(photoCredit({ kind: "screenshot", provenance: "Steam" }), undefined);
});

test("a chapter's stills alternate the game's pictures with archive photos", () => {
  const s = docToScript(draft(1));
  const w = timed(s);
  const segs = buildSegments(segmentInputs(s), w, w.at(-1)!.end + 6);
  const images = [
    ...Array.from({ length: 4 }, () => ({ kind: "screenshot", aspect: 1.78, beatIndex: 0 })),
    ...Array.from({ length: 4 }, () => ({ kind: "photo", aspect: 1.5, beatIndex: 0 })),
  ];
  const plan = buildLongPlan({ segments: segs, words: w, durationSeconds: w.at(-1)!.end + 6, images, clips: [], variant: 0 });
  const kinds = plan.shots.filter((x) => x.segment >= 1 && x.media.type === "image").slice(0, 6).map((x) => images[x.media.index]!.kind);
  assert.equal(kinds.length, 6);
  for (let k = 1; k < kinds.length; k++) assert.notEqual(kinds[k], kinds[k - 1], `two ${kinds[k]}s in a row: ${kinds.join(",")}`);
});

import { pickIgdb, parseIgdb } from "../src/assets/igdb.ts";

test("IGDB: the exact game, never a sequel that ranks higher in search", () => {
  const games = parseIgdb([
    { id: 1, name: "Grand Theft Auto V", first_release_date: 1379376000, screenshots: [{ image_id: "a" }], artworks: [] },
    { id: 2, name: "Grand Theft Auto", first_release_date: 875664000, screenshots: [{ image_id: "b" }], artworks: [], cover: { image_id: "c" } },
    { id: 3, name: "Grand Theft Auto 2", first_release_date: 940000000, screenshots: [], artworks: [] },
    { id: 4, name: "Grand Theft Auto 2", first_release_date: 970000000, screenshots: [{ image_id: "d" }], artworks: [] },
  ]);
  assert.equal(pickIgdb(games, "Grand Theft Auto", 1997)?.id, 2);
  assert.equal(pickIgdb(games, "Grand Theft Auto 2", 1999)?.id, 3);
  assert.equal(pickIgdb(games, "Grand Theft Auto IV"), undefined);
  assert.equal(games[1]!.cover, "c");
});
