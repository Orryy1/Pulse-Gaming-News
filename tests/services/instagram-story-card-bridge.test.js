"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  generateStoryImagesForStories,
} = require("../../images_story");

test("Story cards use governed Instagram publish-pack copy and keep the legacy upload path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-story-card-bridge-"));
  try {
    const storyId = "story-governed";
    const artifactDir = path.join(root, "goal-proof", "batch", storyId);
    await fs.ensureDir(artifactDir);
    await fs.outputJson(path.join(artifactDir, "instagram_publish_pack.json"), {
      platform: "instagram_reels",
      cover_frame: {
        headline: "EXPANSE GAMEPLAY REVEAL",
        subject: "The Expanse: Osiris Reborn",
        source_label: "Xbox Wire",
      },
      story_poll_idea: "Does this change your watchlist?",
    });
    await fs.outputJson(path.join(artifactDir, "image_card_manifest.json"), {
      story_id: storyId,
      platforms: ["x", "instagram", "facebook"],
      headline: "THE EXPANSE GAME IS REAL",
    });

    const story = {
      id: storyId,
      approved: true,
      exported_path: `output/final/${storyId}.mp4`,
      title: "Old Generic Title That Should Not Drive The Card",
      flair: "News",
      downloaded_images: [],
    };

    const result = await generateStoryImagesForStories([story], {
      artifactRoot: path.join(root, "goal-proof", "batch"),
      outputDir: "output/stories",
      log: () => {},
      writePath: (relPath) => path.join(root, relPath),
      resolveExisting: async (relPath) => path.join(root, relPath),
    });

    assert.equal(result.generated, 1);
    assert.equal(story.story_image_path, `output${path.sep}stories${path.sep}${storyId}_story.png`);

    const svgPath = path.join(root, "output", "stories", `${storyId}_story.svg`);
    const pngPath = path.join(root, "output", "stories", `${storyId}_story.png`);
    assert.equal(await fs.pathExists(svgPath), true);
    assert.equal(await fs.pathExists(pngPath), true);

    const svg = await fs.readFile(svgPath, "utf8");
    assert.match(svg, /EXPANSE GAMEPLAY/);
    assert.match(svg, /REVEAL/);
    assert.match(svg, /Source: Xbox Wire/);
    assert.doesNotMatch(svg, /Old Generic Title/);
  } finally {
    await fs.remove(root).catch(() => {});
  }
});
