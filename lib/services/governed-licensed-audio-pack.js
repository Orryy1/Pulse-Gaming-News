"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MANIFEST_SCHEMA = "pulse-governed-licensed-audio-pack-v1";
const RIGHTS_EVIDENCE_SCHEMA =
  "pulse-governed-licensed-audio-rights-evidence-v1";
const RIGHTS_LEDGER_SCHEMA =
  "pulse-governed-licensed-audio-rights-ledger-v1";
const SAFELIST_EVIDENCE_SCHEMA =
  "pulse-epidemic-safelist-evidence-v1";
const POLICY = "EPIDEMIC_SOUND_LICENSED_PACK_V1";
const PROVIDER_ID = "epidemic_sound";
const LICENCE_BASIS =
  "epidemic_sound_active_subscription_safelisted_channel";
const APPROVAL_STATUS =
  "approved_for_commercial_editorial_use";
const MIX_POLICY = "epidemic_sidechain_ducked_bed_v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const TIMESTAMP_SKEW_MS = 60_000;
const MAX_EVIDENCE_AGE_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_SHORT_DURATION_SECONDS = 59;
const PULSE_YOUTUBE_ACCOUNT_URI =
  "https://www.youtube.com/@PulseGMG";
const AUDIO_EXTENSIONS = new Set([
  ".aac",
  ".flac",
  ".m4a",
  ".mp3",
  ".ogg",
  ".wav",
]);
const ROLES = new Set([
  "MUSIC_BED",
  "MUSIC_STING",
  "SFX_IMPACT",
  "SFX_TRANSITION",
  "SFX_UI_TICK",
]);
const REQUIRED_PROHIBITED_USES = new Set([
  "AFFILIATE_PROMOTION",
  "CLIENT_FUNDED_USE",
  "CROSS_PLATFORM_REPOSTING",
  "PAID_ACCESS",
  "SPONSORSHIP",
]);
const EXACT_DESTINATIONS = new Set(["YOUTUBE_SHORTS"]);
const EXACT_REVENUE_MODES = new Set([
  "ORGANIC",
  "PLATFORM_ADVERTISING",
]);
const ROLE_LEDGER_CONTRACT = Object.freeze({
  MUSIC_BED: {
    asset_type: "music_bed",
    role: "bed_primary",
  },
  MUSIC_STING: {
    asset_type: "music_sting",
    role: "sting_verified",
  },
  SFX_IMPACT: {
    asset_type: "sfx",
    role: "impact",
  },
  SFX_TRANSITION: {
    asset_type: "sfx",
    role: "transition",
  },
  SFX_UI_TICK: {
    asset_type: "sfx",
    role: "ui_tick",
  },
});

class GovernedLicensedAudioPackError extends Error {
  constructor(codes) {
    const values = [
      ...new Set(
        (Array.isArray(codes) ? codes : [codes])
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    super(
      `governed_licensed_audio_pack_validation_failed: ${values.join(", ")}`,
    );
    this.name = "GovernedLicensedAudioPackError";
    this.codes = values;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

function fingerprintRightsRecord(value) {
  return sha256(
    Buffer.from(JSON.stringify(canonicalise(value)), "utf8"),
  );
}

function cleanHash(value, code) {
  const hash = text(value).replace(/^sha256:/i, "").toLowerCase();
  if (!SHA256_PATTERN.test(hash)) {
    throw new GovernedLicensedAudioPackError(code);
  }
  return hash;
}

function upperSet(value) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => text(item).toUpperCase())
      .filter(Boolean),
  );
}

function lowerSet(value) {
  return new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => text(item).toLowerCase())
      .filter(Boolean),
  );
}

function setsEqual(left, right) {
  return (
    left.size === right.size &&
    [...left].every((value) => right.has(value))
  );
}

function assertHttps(value, code) {
  try {
    const parsed = new URL(text(value));
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("invalid");
    }
    return parsed.href;
  } catch {
    throw new GovernedLicensedAudioPackError(code);
  }
}

function assertTimestamp(value, boundaryMs, code) {
  const timestamp = Date.parse(text(value));
  if (
    !Number.isFinite(timestamp) ||
    timestamp > boundaryMs + TIMESTAMP_SKEW_MS
  ) {
    throw new GovernedLicensedAudioPackError(code);
  }
  return new Date(timestamp).toISOString();
}

