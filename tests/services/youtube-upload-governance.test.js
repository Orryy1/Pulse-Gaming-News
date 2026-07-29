"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const uploaderPath = path.resolve(__dirname, "..", "..", "upload_youtube.js");
const publisherPath = path.resolve(__dirname, "..", "..", "publisher.js");
const uploaderSource = fs.readFileSync(uploaderPath, "utf8");
const publisherSource = fs.readFileSync(publisherPath, "utf8");
const {
  attachYoutubeRefreshTelemetry,
  buildFreshYoutubeAccountBindingArmInput,
  buildYoutubeShortUploadResult,
  buildYoutubeShortRequestBody,
  createFreshYoutubeAccountBoundSession,
  insertYoutubeVideoOnce,
  loadHashBoundYoutubeMedia,
  probeYoutubeAccountBinding,
  refreshYoutubeCredentialsInMemory,
  resolveGovernedYoutubeMetadata,
  resolveContainsSyntheticMedia,
  uploadAll,
  uploadLongform,
  uploadShort,
} = require("../../upload_youtube");
const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  verifyYouTubeAccountBinding,
} = require("../../lib/services/youtube-account-binding-verifier");

const RUNTIME_PROBE_CLIENT_ID =
  "pulse-client.apps.googleusercontent.com";
const RUNTIME_PROBE_CLIENT_SHA256 =
  "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275";
const RUNTIME_PROBE_AT = "2026-07-29T10:00:00.000Z";

function validRuntimeAccountBindingProof() {
  return verifyYouTubeAccountBinding({
    expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    configuredOAuthClientSha256:
      RUNTIME_PROBE_CLIENT_SHA256,
    tokenInfoProbeResult: {
      checked_at: RUNTIME_PROBE_AT,
      data: {
        issued_to: RUNTIME_PROBE_CLIENT_ID,
        scope: [
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube",
        ].join(" "),
      },
    },
    channelProbeResult: {
      checked_at: RUNTIME_PROBE_AT,
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
    now: () => new Date(RUNTIME_PROBE_AT),
  });
}

test("runtime account-bound session probes and mutates through one non-serialisable YouTube client", async () => {
  const clientSecret = "oauth-client-secret-must-not-return";
  const refreshToken = "refresh-token-must-not-return";
  const oauth2Client = {
    credentials: {
      access_token: "ephemeral-access-token",
      refresh_token: refreshToken,
    },
  };
  const youtubeClient = {
    channels: {
      async list() {
        throw new Error("not_used_by_injected_probe");
      },
    },
    videos: {
      async insert() {
        return { data: { id: "same-session-object" } };
      },
    },
  };
  const probeInputs = [];
  const session = await createFreshYoutubeAccountBoundSession({
    env: {
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
        RUNTIME_PROBE_CLIENT_SHA256,
    },
    now: () => new Date(RUNTIME_PROBE_AT),
    async loadOAuthConfiguration() {
      return {
        clientId: RUNTIME_PROBE_CLIENT_ID,
        clientSecret,
        redirectUri: "http://localhost",
      };
    },
    async createAuthenticatedClient() {
      return oauth2Client;
    },
    youtubeFactory(input) {
      assert.equal(input.auth, oauth2Client);
      return youtubeClient;
    },
    async probeAccountBinding(input) {
      probeInputs.push(input);
      assert.equal(input.oauth2Client, oauth2Client);
      assert.equal(input.youtube, youtubeClient);
      return validRuntimeAccountBindingProof();
    },
  });

  assert.deepEqual(Object.keys(session), []);
  assert.equal(session.getYoutubeClient(), youtubeClient);
  const youtubeAnalyticsClient = {
    reports: {
      async query() {
        return { data: { rows: [] } };
      },
    },
  };
  assert.equal(
    session.createYoutubeAnalyticsClient((input) => {
      assert.equal(input.version, "v2");
      assert.equal(input.auth, oauth2Client);
      return youtubeAnalyticsClient;
    }),
    youtubeAnalyticsClient,
  );
  assert.equal(
    session.getBindingProof().proof_sha256,
    validRuntimeAccountBindingProof().proof_sha256,
  );
  assert.equal(
    (await session.revalidate()).proof_sha256,
    validRuntimeAccountBindingProof().proof_sha256,
  );
  assert.equal(probeInputs.length, 2);
  const serialised = JSON.stringify(session);
  assert.equal(serialised, "{}");
  assert.equal(serialised.includes(RUNTIME_PROBE_CLIENT_ID), false);
  assert.equal(serialised.includes(clientSecret), false);
  assert.equal(serialised.includes(refreshToken), false);
  assert.equal(serialised.includes("ephemeral-access-token"), false);
});

test("T-15 runtime probe wrapper returns only the fresh sanitised Pulse arm-binding package", async () => {
  const clientSecret = "oauth-client-secret-must-not-return";
  const refreshToken = "refresh-token-must-not-return";
  const oauth2Client = {
    credentials: {
      access_token: "ephemeral-access-token",
      refresh_token: refreshToken,
    },
  };
  let authInput = null;
  let probeInput = null;

  const result =
    await buildFreshYoutubeAccountBindingArmInput({
      env: {
        PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
          RUNTIME_PROBE_CLIENT_SHA256,
      },
      now: () => new Date(RUNTIME_PROBE_AT),
      async loadOAuthConfiguration() {
        return {
          clientId: RUNTIME_PROBE_CLIENT_ID,
          clientSecret,
          redirectUri: "http://localhost",
        };
      },
      async createAuthenticatedClient(input) {
        authInput = input;
        return oauth2Client;
      },
      async probeAccountBinding(input) {
        probeInput = input;
        return validRuntimeAccountBindingProof();
      },
    });

  assert.deepEqual(Object.keys(result).sort(), [
    "configuredOAuthClientSha256",
    "expectedChannelId",
    "proof",
  ]);
  assert.equal(
    result.expectedChannelId,
    EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  );
  assert.equal(
    result.configuredOAuthClientSha256,
    RUNTIME_PROBE_CLIENT_SHA256,
  );
  assert.equal(result.proof.verdict, "GREEN");
  assert.equal(
    result.proof.publication_authority_granted,
    false,
  );
  assert.equal(authInput.oauthConfiguration.clientSecret, clientSecret);
  assert.equal(probeInput.oauth2Client, oauth2Client);
  assert.equal(
    probeInput.configuredOAuthClientId,
    RUNTIME_PROBE_CLIENT_ID,
  );
  assert.equal(
    probeInput.expectedOAuthClientSha256,
    RUNTIME_PROBE_CLIENT_SHA256,
  );
  assert.equal(
    probeInput.expectedChannelId,
    EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  );
  assert.equal(
    Object.hasOwn(probeInput, "clientSecret"),
    false,
  );
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes(RUNTIME_PROBE_CLIENT_ID), false);
  assert.equal(serialised.includes(clientSecret), false);
  assert.equal(serialised.includes(refreshToken), false);
});

