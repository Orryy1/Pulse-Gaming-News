"use strict";

const crypto = require("node:crypto");
const {
  inspectYoutubeStoryProjection,
  projectYoutubeStoryPublication,
  youtubeStoryProjectionBlockers,
} = require("./youtube-story-publication-projection");
const MAX_PLATFORM_VERIFICATION_AGE_MS = 60 * 60 * 1000;
const MAX_BACKUP_VERIFICATION_AGE_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value || "").trim();
}

function timestampStatus(
  value,
  {
    now = new Date(),
    maxAgeMs,
  } = {},
) {
  const date = new Date(value);
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (
    !text(value) ||
    Number.isNaN(date.getTime()) ||
    Number.isNaN(effectiveNow.getTime())
  ) {
    return "invalid";
  }
  const ageMs = effectiveNow.getTime() - date.getTime();
  if (ageMs < 0) return "future";
  if (Number.isFinite(maxAgeMs) && ageMs > maxAgeMs) return "stale";
  return "valid";
}

function reconciliationKey(candidate = {}) {
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        platform_post_id: Number(candidate.platform_post_id),
        story_id: text(candidate.story_id),
        channel_id: text(candidate.channel_id),
        platform: text(candidate.platform),
        external_id: text(candidate.external_id),
      }),
    )
    .digest("hex");
  return `reconcile:${text(candidate.platform)}:${digest}`;
}

function hasPublicPlatformEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") return false;
  return (
    evidence.public === true ||
    text(evidence.visibility).toLowerCase() === "public" ||
    text(evidence.privacy_status).toLowerCase() === "public"
  );
}

function candidateIdentityBlockers(candidate, row) {
  if (!row) return ["reconciliation_candidate_not_found"];
  const expected = {
    platform_post_id: Number(candidate.platform_post_id),
    story_id: text(candidate.story_id),
    channel_id: text(candidate.channel_id),
    platform: text(candidate.platform),
    external_id: text(candidate.external_id),
    external_url: text(candidate.external_url),
  };
  const actual = {
    platform_post_id: Number(row.id),
    story_id: text(row.story_id),
    channel_id: text(row.channel_id),
    platform: text(row.platform),
    external_id: text(row.external_id),
    external_url: text(row.external_url),
  };
  return Object.keys(expected).some((key) => expected[key] !== actual[key])
    ? ["reconciliation_candidate_identity_mismatch"]
    : [];
}

function candidateEligibilityBlockers(candidate, row) {
  const blockers = [];
  if (text(candidate.platform) !== "youtube") {
    blockers.push("platform_outside_stabilisation_scope");
  }
  if (!text(candidate.channel_id)) blockers.push("channel_identity_required");
  if (!text(candidate.external_id)) blockers.push("stored_external_id_required");
  if (text(row?.status).toLowerCase() !== "failed") {
    blockers.push("reconciliation_candidate_not_failed");
  }
  return blockers;
}

function preflightBlockers({
  candidate,
  row,
  verification,
  backupEvidence,
  operatorDecision,
  now,
}) {
  const blockers = [
    ...candidateIdentityBlockers(candidate, row),
    ...candidateEligibilityBlockers(candidate, row),
  ];
  if (verification?.confirmed !== true) {
    blockers.push("platform_object_not_confirmed");
  }
  if (text(verification?.externalId) !== text(candidate.external_id)) {
    blockers.push("platform_external_id_mismatch");
  }
  const platformTimeStatus = timestampStatus(verification?.verifiedAt, {
    now,
    maxAgeMs: MAX_PLATFORM_VERIFICATION_AGE_MS,
  });
  if (platformTimeStatus === "invalid") {
    blockers.push("platform_verification_time_required");
  } else if (platformTimeStatus === "future") {
    blockers.push("platform_verification_time_in_future");
  } else if (platformTimeStatus === "stale") {
    blockers.push("platform_verification_stale");
  }
  if (!hasPublicPlatformEvidence(verification?.evidence)) {
    blockers.push("public_platform_evidence_required");
  }
  const backupTimeStatus = timestampStatus(backupEvidence?.verifiedAt, {
    now,
    maxAgeMs: MAX_BACKUP_VERIFICATION_AGE_MS,
  });
  if (
    backupEvidence?.verified !== true ||
    !text(backupEvidence.backup_id) ||
    !/^[a-f0-9]{64}$/i.test(text(backupEvidence.sha256)) ||
    backupTimeStatus !== "valid"
  ) {
    blockers.push("verified_database_backup_required");
  }
  if (
    operatorDecision?.approved !== true ||
    !text(operatorDecision.actorId) ||
    !text(operatorDecision.reason)
  ) {
    blockers.push("explicit_operator_reconciliation_approval_required");
  }
  return [...new Set(blockers)];
}

