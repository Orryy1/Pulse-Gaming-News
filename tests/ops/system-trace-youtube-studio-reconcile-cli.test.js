"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const fs = require("fs-extra");

const {
  main,
  parseArgs,
} = require("../../tools/system-trace-youtube-studio-reconcile");

async function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
}

async function fixture({
  manifestFile = "system-trace-youtube-buffer.json",
} = {}) {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "pulse-studio-reconcile-"),
  );
  const repoRoot = path.join(root, "repo");
  const evidenceRoot = path.join(root, "evidence");
  const storyId = "system-trace-frame-pacing";
  const packageDir = path.join(repoRoot, "videos", storyId);
  await fs.ensureDir(path.join(packageDir, "renders"));
  const videoPath = path.join(packageDir, "renders", `${storyId}.mp4`);
  await fs.writeFile(videoPath, Buffer.from("video"));
  const episode = {
    story_id: storyId,
    project_dir: `videos/${storyId}`,
    publish_at_utc: "2026-08-15T19:00:00Z",
    title: "Why 60 FPS Can Still Stutter",
    description: "Exact description",
    tags: ["frame pacing", "60 FPS", "System Trace"],
  };
  const manifest = {
    schema_version: 1,
    schema: "pulse_system_trace_youtube_buffer_v1",
    channel: { id: "UCvgNDjtTezrpxL8oUe6mYwA", title: "Pulse Gaming" },
    episodes: [episode],
  };
  const manifestPath = path.join(repoRoot, "videos", manifestFile);
  await fs.writeJson(manifestPath, manifest);
  const videoSha256 = await sha256(videoPath);
  await fs.writeJson(path.join(packageDir, "youtube_publish_pack.json"), {
    schema_version: 1,
    story_id: storyId,
    platform: "youtube_shorts",
    title: episode.title,
    description: episode.description,
    tags: episode.tags,
    youtube_upload_request: {
      video_file: `renders/${storyId}.mp4`,
      video_sha256: videoSha256,
      notifySubscribers: false,
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
    },
  });
  const receiptPath = path.join(
    evidenceRoot,
    "receipts",
    "private",
    `${storyId}-private-upload-receipt.json`,
  );
  const authorityPath = path.join(
    evidenceRoot,
    "authorities",
    "private",
    `${storyId}-authority.json`,
  );
  await fs.ensureDir(path.dirname(authorityPath));
  await fs.writeJson(authorityPath, {
    schema_version: 1,
    platform: "youtube",
    story_id: storyId,
    verdict: "GREEN",
    publish_allowed: true,
    video_sha256: videoSha256,
    control_tower: {
      verdict: "GREEN",
      scope: "EXACT_PRIVATE_FIRST_UPLOAD_ONLY",
    },
    dispatch: {
      action_id: `${storyId}:youtube:private`,
      mode: "PRIVATE_FIRST",
      single_use: true,
      receipt_path: receiptPath,
    },
    operator_decision: { operator_id: "MORR" },
    evidence_binding: { manifest_sha256: await sha256(manifestPath) },
  });
  return { repoRoot, evidenceRoot, episode, receiptPath, videoSha256 };
}

function remote(data, overrides = {}) {
  const video = {
    id: "studioAbc1",
    snippet: {
      channelId: "UCvgNDjtTezrpxL8oUe6mYwA",
      title: data.episode.title,
      description: data.episode.description,
      tags: [...data.episode.tags].reverse(),
      categoryId: "20",
      defaultLanguage: "en-GB",
      defaultAudioLanguage: "en-GB",
      ...(overrides.snippet || {}),
    },
    status: {
      privacyStatus: "private",
      uploadStatus: "processed",
      license: "youtube",
      embeddable: true,
      publicStatsViewable: true,
      selfDeclaredMadeForKids: false,
      ...(overrides.status || {}),
    },
    contentDetails: { caption: "true", ...(overrides.contentDetails || {}) },
    processingDetails: { processingStatus: "succeeded" },
    fileDetails: { fileSize: "5" },
  };
  if (overrides.removeDefaultLanguage) delete video.snippet.defaultLanguage;
  return video;
}

