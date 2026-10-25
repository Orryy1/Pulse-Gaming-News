"use strict";

const crypto = require("node:crypto");
const {
  createElevenLabsCreditLedger,
} = require("./elevenlabs-credit-ledger");

const PREFLIGHT_SCHEMA = "pulse-elevenlabs-credit-preflight-v1";
const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
const DEFAULT_ESTIMATE_MULTIPLIER = 1.25;
const DEFAULT_RESERVE_PERCENT = 20;
const DEFAULT_WARNING_PERCENT = 50;
const DEFAULT_SNAPSHOT_TTL_MS = 60_000;

class ElevenLabsCreditGuardError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "ElevenLabsCreditGuardError";
    this.code = code;
    this.details = details;
  }
}

function value(input) {
  return String(input == null ? "" : input).trim();
}

function numberInRange(input, fallback, minimum, maximum) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function booleanValue(input, fallback = false) {
  const normalised = value(input).toLowerCase();
  if (!normalised) return fallback;
  if (["1", "true", "yes", "on"].includes(normalised)) return true;
  if (["0", "false", "no", "off"].includes(normalised)) return false;
  return fallback;
}

function sha256(input) {
  return crypto
    .createHash("sha256")
    .update(String(input || ""))
    .digest("hex");
}

function exactLegacyKeyHashes(input, currentKeyHash) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 1) {
    throw new ElevenLabsCreditGuardError(
      "elevenlabs_credit_guard_legacy_key_hashes_invalid",
    );
  }
  return input.map((entry) => {
    const hash = value(entry).toLowerCase();
    if (
      !/^[a-f0-9]{64}$/.test(hash) ||
      hash === currentKeyHash
    ) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_guard_legacy_key_hashes_invalid",
      );
    }
    return hash;
  });
}

function safeBaseUrl(input) {
  const configured = value(input);
  if (!configured) return DEFAULT_BASE_URL;
  let parsed;
  try {
    parsed = new URL(configured);
  } catch {
    throw new ElevenLabsCreditGuardError(
      "elevenlabs_credit_guard_base_url_invalid",
    );
  }
  if (
    parsed.origin !== DEFAULT_BASE_URL ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname.replace(/\/+$/, "") !== "" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new ElevenLabsCreditGuardError(
      "elevenlabs_credit_guard_base_url_invalid",
    );
  }
  return DEFAULT_BASE_URL;
}

function validateSnapshotResponse(response) {
  const status = Number(response?.status);
  const data = response?.data;
  const used = Number(data?.character_count);
  const limit = Number(data?.character_limit);
  if (
    !Number.isFinite(status) ||
    status < 200 ||
    status >= 300 ||
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    !value(data.status) ||
    !Number.isFinite(used) ||
    used < 0 ||
    !Number.isFinite(limit) ||
    limit <= 0
  ) {
    throw new ElevenLabsCreditGuardError(
      "elevenlabs_credit_snapshot_unavailable",
      {
        http_status: Number.isFinite(status) ? status : null,
      },
    );
  }
  return {
    tier: value(data.tier) || null,
    status: value(data.status),
    used,
    limit,
    remaining: Math.max(0, limit - used),
    nextResetUnix:
      Number(data.next_character_count_reset_unix) || null,
    externalOverageEnabled:
      data.max_credit_limit_extension === "unlimited" ||
      Number(data.max_credit_limit_extension) > 0,
    currentOverageAmount:
      value(data.current_overage?.amount) || "0",
    currency:
      value(data.current_overage?.currency || data.currency) || null,
  };
}

function estimateCredits(text, multiplier) {
  const characterCount = Array.from(String(text || "")).length;
  return Math.max(1, Math.ceil(characterCount * multiplier));
}

function wrapLedgerError(error) {
  if (error instanceof ElevenLabsCreditGuardError) return error;
  const code = /^elevenlabs_[a-z0-9_]+$/.test(
    String(error?.code || ""),
  )
    ? error.code
    : "elevenlabs_credit_ledger_unavailable";
  return new ElevenLabsCreditGuardError(code, error?.details || {});
}

