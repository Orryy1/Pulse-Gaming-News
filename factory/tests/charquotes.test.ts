// Character quotes (CHARACTER_QUOTES): choosing a line from the scene index, the writer's setup and reaction,
// the silence in the voice, the clip's framing and the caps. No network, no model, no ffmpeg.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { goodScript, testConfig, testDb, tmpDir } from "./helpers.ts";
import {
  emptySceneIndex,
  saveSceneIndex,
  type DialogueLine,
  type SceneIndex,
} from "../src/sceneindex/schema.ts";
import {
  quietCut,
  quoteCandidates,
  quoteSpan,
  unquotable,
  verifyQuote,
  type QuoteCandidate,
} from "../src/sceneindex/quotepick.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import {
  applyQuoteMoment,
  quoteMomentBrief,
  quoteMomentProblems,
  withoutQuote,
  writeQuoteMoment,
  type QuoteMoment,
} from "../src/editorial/charquote.ts";
import { planQuoteGaps, quoteBoundary } from "../src/voice/quotegap.ts";
import {
  busiestWindow,
  envelopeDb,
  quoteCrop,
  subtitleTop,
  BLEED_MIN_HEIGHT,
} from "../src/assets/quoteclip.ts";
import {
  fitClipsAroundQuotes,
  quoteCredit,
  quoteRenderFiles,
  quoteScriptStep,
} from "../src/charquotestep.ts";
import { inQuote } from "../src/render/components/QuoteMoment.tsx";
import { loadConfig } from "../src/config.ts";
import type { Script } from "../src/editorial/schema.ts";

const GAME = "The Legend of Zelda: Ocarina of Time";

function timed(text: string, start: number, per = 0.3): DialogueLine["words"] {
  return text.split(/\s+/).map((w, i) => ({
    text: w,
    start: start + i * per,
    end: start + i * per + per * 0.8,
  }));
}

function line(
  id: number,
  start: number,
  text: string,
  speaker?: string,
  o: Partial<DialogueLine> = {},
): DialogueLine {
  const words = timed(text, start);
  return {
    id,
    start,
    end: words!.at(-1)!.end,
    text,
    ...(speaker ? { speaker } : {}),
    via: "both",
    shot: 0,
    words,
    ...o,
  };
}

function ocarina(): SceneIndex {
  const index = emptySceneIndex(
    GAME,
    {
      videoId: "L45cq1H2d1s",
      title: "OCARINA OF TIME REMAKE All Cutscenes",
      uploader: "Uploader",
      duration: 10000,
      kind: "movie",
      pickedAt: "",
    },
    new Date("2026-11-12T00:00:00Z"),
  );
  index.cast = [
    "Link",
    "Navi",
    "Saria",
    "Epona",
    "Malon",
    "Great Deku Tree",
    "Ganondorf",
  ];
  index.places = ["Kokiri Forest", "Lon Lon Ranch", "Hyrule"];
  index.coverage = [{ from: 0, to: 10000 }];
  index.shots = [
    {
      id: 0,
      start: 0,
      end: 10000,
      keyframes: [],
      desc: "",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "",
      luma: 90,
      motion: 4,
    },
  ];
  index.lines = [
    line(0, 10, "Long ago, there was a land called Hyrule.", "Narrator"),
    line(1, 100, "So, come on. Let's go together!", "Navi"),
    line(2, 110, "Hey! Listen to me, Link, wake up!", "Navi", {
      via: "textbox",
      words: undefined,
    }),
    line(3, 120, "I knew you would come to the ranch for Epona.", "Malon"),
    line(4, 130, "Guess who says this.", "Saria", { speakerGuessed: true }),
    line(
      5,
      140,
      "You must face the trials ahead with courage, child.",
      "Great Deku Tree",
    ),
    line(6, 150, "The blood of the kingdom will flow.", "Ganondorf"),
    line(
      7,
      9000,
      "Epona will carry you to the very end of this ranch.",
      "Malon",
    ),
    line(8, 160, "Hello", "Saria"),
    line(9, 170, "These words are nothing like what was heard here.", "Saria", {
      words: timed(
        "completely different speech entirely unrelated mumble",
        170,
      ),
    }),
  ];
  return index;
}

