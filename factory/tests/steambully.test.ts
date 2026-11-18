import { test } from "node:test";
import assert from "node:assert/strict";
import { bestMatch } from "../src/assets/steam.ts";

test("a listing that is the game's name before a subtitle beats a longer-named different game", () => {
  const items = [
    { id: 12200, name: "Bully: Scholarship Edition", type: "app" },
    { id: 793600, name: "Bully Beatdown", type: "app" },
    { id: 2723540, name: "Bully Ball Soccer", type: "app" },
  ] as any;
  assert.equal(bestMatch("Bully", items)?.id, 12200);
  assert.equal(bestMatch("Bully", items.slice(1))?.id, 793600, "still matches when the real game is absent");
  const hades = [
    { id: 1, name: "Hades II Soundtrack", type: "app" },
    { id: 2, name: "Hades", type: "app" },
  ] as any;
  assert.equal(bestMatch("Hades", hades)?.id, 2);
});
