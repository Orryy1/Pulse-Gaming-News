import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("no stray backspace characters in source files", () => {
  for (const f of ["src/sceneindex/spoilers.ts", "src/voice/speakable.ts"]) {
    assert.equal(fs.readFileSync(f, "utf8").includes("\u0008"), false, f);
  }
});
