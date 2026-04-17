/**
 * lib/inference-client.js — Node-side client for the Phase 8 local
 * inference boundary exposed by tts_server/server.py.
 *
 * Every GPU-dependent job handler that runs inside workers/local-worker.js
 * eventually comes through here. The client is deliberately tiny: an
 * HTTP POST to /v1/infer with { kind, params, job_id } and a typed
 * response { ok, kind, job_id, result, error }.
 *
 *   const { invoke } = require('./lib/inference-client');
 *   const { narration_path } = await invoke('narrate_script', {
 *     voice_id: 'liam',
 *     segments: [{ label: 'hook', text: '...' }, ...],
 *   }, { jobId: 'short-42' });
 *
 * Environment:
 *   INFER_BASE_URL        full URL to tts_server (default http://127.0.0.1:8765)
 *   INFER_TIMEOUT_MS      per-call timeout used when the engine is cold
 *                         (default 600000 = 10 min). MUST cover the first
 *                         VoxCPM 2 default-engine load, which is ~3-5 min
 *                         on a Windows box with cached weights and
 *                         considerably longer on a cold HuggingFace cache.
 *                         Once the engine is warm, the per-call cost drops
 *                         to seconds; see INFER_WARM_TIMEOUT_MS for the
 *                         narrow budget used by the health warm-check.
 *   INFER_WARM_TIMEOUT_MS post-prewarm expectation (default 120000 = 2 min).
 *                         Used by prewarm() and by callers that know the
 *                         engine is already resident.
 *
 * Never retries on its own. The caller (usually the jobs-runner) has the
 * retry/backoff contract and should decide whether to retry a failed
 * inference based on the error shape. Timeout errors are classified on
 * the way out — see isTimeoutError() — so the runner can log the cause.
 */

const DEFAULT_BASE_URL = process.env.INFER_BASE_URL || "http://127.0.0.1:8765";
// Cold-start-safe default. Raised from 180s -> 600s in the Phase F stability
// patch after 5 GPU jobs died to `AbortError: This operation was aborted`
// during VoxCPM 2 first-load. Keep >= 600000 unless you have a warmup
// guarantee in front of this client.
const DEFAULT_TIMEOUT_MS = Number(process.env.INFER_TIMEOUT_MS || 600_000);
const DEFAULT_WARM_TIMEOUT_MS = Number(
  process.env.INFER_WARM_TIMEOUT_MS || 120_000,
);

class InferTimeoutError extends Error {
  constructor(kind, elapsedMs, limitMs, jobId) {
    super(
      `[inference-client] TIMEOUT kind=${kind} job=${jobId || "-"} ` +
        `elapsed_ms=${elapsedMs} limit_ms=${limitMs} — likely cold engine load; ` +
        `raise INFER_TIMEOUT_MS or prewarm via /v1/prewarm before enqueueing`,
    );
    this.name = "InferTimeoutError";
    this.kind = kind;
    this.elapsedMs = elapsedMs;
    this.limitMs = limitMs;
    this.jobId = jobId || null;
  }
}

function isTimeoutError(err) {
  return (
    err &&
    (err.name === "InferTimeoutError" ||
      err.name === "AbortError" ||
      /aborted/i.test(err.message || ""))
  );
}

/**
 * Invoke an inference kind and return the result block. Throws on
 * transport errors or non-2xx HTTP; returns the handler's result dict
 * when ok=true. When the handler returns ok=false (caught exception),
 * throws an Error with the handler's message.
 */
async function invoke(
  kind,
  params = {},
  { jobId, baseUrl, timeoutMs, signal } = {},
) {
  if (!kind) throw new Error("[inference-client] kind required");
  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/infer`;
  const limitMs = timeoutMs || DEFAULT_TIMEOUT_MS;
  const ac = signal ? null : new AbortController();
  const timer = ac ? setTimeout(() => ac.abort(), limitMs) : null;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, params, job_id: jobId || null }),
      signal: signal || (ac && ac.signal),
    });
    const text = await res.text();
    if (!res.ok) {
      // 4xx includes "unknown kind" (404) and "bad params" (400)
      throw new Error(
        `[inference-client] HTTP ${res.status} from /v1/infer kind=${kind} job=${jobId || "-"} elapsed_ms=${Date.now() - startedAt}: ${text.slice(0, 400)}`,
      );
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `[inference-client] non-JSON response from /v1/infer: ${text.slice(0, 200)}`,
      );
    }
    if (body.ok === false) {
      throw new Error(
        `[inference-client] ${kind} reported failure (job=${jobId || "-"} elapsed_ms=${Date.now() - startedAt}): ${body.error || "unknown"}`,
      );
    }
    return body.result || {};
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if (err && (err.name === "AbortError" || /aborted/i.test(err.message))) {
      // Reclassify so the runner's error path can distinguish "service
      // was slow" from "service returned 500". Log message carries the
      // cold-boot hint explicitly so log-scrapers don't have to guess.
      throw new InferTimeoutError(kind, elapsed, limitMs, jobId);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Prewarm a voice engine on the server without dispatching a real job.
 * Loads the requested voice_id's VoxCPMEngine (or the default) and
 * returns timing info. Used by local-worker boot and by manual warmup
 * scripts (scripts/prewarm-infer.ps1). Runs under the warm-timeout
 * budget — the prewarm endpoint itself is expected to block until
 * weights are resident, and should be treated as a "block here during
 * boot" call, not a normal request.
 *
 * Arguments:
 *   voiceId  default "__default__" — pass a mapped id to warm that
 *            specific voice instead of the env fallback
 *   baseUrl  override the server URL
 *   timeoutMs  override the warm timeout; callers warming from a cold
 *              HuggingFace cache should pass DEFAULT_TIMEOUT_MS explicitly
 *
 * Returns { voice_id, loaded_ms, engine_count, reused } per the server
 * contract.
 */
async function prewarm({ voiceId = "__default__", baseUrl, timeoutMs } = {}) {
  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/prewarm`;
  const limitMs = timeoutMs || DEFAULT_WARM_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), limitMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: voiceId }),
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `[inference-client] prewarm HTTP ${res.status} voice=${voiceId} elapsed_ms=${Date.now() - startedAt}: ${text.slice(0, 400)}`,
      );
    }
    return JSON.parse(text);
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if (err && (err.name === "AbortError" || /aborted/i.test(err.message))) {
      throw new InferTimeoutError("prewarm", elapsed, limitMs, null);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe the server for its handler registry. Used at worker startup so
 * we don't claim a job we can't service locally.
 */
async function listKinds({ baseUrl, timeoutMs } = {}) {
  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/infer/kinds`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs || 5_000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      throw new Error(`[inference-client] /v1/infer/kinds HTTP ${res.status}`);
    }
    const body = await res.json();
    return Array.isArray(body.kinds) ? body.kinds : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health ping. Returns the /health payload from tts_server. Worker boots
 * should warm-check this so "cannot reach inference" surfaces before a
 * job is claimed.
 */
async function health({ baseUrl, timeoutMs } = {}) {
  const url = `${(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "")}/health`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs || 5_000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) {
      return { ok: false, status: res.status };
    }
    const body = await res.json();
    return { ok: true, ...body };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  invoke,
  prewarm,
  listKinds,
  health,
  isTimeoutError,
  InferTimeoutError,
  DEFAULT_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WARM_TIMEOUT_MS,
};
