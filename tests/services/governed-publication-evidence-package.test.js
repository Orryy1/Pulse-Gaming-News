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

const STORY_ID = "official_d86953ca92ca";
const CHANNEL_ID = "pulse-gaming";
const GENERATED_AT = "2026-07-27T17:00:00.000Z";
const APPROVED_AT = "2026-07-27T17:05:00.000Z";
const DISCLOSURE_CONFIRMATION = "DISCLOSE_AND_SET_YOUTUBE_TRUE";
const SCRIPT =
  "Final Fantasy XIV just revealed a tank that fights with two giant shields. Bastion arrives in Evercold and only works in Evolved Mode.";

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
        forbidden_media: [
          "third-party screenshots",
          "gameplay footage",
          "trailers",
        ],
      },
    },
  });
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
  };
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

    const review = JSON.parse(
      fs.readFileSync(result.publication_review_path, "utf8"),
    );
    assert.equal(review.synthetic_media_disclosure.decision, "DISCLOSE");
    assert.equal(review.synthetic_media_disclosure.youtube_field_value, true);
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
