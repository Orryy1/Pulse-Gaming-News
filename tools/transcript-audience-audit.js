#!/usr/bin/env node
"use strict";

const path = require("node:path");

const {
  auditGeneratedTranscripts,
  writeTranscriptAudienceAudit,
} = require("../lib/ops/transcript-audience-audit");

function parseArgs(argv = process.argv.slice(2)) {
  const args = { json: false, outputDir: path.join(process.cwd(), "output", "transcript-audience-audit") };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") args.json = true;
    else if (arg === "--output-dir") {
      args.outputDir = path.resolve(argv[++i] || args.outputDir);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const report = await auditGeneratedTranscripts({ root: process.cwd() });
  const artefacts = await writeTranscriptAudienceAudit(report, { outputDir: args.outputDir });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`[transcript-audience-audit] json=${artefacts.jsonPath}\n`);
    process.stdout.write(`[transcript-audience-audit] md=${artefacts.mdPath}\n`);
    process.stdout.write(
      `[transcript-audience-audit] pass=${report.summary.pass} rewrite_required=${report.summary.rewrite_required}\n`,
    );
  }
}

main().catch((err) => {
  process.stderr.write(`[transcript-audience-audit] FAILED: ${err.stack || err.message}\n`);
  process.exitCode = 1;
});