test("a quote must be heard, timed, named by the game, short, safe and agree with what was heard", () => {
  const index = ocarina();
  const why = (i: number) => unquotable(index, index.lines[i]!);
  assert.equal(why(0), "the game's own narrator");
  assert.equal(why(1), undefined);
  assert.match(why(2)!, /read off the screen/);
  assert.equal(why(3), undefined);
  assert.match(why(4)!, /guessed/);
  assert.match(why(6)!, /advertiser/);
  assert.match(why(8)!, /words|sentence/);
  assert.match(why(9)!, /heard words/);
});

test("candidates fit the story first, never the game's own name, and late lines stay out during the spoiler window", () => {
  const index = ocarina();
  const story =
    "The Ocarina of Time remake keeps Epona at Lon Lon Ranch, and you can still ride her.";
  const all = quoteCandidates(index, story, { general: 0 });
  assert.equal(all[0]!.speaker, "Malon");
  assert.ok(all.every((c) => c.fit === "story"));
  assert.ok(all[0]!.matched.includes("epona"));
  // "Ocarina" and "Time" are the game's name: they never make a fit on their own.
  assert.equal(
    quoteCandidates(index, "Ocarina of Time", { general: 0 }).length,
    0,
  );
  const w = spoilerWindow(GAME, "2026-11-05", { days: 28, openingShare: 0.1 })!;
  const guarded = quoteCandidates(index, story, {
    window: w,
    now: new Date("2026-11-12T12:00:00Z"),
  });
  assert.ok(
    !guarded.some((c) => c.start > 1000),
    "the line at 9000 s is past the opening 10%",
  );
  assert.ok(guarded.some((c) => c.id === "q1200"));
  // Too few fits: the list is filled with general lines, marked as such, and the IDs are stable.
  const filled = quoteCandidates(index, "Something about a price rise.", {
    max: 4,
  });
  assert.ok(filled.length >= 2 && filled.every((c) => c.fit === "general"));
  assert.ok(filled.every((c) => /^q\d+$/.test(c.id)));
});

test("a used quote is checked word for word against the index", () => {
  const index = ocarina();
  const [c] = quoteCandidates(index, "Navi says let's go together", {
    general: 0,
  }).filter((x) => x.speaker === "Navi");
  assert.ok(c);
  assert.equal(verifyQuote(index, c).ok, true);
  assert.equal(
    verifyQuote(index, { ...c, text: "So come on, let's go!" }).ok,
    false,
  );
  assert.equal(verifyQuote(index, { ...c, speaker: "Saria" }).ok, false);
  assert.equal(verifyQuote(index, { ...c, videoId: "xxxxxxxxxxx" }).ok, false);
  assert.equal(verifyQuote(index, { ...c, id: "q1" }).ok, false);
});

test("the played stretch pads the words but never reaches a neighbouring line", () => {
  const index = ocarina();
  index.lines.push(line(10, 102.2, "Right behind you, Navi.", "Saria"));
  index.lines.sort((a, b) => a.start - b.start).forEach((l, i) => (l.id = i));
  const navi = index.lines.find((l) => l.text.startsWith("So, come on"))!;
  const span = quoteSpan(index, navi);
  assert.ok(span.from < span.wordsFrom && span.from >= 99.6);
  assert.ok(span.to > span.wordsTo);
  assert.ok(span.to <= 102.2 - 0.1, "stops short of Saria's line");
});

test("a cut moves to the quietest moment in its window", () => {
  const env = [-20, -22, -40, -21, -20, -45, -19];
  assert.equal(quietCut(env, 0.1, 0, 0.35, 0.3), 0.25);
  assert.equal(quietCut(env, 0.1, 0.4, 0.7, 0.4), 0.55);
  assert.equal(quietCut([], 0.1, 0, 1, 0.5), 0.5);
  const samples = new Float32Array(1600).fill(0.5);
  samples.fill(0, 800);
  const db = envelopeDb(samples, 16000, 0.01);
  assert.equal(db.length, 10);
  assert.ok(db[0]! > -10 && db[9]! < -100);
});

