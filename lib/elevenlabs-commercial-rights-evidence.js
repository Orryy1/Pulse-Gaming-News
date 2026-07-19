"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const SUBSCRIPTION_ENDPOINT =
  "https://api.elevenlabs.io/v1/user/subscription";
const OFFICIAL_POLICY_URLS = Object.freeze([
  "https://elevenlabs.io/terms-of-use-eu",
  "https://elevenlabs.io/docs/overview/administration/billing",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalisePlatforms(values = []) {
  return [...new Set(
    values
      .map((value) => clean(value).toLowerCase().replace(/[\s-]+/g, "_"))
      .filter(Boolean),
  )];
}

function paidSubscriptionEvidence(subscription = {}, retrievedAt = "") {
  const tier = clean(subscription.tier).toLowerCase();
  const status = clean(subscription.status).toLowerCase();
  const billingPeriod = clean(subscription.billing_period).toLowerCase() || null;
  const characterRefreshPeriod =
    clean(subscription.character_refresh_period).toLowerCase() || null;
  const paidPlan =
    Boolean(tier) &&
    !["free", "trial"].includes(tier) &&
    status === "active";
  const safeSnapshot = {
    tier,
    status,
    billing_period: billingPeriod,
    character_refresh_period: characterRefreshPeriod,
  };
  return {
    source_endpoint: SUBSCRIPTION_ENDPOINT,
    retrieved_at: retrievedAt,
    ...safeSnapshot,
    paid_plan: paidPlan,
    secrets_recorded: false,
    retained_fields: Object.keys(safeSnapshot),
    sanitised_snapshot_sha256: sha256(
      Buffer.from(stableJson(safeSnapshot), "utf8"),
    ),
  };
}

async function materializeElevenLabsCommercialRightsEvidence({
  artifactDir,
  storyId,
  assetId,
  audioPath,
  modelId = "eleven_multilingual_v2",
  targetPlatforms = [],
  generatedAt = new Date().toISOString(),
  now = () => new Date(),
  apiKey = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const resolvedArtifactDir = path.resolve(clean(artifactDir));
  const resolvedAudioPath = path.resolve(clean(audioPath));
  const blockers = [];
  if (!clean(storyId)) blockers.push("story_id_missing");
  if (!clean(assetId)) blockers.push("asset_id_missing");
  if (!clean(artifactDir)) blockers.push("artifact_dir_missing");
  if (!clean(audioPath) || !(await fs.pathExists(resolvedAudioPath))) {
    blockers.push("narration_audio_missing");
  }
  if (!clean(apiKey)) blockers.push("elevenlabs_api_key_unavailable");
  if (typeof fetchImpl !== "function") blockers.push("subscription_fetch_unavailable");

  let audioFingerprint = { sha256: null, size_bytes: 0 };
  if (!blockers.includes("narration_audio_missing")) {
    const audioBytes = await fs.readFile(resolvedAudioPath);
    audioFingerprint = {
      sha256: sha256(audioBytes),
      size_bytes: audioBytes.length,
    };
  }

  const capturedAt = now().toISOString();
  let subscriptionEvidence = {
    source_endpoint: SUBSCRIPTION_ENDPOINT,
    retrieved_at: capturedAt,
    tier: "",
    status: "",
    billing_period: null,
    character_refresh_period: null,
    paid_plan: false,
    secrets_recorded: false,
    retained_fields: [],
    sanitised_snapshot_sha256: null,
  };
  if (
    clean(apiKey) &&
    typeof fetchImpl === "function"
  ) {
    try {
      const response = await fetchImpl(SUBSCRIPTION_ENDPOINT, {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          accept: "application/json",
        },
      });
      if (!response?.ok) {
        blockers.push(`subscription_request_failed:${Number(response?.status) || 0}`);
      } else {
        const subscription = await response.json();
        subscriptionEvidence = paidSubscriptionEvidence(
          subscription,
          capturedAt,
        );
        if (!subscriptionEvidence.paid_plan) {
          blockers.push("paid_subscription_entitlement_missing");
        }
      }
    } catch (error) {
      blockers.push(`subscription_request_failed:${clean(error?.code || error?.name || "network_error")}`);
    }
  }

  const selectedModelId = clean(modelId);
  const betaService = !selectedModelId || /\bbeta\b/i.test(selectedModelId);
  if (betaService) blockers.push("beta_or_unknown_model_not_commercially_cleared");
  blockers.push(
    "generation_time_entitlement_binding_missing",
    "provider_request_history_binding_missing",
    "raw_to_mastered_audio_lineage_missing",
  );
  const verdict = "AMBER";
  const evidence = {
    schema: "pulse_elevenlabs_commercial_tts_entitlement_snapshot_v1",
    schema_version: 1,
    story_id: clean(storyId),
    asset_id: clean(assetId),
    captured_at: capturedAt,
    claimed_audio_generated_at: clean(generatedAt) || null,
    status: verdict,
    verdict,
    provider: "elevenlabs",
    model_id: selectedModelId,
    beta_service: betaService,
    audio_path: path.relative(resolvedArtifactDir, resolvedAudioPath).replace(/\\/g, "/"),
    audio_sha256: audioFingerprint.sha256,
    audio_size_bytes: audioFingerprint.size_bytes,
    licence_basis: "elevenlabs_commercial_tts_generation",
    commercial_use_allowed: false,
    allowed_platforms: normalisePlatforms(targetPlatforms),
    subscription_evidence: subscriptionEvidence,
    official_policy_urls: [...OFFICIAL_POLICY_URLS],
    commercial_use_policy_summary:
      "This snapshot proves current account entitlement only. Strict commercial clearance also requires evidence that the exact output was generated during a paid subscription and binds the provider response through the final media lineage.",
    blockers: [...new Set(blockers)],
    safety: {
      secrets_recorded: false,
      personal_account_fields_recorded: false,
      invoice_fields_recorded: false,
      oauth_mutated: false,
      billing_mutated: false,
      publishing_triggered: false,
    },
  };
  const evidencePath = path.join(
    resolvedArtifactDir,
    "rights",
    "elevenlabs-commercial-tts.json",
  );
  await fs.outputJson(evidencePath, evidence, { spaces: 2 });
  return {
    verdict,
    evidence,
    evidence_path: evidencePath,
  };
}

module.exports = {
  OFFICIAL_POLICY_URLS,
  SUBSCRIPTION_ENDPOINT,
  materializeElevenLabsCommercialRightsEvidence,
  paidSubscriptionEvidence,
};
