"use strict";

const path = require("node:path");

const {
  resolveAcceptedLocalVoiceReference,
} = require("./v2/local-voice-reference");

const DEFAULT_LOCAL_TTS_URL = "http://127.0.0.1:8765";

function bool(value) {
  return value === true || /^(true|1|yes|on)$/i.test(String(value || ""));
}

function findVoice(health, voiceId) {
  const voices = Array.isArray(health?.voices) ? health.voices : [];
  return voices.find((voice) => String(voice.voice_id) === String(voiceId)) || null;
}

function firstValue(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return null;
}

function basenameOrNull(...values) {
  const raw = firstValue(...values);
  if (!raw) return null;
  return path.basename(String(raw).replace(/\\/g, "/"));
}

function summariseReference(voice = {}) {
  return {
    id: firstValue(
      voice.accepted_reference_id,
      voice.acceptedReferenceId,
      voice.reference_id,
      voice.referenceId,
    ),
    fileName: basenameOrNull(
      voice.accepted_reference_file,
      voice.acceptedReferenceFile,
      voice.reference_file,
      voice.referenceFile,
      voice.ref_voice_path,
      voice.refVoicePath,
    ),
    referenceHash: firstValue(
      voice.reference_sha1,
      voice.referenceSha1,
      voice.reference_hash,
      voice.referenceHash,
    ),
    referencePresent: bool(firstValue(
      voice.reference_present,
      voice.referencePresent,
      voice.ref_resolved,
      voice.refResolved,
    )),
  };
}

function referenceReasons(reference = {}, env = process.env) {
  const accepted = resolveAcceptedLocalVoiceReference(env);
  const reasons = [];
  if (accepted.referencePresent !== true) {
    reasons.push("accepted Sleepy Liam reference file is missing locally");
    return reasons;
  }
  if (reference.referencePresent !== true) {
    reasons.push("accepted Sleepy Liam reference is not reported present");
  }
  if (reference.id !== accepted.id) {
    reasons.push(`accepted Sleepy Liam reference id mismatch (${reference.id || "missing"})`);
  }
  if (reference.fileName !== accepted.fileName) {
    reasons.push(`accepted Sleepy Liam reference file mismatch (${reference.fileName || "missing"})`);
  }
  if (!reference.referenceHash) {
    reasons.push("accepted Sleepy Liam reference fingerprint is missing");
  } else if (accepted.referenceHash && reference.referenceHash !== accepted.referenceHash) {
    reasons.push("accepted Sleepy Liam reference fingerprint mismatch");
  }
  return reasons;
}

function summariseVoice(voice, voiceId) {
  if (!voice) {
    return {
      voiceId,
      alias: null,
      loaded: false,
      refResolved: false,
      present: false,
      reference: {
        id: null,
        fileName: null,
        referenceHash: null,
        referencePresent: false,
      },
    };
  }
  const reference = summariseReference(voice);
  return {
    voiceId: voice.voice_id || voiceId,
    alias: voice.alias || null,
    loaded: bool(voice.loaded),
    refResolved: bool(voice.ref_resolved),
    present: true,
    reference,
  };
}

function summariseLocalTtsHealth(health, voiceId, options = {}) {
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
  if (voice.present) {
    reasons.push(...referenceReasons(voice.reference, options.env || process.env));
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
  const reference = voice.reference || {};
  return [
    `status=${summary?.status || "unknown"}`,
    `phase=${summary?.phase || "unknown"}`,
    `ready=${summary?.ready === true}`,
    `voice=${voice.alias || voice.voiceId || "unknown"}`,
    `loaded=${voice.loaded === true}`,
    `ref=${voice.refResolved === true}`,
    `ref_id=${reference.id || "missing"}`,
    `ref_hash=${reference.referenceHash ? "present" : "missing"}`,
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
