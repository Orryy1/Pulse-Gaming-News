"use strict";

const path = require("node:path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(
  ROOT,
  "output",
  "ops",
  "publication_reconciliation.json",
);

function parseArgs(argv) {
  const parsed = {
    applyRequested: false,
    candidateId: null,
    confirmationId: null,
    outputPath: DEFAULT_OUTPUT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      parsed.applyRequested = true;
    } else if (arg === "--candidate-id") {
      parsed.candidateId = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--candidate-id=")) {
      parsed.candidateId = arg.slice("--candidate-id=".length);
    } else if (arg === "--confirm-platform-post-id") {
      parsed.confirmationId = argv[index + 1];
      index += 1;
    } else if (arg.startsWith("--confirm-platform-post-id=")) {
      parsed.confirmationId = arg.slice(
        "--confirm-platform-post-id=".length,
      );
    } else if (arg === "--output") {
      parsed.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg.startsWith("--output=")) {
      parsed.outputPath = path.resolve(arg.slice("--output=".length));
    } else {
      throw new Error(`unknown_argument:${arg}`);
    }
  }
  return parsed;
}

async function main(argv = process.argv.slice(2), env = process.env) {
  dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });
  if (String(env.USE_SQLITE || "").toLowerCase() !== "true") {
    throw new Error("publication_reconciliation_requires_sqlite");
  }
  const args = parseArgs(argv);
  const {
    executePublicationReconciliationCommand,
    openReadOnlyReconciliationRepos,
  } = require("../lib/ops/publication-reconciliation-command");
  const {
    createYoutubePublicObjectVerifier,
  } = require("../lib/services/youtube-public-object-verifier");
  let verifier = null;
  const verifyPlatformObject = async (candidate) => {
    verifier ||= createYoutubePublicObjectVerifier({
      apiKey: env.YOUTUBE_API_KEY,
    });
    return verifier(candidate);
  };
  let close = () => {};
  let repos;
  if (args.applyRequested) {
    const dbModule = require("../lib/db");
    repos = require("../lib/repositories").getRepos();
    close = () => dbModule.close();
  } else {
    const configuredPath = String(env.SQLITE_DB_PATH || "").trim();
    const dbPath = configuredPath
      ? path.resolve(configuredPath)
      : path.join(ROOT, "data", "pulse.db");
    const opened = openReadOnlyReconciliationRepos(dbPath);
    repos = opened.repos;
    close = opened.close;
  }
  try {
    const report = await executePublicationReconciliationCommand({
      repos,
      candidateId: args.candidateId,
      applyRequested: args.applyRequested,
      confirmationId: args.confirmationId,
      env,
      verifyPlatformObject,
    });
    await fs.ensureDir(path.dirname(args.outputPath));
    await fs.writeJson(args.outputPath, report, { spaces: 2 });
    console.log(
      `[publication-reconciliation] mode=${report.mode} candidates=${report.candidate_count}`,
    );
    console.log(
      `[publication-reconciliation] output=${path.relative(ROOT, args.outputPath)}`,
    );
    if (report.command_blockers?.length) {
      console.log(
        `[publication-reconciliation] blockers=${report.command_blockers.join(",")}`,
      );
    }
    return report;
  } finally {
    close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`[publication-reconciliation] failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { DEFAULT_OUTPUT, main, parseArgs };
