"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  executeDeferredSystemTraceYouTubeStudioReconciliation,
  executeSystemTraceYouTubeStudioReconcile,
} = require("../../lib/services/system-trace-youtube-studio-reconcile");

function expected(overrides = {}) {
  return {
    story_id: "system-trace-frame-pacing",
    video_id: "studio-video-1",
    channel_id: "UCvgNDjtTezrpxL8oUe6mYwA",
    title: "Why 60 FPS Can Still Stutter",
    description: "Exact description",
    tags: ["60 FPS", "frame pacing", "System Trace"],
    category_id: "20",
    default_language: "en-GB",
    default_audio_language: "en-GB",
    video_bytes: 5432736,
    video_sha256: "a".repeat(64),
    authority_action_id: "system-trace-frame-pacing:youtube:private",
    ...overrides,
  };
}

function remote(intent = expected(), overrides = {}) {
  return {
    id: intent.video_id,
    snippet: {
      channelId: intent.channel_id,
      title: intent.title,
      description: intent.description,
      tags: [...intent.tags].reverse(),
      categoryId: intent.category_id,
      defaultLanguage: intent.default_language,
      defaultAudioLanguage: intent.default_audio_language,
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
    processingDetails: {
      processingStatus: "succeeded",
      ...(overrides.processingDetails || {}),
    },
    fileDetails: {
      fileSize: String(intent.video_bytes),
      ...(overrides.fileDetails || {}),
    },
  };
}

function fakeClient(items) {
  const state = { listCalls: [], updateCalls: [] };
  let index = 0;
  return {
    state,
    videos: {
      async list(request, options) {
        state.listCalls.push({ request, options });
        const item = items[Math.min(index, items.length - 1)];
        index += 1;
        return { data: { items: item ? [item] : [] } };
      },
      async update(request, options) {
        state.updateCalls.push({ request, options });
        return { data: {} };
      },
    },
  };
}

function deferredRedReceipt(intent = expected(), overrides = {}) {
  const missing = remote(intent);
  delete missing.snippet.defaultLanguage;
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    generated_at: "2026-08-14T19:02:58.301Z",
    story_id: intent.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "PRIVATE_RECONCILIATION_FAILED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: intent.video_id, privacy_status: "private" },
    requests: { video: { media_sha256: intent.video_sha256 } },
    authority: { action_id: intent.authority_action_id },
    verification_outcome: "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: false,
    readback: {
      id: missing.id,
      channel_id: missing.snippet.channelId,
      title: missing.snippet.title,
      description: missing.snippet.description,
      tags: [...intent.tags].sort((a, b) => a.localeCompare(b)),
      category_id: missing.snippet.categoryId,
      default_language: "",
      default_audio_language: missing.snippet.defaultAudioLanguage,
      privacy_status: missing.status.privacyStatus,
      upload_status: missing.status.uploadStatus,
      processing_status: missing.processingDetails.processingStatus,
      licence: missing.status.license,
      embeddable: missing.status.embeddable,
      public_stats_viewable: missing.status.publicStatsViewable,
      self_declared_made_for_kids: missing.status.selfDeclaredMadeForKids,
      captions_present: true,
      file_size: missing.fileDetails.fileSize,
    },
    blockers: ["default_language_missing"],
    ...overrides,
  };
}

test("accepts an exact Studio-created private upload without mutation", async () => {
  const intent = expected();
  const client = fakeClient([remote(intent)]);
  const receipt = await executeSystemTraceYouTubeStudioReconcile({
    client,
    intent,
    generatedAt: "2026-08-14T20:00:00.000Z",
  });

  assert.equal(receipt.verdict, "GREEN");
  assert.equal(receipt.status, "PRIVATE_VERIFIED");
  assert.equal(receipt.studio_ingest, true);
  assert.equal(receipt.snippet_update_count, 0);
  assert.deepEqual(receipt.platform_object, {
    video_id: intent.video_id,
    privacy_status: "private",
  });
  assert.equal(receipt.requests.video.media_sha256, intent.video_sha256);
  assert.equal(client.state.updateCalls.length, 0);
  assert.deepEqual(client.state.listCalls[0].options, {
    retry: false,
    timeout: 30000,
  });
});

test("repairs only a missing defaultLanguage with one preserving snippet update", async () => {
  const intent = expected();
  const before = remote(intent, { snippet: { defaultLanguage: undefined } });
  delete before.snippet.defaultLanguage;
  const client = fakeClient([before, remote(intent)]);
  const receipt = await executeSystemTraceYouTubeStudioReconcile({ client, intent });

  assert.equal(receipt.status, "PRIVATE_VERIFIED");
  assert.equal(receipt.verification_outcome, "LANGUAGE_REPAIRED_AND_VERIFIED");
  assert.equal(receipt.snippet_update_count, 1);
  assert.equal(client.state.updateCalls.length, 1);
  assert.deepEqual(client.state.updateCalls[0], {
    request: {
      part: ["snippet"],
      requestBody: {
        id: intent.video_id,
        snippet: {
          title: intent.title,
          description: intent.description,
          tags: intent.tags,
          categoryId: intent.category_id,
          defaultLanguage: "en-GB",
          defaultAudioLanguage: "en-GB",
        },
      },
    },
    options: { retry: false, timeout: 30000 },
  });
});