function quoteScript(): Script {
  return goodScript({
    game_title: GAME,
    headline: "Ocarina Remake Cut Fast Travel",
    hook: "The Ocarina of Time remake cut fast travel.",
    beats: [
      {
        narration:
          "Producer Eiji Aonuma had the team pull all 12 warp points out.",
        visual: { kind: "title", primary: "12 warps", secondary: "" },
      },
      {
        narration:
          "You won't be stuck rolling, though. There's a sprint button, and Epona still waits at Lon Lon Ranch.",
        visual: { kind: "title", primary: "Sprint", secondary: "" },
      },
    ],
  });
}
const navi = (): QuoteCandidate =>
  quoteCandidates(ocarina(), "go together").find((c) => c.speaker === "Navi")!;
const moment = (o: Partial<QuoteMoment> = {}): QuoteMoment => ({
  use: true,
  quote_id: navi().id,
  beat: 1,
  before_quote:
    "You won't be stuck rolling, though. And your fairy has strong views on rolling alone:",
  after_quote:
    "Together, sure, but there's a sprint button now. Epona still waits at Lon Lon Ranch, too.",
  answers: "together",
  why: "Navi urges you on",
  ...o,
});

test("a clean quote moment passes and is written into its beat", () => {
  const script = quoteScript();
  assert.deepEqual(
    quoteMomentProblems(script, moment(), [navi()], { wordsMax: 150 }),
    [],
  );
  const next = applyQuoteMoment(script, moment(), navi());
  assert.match(
    next.beats[1]!.narration,
    /strong views on rolling alone: Together, sure, but there's a sprint button now\./,
  );
  assert.equal(
    next.character_quotes?.[0]?.text,
    "So, come on. Let's go together!",
  );
  assert.equal(
    next.character_quotes?.[0]?.original,
    script.beats[1]!.narration,
  );
  // Taken out again, the beat is as it was.
  const back = withoutQuote(next, navi().id);
  assert.equal(back.beats[1]!.narration, script.beats[1]!.narration);
  assert.equal(back.character_quotes, undefined);
});

test("a quote moment goes back when it repeats the line, drops a fact, adds one or runs long", () => {
  const script = quoteScript();
  const c = [navi()];
  const p = (o: Partial<QuoteMoment>, extra = {}) =>
    quoteMomentProblems(script, moment(o), c, { wordsMax: 150, ...extra });
  assert.match(
    p({
      before_quote:
        "You won't be stuck rolling. Navi says come on, let's go together.",
    }).join(" "),
    /repeats the quote/,
  );
  assert.match(
    p({ after_quote: "Together, sure, but there's a sprint button now." }).join(" "),
    /drops the name/,
  );
  assert.match(p({ before_quote: "Here's Navi" }).join(" "), /full stop/);
  assert.match(
    p({
      after_quote:
        "That's what the 2 sprint buttons are for. Epona still waits at Lon Lon Ranch.",
    }).join(" "),
    /adds the figure 2/,
  );
  assert.match(
    p({
      after_quote:
        "That's what Sony's sprint button is for. Epona still waits at Lon Lon Ranch.",
    }).join(" "),
    /adds the name Sony/,
  );
  assert.match(p({ quote_id: "q999" }).join(" "), /not one of the listed/);
  assert.match(p({ beat: 5 }).join(" "), /not one the quote may go in/);
  assert.match(p({}, { wordsMax: 40 }).join(" "), /the most is 40/);
  assert.deepEqual(quoteMomentProblems(script, moment({ use: false }), c), []);
  // The speaking character may be named although the beat never named them.
  assert.ok(!p({}).some((x) => /adds the name Navi/.test(x)));
});

