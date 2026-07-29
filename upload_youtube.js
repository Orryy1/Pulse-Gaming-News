const fs = require("fs-extra");
const crypto = require("node:crypto");
const path = require("path");
const { Readable } = require("node:stream");
const { google } = require("googleapis");
const dotenv = require("dotenv");
const { addBreadcrumb, captureException } = require("./lib/sentry");
const { validateVideo } = require("./lib/validate");
const db = require("./lib/db");
const mediaPaths = require("./lib/media-paths");
const {
  assessPostPublishMutation,
} = require("./lib/services/post-publish-mutation-policy");
const {
  YOUTUBE_PLATFORM_CONTRACT,
  validateGovernedPublicationMetadata,
} = require("./lib/services/governed-publication-metadata");
const {
  createYoutubeAuthTelemetry,
  normaliseYoutubeAuthTelemetry,
  runSanitisedYoutubeOperation,
  sanitiseYoutubeError,
  sanitiseYoutubeErrorMessage,
  updateYoutubeAuthTelemetry,
} = require("./lib/services/youtube-safety");
const {
  resolveYoutubeScheduledPublishAt,
} = require("./lib/services/youtube-scheduled-release-contract");
const {
  EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
  fingerprintYouTubeAccountBindingProof,
  validateYouTubeTokenIdentityAndScopes,
  validateYouTubeAccountBindingProof,
  verifyYouTubeAccountBinding,
} = require("./lib/services/youtube-account-binding-verifier");

dotenv.config({ override: false });

const TOKEN_PATH = path.join(__dirname, "tokens", "youtube_token.json");
const CREDENTIALS_PATH = path.join(
  __dirname,
  "tokens",
  "youtube_credentials.json",
);
const PLAYLIST_PATH = path.join(__dirname, "tokens", "youtube_playlists.json");
const MAX_BOUND_YOUTUBE_MEDIA_BYTES = 512 * 1024 * 1024;
const YOUTUBE_OAUTH_CLIENT_SHA256_ENV =
  "PULSE_YOUTUBE_OAUTH_CLIENT_SHA256";

// --- Playlist definitions ---
const PLAYLIST_DEFS = [
  {
    key: "breaking",
    title: "Breaking Gaming News",
    desc: "Fast gaming news with the player consequence and source evidence made clear.",
  },
  {
    key: "leaks_rumours",
    title: "Gaming Leaks & Rumours",
    desc: "Source-checked gaming reports, clearly labelled by confidence and explained for players.",
  },
  {
    key: "confirmed",
    title: "Confirmed Gaming News",
    desc: "Confirmed gaming news with proof on screen and the practical consequence explained.",
  },
  {
    key: "all_shorts",
    title: "All Pulse Gaming News Shorts",
    desc: "Every Pulse Gaming News Short: fast gaming news, checked and explained.",
  },
];

function resolveApprovedPinnedCommentForUpload(story) {
  const assessment = assessPostPublishMutation("youtube_pinned_comment", {
    automatic: false,
    story,
  });
  if (!story?.pinned_comment) return null;
  if (!assessment.allowed) return null;
  return assessment.payload.text;
}

// Map classification tags to playlist keys
function getPlaylistKeys(classification) {
  const c = (classification || "").toLowerCase();
  const keys = ["all_shorts"]; // every video goes here
  if (c.includes("breaking")) keys.unshift("breaking");
  else if (c.includes("leak") || c.includes("rumor") || c.includes("rumour"))
    keys.unshift("leaks_rumours");
  else if (c.includes("confirmed")) keys.unshift("confirmed");
  return keys;
}

// --- OAuth2 client setup ---
async function refreshYoutubeCredentialsInMemory(
  oauth2Client,
  credentials,
  {
    nowMs = Date.now(),
    forceRefresh = false,
    telemetry = createYoutubeAuthTelemetry(),
  } = {},
) {
  const current = { ...(credentials || {}) };
  const expiryDate = Number(current.expiry_date);
  if (
    forceRefresh !== true &&
    (!Number.isFinite(expiryDate) || nowMs <= expiryDate - 60_000)
  ) {
    return {
      credentials: current,
      refreshed: false,
      telemetry: normaliseYoutubeAuthTelemetry(telemetry),
    };
  }

  updateYoutubeAuthTelemetry(telemetry, {
    ...telemetry,
    ephemeral_access_token_refresh: {
      attempted: true,
      succeeded: false,
      failed: false,
    },
  });
  console.log("[youtube] Refreshing expired token in memory...");
  let refreshed;
  try {
    refreshed = await oauth2Client.refreshAccessToken();
  } catch (error) {
    updateYoutubeAuthTelemetry(telemetry, {
      ...telemetry,
      ephemeral_access_token_refresh: {
        attempted: true,
        succeeded: false,
        failed: true,
      },
    });
    throw sanitiseYoutubeError(error);
  }
  const next = {
    ...current,
    ...(refreshed?.credentials || {}),
  };
  if (!next.refresh_token && current.refresh_token) {
    next.refresh_token = current.refresh_token;
  }
  oauth2Client.setCredentials(next);
  updateYoutubeAuthTelemetry(telemetry, {
    ...telemetry,
    ephemeral_access_token_refresh: {
      attempted: true,
      succeeded: true,
      failed: false,
    },
  });
  return {
    credentials: next,
    refreshed: true,
    telemetry: normaliseYoutubeAuthTelemetry(telemetry),
  };
}

function reportYoutubeAuthTelemetry(reportAuthTelemetry, telemetry) {
  if (typeof reportAuthTelemetry !== "function") return;
  reportAuthTelemetry(normaliseYoutubeAuthTelemetry(telemetry));
}

function attachYoutubeRefreshTelemetry(
  oauth2Client,
  telemetry,
  reportAuthTelemetry = null,
) {
  if (
    !oauth2Client ||
    typeof oauth2Client.refreshToken !== "function"
  ) {
    throw new Error("youtube_refresh_telemetry_hook_unavailable");
  }

  const markRefresh = ({ attempted, succeeded, failed }) => {
    updateYoutubeAuthTelemetry(telemetry, {
      ...telemetry,
      ephemeral_access_token_refresh: {
        attempted,
        succeeded,
        failed,
      },
    });
    reportYoutubeAuthTelemetry(reportAuthTelemetry, telemetry);
  };

  // Google Auth emits `tokens` only after a successful refresh. Observe that
  // signal without copying any credential value into telemetry.
  if (typeof oauth2Client.on === "function") {
    oauth2Client.on("tokens", (tokens) => {
      if (!tokens || !tokens.access_token) return;
      markRefresh({
        attempted: true,
        succeeded: true,
        failed: false,
      });
    });
  }

  // All current google-auth-library automatic refresh paths flow through the
  // instance's refreshToken method. Wrapping it makes attempts and failures
  // observable as well as the successful `tokens` event above.
  const refreshToken = oauth2Client.refreshToken;
  oauth2Client.refreshToken = async function observedRefreshToken(...args) {
    markRefresh({
      attempted: true,
      succeeded: false,
      failed: false,
    });
    try {
      const value = await refreshToken.apply(this, args);
      markRefresh({
        attempted: true,
        succeeded: true,
        failed: false,
      });
      return value;
    } catch (error) {
      markRefresh({
        attempted: true,
        succeeded: false,
        failed: true,
      });
      throw sanitiseYoutubeError(error);
    }
  };

  return oauth2Client;
}

async function loadYoutubeOAuthConfiguration({
  env = process.env,
  credentialsPath = CREDENTIALS_PATH,
  fileSystem = fs,
} = {}) {
  let clientId;
  let clientSecret;
  let redirectUri;
  if (await fileSystem.pathExists(credentialsPath)) {
    const credentials = await fileSystem.readJson(
      credentialsPath,
    );
    const configured =
      credentials.installed || credentials.web || {};
    clientId = configured.client_id;
    clientSecret = configured.client_secret;
    redirectUri =
      configured.redirect_uris?.[0] || "http://localhost";
  } else {
    clientId = env.YOUTUBE_CLIENT_ID;
    clientSecret = env.YOUTUBE_CLIENT_SECRET;
    redirectUri = "http://localhost";
  }
  if (!clientId || !clientSecret) {
    throw new Error(
      `YouTube credentials not found.\n` +
        "Set up OAuth2: https://console.cloud.google.com/apis/credentials\n" +
        "1. Create OAuth 2.0 Client ID (Desktop app)\n" +
        "2. Download JSON → save as tokens/youtube_credentials.json\n" +
        "3. Run: node upload_youtube.js auth",
    );
  }
  return Object.freeze({
    clientId: String(clientId),
    clientSecret: String(clientSecret),
    redirectUri: String(redirectUri),
  });
}

