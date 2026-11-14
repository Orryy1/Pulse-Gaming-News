// Item 14: one title shape and one thumbnail layout per long strand, the Shorts title rule and the chapter cadence.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MOMENT_MARK,
  cadenceChapters,
  cadenceGaps,
  framedTitle,
  gameFirstShortTitle,
  leadingAlias,
  longStrandOf,
  namesGame,
  pinStrandLayout,
  plainChapterLabel,
  shortTitleNotes,
  strandThumbWords,
  strandTitleProblems,
} from "../src/strandframe.ts";
import {
  applyShortTitleGameFirst,
  applyStrandFrame,
  shortGameName,
} from "../src/strandstep.ts";
import { chapterPrompt } from "../src/editorial/documentary.ts";
import { longRulesFor, NO_LONG_RULES } from "../src/editorial/longrules.ts";
import type { Script } from "../src/editorial/schema.ts";

test("which strand a long script belongs to", () => {
  assert.equal(
    longStrandOf({ runtime: "long", evergreen_format: "documentary" }),
    "documentary",
  );
  assert.equal(
    longStrandOf({
      runtime: "long",
      evergreen_format: "documentary",
      why_died: {},
    }),
    "whydied",
  );
  assert.equal(longStrandOf({ runtime: "long", every_game: {} }), "everygame");
  assert.equal(
    longStrandOf(
      { runtime: "long", evergreen_format: "documentary" },
      { format: "guide", guide: {} },
    ),
    "guide",
  );
  assert.equal(
    longStrandOf({
      runtime: "long",
      evergreen_format: "documentary",
      recap: true,
    }),
    undefined,
  );
  assert.equal(
    longStrandOf({ runtime: "long", evergreen_format: "ranking" }),
    undefined,
  );
  assert.equal(
    longStrandOf({ runtime: "short", evergreen_format: "documentary" }),
    undefined,
  );
  assert.equal(
    longStrandOf(
      { runtime: "long", evergreen_format: "documentary" },
      { format: "retro" },
    ),
    undefined,
  );
});

test("a title names the game by name, a distinctive word or its initials", () => {
  assert.ok(namesGame("How GTA 6 Lost Its Map", "Grand Theft Auto VI"));
  assert.ok(namesGame("How Cyberpunk Saved Itself", "Cyberpunk 2077"));
  assert.ok(!namesGame("How a Studio Saved Itself", "Cyberpunk 2077"));
});

test("each strand's one title shape", () => {
  assert.deepEqual(
    strandTitleProblems(
      "documentary",
      "How Cyberpunk 2077 Saved Itself From Dying",
      "Cyberpunk 2077",
    ),
    [],
  );
  assert.ok(
    strandTitleProblems(
      "documentary",
      "The Cyberpunk 2077 Story",
      "Cyberpunk 2077",
    ).length,
  );
  assert.deepEqual(
    strandTitleProblems(
      "whydied",
      "How Concord Lost Its Players in 12 Days",
      "Concord",
    ),
    [],
  );
  assert.ok(
    strandTitleProblems("whydied", "How Concord Lost Its Way", "Concord")
      .length,
    "a loss needs a figure",
  );
  assert.deepEqual(
    strandTitleProblems(
      "everygame",
      "The Story of Every GTA Game",
      "Grand Theft Auto",
    ),
    [],
  );
  assert.ok(
    strandTitleProblems(
      "documentary",
      "How Did Cyberpunk 2077 Come Back?",
      "Cyberpunk 2077",
    ).length,
  );
  assert.ok(
    strandTitleProblems(
      "documentary",
      "How Cyberpunk 2077 Became the Top 10 Game of 2026",
      "Cyberpunk 2077",
    ).length,
  );
});

