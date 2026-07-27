#!/usr/bin/env node
"use strict";

require("dotenv").config({ quiet: true });

const fs = require("node:fs");
const path = require("node:path");

const {
  executeGuardedYoutubeWindow,
  renderGuardedYoutubeWindowMarkdown,
} = require("../lib/ops/guarded-youtube-window");

const BOOLEAN_FLAGS = new Map([
  ["confirm-supervisor-stopped", "confirmSupervisorStopped"],
  ["confirm-workers-stopped", "confirmWorkersStopped"],
  ["confirm-live-youtube-dispatch", "confirmLiveYoutubeDispatch"],
]);

const VALUE_FLAGS = new Map([
  ["action", "action"],
  ["database", "databasePath"],
  ["backup-evidence", "backupEvidencePath"],
  ["publication-review-result", "publicationReviewResultPath"],
  ["story-id", "storyId"],
  ["confirm-story-id", "confirmStoryId"],
  ["scheduled-for", "scheduledFor"],
  ["confirm-scheduled-for", "confirmScheduledFor"],
  ["confirm-media-sha256", "confirmMediaSha256"],
  ["confirm-script-sha256", "confirmScriptSha256"],
  ["confirm-request-fingerprint", "confirmRequestFingerprint"],
  ["confirm-renderer-manifest-sha256", "confirmRendererManifestSha256"],
  ["confirm-source-evidence-sha256", "confirmSourceEvidenceSha256"],
  ["confirm-dispatch-key", "confirmDispatchKey"],
  ["expected-source-commit", "expectedSourceCommit"],
  ["expected-runtime-commit", "expectedRuntimeCommit"],
  ["actor-id", "actorId"],
  ["confirm-actor-id", "confirmActorId"],
  ["reason", "reason"],
  ["confirm-reason", "confirmReason"],
  ["change-window-id", "changeWindowId"],
  ["confirm-change-window-id", "confirmChangeWindowId"],
  ["generated-at", "generatedAt"],
  ["out-dir", "outDir"],
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    action: "inspect",
    confirmSupervisorStopped: false,
    confirmWorkersStopped: false,
    confirmLiveYoutubeDispatch: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected_argument:${token}`);
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      options[BOOLEAN_FLAGS.get(name)] = true;
      continue;
    }
    const key = VALUE_FLAGS.get(name);
    if (!key) throw new Error(`unknown_option:${name}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing_value:${name}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function writeArtifacts({ outDir, result }) {
  const resolved = path.resolve(
    outDir ||
      path.join(
        process.cwd(),
        "output",
        "cutover",
        "guarded-youtube-window",
        result.story_id || "unbound",
      ),
  );
  fs.mkdirSync(resolved, { recursive: true });
  const jsonPath = path.join(resolved, "guarded-youtube-window.json");
  const markdownPath = path.join(resolved, "guarded-youtube-window.md");
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    markdownPath,
    renderGuardedYoutubeWindowMarkdown(result),
    "utf8",
  );
  return {
    json_path: jsonPath,
    markdown_path: markdownPath,
  };
}

async function runCli({
  argv = process.argv.slice(2),
  env = process.env,
  execute = executeGuardedYoutubeWindow,
  stdout = process.stdout,
} = {}) {
  const parsed = parseArgs(argv);
  const result = await execute({
    ...parsed,
    env,
  });
  const artifacts = writeArtifacts({
    outDir: parsed.outDir,
    result,
  });
  stdout.write(`${JSON.stringify({ ...result, artifacts }, null, 2)}\n`);
  return { ...result, artifacts };
}

if (require.main === module) {
  runCli()
    .then((result) => {
      if (result.verdict === "HOLD") process.exitCode = 2;
    })
    .catch((error) => {
      process.stderr.write(
        `${JSON.stringify({
          schema_version: "pulse-guarded-youtube-window-result-v1",
          action: "inspect",
          verdict: "HOLD",
          blockers: [String(error?.code || error?.message || "command_failed")],
        })}\n`,
      );
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  runCli,
  writeArtifacts,
};