test("T-15 runtime probe wrapper fails before authentication when the trusted client hash is missing or mismatched", async () => {
  let configurationLoads = 0;
  let authentications = 0;
  let probes = 0;
  const dependencies = {
    async loadOAuthConfiguration() {
      configurationLoads += 1;
      return {
        clientId: RUNTIME_PROBE_CLIENT_ID,
        clientSecret: "must-not-surface",
        redirectUri: "http://localhost",
      };
    },
    async createAuthenticatedClient() {
      authentications += 1;
      throw new Error("authentication_must_not_run");
    },
    async probeAccountBinding() {
      probes += 1;
      throw new Error("probe_must_not_run");
    },
  };

  await assert.rejects(
    buildFreshYoutubeAccountBindingArmInput({
      env: {},
      ...dependencies,
    }),
    {
      code:
        "youtube_runtime_account_binding_expected_client_sha256_required",
    },
  );
  assert.equal(configurationLoads, 0);

  await assert.rejects(
    buildFreshYoutubeAccountBindingArmInput({
      env: {
        PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
          "f".repeat(64),
      },
      ...dependencies,
    }),
    {
      code:
        "youtube_runtime_account_binding_configured_client_mismatch",
    },
  );
  assert.equal(configurationLoads, 1);
  assert.equal(authentications, 0);
  assert.equal(probes, 0);
});

test("T-15 runtime probe wrapper converts probe exceptions and RED evidence into credential-free fail-closed errors", async () => {
  const upstreamSecret =
    "upstream-probe-secret-must-not-surface";
  const common = {
    env: {
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256:
        RUNTIME_PROBE_CLIENT_SHA256,
    },
    async loadOAuthConfiguration() {
      return {
        clientId: RUNTIME_PROBE_CLIENT_ID,
        clientSecret: "client-secret-must-not-surface",
        redirectUri: "http://localhost",
      };
    },
    async createAuthenticatedClient() {
      return {
        credentials: {
          access_token: "access-token-must-not-surface",
          refresh_token: "refresh-token-must-not-surface",
        },
      };
    },
  };

  await assert.rejects(
    buildFreshYoutubeAccountBindingArmInput({
      ...common,
      async probeAccountBinding() {
        throw new Error(
          `Authorization: Bearer ${upstreamSecret}`,
        );
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_runtime_account_binding_probe_failed",
      );
      assert.equal(error.message.includes(upstreamSecret), false);
      return true;
    },
  );

  await assert.rejects(
    buildFreshYoutubeAccountBindingArmInput({
      ...common,
      async probeAccountBinding() {
        return {
          schema_version:
            "pulse-youtube-account-binding-probe-failure-v1",
          verdict: "RED",
          reason_codes: [
            "youtube_account_binding_channel_probe_failed",
          ],
          raw_probe_payload: upstreamSecret,
        };
      },
    }),
    (error) => {
      assert.equal(
        error.code,
        "youtube_runtime_account_binding_probe_not_green",
      );
      assert.equal(error.message.includes(upstreamSecret), false);
      assert.equal(
        JSON.stringify(error).includes(upstreamSecret),
        false,
      );
      return true;
    },
  );
});

test("read-only YouTube account probe returns a sanitised GREEN binding proof without requiring analytics", async () => {
  const accessToken = "access-token-that-must-not-survive";
  const configuredClientId =
    "pulse-client.apps.googleusercontent.com";
  const expectedClientSha256 =
    "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275";
  const expectedChannelId = "UCvgNDjtTezrpxL8oUe6mYwA";
  const requests = [];
  const oauth2Client = {
    credentials: {
      access_token: accessToken,
    },
    async getTokenInfo(receivedToken) {
      assert.equal(receivedToken, accessToken);
      return {
        audience: configuredClientId,
        scopes: [
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube",
        ],
      };
    },
  };
  const youtube = {
    channels: {
      async list(request) {
        requests.push(request);
        return {
          data: {
            items: [
              {
                id: expectedChannelId,
                status: {
                  privacyStatus: "public",
                  isLinked: true,
                  longUploadsStatus: "allowed",
                },
              },
            ],
          },
        };
      },
    },
  };

  const result = await probeYoutubeAccountBinding({
    oauth2Client,
    youtube,
    configuredOAuthClientId: configuredClientId,
    expectedOAuthClientSha256: expectedClientSha256,
    expectedChannelId,
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.expected_channel_id, expectedChannelId);
  assert.equal(
    result.configured_oauth_client_sha256,
    expectedClientSha256,
  );
  assert.equal(result.analytics.learning_ready, false);
  assert.deepEqual(requests, [
    {
      part: ["id", "status"],
      mine: true,
    },
  ]);
  const serialised = JSON.stringify(result);
  assert.equal(serialised.includes(accessToken), false);
  assert.equal(serialised.includes(configuredClientId), false);
  assert.equal(result.side_effects.database_mutated, false);
  assert.equal(result.side_effects.oauth_mutated, false);
  assert.equal(result.publication_authority_granted, false);
});

test("read-only probe preserves conflicting token identities so verification fails closed", async () => {
  const configuredClientId =
    "pulse-client.apps.googleusercontent.com";
  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: "identity-conflict-token",
      },
      async getTokenInfo() {
        return {
          issued_to: configuredClientId,
          audience:
            "different-client.apps.googleusercontent.com",
          aud: configuredClientId,
          scopes: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube",
          ],
        };
      },
    },
    youtube: {
      channels: {
        async list() {
          throw new Error(
            "identity_conflict_must_not_query_channel",
          );
        },
      },
    },
    configuredOAuthClientId: configuredClientId,
    expectedOAuthClientSha256:
      RUNTIME_PROBE_CLIENT_SHA256,
    expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    now: () => new Date(RUNTIME_PROBE_AT),
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, [
    "youtube_account_binding_client_identity_conflict",
  ]);
});

