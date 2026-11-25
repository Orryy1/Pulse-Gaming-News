import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chooseLongformTopic,
  citesPoll,
  sameSeries,
  loopsWithoutChapter,
  pollWinnerOf,
  refusedChapterFate,
  withPollWinner,
} from "../src/editorial/longrescue.ts";
import { pollBlock } from "../src/social/poll.ts";
import type {
  EvergreenCandidate,
  EvergreenTopic,
} from "../src/editorial/evergreen.ts";

// ---------------------------------------------------------------- a chapter that can't be written

test("a refused chapter is dropped while the minimum can still be met, never the first and never with the switch off", () => {
  const base = { on: true, position: 6, written: 6, left: 0, min: 5 };
  assert.equal(
    refusedChapterFate(base).drop,
    true,
    "chapter 7 of 7 with six written",
  );
  assert.equal(
    refusedChapterFate({ ...base, position: 0, written: 0, left: 6 }).drop,
    false,
    "the first chapter",
  );
  assert.equal(
    refusedChapterFate({ ...base, on: false }).drop,
    false,
    "DOC_DROP_REFUSED_CHAPTER off",
  );
  const few = refusedChapterFate({
    on: true,
    position: 3,
    written: 1,
    left: 3,
    min: 5,
  });
  assert.equal(few.drop, false);
  assert.match(few.why, /4 chapters at most, under the minimum of 5/);
  assert.equal(
    refusedChapterFate({ on: true, position: 3, written: 2, left: 3, min: 5 })
      .drop,
    true,
    "exactly the minimum",
  );
});

test("open loops raised or answered in a dropped chapter go with it", () => {
  const loops = [
    {
      question: "Why did the map shrink?",
      plant_chapter: 0,
      payoff_chapter: 7,
    },
    {
      question: "Who drew the first map?",
      plant_chapter: 7,
      payoff_chapter: 8,
    },
    { question: "Where is Vice City?", plant_chapter: 2, payoff_chapter: 4 },
    {
      question: "Why is there one swamp?",
      plant_chapter: 3,
      payoff_chapter: 7,
    },
  ];
  const r = loopsWithoutChapter(loops, 7);
  assert.deepEqual(
    r.loops.map((l) => l.question),
    ["Where is Vice City?"],
  );
  assert.equal(r.removed.length, 3);
  assert.match(r.removed[0]!, /chapter 7 was dropped/);
  // Chapter 3 already asked it: named as hanging. The cold open is written later, so its loop just goes.
  assert.equal(r.hanging.length, 1);
  assert.match(r.hanging[0]!, /Why is there one swamp\?.*raised in chapter 3/);
});

// ---------------------------------------------------------------- the viewer poll and the weekly ranking

const now = new Date("2026-11-14T12:00:00Z");
const poll = {
  at: "2026-11-10T12:00:00Z",
  options: [
    { name: "Half-Life and Portal", percent: 100 },
    { name: "Halo", percent: 0 },
  ],
};
const shortlist: EvergreenCandidate[] = [
  { name: "Resident Evil", source: "franchise seed" },
  { name: "Call of Duty", source: "steam top sellers" },
];

test("the poll's winner is read while it steers and joins the shortlist only when missing and not ranked lately", () => {
  assert.deepEqual(pollWinnerOf(poll, now), {
    name: "Half-Life and Portal",
    percent: 100,
  });
  assert.equal(
    pollWinnerOf(poll, new Date("2026-11-30T12:00:00Z")),
    undefined,
    "a stale poll",
  );
  assert.equal(pollWinnerOf(undefined, now), undefined);
  const w = pollWinnerOf(poll, now)!;
  const added = withPollWinner(shortlist, w, []);
  assert.equal(added.added, true);
  assert.equal(added.candidates[0]!.name, "Half-Life and Portal");
  assert.equal(added.candidates[0]!.source, "viewer poll");
  assert.equal(added.candidates.length, 3);
  assert.equal(
    withPollWinner([{ name: "Half-Life & Portal", source: "x" }], w, []).added,
    false,
    "already listed",
  );
  assert.equal(
    withPollWinner(shortlist, w, ["Half-Life and Portal"]).added,
    false,
    "ranked lately",
  );
  assert.ok(
    citesPoll("The explicit 100% poll winner is missing from the shortlist."),
  );
  assert.ok(citesPoll("Half-Life and Portal won the viewer poll with 100%"));
  assert.ok(!citesPoll("Nothing on the list has ten well-known entries."));
});

const topic = (i: number, reason = "ok"): EvergreenTopic => ({
  candidate_index: i,
  format: "ranking",
  theme: i >= 0 ? `theme ${i}` : "",
  title_idea: "t",
  criterion: "c",
  reason,
});

/** A picker that behaves as it did on 14 Nov: told to pick the poll winner, it refuses when the winner isn't listed. */
const fourteenthNov =
  (calls: Array<{ names: string[]; demand: string }>) =>
  async (c: EvergreenCandidate[], demand: string) => {
    calls.push({ names: c.map((x) => x.name), demand });
    const i = c.findIndex((x) => x.name === "Half-Life and Portal");
    return i >= 0
      ? topic(
          i,
          "Half-Life and Portal won the viewer poll and supports ten entries",
        )
      : topic(
          -1,
          "The explicit 100% poll winner is missing from the shortlist. Half-Life, its three expansions and Portal...",
        );
  };

