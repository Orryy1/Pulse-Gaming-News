"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const Database = require("better-sqlite3");

const { runMigrations } = require("../../lib/migrate");
const {
  hashRightsLedger,
} = require("../../lib/services/publication-evidence-gates");
const {
  fingerprintRendererManifest,
} = require("../../lib/stabilisation/renderer-governance");
const {
  executeGovernedPublicationReview,
} = require("../../lib/services/governed-publication-review");
const {
  METADATA_SCHEMA,
} = require("../../lib/services/governed-publication-metadata");
const {
  ATTRIBUTION_TEXT,
  MANIFEST_SCHEMA: SOURCE_MEDIA_MANIFEST_SCHEMA,
} = require("../../lib/services/governed-source-media");
const {
  buildNextPublishCandidatesReport,
} = require("../../lib/ops/stabilisation-preflight");

const NOW = "2026-07-27T12:00:00.000Z";
const STORY_ID = "official_ff567afb1a07";
const CHANNEL_ID = "pulse-gaming";
const SCRIPT =
  "Delta Force just widened cheater compensation to cover thirty-day bans. Previously, victims qualified only after a ten-year ban. The official update says in-game mail should arrive within three business days of confirmation. But if a squadmate extracted and returned your gear, you cannot claim twice.";
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

function fileRecord(root, name, contents) {
  const filePath = path.join(root, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return {
    path: name.replace(/\\/g, "/"),
    absolutePath: filePath,
    sha256: sha256(fs.readFileSync(filePath)),
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

function migrationEnv() {
  return {
    NODE_ENV: "production",
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    PULSE_MIGRATION_020_APPROVED: "true",
    PULSE_MIGRATION_020_APPROVAL_ID: "test-migration-020",
    PULSE_MIGRATION_020_APPROVED_BY: "test-operator",
    PULSE_MIGRATION_020_BACKUP_ID: "test-backup",
    PULSE_MIGRATION_020_BACKUP_SHA256: "a".repeat(64),
    PULSE_MIGRATION_020_BACKUP_VERIFIED_AT: "2026-07-27T11:00:00.000Z",
  };
}

function createDatabase(root, values) {
  const scriptSha = values.scriptSha256;
  const databasePath = path.join(root, "pulse.db");
  const db = new Database(databasePath);
  runMigrations(db, {
    env: migrationEnv(),
    now: new Date(NOW),
    log() {},
  });
  db.prepare(
    `INSERT INTO channels (id, name, enabled)
     VALUES (?, ?, 1)`,
  ).run(CHANNEL_ID, "Pulse Gaming");
  db.prepare(
    `INSERT INTO stories
       (id, title, channel_id, approved, auto_approved, full_script,
        tts_script, _extra)
     VALUES (?, ?, ?, 1, 0, ?, ?, ?)`,
  ).run(
    STORY_ID,
    "Delta Force widens cheater compensation",
    CHANNEL_ID,
    SCRIPT,
    SCRIPT,
    JSON.stringify({
      script_sha256: scriptSha,
      script_approved_sha256: scriptSha,
      script_approved_by: "script-editor",
      script_approved_at: "2026-07-27T11:15:00.000Z",
      operator_review_status: "script_approved",
      source_evidence_sha256:
        values.review.source_evidence.sha256,
      owned_asset_manifest_sha256:
        values.review.owned_motion_manifest.sha256,
    }),
  );
  db.close();
  return databasePath;
}

function createBackupEvidence(root, databasePath, suffix = "one") {
  const backupPath = path.join(root, `pulse-${suffix}.backup.db`);
  fs.copyFileSync(databasePath, backupPath);
  const evidencePath = path.join(root, `backup-${suffix}.json`);
  writeJson(evidencePath, {
    schema_version: "pulse-cutover-backup-evidence-v1",
    backup_id: `backup-${suffix}`,
    backup_path: path.basename(backupPath),
    backup_sha256: sha256(fs.readFileSync(backupPath)),
    source_database_path: databasePath,
    source_database_sha256: sha256(fs.readFileSync(databasePath)),
    verified_at: "2026-07-27T11:30:00.000Z",
    verified_by: "backup-verifier",
    restore_test_status: "PASS",
    integrity_check: "ok",
    foreign_key_check: "ok",
  });
  return evidencePath;
}

function applyEnv(overrides = {}) {
  return {
    PULSE_OPERATING_MODE: "HUMAN_REVIEW",
    OPERATING_MODE: "HUMAN_REVIEW",
    AUTO_PUBLISH: "false",
    PULSE_EMERGENCY_KILL_SWITCH: "true",
    PULSE_CUTOVER_SCHEDULER_STOPPED: "true",
    PULSE_CUTOVER_WORKERS_STOPPED: "true",
    ...overrides,
  };
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-review-"));
  const scriptSha256 = sha256(SCRIPT);
  const finalMp4 = fileRecord(root, "final.mp4", "reviewed-final-mp4");
  const narration = fileRecord(root, "narration.mp3", "licensed-narration");
  const motion = fileRecord(root, "motion.mp4", "owned-motion");
  const still = fileRecord(root, "hero.png", "owned-still");
  const timestampsPath = path.join(root, "timestamps.json");
  writeJson(timestampsPath, {
    schema_version: "pulse-word-timestamps-v1",
    story_id: STORY_ID,
    words: [
      { text: "Delta", start_seconds: 0, end_seconds: 0.3 },
      { text: "Force", start_seconds: 0.3, end_seconds: 0.6 },
    ],
  });
  const timestamps = {
    path: "timestamps.json",
    absolutePath: timestampsPath,
    sha256: sha256(fs.readFileSync(timestampsPath)),
  };

  const ownedMotionPath = path.join(root, "owned-motion-manifest.json");
  writeJson(ownedMotionPath, {
    schema_version: "pulse-owned-motion-manifest-v1",
    story_id: STORY_ID,
    generated_at: NOW,
    assets: [
      {
        path: motion.path,
        sha256: motion.sha256,
        media_type: "video",
        role: "primary_motion",
        ownership: "owned",
        width: 1080,
        height: 1920,
        duration_seconds: 28,
      },
      {
        path: still.path,
        sha256: still.sha256,
        media_type: "image",
        role: "hero",
        ownership: "owned",
        width: 1080,
        height: 1920,
      },
    ],
  });
  const ownedMotion = {
    path: "owned-motion-manifest.json",
    absolutePath: ownedMotionPath,
    sha256: sha256(fs.readFileSync(ownedMotionPath)),
  };

  const sourcePath = path.join(root, "source-evidence.json");
  writeJson(sourcePath, {
    schema_version: "pulse-source-evidence-v1",
    source_url:
      "https://steamcommunity.com/games/2507950/announcements/detail/711155982681508947",
    source_type: "official",
    published_at: "2026-07-27T09:15:34.000Z",
    claims: ["Thirty-day bans now qualify for compensation."],
  });
  const source = {
    path: "source-evidence.json",
    sha256: sha256(fs.readFileSync(sourcePath)),
  };

  const transformationPath = path.join(root, "transformation.json");
  writeJson(transformationPath, {
    schema_version: "pulse-transformation-evidence-v1",
    story_id: STORY_ID,
    verdict: "STRONG",
    rationale:
      "Original narration, player-focused comparison, sequencing and owned motion materially transform the official facts.",
  });
  const transformation = {
    path: "transformation.json",
    sha256: sha256(fs.readFileSync(transformationPath)),
  };

  const motionRightsPath = path.join(root, "motion-rights.json");
  writeJson(motionRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    asset_sha256: motion.sha256,
    rights_basis: "OWNED",
    provenance: "repository_owned_generation",
  });
  const narrationRightsPath = path.join(root, "narration-rights.json");
  writeJson(narrationRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    asset_sha256: narration.sha256,
    rights_basis: "LICENSED",
    provenance: "operator_subscription_attestation",
  });
  const rightsLedger = {
    ledger_version: 1,
    decision: "CLEARED",
    story_id: STORY_ID,
    items: [
      {
        item_id: "owned-motion",
        source_url: `pulse-owned://${STORY_ID}/motion`,
        asset_path: motion.path,
        asset_sha256: motion.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "OWNED",
        rights_evidence: {
          reference: "motion-rights.json",
          sha256: sha256(fs.readFileSync(motionRightsPath)),
        },
        attribution_decision: "NOT_REQUIRED",
      },
      {
        item_id: "narration",
        source_url: `pulse-licensed://${STORY_ID}/narration`,
        asset_path: narration.path,
        asset_sha256: narration.sha256,
        included_in_final: true,
        rights_decision: "CLEARED",
        rights_basis: "LICENSED",
        rights_evidence: {
          reference: "narration-rights.json",
          sha256: sha256(fs.readFileSync(narrationRightsPath)),
        },
        attribution_decision: "NOT_REQUIRED",
      },
    ],
  };
  const rightsPath = path.join(root, "rights-ledger.json");
  writeJson(rightsPath, rightsLedger);
  const rights = {
    path: "rights-ledger.json",
    file_sha256: sha256(fs.readFileSync(rightsPath)),
    canonical_sha256: hashRightsLedger(rightsLedger),
  };

  const rendererInputs = [
    {
      component_id: "owned-motion",
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
  const rendererManifest = {
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
      exact_subject_still_motion_count: 4,
      unrelated_filler_count: 0,
      every_scene_rights_accepted: true,
    },
    inputs: rendererInputs,
  };
  const rendererPath = path.join(root, "renderer-manifest.json");
  writeJson(rendererPath, rendererManifest);
  const renderer = {
    path: "renderer-manifest.json",
    file_sha256: sha256(fs.readFileSync(rendererPath)),
    canonical_sha256: fingerprintRendererManifest(rendererManifest),
  };

  const qaPath = path.join(root, "qa.json");
  writeJson(qaPath, {
    schema_version: "pulse-final-render-qa-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    verdict: "PASS",
    media_sha256: finalMp4.sha256,
    script_sha256: scriptSha256,
    renderer_manifest_sha256: renderer.canonical_sha256,
  });
  const qa = {
    path: "qa.json",
    sha256: sha256(fs.readFileSync(qaPath)),
  };

  const publicationMetadataPath = path.join(
    root,
    "publication-metadata.json",
  );
  writeJson(publicationMetadataPath, {
    schema_version: METADATA_SCHEMA,
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    platform: "youtube_shorts",
    title: "Delta Force widens cheater compensation",
    description:
      "Delta Force has expanded cheater compensation eligibility.",
  });
  const publicationMetadata = {
    path: path.basename(publicationMetadataPath),
    absolutePath: publicationMetadataPath,
    sha256: sha256(fs.readFileSync(publicationMetadataPath)),
  };

  const reviewPath = path.join(root, "publication-review.json");
  const review = {
    schema_version: "pulse-governed-publication-review-v1",
    story_id: STORY_ID,
    channel_id: CHANNEL_ID,
    script_sha256: scriptSha256,
    source_evidence: source,
    qa_report: qa,
    transformation_evidence: transformation,
    rights_ledger: rights,
    synthetic_media_disclosure: {
      contains_synthetic_media: true,
      decision: "DISCLOSE",
      rationale:
        "The final edit contains synthetic narration and designed motion.",
      disclosure_text:
        "Includes AI-generated narration and synthetic visual elements.",
      youtube_field_value: true,
      reviewed_at: "2026-07-27T11:45:00.000Z",
    },
    renderer_manifest: renderer,
    final_mp4: {
      path: finalMp4.path,
      sha256: finalMp4.sha256,
    },
    narration_audio: {
      path: narration.path,
      sha256: narration.sha256,
      component_id: "narration",
    },
    word_timestamps: {
      path: timestamps.path,
      sha256: timestamps.sha256,
      component_id: "word-timestamps",
    },
    owned_motion_manifest: {
      path: ownedMotion.path,
      sha256: ownedMotion.sha256,
    },
    publication_metadata: {
      path: publicationMetadata.path,
      sha256: publicationMetadata.sha256,
      platform: "youtube_shorts",
    },
    policy: {
      source_media_policy: "OWNED_ONLY",
      third_party_media_used: false,
      attribution_required: false,
    },
    renderer_inputs: rendererInputs,
  };
  writeJson(reviewPath, review);
  return {
    root,
    review,
    reviewPath,
    rightsLedger,
    rightsPath,
    motionRightsPath,
    scriptSha256,
    finalMp4,
    narration,
    motion,
    publicationMetadata,
  };
}

function addLicensedSourceMedia(values) {
  const asset = fileRecord(
    values.root,
    "source-media/ffxiv-gameplay.png",
    TINY_PNG,
  );
  const rightsReviewPath = path.join(
    values.root,
    "source-media-rights-review.json",
  );
  writeJson(rightsReviewPath, {
    schema_version: "pulse-governed-rights-review-evidence-v1",
    story_id: STORY_ID,
    review_status: "ACCEPTED",
    rights_basis: "LICENSED",
    publisher: "Square Enix",
    licence_evidence_url: LICENCE_URL,
    licence_effective_date: "2026-05-07",
    reviewed_by: "pulse-editorial-rights-review",
    reviewed_at: NOW,
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
  });
  const rightsReviewSha = sha256(
    fs.readFileSync(rightsReviewPath),
  );
  const sourceManifestPath = path.join(
    values.root,
    "source-media-manifest.json",
  );
  writeJson(sourceManifestPath, {
    schema_version: SOURCE_MEDIA_MANIFEST_SCHEMA,
    story_id: STORY_ID,
    generated_at: NOW,
    rights_review: {
      path: path.basename(rightsReviewPath),
      sha256: rightsReviewSha,
      review_status: "ACCEPTED",
    },
    components: [
      {
        component_id: "ffxiv-gameplay-01",
        media_type: "IMAGE",
        asset: {
          path: asset.path,
          sha256: asset.sha256,
          width: 1,
          height: 1,
          mime_type: "image/png",
        },
        source: {
          page_url: "https://eu.finalfantasyxiv.com/evercold/media/",
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
  });
  const sourceManifestSha = sha256(
    fs.readFileSync(sourceManifestPath),
  );

  const publicationMetadata = JSON.parse(
    fs.readFileSync(values.publicationMetadata.absolutePath, "utf8"),
  );
  publicationMetadata.description = [
    publicationMetadata.description,
    "",
    ATTRIBUTION_TEXT,
  ].join("\n");
  writeJson(
    values.publicationMetadata.absolutePath,
    publicationMetadata,
  );
  values.publicationMetadata.sha256 = sha256(
    fs.readFileSync(values.publicationMetadata.absolutePath),
  );
  values.review.publication_metadata.sha256 =
    values.publicationMetadata.sha256;

  const ownedMotionPath = path.join(
    values.root,
    values.review.owned_motion_manifest.path,
  );
  const ownedMotion = JSON.parse(
    fs.readFileSync(ownedMotionPath, "utf8"),
  );
  const mixed = ownedMotion.assets.find(
    (component) => component.media_type === "video",
  );
  mixed.role = "hyperframes_intermediate";
  mixed.ownership = "mixed";
  mixed.rights_basis = "LICENSED";
  mixed.attribution_required = true;
  mixed.provenance = {
    third_party_media_used: true,
    source_media_manifest: {
      path: path.basename(sourceManifestPath),
      sha256: sourceManifestSha,
    },
  };
  for (const component of ownedMotion.assets.filter(
    (candidate) => candidate !== mixed,
  )) {
    component.rights_basis = "OWNED";
    component.attribution_required = false;
    component.provenance = {
      third_party_media_used: false,
    };
  }
  writeJson(ownedMotionPath, ownedMotion);
  values.review.owned_motion_manifest.sha256 = sha256(
    fs.readFileSync(ownedMotionPath),
  );

  const sourceInput = {
    component_id: "ffxiv-gameplay-01",
    role: "source_media",
    path: asset.path,
    sha256: asset.sha256,
    embedded_in_final: true,
  };
  const rendererPath = path.join(
    values.root,
    values.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(
    fs.readFileSync(rendererPath, "utf8"),
  );
  renderer.inputs.push(sourceInput);
  writeJson(rendererPath, renderer);
  values.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  values.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  values.review.renderer_inputs.push(sourceInput);

  const qaPath = path.join(values.root, values.review.qa_report.path);
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    values.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  values.review.qa_report.sha256 = sha256(fs.readFileSync(qaPath));

  const sourceRightsPath = path.join(
    values.root,
    "source-media-rights.json",
  );
  writeJson(sourceRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    story_id: STORY_ID,
    rights_basis: "LICENSED",
    rights_decision: "CLEARED",
    publisher: "Square Enix",
    attribution_required: true,
    attribution_text: ATTRIBUTION_TEXT,
    attribution_delivery: ["DESCRIPTION", "ON_SCREEN"],
    description_attribution_evidence: {
      publication_metadata: {
        path: values.review.publication_metadata.path,
        sha256: values.review.publication_metadata.sha256,
        platform: "youtube_shorts",
      },
      notice: ATTRIBUTION_TEXT,
      exact_standalone_line_verified: true,
    },
    third_party_media_used: true,
    licence: {
      evidence_url: LICENCE_URL,
      rights_review_path: path.basename(rightsReviewPath),
      rights_review_sha256: rightsReviewSha,
      review_status: "ACCEPTED",
    },
    manifest_binding: {
      path: path.basename(sourceManifestPath),
      sha256: sourceManifestSha,
    },
    components: [
      {
        component_id: "ffxiv-gameplay-01",
        asset_path: asset.path,
        asset_sha256: asset.sha256,
        direct_media_url:
          "https://lds-img.finalfantasyxiv.com/promo/h/a/test.png",
        rights_basis: "LICENSED",
        attribution_required: true,
        attribution_text: ATTRIBUTION_TEXT,
      },
    ],
  });
  const sourceRightsSha = sha256(
    fs.readFileSync(sourceRightsPath),
  );
  const motionItem = values.rightsLedger.items.find(
    (item) => item.item_id === "owned-motion",
  );
  writeJson(values.motionRightsPath, {
    schema_version: "pulse-rights-evidence-v1",
    story_id: STORY_ID,
    component_id: "owned-motion",
    asset_path: values.motion.path,
    asset_sha256: values.motion.sha256,
    rights_basis: "LICENSED",
    rights_decision: "CLEARED",
    ownership: "mixed",
    attribution_required: true,
    attribution_text: ATTRIBUTION_TEXT,
    third_party_media_used: true,
    source_media_manifest_binding: {
      path: path.basename(sourceManifestPath),
      sha256: sourceManifestSha,
    },
  });
  motionItem.rights_basis = "LICENSED";
  motionItem.rights_evidence.sha256 = sha256(
    fs.readFileSync(values.motionRightsPath),
  );
  motionItem.attribution_decision = "REQUIRED_AND_SUPPLIED";
  motionItem.attribution_text = ATTRIBUTION_TEXT;
  values.rightsLedger.items.push({
    item_id: "ffxiv-gameplay-01",
    source_url:
      "https://lds-img.finalfantasyxiv.com/promo/h/a/test.png",
    asset_path: asset.path,
    asset_sha256: asset.sha256,
    included_in_final: true,
    rights_decision: "CLEARED",
    rights_basis: "LICENSED",
    rights_evidence: {
      reference: path.basename(sourceRightsPath),
      sha256: sourceRightsSha,
    },
    attribution_decision: "REQUIRED_AND_SUPPLIED",
    attribution_text: ATTRIBUTION_TEXT,
  });
  writeJson(values.rightsPath, values.rightsLedger);
  values.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(values.rightsPath),
  );
  values.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    values.rightsLedger,
  );
  values.review.source_media_manifest = {
    path: path.basename(sourceManifestPath),
    sha256: sourceManifestSha,
  };
  values.review.policy = {
    source_media_policy: "LICENSED_OFFICIAL_FFXIV",
    third_party_media_used: true,
    attribution_required: true,
  };
  writeJson(values.reviewPath, values.review);
  return {
    ...values,
    sourceAsset: asset,
    sourceManifestPath,
    sourceManifestSha,
    sourceRightsPath,
  };
}

test("dry-run validates a complete review package and builds scheduler evidence", async () => {
  const values = fixture();
  const result = await executeGovernedPublicationReview({
    manifestPath: values.reviewPath,
    generatedAt: NOW,
    probe: async () => validProbe(),
  });

  assert.equal(result.mode, "DRY_RUN");
  assert.equal(result.verdict, "VALID");
  assert.equal(result.mutated, false);
  assert.equal(result.story_id, STORY_ID);
  assert.equal(result.media_sha256, values.finalMp4.sha256);
  assert.equal(
    result.preflight_evidence.renderer_manifest.output.sha256,
    values.finalMp4.sha256,
  );
  assert.equal(
    result.preflight_evidence.publication_metadata_sha256,
    values.publicationMetadata.sha256,
  );
  assert.deepEqual(result.preflight_evidence.publication_metadata, {
    path: values.publicationMetadata.absolutePath,
    sha256: values.publicationMetadata.sha256,
    platform: "youtube_shorts",
    title: "Delta Force widens cheater compensation",
    description:
      "Delta Force has expanded cheater compensation eligibility.",
  });
  assert.deepEqual(result.preflight_evidence.artifact_evidence, {
    final_mp4_exists: true,
    narration_audio_exists: true,
    word_timestamps_exist: true,
    motion_materialised: true,
    hashes_verified: true,
  });
  const report = buildNextPublishCandidatesReport({
    snapshot: {
      schema_version: "pulse-preflight-snapshot-v1",
      source: { kind: "test", read_only: true, errors: [] },
      stories: [
        {
          id: STORY_ID,
          title: "Delta Force widens cheater compensation",
          channel_id: CHANNEL_ID,
          approved: true,
          auto_approved: false,
          full_script: SCRIPT,
          exported_path: values.finalMp4.absolutePath,
          render_review_status: "approved",
        },
      ],
      evidence_by_story: {
        [STORY_ID]: result.preflight_evidence,
      },
      platform_posts: [],
      schedules: [],
      jobs: [],
      runtime_leases: [],
      dispatch_ledger: [],
    },
    env: {
      PULSE_OPERATING_MODE: "LOCAL_PROOF",
      AUTO_PUBLISH: "false",
    },
    generatedAt: NOW,
    sourceCommitSha: "a".repeat(40),
    runtimeCommitSha: "a".repeat(40),
  });
  assert.equal(report.candidates[0].preflight_verdict, "PASS");
});

test("review requires an explicit owned-only or licensed source-media policy", async () => {
  const missingPolicy = fixture();
  delete missingPolicy.review.policy;
  writeJson(missingPolicy.reviewPath, missingPolicy.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missingPolicy.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_policy_invalid",
        ),
      );
      return true;
    },
  );

  const missingLicensedManifest = fixture();
  missingLicensedManifest.review.policy = {
    source_media_policy: "LICENSED_OFFICIAL_FFXIV",
    third_party_media_used: true,
    attribution_required: true,
  };
  writeJson(
    missingLicensedManifest.reviewPath,
    missingLicensedManifest.review,
  );
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missingLicensedManifest.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_manifest_required",
        ),
      );
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_manifest_path_required",
        ),
      );
      assert.ok(
        error.codes.includes(
          "publication_review_source_media_manifest_sha256_required",
        ),
      );
      return true;
    },
  );
});

