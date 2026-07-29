"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  METADATA_SCHEMA,
  GovernedPublicationMetadataError,
  validateGovernedPublicationMetadata,
} = require("../../lib/services/governed-publication-metadata");

const STORY_ID = "official_d86953ca92ca";
const CHANNEL_ID = "pulse-gaming";
const PLATFORM = "youtube_shorts";
const ATTRIBUTION_TEXT = "© SQUARE ENIX";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fixture(overrides = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-publication-metadata-"),
  );
  const metadataPath = path.join(root, "publication-metadata.json");
  const value = {
    schema_version: METADATA_SCHEMA,
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    platform: PLATFORM,
    title: "Final Fantasy XIV reveals Bastion",
    description:
      `Bastion arrives in Final Fantasy XIV.\n\n${ATTRIBUTION_TEXT}`,
    ...overrides,
  };
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  return {
    root,
    metadataPath,
    metadataSha256: sha256(fs.readFileSync(metadataPath)),
    value,
  };
}

function validate(values, overrides = {}) {
  return validateGovernedPublicationMetadata({
    metadataPath: values.metadataPath,
    expectedMetadataSha256: values.metadataSha256,
    expectedStoryId: STORY_ID,
    expectedChannelId: CHANNEL_ID,
    expectedPlatform: PLATFORM,
    requiredDescriptionAttributions: [ATTRIBUTION_TEXT],
    ...overrides,
  });
}

test("validates exact hash-bound publication metadata and description attribution", () => {
  const values = fixture();
  try {
    const result = validate(values);
    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.channel_id, CHANNEL_ID);
    assert.equal(result.platform, PLATFORM);
    assert.equal(result.title, values.value.title);
    assert.equal(result.description, values.value.description);
    assert.equal(result.sha256, values.metadataSha256);
    assert.deepEqual(result.description_attributions, [
      ATTRIBUTION_TEXT,
    ]);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("rejects missing path, missing independent hash and tampered bytes", () => {
  const values = fixture();
  try {
    assert.throws(
      () => validate(values, { metadataPath: null }),
      (error) =>
        error instanceof GovernedPublicationMetadataError &&
        error.codes.includes("publication_metadata_path_required"),
    );
    assert.throws(
      () =>
        validate(values, {
          expectedMetadataSha256: null,
        }),
      (error) =>
        error instanceof GovernedPublicationMetadataError &&
        error.codes.includes(
          "publication_metadata_sha256_required",
        ),
    );
    fs.appendFileSync(values.metadataPath, " ", "utf8");
    assert.throws(
      () => validate(values),
      (error) =>
        error instanceof GovernedPublicationMetadataError &&
        error.codes.includes(
          "publication_metadata_sha256_mismatch",
        ),
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("binds canonical schema, story, channel and platform identity", () => {
  for (const [field, value, code] of [
    ["schema_version", "pulse-governed-publication-metadata-v0", "publication_metadata_schema_invalid"],
    ["story_id", "official_other", "publication_metadata_story_id_mismatch"],
    ["channel_id", "other-channel", "publication_metadata_channel_id_mismatch"],
    ["platform", "tiktok", "publication_metadata_platform_mismatch"],
  ]) {
    const values = fixture({ [field]: value });
    try {
      assert.throws(
        () => validate(values),
        (error) =>
          error instanceof GovernedPublicationMetadataError &&
          error.codes.includes(code),
      );
    } finally {
      fs.rmSync(values.root, { recursive: true, force: true });
    }
  }
});

test("requires usable title and description text", () => {
  for (const [field, value, code] of [
    ["title", "", "publication_metadata_title_required"],
    ["description", "", "publication_metadata_description_required"],
  ]) {
    const values = fixture({ [field]: value });
    try {
      assert.throws(
        () => validate(values),
        (error) =>
          error instanceof GovernedPublicationMetadataError &&
          error.codes.includes(code),
      );
    } finally {
      fs.rmSync(values.root, { recursive: true, force: true });
    }
  }
});

test("requires each description attribution as an exact standalone line", () => {
  for (const description of [
    "Bastion arrives in Final Fantasy XIV.",
    "Bastion arrives.\n\nCredit: © SQUARE ENIX",
    "Bastion arrives.\n\n© SQUARE ENIX LTD",
  ]) {
    const values = fixture({ description });
    try {
      assert.throws(
        () => validate(values),
        (error) =>
          error instanceof GovernedPublicationMetadataError &&
          error.codes.includes(
            "publication_metadata_description_attribution_missing",
          ),
      );
    } finally {
      fs.rmSync(values.root, { recursive: true, force: true });
    }
  }
});

test("owned-only metadata remains valid without a description attribution", () => {
  const values = fixture({
    description: "Bastion arrives in Final Fantasy XIV.",
  });
  try {
    const result = validate(values, {
      requiredDescriptionAttributions: [],
    });
    assert.deepEqual(result.description_attributions, []);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});
