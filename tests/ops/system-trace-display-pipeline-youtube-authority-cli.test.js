"use strict";

const assert = require("node:assert/strict");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  EXPECTED_PUBLISH_AT_UTC,
  fixedPaths,
  main,
} = require("../../tools/system-trace-display-pipeline-youtube-authority");

function rightsLedger() {
  return {
    schema_version: 1,
    schema: "pulse_system_trace_buffer_rights_ledger_v1",
    scope: { episode_count: 7, platform: "youtube_shorts", finished_editorial_video_only: true },
    visuals: { verdict: "GREEN", third_party_visual_assets_embedded: false },
    narration: { verdict: "GREEN", synthetic_media: true, disclosure_setting: "YES" },
    music: { verdict: "GREEN", commercial_use_allowed: true, planned_episode_placements: 7, reuse_limit_pass: true },
    sound_effects: { verdict: "GREEN" },
    fonts: { verdict: "GREEN" },
    placement_verdict: "GREEN",
    blockers: [],
    public_release_scope: "exact rendered seven-episode System Trace buffer only",
  };
}

function proof(storyId) {
  const requestPlan = {
    story_id: storyId,
    verdict: "REQUEST_SHAPE_PASS",
    request_shape_verdict: "PASS",
    can_publish: false,
    publish_authority: "NOT_EVALUATED",
    source_of_truth: "closed_governed_package",
    video_insert: {
      operation: "youtube.videos.insert",
      part: ["snippet", "status", "paidProductPlacementDetails"],
      params: { notifySubscribers: false },
      requestBody: { status: { privacyStatus: "private", containsSyntheticMedia: true } },
      media_sha256: "c".repeat(64),
    },
    thumbnail_set: null,
    caption_insert: {
      operation: "youtube.captions.insert",
      part: ["snippet"],
      requestBody: { snippet: { language: "en-GB" } },
      media_sha256: "d".repeat(64),
    },
  };
  return {
    schema_version: 1,
    story_id: storyId,
    verdict: "NOT_EVALUATED",
    request_shape_verdict: "PASS",
    publish_allowed: false,
    publish_authority: "NOT_EVALUATED",
    blockers: [],
    request_plan: requestPlan,
    mock_dry_run: {
      verdict: "REQUEST_SHAPE_PASS",
      request_shape_verdict: "PASS",
      publish_authority: "NOT_EVALUATED",
    },
  };
}

test("materialises only the fixed display-pipeline authorities and schedule slots", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "display-pipeline-authority-"));
  t.after(() => fs.remove(root));
  const repoRoot = path.join(root, "repo");
  const outputRoot = path.join(root, "evidence");
  const episodes = EXPECTED_PUBLISH_AT_UTC.map((publishAt, index) => ({
    story_id: `story-${index + 1}`,
    project_dir: `videos/story-${index + 1}`,
    publish_at_utc: publishAt,
    title: `Title ${index + 1}`,
    description: `Description ${index + 1}`,
    tags: ["System Trace", `episode ${index + 1}`],
  }));
  const manifest = {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_v1",
    channel: { id: "channel-1", title: "Pulse Gaming" },
    platform: "youtube_shorts",
    timezone: "UTC",
    cadence: "one_per_day",
    initial_privacy_status: "private",
    notify_subscribers_on_upload: false,
    synthetic_media_disclosure: true,
    episodes,
  };
  await fs.ensureDir(path.join(repoRoot, "videos"));
  await fs.writeJson(path.join(repoRoot, "videos", "system-trace-display-pipeline-youtube-buffer.json"), manifest);
  await fs.writeJson(path.join(repoRoot, "videos", "system-trace-display-pipeline-buffer-rights-ledger.json"), rightsLedger());
  for (const episode of episodes) {
    const project = path.join(repoRoot, episode.project_dir);
    await fs.ensureDir(project);
    await fs.writeJson(path.join(project, "governed-youtube-upload-proof.json"), proof(episode.story_id));
  }

  const result = await main(["--materialise"], {
    paths: { repoRoot, outputRoot },
    generatedAt: "2026-08-20T07:00:00.000Z",
    log() {},
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.deepEqual(
    result.report.authorities.map((entry) => entry.release.publish_at_utc),
    EXPECTED_PUBLISH_AT_UTC,
  );
  assert.equal((await fs.readdir(path.join(outputRoot, "authorities", "private"))).length, 7);
  await assert.rejects(
    () => main(["--materialise"], { paths: { repoRoot, outputRoot }, log() {} }),
    /output_already_exists/,
  );
});

test("uses fixed campaign paths and rejects implicit materialisation", async () => {
  const paths = fixedPaths({ repoRoot: "D:/repo", outputRoot: "D:/evidence" });
  assert.equal(path.basename(paths.manifestPath), "system-trace-display-pipeline-youtube-buffer.json");
  assert.equal(path.basename(paths.rightsPath), "system-trace-display-pipeline-buffer-rights-ledger.json");
  await assert.rejects(() => main([], { log() {} }), /explicit_materialise_required/);
});
