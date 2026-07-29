"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  exchangeCode,
  generateAuthUrl,
  runYoutubeOAuthCli,
} = require("../../upload_youtube");
const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  OPTIONAL_YOUTUBE_ANALYTICS_SCOPE,
  REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
  YOUTUBE_READ_SCOPE_ALTERNATIVES,
  verifyYouTubeAccountBinding,
} = require("../../lib/services/youtube-account-binding-verifier");

function clientSha256(clientId) {
  return crypto.createHash("sha256").update(clientId, "utf8").digest("hex");
}

function accountBindingProof({
  clientId,
  checkedAt,
  channelId = EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  includeAnalytics = true,
}) {
  return verifyYouTubeAccountBinding({
    expectedChannelId: channelId,
    configuredOAuthClientSha256: clientSha256(clientId),
    tokenInfoProbeResult: {
      checked_at: checkedAt,
      data: {
        issued_to: clientId,
        scope: [
          ...REQUIRED_YOUTUBE_ACCOUNT_SCOPES,
          YOUTUBE_READ_SCOPE_ALTERNATIVES[0],
          ...(includeAnalytics ? [OPTIONAL_YOUTUBE_ANALYTICS_SCOPE] : []),
        ].join(" "),
      },
    },
    channelProbeResult: {
      checked_at: checkedAt,
      data: {
        items: [
          {
            id: channelId,
            status: {
              privacyStatus: "public",
              isLinked: true,
              longUploadsStatus: "allowed",
            },
          },
        ],
      },
    },
    now: () => new Date(checkedAt),
  });
}

function consentFixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-youtube-oauth-consent-"),
  );
  const tokenDirectory = path.join(directory, "tokens");
  const credentialsPath = path.join(tokenDirectory, "youtube_credentials.json");
  const tokenPath = path.join(tokenDirectory, "youtube_token.json");
  const pendingConsentPath = path.join(
    tokenDirectory,
    "youtube_oauth_pending.json",
  );
  fs.mkdirSync(tokenDirectory, { recursive: true });
  t.after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    credentialsPath,
    directory,
    pendingConsentPath,
    tokenDirectory,
    tokenPath,
  };
}

