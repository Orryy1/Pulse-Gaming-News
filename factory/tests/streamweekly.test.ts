import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  streamWeeklySettings,
  streamWeeklySummary,
} from "../src/streamweekly/settings.ts";
import {
  bleepsIn,
  chatBursts,
  energyCurve,
  findWeekMoments,
  isMenuShot,
  kindOf,
  mergeMoments,
  peaks,
  rankWeek,
  realSpeech,
  snapWindow,
  type WeekMoment,
  type WeekStream,
} from "../src/streamweekly/moments.ts";
import {
  chapterTitle,
  planProblems,
  planWeek,
  shortGameName,
  weekDates,
  weekNumber,
} from "../src/streamweekly/chapters.ts";
import {
  fixedScript,
  fromWriter,
  playOrder,
  scriptProblems,
  weekTitle,
  writeWeek,
} from "../src/streamweekly/script.ts";
import {
  auditTimeline,
  buildTimeline,
  fixLabels,
  labelTag,
  weekPackage,
  type Voice,
} from "../src/streamweekly/timeline.ts";
import { clipVolume } from "../src/render/StreamWeekly.tsx";
import { cutArgs, cutName, weekProps } from "../src/streamweekly/render.ts";
import { nextWeekSlot, weekDue } from "../src/streamweekly/job.ts";
import { compileWeek, spoilerRule } from "../src/streamweekly/build.ts";
import {
  GAME_EVENT,
  HALLUCINATION,
  MENU_TEXT,
  SWEAR,
} from "../src/streamweekly/patterns.ts";
import { finishChapters } from "../src/youtube/chapters.ts";
import type { VodIndex } from "../src/vodindex/schema.ts";
import type { Llm } from "../src/editorial/llm.ts";

// ---------------------------------------------------------------- fixtures

function shot(start: number, end: number, extra: Record<string, unknown> = {}) {
  return {
    id: 0,
    start,
    end,
    keyframes: [],
    desc: "",
    who: [],
    where: "",
    mood: "",
    tags: [],
    text: "",
    luma: 90,
    motion: 20,
    ...extra,
  };
}

function vod(
  id: string,
  date: string,
  o: {
    duration?: number;
    lines?: Array<[number, number, string]>;
    shots?: ReturnType<typeof shot>[];
  } = {},
): VodIndex {
  const duration = o.duration ?? 1200;
  const shots =
    o.shots ??
    Array.from({ length: duration / 10 }, (_, i) => shot(i * 10, i * 10 + 10));
  return {
    version: 1,
    vodId: id,
    file: `/vods/${date} GTA 6 [${id}].mp4`,
    title: "GTA 6",
    game: "Grand Theft Auto VI",
    recordedOn: date,
    duration,
    builtAt: "",
    coverage: [{ from: 0, to: duration }],
    shots: shots.map((s, i) => ({ ...s, id: i })),
    lines: (o.lines ?? []).map(([start, end, text], i) => ({
      id: i,
      start,
      end,
      text,
      via: "voice" as const,
      shot: 0,
    })),
  };
}

/** A quiet stream with loud bursts at the given seconds. */
function seconds(duration: number, loudAt: number[] = []) {
  return Array.from({ length: duration }, (_, t) => {
    const hot = loudAt.some((a) => t >= a && t < a + 4);
    return {
      t,
      loud: hot ? -8 : -30 + Math.sin(t / 7),
      motion: hot ? 0.6 : 0.02,
    };
  });
}

function stream(
  id: string,
  date: string,
  loudAt: number[],
  lines: Array<[number, number, string]> = [],
  extra: Partial<WeekStream> = {},
): WeekStream {
  const index = vod(id, date, { lines });
  return { index, seconds: seconds(index.duration, loudAt), ...extra };
}

function moment(over: Partial<WeekMoment> = {}): WeekMoment {
  return {
    vodId: "v1",
    file: "/vods/a.mp4",
    recordedOn: "2026-11-19",
    start: 100,
    end: 130,
    peak: 118,
    kind: "action",
    score: 2,
    parts: {},
    why: [],
    transcript: "",
    quote: "",
    language: false,
    bleeps: [],
    ...over,
  };
}

const opts = {
  game: "Grand Theft Auto VI",
  week: 1,
  start: "2026-11-19",
  minSeconds: 300,
  maxSeconds: 480,
};

// ---------------------------------------------------------------- settings

