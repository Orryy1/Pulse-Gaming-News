"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { test } = require("node:test");

const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
  REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
  YOUTUBE_READ_SCOPE_ALTERNATIVES,
  fingerprintYouTubeAccountBindingProof,
  validateYouTubeAccountBindingProof,
  verifyYouTubeAccountBinding,
} = require("../../lib/services/youtube-account-binding-verifier");

const CHECKED_AT = "2026-07-29T10:00:00.000Z";
const CLIENT_ID =
  "pulse-client.apps.googleusercontent.com";
const CLIENT_SHA256 = crypto
  .createHash("sha256")
  .update(CLIENT_ID, "utf8")
  .digest("hex");

function validInput() {
  return {
    expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    configuredOAuthClientSha256: CLIENT_SHA256,
    tokenInfoProbeResult: {
      checked_at: CHECKED_AT,
      data: {
        issued_to: CLIENT_ID,
        scope: [
          ...REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
          OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
          YOUTUBE_READ_SCOPE_ALTERNATIVES[0],
        ].join(" "),
      },
    },
    channelProbeResult: {
      checked_at: CHECKED_AT,
      data: {
        items: [
          {
            id: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
            status: {
              privacyStatus: "public",
              isLinked: true,
              longUploadsStatus: "allowed",
            },
          },
        ],
      },
    },
    now: () => new Date(CHECKED_AT),
  };
}