async function getAuthClientWithTelemetry(
  telemetry,
  reportAuthTelemetry = null,
  { oauthConfiguration = null } = {},
) {
  const configuration =
    oauthConfiguration ||
    (await loadYoutubeOAuthConfiguration());
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN;

  const oauth2Client = new google.auth.OAuth2(
    configuration.clientId,
    configuration.clientSecret,
    configuration.redirectUri,
  );
  attachYoutubeRefreshTelemetry(
    oauth2Client,
    telemetry,
    reportAuthTelemetry,
  );

  // Load token from file or env var
  if (await fs.pathExists(TOKEN_PATH)) {
    const token = await fs.readJson(TOKEN_PATH);
    oauth2Client.setCredentials(token);
    // Authentication reads may refresh access credentials for the current
    // process, but they must never rewrite durable token material. Persisting
    // a token remains exclusive to the explicit `token` OAuth command below.
    await refreshYoutubeCredentialsInMemory(oauth2Client, token, {
      telemetry,
    });

    return oauth2Client;
  } else if (refreshToken) {
    console.log("[youtube] Using refresh token from env...");
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    await refreshYoutubeCredentialsInMemory(
      oauth2Client,
      { refresh_token: refreshToken },
      {
        forceRefresh: true,
        telemetry,
      },
    );
    return oauth2Client;
  }

  throw new Error(
    "YouTube not authenticated. Run: node upload_youtube.js auth\n" +
      "Then visit the URL and paste the code back.",
  );
}

async function getAuthClient({
  reportAuthTelemetry = null,
  oauthConfiguration = null,
} = {}) {
  const telemetry = createYoutubeAuthTelemetry();
  try {
    return await getAuthClientWithTelemetry(
      telemetry,
      reportAuthTelemetry,
      { oauthConfiguration },
    );
  } catch (error) {
    throw sanitiseYoutubeError(error);
  } finally {
    reportYoutubeAuthTelemetry(reportAuthTelemetry, telemetry);
  }
}

function youtubeAccountProbeTimestamp(now) {
  const value = typeof now === "function" ? now() : null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(
      "youtube_account_binding_probe_clock_invalid",
    );
    error.code = error.message;
    throw error;
  }
  return date.toISOString();
}

function sanitiseYoutubeTokenInfoForBinding(rawTokenInfo) {
  const raw =
    rawTokenInfo && typeof rawTokenInfo === "object"
      ? rawTokenInfo
      : {};
  const rawScopes = Array.isArray(raw.scopes)
    ? raw.scopes
    : typeof raw.scope === "string"
      ? raw.scope.trim().split(/\s+/)
      : [];
  return {
    ...(raw.issued_to !== undefined
      ? {
          issued_to:
            typeof raw.issued_to === "string"
              ? raw.issued_to.trim()
              : null,
        }
      : {}),
    ...(raw.audience !== undefined
      ? {
          audience:
            typeof raw.audience === "string"
              ? raw.audience.trim()
              : null,
        }
      : {}),
    ...(raw.aud !== undefined
      ? {
          aud:
            typeof raw.aud === "string"
              ? raw.aud.trim()
              : null,
        }
      : {}),
    scope: rawScopes
      .map((scope) => String(scope || "").trim())
      .filter(Boolean)
      .join(" "),
  };
}

function sanitiseYoutubeChannelListForBinding(rawResponse) {
  const items = Array.isArray(rawResponse?.data?.items)
    ? rawResponse.data.items
    : [];
  return {
    items: items.map((item) => ({
      id: String(item?.id || "").trim(),
      status: {
        privacyStatus: item?.status?.privacyStatus,
        isLinked: item?.status?.isLinked,
        longUploadsStatus: item?.status?.longUploadsStatus,
      },
    })),
  };
}

function youtubeAccountBindingFailureEvidence({
  code,
  expectedChannelId,
  configuredOAuthClientSha256 = null,
  expectedOAuthClientSha256 = null,
  now,
}) {
  let generatedAt = null;
  try {
    generatedAt = youtubeAccountProbeTimestamp(now);
  } catch {
    // An invalid injected clock is itself reported as a closed failure below.
  }
  const safeExpectedChannelId = /^UC[A-Za-z0-9_-]{20,}$/.test(
    String(expectedChannelId || "").trim(),
  )
    ? String(expectedChannelId).trim()
    : null;
  const safeConfiguredClientSha256 = /^[a-f0-9]{64}$/.test(
    String(configuredOAuthClientSha256 || "").trim().toLowerCase(),
  )
    ? String(configuredOAuthClientSha256).trim().toLowerCase()
    : null;
  const safeExpectedClientSha256 = /^[a-f0-9]{64}$/.test(
    String(expectedOAuthClientSha256 || "").trim().toLowerCase(),
  )
    ? String(expectedOAuthClientSha256).trim().toLowerCase()
    : null;
  const body = {
    schema_version:
      "pulse-youtube-account-binding-probe-failure-v1",
    verdict: "RED",
    generated_at: generatedAt,
    expected_channel_id: safeExpectedChannelId,
    configured_oauth_client_sha256:
      safeConfiguredClientSha256,
    expected_oauth_client_sha256: safeExpectedClientSha256,
    reason_codes: [
      String(code || "youtube_account_binding_probe_failed"),
    ],
    sanitisation: {
      credential_values_included: false,
      raw_probe_payloads_included: false,
      upstream_error_messages_included: false,
    },
    side_effects: {
      database_mutated: false,
      oauth_mutated: false,
    },
    operational_publish_authority: false,
    publication_authority_granted: false,
    external_publish_authorised: false,
  };
  return Object.freeze({
    ...body,
    proof_sha256:
      fingerprintYouTubeAccountBindingProof(body),
  });
}

function createEphemeralYoutubeProbeAuthClient({
  accessToken,
  configuredOAuthClientId,
  expiryDate,
}) {
  const auth = new google.auth.OAuth2(configuredOAuthClientId);
  auth.setCredentials({
    access_token: accessToken,
    ...(Number.isFinite(Number(expiryDate))
      ? { expiry_date: Number(expiryDate) }
      : {}),
  });
  return auth;
}