test("settings: off by default, with a Sunday slot and sane bounds", () => {
  const s = streamWeeklySettings({});
  assert.equal(s.enabled, false);
  assert.equal(s.day, "sun");
  assert.equal(s.slot, "18:00");
  assert.equal(s.start, "2026-11-19");
  assert.equal(s.minMinutes, 15);
  assert.equal(s.maxMinutes, 25);
  assert.equal(s.upload, false);
  assert.equal(streamWeeklySummary(s), "off");
});

test("settings: read from the environment, bad values fall back", () => {
  const s = streamWeeklySettings({
    STREAM_WEEKLY: "true",
    STREAM_WEEKLY_DAY: "Saturday",
    STREAM_WEEKLY_SLOT: "7pm",
    STREAM_WEEKLY_MIN_MINUTES: "20",
    STREAM_WEEKLY_MAX_MINUTES: "10",
    STREAM_WEEKLY_UPLOAD: "1",
  });
  assert.equal(s.enabled, true);
  assert.equal(s.day, "sat");
  assert.equal(s.slot, "18:00");
  assert.equal(s.minMinutes, 20);
  assert.ok(s.maxMinutes > s.minMinutes);
  assert.match(streamWeeklySummary(s), /uploaded private/);
});

// ---------------------------------------------------------------- patterns

test("patterns: Whisper's inventions, game events, menus, strong language", () => {
  for (const t of [
    "you",
    "You you You",
    "Thanks for watching!",
    "!",
    "[Music]",
  ])
    assert.ok(HALLUCINATION.test(t), t);
  for (const t of ["You did it", "Thanks for the tip"])
    assert.ok(!HALLUCINATION.test(t), t);
  assert.ok(GAME_EVENT.test("under the bridge 20/50 Bridges flown under"));
  assert.ok(GAME_EVENT.test("WASTED"));
  assert.ok(MENU_TEXT.test("MAP BRIEF STATS SETTINGS GAME"));
  assert.ok(MENU_TEXT.test("Save Game"));
  assert.ok(SWEAR.test("Oh, shit!"));
  assert.ok(!SWEAR.test("shiitake"));
});

// ---------------------------------------------------------------- moments

test("energy: a burst over a quiet stream peaks near its own top, held to the stream's own bar", () => {
  const c = energyCurve(seconds(600, [300]));
  const top = c.indexOf(Math.max(...c));
  assert.ok(top >= 298 && top <= 306, `peak at ${top}`);
  assert.ok(Math.max(...c) <= 3);
  assert.deepEqual(
    peaks(c, 45, 3)
      .slice(0, 1)
      .map((p) => Math.abs(p - top) < 5),
    [true],
  );
});

test("peaks: spaced apart and strongest first", () => {
  const curve = Array(200).fill(0);
  curve[50] = 2;
  curve[60] = 1.5;
  curve[150] = 1;
  assert.deepEqual(peaks(curve, 45, 5), [50, 150]);
});

test("snapWindow: keeps a line whole at the start and the end, holds the length to 15-50 s", () => {
  const lines = [
    { start: 75, end: 84 },
    { start: 110, end: 118 },
  ];
  const w = snapWindow(100, lines, [], 1000);
  assert.equal(w.start, 75);
  assert.equal(w.end, 118);
  const short = snapWindow(5, [], [], 1000, 2, 2);
  assert.ok(short.end - short.start >= 15);
  const long = snapWindow(500, [{ start: 470, end: 540 }], [], 1000, 30, 40);
  assert.ok(long.end - long.start <= 50);
  assert.ok(long.start <= 500 && long.end >= 500);
});

test("kindOf: an ask, a myth, a test, a find, a laugh, else action", () => {
  assert.equal(
    kindOf(
      "",
      {
        id: "a",
        question: "Is it true you can swim forever?",
        result: "proved",
        confidence: 0.9,
        at: 1,
        kind: "myth",
      },
      0,
      0,
    ),
    "myth",
  );
  assert.equal(
    kindOf(
      "",
      {
        id: "a",
        question: "Can you outswim five stars?",
        result: "disproved",
        confidence: 0.9,
        at: 1,
      },
      0,
      0,
    ),
    "test",
  );
  assert.equal(
    kindOf("apparently you can lose them in the water", undefined, 0, 0),
    "myth",
  );
  assert.equal(kindOf("let's see if this car floats", undefined, 0, 0), "test");
  assert.equal(
    kindOf("wait, there's a secret room here", undefined, 0, 0),
    "hidden",
  );
  assert.equal(kindOf("that was close", undefined, 2, 0), "funny");
  assert.equal(kindOf("", undefined, 0, 2), "action");
});

