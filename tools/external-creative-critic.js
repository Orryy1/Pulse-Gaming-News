#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  adjudicateExternalCreativeCriticResponse,
  buildExternalCreativeCriticPacket,
  parseExternalCreativeCriticResponse,
  renderExternalCreativeCriticAdjudicationMarkdown,
  renderExternalCreativeCriticPacketMarkdown,
  renderExternalCreativeCriticResponseMarkdown,
} = require("../lib/services/external-creative-critic");

function parseArgs(argv) {
  const values = {};
  const supported = new Set([
    "input",
    "out-dir",
    "response",
    "decisions",
    "prior-packet",
    "prior-response",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected_argument:${argument}`);
    }
    const name = argument.slice(2);
    if (!supported.has(name)) {
      throw new Error(`unknown_argument:${argument}`);
    }
    if (Object.hasOwn(values, name)) {
      throw new Error(`duplicate_argument:${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`argument_value_required:${argument}`);
    }
    values[name] = value;
    index += 1;
  }
  if (!values.input) throw new Error("input_path_required");
  if (!values["out-dir"]) {
    throw new Error("output_directory_required");
  }
  if (values.decisions && !values.response) {
    throw new Error("critic_response_required_for_decisions");
  }
  if (Boolean(values["prior-packet"]) !== Boolean(values["prior-response"])) {
    throw new Error("critic_prior_packet_and_response_required");
  }
  return values;
}

async function readJsonObject(filePath, label) {
  const value = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label}_must_be_an_object`);
  }
  return value;
}

const REPO_ROOT = path.resolve(__dirname, "..");
const REPO_OUTPUT_ROOT = path.join(REPO_ROOT, "output");
const TEMP_ROOT = path.resolve(os.tmpdir());

function pathParts(filePath) {
  return String(filePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function samePath(left, right) {
  return path.relative(path.resolve(left), path.resolve(right)) === "";
}

function matchingAllowedRoot(resolved) {
  return [REPO_OUTPUT_ROOT, TEMP_ROOT].find((root) =>
    pathWithin(root, resolved),
  );
}

function assertLexicallySafePath(filePath, label, { workspace = false } = {}) {
  const rawParts = String(filePath).split(/[\\/]+/).filter(Boolean);
  if (rawParts.includes("..")) {
    throw new Error(`critic_path_traversal_forbidden:${label}`);
  }
  const resolved = path.resolve(filePath);
  const segments = pathParts(resolved);
  const forbiddenSegments = new Set([
    "tokens",
    "token",
    "db",
    ".git",
    ".ssh",
    ".aws",
  ]);
  const basename = path.basename(resolved).toLowerCase();
  if (
    segments.some((segment) => forbiddenSegments.has(segment)) ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /\.(?:db|sqlite|sqlite3)$/i.test(basename)
  ) {
    throw new Error(`critic_sensitive_path_forbidden:${label}`);
  }
  const allowedRoot = matchingAllowedRoot(resolved);
  if (!allowedRoot) {
    throw new Error(
      workspace
        ? `critic_workspace_outside_allowed_roots:${label}`
        : `critic_path_outside_allowed_roots:${label}`,
    );
  }
  if (workspace && path.resolve(allowedRoot) === resolved) {
    throw new Error(`critic_workspace_root_forbidden:${label}`);
  }
  return {
    allowedRoot,
    resolved,
  };
}

async function assertNoPathLinks({ allowedRoot, resolved }, label) {
  try {
    const rootStats = await fs.lstat(allowedRoot);
    if (rootStats.isSymbolicLink()) {
      throw new Error(`critic_path_link_forbidden:${label}`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const relative = path.relative(allowedRoot, resolved);
  let cursor = allowedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    let stats;
    try {
      stats = await fs.lstat(cursor);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`critic_path_link_forbidden:${label}`);
    }
  }
}

async function assertWorkspaceNotInsideTempRepository(descriptor, label) {
  if (descriptor.allowedRoot !== TEMP_ROOT) return;
  let cursor = descriptor.resolved;
  while (pathWithin(TEMP_ROOT, cursor)) {
    try {
      await fs.lstat(path.join(cursor, ".git"));
      throw new Error(`critic_workspace_source_tree_forbidden:${label}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    if (cursor === TEMP_ROOT) break;
    cursor = path.dirname(cursor);
  }
}

