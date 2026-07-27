#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  renderAuditMarkdown,
  runReadOnlyAudit,
} = require("../lib/ops/youtube-analytics-cutover-audit");

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--db", "--out", "--channel-id", "--now"].includes(argument)) {
      throw new Error(`youtube_analytics_audit_argument_unknown:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(
        `youtube_analytics_audit_argument_value_required:${argument}`,
      );
    }
    parsed[argument.slice(2)] = value;
    index += 1;
  }
  if (!parsed.db) throw new Error("youtube_analytics_audit_db_path_required");
  if (!parsed.out) {
    throw new Error("youtube_analytics_audit_output_path_required");
  }
  return parsed;
}

function writeEvidence(outDir, report) {
  const resolvedOut = path.resolve(outDir);
  fs.mkdirSync(resolvedOut, { recursive: true });
  const jsonPath = path.join(
    resolvedOut,
    "youtube-analytics-cutover-audit.json",
  );
  const markdownPath = path.join(
    resolvedOut,
    "youtube-analytics-cutover-audit.md",
  );
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownPath, renderAuditMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArguments(argv);
  const report = runReadOnlyAudit({
    databasePath: args.db,
    channelId: args["channel-id"] || null,
    generatedAt: args.now || new Date().toISOString(),
  });
  const files = writeEvidence(args.out, report);
  process.stdout.write(
    `${JSON.stringify({
      verdict: report.verdict,
      mapped_videos: report.video_mappings.length,
      analytics_scope: report.scope_diagnosis.analytics_readonly,
      json: files.jsonPath,
      markdown: files.markdownPath,
    })}\n`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        error: String(error?.message || error),
        safety: {
          external_api_calls: 0,
          oauth_mutated: false,
          database_mutated: false,
          token_values_emitted: false,
        },
      })}\n`,
    );
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArguments,
  writeEvidence,
};