test("realSpeech: drops Whisper's inventions and looped phrases, keeps the owner", () => {
  const v = vod("v1", "2026-11-19", {
    lines: [
      [1, 2, "You"],
      [3, 4, "I'm going to use the same"],
      [5, 6, "I'm going to use the same"],
      [7, 8, "I'm going to use the same"],
      [9, 10, "Oh my god, no way"],
      [11, 12, "Thanks for watching!"],
    ],
  });
  assert.deepEqual(
    realSpeech(v).lines.map((l) => l.text),
    ["Oh my god, no way"],
  );
});

test("bleeps: strong language muted for its words, relative to the moment", () => {
  assert.deepEqual(
    bleepsIn(
      [
        { start: 105, end: 106, text: "oh shit" },
        { start: 108, end: 109, text: "nice" },
      ],
      100,
      130,
    ),
    [{ from: 4.9, to: 6.1 }],
  );
});

test("chatBursts: a busy ten seconds from several people, the lag taken off", () => {
  const chat = [
    ...Array.from({ length: 30 }, (_, i) => ({
      t: i * 10 + 1,
      user: "a",
      text: "hi",
    })),
    ...Array.from({ length: 8 }, (_, i) => ({
      t: 401 + i,
      user: `u${i}`,
      text: "LMAO",
    })),
  ];
  assert.deepEqual(chatBursts(chat), [394]);
  assert.deepEqual(chatBursts([]), []);
});

test("findWeekMoments: reactions, asks, clips and game events each find a moment, menus block one", () => {
  const w = stream(
    "v1",
    "2026-11-19",
    [300, 900],
    [
      [905, 908, "Oh my god, no way, let's go!"],
      [610, 614, "hahaha what was that"],
    ],
    {
      asks: [
        {
          id: "swim",
          question: "Can you outswim five stars?",
          result: "proved",
          confidence: 0.85,
          at: 300,
        },
      ],
      clips: [{ t: 610, title: "lol" }],
    },
  );
  w.index.shots[50] = { ...w.index.shots[50]!, text: "under the bridge 20/50" };
  w.index.shots[100] = { ...w.index.shots[100]!, text: "Save Game" };
  w.index.shots[101] = {
    ...w.index.shots[101]!,
    text: "MAP BRIEF STATS SETTINGS",
  };
  const ms = findWeekMoments(w);
  const near = (t: number) => ms.find((m) => m.start <= t && m.end >= t);
  assert.equal(near(300)?.kind, "test");
  assert.ok(near(300)!.why[0]!.includes("settles a stream ask"));
  assert.equal(near(610)?.kind, "funny");
  assert.ok(near(610)!.why.some((x) => x.includes("clipped")));
  assert.ok(near(905)!.score > 0);
  assert.ok(near(505)?.why.some((x) => x.includes("under the bridge")));
  const menu = ms.find((m) => m.start <= 1005 && m.end >= 1005);
  if (menu) assert.match(menu.blocked ?? "", /menus/);
  // No two moments of a stream overlap much.
  for (const a of ms)
    for (const b of ms)
      if (a !== b)
        assert.ok(
          Math.min(a.end, b.end) - Math.max(a.start, b.start) <=
            0.4 * Math.min(a.end - a.start, b.end - b.start) + 0.01,
        );
});

test("findWeekMoments: a story moment is held only while the spoiler window is open", () => {
  const w = stream(
    "v1",
    "2026-11-19",
    [300],
    [[300, 304, "oh no she dies at the end"]],
  );
  const check = (t: string) =>
    /dies/.test(t) ? "spoiler: a death" : undefined;
  assert.equal(
    findWeekMoments(w, { spoilerWindowOpen: true, storyCheck: check }).find(
      (m) => m.start <= 300 && m.end >= 300,
    )?.blocked,
    "spoiler: a death",
  );
  assert.equal(
    findWeekMoments(w, { spoilerWindowOpen: false, storyCheck: check }).find(
      (m) => m.start <= 300 && m.end >= 300,
    )?.blocked,
    undefined,
  );
});

test("isMenuShot and mergeMoments", () => {
  assert.ok(isMenuShot({ text: "Save Game", menu: false }));
  assert.ok(isMenuShot({ text: "", menu: true }));
  assert.ok(!isMenuShot({ text: "under the bridge" }));
  const merged = mergeMoments([
    moment({ score: 3, why: ["a"] }),
    moment({ start: 105, end: 135, score: 1, why: ["b"] }),
    moment({ start: 400, end: 430, score: 2 }),
  ]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0]!.why, ["a", "b"]);
});

