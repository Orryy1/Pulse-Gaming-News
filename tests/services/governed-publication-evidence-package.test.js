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
  fingerprintRightsRecord,
  validateGovernedLicensedAudioPack,
} = require("../../lib/services/governed-licensed-audio-pack");
const {
  ATTRIBUTION_TEXT,
  MANIFEST_SCHEMA: SOURCE_MEDIA_MANIFEST_SCHEMA,
} = require("../../lib/services/governed-source-media");

const STORY_ID = "official_d86953ca92ca";
const CHANNEL_ID = "pulse-gaming";
const GENERATED_AT = "2026-07-27T15:00:00.000Z";
const APPROVED_AT = "2026-07-27T15:05:00.000Z";
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
  const officialClaim = "Bastion is a new tank job.";
  const officialClaimSha256 = sha256(officialClaim);
  const officialSourceUrl =
    "https://example.test/official-evercold";
  const source = jsonFile(root, "source-evidence.json", {
    schema_version: "pulse-source-evidence-v1",
    story_id: STORY_ID,
    source_url: officialSourceUrl,
    source_type: "official",
    publisher: "Square Enix Ltd.",
    published_at: "2026-07-27T09:00:00.000Z",
    claims: [
      {
        claim_key: "bastion-job",
        text: officialClaim,
        claim_text_sha256: officialClaimSha256,
      },
    ],
    official_source_snapshot: {
      schema_version: "pulse-official-source-snapshot-v1",
      source_url: officialSourceUrl,
      source_id: "square-enix-evercold",
      source_class: "OFFICIAL_FIRST_PARTY",
      canonical_body_algorithm: "pulse-readable-body-v1",
      canonical_body_sha256: officialClaimSha256,
      claims: [
        {
          claim_key: "bastion-job",
          text: officialClaim,
          claim_text_sha256: officialClaimSha256,
        },
      ],
    },
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
    intake,
    source,
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
      generated_at: GENERATED_AT,
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

function replaceLicensedSourceMediaWithGovernedSteamMedia(values) {
  addLicensedSourceMedia(values);

  const manifestDir = path.dirname(values.sourceMedia.absolutePath);
  const relativeToManifest = (filePath) =>
    path.relative(manifestDir, filePath).replace(/\\/g, "/");
  const assetId = "yazd-steam-screenshot-01";
  const attributionText = "Source: Steam / Awesome Games Studio";
  const steamPageUrl =
    "https://store.steampowered.com/app/674750/Yet_Another_Zombie_Defense_HD/";
  const steamMediaUrl =
    "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/674750/ss_c64f69ed658fac18ee8ac772783357b00b8928ed.1920x1080.jpg?t=1780089205";
  const rawAsset = file(
    values.root,
    "official/raw/yazd-steam-screenshot.jpg",
    "official-yazd-steam-screenshot-source",
  );
  fs.mkdirSync(
    path.join(values.root, "official", "game-media"),
    { recursive: true },
  );
  const sourceEvidence = jsonFile(
    values.root,
    "official/game-media/source.json",
    {
      schema_version:
        "pulse-governed-game-media-source-evidence-v1",
      story_id: STORY_ID,
      asset_id: assetId,
      source_class: "OFFICIAL_STEAM_STOREFRONT_ASSET",
      media_kind: "OFFICIAL_SCREENSHOT",
      game: {
        title: "Yet Another Zombie Defense HD",
        publisher: "Awesome Games Studio",
      },
      publisher: "Awesome Games Studio",
      page_url: steamPageUrl,
      story_source_url: steamPageUrl,
      direct_media_url: steamMediaUrl,
      steam_app_id: "674750",
      official_domain_reviewed: true,
      source_asset_sha256: rawAsset.sha256,
      recorded_at: "2026-07-27T14:40:00.000Z",
    },
  );
  const permissionEvidence = jsonFile(
    values.root,
    "official/game-media/permission.json",
    {
      schema_version:
        "pulse-governed-game-media-permission-evidence-v1",
      story_id: STORY_ID,
      asset_id: assetId,
      decision: "ADMITTED",
      review_status: "HUMAN_REVIEW",
      rights_basis: "TRANSFORMATIVE_EDITORIAL_USE",
      rights_holder: "Awesome Games Studio",
      permission_rule_id:
        "steam_storefront_transformative_editorial_risk_review",
      source_platform: "STEAM",
      reviewed_by: "pulse-editorial-rights-review",
      reviewed_at: "2026-07-27T14:45:00.000Z",
      coverage: {
        media_kinds: ["OFFICIAL_SCREENSHOT"],
        destinations: ["YOUTUBE_SHORTS"],
        uses: ["TRANSFORMATIVE_EDITORIAL"],
      },
      attribution: {
        required: true,
        text: attributionText,
        delivery: ["ON_SCREEN", "DESCRIPTION"],
      },
      attribution_is_permission: false,
      operator_risk_decision: {
        decision_type: "HUMAN_REVIEW",
        decision: "ACCEPT_RISK",
        story_id: STORY_ID,
        asset_id: assetId,
        destinations: ["YOUTUBE_SHORTS"],
        use: "TRANSFORMATIVE_EDITORIAL",
        rationale:
          "A short official-store excerpt identifies the exact game and is materially restructured around original reporting. This is an editorial risk decision, not permission or a legal guarantee.",
        reviewed_by: "pulse-editorial-rights-review",
        reviewed_at: "2026-07-27T14:45:00.000Z",
        automatic_clearance: false,
        attribution_is_permission: false,
        fair_use_guaranteed: false,
        source_page_is_licence: false,
      },
    },
  );
  const transformationEvidence = jsonFile(
    values.root,
    "official/game-media/transformation.json",
    {
      schema_version:
        "pulse-governed-game-media-transformation-evidence-v1",
      story_id: STORY_ID,
      asset_id: assetId,
      source_asset_sha256: rawAsset.sha256,
      permission_evidence_sha256: permissionEvidence.sha256,
      materialised_asset_sha256:
        values.sourceMediaAsset.sha256,
      purpose: "TRANSFORMATIVE_EDITORIAL",
      operations: ["CROP", "KEN_BURNS", "TEXT_OVERLAY"],
      source_audio_disposition: "NOT_APPLICABLE",
      usage_seconds: [0, 2],
      created_at: "2026-07-27T14:50:00.000Z",
    },
  );
  const gameMediaManifest = {
    schema_version: "pulse-governed-game-media-admission-v1",
    policy: "GOVERNED_GAME_MEDIA_V1",
    story_id: STORY_ID,
    primary_source_url: steamPageUrl,
    generated_at: "2026-07-27T14:55:00.000Z",
    assets: [
      {
        asset_id: assetId,
        media_type: "IMAGE",
        media_kind: "OFFICIAL_SCREENSHOT",
        editorial_role: "GAMEPLAY_HERO",
        source: {
          evidence_path: relativeToManifest(
            sourceEvidence.absolutePath,
          ),
          evidence_sha256: sourceEvidence.sha256,
          asset_path: relativeToManifest(rawAsset.absolutePath),
          asset_sha256: rawAsset.sha256,
        },
        permission: {
          evidence_path: relativeToManifest(
            permissionEvidence.absolutePath,
          ),
          evidence_sha256: permissionEvidence.sha256,
        },
        transformation: {
          evidence_path: relativeToManifest(
            transformationEvidence.absolutePath,
          ),
          evidence_sha256: transformationEvidence.sha256,
        },
        materialised: {
          path: relativeToManifest(
            values.sourceMediaAsset.absolutePath,
          ),
          sha256: values.sourceMediaAsset.sha256,
        },
      },
    ],
  };
  writeJson(values.sourceMedia.absolutePath, gameMediaManifest);
  values.sourceMedia.sha256 = sha256(
    fs.readFileSync(values.sourceMedia.absolutePath),
  );
  values.sourceMedia.value = gameMediaManifest;
  values.options.sourceMediaManifestSha256 =
    values.sourceMedia.sha256;

  const intake = JSON.parse(
    fs.readFileSync(values.options.storyIntakePath, "utf8"),
  );
  intake.story.visual_brief.source_media_policy =
    "GOVERNED_GAME_MEDIA_V1";
  writeJson(values.options.storyIntakePath, intake);
  const intakeSha256 = sha256(
    fs.readFileSync(values.options.storyIntakePath),
  );

  const publicationMetadata = JSON.parse(
    fs.readFileSync(values.options.publicationMetadataPath, "utf8"),
  );
  publicationMetadata.description =
    publicationMetadata.description.replace(
      ATTRIBUTION_TEXT,
      attributionText,
    );
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
  ownedMotion.assets[0].provenance.source_media_manifest.sha256 =
    values.sourceMedia.sha256;
  writeJson(values.options.ownedMotionManifestPath, ownedMotion);
  values.ownedMotion.sha256 = sha256(
    fs.readFileSync(values.options.ownedMotionManifestPath),
  );

  const renderer = JSON.parse(
    fs.readFileSync(values.options.rendererManifestPath, "utf8"),
  );
  const sourceMediaInput = renderer.inputs.find(
    (input) => input.role === "source_media",
  );
  sourceMediaInput.component_id = assetId;
  sourceMediaInput.sha256 = values.sourceMediaAsset.sha256;
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
  composite.inputs.story_intake.sha256 = intakeSha256;
  composite.inputs.owned_motion_manifest.sha256 =
    values.ownedMotion.sha256;
  composite.inputs.source_media_manifest.sha256 =
    values.sourceMedia.sha256;
  composite.source_media = {
    policy: "GOVERNED_GAME_MEDIA_V1",
    manifest: {
      path: path.relative(
        path.dirname(values.options.finalCompositeManifestPath),
        values.sourceMedia.absolutePath,
      ),
      sha256: values.sourceMedia.sha256,
    },
    rights_review: {
      path: path.relative(
        path.dirname(values.options.finalCompositeManifestPath),
        values.sourceMedia.absolutePath,
      ),
      sha256: values.sourceMedia.sha256,
    },
    components: [
      {
        component_id: assetId,
        path: path.relative(
          path.dirname(values.options.finalCompositeManifestPath),
          values.sourceMediaAsset.absolutePath,
        ),
        sha256: values.sourceMediaAsset.sha256,
        attribution: {
          required: true,
          text: attributionText,
        },
      },
    ],
  };
  composite.renderer_manifest.file_sha256 = rendererFileSha256;
  composite.renderer_manifest.canonical_sha256 =
    rendererCanonicalSha256;
  composite.qa_report.sha256 = values.qa.sha256;
  writeJson(values.options.finalCompositeManifestPath, composite);

  values.rendererCanonicalSha256 = rendererCanonicalSha256;
  values.humanApproval.confirmRendererCanonicalSha256 =
    rendererCanonicalSha256;
  values.governedGameMedia = {
    assetId,
    attributionText,
    steamMediaUrl,
  };
  return values;
}

function addValidatedLicensedAudio(values, { omitRendererAssetId = null } = {}) {
  const targetDurationSeconds = 28;
  const audioRoot = path.join(values.root, "licensed-audio");
  fs.mkdirSync(path.join(audioRoot, "rights"), {
    recursive: true,
  });
  const reviewDueAt = "2026-08-03T15:00:00.000Z";
  const youtubeAccountUri =
    "https://www.youtube.com/@PulseGMG";
  const licenceEvidenceUrl =
    "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting";
  const relativeToAudioRoot = (filePath) =>
    path.relative(audioRoot, filePath).replace(/\\/g, "/");
  const candidate = jsonFile(
    values.root,
    "licensed-audio/canonical-story-manifest.json",
    {
      schema_version: "pulse-canonical-story-manifest-v1",
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      story: { id: STORY_ID },
    },
  );
  const safelist = jsonFile(
    values.root,
    "licensed-audio/rights/safelist.json",
    {
      schema_version:
        "pulse-epidemic-safelist-evidence-v1",
      provider_id: "epidemic_sound",
      channel_id: CHANNEL_ID,
      destination: {
        platform: "YOUTUBE",
        surface: "SHORTS",
        account_uri: youtubeAccountUri,
      },
      active_subscription: true,
      channel_safelisted: true,
      attested_by: "channel-owner",
      attested_at: "2026-07-27T14:45:00.000Z",
      review_due_at: reviewDueAt,
    },
  );
  const definitions = [
    ["epidemic-bed", "MUSIC_BED", "music", "bed.mp3"],
    ["epidemic-sting", "MUSIC_STING", "sfx", "sting.wav"],
    ["epidemic-impact", "SFX_IMPACT", "sfx", "impact.wav"],
    [
      "epidemic-transition",
      "SFX_TRANSITION",
      "sfx",
      "transition.wav",
    ],
  ];
  const rawAssets = definitions.map(
    ([assetId, sourceRole, rendererRole, fileName], index) => {
      const asset = file(
        values.root,
        `licensed-audio/assets/${fileName}`,
        `licensed-audio-${assetId}`,
      );
      const sizeBytes = fs.statSync(asset.absolutePath).size;
      const rightsEvidence = jsonFile(
        values.root,
        `licensed-audio/rights/${assetId}.json`,
        {
          schema_version:
            "pulse-governed-licensed-audio-rights-evidence-v1",
          story_id: STORY_ID,
          asset_id: assetId,
          asset_sha256: asset.sha256,
          asset_size_bytes: sizeBytes,
          provider_id: "epidemic_sound",
          provider_asset_reference:
            `epidemic-sound://fixture/${assetId}`,
          licence_basis:
            "epidemic_sound_active_subscription_safelisted_channel",
          licence_evidence_url: licenceEvidenceUrl,
          allowed_destinations: ["YOUTUBE_SHORTS"],
          allowed_revenue_modes: [
            "ORGANIC",
            "PLATFORM_ADVERTISING",
          ],
          raw_redistribution_allowed: false,
          approval_status:
            "approved_for_commercial_editorial_use",
          rights_verdict: "GREEN",
          safelist_evidence_sha256: safelist.sha256,
          reviewed_by: "pulse-editorial-rights-review",
          reviewed_at: "2026-07-27T14:45:00.000Z",
          review_due_at: reviewDueAt,
        },
      );
      const roleContract = {
        MUSIC_BED: ["music_bed", "bed_primary"],
        MUSIC_STING: ["music_sting", "sting_verified"],
        SFX_IMPACT: ["sfx", "impact"],
        SFX_TRANSITION: ["sfx", "transition"],
      }[sourceRole];
      const localAssetPath = relativeToAudioRoot(
        asset.absolutePath,
      );
      const rightsRecord = {
        asset_id: assetId,
        asset_type: roleContract[0],
        role: roleContract[1],
        provider_id: "epidemic_sound",
        provider_asset_reference:
          `epidemic-sound://fixture/${assetId}`,
        local_asset_path: localAssetPath,
        licence_basis:
          "epidemic_sound_active_subscription_safelisted_channel",
        licence_evidence_url: licenceEvidenceUrl,
        allowed_platforms: ["youtube_shorts"],
        allowed_revenue_modes: [
          "organic",
          "platform_advertising",
        ],
        commercial_use_allowed: true,
        raw_redistribution_allowed: false,
        approval_status:
          "approved_for_commercial_editorial_use",
        rights_verdict: "GREEN",
        live_publish_allowed: true,
        requires_human_legal_review_before_publish: false,
        asset_sha256: asset.sha256,
        asset_size_bytes: sizeBytes,
        rights_evidence_sha256: rightsEvidence.sha256,
        safelist_evidence_sha256: safelist.sha256,
      };
      return {
        asset_id: assetId,
        role: sourceRole,
        renderer_role: rendererRole,
        file: asset,
        local_asset_path: localAssetPath,
        sha256: asset.sha256,
        size_bytes: sizeBytes,
        provider_asset_reference: `epidemic-sound://fixture/${assetId}`,
        rightsEvidence,
        rightsRecord,
        order: index,
      };
    },
  );
  const selectedRightsLedger = jsonFile(
    values.root,
    "licensed-audio/selected-rights-ledger.json",
    {
      schema_version:
        "pulse-governed-licensed-audio-rights-ledger-v1",
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      generated_at: "2026-07-27T14:45:00.000Z",
      review_due_at: reviewDueAt,
      records: rawAssets.map((asset) => asset.rightsRecord),
    },
  );
  const pack = jsonFile(
    values.root,
    "licensed-audio/governed-licensed-audio-pack.json",
    {
      schema_version: "pulse-governed-licensed-audio-pack-v1",
      policy: "EPIDEMIC_SOUND_LICENSED_PACK_V1",
      story_id: STORY_ID,
      channel_id: CHANNEL_ID,
      generated_at: "2026-07-27T14:45:00.000Z",
      candidate_manifest: {
        path: relativeToAudioRoot(candidate.absolutePath),
        sha256: candidate.sha256,
      },
      rights_ledger: {
        path: relativeToAudioRoot(
          selectedRightsLedger.absolutePath,
        ),
        sha256: selectedRightsLedger.sha256,
      },
      provider: {
        id: "epidemic_sound",
        licence_basis:
          "epidemic_sound_active_subscription_safelisted_channel",
        licence_evidence_url: licenceEvidenceUrl,
        safelist_evidence: {
          path: relativeToAudioRoot(safelist.absolutePath),
          sha256: safelist.sha256,
        },
      },
      scope: {
        destinations: ["YOUTUBE_SHORTS"],
        revenue_modes: ["ORGANIC", "PLATFORM_ADVERTISING"],
        prohibited_without_new_review: [
          "AFFILIATE_PROMOTION",
          "CLIENT_FUNDED_USE",
          "CROSS_PLATFORM_REPOSTING",
          "PAID_ACCESS",
          "SPONSORSHIP",
        ],
      },
      render_binding: {
        narration_sha256: values.narration.sha256,
        timestamps_sha256: values.sourceTimestamps.sha256,
        target_duration_seconds: targetDurationSeconds,
      },
      assets: rawAssets.map((asset) => ({
        asset_id: asset.asset_id,
        role: asset.role,
        provider_asset_reference:
          asset.provider_asset_reference,
        local_asset: {
          path: asset.local_asset_path,
          sha256: asset.sha256,
          size_bytes: asset.size_bytes,
        },
        rights_record_sha256: fingerprintRightsRecord(
          asset.rightsRecord,
        ),
        rights_evidence: {
          path: relativeToAudioRoot(
            asset.rightsEvidence.absolutePath,
          ),
          sha256: asset.rightsEvidence.sha256,
        },
        embedded_in_final: true,
      })),
      mix: {
        policy_version: "epidemic_sidechain_ducked_bed_v1",
        narration_included: false,
        target_duration_seconds: targetDurationSeconds,
        bed: {
          asset_id: "epidemic-bed",
          raw_volume: 0.1,
          ducked_output_volume: 0.26,
          trim_start_seconds: 0,
          fade_in_seconds: 0.18,
          fade_out_seconds: 0.8,
          sidechain: {
            threshold: 0.035,
            ratio: 5.5,
            attack_ms: 18,
            release_ms: 420,
          },
        },
        micro_drop_windows: [],
        cues: rawAssets
          .filter((asset) => asset.role !== "MUSIC_BED")
          .map((asset, index) => ({
            asset_id: asset.asset_id,
            at_seconds: index * 0.35,
            volume: 0.04,
            trim_start_seconds: 0,
            duration_seconds: 0.3,
            fade_in_seconds: 0,
            fade_out_seconds: 0.08,
          })),
      },
    },
  );
  const licensedAudio = validateGovernedLicensedAudioPack({
    manifestPath: pack.absolutePath,
    expectedManifestSha256: pack.sha256,
    expectedStoryId: STORY_ID,
    expectedChannelId: CHANNEL_ID,
    expectedNarrationSha256: values.narration.sha256,
    expectedTimestampsSha256:
      values.sourceTimestamps.sha256,
    expectedTargetDurationSeconds: targetDurationSeconds,
    expectedRightsLedgerSha256:
      selectedRightsLedger.sha256,
    expectedYoutubeAccountUri: youtubeAccountUri,
    requiredDestination: "YOUTUBE_SHORTS",
    requiredRevenueMode: "PLATFORM_ADVERTISING",
    validationBoundaryAt: GENERATED_AT,
  });
  const assets = licensedAudio.assets;
  assert.equal(licensedAudio.validation_status, "PASS");
  assert.deepEqual(licensedAudio.render_binding, {
    narration_sha256: values.narration.sha256,
    timestamps_sha256: values.sourceTimestamps.sha256,
    target_duration_seconds: targetDurationSeconds,
  });
  const relativeToRoot = (filePath) =>
    path.relative(values.root, filePath).replace(/\\/g, "/");
  const licensedAudioEvidence = {
    policy: licensedAudio.policy,
    manifest: {
      path: relativeToRoot(licensedAudio.manifest_path),
      sha256: licensedAudio.manifest_sha256,
    },
    rights_ledger: {
      path: relativeToRoot(licensedAudio.rights_ledger.path),
      sha256: licensedAudio.rights_ledger.sha256,
    },
    provider: licensedAudio.provider,
    scope: licensedAudio.scope,
    render_binding: licensedAudio.render_binding,
    mix: licensedAudio.mix,
    assets: assets.map((asset) => ({
      asset_id: asset.asset_id,
      source_role: asset.role,
      renderer_role:
        asset.role === "MUSIC_BED" ? "music" : "sfx",
      path: relativeToRoot(asset.path),
      sha256: asset.sha256,
      size_bytes: asset.size_bytes,
      provider_asset_reference: asset.provider_asset_reference,
      rights_record_sha256: asset.rights_record_sha256,
      rights_evidence: {
        path: relativeToRoot(asset.rights_evidence_path),
        sha256: asset.rights_evidence_sha256,
      },
      probe: {
        asset_id: asset.asset_id,
        duration_seconds: 8,
        audio_codec: "pcm_s16le",
        sample_rate_hz: 48000,
        channels: 2,
      },
      embedded_in_final: true,
    })),
  };

  const intake = JSON.parse(
    fs.readFileSync(values.options.storyIntakePath, "utf8"),
  );
  intake.contract = {
    editorial_lane_id: "what_changes_for_players",
    hook_type: "direct",
    duration_band_id: "what_changes_short_25_32",
    target_duration_seconds: targetDurationSeconds,
    target_duration_review: {
      status: "APPROVED",
      target_duration_seconds: targetDurationSeconds,
      script_sha256: values.scriptSha256,
      reviewed_by: "pulse-editorial-operator",
      reviewed_at: "2026-07-27T14:50:00.000Z",
    },
  };
  writeJson(values.options.storyIntakePath, intake);
  const intakeSha256 = sha256(
    fs.readFileSync(values.options.storyIntakePath),
  );

  const renderer = JSON.parse(
    fs.readFileSync(values.options.rendererManifestPath, "utf8"),
  );
  renderer.output.duration_seconds = targetDurationSeconds;
  renderer.inputs.push(
    ...assets
      .filter((asset) => asset.asset_id !== omitRendererAssetId)
      .map((asset) => ({
        component_id: asset.asset_id,
        role:
          asset.role === "MUSIC_BED" ? "music" : "sfx",
        path: relativeToRoot(asset.path),
        sha256: asset.sha256,
        embedded_in_final: true,
      })),
  );
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
  qa.technical = { duration_seconds: targetDurationSeconds };
  qa.audio.background_music_used = true;
  qa.audio.sound_effects_used = true;
  qa.audio.licensed_audio_pack = licensedAudioEvidence.manifest;
  qa.licensed_audio = licensedAudioEvidence;
  writeJson(values.options.qaReportPath, qa);
  values.qa.sha256 = sha256(
    fs.readFileSync(values.options.qaReportPath),
  );

  const composite = JSON.parse(
    fs.readFileSync(values.options.finalCompositeManifestPath, "utf8"),
  );
  composite.inputs.story_intake.sha256 = intakeSha256;
  composite.inputs.licensed_audio_pack =
    licensedAudioEvidence.manifest;
  composite.inputs.licensed_audio_rights_ledger =
    licensedAudioEvidence.rights_ledger;
  composite.ffmpeg.duration_seconds = targetDurationSeconds;
  composite.ffmpeg.background_music_used = true;
  composite.ffmpeg.sound_effects_used = true;
  composite.licensed_audio = licensedAudioEvidence;
  composite.renderer_manifest.file_sha256 = rendererFileSha256;
  composite.renderer_manifest.canonical_sha256 =
    rendererCanonicalSha256;
  composite.qa_report.sha256 = values.qa.sha256;
  writeJson(values.options.finalCompositeManifestPath, composite);

  values.options.licensedAudioPackPath = pack.absolutePath;
  values.options.expectedLicensedAudioPackSha256 = pack.sha256;
  values.options.expectedLicensedAudioRightsLedgerSha256 =
    selectedRightsLedger.sha256;
  values.options.expectedYoutubeAccountUri =
    "https://www.youtube.com/@PulseGMG";
  values.rendererCanonicalSha256 = rendererCanonicalSha256;
  values.humanApproval.confirmRendererCanonicalSha256 =
    rendererCanonicalSha256;
  values.licensedAudio = licensedAudio;
  values.licensedAudioEvidence = licensedAudioEvidence;
  return values;
}

test("apply carries exact governed licensed audio through renderer, rights ledger, review and package evidence", async () => {
  const values = addValidatedLicensedAudio(fixture());
  const validationCalls = [];
  try {
    const result = await executeGovernedPublicationEvidencePackage(
      {
        ...values.options,
        apply: true,
        humanApproval: values.humanApproval,
      },
      {
        validateLicensedAudioPack(options) {
          validationCalls.push(options);
          return structuredClone(values.licensedAudio);
        },
      },
    );

    assert.equal(validationCalls.length, 1);
    assert.equal(
      validationCalls[0].expectedNarrationSha256,
      values.narration.sha256,
    );
    assert.equal(
      validationCalls[0].expectedTimestampsSha256,
      values.sourceTimestamps.sha256,
    );
    assert.notEqual(
      values.sourceTimestamps.sha256,
      values.timestamps.sha256,
    );
    assert.equal(
      validationCalls[0].expectedTargetDurationSeconds,
      28,
    );
    assert.equal(
      validationCalls[0].expectedRightsLedgerSha256,
      values.licensedAudio.rights_ledger.sha256,
    );

    const rightsLedger = JSON.parse(
      fs.readFileSync(result.rights_ledger_path, "utf8"),
    );
    const audioItems = rightsLedger.items.filter((item) =>
      item.item_id.startsWith("epidemic-"),
    );
    assert.deepEqual(
      audioItems.map((item) => item.item_id).sort(),
      values.licensedAudio.assets
        .map((asset) => asset.asset_id)
        .sort(),
    );
    for (const item of audioItems) {
      const asset = values.licensedAudio.assets.find(
        (candidate) => candidate.asset_id === item.item_id,
      );
      assert.equal(item.asset_sha256, asset.sha256);
      assert.equal(item.rights_basis, "LICENSED");
      assert.equal(
        item.rights_evidence.sha256,
        asset.rights_evidence_sha256,
      );
    }

    const review = JSON.parse(
      fs.readFileSync(result.publication_review_path, "utf8"),
    );
    assert.deepEqual(
      review.licensed_audio,
      values.licensedAudioEvidence,
    );
    assert.equal(review.policy.background_music_used, true);
    assert.equal(review.policy.sound_effects_used, true);

    const packageManifest = JSON.parse(
      fs.readFileSync(result.package_manifest_path, "utf8"),
    );
    assert.equal(
      packageManifest.inputs.licensed_audio_pack.sha256,
      values.licensedAudio.manifest_sha256,
    );
    assert.equal(
      packageManifest.bindings.licensed_audio_rights_ledger_sha256,
      values.licensedAudio.rights_ledger.sha256,
    );
    assert.equal(packageManifest.policy.background_music_used, true);
    assert.equal(packageManifest.policy.sound_effects_used, true);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("licensed audio refuses any mismatch between the validated pack and renderer inputs", async () => {
  const values = addValidatedLicensedAudio(fixture(), {
    omitRendererAssetId: "epidemic-transition",
  });
  try {
    await assert.rejects(
      executeGovernedPublicationEvidencePackage(
        values.options,
        {
          validateLicensedAudioPack() {
            return structuredClone(values.licensedAudio);
          },
        },
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "renderer_licensed_audio_inputs_mismatch",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

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
    assert.equal(
      result.official_source_release_binding
        .source_evidence_sha256,
      JSON.parse(
        fs.readFileSync(
          values.options.storyIntakePath,
          "utf8",
        ),
      ).source_evidence_sha256,
    );
    for (const outputPath of Object.values(result.planned_outputs)) {
      assert.equal(fs.existsSync(outputPath), false);
    }
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("publication packaging rejects legacy official evidence without an exact source snapshot", async () => {
  const values = fixture();
  try {
    const sourceEvidence = structuredClone(values.source.value);
    delete sourceEvidence.official_source_snapshot;
    writeJson(values.source.absolutePath, sourceEvidence);
    const sourceSha256 = sha256(
      fs.readFileSync(values.source.absolutePath),
    );
    const intake = structuredClone(values.intake.value);
    intake.source_evidence_sha256 = sourceSha256;
    writeJson(values.intake.absolutePath, intake);
    const intakeSha256 = sha256(
      fs.readFileSync(values.intake.absolutePath),
    );
    const composite = structuredClone(values.composite.value);
    composite.inputs.story_intake.sha256 = intakeSha256;
    writeJson(values.composite.absolutePath, composite);

    await assert.rejects(
      executeGovernedPublicationEvidencePackage(
        values.options,
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "official_source_snapshot_required",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("a governed Steam asset flows through publication evidence without publisher-specific hardcoding", async () => {
  const values = replaceLicensedSourceMediaWithGovernedSteamMedia(
    fixture(),
  );
  try {
    const result = await executeGovernedPublicationEvidencePackage({
      ...values.options,
      apply: true,
      humanApproval: values.humanApproval,
    });

    assert.equal(
      result.source_media_policy,
      "GOVERNED_GAME_MEDIA_V1",
    );
    const rightsLedger = JSON.parse(
      fs.readFileSync(result.rights_ledger_path, "utf8"),
    );
    const mediaItem = rightsLedger.items.find(
      (item) =>
        item.item_id === values.governedGameMedia.assetId,
    );
    assert.equal(
      mediaItem.source_url,
      values.governedGameMedia.steamMediaUrl,
    );
    assert.equal(
      mediaItem.rights_basis,
      "TRANSFORMATIVE_EDITORIAL_USE",
    );
    assert.equal(
      mediaItem.attribution_text,
      values.governedGameMedia.attributionText,
    );
    const motionItem = rightsLedger.items.find(
      (item) => item.item_id === "hyperframes-intermediate",
    );
    assert.equal(
      motionItem.attribution_text,
      values.governedGameMedia.attributionText,
    );

    const sourceRights = JSON.parse(
      fs.readFileSync(
        result.source_media_rights_evidence_path,
        "utf8",
      ),
    );
    assert.equal(sourceRights.publisher, "Awesome Games Studio");
    assert.equal(
      sourceRights.components[0].rights_basis,
      "TRANSFORMATIVE_EDITORIAL_USE",
    );
    assert.equal(
      sourceRights.components[0].attribution_text,
      values.governedGameMedia.attributionText,
    );
    const motionRights = JSON.parse(
      fs.readFileSync(
        result.owned_motion_rights_evidence_path,
        "utf8",
      ),
    );
    assert.equal(
      motionRights.attribution_text,
      values.governedGameMedia.attributionText,
    );
    assert.doesNotMatch(
      JSON.stringify({
        sourceRights,
        rightsLedger,
        motionRights,
      }),
      /Square Enix|SQUARE ENIX/,
    );
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
      validationBoundaryAt: GENERATED_AT,
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
      validationBoundaryAt: GENERATED_AT,
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
