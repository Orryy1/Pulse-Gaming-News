"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  scriptSha256,
} = require("./governed-story-intake");
const {
  classifyPlatformVideoQa,
} = require("./platform-video-qa");
const {
  wordsFromAlignment,
} = require("../studio/sound-layer");
const {
  buildKineticAss,
} = require("../studio/v2/subtitle-layer-v2");
const {
  buildStandardRendererManifest,
} = require("../stabilisation/render-manifest");
const {
  evaluateRendererManifest,
  fingerprintRendererManifest,
} = require("../stabilisation/renderer-governance");
const {
  validateGovernedSourceMediaManifest,
} = require("./governed-source-media");
const {
  POLICY: GOVERNED_GAME_MEDIA_POLICY,
} = require("./governed-game-media-admission");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  getAssCaptionSafeZoneContract,
  getPlatformSafeZoneProfile,
  validateAssCaptionSafeZone,
} = require("./platform-safe-zones");
const {
  getDurationBand,
} = require("./pulse-editorial-contract");
const {
  validateGovernedLicensedAudioPack,
} = require("./governed-licensed-audio-pack");

const STORY_INTAKE_SCHEMA = "pulse-governed-story-intake-v1";
const OWNED_MOTION_SCHEMA = "pulse-owned-motion-manifest-v1";
const NARRATION_MANIFEST_SCHEMA =
  "pulse-governed-narration-manifest-v1";
const WORD_TIMESTAMPS_SCHEMA = "pulse-word-timestamps-v1";
const RENDERER_MANIFEST_SCHEMA = "pulse-render-manifest-v1";
const QA_SCHEMA = "pulse-final-render-qa-v1";
const COMPOSITE_MANIFEST_SCHEMA =
  "pulse-governed-final-composite-v1";
const RESULT_SCHEMA =
  "pulse-governed-final-composite-result-v1";
const RENDERER_ID = "studio-v21";
const RENDERER_VERSION = "studio-v21.5.0";
const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const HYPERFRAMES_DURATION_SECONDS = 28;
const FINAL_DURATION_SECONDS = 25;
const DURATION_SECONDS = FINAL_DURATION_SECONDS;
const DURATION_TOLERANCE_SECONDS = 0.1;
const TARGET_INTEGRATED_LUFS = -16;
const TARGET_TRUE_PEAK_DBFS = -1.5;
const TARGET_LOUDNESS_RANGE_LU = 11;
const LOUDNESS_TOLERANCE_LU = 0.6;
const MAX_TERMINAL_SILENCE_SECONDS = 1.5;
const MAX_LICENSED_AUDIO_SHORT_DURATION_SECONDS = 59;
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;
const SOURCE_MEDIA_POLICY = "LICENSED_OFFICIAL_FFXIV";
const OWNED_ONLY_SOURCE_MEDIA_POLICY = "OWNED_ONLY";
const SUPPORTED_SOURCE_MEDIA_POLICIES = new Set([
  SOURCE_MEDIA_POLICY,
  GOVERNED_GAME_MEDIA_POLICY,
]);

