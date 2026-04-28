"use strict";

const cp = require("node:child_process");
const fs = require("fs-extra");
const path = require("node:path");
const {
  buildTikTokDispatchManifest,
  renderTikTokDispatchMarkdown,
} = require("../lib/platforms/tiktok-dispatch");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test", "output");

function probeDurationSeconds(story) {
  if (!story?.exported_path) return null;
  const candidate = path.isAbsolute(story.exported_path)
    ? story.exported_path
    : path.join(ROOT, story.exported_path);
  if (!fs.existsSync(candidate)) return null;
  try {
    const raw = cp.execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        candidate,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const parsed = Number(String(raw || "").trim());
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
  } catch (_) {
    return null;
  }
}

async function main() {
  await fs.ensureDir(OUT);
  const stories = await require("../lib/db").getStories();
  const durationByStoryId = Object.fromEntries(
    stories.map((story) => [story.id, probeDurationSeconds(story)]),
  );
  const manifest = buildTikTokDispatchManifest(stories, { durationByStoryId });
  const jsonPath = path.join(OUT, "tiktok_dispatch_manifest.json");
  const mdPath = path.join(OUT, "tiktok_dispatch_manifest.md");
  const queuePath = path.join(OUT, "tiktok_dispatch_queue.json");
  const discordPath = path.join(OUT, "tiktok_dispatch_discord_sample.txt");
  await fs.writeJson(jsonPath, manifest, { spaces: 2 });
  await fs.writeJson(
    queuePath,
    {
      generatedAt: manifest.generatedAt,
      routePriority: manifest.routePriority,
      items: manifest.queue,
    },
    { spaces: 2 },
  );
  await fs.writeFile(mdPath, renderTikTokDispatchMarkdown(manifest), "utf8");
  await fs.writeFile(
    discordPath,
    `${manifest.sampleDiscordNotification || "No TikTok dispatch candidate ready."}\n`,
    "utf8",
  );
  console.log(`[tiktok-dispatch] packs=${manifest.count}`);
  console.log(`[tiktok-dispatch] json=${path.relative(ROOT, jsonPath)}`);
  console.log(`[tiktok-dispatch] queue=${path.relative(ROOT, queuePath)}`);
  console.log(`[tiktok-dispatch] md=${path.relative(ROOT, mdPath)}`);
  console.log(`[tiktok-dispatch] discord=${path.relative(ROOT, discordPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
