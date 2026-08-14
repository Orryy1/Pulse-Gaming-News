"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildGovernedYouTubeScheduleBinding,
} = require("../../lib/services/governed-youtube-scheduled-release");
const {
  main,
  parseArgs,
} = require("../../tools/governed-youtube-scheduled-release");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pulse-schedule-cli-"));
  const packageDir = path.join(root, "videos", "story-one");
  await fs.ensureDir(packageDir);
  await fs.writeFile(path.join(packageDir, "final.mp4"), Buffer.from("video"));
  await fs.writeFile(
    path.join(packageDir, "captions.srt"),
    "1\n00:00:00,000 --> 00:00:01,000\nExact captions\n",
  );
  const captionsSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(path.join(packageDir, "captions.srt")))
    .digest("hex");
  const episode = {
    story_id: "story-one",
    project_dir: "videos/story-one",
    publish_at_utc: "2026-08-15T19:00:00Z",
    title: "Exact title",
    description: "Exact description",
    tags: ["one", "two"],
  };
  const manifestPath = path.join(root, "videos", "buffer.json");
  const manifest = {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_v1",
    channel: { id: "channel-1", title: "Pulse Gaming" },
    episodes: [episode],
  };
  await fs.writeJson(manifestPath, manifest);
  await fs.writeJson(path.join(packageDir, "youtube_publish_pack.json"), {
    schema_version: 1,
    story_id: episode.story_id,
    platform: "youtube_shorts",
    title: episode.title,
    description: episode.description,
    captions: { file: "captions.srt", sha256: captionsSha256 },
    youtube_upload_request: {
      video_file: "final.mp4",
      snippet: {
        title: episode.title,
        description: episode.description,
        tags: episode.tags,
        categoryId: "20",
        defaultLanguage: "en-GB",
        defaultAudioLanguage: "en-GB",
      },
      status: {
        privacyStatus: "private",
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: true,
        license: "youtube",
        embeddable: true,
        publicStatsViewable: true,
      },
      notifySubscribers: false,
      captions: {
        file: "captions.srt",
        sha256: captionsSha256,
        language: "en-GB",
        name: "English (United Kingdom)",
        isDraft: false,
      },
    },
  });
  const privateReceiptPath = path.join(
    root,
    "receipts",
    "private",
    `${episode.story_id}-private-upload-receipt.json`,
  );
  await fs.ensureDir(path.dirname(privateReceiptPath));
  await fs.writeJson(privateReceiptPath, {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    story_id: episode.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: "video-1", privacy_status: "private" },
    requests: {
      video: {
        media_sha256: crypto.createHash("sha256").update("video").digest("hex"),
      },
    },
    authority: { action_id: `${episode.story_id}:youtube:private` },
    readback: { captions_present: true },
  });
  const authorityPath = path.join(root, "buffer-authority.json");
  const publishAt = new Date(episode.publish_at_utc).toISOString();
  await fs.writeJson(authorityPath, {
    schema_version: 1,
    platform: "youtube",
    story_id: episode.story_id,
    verdict: "GREEN",
    publish_allowed: true,
    captions_sha256: captionsSha256,
    control_tower: { verdict: "GREEN" },
    operator_decision: { operator_id: "MORR" },
    dispatch: {
      action_id: `${episode.story_id}:youtube:private`,
      receipt_path: privateReceiptPath,
    },
    release: {
      verdict: "GREEN",
      authority_scope: "EXACT_YOUTUBE_NATIVE_SCHEDULE_ONLY",
      channel_id: manifest.channel.id,
      publish_at_utc: publishAt,
      public_schedule_allowed: true,
      auto_publish_general_allowed: false,
      notify_subscribers: false,
      action_id: `${episode.story_id}:youtube:schedule:${publishAt}`,
    },
    buffer_authority: {
      manifest_sha256: crypto.createHash("sha256").update(await fs.readFile(manifestPath)).digest("hex"),
    },
  });
  return {
    root,
    packageDir,
    manifestPath,
    authorityPath,
    privateReceiptPath,
    receiptOut: path.join(
      root,
      "receipts",
      "schedule",
      `${episode.story_id}-schedule-receipt.json`,
    ),
    episode,
  };
}

