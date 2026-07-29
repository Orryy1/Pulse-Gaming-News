"use strict";

const crypto = require("node:crypto");

const EXPECTED_PULSE_YOUTUBE_CHANNEL_ID =
  "UCvgNDjtTezrpxL8oUe6mYwA";
const REQUIRED_YOUTUBE_ACCOUNT_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube.upload",
]);
const OPTIONAL_YOUTUBE_ANALYTICS_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics.readonly";
const YOUTUBE_READ_SCOPE_ALTERNATIVES = Object.freeze([
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.readonly",
]);
const ALLOWED_YOUTUBE_ACCOUNT_SCOPES = Object.freeze([
  ...REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
  ...YOUTUBE_READ_SCOPE_ALTERNATIVES,
  "https://www.googleapis.com/auth/youtube.force-ssl",
  OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
  "email",
  "openid",
  "profile",
]);
const ALLOWED_YOUTUBE_ACCOUNT_SCOPE_SET = new Set(
  ALLOWED_YOUTUBE_ACCOUNT_SCOPES,
);
const PROOF_TTL_MS = 5 * 60 * 1000;
const MAXIMUM_PROBE_AGE_MS = 60 * 1000;
const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  "accesstoken",
  "authorization",
  "clientsecret",
  "idtoken",
  "password",
  "refreshtoken",
  "token",
]);
const KNOWN_IDENTITY_SCOPES = new Set([
  "email",
  "openid",
  "profile",
]);
const GOOGLE_SCOPE_PATTERN =
  /^https:\/\/www\.googleapis\.com\/auth\/[A-Za-z0-9._-]+$/;

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value, "utf8")
    .digest("hex");
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isPlainRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => key !== "proof_sha256")
        .sort()
        .map((key) => [key, canonicalValue(value[key])]),
    );
  }
  return value;
}

function fingerprintYouTubeAccountBindingProof(value) {
  if (!isPlainRecord(value)) {
    fail("youtube_account_binding_proof_invalid");
  }
  return sha256(JSON.stringify(canonicalValue(value)));
}

function hasExactKeys(value, keys) {
  return (
    isPlainRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function assertCanonicalJsonTree(value, seen = new Set()) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (!value || typeof value !== "object" || seen.has(value)) {
    fail("youtube_account_binding_proof_canonical_shape_invalid");
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const expectedKeys = [
      ...value.map((_, index) => String(index)),
      "length",
    ];
    if (
      JSON.stringify(Reflect.ownKeys(value)) !==
      JSON.stringify(expectedKeys)
    ) {
      fail(
        "youtube_account_binding_proof_canonical_shape_invalid",
      );
    }
    value.forEach((entry) =>
      assertCanonicalJsonTree(entry, seen),
    );
  } else {
    if (!isPlainRecord(value)) {
      fail(
        "youtube_account_binding_proof_canonical_shape_invalid",
      );
    }
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(
        value,
        key,
      );
      if (
        typeof key !== "string" ||
        descriptor?.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")
      ) {
        fail(
          "youtube_account_binding_proof_canonical_shape_invalid",
        );
      }
      assertCanonicalJsonTree(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function hasExactStringArray(value, expected) {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every(
      (entry, index) =>
        typeof entry === "string" &&
        entry === expected[index],
    )
  );
}

function exactIsoTimestamp(value, code) {
  if (typeof value !== "string") fail(code);
  const milliseconds = Date.parse(value);
  if (
    !Number.isFinite(milliseconds) ||
    new Date(milliseconds).toISOString() !== value
  ) {
    fail(code);
  }
  return milliseconds;
}

function frozenJsonCopy(value) {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(frozenJsonCopy));
  }
  if (isPlainRecord(value)) {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          frozenJsonCopy(entry),
        ]),
      ),
    );
  }
  return value;
}

