"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  cleanTitleVariant,
  fallbackTitleVariants,
  getBestTitle,
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

test("getBestTitle repairs raw Mixtape article headlines before upload", () => {
  const title = getBestTitle({
    title:
      "Mixtape will be safe from a music licensing related delisting, ensured by its developer paying extra for the privilege",
    full_script:
      "Mixtape just dodged one of gaming's most annoying problems. Licensed music can make games disappear later.",
  });

  assert.equal(title, "Mixtape Dodged Gaming's Delisting Trap");
});

test("getBestTitle repairs raw Bullet Heaven headlines before upload", () => {
  const title = getBestTitle({
    title:
      "It's official: Steam decrees 'bullet heaven' the name of the Vampire Survivors genre",
    full_script:
      "Steam just gave the Vampire Survivors genre a name players can actually search for.",
  });

  assert.equal(title, "Steam Named Vampire Survivors' Genre");
});
