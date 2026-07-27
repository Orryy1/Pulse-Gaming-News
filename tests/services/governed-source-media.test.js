"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ATTRIBUTION_TEXT,
  EDITORIAL_PURPOSE,
  GovernedSourceMediaError,
  MANIFEST_SCHEMA,
  validateGovernedSourceMediaManifest,
} = require("../../lib/services/governed-source-media");

const STORY_ID = "official_d86953ca92ca";
const LICENCE_URL =
  "https://support.eu.square-enix.com/rule.php?id=5383&la=2&tag=authc";
const OFFICIAL_PAGE_URL =
  "https://eu.finalfantasyxiv.com/evercold/media/";
const OFFICIAL_IMAGE_URL =
  "https://lds-img.finalfantasyxiv.com/promo/h/i/evercold.jpg";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const VALIDATION_BOUNDARY = "2026-07-27T15:01:00.000Z";
const videoFixtureCache = new Map();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function generatedVideoBytes({ withAudio }) {
  const cacheKey = withAudio ? "with-audio" : "silent";
  if (videoFixtureCache.has(cacheKey)) {
    return videoFixtureCache.get(cacheKey);
  }
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), `pulse-source-video-${cacheKey}-`),
  );
  const outputPath = path.join(root, `${cacheKey}.mp4`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:s=16x16:r=10:d=0.3",
  ];
  if (withAudio) {
    args.push(
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:sample_rate=44100:duration=0.3",
    );
  }
  args.push(
    "-t",
    "0.3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
  );
  if (withAudio) {
    args.push("-c:a", "aac", "-shortest");
  } else {
    args.push("-an");
  }
  args.push("-movflags", "+faststart", "-y", outputPath);
  const generated = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(
    generated.status,
    0,
    `ffmpeg fixture generation failed: ${generated.stderr}`,
  );
  const bytes = fs.readFileSync(outputPath);
  videoFixtureCache.set(cacheKey, bytes);
  return bytes;
}

function writeJson(filePath, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, bytes);
  return sha256(bytes);
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-governed-source-media-"),
  );
  const assetPath = path.join(root, "assets", "bastion-key-art.png");
  const evidencePath = path.join(root, "evidence", "rights-review.json");
  const manifestPath = path.join(root, "source-media-manifest.json");
  const assetBytes = ONE_PIXEL_PNG;
  fs.mkdirSync(path.dirname(assetPath), { recursive: true });
  fs.writeFileSync(assetPath, assetBytes);

  const evidence = {
    schema_version: "pulse-governed-rights-review-evidence-v1",
    story_id: STORY_ID,
    review_status: "ACCEPTED",
    rights_basis: "LICENSED",
    publisher: "Square Enix",
    licence_evidence_url: LICENCE_URL,
    licence_effective_date: "2026-05-07",
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: "2026-07-27T15:00:00.000Z",
    scope:
      "Official FINAL FANTASY XIV gameplay used in a narrated, edited news report.",
    findings: {
      covered_materials: ["art", "video", "screenshots", "images"],
      permitted_destination:
        "YouTube and comparable social-network partner programmes",
      copyright_notice: ATTRIBUTION_TEXT,
      copyright_notice_delivery: ["ON_SCREEN", "DESCRIPTION"],
      third_party_music_used: false,
      source_audio_used: false,
      raw_asset_redistribution: false,
      removal_request_must_be_honoured: true,
    },
  };
  const evidenceSha256 = writeJson(evidencePath, evidence);
  const manifest = {
    schema_version: MANIFEST_SCHEMA,
    story_id: STORY_ID,
    generated_at: "2026-07-27T15:00:30.000Z",
    rights_review: {
      path: path.relative(root, evidencePath),
      sha256: evidenceSha256,
      review_status: "ACCEPTED",
    },
    composition_duration_seconds: 28,
    components: [
      {
        component_id: "bastion-key-art-01",
        media_type: "IMAGE",
        asset: {
          path: path.relative(root, assetPath),
          sha256: sha256(assetBytes),
          width: 1,
          height: 1,
        },
        source: {
          page_url: OFFICIAL_PAGE_URL,
          direct_media_url: OFFICIAL_IMAGE_URL,
          publisher: "Square Enix",
        },
        rights_basis: "LICENSED",
        licence_evidence_url: LICENCE_URL,
        review_status: "ACCEPTED",
        attribution: {
          required: true,
          text: ATTRIBUTION_TEXT,
          delivery: ["ON_SCREEN", "DESCRIPTION"],
        },
        editorial: {
          purpose: EDITORIAL_PURPOSE,
          third_party_music_used: false,
          source_audio_disposition: "NOT_APPLICABLE",
          usage_seconds: [0, 3.6],
        },
      },
    ],
  };
  const manifestSha256 = writeJson(manifestPath, manifest);

  return {
    assetPath,
    evidencePath,
    manifest,
    manifestPath,
    manifestSha256,
    root,
  };
}

