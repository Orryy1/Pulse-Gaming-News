"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION =
  "pulse-governed-fast-news-lane-decision-v1";
const POLICY_ID = "pulse-recent-official-fast-news-v1";
const SEMANTIC_CLASSIFICATION =
  "RECENT_OFFICIAL_FAST_NEWS";
const OPERATIONAL_LANE_ID = "breaking_short";
const MAXIMUM_AGE_MS = 72 * 60 * 60 * 1000;
const SOURCE_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_EXPLICIT_FORMATS = 32;
const MAX_FORMAT_LENGTH = 128;

const INPUT_FIELDS = new Set([
  "story_id",
  "evaluated_at",
  "scheduled_for",
  "source_published_at",
  "verification_status",
  "source_class",
  "inventory_file_sha256",
  "source_evidence_sha256",
  "explicit_formats",
]);

const DECISION_FIELDS = new Set([
  "schema_version",
  "policy_id",
  "decision",
  "semantic_classification",
  "operational_lane_id",
  "public_breaking_claim_authorised",
  "story_id",
  "evaluated_at",
  "scheduled_for",
  "source_published_at",
  "verification_status",
  "source_class",
  "inventory_file_sha256",
  "source_evidence_sha256",
  "explicit_formats",
  "maximum_age_ms",
  "basis",
  "decision_sha256",
]);

const EXPECTED_BINDING_FIELDS = new Set([
  "story_id",
  "scheduled_for",
  "operational_lane_id",
  "public_breaking_claim_authorised",
  "decision_sha256",
]);

const BASIS = Object.freeze([
  "CONFIRMED_SOURCE_EVIDENCE",
  "OFFICIAL_FIRST_PARTY_SOURCE",
  "SOURCE_WITHIN_72_HOURS_OF_SCHEDULED_WINDOW",
  "NO_EXPLICIT_LONGFORM_OR_EVERGREEN_FORMAT",
]);

class GovernedFastNewsLaneDecisionError extends Error {
  constructor(code) {
    super(code);
    this.name = "GovernedFastNewsLaneDecisionError";
    this.code = code;
  }
}