async function reconcilePublicationCandidate({
  db,
  candidate,
  governance,
  platformPosts,
  verifyPlatformObject,
  backupEvidence = {},
  operatorDecision = {},
  apply = false,
  now = new Date(),
} = {}) {
  if (!db || typeof db.transaction !== "function") {
    throw new Error("database_transaction_required");
  }
  if (!candidate?.platform_post_id || !text(candidate.story_id)) {
    throw new Error("reconciliation_candidate_required");
  }
  if (
    !governance ||
    typeof governance.getState !== "function" ||
    !platformPosts ||
    typeof platformPosts.getById !== "function"
  ) {
    throw new Error("publication_repositories_required");
  }
  if (typeof verifyPlatformObject !== "function") {
    throw new Error("platform_verifier_required");
  }
  const effectiveNow = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(effectiveNow.getTime())) {
    throw new Error("valid_reconciliation_time_required");
  }

  const stored = platformPosts.getById(candidate.platform_post_id);
  const identityBlockers = candidateIdentityBlockers(candidate, stored);
  if (identityBlockers.length) {
    return {
      applied: false,
      ready_to_apply: false,
      verified: false,
      blockers: identityBlockers,
      mutations_performed: [],
    };
  }
  const storyIdentityBlockers =
    text(candidate.platform) === "youtube"
      ? inspectYoutubeStoryProjection({
          db,
          storyId: candidate.story_id,
          externalId: candidate.external_id,
        }).blockers
      : [];
  if (storyIdentityBlockers.length) {
    return {
      applied: false,
      ready_to_apply: false,
      verified: false,
      blockers: storyIdentityBlockers,
      mutations_performed: [],
    };
  }
  const existingState = governance.getState(
    candidate.story_id,
    candidate.platform,
  );
  if (
    text(stored.status).toLowerCase() === "published" &&
    existingState?.lifecycle_state === "PUBLISHED" &&
    text(existingState.external_id) === text(candidate.external_id)
  ) {
    return {
      applied: false,
      already_applied: true,
      ready_to_apply: false,
      verified: true,
      blockers: [],
      lifecycle_state: "PUBLISHED",
      mutations_performed: [],
    };
  }
  const eligibilityBlockers = candidateEligibilityBlockers(
    candidate,
    stored,
  );
  if (eligibilityBlockers.length) {
    return {
      applied: false,
      ready_to_apply: false,
      verified: false,
      blockers: eligibilityBlockers,
      mutations_performed: [],
    };
  }

  let verification;
  try {
    verification = await verifyPlatformObject({ ...candidate });
  } catch (error) {
    return {
      applied: false,
      ready_to_apply: false,
      verified: false,
      blockers: ["platform_verification_failed"],
      verification_error: text(error?.message || error).slice(0, 500),
      mutations_performed: [],
    };
  }

  const blockers = preflightBlockers({
    candidate,
    row: stored,
    verification,
    backupEvidence,
    operatorDecision,
    now: effectiveNow,
  });
  if (blockers.length) {
    return {
      applied: false,
      ready_to_apply: false,
      verified: verification?.confirmed === true,
      blockers,
      mutations_performed: [],
    };
  }
  if (apply !== true) {
    return {
      applied: false,
      ready_to_apply: true,
      verified: true,
      blockers: ["explicit_apply_authorisation_required"],
      mutations_performed: [],
    };
  }

  const idempotencyKey = reconciliationKey(candidate);
  const applyTransaction = db.transaction(() => {
    const current = platformPosts.getById(candidate.platform_post_id);
    const currentBlockers = candidateIdentityBlockers(candidate, current);
    const currentStory = inspectYoutubeStoryProjection({
      db,
      storyId: candidate.story_id,
      externalId: verification.externalId,
    }).story;
    currentBlockers.push(
      ...youtubeStoryProjectionBlockers(
        currentStory,
        verification.externalId,
      ),
    );
    if (text(current?.status).toLowerCase() !== "failed") {
      currentBlockers.push("reconciliation_candidate_not_failed");
    }
    if (currentBlockers.length) {
      return {
        applied: false,
        ready_to_apply: false,
        verified: true,
        blockers: [...new Set(currentBlockers)],
        mutations_performed: [],
      };
    }
    const currentGovernedState = governance.getState(
      candidate.story_id,
      candidate.platform,
    );
    if (
      currentGovernedState &&
      currentGovernedState.lifecycle_state !== "RECONCILIATION_REQUIRED"
    ) {
      return {
        applied: false,
        ready_to_apply: false,
        verified: true,
        blockers: ["governed_reconciliation_state_required"],
        mutations_performed: [],
      };
    }
    if (
      currentGovernedState &&
      (!text(currentGovernedState.external_id) ||
        text(currentGovernedState.external_id) !==
          text(candidate.external_id))
    ) {
      return {
        applied: false,
        ready_to_apply: false,
        verified: true,
        blockers: ["governed_reconciliation_identity_mismatch"],
        mutations_performed: [],
      };
    }

    const backupVerifiedAt = new Date(
      backupEvidence.verifiedAt,
    ).toISOString();
    const platformVerifiedAt = new Date(
      verification.verifiedAt,
    ).toISOString();
    const audit = governance.recordOperatorDecision({
      actorId: operatorDecision.actorId,
      action: "reconcile_publication_state",
      targetType: "platform_post",
      targetId: String(candidate.platform_post_id),
      decision: "MARK_PUBLISHED_AFTER_PLATFORM_VERIFICATION",
      reason: operatorDecision.reason,
      evidence: {
        backup_id: backupEvidence.backup_id,
        backup_sha256: backupEvidence.sha256,
        backup_verified_at: backupVerifiedAt,
        platform_verified_at: platformVerifiedAt,
        change_window_id: text(operatorDecision.changeWindowId) || null,
        idempotency_key: idempotencyKey,
      },
      idempotencyKey: `${idempotencyKey}:audit`,
    });
    if (!currentGovernedState) {
      governance.importLegacyReconciliationCandidate({
        storyId: candidate.story_id,
        channelId: candidate.channel_id,
        platform: candidate.platform,
        platformPostId: candidate.platform_post_id,
        externalId: candidate.external_id,
        externalUrl: candidate.external_url || null,
        idempotencyKey,
        actorId: operatorDecision.actorId,
        operatorDecisionId: String(audit.id),
        evidence: {
          backup_id: backupEvidence.backup_id,
          backup_sha256: backupEvidence.sha256,
          backup_verified_at: backupVerifiedAt,
          platform_verified_at: platformVerifiedAt,
          change_window_id: text(operatorDecision.changeWindowId) || null,
        },
      });
    }
    const verifiedEvidence = {
      ...verification.evidence,
      external_id: verification.externalId,
      verified_at: platformVerifiedAt,
    };
    governance.recordPlatformConfirmed({
      storyId: candidate.story_id,
      channelId: candidate.channel_id,
      platform: candidate.platform,
      idempotencyKey,
      verifiedAt: verification.verifiedAt,
      verificationEvidence: verifiedEvidence,
      now: effectiveNow,
    });
    governance.recordPublished({
      storyId: candidate.story_id,
      channelId: candidate.channel_id,
      platform: candidate.platform,
      idempotencyKey,
      verifiedAt: verification.verifiedAt,
      verificationEvidence: verifiedEvidence,
      now: effectiveNow,
    });
    const post = platformPosts.markPublished(candidate.platform_post_id, {
      externalId: verification.externalId,
      externalUrl: verification.externalUrl || null,
    });
    if (!post) throw new Error("platform_post_projection_update_failed");
    projectYoutubeStoryPublication({
      db,
      storyId: candidate.story_id,
      externalId: verification.externalId,
      externalUrl:
        verification.externalUrl ||
        post.external_url ||
        candidate.external_url,
      publishedAt: platformVerifiedAt,
    });
    return {
      applied: true,
      ready_to_apply: false,
      verified: true,
      blockers: [],
      audit_id: audit.id,
      lifecycle_state: "PUBLISHED",
      retry_allowed: false,
      mutations_performed: [
        "platform_publication_state",
        "platform_posts",
        "stories_youtube_projection",
        "immutable_dispatch_ledger",
        "operator_audit_log",
      ],
    };
  });
  return applyTransaction();
}

module.exports = {
  MAX_BACKUP_VERIFICATION_AGE_MS,
  MAX_PLATFORM_VERIFICATION_AGE_MS,
  candidateIdentityBlockers,
  reconcilePublicationCandidate,
  reconciliationKey,
};