test("the writer's brief lists the exact lines and the budget", () => {
  const brief = quoteMomentBrief(quoteScript(), [navi()], { wordsMax: 150 });
  assert.match(brief, /BEAT 1: You won't be stuck rolling/);
  assert.match(brief, /q1000: Navi, .* "So, come on\. Let's go together!"/);
  assert.match(brief, /at most 150 words/);
});

test("the writer gets one retry, and the script comes back unchanged when it declines or fails twice", async () => {
  const script = quoteScript();
  const answers: QuoteMoment[] = [
    moment({ before_quote: "Here's Navi" }),
    moment(),
  ];
  const calls: string[] = [];
  const llm = {
    structured: async (o: any) => (calls.push(o.site), answers.shift()!),
  } as any;
  const r = await writeQuoteMoment(llm, script, [navi()], {
    site: "quote.short",
    wordsMax: 150,
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls, ["quote.short", "quote.short"]);
  assert.equal(r.quote?.id, navi().id);
  const declined = await writeQuoteMoment(
    { structured: async () => moment({ use: false }) } as any,
    script,
    [navi()],
    { site: "quote.short" },
  );
  assert.equal(declined.script, script);
  const bad = await writeQuoteMoment(
    { structured: async () => moment({ quote_id: "q1" }) } as any,
    script,
    [navi()],
    { site: "quote.short" },
  );
  assert.equal(bad.script, script);
  assert.equal(bad.quote, undefined);
  const none = await writeQuoteMoment(
    { structured: async () => assert.fail("no call") } as any,
    script,
    [],
    { site: "quote.short" },
  );
  assert.equal(none.script, script);
});

test("the silence goes in after the setup's last word and every later word moves by the clip's length", () => {
  const script = applyQuoteMoment(quoteScript(), moment(), navi());
  const text = [
    script.hook,
    ...script.beats.map((b) => b.narration),
    script.pulse_take.narration,
    script.loop_line,
  ].join(" ");
  const words = text
    .split(/\s+/)
    .map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.3 }));
  const k = quoteBoundary(words, script, script.character_quotes![0]!);
  assert.equal(words[k]!.text, "alone:");
  assert.equal(words[k + 1]!.text, "Together,");
  const plan = planQuoteGaps(words, script, [{ id: navi().id, seconds: 2.5 }]);
  assert.equal(plan.missing.length, 0);
  assert.equal(plan.gaps.length, 1);
  assert.ok(
    plan.gaps[0]!.at > words[k]!.end && plan.gaps[0]!.at < words[k + 1]!.start,
  );
  assert.ok(Math.abs(plan.slots[0]!.end - plan.slots[0]!.start - 2.5) < 1e-9);
  // A voice that said something else: the quote's place is missing and it is reported, not guessed.
  const other = words.map((w) => ({ ...w, text: "word" }));
  assert.deepEqual(
    planQuoteGaps(other, script, [{ id: navi().id, seconds: 2.5 }]).missing,
    [navi().id],
  );
});

test("subtitles are found by the quote's own words in the lower half, and the crop stays above them", () => {
  const page = {
    width: 1920,
    height: 1080,
    words: [
      { text: "Navi", x: 600, y: 770, w: 80, h: 30 },
      { text: "come", x: 700, y: 860, w: 80, h: 40 },
      { text: "together!", x: 800, y: 860, w: 160, h: 40 },
      { text: "HYRULE", x: 100, y: 100, w: 300, h: 60 },
    ],
  };
  const top = subtitleTop([page], "So, come on. Let's go together!", "Navi")!;
  assert.ok(Math.abs(top - 770 / 1080) < 1e-9);
  assert.equal(
    subtitleTop([{ ...page, words: [page.words[3]!] }], "So, come on.", "Navi"),
    undefined,
  );
  // A 4K source fills the upright frame above the subtitles; a 1080p one is framed instead of blown up.
  const big = quoteCrop(3840, 2160, 0.68, { upright: true, left: 0.4 });
  assert.equal(big.mode, "bleed");
  assert.ok(big.crop.h <= 2160 * 0.68 && big.crop.h >= BLEED_MIN_HEIGHT);
  assert.equal(big.crop.y, 0);
  assert.ok(Math.abs(big.crop.w / big.crop.h - 9 / 16) < 0.01);
  assert.equal(quoteCrop(1920, 1080, 0.68, { upright: true }).mode, "framed");
  const long = quoteCrop(1920, 1080, 0.68, { upright: false });
  assert.ok(Math.abs(long.crop.w / long.crop.h - 16 / 9) < 0.02);
});

test("the upright crop leans to where the detail is", () => {
  const w = 40;
  const h = 10;
  const f = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 30; x < 38; x++) f[y * w + x] = x % 2 ? 255 : 0;
  const left = busiestWindow([f], w, h, h, 0.25);
  assert.ok(left > 0.5, `window at ${left}`);
  assert.equal(busiestWindow([], w, h, h, 0.25), 0);
});