test("YouTube auth command loads file configuration, binds OAuth state and persists only its hash beside the token", async (t) => {
  const fixture = consentFixture(t);
  const clientSecret = "test-client-secret-must-not-be-persisted";
  await fsp.writeFile(
    fixture.credentialsPath,
    `${JSON.stringify(
      {
        installed: {
          client_id: "pulse-test.apps.googleusercontent.com",
          client_secret: clientSecret,
          redirect_uris: ["http://127.0.0.1:53682/oauth2callback"],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const logs = [];
  const stateBytes = Buffer.alloc(32, 0xab);
  const result = await generateAuthUrl({
    credentialsPath: fixture.credentialsPath,
    env: {
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(
        "pulse-test.apps.googleusercontent.com",
      ),
    },
    log(message) {
      logs.push(String(message));
    },
    now: () => new Date("2026-07-29T15:00:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return stateBytes;
    },
    tokenPath: fixture.tokenPath,
  });

  const parsed = new URL(result.url);
  const state = parsed.searchParams.get("state");
  assert.equal(
    parsed.searchParams.get("client_id"),
    "pulse-test.apps.googleusercontent.com",
  );
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "http://127.0.0.1:53682/oauth2callback",
  );
  assert.equal(state, stateBytes.toString("hex"));
  assert.equal(parsed.searchParams.get("access_type"), "offline");
  assert.equal(parsed.searchParams.get("prompt"), "consent");

  const pending = JSON.parse(
    await fsp.readFile(fixture.pendingConsentPath, "utf8"),
  );
  assert.deepEqual(pending, {
    schema_version: "pulse-youtube-oauth-pending-v1",
    provider: "youtube",
    state_sha256: crypto
      .createHash("sha256")
      .update(state, "utf8")
      .digest("hex"),
    oauth_client_sha256: crypto
      .createHash("sha256")
      .update("pulse-test.apps.googleusercontent.com", "utf8")
      .digest("hex"),
    redirect_uri_sha256: crypto
      .createHash("sha256")
      .update("http://127.0.0.1:53682/oauth2callback", "utf8")
      .digest("hex"),
    issued_at: "2026-07-29T15:00:00.000Z",
    expires_at: "2026-07-29T15:10:00.000Z",
  });
  const persisted = await fsp.readFile(fixture.pendingConsentPath, "utf8");
  assert.equal(persisted.includes(state), false);
  assert.equal(persisted.includes(clientSecret), false);
  assert.equal(logs.join("\n").includes(clientSecret), false);
});

test("YouTube auth command loads environment configuration when no credentials file exists", async (t) => {
  const fixture = consentFixture(t);
  const missingCredentialsPath = path.join(
    fixture.directory,
    "missing",
    "youtube_credentials.json",
  );
  const env = {
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(
      "pulse-env.apps.googleusercontent.com",
    ),
    YOUTUBE_CLIENT_ID: "pulse-env.apps.googleusercontent.com",
    YOUTUBE_CLIENT_SECRET: "env-client-secret-must-not-be-printed",
    YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54891/oauth2callback",
  };
  const result = await generateAuthUrl({
    credentialsPath: missingCredentialsPath,
    env,
    log() {},
    now: () => new Date("2026-07-29T15:05:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return Buffer.alloc(32, 0xcd);
    },
    tokenPath: fixture.tokenPath,
  });

  const parsed = new URL(result.url);
  assert.equal(
    parsed.searchParams.get("client_id"),
    "pulse-env.apps.googleusercontent.com",
  );
  assert.equal(
    parsed.searchParams.get("redirect_uri"),
    "http://127.0.0.1:54891/oauth2callback",
  );
});

test("YouTube auth command rejects a swapped OAuth client before creating consent state", async (t) => {
  const fixture = consentFixture(t);
  const configuredClientId = "swapped-client.apps.googleusercontent.com";

  await assert.rejects(
    generateAuthUrl({
      credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
      env: {
        PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(
          "trusted-client.apps.googleusercontent.com",
        ),
        YOUTUBE_CLIENT_ID: configuredClientId,
        YOUTUBE_CLIENT_SECRET: "swapped-client-secret",
        YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54895/oauth2callback",
      },
      log() {},
      now: () => new Date("2026-07-29T15:07:00.000Z"),
      pendingConsentPath: fixture.pendingConsentPath,
      randomBytes() {
        return Buffer.alloc(32, 0xde);
      },
      tokenPath: fixture.tokenPath,
    }),
    /youtube_oauth_configured_client_mismatch/,
  );

  assert.equal(fs.existsSync(fixture.pendingConsentPath), false);
});

test("YouTube token replacement is rejected unless the caller explicitly authorises this one mutation", async (t) => {
  const fixture = consentFixture(t);
  const originalTokenBytes = '{"refresh_token":"existing-refresh-token"}\n';
  await fsp.writeFile(fixture.tokenPath, originalTokenBytes, "utf8");
  let exchangeCalls = 0;

  await assert.rejects(
    exchangeCode(
      "http://127.0.0.1/oauth2callback?code=new-code&state=new-state",
      {
        credentialsPath: fixture.credentialsPath,
        explicitTokenReplacement: false,
        oauthClientFactory() {
          return {
            async getToken() {
              exchangeCalls += 1;
              return {
                tokens: {
                  refresh_token: "new-refresh-token",
                },
              };
            },
          };
        },
        pendingConsentPath: fixture.pendingConsentPath,
        tokenPath: fixture.tokenPath,
      },
    ),
    /youtube_oauth_explicit_token_replacement_required/,
  );

  assert.equal(exchangeCalls, 0);
  assert.equal(
    await fsp.readFile(fixture.tokenPath, "utf8"),
    originalTokenBytes,
  );
});

test("YouTube token command rejects a callback with the wrong OAuth state before exchange", async (t) => {
  const fixture = consentFixture(t);
  const env = {
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(
      "pulse-state.apps.googleusercontent.com",
    ),
    YOUTUBE_CLIENT_ID: "pulse-state.apps.googleusercontent.com",
    YOUTUBE_CLIENT_SECRET: "state-client-secret-must-not-be-printed",
    YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54892/oauth2callback",
  };
  const originalTokenBytes =
    '{"refresh_token":"existing-state-refresh-token"}\n';
  await fsp.writeFile(fixture.tokenPath, originalTokenBytes, "utf8");
  const initiated = await generateAuthUrl({
    credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
    env,
    log() {},
    now: () => new Date("2026-07-29T15:10:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return Buffer.alloc(32, 0xef);
    },
    tokenPath: fixture.tokenPath,
  });
  assert.ok(new URL(initiated.url).searchParams.get("state"));

  let exchangeCalls = 0;
  await assert.rejects(
    exchangeCode(
      `${env.YOUTUBE_REDIRECT_URI}?code=fresh-code&state=${"0".repeat(64)}`,
      {
        credentialsPath: path.join(
          fixture.directory,
          "missing-credentials.json",
        ),
        env,
        explicitTokenReplacement: true,
        now: () => new Date("2026-07-29T15:11:00.000Z"),
        oauthClientFactory() {
          return {
            async getToken() {
              exchangeCalls += 1;
              return {
                tokens: {
                  refresh_token: "attacker-controlled-refresh-token",
                },
              };
            },
          };
        },
        pendingConsentPath: fixture.pendingConsentPath,
        tokenPath: fixture.tokenPath,
      },
    ),
    /youtube_oauth_state_mismatch/,
  );

  assert.equal(exchangeCalls, 0);
  assert.equal(
    await fsp.readFile(fixture.tokenPath, "utf8"),
    originalTokenBytes,
  );
});

test("YouTube token command rejects a noncanonical pending expiry before exchange", async (t) => {
  const fixture = consentFixture(t);
  const clientId = "pulse-expiry.apps.googleusercontent.com";
  const env = {
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(clientId),
    YOUTUBE_CLIENT_ID: clientId,
    YOUTUBE_CLIENT_SECRET: "expiry-client-secret",
    YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54895/oauth2callback",
  };
  const initiated = await generateAuthUrl({
    credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
    env,
    log() {},
    now: () => new Date("2026-07-29T15:40:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return Buffer.alloc(32, 0x56);
    },
    tokenPath: fixture.tokenPath,
  });
  const state = new URL(initiated.url).searchParams.get("state");
  const pending = JSON.parse(
    await fsp.readFile(fixture.pendingConsentPath, "utf8"),
  );
  pending.expires_at = "not-an-iso-timestamp";
  await fsp.writeFile(
    fixture.pendingConsentPath,
    `${JSON.stringify(pending, null, 2)}\n`,
    "utf8",
  );
  let exchangeCalls = 0;

  await assert.rejects(
    exchangeCode(
      `${env.YOUTUBE_REDIRECT_URI}?code=expiry-code&state=${state}`,
      {
        credentialsPath: path.join(
          fixture.directory,
          "missing-credentials.json",
        ),
        env,
        explicitTokenReplacement: true,
        now: () => new Date("2026-07-29T15:41:00.000Z"),
        oauthClientFactory() {
          return {
            async getToken() {
              exchangeCalls += 1;
              return {
                tokens: {
                  refresh_token: "must-not-be-used",
                },
              };
            },
          };
        },
        pendingConsentPath: fixture.pendingConsentPath,
        tokenPath: fixture.tokenPath,
      },
    ),
    /youtube_oauth_pending_state_timestamp_invalid/,
  );
  assert.equal(exchangeCalls, 0);
});

test("YouTube token command rejects a future-issued pending state before exchange", async (t) => {
  const fixture = consentFixture(t);
  const clientId = "pulse-future.apps.googleusercontent.com";
  const env = {
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(clientId),
    YOUTUBE_CLIENT_ID: clientId,
    YOUTUBE_CLIENT_SECRET: "future-client-secret",
    YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54896/oauth2callback",
  };
  const initiated = await generateAuthUrl({
    credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
    env,
    log() {},
    now: () => new Date("2026-07-29T16:00:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return Buffer.alloc(32, 0x67);
    },
    tokenPath: fixture.tokenPath,
  });
  const state = new URL(initiated.url).searchParams.get("state");
  let exchangeCalls = 0;

  await assert.rejects(
    exchangeCode(
      `${env.YOUTUBE_REDIRECT_URI}?code=future-code&state=${state}`,
      {
        credentialsPath: path.join(
          fixture.directory,
          "missing-credentials.json",
        ),
        env,
        explicitTokenReplacement: true,
        now: () => new Date("2026-07-29T15:59:59.999Z"),
        oauthClientFactory() {
          return {
            async getToken() {
              exchangeCalls += 1;
              return {
                tokens: {
                  refresh_token: "must-not-be-used",
                },
              };
            },
          };
        },
        pendingConsentPath: fixture.pendingConsentPath,
        tokenPath: fixture.tokenPath,
      },
    ),
    /youtube_oauth_pending_state_issued_in_future/,
  );
  assert.equal(exchangeCalls, 0);
});

test("YouTube token command requires the pending-state TTL to be exactly ten positive minutes", async (t) => {
  const issuedAt = "2026-07-29T16:10:00.000Z";
  const invalidTtlMs = [-1, 0, 9 * 60 * 1000, 11 * 60 * 1000];

  for (const [index, ttlMs] of invalidTtlMs.entries()) {
    const fixture = consentFixture(t);
    const clientId = `pulse-ttl-${index}.apps.googleusercontent.com`;
    const env = {
      PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(clientId),
      YOUTUBE_CLIENT_ID: clientId,
      YOUTUBE_CLIENT_SECRET: "ttl-client-secret",
      YOUTUBE_REDIRECT_URI: `http://127.0.0.1:${54900 + index}/oauth2callback`,
    };
    const initiated = await generateAuthUrl({
      credentialsPath: path.join(
        fixture.directory,
        "missing-credentials.json",
      ),
      env,
      log() {},
      now: () => new Date(issuedAt),
      pendingConsentPath: fixture.pendingConsentPath,
      randomBytes() {
        return Buffer.alloc(32, 0x70 + index);
      },
      tokenPath: fixture.tokenPath,
    });
    const state = new URL(initiated.url).searchParams.get("state");
    const pending = JSON.parse(
      await fsp.readFile(fixture.pendingConsentPath, "utf8"),
    );
    pending.expires_at = new Date(
      Date.parse(issuedAt) + ttlMs,
    ).toISOString();
    await fsp.writeFile(
      fixture.pendingConsentPath,
      `${JSON.stringify(pending, null, 2)}\n`,
      "utf8",
    );
    let exchangeCalls = 0;

    await assert.rejects(
      exchangeCode(
        `${env.YOUTUBE_REDIRECT_URI}?code=ttl-code&state=${state}`,
        {
          credentialsPath: path.join(
            fixture.directory,
            "missing-credentials.json",
          ),
          env,
          explicitTokenReplacement: true,
          now: () => new Date(issuedAt),
          oauthClientFactory() {
            return {
              async getToken() {
                exchangeCalls += 1;
                return {
                  tokens: {
                    refresh_token: "must-not-be-used",
                  },
                };
              },
            };
          },
          pendingConsentPath: fixture.pendingConsentPath,
          tokenPath: fixture.tokenPath,
        },
      ),
      /youtube_oauth_pending_state_ttl_invalid/,
      `TTL ${ttlMs}ms must fail closed`,
    );
    assert.equal(exchangeCalls, 0);
  }
});