test("review reloads mandatory publication metadata and rejects omission or byte tampering", async () => {
  const missing = fixture();
  delete missing.review.publication_metadata;
  writeJson(missing.reviewPath, missing.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missing.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
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

  const tampered = fixture();
  fs.appendFileSync(
    tampered.publicationMetadata.absolutePath,
    " ",
    "utf8",
  );
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: tampered.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("publication_metadata_sha256_mismatch"),
      );
      return true;
    },
  );
});

test("review rejects licensed media when the independently bound publication description omits the exact copyright notice", async () => {
  const values = addLicensedSourceMedia(fixture());
  const metadata = JSON.parse(
    fs.readFileSync(values.publicationMetadata.absolutePath, "utf8"),
  );
  metadata.description =
    "Delta Force has expanded cheater compensation eligibility.";
  writeJson(values.publicationMetadata.absolutePath, metadata);
  values.review.publication_metadata.sha256 = sha256(
    fs.readFileSync(values.publicationMetadata.absolutePath),
  );
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "publication_metadata_description_attribution_missing",
        ),
      );
      return true;
    },
  );
});

test("dry-run validates exact licensed source-media inputs and required Square Enix attribution", async () => {
  const values = addLicensedSourceMedia(fixture());
  const result = await executeGovernedPublicationReview({
    manifestPath: values.reviewPath,
    generatedAt: NOW,
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "VALID");
  assert.equal(
    result.preflight_evidence.source_media_manifest_sha256,
    values.sourceManifestSha,
  );
  assert.equal(result.preflight_evidence.artifact_evidence.hashes_verified, true);
});

test("review rejects licensed source media omitted from renderer coverage or missing exact attribution", async () => {
  const missingRendererInput = addLicensedSourceMedia(fixture());
  const rendererPath = path.join(
    missingRendererInput.root,
    missingRendererInput.review.renderer_manifest.path,
  );
  const renderer = JSON.parse(fs.readFileSync(rendererPath, "utf8"));
  renderer.inputs = renderer.inputs.filter(
    (input) => input.role !== "source_media",
  );
  writeJson(rendererPath, renderer);
  missingRendererInput.review.renderer_inputs =
    missingRendererInput.review.renderer_inputs.filter(
      (input) => input.role !== "source_media",
    );
  missingRendererInput.review.renderer_manifest.file_sha256 = sha256(
    fs.readFileSync(rendererPath),
  );
  missingRendererInput.review.renderer_manifest.canonical_sha256 =
    fingerprintRendererManifest(renderer);
  const qaPath = path.join(
    missingRendererInput.root,
    missingRendererInput.review.qa_report.path,
  );
  const qa = JSON.parse(fs.readFileSync(qaPath, "utf8"));
  qa.renderer_manifest_sha256 =
    missingRendererInput.review.renderer_manifest.canonical_sha256;
  writeJson(qaPath, qa);
  missingRendererInput.review.qa_report.sha256 = sha256(
    fs.readFileSync(qaPath),
  );
  writeJson(
    missingRendererInput.reviewPath,
    missingRendererInput.review,
  );
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: missingRendererInput.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "source_media_renderer_input_coverage_mismatch",
        ),
      );
      assert.ok(
        error.codes.includes(
          "rights_ledger_renderer_component_coverage_mismatch",
        ),
      );
      return true;
    },
  );

  const wrongAttribution = addLicensedSourceMedia(fixture());
  const item = wrongAttribution.rightsLedger.items.find(
    (candidate) => candidate.item_id === "ffxiv-gameplay-01",
  );
  item.attribution_text = "Credit: Square Enix";
  writeJson(wrongAttribution.rightsPath, wrongAttribution.rightsLedger);
  wrongAttribution.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(wrongAttribution.rightsPath),
  );
  wrongAttribution.review.rights_ledger.canonical_sha256 =
    hashRightsLedger(wrongAttribution.rightsLedger);
  writeJson(wrongAttribution.reviewPath, wrongAttribution.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: wrongAttribution.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("source_media_rights_ledger_item_invalid"),
      );
      return true;
    },
  );

  const falseMotionOwnership = addLicensedSourceMedia(fixture());
  const motionEvidence = JSON.parse(
    fs.readFileSync(falseMotionOwnership.motionRightsPath, "utf8"),
  );
  motionEvidence.ownership = "owned";
  writeJson(falseMotionOwnership.motionRightsPath, motionEvidence);
  falseMotionOwnership.rightsLedger.items.find(
    (candidate) => candidate.item_id === "owned-motion",
  ).rights_evidence.sha256 = sha256(
    fs.readFileSync(falseMotionOwnership.motionRightsPath),
  );
  writeJson(
    falseMotionOwnership.rightsPath,
    falseMotionOwnership.rightsLedger,
  );
  falseMotionOwnership.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(falseMotionOwnership.rightsPath),
  );
  falseMotionOwnership.review.rights_ledger.canonical_sha256 =
    hashRightsLedger(falseMotionOwnership.rightsLedger);
  writeJson(
    falseMotionOwnership.reviewPath,
    falseMotionOwnership.review,
  );
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: falseMotionOwnership.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes("mixed_motion_rights_evidence_invalid"),
      );
      return true;
    },
  );

  const tamperedAggregate = addLicensedSourceMedia(fixture());
  const aggregate = JSON.parse(
    fs.readFileSync(tamperedAggregate.sourceRightsPath, "utf8"),
  );
  aggregate.components[0].asset_sha256 = "f".repeat(64);
  writeJson(tamperedAggregate.sourceRightsPath, aggregate);
  const aggregateSha = sha256(
    fs.readFileSync(tamperedAggregate.sourceRightsPath),
  );
  tamperedAggregate.rightsLedger.items.find(
    (candidate) => candidate.item_id === "ffxiv-gameplay-01",
  ).rights_evidence.sha256 = aggregateSha;
  writeJson(
    tamperedAggregate.rightsPath,
    tamperedAggregate.rightsLedger,
  );
  tamperedAggregate.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(tamperedAggregate.rightsPath),
  );
  tamperedAggregate.review.rights_ledger.canonical_sha256 =
    hashRightsLedger(tamperedAggregate.rightsLedger);
  writeJson(tamperedAggregate.reviewPath, tamperedAggregate.review);
  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: tamperedAggregate.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "source_media_rights_evidence_components_mismatch",
        ),
      );
      return true;
    },
  );
});

