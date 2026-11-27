import { test } from "node:test";
import assert from "node:assert/strict";
import { gameFirstShortTitle } from "../src/strandframe.ts";

test("game-first Short titles: casing follows the title, sequels are never reworded", () => {
  assert.equal(gameFirstShortTitle("Why GTA 6 Costs $80", "Grand Theft Auto VI", "GTA 6"), "GTA 6: Why It Costs $80");
  assert.equal(
    gameFirstShortTitle("Why GTA 6's radio keeps playing outside the car", "Grand Theft Auto VI", "GTA 6"),
    "GTA 6: Why its radio keeps playing outside the car",
  );
  const bully = gameFirstShortTitle("Why Bully 2's canceled plans shouldn't keep you waiting", "Bully", "Bully");
  assert.ok(!/Why It 2/i.test(bully), bully);
  assert.ok(!/\bIt 2\b/.test(bully), bully);
});
