"use strict";

const {
  reconcilePublicationCandidate,
} = require("../services/publication-reconciliation-worker");

function openReadOnlyReconciliationRepos(dbPath) {
  const normalisedPath = String(dbPath || "").trim();
  if (!normalisedPath) {
    throw new Error("reconciliation_database_path_required");
  }
  const Database = require("better-sqlite3");
  const db = new Database(normalisedPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma("query_only = ON");
    const publicationGovernance =
      require("../repositories/publication_governance").bind(db);
    const platformPosts = require("../repositories/platform_posts").bind(db);
    return {
      repos: { db, publicationGovernance, platformPosts },
      close() {
        if (db.open) db.close();
      },
    };
  } catch (error) {
    db.close();
    const wrapped = new Error(
      `reconciliation_read_only_schema_unavailable:${error.message}`,
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function commandApplyBlockers({
  applyRequested,
  candidateId,
  confirmationId,
  env,
}) {
  if (!applyRequested) return [];
  const blockers = [];
  if (!enabled(env.PULSE_RECONCILIATION_APPLY)) {
    blockers.push("reconciliation_apply_environment_gate_required");
  }
  if (!candidateId || confirmationId !== candidateId) {
    blockers.push("matching_platform_post_confirmation_required");
  }
  const pulseMode = String(env.PULSE_OPERATING_MODE || "")
    .trim()
    .toUpperCase();
  const aliasMode = String(env.OPERATING_MODE || "")
    .trim()
    .toUpperCase();
  if (
    (pulseMode || aliasMode) !== "HUMAN_REVIEW" ||
    (pulseMode && aliasMode && pulseMode !== aliasMode)
  ) {
    blockers.push("reconciliation_human_review_mode_required");
  }
  if (!enabled(env.PULSE_RECONCILIATION_MAINTENANCE)) {
    blockers.push("reconciliation_maintenance_mode_required");
  }
  if (
    !enabled(env.PULSE_EMERGENCY_KILL_SWITCH) &&
    !enabled(env.PULSE_KILL_SWITCH)
  ) {
    blockers.push("reconciliation_kill_switch_required");
  }
  if (!enabled(env.PULSE_PRIMARY_INSTANCE)) {
    blockers.push("reconciliation_primary_instance_required");
  }
  if (
    !String(env.PULSE_RECONCILIATION_CHANGE_WINDOW_ID || "").trim()
  ) {
    blockers.push("reconciliation_change_window_id_required");
  }
  return blockers;
}

async function executePublicationReconciliationCommand({
  repos,
  candidateId = null,
  applyRequested = false,
  confirmationId = null,
  env = process.env,
  now = new Date(),
  verifyPlatformObject,
  reconcile = reconcilePublicationCandidate,
} = {}) {
  if (
    !repos?.publicationGovernance ||
    typeof repos.publicationGovernance.listReconciliationCandidates !==
      "function"
  ) {
    throw new Error("publication_governance_repository_required");
  }
  const candidates =
    repos.publicationGovernance.listReconciliationCandidates({ now });
  const selectedId = positiveInteger(candidateId);
  if (!selectedId) {
    return {
      generated_at: new Date(now).toISOString(),
      mode: "inventory",
      dry_run: true,
      apply_requested: Boolean(applyRequested),
      apply_authorised: false,
      candidate_count: candidates.length,
      candidates,
      command_blockers: applyRequested
        ? ["reconciliation_candidate_selection_required"]
        : [],
      mutations_performed: [],
    };
  }

  const candidate = candidates.find(
    (row) => positiveInteger(row.platform_post_id) === selectedId,
  );
  if (!candidate) {
    return {
      generated_at: new Date(now).toISOString(),
      mode: "dry_run",
      dry_run: true,
      apply_requested: Boolean(applyRequested),
      apply_authorised: false,
      candidate_count: candidates.length,
      selected_platform_post_id: selectedId,
      command_blockers: ["reconciliation_candidate_not_found"],
      mutations_performed: [],
    };
  }
  if (typeof verifyPlatformObject !== "function") {
    throw new Error("platform_verifier_required");
  }

  const normalisedConfirmationId = positiveInteger(confirmationId);
  const commandBlockers = commandApplyBlockers({
    applyRequested: Boolean(applyRequested),
    candidateId: selectedId,
    confirmationId: normalisedConfirmationId,
    env,
  });
  const applyAuthorised =
    Boolean(applyRequested) && commandBlockers.length === 0;
  const result = await reconcile({
    db: repos.db,
    candidate,
    governance: repos.publicationGovernance,
    platformPosts: repos.platformPosts,
    verifyPlatformObject,
    backupEvidence: {
      verified: enabled(env.RECONCILIATION_BACKUP_VERIFIED),
      backup_id: env.RECONCILIATION_BACKUP_ID,
      sha256: env.RECONCILIATION_BACKUP_SHA256,
      verifiedAt: env.RECONCILIATION_BACKUP_VERIFIED_AT,
    },
    operatorDecision: {
      approved: enabled(env.RECONCILIATION_OPERATOR_APPROVED),
      actorId: env.RECONCILIATION_OPERATOR_ID,
      reason: env.RECONCILIATION_REASON,
      changeWindowId: env.PULSE_RECONCILIATION_CHANGE_WINDOW_ID,
    },
    apply: applyAuthorised,
    now,
  });

  return {
    generated_at: new Date(now).toISOString(),
    mode: applyAuthorised ? "apply" : "dry_run",
    dry_run: !applyAuthorised,
    apply_requested: Boolean(applyRequested),
    apply_authorised: applyAuthorised,
    candidate_count: candidates.length,
    selected_platform_post_id: selectedId,
    change_window_id:
      env.PULSE_RECONCILIATION_CHANGE_WINDOW_ID || null,
    command_blockers: commandBlockers,
    result,
    mutations_performed: Array.isArray(result?.mutations_performed)
      ? result.mutations_performed
      : [],
  };
}

module.exports = {
  commandApplyBlockers,
  executePublicationReconciliationCommand,
  openReadOnlyReconciliationRepos,
  positiveInteger,
};
