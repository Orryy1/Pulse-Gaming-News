"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  main,
  parseArgs,
} = require("../../tools/media-rights-assess");

test("media rights CLI parses a local assessment request", () => {
  const args = parseArgs([
    "--input",
    "input.json",
    "--out-dir",
    "output/rights",
    "--story-json",
    "story.json",
    "--json",
  ]);

  assert.equal(args.inputPath, "input.json");
  assert.equal(args.outDir, "output/rights");
  assert.equal(args.storyPath, "story.json");
  assert.equal(args.json, true);
});

test("media rights CLI writes immutable evidence, hash-bound records and a render story", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-rights-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const clipPath = path.join(root, "official-window.mp4");
  const inputPath = path.join(root, "request.json");
  const storyPath = path.join(root, "story.json");
  const outDir = path.join(root, "proof");
  await fs.writeFile(clipPath, "not-a-real-video-but-deterministic-test-bytes");
  await fs.writeFile(storyPath, JSON.stringify({
    id: "fresh-breaking-story",
    title: "Fresh breaking story",
    video_clips: [{ id: "official-window", path: clipPath }],
  }));
  await fs.writeFile(inputPath, JSON.stringify({
    story_id: "fresh-breaking-story",
    target_platforms: ["youtube_shorts"],
    policy_acceptance: {
      editorial_exception_policy_accepted: true,
      accepted_by: "Pulse Gaming owner",
      accepted_at: "2026-07-23T10:00:00.000Z",
    },
    assets: [{
      asset_id: "official-window",
      asset_type: "video",
      path: clipPath,
      source_url: "https://publisher.example/official-trailer",
      source_owner: "Example Publisher",
      source_title: "Official Trailer",
      rights_basis: "bounded_editorial_excerpt",
      official_source: true,
      publicly_released: true,
      lawfully_accessed: true,
      third_party_reupload: false,
      leaked_or_unreleased: false,
      contains_third_party_music: false,
      source_audio_removed: true,
      commentary_present: true,
      necessary_for_editorial_point: true,
      non_substitutive: true,
      transformation_notes: "Silent extract under original criticism.",
      editorial_purpose: "criticism_review",
      source_start_seconds: 3,
      source_end_seconds: 8,
      total_use_seconds: 5,
      timeline_start_seconds: 6,
      timeline_end_seconds: 11,
    }],
    generated_at: "2026-07-23T10:15:00.000Z",
  }));

  const result = await main([
    "--root",
    root,
    "--input",
    inputPath,
    "--out-dir",
    outDir,
    "--story-json",
    storyPath,
  ], { stdout: () => {} });

  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.materialisation.verdict, "GREEN");
  assert.equal(result.safety.no_publish_triggered, true);
  const reportBytes = await fs.readFile(result.paths.assessment);
  const reportHash = crypto.createHash("sha256").update(reportBytes).digest("hex");
  const records = JSON.parse(await fs.readFile(result.paths.rights_records, "utf8"));
  assert.equal(records.records.length, 1);
  assert.equal(records.records[0].asset_sha256, crypto
    .createHash("sha256")
    .update("not-a-real-video-but-deterministic-test-bytes")
    .digest("hex"));
  assert.equal(records.records[0].evidence_sha256, reportHash);
  assert.equal(records.records[0].evidence_file, result.paths.assessment);
  const renderStory = JSON.parse(await fs.readFile(result.paths.render_story, "utf8"));
  assert.equal(renderStory.media_attribution_manifest.verdict, "GREEN");
  assert.equal(
    renderStory.media_attribution_manifest.entries[0].display_text,
    "Footage: Example Publisher",
  );
  assert.equal(renderStory.rights_ledger.records.length, 1);
  assert.match(
    await fs.readFile(result.paths.description_attribution, "utf8"),
    /Source: Example Publisher/,
  );
});

test("media rights CLI does not produce publish-usable records for attribution-only input", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-media-rights-red-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const inputPath = path.join(root, "request.json");
  await fs.writeFile(inputPath, JSON.stringify({
    story_id: "unsafe",
    target_platforms: ["youtube_shorts"],
    assets: [{
      asset_id: "repost",
      asset_type: "video",
      path: "missing.mp4",
      source_url: "https://social.example/repost",
      on_screen_credit: "Footage: Somebody",
    }],
  }));

  const result = await main([
    "--root",
    root,
    "--input",
    inputPath,
    "--out-dir",
    path.join(root, "proof"),
  ], { stdout: () => {} });

  assert.equal(result.report.verdict, "RED");
  assert.equal(result.live_publish_allowed, false);
  const records = JSON.parse(await fs.readFile(result.paths.rights_records, "utf8"));
  assert.deepEqual(records.records, []);
});
