// The explainer guard against the ways a writer could slip invented content past it (read-only review, 20 Nov 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { goodScript } from "./helpers.ts";
import {
  buildProblem,
  figuresIn,
  groundExplainer,
  haystackOf,
  saidTogether,
} from "../src/render/components/explainers/ground.ts";
import {
  flowCardHeight,
  layoutProblems,
  visibleCrop,
} from "../src/render/components/explainers/layout.ts";
import type { Explainer } from "../src/render/components/explainers/types.ts";
import { placeAnatomy } from "../src/assets/anatomy.ts";
import { shortLines } from "../src/editorial/explainers.ts";
import { chooseFillers } from "../src/assets/fillers.ts";
import { anatomyPictures, explainerTexts } from "../src/explainerstep.ts";

const LINE =
  "The standard edition is £69.99 and the deluxe edition adds £20, and online play is required.";
const ctx = { line: LINE, texts: [], orientation: "tall" as const };
const kept = (e: Explainer) => groundExplainer(e, ctx).explainer !== undefined;

test("explainer guard: a figure keeps its currency and percent", () => {
  assert.ok(figuresIn("£69.99 and twenty dollars and 20%").has("£69.99"));
  assert.ok(figuresIn("twenty dollars").has("$20"));
  assert.ok(figuresIn("20%").has("20%"));
  assert.ok(
    !kept({
      type: "versus",
      title: "",
      items: [
        { label: "Standard", value: "$69.99" },
        { label: "Deluxe", value: "£20" },
      ],
    }),
    "pounds became dollars",
  );
  assert.ok(
    !kept({
      type: "howmuch",
      title: "",
      items: [
        { label: "Standard", value: "£69.99" },
        { label: "Deluxe", value: "+20%" },
      ],
    }),
    "20 became 20%",
  );
});

test("explainer guard: a label and its figure must be said together", () => {
  assert.ok(
    !kept({
      type: "versus",
      title: "",
      items: [
        { label: "Standard", value: "£20" },
        { label: "Deluxe", value: "£69.99" },
      ],
    }),
  );
  assert.ok(saidTogether("Standard", "£69.99", [LINE]));
  assert.ok(
    !saidTogether("Standard", "£69.99", [
      "The standard edition is out.",
      "It costs £69.99.",
    ]),
  );
});

test("explainer guard: negations, two-letter words and unreadable labels are checked", () => {
  assert.ok(
    !kept({
      type: "steps",
      title: "",
      items: [{ label: "No online play" }, { label: "Not required" }],
    }),
  );
  assert.ok(
    !kept({
      type: "steps",
      title: "",
      items: [{ label: "Online play" }, { label: "Required in UK" }],
    }),
  );
  assert.ok(
    !kept({
      type: "steps",
      title: "",
      items: [{ label: "オンライン" }, { label: "Online play" }],
    }),
  );
  assert.ok(
    kept({
      type: "steps",
      title: "",
      items: [{ label: "Standard edition" }, { label: "Online play required" }],
    }),
  );
});

test("explainer guard: a price build shows only totals the text states", () => {
  const hay = haystackOf(["It was $70 and rose by $10.", "It now costs $80."]);
  assert.equal(
    buildProblem(["$70", "+$10"], hay),
    undefined,
    "the reached $80 is stated",
  );
  assert.match(
    buildProblem(["$70", "+$10"], haystackOf(["It was $70 and rose by $10."]))!,
    /never stated/,
  );
  assert.match(buildProblem(["$70", "+20%"], hay)!, /percentage/);
  assert.match(buildProblem(["$70", "£10"], hay)!, /mix currencies/);
  assert.match(buildProblem(["$70", "+$10", "$90"], hay)!, /make 80, not 90/);
  assert.match(
    buildProblem(["$70", "$80", "+$10"], hay)!,
    /\$90\) is never stated/,
  );
});

