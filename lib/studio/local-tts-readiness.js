"use strict";

const DEFAULT_LOCAL_TTS_URL = "http://127.0.0.1:8765";

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function findVoice(health, voiceId) {
  const voices = Array.isArray(health?.voices) ? health.voices : [];
  return voices.find((voice) => String(voice.voice_id) === String(voiceId)) || null;
}

function summariseVoice(voice, voiceId) {
  if (!voice) {
    return {
      voiceId,
      alias: null,
      loaded: false,
      refResolved: false,
      present: false,
    };
  }
  return {
    voiceId: voice.voice_id || voiceId,
    alias: voice.alias || null,
    loaded: bool(voice.loaded),
    refResolved: bool(voice.ref_resolved),
    present: true,
  };
}

function summariseLocalTtsHealth(health, voiceId) {
  const status = String(health?.status || "unknown");
  const phase = String(health?.phase || "unknown");
  const ready = bool(health?.ready);
  const voice = summariseVoice(findVoice(health, voiceId), voiceId);
  const reasons = [];

  if (status !== "ok") reasons.push(`status is ${status}`);
  if (!ready) reasons.push(`service is not ready (phase=${phase})`);
  if (phase === "failed") reasons.push("service phase is failed");
  if (!voice.present) reasons.push(`voice ${voiceId} is not registered`);
  if (voice.present && !voice.refResolved) {
    reasons.push(`voice ${voice.alias || voiceId} reference audio is missing`);
  }
  if (voice.present && !voice.loaded) {
    reasons.push(`voice ${voice.alias || voiceId} is not loaded`);
  }

  return {
    ok: reasons.length === 0,
    status,
    phase,
    ready,
    engineCount: Number(health?.engine_count || 0),
    voice,
    reasons,
  };
}

async function fetchLocalTtsHealth({
  baseUrl = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
  voiceId,
  timeoutMs = 5000,
  fetchImpl = fetch,
} = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/health`, {
      signal: ac.signal,
    });
    const body = await res.json();
    if (!res.ok) {
      return {
        ok: false,
        status: `http_${res.status}`,
        phase: "unknown",
        ready: false,
        engineCount: 0,
        voice: summariseVoice(null, voiceId),
        reasons: [`health endpoint returned HTTP ${res.status}`],
      };
    }
    return summariseLocalTtsHealth(body, voiceId);
  } catch (err) {
    return {
      ok: false,
      status: "unreachable",
      phase: "unknown",
      ready: false,
      engineCount: 0,
      voice: summariseVoice(null, voiceId),
      reasons: [`health endpoint unreachable: ${err.message}`],
    };
  } finally {
    clearTimeout(timer);
  }
}

async function prewarmLocalTtsVoice({
  baseUrl = process.env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
  voiceId,
  timeoutMs = 600000,
  fetchImpl = fetch,
} = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/v1/prewarm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ voice_id: voiceId }),
      signal: ac.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        body?.detail || `prewarm endpoint returned HTTP ${res.status}`,
      );
    }
    return {
      ok: true,
      voiceId: body.voice_id || voiceId,
      loadedMs: Number(body.loaded_ms || 0),
      engineCount: Number(body.engine_count || 0),
      reused: body.reused === true,
    };
  } finally {
    clearTimeout(timer);
  }
}

function formatLocalTtsStatus(summary) {
  const voice = summary?.voice || {};
  return [
    `status=${summary?.status || "unknown"}`,
    `phase=${summary?.phase || "unknown"}`,
    `ready=${summary?.ready === true}`,
    `voice=${voice.alias || voice.voiceId || "unknown"}`,
    `loaded=${voice.loaded === true}`,
    `ref=${voice.refResolved === true}`,
    `engines=${summary?.engineCount || 0}`,
  ].join(" ");
}

module.exports = {
  DEFAULT_LOCAL_TTS_URL,
  summariseLocalTtsHealth,
  fetchLocalTtsHealth,
  prewarmLocalTtsVoice,
  formatLocalTtsStatus,
};
