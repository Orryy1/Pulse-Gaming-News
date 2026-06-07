"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildCompetitorForensicsLab,
  writeCompetitorForensicsLab,
} = require("../../lib/competitor-forensics-lab");

function fixtureRegistry() {
  return Array.from({ length: 20 }, (_, index) => ({
    id: `channel_${index + 1}`,
    group: index < 10 ? "direct_gaming_news" : "social_first_or_reference",
    platform: "YouTube",
    channel_handle: `@fixture${index + 1}`,
    display_name: `Fixture Channel ${index + 1}`,
    source_method: "operator_fixture",
    collection_url: `https://www.youtube.com/@fixture${index + 1}`,
    allowed_use: "metadata_and_pattern_analysis_only",
  }));
}

function fixtureVideos() {
  return Array.from({ length: 100 }, (_, index) => ({
    platform: "YouTube",
    channel_id: `channel_${(index % 20) + 1}`,
    channel_handle: `@fixture${(index % 20) + 1}`,
    video_url: `https://www.youtube.com/watch?v=fixture${index + 1}`,
    title: index % 2 === 0
      ? `Game ${index + 1} Just Changed Its Launch Plan`
      : `Why Game ${index + 1} Is Getting Pushback`,
    description: "Public RSS fixture metadata only. #gaming #shorts",
    hashtags: ["gaming", "shorts"],
    published_at: "2026-05-20T18:00:00.000Z",
    duration_s: index % 3 === 0 ? 58 : null,
    thumbnail_url: `https://img.youtube.com/vi/fixture${index + 1}/hqdefault.jpg`,
    view_count: index % 5 === 0 ? 200000 + index * 1000 : null,
    like_count: null,
    comment_count: null,
    source_method: "operator_fixture",
  }));
}

test("competitor lab reviews 20 channels and 100 videos without copied assets", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-competitor-lab-"));
  const report = await buildCompetitorForensicsLab({
    registry: fixtureRegistry(),
    metadataInventory: fixtureVideos(),
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });

  assert.equal(report.verdict, "PASS");
  assert.equal(report.summary.reviewed_channel_count, 20);
  assert.equal(report.summary.assessed_video_count, 100);
  assert.equal(report.safety.no_copied_assets_stored, true);
  assert.equal(report.safety.no_unauthorised_video_downloads, true);
  assert.equal(report.pulse_upgrade_rulebook.rules.length >= 20, true);
  assert.ok(report.competitor_transcript_structure_analysis.structures.every((row) => !row.full_transcript));
  assert.ok(report.hook_forensics.patterns.some((pattern) => pattern.pulse_rule_id));
});

test("competitor lab writes every required artefact", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-competitor-lab-write-"));
  const report = await buildCompetitorForensicsLab({
    registry: fixtureRegistry(),
    metadataInventory: fixtureVideos(),
    outputDir: path.join(root, "out"),
    generatedAt: "2026-06-07T12:00:00.000Z",
  });
  const written = await writeCompetitorForensicsLab(report, { outputDir: path.join(root, "out") });

  for (const file of Object.values(written)) {
    assert.equal(await fs.pathExists(file), true, file);
  }
});