function rewriteManifest(input, mutate) {
  const manifest = structuredClone(input.manifest);
  mutate(manifest);
  input.manifest = manifest;
  input.manifestSha256 = writeJson(input.manifestPath, manifest);
  return input;
}

function rewriteEvidence(input, mutate) {
  const evidence = JSON.parse(fs.readFileSync(input.evidencePath, "utf8"));
  mutate(evidence);
  const evidenceSha256 = writeJson(input.evidencePath, evidence);
  return rewriteManifest(input, (manifest) => {
    manifest.rights_review.sha256 = evidenceSha256;
    for (const component of manifest.components || []) {
      component.licence_evidence_url = evidence.licence_evidence_url;
    }
  });
}

function validate(input, overrides = {}) {
  return validateGovernedSourceMediaManifest({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: STORY_ID,
    validationBoundaryAt: VALIDATION_BOUNDARY,
    ...overrides,
  });
}

function videoFixture({
  withAudio = false,
  sourceAudioDisposition = "REMOVED",
} = {}) {
  const input = fixture();
  const videoPath = path.join(input.root, "assets", "official-gameplay.mp4");
  const videoBytes = generatedVideoBytes({ withAudio });
  fs.writeFileSync(videoPath, videoBytes);
  rewriteManifest(input, (manifest) => {
    const component = manifest.components[0];
    component.component_id = "bastion-gameplay-01";
    component.media_type = "VIDEO";
    component.asset = {
      path: path.relative(input.root, videoPath),
      sha256: sha256(videoBytes),
      width: 16,
      height: 16,
    };
    component.source.direct_media_url =
      "https://lds-img.finalfantasyxiv.com/promo/h/i/bastion-gameplay.mp4";
    component.editorial.source_audio_disposition =
      sourceAudioDisposition;
  });
  return { ...input, videoPath };
}

test("validates an exact, licensed and accepted Square Enix source-media manifest", () => {
  const input = fixture();

  const result = validateGovernedSourceMediaManifest({
    manifestPath: input.manifestPath,
    expectedManifestSha256: input.manifestSha256,
    expectedStoryId: STORY_ID,
    validationBoundaryAt: VALIDATION_BOUNDARY,
  });

  assert.equal(result.schema_version, MANIFEST_SCHEMA);
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.composition_duration_seconds, 28);
  assert.equal(result.manifest_sha256, input.manifestSha256);
  assert.equal(result.rights_review.review_status, "ACCEPTED");
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].component_id, "bastion-key-art-01");
  assert.equal(result.components[0].asset.path, path.resolve(input.assetPath));
  assert.equal(result.components[0].asset.sha256, sha256(fs.readFileSync(input.assetPath)));
  assert.equal(result.components[0].asset.mime_type, "image/png");
  assert.equal(result.components[0].asset.width, 1);
  assert.equal(result.components[0].asset.height, 1);
  assert.deepEqual(
    result.components[0].editorial.usage_seconds,
    [0, 3.6],
  );
});

