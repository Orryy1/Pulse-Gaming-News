"use strict";

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const { bind: bindRuntimeLeases } = require("../repositories/runtime_leases");

const LIVE_RUNTIME_TRANSITION_LEASE_NAME = "pulse:live-runtime-transition:v1";
const DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS = 5 * 60 * 1000;
const TRANSITION_OWNER_METADATA_SCHEMA_VERSION =
  "pulse-live-runtime-transition-owner-v2";
const TRANSITION_ADMISSION_OPEN = "OPEN";
const TRANSITION_ADMISSION_SEALED = "SEALED";
const MAX_METADATA_CAS_ATTEMPTS = 16;
const MAX_TRANSITION_PARTICIPANTS = 64;
const APPROXIMATE_TRANSITION_PROCESS_STARTED_AT = new Date(
  Date.now() - Math.floor(process.uptime() * 1000),
).toISOString();

let cachedCurrentProcessIdentity = null;

function requiredText(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function positiveDuration(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new Error("live_runtime_transition_lease_duration_invalid");
  }
  return result;
}

function normalisedTimestamp(value, code) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw new Error(code);
  return result.toISOString();
}

function exactIsoTimestamp(value) {
  const supplied = String(value || "").trim();
  if (!supplied) return null;
  try {
    const normalised = normalisedTimestamp(
      supplied,
      "live_runtime_transition_lease_time_invalid",
    );
    return normalised === supplied ? normalised : null;
  } catch {
    return null;
  }
}

function transitionOwnerId(action, binding) {
  const normalisedAction = requiredText(
    action,
    "live_runtime_transition_lease_action_required",
  );
  const digest = crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        action: normalisedAction,
        binding: String(binding || ""),
        process_id: process.pid,
        invocation_nonce: crypto.randomUUID(),
      }),
    )
    .digest("hex");
  return `${normalisedAction}:${digest.slice(0, 48)}`;
}

function probeWindowsProcessStartedAt(pid) {
  if (process.platform !== "win32") {
    return { state: "unknown", process_started_at: null };
  }
  const processId = Number(pid);
  if (!Number.isInteger(processId) || processId <= 0) {
    return { state: "unknown", process_started_at: null };
  }
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-CimInstance -ClassName Win32_Process -Filter \"ProcessId = ${processId}\"`,
    "if ($null -eq $p) { exit 3 }",
    "$p.CreationDate.ToUniversalTime().ToString('o')",
  ].join("; ");
  try {
    const output = execFileSync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
        windowsHide: true,
      },
    );
    return {
      state: "found",
      process_started_at: normalisedTimestamp(
        String(output || "").trim(),
        "live_runtime_transition_process_start_invalid",
      ),
    };
  } catch (error) {
    if (Number(error?.status) === 3) {
      return { state: "missing", process_started_at: null };
    }
    return { state: "unknown", process_started_at: null };
  }
}

function currentProcessIdentity() {
  if (cachedCurrentProcessIdentity) return cachedCurrentProcessIdentity;
  const probed = probeWindowsProcessStartedAt(process.pid);
  cachedCurrentProcessIdentity = Object.freeze({
    process_id: process.pid,
    process_started_at:
      probed.state === "found"
        ? probed.process_started_at
        : APPROXIMATE_TRANSITION_PROCESS_STARTED_AT,
    process_start_source:
      probed.state === "found" ? "windows-cim" : "node-uptime",
  });
  return cachedCurrentProcessIdentity;
}

