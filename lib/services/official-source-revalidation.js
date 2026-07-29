"use strict";

const crypto = require("node:crypto");
const {
  extractReadableBody,
  createSafeHttpsFetchCapture,
} = require("./breaking-source-adapters");
const {
  sha256Text,
  stableValue,
} = require("./publication-request-fingerprint");

const SOURCE_SNAPSHOT_SCHEMA =
  "pulse-official-source-snapshot-v1";
const SOURCE_REVISION_SCHEMA =
  "pulse-official-source-revision-v1";
const RELEASE_BINDING_SCHEMA =
  "pulse-official-source-release-binding-v1";
const REVALIDATION_SCHEMA =
  "pulse-official-source-revalidation-v1";
const BODY_ALGORITHM = "pulse-readable-body-v1";
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function text(value) {
  return String(value ?? "").trim();
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(value, code) {
  const normalised = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalised)) fail(code);
  return normalised;
}

function digestBytes(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function stableSha256(value) {
  return sha256Text(JSON.stringify(stableValue(value)));
}

function exactHttpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(text(value));
  } catch {
    fail("official_source_https_url_required");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== "443")
  ) {
    fail("official_source_https_url_required");
  }
  parsed.hash = "";
  return parsed.toString();
}

function exactClaim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("official_source_exact_claim_required");
  }
  const claimKey = text(value.claim_key);
  const claimText = String(value.text ?? "");
  if (!claimKey || !claimText.trim()) {
    fail("official_source_exact_claim_required");
  }
  const claimTextSha256 = sha256(
    value.claim_text_sha256,
    "official_source_claim_text_sha256_required",
  );
  if (
    digestBytes(Buffer.from(claimText, "utf8")) !==
    claimTextSha256
  ) {
    fail("official_source_claim_text_sha256_mismatch");
  }
  return {
    claim_key: claimKey,
    text: claimText,
    claim_text_sha256: claimTextSha256,
  };
}

function sortedClaims(value) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("official_source_exact_claims_required");
  }
  const claims = value.map(exactClaim).sort((left, right) =>
    left.claim_key.localeCompare(right.claim_key) ||
    left.claim_text_sha256.localeCompare(
      right.claim_text_sha256,
    ),
  );
  const identities = new Set();
  for (const claim of claims) {
    const identity =
      `${claim.claim_key}\0${claim.claim_text_sha256}`;
    if (identities.has(identity)) {
      fail("official_source_duplicate_claim_forbidden");
    }
    identities.add(identity);
  }
  return claims;
}

function claimsBoundToSnapshot(value, snapshotClaims) {
  const claims = sortedClaims(snapshotClaims);
  if (!Array.isArray(value) || value.length !== claims.length) {
    fail("official_source_snapshot_claim_mismatch");
  }
  if (value.every((claim) => typeof claim === "string")) {
    const remaining = new Map();
    for (const claimText of value) {
      if (!claimText.trim()) {
        fail("official_source_snapshot_claim_mismatch");
      }
      const identity =
        `${claimText}\0${digestBytes(Buffer.from(claimText, "utf8"))}`;
      remaining.set(identity, (remaining.get(identity) || 0) + 1);
    }
    for (const claim of claims) {
      const identity =
        `${claim.text}\0${claim.claim_text_sha256}`;
      const count = remaining.get(identity) || 0;
      if (count < 1) {
        fail("official_source_snapshot_claim_mismatch");
      }
      if (count === 1) remaining.delete(identity);
      else remaining.set(identity, count - 1);
    }
    if (remaining.size) {
      fail("official_source_snapshot_claim_mismatch");
    }
    return claims;
  }
  if (
    value.some(
      (claim) =>
        !claim ||
        typeof claim !== "object" ||
        Array.isArray(claim),
    )
  ) {
    fail("official_source_snapshot_claim_mismatch");
  }
  const evidenceClaims = new Map(
    sortedClaims(value).map((claim) => [
      `${claim.claim_key}\0${claim.claim_text_sha256}`,
      claim.text,
    ]),
  );
  if (
    claims.some(
      (claim) =>
        evidenceClaims.get(
          `${claim.claim_key}\0${claim.claim_text_sha256}`,
        ) !== claim.text,
    )
  ) {
    fail("official_source_snapshot_claim_mismatch");
  }
  return claims;
}

