// Every long format gets the long-video craft (31 Oct 2026): rankings and weekly recaps as well as the
// documentaries, each device behind its own setting and shaped to the format (a ranking's chapters are its
// entries), plus the strengths borrowed from the Shorts (a burst of quick cuts inside every entry, a 5-10
// word first line, the sound beats in the ranking's shot list).
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  longCraft,
  longFormatOf,
  longKindLabel,
  loopsFor,
  type LongCraftSettings,
} from "../src/longformat.ts";
import {
  ENTRY_PACE_MIN_SECONDS,
  chapterMarks,
  entryBursts,
  odometerDigits,
  rhythmBursts,
  structureLine,
  structureSummary,
  yearAt,
} from "../src/render/structure.ts";
import { buildLongPlan, momentWindows } from "../src/render/longplan.ts";
import type { Segment } from "../src/render/timeline.ts";
import { chapterSentences } from "../src/pipeline.ts";
import {
  hookRule,
  longformPrompt,
  writeMoments,
  RANK_BEATS_RULE,
} from "../src/editorial/longform.ts";
import { DOC_BEAT_KINDS, groundBeats } from "../src/editorial/documentary.ts";
import { cameraNotice } from "../src/render/camera.ts";
import { soundDesignLine } from "../src/render/sounddesign.ts";
import { RELEASE_GATE_PROMPT, scoreShots } from "../src/qa/releaseGate.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { Script } from "../src/editorial/schema.ts";

const ALL_ON: LongCraftSettings = {
  fillers: true,
  longCamera: ["track", "freeze"],
  docTitleDrop: true,
  docChapterIndex: true,
  docOpenLoops: true,
  docCutRhythm: true,
  docBookendEnding: true,
  docColdOpen: true,
  docSoundBeats: true,
  releaseGate: true,
  longEntryPace: true,
};

test("the format: a recap before its documentary shape, a ranking, anything else long", () => {
  assert.equal(
    longFormatOf({ evergreen_format: "documentary" }),
    "documentary",
  );
  assert.equal(
    longFormatOf({ evergreen_format: "documentary", recap: true }),
    "recap",
  );
  assert.equal(longFormatOf({ evergreen_format: "ranking" }), "ranking");
  assert.equal(longFormatOf({}), "long");
  assert.equal(longKindLabel("ranking"), "Ranking");
  assert.equal(longKindLabel("recap"), "Weekly recap");
});

test("every long format gets the craft, each behind its setting; the documentary shape stays with documentaries", () => {
  for (const f of ["documentary", "ranking"] as const) {
    const c = longCraft({ evergreen_format: f }, ALL_ON);
    assert.equal(c.fillers, true);
    assert.deepEqual(c.camera, ["track", "freeze"]);
    assert.equal(c.titleDrop && c.chapterIndex && c.rhythm && c.bookend, true);
    assert.equal(
      c.coldOpen && c.soundBeats && c.eraBeds && c.releaseGate,
      true,
    );
  }
  const rank = longCraft({ evergreen_format: "ranking" }, ALL_ON);
  const doc = longCraft({ evergreen_format: "documentary" }, ALL_ON);
  const recap = longCraft(
    { evergreen_format: "documentary", recap: true },
    ALL_ON,
  );
  // A ranking: loops only when placed, the per-entry pace, no documentary shape.
  assert.deepEqual(
    [rank.loops, rank.entryPace, rank.documentaryShape],
    ["placed", true, false],
  );
  assert.deepEqual(
    [doc.loops, doc.entryPace, doc.documentaryShape],
    ["derive", false, true],
  );
  assert.deepEqual(
    [recap.format, recap.loops, recap.documentaryShape],
    ["recap", "derive", true],
  );
  // Settings off turn each off for every format.
  const off = longCraft(
    { evergreen_format: "ranking" },
    {
      ...ALL_ON,
      fillers: false,
      longCamera: [],
      docTitleDrop: false,
      docOpenLoops: false,
      docCutRhythm: false,
      docSoundBeats: false,
      releaseGate: false,
    },
  );
  assert.deepEqual(
    [
      off.fillers,
      off.camera.length,
      off.titleDrop,
      off.loops,
      off.rhythm,
      off.entryPace,
      off.soundBeats,
      off.eraBeds,
      off.releaseGate,
    ],
    [false, 0, false, "off", false, false, false, false, false],
  );
  assert.equal(
    longCraft(
      { evergreen_format: "ranking" },
      { ...ALL_ON, longEntryPace: false },
    ).entryPace,
    false,
  );
});

test("open loops: a ranking recalls only loops its script placed; a documentary may derive them", () => {
  const derive = () => ["guessed"];
  const rank = longCraft({ evergreen_format: "ranking" }, ALL_ON);
  const doc = longCraft({ evergreen_format: "documentary" }, ALL_ON);
  assert.equal(loopsFor(rank, undefined, derive), undefined);
  assert.equal(loopsFor(rank, [], derive), undefined);
  assert.deepEqual(loopsFor(rank, ["placed"], derive), ["placed"]);
  assert.deepEqual(loopsFor(doc, undefined, derive), ["guessed"]);
  assert.equal(
    loopsFor(
      longCraft(
        { evergreen_format: "documentary" },
        { ...ALL_ON, docOpenLoops: false },
      ),
      ["x"],
      derive,
    ),
    undefined,
  );
});