function assertReviewWindow({
  reviewedAt,
  reviewDueAt,
  boundaryMs,
  prefix,
}) {
  const reviewed = Date.parse(
    assertTimestamp(
      reviewedAt,
      boundaryMs,
      `${prefix}_reviewed_at_invalid`,
    ),
  );
  const due = Date.parse(text(reviewDueAt));
  if (
    !Number.isFinite(due) ||
    due <= reviewed ||
    boundaryMs > due ||
    boundaryMs - reviewed > MAX_EVIDENCE_AGE_MS
  ) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_review_window_invalid`,
    );
  }
  return {
    reviewed_at: new Date(reviewed).toISOString(),
    review_due_at: new Date(due).toISOString(),
  };
}

function assertNumberInRange(
  value,
  { minimum, maximum, exclusiveMinimum = false },
  code,
) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (exclusiveMinimum ? value <= minimum : value < minimum) ||
    value > maximum
  ) {
    throw new GovernedLicensedAudioPackError(code);
  }
  return value;
}

function assertNoSymlinkComponents(root, relativePath, prefix) {
  let cursor = root;
  for (const part of relativePath.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_symlink_forbidden`,
      );
    }
  }
}

function canonicalRelativePackagePath(value, prefix) {
  const declared = text(value);
  const segments = declared.split("/");
  if (
    !declared ||
    declared.includes("\0") ||
    declared.includes("\\") ||
    declared.includes(":") ||
    /^[a-z]:/i.test(declared) ||
    declared.startsWith("/") ||
    declared.startsWith("//") ||
    path.isAbsolute(declared) ||
    path.posix.normalize(declared) !== declared ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        /[. ]$/.test(segment) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(
          segment,
        ),
    )
  ) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_path_invalid`,
    );
  }
  return segments.join(path.sep);
}

function resolveContainedFile({
  root,
  record,
  prefix,
  expectedSize = false,
}) {
  const declared = text(record?.path);
  let packageRelative;
  try {
    packageRelative = canonicalRelativePackagePath(
      declared,
      prefix,
    );
  } catch (error) {
    if (error instanceof GovernedLicensedAudioPackError) {
      throw error;
    }
    throw new GovernedLicensedAudioPackError(
      `${prefix}_path_invalid`,
    );
  }
  const resolvedRoot = path.resolve(root);
  let rootStat;
  try {
    rootStat = fs.lstatSync(resolvedRoot);
  } catch {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_root_invalid`,
    );
  }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_root_invalid`,
    );
  }
  const resolved = path.resolve(
    resolvedRoot,
    packageRelative,
  );
  const relative = path.relative(resolvedRoot, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_path_escape`,
    );
  }
  assertNoSymlinkComponents(resolvedRoot, relative, prefix);
  let stat;
  try {
    stat = fs.lstatSync(resolved);
  } catch {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_file_missing`,
    );
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_file_invalid`,
    );
  }
  const canonicalRoot = fs.realpathSync.native(resolvedRoot);
  const canonicalTarget = fs.realpathSync.native(resolved);
  const canonicalRelative = path.relative(
    canonicalRoot,
    canonicalTarget,
  );
  if (
    !canonicalRelative ||
    canonicalRelative === ".." ||
    canonicalRelative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(canonicalRelative)
  ) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_realpath_escape`,
    );
  }
  const beforeRead = fs.statSync(resolved);
  const bytes = fs.readFileSync(resolved);
  const afterRead = fs.statSync(resolved);
  if (
    beforeRead.size !== afterRead.size ||
    beforeRead.mtimeMs !== afterRead.mtimeMs ||
    beforeRead.ctimeMs !== afterRead.ctimeMs ||
    beforeRead.ino !== afterRead.ino
  ) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_changed_during_read`,
    );
  }
  const observedHash = sha256(bytes);
  const expectedHash = cleanHash(
    record?.sha256,
    `${prefix}_sha256_invalid`,
  );
  if (observedHash !== expectedHash) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_sha256_mismatch`,
    );
  }
  if (
    expectedSize &&
    (!Number.isInteger(record?.size_bytes) ||
      record.size_bytes !== bytes.length)
  ) {
    throw new GovernedLicensedAudioPackError(
      `${prefix}_size_mismatch`,
    );
  }
  return {
    path: resolved,
    relative_path: relative.replace(/\\/g, "/"),
    sha256: observedHash,
    size_bytes: bytes.length,
    bytes,
  };
}

function readContainedJson(options) {
  const file = resolveContainedFile(options);
  try {
    return {
      ...file,
      value: JSON.parse(file.bytes.toString("utf8")),
    };
  } catch {
    throw new GovernedLicensedAudioPackError(
      `${options.prefix}_json_invalid`,
    );
  }
}

function recordMatchesScope({
  record,
  requiredDestination,
  requiredRevenueMode,
}) {
  return (
    lowerSet(record?.allowed_platforms).has(
      requiredDestination.toLowerCase(),
    ) &&
    lowerSet(record?.allowed_revenue_modes).has(
      requiredRevenueMode.toLowerCase(),
    )
  );
}

function validateGovernedLicensedAudioPack({
  manifestPath,
  expectedManifestSha256,
  expectedStoryId,
  expectedChannelId,
  expectedNarrationSha256,
  expectedTimestampsSha256,
  expectedTargetDurationSeconds,
  expectedRightsLedgerSha256,
  expectedYoutubeAccountUri,
  requiredDestination,
  requiredRevenueMode,
  validationBoundaryAt,
} = {}) {
  const requestedBoundaryMs = Date.parse(text(validationBoundaryAt));
  const nowMs = Date.now();
  if (
    !Number.isFinite(requestedBoundaryMs) ||
    requestedBoundaryMs > nowMs + TIMESTAMP_SKEW_MS
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_validation_boundary_invalid",
    );
  }
  const boundaryMs = Math.min(requestedBoundaryMs, nowMs);
  const manifestAbsolutePath = path.resolve(text(manifestPath));
  const root = path.dirname(manifestAbsolutePath);
  const manifest = readContainedJson({
    root,
    record: {
      path: path.basename(manifestAbsolutePath),
      sha256: expectedManifestSha256,
    },
    prefix: "licensed_audio_manifest",
  });
  const value = manifest.value;
  const storyId = text(expectedStoryId);
  if (
    value?.schema_version !== MANIFEST_SCHEMA ||
    value?.policy !== POLICY ||
    !storyId ||
    text(value?.story_id) !== storyId
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_manifest_identity_invalid",
    );
  }
  const channelId = text(expectedChannelId);
  if (
    !/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(channelId) ||
    text(value?.channel_id) !== channelId
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_manifest_channel_mismatch",
    );
  }
  assertTimestamp(
    value.generated_at,
    boundaryMs,
    "licensed_audio_manifest_generated_at_invalid",
  );
  if (
    boundaryMs - Date.parse(value.generated_at) >
    MAX_EVIDENCE_AGE_MS
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_manifest_stale",
    );
  }

  const destination = text(requiredDestination).toUpperCase();
  const revenueMode = text(requiredRevenueMode).toUpperCase();
  if (
    destination !== "YOUTUBE_SHORTS" ||
    revenueMode !== "PLATFORM_ADVERTISING"
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_required_scope_invalid",
    );
  }
  const destinations = upperSet(value?.scope?.destinations);
  const revenueModes = upperSet(value?.scope?.revenue_modes);
  const prohibited = upperSet(
    value?.scope?.prohibited_without_new_review,
  );
  if (
    !setsEqual(destinations, EXACT_DESTINATIONS) ||
    !setsEqual(revenueModes, EXACT_REVENUE_MODES)
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_scope_must_be_exact",
    );
  }
  for (const use of REQUIRED_PROHIBITED_USES) {
    if (!prohibited.has(use)) {
      throw new GovernedLicensedAudioPackError(
        "licensed_audio_prohibited_scope_incomplete",
      );
    }
  }

  const provider = value?.provider || {};
  if (
    text(provider.id).toLowerCase() !== PROVIDER_ID ||
    text(provider.licence_basis) !== LICENCE_BASIS
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_provider_invalid",
    );
  }
  const licenceEvidenceUrl = assertHttps(
    provider.licence_evidence_url,
    "licensed_audio_licence_evidence_url_invalid",
  );
  if (
    new URL(licenceEvidenceUrl).hostname.toLowerCase() !==
    "help.epidemicsound.com"
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_licence_evidence_host_invalid",
    );
  }
  const safelist = readContainedJson({
    root,
    record: provider.safelist_evidence,
    prefix: "licensed_audio_safelist_evidence",
  });
  const youtubeAccountUri = assertHttps(
    expectedYoutubeAccountUri,
    "licensed_audio_expected_youtube_account_uri_invalid",
  );
  if (youtubeAccountUri !== PULSE_YOUTUBE_ACCOUNT_URI) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_expected_youtube_account_uri_invalid",
    );
  }
  if (
    safelist.value?.schema_version !==
      SAFELIST_EVIDENCE_SCHEMA ||
    text(safelist.value?.provider_id).toLowerCase() !== PROVIDER_ID ||
    text(safelist.value?.channel_id) !== channelId ||
    text(safelist.value?.destination?.platform).toUpperCase() !==
      "YOUTUBE" ||
    text(safelist.value?.destination?.surface).toUpperCase() !==
      "SHORTS" ||
    text(safelist.value?.destination?.account_uri) !==
      youtubeAccountUri ||
    safelist.value?.active_subscription !== true ||
    safelist.value?.channel_safelisted !== true ||
    !text(safelist.value?.attested_by)
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_safelist_evidence_invalid",
    );
  }
  assertTimestamp(
    safelist.value?.attested_at,
    boundaryMs,
    "licensed_audio_safelist_attested_at_invalid",
  );
  const safelistReview = assertReviewWindow({
    reviewedAt: safelist.value?.attested_at,
    reviewDueAt: safelist.value?.review_due_at,
    boundaryMs,
    prefix: "licensed_audio_safelist",
  });

  const candidate = readContainedJson({
    root,
    record: value?.candidate_manifest,
    prefix: "licensed_audio_candidate_manifest",
  });
  if (
    candidate.value?.schema_version !==
      "pulse-canonical-story-manifest-v1" ||
    text(candidate.value?.story_id) !== storyId ||
    text(candidate.value?.channel_id) !== channelId ||
    text(candidate.value?.story?.id) !== storyId
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_candidate_story_mismatch",
    );
  }
  const ledger = readContainedJson({
    root,
    record: value?.rights_ledger,
    prefix: "licensed_audio_rights_ledger",
  });
  const externallyReviewedLedgerSha256 = cleanHash(
    expectedRightsLedgerSha256,
    "licensed_audio_expected_rights_ledger_hash_invalid",
  );
  if (ledger.sha256 !== externallyReviewedLedgerSha256) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_rights_ledger_external_hash_mismatch",
    );
  }
  if (
    ledger.value?.schema_version !== RIGHTS_LEDGER_SCHEMA ||
    text(ledger.value?.story_id) !== storyId ||
    text(ledger.value?.channel_id) !== channelId
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_rights_ledger_identity_mismatch",
    );
  }
  assertTimestamp(
    ledger.value?.generated_at,
    boundaryMs,
    "licensed_audio_rights_ledger_generated_at_invalid",
  );
  if (
    !Number.isFinite(
      Date.parse(text(ledger.value?.review_due_at)),
    ) ||
    boundaryMs >
      Date.parse(text(ledger.value?.review_due_at))
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_rights_ledger_review_window_invalid",
    );
  }
  const expectedNarrationHash = cleanHash(
    expectedNarrationSha256,
    "licensed_audio_expected_narration_sha256_invalid",
  );
  const expectedTimestampsHash = cleanHash(
    expectedTimestampsSha256,
    "licensed_audio_expected_timestamps_sha256_invalid",
  );
  const expectedDuration = Number(
    expectedTargetDurationSeconds,
  );
  if (
    text(value?.render_binding?.narration_sha256).toLowerCase() !==
      expectedNarrationHash ||
    text(value?.render_binding?.timestamps_sha256).toLowerCase() !==
      expectedTimestampsHash ||
    !Number.isFinite(expectedDuration) ||
    expectedDuration <= 0 ||
    expectedDuration > MAX_SHORT_DURATION_SECONDS ||
    Math.abs(
      Number(value?.render_binding?.target_duration_seconds) -
        expectedDuration,
    ) > 0.001
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_render_binding_mismatch",
    );
  }
  const ledgerRecords = Array.isArray(ledger.value?.records)
    ? ledger.value.records
    : [];
  const assets = Array.isArray(value?.assets) ? value.assets : [];
  if (!assets.length || assets.length > 5) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_assets_required",
    );
  }
  const seenIds = new Set();
  const seenRoles = new Set();
  const seenLocalPaths = new Set();
  const seenLocalRealpaths = new Set();
  const seenContentAliases = new Set();
  const seenRightsEvidencePaths = new Set();
  const seenRightsRecordFingerprints = new Set();
  const validatedAssets = assets.map((asset, index) => {
    const prefix = `licensed_audio_asset_${index}`;
    const assetId = text(asset?.asset_id);
    if (
      !/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(assetId) ||
      seenIds.has(assetId)
    ) {
      throw new GovernedLicensedAudioPackError(
        seenIds.has(assetId)
          ? "licensed_audio_asset_id_duplicate"
          : `${prefix}_asset_id_invalid`,
      );
    }
    seenIds.add(assetId);
    const role = text(asset?.role).toUpperCase();
    if (!ROLES.has(role)) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_role_invalid`,
      );
    }
    if (seenRoles.has(role)) {
      throw new GovernedLicensedAudioPackError(
        "licensed_audio_asset_role_duplicate",
      );
    }
    seenRoles.add(role);
    if (
      !/^epidemic-sound:\/\/[a-z0-9._/-]+$/i.test(
        text(asset?.provider_asset_reference),
      ) ||
      asset?.embedded_in_final !== true
    ) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_provider_reference_invalid`,
      );
    }
    const localAsset = resolveContainedFile({
      root,
      record: asset?.local_asset,
      prefix: `${prefix}_local_asset`,
      expectedSize: true,
    });
    if (!AUDIO_EXTENSIONS.has(path.extname(localAsset.path).toLowerCase())) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_local_asset_extension_invalid`,
      );
    }
    const comparableLocalPath = localAsset.relative_path.toLowerCase();
    const comparableLocalRealpath = fs
      .realpathSync.native(localAsset.path)
      .toLowerCase();
    const contentAlias = `${localAsset.sha256}:${localAsset.size_bytes}`;
    if (
      seenLocalPaths.has(comparableLocalPath) ||
      seenLocalRealpaths.has(comparableLocalRealpath) ||
      seenContentAliases.has(contentAlias)
    ) {
      throw new GovernedLicensedAudioPackError(
        "licensed_audio_asset_file_duplicate",
      );
    }
    seenLocalPaths.add(comparableLocalPath);
    seenLocalRealpaths.add(comparableLocalRealpath);
    seenContentAliases.add(contentAlias);
    const rightsEvidence = readContainedJson({
      root,
      record: asset?.rights_evidence,
      prefix: `${prefix}_rights_evidence`,
    });
    const comparableRightsEvidencePath =
      rightsEvidence.relative_path.toLowerCase();
    if (seenRightsEvidencePaths.has(comparableRightsEvidencePath)) {
      throw new GovernedLicensedAudioPackError(
        "licensed_audio_rights_evidence_duplicate",
      );
    }
    seenRightsEvidencePaths.add(comparableRightsEvidencePath);
    const evidence = rightsEvidence.value;
    const evidenceDestinations = upperSet(
      evidence?.allowed_destinations,
    );
    const evidenceRevenueModes = upperSet(
      evidence?.allowed_revenue_modes,
    );
    if (
      evidence?.schema_version !== RIGHTS_EVIDENCE_SCHEMA ||
      text(evidence?.story_id) !== storyId ||
      text(evidence?.asset_id) !== assetId ||
      text(evidence?.asset_sha256).toLowerCase() !==
        localAsset.sha256 ||
      Number(evidence?.asset_size_bytes) !== localAsset.size_bytes ||
      text(evidence?.provider_id).toLowerCase() !== PROVIDER_ID ||
      text(evidence?.provider_asset_reference) !==
        text(asset?.provider_asset_reference) ||
      text(evidence?.licence_basis) !== LICENCE_BASIS ||
      assertHttps(
        evidence?.licence_evidence_url,
        `${prefix}_rights_evidence_url_invalid`,
      ) !== licenceEvidenceUrl ||
      !setsEqual(evidenceDestinations, EXACT_DESTINATIONS) ||
      !setsEqual(evidenceRevenueModes, EXACT_REVENUE_MODES) ||
      evidence?.raw_redistribution_allowed !== false ||
      text(evidence?.approval_status) !== APPROVAL_STATUS ||
      text(evidence?.rights_verdict).toUpperCase() !== "GREEN" ||
      text(evidence?.safelist_evidence_sha256).toLowerCase() !==
        safelist.sha256 ||
      !text(evidence?.reviewed_by)
    ) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_rights_evidence_invalid`,
      );
    }
    assertTimestamp(
      evidence?.reviewed_at,
      boundaryMs,
      `${prefix}_rights_reviewed_at_invalid`,
    );
    assertReviewWindow({
      reviewedAt: evidence?.reviewed_at,
      reviewDueAt: evidence?.review_due_at,
      boundaryMs,
      prefix: `${prefix}_rights`,
    });
    const matchingRecords = ledgerRecords.filter(
      (record) => text(record?.asset_id) === assetId,
    );
    if (matchingRecords.length !== 1) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_rights_record_not_unique`,
      );
    }
    const rightsRecord = matchingRecords[0];
    const rightsRecordFingerprint =
      fingerprintRightsRecord(rightsRecord);
    if (
      seenRightsRecordFingerprints.has(rightsRecordFingerprint)
    ) {
      throw new GovernedLicensedAudioPackError(
        "licensed_audio_rights_record_duplicate",
      );
    }
    seenRightsRecordFingerprints.add(rightsRecordFingerprint);
    if (
      rightsRecordFingerprint !==
        cleanHash(
          asset?.rights_record_sha256,
          `${prefix}_rights_record_sha256_invalid`,
        ) ||
      text(rightsRecord?.provider_id).toLowerCase() !== PROVIDER_ID ||
      text(rightsRecord?.provider_asset_reference) !==
        text(asset?.provider_asset_reference) ||
      text(rightsRecord?.asset_type) !==
        ROLE_LEDGER_CONTRACT[role].asset_type ||
      text(rightsRecord?.role) !==
        ROLE_LEDGER_CONTRACT[role].role ||
      text(rightsRecord?.local_asset_path).replace(/\\/g, "/") !==
        text(asset?.local_asset?.path).replace(/\\/g, "/") ||
      text(rightsRecord?.licence_basis) !== LICENCE_BASIS ||
      text(rightsRecord?.asset_sha256).toLowerCase() !==
        localAsset.sha256 ||
      Number(rightsRecord?.asset_size_bytes) !== localAsset.size_bytes ||
      text(rightsRecord?.rights_evidence_sha256).toLowerCase() !==
        rightsEvidence.sha256 ||
      text(rightsRecord?.safelist_evidence_sha256).toLowerCase() !==
        safelist.sha256 ||
      rightsRecord?.commercial_use_allowed !== true ||
      rightsRecord?.raw_redistribution_allowed !== false ||
      text(rightsRecord?.approval_status) !== APPROVAL_STATUS ||
      text(rightsRecord?.rights_verdict).toUpperCase() !== "GREEN" ||
      rightsRecord?.live_publish_allowed !== true ||
      rightsRecord?.requires_human_legal_review_before_publish !== false ||
      !setsEqual(
        lowerSet(rightsRecord?.allowed_platforms),
        lowerSet([...EXACT_DESTINATIONS]),
      ) ||
      !setsEqual(
        lowerSet(rightsRecord?.allowed_revenue_modes),
        lowerSet([...EXACT_REVENUE_MODES]),
      ) ||
      !recordMatchesScope({
        record: rightsRecord,
        requiredDestination: destination,
        requiredRevenueMode: revenueMode,
      })
    ) {
      throw new GovernedLicensedAudioPackError(
        `${prefix}_rights_record_invalid`,
      );
    }
    return {
      asset_id: assetId,
      role,
      provider_id: PROVIDER_ID,
      provider_asset_reference:
        text(asset.provider_asset_reference),
      path: localAsset.path,
      relative_path: localAsset.relative_path,
      sha256: localAsset.sha256,
      size_bytes: localAsset.size_bytes,
      rights_record_sha256:
        rightsRecordFingerprint,
      rights_evidence_path: rightsEvidence.path,
      rights_evidence_sha256: rightsEvidence.sha256,
      embedded_in_final: true,
    };
  });
  const selectedLedgerAssetIds = ledgerRecords.map((record) =>
    text(record?.asset_id),
  );
  if (
    selectedLedgerAssetIds.some((assetId) => !assetId) ||
    new Set(selectedLedgerAssetIds).size !==
      selectedLedgerAssetIds.length ||
    !setsEqual(
      new Set(selectedLedgerAssetIds),
      new Set(validatedAssets.map((asset) => asset.asset_id)),
    )
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_rights_ledger_asset_coverage_mismatch",
    );
  }

  const roleAssets = (role) =>
    validatedAssets.filter((asset) => asset.role === role);
  const bedAssets = roleAssets("MUSIC_BED");
  const stingAssets = roleAssets("MUSIC_STING");
  const sfxAssets = validatedAssets.filter((asset) =>
    asset.role.startsWith("SFX_"),
  );
  if (
    bedAssets.length !== 1 ||
    stingAssets.length !== 1 ||
    sfxAssets.length < 1
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_required_role_coverage_invalid",
    );
  }

  const mix = value?.mix;
  if (
    !mix ||
    text(mix.policy_version) !== MIX_POLICY
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_policy_invalid",
    );
  }
  if (mix.narration_included !== false) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_narration_forbidden",
    );
  }
  const targetDurationSeconds = assertNumberInRange(
    mix.target_duration_seconds,
    {
      minimum: 0,
      maximum: MAX_SHORT_DURATION_SECONDS,
      exclusiveMinimum: true,
    },
    "licensed_audio_mix_target_duration_invalid",
  );
  if (
    Math.abs(targetDurationSeconds - expectedDuration) > 0.001
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_target_duration_mismatch",
    );
  }
  const bed = mix.bed;
  if (
    !bed ||
    text(bed.asset_id) !== bedAssets[0].asset_id
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_bed_asset_invalid",
    );
  }
  const normalizedBed = {
    asset_id: bedAssets[0].asset_id,
    raw_volume: assertNumberInRange(
      bed.raw_volume,
      { minimum: 0, maximum: 0.2, exclusiveMinimum: true },
      "licensed_audio_mix_bed_volume_invalid",
    ),
    ducked_output_volume: assertNumberInRange(
      bed.ducked_output_volume,
      { minimum: 0, maximum: 0.4, exclusiveMinimum: true },
      "licensed_audio_mix_bed_ducked_volume_invalid",
    ),
    trim_start_seconds: assertNumberInRange(
      bed.trim_start_seconds,
      { minimum: 0, maximum: targetDurationSeconds },
      "licensed_audio_mix_bed_trim_invalid",
    ),
    fade_in_seconds: assertNumberInRange(
      bed.fade_in_seconds,
      { minimum: 0, maximum: targetDurationSeconds },
      "licensed_audio_mix_bed_fade_invalid",
    ),
    fade_out_seconds: assertNumberInRange(
      bed.fade_out_seconds,
      { minimum: 0, maximum: targetDurationSeconds },
      "licensed_audio_mix_bed_fade_invalid",
    ),
    sidechain: {
      threshold: assertNumberInRange(
        bed.sidechain?.threshold,
        { minimum: 0, maximum: 1, exclusiveMinimum: true },
        "licensed_audio_mix_sidechain_invalid",
      ),
      ratio: assertNumberInRange(
        bed.sidechain?.ratio,
        { minimum: 1, maximum: 20 },
        "licensed_audio_mix_sidechain_invalid",
      ),
      attack_ms: assertNumberInRange(
        bed.sidechain?.attack_ms,
        { minimum: 0, maximum: 1_000 },
        "licensed_audio_mix_sidechain_invalid",
      ),
      release_ms: assertNumberInRange(
        bed.sidechain?.release_ms,
        { minimum: 0, maximum: 5_000 },
        "licensed_audio_mix_sidechain_invalid",
      ),
    },
  };
  if (
    normalizedBed.fade_in_seconds +
      normalizedBed.fade_out_seconds >
    targetDurationSeconds
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_bed_fade_invalid",
    );
  }

  const microDropWindows = Array.isArray(
    mix.micro_drop_windows,
  )
    ? mix.micro_drop_windows
    : [];
  if (microDropWindows.length > 4) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_micro_drop_count_invalid",
    );
  }
  let previousDropEnd = 0;
  let totalDropDuration = 0;
  const normalizedMicroDropWindows = microDropWindows.map(
    (window, index) => {
      const startSeconds = assertNumberInRange(
        window?.start_seconds,
        { minimum: 0, maximum: targetDurationSeconds },
        `licensed_audio_mix_micro_drop_${index}_invalid`,
      );
      const endSeconds = assertNumberInRange(
        window?.end_seconds,
        { minimum: 0, maximum: targetDurationSeconds },
        `licensed_audio_mix_micro_drop_${index}_invalid`,
      );
      const multiplier = assertNumberInRange(
        window?.multiplier,
        {
          minimum: 0.1,
          maximum: 1,
        },
        `licensed_audio_mix_micro_drop_${index}_invalid`,
      );
      if (
        endSeconds <= startSeconds ||
        startSeconds < previousDropEnd ||
        endSeconds - startSeconds > 0.5
      ) {
        throw new GovernedLicensedAudioPackError(
          `licensed_audio_mix_micro_drop_${index}_invalid`,
        );
      }
      previousDropEnd = endSeconds;
      totalDropDuration += endSeconds - startSeconds;
      return {
        start_seconds: startSeconds,
        end_seconds: endSeconds,
        multiplier,
      };
    },
  );
  if (totalDropDuration > 1.5) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_micro_drop_coverage_invalid",
    );
  }

  const expectedCueAssetIds = new Set(
    validatedAssets
      .filter((asset) => asset.role !== "MUSIC_BED")
      .map((asset) => asset.asset_id),
  );
  const cues = Array.isArray(mix.cues) ? mix.cues : [];
  const seenCueAssetIds = new Set();
  const normalizedCues = cues.map((cue, index) => {
    const assetId = text(cue?.asset_id);
    if (
      !expectedCueAssetIds.has(assetId) ||
      seenCueAssetIds.has(assetId)
    ) {
      throw new GovernedLicensedAudioPackError(
        `licensed_audio_mix_cue_${index}_asset_invalid`,
      );
    }
    seenCueAssetIds.add(assetId);
    const atSeconds = assertNumberInRange(
      cue.at_seconds,
      { minimum: 0, maximum: targetDurationSeconds },
      `licensed_audio_mix_cue_${index}_timing_invalid`,
    );
    const durationSeconds = assertNumberInRange(
      cue.duration_seconds,
      { minimum: 0, maximum: targetDurationSeconds, exclusiveMinimum: true },
      `licensed_audio_mix_cue_${index}_timing_invalid`,
    );
    const trimStartSeconds = assertNumberInRange(
      cue.trim_start_seconds,
      { minimum: 0, maximum: targetDurationSeconds },
      `licensed_audio_mix_cue_${index}_timing_invalid`,
    );
    const fadeInSeconds = assertNumberInRange(
      cue.fade_in_seconds,
      { minimum: 0, maximum: durationSeconds },
      `licensed_audio_mix_cue_${index}_fade_invalid`,
    );
    const fadeOutSeconds = assertNumberInRange(
      cue.fade_out_seconds,
      { minimum: 0, maximum: durationSeconds },
      `licensed_audio_mix_cue_${index}_fade_invalid`,
    );
    if (
      atSeconds + durationSeconds >
        targetDurationSeconds + Number.EPSILON ||
      fadeInSeconds + fadeOutSeconds > durationSeconds
    ) {
      throw new GovernedLicensedAudioPackError(
        `licensed_audio_mix_cue_${index}_timing_invalid`,
      );
    }
    return {
      asset_id: assetId,
      at_seconds: atSeconds,
      volume: assertNumberInRange(
        cue.volume,
        {
          minimum: 0,
          maximum: 0.15,
          exclusiveMinimum: true,
        },
        `licensed_audio_mix_cue_${index}_volume_invalid`,
      ),
      trim_start_seconds: trimStartSeconds,
      duration_seconds: durationSeconds,
      fade_in_seconds: fadeInSeconds,
      fade_out_seconds: fadeOutSeconds,
    };
  });
  if (
    cues.length !== expectedCueAssetIds.size ||
    seenCueAssetIds.size !== expectedCueAssetIds.size
  ) {
    throw new GovernedLicensedAudioPackError(
      "licensed_audio_mix_cue_coverage_invalid",
    );
  }

  return {
    schema_version:
      "pulse-governed-licensed-audio-pack-validation-v1",
    validation_status: "PASS",
    policy: POLICY,
    story_id: storyId,
    channel_id: channelId,
    manifest_path: manifest.path,
    manifest_sha256: manifest.sha256,
    candidate_manifest: {
      path: candidate.path,
      sha256: candidate.sha256,
    },
    rights_ledger: {
      path: ledger.path,
      sha256: ledger.sha256,
    },
    provider: {
      id: PROVIDER_ID,
      licence_basis: LICENCE_BASIS,
      licence_evidence_url: licenceEvidenceUrl,
      safelist_evidence_path: safelist.path,
      safelist_evidence_sha256: safelist.sha256,
      safelist_review: safelistReview,
    },
    scope: {
      destinations: [...destinations].sort(),
      revenue_modes: [...revenueModes].sort(),
      prohibited_without_new_review: [...prohibited].sort(),
    },
    render_binding: {
      narration_sha256: expectedNarrationHash,
      timestamps_sha256: expectedTimestampsHash,
      target_duration_seconds: expectedDuration,
    },
    assets: validatedAssets,
    mix: {
      policy_version: MIX_POLICY,
      narration_included: false,
      target_duration_seconds: targetDurationSeconds,
      bed: normalizedBed,
      micro_drop_windows: normalizedMicroDropWindows,
      cues: normalizedCues,
    },
    publish_authorised: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    network_used: false,
  };
}

module.exports = {
  APPROVAL_STATUS,
  GovernedLicensedAudioPackError,
  LICENCE_BASIS,
  MANIFEST_SCHEMA,
  MIX_POLICY,
  POLICY,
  PROVIDER_ID,
  RIGHTS_EVIDENCE_SCHEMA,
  fingerprintRightsRecord,
  validateGovernedLicensedAudioPack,
};