class GovernedFinalCompositeError extends Error {
  constructor(codes) {
    const values = unique(Array.isArray(codes) ? codes : [codes]);
    super(
      `governed_final_composite_validation_failed: ${values.join(", ")}`,
    );
    this.name = "GovernedFinalCompositeError";
    this.codes = values;
  }
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function text(value) {
  return String(value || "").trim();
}

function safeStoryId(value) {
  const id = text(value);
  if (!/^[a-z0-9][a-z0-9._-]{5,127}$/i.test(id)) {
    throw new GovernedFinalCompositeError(
      "story_id_invalid",
    );
  }
  return id;
}

function sha256Bytes(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hashFile(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function readJsonFile(filePath, invalidCode) {
  const resolved = path.resolve(text(filePath));
  if (
    !filePath ||
    !fs.existsSync(resolved) ||
    !fs.statSync(resolved).isFile()
  ) {
    throw new GovernedFinalCompositeError(
      invalidCode.replace(/_invalid_json$/, "_file_missing"),
    );
  }
  try {
    return {
      path: resolved,
      sha256: hashFile(resolved),
      value: JSON.parse(fs.readFileSync(resolved, "utf8")),
    };
  } catch {
    throw new GovernedFinalCompositeError(invalidCode);
  }
}

function assertFile(filePath, missingCode) {
  const resolved = path.resolve(text(filePath));
  if (
    !filePath ||
    !fs.existsSync(resolved) ||
    !fs.statSync(resolved).isFile()
  ) {
    throw new GovernedFinalCompositeError(missingCode);
  }
  const size = fs.statSync(resolved).size;
  if (size <= 0) {
    throw new GovernedFinalCompositeError(
      missingCode.replace(/_missing$/, "_empty"),
    );
  }
  return {
    path: resolved,
    sha256: hashFile(resolved),
    size_bytes: size,
  };
}

function normalisePathForRecord(baseDir, filePath) {
  return path
    .relative(baseDir, path.resolve(filePath))
    .replace(/\\/g, "/");
}

function samePath(left, right, platform = process.platform) {
  const resolveComparable = (value) => {
    const resolved = path.resolve(String(value || ""));
    let canonical = resolved;
    try {
      canonical = fs.realpathSync.native(resolved);
    } catch {}
    return platform === "win32"
      ? canonical.toLowerCase()
      : canonical;
  };
  return resolveComparable(left) === resolveComparable(right);
}

function validateOptionalGovernedSourceMedia({
  manifestPath,
  expectedManifestSha256,
  storyId,
  sourceMediaPolicy,
  validationBoundaryAt,
} = {}) {
  const hasManifestPath = Boolean(text(manifestPath));
  const hasExpectedSha = Boolean(text(expectedManifestSha256));
  const policy = text(sourceMediaPolicy).toUpperCase();
  if (
    !SUPPORTED_SOURCE_MEDIA_POLICIES.has(policy) &&
    policy !== OWNED_ONLY_SOURCE_MEDIA_POLICY
  ) {
    throw new GovernedFinalCompositeError(
      "source_media_policy_invalid",
    );
  }
  if (policy === OWNED_ONLY_SOURCE_MEDIA_POLICY) {
    if (hasManifestPath || hasExpectedSha) {
      throw new GovernedFinalCompositeError(
        "source_media_forbidden_for_owned_only_policy",
      );
    }
    return null;
  }
  const pairErrors = [];
  if (!hasManifestPath) {
    pairErrors.push("source_media_manifest_path_required");
  }
  if (!hasExpectedSha) {
    pairErrors.push("source_media_manifest_sha256_required");
  }
  if (pairErrors.length) {
    throw new GovernedFinalCompositeError(pairErrors);
  }
  try {
    return validateGovernedSourceMediaManifest({
      manifestPath,
      expectedManifestSha256,
      expectedStoryId: storyId,
      validationBoundaryAt,
    });
  } catch (error) {
    throw new GovernedFinalCompositeError(
      Array.isArray(error?.codes)
        ? error.codes
        : ["source_media_manifest_validation_failed"],
    );
  }
}

function validateSourceMediaProjectBindings({
  sourceMedia,
  projectFiles,
} = {}) {
  if (!sourceMedia) return [];
  const indexFile = (projectFiles || []).find(
    (record) =>
      path.basename(record.path).toLowerCase() ===
      "index.html",
  );
  if (!indexFile) {
    throw new GovernedFinalCompositeError(
      "hyperframes_project_index_html_required",
    );
  }
  const indexHtml = fs.readFileSync(indexFile.path, "utf8");
  const domHtml = indexHtml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(
      /<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
      "",
    );
  const mediaElements = [];
  const mediaTagPattern = /<(img|video)\b([^>]*)>/gi;
  let mediaTagMatch;
  while ((mediaTagMatch = mediaTagPattern.exec(domHtml))) {
    const attributes = {};
    const attributePattern =
      /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let attributeMatch;
    while (
      (attributeMatch = attributePattern.exec(mediaTagMatch[2]))
    ) {
      attributes[attributeMatch[1].toLowerCase()] =
        attributeMatch[2] ??
        attributeMatch[3] ??
        attributeMatch[4] ??
        "";
    }
    mediaElements.push({
      tag_name: mediaTagMatch[1].toLowerCase(),
      attributes,
    });
  }
  const errors = [];
  const requiredOnScreenAttributions = unique(
    sourceMedia.components
      .filter(
        (component) =>
          component.attribution.required === true &&
          component.attribution.delivery.includes("ON_SCREEN"),
      )
      .map((component) => text(component.attribution.text)),
  );
  for (const attribution of requiredOnScreenAttributions) {
    if (!domHtml.includes(attribution)) {
      errors.push("source_media_attribution_missing_from_index");
    }
  }
  const bindings = sourceMedia.components.map((component) => {
    const projectFile = (projectFiles || []).find(
      (record) =>
        samePath(record.path, component.asset.path) &&
        record.sha256 === component.asset.sha256,
    );
    if (!projectFile) {
      errors.push(
        `source_media_component_${component.component_id}_not_bound_by_project`,
      );
    }
    const expectedTag =
      component.media_type === "VIDEO" ? "video" : "img";
    const matchingElements = mediaElements.filter(
      (element) =>
        element.tag_name === expectedTag &&
        element.attributes.id === component.component_id,
    );
    if (matchingElements.length !== 1) {
      errors.push(
        `source_media_component_${component.component_id}_dom_binding_missing`,
      );
      return {
        component_id: component.component_id,
        media_type: component.media_type,
        path: component.asset.path,
        sha256: component.asset.sha256,
        project_file: projectFile || null,
        dom_binding: null,
      };
    }
    const element = matchingElements[0];
    const rawSrc = text(element.attributes.src);
    let resolvedSrc = null;
    if (
      rawSrc &&
      !/^[a-z][a-z0-9+.-]*:/i.test(rawSrc) &&
      !rawSrc.startsWith("//")
    ) {
      try {
        resolvedSrc = path.resolve(
          path.dirname(indexFile.path),
          decodeURIComponent(rawSrc.split(/[?#]/, 1)[0]),
        );
      } catch {
        resolvedSrc = null;
      }
    }
    if (
      !resolvedSrc ||
      !samePath(resolvedSrc, component.asset.path)
    ) {
      errors.push(
        `source_media_component_${component.component_id}_src_mismatch`,
      );
    }
    const usage = component?.editorial?.usage_seconds;
    const expectedStart = Number(usage?.[0]);
    const expectedEnd = Number(usage?.[1]);
    const expectedDuration = expectedEnd - expectedStart;
    const actualStart = Number(element.attributes["data-start"]);
    const actualDuration = Number(
      element.attributes["data-duration"],
    );
    if (
      !Array.isArray(usage) ||
      usage.length !== 2 ||
      !Number.isFinite(expectedStart) ||
      !Number.isFinite(expectedEnd) ||
      expectedStart < 0 ||
      expectedEnd <= expectedStart
    ) {
      errors.push(
        `source_media_component_${component.component_id}_usage_seconds_invalid`,
      );
    } else if (
      !Number.isFinite(actualStart) ||
      !Number.isFinite(actualDuration) ||
      Math.abs(actualStart - expectedStart) > 0.001 ||
      Math.abs(actualDuration - expectedDuration) > 0.001
    ) {
      errors.push(
        `source_media_component_${component.component_id}_timing_mismatch`,
      );
    }
    return {
      component_id: component.component_id,
      media_type: component.media_type,
      path: component.asset.path,
      sha256: component.asset.sha256,
      project_file: projectFile || null,
      dom_binding: {
        tag_name: element.tag_name,
        id: element.attributes.id,
        src: rawSrc,
        start_seconds: actualStart,
        duration_seconds: actualDuration,
      },
    };
  });
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return bindings;
}

function resolveManifestRecord({
  baseDir,
  record,
  prefix,
} = {}) {
  const errors = [];
  const declaredPath = text(record?.path);
  const declaredSha = text(record?.sha256).toLowerCase();
  const resolvedPath = declaredPath
    ? path.resolve(baseDir, declaredPath)
    : null;
  if (!declaredPath) errors.push(`${prefix}_path_required`);
  if (!SHA256_PATTERN.test(declaredSha)) {
    errors.push(`${prefix}_sha256_required`);
  }
  if (
    !resolvedPath ||
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isFile()
  ) {
    errors.push(`${prefix}_file_missing`);
  } else if (
    SHA256_PATTERN.test(declaredSha) &&
    hashFile(resolvedPath) !== declaredSha
  ) {
    errors.push(`${prefix}_sha256_mismatch`);
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    path: resolvedPath,
    declared_path: declaredPath.replace(/\\/g, "/"),
    sha256: declaredSha,
    size_bytes: fs.statSync(resolvedPath).size,
  };
}

function validateCombinedOwnedMotionManifest({
  manifestPath,
  storyId,
  hyperframesVideoPath,
  sourceMediaManifestPath,
  expectedSourceMediaManifestSha256,
  sourceMediaPolicy,
  validationBoundaryAt,
  expectedDurationSeconds =
    HYPERFRAMES_DURATION_SECONDS,
} = {}) {
  const boundManifest = readJsonFile(
    manifestPath,
    "owned_motion_manifest_invalid_json",
  );
  const manifest = boundManifest.value;
  const errors = [];
  const expectedStoryId = safeStoryId(storyId);
  const manifestDir = path.dirname(boundManifest.path);
  const sourceMedia = validateOptionalGovernedSourceMedia({
    manifestPath: sourceMediaManifestPath,
    expectedManifestSha256:
      expectedSourceMediaManifestSha256,
    storyId: expectedStoryId,
    sourceMediaPolicy,
    validationBoundaryAt,
  });

  if (manifest?.schema_version !== OWNED_MOTION_SCHEMA) {
    errors.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== expectedStoryId) {
    errors.push("owned_motion_manifest_story_id_mismatch");
  }
  const assets = Array.isArray(manifest?.assets)
    ? manifest.assets
    : [];
  if (!assets.length) errors.push("owned_motion_manifest_assets_required");
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  const declaredHyperframesAsset = assets.find(
    (asset) =>
      text(asset?.role).toLowerCase() ===
      "hyperframes_intermediate",
  );
  if (
    !sourceMedia &&
    (text(declaredHyperframesAsset?.ownership).toLowerCase() ===
      "mixed" ||
      declaredHyperframesAsset?.provenance
        ?.third_party_media_used === true ||
      manifest?.combination?.third_party_media_used === true)
  ) {
    throw new GovernedFinalCompositeError(
      "source_media_manifest_required_for_mixed_motion",
    );
  }

  const resolvedAssets = assets.map((asset, index) => {
    const assetRole = text(asset?.role).toLowerCase();
    const record = resolveManifestRecord({
      baseDir: manifestDir,
      record: asset,
      prefix:
        assetRole === "hyperframes_intermediate"
          ? "hyperframes_intermediate"
          : `owned_motion_asset_${index}`,
    });
    const ownership = text(asset?.ownership).toLowerCase();
    const rightsBasis = text(asset?.rights_basis).toUpperCase();
    const assetErrors = [];
    const isHyperframesIntermediate =
      assetRole === "hyperframes_intermediate";
    if (isHyperframesIntermediate && sourceMedia) {
      if (ownership !== "mixed") {
        assetErrors.push(
          "hyperframes_intermediate_ownership_must_be_mixed",
        );
      }
      if (rightsBasis !== "LICENSED") {
        assetErrors.push(
          "hyperframes_intermediate_rights_basis_must_be_licensed",
        );
      }
      if (asset?.attribution_required !== true) {
        assetErrors.push(
          "hyperframes_intermediate_attribution_required",
        );
      }
    } else {
      if (ownership !== "owned") {
        assetErrors.push(`owned_motion_asset_${index}_not_owned`);
      }
      if (rightsBasis !== "OWNED") {
        assetErrors.push(
          `owned_motion_asset_${index}_rights_basis_not_owned`,
        );
      }
      if (asset?.attribution_required === true) {
        assetErrors.push(
          `owned_motion_asset_${index}_attribution_not_cleared`,
        );
      }
    }
    if (assetErrors.length) {
      throw new GovernedFinalCompositeError(assetErrors);
    }
    return {
      ...asset,
      ...record,
      role: assetRole,
      media_type: text(asset?.media_type).toLowerCase(),
    };
  });

  const requestedVideo = assertFile(
    hyperframesVideoPath,
    "hyperframes_intermediate_missing",
  );
  const hyperframesAsset = resolvedAssets.find(
    (asset) =>
      asset.role === "hyperframes_intermediate" &&
      samePath(asset.path, requestedVideo.path),
  );
  if (!hyperframesAsset) {
    throw new GovernedFinalCompositeError(
      "hyperframes_intermediate_not_bound_by_manifest",
    );
  }

  const hfErrors = [];
  if (hyperframesAsset.sha256 !== requestedVideo.sha256) {
    hfErrors.push("hyperframes_intermediate_sha256_mismatch");
  }
  if (hyperframesAsset.media_type !== "video") {
    hfErrors.push("hyperframes_intermediate_media_type_invalid");
  }
  if (
    Number(hyperframesAsset.width) !== WIDTH ||
    Number(hyperframesAsset.height) !== HEIGHT
  ) {
    hfErrors.push("hyperframes_intermediate_dimensions_invalid");
  }
  if (
    Math.abs(
      Number(hyperframesAsset.duration_seconds) -
        Number(expectedDurationSeconds),
    ) > DURATION_TOLERANCE_SECONDS
  ) {
    hfErrors.push("hyperframes_intermediate_duration_invalid");
  }
  if (
    !/hyperframes/i.test(
      text(hyperframesAsset.generator_identity),
    )
  ) {
    hfErrors.push("hyperframes_generator_identity_required");
  }
  const provenance = hyperframesAsset.provenance || {};
  if (provenance.source !== "hyperframes_material_stage") {
    hfErrors.push("hyperframes_material_stage_provenance_required");
  }
  if (
    provenance.third_party_media_used !==
    Boolean(sourceMedia)
  ) {
    hfErrors.push(
      sourceMedia
        ? "hyperframes_third_party_media_must_be_true"
        : "hyperframes_third_party_media_must_be_false",
    );
  }
  if (
    provenance.source_commit !== null &&
    provenance.source_commit !== undefined &&
    !/^[a-f0-9]{40}$/i.test(text(provenance.source_commit))
  ) {
    hfErrors.push("hyperframes_source_commit_invalid");
  }
  if (hfErrors.length) {
    throw new GovernedFinalCompositeError(hfErrors);
  }

  const sourceBackbone = resolveManifestRecord({
    baseDir: manifestDir,
    record: provenance.source_backbone,
    prefix: "hyperframes_source_backbone",
  });
  const backboneAsset = resolvedAssets.find(
    (asset) =>
      asset.role === "owned_motion_backbone" &&
      samePath(asset.path, sourceBackbone.path) &&
      asset.sha256 === sourceBackbone.sha256,
  );
  if (!backboneAsset) {
    throw new GovernedFinalCompositeError(
      "hyperframes_source_backbone_not_bound_by_manifest",
    );
  }
  if (
    text(backboneAsset.ownership).toLowerCase() !== "owned" ||
    text(backboneAsset.rights_basis).toUpperCase() !== "OWNED" ||
    backboneAsset.attribution_required !== false
  ) {
    throw new GovernedFinalCompositeError(
      "hyperframes_source_backbone_policy_invalid",
    );
  }
  if (
    samePath(backboneAsset.path, hyperframesAsset.path) ||
    backboneAsset.sha256 === hyperframesAsset.sha256
  ) {
    throw new GovernedFinalCompositeError(
      "hyperframes_source_backbone_not_distinct",
    );
  }

  const projectRecords = Array.isArray(provenance.project_files)
    ? provenance.project_files
    : [];
  if (!projectRecords.length) {
    throw new GovernedFinalCompositeError(
      "hyperframes_project_files_required",
    );
  }
  const projectFiles = projectRecords.map((record, index) =>
    resolveManifestRecord({
      baseDir: manifestDir,
      record,
      prefix: `hyperframes_project_file_${index}`,
    }),
  );
  const projectNames = new Set(
    projectFiles.map((record) =>
      path.basename(record.path).toLowerCase(),
    ),
  );
  const projectErrors = [];
  if (!projectNames.has("index.html")) {
    projectErrors.push("hyperframes_project_index_html_required");
  }
  if (!projectNames.has("hyperframes.json")) {
    projectErrors.push("hyperframes_project_config_required");
  }
  if (projectErrors.length) {
    throw new GovernedFinalCompositeError(projectErrors);
  }

  let sourceMediaBindings = [];
  if (sourceMedia) {
    const declaredSourceManifest = resolveManifestRecord({
      baseDir: manifestDir,
      record: provenance.source_media_manifest,
      prefix: "hyperframes_source_media_manifest",
    });
    const combinationSourceManifest = resolveManifestRecord({
      baseDir: manifestDir,
      record: manifest?.combination?.source_media_manifest,
      prefix: "combined_source_media_manifest",
    });
    const sourceErrors = [];
    if (
      text(manifest?.combination?.source_media_policy)
        .toUpperCase() !== text(sourceMediaPolicy).toUpperCase()
    ) {
      sourceErrors.push(
        "combined_source_media_policy_invalid",
      );
    }
    if (
      manifest?.combination?.third_party_media_used !== true
    ) {
      sourceErrors.push(
        "combined_third_party_media_must_be_true",
      );
    }
    for (const record of [
      declaredSourceManifest,
      combinationSourceManifest,
    ]) {
      if (
        !samePath(record.path, sourceMedia.manifest_path) ||
        record.sha256 !== sourceMedia.manifest_sha256
      ) {
        sourceErrors.push(
          "source_media_manifest_binding_mismatch",
        );
      }
    }
    const declaredComponents = Array.isArray(
      provenance.source_media_components,
    )
      ? provenance.source_media_components
      : [];
    if (
      declaredComponents.length !==
      sourceMedia.components.length
    ) {
      sourceErrors.push(
        "source_media_component_bindings_incomplete",
      );
    }
    for (const component of sourceMedia.components) {
      const binding = declaredComponents.find(
        (candidate) =>
          text(candidate?.component_id) ===
          component.component_id,
      );
      if (!binding) {
        sourceErrors.push(
          `source_media_component_${component.component_id}_binding_missing`,
        );
        continue;
      }
      const record = resolveManifestRecord({
        baseDir: manifestDir,
        record: binding,
        prefix: `source_media_component_${component.component_id}`,
      });
      if (
        !samePath(record.path, component.asset.path) ||
        record.sha256 !== component.asset.sha256 ||
        text(binding?.media_type).toUpperCase() !==
          component.media_type
      ) {
        sourceErrors.push(
          `source_media_component_${component.component_id}_binding_mismatch`,
        );
      }
    }
    if (sourceErrors.length) {
      throw new GovernedFinalCompositeError(sourceErrors);
    }
    sourceMediaBindings = validateSourceMediaProjectBindings({
      sourceMedia,
      projectFiles,
    });
  } else if (
    manifest?.combination?.third_party_media_used === true ||
    provenance.third_party_media_used === true ||
    text(hyperframesAsset.ownership).toLowerCase() === "mixed"
  ) {
    throw new GovernedFinalCompositeError(
      "source_media_manifest_required_for_mixed_motion",
    );
  }

  return {
    manifest,
    manifestPath: boundManifest.path,
    manifestSha256: boundManifest.sha256,
    assets: resolvedAssets,
    hyperframesAsset,
    backboneAsset,
    projectFiles,
    ...(sourceMedia
      ? {
          sourceMedia,
          sourceMediaBindings,
        }
      : {}),
    thirdPartyMediaUsed: Boolean(sourceMedia),
  };
}

async function deriveCombinedOwnedMotionManifest({
  sourceManifestPath,
  storyId,
  hyperframesVideoPath,
  hyperframesProbe,
  projectFilePaths,
  outputPath,
  generatedAt = new Date().toISOString(),
  generatorIdentity = "hyperframes@0.7.76",
  sourceCommit = null,
  sourceMediaManifestPath,
  expectedSourceMediaManifestSha256,
  sourceMediaPolicy,
  expectedDurationSeconds =
    HYPERFRAMES_DURATION_SECONDS,
} = {}) {
  const source = readJsonFile(
    sourceManifestPath,
    "owned_motion_manifest_invalid_json",
  );
  const manifest = source.value;
  const expectedStoryId = safeStoryId(storyId);
  const sourceMedia = validateOptionalGovernedSourceMedia({
    manifestPath: sourceMediaManifestPath,
    expectedManifestSha256:
      expectedSourceMediaManifestSha256,
    storyId: expectedStoryId,
    sourceMediaPolicy,
    validationBoundaryAt: generatedAt,
  });
  const errors = [];
  if (manifest?.schema_version !== OWNED_MOTION_SCHEMA) {
    errors.push("owned_motion_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== expectedStoryId) {
    errors.push("owned_motion_manifest_story_id_mismatch");
  }
  const assets = Array.isArray(manifest?.assets)
    ? manifest.assets
    : [];
  if (!assets.length) errors.push("owned_motion_manifest_assets_required");
  if (!outputPath) {
    errors.push("combined_owned_motion_output_path_required");
  }
  if (
    sourceCommit &&
    !/^[a-f0-9]{40}$/i.test(text(sourceCommit))
  ) {
    errors.push("hyperframes_source_commit_invalid");
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }

  const sourceDir = path.dirname(source.path);
  const targetPath = path.resolve(outputPath);
  const targetDir = path.dirname(targetPath);
  const resolvedAssets = assets.map((asset, index) => {
    const record = resolveManifestRecord({
      baseDir: sourceDir,
      record: asset,
      prefix: `source_owned_motion_asset_${index}`,
    });
    const assetErrors = [];
    if (text(asset?.ownership).toLowerCase() !== "owned") {
      assetErrors.push(`source_owned_motion_asset_${index}_not_owned`);
    }
    if (text(asset?.rights_basis).toUpperCase() !== "OWNED") {
      assetErrors.push(
        `source_owned_motion_asset_${index}_rights_basis_not_owned`,
      );
    }
    if (asset?.attribution_required === true) {
      assetErrors.push(
        `source_owned_motion_asset_${index}_attribution_not_cleared`,
      );
    }
    if (assetErrors.length) {
      throw new GovernedFinalCompositeError(assetErrors);
    }
    return { asset, record };
  });
  const backbone = resolvedAssets.find(
    ({ asset }) =>
      text(asset?.role).toLowerCase() ===
      "owned_motion_backbone",
  );
  if (!backbone) {
    throw new GovernedFinalCompositeError(
      "owned_motion_backbone_required",
    );
  }

  const hyperframesFile = assertFile(
    hyperframesVideoPath,
    "hyperframes_intermediate_missing",
  );
  const technical = hyperframesProbe?.streams
    ? inspectHyperframesProbe(hyperframesProbe, {
        expectedDurationSeconds,
      })
    : hyperframesProbe;
  if (
    Number(technical?.width) !== WIDTH ||
    Number(technical?.height) !== HEIGHT ||
    Math.abs(
      Number(technical?.duration_seconds) -
        Number(expectedDurationSeconds),
    ) > DURATION_TOLERANCE_SECONDS ||
    Math.abs(Number(technical?.fps) - FPS) > 0.01
  ) {
    throw new GovernedFinalCompositeError(
      "hyperframes_intermediate_probe_invalid",
    );
  }

  const explicitProjectFiles = Array.isArray(projectFilePaths)
    ? projectFilePaths
    : [];
  if (!explicitProjectFiles.length) {
    throw new GovernedFinalCompositeError(
      "hyperframes_project_files_required_for_derivation",
    );
  }
  const projectFiles = explicitProjectFiles.map((filePath) =>
    assertFile(filePath, "hyperframes_project_file_missing"),
  );
  const projectNames = new Set(
    projectFiles.map((record) =>
      path.basename(record.path).toLowerCase(),
    ),
  );
  const projectErrors = [];
  if (!projectNames.has("index.html")) {
    projectErrors.push("hyperframes_project_index_html_required");
  }
  if (!projectNames.has("hyperframes.json")) {
    projectErrors.push("hyperframes_project_config_required");
  }
  if (projectErrors.length) {
    throw new GovernedFinalCompositeError(projectErrors);
  }
  const sourceMediaBindings = validateSourceMediaProjectBindings({
    sourceMedia,
    projectFiles,
  });

  await fsp.mkdir(targetDir, { recursive: true });
  const rebasedAssets = resolvedAssets.map(({ asset, record }) => ({
    ...asset,
    path: normalisePathForRecord(targetDir, record.path),
    sha256: record.sha256,
  }));
  const combined = {
    ...manifest,
    generated_at: generatedAt,
    combination: {
      mode: "LOCAL_PROOF",
      source_manifest: {
        path: normalisePathForRecord(targetDir, source.path),
        sha256: source.sha256,
      },
      third_party_media_used: Boolean(sourceMedia),
      ...(sourceMedia
        ? {
            source_media_policy: text(
              sourceMediaPolicy,
            ).toUpperCase(),
            source_media_manifest: {
              path: normalisePathForRecord(
                targetDir,
                sourceMedia.manifest_path,
              ),
              sha256: sourceMedia.manifest_sha256,
            },
          }
        : {}),
    },
    assets: [
      ...rebasedAssets,
      {
        path: normalisePathForRecord(
          targetDir,
          hyperframesFile.path,
        ),
        sha256: hyperframesFile.sha256,
        media_type: "video",
        role: "hyperframes_intermediate",
        ownership: sourceMedia ? "mixed" : "owned",
        width: WIDTH,
        height: HEIGHT,
        duration_seconds: Number(expectedDurationSeconds),
        generator_identity: text(generatorIdentity),
        rights_basis: sourceMedia ? "LICENSED" : "OWNED",
        attribution_required: Boolean(sourceMedia),
        provenance: {
          source: "hyperframes_material_stage",
          third_party_media_used: Boolean(sourceMedia),
          source_commit: sourceCommit
            ? text(sourceCommit).toLowerCase()
            : null,
          source_backbone: {
            path: normalisePathForRecord(
              targetDir,
              backbone.record.path,
            ),
            sha256: backbone.record.sha256,
          },
          project_files: projectFiles.map((record) => ({
            path: normalisePathForRecord(
              targetDir,
              record.path,
            ),
            sha256: record.sha256,
          })),
          ...(sourceMedia
            ? {
                source_media_manifest: {
                  path: normalisePathForRecord(
                    targetDir,
                    sourceMedia.manifest_path,
                  ),
                  sha256: sourceMedia.manifest_sha256,
                },
                source_media_components:
                  sourceMediaBindings.map((binding) => ({
                    component_id: binding.component_id,
                    media_type: binding.media_type,
                    path: normalisePathForRecord(
                      targetDir,
                      binding.path,
                    ),
                    sha256: binding.sha256,
                  })),
              }
            : {}),
        },
      },
    ],
  };
  await writeJsonAtomic(targetPath, combined);
  return {
    derived: true,
    path: targetPath,
    sha256: hashFile(targetPath),
    manifest: combined,
  };
}

function compactTranscript(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validateAlignment(alignment) {
  const characters = Array.isArray(alignment?.characters)
    ? alignment.characters
    : [];
  const starts = Array.isArray(
    alignment?.character_start_times_seconds,
  )
    ? alignment.character_start_times_seconds
    : Array.isArray(alignment?.characterStartTimesSeconds)
      ? alignment.characterStartTimesSeconds
      : [];
  const ends = Array.isArray(
    alignment?.character_end_times_seconds,
  )
    ? alignment.character_end_times_seconds
    : Array.isArray(alignment?.characterEndTimesSeconds)
      ? alignment.characterEndTimesSeconds
      : [];
  const errors = [];
  if (!characters.length) errors.push("timestamp_characters_required");
  if (
    starts.length !== characters.length ||
    ends.length !== characters.length
  ) {
    errors.push("timestamp_alignment_length_mismatch");
  }
  let previousStart = -Infinity;
  let previousEnd = -Infinity;
  for (let index = 0; index < characters.length; index += 1) {
    const start = Number(starts[index]);
    const end = Number(ends[index]);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end < start
    ) {
      errors.push("timestamp_alignment_value_invalid");
      break;
    }
    if (start < previousStart || end < previousEnd) {
      errors.push("timestamp_alignment_not_monotonic");
      break;
    }
    previousStart = start;
    previousEnd = end;
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return { characters, starts, ends };
}

function validateGovernedNarrationManifest({
  manifestPath,
  expectedManifestSha256,
  storyId,
  scriptSha256: expectedScriptSha256,
  audioPath,
  timestampsPath,
  audioDurationSeconds,
  finalTargetSeconds = HYPERFRAMES_DURATION_SECONDS,
} = {}) {
  const boundManifest = readJsonFile(
    manifestPath,
    "narration_manifest_invalid_json",
  );
  const manifest = boundManifest.value;
  const manifestDir = path.dirname(boundManifest.path);
  const expectedStoryId = safeStoryId(storyId);
  const expectedScriptHash = text(
    expectedScriptSha256,
  ).toLowerCase();
  const expectedManifestHash = text(
    expectedManifestSha256,
  ).toLowerCase();
  const audio = assertFile(
    audioPath,
    "narration_audio_missing",
  );
  const timestamps = readJsonFile(
    timestampsPath,
    "narration_timestamps_invalid_json",
  );
  const errors = [];

  if (!SHA256_PATTERN.test(expectedManifestHash)) {
    errors.push("narration_manifest_sha256_required");
  } else if (boundManifest.sha256 !== expectedManifestHash) {
    errors.push("narration_manifest_sha256_mismatch");
  }
  if (manifest?.schema_version !== NARRATION_MANIFEST_SCHEMA) {
    errors.push("narration_manifest_schema_invalid");
  }
  if (text(manifest?.story_id) !== expectedStoryId) {
    errors.push("narration_manifest_story_id_mismatch");
  }
  if (
    !SHA256_PATTERN.test(expectedScriptHash) ||
    text(manifest?.script?.sha256).toLowerCase() !==
      expectedScriptHash ||
    text(manifest?.script?.aligned_text_sha256).toLowerCase() !==
      expectedScriptHash
  ) {
    errors.push("narration_manifest_script_sha256_mismatch");
  }
  if (manifest?.script?.exact_alignment_match !== true) {
    errors.push("narration_manifest_exact_alignment_required");
  }

  const narrationDuration = Number(
    manifest?.narration?.duration_seconds,
  );
  const probedDuration = Number(audioDurationSeconds);
  const finalTarget = Number(finalTargetSeconds);
  if (
    !Number.isFinite(narrationDuration) ||
    !Number.isFinite(probedDuration) ||
    Math.abs(narrationDuration - probedDuration) > 0.1
  ) {
    errors.push("narration_manifest_duration_mismatch");
  }
  if (
    !Number.isFinite(finalTarget) ||
    finalTarget <= 0 ||
    finalTarget > MAX_LICENSED_AUDIO_SHORT_DURATION_SECONDS ||
    Math.abs(
      Number(manifest?.narration?.final_target_seconds) -
        finalTarget,
    ) > DURATION_TOLERANCE_SECONDS
  ) {
    errors.push("narration_manifest_final_target_invalid");
  }
  const provider = text(
    manifest?.narration?.provider,
  ).toLowerCase();
  if (provider !== "elevenlabs") {
    errors.push("narration_manifest_provider_invalid");
  }
  if (
    !text(manifest?.narration?.voice_id) ||
    !text(manifest?.narration?.model_id)
  ) {
    errors.push("narration_manifest_provider_identity_required");
  }

  const licence = manifest?.licence || {};
  if (text(licence.rights_basis).toUpperCase() !== "LICENSED") {
    errors.push("narration_licence_rights_basis_invalid");
  }
  if (
    !text(licence.evidence_reference) ||
    !text(licence.attested_by) ||
    !Number.isFinite(Date.parse(text(licence.attested_at))) ||
    !text(licence.evidence_scope)
  ) {
    errors.push("narration_licence_evidence_incomplete");
  }

  const resolveGovernedSource = ({
    record,
    prefix,
    expectedPath,
  }) => {
    const declaredPath = text(record?.path);
    const resolvedPath = declaredPath
      ? path.resolve(manifestDir, declaredPath)
      : null;
    if (!declaredPath) {
      errors.push(`${prefix}_path_required`);
      return null;
    }
    let actual;
    try {
      actual = assertFile(
        resolvedPath,
        `${prefix}_file_missing`,
      );
    } catch (error) {
      errors.push(...(error.codes || [`${prefix}_file_missing`]));
      return null;
    }
    if (expectedPath && !samePath(actual.path, expectedPath)) {
      errors.push(`${prefix}_path_mismatch`);
    }
    for (const field of [
      "expected_sha256",
      "pre_apply_sha256",
      "post_apply_sha256",
    ]) {
      if (
        text(record?.[field]).toLowerCase() !== actual.sha256
      ) {
        errors.push(`${prefix}_${field}_mismatch`);
      }
    }
    if (record?.copied !== false || record?.mutated !== false) {
      errors.push(`${prefix}_mutation_attestation_invalid`);
    }
    return actual;
  };

  const governedAudio = resolveGovernedSource({
    record: manifest?.sources?.audio,
    prefix: "narration_audio_source",
    expectedPath: audio.path,
  });
  const alignment = resolveGovernedSource({
    record: manifest?.sources?.alignment,
    prefix: "narration_alignment_source",
  });

  const outputRecord = manifest?.outputs?.word_timestamps || {};
  const declaredTimestampPath = text(outputRecord.path);
  const resolvedTimestampPath = declaredTimestampPath
    ? path.resolve(manifestDir, declaredTimestampPath)
    : null;
  if (!declaredTimestampPath) {
    errors.push("narration_word_timestamps_path_required");
  } else if (
    !samePath(resolvedTimestampPath, timestamps.path)
  ) {
    errors.push("narration_word_timestamps_path_mismatch");
  }
  if (
    text(outputRecord.sha256).toLowerCase() !== timestamps.sha256
  ) {
    errors.push("narration_word_timestamps_sha256_mismatch");
  }
  if (
    outputRecord.schema_version !== WORD_TIMESTAMPS_SCHEMA ||
    timestamps.value?.schema_version !== WORD_TIMESTAMPS_SCHEMA
  ) {
    errors.push("narration_word_timestamps_schema_invalid");
  }
  if (
    text(timestamps.value?.story_id) !== expectedStoryId
  ) {
    errors.push("narration_word_timestamps_story_id_mismatch");
  }
  if (
    text(timestamps.value?.script_sha256).toLowerCase() !==
    expectedScriptHash
  ) {
    errors.push("narration_word_timestamps_script_sha256_mismatch");
  }
  if (
    text(timestamps.value?.audio_sha256).toLowerCase() !==
    audio.sha256
  ) {
    errors.push("narration_word_timestamps_audio_sha256_mismatch");
  }
  if (
    alignment &&
    text(
      timestamps.value?.source_alignment_sha256,
    ).toLowerCase() !== alignment.sha256
  ) {
    errors.push(
      "narration_word_timestamps_alignment_sha256_mismatch",
    );
  }
  const timestampWords = Array.isArray(timestamps.value?.words)
    ? timestamps.value.words
    : [];
  const declaredWordCounts = [
    Number(outputRecord.word_count),
    Number(manifest?.narration?.word_count),
    Number(timestamps.value?.word_count),
  ];
  if (
    !timestampWords.length ||
    declaredWordCounts.some(
      (count) =>
        !Number.isInteger(count) ||
        count !== timestampWords.length,
    )
  ) {
    errors.push("narration_word_count_mismatch");
  }

  const controls = manifest?.controls || {};
  const safeModes = new Set(["LOCAL_PROOF", "HUMAN_REVIEW"]);
  if (!safeModes.has(text(controls.operating_mode).toUpperCase())) {
    errors.push("narration_control_operating_mode_invalid");
  }
  if (controls.emergency_kill_switch_tripped !== true) {
    errors.push("narration_control_kill_switch_required");
  }
  for (const field of [
    "auto_publish_enabled",
    "live_dispatch_enabled",
    "external_publish_authorised",
    "database_mutation_authorised",
    "oauth_mutation_authorised",
    "network_used",
  ]) {
    if (controls[field] !== false) {
      errors.push(`narration_control_${field}_must_be_false`);
    }
  }

  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    manifest,
    path: boundManifest.path,
    sha256: boundManifest.sha256,
    audio: governedAudio,
    alignment,
    timestamps,
    provider,
    licence: {
      rights_basis: "LICENSED",
      evidence_reference: text(licence.evidence_reference),
      attested_by: text(licence.attested_by),
      attested_at: text(licence.attested_at),
      evidence_scope: text(licence.evidence_scope),
    },
    duration_seconds: narrationDuration,
    final_target_seconds: finalTarget,
    word_count: timestampWords.length,
  };
}

function normaliseWordTimestamps({
  storyId,
  timestamps,
  expectedScript,
  expectedScriptSha256,
  expectedAudioSha256,
} = {}) {
  const expectedStoryId = safeStoryId(storyId);
  const expected = compactTranscript(expectedScript);
  if (timestamps?.schema_version === WORD_TIMESTAMPS_SCHEMA) {
    const errors = [];
    if (text(timestamps?.story_id) !== expectedStoryId) {
      errors.push("timestamp_story_id_mismatch");
    }
    const declaredScriptSha = text(
      timestamps?.script_sha256,
    ).toLowerCase();
    const declaredAudioSha = text(
      timestamps?.audio_sha256,
    ).toLowerCase();
    if (
      expectedScriptSha256 &&
      declaredScriptSha !==
        text(expectedScriptSha256).toLowerCase()
    ) {
      errors.push("timestamp_script_sha256_mismatch");
    }
    if (
      expectedAudioSha256 &&
      declaredAudioSha !== text(expectedAudioSha256).toLowerCase()
    ) {
      errors.push("timestamp_audio_sha256_mismatch");
    }
    const inputWords = Array.isArray(timestamps?.words)
      ? timestamps.words
      : [];
    if (!inputWords.length) errors.push("timestamp_words_required");
    let previousStart = -Infinity;
    let previousEnd = -Infinity;
    const words = inputWords.map((word) => {
      const value = {
        text: text(word?.text),
        start_seconds: Number(word?.start_seconds),
        end_seconds: Number(word?.end_seconds),
      };
      if (
        !value.text ||
        !Number.isFinite(value.start_seconds) ||
        !Number.isFinite(value.end_seconds) ||
        value.start_seconds < 0 ||
        value.end_seconds < value.start_seconds ||
        value.start_seconds < previousStart ||
        value.end_seconds < previousEnd
      ) {
        errors.push("timestamp_word_invalid");
      }
      previousStart = value.start_seconds;
      previousEnd = value.end_seconds;
      return value;
    });
    const transcript = compactTranscript(
      words.map((word) => word.text).join(" "),
    );
    if (!expected || transcript !== expected) {
      errors.push("timestamp_transcript_script_mismatch");
    }
    if (errors.length) {
      throw new GovernedFinalCompositeError(errors);
    }
    return {
      ...timestamps,
      schema_version: WORD_TIMESTAMPS_SCHEMA,
      story_id: expectedStoryId,
      transcript,
      words,
    };
  }

  const alignment = timestamps?.alignment || timestamps;
  const { characters } = validateAlignment(alignment);
  const transcript = compactTranscript(characters.join(""));
  if (!expected || transcript !== expected) {
    throw new GovernedFinalCompositeError(
      "timestamp_transcript_script_mismatch",
    );
  }
  const words = wordsFromAlignment(alignment).map((word) => ({
    text: text(word.word),
    start_seconds: Number(Number(word.start).toFixed(3)),
    end_seconds: Number(Number(word.end).toFixed(3)),
  }));
  if (!words.length) {
    throw new GovernedFinalCompositeError(
      "timestamp_words_required",
    );
  }
  return {
    schema_version: WORD_TIMESTAMPS_SCHEMA,
    story_id: expectedStoryId,
    ...(expectedScriptSha256
      ? { script_sha256: text(expectedScriptSha256).toLowerCase() }
      : {}),
    ...(expectedAudioSha256
      ? { audio_sha256: text(expectedAudioSha256).toLowerCase() }
      : {}),
    transcript,
    words,
  };
}

function parseHtmlAttributes(
  source,
  { duplicateCode = null } = {},
) {
  const attributes = {};
  const pattern =
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(String(source || "")))) {
    const name = match[1].toLowerCase();
    if (
      duplicateCode &&
      Object.prototype.hasOwnProperty.call(attributes, name)
    ) {
      throw new GovernedFinalCompositeError(duplicateCode);
    }
    attributes[name] =
      match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function finiteHtmlNumber(value) {
  const raw = String(value ?? "").trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) {
    return null;
  }
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function activeHtmlElements(source) {
  const withoutComments = withoutHtmlComments(source);
  const activeMarkup = stripHtmlRawTextElements(
    withoutComments,
    ["script", "style", "noscript", "textarea"],
  );
  const elements = [];
  const pattern = /<([a-z][a-z0-9:-]*)\b([^>]*)>/gi;
  let match;
  while ((match = pattern.exec(activeMarkup))) {
    elements.push({
      tag_name: match[1].toLowerCase(),
      attributes: parseHtmlAttributes(match[2], {
        duplicateCode:
          "pre_rendered_caption_duplicate_attribute",
      }),
    });
  }
  return elements;
}

function extractStaticJsonArrayAssignment(source, variableName) {
  const input = String(source || "");
  const assignment = new RegExp(
    `\\b(?:var|let|const)\\s+${variableName}\\s*=`,
  ).exec(input);
  if (!assignment) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_groups_required",
    );
  }
  const start = input.indexOf("[", assignment.index);
  if (start < 0) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_groups_invalid",
    );
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "[") depth += 1;
    if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(input.slice(start, index + 1));
        } catch {
          throw new GovernedFinalCompositeError(
            "pre_rendered_caption_groups_invalid",
          );
        }
      }
    }
  }
  throw new GovernedFinalCompositeError(
    "pre_rendered_caption_groups_invalid",
  );
}

