import { test } from "node:test";
import assert from "node:assert/strict";
import { layerName } from "../src/render/parallax.ts";

test("two chapters' igdb_5.jpg get different layer names", () => {
  const a = layerName("entry_0/assets/igdb_5.jpg");
  const b = layerName("entry_7/assets/igdb_5.jpg");
  assert.notEqual(a, b);
  assert.match(a, /^igdb_5_[0-9a-f]{10}$/);
});

test("the same picture always gets the same name, whichever slash it is written with", () => {
  assert.equal(layerName("entry_7/assets/igdb_5.jpg"), layerName("entry_7/assets/igdb_5.jpg"));
});