test("a title outside the frame gives way to a variant inside it; nothing fits: no change", () => {
  const swap = framedTitle(
    "documentary",
    "The Comeback Nobody Expected",
    [
      "Cyberpunk 2077: The Comeback",
      "How Cyberpunk 2077 Saved Itself",
      "How Cyberpunk 2077 Won Back Its Players",
    ],
    "Cyberpunk 2077",
  );
  assert.equal(swap?.title, "How Cyberpunk 2077 Saved Itself");
  assert.deepEqual(swap?.variants, ["How Cyberpunk 2077 Won Back Its Players"]);
  assert.equal(
    framedTitle(
      "documentary",
      "How Cyberpunk 2077 Saved Itself",
      [],
      "Cyberpunk 2077",
    ),
    undefined,
  );
  assert.equal(
    framedTitle(
      "documentary",
      "Cyberpunk Again",
      ["Also Bad"],
      "Cyberpunk 2077",
    ),
    undefined,
  );
});

test("thumbnail words held to the strand's count; the loss figure first", () => {
  assert.equal(
    strandThumbWords("documentary", "it came back from nothing"),
    "IT CAME BACK",
  );
  assert.equal(strandThumbWords("whydied", "gone in 12 days"), "12 GONE");
  assert.equal(strandThumbWords("whydied", "-97% players"), "-97% PLAYERS");
  assert.equal(strandThumbWords("everygame", ""), "");
  assert.equal(
    strandThumbWords("guide", "best early money fast now"),
    "BEST EARLY MONEY FAST",
  );
});

test("the strand's layout leads and the variants keep it", () => {
  const designs = [
    { layout: "split" },
    { layout: "poster", n: 1 },
    { layout: "number" },
    { layout: "poster", n: 2 },
  ];
  assert.deepEqual(pinStrandLayout(designs, "documentary"), [
    { layout: "poster", n: 1 },
    { layout: "poster", n: 2 },
  ]);
  assert.deepEqual(pinStrandLayout(designs, "whydied"), [{ layout: "number" }]);
  assert.deepEqual(
    pinStrandLayout(designs, "everygame"),
    designs,
    "no motif design: unchanged",
  );
});

test("Shorts: the game's name first, then the why or how", () => {
  assert.equal(leadingAlias("GTA 6 Costs $80", "Grand Theft Auto VI"), "GTA 6");
  assert.equal(
    leadingAlias("Gtafans Are Angry", "Grand Theft Auto VI"),
    undefined,
  );
  assert.equal(
    gameFirstShortTitle("Why GTA 6 Costs $80", "Grand Theft Auto VI"),
    "GTA 6: Why It Costs $80",
  );
  assert.equal(
    gameFirstShortTitle("How Hollow Knight's Map Fooled You", "Hollow Knight"),
    "Hollow Knight: How Its Map Fooled You",
  );
  assert.equal(
    gameFirstShortTitle("GTA 6 Slips Again", "Grand Theft Auto VI"),
    "GTA 6 Slips Again",
    "already led",
  );
  assert.equal(
    gameFirstShortTitle("Why Everyone Is Angry", "Starfield"),
    "Starfield: Why Everyone Is Angry",
  );
  assert.equal(
    gameFirstShortTitle(
      "Why the Map Is Smaller",
      "Call of Duty: Modern Warfare 4",
      shortGameName("Call of Duty: Modern Warfare 4"),
    ),
    "Modern Warfare 4: Why the Map Is Smaller",
  );
  assert.deepEqual(
    shortTitleNotes("GTA 6: Why It Costs $80", "Grand Theft Auto VI"),
    [],
  );
  assert.deepEqual(shortTitleNotes("5 Things in Starfield", "Starfield"), [
    "the game's name is not first",
    "no why or how",
    "a number leads the title",
  ]);
});

test("chapter labels in plain words", () => {
  assert.equal(plainChapterLabel("Part 3: Did Sony Blink?"), "Did Sony Blink");
  assert.equal(plainChapterLabel('"The Price Reveal"...'), "The Price Reveal");
  assert.equal(plainChapterLabel("Sony's Answer!"), "Sony's Answer");
});

test("moment marks fill the chapter list, never within a minute of another mark", () => {
  const m = MOMENT_MARK;
  const lines = [
    "0:00 Intro",
    `0:40 ${m}Too Early`,
    "1:30 The Reveal",
    `2:50 ${m}The Price?`,
    `3:20 ${m}Too Close`,
    `4:40 ${m}Before The Launch`,
    "5:10 The Launch",
  ];
  assert.deepEqual(
    cadenceChapters(lines),
    ["0:00 Intro", "1:30 The Reveal", "2:50 The Price", "5:10 The Launch"],
    "too early, too close and 30 s before a chapter: dropped",
  );
  assert.deepEqual(cadenceGaps(["0:00 Intro", "1:30 A", "5:00 B"], 460), [
    [90, 300],
    [300, 460],
  ]);
});

