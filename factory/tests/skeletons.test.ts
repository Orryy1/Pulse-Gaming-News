// Short structures and the "argues, does not describe" check (upgrade queue item 10, 11 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript, item } from "./helpers.ts";
import { loadConfig } from "../src/config.ts";
import {
  ENDINGS,
  OPENINGS,
  SKELETON_WINDOW,
  allSkeletons,
  hookStyleOpenings,
  parseSkeleton,
  pickSkeleton,
  skeletonKey,
  skeletonProblems,
  skeletonRule,
  structureCounts,
  structureLine,
} from "../src/editorial/skeletons.ts";
import { arguesCheck } from "../src/qa/argues.ts";
import { writeScript } from "../src/editorial/editorial.ts";
import {
  features,
  type EpisodeInfo,
  type LoopRow,
} from "../src/analyticsloop.ts";
import type { Llm } from "../src/editorial/llm.ts";
import type { EpisodeAssets } from "../src/episodes.ts";

const STATEMENT = { questionEndings: false, argument: false };

test("every new setting is off by default, and DROP_ANGLE_HOURS is 12", () => {
  const cfg = loadConfig();
  assert.equal(cfg.shortSkeletons, false);
  assert.equal(cfg.shortArguesCheck, false);
  assert.equal(cfg.dropAngle, false);
  assert.equal(cfg.dropAngleHours, 12);
});

test("there are far more structures than the window, each a distinct key that parses back", () => {
  const all = allSkeletons(STATEMENT);
  assert.ok(all.length > SKELETON_WINDOW * 4, `${all.length} structures`);
  assert.equal(new Set(all.map((s) => s.key)).size, all.length);
  for (const s of all) assert.equal(parseSkeleton(s.key)?.key, s.key);
  assert.equal(parseSkeleton("verdict.call_then_proof.brisk"), undefined);
  assert.equal(parseSkeleton("nope.call_then_proof.brisk.advice"), undefined);
  assert.equal(parseSkeleton(""), undefined);
  // With SHORT_END_PAYOFF on, no structure ends on a question; the argument test's half only runs the argument.
  assert.ok(all.every((s) => !s.ending.question && s.order.id !== "argument"));
  assert.ok(
    allSkeletons({ questionEndings: true, argument: false }).some(
      (s) => s.ending.question,
    ),
  );
  assert.ok(
    allSkeletons({ questionEndings: false, argument: true }).every(
      (s) => s.order.id === "argument",
    ),
  );
  assert.deepEqual(
    [
      ...new Set(
        allSkeletons({ ...STATEMENT, orders: ["one_detail"] }).map(
          (s) => s.order.id,
        ),
      ),
    ],
    ["one_detail"],
  );
});

test("no two of the newest 30 Shorts share a structure, and neighbours differ part by part", () => {
  const recent: string[] = [];
  for (let i = 0; i < 120; i++) {
    const s = pickSkeleton(`story-${i}`, recent, STATEMENT);
    recent.unshift(s.key);
  }
  for (let i = 0; i + SKELETON_WINDOW <= recent.length; i++) {
    const window = recent.slice(i, i + SKELETON_WINDOW);
    assert.equal(new Set(window).size, SKELETON_WINDOW, `window at ${i}`);
  }
  assert.equal(structureCounts(recent).sharedPairs, 0);
  for (let i = 0; i + 1 < recent.length; i++) {
    const a = parseSkeleton(recent[i])!;
    const b = parseSkeleton(recent[i + 1])!;
    assert.notEqual(a.opening.id, b.opening.id);
    assert.notEqual(a.order.id, b.order.id);
    assert.notEqual(a.length.id, b.length.id);
    assert.notEqual(a.ending.id, b.ending.id);
    if (i + 2 < recent.length)
      assert.notEqual(a.opening.id, parseSkeleton(recent[i + 2])!.opening.id);
  }
  // Over the run every opening and every statement ending is used.
  const c = structureCounts(recent);
  assert.equal(Object.keys(c.openings).length, OPENINGS.length);
  assert.equal(
    Object.keys(c.endings).length,
    ENDINGS.filter((e) => !e.question).length,
  );
});

