"use strict";

const crypto = require("node:crypto");
const {
  buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
  buildGovernedYoutubeReservePromotionEvidence,
  canonicalSha256,
  validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence,
  validateGovernedYoutubeReservePromotionEvidence,
} = require("./governed-youtube-release-runway");

const PRIMARY_RELEASE_KINDS = Object.freeze([
  "verify_governed_youtube_release_tminus15",
  "verify_governed_youtube_release_t0",
]);

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(
      typeof value === "string"
        ? value
        : JSON.stringify(value ?? null),
    )
    .digest("hex");
}

function parsePayload(value) {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    return value;
  }
  try {
    const parsed = JSON.parse(text(value) || "{}");
    return parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function canonicalDisarmLedgerEventSha256(ledger) {
  if (
    !ledger ||
    typeof ledger !== "object" ||
    Array.isArray(ledger)
  ) {
    return null;
  }
  return canonicalSha256({
    id: Number(ledger.id),
    story_id: text(ledger.story_id),
    channel_id: text(ledger.channel_id) || null,
    platform: text(ledger.platform).toLowerCase(),
    idempotency_key: text(ledger.idempotency_key),
    event_type: text(ledger.event_type),
    external_id: text(ledger.external_id) || null,
    request_fingerprint:
      text(ledger.request_fingerprint).toLowerCase() || null,
    retryability_class:
      text(ledger.retryability_class) || null,
    verification_status:
      text(ledger.verification_status) || null,
    verification_evidence: parsePayload(
      ledger.verification_evidence_json,
    ),
  });
}

function resolveCanonicalPrimaryConfirmedDisarm(
  repos,
  lock,
) {
  const blockers = [];
  if (
    !repos?.db ||
    !repos?.publicationGovernance ||
    !lock?.primary?.story_id
  ) {
    return {
      eligible: false,
      blockers: [
        "runway_primary_confirmed_disarm_repositories_required",
      ],
      state: null,
      ledger: null,
      primary_disarm: null,
    };
  }
  const storyId = text(lock.primary.story_id);
  const state = repos.publicationGovernance.getState(
    storyId,
    "youtube",
  );
  if (
    state?.lifecycle_state !==
      "PLATFORM_SCHEDULE_DISARMED" ||
    !text(state.external_id) ||
    text(state.verification_status) !==
      "confirmed_private_unscheduled"
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_state_required",
    );
  }
  let ledger = null;
  try {
    ledger = repos.db
      .prepare(
        `SELECT *
         FROM platform_dispatch_ledger
         WHERE id = ?
           AND story_id = ?
           AND platform = 'youtube'
           AND event_type = 'SCHEDULE_DISARM_CONFIRMED'
         LIMIT 1`,
      )
      .get(Number(state?.last_event_id), storyId);
  } catch {
    ledger = null;
  }
  const evidence = parsePayload(
    ledger?.verification_evidence_json,
  );
  const exactExternalId = text(state?.external_id);
  if (
    !ledger ||
    Number(state?.last_event_id) !== Number(ledger?.id) ||
    (text(ledger?.external_id) &&
      text(ledger.external_id) !== exactExternalId) ||
    evidence.platform_object_confirmed !== true ||
    evidence.schedule_disarm_confirmed !== true ||
    text(evidence.external_id) !== exactExternalId ||
    text(evidence.privacy_status).toLowerCase() !==
      "private" ||
    !Object.prototype.hasOwnProperty.call(
      evidence,
      "publish_at",
    ) ||
    evidence.publish_at !== null ||
    text(evidence.scheduled_for) !==
      text(lock.scheduled_for) ||
    text(evidence.runway_lock_sha256).toLowerCase() !==
      text(lock.lock_sha256).toLowerCase()
  ) {
    blockers.push(
      "runway_primary_confirmed_disarm_ledger_binding_required",
    );
  }
  if (blockers.length) {
    return {
      eligible: false,
      blockers: [...new Set(blockers)],
      state,
      ledger,
      primary_disarm: null,
    };
  }
  const disarmBody = {
    classification: "CONFIRMED_DISARM_FAILOVER",
    story_id: storyId,
    platform: "youtube",
    scheduled_for: lock.scheduled_for,
    runway_lock_sha256: lock.lock_sha256,
    lifecycle_state: "PLATFORM_SCHEDULE_DISARMED",
    external_id: exactExternalId,
    verified_external_id: text(evidence.external_id),
    ledger_event_id: Number(ledger.id),
    ledger_idempotency_key: text(
      ledger.idempotency_key,
    ),
    disarm_ledger_event_sha256:
      canonicalDisarmLedgerEventSha256(ledger),
    privacy_status: "private",
    publish_at: null,
    verification_uncertain: false,
    reconciliation_required: false,
  };
  return {
    eligible: true,
    blockers: [],
    state,
    ledger,
    primary_disarm: {
      ...disarmBody,
      disarm_event_sha256:
        canonicalSha256(disarmBody),
    },
  };
}