test("the chapter writer asks for moment marks only under LONG_CHAPTER_CADENCE", () => {
  const base = {
    longYouPer1000: 0,
    guideYouPer1000: 0,
    longSentenceGate: 0,
    longHookStack: 0,
    longOpenLoopsMax: 0,
    loopNamePayoff: false,
    longVerdictStamps: false,
    longGuideFormat: false,
    guideChapterAction: false,
  };
  assert.equal(longRulesFor(base, "documentary").chapterMarks, undefined);
  const on = longRulesFor({ ...base, longChapterCadence: true }, "documentary");
  assert.equal(on.chapterMarks, true);
  assert.match(chapterPrompt(on), /Moment marks/);
  assert.doesNotMatch(chapterPrompt(NO_LONG_RULES), /Moment marks/);
});

const fakeDb = () => {
  const events: Array<{ kind: string; detail: unknown }> = [];
  return {
    events,
    db: {
      query: async (sql: string, params: unknown[] = []) => {
        if (/INSERT INTO events/i.test(sql))
          events.push({ kind: String(params[1]), detail: params[2] });
        return [];
      },
    } as never,
  };
};

test("applyStrandFrame: off does nothing; on swaps to a framed variant and holds the thumbnail words", async () => {
  const script = {
    runtime: "long",
    evergreen_format: "documentary",
    game_title: "Cyberpunk 2077",
    youtube: {
      title: "The Comeback Nobody Expected",
      title_variants: [
        "How Cyberpunk 2077 Saved Itself",
        "Cyberpunk 2077 Is Back",
      ],
      thumb_text: "it came back from nothing",
      description: "",
      tags: [],
    },
  } as unknown as Script;
  const notes: string[] = [];
  const { db } = fakeDb();
  const off = {
    cfg: { strandFrames: false, shortTitleGameFirst: false },
    db,
    notify: async () => undefined,
  };
  assert.equal(await applyStrandFrame(off, { id: "e1" }, script), undefined);
  assert.equal(script.youtube.title, "The Comeback Nobody Expected");
  const on = {
    ...off,
    cfg: { strandFrames: true, shortTitleGameFirst: false },
    notify: async (m: { content: string }) => notes.push(m.content),
  };
  assert.equal(await applyStrandFrame(on, { id: "e1" }, script), "documentary");
  assert.equal(script.youtube.title, "How Cyberpunk 2077 Saved Itself");
  assert.deepEqual(script.youtube.title_variants, []);
  assert.equal(script.youtube.thumb_text, "IT CAME BACK");
  assert.deepEqual(notes, []);
});

test("applyShortTitleGameFirst: news Shorts only, under the setting", async () => {
  const { db } = fakeDb();
  const s = {
    cfg: { strandFrames: false, shortTitleGameFirst: true },
    db,
    notify: async () => undefined,
  };
  const short = {
    runtime: "short",
    game_title: "Starfield",
    youtube: { title: "Why Everyone Is Angry" },
  } as unknown as Script;
  assert.equal(await applyShortTitleGameFirst(s, { id: "e2" }, short), true);
  assert.equal(short.youtube.title, "Starfield: Why Everyone Is Angry");
  const long = {
    runtime: "long",
    game_title: "Starfield",
    youtube: { title: "Why Everyone Is Angry" },
  } as unknown as Script;
  assert.equal(await applyShortTitleGameFirst(s, { id: "e3" }, long), false);
  const offS = {
    ...s,
    cfg: { strandFrames: false, shortTitleGameFirst: false },
  };
  const again = {
    runtime: "short",
    game_title: "Starfield",
    youtube: { title: "Why Everyone Is Angry" },
  } as unknown as Script;
  assert.equal(
    await applyShortTitleGameFirst(offS, { id: "e4" }, again),
    false,
  );
});
