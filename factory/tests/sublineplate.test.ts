import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 25 Nov: the highlight card's white subline had no backing and failed QA three times on a bright sky.
test("the highlight card's subline sits on a dark plate", () => {
  const src = readFileSync(new URL("../src/render/components/Overlays.tsx", import.meta.url), "utf8");
  const at = src.indexOf("data-subline-plate");
  assert.ok(at > 0, "subline plate marker present");
  const block = src.slice(at, at + 600);
  assert.match(block, /background: "rgba\(11, 11, 14, 0\.78\)"/);
  assert.match(block, /textShadow/);
  assert.match(block, /boxDecorationBreak: "clone"/);
});
