"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFreshGreenBufferLocalPromotionReport,
  writeFreshGreenBufferLocalPromotionArtifacts,
} = require("../../lib/fresh-green-buffer-local-promotion");
const { parseArgs } = require("../../tools/fresh-green-buffer-local-promotion");
const packageJson = require("../../package.json");

function draftStory(overrides = {}) {
  return {
    id: "fresh_xbox_halo_campaign_evolved_demo_20260610",
    title: "Halo: Campaign Evolved Shows The Real Remake Test",
    canonical_subject: "Halo: Campaign Evolved",
    canonical_game: "Halo: Campaign Evolved",
    primary_source: {
      name: "Xbox Wire",
      url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
      type: "official_platform_news",
    },
    primary_source_url: "https://news.xbox.com/en-us/2026/06/10/halo-campaign-evolved-hands-on-demo-2/",
    source_published_at: "2026-06-10T00:00:00.000Z",
    confirmed_claims: [
      "Xbox Wire says Halo: Campaign Evolved showed Assault on the Control Room in hands-on demo form.",
    ],
    unconfirmed_claims: [],
    thumbnail_headline: "HALO'S REAL TEST",
    narration_script:
      "Halo: Campaign Evolved just put the remake debate where it belongs. Xbox Wire says Halo Studios showed Assault on the Control Room in hands-on form. Follow Pulse Gaming so you never miss a beat.",
    ...overrides,
  };
}

test("fresh buffer promotion writes local package work orders without publish or DB side effects", async () => {
  const generatedAt = "2026-06-12T08:00:00.000Z";
  const report = buildFreshGreenBufferLocalPromotionReport({
    stories: [draftStory()],
    generatedAt,
  });

  assert.equal(report.mode, "LOCAL_ONLY_FRESH_GREEN_BUFFER_PROMOTION");
  assert.equal(report.summary.story_count, 1);
  assert.equal(report.summary.local_package_count, 1);
  assert.equal(report.summary.scheduler_green_count, 0);
  assert.equal(report.summary.production_db_mutation_required, false);
  assert.equal(report.safety.no_publish_triggered, true);
  assert.equal(report.safety.no_db_mutation, true);
  assert.equal(report.candidates[0].story_id, "fresh_xbox_halo_campaign_evolved_demo_20260610");
  assert.equal(report.candidates[0].freshness_gate, "pass");
  assert.deepEqual(report.candidates[0].blocking_lanes, [
    "audio_timestamps",
    "official_direct_motion",
    "visual_v4_final_render",
    "scheduler_bridge_promotion",
    "strict_dry_run",
  ]);

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fresh-buffer-promotion-"));
  const written = await writeFreshGreenBufferLocalPromotionArtifacts(report, { outputDir: outDir });

  assert.ok(fs.existsSync(written.reportJson));
  assert.ok(fs.existsSync(written.reportMd));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "canonical_story_manifest.json")));
  assert.ok(fs.existsSync(path.join(outDir, "packages", "fresh_xbox_halo_campaign_evolved_demo_20260610", "render_readiness_work_order.json")));
});

test("fresh buffer promotion CLI is registered and defaults to overnight output", () => {
  assert.equal(
    packageJson.scripts["ops:fresh-green-buffer-promote"],
    "node tools/fresh-green-buffer-local-promotion.js",
  );

  const args = parseArgs(["--json", "--generated-at", "2026-06-12T08:00:00.000Z"]);
  assert.equal(args.json, true);
  assert.equal(args.generatedAt, "2026-06-12T08:00:00.000Z");
  assert.match(args.storiesPath, /fresh_source_intake_stories\.json$/);
  assert.match(args.outDir, /overnight-fresh-green-buffer$/);
});
