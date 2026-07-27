"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const METADATA_SCHEMA = "pulse-governed-publication-metadata-v1";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const YOUTUBE_PLATFORM_CONTRACT = Object.freeze({
  lifecyclePlatform: "youtube",
  reviewedMetadataPlatform: "youtube_shorts",
});

class GovernedPublicationMetadataError extends Error {
  constructor(codes) {
    const normalised = [
      ...new Set((Array.isArray(codes) ? codes : [codes]).filter(Boolean)),
    ];
    super(
      `governed_publication_metadata_validation_failed: ${normalised.join(
        ", ",
      )}`,
    );
    this.name = "GovernedPublicationMetadataError";
    this.codes = normalised;
  }
}

function text(value) {
  return String(value ?? "").trim();
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function samePath(left, right) {
  const normalise = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32"
      ? resolved.toLowerCase()
      : resolved;
  };
  return normalise(left) === normalise(right);
}

function readMetadata(metadataPath) {
  if (!text(metadataPath)) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_path_required",
    );
  }
  const resolvedPath = path.resolve(metadataPath);
  if (
    !fs.existsSync(resolvedPath) ||
    !fs.statSync(resolvedPath).isFile()
  ) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_file_required",
    );
  }
  const bytes = fs.readFileSync(resolvedPath);
  if (bytes.length === 0) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_file_empty",
    );
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_json_invalid",
    );
  }
  return {
    path: resolvedPath,
    bytes,
    sha256: sha256(bytes),
    value,
  };
}

function validateGovernedPublicationMetadata({
  metadataPath,
  expectedMetadataSha256,
  expectedStoryId,
  expectedChannelId,
  expectedPlatform,
  requiredDescriptionAttributions = [],
  requireCanonicalAbsolutePath = false,
} = {}) {
  const suppliedPath = text(metadataPath);
  if (
    requireCanonicalAbsolutePath === true &&
    (!path.isAbsolute(suppliedPath) ||
      path.normalize(suppliedPath) !== suppliedPath ||
      !samePath(suppliedPath, path.resolve(suppliedPath)))
  ) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_canonical_absolute_path_required",
    );
  }
  const expectedSha = text(expectedMetadataSha256).toLowerCase();
  if (!expectedSha) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_sha256_required",
    );
  }
  if (!SHA256_PATTERN.test(expectedSha)) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_sha256_invalid",
    );
  }
  const metadata = readMetadata(metadataPath);
  if (requireCanonicalAbsolutePath === true) {
    let realPath;
    try {
      realPath = fs.realpathSync.native(metadata.path);
    } catch {
      throw new GovernedPublicationMetadataError(
        "publication_metadata_file_required",
      );
    }
    if (!samePath(realPath, metadata.path)) {
      throw new GovernedPublicationMetadataError(
        "publication_metadata_canonical_absolute_path_required",
      );
    }
  }
  if (metadata.sha256 !== expectedSha) {
    throw new GovernedPublicationMetadataError(
      "publication_metadata_sha256_mismatch",
    );
  }

  const value = metadata.value;
  const errors = [];
  const storyId = text(expectedStoryId);
  const channelId = text(expectedChannelId);
  const platform = text(expectedPlatform);
  if (value?.schema_version !== METADATA_SCHEMA) {
    errors.push("publication_metadata_schema_invalid");
  }
  if (!storyId || text(value?.story_id) !== storyId) {
    errors.push("publication_metadata_story_id_mismatch");
  }
  if (!channelId || text(value?.channel_id) !== channelId) {
    errors.push("publication_metadata_channel_id_mismatch");
  }
  if (!platform || text(value?.platform) !== platform) {
    errors.push("publication_metadata_platform_mismatch");
  }
  const title = text(value?.title);
  const description = text(value?.description);
  if (!title) {
    errors.push("publication_metadata_title_required");
  }
  if (!description) {
    errors.push("publication_metadata_description_required");
  }
  if (title.length > 100) {
    errors.push("publication_metadata_title_too_long");
  }
  if (description.length > 5000) {
    errors.push("publication_metadata_description_too_long");
  }

  const requiredAttributions = [
    ...new Set(
      (Array.isArray(requiredDescriptionAttributions)
        ? requiredDescriptionAttributions
        : []
      )
        .map(text)
        .filter(Boolean),
    ),
  ];
  const descriptionLines = new Set(
    description.split(/\r?\n/).map(text).filter(Boolean),
  );
  for (const attribution of requiredAttributions) {
    if (!descriptionLines.has(attribution)) {
      errors.push(
        "publication_metadata_description_attribution_missing",
      );
    }
  }
  if (errors.length) {
    throw new GovernedPublicationMetadataError(errors);
  }

  return {
    schema_version: METADATA_SCHEMA,
    path: metadata.path,
    sha256: metadata.sha256,
    story_id: storyId,
    channel_id: channelId,
    platform,
    title,
    description,
    description_attributions: requiredAttributions,
    value,
  };
}

module.exports = {
  GovernedPublicationMetadataError,
  METADATA_SCHEMA,
  YOUTUBE_PLATFORM_CONTRACT,
  validateGovernedPublicationMetadata,
};
