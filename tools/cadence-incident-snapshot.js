#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  buildCadenceIncidentSnapshot,
} = require("../lib/cadence-incident-snapshot");

const ROOT = process.cwd();
const DEFAULT_OUT_DIR = path.join(ROOT, "output", "cadence-recovery");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) return fallback;
  return process.argv[index + 1];
}

async function readJsonIfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return {};
  return fs.readJson(filePath);
}

async function sha256IfExists(filePath) {
  if (!(await fs.pathExists(filePath))) return null;
  const buffer = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function readTtsHealth() {
  try {
    const response = await fetch("http://127.0.0.1:8765/health", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return {
        status: "error",
        phase: "http_error",
        ready: false,
        error_code: `http_${response.status}`,
      };
    }
    return response.json();
  } catch (error) {
    return {
      status: "error",
      phase: "unreachable",
      ready: false,
      error_code: error?.name || "tts_health_error",
    };
  }
}

async function latestPreviousSnapshot(outDir) {
  if (!(await fs.pathExists(outDir))) return null;
  const names = (await fs.readdir(outDir))
    .filter((name) => /^cadence-incident-snapshot-.*\.json$/i.test(name))
    .sort()
    .reverse();
  for (const name of names) {
    const report = await readJsonIfExists(path.join(outDir, name));
    if (report?.cadence?.latest_externally_verified_post_at) return report;
    if (report?.cadence?.latest_locally_evidenced_platform_post_at) return report;
  }
  return null;
}

function externalEvidenceFromPrevious(previous) {
  const cadence = previous?.cadence || {};
  const latest = (
    cadence.latest_externally_verified_post_at ||
    cadence.latest_locally_evidenced_platform_post_at ||
    null
  );
  return {
    inventory_checked: false,
    latest_verified_post_at: latest,
    seven_day_post_count_by_enabled_platform: null,
    limitation:
      "No current external platform inventory query was performed. The latest timestamp is carried from the last locally evidenced public-platform record and is not a fresh inventory result.",
  };
}

function markdown(report) {
  const queue = report.queue?.counts || {};
  return [
    "# Pulse Gaming Cadence Incident Snapshot",
    "",
    `- Generated: ${report.generated_at}`,
    `- Incident: ${report.severity || "none"} ${report.status}`,
    `- Current bottleneck: ${report.current_bottleneck || "none"}`,
    `- Latest externally evidenced post: ${report.cadence.latest_externally_verified_post_at || "unknown"}`,
    `- External inventory checked now: ${report.cadence.external_platform_inventory_checked ? "yes" : "no"}`,
    `- Scheduler-authoritative candidates: ${report.scheduler.authoritative_candidate_count}`,
    `- Next nominal window: ${report.scheduler.next_safe_window_at || "none"}`,
    `- Next window usable: ${report.scheduler.next_safe_window_usable ? "yes" : "no"}`,
    `- Runtime parity: ${report.runtime.commit_parity ? "GREEN" : "RED"} (${report.runtime.running_commit || "unknown"} -> ${report.runtime.expected_commit || "unknown"})`,
    `- TTS process: ${report.tts.process_ready ? "ready" : "not ready"}`,
    `- Narration voice rights: ${report.tts.voice_rights_ready ? "GREEN" : "RED"}`,
    `- Queue: pending ${queue.pending || 0}, running ${queue.running || 0}, failed ${queue.failed || 0}`,
    `- Recent candidate failures: ${report.recent_candidate_failures?.recent_count ?? "unknown"}`,
    "",
    "## Safety",
    "",
    "- Read-only evidence generation only.",
    "- No live publish, database mutation, OAuth/token change or gate weakening.",
    "",
  ].join("\n");
}

async function main() {
  const outDir = path.resolve(argValue("--out-dir", DEFAULT_OUT_DIR));
  const inputPaths = {
    cadence: path.resolve(argValue(
      "--cadence",
      path.join(ROOT, "test", "output", "publish_cadence.json"),
    )),
    candidates: path.resolve(argValue(
      "--candidates",
      path.join(ROOT, "output", "goal-contract", "next_publish_candidates.json"),
    )),
    readiness: path.resolve(argValue(
      "--readiness",
      path.join(ROOT, "output", "goal-contract", "publish_readiness_report.json"),
    )),
    runtime: path.resolve(argValue(
      "--runtime",
      path.join(ROOT, "output", "runtime-ownership", "runtime_ownership_status.json"),
    )),
    queue: path.resolve(argValue(
      "--queue",
      path.join(ROOT, "test", "output", "queue_inspect.json"),
    )),
    voiceReview: path.resolve(argValue(
      "--voice-review",
      path.join(
        ROOT,
        "output",
        "cadence-recovery",
        "generated-voice-review",
        "generated_voice_reference_review.json",
      ),
    )),
  };

  const [
    cadenceReport,
    candidateReport,
    readinessReport,
    runtimeReport,
    queueReport,
    voiceRightsReview,
    ttsHealth,
    previousSnapshot,
  ] = await Promise.all([
    readJsonIfExists(inputPaths.cadence),
    readJsonIfExists(inputPaths.candidates),
    readJsonIfExists(inputPaths.readiness),
    readJsonIfExists(inputPaths.runtime),
    readJsonIfExists(inputPaths.queue),
    readJsonIfExists(inputPaths.voiceReview),
    readTtsHealth(),
    latestPreviousSnapshot(outDir),
  ]);

  const generatedAt = new Date().toISOString();
  const report = buildCadenceIncidentSnapshot({
    generatedAt,
    cadenceReport,
    candidateReport,
    readinessReport,
    runtimeReport,
    queueReport,
    ttsHealth,
    voiceRightsReview,
    externalEvidence: externalEvidenceFromPrevious(previousSnapshot),
    recentCandidateFailures:
      readinessReport?.pillars?.recent_failed_candidates?.raw || null,
    firstFreshCandidate: {
      story_id: null,
      status: "NONE_SCHEDULER_AUTHORITATIVE",
      lane: "A",
      remaining_blocker:
        "No fresh story has complete same-run media, rights, narration and scheduler authority.",
    },
  });

  report.evidence = [];
  for (const [kind, filePath] of Object.entries(inputPaths)) {
    const sha256 = await sha256IfExists(filePath);
    report.evidence.push({
      kind,
      path: path.relative(ROOT, filePath).replace(/\\/g, "/"),
      present: Boolean(sha256),
      sha256,
    });
  }

  const stamp = generatedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const jsonPath = path.join(outDir, `cadence-incident-snapshot-${stamp}.json`);
  const mdPath = path.join(outDir, `cadence-incident-snapshot-${stamp}.md`);
  const currentJsonPath = path.join(outDir, "cadence-incident-snapshot-current.json");
  const currentMdPath = path.join(outDir, "cadence-incident-snapshot-current.md");
  await fs.ensureDir(outDir);
  await Promise.all([
    fs.writeJson(jsonPath, report, { spaces: 2 }),
    fs.writeFile(mdPath, markdown(report), "utf8"),
    fs.writeJson(currentJsonPath, report, { spaces: 2 }),
    fs.writeFile(currentMdPath, markdown(report), "utf8"),
  ]);

  process.stdout.write(`${JSON.stringify({
    status: report.status,
    severity: report.severity,
    current_bottleneck: report.current_bottleneck,
    latest_externally_verified_post_at:
      report.cadence.latest_externally_verified_post_at,
    authoritative_candidate_count:
      report.scheduler.authoritative_candidate_count,
    runtime_commit_parity: report.runtime.commit_parity,
    tts_process_ready: report.tts.process_ready,
    voice_rights_ready: report.tts.voice_rights_ready,
    queue_counts: report.queue.counts,
    json_path: jsonPath,
    markdown_path: mdPath,
  }, null, 2)}\n`);
  process.exitCode = report.status === "GREEN" ? 0 : 2;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  externalEvidenceFromPrevious,
  main,
};
