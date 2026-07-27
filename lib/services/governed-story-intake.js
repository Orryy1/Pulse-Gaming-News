"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  verifyBackupEvidence,
  withReadOnlySqliteSnapshot,
} = require("../ops/stabilisation-cutover-reconcile");
const {
  resolvePulseScriptContract,
} = require("./pulse-editorial-contract");
const {
  ATTRIBUTION_TEXT,
  CANONICAL_LICENCE_URL,
  LICENCE_EFFECTIVE_DATE,
  PUBLISHER,
  GovernedSourceMediaError,
  validateGovernedSourceMediaManifest,
} = require("./governed-source-media");
const { countSpokenWords } = require("./short-runtime-planner");
const { canonicalHash, canonicalUrl } = require("./url-canonical");

const INTAKE_SCHEMA_VERSION = "pulse-governed-story-intake-v1";
const SOURCE_EVIDENCE_SCHEMA_VERSION = "pulse-source-evidence-v1";
const OWNED_ASSET_SCHEMA_VERSION = "pulse-owned-motion-manifest-v1";
const RESULT_SCHEMA_VERSION = "pulse-governed-story-intake-result-v1";
const REQUIRED_CONTRACT = Object.freeze({
  editorial_lane_id: "what_changes_for_players",
  hook_type: "direct",
  duration_band_id: "what_changes_short_25_32",
});
const SCRIPT_MIN_WORDS = 37;
const SCRIPT_MAX_WORDS = 47;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const GOVERNED_HYBRID_ROLE = "hyperframes_intermediate";
const GOVERNED_OWNED_BACKBONE_ROLE = "owned_motion_backbone";
const GOVERNED_HYBRID_SOURCE = "hyperframes_material_stage";
const GOVERNED_HYBRID_SOURCE_MEDIA_POLICY =
  "LICENSED_OFFICIAL_FFXIV";
const GOVERNED_HYBRID_VISUAL_FORMAT =
  "hybrid-official-media-and-owned-motion";
const HYPERFRAMES_GENERATOR_PATTERN =
  /^hyperframes@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const JSON_STORY_FIELDS = new Set([
  "title_variants",
  "game_images",
  "downloaded_images",
  "video_clips",
]);
const ACTIONS = new Set(["ingest", "approve-script", "attach-owned-assets"]);

class GovernedStoryIntakeError extends Error {
  constructor(codes, message = "governed_story_intake_validation_failed") {
    const normalisedCodes = unique(Array.isArray(codes) ? codes : [codes]);
    super(`${message}: ${normalisedCodes.join(", ")}`);
    this.name = "GovernedStoryIntakeError";
    this.codes = normalisedCodes;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stableJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function canonicalFilePath(filePath) {
  const resolvedPath = path.resolve(String(filePath || ""));
  try {
    return fs.realpathSync.native(resolvedPath);
  } catch {
    return resolvedPath;
  }
}

function normaliseScript(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function scriptSha256(value) {
  return sha256Bytes(normaliseScript(value));
}

function readJsonFile(filePath, missingCode, invalidCode) {
  const resolved = path.resolve(String(filePath || ""));
  if (!filePath || !fs.existsSync(resolved)) {
    throw new GovernedStoryIntakeError(missingCode);
  }
  try {
    return {
      path: resolved,
      bytes: fs.readFileSync(resolved),
      value: JSON.parse(fs.readFileSync(resolved, "utf8")),
    };
  } catch (error) {
    if (error instanceof GovernedStoryIntakeError) throw error;
    throw new GovernedStoryIntakeError(invalidCode);
  }
}

function validTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function validClaims(value) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((claim) => typeof claim === "string" && claim.trim())
  );
}

function validateStoryIntakeManifest({ manifestPath } = {}) {
  const manifestFile = readJsonFile(
    manifestPath,
    "story_intake_manifest_file_required",
    "story_intake_manifest_invalid_json",
  );
  const manifest = manifestFile.value;
  const errors = [];

  if (manifest?.schema_version !== INTAKE_SCHEMA_VERSION) {
    errors.push("story_intake_manifest_schema_invalid");
  }
  const sourceUrl = String(manifest?.source_url || "").trim();
  if (!canonicalUrl(sourceUrl)) errors.push("official_source_url_required");
  if (manifest?.source_type !== "official") {
    errors.push("official_source_type_required");
  }
  if (!validTimestamp(manifest?.published_at)) {
    errors.push("source_published_timestamp_required");
  }
  if (!validClaims(manifest?.claims)) errors.push("source_claims_required");

  const canonicalSourceHash = canonicalHash(sourceUrl);
  const storyId =
    canonicalSourceHash === "invalid-url"
      ? null
      : `official_${canonicalSourceHash}`;
  if (manifest?.story?.id && manifest.story.id !== storyId) {
    errors.push("deterministic_story_id_mismatch");
  }
  if (!storyId) errors.push("deterministic_story_id_required");
  if (!String(manifest?.story?.title || "").trim()) {
    errors.push("story_title_required");
  }

  const script = normaliseScript(manifest?.story?.full_script);
  const computedScriptSha = scriptSha256(script);
  const declaredScriptSha = String(
    manifest?.story?.script_sha256 || "",
  ).toLowerCase();
  const wordCount = countSpokenWords(script);
  if (!script) errors.push("final_script_required");
  if (!SHA256_PATTERN.test(declaredScriptSha)) {
    errors.push("script_sha256_required");
  } else if (declaredScriptSha !== computedScriptSha) {
    errors.push("script_sha256_mismatch");
  }
  if (wordCount < SCRIPT_MIN_WORDS || wordCount > SCRIPT_MAX_WORDS) {
    errors.push("script_word_count_out_of_range");
  }

  const contract = manifest?.contract;
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    errors.push("script_contract_required");
  } else {
    for (const [key, expected] of Object.entries(REQUIRED_CONTRACT)) {
      if (contract[key] !== expected) {
        errors.push(`${key}_contract_mismatch`);
      }
    }
    try {
      const resolved = resolvePulseScriptContract({
        story: {
          id: storyId,
          ...contract,
        },
        laneId: contract.editorial_lane_id,
        durationBandId: contract.duration_band_id,
      });
      if (
        resolved.editorial_lane_id !== REQUIRED_CONTRACT.editorial_lane_id ||
        resolved.hook_type !== REQUIRED_CONTRACT.hook_type ||
        resolved.duration_band_id !== REQUIRED_CONTRACT.duration_band_id ||
        resolved.min_words !== SCRIPT_MIN_WORDS ||
        resolved.max_words !== SCRIPT_MAX_WORDS
      ) {
        errors.push("script_contract_resolution_mismatch");
      }
    } catch {
      errors.push("script_contract_invalid");
    }
  }