test("rejects any mismatch other than missing defaultLanguage without mutation", async () => {
  const intent = expected();
  const client = fakeClient([
    remote(intent, { status: { privacyStatus: "public" }, snippet: { defaultLanguage: undefined } }),
  ]);

  await assert.rejects(
    executeSystemTraceYouTubeStudioReconcile({ client, intent }),
    (error) => {
      assert.equal(error.message, "system_trace_youtube_studio_reconcile_blocked");
      assert.ok(error.blockers.includes("privacy_status_mismatch"));
      assert.ok(error.blockers.includes("default_language_missing"));
      return true;
    },
  );
  assert.equal(client.state.updateCalls.length, 0);
});

test("title and description matching is byte-for-byte apart from API JSON encoding", async () => {
  const intent = expected();
  const client = fakeClient([
    remote(intent, { snippet: { description: `${intent.description} ` } }),
  ]);
  await assert.rejects(
    executeSystemTraceYouTubeStudioReconcile({ client, intent }),
    (error) => error.blockers.includes("description_mismatch"),
  );
  assert.equal(client.state.updateCalls.length, 0);
});

test("does not retry an ambiguous update and accepts only exact readback", async () => {
  const intent = expected();
  const before = remote(intent);
  delete before.snippet.defaultLanguage;
  const client = fakeClient([before, remote(intent)]);
  client.videos.update = async (request, options) => {
    client.state.updateCalls.push({ request, options });
    throw new Error("socket closed");
  };

  const receipt = await executeSystemTraceYouTubeStudioReconcile({ client, intent });
  assert.equal(receipt.status, "PRIVATE_VERIFIED");
  assert.equal(
    receipt.verification_outcome,
    "RECONCILED_AFTER_AMBIGUOUS_LANGUAGE_UPDATE",
  );
  assert.equal(receipt.update_response_ambiguous, true);
  assert.equal(client.state.updateCalls.length, 1);
  assert.equal(client.state.listCalls.length, 2);
});

test("an ambiguous update with a non-exact readback is terminal", async () => {
  const intent = expected();
  const missing = remote(intent);
  delete missing.snippet.defaultLanguage;
  const client = fakeClient([missing, missing]);
  client.videos.update = async (request, options) => {
    client.state.updateCalls.push({ request, options });
    throw new Error("socket closed");
  };

  await assert.rejects(
    executeSystemTraceYouTubeStudioReconcile({ client, intent }),
    (error) => {
      assert.equal(error.message, "system_trace_youtube_studio_reconcile_outcome_unknown");
      assert.equal(error.receipt.retry_allowed, false);
      assert.equal(error.receipt.snippet_update_count, 1);
      return true;
    },
  );
  assert.equal(client.state.updateCalls.length, 1);
  assert.equal(client.state.listCalls.length, 2);
});

test("turns the exact self-produced deferred RED receipt into a GREEN read-only proof", async () => {
  const intent = expected();
  const client = fakeClient([remote(intent)]);
  const proof = await executeDeferredSystemTraceYouTubeStudioReconciliation({
    client,
    intent,
    sourceReceipt: deferredRedReceipt(intent),
    sourceReceiptSha256: "b".repeat(64),
    generatedAt: "2026-08-14T19:05:00.000Z",
  });

  assert.equal(proof.verdict, "GREEN");
  assert.equal(proof.status, "PRIVATE_VERIFIED");
  assert.equal(proof.receipt_type, "governed_youtube_private_reconciliation");
  assert.equal(proof.remote_mutation_count, 0);
  assert.equal(proof.source_receipt.sha256, "b".repeat(64));
  assert.equal(client.state.updateCalls.length, 0);
  assert.equal(client.state.listCalls.length, 1);
});

test("deferred RED reconciliation is read-only and fails on ambiguity or tampering", async () => {
  const intent = expected();
  const stillMissing = remote(intent);
  delete stillMissing.snippet.defaultLanguage;
  const client = fakeClient([stillMissing]);
  await assert.rejects(
    executeDeferredSystemTraceYouTubeStudioReconciliation({
      client,
      intent,
      sourceReceipt: deferredRedReceipt(intent),
      sourceReceiptSha256: "c".repeat(64),
    }),
    /exact_readback_blocked/,
  );
  assert.equal(client.state.updateCalls.length, 0);

  const tampered = deferredRedReceipt(intent, {
    blockers: ["default_language_missing", "privacy_status_mismatch"],
  });
  await assert.rejects(
    executeDeferredSystemTraceYouTubeStudioReconciliation({
      client: fakeClient([remote(intent)]),
      intent,
      sourceReceipt: tampered,
      sourceReceiptSha256: "c".repeat(64),
    }),
    /source_receipt_blocked/,
  );
});
