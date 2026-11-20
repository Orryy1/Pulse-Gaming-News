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
