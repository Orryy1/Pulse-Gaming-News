import { test } from "node:test";
import assert from "node:assert/strict";
import { cutdownRanks, cutdownWindow, wordsIn, cutdownScript, CUTDOWN_MAX_SECONDS, CUTDOWN_TAIL_SECONDS } from "../src/editorial/cutdown.ts";
import { pinnedComment, keywordLead } from "../src/editorial/seo.ts";
import { goodScript } from "./helpers.ts";

test("cutdowns go worst first, then number two, then number one", () => {
  assert.deepEqual(cutdownRanks([8, 7, 6, 5, 4, 3, 2, 1], 3), [8, 2, 1]);
  assert.deepEqual(cutdownRanks([8, 7, 6, 5, 4, 3, 2, 1], 5), [8, 2, 1, 3, 4]);
  assert.deepEqual(cutdownRanks([2, 1], 3), [2, 1]);
  assert.deepEqual(cutdownRanks([], 3), []);
});

const seg = (kind: any, start: number, end: number) => ({ kind, text: "", start, end });
const words = (from: number, to: number) => {
  const out = [];
  for (let t = from; t < to; t += 0.5) out.push({ text: (Math.round(t * 2) % 12 === 11 ? "end." : "word"), start: t, end: t + 0.4 });
  return out;
};

test("an entry's window runs to the next segment and keeps the winner's verdict", () => {
  const segments = [seg("hook", 0, 10), seg("beat", 10, 40), seg("beat", 40, 70), seg("take", 70, 85), seg("loop", 85, 86)];
  assert.deepEqual(cutdownWindow(segments, 0, words(0, 90)), { start: 9.9, end: 40 });
  // The winner's window takes the outro when it fits in a Short.
  assert.deepEqual(cutdownWindow(segments, 1, words(0, 90)), { start: 39.9, end: 85 });
  assert.equal(cutdownWindow(segments, 5, words(0, 90)), undefined);
});

test("a long entry ends on the last full sentence that fits", () => {
  const segments = [seg("hook", 0, 5), seg("beat", 5, 90), seg("take", 90, 100)];
  const w = cutdownWindow(segments, 0, words(0, 100))!;
  assert.ok(w.end - w.start <= CUTDOWN_MAX_SECONDS - CUTDOWN_TAIL_SECONDS);
  const inside = wordsIn(words(0, 100), w);
  assert.match(inside[inside.length - 1]!.text, /\.$/);
  assert.ok(inside[0]!.start >= 0);
});

test("a cutdown's script points back to the full ranking", () => {
  const parent = goodScript({
    game_title: "Call of Duty",
    criterion: "campaign strength",
    entries: [
      { rank: 2, game_title: "Black Ops", steam_search_term: "Black Ops", year: 2010, platforms: "PC" },
      { rank: 1, game_title: "Call of Duty 4", steam_search_term: "Call of Duty 4", year: 2007, platforms: "PC" },
    ],
  });
  parent.beats = [
    { narration: "Number two. Black Ops.", visual: { kind: "rank", primary: "Black Ops", secondary: "The numbers" } },
    { narration: "Number one. Call of Duty 4.", visual: { kind: "rank", primary: "Call of Duty 4", secondary: "Still the king" } },
  ] as any;
  const s = cutdownScript(parent, 1, { overlay_title: "THE BEST COD CAMPAIGN?", youtube_title: "Is Call of Duty 4 Still the Best Campaign?", description: "It changed everything. The full ranking is on the channel.", question: "Would you put it first?" }, "abc123");
  assert.equal(s.cutdown!.rank, 1);
  assert.equal(s.cutdown!.total, 2);
  assert.match(s.youtube.description, /https:\/\/youtu\.be\/abc123/);
  assert.match(pinnedComment(s), /^Would you put it first\? .*https:\/\/youtu\.be\/abc123$/);
  s.cutdown!.theme = "Call of Duty";
  assert.match(keywordLead(s), /number 1 of 2 in our Call of Duty ranking/);
});