async function probeYoutubeAccountBinding({
  oauth2Client,
  youtube = null,
  createProbeAuthClient =
    createEphemeralYoutubeProbeAuthClient,
  youtubeFactory = google.youtube,
  configuredOAuthClientId,
  expectedOAuthClientSha256,
  expectedChannelId,
  now = () => new Date(),
} = {}) {
  const expectedClientSha256 = String(
    expectedOAuthClientSha256 || "",
  )
    .trim()
    .toLowerCase();
  const failure = (code, configuredOAuthClientSha256 = null) =>
    youtubeAccountBindingFailureEvidence({
      code,
      expectedChannelId,
      configuredOAuthClientSha256,
      expectedOAuthClientSha256: expectedClientSha256,
      now,
    });
  if (
    !oauth2Client ||
    typeof oauth2Client.getTokenInfo !== "function"
  ) {
    return failure(
      "youtube_account_binding_authenticated_client_required",
    );
  }
  const configuredClientId = String(
    configuredOAuthClientId || "",
  ).trim();
  const configuredClientSha256 = crypto
    .createHash("sha256")
    .update(configuredClientId, "utf8")
    .digest("hex");
  if (
    !configuredClientId ||
    !/^[a-f0-9]{64}$/.test(expectedClientSha256) ||
    configuredClientSha256 !== expectedClientSha256
  ) {
    return failure(
      "youtube_account_binding_configured_client_mismatch",
      configuredClientSha256,
    );
  }
  if (
    !/^UC[A-Za-z0-9_-]{20,}$/.test(
      String(expectedChannelId || "").trim(),
    )
  ) {
    return failure(
      "youtube_account_binding_expected_channel_required",
      configuredClientSha256,
    );
  }

  const accessToken = oauth2Client?.credentials?.access_token;
  if (!accessToken) {
    return failure(
      "youtube_account_binding_access_token_unavailable",
      configuredClientSha256,
    );
  }
  let rawTokenInfo;
  try {
    rawTokenInfo = await oauth2Client.getTokenInfo(accessToken);
  } catch {
    return failure(
      "youtube_account_binding_tokeninfo_probe_failed",
      configuredClientSha256,
    );
  }
  let tokenInfoCheckedAt;
  try {
    tokenInfoCheckedAt = youtubeAccountProbeTimestamp(now);
  } catch {
    return failure(
      "youtube_account_binding_probe_clock_invalid",
      configuredClientSha256,
    );
  }
  const tokenInfoProbeResult = {
    checked_at: tokenInfoCheckedAt,
    data: sanitiseYoutubeTokenInfoForBinding(rawTokenInfo),
  };
  try {
    validateYouTubeTokenIdentityAndScopes(
      tokenInfoProbeResult.data,
      {
        configuredOAuthClientSha256:
          configuredClientSha256,
      },
    );
  } catch (error) {
    return failure(
      error?.code ||
        "youtube_account_binding_tokeninfo_probe_invalid",
      configuredClientSha256,
    );
  }
  let youtubeClient;
  try {
    if (
      typeof createProbeAuthClient !== "function" ||
      typeof youtubeFactory !== "function"
    ) {
      throw new Error("youtube_account_binding_probe_factory_invalid");
    }
    const probeAuth = createProbeAuthClient({
      accessToken,
      configuredOAuthClientId: configuredClientId,
      expiryDate: oauth2Client?.credentials?.expiry_date,
    });
    youtubeClient =
      youtube ||
      youtubeFactory({ version: "v3", auth: probeAuth });
  } catch {
    return failure(
      "youtube_account_binding_channel_probe_failed",
      configuredClientSha256,
    );
  }
  let rawChannelResult;
  try {
    rawChannelResult = await youtubeClient.channels.list({
      part: ["id", "status"],
      mine: true,
    });
  } catch {
    return failure(
      "youtube_account_binding_channel_probe_failed",
      configuredClientSha256,
    );
  }
  let channelCheckedAt;
  try {
    channelCheckedAt = youtubeAccountProbeTimestamp(now);
  } catch {
    return failure(
      "youtube_account_binding_probe_clock_invalid",
      configuredClientSha256,
    );
  }
  const channelProbeResult = {
    checked_at: channelCheckedAt,
    data: sanitiseYoutubeChannelListForBinding(rawChannelResult),
  };

  try {
    return verifyYouTubeAccountBinding({
      expectedChannelId: String(expectedChannelId).trim(),
      configuredOAuthClientSha256: configuredClientSha256,
      tokenInfoProbeResult,
      channelProbeResult,
      now,
    });
  } catch (error) {
    return failure(
      error?.code || "youtube_account_binding_verification_failed",
      configuredClientSha256,
    );
  }
}

function runtimeYoutubeAccountBindingError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

async function createRuntimeYoutubeAuthenticatedClient({
  oauthConfiguration,
  reportAuthTelemetry = null,
} = {}) {
  return getAuthClient({
    reportAuthTelemetry,
    oauthConfiguration,
  });
}

async function createFreshYoutubeAccountBoundSession({
  env = process.env,
  now = () => new Date(),
  reportAuthTelemetry = null,
  loadOAuthConfiguration =
    loadYoutubeOAuthConfiguration,
  createAuthenticatedClient =
    createRuntimeYoutubeAuthenticatedClient,
  youtubeFactory = google.youtube,
  probeAccountBinding = probeYoutubeAccountBinding,
} = {}) {
  const expectedClientSha256 = String(
    env?.[YOUTUBE_OAUTH_CLIENT_SHA256_ENV] || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedClientSha256)) {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_expected_client_sha256_required",
    );
  }
  let oauthConfiguration;
  try {
    oauthConfiguration = await loadOAuthConfiguration({
      env,
    });
  } catch {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_oauth_configuration_failed",
    );
  }
  const configuredClientId = String(
    oauthConfiguration?.clientId || "",
  ).trim();
  const configuredClientSha256 = crypto
    .createHash("sha256")
    .update(configuredClientId, "utf8")
    .digest("hex");
  if (
    !configuredClientId ||
    configuredClientSha256 !== expectedClientSha256
  ) {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_configured_client_mismatch",
    );
  }
  let oauth2Client;
  try {
    oauth2Client = await createAuthenticatedClient({
      oauthConfiguration,
      reportAuthTelemetry,
    });
  } catch {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_authenticated_client_failed",
    );
  }
  let youtubeClient;
  try {
    youtubeClient = youtubeFactory({
      version: "v3",
      auth: oauth2Client,
    });
  } catch {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_youtube_client_failed",
    );
  }
  if (
    !youtubeClient ||
    typeof youtubeClient !== "object"
  ) {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_youtube_client_failed",
    );
  }

  let currentProof = null;
  const validateCurrentProof = () =>
    validateYouTubeAccountBindingProof(currentProof, {
      expectedChannelId:
        EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      configuredOAuthClientSha256:
        expectedClientSha256,
      now,
    }).value;
  const revalidate = async () => {
    let proof;
    try {
      proof = await probeAccountBinding({
        oauth2Client,
        youtube: youtubeClient,
        configuredOAuthClientId: configuredClientId,
        expectedOAuthClientSha256:
          expectedClientSha256,
        expectedChannelId:
          EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
        now,
      });
    } catch {
      throw runtimeYoutubeAccountBindingError(
        "youtube_runtime_account_binding_probe_failed",
      );
    }
    if (proof?.verdict !== "GREEN") {
      throw runtimeYoutubeAccountBindingError(
        "youtube_runtime_account_binding_probe_not_green",
      );
    }
    currentProof = proof;
    return validateCurrentProof();
  };
  await revalidate();

  const session = Object.create(null);
  Object.defineProperties(session, {
    getYoutubeClient: {
      enumerable: false,
      value() {
        validateCurrentProof();
        return youtubeClient;
      },
    },
    getBindingProof: {
      enumerable: false,
      value: validateCurrentProof,
    },
    revalidate: {
      enumerable: false,
      value: revalidate,
    },
  });
  return Object.freeze(session);
}

async function buildFreshYoutubeAccountBindingArmInput({
  env = process.env,
  now = () => new Date(),
  reportAuthTelemetry = null,
  loadOAuthConfiguration =
    loadYoutubeOAuthConfiguration,
  createAuthenticatedClient =
    createRuntimeYoutubeAuthenticatedClient,
  probeAccountBinding = probeYoutubeAccountBinding,
} = {}) {
  const expectedClientSha256 = String(
    env?.[YOUTUBE_OAUTH_CLIENT_SHA256_ENV] || "",
  )
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedClientSha256)) {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_expected_client_sha256_required",
    );
  }
  let oauthConfiguration;
  try {
    oauthConfiguration = await loadOAuthConfiguration({
      env,
    });
  } catch {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_oauth_configuration_failed",
    );
  }
  const configuredClientId = String(
    oauthConfiguration?.clientId || "",
  ).trim();
  const configuredClientSha256 = crypto
    .createHash("sha256")
    .update(configuredClientId, "utf8")
    .digest("hex");
  if (
    !configuredClientId ||
    configuredClientSha256 !== expectedClientSha256
  ) {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_configured_client_mismatch",
    );
  }
  let oauth2Client;
  try {
    oauth2Client = await createAuthenticatedClient({
      oauthConfiguration,
      reportAuthTelemetry,
    });
  } catch {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_authenticated_client_failed",
    );
  }
  let proof;
  try {
    proof = await probeAccountBinding({
      oauth2Client,
      configuredOAuthClientId: configuredClientId,
      expectedOAuthClientSha256: expectedClientSha256,
      expectedChannelId:
        EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      now,
    });
  } catch {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_probe_failed",
    );
  }
  if (proof?.verdict !== "GREEN") {
    throw runtimeYoutubeAccountBindingError(
      "youtube_runtime_account_binding_probe_not_green",
    );
  }
  const validated = validateYouTubeAccountBindingProof(
    proof,
    {
      expectedChannelId:
        EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
      configuredOAuthClientSha256:
        expectedClientSha256,
      now,
    },
  ).value;
  return Object.freeze({
    proof: validated,
    expectedChannelId:
      EXPECTED_PULSE_YOUTUBE_CHANNEL_ID,
    configuredOAuthClientSha256:
      expectedClientSha256,
  });
}