test("requires an explicit temporal validation boundary", () => {
  const input = fixture();

  assert.throws(
    () =>
      validateGovernedSourceMediaManifest({
        manifestPath: input.manifestPath,
        expectedManifestSha256: input.manifestSha256,
        expectedStoryId: STORY_ID,
      }),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_validation_boundary_required",
      ),
  );
});

test("cannot legitimise future evidence with an operator-supplied future boundary", () => {
  const input = fixture();

  assert.throws(
    () =>
      validate(input, {
        validationBoundaryAt: "2099-07-27T18:03:00.001Z",
      }),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_validation_boundary_in_future",
      ),
  );
});

test("clock-skew tolerance on the boundary cannot extend the evidence clock twice", () => {
  const clockSnapshot = Date.now();
  const input = rewriteManifest(fixture(), (manifest) => {
    manifest.generated_at = new Date(
      clockSnapshot + 75_000,
    ).toISOString();
  });

  assert.throws(
    () =>
      validate(input, {
        validationBoundaryAt: new Date(
          clockSnapshot + 30_000,
        ).toISOString(),
      }),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_manifest_generated_at_in_future",
      ),
  );
});

test("rejects a source-media manifest generated beyond the one-minute clock-skew allowance", () => {
  const input = rewriteManifest(fixture(), (manifest) => {
    manifest.generated_at = "2026-07-27T15:02:00.001Z";
  });

  assert.throws(
    () => validate(input),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_manifest_generated_at_in_future",
      ),
  );
});

test("rejects a rights review dated beyond the one-minute clock-skew allowance", () => {
  const input = rewriteEvidence(fixture(), (evidence) => {
    evidence.reviewed_at = "2026-07-27T15:02:00.001Z";
  });

  assert.throws(
    () => validate(input),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_reviewed_at_in_future",
      ),
  );
});

test("rejects any source-media manifest outside the governed schema", () => {
  const input = rewriteManifest(fixture(), (manifest) => {
    manifest.schema_version = "pulse-governed-source-media-manifest-v0";
  });

  assert.throws(
    () => validate(input),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_manifest_schema_invalid"),
  );
});

test("binds the manifest and rights review to the expected story", () => {
  const manifestMismatch = rewriteManifest(fixture(), (manifest) => {
    manifest.story_id = "official_other_story";
  });
  assert.throws(
    () => validate(manifestMismatch),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_story_id_mismatch"),
  );

  const evidenceMismatch = fixture();
  const evidence = JSON.parse(
    fs.readFileSync(evidenceMismatch.evidencePath, "utf8"),
  );
  evidence.story_id = "official_other_story";
  const evidenceSha256 = writeJson(evidenceMismatch.evidencePath, evidence);
  rewriteManifest(evidenceMismatch, (manifest) => {
    manifest.rights_review.sha256 = evidenceSha256;
  });
  assert.throws(
    () => validate(evidenceMismatch),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_rights_review_story_id_mismatch"),
  );
});

test("fails closed when the manifest, an asset, evidence or a declared path is tampered", () => {
  const changedManifest = fixture();
  fs.appendFileSync(changedManifest.manifestPath, " ", "utf8");
  assert.throws(
    () => validate(changedManifest),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_manifest_sha256_mismatch"),
  );

  const changedAsset = fixture();
  fs.appendFileSync(changedAsset.assetPath, "tampered", "utf8");
  assert.throws(
    () => validate(changedAsset),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_asset_sha256_mismatch"),
  );

  const changedEvidence = fixture();
  fs.appendFileSync(changedEvidence.evidencePath, " ", "utf8");
  assert.throws(
    () => validate(changedEvidence),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_rights_review_sha256_mismatch"),
  );

  const changedPath = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].asset.path = "assets/different.mp4";
  });
  assert.throws(
    () => validate(changedPath),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_asset_file_not_found"),
  );
});