function validateReserveAdmissionArtifact(lock, artifact) {
  const blockers = [];
  if (
    !artifact ||
    typeof artifact !== "object" ||
    Array.isArray(artifact)
  ) {
    return ["runway_reserve_admission_artifact_required"];
  }
  const body = { ...artifact };
  delete body.artifact_sha256;
  const admission = artifact.admission;
  if (
    text(artifact.schema_version) !==
      "pulse-governed-youtube-reserve-admission-packet-v1" ||
    text(artifact.scheduled_for) !==
      text(lock?.scheduled_for) ||
    text(artifact.runway_lock_sha256).toLowerCase() !==
      text(lock?.lock_sha256).toLowerCase() ||
    text(artifact.story_id) !==
      text(lock?.reserve?.story_id) ||
    text(artifact.candidate_revision_sha256).toLowerCase() !==
      text(
        lock?.reserve?.candidate_revision_sha256,
      ).toLowerCase()
  ) {
    blockers.push(
      "runway_reserve_admission_artifact_binding_mismatch",
    );
  }
  if (
    !admission ||
    typeof admission !== "object" ||
    Array.isArray(admission) ||
    sha256(admission) !==
      text(artifact.admission_packet_sha256).toLowerCase() ||
    text(artifact.admission_packet_sha256).toLowerCase() !==
      text(
        lock?.reserve?.admission_evidence_sha256,
      ).toLowerCase()
  ) {
    blockers.push(
      "runway_reserve_admission_packet_sha256_mismatch",
    );
  }
  if (
    sha256(body) !==
    text(artifact.artifact_sha256).toLowerCase()
  ) {
    blockers.push(
      "runway_reserve_admission_artifact_sha256_mismatch",
    );
  }
  if (
    text(admission?.confirmation_story_id) !==
      text(lock?.reserve?.story_id) ||
    new Date(admission?.scheduled_for).toISOString() !==
      new Date(lock?.scheduled_for).toISOString()
  ) {
    blockers.push(
      "runway_reserve_admission_packet_identity_mismatch",
    );
  }
  return [...new Set(blockers)];
}

function exactPrimaryReleaseJobs(repos, lock) {
  const rows = repos.db
    .prepare(
      `SELECT *
       FROM jobs
       WHERE story_id = ?
         AND kind IN (
           'verify_governed_youtube_release_tminus15',
           'verify_governed_youtube_release_t0'
         )
         AND status IN ('pending', 'cancelled')
       ORDER BY kind`,
    )
    .all(lock.primary.story_id);
  const exact = rows.filter((row) => {
    const payload = parsePayload(row.payload);
    return (
      text(payload.scheduled_for) ===
        text(lock.scheduled_for) &&
      text(payload.runway_lock_sha256).toLowerCase() ===
        text(lock.lock_sha256).toLowerCase()
    );
  });
  if (
    exact.length !== PRIMARY_RELEASE_KINDS.length ||
    !PRIMARY_RELEASE_KINDS.every((kind) =>
      exact.some((row) => row.kind === kind),
    )
  ) {
    throw new Error(
      "runway_primary_exact_release_chain_required",
    );
  }
  return exact;
}