test("rankWeek: usable moments first, best first, across streams", () => {
  const a = stream("v1", "2026-11-19", [200, 600]);
  const b = stream(
    "v2",
    "2026-11-20",
    [300],
    [[300, 303, "let's go, no way!"]],
  );
  const r = rankWeek([a, b]);
  assert.ok(r.length >= 3);
  for (let i = 1; i < r.length; i++)
    if (!r[i]!.blocked && !r[i - 1]!.blocked)
      assert.ok(r[i - 1]!.score >= r[i]!.score);
  assert.ok(new Set(r.map((m) => m.vodId)).size === 2);
});

// ---------------------------------------------------------------- chapters

test("names and weeks", () => {
  assert.equal(shortGameName("Grand Theft Auto VI"), "GTA 6");
  assert.equal(shortGameName("Grand Theft Auto V"), "GTA 5");
  assert.equal(shortGameName("GTA VI"), "GTA 6");
  assert.equal(shortGameName("Silent Hill f"), "Silent Hill f");
  assert.equal(
    chapterTitle("myth", "Grand Theft Auto VI"),
    "GTA 6 Myths Put to the Test",
  );
  assert.equal(weekNumber("2026-11-19", "2026-11-18"), 0);
  assert.equal(weekNumber("2026-11-19", "2026-11-19"), 1);
  assert.equal(weekNumber("2026-11-19", "2026-11-25"), 1);
  assert.equal(weekNumber("2026-11-19", "2026-11-26"), 2);
  assert.deepEqual(weekDates("2026-11-19", 2), {
    from: "2026-11-26",
    to: "2026-12-02",
  });
});

test("planWeek: chapters in the fixed order, a lone kind joins the finale, the length held", () => {
  const ranked = [
    moment({ start: 100, end: 130, kind: "test", score: 5 }),
    moment({
      start: 200,
      end: 230,
      kind: "test",
      score: 4,
      recordedOn: "2026-11-20",
      vodId: "v2",
    }),
    moment({ start: 300, end: 330, kind: "funny", score: 3.5 }),
    moment({
      start: 400,
      end: 430,
      kind: "funny",
      score: 3.4,
      vodId: "v2",
      recordedOn: "2026-11-20",
    }),
    moment({ start: 500, end: 530, kind: "hidden", score: 3.3 }),
    moment({
      start: 600,
      end: 630,
      kind: "action",
      score: 3.2,
      vodId: "v2",
      recordedOn: "2026-11-20",
    }),
    moment({
      start: 700,
      end: 730,
      kind: "action",
      score: 3.1,
      vodId: "v3",
      recordedOn: "2026-11-21",
    }),
    moment({
      start: 800,
      end: 830,
      kind: "action",
      score: 1,
      blocked: "spoiler",
    }),
  ];
  const p = planWeek(ranked, opts);
  assert.deepEqual(
    p.chapters.map((c) => c.kind),
    ["test", "funny", "action"],
  );
  assert.ok(
    p.chapters
      .find((c) => c.kind === "action")!
      .moments.some((m) => m.kind === "hidden"),
  );
  assert.ok(p.seconds <= opts.maxSeconds);
  assert.ok(p.left.some((l) => l.why === "spoiler"));
  assert.equal(p.teaser?.score, 5);
  // Days from the recording dates; a chapter runs in the order things happened.
  const tests = p.chapters[0]!.moments;
  assert.deepEqual(
    tests.map((m) => m.day),
    [1, 2],
  );
  // The finale ends on its strongest moment.
  const fin = p.chapters.at(-1)!.moments;
  assert.equal(fin.at(-1)!.score, Math.max(...fin.map((m) => m.score)));
});

test("planWeek: every stream is represented before one gives a third moment", () => {
  const ranked = [
    ...[1, 2, 3, 4].map((i) =>
      moment({
        start: i * 100,
        end: i * 100 + 30,
        score: 10 - i,
        vodId: "big",
      }),
    ),
    moment({
      start: 100,
      end: 130,
      score: 1,
      vodId: "small",
      recordedOn: "2026-11-21",
    }),
  ];
  const p = planWeek(ranked, { ...opts, minSeconds: 150, maxSeconds: 260 });
  const ids = p.chapters.flatMap((c) => c.moments.map((m) => m.vodId));
  assert.ok(ids.includes("small"));
});

test("planProblems: too few moments, too few chapters, too short", () => {
  const p = planWeek([moment()], opts);
  const why = planProblems(p, {
    minSeconds: 300,
    maxSeconds: 480,
    minMoments: 4,
  });
  assert.ok(why.some((w) => w.includes("usable moments")));
  assert.ok(why.some((w) => w.includes("chapters")));
  assert.ok(why.some((w) => w.includes("under")));
});

