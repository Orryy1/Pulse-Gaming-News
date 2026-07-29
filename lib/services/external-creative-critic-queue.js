"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const {
  buildExternalCreativeCriticPacket,
  parseExternalCreativeCriticResponse,
} = require("./external-creative-critic");

const REQUEST_SCHEMA = "pulse-external-creative-critic-queue-request-v1";
const OUTCOME_SCHEMA = "pulse-external-creative-critic-queue-outcome-v1";
const BROKER_RECEIPT_SCHEMA =
  "pulse-external-creative-critic-broker-receipt-v1";
const MODE = "LOCAL_PROOF";
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 30 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_MAX_BROKER_RECEIPT_BYTES = 16 * 1024;
const DEFAULT_STAGE_LOCK_WAIT_MS = 5_000;
const DEFAULT_STAGE_LOCK_STALE_MS = 60_000;
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const REPO_OUTPUT_ROOT = path.join(REPO_ROOT, "output");

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalise(value));
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sha256Canonical(value) {
  return `sha256:${sha256Bytes(Buffer.from(stableJson(value), "utf8"))}`;
}

function normaliseSha256(value, label) {
  const normalised = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, "");
  if (!/^[a-f0-9]{64}$/.test(normalised)) {
    throw new Error(`${label}_invalid`);
  }
  return normalised;
}