// --- Generate auth URL for initial setup ---
async function generateAuthUrl() {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web || {};

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob",
  );

  const url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.force-ssl",
      // Read-only YouTube Analytics. Required by lib/intelligence/
      // analytics-client real mode (AVD, AVP, retention curve, traffic
      // source, Shorts feed source, subscribers per video). Without
      // this scope the analytics client stays in fixture mode. The
      // operator must re-run `node upload_youtube.js auth` once for
      // the consent screen to add this to the existing token; existing
      // tokens are not expanded automatically.
      "https://www.googleapis.com/auth/yt-analytics.readonly",
    ],
  });

  console.log("[youtube] Visit this URL to authorise:");
  console.log(url);
  console.log("\nThen run: node upload_youtube.js token YOUR_CODE_HERE");

  return { oauth2Client, url };
}

// --- Exchange auth code for token ---
async function exchangeCode(code) {
  const credentials = await fs.readJson(CREDENTIALS_PATH);
  const { client_id, client_secret, redirect_uris } =
    credentials.installed || credentials.web || {};

  const oauth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris?.[0] || "urn:ietf:wg:oauth:2.0:oob",
  );

  const { tokens } = await oauth2Client.getToken(code);
  await fs.ensureDir(path.dirname(TOKEN_PATH));
  await fs.writeJson(TOKEN_PATH, tokens, { spaces: 2 });
  console.log("[youtube] Token saved successfully!");
  return tokens;
}

// --- Build YouTube metadata (SEO-optimised for Shorts discovery) ---
function buildMetadata(story) {
  const brand = require("./brand");
  const classInfo = brand.classificationColour(
    story.classification || story.flair,
  );

  // Title: use A/B tested variant if available, else LLM-generated curiosity gap title
  // No classification prefix - wastes characters and weakens curiosity gap hooks
  const { getBestTitle } = require("./ab_titles");
  let baseTitle = getBestTitle(story);
  baseTitle = baseTitle
    .replace(/#\s*shorts?\s*/gi, "")
    .replace(/\[.*?\]\s*/g, "")
    .trim();
  if (baseTitle.length > 80) baseTitle = baseTitle.substring(0, 77) + "...";
  const title = baseTitle;

  const gameName = extractGameName(story.title);
  const platform = detectPlatform(story.title + " " + (story.body || ""));

  const { getChannel } = require("./channels");
  const channel = getChannel();

  const descLines = [];

  // --- Section 1: Keyword-rich summary (most SEO weight - first 200 chars indexed) ---
  if (story.full_script) {
    const clean = story.full_script
      .replace(/\n/g, " ")
      .replace(/\[.*?\]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const cutoff = clean.substring(0, 300);
    // Find the LAST sentence boundary within 300 chars (not the first)
    let lastSentence = -1;
    const re = /[.!?]\s+(?=[A-Z])/g;
    let m;
    while ((m = re.exec(cutoff)) !== null) lastSentence = m.index;
    if (lastSentence > 80) {
      descLines.push(cutoff.substring(0, lastSentence + 1).trim());
    } else {
      const lastSpace = cutoff.lastIndexOf(" ");
      descLines.push(
        lastSpace > 80 ? cutoff.substring(0, lastSpace).trim() : cutoff.trim(),
      );
    }
  } else {
    descLines.push(story.title);
  }
  descLines.push("");

  // Pulse v1 deliberately keeps affiliate and sponsor material out of public
  // metadata while the controlled editorial experiment establishes audience
  // trust and intent.

  // --- Section 2: Channel identity ---
  descLines.push(`${brand.CHANNEL_NAME} - ${brand.TAGLINE}`);
  descLines.push(
    "Player consequences, source evidence and clear explanations.",
  );
  descLines.push("");

  // --- Section 3: Social links ---
  const socials = channel.socials || {};
  if (Object.keys(socials).length > 0) {
    if (socials.tiktok) descLines.push(`TikTok: ${socials.tiktok}`);
    if (socials.instagram) descLines.push(`Instagram: ${socials.instagram}`);
    if (socials.twitter) descLines.push(`X/Twitter: ${socials.twitter}`);
    if (socials.threads) descLines.push(`Threads: ${socials.threads}`);
    descLines.push("");
  }

  // --- Section 4: Sources ---
  const sourceLinks = [];
  if (story.url && story.url.startsWith("http")) sourceLinks.push(story.url);
  if (
    story.article_url &&
    story.article_url.startsWith("http") &&
    story.article_url !== story.url
  ) {
    sourceLinks.push(story.article_url);
  }
  if (sourceLinks.length > 0 || story.subreddit) {
    descLines.push("======================");
    descLines.push("Sources:");
    if (story.subreddit) descLines.push(`r/${story.subreddit}`);
    sourceLinks.forEach((link) => descLines.push(link));
    descLines.push("======================");
    descLines.push("");
  }

  // --- Section 6: Hashtags (dynamic - company/game specific + channel defaults) ---
  const hashtags = [...(channel.hashtags || ["#Shorts"])];
  if (gameName) hashtags.push(`#${gameName.replace(/[^a-zA-Z0-9]/g, "")}`);
  if (platform) hashtags.push(`#${platform}`);
  // Add company hashtags from story detection
  if (story.company_name) {
    const companyTag = `#${story.company_name.replace(/[^a-zA-Z0-9]/g, "")}`;
    if (!hashtags.some((h) => h.toLowerCase() === companyTag.toLowerCase())) {
      hashtags.push(companyTag);
    }
  }
  descLines.push(hashtags.slice(0, 8).join(" "));

  const description = descLines.join("\n");

  const tags = [
    channel.niche + " news",
    channel.name.toLowerCase(),
    gameName,
    platform,
    "youtube shorts",
    channel.niche + " shorts",
    classInfo.label.toLowerCase(),
    story.content_pillar,
    ...story.title
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ""))
      .filter(
        (w) =>
          w.length > 3 &&
          !/^(the|and|for|with|from|that|this|have|been|will|could|would)$/i.test(
            w,
          ),
      )
      .slice(0, 5),
  ].filter(Boolean);

  return { title, description, tags };
}

