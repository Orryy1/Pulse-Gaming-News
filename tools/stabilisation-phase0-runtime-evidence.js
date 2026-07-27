#!/usr/bin/env node
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const dotenv = require("dotenv");

const {
  buildDatabaseIntegrityReport,
  buildSchedulerOwnershipReport,
} = require("../lib/stabilisation/phase0-runtime-evidence");
const {
  createReportMetadata,
  decorateMarkdownReport,
} = require("../lib/stabilisation/report-governance");
const {
  buildEffectiveConfigReport,
  loadDotenvOnce,
} = require("../lib/stabilisation/runtime-config");
const { DEFAULT_SCHEDULES } = require("../lib/scheduler");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs", "stabilisation");

function gitHead() {
  return childProcess
    .execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      windowsHide: true,
    })
    .trim();
}

function runtimeCommitSha() {
  const filename = path.join(DOCS, "runtime_provenance_report.json");
  if (!fs.existsSync(filename)) return gitHead();
  const report = JSON.parse(fs.readFileSync(filename, "utf8"));
  return (
    report?.metadata?.runtime_commit_sha ||
    report?.observed_runtime_commit_sha ||
    gitHead()
  );
}

function metadata({ generatedAt, sourceSha, runtimeSha, environment, scope }) {
  return createReportMetadata({
    generatedAt,
    sourceCommitSha: sourceSha,
    runtimeCommitSha: runtimeSha,
    environment,
    scope,
    expiresAt: new Date(generatedAt.getTime() + 24 * 60 * 60 * 1000),
    authoritative: false,
  });
}

