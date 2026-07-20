"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fs = require("fs-extra");
const SUBSCRIPTION_ENDPOINT = "https://api.elevenlabs.io/v1/user/subscription";
const MODEL_ENDPOINT = "https://api.elevenlabs.io/v1/models";
const REQUIRED_POLICY_URLS = Object.freeze([
  "https://elevenlabs.io/docs/overview/administration/billing",
  "https://elevenlabs.io/terms-of-use-eu",
]);
const REQUIRED_PENDING_GENERATION_CHECKS = Object.freeze([
  "entitlement_brackets_generation",
  "paid_subscription_pre_generation",
  "paid_subscription_post_generation",
  "model_is_production_tts",
  "official_model_snapshot_verified",
  "policy_files_verified",
  "official_policy_files_verified",
  "request_id_matches_history",
  "history_item_identity_present",
  "history_date_present",
  "history_model_matches",
  "history_voice_matches",
  "history_text_matches",
  "history_audio_matches_raw_response",
  "no_secret_fields",
  "no_personal_fields",
  "no_invoice_fields",
  "every_generation_condition_proven",
]);

const SENSITIVE_KEY_PATTERN =
  /(?:api[_-]?key|authorization|token|secret|password|user[_-]?id|owner[_-]?id|invoice|payment|card|email|name|address)/i;
const RECEIPT_SENSITIVE_KEY_PATTERN =
  /^(?:api[_-]?key|xi[_-]?api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|user[_-]?id|invoice(?:s)?|payment(?:s|_method)?|card(?:_number)?|bank(?:_account)?)$/i;

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
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

function toBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.alloc(0);
}

function fingerprint(value) {
  const bytes = toBytes(value);
  return {
    sha256: bytes.length > 0 ? sha256(bytes) : null,
    size_bytes: bytes.length,
  };
}

function defaultDecodeAudioToCanonicalPcm(
  value,
  {
    ffmpegPath = process.env.FFMPEG_PATH || "ffmpeg",
    timeoutMs = 300_000,
  } = {},
) {
  const input = toBytes(value);
  if (!input.length) return { ok: false, error: "audio_bytes_missing" };
  const decoded = spawnSync(
    ffmpegPath,
    [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-xerror",
      "-i",
      "pipe:0",
      "-map",
      "0:a:0",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "44100",
      "-f",
      "s16le",
      "pipe:1",
    ],
    {
      input,
      encoding: null,
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    },
  );
  if (
    decoded.error ||
    decoded.status !== 0 ||
    !Buffer.isBuffer(decoded.stdout) ||
    decoded.stdout.length === 0
  ) {
    return {
      ok: false,
      error:
        clean(decoded.error?.message) ||
        clean(decoded.stderr && decoded.stderr.toString("utf8")) ||
        `ffmpeg_decode_failed:${decoded.status}`,
    };
  }
  return {
    ok: true,
    bytes: decoded.stdout,
    sample_rate_hz: 44100,
    channels: 1,
    sample_format: "s16le",
  };
}

function isoNow(now) {
  const value = now();
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function normalisePlatforms(values = []) {
  return [
    ...new Set(
      values
        .map((value) => clean(value).toLowerCase().replace(/[\s-]+/g, "_"))
        .filter(Boolean),
    ),
  ];
}

function sanitiseSettings(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitiseSettings(entry));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
      .map(([key, entry]) => [key, sanitiseSettings(entry)]),
  );
}

function sanitiseSubscription(value = {}, retrievedAt = null) {
  const tier = clean(value.tier).toLowerCase();
  const status = clean(value.status).toLowerCase();
  const safe = {
    tier,
    status,
    billing_period: clean(value.billing_period).toLowerCase() || null,
    character_refresh_period:
      clean(value.character_refresh_period).toLowerCase() || null,
  };
  const paidPlan =
    Boolean(tier) && !["free", "trial"].includes(tier) && status === "active";
  return {
    source_endpoint: SUBSCRIPTION_ENDPOINT,
    retrieved_at: retrievedAt,
    ...safe,
    paid_plan: paidPlan,
    secrets_recorded: false,
    sanitised_snapshot_sha256: sha256(Buffer.from(stableJson(safe), "utf8")),
  };
}

function sanitiseModelSnapshot(value = {}, expectedModelId = "", retrievedAt = null) {
  const safe = {
    model_id: clean(value.model_id || value.modelId),
    display_name: clean(value.name || value.display_name) || null,
    can_do_text_to_speech: value.can_do_text_to_speech === true,
    requires_alpha_access: value.requires_alpha_access === true,
    requires_beta_access:
      value.requires_beta_access === true || value.is_beta === true,
    deprecated: value.deprecated === true || value.is_deprecated === true,
  };
  return {
    source_endpoint: MODEL_ENDPOINT,
    retrieved_at: retrievedAt,
    ...safe,
    text_to_speech: safe.can_do_text_to_speech,
    expected_model_id: clean(expectedModelId),
    regular_production_model:
      safe.model_id === clean(expectedModelId) &&
      safe.can_do_text_to_speech &&
      !safe.requires_alpha_access &&
      !safe.requires_beta_access &&
      !safe.deprecated,
    secrets_recorded: false,
  };
}

function officialPolicyUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "elevenlabs.io" ||
        url.hostname.endsWith(".elevenlabs.io"))
    );
  } catch {
    return false;
  }
}

function chronological(...values) {
  const times = values.map((value) => Date.parse(value));
  return (
    times.every(Number.isFinite) &&
    times.every((value, index) => index === 0 || value >= times[index - 1])
  );
}

async function writeJsonWithFingerprint(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.outputFile(filePath, bytes);
  return {
    path: filePath,
    sha256: sha256(bytes),
    size_bytes: bytes.length,
  };
}

function validSha256(value) {
  return /^[a-f0-9]{64}$/i.test(clean(value));
}

function exactStringSet(actual, expected) {
  const normalise = (values) => [
    ...new Set((Array.isArray(values) ? values : []).map(clean).filter(Boolean)),
  ].sort();
  const left = normalise(actual);
  const right = normalise(expected);
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function containsReceiptSensitiveFields(value) {
  if (Array.isArray(value)) return value.some(containsReceiptSensitiveFields);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, entry]) => (
    RECEIPT_SENSITIVE_KEY_PATTERN.test(key) ||
    containsReceiptSensitiveFields(entry)
  ));
}

function providerAudioIdentityValid(generation, rawSha256, rawSizeBytes) {
  const historySha256 = clean(generation.history_audio_sha256).toLowerCase();
  const historySizeBytes = Number(generation.history_audio_size_bytes);
  if (
    !validSha256(historySha256) ||
    !Number.isInteger(historySizeBytes) ||
    historySizeBytes <= 0
  ) {
    return false;
  }
  const compressedMatch =
    historySha256 === rawSha256 && historySizeBytes === rawSizeBytes;
  if (clean(generation.audio_identity_method) === "compressed_bytes_sha256") {
    return generation.compressed_bytes_match === true && compressedMatch;
  }
  const rawPcmSha256 = clean(
    generation.raw_provider_audio_decoded_pcm_sha256,
  ).toLowerCase();
  return (
    clean(generation.audio_identity_method) ===
      "decoded_pcm_s16le_44100_mono_sha256" &&
    generation.compressed_bytes_match === false &&
    !compressedMatch &&
    validSha256(rawPcmSha256) &&
    clean(generation.history_audio_decoded_pcm_sha256).toLowerCase() ===
      rawPcmSha256 &&
    Number.isInteger(Number(generation.raw_provider_audio_decoded_pcm_size_bytes)) &&
    Number(generation.raw_provider_audio_decoded_pcm_size_bytes) > 0 &&
    Number(generation.history_audio_decoded_pcm_size_bytes) ===
      Number(generation.raw_provider_audio_decoded_pcm_size_bytes) &&
    Number(generation.decoded_pcm_sample_rate_hz) === 44_100 &&
    Number(generation.decoded_pcm_channels) === 1 &&
    clean(generation.decoded_pcm_sample_format).toLowerCase() === "s16le"
  );
}

