import { test } from "node:test";
import assert from "node:assert/strict";
import { trendingBlock } from "../src/discovery/demand.ts";

test("the trending block lists the biggest videos first and is empty without data", () => {
  assert.equal(trendingBlock([]), "");
  const block = trendingBlock([
    { title: "Minecraft but every block is TNT", views: 2_000_000, channel: "y" },
    { title: "GTA 6 - Official Trailer 3", views: 9_000_000, channel: "Rockstar" },
    { title: "I played Saros for 40 hours", views: 300_000, channel: "x" },
  ]);
  const lines = block.split("\n").slice(1);
  assert.deepEqual(lines, ["- 9.0M views: GTA 6 - Official Trailer 3", "- 2.0M views: Minecraft but every block is TNT", "- 300K views: I played Saros for 40 hours"]);
});