function governedPublicationMetadataError(code, cause = null) {
  const error = new Error(code);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function resolveGovernedYoutubeMetadata(story) {
  const binding = story?.governed_publication_metadata;
  if (
    !binding ||
    typeof binding !== "object" ||
    Array.isArray(binding)
  ) {
    throw governedPublicationMetadataError(
      "governed_dispatch_publication_metadata_required",
    );
  }
  const approvedSha = String(
    story?.governed_publication_metadata_sha256 || "",
  )
    .trim()
    .toLowerCase();
  const bindingSha = String(binding.sha256 || "")
    .trim()
    .toLowerCase();
  if (
    !/^[a-f0-9]{64}$/.test(approvedSha) ||
    approvedSha !== bindingSha
  ) {
    throw governedPublicationMetadataError(
      "governed_dispatch_publication_metadata_hash_binding_required",
    );
  }
  if (
    String(binding.platform || "").trim() !==
      YOUTUBE_PLATFORM_CONTRACT.reviewedMetadataPlatform ||
    !String(binding.path || "").trim() ||
    !String(binding.title || "").trim() ||
    !String(binding.description || "").trim()
  ) {
    throw governedPublicationMetadataError(
      "governed_dispatch_publication_metadata_binding_invalid",
    );
  }

  let approved;
  try {
    approved = validateGovernedPublicationMetadata({
      metadataPath: binding.path,
      expectedMetadataSha256: approvedSha,
      expectedStoryId: story?.id,
      expectedChannelId: story?.channel_id,
      expectedPlatform:
        YOUTUBE_PLATFORM_CONTRACT.reviewedMetadataPlatform,
      requireCanonicalAbsolutePath: true,
    });
  } catch (cause) {
    const metadataCode = Array.isArray(cause?.codes)
      ? cause.codes[0]
      : null;
    const code = metadataCode
      ? `governed_dispatch_${metadataCode}`
      : "governed_dispatch_publication_metadata_invalid";
    throw governedPublicationMetadataError(code, cause);
  }

  if (
    approved.title !== binding.title ||
    approved.description !== binding.description ||
    approved.sha256 !== bindingSha
  ) {
    throw governedPublicationMetadataError(
      "governed_dispatch_publication_metadata_binding_mismatch",
    );
  }

  return {
    path: approved.path,
    sha256: approved.sha256,
    title: approved.title,
    description: approved.description,
  };
}

// --- Extract game name from title for hashtag ---
function extractGameName(title) {
  const patterns = [
    /\b(GTA\s*\d+|Grand Theft Auto\s*\d*)/i,
    /\b(Final Fantasy\s*\w*)/i,
    /\b(Zelda[\w\s]*)/i,
    /\b(Mario[\w\s]*)/i,
    /\b(Call of Duty[\w\s]*)/i,
    /\b(Halo[\w\s]*)/i,
    /\b(Fortnite)/i,
    /\b(Minecraft)/i,
    /\b(Elden Ring)/i,
    /\b(Starfield)/i,
    /\b(Cyberpunk\s*\d*)/i,
    /\b(Assassins? Creed[\w\s]*)/i,
    /\b(God of War[\w\s]*)/i,
    /\b(Spider-?Man[\w\s]*)/i,
    /\b(Resident Evil\s*\d*)/i,
    /\b(Pokemon|Pokémon[\w\s]*)/i,
    /\b(Doom[\w\s]*)/i,
    /\b(Fallout\s*\d*)/i,
    /\b(Elder Scrolls[\w\s]*)/i,
    /\b(Red Dead[\w\s]*)/i,
    /\b(Horizon[\w\s]*)/i,
    /\b(Hogwarts Legacy)/i,
    /\b(Diablo\s*\d*)/i,
    /\b(Overwatch\s*\d*)/i,
    /\b(Valorant)/i,
    /\b(Apex Legends)/i,
    /\b(Monster Hunter[\w\s]*)/i,
    /\b(Death Stranding[\w\s]*)/i,
    /\b(Metroid[\w\s]*)/i,
    /\b(Smash Bros[\w\s]*)/i,
    /\b(Fable[\w\s]*)/i,
    /\b(Avowed)/i,
    /\b(Silksong)/i,
    /\b(Hollow Knight[\w\s]*)/i,
    /\b(Persona\s*\d*)/i,
    /\b(Metal Gear[\w\s]*)/i,
    /\b(Silent Hill[\w\s]*)/i,
    /\b(Splinter Cell[\w\s]*)/i,
    /\b(BioShock[\w\s]*)/i,
    /\b(Half-?Life\s*\d*)/i,
    /\b(Portal\s*\d*)/i,
    /\b(Borderlands\s*\d*)/i,
    /\b(Dragon Age[\w\s]*)/i,
    /\b(Mass Effect[\w\s]*)/i,
    /\b(Witcher\s*\d*)/i,
  ];
  for (const pat of patterns) {
    const m = title.match(pat);
    if (m) return m[1].trim();
  }
  return null;
}

// --- Detect platform from text for hashtag ---
function detectPlatform(text) {
  if (/\b(PS5|PlayStation\s*5|Sony)/i.test(text)) return "PlayStation";
  if (/\b(Xbox|Microsoft Gaming)/i.test(text)) return "Xbox";
  if (/\b(Nintendo|Switch\s*2|Switch)/i.test(text)) return "Nintendo";
  if (/\b(PC|Steam|Epic Games)/i.test(text)) return "PCGaming";
  return null;
}

// --- Ensure playlists exist on YouTube (creates if missing, caches IDs) ---
async function ensurePlaylists(youtube) {
  // Load cached playlist IDs
  let cached = {};
  if (await fs.pathExists(PLAYLIST_PATH)) {
    cached = await fs.readJson(PLAYLIST_PATH);
  }

  // Check if all playlists are already cached
  const allCached = PLAYLIST_DEFS.every((p) => cached[p.key]);
  if (allCached) return cached;

  // Fetch existing playlists from channel to avoid duplicates
  const existing = {};
  try {
    let pageToken = null;
    do {
      const res = await youtube.playlists.list({
        part: ["snippet"],
        mine: true,
        maxResults: 50,
        pageToken,
      });
      for (const item of res.data.items || []) {
        existing[item.snippet.title] = item.id;
      }
      pageToken = res.data.nextPageToken;
    } while (pageToken);
  } catch (err) {
    console.log(
      `[youtube] Could not list playlists: ${sanitiseYoutubeErrorMessage(err.message)}`,
    );
  }

  // Create missing playlists
  for (const def of PLAYLIST_DEFS) {
    if (cached[def.key]) continue;

    // Check if it already exists on the channel
    if (existing[def.title]) {
      cached[def.key] = existing[def.title];
      console.log(
        `[youtube] Found existing playlist: ${def.title} (${existing[def.title]})`,
      );
      continue;
    }

    try {
      const res = await youtube.playlists.insert({
        part: ["snippet", "status"],
        requestBody: {
          snippet: { title: def.title, description: def.desc },
          status: { privacyStatus: "public" },
        },
      });
      cached[def.key] = res.data.id;
      console.log(`[youtube] Created playlist: ${def.title} (${res.data.id})`);
    } catch (err) {
      console.log(
        `[youtube] Failed to create playlist "${def.title}": ${sanitiseYoutubeErrorMessage(err.message)}`,
      );
    }
  }

  await fs.ensureDir(path.dirname(PLAYLIST_PATH));
  await fs.writeJson(PLAYLIST_PATH, cached, { spaces: 2 });
  return cached;
}

// --- Add a video to playlists based on its classification ---
async function addToPlaylists(youtube, videoId, classification) {
  let playlists = {};
  if (await fs.pathExists(PLAYLIST_PATH)) {
    playlists = await fs.readJson(PLAYLIST_PATH);
  }

  const keys = getPlaylistKeys(classification);
  const added = [];

  for (const key of keys) {
    const playlistId = playlists[key];
    if (!playlistId) continue;

    try {
      await youtube.playlistItems.insert({
        part: ["snippet"],
        requestBody: {
          snippet: {
            playlistId,
            resourceId: { kind: "youtube#video", videoId },
          },
        },
      });
      added.push(key);
    } catch (err) {
      console.log(
        `[youtube] Failed to add to ${key} playlist: ${sanitiseYoutubeErrorMessage(err.message)}`,
      );
    }
  }

  if (added.length > 0) {
    console.log(`[youtube] Added to playlists: ${added.join(", ")}`);
  }
  return added;
}

async function insertYoutubeVideoOnce(youtube, request) {
  if (!youtube?.videos || typeof youtube.videos.insert !== "function") {
    throw new Error("youtube_video_insert_client_required");
  }
  return youtube.videos.insert(request);
}

function resolveContainsSyntheticMedia(story) {
  const disclosure = story?.synthetic_media_disclosure;
  const decision = String(
    disclosure?.decision || "",
  )
    .trim()
    .toUpperCase();
  if (
    decision !== "DISCLOSE" &&
    decision !== "NO_DISCLOSURE_REQUIRED"
  ) {
    throw new Error("youtube_synthetic_disclosure_decision_required");
  }
  if (typeof disclosure?.youtube_field_value !== "boolean") {
    throw new Error("youtube_synthetic_disclosure_field_required");
  }
  const expected = decision === "DISCLOSE";
  if (disclosure.youtube_field_value !== expected) {
    throw new Error("youtube_synthetic_disclosure_field_mismatch");
  }
  return disclosure.youtube_field_value;
}

function buildYoutubeShortRequestBody(
  story,
  {
    title,
    description,
    tags,
    categoryId = "20",
    scheduledFor = null,
    privateOnly = false,
    now = new Date(),
  } = {},
) {
  const publishAt = resolveYoutubeScheduledPublishAt(
    scheduledFor,
    { now },
  );
  const armScheduledRelease = privateOnly !== true && Boolean(publishAt);
  return {
    snippet: {
      title,
      description,
      tags,
      categoryId,
      defaultLanguage: "en",
      defaultAudioLanguage: "en",
    },
    status: {
      privacyStatus:
        privateOnly === true || armScheduledRelease ? "private" : "public",
      ...(armScheduledRelease ? { publishAt } : {}),
      selfDeclaredMadeForKids: false,
      embeddable: true,
      containsSyntheticMedia: resolveContainsSyntheticMedia(story),
    },
  };
}

function buildYoutubeShortUploadResult({
  videoId,
  requestBody,
  responseData = {},
} = {}) {
  const resolvedVideoId = String(
    videoId || responseData?.id || "",
  ).trim();
  if (!resolvedVideoId) {
    throw new Error("youtube_upload_result_video_id_required");
  }
  const requestedPrivacyStatus = String(
    requestBody?.status?.privacyStatus || "",
  )
    .trim()
    .toLowerCase();
  if (
    !["private", "public", "unlisted"].includes(
      requestedPrivacyStatus,
    )
  ) {
    throw new Error(
      "youtube_upload_result_requested_privacy_status_required",
    );
  }
  const responsePrivacyStatus = String(
    responseData?.status?.privacyStatus || "",
  )
    .trim()
    .toLowerCase();
  const actualPrivacyStatus = responsePrivacyStatus || null;
  if (
    actualPrivacyStatus &&
    !["private", "public", "unlisted"].includes(
      actualPrivacyStatus,
    )
  ) {
    throw new Error(
      "youtube_upload_result_actual_privacy_status_invalid",
    );
  }
  const publishAt = String(
    responseData?.status?.publishAt ||
      requestBody?.status?.publishAt ||
      "",
  ).trim();

  return {
    platform: "youtube",
    videoId: resolvedVideoId,
    url: `https://youtube.com/shorts/${resolvedVideoId}`,
    privacyStatus:
      actualPrivacyStatus || requestedPrivacyStatus,
    requestedPrivacyStatus,
    actualPrivacyStatus,
    ...(publishAt
      ? {
          publishAt,
          scheduledFor: publishAt,
        }
      : {}),
  };
}

async function loadHashBoundYoutubeMedia(
  story,
  expectedMediaSha256,
  {
    resolveMediaPath = mediaPaths.resolveExisting,
    validate = validateVideo,
    readFile = fs.readFile,
  } = {},
) {
  const expected = String(expectedMediaSha256 || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    throw new Error("youtube_expected_media_sha256_required");
  }

  const resolvedPath = await resolveMediaPath(story?.exported_path);
  const mediaPath = resolvedPath || story?.exported_path;
  const byteLength = await validate(mediaPath, "youtube");
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > MAX_BOUND_YOUTUBE_MEDIA_BYTES
  ) {
    throw new Error("youtube_media_immutable_buffer_size_invalid");
  }

  const bytes = await readFile(mediaPath);
  if (!Buffer.isBuffer(bytes) || bytes.length !== byteLength) {
    throw new Error("youtube_media_read_length_mismatch");
  }
  const actual = crypto
    .createHash("sha256")
    .update(bytes)
    .digest("hex");
  if (actual !== expected) {
    throw new Error("youtube_media_sha256_mismatch");
  }

  let streamCreated = false;
  return Object.freeze({
    sha256: actual,
    byteLength: bytes.length,
    createReadStream() {
      if (streamCreated) {
        throw new Error("youtube_bound_media_stream_already_consumed");
      }
      streamCreated = true;
      return Readable.from([bytes]);
    },
  });
}