test("the pick is stable for a story, skips Shorts written without a structure, and never fails", () => {
  const recent = ["", "verdict.call_then_proof.brisk.advice", ""];
  const a = pickSkeleton("same", recent, STATEMENT);
  assert.equal(pickSkeleton("same", recent, STATEMENT).key, a.key);
  assert.notEqual(a.key, "verdict.call_then_proof.brisk.advice");
  assert.notEqual(a.opening.id, "verdict");
  // A narrow choice (argument half, question hooks only) that has used every structure takes the oldest.
  const narrow = {
    questionEndings: false,
    argument: true,
    openings: ["question"],
  };
  const all = allSkeletons(narrow).map((s) => s.key);
  assert.ok(all.length < SKELETON_WINDOW);
  const used = [...all].reverse();
  assert.equal(pickSkeleton("x", used, narrow).key, all[0]);
});

test("the hook-style test keeps its hook: a question for A, a statement opening for B, anything without it", () => {
  assert.deepEqual(hookStyleOpenings({ key: "hook_style", variant: "A" }, []), [
    "question",
  ]);
  const b = hookStyleOpenings(undefined, [
    { test: { key: "hook_style" }, variant: "B" },
  ]);
  assert.ok(b && b.length === OPENINGS.length - 1 && !b.includes("question"));
  assert.equal(
    hookStyleOpenings({ key: "title_shape", variant: "A" }, []),
    undefined,
  );
  assert.ok(
    allSkeletons({ ...STATEMENT, openings: ["question"] }).every(
      (s) => s.opening.id === "question",
    ),
  );
});

test("a draft is held to its structure's beats, hook and ending", () => {
  const brisk = parseSkeleton("stake.facts_then_call.brisk.advice")!;
  assert.deepEqual(skeletonProblems(goodScript(), brisk), []);
  const full = parseSkeleton("question.one_detail.full.fork")!;
  const p = skeletonProblems(goodScript(), full);
  assert.equal(p.length, 3);
  assert.match(p[0]!, /exactly 4 beats, not 2/);
  assert.match(p[1]!, /opens on a question/);
  assert.match(p[2]!, /must ask the viewer/);
  const asked = goodScript({
    hook: "Is Starfield's expansion really slipping to 2027?",
    loop_line: "Wait for it, or move on?",
  });
  assert.equal(
    skeletonProblems(asked, brisk).filter((x) => /statement/.test(x)).length,
    2,
  );
  assert.match(skeletonRule(full), /opening \(hook\): one answerable question/);
  assert.match(skeletonRule(full), /exactly four beats/);
});

