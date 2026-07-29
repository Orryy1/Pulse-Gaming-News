"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  validateYouTubeAccountBindingProof,
} = require("./youtube-account-binding-verifier");

const YOUTUBE_OAUTH_PROVIDER = "youtube";
const YOUTUBE_OAUTH_PENDING_SCHEMA = "pulse-youtube-oauth-pending-v1";
const YOUTUBE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const YOUTUBE_OAUTH_CLIENT_SHA256_ENV = "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256";
const YOUTUBE_OAUTH_SCOPES = Object.freeze([
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
]);

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value), "utf8")
    .digest("hex");
}

function consentError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function trustedOAuthClientSha256(clientId, env) {
  const expected = String(env?.[YOUTUBE_OAUTH_CLIENT_SHA256_ENV] || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw consentError("youtube_oauth_expected_client_sha256_required");
  }
  const observed = sha256(clientId);
  if (!hashesMatch(expected, observed)) {
    throw consentError("youtube_oauth_configured_client_mismatch");
  }
  return observed;
}

function normaliseNow(now) {
  const value = typeof now === "function" ? now() : now;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw consentError("youtube_oauth_consent_clock_invalid");
  }
  return date;
}

function parseCanonicalPendingTimestamp(value) {
  if (typeof value !== "string") return null;
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return null;
  if (new Date(timestampMs).toISOString() !== value) return null;
  return timestampMs;
}

function assertConsentPathIsTokenBound({ pendingConsentPath, tokenPath }) {
  if (
    !pendingConsentPath ||
    !tokenPath ||
    path.resolve(path.dirname(pendingConsentPath)) !==
      path.resolve(path.dirname(tokenPath))
  ) {
    throw consentError("youtube_oauth_pending_state_must_be_beside_token");
  }
}

async function syncDirectoryBestEffort(directory, fileSystem) {
  let handle;
  try {
    handle = await fileSystem.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EACCES", "EINVAL", "EISDIR", "EPERM"].includes(error?.code)) {
      throw error;
    }
  } finally {
    await handle?.close();
  }
}

async function atomicReplaceJson(
  targetPath,
  value,
  { fileSystem = fs, randomBytes = crypto.randomBytes } = {},
) {
  const directory = path.dirname(targetPath);
  await fileSystem.mkdir(directory, {
    recursive: true,
    mode: 0o700,
  });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(targetPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
  );
  let handle;
  try {
    handle = await fileSystem.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fileSystem.rename(temporaryPath, targetPath);
    try {
      await fileSystem.chmod(targetPath, 0o600);
    } catch (error) {
      if (!["ENOSYS", "EPERM"].includes(error?.code)) {
        throw error;
      }
    }
    await syncDirectoryBestEffort(directory, fileSystem);
  } catch (error) {
    await handle?.close();
    await fileSystem.rm(temporaryPath, {
      force: true,
    });
    throw error;
  }
}

async function beginYoutubeOAuthConsent({
  credentialsPath,
  env = process.env,
  fileSystem = fs,
  loadOAuthConfiguration,
  now = () => new Date(),
  oauthClientFactory,
  pendingConsentPath,
  randomBytes = crypto.randomBytes,
  tokenPath,
} = {}) {
  if (typeof loadOAuthConfiguration !== "function") {
    throw consentError("youtube_oauth_configuration_loader_required");
  }
  if (typeof oauthClientFactory !== "function") {
    throw consentError("youtube_oauth_client_factory_required");
  }
  assertConsentPathIsTokenBound({
    pendingConsentPath,
    tokenPath,
  });
  const configuration = await loadOAuthConfiguration({
    credentialsPath,
    env,
  });
  const clientId = String(configuration?.clientId || "").trim();
  const clientSecret = String(configuration?.clientSecret || "");
  const redirectUri = String(configuration?.redirectUri || "").trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw consentError("youtube_oauth_configuration_incomplete");
  }
  const oauthClientSha256 = trustedOAuthClientSha256(clientId, env);

  const issuedAt = normaliseNow(now);
  const state = randomBytes(32).toString("hex");
  const pending = {
    schema_version: YOUTUBE_OAUTH_PENDING_SCHEMA,
    provider: YOUTUBE_OAUTH_PROVIDER,
    state_sha256: sha256(state),
    oauth_client_sha256: oauthClientSha256,
    redirect_uri_sha256: sha256(redirectUri),
    issued_at: issuedAt.toISOString(),
    expires_at: new Date(
      issuedAt.getTime() + YOUTUBE_OAUTH_STATE_TTL_MS,
    ).toISOString(),
  };
  await atomicReplaceJson(pendingConsentPath, pending, {
    fileSystem,
  });

  const oauth2Client = oauthClientFactory(configuration);
  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [...YOUTUBE_OAUTH_SCOPES],
    state,
  });
  return Object.freeze({
    url,
    expires_at: pending.expires_at,
  });
}