function deferredRedReceipt(data, overrides = {}) {
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: "2026-08-14T19:02:58.301Z",
    story_id: data.episode.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "PRIVATE_RECONCILIATION_FAILED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: "studioAbc1", privacy_status: "private" },
    requests: { video: { media_sha256: data.videoSha256 } },
    authority: { action_id: `${data.episode.story_id}:youtube:private` },
    verification_outcome: "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: false,
    readback: {
      id: "studioAbc1",
      channel_id: "UCvgNDjtTezrpxL8oUe6mYwA",
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
    },
    blockers: ["default_language_missing"],
    ...overrides,
  };
}

function authPreflightRedReceipt(data, overrides = {}) {
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: "2026-08-20T09:58:34.466Z",
    story_id: data.episode.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "STUDIO_RECONCILIATION_ATTEMPT_BLOCKED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: "studioAbc1", privacy_status: "private" },
    requests: { video: { media_sha256: data.videoSha256 } },
    authority: { action_id: `${data.episode.story_id}:youtube:private` },
    blockers: ["youtube_auth_must_be_current_before_studio_reconcile"],
    ...overrides,
  };
}

test("fixed CLI reserves the authority receipt and verifies a Studio ingest", async () => {
  const data = await fixture();
  const client = {
    videos: {
      list: async () => {
        const reserved = await fs.readJson(data.receiptPath);
        assert.equal(reserved.status, "STUDIO_RECONCILIATION_ATTEMPT_RESERVED");
        return { data: { items: [remote(data)] } };
      },
      update: async () => assert.fail("no update expected"),
    },
  };
  const result = await main(
    [
      "--confirm-story-id",
      data.episode.story_id,
      "--video-id",
      "studioAbc1",
      "--apply-reconcile",
    ],
    {
      repoRoot: data.repoRoot,
      evidenceRoot: data.evidenceRoot,
      authenticatedYoutubeClientFactory: async () => {
        assert.equal(await fs.pathExists(data.receiptPath), false);
        return client;
      },
      log: () => {},
    },
  );
  assert.equal(result.receipt.verdict, "GREEN");
  assert.equal(result.receipt.status, "PRIVATE_VERIFIED");
  assert.equal(result.receipt.studio_ingest, true);
  assert.equal(result.receipt.requests.video.media_sha256, data.videoSha256);
});

test("new auth failure occurs before reservation and leaves no receipt", async () => {
  const data = await fixture();
  await assert.rejects(
    main(
      [
        "--confirm-story-id",
        data.episode.story_id,
        "--video-id",
        "studioAbc1",
        "--apply-reconcile",
      ],
      {
        repoRoot: data.repoRoot,
        evidenceRoot: data.evidenceRoot,
        authenticatedYoutubeClientFactory: async () => {
          throw new Error(
            "youtube_auth_must_be_current_before_studio_reconcile",
          );
        },
        log: () => {},
      },
    ),
    /youtube_auth_must_be_current_before_studio_reconcile/,
  );
  assert.equal(await fs.pathExists(data.receiptPath), false);
});

test("fixed CLI permits only the narrow language repair", async () => {
  const data = await fixture();
  const reads = [remote(data, { removeDefaultLanguage: true }), remote(data)];
  const updates = [];
  await main(
    [
      "--confirm-story-id",
      data.episode.story_id,
      "--video-id",
      "studioAbc1",
      "--apply-reconcile",
    ],
    {
      repoRoot: data.repoRoot,
      evidenceRoot: data.evidenceRoot,
      authenticatedYoutubeClientFactory: async () => ({
        videos: {
          list: async () => ({ data: { items: [reads.shift()] } }),
          update: async (request, options) =>
            updates.push({ request, options }),
        },
      }),
      log: () => {},
    },
  );
  assert.equal(updates.length, 1);
  assert.equal(updates[0].request.requestBody.snippet.defaultLanguage, "en-GB");
  assert.deepEqual(updates[0].options, { retry: false, timeout: 30000 });
});

