"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("fs-extra");

const weeklyCompile = require("../../weekly_compile");
const { handlers } = require("../../lib/job-handlers");
const ROOT = path.resolve(__dirname, "../..");

function makeLongformScript() {
  const paragraph =
    "The argument running through this chapter is simple: players are not reacting to the logo, they are reacting to proof. " +
    "The source gives us the named game, the visible change and the platform context, so the segment can explain what people can actually do with that information. " +
    "That means comparing the promise against the footage, the business move against player trust and the headline against what changes after launch. ";
  return Array.from({ length: 38 }, () => paragraph).join(" ");
}

function makeSourcePack(count = 8) {
  return Array.from({ length: count }, (_, index) => ({
    story_id: `story_${index + 1}`,
    publisher: index % 2 === 0 ? "Xbox Wire" : "Nintendo",
    source_url: `https://example.com/story-${index + 1}`,
    confidence: "confirmed",
  }));
}

function makeVisualPlan(sourcePack) {
  return sourcePack.map((source, index) => ({
    story_id: source.story_id,
    exact_subject_assets: 4,
    validated_clips: index % 2 === 0 ? 2 : 1,
    missing: [],
    visual_strength_score: 86,
  }));
}

function makeChapterPlan(sourcePack) {
  return [
    { time: "0:00", title: "The Week Players Asked For Proof" },
    ...sourcePack.map((source, index) => ({
      time: `${index + 1}:00`,
      title: `Chapter ${index + 1}`,
    })),
  ];
}

test("weekly longform upload is not unlocked by AUTO_PUBLISH alone", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "weekly_roundup",
      env: { AUTO_PUBLISH: "true" },
    }),
    false,
  );
});

test("weekly longform upload requires explicit longform and weekly consent", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "weekly_roundup",
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        WEEKLY_ROUNDUP_AUTO_PUBLISH: "true",
      },
    }),
    true,
  );
});

test("topic longform upload requires explicit longform and topic consent", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "topic_compilation",
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        TOPIC_COMPILATION_AUTO_PUBLISH: "true",
      },
    }),
    true,
  );
});

test("weekly longform quality gate rejects short placeholder-ridden output", () => {
  const report = weeklyCompile._private.buildLongformQualityReport({
    kind: "weekly_roundup",
    durationSeconds: 100,
    scriptText:
      "WELCOME BACK TO PULSE GAMING NNFIRST UP, A PLACEHOLDER. NEXT WEEK WE DELVE INTO [TEASER - UPCOMING GAME RELEASE].",
    videoProbe: {
      width: 1920,
      height: 1080,
      videoBitrate: 64118,
    },
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.blockers.includes("duration_under_10_minutes"));
  assert.ok(report.blockers.includes("placeholder_public_copy"));
  assert.ok(report.blockers.includes("newline_escape_artifact"));
  assert.ok(report.blockers.includes("legacy_low_bitrate_visual"));
});

test("weekly longform quality gate accepts real 10-minute editorial output", () => {
  const sourcePack = makeSourcePack();
  const report = weeklyCompile._private.buildLongformQualityReport({
    kind: "weekly_roundup",
    durationSeconds: 642,
    scriptText: makeLongformScript(),
    videoProbe: {
      width: 1920,
      height: 1080,
      videoBitrate: 6500000,
    },
    segmentCount: sourcePack.length,
    chapterTimestamps: makeChapterPlan(sourcePack),
    sourcePack,
    visualPlan: makeVisualPlan(sourcePack),
  });

  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.blockers, []);
});

test("weekly longform quality gate rejects 10-minute output without chapter, source and visual proof", () => {
  const report = weeklyCompile._private.buildLongformQualityReport({
    kind: "weekly_roundup",
    durationSeconds: 642,
    scriptText:
      "This week had several gaming stories. The first one mattered, the second one also mattered and the rest were interesting. " +
      "The useful thing is that players have a lot to think about before next week.",
    videoProbe: {
      width: 1920,
      height: 1080,
      videoBitrate: 6500000,
    },
    segmentCount: 4,
    chapterTimestamps: [{ time: "0:00", title: "Intro" }],
    sourcePack: [
      { story_id: "one", publisher: "unknown", source_url: null },
      { story_id: "two", publisher: "unknown", source_url: null },
    ],
    visualPlan: [
      { story_id: "one", exact_subject_assets: 0, validated_clips: 0, missing: ["official gameplay"] },
      { story_id: "two", exact_subject_assets: 1, validated_clips: 0, missing: ["source card"] },
    ],
  });

  assert.equal(report.verdict, "fail");
  assert.ok(report.blockers.includes("too_few_longform_segments"));
  assert.ok(report.blockers.includes("insufficient_chapter_plan"));
  assert.ok(report.blockers.includes("source_pack_incomplete"));
  assert.ok(report.blockers.includes("weak_longform_visual_plan"));
  assert.ok(report.blockers.includes("thin_longform_editorial_script"));
});