test("rejects any embedded renderer component omitted from the rights ledger", async () => {
  const values = fixture();
  values.rightsLedger.items = values.rightsLedger.items.filter(
    (item) => item.item_id !== "narration",
  );
  writeJson(values.rightsPath, values.rightsLedger);
  values.review.rights_ledger.file_sha256 = sha256(
    fs.readFileSync(values.rightsPath),
  );
  values.review.rights_ledger.canonical_sha256 = hashRightsLedger(
    values.rightsLedger,
  );
  writeJson(values.reviewPath, values.review);

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.equal(error.name, "GovernedPublicationReviewError");
      assert.ok(
        error.codes.includes(
          "rights_ledger_renderer_component_coverage_mismatch",
        ),
      );
      return true;
    },
  );
});

test("apply atomically approves the exact reviewed render and records immutable provenance", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
  );
  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath,
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Exact final render, evidence and disclosure reviewed",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "APPLIED");
  assert.equal(result.mutated, true);
  const db = new Database(databasePath, { readonly: true });
  const story = db
    .prepare(
      `SELECT exported_path, audio_path, approved, auto_approved, _extra
       FROM stories WHERE id = ?`,
    )
    .get(STORY_ID);
  const extra = JSON.parse(story._extra);
  assert.equal(story.exported_path, values.finalMp4.absolutePath);
  assert.equal(story.audio_path, values.narration.absolutePath);
  assert.equal(story.approved, 1);
  assert.equal(story.auto_approved, 0);
  assert.equal(extra.render_review_status, "approved");
  assert.equal(
    extra.preflight_evidence.media_sha256,
    values.finalMp4.sha256,
  );
  assert.equal(
    extra.final_publication_review.review_manifest_sha256,
    result.review_manifest_sha256,
  );
  assert.deepEqual(
    extra.final_publication_review.publication_metadata,
    {
      path: values.publicationMetadata.absolutePath,
      sha256: values.publicationMetadata.sha256,
      platform: "youtube_shorts",
    },
  );
  assert.equal(
    extra.preflight_evidence.publication_metadata_sha256,
    values.publicationMetadata.sha256,
  );
  const audit = db
    .prepare(
      `SELECT * FROM operator_audit_log
       WHERE action = 'governed_publication_review' AND target_id = ?`,
    )
    .get(STORY_ID);
  assert.equal(audit.actor_id, "render-editor");
  assert.equal(audit.decision, "HUMAN_RENDER_APPROVED");
  assert.match(
    audit.idempotency_key,
    new RegExp(`^governed-publication-review:${STORY_ID}:`),
  );
  db.close();
});