  let sourceEvidenceFile = null;
  const declaredEvidenceSha = String(
    manifest?.source_evidence_sha256 || "",
  ).toLowerCase();
  if (!String(manifest?.source_evidence_path || "").trim()) {
    errors.push("source_evidence_path_required");
  } else {
    const evidencePath = path.resolve(
      path.dirname(manifestFile.path),
      manifest.source_evidence_path,
    );
    try {
      sourceEvidenceFile = readJsonFile(
        evidencePath,
        "source_evidence_file_not_found",
        "source_evidence_invalid_json",
      );
      if (!SHA256_PATTERN.test(declaredEvidenceSha)) {
        errors.push("source_evidence_sha256_required");
      } else if (hashFile(sourceEvidenceFile.path) !== declaredEvidenceSha) {
        errors.push("source_evidence_sha256_mismatch");
      }
      const evidence = sourceEvidenceFile.value;
      if (evidence?.schema_version !== SOURCE_EVIDENCE_SCHEMA_VERSION) {
        errors.push("source_evidence_schema_invalid");
      }
      if (evidence?.source_type !== "official") {
        errors.push("source_evidence_official_type_required");
      }
      if (String(evidence?.source_url || "").trim() !== sourceUrl) {
        errors.push("source_evidence_url_mismatch");
      }
      if (evidence?.published_at !== manifest?.published_at) {
        errors.push("source_evidence_published_timestamp_mismatch");
      }
      if (!validClaims(evidence?.claims)) {
        errors.push("source_evidence_claims_required");
      } else if (stableJson(evidence.claims) !== stableJson(manifest?.claims)) {
        errors.push("source_evidence_claims_mismatch");
      }
    } catch (error) {
      if (error instanceof GovernedStoryIntakeError) {
        errors.push(...error.codes);
      } else {
        throw error;
      }
    }
  }

  if (errors.length) throw new GovernedStoryIntakeError(errors);
  return {
    manifest,
    manifestPath: manifestFile.path,
    manifestSha256: sha256Bytes(manifestFile.bytes),
    storyId,
    script,
    scriptSha256: computedScriptSha,
    wordCount,
    sourceEvidence: sourceEvidenceFile.value,
    sourceEvidencePath: sourceEvidenceFile.path,
    sourceEvidenceSha256: declaredEvidenceSha,
    contract: {
      editorial_lane_id: contract.editorial_lane_id,
      hook_type: contract.hook_type,
      duration_band_id: contract.duration_band_id,
    },
  };
}

function resolveHashBoundFile({
  baseDir,
  record,
  prefix,
  errors,
} = {}) {
  const declaredPath = String(record?.path || "").trim();
  const declaredSha = String(record?.sha256 || "").trim().toLowerCase();
  const resolvedPath = declaredPath
    ? path.resolve(baseDir, declaredPath)
    : null;
  let regularFile = false;
  let observedSha = null;
  if (!declaredPath) {
    errors.push(`${prefix}_path_required`);
  } else {
    try {
      const stat = fs.lstatSync(resolvedPath);
      regularFile = stat.isFile() && !stat.isSymbolicLink();
      if (!regularFile) errors.push(`${prefix}_file_invalid`);
    } catch {
      errors.push(`${prefix}_file_not_found`);
    }
  }
  if (!SHA256_PATTERN.test(declaredSha)) {
    errors.push(`${prefix}_sha256_required`);
  } else if (regularFile) {
    observedSha = hashFile(resolvedPath);
    if (observedSha !== declaredSha) {
      errors.push(`${prefix}_sha256_mismatch`);
    }
  }
  return {
    path: resolvedPath,
    sha256: declaredSha,
    valid:
      Boolean(resolvedPath) &&
      regularFile &&
      SHA256_PATTERN.test(declaredSha) &&
      observedSha === declaredSha,
  };
}

