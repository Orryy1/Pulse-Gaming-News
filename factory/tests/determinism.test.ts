import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

// The composition must be a pure function of the frame and its props: no clock,
// no randomness, no network, no model calls. Anything else makes a retried
// render differ from the first and the plan impossible to reason about.
const FILES = ["Short.tsx", "timeline.ts", "plan.ts", "props.ts", "brand.ts", "layout.ts", "motion.ts", "components/Background.tsx", "components/Overlays.tsx", "components/Shelf.tsx"];
const BANNED = [/Math\.random\(/, /Date\.now\(/, /new Date\(/, /performance\.now\(/, /\bfetch\(/, /from "node:/, /anthropic/i, /backdropFilter/, /filter:\s*["'`][^"'`]*blur\(/];

test("the composition stays deterministic and free of live blurs", async () => {
  const dir = path.join(import.meta.dirname, "..", "src", "render");
  for (const f of FILES) {
    const src = await fs.readFile(path.join(dir, f), "utf8");
    for (const re of BANNED) assert.doesNotMatch(src, re, `${f} matches ${re}`);
  }
});
