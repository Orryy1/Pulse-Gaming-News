"use strict";

const crypto = require("node:crypto");
const defaultFileSystem = require("node:fs/promises");
const path = require("node:path");

const REQUEST_SCHEMA_VERSION =
  "pulse-autonomous-publication-metadata-request-v1";
const RESULT_SCHEMA_VERSION =
  "pulse-autonomous-publication-metadata-result-v1";
const METADATA_SCHEMA =
  "pulse-governed-publication-metadata-v1";
const MODE = "LOCAL_PROOF";
const AUTHORITY = "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUEST_FIELDS = new Set([
  "schema_version",
  "mode",
  "story_id",
  "channel_id",
  "platform",
  "generated_at",
  "root_dir",
  "output_path",
  "title",
  "description",
  "official_source_url",
  "required_attributions",
  "subject_terms",
  "evidence_bindings",
]);
const EVIDENCE_FIELDS = new Set([
  "source_evidence_sha256",
  "claim_map_sha256",
  "qa_report_sha256",
  "final_mp4_sha256",
]);
const INTERNAL_LANGUAGE =
  /\b(?:qa|canary|placeholder|internal|test video|draft|proof render|approval pending|publish candidate|manual review)\b/i;

class AutonomousPublicationMetadataMaterializerError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "AutonomousPublicationMetadataMaterializerError";
    this.code = code;
  }
}

function fail(code) {
  throw new AutonomousPublicationMetadataMaterializerError(code);
}

function text(value) {
  return String(value ?? "").trim();
}

function plainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactFields(value, fields, code) {
  if (!plainObject(value)) fail(code);
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
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

function exactTimestamp(value) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail("autonomous_metadata_generated_at_invalid");
  }
  return raw;
}

function exactOfficialUrl(value) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    fail("autonomous_metadata_official_source_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname ||
    parsed.hash
  ) {
    fail("autonomous_metadata_official_source_invalid");
  }
  return parsed.href;
}

function stringList(value, code, { minimum = 0 } = {}) {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.some((entry) => !text(entry))
  ) {
    fail(code);
  }
  const normalised = value.map(text);
  if (new Set(normalised).size !== normalised.length) fail(code);
  return normalised;
}

function exactEvidenceBindings(value) {
  exactFields(
    value,
    EVIDENCE_FIELDS,
    "autonomous_metadata_evidence_invalid",
  );
  const result = {};
  for (const field of EVIDENCE_FIELDS) {
    const hash = text(value[field]).toLowerCase();
    if (!SHA256_PATTERN.test(hash)) {
      fail("autonomous_metadata_evidence_invalid");
    }
    result[field] = hash;
  }
  if (new Set(Object.values(result)).size !== EVIDENCE_FIELDS.size) {
    fail("autonomous_metadata_evidence_invalid");
  }
  return result;
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

async function exactRoot(value, fileSystem) {
  const supplied = text(value);
  if (!supplied || !path.isAbsolute(supplied)) {
    fail("autonomous_metadata_root_invalid");
  }
  const root = path.resolve(supplied);
  let stat;
  try {
    stat = await fileSystem.lstat(root);
  } catch {
    fail("autonomous_metadata_root_missing");
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail("autonomous_metadata_root_invalid");
  }
  const real = await fileSystem.realpath(root);
  if (path.resolve(real) !== root) {
    fail("autonomous_metadata_root_link_forbidden");
  }
  return { path: root, real_path: real };
}

async function exactOutputParent(root, outputPath, fileSystem) {
  const parent = path.dirname(outputPath);
  await fileSystem.mkdir(parent, { recursive: true });
  if (!pathWithin(root.path, parent)) {
    fail("autonomous_metadata_output_outside_root");
  }
  const relative = path.relative(root.path, parent);
  let cursor = root.path;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    const stat = await fileSystem.lstat(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      fail("autonomous_metadata_output_parent_invalid");
    }
    const real = await fileSystem.realpath(cursor);
    if (!pathWithin(root.real_path, real)) {
      fail("autonomous_metadata_output_parent_invalid");
    }
  }
}

