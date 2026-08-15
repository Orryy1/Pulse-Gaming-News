"use strict";

function required(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function classifyError(error) {
  const status = Number(error?.response?.status || error?.status || error?.code);
  if (Number.isInteger(status) && status >= 400 && status < 500) {
    return `http_${status}`;
  }
  const code = String(error?.code || "").trim().toLowerCase();
  if (code) return code.slice(0, 128);
  return "runtime_error";
}

function buildDurableCircuitBreaker({
  repo,
  scope,
  actorId = "runtime",
  threshold = 3,
  cooldownMs = 4 * 60 * 60 * 1000,
  now = () => new Date(),
} = {}) {
  if (
    !repo
    || typeof repo.beforeAttempt !== "function"
    || typeof repo.recordFailure !== "function"
    || typeof repo.recordSuccess !== "function"
  ) {
    throw new Error("durable_circuit_breaker_repository_required");
  }
  const breakerScope = required(scope, "circuit_scope_required");
  const breakerActor = required(actorId, "circuit_actor_required");

  return {
    scope: breakerScope,
    beforeAttempt() {
      const result = repo.beforeAttempt({
        scope: breakerScope,
        actorId: breakerActor,
        now: now(),
      });
      if (!result.allowed) {
        const error = new Error("durable_circuit_open");
        error.code = "durable_circuit_open";
        error.circuit = result;
        throw error;
      }
      return result;
    },
    recordFailure(error, attempt = null) {
      return repo.recordFailure({
        scope: breakerScope,
        actorId: breakerActor,
        errorClass: classifyError(error),
        threshold,
        cooldownMs,
        probeToken: attempt?.probeToken || null,
        now: now(),
      });
    },
    recordSuccess(attempt = null) {
      return repo.recordSuccess({
        scope: breakerScope,
        actorId: breakerActor,
        threshold,
        probeToken: attempt?.probeToken || null,
        now: now(),
      });
    },
    status() {
      return repo.get(breakerScope);
    },
  };
}

module.exports = { buildDurableCircuitBreaker, classifyError };