function withoutHtmlComments(source) {
  return String(source || "").replace(
    /<!--[\s\S]*?(?:-->|$)/g,
    "",
  );
}

function stripHtmlRawTextElements(source, tagNames) {
  let result = String(source || "");
  for (const tagName of tagNames) {
    result = result.replace(
      new RegExp(
        `<${tagName}\\b[^>]*>[\\s\\S]*?(?:<\\/${tagName}\\s*>|$)`,
        "gi",
      ),
      "",
    );
  }
  return result;
}

function stripCssComments(source) {
  return String(source || "").replace(
    /\/\*[\s\S]*?(?:\*\/|$)/g,
    "",
  );
}

function matchingCssBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (
    let index = openIndex;
    index < source.length;
    index += 1
  ) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parseCaptionStyleSheet(source) {
  const css = stripCssComments(source);
  const rules = [];
  let cursor = 0;
  while (cursor < css.length) {
    while (
      cursor < css.length &&
      /[\s;]/.test(css[cursor])
    ) {
      cursor += 1;
    }
    if (cursor >= css.length) break;
    const openIndex = css.indexOf("{", cursor);
    const statementEnd = css.indexOf(";", cursor);
    if (
      statementEnd >= 0 &&
      (openIndex < 0 || statementEnd < openIndex)
    ) {
      cursor = statementEnd + 1;
      continue;
    }
    if (openIndex < 0) {
      throw new GovernedFinalCompositeError(
        "pre_rendered_caption_css_binding_mismatch",
      );
    }
    const closeIndex = matchingCssBrace(css, openIndex);
    if (closeIndex < 0) {
      throw new GovernedFinalCompositeError(
        "pre_rendered_caption_css_binding_mismatch",
      );
    }
    const selector = css.slice(cursor, openIndex).trim();
    if (!selector) {
      throw new GovernedFinalCompositeError(
        "pre_rendered_caption_css_binding_mismatch",
      );
    }
    rules.push({
      selector,
      body_start: openIndex + 1,
      body_end: closeIndex,
    });
    cursor = closeIndex + 1;
  }

  const declarations = [];
  const declarationPattern =
    /(^|[;{])\s*(--cap-band-left|--cap-band-top|--cap-band-width|--cap-band-height|left|top|width|height)\s*:\s*([^;{}]+)\s*;/gim;
  let match;
  while ((match = declarationPattern.exec(css))) {
    const nameOffset = match[0].indexOf(match[2]);
    const index = match.index + nameOffset;
    const containingRule =
      rules.find(
        (rule) =>
          index >= rule.body_start &&
          index < rule.body_end,
      ) || null;
    declarations.push({
      name: match[2].toLowerCase(),
      value: match[3].trim(),
      top_level_selector:
        containingRule?.selector || null,
    });
    declarationPattern.lastIndex -= 1;
  }
  return { declarations };
}

function activeCaptionStyleSheets(captionHtml) {
  const withoutComments = withoutHtmlComments(captionHtml);
  const withoutScripts = stripHtmlRawTextElements(
    withoutComments,
    ["script", "noscript", "textarea"],
  );
  const styles = [];
  const pattern = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;
  let match;
  while ((match = pattern.exec(withoutScripts))) {
    styles.push(parseCaptionStyleSheet(match[1]));
  }
  return styles;
}

function preRenderedCaptionSafeZone({
  rootAttributes,
  captionHtml,
} = {}) {
  const profileId = text(
    rootAttributes?.["data-platform-safe-zone-profile"],
  );
  if (!profileId) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_safe_zone_profile_required",
    );
  }
  if (profileId !== CROSS_PLATFORM_PORTRAIT_PROFILE_ID) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_safe_zone_profile_mismatch",
    );
  }
  let profile;
  try {
    profile = getPlatformSafeZoneProfile(profileId);
  } catch {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_safe_zone_profile_invalid",
    );
  }
  const fieldMap = {
    x: "data-caption-rect-x",
    y: "data-caption-rect-y",
    width: "data-caption-rect-width",
    height: "data-caption-rect-height",
  };
  const captionRect = Object.fromEntries(
    Object.entries(fieldMap).map(([field, attribute]) => {
      const value = finiteHtmlNumber(
        rootAttributes?.[attribute],
      );
      return [
        field,
        value === null ? Number.NaN : value,
      ];
    }),
  );
  if (
    !Number.isFinite(captionRect.x) ||
    !Number.isFinite(captionRect.y) ||
    !Number.isFinite(captionRect.width) ||
    !Number.isFinite(captionRect.height) ||
    captionRect.width <= 0 ||
    captionRect.height <= 0
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_rect_invalid",
    );
  }
  const safeRect = profile.safe_rect;
  if (
    captionRect.x < safeRect.x ||
    captionRect.y < safeRect.y ||
    captionRect.x + captionRect.width >
      safeRect.x + safeRect.width ||
    captionRect.y + captionRect.height >
      safeRect.y + safeRect.height
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_rect_outside_safe_rect",
    );
  }
  const cssVariables = {
    x: "cap-band-left",
    y: "cap-band-top",
    width: "cap-band-width",
    height: "cap-band-height",
  };
  const geometryProperties = {
    x: "left",
    y: "top",
    width: "width",
    height: "height",
  };
  const styleSheets = activeCaptionStyleSheets(captionHtml);
  for (const [field, variable] of Object.entries(cssVariables)) {
    const declarations = styleSheets.flatMap((styleSheet) =>
      styleSheet.declarations.filter(
        (declaration) =>
          declaration.name === `--${variable}`,
      ),
    );
    const declaration =
      declarations.length === 1 ? declarations[0] : null;
    const valueMatch =
      /^([0-9]+(?:\.[0-9]+)?)px$/.exec(
        declaration?.value || "",
      );
    if (
      !declaration ||
      declaration.top_level_selector !== ":root" ||
      !valueMatch ||
      Number(valueMatch[1]) !== captionRect[field]
    ) {
      throw new GovernedFinalCompositeError(
        "pre_rendered_caption_css_binding_mismatch",
      );
    }
    const geometryDeclarations = styleSheets.flatMap(
      (styleSheet) =>
        styleSheet.declarations.filter(
          (candidate) =>
            candidate.name === geometryProperties[field],
        ),
    );
    const geometryDeclaration =
      geometryDeclarations.length === 1
        ? geometryDeclarations[0]
        : null;
    const geometryValueMatch = new RegExp(
      `^var\\(\\s*--${variable}\\s*,\\s*([0-9]+(?:\\.[0-9]+)?)px\\s*\\)$`,
    ).exec(geometryDeclaration?.value || "");
    if (
      !geometryDeclaration ||
      geometryDeclaration.top_level_selector !==
        ".caption-stage" ||
      !geometryValueMatch ||
      Number(geometryValueMatch[1]) !== captionRect[field]
    ) {
      throw new GovernedFinalCompositeError(
        "pre_rendered_caption_css_binding_mismatch",
      );
    }
  }
  return {
    schema_version: profile.schema_version,
    verdict: "DECLARATION_BOUND",
    source: "PRE_RENDERED_COMPOSITION_DECLARATION",
    profile_id: profile.id,
    canvas: profile.canvas,
    safe_rect: profile.safe_rect,
    caption_rect: captionRect,
    declaration_within_safe_rect: true,
    visual_geometry_verified: false,
    external_publish_authorised: false,
  };
}