test("weekly longform quality gate accepts source-backed chaptered visual-ready longform proof", () => {
  const sourcePack = makeSourcePack();
  const report = weeklyCompile._private.buildLongformQualityReport({
    kind: "weekly_roundup",
    durationSeconds: 721,
    scriptText: makeLongformScript(),
    videoProbe: {
      width: 1920,
      height: 1080,
      videoBitrate: 6500000,
    },
    segmentCount: 8,
    chapterTimestamps: makeChapterPlan(sourcePack),
    sourcePack,
    visualPlan: makeVisualPlan(sourcePack),
  });

  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.blockers, []);
});

test("weekly compiler builds longform proof from selected story source and media evidence", () => {
  const evidence = weeklyCompile._private.buildLongformEvidence({
    selectedStories: [
      {
        id: "minecraft",
        title: "Minecraft Dungeons II Has A Co-Op Risk",
        source_url: "https://news.xbox.com/en-us/minecraft-dungeons-2",
        source_name: "Xbox Wire",
        flair_confidence: "confirmed",
        media_inventory: {
          exact_subject_asset_count: 4,
          validated_clip_count: 2,
          visual_strength_score: 88,
        },
      },
      {
        id: "fable",
        title: "Fable Has A 1,000 NPC Risk",
        url: "https://news.xbox.com/en-us/fable",
        publisher: "Xbox Wire",
        classification: "confirmed",
        downloaded_images: [
          { path: "output/images/fable-1.jpg", type: "gameplay" },
          { path: "output/images/fable-2.jpg", type: "gameplay" },
          { path: "output/images/fable-3.jpg", type: "gameplay" },
        ],
      },
    ],
    segments: [{ story_id: "minecraft" }, { story_id: "fable" }],
    chapterTimestamps: [
      { time: "0:00", title: "Intro" },
      { time: "1:00", title: "Minecraft" },
      { time: "2:00", title: "Fable" },
    ],
  });

  assert.equal(evidence.segmentCount, 2);
  assert.equal(evidence.chapterTimestamps.length, 3);
  assert.equal(evidence.sourcePack[0].publisher, "Xbox Wire");
  assert.equal(evidence.sourcePack[0].source_url, "https://news.xbox.com/en-us/minecraft-dungeons-2");
  assert.equal(evidence.visualPlan[0].validated_clips, 2);
  assert.equal(evidence.visualPlan[1].exact_subject_assets, 3);
});

test("weekly compiler requires enough selected stories for a real weekly longform", () => {
  assert.equal(
    weeklyCompile._private.hasEnoughWeeklyStories([{ id: "one" }, { id: "two" }, { id: "three" }]),
    false,
  );
  assert.equal(
    weeklyCompile._private.hasEnoughWeeklyStories(Array.from({ length: 8 }, (_, index) => ({ id: `story_${index}` }))),
    true,
  );
});

test("longform upload consent cannot override a failed longform quality report", () => {
  assert.equal(
    weeklyCompile._private.shouldUploadLongform({
      kind: "weekly_roundup",
      env: {
        AUTO_PUBLISH: "true",
        LONGFORM_AUTO_PUBLISH: "true",
        WEEKLY_ROUNDUP_AUTO_PUBLISH: "true",
      },
      qualityReport: {
        verdict: "fail",
        blockers: ["duration_under_10_minutes"],
      },
    }),
    false,
  );
});

test("scheduled weekly job is disabled unless explicitly enabled", () => {
  assert.equal(
    weeklyCompile._private.shouldRunWeeklyJob({
      env: { AUTO_PUBLISH: "true" },
      payload: {},
    }),
    false,
  );
  assert.equal(
    weeklyCompile._private.shouldRunWeeklyJob({
      env: { WEEKLY_ROUNDUP_JOB_ENABLED: "true" },
      payload: {},
    }),
    true,
  );
  assert.equal(
    weeklyCompile._private.shouldRunWeeklyJob({
      env: {},
      payload: { operator_approved: true },
    }),
    true,
  );
});

test("roundup_weekly job handler skips scheduled legacy compiler by default", async () => {
  const before = {
    WEEKLY_ROUNDUP_JOB_ENABLED: process.env.WEEKLY_ROUNDUP_JOB_ENABLED,
  };
  delete process.env.WEEKLY_ROUNDUP_JOB_ENABLED;
  try {
    const logs = [];
    const result = await handlers.roundup_weekly(
      { payload: {} },
      { log: (line) => logs.push(line), repos: {} },
    );

    assert.deepEqual(result, {
      skipped: true,
      reason: "weekly_roundup_job_not_enabled",
    });
    assert.match(logs.join("\n"), /weekly_roundup_job_not_enabled/);
  } finally {
    if (before.WEEKLY_ROUNDUP_JOB_ENABLED === undefined) {
      delete process.env.WEEKLY_ROUNDUP_JOB_ENABLED;
    } else {
      process.env.WEEKLY_ROUNDUP_JOB_ENABLED = before.WEEKLY_ROUNDUP_JOB_ENABLED;
    }
  }
});

test("weekly longform readiness command is registered as read-only ops proof", async () => {
  const pkg = await fs.readJson(path.join(ROOT, "package.json"));
  assert.equal(
    pkg.scripts["ops:weekly-longform-readiness"],
    "node tools/weekly-longform-readiness.js",
  );
});