test("apply refuses unsafe runtime state and inexact story, media or script confirmations", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const backupEvidencePath = createBackupEvidence(
    values.root,
    databasePath,
  );
  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath,
    confirmStoryId: "another-story",
    confirmMediaSha256: "1".repeat(64),
    confirmScriptSha256: "2".repeat(64),
    actorId: "render-editor",
    reason: "Attempt with unsafe controls",
    generatedAt: NOW,
    env: applyEnv({
      AUTO_PUBLISH: "true",
      PULSE_CUTOVER_WORKERS_STOPPED: "false",
    }),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("exact_story_confirmation_required"));
  assert.ok(
    result.blockers.includes("exact_media_sha256_confirmation_mismatch"),
  );
  assert.ok(
    result.blockers.includes("exact_script_sha256_confirmation_mismatch"),
  );
  assert.ok(result.blockers.includes("auto_publish_must_be_explicitly_false"));
  assert.ok(result.blockers.includes("workers_must_be_stopped"));
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'governed_publication_review'`,
      )
      .get().count,
    0,
  );
  assert.equal(
    db.prepare("SELECT exported_path FROM stories WHERE id = ?").get(STORY_ID)
      .exported_path,
    null,
  );
  db.close();
});

test("an exact replay is idempotent and never duplicates its immutable audit", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const options = {
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Exact final render reviewed",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  };
  const first = await executeGovernedPublicationReview({
    ...options,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "first",
    ),
  });
  assert.equal(first.verdict, "APPLIED");

  const replay = await executeGovernedPublicationReview({
    ...options,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "replay",
    ),
  });
  assert.equal(replay.verdict, "IDEMPOTENT");
  assert.equal(replay.mutated, false);
  const db = new Database(databasePath, { readonly: true });
  assert.equal(
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM operator_audit_log
         WHERE action = 'governed_publication_review' AND target_id = ?`,
      )
      .get(STORY_ID).count,
    1,
  );
  db.close();
});

