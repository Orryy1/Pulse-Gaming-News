"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-reservation-set-request-v1";
const ARTIFACT_SCHEMA_VERSION =
  "pulse-governed-autonomous-window-reservation-set-v1";
const MODE = "LOCAL_PROOF";
const T90_OFFSET_MS = 90 * 60 * 1000;
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const REQUEST_FIELDS = Object.freeze([
  "channel_id",
  "generated_at",
  "lane_id",
  "mode",
  "output_path",
  "platform",
  "reservations",
  "scheduled_for",
  "schema_version",
  "workspace_root",
]);
const ARTIFACT_FIELDS = Object.freeze([
  "binding_scope",
  "channel_id",
  "generated_at",
  "lane_id",
  "mode",
  "platform",
  "reservation_set_sha256",
  "reservations",
  "safety",
  "scheduled_for",
  "schema_version",
  "state",
]);
const RESERVATION_FIELDS = Object.freeze(["role", "story_id"]);
const SAFETY_FIELDS = Object.freeze([
  "database_authority",
  "database_mutated",
  "external_publish_authorised",
  "local_proof_only",
  "network_authority",
  "network_used",
  "oauth_or_token_authority",
  "oauth_or_tokens_mutated",
  "platform_contacted",
  "publish_authority",
  "scheduler_authority",
]);

class GovernedAutonomousWindowReservationSetError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedAutonomousWindowReservationSetError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousWindowReservationSetError(code);
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function text(value) {
  return String(value ?? "").trim();
}

function exactFields(value, expected, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((field, index) => field !== required[index])
  ) {
    fail(code);
  }
  return value;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .filter((field) => value[field] !== undefined)
        .sort()
        .map((field) => [field, stableValue(value[field])]),
    );
  }
  return value;
}

function canonicalSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const timestamp = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== raw
  ) {
    fail(code);
  }
  return { raw, timestamp, date: new Date(timestamp) };
}

function guardedWindow(value) {
  const parsed = exactTimestamp(
    value,
    "window_reservation_scheduled_for_invalid",
  );
  if (
    ![9, 19].includes(parsed.date.getUTCHours()) ||
    parsed.date.getUTCMinutes() !== 0 ||
    parsed.date.getUTCSeconds() !== 0 ||
    parsed.date.getUTCMilliseconds() !== 0
  ) {
    fail("window_reservation_guarded_window_required");
  }
  return parsed;
}

function exactStoryId(value) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) {
    fail("window_reservation_story_id_invalid");
  }
  return storyId;
}

function normaliseReservations(value) {
  if (!Array.isArray(value) || value.length !== 2) {
    fail("window_reservation_roles_invalid");
  }
  const byRole = new Map();
  for (const entry of value) {
    exactFields(
      entry,
      RESERVATION_FIELDS,
      "window_reservation_reservation_fields_invalid",
    );
    const role = text(entry.role).toUpperCase();
    if (!["PRIMARY", "STANDBY"].includes(role) || byRole.has(role)) {
      fail("window_reservation_roles_invalid");
    }
    byRole.set(role, exactStoryId(entry.story_id));
  }
  if (!byRole.has("PRIMARY") || !byRole.has("STANDBY")) {
    fail("window_reservation_roles_invalid");
  }
  if (byRole.get("PRIMARY") === byRole.get("STANDBY")) {
    fail("window_reservation_distinct_stories_required");
  }
  return [
    { role: "PRIMARY", story_id: byRole.get("PRIMARY") },
    { role: "STANDBY", story_id: byRole.get("STANDBY") },
  ];
}

function exactIdentity(value, code) {
  const channelId = text(value.channel_id);
  const laneId = text(value.lane_id);
  const platform = text(value.platform).toLowerCase();
  if (
    channelId !== "pulse-gaming" ||
    laneId !== "breaking_short" ||
    platform !== "youtube"
  ) {
    fail(code);
  }
  return { channel_id: channelId, lane_id: laneId, platform };
}

function exactTiming(value) {
  const generatedAt = exactTimestamp(
    value.generated_at,
    "window_reservation_generated_at_invalid",
  );
  const scheduledFor = guardedWindow(value.scheduled_for);
  if (
    generatedAt.timestamp >=
    scheduledFor.timestamp - T90_OFFSET_MS
  ) {
    fail("window_reservation_must_precede_t90");
  }
  return {
    generated_at: generatedAt.raw,
    scheduled_for: scheduledFor.raw,
  };
}

function validateSafety(value) {
  exactFields(
    value,
    SAFETY_FIELDS,
    "window_reservation_safety_fields_invalid",
  );
  for (const field of SAFETY_FIELDS) {
    const expected = field === "local_proof_only";
    if (value[field] !== expected) {
      fail(`window_reservation_${field}_forbidden`);
    }
  }
}