test("emits a short-lived sanitised proof for the exact Pulse YouTube account binding", () => {
  const result = verifyYouTubeAccountBinding(validInput());

  const { proof_sha256: proofSha256, ...proofBody } = result;
  assert.deepEqual(proofBody, {
    schema_version: "pulse-youtube-account-binding-proof-v1",
    verdict: "GREEN",
    generated_at: CHECKED_AT,
    expires_at: "2026-07-29T10:05:00.000Z",
    ttl_seconds: 300,
    expected_channel_id: "UCvgNDjtTezrpxL8oUe6mYwA",
    observed_channel_id: "UCvgNDjtTezrpxL8oUe6mYwA",
    configured_oauth_client_sha256: CLIENT_SHA256,
    oauth_client_binding_verified: true,
    required_scopes: [...REQUIRED_YOUTUBE_ACCOUNT_SCOPES],
    required_read_scope_alternatives: [
      ...YOUTUBE_READ_SCOPE_ALTERNATIVES,
    ],
    observed_scopes: [
      YOUTUBE_READ_SCOPE_ALTERNATIVES[0],
      REQUIRED_YOUTUBE_ACCOUNT_SCOPES[0],
      OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
    ],
    scope_binding_verified: true,
    analytics: {
      scope: OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
      read_scope_present: true,
      learning_ready: true,
    },
    channel: {
      public: true,
      linked: true,
      long_uploads_allowed: true,
    },
    source_observations: {
      tokeninfo_checked_at: CHECKED_AT,
      channel_checked_at: CHECKED_AT,
      maximum_age_seconds: 60,
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
  });
  assert.match(proofSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    proofSha256,
    fingerprintYouTubeAccountBindingProof(proofBody),
  );
  assert.equal(
    JSON.stringify(result).includes(CLIENT_ID),
    false,
  );
});

test("accepts the canonical fresh GREEN proof only when it is rebound to the trusted Pulse channel and OAuth client hash", () => {
  const proof = verifyYouTubeAccountBinding(validInput());

  const result = validateYouTubeAccountBindingProof(proof, {
    expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    configuredOAuthClientSha256: CLIENT_SHA256,
    now: () => new Date("2026-07-29T10:00:01.000Z"),
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.value, proof);
  assert.equal(
    result.value.operational_publish_authority,
    false,
  );
  assert.equal(
    result.value.publication_authority_granted,
    false,
  );
  assert.equal(
    result.value.external_publish_authorised,
    false,
  );
});

test("rejects hidden raw probe material instead of treating non-enumerable properties as canonical proof data", () => {
  const proof = structuredClone(
    verifyYouTubeAccountBinding(validInput()),
  );
  Object.defineProperty(proof, "raw_probe_payload", {
    enumerable: false,
    value: {
      access_material: "must-never-reach-the-arm-boundary",
    },
  });

  assert.throws(
    () =>
      validateYouTubeAccountBindingProof(proof, {
        expectedChannelId:
          EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
        configuredOAuthClientSha256: CLIENT_SHA256,
        now: () =>
          new Date("2026-07-29T10:00:01.000Z"),
      }),
    {
      code:
        "youtube_account_binding_proof_canonical_shape_invalid",
    },
  );
});

test("rejects stale, tampered, mismatched, authority-bearing or unsanitised account proofs even when a caller recomputes the public fingerprint", () => {
  const validate = (proof, overrides = {}) =>
    validateYouTubeAccountBindingProof(proof, {
      expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      configuredOAuthClientSha256: CLIENT_SHA256,
      now: () => new Date("2026-07-29T10:00:01.000Z"),
      ...overrides,
    });
  const mutateAndFingerprint = (mutate) => {
    const proof = structuredClone(
      verifyYouTubeAccountBinding(validInput()),
    );
    mutate(proof);
    proof.proof_sha256 =
      fingerprintYouTubeAccountBindingProof(proof);
    return proof;
  };

  const hashTampered = structuredClone(
    verifyYouTubeAccountBinding(validInput()),
  );
  hashTampered.channel.linked = false;
  assert.throws(() => validate(hashTampered), {
    code: "youtube_account_binding_proof_sha256_mismatch",
  });

  for (const scenario of [
    {
      proof: mutateAndFingerprint((proof) => {
        proof.expected_channel_id =
          "UC0000000000000000000000";
        proof.observed_channel_id =
          "UC0000000000000000000000";
      }),
      code: "youtube_account_binding_proof_channel_mismatch",
    },
    {
      proof: mutateAndFingerprint((proof) => {
        proof.configured_oauth_client_sha256 =
          "f".repeat(64);
      }),
      code: "youtube_account_binding_proof_client_mismatch",
    },
    {
      proof: mutateAndFingerprint((proof) => {
        proof.required_scopes = [];
      }),
      code:
        "youtube_account_binding_proof_scope_evidence_invalid",
    },
    {
      proof: mutateAndFingerprint((proof) => {
        proof.operational_publish_authority = true;
      }),
      code:
        "youtube_account_binding_proof_authority_forbidden",
    },
    {
      proof: mutateAndFingerprint((proof) => {
        proof.sanitisation.raw_probe_payloads_included =
          true;
      }),
      code:
        "youtube_account_binding_proof_sanitisation_invalid",
    },
    {
      proof: mutateAndFingerprint((proof) => {
        proof.raw_probe_payload = {
          observed_response: "forbidden",
        };
      }),
      code:
        "youtube_account_binding_proof_canonical_shape_invalid",
    },
    {
      proof: mutateAndFingerprint((proof) => {
        proof.access_token = "forbidden";
      }),
      code:
        "youtube_account_binding_credential_value_forbidden",
    },
  ]) {
    assert.throws(() => validate(scenario.proof), {
      code: scenario.code,
    });
  }

  assert.throws(
    () =>
      validate(
        verifyYouTubeAccountBinding(validInput()),
        {
          now: () =>
            new Date("2026-07-29T10:01:00.001Z"),
        },
      ),
    {
      code:
        "youtube_account_binding_proof_observation_stale",
    },
  );
});

test("keeps publishing identity GREEN when the optional analytics scope is not yet granted", () => {
  const input = validInput();
  input.tokenInfoProbeResult.data.scope =
    input.tokenInfoProbeResult.data.scope
      .split(/\s+/)
      .filter(
        (scope) => scope !== OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
      )
      .join(" ");

  const result = verifyYouTubeAccountBinding(input);

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.analytics.read_scope_present, false);
  assert.equal(result.analytics.learning_ready, false);
  assert.equal(result.publication_authority_granted, false);
});

test("fails closed when either injected probe observation is stale, future-dated or missing", () => {
  for (const mutation of [
    (input) => {
      input.tokenInfoProbeResult.checked_at =
        "2026-07-29T09:58:59.999Z";
    },
    (input) => {
      input.channelProbeResult.checked_at =
        "2026-07-29T10:00:00.001Z";
    },
    (input) => {
      delete input.tokenInfoProbeResult.checked_at;
    },
  ]) {
    const input = validInput();
    mutation(input);
    assert.throws(
      () => verifyYouTubeAccountBinding(input),
      {
        code: "youtube_account_binding_probe_freshness_invalid",
      },
    );
  }
});

test("rejects token, secret and authorisation values instead of accepting or echoing credentials", () => {
  for (const forbidden of [
    { access_token: "access-secret" },
    { refreshToken: "refresh-secret" },
    { nested: { id_token: "identity-secret" } },
    { authorization: "Bearer secret" },
    { client_secret: "client-secret" },
  ]) {
    const input = validInput();
    Object.assign(input.tokenInfoProbeResult, forbidden);
    assert.throws(
      () => verifyYouTubeAccountBinding(input),
      {
        code: "youtube_account_binding_credential_value_forbidden",
      },
    );
  }
});

test("fails closed for missing, conflicting or mismatched OAuth client identity", () => {
  const missing = validInput();
  delete missing.tokenInfoProbeResult.data.issued_to;
  assert.throws(
    () => verifyYouTubeAccountBinding(missing),
    {
      code: "youtube_account_binding_client_identity_required",
    },
  );

  const conflicting = validInput();
  conflicting.tokenInfoProbeResult.data.audience =
    "another-client.apps.googleusercontent.com";
  assert.throws(
    () => verifyYouTubeAccountBinding(conflicting),
    {
      code: "youtube_account_binding_client_identity_conflict",
    },
  );

  const mismatched = validInput();
  mismatched.configuredOAuthClientSha256 = "f".repeat(64);
  assert.throws(
    () => verifyYouTubeAccountBinding(mismatched),
    {
      code: "youtube_account_binding_client_mismatch",
    },
  );
});

test("requires complete, well-formed tokeninfo scope evidence", () => {
  const missingRequired = validInput();
  missingRequired.tokenInfoProbeResult.data.scope = [
    OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
    YOUTUBE_READ_SCOPE_ALTERNATIVES[0],
  ].join(" ");
  assert.throws(
    () => verifyYouTubeAccountBinding(missingRequired),
    {
      code: "youtube_account_binding_required_scope_missing",
    },
  );

  const missingReadCapability = validInput();
  missingReadCapability.tokenInfoProbeResult.data.scope =
    REQUIRED_YOUTUBE_ACCOUNT_SCOPES.join(" ");
  assert.throws(
    () => verifyYouTubeAccountBinding(missingReadCapability),
    {
      code: "youtube_account_binding_read_scope_missing",
    },
  );

  for (const invalidScope of [
    undefined,
    [],
    "https://www.googleapis.com/auth/youtube.upload unknown",
  ]) {
    const input = validInput();
    input.tokenInfoProbeResult.data.scope = invalidScope;
    assert.throws(
      () => verifyYouTubeAccountBinding(input),
      {
        code: "youtube_account_binding_scope_metadata_invalid",
      },
    );
  }
});

test("rejects syntactically valid but unreviewed Google scopes", () => {
  const input = validInput();
  input.tokenInfoProbeResult.data.scope = [
    input.tokenInfoProbeResult.data.scope,
    "https://www.googleapis.com/auth/drive.readonly",
  ].join(" ");

  assert.throws(
    () => verifyYouTubeAccountBinding(input),
    {
      code: "youtube_account_binding_unreviewed_scope_present",
    },
  );
});

test("requires one exact Pulse channel with canonical public, linked and long-upload status", () => {
  const nonRecordStatus = validInput();
  const arrayStatus = [];
  arrayStatus.privacyStatus = "public";
  arrayStatus.isLinked = true;
  arrayStatus.longUploadsStatus = "allowed";
  nonRecordStatus.channelProbeResult.data.items[0].status =
    arrayStatus;
  assert.throws(
    () => verifyYouTubeAccountBinding(nonRecordStatus),
    {
      code: "youtube_account_binding_channel_probe_invalid",
    },
  );

  const scenarios = [
    {
      mutate(input) {
        input.channelProbeResult.data.items = [];
      },
      code: "youtube_account_binding_channel_probe_invalid",
    },
    {
      mutate(input) {
        input.channelProbeResult.data.items.push(
          input.channelProbeResult.data.items[0],
        );
      },
      code: "youtube_account_binding_channel_probe_invalid",
    },
    {
      mutate(input) {
        input.channelProbeResult.data.items[0].id =
          "UC0000000000000000000000";
      },
      code: "youtube_account_binding_channel_mismatch",
    },
    {
      mutate(input) {
        delete input.channelProbeResult.data.items[0].status
          .privacyStatus;
      },
      code: "youtube_account_binding_channel_not_public",
    },
    {
      mutate(input) {
        input.channelProbeResult.data.items[0].status.isLinked =
          "true";
      },
      code: "youtube_account_binding_channel_not_linked",
    },
    {
      mutate(input) {
        input.channelProbeResult.data.items[0].status
          .longUploadsStatus = "unknown";
      },
      code: "youtube_account_binding_long_uploads_not_allowed",
    },
  ];
  for (const scenario of scenarios) {
    const input = validInput();
    scenario.mutate(input);
    assert.throws(
      () => verifyYouTubeAccountBinding(input),
      { code: scenario.code },
    );
  }
});

test("fails closed on unknown or missing invocation and probe structures", () => {
  for (const invocation of [null, [], "unexpected"]) {
    assert.throws(
      () => verifyYouTubeAccountBinding(invocation),
      {
        code: "youtube_account_binding_invocation_invalid",
      },
    );
  }

  const missingTokenInfo = validInput();
  delete missingTokenInfo.tokenInfoProbeResult.data;
  assert.throws(
    () => verifyYouTubeAccountBinding(missingTokenInfo),
    {
      code: "youtube_account_binding_tokeninfo_probe_invalid",
    },
  );

  const missingExpectedChannel = validInput();
  delete missingExpectedChannel.expectedChannelId;
  assert.throws(
    () => verifyYouTubeAccountBinding(missingExpectedChannel),
    {
      code: "youtube_account_binding_expected_channel_required",
    },
  );

  const missingChannelData = validInput();
  delete missingChannelData.channelProbeResult.data;
  assert.throws(
    () => verifyYouTubeAccountBinding(missingChannelData),
    {
      code: "youtube_account_binding_channel_probe_invalid",
    },
  );

  const invalidClock = validInput();
  invalidClock.now = null;
  assert.throws(
    () => verifyYouTubeAccountBinding(invalidClock),
    {
      code: "youtube_account_binding_clock_required",
    },
  );
});
