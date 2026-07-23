"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const fs = require("fs-extra");

const {
  materializeOfficialYoutubeMotionReferences,
} = require("../../lib/official-youtube-motion-materializer");

test("materialises a verified official-channel reference as a hash-bound local motion master", async () => {
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-official-youtube-motion-"),
  );
  const report = await materializeOfficialYoutubeMotionReferences({
    entries: [
      {
        story_id: "arknights-endfield-gap",
        entity: "Arknights: Endfield",
        source_family: "youtube_EfwGJH-etgk_arknights_endfield",
        source_type: "official_youtube_channel_url",
        source_owner: "Arknights: Endfield",
        source_title: "Arknights: Endfield Beta Test Trailer",
        official_source_url:
          "https://www.youtube.com/watch?v=EfwGJH-etgk",
        official_channel_url:
          "https://www.youtube.com/@arknightsendfieldEN",
        youtube_video_id: "EfwGJH-etgk",
        source_verified: true,
        autonomous_use_approved: false,
        downloads_allowed: true,
      },
    ],
    outputDir,
    generatedAt: "2026-07-17T15:20:00.000Z",
    downloadVideo: async ({ outputPath, videoId, startSeconds, endSeconds }) => {
      assert.equal(videoId, "EfwGJH-etgk");
      assert.equal(startSeconds, 5);
      assert.equal(endSeconds, 75);
      await fs.writeFile(outputPath, Buffer.from("decoded-official-motion-master"));
      return { output_path: outputPath, bytes_written: 30 };
    },
    fetchOembed: async () => ({
      title: "Arknights: Endfield Beta Test Trailer",
      author_name: "Arknights: Endfield",
      author_url: "https://www.youtube.com/@arknightsendfieldEN",
      provider_name: "YouTube",
      provider_url: "https://www.youtube.com/",
    }),
    probeVideo: async () => ({
      decodable: true,
      duration_s: 70,
      width: 1920,
      height: 1080,
      video_codec: "h264",
    }),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.materialization_verdict, "PASS");
  assert.equal(report.publish_readiness, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.summary.blocked, 0);
  assert.equal(report.accepted_references.length, 1);
  assert.equal(
    report.accepted_references[0].direct_media_url_if_available,
    report.output_template.entries[0].direct_media_url_if_available,
  );
  assert.equal(report.safety.social_posting_triggered, false);
  assert.equal(report.safety.production_db_mutated, false);
  assert.equal(report.safety.rights_grants_created, 0);

  const entry = report.output_template.entries[0];
  assert.equal(entry.story_id, "arknights-endfield-gap");
  assert.equal(entry.source_type, "official_youtube_channel_url");
  assert.equal(entry.source_verified, true);
  assert.equal(entry.segment_validation_eligible, true);
  assert.equal(entry.downloads_allowed, true);
  assert.equal(entry.autonomous_use_approved, false);
  assert.equal(entry.rights_grant, false);
  assert.equal(entry.commercial_use_allowed, false);
  assert.equal(entry.source_audio_allowed, false);
  assert.equal(entry.local_materialization_allowed, true);
  assert.equal(entry.live_publish_allowed, false);
  assert.equal(entry.requires_human_legal_review_before_publish, true);
  assert.deepEqual(entry.allowed_platforms, []);
  assert.equal(entry.rights_status, "local_proof_only");
  assert.equal(entry.rights_verdict, "RED");
  assert.equal(entry.approval_status, "operator_rights_review_required");
  assert.equal(
    entry.allowed_render_use,
    "local_proof_only",
  );
  assert.equal(entry.provenance.source, "official_youtube_channel_download");
  assert.equal(
    entry.provenance.official_channel,
    "https://www.youtube.com/@arknightsendfieldEN",
  );
  assert.equal(
    entry.provenance.reference_url,
    "https://www.youtube.com/watch?v=EfwGJH-etgk",
  );
  assert.match(entry.provenance.source_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    entry.provenance.source_sha256,
    crypto
      .createHash("sha256")
      .update(Buffer.from("decoded-official-motion-master"))
      .digest("hex"),
  );
  assert.equal(await fs.pathExists(entry.local_operator_file_path), true);
  assert.equal(entry.direct_media_url_if_available, entry.local_operator_file_path);
  assert.equal(await fs.pathExists(entry.provenance.source_identity_path), true);

  const sidecar = await fs.readJson(entry.provenance.source_identity_path);
  assert.equal(sidecar.rights_grant, false);
  assert.equal(sidecar.youtube_video_id, "EfwGJH-etgk");
  assert.equal(sidecar.source_master_sha256, entry.provenance.source_sha256);
});

