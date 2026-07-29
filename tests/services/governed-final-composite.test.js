"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  buildFfmpegInvocation,
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
  validateStoryIntake,
} = require("../../lib/services/governed-final-composite");
const {
  ATTRIBUTION_TEXT,
  EDITORIAL_PURPOSE,
  MANIFEST_SCHEMA: SOURCE_MEDIA_MANIFEST_SCHEMA,
} = require("../../lib/services/governed-source-media");
const {
  CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
  validateAssCaptionSafeZone,
} = require("../../lib/services/platform-safe-zones");

const STORY_ID = "official_d86953ca92ca";
const SCRIPT =
  "Final Fantasy XIV just revealed a tank that fights with two giant shields.";
const GENERATED_AT = "2026-07-27T15:00:00.000Z";
const NARRATOR_VERSION =
  "pulse-narrator-v1:f7963cc60699bfff84d23165146718f603a6bf0f08a2614245c4d9e1edf52bc4";
const SOURCE_MEDIA_POLICY = "LICENSED_OFFICIAL_FFXIV";
const FFXIV_LICENCE_URL =
  "https://support.eu.square-enix.com/rule.php?id=5383&la=2&tag=authc";
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function videoProbe({ duration = 28, audio = false } = {}) {
  const streams = [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      pix_fmt: "yuv420p",
      width: 1080,
      height: 1920,
      avg_frame_rate: "30/1",
    },
  ];
  if (audio) {
    streams.push({
      codec_type: "audio",
      codec_name: "aac",
      sample_rate: "48000",
    });
  }
  return {
    streams,
    format: { duration: String(duration) },
  };
}

function audioProbe(duration = 0.72) {
  return {
    streams: [
      {
        codec_type: "audio",
        codec_name: "mp3",
        sample_rate: "44100",
      },
    ],
    format: { duration: String(duration) },
  };
}

function sourceLoudness() {
  return {
    integrated_lufs: -23.9,
    true_peak_dbfs: -8.4,
    loudness_range_lu: 3.2,
    threshold_lufs: -34,
    target_offset_lu: 0.1,
  };
}

function finalLoudness() {
  return {
    integrated_lufs: -16,
    true_peak_dbfs: -1.7,
    loudness_range_lu: 3.1,
    threshold_lufs: -26,
    target_offset_lu: 0,
  };
}