function revisionBase({
  sourceUrl,
  sourceId,
  sourceClass,
  canonicalBodyAlgorithm,
  canonicalBodySha256,
  claims,
}) {
  return {
    schema_version: SOURCE_REVISION_SCHEMA,
    source_url: exactHttpsUrl(sourceUrl),
    source_id: text(sourceId),
    source_class: text(sourceClass).toUpperCase(),
    canonical_body_algorithm: text(canonicalBodyAlgorithm),
    canonical_body_sha256: sha256(
      canonicalBodySha256,
      "official_source_canonical_body_sha256_required",
    ),
    claims: sortedClaims(claims).map((claim) => ({
      claim_key: claim.claim_key,
      claim_text_sha256: claim.claim_text_sha256,
    })),
  };
}

function validateRevisionBase(base) {
  if (
    base.schema_version !== SOURCE_REVISION_SCHEMA ||
    !base.source_id ||
    base.source_class !== "OFFICIAL_FIRST_PARTY" ||
    base.canonical_body_algorithm !== BODY_ALGORITHM
  ) {
    fail("official_source_revision_invalid");
  }
  return base;
}

function buildOfficialSourceReleaseBinding({
  storyId,
  sourceEvidenceSha256,
  sourceEvidence,
} = {}) {
  const exactStoryId = text(storyId);
  const evidenceSha256 = sha256(
    sourceEvidenceSha256,
    "official_source_evidence_sha256_required",
  );
  if (
    !exactStoryId ||
    sourceEvidence?.schema_version !==
      "pulse-source-evidence-v1" ||
    text(sourceEvidence.story_id) !== exactStoryId ||
    text(sourceEvidence.source_type).toLowerCase() !==
      "official"
  ) {
    fail("official_source_release_evidence_invalid");
  }
  const snapshot = sourceEvidence.official_source_snapshot;
  if (
    !snapshot ||
    snapshot.schema_version !== SOURCE_SNAPSHOT_SCHEMA
  ) {
    fail("official_source_snapshot_required");
  }
  const sourceUrl = exactHttpsUrl(snapshot.source_url);
  if (
    sourceUrl !== exactHttpsUrl(sourceEvidence.source_url)
  ) {
    fail("official_source_snapshot_url_mismatch");
  }
  const claims = claimsBoundToSnapshot(
    sourceEvidence.claims,
    snapshot.claims,
  );
  const revision = validateRevisionBase(
    revisionBase({
      sourceUrl,
      sourceId: snapshot.source_id,
      sourceClass: snapshot.source_class,
      canonicalBodyAlgorithm:
        snapshot.canonical_body_algorithm,
      canonicalBodySha256:
        snapshot.canonical_body_sha256,
      claims,
    }),
  );
  const bindingBase = {
    schema_version: RELEASE_BINDING_SCHEMA,
    story_id: exactStoryId,
    source_evidence_sha256: evidenceSha256,
    source_url: revision.source_url,
    source_id: revision.source_id,
    source_class: revision.source_class,
    canonical_body_algorithm:
      revision.canonical_body_algorithm,
    canonical_body_sha256:
      revision.canonical_body_sha256,
    claims,
    source_revision_sha256: stableSha256(revision),
  };
  return Object.freeze({
    ...bindingBase,
    binding_sha256: stableSha256(bindingBase),
  });
}

