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
 *   INFER_BASE_URL  — full URL to tts_server (default http://127.0.0.1:8765)
 *   INFER_TIMEOUT_MS — per-call timeout (default 180000 = 3 min)
 *
 * Never retries on its own. The caller (usually the jobs-runner) has the
 * retry/backoff contract and should decide whether to retry a failed
 * inference based on the error shape.
 */

const DEFAULT_BASE_URL = process.env.INFER_BASE_URL || "http://127.0.0.1:8765";
const DEFAULT_TIMEOUT_MS = Number(process.env.INFER_TIMEOUT_MS || 180_000);

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
  const ac = signal ? null : new AbortController();
  const timer = ac
    ? setTimeout(() => ac.abort(), timeoutMs || DEFAULT_TIMEOUT_MS)
    : null;
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
        `[inference-client] HTTP ${res.status} from /v1/infer kind=${kind}: ${text.slice(0, 400)}`,
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
        `[inference-client] ${kind} reported failure: ${body.error || "unknown"}`,
      );
    }
    return body.result || {};
  } finally {
    if (timer) clearTimeout(timer);
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

module.exports = { invoke, listKinds, health, DEFAULT_BASE_URL };