// ---------------------------------------------------------------- script

function fullPlan() {
  return planWeek(
    [
      moment({
        start: 100,
        end: 130,
        kind: "test",
        score: 5,
        ask: {
          id: "s",
          question: "Can you outswim five stars?",
          result: "proved",
          confidence: 0.9,
          at: 110,
        },
      }),
      moment({ start: 200, end: 230, kind: "test", score: 4 }),
      moment({
        start: 300,
        end: 330,
        kind: "funny",
        score: 3.5,
        bleeps: [{ from: 10, to: 11 }],
      }),
      moment({ start: 400, end: 430, kind: "funny", score: 3.4 }),
      moment({ start: 600, end: 630, kind: "action", score: 3.2 }),
    ],
    opts,
  );
}

test("weekTitle: the lead, the hook when it fits, never a dash", () => {
  assert.equal(
    weekTitle("Grand Theft Auto VI", 2, "We Tested Your Wildest Ideas"),
    "GTA 6 Week 2: We Tested Your Wildest Ideas",
  );
  assert.equal(
    weekTitle("Grand Theft Auto VI", 2, "x".repeat(80)),
    "GTA 6 Week 2: Best Moments, Tests and Discoveries",
  );
  assert.ok(!/[–—]/.test(weekTitle("Grand Theft Auto VI", 1, "Cops — Beaten")));
});

test("fixedScript passes every house check", () => {
  const p = fullPlan();
  const s = fixedScript(p);
  assert.deepEqual(scriptProblems(s, p), []);
  assert.equal(s.moments.length, playOrder(p).length);
  assert.match(s.moments[0]!.setup, /outswim five stars/);
});

test("scriptProblems: length, dashes, plugs, story, keys", () => {
  const p = fullPlan();
  const s = fixedScript(p);
  const bad = {
    ...s,
    intro: `${"word ".repeat(60)}`,
    moments: [
      {
        ...s.moments[0]!,
        setup: "Smash that like button — and the ending twist",
      },
      ...s.moments.slice(2),
    ],
  };
  const why = scriptProblems(bad, p).join("\n");
  assert.match(why, /intro runs/);
  assert.match(why, /dash/);
  assert.match(why, /asks the viewer/);
  assert.match(why, /story/);
  assert.match(why, /exactly/);
});

test("fromWriter adds the sign-off once", () => {
  const p = fullPlan();
  const r = fromWriter(p, {
    hook: "We Tried Everything",
    point: "p",
    intro: "i",
    moments: [],
    outro: "That's the week",
  });
  assert.match(r.outro, /^That's the week\. That's the Pulse\./);
  assert.equal(
    fromWriter(p, {
      hook: "",
      point: "",
      intro: "",
      moments: [],
      outro: r.outro,
    }).outro,
    r.outro,
  );
});

function fakeLlm(answers: unknown[]): Llm & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async structured(o) {
      calls.push(o.site ?? "");
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a as never;
    },
  };
}

test("writeWeek: a bad first draft is sent back with its problems, the clarity gate then passes it", async () => {
  const p = fullPlan();
  const keys = playOrder(p).map((x) => x.key);
  const good = {
    hook: "We Tested What You Asked",
    point: "A week of tests.",
    intro: "This is GTA 6 Week 1. We tested what you asked.",
    moments: keys.map((key) => ({
      key,
      setup: "Here's the next one to try.",
      label: "A test",
    })),
    outro: "That's Week 1.",
  };
  const bad = { ...good, intro: "Subscribe — now" };
  const llm = fakeLlm([
    bad,
    good,
    { point: "A week of tests.", point_matches: true, issues: [], score: 9 },
  ]);
  const s = await writeWeek(p, llm, { now: new Date("2026-11-22T12:00:00Z") });
  assert.equal(s.by, "writer");
  assert.equal(s.title, "GTA 6 Week 1: We Tested What You Asked");
  assert.deepEqual(llm.calls, [
    "streamweekly.write",
    "streamweekly.write",
    "clarity.judge",
  ]);
});

test("writeWeek: no writer, or a writer that fails twice, gives the fixed lines", async () => {
  const p = fullPlan();
  assert.equal((await writeWeek(p, undefined)).by, "fixed");
  assert.equal(
    (await writeWeek(p, fakeLlm([new Error("down"), new Error("down")]))).by,
    "fixed",
  );
});

// ---------------------------------------------------------------- timeline

function voicesFor(p: ReturnType<typeof fullPlan>) {
  const m = new Map<string, Voice>();
  for (const k of ["intro", ...playOrder(p).map((x) => x.key), "outro"])
    m.set(k, { key: k, file: `voice/${k}.mp3`, seconds: 4, text: k });
  return m;
}