function participant(role, suppliedIdentity = null) {
  const identity =
    suppliedIdentity &&
    typeof suppliedIdentity === "object" &&
    !Array.isArray(suppliedIdentity)
      ? suppliedIdentity
      : currentProcessIdentity();
  const processId = Number(identity.process_id);
  if (!Number.isInteger(processId) || processId <= 0) {
    throw new Error("live_runtime_transition_process_identity_invalid");
  }
  return Object.freeze({
    participant_id: identity.participant_id
      ? requiredText(
          identity.participant_id,
          "live_runtime_transition_participant_id_required",
        )
      : crypto.randomUUID(),
    role,
    process_id: processId,
    process_started_at: normalisedTimestamp(
      identity.process_started_at,
      "live_runtime_transition_process_start_invalid",
    ),
    process_start_source: requiredText(
      identity.process_start_source ||
        (suppliedIdentity ? "injected" : "node-uptime"),
      "live_runtime_transition_process_start_source_required",
    ),
  });
}

function cloneContext(metadata) {
  const supplied =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? metadata
      : {};
  const serialised = JSON.stringify(supplied);
  const cloned = serialised ? JSON.parse(serialised) : {};
  if (!cloned || typeof cloned !== "object" || Array.isArray(cloned)) {
    throw new Error("live_runtime_transition_metadata_invalid");
  }
  return cloned;
}

function transitionMetadata(metadata, ownerParticipant) {
  return {
    transition_owner_schema_version: TRANSITION_OWNER_METADATA_SCHEMA_VERSION,
    admission_state: TRANSITION_ADMISSION_OPEN,
    context: cloneContext(metadata),
    participants: [ownerParticipant],
  };
}

function parseTransitionMetadata(value) {
  try {
    const parsed = JSON.parse(String(value || ""));
    const admissionState = Object.hasOwn(parsed || {}, "admission_state")
      ? parsed.admission_state
      : TRANSITION_ADMISSION_OPEN;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      parsed.transition_owner_schema_version !==
        TRANSITION_OWNER_METADATA_SCHEMA_VERSION ||
      (admissionState !== TRANSITION_ADMISSION_OPEN &&
        admissionState !== TRANSITION_ADMISSION_SEALED) ||
      !parsed.context ||
      typeof parsed.context !== "object" ||
      Array.isArray(parsed.context) ||
      !Array.isArray(parsed.participants) ||
      parsed.participants.length < 1 ||
      parsed.participants.length > MAX_TRANSITION_PARTICIPANTS
    ) {
      return null;
    }
    const participantIds = new Set();
    const participants = [];
    let ownerCount = 0;
    let borrowerCount = 0;
    let handoffSupervisorCount = 0;
    let handoffChildCount = 0;
    for (const item of parsed.participants) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const participantId = String(item.participant_id || "").trim();
      const role = String(item.role || "").trim();
      const processId = Number(item.process_id);
      const processStartSource = String(item.process_start_source || "").trim();
      if (
        !participantId ||
        participantIds.has(participantId) ||
        !["owner", "borrower", "handoff_supervisor", "handoff_child"].includes(
          role,
        ) ||
        !Number.isInteger(processId) ||
        processId <= 0 ||
        !processStartSource
      ) {
        return null;
      }
      let processStartedAt;
      try {
        processStartedAt = normalisedTimestamp(
          item.process_started_at,
          "live_runtime_transition_process_start_invalid",
        );
      } catch {
        return null;
      }
      if (role === "owner") ownerCount += 1;
      if (role === "borrower") borrowerCount += 1;
      if (role === "handoff_supervisor") handoffSupervisorCount += 1;
      if (role === "handoff_child") handoffChildCount += 1;
      participantIds.add(participantId);
      participants.push({
        participant_id: participantId,
        role,
        process_id: processId,
        process_started_at: processStartedAt,
        process_start_source: processStartSource,
      });
    }
    if (
      ownerCount !== 1 ||
      (admissionState === TRANSITION_ADMISSION_OPEN &&
        (handoffSupervisorCount !== 0 || handoffChildCount !== 0)) ||
      (admissionState === TRANSITION_ADMISSION_SEALED &&
        (borrowerCount !== 0 ||
          handoffSupervisorCount > 1 ||
          handoffChildCount !== 1))
    ) {
      return null;
    }
    return {
      transition_owner_schema_version: TRANSITION_OWNER_METADATA_SCHEMA_VERSION,
      admission_state: admissionState,
      context: parsed.context,
      participants,
    };
  } catch {
    return null;
  }
}