function validateOfficialSourceReleaseBinding(
  binding,
  { storyId = null, sourceEvidenceSha256 = null } = {},
) {
  if (
    !binding ||
    typeof binding !== "object" ||
    Array.isArray(binding) ||
    binding.schema_version !== RELEASE_BINDING_SCHEMA
  ) {
    fail("official_source_release_binding_required");
  }
  const revision = validateRevisionBase(
    revisionBase({
      sourceUrl: binding.source_url,
      sourceId: binding.source_id,
      sourceClass: binding.source_class,
      canonicalBodyAlgorithm:
        binding.canonical_body_algorithm,
      canonicalBodySha256:
        binding.canonical_body_sha256,
      claims: binding.claims,
    }),
  );
  const normalised = {
    schema_version: RELEASE_BINDING_SCHEMA,
    story_id: text(binding.story_id),
    source_evidence_sha256: sha256(
      binding.source_evidence_sha256,
      "official_source_evidence_sha256_required",
    ),
    source_url: revision.source_url,
    source_id: revision.source_id,
    source_class: revision.source_class,
    canonical_body_algorithm:
      revision.canonical_body_algorithm,
    canonical_body_sha256:
      revision.canonical_body_sha256,
    claims: sortedClaims(binding.claims),
    source_revision_sha256: sha256(
      binding.source_revision_sha256,
      "official_source_revision_sha256_required",
    ),
  };
  if (!normalised.story_id) {
    fail("official_source_release_story_id_required");
  }
  if (
    normalised.source_revision_sha256 !==
    stableSha256(revision)
  ) {
    fail("official_source_revision_sha256_mismatch");
  }
  const bindingSha256 = sha256(
    binding.binding_sha256,
    "official_source_release_binding_sha256_required",
  );
  if (bindingSha256 !== stableSha256(normalised)) {
    fail("official_source_release_binding_sha256_mismatch");
  }
  if (
    storyId !== null &&
    text(storyId) !== normalised.story_id
  ) {
    fail("official_source_release_story_id_mismatch");
  }
  if (
    sourceEvidenceSha256 !== null &&
    sha256(
      sourceEvidenceSha256,
      "official_source_evidence_sha256_required",
    ) !== normalised.source_evidence_sha256
  ) {
    fail("official_source_release_evidence_sha256_mismatch");
  }
  return {
    valid: true,
    value: Object.freeze({
      ...normalised,
      binding_sha256: bindingSha256,
    }),
    revision,
  };
}

function readClock(now) {
  const value = now();
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);
  if (Number.isNaN(date.getTime())) {
    fail("official_source_revalidation_clock_invalid");
  }
  return date;
}

function candidateIdentity(candidate) {
  const identity = {
    story_id: text(candidate.storyId || candidate.story_id),
    platform: text(candidate.platform).toLowerCase(),
    external_id: text(
      candidate.externalId || candidate.external_id,
    ),
    scheduled_for: new Date(
      candidate.scheduledFor || candidate.scheduled_for,
    ).toISOString(),
    request_fingerprint: sha256(
      candidate.requestFingerprint ||
        candidate.request_fingerprint,
      "official_source_request_fingerprint_required",
    ),
    runway_lock_sha256: sha256(
      candidate.runwayLockSha256 ||
        candidate.runway_lock_sha256,
      "official_source_runway_lock_sha256_required",
    ),
  };
  if (
    !identity.story_id ||
    identity.platform !== "youtube" ||
    !identity.external_id
  ) {
    fail("official_source_release_identity_invalid");
  }
  return identity;
}