test("explainer guard: anatomy points outside the board's crop are not shown", async () => {
  const crop = visibleCrop(16 / 9, "tall");
  assert.ok(crop.x0 > 0.1 && crop.x1 < 0.9);
  const e: Explainer = {
    type: "anatomy",
    title: "",
    items: [{ label: "Phone" }, { label: "Car" }],
  };
  const edge = {
    parts: [
      { n: 1, visible: true, x: 60, y: 500 },
      { n: 2, visible: true, x: 500, y: 500 },
    ],
  };
  assert.equal(
    await placeAnatomy(
      e,
      [{ file: "a", src: "a.jpg", aspect: 16 / 9 }],
      "G",
      async () => edge,
    ),
    undefined,
  );
  const wide = await placeAnatomy(
    e,
    [{ file: "a", src: "a.jpg", aspect: 16 / 9 }],
    "G",
    async () => ({
      parts: [
        { n: 1, visible: true, x: 300, y: 100 },
        { n: 2, visible: true, x: 700, y: 500 },
      ],
    }),
    undefined,
    { orientation: "wide" },
  );
  assert.equal(
    wide,
    undefined,
    "the wide board crops a 16:9 picture top and bottom: a point at y 0.1 is off the board",
  );
});

test("explainer guard: a failing vision model ends the search at once", async () => {
  let calls = 0;
  const e: Explainer = {
    type: "anatomy",
    title: "",
    items: [{ label: "Phone" }, { label: "Car" }],
  };
  const out = await placeAnatomy(
    e,
    [
      { file: "a", src: "a" },
      { file: "b", src: "b" },
    ],
    "G",
    async () => {
      calls++;
      throw new Error("timeout");
    },
  );
  assert.equal(out, undefined);
  assert.equal(calls, 1);
});

test("explainer guard: the take keeps its verdict card; only game screenshots near 16:9 take callouts", () => {
  const lines = shortLines(goodScript());
  assert.equal(lines.at(-2)!.part, undefined);
  const pics = anatomyPictures(
    [
      { file: "hero.jpg", kind: "hero", aspect: 3.2 },
      { file: "s.jpg", kind: "screenshot", aspect: 1.78 },
      { file: "p.jpg", kind: "person", aspect: 1.78 },
      { file: "k.jpg", kind: "sketch", aspect: 1.78 },
    ],
    "/ep",
  );
  assert.deepEqual(
    pics.map((p) => p.src),
    ["s.jpg"],
  );
  assert.ok(
    explainerTexts({
      type: "howmuch",
      title: "T",
      items: [{ label: "A", value: "$1" }],
    }).includes("HOW IT ADDS UP"),
  );
});

test("explainer guard: stacked cards fit their labels in height, and switched off nothing is chosen", () => {
  const four: Explainer = {
    type: "steps",
    title: "Very long heading that wraps onto two lines here",
    items: [
      { label: "Alternate entrances everywhere" },
      { label: "Crowds" },
      { label: "Smoke bombs" },
      { label: "Reach the target" },
    ],
  };
  const h = flowCardHeight("steps", "tall", 4, four.title)!;
  assert.ok(h < 120);
  for (const p of layoutProblems(four, "tall")) assert.match(p, /two lines/);
  const e: Explainer = {
    type: "steps",
    title: "",
    items: [{ label: "A" }, { label: "B" }],
  };
  const chapters = [
    {
      entry: 0,
      game: "G",
      sentences: ["One.", "Two.", "Three."],
      moments: [{ show: "x" }, { show: "y", explainer: e }, { show: "z" }],
    },
  ];
  const off = chooseFillers(chapters, { images: [], clips: [], seed: 1 });
  assert.ok(!off.picks.some((p) => p.filler.family === "explainer"));
  const on = chooseFillers(chapters, {
    images: [],
    clips: [],
    seed: 1,
    explainers: true,
  });
  assert.ok(on.picks.some((p) => p.filler.family === "explainer"));
});

test("explainer guard: never over the hook, and a window too short to read keeps the card", async () => {
  const { shortExplainer, EXPLAINER_HOOK_SECONDS } = await import("../src/render/components/explainers/ground.ts");
  const e: Explainer = { type: "steps", title: "", items: [{ label: "A" }, { label: "B" }] };
  const early = shortExplainer(e, [], { start: 0, end: 150 }, 30)!;
  assert.equal(early.from, EXPLAINER_HOOK_SECONDS * 30);
  assert.equal(shortExplainer(e, [], { start: 0, end: 70 }, 30), undefined);
  assert.equal(shortExplainer(undefined, [], { start: 90, end: 300 }, 30), undefined);
});
