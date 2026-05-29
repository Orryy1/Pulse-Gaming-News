"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  selectVariantAsset,
  variantAssetsForRole,
} = require("../../lib/audio-identity");

test("audio identity variants keep the default asset first and dedupe alternates", () => {
  const pack = {
    id: "pulse-gaming-epidemic-v1",
    root_path: "audio/epidemic",
    assets: [
      { role: "bed_primary", filename: "music/bed_primary/default.wav" },
    ],
    variants: {
      bed_primary: [
        { role: "bed_primary", filename: "music/bed_primary/default.wav" },
        { role: "bed_primary", filename: "music/bed_primary/second.wav" },
      ],
    },
  };

  const variants = variantAssetsForRole(pack, "bed_primary");

  assert.deepEqual(variants.map((asset) => asset.filename), [
    "music/bed_primary/default.wav",
    "music/bed_primary/second.wav",
  ]);
});

test("audio identity variant selection is deterministic per story seed", () => {
  const pack = {
    id: "pulse-gaming-epidemic-v1",
    root_path: "audio/epidemic",
    variants: {
      bed_primary: [
        { role: "bed_primary", filename: "music/bed_primary/a.wav" },
        { role: "bed_primary", filename: "music/bed_primary/b.wav" },
        { role: "bed_primary", filename: "music/bed_primary/c.wav" },
      ],
    },
  };

  const first = selectVariantAsset(pack, "bed_primary", { seed: "story-alpha" });
  const second = selectVariantAsset(pack, "bed_primary", { seed: "story-alpha" });
  const unseeded = selectVariantAsset(pack, "bed_primary");

  assert.equal(first.filename, second.filename);
  assert.ok(path.basename(first.filename).match(/^[abc]\.wav$/));
  assert.equal(unseeded.filename, "music/bed_primary/a.wav");
  assert.equal(first.selection_strategy, "story_id_hash");
});
