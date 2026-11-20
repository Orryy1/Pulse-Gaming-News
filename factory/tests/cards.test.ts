import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePairs, parseMilestones, platformColour } from "../src/render/components/cards/helpers.ts";
import { validateScript } from "../src/editorial/editorial.ts";
import { goodScript } from "./helpers.ts";

test("pairs keep text values and mark the subject", () => {
  assert.deepEqual(parsePairs(["*PS5 Pro:16.7 TF", "PS5:10.3 TF", "junk", "Storage:"]), [
    { label: "PS5 Pro", value: "16.7 TF", highlight: true },
    { label: "PS5", value: "10.3 TF", highlight: false },
  ]);
  assert.equal(parsePairs(["CPU:8-core Zen 6", "GPU:RDNA 5", "RAM:16GB", "SSD:2TB", "Price:$599", "Out:2027", "Extra:x"]).length, 6);
});

test("milestones sort oldest first and need ISO dates", () => {
  assert.deepEqual(parseMilestones(["2026-11-19:Launch", "2023-12:Trailer 1", "2022-02:Announced", "soon:Patch"]), [
    { date: "2022-02", label: "Announced" },
    { date: "2023-12", label: "Trailer 1" },
    { date: "2026-11-19", label: "Launch" },
  ]);
});

test("platform chips take their family colour", () => {
  assert.equal(platformColour("PS5"), "#0B5ED7");
  assert.equal(platformColour("Xbox Series X|S"), "#107C10");
  assert.equal(platformColour("Switch 2"), "#E60012");
  assert.equal(platformColour("Steam Deck"), "#1A9FFF");
  assert.equal(platformColour("PC"), "#2A3F5A");
});

test("the validator checks the new cards' data", () => {
  const s = goodScript();
  const withBeat = (visual: any) => ({ ...s, beats: [{ ...s.beats[0]!, visual }, ...s.beats.slice(1)] });
  const problems = (visual: any) => validateScript(withBeat(visual) as any).join(" ");
  assert.match(problems({ kind: "versus", primary: "New against old", secondary: "", items: ["*PS5 Pro:16.7 TF"] }), /Versus card/);
  assert.match(problems({ kind: "milestones", primary: "Long road", secondary: "", items: ["2022-02:Announced"] }), /Milestones card/);
  assert.match(problems({ kind: "platforms", primary: "Out on", secondary: "", items: [] }), /Platforms card/);
  assert.doesNotMatch(problems({ kind: "specs", primary: "Inside the box", secondary: "", items: ["CPU:8-core", "GPU:RDNA 5"] }), /Specs card/);
});

import { fitHeadline, headlineLines, sourceLine } from "../src/render/layout.ts";

test("headlines shrink to stay inside the hero band; the source line keeps to three outlets", () => {
  const words = "SAMSON DEVELOPER LIQUID SWORDS GOES BANKRUPT".split(" ");
  const size = fitHeadline(words, [132, 112, 96, 84, 72]);
  assert.ok(size < 132, `size ${size}`);
  assert.ok(headlineLines(words, size) * size * 1.02 <= 490);
  assert.equal(fitHeadline("GTA 6 DELAYED".split(" "), [132, 112]), 132);
  assert.equal(sourceLine("Source: IGN, Eurogamer, VGC, Steam, Polygon"), "IGN, EUROGAMER, VGC +2");
  assert.equal(sourceLine("Source: Steam / Pulse"), "STEAM, PULSE");
});
