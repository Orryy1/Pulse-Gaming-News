import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  isStoryRecap,
  loadRecapIndex,
  recapDue,
  recapHeldUntil,
  recapIndex,
  recapProblems,
  recapTitleProblems,
  recapTopic,
  recapWindows,
  streamedStory,
  vodOfGame,
} from "../src/storyrecap.ts";
import { docRunDue, readRun, type RunDoc } from "../src/shortrun.ts";
import {
  emptyVodIndex,
  saveVodIndex,
  type VodIndex,
} from "../src/vodindex/schema.ts";
import { spoilerWindow } from "../src/sceneindex/spoilers.ts";
import {
  retroChapterBudget,
  retroOutlineSystem,
  storyActs,
  validateRetroOutline,
  withRetroWarning,
} from "../src/editorial/retrospective.ts";
import { loadConfig } from "../src/config.ts";
import { tmpDir } from "./helpers.ts";

const at = (iso: string) => new Date(iso);
const RUN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "launch_run.json",
);
const GAME = "Grand Theft Auto VI";
const FETCH = "Grand Theft Auto VI@2026-11-18T11:00Z~2026-12-17";
const NEEDS = { minHours: 2, minLines: 3, needEnd: true };

function vod(
  id: string,
  date: string,
  title: string,
  hours: number,
  lines: string[],
  credits = false,
): VodIndex {
  const v = emptyVodIndex(
    `/v/${date} ${title} [${id}].mp4`,
    hours * 3600,
    title.includes("GTA 6") ? GAME : "",
    at(`${date}T23:00:00Z`),
  );
  v.coverage = [{ from: 0, to: hours * 3600 }];
  v.shots = [
    {
      id: 0,
      start: 0,
      end: 60,
      keyframes: [10],
      desc: "a street",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: "",
      luma: 100,
      motion: 10,
    },
    {
      id: 1,
      start: 60,
      end: 120,
      keyframes: [70],
      desc: "credits",
      who: [],
      where: "",
      mood: "",
      tags: [],
      text: credits ? "Directed by" : "",
      luma: 20,
      motion: 1,
    },
  ];
  v.lines = lines.map((t, i) => ({
    id: i,
    start: 10 + i * 5,
    end: 12 + i * 5,
    text: t,
    via: "voice" as const,
    shot: 0,
  }));
  return v;
}

const ENTRY = (): RunDoc =>
  readRun(RUN).find(
    (e): e is RunDoc => e.kind === "doc" && Boolean(e.story_recap),
  )!;

test("off by default, and the run file plans it after the window, never as an ordinary planned documentary", () => {
  const before = { ...process.env };
  delete process.env.STORY_RECAP;
  try {
    const c = loadConfig();
    assert.equal(c.storyRecap.enabled, false);
    assert.equal(c.storyRecap.needEnd, true);
  } finally {
    process.env = before;
  }
  const e = ENTRY();
  assert.ok(e, "the launch run has a story recap entry");
  assert.equal(e.story_recap!.game, GAME);
  assert.deepEqual(recapTitleProblems(e.title, e.story_recap!.short), []);
  // The plain planned-documentary path never takes it, even inside its making window.
  assert.equal(
    docRunDue([e], at("2026-12-19T12:00:00Z"), [], "Europe/London"),
    undefined,
  );
});

test("the owner's recordings of the game are joined in the order he played them", () => {
  const a = vod("v2", "2026-11-20", "GTA 6 day 2", 1, ["second"]);
  const b = vod("v1", "2026-11-19", "GTA 6 day 1", 1, ["first"]);
  const other = vod("v9", "2026-11-19", "Silent Hill f", 1, ["nope"]);
  assert.equal(vodOfGame(b, GAME), true);
  assert.equal(vodOfGame(other, GAME), false);
  const idx = recapIndex([a, other, b], GAME)!;
  assert.equal(idx.source.duration, 7200);
  assert.deepEqual(
    idx.lines.map((l) => l.text),
    ["first", "second"],
  );
  assert.equal(idx.lines[1]!.start, 3610);
  assert.equal(idx.shots[2]!.start, 3600);
  assert.equal(idx.lines[1]!.shot, 2);
  assert.deepEqual(idx.coverage, [{ from: 0, to: 7200 }]);
  assert.equal(recapIndex([other], GAME), undefined);
  // The acts are cut from it in story order.
  assert.ok(storyActs(idx, 2).length >= 1);
});

test("it waits for enough of the story: hours, heard lines and the end credits", () => {
  assert.match(recapProblems(undefined, NEEDS)[0]!, /no recordings/);
  const short = recapIndex(
    [vod("v1", "2026-11-19", "GTA 6 day 1", 1, ["a"])],
    GAME,
  )!;
  const p = recapProblems(short, NEEDS);
  assert.equal(p.length, 3);
  assert.match(p.join(" "), /hours of the story streamed/);
  assert.match(p.join(" "), /end credits/);
  const full = recapIndex(
    [
      vod("v1", "2026-11-19", "GTA 6 day 1", 1.5, ["a", "b"]),
      vod("v2", "2026-12-10", "GTA 6 finale", 1, ["c", "d"], true),
    ],
    GAME,
  )!;
  assert.deepEqual(recapProblems(full, NEEDS), []);
  assert.deepEqual(
    recapProblems(short, { minHours: 0.5, minLines: 1, needEnd: false }),
    [],
  );
});