test("an existing GREEN receipt is idempotent only after exact remote readback", async () => {
  const data = await fixture();
  await fs.ensureDir(path.dirname(data.receiptPath));
  await fs.writeJson(data.receiptPath, {
    schema_version: 1,
    story_id: data.episode.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    studio_ingest: true,
    authority: { action_id: `${data.episode.story_id}:youtube:private` },
    platform_object: { video_id: "studioAbc1", privacy_status: "private" },
    requests: { video: { media_sha256: data.videoSha256 } },
  });
  let updates = 0;
  const result = await main(
    [
      "--confirm-story-id",
      data.episode.story_id,
      "--video-id",
      "studioAbc1",
      "--apply-reconcile",
    ],
    {
      repoRoot: data.repoRoot,
      evidenceRoot: data.evidenceRoot,
      authenticatedYoutubeClientFactory: async () => ({
        videos: {
          list: async () => ({ data: { items: [remote(data)] } }),
          update: async () => {
            updates += 1;
          },
        },
      }),
      log: () => {},
    },
  );
  assert.equal(result.idempotent, true);
  assert.equal(updates, 0);
});

test("accepts only the fixed display-pipeline campaign selector", () => {
  assert.equal(
    parseArgs(["--campaign", "display-pipeline"]).campaign,
    "display-pipeline",
  );
  assert.throws(
    () => parseArgs(["--campaign", "caller-controlled"]),
    /campaign_not_supported/,
  );
});

test("display-pipeline mode reads the fixed campaign manifest and evidence root", async () => {
  const data = await fixture({
    manifestFile: "system-trace-display-pipeline-youtube-buffer.json",
  });
  const result = await main(
    [
      "--campaign",
      "display-pipeline",
      "--confirm-story-id",
      data.episode.story_id,
      "--video-id",
      "studioAbc1",
      "--apply-reconcile",
    ],
    {
      repoRoot: data.repoRoot,
      evidenceRoot: data.evidenceRoot,
      authenticatedYoutubeClientFactory: async () => ({
        videos: {
          list: async () => ({ data: { items: [remote(data)] } }),
          update: async () => assert.fail("no update expected"),
        },
      }),
      log: () => {},
    },
  );
  assert.equal(result.receipt.status, "PRIVATE_VERIFIED");
});

test("rejects expanded CLI authority and invalid replay before authentication", async () => {
  assert.throws(
    () => parseArgs(["--receipt-out", "elsewhere.json"]),
    /unknown_argument/,
  );
  const data = await fixture();
  await fs.ensureDir(path.dirname(data.receiptPath));
  await fs.writeJson(data.receiptPath, { verdict: "RED", status: "failed" });
  let authCalls = 0;
  await assert.rejects(
    main(
      [
        "--confirm-story-id",
        data.episode.story_id,
        "--video-id",
        "studioAbc1",
        "--apply-reconcile",
      ],
      {
        repoRoot: data.repoRoot,
        evidenceRoot: data.evidenceRoot,
        authenticatedYoutubeClientFactory: async () => {
          authCalls += 1;
        },
      },
    ),
    /deferred_source_receipt_blocked/,
  );
  assert.equal(authCalls, 0);
});

test("deferred RED becomes a separate exclusive GREEN proof after exact readback", async () => {
  const data = await fixture();
  const reconciliationPath = path.join(
    data.evidenceRoot,
    "receipts",
    "private",
    `${data.episode.story_id}-private-upload-reconciliation.json`,
  );
  await fs.ensureDir(path.dirname(data.receiptPath));
  await fs.writeJson(data.receiptPath, deferredRedReceipt(data), { spaces: 2 });
  const redBefore = await fs.readFile(data.receiptPath);
  let updates = 0;
  const result = await main(
    [
      "--confirm-story-id",
      data.episode.story_id,
      "--video-id",
      "studioAbc1",
      "--apply-reconcile",
    ],
    {
      repoRoot: data.repoRoot,
      evidenceRoot: data.evidenceRoot,
      authenticatedYoutubeClientFactory: async () => {
        assert.equal(await fs.pathExists(reconciliationPath), false);
        return {
          videos: {
            list: async () => ({ data: { items: [remote(data)] } }),
            update: async () => {
              updates += 1;
            },
          },
        };
      },
      log: () => {},
    },
  );
  assert.equal(result.receipt.verdict, "GREEN");
  assert.equal(result.receipt.status, "PRIVATE_VERIFIED");
  assert.equal(result.receipt.remote_mutation_count, 0);
  assert.equal(updates, 0);
  assert.deepEqual(await fs.readFile(data.receiptPath), redBefore);
  const proof = await fs.readJson(reconciliationPath);
  assert.equal(proof.source_receipt.sha256, await sha256(data.receiptPath));
});