test("YouTube token command atomically replaces the token once and returns no credential material", async (t) => {
  const fixture = consentFixture(t);
  const env = {
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(
      "pulse-success.apps.googleusercontent.com",
    ),
    YOUTUBE_CLIENT_ID: "pulse-success.apps.googleusercontent.com",
    YOUTUBE_CLIENT_SECRET: "success-client-secret-must-not-leak",
    YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54893/oauth2callback",
  };
  const oldToken = {
    refresh_token: "old-refresh-token-must-be-replaced",
  };
  await fsp.writeFile(
    fixture.tokenPath,
    `${JSON.stringify(oldToken)}\n`,
    "utf8",
  );
  const initiated = await generateAuthUrl({
    credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
    env,
    log() {},
    now: () => new Date("2026-07-29T15:20:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return Buffer.alloc(32, 0x12);
    },
    tokenPath: fixture.tokenPath,
  });
  const state = new URL(initiated.url).searchParams.get("state");
  const newTokens = {
    access_token: "new-access-token-must-stay-in-token-file",
    refresh_token: "new-refresh-token-must-stay-in-token-file",
    scope:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly",
    token_type: "Bearer",
  };
  let exchangeCalls = 0;
  const callbackUrl = `${env.YOUTUBE_REDIRECT_URI}?code=one-time-code&state=${state}`;
  const result = await exchangeCode(callbackUrl, {
    credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
    env,
    explicitTokenReplacement: true,
    now: () => new Date("2026-07-29T15:21:00.000Z"),
    oauthClientFactory(configuration) {
      assert.equal(configuration.clientId, env.YOUTUBE_CLIENT_ID);
      assert.equal(configuration.clientSecret, env.YOUTUBE_CLIENT_SECRET);
      return {
        async getToken(code) {
          exchangeCalls += 1;
          assert.equal(code, "one-time-code");
          return { tokens: newTokens };
        },
      };
    },
    pendingConsentPath: fixture.pendingConsentPath,
    async probeTokenCandidate() {
      return accountBindingProof({
        clientId: env.YOUTUBE_CLIENT_ID,
        checkedAt: "2026-07-29T15:21:00.000Z",
      });
    },
    tokenPath: fixture.tokenPath,
  });

  assert.deepEqual(result, {
    saved: true,
    token_path: fixture.tokenPath,
    refresh_token_present: true,
  });
  assert.equal(JSON.stringify(result).includes(newTokens.access_token), false);
  assert.deepEqual(
    JSON.parse(await fsp.readFile(fixture.tokenPath, "utf8")),
    newTokens,
  );
  assert.equal(fs.existsSync(fixture.pendingConsentPath), false);
  assert.deepEqual(
    (await fsp.readdir(fixture.tokenDirectory)).filter(
      (entry) => entry.includes(".tmp") || entry.includes(".claimed"),
    ),
    [],
  );

  await assert.rejects(
    exchangeCode(callbackUrl, {
      credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
      env,
      explicitTokenReplacement: true,
      oauthClientFactory() {
        return {
          async getToken() {
            exchangeCalls += 1;
            return { tokens: newTokens };
          },
        };
      },
      pendingConsentPath: fixture.pendingConsentPath,
      tokenPath: fixture.tokenPath,
    }),
    /youtube_oauth_pending_state_required/,
  );
  assert.equal(exchangeCalls, 1);
});