function terminalSilence() {
  return {
    threshold_db: -50,
    minimum_duration_seconds: 0.1,
    terminal_silence_start_seconds: 23.684,
    terminal_silence_seconds: 1.316,
  };
}

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "pulse-final-composite-"),
  );
  const projectDir = path.join(root, "videos", "evercold");
  const evidenceDir = path.join(root, "evidence");
  const hookSlamPath = path.join(evidenceDir, "hook-slam.png");
  const backbonePath = path.join(evidenceDir, "owned-motion-backbone.mp4");
  const hyperframesPath = path.join(evidenceDir, "evercold-hf.mp4");
  const projectPath = path.join(projectDir, "index.html");
  const configPath = path.join(projectDir, "hyperframes.json");
  const audioPath = path.join(evidenceDir, "narration.mp3");
  const alignmentPath = path.join(evidenceDir, "timestamps.json");
  const timestampsPath = path.join(
    evidenceDir,
    "word-timestamps.json",
  );
  const narrationManifestPath = path.join(
    evidenceDir,
    "governed-narration-manifest.json",
  );
  const storyIntakePath = path.join(evidenceDir, "story-intake.json");
  const combinedManifestPath = path.join(
    evidenceDir,
    "owned-motion-manifest.json",
  );
  const originalManifestPath = path.join(
    evidenceDir,
    "original-owned-motion-manifest.json",
  );
  const outputDir = path.join(root, "final-output");

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(hookSlamPath, TINY_PNG);
  fs.writeFileSync(backbonePath, "owned-backbone");
  fs.writeFileSync(hyperframesPath, "hyperframes-intermediate");
  fs.writeFileSync(
    projectPath,
    "<html><body>material captions stage</body></html>",
  );
  fs.writeFileSync(configPath, '{"paths":{"assets":"assets"}}');
  fs.writeFileSync(audioPath, "narration");
  const alignment = {
    characters: [
      "F",
      "i",
      "n",
      "a",
      "l",
      " ",
      "F",
      "a",
      "n",
      "t",
      "a",
      "s",
      "y",
      " ",
      "X",
      "I",
      "V",
      " ",
      "j",
      "u",
      "s",
      "t",
      " ",
      "r",
      "e",
      "v",
      "e",
      "a",
      "l",
      "e",
      "d",
      " ",
      "a",
      " ",
      "t",
      "a",
      "n",
      "k",
      " ",
      "t",
      "h",
      "a",
      "t",
      " ",
      "f",
      "i",
      "g",
      "h",
      "t",
      "s",
      " ",
      "w",
      "i",
      "t",
      "h",
      " ",
      "t",
      "w",
      "o",
      " ",
      "g",
      "i",
      "a",
      "n",
      "t",
      " ",
      "s",
      "h",
      "i",
      "e",
      "l",
      "d",
      "s",
      ".",
    ],
    character_start_times_seconds: Array.from(
      { length: SCRIPT.length },
      (_, index) => Number((index * 0.01).toFixed(3)),
    ),
    character_end_times_seconds: Array.from(
      { length: SCRIPT.length },
      (_, index) => Number(((index + 1) * 0.01).toFixed(3)),
    ),
  };
  writeJson(alignmentPath, alignment);
  const alignmentSha256 = sha256(fs.readFileSync(alignmentPath));
  const audioSha256 = sha256(fs.readFileSync(audioPath));
  const words = normaliseWordTimestamps({
    storyId: STORY_ID,
    timestamps: alignment,
    expectedScript: SCRIPT,
    expectedScriptSha256: sha256(SCRIPT),
    expectedAudioSha256: audioSha256,
  }).words;
  writeJson(timestampsPath, {
    schema_version: "pulse-word-timestamps-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    script_sha256: sha256(SCRIPT),
    source_alignment_sha256: alignmentSha256,
    audio_sha256: audioSha256,
    audio_duration_seconds: 0.72,
    character_count: SCRIPT.length,
    word_count: words.length,
    words,
  });
  writeJson(narrationManifestPath, {
    schema_version: "pulse-governed-narration-manifest-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    generator_identity: "pulse-governed-narration-materialize-v1",
    plan_sha256: "e".repeat(64),
    script: {
      sha256: sha256(SCRIPT),
      aligned_text_sha256: sha256(SCRIPT),
      exact_alignment_match: true,
      character_count: SCRIPT.length,
    },
    narration: {
      narrator_version: NARRATOR_VERSION,
      duration_seconds: 0.72,
      final_target_seconds: 28,
      visual_breath_allowance_seconds: 27.28,
      word_count: words.length,
      provider: "elevenlabs",
      voice_id: "fixture-voice",
      model_id: "eleven_multilingual_v2",
      speed: 0.75,
      provider_metadata_basis: "operator_attestation",
    },
    licence: {
      rights_basis: "LICENSED",
      evidence_reference:
        "operator-attestation://channel-owner/elevenlabs-full-subscription",
      attested_by: "channel-owner",
      attested_at: GENERATED_AT,
      evidence_scope:
        "operator subscription and permitted-use attestation reference",
    },
    sources: {
      audio: {
        path: audioPath,
        expected_sha256: audioSha256,
        pre_apply_sha256: audioSha256,
        post_apply_sha256: audioSha256,
        copied: false,
        mutated: false,
      },
      alignment: {
        path: alignmentPath,
        expected_sha256: alignmentSha256,
        pre_apply_sha256: alignmentSha256,
        post_apply_sha256: alignmentSha256,
        copied: false,
        mutated: false,
      },
    },
    outputs: {
      word_timestamps: {
        path: "word-timestamps.json",
        schema_version: "pulse-word-timestamps-v1",
        sha256: sha256(fs.readFileSync(timestampsPath)),
        word_count: words.length,
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
  writeJson(storyIntakePath, {
    schema_version: "pulse-governed-story-intake-v1",
    source_url: "https://example.test/official-evercold",
    source_type: "official",
    source_evidence_path: "source-evidence.json",
    source_evidence_sha256: "a".repeat(64),
    contract: {
      duration_band_id: "what_changes_short_25_32",
    },
    story: {
      id: STORY_ID,
      title: "Final Fantasy XIV reveals Bastion",
      full_script: SCRIPT,
      script_sha256: sha256(SCRIPT),
      visual_brief: {
        format: "owned-motion-only",
        source_media_policy: "OWNED_ONLY",
        palette: ["#9EEBFF", "#244866", "#E8F8FF", "#FF6B1A"],
      },
    },
  });
  const originalManifest = {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    opening_treatment: {
      role: "hook_slam",
      first_frame_text: "A TANK WITH TWO SHIELDS",
      source: "owned_motion_opening_treatment_v1",
      asset: {
        path: "hook-slam.png",
        sha256: sha256(fs.readFileSync(hookSlamPath)),
      },
    },
    assets: [
      {
        path: "hook-slam.png",
        sha256: sha256(fs.readFileSync(hookSlamPath)),
        media_type: "image",
        role: "hook_slam",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
        width: 1080,
        height: 1920,
        duration_seconds: null,
      },
      {
        path: "owned-motion-backbone.mp4",
        sha256: sha256(fs.readFileSync(backbonePath)),
        media_type: "video",
        role: "owned_motion_backbone",
        ownership: "owned",
        rights_basis: "OWNED",
        attribution_required: false,
        width: 1080,
        height: 1920,
        duration_seconds: 28,
      },
    ],
  };
  writeJson(originalManifestPath, originalManifest);
  writeJson(combinedManifestPath, {
    ...originalManifest,
    assets: [
      ...originalManifest.assets,
      {
        path: "evercold-hf.mp4",
        sha256: sha256(fs.readFileSync(hyperframesPath)),
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
          source_backbone: {
            path: "owned-motion-backbone.mp4",
            sha256: sha256(fs.readFileSync(backbonePath)),
          },
          project_files: [
            {
              path: "../videos/evercold/index.html",
              sha256: sha256(fs.readFileSync(projectPath)),
            },
            {
              path: "../videos/evercold/hyperframes.json",
              sha256: sha256(fs.readFileSync(configPath)),
            },
          ],
        },
      },
    ],
  });
  return {
    root,
    projectDir,
    evidenceDir,
    hookSlamPath,
    backbonePath,
    hyperframesPath,
    projectPath,
    configPath,
    audioPath,
    alignmentPath,
    timestampsPath,
    narrationManifestPath,
    narrationManifestSha256: sha256(
      fs.readFileSync(narrationManifestPath),
    ),
    storyIntakePath,
    combinedManifestPath,
    originalManifestPath,
    outputDir,
  };
}

function addPreRenderedCaptions(values, durationSeconds = 36.48) {
  const timestampPayload = JSON.parse(
    fs.readFileSync(values.timestampsPath, "utf8"),
  );
  const captionsPath = path.join(
    values.projectDir,
    "captions.html",
  );
  const groups = [
    {
      id: "caption-group-0",
      start: timestampPayload.words[0].start_seconds,
      end: timestampPayload.words.at(-1).end_seconds,
      text: timestampPayload.words
        .map((word) => word.text)
        .join(" "),
      words: timestampPayload.words.map((word, index) => ({
        id: `caption-word-0-${index}`,
        text: word.text,
        start: word.start_seconds,
        end: word.end_seconds,
      })),
    },
  ];
  fs.writeFileSync(
    values.projectPath,
    [
      "<html><body>",
      `<div data-composition-id="captions" data-composition-src="captions.html" data-start="0" data-duration="${durationSeconds}"></div>`,
      "</body></html>",
    ].join(""),
  );
  fs.writeFileSync(
    captionsPath,
    [
      `<template id="captions-template" data-composition-id="captions" data-width="1080" data-height="1920">`,
      "<style>:root { --cap-band-left: 96px; --cap-band-top: 1336px; --cap-band-width: 720px; --cap-band-height: 80px; }</style>",
      "<style>.caption-stage { position: absolute; left: var(--cap-band-left, 96px); top: var(--cap-band-top, 1336px); width: var(--cap-band-width, 720px); height: var(--cap-band-height, 80px); }</style>",
      `<div id="captions-root" data-start="0" data-duration="${durationSeconds}" data-width="1080" data-height="1920" data-platform-safe-zone-profile="portrait-cross-platform-strict-v1" data-caption-rect-x="96" data-caption-rect-y="1336" data-caption-rect-width="720" data-caption-rect-height="80"><div id="caption-stage" class="caption-stage"></div></div>`,
      `<script>var GROUPS = ${JSON.stringify(groups)};</script>`,
      "</template>",
    ].join("\n"),
  );
  const manifest = JSON.parse(
    fs.readFileSync(values.combinedManifestPath, "utf8"),
  );
  const intermediate = manifest.assets.find(
    (asset) => asset.role === "hyperframes_intermediate",
  );
  intermediate.provenance.project_files = [
    {
      path: "../videos/evercold/index.html",
      sha256: sha256(fs.readFileSync(values.projectPath)),
    },
    {
      path: "../videos/evercold/hyperframes.json",
      sha256: sha256(fs.readFileSync(values.configPath)),
    },
    {
      path: "../videos/evercold/captions.html",
      sha256: sha256(fs.readFileSync(captionsPath)),
    },
  ];
  writeJson(values.combinedManifestPath, manifest);
  return {
    captionsPath,
    wordCount: timestampPayload.words.length,
  };
}

function preparePreRenderedCaptionFixture(
  values,
  durationSeconds = 36.48,
) {
  const intake = JSON.parse(
    fs.readFileSync(values.storyIntakePath, "utf8"),
  );
  intake.contract.duration_band_id =
    "what_changes_standard_35_42";
  intake.contract.target_duration_seconds =
    durationSeconds;
  writeJson(values.storyIntakePath, intake);

  const motion = JSON.parse(
    fs.readFileSync(values.combinedManifestPath, "utf8"),
  );
  motion.assets.find(
    (asset) => asset.role === "hyperframes_intermediate",
  ).duration_seconds = durationSeconds;
  writeJson(values.combinedManifestPath, motion);

  const narrationManifest = JSON.parse(
    fs.readFileSync(values.narrationManifestPath, "utf8"),
  );
  narrationManifest.narration.final_target_seconds =
    durationSeconds;
  narrationManifest.narration.visual_breath_allowance_seconds =
    durationSeconds -
    narrationManifest.narration.duration_seconds;
  writeJson(values.narrationManifestPath, narrationManifest);

  return addPreRenderedCaptions(values, durationSeconds);
}

function preRenderedCompositeOptions(
  values,
  durationSeconds = 36.48,
) {
  return {
    storyIntakePath: values.storyIntakePath,
    ownedMotionManifestPath: values.combinedManifestPath,
    videoPath: values.hyperframesPath,
    audioPath: values.audioPath,
    timestampsPath: values.timestampsPath,
    narrationManifestPath: values.narrationManifestPath,
    expectedNarrationManifestSha256: sha256(
      fs.readFileSync(values.narrationManifestPath),
    ),
    outDir: values.outputDir,
    generatedAt: GENERATED_AT,
    preserveRenderedCaptions: true,
    durationSeconds,
  };
}

function preRenderedCompositeDependencies(
  values,
  durationSeconds = 36.48,
  { beforeCaptionValidation, onRender } = {},
) {
  let sourceMeasured = false;
  return {
    probeMedia(filePath) {
      if (filePath === values.audioPath) return audioProbe();
      if (filePath === values.hyperframesPath) {
        return videoProbe({ duration: durationSeconds + 0.02 });
      }
      return videoProbe({
        duration: durationSeconds,
        audio: true,
      });
    },
    measureLoudness(filePath) {
      if (filePath === values.audioPath) {
        if (!sourceMeasured) {
          sourceMeasured = true;
          beforeCaptionValidation?.();
        }
        return sourceLoudness();
      }
      return finalLoudness();
    },
    measureTerminalSilence() {
      return terminalSilence();
    },
    renderComposite(invocation) {
      onRender?.(invocation);
      fs.writeFileSync(invocation.outputPath, "captioned-final");
    },
  };
}

function rebindPreRenderedCaptionProject(
  values,
  captionsPath,
) {
  const manifest = JSON.parse(
    fs.readFileSync(values.combinedManifestPath, "utf8"),
  );
  const projectFiles = manifest.assets.find(
    (asset) => asset.role === "hyperframes_intermediate",
  ).provenance.project_files;
  const captionRecord = projectFiles.find(
    (record) =>
      path.basename(record.path).toLowerCase() ===
      "captions.html",
  );
  captionRecord.sha256 = sha256(
    fs.readFileSync(captionsPath),
  );
  writeJson(values.combinedManifestPath, manifest);
}

function rebindPreRenderedIndexProject(values) {
  const manifest = JSON.parse(
    fs.readFileSync(values.combinedManifestPath, "utf8"),
  );
  const projectFiles = manifest.assets.find(
    (asset) => asset.role === "hyperframes_intermediate",
  ).provenance.project_files;
  const indexRecord = projectFiles.find(
    (record) =>
      path.basename(record.path).toLowerCase() ===
      "index.html",
  );
  indexRecord.sha256 = sha256(
    fs.readFileSync(values.projectPath),
  );
  writeJson(values.combinedManifestPath, manifest);
}

async function assertPreRenderedCaptionMutationRejected({
  expectedCode,
  mutateCaption,
  mutateIndex,
  beforeCaptionValidation,
  durationSeconds = 36.48,
} = {}) {
  const values = fixture();
  try {
    const captionProject =
      preparePreRenderedCaptionFixture(
        values,
        durationSeconds,
      );
    if (mutateCaption) {
      const source = fs.readFileSync(
        captionProject.captionsPath,
        "utf8",
      );
      fs.writeFileSync(
        captionProject.captionsPath,
        mutateCaption(source, {
          values,
          captionProject,
          durationSeconds,
        }),
        "utf8",
      );
      rebindPreRenderedCaptionProject(
        values,
        captionProject.captionsPath,
      );
    }
    if (mutateIndex) {
      const source = fs.readFileSync(
        values.projectPath,
        "utf8",
      );
      fs.writeFileSync(
        values.projectPath,
        mutateIndex(source, {
          values,
          captionProject,
          durationSeconds,
        }),
        "utf8",
      );
      rebindPreRenderedIndexProject(values);
    }
    let rendered = false;
    await assert.rejects(
      executeGovernedFinalComposite(
        preRenderedCompositeOptions(
          values,
          durationSeconds,
        ),
        preRenderedCompositeDependencies(
          values,
          durationSeconds,
          {
            beforeCaptionValidation:
              beforeCaptionValidation
                ? () =>
                    beforeCaptionValidation({
                      values,
                      captionProject,
                      durationSeconds,
                    })
                : undefined,
            onRender() {
              rendered = true;
            },
          },
        ),
      ),
      new RegExp(expectedCode),
    );
    assert.equal(rendered, false);
  } finally {
    fs.rmSync(values.root, {
      recursive: true,
      force: true,
    });
  }
}

function addGovernedSourceMedia(values) {
  const sourceAssetPath = path.join(
    values.projectDir,
    "assets",
    "official",
    "bastion-gameplay.png",
  );
  const rightsReviewPath = path.join(
    values.projectDir,
    "evidence",
    "source-media-rights-review.json",
  );
  const sourceMediaManifestPath = path.join(
    values.projectDir,
    "source-media-manifest.json",
  );
  fs.mkdirSync(path.dirname(sourceAssetPath), { recursive: true });
  fs.writeFileSync(sourceAssetPath, TINY_PNG);
  fs.writeFileSync(
    values.projectPath,
    [
      "<html><body>",
      '<img id="bastion-gameplay-01" src="assets/official/bastion-gameplay.png" data-start="0" data-duration="2">',
      `<p>${ATTRIBUTION_TEXT}</p>`,
      "</body></html>",
    ].join(""),
  );
  const storyIntake = JSON.parse(
    fs.readFileSync(values.storyIntakePath, "utf8"),
  );
  storyIntake.story.visual_brief.source_media_policy =
    SOURCE_MEDIA_POLICY;
  writeJson(values.storyIntakePath, storyIntake);
  const rightsReview = {
    schema_version: "pulse-governed-rights-review-evidence-v1",
    story_id: STORY_ID,
    review_status: "ACCEPTED",
    rights_basis: "LICENSED",
    publisher: "Square Enix",
    licence_evidence_url: FFXIV_LICENCE_URL,
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
  };
  writeJson(rightsReviewPath, rightsReview);
  const sourceMediaManifest = {
    schema_version: SOURCE_MEDIA_MANIFEST_SCHEMA,
    story_id: STORY_ID,
    generated_at: GENERATED_AT,
    rights_review: {
      path: path.relative(
        path.dirname(sourceMediaManifestPath),
        rightsReviewPath,
      ),
      sha256: sha256(fs.readFileSync(rightsReviewPath)),
      review_status: "ACCEPTED",
    },
    components: [
      {
        component_id: "bastion-gameplay-01",
        media_type: "IMAGE",
        asset: {
          path: path.relative(
            path.dirname(sourceMediaManifestPath),
            sourceAssetPath,
          ),
          sha256: sha256(fs.readFileSync(sourceAssetPath)),
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
        licence_evidence_url: FFXIV_LICENCE_URL,
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
          usage_seconds: [0, 2],
        },
      },
    ],
  };
  writeJson(sourceMediaManifestPath, sourceMediaManifest);
  return {
    sourceAssetPath,
    sourceMediaManifestPath,
    sourceMediaManifestSha256: sha256(
      fs.readFileSync(sourceMediaManifestPath),
    ),
  };
}

function addValidatedLicensedAudio(values, target = 36.48) {
  const packPath = path.join(
    values.evidenceDir,
    "governed-licensed-audio-pack.json",
  );
  const rightsLedgerPath = path.join(
    values.evidenceDir,
    "licensed-audio-rights-ledger.json",
  );
  writeJson(packPath, {
    schema_version: "pulse-governed-licensed-audio-pack-v1",
  });
  writeJson(rightsLedgerPath, {
    schema_version:
      "pulse-governed-licensed-audio-rights-ledger-v1",
  });
  const definitions = [
    ["bed", "MUSIC_BED", "bed.mp3"],
    ["sting", "MUSIC_STING", "sting.wav"],
    ["impact", "SFX_IMPACT", "impact.wav"],
    ["transition", "SFX_TRANSITION", "transition.wav"],
  ];
  const assets = definitions.map(([assetId, role, filename]) => {
    const assetPath = path.join(values.evidenceDir, filename);
    const rightsPath = path.join(
      values.evidenceDir,
      `${assetId}-rights.json`,
    );
    fs.writeFileSync(assetPath, `licensed-${assetId}`);
    writeJson(rightsPath, {
      schema_version:
        "pulse-governed-licensed-audio-rights-evidence-v1",
      asset_id: assetId,
    });
    return {
      asset_id: assetId,
      role,
      provider_id: "epidemic_sound",
      provider_asset_reference:
        `epidemic-sound://${role.toLowerCase()}/${assetId}`,
      path: assetPath,
      relative_path: filename,
      sha256: sha256(fs.readFileSync(assetPath)),
      size_bytes: fs.statSync(assetPath).size,
      rights_record_sha256: assetId.padEnd(64, "a").slice(0, 64),
      rights_evidence_path: rightsPath,
      rights_evidence_sha256: sha256(
        fs.readFileSync(rightsPath),
      ),
      embedded_in_final: true,
    };
  });
  return {
    schema_version:
      "pulse-governed-licensed-audio-pack-validation-v1",
    validation_status: "PASS",
    policy: "EPIDEMIC_SOUND_LICENSED_PACK_V1",
    story_id: STORY_ID,
    channel_id: "pulse-gaming",
    manifest_path: packPath,
    manifest_sha256: sha256(fs.readFileSync(packPath)),
    rights_ledger: {
      path: rightsLedgerPath,
      sha256: sha256(fs.readFileSync(rightsLedgerPath)),
    },
    provider: {
      id: "epidemic_sound",
      licence_basis:
        "epidemic_sound_active_subscription_safelisted_channel",
      licence_evidence_url:
        "https://help.epidemicsound.com/hc/en-us/articles/26248340314258-Safelisting",
      safelist_evidence_path: packPath,
      safelist_evidence_sha256:
        sha256(fs.readFileSync(packPath)),
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
      narration_sha256: sha256(
        fs.readFileSync(values.audioPath),
      ),
      timestamps_sha256: sha256(
        fs.readFileSync(values.timestampsPath),
      ),
      target_duration_seconds: target,
    },
    assets,
    mix: {
      policy_version: "epidemic_sidechain_ducked_bed_v1",
      narration_included: false,
      target_duration_seconds: target,
      bed: {
        asset_id: "bed",
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
      cues: [
        {
          asset_id: "sting",
          at_seconds: 0,
          volume: 0.035,
          trim_start_seconds: 0,
          duration_seconds: 0.62,
          fade_in_seconds: 0,
          fade_out_seconds: 0.16,
        },
        {
          asset_id: "impact",
          at_seconds: 0,
          volume: 0.055,
          trim_start_seconds: 0,
          duration_seconds: 0.32,
          fade_in_seconds: 0,
          fade_out_seconds: 0.08,
        },
        {
          asset_id: "transition",
          at_seconds: 0.35,
          volume: 0.045,
          trim_start_seconds: 0,
          duration_seconds: 0.42,
          fade_in_seconds: 0,
          fade_out_seconds: 0.1,
        },
      ],
    },
    publish_authorised: false,
    database_mutated: false,
    oauth_or_tokens_mutated: false,
    platform_objects_created: false,
    network_used: false,
  };
}

test("normaliseWordTimestamps converts exact ElevenLabs characters into review words", () => {
  const values = fixture();
  try {
    const input = JSON.parse(fs.readFileSync(values.alignmentPath, "utf8"));
    const result = normaliseWordTimestamps({
      storyId: STORY_ID,
      timestamps: input,
      expectedScript: SCRIPT,
    });
    assert.equal(result.schema_version, "pulse-word-timestamps-v1");
    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.transcript, SCRIPT);
    assert.deepEqual(
      result.words.map((word) => word.text),
      SCRIPT.split(" "),
    );
    assert.equal(result.words[0].start_seconds, 0);
    assert.equal(
      result.words.at(-1).end_seconds,
      Number((SCRIPT.length * 0.01).toFixed(3)),
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation binds licensed audio, source alignment and exact word timestamps", () => {
  const values = fixture();
  try {
    const result = validateGovernedNarrationManifest({
      manifestPath: values.narrationManifestPath,
      expectedManifestSha256: values.narrationManifestSha256,
      storyId: STORY_ID,
      scriptSha256: sha256(SCRIPT),
      audioPath: values.audioPath,
      timestampsPath: values.timestampsPath,
      audioDurationSeconds: 0.72,
    });
    assert.equal(
      result.manifest.schema_version,
      "pulse-governed-narration-manifest-v1",
    );
    assert.equal(result.provider, "elevenlabs");
    assert.equal(result.narrator_version, NARRATOR_VERSION);
    assert.equal(result.licence.rights_basis, "LICENSED");
    assert.equal(
      result.timestamps.sha256,
      sha256(fs.readFileSync(values.timestampsPath)),
    );
    assert.equal(
      result.alignment.sha256,
      sha256(fs.readFileSync(values.alignmentPath)),
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation rejects a narrator version that does not match its generator and voice recipe", () => {
  const values = fixture();
  try {
    const manifest = JSON.parse(
      fs.readFileSync(values.narrationManifestPath, "utf8"),
    );
    manifest.narration.narrator_version =
      "pulse-narrator-v1:".concat("0".repeat(64));
    writeJson(values.narrationManifestPath, manifest);

    assert.throws(
      () =>
        validateGovernedNarrationManifest({
          manifestPath: values.narrationManifestPath,
          expectedManifestSha256: sha256(
            fs.readFileSync(values.narrationManifestPath),
          ),
          storyId: STORY_ID,
          scriptSha256: sha256(SCRIPT),
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          audioDurationSeconds: 0.72,
        }),
      /narration_narrator_version_binding_invalid/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("story intake makes an exact target authoritative only inside its named duration band", () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.contract.duration_band_id =
      "what_changes_standard_35_42";
    intake.contract.target_duration_seconds = 36.48;
    writeJson(values.storyIntakePath, intake);
    const result = validateStoryIntake(
      values.storyIntakePath,
    );
    assert.equal(result.targetDurationSeconds, 36.48);
    assert.equal(
      result.durationBandId,
      "what_changes_standard_35_42",
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation binds an explicit non-legacy final target", () => {
  const values = fixture();
  try {
    const manifest = JSON.parse(
      fs.readFileSync(values.narrationManifestPath, "utf8"),
    );
    manifest.narration.final_target_seconds = 36.48;
    manifest.narration.visual_breath_allowance_seconds = 35.76;
    writeJson(values.narrationManifestPath, manifest);
    const result = validateGovernedNarrationManifest({
      manifestPath: values.narrationManifestPath,
      expectedManifestSha256: sha256(
        fs.readFileSync(values.narrationManifestPath),
      ),
      storyId: STORY_ID,
      scriptSha256: sha256(SCRIPT),
      audioPath: values.audioPath,
      timestampsPath: values.timestampsPath,
      audioDurationSeconds: 0.72,
      finalTargetSeconds: 36.48,
    });
    assert.equal(result.final_target_seconds, 36.48);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation fails closed when a bound timestamp artefact is substituted", () => {
  const values = fixture();
  try {
    const timestamp = JSON.parse(
      fs.readFileSync(values.timestampsPath, "utf8"),
    );
    timestamp.words[0].text = "Tampered";
    writeJson(values.timestampsPath, timestamp);
    assert.throws(
      () =>
        validateGovernedNarrationManifest({
          manifestPath: values.narrationManifestPath,
          expectedManifestSha256:
            values.narrationManifestSha256,
          storyId: STORY_ID,
          scriptSha256: sha256(SCRIPT),
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          audioDurationSeconds: 0.72,
        }),
      /narration_word_timestamps_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("governed narration validation requires the independently supplied manifest hash", () => {
  const values = fixture();
  try {
    assert.throws(
      () =>
        validateGovernedNarrationManifest({
          manifestPath: values.narrationManifestPath,
          expectedManifestSha256: "f".repeat(64),
          storyId: STORY_ID,
          scriptSha256: sha256(SCRIPT),
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          audioDurationSeconds: 0.72,
        }),
      /narration_manifest_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("normaliseWordTimestamps accepts an already governed pulse word-timestamp file", () => {
  const words = [
    { text: "Final", start_seconds: 0, end_seconds: 0.3 },
    {
      text: "Fantasy",
      start_seconds: 0.31,
      end_seconds: 0.72,
    },
  ];
  const expectedScript = "Final Fantasy";
  const expectedScriptSha256 = sha256(expectedScript);
  const expectedAudioSha256 = "b".repeat(64);
  const result = normaliseWordTimestamps({
    storyId: STORY_ID,
    timestamps: {
      schema_version: "pulse-word-timestamps-v1",
      story_id: STORY_ID,
      script_sha256: expectedScriptSha256,
      audio_sha256: expectedAudioSha256,
      source_alignment_sha256: "c".repeat(64),
      words,
    },
    expectedScript,
    expectedScriptSha256,
    expectedAudioSha256,
  });
  assert.equal(result.schema_version, "pulse-word-timestamps-v1");
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.transcript, expectedScript);
  assert.deepEqual(result.words, words);
  assert.equal(result.script_sha256, expectedScriptSha256);
  assert.equal(result.audio_sha256, expectedAudioSha256);
  assert.equal(result.source_alignment_sha256, "c".repeat(64));
});

test("combined manifest validation binds the exact HF video, backbone and project hashes", () => {
  const values = fixture();
  try {
    const result = validateCombinedOwnedMotionManifest({
      manifestPath: values.combinedManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      sourceMediaPolicy: "OWNED_ONLY",
    });
    assert.equal(result.hyperframesAsset.role, "hyperframes_intermediate");
    assert.equal(result.backboneAsset.role, "owned_motion_backbone");
    assert.equal(
      result.openingTreatment.first_frame_text,
      "A TANK WITH TWO SHIELDS",
    );
    assert.equal(
      result.openingTreatment.asset.sha256,
      sha256(fs.readFileSync(values.hookSlamPath)),
    );
    assert.deepEqual(
      result.projectFiles.map((record) => path.basename(record.path)).sort(),
      ["hyperframes.json", "index.html"],
    );
    assert.equal(result.thirdPartyMediaUsed, false);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("path identity preserves POSIX case sensitivity and Windows case folding", () => {
  assert.equal(samePath("/tmp/Pulse/Foo", "/tmp/Pulse/foo", "linux"), false);
  assert.equal(
    samePath("C:/Pulse/Foo", "C:/Pulse/foo", "win32"),
    true,
  );
});

test("combined manifest validation binds an explicit licensed-audio runtime", () => {
  const values = fixture();
  try {
    const manifest = JSON.parse(
      fs.readFileSync(values.combinedManifestPath, "utf8"),
    );
    const hyperframesAsset = manifest.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    );
    hyperframesAsset.duration_seconds = 36.48;
    writeJson(values.combinedManifestPath, manifest);
    const result = validateCombinedOwnedMotionManifest({
      manifestPath: values.combinedManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      sourceMediaPolicy: "OWNED_ONLY",
      expectedDurationSeconds: 36.48,
    });
    assert.equal(
      result.hyperframesAsset.duration_seconds,
      36.48,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("combined manifest validation fails closed on a substituted HF intermediate", () => {
  const values = fixture();
  try {
    fs.appendFileSync(values.hyperframesPath, "tampered");
    assert.throws(
      () =>
        validateCombinedOwnedMotionManifest({
          manifestPath: values.combinedManifestPath,
          storyId: STORY_ID,
          hyperframesVideoPath: values.hyperframesPath,
          sourceMediaPolicy: "OWNED_ONLY",
        }),
      /hyperframes_intermediate_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("deriveCombinedOwnedMotionManifest safely binds an original manifest to explicit HF project files", async () => {
  const values = fixture();
  try {
    const outputPath = path.join(
      values.root,
      "derived",
      "combined-owned-motion-manifest.json",
    );
    const derived = await deriveCombinedOwnedMotionManifest({
      sourceManifestPath: values.originalManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      hyperframesProbe: videoProbe(),
      projectFilePaths: [values.projectPath, values.configPath],
      outputPath,
      generatedAt: GENERATED_AT,
      generatorIdentity: "hyperframes@0.7.76",
      sourceMediaPolicy: "OWNED_ONLY",
    });
    assert.equal(derived.derived, true);
    assert.equal(derived.path, outputPath);
    const validation = validateCombinedOwnedMotionManifest({
      manifestPath: outputPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      sourceMediaPolicy: "OWNED_ONLY",
    });
    assert.equal(
      validation.hyperframesAsset.sha256,
      sha256(fs.readFileSync(values.hyperframesPath)),
    );
    assert.equal(validation.projectFiles.length, 2);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("licensed source media produces a truthful mixed HyperFrames manifest bound to the exact project", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    const outputPath = path.join(
      values.root,
      "derived",
      "combined-owned-motion-manifest.json",
    );
    await deriveCombinedOwnedMotionManifest({
      sourceManifestPath: values.originalManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      hyperframesProbe: videoProbe(),
      projectFilePaths: [
        values.projectPath,
        values.configPath,
        sourceMedia.sourceAssetPath,
      ],
      outputPath,
      generatedAt: GENERATED_AT,
      generatorIdentity: "hyperframes@0.7.76",
      sourceMediaManifestPath:
        sourceMedia.sourceMediaManifestPath,
      expectedSourceMediaManifestSha256:
        sourceMedia.sourceMediaManifestSha256,
      sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      validationBoundaryAt: GENERATED_AT,
    });

    const combined = JSON.parse(
      fs.readFileSync(outputPath, "utf8"),
    );
    const hyperframesAsset = combined.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    );
    assert.equal(hyperframesAsset.ownership, "mixed");
    assert.equal(hyperframesAsset.rights_basis, "LICENSED");
    assert.equal(hyperframesAsset.attribution_required, true);
    assert.equal(
      hyperframesAsset.provenance.third_party_media_used,
      true,
    );
    assert.equal(
      hyperframesAsset.provenance.source_media_manifest.sha256,
      sourceMedia.sourceMediaManifestSha256,
    );
    assert.equal(
      hyperframesAsset.provenance.source_media_components[0]
        .component_id,
      "bastion-gameplay-01",
    );

    const validation = validateCombinedOwnedMotionManifest({
      manifestPath: outputPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      sourceMediaManifestPath:
        sourceMedia.sourceMediaManifestPath,
      expectedSourceMediaManifestSha256:
        sourceMedia.sourceMediaManifestSha256,
      sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      validationBoundaryAt: GENERATED_AT,
    });
    assert.equal(validation.thirdPartyMediaUsed, true);
    assert.equal(validation.sourceMedia.components.length, 1);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("combined manifest validation rejects a mixed HyperFrames intermediate that aliases its owned backbone", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    const outputPath = path.join(
      values.root,
      "derived",
      "combined-owned-motion-manifest.json",
    );
    await deriveCombinedOwnedMotionManifest({
      sourceManifestPath: values.originalManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      hyperframesProbe: videoProbe(),
      projectFilePaths: [
        values.projectPath,
        values.configPath,
        sourceMedia.sourceAssetPath,
      ],
      outputPath,
      generatedAt: GENERATED_AT,
      generatorIdentity: "hyperframes@0.7.76",
      sourceMediaManifestPath:
        sourceMedia.sourceMediaManifestPath,
      expectedSourceMediaManifestSha256:
        sourceMedia.sourceMediaManifestSha256,
      sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      validationBoundaryAt: GENERATED_AT,
    });

    const combined = JSON.parse(
      fs.readFileSync(outputPath, "utf8"),
    );
    const hybrid = combined.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    );
    const backbone = combined.assets.find(
      (asset) => asset.role === "owned_motion_backbone",
    );
    delete backbone.attribution_required;
    writeJson(outputPath, combined);
    assert.throws(
      () =>
        validateCombinedOwnedMotionManifest({
          manifestPath: outputPath,
          storyId: STORY_ID,
          hyperframesVideoPath: values.hyperframesPath,
          sourceMediaManifestPath:
            sourceMedia.sourceMediaManifestPath,
          expectedSourceMediaManifestSha256:
            sourceMedia.sourceMediaManifestSha256,
          sourceMediaPolicy: SOURCE_MEDIA_POLICY,
          validationBoundaryAt: GENERATED_AT,
        }),
      (error) =>
        error?.codes?.includes(
          "hyperframes_source_backbone_policy_invalid",
        ),
    );

    backbone.attribution_required = false;
    backbone.path = hybrid.path;
    backbone.sha256 = hybrid.sha256;
    hybrid.provenance.source_backbone = {
      path: hybrid.path,
      sha256: hybrid.sha256,
    };
    writeJson(outputPath, combined);

    assert.throws(
      () =>
        validateCombinedOwnedMotionManifest({
          manifestPath: outputPath,
          storyId: STORY_ID,
          hyperframesVideoPath: values.hyperframesPath,
          sourceMediaManifestPath:
            sourceMedia.sourceMediaManifestPath,
          expectedSourceMediaManifestSha256:
            sourceMedia.sourceMediaManifestSha256,
          sourceMediaPolicy: SOURCE_MEDIA_POLICY,
          validationBoundaryAt: GENERATED_AT,
        }),
      (error) =>
        error?.codes?.includes(
          "hyperframes_source_backbone_not_distinct",
        ),
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("combined manifest validation rejects mixed or third-party motion without the exact governed source-media manifest", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    const outputPath = path.join(
      values.root,
      "derived",
      "combined-owned-motion-manifest.json",
    );
    await deriveCombinedOwnedMotionManifest({
      sourceManifestPath: values.originalManifestPath,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      hyperframesProbe: videoProbe(),
      projectFilePaths: [
        values.projectPath,
        values.configPath,
        sourceMedia.sourceAssetPath,
      ],
      outputPath,
      generatedAt: GENERATED_AT,
      sourceMediaManifestPath:
        sourceMedia.sourceMediaManifestPath,
      expectedSourceMediaManifestSha256:
        sourceMedia.sourceMediaManifestSha256,
      sourceMediaPolicy: SOURCE_MEDIA_POLICY,
    });

    assert.throws(
      () =>
        validateCombinedOwnedMotionManifest({
          manifestPath: outputPath,
          storyId: STORY_ID,
          hyperframesVideoPath: values.hyperframesPath,
          sourceMediaPolicy: "OWNED_ONLY",
        }),
      /source_media_manifest_required_for_mixed_motion/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("source-media derivation rejects a licensed asset that is not an exact hash-bound HyperFrames project file", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    await assert.rejects(
      deriveCombinedOwnedMotionManifest({
        sourceManifestPath: values.originalManifestPath,
        storyId: STORY_ID,
        hyperframesVideoPath: values.hyperframesPath,
        hyperframesProbe: videoProbe(),
        projectFilePaths: [
          values.projectPath,
          values.configPath,
        ],
        outputPath: path.join(
          values.root,
          "derived",
          "combined-owned-motion-manifest.json",
        ),
        generatedAt: GENERATED_AT,
        sourceMediaManifestPath:
          sourceMedia.sourceMediaManifestPath,
        expectedSourceMediaManifestSha256:
          sourceMedia.sourceMediaManifestSha256,
        sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      }),
      /source_media_component_bastion-gameplay-01_not_bound_by_project/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("source-media derivation requires an exact DOM component and Square Enix notice in hash-bound index HTML", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    fs.writeFileSync(
      values.projectPath,
      '<html><img src="assets/official/bastion-gameplay.png"></html>',
    );
    await assert.rejects(
      deriveCombinedOwnedMotionManifest({
        sourceManifestPath: values.originalManifestPath,
        storyId: STORY_ID,
        hyperframesVideoPath: values.hyperframesPath,
        hyperframesProbe: videoProbe(),
        projectFilePaths: [
          values.projectPath,
          values.configPath,
          sourceMedia.sourceAssetPath,
        ],
        outputPath: path.join(
          values.root,
          "derived",
          "combined-owned-motion-manifest.json",
        ),
        generatedAt: GENERATED_AT,
        sourceMediaManifestPath:
          sourceMedia.sourceMediaManifestPath,
        expectedSourceMediaManifestSha256:
          sourceMedia.sourceMediaManifestSha256,
        sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "source_media_attribution_missing_from_index",
          ),
        );
        assert.ok(
          error.codes.includes(
            "source_media_component_bastion-gameplay-01_dom_binding_missing",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("source-media DOM binding cannot be satisfied by comments or unused script constants", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    fs.writeFileSync(
      values.projectPath,
      [
        "<html><body>",
        `<!-- <img id="bastion-gameplay-01" src="assets/official/bastion-gameplay.png" data-start="0" data-duration="2"> -->`,
        `<script>const unused = '<img id="bastion-gameplay-01" src="assets/official/bastion-gameplay.png" data-start="0" data-duration="2">';</script>`,
        `<p>${ATTRIBUTION_TEXT}</p>`,
        "</body></html>",
      ].join(""),
    );
    await assert.rejects(
      deriveCombinedOwnedMotionManifest({
        sourceManifestPath: values.originalManifestPath,
        storyId: STORY_ID,
        hyperframesVideoPath: values.hyperframesPath,
        hyperframesProbe: videoProbe(),
        projectFilePaths: [
          values.projectPath,
          values.configPath,
          sourceMedia.sourceAssetPath,
        ],
        outputPath: path.join(
          values.root,
          "derived",
          "combined-owned-motion-manifest.json",
        ),
        generatedAt: GENERATED_AT,
        sourceMediaManifestPath:
          sourceMedia.sourceMediaManifestPath,
        expectedSourceMediaManifestSha256:
          sourceMedia.sourceMediaManifestSha256,
        sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      }),
      (error) => {
        assert.ok(
          error.codes.includes(
            "source_media_component_bastion-gameplay-01_dom_binding_missing",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("source-media DOM binding requires the exact local src and manifest usage timing", async () => {
  for (const [html, expectedCode] of [
    [
      `<html><body><img id="bastion-gameplay-01" src="assets/official/other.png" data-start="0" data-duration="2"><p>${ATTRIBUTION_TEXT}</p></body></html>`,
      "source_media_component_bastion-gameplay-01_src_mismatch",
    ],
    [
      `<html><body><img id="bastion-gameplay-01" src="assets/official/bastion-gameplay.png" data-start="0.25" data-duration="1.75"><p>${ATTRIBUTION_TEXT}</p></body></html>`,
      "source_media_component_bastion-gameplay-01_timing_mismatch",
    ],
  ]) {
    const values = fixture();
    try {
      const sourceMedia = addGovernedSourceMedia(values);
      fs.writeFileSync(values.projectPath, html);
      await assert.rejects(
        deriveCombinedOwnedMotionManifest({
          sourceManifestPath: values.originalManifestPath,
          storyId: STORY_ID,
          hyperframesVideoPath: values.hyperframesPath,
          hyperframesProbe: videoProbe(),
          projectFilePaths: [
            values.projectPath,
            values.configPath,
            sourceMedia.sourceAssetPath,
          ],
          outputPath: path.join(
            values.root,
            "derived",
            "combined-owned-motion-manifest.json",
          ),
          generatedAt: GENERATED_AT,
          sourceMediaManifestPath:
            sourceMedia.sourceMediaManifestPath,
          expectedSourceMediaManifestSha256:
            sourceMedia.sourceMediaManifestSha256,
          sourceMediaPolicy: SOURCE_MEDIA_POLICY,
        }),
        (error) => {
          assert.ok(error.codes.includes(expectedCode));
          return true;
        },
      );
    } finally {
      fs.rmSync(values.root, { recursive: true, force: true });
    }
  }
});

test("final-composite service independently verifies the supplied source-media manifest SHA-256", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    await assert.rejects(
      deriveCombinedOwnedMotionManifest({
        sourceManifestPath: values.originalManifestPath,
        storyId: STORY_ID,
        hyperframesVideoPath: values.hyperframesPath,
        hyperframesProbe: videoProbe(),
        projectFilePaths: [
          values.projectPath,
          values.configPath,
          sourceMedia.sourceAssetPath,
        ],
        outputPath: path.join(
          values.root,
          "derived",
          "combined-owned-motion-manifest.json",
        ),
        generatedAt: GENERATED_AT,
        sourceMediaManifestPath:
          sourceMedia.sourceMediaManifestPath,
        expectedSourceMediaManifestSha256: "f".repeat(64),
        sourceMediaPolicy: SOURCE_MEDIA_POLICY,
      }),
      /source_media_manifest_sha256_mismatch/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("ffmpeg invocation burns captions and pads exact narration without shortest truncation", () => {
  const invocation = buildFfmpegInvocation({
    videoPath: "C:/proof/hf.mp4",
    audioPath: "C:/proof/narration.mp3",
    filterPath: "C:/proof/out/filter-complex.txt",
    outputPath: "C:/proof/out/final.mp4",
    durationSeconds: 25,
    sourceVideoDurationSeconds: 28,
    sourceLoudness: sourceLoudness(),
  });
  assert.equal(invocation.command, "ffmpeg");
  assert.ok(invocation.args.includes("libx264"));
  assert.ok(invocation.args.includes("aac"));
  assert.ok(invocation.args.includes("48000"));
  assert.ok(invocation.args.includes("30"));
  assert.equal(invocation.args.includes("-shortest"), false);
  assert.match(invocation.filter, /ass=captions\.ass/);
  assert.match(invocation.filter, /setpts=0\.892857142857\*PTS/);
  assert.match(invocation.filter, /loudnorm=I=-16:TP=-1\.5:LRA=11/);
  assert.match(invocation.filter, /measured_I=-23\.9/);
  assert.match(invocation.filter, /apad=whole_dur=25/);
  assert.match(invocation.filter, /atrim=duration=25/);
});

test("ffmpeg invocation preserves hash-bound captions already rendered by HyperFrames", () => {
  const invocation = buildFfmpegInvocation({
    videoPath: "C:/proof/hf-captioned.mp4",
    audioPath: "C:/proof/narration.mp3",
    filterPath: "C:/proof/out/filter-complex.txt",
    outputPath: "C:/proof/out/final.mp4",
    durationSeconds: 36.48,
    sourceVideoDurationSeconds: 36.48,
    sourceLoudness: sourceLoudness(),
    preserveRenderedCaptions: true,
  });

  assert.doesNotMatch(invocation.filter, /ass=captions\.ass/);
  assert.match(
    invocation.filter,
    /\[base\]trim=duration=36\.48,setpts=PTS-STARTPTS\[outv\]/,
  );
  assert.equal(invocation.captions.mode, "PRE_RENDERED");
  assert.equal(invocation.captions.final_burn_in_performed, false);
  assert.equal(invocation.visual_timing.playback_rate, 1);
});

test("pre-rendered caption timing is never retimed and reports a bounded source tail trim", () => {
  const invocation = buildFfmpegInvocation({
    videoPath: "C:/proof/hf-captioned.mp4",
    audioPath: "C:/proof/narration.mp3",
    filterPath: "C:/proof/out/filter-complex.txt",
    outputPath: "C:/proof/out/final.mp4",
    durationSeconds: 36.48,
    sourceVideoDurationSeconds: 36.5,
    sourceLoudness: sourceLoudness(),
    preserveRenderedCaptions: true,
  });

  assert.match(invocation.filter, /\[0:v:0\]setpts=1\*PTS/);
  assert.equal(invocation.visual_timing.playback_rate, 1);
  assert.equal(
    invocation.visual_timing.full_source_sequence_preserved,
    false,
  );
  assert.equal(
    invocation.visual_timing.source_tail_trimmed_seconds,
    0.02,
  );
  assert.equal(
    invocation.visual_timing.source_tail_padded_seconds,
    0,
  );
});

test("ffmpeg invocation deterministically mixes a governed licensed-audio pack at its bound runtime", () => {
  const licensedAudio = {
    manifest_path: "C:/proof/audio/governed-licensed-audio-pack.json",
    manifest_sha256: "a".repeat(64),
    assets: [
      {
        asset_id: "bed",
        role: "MUSIC_BED",
        path: "C:/proof/audio/bed.mp3",
        sha256: "b".repeat(64),
      },
      {
        asset_id: "sting",
        role: "MUSIC_STING",
        path: "C:/proof/audio/sting.wav",
        sha256: "c".repeat(64),
      },
      {
        asset_id: "impact",
        role: "SFX_IMPACT",
        path: "C:/proof/audio/impact.wav",
        sha256: "d".repeat(64),
      },
      {
        asset_id: "transition",
        role: "SFX_TRANSITION",
        path: "C:/proof/audio/transition.wav",
        sha256: "e".repeat(64),
      },
    ],
    mix: {
      policy_version: "epidemic_sidechain_ducked_bed_v1",
      narration_included: false,
      target_duration_seconds: 36.48,
      bed: {
        asset_id: "bed",
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
      micro_drop_windows: [
        {
          start_seconds: 2.63,
          end_seconds: 2.83,
          multiplier: 0.18,
        },
      ],
      cues: [
        {
          asset_id: "sting",
          at_seconds: 0,
          volume: 0.035,
          trim_start_seconds: 0,
          duration_seconds: 0.62,
          fade_in_seconds: 0,
          fade_out_seconds: 0.16,
        },
        {
          asset_id: "impact",
          at_seconds: 0,
          volume: 0.055,
          trim_start_seconds: 0,
          duration_seconds: 0.32,
          fade_in_seconds: 0,
          fade_out_seconds: 0.08,
        },
        {
          asset_id: "transition",
          at_seconds: 0.35,
          volume: 0.045,
          trim_start_seconds: 0,
          duration_seconds: 0.42,
          fade_in_seconds: 0,
          fade_out_seconds: 0.1,
        },
      ],
    },
  };
  const invocation = buildFfmpegInvocation({
    videoPath: "C:/proof/hf.mp4",
    audioPath: "C:/proof/narration.mp3",
    filterPath: "C:/proof/out/filter-complex.txt",
    outputPath: "C:/proof/out/final.mp4",
    durationSeconds: 36.48,
    sourceVideoDurationSeconds: 36.48,
    sourceLoudness: sourceLoudness(),
    licensedAudio,
  });

  assert.equal(invocation.args.includes("-shortest"), false);
  assert.ok(invocation.args.includes(path.resolve("C:/proof/audio/bed.mp3")));
  assert.ok(invocation.args.includes(path.resolve("C:/proof/audio/sting.wav")));
  assert.equal(
    invocation.args.filter((value) => value === "-stream_loop").length,
    1,
  );
  assert.match(invocation.filter, /sidechaincompress=threshold=0\.035:ratio=5\.5:attack=18:release=420/);
  assert.match(invocation.filter, /volume=0\.18:enable='between\(t,2\.63,2\.83\)'/);
  assert.match(invocation.filter, /adelay=350\|350/);
  assert.match(invocation.filter, /amix=inputs=5:duration=first/);
  assert.match(invocation.filter, /atrim=duration=36\.48/);
  assert.equal(invocation.visual_timing.final_duration_seconds, 36.48);
  assert.equal(invocation.licensed_audio.asset_count, 4);
});

test("licensed-audio runtime authority permits the exact 36.48-second source, narration and final probes", () => {
  const target = 36.48;
  const hyperframes = inspectHyperframesProbe(
    videoProbe({ duration: target }),
    { expectedDurationSeconds: target },
  );
  const narration = inspectNarrationProbe(
    audioProbe(36.480317),
    { maximumDurationSeconds: target },
  );
  const final = inspectFinalProbe(
    videoProbe({ duration: target, audio: true }),
    { expectedDurationSeconds: target },
  );

  assert.equal(hyperframes.duration_seconds, target);
  assert.equal(narration.duration_seconds, 36.480317);
  assert.equal(final.technical.duration_seconds, target);
});

test("audio QA parsers retain exact loudness and terminal-silence evidence", () => {
  const loudness = parseLoudnormOutput(`
    [Parsed_loudnorm_0] {
      "input_i" : "-16.16",
      "input_tp" : "-4.37",
      "input_lra" : "1.80",
      "input_thresh" : "-26.66",
      "target_offset" : "-0.16"
    }
  `);
  assert.deepEqual(loudness, {
    integrated_lufs: -16.16,
    true_peak_dbfs: -4.37,
    loudness_range_lu: 1.8,
    threshold_lufs: -26.66,
    target_offset_lu: -0.16,
  });
  const silence = parseTerminalSilenceOutput(
    [
      "silence_start: 23.338146",
      "silence_end: 23.621583 | silence_duration: 0.283438",
      "silence_start: 23.655313",
      "silence_end: 24.015646 | silence_duration: 0.360333",
    ].join("\n"),
    { durationSeconds: 24 },
  );
  assert.equal(silence.terminal_silence_start_seconds, 23.655);
  assert.equal(silence.terminal_silence_seconds, 0.345);
});

test("executeGovernedFinalComposite writes a hash-bound studio-v21 LOCAL_PROOF bundle", async () => {
  const values = fixture();
  try {
    const calls = [];
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.combinedManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        outDir: values.outputDir,
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          calls.push(invocation);
          fs.writeFileSync(invocation.outputPath, "final-studio-v21");
        },
      },
    );

    assert.equal(result.mode, "LOCAL_PROOF");
    assert.equal(result.verdict, "MATERIALIZED_LOCAL_PROOF");
    assert.equal(result.story_id, STORY_ID);
    assert.equal(result.renderer_identity, "studio-v21");
    assert.equal(result.publish_authorised, false);
    assert.equal(result.network_used, false);
    assert.equal(result.database_mutated, false);
    assert.equal(
      result.narration_manifest_sha256,
      sha256(fs.readFileSync(values.narrationManifestPath)),
    );
    assert.equal(calls.length, 1);
    assert.ok(fs.existsSync(result.final_mp4_path));
    assert.ok(fs.existsSync(result.captions_path));
    assert.ok(fs.existsSync(result.word_timestamps_path));
    assert.ok(fs.existsSync(result.renderer_manifest_path));
    assert.ok(fs.existsSync(result.qa_report_path));
    assert.ok(fs.existsSync(result.composite_manifest_path));
    assert.ok(fs.existsSync(result.markdown_path));
    assert.equal(
      result.controlled_experiment_observation_path,
      undefined,
    );
    assert.equal(
      fs.existsSync(
        path.join(
          path.dirname(result.composite_manifest_path),
          "controlled-experiment-observation.json",
        ),
      ),
      false,
    );
    const captions = fs.readFileSync(result.captions_path, "utf8");
    const captionSafeZone = validateAssCaptionSafeZone({
      ass: captions,
      profileId: CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
    });
    assert.equal(captionSafeZone.verdict, "GREEN");
    assert.deepEqual(captionSafeZone.anchor, {
      x: 456,
      y: 1200,
      alignment: 2,
    });
    assert.equal(
      path.dirname(result.final_mp4_path),
      path.join(values.outputDir, STORY_ID),
    );
    assert.doesNotMatch(result.final_mp4_path, /\.staging-/);
    const promotedMotion = validateCombinedOwnedMotionManifest({
      manifestPath: result.combined_owned_motion_manifest_path,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      sourceMediaPolicy: "OWNED_ONLY",
    });
    assert.equal(promotedMotion.projectFiles.length, 2);

    const renderer = JSON.parse(
      fs.readFileSync(result.renderer_manifest_path, "utf8"),
    );
    assert.equal(renderer.renderer.id, "studio-v21");
    assert.deepEqual(renderer.stack, {
      hyperframes: true,
      ffmpeg: true,
    });
    assert.equal(renderer.output.width, 1080);
    assert.equal(renderer.output.height, 1920);
    assert.equal(renderer.output.video_codec, "h264");
    assert.equal(renderer.output.video_profile, "High");
    assert.equal(renderer.output.pixel_format, "yuv420p");
    assert.equal(renderer.output.audio_codec, "aac");
    assert.equal(renderer.output.audio_sample_rate_hz, 48000);
    assert.equal(renderer.output.duration_seconds, 25);
    assert.equal(
      renderer.timing.first_frame_text,
      "A TANK WITH TWO SHIELDS",
    );
    assert.equal(renderer.inputs[0].role, "motion");
    assert.equal(renderer.inputs[0].sha256, sha256(fs.readFileSync(values.hyperframesPath)));

    const qa = JSON.parse(fs.readFileSync(result.qa_report_path, "utf8"));
    assert.equal(qa.schema_version, "pulse-final-render-qa-v1");
    assert.equal(qa.verdict, "PASS");
    assert.equal(qa.story_id, STORY_ID);
    assert.equal(qa.media_sha256, result.media_sha256);
    assert.equal(
      qa.captions.safe_zone.profile_id,
      CROSS_PLATFORM_PORTRAIT_PROFILE_ID,
    );
    assert.equal(qa.captions.safe_zone.verdict, "GREEN");
    assert.equal(
      qa.audio.loudness.final.integrated_lufs,
      -16,
    );
    assert.equal(
      qa.audio.loudness.final.true_peak_dbfs,
      -1.7,
    );
    assert.equal(
      qa.audio.terminal_silence_seconds,
      1.316,
    );
    assert.equal(qa.technical.duration_seconds, 25);

    const manifest = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.equal(manifest.mode, "LOCAL_PROOF");
    assert.equal(manifest.human_visual_review_required, true);
    assert.deepEqual(manifest.visual_review_requirement, {
      policy_id: "pulse-visual-review-policy",
      policy_version: "2",
      default_gate: "HUMAN_FINAL_RENDER",
      human_review_required_by_default: true,
      autonomous_exception_gate: "AUTONOMOUS_OFFICIAL_UNANIMOUS",
      autonomous_exception_authority_type:
        "AUTONOMOUS_LOW_RISK_OFFICIAL_SOURCE",
      required_report_schema:
        "pulse-local-multimodal-visual-review-v1",
      required_decision_schema:
        "pulse-governed-autonomous-visual-gate-decision-v1",
      minimum_distinct_vision_models: 2,
      models_treated_as_humans: false,
    });
    assert.equal(manifest.hyperframes.material_stage, true);
    assert.equal(manifest.ffmpeg.final_composite, true);
    assert.equal(
      manifest.inputs.governed_narration_manifest.sha256,
      sha256(fs.readFileSync(values.narrationManifestPath)),
    );
    assert.equal(
      manifest.inputs.hyperframes_intermediate.sha256,
      sha256(fs.readFileSync(values.hyperframesPath)),
    );
    assert.equal(
      manifest.inputs.controlled_experiment_observation,
      undefined,
    );
    assert.equal(
      manifest.controlled_experiment_observation,
      undefined,
    );
    assert.equal(manifest.safety.external_calls.length, 0);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite materialises an eligible controlled-experiment observation from immutable final evidence", async () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.contract.editorial_lane_id =
      "what_changes_for_players";
    intake.contract.hook_type = "direct";
    intake.experiment_dimensions = {
      eligible: true,
      experiment_id: "pulse-v1-controlled-12",
      matrix_version: "pulse-controlled-12-v1",
      expected_cell_id:
        "what_changes_for_players:direct:short",
      topic: "new playable tank class",
      game: "Final Fantasy XIV",
      subject_platform: "multi-platform",
    };
    writeJson(values.storyIntakePath, intake);

    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.combinedManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        outDir: values.outputDir,
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          fs.writeFileSync(
            invocation.outputPath,
            "controlled-experiment-final",
          );
        },
      },
    );

    assert.ok(
      fs.existsSync(result.controlled_experiment_observation_path),
    );
    const observation = JSON.parse(
      fs.readFileSync(
        result.controlled_experiment_observation_path,
        "utf8",
      ),
    );
    const renderer = JSON.parse(
      fs.readFileSync(result.renderer_manifest_path, "utf8"),
    );
    const qa = JSON.parse(
      fs.readFileSync(result.qa_report_path, "utf8"),
    );
    assert.deepEqual(observation.identity, {
      story_id: STORY_ID,
      channel_id: "pulse-gaming",
    });
    assert.deepEqual(observation.experiment, {
      eligible: true,
      experiment_id: "pulse-v1-controlled-12",
      matrix_version: "pulse-controlled-12-v1",
      expected_cell_id:
        "what_changes_for_players:direct:short",
      ineligibility_reason: null,
    });
    assert.deepEqual(observation.creative_static, {
      runtime_seconds: 25,
      hook_type: "direct",
      narrator_version: NARRATOR_VERSION,
      first_frame_text: "A TANK WITH TWO SHIELDS",
      motion_ratio: 1,
      topic: "new playable tank class",
      game: "Final Fantasy XIV",
      subject_platform: "multi-platform",
      source_type: "official",
      consequence_lane: "what_changes_for_players",
      renderer_version: "studio-v21.5.0",
      qa_result: "pass",
    });
    assert.deepEqual(observation.bindings, {
      story_intake_sha256: sha256(
        fs.readFileSync(values.storyIntakePath),
      ),
      narration_manifest_sha256: sha256(
        fs.readFileSync(values.narrationManifestPath),
      ),
      renderer_manifest_file_sha256: sha256(
        fs.readFileSync(result.renderer_manifest_path),
      ),
      renderer_manifest_canonical_sha256:
        qa.renderer_manifest_sha256,
      qa_report_sha256: sha256(
        fs.readFileSync(result.qa_report_path),
      ),
      media_sha256: result.media_sha256,
      script_sha256: sha256(SCRIPT),
    });
    assert.equal(
      result.controlled_experiment_observation_sha256,
      observation.observation_sha256,
    );
    assert.equal(
      result.controlled_experiment_observation_file_sha256,
      sha256(
        fs.readFileSync(
          result.controlled_experiment_observation_path,
        ),
      ),
    );

    const composite = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.deepEqual(
      composite.controlled_experiment_observation,
      {
        path: "controlled-experiment-observation.json",
        file_sha256:
          result.controlled_experiment_observation_file_sha256,
        observation_sha256:
          observation.observation_sha256,
        eligible: true,
      },
    );
    assert.deepEqual(
      composite.inputs.controlled_experiment_observation,
      composite.controlled_experiment_observation,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite records an explicit ineligible experiment without fabricating creative dimensions", async () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.experiment_dimensions = {
      eligible: false,
      ineligibility_reason:
        "Breaking high-cadence stories are outside the controlled calibration.",
    };
    intake.story._extra = {
      topic: "must not be inferred",
      game: "must not be inferred",
      subject_platform: "must not be inferred",
    };
    writeJson(values.storyIntakePath, intake);

    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.combinedManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        outDir: values.outputDir,
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          fs.writeFileSync(
            invocation.outputPath,
            "ineligible-experiment-final",
          );
        },
      },
    );

    const observation = JSON.parse(
      fs.readFileSync(
        result.controlled_experiment_observation_path,
        "utf8",
      ),
    );
    assert.deepEqual(observation.experiment, {
      eligible: false,
      experiment_id: null,
      matrix_version: null,
      expected_cell_id: null,
      ineligibility_reason:
        "Breaking high-cadence stories are outside the controlled calibration.",
    });
    assert.equal(observation.creative_static, null);
    const composite = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.equal(
      composite.controlled_experiment_observation.eligible,
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite never interprets missing experiment eligibility as ineligible", async () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.experiment_dimensions = {
      ineligibility_reason:
        "An eligibility decision was never recorded.",
    };
    writeJson(values.storyIntakePath, intake);

    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            if (filePath === values.hyperframesPath) {
              return videoProbe();
            }
            return videoProbe({ duration: 25, audio: true });
          },
          measureLoudness(filePath) {
            return filePath === values.audioPath
              ? sourceLoudness()
              : finalLoudness();
          },
          measureTerminalSilence() {
            return terminalSilence();
          },
          renderComposite(invocation) {
            fs.writeFileSync(
              invocation.outputPath,
              "missing-eligibility-final",
            );
          },
        },
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "controlled_experiment_observation_experiment_eligibility_required",
          ),
        );
        return true;
      },
    );
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite rejects experiment identity on an explicitly ineligible intake", async () => {
  const values = fixture();
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.experiment_dimensions = {
      eligible: false,
      ineligibility_reason:
        "Breaking high-cadence stories are outside the controlled calibration.",
      experiment_id: "must-not-be-silently-discarded",
    };
    writeJson(values.storyIntakePath, intake);

    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            if (filePath === values.hyperframesPath) {
              return videoProbe();
            }
            return videoProbe({ duration: 25, audio: true });
          },
          measureLoudness(filePath) {
            return filePath === values.audioPath
              ? sourceLoudness()
              : finalLoudness();
          },
          measureTerminalSilence() {
            return terminalSilence();
          },
          renderComposite(invocation) {
            fs.writeFileSync(
              invocation.outputPath,
              "contradictory-ineligible-final",
            );
          },
        },
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "experiment_dimensions_ineligible_fields_invalid",
          ),
        );
        return true;
      },
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite records that reviewed HyperFrames captions were preserved", async () => {
  const values = fixture();
  try {
    const target = 36.48;
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.contract.duration_band_id =
      "what_changes_standard_35_42";
    intake.contract.target_duration_seconds = target;
    writeJson(values.storyIntakePath, intake);
    const motion = JSON.parse(
      fs.readFileSync(values.combinedManifestPath, "utf8"),
    );
    motion.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    ).duration_seconds = target;
    writeJson(values.combinedManifestPath, motion);
    const narrationManifest = JSON.parse(
      fs.readFileSync(values.narrationManifestPath, "utf8"),
    );
    narrationManifest.narration.final_target_seconds = target;
    narrationManifest.narration.visual_breath_allowance_seconds =
      target - narrationManifest.narration.duration_seconds;
    writeJson(values.narrationManifestPath, narrationManifest);
    const captionProject = addPreRenderedCaptions(
      values,
      target,
    );

    const calls = [];
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.combinedManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256: sha256(
          fs.readFileSync(values.narrationManifestPath),
        ),
        outDir: values.outputDir,
        generatedAt: GENERATED_AT,
        preserveRenderedCaptions: true,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) {
            return videoProbe({ duration: target + 0.02 });
          }
          return videoProbe({ duration: target, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          calls.push(invocation);
          fs.writeFileSync(invocation.outputPath, "captioned-final");
        },
      },
    );

    assert.doesNotMatch(calls[0].filter, /ass=captions\.ass/);
    assert.doesNotMatch(calls[0].filter, /\[0:a:0\]/);
    const qa = JSON.parse(
      fs.readFileSync(result.qa_report_path, "utf8"),
    );
    assert.equal(qa.captions.mode, "PRE_RENDERED");
    assert.equal(qa.captions.final_burn_in_performed, false);
    assert.equal(qa.captions.visual_review_required, true);
    assert.equal(qa.technical.duration_seconds, target);
    assert.equal(qa.audio.mix_mode, "GOVERNED_NARRATION_ONLY");
    assert.equal(
      qa.audio.programme_audio_disposition,
      "DROPPED_UNMAPPED",
    );
    assert.equal(qa.audio.programme_audio_mapped, false);
    const manifest = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.equal(manifest.captions.mode, "PRE_RENDERED");
    assert.equal(
      manifest.captions.final_burn_in_performed,
      false,
    );
    assert.equal(
      manifest.captions.source_video_sha256,
      sha256(fs.readFileSync(values.hyperframesPath)),
    );
    assert.equal(manifest.ffmpeg.visual_playback_rate, 1);
    assert.equal(
      manifest.ffmpeg.source_visual_duration_seconds,
      target + 0.02,
    );
    assert.equal(
      manifest.ffmpeg.full_hyperframes_sequence_preserved,
      false,
    );
    assert.equal(
      manifest.ffmpeg.source_tail_trimmed_seconds,
      0.02,
    );
    assert.equal(
      manifest.ffmpeg.source_tail_padded_seconds,
      0,
    );
    assert.equal(
      manifest.ffmpeg.programme_audio_disposition,
      "DROPPED_UNMAPPED",
    );
    assert.equal(
      manifest.inputs.filter_complex.sha256,
      sha256(fs.readFileSync(result.filter_path)),
    );
    assert.equal(
      manifest.captions.programme_binding.verdict,
      "PASS",
    );
    assert.equal(
      manifest.captions.programme_binding
        .caption_composition_sha256,
      sha256(fs.readFileSync(captionProject.captionsPath)),
    );
    assert.equal(
      manifest.captions.programme_binding.word_count,
      captionProject.wordCount,
    );
    assert.deepEqual(
      manifest.captions.safe_zone.caption_rect,
      {
        x: 96,
        y: 1336,
        width: 720,
        height: 80,
      },
    );
    assert.equal(
      manifest.captions.safe_zone.source,
      "PRE_RENDERED_COMPOSITION_DECLARATION",
    );
    assert.equal(
      manifest.captions.safe_zone.verdict,
      "DECLARATION_BOUND",
    );
    assert.equal(
      manifest.captions.safe_zone
        .visual_geometry_verified,
      false,
    );
    assert.deepEqual(
      manifest.captions.programme_binding.safe_zone,
      manifest.captions.safe_zone,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite rejects safe-zone CSS declared only in a comment before an unsafe active override", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_css_binding_mismatch",
    mutateCaption: (source) =>
      source.replace(
        "<style>:root { --cap-band-left: 96px; --cap-band-top: 1336px; --cap-band-width: 720px; --cap-band-height: 80px; }</style>",
        "<style>/* --cap-band-left: 96px; --cap-band-top: 1336px; --cap-band-width: 720px; --cap-band-height: 80px; */ :root { --cap-band-left: 900px; --cap-band-top: 50px; --cap-band-width: 50px; --cap-band-height: 50px; }</style>",
      ),
  });
});

test("executeGovernedFinalComposite rejects safe-zone geometry bound only to an unused selector", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_css_binding_mismatch",
    mutateCaption: (source) =>
      source.replace(
        "<style>.caption-stage {",
        "<style>.proof-only {",
      ),
  });
});

test("executeGovernedFinalComposite ignores a commented safe root and rejects the unsafe active caption root", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_safe_zone_profile_required",
    mutateCaption(source, { durationSeconds }) {
      const safeRoot =
        `<div id="captions-root" data-start="0" data-duration="${durationSeconds}" data-width="1080" data-height="1920" data-platform-safe-zone-profile="portrait-cross-platform-strict-v1" data-caption-rect-x="96" data-caption-rect-y="1336" data-caption-rect-width="720" data-caption-rect-height="80"><div id="caption-stage" class="caption-stage"></div></div>`;
      const unsafeRoot =
        `<div id="captions-root" data-start="0" data-duration="${durationSeconds}" data-width="1080" data-height="1920"><div id="caption-stage" class="caption-stage"></div></div>`;
      assert.ok(source.includes(safeRoot));
      return source.replace(
        safeRoot,
        `<!-- ${safeRoot} -->\n${unsafeRoot}`,
      );
    },
  });
});

test("executeGovernedFinalComposite rejects duplicate active caption roots", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode: "pre_rendered_caption_root_invalid",
    mutateCaption(source, { durationSeconds }) {
      const safeRoot =
        `<div id="captions-root" data-start="0" data-duration="${durationSeconds}" data-width="1080" data-height="1920" data-platform-safe-zone-profile="portrait-cross-platform-strict-v1" data-caption-rect-x="96" data-caption-rect-y="1336" data-caption-rect-width="720" data-caption-rect-height="80"><div id="caption-stage" class="caption-stage"></div></div>`;
      assert.ok(source.includes(safeRoot));
      return source.replace(
        safeRoot,
        `${safeRoot}\n${safeRoot}`,
      );
    },
  });
});

test("executeGovernedFinalComposite rejects an active caption geometry override with higher specificity", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_css_binding_mismatch",
    mutateCaption: (source) =>
      source.replace(
        "</template>",
        "<style>#caption-stage { left: 0px !important; }</style>\n</template>",
      ),
  });
});

test("executeGovernedFinalComposite rejects a non-portrait safe-zone profile even when its declared rectangle is internally valid", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_safe_zone_profile_mismatch",
    mutateCaption: (source) =>
      source
        .replace(
          "portrait-cross-platform-strict-v1",
          "longform-16x9-strict-v1",
        )
        .replaceAll("96px", "144px")
        .replaceAll("1336px", "650px")
        .replace(
          'data-caption-rect-x="96"',
          'data-caption-rect-x="144"',
        )
        .replace(
          'data-caption-rect-y="1336"',
          'data-caption-rect-y="650"',
        ),
  });
});

test("executeGovernedFinalComposite rejects a caption template whose declared canvas differs from the portrait programme", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode: "pre_rendered_caption_canvas_mismatch",
    mutateCaption: (source) =>
      source.replace(
        'data-width="1080" data-height="1920">',
        'data-width="1920" data-height="1080">',
      ),
  });
});

test("executeGovernedFinalComposite rejects a caption root whose canvas differs from its portrait template", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode: "pre_rendered_caption_canvas_mismatch",
    mutateCaption: (source, { durationSeconds }) =>
      source.replace(
        `data-duration="${durationSeconds}" data-width="1080" data-height="1920" data-platform`,
        `data-duration="${durationSeconds}" data-width="1080" data-height="1080" data-platform`,
      ),
  });
});

test("executeGovernedFinalComposite rejects a pre-rendered caption root with no finite duration", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_root_timing_invalid",
    mutateCaption: (source, { durationSeconds }) =>
      source.replace(
        ` data-duration="${durationSeconds}"`,
        "",
      ),
  });
});

test("executeGovernedFinalComposite rejects an empty caption rectangle coordinate as invalid rather than coercing it to zero", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode: "pre_rendered_caption_rect_invalid",
    mutateCaption: (source) =>
      source.replace(
        'data-caption-rect-x="96"',
        'data-caption-rect-x=""',
      ),
  });
});