function readBoundPreRenderedProjectFile(
  record,
  prefix,
) {
  let cursor = path.resolve(record.path);
  while (true) {
    let cursorStat;
    try {
      cursorStat = fs.lstatSync(cursor);
    } catch {
      throw new GovernedFinalCompositeError(
        `${prefix}_file_missing`,
      );
    }
    if (cursorStat.isSymbolicLink()) {
      throw new GovernedFinalCompositeError(
        `${prefix}_symlink_forbidden`,
      );
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  let fileStat;
  try {
    fileStat = fs.lstatSync(record.path);
  } catch {
    throw new GovernedFinalCompositeError(
      `${prefix}_file_missing`,
    );
  }
  if (fileStat.isSymbolicLink()) {
    throw new GovernedFinalCompositeError(
      `${prefix}_symlink_forbidden`,
    );
  }
  if (!fileStat.isFile()) {
    throw new GovernedFinalCompositeError(
      `${prefix}_file_missing`,
    );
  }
  const bytes = fs.readFileSync(record.path);
  const sha256 = sha256Bytes(bytes);
  if (sha256 !== record.sha256) {
    throw new GovernedFinalCompositeError(
      `${prefix}_sha256_changed`,
    );
  }
  return {
    bytes,
    text: bytes.toString("utf8"),
    sha256,
  };
}

function validatePreRenderedCaptionProgramme({
  ownedMotion,
  normalisedTimestamps,
  timestampSource,
  durationSeconds,
} = {}) {
  const projectFiles = Array.isArray(ownedMotion?.projectFiles)
    ? ownedMotion.projectFiles
    : [];
  const indexFile = projectFiles.find(
    (record) =>
      path.basename(record.path).toLowerCase() === "index.html",
  );
  const captionFile = projectFiles.find(
    (record) =>
      path.basename(record.path).toLowerCase() ===
      "captions.html",
  );
  const missing = [];
  if (!indexFile) missing.push("pre_rendered_caption_index_missing");
  if (!captionFile) {
    missing.push("pre_rendered_caption_composition_missing");
  }
  if (missing.length) {
    throw new GovernedFinalCompositeError(missing);
  }

  const immutableIndex = readBoundPreRenderedProjectFile(
    indexFile,
    "pre_rendered_caption_index",
  );
  const immutableComposition =
    readBoundPreRenderedProjectFile(
      captionFile,
      "pre_rendered_caption_composition",
    );
  const indexHtml = immutableIndex.text;
  const compositionElements = activeHtmlElements(indexHtml)
    .filter(
      (element) =>
        ["div", "iframe"].includes(element.tag_name) &&
        path
          .basename(
            text(
              element.attributes["data-composition-src"],
            ),
          )
          .toLowerCase() === "captions.html",
    )
    .map((element) => element.attributes);
  if (compositionElements.length !== 1) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_mount_invalid",
    );
  }
  const mount = compositionElements[0];
  const mountedPath = path.resolve(
    path.dirname(indexFile.path),
    text(mount["data-composition-src"]),
  );
  const duration = Number(durationSeconds);
  const mountStart = finiteHtmlNumber(
    mount["data-start"],
  );
  const mountDuration = finiteHtmlNumber(
    mount["data-duration"],
  );
  if (
    !samePath(mountedPath, captionFile.path) ||
    mountStart === null ||
    mountStart !== 0 ||
    !Number.isFinite(duration) ||
    mountDuration === null ||
    Math.abs(mountDuration - duration) > 0.001
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_mount_binding_invalid",
    );
  }

  const captionHtml = immutableComposition.text;
  const activeElements = activeHtmlElements(captionHtml);
  const captionTemplates = activeElements.filter(
    (element) =>
      element.tag_name === "template" &&
      text(element.attributes.id) === "captions-template",
  );
  if (captionTemplates.length !== 1) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_template_invalid",
    );
  }
  const captionRoots = activeElements.filter(
    (element) =>
      text(element.attributes.id) === "captions-root",
  );
  if (captionRoots.length !== 1) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_root_invalid",
    );
  }
  const rootAttributes = captionRoots[0].attributes;
  const templateAttributes =
    captionTemplates[0].attributes;
  for (const attributes of [
    templateAttributes,
    rootAttributes,
  ]) {
    if (
      finiteHtmlNumber(attributes["data-width"]) !==
        WIDTH ||
      finiteHtmlNumber(attributes["data-height"]) !==
        HEIGHT
    ) {
      throw new GovernedFinalCompositeError(
        "pre_rendered_caption_canvas_mismatch",
      );
    }
  }
  const captionStages = activeElements.filter(
    (element) =>
      text(element.attributes.id) === "caption-stage",
  );
  const stageClasses = text(
    captionStages[0]?.attributes.class,
  ).split(/\s+/);
  if (
    captionStages.length !== 1 ||
    !stageClasses.includes("caption-stage") ||
    Object.prototype.hasOwnProperty.call(
      captionStages[0]?.attributes || {},
      "style",
    )
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_stage_invalid",
    );
  }
  const rootStart = finiteHtmlNumber(
    rootAttributes["data-start"],
  );
  const rootDuration = finiteHtmlNumber(
    rootAttributes["data-duration"],
  );
  if (
    rootStart === null ||
    rootStart !== 0 ||
    rootDuration === null ||
    Math.abs(rootDuration - duration) > 0.001
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_root_timing_invalid",
    );
  }
  const safeZone = preRenderedCaptionSafeZone({
    rootAttributes,
    captionHtml,
  });

  const groups = extractStaticJsonArrayAssignment(
    captionHtml,
    "GROUPS",
  );
  const actualWords = groups.flatMap((group) =>
    Array.isArray(group?.words) ? group.words : [],
  );
  const expectedWords = Array.isArray(
    normalisedTimestamps?.words,
  )
    ? normalisedTimestamps.words
    : [];
  if (
    !actualWords.length ||
    actualWords.length !== expectedWords.length
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_word_count_mismatch",
    );
  }
  for (let index = 0; index < expectedWords.length; index += 1) {
    const actual = actualWords[index];
    const expected = expectedWords[index];
    const actualStart = actual?.start;
    const actualEnd = actual?.end;
    if (
      typeof actualStart !== "number" ||
      typeof actualEnd !== "number" ||
      !Number.isFinite(actualStart) ||
      !Number.isFinite(actualEnd) ||
      actualStart < 0 ||
      actualEnd < actualStart
    ) {
      throw new GovernedFinalCompositeError(
        `pre_rendered_caption_word_${index}_timing_invalid`,
      );
    }
    if (
      text(actual?.text) !== expected.text ||
      Math.abs(actualStart - expected.start_seconds) >
        0.001 ||
      Math.abs(actualEnd - expected.end_seconds) > 0.001
    ) {
      throw new GovernedFinalCompositeError(
        `pre_rendered_caption_word_${index}_mismatch`,
      );
    }
  }
  readBoundPreRenderedProjectFile(
    indexFile,
    "pre_rendered_caption_index",
  );
  readBoundPreRenderedProjectFile(
    captionFile,
    "pre_rendered_caption_composition",
  );
  return {
    verdict: "PASS",
    programme_media_sha256:
      ownedMotion.hyperframesAsset.sha256,
    index_html_sha256: immutableIndex.sha256,
    caption_composition_sha256:
      immutableComposition.sha256,
    source_timestamps_sha256: timestampSource.sha256,
    word_count: expectedWords.length,
    duration_seconds: duration,
    safe_zone: safeZone,
  };
}

function parseFrameRate(value) {
  const raw = text(value);
  if (!raw) return null;
  if (raw.includes("/")) {
    const [numerator, denominator] = raw.split("/").map(Number);
    if (
      Number.isFinite(numerator) &&
      Number.isFinite(denominator) &&
      denominator !== 0
    ) {
      return numerator / denominator;
    }
  }
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function firstStream(probe, type) {
  const streams = Array.isArray(probe?.streams)
    ? probe.streams
    : [];
  return (
    streams.find((stream) => stream?.codec_type === type) ||
    null
  );
}

function inspectHyperframesProbe(
  probe,
  {
    expectedDurationSeconds =
      HYPERFRAMES_DURATION_SECONDS,
  } = {},
) {
  const errors = [];
  const video = firstStream(probe, "video");
  const duration = Number(probe?.format?.duration);
  const expectedDuration = Number(expectedDurationSeconds);
  const frameRate = parseFrameRate(
    video?.avg_frame_rate || video?.r_frame_rate,
  );
  if (!video) errors.push("hyperframes_intermediate_video_missing");
  if (
    Number(video?.width) !== WIDTH ||
    Number(video?.height) !== HEIGHT
  ) {
    errors.push("hyperframes_intermediate_probe_dimensions_invalid");
  }
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(expectedDuration) ||
    expectedDuration <= 0 ||
    Math.abs(duration - expectedDuration) >
      DURATION_TOLERANCE_SECONDS
  ) {
    errors.push("hyperframes_intermediate_probe_duration_invalid");
  }
  if (
    !Number.isFinite(frameRate) ||
    Math.abs(frameRate - FPS) > 0.01
  ) {
    errors.push("hyperframes_intermediate_probe_fps_invalid");
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    width: Number(video.width),
    height: Number(video.height),
    duration_seconds: duration,
    fps: frameRate,
    video_codec: video.codec_name || null,
    video_profile: video.profile || null,
    pixel_format: video.pix_fmt || null,
    has_audio: Boolean(firstStream(probe, "audio")),
  };
}

function inspectNarrationProbe(
  probe,
  {
    maximumDurationSeconds = DURATION_SECONDS,
  } = {},
) {
  const errors = [];
  const audio = firstStream(probe, "audio");
  const duration = Number(probe?.format?.duration);
  const maximumDuration = Number(maximumDurationSeconds);
  if (!audio) errors.push("narration_audio_stream_missing");
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(maximumDuration) ||
    maximumDuration <= 0 ||
    duration <= 0 ||
    duration > maximumDuration + DURATION_TOLERANCE_SECONDS
  ) {
    errors.push("narration_duration_invalid");
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    codec: audio.codec_name || null,
    sample_rate_hz: Number(audio.sample_rate) || null,
    channels: Number(audio.channels) || null,
    duration_seconds: duration,
  };
}

function inspectLicensedAudioProbe(
  probe,
  {
    asset,
    cue = null,
  } = {},
) {
  const audio = firstStream(probe, "audio");
  const video = firstStream(probe, "video");
  const duration = Number(probe?.format?.duration);
  const errors = [];
  if (!audio) errors.push("licensed_audio_stream_missing");
  if (video) errors.push("licensed_audio_video_stream_forbidden");
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 60 * 60
  ) {
    errors.push("licensed_audio_probe_duration_invalid");
  }
  if (
    cue &&
    Number(cue.trim_start_seconds) +
      Number(cue.duration_seconds) >
      duration + DURATION_TOLERANCE_SECONDS
  ) {
    errors.push("licensed_audio_cue_exceeds_source");
  }
  if (!text(asset?.asset_id) || !text(asset?.role)) {
    errors.push("licensed_audio_probe_asset_identity_invalid");
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    asset_id: asset.asset_id,
    role: asset.role,
    codec: audio.codec_name || null,
    sample_rate_hz: Number(audio.sample_rate) || null,
    channels: Number(audio.channels) || null,
    duration_seconds: duration,
  };
}

