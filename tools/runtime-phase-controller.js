#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const Database = require("better-sqlite3");
const killSwitchRepository = require("../lib/repositories/kill_switch");
const {
  authorityPaths,
  canonical,
  loadVerifiedAuthority,
  sha256,
} = require("../lib/runtime/standing-authority");

function required(value, code) {
  const result = String(value || "").trim();
  if (!result) throw new Error(code);
  return result;
}

function loadEnv(filePath) {
  const resolved = path.resolve(required(filePath, "runtime_env_file_required"));
  const bytes = fs.readFileSync(resolved);
  const parsed = dotenv.parse(bytes);
  for (const [key, value] of Object.entries(parsed)) process.env[key] = value;
  return { resolved, bytes };
}

function atomicWrite(filePath, body, { noOverwrite = false } = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (noOverwrite && fs.existsSync(filePath)) return false;
  const staging = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(staging, body, { flag: "wx" });
  if (noOverwrite && fs.existsSync(filePath)) {
    fs.rmSync(staging, { force: true });
    return false;
  }
  fs.renameSync(staging, filePath);
  return true;
}

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return fallback; }
}

function listJson(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readJson(path.join(directory, name)))
    .filter(Boolean);
}

function utcDay(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function dayDistance(startDay, endDay) {
  const a = new Date(`${startDay}T00:00:00.000Z`).getTime();
  const b = new Date(`${endDay}T00:00:00.000Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}


function daySequence(startDay, endDay) {
  const result = [];
  let cursor = new Date(`${startDay}T00:00:00.000Z`);
  const end = new Date(`${endDay}T00:00:00.000Z`);
  while (cursor.getTime() <= end.getTime()) {
    result.push(utcDay(cursor));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return result;
}

function completedShadowDays({ observations, shadowStartedAt, now = new Date(), minimumHourlyObservations = 20 }) {
  const start = new Date(shadowStartedAt);
  const current = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(start.getTime()) || Number.isNaN(current.getTime())) throw new Error("shadow_day_clock_invalid");
  const firstFullDay = utcDay(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1)));
  const yesterday = utcDay(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate() - 1)));
  if (new Date(`${firstFullDay}T00:00:00Z`).getTime() > new Date(`${yesterday}T00:00:00Z`).getTime()) {
    return { completeDays: 0, missingDays: [], hoursByDay: {} };
  }
  const grouped = new Map();
  for (const observation of observations) {
    const generatedAt = new Date(observation.generated_at);
    if (Number.isNaN(generatedAt.getTime())) continue;
    const day = utcDay(generatedAt);
    const hour = generatedAt.getUTCHours();
    if (!grouped.has(day)) grouped.set(day, { hours: new Set(), red: false });
    const group = grouped.get(day);
    group.hours.add(hour);
    if (observation.verdict === "RED" || Number(observation.safety?.youtube_mutation_count || 0) > 0) group.red = true;
  }
  const hoursByDay = {};
  const missingDays = [];
  let completeDays = 0;
  for (const day of daySequence(firstFullDay, yesterday)) {
    const group = grouped.get(day);
    hoursByDay[day] = group?.hours.size || 0;
    if (!group || group.red || group.hours.size < minimumHourlyObservations) {
      missingDays.push(day);
      continue;
    }
    completeDays += 1;
  }
  return { completeDays, missingDays, hoursByDay };
}

function countConsecutiveGreen(observations) {
  let count = 0;
  for (let index = observations.length - 1; index >= 0; index -= 1) {
    if (observations[index].verdict !== "GREEN") break;
    count += 1;
  }
  return count;
}

function acceptanceMetrics({ authority, phase, candidateIndex, candidateObservations, shadowObservations, publisherReceipts, now = new Date() }) {
  const policy = authority.document.policy;
  const currentDay = utcDay(now);
  const startDay = utcDay(phase.shadow_started_at || phase.entered_at);
  const calendarDaysElapsed = Math.max(0, dayDistance(startDay, currentDay));
  const completeness = completedShadowDays({
    observations: shadowObservations,
    shadowStartedAt: phase.shadow_started_at || phase.entered_at,
    now,
  });
  const completeDays = completeness.completeDays;
  const distinctRuns = new Set(candidateObservations.map((entry) => entry.video_sha256 || entry.story_id)).size;
  const ordered = [...candidateObservations].sort((a, b) => String(a.observed_at).localeCompare(String(b.observed_at)) || String(a.envelope_sha256).localeCompare(String(b.envelope_sha256)));
  const consecutiveGreen = countConsecutiveGreen(ordered);
  const latestByVideo = new Map();
  let falseGreen = 0;
  for (const entry of ordered) {
    const key = entry.video_sha256 || entry.story_id;
    const prior = latestByVideo.get(key);
    if (prior?.verdict === "GREEN" && entry.verdict !== "GREEN") falseGreen += 1;
    latestByVideo.set(key, entry);
  }
  const externalMutations = shadowObservations.reduce((sum, entry) => sum + Number(entry.safety?.youtube_mutation_count || 0), 0);
  const canaries = publisherReceipts.filter((entry) => entry.action === "PRIVATE_CANARY_UPLOAD" && entry.verdict === "GREEN" && entry.remote_verified === true);
  const publicReceipts = publisherReceipts.filter((entry) => entry.action === "PUBLIC_CONFIRMED" && entry.verdict === "GREEN" && entry.remote_verified === true);
  const incidents = publisherReceipts.filter((entry) => ["RED", "AMBIGUOUS"].includes(entry.verdict));
  const cleanPublicDays = new Set(publicReceipts.map((entry) => utcDay(entry.confirmed_at || entry.generated_at))).size;
  const shadowPolicy = policy.shadow;
  const shadowGreen =
    completeDays >= shadowPolicy.minimum_complete_utc_days &&
    completeDays <= shadowPolicy.maximum_complete_utc_days &&
    distinctRuns >= shadowPolicy.minimum_distinct_runs &&
    consecutiveGreen >= shadowPolicy.minimum_consecutive_green &&
    falseGreen <= shadowPolicy.maximum_false_green &&
    externalMutations <= shadowPolicy.maximum_external_mutations;
  return {
    current_day_utc: currentDay,
    shadow_complete_days: completeDays,
    shadow_calendar_days_elapsed: calendarDaysElapsed,
    shadow_missing_days: completeness.missingDays,
    shadow_hours_by_day: completeness.hoursByDay,
    distinct_candidate_runs: distinctRuns,
    consecutive_green: consecutiveGreen,
    false_green_count: falseGreen,
    shadow_external_mutation_count: externalMutations,
    private_canary_verified_count: canaries.length,
    public_verified_count: publicReceipts.length,
    clean_public_policy_days: cleanPublicDays,
    incident_count: incidents.length,
    available_green_candidates: (candidateIndex?.candidates || []).filter((entry) => entry.verdict === "GREEN").length,
    shadow_acceptance_green: shadowGreen,
  };
}

function transitionPhase({ paths, phase, nextPhase, reason, authorityEnvelope, externalMutationsEnabled, killSwitchVersion }) {
  const next = {
    schema_version: "pulse-green-autopilot-phase-v1",
    authority_id: authorityEnvelope.document.authority_id,
    authority_version: authorityEnvelope.document.version,
    authority_sha256: authorityEnvelope.document_sha256,
    phase: nextPhase,
    phase_version: Number(phase.phase_version || 0) + 1,
    entered_at: new Date().toISOString(),
    shadow_started_at: phase.shadow_started_at || phase.entered_at,
    reason,
    external_mutations_enabled: externalMutationsEnabled === true,
    kill_switch_version: Number(killSwitchVersion),
    prior_event_sha256: phase.sha256 || null,
  };
  const hash = sha256(Buffer.from(canonical(next)));
  const sealed = { ...next, sha256: hash };
  fs.mkdirSync(paths.phaseEvents, { recursive: true });
  atomicWrite(path.join(paths.phaseEvents, `${String(next.phase_version).padStart(6, "0")}-${hash}.json`), `${JSON.stringify(sealed, null, 2)}\n`, { noOverwrite: true });
  atomicWrite(paths.phase, `${JSON.stringify(sealed, null, 2)}\n`);
  return sealed;
}

function main(argv = process.argv.slice(2)) {
  const env = loadEnv(argv[0] || process.env.PULSE_RUNTIME_ENV_FILE);
  if (process.env.PULSE_SHADOW_MODE !== "true") throw new Error("phase_controller_shadow_runtime_required");
  const controlRoot = path.resolve(required(process.env.PULSE_CONTROL_ROOT, "control_root_required"));
  const evidenceRoot = path.resolve(required(process.env.PULSE_EVIDENCE_ROOT, "evidence_root_required"));
  const runtimeCommit = required(process.env.PULSE_RUNTIME_COMMIT, "runtime_commit_required");
  const configurationSha256 = sha256(env.bytes);
  const authority = loadVerifiedAuthority({ controlRoot, runtimeCommit, configurationSha256 });
  const paths = authorityPaths(controlRoot);
  const database = new Database(path.resolve(required(process.env.SQLITE_DB_PATH, "phase_database_path_required")));
  const switchRepo = killSwitchRepository.bind(database);
  let switchRow = switchRepo.get("external_mutations");
  if (!switchRow) { database.close(); throw new Error("phase_kill_switch_missing"); }
  let phase = readJson(paths.phase);
  if (!phase) { database.close(); throw new Error("authority_phase_missing"); }
  if (phase.authority_sha256 !== authority.document_sha256) { database.close(); throw new Error("phase_authority_hash_mismatch"); }
  if (Number(phase.kill_switch_version) !== Number(switchRow.version)) { database.close(); throw new Error("phase_kill_switch_version_mismatch"); }
  if (phase.external_mutations_enabled === true && switchRow.state !== "CLEAR") { database.close(); throw new Error("phase_kill_switch_not_clear"); }
  if (phase.external_mutations_enabled !== true && switchRow.state !== "ENGAGED") { database.close(); throw new Error("phase_kill_switch_not_engaged"); }
  const acceptanceRoot = path.join(evidenceRoot, "acceptance");
  const candidateIndex = readJson(path.join(evidenceRoot, "candidates", "current-index.json"), { candidates: [] });
  const candidateObsDir = path.join(acceptanceRoot, "candidate-observations");
  for (const candidate of candidateIndex.candidates || []) {
    if (!candidate.envelope_sha256) continue;
    const observation = {
      schema_version: "pulse-green-autopilot-candidate-observation-v1",
      observed_at: new Date().toISOString(),
      story_id: candidate.story_id,
      video_sha256: candidate.video_sha256,
      envelope_sha256: candidate.envelope_sha256,
      verdict: candidate.verdict,
      envelope_path: candidate.path,
      external_mutation_count: 0,
    };
    atomicWrite(path.join(candidateObsDir, `${candidate.envelope_sha256}.json`), `${JSON.stringify(observation, null, 2)}\n`, { noOverwrite: true });
  }
  const shadowCurrent = readJson(path.join(evidenceRoot, "runtime", "shadow-observation-current.json"));
  if (shadowCurrent) {
    const observedAt = shadowCurrent.generated_at || new Date().toISOString();
    const observationHash = sha256(Buffer.from(canonical(shadowCurrent)));
    const hourKey = observedAt.slice(0, 13).replace(/[:.]/g, "-");
    const fileName = shadowCurrent.verdict === "RED"
      ? `${hourKey}-RED-${observationHash}.json`
      : `${hourKey}.json`;
    atomicWrite(path.join(acceptanceRoot, "shadow-observations", fileName), `${JSON.stringify({ ...shadowCurrent, observation_sha256: observationHash }, null, 2)}\n`, { noOverwrite: true });
  }
  const candidateObservations = listJson(candidateObsDir);
  const shadowObservations = listJson(path.join(acceptanceRoot, "shadow-observations"));
  const publisherReceipts = listJson(path.join(evidenceRoot, "publisher", "receipts"));
  const metrics = acceptanceMetrics({ authority, phase, candidateIndex, candidateObservations, shadowObservations, publisherReceipts });
  const blockers = [];
  if (metrics.incident_count > 0 && phase.phase !== "SUSPENDED") {
    if (switchRow.state !== "ENGAGED") {
      const changed = switchRepo.engage({ name: "external_mutations", actorId: "phase-controller", reason: "PUBLISHER_INCIDENT", expectedVersion: switchRow.version, now: new Date() });
      switchRow = changed.row;
    }
    phase = transitionPhase({ paths, phase, nextPhase: "SUSPENDED", reason: "PUBLISHER_INCIDENT_REQUIRES_REQUALIFICATION", authorityEnvelope: authority, externalMutationsEnabled: false, killSwitchVersion: switchRow.version });
    const killPath = path.join(controlRoot, "emergency-kill.json");
    atomicWrite(killPath, `${JSON.stringify({ state: "ENGAGED", created_at: new Date().toISOString(), reason: "PUBLISHER_INCIDENT" }, null, 2)}\n`);
  } else if (phase.phase === "SHADOW" && metrics.shadow_acceptance_green) {
    const cleared = switchRepo.clear({ name: "external_mutations", actorId: "phase-controller", reason: "STANDING_AUTHORITY_SHADOW_THRESHOLDS_GREEN", expectedVersion: switchRow.version, authorityDecisionId: `standing:${authority.document_sha256}:private-canary`, now: new Date() });
    switchRow = cleared.row;
    phase = transitionPhase({ paths, phase, nextPhase: "PRIVATE_CANARY", reason: "AUTOMATIC_STANDING_AUTHORITY_SHADOW_THRESHOLDS_GREEN", authorityEnvelope: authority, externalMutationsEnabled: true, killSwitchVersion: switchRow.version });
  } else if (phase.phase === "PRIVATE_CANARY" && metrics.private_canary_verified_count >= authority.document.policy.private_canary.required_verified_uploads) {
    phase = transitionPhase({ paths, phase, nextPhase: "PUBLIC_RAMP_ONE_DAILY", reason: "AUTOMATIC_STANDING_AUTHORITY_PRIVATE_CANARIES_GREEN", authorityEnvelope: authority, externalMutationsEnabled: true, killSwitchVersion: switchRow.version });
  } else if (phase.phase === "PUBLIC_RAMP_ONE_DAILY" && metrics.clean_public_policy_days >= authority.document.policy.public_ramp_two_daily.promotion_after_clean_days) {
    phase = transitionPhase({ paths, phase, nextPhase: "PUBLIC_RAMP_TWO_DAILY", reason: "AUTOMATIC_STANDING_AUTHORITY_THIRTY_CLEAN_DAYS", authorityEnvelope: authority, externalMutationsEnabled: true, killSwitchVersion: switchRow.version });
  }
  if (phase.phase === "SHADOW" && !metrics.shadow_acceptance_green) blockers.push("shadow_thresholds_pending");
  if (phase.phase === "SHADOW" && metrics.shadow_calendar_days_elapsed >= authority.document.policy.shadow.maximum_complete_utc_days && !metrics.shadow_acceptance_green) blockers.push("shadow_maximum_duration_reached");
  if (phase.phase === "PRIVATE_CANARY" && metrics.private_canary_verified_count < authority.document.policy.private_canary.required_verified_uploads) blockers.push("private_canaries_pending");
  const report = {
    schema_version: "pulse-green-autopilot-phase-controller-report-v1",
    generated_at: new Date().toISOString(),
    verdict: phase.phase === "SUSPENDED" ? "RED" : "GREEN",
    phase,
    metrics,
    blockers,
    standing_authority_sha256: authority.document_sha256,
    local_ai_policy_mutation_allowed: false,
  };
  atomicWrite(path.join(acceptanceRoot, "current-phase-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  database.close();
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (report.verdict === "RED") process.exitCode = 2;
  return report;
}

if (require.main === module) {
  try { main(); } catch (error) {
    process.stderr.write(`${JSON.stringify({ verdict: "RED", error: String(error?.message || error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { acceptanceMetrics, atomicWrite, completedShadowDays, countConsecutiveGreen, dayDistance, daySequence, listJson, main, transitionPhase, utcDay };