test("a quote counts against its publisher's cap: Rockstar's other clips are trimmed to fit", () => {
  const clips = [
    {
      provenance: "Official trailer (publisher: Rockstar Games)",
      durationSeconds: 4,
      beatIndex: 0,
    },
    {
      provenance: "Official trailer (publisher: Rockstar Games)",
      durationSeconds: 4,
      beatIndex: 1,
    },
    { provenance: "Steam trailer", durationSeconds: 5, beatIndex: 2 },
  ];
  const kept = fitClipsAroundQuotes(
    clips,
    [{ game: "Grand Theft Auto VI", seconds: 3 }],
    20,
  );
  const rockstar = kept
    .filter((c) => c.provenance.includes("Rockstar"))
    .reduce((n, c) => n + c.durationSeconds, 0);
  assert.ok(rockstar + 3 <= 10);
  assert.ok(kept.some((c) => c.provenance === "Steam trailer"));
  assert.equal(fitClipsAroundQuotes(clips, [], 20), clips);
  assert.equal(
    quoteCredit("Grand Theft Auto VI (PS5)"),
    "Grand Theft Auto VI cutscenes, via YouTube",
  );
  assert.equal(quoteRenderFiles({}), undefined);
  assert.ok(
    inQuote([{ from: 30, frames: 60 }], 31) &&
      !inQuote([{ from: 30, frames: 60 }], 90),
  );
});

test("CHARACTER_QUOTES is off by default, and the step leaves a script alone when it is off", async () => {
  const saved = process.env.CHARACTER_QUOTES;
  delete process.env.CHARACTER_QUOTES;
  try {
    assert.equal(loadConfig().characterQuotes, false);
  } finally {
    if (saved !== undefined) process.env.CHARACTER_QUOTES = saved;
  }
  const dir = await tmpDir();
  const db = await testDb();
  const script = quoteScript();
  const off = await quoteScriptStep(
    {
      cfg: testConfig(dir),
      db,
      llm: { structured: async () => assert.fail("no call") } as any,
      now: () => new Date(),
    },
    { id: "ep1" },
    script,
  );
  assert.equal(off, script);
  await db.close();
});

test("the step places a checked quote from the game's index, and skips a stills-only publisher", async () => {
  const dir = await tmpDir();
  await saveSceneIndex(dir, ocarina());
  const db = await testDb();
  await db
    .query(
      `INSERT INTO episodes (id, story_hash, story_json, lane, status) VALUES ('ep1', 'h1', '{"headline":"x"}', 'news', 'selected')`,
    )
    .catch(() => undefined);
  const script = quoteScript();
  const llm = { structured: async () => moment() } as any;
  const s = {
    cfg: testConfig(dir, { characterQuotes: true }),
    db,
    llm,
    now: () => new Date("2026-11-12T12:00:00Z"),
  };
  // Nintendo's footage is stills only: no quote, no model call.
  const skipped = await quoteScriptStep(
    { ...s, llm: { structured: async () => assert.fail("no call") } as any },
    { id: "ep1" },
    script,
  );
  assert.equal(skipped, script);
  const placed = await quoteScriptStep(s, { id: "ep1" }, script, {
    footageCap: { key: "sandbox", seconds: 10 },
    wordsMax: 150,
  });
  assert.equal(
    placed.character_quotes?.[0]?.text,
    "So, come on. Let's go together!",
  );
  assert.equal(placed.character_quotes?.[0]?.speaker, "Navi");
  // A story with no room left in the Short's length gets none.
  const full = await quoteScriptStep(s, { id: "ep1" }, script, {
    footageCap: { key: "sandbox", seconds: 10 },
    capSeconds: 8,
  });
  assert.equal(full.character_quotes, undefined);
  await fs.rm(path.join(dir, "sceneindex"), { recursive: true, force: true });
  await db.close();
});

test("a long video's chapters are found by their chapter cards, each with its entry's game", async () => {
  const { quoteChapters } = await import("../src/charquotestep.ts");
  const beat = (n: string, chapter = false) => ({
    narration: n,
    visual: chapter ? { kind: "chapter" as const, primary: "C", secondary: "" } : { kind: "title" as const, primary: "t", secondary: "" },
  });
  const script = goodScript({
    game_title: "Zelda series",
    beats: [beat("a", true), beat("b"), beat("c", true), beat("d")],
    entries: [
      { rank: 1, game_title: "Majora's Mask", steam_search_term: "", year: 2000, platforms: "" },
      { rank: 2, game_title: GAME, steam_search_term: "", year: 1998, platforms: "" },
    ],
  } as Partial<Script>);
  assert.deepEqual(quoteChapters(script), [
    { game: GAME, beats: [0, 1] },
    { game: "Majora's Mask", beats: [2, 3] },
  ]);
  assert.deepEqual(quoteChapters(goodScript({ game_title: GAME })), [{ game: GAME, beats: [0, 1] }]);
});