test("apply rejects auto-approval and drift from the exact human-approved script hash", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const db = new Database(databasePath);
  const story = db
    .prepare("SELECT _extra FROM stories WHERE id = ?")
    .get(STORY_ID);
  const extra = JSON.parse(story._extra);
  extra.script_approved_sha256 = "f".repeat(64);
  db.prepare(
    "UPDATE stories SET auto_approved = 1, _extra = ? WHERE id = ?",
  ).run(JSON.stringify(extra), STORY_ID);
  db.close();

  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "approval-drift",
    ),
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Approval integrity test",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "HOLD");
  assert.equal(result.mutated, false);
  assert.ok(result.blockers.includes("auto_approved_story_forbidden"));
  assert.ok(
    result.blockers.includes("human_script_approval_hash_mismatch"),
  );
});

test("independent probing rejects an out-of-band duration or non-48k final audio", async () => {
  const values = fixture();
  const probe = validProbe();
  probe.streams[1].sample_rate = "44100";
  probe.format.duration = "24.99";

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => probe,
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "final_mp4_audio_sample_rate_must_be_48000",
        ),
      );
      assert.ok(
        error.codes.includes(
          "final_mp4_duration_must_be_25_to_32_seconds",
        ),
      );
      return true;
    },
  );
});

test("rejects a real rights-evidence file when its declared hash no longer matches", async () => {
  const values = fixture();
  fs.appendFileSync(values.motionRightsPath, "tampered");

  await assert.rejects(
    executeGovernedPublicationReview({
      manifestPath: values.reviewPath,
      generatedAt: NOW,
      probe: async () => validProbe(),
    }),
    (error) => {
      assert.ok(
        error.codes.includes(
          "rights_evidence_owned-motion_sha256_mismatch",
        ),
      );
      return true;
    },
  );
});

