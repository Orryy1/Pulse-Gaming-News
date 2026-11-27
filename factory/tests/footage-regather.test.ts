import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// 26 Nov 2026: GTA VI File #3 met the footage gate on its third try; the regather threw, which spent the last of
// MAX_ATTEMPTS, so the Short gave up before its richer plan was ever made and the 18:30 slot went empty.
test("the footage gate's richer gathering does not spend an attempt", () => {
  const src = fs.readFileSync(new URL("../src/pipeline.ts", import.meta.url), "utf8");
  const start = src.indexOf('if (verdict === "regather") {');
  assert.ok(start > 0, "regather branch found");
  const branch = src.slice(start, src.indexOf("\n    }", start));
  assert.doesNotMatch(branch, /^\s*throw /m, "a throw goes through recordFailure and counts as an attempt");
  assert.match(branch, /next_attempt_at = \$3/, "it is due again on the next pass");
  assert.match(branch, /^\s*return;/m);
  assert.doesNotMatch(branch, /attempts\s*=/, "attempts are left as they were");
});