test("an exact historical auth-preflight RED seals a source-linked read-only GREEN proof", async () => {
  const data = await fixture();
  const reconciliationPath = path.join(
    data.evidenceRoot,
    "receipts",
    "private",
    `${data.episode.story_id}-private-upload-reconciliation.json`,
  );
  await fs.ensureDir(path.dirname(data.receiptPath));
  await fs.writeJson(data.receiptPath, authPreflightRedReceipt(data), {
    spaces: 2,
  });
  const redBefore = await fs.readFile(data.receiptPath);
  let updates = 0;
  const result = await main(
    [
      "--confirm-story-id",
      data.episode.story_id,
      "--video-id",
      "studioAbc1",
      "--apply-reconcile",
    ],
    {
      repoRoot: data.repoRoot,
      evidenceRoot: data.evidenceRoot,
      authenticatedYoutubeClientFactory: async () => ({
        videos: {
          list: async () => ({ data: { items: [remote(data)] } }),
          update: async () => {
            updates += 1;
          },
        },
      }),
      log: () => {},
    },
  );
  assert.equal(
    result.receipt.verification_outcome,
    "DEFERRED_AUTH_PREFLIGHT_READBACK_VERIFIED",
  );
  assert.equal(result.receipt.remote_mutation_count, 0);
  assert.equal(updates, 0);
  assert.deepEqual(await fs.readFile(data.receiptPath), redBefore);
  const proof = await fs.readJson(reconciliationPath);
  assert.equal(proof.source_receipt.sha256, await sha256(data.receiptPath));
  assert.equal(
    proof.source_receipt.blocker,
    "youtube_auth_must_be_current_before_studio_reconcile",
  );
});

test("deferred proof replay is read-only and tamper-evident", async () => {
  const data = await fixture();
  const reconciliationPath = path.join(
    data.evidenceRoot,
    "receipts",
    "private",
    `${data.episode.story_id}-private-upload-reconciliation.json`,
  );
  await fs.ensureDir(path.dirname(data.receiptPath));
  await fs.writeJson(data.receiptPath, deferredRedReceipt(data));
  const client = {
    videos: {
      list: async () => ({ data: { items: [remote(data)] } }),
      update: async () => assert.fail("deferred path must never update"),
    },
  };
  const deps = {
    repoRoot: data.repoRoot,
    evidenceRoot: data.evidenceRoot,
    authenticatedYoutubeClientFactory: async () => client,
    log: () => {},
  };
  const argv = [
    "--confirm-story-id",
    data.episode.story_id,
    "--video-id",
    "studioAbc1",
    "--apply-reconcile",
  ];
  await main(argv, deps);
  const proofBefore = await fs.readFile(reconciliationPath);
  const replay = await main(argv, deps);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(await fs.readFile(reconciliationPath), proofBefore);

  const tampered = await fs.readJson(reconciliationPath);
  tampered.source_receipt.sha256 = "f".repeat(64);
  await fs.writeJson(reconciliationPath, tampered);
  let authCalls = 0;
  await assert.rejects(
    main(argv, {
      ...deps,
      authenticatedYoutubeClientFactory: async () => {
        authCalls += 1;
      },
    }),
    /deferred_green_proof_blocked/,
  );
  assert.equal(authCalls, 0);
});

test("ambiguous deferred readback creates no reconciliation sibling", async () => {
  const data = await fixture();
  const reconciliationPath = path.join(
    data.evidenceRoot,
    "receipts",
    "private",
    `${data.episode.story_id}-private-upload-reconciliation.json`,
  );
  await fs.ensureDir(path.dirname(data.receiptPath));
  await fs.writeJson(data.receiptPath, deferredRedReceipt(data));
  await assert.rejects(
    main(
      [
        "--confirm-story-id",
        data.episode.story_id,
        "--video-id",
        "studioAbc1",
        "--apply-reconcile",
      ],
      {
        repoRoot: data.repoRoot,
        evidenceRoot: data.evidenceRoot,
        authenticatedYoutubeClientFactory: async () => ({
          videos: {
            list: async () => {
              throw new Error("socket closed");
            },
          },
        }),
      },
    ),
    /socket closed/,
  );
  assert.equal(await fs.pathExists(reconciliationPath), false);
});
