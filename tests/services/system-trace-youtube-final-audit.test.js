"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const manifest = require("../../videos/system-trace-youtube-buffer.json");
const {
  EXPECTED_MANIFEST_SHA256,
  auditSystemTraceYouTubeBuffer,
} = require("../../lib/services/system-trace-youtube-final-audit");

function privateReceipt(episode, index) {
  const videoId = `video-${index + 1}`;
  const captionId = `caption-${index + 1}`;
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_dispatch",
    story_id: episode.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    platform_object: {
      video_id: videoId,
      caption_id: captionId,
      privacy_status: "private",
    },
    requests: {
      captions: {
        request_body: {
          snippet: {
            videoId,
            language: "en-GB",
            name: "English (United Kingdom)",
            isDraft: false,
          },
        },
      },
    },
  };
}

function scheduleReceipt(episode, index) {
  const publishAt = new Date(episode.publish_at_utc).toISOString();
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_scheduled_release",
    story_id: episode.story_id,
    platform: "youtube",
    video_id: `video-${index + 1}`,
    channel_id: manifest.channel.id,
    publish_at_utc: publishAt,
    verdict: "GREEN",
    status: "SCHEDULE_VERIFIED",
    retry_allowed: false,
  };
}

function remoteVideo(episode, index) {
  return {
    id: `video-${index + 1}`,
    snippet: {
      channelId: manifest.channel.id,
      title: episode.title,
      description: episode.description,
      tags: [...episode.tags].reverse(),
      categoryId: "20",
      defaultLanguage: "en-GB",
      defaultAudioLanguage: "en-GB",
    },
    status: {
      privacyStatus: "private",
      publishAt: new Date(episode.publish_at_utc).toISOString(),
      uploadStatus: "processed",
      license: "youtube",
      embeddable: true,
      publicStatsViewable: true,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    },
    contentDetails: { caption: "true" },
    processingDetails: { processingStatus: "succeeded" },
    paidProductPlacementDetails: { hasPaidProductPlacement: false },
  };
}

