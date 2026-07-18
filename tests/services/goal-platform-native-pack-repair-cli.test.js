"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { main, parseArgs } = require("../../tools/goal-platform-native-pack-repair");

async function writeRepairableStory(artifactDir, storyId, title) {
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_subject: title,
    canonical_angle: "release timing gives players a concrete reason to care",
    selected_title: `${title} Gets A Real Player Test`,
    thumbnail_headline: `${title} PLAYER TEST`,
    first_spoken_line: `${title} finally has a player-facing reason to pay attention.`,
    primary_source: "Eurogamer",
  });
  await fs.writeJson(path.join(artifactDir, "landing_page_manifest.json"), {
    landing_page_slug: `${storyId}-landing`,
  });
}

test("platform-native pack repair CLI can apply to one selected story id", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-native-repair-cli-"));
  const storyOneDir = path.join(root, "story-one");
  const storyTwoDir = path.join(root, "story-two");
  await writeRepairableStory(storyOneDir, "story-one", "Hellraiser Revival");
  await writeRepairableStory(storyTwoDir, "story-two", "Cyberpunk 2077");
  const storyPackagesPath = path.join(root, "story-packages.json");
  await fs.writeJson(storyPackagesPath, [
    { story_id: "story-one", artifact_dir: storyOneDir },
    { story_id: "story-two", artifact_dir: storyTwoDir },
  ]);

  const { report } = await main([
    "--story-packages",
    storyPackagesPath,
    "--story-id",
    "story-one",
    "--out-dir",
    path.join(root, "out"),
    "--backup-root",
    path.join(root, "backups"),
    "--generated-at",
    "2026-06-22T01:40:00.000Z",
    "--apply",
  ]);

  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.repaired_count, 1);
  assert.equal(await fs.pathExists(path.join(storyOneDir, "platform_publish_manifest.json")), true);
  assert.equal(await fs.pathExists(path.join(storyOneDir, "goal_package_summary.json")), true);
  assert.equal(report.story_package_refresh.summary.persisted_artifact_summary_count, 1);
  assert.equal(await fs.pathExists(path.join(storyTwoDir, "platform_publish_manifest.json")), false);
  assert.equal(await fs.pathExists(path.join(storyTwoDir, "goal_package_summary.json")), false);
});

test("platform-native pack repair CLI parses story selectors", () => {
  const args = parseArgs(["--story-id", "one", "--story-ids", "two,three"]);

  assert.deepEqual(args.storyIds, ["one", "two", "three"]);
});
