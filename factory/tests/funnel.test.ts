import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FUNNEL_LINE,
  FUNNEL_TAIL_SECONDS,
  chapterBeats,
  funnelArm,
  funnelPicks,
  funnelScript,
  funnelWindow,
  planFunnel,
} from "../src/funnel.ts";
import { CUTDOWN_MAX_SECONDS } from "../src/editorial/cutdown.ts";
import { unitHash } from "../src/pipeline.ts";
import { pinnedComment } from "../src/editorial/seo.ts";
import type { Script } from "../src/editorial/schema.ts";
import type { Segment } from "../src/render/timeline.ts";
import type { Word } from "../src/voice/elevenlabs.ts";

const chapter = (n: number, title: string) => ({
  kind: "chapter",
  primary: title,
  secondary: "Grand Theft Auto VI",
  value_a: n,
  items: ["2026", "PS5"],
});
const none = { kind: "none", primary: "", secondary: "" };

// A guide as docToScript makes it: three chapters of two paragraphs each.
const guide = {
  story_type: "other",
  game_title: "Grand Theft Auto VI",
  steam_search_term: "Grand Theft Auto VI",
  headline: "GTA 6 Best Early Money",
  hook: "Money is tight in your first hours.",
  beats: [
    {
      narration:
        "First, the car wash. It pays three hundred a run. Do it twice before your first mission.",
      visual: chapter(1, "The Car Wash Loop"),
    },
    {
      narration: "Second paragraph of chapter one. It keeps going.",
      visual: none,
    },
    {
      narration:
        "Next, sell the sports cars. The docks pay well. Take the quiet road there.",
      visual: chapter(2, "Selling Cars"),
    },
    { narration: "Second paragraph of chapter two.", visual: none },
    {
      narration: "Last, the first heist. Wait for it. It pays the most.",
      visual: chapter(3, "Your First Heist"),
    },
    { narration: "Second paragraph of chapter three.", visual: none },
  ],
  pulse_take: {
    label: "OUR READ",
    narration: "That is the plan.",
    on_screen: "PLAN",
  },
  loop_line: "",
  is_rumour: false,
  attribution: "",
  youtube: {
    title: "GTA 6 Best Early Money, Learned From Real Play",
    description: "",
    tags: ["GTA 6"],
  },
  claims: [],
  runtime: "long",
} as unknown as Script;

test("funnel arm: fixed by the episode id's hash, the share in the link arm", () => {
  assert.equal(funnelArm(0.1, 0.5), "link");
  assert.equal(funnelArm(0.7, 0.5), "none");
  assert.equal(funnelArm(0.1, 0), "none", "share 0: nobody gets the link");
  const ids = Array.from({ length: 400 }, (_, i) => `ep_${i}`);
  const linked = ids.filter(
    (id) => funnelArm(unitHash(`funnel:${id}`), 0.5) === "link",
  ).length;
  assert.ok(linked > 150 && linked < 250, `about half: ${linked}`);
  assert.equal(
    funnelArm(unitHash("funnel:ep_7"), 0.5),
    funnelArm(unitHash("funnel:ep_7"), 0.5),
  );
});

test("funnel picks: the guide's chapters in its own order, at most the count, skipping those cut", () => {
  assert.deepEqual(chapterBeats(guide), [0, 2, 4]);
  assert.deepEqual(funnelPicks(guide, 3, []), [0, 2, 4]);
  assert.deepEqual(funnelPicks(guide, 2, []), [0, 2]);
  assert.deepEqual(funnelPicks(guide, 3, [0]), [2, 4]);
  assert.deepEqual(funnelPicks(guide, 2, [0, 2]), []);
});