async function resolveCriticPath(
  filePath,
  label,
  { workspace = false } = {},
) {
  const descriptor = assertLexicallySafePath(filePath, label, { workspace });
  await assertNoPathLinks(descriptor, label);
  if (workspace) {
    await assertWorkspaceNotInsideTempRepository(descriptor, label);
  }
  return descriptor;
}

async function writeFileCreateOrVerify(filePath, content) {
  try {
    const existingStats = await fs.lstat(filePath);
    if (existingStats.isSymbolicLink()) {
      throw new Error("critic_workspace_artifact_link_forbidden");
    }
    if (!existingStats.isFile()) {
      throw new Error("critic_workspace_artifact_type_forbidden");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await fs.readFile(filePath, "utf8");
    if (existing !== content) {
      throw new Error(`critic_workspace_artifact_collision:${filePath}`);
    }
    return false;
  }
}

async function writeJsonAndMarkdown({
  outDir,
  basename,
  value,
  markdown,
}) {
  const jsonPath = path.join(outDir, `${basename}.json`);
  const markdownPath = path.join(outDir, `${basename}.md`);
  const writes = await Promise.all([
    writeFileCreateOrVerify(
      jsonPath,
      `${JSON.stringify(value, null, 2)}\n`,
    ),
    writeFileCreateOrVerify(markdownPath, markdown),
  ]);
  return {
    artifacts_written: writes.filter(Boolean).length,
    json_path: jsonPath,
    markdown_path: markdownPath,
  };
}

async function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const inputDescriptor = await resolveCriticPath(args.input, "input");
  const outDescriptor = await resolveCriticPath(args["out-dir"], "out_dir", {
    workspace: true,
  });
  const responseDescriptor = args.response
    ? await resolveCriticPath(args.response, "response")
    : null;
  const decisionsDescriptor = args.decisions
    ? await resolveCriticPath(args.decisions, "decisions")
    : null;
  const priorPacketDescriptor = args["prior-packet"]
    ? await resolveCriticPath(args["prior-packet"], "prior_packet")
    : null;
  const priorResponseDescriptor = args["prior-response"]
    ? await resolveCriticPath(args["prior-response"], "prior_response")
    : null;
  const input = await readJsonObject(
    inputDescriptor.resolved,
    "critic_input",
  );
  const isFollowUp = input.round?.kind === "follow_up";
  if (isFollowUp && (!priorPacketDescriptor || !priorResponseDescriptor)) {
    throw new Error("critic_prior_packet_and_response_required");
  }
  if (!isFollowUp && (priorPacketDescriptor || priorResponseDescriptor)) {
    throw new Error("critic_initial_chain_forbidden");
  }
  if (
    isFollowUp &&
    (!samePath(
      path.dirname(priorPacketDescriptor.resolved),
      outDescriptor.resolved,
    ) ||
      !samePath(
        path.dirname(priorResponseDescriptor.resolved),
        outDescriptor.resolved,
      ))
  ) {
    throw new Error("critic_follow_up_workspace_mismatch");
  }
  const priorPacket = priorPacketDescriptor
    ? await readJsonObject(priorPacketDescriptor.resolved, "critic_prior_packet")
    : null;
  const priorResponse = priorResponseDescriptor
    ? await readJsonObject(
        priorResponseDescriptor.resolved,
        "critic_prior_response",
      )
    : null;
  const chainContext = {
    prior_packet: priorPacket,
    prior_response: priorResponse,
  };
  const packet = buildExternalCreativeCriticPacket(input, chainContext);
  let response = null;
  let adjudication = null;
  if (responseDescriptor) {
    const responseMarkdown = await fs.readFile(
      responseDescriptor.resolved,
      "utf8",
    );
    response = parseExternalCreativeCriticResponse({
      packet,
      response_markdown: responseMarkdown,
      ...chainContext,
    });
    if (decisionsDescriptor) {
      const decisionsInput = await readJsonObject(
        decisionsDescriptor.resolved,
        "critic_decisions",
      );
      if (
        Object.keys(decisionsInput).length !== 1 ||
        !Object.hasOwn(decisionsInput, "decisions")
      ) {
        throw new Error("critic_decisions_fields_invalid");
      }
      adjudication = adjudicateExternalCreativeCriticResponse({
        packet,
        response,
        decisions: decisionsInput.decisions,
        ...chainContext,
      });
    }
  }
  const createdDirectory = await fs.mkdir(outDescriptor.resolved, {
    recursive: true,
  });
  await assertNoPathLinks(outDescriptor, "out_dir");
  const artifactPrefix = isFollowUp
    ? "external_creative_critic_follow_up"
    : "external_creative_critic";
  let artifactsWritten = createdDirectory ? 1 : 0;
  const packetPaths = await writeJsonAndMarkdown({
    outDir: outDescriptor.resolved,
    basename: `${artifactPrefix}_packet`,
    value: packet,
    markdown: renderExternalCreativeCriticPacketMarkdown(
      packet,
      chainContext,
    ),
  });
  artifactsWritten += packetPaths.artifacts_written;
  const result = {
    mode: "LOCAL_PROOF",
    packet_id: packet.packet_id,
    packet_json_path: packetPaths.json_path,
    packet_markdown_path: packetPaths.markdown_path,
    response_json_path: null,
    response_markdown_path: null,
    adjudication_json_path: null,
    adjudication_markdown_path: null,
    external_network_used: false,
    artifact_workspace_mutation_triggered: artifactsWritten > 0,
    filesystem_mutation_triggered: artifactsWritten > 0,
    creative_changes_applied: false,
    repository_mutation_triggered: false,
    repository_source_mutation_triggered: false,
    repository_output_mutation_triggered:
      outDescriptor.allowedRoot === REPO_OUTPUT_ROOT && artifactsWritten > 0,
    database_mutation_triggered: false,
    oauth_or_token_mutation_triggered: false,
    publish_triggered: false,
  };
  if (response) {
    const responsePaths = await writeJsonAndMarkdown({
      outDir: outDescriptor.resolved,
      basename: `${artifactPrefix}_response`,
      value: response,
      markdown: renderExternalCreativeCriticResponseMarkdown(response),
    });
    artifactsWritten += responsePaths.artifacts_written;
    result.response_json_path = responsePaths.json_path;
    result.response_markdown_path = responsePaths.markdown_path;
    result.response_sha256 = response.response_sha256;
    if (adjudication) {
      const adjudicationPaths = await writeJsonAndMarkdown({
        outDir: outDescriptor.resolved,
        basename: `${artifactPrefix}_adjudication`,
        value: adjudication,
        markdown:
          renderExternalCreativeCriticAdjudicationMarkdown(adjudication),
      });
      artifactsWritten += adjudicationPaths.artifacts_written;
      result.adjudication_json_path = adjudicationPaths.json_path;
      result.adjudication_markdown_path = adjudicationPaths.markdown_path;
      result.adjudication_id = adjudication.adjudication_id;
    }
  }
  result.artifact_workspace_mutation_triggered = artifactsWritten > 0;
  result.filesystem_mutation_triggered = artifactsWritten > 0;
  result.repository_output_mutation_triggered =
    outDescriptor.allowedRoot === REPO_OUTPUT_ROOT && artifactsWritten > 0;
  return result;
}

if (require.main === module) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`[external-creative-critic] ${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = {
  parseArgs,
  run,
};