function metadataWithParticipants(metadata, participants) {
  return {
    transition_owner_schema_version: TRANSITION_OWNER_METADATA_SCHEMA_VERSION,
    admission_state: metadata.admission_state,
    context: metadata.context,
    participants,
  };
}

function sealedMetadataWithParticipants(metadata, participants) {
  return {
    transition_owner_schema_version: TRANSITION_OWNER_METADATA_SCHEMA_VERSION,
    admission_state: TRANSITION_ADMISSION_SEALED,
    context: metadata.context,
    participants,
  };
}

function sameParticipant(left, right) {
  return (
    left?.participant_id === right?.participant_id &&
    left?.role === right?.role &&
    left?.process_id === right?.process_id &&
    left?.process_started_at === right?.process_started_at &&
    left?.process_start_source === right?.process_start_source
  );
}

function sameProcessIdentity(left, right) {
  return (
    left?.process_id === right?.process_id &&
    left?.process_started_at === right?.process_started_at
  );
}

function handoffParticipant(role, identity, lostCode) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error(lostCode);
  }
  try {
    return participant(role, identity);
  } catch {
    throw new Error(lostCode);
  }
}

function hasParticipantCollision(participants, candidate) {
  return participants.some(
    (item) =>
      item.participant_id === candidate.participant_id ||
      sameProcessIdentity(item, candidate),
  );
}

function inspectTransitionOwnerProcess(candidate = {}) {
  const pid = Number(candidate.process_id ?? candidate.pid);
  const expectedStartedAt = String(candidate.process_started_at || "").trim();
  if (!Number.isInteger(pid) || pid <= 0 || !expectedStartedAt) {
    return null;
  }
  if (pid === process.pid) {
    return (
      currentProcessIdentity().process_started_at ===
      normalisedTimestamp(
        expectedStartedAt,
        "live_runtime_transition_process_start_invalid",
      )
    );
  }
  if (
    process.platform === "win32" &&
    candidate.process_start_source === "windows-cim"
  ) {
    const probed = probeWindowsProcessStartedAt(pid);
    if (probed.state === "missing") return false;
    if (probed.state !== "found") return null;
    return probed.process_started_at === expectedStartedAt;
  }
  try {
    process.kill(pid, 0);
    return null;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    return null;
  }
}

function inspectParticipant(inspector, item, ownerId) {
  try {
    const result = inspector({
      ...item,
      pid: item.process_id,
      owner_id: ownerId,
    });
    if (result === true) return true;
    if (result === false) return false;
    return null;
  } catch {
    return null;
  }
}

function everyParticipantIsDead(metadata, inspector, ownerId) {
  return metadata.participants.every(
    (item) => inspectParticipant(inspector, item, ownerId) === false,
  );
}

function openRuntimeTransitionLease({
  databasePath,
  DatabaseImpl = require("better-sqlite3"),
} = {}) {
  const resolved = path.resolve(
    requiredText(
      databasePath,
      "live_runtime_transition_database_path_required",
    ),
  );
  const db = new DatabaseImpl(resolved, { fileMustExist: true });
  db.pragma("busy_timeout = 5000");
  return {
    leases: bindRuntimeLeases(db),
    close() {
      db.close();
    },
  };
}

function validOwnerHandle(handle) {
  return (
    handle?.leases &&
    typeof handle.leases.get === "function" &&
    typeof handle.leases.acquire === "function" &&
    typeof handle.leases.compareAndSwapMetadata === "function" &&
    typeof handle.leases.releaseExactMetadata === "function" &&
    typeof handle.close === "function"
  );
}

function validBorrowerHandle(handle) {
  return (
    handle?.leases &&
    typeof handle.leases.get === "function" &&
    typeof handle.leases.compareAndSwapMetadata === "function" &&
    typeof handle.close === "function"
  );
}

