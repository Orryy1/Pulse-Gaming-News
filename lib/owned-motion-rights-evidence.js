"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("fs-extra");

const SCHEMA = "pulse_owned_asset_rights_evidence_v1";
const PRODUCER = "pulse_owned_motion_rights_evidence_materializer_v1";
const OWNERSHIP_BASIS = "wholly_owned_generated_asset";
const SOURCE_OWNER = "Pulse Gaming";
const PROVENANCE_ORIGIN = "pulse_gaming_internal_generation";

const ALLOWED_PLATFORMS = new Set([
  "youtube_shorts",
  "tiktok",
  "instagram_reels",
  "facebook_reels",
  "x",
  "threads",
  "pinterest",
]);

const ASSET_KIND_POLICIES = Object.freeze({
  procedural_clip: Object.freeze({
    scheduler_kind: "motion",
    licence_basis: "owned_generated_editorial_motion_graphic",
    source_type: "internally_generated_procedural_motion",
    creation_method: "procedural_generation",
  }),
  narration: Object.freeze({
    scheduler_kind: "narration",
    licence_basis: "owned_generated_narration_audio",
    source_type: "internally_generated_narration",
    creation_method: "owned_voice_synthesis",
  }),
  sfx: Object.freeze({
    scheduler_kind: "sfx",
    licence_basis: "owned_generated_utility_sfx",
    source_type: "internally_generated_procedural_sfx",
    creation_method: "procedural_audio_generation",
  }),
  platform_variant: Object.freeze({
    scheduler_kind: "platform_native",
    licence_basis: "owned_generated_platform_variant",
    source_type: "internally_generated_platform_variant",
    creation_method: "owned_asset_transcode",
  }),
});

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values) {
  return [...new Set(values)];
}

function canonicalPlatforms(value) {
  if (!Array.isArray(value) || value.some((platform) => typeof platform !== "string")) {
    return [];
  }
  return value.map(clean).filter(Boolean);
}

function samePlatformSet(left, right) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validIsoTimestamp(value) {
  const text = clean(value);
  if (!text) return false;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === text;
}

function normaliseSha256(value) {
  return clean(value).replace(/^sha256:/i, "").toLowerCase();
}

function assetPathFor(record) {
  return clean(record.path || record.local_materialized_path || record.asset_path);
}

function evidencePathFor(record) {
  return clean(
    record.evidence_file ||
      record.evidence_path ||
      record.rights_evidence_path,
  );
}

function validatePlatforms(value, prefix = "") {
  const blockers = [];
  if (!Array.isArray(value) || value.some((platform) => typeof platform !== "string")) {
    return [`${prefix}allowed_platforms_invalid`];
  }
  const platforms = value.map(clean);
  if (!platforms.length || platforms.some((platform) => !platform)) {
    blockers.push(`${prefix}allowed_platforms_missing`);
  }
  for (const platform of platforms) {
    if (platform && !ALLOWED_PLATFORMS.has(platform)) {
      blockers.push(`${prefix}allowed_platform_invalid:${platform}`);
    }
  }
  if (unique(platforms).length !== platforms.length) {
    blockers.push(`${prefix}allowed_platforms_duplicate`);
  }
  return blockers;
}

function validateProvenance(provenance, policy, prefix = "") {
  const blockers = [];
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) {
    return [`${prefix}provenance_missing`];
  }
  if (clean(provenance.origin) !== PROVENANCE_ORIGIN) {
    blockers.push(`${prefix}provenance_origin_not_owned_generated`);
  }
  if (!clean(provenance.generator_name)) {
    blockers.push(`${prefix}provenance_generator_name_missing`);
  }
  if (!clean(provenance.generator_version)) {
    blockers.push(`${prefix}provenance_generator_version_missing`);
  }
  if (!validIsoTimestamp(provenance.generated_at)) {
    blockers.push(`${prefix}provenance_generated_at_invalid`);
  }
  if (clean(provenance.creation_method) !== policy.creation_method) {
    blockers.push(`${prefix}provenance_creation_method_invalid`);
  }
  if (provenance.third_party_inputs !== false) {
    blockers.push(`${prefix}third_party_inputs_present`);
  }
  if (
    !Array.isArray(provenance.third_party_sources) ||
    provenance.third_party_sources.length !== 0
  ) {
    blockers.push(`${prefix}third_party_sources_present`);
  }
  return blockers;
}

