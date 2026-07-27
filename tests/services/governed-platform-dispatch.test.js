"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const {
  dispatchGovernedPlatform,
} = require("../../lib/services/governed-platform-dispatch");
const {
  bind: bindPlatformPosts,
} = require("../../lib/repositories/platform_posts");
const {
  bind: bindPublicationGovernance,
} = require("../../lib/repositories/publication_governance");

const MIGRATIONS = path.resolve(__dirname, "..", "..", "db", "migrations");
const NOW = new Date("2026-07-27T12:00:00.000Z");
const REQUEST_FINGERPRINT = "a".repeat(64);

function lifecycleEvidence(state, extra = {}) {
  const evidence = {
    DISCOVERED: { source_discovered: true },
    VERIFIED: { source_verified: true },
    EDITORIALLY_APPROVED: { editorial_approved: true },
    SCRIPT_READY: { script_ready: true },
    ASSETS_CLEARED: { rights_cleared: true },
    RENDERED: { rendered_artifact_verified: true },
    QA_PASSED: { qa_passed: true },
    HUMAN_APPROVED: { human_review_complete: true },
    SCHEDULED: { schedule_verified: true },
  }[state];
  return { ...evidence, ...extra };
}

function advanceToScheduled(governance, {
  storyId,
  platform,
  idempotencyKey,
  requestFingerprint,
}) {
  const approval = governance.recordOperatorDecision({
    actorId: "operator-1",
    action: "approve_publication",
    targetType: "platform_publication",
    targetId: `${storyId}:${platform}`,
    decision: "APPROVED",
    reason: "Final candidate reviewed",
    evidence: { review_complete: true },
    idempotencyKey: `${idempotencyKey}:approval`,
  });
  for (const state of [
    "DISCOVERED",
    "VERIFIED",
    "EDITORIALLY_APPROVED",
    "SCRIPT_READY",
    "ASSETS_CLEARED",
    "RENDERED",
    "QA_PASSED",
    "HUMAN_APPROVED",
    "SCHEDULED",
  ]) {
    governance.appendLifecycle({
      storyId,
      platform,
      toState: state,
      actorType: state === "HUMAN_APPROVED" ? "operator" : "system",
      actorId: state === "HUMAN_APPROVED" ? "operator-1" : null,
      operatorDecisionId:
        state === "HUMAN_APPROVED" ? approval.id : null,
      evidence: lifecycleEvidence(state, {
        ...(state === "HUMAN_APPROVED"
          ? { operator_decision_id: approval.id }
          : {}),
        ...(state === "SCHEDULED"
          ? {
              control_tower_verdict: "GREEN",
              control_tower_checked_at: NOW.toISOString(),
              scheduled_for: NOW.toISOString(),
              kill_switch_healthy: true,
              operating_contract_valid: true,
              dispatch_idempotency_key: idempotencyKey,
              request_fingerprint: requestFingerprint,
            }
          : {}),
      }),
      idempotencyKey: `${idempotencyKey}:evidence:${state}`,
    });
  }
}

function fixture({
  storyId = "story-1",
  channelId = "pulse-gaming",
  platform = "youtube",
  idempotencyKey = "youtube:story-1:attempt-1",
  requestFingerprint = REQUEST_FINGERPRINT,
} = {}) {
  const db = new Database(":memory:");
  for (const filename of fs
    .readdirSync(MIGRATIONS)
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS, filename), "utf8"));
  }
  db.prepare("INSERT INTO channels (id, name) VALUES (?, ?)").run(
    channelId,
    "Pulse Gaming",
  );
  db.prepare("INSERT INTO stories (id, title) VALUES (?, ?)").run(
    storyId,
    "Governed dispatch fixture",
  );
  const platformPosts = bindPlatformPosts(db);
  const governance = bindPublicationGovernance(db);
  advanceToScheduled(governance, {
    storyId,
    platform,
    idempotencyKey,
    requestFingerprint,
  });
  return {
    db,
    platformPosts,
    governance,
    storyId,
    channelId,
    platform,
    idempotencyKey,
    requestFingerprint,
  };
}