test("requires at least one component with a unique stable component ID", () => {
  const noComponents = rewriteManifest(fixture(), (manifest) => {
    manifest.components = [];
  });
  assert.throws(
    () => validate(noComponents),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_components_required"),
  );

  const duplicate = rewriteManifest(fixture(), (manifest) => {
    manifest.components.push(structuredClone(manifest.components[0]));
  });
  assert.throws(
    () => validate(duplicate),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_id_duplicate"),
  );
});

test("requires HTTPS source page and direct-media URLs from the declared Square Enix publisher", () => {
  const insecurePage = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].source.page_url =
      "http://eu.finalfantasyxiv.com/evercold/media/";
  });
  assert.throws(
    () => validate(insecurePage),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_source_page_url_invalid"),
  );

  const insecureMedia = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].source.direct_media_url =
      "ftp://cdn.example/bastion.png";
  });
  assert.throws(
    () => validate(insecureMedia),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_direct_media_url_invalid",
      ),
  );

  const randomHttpsPage = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].source.page_url =
      "https://gaming.example/official-looking-ffxiv-page";
  });
  assert.throws(
    () => validate(randomHttpsPage),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_source_page_url_invalid"),
  );

  const randomHttpsMedia = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].source.direct_media_url =
      "https://cdn.example/official-looking-ffxiv-image.png";
  });
  assert.throws(
    () => validate(randomHttpsMedia),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_direct_media_url_invalid",
      ),
  );

  const wrongPublisher = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].source.publisher = "Fan upload";
  });
  assert.throws(
    () => validate(wrongPublisher),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_publisher_invalid"),
  );
});

test("requires an accepted licensed-use decision backed by the official Square Enix support host", () => {
  const attributionOnly = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].rights_basis = "ATTRIBUTION_ONLY";
  });
  assert.throws(
    () => validate(attributionOnly),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_rights_basis_invalid"),
  );

  const lookalikeHost = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].licence_evidence_url =
      "https://support.eu.square-enix.com.example/rule.php?id=5383";
  });
  assert.throws(
    () => validate(lookalikeHost),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_licence_evidence_url_invalid",
      ),
  );

  const wrongRule = rewriteEvidence(fixture(), (evidence) => {
    evidence.licence_evidence_url =
      "https://support.eu.square-enix.com/rule.php?id=9999&la=2&tag=authc";
  });
  assert.throws(
    () => validate(wrongRule),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_licence_evidence_url_invalid",
      ),
  );

  const nonCanonicalQuery = rewriteEvidence(fixture(), (evidence) => {
    evidence.licence_evidence_url =
      "https://support.eu.square-enix.com/rule.php?id=5383&la=2&tag=authc&continue=https%3A%2F%2Fevil.example";
  });
  assert.throws(
    () => validate(nonCanonicalQuery),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_licence_evidence_url_invalid",
      ),
  );

  const pendingReview = fixture();
  const evidence = JSON.parse(
    fs.readFileSync(pendingReview.evidencePath, "utf8"),
  );
  evidence.review_status = "PENDING";
  const evidenceSha256 = writeJson(pendingReview.evidencePath, evidence);
  rewriteManifest(pendingReview, (manifest) => {
    manifest.rights_review.sha256 = evidenceSha256;
  });
  assert.throws(
    () => validate(pendingReview),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_rights_review_status_invalid"),
  );
});

test("requires the exact Square Enix attribution and declared on-screen and description delivery", () => {
  const notRequired = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].attribution.required = false;
  });
  assert.throws(
    () => validate(notRequired),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_attribution_required",
      ),
  );

  const alteredText = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].attribution.text =
      "Official footage by Square Enix";
  });
  assert.throws(
    () => validate(alteredText),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_attribution_invalid"),
  );

  const missingDelivery = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].attribution.delivery = ["ON_SCREEN"];
  });
  assert.throws(
    () => validate(missingDelivery),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_attribution_delivery_invalid",
      ),
  );
});

