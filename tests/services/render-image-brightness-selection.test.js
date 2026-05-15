"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const v = require("../../lib/render-input-validation");

function fakeSharpStats(byPath) {
  return (p) => ({
    async stats() {
      const value = byPath[p];
      if (value && value.__throw) throw value.__throw;
      return {
        channels: [
          { mean: value?.r ?? value?.mean ?? 0, stdev: value?.stdev ?? 0 },
          { mean: value?.g ?? value?.mean ?? 0, stdev: value?.stdev ?? 0 },
          { mean: value?.b ?? value?.mean ?? 0, stdev: value?.stdev ?? 0 },
        ],
      };
    },
  });
}

test("selectRenderImagesForBrightness: drops near-black images when enough bright images remain", async () => {
  const dark = "dark-hero.jpg";
  const brightA = "bright-a.jpg";
  const brightB = "bright-b.jpg";
  const brightC = "bright-c.jpg";

  const result = await v.selectRenderImagesForBrightness(
    [dark, brightA, brightB, brightC],
    {
      sharp: fakeSharpStats({
        [dark]: { mean: 8, stdev: 3 },
        [brightA]: { mean: 125, stdev: 18 },
        [brightB]: { mean: 92, stdev: 20 },
        [brightC]: { mean: 155, stdev: 24 },
      }),
      darkLumaThreshold: 24,
      minBrightImagesToDropDark: 3,
    },
  );

  assert.deepEqual(result.images, [brightA, brightB, brightC]);
  assert.equal(result.dropped.length, 1);
  assert.equal(result.dropped[0].path, dark);
  assert.equal(result.dropped[0].reason, "dark_low_luma");
});

test("selectRenderImagesForBrightness: demotes dark opener instead of dropping when the deck is thin", async () => {
  const dark = "dark-hero.jpg";
  const brightA = "bright-a.jpg";
  const brightB = "bright-b.jpg";

  const result = await v.selectRenderImagesForBrightness(
    [dark, brightA, brightB],
    {
      sharp: fakeSharpStats({
        [dark]: { mean: 9, stdev: 4 },
        [brightA]: { mean: 118, stdev: 16 },
        [brightB]: { mean: 94, stdev: 14 },
      }),
      darkLumaThreshold: 24,
      minBrightImagesToDropDark: 3,
    },
  );

  assert.deepEqual(result.images, [brightA, brightB, dark]);
  assert.deepEqual(result.dropped, []);
  assert.equal(result.demoted.length, 1);
  assert.equal(result.demoted[0].path, dark);
});

test("selectRenderImagesForBrightness: keeps all-dark decks intact", async () => {
  const darkA = "dark-a.jpg";
  const darkB = "dark-b.jpg";

  const result = await v.selectRenderImagesForBrightness([darkA, darkB], {
    sharp: fakeSharpStats({
      [darkA]: { mean: 8, stdev: 3 },
      [darkB]: { mean: 12, stdev: 4 },
    }),
    darkLumaThreshold: 24,
  });

  assert.deepEqual(result.images, [darkA, darkB]);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.demoted, []);
  assert.equal(result.reason, "all_images_dark_or_unscored");
});
