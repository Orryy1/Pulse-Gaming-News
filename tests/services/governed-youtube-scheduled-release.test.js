"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  assertExactDeferredScheduleRedReceipt,
  buildGovernedYouTubeScheduleBinding,
  executeDeferredGovernedYouTubeScheduleReconciliation,
  executeGovernedYouTubeScheduledRelease,
  resolveGovernedYouTubePrivateReadiness,
} = require("../../lib/services/governed-youtube-scheduled-release");

const INTENT = Object.freeze({
  story_id: "system-trace-frame-pacing",
  video_id: "video-001",
  channel_id: "UCvgNDjtTezrpxL8oUe6mYwA",
  publish_at_utc: "2026-08-15T19:00:00.000Z",
  title: "Why 60 FPS Can Still Stutter",
  description: "Exact governed description.",
  tags: ["frame pacing", "PC gaming", "System Trace"],
  category_id: "20",
  default_language: "en-GB",
  default_audio_language: "en-GB",
  video_bytes: 85058949,
  contains_synthetic_media: true,
});
const TEST_NOW = new Date("2026-08-14T12:00:00.000Z");

function remoteVideo({ privacyStatus = "private", publishAt } = {}) {
  const status = {
    privacyStatus,
    uploadStatus: "processed",
    license: "youtube",
    embeddable: true,
    publicStatsViewable: true,
    selfDeclaredMadeForKids: false,
  };
  if (publishAt !== undefined) status.publishAt = publishAt;
  return {
    id: INTENT.video_id,
    snippet: {
      channelId: INTENT.channel_id,
      title: INTENT.title,
      description: INTENT.description,
      tags: [...INTENT.tags].reverse(),
      categoryId: INTENT.category_id,
      defaultLanguage: INTENT.default_language,
      defaultAudioLanguage: INTENT.default_audio_language,
    },
    status,
    contentDetails: { caption: "true" },
    processingDetails: { processingStatus: "succeeded" },
    fileDetails: { fileSize: String(INTENT.video_bytes) },
  };
}

function harness({ before, after, updateError } = {}) {
  const operations = [];
  const lists = [before || remoteVideo(), after || remoteVideo({ publishAt: INTENT.publish_at_utc })];
  return {
    operations,
    client: {
      videos: {
        list: async (request, options) => {
          operations.push({ operation: "videos.list", request, options });
          return { data: { items: [lists.shift() || lists.at(-1)] } };
        },
        update: async (request, options) => {
          operations.push({ operation: "videos.update", request, options });
          if (updateError) throw updateError;
          return { data: { id: INTENT.video_id } };
        },
      },
    },
  };
}

test("schedules one exact private processed upload with a status-only no-retry update", async () => {
  const testHarness = harness();
  const authority = {
    verdict: "GREEN",
    action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
  };

  const receipt = await executeGovernedYouTubeScheduledRelease({
    client: testHarness.client,
    intent: INTENT,
    authority,
    now: TEST_NOW,
    generatedAt: "2026-08-14T16:00:00.000Z",
  });

  assert.equal(receipt.verdict, "GREEN");
  assert.equal(receipt.status, "SCHEDULE_VERIFIED");
  assert.equal(receipt.retry_allowed, false);
  assert.equal(receipt.visibility_update_count, 1);
  assert.equal(receipt.readback.publish_at_utc, INTENT.publish_at_utc);
  assert.deepEqual(testHarness.operations.map((entry) => entry.operation), [
    "videos.list",
    "videos.update",
    "videos.list",
  ]);
  const update = testHarness.operations[1];
  assert.deepEqual(update.request.part, ["status"]);
  assert.deepEqual(update.request.requestBody, {
    id: INTENT.video_id,
    status: {
      privacyStatus: "private",
      publishAt: INTENT.publish_at_utc,
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
      license: "youtube",
      embeddable: true,
      publicStatsViewable: true,
    },
  });
  assert.equal(update.options.retry, false);
});

test("strict future guard rejects the exact clock boundary before any YouTube call", async () => {
  const testHarness = harness();
  const authority = {
    verdict: "GREEN",
    action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
  };

  await assert.rejects(
    executeGovernedYouTubeScheduledRelease({
      client: testHarness.client,
      intent: INTENT,
      authority,
      now: new Date(INTENT.publish_at_utc),
    }),
    (error) => {
      assert.equal(error.message, "governed_youtube_schedule_input_blocked");
      assert.deepEqual(error.blockers, ["publish_at_must_be_future"]);
      return true;
    },
  );
  assert.deepEqual(testHarness.operations, []);
});

