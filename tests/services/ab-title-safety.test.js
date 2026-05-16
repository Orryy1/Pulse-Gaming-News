"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cleanTitleVariant,
  fallbackTitleVariants,
} = require("../../ab_titles");

test("cleanTitleVariant rejects clickbait YouTube title shapes", () => {
  assert.equal(cleanTitleVariant("Horizon 6 Shatters Records?! (You Won't Believe This)"), "");
  assert.equal(cleanTitleVariant("130,000 Players?! Forza 6's Massive Launch Explained"), "");
  assert.equal(cleanTitleVariant("Forza 6 Is Breaking Records?!"), "");
  assert.equal(cleanTitleVariant("Forza 6 Just Beat Horizon 5"), "Forza 6 Just Beat Horizon 5");
});

test("fallbackTitleVariants returns safe Forza alternatives", () => {
  const variants = fallbackTitleVariants({
    title:
      "Forza Horizon 6 immediately beats its predecessor's all-time Steam record with 130,000 concurrent players",
  }, "Forza Horizon 6");

  assert.deepEqual(variants, ["Forza 6 Just Beat Horizon 5", "Forza 6's Steam Record"]);
});