// --- Upload a single video as YouTube Short ---
async function uploadShort(
  story,
  {
    governedDispatch = false,
    markCreateAttemptStarted = null,
    assertYoutubeCreateBoundary = null,
    reportAuthTelemetry = null,
    expectedMediaSha256 = null,
    scheduledFor = null,
    privateOnly = false,
    youtubeAccountBoundSession = null,
  } = {},
) {
  if (governedDispatch !== true) {
    throw new Error("governed_youtube_dispatch_required");
  }
  if (typeof markCreateAttemptStarted !== "function") {
    throw new Error("youtube_create_boundary_marker_required");
  }
  const governedMetadata = resolveGovernedYoutubeMetadata(story);
  const requestPreparedAt = new Date();
  const scheduledPublishAt = resolveYoutubeScheduledPublishAt(
    scheduledFor,
    { now: requestPreparedAt },
  );
  if (typeof assertYoutubeCreateBoundary !== "function") {
    throw new Error("youtube_create_boundary_guard_required");
  }
  if (typeof reportAuthTelemetry !== "function") {
    throw new Error("youtube_auth_telemetry_reporter_required");
  }
  if (
    !youtubeAccountBoundSession ||
    typeof youtubeAccountBoundSession.getYoutubeClient !==
      "function" ||
    typeof youtubeAccountBoundSession.getBindingProof !==
      "function" ||
    typeof youtubeAccountBoundSession.revalidate !== "function"
  ) {
    throw new Error("youtube_account_bound_session_required");
  }
  const initialAccountBindingProof =
    youtubeAccountBoundSession.getBindingProof();
  if (
    initialAccountBindingProof?.expected_channel_id !==
      EXPECTED_PULSE_YOUTUBE_CHANNEL_ID ||
    initialAccountBindingProof?.observed_channel_id !==
      EXPECTED_PULSE_YOUTUBE_CHANNEL_ID
  ) {
    throw new Error(
      "youtube_account_bound_session_pulse_channel_required",
    );
  }
  const { tags } = buildMetadata(story);
  const title = governedMetadata.title;
  const requestBody = buildYoutubeShortRequestBody(story, {
    title: governedMetadata.title,
    description: governedMetadata.description,
    tags,
    categoryId:
      require("./channels").getChannel().youtubeCategory || "20",
    scheduledFor: scheduledPublishAt,
    privateOnly,
    now: requestPreparedAt,
  });
  const approvedComment = resolveApprovedPinnedCommentForUpload(story);
  if (story?.pinned_comment && !approvedComment) {
    console.log(
      "[youtube] Optional top-level comment omitted: explicit hash-bound operator approval is missing or invalid",
    );
  }
  addBreadcrumb(`YouTube upload: ${story.title}`, "upload");
  return runSanitisedYoutubeOperation(async () => {
      // Materialise and hash the approved bytes before OAuth or any platform
      // request. The later upload stream is created from this private buffer,
      // so replacing or retargeting the source path cannot change what is sent.
      const boundMedia = await loadHashBoundYoutubeMedia(
        story,
        expectedMediaSha256,
      );
      const youtube =
        youtubeAccountBoundSession.getYoutubeClient();

      // YouTube-side dedup: check recent uploads for similar titles before uploading
      try {
        const ch = await youtube.channels.list({
          part: ["contentDetails"],
          mine: true,
        });
        const uploadsPlaylist =
          ch.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
        if (uploadsPlaylist) {
          const recent = await youtube.playlistItems.list({
            part: ["snippet"],
            playlistId: uploadsPlaylist,
            maxResults: 50,
          });
          const recentTitles = (recent.data.items || []).map(
            (v) => v.snippet.title,
          );
          const STOPWORDS = new Set([
            "the",
            "a",
            "an",
            "is",
            "are",
            "was",
            "were",
            "be",
            "been",
            "being",
            "has",
            "have",
            "had",
            "do",
            "does",
            "did",
            "will",
            "would",
            "could",
            "should",
            "may",
            "might",
            "must",
            "can",
            "and",
            "or",
            "but",
            "if",
            "then",
            "so",
            "to",
            "of",
            "in",
            "on",
            "at",
            "by",
            "for",
            "with",
            "from",
            "as",
            "this",
            "that",
            "these",
            "those",
            "it",
            "its",
            "new",
            "now",
            "just",
            "officially",
            "announced",
            "announces",
            "revealed",
            "reveals",
            "confirmed",
            "confirms",
            "gameplay",
            "trailer",
            "release",
            "date",
            "game",
            "games",
            "gaming",
            "news",
          ]);
          const tokenize = (s) =>
            new Set(
              s
                .toLowerCase()
                .replace(/[^\w\s]/g, " ")
                .split(/\s+/)
                .filter((w) => w.length > 2 && !STOPWORDS.has(w)),
            );
          const titleWords = tokenize(title);
          const dupe = recentTitles.find((rt) => {
            const rtWords = tokenize(rt);
            if (titleWords.size === 0 || rtWords.size === 0) return false;
            const inter = [...titleWords].filter((w) => rtWords.has(w));
            const union = new Set([...titleWords, ...rtWords]);
            return inter.length / union.size > 0.75;
          });
          if (dupe) {
            console.log(
              `[youtube] BLOCKED duplicate upload: "${title}" ~ "${dupe}"`,
            );
            // Cat B cleanup: videoId is null when blocked. Both current
            // callers (publisher.js YouTube path, upload_youtube.js
            // uploadAll batch) check `blocked === true` before reading
            // videoId, so nobody consumes the value on this path — but
            // returning `null` makes the contract explicit and means a
            // future naive caller cannot accidentally persist a sentinel
            // string as a platform external id.
            return {
              videoId: null,
              url: null,
              blocked: true,
              reason: `Similar to existing: "${dupe}"`,
            };
          }
        }
      } catch (err) {
        console.log(
          `[youtube] Dedup check failed (uploading anyway): ${sanitiseYoutubeErrorMessage(err.message)}`,
        );
      }

      console.log(`[youtube] Uploading: "${title}"`);

      await youtubeAccountBoundSession.revalidate();
      await require("./publisher").invokeTrustedYoutubeCreateBoundaryGate(
        assertYoutubeCreateBoundary,
      );
      if (
        youtubeAccountBoundSession.getYoutubeClient() !== youtube
      ) {
        throw new Error(
          "youtube_account_bound_session_client_changed",
        );
      }
      markCreateAttemptStarted();
      const response = await insertYoutubeVideoOnce(youtube, {
        part: ["snippet", "status"],
        requestBody,
        media: {
          body: boundMedia.createReadStream(),
        },
      });

      const videoId = response.data.id;
      console.log(`[youtube] Uploaded: https://youtube.com/shorts/${videoId}`);

      // Return the external identity immediately. The governed dispatcher
      // must durably anchor PLATFORM_OBJECT_CREATED before any optional
      // playlist, thumbnail or comment mutation is allowed. Those legacy
      // enrichments remain frozen during stabilisation and will move to
      // separately leased metadata jobs in a later release slice.
      return buildYoutubeShortUploadResult({
        videoId,
        requestBody,
        responseData: response.data,
      });

      // Add to playlists based on classification
      try {
        await ensurePlaylists(youtube);
        await addToPlaylists(youtube, videoId, story.classification);
      } catch (err) {
        console.log(
          `[youtube] Playlist assignment failed (non-critical): ${sanitiseYoutubeErrorMessage(err.message)}`,
        );
      }

      // Set custom thumbnail. Priority chain:
      //   1. story.hf_thumbnail_path — Studio v2 HyperFrames thumbnail
      //      (1280×720 JPEG, exact YouTube spec, channel-themed)
      //   2. story.thumbnail_candidate_path — safety-first generated
      //      1080×1920 frame when the HF thumbnail path is unavailable.
      //   3. story.story_image_path — legacy 1080×1920 Instagram Story
      //      PNG. Wrong aspect for YT but YouTube auto-letterboxes.
      //   4. story.image_path — legacy 1080×1920 composite image.
      // Each candidate resolves through media-paths so the file is
      // found under MEDIA_ROOT when set.
      const thumbCandidates = [
        story.hf_thumbnail_path,
        story.thumbnail_candidate_path,
        story.story_image_path,
        story.image_path,
      ]
        .filter(Boolean)
        .map((p) => mediaPaths.resolveExistingSync(p))
        .filter(Boolean);
      const thumbPath = thumbCandidates.find(
        (p) => p && require("fs").existsSync(p),
      );
      if (thumbPath) {
        try {
          const { runThumbnailPreUploadQa } = require("./lib/thumbnail-safety");
          const thumbQa = await runThumbnailPreUploadQa(story, {
            selectedPath: thumbPath,
          });
          if (thumbQa.result === "fail") {
            console.log(
              `[youtube] Custom thumbnail skipped by safety QA: ${thumbQa.failures.join(", ")}`,
            );
          } else {
            if (thumbQa.warnings && thumbQa.warnings.length > 0) {
              console.log(
                `[youtube] Custom thumbnail QA warnings: ${thumbQa.warnings.join(", ")}`,
              );
            }
            await youtube.thumbnails.set({
              videoId,
              media: {
                mimeType: thumbPath.endsWith(".jpg")
                  ? "image/jpeg"
                  : "image/png",
                body: fs.createReadStream(thumbPath),
              },
            });
            console.log(
              `[youtube] Custom thumbnail set from ${path.basename(thumbPath)}`,
            );
          }
        } catch (err) {
          console.log(
            `[youtube] Thumbnail upload failed (non-critical): ${sanitiseYoutubeErrorMessage(err.message)}`,
          );
        }
      }

      // The Data API can create a top-level comment but cannot pin it.
      // Only submit text that has a separate, hash-bound operator approval.
      if (approvedComment) {
        try {
          await youtube.commentThreads.insert({
            part: ["snippet"],
            requestBody: {
              snippet: {
                videoId,
                topLevelComment: {
                  snippet: {
                    textOriginal: approvedComment,
                  },
                },
              },
            },
          });
          console.log(
            "[youtube] Approved top-level comment posted; pinning remains a manual Studio action",
          );
        } catch (err) {
          console.log(
            `[youtube] Comment failed (non-critical): ${sanitiseYoutubeErrorMessage(err.message)}`,
          );
        }
      }

      return {
        platform: "youtube",
        videoId,
        url: `https://youtube.com/shorts/${videoId}`,
      };
  });
}