function normaliseRequest(value) {
  exactFields(
    value,
    REQUEST_FIELDS,
    "autonomous_metadata_request_fields_invalid",
  );
  if (
    value.schema_version !== REQUEST_SCHEMA_VERSION ||
    value.mode !== MODE
  ) {
    fail("autonomous_metadata_request_schema_invalid");
  }
  const storyId = text(value.story_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("autonomous_metadata_story_id_invalid");
  }
  if (
    text(value.channel_id) !== "pulse-gaming" ||
    text(value.platform) !== "youtube_shorts"
  ) {
    fail("autonomous_metadata_scope_invalid");
  }
  const title = text(value.title);
  const description = String(value.description ?? "").trim();
  if (
    title.length < 12 ||
    title.length > 100 ||
    /[\r\n\u0000-\u001f\u007f]/.test(title) ||
    !description ||
    description.length > 5000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)
  ) {
    fail("autonomous_metadata_copy_invalid");
  }
  if (
    INTERNAL_LANGUAGE.test(title) ||
    INTERNAL_LANGUAGE.test(description)
  ) {
    fail("autonomous_metadata_internal_language_forbidden");
  }
  const officialSourceUrl = exactOfficialUrl(
    value.official_source_url,
  );
  const attributions = stringList(
    value.required_attributions,
    "autonomous_metadata_attributions_invalid",
  );
  const subjectTerms = stringList(
    value.subject_terms,
    "autonomous_metadata_subject_terms_invalid",
    { minimum: 1 },
  );
  const titleLower = title.toLowerCase();
  if (
    !subjectTerms.some((term) =>
      titleLower.includes(term.toLowerCase()),
    )
  ) {
    fail("autonomous_metadata_title_subject_required");
  }
  const descriptionLines = new Set(
    description
      .split(/\r?\n/)
      .map(text)
      .filter(Boolean),
  );
  if (
    !descriptionLines.has(
      `Official source: ${officialSourceUrl}`,
    )
  ) {
    fail("autonomous_metadata_official_source_line_required");
  }
  if (
    attributions.some(
      (attribution) => !descriptionLines.has(attribution),
    )
  ) {
    fail("autonomous_metadata_attribution_line_required");
  }
  const rootDir = text(value.root_dir);
  const outputPath = text(value.output_path);
  if (
    !rootDir ||
    !path.isAbsolute(rootDir) ||
    !outputPath ||
    !path.isAbsolute(outputPath) ||
    path.extname(outputPath).toLowerCase() !== ".json"
  ) {
    fail("autonomous_metadata_output_invalid");
  }
  return {
    story_id: storyId,
    generated_at: exactTimestamp(value.generated_at),
    root_dir: path.resolve(rootDir),
    output_path: path.resolve(outputPath),
    title,
    description,
    official_source_url: officialSourceUrl,
    required_attributions: attributions,
    subject_terms: subjectTerms,
    evidence_bindings: exactEvidenceBindings(
      value.evidence_bindings,
    ),
  };
}

function metadataFor(request) {
  return stableValue({
    schema_version: METADATA_SCHEMA,
    story_id: request.story_id,
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: request.title,
    description: request.description,
    generated_at: request.generated_at,
    official_source_url: request.official_source_url,
    required_attributions: request.required_attributions,
    evidence_bindings: request.evidence_bindings,
    editorial_review: {
      method: AUTHORITY,
      title_approved: true,
      description_approved: true,
      attribution_approved: true,
    },
  });
}

async function writeIdempotently({
  outputPath,
  bytes,
  fileSystem,
}) {
  try {
    const existing = await fileSystem.readFile(outputPath);
    if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
    fail("autonomous_metadata_output_conflict");
  } catch (error) {
    if (
      error instanceof
      AutonomousPublicationMetadataMaterializerError
    ) {
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
    if (error?.code === "EEXIST") {
      const existing = await fileSystem.readFile(outputPath);
      if (Buffer.compare(existing, bytes) === 0) return "REPLAYED";
      fail("autonomous_metadata_output_conflict");
    }
    throw error;
  } finally {
    await handle?.close();
  }
  return "CREATED";
}

async function materialiseAutonomousPublicationMetadata(
  value,
  options = {},
) {
  const fileSystem = options.fileSystem || defaultFileSystem;
  const request = normaliseRequest(value);
  const root = await exactRoot(request.root_dir, fileSystem);
  if (!pathWithin(root.path, request.output_path)) {
    fail("autonomous_metadata_output_outside_root");
  }
  await exactOutputParent(root, request.output_path, fileSystem);
  try {
    const stat = await fileSystem.lstat(request.output_path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      fail("autonomous_metadata_output_invalid");
    }
  } catch (error) {
    if (
      error instanceof
      AutonomousPublicationMetadataMaterializerError
    ) {
      throw error;
    }
    if (error?.code !== "ENOENT") throw error;
  }
  const metadata = metadataFor(request);
  const bytes = Buffer.from(
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  const status = await writeIdempotently({
    outputPath: request.output_path,
    bytes,
    fileSystem,
  });
  const body = {
    schema_version: RESULT_SCHEMA_VERSION,
    status,
    generated_at: request.generated_at,
    story_id: request.story_id,
    path: request.output_path,
    file_sha256: sha256Bytes(bytes),
    metadata,
    metadata_evidence_sha256: canonicalSha256({
      story_id: request.story_id,
      evidence_bindings: request.evidence_bindings,
      official_source_url: request.official_source_url,
      required_attributions: request.required_attributions,
    }),
    safety: {
      publish_authority: false,
      external_publish_authorised: false,
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      network_used: false,
    },
  };
  return Object.freeze({
    ...body,
    result_sha256: canonicalSha256(body),
  });
}

module.exports = {
  AUTHORITY,
  AutonomousPublicationMetadataMaterializerError,
  METADATA_SCHEMA,
  MODE,
  REQUEST_SCHEMA_VERSION,
  RESULT_SCHEMA_VERSION,
  canonicalSha256,
  materialiseAutonomousPublicationMetadata,
};