function remote(fixtureData, publishAt) {
  const status = {
    privacyStatus: "private",
    uploadStatus: "processed",
    license: "youtube",
    embeddable: true,
    publicStatsViewable: true,
    selfDeclaredMadeForKids: false,
  };
  if (publishAt) status.publishAt = publishAt;
  return {
    id: "video-1",
    snippet: {
      channelId: "channel-1",
      title: fixtureData.episode.title,
      description: fixtureData.episode.description,
      tags: [...fixtureData.episode.tags].reverse(),
      categoryId: "20",
      defaultLanguage: "en-GB",
      defaultAudioLanguage: "en-GB",
    },
    status,
    contentDetails: { caption: "true" },
    processingDetails: { processingStatus: "succeeded" },
    fileDetails: { fileSize: "5" },
  };
}

test("CLI reserves its one-use receipt before auth and schedules the manifest time", async () => {
  const data = await fixture();
  const operations = [];
  const reads = [remote(data), remote(data, "2026-08-15T19:00:00.000Z")];
  const client = {
    videos: {
      list: async () => ({ data: { items: [reads.shift()] } }),
      update: async (request, options) => {
        operations.push({ request, options });
        return { data: { id: "video-1" } };
      },
    },
  };
  const result = await main(
    [
      "--package-dir", data.packageDir,
      "--manifest", data.manifestPath,
      "--buffer-authority", data.authorityPath,
      "--private-receipt", data.privateReceiptPath,
      "--receipt-out", data.receiptOut,
      "--confirm-story-id", data.episode.story_id,
      "--apply-schedule",
    ],
    {
      authenticatedYoutubeClientFactory: async () => {
        const reserved = await fs.readJson(data.receiptOut);
        assert.equal(reserved.status, "SCHEDULE_ATTEMPT_RESERVED");
        return client;
      },
      log: () => {},
    },
  );
  assert.equal(result.receipt.verdict, "GREEN");
  assert.equal(result.receipt.publish_at_utc, "2026-08-15T19:00:00.000Z");
  assert.equal(operations.length, 1);
  assert.equal(operations[0].request.part[0], "status");
  assert.equal(operations[0].request.requestBody.status.privacyStatus, "private");
});

test("CLI rejects missing apply and replay before auth", async () => {
  assert.throws(
    () => parseArgs(["--privacy", "public"]),
    /unknown_argument/,
  );
  const data = await fixture();
  await fs.ensureDir(path.dirname(data.receiptOut));
  await fs.writeJson(data.receiptOut, { status: "existing" });
  let authCalls = 0;
  await assert.rejects(
    main(
      [
        "--package-dir", data.packageDir,
        "--manifest", data.manifestPath,
        "--buffer-authority", data.authorityPath,
        "--private-receipt", data.privateReceiptPath,
        "--receipt-out", data.receiptOut,
        "--confirm-story-id", data.episode.story_id,
        "--apply-schedule",
      ],
      { authenticatedYoutubeClientFactory: async () => { authCalls += 1; } },
    ),
    /deferred_source_receipt_blocked/,
  );
  assert.equal(authCalls, 0);
});