// --- Batch upload all ready stories ---
async function uploadAll() {
  throw new Error(
    "legacy_youtube_batch_publish_disabled_use_governed_queue",
  );
  const stories = await db.getStories();
  if (!stories.length) {
    console.log("[youtube] No stories found");
    return [];
  }

  // Build set of already-published titles for dedup. Filter out legacy
  // sentinel values (DUPE_BLOCKED / DUPE_SKIPPED) — they're not real
  // publishes and their titles should NOT count as "already published"
  // for the purposes of skipping new stories.
  const publishedTitles = stories
    .filter(
      (s) =>
        s.youtube_post_id && !String(s.youtube_post_id).startsWith("DUPE_"),
    )
    .map((s) => (s.title || "").toLowerCase());

  // Sentinel-cleanup: load repos once so we can (a) skip stories that
  // already have a blocked platform_posts row from a prior run and
  // (b) record new blocks structurally instead of stamping DUPE_BLOCKED
  // into story.youtube_post_id. The batch path is only reached via
  // `node run.js publish` (CLI) so this is not production-hot, but
  // cleaning it up removes the last known sentinel writer.
  const {
    recordPlatformBlock,
    getPlatformStatus,
  } = require("./lib/services/publish-block");
  let pubRepos = null;
  if (process.env.USE_SQLITE === "true") {
    try {
      pubRepos = require("./lib/repositories").getRepos();
    } catch (err) {
      console.log(
        `[youtube] repos unavailable: ${sanitiseYoutubeErrorMessage(err.message)}`,
      );
    }
  }

  const ready = stories.filter((s) => {
    if (!s.approved || !s.exported_path) return false;
    if (s.youtube_post_id && !String(s.youtube_post_id).startsWith("DUPE_")) {
      // Genuinely already published — skip.
      return false;
    }
    // Structured prior-block check — skip stories that have a
    // platform_posts row with status='blocked' so we don't burn an
    // API call re-attempting them.
    const prior = getPlatformStatus({
      repos: pubRepos,
      storyId: s.id,
      platform: "youtube",
    });
    if (prior && prior.status === "blocked") {
      console.log(
        `[youtube] Skipping previously blocked: "${s.title}" (${prior.block_reason || "unknown"})`,
      );
      return false;
    }
    // Title dedup: skip if a story with very similar title was already uploaded
    const title = (s.title || "").toLowerCase();
    const isDupe = publishedTitles.some((pt) => {
      const wordsA = new Set(title.split(/\s+/));
      const wordsB = new Set(pt.split(/\s+/));
      const intersection = [...wordsA].filter((w) => wordsB.has(w));
      const union = new Set([...wordsA, ...wordsB]);
      return intersection.length / union.size > 0.6;
    });
    if (isDupe) {
      console.log(`[youtube] Skipping dupe title: "${s.title}"`);
      return false;
    }
    return true;
  });

  console.log(`[youtube] ${ready.length} videos ready for upload`);

  const results = [];

  for (const story of ready) {
    const storyChannelId = story.channel_id || process.env.CHANNEL || null;
    try {
      const result = await uploadShort(story);
      // uploadShort returns { blocked: true, reason } when the remote
      // dedupe check rejects the upload. The batch path used to stamp
      // `story.youtube_post_id = "DUPE_BLOCKED"` for this, which
      // polluted the denormalised column. Structured version: write
      // a platform_posts row with status='blocked' and leave the
      // stories column NULL unless we're in dev-without-SQLite mode.
      if (result.blocked) {
        console.log(
          `[youtube] BLOCKED duplicate for ${story.id}: ${result.reason}`,
        );
        const blockResult = recordPlatformBlock({
          repos: pubRepos,
          storyId: story.id,
          platform: "youtube",
          reason: `remote-dupe: ${result.reason || "blocked"}`,
          channelId: storyChannelId,
        });
        if (!blockResult.persisted) {
          story.youtube_post_id = "DUPE_BLOCKED"; // legacy dev fallback only
        }
        story.publish_error = `dupe-blocked: ${result.reason}`;
        continue;
      }
      story.youtube_post_id = result.videoId;
      story.youtube_url = result.url;
      story.publish_status = "published";
      results.push(result);

      // Respect YouTube API quota (10000 units/day, upload = 1600 units)
      await new Promise((r) => setTimeout(r, 5000));
    } catch (err) {
      err = sanitiseYoutubeError(err);
      captureException(err, { platform: "youtube", storyId: story.id });
      const safeMessage = sanitiseYoutubeErrorMessage(err.message);
      console.log(`[youtube] Upload failed for ${story.id}: ${safeMessage}`);
      story.publish_error = safeMessage;
    }
  }

  await db.saveStories(stories);
  console.log(`[youtube] ${results.length} videos uploaded`);
  return results;
}