function fingerprintLicensedAudioValidation(value) {
  if (!value) return null;
  return sha256Bytes(
    Buffer.from(
      JSON.stringify({
        manifest_sha256: value.manifest_sha256,
        rights_ledger_sha256:
          value.rights_ledger?.sha256,
        render_binding: value.render_binding,
        assets: (value.assets || []).map((asset) => ({
          asset_id: asset.asset_id,
          role: asset.role,
          path: asset.path,
          sha256: asset.sha256,
          size_bytes: asset.size_bytes,
        })),
        mix: value.mix,
      }),
      "utf8",
    ),
  );
}

function inspectFinalProbe(
  probe,
  {
    expectedDurationSeconds = DURATION_SECONDS,
  } = {},
) {
  const platformQa = classifyPlatformVideoQa(probe, {
    platform: "youtube_shorts",
  });
  const video = firstStream(probe, "video");
  const audio = firstStream(probe, "audio");
  const frameRate = parseFrameRate(
    video?.avg_frame_rate || video?.r_frame_rate,
  );
  const duration = Number(probe?.format?.duration);
  const expectedDuration = Number(expectedDurationSeconds);
  const errors = [];
  if (platformQa.result !== "pass") {
    errors.push("final_platform_video_qa_failed");
  }
  if (
    Number(video?.width) !== WIDTH ||
    Number(video?.height) !== HEIGHT
  ) {
    errors.push("final_dimensions_must_be_1080x1920");
  }
  if (text(video?.codec_name).toLowerCase() !== "h264") {
    errors.push("final_video_codec_must_be_h264");
  }
  if (!/^high$/i.test(text(video?.profile))) {
    errors.push("final_video_profile_must_be_high");
  }
  if (text(video?.pix_fmt).toLowerCase() !== "yuv420p") {
    errors.push("final_pixel_format_must_be_yuv420p");
  }
  if (
    !Number.isFinite(frameRate) ||
    Math.abs(frameRate - FPS) > 0.01
  ) {
    errors.push("final_fps_must_be_30");
  }
  if (text(audio?.codec_name).toLowerCase() !== "aac") {
    errors.push("final_audio_codec_must_be_aac");
  }
  if (Number(audio?.sample_rate) !== 48000) {
    errors.push("final_audio_sample_rate_must_be_48000");
  }
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(expectedDuration) ||
    expectedDuration <= 0 ||
    Math.abs(duration - expectedDuration) >
      DURATION_TOLERANCE_SECONDS
  ) {
    errors.push(
      expectedDuration === DURATION_SECONDS
        ? "final_duration_must_be_25_seconds"
        : "final_duration_mismatch",
    );
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    probe,
    platformQa,
    technical: {
      ...platformQa.technical,
      fps: frameRate,
    },
  };
}

function defaultProbeMedia({
  filePath,
  ffprobePath = "ffprobe",
  spawnSyncImpl = spawnSync,
} = {}) {
  const result = spawnSyncImpl(
    ffprobePath,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result?.status !== 0) {
    throw new GovernedFinalCompositeError(
      `ffprobe_failed:${text(result?.stderr).slice(0, 240)}`,
    );
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new GovernedFinalCompositeError(
      "ffprobe_output_invalid",
    );
  }
}

function normaliseLoudnessMeasurement(value, prefix = "audio") {
  const measurement = {
    integrated_lufs: Number(value?.integrated_lufs),
    true_peak_dbfs: Number(value?.true_peak_dbfs),
    loudness_range_lu: Number(value?.loudness_range_lu),
    threshold_lufs: Number(value?.threshold_lufs),
    target_offset_lu: Number(value?.target_offset_lu),
  };
  if (
    Object.values(measurement).some(
      (number) => !Number.isFinite(number),
    )
  ) {
    throw new GovernedFinalCompositeError(
      `${prefix}_loudness_measurement_invalid`,
    );
  }
  return measurement;
}

function parseLoudnormOutput(value, prefix = "audio") {
  const blocks = String(value || "").match(/\{[\s\S]*?\}/g) || [];
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(blocks[index]);
      return normaliseLoudnessMeasurement(
        {
          integrated_lufs: parsed.input_i,
          true_peak_dbfs: parsed.input_tp,
          loudness_range_lu: parsed.input_lra,
          threshold_lufs: parsed.input_thresh,
          target_offset_lu: parsed.target_offset,
        },
        prefix,
      );
    } catch (error) {
      if (
        error instanceof GovernedFinalCompositeError &&
        index === 0
      ) {
        throw error;
      }
    }
  }
  throw new GovernedFinalCompositeError(
    `${prefix}_loudness_output_invalid`,
  );
}

function defaultMeasureLoudness({
  filePath,
  ffmpegPath = "ffmpeg",
  spawnSyncImpl = spawnSync,
  prefix = "audio",
} = {}) {
  const result = spawnSyncImpl(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path.resolve(filePath),
      "-vn",
      "-af",
      `loudnorm=I=${TARGET_INTEGRATED_LUFS}:TP=${TARGET_TRUE_PEAK_DBFS}:LRA=${TARGET_LOUDNESS_RANGE_LU}:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result?.status !== 0) {
    throw new GovernedFinalCompositeError(
      `${prefix}_loudness_measurement_failed:${text(
        result?.stderr,
      ).slice(0, 240)}`,
    );
  }
  return parseLoudnormOutput(result.stderr, prefix);
}

function parseTerminalSilenceOutput(
  value,
  {
    durationSeconds,
    thresholdDb = -50,
    minimumDurationSeconds = 0.1,
  } = {},
) {
  const duration = Number(durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new GovernedFinalCompositeError(
      "final_audio_terminal_silence_duration_invalid",
    );
  }
  const events = [];
  const pattern =
    /silence_(start|end):\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/g;
  let match;
  while ((match = pattern.exec(String(value || "")))) {
    events.push({
      type: match[1],
      seconds: Number(match[2]),
    });
  }
  let activeStart = null;
  let terminalStart = null;
  for (const event of events) {
    if (event.type === "start") {
      activeStart = event.seconds;
    } else if (activeStart !== null) {
      if (event.seconds >= duration - 0.05) {
        terminalStart = activeStart;
      }
      activeStart = null;
    }
  }
  if (activeStart !== null) terminalStart = activeStart;
  const terminalSeconds =
    terminalStart === null
      ? 0
      : Math.max(0, duration - terminalStart);
  return {
    threshold_db: Number(thresholdDb),
    minimum_duration_seconds: Number(
      minimumDurationSeconds,
    ),
    terminal_silence_start_seconds:
      terminalStart === null
        ? null
        : Number(terminalStart.toFixed(3)),
    terminal_silence_seconds: Number(
      terminalSeconds.toFixed(3),
    ),
  };
}

function defaultMeasureTerminalSilence({
  filePath,
  durationSeconds,
  ffmpegPath = "ffmpeg",
  spawnSyncImpl = spawnSync,
  thresholdDb = -50,
  minimumDurationSeconds = 0.1,
} = {}) {
  const result = spawnSyncImpl(
    ffmpegPath,
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path.resolve(filePath),
      "-vn",
      "-af",
      `silencedetect=noise=${thresholdDb}dB:d=${minimumDurationSeconds}`,
      "-f",
      "null",
      "-",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result?.status !== 0) {
    throw new GovernedFinalCompositeError(
      `final_audio_terminal_silence_measurement_failed:${text(
        result?.stderr,
      ).slice(0, 240)}`,
    );
  }
  return parseTerminalSilenceOutput(result.stderr, {
    durationSeconds,
    thresholdDb,
    minimumDurationSeconds,
  });
}

function validateFinalAudioMeasurements({
  loudness,
  terminalSilence,
} = {}) {
  const finalLoudness = normaliseLoudnessMeasurement(
    loudness,
    "final_audio",
  );
  const silenceSeconds = Number(
    terminalSilence?.terminal_silence_seconds,
  );
  const errors = [];
  if (
    Math.abs(
      finalLoudness.integrated_lufs -
        TARGET_INTEGRATED_LUFS,
    ) > LOUDNESS_TOLERANCE_LU
  ) {
    errors.push("final_audio_loudness_out_of_range");
  }
  if (
    finalLoudness.true_peak_dbfs >
    TARGET_TRUE_PEAK_DBFS
  ) {
    errors.push("final_audio_true_peak_exceeds_limit");
  }
  if (
    !Number.isFinite(silenceSeconds) ||
    silenceSeconds < 0 ||
    silenceSeconds > MAX_TERMINAL_SILENCE_SECONDS
  ) {
    errors.push("final_audio_terminal_silence_excessive");
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    loudness: finalLoudness,
    terminal_silence: {
      threshold_db: Number(terminalSilence.threshold_db),
      minimum_duration_seconds: Number(
        terminalSilence.minimum_duration_seconds,
      ),
      terminal_silence_start_seconds:
        terminalSilence.terminal_silence_start_seconds === null
          ? null
          : Number(
              terminalSilence.terminal_silence_start_seconds,
            ),
      terminal_silence_seconds: silenceSeconds,
    },
  };
}

function filterNumber(value, digits = 3) {
  return Number(value)
    .toFixed(digits)
    .replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
}

function validateLicensedAudioInvocationPlan(
  licensedAudio,
  durationSeconds,
) {
  if (!licensedAudio) return null;
  const duration = Number(durationSeconds);
  const mix = licensedAudio.mix;
  const assets = Array.isArray(licensedAudio.assets)
    ? licensedAudio.assets
    : [];
  if (
    !mix ||
    mix.narration_included !== false ||
    !Number.isFinite(Number(mix.target_duration_seconds)) ||
    Math.abs(Number(mix.target_duration_seconds) - duration) >
      0.001 ||
    duration <= 0 ||
    duration > MAX_LICENSED_AUDIO_SHORT_DURATION_SECONDS
  ) {
    throw new GovernedFinalCompositeError(
      "licensed_audio_composite_duration_invalid",
    );
  }
  const byId = new Map(
    assets.map((asset) => [text(asset?.asset_id), asset]),
  );
  const bed = byId.get(text(mix?.bed?.asset_id));
  const cues = Array.isArray(mix?.cues) ? mix.cues : [];
  if (
    !bed ||
    text(bed.role).toUpperCase() !== "MUSIC_BED" ||
    !text(bed.path) ||
    cues.length !== assets.length - 1
  ) {
    throw new GovernedFinalCompositeError(
      "licensed_audio_composite_assets_invalid",
    );
  }
  const cueAssets = cues.map((cue) =>
    byId.get(text(cue?.asset_id)),
  );
  if (
    cueAssets.some(
      (asset) =>
        !asset ||
        text(asset.role).toUpperCase() === "MUSIC_BED" ||
        !text(asset.path),
    ) ||
    new Set(cueAssets.map((asset) => asset.asset_id)).size !==
      cueAssets.length
  ) {
    throw new GovernedFinalCompositeError(
      "licensed_audio_composite_cues_invalid",
    );
  }
  return {
    ...licensedAudio,
    assets,
    mix,
    bed,
    cues,
    cueAssets,
  };
}

function buildFfmpegInvocation({
  videoPath,
  audioPath,
  filterPath,
  outputPath,
  durationSeconds = DURATION_SECONDS,
  sourceVideoDurationSeconds = HYPERFRAMES_DURATION_SECONDS,
  sourceLoudness,
  licensedAudio = null,
  preserveRenderedCaptions = false,
  ffmpegPath = "ffmpeg",
} = {}) {
  const duration = Number(durationSeconds);
  const sourceDuration = Number(sourceVideoDurationSeconds);
  const licensedAudioPlan =
    validateLicensedAudioInvocationPlan(
      licensedAudio,
      duration,
    );
  if (
    !Number.isFinite(duration) ||
    (!licensedAudioPlan &&
      !preserveRenderedCaptions &&
      Math.abs(duration - DURATION_SECONDS) >
        DURATION_TOLERANCE_SECONDS)
  ) {
    throw new GovernedFinalCompositeError(
      "composite_duration_must_be_25_seconds",
    );
  }
  if (
    !Number.isFinite(sourceDuration) ||
    Math.abs(
      sourceDuration -
        (licensedAudioPlan || preserveRenderedCaptions
          ? duration
          : HYPERFRAMES_DURATION_SECONDS),
    ) > DURATION_TOLERANCE_SECONDS
  ) {
    throw new GovernedFinalCompositeError(
      licensedAudioPlan || preserveRenderedCaptions
        ? "licensed_audio_composite_source_duration_invalid"
        : "composite_source_duration_must_be_28_seconds",
    );
  }
  const measured = normaliseLoudnessMeasurement(
    sourceLoudness,
    "source_audio",
  );
  const videoTimingRatio = preserveRenderedCaptions
    ? 1
    : Number((duration / sourceDuration).toFixed(12));
  const sourceTailTrimmedSeconds = Number(
    Math.max(0, sourceDuration - duration).toFixed(6),
  );
  const sourceTailPaddedSeconds = Number(
    Math.max(0, duration - sourceDuration).toFixed(6),
  );
  const loudnessFilter = [
    `loudnorm=I=${TARGET_INTEGRATED_LUFS}`,
    `TP=${TARGET_TRUE_PEAK_DBFS}`,
    `LRA=${TARGET_LOUDNESS_RANGE_LU}`,
    `measured_I=${filterNumber(measured.integrated_lufs)}`,
    `measured_TP=${filterNumber(measured.true_peak_dbfs)}`,
    `measured_LRA=${filterNumber(measured.loudness_range_lu)}`,
    `measured_thresh=${filterNumber(measured.threshold_lufs)}`,
    `offset=${filterNumber(measured.target_offset_lu)}`,
    "linear=true",
    "print_format=summary",
  ].join(":");
  const videoFilters = [
    `setpts=${filterNumber(videoTimingRatio, 12)}*PTS`,
    `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
    `crop=${WIDTH}:${HEIGHT}:(iw-${WIDTH})/2:(ih-${HEIGHT})/2`,
    `fps=${FPS}`,
    ...(preserveRenderedCaptions &&
    sourceTailPaddedSeconds > 0
      ? [
          `tpad=stop_mode=clone:stop_duration=${filterNumber(
            sourceTailPaddedSeconds,
          )}`,
        ]
      : []),
    `trim=duration=${duration}`,
    "format=yuv420p",
  ];
  const filterParts = [
    `[0:v:0]${videoFilters.join(",")}[base]`,
    preserveRenderedCaptions
      ? `[base]trim=duration=${duration},setpts=PTS-STARTPTS[outv]`
      : `[base]ass=captions.ass,trim=duration=${duration},setpts=PTS-STARTPTS[outv]`,
  ];
  if (!licensedAudioPlan) {
    filterParts.push(
      `[1:a:0]${loudnessFilter},aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[outa]`,
    );
  } else {
    filterParts.push(
      `[1:a:0]${loudnessFilter},aresample=48000,apad=whole_dur=${duration},atrim=duration=${duration},asetpts=PTS-STARTPTS[a_voice_pre]`,
      "[a_voice_pre]asplit=2[a_voice][a_voice_music_sc]",
    );
    const bedIndex =
      2 +
      licensedAudioPlan.assets.findIndex(
        (asset) =>
          asset.asset_id ===
          licensedAudioPlan.bed.asset_id,
      );
    const bedMix = licensedAudioPlan.mix.bed;
    const bedFilters = [
      `volume=${filterNumber(bedMix.raw_volume)}`,
      `atrim=start=${filterNumber(
        bedMix.trim_start_seconds,
      )}:duration=${duration}`,
      "asetpts=PTS-STARTPTS",
    ];
    if (bedMix.fade_in_seconds > 0) {
      bedFilters.push(
        `afade=t=in:st=0:d=${filterNumber(
          bedMix.fade_in_seconds,
        )}`,
      );
    }
    if (bedMix.fade_out_seconds > 0) {
      bedFilters.push(
        `afade=t=out:st=${filterNumber(
          duration - bedMix.fade_out_seconds,
        )}:d=${filterNumber(bedMix.fade_out_seconds)}`,
      );
    }
    bedFilters.push(
      `apad=whole_dur=${duration}`,
      `atrim=duration=${duration}`,
    );
    filterParts.push(
      `[${bedIndex}:a:0]${bedFilters.join(",")}[a_music_raw]`,
      `[a_music_raw][a_voice_music_sc]sidechaincompress=threshold=${filterNumber(
        bedMix.sidechain.threshold,
      )}:ratio=${filterNumber(
        bedMix.sidechain.ratio,
      )}:attack=${filterNumber(
        bedMix.sidechain.attack_ms,
      )}:release=${filterNumber(
        bedMix.sidechain.release_ms,
      )}:knee=3:level_sc=1,volume=${filterNumber(
        bedMix.ducked_output_volume,
      )}[a_music_ducked]`,
    );
    let previousMusicLabel = "a_music_ducked";
    for (const [index, window] of (
      licensedAudioPlan.mix.micro_drop_windows || []
    ).entries()) {
      const nextLabel = `a_music_drop_${index}`;
      filterParts.push(
        `[${previousMusicLabel}]volume=${filterNumber(
          window.multiplier,
        )}:enable='between(t,${filterNumber(
          window.start_seconds,
        )},${filterNumber(
          window.end_seconds,
        )})'[${nextLabel}]`,
      );
      previousMusicLabel = nextLabel;
    }
    filterParts.push(
      `[${previousMusicLabel}]anull[a_music]`,
    );

    const cueLabels = [];
    for (const [index, cue] of licensedAudioPlan.cues.entries()) {
      const assetIndex =
        2 +
        licensedAudioPlan.assets.findIndex(
          (asset) => asset.asset_id === cue.asset_id,
        );
      const label = `a_cue_${index}`;
      cueLabels.push(label);
      const cueFilters = [
        `atrim=start=${filterNumber(
          cue.trim_start_seconds,
        )}:duration=${filterNumber(cue.duration_seconds)}`,
        "asetpts=PTS-STARTPTS",
        `volume=${filterNumber(cue.volume)}`,
      ];
      if (cue.fade_in_seconds > 0) {
        cueFilters.push(
          `afade=t=in:st=0:d=${filterNumber(
            cue.fade_in_seconds,
          )}`,
        );
      }
      if (cue.fade_out_seconds > 0) {
        cueFilters.push(
          `afade=t=out:st=${filterNumber(
            cue.duration_seconds -
              cue.fade_out_seconds,
          )}:d=${filterNumber(cue.fade_out_seconds)}`,
        );
      }
      const delayMs = Math.round(cue.at_seconds * 1_000);
      cueFilters.push(
        `adelay=${delayMs}|${delayMs}`,
        `apad=whole_dur=${duration}`,
        `atrim=duration=${duration}`,
      );
      filterParts.push(
        `[${assetIndex}:a:0]${cueFilters.join(",")}[${label}]`,
      );
    }
    const mixLabels = [
      "a_voice",
      "a_music",
      ...cueLabels,
    ];
    filterParts.push(
      `${mixLabels
        .map((label) => `[${label}]`)
        .join("")}amix=inputs=${mixLabels.length}:duration=first:dropout_transition=0:normalize=0,loudnorm=I=${TARGET_INTEGRATED_LUFS}:TP=${TARGET_TRUE_PEAK_DBFS}:LRA=${TARGET_LOUDNESS_RANGE_LU},alimiter=limit=0.84:level=disabled,aresample=48000,atrim=duration=${duration}[outa]`,
    );
  }
  const filter = filterParts.join(";\n");
  const mediaInputArgs = [
    "-i",
    path.resolve(videoPath),
    "-i",
    path.resolve(audioPath),
  ];
  if (licensedAudioPlan) {
    for (const asset of licensedAudioPlan.assets) {
      if (text(asset.role).toUpperCase() === "MUSIC_BED") {
        mediaInputArgs.push("-stream_loop", "-1");
      }
      mediaInputArgs.push("-i", path.resolve(asset.path));
    }
  }
  return {
    command: ffmpegPath,
    args: [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      ...mediaInputArgs,
      "-filter_complex_script",
      path.resolve(filterPath),
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-profile:v",
      "high",
      "-level:v",
      "4.0",
      "-r",
      String(FPS),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-t",
      String(duration),
      "-movflags",
      "+faststart",
      path.resolve(outputPath),
    ],
    cwd: path.dirname(path.resolve(filterPath)),
    filter,
    outputPath: path.resolve(outputPath),
    audio_normalisation: {
      target_integrated_lufs: TARGET_INTEGRATED_LUFS,
      target_true_peak_dbfs: TARGET_TRUE_PEAK_DBFS,
      target_loudness_range_lu:
        TARGET_LOUDNESS_RANGE_LU,
      source_measurement: measured,
      mode: "two_pass_linear_loudnorm",
      final_mix_normalised: Boolean(licensedAudioPlan),
    },
    visual_timing: {
      source_duration_seconds: sourceDuration,
      final_duration_seconds: duration,
      setpts_ratio: videoTimingRatio,
      playback_rate: preserveRenderedCaptions
        ? 1
        : Number((sourceDuration / duration).toFixed(6)),
      full_source_sequence_preserved:
        !preserveRenderedCaptions ||
        sourceTailTrimmedSeconds === 0,
      source_tail_trimmed_seconds:
        preserveRenderedCaptions
          ? sourceTailTrimmedSeconds
          : 0,
      source_tail_padded_seconds:
        preserveRenderedCaptions
          ? sourceTailPaddedSeconds
          : 0,
    },
    captions: {
      mode: preserveRenderedCaptions
        ? "PRE_RENDERED"
        : "FINAL_COMPOSITE_ASS",
      final_burn_in_performed: !preserveRenderedCaptions,
    },
    ...(licensedAudioPlan
      ? {
          licensed_audio: {
            manifest_path: licensedAudioPlan.manifest_path,
            manifest_sha256:
              licensedAudioPlan.manifest_sha256,
            asset_count: licensedAudioPlan.assets.length,
            asset_ids: licensedAudioPlan.assets.map(
              (asset) => asset.asset_id,
            ),
            mix_policy:
              licensedAudioPlan.mix.policy_version,
          },
        }
      : {}),
  };
}