function validateGovernedAutonomousWindowReservationSet(value) {
  exactFields(
    value,
    ARTIFACT_FIELDS,
    "window_reservation_artifact_fields_invalid",
  );
  if (
    value.schema_version !== ARTIFACT_SCHEMA_VERSION ||
    value.mode !== MODE ||
    value.state !== "RESERVED_LOCAL_PROOF" ||
    value.binding_scope !== "WINDOW_STORY_ROLE_ONLY"
  ) {
    fail("window_reservation_local_proof_contract_invalid");
  }
  exactIdentity(
    value,
    "window_reservation_artifact_identity_invalid",
  );
  exactTiming(value);
  const reservations = normaliseReservations(value.reservations);
  if (
    canonicalSha256(reservations) !==
    canonicalSha256(value.reservations)
  ) {
    fail("window_reservation_roles_invalid");
  }
  validateSafety(value.safety);
  const supplied = text(value.reservation_set_sha256).toLowerCase();
  if (!SHA256_PATTERN.test(supplied)) {
    fail("window_reservation_sha256_invalid");
  }
  const body = { ...value };
  delete body.reservation_set_sha256;
  if (canonicalSha256(body) !== supplied) {
    fail("window_reservation_sha256_mismatch");
  }
  return JSON.parse(JSON.stringify(value));
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "window_reservation_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("window_reservation_local_proof_only");
  }
  const identity = exactIdentity(
    value,
    "window_reservation_request_identity_invalid",
  );
  const timing = exactTiming(value);
  const workspaceRoot = text(value.workspace_root);
  const outputPath = text(value.output_path);
  if (
    !workspaceRoot ||
    !path.isAbsolute(workspaceRoot) ||
    !outputPath ||
    !path.isAbsolute(outputPath) ||
    path.extname(outputPath).toLowerCase() !== ".json"
  ) {
    fail("window_reservation_path_invalid");
  }
  return {
    ...identity,
    ...timing,
    reservations: normaliseReservations(value.reservations),
    workspace_root: path.resolve(workspaceRoot),
    output_path: path.resolve(outputPath),
  };
}

function pathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function exactWorkspaceRoot(rootPath, fileSystem) {
  let stat;
  try {
    stat = await fileSystem.lstat(rootPath, { bigint: true });
  } catch {
    fail("window_reservation_workspace_root_invalid");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("window_reservation_workspace_root_invalid");
  }
  const realPath = path.resolve(await fileSystem.realpath(rootPath));
  if (realPath !== rootPath) {
    fail("window_reservation_workspace_root_link_forbidden");
  }
  return { path: rootPath, real_path: realPath };
}

async function ensureSafeParent(root, outputPath, fileSystem) {
  if (!pathWithin(root.path, outputPath) || outputPath === root.path) {
    fail("window_reservation_output_outside_workspace");
  }
  const parent = path.dirname(outputPath);
  const relative = path.relative(root.path, parent);
  let cursor = root.path;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try {
      await fileSystem.mkdir(cursor);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    const stat = await fileSystem.lstat(cursor, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("window_reservation_output_parent_invalid");
    }
    const realPath = path.resolve(await fileSystem.realpath(cursor));
    if (!pathWithin(root.real_path, realPath)) {
      fail("window_reservation_output_parent_invalid");
    }
  }
}

async function readExisting(outputPath, fileSystem) {
  const stat = await fileSystem.lstat(outputPath, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("window_reservation_output_file_invalid");
  }
  return fileSystem.readFile(outputPath);
}

async function writeIdempotently(outputPath, bytes, fileSystem) {
  try {
    const existing = await readExisting(outputPath, fileSystem);
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("window_reservation_output_conflict");
  } catch (error) {
    if (error instanceof GovernedAutonomousWindowReservationSetError) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  let handle;
  try {
    handle = await fileSystem.open(outputPath, "wx");
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const existing = await readExisting(outputPath, fileSystem);
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("window_reservation_output_conflict");
  } finally {
    await handle?.close();
  }
  return "CREATED";
}

async function materialiseGovernedAutonomousWindowReservationSet(
  value,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const request = normaliseRequest(value);
  const root = await exactWorkspaceRoot(
    request.workspace_root,
    fileSystem,
  );
  await ensureSafeParent(root, request.output_path, fileSystem);
  const body = {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    mode: MODE,
    state: "RESERVED_LOCAL_PROOF",
    // Candidate revision and request fingerprint do not exist safely at this
    // pre-production stage. Later evidence must bind them without rewriting
    // this story/role/window reservation.
    binding_scope: "WINDOW_STORY_ROLE_ONLY",
    generated_at: request.generated_at,
    scheduled_for: request.scheduled_for,
    channel_id: request.channel_id,
    lane_id: request.lane_id,
    platform: request.platform,
    reservations: request.reservations,
    safety: {
      local_proof_only: true,
      database_authority: false,
      database_mutated: false,
      network_authority: false,
      network_used: false,
      oauth_or_token_authority: false,
      oauth_or_tokens_mutated: false,
      platform_contacted: false,
      publish_authority: false,
      scheduler_authority: false,
      external_publish_authorised: false,
    },
  };
  const reservationSet =
    validateGovernedAutonomousWindowReservationSet({
      ...body,
      reservation_set_sha256: canonicalSha256(body),
    });
  const bytes = jsonBytes(reservationSet);
  const status = await writeIdempotently(
    request.output_path,
    bytes,
    fileSystem,
  );
  return Object.freeze({
    status,
    path: request.output_path,
    file_sha256: sha256Bytes(bytes),
    reservation_set: reservationSet,
    safety: reservationSet.safety,
  });
}

module.exports = {
  ARTIFACT_SCHEMA_VERSION,
  GovernedAutonomousWindowReservationSetError,
  MODE,
  REQUEST_SCHEMA_VERSION,
  canonicalSha256,
  materialiseGovernedAutonomousWindowReservationSet,
  validateGovernedAutonomousWindowReservationSet,
};
