"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { discoverLocalStudioMedia } = require("../../lib/studio/media-acquisition");

function hasFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

test("discoverLocalStudioMedia: prefers MEDIA_ROOT output cache when configured", async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-studio-media-"));
  const repoRoot = path.join(tmp, "repo");
  const mediaRoot = path.join(tmp, "media");
  const storyId = "story-media-root";
  const article = path.join(mediaRoot, "output", "image_cache", `${storyId}_article.jpg`);
  const clip = path.join(mediaRoot, "output", "video_cache", `${storyId}_yt_fixture.mp4`);
  const staleRepoClip = path.join(repoRoot, "output", "video_cache", `${storyId}_yt_stale.mp4`);
  await fs.ensureDir(path.dirname(article));
  await fs.ensureDir(path.dirname(clip));
  await fs.ensureDir(path.dirname(staleRepoClip));
  await fs.writeFile(article, Buffer.from("fake"));
  const canMakeClip = hasFfmpeg();
  if (canMakeClip) {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=16x16:d=0.5",
        "-pix_fmt",
        "yuv420p",
        clip,
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
        "color=c=red:s=16x16:d=0.5",
        "-pix_fmt",
        "yuv420p",
        staleRepoClip,
      ],
      { stdio: "ignore" },
    );
  } else {
    t.diagnostic("ffmpeg/ffprobe missing; clip assertion skipped");
  }

  const oldMediaRoot = process.env.MEDIA_ROOT;
  process.env.MEDIA_ROOT = mediaRoot;
  try {
    const media = await discoverLocalStudioMedia({ root: repoRoot, storyId });
    assert.equal(media.articleHeroes.length, 1);
    assert.equal(media.articleHeroes[0].path, article);
    if (canMakeClip) {
      assert.equal(media.clips.length, 1);
      assert.equal(media.clips[0].path, clip);
      assert.ok(!media.clips.some((item) => item.path === staleRepoClip));
      assert.equal(media.trailerPath, clip);
    }
  } finally {
    if (oldMediaRoot === undefined) delete process.env.MEDIA_ROOT;
    else process.env.MEDIA_ROOT = oldMediaRoot;
    await fs.remove(tmp).catch(() => {});
  }
});