function assertCanonicalPrimaryFailure(
  repos,
  lock,
  primaryFailure,
) {
  const state =
    repos.publicationGovernance.getState(
      lock.primary.story_id,
      "youtube",
    );
  if (
    state?.lifecycle_state !==
      "DISPATCH_FAILED_BEFORE_CREATE" ||
    text(state.external_id) ||
    text(primaryFailure?.external_id) ||
    primaryFailure?.platform_contacted !== false ||
    primaryFailure?.uncertain_external_creation !== false
  ) {
    throw new Error(
      "runway_primary_decisive_pre_create_state_required",
    );
  }
  const ledger = repos.db
    .prepare(
      `SELECT *
       FROM platform_dispatch_ledger
       WHERE id = ?
         AND story_id = ?
         AND platform = 'youtube'
         AND event_type =
           'DISPATCH_FAILED_BEFORE_CREATE'
       LIMIT 1`,
    )
    .get(
      Number(primaryFailure?.ledger_event_id),
      lock.primary.story_id,
    );
  if (
    !ledger ||
    Number(state.last_event_id) !== Number(ledger.id) ||
    text(primaryFailure?.ledger_idempotency_key) !==
      text(ledger.idempotency_key)
  ) {
    throw new Error(
      "runway_primary_failure_ledger_binding_required",
    );
  }
  return { state, ledger };
}

function assertCanonicalPrimaryConfirmedDisarm(
  repos,
  lock,
  primaryDisarm,
) {
  const canonical =
    resolveCanonicalPrimaryConfirmedDisarm(repos, lock);
  if (canonical.eligible !== true) {
    throw new Error(
      canonical.blockers?.[0] ||
        "runway_primary_confirmed_disarm_state_required",
    );
  }
  const suppliedBody = { ...(primaryDisarm || {}) };
  delete suppliedBody.disarm_event_sha256;
  if (
    canonicalSha256(suppliedBody) !==
      text(
        primaryDisarm?.disarm_event_sha256,
      ).toLowerCase() ||
    text(primaryDisarm?.disarm_event_sha256).toLowerCase() !==
      text(
        canonical.primary_disarm.disarm_event_sha256,
      ).toLowerCase() ||
    text(primaryDisarm?.external_id) !==
      text(canonical.state.external_id) ||
    Number(primaryDisarm?.ledger_event_id) !==
      Number(canonical.ledger.id) ||
    text(
      primaryDisarm?.disarm_ledger_event_sha256,
    ).toLowerCase() !==
      canonicalDisarmLedgerEventSha256(canonical.ledger)
  ) {
    throw new Error(
      "runway_primary_confirmed_disarm_proof_mismatch",
    );
  }
  return canonical;
}

