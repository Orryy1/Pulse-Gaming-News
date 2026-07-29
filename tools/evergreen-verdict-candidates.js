#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const {
  buildEvergreenVerdictCandidateReport,
  renderEvergreenVerdictCandidateReportMarkdown,
} = require("../lib/services/evergreen-verdict-candidate-builder");

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected_argument:${argument}`);
    }
    const name = argument.slice(2);
    if (!["input", "out-dir", "now"].includes(name)) {
      throw new Error(`unknown_argument:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`argument_value_required:${argument}`);
    }
    values[name] = value;
    index += 1;
  }
  if (!values.input) throw new Error("input_path_required");
  if (!values["out-dir"]) throw new Error("output_directory_required");
  return values;
}

async function readInput(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("evergreen_candidate_input_must_be_an_object");
  }
  return parsed;
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inputPath = path.resolve(args.input);
  const outDir = path.resolve(args["out-dir"]);
  const input = await readInput(inputPath);
  const report = buildEvergreenVerdictCandidateReport({
    ...input,
    now: args.now || input.now || new Date().toISOString(),
  });
  const markdown = renderEvergreenVerdictCandidateReportMarkdown(report);
  const jsonPath = path.join(outDir, "evergreen_candidate_report.json");
  const markdownPath = path.join(
    outDir,
    "evergreen_candidate_report.md",
  );
  await fs.mkdir(outDir, { recursive: true });
  await Promise.all([
    fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
    fs.writeFile(markdownPath, markdown, "utf8"),
  ]);
  return {
    mode: "LOCAL_PROOF",
    json_path: jsonPath,
    markdown_path: markdownPath,
    selected_candidate_count: report.rotation.selected.length,
    no_publish_triggered: true,
  };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(
        `[evergreen-verdict-candidates] ${error.message}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  run,
};