test("requires transformative editorial use with no third-party music and muted or removed source audio", () => {
  const nonTransformative = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].editorial.purpose = "DECORATIVE_REUSE";
  });
  assert.throws(
    () => validate(nonTransformative),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_editorial_purpose_invalid",
      ),
  );

  const thirdPartyMusic = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].editorial.third_party_music_used = true;
  });
  assert.throws(
    () => validate(thirdPartyMusic),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_third_party_music"),
  );

  const sourceAudioPresent = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].editorial.source_audio_disposition = "PRESENT";
  });
  assert.throws(
    () => validate(sourceAudioPresent),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_source_audio_disposition_invalid",
      ),
  );
});

test("accepts governed Square Enix still images with audio marked not applicable", () => {
  const input = fixture();
  const imagePath = path.join(input.root, "assets", "evercold-key-art.png");
  const imageBytes = ONE_PIXEL_PNG;
  fs.writeFileSync(imagePath, imageBytes);
  rewriteManifest(input, (manifest) => {
    const image = structuredClone(manifest.components[0]);
    image.component_id = "evercold-key-art";
    image.media_type = "IMAGE";
    image.asset = {
      path: path.relative(input.root, imagePath),
      sha256: sha256(imageBytes),
      width: 1,
      height: 1,
    };
    image.source.direct_media_url = OFFICIAL_IMAGE_URL;
    image.editorial.source_audio_disposition = "NOT_APPLICABLE";
    image.editorial.usage_seconds = [3.6, 7.2];
    manifest.components.push(image);
  });

  const result = validate(input);

  assert.equal(result.components.length, 2);
  assert.equal(result.components[1].media_type, "IMAGE");
  assert.equal(
    result.components[1].editorial.source_audio_disposition,
    "NOT_APPLICABLE",
  );
});

test("probes real image bytes and rejects disguised media or false dimensions", () => {
  const disguised = fixture();
  const disguisedBytes = Buffer.from("this is text, not an image", "utf8");
  fs.writeFileSync(disguised.assetPath, disguisedBytes);
  rewriteManifest(disguised, (manifest) => {
    manifest.components[0].asset.sha256 = sha256(disguisedBytes);
  });
  assert.throws(
    () => validate(disguised),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_asset_media_invalid"),
  );

  const falseDimensions = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].asset.width = 1920;
    manifest.components[0].asset.height = 1080;
  });
  assert.throws(
    () => validate(falseDimensions),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_asset_dimensions_mismatch",
      ),
  );
});

test("uses ffprobe to accept a real silent video and reject text disguised as video", () => {
  const silent = videoFixture();
  const result = validate(silent);
  assert.equal(result.components[0].asset.mime_type, "video/mp4");
  assert.equal(result.components[0].asset.width, 16);
  assert.equal(result.components[0].asset.height, 16);
  assert.equal(result.components[0].asset.has_audio, false);
  assert.ok(result.components[0].asset.duration_seconds > 0);

  const disguised = fixture();
  const bytes = Buffer.from("not an mp4 despite the file extension", "utf8");
  const videoPath = path.join(disguised.root, "assets", "fake.mp4");
  fs.writeFileSync(videoPath, bytes);
  rewriteManifest(disguised, (manifest) => {
    const component = manifest.components[0];
    component.media_type = "VIDEO";
    component.asset = {
      path: path.relative(disguised.root, videoPath),
      sha256: sha256(bytes),
      width: 16,
      height: 16,
    };
    component.editorial.source_audio_disposition = "REMOVED";
  });
  assert.throws(
    () => validate(disguised),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_asset_media_invalid"),
  );
});

test("rejects an audio-bearing video declared REMOVED or MUTED", () => {
  for (const disposition of ["REMOVED", "MUTED"]) {
    const input = videoFixture({
      withAudio: true,
      sourceAudioDisposition: disposition,
    });
    assert.throws(
      () => validate(input),
      (error) =>
        error instanceof GovernedSourceMediaError &&
        error.codes.includes(
          "source_media_component_0_asset_audio_stream_present",
        ),
      disposition,
    );
  }
});