function resolveGovernedHybridSourceMedia({
  manifestFile,
  manifest,
  raw,
  rawAssets,
  intakeValidation,
  validationBoundaryAt,
  prefix,
  errors,
} = {}) {
  const mediaType = String(raw?.media_type || "").trim();
  const ownership = String(raw?.ownership || "").trim();
  const rightsBasis = String(raw?.rights_basis || "")
    .trim()
    .toUpperCase();
  const generatorIdentity = String(raw?.generator_identity || "").trim();
  const provenance = raw?.provenance;
  if (
    mediaType !== "video" ||
    ownership !== "mixed" ||
    rightsBasis !== "LICENSED" ||
    raw?.attribution_required !== true ||
    !HYPERFRAMES_GENERATOR_PATTERN.test(generatorIdentity) ||
    String(provenance?.source || "").trim() !==
      GOVERNED_HYBRID_SOURCE ||
    provenance?.third_party_media_used !== true
  ) {
    errors.push(`${prefix}_governed_hybrid_policy_invalid`);
    return null;
  }

  const sourceEvidence = intakeValidation?.sourceEvidence;
  const sourceEvidencePath = intakeValidation?.sourceEvidencePath;
  const visualBrief = intakeValidation?.manifest?.story?.visual_brief;
  const officialMedia = sourceEvidence?.official_media;
  if (
    !sourceEvidencePath ||
    !officialMedia ||
    typeof officialMedia !== "object" ||
    Array.isArray(officialMedia) ||
    visualBrief?.format !== GOVERNED_HYBRID_VISUAL_FORMAT ||
    visualBrief?.source_media_policy !==
      GOVERNED_HYBRID_SOURCE_MEDIA_POLICY
  ) {
    errors.push(`${prefix}_governed_source_media_context_required`);
    return null;
  }

  if (
    String(officialMedia.rights_basis || "").trim().toUpperCase() !==
      "LICENSED" ||
    String(officialMedia.publisher || "").trim() !== PUBLISHER ||
    String(officialMedia.licence_url || "").trim() !==
      CANONICAL_LICENCE_URL ||
    String(officialMedia.licence_effective_date || "").trim() !==
      LICENCE_EFFECTIVE_DATE ||
    String(officialMedia.required_copyright_notice || "").trim() !==
      ATTRIBUTION_TEXT ||
    visualBrief?.attribution?.required !== true ||
    String(visualBrief?.attribution?.text || "").trim() !==
      ATTRIBUTION_TEXT
  ) {
    errors.push(`${prefix}_governed_source_media_licence_invalid`);
  }

  const expectedDelivery = ["DESCRIPTION", "ON_SCREEN"];
  const observedDelivery = Array.isArray(
    visualBrief?.attribution?.delivery,
  )
    ? unique(
        visualBrief.attribution.delivery.map((item) =>
          String(item || "").trim().toUpperCase(),
        ),
      ).sort()
    : [];
  if (stableJson(observedDelivery) !== stableJson(expectedDelivery)) {
    errors.push(`${prefix}_governed_source_media_attribution_invalid`);
  }

  const sourceMediaPath = String(
    officialMedia.source_media_manifest_path || "",
  ).trim();
  const visualSourceMediaPath = String(
    visualBrief?.source_media_manifest_path || "",
  ).trim();
  const expectedSourceMediaPath = sourceMediaPath
    ? path.resolve(path.dirname(sourceEvidencePath), sourceMediaPath)
    : null;
  const visualExpectedSourceMediaPath = visualSourceMediaPath
    ? path.resolve(
        path.dirname(intakeValidation.manifestPath),
        visualSourceMediaPath,
      )
    : null;
  if (
    !expectedSourceMediaPath ||
    visualExpectedSourceMediaPath !== expectedSourceMediaPath
  ) {
    errors.push(`${prefix}_governed_source_media_path_mismatch`);
  }

  const manifestDir = path.dirname(manifestFile.path);
  const provenanceSourceBinding = resolveHashBoundFile({
    baseDir: manifestDir,
    record: provenance?.source_media_manifest,
    prefix: `${prefix}_source_media_manifest`,
    errors,
  });
  const combination = manifest?.combination;
  const combinationSourceBinding = resolveHashBoundFile({
    baseDir: manifestDir,
    record: combination?.source_media_manifest,
    prefix: `${prefix}_combination_source_media_manifest`,
    errors,
  });
  if (
    combination?.third_party_media_used !== true ||
    String(combination?.source_media_policy || "").trim() !==
      GOVERNED_HYBRID_SOURCE_MEDIA_POLICY
  ) {
    errors.push(`${prefix}_combination_policy_invalid`);
  }
  if (
    !provenanceSourceBinding.valid ||
    !combinationSourceBinding.valid ||
    provenanceSourceBinding.path !== expectedSourceMediaPath ||
    combinationSourceBinding.path !== expectedSourceMediaPath ||
    provenanceSourceBinding.sha256 !== combinationSourceBinding.sha256
  ) {
    errors.push(`${prefix}_source_media_manifest_binding_mismatch`);
    return null;
  }

  let sourceMedia;
  try {
    sourceMedia = validateGovernedSourceMediaManifest({
      manifestPath: expectedSourceMediaPath,
      expectedManifestSha256: provenanceSourceBinding.sha256,
      expectedStoryId: intakeValidation.storyId,
      validationBoundaryAt,
    });
  } catch (error) {
    if (error instanceof GovernedSourceMediaError) {
      errors.push(
        ...error.codes.map((code) => `${prefix}_${code}`),
      );
      return null;
    }
    throw error;
  }

  if (
    sourceMedia.rights_review.evidence?.licence_evidence_url !==
      officialMedia.licence_url ||
    sourceMedia.rights_review.evidence?.licence_effective_date !==
      officialMedia.licence_effective_date
  ) {
    errors.push(`${prefix}_source_media_rights_review_mismatch`);
  }

  let sourceMediaManifest;
  try {
    sourceMediaManifest = JSON.parse(
      fs.readFileSync(expectedSourceMediaPath, "utf8"),
    );
  } catch {
    errors.push(`${prefix}_source_media_manifest_invalid_json`);
    return null;
  }
  if (
    !sourceMediaManifest.components.every(
      (component) =>
        String(component?.editorial?.purpose || "").trim() ===
          "TRANSFORMATIVE_EDITORIAL" &&
        String(component?.editorial?.treatment || "").trim(),
    )
  ) {
    errors.push(`${prefix}_transformation_evidence_invalid`);
  }

  const componentErrors = [];
  const observedComponents = (
    Array.isArray(provenance?.source_media_components)
      ? provenance.source_media_components
      : []
  )
    .map((component, index) => {
      const binding = resolveHashBoundFile({
        baseDir: manifestDir,
        record: component,
        prefix: `${prefix}_source_media_component_${index}`,
        errors: componentErrors,
      });
      return {
        component_id: String(component?.component_id || "").trim(),
        media_type: String(component?.media_type || "")
          .trim()
          .toUpperCase(),
        path: binding.path,
        sha256: binding.sha256,
      };
    })
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  errors.push(...componentErrors);
  const expectedComponents = sourceMedia.components
    .map((component) => ({
      component_id: component.component_id,
      media_type: component.media_type,
      path: component.asset.path,
      sha256: component.asset.sha256,
    }))
    .sort((left, right) =>
      left.component_id.localeCompare(right.component_id),
    );
  if (stableJson(observedComponents) !== stableJson(expectedComponents)) {
    errors.push(`${prefix}_source_media_components_mismatch`);
  }

  const backboneBinding = resolveHashBoundFile({
    baseDir: manifestDir,
    record: provenance?.source_backbone,
    prefix: `${prefix}_source_backbone`,
    errors,
  });
  const boundBackboneCandidates = rawAssets.filter((candidate) => {
    const candidatePath = canonicalFilePath(
      path.resolve(
        manifestDir,
        String(candidate?.path || ""),
      ),
    );
    const backbonePath = canonicalFilePath(backboneBinding.path);
    return (
      candidatePath === backbonePath &&
      String(candidate?.sha256 || "").trim().toLowerCase() ===
        backboneBinding.sha256
    );
  });
  const hasOwnedBackbonePolicy = boundBackboneCandidates.some(
    (candidate) =>
      String(candidate?.media_type || "").trim() === "video" &&
      String(candidate?.role || "").trim() ===
        GOVERNED_OWNED_BACKBONE_ROLE &&
      String(candidate?.ownership || "").trim() === "owned" &&
      String(candidate?.rights_basis || "").trim().toUpperCase() ===
        "OWNED" &&
      candidate?.attribution_required === false,
  );
  if (!backboneBinding.valid || !boundBackboneCandidates.length) {
    errors.push(`${prefix}_owned_source_backbone_mismatch`);
  } else if (!hasOwnedBackbonePolicy) {
    errors.push(`${prefix}_owned_source_backbone_policy_invalid`);
  }
  const hybridPath = canonicalFilePath(
    path.resolve(
      manifestDir,
      String(raw?.path || ""),
    ),
  );
  const hybridSha = String(raw?.sha256 || "").trim().toLowerCase();
  if (
    backboneBinding.valid &&
    (canonicalFilePath(backboneBinding.path) === hybridPath ||
      backboneBinding.sha256 === hybridSha)
  ) {
    errors.push(`${prefix}_owned_source_backbone_not_distinct`);
  }
  return sourceMedia;
}