function closeQuietly(handle) {
  if (!handle) return;
  try {
    handle.close();
  } catch {
    // Durable metadata remains the recovery authority.
  }
}

function ownedSnapshot(leases, ownerId, participantIdentity, role) {
  const row = leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
  if (row?.owner_id !== ownerId || !exactIsoTimestamp(row.expires_at)) {
    return null;
  }
  const metadata = parseTransitionMetadata(row.metadata);
  if (!metadata) return null;
  const exactParticipant = metadata.participants.find((item) =>
    sameParticipant(item, participantIdentity),
  );
  if (!exactParticipant || exactParticipant.role !== role) return null;
  return { row, metadata };
}

function validateLiveRuntimeTransitionLeaseRow(
  row,
  {
    ownerId,
    now = new Date(),
    leaseMs = DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  } = {},
) {
  const exactOwnerId = String(ownerId || "").trim();
  const acquiredAt = exactIsoTimestamp(row?.acquired_at);
  const heartbeatAt = exactIsoTimestamp(row?.heartbeat_at);
  const expiresAt = exactIsoTimestamp(row?.expires_at);
  const freshNow = new Date(now);
  const duration = Number(leaseMs);
  if (
    row?.name !== LIVE_RUNTIME_TRANSITION_LEASE_NAME ||
    !exactOwnerId ||
    row.owner_id !== exactOwnerId ||
    !acquiredAt ||
    !heartbeatAt ||
    !expiresAt ||
    Number.isNaN(freshNow.getTime()) ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return null;
  }
  const acquiredAtMs = Date.parse(acquiredAt);
  const heartbeatAtMs = Date.parse(heartbeatAt);
  const expiresAtMs = Date.parse(expiresAt);
  const freshNowMs = freshNow.getTime();
  if (
    acquiredAtMs > heartbeatAtMs ||
    heartbeatAtMs > freshNowMs ||
    freshNowMs >= expiresAtMs ||
    expiresAtMs - heartbeatAtMs > duration
  ) {
    return null;
  }
  const metadata = parseTransitionMetadata(row.metadata);
  return metadata ? { row, metadata } : null;
}

