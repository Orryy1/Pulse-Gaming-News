"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { buildMediaInventory } = require("../../lib/studio/v2/story-package");

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("buildMediaInventory reads topical media from MEDIA_ROOT", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-v2-media-root-"));
  const storyId = "story-v2-media";
  const oldMediaRoot = process.env.MEDIA_ROOT;
  const repoRoot = path.resolve(__dirname, "..", "..");
  const staleRepoClip = path.join(
    repoRoot,
    "output",
    "video_cache",
    `${storyId}_yt_stale.mp4`,
  );
  process.env.MEDIA_ROOT = tmp;

  try {
    const imageDir = path.join(tmp, "output", "image_cache");
    await fs.ensureDir(imageDir);
    await fs.writeFile(path.join(imageDir, `${storyId}_article.jpg`), "fake");

    if (hasFfmpeg()) {
      const videoDir = path.join(tmp, "output", "video_cache");
      await fs.ensureDir(videoDir);
      await fs.ensureDir(path.dirname(staleRepoClip));
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=black:s=16x16:d=0.2",
          "-pix_fmt",
          "yuv420p",
          path.join(videoDir, `${storyId}_yt_fixture.mp4`),
        ],
        { stdio: "ignore" },
      );
      execFileSync(
        "ffmpeg",
        [
          "-y",
          "-f",
          "lavfi",
          "-i",
          "color=c=red:s=16x16:d=0.2",
          "-pix_fmt",
          "yuv420p",
          staleRepoClip,
        ],
        { stdio: "ignore" },
      );
    } else {
      t.diagnostic("ffmpeg/ffprobe missing; video clip assertion skipped");
    }

    const inventory = await buildMediaInventory(storyId);

    assert.equal(inventory.articleHeroes.length, 1);
    assert.equal(inventory.articleHeroes[0].source, "article-hero");
    if (hasFfmpeg()) {
      assert.equal(inventory.trailerClips.length, 1);
      assert.equal(inventory.trailerClips[0].source, "story-video-clip");
      assert.match(inventory.trailerClips[0].path, /_yt_fixture\.mp4$/);
    }
  } finally {
    if (oldMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = oldMediaRoot;
    await fs.remove(staleRepoClip).catch(() => {});
    await fs.remove(tmp).catch(() => {});
  }
});
