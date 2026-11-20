import { test } from "node:test";
import assert from "node:assert/strict";
import { dropFailedThemes } from "../src/pipeline.ts";

const names = (xs: { name: string }[]) => xs.map((x) => x.name);

test("a long-ranking topic that failed recently is left out of the next pick", () => {
  const list = [
    { name: "Half-Life" },
    { name: "Portal" },
    { name: "Fallout" },
    { name: "Ys" },
  ];
  assert.deepEqual(names(dropFailedThemes(list, ["Half-Life and Portal"])), [
    "Fallout",
    "Ys",
  ]);
});

test("whole words only, and nothing failed leaves the list alone", () => {
  const list = [{ name: "Ys" }, { name: "Days Gone" }];
  assert.deepEqual(names(dropFailedThemes(list, ["Days Gone"])), ["Ys"]);
  assert.equal(dropFailedThemes(list, []), list);
});

test("a picked theme that renames a failed topic is swapped for the top clean candidate", async () => {
  const { avoidFailedTheme } = await import("../src/pipeline.ts");
  const cands = [{ name: "Half-Life" }, { name: "Fallout" }, { name: "Ys" }] as any;
  const picked = { candidate_index: 0, format: "ranking", theme: "Valve's Half-Life and Portal games", title_idea: "x", criterion: "y", reason: "z" } as any;
  const out = avoidFailedTheme(picked, cands, ["Half-Life and Portal"], ["Every Fallout Game Ranked"]);
  assert.equal(out?.theme, "Ys");
  assert.equal(out?.candidate_index, 2);
  const fine = { ...picked, theme: "Metroid" };
  assert.equal(avoidFailedTheme(fine, cands, ["Half-Life and Portal"], []), fine);
  assert.equal(avoidFailedTheme(picked, [{ name: "Portal" }] as any, ["Half-Life and Portal"], []), undefined);
  // The picker's own clean candidate is kept when only its theme overlapped.
  assert.equal(avoidFailedTheme({ ...picked, candidate_index: 1 }, cands, ["Half-Life and Portal"], [])?.theme, "Fallout");
});

test("a failed theme stored with a bracketed description still matches the shorter names it came back under (20 Nov)", () => {
  const failed = ["Half-Life and Portal (Valve's shared universe: Half-Life, Portal and the episodes)"];
  const list = [{ name: "Half-Life and Portal" }, { name: "Valve's Half-Life and Portal games" }, { name: "Fallout" }];
  assert.deepEqual(dropFailedThemes(list, failed).map((c) => c.name), ["Fallout"]);
});
