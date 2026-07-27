#!/usr/bin/env node
"use strict";

const path = require("node:path");
const {
  COMMANDS,
  buildOperatorCommandReport,
  renderOperatorCommandMarkdown,
  writeOperatorCommandReport,
} = require("../lib/ops/operator-command-contract");

const ROOT = path.resolve(__dirname, "..");
const SUPPORTED_COMMANDS = new Set(Object.keys(COMMANDS));
const FORBIDDEN_FLAGS = new Set([
  "--apply",
  "--publish",
  "--live",
  "--oauth",
  "--token",
  "--auto-publish",
]);

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    command: argv[0] || "",
    stateRoot: ROOT,
    outDir: path.join(ROOT, "output", "goal-contract"),
    generatedAt: new Date().toISOString(),
    json: false,
    help: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--state-root" || argument === "--workspace") {
      args.stateRoot = argv[++index] || args.stateRoot;
    } else if (argument === "--out-dir" || argument === "--output-dir") {
      args.outDir = argv[++index] || args.outDir;
    } else if (argument === "--generated-at") {
      args.generatedAt = argv[++index] || args.generatedAt;
    } else if (argument === "--json") {
      args.json = true;
    } else if (argument === "--help" || argument === "-h" || argument === "-?") {
      args.help = true;
    } else if (FORBIDDEN_FLAGS.has(argument)) {
      throw new Error(`${argument} is forbidden in LOCAL_PROOF mode`);
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return args;
}

function usage() {
  return [
    "Usage: node tools/operator-command-contract.js <command> [options]",
    "",
    "Options:",
    "  --state-root <dir>   Root containing local proof inputs",
    "  --out-dir <dir>      Directory for JSON and Markdown evidence",
    "  --generated-at <iso> Fixed evidence timestamp",
    "  --json               Print JSON instead of Markdown",
    "",
    "This reviewed release bridge is inspection-only. It never publishes,",
    "mutates a production database, changes OAuth or claims materialisation.",
  ].join("\n");
}

function main(argv = process.argv.slice(2), deps = {}) {
  const args = parseArgs(argv);
  const stdout = deps.stdout || process.stdout;
  if (args.help) {
    stdout.write(`${usage()}\n`);
    return { args, help: true };
  }
  if (!SUPPORTED_COMMANDS.has(args.command)) {
    throw new Error(
      `Unsupported operator command: ${args.command || "(missing)"}`,
    );
  }
  const report = buildOperatorCommandReport({
    command: args.command,
    stateRoot: path.resolve(args.stateRoot),
    generatedAt: args.generatedAt,
  });
  const written = writeOperatorCommandReport(report, {
    outDir: path.resolve(args.outDir),
  });
  stdout.write(
    args.json
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderOperatorCommandMarkdown(report),
  );
  return { args, report, written };
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[operator-command-contract] ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  SUPPORTED_COMMANDS,
  FORBIDDEN_FLAGS,
  main,
  parseArgs,
  usage,
};