function validateOwnedDeclaration(value, prefix = "") {
  const blockers = [];
  const assetId = clean(value.asset_id);
  const assetKind = clean(value.asset_kind);
  const policy = ASSET_KIND_POLICIES[assetKind];
  if (!assetId) blockers.push(`${prefix}asset_id_missing`);
  if (!policy) {
    blockers.push(`${prefix}asset_kind_unsupported`);
    return blockers;
  }
  if (value.kind !== undefined && clean(value.kind) !== policy.scheduler_kind) {
    blockers.push(`${prefix}scheduler_kind_mismatch`);
  }
  if (clean(value.ownership_basis) !== OWNERSHIP_BASIS) {
    blockers.push(`${prefix}ownership_basis_not_wholly_owned`);
  }
  if (clean(value.licence_basis) !== policy.licence_basis) {
    blockers.push(`${prefix}licence_basis_not_owned_generated`);
  }
  if (!clean(value.allowed_use)) {
    blockers.push(`${prefix}allowed_use_missing`);
  }
  if (
    value.rights_basis !== undefined &&
    clean(value.rights_basis) !== policy.licence_basis
  ) {
    blockers.push(`${prefix}rights_basis_not_owned_generated`);
  }
  if (value.rights_grant !== true) {
    blockers.push(`${prefix}rights_grant_not_explicitly_true`);
  }
  if (value.commercial_use_allowed !== true) {
    blockers.push(`${prefix}commercial_use_not_explicitly_allowed`);
  }
  blockers.push(...validatePlatforms(value.allowed_platforms, prefix));
  if (clean(value.source_owner) !== SOURCE_OWNER) {
    blockers.push(`${prefix}source_owner_not_pulse_gaming`);
  }
  if (clean(value.source_type) !== policy.source_type) {
    blockers.push(`${prefix}source_type_not_owned_generated`);
  }
  const sourceUrl = clean(value.source_url);
  if (!sourceUrl.startsWith("local://pulse-owned/")) {
    blockers.push(`${prefix}source_url_not_owned_local`);
  }
  blockers.push(...validateProvenance(value.provenance, policy, prefix));
  return blockers;
}

async function fingerprintFile(filePath, label) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { blockers: [`${label}_file_missing`] };
    }
    return { blockers: [`${label}_file_unreadable`] };
  }
  if (!stat.isFile()) return { blockers: [`${label}_not_file`] };
  if (stat.size <= 0) return { blockers: [`${label}_file_empty`] };

  const hash = crypto.createHash("sha256");
  try {
    for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  } catch {
    return { blockers: [`${label}_file_unreadable`] };
  }
  return {
    blockers: [],
    sha256: hash.digest("hex"),
    size_bytes: stat.size,
  };
}

function throwFirst(blockers) {
  if (blockers.length) throw new Error(blockers[0]);
}

function materializerDeclaration(options) {
  return {
    asset_id: clean(options.asset_id),
    asset_kind: clean(options.asset_kind),
    ownership_basis: clean(options.ownership_basis),
    licence_basis: clean(options.licence_basis),
    allowed_use: clean(options.allowed_use),
    rights_grant: options.rights_grant,
    commercial_use_allowed: options.commercial_use_allowed,
    allowed_platforms: Array.isArray(options.allowed_platforms)
      ? [...options.allowed_platforms]
      : options.allowed_platforms,
    source_owner: clean(options.source_owner),
    source_type: clean(options.source_type),
    source_url: clean(options.source_url),
    provenance: options.provenance,
  };
}