function fail(code) {
  throw new GovernedFastNewsLaneDecisionError(code);
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

function ownDataFields(value, code) {
  if (!plainObject(value)) fail(code);
  const fields = Reflect.ownKeys(value);
  if (
    fields.some((field) => typeof field !== "string") ||
    fields.some((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return (
        !descriptor ||
        !descriptor.enumerable ||
        !Object.hasOwn(descriptor, "value")
      );
    })
  ) {
    fail(code);
  }
  return fields;
}

function exactFields(value, expectedFields, code) {
  const actual = ownDataFields(value, code).sort();
  const expected = [...expectedFields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    fail(code);
  }
}

function expectedBinding(value) {
  if (value === undefined) return {};
  const fields = ownDataFields(
    value,
    "fast_news_expected_binding_fields_invalid",
  );
  if (
    fields.some((field) => !EXPECTED_BINDING_FIELDS.has(field))
  ) {
    fail("fast_news_expected_binding_fields_invalid");
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

function exactSha256(value, code) {
  const hash = text(value).toLowerCase();
  if (!SHA256_PATTERN.test(hash)) fail(code);
  return hash;
}

function exactTimestamp(value, code) {
  const raw = text(value);
  const parsed = Date.parse(raw);
  if (
    !raw ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== raw
  ) {
    fail(code);
  }
  return {
    iso: raw,
    milliseconds: parsed,
  };
}

function normaliseExplicitFormats(value) {
  if (
    !Array.isArray(value) ||
    value.length > MAX_EXPLICIT_FORMATS
  ) {
    fail("fast_news_explicit_formats_invalid");
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.some((field) => typeof field !== "string") ||
    ownKeys.some(
      (field) =>
        field !== "length" &&
        (!/^(0|[1-9]\d*)$/.test(field) ||
          Number(field) >= value.length),
    )
  ) {
    fail("fast_news_explicit_formats_invalid");
  }
  const formats = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      fail("fast_news_explicit_formats_invalid");
    }
    const raw = value[index];
    const format = typeof raw === "string"
      ? raw.trim().toLowerCase()
      : "";
    if (
      !format ||
      format.length > MAX_FORMAT_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(format)
    ) {
      fail("fast_news_explicit_formats_invalid");
    }
    const compact = format.replace(/[^a-z0-9]+/g, "");
    if (
      compact.includes("longform") ||
      compact.includes("evergreen")
    ) {
      fail("fast_news_explicit_format_forbidden");
    }
    formats.push(format);
  }
  return [...new Set(formats)].sort();
}

function deepFreeze(value) {
  if (
    value &&
    typeof value === "object" &&
    !Object.isFrozen(value)
  ) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function createGovernedFastNewsLaneDecision(input = {}) {
  exactFields(
    input,
    INPUT_FIELDS,
    "fast_news_input_fields_invalid",
  );

  const storyId = text(input.story_id);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(storyId)) {
    fail("fast_news_story_id_invalid");
  }

  const evaluatedAt = exactTimestamp(
    input.evaluated_at,
    "fast_news_evaluated_at_invalid",
  );
  const scheduledFor = exactTimestamp(
    input.scheduled_for,
    "fast_news_scheduled_for_invalid",
  );
  const sourcePublishedAt = exactTimestamp(
    input.source_published_at,
    "fast_news_source_published_at_invalid",
  );

  if (
    scheduledFor.milliseconds <= evaluatedAt.milliseconds
  ) {
    fail("fast_news_schedule_not_future");
  }
  if (
    sourcePublishedAt.milliseconds >
    evaluatedAt.milliseconds + SOURCE_FUTURE_TOLERANCE_MS
  ) {
    fail("fast_news_source_from_future");
  }
  if (
    sourcePublishedAt.milliseconds >
    scheduledFor.milliseconds
  ) {
    fail("fast_news_source_after_schedule");
  }
  if (
    scheduledFor.milliseconds -
      sourcePublishedAt.milliseconds >
    MAXIMUM_AGE_MS
  ) {
    fail("fast_news_source_stale");
  }

  const verificationStatus = text(
    input.verification_status,
  ).toUpperCase();
  if (verificationStatus !== "CONFIRMED") {
    fail("fast_news_verification_status_invalid");
  }
  const sourceClass = text(input.source_class).toUpperCase();
  if (sourceClass !== "OFFICIAL_FIRST_PARTY") {
    fail("fast_news_source_class_invalid");
  }

  const body = stableValue({
    schema_version: SCHEMA_VERSION,
    policy_id: POLICY_ID,
    decision: "ELIGIBLE",
    semantic_classification: SEMANTIC_CLASSIFICATION,
    operational_lane_id: OPERATIONAL_LANE_ID,
    public_breaking_claim_authorised: false,
    story_id: storyId,
    evaluated_at: evaluatedAt.iso,
    scheduled_for: scheduledFor.iso,
    source_published_at: sourcePublishedAt.iso,
    verification_status: verificationStatus,
    source_class: sourceClass,
    inventory_file_sha256: exactSha256(
      input.inventory_file_sha256,
      "fast_news_inventory_file_sha256_invalid",
    ),
    source_evidence_sha256: exactSha256(
      input.source_evidence_sha256,
      "fast_news_source_evidence_sha256_invalid",
    ),
    explicit_formats: normaliseExplicitFormats(
      input.explicit_formats,
    ),
    maximum_age_ms: MAXIMUM_AGE_MS,
    basis: [...BASIS],
  });

  return deepFreeze({
    ...body,
    decision_sha256: canonicalSha256(body),
  });
}

function validateGovernedFastNewsLaneDecision(
  value,
  expected,
) {
  exactFields(
    value,
    DECISION_FIELDS,
    "fast_news_decision_fields_invalid",
  );
  const suppliedSha256 = exactSha256(
    value.decision_sha256,
    "fast_news_decision_sha256_invalid",
  );
  const {
    decision_sha256: _decisionSha256,
    ...suppliedBody
  } = value;
  if (canonicalSha256(suppliedBody) !== suppliedSha256) {
    fail("fast_news_decision_sha256_mismatch");
  }

  const recreated =
    createGovernedFastNewsLaneDecision({
      story_id: value.story_id,
      evaluated_at: value.evaluated_at,
      scheduled_for: value.scheduled_for,
      source_published_at: value.source_published_at,
      verification_status: value.verification_status,
      source_class: value.source_class,
      inventory_file_sha256: value.inventory_file_sha256,
      source_evidence_sha256: value.source_evidence_sha256,
      explicit_formats: value.explicit_formats,
    });
  if (
    JSON.stringify(stableValue(recreated)) !==
    JSON.stringify(stableValue(value))
  ) {
    fail("fast_news_decision_recreation_mismatch");
  }

  const binding = expectedBinding(expected);
  for (const [field, expectedValue] of Object.entries(binding)) {
    if (recreated[field] !== expectedValue) {
      fail("fast_news_expected_binding_mismatch");
    }
  }
  return recreated;
}

module.exports = {
  BASIS,
  GovernedFastNewsLaneDecisionError,
  MAXIMUM_AGE_MS,
  OPERATIONAL_LANE_ID,
  POLICY_ID,
  SCHEMA_VERSION,
  SEMANTIC_CLASSIFICATION,
  SOURCE_FUTURE_TOLERANCE_MS,
  canonicalSha256,
  createGovernedFastNewsLaneDecision,
  validateGovernedFastNewsLaneDecision,
};
