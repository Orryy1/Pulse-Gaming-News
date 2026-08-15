"use strict";

const crypto = require("node:crypto");

function required(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function iso(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("circuit_breaker_time_invalid");
  return date.toISOString();
}

function positive(value, code, minimum = 1) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum) throw new Error(code);
  return result;
}

function bind(db, { tokenFactory = crypto.randomUUID } = {}) {
  const getStmt = db.prepare("SELECT * FROM circuit_breakers WHERE scope = ?");
  const insertStmt = db.prepare(`
    INSERT INTO circuit_breakers
      (scope, state, version, failure_count, failure_threshold,
       opened_at, cooldown_until, probe_token, probe_owner_id,
       probe_issued_at, last_error_class, updated_at)
    VALUES (@scope, @state, 1, @failureCount, @failureThreshold,
            @openedAt, @cooldownUntil, @probeToken, @probeOwnerId,
            @probeIssuedAt, @lastErrorClass, @now)
    RETURNING *
  `);
  const updateStmt = db.prepare(`
    UPDATE circuit_breakers
    SET state = @state,
        version = version + 1,
        failure_count = @failureCount,
        failure_threshold = @failureThreshold,
        opened_at = @openedAt,
        cooldown_until = @cooldownUntil,
        probe_token = @probeToken,
        probe_owner_id = @probeOwnerId,
        probe_issued_at = @probeIssuedAt,
        last_error_class = @lastErrorClass,
        updated_at = @now
    WHERE scope = @scope AND version = @expectedVersion
    RETURNING *
  `);
  const eventStmt = db.prepare(`
    INSERT INTO circuit_breaker_events
      (scope, version, from_state, to_state, event_type, actor_id,
       evidence_json, created_at)
    VALUES (@scope, @version, @fromState, @toState, @eventType,
            @actorId, @evidenceJson, @now)
  `);

  function get(scope) {
    const normalised = String(scope || "").trim();
    return normalised ? getStmt.get(normalised) || null : null;
  }

  function persist(current, values, event) {
    const row = current
      ? updateStmt.get({ ...values, expectedVersion: current.version })
      : insertStmt.get(values);
    if (!row) throw new Error("stale_control_version");
    eventStmt.run({
      scope: row.scope,
      version: row.version,
      fromState: current?.state || null,
      toState: row.state,
      eventType: event.type,
      actorId: event.actorId,
      evidenceJson: event.evidence ? JSON.stringify(event.evidence) : null,
      now: values.now,
    });
    return row;
  }

  function values({
    scope,
    state,
    failureCount,
    failureThreshold,
    openedAt = null,
    cooldownUntil = null,
    probeToken = null,
    probeOwnerId = null,
    probeIssuedAt = null,
    lastErrorClass = null,
    now,
  }) {
    return {
      scope,
      state,
      failureCount,
      failureThreshold,
      openedAt,
      cooldownUntil,
      probeToken,
      probeOwnerId,
      probeIssuedAt,
      lastErrorClass,
      now,
    };
  }

  const halfOpenTransaction = db.transaction(({ scope, now, actorId }) => {
    const current = getStmt.get(scope);
    if (!current) return { allowed: true, state: "CLOSED", version: 0 };
    if (current.state === "CLOSED") {
      return { allowed: true, state: current.state, version: current.version };
    }
    if (current.state === "HALF_OPEN") {
      return {
        allowed: false,
        state: current.state,
        version: current.version,
        reason: "half_open_probe_in_progress",
      };
    }
    if (!current.cooldown_until || current.cooldown_until > now) {
      return {
        allowed: false,
        state: current.state,
        version: current.version,
        reason: "circuit_open",
        retry_at: current.cooldown_until,
      };
    }
    const probeToken = required(tokenFactory(), "circuit_probe_token_required");
    const updated = persist(
      current,
      values({
        scope,
        state: "HALF_OPEN",
        failureCount: current.failure_count,
        failureThreshold: current.failure_threshold,
        openedAt: current.opened_at,
        cooldownUntil: current.cooldown_until,
        probeToken,
        probeOwnerId: actorId,
        probeIssuedAt: now,
        lastErrorClass: current.last_error_class,
        now,
      }),
      { type: "HALF_OPEN_PROBE_ISSUED", actorId, evidence: { probeToken } },
    );
    return {
      allowed: true,
      state: updated.state,
      version: updated.version,
      probeToken,
    };
  });

  const failureTransaction = db.transaction((input) => {
    const scope = required(input.scope, "circuit_scope_required");
    const actorId = required(input.actorId || "runtime", "circuit_actor_required");
    const errorClass = required(input.errorClass, "circuit_error_class_required");
    const now = iso(input.now);
    const current = getStmt.get(scope) || null;
    const threshold = positive(
      input.threshold || current?.failure_threshold || 3,
      "circuit_threshold_invalid",
    );
    const cooldownMs = positive(input.cooldownMs || 60000, "circuit_cooldown_invalid");
    if (current?.state === "OPEN") {
      throw new Error("circuit_attempt_not_allowed");
    }
    if (current?.state === "HALF_OPEN" && current.probe_token !== input.probeToken) {
      throw new Error("circuit_probe_token_mismatch");
    }
    if (current?.state === "OPEN" && input.probeToken) {
      throw new Error("circuit_probe_not_active");
    }
    const failureCount = Number(current?.failure_count || 0) + 1;
    const shouldOpen = current?.state === "HALF_OPEN" || failureCount >= threshold;
    const state = shouldOpen ? "OPEN" : "CLOSED";
    const openedAt = shouldOpen ? now : null;
    const cooldownUntil = shouldOpen
      ? iso(new Date(new Date(now).getTime() + cooldownMs))
      : null;
    return persist(
      current,
      values({
        scope,
        state,
        failureCount,
        failureThreshold: threshold,
        openedAt,
        cooldownUntil,
        lastErrorClass: errorClass,
        now,
      }),
      {
        type: shouldOpen ? "FAILURE_OPENED" : "FAILURE_RECORDED",
        actorId,
        evidence: { errorClass, failureCount, threshold, cooldownMs },
      },
    );
  });

  const successTransaction = db.transaction((input) => {
    const scope = required(input.scope, "circuit_scope_required");
    const actorId = required(input.actorId || "runtime", "circuit_actor_required");
    const now = iso(input.now);
    const current = getStmt.get(scope) || null;
    if (!current) {
      return persist(
        null,
        values({
          scope,
          state: "CLOSED",
          failureCount: 0,
          failureThreshold: positive(input.threshold || 3, "circuit_threshold_invalid"),
          now,
        }),
        { type: "SUCCESS_INITIALISED", actorId },
      );
    }
    if (current.state === "OPEN") throw new Error("circuit_probe_required");
    if (current.state === "HALF_OPEN" && current.probe_token !== input.probeToken) {
      throw new Error("circuit_probe_token_mismatch");
    }
    if (current.state === "CLOSED" && current.failure_count === 0) return current;
    return persist(
      current,
      values({
        scope,
        state: "CLOSED",
        failureCount: 0,
        failureThreshold: current.failure_threshold,
        now,
      }),
      { type: "SUCCESS_CLOSED", actorId },
    );
  });

  const forceTransaction = db.transaction((input) => {
    const scope = required(input.scope, "circuit_scope_required");
    const actorId = required(input.actorId, "circuit_actor_required");
    const reason = required(input.reason, "circuit_reason_required");
    const now = iso(input.now);
    const current = getStmt.get(scope) || null;
    const expectedVersion = Number(input.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw new Error("circuit_expected_version_required");
    }
    if (Number(current?.version || 0) !== expectedVersion) {
      throw new Error("stale_control_version");
    }
    const state = input.state;
    const threshold = positive(
      input.threshold || current?.failure_threshold || 3,
      "circuit_threshold_invalid",
    );
    const cooldownMs = positive(input.cooldownMs || 60000, "circuit_cooldown_invalid");
    const opening = state === "OPEN";
    return persist(
      current,
      values({
        scope,
        state,
        failureCount: opening ? Math.max(1, Number(current?.failure_count || 0)) : 0,
        failureThreshold: threshold,
        openedAt: opening ? now : null,
        cooldownUntil: opening
          ? iso(new Date(new Date(now).getTime() + cooldownMs))
          : null,
        lastErrorClass: opening ? reason : null,
        now,
      }),
      { type: opening ? "FORCED_OPEN" : "RESET_CLOSED", actorId, evidence: { reason } },
    );
  });

  return {
    get,
    beforeAttempt({ scope, now = new Date(), actorId = "runtime" }) {
      return halfOpenTransaction.immediate({
        scope: required(scope, "circuit_scope_required"),
        now: iso(now),
        actorId: required(actorId, "circuit_actor_required"),
      });
    },
    recordFailure(input) {
      return failureTransaction.immediate(input);
    },
    recordSuccess(input) {
      return successTransaction.immediate(input);
    },
    open(input) {
      return forceTransaction.immediate({ ...input, state: "OPEN" });
    },
    reset(input) {
      return forceTransaction.immediate({ ...input, state: "CLOSED" });
    },
  };
}

module.exports = { bind, iso };