test("a long video takes a few quotes, one a chapter, never in its first minute", async () => {
  const { quoteLongStep } = await import("../src/charquotestep.ts");
  const dir = await tmpDir();
  await saveSceneIndex(dir, ocarina());
  const db = await testDb();
  const long = "word ".repeat(170).trim() + ".";
  const script = goodScript({
    game_title: GAME,
    hook: "The Ocarina of Time remake changed how you get around.",
    beats: [
      { narration: long, visual: { kind: "chapter", primary: "One", secondary: "" } },
      { narration: "You won't be stuck rolling, though. There's a sprint button, and Epona still waits at Lon Lon Ranch.", visual: { kind: "title", primary: "", secondary: "" } },
      { narration: "In the remake, Malon keeps Epona at Lon Lon Ranch for you.", visual: { kind: "chapter", primary: "Two", secondary: "" } },
    ],
  } as Partial<Script>);
  const asked: number[][] = [];
  const llm = {
    structured: async (o: any) => {
      const beats = [...String(o.content).matchAll(/BEAT (\d+):/g)].map((m) => Number(m[1]));
      const open = [...String(o.content).matchAll(/BEAT (\d+): (?!.*not for the quote)/g)].map((m) => Number(m[1]));
      asked.push(open);
      const first = open[0]!;
      return first === 1
        ? moment({ beat: 1 })
        : {
            use: true,
            quote_id: quoteCandidates(ocarina(), "Epona ranch").find((c) => c.speaker === "Malon")!.id,
            beat: 2,
            before_quote: "In the remake, Malon keeps Epona at Lon Lon Ranch for you. And she always spots you at the ranch:",
            after_quote: "Knew it, sure, because she never leaves the ranch.",
            answers: "knew",
            why: "fits",
          };
    },
  } as any;
  const s = { cfg: testConfig(dir, { characterQuotes: true, characterQuotesLong: 2 }), db, llm, now: () => new Date("2026-11-12T12:00:00Z") };
  const out = await quoteLongStep(s, { id: "ep2" }, script, { footageCap: { key: "sandbox", seconds: 20 } });
  assert.equal(out.character_quotes?.length, 2);
  assert.ok(asked.every((open) => !open.includes(0)), "never the opening chapter's first minute");
  assert.deepEqual(new Set(out.character_quotes!.map((q) => q.beat)), new Set([1, 2]));
  // Off, or no quotes asked for: untouched.
  const off = await quoteLongStep({ ...s, cfg: testConfig(dir, { characterQuotes: true, characterQuotesLong: 0 }) }, { id: "ep2" }, script);
  assert.equal(off, script);
  await db.close();
});

test("the captions file carries the quote in the game's own words, named", async () => {
  const { quoteCaptionWords } = await import("../src/charquotestep.ts");
  const w = quoteCaptionWords("So, come on. Let's go together!", "Navi", 10, 12);
  assert.equal(w.length, 6);
  assert.equal(w[0]!.text, "NAVI: So,");
  assert.equal(w.at(-1)!.text, "together!");
  assert.ok(w[0]!.start === 10 && w.at(-1)!.end <= 12);
  assert.deepEqual(quoteCaptionWords("x", "Navi", 5, 5), []);
});