test("read-only YouTube account probe fails closed with machine-readable evidence when tokeninfo fails", async () => {
  const accessToken = "probe-access-token-secret";
  let channelRequests = 0;

  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: accessToken,
      },
      async getTokenInfo() {
        throw new Error(
          `tokeninfo rejected access_token=${accessToken}`,
        );
      },
    },
    youtube: {
      channels: {
        async list() {
          channelRequests += 1;
          return { data: { items: [] } };
        },
      },
    },
    configuredOAuthClientId:
      "pulse-client.apps.googleusercontent.com",
    expectedOAuthClientSha256:
      "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275",
    expectedChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, [
    "youtube_account_binding_tokeninfo_probe_failed",
  ]);
  assert.equal(channelRequests, 0);
  assert.match(result.proof_sha256, /^[a-f0-9]{64}$/);
  assert.equal(
    JSON.stringify(result).includes(accessToken),
    false,
  );
  assert.equal(result.side_effects.oauth_mutated, false);
  assert.equal(result.side_effects.database_mutated, false);
  assert.equal(result.publication_authority_granted, false);
});

test("read-only YouTube account probe binds the observed channel to the caller's explicit expected channel", async () => {
  const expectedChannelId = "UCExplicitCallerBinding0001";
  const configuredClientId =
    "pulse-client.apps.googleusercontent.com";

  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: "ephemeral-access-token",
      },
      async getTokenInfo() {
        return {
          audience: configuredClientId,
          scopes: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube",
          ],
        };
      },
    },
    youtube: {
      channels: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: expectedChannelId,
                  status: {
                    privacyStatus: "public",
                    isLinked: true,
                    longUploadsStatus: "allowed",
                  },
                },
              ],
            },
          };
        },
      },
    },
    configuredOAuthClientId: configuredClientId,
    expectedOAuthClientSha256:
      "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275",
    expectedChannelId,
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(result.expected_channel_id, expectedChannelId);
  assert.equal(result.observed_channel_id, expectedChannelId);
});

test("read-only YouTube account probe returns RED evidence for client, scope, channel and status drift", async () => {
  const configuredClientId =
    "pulse-client.apps.googleusercontent.com";
  const expectedClientSha256 =
    "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275";
  const expectedChannelId = "UCvgNDjtTezrpxL8oUe6mYwA";
  const requiredScopes = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube",
  ];
  const runProbe = async ({
    clientId = configuredClientId,
    scopes = requiredScopes,
    channelId = expectedChannelId,
    status = {
      privacyStatus: "public",
      isLinked: true,
      longUploadsStatus: "allowed",
    },
  } = {}) =>
    probeYoutubeAccountBinding({
      oauth2Client: {
        credentials: {
          access_token: "ephemeral-access-token",
        },
        async getTokenInfo() {
          return {
            audience: clientId,
            scopes,
          };
        },
      },
      youtube: {
        channels: {
          async list() {
            return {
              data: {
                items: [{ id: channelId, status }],
              },
            };
          },
        },
      },
      configuredOAuthClientId: clientId,
      expectedOAuthClientSha256: expectedClientSha256,
      expectedChannelId,
      now: () => new Date("2026-07-29T10:00:00.000Z"),
    });

  const scenarios = [
    {
      input: {
        clientId: "unexpected-client.apps.googleusercontent.com",
      },
      code: "youtube_account_binding_configured_client_mismatch",
    },
    {
      input: {
        scopes: [
          "https://www.googleapis.com/auth/youtube",
        ],
      },
      code: "youtube_account_binding_required_scope_missing",
    },
    {
      input: {
        channelId: "UCUnexpectedObservedChannel001",
      },
      code: "youtube_account_binding_channel_mismatch",
    },
    {
      input: {
        status: {
          privacyStatus: "private",
          isLinked: true,
          longUploadsStatus: "allowed",
        },
      },
      code: "youtube_account_binding_channel_not_public",
    },
  ];

  for (const scenario of scenarios) {
    const result = await runProbe(scenario.input);
    assert.equal(result.verdict, "RED");
    assert.deepEqual(result.reason_codes, [scenario.code]);
    assert.equal(result.external_publish_authorised, false);
    assert.equal(
      JSON.stringify(result).includes(
        scenario.input.clientId || configuredClientId,
      ),
      false,
    );
  }
});