test("dispatch publishes only after a public verifier proves the anchored object", async () => {
  const context = fixture();
  let leaseChecks = 0;
  let verifierCalled = false;

  const result = await dispatchGovernedPlatform({
    ...context,
    now: NOW,
    upload: async () => {
      assert.equal(
        context.platformPosts.getByStoryPlatform(
          context.storyId,
          context.platform,
        ).status,
        "pending",
      );
      assert.equal(
        context.governance.getState(
          context.storyId,
          context.platform,
        ).lifecycle_state,
        "DISPATCH_STARTED",
      );
      return {
        externalId: "yt-created-1",
        externalUrl: "https://youtube.example/watch/yt-created-1",
      };
    },
    assertLeaseHealthy: () => {
      leaseChecks += 1;
      if (leaseChecks === 2) {
        const anchored = context.platformPosts.getByStoryPlatform(
          context.storyId,
          context.platform,
        );
        assert.equal(anchored.status, "uploading");
        assert.equal(anchored.external_id, "yt-created-1");
        assert.equal(
          context.governance.getState(
            context.storyId,
            context.platform,
          ).lifecycle_state,
          "PLATFORM_OBJECT_CREATED",
        );
      }
      return true;
    },
    verifyPublic: async ({ externalId }) => {
      verifierCalled = true;
      assert.equal(externalId, "yt-created-1");
      assert.equal(
        context.platformPosts.getByStoryPlatform(
          context.storyId,
          context.platform,
        ).status,
        "uploading",
      );
      return {
        confirmed: true,
        externalId,
        externalUrl: "https://youtube.example/watch/yt-created-1",
        verifiedAt: NOW.toISOString(),
        evidence: {
          platform_object_confirmed: true,
          privacy_status: "public",
        },
      };
    },
  });

  assert.equal(verifierCalled, true);
  assert.equal(result.status, "published");
  assert.equal(result.externalId, "yt-created-1");
  assert.equal(
    context.platformPosts.getByStoryPlatform(
      context.storyId,
      context.platform,
    ).status,
    "published",
  );
  assert.equal(
    context.governance.getState(
      context.storyId,
      context.platform,
    ).lifecycle_state,
    "PUBLISHED",
  );
  const projectedStory = context.db
    .prepare(
      `SELECT youtube_post_id, youtube_url, youtube_published_at,
              published_at, publish_status
       FROM stories
       WHERE id = ?`,
    )
    .get(context.storyId);
  assert.deepEqual(projectedStory, {
    youtube_post_id: "yt-created-1",
    youtube_url: "https://youtube.example/watch/yt-created-1",
    youtube_published_at: NOW.toISOString(),
    published_at: NOW.toISOString(),
    publish_status: "published",
  });
  assert.equal(result.storyProjection.youtube_post_id, "yt-created-1");
  assert.ok(leaseChecks >= 3);
  context.db.close();
});

test("a conflicting legacy YouTube projection rolls canonical publication back into reconciliation", async () => {
  const context = fixture();
  context.db
    .prepare("UPDATE stories SET youtube_url = ? WHERE id = ?")
    .run(
      "https://www.youtube.com/watch?v=yt-different-object",
      context.storyId,
    );

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => ({
        externalId: "yt-created-conflict",
        externalUrl:
          "https://www.youtube.com/watch?v=yt-created-conflict",
      }),
      verifyPublic: async ({ externalId }) => ({
        confirmed: true,
        externalId,
        externalUrl:
          "https://www.youtube.com/watch?v=yt-created-conflict",
        verifiedAt: NOW.toISOString(),
        evidence: {
          platform_object_confirmed: true,
          privacy_status: "public",
        },
      }),
    }),
    /story_youtube_url_identity_conflict/,
  );

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  const story = context.db
    .prepare(
      "SELECT youtube_post_id, youtube_url FROM stories WHERE id = ?",
    )
    .get(context.storyId);
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, "yt-created-conflict");
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.equal(story.youtube_post_id, null);
  assert.equal(
    story.youtube_url,
    "https://www.youtube.com/watch?v=yt-different-object",
  );
  context.db.close();
});

test("an adapter failure before the remote-create marker is a definite pre-create failure", async () => {
  const context = fixture();
  const uploadError = new Error("authentication failed before create");
  let verifierCalled = false;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => {
        throw uploadError;
      },
      verifyPublic: async () => {
        verifierCalled = true;
        throw new Error("verifier must not run");
      },
    }),
    (error) => error === uploadError,
  );

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(verifierCalled, false);
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, null);
  assert.match(post.error_message, /authentication failed before create/);
  assert.equal(state.lifecycle_state, "DISPATCH_FAILED_BEFORE_CREATE");
  assert.equal(state.external_id, null);
  context.db.close();
});