function validateOwnedAssetManifest({
  manifestPath,
  expectedSha256,
  expectedStoryId,
  intakeValidation,
  validationBoundaryAt,
} = {}) {
  const manifestFile = readJsonFile(
    manifestPath,
    "owned_asset_manifest_file_required",
    "owned_asset_manifest_invalid_json",
  );
  const errors = [];
  const computedManifestSha = sha256Bytes(manifestFile.bytes);
  const declaredSha = String(expectedSha256 || "").toLowerCase();
  if (!SHA256_PATTERN.test(declaredSha)) {
    errors.push("owned_asset_manifest_sha256_required");
  } else if (declaredSha !== computedManifestSha) {
    errors.push("owned_asset_manifest_sha256_mismatch");
  }
  if (manifestFile.value?.schema_version !== OWNED_ASSET_SCHEMA_VERSION) {
    errors.push("owned_asset_manifest_schema_invalid");
  }
  if (
    !expectedStoryId ||
    manifestFile.value?.story_id !== expectedStoryId
  ) {
    errors.push("owned_asset_story_id_mismatch");
  }
  const rawAssets = manifestFile.value?.assets;
  if (!Array.isArray(rawAssets) || rawAssets.length === 0) {
    errors.push("owned_assets_required");
  }
  const assets = [];
  for (const [index, raw] of (Array.isArray(rawAssets) ? rawAssets : []).entries()) {
    const prefix = `owned_asset_${index}`;
    const mediaType = String(raw?.media_type || "").trim();
    const role = String(raw?.role || "").trim();
    const ownership = String(raw?.ownership || "").trim();
    const filePath = path.resolve(
      path.dirname(manifestFile.path),
      String(raw?.path || ""),
    );
    const claimedSha = String(raw?.sha256 || "").toLowerCase();
    if (!raw?.path || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      errors.push(`${prefix}_file_not_found`);
    }
    if (!["image", "video"].includes(mediaType)) {
      errors.push(`${prefix}_media_type_invalid`);
    }
    if (!role) errors.push(`${prefix}_role_required`);
    const isGovernedHybridCandidate =
      ownership === "mixed" && role === GOVERNED_HYBRID_ROLE;
    if (ownership !== "owned" && !isGovernedHybridCandidate) {
      errors.push(`${prefix}_ownership_invalid`);
    } else if (isGovernedHybridCandidate) {
      resolveGovernedHybridSourceMedia({
        manifestFile,
        manifest: manifestFile.value,
        raw,
        rawAssets,
        intakeValidation,
        validationBoundaryAt,
        prefix,
        errors,
      });
    }
    if (!SHA256_PATTERN.test(claimedSha)) {
      errors.push(`${prefix}_sha256_required`);
    } else if (fs.existsSync(filePath) && hashFile(filePath) !== claimedSha) {
      errors.push(`${prefix}_sha256_mismatch`);
    }
    assets.push({
      path: filePath,
      sha256: claimedSha,
      media_type: mediaType,
      role,
      ownership,
      rights_basis: String(raw?.rights_basis || "").trim().toUpperCase(),
      attribution_required: raw?.attribution_required === true,
      mixed_licensed_intermediate: isGovernedHybridCandidate,
    });
  }
  if (
    assets.length > 0 &&
    !assets.some((asset) => asset.media_type === "image") &&
    !assets.some((asset) => asset.media_type === "video")
  ) {
    errors.push("owned_asset_media_required");
  }
  if (errors.length) throw new GovernedStoryIntakeError(errors);
  return {
    manifest: manifestFile.value,
    manifestPath: manifestFile.path,
    manifestSha256: computedManifestSha,
    storyId: expectedStoryId,
    assets,
  };
}