test("read-only YouTube account probe sanitises upstream channel failures", async () => {
  const secret = "channel-probe-upstream-secret";
  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: "ephemeral-access-token",
      },
      async getTokenInfo() {
        return {
          audience: "pulse-client.apps.googleusercontent.com",
          scopes: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube",
          ],
        };
      },
    },
    youtube: {
      channels: {
        async list() {
          throw new Error(`Authorization: Bearer ${secret}`);
        },
      },
    },
    configuredOAuthClientId:
      "pulse-client.apps.googleusercontent.com",
    expectedOAuthClientSha256:
      "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275",
    expectedChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, [
    "youtube_account_binding_channel_probe_failed",
  ]);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("read-only YouTube account probe turns an invalid clock into closed evidence", async () => {
  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: "ephemeral-access-token",
      },
      async getTokenInfo() {
        return {
          audience: "pulse-client.apps.googleusercontent.com",
          scopes: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube",
          ],
        };
      },
    },
    youtube: {
      channels: {
        async list() {
          throw new Error(
            "channel probe must not run after clock rejection",
          );
        },
      },
    },
    configuredOAuthClientId:
      "pulse-client.apps.googleusercontent.com",
    expectedOAuthClientSha256:
      "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275",
    expectedChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    now: () => new Date("invalid"),
  });

  assert.equal(result.verdict, "RED");
  assert.deepEqual(result.reason_codes, [
    "youtube_account_binding_probe_clock_invalid",
  ]);
  assert.equal(result.generated_at, null);
});

test("read-only YouTube account probe consumes the existing in-memory access token without refreshing OAuth", async () => {
  const accessToken = "existing-in-memory-access-token";
  let getAccessTokenCalls = 0;
  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: accessToken,
      },
      async getAccessToken() {
        getAccessTokenCalls += 1;
        throw new Error("automatic refresh must not run");
      },
      async getTokenInfo(receivedToken) {
        assert.equal(receivedToken, accessToken);
        return {
          audience: "pulse-client.apps.googleusercontent.com",
          scopes: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube",
          ],
        };
      },
    },
    youtube: {
      channels: {
        async list() {
          return {
            data: {
              items: [
                {
                  id: "UCvgNDjtTezrpxL8oUe6mYwA",
                  status: {
                    privacyStatus: "public",
                    isLinked: true,
                    longUploadsStatus: "allowed",
                  },
                },
              ],
            },
          };
        },
      },
    },
    configuredOAuthClientId:
      "pulse-client.apps.googleusercontent.com",
    expectedOAuthClientSha256:
      "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275",
    expectedChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });

  assert.equal(result.verdict, "GREEN");
  assert.equal(getAccessTokenCalls, 0);
  assert.equal(result.side_effects.oauth_mutated, false);
});

test("production account probing isolates the bearer token from the refresh-capable OAuth client", async () => {
  const accessToken = "isolated-existing-access-token";
  const refreshToken = "refresh-token-that-must-not-reach-probe-auth";
  const configuredClientId =
    "pulse-client.apps.googleusercontent.com";
  let probeAuthInput = null;
  let youtubeFactoryInput = null;
  const probeAuth = {
    credentials: {
      access_token: accessToken,
      expiry_date: Date.parse("2026-07-29T11:00:00.000Z"),
    },
  };

  const result = await probeYoutubeAccountBinding({
    oauth2Client: {
      credentials: {
        access_token: accessToken,
        refresh_token: refreshToken,
        expiry_date: probeAuth.credentials.expiry_date,
      },
      async getTokenInfo() {
        return {
          audience: configuredClientId,
          scopes: [
            "https://www.googleapis.com/auth/youtube.upload",
            "https://www.googleapis.com/auth/youtube",
          ],
        };
      },
    },
    createProbeAuthClient(input) {
      probeAuthInput = structuredClone(input);
      return probeAuth;
    },
    youtubeFactory(input) {
      youtubeFactoryInput = input;
      return {
        channels: {
          async list() {
            return {
              data: {
                items: [
                  {
                    id: "UCvgNDjtTezrpxL8oUe6mYwA",
                    status: {
                      privacyStatus: "public",
                      isLinked: true,
                      longUploadsStatus: "allowed",
                    },
                  },
                ],
              },
            };
          },
        },
      };
    },
    configuredOAuthClientId: configuredClientId,
    expectedOAuthClientSha256:
      "d1893387ff668c47879c3f64b5b4a7d97f524354aee3401613cfaedd86bc3275",
    expectedChannelId: "UCvgNDjtTezrpxL8oUe6mYwA",
    now: () => new Date("2026-07-29T10:00:00.000Z"),
  });

  assert.equal(result.verdict, "GREEN");
  assert.deepEqual(probeAuthInput, {
    accessToken,
    configuredOAuthClientId: configuredClientId,
    expiryDate: Date.parse("2026-07-29T11:00:00.000Z"),
  });
  assert.equal(youtubeFactoryInput.auth, probeAuth);
  assert.equal(
    Object.hasOwn(
      youtubeFactoryInput.auth.credentials,
      "refresh_token",
    ),
    false,
  );
  assert.equal(
    JSON.stringify(result).includes(refreshToken),
    false,
  );
});

function governedMetadataFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-youtube-metadata-"),
  );
  const metadataPath = path.join(directory, "publication-metadata.json");
  const value = {
    schema_version: "pulse-governed-publication-metadata-v1",
    story_id: "story-1",
    channel_id: "pulse-gaming",
    platform: "youtube_shorts",
    title: "The exact operator-approved title",
    description:
      "The exact operator-approved description.\n\nFootage: © SQUARE ENIX\n\n#Shorts",
  };
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  fs.writeFileSync(metadataPath, bytes);
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    path: metadataPath,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    value,
  };
}

test("the tracked Evercold publication metadata resolves the exact approved YouTube Shorts bytes", () => {
  const metadataPath = path.resolve(
    __dirname,
    "..",
    "..",
    "videos",
    "evercold-bastion-short",
    "publication-metadata.json",
  );
  const bytes = fs.readFileSync(metadataPath);
  const metadata = JSON.parse(bytes.toString("utf8"));
  const approvedSha =
    "94adc0c1d5f04907ffa2a99fa4d6e4debe9ce9c05957010b92af4c953fc3aa85";
  const binding = {
    path: metadataPath,
    sha256: approvedSha,
    platform: "youtube_shorts",
  };

  assert.equal(
    crypto.createHash("sha256").update(bytes).digest("hex"),
    approvedSha,
  );
  assert.equal(binding.sha256, approvedSha);
  assert.equal(binding.platform, "youtube_shorts");

  const resolved = resolveGovernedYoutubeMetadata({
    id: "official_d86953ca92ca",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: binding.sha256,
    governed_publication_metadata: {
      path: metadataPath,
      sha256: binding.sha256,
      platform: binding.platform,
      title: metadata.title,
      description: metadata.description,
    },
  });

  assert.equal(
    resolved.title,
    "Final Fantasy XIV's New Tank Uses TWO Giant Shields",
  );
  assert.equal(resolved.description, metadata.description);
  assert.match(resolved.description, /^Final Fantasy XIV: Evercold/);
  assert.match(resolved.description, /© SQUARE ENIX/);
  assert.match(resolved.description, /#FFXIV #FinalFantasyXIV/);
});

test("governed YouTube metadata resolves the exact hash-bound reviewed title and attributed description", (t) => {
  const approved = governedMetadataFixture(t);
  const resolved = resolveGovernedYoutubeMetadata({
    id: "story-1",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: approved.sha256,
    governed_publication_metadata: {
      path: approved.path,
      sha256: approved.sha256,
      platform: approved.value.platform,
      title: approved.value.title,
      description: approved.value.description,
    },
  });

  assert.equal(resolved.title, approved.value.title);
  assert.equal(resolved.description, approved.value.description);
  assert.match(resolved.description, /© SQUARE ENIX/);
  assert.equal(resolved.sha256, approved.sha256);
});

test("governed YouTube metadata fails closed when approval is missing or its file drifts", (t) => {
  assert.throws(
    () =>
      resolveGovernedYoutubeMetadata({
        id: "story-1",
        channel_id: "pulse-gaming",
      }),
    /governed_dispatch_publication_metadata_required/,
  );

  const approved = governedMetadataFixture(t);
  const story = {
    id: "story-1",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: approved.sha256,
    governed_publication_metadata: {
      path: approved.path,
      sha256: approved.sha256,
      platform: approved.value.platform,
      title: approved.value.title,
      description: approved.value.description,
    },
  };
  fs.appendFileSync(approved.path, " ");

  assert.throws(
    () => resolveGovernedYoutubeMetadata(story),
    /governed_dispatch_publication_metadata_sha256_mismatch/,
  );
});

test("governed YouTube metadata rejects a snapshot that differs from the approved file", (t) => {
  const approved = governedMetadataFixture(t);
  const story = {
    id: "story-1",
    channel_id: "pulse-gaming",
    governed_publication_metadata_sha256: approved.sha256,
    governed_publication_metadata: {
      path: approved.path,
      sha256: approved.sha256,
      platform: approved.value.platform,
      title: "A mutable replacement title",
      description: approved.value.description,
    },
  };

  assert.throws(
    () => resolveGovernedYoutubeMetadata(story),
    /governed_dispatch_publication_metadata_binding_mismatch/,
  );
});

test("governed YouTube metadata rejects a CWD-relative binding at the final upload boundary", (t) => {
  const approved = governedMetadataFixture(t);
  const relativeBinding = path.join(
    ".",
    "relative-publication-metadata.json",
  );

  assert.throws(
    () =>
      resolveGovernedYoutubeMetadata({
        id: "story-1",
        channel_id: "pulse-gaming",
        governed_publication_metadata_sha256: approved.sha256,
        governed_publication_metadata: {
          path: relativeBinding,
          sha256: approved.sha256,
          platform: approved.value.platform,
          title: approved.value.title,
          description: approved.value.description,
        },
      }),
    /governed_dispatch_publication_metadata_canonical_absolute_path_required/,
  );
});

test("YouTube create mutation is attempted exactly once when its response is ambiguous", async () => {
  let attempts = 0;
  const responseLost = new Error("response lost after request body sent");
  const youtube = {
    videos: {
      async insert() {
        attempts += 1;
        throw responseLost;
      },
    },
  };

  await assert.rejects(
    insertYoutubeVideoOnce(youtube, { requestBody: {} }),
    (error) => error === responseLost,
  );
  assert.equal(attempts, 1);
});

test("governed YouTube request carries the reviewed altered-content decision", () => {
  const disclosed = {
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };
  const notDisclosed = {
    synthetic_media_disclosure: {
      contains_synthetic_media: false,
      decision: "NO_DISCLOSURE_REQUIRED",
      rationale: "The final edit contains no realistic altered content.",
      disclosure_text: null,
      youtube_field_value: false,
      reviewed_at: "2026-07-27T08:45:00.000Z",
    },
  };

  assert.equal(resolveContainsSyntheticMedia(disclosed), true);
  assert.equal(resolveContainsSyntheticMedia(notDisclosed), false);
  assert.equal(
    buildYoutubeShortRequestBody(disclosed, {
      title: "Reviewed title",
      description: "Reviewed description",
      tags: ["Pulse Gaming News"],
      categoryId: "20",
    }).status.containsSyntheticMedia,
    true,
  );
  assert.throws(
    () => resolveContainsSyntheticMedia({}),
    /youtube_synthetic_disclosure_decision_required/,
  );
  assert.throws(
    () =>
      resolveContainsSyntheticMedia({
        synthetic_media_disclosure: {
          ...disclosed.synthetic_media_disclosure,
          youtube_field_value: false,
        },
      }),
    /youtube_synthetic_disclosure_field_mismatch/,
  );
});

test("governed YouTube request can pre-stage an exact guarded release as private with publishAt", () => {
  const story = {
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-28T17:30:00.000Z",
    },
  };

  const request = buildYoutubeShortRequestBody(story, {
    title: "Reviewed title",
    description: "Reviewed description",
    tags: ["Pulse Gaming News"],
    categoryId: "20",
    scheduledFor: "2026-07-28T19:00:00.000Z",
    now: "2026-07-28T18:45:00.000Z",
  });

  assert.equal(request.status.privacyStatus, "private");
  assert.equal(
    request.status.publishAt,
    "2026-07-28T19:00:00.000Z",
  );
  assert.equal(request.status.containsSyntheticMedia, true);
});