test("an adapter failure after the remote-create marker requires reconciliation", async () => {
  const context = fixture();
  const uploadError = new Error("response lost after create request");
  let verifierCalled = false;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async ({ markCreateAttemptStarted }) => {
        markCreateAttemptStarted();
        throw uploadError;
      },
      verifyPublic: async () => {
        verifierCalled = true;
        throw new Error("verifier must not run");
      },
    }),
    (error) => error === uploadError,
  );

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(verifierCalled, false);
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, null);
  assert.match(post.error_message, /response lost after create request/);
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.equal(state.external_id, null);
  context.db.close();
});

test("a deliberate pre-create platform block is persisted without fabricating an object", async () => {
  const context = fixture();
  let verifierCalled = false;

  const result = await dispatchGovernedPlatform({
    ...context,
    now: NOW,
    assertLeaseHealthy: () => true,
    upload: async () => ({
      blocked: true,
      reason: "remote duplicate detected",
    }),
    verifyPublic: async () => {
      verifierCalled = true;
      throw new Error("verifier must not run");
    },
  });

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(verifierCalled, false);
  assert.deepEqual(result, {
    status: "blocked",
    blocked: true,
    reason: "remote duplicate detected",
    platformPost: post,
    governanceState: state,
  });
  assert.equal(post.status, "blocked");
  assert.equal(post.external_id, null);
  assert.equal(post.block_reason, "remote duplicate detected");
  assert.equal(state.lifecycle_state, "DISPATCH_FAILED_BEFORE_CREATE");
  assert.equal(state.external_id, null);
  context.db.close();
});

test("a same-key retry after an ambiguous create rejection is blocked before another upload", async () => {
  const context = fixture();
  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async ({ markCreateAttemptStarted }) => {
        markCreateAttemptStarted();
        throw new Error("initial create failed");
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run");
      },
    }),
    /initial create failed/,
  );

  let retryUploadCalled = false;
  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => {
        retryUploadCalled = true;
        return { externalId: "unsafe-retry" };
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run");
      },
    }),
    (error) => {
      assert.equal(error.code, "platform_dispatch_reconciliation_required");
      assert.equal(error.externalId, null);
      return true;
    },
  );

  assert.equal(retryUploadCalled, false);
  context.db.close();
});

test("a crashed in-flight dispatch is reconciled instead of uploading a second object", async () => {
  const context = fixture();
  context.platformPosts.ensurePending(
    context.storyId,
    context.platform,
    {
      channelId: context.channelId,
      idempotencyKey: context.idempotencyKey,
    },
  );
  context.governance.prepareDispatch({
    storyId: context.storyId,
    channelId: context.channelId,
    platform: context.platform,
    idempotencyKey: context.idempotencyKey,
    requestFingerprint: context.requestFingerprint,
    now: NOW,
  });

  let uploadCalled = false;
  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => {
        uploadCalled = true;
        return { externalId: "unsafe-second-object" };
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run");
      },
    }),
    (error) => {
      assert.equal(error.code, "platform_dispatch_reconciliation_required");
      assert.equal(error.externalId, null);
      return true;
    },
  );

  assert.equal(uploadCalled, false);
  assert.equal(
    context.governance.getState(
      context.storyId,
      context.platform,
    ).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  context.db.close();
});

test("an explicitly rescheduled pre-create failure can use a new governed attempt key", async () => {
  const context = fixture();
  const preCreateLeaseError = Object.assign(
    new Error("lease lost before platform adapter invocation"),
    { code: "durable_publish_lease_lost" },
  );
  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => {
        throw preCreateLeaseError;
      },
      upload: async () => {
        throw new Error("platform adapter must not be invoked");
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run");
      },
    }),
    (error) => error === preCreateLeaseError,
  );

  const retryKey = "youtube:story-1:attempt-2";
  context.governance.appendLifecycle({
    storyId: context.storyId,
    platform: context.platform,
    toState: "SCHEDULED",
    eventReason: "operator_rescheduled_after_pre_create_failure",
    actorType: "operator",
    actorId: "operator-1",
    evidence: {
      schedule_verified: true,
      control_tower_verdict: "GREEN",
      control_tower_checked_at: NOW.toISOString(),
      scheduled_for: NOW.toISOString(),
      kill_switch_healthy: true,
      operating_contract_valid: true,
      dispatch_idempotency_key: retryKey,
      request_fingerprint: context.requestFingerprint,
    },
    idempotencyKey: `${retryKey}:evidence:SCHEDULED`,
  });

  const result = await dispatchGovernedPlatform({
    ...context,
    idempotencyKey: retryKey,
    now: NOW,
    assertLeaseHealthy: () => true,
    upload: async () => ({
      externalId: "yt-rescheduled-1",
      externalUrl: "https://youtube.example/watch/yt-rescheduled-1",
    }),
    verifyPublic: async ({ externalId }) => ({
      confirmed: true,
      externalId,
      verifiedAt: NOW.toISOString(),
      evidence: {
        platform_object_confirmed: true,
        privacy_status: "public",
      },
    }),
  });

  assert.equal(result.status, "published");
  const attempts = context.platformPosts
    .listByStory(context.storyId)
    .filter((row) => row.platform === context.platform);
  assert.deepEqual(
    attempts.map((row) => row.status),
    ["failed", "published"],
  );
  context.db.close();
});

