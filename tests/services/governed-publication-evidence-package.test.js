"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const {
  validatePublicationReviewManifest,
} = require("../../lib/services/governed-publication-review");
const {
  executeGovernedPublicationEvidencePackage,
} = require("../../lib/services/governed-publication-evidence-package");
const {
  METADATA_SCHEMA,
} = require("../../lib/services/governed-publication-metadata");
const {
  ATTRIBUTION_TEXT,
  MANIFEST_SCHEMA: SOURCE_MEDIA_MANIFEST_SCHEMA,
} = require("../../lib/services/governed-source-media");

const STORY_ID = "official_d86953ca92ca";
const CHANNEL_ID = "pulse-gaming";
const GENERATED_AT = "2026-07-27T17:00:00.000Z";
const APPROVED_AT = "2026-07-27T17:05:00.000Z";
const DISCLOSURE_CONFIRMATION = "DISCLOSE_AND_SET_YOUTUBE_TRUE";
const SCRIPT =
  "Final Fantasy XIV just revealed a tank that fights with two giant shields. Bastion arrives in Evercold and only works in Evolved Mode.";
const LICENCE_URL =
  "https://support.eu.square-enix.com/rule.php?id=5383&la=2&tag=authc";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function file(root, name, value) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
  return {
    path: name.replace(/\\/g, "/"),
    absolutePath: filePath,
    sha256: sha256(fs.readFileSync(filePath)),
  };
}

function jsonFile(root, name, value) {
  const filePath = path.join(root, name);
  writeJson(filePath, value);
  return {
    path: name.replace(/\\/g, "/"),
    absolutePath: filePath,
    sha256: sha256(fs.readFileSync(filePath)),
    value,
  };
}