test("governed YouTube request can pre-stage an exact object as private without arming publishAt", () => {
  const story = {
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale: "Synthetic narration is present.",
      disclosure_text: "Includes AI-generated narration.",
      youtube_field_value: true,
      reviewed_at: "2026-07-28T17:30:00.000Z",
    },
  };

  const request = buildYoutubeShortRequestBody(story, {
    title: "Reviewed title",
    description: "Reviewed description",
    tags: ["Pulse Gaming News"],
    categoryId: "20",
    privateOnly: true,
    now: "2026-07-28T17:50:00.000Z",
  });

  assert.equal(request.status.privacyStatus, "private");
  assert.equal(
    Object.hasOwn(request.status, "publishAt"),
    false,
    "a T-70 private pre-upload must not carry scheduled release authority",
  );
  assert.equal(request.status.containsSyntheticMedia, true);
});

test("privateOnly upload telemetry reports the requested private state without inventing publishAt", () => {
  const story = {
    synthetic_media_disclosure: {
      decision: "NO_DISCLOSURE_REQUIRED",
      youtube_field_value: false,
    },
  };
  const requestBody = buildYoutubeShortRequestBody(
    story,
    {
      title: "Reviewed title",
      description: "Reviewed description",
      tags: ["Pulse Gaming News"],
      categoryId: "20",
      privateOnly: true,
      now: "2026-07-28T17:50:00.000Z",
    },
  );

  const result = buildYoutubeShortUploadResult({
    videoId: "private-object-1",
    requestBody,
    responseData: { id: "private-object-1" },
  });

  assert.equal(result.privacyStatus, "private");
  assert.equal(
    result.requestedPrivacyStatus,
    "private",
  );
  assert.equal(
    Object.hasOwn(result, "scheduledFor"),
    false,
  );
  assert.equal(
    Object.hasOwn(result, "publishAt"),
    false,
  );
});