function acquireLiveRuntimeTransitionLease({
  databasePath,
  ownerId,
  action,
  binding = "",
  leaseMs = DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  metadata = null,
  now = new Date(),
  participantIdentity = null,
  runtimeTransitionLeaseFactory = openRuntimeTransitionLease,
  participantProcessInspector = null,
  ownerProcessInspector = inspectTransitionOwnerProcess,
  unavailableCode = "live_runtime_transition_lease_unavailable",
  lostCode = "live_runtime_transition_lease_lost",
} = {}) {
  const normalisedOwner = ownerId
    ? requiredText(ownerId, "live_runtime_transition_lease_owner_required")
    : transitionOwnerId(action, binding);
  const duration = positiveDuration(leaseMs);
  const ownerParticipant = participant("owner", participantIdentity);
  const nowIso = normalisedTimestamp(
    now,
    "live_runtime_transition_lease_time_invalid",
  );
  const processInspector = participantProcessInspector || ownerProcessInspector;
  let handle;
  try {
    if (typeof processInspector !== "function") {
      throw new Error("invalid_runtime_transition_process_inspector");
    }
    handle = runtimeTransitionLeaseFactory({ databasePath });
    if (!validOwnerHandle(handle)) {
      throw new Error("invalid_runtime_transition_lease_handle");
    }
    const current = handle.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
    if (current) {
      const currentExpiresAt = exactIsoTimestamp(current.expires_at);
      if (
        current.owner_id === normalisedOwner ||
        !currentExpiresAt ||
        currentExpiresAt > nowIso
      ) {
        throw new Error(unavailableCode);
      }
      const currentMetadata = parseTransitionMetadata(current.metadata);
      if (
        !currentMetadata ||
        !everyParticipantIsDead(
          currentMetadata,
          processInspector,
          current.owner_id,
        )
      ) {
        throw new Error(unavailableCode);
      }
    }
    const acquired = handle.leases.acquire({
      name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
      ownerId: normalisedOwner,
      now,
      leaseMs: duration,
      metadata: transitionMetadata(metadata, ownerParticipant),
      replaceSameOwner: false,
    });
    if (acquired?.acquired !== true) throw new Error(unavailableCode);
  } catch (error) {
    closeQuietly(handle);
    if (error?.message === unavailableCode) throw error;
    throw new Error(unavailableCode);
  }

  let released = false;
  let handoffSealed = false;
  return Object.freeze({
    name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
    owner_id: normalisedOwner,
    participant_id: ownerParticipant.participant_id,
    participant_identity: ownerParticipant,
    lease_ms: duration,
    borrowed: false,
    renew(renewedAt = new Date()) {
      if (released) throw new Error(lostCode);
      try {
        for (
          let attempt = 0;
          attempt < MAX_METADATA_CAS_ATTEMPTS;
          attempt += 1
        ) {
          const snapshot = ownedSnapshot(
            handle.leases,
            normalisedOwner,
            ownerParticipant,
            "owner",
          );
          if (!snapshot) throw new Error(lostCode);
          if (
            handle.leases.compareAndSwapMetadata({
              name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId: normalisedOwner,
              expectedMetadata: snapshot.row.metadata,
              metadata: snapshot.metadata,
              now: renewedAt,
              leaseMs: duration,
              allowExpired: true,
            }) === true
          ) {
            return true;
          }
        }
      } catch (error) {
        if (error?.message === lostCode) throw error;
      }
      throw new Error(lostCode);
    },
    sealForHandoff({ childParticipantIdentity } = {}) {
      if (released) throw new Error(lostCode);
      if (handoffSealed) return true;
      const handoffChild = handoffParticipant(
        "handoff_child",
        childParticipantIdentity,
        lostCode,
      );
      try {
        for (
          let attempt = 0;
          attempt < MAX_METADATA_CAS_ATTEMPTS;
          attempt += 1
        ) {
          const snapshot = ownedSnapshot(
            handle.leases,
            normalisedOwner,
            ownerParticipant,
            "owner",
          );
          if (
            !snapshot ||
            snapshot.metadata.admission_state !== TRANSITION_ADMISSION_OPEN ||
            snapshot.metadata.participants.some(
              (item) => item.role === "borrower",
            ) ||
            hasParticipantCollision(
              snapshot.metadata.participants,
              handoffChild,
            )
          ) {
            throw new Error(lostCode);
          }
          if (
            handle.leases.compareAndSwapMetadata({
              name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId: normalisedOwner,
              expectedMetadata: snapshot.row.metadata,
              metadata: sealedMetadataWithParticipants(snapshot.metadata, [
                ...snapshot.metadata.participants,
                handoffChild,
              ]),
              now: new Date(),
              leaseMs: duration,
              allowExpired: true,
            }) === true
          ) {
            handoffSealed = true;
            return true;
          }
        }
      } catch (error) {
        if (error?.message === lostCode) throw error;
      }
      throw new Error(lostCode);
    },
    release() {
      if (released) return true;
      try {
        for (
          let attempt = 0;
          attempt < MAX_METADATA_CAS_ATTEMPTS;
          attempt += 1
        ) {
          const snapshot = ownedSnapshot(
            handle.leases,
            normalisedOwner,
            ownerParticipant,
            "owner",
          );
          if (!snapshot) throw new Error(lostCode);
          const borrowers = snapshot.metadata.participants.filter(
            (item) => item.role === "borrower",
          );
          if (borrowers.length > 0) {
            if (
              borrowers.some(
                (item) =>
                  inspectParticipant(
                    processInspector,
                    item,
                    normalisedOwner,
                  ) !== false,
              )
            ) {
              throw new Error(lostCode);
            }
            const retained = snapshot.metadata.participants.filter(
              (item) => item.role !== "borrower",
            );
            if (
              handle.leases.compareAndSwapMetadata({
                name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
                ownerId: normalisedOwner,
                expectedMetadata: snapshot.row.metadata,
                metadata: metadataWithParticipants(snapshot.metadata, retained),
                now: new Date(),
                leaseMs: duration,
                allowExpired: true,
              }) === true
            ) {
              continue;
            }
            continue;
          }
          if (
            handle.leases.releaseExactMetadata({
              name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId: normalisedOwner,
              expectedMetadata: snapshot.row.metadata,
            }) === true
          ) {
            released = true;
            closeQuietly(handle);
            return true;
          }
        }
      } catch (error) {
        if (error?.message === lostCode) throw error;
      }
      throw new Error(lostCode);
    },
  });
}

