"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildFreshRefillRepairPackageFilter,
} = require("../../lib/job-handlers");

async function writeCandidate({
  root,
  storyId,
  currentTitle,
  scoredTitle,
  repairAt,
  scoreAt,
}) {
  const artifactDir = path.join(root, "artifacts", storyId);
  const storyPackagesPath = path.join(root, "story-packages.json");
  await fs.ensureDir(artifactDir);
  await fs.writeJson(path.join(artifactDir, "canonical_story_manifest.json"), {
    story_id: storyId,
    canonical_game: "Castlevania: Belmont's Curse",
    selected_title: currentTitle,
    narration_script:
      "Castlevania Belmont's Curse makes every boss rewrite the map.",
    ...(repairAt
      ? {
          script_repair: {
            repaired_at: repairAt,
            new_verdict: "viral_ready",
          },
        }
      : {}),
  });
  await fs.writeJson(path.join(artifactDir, "source_manifest.json"), {
    primary_source: {
      name: "PlayStation Blog",
      url: "https://blog.playstation.com/castlevania-belmonts-curse/",
      type: "official_platform_newsroom",
    },
  });
  await fs.writeJson(path.join(artifactDir, "script_scorecard.json"), {
    story_id: storyId,
    verdict: "viral_ready",
    blockers: [],
  });
  await fs.writeJson(path.join(artifactDir, "pulse_media_house_score.json"), {
    story_id: storyId,
    generated_at: scoreAt,
    shorts_feed_competition_report: {
      status: "blocked",
      title: scoredTitle,
      platform_titles: [scoredTitle],
      blockers: ["feed_title_template_fatigue"],
    },
  });
  await fs.writeJson(storyPackagesPath, [
    {
      story_id: storyId,
      title: scoredTitle,
      artifact_dir: artifactDir,
      verdict: "RED",
      blockers: [
        "media_house:shorts_feed_competition_weak",
        "footage:v4_motion_blocked",
      ],
    },
  ]);
  return storyPackagesPath;
}

test("refill repair ignores title-fatigue evidence superseded by a successful script repair", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-refill-filter-stale-title-"),
  );
  try {
    const storyPackagesPath = await writeCandidate({
      root,
      storyId: "castlevania_repaired",
      currentTitle:
        "Castlevania: Belmont's Curse Turns Bosses Into Map Powers",
      scoredTitle: "Castlevania: Belmont Has A Hands-On Combat Test",
      repairAt: "2026-07-19T05:44:32.898Z",
      scoreAt: "2026-07-19T05:44:31.826Z",
    });
    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath,
      outputDir: path.join(root, "filter"),
    });

    assert.equal(result.eligibleRows.length, 1);
    assert.equal(result.quarantinedRows.length, 0);
  } finally {
    await fs.remove(root);
  }
});

test("refill repair keeps current title-fatigue evidence quarantined", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-refill-filter-current-title-"),
  );
  try {
    const currentTitle =
      "Castlevania: Belmont's Curse Turns Bosses Into Map Powers";
    const storyPackagesPath = await writeCandidate({
      root,
      storyId: "castlevania_still_fatigued",
      currentTitle,
      scoredTitle: currentTitle,
      repairAt: "2026-07-19T05:44:31.000Z",
      scoreAt: "2026-07-19T05:44:33.000Z",
    });
    const result = await buildFreshRefillRepairPackageFilter({
      storyPackagesPath,
      outputDir: path.join(root, "filter"),
    });

    assert.equal(result.eligibleRows.length, 0);
    assert.equal(result.quarantinedRows.length, 1);
    assert.deepEqual(result.quarantinedRows[0].reasons, [
      "feed_title_template_fatigue",
    ]);
  } finally {
    await fs.remove(root);
  }
});