test("refuses to download an official-channel reference without explicit acquisition approval", async () => {
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-official-youtube-motion-blocked-"),
  );
  let downloadCalled = false;
  const report = await materializeOfficialYoutubeMotionReferences({
    entries: [
      {
        story_id: "arknights-no-download-approval",
        entity: "Arknights: Endfield",
        source_family: "youtube_EfwGJH-etgk_arknights_endfield",
        source_type: "official_youtube_channel_url",
        source_owner: "Arknights: Endfield",
        source_title: "Arknights: Endfield Beta Test Trailer",
        official_source_url:
          "https://www.youtube.com/watch?v=EfwGJH-etgk",
        official_channel_url:
          "https://www.youtube.com/@arknightsendfieldEN",
        youtube_video_id: "EfwGJH-etgk",
        source_verified: true,
        autonomous_use_approved: true,
        downloads_allowed: false,
      },
    ],
    outputDir,
    downloadVideo: async () => {
      downloadCalled = true;
      throw new Error("download_must_not_run");
    },
  });

  assert.equal(downloadCalled, false);
  assert.equal(report.verdict, "RED");
  assert.equal(report.summary.accepted, 0);
  assert.equal(report.summary.blocked, 1);
  assert.deepEqual(report.rows[0].blockers, [
    "official_youtube_download_not_operator_approved",
  ]);
  assert.equal(report.publish_readiness, "RED");
  assert.equal(report.can_auto_publish, false);
});

test("materialises a platform-holder trailer when the story entity and official channel owner differ", async () => {
  const outputDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-official-platform-motion-"),
  );
  const report = await materializeOfficialYoutubeMotionReferences({
    entries: [
      {
        story_id: "arknights-ps5",
        entity: "Arknights: Endfield",
        source_family: "youtube_AwfLX6Z1KPs_playstation_arknights_endfield",
        source_type: "official_youtube_channel_url",
        source_owner: "PlayStation",
        source_title:
          "Arknights: Endfield - Worldwide Release Trailer | PS5 Games",
        official_source_url:
          "https://www.youtube.com/watch?v=AwfLX6Z1KPs",
        official_channel_url: "https://www.youtube.com/@PlayStation",
        youtube_video_id: "AwfLX6Z1KPs",
        source_verified: true,
        downloads_allowed: true,
      },
    ],
    outputDir,
    downloadVideo: async ({ outputPath }) => {
      await fs.writeFile(outputPath, Buffer.from("platform-holder-motion"));
      return { output_path: outputPath, bytes_written: 22 };
    },
    fetchOembed: async () => ({
      title: "Arknights: Endfield - Worldwide Release Trailer | PS5 Games",
      author_name: "PlayStation",
      author_url: "https://www.youtube.com/@PlayStation",
      provider_name: "YouTube",
      provider_url: "https://www.youtube.com/",
    }),
    probeVideo: async () => ({
      decodable: true,
      duration_s: 70,
      width: 1920,
      height: 1080,
      video_codec: "h264",
    }),
  });

  assert.equal(report.verdict, "AMBER");
  assert.equal(report.publish_readiness, "RED");
  assert.equal(report.can_auto_publish, false);
  assert.equal(report.summary.accepted, 1);
  assert.equal(report.output_template.entries[0].entity, "Arknights: Endfield");
  assert.equal(report.output_template.entries[0].source_owner, "PlayStation");
  assert.equal(report.output_template.entries[0].commercial_use_allowed, false);
});