test("funnel window: the whole chapter when it fits, ending on a full sentence with 5 seconds left for the link", () => {
  // Hook 0-3, chapter 1 at 3-20 and 20-30, chapter 2 at 30-60 and 60-80, chapter 3 80-90 and 90-100, take 100-104.
  const segs: Segment[] = [
    { kind: "hook", text: "", start: 0, end: 3 },
    { kind: "beat", text: "", start: 3, end: 20 },
    { kind: "beat", text: "", start: 20, end: 30 },
    { kind: "beat", text: "", start: 30, end: 60 },
    { kind: "beat", text: "", start: 60, end: 80 },
    { kind: "beat", text: "", start: 80, end: 90 },
    { kind: "beat", text: "", start: 90, end: 100 },
    { kind: "take", text: "", start: 100, end: 104 },
  ];
  const words: Word[] = [];
  for (let t = 3; t < 100; t += 0.5)
    words.push({
      text: Math.round(t * 2) % 8 === 7 ? "end." : "w",
      start: t,
      end: t + 0.4,
    });
  const w1 = funnelWindow(segs, [0, 2, 4], 0, words)!;
  assert.ok(w1.start < 3 && w1.start >= 2.8);
  assert.ok(w1.end > 29 && w1.end <= 30.2, `chapter one whole: ${w1.end}`);
  const w2 = funnelWindow(segs, [0, 2, 4], 2, words)!;
  assert.ok(
    w2.end - w2.start <= CUTDOWN_MAX_SECONDS - FUNNEL_TAIL_SECONDS,
    "fits with the tail",
  );
  assert.ok(w2.end > 60, "runs into its second paragraph");
  assert.equal(
    funnelWindow(segs, [0, 2, 4], 1, words),
    undefined,
    "not a chapter start",
  );
});

test("funnel script: the link arm points back everywhere, the control nowhere", () => {
  const copy = {
    overlay_title: "GTA 6: THE CAR WASH LOOP",
    youtube_title: "GTA 6 Early Money: The Car Wash Loop",
    description: "Run it twice before your first mission.",
    question: "What was your first big buy?",
  };
  const link = funnelScript(guide, 2, copy, "LONGVIDEO01", "link");
  assert.equal(link.cutdown?.funnel, "link");
  assert.equal(link.cutdown?.rank, 2);
  assert.equal(link.cutdown?.total, 3);
  assert.equal(link.cutdown?.guide, guide.youtube.title);
  assert.match(link.youtube.description, /https:\/\/youtu\.be\/LONGVIDEO01/);
  assert.equal(link.loop_line, FUNNEL_LINE);
  assert.match(pinnedComment(link), /youtu\.be\/LONGVIDEO01/);
  const control = funnelScript(guide, 2, copy, "LONGVIDEO01", "none");
  assert.doesNotMatch(control.youtube.description, /youtu\.be/);
  assert.equal(control.loop_line, "");
  assert.doesNotMatch(pinnedComment(control), /youtu\.be/);
  assert.equal(control.pulse_take.on_screen, "Selling Cars");
});

test("funnel plan: only Shorts cut from a long video link; links on other Shorts are cleared once", () => {
  const longs = [
    {
      id: "LONGVIDEO01",
      title: "GTA 6 Best Early Money, Learned From Real Play",
    },
  ];
  const row = (id: string, yt: string, script: Record<string, unknown>) => ({
    id,
    lane: "news",
    youtube_video_id: yt,
    live_at: null,
    script_json: script,
  });
  const rows = [
    row("a", "SHORTLINK01", {
      headline: "x",
      cutdown: { parent_video: "LONGVIDEO01", funnel: "link" },
    }),
    row("b", "SHORTCTRL01", {
      headline: "y",
      cutdown: { parent_video: "LONGVIDEO01", funnel: "none" },
    }),
    row("c", "SHORTRANK01", {
      headline: "z",
      cutdown: { parent_video: "LONGRANK001" },
    }),
    row("d", "SHORTNEWS01", { headline: "GTA 6 news" }),
    row("e", "LONGVIDEO01", { runtime: "long" }),
  ];
  const older = [
    row("f", "SHORTOLD001", { headline: "old news" }),
    row("g", "SHORTOLD002", { headline: "old news 2" }),
  ];
  const plan = planFunnel(
    rows,
    longs,
    older,
    new Set(["SHORTNEWS01", "SHORTOLD001", "SHORTOLD002", "SHORTCTRL01"]),
    new Set(["SHORTOLD002"]),
  );
  assert.deepEqual(
    plan.map((p) => [p.action, p.short, p.target]),
    [
      ["set", "SHORTLINK01", "LONGVIDEO01"],
      ["set", "SHORTRANK01", "LONGRANK001"],
      ["clear", "SHORTCTRL01", ""],
      ["clear", "SHORTNEWS01", ""],
      ["clear", "SHORTOLD001", ""],
    ],
  );
  assert.equal(plan[0]!.targetTitle, longs[0]!.title);
});