function validProbe() {
  return {
    streams: [
      {
        codec_type: "video",
        codec_name: "h264",
        profile: "High",
        pix_fmt: "yuv420p",
        width: 1080,
        height: 1920,
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
      },
    ],
    format: { duration: "28.000000" },
  };
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-evidence-package-"),
  );
  const scriptSha256 = sha256(SCRIPT);
  const source = jsonFile(root, "source-evidence.json", {
    schema_version: "pulse-source-evidence-v1",
    source_url: "https://example.test/official-evercold",
    source_type: "official",
    publisher: "Square Enix Ltd.",
    published_at: "2026-07-27T09:00:00.000Z",
    claims: ["Bastion is a new tank job."],
  });
  const intake = jsonFile(root, "story-intake.json", {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: source.value.source_url,
    source_type: "official",
    source_evidence_path: source.path,
    source_evidence_sha256: source.sha256,
    story: {
      id: STORY_ID,
      channel_id: CHANNEL_ID,
      title: "Final Fantasy XIV reveals Bastion",
      full_script: SCRIPT,
      script_sha256: scriptSha256,
      visual_brief: {
        format: "owned-motion-only",
        source_media_policy: "OWNED_ONLY",
        forbidden_media: [
          "third-party screenshots",
          "gameplay footage",
          "trailers",
        ],
      },
    },
  });
  const publicationMetadata = jsonFile(
    root,
    "publication-metadata.json",
    {
      schema_version: METADATA_SCHEMA,
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      platform: "youtube_shorts",
      title: "Final Fantasy XIV reveals Bastion",
      description:
        "Bastion arrives in Final Fantasy XIV's Evercold update.",
    },
  );
  const motion = file(root, "evercold-hf.mp4", "owned-hyperframes-video");
  const narration = file(root, "narration.mp3", "licensed-narration");
  const finalMp4 = file(root, "final.mp4", "final-composite-video");
  const sourceTimestamps = jsonFile(root, "narration-word-timestamps.json", {
    schema_version: "pulse-word-timestamps-v1",
    story_id: STORY_ID,
    script_sha256: scriptSha256,
    source_alignment_sha256: "d".repeat(64),
    audio_sha256: narration.sha256,
    audio_duration_seconds: 23.5,
    word_count: 2,
    words: [
      { text: "Final", start_seconds: 0, end_seconds: 0.25 },
      { text: "Fantasy", start_seconds: 0.25, end_seconds: 0.55 },
    ],
  });
  const timestamps = jsonFile(root, "word-timestamps.json", {
    schema_version: "pulse-word-timestamps-v1",
    story_id: STORY_ID,
    script_sha256: scriptSha256,
    source_alignment_sha256: "d".repeat(64),
    audio_sha256: narration.sha256,
    audio_duration_seconds: 23.5,
    word_count: 2,
    transcript: SCRIPT,
    words: [
      { text: "Final", start_seconds: 0, end_seconds: 0.25 },
      { text: "Fantasy", start_seconds: 0.25, end_seconds: 0.55 },
    ],
    source: {
      path: sourceTimestamps.path,
      sha256: sourceTimestamps.sha256,
    },
  });
  const ownedMotion = jsonFile(root, "combined-owned-motion-manifest.json", {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    assets: [
      {
        path: motion.path,
        sha256: motion.sha256,
        media_type: "video",
        role: "hyperframes_intermediate",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
        width: 1080,
        height: 1920,
        duration_seconds: 28,
        generator_identity: "hyperframes@0.7.76",
        provenance: {
          source: "hyperframes_material_stage",
          third_party_media_used: false,
        },
      },
    ],
  });
  const narrationManifest = jsonFile(root, "governed-narration-manifest.json", {
    schema_version: "pulse-governed-narration-manifest-v1",
    story_id: STORY_ID,
    script: {
      sha256: scriptSha256,
      aligned_text_sha256: scriptSha256,
      exact_alignment_match: true,
    },
    narration: {
      duration_seconds: 23.5,
      provider: "elevenlabs",
      voice_id: "licensed-voice",
      model_id: "eleven_multilingual_v2",
      provider_metadata_basis: "operator_attestation",
    },
    licence: {
      rights_basis: "LICENSED",
      evidence_reference:
        "operator-attestation://channel-owner/elevenlabs-full-subscription",
      attested_by: "channel-owner",
      attested_at: "2026-07-27T16:00:00.000Z",
      evidence_scope:
        "Operator subscription and permitted-use attestation reference",
    },
    sources: {
      audio: {
        path: narration.absolutePath,
        expected_sha256: narration.sha256,
        pre_apply_sha256: narration.sha256,
        post_apply_sha256: narration.sha256,
        copied: false,
        mutated: false,
      },
    },
    outputs: {
      word_timestamps: {
        path: sourceTimestamps.path,
        schema_version: "pulse-word-timestamps-v1",
        sha256: sourceTimestamps.sha256,
        word_count: 2,
      },
    },
    controls: {
      operating_mode: "HUMAN_REVIEW",
      emergency_kill_switch_tripped: true,
      auto_publish_enabled: false,
      live_dispatch_enabled: false,
      external_publish_authorised: false,
      database_mutation_authorised: false,
      oauth_mutation_authorised: false,
      network_used: false,
    },
  });
  const rendererInputs = [
    {
      component_id: "hyperframes-intermediate",
      role: "motion",
      path: motion.path,
      sha256: motion.sha256,
      embedded_in_final: true,
    },
    {
      component_id: "narration",
      role: "narration",
      path: narration.path,
      sha256: narration.sha256,
      embedded_in_final: true,
    },
    {
      component_id: "word-timestamps",
      role: "word_timestamps",
      path: timestamps.path,
      sha256: timestamps.sha256,
      embedded_in_final: false,
    },
  ];
  const rendererValue = {
    schema_version: "pulse-render-manifest-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    renderer: {
      id: "studio-v21",
      role: "standard",
      version: "2.1.0",
    },
    stack: { hyperframes: true, ffmpeg: true },
    output: {
      path: finalMp4.path,
      sha256: finalMp4.sha256,
      width: 1080,
      height: 1920,
      aspect_ratio: "9:16",
      video_codec: "h264",
      video_profile: "High",
      pixel_format: "yuv420p",
      audio_codec: "aac",
      audio_sample_rate_hz: 48000,
      has_audio: true,
      duration_seconds: 28,
      ffprobe_passed: true,
      platform_video_qa_result: "pass",
    },
    timing: {
      first_frame_exact_subject: true,
      hook_visible_by_ms: 200,
      consequence_by_ms: 1100,
      proof_by_ms: 2600,
    },
    motion: {
      scene_count: 6,
      motion_scene_count: 6,
      exact_subject_clip_count: 1,
      exact_subject_still_motion_count: 5,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    inputs: rendererInputs,
  };
  const renderer = jsonFile(root, "renderer-manifest.json", rendererValue);
  const rendererCanonicalSha256 = fingerprintRendererManifest(rendererValue);
  const qa = jsonFile(root, "final-render-qa.json", {
    schema_version: "pulse-final-render-qa-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    verdict: "PASS",
    media_sha256: finalMp4.sha256,
    script_sha256: scriptSha256,
    renderer_manifest_sha256: rendererCanonicalSha256,
    audio: {
      source_sha256: narration.sha256,
      governed_manifest_sha256: narrationManifest.sha256,
      rights_basis: "LICENSED",
      background_music_used: false,
      sound_effects_used: false,
    },
  });
  const composite = jsonFile(root, "final-composite-manifest.json", {
    schema_version: "pulse-governed-final-composite-v1",
    mode: "LOCAL_PROOF",
    verdict: "MATERIALIZED_LOCAL_PROOF",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    script_sha256: scriptSha256,
    renderer_identity: "studio-v21",
    publish_authorised: false,
    human_visual_review_required: true,
    ffmpeg: {
      final_composite: true,
      background_music_used: false,
      sound_effects_used: false,
    },
    inputs: {
      story_intake: {
        path: intake.path,
        sha256: intake.sha256,
      },
      owned_motion_manifest: {
        path: ownedMotion.path,
        sha256: ownedMotion.sha256,
      },
      hyperframes_intermediate: {
        path: motion.path,
        sha256: motion.sha256,
      },
      narration_audio: {
        path: narration.path,
        sha256: narration.sha256,
      },
      word_timestamps: {
        path: timestamps.path,
        sha256: timestamps.sha256,
      },
    },
    renderer_manifest: {
      path: renderer.path,
      file_sha256: renderer.sha256,
      canonical_sha256: rendererCanonicalSha256,
    },
    qa_report: {
      path: qa.path,
      sha256: qa.sha256,
      verdict: "PASS",
    },
    output: {
      path: finalMp4.path,
      sha256: finalMp4.sha256,
      size_bytes: fs.statSync(finalMp4.absolutePath).size,
    },
    safety: {
      external_calls: [],
      database_mutated: false,
      oauth_or_tokens_mutated: false,
      platform_objects_created: false,
      live_publish_attempted: false,
      network_used: false,
    },
  });
  const options = {
    storyIntakePath: intake.absolutePath,
    sourceEvidencePath: source.absolutePath,
    ownedMotionManifestPath: ownedMotion.absolutePath,
    governedNarrationManifestPath: narrationManifest.absolutePath,
    finalCompositeManifestPath: composite.absolutePath,
    rendererManifestPath: renderer.absolutePath,
    qaReportPath: qa.absolutePath,
    finalMp4Path: finalMp4.absolutePath,
    publicationMetadataPath: publicationMetadata.absolutePath,
    publicationMetadataSha256: publicationMetadata.sha256,
    outDir: root,
    generatedAt: GENERATED_AT,
  };
  const humanApproval = {
    actor: "channel-owner",
    approvedAt: APPROVED_AT,
    confirmStoryId: STORY_ID,
    confirmMediaSha256: finalMp4.sha256,
    confirmScriptSha256: scriptSha256,
    confirmRendererCanonicalSha256: rendererCanonicalSha256,
    disclosureConfirmation: DISCLOSURE_CONFIRMATION,
  };
  return {
    root,
    options,
    humanApproval,
    finalMp4,
    rendererCanonicalSha256,
    scriptSha256,
    ownedMotion,
    narration,
    qa,
    composite,
    sourceTimestamps,
    timestamps,
    publicationMetadata,
  };
}

