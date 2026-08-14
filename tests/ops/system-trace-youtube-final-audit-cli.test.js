"use strict";

const crypto = require("node:crypto");
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const manifest = require("../../videos/system-trace-youtube-buffer.json");
const {
  main,
} = require("../../tools/system-trace-youtube-final-audit");

function privateReceipt(episode, index) {
  const videoId = `video-${index + 1}`;
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
      caption_id: `caption-${index + 1}`,
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
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_scheduled_release",
    story_id: episode.story_id,
    platform: "youtube",
    video_id: `video-${index + 1}`,
    channel_id: manifest.channel.id,
    publish_at_utc: new Date(episode.publish_at_utc).toISOString(),
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
      tags: episode.tags,
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
    contentDetails: { caption: true },
    processingDetails: { processingStatus: "succeeded" },
    paidProductPlacementDetails: { hasPaidProductPlacement: false },
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function packageManifest(episode) {
  return require(path.join(
    __dirname,
    "..",
    "..",
    episode.project_dir,
    "canonical_story_manifest.json",
  ));
}

function studioReceiptPair(episode, index) {
  const canonical = packageManifest(episode);
  const videoId = `studio-video-${index + 1}`;
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
    file_size: String(canonical.final_container.bytes),
  };
  const source = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: "2026-08-14T19:00:00.000Z",
    story_id: episode.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "PRIVATE_RECONCILIATION_FAILED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: videoId, privacy_status: "private" },
    requests: { video: { media_sha256: canonical.final_container.sha256 } },
    authority: { action_id: `${episode.story_id}:youtube:private` },
    verification_outcome: "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: false,
    readback,
    blockers: ["default_language_missing"],
  };
  const sourceBytes = Buffer.from(`${JSON.stringify(source, null, 2)}\n`);
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
  );
  return {
    videoId,
    source,
    sourceBytes,
    sourceSha256,
    reconciliation,
    reconciliationBytes,
    reconciliationSha256: sha256(reconciliationBytes),
  };
}

async function fixture({ studio = false } = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-final-youtube-audit-"),
  );
  const evidenceRoot = path.join(root, "system-trace-youtube-buffer-20260814");
  const privateRoot = path.join(evidenceRoot, "receipts", "private");
  const scheduleRoot = path.join(evidenceRoot, "receipts", "schedule");
  await fs.ensureDir(privateRoot);
  await fs.ensureDir(scheduleRoot);
  for (const [index, episode] of manifest.episodes.entries()) {
    if (studio) {
      const pair = studioReceiptPair(episode, index);
      await fs.writeFile(
        path.join(privateRoot, `${episode.story_id}-private-upload-receipt.json`),
        pair.sourceBytes,
      );
      await fs.writeFile(
        path.join(privateRoot, `${episode.story_id}-private-upload-reconciliation.json`),
        pair.reconciliationBytes,
      );
      await fs.writeJson(
        path.join(scheduleRoot, `${episode.story_id}-schedule-receipt.json`),
        {
          ...scheduleReceipt(episode, index),
          video_id: pair.videoId,
          private_readiness: {
            evidence_kind: "DEFERRED_RECONCILIATION",
            canonical_receipt_sha256: pair.sourceSha256,
            reconciliation_sha256: pair.reconciliationSha256,
          },
        },
      );
    } else {
      await fs.writeJson(
        path.join(privateRoot, `${episode.story_id}-private-upload-receipt.json`),
        privateReceipt(episode, index),
      );
      await fs.writeJson(
        path.join(scheduleRoot, `${episode.story_id}-schedule-receipt.json`),
        scheduleReceipt(episode, index),
      );
    }
  }
  return {
    evidenceRoot,
    privateRoot,
    scheduleRoot,
    jsonOut: path.join(evidenceRoot, "final-youtube-buffer-audit.json"),
    markdownOut: path.join(evidenceRoot, "final-youtube-buffer-audit.md"),
  };
}

test("CLI reads only the fixed receipt layout and emits fixed JSON and Markdown proof", async () => {
  const paths = await fixture();
  const ignoredCallerOutput = path.join(path.dirname(paths.evidenceRoot), "caller-output.json");
  paths.jsonOut = ignoredCallerOutput;
  const videos = new Map();
  for (const [index, episode] of manifest.episodes.entries()) {
    videos.set(`video-${index + 1}`, remoteVideo(episode, index));
  }
  let factoryCalls = 0;
  const client = {
    videos: {
      list: async (request) => ({ data: { items: [videos.get(request.id[0])] } }),
    },
    captions: {
      list: async (request) => {
        const index = Number(request.videoId.split("-")[1]) - 1;
        return {
          data: {
            items: [{
              id: `caption-${index + 1}`,
              snippet: {
                videoId: request.videoId,
                language: "en-GB",
                name: "English (United Kingdom)",
                isDraft: false,
                trackKind: "standard",
                isAutoSynced: false,
                status: "serving",
              },
            }],
          },
        };
      },
    },
  };

  const result = await main([], {
    paths,
    authenticatedReadOnlyYoutubeClientFactory: async () => {
      factoryCalls += 1;
      return client;
    },
    generatedAt: "2026-08-14T18:30:00.000Z",
    log: () => {},
  });

  assert.equal(factoryCalls, 1);
  assert.equal(result.report.verdict, "GREEN");
  assert.equal(result.report.remote_read_request_count, 14);
  const fixedJson = path.join(paths.evidenceRoot, "final-youtube-buffer-audit.json");
  const fixedMarkdown = path.join(paths.evidenceRoot, "final-youtube-buffer-audit.md");
  assert.equal((await fs.readJson(fixedJson)).verdict, "GREEN");
  const markdown = await fs.readFile(fixedMarkdown, "utf8");
  assert.match(markdown, /Final YouTube Buffer Audit/);
  assert.match(markdown, /GREEN/);
  assert.match(markdown, /system-trace-render-queue-latency/);
  assert.deepEqual(result.artefacts, {
    json: path.resolve(paths.evidenceRoot, "final-youtube-buffer-audit.json"),
    markdown: path.resolve(paths.evidenceRoot, "final-youtube-buffer-audit.md"),
  });
  assert.equal(await fs.pathExists(ignoredCallerOutput), false);
});

test("CLI hashes the immutable Studio receipt pair and derives caption content only from the fixed package", async () => {
  const paths = await fixture({ studio: true });
  const videos = new Map();
  for (const [index, episode] of manifest.episodes.entries()) {
    const video = remoteVideo(episode, index);
    video.id = `studio-video-${index + 1}`;
    videos.set(video.id, video);
  }
  const client = {
    videos: {
      list: async (request) => ({ data: { items: [videos.get(request.id[0])] } }),
    },
    captions: {
      list: async (request) => ({
        data: {
          items: [{
            id: `studio-caption-${request.videoId.split("-").at(-1)}`,
            snippet: {
              videoId: request.videoId,
              language: "en-GB",
              name: "English (United Kingdom)",
              isDraft: false,
              trackKind: "standard",
              isAutoSynced: false,
              status: "serving",
            },
          }],
        },
      }),
    },
  };

  const result = await main([], {
    paths,
    authenticatedReadOnlyYoutubeClientFactory: async () => client,
    generatedAt: "2026-08-14T20:30:00.000Z",
    log: () => {},
  });

  assert.equal(result.report.verdict, "GREEN");
  assert.ok(
    result.report.episodes.every(
      (episode) => episode.receipt_evidence_kind === "DEFERRED_RECONCILIATION",
    ),
  );
  assert.ok(
    result.report.episodes.every(
      (episode) => episode.checks.caption_content_binding_exact === true,
    ),
  );
});
