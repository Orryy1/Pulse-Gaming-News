import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  RETRO_SECTIONS,
  actSourceText,
  actTranscript,
  budgetTotal,
  retroChapterBudget,
  retroChapterFootageSeconds,
  retroDocOutline,
  retroOutlineSystem,
  retroQuotesPerChapter,
  retroSite,
  retroSites,
  reviewQuoteProblems,
  storyActs,
  titleWarnsSpoilers,
  validateRetroOutline,
  withRetroWarning,
  type RetroOutline,
} from "../src/editorial/retrospective.ts";
import {
  DEFAULT_RETRO_FILE,
  RetroPlanSchema,
  isRetrospective,
  readRetroPlan,
  retroDue,
  retroIndexProblems,
  retroTitleProblems,
  retroTopic,
  sourcesForSection,
  type RetroPlan,
} from "../src/retrospective.ts";
import {
  retroSandboxChapters,
  retroChapterSource,
  retroChapterSpans,
} from "../src/retrostep.ts";
import { hasSpoilerWarning } from "../src/sceneindex/spoilers.ts";
import { siteListed } from "../src/editorial/codex.ts";
import {
  emptySceneIndex,
  parseSceneIndex,
  type SceneIndex,
} from "../src/sceneindex/schema.ts";
import { findShots, shotAtPlace } from "../src/sceneindex/lookup.ts";
import { planIndexedClips } from "../src/sceneindex/footage.ts";
import {
  applySpeakers,
  needsSpeaker,
  speakerChunks,
} from "../src/sceneindex/speakers.ts";
import { unquotable } from "../src/sceneindex/quotepick.ts";
import {
  chapterFootageUsed,
  reconcileCutsceneBudgets,
} from "../src/assets/cutscenes.ts";
import { localTime } from "../src/lanes.ts";
import type { Llm } from "../src/editorial/llm.ts";

const TZ = "Europe/London";

/** A three-hour movie: shots every 6 s, a heard line every 10 s, a 20 s silence at 1:00:00 and 2:00:00. */
function movie(): SceneIndex {
  const index = emptySceneIndex(
    "Grand Theft Auto: San Andreas",
    {
      videoId: "DtArUwDHHeY",
      title: "Full Game Movie",
      uploader: "u",
      duration: 3 * 3600,
      kind: "movie",
      pickedAt: "2026-11-12T00:00:00Z",
    },
    new Date("2026-11-12T00:00:00Z"),
  );
  index.coverage = [{ from: 0, to: 3 * 3600 }];
  index.cast = ["Carl Johnson", "Sweet", "Big Smoke", "Ryder", "Tenpenny"];
  index.places = ["Grove Street", "Los Santos", "San Fierro"];
  for (let t = 0, id = 0; t < 3 * 3600; t += 6, id++)
    index.shots.push({
      id,
      start: t,
      end: t + 6,
      keyframes: [t + 3],
      desc: "",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "",
      luma: 90,
      motion: 10,
    });
  let id = 0;
  for (let t = 1; t < 3 * 3600; t += 10) {
    if ((t > 3590 && t < 3610) || (t > 7190 && t < 7210)) continue;
    const text =
      t < 3600
        ? `Grove Street line number ${id} for the family.`
        : t < 7200
          ? `San Fierro line number ${id} in the fog.`
          : `Los Santos riot line ${id} tonight.`;
    index.lines.push({
      id: id++,
      start: t,
      end: t + 3,
      text,
      via: "both",
      shot: Math.floor(t / 6),
    });
  }
  return index;
}

const plan = (over: Partial<RetroPlan> = {}): RetroPlan =>
  RetroPlanSchema.parse({
    first: "2026-11-25",
    slot: "17:00",
    games: [
      {
        key: "gta-san-andreas",
        on: true,
        game: "Grand Theft Auto: San Andreas",
        short: "GTA San Andreas",
        wiki: "Grand Theft Auto: San Andreas",
        year: 2004,
        platforms: "PS2",
        angle:
          "How a studio in Edinburgh built a whole state, told from its making to every beat of its story.",
      },
      {
        key: "zelda",
        on: true,
        game: "The Legend of Zelda: Ocarina of Time",
        short: "Ocarina of Time",
        wiki: "The Legend of Zelda: Ocarina of Time",
        year: 1998,
        platforms: "N64",
        allowed_from: "2026-12-04",
        angle:
          "The game that taught 3D games how to fight, and every beat of Link's journey.",
      },
    ],
    ...over,
  });