test("apply binds the review back to the source and owned-motion hashes stored at intake", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const db = new Database(databasePath);
  const row = db
    .prepare("SELECT _extra FROM stories WHERE id = ?")
    .get(STORY_ID);
  const extra = JSON.parse(row._extra);
  extra.source_evidence_sha256 = "e".repeat(64);
  extra.owned_asset_manifest_sha256 = "f".repeat(64);
  db.prepare("UPDATE stories SET _extra = ? WHERE id = ?").run(
    JSON.stringify(extra),
    STORY_ID,
  );
  db.close();

  const result = await executeGovernedPublicationReview({
    apply: true,
    manifestPath: values.reviewPath,
    databasePath,
    backupEvidencePath: createBackupEvidence(
      values.root,
      databasePath,
      "intake-drift",
    ),
    confirmStoryId: STORY_ID,
    confirmMediaSha256: values.finalMp4.sha256,
    confirmScriptSha256: values.scriptSha256,
    actorId: "render-editor",
    reason: "Intake hash binding test",
    generatedAt: NOW,
    env: applyEnv(),
    probe: async () => validProbe(),
  });

  assert.equal(result.verdict, "HOLD");
  assert.ok(result.blockers.includes("source_evidence_intake_hash_mismatch"));
  assert.ok(
    result.blockers.includes("owned_motion_intake_hash_mismatch"),
  );
});