function defaultRenderComposite(
  invocation,
  {
    spawnSyncImpl = spawnSync,
    timeoutMs = 600000,
  } = {},
) {
  const result = spawnSyncImpl(
    invocation.command,
    invocation.args,
    {
      cwd: invocation.cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result?.status !== 0) {
    throw new GovernedFinalCompositeError(
      `final_composite_ffmpeg_failed:${text(result?.stderr).slice(0, 400)}`,
    );
  }
  if (
    !fs.existsSync(invocation.outputPath) ||
    fs.statSync(invocation.outputPath).size <= 0
  ) {
    throw new GovernedFinalCompositeError(
      "final_composite_output_missing",
    );
  }
}

async function writeAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(temporary, value);
  await fsp.rename(temporary, filePath);
}

async function writeJsonAtomic(filePath, value) {
  await writeAtomic(
    filePath,
    Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
  );
}

function validateStoryIntake(storyIntakePath) {
  const bound = readJsonFile(
    storyIntakePath,
    "story_intake_invalid_json",
  );
  const intake = bound.value;
  const errors = [];
  if (intake?.schema_version !== STORY_INTAKE_SCHEMA) {
    errors.push("story_intake_schema_invalid");
  }
  const storyId = text(intake?.story?.id);
  let safeId = null;
  try {
    safeId = safeStoryId(storyId);
  } catch (error) {
    errors.push(...(error.codes || ["story_id_invalid"]));
  }
  const fullScript = compactTranscript(
    intake?.story?.full_script,
  );
  const declaredScriptSha = text(
    intake?.story?.script_sha256,
  ).toLowerCase();
  const calculatedScriptSha = scriptSha256(fullScript);
  if (!fullScript) errors.push("story_script_required");
  if (
    !SHA256_PATTERN.test(declaredScriptSha) ||
    declaredScriptSha !== calculatedScriptSha
  ) {
    errors.push("story_script_sha256_mismatch");
  }
  const durationBandId = text(
    intake?.contract?.duration_band_id,
  );
  const declaredTarget =
    intake?.contract?.target_duration_seconds;
  const hasDeclaredTarget =
    declaredTarget !== undefined &&
    declaredTarget !== null &&
    text(declaredTarget) !== "";
  let targetDurationSeconds = null;
  if (hasDeclaredTarget) {
    targetDurationSeconds = Number(declaredTarget);
    let durationBand = null;
    try {
      durationBand = getDurationBand(durationBandId);
    } catch {
      errors.push("story_duration_band_invalid");
    }
    if (
      !Number.isFinite(targetDurationSeconds) ||
      targetDurationSeconds <= 0 ||
      targetDurationSeconds >
        MAX_LICENSED_AUDIO_SHORT_DURATION_SECONDS ||
      !durationBand ||
      targetDurationSeconds < durationBand.min_seconds ||
      targetDurationSeconds > durationBand.max_seconds
    ) {
      errors.push(
        "story_target_duration_outside_named_band",
      );
    }
  }
  if (errors.length) {
    throw new GovernedFinalCompositeError(errors);
  }
  return {
    intake,
    path: bound.path,
    sha256: bound.sha256,
    storyId: safeId,
    fullScript,
    scriptSha256: calculatedScriptSha,
    channelId: text(intake?.story?.channel_id) || "pulse-gaming",
    durationBandId: durationBandId || null,
    targetDurationSeconds,
  };
}

function buildRendererInputs({
  outputRoot,
  hyperframesRecord,
  sourceMedia,
  narrationRecord,
  wordTimestampsRecord,
  licensedAudio,
} = {}) {
  return [
    {
      component_id: "hyperframes-intermediate",
      role: "motion",
      path: normalisePathForRecord(
        outputRoot,
        hyperframesRecord.path,
      ),
      sha256: hyperframesRecord.sha256,
      embedded_in_final: true,
    },
    ...(sourceMedia
      ? sourceMedia.components.map((component) => ({
          component_id: component.component_id,
          role: "source_media",
          path: normalisePathForRecord(
            outputRoot,
            component.asset.path,
          ),
          sha256: component.asset.sha256,
          embedded_in_final: true,
        }))
      : []),
    {
      component_id: "narration",
      role: "narration",
      path: normalisePathForRecord(
        outputRoot,
        narrationRecord.path,
      ),
      sha256: narrationRecord.sha256,
      embedded_in_final: true,
    },
    ...(licensedAudio
      ? licensedAudio.assets.map((asset) => ({
          component_id: asset.asset_id,
          role:
            asset.role === "MUSIC_BED"
              ? "music"
              : "sfx",
          path: normalisePathForRecord(
            outputRoot,
            asset.path,
          ),
          sha256: asset.sha256,
          embedded_in_final: true,
        }))
      : []),
    {
      component_id: "word-timestamps",
      role: "word_timestamps",
      path: normalisePathForRecord(
        outputRoot,
        wordTimestampsRecord.path,
      ),
      sha256: wordTimestampsRecord.sha256,
      embedded_in_final: false,
    },
  ];
}

function deriveRendererEvidence(ownedMotion, sourceMedia = null) {
  const stillCount = ownedMotion.assets.filter(
    (asset) => asset.media_type === "image",
  ).length;
  const sourceVideoCount = sourceMedia
    ? sourceMedia.components.filter(
        (component) => component.media_type === "VIDEO",
      ).length
    : 0;
  const sourceImageCount = sourceMedia
    ? sourceMedia.components.filter(
        (component) => component.media_type === "IMAGE",
      ).length
    : 0;
  const sourceMediaCount = sourceVideoCount + sourceImageCount;
  const sceneCount = Math.max(
    1,
    stillCount + sourceMediaCount,
  );
  const firstRole = ownedMotion.assets.find(
    (asset) => asset.role === "hook_slam",
  );
  return {
    timing: {
      first_frame_exact_subject: Boolean(
        firstRole || ownedMotion.backboneAsset,
      ),
      hook_visible_by_ms: 0,
      consequence_by_ms: 0,
      proof_by_ms: 0,
    },
    motion: {
      scene_count: sceneCount,
      motion_scene_count: sceneCount,
      exact_subject_clip_count: sourceMedia
        ? sourceVideoCount
        : 1,
      exact_subject_still_motion_count:
        stillCount + sourceImageCount,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
      ...(sourceMedia
        ? {
            licensed_source_media_count: sourceMediaCount,
            licensed_source_video_count: sourceVideoCount,
            licensed_source_image_count: sourceImageCount,
          }
        : {}),
    },
    basis: {
      timing:
        "The hash-bound owned hook frame/backbone is visible from the first frame; final human visual review remains required.",
      motion:
        sourceMedia
          ? "The combined motion manifest binds the mixed HyperFrames intermediate to its owned backbone, exact licensed source-media components and hash-bound project files."
          : "The combined owned-motion manifest binds the HyperFrames intermediate to its owned backbone and exact project files.",
    },
  };
}

function buildSourceMediaEvidence({
  outputRoot,
  sourceMedia,
  sourceMediaPolicy,
} = {}) {
  if (!sourceMedia) return null;
  return {
    policy: sourceMediaPolicy,
    manifest: {
      path: normalisePathForRecord(
        outputRoot,
        sourceMedia.manifest_path,
      ),
      sha256: sourceMedia.manifest_sha256,
    },
    rights_review: {
      path: normalisePathForRecord(
        outputRoot,
        sourceMedia.rights_review.path,
      ),
      sha256: sourceMedia.rights_review.sha256,
      review_status:
        sourceMedia.rights_review.review_status,
      rights_basis:
        sourceMedia.rights_review.evidence.rights_basis,
      publisher:
        sourceMedia.rights_review.evidence.publisher,
      licence_evidence_url:
        sourceMedia.rights_review.evidence
          .licence_evidence_url,
    },
    components: sourceMedia.components.map((component) => ({
      component_id: component.component_id,
      media_type: component.media_type,
      path: normalisePathForRecord(
        outputRoot,
        component.asset.path,
      ),
      sha256: component.asset.sha256,
      size_bytes: component.asset.size_bytes,
      source: component.source,
      rights_basis: component.rights_basis,
      licence_evidence_url: component.licence_evidence_url,
      review_status: component.review_status,
      attribution: component.attribution,
      editorial: component.editorial,
    })),
  };
}

function buildLicensedAudioEvidence({
  outputRoot,
  licensedAudio,
  probes,
} = {}) {
  if (!licensedAudio) return null;
  const probeByAssetId = new Map(
    (probes || []).map((probe) => [probe.asset_id, probe]),
  );
  return {
    policy: licensedAudio.policy,
    manifest: {
      path: normalisePathForRecord(
        outputRoot,
        licensedAudio.manifest_path,
      ),
      sha256: licensedAudio.manifest_sha256,
    },
    rights_ledger: {
      path: normalisePathForRecord(
        outputRoot,
        licensedAudio.rights_ledger.path,
      ),
      sha256: licensedAudio.rights_ledger.sha256,
    },
    provider: licensedAudio.provider,
    scope: licensedAudio.scope,
    render_binding: licensedAudio.render_binding,
    mix: licensedAudio.mix,
    assets: licensedAudio.assets.map((asset) => ({
      asset_id: asset.asset_id,
      source_role: asset.role,
      renderer_role:
        asset.role === "MUSIC_BED" ? "music" : "sfx",
      path: normalisePathForRecord(outputRoot, asset.path),
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      provider_asset_reference:
        asset.provider_asset_reference,
      rights_record_sha256:
        asset.rights_record_sha256,
      rights_evidence: {
        path: normalisePathForRecord(
          outputRoot,
          asset.rights_evidence_path,
        ),
        sha256: asset.rights_evidence_sha256,
      },
      probe: probeByAssetId.get(asset.asset_id) || null,
      embedded_in_final: true,
    })),
  };
}

function renderCompositeMarkdown(manifest) {
  return [
    "# Governed final composite",
    "",
    `- Story: ${manifest.story_id}`,
    `- Generated: ${manifest.generated_at}`,
    `- Mode: ${manifest.mode}`,
    `- Verdict: ${manifest.verdict}`,
    `- Renderer identity: ${manifest.renderer_identity}`,
    `- HyperFrames material stage: ${manifest.hyperframes.material_stage ? "yes" : "no"}`,
    `- FFmpeg final composite: ${manifest.ffmpeg.final_composite ? "yes" : "no"}`,
    `- Duration: ${manifest.output.duration_seconds}s`,
    `- Output SHA-256: ${manifest.output.sha256}`,
    `- Background music: ${manifest.ffmpeg.background_music_used ? "governed licensed bed" : "none"}`,
    `- Sound effects: ${manifest.ffmpeg.sound_effects_used ? "governed licensed cues" : "none"}`,
    "- Database mutation: none",
    "- OAuth or token mutation: none",
    "- External calls: none",
    "- Publication performed: no",
    "- Human visual review remains required.",
    "",
  ].join("\n");
}