test("executeGovernedFinalComposite rejects a pre-rendered caption mount with no finite duration", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_mount_binding_invalid",
    mutateIndex: (source, { durationSeconds }) =>
      source.replace(
        ` data-duration="${durationSeconds}"`,
        "",
      ),
  });
});

test("executeGovernedFinalComposite rejects an empty pre-rendered word time instead of coercing it to zero", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_word_0_timing_invalid",
    mutateCaption(source, { values }) {
      const firstWord = JSON.parse(
        fs.readFileSync(values.timestampsPath, "utf8"),
      ).words[0];
      const exactWordPrefix =
        `"id":"caption-word-0-0","text":${JSON.stringify(firstWord.text)},"start":${firstWord.start_seconds}`;
      assert.ok(source.includes(exactWordPrefix));
      return source.replace(
        exactWordPrefix,
        `"id":"caption-word-0-0","text":${JSON.stringify(firstWord.text)},"start":""`,
      );
    },
  });
});

test("executeGovernedFinalComposite rejects caption project bytes that drift after manifest validation", async () => {
  await assertPreRenderedCaptionMutationRejected({
    expectedCode:
      "pre_rendered_caption_composition_sha256_changed",
    beforeCaptionValidation({ captionProject }) {
      fs.appendFileSync(
        captionProject.captionsPath,
        "\n<!-- changed after project validation -->\n",
        "utf8",
      );
    },
  });
});