test("requires finite ordered usage seconds inside the composition duration", () => {
  const cases = [
    {
      usage: [0, null],
      code: "source_media_component_0_usage_seconds_invalid",
    },
    {
      usage: [3.6, 3.6],
      code: "source_media_component_0_usage_seconds_order_invalid",
    },
    {
      usage: [4, 3],
      code: "source_media_component_0_usage_seconds_order_invalid",
    },
    {
      usage: [-1, 2],
      code: "source_media_component_0_usage_seconds_order_invalid",
    },
    {
      usage: [27, 28.01],
      code: "source_media_component_0_usage_seconds_out_of_bounds",
    },
  ];
  for (const current of cases) {
    const input = rewriteManifest(fixture(), (manifest) => {
      manifest.components[0].editorial.usage_seconds = current.usage;
    });
    assert.throws(
      () => validate(input),
      (error) =>
        error instanceof GovernedSourceMediaError &&
        error.codes.includes(current.code),
      current.code,
    );
  }

  const durationMismatch = fixture();
  assert.throws(
    () => validate(durationMismatch, { compositionDurationSeconds: 30 }),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_composition_duration_mismatch",
      ),
  );
});

test("requires canonical LICENSED and ACCEPTED decisions in both manifest and review evidence", () => {
  const componentCase = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].rights_basis = "licensed";
  });
  assert.throws(
    () => validate(componentCase),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_component_0_rights_basis_invalid"),
  );

  const reviewCase = rewriteEvidence(fixture(), (evidence) => {
    evidence.review_status = "accepted";
  });
  assert.throws(
    () => validate(reviewCase),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_rights_review_status_invalid"),
  );
});

test("rejects incomplete, nonofficial or differently scoped rights-review evidence", () => {
  const wrongSchema = rewriteEvidence(fixture(), (evidence) => {
    evidence.schema_version = "pulse-governed-rights-review-evidence-v0";
  });
  assert.throws(
    () => validate(wrongSchema),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_rights_review_schema_invalid"),
  );

  const wrongPublisher = rewriteEvidence(fixture(), (evidence) => {
    evidence.publisher = "Fan channel";
  });
  assert.throws(
    () => validate(wrongPublisher),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes("source_media_rights_review_publisher_invalid"),
  );

  const wrongLicenceHost = rewriteEvidence(fixture(), (evidence) => {
    evidence.licence_evidence_url =
      "https://square-enix.example/rule.php";
  });
  assert.throws(
    () => validate(wrongLicenceHost),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_licence_evidence_url_invalid",
      ),
  );

  const incomplete = rewriteEvidence(fixture(), (evidence) => {
    evidence.scope = "";
  });
  assert.throws(
    () => validate(incomplete),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_evidence_incomplete",
      ),
  );
});

test("rejects contradictory or incomplete decision-critical FFXIV licence findings", () => {
  const cases = [
    {
      mutate(evidence) {
        evidence.licence_effective_date = "2025-01-01";
      },
      code: "source_media_rights_review_licence_effective_date_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.covered_materials = ["screenshots"];
      },
      code: "source_media_rights_review_covered_materials_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.permitted_destination = "Personal sites only";
      },
      code: "source_media_rights_review_permitted_destination_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.copyright_notice = "Square Enix";
      },
      code: "source_media_rights_review_copyright_notice_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.copyright_notice_delivery = ["DESCRIPTION"];
      },
      code: "source_media_rights_review_copyright_notice_delivery_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.third_party_music_used = true;
      },
      code: "source_media_rights_review_third_party_music_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.source_audio_used = true;
      },
      code: "source_media_rights_review_source_audio_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.raw_asset_redistribution = true;
      },
      code: "source_media_rights_review_raw_asset_redistribution_invalid",
    },
    {
      mutate(evidence) {
        evidence.findings.removal_request_must_be_honoured = false;
      },
      code: "source_media_rights_review_removal_request_invalid",
    },
  ];

  for (const current of cases) {
    const input = rewriteEvidence(fixture(), current.mutate);
    assert.throws(
      () => validate(input),
      (error) =>
        error instanceof GovernedSourceMediaError &&
        error.codes.includes(current.code),
      current.code,
    );
  }
});

