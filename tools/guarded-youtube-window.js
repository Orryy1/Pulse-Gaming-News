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
  ["help", "help"],
  [
    "confirm-outside-cadence-one-shot",
    "confirmOutsideCadenceOneShot",
  ],
  ["confirm-supervisor-stopped", "confirmSupervisorStopped"],
  ["confirm-workers-stopped", "confirmWorkersStopped"],
  ["confirm-live-youtube-dispatch", "confirmLiveYoutubeDispatch"],
]);

const USAGE = `Usage: node tools/guarded-youtube-window.js [options]

Read-only discovery:
  --action inspect
  --database <path>
  --backup-evidence <path>
  --publication-review-result <path>
  --story-id <id>
  --scheduled-for <ISO-8601>
  --expected-source-commit <40-char SHA>
  --expected-runtime-commit <40-char SHA>

Exact second-pass confirmations:
  --confirm-story-id <id>
  --confirm-scheduled-for <ISO-8601>
  --confirm-media-sha256 <SHA-256>
  --confirm-script-sha256 <SHA-256>
  --confirm-request-fingerprint <SHA-256>
  --confirm-renderer-manifest-sha256 <SHA-256>
  --confirm-source-evidence-sha256 <SHA-256>
  --confirm-dispatch-key <key>
  --actor-id <id> --confirm-actor-id <id>
  --reason <text> --confirm-reason <text>
  --change-window-id <id> --confirm-change-window-id <id>
  --confirm-supervisor-stopped --confirm-workers-stopped

Explicit one-shot outside normal cadence:
  --outside-cadence-authorisation-id <id>
  --confirm-outside-cadence-authorisation-id <same-id>
  --confirm-outside-cadence-one-shot

Mutation actions:
  --action admit
  --action dispatch --confirm-live-youtube-dispatch

Inspect is always the default. The first inspect remains HOLD when exact
confirmations are absent and emits expected_confirmations for a reviewed
second pass. No command mutates authentication credentials.
`;

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
  [
    "outside-cadence-authorisation-id",
    "outsideCadenceAuthorisationId",
  ],
  [
    "confirm-outside-cadence-authorisation-id",
    "confirmOutsideCadenceAuthorisationId",
  ],
  ["generated-at", "generatedAt"],
  ["out-dir", "outDir"],
]);

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    action: "inspect",
    confirmSupervisorStopped: false,
    confirmWorkersStopped: false,
    confirmLiveYoutubeDispatch: false,
    confirmOutsideCadenceOneShot: false,
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
  const action = String(result.action || "inspect")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-");
  const generatedAt = String(result.generated_at || new Date().toISOString())
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+$/g, "");
  const baseName = `guarded-youtube-window-${action}-${generatedAt}`;
  const jsonPath = path.join(resolved, `${baseName}.json`);
  const markdownPath = path.join(resolved, `${baseName}.md`);
  const artifacts = [
    {
      filePath: jsonPath,
      content: `${JSON.stringify(result, null, 2)}\n`,
    },
    {
      filePath: markdownPath,
      content: renderGuardedYoutubeWindowMarkdown(result),
    },
  ];
  for (const artifact of artifacts) {
    if (
      fs.existsSync(artifact.filePath) &&
      fs.readFileSync(artifact.filePath, "utf8") !== artifact.content
    ) {
      throw new Error(
        `guarded_evidence_collision:${path.basename(artifact.filePath)}`,
      );
    }
  }
  for (const artifact of artifacts) {
    if (!fs.existsSync(artifact.filePath)) {
      fs.writeFileSync(artifact.filePath, artifact.content, {
        encoding: "utf8",
        flag: "wx",
      });
    }
  }
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
  if (parsed.help) {
    stdout.write(USAGE);
    return {
      help: true,
      mutated: false,
      safety: {
        database_mutated: false,
        platforms_contacted: false,
        authentication_credentials_mutated: false,
      },
    };
  }
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
  USAGE,
  parseArgs,
  runCli,
  writeArtifacts,
};
