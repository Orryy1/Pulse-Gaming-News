"use strict";

const crypto = require("node:crypto");

const {
  canonicalHash,
  canonicalUrl,
} = require("./url-canonical");

const SCHEMA_VERSION =
  "pulse-governed-autonomous-database-story-binding-v1";
const STORY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const FIELDS = Object.freeze([
  "binding_sha256",
  "canonical_identity_url",
  "canonical_story_id",
  "database_story_id",
  "final_script_sha256",
  "inventory_file_sha256",
  "schema_version",
]);

class GovernedAutonomousDatabaseStoryBindingError extends Error {
  constructor(code) {
    super(code);
    this.name =
      "GovernedAutonomousDatabaseStoryBindingError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedAutonomousDatabaseStoryBindingError(code);
}

function text(value) {
  return String(value ?? "").trim();
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

function exactStoryId(value, code) {
  const storyId = text(value);
  if (!STORY_ID_PATTERN.test(storyId)) fail(code);
  return storyId;
}

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactIdentityUrl(value) {
  const supplied = text(value);
  let parsed;
  try {
    parsed = new URL(supplied);
  } catch {
    fail("autonomous_database_story_binding_identity_url_invalid");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443") ||
    !canonicalUrl(supplied)
  ) {
    fail("autonomous_database_story_binding_identity_url_invalid");
  }
  return supplied;
}

function bindingBody(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail("autonomous_database_story_binding_invalid");
  }
  const canonicalStoryId = exactStoryId(
    value.canonical_story_id,
    "autonomous_database_story_binding_canonical_story_id_invalid",
  );
  const canonicalIdentityUrl = exactIdentityUrl(
    value.canonical_identity_url,
  );
  if (
    canonicalStoryId.startsWith("official_") &&
    canonicalStoryId !==
      `official_${canonicalHash(canonicalIdentityUrl)}`
  ) {
    fail("autonomous_database_story_binding_identity_mismatch");
  }
  return {
    schema_version: SCHEMA_VERSION,
    canonical_story_id: canonicalStoryId,
    database_story_id: exactStoryId(
      value.database_story_id,
      "autonomous_database_story_binding_database_story_id_invalid",
    ),
    canonical_identity_url: canonicalIdentityUrl,
    inventory_file_sha256: exactSha256(
      value.inventory_file_sha256,
      "autonomous_database_story_binding_inventory_sha256_invalid",
    ),
    final_script_sha256: exactSha256(
      value.final_script_sha256,
      "autonomous_database_story_binding_script_sha256_invalid",
    ),
  };
}

function createGovernedAutonomousDatabaseStoryBinding(value) {
  const body = bindingBody(value);
  return Object.freeze({
    ...body,
    binding_sha256: canonicalSha256(body),
  });
}

function validateGovernedAutonomousDatabaseStoryBinding(
  value,
  expected = {},
) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== FIELDS.length ||
    Object.keys(value).some((field) => !FIELDS.includes(field)) ||
    value.schema_version !== SCHEMA_VERSION
  ) {
    fail("autonomous_database_story_binding_invalid");
  }
  const body = bindingBody(value);
  const supplied = exactSha256(
    value.binding_sha256,
    "autonomous_database_story_binding_sha256_invalid",
  );
  if (canonicalSha256(body) !== supplied) {
    fail("autonomous_database_story_binding_sha256_mismatch");
  }
  const binding = {
    ...body,
    binding_sha256: supplied,
  };
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (
      expectedValue !== undefined &&
      binding[field] !== expectedValue
    ) {
      fail("autonomous_database_story_binding_expected_value_mismatch");
    }
  }
  return Object.freeze(binding);
}

module.exports = {
  GovernedAutonomousDatabaseStoryBindingError,
  SCHEMA_VERSION,
  canonicalSha256,
  createGovernedAutonomousDatabaseStoryBinding,
  validateGovernedAutonomousDatabaseStoryBinding,
};