test("reconciles a lost update response without issuing a second update", async () => {
  const testHarness = harness({ updateError: new Error("socket_closed") });
  const receipt = await executeGovernedYouTubeScheduledRelease({
    client: testHarness.client,
    intent: INTENT,
    authority: {
      verdict: "GREEN",
      action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
      binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
    },
    now: TEST_NOW,
  });
  assert.equal(receipt.verdict, "GREEN");
  assert.equal(receipt.status, "SCHEDULE_RECONCILED_AFTER_AMBIGUOUS_RESPONSE");
  assert.equal(
    testHarness.operations.filter((entry) => entry.operation === "videos.update").length,
    1,
  );
});

test("normalises YouTube publishAt and polls bounded readbacks without a second mutation", async () => {
  const testHarness = harness({
    after: remoteVideo(),
  });
  testHarness.client.videos.list = async (request, options) => {
    testHarness.operations.push({ operation: "videos.list", request, options });
    const call = testHarness.operations.filter((entry) => entry.operation === "videos.list").length;
    if (call <= 2) return { data: { items: [remoteVideo()] } };
    return {
      data: {
        items: [remoteVideo({ publishAt: "2026-08-15T19:00:00Z" })],
      },
    };
  };
  let waits = 0;
  const receipt = await executeGovernedYouTubeScheduledRelease({
    client: testHarness.client,
    intent: INTENT,
    authority: {
      verdict: "GREEN",
      action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
      binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
    },
    now: TEST_NOW,
    readbackAttempts: 3,
    pollIntervalMs: 1,
    wait: async () => { waits += 1; },
  });
  assert.equal(receipt.verdict, "GREEN");
  assert.equal(receipt.readback.publish_at_utc, INTENT.publish_at_utc);
  assert.equal(receipt.readback_attempt_count, 2);
  assert.equal(waits, 1);
  assert.equal(
    testHarness.operations.filter((entry) => entry.operation === "videos.update").length,
    1,
  );
});

test("blocks metadata drift and a non-private preflight before mutation", async () => {
  for (const before of [
    { ...remoteVideo(), snippet: { ...remoteVideo().snippet, title: "wrong" } },
    remoteVideo({ privacyStatus: "public" }),
  ]) {
    const testHarness = harness({ before });
    await assert.rejects(
      executeGovernedYouTubeScheduledRelease({
        client: testHarness.client,
        intent: INTENT,
        authority: {
          verdict: "GREEN",
          action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
          binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
        },
        now: TEST_NOW,
      }),
      /governed_youtube_schedule_preflight_blocked/,
    );
    assert.equal(
      testHarness.operations.filter((entry) => entry.operation === "videos.update").length,
      0,
    );
  }
});

test("ambiguous non-matching readback is permanently no-retry", async () => {
  const testHarness = harness({
    updateError: new Error("timeout"),
    after: remoteVideo(),
  });
  await assert.rejects(
    executeGovernedYouTubeScheduledRelease({
      client: testHarness.client,
      intent: INTENT,
      authority: {
        verdict: "GREEN",
        action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
        binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
      },
      now: TEST_NOW,
      readbackAttempts: 1,
    }),
    (error) => {
      assert.equal(error.receipt.verdict, "RED");
      assert.equal(error.receipt.status, "SCHEDULE_OUTCOME_UNKNOWN");
      assert.equal(error.receipt.retry_allowed, false);
      return true;
    },
  );
});

function privateIntent() {
  return {
    ...INTENT,
    video_sha256: "a".repeat(64),
    authority_action_id: `${INTENT.story_id}:youtube:private`,
  };
}

function normalisedReadback({ defaultLanguage = "en-GB" } = {}) {
  return {
    id: INTENT.video_id,
    channel_id: INTENT.channel_id,
    title: INTENT.title,
    description: INTENT.description,
    tags: [...INTENT.tags].sort((a, b) => a.localeCompare(b)),
    category_id: INTENT.category_id,
    default_language: defaultLanguage,
    default_audio_language: INTENT.default_audio_language,
    privacy_status: "private",
    upload_status: "processed",
    processing_status: "succeeded",
    licence: "youtube",
    embeddable: true,
    public_stats_viewable: true,
    self_declared_made_for_kids: false,
    captions_present: true,
    file_size: String(INTENT.video_bytes),
  };
}