test("chapter budget: a chapter every three to four minutes, the story the largest, 40 to 90 minutes", () => {
  const b60 = retroChapterBudget(60);
  assert.equal(budgetTotal(b60), 15);
  assert.ok(RETRO_SECTIONS.every((s) => b60[s] >= 1));
  assert.ok(RETRO_SECTIONS.every((s) => s === "story" || b60.story > b60[s]));
  assert.ok(b60.story >= 6);
  assert.equal(
    budgetTotal(retroChapterBudget(10)),
    budgetTotal(retroChapterBudget(40)),
  );
  assert.equal(
    budgetTotal(retroChapterBudget(500)),
    budgetTotal(retroChapterBudget(90)),
  );
  assert.ok(budgetTotal(retroChapterBudget(90)) >= 22);
  // Minutes per chapter stay "every few minutes".
  for (const m of [40, 60, 90]) {
    const per = (m - 2.5) / budgetTotal(retroChapterBudget(m));
    assert.ok(per >= 3 && per <= 4.5, `${m} min: ${per}`);
  }
  assert.match(retroOutlineSystem(b60), /story \(The full story\): exactly 7 chapters/);
});

test("story acts are cut at the movie's scene breaks and cover it end to end", () => {
  const index = movie();
  const acts = storyActs(index, 3);
  assert.equal(acts.length, 3);
  assert.equal(acts[0]!.from, 0);
  assert.equal(acts.at(-1)!.to, 3 * 3600);
  // The cuts land in the 20-second silences, not in the middle of a scene.
  assert.ok(Math.abs(acts[1]!.from - 3600) < 20, String(acts[1]!.from));
  assert.ok(Math.abs(acts[2]!.from - 7200) < 20, String(acts[2]!.from));
  for (let i = 1; i < acts.length; i++)
    assert.equal(acts[i]!.from, acts[i - 1]!.to);
  assert.ok(acts[0]!.places.includes("Grove Street"));
  assert.ok(acts[1]!.places.includes("San Fierro"));
  assert.equal(acts[0]!.indexed, 1);
  assert.ok(acts[0]!.opening[0]!.startsWith("Grove Street"));
});