function borrowLiveRuntimeTransitionLease({
  databasePath,
  expectedOwnerId,
  leaseMs = DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  now = new Date(),
  participantIdentity = null,
  runtimeTransitionLeaseFactory = openRuntimeTransitionLease,
  unavailableCode = "live_runtime_transition_lease_unavailable",
  lostCode = "live_runtime_transition_lease_lost",
} = {}) {
  const ownerId = requiredText(
    expectedOwnerId,
    "live_runtime_transition_lease_owner_required",
  );
  const duration = positiveDuration(leaseMs);
  const borrowerParticipant = participant("borrower", participantIdentity);
  const nowIso = normalisedTimestamp(
    now,
    "live_runtime_transition_lease_time_invalid",
  );
  let handle;
  try {
    handle = runtimeTransitionLeaseFactory({ databasePath });
    if (!validBorrowerHandle(handle)) {
      throw new Error("invalid_runtime_transition_lease_handle");
    }
    let registered = false;
    for (let attempt = 0; attempt < MAX_METADATA_CAS_ATTEMPTS; attempt += 1) {
      const current = handle.leases.get(LIVE_RUNTIME_TRANSITION_LEASE_NAME);
      const currentExpiresAt = exactIsoTimestamp(current?.expires_at);
      if (
        current?.owner_id !== ownerId ||
        !currentExpiresAt ||
        currentExpiresAt <= nowIso
      ) {
        throw new Error(unavailableCode);
      }
      const currentMetadata = parseTransitionMetadata(current.metadata);
      if (
        !currentMetadata ||
        currentMetadata.admission_state !== TRANSITION_ADMISSION_OPEN ||
        currentMetadata.participants.length >= MAX_TRANSITION_PARTICIPANTS ||
        currentMetadata.participants.some(
          (item) => item.participant_id === borrowerParticipant.participant_id,
        )
      ) {
        throw new Error(unavailableCode);
      }
      const nextMetadata = metadataWithParticipants(currentMetadata, [
        ...currentMetadata.participants,
        borrowerParticipant,
      ]);
      if (
        handle.leases.compareAndSwapMetadata({
          name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
          ownerId,
          expectedMetadata: current.metadata,
          metadata: nextMetadata,
          now,
          leaseMs: duration,
          allowExpired: false,
        }) === true
      ) {
        registered = true;
        break;
      }
    }
    if (!registered) throw new Error(unavailableCode);
  } catch (error) {
    closeQuietly(handle);
    if (error?.message === unavailableCode) throw error;
    throw new Error(unavailableCode);
  }

  let closed = false;
  let handoffSealed = false;
  return Object.freeze({
    name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
    owner_id: ownerId,
    participant_id: borrowerParticipant.participant_id,
    participant_identity: borrowerParticipant,
    lease_ms: duration,
    borrowed: true,
    renew(renewedAt = new Date()) {
      if (closed) throw new Error(lostCode);
      try {
        for (
          let attempt = 0;
          attempt < MAX_METADATA_CAS_ATTEMPTS;
          attempt += 1
        ) {
          const snapshot = ownedSnapshot(
            handle.leases,
            ownerId,
            borrowerParticipant,
            "borrower",
          );
          if (!snapshot) throw new Error(lostCode);
          if (
            handle.leases.compareAndSwapMetadata({
              name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId,
              expectedMetadata: snapshot.row.metadata,
              metadata: snapshot.metadata,
              now: renewedAt,
              leaseMs: duration,
              allowExpired: true,
            }) === true
          ) {
            return true;
          }
        }
      } catch (error) {
        if (error?.message === lostCode) throw error;
      }
      throw new Error(lostCode);
    },
    sealForHandoff({ childParticipantIdentity } = {}) {
      if (handoffSealed) return true;
      if (closed) throw new Error(lostCode);
      const handoffChild = handoffParticipant(
        "handoff_child",
        childParticipantIdentity,
        lostCode,
      );
      try {
        for (
          let attempt = 0;
          attempt < MAX_METADATA_CAS_ATTEMPTS;
          attempt += 1
        ) {
          const snapshot = ownedSnapshot(
            handle.leases,
            ownerId,
            borrowerParticipant,
            "borrower",
          );
          const borrowers = snapshot?.metadata.participants.filter(
            (item) => item.role === "borrower",
          );
          if (
            !snapshot ||
            snapshot.metadata.admission_state !== TRANSITION_ADMISSION_OPEN ||
            borrowers.length !== 1 ||
            !sameParticipant(borrowers[0], borrowerParticipant) ||
            hasParticipantCollision(
              snapshot.metadata.participants,
              handoffChild,
            )
          ) {
            throw new Error(lostCode);
          }
          const retained = [
            ...snapshot.metadata.participants.filter(
              (item) => item.role !== "borrower",
            ),
            { ...borrowerParticipant, role: "handoff_supervisor" },
            handoffChild,
          ];
          if (
            handle.leases.compareAndSwapMetadata({
              name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId,
              expectedMetadata: snapshot.row.metadata,
              metadata: sealedMetadataWithParticipants(
                snapshot.metadata,
                retained,
              ),
              now: new Date(),
              leaseMs: duration,
              allowExpired: true,
            }) === true
          ) {
            handoffSealed = true;
            closed = true;
            closeQuietly(handle);
            return true;
          }
        }
      } catch (error) {
        if (error?.message === lostCode) throw error;
      }
      throw new Error(lostCode);
    },
    release() {
      if (closed) return true;
      try {
        for (
          let attempt = 0;
          attempt < MAX_METADATA_CAS_ATTEMPTS;
          attempt += 1
        ) {
          const snapshot = ownedSnapshot(
            handle.leases,
            ownerId,
            borrowerParticipant,
            "borrower",
          );
          if (!snapshot) throw new Error(lostCode);
          const retained = snapshot.metadata.participants.filter(
            (item) =>
              item.participant_id !== borrowerParticipant.participant_id,
          );
          if (
            handle.leases.compareAndSwapMetadata({
              name: LIVE_RUNTIME_TRANSITION_LEASE_NAME,
              ownerId,
              expectedMetadata: snapshot.row.metadata,
              metadata: metadataWithParticipants(snapshot.metadata, retained),
              now: new Date(),
              leaseMs: duration,
              allowExpired: true,
            }) === true
          ) {
            closed = true;
            closeQuietly(handle);
            return true;
          }
        }
      } catch (error) {
        if (error?.message === lostCode) throw error;
      }
      throw new Error(lostCode);
    },
  });
}

module.exports = {
  DEFAULT_LIVE_RUNTIME_TRANSITION_LEASE_MS,
  LIVE_RUNTIME_TRANSITION_LEASE_NAME,
  acquireLiveRuntimeTransitionLease,
  borrowLiveRuntimeTransitionLease,
  inspectTransitionOwnerProcess,
  openRuntimeTransitionLease,
  sameLiveRuntimeTransitionParticipant: sameParticipant,
  transitionOwnerId,
  validateLiveRuntimeTransitionLeaseRow,
};