function validateYouTubeAccountBindingProof(
  proof,
  {
    expectedChannelId,
    configuredOAuthClientSha256,
    now = () => new Date(),
  } = {},
) {
  if (!isPlainRecord(proof)) {
    fail("youtube_account_binding_proof_required");
  }
  if (typeof now !== "function") {
    fail("youtube_account_binding_clock_required");
  }
  const checkedDate = new Date(now());
  if (Number.isNaN(checkedDate.getTime())) {
    fail("youtube_account_binding_time_invalid");
  }
  const expectedChannel = String(expectedChannelId || "").trim();
  if (
    expectedChannel !== EXPECTED_PULSE_YOUTUBE_CHANNEL_ID
  ) {
    fail("youtube_account_binding_expected_pulse_channel_mismatch");
  }
  const expectedClientHash = String(
    configuredOAuthClientSha256 || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedClientHash)) {
    fail("youtube_account_binding_client_sha256_required");
  }
  assertCanonicalJsonTree(proof);
  rejectCredentialValues(proof);
  if (
    !hasExactKeys(proof, [
      "schema_version",
      "verdict",
      "generated_at",
      "expires_at",
      "ttl_seconds",
      "expected_channel_id",
      "observed_channel_id",
      "configured_oauth_client_sha256",
      "oauth_client_binding_verified",
      "required_scopes",
      "required_read_scope_alternatives",
      "observed_scopes",
      "scope_binding_verified",
      "analytics",
      "channel",
      "source_observations",
      "sanitisation",
      "side_effects",
      "operational_publish_authority",
      "publication_authority_granted",
      "external_publish_authorised",
      "proof_sha256",
    ])
  ) {
    fail("youtube_account_binding_proof_canonical_shape_invalid");
  }
  if (
    proof.schema_version !==
      "pulse-youtube-account-binding-proof-v1" ||
    proof.verdict !== "GREEN"
  ) {
    fail("youtube_account_binding_proof_not_green");
  }
  const proofHash = String(proof.proof_sha256 || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(proofHash)) {
    fail("youtube_account_binding_proof_sha256_required");
  }
  if (
    proofHash !==
    fingerprintYouTubeAccountBindingProof(proof)
  ) {
    fail("youtube_account_binding_proof_sha256_mismatch");
  }
  const generatedAt = exactIsoTimestamp(
    proof.generated_at,
    "youtube_account_binding_proof_time_invalid",
  );
  const expiresAt = exactIsoTimestamp(
    proof.expires_at,
    "youtube_account_binding_proof_time_invalid",
  );
  const nowMs = checkedDate.getTime();
  if (
    proof.ttl_seconds !== PROOF_TTL_MS / 1000 ||
    expiresAt - generatedAt !== PROOF_TTL_MS ||
    generatedAt > nowMs ||
    nowMs >= expiresAt
  ) {
    fail("youtube_account_binding_proof_stale");
  }
  if (
    proof.expected_channel_id !== expectedChannel ||
    proof.observed_channel_id !== expectedChannel
  ) {
    fail("youtube_account_binding_proof_channel_mismatch");
  }
  if (
    proof.configured_oauth_client_sha256 !==
      expectedClientHash ||
    proof.oauth_client_binding_verified !== true
  ) {
    fail("youtube_account_binding_proof_client_mismatch");
  }
  const observedScopes = proof.observed_scopes;
  const canonicalObservedScopes = Array.isArray(observedScopes)
    ? [...new Set(observedScopes)].sort()
    : [];
  if (
    !hasExactStringArray(
      proof.required_scopes,
      REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
    ) ||
    !hasExactStringArray(
      proof.required_read_scope_alternatives,
      YOUTUBE_READ_SCOPE_ALTERNATIVES,
    ) ||
    !hasExactStringArray(
      observedScopes,
      canonicalObservedScopes,
    ) ||
    observedScopes.some(
      (scope) =>
        !GOOGLE_SCOPE_PATTERN.test(scope) &&
        !KNOWN_IDENTITY_SCOPES.has(scope),
    ) ||
    observedScopes.some(
      (scope) =>
        !ALLOWED_YOUTUBE_ACCOUNT_SCOPE_SET.has(scope),
    ) ||
    REQUIRED_YOUTUBE_ACCOUNT_SCOPES.some(
      (scope) => !observedScopes.includes(scope),
    ) ||
    !YOUTUBE_READ_SCOPE_ALTERNATIVES.some(
      (scope) => observedScopes.includes(scope),
    ) ||
    proof.scope_binding_verified !== true ||
    !hasExactKeys(proof.analytics, [
      "scope",
      "read_scope_present",
      "learning_ready",
    ]) ||
    proof.analytics.scope !==
      OPTIONAL_YOUTUBE_ANALYTICS_SCOPE ||
    typeof proof.analytics.read_scope_present !== "boolean" ||
    proof.analytics.learning_ready !==
      proof.analytics.read_scope_present ||
    proof.analytics.read_scope_present !==
      observedScopes.includes(
        OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
      )
  ) {
    fail("youtube_account_binding_proof_scope_evidence_invalid");
  }
  if (
    !hasExactKeys(proof.channel, [
      "public",
      "linked",
      "long_uploads_allowed",
    ]) ||
    proof.channel.public !== true ||
    proof.channel.linked !== true ||
    proof.channel.long_uploads_allowed !== true
  ) {
    fail("youtube_account_binding_proof_channel_evidence_invalid");
  }
  if (
    !hasExactKeys(proof.source_observations, [
      "tokeninfo_checked_at",
      "channel_checked_at",
      "maximum_age_seconds",
    ]) ||
    proof.source_observations.maximum_age_seconds !==
      MAXIMUM_PROBE_AGE_MS / 1000
  ) {
    fail(
      "youtube_account_binding_proof_observation_evidence_invalid",
    );
  }
  for (const timestamp of [
    proof.source_observations.tokeninfo_checked_at,
    proof.source_observations.channel_checked_at,
  ]) {
    const observedAt = exactIsoTimestamp(
      timestamp,
      "youtube_account_binding_proof_observation_time_invalid",
    );
    if (
      observedAt > generatedAt ||
      generatedAt - observedAt > MAXIMUM_PROBE_AGE_MS ||
      observedAt > nowMs ||
      nowMs - observedAt > MAXIMUM_PROBE_AGE_MS
    ) {
      fail("youtube_account_binding_proof_observation_stale");
    }
  }
  if (
    !hasExactKeys(proof.sanitisation, [
      "credential_values_included",
      "raw_probe_payloads_included",
    ]) ||
    proof.sanitisation.credential_values_included !== false ||
    proof.sanitisation.raw_probe_payloads_included !== false
  ) {
    fail("youtube_account_binding_proof_sanitisation_invalid");
  }
  if (
    !hasExactKeys(proof.side_effects, [
      "verifier_network_contacted",
      "read_only_probe_network_contacted",
      "database_mutated",
      "oauth_mutated",
    ]) ||
    proof.side_effects.verifier_network_contacted !== false ||
    proof.side_effects.read_only_probe_network_contacted !== true ||
    proof.side_effects.database_mutated !== false ||
    proof.side_effects.oauth_mutated !== false
  ) {
    fail("youtube_account_binding_proof_side_effects_invalid");
  }
  if (
    proof.operational_publish_authority !== false ||
    proof.publication_authority_granted !== false ||
    proof.external_publish_authorised !== false
  ) {
    fail("youtube_account_binding_proof_authority_forbidden");
  }
  return {
    valid: true,
    value: frozenJsonCopy(proof),
  };
}