async function writeRedScheduleReceipt(data) {
  const publishAt = new Date(data.episode.publish_at_utc).toISOString();
  const intent = {
    story_id: data.episode.story_id,
    video_id: "video-1",
    channel_id: "channel-1",
    publish_at_utc: publishAt,
    title: data.episode.title,
    description: data.episode.description,
    tags: data.episode.tags,
    category_id: "20",
    default_language: "en-GB",
    default_audio_language: "en-GB",
    video_bytes: 5,
    contains_synthetic_media: true,
  };
  const authority = {
    action_id: `${data.episode.story_id}:youtube:schedule:${publishAt}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(intent),
  };
  await fs.ensureDir(path.dirname(data.receiptOut));
  await fs.writeJson(data.receiptOut, {
    schema_version: 1,
    receipt_type: "governed_youtube_scheduled_release",
    generated_at: "2026-08-14T19:14:14.447Z",
    story_id: data.episode.story_id,
    platform: "youtube",
    video_id: "video-1",
    channel_id: "channel-1",
    publish_at_utc: publishAt,
    authority,
    retry_allowed: false,
    request_scope: "videos.update:status_only",
    verdict: "RED",
    status: "SCHEDULE_READBACK_FAILED",
    visibility_update_count: 1,
    update_response_ambiguous: false,
    readback: {
      id: "video-1",
      channel_id: "channel-1",
      title: data.episode.title,
      description: data.episode.description,
      tags: [...data.episode.tags].sort((a, b) => a.localeCompare(b)),
      category_id: "20",
      default_language: "en-GB",
      default_audio_language: "en-GB",
      privacy_status: "private",
      publish_at_utc: null,
      upload_status: "processed",
      processing_status: "succeeded",
      licence: "youtube",
      embeddable: true,
      public_stats_viewable: true,
      self_declared_made_for_kids: false,
      captions_present: true,
      file_size: "5",
    },
    blockers: ["publish_at_mismatch"],
  });
}

test("CLI preserves exact schedule RED and exclusively materialises a GREEN sibling", async () => {
  const data = await fixture();
  await writeRedScheduleReceipt(data);
  const sourceBefore = await fs.readFile(data.receiptOut);
  const reconciliationPath = path.join(
    path.dirname(data.receiptOut),
    `${data.episode.story_id}-schedule-reconciliation.json`,
  );
  let updates = 0;
  const deps = {
    authenticatedYoutubeClientFactory: async () => ({
      videos: {
        list: async () => ({
          data: { items: [remote(data, "2026-08-15T19:00:00Z")] },
        }),
        update: async () => { updates += 1; },
      },
    }),
    log: () => {},
  };
  const argv = [
    "--package-dir", data.packageDir,
    "--manifest", data.manifestPath,
    "--buffer-authority", data.authorityPath,
    "--private-receipt", data.privateReceiptPath,
    "--receipt-out", data.receiptOut,
    "--confirm-story-id", data.episode.story_id,
    "--apply-schedule",
  ];
  const result = await main(argv, deps);
  assert.equal(result.receipt.verdict, "GREEN");
  assert.equal(result.receipt.status, "SCHEDULE_VERIFIED");
  assert.equal(result.receipt.remote_mutation_count, 0);
  assert.equal(updates, 0);
  assert.deepEqual(await fs.readFile(data.receiptOut), sourceBefore);
  const proofBefore = await fs.readFile(reconciliationPath);
  const replay = await main(argv, deps);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(await fs.readFile(reconciliationPath), proofBefore);
  assert.equal(updates, 0);
});

async function writeDeferredPrivateEvidence(data, { tamperProof = false } = {}) {
  const videoSha256 = crypto.createHash("sha256").update("video").digest("hex");
  const actionId = `${data.episode.story_id}:youtube:private`;
  const readback = {
    id: "video-1",
    channel_id: "channel-1",
    title: data.episode.title,
    description: data.episode.description,
    tags: [...data.episode.tags].sort((a, b) => a.localeCompare(b)),
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
    file_size: "5",
  };
  const red = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    story_id: data.episode.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "PRIVATE_RECONCILIATION_FAILED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: "video-1", privacy_status: "private" },
    requests: { video: { media_sha256: videoSha256 } },
    authority: { action_id: actionId },
    verification_outcome: "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: false,
    readback,
    blockers: ["default_language_missing"],
  };
  await fs.writeJson(data.privateReceiptPath, red);
  const sourceSha256 = crypto
    .createHash("sha256")
    .update(await fs.readFile(data.privateReceiptPath))
    .digest("hex");
  const proofPath = path.join(
    path.dirname(data.privateReceiptPath),
    `${data.episode.story_id}-private-upload-reconciliation.json`,
  );
  await fs.writeJson(proofPath, {
    schema_version: 1,
    receipt_type: "governed_youtube_private_reconciliation",
    story_id: data.episode.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: "video-1", privacy_status: "private" },
    requests: { video: { media_sha256: videoSha256 } },
    authority: { action_id: actionId },
    verification_outcome: "DEFERRED_LANGUAGE_READBACK_VERIFIED",
    remote_mutation_count: tamperProof ? 1 : 0,
    source_receipt: {
      sha256: sourceSha256,
      verdict: "RED",
      status: "PRIVATE_RECONCILIATION_FAILED",
      blocker: "default_language_missing",
    },
    readback: { ...readback, default_language: "en-GB" },
  });
  return proofPath;
}

test("CLI schedules from exact RED plus derived GREEN reconciliation evidence", async () => {
  const data = await fixture();
  await writeDeferredPrivateEvidence(data);
  const reads = [remote(data), remote(data, "2026-08-15T19:00:00.000Z")];
  const result = await main(
    [
      "--package-dir", data.packageDir,
      "--manifest", data.manifestPath,
      "--buffer-authority", data.authorityPath,
      "--private-receipt", data.privateReceiptPath,
      "--receipt-out", data.receiptOut,
      "--confirm-story-id", data.episode.story_id,
      "--apply-schedule",
    ],
    {
      authenticatedYoutubeClientFactory: async () => ({
        videos: {
          list: async () => ({ data: { items: [reads.shift()] } }),
          update: async () => ({ data: { id: "video-1" } }),
        },
      }),
      log: () => {},
    },
  );
  assert.equal(result.receipt.verdict, "GREEN");
  assert.equal(
    result.receipt.private_readiness.evidence_kind,
    "DEFERRED_RECONCILIATION",
  );
  assert.match(result.receipt.private_readiness.reconciliation_sha256, /^[a-f0-9]{64}$/);
});

test("CLI rejects tampered reconciliation and alternate schedule receipt paths before auth", async () => {
  const data = await fixture();
  await writeDeferredPrivateEvidence(data, { tamperProof: true });
  const baseArgs = [
    "--package-dir", data.packageDir,
    "--manifest", data.manifestPath,
    "--buffer-authority", data.authorityPath,
    "--private-receipt", data.privateReceiptPath,
    "--receipt-out", data.receiptOut,
    "--confirm-story-id", data.episode.story_id,
    "--apply-schedule",
  ];
  let authCalls = 0;
  await assert.rejects(
    main(baseArgs, { authenticatedYoutubeClientFactory: async () => { authCalls += 1; } }),
    /deferred_green_proof_blocked/,
  );
  assert.equal(authCalls, 0);

  const cleanData = await fixture();
  const alternate = path.join(cleanData.root, "alternate-schedule-receipt.json");
  const alternateArgs = [
    "--package-dir", cleanData.packageDir,
    "--manifest", cleanData.manifestPath,
    "--buffer-authority", cleanData.authorityPath,
    "--private-receipt", cleanData.privateReceiptPath,
    "--receipt-out", alternate,
    "--confirm-story-id", cleanData.episode.story_id,
    "--apply-schedule",
  ];
  await assert.rejects(
    main(alternateArgs, { authenticatedYoutubeClientFactory: async () => { authCalls += 1; } }),
    /receipt_out_not_bound_by_buffer_authority/,
  );
  assert.equal(authCalls, 0);
});

test("CLI rejects a missing or tampered fixed local SRT binding before auth", async () => {
  for (const mutation of ["missing", "tampered_hash"]) {
    const data = await fixture();
    if (mutation === "missing") {
      await fs.remove(path.join(data.packageDir, "captions.srt"));
    } else {
      const packPath = path.join(data.packageDir, "youtube_publish_pack.json");
      const pack = await fs.readJson(packPath);
      pack.youtube_upload_request.captions.sha256 = "f".repeat(64);
      await fs.writeJson(packPath, pack);
    }
    let authCalls = 0;
    await assert.rejects(
      main(
        [
          "--package-dir", data.packageDir,
          "--manifest", data.manifestPath,
          "--buffer-authority", data.authorityPath,
          "--private-receipt", data.privateReceiptPath,
          "--receipt-out", data.receiptOut,
          "--confirm-story-id", data.episode.story_id,
          "--apply-schedule",
        ],
        { authenticatedYoutubeClientFactory: async () => { authCalls += 1; } },
      ),
      /ENOENT|exact_local_caption_binding_required/,
    );
    assert.equal(authCalls, 0);
  }
});
