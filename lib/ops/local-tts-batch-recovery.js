"use strict";

const {
  DEFAULT_LOCAL_TTS_URL,
  fetchLocalTtsHealth,
  prewarmLocalTtsVoice,
} = require("../studio/local-tts-readiness");
const {
  startLocalTtsServer,
  waitForLocalTtsHealth,
} = require("../studio/local-tts-supervisor");
const {
  classifyLocalTtsFailure,
} = require("../studio/local-tts-failures");
const {
  classifyLocalLiamSafety,
} = require("./local-liam-safety");

function compactHealth(summary = {}) {
  const voice = summary.voice || {};
  const reference = voice.reference || {};
  return {
    ok: summary.ok === true,
    status: summary.status || "unknown",
    phase: summary.phase || "unknown",
    ready: summary.ready === true,
    voice: {
      alias: voice.alias || null,
      loaded: voice.loaded === true,
      refResolved: voice.refResolved === true || voice.ref_resolved === true,
      reference: {
        id: reference.id || voice.acceptedReferenceId || voice.accepted_reference_id || null,
        fileName: reference.fileName || voice.acceptedReferenceFile || voice.accepted_reference_file || null,
        referencePresent:
          reference.referencePresent === true ||
          voice.referencePresent === true ||
          voice.reference_present === true,
        referenceHash: reference.referenceHash ? "present" : null,
      },
    },
  };
}

function safeErrorMessage(err) {
  return String(err?.message || err || "unknown_error")
    .replace(/\s+/g, " ")
    .slice(0, 240);
}

async function generateLocalTtsWithOptionalRecovery({
  storyId,
  text,
  outputRel,
  rate = 1.0,
  generateTts,
  recoverLocalTts = null,
} = {}) {
  let lastFailure = null;
  let lastError = null;
  let recovery = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await generateTts(text, outputRel, rate);
      return {
        ok: true,
        attempts: attempt,
        recovery,
      };
    } catch (err) {
      lastFailure = classifyLocalTtsFailure(err);
      lastError = err;
      const shouldRecover =
        attempt === 1 &&
        lastFailure.requires_server_reset === true &&
        lastFailure.code !== "tts_timeout" &&
        typeof recoverLocalTts === "function";
      if (!shouldRecover) break;
      try {
        recovery = await recoverLocalTts({
          storyId,
          outputRel,
          failure: lastFailure,
          error: safeErrorMessage(err),
        });
      } catch (recoverErr) {
        recovery = {
          ok: false,
          action: "recover_failed",
          error: safeErrorMessage(recoverErr),
        };
      }
      if (recovery?.ok === true) continue;
      break;
    }
  }

  return {
    ok: false,
    attempts: recovery ? 2 : 1,
    failure: lastFailure || { code: "tts_failed", requires_server_reset: false },
    error: safeErrorMessage(lastError),
    recovery,
  };
}

function needsPrewarm(summary = {}) {
  const voice = summary.voice || {};
  return (
    String(summary.status || "").toLowerCase() === "ok" &&
    summary.ready === true &&
    voice.present !== false &&
    (voice.refResolved === true || voice.ref_resolved === true) &&
    voice.loaded !== true
  );
}

function createLocalTtsBatchRecovery({
  root = process.cwd(),
  env = process.env,
  baseUrl = env.LOCAL_TTS_URL || DEFAULT_LOCAL_TTS_URL,
  voiceId,
  fetchHealth = fetchLocalTtsHealth,
  startServer = startLocalTtsServer,
  waitForHealth = waitForLocalTtsHealth,
  prewarmVoice = prewarmLocalTtsVoice,
  classifySafety = classifyLocalLiamSafety,
} = {}) {
  return async function recoverLocalTts(context = {}) {
    const report = {
      ok: false,
      action: "inspect",
      story_id: context.storyId || null,
      failure_code: context.failure?.code || null,
      failure_message: context.failure?.message || null,
      before: null,
      after: null,
      started: null,
      prewarm: null,
      error: null,
    };

    try {
      const before = await fetchHealth({
        baseUrl,
        voiceId,
        timeoutMs: Number(env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
      });
      report.before = compactHealth(before);
      let current = before;

      if (String(before.status || "").toLowerCase() === "unreachable") {
        report.action = "start";
        report.started = await startServer({ root, env });
        current = await waitForHealth({
          baseUrl,
          voiceId,
          timeoutMs: Number(env.LOCAL_TTS_START_WAIT_MS || 45000),
          intervalMs: Number(env.LOCAL_TTS_START_POLL_MS || 1500),
        });
      }

      if (needsPrewarm(current)) {
        report.action = report.action === "start" ? "start+prewarm" : "prewarm";
        report.prewarm = await prewarmVoice({
          baseUrl,
          voiceId,
          timeoutMs: Number(env.LOCAL_TTS_PREWARM_TIMEOUT_MS || 600000),
        });
        current = await fetchHealth({
          baseUrl,
          voiceId,
          timeoutMs: Number(env.LOCAL_TTS_HEALTH_TIMEOUT_MS || 5000),
        });
      }

      report.after = compactHealth(current);
      const safety = classifySafety(current);
      report.ok = safety.safe === true;
      report.failure_code = report.ok ? null : safety.code || report.failure_code || "local_tts_recovery_failed";
      report.failure_message = report.ok ? null : safety.message || "local TTS recovery did not reach a safe Liam state";
      return report;
    } catch (err) {
      report.ok = false;
      report.error = safeErrorMessage(err);
      report.failure_code = "local_tts_recovery_failed";
      report.failure_message = report.error;
      return report;
    }
  };
}

module.exports = {
  compactHealth,
  createLocalTtsBatchRecovery,
  generateLocalTtsWithOptionalRecovery,
};
