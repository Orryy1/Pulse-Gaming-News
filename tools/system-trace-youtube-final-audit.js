#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const {
  EXPECTED_MANIFEST_SHA256,
  auditSystemTraceYouTubeBuffer,
} = require("../lib/services/system-trace-youtube-final-audit");

const REPO_ROOT = path.resolve(__dirname, "..");
const MAIN_REPO_ROOT = "C:\\Users\\MORR\\gaming-studio\\pulse-gaming";
const EVIDENCE_ROOT = "D:\\pulse-evidence\\system-trace-youtube-buffer-20260814";
const DEFAULT_PATHS = Object.freeze({
  repoRoot: REPO_ROOT,
  evidenceRoot: EVIDENCE_ROOT,
  tokenPath: path.join(MAIN_REPO_ROOT, "tokens", "youtube_token.json"),
});

function clean(value) {
  return String(value ?? "").trim();
}

function usage() {
  return [
    "Usage: node tools/system-trace-youtube-final-audit.js",
    "",
    "Runs the fixed, read-only final audit for the exact seven-entry System Trace",
    "YouTube buffer and writes JSON and Markdown evidence to:",
    `  ${EVIDENCE_ROOT}`,
    "",
    "Only youtube.videos.list and youtube.captions.list are permitted.",
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  if (argv.length === 0) return { help: false };
  if (argv.length === 1 && (argv[0] === "--help" || argv[0] === "-h")) {
    return { help: true };
  }
  throw new Error(`unknown_argument:${argv[0]}`);
}

function pathInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative.length > 0 &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function fixedPaths(input = DEFAULT_PATHS) {
  const repoRoot = path.resolve(input.repoRoot || REPO_ROOT);
  const evidenceRoot = path.resolve(input.evidenceRoot || EVIDENCE_ROOT);
  return Object.freeze({
    repoRoot,
    evidenceRoot,
    manifestPath: path.join(repoRoot, "videos", "system-trace-youtube-buffer.json"),
    privateRoot: path.join(evidenceRoot, "receipts", "private"),
    scheduleRoot: path.join(evidenceRoot, "receipts", "schedule"),
    jsonOut: path.join(evidenceRoot, "final-youtube-buffer-audit.json"),
    markdownOut: path.join(evidenceRoot, "final-youtube-buffer-audit.md"),
    tokenPath: path.resolve(input.tokenPath || DEFAULT_PATHS.tokenPath),
  });
}

async function readRegularJson(file, label) {
  const requested = path.resolve(file);
  const stat = await fs.lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  const bytes = await fs.readFile(requested);
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label}_must_be_valid_json`);
  }
  return { bytes, document, path: requested };
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function readRegularBytes(file, label) {
  const requested = path.resolve(file);
  const stat = await fs.lstat(requested);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label}_must_be_regular_file`);
  }
  return { bytes: await fs.readFile(requested), path: requested };
}

async function currentAuthenticatedReadOnlyYoutubeClientFactory({ tokenPath } = {}) {
  const tokenInput = await readRegularJson(tokenPath, "youtube_token");
  const token = tokenInput.document;
  const minimumValidityMs = 5 * 60 * 1000;
  if (
    !clean(token?.access_token) ||
    !Number.isFinite(Number(token?.expiry_date)) ||
    Number(token.expiry_date) <= Date.now() + minimumValidityMs
  ) {
    throw new Error("current_non_refreshing_youtube_access_token_required");
  }
  const { google } = require("googleapis");
  const auth = new google.auth.OAuth2();
  auth.setCredentials({
    access_token: token.access_token,
    token_type: clean(token.token_type) || "Bearer",
    expiry_date: Number(token.expiry_date),
  });
  return google.youtube({ version: "v3", auth });
}

async function loadReceipts(manifest, paths) {
  const privateReceipts = {};
  const privateReconciliations = {};
  const scheduleReceipts = {};
  for (const episode of manifest.episodes) {
    const storyId = episode.story_id;
    const privatePath = path.join(
      paths.privateRoot,
      `${storyId}-private-upload-receipt.json`,
    );
    const schedulePath = path.join(
      paths.scheduleRoot,
      `${storyId}-schedule-receipt.json`,
    );
    const privateInput = await readRegularJson(
      privatePath,
      `private_receipt:${storyId}`,
    );
    privateReceipts[storyId] = {
      document: privateInput.document,
      sha256: sha256(privateInput.bytes),
    };
    if (
      privateInput.document?.receipt_type ===
      "governed_youtube_private_dispatch"
    ) {
      const reconciliationPath = path.join(
        paths.privateRoot,
        `${storyId}-private-upload-reconciliation.json`,
      );
      const reconciliationInput = await readRegularJson(
        reconciliationPath,
        `private_reconciliation:${storyId}`,
      );
      privateReconciliations[storyId] = {
        document: reconciliationInput.document,
        sha256: sha256(reconciliationInput.bytes),
      };
    }
    scheduleReceipts[storyId] = (
      await readRegularJson(schedulePath, `schedule_receipt:${storyId}`)
    ).document;
  }
  return { privateReceipts, privateReconciliations, scheduleReceipts };
}