test("an unhealthy lease prevents the external upload and records a pre-create failure", async () => {
  const context = fixture();
  const leaseError = Object.assign(
    new Error("durable_publish_lease_lost"),
    { code: "durable_publish_lease_lost" },
  );
  let uploadCalled = false;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => {
        throw leaseError;
      },
      upload: async () => {
        uploadCalled = true;
        return { externalId: "must-not-exist" };
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run");
      },
    }),
    (error) => error === leaseError,
  );

  assert.equal(uploadCalled, false);
  assert.equal(
    context.platformPosts.getByStoryPlatform(
      context.storyId,
      context.platform,
    ).status,
    "failed",
  );
  assert.equal(
    context.governance.getState(
      context.storyId,
      context.platform,
    ).lifecycle_state,
    "DISPATCH_FAILED_BEFORE_CREATE",
  );
  context.db.close();
});

test("an uploader response without an external ID is ambiguous rather than pre-create failure", async () => {
  const context = fixture();
  let verifierCalled = false;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async ({ markCreateAttemptStarted }) => {
        markCreateAttemptStarted();
        return {
          externalUrl: "https://youtube.example/watch/identity-missing",
        };
      },
      verifyPublic: async () => {
        verifierCalled = true;
        throw new Error("verifier cannot run without an external identity");
      },
    }),
    /platform_upload_external_id_required/,
  );

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(verifierCalled, false);
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, null);
  assert.equal(
    post.external_url,
    "https://youtube.example/watch/identity-missing",
  );
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.notEqual(state.lifecycle_state, "DISPATCH_FAILED_BEFORE_CREATE");
  context.db.close();
});

test("lease loss after object creation preserves its identity and requires reconciliation", async () => {
  const context = fixture();
  const leaseError = Object.assign(
    new Error("durable_publish_lease_lost"),
    { code: "durable_publish_lease_lost" },
  );
  let leaseChecks = 0;
  let verifierCalled = false;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      upload: async () => ({
        externalId: "yt-ambiguous-1",
        externalUrl: "https://youtube.example/watch/yt-ambiguous-1",
      }),
      assertLeaseHealthy: () => {
        leaseChecks += 1;
        if (leaseChecks === 2) throw leaseError;
        return true;
      },
      verifyPublic: async () => {
        verifierCalled = true;
        throw new Error("verifier must not run after lease loss");
      },
    }),
    (error) => error === leaseError,
  );

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(verifierCalled, false);
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, "yt-ambiguous-1");
  assert.equal(
    post.external_url,
    "https://youtube.example/watch/yt-ambiguous-1",
  );
  assert.match(post.error_message, /durable_publish_lease_lost/);
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.equal(state.external_id, "yt-ambiguous-1");
  assert.equal(state.verification_status, "requires_reconciliation");
  context.db.close();
});

test("non-public verifier evidence never becomes a published claim", async () => {
  const context = fixture();

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => ({
        externalId: "yt-private-1",
        externalUrl: "https://youtube.example/watch/yt-private-1",
      }),
      verifyPublic: async ({ externalId }) => ({
        confirmed: true,
        externalId,
        verifiedAt: NOW.toISOString(),
        evidence: {
          platform_object_confirmed: true,
          privacy_status: "private",
        },
      }),
    }),
    /public_platform_verification_required/,
  );

  const post = context.platformPosts.getByStoryPlatform(
    context.storyId,
    context.platform,
  );
  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(post.status, "failed");
  assert.equal(post.external_id, "yt-private-1");
  assert.equal(post.published_at, null);
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.equal(state.external_id, "yt-private-1");
  assert.equal(state.verification_status, "requires_reconciliation");
  const failureEvent = context.governance.getLatestLifecycleEvent(
    context.storyId,
    context.platform,
    "PLATFORM_CREATED_CONFIRMATION_FAILED",
  );
  assert.equal(failureEvent.from_state, "PLATFORM_OBJECT_CREATED");
  const failureEvidence = JSON.parse(failureEvent.evidence_json);
  assert.equal(failureEvidence.verification_attempted, true);
  assert.equal(failureEvidence.verification_result_received, true);
  assert.equal(failureEvidence.external_id, "yt-private-1");
  assert.equal(failureEvidence.privacy_status, "private");
  assert.equal(failureEvidence.public_proof_present, false);
  assert.equal(
    context.governance.getLatestLifecycleEvent(
      context.storyId,
      context.platform,
      "RECONCILIATION_REQUIRED",
    ).from_state,
    "PLATFORM_CREATED_CONFIRMATION_FAILED",
  );
  assert.notEqual(state.lifecycle_state, "PUBLISHED");
  context.db.close();
});