function remoteCaption(index) {
  return {
    id: `caption-${index + 1}`,
    snippet: {
      videoId: `video-${index + 1}`,
      language: "en-GB",
      name: "English (United Kingdom)",
      isDraft: false,
      trackKind: "standard",
      isAutoSynced: false,
      status: "serving",
    },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function packageEvidence(episode) {
  const packageRoot = path.join(__dirname, "..", "..", episode.project_dir);
  const captions = fs.readFileSync(path.join(packageRoot, "captions.srt"));
  return {
    canonical_manifest: JSON.parse(
      fs.readFileSync(path.join(packageRoot, "canonical_story_manifest.json"), "utf8"),
    ),
    publish_pack: JSON.parse(
      fs.readFileSync(path.join(packageRoot, "youtube_publish_pack.json"), "utf8"),
    ),
    captions_sha256: sha256(captions),
    captions_bytes: captions.length,
  };
}

function studioReceiptPair(episode, index, pack) {
  const videoId = `studio-video-${index + 1}`;
  const intent = {
    story_id: episode.story_id,
    video_id: videoId,
    video_sha256: pack.canonical_manifest.final_container.sha256,
    authority_action_id: `${episode.story_id}:youtube:private`,
  };
  const readback = {
    id: videoId,
    channel_id: manifest.channel.id,
    title: episode.title,
    description: episode.description,
    tags: [...episode.tags].sort((a, b) => a.localeCompare(b)),
    category_id: "20",
    default_language: "",
    default_audio_language: "en-GB",
    privacy_status: "private",
    upload_status: "processed",
    processing_status: "succeeded",
    licence: "youtube",
    embeddable: true,
    public_stats_viewable: true,
    self_declared_made_for_kids: false,
    captions_present: true,
    file_size: String(pack.canonical_manifest.final_container.bytes),
  };
  const source = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: "2026-08-14T19:00:00.000Z",
    story_id: intent.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "PRIVATE_RECONCILIATION_FAILED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: videoId, privacy_status: "private" },
    requests: { video: { media_sha256: intent.video_sha256 } },
    authority: { action_id: intent.authority_action_id },
    verification_outcome: "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: false,
    readback,
    blockers: ["default_language_missing"],
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`, "utf8");
  const sourceSha256 = sha256(sourceBytes);
  const reconciliation = {
    ...source,
    receipt_type: "governed_youtube_private_reconciliation",
    generated_at: "2026-08-14T19:05:00.000Z",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    verification_outcome: "DEFERRED_LANGUAGE_READBACK_VERIFIED",
    remote_mutation_count: 0,
    source_receipt: {
      sha256: sourceSha256,
      verdict: "RED",
      status: "PRIVATE_RECONCILIATION_FAILED",
      blocker: "default_language_missing",
    },
    readback: { ...readback, default_language: "en-GB" },
  };
  delete reconciliation.snippet_update_count;
  delete reconciliation.update_response_ambiguous;
  delete reconciliation.blockers;
  const reconciliationBytes = Buffer.from(
    `${JSON.stringify(reconciliation, null, 2)}\n`,
    "utf8",
  );
  return {
    source: { document: source, sha256: sourceSha256 },
    reconciliation: {
      document: reconciliation,
      sha256: sha256(reconciliationBytes),
    },
  };
}

function fixture() {
  const privateReceipts = {};
  const scheduleReceipts = {};
  const videos = new Map();
  const captions = new Map();
  for (const [index, episode] of manifest.episodes.entries()) {
    privateReceipts[episode.story_id] = privateReceipt(episode, index);
    scheduleReceipts[episode.story_id] = scheduleReceipt(episode, index);
    videos.set(`video-${index + 1}`, remoteVideo(episode, index));
    captions.set(`video-${index + 1}`, remoteCaption(index));
  }
  return { privateReceipts, scheduleReceipts, videos, captions };
}

function studioAuditFixture() {
  const privateReceipts = {};
  const privateReconciliations = {};
  const scheduleReceipts = {};
  const packages = {};
  const videos = new Map();
  const captions = new Map();
  for (const [index, episode] of manifest.episodes.entries()) {
    const pack = packageEvidence(episode);
    const pair = studioReceiptPair(episode, index, pack);
    privateReceipts[episode.story_id] = pair.source;
    privateReconciliations[episode.story_id] = pair.reconciliation;
    packages[episode.story_id] = pack;
    scheduleReceipts[episode.story_id] = {
      ...scheduleReceipt(episode, index),
      video_id: `studio-video-${index + 1}`,
      private_readiness: {
        evidence_kind: "DEFERRED_RECONCILIATION",
        canonical_receipt_sha256: pair.source.sha256,
        reconciliation_sha256: pair.reconciliation.sha256,
      },
    };
    const video = remoteVideo(episode, index);
    video.id = `studio-video-${index + 1}`;
    videos.set(video.id, video);
    const caption = remoteCaption(index);
    caption.id = `studio-caption-${index + 1}`;
    caption.snippet.videoId = video.id;
    captions.set(video.id, [caption]);
  }
  const client = {
    videos: {
      list: async (request) => ({ data: { items: [videos.get(request.id[0])] } }),
    },
    captions: {
      list: async (request) => ({ data: { items: captions.get(request.videoId) } }),
    },
  };
  return {
    input: {
      client,
      manifest,
      manifestSha256: EXPECTED_MANIFEST_SHA256,
      privateReceipts,
      privateReconciliations,
      scheduleReceipts,
      packages,
      generatedAt: "2026-08-14T20:00:00.000Z",
    },
    captions,
  };
}

test("independently verifies the exact seven scheduled videos and serving captions without retry or mutation", async () => {
  const data = fixture();
  const operations = [];
  const client = {
    videos: {
      list: async (request, options) => {
        operations.push({ operation: "videos.list", request, options });
        return { data: { items: [data.videos.get(request.id[0])] } };
      },
    },
    captions: {
      list: async (request, options) => {
        operations.push({ operation: "captions.list", request, options });
        return { data: { items: [data.captions.get(request.videoId)] } };
      },
    },
  };

  const report = await auditSystemTraceYouTubeBuffer({
    client,
    manifest,
    manifestSha256: EXPECTED_MANIFEST_SHA256,
    privateReceipts: data.privateReceipts,
    scheduleReceipts: data.scheduleReceipts,
    generatedAt: "2026-08-14T18:00:00.000Z",
  });

  assert.equal(report.verdict, "GREEN");
  assert.equal(report.episode_count, 7);
  assert.equal(report.remote_read_request_count, 14);
  assert.equal(report.remote_mutation_request_count, 0);
  assert.equal(report.retry_allowed, false);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.episodes.length, 7);
  assert.ok(report.episodes.every((entry) => entry.verdict === "GREEN"));
  assert.ok(report.episodes.every((entry) => entry.checks.captions_serving === true));
  assert.deepEqual(
    operations.map((entry) => entry.operation),
    manifest.episodes.flatMap(() => ["videos.list", "captions.list"]),
  );
  assert.ok(operations.every((entry) => entry.options.retry === false));
  assert.ok(operations.every((entry) => entry.options.timeout === 30_000));
  assert.deepEqual(operations[0].request.part, [
    "snippet",
    "status",
    "contentDetails",
    "processingDetails",
    "paidProductPlacementDetails",
  ]);
  assert.deepEqual(operations[1].request.part, ["snippet"]);
});

test("accepts only a cryptographically linked Studio RED receipt and GREEN reconciliation, then discovers one exact manual caption", async () => {
  const data = studioAuditFixture();
  const report = await auditSystemTraceYouTubeBuffer(data.input);

  assert.equal(report.verdict, "GREEN");
  assert.ok(report.episodes.every((entry) => entry.receipt_evidence_kind === "DEFERRED_RECONCILIATION"));
  assert.ok(report.episodes.every((entry) => entry.checks.caption_manual_track_unique === true));
  assert.ok(report.episodes.every((entry) => entry.checks.caption_content_binding_exact === true));
  assert.equal(
    report.episodes[0].expected_caption.content_sha256,
    packageEvidence(manifest.episodes[0]).captions_sha256,
  );
});

test("rejects a tampered Studio reconciliation before any remote read for that episode", async () => {
  const data = studioAuditFixture();
  const storyId = manifest.episodes[0].story_id;
  data.input.privateReconciliations[storyId].document.source_receipt.sha256 =
    "f".repeat(64);

  const report = await auditSystemTraceYouTubeBuffer(data.input);

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.blockers.includes(
      `${storyId}:exact_linked_studio_green_reconciliation_required`,
    ),
  );
  assert.equal(report.episodes[0].observed.video, null);
  assert.equal(report.remote_read_request_count, 12);
});

test("rejects duplicate exact manual en-GB serving caption tracks", async () => {
  const data = studioAuditFixture();
  const videoId = "studio-video-1";
  data.captions.get(videoId).push({
    ...data.captions.get(videoId)[0],
    id: "studio-caption-duplicate",
    snippet: { ...data.captions.get(videoId)[0].snippet },
  });

  const report = await auditSystemTraceYouTubeBuffer(data.input);

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.blockers.includes(
      "system-trace-frame-pacing:youtube_manual_caption_track_duplicate",
    ),
  );
  assert.equal(report.episodes[0].checks.caption_manual_track_unique, false);
});

test("rejects a missing exact manual en-GB serving caption track", async () => {
  const data = studioAuditFixture();
  data.captions.set("studio-video-1", []);

  const report = await auditSystemTraceYouTubeBuffer(data.input);

  assert.equal(report.verdict, "RED");
  assert.ok(
    report.blockers.includes(
      "system-trace-frame-pacing:youtube_manual_caption_track_missing",
    ),
  );
  assert.equal(report.episodes[0].checks.caption_manual_track_unique, false);
});