function freshProbeTimestamp(value, generatedAt) {
  const checkedAt = String(value || "").trim();
  const checkedAtMs = Date.parse(checkedAt);
  if (
    !Number.isFinite(checkedAtMs) ||
    new Date(checkedAtMs).toISOString() !== checkedAt ||
    checkedAtMs > generatedAt.getTime() ||
    generatedAt.getTime() - checkedAtMs > MAXIMUM_PROBE_AGE_MS
  ) {
    fail("youtube_account_binding_probe_freshness_invalid");
  }
  return checkedAt;
}

function rejectCredentialValues(value, seen = new Set()) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) {
    fail("youtube_account_binding_probe_payload_invalid");
  }
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    const normalisedKey = key
      .replace(/[^a-z0-9]/gi, "")
      .toLowerCase();
    if (FORBIDDEN_CREDENTIAL_KEYS.has(normalisedKey)) {
      fail("youtube_account_binding_credential_value_forbidden");
    }
    rejectCredentialValues(entry, seen);
  }
  seen.delete(value);
}

function validateYouTubeTokenIdentityAndScopes(
  tokenInfo,
  { configuredOAuthClientSha256 } = {},
) {
  if (!isPlainRecord(tokenInfo)) {
    fail("youtube_account_binding_tokeninfo_probe_invalid");
  }
  const identities = ["issued_to", "audience", "aud"]
    .filter((key) => tokenInfo[key] !== undefined)
    .map((key) => tokenInfo[key]);
  if (
    identities.length === 0 ||
    identities.some(
      (value) =>
        typeof value !== "string" ||
        !/^[A-Za-z0-9._-]+$/.test(value.trim()),
    )
  ) {
    fail("youtube_account_binding_client_identity_required");
  }
  const canonicalIdentities = [
    ...new Set(identities.map((value) => value.trim())),
  ];
  if (canonicalIdentities.length !== 1) {
    fail("youtube_account_binding_client_identity_conflict");
  }
  const clientHash = String(
    configuredOAuthClientSha256 || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clientHash)) {
    fail("youtube_account_binding_client_sha256_required");
  }
  if (sha256(canonicalIdentities[0]) !== clientHash) {
    fail("youtube_account_binding_client_mismatch");
  }
  if (
    typeof tokenInfo.scope !== "string" ||
    !tokenInfo.scope.trim()
  ) {
    fail("youtube_account_binding_scope_metadata_invalid");
  }
  const scopes = tokenInfo.scope.trim().split(/\s+/);
  if (
    scopes.some(
      (scope) =>
        !GOOGLE_SCOPE_PATTERN.test(scope) &&
        !KNOWN_IDENTITY_SCOPES.has(scope),
    )
  ) {
    fail("youtube_account_binding_scope_metadata_invalid");
  }
  if (
    scopes.some(
      (scope) =>
        !ALLOWED_YOUTUBE_ACCOUNT_SCOPE_SET.has(scope),
    )
  ) {
    fail("youtube_account_binding_unreviewed_scope_present");
  }
  if (
    REQUIRED_YOUTUBE_ACCOUNT_SCOPES.some(
      (scope) => !scopes.includes(scope),
    )
  ) {
    fail("youtube_account_binding_required_scope_missing");
  }
  if (
    !YOUTUBE_READ_SCOPE_ALTERNATIVES.some(
      (scope) => scopes.includes(scope),
    )
  ) {
    fail("youtube_account_binding_read_scope_missing");
  }
  return Object.freeze({
    client_id: canonicalIdentities[0],
    scopes: Object.freeze([...new Set(scopes)].sort()),
  });
}