async function inspectPendingElevenLabsGenerationRightsReceipt({
  artifactDir,
  receiptPath,
  storyId,
  assetId = `${clean(storyId)}_audio_path`,
  requestText,
  masteredAudioFingerprint = {},
  timestampDocument = {},
  targetPlatforms = [],
} = {}) {
  const root = path.resolve(clean(artifactDir) || ".");
  const blockers = [];
  const supportingEvidence = [];
  const add = (value) => {
    if (value && !blockers.includes(value)) blockers.push(value);
  };
  const insideRoot = (filePath) => (
    filePath === root || filePath.startsWith(`${root}${path.sep}`)
  );
  const resolveEvidencePath = (value) => {
    const declared = clean(value);
    if (!declared) return "";
    const resolved = path.resolve(root, declared);
    return insideRoot(resolved) ? resolved : "";
  };
  const currentFile = async (entry, label, pathKeys = ["path", "materialised_path"]) => {
    const declaredPath = pathKeys.map((key) => clean(entry?.[key])).find(Boolean);
    const filePath = resolveEvidencePath(declaredPath);
    const expectedSha256 = clean(
      entry?.sha256 || entry?.evidence_sha256,
    ).toLowerCase();
    const expectedSizeBytes = Number(
      entry?.size_bytes || entry?.evidence_size_bytes,
    );
    if (!filePath || !validSha256(expectedSha256) || expectedSizeBytes <= 0) {
      add(`${label}_declaration_invalid`);
      return null;
    }
    try {
      const bytes = await fs.readFile(filePath);
      const stat = await fs.stat(filePath);
      const current = fingerprint(bytes);
      if (
        current.sha256 !== expectedSha256 ||
        current.size_bytes !== expectedSizeBytes
      ) {
        add(`${label}_missing_or_stale`);
        return null;
      }
      const evidence = { path: filePath, ...current, mtime_ms: stat.mtimeMs };
      supportingEvidence.push([label, evidence]);
      return { bytes, evidence };
    } catch {
      add(`${label}_missing_or_stale`);
      return null;
    }
  };
  const readCurrentJson = async (entry, label, pathKeys) => {
    const current = await currentFile(entry, label, pathKeys);
    if (!current) return null;
    try {
      return JSON.parse(current.bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      add(`${label}_invalid_json`);
      return null;
    }
  };

  const resolvedReceiptPath = resolveEvidencePath(
    receiptPath ||
      "rights/evidence/elevenlabs-generation-receipt.json",
  );
  let receipt = null;
  let receiptEvidence = null;
  try {
    const bytes = resolvedReceiptPath
      ? await fs.readFile(resolvedReceiptPath)
      : Buffer.alloc(0);
    const stat = await fs.stat(resolvedReceiptPath);
    receipt = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    receiptEvidence = {
      path: resolvedReceiptPath,
      ...fingerprint(bytes),
      mtime_ms: stat.mtimeMs,
    };
    supportingEvidence.push(["elevenlabs_generation_receipt", receiptEvidence]);
  } catch {
    add("generation_receipt_missing_or_unreadable");
  }
  if (!receipt) {
    return {
      verdict: "RED",
      blockers,
      receipt: null,
      receiptPath: resolvedReceiptPath || null,
      receiptEvidence,
      supportingEvidence,
    };
  }

  if (
    clean(receipt.schema) !== "pulse_elevenlabs_generation_receipt_v1" ||
    Number(receipt.schema_version) !== 1
  ) add("generation_receipt_schema_invalid");
  if (
    clean(receipt.story_id) !== clean(storyId) ||
    clean(receipt.asset_id) !== clean(assetId)
  ) add("generation_receipt_story_or_asset_mismatch");
  if (
    clean(receipt.verdict).toUpperCase() !== "AMBER" ||
    clean(receipt.generation_verdict).toUpperCase() !== "GREEN" ||
    clean(receipt.final_media_lineage_status).toUpperCase() !== "PENDING" ||
    receipt.commercial_use_allowed !== false ||
    !exactStringSet(receipt.blockers, ["final_media_lineage_pending"]) ||
    (Array.isArray(receipt.generation_blockers) &&
      receipt.generation_blockers.length > 0)
  ) add("generation_receipt_transition_state_invalid");

  const generation = receipt.generation || {};
  const mastering = receipt.mastering_lineage || {};
  const rawSha256 = clean(generation.raw_provider_audio_sha256).toLowerCase();
  const rawSizeBytes = Number(generation.raw_provider_audio_size_bytes);
  if (
    clean(receipt.provider?.id).toLowerCase() !== "elevenlabs" ||
    !clean(receipt.provider?.model_id) ||
    /\b(?:alpha|beta|preview|pilot)\b/i.test(clean(receipt.provider?.model_id)) ||
    clean(receipt.licence_basis) !== "elevenlabs_commercial_tts_generation"
  ) add("generation_receipt_provider_invalid");
  const allowedPlatforms = new Set(normalisePlatforms(receipt.allowed_platforms || []));
  if (
    normalisePlatforms(targetPlatforms).some(
      (platform) => !allowedPlatforms.has(platform),
    )
  ) add("generation_receipt_platform_scope_incomplete");
  if (
    REQUIRED_PENDING_GENERATION_CHECKS.some(
      (key) => receipt.generation_checks?.[key] !== true,
    )
  ) add("generation_receipt_checks_incomplete");
  if (
    receipt.safety?.secrets_recorded !== false ||
    receipt.safety?.personal_account_fields_recorded !== false ||
    receipt.safety?.invoice_fields_recorded !== false ||
    receipt.safety?.oauth_mutated !== false ||
    receipt.safety?.token_mutated !== false ||
    receipt.safety?.billing_mutated !== false ||
    receipt.safety?.publishing_triggered !== false ||
    receipt.safety?.database_mutated !== false ||
    containsReceiptSensitiveFields(receipt)
  ) add("generation_receipt_safety_invalid");
  if (
    !clean(generation.request_id) ||
    !clean(generation.history_item_id) ||
    Number(generation.history_date_unix) <= 0 ||
    !validSha256(generation.voice_id_sha256) ||
    !validSha256(generation.request_text_sha256) ||
    !validSha256(generation.request_settings_sha256) ||
    !validSha256(rawSha256) ||
    !Number.isInteger(rawSizeBytes) ||
    rawSizeBytes <= 0 ||
    !providerAudioIdentityValid(generation, rawSha256, rawSizeBytes)
  ) add("generation_receipt_request_identity_invalid");
  if (
    !clean(requestText) ||
    sha256(Buffer.from(clean(requestText), "utf8")) !==
      clean(generation.request_text_sha256).toLowerCase()
  ) add("generation_receipt_script_binding_mismatch");
  if (
    clean(mastering.raw_provider_audio_sha256).toLowerCase() !== rawSha256 ||
    Number(mastering.raw_provider_audio_size_bytes) !== rawSizeBytes ||
    clean(mastering.mastered_audio_sha256).toLowerCase() !==
      clean(masteredAudioFingerprint.sha256).toLowerCase() ||
    Number(mastering.mastered_audio_size_bytes) !==
      Number(masteredAudioFingerprint.size_bytes) ||
    clean(mastering.transform_status).toUpperCase() !== "COMPLETE" ||
    clean(mastering.post_generation_transform_status).toUpperCase() !== "COMPLETE"
  ) add("generation_receipt_mastering_binding_mismatch");

  const timestampBinding =
    timestampDocument?.meta?.elevenlabsGenerationRights || {};
  if (
    Number(timestampBinding.schemaVersion) !== 1 ||
    clean(timestampBinding.receiptPath).replace(/\\/g, "/") !==
      "rights/evidence/elevenlabs-generation-receipt.json" ||
    clean(timestampBinding.rawProviderAudioSha256).toLowerCase() !== rawSha256 ||
    Number(timestampBinding.rawProviderAudioSizeBytes) !== rawSizeBytes ||
    clean(timestampBinding.masteredAudioSha256).toLowerCase() !==
      clean(masteredAudioFingerprint.sha256).toLowerCase() ||
    Number(timestampBinding.masteredAudioSizeBytes) !==
      Number(masteredAudioFingerprint.size_bytes) ||
    clean(timestampBinding.requestId) !== clean(generation.request_id) ||
    clean(timestampBinding.historyItemId) !== clean(generation.history_item_id) ||
    clean(timestampBinding.finalMediaLineageStatus).toUpperCase() !== "PENDING" ||
    clean(timestampBinding.postGenerationTransformStatus).toUpperCase() !== "COMPLETE"
  ) add("generation_receipt_timestamp_binding_mismatch");

  const entitlement = receipt.account_entitlement || {};
  const pre = entitlement.pre_generation || {};
  const post = entitlement.post_generation || {};
  if (
    entitlement.paid_at_generation !== true ||
    entitlement.secrets_recorded !== false ||
    pre.paid_plan !== true ||
    post.paid_plan !== true ||
    clean(pre.status).toLowerCase() !== "active" ||
    clean(post.status).toLowerCase() !== "active" ||
    ["", "free", "trial"].includes(clean(pre.tier).toLowerCase()) ||
    ["", "free", "trial"].includes(clean(post.tier).toLowerCase()) ||
    !chronological(
      pre.retrieved_at,
      generation.request_started_at,
      generation.response_received_at,
      post.retrieved_at,
    )
  ) add("generation_receipt_entitlement_invalid");
  const preSnapshot = await readCurrentJson(
    pre,
    "elevenlabs_subscription_pre",
    ["evidence_path"],
  );
  const postSnapshot = await readCurrentJson(
    post,
    "elevenlabs_subscription_post",
    ["evidence_path"],
  );
  for (const [snapshot, declared] of [[preSnapshot, pre], [postSnapshot, post]]) {
    if (
      !snapshot ||
      snapshot.paid_plan !== true ||
      snapshot.secrets_recorded !== false ||
      clean(snapshot.status).toLowerCase() !== "active" ||
      clean(snapshot.tier).toLowerCase() !== clean(declared.tier).toLowerCase() ||
      clean(snapshot.retrieved_at) !== clean(declared.retrieved_at)
    ) add("generation_receipt_entitlement_snapshot_invalid");
  }

  const modelSnapshot = await readCurrentJson({
    path: receipt.provider?.model_snapshot_path,
    sha256: receipt.provider?.model_snapshot_sha256,
    size_bytes: receipt.provider?.model_snapshot_size_bytes,
  }, "elevenlabs_model_snapshot");
  if (
    !modelSnapshot ||
    clean(modelSnapshot.model_id) !== clean(receipt.provider?.model_id) ||
    modelSnapshot.text_to_speech !== true ||
    modelSnapshot.requires_alpha_access !== false ||
    modelSnapshot.requires_beta_access !== false ||
    modelSnapshot.deprecated !== false ||
    modelSnapshot.regular_production_model !== true ||
    modelSnapshot.secrets_recorded !== false
  ) add("generation_receipt_model_snapshot_invalid");

  const policy = receipt.policy_evidence || {};
  const policyDocuments = Array.isArray(policy.documents) ? policy.documents : [];
  const policyUrls = new Set(policyDocuments.map((entry) => clean(entry.url)));
  if (
    clean(policy.jurisdiction) !== "UK_EEA" ||
    policy.paid_plan_required !== true ||
    policy.beta_service_production_forbidden !== true ||
    REQUIRED_POLICY_URLS.some((url) => !policyUrls.has(url))
  ) add("generation_receipt_policy_invalid");
  for (const [index, document] of policyDocuments.entries()) {
    if (
      !officialPolicyUrl(document.url) ||
      !Number.isFinite(Date.parse(clean(document.retrieved_at)))
    ) {
      add("generation_receipt_policy_document_invalid");
      continue;
    }
    await currentFile(document, `elevenlabs_policy_${index + 1}`);
  }
  await currentFile({
    path: generation.raw_provider_audio_path,
    sha256: rawSha256,
    size_bytes: rawSizeBytes,
  }, "elevenlabs_raw_provider_audio");

  return {
    verdict: blockers.length ? "RED" : "GREEN",
    blockers,
    receipt,
    receiptPath: resolvedReceiptPath,
    receiptEvidence,
    supportingEvidence,
  };
}

async function materializeElevenLabsGenerationRightsLineage({
  artifactDir,
  storyId,
  assetId,
  modelId,
  voiceId,
  requestText,
  requestSettings = {},
  targetPlatforms = [],
  policyUrls = [],
  now = () => new Date(),
  fetchSubscription,
  fetchModelSnapshot,
  fetchPolicyDocument,
  generateAudio,
  findHistoryItem,
  downloadHistoryAudio,
  decodeAudioToCanonicalPcm = defaultDecodeAudioToCanonicalPcm,
  finalizeLineage,
  deferFinalization = false,
} = {}) {
  const root = path.resolve(clean(artifactDir) || ".");
  const evidenceDir = path.join(root, "rights", "evidence");
  const blockers = [];
  const addBlocker = (value) => {
    const blocker = clean(value);
    if (blocker && !blockers.includes(blocker)) blockers.push(blocker);
  };

  if (!clean(artifactDir)) addBlocker("artifact_dir_missing");
  if (!clean(storyId)) addBlocker("story_id_missing");
  if (!clean(assetId)) addBlocker("asset_id_missing");
  if (!clean(modelId)) addBlocker("model_id_missing");
  if (!clean(voiceId)) addBlocker("voice_id_missing");
  if (!clean(requestText)) addBlocker("request_text_missing");

  const requiredFunctions = {
    fetchSubscription,
    fetchModelSnapshot,
    fetchPolicyDocument,
    generateAudio,
    findHistoryItem,
    downloadHistoryAudio,
  };
  if (!deferFinalization) requiredFunctions.finalizeLineage = finalizeLineage;
  for (const [name, value] of Object.entries(requiredFunctions)) {
    if (typeof value !== "function") addBlocker(`${name}_unavailable`);
  }

  await fs.ensureDir(evidenceDir);

  let modelSnapshot = sanitiseModelSnapshot({}, modelId, null);
  let modelSnapshotFile = null;
  if (typeof fetchModelSnapshot === "function") {
    try {
      modelSnapshot = sanitiseModelSnapshot(
        await fetchModelSnapshot(clean(modelId)),
        modelId,
        isoNow(now),
      );
      modelSnapshotFile = await writeJsonWithFingerprint(
        path.join(evidenceDir, "model-snapshot.json"),
        modelSnapshot,
      );
      if (!modelSnapshot.regular_production_model) {
        addBlocker("official_model_snapshot_not_production_safe");
      }
    } catch {
      addBlocker("official_model_snapshot_unavailable");
    }
  }

  const policyEvidence = [];
  if (policyUrls.length === 0) addBlocker("official_policy_evidence_missing");
  for (const [index, urlValue] of policyUrls.entries()) {
    const url = clean(urlValue);
    if (!officialPolicyUrl(url)) {
      addBlocker(`policy_url_not_official:${index + 1}`);
      continue;
    }
    if (typeof fetchPolicyDocument !== "function") continue;
    try {
      const bytes = toBytes(await fetchPolicyDocument(url));
      if (bytes.length === 0) {
        addBlocker(`policy_document_empty:${index + 1}`);
        continue;
      }
      const extension = /(?:terms|policy|article)/i.test(url) ? ".html" : ".bin";
      const filePath = path.join(
        evidenceDir,
        `policy-${String(index + 1).padStart(2, "0")}${extension}`,
      );
      await fs.outputFile(filePath, bytes);
      policyEvidence.push({
        url,
        retrieved_at: isoNow(now),
        materialised_path: path
          .relative(root, filePath)
          .replace(/\\/g, "/"),
        sha256: sha256(bytes),
        size_bytes: bytes.length,
      });
    } catch {
      addBlocker(`policy_document_unavailable:${index + 1}`);
    }
  }
  if (policyEvidence.length !== policyUrls.length) {
    addBlocker("official_policy_evidence_incomplete");
  }
  const policyUrlsCaptured = new Set(policyEvidence.map((entry) => entry.url));
  if (REQUIRED_POLICY_URLS.some((url) => !policyUrlsCaptured.has(url))) {
    addBlocker("required_official_policy_evidence_missing");
  }

  let pre = sanitiseSubscription({}, null);
  if (typeof fetchSubscription === "function") {
    try {
      pre = sanitiseSubscription(await fetchSubscription(), isoNow(now));
      if (!pre.paid_plan) addBlocker("pre_generation_paid_entitlement_missing");
    } catch {
      addBlocker("pre_generation_subscription_snapshot_failed");
    }
  }
  const preEvidence = await writeJsonWithFingerprint(
    path.join(evidenceDir, "subscription-pre.json"),
    pre,
  );

  const generationStartedAt = isoNow(now);
  let generationResult = {};
  if (typeof generateAudio === "function") {
    try {
      generationResult =
        (await generateAudio({
          modelId: clean(modelId),
          voiceId: clean(voiceId),
          requestText: clean(requestText),
          requestSettings,
        })) || {};
    } catch {
      addBlocker("provider_generation_failed");
    }
  }
  const generationFinishedAt = isoNow(now);

  let post = sanitiseSubscription({}, null);
  if (typeof fetchSubscription === "function") {
    try {
      post = sanitiseSubscription(await fetchSubscription(), isoNow(now));
      if (!post.paid_plan) addBlocker("post_generation_paid_entitlement_missing");
    } catch {
      addBlocker("post_generation_subscription_snapshot_failed");
    }
  }
  const postEvidence = await writeJsonWithFingerprint(
    path.join(evidenceDir, "subscription-post.json"),
    post,
  );

  const requestId = clean(generationResult.requestId);
  const rawAudio = toBytes(generationResult.rawAudioBytes);
  if (!requestId) addBlocker("provider_request_id_missing");
  if (rawAudio.length === 0) addBlocker("raw_provider_audio_missing");

  let historyItem = {};
  if (requestId && typeof findHistoryItem === "function") {
    try {
      historyItem =
        (await findHistoryItem({
          requestId,
          modelId: clean(modelId),
        })) || {};
    } catch {
      addBlocker("provider_history_item_lookup_failed");
    }
  }
  const historyItemId = clean(historyItem.history_item_id || historyItem.id);
  const historyDateUnix = Number(historyItem.date_unix || historyItem.dateUnix);
  const historyRequestMatches =
    Boolean(requestId) && clean(historyItem.request_id) === requestId;
  const historyModelMatches =
    clean(historyItem.model_id) === clean(modelId);
  const voiceIdSha256 = sha256(Buffer.from(clean(voiceId), "utf8"));
  const historyVoiceMatches =
    clean(historyItem.voice_id)
      ? clean(historyItem.voice_id) === clean(voiceId)
      : clean(historyItem.voice_id_sha256).toLowerCase() === voiceIdSha256;
  const requestTextSha256 = sha256(Buffer.from(clean(requestText), "utf8"));
  const historyTextMatches =
    clean(historyItem.text)
      ? sha256(Buffer.from(clean(historyItem.text), "utf8")) ===
        requestTextSha256
      : clean(historyItem.text_sha256).toLowerCase() === requestTextSha256;
  if (!historyItemId) addBlocker("provider_history_item_id_missing");
  if (!Number.isFinite(historyDateUnix) || historyDateUnix <= 0) {
    addBlocker("provider_history_date_missing");
  }
  if (!historyRequestMatches) addBlocker("request_id_history_item_mismatch");
  if (!historyModelMatches) addBlocker("history_model_mismatch");
  if (!historyVoiceMatches) addBlocker("history_voice_mismatch");
  if (!historyTextMatches) addBlocker("history_request_text_mismatch");

  let historyAudio = Buffer.alloc(0);
  if (historyItemId && typeof downloadHistoryAudio === "function") {
    try {
      historyAudio = toBytes(
        await downloadHistoryAudio({
          historyItemId,
          requestId,
        }),
      );
    } catch {
      addBlocker("provider_history_audio_download_failed");
    }
  }
  const rawFingerprint = fingerprint(rawAudio);
  const historyFingerprint = fingerprint(historyAudio);
  const compressedBytesMatch =
    rawFingerprint.sha256 !== null &&
    rawFingerprint.sha256 === historyFingerprint.sha256 &&
    rawFingerprint.size_bytes === historyFingerprint.size_bytes;
  let rawDecodedAudio = { ok: false };
  let historyDecodedAudio = { ok: false };
  if (
    !compressedBytesMatch &&
    rawAudio.length > 0 &&
    historyAudio.length > 0 &&
    typeof decodeAudioToCanonicalPcm === "function"
  ) {
    try {
      rawDecodedAudio =
        (await decodeAudioToCanonicalPcm(rawAudio, {
          role: "raw_provider_response",
        })) || { ok: false };
      historyDecodedAudio =
        (await decodeAudioToCanonicalPcm(historyAudio, {
          role: "provider_history_download",
        })) || { ok: false };
    } catch {
      rawDecodedAudio = { ok: false };
      historyDecodedAudio = { ok: false };
    }
  }
  const rawDecodedFingerprint = fingerprint(
    rawDecodedAudio.ok === true ? rawDecodedAudio.bytes : Buffer.alloc(0),
  );
  const historyDecodedFingerprint = fingerprint(
    historyDecodedAudio.ok === true
      ? historyDecodedAudio.bytes
      : Buffer.alloc(0),
  );
  const decodedPcmMatches =
    rawDecodedAudio.ok === true &&
    historyDecodedAudio.ok === true &&
    rawDecodedFingerprint.sha256 !== null &&
    rawDecodedFingerprint.sha256 === historyDecodedFingerprint.sha256 &&
    rawDecodedFingerprint.size_bytes ===
      historyDecodedFingerprint.size_bytes;
  const historyAudioMatchesRaw = compressedBytesMatch || decodedPcmMatches;
  const audioIdentityMethod = compressedBytesMatch
    ? "compressed_bytes_sha256"
    : decodedPcmMatches
      ? "decoded_pcm_s16le_44100_mono_sha256"
      : null;
  if (!historyAudioMatchesRaw) {
    addBlocker("history_audio_does_not_match_raw_response");
  }

  const captureEntitlementBracketsGeneration =
    pre.paid_plan &&
    post.paid_plan &&
    chronological(
      pre.retrieved_at,
      generationStartedAt,
      generationFinishedAt,
      post.retrieved_at,
    );
  if (!captureEntitlementBracketsGeneration) {
    addBlocker("paid_entitlement_does_not_bracket_generation");
  }
  const capturePolicyFilesVerified =
    policyUrls.length > 0 &&
    policyEvidence.length === policyUrls.length &&
    REQUIRED_POLICY_URLS.every((url) => policyUrlsCaptured.has(url));
  const captureModelIsProductionTts =
    modelSnapshot.regular_production_model && Boolean(modelSnapshotFile);
  const generationBlockers = [...blockers];
  const generationChecks = {
    entitlement_brackets_generation: captureEntitlementBracketsGeneration,
    paid_subscription_pre_generation: pre.paid_plan,
    paid_subscription_post_generation: post.paid_plan,
    model_is_production_tts: captureModelIsProductionTts,
    official_model_snapshot_verified: captureModelIsProductionTts,
    policy_files_verified: capturePolicyFilesVerified,
    official_policy_files_verified: capturePolicyFilesVerified,
    request_id_matches_history: historyRequestMatches,
    history_item_identity_present: Boolean(historyItemId),
    history_date_present:
      Number.isFinite(historyDateUnix) && historyDateUnix > 0,
    history_model_matches: historyModelMatches,
    history_voice_matches: historyVoiceMatches,
    history_text_matches: historyTextMatches,
    history_audio_matches_raw_response: historyAudioMatchesRaw,
    no_secret_fields: true,
    no_personal_fields: true,
    no_invoice_fields: true,
  };
  generationChecks.every_generation_condition_proven =
    generationBlockers.length === 0 &&
    Object.values(generationChecks).every((value) => value === true);
  const generationVerdict = generationChecks.every_generation_condition_proven
    ? "GREEN"
    : "AMBER";

  const rawAudioPath = path.join(evidenceDir, "raw-provider-audio.bin");
  if (rawAudio.length > 0) {
    await fs.outputFile(rawAudioPath, rawAudio);
  } else {
    await fs.remove(rawAudioPath).catch(() => {});
  }
  const rawAudioFile = rawAudio.length > 0
    ? {
        path: path.relative(root, rawAudioPath).replace(/\\/g, "/"),
        sha256: rawFingerprint.sha256,
        size_bytes: rawFingerprint.size_bytes,
      }
    : {
        path: null,
        sha256: null,
        size_bytes: 0,
      };
  const receipt = {
    schema: "pulse_elevenlabs_generation_receipt_v1",
    schema_version: 1,
    story_id: clean(storyId),
    asset_id: clean(assetId),
    captured_at: isoNow(now),
    verdict: "AMBER",
    generation_verdict: generationVerdict,
    final_media_lineage_status: "PENDING",
    commercial_use_allowed: false,
    provider: {
      id: "elevenlabs",
      model_id: clean(modelId),
      model_snapshot: modelSnapshot,
      model_snapshot_path: modelSnapshotFile
        ? path.relative(root, modelSnapshotFile.path).replace(/\\/g, "/")
        : null,
      model_snapshot_sha256: modelSnapshotFile?.sha256 || null,
      model_snapshot_size_bytes: modelSnapshotFile?.size_bytes || 0,
      model_evidence: {
        source_endpoint: modelSnapshot.source_endpoint,
        retrieved_at: modelSnapshot.retrieved_at,
        text_to_speech: modelSnapshot.text_to_speech,
        requires_alpha_access: modelSnapshot.requires_alpha_access,
      },
    },
    policy_evidence: {
      jurisdiction: "UK_EEA",
      paid_plan_required: true,
      beta_service_production_forbidden: true,
      documents: policyEvidence,
    },
    account_entitlement: {
      source_endpoint: SUBSCRIPTION_ENDPOINT,
      pre_generation: {
        ...pre,
        evidence_path: path
          .relative(root, preEvidence.path)
          .replace(/\\/g, "/"),
        evidence_sha256: preEvidence.sha256,
        evidence_size_bytes: preEvidence.size_bytes,
      },
      post_generation: {
        ...post,
        evidence_path: path
          .relative(root, postEvidence.path)
          .replace(/\\/g, "/"),
        evidence_sha256: postEvidence.sha256,
        evidence_size_bytes: postEvidence.size_bytes,
      },
      paid_at_generation: captureEntitlementBracketsGeneration,
      secrets_recorded: false,
    },
    generation: {
      request_started_at: generationStartedAt,
      response_received_at: generationFinishedAt,
      request_id: requestId || null,
      history_item_id: historyItemId || null,
      history_date_unix:
        Number.isFinite(historyDateUnix) && historyDateUnix > 0
          ? historyDateUnix
          : null,
      voice_id_sha256: clean(voiceId) ? voiceIdSha256 : null,
      request_text_sha256: requestTextSha256,
      request_settings_sha256: sha256(
        Buffer.from(stableJson(sanitiseSettings(requestSettings)), "utf8"),
      ),
      raw_provider_audio_path: rawAudioFile.path,
      raw_provider_audio_sha256: rawAudioFile.sha256,
      raw_provider_audio_size_bytes: rawAudioFile.size_bytes,
      history_audio_sha256: historyFingerprint.sha256,
      history_audio_size_bytes: historyFingerprint.size_bytes,
      audio_identity_method: audioIdentityMethod,
      compressed_bytes_match: compressedBytesMatch,
      raw_provider_audio_decoded_pcm_sha256:
        rawDecodedFingerprint.sha256,
      raw_provider_audio_decoded_pcm_size_bytes:
        rawDecodedFingerprint.size_bytes,
      history_audio_decoded_pcm_sha256:
        historyDecodedFingerprint.sha256,
      history_audio_decoded_pcm_size_bytes:
        historyDecodedFingerprint.size_bytes,
      decoded_pcm_sample_rate_hz: decodedPcmMatches
        ? Number(rawDecodedAudio.sample_rate_hz) || 44100
        : null,
      decoded_pcm_channels: decodedPcmMatches
        ? Number(rawDecodedAudio.channels) || 1
        : null,
      decoded_pcm_sample_format: decodedPcmMatches
        ? clean(rawDecodedAudio.sample_format) || "s16le"
        : null,
    },
    generation_checks: generationChecks,
    generation_blockers: generationBlockers,
    blockers: [...generationBlockers, "final_media_lineage_pending"],
    licence_basis: "elevenlabs_commercial_tts_generation",
    allowed_platforms: normalisePlatforms(targetPlatforms),
    safety: {
      secrets_recorded: false,
      personal_account_fields_recorded: false,
      invoice_fields_recorded: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      publishing_triggered: false,
      database_mutated: false,
    },
  };
  const receiptPath = path.join(
    evidenceDir,
    "elevenlabs-generation-receipt.json",
  );
  await fs.outputJson(receiptPath, receipt, { spaces: 2 });
  if (deferFinalization) {
    return {
      verdict: "AMBER",
      receipt,
      receiptPath,
      receipt_path: receiptPath,
      rawAudioPath: rawAudio.length > 0 ? rawAudioPath : null,
      raw_audio_path: rawAudio.length > 0 ? rawAudioPath : null,
    };
  }

  let finalised = {};
  if (rawAudio.length > 0 && typeof finalizeLineage === "function") {
    try {
      finalised =
        (await finalizeLineage({
          rawAudioBytes: rawAudio,
          rawAudioSha256: rawFingerprint.sha256,
          storyId: clean(storyId),
          assetId: clean(assetId),
        })) || {};
    } catch {
      addBlocker("lineage_finalisation_failed");
    }
  }
  const lineageFingerprints = {
    mastered_audio_input: fingerprint(finalised.masteredAudioInputBytes),
    mastered_audio_output: fingerprint(finalised.masteredAudioOutputBytes),
    final_audio: fingerprint(finalised.finalAudioBytes),
    word_timestamps: fingerprint(finalised.wordTimestampsBytes),
    captions: fingerprint(finalised.captionsBytes),
    final_video: fingerprint(finalised.finalVideoBytes),
  };
  const lineageComplete =
    lineageFingerprints.mastered_audio_input.sha256 === rawFingerprint.sha256 &&
    lineageFingerprints.mastered_audio_output.sha256 ===
      lineageFingerprints.final_audio.sha256 &&
    Object.values(lineageFingerprints).every(
      (entry) => entry.sha256 && entry.size_bytes > 0,
    );
  if (!lineageComplete) addBlocker("raw_to_final_media_lineage_incomplete");

  const entitlementBracketsGeneration =
    pre.paid_plan &&
    post.paid_plan &&
    chronological(
      pre.retrieved_at,
      generationStartedAt,
      generationFinishedAt,
      post.retrieved_at,
    );
  if (!entitlementBracketsGeneration) {
    addBlocker("paid_entitlement_does_not_bracket_generation");
  }

  const currentStoryAndAudioMatch =
    Boolean(clean(storyId)) &&
    Boolean(clean(assetId)) &&
    lineageFingerprints.final_audio.sha256 !== null &&
    lineageFingerprints.final_audio.size_bytes > 0;
  if (!currentStoryAndAudioMatch) {
    addBlocker("current_story_or_audio_binding_missing");
  }

  receipt.mastering_lineage = {
    raw_provider_audio_sha256: rawFingerprint.sha256,
    raw_provider_audio_size_bytes: rawFingerprint.size_bytes,
    mastered_audio_sha256: lineageFingerprints.final_audio.sha256,
    mastered_audio_size_bytes: lineageFingerprints.final_audio.size_bytes,
    transform_status: lineageComplete ? "COMPLETE" : "INCOMPLETE",
    post_generation_transform_status: lineageComplete
      ? "COMPLETE"
      : "INCOMPLETE",
  };
  receipt.final_media_lineage_status =
    lineageComplete && currentStoryAndAudioMatch ? "COMPLETE" : "PENDING";
  receipt.blockers = [
    ...generationBlockers,
    ...(receipt.final_media_lineage_status === "COMPLETE"
      ? []
      : ["final_media_lineage_pending"]),
  ];
  let generationReceiptFingerprint = {
    sha256: null,
    size_bytes: 0,
  };
  try {
    await fs.outputJson(receiptPath, receipt, { spaces: 2 });
    generationReceiptFingerprint = fingerprint(await fs.readFile(receiptPath));
  } catch {
    addBlocker("generation_receipt_finalisation_failed");
  }
  const generationReceiptBound =
    generationReceiptFingerprint.sha256 !== null &&
    generationReceiptFingerprint.size_bytes > 0;
  if (!generationReceiptBound) {
    addBlocker("generation_receipt_finalisation_failed");
  }

  const policyFilesVerified =
    policyUrls.length > 0 &&
    policyEvidence.length === policyUrls.length &&
    REQUIRED_POLICY_URLS.every((url) => policyUrlsCaptured.has(url));
  const modelIsProductionTts =
    modelSnapshot.regular_production_model && Boolean(modelSnapshotFile);
  const strictChecks = {
    entitlement_brackets_generation: entitlementBracketsGeneration,
    paid_subscription_pre_generation: pre.paid_plan,
    paid_subscription_post_generation: post.paid_plan,
    model_is_production_tts: modelIsProductionTts,
    official_model_snapshot_verified: modelIsProductionTts,
    policy_files_verified: policyFilesVerified,
    official_policy_files_verified: policyFilesVerified,
    request_id_matches_history: historyRequestMatches,
    history_item_identity_present: Boolean(historyItemId),
    history_date_present:
      Number.isFinite(historyDateUnix) && historyDateUnix > 0,
    history_model_matches: historyModelMatches,
    history_voice_matches: historyVoiceMatches,
    history_text_matches: historyTextMatches,
    history_audio_matches_raw_response: historyAudioMatchesRaw,
    lineage_hash_chain_complete: lineageComplete,
    current_story_and_audio_match: currentStoryAndAudioMatch,
    generation_receipt_bound: generationReceiptBound,
    no_secret_fields: true,
    no_personal_fields: true,
    no_invoice_fields: true,
  };
  strictChecks.every_strict_v3_condition_proven =
    blockers.length === 0 &&
    Object.values(strictChecks).every((value) => value === true);

  const verdict = strictChecks.every_strict_v3_condition_proven
    ? "GREEN"
    : "AMBER";
  const capturedAt = isoNow(now);
  const evidence = {
    schema: "pulse_elevenlabs_commercial_tts_evidence_v3",
    schema_version: 3,
    story_id: clean(storyId),
    asset_id: clean(assetId),
    captured_at: capturedAt,
    verdict,
    provider: {
      id: "elevenlabs",
      model_id: clean(modelId),
      model_snapshot: modelSnapshot,
      model_snapshot_path: modelSnapshotFile
        ? path.relative(root, modelSnapshotFile.path).replace(/\\/g, "/")
        : null,
      model_snapshot_sha256: modelSnapshotFile?.sha256 || null,
      model_snapshot_size_bytes: modelSnapshotFile?.size_bytes || 0,
      model_evidence: {
        source_endpoint: modelSnapshot.source_endpoint,
        retrieved_at: modelSnapshot.retrieved_at,
        text_to_speech: modelSnapshot.text_to_speech,
        requires_alpha_access: modelSnapshot.requires_alpha_access,
      },
    },
    policy_evidence: {
      jurisdiction: "UK_EEA",
      paid_plan_required: true,
      beta_service_production_forbidden: true,
      documents: policyEvidence,
    },
    account_entitlement: {
      source_endpoint: SUBSCRIPTION_ENDPOINT,
      pre_generation: {
        ...pre,
        evidence_path: path
          .relative(root, preEvidence.path)
          .replace(/\\/g, "/"),
        evidence_sha256: preEvidence.sha256,
        evidence_size_bytes: preEvidence.size_bytes,
      },
      post_generation: {
        ...post,
        evidence_path: path
          .relative(root, postEvidence.path)
          .replace(/\\/g, "/"),
        evidence_sha256: postEvidence.sha256,
        evidence_size_bytes: postEvidence.size_bytes,
      },
      paid_at_generation: entitlementBracketsGeneration,
      secrets_recorded: false,
    },
    generation: {
      request_started_at: generationStartedAt,
      response_received_at: generationFinishedAt,
      request_id: requestId || null,
      history_item_id: historyItemId || null,
      history_date_unix:
        Number.isFinite(historyDateUnix) && historyDateUnix > 0
          ? historyDateUnix
          : null,
      voice_id_sha256: clean(voiceId)
        ? sha256(Buffer.from(clean(voiceId), "utf8"))
        : null,
      request_text_sha256: requestTextSha256,
      request_settings_sha256: sha256(
        Buffer.from(stableJson(sanitiseSettings(requestSettings)), "utf8"),
      ),
      raw_provider_audio_sha256: rawFingerprint.sha256,
      raw_provider_audio_size_bytes: rawFingerprint.size_bytes,
      history_audio_sha256: historyFingerprint.sha256,
      history_audio_size_bytes: historyFingerprint.size_bytes,
      audio_identity_method: audioIdentityMethod,
      compressed_bytes_match: compressedBytesMatch,
      raw_provider_audio_decoded_pcm_sha256:
        rawDecodedFingerprint.sha256,
      raw_provider_audio_decoded_pcm_size_bytes:
        rawDecodedFingerprint.size_bytes,
      history_audio_decoded_pcm_sha256:
        historyDecodedFingerprint.sha256,
      history_audio_decoded_pcm_size_bytes:
        historyDecodedFingerprint.size_bytes,
      decoded_pcm_sample_rate_hz: decodedPcmMatches
        ? Number(rawDecodedAudio.sample_rate_hz) || 44100
        : null,
      decoded_pcm_channels: decodedPcmMatches
        ? Number(rawDecodedAudio.channels) || 1
        : null,
      decoded_pcm_sample_format: decodedPcmMatches
        ? clean(rawDecodedAudio.sample_format) || "s16le"
        : null,
    },
    lineage: {
      spoken_script_sha256: requestTextSha256,
      raw_provider_audio_sha256: rawFingerprint.sha256,
      mastered_audio_input_sha256:
        lineageFingerprints.mastered_audio_input.sha256,
      mastered_audio_output_sha256:
        lineageFingerprints.mastered_audio_output.sha256,
      final_audio_sha256: lineageFingerprints.final_audio.sha256,
      word_timestamps_sha256: lineageFingerprints.word_timestamps.sha256,
      captions_sha256: lineageFingerprints.captions.sha256,
      final_video_sha256: lineageFingerprints.final_video.sha256,
      sizes_bytes: {
        raw_provider_audio: rawFingerprint.size_bytes,
        mastered_audio_input:
          lineageFingerprints.mastered_audio_input.size_bytes,
        mastered_audio_output:
          lineageFingerprints.mastered_audio_output.size_bytes,
        final_audio: lineageFingerprints.final_audio.size_bytes,
        word_timestamps: lineageFingerprints.word_timestamps.size_bytes,
        captions: lineageFingerprints.captions.size_bytes,
        final_video: lineageFingerprints.final_video.size_bytes,
      },
    },
    generation_receipt: {
      path: path.relative(root, receiptPath).replace(/\\/g, "/"),
      sha256: generationReceiptFingerprint.sha256,
      size_bytes: generationReceiptFingerprint.size_bytes,
    },
    licence_basis: "elevenlabs_commercial_tts_generation",
    allowed_platforms: normalisePlatforms(targetPlatforms),
    commercial_use_allowed: verdict === "GREEN",
    checks: strictChecks,
    blockers,
    safety: {
      secrets_recorded: false,
      personal_account_fields_recorded: false,
      invoice_fields_recorded: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      publishing_triggered: false,
      database_mutated: false,
    },
  };
  const evidencePath = path.join(
    root,
    "rights",
    "elevenlabs-commercial-tts.json",
  );
  await fs.outputJson(evidencePath, evidence, { spaces: 2 });
  return {
    verdict,
    evidence,
    evidencePath,
    evidence_path: evidencePath,
  };
}

async function captureElevenLabsGenerationRightsReceipt(options = {}) {
  return materializeElevenLabsGenerationRightsLineage({
    ...options,
    finalizeLineage: undefined,
    deferFinalization: true,
  });
}

async function finalizeElevenLabsGenerationRightsLineage({
  artifactDir,
  receiptPath,
  requestText,
  targetPlatforms = [],
  now = () => new Date(),
  finalizeLineage,
} = {}) {
  const root = path.resolve(clean(artifactDir) || ".");
  const blockers = [];
  const addBlocker = (value) => {
    const blocker = clean(value);
    if (blocker && !blockers.includes(blocker)) blockers.push(blocker);
  };
  const resolvedReceiptPath = path.resolve(
    clean(receiptPath) ||
      path.join(root, "rights", "evidence", "elevenlabs-generation-receipt.json"),
  );
  let receipt = {};
  try {
    receipt = await fs.readJson(resolvedReceiptPath);
  } catch {
    addBlocker("generation_receipt_missing_or_unreadable");
  }
  if (
    clean(receipt.schema) !== "pulse_elevenlabs_generation_receipt_v1" ||
    Number(receipt.schema_version) !== 1
  ) {
    addBlocker("generation_receipt_schema_invalid");
  }
  if (
    clean(receipt.generation_verdict).toUpperCase() !== "GREEN" ||
    (Array.isArray(receipt.generation_blockers) &&
      receipt.generation_blockers.length > 0)
  ) {
    addBlocker("generation_receipt_not_green");
  }
  if (typeof finalizeLineage !== "function") {
    addBlocker("finalizeLineage_unavailable");
  }

  const rawRelativePath = clean(
    receipt.generation?.raw_provider_audio_path,
  );
  const rawAudioPath = rawRelativePath
    ? path.resolve(root, rawRelativePath)
    : "";
  const rawInsideRoot =
    Boolean(rawAudioPath) &&
    (rawAudioPath === root || rawAudioPath.startsWith(`${root}${path.sep}`));
  let rawAudio = Buffer.alloc(0);
  if (!rawInsideRoot || !(await fs.pathExists(rawAudioPath))) {
    addBlocker("raw_provider_audio_receipt_file_missing");
  } else {
    rawAudio = await fs.readFile(rawAudioPath);
  }
  const rawFingerprint = fingerprint(rawAudio);
  if (
    rawFingerprint.sha256 !==
      clean(receipt.generation?.raw_provider_audio_sha256).toLowerCase() ||
    rawFingerprint.size_bytes !==
      Number(receipt.generation?.raw_provider_audio_size_bytes)
  ) {
    addBlocker("raw_provider_audio_receipt_hash_mismatch");
  }

  const requestTextSha256 = sha256(Buffer.from(clean(requestText), "utf8"));
  if (
    !clean(requestText) ||
    requestTextSha256 !==
      clean(receipt.generation?.request_text_sha256).toLowerCase()
  ) {
    addBlocker("request_text_receipt_mismatch");
  }

  let finalised = {};
  if (rawAudio.length > 0 && typeof finalizeLineage === "function") {
    try {
      finalised =
        (await finalizeLineage({
          rawAudioBytes: rawAudio,
          rawAudioSha256: rawFingerprint.sha256,
          storyId: clean(receipt.story_id),
          assetId: clean(receipt.asset_id),
        })) || {};
    } catch {
      addBlocker("lineage_finalisation_failed");
    }
  }
  const lineageFingerprints = {
    mastered_audio_input: fingerprint(finalised.masteredAudioInputBytes),
    mastered_audio_output: fingerprint(finalised.masteredAudioOutputBytes),
    final_audio: fingerprint(finalised.finalAudioBytes),
    word_timestamps: fingerprint(finalised.wordTimestampsBytes),
    captions: fingerprint(finalised.captionsBytes),
    final_video: fingerprint(finalised.finalVideoBytes),
  };
  const lineageComplete =
    lineageFingerprints.mastered_audio_input.sha256 ===
      rawFingerprint.sha256 &&
    lineageFingerprints.mastered_audio_output.sha256 ===
      lineageFingerprints.final_audio.sha256 &&
    Object.values(lineageFingerprints).every(
      (entry) => entry.sha256 && entry.size_bytes > 0,
    );
  if (!lineageComplete) addBlocker("raw_to_final_media_lineage_incomplete");
  const masteringLineage = receipt.mastering_lineage || {};
  const masteringReceiptBindingComplete =
    clean(masteringLineage.transform_status).toUpperCase() === "COMPLETE" &&
    clean(masteringLineage.raw_provider_audio_sha256).toLowerCase() ===
      rawFingerprint.sha256 &&
    Number(masteringLineage.raw_provider_audio_size_bytes) ===
      rawFingerprint.size_bytes &&
    clean(masteringLineage.mastered_audio_sha256).toLowerCase() ===
      lineageFingerprints.final_audio.sha256 &&
    Number(masteringLineage.mastered_audio_size_bytes) ===
      lineageFingerprints.final_audio.size_bytes;
  if (!masteringReceiptBindingComplete) {
    addBlocker("generation_receipt_mastered_audio_binding_mismatch");
  }

  const currentStoryAndAudioMatch =
    Boolean(clean(receipt.story_id)) &&
    Boolean(clean(receipt.asset_id)) &&
    lineageFingerprints.final_audio.sha256 !== null &&
    lineageFingerprints.final_audio.size_bytes > 0;
  if (!currentStoryAndAudioMatch) {
    addBlocker("current_story_or_audio_binding_missing");
  }
  const platforms = normalisePlatforms(
    targetPlatforms.length > 0 ? targetPlatforms : receipt.allowed_platforms,
  );
  const checks = {
    ...(receipt.generation_checks || {}),
    lineage_hash_chain_complete: lineageComplete,
    mastering_receipt_binding_complete: masteringReceiptBindingComplete,
    current_story_and_audio_match: currentStoryAndAudioMatch,
    no_secret_fields: true,
    no_personal_fields: true,
    no_invoice_fields: true,
  };
  checks.every_strict_v3_condition_proven =
    blockers.length === 0 &&
    Object.values(checks).every((value) => value === true);
  const verdict = checks.every_strict_v3_condition_proven
    ? "GREEN"
    : "AMBER";
  const evidence = {
    schema: "pulse_elevenlabs_commercial_tts_evidence_v3",
    schema_version: 3,
    story_id: clean(receipt.story_id),
    asset_id: clean(receipt.asset_id),
    captured_at: isoNow(now),
    verdict,
    provider: receipt.provider || {},
    policy_evidence: receipt.policy_evidence || {},
    account_entitlement: receipt.account_entitlement || {},
    generation: {
      ...(receipt.generation || {}),
      raw_provider_audio_path: undefined,
    },
    lineage: {
      spoken_script_sha256: requestTextSha256,
      raw_provider_audio_sha256: rawFingerprint.sha256,
      mastered_audio_input_sha256:
        lineageFingerprints.mastered_audio_input.sha256,
      mastered_audio_output_sha256:
        lineageFingerprints.mastered_audio_output.sha256,
      final_audio_sha256: lineageFingerprints.final_audio.sha256,
      word_timestamps_sha256: lineageFingerprints.word_timestamps.sha256,
      captions_sha256: lineageFingerprints.captions.sha256,
      final_video_sha256: lineageFingerprints.final_video.sha256,
      sizes_bytes: {
        raw_provider_audio: rawFingerprint.size_bytes,
        mastered_audio_input:
          lineageFingerprints.mastered_audio_input.size_bytes,
        mastered_audio_output:
          lineageFingerprints.mastered_audio_output.size_bytes,
        final_audio: lineageFingerprints.final_audio.size_bytes,
        word_timestamps: lineageFingerprints.word_timestamps.size_bytes,
        captions: lineageFingerprints.captions.size_bytes,
        final_video: lineageFingerprints.final_video.size_bytes,
      },
    },
    generation_receipt: {
      path: path.relative(root, resolvedReceiptPath).replace(/\\/g, "/"),
      ...fingerprint(await fs.readFile(resolvedReceiptPath).catch(() => Buffer.alloc(0))),
    },
    licence_basis: "elevenlabs_commercial_tts_generation",
    allowed_platforms: platforms,
    commercial_use_allowed: verdict === "GREEN",
    checks,
    blockers,
    safety: {
      secrets_recorded: false,
      personal_account_fields_recorded: false,
      invoice_fields_recorded: false,
      oauth_mutated: false,
      token_mutated: false,
      billing_mutated: false,
      publishing_triggered: false,
      database_mutated: false,
    },
  };
  const evidencePath = path.join(
    root,
    "rights",
    "elevenlabs-commercial-tts.json",
  );
  await fs.outputJson(evidencePath, evidence, { spaces: 2 });
  return {
    verdict,
    evidence,
    evidencePath,
    evidence_path: evidencePath,
  };
}

module.exports = {
  REQUIRED_POLICY_URLS,
  captureElevenLabsGenerationRightsReceipt,
  defaultDecodeAudioToCanonicalPcm,
  finalizeElevenLabsGenerationRightsLineage,
  inspectPendingElevenLabsGenerationRightsReceipt,
  materializeElevenLabsGenerationRightsLineage,
};