test("rejects rights evidence and media assets outside the manifest directory", () => {
  const escapedRights = fixture();
  const outsideRightsPath = path.join(
    path.dirname(escapedRights.root),
    `${path.basename(escapedRights.root)}-outside-rights.json`,
  );
  const rightsBytes = fs.readFileSync(escapedRights.evidencePath);
  fs.writeFileSync(outsideRightsPath, rightsBytes);
  rewriteManifest(escapedRights, (manifest) => {
    manifest.rights_review.path = path.relative(
      escapedRights.root,
      outsideRightsPath,
    );
    manifest.rights_review.sha256 = sha256(rightsBytes);
  });
  assert.throws(
    () => validate(escapedRights),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_path_escape",
      ),
  );

  const escapedAsset = fixture();
  const outsideAssetPath = path.join(
    path.dirname(escapedAsset.root),
    `${path.basename(escapedAsset.root)}-outside-asset.png`,
  );
  fs.writeFileSync(outsideAssetPath, ONE_PIXEL_PNG);
  rewriteManifest(escapedAsset, (manifest) => {
    manifest.components[0].asset.path = path.relative(
      escapedAsset.root,
      outsideAssetPath,
    );
    manifest.components[0].asset.sha256 = sha256(ONE_PIXEL_PNG);
  });
  assert.throws(
    () => validate(escapedAsset),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_asset_path_escape",
      ),
  );
});

test("rejects symlinked governed inputs even when their targets stay inside the manifest directory", (t) => {
  if (process.platform === "win32") {
    const probeRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "pulse-source-symlink-probe-"),
    );
    const target = path.join(probeRoot, "target.json");
    const link = path.join(probeRoot, "link.json");
    fs.writeFileSync(target, "{}");
    try {
      fs.symlinkSync(target, link, "file");
    } catch {
      t.skip("Windows symlink creation is unavailable");
      return;
    }
  }

  const input = fixture();
  const linkedEvidencePath = path.join(
    input.root,
    "evidence",
    "linked-rights-review.json",
  );
  fs.symlinkSync(input.evidencePath, linkedEvidencePath, "file");
  rewriteManifest(input, (manifest) => {
    manifest.rights_review.path = path.relative(
      input.root,
      linkedEvidencePath,
    );
  });
  assert.throws(
    () => validate(input),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_rights_review_file_invalid",
      ),
  );
});

test("fully decodes images and rejects a dimension-bearing but truncated JPEG", () => {
  const input = fixture();
  const truncatedJpeg = Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xc0,
    0x00,
    0x08,
    0x08,
    0x00,
    0x01,
    0x00,
    0x01,
    0x01,
  ]);
  const assetPath = path.join(
    input.root,
    "assets",
    "truncated.jpg",
  );
  fs.writeFileSync(assetPath, truncatedJpeg);
  rewriteManifest(input, (manifest) => {
    manifest.components[0].asset = {
      path: path.relative(input.root, assetPath),
      sha256: sha256(truncatedJpeg),
      width: 1,
      height: 1,
      mime_type: "image/jpeg",
    };
  });

  assert.throws(
    () => validate(input),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_asset_media_invalid",
      ),
  );
});

test("binds the reviewed official YouTube thumbnail to the exact FFXIV video", () => {
  const input = rewriteManifest(fixture(), (manifest) => {
    manifest.components[0].source.direct_media_url =
      "https://i.ytimg.com/vi/unreviewed-video/maxresdefault.jpg";
  });

  assert.throws(
    () => validate(input),
    (error) =>
      error instanceof GovernedSourceMediaError &&
      error.codes.includes(
        "source_media_component_0_direct_media_url_invalid",
      ),
  );
});