function verifyYouTubeAccountBinding(options = {}) {
  if (!isPlainRecord(options)) {
    fail("youtube_account_binding_invocation_invalid");
  }
  const {
    expectedChannelId,
    configuredOAuthClientSha256,
    tokenInfoProbeResult,
    channelProbeResult,
    now = () => new Date(),
  } = options;
  if (typeof now !== "function") {
    fail("youtube_account_binding_clock_required");
  }
  const generatedDate = now();
  const generatedAt = new Date(generatedDate);
  if (Number.isNaN(generatedAt.getTime())) {
    fail("youtube_account_binding_time_invalid");
  }
  const clientHash = String(configuredOAuthClientSha256 || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(clientHash)) {
    fail("youtube_account_binding_client_sha256_required");
  }
  const expectedChannel = String(expectedChannelId || "").trim();
  if (!/^UC[A-Za-z0-9_-]{20,}$/.test(expectedChannel)) {
    fail("youtube_account_binding_expected_channel_required");
  }
  if (
    !isPlainRecord(tokenInfoProbeResult) ||
    !isPlainRecord(tokenInfoProbeResult.data)
  ) {
    fail("youtube_account_binding_tokeninfo_probe_invalid");
  }
  if (
    !isPlainRecord(channelProbeResult) ||
    !isPlainRecord(channelProbeResult.data)
  ) {
    fail("youtube_account_binding_channel_probe_invalid");
  }
  rejectCredentialValues(tokenInfoProbeResult);
  rejectCredentialValues(channelProbeResult);
  const tokenInfoCheckedAt = freshProbeTimestamp(
    tokenInfoProbeResult?.checked_at,
    generatedAt,
  );
  const channelCheckedAt = freshProbeTimestamp(
    channelProbeResult?.checked_at,
    generatedAt,
  );
  const tokenInfo = tokenInfoProbeResult?.data;
  const tokenBinding = validateYouTubeTokenIdentityAndScopes(
    tokenInfo,
    { configuredOAuthClientSha256: clientHash },
  );
  const scopes = tokenBinding.scopes;
  const items = channelProbeResult?.data?.items;
  if (!Array.isArray(items) || items.length !== 1) {
    fail("youtube_account_binding_channel_probe_invalid");
  }
  const channel = items[0];
  if (
    !isPlainRecord(channel) ||
    !isPlainRecord(channel.status)
  ) {
    fail("youtube_account_binding_channel_probe_invalid");
  }
  if (channel?.id !== expectedChannel) {
    fail("youtube_account_binding_channel_mismatch");
  }
  if (channel?.status?.privacyStatus !== "public") {
    fail("youtube_account_binding_channel_not_public");
  }
  if (channel?.status?.isLinked !== true) {
    fail("youtube_account_binding_channel_not_linked");
  }
  if (channel?.status?.longUploadsStatus !== "allowed") {
    fail("youtube_account_binding_long_uploads_not_allowed");
  }
  const observedScopes = [...scopes];
  const proof = {
    schema_version: "pulse-youtube-account-binding-proof-v1",
    verdict: "GREEN",
    generated_at: generatedAt.toISOString(),
    expires_at: new Date(
      generatedAt.getTime() + PROOF_TTL_MS,
    ).toISOString(),
    ttl_seconds: PROOF_TTL_MS / 1000,
    expected_channel_id: expectedChannel,
    observed_channel_id: channel.id,
    configured_oauth_client_sha256: clientHash,
    oauth_client_binding_verified: true,
    required_scopes: [...REQUIRED_YOUTUBE_ACCOUNT_SCOPES],
    required_read_scope_alternatives: [
      ...YOUTUBE_READ_SCOPE_ALTERNATIVES,
    ],
    observed_scopes: observedScopes,
    scope_binding_verified: true,
    analytics: {
      scope: OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
      read_scope_present: scopes.includes(
        OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
      ),
      learning_ready: scopes.includes(
        OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
      ),
    },
    channel: {
      public: true,
      linked: true,
      long_uploads_allowed: true,
    },
    source_observations: {
      tokeninfo_checked_at: tokenInfoCheckedAt,
      channel_checked_at: channelCheckedAt,
      maximum_age_seconds: MAXIMUM_PROBE_AGE_MS / 1000,
    },
    sanitisation: {
      credential_values_included: false,
      raw_probe_payloads_included: false,
    },
    side_effects: {
      verifier_network_contacted: false,
      read_only_probe_network_contacted: true,
      database_mutated: false,
      oauth_mutated: false,
    },
    operational_publish_authority: false,
    publication_authority_granted: false,
    external_publish_authorised: false,
  };
  return Object.freeze({
    ...proof,
    proof_sha256: fingerprintYouTubeAccountBindingProof(proof),
  });
}

module.exports = {
  ALLOWED_YOUTUBE_ACCOUNT_SCOPES,
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
  REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
  YOUTUBE_READ_SCOPE_ALTERNATIVES,
  fingerprintYouTubeAccountBindingProof,
  validateYouTubeTokenIdentityAndScopes,
  validateYouTubeAccountBindingProof,
  verifyYouTubeAccountBinding,
};
