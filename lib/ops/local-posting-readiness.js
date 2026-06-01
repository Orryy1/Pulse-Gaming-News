"use strict";

function normaliseVerdict(value) {
  return String(value || "unknown").trim().toLowerCase();
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function healthOk(health) {
  return Boolean(health && health.ok);
}

function publicLocalDeployment(health) {
  return (
    healthOk(health) &&
    String(health?.json?.deployment?.mode || "").trim().toLowerCase() === "local" &&
    typeof health?.json?.deployment?.primary === "boolean"
  );
}

function hasTunnelConnection(cutoverPlan = {}, publicHealth = null) {
  if (publicLocalDeployment(publicHealth || cutoverPlan.health?.public)) return true;

  const tunnelInfo = String(cutoverPlan.cloudflared?.tunnel_info || "");
  if (/does not have any active connection|no active connection/i.test(tunnelInfo)) {
    return false;
  }
  if (/active connections?:\s*[1-9]/i.test(tunnelInfo)) return true;
  return normaliseVerdict(cutoverPlan.verdict) === "green";
}

function ttsProofCount(ttsReport = {}) {
  return Number(ttsReport.proof_batch?.voice_ready_count || 0);
}

function voiceRefResolved(voice = {}) {
  return voice.refResolved === true || voice.ref_resolved === true;
}

function doctorHealth(report = {}, source = "doctor_report") {
  const verdict = report?.verdict || null;
  const current = report?.after || report?.before || report || {};
  const voice = current.voice || report?.voice || {};
  const ready =
    report?.local_ready === true ||
    current.ready === true;
  const green =
    normaliseVerdict(verdict) === "green" &&
    ready &&
    voice.loaded === true &&
    voiceRefResolved(voice);
  return {
    green,
    source,
    verdict,
    ready,
    voice_loaded: voice.loaded === true,
    voice_ref_resolved: voiceRefResolved(voice),
  };
}

function resolveLocalTtsReadiness({ ttsReport = null, ttsDoctorReport = null } = {}) {
  const candidates = [];
  if (ttsDoctorReport) {
    candidates.push(doctorHealth(ttsDoctorReport, "doctor_report"));
  }
  if (ttsReport?.doctor) {
    candidates.push(doctorHealth(ttsReport.doctor, "overnight_doctor"));
  }
  candidates.push({
    green: normaliseVerdict(ttsReport?.verdict) === "green",
    source: "overnight_verdict",
    verdict: ttsReport?.verdict || null,
    ready: normaliseVerdict(ttsReport?.verdict) === "green",
    voice_loaded: null,
    voice_ref_resolved: null,
  });
  return (
    candidates.find((candidate) => candidate.green) ||
    candidates.find((candidate) => candidate.verdict) ||
    candidates[candidates.length - 1]
  );
}

function buildLocalPostingReadiness({
  cutoverPlan = null,
  primaryReadiness = null,
  ttsReport = null,
  ttsDoctorReport = null,
  now = new Date(),
} = {}) {
  const blockers = [];
  const warnings = [];
  const nextSteps = [];

  const envFlags = cutoverPlan?.env?.flags || {};
  const duplicateKeys = cutoverPlan?.env?.duplicate_keys || primaryReadiness?.duplicate_env_keys || [];
  const duplicateControlKeys = duplicateKeys.filter((key) =>
    ["AUTO_PUBLISH", "USE_JOB_QUEUE", "PULSE_PRIMARY_INSTANCE", "DEPLOYMENT_MODE"].includes(key),
  );
  const localHealth = primaryReadiness?.health?.local || cutoverPlan?.health?.local || null;
  const publicHealth = primaryReadiness?.health?.public || cutoverPlan?.health?.public || null;
  const localRuntime = localHealth?.json?.runtime || {};
  const localDeployment = localHealth?.json?.deployment || {};
  const safeObservationMode = localRuntime.safe_observation_mode === true;
  const runningPrimaryEnabled =
    typeof localDeployment.primary === "boolean" ? localDeployment.primary === true : null;
  const runningAutoPublishEnabled =
    typeof localRuntime.auto_publish === "boolean" ? localRuntime.auto_publish === true : null;
  const localTtsEvidence = resolveLocalTtsReadiness({ ttsReport, ttsDoctorReport });
  const localTtsGreen = localTtsEvidence.green === true;
  const localVoiceReadyCount = ttsProofCount(ttsReport);
  const configuredPrimaryEnabled =
    primaryReadiness?.checks?.primary_enabled === true || envFlags.primary === true;
  const configuredQueueEnabled =
    primaryReadiness?.checks?.use_job_queue_enabled === true || envFlags.use_job_queue === true;
  const configuredAutoPublishEnabled =
    primaryReadiness?.checks?.auto_publish_enabled === true || envFlags.auto_publish === true;
  const primaryEnabled =
    configuredPrimaryEnabled && !safeObservationMode && runningPrimaryEnabled !== false;
  const queueEnabled = configuredQueueEnabled;
  const autoPublishEnabled =
    configuredAutoPublishEnabled && !safeObservationMode && runningAutoPublishEnabled !== false;
  const tunnelConnected = hasTunnelConnection(cutoverPlan || {}, publicHealth);

  if (duplicateControlKeys.length) {
    blockers.push(`duplicate local control switches in .env: ${duplicateControlKeys.join(", ")}`);
  }
  if (!healthOk(localHealth)) blockers.push("local server is not healthy on localhost:3001");
  if (!tunnelConnected) blockers.push("pulse.orryy.com Cloudflare tunnel is not connected to this PC");
  if (!healthOk(publicHealth)) blockers.push("public pulse.orryy.com health check is not reaching local Pulse");
  if (safeObservationMode) blockers.push("local server is running safe observation mode, not primary posting mode");
  if (runningPrimaryEnabled === false) blockers.push("running local server reports primary=false");
  if (runningAutoPublishEnabled === false) blockers.push("running local server reports AUTO_PUBLISH=false");
  if (!primaryEnabled) blockers.push("local instance is still mirror mode, not primary");
  if (!queueEnabled) blockers.push("local job queue is disabled");
  if (!autoPublishEnabled) blockers.push("local AUTO_PUBLISH is disabled");
  if (!localTtsGreen) blockers.push("local Liam TTS readiness is not green");
  if (localVoiceReadyCount < 1) blockers.push("no local Liam voice-ready proof MP3s are available");

  if (ttsReport?.proof_batch?.superseded_failure_counts?.tts_timeout) {
    warnings.push("local TTS has recovered from at least one timeout; keep the supervisor/watchdog enabled");
  }
  if (localTtsGreen && normaliseVerdict(ttsReport?.verdict) !== "green") {
    warnings.push("local Liam service is green but the overnight proof batch still has repair work");
  }
  if (normaliseVerdict(cutoverPlan?.verdict) === "red") {
    warnings.push("local cutover plan is still red; use it as the authoritative blocker list before posting");
  }

  nextSteps.push("Keep Railway as standby only; do not restore it as the active publisher for cost reasons.");
  nextSteps.push("Keep ElevenLabs as a temporary live bridge only while local Liam TTS is hardened.");
  nextSteps.push("Clean duplicate .env control switches so AUTO_PUBLISH and USE_JOB_QUEUE appear once.");
  nextSteps.push("Run the local server in mirror mode and keep /api/health green before any cutover.");
  nextSteps.push("Start the pulse.orryy.com Cloudflare tunnel from this PC when ready.");
  nextSteps.push("Only after the readiness report is green, intentionally flip local primary, queue and auto-publish flags.");

  const readyForLocalPrimary =
    blockers.length === 0 && localTtsGreen && localVoiceReadyCount > 0 && healthOk(publicHealth);
  const verdict = readyForLocalPrimary ? "green" : healthOk(localHealth) && localTtsGreen ? "amber" : "red";
  const status = readyForLocalPrimary
    ? "ready_to_resume_local_posting"
    : healthOk(localHealth) && localTtsGreen
      ? "local_foundation_ready_cutover_blocked"
      : "not_ready";

  return {
    schema_version: 1,
    generated_at: now.toISOString(),
    verdict,
    status,
    strategy: {
      hosting: "local_pc_primary_target",
      railway_role: "standby_optional_only",
      voice: "local_liam_primary_goal_elevenlabs_temporary_bridge",
    },
    readiness: {
      local_health: healthOk(localHealth),
      public_health: healthOk(publicHealth),
      tunnel_connected: tunnelConnected,
      duplicate_control_keys: duplicateControlKeys,
      configured_primary_enabled: configuredPrimaryEnabled,
      configured_queue_enabled: configuredQueueEnabled,
      configured_auto_publish_enabled: configuredAutoPublishEnabled,
      running_primary_enabled: runningPrimaryEnabled,
      running_auto_publish_enabled: runningAutoPublishEnabled,
      safe_observation_mode: safeObservationMode,
      primary_enabled: primaryEnabled,
      queue_enabled: queueEnabled,
      auto_publish_enabled: autoPublishEnabled,
      local_tts_green: localTtsGreen,
      local_tts_evidence_source: localTtsEvidence.source,
      local_tts_report_verdict: ttsReport?.verdict || null,
      local_tts_doctor_verdict:
        ttsDoctorReport?.verdict || ttsReport?.doctor?.verdict || null,
      local_voice_ready_count: localVoiceReadyCount,
    },
    blockers,
    warnings,
    next_steps: nextSteps,
    commands: {
      local_cutover_plan: "npm run ops:local-cutover-plan",
      local_primary_readiness: "npm run ops:local-primary-readiness",
      local_tts_report: "npm run tts:overnight-report",
      cloudflare_tunnel:
        "cloudflared tunnel --config D:/pulse-data/cloudflared-pulse.yml run pulse-gaming-local",
    },
    safety:
      "read-only report; does not edit .env, start primary jobs, post, mutate DB, touch Railway or trigger OAuth",
  };
}

function formatLocalPostingReadinessMarkdown(report) {
  const lines = [];
  lines.push("# Local Posting Readiness");
  lines.push("");
  lines.push(`Generated: ${report.generated_at}`);
  lines.push(`Verdict: ${String(report.verdict || "unknown").toUpperCase()}`);
  lines.push(`Status: ${report.status}`);
  lines.push(`Safety: ${report.safety}`);
  lines.push("");
  lines.push("## Strategy");
  lines.push("- Railway: standby/optional only, not the active publisher target.");
  lines.push("- Hosting target: this PC running Pulse locally through pulse.orryy.com.");
  lines.push("- Voice target: local Liam. ElevenLabs is a temporary bridge, not the long-term plan.");
  lines.push("");
  lines.push("## Readiness");
  for (const [key, value] of Object.entries(report.readiness || {})) {
    const display = Array.isArray(value) ? (value.length ? value.join(", ") : "none") : value;
    lines.push(`- ${key}: ${display}`);
  }
  if (report.blockers?.length) {
    lines.push("");
    lines.push("## Blockers");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  }
  if (report.warnings?.length) {
    lines.push("");
    lines.push("## Warnings");
    for (const warning of report.warnings) lines.push(`- ${warning}`);
  }
  lines.push("");
  lines.push("## Next Steps");
  for (const step of report.next_steps || []) lines.push(`- ${step}`);
  lines.push("");
  lines.push("## Commands");
  for (const [key, value] of Object.entries(report.commands || {})) {
    lines.push(`- ${key}: \`${value}\``);
  }
  return lines.join("\n");
}

module.exports = {
  buildLocalPostingReadiness,
  formatLocalPostingReadinessMarkdown,
  healthOk,
  hasTunnelConnection,
  publicLocalDeployment,
  resolveLocalTtsReadiness,
  truthy,
};