test("YouTube token replacement preserves the known-good token when the candidate lacks Analytics consent", async (t) => {
  const fixture = consentFixture(t);
  const env = {
    PULSE_YOUTUBE_OAUTH_CLIENT_SHA256: clientSha256(
      "pulse-scope.apps.googleusercontent.com",
    ),
    YOUTUBE_CLIENT_ID: "pulse-scope.apps.googleusercontent.com",
    YOUTUBE_CLIENT_SECRET: "scope-client-secret-must-not-leak",
    YOUTUBE_REDIRECT_URI: "http://127.0.0.1:54894/oauth2callback",
  };
  const originalTokenBytes = '{"refresh_token":"known-good-refresh-token"}\n';
  await fsp.writeFile(fixture.tokenPath, originalTokenBytes, "utf8");
  const initiated = await generateAuthUrl({
    credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
    env,
    log() {},
    now: () => new Date("2026-07-29T15:30:00.000Z"),
    pendingConsentPath: fixture.pendingConsentPath,
    randomBytes() {
      return Buffer.alloc(32, 0x34);
    },
    tokenPath: fixture.tokenPath,
  });
  const state = new URL(initiated.url).searchParams.get("state");

  await assert.rejects(
    exchangeCode(`${env.YOUTUBE_REDIRECT_URI}?code=scope-code&state=${state}`, {
      credentialsPath: path.join(fixture.directory, "missing-credentials.json"),
      env,
      explicitTokenReplacement: true,
      now: () => new Date("2026-07-29T15:31:00.000Z"),
      oauthClientFactory() {
        return {
          async getToken() {
            return {
              tokens: {
                access_token: "candidate-access-token",
                refresh_token: "candidate-refresh-token",
              },
            };
          },
        };
      },
      pendingConsentPath: fixture.pendingConsentPath,
      async probeTokenCandidate() {
        return accountBindingProof({
          clientId: env.YOUTUBE_CLIENT_ID,
          checkedAt: "2026-07-29T15:31:00.000Z",
          includeAnalytics: false,
        });
      },
      tokenPath: fixture.tokenPath,
    }),
    /youtube_oauth_token_candidate_analytics_scope_required/,
  );

  assert.equal(
    await fsp.readFile(fixture.tokenPath, "utf8"),
    originalTokenBytes,
  );
});

test("YouTube OAuth CLI makes token replacement explicit and remains dependency-injectable", async () => {
  const calls = [];
  const result = await runYoutubeOAuthCli(
    [
      "node",
      "upload_youtube.js",
      "token",
      "http://127.0.0.1/oauth2callback?code=code&state=state",
    ],
    {
      async exchangeCode(callbackInput, options) {
        calls.push({ callbackInput, options });
        return {
          saved: true,
          refresh_token_present: true,
        };
      },
      async generateAuthUrl() {
        throw new Error("auth_not_expected");
      },
      log() {},
    },
  );

  assert.equal(result.exit_code, 0);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].callbackInput,
    "http://127.0.0.1/oauth2callback?code=code&state=state",
  );
  assert.equal(calls[0].options.explicitTokenReplacement, true);
});
