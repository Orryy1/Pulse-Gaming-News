"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  materialiseSystemTraceYouTubePackage,
} = require("../../lib/services/system-trace-youtube-package");

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

test("materialises a closed hash-bound private-first YouTube pack without a thumbnail", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-system-trace-pack-"));
  const projectDir = path.join(repoRoot, "videos", "story-one");
  await fs.ensureDir(path.join(projectDir, "renders"));
  const video = Buffer.from("rendered-video");
  const srt = Buffer.from(
    "1\n00:00:00,000 --> 00:00:01,000\nFirst line.\n\n" +
    "2\n00:00:01,000 --> 00:00:02,000\nSecond line.\n",
  );
  await fs.writeFile(path.join(projectDir, "renders", "story-one.mp4"), video);
  await fs.writeFile(path.join(projectDir, "captions.srt"), srt);
  const manifest = {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_v1",
    channel: { id: "channel-one", title: "Pulse Gaming" },
    episodes: [{
      story_id: "story-one",
      project_dir: "videos/story-one",
      publish_at_utc: "2026-08-15T19:00:00Z",
      title: "Exact title",
      description: "Exact description",
      tags: ["one", "two"],
    }],
  };
  const manifestPath = path.join(repoRoot, "videos", "buffer.json");
  await fs.writeJson(manifestPath, manifest);

  const result = await materialiseSystemTraceYouTubePackage({
    packageRoot: projectDir,
    manifestPath,
    storyId: "story-one",
  });

  assert.equal(result.publishPack.story_id, "story-one");
  assert.equal(result.publishPack.public_publish_authorised, true);
  assert.equal(result.publishPack.scheduler_authorised, true);
  assert.equal(result.publishPack.rights_placement_verdict, "GREEN");
  assert.equal(result.publishPack.youtube_upload_request.video_sha256, hash(video));
  assert.equal(result.publishPack.youtube_upload_request.captions.sha256, hash(srt));
  assert.equal(result.publishPack.youtube_upload_request.status.privacyStatus, "private");
  assert.equal(result.publishPack.youtube_upload_request.notifySubscribers, false);
  assert.equal(result.publishPack.youtube_upload_request.status.containsSyntheticMedia, true);
  assert.equal(Object.hasOwn(result.publishPack.youtube_upload_request, "thumbnail"), false);
  assert.equal(result.canonicalManifest.narration_script, "First line. Second line.");
  assert.equal(result.canonicalManifest.final_container.bytes, video.length);
  assert.equal(result.canonicalManifest.captions.bytes, srt.length);
  assert.deepEqual(
    await fs.readJson(path.join(projectDir, "youtube_publish_pack.json")),
    result.publishPack,
  );
  assert.deepEqual(
    await fs.readJson(path.join(projectDir, "canonical_story_manifest.json")),
    result.canonicalManifest,
  );
});

test("blocks a project mismatch and refuses to overwrite governed artefacts", async () => {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-system-trace-pack-"));
  const projectDir = path.join(repoRoot, "videos", "story-one");
  await fs.ensureDir(path.join(projectDir, "renders"));
  await fs.writeFile(path.join(projectDir, "renders", "story-one.mp4"), "video");
  await fs.writeFile(path.join(projectDir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nText.\n");
  const manifestPath = path.join(repoRoot, "videos", "buffer.json");
  await fs.writeJson(manifestPath, {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_v1",
    channel: { id: "channel-one" },
    episodes: [{
      story_id: "story-one",
      project_dir: "videos/another-project",
      publish_at_utc: "2026-08-15T19:00:00Z",
      title: "Title",
      description: "Description",
      tags: ["tag"],
    }],
  });
  await assert.rejects(
    materialiseSystemTraceYouTubePackage({
      packageRoot: projectDir,
      manifestPath,
      storyId: "story-one",
    }),
    /package_root_manifest_mismatch/,
  );
});