test("never inside the spoiler window: GAME_FETCH_TITLES gives the window even with SPOILER_GUARD off", () => {
  const w = recapWindows([], FETCH, GAME, 28);
  assert.equal(w.length, 1);
  assert.equal(w[0]!.until, "2026-12-18T00:00:00.000Z");
  assert.equal(
    recapHeldUntil(w, [at("2026-12-17T20:00:00Z")]),
    "2026-12-18T00:00:00.000Z",
  );
  assert.equal(recapHeldUntil(w, [at("2026-12-18T00:00:01Z")]), undefined);
  // A live window from the spoiler guard counts too, and another game's does not.
  const live = [
    spoilerWindow("Silent Hill f", "2026-12-01", {
      days: 28,
      openingShare: 0.1,
    })!,
  ];
  assert.equal(recapWindows(live, "", GAME, 28).length, 0);
});

test("recapDue: not before its making window, not while the window is open, waiting while the story is short, then due", () => {
  const e = ENTRY();
  const tz = "Europe/London";
  const ready = () => ({
    windows: recapWindows([], FETCH, GAME, 28),
    problems: [],
  });
  // Before the making window of its first day: nothing.
  assert.deepEqual(
    recapDue(e, at("2026-12-10T12:00:00Z"), [], tz, false, ready),
    {},
  );
  // Its first day's making window (from 18 Dec 04:00 UTC, after the window ended at 18 Dec 00:00 UTC).
  const due = recapDue(e, at("2026-12-18T05:00:00Z"), [], tz, false, ready);
  assert.equal(due.at?.toISOString(), "2026-12-19T20:00:00.000Z");
  // A recap planned too early is held by the window, whatever its date says.
  const early: RunDoc = { ...e, date: "2026-12-16" };
  assert.match(
    recapDue(early, at("2026-12-15T12:00:00Z"), [], tz, false, ready).waiting!,
    /spoiler window is open until 2026-12-18/,
  );
  // Story not streamed yet: it waits, and tomorrow's slot is tried tomorrow.
  const notReady = () => ({
    windows: [],
    problems: ["the end credits have not been seen on stream yet"],
  });
  assert.match(
    recapDue(e, at("2026-12-18T05:00:00Z"), [], tz, false, notReady).waiting!,
    /end credits/,
  );
  const tomorrow = recapDue(
    e,
    at("2026-12-19T21:00:00Z"),
    [],
    tz,
    false,
    ready,
  );
  assert.equal(tomorrow.at?.toISOString(), "2026-12-20T20:00:00.000Z");
  // Taken slot, made already, past its last day.
  assert.equal(
    recapDue(
      e,
      at("2026-12-18T05:00:00Z"),
      [at("2026-12-19T20:00:00Z")],
      tz,
      false,
      ready,
    ).at,
    undefined,
  );
  assert.deepEqual(
    recapDue(e, at("2026-12-18T05:00:00Z"), [], tz, true, ready),
    {},
  );
  assert.match(
    recapDue(e, at("2027-02-05T12:00:00Z"), [], tz, false, ready).waiting!,
    /past its last day/,
  );
});

test("the topic is a story-only retrospective: story chapters only, in order, with the spoiler warning first", () => {
  const e = ENTRY();
  const t = recapTopic(e, ["v1", "v2"], 2026);
  assert.equal(t.format, "retro");
  assert.equal(t.retro?.storyOnly, true);
  assert.equal(t.retro?.key, "recap-grand-theft-auto-vi");
  assert.deepEqual(t.recap, { game: GAME, vods: ["v1", "v2"] });
  assert.equal(isStoryRecap({ topic: t }), true);
  const b = retroChapterBudget(60, true);
  assert.ok(b.story >= 5);
  assert.equal(
    b.history + b.making + b.innovations + b.moments + b.reception + b.legacy,
    0,
  );
  assert.doesNotMatch(retroOutlineSystem(b), /\bhistory \(/);
  assert.match(retroOutlineSystem(b), /This is a story recap/);
  // The normal retrospective is unchanged.
  assert.ok(retroChapterBudget(60).reception >= 1);
  const outline = {
    question: "What happens in GTA 6?",
    youtube: { title: e.title, description: "The whole story." },
    chapters: Array.from({ length: b.story }, (_, i) => ({
      section: "story" as const,
      act: i + 1,
      chapter_title: `Turning point number ${i + 1}`,
      focus: "what happens",
      wiki_title: GAME,
    })),
  };
  const problems = validateRetroOutline(outline as never, b, b.story);
  assert.deepEqual(
    problems.filter((p) => /needs at least|in order|must tell/.test(p)),
    [],
  );
  assert.match(
    withRetroWarning("Lucia wakes up.", "GTA 6"),
    /^Spoiler warning: this is the whole story of GTA 6/,
  );
});

test("the recap's index comes from the owner's recordings on disk", async () => {
  const dir = await tmpDir();
  await saveVodIndex(dir, vod("v1", "2026-11-19", "GTA 6 day 1", 1, ["first"]));
  await saveVodIndex(
    dir,
    vod("v2", "2026-11-20", "GTA 6 day 2", 1, ["second"]),
  );
  const s = await streamedStory(dir, GAME);
  assert.deepEqual(s.vods, ["v1", "v2"]);
  const only = await loadRecapIndex(dir, { game: GAME, vods: ["v2"] });
  assert.deepEqual(
    only?.lines.map((l) => l.text),
    ["second"],
  );
});
