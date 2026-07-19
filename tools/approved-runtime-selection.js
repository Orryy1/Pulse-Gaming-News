#!/usr/bin/env node
"use strict";

const {
  resolveApprovedRuntimeSelection,
} = require("../lib/ops/approved-runtime-selection");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--supervisor-root") {
      options.supervisorRoot = argv[++index];
    } else if (token === "--default-evidence-root") {
      options.defaultEvidenceRoot = argv[++index];
    } else if (token === "--git-executable") {
      options.gitExecutable = argv[++index];
    } else if (token === "--json") {
      options.json = true;
    } else {
      throw new Error(`unknown_argument:${token}`);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const result = resolveApprovedRuntimeSelection(options);
  process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  main,
  parseArgs,
};