function addLicensedSourceMedia(values) {
  const sourceMediaAsset = file(
    values.root,
    "official/bastion-gameplay.png",
    TINY_PNG,
  );
  const rightsReview = jsonFile(
    values.root,
    "official/source-media-rights-review.json",
    {
      schema_version: "pulse-governed-rights-review-evidence-v1",
      story_id: STORY_ID,
      review_status: "ACCEPTED",
      rights_basis: "LICENSED",
      publisher: "Square Enix",
      licence_evidence_url: LICENCE_URL,
      licence_effective_date: "2026-05-07",
      reviewed_by: "pulse-editorial-rights-review",
      reviewed_at: GENERATED_AT,
      scope:
        "Official FINAL FANTASY XIV gameplay used in a narrated, edited news report.",
      findings: {
        covered_materials: [
          "art",
          "images",
          "screenshots",
          "video",
        ],
        permitted_destination:
          "YouTube and comparable social-network partner programmes",
        copyright_notice: ATTRIBUTION_TEXT,
        copyright_notice_delivery: ["DESCRIPTION", "ON_SCREEN"],
        third_party_music_used: false,
        source_audio_used: false,
        raw_asset_redistribution: false,
        removal_request_must_be_honoured: true,
      },
    },
  );
  const sourceMedia = jsonFile(
    values.root,
    "official/source-media-manifest.json",
    {
      schema_version: SOURCE_MEDIA_MANIFEST_SCHEMA,
      story_id: STORY_ID,
      rights_review: {
        path: path.relative(
          path.dirname(
            path.join(values.root, "official/source-media-manifest.json"),
          ),
          rightsReview.absolutePath,
        ),
        sha256: rightsReview.sha256,
        review_status: "ACCEPTED",
      },
      components: [
        {
          component_id: "bastion-gameplay-01",
          media_type: "IMAGE",
          asset: {
            path: path.relative(
              path.dirname(
                path.join(
                  values.root,
                  "official/source-media-manifest.json",
                ),
              ),
              sourceMediaAsset.absolutePath,
            ),
            sha256: sourceMediaAsset.sha256,
            width: 1,
            height: 1,
            mime_type: "image/png",
          },
          source: {
            page_url:
              "https://eu.finalfantasyxiv.com/evercold/media/",
          direct_media_url:
              "https://lds-img.finalfantasyxiv.com/promo/h/a/test.png",
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
            purpose: "TRANSFORMATIVE_EDITORIAL",
            third_party_music_used: false,
            source_audio_disposition: "NOT_APPLICABLE",
            usage_seconds: [0, 2],
          },
        },
      ],
    },
  );

  const intake = JSON.parse(
    fs.readFileSync(values.options.storyIntakePath, "utf8"),
  );
  intake.story.visual_brief = {
    format: "governed-hybrid-editorial",
    source_media_policy: "LICENSED_OFFICIAL_FFXIV",
  };
  writeJson(values.options.storyIntakePath, intake);

  const publicationMetadata = JSON.parse(
    fs.readFileSync(values.options.publicationMetadataPath, "utf8"),
  );
  publicationMetadata.description = [
    publicationMetadata.description,
    "",
    ATTRIBUTION_TEXT,
  ].join("\n");
  writeJson(
    values.options.publicationMetadataPath,
    publicationMetadata,
  );
  values.options.publicationMetadataSha256 = sha256(
    fs.readFileSync(values.options.publicationMetadataPath),
  );
  values.publicationMetadata.sha256 =
    values.options.publicationMetadataSha256;
  values.publicationMetadata.value = publicationMetadata;

  const ownedMotion = JSON.parse(
    fs.readFileSync(values.options.ownedMotionManifestPath, "utf8"),
  );
  const hyperframes = ownedMotion.assets[0];
  hyperframes.ownership = "mixed";
  hyperframes.rights_basis = "LICENSED";
  hyperframes.attribution_required = true;
  hyperframes.provenance.third_party_media_used = true;
  hyperframes.provenance.source_media_manifest = {
    path: path.relative(
      path.dirname(values.options.ownedMotionManifestPath),
      sourceMedia.absolutePath,
    ),
    sha256: sourceMedia.sha256,
  };
  writeJson(values.options.ownedMotionManifestPath, ownedMotion);
  values.ownedMotion.sha256 = sha256(
    fs.readFileSync(values.options.ownedMotionManifestPath),
  );

  const renderer = JSON.parse(
    fs.readFileSync(values.options.rendererManifestPath, "utf8"),
  );
  renderer.inputs.push({
    component_id: "bastion-gameplay-01",
    role: "source_media",
    path: path.relative(
      path.dirname(values.options.rendererManifestPath),
      sourceMediaAsset.absolutePath,
    ),
    sha256: sourceMediaAsset.sha256,
    embedded_in_final: true,
  });
  writeJson(values.options.rendererManifestPath, renderer);
  const rendererFileSha256 = sha256(
    fs.readFileSync(values.options.rendererManifestPath),
  );
  const rendererCanonicalSha256 =
    fingerprintRendererManifest(renderer);

  const qa = JSON.parse(
    fs.readFileSync(values.options.qaReportPath, "utf8"),
  );
  qa.renderer_manifest_sha256 = rendererCanonicalSha256;
  writeJson(values.options.qaReportPath, qa);
  values.qa.sha256 = sha256(
    fs.readFileSync(values.options.qaReportPath),
  );

  const composite = JSON.parse(
    fs.readFileSync(values.options.finalCompositeManifestPath, "utf8"),
  );
  composite.inputs.story_intake.sha256 = sha256(
    fs.readFileSync(values.options.storyIntakePath),
  );
  composite.inputs.owned_motion_manifest.sha256 =
    values.ownedMotion.sha256;
  composite.inputs.source_media_manifest = {
    path: path.relative(
      path.dirname(values.options.finalCompositeManifestPath),
      sourceMedia.absolutePath,
    ),
    sha256: sourceMedia.sha256,
  };
  composite.hyperframes = {
    third_party_media_used: true,
  };
  composite.source_media = {
    policy: "LICENSED_OFFICIAL_FFXIV",
    manifest: {
      path: path.relative(
        path.dirname(values.options.finalCompositeManifestPath),
        sourceMedia.absolutePath,
      ),
      sha256: sourceMedia.sha256,
    },
    rights_review: {
      path: path.relative(
        path.dirname(values.options.finalCompositeManifestPath),
        rightsReview.absolutePath,
      ),
      sha256: rightsReview.sha256,
    },
    components: [
      {
        component_id: "bastion-gameplay-01",
        path: path.relative(
          path.dirname(values.options.finalCompositeManifestPath),
          sourceMediaAsset.absolutePath,
        ),
        sha256: sourceMediaAsset.sha256,
        attribution: {
          required: true,
          text: ATTRIBUTION_TEXT,
        },
      },
    ],
  };
  composite.renderer_manifest.file_sha256 = rendererFileSha256;
  composite.renderer_manifest.canonical_sha256 =
    rendererCanonicalSha256;
  composite.qa_report.sha256 = values.qa.sha256;
  writeJson(values.options.finalCompositeManifestPath, composite);

  values.options.sourceMediaManifestPath = sourceMedia.absolutePath;
  values.options.sourceMediaManifestSha256 = sourceMedia.sha256;
  values.sourceMedia = sourceMedia;
  values.sourceMediaAsset = sourceMediaAsset;
  values.rendererCanonicalSha256 = rendererCanonicalSha256;
  values.humanApproval.confirmRendererCanonicalSha256 =
    rendererCanonicalSha256;
  return values;
}

