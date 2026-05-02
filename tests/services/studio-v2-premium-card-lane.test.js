"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const { SCENE_TYPES } = require("../../lib/scene-composer");
const {
  applyPremiumCardLaneV2,
  resolveCardAssetsV2,
} = require("../../lib/studio/v2/premium-card-lane-v2");

function cardScenes() {
  return [
    { type: SCENE_TYPES.CARD_SOURCE, label: "card_source", duration: 4 },
    { type: SCENE_TYPES.CARD_STAT, label: "card_context", duration: 4 },
    { type: SCENE_TYPES.CARD_QUOTE, label: "card_quote", duration: 4 },
    { type: SCENE_TYPES.CARD_TAKEAWAY, label: "card_takeaway", duration: 4 },
    { type: SCENE_TYPES.CARD_TIMELINE, label: "card_timeline", duration: 4 },
  ];
}

test("premium card lane v2 refuses generic HyperFrames cards by default", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-generic-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    for (const kind of ["source", "context", "quote", "takeaway", "timeline"]) {
      await fs.writeFile(path.join(outDir, `hf_${kind}_card_v1.mp4`), "generic");
    }

    const assets = resolveCardAssetsV2(root, "story-1", "pulse-gaming");
    assert.equal(assets.source.path, null);
    assert.equal(assets.source.source, null);

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.hyperframesCardCount, 0);
    assert.equal(result.premiumLane.storySpecificCardCount, 0);
    assert.equal(result.premiumLane.verdict, "thin");
    assert.ok(result.scenes.every((scene) => !scene.prerenderedMp4));
    assert.ok(
      result.premiumLane.decisions.every(
        (decision) => decision.renderer === "ffmpeg-fallback",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});

test("premium card lane v2 attaches only story-specific cards", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-hf-story-"));
  try {
    const outDir = path.join(root, "test", "output");
    await fs.ensureDir(outDir);
    await fs.writeFile(path.join(outDir, "hf_source_card_story-1.mp4"), "story");
    await fs.writeFile(path.join(outDir, "hf_context_card_story-1.mp4"), "story");

    const result = applyPremiumCardLaneV2({
      scenes: cardScenes(),
      story: { id: "story-1", title: "Pokemon Go" },
      root,
      channelId: "pulse-gaming",
    });

    assert.equal(result.premiumLane.hyperframesCardCount, 2);
    assert.equal(result.premiumLane.storySpecificCardCount, 2);
    assert.equal(result.premiumLane.verdict, "partial");
    assert.ok(
      result.scenes.some((scene) =>
        String(scene.prerenderedMp4 || "").endsWith("hf_source_card_story-1.mp4"),
      ),
    );
    assert.ok(
      result.premiumLane.decisions.some(
        (decision) => decision.cardSource === "story-specific",
      ),
    );
  } finally {
    await fs.remove(root).catch(() => {});
  }
});