test("CHARACTER_QUOTES_SHORT=2: a second quote only from lines that fit the story, a beat away from the first", async () => {
  const saved = process.env.CHARACTER_QUOTES_SHORT;
  delete process.env.CHARACTER_QUOTES_SHORT;
  try {
    assert.equal(loadConfig().characterQuotesShort, 1);
  } finally {
    if (saved !== undefined) process.env.CHARACTER_QUOTES_SHORT = saved;
  }
  const dir = await tmpDir();
  await saveSceneIndex(dir, ocarina());
  const db = await testDb();
  const script = goodScript({
    ...quoteScript(),
    beats: [
      ...quoteScript().beats,
      { narration: "The map itself is the same size as before.", visual: { kind: "title", primary: "Map", secondary: "" } },
      { narration: "And Malon still keeps Epona at Lon Lon Ranch for you.", visual: { kind: "title", primary: "Epona", secondary: "" } },
    ],
  } as Partial<Script>);
  const asked: Array<{ open: number[]; fits: boolean }> = [];
  const malon = quoteCandidates(ocarina(), "Malon Epona ranch", { general: 0 }).find((c) => c.speaker === "Malon" && c.start < 1000)!;
  const llm = {
    structured: async (o: any) => {
      const content = String(o.content);
      const open = [...content.matchAll(/BEAT (\d+): (?!.*not for the quote)/g)].map((m) => Number(m[1]));
      asked.push({ open, fits: !content.includes(navi().id) || asked.length === 0 });
      return asked.length === 1
        ? moment()
        : {
            use: true,
            quote_id: malon.id,
            beat: 3,
            before_quote: "And Malon still keeps Epona at Lon Lon Ranch for you. She clearly expected you back at the ranch:",
            after_quote: "Knew it, sure, because she never leaves the ranch.",
            answers: "knew",
            why: "fits",
          };
    },
  } as any;
  const s = { cfg: testConfig(dir, { characterQuotes: true, characterQuotesShort: 2 }), db, llm, now: () => new Date("2026-11-12T12:00:00Z") };
  const two = await quoteScriptStep(s, { id: "ep1" }, script, { footageCap: { key: "sandbox", seconds: 20 }, wordsMax: 200 });
  assert.equal(two.character_quotes?.length, 2);
  assert.deepEqual(two.character_quotes!.map((q) => q.beat), [1, 3]);
  // The second call offered no beat next to the first quote, and only story lines.
  assert.ok(!asked[1]!.open.includes(0) && !asked[1]!.open.includes(2) && asked[1]!.open.includes(3));
  // The footage cap counts both: with room for one line only, the second is never asked for.
  asked.length = 0;
  const capped = await quoteScriptStep(s, { id: "ep1" }, script, { footageCap: { key: "sandbox", seconds: 3.5 }, wordsMax: 200 });
  assert.equal(capped.character_quotes?.length, 1);
  assert.equal(asked.length, 1);
  // The default keeps a Short to one.
  asked.length = 0;
  const one = await quoteScriptStep({ ...s, cfg: testConfig(dir, { characterQuotes: true }) }, { id: "ep1" }, script, { footageCap: { key: "sandbox", seconds: 20 }, wordsMax: 200 });
  assert.equal(one.character_quotes?.length, 1);
  assert.equal(asked.length, 1);
  await db.close();
});