async function materialiseGovernedFinalCompositeToStage(
  options = {},
  dependencies = {},
) {
  const generatedAt = text(
    options.generatedAt || new Date().toISOString(),
  );
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new GovernedFinalCompositeError(
      "generated_at_invalid",
    );
  }
  if (!options.outDir) {
    throw new GovernedFinalCompositeError(
      "explicit_output_dir_required",
    );
  }

  const story = validateStoryIntake(options.storyIntakePath);
  const preserveRenderedCaptions =
    options.preserveRenderedCaptions === true;
  const sourceMediaPolicy = text(
    story.intake?.story?.visual_brief
      ?.source_media_policy,
  ).toUpperCase();
  const sourceMedia = validateOptionalGovernedSourceMedia({
    manifestPath: options.sourceMediaManifestPath,
    expectedManifestSha256:
      options.expectedSourceMediaManifestSha256,
    storyId: story.storyId,
    sourceMediaPolicy,
    validationBoundaryAt: generatedAt,
  });
  const licensedAudioOptionValues = [
    options.licensedAudioPackPath,
    options.expectedLicensedAudioPackSha256,
    options.expectedLicensedAudioRightsLedgerSha256,
    options.expectedYoutubeAccountUri,
  ];
  const hasLicensedAudio = licensedAudioOptionValues.some(
    (value) => Boolean(text(value)),
  );
  if (
    hasLicensedAudio &&
    licensedAudioOptionValues.some(
      (value) => !Boolean(text(value)),
    )
  ) {
    throw new GovernedFinalCompositeError(
      "licensed_audio_option_group_incomplete",
    );
  }
  if (
    hasLicensedAudio &&
    !Number.isFinite(story.targetDurationSeconds)
  ) {
    throw new GovernedFinalCompositeError(
      "licensed_audio_story_target_duration_required",
    );
  }
  if (
    preserveRenderedCaptions &&
    !Number.isFinite(story.targetDurationSeconds)
  ) {
    throw new GovernedFinalCompositeError(
      "pre_rendered_caption_target_duration_required",
    );
  }
  const narration = assertFile(
    options.audioPath,
    "narration_audio_missing",
  );
  const suppliedTimestamps = assertFile(
    options.timestampsPath,
    "narration_timestamps_missing",
  );
  const finalDurationSeconds =
    hasLicensedAudio || preserveRenderedCaptions
    ? story.targetDurationSeconds
    : DURATION_SECONDS;
  const sourceVisualDurationSeconds =
    hasLicensedAudio || preserveRenderedCaptions
    ? story.targetDurationSeconds
    : HYPERFRAMES_DURATION_SECONDS;
  const validateLicensedAudioPack =
    dependencies.validateLicensedAudioPack ||
    validateGovernedLicensedAudioPack;
  const licensedAudioValidationArgs = hasLicensedAudio
    ? {
        manifestPath: options.licensedAudioPackPath,
        expectedManifestSha256:
          options.expectedLicensedAudioPackSha256,
        expectedStoryId: story.storyId,
        expectedChannelId: story.channelId,
        expectedNarrationSha256: narration.sha256,
        expectedTimestampsSha256:
          suppliedTimestamps.sha256,
        expectedTargetDurationSeconds:
          finalDurationSeconds,
        expectedRightsLedgerSha256:
          options.expectedLicensedAudioRightsLedgerSha256,
        expectedYoutubeAccountUri:
          options.expectedYoutubeAccountUri,
        requiredDestination: "YOUTUBE_SHORTS",
        requiredRevenueMode: "PLATFORM_ADVERTISING",
        validationBoundaryAt: generatedAt,
      }
    : null;
  const licensedAudio = hasLicensedAudio
    ? validateLicensedAudioPack(
        licensedAudioValidationArgs,
      )
    : null;
  const licensedAudioFingerprint =
    fingerprintLicensedAudioValidation(licensedAudio);
  const outputRoot = options.outputRootOverride
    ? path.resolve(options.outputRootOverride)
    : path.join(path.resolve(options.outDir), story.storyId);
  await fsp.mkdir(outputRoot, { recursive: true });
  const probe =
    dependencies.probeMedia ||
    ((filePath) =>
      defaultProbeMedia({
        filePath,
        ffprobePath: options.ffprobePath || "ffprobe",
        spawnSyncImpl: dependencies.spawnSyncImpl || spawnSync,
      }));
  const requestedHyperframesVideo = assertFile(
    options.videoPath,
    "hyperframes_intermediate_missing",
  );
  const hyperframesProbe = inspectHyperframesProbe(
    await probe(requestedHyperframesVideo.path),
    {
      expectedDurationSeconds:
        sourceVisualDurationSeconds,
    },
  );
  const licensedAudioProbes = [];
  if (licensedAudio) {
    const cueByAssetId = new Map(
      licensedAudio.mix.cues.map((cue) => [
        cue.asset_id,
        cue,
      ]),
    );
    for (const asset of licensedAudio.assets) {
      licensedAudioProbes.push(
        inspectLicensedAudioProbe(
          await probe(asset.path),
          {
            asset,
            cue: cueByAssetId.get(asset.asset_id) || null,
          },
        ),
      );
      const postProbe = assertFile(
        asset.path,
        "licensed_audio_asset_missing_after_probe",
      );
      if (
        postProbe.sha256 !== asset.sha256 ||
        postProbe.size_bytes !== asset.size_bytes
      ) {
        throw new GovernedFinalCompositeError(
          "licensed_audio_asset_changed_during_probe",
        );
      }
    }
  }
  const suppliedManifest = readJsonFile(
    options.ownedMotionManifestPath,
    "owned_motion_manifest_invalid_json",
  );
  const suppliedManifestDir = path.dirname(suppliedManifest.path);
  const bindsRequestedHyperframesVideo = (
    Array.isArray(suppliedManifest.value?.assets)
      ? suppliedManifest.value.assets
      : []
  ).some(
    (asset) =>
      text(asset?.role).toLowerCase() ===
        "hyperframes_intermediate" &&
      asset?.path &&
      samePath(
        path.resolve(suppliedManifestDir, asset.path),
        requestedHyperframesVideo.path,
      ),
  );
  let combinedManifest = {
    derived: false,
    path: suppliedManifest.path,
    sha256: suppliedManifest.sha256,
  };
  if (!bindsRequestedHyperframesVideo) {
    combinedManifest =
      await deriveCombinedOwnedMotionManifest({
        sourceManifestPath: suppliedManifest.path,
        storyId: story.storyId,
        hyperframesVideoPath: requestedHyperframesVideo.path,
        hyperframesProbe,
        projectFilePaths: options.hyperframesProjectFiles,
        outputPath: path.join(
          outputRoot,
          "combined-owned-motion-manifest.json",
        ),
        generatedAt,
        generatorIdentity:
          options.hyperframesGeneratorIdentity ||
          "hyperframes@0.7.76",
        sourceCommit: options.hyperframesSourceCommit,
        sourceMediaManifestPath:
          options.sourceMediaManifestPath,
        expectedSourceMediaManifestSha256:
          options.expectedSourceMediaManifestSha256,
        sourceMediaPolicy,
        expectedDurationSeconds:
          sourceVisualDurationSeconds,
      });
  }
  const ownedMotion = validateCombinedOwnedMotionManifest({
    manifestPath: combinedManifest.path,
    storyId: story.storyId,
    hyperframesVideoPath: requestedHyperframesVideo.path,
    sourceMediaManifestPath:
      options.sourceMediaManifestPath,
    expectedSourceMediaManifestSha256:
      options.expectedSourceMediaManifestSha256,
    sourceMediaPolicy,
    validationBoundaryAt: generatedAt,
    expectedDurationSeconds:
      sourceVisualDurationSeconds,
  });
  const narrationProbe = inspectNarrationProbe(
    await probe(narration.path),
    {
      maximumDurationSeconds:
        finalDurationSeconds,
    },
  );
  const governedNarration = validateGovernedNarrationManifest({
    manifestPath: options.narrationManifestPath,
    expectedManifestSha256:
      options.expectedNarrationManifestSha256,
    storyId: story.storyId,
    scriptSha256: story.scriptSha256,
    audioPath: narration.path,
    timestampsPath: options.timestampsPath,
    audioDurationSeconds: narrationProbe.duration_seconds,
    finalTargetSeconds: sourceVisualDurationSeconds,
  });
  const timestampSource = governedNarration.timestamps;
  const measureLoudness =
    dependencies.measureLoudness ||
    ((filePath, prefix) =>
      defaultMeasureLoudness({
        filePath,
        prefix,
        ffmpegPath: options.ffmpegPath || "ffmpeg",
        spawnSyncImpl: dependencies.spawnSyncImpl || spawnSync,
      }));
  const sourceLoudness = normaliseLoudnessMeasurement(
    await measureLoudness(narration.path, "source_audio"),
    "source_audio",
  );

  const normalisedTimestamps = normaliseWordTimestamps({
    storyId: story.storyId,
    timestamps: timestampSource.value,
    expectedScript: story.fullScript,
    expectedScriptSha256: story.scriptSha256,
    expectedAudioSha256: narration.sha256,
  });
  const preRenderedCaptionBinding = preserveRenderedCaptions
    ? validatePreRenderedCaptionProgramme({
        ownedMotion,
        normalisedTimestamps,
        timestampSource,
        durationSeconds: finalDurationSeconds,
      })
    : null;
  const lastWord = normalisedTimestamps.words.at(-1);
  if (
    Number(lastWord.end_seconds) >
    narrationProbe.duration_seconds + 0.15
  ) {
    throw new GovernedFinalCompositeError(
      "timestamp_timeline_exceeds_narration",
    );
  }
  const captionsPath = path.join(outputRoot, "captions.ass");
  const wordTimestampsPath = path.join(
    outputRoot,
    "word-timestamps.json",
  );
  const filterPath = path.join(
    outputRoot,
    "filter-complex.txt",
  );
  const finalMp4Path = path.join(
    outputRoot,
    `${story.storyId}_studio-v21.mp4`,
  );
  const rendererManifestPath = path.join(
    outputRoot,
    "renderer-manifest.json",
  );
  const qaReportPath = path.join(
    outputRoot,
    "final-render-qa.json",
  );
  const compositeManifestPath = path.join(
    outputRoot,
    "final-composite-manifest.json",
  );
  const markdownPath = path.join(
    outputRoot,
    "final-composite.md",
  );

  const normalisedTimestampPayload = {
    ...normalisedTimestamps,
    source: {
      path: normalisePathForRecord(
        outputRoot,
        timestampSource.path,
      ),
      sha256: timestampSource.sha256,
    },
  };
  await writeJsonAtomic(
    wordTimestampsPath,
    normalisedTimestampPayload,
  );
  const wordTimestampsRecord = assertFile(
    wordTimestampsPath,
    "word_timestamps_output_missing",
  );

  const captionWords = normalisedTimestamps.words.map((word) => ({
    word: word.text,
    start: word.start_seconds,
    end: word.end_seconds,
  }));
  const palette = Array.isArray(
    story.intake?.story?.visual_brief?.palette,
  )
    ? story.intake.story.visual_brief.palette
    : [];
  const emphasisHex =
    palette.find((colour) => /^#ff6b1a$/i.test(text(colour))) ||
    "#FF6B1A";
  const captionLayout = getAssCaptionSafeZoneContract(
    CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  );
  const ass = buildKineticAss({
    story: story.intake.story,
    words: captionWords,
    duration: narrationProbe.duration_seconds,
    scriptText: story.fullScript,
    emphasisHex,
    realign: true,
    maxWordsPerPhrase: captionLayout.max_words_per_phrase,
    maxPhraseChars: captionLayout.max_phrase_chars,
    captionCase: "upper",
    captionLayout,
  });
  const dialogueCount = (ass.match(/^Dialogue:/gm) || []).length;
  if (!dialogueCount) {
    throw new GovernedFinalCompositeError(
      "captions_dialogue_required",
    );
  }
  let captionSafeZone;
  try {
    captionSafeZone =
      preRenderedCaptionBinding?.safe_zone ||
      validateAssCaptionSafeZone({
        ass,
        profileId: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
      });
  } catch (error) {
    throw new GovernedFinalCompositeError(
      Array.isArray(error?.codes)
        ? error.codes
        : ["captions_safe_zone_validation_failed"],
    );
  }
  await writeAtomic(captionsPath, Buffer.from(ass, "utf8"));

  const renderLicensedAudio = licensedAudio
    ? validateLicensedAudioPack(
        licensedAudioValidationArgs,
      )
    : null;
  if (
    fingerprintLicensedAudioValidation(
      renderLicensedAudio,
    ) !== licensedAudioFingerprint
  ) {
    throw new GovernedFinalCompositeError(
      "licensed_audio_validation_changed_before_render",
    );
  }
  const invocation = buildFfmpegInvocation({
    videoPath: ownedMotion.hyperframesAsset.path,
    audioPath: narration.path,
    filterPath,
    outputPath: finalMp4Path,
    durationSeconds: finalDurationSeconds,
    sourceVideoDurationSeconds:
      hyperframesProbe.duration_seconds,
    sourceLoudness,
    licensedAudio: renderLicensedAudio,
    preserveRenderedCaptions,
    ffmpegPath: options.ffmpegPath || "ffmpeg",
  });
  await writeAtomic(
    filterPath,
    Buffer.from(`${invocation.filter}\n`, "utf8"),
  );
  const render =
    dependencies.renderComposite ||
    ((value) =>
      defaultRenderComposite(value, {
        spawnSyncImpl: dependencies.spawnSyncImpl || spawnSync,
        timeoutMs: options.renderTimeoutMs,
      }));
  await render(invocation);
  const finalMp4 = assertFile(
    finalMp4Path,
    "final_composite_output_missing",
  );
  const finalProbe = inspectFinalProbe(
    await probe(finalMp4.path),
    {
      expectedDurationSeconds:
        finalDurationSeconds,
    },
  );
  const finalLoudness = normaliseLoudnessMeasurement(
    await measureLoudness(finalMp4.path, "final_audio"),
    "final_audio",
  );
  const measureTerminalSilence =
    dependencies.measureTerminalSilence ||
    ((filePath, durationSeconds) =>
      defaultMeasureTerminalSilence({
        filePath,
        durationSeconds,
        ffmpegPath: options.ffmpegPath || "ffmpeg",
        spawnSyncImpl: dependencies.spawnSyncImpl || spawnSync,
      }));
  const terminalSilence = await measureTerminalSilence(
    finalMp4.path,
    finalProbe.technical.duration_seconds,
  );
  const finalAudioQa = validateFinalAudioMeasurements({
    loudness: finalLoudness,
    terminalSilence,
  });

  const rendererInputs = buildRendererInputs({
    outputRoot,
    hyperframesRecord: ownedMotion.hyperframesAsset,
    sourceMedia,
    narrationRecord: narration,
    wordTimestampsRecord,
    licensedAudio: renderLicensedAudio,
  });
  const rendererEvidence = deriveRendererEvidence(
    ownedMotion,
    sourceMedia,
  );
  const sourceMediaEvidence = buildSourceMediaEvidence({
    outputRoot,
    sourceMedia,
    sourceMediaPolicy,
  });
  const licensedAudioEvidence = buildLicensedAudioEvidence({
    outputRoot,
    licensedAudio: renderLicensedAudio,
    probes: licensedAudioProbes,
  });
  const rendererManifest = {
    ...buildStandardRendererManifest({
      story: {
        id: story.storyId,
        channel_id: story.channelId,
      },
      rendererVersion: RENDERER_VERSION,
      mediaSha256: finalMp4.sha256,
      platformVideoQa: finalProbe.platformQa,
      stack: {
        hyperframes: true,
        ffmpeg: true,
      },
      timing: rendererEvidence.timing,
      motion: rendererEvidence.motion,
    }),
    inputs: rendererInputs,
  };
  if (rendererManifest.schema_version !== RENDERER_MANIFEST_SCHEMA) {
    throw new GovernedFinalCompositeError(
      "renderer_manifest_schema_invalid",
    );
  }
  const rendererManifestSha256 =
    fingerprintRendererManifest(rendererManifest);
  const rendererEvaluation = evaluateRendererManifest(
    rendererManifest,
    { operatingMode: "LOCAL_PROOF" },
  );
  if (rendererEvaluation.verdict !== "PASS") {
    throw new GovernedFinalCompositeError([
      ...rendererEvaluation.blockers,
      "renderer_manifest_local_proof_failed",
    ]);
  }
  await writeJsonAtomic(rendererManifestPath, rendererManifest);
  const rendererManifestFileSha256 =
    hashFile(rendererManifestPath);

  const qaReport = {
    schema_version: QA_SCHEMA,
    generated_at: generatedAt,
    story_id: story.storyId,
    channel_id: story.channelId,
    verdict: "PASS",
    media_sha256: finalMp4.sha256,
    script_sha256: story.scriptSha256,
    renderer_manifest_sha256: rendererManifestSha256,
    platform_video_qa: finalProbe.platformQa,
    technical: finalProbe.technical,
    captions: {
      mode: preserveRenderedCaptions
        ? "PRE_RENDERED"
        : "FINAL_COMPOSITE_ASS",
      final_burn_in_performed: !preserveRenderedCaptions,
      visual_review_required: preserveRenderedCaptions,
      source_video_sha256: requestedHyperframesVideo.sha256,
      ...(preRenderedCaptionBinding
        ? {
            programme_binding:
              preRenderedCaptionBinding,
          }
        : {}),
      dialogue_count: dialogueCount,
      source_timestamps_sha256: timestampSource.sha256,
      word_timestamps_sha256: wordTimestampsRecord.sha256,
      final_word_end_seconds: lastWord.end_seconds,
      safe_zone: captionSafeZone,
    },
    audio: {
      mix_mode: licensedAudioEvidence
        ? "GOVERNED_LICENSED_AUDIO_MIX"
        : "GOVERNED_NARRATION_ONLY",
      programme_audio_disposition:
        preserveRenderedCaptions
          ? "DROPPED_UNMAPPED"
          : "NOT_USED",
      programme_audio_present:
        hyperframesProbe.has_audio,
      programme_audio_mapped: false,
      source_sha256: narration.sha256,
      source_duration_seconds:
        narrationProbe.duration_seconds,
      governed_manifest_sha256:
        governedNarration.sha256,
      provider: governedNarration.provider,
      rights_basis:
        governedNarration.licence.rights_basis,
      padded_to_seconds: finalDurationSeconds,
      loudness: {
        method: "two_pass_linear_loudnorm",
        target: {
          integrated_lufs: TARGET_INTEGRATED_LUFS,
          true_peak_dbfs: TARGET_TRUE_PEAK_DBFS,
          loudness_range_lu: TARGET_LOUDNESS_RANGE_LU,
        },
        source: sourceLoudness,
        final: finalAudioQa.loudness,
      },
      terminal_silence_threshold_db:
        finalAudioQa.terminal_silence.threshold_db,
      terminal_silence_start_seconds:
        finalAudioQa.terminal_silence
          .terminal_silence_start_seconds,
      terminal_silence_seconds:
        finalAudioQa.terminal_silence
          .terminal_silence_seconds,
      terminal_silence_limit_seconds:
        MAX_TERMINAL_SILENCE_SECONDS,
      background_music_used: Boolean(
        licensedAudioEvidence,
      ),
      sound_effects_used: Boolean(
        licensedAudioEvidence,
      ),
      ...(licensedAudioEvidence
        ? {
            licensed_audio_pack:
              licensedAudioEvidence.manifest,
          }
        : {}),
    },
    ...(sourceMediaEvidence
      ? { source_media: sourceMediaEvidence }
      : {}),
    ...(licensedAudioEvidence
      ? { licensed_audio: licensedAudioEvidence }
      : {}),
  };
  await writeJsonAtomic(qaReportPath, qaReport);
  const qaReportSha256 = hashFile(qaReportPath);

  const compositeManifest = {
    schema_version: COMPOSITE_MANIFEST_SCHEMA,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict: "MATERIALIZED_LOCAL_PROOF",
    story_id: story.storyId,
    channel_id: story.channelId,
    script_sha256: story.scriptSha256,
    renderer_identity: RENDERER_ID,
    publish_authorised: false,
    human_visual_review_required: true,
    hyperframes: {
      material_stage: true,
      renderer_identity: false,
      generator_identity:
        ownedMotion.hyperframesAsset.generator_identity,
      source_commit:
        ownedMotion.hyperframesAsset.provenance
          ?.source_commit || null,
      probe: hyperframesProbe,
      source_backbone: {
        path: normalisePathForRecord(
          outputRoot,
          ownedMotion.backboneAsset.path,
        ),
        sha256: ownedMotion.backboneAsset.sha256,
      },
      project_files: ownedMotion.projectFiles.map((record) => ({
        path: normalisePathForRecord(outputRoot, record.path),
        sha256: record.sha256,
      })),
      ...(sourceMediaEvidence
        ? {
            third_party_media_used: true,
            source_media: sourceMediaEvidence,
          }
        : {}),
    },
    ffmpeg: {
      final_composite: true,
      video_codec: "h264",
      video_profile: "High",
      pixel_format: "yuv420p",
      fps: FPS,
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      duration_seconds: finalDurationSeconds,
      source_visual_duration_seconds:
        invocation.visual_timing.source_duration_seconds,
      visual_playback_rate:
        invocation.visual_timing.playback_rate,
      full_hyperframes_sequence_preserved:
        invocation.visual_timing
          .full_source_sequence_preserved,
      source_tail_trimmed_seconds:
        invocation.visual_timing
          .source_tail_trimmed_seconds,
      source_tail_padded_seconds:
        invocation.visual_timing
          .source_tail_padded_seconds,
      narration_loudness: {
        method: "two_pass_linear_loudnorm",
        target_integrated_lufs: TARGET_INTEGRATED_LUFS,
        target_true_peak_dbfs: TARGET_TRUE_PEAK_DBFS,
        source: sourceLoudness,
        final: finalAudioQa.loudness,
      },
      terminal_silence_seconds:
        finalAudioQa.terminal_silence
          .terminal_silence_seconds,
      background_music_used: Boolean(
        licensedAudioEvidence,
      ),
      sound_effects_used: Boolean(
        licensedAudioEvidence,
      ),
      mix_mode: licensedAudioEvidence
        ? "GOVERNED_LICENSED_AUDIO_MIX"
        : "GOVERNED_NARRATION_ONLY",
      programme_audio_disposition:
        preserveRenderedCaptions
          ? "DROPPED_UNMAPPED"
          : "NOT_USED",
      programme_audio_present:
        hyperframesProbe.has_audio,
      programme_audio_mapped: false,
    },
    inputs: {
      story_intake: {
        path: normalisePathForRecord(outputRoot, story.path),
        sha256: story.sha256,
      },
      owned_motion_manifest: {
        path: normalisePathForRecord(
          outputRoot,
          ownedMotion.manifestPath,
        ),
        sha256: ownedMotion.manifestSha256,
      },
      ...(sourceMediaEvidence
        ? {
            source_media_manifest: {
              path: sourceMediaEvidence.manifest.path,
              sha256: sourceMediaEvidence.manifest.sha256,
            },
          }
        : {}),
      ...(licensedAudioEvidence
        ? {
            licensed_audio_pack:
              licensedAudioEvidence.manifest,
            licensed_audio_rights_ledger:
              licensedAudioEvidence.rights_ledger,
          }
        : {}),
      hyperframes_intermediate: {
        path: normalisePathForRecord(
          outputRoot,
          ownedMotion.hyperframesAsset.path,
        ),
        sha256: ownedMotion.hyperframesAsset.sha256,
      },
      narration_audio: {
        path: normalisePathForRecord(
          outputRoot,
          narration.path,
        ),
        sha256: narration.sha256,
      },
      governed_narration_manifest: {
        path: normalisePathForRecord(
          outputRoot,
          governedNarration.path,
        ),
        sha256: governedNarration.sha256,
        provider: governedNarration.provider,
        licence: governedNarration.licence,
      },
      narration_alignment: {
        path: normalisePathForRecord(
          outputRoot,
          governedNarration.alignment.path,
        ),
        sha256: governedNarration.alignment.sha256,
      },
      timestamp_source: {
        path: normalisePathForRecord(
          outputRoot,
          timestampSource.path,
        ),
        sha256: timestampSource.sha256,
      },
      word_timestamps: {
        path: normalisePathForRecord(
          outputRoot,
          wordTimestampsRecord.path,
        ),
        sha256: wordTimestampsRecord.sha256,
      },
      filter_complex: {
        path: normalisePathForRecord(
          outputRoot,
          filterPath,
        ),
        sha256: hashFile(filterPath),
      },
    },
    ...(sourceMediaEvidence
      ? { source_media: sourceMediaEvidence }
      : {}),
    ...(licensedAudioEvidence
      ? { licensed_audio: licensedAudioEvidence }
      : {}),
    captions: {
      path: normalisePathForRecord(outputRoot, captionsPath),
      sha256: hashFile(captionsPath),
      mode: preserveRenderedCaptions
        ? "PRE_RENDERED"
        : "FINAL_COMPOSITE_ASS",
      final_burn_in_performed: !preserveRenderedCaptions,
      visual_review_required: preserveRenderedCaptions,
      source_video_sha256: requestedHyperframesVideo.sha256,
      ...(preRenderedCaptionBinding
        ? {
            programme_binding:
              preRenderedCaptionBinding,
          }
        : {}),
      dialogue_count: dialogueCount,
      style: "studio-v21-kinetic-word-pop",
      safe_zone: captionSafeZone,
    },
    renderer_manifest: {
      path: normalisePathForRecord(
        outputRoot,
        rendererManifestPath,
      ),
      file_sha256: rendererManifestFileSha256,
      canonical_sha256: rendererManifestSha256,
      local_proof_evaluation: rendererEvaluation,
    },
    qa_report: {
      path: normalisePathForRecord(outputRoot, qaReportPath),
      sha256: qaReportSha256,
      verdict: qaReport.verdict,
    },
    output: {
      path: normalisePathForRecord(outputRoot, finalMp4.path),
      sha256: finalMp4.sha256,
      size_bytes: finalMp4.size_bytes,
      ...finalProbe.technical,
    },
    evidence_basis: rendererEvidence.basis,
    safety: {
      external_calls: [],
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
      network_used: false,
    },
  };
  await writeJsonAtomic(
    compositeManifestPath,
    compositeManifest,
  );
  await writeAtomic(
    markdownPath,
    Buffer.from(
      renderCompositeMarkdown(compositeManifest),
      "utf8",
    ),
  );

  return {
    schema_version: RESULT_SCHEMA,
    generated_at: generatedAt,
    mode: "LOCAL_PROOF",
    verdict: "MATERIALIZED_LOCAL_PROOF",
    mutated: true,
    story_id: story.storyId,
    channel_id: story.channelId,
    renderer_identity: RENDERER_ID,
    media_sha256: finalMp4.sha256,
    script_sha256: story.scriptSha256,
    final_mp4_path: finalMp4.path,
    captions_path: captionsPath,
    word_timestamps_path: wordTimestampsPath,
    filter_path: filterPath,
    renderer_manifest_path: rendererManifestPath,
    renderer_manifest_sha256: rendererManifestSha256,
    qa_report_path: qaReportPath,
    composite_manifest_path: compositeManifestPath,
    composite_manifest_sha256: hashFile(
      compositeManifestPath,
    ),
    markdown_path: markdownPath,
    combined_owned_motion_manifest_path:
      ownedMotion.manifestPath,
    combined_owned_motion_manifest_derived:
      combinedManifest.derived === true,
    narration_manifest_path: governedNarration.path,
    narration_manifest_sha256: governedNarration.sha256,
    ...(sourceMediaEvidence
      ? {
          source_media_policy: sourceMediaPolicy,
          source_media_manifest_path:
            sourceMedia.manifest_path,
          source_media_manifest_sha256:
            sourceMedia.manifest_sha256,
        }
      : {}),
    ...(licensedAudioEvidence
      ? {
          licensed_audio_pack_path:
            renderLicensedAudio.manifest_path,
          licensed_audio_pack_sha256:
            renderLicensedAudio.manifest_sha256,
          licensed_audio_rights_ledger_sha256:
            renderLicensedAudio.rights_ledger.sha256,
        }
      : {}),
    publish_authorised: false,
    human_visual_review_required: true,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    live_publish_attempted: false,
    network_used: false,
  };
}

