import { test } from "node:test";
import assert from "node:assert/strict";

import { usefulGraphic, usefulEmphasis } from "../src/render/longplan.ts";

test("rank graphics and fragment captions are left out", () => {
  assert.equal(usefulGraphic({ kind: "stat", primary: "FIVE", secondary: "where it lands on the list" }), false);
  assert.equal(usefulGraphic({ kind: "stat", primary: "7", secondary: "ranking position" }), false);
  assert.equal(usefulGraphic({ kind: "date", primary: "November 2009", secondary: "Modern Warfare 2 release" }), true);
  assert.equal(usefulGraphic({ kind: "score", primary: "94", secondary: "Metacritic" }), true);
  assert.equal(usefulEmphasis("SERIES AT"), false);
  assert.equal(usefulEmphasis("Captain Price"), true);
  assert.equal(usefulEmphasis("the Numbers"), false);
});
