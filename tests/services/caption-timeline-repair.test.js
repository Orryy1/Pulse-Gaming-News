"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairCaptionTimeline,
  srtLastEndSeconds,
} = require("../../lib/caption-timeline-repair");

async function makeArtifact() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "caption-timeline-repair-"));
  const artifactDir = path.join(root, "rss_story");
  await fs.ensureDir(path.join(artifactDir, "audio"));
  await fs.ensureDir(path.join(artifactDir, "platform_variants", "instagram_reels"));
  const words = [
    { word: "MARVEL", start: 0, end: 0.34 },
    { word: "Tokon", start: 0.36, end: 0.74 },
    { word: "finally", start: 1.2, end: 1.8 },
    { word: "has", start: 2.0, end: 2.2 },
    { word: "a", start: 2.3, end: 2.4 },
    { word: "real", start: 3.1, end: 3.55 },
    { word: "test.", start: 4.0, end: 4.42 },
    { word: "Follow", start: 43.2, end: 43.62 },
    { word: "Pulse", start: 43.9, end: 44.25 },
    { word: "Gaming", start: 44.3, end: 44.74 },
    { word: "so", start: 44.8, end: 44.98 },
    { word: "you", start: 45.02, end: 45.18 },
    { word: "never", start: 45.2, end: 45.42 },
    { word: "miss", start: 45.43, end: 45.54 },
    { word: "a", start: 45.55, end: 45.58 },
    { word: "beat.", start: 45.59, end: 45.62 },
  ];
  await fs.writeJson(path.join(artifactDir, "audio", "word_timestamps.json"), { words }, { spaces: 2 });
  await fs.writeFile(
    path.join(artifactDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:12,000\nOld truncated captions.\n",
    "utf8",
  );
  await fs.writeFile(
    path.join(artifactDir, "platform_variants", "instagram_reels", "captions_instagram_reels.srt"),
    "1\n00:00:00,000 --> 00:00:12,000\nOld truncated captions.\n",
    "utf8",
  );
  await fs.writeJson(path.join(artifactDir, "platform_publish_manifest.json"), {
    story_id: "rss_story",
    outputs: {
      instagram_reels: {
        platform_variant_render: {
          output_path: path.join(artifactDir, "platform_variants", "instagram_reels", "visual_v4_render_instagram_reels.mp4"),
          captions_path: path.join(artifactDir, "platform_variants", "instagram_reels", "captions_instagram_reels.srt"),
          duration_s: 44,
        },
      },
    },
  }, { spaces: 2 });
  return { root, artifactDir };
}

test("caption timeline repair rebuilds base and platform variant SRTs from word timestamps", async (t) => {
  const { root, artifactDir } = await makeArtifact();
  t.after(() => fs.remove(root));

  const report = await repairCaptionTimeline({
    artifactDir,
    storyId: "rss_story",
    apply: true,
    generatedAt: "2026-07-03T10:15:00.000Z",
  });

  const baseSrt = await fs.readFile(path.join(artifactDir, "captions.srt"), "utf8");
  const instagramSrt = await fs.readFile(
    path.join(artifactDir, "platform_variants", "instagram_reels", "captions_instagram_reels.srt"),
    "utf8",
  );
  const captionManifest = await fs.readJson(path.join(artifactDir, "caption_manifest.json"));

  assert.equal(report.blockers.length, 0);
  assert.ok(srtLastEndSeconds(baseSrt) > 45);
  assert.ok(srtLastEndSeconds(instagramSrt) <= 44);
  assert.ok(srtLastEndSeconds(instagramSrt) > 43);
  assert.match(baseSrt, /Follow Pulse Gaming so you never miss a beat\./);
  assert.equal(captionManifest.caption_generator, "caption_timeline_repair_word_timed_srt");
  assert.equal(captionManifest.word_count, 16);
  assert.equal(captionManifest.safety.no_publish_triggered, true);
  assert.equal(captionManifest.safety.no_db_mutation, true);
});