test("an act's transcript is the game's own heard lines in order, read-off repeats dropped, thinned to fit", () => {
  const index = movie();
  index.lines.push({
    id: 9999,
    start: 2,
    end: 4,
    text: "Grove Street line number 0 for the family.",
    via: "textbox",
    shot: 0,
  });
  const [a] = storyActs(index, 3);
  const t = actTranscript(index, a!, 100_000);
  assert.ok(t.startsWith("[0:01] Grove Street line number 0"));
  assert.equal(
    t.split("\n").filter((l) => l.includes("line number 0 ")).length,
    1,
  );
  assert.ok(!t.includes("San Fierro"));
  const short = actTranscript(index, a!, 2000);
  assert.ok(short.length <= 2100 && short.split("\n").length > 20);
  assert.match(
    actSourceText(index.game, index, a!),
    /^\[Grand Theft Auto: San Andreas, the game's own cutscenes\] Transcript of act 1/,
  );
});

function outline(acts = 3): RetroOutline {
  const ch = (
    section: RetroOutline["chapters"][number]["section"],
    title: string,
    act = 0,
  ) => ({
    section,
    chapter_title: title,
    wiki_title: "Grand Theft Auto: San Andreas",
    focus: `${title} focus.`,
    act,
    moments: section === "moments" ? ["The Green Sabre"] : [],
    photo_searches: ["Rockstar North Edinburgh"],
  });
  return {
    question: "How did a trip home become a whole state?",
    kicker: "From Edinburgh to Grove Street",
    chapters: [
      ch("history", "Rockstar North Goes West"),
      ch("making", "Building a Whole State"),
      ch("innovations", "Gyms, Haircuts and Hunger"),
      ...Array.from({ length: acts }, (_, i) =>
        ch("story", `Act Beat ${i + 1}`, i + 1),
      ),
      ch("moments", "The Moments Everyone Remembers"),
      ch("reception", "Critics Call It the Best Yet"),
      ch("legacy", "Hot Coffee and the Remasters"),
    ],
    youtube: { description: "The whole story.", tags: ["gta"] },
  };
}

test("an outline keeps the sections in order and tells every act once", () => {
  const budget = {
    ...retroChapterBudget(40),
    history: 1,
    making: 1,
    innovations: 1,
    story: 3,
    moments: 1,
    reception: 1,
    legacy: 1,
  };
  assert.deepEqual(validateRetroOutline(outline(), budget, 3), []);
  const swapped = outline();
  [swapped.chapters[0], swapped.chapters[1]] = [
    swapped.chapters[1]!,
    swapped.chapters[0]!,
  ];
  assert.match(validateRetroOutline(swapped, budget, 3).join(" "), /in order/);
  const skipped = outline();
  skipped.chapters[4]!.act = 3;
  assert.match(
    validateRetroOutline(skipped, budget, 3).join(" "),
    /must tell acts 1 to 3/,
  );
  const dup = outline();
  dup.chapters[1]!.chapter_title = dup.chapters[0]!.chapter_title;
  assert.match(validateRetroOutline(dup, budget, 3).join(" "), /used twice/);
});

test("the outline becomes the documentary lane's: one game, the fixed title, the section's brief in every focus", () => {
  const acts = storyActs(movie(), 3);
  const { outline: doc, info } = retroDocOutline(
    outline(),
    {
      game: "Grand Theft Auto: San Andreas",
      wiki: "Grand Theft Auto: San Andreas",
      year: 2004,
      platforms: "PS2",
      steam: "GTA San Andreas",
    },
    {
      title: "The Full Story of GTA San Andreas, Spoilers and All",
      thumb: "THE FULL STORY",
    },
    acts,
  );
  assert.equal(
    doc.title,
    "The Full Story of GTA San Andreas, Spoilers and All",
  );
  assert.equal(doc.youtube.title, doc.title);
  assert.equal(doc.youtube.thumb_text, "THE FULL STORY");
  assert.equal(doc.chapters.length, 9);
  assert.ok(
    doc.chapters.every(
      (c) =>
        c.game_title === "Grand Theft Auto: San Andreas" && c.year === 2004,
    ),
  );
  assert.match(
    doc.chapters[3]!.focus,
    /^The full story\. .*act 1 of the story, 0:00 to 1:00:/,
  );
  assert.match(doc.chapters[7]!.focus, /^Reception and reviews\./);
  assert.deepEqual(
    info.map((c) => c.act ?? 0),
    [0, 0, 0, 1, 2, 3, 0, 0, 0],
  );
  assert.deepEqual(info[6]!.moments, ["The Green Sabre"]);
});

test("a retrospective opens on its spoiler warning, which the spoiler guard reads as one", () => {
  const hook = withRetroWarning(
    "In 2004, a studio in Edinburgh built California.",
    "GTA San Andreas",
  );
  assert.match(
    hook,
    /^Spoiler warning: this is the whole story of GTA San Andreas, ending and all/,
  );
  assert.ok(hasSpoilerWarning([hook]));
  assert.equal(withRetroWarning(hook, "GTA San Andreas"), hook);
  assert.ok(
    titleWarnsSpoilers("The Full Story of GTA San Andreas, Spoilers and All"),
  );
  assert.ok(!titleWarnsSpoilers("Why GTA San Andreas Still Matters"));
});

test("a quoted review is word for word from the source and names who said it", () => {
  const source = `Grand Theft Auto: San Andreas received critical acclaim. GameSpot's Jeff Gerstmann wrote that it was "the most expansive and impressive Grand Theft Auto yet", and IGN praised its size.\n\n[Grand Theft Auto: San Andreas, the game's own cutscenes] Transcript of act 1\n[0:05] Sweet: Hey, she was my momma too, and you left us all behind.`;
  const game = "Grand Theft Auto: San Andreas";
  assert.deepEqual(
    reviewQuoteProblems(
      `GameSpot's Jeff Gerstmann called it "the most expansive and impressive Grand Theft Auto yet".`,
      source,
      game,
    ),
    [],
  );
  assert.match(
    reviewQuoteProblems(
      `Critics called it "the most expansive and impressive Grand Theft Auto yet".`,
      source,
      game,
    ).join(" "),
    /does not say who said it/,
  );
  assert.match(
    reviewQuoteProblems(
      `GameSpot called it "the greatest open world game ever made by anyone".`,
      source,
      game,
    ).join(" "),
    /not word for word/,
  );
  // A line of the game's own dialogue is credited by the story, not an outlet.
  assert.deepEqual(
    reviewQuoteProblems(
      `He's barely through the door when it lands: "Hey, she was my momma too, and you left us all behind."`,
      source,
      game,
    ),
    [],
  );
});

test("footage per chapter scales the publisher's per-Short cap to the chapter's length", () => {
  assert.equal(retroChapterFootageSeconds(34, 240), 136);
  assert.equal(retroChapterFootageSeconds(34, 600), 150);
  assert.equal(retroChapterFootageSeconds(34, 240, 0.5), 68);
  assert.equal(retroChapterFootageSeconds(0, 240), 0);
  assert.equal(retroChapterFootageSeconds(34, 60, 3, 999), 54);
  assert.deepEqual(
    retroQuotesPerChapter(
      [{ section: "history" }, { section: "story" }, { section: "moments" }],
      3,
    ),
    [1, 3, 3],
  );
});

test("every model call of a retrospective goes under its own site, so CODEX_CALLS=retro routes the strand", async () => {
  assert.equal(retroSite("doc.chapter"), "retro.chapter");
  assert.equal(retroSite("doc.check"), "retro.check");
  assert.equal(retroSite("friend.doc"), "retro.friend");
  assert.equal(retroSite("quote.long"), "retro.quote");
  assert.equal(retroSite("retro.outline"), "retro.outline");
  assert.ok(siteListed("retro.chapter", ["retro"]));
  assert.ok(!siteListed("doc.chapter", ["retro"]));
  const seen: string[] = [];
  const llm: Llm = {
    structured: async (o) => (seen.push(o.site ?? ""), {}) as never,
  };
  await retroSites(llm).structured({
    system: "",
    content: "",
    schema: {} as never,
    site: "doc.shots",
  });
  assert.deepEqual(seen, ["retro.shots"]);
});

test("a game's movie must be filed and nearly all indexed before its retrospective runs", () => {
  const needs = { minShare: 0.95, minHeard: 400 };
  assert.match(retroIndexProblems(undefined, needs)[0]!, /no full-story movie/);
  const index = movie();
  assert.deepEqual(retroIndexProblems(index, needs), []);
  const part = { ...index, coverage: [{ from: 0, to: 3600 }] };
  assert.match(retroIndexProblems(part, needs).join(" "), /33% indexed/);
  assert.match(
    retroIndexProblems(index, { minShare: 0.5, minHeard: 5000 }).join(" "),
    /heard lines/,
  );
});

test("slots: the first game ready takes the slot; spoiler windows, dates and missing movies wait", () => {
  const p = plan();
  const slot1 = localTime("2026-11-25", "17:00", TZ);
  const inWindow = new Date(slot1.getTime() - 10 * 3_600_000);
  const ready = () => ({ filed: [], windowOpen: false });
  const r = retroDue(p, true, inWindow, [], [], TZ, ready);
  assert.equal(r.due?.game.key, "gta-san-andreas");
  assert.equal(r.due?.at.getTime(), slot1.getTime());
  assert.equal(r.due?.topic.format, "retro");
  assert.equal(
    r.due?.topic.retro?.title,
    "The Full Story of GTA San Andreas, Spoilers and All",
  );
  assert.ok(isRetrospective({ topic: r.due!.topic }));
  // Off, or before the making window: nothing.
  assert.equal(retroDue(p, false, inWindow, [], [], TZ, ready).due, undefined);
  assert.equal(
    retroDue(
      p,
      true,
      new Date(slot1.getTime() - 60 * 3_600_000),
      [],
      [],
      TZ,
      ready,
    ).due,
    undefined,
  );
  // San Andreas not filed: Ocarina is not allowed until 4 Dec, so the slot waits and says why.
  const notFiled = (g: { key: string }) => ({
    filed:
      g.key === "gta-san-andreas"
        ? ["no full-story movie filed in the scene index yet"]
        : [],
    windowOpen: false,
  });
  const w = retroDue(p, true, inWindow, [], [], TZ, notFiled);
  assert.equal(w.due, undefined);
  assert.match(w.waiting.join(" | "), /GTA San Andreas: no full-story movie/);
  assert.match(w.waiting.join(" | "), /Ocarina of Time: not before 2026-12-04/);
  // San Andreas made: from 4 Dec Ocarina takes its slot, unless its window is still open.
  const slot3 = localTime("2026-12-09", "17:00", TZ);
  const near3 = new Date(slot3.getTime() - 3_600_000);
  assert.equal(
    retroDue(p, true, near3, [], ["gta-san-andreas"], TZ, ready).due?.game.key,
    "zelda",
  );
  assert.match(
    retroDue(p, true, near3, [], ["gta-san-andreas"], TZ, () => ({
      filed: [],
      windowOpen: true,
    })).waiting[0]!,
    /spoiler window is still open/,
  );
  // A slot something else took is left alone.
  assert.equal(
    retroDue(p, true, inWindow, [slot1], [], TZ, ready).due,
    undefined,
  );
});

test("the plan file parses, starts with San Andreas, and every title says it spoils", () => {
  const p = readRetroPlan(DEFAULT_RETRO_FILE)!;
  assert.ok(p);
  assert.equal(p.games[0]!.game, "Grand Theft Auto: San Andreas");
  assert.equal(p.games[1]!.game, "Grand Theft Auto V");
  assert.equal(
    p.games.find((g) => g.key === "zelda-ocarina-remake")?.allowed_from,
    "2026-12-04",
  );
  assert.equal(
    p.games.find((g) => g.key === "gta-vi")?.allowed_from,
    "2026-12-18",
  );
  assert.ok(
    p.games.every((g) => !g.on),
    "every game ships switched off",
  );
  for (const g of p.games)
    assert.deepEqual(retroTitleProblems(p, g), [], g.key);
  const topic = retroTopic(p, p.games[0]!);
  assert.deepEqual(
    topic.retro?.source_sections?.[
      "https://www.eurogamer.net/r-gtasanandreas-ps2"
    ],
    ["reception", "innovations"],
  );
  assert.ok(JSON.parse(fs.readFileSync(DEFAULT_RETRO_FILE, "utf8")));
});

test("press goes only to the sections it belongs to; a story chapter reads its own act", () => {
  const press = [
    { url: "https://a/review", text: "[Eurogamer] review" },
    { url: "https://a/all", text: "[Rockstar] about" },
  ];
  const sections = { "https://a/review": ["reception" as const] };
  assert.deepEqual(
    sourcesForSection(press, "reception", sections).map((x) => x.url),
    ["https://a/review", "https://a/all"],
  );
  assert.deepEqual(
    sourcesForSection(press, "story", sections).map((x) => x.url),
    ["https://a/all"],
  );
  const index = movie();
  const acts = storyActs(index, 3);
  const retro = {
    ...retroTopic(plan(), plan().games[0]!).retro!,
    chapters: [
      { section: "history" as const },
      { section: "story" as const, act: 2 },
    ],
    acts,
    source_sections: sections,
  };
  const story = retroChapterSource(
    retro,
    1,
    { title: "GTA SA", url: "u", text: "Plot." },
    press,
    index,
  );
  assert.match(story.text, /Transcript of act 2/);
  assert.match(story.text, /San Fierro line/);
  assert.doesNotMatch(story.text, /Grove Street line/);
  assert.doesNotMatch(story.text, /Eurogamer/);
  const first = retroChapterSource(
    retro,
    0,
    { title: "GTA SA", url: "u", text: "History." },
    press,
    index,
  );
  assert.doesNotMatch(first.text, /Transcript/);
  assert.deepEqual(retroChapterSpans(retro, [0, 1]), [
    undefined,
    { from: acts[1]!.from, to: acts[1]!.to },
  ]);
});

test("a sandbox picks its chapters by number or by section", () => {
  const info = [
    { section: "history" as const },
    { section: "making" as const },
    { section: "story" as const, act: 1 },
    { section: "story" as const, act: 2 },
  ];
  assert.deepEqual(retroSandboxChapters("1,story:1", info), [0, 2]);
  assert.deepEqual(retroSandboxChapters("story:2,2", info), [1, 3]);
  assert.equal(retroSandboxChapters("", info), undefined);
  assert.deepEqual(retroSandboxChapters("9,story:5", info), []);
});

test("a story line's footage is found inside its act, in story order", () => {
  const index = movie();
  index.shots[700]!.who = ["Big Smoke"];
  index.shots[700]!.desc = "Big Smoke orders at the drive-through";
  index.shots[1500]!.who = ["Big Smoke"];
  index.shots[1500]!.desc = "Big Smoke orders at the drive-through";
  const act2 = { from: 3600, to: 7200 };
  const hits = findShots(
    index,
    { text: "Big Smoke orders at the drive-through" },
    { within: act2 },
  );
  assert.ok(hits.length && hits.every((h) => h.start >= 3600 && h.end <= 7200));
  assert.equal(hits[0]!.shot, 700);
  assert.ok(!hits.some((h) => h.shot === 1500));
  const at = shotAtPlace(index, { ...act2, at: 0.25 }, 1);
  assert.ok(at !== undefined && Math.abs(index.shots[at]!.start - 4500) <= 6);
  const planned = planIndexedClips(
    index,
    [
      {
        key: "beat:3#m0",
        text: "Big Smoke orders at the drive-through",
        want: "gameplay",
        energy: "medium",
        keywords: [],
        within: act2,
      },
      {
        key: "beat:3#m1",
        text: "Something the index has never heard of",
        want: "gameplay",
        energy: "medium",
        keywords: [],
        within: { ...act2, at: 0.9 },
      },
    ],
    { maxClips: 4, maxSeconds: 60, minConfidence: 0.3 },
  );
  assert.equal(planned.length, 2);
  assert.ok(planned.every((c) => c.from >= 3600 && c.from < 7200));
  assert.equal(planned[0]!.shot, 700);
  assert.ok(planned[1]!.from > 3600 + 0.85 * 3600);
});

test("speakers named from the dialogue: only sure answers on the cast list, never over a shown name", () => {
  const index = movie();
  index.lines[1]!.speaker = "Sweet";
  index.lines[2]!.speaker = "Ryder";
  index.lines[2]!.speakerGuessed = true;
  assert.ok(!needsSpeaker(index.lines[1]!));
  assert.ok(needsSpeaker(index.lines[2]!));
  const { index: next, named } = applySpeakers(index, [
    { id: 0, speaker: "carl johnson", sure: true },
    { id: 1, speaker: "Big Smoke", sure: true },
    { id: 2, speaker: "Big Smoke", sure: true },
    { id: 3, speaker: "Ryder", sure: false },
    { id: 4, speaker: "A Stranger", sure: true },
  ]);
  assert.equal(named, 2);
  assert.equal(next.lines[0]!.speaker, "Carl Johnson");
  assert.equal(next.lines[0]!.speakerFrom, "context");
  assert.equal(next.lines[1]!.speaker, "Sweet");
  assert.equal(next.lines[2]!.speaker, "Big Smoke");
  assert.equal(next.lines[2]!.speakerGuessed, undefined);
  assert.equal(next.lines[3]!.speaker, undefined);
  assert.equal(next.lines[4]!.speaker, undefined);
  // The mark survives a save and a load, and a sure line can now be quoted (a guessed one still cannot).
  const again = parseSceneIndex(JSON.parse(JSON.stringify(next)))!;
  assert.equal(again.lines[0]!.speakerFrom, "context");
  const line = {
    ...again.lines[0]!,
    text: "Grove Street, home. At least it was.",
    words: ["Grove", "Street,", "home.", "At", "least", "it", "was."].map(
      (text, k) => ({ text, start: 1 + k * 0.3, end: 1.25 + k * 0.3 }),
    ),
  };
  assert.equal(unquotable(again, line), undefined);
  assert.equal(
    unquotable(again, {
      ...line,
      speakerFrom: undefined,
      speakerGuessed: true,
    }),
    "speaker guessed from the picture",
  );
  const chunks = speakerChunks(index, 0, 3600, 100);
  assert.equal(chunks.length, 4);
  assert.equal(chunks[1]!.context.length, 12);
});

test("each retrospective chapter keeps its own footage allowance, not one for the whole video", () => {
  const clip = (beatIndex: number, seconds: number, own = false) => ({
    provenance: own
      ? "Pulse's own gameplay capture"
      : 'Cutscenes for "Grand Theft Auto: San Andreas", publisher: Rockstar Games',
    durationSeconds: seconds,
    beatIndex,
    span: { source: "s", from: 0, to: seconds },
  });
  assert.equal(
    chapterFootageUsed([clip(0, 10), clip(0, 5, true), clip(1, 7)], 0),
    10,
  );
  const clips = [clip(0, 30), clip(0, 30), clip(1, 30), clip(1, 30)];
  const jobs = [
    {
      gameTitle: "Grand Theft Auto: San Andreas",
      beatIndex: 0,
      ownSeconds: 50,
    },
    {
      gameTitle: "Grand Theft Auto: San Andreas",
      beatIndex: 1,
      ownSeconds: 50,
    },
  ];
  const kept = reconcileCutsceneBudgets(clips, jobs, 1000);
  const by = (b: number) =>
    kept
      .filter((c) => c.beatIndex === b)
      .reduce((n, c) => n + c.durationSeconds, 0);
  assert.equal(by(0), 50);
  assert.equal(by(1), 50);
  // Without its own allowance the publisher's one cap covers the whole video, as before.
  const old = reconcileCutsceneBudgets(
    clips,
    jobs.map(({ ownSeconds: _o, ...j }) => j),
    1000,
  );
  assert.ok(old.reduce((n, c) => n + c.durationSeconds, 0) <= 40);
});

test("an outline that talks about its own material is sent back, title or description", () => {
  const budget = { ...retroChapterBudget(40), history: 1, making: 1, innovations: 1, story: 3, moments: 1, reception: 1, legacy: 1 };
  const o = outline();
  o.chapters[5]!.chapter_title = "The Ending Still Needs Its Scenes Missing";
  o.youtube.description = "This source-limited plan remains incomplete: acts 1-3 are supplied only as excerpts.";
  const problems = validateRetroOutline(o, budget, 3).join(" ");
  assert.match(problems, /talks about the material/);
  assert.match(problems, /Not for the viewer/);
});

test("footage spans: a story chapter its act, chapters before the story the first act, after it the whole movie", async () => {
  const { retroFootageSpans } = await import("../src/retrostep.ts");
  const acts = storyActs(movie(), 3);
  const retro = {
    ...retroTopic(plan(), plan().games[0]!).retro!,
    acts,
    chapters: [{ section: "history" as const }, { section: "story" as const, act: 2 }, { section: "reception" as const }],
  };
  // The chapters about the game rather than its story take B-roll (brollShotAtPlace); the story chapter its own act.
  assert.deepEqual(retroFootageSpans(retro, [0, 1, 2]), [
    { from: acts[0]!.from, to: acts[0]!.to, broll: true },
    { from: acts[1]!.from, to: acts[1]!.to },
    { from: 0, to: 3 * 3600, broll: true },
  ]);
  assert.deepEqual(retroFootageSpans({ ...retro, acts: [] }, [0]), [undefined]);
});