function deferredReadiness() {
  const intent = privateIntent();
  const sourceSha256 = "b".repeat(64);
  const red = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    story_id: INTENT.story_id,
    platform: "youtube",
    verdict: "RED",
    status: "PRIVATE_RECONCILIATION_FAILED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: INTENT.video_id, privacy_status: "private" },
    requests: { video: { media_sha256: intent.video_sha256 } },
    authority: { action_id: intent.authority_action_id },
    verification_outcome: "LANGUAGE_REPAIR_NOT_VERIFIED",
    snippet_update_count: 1,
    update_response_ambiguous: false,
    readback: normalisedReadback({ defaultLanguage: "" }),
    blockers: ["default_language_missing"],
  };
  const green = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_reconciliation",
    story_id: INTENT.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: INTENT.video_id, privacy_status: "private" },
    requests: { video: { media_sha256: intent.video_sha256 } },
    authority: { action_id: intent.authority_action_id },
    verification_outcome: "DEFERRED_LANGUAGE_READBACK_VERIFIED",
    remote_mutation_count: 0,
    source_receipt: {
      sha256: sourceSha256,
      verdict: "RED",
      status: "PRIVATE_RECONCILIATION_FAILED",
      blocker: "default_language_missing",
    },
    readback: normalisedReadback(),
  };
  return { intent, red, green, sourceSha256 };
}

test("private readiness accepts the exact RED plus bound GREEN reconciliation", () => {
  const data = deferredReadiness();
  const readiness = resolveGovernedYouTubePrivateReadiness({
    privateReceipt: data.red,
    reconciliationProof: data.green,
    sourceReceiptSha256: data.sourceSha256,
    intent: data.intent,
  });
  assert.equal(readiness.verdict, "GREEN");
  assert.equal(readiness.status, "PRIVATE_VERIFIED");
  assert.equal(readiness.evidence_kind, "DEFERRED_RECONCILIATION");
  assert.equal(readiness.video_id, INTENT.video_id);
});

test("private readiness rejects a missing, tampered or misbound reconciliation", () => {
  const data = deferredReadiness();
  for (const proof of [
    null,
    { ...data.green, remote_mutation_count: 1 },
    {
      ...data.green,
      source_receipt: { ...data.green.source_receipt, sha256: "c".repeat(64) },
    },
  ]) {
    assert.throws(
      () => resolveGovernedYouTubePrivateReadiness({
        privateReceipt: data.red,
        reconciliationProof: proof,
        sourceReceiptSha256: data.sourceSha256,
        intent: data.intent,
      }),
      /private_readiness_blocked|deferred_green_proof_blocked/,
    );
  }
});

test("canonical private readiness requires the exact receipt shape and caption presence", () => {
  const intent = privateIntent();
  const exact = {
    schema_version: 1,
    receipt_type: "governed_youtube_private_dispatch",
    story_id: intent.story_id,
    platform: "youtube",
    verdict: "GREEN",
    status: "PRIVATE_VERIFIED",
    retry_allowed: false,
    studio_ingest: true,
    platform_object: { video_id: intent.video_id, privacy_status: "private" },
    requests: { video: { media_sha256: intent.video_sha256 } },
    authority: { action_id: intent.authority_action_id },
    readback: { captions_present: true },
  };
  assert.equal(
    resolveGovernedYouTubePrivateReadiness({ privateReceipt: exact, intent }).evidence_kind,
    "CANONICAL_PRIVATE_RECEIPT",
  );
  for (const receipt of [
    { ...exact, receipt_type: "other" },
    { ...exact, platform: "other" },
    { ...exact, retry_allowed: true },
    { ...exact, studio_ingest: false },
    { ...exact, readback: { captions_present: false } },
  ]) {
    assert.throws(
      () => resolveGovernedYouTubePrivateReadiness({ privateReceipt: receipt, intent }),
      /private_readiness_blocked/,
    );
  }
});

