/**
 * Shared retry helper with exponential backoff and circuit breaker.
 *
 * Circuit breaker: after N consecutive failures for a platform, pause that
 * platform for a cooldown period to avoid burning API reputation.
 *
 * @param {Function} fn - async function to retry
 * @param {Object} opts
 * @param {number} opts.maxAttempts - total attempts (default 3)
 * @param {number[]} opts.delays - ms to wait before each retry (default [30s, 60s, 120s])
 * @param {string} opts.label - label for log messages (default 'upload')
 * @returns {Promise<*>} - result of fn() on success
 */

// --- Circuit breaker state (per platform) ---
const circuitState = {};
const CIRCUIT_THRESHOLD = 3; // consecutive failures before tripping
const CIRCUIT_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

function getCircuit(platform) {
  if (!circuitState[platform]) {
    circuitState[platform] = { failures: 0, trippedAt: null };
  }
  return circuitState[platform];
}

function isCircuitOpen(platform) {
  const circuit = getCircuit(platform);
  if (!circuit.trippedAt) return false;
  const elapsed = Date.now() - circuit.trippedAt;
  if (elapsed >= CIRCUIT_COOLDOWN_MS) {
    // Cooldown expired, reset circuit
    circuit.failures = 0;
    circuit.trippedAt = null;
    console.log(`[circuit] ${platform} circuit reset after cooldown`);
    return false;
  }
  return true;
}

function recordFailure(platform) {
  const circuit = getCircuit(platform);
  circuit.failures++;
  if (circuit.failures >= CIRCUIT_THRESHOLD && !circuit.trippedAt) {
    circuit.trippedAt = Date.now();
    const hours = Math.round(CIRCUIT_COOLDOWN_MS / (60 * 60 * 1000));
    console.log(
      `[circuit] ${platform} TRIPPED after ${circuit.failures} consecutive failures. Paused for ${hours}h.`,
    );
  }
}

function recordSuccess(platform) {
  const circuit = getCircuit(platform);
  circuit.failures = 0;
  circuit.trippedAt = null;
}

function getCircuitStatus() {
  const status = {};
  for (const [platform, state] of Object.entries(circuitState)) {
    status[platform] = {
      failures: state.failures,
      tripped: !!state.trippedAt,
      resumesAt: state.trippedAt
        ? new Date(state.trippedAt + CIRCUIT_COOLDOWN_MS).toISOString()
        : null,
    };
  }
  return status;
}

function isRetriable(err) {
  const status = err.response?.status;
  // Don't retry client errors (auth failures, bad requests, not found)
  if (status && status >= 400 && status < 500) return false;
  const msg = (err.message || "").toLowerCase();
  if (
    msg.includes("unauthorized") ||
    msg.includes("invalid token") ||
    msg.includes("not authenticated")
  )
    return false;
  return true;
}

async function withRetry(
  fn,
  {
    maxAttempts = 3,
    delays = [30000, 60000, 120000],
    label = "upload",
    platform = null,
  } = {},
) {
  // Check circuit breaker before attempting
  if (platform && isCircuitOpen(platform)) {
    const circuit = getCircuit(platform);
    const resumesAt = new Date(
      circuit.trippedAt + CIRCUIT_COOLDOWN_MS,
    ).toISOString();
    throw new Error(
      `${label} skipped: ${platform} circuit breaker is open (${circuit.failures} consecutive failures). Resumes at ${resumesAt}`,
    );
  }

  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (platform) recordSuccess(platform);
      return result;
    } catch (err) {
      lastError = err;

      if (!isRetriable(err)) {
        if (platform) recordFailure(platform);
        console.log(
          `[retry] ${label} failed with non-retriable error: ${err.message}`,
        );
        throw err;
      }

      if (attempt === maxAttempts) {
        if (platform) recordFailure(platform);
        break;
      }

      const delay = delays[attempt - 1] || delays[delays.length - 1];
      console.log(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`,
      );
      console.log(`[retry] Retrying in ${Math.round(delay / 1000)}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new Error(
    `${label} failed after ${maxAttempts} attempts: ${lastError.message}`,
  );
}

module.exports = {
  withRetry,
  isRetriable,
  isCircuitOpen,
  getCircuitStatus,
  recordFailure,
  recordSuccess,
};