function createElevenLabsCreditGovernor(options = {}) {
  const env =
    options.env &&
    typeof options.env === "object" &&
    !Array.isArray(options.env)
      ? options.env
      : process.env;
  const request = options.request;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const apiKey = value(env.ELEVENLABS_API_KEY);
  const baseUrl = safeBaseUrl(env.ELEVENLABS_BASE_URL);
  const estimateMultiplier = numberInRange(
    env.ELEVENLABS_CREDIT_ESTIMATE_MULTIPLIER,
    DEFAULT_ESTIMATE_MULTIPLIER,
    1,
    10,
  );
  const reservePercent = numberInRange(
    env.ELEVENLABS_CREDIT_RESERVE_PERCENT,
    DEFAULT_RESERVE_PERCENT,
    0,
    100,
  );
  const explicitReserve = Number(env.ELEVENLABS_CREDIT_RESERVE);
  const warningPercent = numberInRange(
    env.ELEVENLABS_CREDIT_WARNING_PERCENT,
    DEFAULT_WARNING_PERCENT,
    0,
    100,
  );
  const snapshotTtlMs = numberInRange(
    env.ELEVENLABS_CREDIT_SNAPSHOT_TTL_MS,
    DEFAULT_SNAPSHOT_TTL_MS,
    0,
    60 * 60 * 1000,
  );
  const localOverageRequested = booleanValue(
    env.ELEVENLABS_ALLOW_OVERAGE,
    false,
  );
  const localOverageAllowed = false;
  let ledger;
  try {
    ledger =
      options.ledger ||
      createElevenLabsCreditLedger({
        stateRoot:
          options.stateRoot || value(env.PULSE_STATE_ROOT),
        now,
        wallNow: options.wallNow,
        sleep: options.sleep,
        hostname: options.hostname,
        pid: options.pid,
        isProcessAlive: options.isProcessAlive,
        lockTimeoutMs: numberInRange(
          env.ELEVENLABS_CREDIT_LOCK_TIMEOUT_MS,
          15_000,
          100,
          120_000,
        ),
        lockStaleMs: numberInRange(
          env.ELEVENLABS_CREDIT_LOCK_STALE_MS,
          2 * 60 * 1000,
          100,
          24 * 60 * 60 * 1000,
        ),
      });
  } catch (error) {
    throw wrapLedgerError(error);
  }

  let snapshot = null;
  let snapshotAt = 0;

  function timeMs() {
    const candidate = Number(now());
    return Number.isFinite(candidate) ? candidate : Date.now();
  }

  function isoNow() {
    return new Date(timeMs()).toISOString();
  }

  function hardReserve(limit) {
    if (Number.isFinite(explicitReserve) && explicitReserve >= 0) {
      return Math.min(limit, Math.ceil(explicitReserve));
    }
    return Math.min(
      limit,
      Math.ceil((limit * reservePercent) / 100),
    );
  }

  async function refreshSnapshot({ force = false } = {}) {
    const current = timeMs();
    if (
      !force &&
      snapshot &&
      current - snapshotAt <= snapshotTtlMs
    ) {
      return snapshot;
    }
    if (!apiKey) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_guard_api_key_missing",
      );
    }
    if (typeof request !== "function") {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_guard_http_client_missing",
      );
    }
    let response;
    try {
      response = await request({
        method: "GET",
        url: `${baseUrl}/v1/user/subscription`,
        headers: {
          "xi-api-key": apiKey,
          Accept: "application/json",
        },
        timeout: numberInRange(
          env.ELEVENLABS_CREDIT_CHECK_TIMEOUT_MS,
          15_000,
          1,
          60_000,
        ),
      });
    } catch (error) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_snapshot_unavailable",
        {
          cause_code: value(error?.code || error?.name) || null,
        },
      );
    }
    const next = validateSnapshotResponse(response);
    snapshot = next;
    snapshotAt = current;
    return next;
  }

  function reconcileObservation(sharedLedger, currentSnapshot) {
    const previous = sharedLedger.provider_observation;
    const resetChanged =
      previous &&
      previous.next_reset_unix !== currentSnapshot.nextResetUnix;
    const counterReset =
      previous && currentSnapshot.used < Number(previous.used);
    if (resetChanged || counterReset) {
      sharedLedger.unobserved_committed_credits = 0;
    } else if (previous) {
      const newlyObserved = Math.max(
        0,
        currentSnapshot.used - Number(previous.used),
      );
      sharedLedger.unobserved_committed_credits = Math.max(
        0,
        Number(sharedLedger.unobserved_committed_credits) -
          newlyObserved,
      );
    }
    sharedLedger.provider_observation = {
      used: currentSnapshot.used,
      limit: currentSnapshot.limit,
      next_reset_unix: currentSnapshot.nextResetUnix,
      observed_at: isoNow(),
    };
  }

  function activeReservedCredits(sharedLedger) {
    return Object.values(sharedLedger.entries).reduce(
      (total, entry) =>
        entry.state === "reserved"
          ? total + Number(entry.estimated_credits)
          : total,
      0,
    );
  }

  function warningsFor(currentSnapshot) {
    const warnings = [];
    const remainingPercent =
      currentSnapshot.limit > 0
        ? (currentSnapshot.remaining / currentSnapshot.limit) * 100
        : 0;
    if (remainingPercent <= warningPercent) {
      warnings.push("included_credits_below_warning_threshold");
    }
    if (
      currentSnapshot.externalOverageEnabled &&
      !localOverageAllowed
    ) {
      warnings.push(
        "external_usage_based_overage_enabled_but_locally_forbidden",
      );
    }
    if (localOverageRequested) {
      warnings.push("local_overage_request_ignored_fail_closed");
    }
    if (Number(currentSnapshot.currentOverageAmount) > 0) {
      warnings.push("account_reports_current_overage");
    }
    return warnings;
  }

  function buildReport(currentSnapshot, sharedLedger, extra = {}) {
    const reserve = hardReserve(currentSnapshot.limit);
    const activeReserved = activeReservedCredits(sharedLedger);
    const unobserved = Number(
      sharedLedger.unobserved_committed_credits,
    );
    const availableBeforeRequest = Math.max(
      0,
      currentSnapshot.remaining -
        reserve -
        unobserved -
        activeReserved,
    );
    return {
      schema_version: PREFLIGHT_SCHEMA,
      generated_at: isoNow(),
      provider: "elevenlabs",
      tier: currentSnapshot.tier,
      status: currentSnapshot.status,
      used_credits: currentSnapshot.used,
      included_credit_limit: currentSnapshot.limit,
      included_credits_remaining: currentSnapshot.remaining,
      remaining_percent: Number(
        (
          (currentSnapshot.remaining / currentSnapshot.limit) *
          100
        ).toFixed(2),
      ),
      next_reset_unix: currentSnapshot.nextResetUnix,
      hard_reserve_credits: reserve,
      warning_threshold_percent: warningPercent,
      estimate_multiplier: estimateMultiplier,
      unobserved_committed_credits: unobserved,
      active_reserved_credits: activeReserved,
      available_credits_before_request: availableBeforeRequest,
      external_overage_enabled:
        currentSnapshot.externalOverageEnabled,
      local_overage_allowed: localOverageAllowed,
      current_overage_amount:
        currentSnapshot.currentOverageAmount,
      currency: currentSnapshot.currency,
      warnings: warningsFor(currentSnapshot),
      ledger_revision: sharedLedger.revision + 1,
      ...extra,
    };
  }

  function entryFor(
    sharedLedger,
    keyHash,
    inputFingerprint,
  ) {
    const entry = sharedLedger.entries[keyHash];
    if (!entry) return null;
    if (entry.input_fingerprint !== inputFingerprint) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_idempotency_key_payload_mismatch",
        { key_hash: keyHash },
      );
    }
    return entry;
  }

  function duplicateStateError(entry) {
    if (
      ["provider_call_started", "provider_call_ambiguous"].includes(
        entry.state,
      )
    ) {
      return "elevenlabs_paid_synthesis_retry_ambiguous_forbidden";
    }
    if (
      ["provider_succeeded", "completed"].includes(entry.state)
    ) {
      return "elevenlabs_duplicate_paid_synthesis_forbidden";
    }
    return "elevenlabs_paid_synthesis_already_reserved";
  }

  async function updateEntry(
    keyHash,
    inputFingerprint,
    allowedStates,
    mutation,
  ) {
    try {
      return await ledger.transaction((sharedLedger) => {
        const entry = entryFor(
          sharedLedger,
          keyHash,
          inputFingerprint,
        );
        if (!entry || !allowedStates.includes(entry.state)) {
          const state = entry?.state || "missing";
          throw new ElevenLabsCreditGuardError(
            state === "missing"
              ? "elevenlabs_credit_reservation_missing"
              : duplicateStateError(entry),
            { key_hash: keyHash, state },
          );
        }
        return mutation(sharedLedger, entry);
      });
    } catch (error) {
      throw wrapLedgerError(error);
    }
  }

  async function preflight(input = {}) {
    const narration = String(input.text || "");
    const purpose = value(input.purpose);
    const idempotencyKey = value(input.idempotencyKey);
    if (!narration) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_guard_text_required",
      );
    }
    if (!purpose) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_guard_purpose_required",
      );
    }
    if (!idempotencyKey) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_credit_guard_idempotency_key_required",
      );
    }
    const keyHash = sha256(idempotencyKey);
    const legacyKeyHashes = exactLegacyKeyHashes(
      input.legacyIdempotencyKeyHashes,
      keyHash,
    );
    const inputFingerprint = sha256(
      JSON.stringify({
        purpose,
        text_sha256: sha256(narration),
      }),
    );
    const estimatedCredits = estimateCredits(
      narration,
      estimateMultiplier,
    );
    const currentSnapshot = await refreshSnapshot();
    if (
      currentSnapshot.status &&
      !["active", "trialing", "free"].includes(
        currentSnapshot.status.toLowerCase(),
      )
    ) {
      throw new ElevenLabsCreditGuardError(
        "elevenlabs_subscription_not_active",
        { subscription_status: currentSnapshot.status },
      );
    }

    let reservation;
    try {
      reservation = await ledger.transaction(async (sharedLedger) => {
        reconcileObservation(sharedLedger, currentSnapshot);
        const existing = entryFor(
          sharedLedger,
          keyHash,
          inputFingerprint,
        );
        if (
          existing &&
          ["provider_succeeded", "completed"].includes(
            existing.state,
          )
        ) {
          const replayReport = buildReport(
            currentSnapshot,
            sharedLedger,
            {
              purpose,
              idempotency_key_hash: keyHash,
              estimated_request_credits: estimatedCredits,
              durable_reservation_state: existing.state,
              durable_replay_available: true,
              requires_provider_call: false,
              verdict: "REPLAY",
            },
          );
          return {
            report: replayReport,
            replay: true,
            providerResult: { ...existing.provider_result },
            providerResultKeyHash:
              existing.migrated_from_key_hash || keyHash,
            migratedFromKeyHash:
              existing.migrated_from_key_hash || null,
          };
        }
        if (existing && existing.state !== "released") {
          throw new ElevenLabsCreditGuardError(
            duplicateStateError(existing),
            { key_hash: keyHash, state: existing.state },
          );
        }
        if (!existing && legacyKeyHashes.length === 1) {
          const legacyKeyHash = legacyKeyHashes[0];
          const legacyEntry = entryFor(
            sharedLedger,
            legacyKeyHash,
            inputFingerprint,
          );
          if (
            legacyEntry &&
            ["provider_succeeded", "completed"].includes(
              legacyEntry.state,
            )
          ) {
            let stored;
            try {
              stored =
                await ledger.readProviderResult(legacyKeyHash);
            } catch (error) {
              throw new ElevenLabsCreditGuardError(
                "elevenlabs_durable_provider_result_integrity_failed",
                {
                  key_hash: legacyKeyHash,
                  cause_code:
                    value(error?.code || error?.name) || null,
                },
              );
            }
            if (
              stored.sha256 !==
                legacyEntry.provider_result.sha256 ||
              stored.byte_length !==
                legacyEntry.provider_result.byte_length
            ) {
              throw new ElevenLabsCreditGuardError(
                "elevenlabs_durable_provider_result_integrity_failed",
                { key_hash: legacyKeyHash },
              );
            }
            const migratedAt = isoNow();
            sharedLedger.entries[keyHash] = {
              key_hash: keyHash,
              input_fingerprint: inputFingerprint,
              purpose,
              estimated_credits: 0,
              state: "completed",
              attempt_count: 0,
              provider_succeeded_at:
                legacyEntry.provider_succeeded_at ||
                migratedAt,
              completed_at:
                legacyEntry.completed_at || migratedAt,
              provider_result: {
                ...legacyEntry.provider_result,
              },
              migrated_from_key_hash: legacyKeyHash,
              migrated_at: migratedAt,
            };
            const replayReport = buildReport(
              currentSnapshot,
              sharedLedger,
              {
                purpose,
                idempotency_key_hash: keyHash,
                estimated_request_credits:
                  estimatedCredits,
                durable_reservation_state: "completed",
                durable_replay_available: true,
                durable_replay_migrated_from_key_hash:
                  legacyKeyHash,
                requires_provider_call: false,
                verdict: "REPLAY",
              },
            );
            return {
              report: replayReport,
              replay: true,
              providerResult: {
                ...legacyEntry.provider_result,
              },
              providerResultKeyHash: legacyKeyHash,
              migratedFromKeyHash: legacyKeyHash,
            };
          }
          if (
            legacyEntry &&
            legacyEntry.state !== "released"
          ) {
            throw new ElevenLabsCreditGuardError(
              duplicateStateError(legacyEntry),
              {
                key_hash: legacyKeyHash,
                state: legacyEntry.state,
              },
            );
          }
        }
        const before = buildReport(
          currentSnapshot,
          sharedLedger,
        );
        if (
          estimatedCredits >
          before.available_credits_before_request
        ) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_credit_reserve_would_be_crossed",
            {
              included_credits_remaining:
                currentSnapshot.remaining,
              hard_reserve_credits:
                before.hard_reserve_credits,
              unobserved_committed_credits:
                before.unobserved_committed_credits,
              active_reserved_credits:
                before.active_reserved_credits,
              available_credits_before_request:
                before.available_credits_before_request,
              estimated_request_credits: estimatedCredits,
              external_overage_enabled:
                currentSnapshot.externalOverageEnabled,
              local_overage_allowed: localOverageAllowed,
            },
          );
        }
        sharedLedger.entries[keyHash] = {
          key_hash: keyHash,
          input_fingerprint: inputFingerprint,
          purpose,
          estimated_credits: estimatedCredits,
          state: "reserved",
          attempt_count:
            Number(existing?.attempt_count || 0) + 1,
          reserved_at: isoNow(),
        };
        const after = buildReport(
          currentSnapshot,
          sharedLedger,
          {
            purpose,
            idempotency_key_hash: keyHash,
            estimated_request_credits: estimatedCredits,
            available_credits_before_request:
              before.available_credits_before_request,
            included_credits_after_request: Math.max(
              0,
              currentSnapshot.remaining -
                Number(
                  sharedLedger.unobserved_committed_credits,
                ) -
                activeReservedCredits(sharedLedger),
            ),
            durable_reservation_state: "reserved",
            verdict: "ALLOW",
          },
        );
        return {
          report: after,
          replay: false,
          providerResult: null,
          providerResultKeyHash: null,
          migratedFromKeyHash: null,
        };
      });
    } catch (error) {
      throw wrapLedgerError(error);
    }

    const report = reservation.report;
    const replay = reservation.replay === true;
    let providerResultEvidence = replay
      ? { ...reservation.providerResult }
      : null;

    return {
      report,
      requiresProviderCall: !replay,
      replayAvailable: replay,
      get providerResultEvidence() {
        return providerResultEvidence
          ? { ...providerResultEvidence }
          : null;
      },
      async readRecordedProviderResult() {
        if (!replay) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_durable_replay_not_available",
            { key_hash: keyHash },
          );
        }
        let stored;
        try {
          stored = await ledger.readProviderResult(
            reservation.providerResultKeyHash || keyHash,
          );
        } catch (error) {
          throw wrapLedgerError(error);
        }
        if (
          stored.sha256 !==
            reservation.providerResult.sha256 ||
          stored.byte_length !==
            reservation.providerResult.byte_length
        ) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_durable_provider_result_integrity_failed",
            { key_hash: keyHash },
          );
        }
        return stored.value;
      },
      async markProviderCallStarted() {
        if (replay) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_replay_cannot_start_provider_call",
            { key_hash: keyHash },
          );
        }
        return updateEntry(
          keyHash,
          inputFingerprint,
          ["reserved"],
          (sharedLedger, entry) => {
            entry.state = "provider_call_started";
            entry.provider_call_started_at = isoNow();
            sharedLedger.unobserved_committed_credits +=
              Number(entry.estimated_credits);
            return true;
          },
        );
      },
      async recordProviderSuccess(providerResult) {
        if (replay) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_replay_cannot_record_provider_call",
            { key_hash: keyHash },
          );
        }
        await updateEntry(
          keyHash,
          inputFingerprint,
          ["provider_call_started"],
          () => true,
        );
        let stored;
        try {
          stored = await ledger.writeProviderResult(
            keyHash,
            providerResult,
          );
        } catch (error) {
          throw wrapLedgerError(error);
        }
        const recorded = await updateEntry(
          keyHash,
          inputFingerprint,
          ["provider_call_started"],
          (_sharedLedger, entry) => {
            entry.state = "provider_succeeded";
            entry.provider_succeeded_at = isoNow();
            entry.provider_result = stored;
            return stored;
          },
        );
        providerResultEvidence = { ...recorded };
        return { ...recorded };
      },
      async markProviderCallAmbiguous(reasonCode) {
        if (replay) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_replay_cannot_mark_provider_ambiguous",
            { key_hash: keyHash },
          );
        }
        const safeReason = /^[a-z0-9_]{1,120}$/.test(
          value(reasonCode),
        )
          ? value(reasonCode)
          : "provider_call_outcome_unknown";
        return updateEntry(
          keyHash,
          inputFingerprint,
          ["provider_call_started"],
          (_sharedLedger, entry) => {
            entry.state = "provider_call_ambiguous";
            entry.provider_call_ambiguous_at = isoNow();
            entry.ambiguity_reason = safeReason;
            return true;
          },
        );
      },
      async complete(result = {}) {
        return updateEntry(
          keyHash,
          inputFingerprint,
          ["provider_succeeded", "completed"],
          (_sharedLedger, entry) => {
            const alreadyCompleted = entry.state === "completed";
            entry.state = "completed";
            entry.completed_at = entry.completed_at || isoNow();
            const outputSha = value(result.outputSha256);
            if (/^[a-f0-9]{64}$/.test(outputSha)) {
              entry.output_sha256 = outputSha;
            }
            return !alreadyCompleted;
          },
        );
      },
      async release() {
        if (replay) {
          throw new ElevenLabsCreditGuardError(
            "elevenlabs_replay_release_forbidden",
            { key_hash: keyHash },
          );
        }
        return updateEntry(
          keyHash,
          inputFingerprint,
          ["reserved"],
          (_sharedLedger, entry) => {
            entry.state = "released";
            entry.released_at = isoNow();
            return true;
          },
        );
      },
    };
  }

  async function status({ force = false } = {}) {
    const currentSnapshot = await refreshSnapshot({ force });
    try {
      return await ledger.transaction((sharedLedger) => {
        reconcileObservation(sharedLedger, currentSnapshot);
        return buildReport(currentSnapshot, sharedLedger, {
          verdict: "MONITOR",
        });
      });
    } catch (error) {
      throw wrapLedgerError(error);
    }
  }

  return {
    preflight,
    status,
  };
}

module.exports = {
  DEFAULT_BASE_URL,
  PREFLIGHT_SCHEMA,
  ElevenLabsCreditGuardError,
  createElevenLabsCreditGovernor,
  estimateCredits,
};