function parseYoutubeOAuthCallback(callbackInput, stateInput) {
  const raw = String(callbackInput || "").trim();
  if (!raw) {
    throw consentError("youtube_oauth_callback_code_required");
  }
  try {
    const callback = new URL(raw);
    const code = callback.searchParams.get("code");
    const state = callback.searchParams.get("state");
    if (!code) {
      throw consentError("youtube_oauth_callback_code_required");
    }
    if (!state) {
      throw consentError("youtube_oauth_callback_state_required");
    }
    return {
      callbackUrl: callback,
      code,
      state,
    };
  } catch (error) {
    if (error?.code) throw error;
    const state = String(stateInput || "").trim();
    if (!state) {
      throw consentError("youtube_oauth_callback_state_required");
    }
    return {
      callbackUrl: null,
      code: raw,
      state,
    };
  }
}

function hashesMatch(left, right) {
  const a = Buffer.from(String(left || ""), "utf8");
  const b = Buffer.from(String(right || ""), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function claimPendingConsent({
  fileSystem,
  pendingConsentPath,
  randomBytes,
}) {
  const claimedPath = `${pendingConsentPath}.claimed.${process.pid}.${randomBytes(8).toString("hex")}`;
  try {
    await fileSystem.rename(pendingConsentPath, claimedPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw consentError("youtube_oauth_pending_state_required");
    }
    throw error;
  }
  try {
    const value = JSON.parse(await fileSystem.readFile(claimedPath, "utf8"));
    return { claimedPath, value };
  } catch (error) {
    await fileSystem.rm(claimedPath, { force: true });
    if (error instanceof SyntaxError) {
      throw consentError("youtube_oauth_pending_state_invalid");
    }
    throw error;
  }
}

async function completeYoutubeOAuthConsent({
  callbackInput,
  credentialsPath,
  env = process.env,
  explicitTokenReplacement = false,
  fileSystem = fs,
  loadOAuthConfiguration,
  now = () => new Date(),
  oauthClientFactory,
  pendingConsentPath,
  probeTokenCandidate,
  randomBytes = crypto.randomBytes,
  state,
  tokenPath,
} = {}) {
  if (explicitTokenReplacement !== true) {
    throw consentError("youtube_oauth_explicit_token_replacement_required");
  }
  if (typeof loadOAuthConfiguration !== "function") {
    throw consentError("youtube_oauth_configuration_loader_required");
  }
  if (typeof oauthClientFactory !== "function") {
    throw consentError("youtube_oauth_client_factory_required");
  }
  if (typeof probeTokenCandidate !== "function") {
    throw consentError("youtube_oauth_token_candidate_probe_required");
  }
  assertConsentPathIsTokenBound({
    pendingConsentPath,
    tokenPath,
  });
  const callback = parseYoutubeOAuthCallback(callbackInput, state);
  const configuration = await loadOAuthConfiguration({
    credentialsPath,
    env,
  });
  const clientId = String(configuration?.clientId || "").trim();
  const clientSecret = String(configuration?.clientSecret || "");
  const redirectUri = String(configuration?.redirectUri || "").trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw consentError("youtube_oauth_configuration_incomplete");
  }
  const oauthClientSha256 = trustedOAuthClientSha256(clientId, env);

  const claimed = await claimPendingConsent({
    fileSystem,
    pendingConsentPath,
    randomBytes,
  });
  try {
    const pending = claimed.value;
    if (
      pending?.schema_version !== YOUTUBE_OAUTH_PENDING_SCHEMA ||
      pending?.provider !== YOUTUBE_OAUTH_PROVIDER
    ) {
      throw consentError("youtube_oauth_pending_state_invalid");
    }
    if (!hashesMatch(pending.state_sha256, sha256(callback.state))) {
      throw consentError("youtube_oauth_state_mismatch");
    }
    if (
      !hashesMatch(pending.oauth_client_sha256, oauthClientSha256) ||
      !hashesMatch(pending.redirect_uri_sha256, sha256(redirectUri))
    ) {
      throw consentError("youtube_oauth_configuration_binding_mismatch");
    }
    const issuedAtMs = parseCanonicalPendingTimestamp(pending.issued_at);
    const expiresAtMs = parseCanonicalPendingTimestamp(pending.expires_at);
    if (issuedAtMs === null || expiresAtMs === null) {
      throw consentError("youtube_oauth_pending_state_timestamp_invalid");
    }
    if (expiresAtMs - issuedAtMs !== YOUTUBE_OAUTH_STATE_TTL_MS) {
      throw consentError("youtube_oauth_pending_state_ttl_invalid");
    }
    const nowMs = normaliseNow(now).getTime();
    if (issuedAtMs > nowMs) {
      throw consentError("youtube_oauth_pending_state_issued_in_future");
    }
    if (nowMs > expiresAtMs) {
      throw consentError("youtube_oauth_state_expired");
    }
    if (callback.callbackUrl) {
      const expected = new URL(redirectUri);
      if (
        callback.callbackUrl.origin !== expected.origin ||
        callback.callbackUrl.pathname !== expected.pathname
      ) {
        throw consentError("youtube_oauth_redirect_uri_mismatch");
      }
    }

    const oauth2Client = oauthClientFactory(configuration);
    const tokenResponse = await oauth2Client.getToken(callback.code);
    const tokens = tokenResponse?.tokens;
    if (
      !tokens ||
      typeof tokens !== "object" ||
      typeof tokens.refresh_token !== "string" ||
      tokens.refresh_token.trim().length === 0
    ) {
      throw consentError("youtube_oauth_refresh_token_required");
    }
    let candidateProof;
    try {
      candidateProof = await probeTokenCandidate({
        oauth2Client,
        tokens,
        configuration: {
          clientId,
          clientSecret,
          redirectUri,
        },
        expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
        expectedOAuthClientSha256: oauthClientSha256,
        now,
      });
    } catch {
      throw consentError("youtube_oauth_token_candidate_probe_failed");
    }
    let validatedProof;
    try {
      validatedProof = validateYouTubeAccountBindingProof(candidateProof, {
        expectedChannelId: EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
        configuredOAuthClientSha256: oauthClientSha256,
        now,
      }).value;
    } catch {
      throw consentError("youtube_oauth_token_candidate_binding_invalid");
    }
    if (
      validatedProof.analytics?.read_scope_present !== true ||
      validatedProof.analytics?.learning_ready !== true
    ) {
      throw consentError(
        "youtube_oauth_token_candidate_analytics_scope_required",
      );
    }
    await atomicReplaceJson(tokenPath, tokens, {
      fileSystem,
      randomBytes,
    });
    return Object.freeze({
      saved: true,
      token_path: tokenPath,
      refresh_token_present: true,
    });
  } finally {
    await fileSystem.rm(claimed.claimedPath, {
      force: true,
    });
  }
}

module.exports = {
  YOUTUBE_OAUTH_PENDING_SCHEMA,
  YOUTUBE_OAUTH_SCOPES,
  YOUTUBE_OAUTH_STATE_TTL_MS,
  atomicReplaceJson,
  beginYoutubeOAuthConsent,
  completeYoutubeOAuthConsent,
  parseYoutubeOAuthCallback,
};