test("YouTube scheduled release request rejects past, zone-less and non-guarded times", () => {
  const story = {
    synthetic_media_disclosure: {
      decision: "NO_DISCLOSURE_REQUIRED",
      youtube_field_value: false,
    },
  };
  const base = {
    title: "Reviewed title",
    description: "Reviewed description",
    tags: [],
    categoryId: "20",
    now: "2026-07-28T18:45:00.000Z",
  };

  assert.throws(
    () =>
      buildYoutubeShortRequestBody(story, {
        ...base,
        scheduledFor: "2026-07-28T09:00:00.000Z",
      }),
    /youtube_scheduled_publish_time_expired/,
  );
  assert.throws(
    () =>
      buildYoutubeShortRequestBody(story, {
        ...base,
        scheduledFor: "2026-07-28T19:00:00",
      }),
    /youtube_scheduled_publish_timezone_required/,
  );
  assert.throws(
    () =>
      buildYoutubeShortRequestBody(story, {
        ...base,
        scheduledFor: "2026-07-28T20:00:00.000Z",
      }),
    /youtube_scheduled_publish_window_not_guarded/,
  );
});

test("YouTube adapter refuses direct Short and legacy batch mutation paths", async () => {
  await assert.rejects(
    uploadShort({ id: "story-1", title: "Direct call" }),
    /governed_youtube_dispatch_required/,
  );
  await assert.rejects(
    uploadAll(),
    /legacy_youtube_batch_publish_disabled_use_governed_queue/,
  );
});

test("governed Short upload validates approved metadata before OAuth or the create boundary", async () => {
  let createBoundaryStarted = false;

  await assert.rejects(
    uploadShort(
      {
        id: "story-1",
        channel_id: "pulse-gaming",
        title: "Mutable database title",
      },
      {
        governedDispatch: true,
        markCreateAttemptStarted() {
          createBoundaryStarted = true;
        },
      },
    ),
    /governed_dispatch_publication_metadata_required/,
  );
  assert.equal(createBoundaryStarted, false);
});

test("YouTube create streams the approved bytes even if the source path is replaced after binding", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-youtube-bound-media-"),
  );
  const mediaPath = path.join(directory, "approved.mp4");
  const approvedBytes = Buffer.alloc(24 * 1024, 0x2a);
  const replacementBytes = Buffer.alloc(24 * 1024, 0x7f);
  const approvedSha256 = crypto
    .createHash("sha256")
    .update(approvedBytes)
    .digest("hex");
  fs.writeFileSync(mediaPath, approvedBytes);
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const bound = await loadHashBoundYoutubeMedia(
    { exported_path: mediaPath },
    approvedSha256,
  );
  fs.writeFileSync(mediaPath, replacementBytes);

  const chunks = [];
  for await (const chunk of bound.createReadStream()) {
    chunks.push(chunk);
  }
  assert.deepEqual(Buffer.concat(chunks), approvedBytes);
  assert.equal(bound.sha256, approvedSha256);
  assert.equal(bound.byteLength, approvedBytes.length);
  assert.throws(
    () => bound.createReadStream(),
    /youtube_bound_media_stream_already_consumed/,
  );
});

test("YouTube media binding rejects bytes that do not match the approved SHA before create", async (t) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-youtube-media-mismatch-"),
  );
  const mediaPath = path.join(directory, "drifted.mp4");
  fs.writeFileSync(mediaPath, Buffer.alloc(24 * 1024, 0x55));
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await assert.rejects(
    loadHashBoundYoutubeMedia(
      { exported_path: mediaPath },
      "a".repeat(64),
    ),
    /youtube_media_sha256_mismatch/,
  );
});

test("expired YouTube credentials refresh in memory without a token-file write", async () => {
  const original = {
    access_token: "expired-access-token",
    refresh_token: "durable-refresh-token",
    expiry_date: 1,
  };
  const applied = [];
  let refreshes = 0;
  const oauth2Client = {
    setCredentials(credentials) {
      applied.push(credentials);
    },
    async refreshAccessToken() {
      refreshes += 1;
      return {
        credentials: {
          access_token: "fresh-access-token",
          expiry_date: 9_999_999,
        },
      };
    },
  };

  const result = await refreshYoutubeCredentialsInMemory(
    oauth2Client,
    original,
    {
      nowMs: 100_000,
      telemetry: {
        schema_version: "pulse-youtube-auth-telemetry-v1",
        durable_oauth_or_token_mutated: false,
        ephemeral_access_token_refresh: {
          attempted: false,
          succeeded: false,
          failed: false,
        },
      },
    },
  );

  assert.equal(refreshes, 1);
  assert.equal(result.refreshed, true);
  assert.deepEqual(result.credentials, {
    access_token: "fresh-access-token",
    refresh_token: "durable-refresh-token",
    expiry_date: 9_999_999,
  });
  assert.deepEqual(applied, [result.credentials]);
  assert.deepEqual(result.telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: true,
    failed: false,
  });
});

test("failed in-memory refresh reports ephemeral failure and emits no secret", async () => {
  const secret = "refresh-secret-value";
  const telemetry = {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };

  await assert.rejects(
    refreshYoutubeCredentialsInMemory(
      {
        async refreshAccessToken() {
          throw new Error(`Bearer ${secret} was rejected`);
        },
      },
      {
        access_token: "expired",
        refresh_token: "durable-refresh",
        expiry_date: 1,
      },
      { nowMs: 100_000, telemetry },
    ),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: false,
    failed: true,
  });
});