async function atomicWriteJson(filePath, value) {
  await fs.ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeJson(temporaryPath, value, { spaces: 2 });
    await fs.move(temporaryPath, filePath, { overwrite: true });
  } finally {
    await fs.remove(temporaryPath);
  }
}

async function materializeOwnedMotionRightsEvidence(options = {}) {
  const declaration = materializerDeclaration(options);
  throwFirst(validateOwnedDeclaration(declaration));

  const assetPathValue = clean(options.asset_path || options.path || options.local_materialized_path);
  if (!assetPathValue) throw new Error("asset_path_missing");
  const evidencePathValue = clean(
    options.evidence_path ||
      options.evidence_file ||
      options.rights_evidence_path,
  );
  if (!evidencePathValue) throw new Error("evidence_path_missing");
  const assetPath = path.resolve(assetPathValue);
  const evidencePath = path.resolve(evidencePathValue);
  if (assetPath === evidencePath) throw new Error("evidence_path_must_be_independent");

  const assetFingerprint = await fingerprintFile(assetPath, "asset");
  throwFirst(assetFingerprint.blockers);

  const policy = ASSET_KIND_POLICIES[declaration.asset_kind];
  const sidecar = {
    schema: SCHEMA,
    schema_version: 1,
    producer: PRODUCER,
    asset_id: declaration.asset_id,
    asset_kind: declaration.asset_kind,
    kind: policy.scheduler_kind,
    asset_path: assetPath,
    asset_sha256: assetFingerprint.sha256,
    asset_size_bytes: assetFingerprint.size_bytes,
    ownership_basis: OWNERSHIP_BASIS,
    licence_basis: policy.licence_basis,
    rights_basis: policy.licence_basis,
    allowed_use: declaration.allowed_use,
    rights_grant: true,
    commercial_use_allowed: true,
    allowed_platforms: [...declaration.allowed_platforms],
    source_owner: SOURCE_OWNER,
    source_type: policy.source_type,
    source_url: declaration.source_url,
    provenance: JSON.parse(JSON.stringify(declaration.provenance)),
  };
  await atomicWriteJson(evidencePath, sidecar);
  const evidenceFingerprint = await fingerprintFile(evidencePath, "evidence");
  throwFirst(evidenceFingerprint.blockers);

  const record = {
    asset_id: declaration.asset_id,
    asset_kind: declaration.asset_kind,
    kind: policy.scheduler_kind,
    ...(clean(options.platform) ? { platform: clean(options.platform) } : {}),
    path: assetPath,
    local_materialized_path: assetPath,
    asset_sha256: assetFingerprint.sha256,
    asset_size_bytes: assetFingerprint.size_bytes,
    ownership_basis: OWNERSHIP_BASIS,
    licence_basis: policy.licence_basis,
    rights_basis: policy.licence_basis,
    allowed_use: declaration.allowed_use,
    rights_grant: true,
    commercial_use_allowed: true,
    allowed_platforms: [...declaration.allowed_platforms],
    source_owner: SOURCE_OWNER,
    source_type: policy.source_type,
    source_url: declaration.source_url,
    provenance: JSON.parse(JSON.stringify(declaration.provenance)),
    evidence_file: evidencePath,
    evidence_path: evidencePath,
    rights_evidence_path: evidencePath,
    evidence_sha256: evidenceFingerprint.sha256,
    rights_evidence_sha256: evidenceFingerprint.sha256,
    evidence_size_bytes: evidenceFingerprint.size_bytes,
    rights_status: "explicit_owned_generated_asset",
    approval_status: "approved_owned_generated_commercial_use",
  };
  const evaluation = await evaluateOwnedMotionRightsEvidence({
    record,
    required_platforms: declaration.allowed_platforms,
  });
  if (evaluation.status !== "pass") {
    throw new Error(`materialized_evidence_failed_evaluation:${evaluation.blockers[0]}`);
  }
  return {
    status: "materialized",
    record,
    evidence: sidecar,
    evaluation,
  };
}

