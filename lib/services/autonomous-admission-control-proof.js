"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const {
  deriveMultiLaneRuntimeControl,
} = require("./multi-lane-runtime-control");
const {
  PUBLICATION_ADMISSION_LEASE_NAME,
} = require("./publication-admission-lock");
const { SCHEDULER_LEASE_NAME } = require("./scheduler-lock");
const {
  resolveOperatingContract,
} = require("../stabilisation/operating-contract");

const PROOF_TTL_MS = 60 * 1000;
const REQUEST_FIELDS = new Set([
  "storyId",
  "channelId",
  "workspaceRoot",
  "outputDir",
  "repos",
  "env",
  "publicationAdmissionLease",
]);
const PUBLICATION_ADMISSION_LEASE_FIELDS = new Set([
  "acquired",
  "lease_name",
  "expires_at",
  "current_lock_owner_sha256",
  "claimed_job_authority_sha256",
]);

class AutonomousAdmissionControlProofError extends Error {
  constructor(code) {
    super(code);
    this.name = "AutonomousAdmissionControlProofError";
    this.code = code;
  }
}

function fail(code) {
  throw new AutonomousAdmissionControlProofError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== fields.size ||
    Object.keys(value).some((field) => !fields.has(field))
  ) {
    fail(code);
  }
}

function trustedNow(clock) {
  if (typeof clock !== "function") {
    fail("autonomous_admission_control_trusted_clock_required");
  }
  const value = clock();
  if (
    !(value instanceof Date) ||
    !Number.isFinite(Date.prototype.getTime.call(value))
  ) {
    fail("autonomous_admission_control_trusted_clock_invalid");
  }
  return new Date(value.getTime());
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail(code);
  }
  return parsed;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileReference(filePath, bytes) {
  return Object.freeze({
    path: filePath,
    sha256: sha256(bytes),
  });
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function existingStat(fileSystem, target) {
  try {
    return await fileSystem.lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function prepareWorkspaceRoot(workspaceRoot, fileSystem) {
  const resolved = path.resolve(text(workspaceRoot));
  if (!text(workspaceRoot)) {
    fail("autonomous_admission_control_workspace_required");
  }
  const stat = await existingStat(fileSystem, resolved);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_admission_control_workspace_invalid");
  }
  const real = await fileSystem.realpath(resolved);
  if (path.resolve(real) !== resolved) {
    fail("autonomous_admission_control_workspace_link_forbidden");
  }
  return { resolved, real };
}

async function ensureSafeParent({ workspace, outputDir, fileSystem }) {
  const resolvedOutput = path.resolve(text(outputDir));
  if (
    !text(outputDir) ||
    !isWithin(workspace.resolved, resolvedOutput) ||
    resolvedOutput === workspace.resolved
  ) {
    fail("autonomous_admission_control_output_outside_workspace");
  }
  if (await existingStat(fileSystem, resolvedOutput)) {
    fail("autonomous_admission_control_output_exists");
  }
  const parent = path.dirname(resolvedOutput);
  const relative = path.relative(workspace.resolved, parent);
  let cursor = workspace.resolved;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stat = await existingStat(fileSystem, cursor);
    if (!stat) {
      try {
        await fileSystem.mkdir(cursor);
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      stat = await existingStat(fileSystem, cursor);
    }
    if (!stat?.isDirectory() || stat.isSymbolicLink()) {
      fail("autonomous_admission_control_output_link_forbidden");
    }
    const real = await fileSystem.realpath(cursor);
    if (!isWithin(workspace.real, real)) {
      fail("autonomous_admission_control_output_outside_workspace");
    }
  }
  return resolvedOutput;
}

function exactLeaseRow(row, expectedName, nowMs, prefix) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    fail(`autonomous_admission_control_${prefix}_lease_required`);
  }
  if (text(row.name) !== expectedName || !text(row.owner_id)) {
    fail(`autonomous_admission_control_${prefix}_lease_invalid`);
  }
  const expiresAt = exactTimestamp(
    row.expires_at,
    `autonomous_admission_control_${prefix}_lease_expiry_invalid`,
  );
  const heartbeatAt = exactTimestamp(
    row.heartbeat_at,
    `autonomous_admission_control_${prefix}_lease_heartbeat_invalid`,
  );
  if (expiresAt <= nowMs || heartbeatAt > nowMs) {
    fail(`autonomous_admission_control_${prefix}_lease_unhealthy`);
  }
  return {
    ownerId: text(row.owner_id),
    expiresAt,
    expiresAtIso: new Date(expiresAt).toISOString(),
  };
}