test("a verifier error is recorded as confirmation failure for the anchored object", async () => {
  const context = fixture();
  const verifierError = new Error("platform verification endpoint unavailable");

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => ({
        externalId: "yt-verifier-error-1",
        externalUrl: "https://youtube.example/watch/yt-verifier-error-1",
      }),
      verifyPublic: async () => {
        throw verifierError;
      },
    }),
    (error) => error === verifierError,
  );

  const state = context.governance.getState(
    context.storyId,
    context.platform,
  );
  assert.equal(state.lifecycle_state, "RECONCILIATION_REQUIRED");
  assert.equal(state.external_id, "yt-verifier-error-1");
  const event = context.governance.getLatestLifecycleEvent(
    context.storyId,
    context.platform,
    "PLATFORM_CREATED_CONFIRMATION_FAILED",
  );
  assert.deepEqual(JSON.parse(event.evidence_json), {
    error: "platform verification endpoint unavailable",
    external_id: "yt-verifier-error-1",
    verification_attempted: true,
    verification_result_received: false,
  });
  context.db.close();
});

test("a retry of an ambiguous created object is blocked from uploading again", async () => {
  const context = fixture();
  const leaseError = Object.assign(
    new Error("durable_publish_lease_lost"),
    { code: "durable_publish_lease_lost" },
  );
  let firstLeaseChecks = 0;

  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      upload: async () => ({
        externalId: "yt-needs-reconciliation",
        externalUrl:
          "https://youtube.example/watch/yt-needs-reconciliation",
      }),
      assertLeaseHealthy: () => {
        firstLeaseChecks += 1;
        if (firstLeaseChecks === 2) throw leaseError;
        return true;
      },
      verifyPublic: async () => {
        throw new Error("verifier must not run after lease loss");
      },
    }),
    (error) => error === leaseError,
  );

  let retryUploadCalled = false;
  await assert.rejects(
    dispatchGovernedPlatform({
      ...context,
      now: NOW,
      assertLeaseHealthy: () => true,
      upload: async () => {
        retryUploadCalled = true;
        return { externalId: "duplicate-object" };
      },
      verifyPublic: async () => {
        throw new Error("verifier requires operator reconciliation");
      },
    }),
    (error) => {
      assert.equal(error.code, "platform_dispatch_reconciliation_required");
      assert.equal(error.externalId, "yt-needs-reconciliation");
      return true;
    },
  );

  assert.equal(retryUploadCalled, false);
  assert.equal(
    context.governance.getState(
      context.storyId,
      context.platform,
    ).lifecycle_state,
    "RECONCILIATION_REQUIRED",
  );
  context.db.close();
});

test("a live clock is sampled again after upload before validating verifier time", async () => {
  const context = fixture();
  const verifiedAt = new Date(NOW.getTime() + 2 * 60 * 1000);
  let clockCalls = 0;

  const result = await dispatchGovernedPlatform({
    ...context,
    now: () => {
      clockCalls += 1;
      return clockCalls === 1 ? NOW : verifiedAt;
    },
    assertLeaseHealthy: () => true,
    upload: async () => ({
      externalId: "yt-slow-upload-1",
      externalUrl: "https://youtube.example/watch/yt-slow-upload-1",
    }),
    verifyPublic: async ({ externalId }) => ({
      confirmed: true,
      externalId,
      verifiedAt: verifiedAt.toISOString(),
      evidence: {
        platform_object_confirmed: true,
        privacy_status: "public",
      },
    }),
  });

  assert.equal(result.status, "published");
  assert.ok(clockCalls >= 2);
  context.db.close();
});