function barePassFlags(record) {
  const passValues = [
    record.status,
    record.verdict,
    record.result,
    record.rights_verdict,
    record.approval_status,
  ]
    .map((value) => clean(value).toLowerCase())
    .filter(Boolean);
  const claimsPass = passValues.some((value) =>
    /^(?:pass|passed|approved|green|clear)$/.test(value),
  );
  if (!claimsPass && record.rights_grant !== true && record.commercial_use_allowed !== true) {
    return false;
  }
  return !(
    assetPathFor(record) &&
    evidencePathFor(record) &&
    clean(record.licence_basis) &&
    canonicalPlatforms(record.allowed_platforms).length &&
    record.provenance &&
    typeof record.provenance === "object"
  );
}

function compareEvidenceBinding(sidecar, record, assetFingerprint) {
  const blockers = [];
  if (sidecar.schema !== SCHEMA || sidecar.schema_version !== 1) {
    blockers.push("evidence_schema_invalid");
  }
  if (sidecar.producer !== PRODUCER) blockers.push("evidence_producer_invalid");
  if (clean(sidecar.asset_id) !== clean(record.asset_id)) {
    blockers.push("evidence_asset_id_mismatch");
  }
  if (clean(sidecar.asset_kind) !== clean(record.asset_kind)) {
    blockers.push("evidence_asset_kind_mismatch");
  }
  if (clean(sidecar.kind) !== clean(record.kind)) {
    blockers.push("evidence_scheduler_kind_mismatch");
  }
  if (path.resolve(clean(sidecar.asset_path) || ".") !== path.resolve(assetPathFor(record) || ".")) {
    blockers.push("evidence_asset_path_mismatch");
  }
  if (
    normaliseSha256(sidecar.asset_sha256) !== assetFingerprint.sha256 ||
    normaliseSha256(sidecar.asset_sha256) !== normaliseSha256(record.asset_sha256)
  ) {
    blockers.push("evidence_asset_sha256_mismatch");
  }
  if (
    Number(sidecar.asset_size_bytes) !== assetFingerprint.size_bytes ||
    Number(sidecar.asset_size_bytes) !== Number(record.asset_size_bytes)
  ) {
    blockers.push("evidence_asset_size_mismatch");
  }
  for (const field of [
    "ownership_basis",
    "licence_basis",
    "rights_basis",
    "allowed_use",
    "source_owner",
    "source_type",
    "source_url",
  ]) {
    if (clean(sidecar[field]) !== clean(record[field])) {
      blockers.push(`evidence_${field}_mismatch`);
    }
  }
  if (sidecar.rights_grant !== record.rights_grant) {
    blockers.push("evidence_rights_grant_mismatch");
  }
  if (sidecar.commercial_use_allowed !== record.commercial_use_allowed) {
    blockers.push("evidence_commercial_use_mismatch");
  }
  if (
    !samePlatformSet(
      canonicalPlatforms(sidecar.allowed_platforms),
      canonicalPlatforms(record.allowed_platforms),
    )
  ) {
    blockers.push("evidence_allowed_platforms_mismatch");
  }
  if (canonicalJson(sidecar.provenance) !== canonicalJson(record.provenance)) {
    blockers.push("evidence_provenance_mismatch");
  }
  return blockers;
}