async function writeProofDirectory({
  outputDir,
  killBytes,
  ownerBytes,
  fileSystem,
}) {
  const parent = path.dirname(outputDir);
  const staging = path.join(
    parent,
    `.${path.basename(outputDir)}.staging-${process.pid}-${crypto.randomUUID()}`,
  );
  try {
    await fileSystem.mkdir(staging);
    await fileSystem.writeFile(
      path.join(staging, "kill-switch-proof.json"),
      killBytes,
      { flag: "wx" },
    );
    await fileSystem.writeFile(
      path.join(staging, "publication-admission-owner-proof.json"),
      ownerBytes,
      { flag: "wx" },
    );
    try {
      await fileSystem.rename(staging, outputDir);
    } catch (error) {
      if (error?.code === "EEXIST" || error?.code === "ENOTEMPTY") {
        fail("autonomous_admission_control_output_exists");
      }
      throw error;
    }
  } finally {
    try {
      await fileSystem.rm(staging, { recursive: true, force: true });
    } catch {
      // The atomic destination is already complete or the failed staging
      // directory is best-effort cleanup only.
    }
  }
}

async function materialiseAutonomousAdmissionControlProofs(
  request,
  options = {},
) {
  exactFields(
    request,
    REQUEST_FIELDS,
    "autonomous_admission_control_request_invalid",
  );
  exactFields(
    request.publicationAdmissionLease,
    PUBLICATION_ADMISSION_LEASE_FIELDS,
    "autonomous_admission_control_publication_admission_lease_claim_invalid",
  );
  const storyId = text(request.storyId);
  const channelId = text(request.channelId);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("autonomous_admission_control_story_invalid");
  }
  if (channelId !== "pulse-gaming") {
    fail("autonomous_admission_control_channel_invalid");
  }
  if (
    !request.repos?.runtimeLeases ||
    typeof request.repos.runtimeLeases.get !== "function"
  ) {
    fail("autonomous_admission_control_runtime_lease_repository_required");
  }
  const now = trustedNow(options.clock);
  const nowMs = now.getTime();
  const env = request.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    fail("autonomous_admission_control_environment_required");
  }
  const operatingContract = resolveOperatingContract({ env });
  const runtimeControl = deriveMultiLaneRuntimeControl({
    payload: {
      scheduler_profile: "governed_multi_lane",
      live_publish_enabled: true,
    },
    repos: request.repos,
    env,
    now,
    operatingContract,
  });
  if (
    operatingContract.mode !== "LIVE_GUARDED" ||
    operatingContract.valid !== true ||
    operatingContract.live_mutation_allowed !== true ||
    runtimeControl.kill_switch_healthy !== true ||
    runtimeControl.operating_contract_valid !== true ||
    runtimeControl.scheduler_owner_healthy !== true ||
    runtimeControl.live_publish_enabled !== true
  ) {
    fail("autonomous_admission_control_live_control_not_green");
  }

  const schedulerRow = request.repos.runtimeLeases.get(SCHEDULER_LEASE_NAME);
  const publicationAdmissionRow = request.repos.runtimeLeases.get(
    PUBLICATION_ADMISSION_LEASE_NAME,
  );
  const scheduler = exactLeaseRow(
    schedulerRow,
    SCHEDULER_LEASE_NAME,
    nowMs,
    "scheduler",
  );
  const publicationAdmission = exactLeaseRow(
    publicationAdmissionRow,
    PUBLICATION_ADMISSION_LEASE_NAME,
    nowMs,
    "publication_admission",
  );
  let publicationAdmissionMetadata;
  try {
    publicationAdmissionMetadata = JSON.parse(publicationAdmissionRow.metadata);
  } catch {
    fail("autonomous_admission_control_publication_admission_lease_invalid");
  }
  const claimedJobAuthoritySha256 = text(
    request.publicationAdmissionLease.claimed_job_authority_sha256,
  );
  const storyScopedAdmissionClaim =
    publicationAdmissionMetadata?.claim_scope === "STORY" &&
    publicationAdmissionMetadata?.job_kind ===
      "admit_governed_publication" &&
    publicationAdmissionMetadata?.operation ===
      "autonomous_t75_jit_admission" &&
    publicationAdmissionMetadata?.channel_id === channelId &&
    publicationAdmissionMetadata?.story_id === storyId;
  const windowScopedAdmissionClaim =
    publicationAdmissionMetadata?.claim_scope === "WINDOW" &&
    publicationAdmissionMetadata?.job_kind ===
      "prepare_governed_autonomous_pre_t90_window" &&
    publicationAdmissionMetadata?.operation ===
      "governed_autonomous_pre_t90_window_preparation" &&
    publicationAdmissionMetadata?.channel_id === null &&
    publicationAdmissionMetadata?.story_id === null;
  if (
    request.publicationAdmissionLease.acquired !== true ||
    text(request.publicationAdmissionLease.lease_name) !==
      PUBLICATION_ADMISSION_LEASE_NAME ||
    text(request.publicationAdmissionLease.current_lock_owner_sha256) !==
      sha256(publicationAdmission.ownerId) ||
    text(request.publicationAdmissionLease.expires_at) !==
      publicationAdmission.expiresAtIso ||
    !/^[a-f0-9]{64}$/.test(claimedJobAuthoritySha256) ||
    publicationAdmissionMetadata?.schema_version !==
      "pulse-runtime-generation-publication-admission-lease-v1" ||
    publicationAdmissionMetadata?.scope !== "PUBLICATION_ADMISSION_ONLY" ||
    (!storyScopedAdmissionClaim && !windowScopedAdmissionClaim) ||
    publicationAdmissionMetadata?.claimed_job_authority_sha256 !==
      claimedJobAuthoritySha256 ||
    publicationAdmissionMetadata?.operational_publish_authority !== false ||
    publicationAdmissionMetadata?.dispatch_authorised !== false ||
    publicationAdmissionMetadata?.external_create_authority !== false ||
    publicationAdmissionMetadata?.platform_mutation_authority !== false ||
    publicationAdmissionMetadata?.platform_contact_authority !== false
  ) {
    fail(
      "autonomous_admission_control_publication_admission_lease_claim_mismatch",
    );
  }
  if (typeof request.publicationAdmissionLease.assertHealthy !== "function") {
    fail("autonomous_admission_control_publication_admission_lease_claim_invalid");
  }
  try {
    request.publicationAdmissionLease.assertHealthy();
  } catch {
    fail("autonomous_admission_control_publication_admission_lease_unhealthy");
  }
  const schedulerEvidence = runtimeControl.evidence?.scheduler_lease;
  if (
    schedulerEvidence?.healthy !== true ||
    text(schedulerEvidence.owner_id) !== scheduler.ownerId ||
    text(schedulerEvidence.expires_at) !== scheduler.expiresAtIso
  ) {
    fail("autonomous_admission_control_scheduler_evidence_mismatch");
  }

  const validUntilMs = Math.min(
    nowMs + PROOF_TTL_MS,
    scheduler.expiresAt,
    publicationAdmission.expiresAt,
  );
  if (validUntilMs <= nowMs) {
    fail("autonomous_admission_control_no_fresh_window");
  }
  const checkedAt = now.toISOString();
  const validUntil = new Date(validUntilMs).toISOString();
  const leaseExpiresAt = new Date(
    Math.min(scheduler.expiresAt, publicationAdmission.expiresAt),
  ).toISOString();
  const killSwitchProof = {
    schema_version: "pulse-kill-switch-health-proof-v1",
    story_id: storyId,
    checked_at: checkedAt,
    valid_until: validUntil,
    kill_switch_healthy: true,
    emergency_kill_switch_tripped: false,
    primary_kill_switch_tripped: false,
  };
  const publicationAdmissionOwnerProof = {
    schema_version: "pulse-publication-admission-owner-proof-v1",
    story_id: storyId,
    checked_at: checkedAt,
    valid_until: validUntil,
    scheduler_owner_sha256: sha256(scheduler.ownerId),
    publication_admission_owner_sha256: sha256(
      publicationAdmission.ownerId,
    ),
    publication_admission_claimed_job_authority_sha256:
      claimedJobAuthoritySha256,
    active_scheduler_owner_count: 1,
    active_publication_admission_owner_count: 1,
    scheduler_owner_healthy: true,
    publication_admission_owner_healthy: true,
    publication_admission_lease_expires_at: leaseExpiresAt,
  };
  const killBytes = Buffer.from(
    `${JSON.stringify(killSwitchProof, null, 2)}\n`,
    "utf8",
  );
  const ownerBytes = Buffer.from(
    `${JSON.stringify(publicationAdmissionOwnerProof, null, 2)}\n`,
    "utf8",
  );
  const fileSystem = options.fileSystem || defaultFileSystem;
  const workspace = await prepareWorkspaceRoot(
    request.workspaceRoot,
    fileSystem,
  );
  const outputDir = await ensureSafeParent({
    workspace,
    outputDir: request.outputDir,
    fileSystem,
  });
  await writeProofDirectory({
    outputDir,
    killBytes,
    ownerBytes,
    fileSystem,
  });
  const result = {
    schema_version: "pulse-autonomous-admission-control-proof-result-v2",
    verdict: "GREEN",
    generated_at: checkedAt,
    valid_until: validUntil,
    story_id: storyId,
    channel_id: channelId,
    kill_switch_proof: fileReference(
      path.join(outputDir, "kill-switch-proof.json"),
      killBytes,
    ),
    publication_admission_owner_proof: fileReference(
      path.join(outputDir, "publication-admission-owner-proof.json"),
      ownerBytes,
    ),
    operational_publish_authority: false,
    dispatch_authorised: false,
    external_publish_authorised: false,
    platform_contacted: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
  };
  return Object.freeze(result);
}

module.exports = {
  AutonomousAdmissionControlProofError,
  PROOF_TTL_MS,
  materialiseAutonomousAdmissionControlProofs,
};
