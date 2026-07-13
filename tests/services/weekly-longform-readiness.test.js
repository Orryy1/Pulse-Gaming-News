"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");

const {
  buildWeeklyLongformReadinessReport,
} = require("../../tools/weekly-longform-readiness");

function completeEvidence() {
  const segmentCount = 8;
  return {
    schema_version: 1,
    kind: "weekly_roundup",
    segment_count: segmentCount,
    chapter_timestamps: [
      { time: "0:00", title: "Opening" },
      ...Array.from({ length: segmentCount }, (_, index) => ({
        time: `${index + 1}:00`,
        title: `Story ${index + 1}`,
      })),
    ],
    source_pack: Array.from({ length: segmentCount }, (_, index) => ({
      story_id: `story-${index + 1}`,
      title: `Story ${index + 1}`,
      publisher: "Official publisher",
      source_url: `https://example.com/official/story-${index + 1}`,
      confidence: "confirmed",
    })),
    visual_plan: Array.from({ length: segmentCount }, (_, index) => ({
      story_id: `story-${index + 1}`,
      title: `Story ${index + 1}`,
      validated_clips: 3,
      visual_strength_score: 90,
      missing: [],
    })),
  };
}

async function makeWeeklyFixture({ withEvidence = true } = {}) {
  const weeklyDir = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-weekly-readiness-"));
  await fs.writeFile(path.join(weeklyDir, "weekly_roundup_test.mp4"), "probe-stub");
  const transcript = Array.from({ length: 1250 }, (_, index) => `word${index}`).join(" ");
  await fs.writeFile(
    path.join(weeklyDir, "weekly_roundup.ass"),
    `[Events]\nDialogue: 0,0:00:00.00,0:10:05.00,Default,,0,0,0,,${transcript}\n`,
  );
  if (withEvidence) {
    await fs.writeJson(
      path.join(weeklyDir, "weekly_longform_evidence.json"),
      completeEvidence(),
      { spaces: 2 },
    );
  }
  return weeklyDir;
}

const healthyProbe = async () => ({
  durationSeconds: 605,
  size: 250000000,
  bitRate: 3200000,
  width: 1920,
  height: 1080,
  videoBitrate: 2800000,
  avgFrameRate: "30/1",
  nbFrames: 18150,
});

test("weekly readiness recognises a 10-minute build with complete source, chapter and visual evidence", async (t) => {
  const weeklyDir = await makeWeeklyFixture();
  t.after(() => fs.remove(weeklyDir));

  const report = await buildWeeklyLongformReadinessReport({
    weeklyDir,
    probeVideo: healthyProbe,
  });

  assert.equal(report.verdict, "READY_FOR_OPERATOR_REVIEW");
  assert.equal(report.quality_report.verdict, "pass");
  assert.equal(report.quality_report.segment_count, 8);
  assert.equal(report.quality_report.chapter_count, 9);
  assert.equal(report.quality_report.source_ready_count, 8);
  assert.equal(report.quality_report.visual_ready_count, 8);
  assert.match(report.evidence_path, /weekly_longform_evidence\.json$/);
});

test("weekly readiness blocks a video when authoritative long-form evidence is absent", async (t) => {
  const weeklyDir = await makeWeeklyFixture({ withEvidence: false });
  t.after(() => fs.remove(weeklyDir));

  const report = await buildWeeklyLongformReadinessReport({
    weeklyDir,
    probeVideo: healthyProbe,
  });

  assert.equal(report.verdict, "NOT_READY");
  assert.equal(report.evidence_path, null);
  assert.ok(report.quality_report.blockers.includes("longform_evidence_missing"));
  assert.ok(report.quality_report.blockers.includes("insufficient_chapter_plan"));
  assert.ok(report.quality_report.blockers.includes("source_pack_incomplete"));
  assert.ok(report.quality_report.blockers.includes("weak_longform_visual_plan"));
});