function writeJson(filename, value) {
  fs.writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function asList(values) {
  return values?.length ? values.map((value) => `- ${value}`).join("\n") : "- None";
}

function databaseMarkdown(report) {
  const conflictLines = Object.entries(report.conflicts)
    .map(([key, value]) => `| ${key} | ${value ?? "not measurable"} |`)
    .join("\n");
  return decorateMarkdownReport({
    title: "Phase 0 database state integrity report",
    metadata: report.metadata,
    body: [
      `**Verdict:** ${report.verdict}`,
      "",
      "This is a read-only observation of the local database. It is not production authority and performed no migrations or repairs.",
      "",
      `- SQLite quick check: ${report.integrity.quick_check}`,
      `- SQLite integrity check: ${report.integrity.integrity_check}`,
      `- Database fingerprint: ${report.database.sha256 || "unavailable"}`,
      "",
      "## Missing governance schema",
      "",
      asList(report.schema.missing_governance_tables),
      "",
      "## Publication conflicts",
      "",
      "| Check | Count |",
      "| --- | ---: |",
      conflictLines,
      "",
      "## Release blockers",
      "",
      asList(report.blockers),
    ].join("\n"),
  });
}

function schedulerMarkdown(report) {
  return decorateMarkdownReport({
    title: "Phase 0 scheduler ownership report",
    metadata: report.metadata,
    body: [
      `**Verdict:** ${report.verdict}`,
      "",
      "The code now requires a renewable durable scheduler lease before cron registration. This report only proves the owner observed in the selected local database, not the production owner.",
      "",
      `- Enabled schedules observed: ${report.configured.enabled_count}`,
      `- Active stabilisation schedules: ${report.active_profile.schedule_count}`,
      `- Suppressed enabled schedules: ${report.active_profile.suppressed_enabled_count}`,
      `- Publish windows (UTC): ${report.profile.publish_hours_utc.join(", ") || "none"}`,
      `- Minimum publish gap: ${report.profile.minimum_observed_gap_minutes} minutes`,
      `- Code-default profile valid: ${report.code_default_profile.valid}`,
      `- Code-default publish windows (UTC): ${report.code_default_profile.publish_hours_utc.join(", ") || "none"}`,
      `- Static lease guard present: ${report.static_lease_guard_present}`,
      `- Live local lease observed: ${report.lease.live}`,
      `- Production single owner proved: ${report.production_single_owner_proved}`,
      "",
      "## Release blockers",
      "",
      asList(report.blockers),
    ].join("\n"),
  });
}

function configMarkdown(report) {
  const rows = report.entries
    .map(
      (entry) =>
        `| ${entry.key} | ${entry.present} | ${entry.source_class} | ${entry.secret} | ${entry.secret ? "redacted" : entry.value ?? "unset"} | ${entry.validation.join(", ")} |`,
    )
    .join("\n");
  return decorateMarkdownReport({
    title: "Effective runtime configuration report",
    metadata: report.metadata,
    body: [
      `**Typed configuration valid:** ${report.valid}`,
      "",
      "Secret values are never emitted. Presence and a one-way value fingerprint are retained in the JSON evidence for change detection.",
      "",
      "| Key | Present | Source class | Secret | Effective value | Validation |",
      "| --- | --- | --- | --- | --- | --- |",
      rows,
    ].join("\n"),
  });
}

function updatePhase0Index({ generatedAt, sourceSha, runtimeSha }) {
  const jsonPath = path.join(DOCS, "phase0_evidence_index.json");
  if (!fs.existsSync(jsonPath)) return;
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  report.metadata = metadata({
    generatedAt,
    sourceSha,
    runtimeSha,
    environment: "phase0-local-coordination",
    scope: "Completeness and ownership index for the ten required Phase 0 evidence artefacts",
  });
  const paths = {
    database_state_integrity_report: [
      "docs/stabilisation/database_state_integrity_report.json",
      "docs/stabilisation/database_state_integrity_report.md",
    ],
    scheduler_ownership_report: [
      "docs/stabilisation/scheduler_ownership_report.json",
      "docs/stabilisation/scheduler_ownership_report.md",
    ],
  };
  for (const artefact of report.artefacts || []) {
    if (!paths[artefact.id]) continue;
    artefact.status = "present";
    artefact.owner = "runtime stabilisation lane";
    [artefact.json_path, artefact.markdown_path] = paths[artefact.id];
    delete artefact.blocker;
  }
  const allPresent = (report.artefacts || []).every(
    (artefact) => artefact.status === "present",
  );
  report.overall_status = allPresent
    ? "EVIDENCE_SET_PRESENT_NON_AUTHORITATIVE"
    : "PARTIAL";
  report.completion_rule =
    "The evidence set is structurally present. Release status remains blocked until reports are valid, current, production-authoritative and generated from a clean committed source state.";
  writeJson(jsonPath, report);

  const rows = (report.artefacts || [])
    .map(
      (artefact) =>
        `| ${artefact.id} | ${artefact.status} | ${artefact.owner} | ${artefact.json_path || "not generated"} |`,
    )
    .join("\n");
  fs.writeFileSync(
    path.join(DOCS, "phase0_evidence_index.md"),
    decorateMarkdownReport({
      title: "Phase 0 evidence index",
      metadata: report.metadata,
      body: [
        `**Overall status:** ${report.overall_status}`,
        "",
        "All required report files now exist, but this is not a release-ready verdict. Local-only, stale, divergent or non-authoritative evidence remains a blocker.",
        "",
        "| Artefact | Status | Owner | JSON evidence |",
        "| --- | --- | --- | --- |",
        rows,
        "",
        `**Completion rule:** ${report.completion_rule}`,
      ].join("\n"),
    }),
    "utf8",
  );
}

function main() {
  const generatedAt = new Date();
  const sourceSha = gitHead();
  const runtimeSha = runtimeCommitSha();
  const dbPath = path.resolve(
    process.env.SQLITE_DB_PATH || path.join(ROOT, "data", "pulse.db"),
  );
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");

  const dbReport = buildDatabaseIntegrityReport({
    db,
    dbPath,
    metadata: metadata({
      generatedAt,
      sourceSha,
      runtimeSha,
      environment: "local-workspace-read-only-database",
      scope: "Local SQLite integrity, schema and publication-state reconciliation; excludes production",
    }),
  });
  const schedulerSource = fs.readFileSync(
    path.join(ROOT, "lib", "scheduler.js"),
    "utf8",
  );
  const schedulerReport = buildSchedulerOwnershipReport({
    db,
    metadata: metadata({
      generatedAt,
      sourceSha,
      runtimeSha,
      environment: "local-workspace-read-only-database",
      scope: "Local scheduler rows, profile and durable lease observation; excludes production process authority",
    }),
    now: generatedAt,
    staticLeaseGuardPresent:
      schedulerSource.includes("acquireSchedulerLease") &&
      schedulerSource.includes("heartbeatSchedulerLease") &&
      schedulerSource.includes("scheduler_lease_unavailable"),
    codeSchedules: DEFAULT_SCHEDULES,
  });
  db.close();

  const inheritedKeys = new Set(Object.keys(process.env));
  loadDotenvOnce({ dotenv });
  const sourceClasses = Object.fromEntries(
    Object.keys(process.env).map((key) => [
      key,
      inheritedKeys.has(key) ? "process_environment" : "dotenv_file",
    ]),
  );
  const configReport = {
    ...buildEffectiveConfigReport({ env: process.env, sourceClasses }),
    metadata: metadata({
      generatedAt,
      sourceSha,
      runtimeSha,
      environment: "local-workspace-effective-config",
      scope: "Typed operational configuration with secret values redacted; excludes production",
    }),
  };

  writeJson(path.join(DOCS, "database_state_integrity_report.json"), dbReport);
  fs.writeFileSync(
    path.join(DOCS, "database_state_integrity_report.md"),
    databaseMarkdown(dbReport),
    "utf8",
  );
  writeJson(path.join(DOCS, "scheduler_ownership_report.json"), schedulerReport);
  fs.writeFileSync(
    path.join(DOCS, "scheduler_ownership_report.md"),
    schedulerMarkdown(schedulerReport),
    "utf8",
  );
  writeJson(path.join(DOCS, "effective_config_report.json"), configReport);
  fs.writeFileSync(
    path.join(DOCS, "effective_config_report.md"),
    configMarkdown(configReport),
    "utf8",
  );
  updatePhase0Index({ generatedAt, sourceSha, runtimeSha });

  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      database_verdict: dbReport.verdict,
      scheduler_verdict: schedulerReport.verdict,
      effective_config_valid: configReport.valid,
      mutations_performed: [],
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error.message })}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = { main };