function createOfficialSourceRevalidator({
  fetchCapture = null,
  now = () => new Date(),
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const fetchOfficialSource =
    fetchCapture || createSafeHttpsFetchCapture();
  if (typeof fetchOfficialSource !== "function") {
    fail("official_source_fetch_capture_required");
  }
  const byteLimit = Number(maxBytes);
  if (
    !Number.isSafeInteger(byteLimit) ||
    byteLimit <= 0 ||
    byteLimit > DEFAULT_MAX_BYTES
  ) {
    fail("official_source_max_bytes_invalid");
  }
  if (typeof now !== "function") {
    fail("official_source_revalidation_clock_required");
  }
  return async function revalidateOfficialSource(candidate = {}) {
    const identity = candidateIdentity(candidate);
    const validated =
      validateOfficialSourceReleaseBinding(
        candidate.binding,
        { storyId: identity.story_id },
      );
    const binding = validated.value;
    let response;
    try {
      response = await fetchOfficialSource({
        url: binding.source_url,
        redirect: "manual",
        max_bytes: byteLimit,
      });
    } catch (cause) {
      const error = new Error(
        "official_source_revalidation_fetch_failed",
      );
      error.code =
        "official_source_revalidation_fetch_failed";
      error.cause = cause;
      throw error;
    }
    const bytes = Buffer.isBuffer(response?.bytes)
      ? Buffer.from(response.bytes)
      : Buffer.from(response?.bytes || []);
    if (
      Number(response?.status) < 200 ||
      Number(response?.status) >= 300
    ) {
      fail("official_source_revalidation_status_invalid");
    }
    if (
      exactHttpsUrl(response?.final_url) !==
      binding.source_url
    ) {
      fail("official_source_revalidation_url_mismatch");
    }
    if (!bytes.length || bytes.length > byteLimit) {
      fail("official_source_revalidation_bytes_invalid");
    }
    const canonicalBody = extractReadableBody(
      bytes,
      text(response?.content_type),
    );
    const observedBodySha256 = digestBytes(
      Buffer.from(canonicalBody, "utf8"),
    );
    if (
      observedBodySha256 !==
      binding.canonical_body_sha256
    ) {
      fail("official_source_canonical_body_changed");
    }
    const missing = binding.claims.filter(
      (claim) => !canonicalBody.includes(claim.text),
    );
    if (missing.length) {
      fail("official_source_exact_claim_missing");
    }
    const observedRevision = validateRevisionBase(
      revisionBase({
        sourceUrl: binding.source_url,
        sourceId: binding.source_id,
        sourceClass: binding.source_class,
        canonicalBodyAlgorithm:
          binding.canonical_body_algorithm,
        canonicalBodySha256: observedBodySha256,
        claims: binding.claims,
      }),
    );
    const observedRevisionSha256 =
      stableSha256(observedRevision);
    if (
      observedRevisionSha256 !==
      binding.source_revision_sha256
    ) {
      fail("official_source_revision_changed");
    }
    const checkedAt = readClock(now).toISOString();
    const receiptBase = {
      schema_version: REVALIDATION_SCHEMA,
      official_source: true,
      unchanged: true,
      claims_match: true,
      ...identity,
      source_url: binding.source_url,
      source_id: binding.source_id,
      source_binding_sha256: binding.binding_sha256,
      source_evidence_sha256:
        binding.source_evidence_sha256,
      expected_source_revision_sha256:
        binding.source_revision_sha256,
      source_revision_sha256:
        observedRevisionSha256,
      observed_canonical_body_sha256:
        observedBodySha256,
      matched_claim_text_sha256: binding.claims.map(
        (claim) => claim.claim_text_sha256,
      ),
      fetch_status: Number(response.status),
      content_type: text(response.content_type),
      bytes_sha256: digestBytes(bytes),
      revalidated_at: checkedAt,
    };
    return Object.freeze({
      ...receiptBase,
      receipt_sha256: stableSha256(receiptBase),
    });
  };
}

function validateOfficialSourceRevalidationReceipt(
  receipt,
  {
    binding,
    storyId,
    platform,
    externalId,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
  } = {},
) {
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Array.isArray(receipt) ||
    receipt.schema_version !== REVALIDATION_SCHEMA
  ) {
    fail("official_source_revalidation_receipt_required");
  }
  const validatedBinding =
    validateOfficialSourceReleaseBinding(binding, {
      storyId,
    }).value;
  const expectedIdentity = candidateIdentity({
    storyId,
    platform,
    externalId,
    scheduledFor,
    requestFingerprint,
    runwayLockSha256,
  });
  const receiptSha256 = sha256(
    receipt.receipt_sha256,
    "official_source_revalidation_receipt_sha256_required",
  );
  const {
    receipt_sha256: _receiptSha256,
    ...receiptBase
  } = receipt;
  if (receiptSha256 !== stableSha256(receiptBase)) {
    fail("official_source_revalidation_receipt_sha256_mismatch");
  }
  if (
    receipt.official_source !== true ||
    receipt.unchanged !== true ||
    receipt.claims_match !== true
  ) {
    fail("official_source_revalidation_receipt_not_green");
  }
  for (const [actual, expected, code] of [
    [
      text(receipt.story_id),
      expectedIdentity.story_id,
      "official_source_revalidation_story_mismatch",
    ],
    [
      text(receipt.platform).toLowerCase(),
      expectedIdentity.platform,
      "official_source_revalidation_platform_mismatch",
    ],
    [
      text(receipt.external_id),
      expectedIdentity.external_id,
      "official_source_revalidation_external_id_mismatch",
    ],
    [
      text(receipt.scheduled_for),
      expectedIdentity.scheduled_for,
      "official_source_revalidation_schedule_mismatch",
    ],
    [
      text(receipt.request_fingerprint).toLowerCase(),
      expectedIdentity.request_fingerprint,
      "official_source_revalidation_fingerprint_mismatch",
    ],
    [
      text(receipt.runway_lock_sha256).toLowerCase(),
      expectedIdentity.runway_lock_sha256,
      "official_source_revalidation_runway_mismatch",
    ],
    [
      text(receipt.source_url),
      validatedBinding.source_url,
      "official_source_revalidation_url_mismatch",
    ],
    [
      text(receipt.source_binding_sha256).toLowerCase(),
      validatedBinding.binding_sha256,
      "official_source_revalidation_binding_mismatch",
    ],
    [
      text(receipt.source_evidence_sha256).toLowerCase(),
      validatedBinding.source_evidence_sha256,
      "official_source_revalidation_evidence_mismatch",
    ],
    [
      text(
        receipt.expected_source_revision_sha256,
      ).toLowerCase(),
      validatedBinding.source_revision_sha256,
      "official_source_revalidation_expected_revision_mismatch",
    ],
    [
      text(receipt.source_revision_sha256).toLowerCase(),
      validatedBinding.source_revision_sha256,
      "official_source_revalidation_revision_mismatch",
    ],
    [
      text(
        receipt.observed_canonical_body_sha256,
      ).toLowerCase(),
      validatedBinding.canonical_body_sha256,
      "official_source_revalidation_body_mismatch",
    ],
  ]) {
    if (actual !== expected) fail(code);
  }
  const matchedClaims = Array.isArray(
    receipt.matched_claim_text_sha256,
  )
    ? receipt.matched_claim_text_sha256.map((value) =>
        text(value).toLowerCase(),
      )
    : [];
  const expectedClaims = validatedBinding.claims.map(
    (claim) => claim.claim_text_sha256,
  );
  if (
    JSON.stringify(matchedClaims) !==
    JSON.stringify(expectedClaims)
  ) {
    fail("official_source_revalidation_claims_mismatch");
  }
  const revalidatedAt = new Date(receipt.revalidated_at);
  if (
    Number.isNaN(revalidatedAt.getTime()) ||
    revalidatedAt.toISOString() !== receipt.revalidated_at
  ) {
    fail("official_source_revalidation_time_invalid");
  }
  return {
    valid: true,
    value: Object.freeze({
      ...receiptBase,
      receipt_sha256: receiptSha256,
    }),
  };
}

module.exports = {
  BODY_ALGORITHM,
  DEFAULT_MAX_BYTES,
  RELEASE_BINDING_SCHEMA,
  REVALIDATION_SCHEMA,
  SOURCE_REVISION_SCHEMA,
  SOURCE_SNAPSHOT_SCHEMA,
  buildOfficialSourceReleaseBinding,
  createOfficialSourceRevalidator,
  validateOfficialSourceRevalidationReceipt,
  validateOfficialSourceReleaseBinding,
};
