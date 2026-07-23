"use strict";

const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  main,
  parseArgs,
} = require("../../tools/publisher-video-policy-evidence");

test("publisher video policy evidence CLI parses a YouTube-only binding request", () => {
  const args = parseArgs([
    "--segment-report",
    "segments.json",
    "--out-dir",
    "out",
    "--story-id",
    "rss_669d4232cf129214",
    "--game-name",
    "Halo: Campaign Evolved",
    "--item-title",
    "Halo's Remake Hits Game Pass On 28 July",
    "--steam-app-id",
    "2806050",
    "--platforms",
    "youtube",
    "--generated-at",
    "2026-07-21T17:30:00.000Z",
    "--json",
  ]);

  assert.equal(args.segmentReportPath, "segments.json");
  assert.equal(args.outputDir, "out");
  assert.equal(args.storyId, "rss_669d4232cf129214");
  assert.equal(args.gameName, "Halo: Campaign Evolved");
  assert.equal(args.itemTitle, "Halo's Remake Hits Game Pass On 28 July");
  assert.equal(args.sourceAppId, "2806050");
  assert.deepEqual(args.targetPlatforms, ["youtube"]);
  assert.equal(args.generatedAt, "2026-07-21T17:30:00.000Z");
  assert.equal(args.json, true);
});

test("publisher video policy evidence CLI writes local AMBER evidence without side effects", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-policy-cli-"));
  t.after(() => fs.remove(root));
  const storyId = "rss_669d4232cf129214";
  const segmentReportPath = path.join(root, "segments.json");
  const outDir = path.join(root, "out");
  await fs.outputJson(segmentReportPath, {
    segments: [{
      id: "halo-window",
      story_id: storyId,
      status: "validated",
      segment_validated: true,
      allowed_for_flash_lane: true,
      source_url:
        "https://video.fastly.steamstatic.com/store_trailers/2806050/trailer/hash/master.mp4",
    }],
  });
  const html = [
    "Microsoft grants you a personal, non-exclusive, non-sublicenseable, non-transferable, revocable, limited license.",
    "These Rules apply to all games and Game Content published and owned by Microsoft Studios.",
    "You may make your Item available on Youtube or Twitch and participate in programs on those sites that allow you to earn revenue from ads displayed in connection with your Item.",
    "Your Item was created under Microsoft's Game Content Usage Rules using assets from the Microsoft Game, and it is not endorsed by or affiliated with Microsoft.",
    "You need to include a link to these Game Content Usage Rules.",
    "If you want to use the soundtracks or audio effects from the original game, you need permission from a third party.",
  ].join(" ");
  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await main([
      "--root",
      root,
      "--segment-report",
      segmentReportPath,
      "--out-dir",
      outDir,
      "--story-id",
      storyId,
      "--game-name",
      "Halo: Campaign Evolved",
      "--item-title",
      "Halo's Remake Hits Game Pass On 28 July",
      "--steam-app-id",
      "2806050",
      "--platforms",
      "youtube",
      "--generated-at",
      "2026-07-21T17:30:00.000Z",
      "--json",
    ], {
      fetchImpl: async () => new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    });
  } finally {
    console.log = originalLog;
  }

  assert.equal(result.decision.verdict, "AMBER");
  assert.equal(result.summary.bound_segment_count, 1);
  assert.equal(result.safety.no_publish_triggered, true);
  assert.equal(result.safety.no_db_mutation, true);
  assert.equal(result.safety.no_oauth_or_token_change, true);
  assert.equal(await fs.pathExists(result.bound_segment_report_path), true);
});