test("google-auth automatic refresh telemetry observes tokens events without retaining credentials", async () => {
  const telemetry = {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };
  const observed = [];
  const oauth2Client = new EventEmitter();
  oauth2Client.refreshToken = async function refreshToken() {
    this.emit("tokens", {
      access_token: "access-secret-that-must-not-survive",
    });
    return { tokens: { access_token: "another-secret" } };
  };
  attachYoutubeRefreshTelemetry(
    oauth2Client,
    telemetry,
    (value) => observed.push(value),
  );

  await oauth2Client.refreshToken("refresh-secret-that-must-not-survive");

  assert.deepEqual(telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: true,
    failed: false,
  });
  assert.equal(
    JSON.stringify(observed).includes("secret-that-must-not-survive"),
    false,
  );
});

test("google-auth automatic refresh failures are observed and sanitised", async () => {
  const secret = "automatic-refresh-secret";
  const telemetry = {
    schema_version: "pulse-youtube-auth-telemetry-v1",
    durable_oauth_or_token_mutated: false,
    ephemeral_access_token_refresh: {
      attempted: false,
      succeeded: false,
      failed: false,
    },
  };
  const oauth2Client = new EventEmitter();
  oauth2Client.refreshToken = async () => {
    throw new Error(`refresh_token=${secret}`);
  };
  attachYoutubeRefreshTelemetry(oauth2Client, telemetry);

  await assert.rejects(
    oauth2Client.refreshToken("durable-refresh-secret"),
    (error) => {
      assert.equal(error.message.includes(secret), false);
      return true;
    },
  );
  assert.deepEqual(telemetry.ephemeral_access_token_refresh, {
    attempted: true,
    succeeded: false,
    failed: true,
  });
});

test("ordinary runtime authentication contains no durable YouTube token persistence path", () => {
  const authClientSource = uploaderSource.slice(
    uploaderSource.indexOf("async function getAuthClient"),
    uploaderSource.indexOf("// --- Generate auth URL"),
  );

  assert.doesNotMatch(
    authClientSource,
    /\b(?:fs\.writeJson|atomicReplaceJson|completeYoutubeOAuthConsent)\b/,
  );
});

test("long-form YouTube mutation is frozen by the default stabilisation profile", async (t) => {
  const previous = process.env.PULSE_SCHEDULER_PROFILE;
  delete process.env.PULSE_SCHEDULER_PROFILE;
  t.after(() => {
    if (previous === undefined) delete process.env.PULSE_SCHEDULER_PROFILE;
    else process.env.PULSE_SCHEDULER_PROFILE = previous;
  });

  await assert.rejects(
    uploadLongform({}),
    /stabilisation_longform_upload_disabled/,
  );
});

test("publisher is the governed Short caller and the adapter has no generic mutation retry", () => {
  assert.doesNotMatch(uploaderSource, /\bwithRetry\b/);
  assert.match(
    publisherSource,
    /uploadShort\(uploadStory,\s*\{\s*governedDispatch:\s*true,\s*markCreateAttemptStarted,\s*assertYoutubeCreateBoundary,\s*reportAuthTelemetry:\s*reportYoutubeAuthTelemetry,\s*expectedMediaSha256:\s*currentFingerprint\.media_sha256,\s*\}\)/,
  );
  assert.match(
    publisherSource,
    /synthetic_media_disclosure:\s*scheduledBeforeDispatch\.publicationEvidence\s*\.synthetic_media_disclosure/,
  );
  assert.match(
    uploaderSource,
    /const governedMetadata = resolveGovernedYoutubeMetadata\(story\);[\s\S]*const \{ tags \} = buildMetadata\(story\);[\s\S]*title: governedMetadata\.title,[\s\S]*description: governedMetadata\.description/,
  );
  assert.match(
    uploaderSource,
    /async function uploadShort\(\s*story,\s*\{\s*governedDispatch\s*=\s*false,\s*markCreateAttemptStarted\s*=\s*null,\s*assertYoutubeCreateBoundary\s*=\s*null,\s*reportAuthTelemetry\s*=\s*null,\s*expectedMediaSha256\s*=\s*null,\s*scheduledFor\s*=\s*null,\s*privateOnly\s*=\s*false,\s*youtubeAccountBoundSession\s*=\s*null,\s*\}\s*=\s*\{\},?\s*\)/,
  );
  assert.match(
    uploaderSource,
    /const boundMedia = await loadHashBoundYoutubeMedia\(\s*story,\s*expectedMediaSha256,\s*\);[\s\S]*invokeTrustedYoutubeCreateBoundaryGate\([\s\S]*media:\s*\{\s*body:\s*boundMedia\.createReadStream\(\),\s*\}/,
  );
  assert.match(
    uploaderSource,
    /youtubeAccountBoundSession\.revalidate\(\);[\s\S]*invokeTrustedYoutubeCreateBoundaryGate\(\s*assertYoutubeCreateBoundary,\s*\);[\s\S]*youtubeAccountBoundSession\.getYoutubeClient\(\)\s*!==\s*youtube[\s\S]*markCreateAttemptStarted\(\);\s*const response = await insertYoutubeVideoOnce/,
  );
  assert.match(publisherSource, /trustedYoutubeCreateBoundaryGates = new WeakSet/);
  assert.match(
    publisherSource,
    /function issueTrustedYoutubeCreateBoundaryGate\(/,
  );
  assert.doesNotMatch(
    publisherSource,
    /module\.exports\s*=\s*\{[\s\S]*issueTrustedYoutubeCreateBoundaryGate/,
  );
});