// A ranking's timeline: the intro, one "rank" beat per entry (lowest rank first), the outro.
const rankSeg = (
  rank: number,
  start: number,
  end: number,
  year?: string,
): Segment => ({
  kind: "beat",
  text: `Number ${rank}. It is a game. It has a moment. It lands here.`,
  start,
  end,
  visual: {
    kind: "rank",
    primary: `Game ${rank}`,
    secondary: "chip",
    value_a: rank,
    items: year === undefined ? [] : [year, "PC"],
  },
});
const ranking = (): Segment[] => [
  {
    kind: "hook",
    text: "A short line opens it. Then the rule.",
    start: 0,
    end: 30,
  },
  rankSeg(3, 30, 90, "2001"),
  rankSeg(2, 90, 150),
  rankSeg(1, 150, 210, "2010"),
  {
    kind: "take",
    text: "The winner wins.",
    start: 210,
    end: 240,
    label: "OUR PICK",
  },
];

test("the chapter index counts down a ranking's entries and the corner shows the rank where there is no year", () => {
  const segs = ranking();
  const starts = segs.map((s, i) => (i === 0 ? 0 : Math.round(s.start * 30)));
  const marks = chapterMarks(segs, starts, 240 * 30);
  assert.deepEqual(
    marks.map((m) => [m.number, m.from, m.to, m.year, m.rank]),
    [
      [3, 900, 2700, 2001, 3],
      [2, 2700, 4500, undefined, 2],
      [1, 4500, 6300, 2010, 1],
    ],
  );
  // Entry #2 has no year: the counter shows "#2", rolling down from #3.
  const r = yearAt(marks, 2700 + 12)!;
  assert.deepEqual([r.year, r.from, r.prefix], [2, 3, "#"]);
  assert.equal(yearAt(marks, 1200)!.prefix, undefined);
  assert.equal(yearAt(marks, 1200)!.year, 2001);
  assert.deepEqual(
    odometerDigits(3, 2, 1, 2).map((d) => d.in),
    ["0", "2"],
  );
});

test("a ranking's entries each get a burst of quicker cuts at their middle, a Short's pace", () => {
  const fps = 30;
  // Entries of 60 s, one too short for a burst, and an entry that already has an interval burst.
  const bounds = [0, 60 * fps, 80 * fps, 140 * fps];
  const got = entryBursts(bounds, fps, [{ from: 100 * fps, to: 110 * fps }]);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.from, 25 * fps); // the middle of 0-60 s, 10 s long
  assert.equal(got[0]!.to - got[0]!.from, 10 * fps);
  assert.ok(20 * fps < ENTRY_PACE_MIN_SECONDS * fps);
  // Through the plan's rhythm: off, only the interval bursts; on, one per entry long enough.
  const segs = ranking();
  const total = 240 * fps;
  assert.equal(rhythmBursts(segs, total, fps, false).entry, 0);
  const on = rhythmBursts(segs, total, fps, true);
  assert.equal(on.entry, 3);
  assert.deepEqual(
    on.all.map((b) => b.from / fps),
    [55, 115, 175],
  );
  // The plan caps its shots to 2 s inside those bursts.
  const plan = buildLongPlan({
    segments: segs,
    words: [],
    durationSeconds: 240,
    images: Array.from({ length: 6 }, (_, i) => ({
      kind: "screenshot",
      aspect: 16 / 9,
      beatIndex: i % 3,
    })),
    clips: [],
    variant: 0,
    rhythm: true,
    entryPace: true,
  });
  const inBurst = plan.shots.filter(
    (s) => s.start >= 56 * fps && s.end <= 64 * fps,
  );
  assert.ok(
    inBurst.length >= 3,
    `shots inside the first entry's burst: ${inBurst.length}`,
  );
  assert.ok(inBurst.every((s) => s.end - s.start <= 60));
});