test("the writer reads the structure only when given one", async () => {
  const briefs: string[] = [];
  const llm = {
    structured: async (req: { content: string }) => {
      briefs.push(req.content);
      return goodScript();
    },
  } as unknown as Llm;
  const cluster = {
    hash: "story-hash",
    items: [item("Starfield expansion delayed", "IGN")],
  } as never;
  await writeScript(llm, cluster, [], { mustLabelRumour: false });
  assert.doesNotMatch(briefs[0]!, /This Short's structure/);
  assert.doesNotMatch(briefs[0]!, /official drop/);
  await writeScript(llm, cluster, [], {
    mustLabelRumour: false,
    skeleton: parseSkeleton("warning.then_and_now.standard.next_date")!,
  });
  assert.match(briefs[1]!, /This Short's structure/);
  assert.match(briefs[1]!, /one warning to the viewer/);
  assert.match(briefs[1]!, /exactly three beats/);
});

test("the weekly report counts how often each structure ran, and says nothing without any", () => {
  const keys = [
    "verdict.call_then_proof.brisk.advice",
    "",
    "verdict.call_then_proof.brisk.advice",
    "stake.one_detail.full.callback",
  ];
  const c = structureCounts(keys);
  assert.equal(c.shorts, 4);
  assert.equal(c.structured, 3);
  assert.equal(c.distinct, 2);
  assert.deepEqual(c.runs[0], {
    key: "verdict.call_then_proof.brisk.advice",
    n: 2,
  });
  assert.equal(c.sharedPairs, 1);
  assert.deepEqual(c.openings, { verdict: 2, stake: 1 });
  const line = structureLine(keys)!;
  assert.match(line, /3 of 4 Shorts were written to one, 2 different/);
  assert.match(
    line,
    /"opens on a verdict, the call then the proof, brisk, ends on advice" 2 times/,
  );
  assert.match(line, /Pairs among the newest 30 sharing one: 1 \(target 0\)/);
  assert.doesNotMatch(line, /\u2014/, "no em dashes");
  assert.equal(structureLine(["", undefined, null]), undefined);
  assert.equal(structureLine([]), undefined);
  // The analytics groups read the structure's opening, and nothing when a Short has none.
  const row = {
    platform: "youtube",
    post_id: "v",
    kind: "short",
    posted_at: "2026-11-20T18:00:00Z",
    captured_at: "2026-11-24T18:00:00Z",
    text: "t",
    views: 10,
  } as LoopRow;
  const e = {
    id: "e",
    title: "Starfield slips",
    hook: "h",
    game: "Starfield",
    lane: "news",
    story_type: "delay",
    format: "news",
    live_at: "2026-11-20T18:00:00Z",
    long: false,
  } as EpisodeInfo;
  assert.equal(features(row, e)["structure opening"], undefined);
  assert.equal(
    features(row, { ...e, skeleton: "verdict.call_then_proof.brisk.advice" })[
      "structure opening"
    ],
    "opens on a verdict",
  );
});

test("argues, not describes: a point beyond the picture and Pulse's own material pass", () => {
  const ok = arguesCheck(goodScript(), null, "news");
  assert.equal(ok.pass, true, ok.problems.join("; "));
  assert.ok(ok.point.includes("reason"));
  assert.deepEqual(ok.own, ["graphic", "chart"]);
});

test("argues, not describes: a Short that only narrates the picture, with nothing of Pulse's own, fails on both", () => {
  const flat = goodScript({
    hook: "Here is the new Starfield expansion trailer.",
    beats: [
      {
        narration: "You can see the new ship flying over a desert planet.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
      {
        narration: "In this shot a crew walks into a city at night.",
        visual: { kind: "none", primary: "", secondary: "" },
      },
    ],
    pulse_take: {
      label: "",
      narration: "The trailer shows a big space station near the end.",
      on_screen: "",
    },
    loop_line: "Watch as the ship lands on the moon.",
    stamp: undefined,
  });
  const r = arguesCheck(flat, null, "news");
  assert.equal(r.pass, false);
  assert.deepEqual(r.point, []);
  assert.deepEqual(r.own, []);
  assert.ok(r.describing >= 3, `${r.describing} describing lines`);
  assert.equal(r.problems.length, 3);
  // The owner's own capture is Pulse's material, and a comparison is a point.
  const assets = {
    clips: [
      {
        file: "own_1.mp4",
        sourceUrl: "file://x",
        provenance:
          "Pulse's own gameplay capture of Starfield (desert), 8s at 12.0s, muted",
        durationSeconds: 8,
      },
    ],
  } as EpisodeAssets;
  const own = arguesCheck(
    {
      ...flat,
      pulse_take: {
        ...flat.pulse_take,
        narration: "The ship is bigger than anything in the first game.",
      },
    },
    assets,
    "news",
  );
  assert.deepEqual(own.point, ["comparison"]);
  assert.deepEqual(own.own, ["owner capture"]);
  // A ranking's rank cards are Pulse's own graphics.
  assert.ok(
    arguesCheck(
      { ...flat, entries: [{ rank: 1 }] } as never,
      null,
      "evergreen",
    ).own.includes("graphic"),
  );
  // A report card is an on-screen source.
  const report = arguesCheck(
    goodScript({
      beats: [
        {
          narration:
            "Bloomberg says the expansion slips because of the engine work.",
          visual: {
            kind: "report",
            primary: "Starfield expansion slips to 2027",
            secondary: "Bloomberg",
          },
        },
        goodScript().beats[1]!,
      ],
    }),
    null,
    "news",
  );
  assert.ok(report.own.includes("on-screen source"));
});