function redScheduleReceipt(intent = INTENT, overrides = {}) {
  return {
    schema_version: 1,
    receipt_type: "governed_youtube_scheduled_release",
    generated_at: "2026-08-14T19:14:14.447Z",
    story_id: intent.story_id,
    platform: "youtube",
    video_id: intent.video_id,
    channel_id: intent.channel_id,
    publish_at_utc: intent.publish_at_utc,
    authority: {
      action_id: `${intent.story_id}:youtube:schedule:${intent.publish_at_utc}`,
      binding_sha256: buildGovernedYouTubeScheduleBinding(intent),
    },
    retry_allowed: false,
    request_scope: "videos.update:status_only",
    verdict: "RED",
    status: "SCHEDULE_READBACK_FAILED",
    visibility_update_count: 1,
    update_response_ambiguous: false,
    readback: {
      id: intent.video_id,
      channel_id: intent.channel_id,
      title: intent.title,
      description: intent.description,
      tags: [...intent.tags].sort((a, b) => a.localeCompare(b)),
      category_id: intent.category_id,
      default_language: intent.default_language,
      default_audio_language: intent.default_audio_language,
      privacy_status: "private",
      publish_at_utc: null,
      upload_status: "processed",
      processing_status: "succeeded",
      licence: "youtube",
      embeddable: true,
      public_stats_viewable: true,
      self_declared_made_for_kids: false,
      captions_present: true,
      file_size: String(intent.video_bytes),
    },
    blockers: ["publish_at_mismatch"],
    ...overrides,
  };
}

test("deferred schedule reconciliation turns exact RED into separate read-only GREEN proof", async () => {
  const operations = [];
  const client = {
    videos: {
      list: async (request, options) => {
        operations.push({ operation: "list", request, options });
        return { data: { items: [remoteVideo({ publishAt: "2026-08-15T19:00:00Z" })] } };
      },
      update: async () => operations.push({ operation: "update" }),
    },
  };
  const authority = {
    verdict: "GREEN",
    action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
  };
  const proof = await executeDeferredGovernedYouTubeScheduleReconciliation({
    client,
    intent: INTENT,
    authority,
    now: TEST_NOW,
    sourceReceipt: redScheduleReceipt(),
    sourceReceiptSha256: "d".repeat(64),
  });
  assert.equal(proof.verdict, "GREEN");
  assert.equal(proof.status, "SCHEDULE_VERIFIED");
  assert.equal(proof.receipt_type, "governed_youtube_schedule_reconciliation");
  assert.equal(proof.remote_mutation_count, 0);
  assert.equal(proof.source_receipt.sha256, "d".repeat(64));
  assert.deepEqual(operations.map((entry) => entry.operation), ["list"]);
});

test("deferred schedule reconciliation rejects tampered source and non-exact readback", async () => {
  const authority = {
    verdict: "GREEN",
    action_id: `${INTENT.story_id}:youtube:schedule:${INTENT.publish_at_utc}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(INTENT),
  };
  const client = harness({ after: remoteVideo() }).client;
  await assert.rejects(
    executeDeferredGovernedYouTubeScheduleReconciliation({
      client,
      intent: INTENT,
      authority,
      now: TEST_NOW,
      sourceReceipt: redScheduleReceipt(INTENT, { blockers: ["other"] }),
      sourceReceiptSha256: "d".repeat(64),
    }),
    /source_receipt_blocked/,
  );
  await assert.rejects(
    executeDeferredGovernedYouTubeScheduleReconciliation({
      client,
      intent: INTENT,
      authority,
      now: TEST_NOW,
      sourceReceipt: redScheduleReceipt(),
      sourceReceiptSha256: "d".repeat(64),
    }),
    /exact_readback_blocked/,
  );
});

test("direct deferred validator canonicalises caller tag order like the live receipt", () => {
  const rawIntent = {
    ...INTENT,
    tags: ["System Trace", "frame pacing", "PC gaming"],
  };
  const authority = {
    verdict: "GREEN",
    action_id: `${rawIntent.story_id}:youtube:schedule:${rawIntent.publish_at_utc}`,
    binding_sha256: buildGovernedYouTubeScheduleBinding(rawIntent),
  };
  assert.doesNotThrow(() => assertExactDeferredScheduleRedReceipt(
    redScheduleReceipt(rawIntent),
    rawIntent,
    authority,
    "e".repeat(64),
  ));
});