test("the structure line names the format, the ranks and the entry bursts", () => {
  const segs = ranking();
  const plan = buildLongPlan({
    segments: segs,
    words: [],
    durationSeconds: 240,
    images: [{ kind: "screenshot", aspect: 16 / 9, beatIndex: 0 }],
    clips: [],
    variant: 0,
  });
  const s = structureSummary({
    segments: segs,
    words: [],
    windows: momentWindows(segs, [], [4, 4, 4]),
    fps: 30,
    breaks: [],
    plan,
    on: {
      titleDrop: false,
      chapterIndex: true,
      loops: false,
      rhythm: true,
      bookend: false,
      entryPace: true,
    },
  });
  assert.deepEqual(
    [s.chapters, s.years, s.ranks, s.entryBursts, s.bursts],
    [3, 2, 1, 3, 3],
  );
  const line = structureLine("Every Halo Campaign Ranked", s, "Ranking");
  assert.match(line, /^Ranking structure for "Every Halo Campaign Ranked"/);
  assert.match(
    line,
    /3-chapter index with the year in the corner for 2 of them and the rank for 1/,
  );
  assert.match(line, /3 inside the entries, a Short's pace/);
  assert.doesNotMatch(line, /—/);
});

test("a ranking's chapter sentences are its entries' (they came back empty before)", () => {
  const script = {
    beats: [
      {
        narration: "First one. Second one.",
        visual: { kind: "rank", primary: "A", secondary: "", value_a: 2 },
      },
      {
        narration: "Third one.",
        visual: { kind: "rank", primary: "B", secondary: "", value_a: 1 },
      },
    ],
  } as unknown as Script;
  assert.deepEqual(chapterSentences(script, 0), ["First one.", "Second one."]);
  assert.deepEqual(chapterSentences(script, 1), ["Third one."]);
});

test("the ranking writer: a 5-10 word first line with LONG_PUNCHY_HOOK, the older rule without", () => {
  assert.match(longformPrompt({ punchyHook: true }), /5-10 words/);
  assert.match(longformPrompt(), /under 15 words/);
  assert.doesNotMatch(longformPrompt(), /5-10 words/);
  assert.equal(hookRule(false).includes("under 15"), true);
});

function fakeLlm(reply: unknown, seen: string[]): Llm {
  return {
    structured: async (o: { system: string }) => {
      seen.push(o.system);
      return reply;
    },
  } as unknown as Llm;
}

test("the ranking's shot list carries the sound beats, grounded as a documentary's are, only with DOC_SOUND_BEATS", async () => {
  const narration =
    "Halo 3 opened the trilogy's end. It sold 8 million copies in a month. Then the story turned dark. The finale still works.";
  const m = (beat?: string) => ({
    show: "x",
    keywords: ["x"],
    graphic: { kind: "none", primary: "", secondary: "", items: [] },
    emphasis: "",
    person: "",
    ...(beat ? { beat } : {}),
  });
  // Sentence 1 never gets one; sentence 2 has a figure; sentence 3 follows a kept beat; 4 has nothing to ground it.
  const reply = { moments: [m("reveal"), m("record"), m("turn"), m("key")] };
  const seen: string[] = [];
  const on = await writeMoments(fakeLlm(reply, seen), "Halo 3", narration, [], {
    soundBeats: true,
  });
  assert.deepEqual(
    on.map((x) => x.beat),
    ["none", "record", "none", "none"],
  );
  assert.ok(seen[0]!.includes(RANK_BEATS_RULE));
  // The grounding is the documentary's own.
  assert.deepEqual(
    groundBeats(
      reply.moments as never,
      narration.split(/(?<=\.)\s/),
    ).moments.map((x: { beat?: string }) => x.beat),
    on.map((x) => x.beat),
  );
  const seenOff: string[] = [];
  const off = await writeMoments(
    fakeLlm(reply, seenOff),
    "Halo 3",
    narration,
    [],
    {},
  );
  assert.ok(off.every((x) => x.beat === undefined));
  assert.ok(!seenOff[0]!.includes(RANK_BEATS_RULE));
  assert.ok(DOC_BEAT_KINDS.includes("record"));
});

test("the owner's lines name the format", () => {
  assert.match(
    cameraNotice("Halo", ["track"], 0, "Ranking"),
    /^Ranking "Halo"/,
  );
  assert.match(cameraNotice("Halo", ["track"], 0, "Ranking"), /LONG_CAMERA/);
  assert.match(cameraNotice("GTA", [], 0), /^Documentary "GTA"/);
  const sum = {
    beats: { reveal: 1, key: 0, record: 0, turn: 0, quiet: 0 },
    total: 1,
    eras: {},
    chapters: 0,
  };
  assert.match(soundDesignLine("Halo", sum, "Ranking"), /Ranking "Halo"/);
});

test("the release gate reads rankings and recaps, and names the format to the reviewer", async () => {
  assert.match(RELEASE_GATE_PROMPT, /ranking/);
  assert.match(RELEASE_GATE_PROMPT, /recap/);
  const texts: string[] = [];
  const llm = {
    structured: async (o: {
      content: Array<{ type: string; text?: string }>;
    }) => {
      for (const c of o.content)
        if (c.type === "text" && c.text) texts.push(c.text);
      return { frames: [{ frame: 1, score: 3, reason: "the entry" }] };
    },
  } as unknown as Llm;
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "gate-"));
  const file = path.join(dir, "f.jpg");
  await fs.writeFile(file, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const scored = await scoreShots(
    [
      {
        index: 0,
        start: 0,
        end: 4,
        words: "Halo 3 lands at number one",
        chapter: "Halo 3 (2007)",
      } as never,
    ],
    {
      llm,
      headline: "Every Halo Campaign Ranked",
      game: "Halo",
      kind: "Ranking",
      frame: async () => file,
    },
  );
  await fs.rm(dir, { recursive: true, force: true });
  assert.equal(scored[0]!.score, 3);
  assert.ok(
    texts.some((t) => t.startsWith("Ranking: Every Halo Campaign Ranked")),
  );
});