test("the immediate transaction rolls the story update back if the audit write fails", async () => {
  const values = fixture();
  const databasePath = createDatabase(values.root, values);
  const db = new Database(databasePath);
  db.exec(
    `CREATE TRIGGER fail_governed_review_audit
     BEFORE INSERT ON operator_audit_log
     WHEN NEW.action = 'governed_publication_review'
     BEGIN
       SELECT RAISE(ABORT, 'forced_review_audit_failure');
     END;`,
  );
  db.close();

  await assert.rejects(
    executeGovernedPublicationReview({
      apply: true,
      manifestPath: values.reviewPath,
      databasePath,
      backupEvidencePath: createBackupEvidence(
        values.root,
        databasePath,
        "atomicity",
      ),
      confirmStoryId: STORY_ID,
      confirmMediaSha256: values.finalMp4.sha256,
      confirmScriptSha256: values.scriptSha256,
      actorId: "render-editor",
      reason: "Atomicity test",
      generatedAt: NOW,
      env: applyEnv(),
      probe: async () => validProbe(),
    }),
    /forced_review_audit_failure/,
  );
  const check = new Database(databasePath, { readonly: true });
  const story = check
    .prepare("SELECT exported_path, audio_path, _extra FROM stories WHERE id = ?")
    .get(STORY_ID);
  assert.equal(story.exported_path, null);
  assert.equal(story.audio_path, null);
  assert.equal(JSON.parse(story._extra).render_review_status, undefined);
  check.close();
});
