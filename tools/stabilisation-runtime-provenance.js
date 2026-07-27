"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { resolveRuntimeBuildInfo } = require("../lib/runtime-build-info");
const {
  buildEffectiveConfigReport,
} = require("../lib/stabilisation/runtime-config");
const {
  createReportMetadata,
  decorateMarkdownReport,
  validateReportMetadata,
} = require("../lib/stabilisation/report-governance");

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function plusDays(isoTimestamp, days) {
  return new Date(
    Date.parse(isoTimestamp) + days * 24 * 60 * 60 * 1000,
  ).toISOString();
}

function buildRuntimeProvenanceReport({
  cwd = process.cwd(),
  env = process.env,
  generatedAt = new Date().toISOString(),
  expiresAt = plusDays(generatedAt, 7),
  sourceCommitSha,
  runtimeCommitSha,
} = {}) {
  const build = resolveRuntimeBuildInfo({ cwd, env });
  const metadata = createReportMetadata({
    generatedAt,
    sourceCommitSha: sourceCommitSha || build.commit_sha,
    runtimeCommitSha: runtimeCommitSha || build.commit_sha,
    environment: "local-proof",
    scope: "typed runtime configuration and sanitised local build identity",
    expiresAt,
    supersedes: [],
    supersededBy: [],
    authoritative: false,
  });
  const validation = validateReportMetadata(metadata);
  if (!validation.valid) {
    throw new Error(
      `Runtime provenance metadata is invalid: ${validation.errors.join("; ")}`,
    );
  }

  return {
    schema_version: "pulse-runtime-provenance-v1",
    ...metadata,
    build,
    effective_config: buildEffectiveConfigReport({
      env,
      generatedAt,
    }),
    limitations: [
      "LOCAL_PROOF evidence is not production authority",
      "No database, scheduler, OAuth, token or platform state was inspected",
    ],
  };
}

function renderMarkdown(report) {
  const invalid = report.effective_config.validation_errors;
  const body = [
    "## Verdict",
    "",
    report.effective_config.valid
      ? "The typed local configuration is structurally valid."
      : `The typed local configuration is invalid: ${invalid.join(", ")}.`,
    "",
    "> LOCAL_PROOF evidence is not production authority.",
    "",
    "## Build identity",
    "",
    `- Commit: ${report.build.commit_sha || "unavailable"}`,
    `- Commit source: ${report.build.commit_source}`,
    `- Branch: ${report.build.branch || "unavailable"}`,
    "",
    "## Evidence boundary",
    "",
    "- No database, scheduler, OAuth, token or platform state was inspected.",
    "- Secret values are represented only by presence and truncated SHA-256 hashes.",
  ].join("\n");

  return decorateMarkdownReport({
    title: "Pulse Runtime Provenance",
    metadata: report,
    body,
    at: report.generated_at,
  });
}

function writeRuntimeProvenanceReport({ outDir, report } = {}) {
  if (!outDir) throw new Error("outDir is required");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "runtime_provenance_report.json");
  const markdownPath = path.join(outDir, "runtime_provenance_report.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cwd = path.resolve(args.cwd || path.join(__dirname, ".."));
  const outDir = path.resolve(
    args["out-dir"] || path.join(cwd, "output", "stabilisation"),
  );
  const report = buildRuntimeProvenanceReport({
    cwd,
    env: process.env,
    generatedAt: args["generated-at"] || new Date().toISOString(),
    expiresAt: args["expires-at"],
    sourceCommitSha: args["source-commit-sha"],
    runtimeCommitSha: args["runtime-commit-sha"],
  });
  const written = writeRuntimeProvenanceReport({ outDir, report });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      valid: report.effective_config.valid,
      files: written,
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  buildRuntimeProvenanceReport,
  main,
  parseArgs,
  renderMarkdown,
  writeRuntimeProvenanceReport,
};