function explicitlyFalse(value) {
  return /^(false|0|no|off)$/i.test(String(value || "").trim());
}

function truthy(value) {
  return /^(true|1|yes|on)$/i.test(String(value || "").trim());
}

function tableExists(db, tableName) {
  return !!db
    .prepare(
      `SELECT 1 FROM sqlite_master
       WHERE type = 'table' AND name = ? LIMIT 1`,
    )
    .get(tableName);
}

function inspectApplyDatabase({ databasePath, generatedAt, DatabaseImpl }) {
  const blockers = [];
  const Database = DatabaseImpl || require("better-sqlite3");
  let db;
  try {
    db = new Database(databasePath, {
      readonly: true,
      fileMustExist: true,
    });
  } catch {
    return {
      blockers: ["governed_database_file_required"],
      inspection: null,
    };
  }
  try {
    if (!tableExists(db, "schema_migrations")) {
      blockers.push("schema_migrations_table_required");
    } else {
      const migration = db
        .prepare(
          `SELECT version, filename, checksum
           FROM schema_migrations WHERE version = '023'`,
        )
        .get();
      if (!migration) {
        blockers.push("migration_023_required");
      } else {
        const migrationPath = path.join(
          __dirname,
          "..",
          "..",
          "db",
          "migrations",
          "023_stabilisation_governance_hardening.sql",
        );
        if (
          migration.filename !==
            "023_stabilisation_governance_hardening.sql" ||
          migration.checksum !== hashFile(migrationPath)
        ) {
          blockers.push("migration_023_integrity_mismatch");
        }
      }
    }
    if (!tableExists(db, "operator_audit_log")) {
      blockers.push("operator_audit_log_required");
    } else {
      const auditColumns = new Set(
        db
          .prepare("PRAGMA table_info(operator_audit_log)")
          .all()
          .map((column) => column.name),
      );
      if (!auditColumns.has("idempotency_key")) {
        blockers.push("operator_audit_idempotency_required");
      }
    }
    const now = new Date(generatedAt).toISOString();
    const liveLeases = tableExists(db, "runtime_leases")
      ? db
          .prepare(
            `SELECT name FROM runtime_leases
             WHERE julianday(expires_at) > julianday(?)`,
          )
          .all(now)
      : [];
    if (liveLeases.length) blockers.push("active_runtime_leases_present");
    const runningJobs = tableExists(db, "jobs")
      ? db
          .prepare(
            `SELECT id FROM jobs
             WHERE status IN ('claimed', 'running') LIMIT 1`,
          )
          .all()
      : [];
    if (runningJobs.length) blockers.push("running_jobs_present");
    const activeWorkers = tableExists(db, "workers")
      ? db
          .prepare(
            `SELECT id FROM workers
             WHERE COALESCE(status, '') NOT IN ('offline', 'locked') LIMIT 1`,
          )
          .all()
      : [];
    if (activeWorkers.length) blockers.push("active_workers_present");
    return {
      blockers: unique(blockers),
      inspection: {
        migration_023_applied: !blockers.includes("migration_023_required"),
        live_runtime_lease_count: liveLeases.length,
        running_job_count: runningJobs.length,
        active_worker_count: activeWorkers.length,
      },
    };
  } finally {
    db.close();
  }
}

function evaluateApplyGates({
  databasePath,
  backupEvidencePath,
  generatedAt,
  env,
  DatabaseImpl,
} = {}) {
  const blockers = [];
  const effectiveEnv = env || {};
  const declaredModes = [
    effectiveEnv.PULSE_OPERATING_MODE,
    effectiveEnv.PULSE_RUNTIME_MODE,
    effectiveEnv.OPERATING_MODE,
  ]
    .filter((value) => String(value || "").trim())
    .map((value) => String(value).trim().toUpperCase());
  if (
    declaredModes.length === 0 ||
    declaredModes.some((mode) => mode !== "HUMAN_REVIEW")
  ) {
    blockers.push("human_review_operating_mode_required");
  }
  if (!explicitlyFalse(effectiveEnv.AUTO_PUBLISH)) {
    blockers.push("auto_publish_must_be_explicitly_false");
  }
  if (
    !truthy(
      effectiveEnv.PULSE_EMERGENCY_KILL_SWITCH ||
        effectiveEnv.PULSE_KILL_SWITCH,
    )
  ) {
    blockers.push("kill_switch_required");
  }
  if (!truthy(effectiveEnv.PULSE_CUTOVER_SCHEDULER_STOPPED)) {
    blockers.push("scheduler_must_be_stopped");
  }
  if (!truthy(effectiveEnv.PULSE_CUTOVER_WORKERS_STOPPED)) {
    blockers.push("workers_must_be_stopped");
  }
  const resolvedDatabasePath = databasePath
    ? path.resolve(databasePath)
    : null;
  if (!resolvedDatabasePath || !fs.existsSync(resolvedDatabasePath)) {
    blockers.push("governed_database_file_required");
    return {
      blockers: unique(blockers),
      backup: null,
      inspection: null,
    };
  }
  let backup;
  try {
    backup = verifyBackupEvidence({
      evidencePath: backupEvidencePath,
      databasePath: resolvedDatabasePath,
      generatedAt,
    });
    blockers.push(...backup.blockers);
  } catch {
    blockers.push("backup_evidence_verification_failed");
  }
  const inspection = inspectApplyDatabase({
    databasePath: resolvedDatabasePath,
    generatedAt,
    DatabaseImpl,
  });
  blockers.push(...inspection.blockers);
  return {
    blockers: unique(blockers),
    backup: backup?.evidence || null,
    inspection: inspection.inspection,
  };
}

function storyColumns(db) {
  return new Set(
    db
      .prepare("PRAGMA table_info(stories)")
      .all()
      .map((column) => column.name),
  );
}

function parseJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function serialiseStoryValue(key, value) {
  if (
    JSON_STORY_FIELDS.has(key) &&
    value !== null &&
    value !== undefined &&
    typeof value !== "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return value === undefined ? null : value;
}

function splitStoryForInsert(db, story, governanceExtra) {
  const columns = storyColumns(db);
  const row = {};
  const extra = {
    ...parseJsonObject(story._extra),
    ...governanceExtra,
  };
  for (const [key, value] of Object.entries(story)) {
    if (key === "_extra") continue;
    if (columns.has(key)) {
      row[key] = serialiseStoryValue(key, value);
    } else if (value !== undefined && value !== null) {
      extra[key] = value;
    }
  }
  row._extra = JSON.stringify(extra);
  return row;
}

function insertStory(db, row) {
  const keys = Object.keys(row);
  const placeholders = keys.map(() => "?").join(", ");
  db.prepare(
    `INSERT INTO stories (${keys.join(", ")})
     VALUES (${placeholders})`,
  ).run(...keys.map((key) => row[key]));
}

function insertAuditIdempotently(db, audit) {
  db.prepare(
    `INSERT OR IGNORE INTO operator_audit_log
       (actor_id, action, target_type, target_id, decision, reason,
        evidence_json, idempotency_key)
     VALUES (?, ?, 'story', ?, ?, ?, ?, ?)`,
  ).run(
    audit.actorId,
    audit.action,
    audit.targetId,
    audit.decision,
    audit.reason,
    JSON.stringify(audit.evidence),
    audit.idempotencyKey,
  );
  return db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE idempotency_key = ?`,
    )
    .get(audit.idempotencyKey);
}

function assetStoryFields(assetValidation) {
  if (!assetValidation) return {};
  const images = assetValidation.assets
    .filter((asset) => asset.media_type === "image")
    .map((asset) => ({
      path: asset.path,
      type: "owned",
      role: asset.role,
      sha256: asset.sha256,
    }));
  const videos = assetValidation.assets
    .filter((asset) => asset.media_type === "video")
    .map((asset) => asset.path);
  return {
    image_path: images[0]?.path || null,
    downloaded_images: images,
    video_clips: videos,
  };
}

function commonResult({
  action,
  mode,
  verdict,
  storyId,
  mutated,
  blockers = [],
  validation = null,
  assetValidation = null,
  backup = null,
  inspection = null,
  idempotent = false,
  generatedAt,
} = {}) {
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    generated_at: generatedAt,
    action,
    mode,
    verdict,
    mutated,
    idempotent,
    story_id: storyId || null,
    manifest_sha256: validation?.manifestSha256 || null,
    source_evidence_sha256: validation?.sourceEvidenceSha256 || null,
    script_sha256: validation?.scriptSha256 || null,
    owned_asset_manifest_sha256:
      assetValidation?.manifestSha256 || null,
    blockers: unique(blockers),
    backup_evidence: backup,
    database_inspection: inspection,
  };
}

function validateCommandInputs(options, storyId, expectedScriptSha) {
  const blockers = [];
  if (options.confirmStoryId !== storyId) {
    blockers.push("exact_story_confirmation_required");
  }
  if (!String(options.actorId || "").trim()) {
    blockers.push("operator_actor_required");
  }
  if (!String(options.reason || "").trim()) {
    blockers.push("operator_reason_required");
  }
  if (expectedScriptSha !== null) {
    const suppliedSha = String(options.scriptSha256 || "").toLowerCase();
    if (!SHA256_PATTERN.test(suppliedSha)) {
      blockers.push("exact_script_sha256_required");
    } else if (suppliedSha !== expectedScriptSha) {
      blockers.push("exact_script_sha256_mismatch");
    }
  }
  return blockers;
}

function buildIngestStory(validation, assetValidation, generatedAt) {
  const assets = assetStoryFields(assetValidation);
  return {
    ...validation.manifest.story,
    ...validation.contract,
    ...assets,
    id: validation.storyId,
    url: validation.manifest.source_url,
    article_url: validation.manifest.source_url,
    source_type: "official",
    timestamp: validation.manifest.published_at,
    channel_id: "pulse-gaming",
    flair: "Confirmed",
    classification: "[CONFIRMED]",
    content_pillar:
      validation.manifest.story.content_pillar || "Confirmed Drop",
    full_script: validation.script,
    tts_script: validation.script,
    word_count: validation.wordCount,
    source_url_hash: canonicalHash(validation.manifest.source_url),
    approved: false,
    auto_approved: false,
    approved_at: null,
    published_at: null,
    created_at: generatedAt,
    updated_at: generatedAt,
  };
}

function ingestTransaction({
  db,
  validation,
  assetValidation,
  actorId,
  reason,
  generatedAt,
}) {
  const auditMaterial = [
    validation.manifestSha256,
    assetValidation?.manifestSha256 || "no-assets",
  ].join(":");
  const idempotencyKey =
    `governed-story-intake:ingest:${validation.storyId}:` +
    sha256Bytes(auditMaterial);
  const existingAudit = db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(idempotencyKey);
  const existingStory = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(validation.storyId);
  if (existingStory || existingAudit) {
    if (
      existingStory &&
      existingAudit &&
      scriptSha256(existingStory.full_script) === validation.scriptSha256 &&
      existingStory.approved === 0 &&
      existingStory.auto_approved === 0
    ) {
      return { idempotent: true, mutated: false };
    }
    throw new GovernedStoryIntakeError("story_intake_conflict");
  }
  const governanceExtra = {
    source_published_at: validation.manifest.published_at,
    claims: validation.manifest.claims,
    source_evidence_path: validation.sourceEvidencePath,
    source_evidence_sha256: validation.sourceEvidenceSha256,
    story_intake_manifest_path: validation.manifestPath,
    story_intake_manifest_sha256: validation.manifestSha256,
    script_sha256: validation.scriptSha256,
    operator_review_status: "pending_script_approval",
    ...(assetValidation
      ? {
          owned_asset_manifest_path: assetValidation.manifestPath,
          owned_asset_manifest_sha256: assetValidation.manifestSha256,
          owned_asset_fallback_acquisition_allowed: false,
        }
      : {}),
  };
  const row = splitStoryForInsert(
    db,
    buildIngestStory(validation, assetValidation, generatedAt),
    governanceExtra,
  );
  insertStory(db, row);
  insertAuditIdempotently(db, {
    actorId,
    action: "governed_story_ingest",
    targetId: validation.storyId,
    decision: "CREATED_UNAPPROVED",
    reason,
    idempotencyKey,
    evidence: {
      manifest_sha256: validation.manifestSha256,
      source_evidence_sha256: validation.sourceEvidenceSha256,
      script_sha256: validation.scriptSha256,
      owned_asset_manifest_sha256:
        assetValidation?.manifestSha256 || null,
      confirmed_story_id: validation.storyId,
      created_at: generatedAt,
      auto_approved: false,
    },
  });
  return { idempotent: false, mutated: true };
}

function approveScriptTransaction({
  db,
  storyId,
  scriptHash,
  actorId,
  reason,
  generatedAt,
}) {
  const idempotencyKey =
    `governed-story-intake:approve-script:${storyId}:${scriptHash}`;
  const story = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(storyId);
  if (!story) throw new GovernedStoryIntakeError("story_not_found");
  const actualSha = scriptSha256(story.full_script);
  if (actualSha !== scriptHash) {
    throw new GovernedStoryIntakeError("exact_script_sha256_mismatch");
  }
  const existingAudit = db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(idempotencyKey);
  if (story.approved === 1) {
    if (story.auto_approved === 0 && existingAudit) {
      return { idempotent: true, mutated: false };
    }
    throw new GovernedStoryIntakeError("story_approval_state_conflict");
  }
  const extra = {
    ...parseJsonObject(story._extra),
    operator_review_status: "script_approved",
    script_approved_sha256: scriptHash,
    script_approved_by: actorId,
    script_approved_reason: reason,
    script_approved_at: generatedAt,
  };
  db.prepare(
    `UPDATE stories
     SET approved = 1, auto_approved = 0, approved_at = ?,
         updated_at = ?, _extra = ?
     WHERE id = ?`,
  ).run(generatedAt, generatedAt, JSON.stringify(extra), storyId);
  insertAuditIdempotently(db, {
    actorId,
    action: "governed_story_script_approval",
    targetId: storyId,
    decision: "HUMAN_SCRIPT_APPROVED",
    reason,
    idempotencyKey,
    evidence: {
      script_sha256: scriptHash,
      confirmed_story_id: storyId,
      approved_at: generatedAt,
      auto_approved: false,
    },
  });
  return { idempotent: false, mutated: true };
}

function attachAssetsTransaction({
  db,
  storyId,
  assetValidation,
  actorId,
  reason,
  generatedAt,
}) {
  const idempotencyKey =
    `governed-story-intake:attach-owned-assets:${storyId}:` +
    assetValidation.manifestSha256;
  const story = db
    .prepare("SELECT * FROM stories WHERE id = ?")
    .get(storyId);
  if (!story) throw new GovernedStoryIntakeError("story_not_found");
  const existingAudit = db
    .prepare(
      "SELECT * FROM operator_audit_log WHERE idempotency_key = ?",
    )
    .get(idempotencyKey);
  if (existingAudit) {
    return { idempotent: true, mutated: false };
  }
  const fields = assetStoryFields(assetValidation);
  const extra = {
    ...parseJsonObject(story._extra),
    owned_asset_manifest_path: assetValidation.manifestPath,
    owned_asset_manifest_sha256: assetValidation.manifestSha256,
    owned_asset_fallback_acquisition_allowed: false,
    owned_assets_attached_at: generatedAt,
    owned_assets_attached_by: actorId,
  };
  db.prepare(
    `UPDATE stories
     SET image_path = ?, downloaded_images = ?, video_clips = ?,
         updated_at = ?, _extra = ?
     WHERE id = ?`,
  ).run(
    fields.image_path,
    JSON.stringify(fields.downloaded_images),
    JSON.stringify(fields.video_clips),
    generatedAt,
    JSON.stringify(extra),
    storyId,
  );
  insertAuditIdempotently(db, {
    actorId,
    action: "governed_story_owned_assets_attached",
    targetId: storyId,
    decision: "OWNED_ASSETS_ATTACHED",
    reason,
    idempotencyKey,
    evidence: {
      owned_asset_manifest_sha256: assetValidation.manifestSha256,
      assets: assetValidation.assets.map((asset) => ({
        path: asset.path,
        sha256: asset.sha256,
        media_type: asset.media_type,
        role: asset.role,
      })),
      confirmed_story_id: storyId,
      attached_at: generatedAt,
    },
  });
  return { idempotent: false, mutated: true };
}

function readStoryScriptHash({ databasePath, storyId, DatabaseImpl }) {
  try {
    return withReadOnlySqliteSnapshot(
      databasePath,
      (db) => {
        const story = db
          .prepare("SELECT full_script FROM stories WHERE id = ?")
          .get(storyId);
        return story ? scriptSha256(story.full_script) : null;
      },
      {
        DatabaseImpl,
      },
    );
  } catch {
    return null;
  }
}

function executeGovernedStoryIntake(options = {}) {
  const action = String(options.action || "ingest").trim();
  if (!ACTIONS.has(action)) {
    throw new GovernedStoryIntakeError("governed_story_action_invalid");
  }
  const apply = options.apply === true;
  const generatedAt = new Date(options.generatedAt || new Date()).toISOString();
  let validation = null;
  let assetValidation = null;
  let storyId = String(options.storyId || "").trim() || null;
  let expectedScriptSha = null;

  if (action === "ingest") {
    validation = validateStoryIntakeManifest({
      manifestPath: options.manifestPath,
    });
    storyId = validation.storyId;
    expectedScriptSha = validation.scriptSha256;
    if (options.assetManifestPath || options.assetManifestSha256) {
      assetValidation = validateOwnedAssetManifest({
        manifestPath: options.assetManifestPath,
        expectedSha256: options.assetManifestSha256,
        expectedStoryId: storyId,
        intakeValidation: validation,
        validationBoundaryAt: generatedAt,
      });
    }
  } else if (!storyId) {
    throw new GovernedStoryIntakeError("story_id_required");
  }

  if (action === "attach-owned-assets") {
    assetValidation = validateOwnedAssetManifest({
      manifestPath: options.assetManifestPath,
      expectedSha256: options.assetManifestSha256,
      expectedStoryId: storyId,
    });
  }

  if (!apply) {
    return commonResult({
      action,
      mode: "DRY_RUN",
      verdict: "VALID",
      storyId,
      mutated: false,
      validation,
      assetValidation,
      generatedAt,
    });
  }

  if (action === "approve-script") {
    expectedScriptSha = readStoryScriptHash({
      databasePath: options.databasePath,
      storyId,
      DatabaseImpl: options.DatabaseImpl,
    });
    if (!expectedScriptSha) {
      return commonResult({
        action,
        mode: "APPLY",
        verdict: "HOLD",
        storyId,
        mutated: false,
        blockers: ["story_not_found"],
        generatedAt,
      });
    }
  }

  const commandBlockers = validateCommandInputs(
    options,
    storyId,
    action === "attach-owned-assets" ? null : expectedScriptSha,
  );
  const gates = evaluateApplyGates({
    databasePath: options.databasePath,
    backupEvidencePath: options.backupEvidencePath,
    generatedAt,
    env: options.env || process.env,
    DatabaseImpl: options.DatabaseImpl,
  });
  const blockers = unique([...commandBlockers, ...gates.blockers]);
  if (blockers.length) {
    return commonResult({
      action,
      mode: "APPLY",
      verdict: "HOLD",
      storyId,
      mutated: false,
      blockers,
      validation,
      assetValidation,
      backup: gates.backup,
      inspection: gates.inspection,
      generatedAt,
    });
  }

  const Database = options.DatabaseImpl || require("better-sqlite3");
  const db = new Database(path.resolve(options.databasePath), {
    fileMustExist: true,
  });
  let transactionResult;
  try {
    transactionResult = db.transaction(() => {
      const runtimeInspection = inspectRuntimeInOpenDatabase(db, generatedAt);
      if (runtimeInspection.length) {
        throw new GovernedStoryIntakeError(runtimeInspection);
      }
      if (action === "ingest") {
        return ingestTransaction({
          db,
          validation,
          assetValidation,
          actorId: String(options.actorId).trim(),
          reason: String(options.reason).trim(),
          generatedAt,
        });
      }
      if (action === "approve-script") {
        return approveScriptTransaction({
          db,
          storyId,
          scriptHash: String(options.scriptSha256).toLowerCase(),
          actorId: String(options.actorId).trim(),
          reason: String(options.reason).trim(),
          generatedAt,
        });
      }
      return attachAssetsTransaction({
        db,
        storyId,
        assetValidation,
        actorId: String(options.actorId).trim(),
        reason: String(options.reason).trim(),
        generatedAt,
      });
    }).immediate();
  } catch (error) {
    if (error instanceof GovernedStoryIntakeError) {
      return commonResult({
        action,
        mode: "APPLY",
        verdict: "HOLD",
        storyId,
        mutated: false,
        blockers: error.codes,
        validation,
        assetValidation,
        backup: gates.backup,
        inspection: gates.inspection,
        generatedAt,
      });
    }
    throw error;
  } finally {
    db.close();
  }
  return commonResult({
    action,
    mode: "APPLY",
    verdict: transactionResult.idempotent ? "IDEMPOTENT" : "APPLIED",
    storyId,
    mutated: transactionResult.mutated,
    idempotent: transactionResult.idempotent,
    validation,
    assetValidation,
    backup: gates.backup,
    inspection: gates.inspection,
    generatedAt,
  });
}

function inspectRuntimeInOpenDatabase(db, generatedAt) {
  const blockers = [];
  if (
    tableExists(db, "runtime_leases") &&
    db
      .prepare(
        `SELECT 1 FROM runtime_leases
         WHERE julianday(expires_at) > julianday(?) LIMIT 1`,
      )
      .get(generatedAt)
  ) {
    blockers.push("active_runtime_leases_present");
  }
  if (
    tableExists(db, "jobs") &&
    db
      .prepare(
        `SELECT 1 FROM jobs
         WHERE status IN ('claimed', 'running') LIMIT 1`,
      )
      .get()
  ) {
    blockers.push("running_jobs_present");
  }
  if (
    tableExists(db, "workers") &&
    db
      .prepare(
        `SELECT 1 FROM workers
         WHERE COALESCE(status, '') NOT IN ('offline', 'locked') LIMIT 1`,
      )
      .get()
  ) {
    blockers.push("active_workers_present");
  }
  return blockers;
}

module.exports = {
  ACTIONS,
  GovernedStoryIntakeError,
  INTAKE_SCHEMA_VERSION,
  OWNED_ASSET_SCHEMA_VERSION,
  REQUIRED_CONTRACT,
  RESULT_SCHEMA_VERSION,
  SCRIPT_MAX_WORDS,
  SCRIPT_MIN_WORDS,
  SOURCE_EVIDENCE_SCHEMA_VERSION,
  evaluateApplyGates,
  executeGovernedStoryIntake,
  hashFile,
  normaliseScript,
  scriptSha256,
  sha256Bytes,
  stableJson,
  validateOwnedAssetManifest,
  validateStoryIntakeManifest,
};