function asIso(value, label) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label}_invalid`);
  return parsed.toISOString();
}

function pathWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function defaultAllowedRoots() {
  return [
    REPO_OUTPUT_ROOT,
    path.resolve(os.tmpdir()),
    ...(process.env.PULSE_STATE_ROOT
      ? [path.resolve(process.env.PULSE_STATE_ROOT)]
      : []),
  ];
}

function assertSafeSegments(candidate, label) {
  const segments = path
    .resolve(candidate)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((entry) => entry.toLowerCase());
  const forbidden = new Set([
    ".git",
    ".ssh",
    ".aws",
    "tokens",
    "token",
    "db",
  ]);
  const basename = path.basename(candidate).toLowerCase();
  if (
    segments.some((entry) => forbidden.has(entry)) ||
    basename === ".env" ||
    basename.startsWith(".env.") ||
    /\.(?:db|sqlite|sqlite3)$/i.test(basename)
  ) {
    throw new Error(`critic_queue_sensitive_path_forbidden:${label}`);
  }
}

function resolveAllowedPath(
  candidate,
  label,
  { allowedRoots, rootMayEqual = false } = {},
) {
  if (String(candidate).split(/[\\/]+/).includes("..")) {
    throw new Error(`critic_queue_path_traversal_forbidden:${label}`);
  }
  const resolved = path.resolve(String(candidate || ""));
  assertSafeSegments(resolved, label);
  const roots = (allowedRoots?.length ? allowedRoots : defaultAllowedRoots()).map(
    (entry) => path.resolve(entry),
  );
  const allowedRoot = roots.find((root) => pathWithin(root, resolved));
  if (!allowedRoot || (!rootMayEqual && allowedRoot === resolved)) {
    throw new Error(`critic_queue_path_outside_allowed_roots:${label}`);
  }
  return { allowedRoot, resolved };
}

async function assertNoPathLinks({ allowedRoot, resolved }, label) {
  const relative = path.relative(allowedRoot, resolved);
  let cursor = allowedRoot;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const stats = await fs.lstat(cursor);
      if (stats.isSymbolicLink()) {
        throw new Error(`critic_queue_path_link_forbidden:${label}`);
      }
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

async function resolveQueueRoot(queueRoot, allowedRoots) {
  if (!queueRoot) throw new Error("critic_queue_root_required");
  const descriptor = resolveAllowedPath(queueRoot, "queue_root", {
    allowedRoots,
  });
  await assertNoPathLinks(descriptor, "queue_root");
  return descriptor;
}

function requestKey(requestId) {
  const normalised = String(requestId || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalised)) {
    throw new Error("critic_queue_request_id_invalid");
  }
  return normalised.slice("sha256:".length);
}

function requestPaths(queueRoot, requestId) {
  const key = requestKey(requestId);
  const root = path.join(queueRoot, "requests", key);
  return {
    key,
    root,
    packet: path.join(root, "packet.json"),
    prompt: path.join(root, "prompt.txt"),
    manifest: path.join(root, "request-manifest.json"),
  };
}

function outcomePaths(queueRoot, requestId) {
  const key = requestKey(requestId);
  const root = path.join(queueRoot, "outcomes", key);
  return {
    key,
    root,
    rawResponse: path.join(root, "raw-response.md"),
    parsedResponse: path.join(root, "parsed-response.json"),
    brokerReceipt: path.join(root, "broker-receipt.json"),
    manifest: path.join(root, "outcome.json"),
  };
}

function inboxResponsePath(queueRoot, requestId) {
  return path.join(
    queueRoot,
    "inbox",
    `${requestKey(requestId)}.response.md.ready`,
  );
}

function inboxBrokerReceiptPath(queueRoot, requestId) {
  return path.join(
    queueRoot,
    "inbox",
    `${requestKey(requestId)}.broker-receipt.json`,
  );
}

async function ensureQueueDirectories(queueRoot) {
  await fs.mkdir(queueRoot, { recursive: true });
  for (const name of [
    "requests",
    "inbox",
    "outcomes",
    "late",
    ".staging",
  ]) {
    await fs.mkdir(path.join(queueRoot, name), { recursive: true });
  }
}

async function readRequestManifest(queueRoot, requestId) {
  const paths = requestPaths(queueRoot, requestId);
  await assertNoPathLinks(
    { allowedRoot: queueRoot, resolved: paths.manifest },
    "request",
  );
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(paths.manifest, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("critic_queue_request_not_found");
    }
    throw error;
  }
  if (
    manifest?.schema_version !== REQUEST_SCHEMA ||
    manifest?.request_id !== requestId ||
    manifest?.status !== "REQUESTED"
  ) {
    throw new Error("critic_queue_request_manifest_invalid");
  }
  const { request_sha256: declared, ...core } = manifest;
  if (sha256Canonical(core) !== declared) {
    throw new Error("critic_queue_request_manifest_integrity_invalid");
  }
  const [packetBytes, promptBytes] = await Promise.all([
    fs.readFile(paths.packet),
    fs.readFile(paths.prompt),
  ]);
  if (
    sha256Bytes(packetBytes) !== manifest.artifacts.packet.raw_sha256 ||
    sha256Bytes(promptBytes) !== manifest.artifacts.prompt.raw_sha256
  ) {
    throw new Error("critic_queue_request_artifact_integrity_invalid");
  }
  return { manifest, paths };
}

async function readOutcomeManifest(queueRoot, requestId) {
  const paths = outcomePaths(queueRoot, requestId);
  await assertNoPathLinks(
    { allowedRoot: queueRoot, resolved: paths.manifest },
    "outcome",
  );
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(paths.manifest, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    manifest?.schema_version !== OUTCOME_SCHEMA ||
    manifest?.request_id !== requestId ||
    ![
      "CRITIQUE_READY",
      "TIMED_OUT_FALLBACK",
      "INVALID_RESPONSE_FALLBACK",
      "BROKER_UNAVAILABLE_FALLBACK",
    ].includes(manifest?.status)
  ) {
    throw new Error("critic_queue_outcome_manifest_invalid");
  }
  const { outcome_sha256: declared, ...core } = manifest;
  if (sha256Canonical(core) !== declared) {
    throw new Error("critic_queue_outcome_manifest_integrity_invalid");
  }
  if (manifest.artifacts?.raw_response) {
    const bytes = await fs.readFile(paths.rawResponse);
    if (
      sha256Bytes(bytes) !==
      manifest.artifacts.raw_response.raw_sha256
    ) {
      throw new Error("critic_queue_outcome_artifact_integrity_invalid");
    }
  }
  if (manifest.artifacts?.parsed_response) {
    const bytes = await fs.readFile(paths.parsedResponse);
    if (
      sha256Bytes(bytes) !==
      manifest.artifacts.parsed_response.raw_sha256
    ) {
      throw new Error("critic_queue_outcome_artifact_integrity_invalid");
    }
  }
  if (manifest.artifacts?.broker_receipt) {
    const bytes = await fs.readFile(paths.brokerReceipt);
    if (
      sha256Bytes(bytes) !==
      manifest.artifacts.broker_receipt.raw_sha256
    ) {
      throw new Error("critic_queue_outcome_artifact_integrity_invalid");
    }
  }
  return { manifest, paths };
}

async function readBoundedRegularFile(
  filePath,
  {
    label,
    allowedRoots,
    maximumBytes = DEFAULT_MAX_RESPONSE_BYTES,
  },
) {
  const descriptor = resolveAllowedPath(filePath, label, {
    allowedRoots,
  });
  await assertNoPathLinks(descriptor, label);
  const before = await fs.lstat(descriptor.resolved);
  if (before.isSymbolicLink()) {
    throw new Error(`critic_queue_path_link_forbidden:${label}`);
  }
  if (!before.isFile()) {
    throw new Error(`critic_queue_regular_file_required:${label}`);
  }
  if (before.size < 1 || before.size > maximumBytes) {
    throw new Error(`critic_queue_file_size_invalid:${label}`);
  }
  const real = await fs.realpath(descriptor.resolved);
  if (!pathWithin(descriptor.allowedRoot, real)) {
    throw new Error(`critic_queue_realpath_escape_forbidden:${label}`);
  }
  const bytes = await fs.readFile(descriptor.resolved);
  const after = await fs.lstat(descriptor.resolved);
  if (
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    bytes.length !== before.size
  ) {
    throw new Error(`critic_queue_file_changed_during_read:${label}`);
  }
  return { bytes, descriptor };
}

async function readExternalCreativeCriticQueueJsonInput({
  filePath,
  allowedRoots,
  maximumBytes = 1024 * 1024,
} = {}) {
  const source = await readBoundedRegularFile(filePath, {
    label: "input",
    allowedRoots,
    maximumBytes,
  });
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source.bytes);
  } catch {
    throw new Error("critic_queue_input_utf8_invalid");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("critic_queue_input_json_invalid");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("critic_queue_input_object_required");
  }
  return value;
}

const BROKER_RECEIPT_FIELDS = Object.freeze([
  "schema_version",
  "request_id",
  "packet_id",
  "candidate_revision_sha256",
  "response_raw_sha256",
  "transport",
  "client",
  "model_claim",
  "model_claim_verified",
  "submitted_at",
  "network_used",
  "browser_or_ui_used",
  "broker_version",
  "host_scope",
  "database_mutation_authority",
  "oauth_or_token_authority",
  "scheduler_authority",
  "publish_authority",
]);

function brokerReceiptToken(value, label, maximumLength = 64) {
  if (typeof value !== "string") {
    throw new Error(`critic_queue_broker_receipt_${label}_invalid`);
  }
  const token = value;
  if (
    token.length > maximumLength ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(token)
  ) {
    throw new Error(`critic_queue_broker_receipt_${label}_invalid`);
  }
  return token;
}

function validateBrokerReceipt({
  value,
  request,
  responseRawSha256,
}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("critic_queue_broker_receipt_object_required");
  }
  const actualFields = Object.keys(value).sort();
  const expectedFields = [...BROKER_RECEIPT_FIELDS].sort();
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field, index) => field !== expectedFields[index])
  ) {
    throw new Error("critic_queue_broker_receipt_fields_invalid");
  }
  if (value.schema_version !== BROKER_RECEIPT_SCHEMA) {
    throw new Error("critic_queue_broker_receipt_schema_invalid");
  }
  if (
    value.request_id !== request.request_id ||
    value.packet_id !== request.packet_id ||
    normaliseSha256(
      value.candidate_revision_sha256,
      "critic_queue_broker_receipt_candidate_revision_sha256",
    ) !== request.candidate_revision_sha256 ||
    normaliseSha256(
      value.response_raw_sha256,
      "critic_queue_broker_receipt_response_raw_sha256",
    ) !== responseRawSha256
  ) {
    throw new Error("critic_queue_broker_receipt_binding_invalid");
  }
  if (value.model_claim_verified !== false) {
    throw new Error(
      "critic_queue_broker_receipt_model_claim_verified_forbidden",
    );
  }
  for (const field of [
    "database_mutation_authority",
    "oauth_or_token_authority",
    "scheduler_authority",
    "publish_authority",
  ]) {
    if (value[field] !== false) {
      throw new Error(
        `critic_queue_broker_receipt_authority_forbidden:${field}`,
      );
    }
  }
  for (const field of ["network_used", "browser_or_ui_used"]) {
    if (typeof value[field] !== "boolean") {
      throw new Error(
        `critic_queue_broker_receipt_${field}_invalid`,
      );
    }
  }
  if (value.host_scope !== "isolated_queue_only") {
    throw new Error("critic_queue_broker_receipt_host_scope_invalid");
  }
  const submittedAt = asIso(
    value.submitted_at,
    "critic_queue_broker_receipt_submitted_at",
  );
  if (submittedAt !== value.submitted_at) {
    throw new Error(
      "critic_queue_broker_receipt_submitted_at_invalid",
    );
  }
  return {
    schema_version: BROKER_RECEIPT_SCHEMA,
    request_id: request.request_id,
    packet_id: request.packet_id,
    candidate_revision_sha256:
      request.candidate_revision_sha256,
    response_raw_sha256: responseRawSha256,
    transport: brokerReceiptToken(value.transport, "transport"),
    client: brokerReceiptToken(value.client, "client"),
    model_claim: brokerReceiptToken(
      value.model_claim,
      "model_claim",
      128,
    ),
    model_claim_verified: false,
    submitted_at: submittedAt,
    network_used: value.network_used,
    browser_or_ui_used: value.browser_or_ui_used,
    broker_version: brokerReceiptToken(
      value.broker_version,
      "broker_version",
    ),
    host_scope: "isolated_queue_only",
    database_mutation_authority: false,
    oauth_or_token_authority: false,
    scheduler_authority: false,
    publish_authority: false,
  };
}

async function readBrokerReceipt({
  filePath,
  request,
  responseRawSha256,
  allowedRoots,
  maximumBytes = DEFAULT_MAX_BROKER_RECEIPT_BYTES,
}) {
  const source = await readBoundedRegularFile(filePath, {
    label: "broker_receipt",
    allowedRoots,
    maximumBytes,
  });
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      source.bytes,
    );
  } catch {
    throw new Error("critic_queue_broker_receipt_utf8_invalid");
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("critic_queue_broker_receipt_json_invalid");
  }
  return {
    bytes: source.bytes,
    provenance: validateBrokerReceipt({
      value,
      request,
      responseRawSha256,
    }),
  };
}

async function publishOutcome({
  queueRoot,
  request,
  outcomeCore,
  rawResponseBytes = null,
  parsedResponse = null,
  brokerReceiptBytes = null,
  brokerProvenance = null,
}) {
  const existing = await readOutcomeManifest(
    queueRoot,
    request.request_id,
  );
  if (existing) {
    return {
      ...existing.manifest,
      created: false,
      outcome_manifest_path: existing.paths.manifest,
    };
  }
  const parsedBytes = parsedResponse
    ? Buffer.from(`${JSON.stringify(parsedResponse, null, 2)}\n`, "utf8")
    : null;
  const artifacts = {
    raw_response: rawResponseBytes
      ? {
          relative_path: "raw-response.md",
          raw_sha256: sha256Bytes(rawResponseBytes),
          bytes: rawResponseBytes.length,
        }
      : null,
    parsed_response: parsedBytes
      ? {
          relative_path: "parsed-response.json",
          raw_sha256: sha256Bytes(parsedBytes),
          bytes: parsedBytes.length,
        }
      : null,
    broker_receipt: brokerReceiptBytes
      ? {
          relative_path: "broker-receipt.json",
          raw_sha256: sha256Bytes(brokerReceiptBytes),
          bytes: brokerReceiptBytes.length,
        }
      : null,
  };
  const core = {
    schema_version: OUTCOME_SCHEMA,
    mode: MODE,
    ...outcomeCore,
    request_id: request.request_id,
    packet_id: request.packet_id,
    story_id: request.story_id,
    lane_id: request.lane_id,
    candidate_revision_sha256:
      request.candidate_revision_sha256,
    request_sha256: request.request_sha256,
    artifacts,
    broker_provenance: brokerProvenance,
    fallback_action:
      outcomeCore.status === "CRITIQUE_READY"
        ? null
        : "CONTINUE_WITH_NORMAL_INTERNAL_QA",
    publish_gate: false,
    safety: safetyBoundary(),
  };
  const manifest = {
    ...core,
    outcome_sha256: sha256Canonical(core),
  };
  const finalPaths = outcomePaths(queueRoot, request.request_id);
  const staging = path.join(
    queueRoot,
    ".staging",
    `outcome-${finalPaths.key}-${crypto.randomUUID()}`,
  );
  await fs.mkdir(staging, { recursive: false });
  let created = false;
  try {
    if (rawResponseBytes) {
      await fs.writeFile(
        path.join(staging, "raw-response.md"),
        rawResponseBytes,
        { flag: "wx" },
      );
    }
    if (parsedBytes) {
      await fs.writeFile(
        path.join(staging, "parsed-response.json"),
        parsedBytes,
        { flag: "wx" },
      );
    }
    if (brokerReceiptBytes) {
      await fs.writeFile(
        path.join(staging, "broker-receipt.json"),
        brokerReceiptBytes,
        { flag: "wx" },
      );
    }
    await fs.writeFile(
      path.join(staging, "outcome.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    try {
      await fs.rename(staging, finalPaths.root);
      created = true;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  const published = await readOutcomeManifest(
    queueRoot,
    request.request_id,
  );
  return {
    ...published.manifest,
    created,
    outcome_manifest_path: published.paths.manifest,
  };
}

async function archiveLateResponse({
  queueRoot,
  request,
  terminalOutcome,
  rawResponseBytes,
  receivedAt,
}) {
  const rawSha256 = sha256Bytes(rawResponseBytes);
  const finalRoot = path.join(
    queueRoot,
    "late",
    requestKey(request.request_id),
    rawSha256,
  );
  const manifestPath = path.join(finalRoot, "late-response.json");
  await assertNoPathLinks(
    { allowedRoot: queueRoot, resolved: manifestPath },
    "late_response",
  );
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    const { late_receipt_sha256: declared, ...core } = existing;
    if (
      existing?.schema_version !==
        "pulse-external-creative-critic-late-response-v1" ||
      sha256Canonical(core) !== declared
    ) {
      throw new Error("critic_queue_late_receipt_integrity_invalid");
    }
    const bytes = await fs.readFile(
      path.join(finalRoot, "raw-response.md"),
    );
    if (sha256Bytes(bytes) !== existing.raw_response_sha256) {
      throw new Error("critic_queue_late_artifact_integrity_invalid");
    }
    return { ...existing, created: false, late_receipt_path: manifestPath };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const core = {
    schema_version: "pulse-external-creative-critic-late-response-v1",
    mode: MODE,
    status: "LATE_RESPONSE_IGNORED",
    request_id: request.request_id,
    packet_id: request.packet_id,
    story_id: request.story_id,
    lane_id: request.lane_id,
    received_at: receivedAt,
    deadline_at: request.deadline_at,
    terminal_outcome_status: terminalOutcome.status,
    terminal_outcome_sha256: terminalOutcome.outcome_sha256,
    raw_response_sha256: rawSha256,
    raw_response_bytes: rawResponseBytes.length,
    publish_gate: false,
    safety: safetyBoundary(),
  };
  const receipt = {
    ...core,
    late_receipt_sha256: sha256Canonical(core),
  };
  const staging = path.join(
    queueRoot,
    ".staging",
    `late-${requestKey(request.request_id)}-${crypto.randomUUID()}`,
  );
  await fs.mkdir(staging, { recursive: false });
  let created = false;
  try {
    await fs.writeFile(
      path.join(staging, "raw-response.md"),
      rawResponseBytes,
      { flag: "wx" },
    );
    await fs.writeFile(
      path.join(staging, "late-response.json"),
      `${JSON.stringify(receipt, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    await fs.mkdir(path.dirname(finalRoot), { recursive: true });
    try {
      await fs.rename(staging, finalRoot);
      created = true;
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  const published = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  return {
    ...published,
    created,
    late_receipt_path: manifestPath,
  };
}

function safetyBoundary() {
  return {
    advisory_only: true,
    network_used: false,
    browser_or_ui_used: false,
    database_mutation_authority: false,
    oauth_or_token_authority: false,
    scheduler_authority: false,
    publish_authority: false,
  };
}

async function enqueueExternalCreativeCriticRequest({
  queueRoot,
  input,
  laneId,
  candidateRevisionSha256,
  now = new Date().toISOString(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  allowedRoots,
} = {}) {
  const descriptor = await resolveQueueRoot(queueRoot, allowedRoots);
  const createdAt = asIso(now, "critic_queue_now");
  const timeout = Number(timeoutMs);
  if (
    !Number.isInteger(timeout) ||
    timeout < MIN_TIMEOUT_MS ||
    timeout > MAX_TIMEOUT_MS
  ) {
    throw new Error("critic_queue_timeout_ms_invalid");
  }
  const lane = String(laneId || "").trim();
  if (!/^[a-z][a-z0-9_]{1,63}$/.test(lane)) {
    throw new Error("critic_queue_lane_id_invalid");
  }
  const revision = normaliseSha256(
    candidateRevisionSha256,
    "critic_queue_candidate_revision_sha256",
  );
  const packet = buildExternalCreativeCriticPacket(input);
  const identity = {
    packet_id: packet.packet_id,
    story_id: packet.story.id,
    lane_id: lane,
    candidate_revision_sha256: revision,
  };
  const requestId = sha256Canonical(identity);
  await ensureQueueDirectories(descriptor.resolved);
  await assertNoPathLinks(descriptor, "queue_root");

  try {
    const existing = await readRequestManifest(descriptor.resolved, requestId);
    return {
      ...existing.manifest,
      created: false,
      request_manifest_path: existing.paths.manifest,
    };
  } catch (error) {
    if (error.message !== "critic_queue_request_not_found") throw error;
  }

  const packetBytes = Buffer.from(`${JSON.stringify(packet, null, 2)}\n`, "utf8");
  const promptBytes = Buffer.from(`${packet.prompt}\n`, "utf8");
  const deadlineAt = new Date(
    Date.parse(createdAt) + timeout,
  ).toISOString();
  const manifestCore = {
    schema_version: REQUEST_SCHEMA,
    mode: MODE,
    status: "REQUESTED",
    request_id: requestId,
    packet_id: packet.packet_id,
    story_id: packet.story.id,
    lane_id: lane,
    candidate_revision_sha256: revision,
    created_at: createdAt,
    deadline_at: deadlineAt,
    timeout_ms: timeout,
    artifacts: {
      packet: {
        relative_path: "packet.json",
        raw_sha256: sha256Bytes(packetBytes),
      },
      prompt: {
        relative_path: "prompt.txt",
        raw_sha256: sha256Bytes(promptBytes),
      },
    },
    fallback: {
      on_timeout: "CONTINUE_WITH_NORMAL_INTERNAL_QA",
      on_invalid_response: "CONTINUE_WITH_NORMAL_INTERNAL_QA",
      publish_gate: false,
    },
    safety: safetyBoundary(),
  };
  const manifest = {
    ...manifestCore,
    request_sha256: sha256Canonical(manifestCore),
  };
  const staging = path.join(
    descriptor.resolved,
    ".staging",
    `request-${requestKey(requestId)}-${crypto.randomUUID()}`,
  );
  const finalPaths = requestPaths(descriptor.resolved, requestId);
  await fs.mkdir(staging, { recursive: false });
  try {
    await fs.writeFile(path.join(staging, "packet.json"), packetBytes, {
      flag: "wx",
    });
    await fs.writeFile(path.join(staging, "prompt.txt"), promptBytes, {
      flag: "wx",
    });
    await fs.writeFile(
      path.join(staging, "request-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
    );
    try {
      await fs.rename(staging, finalPaths.root);
    } catch (error) {
      if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code)) throw error;
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
  const published = await readRequestManifest(descriptor.resolved, requestId);
  return {
    ...published.manifest,
    created:
      published.manifest.created_at === createdAt &&
      published.manifest.deadline_at === deadlineAt,
    request_manifest_path: published.paths.manifest,
  };
}

async function getExternalCreativeCriticQueueStatus({
  queueRoot,
  requestId,
  allowedRoots,
} = {}) {
  const descriptor = await resolveQueueRoot(queueRoot, allowedRoots);
  await assertNoPathLinks(descriptor, "queue_root");
  const { manifest, paths } = await readRequestManifest(
    descriptor.resolved,
    String(requestId || "").trim().toLowerCase(),
  );
  const outcome = await readOutcomeManifest(
    descriptor.resolved,
    manifest.request_id,
  );
  if (outcome) {
    return {
      ...outcome.manifest,
      created: false,
      request_manifest_path: paths.manifest,
      outcome_manifest_path: outcome.paths.manifest,
    };
  }
  let responseReady = false;
  try {
    const responseStats = await fs.lstat(
      inboxResponsePath(descriptor.resolved, manifest.request_id),
    );
    if (responseStats.isSymbolicLink()) {
      throw new Error("critic_queue_path_link_forbidden:inbox_response");
    }
    if (!responseStats.isFile()) {
      throw new Error("critic_queue_regular_file_required:inbox_response");
    }
    responseReady = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return {
    ...manifest,
    response_ready: responseReady,
    response_inbox_path: inboxResponsePath(
      descriptor.resolved,
      manifest.request_id,
    ),
    request_manifest_path: paths.manifest,
  };
}

async function acquireResponseStageLock({
  queueRoot,
  requestId,
  waitMs = DEFAULT_STAGE_LOCK_WAIT_MS,
  staleMs = DEFAULT_STAGE_LOCK_STALE_MS,
}) {
  const lockPath = path.join(
    queueRoot,
    ".staging",
    `${requestKey(requestId)}.response-stage.lock`,
  );
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  while (true) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        `${JSON.stringify({
          token,
          created_at: new Date().toISOString(),
        })}\n`,
        "utf8",
      );
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await fs.readFile(lockPath, "utf8"));
          if (current?.token === token) {
            await fs.rm(lockPath, { force: true });
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stats = await fs.lstat(lockPath);
        if (stats.isSymbolicLink() || !stats.isFile()) {
          throw new Error(
            "critic_queue_response_stage_lock_invalid",
          );
        }
        if (Date.now() - stats.mtimeMs > staleMs) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (inspectionError) {
        if (inspectionError.code === "ENOENT") continue;
        throw inspectionError;
      }
      if (Date.now() - startedAt >= waitMs) {
        throw new Error("critic_queue_response_stage_busy");
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

async function stageExternalCreativeCriticResponseUnlocked({
  queueRoot,
  requestId,
  responsePath,
  brokerReceiptPath,
  allowedRoots,
  maximumResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  maximumBrokerReceiptBytes =
    DEFAULT_MAX_BROKER_RECEIPT_BYTES,
} = {}) {
  const descriptor = await resolveQueueRoot(queueRoot, allowedRoots);
  await assertNoPathLinks(descriptor, "queue_root");
  const normalisedRequestId = String(requestId || "")
    .trim()
    .toLowerCase();
  const { manifest: request } = await readRequestManifest(
    descriptor.resolved,
    normalisedRequestId,
  );
  const source = await readBoundedRegularFile(responsePath, {
    label: "response",
    allowedRoots,
    maximumBytes: maximumResponseBytes,
  });
  const rawResponseSha256 = sha256Bytes(source.bytes);
  const brokerReceipt = brokerReceiptPath
    ? await readBrokerReceipt({
        filePath: brokerReceiptPath,
        request,
        responseRawSha256: rawResponseSha256,
        allowedRoots,
        maximumBytes: maximumBrokerReceiptBytes,
      })
    : null;
  const destination = inboxResponsePath(
    descriptor.resolved,
    normalisedRequestId,
  );
  const receiptDestination = inboxBrokerReceiptPath(
    descriptor.resolved,
    normalisedRequestId,
  );
  try {
    const existingResponse = await readBoundedRegularFile(
      destination,
      {
        label: "inbox_response",
        allowedRoots: [descriptor.resolved],
        maximumBytes: maximumResponseBytes,
      },
    );
    if (!existingResponse.bytes.equals(source.bytes)) {
      throw new Error("critic_queue_response_collision");
    }
    if (brokerReceipt) {
      let existingReceipt;
      try {
        existingReceipt = await readBoundedRegularFile(
          receiptDestination,
          {
            label: "inbox_broker_receipt",
            allowedRoots: [descriptor.resolved],
            maximumBytes: maximumBrokerReceiptBytes,
          },
        );
      } catch (error) {
        if (error.code === "ENOENT") {
          throw new Error(
            "critic_queue_broker_receipt_after_response_ready_forbidden",
          );
        }
        throw error;
      }
      if (!existingReceipt.bytes.equals(brokerReceipt.bytes)) {
        throw new Error("critic_queue_broker_receipt_collision");
      }
    }
    return {
      schema_version:
        "pulse-external-creative-critic-queue-response-ready-v1",
      mode: MODE,
      status: "RESPONSE_READY",
      request_id: normalisedRequestId,
      response_inbox_path: destination,
      raw_response_sha256: rawResponseSha256,
      bytes: source.bytes.length,
      broker_receipt: brokerReceipt
        ? {
            path: receiptDestination,
            raw_sha256: sha256Bytes(brokerReceipt.bytes),
            bytes: brokerReceipt.bytes.length,
            provenance: brokerReceipt.provenance,
          }
        : null,
      created: false,
      network_used: false,
      browser_or_ui_used: false,
      database_mutation_authority: false,
      oauth_or_token_authority: false,
      scheduler_authority: false,
      publish_authority: false,
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const temporaryResponse = path.join(
    descriptor.resolved,
    "inbox",
    `.${requestKey(normalisedRequestId)}-${crypto.randomUUID()}.response.tmp`,
  );
  const temporaryReceipt = path.join(
    descriptor.resolved,
    "inbox",
    `.${requestKey(normalisedRequestId)}-${crypto.randomUUID()}.receipt.tmp`,
  );
  await fs.writeFile(temporaryResponse, source.bytes, { flag: "wx" });
  if (brokerReceipt) {
    await fs.writeFile(temporaryReceipt, brokerReceipt.bytes, {
      flag: "wx",
    });
  }
  let created = false;
  try {
    if (brokerReceipt) {
      try {
        await fs.rename(temporaryReceipt, receiptDestination);
      } catch (error) {
        if (!["EEXIST", "EPERM"].includes(error.code)) throw error;
        const existing = await readBoundedRegularFile(
          receiptDestination,
          {
            label: "inbox_broker_receipt",
            allowedRoots: [descriptor.resolved],
            maximumBytes: maximumBrokerReceiptBytes,
          },
        );
        if (!existing.bytes.equals(brokerReceipt.bytes)) {
          throw new Error("critic_queue_broker_receipt_collision");
        }
      }
    }
    try {
      await fs.rename(temporaryResponse, destination);
      created = true;
    } catch (error) {
      if (!["EEXIST", "EPERM"].includes(error.code)) throw error;
      const existing = await readBoundedRegularFile(destination, {
        label: "inbox_response",
        allowedRoots: [descriptor.resolved],
        maximumBytes: maximumResponseBytes,
      });
      if (!existing.bytes.equals(source.bytes)) {
        throw new Error("critic_queue_response_collision");
      }
    }
  } finally {
    await Promise.all([
      fs.rm(temporaryResponse, { force: true }),
      fs.rm(temporaryReceipt, { force: true }),
    ]);
  }
  return {
    schema_version:
      "pulse-external-creative-critic-queue-response-ready-v1",
    mode: MODE,
    status: "RESPONSE_READY",
    request_id: normalisedRequestId,
    response_inbox_path: destination,
    raw_response_sha256: rawResponseSha256,
    bytes: source.bytes.length,
    broker_receipt: brokerReceipt
      ? {
          path: receiptDestination,
          raw_sha256: sha256Bytes(brokerReceipt.bytes),
          bytes: brokerReceipt.bytes.length,
          provenance: brokerReceipt.provenance,
        }
      : null,
    created,
    network_used: false,
    browser_or_ui_used: false,
    database_mutation_authority: false,
    oauth_or_token_authority: false,
    scheduler_authority: false,
    publish_authority: false,
  };
}

async function stageExternalCreativeCriticResponse(options = {}) {
  const descriptor = await resolveQueueRoot(
    options.queueRoot,
    options.allowedRoots,
  );
  await ensureQueueDirectories(descriptor.resolved);
  await assertNoPathLinks(descriptor, "queue_root");
  const normalisedRequestId = String(options.requestId || "")
    .trim()
    .toLowerCase();
  const release = await acquireResponseStageLock({
    queueRoot: descriptor.resolved,
    requestId: normalisedRequestId,
  });
  try {
    return await stageExternalCreativeCriticResponseUnlocked({
      ...options,
      queueRoot: descriptor.resolved,
      requestId: normalisedRequestId,
    });
  } finally {
    await release();
  }
}

async function ingestExternalCreativeCriticResponse({
  queueRoot,
  requestId,
  responsePath,
  brokerReceiptPath,
  now = new Date().toISOString(),
  allowedRoots,
  maximumResponseBytes = DEFAULT_MAX_RESPONSE_BYTES,
  maximumBrokerReceiptBytes =
    DEFAULT_MAX_BROKER_RECEIPT_BYTES,
} = {}) {
  const descriptor = await resolveQueueRoot(queueRoot, allowedRoots);
  await assertNoPathLinks(descriptor, "queue_root");
  const normalisedRequestId = String(requestId || "")
    .trim()
    .toLowerCase();
  const { manifest: request, paths } = await readRequestManifest(
    descriptor.resolved,
    normalisedRequestId,
  );
  const receivedAt = asIso(now, "critic_queue_now");
  const existing = await readOutcomeManifest(
    descriptor.resolved,
    normalisedRequestId,
  );
  if (existing) {
    const source = await readBoundedRegularFile(responsePath, {
      label: "response",
      allowedRoots,
      maximumBytes: maximumResponseBytes,
    });
    if (
      existing.manifest.status === "CRITIQUE_READY" &&
      existing.manifest.raw_response_sha256 ===
        sha256Bytes(source.bytes)
    ) {
      return {
        ...existing.manifest,
        created: false,
        request_manifest_path: paths.manifest,
        outcome_manifest_path: existing.paths.manifest,
      };
    }
    return archiveLateResponse({
      queueRoot: descriptor.resolved,
      request,
      terminalOutcome: existing.manifest,
      rawResponseBytes: source.bytes,
      receivedAt,
    });
  }
  if (Date.parse(receivedAt) >= Date.parse(request.deadline_at)) {
    const timedOut = await publishOutcome({
      queueRoot: descriptor.resolved,
      request,
      outcomeCore: {
        status: "TIMED_OUT_FALLBACK",
        resolved_at: receivedAt,
        fallback_reason: "critic_response_deadline_elapsed",
        raw_response_sha256: null,
        parsed_response_sha256: null,
        critic_verdict: null,
        blocking_error_count: null,
      },
    });
    const source = await readBoundedRegularFile(responsePath, {
      label: "response",
      allowedRoots,
      maximumBytes: maximumResponseBytes,
    });
    if (
      timedOut.status === "CRITIQUE_READY" &&
      timedOut.raw_response_sha256 === sha256Bytes(source.bytes)
    ) {
      return timedOut;
    }
    return archiveLateResponse({
      queueRoot: descriptor.resolved,
      request,
      terminalOutcome: timedOut,
      rawResponseBytes: source.bytes,
      receivedAt,
    });
  }
  const source = await readBoundedRegularFile(responsePath, {
    label: "response",
    allowedRoots,
    maximumBytes: maximumResponseBytes,
  });
  const rawResponseSha256 = sha256Bytes(source.bytes);
  const brokerReceipt = brokerReceiptPath
    ? await readBrokerReceipt({
        filePath: brokerReceiptPath,
        request,
        responseRawSha256: rawResponseSha256,
        allowedRoots,
        maximumBytes: maximumBrokerReceiptBytes,
      })
    : null;
  const packet = JSON.parse(
    await fs.readFile(
      requestPaths(descriptor.resolved, request.request_id).packet,
      "utf8",
    ),
  );
  let parsed;
  try {
    const responseMarkdown = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(source.bytes);
    parsed = parseExternalCreativeCriticResponse({
      packet,
      response_markdown: responseMarkdown,
    });
  } catch (error) {
    const message = String(error.message || error);
    const validationError =
      /^critic_(?:response|queue_response_utf8)_/.test(message)
        ? message
        : "critic_response_invalid";
    return publishOutcome({
      queueRoot: descriptor.resolved,
      request,
      rawResponseBytes: source.bytes,
      brokerReceiptBytes: brokerReceipt?.bytes || null,
      brokerProvenance: brokerReceipt?.provenance || null,
      outcomeCore: {
        status: "INVALID_RESPONSE_FALLBACK",
        resolved_at: receivedAt,
        fallback_reason: "critic_response_validation_failed",
        validation_error: validationError,
        raw_response_sha256: rawResponseSha256,
        parsed_response_sha256: null,
        critic_verdict: null,
        blocking_error_count: null,
      },
    });
  }
  return publishOutcome({
    queueRoot: descriptor.resolved,
    request,
    rawResponseBytes: source.bytes,
    parsedResponse: parsed,
    brokerReceiptBytes: brokerReceipt?.bytes || null,
    brokerProvenance: brokerReceipt?.provenance || null,
    outcomeCore: {
      status: "CRITIQUE_READY",
      resolved_at: receivedAt,
      raw_response_sha256: rawResponseSha256,
      parsed_response_sha256: parsed.response_sha256,
      critic_verdict: parsed.verdict,
      blocking_error_count: parsed.blocking_errors.length,
    },
  });
}

async function sweepExternalCreativeCriticQueue({
  queueRoot,
  now = new Date().toISOString(),
  allowedRoots,
} = {}) {
  const descriptor = await resolveQueueRoot(queueRoot, allowedRoots);
  const generatedAt = asIso(now, "critic_queue_now");
  await ensureQueueDirectories(descriptor.resolved);
  await assertNoPathLinks(descriptor, "queue_root");
  const entries = await fs.readdir(
    path.join(descriptor.resolved, "requests"),
    { withFileTypes: true },
  );
  const result = {
    schema_version: "pulse-external-creative-critic-queue-sweep-v1",
    mode: MODE,
    generated_at: generatedAt,
    requested: 0,
    critique_ready: 0,
    timed_out: 0,
    invalid_response: 0,
    already_terminal: 0,
    errors: [],
    outcomes: [],
    safety: safetyBoundary(),
  };
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (!/^[a-f0-9]{64}$/.test(entry.name) || !entry.isDirectory()) {
      if (entry.isSymbolicLink()) {
        result.errors.push({
          entry: entry.name,
          error: "critic_queue_request_link_forbidden",
        });
      }
      continue;
    }
    const requestId = `sha256:${entry.name}`;
    try {
      const { manifest: request } = await readRequestManifest(
        descriptor.resolved,
        requestId,
      );
      const existing = await readOutcomeManifest(
        descriptor.resolved,
        requestId,
      );
      if (existing) {
        result.already_terminal += 1;
        result.outcomes.push(existing.manifest);
        continue;
      }
      if (Date.parse(generatedAt) < Date.parse(request.deadline_at)) {
        const readyPath = inboxResponsePath(
          descriptor.resolved,
          requestId,
        );
        try {
          await fs.lstat(readyPath);
          const stagedBrokerReceiptPath =
            inboxBrokerReceiptPath(
              descriptor.resolved,
              requestId,
            );
          let brokerReceiptPath;
          try {
            await fs.lstat(stagedBrokerReceiptPath);
            brokerReceiptPath = stagedBrokerReceiptPath;
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
          const outcome =
            await ingestExternalCreativeCriticResponse({
              queueRoot: descriptor.resolved,
              requestId,
              responsePath: readyPath,
              brokerReceiptPath,
              now: generatedAt,
              allowedRoots,
            });
          if (outcome.status === "CRITIQUE_READY") {
            result.critique_ready += 1;
          } else if (
            outcome.status === "INVALID_RESPONSE_FALLBACK"
          ) {
            result.invalid_response += 1;
          }
          result.outcomes.push(outcome);
          continue;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        result.requested += 1;
        continue;
      }
      const outcome = await publishOutcome({
        queueRoot: descriptor.resolved,
        request,
        outcomeCore: {
          status: "TIMED_OUT_FALLBACK",
          resolved_at: generatedAt,
          fallback_reason: "critic_response_deadline_elapsed",
          raw_response_sha256: null,
          parsed_response_sha256: null,
          critic_verdict: null,
          blocking_error_count: null,
        },
      });
      if (outcome.status === "TIMED_OUT_FALLBACK") {
        result.timed_out += 1;
      } else {
        result.already_terminal += 1;
      }
      result.outcomes.push(outcome);
    } catch (error) {
      result.errors.push({
        request_id: requestId,
        error: String(error.message || error),
      });
    }
  }
  return result;
}

module.exports = {
  BROKER_RECEIPT_SCHEMA,
  DEFAULT_MAX_BROKER_RECEIPT_BYTES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  OUTCOME_SCHEMA,
  REQUEST_SCHEMA,
  defaultAllowedRoots,
  enqueueExternalCreativeCriticRequest,
  getExternalCreativeCriticQueueStatus,
  ingestExternalCreativeCriticResponse,
  readExternalCreativeCriticQueueJsonInput,
  stageExternalCreativeCriticResponse,
  sweepExternalCreativeCriticQueue,
};