test("dry-run validates and plans without writing or inferring human approval", async () => {
  const values = fixture();
  try {
    const result = await executeGovernedPublicationEvidencePackage(
      values.options,
    );
    assert.equal(result.mode, "DRY_RUN");
    assert.equal(result.verdict, "VALIDATED_DRY_RUN");
    assert.equal(result.mutated, false);
    assert.equal(result.human_approval.required_for_apply, true);
    assert.equal(result.human_approval.supplied, false);
    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.media_sha256, values.finalMp4.sha256);
    for (const outputPath of Object.values(result.planned_outputs)) {
      assert.equal(fs.existsSync(outputPath), false);
    }
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("owned-only intake must declare its explicit source-media policy", async () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.options.storyIntakePath, "utf8"),
    );
    delete intake.story.visual_brief.source_media_policy;
    writeJson(values.options.storyIntakePath, intake);
    const composite = JSON.parse(
      fs.readFileSync(
        values.options.finalCompositeManifestPath,
        "utf8",
      ),
    );
    composite.inputs.story_intake.sha256 = sha256(
      fs.readFileSync(values.options.storyIntakePath),
    );
    writeJson(
      values.options.finalCompositeManifestPath,
      composite,
    );

    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(
          error.codes.includes(
            "story_intake_source_media_policy_invalid",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("licensed intake requires the exact source-media manifest path and hash", async () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.options.storyIntakePath, "utf8"),
    );
    intake.story.visual_brief.source_media_policy =
      "LICENSED_OFFICIAL_FFXIV";
    writeJson(values.options.storyIntakePath, intake);
    const composite = JSON.parse(
      fs.readFileSync(
        values.options.finalCompositeManifestPath,
        "utf8",
      ),
    );
    composite.inputs.story_intake.sha256 = sha256(
      fs.readFileSync(values.options.storyIntakePath),
    );
    writeJson(
      values.options.finalCompositeManifestPath,
      composite,
    );

    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(
          error.codes.includes("source_media_manifest_path_required"),
        );
        assert.ok(
          error.codes.includes(
            "source_media_manifest_sha256_required",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("publication metadata is mandatory, independently hash-bound and fail-closed", async () => {
  const missing = fixture();
  try {
    await assert.rejects(
      executeGovernedPublicationEvidencePackage({
        ...missing.options,
        publicationMetadataPath: undefined,
        publicationMetadataSha256: undefined,
      }),
      (error) => {
        assert.ok(
          error.codes.includes("publication_metadata_path_required"),
        );
        assert.ok(
          error.codes.includes("publication_metadata_sha256_required"),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(missing.root, { recursive: true, force: true });
  }

  const tampered = fixture();
  try {
    fs.appendFileSync(
      tampered.options.publicationMetadataPath,
      " ",
      "utf8",
    );
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(tampered.options),
      (error) => {
        assert.ok(
          error.codes.includes(
            "publication_metadata_sha256_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(tampered.root, { recursive: true, force: true });
  }
});

test("licensed source media cannot claim supplied attribution unless publication description contains the exact notice", async () => {
  const values = addLicensedSourceMedia(fixture());
  try {
    const metadata = JSON.parse(
      fs.readFileSync(values.options.publicationMetadataPath, "utf8"),
    );
    metadata.description =
      "Bastion arrives in Final Fantasy XIV's Evercold update.";
    writeJson(values.options.publicationMetadataPath, metadata);
    values.options.publicationMetadataSha256 = sha256(
      fs.readFileSync(values.options.publicationMetadataPath),
    );

    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(
          error.codes.includes(
            "publication_metadata_description_attribution_missing",
          ),
        );
        return true;
      },
    );
    assert.equal(
      fs.existsSync(
        path.join(values.root, "publication-review.json"),
      ),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("dry-run accepts exact licensed official FFXIV source media without weakening owned-only controls", async () => {
  const values = addLicensedSourceMedia(fixture());
  try {
    const result = await executeGovernedPublicationEvidencePackage(
      values.options,
    );
    assert.equal(result.verdict, "VALIDATED_DRY_RUN");
    assert.equal(
      result.source_media_manifest_sha256,
      values.sourceMedia.sha256,
    );
    assert.equal(result.third_party_media_used, true);
    assert.equal(result.attribution_required, true);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("source-media inputs fail closed when incomplete, policy-mismatched or hash-tampered", async () => {
  const incomplete = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(incomplete.options.storyIntakePath, "utf8"),
    );
    intake.story.visual_brief.source_media_policy =
      "LICENSED_OFFICIAL_FFXIV";
    writeJson(incomplete.options.storyIntakePath, intake);
    const composite = JSON.parse(
      fs.readFileSync(
        incomplete.options.finalCompositeManifestPath,
        "utf8",
      ),
    );
    composite.inputs.story_intake.sha256 = sha256(
      fs.readFileSync(incomplete.options.storyIntakePath),
    );
    writeJson(
      incomplete.options.finalCompositeManifestPath,
      composite,
    );
    await assert.rejects(
      executeGovernedPublicationEvidencePackage({
        ...incomplete.options,
        sourceMediaManifestPath: "missing.json",
      }),
      (error) => {
        assert.ok(
          error.codes.includes("source_media_manifest_pair_required"),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(incomplete.root, { recursive: true, force: true });
  }

  const policyMismatch = addLicensedSourceMedia(fixture());
  try {
    const intake = JSON.parse(
      fs.readFileSync(policyMismatch.options.storyIntakePath, "utf8"),
    );
    intake.story.visual_brief.source_media_policy = "ATTRIBUTION_ONLY";
    writeJson(policyMismatch.options.storyIntakePath, intake);
    const composite = JSON.parse(
      fs.readFileSync(
        policyMismatch.options.finalCompositeManifestPath,
        "utf8",
      ),
    );
    composite.inputs.story_intake.sha256 = sha256(
      fs.readFileSync(policyMismatch.options.storyIntakePath),
    );
    writeJson(
      policyMismatch.options.finalCompositeManifestPath,
      composite,
    );
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(
        policyMismatch.options,
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "story_intake_source_media_policy_invalid",
          ),
        );
        return true;
      },
    );

    intake.story.visual_brief.source_media_policy =
      "LICENSED_OFFICIAL_FFXIV";
    writeJson(policyMismatch.options.storyIntakePath, intake);
    composite.inputs.story_intake.sha256 = sha256(
      fs.readFileSync(policyMismatch.options.storyIntakePath),
    );
    writeJson(
      policyMismatch.options.finalCompositeManifestPath,
      composite,
    );
    policyMismatch.options.sourceMediaManifestSha256 = "f".repeat(64);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(
        policyMismatch.options,
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "source_media_manifest_sha256_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(policyMismatch.root, {
      recursive: true,
      force: true,
    });
  }
});

test("licensed source media must remain exactly bound to mixed motion and one-to-one renderer inputs", async () => {
  const values = addLicensedSourceMedia(fixture());
  try {
    const ownedMotion = JSON.parse(
      fs.readFileSync(values.options.ownedMotionManifestPath, "utf8"),
    );
    ownedMotion.assets[0].provenance.source_media_manifest.sha256 =
      "f".repeat(64);
    writeJson(values.options.ownedMotionManifestPath, ownedMotion);
    const ownedMotionSha = sha256(
      fs.readFileSync(values.options.ownedMotionManifestPath),
    );
    const composite = JSON.parse(
      fs.readFileSync(values.options.finalCompositeManifestPath, "utf8"),
    );
    composite.inputs.owned_motion_manifest.sha256 = ownedMotionSha;
    writeJson(values.options.finalCompositeManifestPath, composite);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(
          error.codes.includes(
            "mixed_motion_source_media_manifest_sha256_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }

  const rendererMismatch = addLicensedSourceMedia(fixture());
  try {
    const renderer = JSON.parse(
      fs.readFileSync(
        rendererMismatch.options.rendererManifestPath,
        "utf8",
      ),
    );
    renderer.inputs.find(
      (input) => input.role === "source_media",
    ).component_id = "unexpected-source-media";
    writeJson(rendererMismatch.options.rendererManifestPath, renderer);
    const rendererSha = sha256(
      fs.readFileSync(rendererMismatch.options.rendererManifestPath),
    );
    const rendererCanonicalSha =
      fingerprintRendererManifest(renderer);
    const qa = JSON.parse(
      fs.readFileSync(rendererMismatch.options.qaReportPath, "utf8"),
    );
    qa.renderer_manifest_sha256 = rendererCanonicalSha;
    writeJson(rendererMismatch.options.qaReportPath, qa);
    const composite = JSON.parse(
      fs.readFileSync(
        rendererMismatch.options.finalCompositeManifestPath,
        "utf8",
      ),
    );
    composite.renderer_manifest.file_sha256 = rendererSha;
    composite.renderer_manifest.canonical_sha256 =
      rendererCanonicalSha;
    composite.qa_report.sha256 = sha256(
      fs.readFileSync(rendererMismatch.options.qaReportPath),
    );
    writeJson(
      rendererMismatch.options.finalCompositeManifestPath,
      composite,
    );
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(
        rendererMismatch.options,
      ),
      (error) => {
        assert.ok(
          error.codes.includes("renderer_source_media_inputs_mismatch"),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(rendererMismatch.root, {
      recursive: true,
      force: true,
    });
  }
});

test("normalised renderer timestamps bind the exact governed source timestamp artefact", async () => {
  const values = fixture();
  try {
    assert.notEqual(values.sourceTimestamps.sha256, values.timestamps.sha256);
    const result = await executeGovernedPublicationEvidencePackage(
      values.options,
    );
    assert.equal(result.verdict, "VALIDATED_DRY_RUN");
    assert.equal(
      result.timestamp_lineage.source_sha256,
      values.sourceTimestamps.sha256,
    );
    assert.equal(
      result.timestamp_lineage.normalised_sha256,
      values.timestamps.sha256,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("apply fails closed unless every exact human approval field is supplied", async () => {
  const values = fixture();
  try {
    await assert.rejects(
      executeGovernedPublicationEvidencePackage({
        ...values.options,
        apply: true,
      }),
      (error) => {
        for (const code of [
          "human_approval_actor_required",
          "human_approval_timestamp_required",
          "human_approval_story_id_mismatch",
          "human_approval_media_sha256_mismatch",
          "human_approval_script_sha256_mismatch",
          "human_approval_renderer_canonical_sha256_mismatch",
          "human_approval_disclosure_confirmation_required",
        ]) {
          assert.ok(error.codes.includes(code), code);
        }
        return true;
      },
    );
    await assert.rejects(
      executeGovernedPublicationEvidencePackage({
        ...values.options,
        apply: true,
        humanApproval: {
          ...values.humanApproval,
          confirmMediaSha256: "f".repeat(64),
          disclosureConfirmation: undefined,
        },
      }),
      (error) => {
        assert.deepEqual(
          new Set(error.codes),
          new Set([
            "human_approval_media_sha256_mismatch",
            "human_approval_disclosure_confirmation_required",
          ]),
        );
        return true;
      },
    );
    assert.equal(
      fs.existsSync(path.join(values.root, "publication-review.json")),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("apply writes a complete evidence package directly accepted by governed publication review", async () => {
  const values = fixture();
  try {
    const result = await executeGovernedPublicationEvidencePackage({
      ...values.options,
      apply: true,
      humanApproval: values.humanApproval,
    });
    assert.equal(result.mode, "APPLY");
    assert.equal(result.verdict, "PACKAGE_WRITTEN_HUMAN_APPROVED");
    assert.equal(result.mutated, true);
    assert.equal(result.controls.network_used, false);
    assert.equal(result.controls.database_mutated, false);
    assert.equal(result.controls.oauth_or_tokens_mutated, false);
    assert.equal(result.controls.live_publish_attempted, false);
    assert.ok(fs.existsSync(result.package_manifest_path));
    assert.ok(fs.existsSync(result.markdown_path));

    const validation = await validatePublicationReviewManifest({
      manifestPath: result.publication_review_path,
      probe: async () => validProbe(),
    });
    assert.equal(validation.storyId, STORY_ID);
    assert.equal(validation.mediaSha256, values.finalMp4.sha256);
    assert.equal(
      validation.renderer.canonicalSha256,
      values.rendererCanonicalSha256,
    );
    assert.equal(
      validation.publicationMetadata.sha256,
      values.publicationMetadata.sha256,
    );

    const review = JSON.parse(
      fs.readFileSync(result.publication_review_path, "utf8"),
    );
    assert.equal(review.synthetic_media_disclosure.decision, "DISCLOSE");
    assert.equal(review.synthetic_media_disclosure.youtube_field_value, true);
    assert.deepEqual(review.publication_metadata, {
      path: values.publicationMetadata.path,
      sha256: values.publicationMetadata.sha256,
      platform: "youtube_shorts",
    });
    assert.deepEqual(review.policy, {
      source_media_policy: "OWNED_ONLY",
      third_party_media_used: false,
      attribution_required: false,
    });
    const rights = JSON.parse(
      fs.readFileSync(result.rights_ledger_path, "utf8"),
    );
    assert.deepEqual(rights.items.map((item) => item.item_id).sort(), [
      "hyperframes-intermediate",
      "narration",
    ]);
    assert.ok(
      rights.items.every(
        (item) =>
          item.attribution_decision === "NOT_REQUIRED" &&
          item.attribution_text === null,
      ),
    );
    const packageManifest = JSON.parse(
      fs.readFileSync(result.package_manifest_path, "utf8"),
    );
    assert.equal(packageManifest.policy.third_party_media_used, false);
    assert.equal(packageManifest.policy.background_music_used, false);
    assert.equal(packageManifest.policy.sound_effects_used, false);
    assert.equal(packageManifest.human_approval.actor, "channel-owner");
    assert.equal(
      packageManifest.inputs.final_mp4.sha256,
      values.finalMp4.sha256,
    );
    assert.equal(
      packageManifest.inputs.renderer_manifest.canonical_sha256,
      values.rendererCanonicalSha256,
    );
    assert.equal(
      packageManifest.inputs.publication_metadata.sha256,
      values.publicationMetadata.sha256,
    );
    assert.equal(
      packageManifest.bindings.publication_metadata_sha256,
      values.publicationMetadata.sha256,
    );
    const transformation = JSON.parse(
      fs.readFileSync(result.transformation_evidence_path, "utf8"),
    );
    assert.equal(
      transformation.bindings.publication_metadata.sha256,
      values.publicationMetadata.sha256,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("apply records licensed mixed motion and every governed FFXIV source component with supplied attribution", async () => {
  const values = addLicensedSourceMedia(fixture());
  try {
    const result = await executeGovernedPublicationEvidencePackage({
      ...values.options,
      apply: true,
      humanApproval: values.humanApproval,
    });
    const sourceRights = JSON.parse(
      fs.readFileSync(result.source_media_rights_evidence_path, "utf8"),
    );
    assert.equal(sourceRights.rights_basis, "LICENSED");
    assert.equal(
      sourceRights.manifest_binding.sha256,
      values.sourceMedia.sha256,
    );
    assert.deepEqual(
      sourceRights.components.map((component) => component.component_id),
      ["bastion-gameplay-01"],
    );
    assert.deepEqual(
      sourceRights.description_attribution_evidence,
      {
        publication_metadata: {
          path: values.publicationMetadata.path,
          sha256: values.publicationMetadata.sha256,
          platform: "youtube_shorts",
        },
        notice: ATTRIBUTION_TEXT,
        exact_standalone_line_verified: true,
      },
    );

    const motionRights = JSON.parse(
      fs.readFileSync(
        result.owned_motion_rights_evidence_path,
        "utf8",
      ),
    );
    assert.equal(motionRights.ownership, "mixed");
    assert.equal(motionRights.rights_basis, "LICENSED");
    assert.equal(motionRights.attribution_required, true);
    assert.equal(motionRights.third_party_media_used, true);

    const rights = JSON.parse(
      fs.readFileSync(result.rights_ledger_path, "utf8"),
    );
    const motion = rights.items.find(
      (item) => item.item_id === "hyperframes-intermediate",
    );
    assert.equal(motion.rights_basis, "LICENSED");
    assert.equal(
      motion.attribution_decision,
      "REQUIRED_AND_SUPPLIED",
    );
    assert.equal(motion.attribution_text, ATTRIBUTION_TEXT);
    const sourceItem = rights.items.find(
      (item) => item.item_id === "bastion-gameplay-01",
    );
    assert.equal(sourceItem.rights_basis, "LICENSED");
    assert.equal(
      sourceItem.attribution_decision,
      "REQUIRED_AND_SUPPLIED",
    );
    assert.equal(sourceItem.attribution_text, ATTRIBUTION_TEXT);
    assert.equal(
      sourceItem.asset_sha256,
      values.sourceMediaAsset.sha256,
    );

    const review = JSON.parse(
      fs.readFileSync(result.publication_review_path, "utf8"),
    );
    assert.equal(
      review.source_media_manifest.sha256,
      values.sourceMedia.sha256,
    );
    assert.deepEqual(review.policy, {
      source_media_policy: "LICENSED_OFFICIAL_FFXIV",
      third_party_media_used: true,
      attribution_required: true,
    });
    assert.equal(
      review.publication_metadata.sha256,
      values.publicationMetadata.sha256,
    );
    const validation = await validatePublicationReviewManifest({
      manifestPath: result.publication_review_path,
      probe: async () => validProbe(),
    });
    assert.equal(
      validation.sourceMedia.manifest_sha256,
      values.sourceMedia.sha256,
    );
    assert.equal(
      validation.publicationMetadata.sha256,
      values.publicationMetadata.sha256,
    );
    assert.equal(validation.rendererInputs.length, 4);

    const packageManifest = JSON.parse(
      fs.readFileSync(result.package_manifest_path, "utf8"),
    );
    assert.equal(packageManifest.policy.third_party_media_used, true);
    assert.equal(packageManifest.policy.attribution_required, true);
    assert.equal(
      packageManifest.inputs.source_media_manifest.sha256,
      values.sourceMedia.sha256,
    );
    assert.equal(
      packageManifest.inputs.publication_metadata.sha256,
      values.publicationMetadata.sha256,
    );
    const markdown = fs.readFileSync(result.markdown_path, "utf8");
    assert.match(markdown, /Third-party media used: true/);
    assert.match(markdown, /Attribution required: true/);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("apply never overwrites an existing evidence package", async () => {
  const values = fixture();
  try {
    const first = await executeGovernedPublicationEvidencePackage({
      ...values.options,
      apply: true,
      humanApproval: values.humanApproval,
    });
    const firstBytes = fs.readFileSync(first.package_manifest_path);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage({
        ...values.options,
        apply: true,
        humanApproval: values.humanApproval,
      }),
      (error) => {
        assert.ok(
          error.codes.some((code) =>
            code.startsWith("evidence_output_already_exists:"),
          ),
        );
        return true;
      },
    );
    assert.deepEqual(fs.readFileSync(first.package_manifest_path), firstBytes);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("input tampering and unsafe media declarations block before any package write", async () => {
  const values = fixture();
  try {
    const qa = JSON.parse(fs.readFileSync(values.options.qaReportPath, "utf8"));
    qa.audio.background_music_used = true;
    writeJson(values.options.qaReportPath, qa);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage({
        ...values.options,
        apply: true,
        humanApproval: values.humanApproval,
      }),
      (error) => {
        assert.ok(error.codes.includes("qa_report_sha256_mismatch"));
        assert.ok(error.codes.includes("qa_background_music_must_be_false"));
        return true;
      },
    );
    assert.equal(
      fs.existsSync(path.join(values.root, "rights-ledger.json")),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("owned motion must be owned, unattributed and free of third-party media", async () => {
  const values = fixture();
  try {
    const manifest = JSON.parse(
      fs.readFileSync(values.options.ownedMotionManifestPath, "utf8"),
    );
    manifest.assets[0].provenance.third_party_media_used = true;
    manifest.assets[0].attribution_required = true;
    writeJson(values.options.ownedMotionManifestPath, manifest);
    const composite = JSON.parse(
      fs.readFileSync(values.options.finalCompositeManifestPath, "utf8"),
    );
    composite.inputs.owned_motion_manifest.sha256 = sha256(
      fs.readFileSync(values.options.ownedMotionManifestPath),
    );
    writeJson(values.options.finalCompositeManifestPath, composite);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(error.codes.includes("third_party_media_forbidden"));
        assert.ok(
          error.codes.includes("owned_motion_attribution_must_not_be_required"),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("normalised timestamp source path and hash tampering are refused", async () => {
  const values = fixture();
  try {
    const normalised = JSON.parse(
      fs.readFileSync(values.timestamps.absolutePath, "utf8"),
    );
    normalised.source.sha256 = "f".repeat(64);
    writeJson(values.timestamps.absolutePath, normalised);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(
          error.codes.includes(
            "normalised_word_timestamps_source_sha256_mismatch",
          ),
        );
        return true;
      },
    );

    const replacement = file(
      values.root,
      "substituted-source-timestamps.json",
      fs.readFileSync(values.sourceTimestamps.absolutePath),
    );
    normalised.source = {
      path: replacement.path,
      sha256: replacement.sha256,
    };
    writeJson(values.timestamps.absolutePath, normalised);
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(values.options),
      (error) => {
        assert.ok(
          error.codes.includes(
            "normalised_word_timestamps_source_path_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});