async function loadPackages(manifest, paths) {
  const packages = {};
  for (const episode of manifest.episodes) {
    const storyId = episode.story_id;
    if (episode.project_dir !== `videos/${storyId}`) {
      throw new Error(`fixed_project_dir_required:${storyId}`);
    }
    const packageRoot = path.resolve(paths.repoRoot, episode.project_dir);
    if (!pathInside(paths.repoRoot, packageRoot)) {
      throw new Error(`package_must_be_inside_fixed_repo:${storyId}`);
    }
    const packageStat = await fs.lstat(packageRoot);
    if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) {
      throw new Error(`package_must_be_regular_directory:${storyId}`);
    }
    const canonicalInput = await readRegularJson(
      path.join(packageRoot, "canonical_story_manifest.json"),
      `canonical_manifest:${storyId}`,
    );
    const publishPackInput = await readRegularJson(
      path.join(packageRoot, "youtube_publish_pack.json"),
      `youtube_publish_pack:${storyId}`,
    );
    const captionsInput = await readRegularBytes(
      path.join(packageRoot, "captions.srt"),
      `captions:${storyId}`,
    );
    packages[storyId] = {
      canonical_manifest: canonicalInput.document,
      publish_pack: publishPackInput.document,
      captions_sha256: sha256(captionsInput.bytes),
      captions_bytes: captionsInput.bytes.length,
    };
  }
  return packages;
}

function markdownCell(value) {
  return clean(value).replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderMarkdown(report) {
  const lines = [
    "# Final YouTube Buffer Audit",
    "",
    `- Verdict: **${report.verdict}**`,
    `- Generated: ${report.generated_at}`,
    `- Channel: ${report.channel.title} (${report.channel.id})`,
    `- Episodes: ${report.episode_count}`,
    `- Independent read requests: ${report.remote_read_request_count}`,
    `- Remote mutation requests: ${report.remote_mutation_request_count}`,
    `- Automatic retries: ${report.retry_allowed ? "enabled" : "disabled"}`,
    "",
    "| Story | Video | Native release (UTC) | Captions | Verdict |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const episode of report.episodes) {
    lines.push(
      `| ${markdownCell(episode.story_id)} | ${markdownCell(episode.video_id)} | ` +
      `${markdownCell(episode.publish_at_utc)} | ` +
      `${episode.checks.captions_serving === true ? "serving" : "blocked"} | ` +
      `${episode.verdict} |`,
    );
  }
  lines.push("", "## Safety", "");
  lines.push(
    "This audit used only YouTube video and caption readbacks. It made no upload, " +
    "update, OAuth, token-file or database mutations and disabled automatic retries.",
  );
  if (report.blockers.length) {
    lines.push("", "## Blockers", "");
    for (const blocker of report.blockers) lines.push(`- ${blocker}`);
  } else {
    lines.push("", "No blockers were found.");
  }
  return `${lines.join("\n")}\n`;
}

async function writeEvidence(paths, report) {
  const evidenceRoot = path.resolve(paths.evidenceRoot);
  const jsonOut = path.resolve(paths.jsonOut);
  const markdownOut = path.resolve(paths.markdownOut);
  if (!pathInside(evidenceRoot, jsonOut) || !pathInside(evidenceRoot, markdownOut)) {
    throw new Error("audit_outputs_must_be_inside_fixed_evidence_root");
  }
  await fs.ensureDir(evidenceRoot);
  const rootStat = await fs.lstat(evidenceRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("evidence_root_must_be_regular_directory");
  }
  await fs.writeFile(jsonOut, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await fs.writeFile(markdownOut, renderMarkdown(report), "utf8");
  return { json: jsonOut, markdown: markdownOut };
}

async function main(
  argv = process.argv.slice(2),
  {
    paths = DEFAULT_PATHS,
    authenticatedReadOnlyYoutubeClientFactory =
      currentAuthenticatedReadOnlyYoutubeClientFactory,
    generatedAt,
    log = console.log,
  } = {},
) {
  const args = parseArgs(argv);
  if (args.help) {
    log(usage());
    return { help: true };
  }
  const resolvedPaths = fixedPaths(paths);
  const manifestInput = await readRegularJson(
    resolvedPaths.manifestPath,
    "manifest",
  );
  const manifestSha256 = sha256(manifestInput.bytes);
  if (manifestSha256 !== EXPECTED_MANIFEST_SHA256) {
    throw new Error("exact_system_trace_manifest_sha256_required");
  }
  const receipts = await loadReceipts(manifestInput.document, resolvedPaths);
  const packages = await loadPackages(manifestInput.document, resolvedPaths);
  const client = await authenticatedReadOnlyYoutubeClientFactory({
    tokenPath: resolvedPaths.tokenPath,
  });
  const report = await auditSystemTraceYouTubeBuffer({
    client,
    manifest: manifestInput.document,
    manifestSha256,
    privateReceipts: receipts.privateReceipts,
    privateReconciliations: receipts.privateReconciliations,
    scheduleReceipts: receipts.scheduleReceipts,
    packages,
    generatedAt,
  });
  const artefacts = await writeEvidence(resolvedPaths, report);
  log(
    `[system-trace-youtube-final-audit] ${report.verdict}: ` +
    `${report.episode_count} episodes; reads=${report.remote_read_request_count}; ` +
    `mutations=${report.remote_mutation_request_count}; json=${artefacts.json}`,
  );
  return { report, artefacts };
}

if (require.main === module) {
  main()
    .then((result) => {
      if (!result?.help && result?.report?.verdict !== "GREEN") process.exitCode = 2;
    })
    .catch((error) => {
      console.error(`[system-trace-youtube-final-audit] BLOCKED: ${clean(error?.message || error)}`);
      process.exitCode = 2;
    });
}

module.exports = {
  DEFAULT_PATHS,
  currentAuthenticatedReadOnlyYoutubeClientFactory,
  fixedPaths,
  main,
  parseArgs,
  renderMarkdown,
  usage,
};