function promotePath(stageRoot, finalRoot, candidate) {
  if (!candidate) return candidate;
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(stageRoot, resolvedCandidate);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  ) {
    return path.join(finalRoot, relative);
  }
  return candidate;
}

async function executeGovernedFinalComposite(
  options = {},
  dependencies = {},
) {
  if (!options.outDir) {
    throw new GovernedFinalCompositeError(
      "explicit_output_dir_required",
    );
  }
  const story = validateStoryIntake(options.storyIntakePath);
  const outputParent = path.resolve(options.outDir);
  const finalRoot = path.join(outputParent, story.storyId);
  if (fs.existsSync(finalRoot)) {
    throw new GovernedFinalCompositeError(
      "final_composite_output_already_exists",
    );
  }

  await fsp.mkdir(outputParent, { recursive: true });
  const lockPath = path.join(
    outputParent,
    `.${story.storyId}.final-composite.lock`,
  );
  let lockHandle;
  try {
    lockHandle = await fsp.open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new GovernedFinalCompositeError(
        "final_composite_output_locked",
      );
    }
    throw error;
  }

  const stageRoot = path.join(
    outputParent,
    `.${story.storyId}.staging-${process.pid}-${crypto.randomUUID()}`,
  );
  let stagedResult;
  try {
    stagedResult =
      await materialiseGovernedFinalCompositeToStage(
        {
          ...options,
          outputRootOverride: stageRoot,
        },
        dependencies,
      );
    if (!fs.existsSync(stageRoot)) {
      throw new GovernedFinalCompositeError(
        "final_composite_staging_output_missing",
      );
    }
    if (fs.existsSync(finalRoot)) {
      throw new GovernedFinalCompositeError(
        "final_composite_output_already_exists",
      );
    }
    await fsp.rename(stageRoot, finalRoot);
  } catch (error) {
    await fsp.rm(stageRoot, {
      recursive: true,
      force: true,
    });
    throw error;
  } finally {
    await fsp.rm(stageRoot, {
      recursive: true,
      force: true,
    });
    await lockHandle.close();
    await fsp.rm(lockPath, { force: true });
  }

  const pathKeys = [
    "final_mp4_path",
    "captions_path",
    "word_timestamps_path",
    "filter_path",
    "renderer_manifest_path",
    "qa_report_path",
    "composite_manifest_path",
    "markdown_path",
    "combined_owned_motion_manifest_path",
  ];
  const result = { ...stagedResult };
  for (const key of pathKeys) {
    result[key] = promotePath(
      stageRoot,
      finalRoot,
      result[key],
    );
  }
  return result;
}

module.exports = {
  COMPOSITE_MANIFEST_SCHEMA,
  DURATION_SECONDS,
  FINAL_DURATION_SECONDS,
  GovernedFinalCompositeError,
  HYPERFRAMES_DURATION_SECONDS,
  NARRATION_MANIFEST_SCHEMA,
  QA_SCHEMA,
  RENDERER_ID,
  RESULT_SCHEMA,
  WORD_TIMESTAMPS_SCHEMA,
  buildFfmpegInvocation,
  defaultMeasureLoudness,
  defaultMeasureTerminalSilence,
  defaultProbeMedia,
  defaultRenderComposite,
  deriveCombinedOwnedMotionManifest,
  executeGovernedFinalComposite,
  inspectFinalProbe,
  inspectHyperframesProbe,
  inspectNarrationProbe,
  normaliseWordTimestamps,
  parseLoudnormOutput,
  parseTerminalSilenceOutput,
  samePath,
  validateCombinedOwnedMotionManifest,
  validateGovernedNarrationManifest,
  validateFinalAudioMeasurements,
  validateStoryIntake,
};