test("buildTimeline: no narration over a moment, cards at chapter starts, valid YouTube chapters", () => {
  const p = fullPlan();
  const s = fixedScript(p);
  const tl = buildTimeline(p, s, voicesFor(p), { duration: () => 5000 });
  // Clips butt up end to end with no gap.
  const sorted = [...tl.clips].sort((a, b) => a.at - b.at);
  for (let i = 1; i < sorted.length; i++)
    assert.ok(
      Math.abs(sorted[i]!.at - (sorted[i - 1]!.at + sorted[i - 1]!.len)) < 0.02,
      `gap before ${sorted[i]!.key}`,
    );
  assert.ok(
    Math.abs(tl.seconds - (sorted.at(-1)!.at + sorted.at(-1)!.len)) < 0.02,
  );
  // Each moment's voice ends before the moment's own window begins.
  for (const { key, m } of playOrder(p)) {
    const c = tl.clips.find((x) => x.key === key)!;
    const v = tl.voices.find((x) => x.key === key)!;
    const windowAt = c.at + (c.len - (m.end - m.start));
    assert.ok(
      v.at + v.len <= windowAt + 0.01,
      `${key} voice runs into the moment`,
    );
    assert.equal(c.srcTo, m.end);
  }
  assert.equal(tl.cards.length, p.chapters.length);
  for (const c of tl.cards) assert.ok(tl.marks.some((m) => m.t === c.at));
  const chapters = finishChapters(
    tl.marks.map(
      (m) =>
        `${Math.floor(m.t / 60)}:${String(Math.floor(m.t % 60)).padStart(2, "0")} ${m.title}`,
    ),
  );
  assert.ok(chapters.length >= 3);
  assert.equal(tl.endCard.at + tl.endCard.len, tl.seconds);
  // The bleep moved onto the clip's own clock.
  const funny = playOrder(p).find((x) => x.m.bleeps.length)!;
  const fc = tl.clips.find((c) => c.key === funny.key)!;
  assert.equal(fc.muted.length, 1);
  assert.ok(fc.muted[0]!.from > fc.len - 30);
  // Labels never overlap.
  for (let i = 1; i < tl.labels.length; i++)
    assert.ok(tl.labels[i - 1]!.at + tl.labels[i - 1]!.len <= tl.labels[i]!.at);
});

test("labelTag and the graphics audit", () => {
  assert.equal(
    labelTag({ ...moment({ kind: "funny" }), day: 3 }),
    "DAY 3 · FUNNY MOMENT",
  );
  assert.equal(
    labelTag({
      ...moment(),
      ask: {
        id: "a",
        question: "q",
        result: "disproved",
        confidence: 1,
        at: 0,
      },
    }),
    "TESTED: FALSE",
  );
  const p = fullPlan();
  const s = fixedScript(p);
  const tl = buildTimeline(p, s, voicesFor(p), { duration: () => 5000 });
  const audit = auditTimeline(tl, s, p);
  assert.equal(audit.stats.unreadable, 0);
  const squeezed = {
    ...tl,
    labels: tl.labels.map((l, i) => (i === 0 ? { ...l, len: 0.5 } : l)),
  };
  const fixed = fixLabels(squeezed, auditTimeline(squeezed, s, p));
  assert.equal(fixed.labels.length, tl.labels.length - 1);
});

test("weekPackage: keywords first, playlist on line two, chapters, the week's Day N Shorts only", () => {
  const p = fullPlan();
  const s = fixedScript(p);
  const tl = buildTimeline(p, s, voicesFor(p), { duration: () => 5000 });
  const pkg = weekPackage(p, s, tl, {
    playlistId: "PL123",
    days: [
      { day: 2, videoId: "abc", title: "GTA 6 Day 2: Can You Swim Forever?" },
      { day: 9, videoId: "zzz", title: "GTA 6 Day 9: Later" },
    ],
  });
  const lines = pkg.description.split("\n");
  assert.match(
    lines[0]!,
    /^GTA 6 Week 1: the best moments, tests and discoveries/,
  );
  assert.match(lines[1]!, /playlist\?list=PL123/);
  assert.match(pkg.description, /0:00 GTA 6 Week 1 Intro/);
  assert.match(
    pkg.description,
    /Day 2: GTA 6 Day 2: Can You Swim Forever\? https:\/\/youtu\.be\/abc/,
  );
  assert.ok(!pkg.description.includes("zzz"));
  assert.ok(!/[–—]/.test(pkg.description));
  assert.match(pkg.pinnedComment, /^What should we test in Week 2\?/);
  assert.ok(pkg.chapters.length >= 3);
});