// --- Upload a longform compilation as a regular YouTube video (NOT a Short) ---
async function uploadLongform(compilation) {
  const profile = String(
    process.env.PULSE_SCHEDULER_PROFILE || "stabilisation_30d",
  )
    .trim()
    .toLowerCase();
  if (profile !== "legacy") {
    throw new Error("stabilisation_longform_upload_disabled");
  }
  const auth = await getAuthClient();
  const youtube = google.youtube({ version: "v3", auth });
  const brand = require("./brand");
  const { getChannel } = require("./channels");
  const channel = getChannel();

  const videoPath = compilation.output_path || compilation.outputPath;
  if (!videoPath || !(await fs.pathExists(videoPath))) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  // Title: "Gaming News Roundup - Week of April 5, 2026"
  const titleDate =
    compilation.title_date ||
    new Date().toLocaleDateString("en-GB", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  const title = `${channel.niche.charAt(0).toUpperCase() + channel.niche.slice(1)} News Roundup - Week of ${titleDate}`;

  // Description with chapter timestamps
  const descLines = [];
  descLines.push(
    `The biggest ${channel.niche} stories of the week, compiled and covered by ${channel.name}.`,
  );
  descLines.push("");

  // Chapter timestamps
  if (
    compilation.chapter_timestamps &&
    compilation.chapter_timestamps.length > 0
  ) {
    for (const ch of compilation.chapter_timestamps) {
      descLines.push(`${ch.time} ${ch.title}`);
    }
    descLines.push("");
  }

  descLines.push(`${brand.CHANNEL_NAME} - ${brand.TAGLINE}`);
  if (brand.CTA) descLines.push(brand.CTA);
  descLines.push("");

  const hashtags = (channel.hashtags || [])
    .filter((h) => !h.toLowerCase().includes("shorts"))
    .slice(0, 5);
  hashtags.push("#WeeklyRoundup");
  descLines.push(hashtags.join(" "));

  const description = descLines.join("\n");

  const tags = [
    channel.niche + " news roundup",
    channel.name.toLowerCase(),
    "weekly roundup",
    channel.niche + " weekly",
    channel.niche + " news compilation",
    "gaming news this week",
  ].filter(Boolean);

  console.log(`[youtube] Uploading longform: "${title}"`);

  const response = await youtube.videos.insert({
    part: ["snippet", "status"],
    requestBody: {
      snippet: {
        title,
        description,
        tags,
        categoryId: channel.youtubeCategory || "20",
        defaultLanguage: "en",
        defaultAudioLanguage: "en",
      },
      status: {
        privacyStatus: "public",
        selfDeclaredMadeForKids: false,
        embeddable: true,
      },
    },
    media: {
      body: fs.createReadStream(videoPath),
    },
  });

  const videoId = response.data.id;
  const url = `https://youtube.com/watch?v=${videoId}`;
  console.log(`[youtube] Longform uploaded: ${url}`);

  return {
    platform: "youtube",
    videoId,
    url,
  };
}

// --- Community post with image (placeholder) ---
// The YouTube Data API v3 does NOT support creating Community posts.
// This would need browser automation (e.g. Puppeteer) or a future API update.
// Leaving as a no-op placeholder so the publisher can call it without errors.
async function postCommunityImage(story) {
  console.log(
    `[youtube] Community post not supported via API - would need manual posting or browser automation for: "${(story.title || "").substring(0, 50)}"`,
  );
  return null;
}

module.exports = {
  attachYoutubeRefreshTelemetry,
  buildFreshYoutubeAccountBindingArmInput,
  buildYoutubeShortUploadResult,
  buildYoutubeShortRequestBody,
  createFreshYoutubeAccountBoundSession,
  insertYoutubeVideoOnce,
  loadHashBoundYoutubeMedia,
  probeYoutubeAccountBinding,
  resolveApprovedPinnedCommentForUpload,
  resolveContainsSyntheticMedia,
  resolveGovernedYoutubeMetadata,
  resolveYoutubeScheduledPublishAt,
  uploadShort,
  uploadAll,
  uploadLongform,
  buildMetadata,
  postCommunityImage,
  generateAuthUrl,
  exchangeCode,
  getAuthClient,
  refreshYoutubeCredentialsInMemory,
  ensurePlaylists,
  addToPlaylists,
};

if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === "playlists") {
    (async () => {
      const auth = await getAuthClient();
      const youtube = google.youtube({ version: "v3", auth });
      const ids = await ensurePlaylists(youtube);
      console.log("[youtube] Playlist IDs:", JSON.stringify(ids, null, 2));
    })().catch((error) => {
      console.error(
        sanitiseYoutubeErrorMessage(error?.message || error),
      );
    });
  } else if (cmd === "auth") {
    generateAuthUrl().catch((error) => {
      console.error(
        sanitiseYoutubeErrorMessage(error?.message || error),
      );
    });
  } else if (cmd === "token") {
    const code = process.argv[3];
    if (!code) {
      console.log("Usage: node upload_youtube.js token YOUR_AUTH_CODE");
      process.exit(1);
    }
    exchangeCode(code).catch((error) => {
      console.error(
        sanitiseYoutubeErrorMessage(error?.message || error),
      );
    });
  } else {
    uploadAll().catch((err) => {
      console.log(
        `[youtube] ERROR: ${sanitiseYoutubeErrorMessage(err.message)}`,
      );
      process.exit(1);
    });
  }
}
