// LOOP_MEDIAN_JUDGE (19 Nov 2026 audit, upgrade 2): medians with 15 a side, series counted, two extensions at most,
// lessons from 15 Shorts or more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { testConfig } from "./helpers.ts";
import {
  evidencedRetentionLessons,
  judgeFitTestByMedian,
  MAX_EXTENSIONS,
  medianBoost,
  medianCompare,
  nextTest,
  type EpisodeInfo,
  type LoopRow,
} from "../src/analyticsloop.ts";

const now = new Date("2026-11-25T09:00:00Z");
const posted = "2026-11-15T12:00:00Z";

function data(
  fitN: number,
  restN: number,
  fitViews: number,
  restViews: number,
  series = false,
) {
  const eps = new Map<string, EpisodeInfo>();
  const rows: LoopRow[] = [];
  const add = (id: string, fit: boolean, v: number) => {
    eps.set(id, {
      id,
      video: `v_${id}`,
      title: fit ? "GTA 6 is 150GB on your console" : "A studio says hello",
      caption_title: "",
      hook: "",
      headline: "",
      loop: "",
      game: fit ? "Grand Theft Auto VI" : "Quiet Game",
      lane: "news",
      story_type: "other",
      format: series ? "why" : "news",
      duration: fit ? 30 : 50,
      live_at: "2026-11-23T12:00:00Z",
      long: false,
      ...(series ? { series: "why" } : {}),
    });
    for (const platform of ["instagram", "tiktok", "youtube"] as const)
      rows.push({
        platform,
        post_id: `${platform}_${id}`,
        kind: platform === "youtube" ? "short" : "reel",
        episode_id: id,
        posted_at: posted,
        captured_at: now.toISOString(),
        text: "",
        views: v,
        views_72h: v,
      });
  };
  for (let i = 0; i < fitN; i++) add(`f${i}`, true, fitViews);
  for (let i = 0; i < restN; i++) add(`r${i}`, false, restViews);
  return { rows, eps };
}

test("medianCompare and medianBoost need 15 a side and step at 1.25x and 2x", () => {
  const a = Array(15).fill(300);
  const b = Array(15).fill(100);
  assert.equal(medianCompare(a, b).ratio, 3);
  assert.equal(medianCompare(a.slice(1), b).ratio, undefined);
  assert.equal(medianBoost(a, b), 0.25);
  assert.equal(medianBoost(Array(15).fill(130), b), 0.1);
  assert.equal(medianBoost(Array(15).fill(120), b), 0);
  assert.equal(medianBoost(a.slice(1), b), 0, "too few: no lift");
});

test("the median fit test passes on middle views, counts series Shorts and says too few under 15 a side", () => {
  const pass = data(16, 16, 600, 200, true);
  const j = judgeFitTestByMedian(pass.rows, pass.eps, "2026-11-11", now);
  assert.equal(j.verdict, "pass", "series Shorts are counted");
  assert.equal(j.by.youtube!.ratio, 3);
  assert.equal(
    judgeFitTestByMedian(
      data(16, 16, 250, 200).rows,
      data(16, 16, 250, 200).eps,
      "2026-11-11",
      now,
    ).verdict,
    "fail",
  );
  const few = data(10, 16, 600, 200);
  assert.equal(
    judgeFitTestByMedian(few.rows, few.eps, "2026-11-11", now).verdict,
    "too few",
  );
});

test("a test still too few after two extensions ends inconclusive and the next starts", () => {
  const { rows, eps } = data(3, 3, 600, 200);
  let t = nextTest(undefined, rows, eps, new Date("2026-11-25T09:00:00Z"), {
    median: true,
  }).test;
  assert.equal(t.id, "fit-2026-11");
  assert.equal(t.extensions, 1);
  assert.equal(t.judge_on, "2026-12-02");
  t = nextTest(t, rows, eps, new Date("2026-12-02T09:00:00Z"), {
    median: true,
  }).test;
  assert.equal(t.extensions, MAX_EXTENSIONS);
  const end = nextTest(t, rows, eps, new Date("2026-12-09T09:00:00Z"), {
    median: true,
  });
  assert.equal(end.test.id, "question-opener");
  assert.ok(end.lines.some((l) => /inconclusive/.test(l)));
  const old = nextTest(t, rows, eps, new Date("2026-12-09T09:00:00Z"));
  assert.equal(
    old.test.id,
    "fit-2026-11",
    "off: the old judge extends without end",
  );
});

test("a retention lesson needs 15 Shorts behind it", () => {
  const cause = (tag: string, videos: number) => ({
    tag,
    kind: "drop" as const,
    points: 10,
    videos,
    detail: `faster in 2 of ${videos} Shorts`,
    examples: [],
  });
  const lessons = evidencedRetentionLessons({
    at: "2026-11-16T09:00:00Z",
    causes: [cause("gameplay footage", 3), cause("a still picture", 83)],
    effects: [],
  } as never);
  assert.equal(lessons.length, 1);
  assert.match(lessons[0]!, /still picture/);
  assert.equal(testConfig("/tmp/x").loopMedianJudge, false);
});