const demand = (pollLine: string) => `Trending: Halo.\n\n${pollLine}`;

test("14 Nov again: with the winner on the shortlist the Half-Life and Portal ranking is chosen", async () => {
  const calls: Array<{ names: string[]; demand: string }> = [];
  const pollLine = pollBlock(poll, now);
  const r = await chooseLongformTopic({
    select: fourteenthNov(calls),
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    winner: pollWinnerOf(poll, now),
    covered: [],
    addWinner: true,
    fallback: true,
  });
  assert.equal(r.how, "picked");
  assert.equal(r.added, true);
  assert.equal(
    r.candidates[r.topic.candidate_index]!.name,
    "Half-Life and Portal",
  );
  assert.equal(calls.length, 1);
});

test("with both switches off it skips the week as before", async () => {
  const calls: Array<{ names: string[]; demand: string }> = [];
  const pollLine = pollBlock(poll, now);
  const r = await chooseLongformTopic({
    select: fourteenthNov(calls),
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    winner: pollWinnerOf(poll, now),
    covered: [],
    addWinner: false,
    fallback: false,
  });
  assert.equal(r.how, "none");
  assert.equal(calls.length, 1);
});

test("a refusal citing the poll is asked again without the poll line, and the retry's pick stands", async () => {
  const calls: Array<{ names: string[]; demand: string }> = [];
  const pollLine = pollBlock(poll, now);
  const r = await chooseLongformTopic({
    select: async (c, d) => {
      calls.push({ names: c.map((x) => x.name), demand: d });
      return d.includes("viewers voted")
        ? topic(-1, "The poll winner is missing from the shortlist.")
        : topic(1);
    },
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    winner: pollWinnerOf(poll, now),
    covered: [],
    addWinner: false,
    fallback: true,
  });
  assert.equal(r.how, "retried");
  assert.equal(r.candidates[r.topic.candidate_index]!.name, "Call of Duty");
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[1]!.demand, /viewers voted/);
  assert.match(calls[1]!.demand, /Trending: Halo/);
  assert.match(calls[1]!.demand, /can't decide this week's topic/);
});

test("a picker that keeps citing the poll falls back to the top of the shortlist (the poll winner when added)", async () => {
  const pollLine = pollBlock(poll, now);
  const refuse = async () =>
    topic(
      -1,
      "Half-Life and Portal won the viewer poll with 100%, so nothing else will do.",
    );
  const withWinner = await chooseLongformTopic({
    select: refuse,
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    winner: pollWinnerOf(poll, now),
    covered: [],
    addWinner: true,
    fallback: true,
  });
  assert.equal(withWinner.how, "fallback");
  assert.equal(withWinner.topic.candidate_index, 0);
  assert.equal(withWinner.topic.theme, "Half-Life and Portal");
  assert.equal(withWinner.topic.format, "ranking");
  assert.ok(withWinner.topic.title_idea.length <= 60);
  assert.match(withWinner.topic.reason, /viewer poll/);
  const without = await chooseLongformTopic({
    select: refuse,
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    winner: pollWinnerOf(poll, now),
    covered: [],
    addWinner: false,
    fallback: true,
  });
  assert.equal(without.how, "fallback");
  assert.equal(without.topic.theme, "Resident Evil");
});

test("whole words only: a series is not another that shares its letters", () => {
  assert.equal(sameSeries("Ark", "Dark Souls"), false);
  assert.equal(sameSeries("Halo", "Halo: The Master Chief Collection"), true);
  assert.equal(sameSeries(null, "Halo"), false);
  assert.ok(!citesPoll("The sequel winner block has nothing strong enough."));
});

test("the fallback never takes a series ranked lately, and with no poll in front of the picker there is no fallback", async () => {
  const pollLine = pollBlock(poll, now);
  const refuse = async () =>
    topic(-1, "The poll winner is missing from the shortlist.");
  const r = await chooseLongformTopic({
    select: refuse,
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    covered: ["Every Resident Evil Game Ranked"],
    addWinner: false,
    fallback: true,
  });
  assert.equal(r.how, "fallback");
  assert.equal(r.candidates[r.topic.candidate_index]!.name, "Call of Duty");
  const all = await chooseLongformTopic({
    select: refuse,
    candidates: shortlist,
    demand: demand(pollLine),
    pollLine,
    covered: ["Resident Evil", "Call of Duty"],
    addWinner: false,
    fallback: true,
  });
  assert.equal(all.how, "none", "everything covered: the week is skipped");
  const noPoll = await chooseLongformTopic({
    select: refuse,
    candidates: shortlist,
    demand: "Trending: Halo.",
    pollLine: "",
    covered: [],
    addWinner: true,
    fallback: true,
  });
  assert.equal(noPoll.how, "none");
});

test("a refusal for any other reason still skips the week", async () => {
  const r = await chooseLongformTopic({
    select: async () => topic(-1, "Nothing here makes a ten-entry ranking."),
    candidates: shortlist,
    demand: "",
    pollLine: "",
    covered: [],
    addWinner: true,
    fallback: true,
  });
  assert.equal(r.how, "none");
  assert.equal(r.refusal, "Nothing here makes a ten-entry ranking.");
});
