/**
 * Shared retry helper with exponential backoff.
 *
 * @param {Function} fn - async function to retry
 * @param {Object} opts
 * @param {number} opts.maxAttempts - total attempts (default 3)
 * @param {number[]} opts.delays - ms to wait before each retry (default [30s, 60s, 120s])
 * @param {string} opts.label - label for log messages (default 'upload')
 * @returns {Promise<*>} - result of fn() on success
 */
function isRetriable(err) {
  const status = err.response?.status;
  // Don't retry client errors (auth failures, bad requests, not found)
  if (status && status >= 400 && status < 500) return false;
  const msg = (err.message || '').toLowerCase();
  if (msg.includes('unauthorized') || msg.includes('invalid token') || msg.includes('not authenticated')) return false;
  return true;
}

async function withRetry(fn, { maxAttempts = 3, delays = [30000, 60000, 120000], label = 'upload' } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetriable(err)) {
        console.log(`[retry] ${label} failed with non-retriable error: ${err.message}`);
        throw err;
      }

      if (attempt === maxAttempts) {
        break;
      }

      const delay = delays[attempt - 1] || delays[delays.length - 1];
      console.log(`[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
      console.log(`[retry] Retrying in ${Math.round(delay / 1000)}s...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error(`${label} failed after ${maxAttempts} attempts: ${lastError.message}`);
}

module.exports = { withRetry, isRetriable };