// ---------------------------------------------------------------- render pieces

test("clipVolume: full, ducked under the voice with ramps, muted, faded", () => {
  const c = {
    len: 20,
    ducked: [{ from: 0, to: 5 }],
    muted: [{ from: 10, to: 11 }],
  };
  assert.equal(clipVolume(2, c, 0.16), 0.16);
  assert.ok(clipVolume(5.15, c, 0.16) > 0.16 && clipVolume(5.15, c, 0.16) < 1);
  assert.equal(clipVolume(7, c, 0.16), 1);
  assert.equal(clipVolume(10.5, c, 0.16), 0);
  assert.ok(clipVolume(19, { ...c, fadeOut: true }, 0.16) < 0.1);
});

test("cutArgs and cutName: 1080p30 with even loudness, one file per stretch", () => {
  const a = cutArgs("in.mp4", 12.5, 30, "out.mp4");
  assert.equal(a[a.indexOf("-ss") + 1], "12.500");
  assert.ok(a.join(" ").includes("loudnorm"));
  assert.ok(a.join(" ").includes("fps=30"));
  assert.equal(cutName("a", 1, 2), cutName("a", 1, 2));
  assert.notEqual(cutName("a", 1, 2), cutName("a", 1, 3));
});

test("weekProps: every file served from the episode folder", () => {
  const p = fullPlan();
  const s = fixedScript(p);
  const tl = buildTimeline(p, s, voicesFor(p), { duration: () => 5000 });
  const files = new Map(tl.clips.map((c) => [c.key, `clips/${c.key}.mp4`]));
  const props = weekProps(tl, files, {
    game: p.game,
    base: "http://127.0.0.1:1",
    endLine: "x",
    next: { title: "GTA 6 Day by Day", thumbSrc: null },
  });
  assert.equal(props.clips.length, tl.clips.length);
  assert.ok(
    props.clips.every((c) => c.src.startsWith("http://127.0.0.1:1/clips/")),
  );
  assert.ok(
    props.voices.every((v) => v.src.startsWith("http://127.0.0.1:1/voice/")),
  );
});

// ---------------------------------------------------------------- the job

test("nextWeekSlot: the coming Sunday slot, its week and the dates it covers", () => {
  const s = { day: "sun", slot: "18:00", start: "2026-11-19" };
  const slot = nextWeekSlot(
    s,
    new Date("2026-11-27T09:00:00Z"),
    "Europe/London",
  )!;
  assert.equal(slot.date, "2026-11-29");
  assert.equal(slot.at.toISOString(), "2026-11-29T18:00:00.000Z");
  assert.equal(slot.from, "2026-11-22");
  assert.equal(slot.to, "2026-11-28");
  assert.equal(slot.week, 2);
  // Before launch there is no week to make.
  assert.equal(
    nextWeekSlot(s, new Date("2026-11-14T09:00:00Z"), "Europe/London"),
    undefined,
  );
});

test("weekDue: inside the make window and not done", () => {
  const s = { day: "sun", slot: "18:00", start: "2026-11-19" };
  const slot = nextWeekSlot(
    s,
    new Date("2026-11-27T09:00:00Z"),
    "Europe/London",
  )!;
  assert.equal(
    weekDue(slot, new Date("2026-11-28T12:00:00Z"), 20, new Set()),
    false,
  );
  assert.equal(
    weekDue(slot, new Date("2026-11-29T00:00:00Z"), 20, new Set()),
    true,
  );
  assert.equal(
    weekDue(slot, new Date("2026-11-29T00:00:00Z"), 20, new Set([2])),
    false,
  );
});

test("spoilerRule: the series' own window is open for four weeks, and catches story phrases", () => {
  const live = spoilerRule({
    game: "Grand Theft Auto VI",
    start: "2026-11-19",
    days: 28,
    live: [],
    now: new Date("2026-11-25T12:00:00Z"),
  });
  assert.equal(live.open, true);
  assert.match(
    live.check("and that's the true ending of the game", {
      start: 0,
      end: 1,
    }) ?? "",
    /spoiler/,
  );
  assert.equal(
    live.check("we drove a boat under the bridge", { start: 0, end: 1 }),
    undefined,
  );
  const later = spoilerRule({
    game: "Grand Theft Auto VI",
    start: "2026-11-19",
    days: 28,
    live: [],
    now: new Date("2027-01-25T12:00:00Z"),
  });
  assert.equal(later.open, false);
});