async function promoteGovernedYoutubeReserveRelease({
  repos,
  lock,
  primaryFailure,
  primaryDisarm,
  promotion,
  reserveAdmissionArtifact,
  env = process.env,
  now = new Date(),
  channelId = "pulse-gaming",
  resolveMediaPath,
  channel = null,
  admitPublication: suppliedAdmitPublication,
} = {}) {
  if (
    !repos?.db ||
    !repos?.jobs ||
    !repos?.stories ||
    !repos?.publicationGovernance
  ) {
    throw new Error(
      "runway_reserve_promotion_repositories_required",
    );
  }
  const confirmedDisarmPromotion =
    text(promotion?.authority_type) ===
      "CONFIRMED_DISARM_FAILOVER" ||
    primaryDisarm !== undefined;
  const rebuilt = confirmedDisarmPromotion
    ? buildGovernedYoutubeConfirmedDisarmReservePromotionEvidence(
        {
          now,
          lock,
          primary_disarm: primaryDisarm,
        },
      )
    : buildGovernedYoutubeReservePromotionEvidence({
        now,
        lock,
        primary_failure: primaryFailure,
      });
  const promotionBlockers = [
    ...(rebuilt.blockers || []),
    ...(confirmedDisarmPromotion
      ? validateGovernedYoutubeConfirmedDisarmReservePromotionEvidence(
          {
            lock,
            promotion,
          },
        )
      : validateGovernedYoutubeReservePromotionEvidence({
          lock,
          promotion,
        })),
  ];
  if (
    rebuilt.verdict !== "GREEN" ||
    rebuilt.promotion?.promotion_sha256 !==
      promotion?.promotion_sha256
  ) {
    promotionBlockers.push(
      "runway_reserve_promotion_rebuild_mismatch",
    );
  }
  promotionBlockers.push(
    ...validateReserveAdmissionArtifact(
      lock,
      reserveAdmissionArtifact,
    ),
  );
  if (promotionBlockers.length) {
    return {
      promoted: false,
      status: "held",
      blockers: [...new Set(promotionBlockers)],
      cancelled_primary_jobs: [],
      reserve_release_jobs: [],
      no_external_posting: true,
    };
  }
  if (confirmedDisarmPromotion) {
    assertCanonicalPrimaryConfirmedDisarm(
      repos,
      lock,
      primaryDisarm,
    );
  } else {
    assertCanonicalPrimaryFailure(
      repos,
      lock,
      primaryFailure,
    );
  }
  const primaryJobs = exactPrimaryReleaseJobs(repos, lock);
  const admission = reserveAdmissionArtifact.admission;
  const admitPublication =
    suppliedAdmitPublication ||
    require("./publication-admission").admitPublication;
  let cancelledPrimaryJobs = [];
  let promotionAudit = null;
  const admitted = await admitPublication({
    repos,
    storyId: lock.reserve.story_id,
    channelId,
    platform: "youtube",
    actorId: admission.actor_id,
    reason: admission.reason,
    confirmationStoryId:
      admission.confirmation_story_id,
    scheduledFor: admission.scheduled_for,
    evidence: admission.evidence,
    env,
    now,
    resolveMediaPath,
    channel,
    outsideCadenceAuthorisation:
      admission.outside_cadence_authorisation || null,
    runwayLockSha256: lock.lock_sha256,
    dispatchJob: {
      laneId: lock.reserve.lane_id,
      priority: 1,
      maxAttempts: 3,
      promotedReserve: true,
      promotionSha256:
        promotion.promotion_sha256,
      promotionAuthorityType:
        confirmedDisarmPromotion
          ? "CONFIRMED_DISARM_FAILOVER"
          : "ZERO_CONTACT_PRE_CREATE",
      prestageRunAt:
        now instanceof Date
          ? now.toISOString()
          : new Date(now).toISOString(),
    },
    transactionBoundaryCheck() {
      if (confirmedDisarmPromotion) {
        assertCanonicalPrimaryConfirmedDisarm(
          repos,
          lock,
          primaryDisarm,
        );
      } else {
        assertCanonicalPrimaryFailure(
          repos,
          lock,
          primaryFailure,
        );
      }
      cancelledPrimaryJobs =
        repos.jobs.cancelManyExactInTransaction(
          primaryJobs.map((row) => ({
            id: Number(row.id),
            kind: row.kind,
            story_id: row.story_id,
            idempotency_key: row.idempotency_key,
            runway_lock_sha256: lock.lock_sha256,
            reason:
              confirmedDisarmPromotion
                ? "reserve_promoted_after_confirmed_remote_disarm"
                : "reserve_promoted_after_decisive_pre_create_failure",
          })),
        );
      promotionAudit =
        repos.publicationGovernance.recordOperatorDecision({
          actorId:
            admission.actor_id ||
            "governed-youtube-runway",
          action:
            "governed_youtube_reserve_promotion",
          targetType: "youtube_runway_window",
          targetId: lock.window_id,
          decision: "APPROVED",
          reason:
            confirmedDisarmPromotion
              ? "Conditional reserve authority activated after exact durable remote schedule disarm"
              : "Conditional reserve authority activated after exact decisive pre-create failure",
          evidence: {
            promotion,
            primary_cancelled_job_ids:
              cancelledPrimaryJobs.map((row) =>
                Number(row.id),
              ),
          },
          idempotencyKey:
            `reserve-promotion:${lock.window_id}:` +
            promotion.promotion_sha256,
        });
    },
    transactionCompletionCheck({ releaseJobs }) {
      if (
        !Array.isArray(releaseJobs) ||
        releaseJobs.length !== 3 ||
        releaseJobs.some(
          (row) =>
            row.payload?.story_id !==
              lock.reserve.story_id ||
            row.payload?.scheduled_for !==
              lock.scheduled_for ||
            row.payload?.runway_lock_sha256 !==
              lock.lock_sha256,
        )
      ) {
        throw new Error(
          "runway_reserve_exact_release_chain_required",
        );
      }
      const primarySuccessors = repos.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM jobs
           WHERE story_id = ?
             AND kind IN (
               'verify_governed_youtube_release_tminus15',
               'verify_governed_youtube_release_t0'
             )
             AND status IN (
               'pending', 'claimed', 'running'
             )
             AND json_extract(
               payload,
               '$.scheduled_for'
             ) = ?
             AND json_extract(
               payload,
               '$.runway_lock_sha256'
             ) = ?`,
        )
        .get(
          lock.primary.story_id,
          lock.scheduled_for,
          lock.lock_sha256,
        );
      if (Number(primarySuccessors.count) !== 0) {
        throw new Error(
          "runway_primary_successor_chain_still_active",
        );
      }
    },
  });
  if (!admitted?.admitted) {
    return {
      promoted: false,
      status: "held",
      blockers:
        admitted?.blockers ||
        ["runway_reserve_admission_held"],
      cancelled_primary_jobs: [],
      reserve_release_jobs: [],
      no_external_posting: true,
    };
  }
  const activeReserve = repos.db
    .prepare(
      `SELECT story_id, kind, status
       FROM jobs
       WHERE kind IN (
         'prestage_governed_youtube_release',
         'verify_governed_youtube_release_tminus15',
         'verify_governed_youtube_release_t0'
       )
         AND story_id = ?
         AND status IN ('pending', 'claimed', 'running')
         AND json_extract(payload, '$.scheduled_for') = ?
         AND json_extract(
           payload,
           '$.runway_lock_sha256'
         ) = ?
       ORDER BY story_id, kind`,
    )
    .all(
      lock.reserve.story_id,
      lock.scheduled_for,
      lock.lock_sha256,
    );
  if (
    activeReserve.length !== 3 ||
    activeReserve.some(
      (row) => row.story_id !== lock.reserve.story_id,
    )
  ) {
    return {
      promoted: true,
      status: "reserve_admitted_invariant_observation_failed",
      blockers: [
        "runway_reserve_post_commit_observation_failed",
      ],
      promotion,
      promotion_audit_id:
        Number(promotionAudit?.id) || null,
      cancelled_primary_jobs:
        cancelledPrimaryJobs.map((row) => ({
          id: Number(row.id),
          kind: row.kind,
          status: row.status,
        })),
      reserve_release_jobs: admitted.release_jobs,
      reserve_scheduled_event_id:
        admitted.scheduled_event_id,
      no_external_posting: true,
    };
  }
  return {
    promoted: true,
    status: "reserve_admitted",
    blockers: [],
    promotion,
    promotion_audit_id:
      Number(promotionAudit?.id) || null,
    cancelled_primary_jobs:
      cancelledPrimaryJobs.map((row) => ({
        id: Number(row.id),
        kind: row.kind,
        status: row.status,
      })),
    reserve_release_jobs: admitted.release_jobs,
    reserve_scheduled_event_id:
      admitted.scheduled_event_id,
    no_external_posting: true,
  };
}

module.exports = {
  PRIMARY_RELEASE_KINDS,
  canonicalDisarmLedgerEventSha256,
  exactPrimaryReleaseJobs,
  promoteGovernedYoutubeReserveRelease,
  resolveCanonicalPrimaryConfirmedDisarm,
  validateReserveAdmissionArtifact,
};