test("executeGovernedFinalComposite rejects a caption composition reached through a directory junction", async () => {
  const values = fixture();
  try {
    const target = 36.48;
    const captionProject =
      preparePreRenderedCaptionFixture(values, target);
    const linkedDir = path.join(
      values.projectDir,
      "linked",
    );
    const linkedCaptionsPath = path.join(
      linkedDir,
      "captions.html",
    );
    fs.symlinkSync(values.projectDir, linkedDir, "junction");

    fs.writeFileSync(
      values.projectPath,
      fs
        .readFileSync(values.projectPath, "utf8")
        .replace(
          'data-composition-src="captions.html"',
          'data-composition-src="linked/captions.html"',
        ),
      "utf8",
    );
    const manifest = JSON.parse(
      fs.readFileSync(values.combinedManifestPath, "utf8"),
    );
    const projectFiles = manifest.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    ).provenance.project_files;
    projectFiles.find(
      (record) =>
        path.basename(record.path).toLowerCase() ===
        "index.html",
    ).sha256 = sha256(fs.readFileSync(values.projectPath));
    const captionRecord = projectFiles.find(
      (record) =>
        path.basename(record.path).toLowerCase() ===
        "captions.html",
    );
    captionRecord.path =
      "../videos/evercold/linked/captions.html";
    captionRecord.sha256 = sha256(
      fs.readFileSync(linkedCaptionsPath),
    );
    writeJson(values.combinedManifestPath, manifest);
    let rendered = false;

    await assert.rejects(
      executeGovernedFinalComposite(
        preRenderedCompositeOptions(values, target),
        preRenderedCompositeDependencies(values, target, {
          onRender() {
            rendered = true;
          },
        }),
      ),
      /pre_rendered_caption_composition_symlink_forbidden/,
    );
    assert.equal(rendered, false);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite rejects pre-rendered caption mode without a hash-bound caption composition", async () => {
  const values = fixture();
  try {
    const target = 36.48;
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.contract.duration_band_id =
      "what_changes_standard_35_42";
    intake.contract.target_duration_seconds = target;
    writeJson(values.storyIntakePath, intake);
    const motion = JSON.parse(
      fs.readFileSync(values.combinedManifestPath, "utf8"),
    );
    motion.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    ).duration_seconds = target;
    writeJson(values.combinedManifestPath, motion);
    const narrationManifest = JSON.parse(
      fs.readFileSync(values.narrationManifestPath, "utf8"),
    );
    narrationManifest.narration.final_target_seconds = target;
    narrationManifest.narration.visual_breath_allowance_seconds =
      target - narrationManifest.narration.duration_seconds;
    writeJson(values.narrationManifestPath, narrationManifest);

    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256: sha256(
            fs.readFileSync(values.narrationManifestPath),
          ),
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
          preserveRenderedCaptions: true,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            return videoProbe({ duration: target });
          },
          measureLoudness() {
            return sourceLoudness();
          },
          renderComposite() {
            throw new Error("must_not_render");
          },
        },
      ),
      /pre_rendered_caption_composition_missing/,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite revalidates and records a 36.48-second licensed cinematic mix", async () => {
  const values = fixture();
  try {
    const target = 36.48;
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.contract.duration_band_id =
      "what_changes_standard_35_42";
    intake.contract.target_duration_seconds = target;
    writeJson(values.storyIntakePath, intake);

    const motion = JSON.parse(
      fs.readFileSync(values.combinedManifestPath, "utf8"),
    );
    motion.assets.find(
      (asset) => asset.role === "hyperframes_intermediate",
    ).duration_seconds = target;
    writeJson(values.combinedManifestPath, motion);

    const narrationManifest = JSON.parse(
      fs.readFileSync(values.narrationManifestPath, "utf8"),
    );
    narrationManifest.narration.final_target_seconds = target;
    narrationManifest.narration.visual_breath_allowance_seconds =
      target - narrationManifest.narration.duration_seconds;
    writeJson(values.narrationManifestPath, narrationManifest);

    const licensedAudio = addValidatedLicensedAudio(
      values,
      target,
    );
    const validationCalls = [];
    const renderCalls = [];
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.combinedManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256: sha256(
          fs.readFileSync(values.narrationManifestPath),
        ),
        licensedAudioPackPath: licensedAudio.manifest_path,
        expectedLicensedAudioPackSha256:
          licensedAudio.manifest_sha256,
        expectedLicensedAudioRightsLedgerSha256:
          licensedAudio.rights_ledger.sha256,
        expectedYoutubeAccountUri:
          "https://www.youtube.com/@PulseGMG",
        outDir: values.outputDir,
        generatedAt: GENERATED_AT,
      },
      {
        validateLicensedAudioPack(options) {
          validationCalls.push(options);
          return structuredClone(licensedAudio);
        },
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (
            licensedAudio.assets.some(
              (asset) => asset.path === filePath,
            )
          ) {
            return audioProbe(8);
          }
          if (filePath === values.hyperframesPath) {
            return videoProbe({ duration: target });
          }
          return videoProbe({ duration: target, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          renderCalls.push(invocation);
          fs.writeFileSync(
            invocation.outputPath,
            "licensed-cinematic-final",
          );
        },
      },
    );

    assert.equal(validationCalls.length, 2);
    assert.equal(
      validationCalls[0].expectedNarrationSha256,
      sha256(fs.readFileSync(values.audioPath)),
    );
    assert.equal(
      validationCalls[0].expectedTimestampsSha256,
      sha256(fs.readFileSync(values.timestampsPath)),
    );
    assert.equal(
      validationCalls[0].expectedTargetDurationSeconds,
      target,
    );
    assert.equal(renderCalls.length, 1);
    assert.match(renderCalls[0].filter, /sidechaincompress=/);

    const renderer = JSON.parse(
      fs.readFileSync(result.renderer_manifest_path, "utf8"),
    );
    assert.equal(renderer.output.duration_seconds, target);
    assert.equal(
      renderer.inputs.filter((input) => input.role === "music")
        .length,
      1,
    );
    assert.equal(
      renderer.inputs.filter((input) => input.role === "sfx")
        .length,
      3,
    );

    const qa = JSON.parse(
      fs.readFileSync(result.qa_report_path, "utf8"),
    );
    assert.equal(qa.technical.duration_seconds, target);
    assert.equal(qa.audio.background_music_used, true);
    assert.equal(qa.audio.sound_effects_used, true);
    assert.equal(
      qa.audio.licensed_audio_pack.sha256,
      licensedAudio.manifest_sha256,
    );

    const composite = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.equal(composite.ffmpeg.duration_seconds, target);
    assert.equal(composite.ffmpeg.background_music_used, true);
    assert.equal(composite.ffmpeg.sound_effects_used, true);
    assert.equal(
      composite.inputs.licensed_audio_pack.sha256,
      licensedAudio.manifest_sha256,
    );
    assert.equal(
      result.licensed_audio_pack_sha256,
      licensedAudio.manifest_sha256,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite carries exact licensed source media through renderer, QA and composite evidence", async () => {
  const values = fixture();
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.originalManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        sourceMediaManifestPath:
          sourceMedia.sourceMediaManifestPath,
        expectedSourceMediaManifestSha256:
          sourceMedia.sourceMediaManifestSha256,
        outDir: values.outputDir,
        hyperframesProjectFiles: [
          values.projectPath,
          values.configPath,
          sourceMedia.sourceAssetPath,
        ],
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          fs.writeFileSync(
            invocation.outputPath,
            "licensed-source-media-final",
          );
        },
      },
    );

    const renderer = JSON.parse(
      fs.readFileSync(result.renderer_manifest_path, "utf8"),
    );
    const sourceInput = renderer.inputs.find(
      (input) => input.role === "source_media",
    );
    assert.equal(
      sourceInput.component_id,
      "bastion-gameplay-01",
    );
    assert.equal(sourceInput.embedded_in_final, true);
    assert.equal(
      sourceInput.sha256,
      sha256(fs.readFileSync(sourceMedia.sourceAssetPath)),
    );

    const qa = JSON.parse(
      fs.readFileSync(result.qa_report_path, "utf8"),
    );
    assert.equal(qa.source_media.policy, SOURCE_MEDIA_POLICY);
    assert.equal(
      qa.source_media.manifest.sha256,
      sourceMedia.sourceMediaManifestSha256,
    );
    assert.equal(qa.source_media.components.length, 1);
    assert.equal(
      qa.source_media.components[0].component_id,
      "bastion-gameplay-01",
    );

    const composite = JSON.parse(
      fs.readFileSync(result.composite_manifest_path, "utf8"),
    );
    assert.equal(
      composite.inputs.source_media_manifest.sha256,
      sourceMedia.sourceMediaManifestSha256,
    );
    assert.equal(
      composite.source_media.policy,
      SOURCE_MEDIA_POLICY,
    );
    assert.equal(composite.source_media.components.length, 1);
    assert.equal(composite.safety.network_used, false);
    assert.equal(result.source_media_policy, SOURCE_MEDIA_POLICY);
    assert.equal(
      result.source_media_manifest_sha256,
      sourceMedia.sourceMediaManifestSha256,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite requires the explicit licensed-official-FFXIV story policy before source-media work", async () => {
  const values = fixture();
  let probed = false;
  let rendered = false;
  try {
    const sourceMedia = addGovernedSourceMedia(values);
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    delete intake.story.visual_brief.source_media_policy;
    writeJson(values.storyIntakePath, intake);

    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath:
            values.originalManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath:
            values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          sourceMediaManifestPath:
            sourceMedia.sourceMediaManifestPath,
          expectedSourceMediaManifestSha256:
            sourceMedia.sourceMediaManifestSha256,
          outDir: values.outputDir,
          hyperframesProjectFiles: [
            values.projectPath,
            values.configPath,
            sourceMedia.sourceAssetPath,
          ],
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia() {
            probed = true;
          },
          renderComposite() {
            rendered = true;
          },
        },
      ),
      /source_media_policy_invalid/,
    );
    assert.equal(probed, false);
    assert.equal(rendered, false);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite rejects a missing owned-only source-media policy before probing", async () => {
  const values = fixture();
  let probed = false;
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    delete intake.story.visual_brief.source_media_policy;
    writeJson(values.storyIntakePath, intake);

    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia() {
            probed = true;
          },
        },
      ),
      /source_media_policy_invalid/,
    );
    assert.equal(probed, false);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite requires the exact source-media pair for licensed intake before probing", async () => {
  const values = fixture();
  let probed = false;
  try {
    const intake = JSON.parse(
      fs.readFileSync(values.storyIntakePath, "utf8"),
    );
    intake.story.visual_brief.source_media_policy =
      SOURCE_MEDIA_POLICY;
    writeJson(values.storyIntakePath, intake);

    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia() {
            probed = true;
          },
        },
      ),
      (error) => {
        assert.ok(
          error.codes.includes(
            "source_media_manifest_path_required",
          ),
        );
        assert.ok(
          error.codes.includes(
            "source_media_manifest_sha256_required",
          ),
        );
        return true;
      },
    );
    assert.equal(probed, false);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite checks the independent narration manifest hash before audio analysis or render", async () => {
  const values = fixture();
  let audioAnalysed = false;
  let rendered = false;
  try {
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256: "f".repeat(64),
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            return videoProbe();
          },
          measureLoudness() {
            audioAnalysed = true;
            return sourceLoudness();
          },
          renderComposite() {
            rendered = true;
          },
        },
      ),
      /narration_manifest_sha256_mismatch/,
    );
    assert.equal(audioAnalysed, false);
    assert.equal(rendered, false);
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite derives the combined manifest from explicit local project files", async () => {
  const values = fixture();
  try {
    const result = await executeGovernedFinalComposite(
      {
        storyIntakePath: values.storyIntakePath,
        ownedMotionManifestPath: values.originalManifestPath,
        videoPath: values.hyperframesPath,
        audioPath: values.audioPath,
        timestampsPath: values.timestampsPath,
        narrationManifestPath: values.narrationManifestPath,
        expectedNarrationManifestSha256:
          values.narrationManifestSha256,
        outDir: values.outputDir,
        hyperframesProjectFiles: [
          values.projectPath,
          values.configPath,
        ],
        generatedAt: GENERATED_AT,
      },
      {
        probeMedia(filePath) {
          if (filePath === values.audioPath) return audioProbe();
          if (filePath === values.hyperframesPath) return videoProbe();
          return videoProbe({ duration: 25, audio: true });
        },
        measureLoudness(filePath) {
          return filePath === values.audioPath
            ? sourceLoudness()
            : finalLoudness();
        },
        measureTerminalSilence() {
          return terminalSilence();
        },
        renderComposite(invocation) {
          fs.writeFileSync(invocation.outputPath, "derived-final");
        },
      },
    );
    assert.ok(fs.existsSync(result.combined_owned_motion_manifest_path));
    const combined = JSON.parse(
      fs.readFileSync(
        result.combined_owned_motion_manifest_path,
        "utf8",
      ),
    );
    assert.ok(
      combined.assets.some(
        (asset) => asset.role === "hyperframes_intermediate",
      ),
    );
    const promotedMotion = validateCombinedOwnedMotionManifest({
      manifestPath: result.combined_owned_motion_manifest_path,
      storyId: STORY_ID,
      hyperframesVideoPath: values.hyperframesPath,
      sourceMediaPolicy: "OWNED_ONLY",
    });
    assert.equal(promotedMotion.projectFiles.length, 2);
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite rejects a non-conforming final probe", async () => {
  const values = fixture();
  try {
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            if (filePath === values.hyperframesPath) return videoProbe();
            return videoProbe({ duration: 23.4, audio: true });
          },
          measureLoudness(filePath) {
            return filePath === values.audioPath
              ? sourceLoudness()
              : finalLoudness();
          },
          measureTerminalSilence() {
            return terminalSilence();
          },
          renderComposite(invocation) {
            fs.writeFileSync(invocation.outputPath, "short-final");
          },
        },
      ),
      /final_duration_must_be_25_seconds/,
    );
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
    assert.deepEqual(
      fs.existsSync(values.outputDir)
        ? fs
            .readdirSync(values.outputDir)
            .filter((name) => name.includes(".staging-"))
        : [],
      [],
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite refuses to overwrite an existing story bundle", async () => {
  const values = fixture();
  const finalStoryDir = path.join(values.outputDir, STORY_ID);
  const sentinelPath = path.join(finalStoryDir, "operator-proof.txt");
  try {
    fs.mkdirSync(finalStoryDir, { recursive: true });
    fs.writeFileSync(sentinelPath, "preserve-me");
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia() {
            throw new Error("must_not_probe");
          },
          renderComposite() {
            throw new Error("must_not_render");
          },
        },
      ),
      /final_composite_output_already_exists/,
    );
    assert.equal(fs.readFileSync(sentinelPath, "utf8"), "preserve-me");
    assert.deepEqual(
      fs
        .readdirSync(values.outputDir)
        .filter((name) => name.includes(".staging-")),
      [],
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("executeGovernedFinalComposite discards a staged render that misses loudness or dead-tail limits", async () => {
  const values = fixture();
  try {
    await assert.rejects(
      executeGovernedFinalComposite(
        {
          storyIntakePath: values.storyIntakePath,
          ownedMotionManifestPath: values.combinedManifestPath,
          videoPath: values.hyperframesPath,
          audioPath: values.audioPath,
          timestampsPath: values.timestampsPath,
          narrationManifestPath: values.narrationManifestPath,
          expectedNarrationManifestSha256:
            values.narrationManifestSha256,
          outDir: values.outputDir,
          generatedAt: GENERATED_AT,
        },
        {
          probeMedia(filePath) {
            if (filePath === values.audioPath) return audioProbe();
            if (filePath === values.hyperframesPath) return videoProbe();
            return videoProbe({ duration: 25, audio: true });
          },
          measureLoudness(filePath) {
            return filePath === values.audioPath
              ? sourceLoudness()
              : {
                  ...finalLoudness(),
                  integrated_lufs: -18.4,
                  true_peak_dbfs: -1.2,
                };
          },
          measureTerminalSilence() {
            return {
              ...terminalSilence(),
              terminal_silence_start_seconds: 21,
              terminal_silence_seconds: 3,
            };
          },
          renderComposite(invocation) {
            fs.writeFileSync(invocation.outputPath, "bad-audio-final");
          },
        },
      ),
      (error) => {
        assert.equal(error.name, "GovernedFinalCompositeError");
        assert.ok(
          error.codes.includes("final_audio_loudness_out_of_range"),
        );
        assert.ok(
          error.codes.includes("final_audio_true_peak_exceeds_limit"),
        );
        assert.ok(
          error.codes.includes("final_audio_terminal_silence_excessive"),
        );
        return true;
      },
    );
    assert.equal(
      fs.existsSync(path.join(values.outputDir, STORY_ID)),
      false,
    );
  } finally {
    fs.rmSync(values.root, { recursive: true, force: true });
  }
});

test("final composite implementation has no DB, OAuth, publisher or network boundary", () => {
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "lib",
      "services",
      "governed-final-composite.js",
    ),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /require\([^)]*(?:db|oauth|publisher|upload_)/i,
  );
  assert.doesNotMatch(source, /\b(?:fetch|axios|https?\.request)\s*\(/i);
});