async function evaluateOwnedMotionRightsEvidence({
  record = {},
  required_platforms: requiredPlatforms,
} = {}) {
  const blockers = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      status: "fail",
      verified: false,
      blockers: ["rights_record_missing"],
    };
  }
  if (barePassFlags(record)) blockers.push("bare_pass_flags_rejected");
  blockers.push(...validateOwnedDeclaration(record));

  const assetPathValue = assetPathFor(record);
  const evidencePathValue = evidencePathFor(record);
  if (!assetPathValue) blockers.push("asset_path_missing");
  if (!evidencePathValue) blockers.push("evidence_path_missing");
  if (
    assetPathValue &&
    evidencePathValue &&
    path.resolve(assetPathValue) === path.resolve(evidencePathValue)
  ) {
    blockers.push("evidence_path_must_be_independent");
  }

  const recordPlatforms = canonicalPlatforms(record.allowed_platforms);
  if (requiredPlatforms !== undefined) {
    const requiredBlockers = validatePlatforms(requiredPlatforms, "required_");
    blockers.push(...requiredBlockers);
    if (
      requiredBlockers.length === 0 &&
      !samePlatformSet(recordPlatforms, canonicalPlatforms(requiredPlatforms))
    ) {
      blockers.push("required_platforms_exact_mismatch");
    }
  }

  let assetFingerprint = null;
  if (assetPathValue) {
    const inspected = await fingerprintFile(path.resolve(assetPathValue), "asset");
    blockers.push(...inspected.blockers);
    if (!inspected.blockers.length) {
      assetFingerprint = inspected;
      const expectedHash = normaliseSha256(record.asset_sha256);
      const expectedSize = Number(record.asset_size_bytes);
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) blockers.push("asset_sha256_missing");
      else if (expectedHash !== inspected.sha256) blockers.push("asset_sha256_mismatch");
      if (!Number.isFinite(expectedSize) || expectedSize <= 0) blockers.push("asset_size_missing");
      else if (expectedSize !== inspected.size_bytes) blockers.push("asset_size_mismatch");
    }
  }

  let evidenceFingerprint = null;
  let sidecar = null;
  if (evidencePathValue) {
    const inspected = await fingerprintFile(path.resolve(evidencePathValue), "evidence");
    blockers.push(...inspected.blockers);
    if (!inspected.blockers.length) {
      evidenceFingerprint = inspected;
      const expectedHash = normaliseSha256(
        record.evidence_sha256 || record.rights_evidence_sha256,
      );
      const expectedSize = Number(record.evidence_size_bytes);
      if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        blockers.push("evidence_sha256_missing");
      } else if (expectedHash !== inspected.sha256) {
        blockers.push("evidence_sha256_mismatch");
      }
      if (!Number.isFinite(expectedSize) || expectedSize <= 0) {
        blockers.push("evidence_size_missing");
      } else if (expectedSize !== inspected.size_bytes) {
        blockers.push("evidence_size_mismatch");
      }
      try {
        sidecar = await fs.readJson(path.resolve(evidencePathValue));
      } catch {
        blockers.push("evidence_json_unreadable");
      }
    }
  }

  if (sidecar && assetFingerprint) {
    blockers.push(...validateOwnedDeclaration(sidecar, "evidence_"));
    blockers.push(...compareEvidenceBinding(sidecar, record, assetFingerprint));
  }

  const uniqueBlockers = unique(blockers);
  return {
    status: uniqueBlockers.length ? "fail" : "pass",
    verified: uniqueBlockers.length === 0,
    blockers: uniqueBlockers,
    evidence: {
      asset_path: assetPathValue ? path.resolve(assetPathValue) : null,
      asset_sha256: assetFingerprint?.sha256 || null,
      asset_size_bytes: assetFingerprint?.size_bytes || null,
      evidence_path: evidencePathValue ? path.resolve(evidencePathValue) : null,
      evidence_sha256: evidenceFingerprint?.sha256 || null,
      evidence_size_bytes: evidenceFingerprint?.size_bytes || null,
      exact_allowed_platforms: recordPlatforms,
      provenance_verified:
        Boolean(sidecar) &&
        canonicalJson(sidecar.provenance) === canonicalJson(record.provenance),
    },
  };
}

module.exports = {
  ALLOWED_PLATFORMS,
  ASSET_KIND_POLICIES,
  OWNERSHIP_BASIS,
  PRODUCER,
  SCHEMA,
  evaluateOwnedMotionRightsEvidence,
  materializeOwnedMotionRightsEvidence,
};