test("compileWeek: ranks, plans, writes, voices and packages a week end to end (no render)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sw-"));
  try {
    const streams = [
      stream(
        "v1",
        "2026-11-19",
        [120, 400, 700, 1000],
        [
          [405, 408, "no way, let's go!"],
          [700, 703, "hahaha"],
        ],
      ),
      stream(
        "v2",
        "2026-11-20",
        [150, 450, 800],
        [
          [150, 153, "let's see if this works"],
          [455, 458, "oh my god"],
        ],
      ),
    ];
    const r = await compileWeek({
      game: "Grand Theft Auto VI",
      week: 1,
      start: "2026-11-19",
      streams,
      outDir: dir,
      minSeconds: 240,
      maxSeconds: 420,
      minMoments: 4,
      voice: async (key, text, file) => ({ key, file, seconds: 3, text }),
      spoiler: { open: false },
      now: new Date("2026-11-22T12:00:00Z"),
    });
    assert.equal(r.status, "planned", JSON.stringify(r.why));
    assert.ok(r.timeline!.seconds <= 420 + 60);
    for (const f of [
      "ranking.json",
      "plan.json",
      "script.json",
      "timeline.json",
      "package.json",
      "graphics-audit.json",
      "report.md",
    ])
      assert.ok((await fs.stat(path.join(dir, f))).size > 0, f);
    const report = await fs.readFile(path.join(dir, "report.md"), "utf8");
    assert.match(report, /Moment ranking/);
    assert.match(report, /Chapter plan/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("withSignOff: restores the sign-off a rewrite trimmed, never twice", async () => {
  const { withSignOff } = await import("../src/streamweekly/script.ts");
  const full = "That's the Pulse. Play something good this week.";
  assert.equal(withSignOff({ outro: "That's it for Week 1. Play something good this week." }).outro, `That's it for Week 1. ${full}`);
  assert.equal(withSignOff({ outro: `Done. ${full}` }).outro, `Done. ${full}`);
  assert.equal(withSignOff({ outro: "Done" }).outro, `Done. ${full}`);
});

test("parseSilences: ffmpeg's silencedetect log as stretches, short ones left out", async () => {
  const { parseSilences } = await import("../src/streamweekly/render.ts");
  const log = [
    "[silencedetect @ 0x1] silence_start: 12.5",
    "[silencedetect @ 0x1] silence_end: 16.25 | silence_duration: 3.75",
    "[silencedetect @ 0x1] silence_start: 40",
    "[silencedetect @ 0x1] silence_end: 41 | silence_duration: 1",
  ].join("\n");
  assert.deepEqual(parseSilences(log, 3), [{ start: 12.5, end: 16.25 }]);
  assert.equal(parseSilences(log).length, 2);
});

test("leadFloorOf: a lead-in starts after the last menu or dark shot before the window", async () => {
  const { leadFloorOf } = await import("../src/streamweekly/moments.ts");
  const shots = [
    { start: 50, end: 60, text: "", luma: 80 },
    { start: 60, end: 80, text: "", luma: 80, menu: true },
    { start: 80, end: 100, text: "", luma: 80 },
  ];
  assert.deepEqual(leadFloorOf(shots, 100), { leadFloor: 80 });
  assert.deepEqual(leadFloorOf(shots.slice(0, 1), 100), {});
});

test("bedVolume: quiet under the game, quieter under the narrator, faded at both ends", async () => {
  const { bedVolume } = await import("../src/render/StreamWeekly.tsx");
  const voices = [{ at: 10, len: 5 }];
  assert.equal(bedVolume(5, 100, voices), 0.11);
  assert.equal(bedVolume(12, 100, voices), 0.06);
  assert.equal(bedVolume(0, 100, voices), 0);
  assert.equal(bedVolume(100, 100, voices), 0);
});

test("describeWindows: only shots inside the windows go to the vision model, and only when it is up", async () => {
  const { describeWindows } = await import("../src/streamweekly/build.ts");
  const v = vod("v1", "2026-11-19", { duration: 100 });
  const seen: number[][] = [];
  const describe = (async (sub: VodIndex) => {
    seen.push(sub.shots.map((s) => s.start));
    return { index: sub, described: 0, failed: 0 };
  }) as never;
  await describeWindows("/nowhere", v, [{ from: 25, to: 41 }], { describe, up: async () => true });
  assert.deepEqual(seen, [[20, 30, 40]]);
  await describeWindows("/nowhere", v, [{ from: 25, to: 41 }], { describe, up: async () => false });
  assert.equal(seen.length, 1);
});