test("a quote is an exchange: no bare introduction, and the reaction answers the line's own words", async () => {
  const { exchangeProblems, BARE_SETUPS } = await import("../src/editorial/charquote.ts");
  const nabooru = { text: "Run away! Get outta here! Go!", speaker: "Nabooru" };
  const zelda = { text: "Quickly, Link! Find us a way out-fast!", speaker: "Zelda" };
  const beat = "Producer Eiji Aonuma requested warps, then had the team remove them.";
  const names = ["Link", "Zelda", "Nabooru", "Epona", "Hyrule"];
  // The 12 Nov proof's lines: introductions and reactions that would fit any quote.
  const weak1 = exchangeProblems("Here's Nabooru.", "Warps won't help.", nabooru, { beat, names });
  assert.match(weak1.join(" "), /only introduces Nabooru/);
  assert.match(weak1.join(" "), /does not answer the line/);
  const weak2 = exchangeProblems("Zelda has a request.", "You can stop rolling, there's a sprint button.", zelda, { beat: "You can stop rolling.", names });
  assert.match(weak2.join(" "), /only introduces Zelda/);
  assert.match(weak2.join(" "), /does not answer the line/);
  for (const bare of ["Here's how Navi puts it.", "And here is Navi.", "Listen to Navi.", "Meet Saria.", "Navi has something to say.", "Navi's got a quick message:", "Take it away, Navi."])
    assert.ok(BARE_SETUPS.some((r) => r.test(bare)), bare);
  // A setup that leads into the line and a reaction that talks back at it pass.
  assert.deepEqual(
    exchangeProblems("And the remake really doesn't want you to warp out:", "Run away? Fine, but on foot, apparently.", nabooru, { beat, names }),
    [],
  );
  assert.deepEqual(
    exchangeProblems("Even Zelda wants a faster way out of here:", "Quickly is doing a lot of work in a game with no warps.", zelda, { beat, names, answers: "Quickly" }),
    [],
  );
  // The player's own name in the line is no exchange on its own; answers must come from the line.
  assert.match(exchangeProblems("Even Zelda wants a faster way out of here:", "Link would agree, I think.", zelda, { beat, names }).join(" "), /does not answer/);
  assert.match(exchangeProblems("Even Zelda wants a faster way out of here:", "Quickly, sure.", zelda, { beat, names, answers: "hurry up" }).join(" "), /copied from the line/);
  // A setup tied to nothing is sent back too; a question in the line may be answered with a plain no.
  assert.match(exchangeProblems("Something is coming.", "Run, sure.", nabooru, { beat, names }).join(" "), /tied to neither/);
  assert.deepEqual(
    exchangeProblems("So, would you give up the warps for this?", "No, and I'd keep the sprint button.", { text: "Will you help us, Link?", speaker: "Zelda" }, { beat, names }),
    [],
  );
  // The writer is told all of it, and that declining is a good answer.
  const { QUOTE_MOMENT_RULES } = await import("../src/editorial/charquote.ts");
  assert.match(QUOTE_MOMENT_RULES, /exchange/);
  assert.match(QUOTE_MOMENT_RULES, /Here's Navi\./);
  assert.match(QUOTE_MOMENT_RULES, /set use to false/);
});

test("inside a spoiler window a line past the opening share is never offered or placed, and none is placed before the windows load", async () => {
  const dir = await tmpDir();
  await saveSceneIndex(dir, ocarina());
  const db = await testDb();
  const now = new Date("2026-11-12T12:00:00Z");
  // Malon's line at 9000 s of a 10,000 s story is at 90%; the window's opening is the first 10%.
  const late = quoteCandidates(ocarina(), "Malon Epona ranch carry end", { general: 0 }).find((c) => c.start > 1000)!;
  assert.ok(late, "the late line is quotable when no window is open");
  const window = spoilerWindow(GAME, "2026-11-05", { days: 28, openingShare: 0.1 })!;
  const briefs: string[] = [];
  const forcing = {
    structured: async (o: any) => {
      briefs.push(String(o.content));
      return {
        use: true,
        quote_id: late.id,
        beat: 1,
        before_quote: "You won't be stuck rolling, though. And Malon has plans for your horse at the ranch:",
        after_quote: "Carry me, sure, but there's a sprint button. Epona still waits at Lon Lon Ranch.",
        answers: "carry",
        why: "forced",
      };
    },
  } as any;
  const s = { cfg: testConfig(dir, { characterQuotes: true, spoilerGuard: true }), db, llm: forcing, now: () => now };
  const o = { footageCap: { key: "sandbox", seconds: 20 }, wordsMax: 200, story: "Malon keeps Epona at the ranch to carry you to the end" };
  const script = quoteScript();
  const guarded = await quoteScriptStep(s, { id: "ep1" }, script, { ...o, windows: [window] });
  assert.equal(guarded.character_quotes, undefined, "the late line is never placed");
  assert.ok(briefs.length > 0 && briefs.every((b) => !b.includes(`- ${late.id}:`)), "nor offered to the writer");
  assert.ok(briefs.every((b) => [...b.matchAll(/^- q(\d+):/gm)].every((m) => Number(m[1]) / 10 <= 1000)));
  // Fail closed: with the guard on and no windows loaded yet, no quote and no model call.
  briefs.length = 0;
  const unloaded = await quoteScriptStep(s, { id: "ep1" }, script, { ...o, windows: [] });
  assert.equal(unloaded, script);
  assert.equal(briefs.length, 0);
  // A game outside every window (the windows are loaded, none is this game's): the whole story may be quoted.
  const other = spoilerWindow("Grand Theft Auto VI", "2026-11-18", { days: 28, openingShare: 0.1 })!;
  const free = await quoteScriptStep(s, { id: "ep1" }, script, { ...o, windows: [other] });
  assert.equal(free.character_quotes?.[0]?.id, late.id);
  await fs.rm(path.join(dir, "sceneindex"), { recursive: true, force: true });
  await db.close();
});
